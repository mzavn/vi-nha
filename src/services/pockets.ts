// Ba ngăn (pocket UC-1201, UC-1204, UC-1209, ADR-119, ADR-132): xác nhận ngăn của tài khoản, mục tiêu Dự phòng (mỗi mục
// tiêu một tài khoản thật ngăn Dự phòng, A = số dư sổ tài khoản đó), nhóm danh mục. Cấu hình, không phải sổ cái: không đụng
// transactions. "Tài khoản của mục tiêu đang dùng phải đang dùng, ở ngăn Dự phòng, không rời ngăn / không tắt" giữ bằng
// trigger và index duy nhất (migration 0038); đọc trước chỉ để báo lỗi rõ ràng.

import { checkGoal, MONEY_MAX, type GoalDraft, type Pocket } from "../domain/pockets";
import { DomainError } from "../domain/types";
import { accountBatch, accountIdOf, accountInsert, assertNoGoal, pocketValue, readAccount, slug } from "./settings";

type Row = Record<string, unknown>;
type Input = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400, field?: string): never => {
  throw new DomainError(code, message, status, field);
};
const has = (b: Input, k: string) => Object.prototype.hasOwnProperty.call(b, k);

/** Tên 1–60 ký tự (bỏ dấu cách hai đầu), ra được mã. */
function nameOf(b: Input): { name: string; id: string } {
  const v = b.name;
  const name = typeof v === "string" ? v.trim() : "";
  if (!name || name.length > 60) fail("invalid_input", "Tên từ 1 đến 60 ký tự.", 400, "name");
  const id = slug(name);
  if (!id) fail("invalid_input", "Tên cần có chữ hoặc số.", 400, "name");
  return { name, id };
}
/** Số nguyên hoặc null; thiếu trường → undefined. */
function intOrNull(b: Input, k: string): number | null | undefined {
  if (!has(b, k)) return undefined;
  const v = b[k];
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v)) fail("invalid_input", `${k} phải là số nguyên.`, 400, k);
  return v as number;
}
function strOrNull(b: Input, k: string): string | null | undefined {
  if (!has(b, k)) return undefined;
  const v = b[k];
  if (v === null || v === "") return null;
  if (typeof v !== "string") fail("invalid_input", `${k} phải là chuỗi.`, 400, k);
  return (v as string).trim();
}
function boolOf(b: Input, k: string): boolean | undefined {
  if (!has(b, k)) return undefined;
  if (typeof b[k] !== "boolean") fail("invalid_input", `${k} là true hoặc false.`, 400, k);
  return b[k] as boolean;
}

/**
 * `PUT /v1/settings/pockets` (UC-1201 bước 3): xếp và xác nhận ngăn cả bảng một lần — cả lô hoặc không gì. Tài khoản đang gắn
 * mục tiêu đang dùng mà rời ngăn Dự phòng → 409 account_has_goal. Trả số tài khoản và phần đổi ngăn `{ id: { from, to } }`
 * cho nhật ký `pockets.confirm`.
 */
export async function confirmPockets(db: D1Database, b: Input): Promise<{ count: number; changes: Record<string, { from: Pocket | null; to: Pocket | null }> }> {
  if (!Array.isArray(b.accounts) || b.accounts.length === 0) fail("invalid_input", "accounts là danh sách { id, pocket }.", 400, "accounts");
  const list = (b.accounts as unknown[]).map((x, i) => {
    if (!x || typeof x !== "object" || typeof (x as Input).id !== "string" || !has(x as Input, "pocket")) fail("invalid_input", "Mỗi dòng gồm id và pocket.", 400, `accounts.${i}`);
    return { id: (x as Input).id as string, pocket: pocketValue((x as Input).pocket, `accounts.${i}.pocket`) };
  });
  const ids = [...new Set(list.map((a) => a.id))];
  const current = new Map(
    rows<{ id: string; pocket: Pocket | null }>(
      await db.prepare(`SELECT id, pocket FROM accounts WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(...ids).all(),
    ).map((a) => [a.id, a.pocket]),
  );
  const unknown = ids.find((id) => !current.has(id));
  if (unknown) fail("unknown_account", `Không có tài khoản "${unknown}".`, 400, "accounts");
  const leaving = list.filter((a) => a.pocket !== "reserve").map((a) => a.id);
  for (const id of leaving) await assertNoGoal(db, id);
  await accountBatch(
    db,
    list.map((a) => db.prepare("UPDATE accounts SET pocket = ?, pocket_confirmed = 1 WHERE id = ?").bind(a.pocket, a.id)),
    leaving,
  );
  const changes = Object.fromEntries(list.filter((a) => current.get(a.id) !== a.pocket).map((a) => [a.id, { from: current.get(a.id) ?? null, to: a.pocket }]));
  return { count: list.length, changes };
}

// ── Mục tiêu Dự phòng (UC-1209) ─────────────────────────────────────
const GOAL_SQL = `SELECT g.id, g.name, g.account_id, g.suggested_account_id,
  (SELECT b.book_balance FROM v_account_book b WHERE b.account_id = g.account_id) AS held,
  g.target_amount, g.target_pct, g.monthly_amount, g.repeat_months, g.due_date, g.debt_id, g.sort, g.active FROM reserve_goals g`;

/** Một mục tiêu như `GET /v1/settings › goals[]`. */
export interface GoalView {
  id: string;
  name: string;
  /** Tài khoản thật của mục tiêu (ngăn Dự phòng); null = chưa gắn. */
  account_id: string | null;
  /** Tài khoản bản cập nhật gợi ý (màn chuyển đổi bước 2); không phải gắn. */
  suggested_account_id: string | null;
  /** A = số dư sổ của tài khoản gắn; null = chưa gắn. */
  held: number | null;
  target_amount: number | null;
  target_pct: number | null;
  monthly_amount: number | null;
  repeat_months: number | null;
  due_date: string | null;
  debt_id: string | null;
  sort: number;
  active: boolean;
}
const toGoal = (r: Row): GoalView => ({
  ...(r as unknown as GoalView),
  held: r.account_id === null || r.held === null ? null : Number(r.held),
  sort: Number(r.sort),
  active: Boolean(r.active),
});

/** Mọi mục tiêu (kể cả đã tắt), theo thứ tự rồi tên. */
export async function listGoals(db: D1Database): Promise<GoalView[]> {
  return rows(await db.prepare(`${GOAL_SQL} ORDER BY g.sort, g.name`).all()).map(toGoal);
}

async function readGoal(db: D1Database, id: string): Promise<GoalView> {
  const row = await db.prepare(`${GOAL_SQL} WHERE g.id = ?`).bind(id).first<Row>();
  return row ? toGoal(row) : fail("not_found", "Không có mục tiêu này.", 404);
}

/**
 * Tài khoản gắn mục tiêu đang dùng (UC-1209 bước 2): có thật, đang dùng, ngăn Dự phòng (409 account_not_reserve); không gắn
 * mục tiêu đang dùng khác, không phải tài khoản Ví Thưởng (409 account_has_goal).
 */
async function goalAccountOk(db: D1Database, accountId: string, selfId: string | null): Promise<void> {
  const a = await db.prepare("SELECT name, active, pocket FROM accounts WHERE id = ?").bind(accountId).first<{ name: string; active: number; pocket: Pocket | null }>();
  if (!a || !a.active || a.pocket !== "reserve") fail("account_not_reserve", "Tài khoản của mục tiêu phải đang dùng và thuộc ngăn Dự phòng.", 409, "account_id");
  const other = await db
    .prepare("SELECT name FROM reserve_goals WHERE account_id = ? AND active = 1 AND id IS NOT ?")
    .bind(accountId, selfId)
    .first<{ name: string }>();
  if (other) fail("account_has_goal", `${a!.name} đã gắn mục tiêu "${other.name}": mỗi mục tiêu một tài khoản riêng.`, 409, "account_id");
  const reward = await db.prepare("SELECT 1 FROM config WHERE k = 'surplus_reward_account' AND v = ?").bind(accountId).first();
  if (reward) fail("account_has_goal", `${a!.name} là tài khoản Ví Thưởng: chọn tài khoản Dự phòng khác cho mục tiêu.`, 409, "account_id");
}

/** Khoản nợ gắn phải có thật; mỗi khoản nợ tối đa một mục tiêu đang dùng (trừ chính mục tiêu đang sửa). */
async function debtOk(db: D1Database, debtId: string, selfId: string | null): Promise<void> {
  if (!(await db.prepare("SELECT 1 FROM debts WHERE id = ?").bind(debtId).first())) fail("unknown_debt", "Không có khoản nợ này.", 400, "debt_id");
  const other = await db.prepare("SELECT name FROM reserve_goals WHERE debt_id = ? AND active = 1 AND id IS NOT ?").bind(debtId, selfId).first<{ name: string }>();
  if (other) fail("debt_has_goal", `Khoản nợ này đã có mục tiêu "${other.name}".`, 409, "debt_id");
}

/** Ghi mục tiêu; trigger / index duy nhất chặn khi hai máy cùng lúc → báo đúng mã. */
async function goalWrite(statement: D1PreparedStatement): Promise<void> {
  try {
    await statement.run();
  } catch (err) {
    const msg = String(err);
    if (/account_not_reserve/.test(msg)) fail("account_not_reserve", "Tài khoản của mục tiêu phải đang dùng và thuộc ngăn Dự phòng.", 409, "account_id");
    // Trigger 0041 (ADR-134): máy khác vừa đặt tài khoản này làm Ví Thưởng.
    if (/account_is_reward/.test(msg)) fail("account_has_goal", "Tài khoản này là tài khoản Ví Thưởng: chọn tài khoản Dự phòng khác cho mục tiêu.", 409, "account_id");
    if (/idx_reserve_goals_account|reserve_goals\.account_id/.test(msg)) fail("account_has_goal", "Tài khoản này đã gắn mục tiêu khác.", 409, "account_id");
    if (/idx_reserve_goals_debt|reserve_goals\.debt_id/.test(msg)) fail("debt_has_goal", "Khoản nợ này đã có mục tiêu đang dùng.", 409, "debt_id");
    if (/UNIQUE|PRIMARY/.test(msg)) fail("duplicate", "Đã có mục tiêu với tên này.", 409, "name");
    throw err;
  }
}

/** Các cột số / hạn / nợ có trong input (undefined = không gửi). */
function goalInput(b: Input) {
  return {
    target_amount: intOrNull(b, "target_amount"),
    target_pct: intOrNull(b, "target_pct"),
    monthly_amount: intOrNull(b, "monthly_amount"),
    repeat_months: intOrNull(b, "repeat_months"),
    due_date: strOrNull(b, "due_date"),
    debt_id: strOrNull(b, "debt_id"),
  };
}

/** `POST /v1/settings/goals` (UC-1209): mã = slug của tên, trùng → 409 duplicate; `account_id` không gửi = chưa gắn. */
export async function createGoal(db: D1Database, b: Input): Promise<GoalView> {
  const { name, id } = nameOf(b);
  if (await db.prepare("SELECT 1 FROM reserve_goals WHERE id = ?").bind(id).first()) fail("duplicate", "Đã có mục tiêu với tên này.", 409, "name");
  const n = goalInput(b);
  const draft = checkGoal({
    target_amount: n.target_amount ?? null,
    target_pct: n.target_pct ?? null,
    monthly_amount: n.monthly_amount ?? null,
    repeat_months: n.repeat_months ?? null,
    due_date: n.due_date ?? null,
    debt_id: n.debt_id ?? null,
  });
  const accountId = strOrNull(b, "account_id") ?? null;
  if (accountId) await goalAccountOk(db, accountId, null);
  if (draft.debt_id) await debtOk(db, draft.debt_id, null);
  const sort = intOrNull(b, "sort") ?? 100;
  await goalWrite(
    db
      .prepare(
        `INSERT INTO reserve_goals (id, name, account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date, debt_id, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, name, accountId, draft.target_amount, draft.target_pct, draft.monthly_amount, draft.repeat_months, draft.due_date, draft.debt_id, sort),
  );
  return readGoal(db, id);
}

/**
 * `PATCH /v1/settings/goals/:id` (UC-1209 bước 2–3): gắn / đổi / bỏ gắn tài khoản (`account_id`), tắt / bật lại (`active`; tắt
 * lúc nào cũng được — tiền vẫn ở tài khoản). Đổi số mỗi tháng / số tháng mà không gửi số cần thì B tính lại. Trả `changes`
 * có `account_id: { from, to }` khi đổi tài khoản.
 */
export async function updateGoal(db: D1Database, id: string, b: Input): Promise<{ goal: GoalView; changes: Record<string, { from: unknown; to: unknown }> }> {
  const current = await readGoal(db, id);
  const name = has(b, "name") ? nameOf(b).name : undefined;
  const n = goalInput(b);
  const pick = <K extends keyof GoalDraft>(k: K, v: GoalDraft[K] | undefined): GoalDraft[K] => (v === undefined ? current[k] : v);
  const recompute = (n.monthly_amount !== undefined || n.repeat_months !== undefined) && n.target_amount === undefined;
  const draft = checkGoal({
    target_amount: recompute ? null : pick("target_amount", n.target_amount),
    target_pct: pick("target_pct", n.target_pct),
    monthly_amount: pick("monthly_amount", n.monthly_amount),
    repeat_months: pick("repeat_months", n.repeat_months),
    due_date: pick("due_date", n.due_date),
    debt_id: pick("debt_id", n.debt_id),
  });
  const accountId = has(b, "account_id") ? (strOrNull(b, "account_id") ?? null) : current.account_id;
  const active = boolOf(b, "active") ?? current.active;
  if (active && accountId && (accountId !== current.account_id || !current.active)) await goalAccountOk(db, accountId, id);
  if (draft.debt_id && active && (draft.debt_id !== current.debt_id || !current.active)) await debtOk(db, draft.debt_id, id);
  const sort = intOrNull(b, "sort");
  await goalWrite(
    db
      .prepare(
        `UPDATE reserve_goals SET name = ?, account_id = ?, target_amount = ?, target_pct = ?, monthly_amount = ?, repeat_months = ?,
           due_date = ?, debt_id = ?, sort = ?, active = ? WHERE id = ?`,
      )
      .bind(
        name ?? current.name, accountId, draft.target_amount, draft.target_pct, draft.monthly_amount, draft.repeat_months,
        draft.due_date, draft.debt_id, sort ?? current.sort, active ? 1 : 0, id,
      ),
  );
  const changes: Record<string, { from: unknown; to: unknown }> = accountId !== current.account_id ? { account_id: { from: current.account_id, to: accountId } } : {};
  return { goal: await readGoal(db, id), changes };
}

type AccountView = NonNullable<Awaited<ReturnType<typeof readAccount>>>;

/**
 * `POST /v1/settings/goals/:id/account` (UC-1209 bước 8, ADR-134): tạo tài khoản ngăn Dự phòng (đã xác nhận) và gắn mục tiêu
 * trong MỘT batch. Mã tài khoản (gửi `id`, hoặc slug của tên) là khoá idempotency. Thứ tự: mục tiêu không có → 404, tắt → 409
 * goal_inactive; đã gắn đúng mã đó → `created: false`, không kiểm thân (bỏ cả `duplicate` của mã lẫn số tài khoản — chính tài
 * khoản đó); gắn tài khoản khác → 409 goal_has_account; rồi kiểm thân như thêm tài khoản; rồi batch. Batch không ghi gì hoặc
 * lỗi → đọc lại trạng thái và trả theo các bước trên, không đoán theo chữ của lỗi; vẫn không khớp → ném lỗi tiếp.
 */
export async function createGoalAccount(db: D1Database, goalId: string, b: Input): Promise<{ goal: GoalView; account: AccountView; created: boolean }> {
  const settled = async (accountId: string | null) => {
    const goal = await readGoal(db, goalId);
    if (!goal.active) fail("goal_inactive", "Mục tiêu đã tắt: bật lại mục tiêu trước khi tạo tài khoản cho nó.", 409);
    if (goal.account_id === null) return null;
    if (goal.account_id !== accountId) fail("goal_has_account", "Mục tiêu đã gắn tài khoản khác: bỏ gắn tài khoản đó trước.", 409, "account_id");
    return { goal, account: (await readAccount(db, goal.account_id))!, created: false };
  };
  const done = await settled(accountIdOf(b));
  if (done) return done;
  const { id, statement } = await accountInsert(db, { ...b, pocket: "reserve" }, {
    sql: "EXISTS (SELECT 1 FROM reserve_goals WHERE id = ? AND active = 1 AND account_id IS NULL)",
    binds: [goalId],
  });
  const link = db
    .prepare("UPDATE reserve_goals SET account_id = ?1 WHERE id = ?2 AND active = 1 AND account_id IS NULL AND EXISTS (SELECT 1 FROM accounts WHERE id = ?1)")
    .bind(id, goalId);
  let failure: unknown = null;
  try {
    const [inserted] = await db.batch([statement, link]);
    if (Number(inserted?.meta?.changes ?? 0) === 1) return { goal: await readGoal(db, goalId), account: (await readAccount(db, id))!, created: true };
  } catch (err) {
    failure = err;
  }
  const again = await settled(id);
  if (again) return again;
  if (await db.prepare("SELECT 1 FROM accounts WHERE id = ?").bind(id).first()) fail("duplicate", "Đã có tài khoản với mã này.", 409);
  throw failure ?? new Error(`Tạo tài khoản cho mục tiêu ${goalId} không ghi được gì.`);
}

// ── Nhóm danh mục (UC-1204) ─────────────────────────────────────────
export interface CategoryGroupView {
  id: string;
  name: string;
  essential: boolean;
  /** Hạn mức mềm mỗi kỳ lương; null = không đặt. */
  cycle_limit: number | null;
  sort: number;
  active: boolean;
}
const GROUP_SQL = "SELECT id, name, essential, cycle_limit, sort, active FROM category_groups";
const toGroup = (r: Row): CategoryGroupView => ({
  id: String(r.id),
  name: String(r.name),
  essential: Boolean(r.essential),
  cycle_limit: r.cycle_limit === null ? null : Number(r.cycle_limit),
  sort: Number(r.sort),
  active: Boolean(r.active),
});

export async function listCategoryGroups(db: D1Database): Promise<CategoryGroupView[]> {
  return rows(await db.prepare(`${GROUP_SQL} ORDER BY active DESC, sort, name`).all()).map(toGroup);
}

async function readGroup(db: D1Database, id: string): Promise<CategoryGroupView> {
  const row = await db.prepare(`${GROUP_SQL} WHERE id = ?`).bind(id).first<Row>();
  return row ? toGroup(row) : fail("not_found", "Không có nhóm danh mục này.", 404);
}

/** Hạn mức mềm: số nguyên > 0, tối đa 1e12, hoặc null (bỏ hạn mức). */
function cycleLimit(b: Input): number | null | undefined {
  const v = intOrNull(b, "cycle_limit");
  if (v !== undefined && v !== null && (v <= 0 || v > MONEY_MAX)) fail("invalid_input", "Hạn mức là số nguyên lớn hơn 0 (để trống = không đặt).", 400, "cycle_limit");
  return v;
}

export async function createCategoryGroup(db: D1Database, b: Input): Promise<CategoryGroupView> {
  const { name, id } = nameOf(b);
  if (await db.prepare("SELECT 1 FROM category_groups WHERE id = ?").bind(id).first()) fail("duplicate", "Đã có nhóm danh mục với tên này.", 409, "name");
  const limit = cycleLimit(b) ?? null;
  await db
    .prepare("INSERT INTO category_groups (id, name, essential, cycle_limit, sort) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, boolOf(b, "essential") ? 1 : 0, limit, intOrNull(b, "sort") ?? 100)
    .run();
  return readGroup(db, id);
}

/** Tắt nhóm còn danh mục đang dùng → 409 group_in_use (câu UPDATE có điều kiện). */
export async function updateCategoryGroup(db: D1Database, id: string, b: Input): Promise<CategoryGroupView> {
  const current = await readGroup(db, id);
  const name = has(b, "name") ? nameOf(b).name : current.name;
  const limit = cycleLimit(b);
  const essential = boolOf(b, "essential") ?? current.essential;
  const active = boolOf(b, "active") ?? current.active;
  const res = await db
    .prepare(
      `UPDATE category_groups SET name = ?1, essential = ?2, cycle_limit = ?3, sort = ?4, active = ?5
       WHERE id = ?6 AND (?5 = 1 OR NOT EXISTS (SELECT 1 FROM categories c WHERE c.group_id = ?6 AND c.active = 1))`,
    )
    .bind(name, essential ? 1 : 0, limit === undefined ? current.cycle_limit : limit, intOrNull(b, "sort") ?? current.sort, active ? 1 : 0, id)
    .run();
  if (!res.meta.changes) fail("group_in_use", "Nhóm còn danh mục đang dùng: chuyển danh mục sang nhóm khác trước.", 409, "active");
  return readGroup(db, id);
}
