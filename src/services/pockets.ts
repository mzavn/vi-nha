// Ba ngăn (pocket UC-1201, UC-1204, UC-1209, ADR-119, ADR-132): xác nhận ngăn của tài khoản, mục tiêu Dự phòng (mỗi mục
// tiêu gắn một tài khoản thật ngăn Dự phòng, nhiều mục tiêu dùng chung được một tài khoản — A chia từ số dư theo thứ tự ưu
// tiên, `fillGoals`), nhóm danh mục. Cấu hình, không phải sổ cái: không ghi transactions. "Tài khoản của mục tiêu đang dùng
// phải đang dùng, ở ngăn Dự phòng, không rời ngăn / không tắt", "mục tiêu % giữ tài khoản riêng" giữ bằng trigger (migration
// 0038, 0042); đọc trước chỉ để báo lỗi rõ ràng.

import { monthStart } from "../domain/month-tasks";
import { monthKey } from "../domain/period";
import {
  checkGoal,
  goalClosedInPeriod,
  goalClosedSql,
  goalGroups,
  goalOrder,
  goalNeed,
  MONEY_MAX,
  operatingGoals,
  type FilledGoal,
  type GoalDraft,
  type GoalGroup,
  type GoalPaysFrom,
  type GoalRefundView,
  type OperatingGoal,
  type Pocket,
  type PocketGoalInput,
} from "../domain/pockets";
import { DomainError } from "../domain/types";
import { groupInterestFrom, groupInterestStatements } from "./goal-groups";
import { hiddenAccountIds, hiddenTxSql } from "./privacy";
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
/** Mục tiêu lặp N tháng (N > 1) bí danh `g`: id đợt đang mở (`goal_periods`); NULL = đợt đầu chưa có dòng / mục tiêu khác. */
export const openPeriodSql = (g: string) =>
  `(CASE WHEN ${g}.repeat_months > 1 THEN (SELECT p.id FROM goal_periods p WHERE p.goal_id = ${g}.id AND p.closed_at IS NULL ORDER BY p.id DESC LIMIT 1) END)`;
const GOAL_SQL = `SELECT g.id, g.name, g.account_id, g.suggested_account_id,
  (SELECT b.book_balance FROM v_account_book b WHERE b.account_id = g.account_id) AS balance,
  g.target_amount, g.target_pct, g.monthly_amount, g.repeat_months, g.due_date, g.debt_id, g.sort, g.active, g.pays_from, g.closed_at,
  ${openPeriodSql("g")} AS period_id FROM reserve_goals g`;

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
  /** Đã chi cho mục tiêu trong cửa sổ của nó (UC-1209 bước 11, AC-24), gồm số các việc chuyển về kiểu B. */
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
  /** Còn phải trả tháng này = max(0, số tháng này − đã trả) — chỉ mục tiêu `operating` đang dùng; còn lại null. */
  remaining: number | null;
  /** Danh mục tự tính là đã trả (mục tiêu `operating`, ADR-143); mục tiêu khác []. */
  category_ids: string[];
  /** Đã chốt xong trong kỳ hiện tại (UC-1209 AC-25); `closed_at` = lúc chốt khi `closed`, còn lại null. */
  closed: boolean;
  closed_at: string | null;
  leftover: number;
  over: number;
  suggest_close: boolean;
  short_because: { goal_id: string; amount: number }[];
  advance: number;
  advance_from: string[];
  pending_refund: number;
  /** Mục tiêu lặp N tháng: id đợt đang mở (gửi kèm chốt / mở lại); null với đợt đầu chưa có dòng / mục tiêu khác. */
  period_id: number | null;
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
  pending: number;
  free: number;
  unmatched: number;
}

/** 00:00 VN của ngày VN chứa thời điểm SQL `col` (ISO hoặc "YYYY-MM-DD HH:MM:SS" UTC), viết ISO như cột `transactions.at`. */
const vnDayStartSql = (col: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', date(${col}, '+7 hours'), '-7 hours')`;

/**
 * Cửa sổ "đã chi" của từng mục tiêu (pocket UC-1209 AC-24, ngày VN) — câu SELECT dùng làm CTE `w(id, since, until, closed)`:
 * hằng tháng / trả từ tiền chi tiêu / theo % → từ 00:00 VN ngày 1 tháng này; lặp N tháng (N > 1) → từ đầu đợt đang mở
 * (`goal_periods`; chưa có đợt nào → ngày tạo mục tiêu), khép khi người chốt; một lần → từ ngày tạo tới lúc chốt (`until`).
 * `closed` = `goalClosedSql` theo tháng VN của `now`. Giá trị ghép sẵn từ `now` (không tham số) để câu nào cũng nhúng được.
 */
export function goalWindowSql(now: Date): string {
  const month = monthKey(now);
  return `SELECT g.id,
    CASE WHEN g.pays_from = 'operating' OR g.target_pct IS NOT NULL OR g.repeat_months = 1 THEN '${monthStart(month)}'
         WHEN g.repeat_months > 1 THEN COALESCE((SELECT p.started_at FROM goal_periods p WHERE p.goal_id = g.id AND p.closed_at IS NULL ORDER BY p.id DESC LIMIT 1), ${vnDayStartSql("g.created_at")})
         ELSE ${vnDayStartSql("g.created_at")} END AS since,
    CASE WHEN g.repeat_months IS NULL AND g.target_pct IS NULL AND g.pays_from = 'account' THEN g.closed_at END AS until,
    ${goalClosedSql("g", `'${month}'`)} AS closed
  FROM reserve_goals g`;
}

/** Khoản bí danh `t` nằm trong cửa sổ `w` của mục tiêu. */
export const inWindowSql = (t: string) => `${t}.at >= w.since AND (w.until IS NULL OR ${t}.at < w.until)`;
/** Tài khoản thuộc nhóm (mẹ + con) của mục tiêu bí danh `g`. */
export const goalGroupSql = (g: string) => `SELECT id FROM accounts WHERE ${g}.account_id IN (id, parent_account_id)`;
/** Khoản chi bí danh `s` từ tài khoản ngoài nhóm đã khớp vào mục tiêu tài khoản bí danh `g` (kiểu B, UC-1209 AC-28). */
export const advanceSql = (s: string, g: string) =>
  `${s}.meaning = 'spend' AND ${s}.status = 'active' AND ${s}.goal_id = ${g}.id AND ${g}.pays_from = 'account' AND ${g}.account_id IS NOT NULL
   AND ${s}.account_id NOT IN (${goalGroupSql(g)})`;
/** Phần của chuyển khoản bí danh `t` đã ghép vào việc chuyển về chưa huỷ (AC-29): không tính vào đã chi. */
export const refundLinkedOfTxSql = (t: string) =>
  `COALESCE((SELECT SUM(x.amount) FROM goal_refund_tx x JOIN goal_refunds f ON f.id = x.refund_id AND f.status <> 'void' WHERE x.tx_id = ${t}.id), 0)`;
/** Σ hoàn tiền còn hiệu lực trỏ về khoản chi bí danh `s` (`link_id`). */
export const returnedSql = (s: string) =>
  `COALESCE((SELECT SUM(r.amount) FROM transactions r WHERE r.link_id = ${s}.id AND r.meaning = 'refund' AND r.status = 'active'), 0)`;

/**
 * Đã chi cho từng mục tiêu đang dùng trong cửa sổ của nó (pocket UC-1209 bước 11, 12, AC-24, AC-28, AC-29): Σ chi / chuyển ra còn
 * hiệu lực gắn mục tiêu trong cửa sổ (trừ phần chuyển khoản đã ghép vào việc chuyển về), − hoàn tiền (`link_id` tới các khoản đó)
 * về lại nơi tiền ra trong cửa sổ, + số các việc chuyển về chưa huỷ có khoản chi trong cửa sổ. Mục tiêu tài khoản: tiền ra từ tài
 * khoản mẹ hoặc con của nó và ra khỏi nhóm (chuyển nội bộ mẹ ↔ con không tính); mục tiêu trả từ tiền chi tiêu: tiền ra từ một
 * tài khoản ngăn Vận hành, cộng khoản chi từ Vận hành **không** gắn mục tiêu thuộc danh mục của nó (ADR-143) − hoàn tiền của
 * các khoản đó. Một câu, chạy trong batch của snapshot.
 */
export const goalSpentStatement = (db: D1Database, now: Date) => {
  const OPERATING = "SELECT id FROM accounts WHERE pocket = 'operating'";
  const group = goalGroupSql("g");
  const from = (x: string) => `(CASE WHEN g.pays_from = 'operating' THEN ${x} IN (${OPERATING}) ELSE ${x} IN (${group}) END)`;
  const out = (t: string) =>
    `${t}.goal_id = g.id AND ${t}.status = 'active' AND ${inWindowSql(t)} AND ${from(`${t}.account_id`)}
     AND (g.pays_from = 'operating' OR ${t}.counter_account_id IS NULL OR ${t}.counter_account_id NOT IN (${group}))`;
  const byCategory = (t: string) =>
    `${t}.meaning = 'spend' AND ${t}.goal_id IS NULL AND ${t}.status = 'active' AND ${inWindowSql(t)} AND ${t}.account_id IN (${OPERATING})
     AND ${t}.category_id IN (SELECT category_id FROM reserve_goal_categories WHERE goal_id = g.id)`;
  const refunds = (match: string, to: string) =>
    `COALESCE((SELECT SUM(r.amount) FROM transactions r JOIN transactions s ON s.id = r.link_id
       WHERE r.meaning = 'refund' AND r.status = 'active' AND ${inWindowSql("r")} AND ${to} AND ${match}), 0)`;
  return db.prepare(
    `WITH w AS (${goalWindowSql(now)})
     SELECT g.id,
       COALESCE((SELECT SUM(t.amount - ${refundLinkedOfTxSql("t")}) FROM transactions t WHERE ${out("t")}), 0) - ${refunds(out("s"), from("r.counter_account_id"))}
       + COALESCE((SELECT SUM(f.amount) FROM goal_refunds f JOIN transactions s ON s.id = f.spend_tx_id WHERE f.goal_id = g.id AND f.status <> 'void' AND ${inWindowSql("s")}), 0)
       + CASE WHEN g.pays_from = 'operating' THEN
           COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE ${byCategory("t")}), 0) - ${refunds(byCategory("s"), `r.counter_account_id IN (${OPERATING})`)}
         ELSE 0 END AS spent
     FROM reserve_goals g JOIN w ON w.id = g.id WHERE g.active = 1 AND (g.account_id IS NOT NULL OR g.pays_from = 'operating')`,
  );
};

/** `id → đã chi` từ kết quả của `goalSpentStatement`. */
export const goalSpentMap = (r: D1Result) => new Map(rows<{ id: string; spent: number }>(r).map((g) => [g.id, Number(g.spent)]));

/**
 * Số tháng này (theo `monthKey`, bảng `goal_month_amounts`) và danh mục của các mục tiêu (ADR-143, ADR-144) — hai câu chạy
 * trong batch của snapshot / `goalFill`; `operatingExtrasFrom` gộp vào `PocketGoalInput`. `monthKey` null = không đọc số tháng này.
 */
export const operatingExtrasStatements = (db: D1Database, monthKey: string | null): [D1PreparedStatement, D1PreparedStatement] => [
  db.prepare("SELECT goal_id AS id, amount, note FROM goal_month_amounts WHERE month_key = ?").bind(monthKey),
  db.prepare("SELECT goal_id AS id, category_id AS categoryId FROM reserve_goal_categories ORDER BY category_id"),
];

/** `id → { monthAmount, monthNote, categoryIds }` từ kết quả của `operatingExtrasStatements`. */
export function operatingExtrasFrom(amounts: D1Result, categories: D1Result): (id: string) => Pick<PocketGoalInput, "monthAmount" | "monthNote" | "categoryIds"> {
  const month = new Map(rows<{ id: string; amount: number; note: string | null }>(amounts).map((a) => [a.id, a]));
  const cats = new Map<string, string[]>();
  for (const c of rows<{ id: string; categoryId: string }>(categories)) cats.set(c.id, [...(cats.get(c.id) ?? []), c.categoryId]);
  return (id) => {
    const m = month.get(id);
    return { monthAmount: m ? Number(m.amount) : null, monthNote: m?.note ?? null, categoryIds: cats.get(id) ?? [] };
  };
}

/** Tháng VN hiện tại (ADR-144): `start` = 00:00 VN ngày 1 (ISO), `key` = "YYYY-MM" — cửa sổ đã chi và khoá của số tháng này. */
export function currentMonth(now: Date): { start: string; key: string } {
  const key = monthKey(now);
  return { start: monthStart(key), key };
}

/** Σ chuyển khoản còn hiệu lực đã ghép vào việc chuyển về bí danh `f` (UC-1209 AC-29). */
export const refundLinkedSql = (f: string) =>
  `COALESCE((SELECT SUM(x.amount) FROM goal_refund_tx x JOIN transactions t ON t.id = x.tx_id AND t.status = 'active' WHERE x.refund_id = ${f}), 0)`;

/** Một dòng `goal_refunds` kèm số đã ghép (`refundLinkedSql`) và cờ khoản chi nằm trong cửa sổ của mục tiêu. */
export interface RefundRow {
  id: number;
  goalId: string;
  goalName: string;
  spendTxId: number;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  status: "open" | "done" | "skipped" | "void";
  reason: string | null;
  code: string;
  createdAt: string;
  linked: number;
  inWindow: number;
}
/** Câu đọc việc chuyển về (cần CTE `w` của `goalWindowSql`), thêm điều kiện sau `WHERE`. */
export const refundRowsSql = (now: Date, where: string) =>
  `WITH w AS (${goalWindowSql(now)})
   SELECT f.id, f.goal_id AS goalId, g.name AS goalName, f.spend_tx_id AS spendTxId, f.from_account_id AS fromAccountId, f.to_account_id AS toAccountId,
          f.amount, f.status, f.reason, f.code, f.created_at AS createdAt, ${refundLinkedSql("f.id")} AS linked, (${inWindowSql("s")}) AS inWindow
   FROM goal_refunds f JOIN reserve_goals g ON g.id = f.goal_id JOIN w ON w.id = g.id JOIN transactions s ON s.id = f.spend_tx_id
   WHERE ${where} ORDER BY f.id`;

export type QrAccount = { id: string; name: string; bank: string | null; accountNo: string | null; subAccount: string | null };
export const QR_ACCOUNTS_SQL = "SELECT id, name, bank, account_no AS accountNo, sub_account AS subAccount FROM accounts";

/**
 * Việc chuyển về như `reserve.refunds[]` (UC-1209 AC-28, AC-29, UC-702 AC-45): đang mở mà đã ghép đủ → xong (tự); nội dung QR "CV
 * {mã} T{tháng VN của lúc tạo}"; QR tới tài khoản đã trả khi có số tài khoản; một đầu là tài khoản riêng tư bị giấu → `hidden`, không QR.
 */
export function refundView(r: RefundRow, accounts: QrAccount[], hidden: string[]): GoalRefundView {
  const amount = Number(r.amount);
  const linked = Number(r.linked);
  const status = r.status === "open" && linked >= amount ? "done" : (r.status as GoalRefundView["status"]);
  const isHidden = hidden.includes(r.fromAccountId) || hidden.includes(r.toAccountId);
  const to = accounts.find((a) => a.id === r.toAccountId);
  return {
    id: Number(r.id),
    goalId: r.goalId,
    goalName: r.goalName,
    spendTxId: Number(r.spendTxId),
    fromAccountId: r.fromAccountId,
    toAccountId: r.toAccountId,
    amount,
    linked,
    missing: status === "open" ? amount - linked : 0,
    status,
    reason: r.reason,
    code: r.code,
    memo: `CV ${r.code} T${Number(monthKey(r.createdAt).slice(5, 7))}`,
    qr: !isHidden && to?.accountNo ? { accountId: to.id, name: to.name, bank: to.bank, accountNo: to.accountNo, subAccount: to.subAccount } : null,
    hidden: isHidden,
    createdAt: r.createdAt,
  };
}

/** Phần khớp chi của từng mục tiêu, việc chuyển về để hiện và `unmatched` theo tài khoản mẹ — cho snapshot và `GET /v1/settings`. */
export interface GoalMatchState {
  extras: (id: string) => Pick<PocketGoalInput, "pendingRefund" | "advance" | "advanceFrom">;
  refunds: GoalRefundView[];
  unmatched: Record<string, number>;
}

/**
 * Đọc khoản chi kiểu B trong cửa sổ (`advance`, `advanceFrom`), việc chuyển về chưa huỷ (`pendingRefund` = Σ phần còn thiếu của việc
 * đang mở; hiện việc đang mở hoặc có khoản chi trong cửa sổ) và `unmatched` (UC-1209 AC-27, AC-28; UC-702 AC-45): nhóm có từ hai mục
 * tiêu chưa chốt → số khoản chi / chuyển ra khỏi nhóm, còn hiệu lực, chưa gắn mục tiêu, không rút từ lãi, từ đầu cửa sổ sớm nhất của
 * các mục tiêu chưa chốt, không bị giấu với người xem.
 */
export async function goalMatchState(db: D1Database, now: Date, viewerId: string | null): Promise<GoalMatchState> {
  const hidden = await hiddenAccountIds(db, viewerId);
  const hiddenTx = hiddenTxSql("t", hidden);
  const [advanceRes, refundRes, unmatchedRes, accountRes] = await db.batch([
    db.prepare(
      `WITH w AS (${goalWindowSql(now)})
       SELECT s.goal_id AS goalId, s.amount - ${returnedSql("s")} AS net, a.name AS accountName
       FROM transactions s JOIN reserve_goals g ON g.id = s.goal_id JOIN w ON w.id = g.id JOIN accounts a ON a.id = s.account_id
       WHERE ${advanceSql("s", "g")} AND ${inWindowSql("s")} ORDER BY s.at, s.id`,
    ),
    db.prepare(refundRowsSql(now, "f.status <> 'void'")),
    db
      .prepare(
        `WITH w AS (${goalWindowSql(now)}),
         roots AS (SELECT g.account_id AS root, MIN(w.since) AS since FROM reserve_goals g JOIN w ON w.id = g.id
           WHERE g.active = 1 AND g.pays_from = 'account' AND g.account_id IS NOT NULL AND NOT w.closed GROUP BY g.account_id HAVING COUNT(*) >= 2)
         SELECT roots.root, (SELECT COUNT(*) FROM transactions t JOIN accounts a ON a.id = t.account_id
           WHERE COALESCE(a.parent_account_id, a.id) = roots.root AND t.status = 'active' AND t.meaning IN ('spend', 'transfer') AND t.goal_id IS NULL
             AND t.from_interest = 0 AND t.at >= roots.since
             AND (t.counter_account_id IS NULL OR t.counter_account_id NOT IN (SELECT id FROM accounts WHERE roots.root IN (id, parent_account_id)))
             AND NOT ${hiddenTx.sql}) AS n
         FROM roots`,
      )
      .bind(...hiddenTx.binds),
    db.prepare(QR_ACCOUNTS_SQL),
  ]);
  const accounts = rows<QrAccount>(accountRes!);
  const all = rows<RefundRow>(refundRes!).map((r) => refundView(r, accounts, hidden));
  const inWindow = new Set(rows<RefundRow>(refundRes!).filter((r) => Number(r.inWindow) === 1).map((r) => Number(r.id)));
  const advance = new Map<string, { amount: number; from: string[] }>();
  for (const a of rows<{ goalId: string; net: number; accountName: string }>(advanceRes!)) {
    const cur = advance.get(a.goalId) ?? { amount: 0, from: [] };
    cur.amount += Number(a.net);
    if (!cur.from.includes(a.accountName)) cur.from.push(a.accountName);
    advance.set(a.goalId, cur);
  }
  return {
    extras: (id) => ({
      pendingRefund: all.filter((r) => r.goalId === id && r.status === "open").reduce((s, r) => s + r.missing, 0),
      advance: advance.get(id)?.amount ?? 0,
      advanceFrom: advance.get(id)?.from ?? [],
    }),
    refunds: all.filter((r) => r.status === "open" || inWindow.has(r.id)),
    unmatched: Object.fromEntries(rows<{ root: string; n: number }>(unmatchedRes!).map((u) => [u.root, Number(u.n)])),
  };
}

/** Mọi mục tiêu (kể cả đã tắt) đọc từ D1 kèm đã chi trong cửa sổ, và kết quả chia số dư của các mục tiêu đang dùng. */
export interface GoalFill {
  rows: Row[];
  inputs: PocketGoalInput[];
  active: Set<string>;
  groups: GoalGroup[];
  filled: Map<string, FilledGoal>;
  /** Mục tiêu trả từ tiền chi tiêu đang dùng theo thứ tự ưu tiên (còn phải trả tháng này). */
  operating: OperatingGoal[];
  refunds: GoalRefundView[];
}

/**
 * Chia `số dư gộp − tiền lãi − pending` của từng nhóm mẹ + con cho mục tiêu tài khoản đang dùng với đã chi trong cửa sổ (pocket
 * UC-1209 bước 9, 11, QĐ2, AC-24, AC-25, AC-28) — một luật (`goalGroups`) cho `GET /v1/settings`; snapshot đi cùng hàm đó qua
 * `pocketsView`. Mục tiêu trả từ tiền chi tiêu: còn phải trả = max(0, số tháng này − đã trả).
 */
export async function goalFill(db: D1Database, now: Date, viewerId: string | null = null): Promise<GoalFill> {
  const [state, [goalRows, accounts, spentRows, interestAccounts, interestTxs, amountRows, categoryRows]] = await Promise.all([
    goalMatchState(db, now, viewerId),
    db.batch([
      db.prepare(GOAL_SQL),
      db.prepare("SELECT b.account_id AS id, b.name, b.book_balance AS balance, a.parent_account_id AS parentId FROM v_account_book b JOIN accounts a ON a.id = b.account_id"),
      goalSpentStatement(db, now),
      ...groupInterestStatements(db),
      ...operatingExtrasStatements(db, monthKey(now)),
    ]),
  ]);
  const spent = goalSpentMap(spentRows!);
  const extras = operatingExtrasFrom(amountRows!, categoryRows!);
  const all = rows(goalRows!);
  const inputs: PocketGoalInput[] = all.map((r) => {
    const repeatMonths = r.repeat_months === null ? null : Number(r.repeat_months);
    const closed = goalClosedInPeriod({ repeatMonths, closedAt: (r.closed_at as string | null) ?? null }, now);
    return {
      id: String(r.id),
      name: String(r.name),
      accountId: (r.account_id as string | null) ?? null,
      target: r.target_amount === null ? null : Number(r.target_amount),
      targetPct: r.target_pct === null ? null : Number(r.target_pct),
      monthly: r.monthly_amount === null ? null : Number(r.monthly_amount),
      repeatMonths,
      dueDate: (r.due_date as string | null) ?? null,
      debtId: (r.debt_id as string | null) ?? null,
      sort: Number(r.sort),
      spent: spent.get(String(r.id)) ?? 0,
      paysFrom: r.pays_from === "operating" ? "operating" : "account",
      closed,
      closedAt: closed ? String(r.closed_at) : null,
      periodId: r.period_id === null ? null : Number(r.period_id),
      ...extras(String(r.id)),
      ...state.extras(String(r.id)),
    };
  });
  const active = new Set(all.filter((r) => r.active).map((r) => String(r.id)));
  const live = inputs.filter((g) => active.has(g.id)).sort(goalOrder);
  const { groups, filled } = goalGroups(
    rows<{ id: string; name: string; balance: number; parentId: string | null }>(accounts!).map((a) => ({ ...a, balance: Number(a.balance) })),
    live,
    groupInterestFrom(interestAccounts!, interestTxs!),
    state.unmatched,
  );
  return { rows: all, inputs, active, groups, filled, operating: operatingGoals(live), refunds: state.refunds };
}

/** Việc chuyển về như `GET /v1/settings › goal_refunds[]` — cùng trường `snapshot.pockets.reserve.refunds[]`, snake_case. */
export interface GoalRefundSettingsView {
  id: number;
  goal_id: string;
  goal_name: string;
  spend_tx_id: number;
  from_account_id: string;
  to_account_id: string;
  amount: number;
  linked: number;
  missing: number;
  status: GoalRefundView["status"];
  reason: string | null;
  code: string;
  memo: string;
  qr: GoalRefundView["qr"];
  hidden: boolean;
  created_at: string;
}

/**
 * Mọi mục tiêu (kể cả đã tắt) theo thứ tự ưu tiên và nhóm theo tài khoản mẹ (`GET /v1/settings`, UC-505): mục tiêu tài khoản
 * đang dùng chia số dư gộp − tiền lãi − pending bằng `goalGroups` với đã chi trong cửa sổ — cùng luật, cùng mốc snapshot; mục tiêu
 * trả từ tiền chi tiêu có `spent`, `remaining`, không `held`. `viewerId`: người xem (`unmatched`, việc chuyển về bị giấu).
 */
export async function listGoals(
  db: D1Database,
  now: Date,
  viewerId: string | null = null,
): Promise<{ goals: GoalView[]; groups: GoalGroupView[]; refunds: GoalRefundSettingsView[] }> {
  const { rows: all, inputs, groups, filled, operating, refunds } = await goalFill(db, now, viewerId);
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
        closed: g.closed ?? false,
        closed_at: g.closedAt ?? null,
        leftover: f ? f.leftover : 0,
        over: f ? f.over : 0,
        suggest_close: f ? f.suggestClose : false,
        short_because: f ? f.shortBecause.map((s) => ({ goal_id: s.goalId, amount: s.amount })) : [],
        advance: g.advance ?? 0,
        advance_from: g.advanceFrom ?? [],
        pending_refund: g.pendingRefund ?? 0,
        period_id: g.periodId ?? null,
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
      pending: g.pending,
      free: g.free,
      unmatched: g.unmatched,
    })),
    refunds: refunds.map((r) => ({
      id: r.id,
      goal_id: r.goalId,
      goal_name: r.goalName,
      spend_tx_id: r.spendTxId,
      from_account_id: r.fromAccountId,
      to_account_id: r.toAccountId,
      amount: r.amount,
      linked: r.linked,
      missing: r.missing,
      status: r.status,
      reason: r.reason,
      code: r.code,
      memo: r.memo,
      qr: r.qr,
      hidden: r.hidden,
      created_at: r.createdAt,
    })),
  };
}

export async function readGoal(db: D1Database, id: string, now: Date, viewerId: string | null = null): Promise<GoalView> {
  return (await listGoals(db, now, viewerId)).goals.find((g) => g.id === id) ?? fail("not_found", "Không có mục tiêu này.", 404);
}

const TAX_SHARED = "Thuế cần tài khoản riêng: thuế đã nộp tính mọi khoản chi từ tài khoản này.";
const OPERATING_MONTHLY = "Trả thẳng từ tiền chi tiêu chỉ dùng cho khoản lặp có số tiền mỗi tháng.";

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
  if (reward) fail("account_is_reward", `${a!.name} là tài khoản Ví Thưởng, hãy chọn tài khoản ngăn Dự phòng khác.`, 409, "account_id");
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
    if (/account_is_reward/.test(msg)) fail("account_is_reward", "Tài khoản này là Ví Thưởng, hãy chọn tài khoản ngăn Dự phòng khác nhé.", 409, "account_id");
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
      `INSERT INTO reserve_goals (id, name, account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date, debt_id, sort, pays_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, name, accountId, draft.target_amount, draft.target_pct, draft.monthly_amount, draft.repeat_months, draft.due_date, draft.debt_id, sort ?? 0, paysFrom, now.toISOString());
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
 * thì B tính lại. Đổi hạn không đổi thứ tự. Đổi sang `operating`: tự đặt `account_id = NULL`. `category_ids`
 * (chỉ mục tiêu `operating`) đặt lại danh mục của khoản; đổi sang `account` thì bỏ hết danh mục. Trả `changes` có `account_id` /
 * `pays_from: { from, to }` khi đổi.
 */
export async function updateGoal(
  db: D1Database,
  id: string,
  b: Input,
  now: Date,
): Promise<{ goal: GoalView; changes: Record<string, { from: unknown; to: unknown }> }> {
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
  const update = db
    .prepare(
      `UPDATE reserve_goals SET name = ?, account_id = ?, target_amount = ?, target_pct = ?, monthly_amount = ?, repeat_months = ?,
         due_date = ?, debt_id = ?, sort = ?, active = ?, pays_from = ? WHERE id = ?`,
    )
    .bind(
      name ?? current.name, accountId, draft.target_amount, draft.target_pct, draft.monthly_amount, draft.repeat_months,
      draft.due_date, draft.debt_id, sort ?? current.sort, active ? 1 : 0, paysFrom, id,
    );
  await goalWrite(() => db.batch([update, ...links]));
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (accountId !== current.account_id) changes.account_id = { from: current.account_id, to: accountId };
  if (paysFrom !== current.pays_from) changes.pays_from = { from: current.pays_from, to: paysFrom };
  return { goal: await readGoal(db, id, now), changes };
}

/**
 * `PUT /v1/goal-month-amounts/:goalId` (pocket UC-1209 bước 12, ADR-143, ADR-144): số riêng cho tháng VN hiện tại của khoản trả
 * thẳng từ tiền chi tiêu — `amount` 0…MONEY_MAX (0 = tháng này không trả), `null` = bỏ số riêng (về số mỗi tháng); `note` ≤ 80
 * ký tự. Không có mục tiêu → 404; không phải mục tiêu `operating` đang dùng → 409 not_operating_goal. Trả mục tiêu sau khi đặt
 * và `month`, `amount { from, to }` (số tháng này trước / sau) cho nhật ký `goal.month_amount`.
 */
export async function setGoalMonthAmount(
  db: D1Database,
  goalId: string,
  b: Input,
  now: Date,
): Promise<{ goal: OperatingGoal; month: string; amount: { from: number; to: number } }> {
  const goal = await db.prepare("SELECT active, pays_from AS paysFrom, monthly_amount AS monthly FROM reserve_goals WHERE id = ?").bind(goalId).first<{ active: number; paysFrom: string; monthly: number | null }>();
  if (!goal) fail("not_found", "Không có mục tiêu này.", 404);
  if (!goal!.active || goal!.paysFrom !== "operating" || goal!.monthly === null) fail("not_operating_goal", "Chỉ khoản trả thẳng từ tiền chi tiêu đang dùng mới đặt số tháng này.", 409, "amount");
  if (!has(b, "amount")) fail("invalid_input", "Thiếu amount.", 400, "amount");
  const amount = intOrNull(b, "amount") as number | null;
  if (amount !== null && (amount < 0 || amount > MONEY_MAX)) fail("invalid_input", "Số tháng này từ 0 đến 1.000.000.000.000.", 400, "amount");
  const note = amount === null ? null : (strOrNull(b, "note") ?? null);
  if (note !== null && note.length > 80) fail("invalid_input", "Lý do tối đa 80 ký tự.", 400, "note");
  const month = currentMonth(now);
  const before = await db.prepare("SELECT amount FROM goal_month_amounts WHERE goal_id = ? AND month_key = ?").bind(goalId, month.key).first<{ amount: number }>();
  await (amount === null
    ? db.prepare("DELETE FROM goal_month_amounts WHERE goal_id = ? AND month_key = ?").bind(goalId, month.key)
    : db
        .prepare(
          `INSERT INTO goal_month_amounts (goal_id, month_key, amount, note) VALUES (?, ?, ?, ?)
           ON CONFLICT (goal_id, month_key) DO UPDATE SET amount = excluded.amount, note = excluded.note, updated_at = datetime('now')`,
        )
        .bind(goalId, month.key, amount, note)
  ).run();
  const after = (await goalFill(db, now)).operating.find((o) => o.id === goalId)!;
  return { goal: after, month: month.key, amount: { from: before ? Number(before.amount) : goal!.monthly!, to: amount ?? goal!.monthly! } };
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
  if (!valid) fail("invalid_order", "Danh sách cần đủ mục tiêu đang dùng, mỗi mục tiêu một lần. Tải lại rồi thử lại nhé.", 400, "ids");
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
    if (!goal.active) fail("goal_inactive", "Mục tiêu này đang tắt, hãy bật lại trước khi tạo tài khoản nhé.", 409);
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
  /** Hạn mức mềm mỗi tháng; null = không đặt. */
  monthly_limit: number | null;
  sort: number;
  active: boolean;
}
const GROUP_SQL = "SELECT id, name, essential, monthly_limit, sort, active FROM category_groups";
const toGroup = (r: Row): CategoryGroupView => ({
  id: String(r.id),
  name: String(r.name),
  essential: Boolean(r.essential),
  monthly_limit: r.monthly_limit === null ? null : Number(r.monthly_limit),
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

/** Hạn mức mềm mỗi tháng: số nguyên > 0, tối đa 1e12, hoặc null (bỏ hạn mức). `cycle_limit` của kỳ lương (ADR-144) → 400 model_changed. */
function monthlyLimit(b: Input): number | null | undefined {
  if (has(b, "cycle_limit")) throw new DomainError("model_changed", "Ví nhà v2.5 đã bỏ kỳ lương: gửi monthly_limit, bỏ trường cycle_limit.", 400, undefined, ["cycle_limit"]);
  const v = intOrNull(b, "monthly_limit");
  if (v !== undefined && v !== null && (v <= 0 || v > MONEY_MAX)) fail("invalid_input", "Hạn mức là số nguyên lớn hơn 0 (để trống = không đặt).", 400, "monthly_limit");
  return v;
}

export async function createCategoryGroup(db: D1Database, b: Input): Promise<CategoryGroupView> {
  const { name, id } = nameOf(b);
  if (await db.prepare("SELECT 1 FROM category_groups WHERE id = ?").bind(id).first()) fail("duplicate", "Đã có nhóm danh mục với tên này.", 409, "name");
  const limit = monthlyLimit(b) ?? null;
  await db
    .prepare("INSERT INTO category_groups (id, name, essential, monthly_limit, sort) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, boolOf(b, "essential") ? 1 : 0, limit, intOrNull(b, "sort") ?? 100)
    .run();
  return readGroup(db, id);
}

/** Tắt nhóm còn danh mục đang dùng → 409 group_in_use (câu UPDATE có điều kiện). */
export async function updateCategoryGroup(db: D1Database, id: string, b: Input): Promise<CategoryGroupView> {
  const current = await readGroup(db, id);
  const name = has(b, "name") ? nameOf(b).name : current.name;
  const limit = monthlyLimit(b);
  const essential = boolOf(b, "essential") ?? current.essential;
  const active = boolOf(b, "active") ?? current.active;
  const res = await db
    .prepare(
      `UPDATE category_groups SET name = ?1, essential = ?2, monthly_limit = ?3, sort = ?4, active = ?5
       WHERE id = ?6 AND (?5 = 1 OR NOT EXISTS (SELECT 1 FROM categories c WHERE c.group_id = ?6 AND c.active = 1))`,
    )
    .bind(name, essential ? 1 : 0, limit === undefined ? current.monthly_limit : limit, intOrNull(b, "sort") ?? current.sort, active ? 1 : 0, id)
    .run();
  if (!res.meta.changes) fail("group_in_use", "Nhóm còn danh mục đang dùng, hãy chuyển sang nhóm khác trước nhé.", 409, "active");
  return readGroup(db, id);
}
