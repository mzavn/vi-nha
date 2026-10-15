import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { mondaysInMonth } from "../src/domain/period";
import { allocateIncome } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { MemoryKV } from "./helpers/oauth";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  raw = openDb();
  // Bối cảnh: nhà chưa nối bank feed — mọi tài khoản đều ghi tay (tài khoản đã nối feed thì không nhận nhập tay).
  raw.prepare("UPDATE accounts SET sepay_enabled = 0").run();
  // Seed đặt hạn Du lịch = hôm nay + 3 tháng; ghim lại để số chia không đổi theo ngày chạy test.
  raw.prepare("UPDATE allocations SET target_date = '2026-12-31' WHERE wallet_id = 'travel'").run();
  env = { DB: asD1(raw), OAUTH_KV: new MemoryKV() as unknown as KVNamespace, API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
});

type Json = { ok: boolean; data: any; error?: { code: string; message: string } };

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(
    path,
    {
      method,
      headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json, res };
}

describe("đăng nhập: mật khẩu chung + chọn người", () => {
  const login = (password: string, member_id: string, ip = "203.0.113.7") =>
    app.request(
      "/v1/session",
      { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ password, member_id }) },
      env,
    );
  const failures = () => raw.prepare("SELECT scope, ip, failures FROM auth_failures ORDER BY ip").all();

  it("danh sách người cho màn đăng nhập không cần đăng nhập", async () => {
    const res = await app.request("/v1/session/members", {}, env);
    expect(((await res.json()) as Json).data.map((m: { id: string }) => m.id)).toEqual(["husband", "wife"]);
  });

  it("sai mật khẩu → 401, đúng → cookie dùng được cho /v1", async () => {
    expect((await login("sai", "wife")).status).toBe(401);
    const res = await login("mat-khau-chung", "wife");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/pf_session=.+HttpOnly/i);
    const snap = await app.request("/v1/snapshot", { headers: { Cookie: cookie.split(";")[0]! } }, env);
    expect(snap.status).toBe(200);
  });

  it("cookie bị sửa thì không qua; đổi mật khẩu thì phiên cũ hết hiệu lực", async () => {
    const cookie = (await login("mat-khau-chung", "wife")).headers.get("Set-Cookie")!.split(";")[0]!;
    const forged = cookie.replace("pf_session=wife.", "pf_session=husband.");
    expect((await app.request("/v1/snapshot", { headers: { Cookie: forged } }, env)).status).toBe(401);
    env = { ...env, APP_PASSWORD: "mat-khau-moi" };
    expect((await app.request("/v1/snapshot", { headers: { Cookie: cookie } }, env)).status).toBe(401);
  });

  it("ghi bằng cookie mà không phải JSON thì bị chặn (chống form giả mạo)", async () => {
    const cookie = (await login("mat-khau-chung", "wife")).headers.get("Set-Cookie")!.split(";")[0]!;
    const res = await app.request("/v1/transactions", { method: "POST", headers: { Cookie: cookie, "Content-Type": "text/plain" }, body: "{}" }, env);
    expect(res.status).toBe(415);
  });

  describe("chặn dò mật khẩu (ADR-89)", () => {
    it("sai tới lần thứ 10 trong 15 phút từ một IP → 429 kể cả khi đúng mật khẩu; IP khác vẫn vào được; log đếm, không có mật khẩu", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      raw.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('login', '203.0.113.7', ?, 8)").run(new Date().toISOString());
      expect((await login("sai-lan-9", "wife")).status).toBe(401);
      expect((await login("sai-lan-10", "wife")).status).toBe(401);
      const blocked = await login("mat-khau-chung", "wife");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("Set-Cookie")).toBeNull();
      expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(14 * 60);
      expect(((await blocked.json()) as Json).error).toEqual({ code: "too_many_attempts", message: "Sai mật khẩu quá nhiều lần, thử lại sau 15 phút." });
      expect((await login("mat-khau-chung", "wife", "198.51.100.9")).status).toBe(200);
      const logged = warn.mock.calls.flat().map(String).join("\n");
      expect(logged).toContain("lần 10");
      expect(logged).not.toContain("sai-lan");
      warn.mockRestore();
    });

    it("hết 15 phút thì được thử lại; đăng nhập đúng xoá đếm của IP đó", async () => {
      const old = new Date(Date.now() - 16 * 60_000).toISOString();
      raw.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('login', '203.0.113.7', ?, 10)").run(old);
      expect((await login("mat-khau-chung", "wife")).status).toBe(200);
      expect(failures()).toEqual([]);
      expect((await login("sai", "wife")).status).toBe(401);
      expect(failures()).toEqual([
        { scope: "login", ip: "*", failures: 1 },
        { scope: "login", ip: "203.0.113.7", failures: 1 },
      ]);
    });

    it("trần chung: 30 lần sai từ nhiều IP trong 15 phút thì mọi IP tạm không đăng nhập được", async () => {
      raw.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('login', '*', ?, 29)").run(new Date().toISOString());
      expect((await login("mat-khau-chung", "wife", "198.51.100.9")).status).toBe(200);
      expect((await login("sai", "wife", "192.0.2.1")).status).toBe(401);
      expect((await login("mat-khau-chung", "wife", "198.51.100.9")).status).toBe(429);
    });
  });

  describe("đăng xuất mọi máy (ADR-89)", () => {
    const cookieOf = async (member: string) => (await login("mat-khau-chung", member)).headers.get("Set-Cookie")!.split(";")[0]!;
    const snapshotWith = async (cookie: string) => (await app.request("/v1/snapshot", { headers: { Cookie: cookie } }, env)).status;
    const revokeAll = (headers: Record<string, string>) =>
      app.request("/v1/session/revoke-all", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" }, env);

    it("mọi cookie đã phát (mọi người, cả máy đang bấm) hết hiệu lực; đăng nhập lại được; API token không bị ảnh hưởng", async () => {
      const wife = await cookieOf("wife");
      const husband = await cookieOf("husband");
      const res = await revokeAll({ Cookie: wife });
      expect(res.status).toBe(200);
      expect(res.headers.get("Set-Cookie")).toMatch(/pf_session=;/);
      expect(await snapshotWith(wife)).toBe(401);
      expect(await snapshotWith(husband)).toBe(401);
      expect(((await (await app.request("/v1/session", { headers: { Cookie: husband } }, env)).json()) as Json).data.member).toBeNull();
      expect(await snapshotWith(await cookieOf("wife"))).toBe(200);
      expect((await call("GET", "/v1/snapshot")).status).toBe(200);
      // Bấm lần nữa (qua API token) thì cookie phát sau lần đầu cũng hết.
      const again = await cookieOf("husband");
      expect((await revokeAll({ Authorization: "Bearer tok" })).status).toBe(200);
      expect(await snapshotWith(again)).toBe(401);
    });

    it("cần đăng nhập: không cookie, cookie giả hay gửi form thường đều bị chặn, phiên không đổi", async () => {
      const wife = await cookieOf("wife");
      expect((await revokeAll({})).status).toBe(401);
      expect((await revokeAll({ Cookie: wife.replace("pf_session=wife.", "pf_session=husband.") })).status).toBe(401);
      const form = await app.request("/v1/session/revoke-all", { method: "POST", headers: { Cookie: wife, "Content-Type": "application/x-www-form-urlencoded" }, body: "" }, env);
      expect(form.status).toBe(415);
      expect(await snapshotWith(wife)).toBe(200);
    });
  });
});

describe("nhập tay", () => {
  it("chi tiền mặt: ví tự điền từ danh mục, tài khoản mặc định là tiền mặt của người nhập, trả về ví còn bao nhiêu", async () => {
    const { status, json } = await call("POST", "/v1/transactions", { meaning: "spend", amount: 200_000, category_id: "fuel-parking" }, { "X-Member-Id": "wife" });
    expect(status).toBe(201);
    expect(json.data.tx).toMatchObject({ counter_wallet_id: "transport", account_id: "cash-wife", category_id: "fuel-parking", by_member_id: "wife", source: "manual" });
    expect(json.data.wallet).toMatchObject({ walletId: "transport", weekRemaining: -200_000 }); // chưa chia lương nên ví đang 0
  });

  it("vợ chọn danh mục trỏ về ví Chơi của chồng → tự đổi sang ví Chơi của vợ", async () => {
    const { json } = await call("POST", "/v1/transactions", { meaning: "spend", amount: 50_000, category_id: "hangouts" }, { "X-Member-Id": "wife" });
    expect(json.data.tx.counter_wallet_id).toBe("fun-wife");
  });

  it("gửi lại cùng client_id (hàng đợi offline) chỉ ghi một lần", async () => {
    const entry = { meaning: "spend", amount: 35_000, category_id: "eating-out", client_id: "c-2f9a8b7e-0001" };
    const first = await call("POST", "/v1/transactions", entry);
    const again = await call("POST", "/v1/transactions", entry);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.json.data).toMatchObject({ duplicate: true, tx: { id: first.json.data.tx.id } });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE client_id = 'c-2f9a8b7e-0001'").get()).toEqual({ n: 1 });
  });

  it.each([
    [{ meaning: "spend", amount: 1000 }, "missing_category"],
    [{ meaning: "spend", amount: 1000.5, category_id: "groceries" }, "invalid_input"],
    [{ meaning: "spend", amount: -5, category_id: "groceries" }, "invalid_amount"],
    [{ meaning: "spend", amount: 1000, category_id: "khong-co" }, "unknown_category"],
    [{ meaning: "spend", amount: 1000, category_id: "groceries", wallet_id: "wealth-building" }, "locked_wallet"],
    [{ meaning: "transfer", amount: 1000, account_id: "vcb-husband", to_account_id: "vcb-husband" }, "same_account"],
    [{ meaning: "transfer", amount: 1000, account_id: "tcb-husband", to_account_id: "vcb-husband", wallet_id: "food", from_wallet_id: "wealth-building" }, "locked_wallet"],
    [{ meaning: "buy_asset", amount: 1000, asset_kind: "gold" }, "insufficient_cash"],
    [{ meaning: "fund", amount: 1000 }, "invalid_input"],
    [{ meaning: "spend", amount: 1000, category_id: "groceries", at: "2099-01-01" }, "future_at"],
  ])("từ chối đầu vào sai: %j → %s", async (entry, code) => {
    const { status, json } = await call("POST", "/v1/transactions", entry);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(json.error?.code).toBe(code);
  });

  it("rút ATM là chuyển nội bộ: không đổi số dư ví, chỉ đổi tiền nằm ở đâu", async () => {
    await call("POST", "/v1/transactions", { meaning: "transfer", amount: 2_000_000, account_id: "vcb-husband", to_account_id: "cash-husband" });
    const books = raw.prepare("SELECT account_id, book_balance FROM v_account_book WHERE account_id IN ('vcb-husband','cash-husband') ORDER BY account_id").all();
    expect(books).toEqual([
      { account_id: "cash-husband", book_balance: 2_000_000 },
      { account_id: "vcb-husband", book_balance: -2_000_000 },
    ]);
    expect(raw.prepare("SELECT COUNT(*) n FROM v_wallet_balance WHERE balance <> 0").get()).toEqual({ n: 0 });
  });

  it("huỷ giao dịch là đổi trạng thái, không xoá; huỷ lần hai báo lỗi", async () => {
    const { json } = await call("POST", "/v1/transactions", { meaning: "spend", amount: 10_000, category_id: "groceries" });
    const id = json.data.tx.id;
    expect((await call("POST", `/v1/transactions/${id}/void`)).json.data.status).toBe("void");
    expect((await call("POST", `/v1/transactions/${id}/void`)).status).toBe(409);
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE id = ?").get(id)).toEqual({ n: 1 });
  });
});

describe("số dư đầu là mốc: không ghi giao dịch trước ngày mở sổ (ADR-76)", () => {
  beforeEach(() => {
    raw.prepare("UPDATE accounts SET opened_at = '2026-10-01', opening_balance = 35906 WHERE id = 'cash-wife'").run();
  });
  const MSG = "Ngày này trước ngày mở sổ của tài khoản Tiền mặt (vợ) (1/10/2026) — số dư đầu đã tính khoản này.";

  it("nhập tay ngày trước mốc (theo giờ VN) → 400 before_opening, sổ không đổi; đúng ngày mở sổ thì ghi được", async () => {
    const spend = (at: string) => call("POST", "/v1/transactions", { meaning: "spend", amount: 24_400, category_id: "groceries", account_id: "cash-wife", at }, { "X-Member-Id": "wife" });
    const before = await spend("2026-09-30T23:59:00+07:00");
    expect(before.status).toBe(400);
    expect(before.json.error).toEqual({ code: "before_opening", message: MSG });
    expect(raw.prepare("SELECT book_balance FROM v_account_book WHERE account_id = 'cash-wife'").get()).toEqual({ book_balance: 35906 });
    // 17:00 UTC ngày 30/9 là 00:00 ngày 1/10 giờ VN — đã tới ngày mở sổ.
    expect((await spend("2026-09-30T17:00:00.000Z")).status).toBe(201);
  });

  it("tài khoản ở đầu nhận của chuyển khoản cũng bị chặn; sửa một khoản sang ngày trước mốc cũng bị chặn", async () => {
    const transfer = await call("POST", "/v1/transactions", { meaning: "transfer", amount: 50_000, account_id: "vcb-husband", to_account_id: "cash-wife", at: "2026-09-28T10:00:00+07:00" });
    expect(transfer.json.error?.code).toBe("before_opening");
    const ok = await call("POST", "/v1/transactions", { meaning: "spend", amount: 10_000, category_id: "groceries", account_id: "cash-wife", at: "2026-10-02T10:00:00+07:00" }, { "X-Member-Id": "wife" });
    const moved = await call("POST", `/v1/transactions/${ok.json.data.tx.id}/replace`, { meaning: "spend", amount: 10_000, category_id: "groceries", account_id: "cash-wife", at: "2026-09-29T10:00:00+07:00" }, { "X-Member-Id": "wife" });
    expect(moved.status).toBe(400);
    expect(moved.json.error?.code).toBe("before_opening");
    expect(raw.prepare("SELECT status FROM transactions WHERE id = ?").get(ok.json.data.tx.id)).toEqual({ status: "active" });
  });

  it("tài khoản không có ngày mở sổ và chuyển ngân sách giữa hai ví (không chạm tài khoản) không bị chặn", async () => {
    const old = await call("POST", "/v1/transactions", { meaning: "spend", amount: 10_000, category_id: "groceries", account_id: "cash-husband", at: "2020-01-01T10:00:00+07:00" });
    expect(old.status).toBe(201);
    const budget = await call("POST", "/v1/transactions", { meaning: "transfer", amount: 10_000, from_wallet_id: "food", wallet_id: "transport", at: "2020-01-01T10:00:00+07:00" });
    expect(budget.status).toBe(201);
  });
});

describe("chia lương end-to-end", () => {
  async function salary(amount: number, at = "2026-09-10T09:00:00+07:00", account_id = "vcb-husband") {
    const { json } = await call("POST", "/v1/transactions", { meaning: "income", amount, account_id, at });
    return json.data.tx.id as number;
  }

  it("preview không ghi gì; allocate ghi đúng các fund và lệnh chuyển tiền", async () => {
    const preview = await call("POST", "/v1/allocate/preview", { amount: 40_000_000, at: "2026-09-10T09:00:00+07:00", account_id: "vcb-husband" });
    expect(preview.json.data.funds).toContainEqual({ walletId: "wealth-building", amount: 12_000_000 });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning = 'fund'").get()).toEqual({ n: 0 });

    const id = await salary(40_000_000);
    const { status, json } = await call("POST", "/v1/allocate", { income_tx_id: id });
    expect(status).toBe(201);
    expect(json.data.batchId).toBe(`A${id}`);
    const balances = Object.fromEntries(
      (raw.prepare("SELECT wallet_id, balance FROM v_wallet_balance").all() as { wallet_id: string; balance: number }[]).map((r) => [r.wallet_id, r.balance]),
    );
    expect(balances).toMatchObject({ "income": 0, "wealth-building": 12_000_000, "nice-to-have": expect.any(Number) });
    // Tích sản trú ở TCB, Thu nhập về VCB → một lệnh chuyển VCB → TCB đúng 12tr, nội dung là mã ngẫu nhiên PF XXXXXX
    const orders = raw.prepare("SELECT from_account_id, to_account_id, amount, memo FROM transfer_orders WHERE to_account_id = 'tcb-husband'").all();
    expect(orders).toEqual([{ from_account_id: "vcb-husband", to_account_id: "tcb-husband", amount: 12_000_000, memo: expect.stringMatching(/^PF [A-Z2-9]{6}$/) }]);
  });

  it("lệnh chuyển tiền nói tiền đi cho ví nào: danh sách kèm tên các ví nhận trong lô ở tài khoản đích", async () => {
    const id = await salary(40_000_000);
    await call("POST", "/v1/allocate", { income_tx_id: id });
    const { json } = await call("GET", "/v1/transfer-orders?status=pending");
    const toTcb = json.data.find((o: { to_account_id: string }) => o.to_account_id === "tcb-husband");
    expect(toTcb).toMatchObject({ from_name: expect.any(String), to_name: expect.any(String), amount: 12_000_000, wallet_names: "Tích sản" });
  });

  it("một khoản thu không bao giờ được chia hai lần", async () => {
    const id = await salary(30_000_000);
    expect((await call("POST", "/v1/allocate", { income_tx_id: id })).status).toBe(201);
    const again = await call("POST", "/v1/allocate", { income_tx_id: id });
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("already_allocated");
    expect(raw.prepare("SELECT SUM(amount) s FROM transactions WHERE meaning = 'fund'").get()).toEqual({ s: 30_000_000 });
  });

  it("huỷ khoản thu đã chia thì gỡ luôn lần chia: ví về như cũ, lệnh chuyển chưa làm bị bỏ, không chia lại được", async () => {
    const id = await salary(10_000_000);
    await call("POST", "/v1/allocate", { income_tx_id: id });
    const res = await call("POST", `/v1/transactions/${id}/void`);
    expect(res.json.data.status).toBe("void");
    expect(raw.prepare("SELECT COUNT(*) n FROM v_wallet_balance WHERE balance <> 0").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT DISTINCT status FROM transfer_orders").all()).toEqual([{ status: "skipped" }]);
    expect((await call("POST", "/v1/allocate", { income_tx_id: id })).status).toBeGreaterThanOrEqual(400);
  });

  it("tiền của lần chia đã chuyển thật thì không huỷ khoản thu được", async () => {
    const id = await salary(10_000_000);
    await call("POST", "/v1/allocate", { income_tx_id: id });
    const order = raw.prepare("SELECT id FROM transfer_orders LIMIT 1").get() as { id: number };
    await call("POST", `/v1/transfer-orders/${order.id}/done`);
    const res = await call("POST", `/v1/transactions/${id}/void`);
    expect(res.json.error?.code).toBe("allocation_settled");
    expect(raw.prepare("SELECT status FROM transactions WHERE id = ?").get(id)).toEqual({ status: "active" });
  });

  it("snapshot: còn để chi tuần này và phe Tích sản ra đúng sau khi chia + chi", async () => {
    const id = await salary(40_000_000, new Date().toISOString());
    await call("POST", "/v1/allocate", { income_tx_id: id });
    await call("POST", "/v1/transactions", { meaning: "spend", amount: 125_000, category_id: "groceries" });
    const { json } = await call("GET", "/v1/snapshot");
    expect(json.data.tiers.wealth_building).toMatchObject({ balance: 12_000_000, cash: 12_000_000, assets: 0 });
    const an = json.data.spendableByWallet.find((w: { walletId: string }) => w.walletId === "food");
    expect(an.amount).toBe(625_000 - 125_000);
    expect(json.data.safetyFund.estimated).toBe(true);
  });

  it("GET /v1/wealth-building: cùng số Tích sản với snapshot, nguồn chia lương là 'fund'; đường cũ → 404", async () => {
    const id = await salary(40_000_000, new Date().toISOString());
    await call("POST", "/v1/allocate", { income_tx_id: id });
    const res = await call("GET", "/v1/wealth-building");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ walletId: "wealth-building", cash: 12_000_000, assets: 0, accounts: [] });
    expect(res.json.data.flows).toEqual([expect.objectContaining({ kind: "fund", direction: "in", amount: 12_000_000 })]);
    expect((await call("GET", "/v1/tichsan")).status).toBe(404);
  });

  it("đếm ví lệch → một bút toán điều chỉnh vào Có-thì-tốt, sổ khớp tiền thật", async () => {
    await call("POST", "/v1/transactions", { meaning: "transfer", amount: 500_000, account_id: "vcb-husband", to_account_id: "cash-husband" });
    const { json } = await call("POST", "/v1/accounts/cash-husband/count", { counted: 450_000 });
    expect(json.data).toEqual({ accountId: "cash-husband", book: 500_000, counted: 450_000, diff: -50_000 });
    expect(raw.prepare("SELECT book_balance FROM v_account_book WHERE account_id = 'cash-husband'").get()).toEqual({ book_balance: 450_000 });
    expect(raw.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = 'nice-to-have'").get()).toEqual({ balance: -50_000 });
  });

  it("ngân sách tháng: phong bì tuần tính theo số thứ Hai thật", async () => {
    const { json } = await call("GET", "/v1/budget?period=2026-11");
    const an = json.data.lines.find((l: { walletId: string }) => l.walletId === "food");
    expect(json.data.weeks).toBe(5);
    expect(an.target).toBe(3_125_000);
    expect((await call("GET", "/v1/budget?period=2026-13")).status).toBe(400);
  });
});

// change 261012-tu-chia: tự chia một khoản thu — số tay cho từng ví thay cho luật nạp.
describe("tự chia một khoản thu (change 261012-tu-chia)", () => {
  const AT = "2026-09-10T09:00:00+07:00";
  // Số mẫu: tổng 19.000.000, đúng 7 ví > 0; Thuế và Du lịch 0 (bỏ qua).
  const AMOUNTS = [
    { wallet_id: "wealth-building", amount: 200_000 },
    { wallet_id: "housing", amount: 7_500_000 },
    { wallet_id: "fun-wife", amount: 1_500_000 },
    { wallet_id: "food", amount: 5_000_000 },
    { wallet_id: "utilities", amount: 1_600_000 },
    { wallet_id: "hometown", amount: 2_700_000 },
    { wallet_id: "transport", amount: 500_000 },
    { wallet_id: "tax", amount: 0 },
    { wallet_id: "travel", amount: 0 },
  ];
  const income = async (amount: number, extra: Record<string, unknown> = {}) =>
    (await call("POST", "/v1/transactions", { meaning: "income", amount, account_id: "vcb-husband", at: AT, ...extra })).json.data.tx.id as number;
  const funds = () => raw.prepare("SELECT wallet_id, amount, counter_wallet_id FROM transactions WHERE meaning = 'fund' AND status = 'active' ORDER BY wallet_id").all();

  it("UC-203 AC-11: ghi đúng các số gửi lên, bỏ luật nạp; lệnh chuyển gộp theo tài khoản của ví; tổng lệch → amounts_mismatch; ví Thu nhập → invalid_amounts; gọi lại → 409", async () => {
    // Ví Về quê trú ở TCB như Tích sản: hai ví cùng tài khoản đích gộp một lệnh.
    raw.prepare("UPDATE wallets SET account_id = 'tcb-husband' WHERE id = 'hometown'").run();
    // Tắt hết luật nạp: chia theo luật sẽ lỗi cấu hình — tự chia vẫn ghi được, nghĩa là luật không được dùng.
    raw.prepare("UPDATE allocations SET active = 0").run();
    const id = await income(19_000_000);

    const mismatch = await call("POST", "/v1/allocate", {
      income_tx_id: id,
      amounts: AMOUNTS.map((a) => (a.wallet_id === "transport" ? { ...a, amount: 499_000 } : a)),
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.json.error?.code).toBe("amounts_mismatch");
    const holding = await call("POST", "/v1/allocate", { income_tx_id: id, amounts: [...AMOUNTS.slice(1), { wallet_id: "income", amount: 200_000 }] });
    expect(holding.status).toBe(400);
    expect(holding.json.error?.code).toBe("invalid_amounts");
    expect(funds()).toEqual([]);

    const { status, json } = await call("POST", "/v1/allocate", { income_tx_id: id, amounts: AMOUNTS });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ batchId: `A${id}`, underfunded: [], deficitCovered: {} });
    expect(funds()).toEqual(
      AMOUNTS.filter((a) => a.amount > 0)
        .map((a) => ({ wallet_id: a.wallet_id, amount: a.amount, counter_wallet_id: "income" }))
        .sort((a, b) => a.wallet_id.localeCompare(b.wallet_id)),
    );
    expect(raw.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = 'wealth-building'").get()).toEqual({ balance: 200_000 });
    expect(raw.prepare("SELECT to_account_id, amount FROM transfer_orders WHERE batch_id = ? ORDER BY to_account_id").all(`A${id}`)).toEqual([
      { to_account_id: "tcb-husband", amount: 2_900_000 },
      { to_account_id: "vcb-wife", amount: 1_500_000 },
    ]);

    const again = await call("POST", "/v1/allocate", { income_tx_id: id, amounts: AMOUNTS });
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("already_allocated");
  });

  it("UC-203 AC-11: hợp đồng amounts — trùng ví, ví không có, ví đã tắt, số âm / lẻ / chuỗi → invalid_amounts; preview nhận amounts và bỏ qua nguồn thu", async () => {
    raw.prepare("UPDATE wallets SET active = 0 WHERE id = 'nice-to-have'").run();
    const id = await income(1_000_000);
    const bad = [
      [{ wallet_id: "food", amount: 500_000 }, { wallet_id: "food", amount: 500_000 }],
      [{ wallet_id: "khong-co", amount: 1_000_000 }],
      [{ wallet_id: "nice-to-have", amount: 1_000_000 }],
      [{ wallet_id: "food", amount: 1_500_000 }, { wallet_id: "housing", amount: -500_000 }],
      [{ wallet_id: "food", amount: 999_999.5 }, { wallet_id: "housing", amount: 0.5 }],
      [{ wallet_id: "food", amount: "1000000" }],
      "food",
    ];
    for (const amounts of bad) {
      const res = await call("POST", "/v1/allocate", { income_tx_id: id, amounts });
      expect(res.status, JSON.stringify(amounts)).toBe(400);
      expect(res.json.error?.code, JSON.stringify(amounts)).toBe("invalid_amounts");
    }
    expect(funds()).toEqual([]);

    const preview = await call("POST", "/v1/allocate/preview", {
      amount: 19_000_000,
      at: AT,
      account_id: "vcb-husband",
      income_stream_id: "khong-co-nguon-nay",
      amounts: AMOUNTS,
    });
    expect(preview.status).toBe(200);
    expect(preview.json.data.funds).toEqual(AMOUNTS.filter((a) => a.amount > 0).map((a) => ({ walletId: a.wallet_id, amount: a.amount })));
    expect(preview.json.data.transferOrders).toEqual([
      { fromAccountId: "vcb-husband", toAccountId: "tcb-husband", amount: 200_000, walletIds: ["wealth-building"] },
      { fromAccountId: "vcb-husband", toAccountId: "vcb-wife", amount: 1_500_000, walletIds: ["fun-wife"] },
    ]);
    const previewMismatch = await call("POST", "/v1/allocate/preview", { amount: 19_000_001, at: AT, account_id: "vcb-husband", amounts: AMOUNTS });
    expect(previewMismatch.json.error?.code).toBe("amounts_mismatch");
    expect(raw.prepare("SELECT COUNT(*) n FROM transfer_orders").get()).toEqual({ n: 0 });
  });

  it("UC-203 AC-12: nguồn thu khóa 30% Tích sản, tự chia Tích sản 100.000 → ghi đúng 100.000 (số tay thắng phần khóa)", async () => {
    raw.prepare("UPDATE income_stream_locks SET percent = 0.30 WHERE stream_id = 'salary-wife' AND wallet_id = 'wealth-building'").run();
    const id = await income(11_000_000, { income_stream_id: "salary-wife" });
    const res = await call("POST", "/v1/allocate", {
      income_tx_id: id,
      amounts: [
        { wallet_id: "wealth-building", amount: 100_000 },
        { wallet_id: "housing", amount: 10_900_000 },
      ],
    });
    expect(res.status).toBe(201);
    expect(funds()).toEqual([
      { wallet_id: "housing", amount: 10_900_000, counter_wallet_id: "income" },
      { wallet_id: "wealth-building", amount: 100_000, counter_wallet_id: "income" },
    ]);
  });
});

// change 261015-chot-thang-va-keo-tich-san (ADR-112): Có Tích sản (số người chọn) / Không Tích sản (bắt buộc lý do).
describe("Tích sản người chọn khi chia và lý do Tích sản 0", () => {
  const AT = "2026-09-10T09:00:00+07:00";
  const income = async (amount: number, extra: Record<string, unknown> = {}) =>
    (await call("POST", "/v1/transactions", { meaning: "income", amount, account_id: "vcb-husband", at: AT, ...extra })).json.data.tx.id as number;
  const wealthFund = (id: number) => raw.prepare("SELECT amount FROM transactions WHERE meaning = 'fund' AND batch_id = ? AND wallet_id = 'wealth-building'").get(`A${id}`);
  const fundCount = () => raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning = 'fund'").get();
  const runNote = (id: number) => raw.prepare("SELECT wealth_note FROM allocation_runs WHERE income_tx_id = ?").get(id);
  // Tự chia 19.000.000 không có Tích sản.
  const NO_WEALTH = [
    { wallet_id: "housing", amount: 7_700_000 },
    { wallet_id: "fun-wife", amount: 1_500_000 },
    { wallet_id: "food", amount: 5_000_000 },
    { wallet_id: "utilities", amount: 1_600_000 },
    { wallet_id: "hometown", amount: 2_700_000 },
    { wallet_id: "transport", amount: 500_000 },
    { wallet_id: "wealth-building", amount: 0 },
  ];

  it("UC-203 AC-13: POST /v1/allocate { wealth_amount: 3600000 } trên khoản thu 24.000.000 → Tích sản +3.600.000, phần còn lại 20.400.000 theo luật", async () => {
    const preview = await call("POST", "/v1/allocate/preview", { amount: 24_000_000, at: AT, account_id: "vcb-husband", wealth_amount: 3_600_000 });
    expect(preview.json.data.wealth).toEqual({ walletId: "wealth-building", amount: 3_600_000, adjustable: true });
    // Không gửi wealth_amount: theo luật nạp (30%), vẫn báo chỉnh được.
    const byRule = await call("POST", "/v1/allocate/preview", { amount: 24_000_000, at: AT, account_id: "vcb-husband" });
    expect(byRule.json.data.wealth).toEqual({ walletId: "wealth-building", amount: 7_200_000, adjustable: true });

    const id = await income(24_000_000);
    const res = await call("POST", "/v1/allocate", { income_tx_id: id, wealth_amount: 3_600_000, wealth_note: "bỏ qua vì có Tích sản" });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ wealth: { walletId: "wealth-building", amount: 3_600_000, adjustable: true }, wealthNote: null });
    expect(wealthFund(id)).toEqual({ amount: 3_600_000 });
    expect(raw.prepare("SELECT SUM(amount) s FROM transactions WHERE meaning = 'fund' AND wallet_id <> 'wealth-building'").get()).toEqual({ s: 20_400_000 });
    expect(runNote(id)).toEqual({ wealth_note: null });
  });

  it("UC-203 AC-13: wealth_amount 0 không wealth_note → 400 wealth_note_required, không ghi gì; có note → ghi, allocation_runs.wealth_note lưu, GET /v1/transactions/:id có wealth_note, GET /v1/wealth-building liệt kê trong skippedRuns", async () => {
    const id = await income(24_000_000, { income_stream_id: "salary-wife", note: "lương tháng 9" });
    for (const wealth_note of [undefined, "", "   "]) {
      const res = await call("POST", "/v1/allocate", { income_tx_id: id, wealth_amount: 0, wealth_note });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("wealth_note_required");
    }
    expect(fundCount()).toEqual({ n: 0 });
    expect((await call("POST", "/v1/allocate", { income_tx_id: id, wealth_amount: 0, wealth_note: "x".repeat(501) })).json.error?.code).toBe("invalid_input");
    expect((await call("POST", "/v1/allocate", { income_tx_id: id, wealth_amount: 0, wealth_note: 5 })).json.error?.code).toBe("invalid_input");
    for (const wealth_note of ["Trả\u0000học phí", "a\tb", "a\rb", "x\u007f"]) {
      expect((await call("POST", "/v1/allocate", { income_tx_id: id, wealth_amount: 0, wealth_note })).json.error?.code, JSON.stringify(wealth_note)).toBe("invalid_input");
    }
    // Preview không bao giờ hỏi lý do.
    expect((await call("POST", "/v1/allocate/preview", { amount: 24_000_000, at: AT, income_stream_id: "salary-wife", wealth_amount: 0 })).status).toBe(200);

    const res = await call("POST", "/v1/allocate", { income_tx_id: id, wealth_amount: 0, wealth_note: "  Trả học phí kỳ 1  " });
    expect(res.status).toBe(201);
    expect(raw.prepare("SELECT action, target, detail FROM audit_log WHERE action = 'income.allocate'").all()).toEqual([
      { action: "income.allocate", target: `tx:${id}`, detail: JSON.stringify({ wealth_amount: 0, manual: false, no_wealth: true }) },
    ]);
    expect(res.json.data).toMatchObject({ wealth: { amount: 0 }, wealthNote: "Trả học phí kỳ 1" });
    expect(wealthFund(id)).toBeUndefined();
    expect(runNote(id)).toEqual({ wealth_note: "Trả học phí kỳ 1" });
    expect((await call("GET", `/v1/transactions/${id}`)).json.data.wealth_note).toBe("Trả học phí kỳ 1");
    expect((await call("GET", "/v1/transactions?month=2026-09")).json.data[0].wealth_note).toBe("Trả học phí kỳ 1");
    expect((await call("GET", "/v1/wealth-building")).json.data.skippedRuns).toEqual([
      { incomeTxId: id, at: expect.any(String), amount: 24_000_000, incomeNote: "lương tháng 9", streamName: "Lương vợ", wealthNote: "Trả học phí kỳ 1" },
    ]);
  });

  it("UC-203 AC-13: khoản thu 10.000.000 tính thuế 10%, wealth_amount 9.500.000 → 400 invalid_amounts (không 500)", async () => {
    const preview = await call("POST", "/v1/allocate/preview", { amount: 10_000_000, taxable: true, at: AT, wealth_amount: 9_500_000 });
    expect(preview.status).toBe(400);
    expect(preview.json.error?.code).toBe("invalid_amounts");
    const id = await income(10_000_000, { taxable: true });
    const res = await call("POST", "/v1/allocate", { income_tx_id: id, wealth_amount: 9_500_000 });
    expect(res.status).toBe(400);
    expect(res.json.error?.code).toBe("invalid_amounts");
    expect(fundCount()).toEqual({ n: 0 });
  });

  it("UC-203 AC-14: Tự chia amounts không có Tích sản → 400 wealth_note_required; preview cùng body → 200; gửi kèm wealth_note → ghi", async () => {
    const id = await income(19_000_000);
    const missing = await call("POST", "/v1/allocate", { income_tx_id: id, amounts: NO_WEALTH });
    expect(missing.status).toBe(400);
    expect(missing.json.error?.code).toBe("wealth_note_required");
    // Ví Tích sản vắng hẳn khỏi amounts cũng vậy.
    expect((await call("POST", "/v1/allocate", { income_tx_id: id, amounts: NO_WEALTH.slice(0, -1) })).json.error?.code).toBe("wealth_note_required");
    expect(fundCount()).toEqual({ n: 0 });
    const preview = await call("POST", "/v1/allocate/preview", { amount: 19_000_000, at: AT, account_id: "vcb-husband", amounts: NO_WEALTH });
    expect(preview.status).toBe(200);
    expect(preview.json.data.wealth).toEqual({ walletId: "wealth-building", amount: 0, adjustable: true });
    const res = await call("POST", "/v1/allocate", { income_tx_id: id, amounts: NO_WEALTH, wealth_note: "Tháng này trả nợ trước\nTháng sau bù" });
    expect(res.status).toBe(201);
    expect(runNote(id)).toEqual({ wealth_note: "Tháng này trả nợ trước\nTháng sau bù" });
    expect(JSON.parse(String(raw.prepare("SELECT detail FROM audit_log WHERE action = 'income.allocate'").get()?.detail))).toEqual({ wealth_amount: null, manual: true, no_wealth: true });
  });

  it("UC-203: hợp đồng wealth_amount — âm / lẻ / chuỗi / vượt khoản thu / gửi cùng amounts / nguồn khóa 100% → 400 invalid_amounts ở cả preview lẫn allocate; preview trả wealth.adjustable false cho nguồn khóa 100%", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
    const id = await income(1_000_000);
    const bad: Record<string, unknown>[] = [
      { wealth_amount: -1 },
      { wealth_amount: 100.5 },
      { wealth_amount: "100000" },
      { wealth_amount: 1_000_001 },
      { wealth_amount: 100_000, amounts: [{ wallet_id: "food", amount: 1_000_000 }] },
      { wealth_amount: 0, amounts: [{ wallet_id: "food", amount: 1_000_000 }] },
    ];
    for (const extra of bad) {
      const p = await call("POST", "/v1/allocate/preview", { amount: 1_000_000, at: AT, ...extra });
      expect(p.status, JSON.stringify(extra)).toBe(400);
      expect(p.json.error?.code, JSON.stringify(extra)).toBe("invalid_amounts");
      const a = await call("POST", "/v1/allocate", { income_tx_id: id, ...extra });
      expect(a.json.error?.code, JSON.stringify(extra)).toBe("invalid_amounts");
    }
    expect(fundCount()).toEqual({ n: 0 });

    // Tiền người thuê: nguồn khóa 100% — không chỉnh được Tích sản.
    const rental = await call("POST", "/v1/allocate/preview", { amount: 5_000_000, at: AT, income_stream_id: "rental" });
    expect(rental.json.data.wealth).toEqual({ walletId: "wealth-building", amount: 0, adjustable: false });
    const rentalWealth = await call("POST", "/v1/allocate/preview", { amount: 5_000_000, at: AT, income_stream_id: "rental", wealth_amount: 500_000 });
    expect(rentalWealth.json.error?.code).toBe("invalid_amounts");
    const rentId = await income(5_000_000, { tenant_id: "tenant-binh" });
    expect((await call("POST", "/v1/allocate", { income_tx_id: rentId, wealth_amount: 500_000 })).json.error?.code).toBe("invalid_amounts");
    // Tự chia tiền người thuê không có Tích sản: không hỏi lý do (không chỉnh được Tích sản), không lưu lý do.
    const manual = await call("POST", "/v1/allocate", { income_tx_id: rentId, amounts: [{ wallet_id: "housing", amount: 5_000_000 }] });
    expect(manual.status).toBe(201);
    expect(manual.json.data).toMatchObject({ wealth: { amount: 0, adjustable: false }, wealthNote: null });
    expect(runNote(rentId)).toEqual({ wealth_note: null });
  });

  it("UC-203: thứ tự lỗi invalid_amounts → amounts_mismatch → wealth_note_required", async () => {
    const id = await income(19_000_000);
    const holding = [...NO_WEALTH, { wallet_id: "income", amount: 1 }];
    expect((await call("POST", "/v1/allocate", { income_tx_id: id, amounts: holding.map((a) => ({ ...a })) })).json.error?.code).toBe("invalid_amounts");
    const mismatch = NO_WEALTH.map((a) => (a.wallet_id === "transport" ? { ...a, amount: 499_000 } : a));
    expect((await call("POST", "/v1/allocate", { income_tx_id: id, amounts: mismatch })).json.error?.code).toBe("amounts_mismatch");
    expect((await call("POST", "/v1/allocate", { income_tx_id: id, amounts: NO_WEALTH })).json.error?.code).toBe("wealth_note_required");
    expect((await call("POST", "/v1/allocate", { income_tx_id: 999_999, amounts: NO_WEALTH })).json.error?.code).toBe("not_income");
  });

  it("UC-203: lương tự chia ở ingest (nguồn không khóa Tích sản) và MCP allocate_income không bắt lý do dù Tích sản 0", async () => {
    // Lương chồng không khóa Tích sản: chia theo nguồn thì Tích sản 0.
    const id = await income(30_000_000, { income_stream_id: "salary-husband" });
    // ingest (`allocateIncome(db, id)`) và tool MCP allocate_income gọi đúng như vậy: không wealth_amount, không amounts.
    const result = await allocateIncome(env.DB, id);
    expect(result.wealth).toEqual({ walletId: "wealth-building", amount: 0, adjustable: true });
    expect(result.wealthNote).toBeNull();
    // REST không gửi gì thêm cũng vậy.
    const other = await income(30_000_000, { income_stream_id: "salary-husband" });
    expect((await call("POST", "/v1/allocate", { income_tx_id: other })).status).toBe(201);
    expect((await call("GET", "/v1/wealth-building")).json.data.skippedRuns).toEqual([]);
  });

  it("UC-707: skippedRuns bỏ khoản thu đã huỷ (allocation_runs còn dòng sau khi gỡ)", async () => {
    const kept = await income(2_000_000, { note: "thưởng" });
    const voided = await income(3_000_000);
    await call("POST", "/v1/allocate", { income_tx_id: kept, wealth_amount: 0, wealth_note: "Sửa xe" });
    await call("POST", "/v1/allocate", { income_tx_id: voided, wealth_amount: 0, wealth_note: "Nhầm" });
    expect((await call("POST", `/v1/transactions/${voided}/void`)).status).toBe(200);
    expect(runNote(voided)).toEqual({ wealth_note: "Nhầm" });
    expect((await call("GET", "/v1/wealth-building")).json.data.skippedRuns.map((r: { incomeTxId: number }) => r.incomeTxId)).toEqual([kept]);
  });
});

describe("nguồn thu, ví giữ riêng, chuyển ngân sách", () => {
  const balances = () =>
    Object.fromEntries((raw.prepare("SELECT wallet_id, balance FROM v_wallet_balance").all() as { wallet_id: string; balance: number }[]).map((r) => [r.wallet_id, r.balance]));

  async function allocated(body: Record<string, unknown>) {
    const { json } = await call("POST", "/v1/transactions", { meaning: "income", account_id: "vcb-husband", at: "2026-09-10T09:00:00+07:00", ...body });
    await call("POST", "/v1/allocate", { income_tx_id: json.data.tx.id });
    return json.data.tx;
  }

  it("tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
    const tx = await allocated({ amount: 5_191_667, tenant_id: "tenant-binh" });
    expect(tx).toMatchObject({ wallet_id: "income", tenant_id: "tenant-binh", income_stream_id: "rental" });
    expect(raw.prepare("SELECT wallet_id, amount FROM transactions WHERE meaning = 'fund'").all()).toEqual([{ wallet_id: "rental-income", amount: 5_191_667 }]);

    const debt = await call("POST", "/v1/transactions", { meaning: "spend", amount: 3_000_000, category_id: "debt-payment", account_id: "vcb-husband" });
    expect(debt.status).toBe(201);
    expect(debt.json.data.tx.counter_wallet_id).toBe("rental-income");
    expect(balances()["rental-income"]).toBe(2_191_667);

    const snap = (await call("GET", "/v1/snapshot")).json.data;
    expect(snap.reserves).toEqual([{ walletId: "rental-income", name: "Thu cho thuê", balance: 2_191_667 }]);
    const budget = (await call("GET", "/v1/budget?period=2026-09")).json.data;
    expect(budget.lines.map((l: { walletId: string }) => l.walletId)).not.toContain("rental-income");
  });

  it("nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối", async () => {
    const preview = await call("POST", "/v1/allocate/preview", { amount: 11_000_000, at: "2026-09-10T09:00:00+07:00", income_stream_id: "salary-wife" });
    expect(preview.json.data.funds).toContainEqual({ walletId: "wealth-building", amount: 4_950_000 });
    await allocated({ amount: 11_000_000, income_stream_id: "salary-wife" });
    expect(balances()["wealth-building"]).toBe(4_950_000);
    const wrong = await call("POST", "/v1/transactions", { meaning: "spend", amount: 1000, category_id: "groceries", income_stream_id: "salary-wife" });
    expect(wrong.json.error?.code).toBe("income_only");
    const unknown = await call("POST", "/v1/transactions", { meaning: "income", amount: 1000, account_id: "vcb-husband", tenant_id: "khong-co" });
    expect(unknown.json.error?.code).toBe("unknown_tenant");
  });

  it("chuyển ngân sách giữa hai ví: chỉ đổi số dư ví, tài khoản không đổi; báo ví nhận", async () => {
    await allocated({ amount: 40_000_000 });
    const before = balances();
    const book = () => raw.prepare("SELECT book_balance FROM v_account_book WHERE account_id = 'vcb-husband'").get();
    const bookBefore = book();
    const res = await call("POST", "/v1/transactions", { meaning: "transfer", amount: 500_000, from_wallet_id: "nice-to-have", wallet_id: "food" });
    expect(res.status).toBe(201);
    expect(res.json.data.tx).toMatchObject({ account_id: null, counter_account_id: null, wallet_id: "food", counter_wallet_id: "nice-to-have", source: "manual" });
    expect(res.json.data.wallet.walletId).toBe("food");
    const after = balances();
    expect(after["food"]! - before["food"]!).toBe(500_000);
    expect(after["nice-to-have"]! - before["nice-to-have"]!).toBe(-500_000);
    expect(book()).toEqual(bookBefore);
  });

  it.each([
    [{ from_wallet_id: "wealth-building", wallet_id: "food" }, "locked_wallet"],
    [{ from_wallet_id: "nice-to-have", wallet_id: "income" }, "locked_wallet"],
    [{ from_wallet_id: "income", wallet_id: "food" }, "locked_wallet"],
    [{ from_wallet_id: "food", wallet_id: "food" }, "same_wallet"],
    [{ wallet_id: "food" }, "missing_wallet"],
  ])("chuyển ngân sách sai: %j → %s", async (wallets, code) => {
    const { status, json } = await call("POST", "/v1/transactions", { meaning: "transfer", amount: 1000, ...wallets });
    expect(status).toBe(400);
    expect(json.error?.code).toBe(code);
  });

  it("phong bì tháng chia theo tuần: dự kiến tuần = tháng ÷ số thứ Hai, còn để chi dùng dự kiến tuần", async () => {
    raw.prepare("UPDATE allocations SET period = 'month', amount = 2800000, split_weekly = 1 WHERE wallet_id = 'food'").run();
    // 2026-W45 bắt đầu thứ Hai 2/11; tháng 11/2026 có 5 thứ Hai.
    const week = (await call("GET", "/v1/budget?period=2026-W45")).json.data;
    expect(week.lines.find((l: { walletId: string }) => l.walletId === "food")).toMatchObject({ target: 560_000, spent: 0, remaining: 560_000 });

    const id = (await call("POST", "/v1/transactions", { meaning: "income", amount: 40_000_000, account_id: "vcb-husband" })).json.data.tx.id;
    await call("POST", "/v1/allocate", { income_tx_id: id });
    await call("POST", "/v1/transactions", { meaning: "spend", amount: 100_000, category_id: "groceries" });
    const snap = (await call("GET", "/v1/snapshot")).json.data;
    const target = Math.floor(2_800_000 / mondaysInMonth(snap.week.start.slice(0, 7)));
    expect(snap.wallets.find((w: { id: string }) => w.id === "food")).toMatchObject({ weekTarget: target, spentWeek: 100_000 });
    expect(snap.spendableByWallet.find((w: { walletId: string }) => w.walletId === "food").amount).toBe(target - 100_000);

    const month = (await call("GET", "/v1/budget")).json.data;
    expect(month.lines.find((l: { walletId: string }) => l.walletId === "food").balance).toBe(balances()["food"]);
  });
});

describe("sửa / xoá giao dịch (UC-102)", () => {
  const bal = (id: string) => (raw.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = ?").get(id) as { balance: number } | undefined)?.balance ?? 0;
  const status = (id: number) => (raw.prepare("SELECT status FROM transactions WHERE id = ?").get(id) as { status: string }).status;
  const count = (sql: string) => (raw.prepare(sql).get() as { n: number }).n;
  const spend = async (body: Record<string, unknown> = {}) =>
    (await call("POST", "/v1/transactions", { meaning: "spend", amount: 45_000, category_id: "groceries", ...body })).json.data.tx as { id: number };
  /** Một giao dịch từ ngân hàng: log 'out' trên vcb-husband, gán thành khoản chi Đi chợ. */
  async function bankSpend() {
    raw.prepare(`INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES ('b1', '2026-09-22T02:00:00.000Z', 80000, 'out', 'vcb-husband', 'pending')`).run();
    await call("POST", "/v1/logs/b1/assign", { splits: [{ meaning: "spend", amount: 80_000, category_id: "groceries" }] });
    return (raw.prepare("SELECT id FROM transactions WHERE log_id = 'b1'").get() as { id: number }).id;
  }
  async function allocatedIncome() {
    const id = (await call("POST", "/v1/transactions", { meaning: "income", amount: 10_000_000, account_id: "vcb-husband", at: "2026-09-10T09:00:00+07:00" })).json.data.tx.id as number;
    await call("POST", "/v1/allocate", { income_tx_id: id });
    return id;
  }

  it("xoá khoản chi ghi tay: dòng thành void, ví được trả lại tiền", async () => {
    const tx = await spend();
    expect(bal("food")).toBe(-45_000);
    const res = await call("POST", `/v1/transactions/${tx.id}/void`);
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ id: tx.id, status: "void" });
    expect(bal("food")).toBe(0);
  });

  it("giao dịch từ ngân hàng không xoá được ở sổ cái (bank_tx), log vẫn đã gán; gỡ gán thì được", async () => {
    const id = await bankSpend();
    const res = await call("POST", `/v1/transactions/${id}/void`);
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe("bank_tx");
    expect(status(id)).toBe("active");
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'b1'").get()).toEqual({ status: "assigned" });
    expect((await call("POST", `/v1/logs/transactions/${id}/void`)).status).toBe(200);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'b1'").get()).toEqual({ status: "pending" });
  });

  it("không sửa / xoá lẻ bút toán hệ thống (fund của lần chia) → system_tx", async () => {
    await allocatedIncome();
    const fund = (raw.prepare("SELECT id FROM transactions WHERE meaning = 'fund' LIMIT 1").get() as { id: number }).id;
    expect((await call("POST", `/v1/transactions/${fund}/void`)).json.error?.code).toBe("system_tx");
    expect((await call("POST", `/v1/transactions/${fund}/replace`, { meaning: "spend", amount: 1, category_id: "groceries" })).json.error?.code).toBe("system_tx");
    expect(status(fund)).toBe("active");
  });

  it("sửa khoản chi: đổi số tiền, danh mục, ví trong một lần — khoản cũ void, khoản mới active, số dư ví đúng", async () => {
    const tx = await spend({ at: "2026-09-20T12:00:00+07:00", note: "chợ sáng" });
    const res = await call("POST", `/v1/transactions/${tx.id}/replace`, {
      meaning: "spend",
      amount: 120_000,
      category_id: "fuel-parking",
      wallet_id: "transport",
      account_id: "cash-husband",
      at: "2026-09-20T12:00:00+07:00",
      note: "đổ xăng",
      client_id: "edit-0001-aaaa",
    });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ replaced: tx.id, duplicate: false, wallet: { walletId: "transport" } });
    expect(res.json.data.tx).toMatchObject({ status: "active", amount: 120_000, category_id: "fuel-parking", counter_wallet_id: "transport", note: "đổ xăng", source: "manual" });
    expect(status(tx.id)).toBe("void");
    expect(bal("food")).toBe(0);
    expect(bal("transport")).toBe(-120_000);
    expect(count("SELECT COUNT(*) n FROM transactions WHERE status = 'active'")).toBe(1);
  });

  it.each([
    [{ meaning: "spend", amount: 0, category_id: "groceries" }, "invalid_amount"],
    [{ meaning: "spend", amount: 1000, category_id: "khong-co" }, "unknown_category"],
    [{ meaning: "spend", amount: 1000, category_id: "groceries", wallet_id: "wealth-building" }, "locked_wallet"],
    [{ meaning: "buy_asset", amount: 1000, asset_kind: "gold" }, "insufficient_cash"],
  ])("sửa bằng dữ liệu mới sai → từ chối, khoản cũ còn nguyên: %j → %s", async (entry, code) => {
    const tx = await spend();
    const res = await call("POST", `/v1/transactions/${tx.id}/replace`, entry);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json.error?.code).toBe(code);
    expect(status(tx.id)).toBe("active");
    expect(count("SELECT COUNT(*) n FROM transactions")).toBe(1);
    expect(bal("food")).toBe(-45_000);
  });

  it("sửa giao dịch từ ngân hàng → bank_tx, không ghi gì mới", async () => {
    const id = await bankSpend();
    const res = await call("POST", `/v1/transactions/${id}/replace`, { meaning: "spend", amount: 80_000, category_id: "fuel-parking" });
    expect(res.json.error?.code).toBe("bank_tx");
    expect(status(id)).toBe("active");
    expect(count("SELECT COUNT(*) n FROM transactions")).toBe(1);
  });

  it("sửa khoản thu đã chia: gỡ lần chia cũ, khoản thu mới chưa chia và chia lại được", async () => {
    const id = await allocatedIncome();
    const res = await call("POST", `/v1/transactions/${id}/replace`, { meaning: "income", amount: 12_000_000, account_id: "vcb-husband", at: "2026-09-10T09:00:00+07:00" });
    expect(res.status).toBe(201);
    const next = res.json.data.tx.id as number;
    expect(status(id)).toBe("void");
    expect(count("SELECT COUNT(*) n FROM transactions WHERE meaning = 'fund' AND status = 'active'")).toBe(0);
    expect(raw.prepare("SELECT DISTINCT status FROM transfer_orders").all()).toEqual([{ status: "skipped" }]);
    expect(bal("income")).toBe(12_000_000);
    expect(count(`SELECT COUNT(*) n FROM allocation_runs WHERE income_tx_id = ${next}`)).toBe(0);
    expect((await call("POST", "/v1/allocate", { income_tx_id: next })).status).toBe(201);
    expect(bal("income")).toBe(0);
  });

  it("sửa khoản thu mà tiền của lần chia đã chuyển thật → allocation_settled, sổ giữ nguyên", async () => {
    const id = await allocatedIncome();
    const order = raw.prepare("SELECT id FROM transfer_orders LIMIT 1").get() as { id: number };
    await call("POST", `/v1/transfer-orders/${order.id}/done`);
    const res = await call("POST", `/v1/transactions/${id}/replace`, { meaning: "income", amount: 9_000_000, account_id: "vcb-husband" });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe("allocation_settled");
    expect(status(id)).toBe("active");
    expect(count("SELECT COUNT(*) n FROM transactions WHERE meaning = 'income'")).toBe(1);
    expect(count("SELECT SUM(amount) n FROM transactions WHERE meaning = 'fund' AND status = 'active'")).toBe(10_000_000);
  });

  it("gửi lại cùng client_id khi sửa chỉ ghi một lần", async () => {
    const tx = await spend();
    const body = { meaning: "spend", amount: 50_000, category_id: "groceries", client_id: "edit-0002-bbbb" };
    const first = await call("POST", `/v1/transactions/${tx.id}/replace`, body);
    const again = await call("POST", `/v1/transactions/${tx.id}/replace`, body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.json.data).toMatchObject({ duplicate: true, replaced: tx.id, tx: { id: first.json.data.tx.id } });
    expect(count("SELECT COUNT(*) n FROM transactions")).toBe(2);
    expect(bal("food")).toBe(-50_000);
    // Khoản cũ đã huỷ: sửa lần nữa với client_id khác bị từ chối.
    expect((await call("POST", `/v1/transactions/${tx.id}/replace`, { ...body, client_id: "edit-0003-cccc" })).json.error?.code).toBe("already_void");
  });

  it("sửa giữ chỗ gắn sổ nợ, sổ phải thu, người thuê — kể cả khi khoản đó đã tắt", async () => {
    raw.exec(`INSERT INTO debts (id, name) VALUES ('co-lan', 'Cô Lan');
              INSERT INTO receivables (id, name) VALUES ('em-hai', 'Em Hai');
              INSERT INTO tenants (id, name) VALUES ('chi-lan', 'Chị Lan');`);
    const debtPay = await spend({ debt_id: "co-lan", category_id: "debt-payment", wallet_id: "nice-to-have" });
    const lend = (await call("POST", "/v1/transactions", { meaning: "lend", amount: 2_000_000, account_id: "vcb-husband", receivable_id: "em-hai" })).json.data.tx;
    const rent = (await call("POST", "/v1/transactions", { meaning: "income", amount: 3_000_000, account_id: "vcb-husband", tenant_id: "chi-lan" })).json.data.tx;
    raw.exec("UPDATE debts SET active = 0; UPDATE receivables SET active = 0; UPDATE tenants SET active = 0;");

    const d = await call("POST", `/v1/transactions/${debtPay.id}/replace`, { meaning: "spend", amount: 60_000, category_id: "debt-payment", wallet_id: "nice-to-have", debt_id: "co-lan" });
    const r = await call("POST", `/v1/transactions/${lend.id}/replace`, { meaning: "lend", amount: 1_500_000, account_id: "vcb-husband", receivable_id: "em-hai" });
    const t = await call("POST", `/v1/transactions/${rent.id}/replace`, { meaning: "income", amount: 3_200_000, account_id: "vcb-husband", tenant_id: "chi-lan" });
    expect(d.json.data.tx).toMatchObject({ debt_id: "co-lan", amount: 60_000 });
    expect(r.json.data.tx).toMatchObject({ receivable_id: "em-hai", amount: 1_500_000 });
    expect(t.json.data.tx).toMatchObject({ tenant_id: "chi-lan", income_stream_id: "rental", amount: 3_200_000 });
    // Gắn MỚI vào khoản đã tắt vẫn bị chặn như khi nhập.
    const other = await spend();
    expect((await call("POST", `/v1/transactions/${other.id}/replace`, { meaning: "spend", amount: 1000, category_id: "debt-payment", debt_id: "co-lan" })).json.error?.code).toBe("inactive_debt");
  });

  it("sửa giữ người ghi là người ghi khoản cũ", async () => {
    const tx = (await call("POST", "/v1/transactions", { meaning: "spend", amount: 50_000, category_id: "hangouts" }, { "X-Member-Id": "wife" })).json.data.tx;
    const res = await call("POST", `/v1/transactions/${tx.id}/replace`, { meaning: "spend", amount: 70_000, category_id: "hangouts", wallet_id: "fun-wife" }, { "X-Member-Id": "husband" });
    expect(res.json.data.tx).toMatchObject({ by_member_id: "wife", counter_wallet_id: "fun-wife", amount: 70_000 });
  });

  it("khoản điều chỉnh sau đếm ví chỉ xoá được, không sửa (not_editable)", async () => {
    await call("POST", "/v1/transactions", { meaning: "transfer", amount: 500_000, account_id: "vcb-husband", to_account_id: "cash-husband" });
    await call("POST", "/v1/accounts/cash-husband/count", { counted: 450_000 });
    const adjust = (raw.prepare("SELECT id FROM transactions WHERE meaning = 'adjust'").get() as { id: number }).id;
    const res = await call("POST", `/v1/transactions/${adjust}/replace`, { meaning: "spend", amount: 50_000, category_id: "groceries" });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe("not_editable");
    expect(status(adjust)).toBe("active");
    expect((await call("POST", `/v1/transactions/${adjust}/void`)).json.data.status).toBe("void");
  });
});

describe("sổ giao dịch (UC-111)", () => {
  it("trang sau theo (ngày, id): khoản nhập lùi ngày không bị bỏ sót hay lặp", async () => {
    const add = async (at: string) => (await call("POST", "/v1/transactions", { meaning: "spend", amount: 1000, category_id: "groceries", at })).json.data.tx.id as number;
    const a = await add("2026-09-20T12:00:00+07:00");
    const b = await add("2026-09-22T12:00:00+07:00");
    const c = await add("2026-09-21T12:00:00+07:00"); // nhập sau b nhưng ngày lùi: id lớn hơn b mà đứng sau b
    const d = await add("2026-09-19T12:00:00+07:00");
    const page1 = (await call("GET", "/v1/transactions?limit=2")).json.data.map((r: { id: number }) => r.id);
    expect(page1).toEqual([b, c]);
    const page2 = (await call("GET", `/v1/transactions?limit=2&before=${page1[1]}`)).json.data.map((r: { id: number }) => r.id);
    expect(page2).toEqual([a, d]);
  });

  it("khoản đã xoá ẩn khỏi sổ mặc định, vẫn còn trong sổ và xem lại được bằng include_void=1", async () => {
    const keep = (await call("POST", "/v1/transactions", { meaning: "spend", amount: 1000, category_id: "groceries" })).json.data.tx.id as number;
    const gone = (await call("POST", "/v1/transactions", { meaning: "spend", amount: 2000, category_id: "groceries" })).json.data.tx.id as number;
    await call("POST", `/v1/transactions/${gone}/void`);
    const ids = async (q: string) => (await call("GET", `/v1/transactions${q}`)).json.data.map((r: { id: number }) => r.id);
    expect(await ids("?limit=10")).toEqual([keep]);
    expect(await ids("?limit=10&include_void=1")).toEqual([gone, keep]);
    expect((await call("GET", `/v1/transactions/${gone}`)).json.data).toMatchObject({ id: gone, status: "void" });
  });

  it("mở một giao dịch theo id: cùng hình dạng dòng sổ, kèm cờ đã chia và tên sổ đối ứng", async () => {
    raw.exec("INSERT INTO debts (id, name) VALUES ('co-lan', 'Cô Lan')");
    const income = (await call("POST", "/v1/transactions", { meaning: "income", amount: 10_000_000, account_id: "vcb-husband" })).json.data.tx.id;
    await call("POST", "/v1/allocate", { income_tx_id: income });
    const pay = (await call("POST", "/v1/transactions", { meaning: "spend", amount: 50_000, category_id: "debt-payment", wallet_id: "nice-to-have", debt_id: "co-lan" })).json.data.tx.id;
    expect((await call("GET", `/v1/transactions/${income}`)).json.data).toMatchObject({ id: income, meaning: "income", allocated: 1 });
    expect((await call("GET", `/v1/transactions/${pay}`)).json.data).toMatchObject({ id: pay, allocated: 0, debt_name: "Cô Lan", category_name: "Trả nợ", source: "manual" });
    expect((await call("GET", "/v1/transactions/99999")).status).toBe(404);
  });

  // change 261006-so-giao-dich: màn Sổ giao dịch lọc theo tháng / loại / danh mục / ví / tài khoản / người / nguồn / chữ, kèm tổng.
  describe("lọc và tổng (change 261006-so-giao-dich)", () => {
    const post = async (b: Record<string, unknown>) => {
      const res = await call("POST", "/v1/transactions", b);
      expect(res.json.error ?? null).toBeNull();
      expect(res.status).toBe(201);
      return res.json.data.tx.id as number;
    };
    const ids = async (q: string) => (await call("GET", `/v1/transactions?${q}`)).json.data.map((r: { id: number }) => r.id);
    /** Một khoản chi từ ngân hàng: log đã gán + giao dịch `sepay` trỏ về nó. */
    const bankSpend = (logId: string, at: string, amount: number, content: string) => {
      raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content) VALUES (?, ?, ?, 'out', 'vcb-husband', ?)").run(logId, at, amount, content);
      const res = raw
        .prepare(
          `INSERT INTO transactions (log_id, at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key, source)
           VALUES (?, ?, ?, 'spend', 'nice-to-have', 'vcb-husband', 'shopping', '2026-W38', ?, 'sepay')`,
        )
        .run(logId, at, amount, at.slice(0, 7));
      raw.prepare("UPDATE bank_logs SET status = 'assigned' WHERE id = ?").run(logId);
      return Number(res.lastInsertRowid);
    };

    it("lọc tháng 9 + Chi tiêu + một danh mục: đúng các khoản, tổng chi đúng; các bộ lọc khác khớp đúng cột", async () => {
      const thuoc1 = await post({ meaning: "spend", amount: 120_000, category_id: "health", account_id: "cash-husband", at: "2026-09-05T12:00:00+07:00" });
      const thuoc2 = await post({ meaning: "spend", amount: 80_000, category_id: "health", account_id: "cash-wife", at: "2026-09-20T12:00:00+07:00" });
      await post({ meaning: "spend", amount: 50_000, category_id: "health", at: "2026-08-30T12:00:00+07:00" }); // tháng khác
      const cho = await post({ meaning: "spend", amount: 300_000, category_id: "groceries", at: "2026-09-10T12:00:00+07:00" }); // danh mục khác
      const hoan = await post({ meaning: "refund", amount: 20_000, category_id: "health", wallet_id: "nice-to-have", account_id: "cash-husband", at: "2026-09-21T12:00:00+07:00" });
      const gone = await post({ meaning: "spend", amount: 999_000, category_id: "health", at: "2026-09-15T12:00:00+07:00" });
      await call("POST", `/v1/transactions/${gone}/void`);
      raw.prepare("UPDATE transactions SET by_member_id = 'wife' WHERE id = ?").run(thuoc2);
      const bank = bankSpend("b1", "2026-09-12T03:00:00.000Z", 450_000, "SHOPEE THANH TOAN");

      expect(await ids("month=2026-09&meaning=spend&category_id=health")).toEqual([thuoc2, thuoc1]);
      expect((await call("GET", "/v1/transactions/summary?month=2026-09&meaning=spend&category_id=health")).json.data).toMatchObject({ count: 2, spend: 200_000, refund: 0 });
      // Chi thật của danh mục trong tháng = chi tiêu − hoàn tiền.
      expect((await call("GET", "/v1/transactions/summary?month=2026-09&meaning=spend,refund&category_id=health")).json.data).toMatchObject({ count: 3, spend: 200_000, refund: 20_000 });
      expect(await ids("month=2026-09&meaning=spend,refund&category_id=health")).toEqual([hoan, thuoc2, thuoc1]);
      // Khoản đã xoá chỉ hiện khi bật, và không bao giờ cộng vào tổng.
      expect(await ids("month=2026-09&category_id=health&meaning=spend&include_void=1")).toEqual([thuoc2, gone, thuoc1]);
      expect((await call("GET", "/v1/transactions/summary?month=2026-09&category_id=health&meaning=spend&include_void=1")).json.data.spend).toBe(200_000);
      // Ví khớp cả ví được cộng lẫn ví bị trừ; tài khoản khớp cả hai chiều; người ghi; nguồn.
      expect(await ids("month=2026-09&wallet_id=food")).toEqual([cho]);
      expect(await ids("month=2026-09&wallet_id=nice-to-have")).toEqual([hoan, thuoc2, bank, thuoc1]);
      expect(await ids("account_id=cash-wife")).toEqual([thuoc2]);
      expect(await ids("month=2026-09&member_id=wife")).toEqual([thuoc2]);
      expect(await ids("month=2026-09&source=bank")).toEqual([bank]);
      expect(await ids("month=2026-09&source=manual")).toEqual([hoan, thuoc2, cho, thuoc1]);
      // Phân trang giữ bộ lọc.
      expect(await ids(`month=2026-09&wallet_id=nice-to-have&limit=2&before=${thuoc2}`)).toEqual([bank, thuoc1]);
    });

    it("tìm chữ: ghi chú, nội dung ngân hàng, tên danh mục, tên người; ít hơn 2 ký tự thì báo sai", async () => {
      const noted = await post({ meaning: "spend", amount: 99_000, category_id: "shopping", note: "áo Shopee cho bé", at: "2026-09-03T12:00:00+07:00" });
      const bank = bankSpend("b2", "2026-09-04T03:00:00.000Z", 150_000, "SHOPEEPAY 12345");
      const other = await post({ meaning: "spend", amount: 10_000, category_id: "groceries", at: "2026-09-05T12:00:00+07:00" });
      raw.exec("INSERT INTO receivables (id, name) VALUES ('chi-lan', 'Chị Lan')");
      const lend = await post({ meaning: "lend", amount: 1_000_000, account_id: "cash-husband", receivable_id: "chi-lan", at: "2026-09-06T12:00:00+07:00" });
      expect(await ids("q=shopee")).toEqual([bank, noted]);
      expect(await ids(`q=${encodeURIComponent("nấu ăn")}`)).toEqual([other]); // tên danh mục "Đi chợ / nấu ăn"
      expect(await ids("q=Lan")).toEqual([lend]);
      expect(await ids("q=50%25")).toEqual([]); // % là chữ thường, không phải ký tự đại diện
      expect((await call("GET", "/v1/transactions/summary?q=shopee")).json.data).toMatchObject({ count: 2, spend: 249_000 });
      const short = await call("GET", "/v1/transactions?q=a");
      expect(short.status).toBe(400);
      expect(short.json.error).toMatchObject({ code: "invalid_input", message: "Từ tìm phải có ít nhất 2 ký tự." });
    });

    it("tìm có dấu cũng khớp nội dung ngân hàng không dấu; tìm không dấu chưa khớp chữ có dấu đã lưu", async () => {
      const bank = bankSpend("b3", "2026-09-07T03:00:00.000Z", 120_000, "chuyen tien thuoc cho me");
      const noted = await post({ meaning: "spend", amount: 45_000, category_id: "groceries", note: "Thuốc ho cho bé", at: "2026-09-06T12:00:00+07:00" });
      expect(await ids(`q=${encodeURIComponent("thuốc")}`)).toEqual([bank, noted]);
      // Chữ có dấu khác hoa thường (Ố / ố) chỉ khớp được qua dạng bỏ dấu — tức nội dung ngân hàng không dấu.
      expect(await ids(`q=${encodeURIComponent("THUỐC")}`)).toEqual([bank]);
      expect(await ids("q=thuoc")).toEqual([bank]); // chiều ngược (ghi chú có dấu) cần cột chuẩn hoá — chưa làm
    });

    it("tổng theo nghĩa tiền thật: chi, hoàn, thu, cho vay / nhận lại, chuyển nội bộ, mua tài sản, điều chỉnh hai chiều", async () => {
      const at = "2026-09-10T12:00:00+07:00";
      await post({ meaning: "spend", amount: 500_000, category_id: "groceries", at });
      await post({ meaning: "refund", amount: 50_000, wallet_id: "food", account_id: "cash-husband", at });
      const income = await post({ meaning: "income", amount: 3_000_000, account_id: "cash-husband", at });
      await call("POST", "/v1/allocate", { income_tx_id: income }); // ghi các bút toán nạp ví (fund)
      raw.exec("INSERT INTO receivables (id, name) VALUES ('em-hai', 'Em Hai')");
      await post({ meaning: "lend", amount: 400_000, account_id: "cash-husband", receivable_id: "em-hai", at });
      await post({ meaning: "collect", amount: 100_000, account_id: "cash-husband", receivable_id: "em-hai", at });
      await post({ meaning: "transfer", amount: 700_000, account_id: "cash-husband", to_account_id: "cash-wife", at });
      await post({ meaning: "buy_asset", amount: 500_000, account_id: "cash-husband", asset_kind: "gold", at });
      raw.exec(`INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, account_id, counter_account_id, week_key, month_key, source)
                VALUES ('2026-09-11T05:00:00.000Z', 30000, 'adjust', 'nice-to-have', NULL, NULL, 'cash-husband', '2026-W37', '2026-09', 'manual'),
                       ('2026-09-12T05:00:00.000Z', 12000, 'adjust', NULL, 'nice-to-have', 'cash-husband', NULL, '2026-W37', '2026-09', 'manual')`);
      expect(Number(raw.prepare("SELECT COUNT(*) AS n FROM transactions WHERE meaning = 'fund'").get()?.n)).toBeGreaterThan(0);
      const s = (await call("GET", "/v1/transactions/summary?month=2026-09")).json.data;
      expect(s).toEqual({ count: 9, spend: 500_000, refund: 50_000, income: 3_000_000, lend: 400_000, collect: 100_000, transfer: 700_000, buy_asset: 500_000, adjust_in: 30_000, adjust_out: 12_000 });
      // Bút toán nạp ví của lần chia không bao giờ có trong sổ hay tổng.
      expect((await call("GET", "/v1/transactions?month=2026-09&limit=200")).json.data).toHaveLength(9);
      expect((await call("GET", "/v1/transactions/summary?month=2026-08")).json.data).toEqual({ count: 0, spend: 0, refund: 0, income: 0, lend: 0, collect: 0, transfer: 0, buy_asset: 0, adjust_in: 0, adjust_out: 0 });
    });

    it("tham số sai định dạng → invalid_input, nói rõ tham số nào", async () => {
      const bad = async (q: string) => {
        const res = await call("GET", `/v1/transactions${q}`);
        expect(res.status).toBe(400);
        expect(res.json.error?.code).toBe("invalid_input");
        return res.json.error!.message;
      };
      expect(await bad("?month=2026-9")).toBe("month phải có dạng YYYY-MM.");
      expect(await bad("/summary?month=2026-13")).toBe("month phải có dạng YYYY-MM.");
      expect(await bad("?meaning=spend,fund")).toMatch(/^meaning phải là một hoặc nhiều trong: spend, income/);
      expect(await bad("?source=sepay")).toBe("source phải là manual hoặc bank.");
      expect(await bad("?wallet_id=a%20b")).toBe("wallet_id không hợp lệ.");
      expect(await bad("?q=%20%20x%20")).toBe("Từ tìm phải có ít nhất 2 ký tự.");
      expect(await bad(`?q=${"x".repeat(101)}`)).toBe("Từ tìm dài quá 100 ký tự.");
      expect(await bad("?limit=abc")).toBe("limit / before phải là số nguyên.");
    });
  });
});
