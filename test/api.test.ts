import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { E_ACCOUNTS, householdE } from "./helpers/household-e";
import { MemoryKV } from "./helpers/oauth";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  raw = openDb();
  // Bối cảnh: nhà chưa nối bank feed — mọi tài khoản đều ghi tay (tài khoản đã nối feed thì không nhận nhập tay).
  raw.prepare("UPDATE accounts SET sepay_enabled = 0").run();
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
  it("UC-101 AC-1: chi tiền mặt 3 chạm: tài khoản mặc định là tiền mặt của người nhập, chỉ danh mục, không ví; phản hồi có tiền vận hành sau khi ghi", async () => {
    const { status, json } = await call("POST", "/v1/transactions", { meaning: "spend", amount: 200_000, category_id: "fuel-parking" }, { "X-Member-Id": "wife" });
    expect(status).toBe(201);
    expect(json.data.tx).toMatchObject({ legacy_class: null, account_id: "cash-wife", category_id: "fuel-parking", by_member_id: "wife", source: "manual" });
    expect(json.data.tx).not.toHaveProperty("wallet_id");
    const snap = (await call("GET", "/v1/snapshot", undefined, { "X-Member-Id": "wife" })).json.data;
    expect(json.data.nearSpend).toEqual({ amount: snap.nearSpend.amount, perDay: snap.nearSpend.perDay });
    expect(json.data).not.toHaveProperty("wallet");
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
    [{ meaning: "spend", amount: 1000, category_id: "groceries", wallet_id: "wealth-building" }, "model_changed"],
    [{ meaning: "spend", amount: 1000, category_id: "groceries", earmark_id: "tuition" }, "model_changed"],
    [{ meaning: "transfer", amount: 1000, account_id: "vcb-husband", to_account_id: "vcb-husband" }, "same_account"],
    [{ meaning: "transfer", amount: 1000, account_id: "vcb-husband" }, "missing_account"],
    [{ meaning: "buy_asset", amount: 1000, asset_kind: "gold" }, "missing_account"],
    [{ meaning: "fund", amount: 1000 }, "invalid_input"],
    [{ meaning: "spend", amount: 1000, category_id: "groceries", at: "2099-01-01" }, "future_at"],
  ])("UC-101 AC-5: từ chối đầu vào sai: %j → %s", async (entry, code) => {
    const { status, json } = await call("POST", "/v1/transactions", entry);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(json.error?.code).toBe(code);
  });

  it("rút ATM là chuyển nội bộ: chỉ đổi tiền nằm ở đâu", async () => {
    await call("POST", "/v1/transactions", { meaning: "transfer", amount: 2_000_000, account_id: "vcb-husband", to_account_id: "cash-husband" });
    const books = raw.prepare("SELECT account_id, book_balance FROM v_account_book WHERE account_id IN ('vcb-husband','cash-husband') ORDER BY account_id").all();
    expect(books).toEqual([
      { account_id: "cash-husband", book_balance: 2_000_000 },
      { account_id: "vcb-husband", book_balance: -2_000_000 },
    ]);
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
  const MSG = "Ngày này trước ngày mở sổ tài khoản Tiền mặt (vợ) (1/10/2026), số dư đầu đã tính khoản này.";

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

  it("tài khoản không có ngày mở sổ không bị chặn", async () => {
    const old = await call("POST", "/v1/transactions", { meaning: "spend", amount: 10_000, category_id: "groceries", account_id: "cash-husband", at: "2020-01-01T10:00:00+07:00" });
    expect(old.status).toBe(201);
  });
});

describe("đối soát, đường đã bỏ", () => {
  it("UC-105 AC-1, AC-4: đếm ví lệch → một bút toán điều chỉnh chỉ có tài khoản (không ví), sổ khớp tiền thật", async () => {
    await call("POST", "/v1/transactions", { meaning: "transfer", amount: 500_000, account_id: "vcb-husband", to_account_id: "cash-husband" });
    const { json } = await call("POST", "/v1/accounts/cash-husband/count", { counted: 450_000 });
    expect(json.data).toEqual({ accountId: "cash-husband", book: 500_000, counted: 450_000, diff: -50_000 });
    expect(raw.prepare("SELECT book_balance FROM v_account_book WHERE account_id = 'cash-husband'").get()).toEqual({ book_balance: 450_000 });
    expect(raw.prepare("SELECT account_id, counter_account_id, legacy_class FROM transactions WHERE meaning = 'adjust'").get()).toEqual({
      account_id: "cash-husband", counter_account_id: null, legacy_class: null,
    });
    await call("POST", "/v1/accounts/cash-husband/count", { counted: 600_000 });
    expect(raw.prepare("SELECT account_id, counter_account_id, amount FROM transactions WHERE meaning = 'adjust' ORDER BY id DESC LIMIT 1").get()).toEqual({
      account_id: null, counter_account_id: "cash-husband", amount: 150_000,
    });
  });

  it("UC-107: GET /v1/wealth-building → 410 model_changed chỉ tới pockets.savings; đường cũ /v1/tichsan → 404", async () => {
    const res = await call("GET", "/v1/wealth-building");
    expect([res.status, res.json.error?.code]).toEqual([410, "model_changed"]);
    expect(res.json.error?.message).toBe("Ví nhà v2 đã bỏ ví Tích sản: xem Tích luỹ ở `GET /v1/snapshot` (`pockets.savings`).");
    expect((await call("GET", "/v1/tichsan")).status).toBe(404);
  });

  it.each(["/v1/allocate", "/v1/allocate/preview", "/v1/transfer-orders", "/v1/transfer-orders/1/done"])(
    "UC-101: đường của mô hình ví đã bỏ %s → 410 model_changed",
    async (path) => {
      for (const method of ["GET", "POST"]) {
        const res = await call(method, path, method === "POST" ? {} : undefined);
        expect([res.status, res.json.error?.code]).toEqual([410, "model_changed"]);
      }
    },
  );

  it("UC-1205 AC-7: đường kỳ lương đã bỏ /v1/pay-cycle-tasks/*, /v1/pay-cycle/goal-amounts/* → 404", async () => {
    expect((await call("POST", "/v1/pay-cycle-tasks/1/done", {})).status).toBe(404);
    expect((await call("PATCH", "/v1/pay-cycle-tasks/1", { amount: 1 })).status).toBe(404);
    expect((await call("PUT", "/v1/pay-cycle/goal-amounts/x", { amount: 1 })).status).toBe(404);
  });
});

describe("nguồn thu, tiền người thuê (không ví, không chia)", () => {
  it("UC-101 AC-12: tiền người thuê tự gắn nguồn cho thuê, vào ngăn của tài khoản nhận; không chia, không ví, không phải lương (không nhắc trích)", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
    const before = (await call("GET", "/v1/snapshot")).json.data.pockets.operating.total;
    const res = await call("POST", "/v1/transactions", { meaning: "income", account_id: "vcb-husband", amount: 5_191_667, tenant_id: "tenant-binh" });
    expect(res.json.data.tx).toMatchObject({ legacy_class: null, tenant_id: "tenant-binh", income_stream_id: "rental" });
    expect(res.json.data.effects.savings).toBeNull();
    expect(res.json.data.tx.is_salary).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM transactions WHERE meaning = 'fund'").get()).toEqual({ n: 0 });
    expect((await call("GET", "/v1/snapshot")).json.data.pockets.operating.total - before).toBe(5_191_667);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM month_tasks").get()).toEqual({ n: 0 });
  });

  it("UC-101 AC-13: nguồn thu chọn tay được lưu trên khoản thu và quyết \"Đây là lương\" mặc định; gắn nguồn cho khoản không phải thu nhập bị từ chối", async () => {
    const wife = await call("POST", "/v1/transactions", { meaning: "income", amount: 11_000_000, account_id: "vcb-husband", income_stream_id: "salary-wife" });
    expect(wife.json.data.tx.income_stream_id).toBe("salary-wife");
    expect(wife.json.data.effects.savings).toBeNull();
    const husband = await call("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "vcb-husband", income_stream_id: "salary-husband" });
    expect(husband.json.data.effects.savings).toMatchObject({ amount: expect.any(Number) });
    expect(husband.json.data.tx.is_salary).toBe(1);
    const wrong = await call("POST", "/v1/transactions", { meaning: "spend", amount: 1000, category_id: "groceries", income_stream_id: "salary-wife" });
    expect(wrong.json.error?.code).toBe("income_only");
    const unknown = await call("POST", "/v1/transactions", { meaning: "income", amount: 1000, account_id: "vcb-husband", tenant_id: "khong-co" });
    expect(unknown.json.error?.code).toBe("unknown_tenant");
  });
});

describe("sửa / xoá giao dịch (UC-102)", () => {
  const book = (id: string) => (raw.prepare("SELECT book_balance FROM v_account_book WHERE account_id = ?").get(id) as { book_balance: number }).book_balance;
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

  it("UC-102 AC-6: xoá khoản chi ghi tay: dòng thành void, tài khoản trả nhận lại tiền", async () => {
    const tx = await spend();
    expect(book("cash-husband")).toBe(-45_000);
    const res = await call("POST", `/v1/transactions/${tx.id}/void`);
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ id: tx.id, status: "void" });
    expect(book("cash-husband")).toBe(0);
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

  it("UC-102 AC-8: sửa khoản chi: đổi số tiền, danh mục, tài khoản trong một lần — khoản cũ void, khoản mới active không ví, số dư tài khoản đúng", async () => {
    const tx = await spend({ at: "2026-09-20T12:00:00+07:00", note: "chợ sáng" });
    const res = await call("POST", `/v1/transactions/${tx.id}/replace`, {
      meaning: "spend",
      amount: 120_000,
      category_id: "fuel-parking",
      account_id: "cash-wife",
      at: "2026-09-20T12:00:00+07:00",
      note: "đổ xăng",
      client_id: "edit-0001-aaaa",
    });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ replaced: tx.id, duplicate: false, nearSpend: { amount: expect.any(Number) } });
    expect(res.json.data.tx).toMatchObject({ status: "active", amount: 120_000, category_id: "fuel-parking", legacy_class: null, legacy: false, note: "đổ xăng", source: "manual" });
    expect(res.json.data.tx).not.toHaveProperty("wallet_name");
    expect(status(tx.id)).toBe("void");
    expect(book("cash-husband")).toBe(0);
    expect(book("cash-wife")).toBe(-120_000);
    expect(count("SELECT COUNT(*) n FROM transactions WHERE status = 'active'")).toBe(1);
  });

  it.each([
    [{ meaning: "spend", amount: 0, category_id: "groceries" }, "invalid_amount"],
    [{ meaning: "spend", amount: 1000, category_id: "khong-co" }, "unknown_category"],
    [{ meaning: "spend", amount: 1000, category_id: "groceries", wallet_id: "wealth-building" }, "model_changed"],
    [{ meaning: "buy_asset", amount: 1000, asset_kind: "gold" }, "missing_account"],
  ])("sửa bằng dữ liệu mới sai → từ chối, khoản cũ còn nguyên: %j → %s", async (entry, code) => {
    const tx = await spend();
    const res = await call("POST", `/v1/transactions/${tx.id}/replace`, entry);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json.error?.code).toBe(code);
    expect(status(tx.id)).toBe("active");
    expect(count("SELECT COUNT(*) n FROM transactions")).toBe(1);
    expect(book("cash-husband")).toBe(-45_000);
  });

  it("sửa giao dịch từ ngân hàng → bank_tx, không ghi gì mới", async () => {
    const id = await bankSpend();
    const res = await call("POST", `/v1/transactions/${id}/replace`, { meaning: "spend", amount: 80_000, category_id: "fuel-parking" });
    expect(res.json.error?.code).toBe("bank_tx");
    expect(status(id)).toBe("active");
    expect(count("SELECT COUNT(*) n FROM transactions")).toBe(1);
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
    expect(book("cash-husband")).toBe(-50_000);
    // Khoản cũ đã huỷ: sửa lần nữa với client_id khác bị từ chối.
    expect((await call("POST", `/v1/transactions/${tx.id}/replace`, { ...body, client_id: "edit-0003-cccc" })).json.error?.code).toBe("already_void");
  });

  it("sửa giữ chỗ gắn sổ nợ, sổ phải thu, người thuê — kể cả khi khoản đó đã tắt", async () => {
    raw.exec(`INSERT INTO debts (id, name) VALUES ('co-lan', 'Cô Lan');
              INSERT INTO receivables (id, name) VALUES ('em-hai', 'Em Hai');
              INSERT INTO tenants (id, name) VALUES ('chi-lan', 'Chị Lan');`);
    const debtPay = await spend({ debt_id: "co-lan", category_id: "debt-payment" });
    const lend = (await call("POST", "/v1/transactions", { meaning: "lend", amount: 2_000_000, account_id: "vcb-husband", receivable_id: "em-hai" })).json.data.tx;
    const rent = (await call("POST", "/v1/transactions", { meaning: "income", amount: 3_000_000, account_id: "vcb-husband", tenant_id: "chi-lan" })).json.data.tx;
    raw.exec("UPDATE debts SET active = 0; UPDATE receivables SET active = 0; UPDATE tenants SET active = 0;");

    const d = await call("POST", `/v1/transactions/${debtPay.id}/replace`, { meaning: "spend", amount: 60_000, category_id: "debt-payment", debt_id: "co-lan" });
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
    const res = await call("POST", `/v1/transactions/${tx.id}/replace`, { meaning: "spend", amount: 70_000, category_id: "hangouts" }, { "X-Member-Id": "husband" });
    expect(res.json.data.tx).toMatchObject({ by_member_id: "wife", legacy_class: null, amount: 70_000 });
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

  it("mở một giao dịch theo id: cùng hình dạng dòng sổ, kèm cờ đã chia (cách tính cũ) và tên sổ đối ứng", async () => {
    raw.exec("INSERT INTO debts (id, name) VALUES ('co-lan', 'Cô Lan')");
    const income = (await call("POST", "/v1/transactions", { meaning: "income", amount: 10_000_000, account_id: "vcb-husband" })).json.data.tx.id;
    const pay = (await call("POST", "/v1/transactions", { meaning: "spend", amount: 50_000, category_id: "debt-payment", debt_id: "co-lan" })).json.data.tx.id;
    expect((await call("GET", `/v1/transactions/${income}`)).json.data).toMatchObject({ id: income, meaning: "income", allocated: 0 });
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
          `INSERT INTO transactions (log_id, at, amount, meaning, account_id, category_id, week_key, month_key, source)
           VALUES (?, ?, ?, 'spend', 'vcb-husband', 'shopping', '2026-W38', ?, 'sepay')`,
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
      const hoan = await post({ meaning: "refund", amount: 20_000, category_id: "health", account_id: "cash-husband", at: "2026-09-21T12:00:00+07:00" });
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
      // UC-716 AC-21: bộ lọc ví đã bỏ — wallet_id bị bỏ qua; tài khoản khớp cả hai chiều; người ghi; nguồn.
      expect(await ids("month=2026-09&wallet_id=food")).toEqual([hoan, thuoc2, bank, cho, thuoc1]);
      expect(await ids("account_id=cash-wife")).toEqual([thuoc2]);
      expect(await ids("month=2026-09&member_id=wife")).toEqual([thuoc2]);
      expect(await ids("month=2026-09&source=bank")).toEqual([bank]);
      expect(await ids("month=2026-09&source=manual")).toEqual([hoan, thuoc2, cho, thuoc1]);
      // Phân trang giữ bộ lọc.
      expect(await ids(`month=2026-09&category_id=health&limit=1&before=${thuoc2}`)).toEqual([thuoc1]);
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
      await post({ meaning: "refund", amount: 50_000, category_id: "groceries", account_id: "cash-husband", at });
      await post({ meaning: "income", amount: 3_000_000, account_id: "cash-husband", at });
      raw.exec("INSERT INTO receivables (id, name) VALUES ('em-hai', 'Em Hai')");
      await post({ meaning: "lend", amount: 400_000, account_id: "cash-husband", receivable_id: "em-hai", at });
      await post({ meaning: "collect", amount: 100_000, account_id: "cash-husband", receivable_id: "em-hai", at });
      await post({ meaning: "transfer", amount: 700_000, account_id: "cash-husband", to_account_id: "cash-wife", at });
      await post({ meaning: "buy_asset", amount: 500_000, account_id: "cash-husband", asset_kind: "gold", at });
      raw.exec(`INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, week_key, month_key, source)
                VALUES ('2026-09-11T05:00:00.000Z', 30000, 'adjust', NULL, 'cash-husband', '2026-W37', '2026-09', 'manual'),
                       ('2026-09-12T05:00:00.000Z', 12000, 'adjust', 'cash-husband', NULL, '2026-W37', '2026-09', 'manual')`);
      const s = (await call("GET", "/v1/transactions/summary?month=2026-09")).json.data;
      expect(s).toEqual({ count: 9, spend: 500_000, refund: 50_000, income: 3_000_000, lend: 400_000, collect: 100_000, transfer: 700_000, buy_asset: 500_000, adjust_in: 30_000, adjust_out: 12_000 });
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
      expect(await bad("?q=%20%20x%20")).toBe("Từ tìm phải có ít nhất 2 ký tự.");
      expect(await bad(`?q=${"x".repeat(101)}`)).toBe("Từ tìm dài quá 100 ký tự.");
      expect(await bad("?limit=abc")).toBe("limit / before phải là số nguyên.");
    });

    it("UC-111 AC-15: lọc theo khoảng ngày (from_date, to_date), khoảng ngày ghi đè month; summary và phân trang before", async () => {
      const t1 = await post({ meaning: "spend", amount: 10_000, category_id: "groceries", at: "2026-08-28T12:00:00+07:00" });
      const t2 = await post({ meaning: "spend", amount: 20_000, category_id: "groceries", at: "2026-09-01T10:00:00+07:00" });
      const t3 = await post({ meaning: "spend", amount: 30_000, category_id: "groceries", at: "2026-09-15T23:30:00+07:00" });
      const t4 = await post({ meaning: "spend", amount: 40_000, category_id: "groceries", at: "2026-09-20T12:00:00+07:00" });
      const t5 = await post({ meaning: "income", amount: 100_000, account_id: "cash-husband", at: "2026-10-05T12:00:00+07:00" });

      // Lọc từ 01/9 đến 15/9: đúng 2 khoản t3, t2
      expect(await ids("from_date=2026-09-01&to_date=2026-09-15")).toEqual([t3, t2]);
      const sum = (await call("GET", "/v1/transactions/summary?from_date=2026-09-01&to_date=2026-09-15")).json.data;
      expect(sum).toMatchObject({ count: 2, spend: 50_000, income: 0 });

      // Phân trang với con trỏ before khi lọc khoảng ngày
      const p1 = (await call("GET", "/v1/transactions?from_date=2026-09-01&to_date=2026-09-20&limit=2")).json.data.map((r: { id: number }) => r.id);
      expect(p1).toEqual([t4, t3]);
      const p2 = (await call("GET", `/v1/transactions?from_date=2026-09-01&to_date=2026-09-20&limit=2&before=${t3}`)).json.data.map((r: { id: number }) => r.id);
      expect(p2).toEqual([t2]);

      // Chỉ from_date: từ 20/9 đến nay (gồm t5, t4)
      expect(await ids("from_date=2026-09-20")).toEqual([t5, t4]);

      // Chỉ to_date: đến hết 01/9 (gồm t2, t1)
      expect(await ids("to_date=2026-09-01")).toEqual([t2, t1]);

      // Gửi cả month=2026-10 nhưng có from_date/to_date: khoảng ngày ghi đè month
      expect(await ids("month=2026-10&from_date=2026-09-01&to_date=2026-09-15")).toEqual([t3, t2]);

      // Validation: from_date > to_date
      const resOrder = await call("GET", "/v1/transactions?from_date=2026-10-10&to_date=2026-10-01");
      expect(resOrder.status).toBe(400);
      expect(resOrder.json.error?.message).toBe("from_date không được sau to_date.");

      // Validation: sai định dạng hoặc ngày không tồn tại
      const resFormat = await call("GET", "/v1/transactions?from_date=2026-9");
      expect(resFormat.status).toBe(400);
      expect(resFormat.json.error?.message).toBe("from_date phải có dạng YYYY-MM-DD.");

      const resNotExist = await call("GET", "/v1/transactions?from_date=2026-02-30");
      expect(resNotExist.status).toBe(400);
      expect(resNotExist.json.error?.message).toBe("from_date phải có dạng YYYY-MM-DD.");

      // Validation: ngày tương lai
      const resFuture = await call("GET", "/v1/transactions?from_date=2099-01-01");
      expect(resFuture.status).toBe(400);
      expect(resFuture.json.error?.message).toBe("Ngày lọc không được sau hôm nay.");
    });
  });
});

describe("hộ mẫu E sau 0040: không còn ví (ledger UC-111, UC-107, UC-103; receivable UC-1005)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-01T09:00:00+07:00"));
    raw = householdE();
    env = { ...env, DB: asD1(raw) };
  });
  afterEach(() => vi.useRealTimers());

  it("UC-111 AC-18: bootstrap không wallets, accounts[] không locked; dòng cũ có legacy true + legacy_class, không cột ví; khoản mới legacy false; khoản thu cũ đã chia allocated; lý do lần chia Tích sản 0 giữ", async () => {
    const boot = (await call("GET", "/v1/bootstrap")).json.data;
    expect(boot).not.toHaveProperty("wallets");
    for (const a of boot.accounts) {
      expect(a).not.toHaveProperty("locked");
      expect(a).not.toHaveProperty("role");
    }
    const created = await call("POST", "/v1/transactions", { meaning: "spend", amount: 50_000, category_id: "cho-nau", account_id: E_ACCOUNTS.main, at: "2026-11-25T12:00:00+07:00" });
    expect(created.status).toBe(201);
    const list = (await call("GET", "/v1/transactions?month=2026-11&limit=50")).json.data as Record<string, unknown>[];
    const byId = (id: unknown) => list.find((t) => t.id === id)!;
    for (const t of list) for (const k of ["wallet_id", "counter_wallet_id", "wallet_name"]) expect(t).not.toHaveProperty(k);
    expect(byId(950)).toMatchObject({ amount: 150_000, legacy: true, legacy_class: "essential" });
    expect(byId(951)).toMatchObject({ amount: 400_000, legacy: true, legacy_class: "flex" });
    expect(byId(created.json.data.tx.id)).toMatchObject({ legacy: false, legacy_class: null });
    expect(byId(900)).toMatchObject({ allocated: 1, legacy: true, wealth_note: null });
    expect(byId(901)).toMatchObject({ allocated: 1, wealth_note: "Tháng này trả viện phí" });
    const one = (await call("GET", "/v1/transactions/950")).json.data;
    expect(one).toMatchObject({ legacy: true, legacy_class: "essential" });
    expect(one).not.toHaveProperty("wallet_name");
  });

  it("UC-107 AC-14: GET /v1/wealth-building → 410 model_changed; schema không còn view ví; GET /v1/goals có Học phí held 10.000.000 khi gắn tài khoản tiết kiệm", async () => {
    const gone = await call("GET", "/v1/wealth-building");
    expect([gone.status, gone.json.error?.code]).toEqual([410, "model_changed"]);
    const views = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'view' AND name IN ('v_wealth_building', 'v_safety_fund', 'v_goal_progress', 'v_must_monthly_avg')").all();
    expect(views).toEqual([]);
    raw.exec(`UPDATE reserve_goals SET account_id = '${E_ACCOUNTS.deposit}' WHERE id = 'hoc-phi'`);
    const goals = (await call("GET", "/v1/goals")).json.data;
    expect(goals.reserve.goals.find((g: { id: string }) => g.id === "hoc-phi")).toMatchObject({ name: "Học phí", accountId: E_ACCOUNTS.deposit, held: 10_000_000 });
    expect(goals.reserve.goals.find((g: { id: string }) => g.id === "thue")).toMatchObject({ accountId: null, held: null });
  });

  it("UC-103 AC-23: snapshot không còn khoá theo ví; excluded đúng ba khoá; reserve không holds / held; conversion { done 0, total 5, next pockets }", async () => {
    const s = (await call("GET", "/v1/snapshot")).json.data;
    for (const k of ["tiers", "wallets", "spendableThisWeek", "spendableByWallet", "reserves", "safetyFund", "goals", "wealthBuilding"]) expect(s).not.toHaveProperty(k);
    for (const k of ["unallocatedIncome", "transferOrdersPending", "transferOrdersOverdue"]) expect(s.attention).not.toHaveProperty(k);
    expect(s.nearSpend).not.toHaveProperty("leaving");
    expect(s.nearSpend).not.toHaveProperty("misplaced");
    expect(s.nearSpend.excluded.length).toBeGreaterThan(0);
    for (const e of s.nearSpend.excluded) expect(Object.keys(e).sort()).toEqual(["accountId", "name", "pocket"]);
    expect(s.pockets.reserve).not.toHaveProperty("holds");
    for (const a of s.pockets.reserve.accounts) {
      expect(a).not.toHaveProperty("held");
      expect(a).not.toHaveProperty("heldOver");
    }
    expect(s.conversion).toEqual({ done: 0, total: 5, next: "pockets" });
    expect(s.pockets.savings.total).toBe(6_000_000);
    expect(s.pockets.reserve).toMatchObject({ total: 19_000_000, peace: 15_000_000, reward: { accountId: E_ACCOUNTS.reserve, balance: 4_000_000 } });
    expect(s.pockets.unconfirmed).toBe(6);
  });

  it("UC-1005 AC-10: networth không có wealthBuildingCash, wealthBuildingAccounts, spendableThisWeek, savings.earmarks; pockets.savings 6.000.000 bằng snapshot", async () => {
    const n = (await call("GET", "/v1/networth")).json.data;
    for (const k of ["wealthBuildingCash", "wealthBuildingAccounts", "spendableThisWeek"]) expect(n).not.toHaveProperty(k);
    expect(n.savings).toEqual({ accounts: [{ id: E_ACCOUNTS.savings, name: "Tài khoản tích luỹ", balance: 6_000_000 }] });
    const s = (await call("GET", "/v1/snapshot")).json.data;
    expect(n.pockets.savings).toBe(6_000_000);
    expect(n.pockets.savings).toBe(s.pockets.savings.total);
  });
});
