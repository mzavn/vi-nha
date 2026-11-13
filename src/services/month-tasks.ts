// Việc theo tháng trên D1 (pocket UC-1205, UC-1206, UC-1207 — ADR-144): nhắc ① trích Tích luỹ của từng khoản lương (ghi
// cùng batch với khoản thu), ghép chuyển khoản vào việc ngay sau mỗi lần ghi (làm lại nhiều lần không sai), chia dư cuối
// tháng (một batch, khoá chính chặn bấm đua). Huỷ khoản lương / đổi thành "không phải lương" / đổi sang thu nhập thụ động
// kéo nhắc của nó về `void`. Nhập tay, Gán, ingest, MCP đều đi qua đây. Bảng kỳ cũ chỉ còn đọc (phần đã dùng).

import type { AuditAction } from "../domain/audit-actions";
import type { TxRow } from "../domain/entry";
import {
  AUTO_MATCH_MIN,
  DEFAULT_SALARY_REMINDER_MIN,
  DEFAULT_SURPLUS_SAVINGS_PCT,
  EARLY_DAYS,
  TASK_AMOUNT_MAX,
  addDays,
  allocateTransfer,
  codesIn,
  daysInMonth,
  earlySalaryPayday,
  heldToPayday,
  monthStart,
  monthSurplus,
  nextMonth,
  paydayOf,
  pendingTasks,
  prevMonth,
  savingsAmount,
  savingsDone,
  taskPrefix,
  taskState,
  vnMidnight,
  type MatchTask,
  type MonthClose,
  type MonthSavings,
  type MonthTask,
  type MonthView,
  type QrTarget,
  type TaskKind,
  type TaskStatus,
} from "../domain/month-tasks";
import { dayKey, monthKey } from "../domain/period";
import { DEFAULT_SAVINGS_PCT, type Pocket } from "../domain/pockets";
import { DEFAULT_PAYDAY_DAY, nextPayday } from "../domain/snapshot";
import { DomainError, type Refs } from "../domain/types";
import { assertTxChangeable, hiddenAccountIds, txNotFound, txVisibility } from "./privacy";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400, field?: string): never => {
  throw new DomainError(code, message, status, field);
};
/** Id của khoản vừa chèn ở câu INSERT transactions đứng ngay trước trong cùng batch (batch là một transaction). */
const NEW_TX = "(SELECT MAX(id) FROM transactions)";
const DAY_MS = 86_400_000;

// ── Cấu hình ────────────────────────────────────────────────────────

export interface TaskConfig {
  paydayDay: number;
  savingsPct: number;
  surplusPct: number;
  salaryReminderMin: number;
  /** Ví Thưởng: chỉ khi trỏ tài khoản đang dùng ngăn Dự phòng, không gắn mục tiêu đang dùng. */
  rewardAccountId: string | null;
}

export async function taskConfig(db: D1Database): Promise<TaskConfig> {
  const res = await db
    .prepare(
      `SELECT k, v FROM config WHERE k IN ('payday_day', 'savings_pct', 'surplus_savings_pct', 'salary_reminder_min')
       UNION ALL
       SELECT 'surplus_reward_account', a.id FROM config c JOIN accounts a ON a.id = c.v
       WHERE c.k = 'surplus_reward_account' AND a.active = 1 AND a.pocket = 'reserve'
         AND NOT EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = a.id AND g.active = 1)`,
    )
    .all<{ k: string; v: string }>();
  const c = Object.fromEntries(rows<{ k: string; v: string }>(res).map((r) => [r.k, r.v]));
  const int = (v: string | undefined, def: number, min: number, max: number) => {
    const n = Number(v);
    return v !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : def;
  };
  return {
    paydayDay: int(c.payday_day, DEFAULT_PAYDAY_DAY, 1, 31),
    savingsPct: int(c.savings_pct, DEFAULT_SAVINGS_PCT, 0, 100),
    surplusPct: int(c.surplus_savings_pct, DEFAULT_SURPLUS_SAVINGS_PCT, 0, 100),
    salaryReminderMin: int(c.salary_reminder_min, DEFAULT_SALARY_REMINDER_MIN, 0, 1e12),
    rewardAccountId: c.surplus_reward_account ?? null,
  };
}

// ── Khoản thu nào là lương (UC-1205, Q1-B) ──────────────────────────

/**
 * "Đây là lương" của một khoản thu sắp ghi: gửi `requested` (true / false) thì theo đó; không gửi → nguồn đánh dấu lương, hoặc
 * khoản không nguồn từ `salary_reminder_min` trở lên. Không bao giờ là lương: tiền người thuê / nguồn cho thuê, lãi tiền gửi
 * (gửi true → 400 `cannot_be_salary`); khoản không phải thu nhập (gửi true → 400 `invalid_input`).
 */
export function resolveIsSalary(
  refs: Pick<Refs, "incomeStreams" | "rentalIncomeStreamId" | "salaryReminderMin">,
  row: Pick<TxRow, "meaning" | "amount" | "tenant_id" | "income_stream_id">,
  requested: unknown,
  opts: { interest: boolean },
): boolean {
  if (requested !== undefined && requested !== null && typeof requested !== "boolean") fail("invalid_input", "is_salary là true hoặc false.", 400, "is_salary");
  if (row.meaning !== "income") {
    if (requested === true) fail("invalid_input", "\"Đây là lương\" chỉ dùng cho khoản thu nhập.", 400, "is_salary");
    return false;
  }
  const rental = Boolean(row.tenant_id) || (refs.rentalIncomeStreamId !== null && row.income_stream_id === refs.rentalIncomeStreamId);
  if (rental || opts.interest) {
    if (requested === true) fail("cannot_be_salary", rental ? "Tiền thuê nhà không phải lương." : "Lãi tiền gửi không phải lương.", 400, "is_salary");
    return false;
  }
  if (typeof requested === "boolean") return requested;
  if (row.income_stream_id) return refs.incomeStreams.find((s) => s.id === row.income_stream_id)?.isSalary ?? false;
  return row.amount >= (refs.salaryReminderMin ?? DEFAULT_SALARY_REMINDER_MIN);
}

/** Nhắc ① mà một khoản lương sắp ghi sinh ra — phản hồi `effects.savings`. */
export interface SavingsPlan {
  amount: number;
  pct: number;
}

/** Lương về thẳng tài khoản / nguồn ngăn Tích luỹ thì không nhắc (luật cũ UC-1206 bước 2). */
function remindsSavings(refs: Pick<Refs, "accounts" | "incomeStreams">, row: Pick<TxRow, "counter_account_id" | "income_stream_id">): boolean {
  const accountPocket = refs.accounts.find((a) => a.id === row.counter_account_id)?.pocket ?? null;
  const streamPocket = row.income_stream_id ? (refs.incomeStreams.find((s) => s.id === row.income_stream_id)?.pocket ?? null) : null;
  return accountPocket !== "savings" && streamPocket !== "savings";
}

/**
 * Câu chèn nhắc ① của một khoản lương (`row.is_salary` = 1), đặt NGAY SAU câu INSERT khoản thu trong cùng batch (UC-1205
 * AC-5). `month_key` = tháng VN của khoản lương. `guardTxId`: sửa khoản (ADR-73) — chỉ chèn khi khoản cũ còn hiệu lực.
 */
export async function incomeStatements(
  db: D1Database,
  refs: Pick<Refs, "accounts" | "incomeStreams">,
  row: TxRow,
  opts: { guardTxId?: number | null; memberId: string | null },
): Promise<{ statements: D1PreparedStatement[]; savings: SavingsPlan | null }> {
  if (row.meaning !== "income" || row.is_salary !== 1 || !remindsSavings(refs, row)) return { statements: [], savings: null };
  const { savingsPct } = await taskConfig(db);
  const amount = savingsAmount(row.amount, savingsPct);
  const guard = opts.guardTxId ? ` AND EXISTS (SELECT 1 FROM transactions WHERE id = ${Number(opts.guardTxId)} AND status = 'active')` : "";
  return {
    statements: [
      db
        .prepare(
          `INSERT INTO month_tasks (kind, month_key, income_tx_id, to_pocket, amount, pct, by_member_id)
           SELECT 'savings', ?, ${NEW_TX}, 'savings', ?, ?, ? WHERE 1${guard}`,
        )
        .bind(row.month_key, amount, savingsPct, opts.memberId),
    ],
    savings: { amount, pct: savingsPct },
  };
}

/**
 * Câu huỷ kèm theo khi huỷ / sửa / gỡ gán các giao dịch `txIds` (đặt TRƯỚC câu ghi mới trong batch): nhắc ① của khoản lương →
 * `void` (liên kết tự nhả: phần đã dùng chỉ đếm việc chưa void); khoản thu cũ đã chia → `fund` cùng lô `void` (ADR-123).
 */
export function voidTxStatements(db: D1Database, txIds: number[], now = new Date()): D1PreparedStatement[] {
  if (txIds.length === 0) return [];
  const marks = txIds.map(() => "?").join(", ");
  return [
    db.prepare(`UPDATE month_tasks SET status = 'void', updated_at = ? WHERE status <> 'void' AND income_tx_id IN (${marks})`).bind(now.toISOString(), ...txIds),
    db
      .prepare(`UPDATE transactions SET status = 'void' WHERE status = 'active' AND meaning = 'fund' AND batch_id IN (SELECT batch_id FROM allocation_runs WHERE income_tx_id IN (${marks}))`)
      .bind(...txIds),
  ];
}

/** Khoản lương đổi thành "không phải lương" / sang thu nhập thụ động (UC-1205): `is_salary` về 0, nhắc của nó `void`. */
export function unsalaryStatements(db: D1Database, txId: number, now: Date): D1PreparedStatement[] {
  return [
    db.prepare("UPDATE transactions SET is_salary = 0 WHERE id = ? AND is_salary = 1").bind(txId),
    db.prepare("UPDATE month_tasks SET status = 'void', updated_at = ? WHERE status <> 'void' AND kind = 'savings' AND income_tx_id = ?").bind(now.toISOString(), txId),
  ];
}

/** Lãi tiền gửi: khoản thu đã xếp "Thu nhập thụ động" (dòng `passive_income`) — không bao giờ là lương. */
async function isInterestTx(db: D1Database, txId: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM transaction_report_classes WHERE transaction_id = ? AND report_class = 'passive_income'").bind(txId).first());
}

/**
 * `POST /v1/transactions/:id/salary { is_salary }` (UC-1205 AC-6): đổi lựa chọn của một khoản thu đã ghi (kể cả khoản từ
 * SePay) — UPDATE riêng cột `is_salary` cùng batch với void / tạo nhắc; luật riêng tư như sửa khoản. Khoản không phải thu nhập →
 * 400 `invalid_input`; true cho tiền người thuê / lãi → 400 `cannot_be_salary`. Không đổi → không ghi gì (`changed` false).
 */
export async function setSalary(
  db: D1Database,
  txId: number,
  body: Record<string, unknown>,
  viewerId: string | null,
  now: Date,
): Promise<{ changed: boolean; from: boolean; to: boolean; savings: SavingsPlan | null }> {
  if (typeof body.is_salary !== "boolean") fail("invalid_input", "is_salary là true hoặc false.", 400, "is_salary");
  const to = body.is_salary as boolean;
  const tx = await db
    .prepare("SELECT id, meaning, status, amount, account_id, counter_account_id, tenant_id, income_stream_id, month_key, is_salary FROM transactions WHERE id = ?")
    .bind(txId)
    .first<Row>();
  if (!tx) throw txNotFound();
  assertTxChangeable(tx, await hiddenAccountIds(db, viewerId));
  if (tx.status !== "active") fail("already_void", "Giao dịch đã huỷ.", 409);
  if (tx.meaning !== "income") fail("invalid_input", "\"Đây là lương\" chỉ dùng cho khoản thu nhập.", 400, "is_salary");
  if (to && (tx.tenant_id || (await isInterestTx(db, txId)))) fail("cannot_be_salary", tx.tenant_id ? "Tiền thuê nhà không phải lương." : "Lãi tiền gửi không phải lương.", 400, "is_salary");
  const from = Number(tx.is_salary) === 1;
  if (from === to) return { changed: false, from, to, savings: null };
  if (!to) {
    await db.batch(unsalaryStatements(db, txId, now));
    return { changed: true, from, to, savings: null };
  }
  const [accounts, stream, cfg] = await Promise.all([
    db.prepare("SELECT pocket FROM accounts WHERE id = ?").bind(tx.counter_account_id).first<{ pocket: Pocket | null }>(),
    tx.income_stream_id ? db.prepare("SELECT pocket FROM income_streams WHERE id = ?").bind(tx.income_stream_id).first<{ pocket: Pocket | null }>() : null,
    taskConfig(db),
  ]);
  const remind = accounts?.pocket !== "savings" && stream?.pocket !== "savings";
  const amount = savingsAmount(Number(tx.amount), cfg.savingsPct);
  await db.batch([
    db.prepare("UPDATE transactions SET is_salary = 1 WHERE id = ? AND status = 'active'").bind(txId),
    ...(remind
      ? [
          db
            .prepare(
              `INSERT INTO month_tasks (kind, month_key, income_tx_id, to_pocket, amount, pct, by_member_id)
               SELECT 'savings', ?1, ?2, 'savings', ?3, ?4, ?5
               WHERE NOT EXISTS (SELECT 1 FROM month_tasks WHERE kind = 'savings' AND income_tx_id = ?2 AND status <> 'void')`,
            )
            .bind(tx.month_key, txId, amount, cfg.savingsPct, viewerId),
        ]
      : []),
  ]);
  await afterWrite(db);
  return { changed: true, from, to, savings: remind ? { amount, pct: cfg.savingsPct } : null };
}

// ── Ghép chuyển khoản vào việc (UC-1206) ────────────────────────────

interface TaskRow {
  id: number;
  kind: TaskKind;
  month_key: string;
  income_tx_id: number | null;
  to_pocket: "savings" | null;
  to_account_id: string | null;
  amount: number;
  pct: number | null;
  status: TaskStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
  /** Mã trong nội dung chuyển khoản (cột sinh `month_tasks.code`). */
  code: string;
  /** Mốc của việc: ① = thời điểm khoản lương, chia dư = lúc bấm Chia (`created_at`, cùng `month_surplus.at`). */
  since: string;
  linked: number;
  last_tx_at: string | null;
  last_link_at: string | null;
}

/**
 * Liên kết còn hiệu lực của việc `x.task_id`: chuyển khoản còn hiệu lực, và với việc → ngăn Tích luỹ thì chuyển khoản từ
 * `AUTO_MATCH_MIN` hoặc ghép theo mã (liên kết dưới ngưỡng ghi trước khi có ngưỡng không còn tính — UC-1206 AC-19, không cần
 * migration; ghép theo mã trong nội dung luôn tính — UC-303 AC-33).
 */
const LIVE_LINK = `t.status = 'active' AND (t.amount >= ${AUTO_MATCH_MIN} OR x.by_code = 1 OR (SELECT m.to_pocket FROM month_tasks m WHERE m.id = x.task_id) IS NULL)`;
const LINKED = (task: string) =>
  `COALESCE((SELECT SUM(x.amount) FROM month_task_tx x JOIN transactions t ON t.id = x.tx_id AND ${LIVE_LINK} WHERE x.task_id = ${task}), 0)`;
const TASKS_SQL = `SELECT k.*, COALESCE((SELECT i.at FROM transactions i WHERE i.id = k.income_tx_id), k.created_at) AS since, ${LINKED("k.id")} AS linked,
    (SELECT MAX(t.at) FROM month_task_tx x JOIN transactions t ON t.id = x.tx_id AND ${LIVE_LINK} WHERE x.task_id = k.id) AS last_tx_at,
    (SELECT MAX(x.created_at) FROM month_task_tx x JOIN transactions t ON t.id = x.tx_id AND ${LIVE_LINK} WHERE x.task_id = k.id) AS last_link_at
  FROM month_tasks k`;

const taskRow = (t: TaskRow): TaskRow => ({ ...t, amount: Number(t.amount), linked: Number(t.linked) });

/** Việc kỳ hiện tại lúc nâng cấp (0046): ① của kỳ đó đã chép sang `month_tasks`, liên kết chỉ đếm ở bảng mới. */
const COPIED_CYCLE = "(SELECT id FROM pay_cycles WHERE status = 'active' ORDER BY payday DESC LIMIT 1)";

/**
 * Phần đã dùng của một chuyển khoản (UC-1206): Σ liên kết của việc tháng chưa void + Σ liên kết của việc kỳ cũ chưa void không
 * được chép (② / ③ / ④ và ① của kỳ cũ hơn kỳ hiện tại lúc nâng cấp) — liên kết ① đã chép không đếm hai lần, liên kết ② / ④ cũ
 * không bị nhả ra dùng lại.
 */
const USED_SQL = (tx: string) => `(COALESCE((SELECT SUM(x.amount) FROM month_task_tx x JOIN month_tasks k ON k.id = x.task_id
    WHERE x.tx_id = ${tx} AND k.status <> 'void'), 0)
  + COALESCE((SELECT SUM(x.amount) FROM pay_cycle_task_tx x JOIN pay_cycle_tasks k ON k.id = x.task_id
    WHERE x.tx_id = ${tx} AND k.status <> 'void' AND NOT (k.kind = 'savings' AND k.cycle_id IS ${COPIED_CYCLE})), 0))`;

/**
 * Câu ghi một liên kết việc ← chuyển khoản: chỉ thành khi, TẠI LÚC GHI, chuyển khoản còn đủ phần chưa dùng và việc còn mở,
 * chưa nhận đủ. Lần ghép song song tính từ trạng thái cũ thì không ghi dòng nào (chống ghép quá số).
 */
export function linkTaskStatement(db: D1Database, taskId: number, txId: number, amount: number, now = new Date(), byCode = false): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO month_task_tx (task_id, tx_id, amount, created_at, by_code) SELECT ?1, ?2, ?3, ?4, ?5
       WHERE EXISTS (SELECT 1 FROM month_tasks WHERE id = ?1 AND status = 'open')
         AND (SELECT amount FROM transactions WHERE id = ?2 AND status = 'active') >= ${USED_SQL("?2")} + ?3
         AND ${LINKED("?1")} + ?3 <= (SELECT amount FROM month_tasks WHERE id = ?1)`,
    )
    .bind(taskId, txId, amount, now.toISOString(), byCode ? 1 : 0);
}

async function openTaskRows(db: D1Database): Promise<TaskRow[]> {
  return rows<TaskRow>(await db.prepare(`${TASKS_SQL} WHERE k.status = 'open' ORDER BY k.id`).all()).map(taskRow);
}

/**
 * Ghép mọi chuyển khoản nội bộ S → D (D thuộc ngăn Tích luỹ khác ngăn S; hoặc D là đúng tài khoản Ví Thưởng của việc) vào các
 * việc đang mở có mốc ≤ thời điểm chuyển khoản, theo thời gian rồi theo thứ tự việc. Chỉ ghi liên kết, không dòng sổ nào. Trả các
 * việc vừa tự xong.
 */
export async function afterWrite(db: D1Database, now = new Date()): Promise<{ tasksDone: { id: number; kind: TaskKind }[] }> {
  const tasks = (await openTaskRows(db)).filter((t) => taskState(t, t.linked).state === "open");
  if (tasks.length === 0) return { tasksDone: [] };
  const open: MatchTask[] = tasks.map((t) => ({ id: t.id, toPocket: t.to_account_id ? null : t.to_pocket, toAccountId: t.to_account_id, missing: t.amount - t.linked, since: t.since }));
  const from = open.reduce((m, t) => (t.since < m ? t.since : m), open[0]!.since);
  type TransferRow = { id: number; at: string; amount: number; used: number; fromId: string; fromPocket: Pocket | null; fromParent: string | null; toId: string; toPocket: Pocket | null; toParent: string | null };
  const transfers = rows<TransferRow>(
    await db
      .prepare(
        `SELECT t.id, t.at, t.amount, ${USED_SQL("t.id")} AS used, fa.id AS fromId, fa.pocket AS fromPocket, fa.parent_account_id AS fromParent,
                ta.id AS toId, ta.pocket AS toPocket, ta.parent_account_id AS toParent
         FROM transactions t JOIN accounts fa ON fa.id = t.account_id JOIN accounts ta ON ta.id = t.counter_account_id
         WHERE t.status = 'active' AND t.meaning = 'transfer' AND t.at >= ? ORDER BY t.at, t.id`,
      )
      .bind(from)
      .all(),
  );
  const statements: D1PreparedStatement[] = [];
  for (const tr of transfers) {
    const links = allocateTransfer(open, {
      from: { id: tr.fromId, pocket: tr.fromPocket, parentId: tr.fromParent },
      to: { id: tr.toId, pocket: tr.toPocket, parentId: tr.toParent },
      amount: Number(tr.amount),
      available: Number(tr.amount) - Number(tr.used),
      at: tr.at,
    });
    for (const l of links) {
      open.find((t) => t.id === l.taskId)!.missing -= l.amount;
      statements.push(linkTaskStatement(db, l.taskId, tr.id, l.amount, now));
    }
  }
  if (statements.length === 0) return { tasksDone: [] };
  await db.batch(statements);
  const wasOpen = new Set(open.map((t) => t.id));
  const after = await openTaskRows(db);
  return { tasksDone: after.filter((t) => wasOpen.has(t.id) && taskState(t, t.linked).state === "done").map((t) => ({ id: t.id, kind: t.kind })) };
}

// ── Ghép theo mã trong nội dung chuyển khoản (UC-1206 AC-20, ingest UC-303 AC-33) ──

type CodedTask = { id: number; kind: TaskKind; to_pocket: "savings" | null; to_account_id: string | null; amount: number; linked: number };

/** Việc đang mở (chưa nhận đủ) có mã + tiền tố + tháng khớp một bộ trong nội dung; không có → null. */
async function codedTask(db: D1Database, content: string | null): Promise<CodedTask | null> {
  for (const { prefix, code, month } of codesIn(content)) {
    const t = await db
      .prepare(`SELECT k.id, k.kind, k.to_pocket, k.to_account_id, k.amount, ${LINKED("k.id")} AS linked FROM month_tasks k WHERE k.code = ? AND k.status = 'open' AND CAST(substr(k.month_key, 6, 2) AS INTEGER) = ?`)
      .bind(code, month)
      .first<CodedTask>();
    if (!t || taskPrefix({ kind: t.kind, toAccountId: t.to_account_id }) !== prefix) continue;
    if (Number(t.linked) >= Number(t.amount)) continue;
    return t;
  }
  return null;
}

/**
 * Tài khoản đích cho log tiền ra có mã việc (UC-303 AC-33): → Ví Thưởng = tài khoản của việc; ① / chia dư → Tích luỹ = tài khoản
 * ngăn Tích luỹ đầu tiên có số tài khoản (đúng đích QR mặc định, `monthView.targets[0]`). null = không mã, việc đã đủ, không đích.
 */
export async function codeTarget(db: D1Database, content: string | null): Promise<{ taskId: number; accountId: string } | null> {
  const t = await codedTask(db, content);
  if (!t) return null;
  const target = t.to_account_id
    ? await db.prepare("SELECT id FROM accounts WHERE id = ? AND active = 1").bind(t.to_account_id).first<{ id: string }>()
    : await db
        .prepare("SELECT id FROM accounts WHERE active = 1 AND pocket = 'savings' AND account_no IS NOT NULL AND account_no <> '' ORDER BY kind, name LIMIT 1")
        .first<{ id: string }>();
  return target ? { taskId: Number(t.id), accountId: target.id } : null;
}

/**
 * Ghép chuyển khoản `txId` vào việc có mã trong nội dung log của nó (chân ra hoặc chân vào) — trước tự tick theo luật, không xét
 * ngưỡng `AUTO_MATCH_MIN` (liên kết `by_code`). Đích phải hợp với việc: → Ví Thưởng = đúng tài khoản đó hoặc con của nó; ① / chia
 * dư → Tích luỹ = tài khoản ngăn Tích luỹ, nguồn khác ngăn. Không hợp / không mã → không làm gì (tự tick thường lo tiếp).
 */
export async function linkByCode(db: D1Database, txId: number, now = new Date()): Promise<void> {
  const tx = await db
    .prepare(
      `SELECT t.id, t.amount, ${USED_SQL("t.id")} AS used, fa.pocket AS fromPocket, ta.id AS toId, ta.pocket AS toPocket, ta.parent_account_id AS toParent,
              (SELECT content FROM bank_logs WHERE id = t.log_id) AS c1, (SELECT content FROM bank_logs WHERE id = t.log_id_2) AS c2
       FROM transactions t JOIN accounts fa ON fa.id = t.account_id JOIN accounts ta ON ta.id = t.counter_account_id
       WHERE t.id = ? AND t.status = 'active' AND t.meaning = 'transfer'`,
    )
    .bind(txId)
    .first<{ id: number; amount: number; used: number; fromPocket: Pocket | null; toId: string; toPocket: Pocket | null; toParent: string | null; c1: string | null; c2: string | null }>();
  if (!tx) return;
  const t = (await codedTask(db, tx.c1)) ?? (await codedTask(db, tx.c2));
  if (!t) return;
  const fits = t.to_account_id ? tx.toId === t.to_account_id || tx.toParent === t.to_account_id : tx.toPocket === "savings" && tx.fromPocket !== "savings";
  const amount = Math.min(Number(tx.amount) - Number(tx.used), Number(t.amount) - Number(t.linked));
  if (!fits || amount <= 0) return;
  await linkTaskStatement(db, Number(t.id), Number(tx.id), amount, now, true).run();
}

// ── snapshot.month ──────────────────────────────────────────────────

type AccountRow = { id: string; name: string; bank: string | null; accountNo: string | null; subAccount: string | null; pocket: Pocket | null; active: number };

/** Tích luỹ của tháng `month` (ledger UC-108, UC-1206): `savingsDone` trên các ① có `month_key` đó; `reason` khi mức là `zero`. */
export async function monthSavings(db: D1Database, month: string): Promise<MonthSavings & { reason: string | null }> {
  const tasks = rows<{ status: TaskStatus; amount: number; linked: number; sourceAmount: number | null; reason: string | null }>(
    await db
      .prepare(
        `SELECT k.status, k.amount, k.reason, (SELECT s.amount FROM transactions s WHERE s.id = k.income_tx_id) AS sourceAmount, ${LINKED("k.id")} AS linked
         FROM month_tasks k WHERE k.kind = 'savings' AND k.status <> 'void' AND k.month_key = ? ORDER BY k.id`,
      )
      .bind(month)
      .all(),
  );
  const done = savingsDone(
    tasks.map((t) => ({ kind: "savings" as const, status: t.status, amount: Number(t.amount), linked: Number(t.linked), sourceAmount: t.sourceAmount === null ? null : Number(t.sourceAmount) })),
  );
  const reason = done.level === "zero" ? (tasks.find((t) => (t.status === "skipped" || Number(t.amount) === 0) && t.reason)?.reason ?? null) : null;
  return { ...done, reason };
}

/**
 * Việc tháng để dựng snapshot: view + phần chưa làm (ledger UC-103). Việc hiện: đang mở (mọi tháng), hoặc xong / bỏ qua trong
 * 24 giờ qua. `viewerId`: người xem — khoản lương bị giấu → `source: { hidden: true }` (access UC-504 AC-18); `null` = cron.
 */
export async function monthView(db: D1Database, now: Date, viewerId: string | null): Promise<{ view: Omit<MonthView, "goalHint">; pendingTasks: number }> {
  const key = monthKey(now);
  const recent = new Date(now.getTime() - DAY_MS).toISOString();
  const [taskRes, accountRes, sourceRes, hidden, savings] = await Promise.all([
    db.prepare(`${TASKS_SQL} WHERE k.status <> 'void' AND (k.status = 'open' OR k.updated_at >= ?) ORDER BY k.id`).bind(recent).all(),
    db.prepare("SELECT id, name, bank, account_no AS accountNo, sub_account AS subAccount, pocket, active FROM accounts ORDER BY kind, name").all(),
    db
      .prepare(
        `SELECT t.id, t.amount, t.at, t.counter_account_id AS accountId, s.name AS streamName FROM transactions t LEFT JOIN income_streams s ON s.id = t.income_stream_id
         WHERE t.id IN (SELECT income_tx_id FROM month_tasks WHERE status <> 'void' AND (status = 'open' OR updated_at >= ?))`,
      )
      .bind(recent)
      .all(),
    hiddenAccountIds(db, viewerId),
    monthSavings(db, key),
  ]);
  const all = rows<TaskRow>(taskRes).map(taskRow);
  const accounts = rows<AccountRow>(accountRes).filter((a) => a.active === 1);
  const sourceOf = new Map(rows<{ id: number; amount: number; at: string; accountId: string | null; streamName: string | null }>(sourceRes).map((s) => [Number(s.id), s]));
  const qr = (list: AccountRow[]): QrTarget[] => list.filter((a) => a.accountNo).map((a) => ({ accountId: a.id, name: a.name, bank: a.bank, accountNo: a.accountNo!, subAccount: a.subAccount }));
  const shown = all.filter((t) => {
    const s = taskState(t, t.linked);
    if (s.state === "open") return true;
    const closedAt = s.auto ? t.last_link_at : t.updated_at;
    return closedAt !== null && closedAt >= recent;
  });
  const tasks: MonthTask[] = shown.map((t) => {
    const s = taskState(t, t.linked);
    const src = t.income_tx_id ? sourceOf.get(t.income_tx_id) : undefined;
    const targetAccounts = t.to_account_id ? accounts.filter((a) => a.id === t.to_account_id) : accounts.filter((a) => a.pocket === "savings");
    return {
      id: t.id,
      kind: t.kind,
      month: t.month_key,
      code: t.code,
      status: s.state as MonthTask["status"],
      auto: s.auto,
      amount: t.amount,
      linked: t.linked,
      missing: s.missing,
      pct: t.pct,
      reason: t.reason,
      toPocket: t.to_account_id ? null : t.to_pocket,
      toAccountId: t.to_account_id,
      source: !src
        ? null
        : txVisibility({ counter_account_id: src.accountId }, hidden) === "hidden"
          ? { hidden: true }
          : { txId: Number(src.id), amount: Number(src.amount), at: src.at, streamName: src.streamName },
      updatedAt: t.updated_at,
      lastTxAt: t.last_tx_at,
      targets: qr(targetAccounts),
      targetName: targetAccounts[0]?.name ?? null,
    };
  });
  const { reason: _, ...monthSaved } = savings;
  return {
    view: { key, tasks, openCount: tasks.filter((t) => t.status === "open").length, savings: monthSaved },
    // Phần chưa làm: mọi việc đang mở trong DB (kể cả việc không hiện vì đã tự xong — taskState loại).
    pendingTasks: pendingTasks(all),
  };
}

// ── snapshot.monthClose, chia dư (UC-1207) ──────────────────────────

/**
 * Ngăn Vận hành theo sổ tại thời điểm `at`: Σ tài khoản ngăn Vận hành (đang dùng, hoặc tắt sau ngày của `at`) của (số dư đầu +
 * giao dịch còn hiệu lực có thời điểm < `at`). Theo sổ, không theo lúc ghi: log về muộn không làm số sai.
 */
export async function operatingAt(db: D1Database, at: string): Promise<number> {
  const ops = "SELECT id FROM accounts WHERE pocket = 'operating' AND (active = 1 OR deactivated_at > ?2)";
  const row = await db
    .prepare(
      `SELECT COALESCE((SELECT SUM(opening_balance) FROM accounts WHERE id IN (${ops})), 0)
            + COALESCE((SELECT SUM(CASE WHEN t.counter_account_id IN (${ops}) THEN t.amount ELSE 0 END - CASE WHEN t.account_id IN (${ops}) THEN t.amount ELSE 0 END)
                        FROM transactions t WHERE t.status = 'active' AND t.at < ?1), 0) AS n`,
    )
    .bind(at, dayKey(at))
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

type CloseFigures = Omit<MonthClose, "status" | "surplus" | "savingsAmount" | "rewardAmount" | "pct">;

/**
 * Số dư của tháng `month` (UC-1207 bước 2–7), mốc = 00:00 VN ngày 1 tháng sau: E Vận hành tại mốc; W phần còn thiếu tại mốc của
 * việc có mốc trước đó mà chưa xong lúc đó (ghép sau mốc không tính); L lương tháng sau về trong 7 ngày trước ngày lương mà trước
 * mốc (chỉ khi `payday_day` ≤ 7); P số tháng sau của mục tiêu `operating`; D ăn tiêu (chi ròng từ Vận hành trong tháng, trừ khoản
 * phải trả và trả gốc) tới ngày lương. null = không có giao dịch nào trước mốc.
 */
async function closeFigures(db: D1Database, month: string, cfg: TaskConfig): Promise<CloseFigures | null> {
  const next = nextMonth(month);
  const boundary = monthStart(next);
  const OPS = "SELECT id FROM accounts WHERE pocket = 'operating'";
  const OP_GOALS = "SELECT id FROM reserve_goals WHERE pays_from = 'operating'";
  const payday = paydayOf(next, cfg.paydayDay);
  const [any, tasks, early, payables, eat] = await db.batch([
    db.prepare("SELECT 1 AS x FROM transactions WHERE status = 'active' AND at < ? LIMIT 1").bind(boundary),
    db
      .prepare(
        `SELECT k.status, k.amount, k.updated_at AS updatedAt,
                COALESCE((SELECT SUM(x.amount) FROM month_task_tx x JOIN transactions t ON t.id = x.tx_id AND ${LIVE_LINK} WHERE x.task_id = k.id AND t.at < ?1), 0) AS linked
         FROM month_tasks k
         WHERE k.status <> 'void' AND COALESCE((SELECT i.at FROM transactions i WHERE i.id = k.income_tx_id), k.created_at) < ?1
           AND (k.status = 'open' OR k.updated_at >= ?1)`,
      )
      .bind(boundary),
    db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM transactions WHERE status = 'active' AND meaning = 'income' AND is_salary = 1 AND at >= ? AND at < ?")
      .bind(vnMidnight(addDays(payday, -EARLY_DAYS)), boundary),
    db
      .prepare(
        `SELECT COALESCE(SUM(COALESCE((SELECT a.amount FROM goal_month_amounts a WHERE a.goal_id = g.id AND a.month_key = ?), g.monthly_amount, 0)), 0) AS n
         FROM reserve_goals g WHERE g.active = 1 AND g.pays_from = 'operating'`,
      )
      .bind(next),
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN meaning = 'spend' AND account_id IN (${OPS}) THEN amount
                                  WHEN meaning = 'refund' AND counter_account_id IN (${OPS}) THEN -amount ELSE 0 END), 0) AS n
         FROM transactions WHERE status = 'active' AND meaning IN ('spend', 'refund') AND month_key = ?
           AND debt_id IS NULL AND (goal_id IS NULL OR goal_id NOT IN (${OP_GOALS}))
           AND (category_id IS NULL OR category_id NOT IN (SELECT category_id FROM reserve_goal_categories WHERE goal_id IN (${OP_GOALS})))`,
      )
      .bind(month),
  ]);
  if (rows(any!).length === 0) return null;
  const n = (r: D1Result) => Number(rows<{ n: number }>(r)[0]?.n ?? 0);
  const pendingAtEnd = rows<{ status: TaskStatus; amount: number; linked: number }>(tasks!).reduce((s, t) => s + Math.max(0, Number(t.amount) - Number(t.linked)), 0);
  return {
    month,
    operatingEnd: await operatingAt(db, boundary),
    pendingAtEnd,
    earlySalary: cfg.paydayDay <= EARLY_DAYS ? n(early!) : 0,
    heldPayables: n(payables!),
    heldToPayday: heldToPayday(n(eat!), daysInMonth(month), Number(payday.slice(8, 10))),
  };
}

const surplusOf = (f: CloseFigures, pct: number, rewardAccount: string | null) =>
  monthSurplus({ E: f.operatingEnd, W: f.pendingAtEnd, L: f.earlySalary, P: f.heldPayables, D: f.heldToPayday, pct, rewardAccount });

type SurplusRow = {
  month_key: string;
  operating_end: number;
  pending_at_end: number;
  early_salary: number;
  held_payables: number;
  held_to_payday: number;
  surplus: number;
  savings_pct: number;
  status: "split" | "skipped";
};

/**
 * `snapshot.monthClose` (UC-1207): tháng vừa hết (tháng trước tháng VN hiện tại). Đã chia / bỏ qua → số đã lưu (phần Tích luỹ /
 * Ví Thưởng theo việc chia dư đã tạo); chưa → tính lúc đọc, `status` `ask`. Hết tháng sau thì tháng đó ra khỏi đây, không lưu gì.
 */
export async function monthCloseView(db: D1Database, now: Date): Promise<MonthClose | null> {
  const month = prevMonth(monthKey(now));
  const stored = await db.prepare("SELECT * FROM month_surplus WHERE month_key = ?").bind(month).first<SurplusRow>();
  if (stored) {
    const parts = rows<{ toAccountId: string | null; amount: number }>(
      await db.prepare("SELECT to_account_id AS toAccountId, amount FROM month_tasks WHERE kind = 'surplus' AND month_key = ? AND status <> 'void'").bind(month).all(),
    );
    return {
      month,
      operatingEnd: Number(stored.operating_end),
      pendingAtEnd: Number(stored.pending_at_end),
      earlySalary: Number(stored.early_salary),
      heldPayables: Number(stored.held_payables),
      heldToPayday: Number(stored.held_to_payday),
      surplus: Number(stored.surplus),
      savingsAmount: parts.filter((p) => p.toAccountId === null).reduce((s, p) => s + Number(p.amount), 0),
      rewardAmount: parts.filter((p) => p.toAccountId !== null).reduce((s, p) => s + Number(p.amount), 0),
      pct: Number(stored.savings_pct),
      status: stored.status,
    };
  }
  const cfg = await taskConfig(db);
  const f = await closeFigures(db, month, cfg);
  if (!f) return null;
  return { ...f, ...surplusOf(f, cfg.surplusPct, cfg.rewardAccountId), pct: cfg.surplusPct, status: "ask" };
}

/** Chỉ chia / bỏ qua được tháng vừa hết (400 `invalid_month`); đã có dòng → 409 `month_closed`. */
async function closableMonth(db: D1Database, month: unknown, now: Date): Promise<string> {
  if (typeof month !== "string" || month !== prevMonth(monthKey(now))) fail("invalid_month", "Chỉ chia được tháng vừa hết.", 400, "month");
  if (await db.prepare("SELECT 1 FROM month_surplus WHERE month_key = ?").bind(month).first()) fail("month_closed", "Tháng này đã chia hoặc đã để lại Vận hành.", 409);
  return month as string;
}

const isConflict = (err: unknown) => /UNIQUE|PRIMARY KEY|month_closed/i.test(String(err));

const insertSurplus = (db: D1Database, f: CloseFigures, surplus: number, pct: number, status: "split" | "skipped", memberId: string | null, at: string) =>
  db
    .prepare(
      `INSERT INTO month_surplus (month_key, operating_end, pending_at_end, early_salary, held_payables, held_to_payday, surplus, savings_pct, status, by_member_id, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(f.month, f.operatingEnd, f.pendingAtEnd, f.earlySalary, f.heldPayables, f.heldToPayday, surplus, pct, status, memberId, at);

/**
 * `POST /v1/month-close { month, savings_pct? }` (UC-1207 AC-5): MỘT batch — INSERT `month_surplus` (khoá chính chặn hai máy
 * bấm đua; lượt thua → 409 `month_closed`, không tạo việc) + việc chia dư → Tích luỹ và → Ví Thưởng (khi có phần đó), mốc tự tick =
 * lúc bấm. Dư ≤ 0 → 409 `nothing_to_split`.
 */
export async function splitMonth(db: D1Database, body: Record<string, unknown>, memberId: string | null, now: Date): Promise<{ monthClose: MonthClose; audit: { action: AuditAction; detail: Record<string, unknown> } }> {
  const month = await closableMonth(db, body.month, now);
  const cfg = await taskConfig(db);
  let pct = cfg.surplusPct;
  if (body.savings_pct !== undefined && body.savings_pct !== null) {
    if (typeof body.savings_pct !== "number" || !Number.isInteger(body.savings_pct) || body.savings_pct < 0 || body.savings_pct > 100) {
      fail("invalid_input", "% vào Tích luỹ là số nguyên 0–100.", 400, "savings_pct");
    }
    pct = body.savings_pct as number;
  }
  const f = await closeFigures(db, month, cfg);
  const split = f ? surplusOf(f, pct, cfg.rewardAccountId) : null;
  if (!f || !split || split.surplus <= 0) return fail("nothing_to_split", "Tháng này không dư tiền để chia.", 409);
  const at = now.toISOString();
  const task = (toPocket: "savings" | null, toAccountId: string | null, amount: number) =>
    db
      .prepare("INSERT INTO month_tasks (kind, month_key, to_pocket, to_account_id, amount, pct, by_member_id, created_at, updated_at) VALUES ('surplus', ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(month, toPocket, toAccountId, amount, toPocket ? pct : null, memberId, at, at);
  try {
    await db.batch([
      insertSurplus(db, f, split.surplus, pct, "split", memberId, at),
      ...(split.savingsAmount > 0 ? [task("savings", null, split.savingsAmount)] : []),
      ...(split.rewardAmount > 0 ? [task(null, cfg.rewardAccountId, split.rewardAmount)] : []),
    ]);
  } catch (err) {
    if (isConflict(err)) fail("month_closed", "Tháng này đã chia hoặc đã để lại Vận hành.", 409);
    throw err;
  }
  await afterWrite(db);
  return {
    monthClose: (await monthCloseView(db, now))!,
    audit: { action: "month_close.split", detail: { month, surplus: split.surplus, savings_pct: pct, savings: split.savingsAmount, reward: split.rewardAmount } },
  };
}

/** `POST /v1/month-close/:month/skip` (UC-1207): "Để lại Vận hành" — lưu `skipped` với số lúc bấm, không việc, không cần lý do. */
export async function skipMonth(db: D1Database, monthParam: string, memberId: string | null, now: Date): Promise<{ monthClose: MonthClose; audit: { action: AuditAction; detail: Record<string, unknown> } }> {
  const month = await closableMonth(db, monthParam, now);
  const cfg = await taskConfig(db);
  const f = (await closeFigures(db, month, cfg)) ?? { month, operatingEnd: 0, pendingAtEnd: 0, earlySalary: 0, heldPayables: 0, heldToPayday: 0 };
  const { surplus } = surplusOf(f, cfg.surplusPct, cfg.rewardAccountId);
  try {
    await insertSurplus(db, f, surplus, cfg.surplusPct, "skipped", memberId, now.toISOString()).run();
  } catch (err) {
    if (isConflict(err)) fail("month_closed", "Tháng này đã chia hoặc đã để lại Vận hành.", 409);
    throw err;
  }
  return { monthClose: (await monthCloseView(db, now))!, audit: { action: "month_close.skip", detail: { month, surplus } } };
}

/**
 * `POST /v1/month-close/:month/reopen` (UC-1207 AC-7): Hoàn tác Chia / Để lại Vận hành — MỘT batch: void mọi việc chia dư của tháng
 * rồi xoá dòng `month_surplus` (trigger chỉ cho xoá khi không còn việc chia dư chưa void). Chỉ tháng vừa hết (400 `invalid_month`);
 * chưa bấm → 409 `month_open`; việc chia dư đã xong / bỏ qua / đã ghép chuyển khoản → 409 `month_task_started`, không đổi gì.
 */
export async function reopenMonth(db: D1Database, monthParam: string, now: Date): Promise<{ monthClose: MonthClose; audit: { action: AuditAction; detail: Record<string, unknown> } }> {
  if (monthParam !== prevMonth(monthKey(now))) fail("invalid_month", "Chỉ mở lại được tháng vừa hết.", 400, "month");
  const stored = await db.prepare("SELECT status, by_member_id AS byMember FROM month_surplus WHERE month_key = ?").bind(monthParam).first<{ status: string; byMember: string | null }>();
  if (!stored) fail("month_open", "Tháng này chưa chia, cũng chưa để lại Vận hành.", 409);
  // Dòng do migration ghi sẵn (tháng 10/2026 đã xử lý bằng cách cũ, không người bấm) không mở lại được.
  if (stored!.byMember === null) fail("month_closed", "Tháng này đã xử lý từ trước, không mở lại được.", 409);
  const started = await db
    .prepare(
      `SELECT 1 FROM month_tasks t WHERE t.kind = 'surplus' AND t.month_key = ? AND t.status <> 'void'
         AND (t.status <> 'open' OR EXISTS (SELECT 1 FROM month_task_tx l WHERE l.task_id = t.id))`,
    )
    .bind(monthParam)
    .first();
  if (started) fail("month_task_started", "Việc chia dư của tháng này đã bắt đầu chuyển, không mở lại được.", 409);
  const at = now.toISOString();
  try {
    await db.batch([
      // Việc vừa được ghép chuyển khoản giữa lúc kiểm và lúc ghi thì không void → trigger chặn xoá, cả batch huỷ.
      db
        .prepare(
          "UPDATE month_tasks SET status = 'void', updated_at = ? WHERE kind = 'surplus' AND month_key = ? AND status = 'open' AND NOT EXISTS (SELECT 1 FROM month_task_tx l WHERE l.task_id = month_tasks.id)",
        )
        .bind(at, monthParam),
      db.prepare("DELETE FROM month_surplus WHERE month_key = ?").bind(monthParam),
    ]);
  } catch (err) {
    // Máy khác vừa ghép chuyển khoản / tick việc giữa lúc kiểm và lúc ghi: trigger chặn xoá, cả batch huỷ.
    if (/month_closed/i.test(String(err))) fail("month_task_started", "Việc chia dư của tháng này đã bắt đầu chuyển, không mở lại được.", 409);
    throw err;
  }
  await afterWrite(db);
  return { monthClose: (await monthCloseView(db, now))!, audit: { action: "month_close.reopen", detail: { month: monthParam, was: stored!.status } } };
}

// ── Lương về sớm (ledger UC-103) ────────────────────────────────────

/** `nearSpend.salaryPayday`: đọc các khoản lương trong cửa sổ 7 ngày trước ngày lương sắp tới (`earlySalaryPayday`). */
export async function salaryPayday(db: D1Database, now: Date, paydayDay: number): Promise<string | null> {
  if (paydayDay <= EARLY_DAYS) return null;
  const today = dayKey(now);
  const upcoming = nextPayday(today, paydayDay);
  const res = await db
    .prepare("SELECT at FROM transactions WHERE status = 'active' AND meaning = 'income' AND is_salary = 1 AND at >= ? AND at < ? ORDER BY at")
    .bind(vnMidnight(addDays(upcoming, -EARLY_DAYS)), vnMidnight(upcoming))
    .all<{ at: string }>();
  return earlySalaryPayday(rows<{ at: string }>(res).map((r) => r.at), today, paydayDay);
}

// ── Tick tay, bỏ qua, sửa số (UC-1206) ──────────────────────────────

/** Việc còn hiệu lực, kèm số đã ghép; không có → 404, đã void → 409 `task_void`. */
async function liveTask(db: D1Database, id: number): Promise<TaskRow> {
  const t = await db.prepare(`${TASKS_SQL} WHERE k.id = ?`).bind(id).first<TaskRow>();
  if (!t) return fail("not_found", "Không có việc này.", 404);
  if (t.status === "void") fail("task_void", "Việc này huỷ do khoản lương đã huỷ hoặc không còn là lương.", 409);
  return taskRow(t);
}

const reasonOf = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return fail("invalid_input", "Lý do là chữ.", 400, "reason");
  const r = v.trim();
  if (r.length < 1 || r.length > 500) fail("invalid_input", "Lý do từ 1 đến 500 ký tự.", 400, "reason");
  return r;
};
const amountOf = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > TASK_AMOUNT_MAX) return fail("invalid_input", "Số tiền là số nguyên từ 0.", 400, "amount");
  return v;
};

export interface TaskActionResult {
  view: Omit<MonthView, "goalHint">;
  audit: { action: AuditAction; detail: Record<string, unknown> };
}

const viewAfter = async (db: D1Database, now: Date, memberId: string | null) => (await monthView(db, now, memberId)).view;

/**
 * `POST /v1/month-tasks/:id/done { amount? }`: tick tay chỉ đánh dấu xong — không ghi sổ, không cộng "đã trích". `earmark_id` →
 * 400 `model_changed`; chia dư → Ví Thưởng mà tài khoản đã tắt → 409 `goal_no_account`. `amount` (mặc định phần còn thiếu) chỉ
 * để ghi nhật ký.
 */
export async function markTaskDone(db: D1Database, id: number, b: Record<string, unknown>, memberId: string | null, now: Date): Promise<TaskActionResult> {
  if ("earmark_id" in b) throw new DomainError("model_changed", "Ví nhà v2 bỏ phần giữ riêng: bỏ trường earmark_id.", 400, undefined, ["earmark_id"]);
  const t = await liveTask(db, id);
  if (taskState(t, t.linked).state !== "open") fail("task_done", "Việc này đã xong hoặc đã bỏ qua.", 409);
  const amount = b.amount === undefined || b.amount === null ? t.amount - t.linked : amountOf(b.amount);
  if (t.to_account_id && !(await db.prepare("SELECT 1 FROM accounts WHERE id = ? AND active = 1").bind(t.to_account_id).first())) {
    fail("goal_no_account", "Tài khoản Ví Thưởng đã tắt, hãy chọn lại ở Cài đặt nhé.", 409);
  }
  await db.prepare("UPDATE month_tasks SET status = 'done', updated_at = ?, by_member_id = ? WHERE id = ? AND status = 'open'").bind(now.toISOString(), memberId, id).run();
  return { view: await viewAfter(db, now, memberId), audit: { action: "month_task.done", detail: { mode: "manual", amount } } };
}

/** `POST …/skip { reason? }`: ① bắt buộc lý do (ADR-112); việc chia dư không cần. */
export async function skipTask(db: D1Database, id: number, b: Record<string, unknown>, memberId: string | null, now: Date): Promise<TaskActionResult> {
  const t = await liveTask(db, id);
  const reason = reasonOf(b.reason);
  if (t.kind === "savings" && !reason) fail("reason_required", "Không trích tháng này cần ghi lý do.", 400, "reason");
  if (taskState(t, t.linked).state !== "open") fail("task_done", "Việc này đã xong hoặc đã bỏ qua.", 409);
  await db.prepare("UPDATE month_tasks SET status = 'skipped', reason = ?, updated_at = ?, by_member_id = ? WHERE id = ? AND status = 'open'").bind(reason, now.toISOString(), memberId, id).run();
  return { view: await viewAfter(db, now, memberId), audit: { action: "month_task.skip", detail: { reason } } };
}

/** `POST …/reopen`: gỡ tick tay hoặc bỏ "bỏ qua" — chỉ mở lại. */
export async function reopenTask(db: D1Database, id: number, memberId: string | null, now: Date): Promise<TaskActionResult> {
  const t = await liveTask(db, id);
  if (t.status === "open") fail("task_open", "Việc này đang mở.", 409);
  await db
    .prepare("UPDATE month_tasks SET status = 'open', reason = CASE WHEN amount = 0 THEN reason END, updated_at = ?, by_member_id = ? WHERE id = ?")
    .bind(now.toISOString(), memberId, id)
    .run();
  return { view: await viewAfter(db, now, memberId), audit: { action: "month_task.reopen", detail: {} } };
}

/** `PATCH /v1/month-tasks/:id { amount, reason? }`: ① về 0 cần lý do; số đã ghép ≥ số mới → việc xong (tự). */
export async function setTaskAmount(db: D1Database, id: number, b: Record<string, unknown>, memberId: string | null, now: Date): Promise<TaskActionResult> {
  const t = await liveTask(db, id);
  const amount = amountOf(b.amount);
  const reason = reasonOf(b.reason);
  if (t.kind === "savings" && amount === 0 && !reason) fail("reason_required", "Không trích tháng này cần ghi lý do.", 400, "reason");
  // ①: ghi lại % đã chọn = ⌊số × 100 ÷ khoản lương⌋, kẹp ≤ 100 theo CHECK của cột (ADR-142).
  await db
    .prepare(
      `UPDATE month_tasks SET amount = ?1, reason = COALESCE(?2, reason), by_member_id = ?3, updated_at = ?5,
         pct = CASE WHEN kind = 'savings' AND (SELECT amount FROM transactions WHERE id = income_tx_id) > 0
                    THEN MIN(100, CAST(?1 * 100 / (SELECT amount FROM transactions WHERE id = income_tx_id) AS INTEGER)) ELSE pct END
       WHERE id = ?4`,
    )
    .bind(amount, reason, memberId, id, now.toISOString())
    .run();
  return { view: await viewAfter(db, now, memberId), audit: { action: "month_task.amount", detail: { from: t.amount, to: amount, reason } } };
}

