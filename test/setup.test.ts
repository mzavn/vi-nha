// UC-510: thiết lập nhà lần đầu trên DB chỉ có docs/schema.sql (bản public, không hộ mẫu).
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRONS, runScheduled } from "../src/cron";
import { DomainError } from "../src/domain/types";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { createHousehold, parseSetup } from "../src/services/setup";
import { isIconName } from "../web/src/ui/icon-names";
import { asD1, openDb, readSql } from "./helpers/d1-sqlite";

let raw: DatabaseSync;
let env: Env;

const freshDb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readSql("docs/schema.sql"));
  return db;
};

beforeEach(() => {
  raw = freshDb();
  env = { DB: asD1(raw), API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
});

type Json = { ok: boolean; data: unknown; error?: { code: string; message: string; field?: string } };
const IP = "203.0.113.7";

async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: { "CF-Connecting-IP": IP, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json, cookie: res.headers.get("Set-Cookie")?.split(";")[0] ?? null };
}

const setupBody = (over: Record<string, unknown> = {}) => ({
  password: "mat-khau-chung",
  members: [{ name: "Bố", password: "mat-khau-rieng-cua-bo" }, { name: "Mẹ" }],
  accounts: [
    { name: "Tiền mặt", kind: "cash", owner: null },
    { name: "VCB của Bố", kind: "bank", bank: "Vietcombank", owner: 0 },
  ],
  template: { taxable: true, must: ["food", "housing", "transport", "utilities"] },
  ...over,
});

const count = (table: string) => Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
const nothingCreated = () => {
  expect(count("members")).toBe(0);
  expect(count("accounts")).toBe(0);
  expect(count("wallets")).toBe(0);
  expect(raw.prepare("SELECT v FROM config WHERE k = 'setup_done'").get()).toBeUndefined();
};
const loginFailures = () => raw.prepare("SELECT failures FROM auth_failures WHERE scope = 'login' AND ip = ?").get(IP);

describe("UC-510 thiết lập nhà lần đầu", () => {
  it("AC-1: GET /v1/setup không cần đăng nhập — DB chỉ có schema → needed true; có setup_done → needed false, không trả gì khác", async () => {
    const before = await request("GET", "/v1/setup");
    expect(before.status).toBe(200);
    expect(before.json.data).toEqual({ needed: true });
    env = { ...env, DB: asD1(openDb()) };
    expect((await request("GET", "/v1/setup")).json.data).toEqual({ needed: false });
  });

  describe("AC-2: sai mật khẩu chung", () => {
    it("sai mật khẩu chung → 401 wrong_password, tính một lần sai vào bộ chặn dò, không tạo gì", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const res = await request("POST", "/v1/setup", setupBody({ password: "sai" }));
      expect(res.status).toBe(401);
      expect(res.json.error).toMatchObject({ code: "wrong_password", field: "password" });
      expect(loginFailures()).toEqual({ failures: 1 });
      nothingCreated();
    });

    it("APP_PASSWORD chưa đặt hoặc rỗng → luôn 401, bất kể body (kể cả mật khẩu rỗng)", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      env = { ...env, APP_PASSWORD: "" };
      expect((await request("POST", "/v1/setup", setupBody({ password: "" }))).status).toBe(401);
      env = { ...env, APP_PASSWORD: undefined as unknown as string };
      expect((await request("POST", "/v1/setup", setupBody({ password: "" }))).status).toBe(401);
      expect((await request("POST", "/v1/setup", { members: [] })).status).toBe(401);
      nothingCreated();
    });

    it("đang bị chặn dò → 429 kiểm trước khi so, kể cả mật khẩu đúng; không tạo gì", async () => {
      raw.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('login', ?, ?, 10)").run(IP, new Date().toISOString());
      const res = await request("POST", "/v1/setup", setupBody());
      expect(res.status).toBe(429);
      expect(res.json.error?.code).toBe("too_many_attempts");
      nothingCreated();
    });
  });

  it("AC-3: đúng mật khẩu, body hợp lệ → 201 chủ hộ + cookie của chủ hộ; thành viên theo thứ tự, mật khẩu riêng lưu băm, tài khoản, setup_done, nhật ký setup.done", async () => {
    const res = await request("POST", "/v1/setup", setupBody());
    expect(res.status).toBe(201);
    expect(res.json.data).toEqual({ member: { id: "bo", name: "Bố" } });
    const members = raw.prepare("SELECT id, name, role, active, password_hash, session_gen FROM members ORDER BY rowid").all();
    expect(members.map(({ password_hash, ...m }) => m)).toEqual([
      { id: "bo", name: "Bố", role: "owner", active: 1, session_gen: 0 },
      { id: "me", name: "Mẹ", role: "adult", active: 1, session_gen: 0 },
    ]);
    expect(members[0]!.password_hash).toMatch(/^pbkdf2-sha256\$20000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(members[1]!.password_hash).toBeNull();
    expect(raw.prepare("SELECT id, name, kind, bank, owner_member_id, spendable FROM accounts ORDER BY rowid").all()).toEqual([
      { id: "tien-mat", name: "Tiền mặt", kind: "cash", bank: null, owner_member_id: null, spendable: 1 },
      { id: "vcb-cua-bo", name: "VCB của Bố", kind: "bank", bank: "Vietcombank", owner_member_id: "bo", spendable: 1 },
    ]);
    expect(raw.prepare("SELECT v FROM config WHERE k = 'setup_done'").get()?.v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(raw.prepare("SELECT member_id, via, action FROM audit_log").all()).toEqual([{ member_id: "bo", via: "session", action: "setup.done" }]);
    // Cookie của chủ hộ dùng được ngay; chủ hộ có mật khẩu riêng nên vào bằng mật khẩu riêng.
    expect(res.cookie).toMatch(/^pf_session=bo\.p\.0\.\d+\.[A-Za-z0-9_-]+$/);
    const session = await request("GET", "/v1/session", undefined, { Cookie: res.cookie! });
    expect(session.json.data).toEqual({ member: { id: "bo", name: "Bố" } });
    expect((await request("GET", "/v1/snapshot", undefined, { Cookie: res.cookie! })).status).toBe(200);
    expect((await request("GET", "/v1/setup")).json.data).toEqual({ needed: false });
  });

  it("AC-3: chủ hộ không có mật khẩu riêng → cookie vào bằng mật khẩu chung; người sau đăng nhập bằng mật khẩu chung", async () => {
    const res = await request("POST", "/v1/setup", setupBody({ members: [{ name: "Bố" }, { name: "Mẹ" }] }));
    expect(res.status).toBe(201);
    expect(res.cookie).toMatch(/^pf_session=bo\.h\.0\./);
    expect((await request("GET", "/v1/snapshot", undefined, { Cookie: res.cookie! })).status).toBe(200);
    const login = await request("POST", "/v1/session", { member_id: "me", password: "mat-khau-chung" });
    expect(login.status).toBe(200);
  });

  describe("AC-4: body lỗi → 400 invalid_input kèm field, không tạo gì", () => {
    const six = Array.from({ length: 7 }, (_, i) => ({ name: `Người ${i + 1}` }));
    const cases: [string, Record<string, unknown>, string][] = [
      ["0 thành viên", { members: [] }, "members"],
      ["hơn 6 thành viên", { members: six }, "members"],
      ["thiếu members", { members: undefined }, "members"],
      ["tên rỗng", { members: [{ name: "  " }] }, "members.0.name"],
      ["tên dài hơn 40 ký tự", { members: [{ name: "A".repeat(41) }] }, "members.0.name"],
      ["tên trùng (không phân biệt hoa thường, bỏ dấu cách hai đầu)", { members: [{ name: "Bố" }, { name: " bố " }] }, "members.1.name"],
      ["hai tên ra cùng mã (Mẹ / Me)", { members: [{ name: "Mẹ" }, { name: "Me" }] }, "members.1.name"],
      ["mật khẩu riêng ngắn hơn 8 ký tự", { members: [{ name: "Bố" }, { name: "Mẹ", password: "1234567" }] }, "members.1.password"],
      ["không có tài khoản", { accounts: [] }, "accounts"],
      ["tên tài khoản rỗng", { accounts: [{ name: "", kind: "cash", owner: null }] }, "accounts.0.name"],
      ["tên tài khoản trùng", { accounts: [{ name: "VCB", kind: "cash", owner: null }, { name: "vcb", kind: "cash", owner: null }] }, "accounts.1.name"],
      ["tên tài khoản ra cùng mã", { accounts: [{ name: "Tiền mặt", kind: "cash", owner: null }, { name: "Tien mat", kind: "cash", owner: null }] }, "accounts.1.name"],
      ["loại tài khoản lạ", { accounts: [{ name: "Vàng", kind: "gold", owner: null }] }, "accounts.0.kind"],
      ["ngân hàng ngoài danh mục", { accounts: [{ name: "TK", kind: "cash", owner: null }, { name: "NH lạ", kind: "bank", bank: "KhongCo", owner: null }] }, "accounts.1.bank"],
      ["owner ngoài khoảng chỉ số", { accounts: [{ name: "TK", kind: "cash", owner: null }, { name: "TK 2", kind: "cash", owner: 2 }] }, "accounts.1.owner"],
      ["owner âm", { accounts: [{ name: "TK", kind: "cash", owner: -1 }] }, "accounts.0.owner"],
      ["ví Must ngoài danh sách", { template: { taxable: false, must: ["food", "garden"] } }, "template.must"],
      ["ví Must trùng", { template: { taxable: false, must: ["food", "food"] } }, "template.must"],
    ];
    it.each(cases)("%s", async (_title, over, field) => {
      const res = await request("POST", "/v1/setup", setupBody(over));
      expect(res.status).toBe(400);
      expect(res.json.error).toMatchObject({ code: "invalid_input", field });
      nothingCreated();
    });
  });

  describe("AC-5: đã thiết lập", () => {
    it("POST /v1/setup lần nữa (kể cả mật khẩu đúng) → 409 already_setup, không đổi gì", async () => {
      expect((await request("POST", "/v1/setup", setupBody())).status).toBe(201);
      const again = await request("POST", "/v1/setup", setupBody({ members: [{ name: "Người lạ" }] }));
      expect(again.status).toBe(409);
      expect(again.json.error?.code).toBe("already_setup");
      expect(count("members")).toBe(2);
      expect(count("audit_log")).toBe(1);
    });

    it("hai yêu cầu cùng lúc: chỉ một tạo được nhà, yêu cầu kia 409, không lỗi 500", async () => {
      const results = await Promise.all([request("POST", "/v1/setup", setupBody()), request("POST", "/v1/setup", setupBody({ members: [{ name: "Ông" }] }))]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(count("audit_log")).toBe(1);
      expect([1, 2]).toContain(count("members"));
    });

    it("batch vấp khoá chính của dòng setup_done (yêu cầu kia vừa xong) → 409 already_setup, cả batch huỷ", async () => {
      const input = parseSetup(setupBody());
      await createHousehold(env.DB, input);
      const second = createHousehold(env.DB, parseSetup(setupBody({ members: [{ name: "Ông" }] })));
      await expect(second).rejects.toBeInstanceOf(DomainError);
      await expect(second).rejects.toMatchObject({ code: "already_setup", status: 409 });
      expect(raw.prepare("SELECT id FROM members ORDER BY rowid").all()).toEqual([{ id: "bo" }, { id: "me" }]);
    });
  });

  describe("AC-6: mẫu Profit First cơ bản", () => {
    it("có thuế, chọn đủ bốn ví Must: ví, luật nạp, danh mục có icon; mọi ví trú ở tài khoản ngân hàng đầu tiên", async () => {
      expect((await request("POST", "/v1/setup", setupBody())).status).toBe(201);
      expect(raw.prepare("SELECT id, name, tier, must_group, kind, scope, account_id, private FROM wallets ORDER BY sort").all()).toEqual([
        { id: "income", name: "Thu nhập", tier: "holding", must_group: null, kind: "holding", scope: "shared", account_id: "vcb-cua-bo", private: 0 },
        { id: "wealth-building", name: "Tích sản", tier: "wealth_building", must_group: null, kind: "accrual", scope: "shared", account_id: "vcb-cua-bo", private: 0 },
        { id: "tax", name: "Thuế", tier: "tax", must_group: null, kind: "accrual", scope: "shared", account_id: "vcb-cua-bo", private: 0 },
        { id: "housing", name: "Nhà ở", tier: "must", must_group: "must", kind: "accrual", scope: "shared", account_id: "vcb-cua-bo", private: 0 },
        { id: "food", name: "Ăn uống", tier: "must", must_group: "must", kind: "envelope", scope: "shared", account_id: "vcb-cua-bo", private: 0 },
        { id: "transport", name: "Đi lại", tier: "must", must_group: "must", kind: "envelope", scope: "shared", account_id: "vcb-cua-bo", private: 0 },
        { id: "utilities", name: "Điện nước", tier: "must", must_group: "must", kind: "bill", scope: "shared", account_id: "vcb-cua-bo", private: 0 },
        { id: "nice-to-have", name: "Có thì tốt", tier: "must", must_group: "have", kind: "envelope", scope: "shared", account_id: "vcb-cua-bo", private: 0 },
      ]);
      expect(raw.prepare("SELECT wallet_id, mode, period, percent, amount FROM allocations WHERE active = 1 ORDER BY priority").all()).toEqual([
        { wallet_id: "wealth-building", mode: "percent", period: "month", percent: 0.1, amount: null },
        { wallet_id: "tax", mode: "percent", period: "month", percent: 0.1, amount: null },
        { wallet_id: "nice-to-have", mode: "remainder", period: "month", percent: null, amount: null },
      ]);
      const categories = raw.prepare("SELECT id, name, default_wallet_id, icon FROM categories ORDER BY sort").all();
      expect(categories).toEqual([
        { id: "housing", name: "Nhà ở", default_wallet_id: "housing", icon: "home" },
        { id: "groceries", name: "Đi chợ / nấu ăn", default_wallet_id: "food", icon: "basket" },
        { id: "eating-out", name: "Ăn ngoài", default_wallet_id: "food", icon: "utensils" },
        { id: "utilities", name: "Điện nước mạng", default_wallet_id: "utilities", icon: "zap" },
        { id: "fuel-parking", name: "Xăng xe / gửi xe", default_wallet_id: "transport", icon: "fuel" },
        { id: "ride-hailing", name: "Grab / taxi", default_wallet_id: "transport", icon: "car" },
        { id: "health", name: "Y tế", default_wallet_id: "nice-to-have", icon: "pill" },
        { id: "lending", name: "Cho vay / trả hộ", default_wallet_id: "nice-to-have", icon: "swap" },
        { id: "debt-payment", name: "Trả nợ", default_wallet_id: "nice-to-have", icon: "credit-card" },
        { id: "shopping", name: "Mua sắm", default_wallet_id: "nice-to-have", icon: "bag" },
      ]);
      expect(categories.every((c) => isIconName(String(c.icon)))).toBe(true);
    });

    it("không có thuế, không chọn ví Must, không có tài khoản ngân hàng: không có ví Thuế, chỉ bốn danh mục luôn có, ví trú ở tài khoản đầu tiên", async () => {
      const body = setupBody({ accounts: [{ name: "Tiền mặt", kind: "cash", owner: null }, { name: "Momo", kind: "ewallet", bank: "MoMo", owner: 1 }], template: { taxable: false, must: [] } });
      expect((await request("POST", "/v1/setup", body)).status).toBe(201);
      expect(raw.prepare("SELECT id, account_id FROM wallets ORDER BY sort").all()).toEqual([
        { id: "income", account_id: "tien-mat" },
        { id: "wealth-building", account_id: "tien-mat" },
        { id: "nice-to-have", account_id: "tien-mat" },
      ]);
      expect(raw.prepare("SELECT id FROM categories ORDER BY sort").all().map((c) => c.id)).toEqual(["health", "lending", "debt-payment", "shopping"]);
    });

    it("sau thiết lập ghi được khoản chi ngay; chia thử 10.000.000: Tích sản 1.000.000, Thuế 1.000.000, Có thì tốt nhận phần còn lại", async () => {
      const { cookie } = await request("POST", "/v1/setup", setupBody());
      const headers = { Cookie: cookie! };
      const spend = await request("POST", "/v1/transactions", { meaning: "spend", amount: 50_000, category_id: "groceries", account_id: "tien-mat" }, headers);
      expect(spend.status).toBe(201);
      const taxable = await request("POST", "/v1/allocate/preview", { amount: 10_000_000, taxable: true, account_id: "vcb-cua-bo" }, headers);
      expect(taxable.status).toBe(200);
      expect(taxable.json.data).toMatchObject({
        funds: [
          { walletId: "wealth-building", amount: 1_000_000 },
          { walletId: "tax", amount: 1_000_000 },
          { walletId: "nice-to-have", amount: 8_000_000 },
        ],
      });
      const untaxed = await request("POST", "/v1/allocate/preview", { amount: 10_000_000, account_id: "vcb-cua-bo" }, headers);
      expect(untaxed.json.data).toMatchObject({
        funds: [
          { walletId: "wealth-building", amount: 1_000_000 },
          { walletId: "nice-to-have", amount: 9_000_000 },
        ],
      });
    });
  });

  describe("AC-7: chưa thiết lập", () => {
    it("POST /v1/session → 409 setup_required; /v1/* cần đăng nhập → 401 như hiện nay", async () => {
      const login = await request("POST", "/v1/session", { member_id: "bo", password: "mat-khau-chung" });
      expect(login.status).toBe(409);
      expect(login.json.error?.code).toBe("setup_required");
      expect((await request("GET", "/v1/snapshot")).status).toBe(401);
    });

    it("đăng nhập khi đang bị chặn dò vẫn 429 trước, rồi mới tới 409 setup_required", async () => {
      raw.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('login', ?, ?, 10)").run(IP, new Date().toISOString());
      expect((await request("POST", "/v1/session", { member_id: "bo", password: "mat-khau-chung" })).status).toBe(429);
    });

    it("REST bằng token và cron chạy không lỗi khi chưa có thành viên", async () => {
      const auth = { Authorization: "Bearer tok" };
      expect((await request("GET", "/v1/settings", undefined, auth)).status).toBe(200);
      expect((await request("GET", "/v1/session/members")).json.data).toEqual([]);
      // 07:00 thứ Hai giờ VN: lượt có cả tin sáng lẫn tin tuần.
      await expect(runScheduled(CRONS.quarterHour, env, new Date("2026-10-05T00:00:00.000Z"))).resolves.toBeUndefined();
    });
  });
});
