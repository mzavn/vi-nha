import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { runBackfill } from "../src/cron/backfill";
import { syncSepayRange } from "../src/services/settings";
import { notifyPendingLogs } from "../src/cron/pending-notifier";
import { ingestLog, type ParsedBankLog } from "../src/services/ingest";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw) } as Env;
});

describe("cron/backfill — rà soát 02:00 sáng (SePay API v2)", () => {
  const UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const row = (over: Record<string, unknown> = {}) => ({
    id: UUID,
    transaction_date: "2026-09-21 15:00:00",
    account_number: "0011xxxxxxx",
    va: null,
    transfer_type: "in",
    amount_in: 500000,
    amount_out: 0,
    accumulated: 0,
    transaction_content: "linh tinh",
    reference_number: "FT500",
    code: null,
    ...over,
  });
  const page = (data: unknown[], hasMore = false) => ({ status: "success", data, meta: { pagination: { has_more: hasMore } } });

  /** Giả `GET https://userapi.sepay.vn/v2/transactions`; ghi lại URL đã gọi. */
  function fakeFetch(calls: URL[], pages: unknown[][]): typeof fetch {
    return (async (url: string | URL) => {
      const u = new URL(String(url));
      calls.push(u);
      const n = Number(u.searchParams.get("page") ?? 1);
      return new Response(JSON.stringify(page(pages[n - 1] ?? [], n < pages.length)), { status: 200 });
    }) as typeof fetch;
  }

  it("bỏ qua lặng lẽ khi chưa cấu hình SEPAY_API_TOKEN", async () => {
    const calls: URL[] = [];
    const result = await runBackfill(env, new Date("2026-09-22T19:00:00.000Z"), fakeFetch(calls, [[row()]]));
    expect(result.added).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("gọi /v2/transactions theo khoảng ngày giờ VN, vá đúng 1 giao dịch bị sót; chạy lần hai không tạo thêm", async () => {
    env = { ...env, SEPAY_API_TOKEN: "hist-token" };
    const calls1: URL[] = [];
    const first = await runBackfill(env, new Date("2026-09-22T19:00:00.000Z"), fakeFetch(calls1, [[row()]])); // 19:00 UTC = 02:00 VN
    expect(first.added).toBe(1);
    expect(calls1).toHaveLength(1);
    expect(calls1[0]!.origin + calls1[0]!.pathname).toBe("https://userapi.sepay.vn/v2/transactions");
    expect(calls1[0]!.searchParams.get("transaction_date_from")).toBe("2026-09-22 00:00:00");
    expect(calls1[0]!.searchParams.get("transaction_date_to")).toBe("2026-09-23 02:00:00");
    expect(raw.prepare("SELECT source, status, amount, direction FROM bank_logs WHERE id = ?").get(UUID)).toEqual({
      source: "backfill",
      status: "pending",
      amount: 500000,
      direction: "in",
    });
    expect(raw.prepare("SELECT payload FROM notifications WHERE kind = 'backfill'").get()).toEqual({ payload: JSON.stringify({ added: 1, scope: "day" }) });

    const second = await runBackfill(env, new Date("2026-09-22T19:05:00.000Z"), fakeFetch([], [[row()]]));
    expect(second).toMatchObject({ added: 0, duplicates: 1 });
    expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs").get()).toEqual({ n: 1 });
  });

  it("khoảng rà 02:00 ba lớp: ngày thường soát hôm qua, thứ Hai soát cả tuần trước, ngày 1 soát cả tháng trước (thắng cả thứ Hai)", async () => {
    env = { ...env, SEPAY_API_TOKEN: "hist-token" };
    const fromOf = async (vnTwoAm: string) => {
      const calls: URL[] = [];
      await runBackfill(env, new Date(new Date(`${vnTwoAm}T02:00:00+07:00`).getTime()), fakeFetch(calls, [[]]));
      return calls[0]!.searchParams.get("transaction_date_from");
    };
    expect(await fromOf("2026-10-07")).toBe("2026-10-06 00:00:00"); // thứ Tư: hôm qua
    expect(await fromOf("2026-10-12")).toBe("2026-10-05 00:00:00"); // thứ Hai: từ thứ Hai tuần trước
    expect(await fromOf("2026-11-01")).toBe("2026-10-01 00:00:00"); // Chủ nhật ngày 1: cả tháng 10
    expect(await fromOf("2027-03-01")).toBe("2027-02-01 00:00:00"); // thứ Hai ngày 1: lấy tháng, không lấy tuần
    expect(await fromOf("2027-01-01")).toBe("2026-12-01 00:00:00"); // qua năm
    const scopes = raw.prepare("SELECT day_key, payload FROM notifications WHERE kind = 'backfill' ORDER BY day_key").all() as { day_key: string; payload: string }[];
    expect(scopes.map((r) => JSON.parse(r.payload).scope)).toEqual(["day", "week", "month", "month", "month"]);
  });

  it("đi hết các trang; bỏ giao dịch của tài khoản không bật SePay ở app; tiền ra đọc theo transfer_type", async () => {
    env = { ...env, SEPAY_API_TOKEN: "hist-token" };
    const calls: URL[] = [];
    const pages = [
      [row({ id: "u-1", reference_number: "FT1" }), row({ id: "u-2", account_number: "9999999999", reference_number: "FT2" })],
      [row({ id: "u-3", transfer_type: "out", amount_in: 0, amount_out: 120000, reference_number: "FT3" })],
    ];
    const result = await runBackfill(env, new Date("2026-09-22T19:00:00.000Z"), fakeFetch(calls, pages));
    expect(calls.map((u) => u.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(result.added).toBe(2);
    expect(raw.prepare("SELECT id, direction, amount FROM bank_logs ORDER BY id").all()).toEqual([
      { id: "u-1", direction: "in", amount: 500000 },
      { id: "u-3", direction: "out", amount: 120000 },
    ]);
  });

  it("API lỗi (mạng, 401) không làm hỏng cron, vẫn ghi dòng rà soát", async () => {
    env = { ...env, SEPAY_API_TOKEN: "hist-token" };
    const down: typeof fetch = (async () => {
      throw new Error("mạng lỗi");
    }) as typeof fetch;
    await expect(runBackfill(env, new Date("2026-09-22T19:00:00.000Z"), down)).resolves.toMatchObject({ added: 0, errors: ["SePay chính: Không gọi được SePay."] });
    const unauthorized: typeof fetch = (async () =>
      new Response(JSON.stringify({ status: "error", error_code: "unauthorized" }), { status: 401 })) as typeof fetch;
    await expect(runBackfill(env, new Date("2026-09-23T19:00:00.000Z"), unauthorized)).resolves.toMatchObject({ added: 0, errors: ["SePay chính: Token không hợp lệ."] });
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'backfill'").get()).toEqual({ n: 2 });
  });

  it("429 thì chờ Retry-After rồi thử lại một lần", async () => {
    env = { ...env, SEPAY_API_TOKEN: "hist-token" };
    vi.useFakeTimers();
    let n = 0;
    const limited: typeof fetch = (async () => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ status: "error", error_code: "rate_limited" }), { status: 429, headers: { "Retry-After": "2" } });
      return new Response(JSON.stringify(page([row()])), { status: 200 });
    }) as typeof fetch;
    const pending = runBackfill(env, new Date("2026-09-22T19:00:00.000Z"), limited);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toMatchObject({ added: 1 });
    expect(n).toBe(2);
    vi.useRealTimers();
  });
});

describe("nhiều kết nối SePay — mỗi kết nối một token (ADR-75)", () => {
  const tx = (id: string, account_number: string, over: Record<string, unknown> = {}) => ({
    id,
    transaction_date: "2026-09-21 15:00:00",
    account_number,
    va: null,
    transfer_type: "in",
    amount_in: 200000,
    amount_out: 0,
    accumulated: 0,
    transaction_content: "linh tinh",
    reference_number: `FT-${id}`,
    code: null,
    ...over,
  });

  /** Giả SePay của hai công ty: mỗi token chỉ thấy giao dịch công ty mình; token trong `broken` bị 401. Ghi lại token và URL đã gọi. */
  function companies(data: Record<string, unknown[]>, calls: { token: string; url: URL }[], broken: string[] = []): typeof fetch {
    return (async (url: string | URL, init?: RequestInit) => {
      const token = (new Headers(init?.headers).get("Authorization") ?? "").replace("Bearer ", "");
      calls.push({ token, url: new URL(String(url)) });
      if (broken.includes(token)) return new Response(JSON.stringify({ status: "error", error_code: "unauthorized" }), { status: 401 });
      return new Response(JSON.stringify({ status: "success", data: data[token] ?? [], meta: { pagination: { has_more: false } } }), { status: 200 });
    }) as typeof fetch;
  }

  beforeEach(() => {
    env = { ...env, SEPAY_API_TOKEN: "husband-token-0001" }; // kết nối mặc định 'default' dùng wrangler secret
    raw.prepare("INSERT INTO sepay_connections (id, name, api_token) VALUES ('sepay-wife', 'SePay của vợ', 'wife-token-0002')").run();
    raw.prepare("UPDATE accounts SET sepay_connection_id = 'sepay-wife' WHERE id = 'vcb-wife'").run();
  });

  const accountOf = (id: string) => raw.prepare("SELECT account_id FROM bank_logs WHERE id = ?").get(id);

  it("rà soát đi qua từng kết nối bằng token riêng; mỗi kết nối chỉ giữ giao dịch của tài khoản thuộc nó", async () => {
    const calls: { token: string; url: URL }[] = [];
    const data = {
      "husband-token-0001": [tx("m1", "0011xxxxxxx"), tx("lac-1", "0011yyyyyyy")],
      "wife-token-0002": [tx("t1", "0011yyyyyyy"), tx("lac-2", "0011xxxxxxx")],
    };
    const result = await runBackfill(env, new Date("2026-09-22T19:00:00.000Z"), companies(data, calls));
    expect(calls.map((c) => c.token)).toEqual(["husband-token-0001", "wife-token-0002"]);
    expect(result.perConnection).toEqual([
      { id: "default", name: "SePay chính", added: 1, duplicates: 0, beforeOpening: 0, error: null },
      { id: "sepay-wife", name: "SePay của vợ", added: 1, duplicates: 0, beforeOpening: 0, error: null },
    ]);
    expect(accountOf("m1")).toEqual({ account_id: "vcb-husband" });
    expect(accountOf("t1")).toEqual({ account_id: "vcb-wife" });
    expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs").get()).toEqual({ n: 2 });
  });

  it("một kết nối lỗi (token sai) không chặn kết nối kia; lỗi ghi theo tên kết nối, dòng rà soát vẫn có", async () => {
    const data = { "husband-token-0001": [tx("m1", "0011xxxxxxx")], "wife-token-0002": [tx("t1", "0011yyyyyyy")] };
    const result = await runBackfill(env, new Date("2026-09-22T19:00:00.000Z"), companies(data, [], ["wife-token-0002"]));
    expect(result).toMatchObject({ added: 1, errors: ["SePay của vợ: Token không hợp lệ."] });
    expect(accountOf("m1")).toEqual({ account_id: "vcb-husband" });
    expect(raw.prepare("SELECT payload FROM notifications WHERE kind = 'backfill'").get()).toEqual({ payload: JSON.stringify({ added: 1, scope: "day" }) });
  });

  describe("đồng bộ lại theo khoảng ngày (POST /v1/settings/sepay/sync)", () => {
    const now = new Date("2026-10-03T03:00:00.000Z"); // 10:00 ngày 03/10 giờ VN

    it("ngày sai dạng hoặc không có thật, Từ sau Đến, ngày tương lai, quá 31 ngày → invalid_range; kết nối lạ → not_found; không gọi SePay", async () => {
      const calls: { token: string; url: URL }[] = [];
      const f = companies({}, calls);
      for (const b of [
        { from: "2026-9-1", to: "2026-10-01" },
        { from: "2026-02-30", to: "2026-03-01" },
        { to: "2026-10-01" },
        { from: "2026-10-02", to: "2026-10-01" },
        { from: "2026-10-01", to: "2026-10-04" },
        { from: "2026-09-01", to: "2026-10-02" },
      ]) {
        await expect(syncSepayRange(env, b, now, f)).rejects.toMatchObject({ code: "invalid_range" });
      }
      await expect(syncSepayRange(env, { from: "2026-10-01", to: "2026-10-02", connection_id: "khong-co" }, now, f)).rejects.toMatchObject({ code: "not_found" });
      expect(calls).toEqual([]);
      // đúng 31 ngày, tới hôm nay: được
      await expect(syncSepayRange(env, { from: "2026-09-03", to: "2026-10-03" }, now, f)).resolves.toMatchObject({ from: "2026-09-03", to: "2026-10-03" });
    });

    it("chạy hai lần cùng khoảng ngày: lần hai không thêm gì; giao dịch webhook đã có tính là có sẵn; chỉ gọi kết nối được chọn", async () => {
      await ingestLog(
        env.DB,
        { id: "wh-1", at: "2026-09-21T08:00:00.000Z", amount: 200000, direction: "in", accountNo: "0011yyyyyyy", content: null, refCode: null, referenceNumber: "FT-t2", raw: {} },
        "webhook",
        now,
        "sepay-wife",
      );
      const data = { "wife-token-0002": [tx("t1", "0011yyyyyyy"), tx("t2", "0011yyyyyyy")] };
      const calls: { token: string; url: URL }[] = [];
      const body = { connection_id: "sepay-wife", from: "2026-09-21", to: "2026-09-22" };
      const first = await syncSepayRange(env, body, now, companies(data, calls));
      expect(first).toMatchObject({ added: 1, duplicates: 1, errors: [] });
      expect(calls.map((c) => [c.token, c.url.searchParams.get("transaction_date_from"), c.url.searchParams.get("transaction_date_to")])).toEqual([
        ["wife-token-0002", "2026-09-21 00:00:00", "2026-09-22 23:59:59"],
      ]);
      const second = await syncSepayRange(env, body, now, companies(data, []));
      expect(second).toMatchObject({ added: 0, duplicates: 2, perConnection: [{ id: "sepay-wife", added: 0, duplicates: 2, error: null }] });
      expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs").get()).toEqual({ n: 2 });
    });

    it("khoảng ngày vắt qua ngày mở sổ: giao dịch trước mốc lưu 'ignored', đếm riêng beforeOpening, không vào sổ, không làm lệch số dư theo log (ADR-76)", async () => {
      raw.prepare("UPDATE accounts SET opening_balance = 35906, opened_at = '2026-10-01' WHERE id = 'vcb-wife'").run();
      const data = {
        "wife-token-0002": [
          tx("t-28", "0011yyyyyyy", { transaction_date: "2026-09-28 09:00:00", amount_in: 50000 }),
          tx("t-30", "0011yyyyyyy", { transaction_date: "2026-09-30 23:59:00", transfer_type: "out", amount_in: 0, amount_out: 24400 }),
          tx("t-01", "0011yyyyyyy", { transaction_date: "2026-10-01 00:00:00", transfer_type: "out", amount_in: 0, amount_out: 10000 }),
        ],
      };
      const body = { connection_id: "sepay-wife", from: "2026-09-28", to: "2026-10-02" };
      const first = await syncSepayRange(env, body, now, companies(data, []));
      expect(first).toMatchObject({ added: 1, duplicates: 0, beforeOpening: 2, perConnection: [{ id: "sepay-wife", added: 1, beforeOpening: 2 }] });
      expect(raw.prepare("SELECT id, status FROM bank_logs ORDER BY at").all()).toEqual([
        { id: "t-28", status: "ignored" },
        { id: "t-30", status: "ignored" },
        { id: "t-01", status: "pending" },
      ]);
      expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE log_id IS NOT NULL").get()).toEqual({ n: 0 });
      expect(raw.prepare("SELECT feed_balance, pending_count FROM v_account_logs WHERE account_id = 'vcb-wife'").get()).toEqual({ feed_balance: 35906 - 10000, pending_count: 1 });
      // Chạy lại: mọi giao dịch đã có (kể cả hai khoản trước mốc).
      const second = await syncSepayRange(env, body, now, companies(data, []));
      expect(second).toMatchObject({ added: 0, duplicates: 3, beforeOpening: 0 });
    });
  });
});

describe("cron/pending-notifier — gom log pending ≥ 60 giây", () => {
  const parsed = (over: Partial<ParsedBankLog>): ParsedBankLog => ({
    id: "z1",
    at: "2026-09-22T02:00:00.000Z",
    amount: 400_000,
    direction: "out",
    accountNo: "0011xxxxxxx",
    content: null,
    refCode: null,
    referenceNumber: null,
    raw: {},
    ...over,
  });

  beforeEach(() => {
    raw.prepare("UPDATE members SET tg_chat_id = 'chat-husband' WHERE id = 'husband'").run();
    env = { ...env, TG_BOT_TOKEN: "tg-token" };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chuyển nội bộ 2 chân về cách nhau 20 giây → ghép cặp trước khi cron chạy, không có tin 'cần gán'", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const t0 = new Date("2026-09-22T02:00:00.000Z");
    await ingestLog(env.DB, parsed({ id: "leg-a", direction: "out", accountNo: "0011xxxxxxx", at: t0.toISOString() }), "webhook", t0);
    const t1 = new Date(t0.getTime() + 20_000);
    await ingestLog(env.DB, parsed({ id: "leg-b", direction: "in", accountNo: "1903xxxxxxx", at: t1.toISOString() }), "webhook", t1);

    await notifyPendingLogs(env, new Date(t0.getTime() + 70_000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("báo đúng một lần cho log pending đủ 60 giây, không báo lại lần sau", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const t0 = new Date("2026-09-22T02:00:00.000Z");
    await ingestLog(env.DB, parsed({ id: "lone", direction: "in", accountNo: "0011xxxxxxx", content: "nguoi la chuyen tien", at: t0.toISOString() }), "webhook", t0);

    await notifyPendingLogs(env, new Date(t0.getTime() + 65_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await notifyPendingLogs(env, new Date(t0.getTime() + 140_000));
    expect(fetchMock).toHaveBeenCalledTimes(1); // không gửi lại cho log đã báo
  });

  it("Telegram lỗi thì lần chạy sau báo lại; báo được rồi thì thôi", async () => {
    const failing = vi.fn(async () => new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", failing);
    const t0 = new Date("2026-09-22T02:00:00.000Z");
    await ingestLog(env.DB, parsed({ id: "lo", direction: "in", accountNo: "0011xxxxxxx", content: "nguoi la", at: t0.toISOString() }), "webhook", t0);
    await notifyPendingLogs(env, new Date(t0.getTime() + 65_000));
    expect(failing).toHaveBeenCalled();

    const working = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", working);
    await notifyPendingLogs(env, new Date(t0.getTime() + 125_000));
    expect(working).toHaveBeenCalledTimes(1);
    await notifyPendingLogs(env, new Date(t0.getTime() + 185_000));
    expect(working).toHaveBeenCalledTimes(1);
  });

  it("tên tài khoản được escape trước khi vào tin HTML", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    raw.prepare("UPDATE accounts SET name = '<b>VCB</b> & co' WHERE id = 'vcb-husband'").run();
    const t0 = new Date("2026-09-22T02:00:00.000Z");
    await ingestLog(env.DB, parsed({ id: "esc", direction: "in", accountNo: "0011xxxxxxx", content: "x", at: t0.toISOString() }), "webhook", t0);
    await notifyPendingLogs(env, new Date(t0.getTime() + 65_000));
    const text = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)).text as string;
    expect(text).toContain("&lt;b&gt;VCB&lt;/b&gt; &amp; co");
  });

  it("chưa đủ 60 giây thì chưa báo", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const t0 = new Date("2026-09-22T02:00:00.000Z");
    await ingestLog(env.DB, parsed({ id: "moi", direction: "in", accountNo: "0011xxxxxxx", content: "vua ve", at: t0.toISOString() }), "webhook", t0);

    await notifyPendingLogs(env, new Date(t0.getTime() + 30_000));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
