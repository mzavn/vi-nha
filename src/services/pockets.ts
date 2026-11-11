// Ba ngăn (pocket UC-1201, UC-1204, UC-1209, ADR-119, ADR-132): xác nhận ngăn của tài khoản, mục tiêu Dự phòng (mỗi mục
// tiêu gắn một tài khoản thật ngăn Dự phòng, nhiều mục tiêu dùng chung được một tài khoản — A chia từ số dư theo thứ tự ưu
// tiên, `fillGoals`), nhóm danh mục. Cấu hình, không phải sổ cái: không ghi transactions. "Tài khoản của mục tiêu đang dùng
// phải đang dùng, ở ngăn Dự phòng, không rời ngăn / không tắt", "mục tiêu % giữ tài khoản riêng" giữ bằng trigger (migration
// 0038, 0042); đọc trước chỉ để báo lỗi rõ ràng.

import { dayKey } from "../domain/period";
import { checkGoal, goalGroups, goalOrder, goalNeed, MONEY_MAX, type FilledGoal, type GoalDraft, type GoalGroup, type Pocket, type PocketGoalInput } from "../domain/pockets";
import { DomainError } from "../domain/types";
import { loadCycles } from "./ledger";
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
  (SELECT b.book_balance FROM v_account_book b WHERE b.account_id = g.account_id) AS balance,
  g.target_amount, g.target_pct, g.monthly_amount, g.repeat_months, g.due_date, g.debt_id, g.sort, g.active FROM reserve_goals g`;

/** Một mục tiêu như `GET /v1/settings › goals[]`. */
export interface GoalView {
  id: string;
  name: string;
  /** Tài khoản thật của mục tiêu (ngăn Dự phòng); null = chưa gắn. */
  account_id: string | null;
  /** Tài khoản bản cập nhật gợi ý (màn chuyển đổi bước 2); không phải gắn. */
  suggested_account_id: string | null;
  /** A = đã có sau khi chia số dư tài khoản (UC-1209 bước 9); mục tiêu đã tắt = số dư tài khoản; null = chưa gắn. */
  held: number | null;
  /** Số cần (= B); null với mục tiêu %, chưa gắn hoặc đã tắt. */
  need: number | null;
  /** Đã chi cho mục tiêu trong kỳ lương hiện tại (UC-1209 bước 11). */
  spent: number;
  short: number | null;
  target_amount: number | null;
  target_pct: number | null;
  monthly_amount: number | null;
  repeat_months: number | null;
  due_date: string | null;
  debt_id: string | null;
  sort: number;
  active: boolean;
}
/** Nhóm mục tiêu của một tài khoản như `GET /v1/settings › goal_groups[]` — cùng số `snapshot.pockets.reserve.groups`. */
export interface GoalGroupView {
  account_id: string;
  balance: number;
  need: number | null;
  spent: number;
  short: number | null;
  extra: number | null;
  goal_ids: string[];
}

/**
 * Đã chi cho từng mục tiêu đang dùng từ `since` (pocket UC-1209 bước 11): Σ chi / chuyển ra còn hiệu lực gắn mục tiêu, tiền ra
 * từ tài khoản hiện tại của nó, `at` ≥ đầu kỳ, − hoàn tiền (`link_id` tới các khoản đó) về đúng tài khoản đó trong cùng cửa
 * sổ. Một câu, chạy trong batch của snapshot.
 */
export const goalSpentStatement = (db: D1Database, since: string) =>
  db
    .prepare(
      `SELECT g.id,
         COALESCE((SELECT SUM(t.amount) FROM transactions t
           WHERE t.goal_id = g.id AND t.status = 'active' AND t.account_id = g.account_id AND t.at >= ?1), 0)
         - COALESCE((SELECT SUM(r.amount) FROM transactions r JOIN transactions s ON s.id = r.link_id
           WHERE r.meaning = 'refund' AND r.status = 'active' AND r.at >= ?1 AND r.counter_account_id = g.account_id
             AND s.goal_id = g.id AND s.status = 'active' AND s.account_id = g.account_id AND s.at >= ?1), 0) AS spent
       FROM reserve_goals g WHERE g.active = 1 AND g.account_id IS NOT NULL`,
    )
    .bind(since);

/** `id → đã chi` từ kết quả của `goalSpentStatement`. */
export const goalSpentMap = (r: D1Result) => new Map(rows<{ id: string; spent: number }>(r).map((g) => [g.id, Number(g.spent)]));

/** Đầu kỳ lương hiện tại: `started_at` của kỳ lưu, chưa có kỳ lưu thì ngày lương danh nghĩa gần nhất (`cycleRanges`). */
export async function cycleStart(db: D1Database, now: Date): Promise<string> {
  return (await loadCycles(db, now, dayKey(now))).ranges.at(-1)!.start;
}

/** Mọi mục tiêu (kể cả đã tắt) đọc từ D1 kèm đã chi từ `since`, và kết quả chia số dư của các mục tiêu đang dùng. */
export interface GoalFill {
  rows: Row[];
  inputs: PocketGoalInput[];
  active: Set<string>;
  groups: GoalGroup[];
  filled: Map<string, FilledGoal>;
}

/**
 * Chia số dư cho mục tiêu đang dùng với đã chi từ `since` (pocket UC-1209 bước 9, 11) — một luật cho `GET /v1/settings` và
 * việc ② (A lúc mở kỳ, A trên thẻ việc); snapshot đi cùng hàm `goalGroups` qua `pocketsView`.
 */
export async function goalFill(db: D1Database, since: string): Promise<GoalFill> {
  const [goalRows, accounts, spentRows] = await db.batch([
    db.prepare(GOAL_SQL),
    db.prepare("SELECT b.account_id AS id, b.name, b.book_balance AS balance FROM v_account_book b"),
    goalSpentStatement(db, since),
  ]);
  const spent = goalSpentMap(spentRows!);
  const all = rows(goalRows!);
  const inputs: PocketGoalInput[] = all.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    accountId: (r.account_id as string | null) ?? null,
    target: r.target_amount === null ? null : Number(r.target_amount),
    targetPct: r.target_pct === null ? null : Number(r.target_pct),
    monthly: r.monthly_amount === null ? null : Number(r.monthly_amount),
    repeatMonths: r.repeat_months === null ? null : Number(r.repeat_months),
    dueDate: (r.due_date as string | null) ?? null,
    debtId: (r.debt_id as string | null) ?? null,
    sort: Number(r.sort),
    spent: spent.get(String(r.id)) ?? 0,
  }));
  const active = new Set(all.filter((r) => r.active).map((r) => String(r.id)));
  const { groups, filled } = goalGroups(
    rows<{ id: string; name: string; balance: number }>(accounts!).map((a) => ({ ...a, balance: Number(a.balance) })),
    inputs.filter((g) => active.has(g.id)).sort(goalOrder),
  );
  return { rows: all, inputs, active, groups, filled };
}

/**
 * Mọi mục tiêu (kể cả đã tắt) theo thứ tự ưu tiên và nhóm theo tài khoản (`GET /v1/settings`, UC-505): mục tiêu đang dùng
 * chia số dư tài khoản bằng `goalGroups` với đã chi từ đầu kỳ — cùng luật, cùng mốc snapshot.
 */
export async function listGoals(db: D1Database, now: Date): Promise<{ goals: GoalView[]; groups: GoalGroupView[] }> {
  const { rows: all, inputs, groups, filled } = await goalFill(db, await cycleStart(db, now));
  const order = new Map([...inputs].sort(goalOrder).map((g, i) => [g.id, i]));
  const goals = all
    .map((r, i): GoalView => {
      const f = filled.get(String(r.id));
      const g = inputs[i]!;
      const { balance: _, ...rest } = r;
      return {
        ...(rest as unknown as GoalView),
        held: f ? f.held : r.account_id === null || r.balance === null ? null : Number(r.balance),
        need: f ? goalNeed(g) : null,
        spent: f ? f.spent : 0,
        short: f ? f.short : null,
        sort: g.sort,
        active: Boolean(r.active),
      };
    })
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return {
    goals,
    groups: groups.map((g) => ({ account_id: g.accountId, balance: g.balance, need: g.need, spent: g.spent, short: g.short, extra: g.extra, goal_ids: g.goalIds })),
  };
}

async function readGoal(db: D1Database, id: string, now: Date): Promise<GoalView> {
  return (await listGoals(db, now)).goals.find((g) => g.id === id) ?? fail("not_found", "Không có mục tiêu này.", 404);
}

const TAX_SHARED = "Thuế cần tài khoản riêng: thuế đã nộp đếm mọi khoản chi từ tài khoản này.";

/**
 * Tài khoản gắn mục tiêu đang dùng (UC-1209 bước 2): có thật, đang dùng, ngăn Dự phòng (409 account_not_reserve); không phải
 * tài khoản Ví Thưởng (409 account_is_reward); nhiều mục tiêu dùng chung được, trừ mục tiêu % (409 tax_account_shared).
 */
async function goalAccountOk(db: D1Database, accountId: string, selfId: string | null, selfPct: boolean): Promise<void> {
  const a = await db.prepare("SELECT name, active, pocket FROM accounts WHERE id = ?").bind(accountId).first<{ name: string; active: number; pocket: Pocket | null }>();
  if (!a || !a.active || a.pocket !== "reserve") fail("account_not_reserve", "Tài khoản của mục tiêu phải đang dùng và thuộc ngăn Dự phòng.", 409, "account_id");
  const reward = await db.prepare("SELECT 1 FROM config WHERE k = 'surplus_reward_account' AND v = ?").bind(accountId).first();
  if (reward) fail("account_is_reward", `${a!.name} là tài khoản Ví Thưởng: chọn tài khoản Dự phòng khác cho mục tiêu.`, 409, "account_id");
  await taxAccountOk(db, accountId, selfId, selfPct);
}

/** Mục tiêu % giữ tài khoản riêng (QĐ1-A): tài khoản có mục tiêu đang dùng khác và một bên là mục tiêu % → 409. */
async function taxAccountOk(db: D1Database, accountId: string, selfId: string | null, selfPct: boolean): Promise<void> {
  const others = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(MAX(target_pct IS NOT NULL), 0) AS pct FROM reserve_goals WHERE account_id = ? AND active = 1 AND id IS NOT ?")
    .bind(accountId, selfId)
    .first<{ n: number; pct: number }>();
  if (others && others.n > 0 && (selfPct || others.pct === 1)) fail("tax_account_shared", TAX_SHARED, 409, "account_id");
}

/** Khoản nợ gắn phải có thật; mỗi khoản nợ tối đa một mục tiêu đang dùng (trừ chính mục tiêu đang sửa). */
async function debtOk(db: D1Database, debtId: string, selfId: string | null): Promise<void> {
  if (!(await db.prepare("SELECT 1 FROM debts WHERE id = ?").bind(debtId).first())) fail("unknown_debt", "Không có khoản nợ này.", 400, "debt_id");
  const other = await db.prepare("SELECT name FROM reserve_goals WHERE debt_id = ? AND active = 1 AND id IS NOT ?").bind(debtId, selfId).first<{ name: string }>();
  if (other) fail("debt_has_goal", `Khoản nợ này đã có mục tiêu "${other.name}".`, 409, "debt_id");
}

/** Ghi mục tiêu; trigger / index duy nhất chặn khi hai máy cùng lúc → báo đúng mã. */
async function goalWrite(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (err) {
    const msg = String(err);
    if (/account_not_reserve/.test(msg)) fail("account_not_reserve", "Tài khoản của mục tiêu phải đang dùng và thuộc ngăn Dự phòng.", 409, "account_id");
    // Trigger 0041 (ADR-134): máy khác vừa đặt tài khoản này làm Ví Thưởng.
    if (/account_is_reward/.test(msg)) fail("account_is_reward", "Tài khoản này là tài khoản Ví Thưởng: chọn tài khoản Dự phòng khác cho mục tiêu.", 409, "account_id");
    // Trigger 0042 (QĐ1-A): máy khác vừa gắn mục tiêu khác / mục tiêu % vào tài khoản này.
    if (/tax_account_shared/.test(msg)) fail("tax_account_shared", TAX_SHARED, 409, "account_id");
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

/** Mục tiêu đang dùng theo thứ tự ưu tiên hiện tại (mã, hạn) — để chen mục tiêu mới / kiểm `PUT …/goals/order`. */
async function activeOrder(db: D1Database): Promise<{ id: string; dueDate: string | null }[]> {
  const list = rows<{ id: string; name: string; sort: number; dueDate: string | null }>(
    await db.prepare("SELECT id, name, sort, due_date AS dueDate FROM reserve_goals WHERE active = 1").all(),
  );
  return list.sort(goalOrder);
}

/** Đặt `sort = 10 × vị trí` cho các mục tiêu đang dùng theo `ids` (cùng batch với câu ghi khác nếu có). */
const renumber = (db: D1Database, ids: string[]) => ids.map((gid, i) => db.prepare("UPDATE reserve_goals SET sort = ? WHERE id = ? AND active = 1").bind(10 * (i + 1), gid));

/**
 * `POST /v1/settings/goals` (UC-1209): mã = slug của tên, trùng → 409 duplicate; `account_id` không gửi = chưa gắn. Không gửi
 * `sort` → chen trước mục tiêu đang dùng đầu tiên có hạn muộn hơn hoặc không có hạn (không hạn → cuối), rồi đánh số lại mọi
 * mục tiêu đang dùng 10, 20, … trong cùng batch (bước 10, QĐ5-A).
 */
export async function createGoal(db: D1Database, b: Input, now: Date): Promise<GoalView> {
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
  if (accountId) await goalAccountOk(db, accountId, null, draft.target_pct !== null);
  if (draft.debt_id) await debtOk(db, draft.debt_id, null);
  const sort = intOrNull(b, "sort");
  const insert = db
    .prepare(
      `INSERT INTO reserve_goals (id, name, account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date, debt_id, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, name, accountId, draft.target_amount, draft.target_pct, draft.monthly_amount, draft.repeat_months, draft.due_date, draft.debt_id, sort ?? 0);
  if (sort !== undefined && sort !== null) {
    await goalWrite(() => insert.run());
  } else {
    const order = await activeOrder(db);
    const due = draft.due_date;
    const later = due === null ? -1 : order.findIndex((g) => g.dueDate === null || g.dueDate > due);
    const at = later === -1 ? order.length : later;
    const ids = [...order.slice(0, at).map((g) => g.id), id, ...order.slice(at).map((g) => g.id)];
    await goalWrite(() => db.batch([insert, ...renumber(db, ids)]));
  }
  return readGoal(db, id, now);
}

/**
 * `PATCH /v1/settings/goals/:id` (UC-1209 bước 2–3): gắn / đổi / bỏ gắn tài khoản (`account_id`), tắt / bật lại (`active`; tắt
 * lúc nào cũng được — tiền vẫn ở tài khoản). Đổi số mỗi tháng / số tháng mà không gửi số cần thì B tính lại. Đổi hạn không đổi
 * thứ tự. Trả `changes` có `account_id: { from, to }` khi đổi tài khoản.
 */
export async function updateGoal(db: D1Database, id: string, b: Input, now: Date): Promise<{ goal: GoalView; changes: Record<string, { from: unknown; to: unknown }> }> {
  const current = await readGoal(db, id, now);
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
  const pct = draft.target_pct !== null;
  if (active && accountId && (accountId !== current.account_id || !current.active)) await goalAccountOk(db, accountId, id, pct);
  else if (active && accountId && pct && current.target_pct === null) await taxAccountOk(db, accountId, id, pct);
  if (draft.debt_id && active && (draft.debt_id !== current.debt_id || !current.active)) await debtOk(db, draft.debt_id, id);
  const sort = intOrNull(b, "sort");
  await goalWrite(() =>
    db
      .prepare(
        `UPDATE reserve_goals SET name = ?, account_id = ?, target_amount = ?, target_pct = ?, monthly_amount = ?, repeat_months = ?,
           due_date = ?, debt_id = ?, sort = ?, active = ? WHERE id = ?`,
      )
      .bind(
        name ?? current.name, accountId, draft.target_amount, draft.target_pct, draft.monthly_amount, draft.repeat_months,
        draft.due_date, draft.debt_id, sort ?? current.sort, active ? 1 : 0, id,
      )
      .run(),
  );
  const changes: Record<string, { from: unknown; to: unknown }> = accountId !== current.account_id ? { account_id: { from: current.account_id, to: accountId } } : {};
  return { goal: await readGoal(db, id, now), changes };
}

/**
 * `PUT /v1/settings/goals/order` (UC-1209 bước 10): `ids` là mọi mục tiêu đang dùng, mỗi mã đúng một lần → một batch đặt
 * `sort = 10 × vị trí`. Thiếu / thừa / trùng / mã lạ / mục tiêu đã tắt → 400 invalid_order, không đổi gì. Trả thứ tự cũ / mới
 * cho nhật ký `goal.order`.
 */
export async function reorderGoals(db: D1Database, b: Input, now: Date): Promise<{ goals: GoalView[]; from: string[]; to: string[] }> {
  const ids = b.ids;
  const from = (await activeOrder(db)).map((g) => g.id);
  const valid =
    Array.isArray(ids) && ids.every((x) => typeof x === "string") && ids.length === from.length && new Set(ids).size === ids.length && ids.every((x) => from.includes(x as string));
  if (!valid) fail("invalid_order", "Danh sách mục tiêu phải gồm mọi mục tiêu đang dùng, mỗi mục tiêu đúng một lần — tải lại rồi thử lại.", 400, "ids");
  const to = ids as string[];
  await db.batch(renumber(db, to));
  return { goals: (await listGoals(db, now)).goals, from, to };
}

type AccountView = NonNullable<Awaited<ReturnType<typeof readAccount>>>;

/**
 * `POST /v1/settings/goals/:id/account` (UC-1209 bước 8, ADR-134): tạo tài khoản ngăn Dự phòng (đã xác nhận) và gắn mục tiêu
 * trong MỘT batch. Mã tài khoản (gửi `id`, hoặc slug của tên) là khoá idempotency. Thứ tự: mục tiêu không có → 404, tắt → 409
 * goal_inactive; đã gắn đúng mã đó → `created: false`, không kiểm thân (bỏ cả `duplicate` của mã lẫn số tài khoản — chính tài
 * khoản đó); gắn tài khoản khác → 409 goal_has_account; rồi kiểm thân như thêm tài khoản; rồi batch. Batch không ghi gì hoặc
 * lỗi → đọc lại trạng thái và trả theo các bước trên, không đoán theo chữ của lỗi; vẫn không khớp → ném lỗi tiếp.
 */
export async function createGoalAccount(db: D1Database, goalId: string, b: Input, now: Date): Promise<{ goal: GoalView; account: AccountView; created: boolean }> {
  const settled = async (accountId: string | null) => {
    const goal = await readGoal(db, goalId, now);
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
    if (Number(inserted?.meta?.changes ?? 0) === 1) return { goal: await readGoal(db, goalId, now), account: (await readAccount(db, id))!, created: true };
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
