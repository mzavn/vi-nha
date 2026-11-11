// Kỳ lương và danh sách việc ngày lương trên D1 (pocket UC-1205, UC-1206, UC-1207 — ADR-124, ADR-125, ADR-132).
// Ghi khoản thu + kỳ + việc trong MỘT batch; ghép chuyển khoản vào việc ngay sau mỗi lần ghi (làm lại nhiều lần không
// sai); huỷ giao dịch kéo theo kỳ / việc gắn nó. Mục tiêu Dự phòng là tài khoản thật: A = số dư tài khoản, không sổ riêng.
// Nhập tay, Gán, ingest, MCP đều đi qua đây.

import type { AuditAction } from "../domain/audit-actions";
import type { TxRow } from "../domain/entry";
import {
  DEFAULT_SURPLUS_SAVINGS_PCT,
  TASK_AMOUNT_MAX,
  allocateTransfer,
  cycleDecision,
  incomeTasks,
  lateDays,
  nominalPayday,
  openingTasks,
  pendingTasks,
  savingsDone,
  taskState,
  type GoalInput,
  type MatchTask,
  type PayCycleTask,
  type PayCycleView,
  type QrTarget,
  type TaskDraft,
  type TaskFigures,
  type TaskKind,
  type TaskStatus,
} from "../domain/pay-cycle";
import { dayKey } from "../domain/period";
import { DEFAULT_SAVINGS_PCT, goalOrder, type Pocket } from "../domain/pockets";
import { DEFAULT_PAYDAY_DAY, nextPayday } from "../domain/snapshot";
import { DomainError, type Refs } from "../domain/types";
import { goalFill } from "./pockets";
import { hiddenAccountIds, txVisibility } from "./privacy";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400, field?: string): never => {
  throw new DomainError(code, message, status, field);
};
/** Id của khoản vừa chèn ở câu INSERT transactions đứng ngay trước trong cùng batch (batch là một transaction). */
const NEW_TX = "(SELECT MAX(id) FROM transactions)";

interface CycleRow {
  id: number;
  income_tx_id: number;
  started_at: string;
  payday: string;
  prev_operating: number;
}

/** Kỳ hiện tại = kỳ active có ngày lương lớn nhất; `excludeIncomeTxId`: coi như kỳ do khoản đó mở đã huỷ (sửa khoản lương). */
export async function currentCycle(db: D1Database, excludeIncomeTxId: number | null = null): Promise<CycleRow | null> {
  return db
    .prepare("SELECT id, income_tx_id, started_at, payday, prev_operating FROM pay_cycles WHERE status = 'active' AND income_tx_id IS NOT ? ORDER BY payday DESC LIMIT 1")
    .bind(excludeIncomeTxId)
    .first<CycleRow>();
}

interface CycleConfig {
  paydayDay: number;
  savingsPct: number;
  surplusPct: number;
  /** Ví Thưởng: chỉ khi trỏ tài khoản đang dùng ngăn Dự phòng, không gắn mục tiêu đang dùng. */
  rewardAccountId: string | null;
}

export async function cycleConfig(db: D1Database): Promise<CycleConfig> {
  const res = await db
    .prepare(
      `SELECT k, v FROM config WHERE k IN ('payday_day', 'savings_pct', 'surplus_savings_pct')
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
    rewardAccountId: c.surplus_reward_account ?? null,
  };
}

/**
 * Mục tiêu Dự phòng đang dùng ĐÃ GẮN tài khoản (đang dùng), theo thứ tự ưu tiên (`goalOrder`), A = phần của mục tiêu khi
 * chia số dư tài khoản (`fillGoals`) = đã có + đã chi từ `since` (đầu kỳ) — khoản đã chi cho mục tiêu trong kỳ đã dùng phần
 * của nó, không cần nạp lại (UC-1206 bước 3, AC-14). Mục tiêu chưa gắn không sinh việc.
 */
async function activeGoals(db: D1Database, since: string): Promise<GoalInput[]> {
  const { inputs, active, filled } = await goalFill(db, since);
  return inputs
    .filter((g) => active.has(g.id) && filled.has(g.id))
    .sort(goalOrder)
    .map((g) => {
      const f = filled.get(g.id)!;
      return { id: g.id, held: f.held + f.spent, target: g.target, targetPct: g.targetPct, monthly: g.monthly, dueDate: g.dueDate };
    });
}

/**
 * Dư kỳ trước tại thời điểm `at` (UC-1207 bước 1): Σ tài khoản ngăn Vận hành (đang dùng, hoặc tắt sau ngày của `at`) của
 * (số dư đầu + giao dịch còn hiệu lực có thời điểm < `at`). Theo sổ, không theo lúc ghi: log lương về muộn không làm dư sai.
 */
export async function prevOperatingAt(db: D1Database, at: string, excludeTxId: number | null = null): Promise<number> {
  const ops = "SELECT id FROM accounts WHERE pocket = 'operating' AND (active = 1 OR deactivated_at > ?2)";
  const row = await db
    .prepare(
      `SELECT COALESCE((SELECT SUM(opening_balance) FROM accounts WHERE id IN (${ops})), 0)
            + COALESCE((SELECT SUM(CASE WHEN t.counter_account_id IN (${ops}) THEN t.amount ELSE 0 END - CASE WHEN t.account_id IN (${ops}) THEN t.amount ELSE 0 END)
                        FROM transactions t WHERE t.status = 'active' AND t.at < ?1 AND t.id IS NOT ?3), 0) AS n`,
    )
    .bind(at, dayKey(at), excludeTxId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/**
 * "Mở kỳ lương" của một khoản sắp ghi (UC-1205 bước 2): mặc định = cờ của nguồn; gửi `requested` để ghi đè. Không bao giờ
 * mở kỳ: khoản thu người thuê, nguồn cho thuê (gửi true → 400 `cannot_open_cycle`); khoản không phải thu nhập (true →
 * 400 `invalid_input`).
 */
export function resolveOpensCycle(refs: Pick<Refs, "incomeStreams" | "rentalIncomeStreamId">, row: Pick<TxRow, "meaning" | "tenant_id" | "income_stream_id">, requested: unknown): boolean {
  if (requested !== undefined && requested !== null && typeof requested !== "boolean") fail("invalid_input", "opens_cycle là true hoặc false.", 400, "opens_cycle");
  if (row.meaning !== "income") {
    if (requested === true) fail("invalid_input", "Mở kỳ lương chỉ dùng cho khoản thu nhập.", 400, "opens_cycle");
    return false;
  }
  const rental = Boolean(row.tenant_id) || (refs.rentalIncomeStreamId !== null && row.income_stream_id === refs.rentalIncomeStreamId);
  if (rental) {
    if (requested === true) fail("cannot_open_cycle", "Tiền thuê nhà không mở kỳ lương.", 400, "opens_cycle");
    return false;
  }
  if (typeof requested === "boolean") return requested;
  return refs.incomeStreams.find((s) => s.id === row.income_stream_id)?.opensCycle ?? false;
}

/** Việc / kỳ mà một khoản thu sắp ghi sinh ra — để phản hồi nói "Kỳ lương mới từ 10/11 · 5 việc". */
export interface IncomePlan {
  decision: "open" | "join" | "skip" | "attach" | "none";
  payday: string | null;
  startedAt: string | null;
  tasks: number;
}

/**
 * Các câu chèn kỳ + việc của một khoản thu, đặt NGAY SAU câu INSERT khoản thu trong cùng batch (UC-1205 bước 5). Kỳ chèn
 * `INSERT OR IGNORE` theo index ngày lương: khoản thua cuộc đua nhập vào kỳ đã có; việc ② cố định và ④ chỉ chèn khi kỳ của
 * ngày lương đó do chính khoản này mở. `guardTxId`: sửa khoản (ADR-73) — mọi câu chỉ chạy khi khoản cũ còn hiệu lực trong
 * batch (câu INSERT có điều kiện của khoản mới), `excludeTxId`: khoản cũ đang được thay (kỳ nó mở coi như đã huỷ, sổ không
 * tính nó vào dư kỳ trước).
 */
export async function incomeStatements(
  db: D1Database,
  refs: Pick<Refs, "accounts" | "incomeStreams">,
  row: TxRow,
  opts: { opensCycle: boolean; interest?: boolean; excludeTxId?: number | null; guardTxId?: number | null; memberId: string | null },
): Promise<{ statements: D1PreparedStatement[]; plan: IncomePlan }> {
  const none = { statements: [], plan: { decision: "none" as const, payday: null, startedAt: null, tasks: 0 } };
  if (row.meaning !== "income") return none;
  const cfg = await cycleConfig(db);
  const cur = await currentCycle(db, opts.excludeTxId ?? null);
  const stream = row.income_stream_id ? refs.incomeStreams.find((s) => s.id === row.income_stream_id) : undefined;
  const income = {
    amount: row.amount,
    taxable: row.taxable === 1,
    salary: opts.opensCycle,
    interest: opts.interest === true,
    accountPocket: (refs.accounts.find((a) => a.id === row.counter_account_id)?.pocket ?? null) as Pocket | null,
    streamPocket: (stream?.pocket ?? null) as Pocket | null,
  };
  const guard = opts.guardTxId ? ` AND EXISTS (SELECT 1 FROM transactions WHERE id = ${Number(opts.guardTxId)} AND status = 'active')` : "";
  const insertTask = (t: TaskDraft, where: string, binds: unknown[]) =>
    db
      .prepare(
        `INSERT INTO pay_cycle_tasks (cycle_id, kind, source_tx_id, goal_id, to_account_id, to_pocket, pct, suggested, amount, by_member_id)
         SELECT c.id, ?, ${t.fromIncome ? NEW_TX : "NULL"}, ?, ?, ?, ?, ?, ?, ? FROM pay_cycles c WHERE c.status = 'active' AND ${where}${guard}`,
      )
      .bind(t.kind, t.goalId, t.toAccountId, t.toPocket, t.pct, t.amount, t.amount, opts.memberId, ...binds);

  if (!opts.opensCycle) {
    if (!cur || row.at < cur.started_at) return none;
    const drafts = incomeTasks(income, cfg.savingsPct, await activeGoals(db, cur.started_at));
    return {
      statements: drafts.map((t) => insertTask(t, "c.id = ?", [cur.id])),
      plan: { decision: "attach", payday: cur.payday, startedAt: cur.started_at, tasks: drafts.length },
    };
  }
  const payday = nominalPayday(dayKey(row.at), cfg.paydayDay);
  const decision = cycleDecision(cur?.payday ?? null, payday);
  if (decision === "skip") return { statements: [], plan: { decision, payday, startedAt: null, tasks: 0 } };
  if (decision === "join") {
    const drafts = incomeTasks(income, cfg.savingsPct, await activeGoals(db, cur!.started_at));
    return {
      statements: drafts.map((t) => insertTask(t, "c.payday = ?", [payday])),
      plan: { decision, payday, startedAt: cur!.started_at, tasks: drafts.length },
    };
  }
  const prev = await prevOperatingAt(db, row.at, opts.excludeTxId ?? null);
  // A lúc mở kỳ: đã chi cho mục tiêu tính từ lúc khoản lương này mở kỳ (`started_at = row.at`, UC-1206 bước 3).
  const goals = await activeGoals(db, row.at);
  const drafts = openingTasks(income, { savingsPct: cfg.savingsPct, goals, cyclePayday: payday, paydayDay: cfg.paydayDay, prevOperating: prev, surplusPct: cfg.surplusPct, rewardAccountId: cfg.rewardAccountId });
  return {
    statements: [
      db
        .prepare(`INSERT OR IGNORE INTO pay_cycles (income_tx_id, started_at, payday, prev_operating) SELECT ${NEW_TX}, ?, ?, ? WHERE 1${guard}`)
        .bind(row.at, payday, prev),
      ...drafts.map((t) => (t.fromIncome ? insertTask(t, "c.payday = ?", [payday]) : insertTask(t, `c.payday = ? AND c.income_tx_id = ${NEW_TX}`, [payday]))),
    ],
    plan: { decision, payday, startedAt: row.at, tasks: drafts.length },
  };
}

/**
 * Câu huỷ kèm theo khi huỷ / sửa / gỡ gán các giao dịch `txIds` (đặt TRƯỚC câu ghi mới trong batch): khoản lương mở kỳ → kỳ
 * và mọi việc của nó `void`; việc sinh từ khoản đó → `void`; khoản thu cũ đã chia → `fund` cùng lô `void` (kể cả khi lô có
 * lệnh đã chuyển, ADR-123). Liên kết của việc `void` tự nhả (phần đã dùng chỉ đếm việc chưa `void`).
 */
export async function voidTxStatements(db: D1Database, txIds: number[]): Promise<D1PreparedStatement[]> {
  if (txIds.length === 0) return [];
  const marks = txIds.map(() => "?").join(", ");
  return [
    db.prepare(`UPDATE pay_cycle_tasks SET status = 'void' WHERE status <> 'void' AND (source_tx_id IN (${marks}) OR cycle_id IN (SELECT id FROM pay_cycles WHERE status = 'active' AND income_tx_id IN (${marks})))`).bind(...txIds, ...txIds),
    db.prepare(`UPDATE pay_cycles SET status = 'void' WHERE status = 'active' AND income_tx_id IN (${marks})`).bind(...txIds),
    db
      .prepare(`UPDATE transactions SET status = 'void' WHERE status = 'active' AND meaning = 'fund' AND batch_id IN (SELECT batch_id FROM allocation_runs WHERE income_tx_id IN (${marks}))`)
      .bind(...txIds),
  ];
}

// ── Ghép chuyển khoản vào việc (UC-1206 bước 5–6) ───────────────────

interface TaskRow {
  id: number;
  cycle_id: number;
  kind: TaskKind;
  source_tx_id: number | null;
  goal_id: string | null;
  to_account_id: string | null;
  to_pocket: Pocket | null;
  pct: number | null;
  suggested: number;
  amount: number;
  status: TaskStatus;
  reason: string | null;
  done_at: string | null;
  linked: number;
  last_tx_at: string | null;
}

const TASKS_SQL = `SELECT k.*, COALESCE((SELECT SUM(x.amount) FROM pay_cycle_task_tx x JOIN transactions t ON t.id = x.tx_id AND t.status = 'active' WHERE x.task_id = k.id), 0) AS linked,
    (SELECT MAX(t.at) FROM pay_cycle_task_tx x JOIN transactions t ON t.id = x.tx_id AND t.status = 'active' WHERE x.task_id = k.id) AS last_tx_at
  FROM pay_cycle_tasks k`;

const taskRow = (t: TaskRow): TaskRow => ({ ...t, amount: Number(t.amount), linked: Number(t.linked) });

async function cycleTasks(db: D1Database, cycleId: number): Promise<TaskRow[]> {
  return rows<TaskRow>(await db.prepare(`${TASKS_SQL} WHERE k.cycle_id = ? AND k.status <> 'void' ORDER BY k.id`).bind(cycleId).all()).map(taskRow);
}

interface GoalRow {
  id: string;
  name: string;
  target: number | null;
  /** Tài khoản đích của ②: tài khoản đang dùng của mục tiêu đang dùng; null = đã bỏ gắn / mục tiêu đã tắt. */
  accountId: string | null;
  /** Số dư sổ của tài khoản đó; null khi không có tài khoản. */
  held: number | null;
}

/** Mọi mục tiêu (cả đã tắt — việc cũ vẫn trỏ tới), kèm tài khoản đích và A hiện tại (đã chia, đã chi từ `since`). */
async function goalRows(db: D1Database, since: string): Promise<Map<string, GoalRow>> {
  const { inputs, active, filled, rows: raw } = await goalFill(db, since);
  const balanceOf = new Map(raw.map((r) => [String(r.id), r.balance]));
  return new Map(
    inputs.map((g) => {
      const f = filled.get(g.id);
      const linked = active.has(g.id) && g.accountId !== null && balanceOf.get(g.id) !== null;
      return [g.id, { id: g.id, name: g.name, target: g.target, accountId: linked ? g.accountId : null, held: f ? f.held : null }];
    }),
  );
}

/** Tài khoản đích của một việc: ② → tài khoản của mục tiêu (đọc lúc này), ④ → Ví Thưởng → `to_account_id`; còn lại null. */
const targetAccountOf = (t: Pick<TaskRow, "kind" | "goal_id" | "to_account_id">, goals: Map<string, GoalRow>): string | null =>
  t.kind === "goal" ? (t.goal_id ? goals.get(t.goal_id)?.accountId ?? null : null) : t.to_account_id;

/** Phần đã dùng của một chuyển khoản: Σ liên kết của các việc chưa `void` (việc `void` nhả hết liên kết). */
const USED_SQL = (tx: string) => `COALESCE((SELECT SUM(x.amount) FROM pay_cycle_task_tx x JOIN pay_cycle_tasks k ON k.id = x.task_id
    WHERE x.tx_id = ${tx} AND k.status <> 'void'), 0)`;

/**
 * Câu ghi một liên kết việc ← chuyển khoản (UC-1206 bước 5): chỉ thành khi, TẠI LÚC GHI, chuyển khoản còn đủ phần chưa dùng
 * và việc còn mở, chưa nhận đủ — Σ liên kết của các chuyển khoản còn hiệu lực (như `linked` của `TASKS_SQL`) cộng phần mới
 * ≤ số tiền việc (số `taskState` dùng). Lần ghép song song tính từ trạng thái cũ thì không ghi dòng nào (UC-1206 AC-11).
 */
export function linkTaskStatement(db: D1Database, taskId: number, txId: number, amount: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO pay_cycle_task_tx (task_id, tx_id, amount) SELECT ?1, ?2, ?3
       WHERE EXISTS (SELECT 1 FROM pay_cycle_tasks WHERE id = ?1 AND status = 'open')
         AND (SELECT amount FROM transactions WHERE id = ?2 AND status = 'active') >= ${USED_SQL("?2")} + ?3
         AND COALESCE((SELECT SUM(x.amount) FROM pay_cycle_task_tx x JOIN transactions t ON t.id = x.tx_id AND t.status = 'active' WHERE x.task_id = ?1), 0) + ?3
           <= (SELECT amount FROM pay_cycle_tasks WHERE id = ?1)`,
    )
    .bind(taskId, txId, amount);
}

/**
 * Ghép mọi chuyển khoản nội bộ S → D (thời điểm ≥ lúc mở kỳ, còn phần chưa dùng) vào việc đang mở của kỳ hiện tại, theo thời
 * gian rồi theo thứ tự việc (`allocateTransfer`). Chỉ ghi liên kết, không dòng sổ nào: A của mục tiêu là số dư tài khoản. Câu
 * ghi có điều kiện (`linkTaskStatement`). Trả các việc vừa tự xong.
 */
export async function afterWrite(db: D1Database): Promise<{ tasksDone: { id: number; kind: TaskKind }[] }> {
  const cur = await currentCycle(db);
  if (!cur) return { tasksDone: [] };
  const tasks = await cycleTasks(db, cur.id);
  const goals = tasks.some((t) => t.kind === "goal") ? await goalRows(db, cur.started_at) : new Map<string, GoalRow>();
  const open: MatchTask[] = tasks
    .map((t) => ({ t, s: taskState(t, t.linked) }))
    .filter(({ s }) => s.state === "open")
    .map(({ t, s }) => {
      const toAccountId = targetAccountOf(t, goals);
      return { id: t.id, toPocket: t.kind === "goal" || t.to_account_id ? null : t.to_pocket, toAccountId, missing: s.missing };
    });
  if (open.length === 0) return { tasksDone: [] };
  const transfers = rows<{ id: number; amount: number; used: number; fromId: string; fromPocket: Pocket | null; toId: string; toPocket: Pocket | null }>(
    await db
      .prepare(
        `SELECT t.id, t.amount, ${USED_SQL("t.id")} AS used, fa.id AS fromId, fa.pocket AS fromPocket, ta.id AS toId, ta.pocket AS toPocket
         FROM transactions t JOIN accounts fa ON fa.id = t.account_id JOIN accounts ta ON ta.id = t.counter_account_id
         WHERE t.status = 'active' AND t.meaning = 'transfer' AND t.at >= ? ORDER BY t.at, t.id`,
      )
      .bind(cur.started_at)
      .all(),
  );
  const statements: D1PreparedStatement[] = [];
  for (const tr of transfers) {
    const links = allocateTransfer(open, {
      from: { id: tr.fromId, pocket: tr.fromPocket },
      to: { id: tr.toId, pocket: tr.toPocket },
      available: Number(tr.amount) - Number(tr.used),
    });
    for (const l of links) {
      open.find((t) => t.id === l.taskId)!.missing -= l.amount;
      statements.push(linkTaskStatement(db, l.taskId, tr.id, l.amount));
    }
  }
  if (statements.length === 0) return { tasksDone: [] };
  await db.batch(statements);
  const after = await cycleTasks(db, cur.id);
  const wasOpen = new Set(open.map((t) => t.id));
  return { tasksDone: after.filter((t) => wasOpen.has(t.id) && taskState(t, t.linked).state === "done").map((t) => ({ id: t.id, kind: t.kind })) };
}

// ── snapshot.payCycle ───────────────────────────────────────────────

/**
 * Kỳ hiện tại để dựng snapshot: view + phần chưa làm (ledger UC-103). `viewerId`: người xem — khoản thu của việc bị giấu với
 * người đó → `source: { hidden: true }` (access UC-504 AC-18); `null` = cron, mọi tài khoản riêng tư có chủ còn hoạt động bị giấu.
 */
export async function payCycleView(
  db: D1Database,
  today: string,
  viewerId: string | null,
): Promise<{ view: PayCycleView | null; pendingTasks: number; hasCycleStream: boolean; prevStartedAt: string | null }> {
  const hasCycleStream = Boolean(await db.prepare("SELECT 1 FROM income_streams WHERE active = 1 AND opens_cycle = 1").first());
  const cur = await currentCycle(db);
  if (!cur) return { view: null, pendingTasks: 0, hasCycleStream, prevStartedAt: null };
  const cfg = await cycleConfig(db);
  const [tasks, goals, accounts, sources, prev, hidden] = await Promise.all([
    cycleTasks(db, cur.id),
    goalRows(db, cur.started_at),
    db
      .prepare("SELECT id, name, bank, account_no AS accountNo, sub_account AS subAccount, pocket, active FROM accounts ORDER BY kind, name")
      .all<{ id: string; name: string; bank: string | null; accountNo: string | null; subAccount: string | null; pocket: Pocket | null; active: number }>(),
    db
      .prepare(
        `SELECT t.id, t.amount, t.at, t.counter_account_id AS accountId, s.name AS streamName FROM transactions t LEFT JOIN income_streams s ON s.id = t.income_stream_id
         WHERE t.id = ? OR t.id IN (SELECT source_tx_id FROM pay_cycle_tasks WHERE cycle_id = ?)`,
      )
      .bind(cur.income_tx_id, cur.id)
      .all<{ id: number; amount: number; at: string; accountId: string | null; streamName: string | null }>(),
    db.prepare("SELECT started_at FROM pay_cycles WHERE status = 'active' AND payday < ? ORDER BY payday DESC LIMIT 1").bind(cur.payday).first<{ started_at: string }>(),
    hiddenAccountIds(db, viewerId),
  ]);
  const accountList = rows<{ id: string; name: string; bank: string | null; accountNo: string | null; subAccount: string | null; pocket: Pocket | null; active: number }>(accounts).filter((a) => a.active === 1);
  const sourceOf = new Map(rows<{ id: number; amount: number; at: string; accountId: string | null; streamName: string | null }>(sources).map((s) => [s.id, s]));
  const qr = (list: typeof accountList): QrTarget[] =>
    list.filter((a) => a.accountNo).map((a) => ({ accountId: a.id, name: a.name, bank: a.bank, accountNo: a.accountNo!, subAccount: a.subAccount }));
  const figures: TaskFigures[] = tasks.map((t) => ({
    kind: t.kind,
    status: t.status,
    amount: t.amount,
    linked: t.linked,
    sourceAmount: t.source_tx_id ? Number(sourceOf.get(t.source_tx_id)?.amount ?? 0) : null,
    toPocket: t.to_pocket,
  }));
  const view: PayCycleTask[] = tasks.map((t) => {
    const s = taskState(t, t.linked);
    const g = t.goal_id ? goals.get(t.goal_id) ?? null : null;
    const src = t.source_tx_id ? sourceOf.get(t.source_tx_id) : undefined;
    const toAccountId = targetAccountOf(t, goals);
    const byAccount = t.kind === "goal" || t.to_account_id !== null;
    const targetAccounts = byAccount ? accountList.filter((a) => a.id === toAccountId) : accountList.filter((a) => a.pocket === t.to_pocket);
    return {
      id: t.id,
      kind: t.kind,
      status: s.state as PayCycleTask["status"],
      auto: s.auto,
      suggested: Number(t.suggested),
      amount: t.amount,
      linked: t.linked,
      missing: s.missing,
      pct: t.pct,
      reason: t.reason,
      toPocket: t.to_pocket,
      goal: g ? { id: g.id, name: g.name, held: g.held, target: g.target, accountId: g.accountId } : null,
      toAccountId,
      source: !src
        ? null
        : txVisibility({ counter_account_id: src.accountId }, hidden) === "hidden"
          ? { hidden: true }
          : { txId: Number(src.id), amount: Number(src.amount), at: src.at, streamName: src.streamName },
      doneAt: t.done_at,
      lastTxAt: t.last_tx_at,
      targets: qr(targetAccounts),
      targetName: targetAccounts[0]?.name ?? null,
    };
  });
  const salaryPocket = accountList.find((a) => a.id === sourceOf.get(cur.income_tx_id)?.accountId)?.pocket ?? null;
  return {
    view: {
      id: cur.id,
      startedAt: cur.started_at,
      payday: cur.payday,
      nextPayday: nextPayday(cur.payday, cfg.paydayDay),
      lateDays: lateDays(cur.payday, today, cfg.paydayDay),
      prevOperating: Number(cur.prev_operating),
      tasks: view,
      openCount: view.filter((t) => t.status === "open").length,
      savingsDone: savingsDone(figures),
    },
    pendingTasks: pendingTasks(figures, salaryPocket),
    hasCycleStream,
    prevStartedAt: prev?.started_at ?? null,
  };
}

// ── Tick tay, bỏ qua, sửa số (UC-1206 bước 7–8) ─────────────────────

/** Việc của kỳ hiện tại còn hiệu lực, kèm số đã ghép; không có → 404, kỳ khác / void → 409 `cycle_closed`. */
async function liveTask(db: D1Database, id: number): Promise<TaskRow> {
  const t = await db.prepare(`${TASKS_SQL} WHERE k.id = ?`).bind(id).first<TaskRow>();
  if (!t) return fail("not_found", "Không có việc này.", 404);
  const cur = await currentCycle(db);
  if (t.status === "void" || !cur || cur.id !== t.cycle_id) fail("cycle_closed", "Việc này thuộc kỳ lương đã qua hoặc đã huỷ.", 409);
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
  view: PayCycleView | null;
  audit: { action: AuditAction; detail: Record<string, unknown> };
}

/** View sau khi tick / bỏ qua / sửa, nhìn như người làm (`memberId`). */
async function viewAfter(db: D1Database, now: Date, memberId: string | null): Promise<PayCycleView | null> {
  return (await payCycleView(db, dayKey(now), memberId)).view;
}

/**
 * `POST /v1/pay-cycle-tasks/:id/done { amount? }`: mọi loại việc tick tay chỉ đánh dấu xong (UC-1206 bước 7) — không ghi
 * sổ, không cộng `savingsDone`. `earmark_id` → 400 `model_changed`; ② mà mục tiêu đã bỏ gắn tài khoản / ④ → Ví Thưởng mà
 * tài khoản đã tắt → 409 `goal_no_account`. `amount` (mặc định phần còn thiếu) chỉ để ghi nhật ký.
 */
export async function markTaskDone(db: D1Database, id: number, b: Record<string, unknown>, memberId: string | null, now: Date): Promise<TaskActionResult> {
  if ("earmark_id" in b) throw new DomainError("model_changed", "Ví nhà v2 bỏ phần giữ riêng: bỏ trường earmark_id.", 400, undefined, ["earmark_id"]);
  const t = await liveTask(db, id);
  if (taskState(t, t.linked).state !== "open") fail("task_done", "Việc này đã xong hoặc đã bỏ qua.", 409);
  const amount = b.amount === undefined || b.amount === null ? t.amount - t.linked : amountOf(b.amount);
  if (t.kind === "goal") {
    // Chỉ cần tài khoản đích của mục tiêu (đã chi không đổi tài khoản): mốc đã chi lấy lúc này.
    const goal = t.goal_id ? (await goalRows(db, now.toISOString())).get(t.goal_id) : undefined;
    if (!goal?.accountId) fail("goal_no_account", "Mục tiêu này chưa gắn tài khoản: gắn một tài khoản Dự phòng ở Cài đặt trước.", 409);
  } else if (t.kind === "surplus" && t.to_account_id) {
    const ok = await db.prepare("SELECT 1 FROM accounts WHERE id = ? AND active = 1").bind(t.to_account_id).first();
    if (!ok) fail("goal_no_account", "Tài khoản Ví Thưởng đã tắt: chọn lại Ví Thưởng ở Cài đặt.", 409);
  }
  await db.prepare("UPDATE pay_cycle_tasks SET status = 'done', done_at = ?, by_member_id = ? WHERE id = ? AND status = 'open'").bind(now.toISOString(), memberId, id).run();
  return { view: await viewAfter(db, now, memberId), audit: { action: "pay_cycle_task.done", detail: { mode: "manual", amount } } };
}

/** `POST …/skip { reason? }`: ① bắt buộc lý do (ADR-112); việc khác không cần. */
export async function skipTask(db: D1Database, id: number, b: Record<string, unknown>, memberId: string | null, now: Date): Promise<TaskActionResult> {
  const t = await liveTask(db, id);
  const reason = reasonOf(b.reason);
  if (t.kind === "savings" && !reason) fail("reason_required", "Không trích kỳ này cần ghi lý do.", 400, "reason");
  if (taskState(t, t.linked).state !== "open") fail("task_done", "Việc này đã xong hoặc đã bỏ qua.", 409);
  await db.prepare("UPDATE pay_cycle_tasks SET status = 'skipped', reason = ?, done_at = ?, by_member_id = ? WHERE id = ? AND status = 'open'").bind(reason, now.toISOString(), memberId, id).run();
  return { view: await viewAfter(db, now, memberId), audit: { action: "pay_cycle_task.skip", detail: { reason } } };
}

/** `POST …/reopen`: gỡ tick tay hoặc bỏ "bỏ qua" — chỉ mở lại. */
export async function reopenTask(db: D1Database, id: number, memberId: string | null, now: Date): Promise<TaskActionResult> {
  const t = await liveTask(db, id);
  if (t.status === "open") fail("task_open", "Việc này đang mở.", 409);
  await db.prepare("UPDATE pay_cycle_tasks SET status = 'open', reason = CASE WHEN amount = 0 THEN reason END, done_at = NULL, by_member_id = ? WHERE id = ?").bind(memberId, id).run();
  return { view: await viewAfter(db, now, memberId), audit: { action: "pay_cycle_task.reopen", detail: {} } };
}

/** `PATCH /v1/pay-cycle-tasks/:id { amount, reason? }`: ① về 0 cần lý do; số đã ghép ≥ số mới → việc xong (tự). */
export async function setTaskAmount(db: D1Database, id: number, b: Record<string, unknown>, memberId: string | null, now: Date): Promise<TaskActionResult> {
  const t = await liveTask(db, id);
  const amount = amountOf(b.amount);
  const reason = reasonOf(b.reason);
  if (t.kind === "savings" && amount === 0 && !reason) fail("reason_required", "Không trích kỳ này cần ghi lý do.", 400, "reason");
  await db.prepare("UPDATE pay_cycle_tasks SET amount = ?, reason = COALESCE(?, reason), by_member_id = ? WHERE id = ?").bind(amount, reason, memberId, id).run();
  return { view: await viewAfter(db, now, memberId), audit: { action: "pay_cycle_task.amount", detail: { from: t.amount, to: amount, reason } } };
}
