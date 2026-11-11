// Mục tiêu Dự phòng là một tài khoản thật (pocket UC-1209, ADR-132) và tài khoản theo ngăn (pocket UC-1201): A = số dư sổ
// của tài khoản gắn, không sổ để riêng. Hộ mẫu `docs/seed.sql`: Học phí ↔ MB (học phí) `mb-tuition`; Bảo dưỡng xe, Thuế thu
// nhập chưa gắn; Ví Thưởng = MB (Ví Thưởng) `mb-reward`. Mỗi bài thêm phao `phao` (Dự phòng, không gắn mục tiêu) 5.000.000.
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { householdE } from "./helpers/household-e";

let env: Env;
let raw: DatabaseSync;

type ApiError = { code: string; message: string; field?: string; fields?: string[] };
type Json<T> = { ok: boolean; data: T; error?: ApiError };
type Goal = {
  id: string;
  name: string;
  account_id: string | null;
  suggested_account_id: string | null;
  held: number | null;
  target_amount: number | null;
  target_pct: number | null;
  monthly_amount: number | null;
  repeat_months: number | null;
  due_date: string | null;
  debt_id: string | null;
  sort: number;
  active: boolean;
};
type Account = { id: string; pocket: string | null; pocket_confirmed: boolean; active: boolean; name: string };
type SnapGoal = { id: string; accountId: string | null; held: number | null; target: number | null };

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: { Authorization: "Bearer tok", "X-Member-Id": "husband", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}
const err = (r: { status: number; json: Json<unknown> }) => [r.status, r.json.error?.code];
const auditOf = (action: string) =>
  (raw.prepare("SELECT target, detail FROM audit_log WHERE action = ? ORDER BY id").all(action) as { target: string; detail: string }[]).map((r) => ({
    target: r.target,
    detail: JSON.parse(r.detail),
  }));
const accountRow = (id: string) => raw.prepare("SELECT pocket, pocket_confirmed, active FROM accounts WHERE id = ?").get(id);
const goals = async () => (await call<{ goals: Goal[] }>("GET", "/v1/settings")).json.data.goals;
const goalOf = async (id: string) => (await goals()).find((g) => g.id === id)!;

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  // Số theo hộ mẫu E: tài khoản tiết kiệm (Học phí) 10.000.000, Ví Thưởng 4.000.000, phao 5.000.000, tài khoản chính 3.000.000.
  raw.exec(`
    UPDATE accounts SET opening_balance = 10000000 WHERE id = 'mb-tuition';
    UPDATE accounts SET opening_balance = 4000000 WHERE id = 'mb-reward';
    UPDATE accounts SET opening_balance = 3000000 WHERE id = 'vcb-husband';
    INSERT INTO accounts (id, name, kind, bank, owner_member_id, opening_balance, pocket, pocket_confirmed) VALUES ('phao', 'Phao', 'bank', 'MBBank', 'wife', 5000000, 'reserve', 1);
  `);
});

describe("mục tiêu Dự phòng là một tài khoản thật (UC-1209)", () => {
  it("UC-1209 AC-1: A = số dư sổ tài khoản gắn — Học phí 10.000.000; chưa gắn → null; chi 600.000 từ tài khoản đó → 9.400.000; chuyển 1.000.000 vào → 10.400.000; không có dòng sổ nào ngoài giao dịch", async () => {
    const snapGoals = async () => (await call<{ pockets: { reserve: { goals: SnapGoal[] } } }>("GET", "/v1/snapshot")).json.data.pockets.reserve.goals;
    const byId = (list: SnapGoal[]) => Object.fromEntries(list.map((g) => [g.id, g]));
    let snap = byId(await snapGoals());
    expect(snap.tuition).toMatchObject({ accountId: "mb-tuition", held: 10_000_000, target: 6_000_000 });
    expect([snap["car-service"]!.held, snap["income-tax"]!.held]).toEqual([null, null]);
    expect(await goalOf("tuition")).toMatchObject({ account_id: "mb-tuition", held: 10_000_000 });
    expect(await goalOf("car-service")).toMatchObject({ account_id: null, held: null });

    const txBefore = Number((raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n);
    const spend = await call("POST", "/v1/transactions", { meaning: "spend", amount: 600_000, category_id: "groceries", account_id: "mb-tuition" });
    expect(spend.status).toBe(201);
    expect(byId(await snapGoals()).tuition!.held).toBe(9_400_000);
    expect((await goalOf("tuition")).held).toBe(9_400_000);
    const move = await call("POST", "/v1/transactions", { meaning: "transfer", amount: 1_000_000, account_id: "vcb-husband", to_account_id: "mb-tuition" });
    expect(move.status).toBe(201);
    snap = byId(await snapGoals());
    expect(snap.tuition!.held).toBe(10_400_000);
    expect((await goalOf("tuition")).held).toBe(10_400_000);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM transactions").get()).toEqual({ n: txBefore + 2 });
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name IN ('earmarks', 'earmark_lines')").all()).toEqual([]);
  });

  it("UC-1209 AC-2: luật gắn — tài khoản Vận hành → 409 account_not_reserve; tài khoản đã gắn mục tiêu / tài khoản Ví Thưởng → 409 account_has_goal; phao → lưu, nhật ký goal.update có changes.account_id; B lẫn % → 400; khoản nợ đã có mục tiêu → 409 debt_has_goal; đường /earmarks* cũ → 404", async () => {
    const patch = (body: Record<string, unknown>) => call<{ goal: Goal }>("PATCH", "/v1/settings/goals/car-service", body);
    expect(err(await patch({ account_id: "vcb-husband" }))).toEqual([409, "account_not_reserve"]);
    expect(err(await patch({ account_id: "khong-co" }))).toEqual([409, "account_not_reserve"]);
    expect(err(await patch({ account_id: "mb-tuition" }))).toEqual([409, "account_has_goal"]);
    expect(err(await patch({ account_id: "mb-reward" }))).toEqual([409, "account_has_goal"]);
    expect(await goalOf("car-service")).toMatchObject({ account_id: null, held: null });

    const linked = await patch({ account_id: "phao" });
    expect(linked.status).toBe(200);
    expect(linked.json.data.goal).toMatchObject({ id: "car-service", account_id: "phao", held: 5_000_000, target_amount: 4_800_000, active: true });
    expect(auditOf("goal.update")).toEqual([
      { target: "goal:car-service", detail: { fields: ["account_id"], changes: { account_id: { from: null, to: "phao" } } } },
    ]);

    const both = await call("POST", "/v1/settings/goals", { name: "Thuế 2027", target_amount: 1_000_000, target_pct: 10 });
    expect([both.status, both.json.error?.code, both.json.error?.field]).toEqual([400, "invalid_input", "target_pct"]);
    expect(err(await call("POST", "/v1/settings/goals", { name: "Không số" }))).toEqual([400, "invalid_input"]);
    expect(err(await call("POST", "/v1/settings/goals", { name: "Hạn sai", target_amount: 1_000, due_date: "31/03/2027" }))).toEqual([400, "invalid_input"]);

    const created = await call<{ goal: Goal }>("POST", "/v1/settings/goals", { name: "Hoá đơn", monthly_amount: 1_300_000, repeat_months: 1 });
    expect(created.status).toBe(201);
    expect(created.json.data.goal).toEqual({
      id: "hoa-don", name: "Hoá đơn", account_id: null, suggested_account_id: null, held: null, target_amount: 1_300_000, target_pct: null,
      monthly_amount: 1_300_000, repeat_months: 1, due_date: null, debt_id: null, sort: 100, active: true,
    });
    expect(err(await call("POST", "/v1/settings/goals", { name: "Hoá đơn", target_amount: 1_000 }))).toEqual([409, "duplicate"]);
    expect(auditOf("goal.create")).toEqual([{ target: "goal:hoa-don", detail: { fields: ["monthly_amount", "name", "repeat_months"] } }]);

    expect((await call("POST", "/v1/debts", { name: "Vay người thân", amount: 5_000_000, monthly_payment: 1_000_000, due_day: 15 })).status).toBe(201);
    expect((await call("POST", "/v1/settings/goals", { name: "Trả nợ", monthly_amount: 1_000_000, repeat_months: 1, debt_id: "vay-nguoi-than" })).status).toBe(201);
    expect(err(await call("PATCH", "/v1/settings/goals/hoa-don", { debt_id: "vay-nguoi-than" }))).toEqual([409, "debt_has_goal"]);
    expect(err(await call("POST", "/v1/settings/goals", { name: "Nợ lạ", target_amount: 1_000, debt_id: "khong-co" }))).toEqual([400, "unknown_debt"]);
    expect(err(await call("PATCH", "/v1/settings/goals/khong-co", { name: "X" }))).toEqual([404, "not_found"]);

    for (const [method, path] of [["POST", "/v1/settings/earmarks"], ["PATCH", "/v1/settings/earmarks/tuition"], ["POST", "/v1/settings/earmarks/tuition/lines"], ["PATCH", "/v1/settings/earmark-lines/1"]] as const) {
      expect(err(await call(method, path, { name: "Cũ" })), path).toEqual([404, "not_found"]);
    }
  });

  it("UC-1209 AC-3, UC-1201 AC-4: tài khoản đang gắn mục tiêu — đổi ngăn / tắt → 409 account_has_goal, không đổi gì; tắt mục tiêu (số dư ≠ 0) được, sau đó đổi ngăn được", async () => {
    for (const body of [{ pocket: "operating" }, { active: false }, { pocket: null }]) {
      const r = await call("PATCH", "/v1/settings/accounts/mb-tuition", body);
      expect([...err(r), r.json.error?.field], JSON.stringify(body)).toEqual([409, "account_has_goal", "pocket"]);
    }
    expect(accountRow("mb-tuition")).toEqual({ pocket: "reserve", pocket_confirmed: 1, active: 1 });

    const off = await call<{ goal: Goal }>("PATCH", "/v1/settings/goals/tuition", { active: false });
    expect(off.status).toBe(200);
    expect(off.json.data.goal).toMatchObject({ active: false, account_id: "mb-tuition", held: 10_000_000 });
    expect(auditOf("goal.update")).toEqual([{ target: "goal:tuition", detail: { fields: ["active"] } }]);
    const moved = await call<Account>("PATCH", "/v1/settings/accounts/mb-tuition", { pocket: "operating" });
    expect(moved.json.data).toMatchObject({ pocket: "operating", pocket_confirmed: true });
    // Bật lại mục tiêu khi tài khoản không còn ở ngăn Dự phòng → 409 account_not_reserve.
    expect(err(await call("PATCH", "/v1/settings/goals/tuition", { active: true }))).toEqual([409, "account_not_reserve"]);
    expect((await call<{ goal: Goal }>("PATCH", "/v1/settings/goals/tuition", { active: true, account_id: "phao" })).json.data.goal).toMatchObject({ active: true, account_id: "phao" });
  });

  it("UC-1209 AC-4, UC-507 AC-22: Ví Thưởng là tài khoản — phao → lưu; tài khoản đang gắn mục tiêu / tài khoản Vận hành / không có thật → 400 invalid_account; null → bỏ chọn", async () => {
    const put = (v: unknown) => call<{ surplus_reward_account: string | null }>("PUT", "/v1/settings/config", { surplus_reward_account: v });
    expect((await put("phao")).json.data.surplus_reward_account).toBe("phao");
    for (const v of ["mb-tuition", "vcb-husband", "khong-co", 5]) {
      const r = await put(v);
      expect([...err(r), r.json.error?.field], String(v)).toEqual([400, "invalid_account", "surplus_reward_account"]);
    }
    expect((await call<{ config: { surplus_reward_account: string | null } }>("GET", "/v1/settings")).json.data.config.surplus_reward_account).toBe("phao");
    expect((await put(null)).json.data.surplus_reward_account).toBeNull();
    expect(raw.prepare("SELECT COUNT(*) AS n FROM config WHERE k = 'surplus_reward_account'").get()).toEqual({ n: 0 });
  });

  it("UC-1209 AC-6: Ví Thưởng và tài khoản mục tiêu không trùng kể cả khi hai máy ghi cùng lúc — trigger huỷ câu ghi sau (account_is_reward / reward_has_goal); API trả 409 account_has_goal / 400 invalid_account, dữ liệu giữ lần ghi trước", async () => {
    const reward = () => (raw.prepare("SELECT v FROM config WHERE k = 'surplus_reward_account'").get() as { v: string } | undefined)?.v ?? null;
    const goalAccount = () => (raw.prepare("SELECT account_id FROM reserve_goals WHERE id = 'car-service'").get() as { account_id: string | null }).account_id;
    const setReward = (v: string) => raw.prepare("INSERT INTO config (k, v) VALUES ('surplus_reward_account', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(v);
    const linkGoal = (v: string | null) => raw.prepare("UPDATE reserve_goals SET account_id = ? WHERE id = 'car-service'").run(v);

    // Máy A đặt Ví Thưởng = phao, rồi máy B gắn Bảo dưỡng xe vào phao.
    setReward("phao");
    expect(() => linkGoal("phao")).toThrow(/account_is_reward/);
    expect([reward(), goalAccount()]).toEqual(["phao", null]);
    expect(() => raw.prepare("INSERT INTO reserve_goals (id, name, account_id, target_amount) VALUES ('moi', 'Mới', 'phao', 1000)").run()).toThrow(/account_is_reward/);
    // Thứ tự ngược: gắn trước, đặt Ví Thưởng sau (UPDATE qua ON CONFLICT và INSERT khi chưa có khoá).
    setReward("mb-reward");
    linkGoal("phao");
    expect(() => setReward("phao")).toThrow(/reward_has_goal/);
    expect([reward(), goalAccount()]).toEqual(["mb-reward", "phao"]);
    raw.exec("DELETE FROM config WHERE k = 'surplus_reward_account'");
    expect(() => raw.prepare("INSERT INTO config (k, v) VALUES ('surplus_reward_account', 'phao')").run()).toThrow(/reward_has_goal/);
    // Mục tiêu đã tắt không chặn; bật lại mục tiêu gắn tài khoản Ví Thưởng thì bị chặn.
    raw.exec("UPDATE reserve_goals SET active = 0 WHERE id = 'car-service'");
    setReward("phao");
    expect(() => raw.exec("UPDATE reserve_goals SET active = 1 WHERE id = 'car-service'")).toThrow(/account_is_reward/);
    raw.exec("UPDATE reserve_goals SET active = 1, account_id = NULL WHERE id = 'car-service'");
    setReward("mb-reward");

    // Qua API: bước kiểm ở code đã qua, câu ghi của máy kia chen vào ngay trước câu ghi.
    const base = asD1(raw);
    const plain = env;
    const racing = (pattern: RegExp, competitor: () => void) => {
      let fired = false;
      const prepare = (sql: string) => {
        if (!fired && pattern.test(sql)) {
          fired = true;
          competitor();
        }
        return base.prepare(sql);
      };
      env = { ...plain, DB: { ...base, prepare, batch: base.batch.bind(base) } as D1Database };
    };
    racing(/^UPDATE reserve_goals SET name/, () => setReward("phao"));
    const patched = await call("PATCH", "/v1/settings/goals/car-service", { account_id: "phao" });
    expect([...err(patched), patched.json.error?.field]).toEqual([409, "account_has_goal", "account_id"]);
    expect(patched.json.error?.message).toContain("là tài khoản Ví Thưởng");
    expect([reward(), goalAccount()]).toEqual(["phao", null]);

    setReward("mb-reward");
    racing(/^\s*INSERT INTO reserve_goals/, () => setReward("phao"));
    const created = await call("POST", "/v1/settings/goals", { name: "Hoá đơn", target_amount: 1_300_000, account_id: "phao" });
    expect(err(created)).toEqual([409, "account_has_goal"]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM reserve_goals WHERE id = 'hoa-don'").get()).toEqual({ n: 0 });

    setReward("mb-reward");
    racing(/^INSERT INTO config/, () => linkGoal("phao"));
    const put = await call("PUT", "/v1/settings/config", { surplus_reward_account: "phao" });
    expect([...err(put), put.json.error?.field]).toEqual([400, "invalid_account", "surplus_reward_account"]);
    expect([reward(), goalAccount()]).toEqual(["mb-reward", "phao"]);
    expect(auditOf("config.update")).toEqual([]);
  });
});

describe("tài khoản theo ngăn (UC-1201)", () => {
  it("UC-1201 AC-2: xác nhận cả bảng ngăn một lần — mọi tài khoản trong danh sách đã xác nhận, nhật ký chỉ có tài khoản đổi; id lạ hay đặt tài khoản gắn mục tiêu ra khỏi Dự phòng thì không đổi gì", async () => {
    raw.exec("UPDATE accounts SET pocket_confirmed = 0");
    const body = { accounts: [{ id: "vcb-husband", pocket: "operating" }, { id: "tcb-husband", pocket: "savings" }, { id: "mb-tuition", pocket: "reserve" }] };
    const done = await call<{ accounts: Account[] }>("PUT", "/v1/settings/pockets", body);
    expect(done.status).toBe(200);
    expect(raw.prepare("SELECT id, pocket, pocket_confirmed FROM accounts WHERE id IN ('vcb-husband', 'tcb-husband', 'mb-tuition') ORDER BY id").all()).toEqual([
      { id: "mb-tuition", pocket: "reserve", pocket_confirmed: 1 },
      { id: "tcb-husband", pocket: "savings", pocket_confirmed: 1 },
      { id: "vcb-husband", pocket: "operating", pocket_confirmed: 1 },
    ]);
    expect(done.json.data.accounts.find((a) => a.id === "tcb-husband")).toMatchObject({ pocket: "savings", pocket_confirmed: true });
    expect(auditOf("pockets.confirm")).toEqual([{ target: null, detail: { accounts: 3, changes: { "tcb-husband": { from: "operating", to: "savings" } } } }]);

    const before = raw.prepare("SELECT id, pocket, pocket_confirmed FROM accounts ORDER BY id").all();
    expect(err(await call("PUT", "/v1/settings/pockets", { accounts: [{ id: "vcb-wife", pocket: "reserve" }, { id: "khong-co", pocket: "savings" }] }))).toEqual([400, "unknown_account"]);
    for (const pocket of [null, "operating", "savings"]) {
      const r = await call("PUT", "/v1/settings/pockets", { accounts: [{ id: "cash-wife", pocket: "reserve" }, { id: "mb-tuition", pocket }] });
      expect(err(r), String(pocket)).toEqual([409, "account_has_goal"]);
    }
    expect(raw.prepare("SELECT id, pocket, pocket_confirmed FROM accounts ORDER BY id").all()).toEqual(before);
    expect(auditOf("pockets.confirm")).toHaveLength(1);
  });

  it("UC-1201 AC-3: sửa ngăn ở sheet tài khoản thì đã xác nhận, nhật ký ghi ngăn cũ → mới; ngăn lạ 400; thêm tài khoản gửi kèm spendable → 400 model_changed; không gửi ngăn → Vận hành, chưa xác nhận", async () => {
    raw.exec("UPDATE accounts SET pocket_confirmed = 0 WHERE id = 'mb-husband'");
    const patched = await call<Account>("PATCH", "/v1/settings/accounts/mb-husband", { pocket: "reserve" });
    expect(patched.json.data).toMatchObject({ pocket: "reserve", pocket_confirmed: true });
    expect(auditOf("account.update").at(-1)!.detail).toEqual({ fields: ["pocket"], changes: { pocket: { from: "operating", to: "reserve" } } });
    const bad = await call("PATCH", "/v1/settings/accounts/mb-husband", { pocket: "spend" });
    expect([...err(bad), bad.json.error?.field]).toEqual([400, "invalid_input", "pocket"]);

    const off = await call("POST", "/v1/settings/accounts", { name: "Ví phụ", kind: "bank", spendable: false });
    expect([...err(off), off.json.error?.fields]).toEqual([400, "model_changed", ["spendable"]]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id = 'vi-phu'").get()).toEqual({ n: 0 });
    expect((await call<Account>("POST", "/v1/settings/accounts", { name: "Ví phụ", kind: "bank" })).json.data).toMatchObject({ pocket: "operating", pocket_confirmed: false });
    const outside = await call<Account>("POST", "/v1/settings/accounts", { name: "Ví ngoài", kind: "ewallet", pocket: null });
    expect(outside.json.data).toMatchObject({ pocket: null, pocket_confirmed: true });
  });

  it("UC-1201 AC-5: thêm tài khoản — thường / thẻ tín dụng không gửi ngăn → Vận hành, chưa xác nhận; gửi reserve → Dự phòng, đã xác nhận; kèm role → 400 model_changed (fields role), không tạo gì", async () => {
    const plain = await call<Account>("POST", "/v1/settings/accounts", { name: "ACB", kind: "bank", bank: "ACB" });
    const card = await call<Account>("POST", "/v1/settings/accounts", { name: "Thẻ VIB", kind: "credit", bank: "VIB" });
    const reserve = await call<Account>("POST", "/v1/settings/accounts", { name: "Sổ dự phòng", kind: "bank", pocket: "reserve" });
    expect([plain, card, reserve].map((r) => [r.status, r.json.data.pocket, r.json.data.pocket_confirmed])).toEqual([
      [201, "operating", false],
      [201, "operating", false],
      [201, "reserve", true],
    ]);
    const before = raw.prepare("SELECT COUNT(*) AS n FROM accounts").get();
    const role = await call("POST", "/v1/settings/accounts", { name: "Phao mới", kind: "bank", role: "buffer" });
    expect([...err(role), role.json.error?.fields]).toEqual([400, "model_changed", ["role"]]);
    expect(role.json.error?.message).toBe("Ví nhà v2 xếp tài khoản theo ngăn: bỏ trường role.");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM accounts").get()).toEqual(before);
  });
});

describe("tạo tài khoản cho mục tiêu trong một lần ghi (UC-1209 bước 8, ADR-134)", () => {
  let e: DatabaseSync;
  const post = async (path: string, body: unknown) => {
    const res = await app.request(
      path,
      { method: "POST", headers: { Authorization: "Bearer tok", "X-Member-Id": "anh", "Content-Type": "application/json" }, body: JSON.stringify(body) },
      { DB: asD1(e), API_TOKEN: "tok" } as Env,
    );
    return { status: res.status, json: (await res.json()) as Json<{ goal: Goal; account: Account; created: boolean }> };
  };
  const goalAccount = (id: string) => (e.prepare("SELECT account_id FROM reserve_goals WHERE id = ?").get(id) as { account_id: string | null }).account_id;
  const accountCount = () => Number((e.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n);
  const audits = () =>
    (e.prepare("SELECT action, target, detail FROM audit_log WHERE action IN ('account.create', 'goal.update') ORDER BY id").all() as { action: string; target: string; detail: string }[]).map((r) => ({
      ...r,
      detail: JSON.parse(r.detail),
    }));

  beforeEach(async () => {
    // Hộ mẫu E sau bước 1 (xác nhận ngăn); Hoá đơn, Thuế chưa gắn.
    e = householdE();
    e.exec("UPDATE accounts SET pocket_confirmed = 1");
    expect((await post("/v1/conversion/steps/pockets", {})).status).toBe(200);
  });

  it("UC-1209 AC-7: lần đầu 201 tạo tài khoản ngăn Dự phòng và gắn Hoá đơn, nhật ký account.create + goal.update; gửi lại (cùng account_no) → 200 created false; tên khác → 409 goal_has_account; Thuế với mã đã có → 409 duplicate; batch bị trigger chặn → không tài khoản mới", async () => {
    const body = { name: "Tài khoản hoá đơn", kind: "bank", bank: "MBBank", account_no: "0999xxxxxxx", opening_balance: 0 };
    const before = accountCount();
    const first = await post("/v1/settings/goals/hoa-don/account", body);
    expect(first.status).toBe(201);
    expect(first.json.data.created).toBe(true);
    expect(first.json.data.account).toMatchObject({ id: "tai-khoan-hoa-don", name: "Tài khoản hoá đơn", pocket: "reserve", pocket_confirmed: true, active: true });
    expect(first.json.data.goal).toMatchObject({ id: "hoa-don", account_id: "tai-khoan-hoa-don", held: 0, active: true });
    expect(accountCount()).toBe(before + 1);
    expect(audits()).toEqual([
      { action: "account.create", target: "account:tai-khoan-hoa-don", detail: { fields: ["account_no", "bank", "kind", "name", "opening_balance"] } },
      { action: "goal.update", target: "goal:hoa-don", detail: { fields: ["account_id"], changes: { account_id: { from: null, to: "tai-khoan-hoa-don" } } } },
    ]);

    const again = await post("/v1/settings/goals/hoa-don/account", body);
    expect([again.status, again.json.data.created, again.json.data.account.id, again.json.data.goal.account_id]).toEqual([200, false, "tai-khoan-hoa-don", "tai-khoan-hoa-don"]);
    expect(accountCount()).toBe(before + 1);
    expect(audits()).toHaveLength(2);

    expect(err(await post("/v1/settings/goals/hoa-don/account", { name: "TK hoá đơn 2" }))).toEqual([409, "goal_has_account"]);
    expect(err(await post("/v1/settings/goals/thue/account", { name: "Tài khoản hoá đơn" }))).toEqual([409, "duplicate"]);
    expect(goalAccount("thue")).toBeNull();
    expect(err(await post("/v1/settings/goals/khong-co/account", { name: "X" }))).toEqual([404, "not_found"]);
    e.exec("UPDATE reserve_goals SET active = 0 WHERE id = 'hoc-phi'");
    expect(err(await post("/v1/settings/goals/hoc-phi/account", { name: "Tài khoản học phí" }))).toEqual([409, "goal_inactive"]);
    expect(accountCount()).toBe(before + 1);

    // Batch lỗi giữa chừng: câu tạo tài khoản chạy, câu gắn mục tiêu bị trigger chặn → cả batch huỷ.
    e.exec("CREATE TRIGGER trg_test_block_goal BEFORE UPDATE OF account_id ON reserve_goals BEGIN SELECT RAISE(ABORT, 'test_blocked'); END;");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocked = await post("/v1/settings/goals/thue/account", { name: "Tài khoản thuế" });
    error.mockRestore();
    expect(blocked.status).toBe(500);
    expect(e.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id = 'tai-khoan-thue'").get()).toEqual({ n: 0 });
    expect(goalAccount("thue")).toBeNull();
    expect(audits()).toHaveLength(2);
  });
});
