// Mục tiêu Dự phòng là một tài khoản thật (pocket UC-1209, ADR-132) và tài khoản theo ngăn (pocket UC-1201): A = số dư sổ
// của tài khoản gắn, không sổ để riêng. Hộ mẫu `docs/seed.sql`: Học phí ↔ MB (học phí) `mb-tuition`; Bảo dưỡng xe, Thuế thu
// nhập chưa gắn; Ví Thưởng = MB (Ví Thưởng) `mb-reward`. Mỗi bài thêm phao `phao` (Dự phòng, không gắn mục tiêu) 5.000.000.
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { payCycleView } from "../src/services/pay-cycles";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { householdE } from "./helpers/household-e";
import { householdShared, SHARED_NOW, sharedTx, vnAt } from "./helpers/household-shared";

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

  it("UC-1209 AC-2: luật gắn — tài khoản Vận hành → 409 account_not_reserve; tài khoản tiết kiệm đang gắn Học phí → 200 (chung tài khoản), nhật ký goal.update có changes.account_id; tài khoản Ví Thưởng → 409 account_is_reward; phao → lưu; B lẫn % → 400; khoản nợ đã có mục tiêu → 409 debt_has_goal; đường /earmarks* cũ → 404", async () => {
    const patch = (body: Record<string, unknown>) => call<{ goal: Goal }>("PATCH", "/v1/settings/goals/car-service", body);
    expect(err(await patch({ account_id: "vcb-husband" }))).toEqual([409, "account_not_reserve"]);
    expect(err(await patch({ account_id: "khong-co" }))).toEqual([409, "account_not_reserve"]);
    expect(err(await patch({ account_id: "mb-reward" }))).toEqual([409, "account_is_reward"]);
    expect(await goalOf("car-service")).toMatchObject({ account_id: null, held: null });
    const shared = await patch({ account_id: "mb-tuition" });
    expect(shared.status).toBe(200);
    expect(raw.prepare("SELECT id FROM reserve_goals WHERE account_id = 'mb-tuition' AND active = 1 ORDER BY id").all()).toEqual([{ id: "car-service" }, { id: "tuition" }]);
    expect(auditOf("goal.update")).toEqual([
      { target: "goal:car-service", detail: { fields: ["account_id"], changes: { account_id: { from: null, to: "mb-tuition" } } } },
    ]);
    raw.exec("UPDATE reserve_goals SET account_id = NULL WHERE id = 'car-service'");

    const linked = await patch({ account_id: "phao" });
    expect(linked.status).toBe(200);
    expect(linked.json.data.goal).toMatchObject({ id: "car-service", account_id: "phao", held: 5_000_000, target_amount: 4_800_000, active: true });
    expect(auditOf("goal.update").at(-1)).toEqual({ target: "goal:car-service", detail: { fields: ["account_id"], changes: { account_id: { from: null, to: "phao" } } } });

    const both = await call("POST", "/v1/settings/goals", { name: "Thuế 2027", target_amount: 1_000_000, target_pct: 10 });
    expect([both.status, both.json.error?.code, both.json.error?.field]).toEqual([400, "invalid_input", "target_pct"]);
    expect(err(await call("POST", "/v1/settings/goals", { name: "Không số" }))).toEqual([400, "invalid_input"]);
    expect(err(await call("POST", "/v1/settings/goals", { name: "Hạn sai", target_amount: 1_000, due_date: "31/03/2027" }))).toEqual([400, "invalid_input"]);

    const created = await call<{ goal: Goal }>("POST", "/v1/settings/goals", { name: "Hoá đơn", monthly_amount: 1_300_000, repeat_months: 1 });
    expect(created.status).toBe(201);
    expect(created.json.data.goal).toEqual({
      id: "hoa-don", name: "Hoá đơn", account_id: null, suggested_account_id: null, held: null, need: null, spent: 0, short: null, target_amount: 1_300_000, target_pct: null,
      monthly_amount: 1_300_000, repeat_months: 1, due_date: null, debt_id: null, sort: 40, active: true, pays_from: "account", remaining: null,
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

  it("UC-1209 AC-6: Ví Thưởng và tài khoản mục tiêu không trùng kể cả khi hai máy ghi cùng lúc — trigger huỷ câu ghi sau (account_is_reward / reward_has_goal); API trả 409 account_is_reward / 400 invalid_account, dữ liệu giữ lần ghi trước", async () => {
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
    expect([...err(patched), patched.json.error?.field]).toEqual([409, "account_is_reward", "account_id"]);
    expect(patched.json.error?.message).toContain("là tài khoản Ví Thưởng");
    expect([reward(), goalAccount()]).toEqual(["phao", null]);

    setReward("mb-reward");
    racing(/^\s*INSERT INTO reserve_goals/, () => setReward("phao"));
    const created = await call("POST", "/v1/settings/goals", { name: "Hoá đơn", target_amount: 1_300_000, account_id: "phao" });
    expect(err(created)).toEqual([409, "account_is_reward"]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM reserve_goals WHERE id = 'hoa-don'").get()).toEqual({ n: 0 });

    setReward("mb-reward");
    racing(/^INSERT INTO config/, () => linkGoal("phao"));
    const put = await call("PUT", "/v1/settings/config", { surplus_reward_account: "phao" });
    expect([...err(put), put.json.error?.field]).toEqual([400, "invalid_account", "surplus_reward_account"]);
    expect([reward(), goalAccount()]).toEqual(["mb-reward", "phao"]);
    expect(auditOf("config.update")).toEqual([]);
  });
});

describe("nhiều mục tiêu dùng chung một tài khoản (UC-1209 bước 9, 10)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SHARED_NOW);
    raw = householdShared({ linked: false });
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  });
  afterEach(() => vi.useRealTimers());

  type Group = { accountId: string; balance: number; need: number | null; spent: number; short: number | null; extra: number | null; goalIds: string[] };
  type FullGoal = SnapGoal & { need: number | null; spent: number; short: number | null };
  const reserve = async () => (await call<{ pockets: { reserve: { total: number; goals: FullGoal[]; groups: Group[] } } }>("GET", "/v1/snapshot")).json.data.pockets.reserve;
  const heldOf = (goals: FullGoal[]) => Object.fromEntries(goals.map((g) => [g.id, g.held]));
  const sorts = () => Object.fromEntries((raw.prepare("SELECT id, sort FROM reserve_goals WHERE active = 1").all() as { id: string; sort: number }[]).map((r) => [r.id, r.sort]));

  it("UC-1209 AC-8: gắn Học tập vào tài khoản đang có Nhà ở → 200; Nhà ở 7.500.000, Học tập 4.500.000; nhóm thiếu 1.500.000; sau chuyển 3.000.000 → Học tập 7.500.000 (mục tiêu cuối nhận phần còn lại), extra 1.500.000", async () => {
    const linked = await call<{ goal: Goal }>("PATCH", "/v1/settings/goals/hoc-tap", { account_id: "tk-tiet-kiem" });
    expect(linked.status).toBe(200);
    expect(auditOf("goal.update")).toEqual([{ target: "goal:hoc-tap", detail: { fields: ["account_id"], changes: { account_id: { from: null, to: "tk-tiet-kiem" } } } }]);
    let r = await reserve();
    expect([heldOf(r.goals)["nha-o"], heldOf(r.goals)["hoc-tap"]]).toEqual([7_500_000, 4_500_000]);
    expect(r.goals.find((g) => g.id === "hoc-tap")!.spent).toBe(0);
    expect(r.groups.find((g) => g.accountId === "tk-tiet-kiem")).toEqual({
      accountId: "tk-tiet-kiem", name: "MB tiết kiệm", balance: 12_000_000, need: 13_500_000, spent: 0, short: 1_500_000, extra: 0, goalIds: ["nha-o", "hoc-tap"], childIds: [], interest: 0,
    });
    const txBefore = Number((raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n);
    expect((await call("POST", "/v1/transactions", { meaning: "transfer", amount: 3_000_000, account_id: "vcb-husband", to_account_id: "tk-tiet-kiem" })).status).toBe(201);
    r = await reserve();
    expect([heldOf(r.goals)["nha-o"], heldOf(r.goals)["hoc-tap"]]).toEqual([7_500_000, 7_500_000]);
    expect(r.groups.find((g) => g.accountId === "tk-tiet-kiem")).toMatchObject({ short: 0, extra: 1_500_000 });
    const book = raw.prepare("SELECT SUM(b.book_balance) AS s FROM v_account_book b JOIN accounts a ON a.id = b.account_id WHERE a.pocket = 'reserve'").get() as { s: number };
    expect(r.total).toBe(book.s);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM transactions").get()).toEqual({ n: txBefore + 1 });
  });

  it("UC-1209 AC-9: mục tiêu mới chen theo hạn, đánh số lại 10…70 cùng batch; PUT /goals/order đổi thứ tự và ghi nhật ký goal.order; ids sai → 400 invalid_order; đổi hạn không đổi thứ tự", async () => {
    raw.exec("UPDATE reserve_goals SET account_id = 'tk-tiet-kiem' WHERE id = 'hoc-tap'");
    raw.exec("UPDATE reserve_goals SET account_id = NULL WHERE id = 'hieu-hi'");
    const created = await call<{ goal: Goal }>("POST", "/v1/settings/goals", { name: "Sửa nhà", target_amount: 10_000_000, due_date: "2027-01-01" });
    expect(created.status).toBe(201);
    expect(sorts()).toEqual({ "hoa-don": 10, "nha-o": 20, "sua-nha": 30, "hoc-tap": 40, "bao-duong-xe": 50, "hieu-hi": 60, thue: 70 });
    const ids = ["hoa-don", "hoc-tap", "nha-o", "sua-nha", "bao-duong-xe", "hieu-hi", "thue"];
    const ordered = await call<{ goals: Goal[] }>("PUT", "/v1/settings/goals/order", { ids });
    expect(ordered.status).toBe(200);
    expect(sorts()).toEqual({ "hoa-don": 10, "hoc-tap": 20, "nha-o": 30, "sua-nha": 40, "bao-duong-xe": 50, "hieu-hi": 60, thue: 70 });
    const r = await reserve();
    expect([heldOf(r.goals)["hoc-tap"], heldOf(r.goals)["nha-o"]]).toEqual([6_000_000, 6_000_000]);
    expect(r.groups.find((g) => g.accountId === "tk-tiet-kiem")).toMatchObject({ short: 1_500_000, goalIds: ["hoc-tap", "nha-o"] });
    expect(auditOf("goal.order")).toEqual([
      { target: "goal:*", detail: { changes: { from: ["hoa-don", "nha-o", "sua-nha", "hoc-tap", "bao-duong-xe", "hieu-hi", "thue"], to: ids } } },
    ]);
    const before = sorts();
    for (const bad of [ids.filter((id) => id !== "thue"), [...ids.slice(0, 5), "hieu-hi", "hieu-hi"], [...ids.slice(0, 6), "khong-co"], "x", [...ids, "thue"]]) {
      expect(err(await call("PUT", "/v1/settings/goals/order", { ids: bad })), JSON.stringify(bad)).toEqual([400, "invalid_order"]);
    }
    expect(sorts()).toEqual(before);
    expect((await call("PATCH", "/v1/settings/goals/hoc-tap", { due_date: "2026-11-30" })).status).toBe(200);
    expect(sorts()).toEqual(before);
  });

  it("UC-1209 AC-10: Thuế giữ tài khoản riêng — gắn Thuế vào tài khoản chung, gắn mục tiêu khác vào TK thuế, đổi Học tập (đang chung) sang % → 409 tax_account_shared, không đổi gì; hai máy: trigger 0042 huỷ câu ghi sau", async () => {
    raw.exec("UPDATE reserve_goals SET account_id = 'tk-tiet-kiem' WHERE id = 'hoc-tap'");
    raw.exec("UPDATE reserve_goals SET account_id = NULL WHERE id = 'hieu-hi'");
    const snapshotRows = () => raw.prepare("SELECT id, account_id, target_amount, target_pct, active FROM reserve_goals ORDER BY id").all();
    const before = snapshotRows();
    const tax = await call("GET", "/v1/tax/2026");
    expect(err(await call("PATCH", "/v1/settings/goals/thue", { account_id: "tk-tiet-kiem" }))).toEqual([409, "tax_account_shared"]);
    expect(err(await call("PATCH", "/v1/settings/goals/hieu-hi", { account_id: "tk-thue" }))).toEqual([409, "tax_account_shared"]);
    const pct = await call("PATCH", "/v1/settings/goals/hoc-tap", { target_pct: 5, target_amount: null });
    expect(err(pct)).toEqual([409, "tax_account_shared"]);
    expect(pct.json.error?.message).toBe("Thuế cần tài khoản riêng: thuế đã nộp đếm mọi khoản chi từ tài khoản này.");
    expect(snapshotRows()).toEqual(before);

    // Hai máy: cả hai đã qua bước kiểm ở code; câu ghi của máy kia chen vào ngay trước câu ghi.
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
    racing(/^UPDATE reserve_goals SET name/, () => raw.exec("UPDATE reserve_goals SET account_id = 'tk-moi' WHERE id = 'hieu-hi'"));
    expect(err(await call("PATCH", "/v1/settings/goals/thue", { account_id: "tk-moi" }))).toEqual([409, "tax_account_shared"]);
    expect(raw.prepare("SELECT id, account_id FROM reserve_goals WHERE id IN ('hieu-hi', 'thue') ORDER BY id").all()).toEqual([
      { id: "hieu-hi", account_id: "tk-moi" },
      { id: "thue", account_id: "tk-thue" },
    ]);
    raw.exec("UPDATE reserve_goals SET account_id = NULL WHERE id = 'hieu-hi'");
    racing(/^UPDATE reserve_goals SET name/, () => raw.exec("UPDATE reserve_goals SET account_id = 'tk-moi' WHERE id = 'thue'"));
    expect(err(await call("PATCH", "/v1/settings/goals/hieu-hi", { account_id: "tk-moi" }))).toEqual([409, "tax_account_shared"]);
    expect(raw.prepare("SELECT id, account_id FROM reserve_goals WHERE id IN ('hieu-hi', 'thue') ORDER BY id").all()).toEqual([
      { id: "hieu-hi", account_id: null },
      { id: "thue", account_id: "tk-moi" },
    ]);
    env = plain;
    raw.exec("UPDATE reserve_goals SET account_id = 'tk-thue' WHERE id = 'thue'");
    expect(await call("GET", "/v1/tax/2026")).toEqual(tax);
  });

  it("UC-1209 AC-12: giữ tài khoản dùng chung — tắt Nhà ở → Học tập nhận cả 12.000.000; Ví Thưởng → 400 invalid_account; đổi ngăn khi còn Học tập → 409 account_has_goal; tắt Học tập rồi đổi ngăn được", async () => {
    raw.exec("UPDATE reserve_goals SET account_id = 'tk-tiet-kiem' WHERE id = 'hoc-tap'");
    expect((await call("PATCH", "/v1/settings/goals/nha-o", { active: false })).status).toBe(200);
    const r = await reserve();
    expect(r.goals.find((g) => g.id === "hoc-tap")).toMatchObject({ held: 12_000_000, short: 0 });
    expect(r.groups.find((g) => g.accountId === "tk-tiet-kiem")).toMatchObject({ goalIds: ["hoc-tap"], extra: 6_000_000 });
    expect(err(await call("PUT", "/v1/settings/config", { surplus_reward_account: "tk-tiet-kiem" }))).toEqual([400, "invalid_account"]);
    expect(err(await call("PATCH", "/v1/settings/accounts/tk-tiet-kiem", { pocket: "operating" }))).toEqual([409, "account_has_goal"]);
    expect(accountRow("tk-tiet-kiem")).toMatchObject({ pocket: "reserve", active: 1 });
    expect((await call("PATCH", "/v1/settings/goals/hoc-tap", { active: false })).status).toBe(200);
    expect((await call("PATCH", "/v1/settings/accounts/tk-tiet-kiem", { pocket: "operating" })).status).toBe(200);
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

describe("mục tiêu trả thẳng từ tiền chi tiêu và tài khoản con (UC-1209 AC-16, AC-17, AC-20, UC-505 AC-19)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SHARED_NOW);
    raw = householdShared();
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  });
  afterEach(() => vi.useRealTimers());

  type SettingsGoal = Goal & { pays_from: string; remaining: number | null; spent: number };
  type SettingsGroup = { account_id: string; balance: number; goal_ids: string[]; child_ids: string[]; interest: number };
  const settingsData = async () => (await call<{ goals: SettingsGoal[]; goal_groups: SettingsGroup[] }>("GET", "/v1/settings")).json.data;
  const addChild = () =>
    raw.exec(
      "INSERT INTO accounts (id, name, kind, bank, opening_balance, pocket, pocket_confirmed, parent_account_id) VALUES ('gui-6-thang', 'Gửi 6 tháng', 'bank', 'MBBank', 0, 'reserve', 1, 'tk-tiet-kiem')",
    );
  const dienNuoc = { name: "Điện nước", monthly_amount: 2_000_000, repeat_months: 1, pays_from: "operating" };

  it("UC-1209 AC-17: tạo mục tiêu trả từ tiền chi tiêu → 201, account_id null; lặp 3 tháng → 400 operating_goal_monthly; Thuế % → 409 tax_account_shared; kèm account_id → 400 invalid_input; không có việc ② nào cho Điện nước khi kỳ mở", async () => {
    raw = householdShared({ cycle: false });
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
    const created = await call<{ goal: SettingsGoal }>("POST", "/v1/settings/goals", dienNuoc);
    expect(created.status).toBe(201);
    expect(created.json.data.goal).toMatchObject({ id: "dien-nuoc", account_id: null, pays_from: "operating", held: null, spent: 0, remaining: 2_000_000, monthly_amount: 2_000_000, repeat_months: 1 });
    expect(err(await call("POST", "/v1/settings/goals", { ...dienNuoc, name: "Điện nước quý", repeat_months: 3 }))).toEqual([400, "operating_goal_monthly"]);
    expect(err(await call("POST", "/v1/settings/goals", { name: "Thuế 2027", target_pct: 10, pays_from: "operating" }))).toEqual([409, "tax_account_shared"]);
    expect(err(await call("POST", "/v1/settings/goals", { ...dienNuoc, name: "Internet", account_id: "phao" }))).toEqual([400, "invalid_input"]);
    expect(err(await call("POST", "/v1/settings/goals", { ...dienNuoc, name: "Internet", pays_from: "quy" }))).toEqual([400, "invalid_input"]);
    expect(raw.prepare("SELECT id FROM reserve_goals WHERE pays_from = 'operating'").all()).toEqual([{ id: "dien-nuoc" }]);

    const income = await call("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "cash-husband", income_stream_id: "salary-husband", at: vnAt("2026-11-10 08:00") });
    expect(income.status).toBe(201);
    const goalTasks = (raw.prepare("SELECT goal_id FROM pay_cycle_tasks WHERE kind = 'goal'").all() as { goal_id: string }[]).map((t) => t.goal_id);
    expect(goalTasks).toContain("hoc-tap");
    expect(goalTasks).not.toContain("dien-nuoc");
  });

  it("UC-1209 AC-20: đổi Hoá đơn (gắn tk-chung, ② 2.000.000 đang mở, đã chi 300.000 từ tk-chung) sang trả từ tiền chi tiêu → account_id null, ② void có lý do + nhật ký pay_cycle_task.void, pendingTasks 0, còn phải trả 2.000.000; kèm account_id → 400 invalid_input", async () => {
    sharedTx(raw, { at: "2026-11-11 09:00", meaning: "spend", amount: 300_000, from: "tk-chung", goal: "hoa-don" });
    const cycleId = (raw.prepare("SELECT id FROM pay_cycles").get() as { id: number }).id;
    const taskId = Number(raw.prepare("INSERT INTO pay_cycle_tasks (cycle_id, kind, goal_id, suggested, amount) VALUES (?, 'goal', 'hoa-don', 2000000, 2000000)").run(cycleId).lastInsertRowid);
    expect((await payCycleView(asD1(raw), "2026-11-12", "husband")).pendingTasks).toBe(2_000_000);

    const patched = await call<{ goal: SettingsGoal }>("PATCH", "/v1/settings/goals/hoa-don", { pays_from: "operating" });
    expect(patched.status).toBe(200);
    expect(patched.json.data.goal).toMatchObject({ account_id: null, pays_from: "operating", held: null, spent: 0, remaining: 2_000_000 });
    expect(raw.prepare("SELECT status, reason FROM pay_cycle_tasks WHERE id = ?").get(taskId)).toEqual({ status: "void", reason: "Mục tiêu chuyển sang trả từ tiền chi tiêu" });
    expect(auditOf("goal.update")).toEqual([
      { target: "goal:hoa-don", detail: { fields: ["pays_from"], changes: { account_id: { from: "tk-chung", to: null }, pays_from: { from: "account", to: "operating" } } } },
    ]);
    expect(auditOf("pay_cycle_task.void")).toEqual([{ target: `pay_cycle_task:${taskId}`, detail: { reason: "Mục tiêu chuyển sang trả từ tiền chi tiêu", goal_id: "hoa-don" } }]);
    expect((await payCycleView(asD1(raw), "2026-11-12", "husband")).pendingTasks).toBe(0);
    // Chốt hai lớp: ② còn sót của mục tiêu trả từ tiền chi tiêu không vào phần chưa làm.
    raw.prepare("INSERT INTO pay_cycle_tasks (cycle_id, kind, goal_id, suggested, amount) VALUES (?, 'goal', 'hoa-don', 2000000, 2000000)").run(cycleId);
    expect((await payCycleView(asD1(raw), "2026-11-12", "husband")).pendingTasks).toBe(0);

    const before = raw.prepare("SELECT * FROM reserve_goals WHERE id = 'hoa-don'").get();
    expect(err(await call("PATCH", "/v1/settings/goals/hoa-don", { pays_from: "operating", account_id: "tk-chung" }))).toEqual([400, "invalid_input"]);
    expect(raw.prepare("SELECT * FROM reserve_goals WHERE id = 'hoa-don'").get()).toEqual(before);
  });

  it("UC-1209 AC-16: mục tiêu gắn tài khoản con → 409 goal_on_child \"Chọn {mẹ}: khoản gửi đã tính chung với {mẹ}.\", không đổi gì", async () => {
    addChild();
    const patched = await call("PATCH", "/v1/settings/goals/hoc-tap", { account_id: "gui-6-thang" });
    expect([...err(patched), patched.json.error?.message]).toEqual([409, "goal_on_child", "Chọn MB tiết kiệm: khoản gửi đã tính chung với MB tiết kiệm."]);
    expect(err(await call("POST", "/v1/settings/goals", { name: "Tập luyện", target_amount: 10_000_000, account_id: "gui-6-thang" }))).toEqual([409, "goal_on_child"]);
    expect(raw.prepare("SELECT account_id FROM reserve_goals WHERE id = 'hoc-tap'").get()).toEqual({ account_id: "tk-tiet-kiem" });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM reserve_goals WHERE id = 'tap-luyen'").get()).toEqual({ n: 0 });
  });

  it("UC-505 AC-19: GET /v1/settings — nhóm tk-tiet-kiem có số dư gộp, child_ids [con], interest 3.000.000; chi từ con ra ngoài tính vào mục tiêu, chuyển nội bộ không; Điện nước pays_from operating, account_id null, remaining 1.000.000", async () => {
    addChild();
    sharedTx(raw, { at: "2026-11-11 07:00", meaning: "transfer", amount: 5_000_000, from: "tk-tiet-kiem", to: "gui-6-thang" });
    const interest = sharedTx(raw, { at: "2026-11-11 08:00", meaning: "income", amount: 3_000_000, to: "gui-6-thang" });
    raw.prepare("INSERT INTO transaction_report_classes (transaction_id, report_class) VALUES (?, 'passive_income')").run(interest);
    sharedTx(raw, { at: "2026-11-11 09:00", meaning: "spend", amount: 200_000, from: "gui-6-thang", goal: "nha-o" });
    sharedTx(raw, { at: "2026-11-11 09:30", meaning: "transfer", amount: 50_000, from: "gui-6-thang", to: "tk-tiet-kiem", goal: "nha-o" });
    expect((await call("POST", "/v1/settings/goals", dienNuoc)).status).toBe(201);
    sharedTx(raw, { at: "2026-11-11 10:00", meaning: "spend", amount: 1_000_000, from: "vcb-husband", goal: "dien-nuoc" });

    const data = await settingsData();
    expect(data.goal_groups.find((g) => g.account_id === "tk-tiet-kiem")).toMatchObject({ balance: 14_800_000, child_ids: ["gui-6-thang"], interest: 3_000_000, goal_ids: ["nha-o", "hoc-tap"] });
    expect(data.goal_groups.find((g) => g.account_id === "tk-chung")).toMatchObject({ child_ids: [], interest: 0 });
    expect(data.goal_groups.some((g) => g.goal_ids.includes("dien-nuoc"))).toBe(false);
    const byId = Object.fromEntries(data.goals.map((g) => [g.id, g]));
    expect(byId["nha-o"]).toMatchObject({ pays_from: "account", spent: 200_000, remaining: null });
    // Số chia = 14.800.000 − 3.000.000 = 11.800.000: Nhà ở lấy 7.500.000 (gồm 200.000 đã chi), Học tập phần còn lại.
    expect([byId["nha-o"]!.held, byId["hoc-tap"]!.held]).toEqual([7_300_000, 4_500_000]);
    expect(byId["dien-nuoc"]).toMatchObject({ pays_from: "operating", account_id: null, held: null, spent: 1_000_000, remaining: 1_000_000 });
  });
});
