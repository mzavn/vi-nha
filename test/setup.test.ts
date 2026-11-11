// UC-510: thiết lập nhà lần đầu trên DB chỉ có docs/schema.sql (bản public, không hộ mẫu).
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRONS, runScheduled } from "../src/cron";
import { DomainError } from "../src/domain/types";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { createHousehold, parseSetup } from "../src/services/setup";
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

type Json = { ok: boolean; data: unknown; error?: { code: string; message: string; field?: string; fields?: string[] } };
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
  ...over,
});

const count = (table: string) => Number(raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
const all = (sql: string) => raw.prepare(sql).all() as Record<string, unknown>[];
const nothingCreated = () => {
  expect(count("members")).toBe(0);
  expect(count("accounts")).toBe(0);
  expect(count("category_groups")).toBe(0);
  expect(count("categories WHERE id <> 'loan-interest'")).toBe(0); // danh mục hệ thống "Lãi vay" có sẵn từ schema
  expect(count("income_streams")).toBe(0);
  expect(count("reserve_goals")).toBe(0);
  expect(raw.prepare("SELECT v FROM config WHERE k = 'setup_done'").get()).toBeUndefined();
  expect(raw.prepare("SELECT v FROM config WHERE k = 'payday_day'").get()).toBeUndefined();
};
/** Không còn bảng ví / luật nạp / phần giữ riêng; thiết lập không ghi `conversion_state` (chỉ nhà lên từ 1.x mới có). */
const noWallets = () => {
  expect(all("SELECT name FROM sqlite_master WHERE name IN ('wallets', 'allocations', 'earmarks', 'earmark_lines')")).toEqual([]);
  expect(raw.prepare("SELECT v FROM config WHERE k = 'conversion_state'").get()).toBeUndefined();
};
const goals = () => all("SELECT id, name, account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date FROM reserve_goals ORDER BY sort, id");
const groups = () => all("SELECT id, name, essential, cycle_limit FROM category_groups ORDER BY sort");
const auth = { Authorization: "Bearer tok" };
const api = (method: string, path: string, body?: unknown) => request(method, path, body, auth);
/** Nhập thu nhập nguồn "Lương" (bước Nhập của app) vào tài khoản `account`. */
const salary = (account: string, amount = 20_000_000) => api("POST", "/v1/transactions", { meaning: "income", amount, account_id: account, income_stream_id: "luong" });
type Task = { id: number; kind: string; amount: number; goal: { id: string; name: string } | null; toPocket: string | null };
type Snap = {
  pockets: Record<"savings" | "reserve" | "operating" | "outside", { total: number; accounts: { id: string }[] }>;
  paySetup: { hasCycleStream: boolean };
  payCycle: { tasks: Task[] } | null;
};
const snap = async () => (await api("GET", "/v1/snapshot")).json.data as Snap;
const tasks = async () => (await snap()).payCycle!.tasks.map((t) => [t.kind, t.goal?.name ?? t.toPocket, t.amount]);
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

  it("AC-3: đúng mật khẩu, body hợp lệ → 201 chủ hộ + cookie của chủ hộ; thành viên theo thứ tự, mật khẩu riêng lưu băm, tài khoản theo ngăn đã xác nhận, ngày lương, % Tích luỹ, nhóm danh mục, nguồn Lương mở kỳ, không ví / luật nạp, setup_done, nhật ký setup.done", async () => {
    const res = await request(
      "POST",
      "/v1/setup",
      setupBody({
        accounts: [
          { name: "Tiền mặt", kind: "cash", owner: null },
          { name: "VCB của Bố", kind: "bank", bank: "Vietcombank", owner: 0, pocket: "reserve" },
        ],
        payday_day: 5,
        savings_pct: 20,
        groups: ["utilities", "housing"],
        taxable: true,
      }),
    );
    expect(res.status).toBe(201);
    expect(res.json.data).toEqual({ member: { id: "bo", name: "Bố" } });
    const members = raw.prepare("SELECT id, name, role, active, password_hash, session_gen FROM members ORDER BY rowid").all();
    expect(members.map(({ password_hash, ...m }) => m)).toEqual([
      { id: "bo", name: "Bố", role: "owner", active: 1, session_gen: 0 },
      { id: "me", name: "Mẹ", role: "adult", active: 1, session_gen: 0 },
    ]);
    expect(members[0]!.password_hash).toMatch(/^pbkdf2-sha256\$20000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(members[1]!.password_hash).toBeNull();
    expect(all("SELECT id, name, kind, bank, owner_member_id, pocket, pocket_confirmed FROM accounts ORDER BY rowid")).toEqual([
      { id: "tien-mat", name: "Tiền mặt", kind: "cash", bank: null, owner_member_id: null, pocket: "operating", pocket_confirmed: 1 },
      { id: "vcb-cua-bo", name: "VCB của Bố", kind: "bank", bank: "Vietcombank", owner_member_id: "bo", pocket: "reserve", pocket_confirmed: 1 },
    ]);
    expect(all("SELECT k, v FROM config WHERE k IN ('payday_day', 'savings_pct') ORDER BY k")).toEqual([
      { k: "payday_day", v: "5" },
      { k: "savings_pct", v: "20" },
    ]);
    expect(groups()).toEqual([
      { id: "nha-o", name: "Nhà ở", essential: 1, cycle_limit: null },
      { id: "dien-nuoc", name: "Điện nước", essential: 1, cycle_limit: null },
      { id: "y-te", name: "Y tế", essential: 1, cycle_limit: null },
      { id: "mua-sam", name: "Mua sắm", essential: 0, cycle_limit: null },
    ]);
    expect(all("SELECT id, name, group_id FROM categories WHERE id <> 'loan-interest' ORDER BY sort")).toEqual([
      { id: "housing", name: "Nhà ở", group_id: "nha-o" },
      { id: "utilities", name: "Điện nước mạng", group_id: "dien-nuoc" },
      { id: "health", name: "Y tế", group_id: "y-te" },
      { id: "lending", name: "Cho vay / trả hộ", group_id: null },
      { id: "debt-payment", name: "Trả nợ", group_id: null },
      { id: "shopping", name: "Mua sắm", group_id: "mua-sam" },
    ]);
    expect(all("SELECT id, name, pocket, opens_cycle, active FROM income_streams")).toEqual([{ id: "luong", name: "Lương", pocket: null, opens_cycle: 1, active: 1 }]);
    noWallets();
    expect(raw.prepare("SELECT v FROM config WHERE k = 'setup_done'").get()?.v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(all("SELECT member_id, via, action FROM audit_log")).toEqual([{ member_id: "bo", via: "session", action: "setup.done" }]);
    expect(JSON.parse(String(raw.prepare("SELECT detail FROM audit_log").get()?.detail))).toEqual({
      members: 2,
      accounts: 2,
      pockets: { savings: 0, reserve: 1, operating: 1, outside: 0 },
      payday_day: 5,
      savings_pct: 20,
      groups: ["housing", "utilities"],
      goals: 0,
      taxable: true,
    });
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
      ["ngăn lạ", { accounts: [{ name: "TK", kind: "cash", owner: null, pocket: "spend" }] }, "accounts.0.pocket"],
      ["ngày lương ngoài 1–31", { payday_day: 32 }, "payday_day"],
      ["ngày lương không nguyên", { payday_day: 10.5 }, "payday_day"],
      ["% Tích luỹ 0", { savings_pct: 0 }, "savings_pct"],
      ["% Tích luỹ hơn 100", { savings_pct: 101 }, "savings_pct"],
      ["taxable không phải true / false", { taxable: "có" }, "taxable"],
      ["nhóm lạ", { groups: ["wallet"] }, "groups"],
      ["nhóm trùng", { groups: ["food", "food"] }, "groups"],
      ["groups không phải mảng", { groups: "food" }, "groups"],
      ["goals không phải mảng", { goals: { name: "Học phí" } }, "goals"],
      ["hơn 10 mục tiêu", { goals: Array.from({ length: 11 }, (_, i) => ({ name: `Mục ${i + 1}`, monthly_amount: 100_000 })) }, "goals"],
      ["tên mục tiêu trống", { goals: [{ name: " ", monthly_amount: 100_000 }] }, "goals.0.name"],
      ["tên mục tiêu dài hơn 60", { goals: [{ name: "A".repeat(61), monthly_amount: 100_000 }] }, "goals.0.name"],
      ["hai mục tiêu cùng mã", { goals: [{ name: "Học phí", monthly_amount: 100_000 }, { name: "hoc phi", monthly_amount: 100_000 }] }, "goals.1.name"],
      ["số mỗi tháng ≤ 0", { goals: [{ name: "Học phí", monthly_amount: 0 }] }, "goals.0.monthly_amount"],
      ["số mỗi tháng thiếu", { goals: [{ name: "Học phí" }] }, "goals.0.monthly_amount"],
      ["số mỗi tháng quá 1e12", { goals: [{ name: "Học phí", monthly_amount: 1e12 + 1 }] }, "goals.0.monthly_amount"],
      ["mấy tháng một lần ngoài 1–12", { goals: [{ name: "Học phí", monthly_amount: 100_000, repeat_months: 13 }] }, "goals.0.repeat_months"],
      ["hạn sai dạng", { goals: [{ name: "Học phí", monthly_amount: 100_000, due_date: "2027-02-30" }] }, "goals.0.due_date"],
      ["tài khoản của mục tiêu ngoài danh sách", { goals: [{ name: "Học phí", monthly_amount: 100_000, account: 5 }] }, "goals.0.account"],
      ["tài khoản của mục tiêu không phải chỉ số", { goals: [{ name: "Học phí", monthly_amount: 100_000, account: "vcb-cua-bo" }] }, "goals.0.account"],
    ];
    it.each(cases)("%s", async (_title, over, field) => {
      const res = await request("POST", "/v1/setup", setupBody(over));
      expect(res.status).toBe(400);
      expect(res.json.error).toMatchObject({ code: "invalid_input", field });
      nothingCreated();
    });

    it("thân còn `template` của bộ ví mẫu cũ → 400 model_changed, không tạo gì", async () => {
      const res = await request("POST", "/v1/setup", setupBody({ template: { taxable: true, must: ["food"] } }));
      expect(res.status).toBe(400);
      expect(res.json.error).toMatchObject({ code: "model_changed", fields: ["template"] });
      nothingCreated();
    });
  });

  it("AC-9: ba ngăn đủ — ngăn theo thân, nhóm Ăn uống / Đi lại / Y tế / Mua sắm, Học phí và Thuế chưa gắn tài khoản (thân không gửi account), không giữ riêng Tích luỹ; snapshot ba ngăn, có nguồn mở kỳ; lương 20.000.000 vào tài khoản chính → kỳ mở, ① 3.000.000", async () => {
    const res = await request(
      "POST",
      "/v1/setup",
      setupBody({
        accounts: [
          { name: "VCB chính", kind: "bank", bank: "Vietcombank", owner: null, pocket: "operating" },
          { name: "Techcom tích luỹ", kind: "bank", bank: "Techcombank", owner: null, pocket: "savings" },
          { name: "MB tiết kiệm", kind: "bank", bank: "MBBank", owner: null, pocket: "reserve" },
          { name: "Tiền mặt", kind: "cash", owner: null },
          { name: "Thẻ VIB", kind: "credit", bank: "VIB", owner: 0 },
        ],
        payday_day: 10,
        savings_pct: 15,
        groups: ["food", "transport"],
        taxable: true,
        goals: [{ name: "Học phí", monthly_amount: 2_000_000, repeat_months: 3 }],
      }),
    );
    expect(res.status).toBe(201);
    expect(all("SELECT id, pocket, pocket_confirmed FROM accounts ORDER BY rowid")).toEqual([
      { id: "vcb-chinh", pocket: "operating", pocket_confirmed: 1 },
      { id: "techcom-tich-luy", pocket: "savings", pocket_confirmed: 1 },
      { id: "mb-tiet-kiem", pocket: "reserve", pocket_confirmed: 1 },
      { id: "tien-mat", pocket: "operating", pocket_confirmed: 1 },
      { id: "the-vib", pocket: "operating", pocket_confirmed: 1 },
    ]);
    expect(groups()).toEqual([
      { id: "an-uong", name: "Ăn uống", essential: 1, cycle_limit: null },
      { id: "di-lai", name: "Đi lại", essential: 1, cycle_limit: null },
      { id: "y-te", name: "Y tế", essential: 1, cycle_limit: null },
      { id: "mua-sam", name: "Mua sắm", essential: 0, cycle_limit: null },
    ]);
    expect(all("SELECT name FROM categories WHERE group_id = 'an-uong' ORDER BY sort")).toEqual([{ name: "Đi chợ / nấu ăn" }, { name: "Ăn ngoài" }]);
    expect(goals()).toEqual([
      { id: "hoc-phi", name: "Học phí", account_id: null, target_amount: 6_000_000, target_pct: null, monthly_amount: 2_000_000, repeat_months: 3, due_date: null },
      { id: "thue", name: "Thuế", account_id: null, target_amount: null, target_pct: 10, monthly_amount: null, repeat_months: null, due_date: null },
    ]);
    noWallets();
    const s = await snap();
    expect(s.pockets.operating.accounts.map((a) => a.id).sort()).toEqual(["the-vib", "tien-mat", "vcb-chinh"]);
    expect(s.paySetup.hasCycleStream).toBe(true);
    expect(s.payCycle).toBeNull();
    const income = await salary("vcb-chinh");
    expect(income.status).toBe(201);
    expect(income.json.data).toMatchObject({ effects: { cycle: { opened: true } } });
    expect(await tasks()).toContainEqual(["savings", "savings", 3_000_000]);
  });

  it("AC-10: nhà một tài khoản — tài khoản ở Vận hành, không giữ riêng; Học phí chưa gắn tài khoản; lương 20.000.000 → kỳ mở với ① 2.000.000, không có ② (Học phí chưa gắn)", async () => {
    const res = await request(
      "POST",
      "/v1/setup",
      setupBody({ accounts: [{ name: "VCB", kind: "bank", bank: "Vietcombank", owner: null }], goals: [{ name: "Học phí", monthly_amount: 2_000_000 }] }),
    );
    expect(res.status).toBe(201);
    expect(all("SELECT id, pocket, pocket_confirmed FROM accounts")).toEqual([{ id: "vcb", pocket: "operating", pocket_confirmed: 1 }]);
    expect(goals()).toEqual([
      { id: "hoc-phi", name: "Học phí", account_id: null, target_amount: 2_000_000, target_pct: null, monthly_amount: 2_000_000, repeat_months: 1, due_date: null },
    ]);
    noWallets();
    expect((await salary("vcb")).status).toBe(201);
    const list = await tasks();
    expect(list).toContainEqual(["savings", "savings", 2_000_000]);
    expect(list.filter(([kind]) => kind === "goal")).toEqual([]);
    const { pockets } = await snap();
    expect([pockets.savings.total, pockets.savings.accounts, pockets.operating.total]).toEqual([0, [], 20_000_000]);
  });

  describe("AC-11: mặc định và lỗi", () => {
    it("không gửi ngày lương, % Tích luỹ, nhóm, mục tiêu, ngăn → ngày lương 10, % Tích luỹ 10, chỉ nhóm Y tế và Mua sắm, mọi tài khoản Vận hành", async () => {
      expect((await request("POST", "/v1/setup", setupBody())).status).toBe(201);
      expect(all("SELECT k, v FROM config WHERE k IN ('payday_day', 'savings_pct') ORDER BY k")).toEqual([
        { k: "payday_day", v: "10" },
        { k: "savings_pct", v: "10" },
      ]);
      expect(groups().map((g) => g.name)).toEqual(["Y tế", "Mua sắm"]);
      expect(all("SELECT pocket FROM accounts")).toEqual([{ pocket: "operating" }, { pocket: "operating" }]);
      expect(count("reserve_goals")).toBe(0);
    });

    const goal = (name: string) => ({ name, monthly_amount: 100_000 });
    const cases: [string, Record<string, unknown>, string, string][] = [
      ["groups trùng", { groups: ["food", "food"] }, "invalid_input", "groups"],
      ["groups lạ", { groups: ["wallet"] }, "invalid_input", "groups"],
      ["savings_pct 0", { savings_pct: 0 }, "invalid_input", "savings_pct"],
      ["ngăn “spend”", { accounts: [{ name: "TK", kind: "cash", owner: null, pocket: "spend" }] }, "invalid_input", "accounts.0.pocket"],
      ["11 mục tiêu", { goals: Array.from({ length: 11 }, (_, i) => goal(`Mục ${i + 1}`)) }, "invalid_input", "goals"],
      ["có thuế kèm mục tiêu tên Thuế", { taxable: true, goals: [goal("Thuế")] }, "invalid_input", "goals.0.name"],
      ["có template", { template: { taxable: false, must: [] } }, "model_changed", ""],
    ];
    it.each(cases)("%s → 400, không tạo gì", async (_title, over, code, field) => {
      const res = await request("POST", "/v1/setup", setupBody(over));
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe(code);
      if (field) expect(res.json.error?.field).toBe(field);
      nothingCreated();
    });

    it("tên “Giữ cho Tích luỹ” không còn đặc biệt: nhà một tài khoản tạo được mục tiêu tên đó, chưa gắn tài khoản", async () => {
      const res = await request("POST", "/v1/setup", setupBody({ accounts: [{ name: "VCB", kind: "bank", bank: "Vietcombank", owner: null }], goals: [goal("Giữ cho Tích luỹ")] }));
      expect(res.status).toBe(201);
      expect(all("SELECT id, account_id FROM reserve_goals")).toEqual([{ id: "giu-cho-tich-luy", account_id: null }]);
    });
  });

  describe("AC-13: tài khoản Vận hành không gắn được mục tiêu", () => {
    it("thẻ tín dụng nhập trước, rồi tiền mặt, không gửi ngăn → cả hai Vận hành; mục tiêu Thuế chưa gắn tài khoản", async () => {
      const res = await request(
        "POST",
        "/v1/setup",
        setupBody({
          accounts: [
            { name: "Thẻ VIB", kind: "credit", bank: "VIB", owner: null },
            { name: "Tiền mặt", kind: "cash", owner: null },
          ],
          taxable: true,
        }),
      );
      expect(res.status).toBe(201);
      expect(all("SELECT id, pocket FROM accounts ORDER BY rowid")).toEqual([
        { id: "the-vib", pocket: "operating" },
        { id: "tien-mat", pocket: "operating" },
      ]);
      expect(all("SELECT id, account_id FROM reserve_goals ORDER BY id")).toEqual([{ id: "thue", account_id: null }]);
    });

    it("hai tài khoản đều ngoài ngăn → Thuế có, chưa gắn tài khoản", async () => {
      const res = await request(
        "POST",
        "/v1/setup",
        setupBody({
          accounts: [
            { name: "Tiền mặt", kind: "cash", owner: null, pocket: null },
            { name: "VCB của Bố", kind: "bank", bank: "Vietcombank", owner: 0, pocket: null },
          ],
          taxable: true,
        }),
      );
      expect(res.status).toBe(201);
      expect(all("SELECT pocket FROM accounts")).toEqual([{ pocket: null }, { pocket: null }]);
      expect(all("SELECT id, account_id FROM reserve_goals")).toEqual([{ id: "thue", account_id: null }]);
    });
  });

  describe("AC-14: mục tiêu gắn tài khoản ngăn Dự phòng của thân (goals[].account)", () => {
    const accounts = [
      { name: "VCB chính", kind: "bank", bank: "Vietcombank", owner: null, pocket: "operating" },
      { name: "MB tiết kiệm", kind: "bank", bank: "MBBank", owner: null, pocket: "reserve" },
    ];

    it("Học phí account 1 → gắn tài khoản tiết kiệm; Hoá đơn không account → chưa gắn; không bảng / dòng phần giữ riêng, không conversion_state; snapshot thấy A = số dư", async () => {
      const res = await request(
        "POST",
        "/v1/setup",
        setupBody({ accounts, goals: [{ name: "Học phí", monthly_amount: 2_000_000, account: 1 }, { name: "Hoá đơn", monthly_amount: 1_300_000 }] }),
      );
      expect(res.status).toBe(201);
      expect(all("SELECT id, account_id FROM reserve_goals ORDER BY sort")).toEqual([
        { id: "hoc-phi", account_id: "mb-tiet-kiem" },
        { id: "hoa-don", account_id: null },
      ]);
      noWallets();
      const reserve = (await api("GET", "/v1/snapshot")).json.data as { pockets: { reserve: { goals: { id: string; accountId: string | null; held: number | null }[] } } };
      expect(reserve.pockets.reserve.goals.map((g) => [g.id, g.accountId, g.held])).toEqual([
        ["hoc-phi", "mb-tiet-kiem", 0],
        ["hoa-don", null, null],
      ]);
    });

    it("UC-510 AC-14: hai mục tiêu cùng account 1 → cả hai gắn tài khoản tiết kiệm; thứ tự ưu tiên theo hạn (không hạn xuống cuối), chia số dư theo thứ tự đó", async () => {
      const res = await request(
        "POST",
        "/v1/setup",
        setupBody({
          accounts,
          goals: [
            { name: "Hoá đơn", monthly_amount: 1_300_000, account: 1 },
            { name: "Học phí", monthly_amount: 2_000_000, repeat_months: 3, due_date: "2027-01-15", account: 1 },
          ],
        }),
      );
      expect(res.status).toBe(201);
      expect(all("SELECT id, account_id, sort FROM reserve_goals ORDER BY sort")).toEqual([
        { id: "hoc-phi", account_id: "mb-tiet-kiem", sort: 10 },
        { id: "hoa-don", account_id: "mb-tiet-kiem", sort: 20 },
      ]);
      const reserve = (await api("GET", "/v1/snapshot")).json.data as { pockets: { reserve: { groups: { accountId: string; goalIds: string[] }[] } } };
      expect(reserve.pockets.reserve.groups).toMatchObject([{ accountId: "mb-tiet-kiem", goalIds: ["hoc-phi", "hoa-don"] }]);
    });

    const cases: [string, unknown[], string][] = [
      ["account 0 (Vận hành)", [{ name: "Học phí", monthly_amount: 2_000_000, account: 0 }], "goals.0.account"],
      ["chỉ số âm", [{ name: "Học phí", monthly_amount: 2_000_000, account: -1 }], "goals.0.account"],
      ["chỉ số không nguyên", [{ name: "Học phí", monthly_amount: 2_000_000, account: 1.5 }], "goals.0.account"],
    ];
    it.each(cases)("%s → 400, không tạo gì", async (_title, list, field) => {
      const res = await request("POST", "/v1/setup", setupBody({ accounts, goals: list }));
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
