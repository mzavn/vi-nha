import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { payCycleMessage } from "../src/notify/format";
import { notifyPayCycle, payCycleNotice } from "../src/notify/pay-cycle";
import { ingestLog, parseWebhookPayload } from "../src/services/ingest";
import { createEntry } from "../src/services/ledger";
import { pushPayload } from "../src/services/push";
import { asD1 } from "./helpers/d1-sqlite";
import { AT, householdC } from "./helpers/household-c";

// Báo kỳ lương mới (notify UC-412) trên hộ mẫu C: lương 20.000.000 về tài khoản chính 08:00 10/11 → kỳ mới, 5 việc (UC-1206 AC-1).

let db: DatabaseSync;
let env: Env;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db = householdC();
  db.exec(`
    UPDATE members SET tg_chat_id = '111' WHERE id = 'husband';
    UPDATE members SET tg_chat_id = '222' WHERE id = 'wife';
    UPDATE accounts SET sepay_enabled = 1, sepay_connection_id = 'default' WHERE id = 'main';
    UPDATE rules SET income_stream_id = 'salary' WHERE pattern = 'LUONG THANG';
  `);
  env = { DB: asD1(db), TG_BOT_TOKEN: "test-token", SEPAY_API_KEY: "sepay-key", API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AT("2026-11-10T08:00:30")));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const telegram = () => fetchMock.mock.calls.map(([, opts]) => JSON.parse((opts as RequestInit).body as string) as { chat_id: string; text: string });
const sentCount = () => (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'pay_cycle'").get() as { n: number }).n;

/** Payload webhook SePay: tiền vào tài khoản chính (số tài khoản 1110001). */
const salaryLog = (id: number, vnAt: string, amount: number, content = "LUONG THANG 11") => ({
  id,
  gateway: "VCB",
  transactionDate: vnAt,
  accountNumber: "1110001",
  subAccount: null,
  transferType: "in",
  transferAmount: amount,
  accumulated: 0,
  code: null,
  content,
  referenceCode: `FT${id}`,
  description: content,
});

const webhook = (body: unknown) =>
  app.request("/webhooks/sepay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Apikey sepay-key" }, body: JSON.stringify(body) }, env);

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(
    path,
    { method, headers: { Authorization: "Bearer tok", "X-Member-Id": "husband", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as { ok: boolean; data: { effects?: { cycle: unknown } } } };
};

const FULL_C = [
  "💵 Lương về 20.000.000 ₫ — kỳ lương mới từ 10/11",
  "Việc ngày lương (5):",
  "☑️ Trích Tích luỹ 10% · 2.000.000 ₫",
  "☑️ Nạp Học phí · 2.000.000 ₫",
  "☑️ Nạp Bảo dưỡng xe · 760.000 ₫",
  "☑️ Dư kỳ trước 1.200.000 ₫: 600.000 ₫ vào Tích luỹ",
  "☑️ Dư kỳ trước 1.200.000 ₫: 600.000 ₫ vào Ví Thưởng",
  "Mở app › Hôm nay để làm — có mã QR chuyển khoản",
].join("\n");

describe("báo kỳ lương mới (notify UC-412)", () => {
  it("UC-412 AC-1: lương 20.000.000 về qua webhook 10/11 08:00 → mỗi người một tin 💵 + 5 việc đúng chữ thẻ việc, câu QR; 2 dòng notifications(pay_cycle, 2026-11-10); bản ngắn \"Lương về · 5 việc\" mở /#today", async () => {
    expect((await webhook(salaryLog(5001, "2026-11-10 08:00:00", 20_000_000))).status).toBe(200);

    const sent = telegram();
    expect(sent.map((s) => s.chat_id).sort()).toEqual(["111", "222"]);
    expect(sent[0]!.text).toBe(FULL_C);
    expect(sent[1]!.text).toBe(FULL_C);
    expect(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'pay_cycle' AND day_key = '2026-11-10'").get()).toEqual({ n: 2 });

    const notice = (await payCycleNotice(env.DB, "2026-11-10", new Date()))!;
    expect(notice.push.title).toBe("Lương về · 5 việc");
    expect(notice.push.body.startsWith("Trích Tích luỹ 10% 2.000.000")).toBe(true);
    expect(Array.from(notice.push.body).length).toBeLessThanOrEqual(150);
    expect(pushPayload("pay_cycle", notice.push)).toMatchObject({ title: "Lương về · 5 việc", url: "/#today", tag: "pay_cycle" });
  });

  it("UC-412 AC-1: nhà không tài khoản nào có số tài khoản, lương nhập ở màn Nhập → câu cuối \"Mở app › Hôm nay để làm\", không câu QR", async () => {
    db.exec("UPDATE accounts SET account_no = NULL, sepay_enabled = 0");
    const r = await api("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "main", income_stream_id: "salary", at: AT("2026-11-10T08:00:00") });
    expect(r.status).toBe(201);
    const lines = telegram()[0]!.text.split("\n");
    expect(lines[1]).toBe("Việc ngày lương (5):");
    expect(lines[lines.length - 1]).toBe("Mở app › Hôm nay để làm");
  });

  it("UC-412 AC-1: chuyển 2.600.000 sang tài khoản tích luỹ ghi trước lúc log lương về chậm → ① và ④-Tích luỹ đã tự xong, tin chỉ 3 việc, tiêu đề \"Lương về · 3 việc\"", async () => {
    db.prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, week_key, month_key, source)
       VALUES (?, 2600000, 'transfer', 'main', 'savings', '2026-W46', '2026-11', 'manual')`,
    ).run(AT("2026-11-10T08:30:00"));
    vi.setSystemTime(new Date(AT("2026-11-10T09:00:00")));
    expect((await webhook(salaryLog(5002, "2026-11-10 08:00:00", 20_000_000))).status).toBe(200);

    expect(telegram()[0]!.text.split("\n")).toEqual([
      "💵 Lương về 20.000.000 ₫ — kỳ lương mới từ 10/11",
      "Việc ngày lương (3):",
      "☑️ Nạp Học phí · 2.000.000 ₫",
      "☑️ Nạp Bảo dưỡng xe · 760.000 ₫",
      "☑️ Dư kỳ trước 1.200.000 ₫: 600.000 ₫ vào Ví Thưởng",
      "Mở app › Hôm nay để làm — có mã QR chuyển khoản",
    ]);
    expect((await payCycleNotice(env.DB, "2026-11-10", new Date()))!.push.title).toBe("Lương về · 3 việc");
  });

  it("UC-412 AC-1: log lương không khớp rule, người Gán thành khoản lương mở kỳ → báo kỳ lương mới", async () => {
    await webhook(salaryLog(5003, "2026-11-10 08:00:00", 20_000_000, "CK TU CONG TY ABC"));
    expect(telegram()).toHaveLength(0);
    const { id } = db.prepare("SELECT id FROM bank_logs WHERE reference_number = 'FT5003'").get() as { id: string };
    const r = await api("POST", `/v1/logs/${id}/assign`, { splits: [{ meaning: "income", amount: 20_000_000, income_stream_id: "salary" }] });
    expect(r.status).toBe(201);
    expect(telegram().map((s) => s.text)).toEqual([FULL_C, FULL_C]);
  });

  it("UC-412 AC-2: đã báo → lương thứ hai nhập vào kỳ; gỡ gán rồi Gán lại khoản lương; rà soát đêm / Đồng bộ lịch sử mở kỳ 10/12 → không tin nào thêm", async () => {
    await webhook(salaryLog(5001, "2026-11-10 08:00:00", 20_000_000));
    expect(telegram()).toHaveLength(2);

    // Lương thứ hai nhập vào kỳ đã có.
    vi.setSystemTime(new Date(AT("2026-11-20T09:00:00")));
    await webhook(salaryLog(5010, "2026-11-20 09:00:00", 5_000_000, "LUONG THANG 11 BO SUNG"));
    expect(db.prepare("SELECT COUNT(*) AS n FROM pay_cycles WHERE status = 'active' AND payday = '2026-11-10'").get()).toEqual({ n: 1 });

    // Huỷ (gỡ gán) rồi ghi lại khoản lương 20.000.000: kỳ cùng ngày lương mở lại, không báo lại.
    const { id: txId, log_id: logId } = db.prepare("SELECT id, log_id FROM transactions WHERE log_id IN (SELECT id FROM bank_logs WHERE reference_number = 'FT5001')").get() as { id: number; log_id: string };
    expect((await api("POST", `/v1/logs/transactions/${txId}/void`)).status).toBe(200);
    const r = await api("POST", `/v1/logs/${logId}/assign`, { splits: [{ meaning: "income", amount: 20_000_000, income_stream_id: "salary" }] });
    expect(r.json.data.effects?.cycle).toMatchObject({ opened: true, payday: "2026-11-10" });

    // Log lương về muộn được rà soát 02:00 (cùng nhánh ghi với "Đồng bộ lịch sử SePay") mở kỳ 2026-12-10.
    vi.setSystemTime(new Date(AT("2026-12-11T02:00:00")));
    const late = await ingestLog(env.DB, parseWebhookPayload(salaryLog(5020, "2026-12-10 08:00:00", 20_000_000)), "backfill", new Date(), "default");
    expect(late.cycleOpened).toBe("2026-12-10");
    expect(db.prepare("SELECT COUNT(*) AS n FROM pay_cycles WHERE status = 'active' AND payday = '2026-12-10'").get()).toEqual({ n: 1 });

    expect(telegram()).toHaveLength(2);
    expect(sentCount()).toBe(2);
  });

  it("UC-412: kỳ void hoặc chưa có kỳ của ngày lương đó → notifyPayCycle không gửi", async () => {
    await notifyPayCycle(env, "2026-11-10"); // kỳ hiện tại vẫn là 10/10
    db.exec("UPDATE accounts SET sepay_enabled = 0 WHERE id = 'main'");
    await createEntry(env.DB, { meaning: "income", amount: 20_000_000, income_stream_id: "salary", account_id: "main", at: AT("2026-11-10T08:00:00") }, null, new Date());
    db.exec("UPDATE pay_cycles SET status = 'void' WHERE payday = '2026-11-10'");
    await notifyPayCycle(env, "2026-11-10");
    expect(telegram()).toHaveLength(0);
    expect(sentCount()).toBe(0);
  });

  it("UC-412 AC-3: kỳ mở với dư kỳ trước −300.000 và hai việc → \"Kỳ trước tiêu quá 300.000 ₫ — không có gì để chia\"; tên mục tiêu escape HTML ở bản đầy đủ, giữ chữ thật ở bản ngắn", async () => {
    db.exec(`
      UPDATE accounts SET opening_balance = -300000, sepay_enabled = 0 WHERE id = 'main';
      UPDATE reserve_goals SET name = 'Học <phí>' WHERE id = 'school';
      UPDATE reserve_goals SET target_amount = 1000000 WHERE id = 'car';
    `);
    const r = await api("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "main", income_stream_id: "salary", at: AT("2026-11-10T08:00:00") });
    expect(r.status).toBe(201);
    expect(telegram()[0]!.text.split("\n")).toEqual([
      "💵 Lương về 20.000.000 ₫ — kỳ lương mới từ 10/11",
      "Việc ngày lương (2):",
      "☑️ Trích Tích luỹ 10% · 2.000.000 ₫",
      "☑️ Nạp Học &lt;phí&gt; · 2.000.000 ₫",
      "Kỳ trước tiêu quá 300.000 ₫ — không có gì để chia",
      "Mở app › Hôm nay để làm — có mã QR chuyển khoản",
    ]);
    expect((await payCycleNotice(env.DB, "2026-11-10", new Date()))!.push).toEqual({
      title: "Lương về · 2 việc",
      body: "Trích Tích luỹ 10% 2.000.000 · Nạp Học <phí> 2.000.000",
    });
  });

  it("UC-412: nhà một tài khoản chưa có tài khoản Tích luỹ (dư kỳ trước 0) → ① vẫn là việc đang mở: \"Lương về · 1 việc\", dòng ① đúng chữ thẻ việc kèm câu nhắc mở tài khoản, không câu QR (pocket UC-1206 AC-10)", async () => {
    db.exec(`
      UPDATE reserve_goals SET active = 0;
      DELETE FROM config WHERE k = 'surplus_reward_account';
      UPDATE accounts SET active = 0 WHERE id <> 'main';
      UPDATE accounts SET opening_balance = 0 WHERE id = 'main';
    `);
    expect((await webhook(salaryLog(5030, "2026-11-10 08:00:00", 20_000_000))).status).toBe(200);
    expect(telegram()[0]!.text.split("\n")).toEqual([
      "💵 Lương về 20.000.000 ₫ — kỳ lương mới từ 10/11",
      "Việc ngày lương (1):",
      "☑️ Trích Tích luỹ 10% · chưa có tài khoản Tích luỹ — mở tài khoản thật ›",
      "Mở app › Hôm nay để làm",
    ]);
    expect((await payCycleNotice(env.DB, "2026-11-10", new Date()))!.push).toEqual({ title: "Lương về · 1 việc", body: "Trích Tích luỹ 10% 2.000.000" });
  });

  it("UC-1206 AC-10: nhà một tài khoản 12.000.000 trước lương, không tài khoản Tích luỹ, không Ví Thưởng → tin \"Lương về · 2 việc\", hai dòng ☑️ đúng chữ thẻ ① và ④ → Tích luỹ kèm câu nhắc mở tài khoản", async () => {
    db.exec(`
      UPDATE reserve_goals SET active = 0;
      DELETE FROM config WHERE k = 'surplus_reward_account';
      UPDATE accounts SET active = 0 WHERE id <> 'main';
      UPDATE accounts SET opening_balance = 12000000 WHERE id = 'main';
    `);
    expect((await webhook(salaryLog(5031, "2026-11-10 08:00:00", 20_000_000))).status).toBe(200);
    expect(telegram()[0]!.text.split("\n")).toEqual([
      "💵 Lương về 20.000.000 ₫ — kỳ lương mới từ 10/11",
      "Việc ngày lương (2):",
      "☑️ Trích Tích luỹ 10% · chưa có tài khoản Tích luỹ — mở tài khoản thật ›",
      "☑️ Dư kỳ trước 12.000.000 ₫: 6.000.000 ₫ vào Tích luỹ · chưa có tài khoản Tích luỹ — mở tài khoản thật ›",
      "Mở app › Hôm nay để làm",
    ]);
    expect((await payCycleNotice(env.DB, "2026-11-10", new Date()))!.push.title).toBe("Lương về · 2 việc");
  });

  it("UC-412 AC-4: lương 20.000.000 về VCB (vợ) — riêng tư của vợ, vợ còn hoạt động → vợ và chồng nhận cùng tin không số tiền; lương về tài khoản công khai → như AC-1", async () => {
    db.exec(`
      UPDATE accounts SET active = 1, private = 1, owner_member_id = 'wife', pocket = 'operating', pocket_confirmed = 1, opening_balance = 0, opened_at = '2026-01-01' WHERE id = 'vcb-wife';
      UPDATE accounts SET sepay_enabled = 0 WHERE id = 'main';
    `);
    const r = await app.request(
      "/v1/transactions",
      {
        method: "POST",
        headers: { Authorization: "Bearer tok", "X-Member-Id": "wife", "Content-Type": "application/json" },
        body: JSON.stringify({ meaning: "income", amount: 20_000_000, account_id: "vcb-wife", income_stream_id: "salary", at: AT("2026-11-10T08:00:00") }),
      },
      env,
    );
    expect(r.status).toBe(201);
    const sent = telegram();
    expect(sent.map((s) => s.chat_id).sort()).toEqual(["111", "222"]);
    expect(sent[0]!.text).toBe(sent[1]!.text);
    expect(sent[0]!.text.split("\n")).toEqual([
      "💵 Lương về — kỳ lương mới từ 10/11",
      "Việc ngày lương (5):",
      "☑️ Trích Tích luỹ 10%",
      "☑️ Nạp Học phí",
      "☑️ Nạp Bảo dưỡng xe",
      "☑️ Dư kỳ trước vào Tích luỹ",
      "☑️ Dư kỳ trước vào Ví Thưởng",
      "Mở app › Hôm nay để làm — có mã QR chuyển khoản",
    ]);
    const notice = (await payCycleNotice(env.DB, "2026-11-10", new Date()))!;
    expect(notice.push).toEqual({ title: "Lương về · 5 việc", body: "Trích Tích luỹ 10% · Nạp Học phí · Nạp Bảo dưỡng xe · Dư kỳ trước vào Tích luỹ · Dư kỳ trước vào Ví Thưởng" });
    for (const n of ["20.000.000", "2.000.000", "760.000", "600.000", "1.200.000"]) {
      expect(sent[0]!.text).not.toContain(n);
      expect(notice.push.body).not.toContain(n);
    }

    // Vợ đã tắt: tài khoản không còn bị giấu → tin có số như AC-1.
    db.exec("UPDATE members SET active = 0 WHERE id = 'wife'");
    expect((await payCycleNotice(env.DB, "2026-11-10", new Date()))!.full.split("\n")[0]).toBe("💵 Lương về 20.000.000 ₫ — kỳ lương mới từ 10/11");
  });

  it("UC-412: không việc nào đang mở → tiêu đề \"Lương về · kỳ từ d/m\", không dòng việc", () => {
    const msg = payCycleMessage({ income: 20_000_000, startedAt: AT("2026-11-10T08:00:00"), prevOperating: 0, tasks: [] });
    expect(msg.full).toBe(["💵 Lương về 20.000.000 ₫ — kỳ lương mới từ 10/11", "Mở app › Hôm nay để làm"].join("\n"));
    expect(msg.push.title).toBe("Lương về · kỳ từ 10/11");
  });
});
