// Ba ngăn (pocket UC-1201, UC-1204, UC-1209, ADR-119, ADR-132): xác nhận ngăn của tài khoản, mục tiêu Dự phòng (mỗi mục
// tiêu gắn một tài khoản thật ngăn Dự phòng, nhiều mục tiêu dùng chung được một tài khoản — A chia từ số dư theo thứ tự ưu
// tiên, `fillGoals`), nhóm danh mục. Cấu hình, không phải sổ cái: không ghi transactions. "Tài khoản của mục tiêu đang dùng
// phải đang dùng, ở ngăn Dự phòng, không rời ngăn / không tắt", "mục tiêu % giữ tài khoản riêng" giữ bằng trigger (migration
// 0038, 0042); đọc trước chỉ để báo lỗi rõ ràng.

import { dayKey } from "../domain/period";
import {
  checkGoal,
  goalGroups,
  goalOrder,
  goalNeed,
  MONEY_MAX,
  operatingGoals,
  type FilledGoal,
  type GoalDraft,
  type GoalGroup,
  type GoalPaysFrom,
  type OperatingGoal,
  type Pocket,
  type PocketGoalInput,
} from "../domain/pockets";
import { DomainError } from "../domain/types";
import { groupInterestFrom, groupInterestStatements } from "./goal-groups";
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
 * mục tiêu đang dùng mà rời ngăn Dự phòng → 409 account_has_goal. Dòng của tài khoản con bị bỏ qua: con theo ngăn của mẹ (trigger
 * 0044); mẹ có con đang dùng mà sang Vận hành → 409 account_has_children. Trả số dòng gửi lên và phần đổi ngăn
 * `{ id: { from, to, parent? } }` (con đổi theo mẹ có `parent`) cho nhật ký `pockets.confirm`.
 */
export async function confirmPockets(
  db: D1Database,
  b: Input,
): Promise<{ count: number; changes: Record<string, { from: Pocket | null; to: Pocket | null; parent?: string }> }> {
  if (!Array.isArray(b.accounts) || b.accounts.length === 0) fail("invalid_input", "accounts là danh sách { id, pocket }.", 400, "accounts");
  const list = (b.accounts as unknown[]).map((x, i) => {
    if (!x || typeof x !== "object" || typeof (x as Input).id !== "string" || !has(x as Input, "pocket")) fail("invalid_input", "Mỗi dòng gồm id và pocket.", 400, `accounts.${i}`);
    return { id: (x as Input).id as string, pocket: pocketValue((x as Input).pocket, `accounts.${i}.pocket`) };
  });
  const ids = [...new Set(list.map((a) => a.id))];
  type Current = { id: string; name: string; pocket: Pocket | null; parent: string | null; children: number };
  const current = new Map(
    rows<Current>(
      await db
        .prepare(
          `SELECT a.id, a.name, a.pocket, a.parent_account_id AS parent,
             (SELECT COUNT(*) FROM accounts c WHERE c.parent_account_id = a.id AND c.active = 1) AS children
           FROM accounts a WHERE a.id IN (${ids.map(() => "?").join(", ")})`,
        )
        .bind(...ids)
        .all(),
    ).map((a) => [a.id, a]),
  );
  const unknown = ids.find((id) => !current.has(id));
  if (unknown) fail("unknown_account", `Không có tài khoản "${unknown}".`, 400, "accounts");
  const own = list.filter((a) => current.get(a.id)!.parent === null);
  const leaving = own.filter((a) => a.pocket !== "reserve").map((a) => a.id);
  for (const id of leaving) await assertNoGoal(db, id);
  const parents = own.map((a) => a.id);
  const children = parents.length
    ? rows<{ id: string; pocket: Pocket | null; parent: string }>(
        await db
          .prepare(`SELECT id, pocket, parent_account_id AS parent FROM accounts WHERE parent_account_id IN (${parents.map(() => "?").join(", ")}) ORDER BY id`)
          .bind(...parents)
          .all(),
      )
    : [];
  if (own.length)
    try {
      await accountBatch(
        db,
        own.map((a) => db.prepare("UPDATE accounts SET pocket = ?, pocket_confirmed = 1 WHERE id = ?").bind(a.pocket, a.id)),
        leaving,
      );
    } catch (err) {
      // Mẹ có con đang dùng không sang Vận hành (trigger trg_accounts_keep_children) — cả lô không ghi gì.
      if (!/account_has_children/.test(String(err))) throw err;
      const toOperating = own.filter((a) => a.pocket === "operating").map((a) => current.get(a.id)!);
      const parent = toOperating.find((a) => Number(a.children) > 0) ?? toOperating[0];
      fail("account_has_children", `Tất toán / tắt các khoản gửi của ${parent?.name ?? "tài khoản này"} trước.`, 409, "pocket");
    }
  const to = new Map(own.map((a) => [a.id, a.pocket]));
  const changes: Record<string, { from: Pocket | null; to: Pocket | null; parent?: string }> = Object.fromEntries(
    own.filter((a) => current.get(a.id)!.pocket !== a.pocket).map((a) => [a.id, { from: current.get(a.id)!.pocket, to: a.pocket }]),
  );
  for (const c of children) if (c.pocket !== to.get(c.parent)) changes[c.id] = { from: c.pocket, to: to.get(c.parent)!, parent: c.parent };
  return { count: list.length, changes };
}

// ── Mục tiêu Dự phòng (UC-1209) ─────────────────────────────────────
const GOAL_SQL = `SELECT g.id, g.name, g.account_id, g.suggested_account_id,
  (SELECT b.book_balance FROM v_account_book b WHERE b.account_id = g.account_id) AS balance,
  g.target_amount, g.target_pct, g.monthly_amount, g.repeat_months, g.due_date, g.debt_id, g.sort, g.active, g.pays_from FROM reserve_goals g`;

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
  /** Nơi để tiền (ADR-141): `account` (tài khoản để dành) | `operating` (trả thẳng từ tiền chi tiêu, `account_id` null). */
  pays_from: GoalPaysFrom;
  /** Còn phải trả kỳ này = max(0, số kỳ này − đã trả) — chỉ mục tiêu `operating` đang dùng; còn lại null. */
  remaining: number | null;
  /** Danh mục tự tính là đã trả (mục tiêu `operating`, ADR-143); mục tiêu khác []. */
  category_ids: string[];
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
  /** Tài khoản con đang dùng của mẹ (khoản gửi kỳ hạn); `balance` = số dư gộp mẹ + con. */
  child_ids: string[];
  /** Tiền lãi của nhóm: không chia cho mục tiêu (số chia = `balance − interest`). */
  interest: number;
}

/**
 * Đã chi cho từng mục tiêu đang dùng từ `since` (pocket UC-1209 bước 11, 12): Σ chi / chuyển ra còn hiệu lực gắn mục tiêu, `at` ≥
 * đầu kỳ, − hoàn tiền (`link_id` tới các khoản đó) về lại nơi tiền ra trong cùng cửa sổ. Mục tiêu tài khoản: tiền ra từ tài
 * khoản mẹ hoặc con của nó và ra khỏi nhóm (chuyển nội bộ mẹ ↔ con không tính); mục tiêu trả từ tiền chi tiêu: tiền ra từ một
 * tài khoản ngăn Vận hành, cộng khoản chi từ Vận hành **không** gắn mục tiêu thuộc danh mục của nó (ADR-143) − hoàn tiền của
 * các khoản đó. Một câu, chạy trong batch của snapshot.
 */
export const goalSpentStatement = (db: D1Database, since: string) => {
  const OPERATING = "SELECT id FROM accounts WHERE pocket = 'operating'";
  const group = "SELECT id FROM accounts WHERE g.account_id IN (id, parent_account_id)";
  const from = (x: string) => `(CASE WHEN g.pays_from = 'operating' THEN ${x} IN (${OPERATING}) ELSE ${x} IN (${group}) END)`;
  const out = (t: string) =>
    `${t}.goal_id = g.id AND ${t}.status = 'active' AND ${t}.at >= ?1 AND ${from(`${t}.account_id`)}
     AND (g.pays_from = 'operating' OR ${t}.counter_account_id IS NULL OR ${t}.counter_account_id NOT IN (${group}))`;
  const byCategory = (t: string) =>
    `${t}.meaning = 'spend' AND ${t}.goal_id IS NULL AND ${t}.status = 'active' AND ${t}.at >= ?1 AND ${t}.account_id IN (${OPERATING})
     AND ${t}.category_id IN (SELECT category_id FROM reserve_goal_categories WHERE goal_id = g.id)`;
  const refunds = (match: string, to: string) =>
    `COALESCE((SELECT SUM(r.amount) FROM transactions r JOIN transactions s ON s.id = r.link_id
       WHERE r.meaning = 'refund' AND r.status = 'active' AND r.at >= ?1 AND ${to} AND ${match}), 0)`;
  return db
    .prepare(
      `SELECT g.id,
         COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE ${out("t")}), 0) - ${refunds(out("s"), from("r.counter_account_id"))}
         + CASE WHEN g.pays_from = 'operating' THEN
             COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE ${byCategory("t")}), 0) - ${refunds(byCategory("s"), `r.counter_account_id IN (${OPERATING})`)}
           ELSE 0 END AS spent
       FROM reserve_goals g WHERE g.active = 1 AND (g.account_id IS NOT NULL OR g.pays_from = 'operating')`,
    )
    .bind(since);
};

/** `id → đã chi` từ kết quả của `goalSpentStatement`. */
export const goalSpentMap = (r: D1Result) => new Map(rows<{ id: string; spent: number }>(r).map((g) => [g.id, Number(g.spent)]));

/**
 * Số kỳ này (theo `cycleKey`) và danh mục của các mục tiêu (ADR-143) — hai câu chạy trong batch của snapshot / `goalFill`;
 * `operatingExtrasFrom` gộp vào `PocketGoalInput`. `cycleKey` null = không đọc số kỳ này.
 */
export const operatingExtrasStatements = (db: D1Database, cycleKey: string | null): [D1PreparedStatement, D1PreparedStatement] => [
  db.prepare("SELECT goal_id AS id, amount, note FROM goal_cycle_amounts WHERE cycle_key = ?").bind(cycleKey),
  db.prepare("SELECT goal_id AS id, category_id AS categoryId FROM reserve_goal_categories ORDER BY category_id"),
];

/** `id → { cycleAmount, cycleNote, categoryIds }` từ kết quả của `operatingExtrasStatements`. */
export function operatingExtrasFrom(amounts: D1Result, categories: D1Result): (id: string) => Pick<PocketGoalInput, "cycleAmount" | "cycleNote" | "categoryIds"> {
  const cycle = new Map(rows<{ id: string; amount: number; note: string | null }>(amounts).map((a) => [a.id, a]));
  const cats = new Map<string, string[]>();
  for (const c of rows<{ id: string; categoryId: string }>(categories)) cats.set(c.id, [...(cats.get(c.id) ?? []), c.categoryId]);
  return (id) => {
    const c = cycle.get(id);
    return { cycleAmount: c ? Number(c.amount) : null, cycleNote: c?.note ?? null, categoryIds: cats.get(id) ?? [] };
  };
}

/**
 * Kỳ lương hiện tại: `start` = `started_at` của kỳ lưu, chưa có kỳ lưu thì ngày lương danh nghĩa gần nhất (`cycleRanges`);
 * `key` = khoá của số kỳ này (ADR-143): `pay_cycles.id` dạng chữ, chưa có kỳ lưu thì ngày lương danh nghĩa.
 */
export async function currentCycle(db: D1Database, now: Date): Promise<{ start: string; key: string }> {
  const range = (await loadCycles(db, now, dayKey(now))).ranges.at(-1)!;
  if (!range.stored) return { start: range.start, key: range.payday };
  const row = await db.prepare("SELECT id FROM pay_cycles WHERE status = 'active' AND payday = ?").bind(range.payday).first<{ id: number }>();
  return { start: range.start, key: String(row!.id) };
}

/** Mọi mục tiêu (kể cả đã tắt) đọc từ D1 kèm đã chi từ `since`, và kết quả chia số dư của các mục tiêu đang dùng. */
export interface GoalFill {
  rows: Row[];
  inputs: PocketGoalInput[];
  active: Set<string>;
  groups: GoalGroup[];
  filled: Map<string, FilledGoal>;
  /** Mục tiêu trả từ tiền chi tiêu đang dùng theo thứ tự ưu tiên (còn phải trả kỳ này). */
  operating: OperatingGoal[];
}

/**
 * Chia `số dư gộp − tiền lãi` của từng nhóm mẹ + con cho mục tiêu tài khoản đang dùng với đã chi từ `since` (pocket UC-1209
 * bước 9, 11, QĐ2) — một luật (`goalGroups`) cho `GET /v1/settings` và việc ② (A lúc mở kỳ, A trên thẻ việc); snapshot đi cùng
 * hàm đó qua `pocketsView`. Mục tiêu trả từ tiền chi tiêu: còn phải trả = max(0, số kỳ này (`cycleKey`) − đã trả).
 */
export async function goalFill(db: D1Database, since: string, cycleKey: string | null = null): Promise<GoalFill> {
  const [goalRows, accounts, spentRows, interestAccounts, interestTxs, amountRows, categoryRows] = await db.batch([
    db.prepare(GOAL_SQL),
    db.prepare("SELECT b.account_id AS id, b.name, b.book_balance AS balance, a.parent_account_id AS parentId FROM v_account_book b JOIN accounts a ON a.id = b.account_id"),
    goalSpentStatement(db, since),
    ...groupInterestStatements(db),
    ...operatingExtrasStatements(db, cycleKey),
  ]);
  const spent = goalSpentMap(spentRows!);
  const extras = operatingExtrasFrom(amountRows!, categoryRows!);
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
    paysFrom: r.pays_from === "operating" ? "operating" : "account",
    ...extras(String(r.id)),
  }));
  const active = new Set(all.filter((r) => r.active).map((r) => String(r.id)));
  const live = inputs.filter((g) => active.has(g.id)).sort(goalOrder);
  const { groups, filled } = goalGroups(
    rows<{ id: string; name: string; balance: number; parentId: string | null }>(accounts!).map((a) => ({ ...a, balance: Number(a.balance) })),
    live,
    groupInterestFrom(interestAccounts!, interestTxs!),
  );
  return { rows: all, inputs, active, groups, filled, operating: operatingGoals(live) };
}

/**
 * Mọi mục tiêu (kể cả đã tắt) theo thứ tự ưu tiên và nhóm theo tài khoản mẹ (`GET /v1/settings`, UC-505): mục tiêu tài khoản
 * đang dùng chia số dư gộp − tiền lãi bằng `goalGroups` với đã chi từ đầu kỳ — cùng luật, cùng mốc snapshot; mục tiêu trả từ
 * tiền chi tiêu có `spent`, `remaining`, không `held`.
 */
export async function listGoals(db: D1Database, now: Date): Promise<{ goals: GoalView[]; groups: GoalGroupView[] }> {
  const cycle = await currentCycle(db, now);
  const { rows: all, inputs, groups, filled, operating } = await goalFill(db, cycle.start, cycle.key);
  const order = new Map([...inputs].sort(goalOrder).map((g, i) => [g.id, i]));
  const operatingOf = new Map(operating.map((o) => [o.id, o]));
  const goals = all
    .map((r, i): GoalView => {
      const f = filled.get(String(r.id));
      const o = operatingOf.get(String(r.id));
      const g = inputs[i]!;
      const { balance: _, ...rest } = r;
      return {
        ...(rest as unknown as GoalView),
        held: f ? f.held : r.account_id === null || r.balance === null ? null : Number(r.balance),
        need: f ? goalNeed(g) : null,
        spent: f ? f.spent : o ? o.spent : 0,
        short: f ? f.short : null,
        sort: g.sort,
        active: Boolean(r.active),
        pays_from: g.paysFrom!,
        remaining: o ? o.remaining : null,
        category_ids: g.categoryIds ?? [],
      };
    })
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return {
    goals,
    groups: groups.map((g) => ({
      account_id: g.accountId,
      balance: g.balance,
      need: g.need,
      spent: g.spent,
      short: g.short,
      extra: g.extra,
      goal_ids: g.goalIds,
      child_ids: g.childIds,
      interest: g.interest,
    })),
  };
}

async function readGoal(db: D1Database, id: string, now: Date): Promise<GoalView> {
  return (await listGoals(db, now)).goals.find((g) => g.id === id) ?? fail("not_found", "Không có mục tiêu này.", 404);
}

const TAX_SHARED = "Thuế cần tài khoản riêng: thuế đã nộp đếm mọi khoản chi từ tài khoản này.";
const OPERATING_MONTHLY = "Trả thẳng từ tiền chi tiêu chỉ dùng cho khoản trả mỗi tháng (lặp mỗi tháng, có số mỗi tháng).";
/** Lý do ghi vào việc ② bị huỷ khi mục tiêu chuyển sang trả từ tiền chi tiêu (UC-1209, ADR-141). */
export const TO_OPERATING_REASON = "Mục tiêu chuyển sang trả từ tiền chi tiêu";

/**
 * Tài khoản gắn mục tiêu đang dùng (UC-1209 bước 2): có thật, đang dùng, ngăn Dự phòng (409 account_not_reserve); không phải
 * tài khoản con (409 goal_on_child — gắn tài khoản mẹ); không phải tài khoản Ví Thưởng (409 account_is_reward); nhiều mục tiêu
 * dùng chung được, trừ mục tiêu % (409 tax_account_shared).
 */
async function goalAccountOk(db: D1Database, accountId: string, selfId: string | null, selfPct: boolean): Promise<void> {
  const a = await db
    .prepare("SELECT a.name, a.active, a.pocket, p.name AS parent FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_account_id WHERE a.id = ?")
    .bind(accountId)
    .first<{ name: string; active: number; pocket: Pocket | null; parent: string | null }>();
  if (!a || !a.active || a.pocket !== "reserve") fail("account_not_reserve", "Tài khoản của mục tiêu phải đang dùng và thuộc ngăn Dự phòng.", 409, "account_id");
  if (a!.parent !== null) fail("goal_on_child", `Chọn ${a!.parent}: khoản gửi đã tính chung với ${a!.parent}.`, 409, "account_id");
  const reward = await db.prepare("SELECT 1 FROM config WHERE k = 'surplus_reward_account' AND v = ?").bind(accountId).first();
  if (reward) fail("account_is_reward", `${a!.name} là tài khoản Ví Thưởng: chọn tài khoản Dự phòng khác cho mục tiêu.`, 409, "account_id");
  await taxAccountOk(db, accountId, selfId, selfPct);
}

/** `pays_from` trong input: `account` | `operating`; không gửi → undefined. */
function paysFromOf(b: Input): GoalPaysFrom | undefined {
  if (!has(b, "pays_from")) return undefined;
  if (b.pays_from !== "account" && b.pays_from !== "operating") fail("invalid_input", "pays_from là account hoặc operating.", 400, "pays_from");
  return b.pays_from as GoalPaysFrom;
}

/**
 * Mục tiêu trả thẳng từ tiền chi tiêu (ADR-141): không theo % (409 tax_account_shared — Thuế cần tài khoản riêng), không gắn
 * tài khoản (gửi `account_id` khác null → 400 invalid_input), chỉ lặp mỗi tháng (400 operating_goal_monthly).
 */
function operatingOk(draft: GoalDraft, accountIdSent: string | null | undefined): void {
  if (draft.target_pct !== null) fail("tax_account_shared", TAX_SHARED, 409, "pays_from");
  if (accountIdSent) fail("invalid_input", "Mục tiêu trả thẳng từ tiền chi tiêu không gắn tài khoản: bỏ account_id.", 400, "account_id");
  if (draft.repeat_months !== 1 || draft.monthly_amount === null) fail("operating_goal_monthly", OPERATING_MONTHLY, 400, "repeat_months");
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

/** `category_ids` trong input: danh sách mã danh mục (bỏ trùng); không gửi → undefined. */
function categoryIdsOf(b: Input): string[] | undefined {
  if (!has(b, "category_ids")) return undefined;
  const v = b.category_ids;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x === "")) fail("invalid_input", "category_ids là danh sách mã danh mục.", 400, "category_ids");
  return [...new Set(v as string[])];
}

/**
 * Danh mục của khoản phải trả (UC-1209 bước 12, ADR-143): chỉ mục tiêu trả từ tiền chi tiêu (400 invalid_input); danh mục phải
 * có (400 unknown_category); mỗi danh mục thuộc tối đa một mục tiêu đang dùng khác (409 category_taken).
 */
async function categoriesOk(db: D1Database, ids: string[], selfId: string, operating: boolean): Promise<void> {
  if (ids.length === 0) return;
  if (!operating) fail("invalid_input", "Chỉ khoản trả thẳng từ tiền chi tiêu mới gắn danh mục.", 400, "category_ids");
  const marks = ids.map(() => "?").join(", ");
  const known = new Set(rows<{ id: string }>(await db.prepare(`SELECT id FROM categories WHERE id IN (${marks})`).bind(...ids).all()).map((c) => c.id));
  const missing = ids.find((id) => !known.has(id));
  if (missing) fail("unknown_category", `Không có danh mục "${missing}".`, 400, "category_ids");
  const taken = await db
    .prepare(
      `SELECT c.name AS category, g.name AS goal FROM reserve_goal_categories l JOIN categories c ON c.id = l.category_id JOIN reserve_goals g ON g.id = l.goal_id
       WHERE l.category_id IN (${marks}) AND g.active = 1 AND l.goal_id <> ? ORDER BY c.sort, c.name LIMIT 1`,
    )
    .bind(...ids, selfId)
    .first<{ category: string; goal: string }>();
  if (taken) fail("category_taken", `Danh mục ${taken.category} đã thuộc khoản ${taken.goal}.`, 409, "category_ids");
}

/** Đặt lại danh mục của mục tiêu (cùng batch với câu ghi mục tiêu); danh mục còn gắn mục tiêu đã tắt thì chuyển sang mục tiêu này. */
function categoryWrites(db: D1Database, goalId: string, ids: string[]): D1PreparedStatement[] {
  const clear = db.prepare("DELETE FROM reserve_goal_categories WHERE goal_id = ?").bind(goalId);
  if (ids.length === 0) return [clear];
  const marks = ids.map(() => "?").join(", ");
  return [
    clear,
    db.prepare(`DELETE FROM reserve_goal_categories WHERE category_id IN (${marks})`).bind(...ids),
    db.prepare(`INSERT INTO reserve_goal_categories (category_id, goal_id) VALUES ${ids.map(() => "(?, ?)").join(", ")}`).bind(...ids.flatMap((c) => [c, goalId])),
  ];
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
    // Trigger 0044: máy khác vừa biến tài khoản này thành tài khoản con / đổi mục tiêu.
    if (/goal_on_child/.test(msg)) fail("goal_on_child", "Chọn tài khoản mẹ: khoản gửi đã tính chung với tài khoản mẹ.", 409, "account_id");
    if (/operating_goal_monthly/.test(msg)) fail("operating_goal_monthly", OPERATING_MONTHLY, 400, "pays_from");
    if (/idx_reserve_goals_debt|reserve_goals\.debt_id/.test(msg)) fail("debt_has_goal", "Khoản nợ này đã có mục tiêu đang dùng.", 409, "debt_id");
    // Máy khác vừa gắn cùng danh mục cho khoản khác (khoá chính `reserve_goal_categories.category_id`).
    if (/reserve_goal_categories/.test(msg)) fail("category_taken", "Danh mục này vừa thuộc khoản khác.", 409, "category_ids");
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
 * `POST /v1/settings/goals` (UC-1209): mã = slug của tên, trùng → 409 duplicate; `account_id` không gửi = chưa gắn;
 * `pays_from: "operating"` = trả thẳng từ tiền chi tiêu (`operatingOk`). Không gửi `sort` → chen trước mục tiêu đang dùng đầu
 * tiên có hạn muộn hơn hoặc không có hạn (không hạn → cuối), rồi đánh số lại mọi mục tiêu đang dùng 10, 20, … trong cùng batch
 * (bước 10, QĐ5-A).
 */
export async function createGoal(db: D1Database, b: Input, now: Date): Promise<GoalView> {
  const { name, id } = nameOf(b);
  if (await db.prepare("SELECT 1 FROM reserve_goals WHERE id = ?").bind(id).first()) fail("duplicate", "Đã có mục tiêu với tên này.", 409, "name");
  const n = goalInput(b);
  const paysFrom = paysFromOf(b) ?? "account";
  const draft = checkGoal({
    target_amount: n.target_amount ?? null,
    target_pct: n.target_pct ?? null,
    monthly_amount: n.monthly_amount ?? null,
    repeat_months: n.repeat_months ?? null,
    due_date: n.due_date ?? null,
    debt_id: n.debt_id ?? null,
  });
  const accountId = strOrNull(b, "account_id") ?? null;
  if (paysFrom === "operating") operatingOk(draft, accountId);
  else if (accountId) await goalAccountOk(db, accountId, null, draft.target_pct !== null);
  if (draft.debt_id) await debtOk(db, draft.debt_id, null);
  const categories = categoryIdsOf(b) ?? [];
  await categoriesOk(db, categories, id, paysFrom === "operating");
  const links = categories.length ? categoryWrites(db, id, categories) : [];
  const sort = intOrNull(b, "sort");
  const insert = db
    .prepare(
      `INSERT INTO reserve_goals (id, name, account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date, debt_id, sort, pays_from)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, name, accountId, draft.target_amount, draft.target_pct, draft.monthly_amount, draft.repeat_months, draft.due_date, draft.debt_id, sort ?? 0, paysFrom);
  if (sort !== undefined && sort !== null) {
    await goalWrite(() => db.batch([insert, ...links]));
  } else {
    const order = await activeOrder(db);
    const due = draft.due_date;
    const later = due === null ? -1 : order.findIndex((g) => g.dueDate === null || g.dueDate > due);
    const at = later === -1 ? order.length : later;
    const ids = [...order.slice(0, at).map((g) => g.id), id, ...order.slice(at).map((g) => g.id)];
    await goalWrite(() => db.batch([insert, ...links, ...renumber(db, ids)]));
  }
  return readGoal(db, id, now);
}

/**
 * `PATCH /v1/settings/goals/:id` (UC-1209 bước 2–3): gắn / đổi / bỏ gắn tài khoản (`account_id`), tắt / bật lại (`active`; tắt
 * lúc nào cũng được — tiền vẫn ở tài khoản), đổi nơi để tiền (`pays_from`). Đổi số mỗi tháng / số tháng mà không gửi số cần
 * thì B tính lại. Đổi hạn không đổi thứ tự. Đổi sang `operating`: tự đặt `account_id = NULL` và huỷ các việc ② còn mở của mục
 * tiêu trong kỳ hiện tại (lý do `TO_OPERATING_REASON`) cùng batch — trả `voided` cho nhật ký `pay_cycle_task.void`. `category_ids`
 * (chỉ mục tiêu `operating`) đặt lại danh mục của khoản; đổi sang `account` thì bỏ hết danh mục. Trả `changes` có `account_id` /
 * `pays_from: { from, to }` khi đổi.
 */
export async function updateGoal(
  db: D1Database,
  id: string,
  b: Input,
  now: Date,
): Promise<{ goal: GoalView; changes: Record<string, { from: unknown; to: unknown }>; voided: { id: number; reason: string }[] }> {
  const current = await readGoal(db, id, now);
  const name = has(b, "name") ? nameOf(b).name : undefined;
  const n = goalInput(b);
  const paysFrom = paysFromOf(b) ?? current.pays_from;
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
  const operating = paysFrom === "operating";
  if (operating) operatingOk(draft, has(b, "account_id") ? strOrNull(b, "account_id") : undefined);
  const accountId = operating ? null : has(b, "account_id") ? (strOrNull(b, "account_id") ?? null) : current.account_id;
  const active = boolOf(b, "active") ?? current.active;
  const pct = draft.target_pct !== null;
  if (active && accountId && (accountId !== current.account_id || !current.active)) await goalAccountOk(db, accountId, id, pct);
  else if (active && accountId && pct && current.target_pct === null) await taxAccountOk(db, accountId, id, pct);
  if (draft.debt_id && active && (draft.debt_id !== current.debt_id || !current.active)) await debtOk(db, draft.debt_id, id);
  const categories = categoryIdsOf(b);
  if (categories) await categoriesOk(db, categories, id, operating);
  const links = operating ? (categories ? categoryWrites(db, id, categories) : []) : current.category_ids.length ? categoryWrites(db, id, []) : [];
  const sort = intOrNull(b, "sort");
  // ② còn mở (chưa nhận đủ) của mục tiêu trong kỳ hiện tại — tiền giờ nằm ở Vận hành, không phải chuyển nữa.
  const voidIds =
    operating && current.pays_from !== "operating"
      ? rows<{ id: number }>(
          await db
            .prepare(
              `SELECT k.id FROM pay_cycle_tasks k
               WHERE k.kind = 'goal' AND k.goal_id = ? AND k.status = 'open'
                 AND k.cycle_id = (SELECT id FROM pay_cycles WHERE status = 'active' ORDER BY payday DESC LIMIT 1)
                 AND k.amount > COALESCE((SELECT SUM(x.amount) FROM pay_cycle_task_tx x JOIN transactions t ON t.id = x.tx_id AND t.status = 'active' WHERE x.task_id = k.id), 0)
               ORDER BY k.id`,
            )
            .bind(id)
            .all(),
        ).map((t) => Number(t.id))
      : [];
  const update = db
    .prepare(
      `UPDATE reserve_goals SET name = ?, account_id = ?, target_amount = ?, target_pct = ?, monthly_amount = ?, repeat_months = ?,
         due_date = ?, debt_id = ?, sort = ?, active = ?, pays_from = ? WHERE id = ?`,
    )
    .bind(
      name ?? current.name, accountId, draft.target_amount, draft.target_pct, draft.monthly_amount, draft.repeat_months,
      draft.due_date, draft.debt_id, sort ?? current.sort, active ? 1 : 0, paysFrom, id,
    );
  const voids = voidIds.length
    ? [db.prepare(`UPDATE pay_cycle_tasks SET status = 'void', reason = ? WHERE status = 'open' AND id IN (${voidIds.map(() => "?").join(", ")})`).bind(TO_OPERATING_REASON, ...voidIds)]
    : [];
  await goalWrite(() => db.batch([update, ...voids, ...links]));
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (accountId !== current.account_id) changes.account_id = { from: current.account_id, to: accountId };
  if (paysFrom !== current.pays_from) changes.pays_from = { from: current.pays_from, to: paysFrom };
  return { goal: await readGoal(db, id, now), changes, voided: voidIds.map((v) => ({ id: v, reason: TO_OPERATING_REASON })) };
}

/**
 * `PUT /v1/pay-cycle/goal-amounts/:goalId` (pocket UC-1209 bước 12, ADR-143): số riêng cho kỳ lương hiện tại của khoản trả thẳng
 * từ tiền chi tiêu — `amount` 0…MONEY_MAX (0 = kỳ này không trả), `null` = bỏ số riêng (về số mỗi tháng); `note` ≤ 80 ký tự.
 * Không có mục tiêu → 404; không phải mục tiêu `operating` đang dùng → 409 not_operating_goal. Trả mục tiêu sau khi đặt và
 * `cycle`, `amount { from, to }` (số kỳ này trước / sau) cho nhật ký `goal.cycle_amount`.
 */
export async function setGoalCycleAmount(
  db: D1Database,
  goalId: string,
  b: Input,
  now: Date,
): Promise<{ goal: OperatingGoal; cycle: string; amount: { from: number; to: number } }> {
  const goal = await db.prepare("SELECT active, pays_from AS paysFrom, monthly_amount AS monthly FROM reserve_goals WHERE id = ?").bind(goalId).first<{ active: number; paysFrom: string; monthly: number | null }>();
  if (!goal) fail("not_found", "Không có mục tiêu này.", 404);
  if (!goal!.active || goal!.paysFrom !== "operating" || goal!.monthly === null) fail("not_operating_goal", "Chỉ khoản trả thẳng từ tiền chi tiêu đang dùng mới đặt số kỳ này.", 409, "amount");
  if (!has(b, "amount")) fail("invalid_input", "Thiếu amount.", 400, "amount");
  const amount = intOrNull(b, "amount") as number | null;
  if (amount !== null && (amount < 0 || amount > MONEY_MAX)) fail("invalid_input", "Số kỳ này từ 0 đến 1.000.000.000.000.", 400, "amount");
  const note = amount === null ? null : (strOrNull(b, "note") ?? null);
  if (note !== null && note.length > 80) fail("invalid_input", "Lý do tối đa 80 ký tự.", 400, "note");
  const cycle = await currentCycle(db, now);
  const before = await db.prepare("SELECT amount FROM goal_cycle_amounts WHERE goal_id = ? AND cycle_key = ?").bind(goalId, cycle.key).first<{ amount: number }>();
  await (amount === null
    ? db.prepare("DELETE FROM goal_cycle_amounts WHERE goal_id = ? AND cycle_key = ?").bind(goalId, cycle.key)
    : db
        .prepare(
          `INSERT INTO goal_cycle_amounts (goal_id, cycle_key, amount, note) VALUES (?, ?, ?, ?)
           ON CONFLICT (goal_id, cycle_key) DO UPDATE SET amount = excluded.amount, note = excluded.note, updated_at = datetime('now')`,
        )
        .bind(goalId, cycle.key, amount, note)
  ).run();
  const after = (await goalFill(db, cycle.start, cycle.key)).operating.find((o) => o.id === goalId)!;
  return { goal: after, cycle: cycle.key, amount: { from: before ? Number(before.amount) : goal!.monthly!, to: amount ?? goal!.monthly! } };
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
