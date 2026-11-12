// Kỳ lương và danh sách việc ngày lương (pocket UC-1205, UC-1206, UC-1207 — ADR-124). Hàm thuần: server tính việc lúc kỳ
// mở / khoản thu nhập vào kỳ, ghép chuyển khoản vào việc, dựng `snapshot.payCycle`; PWA dùng lại kiểu và chữ.

import type { Pocket } from "./pockets";
import { nextPayday, paydayIn } from "./snapshot";

export const TASK_KINDS = ["savings", "goal", "move", "surplus"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskStatus = "open" | "done" | "skipped" | "void";
/** Trần số tiền của một việc (đồng). */
export const TASK_AMOUNT_MAX = 1e12;
/** Cửa sổ lương về sớm (ngày). */
export const EARLY_DAYS = 7;
/** % dư kỳ trước vào Tích luỹ khi chưa đặt (config `surplus_savings_pct`). */
export const DEFAULT_SURPLUS_SAVINGS_PCT = 50;

const DAY_MS = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Làm tròn lên bội 1.000 đồng. */
const ceil1000 = (n: number) => Math.ceil(n / 1000) * 1000;

/**
 * Ngày lương danh nghĩa của một khoản lương về ngày `day` (giờ VN): ngày lương muộn nhất ≤ `day` + 7, kẹp cuối tháng như
 * `nextPayday` (UC-1205 bước 3).
 */
export function nominalPayday(day: string, paydayDay: number): string {
  const limit = addDays(day, EARLY_DAYS);
  const [y, m] = limit.split("-").map(Number) as [number, number];
  const p = ymd(paydayIn(y, m - 1, paydayDay));
  return p <= limit ? p : ymd(paydayIn(y, m - 2, paydayDay));
}

/** Mở kỳ mới · nhập vào kỳ hiện tại · ghi lùi ngày (không kỳ, không việc). */
export type CycleDecision = "open" | "join" | "skip";
export function cycleDecision(currentPayday: string | null, payday: string): CycleDecision {
  if (currentPayday === null || payday > currentPayday) return "open";
  return payday === currentPayday ? "join" : "skip";
}

/** Số ngày lương trễ (UC-1205 bước 6): hôm nay sau ngày lương kế tiếp của kỳ hiện tại mà chưa có kỳ mới. */
export function lateDays(cyclePayday: string, today: string, paydayDay: number): number {
  const next = nextPayday(cyclePayday, paydayDay);
  return today > next ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${next}T00:00:00Z`)) / DAY_MS) : 0;
}

// ── Mốc kỳ (ledger UC-108 bước 1, ADR-127) ──────────────────────────

/** Một kỳ lương: `[start, end)` theo `at` (ISO UTC); `end` null = đang chạy; `stored` = kỳ đã lưu ở `pay_cycles`. */
export interface CycleRange {
  payday: string;
  start: string;
  end: string | null;
  stored: boolean;
}

/** 00:00 giờ VN của ngày `day` (ISO UTC). */
export const vnMidnight = (day: string) => new Date(`${day}T00:00:00+07:00`).toISOString();
/** Ngày VN của một thời điểm ISO. */
const vnDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Ngày lương danh nghĩa gần nhất ≤ `day`. */
function paydayOnOrBefore(day: string, paydayDay: number): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const p = ymd(paydayIn(y, m - 1, paydayDay));
  return p <= day ? p : ymd(paydayIn(y, m - 2, paydayDay));
}

/**
 * Các kỳ lương tăng dần, kỳ cuối là kỳ hiện tại (UC-108 bước 1): kỳ lưu (`active`) chạy từ `startedAt` tới `startedAt` của kỳ
 * lưu kế; kỳ danh nghĩa (theo `payday_day`) chỉ cho ngày lương nhỏ hơn ngày lương của kỳ lưu đầu, chạy từ 00:00 VN của ngày
 * lương tới 00:00 ngày lương kế, kỳ danh nghĩa cuối kéo tới `startedAt` của kỳ lưu đầu. Chưa có kỳ lưu: kỳ hiện tại = ngày
 * lương danh nghĩa gần nhất ≤ hôm nay. Chỉ trả kỳ có `end` > `since` (hoặc đang chạy).
 */
export function cycleRanges(stored: { payday: string; startedAt: string }[], paydayDay: number, now: Date, since: string): CycleRange[] {
  const kept = stored.filter((c) => c.startedAt <= now.toISOString()).sort((a, b) => (a.payday < b.payday ? -1 : 1));
  const out: CycleRange[] = [];
  const firstStored = kept[0];
  const nominalUntil = firstStored ? firstStored.payday : addDays(paydayOnOrBefore(vnDay(now.toISOString()), paydayDay), 1);
  let p = paydayOnOrBefore(vnDay(since), paydayDay);
  while (p < nominalUntil) {
    const next = nextPayday(p, paydayDay);
    const end = next < nominalUntil ? vnMidnight(next) : firstStored ? firstStored.startedAt : null;
    if (end === null || end > since) out.push({ payday: p, start: vnMidnight(p), end, stored: false });
    p = next;
  }
  kept.forEach((c, i) => {
    const end = kept[i + 1]?.startedAt ?? null;
    if (end === null || end > since) out.push({ payday: c.payday, start: c.startedAt, end, stored: true });
  });
  return out;
}

/**
 * Số ngày của kỳ và ngày thứ mấy hôm nay (UC-108 bước 5): kỳ đang chạy đếm từ ngày VN của `start` tới `nextPayday(payday)`;
 * kỳ đã kết thúc từ ngày của `start` tới ngày của `end`. `daysElapsed` tính cả hôm nay, kẹp 1…`days`; lương trễ có `lateDays`.
 */
export function cycleDays(range: CycleRange, paydayDay: number, today: string): { days: number; daysElapsed: number; lateDays?: number } {
  const startDay = vnDay(range.start);
  const days = Math.max(1, daysBetween(startDay, range.end === null ? nextPayday(range.payday, paydayDay) : vnDay(range.end)));
  if (range.end !== null) return { days, daysElapsed: days };
  const daysElapsed = Math.min(days, Math.max(1, daysBetween(startDay, today) + 1));
  const late = lateDays(range.payday, today, paydayDay);
  return late > 0 ? { days, daysElapsed, lateDays: late } : { days, daysElapsed };
}

/** ① trích Tích luỹ: khoản lương × % ÷ 100, làm tròn lên 1.000. */
export const savingsAmount = (income: number, pct: number) => ceil1000((income * pct) / 100);

/** Số ngày lương danh nghĩa từ ngày lương của kỳ (tính cả kỳ này) tới hạn `due`, tối thiểu 1. */
export function paydaysUntil(cyclePayday: string, due: string, paydayDay: number): number {
  const [y, m] = cyclePayday.split("-").map(Number) as [number, number];
  let n = 0;
  for (let k = 0; k < 1200; k++) {
    const p = k === 0 ? cyclePayday : ymd(paydayIn(y, m - 1 + k, paydayDay));
    if (p > due) break;
    n++;
  }
  return Math.max(1, n);
}

/** Mục tiêu Dự phòng đang dùng ĐÃ GẮN tài khoản, theo thứ tự `reserve.goals`; `held` = số dư tài khoản đó lúc mở kỳ. */
export interface GoalInput {
  id: string;
  held: number;
  target: number | null;
  targetPct: number | null;
  monthly: number | null;
  dueDate: string | null;
}

/**
 * ② khi kỳ mở (UC-1206 bước 3): lặp → min(số mỗi tháng, B − A); một lần có hạn → ⌈(B − A) ÷ n⌉ lên 1.000; một lần chưa
 * có hạn, theo % thu chịu thuế, đã đủ → không có việc. Mục tiêu chưa gắn tài khoản không vào đây (không sinh việc).
 */
export function goalTasks(goals: GoalInput[], cyclePayday: string, paydayDay: number): { goalId: string; amount: number }[] {
  return goals.flatMap((g) => {
    if (g.targetPct !== null || g.target === null || g.held >= g.target) return [];
    const missing = g.target - g.held;
    if (g.monthly !== null) return [{ goalId: g.id, amount: Math.min(g.monthly, missing) }];
    if (g.dueDate === null) return [];
    return [{ goalId: g.id, amount: ceil1000(missing / paydaysUntil(cyclePayday, g.dueDate, paydayDay)) }];
  });
}

/** ② theo % thu chịu thuế: một việc cho mỗi khoản thu `taxable` nhập vào kỳ. */
export function taxTasks(goals: GoalInput[], income: number): { goalId: string; amount: number; pct: number }[] {
  return goals.flatMap((g) => (g.targetPct === null ? [] : [{ goalId: g.id, amount: ceil1000((income * g.targetPct) / 100), pct: g.targetPct }]));
}

/** ④ dư kỳ trước (UC-1207 bước 2–3): phần Tích luỹ làm tròn xuống 1.000, phần còn lại vào tài khoản Ví Thưởng (nếu đã chọn). */
export function surplusTasks(prev: number, pct: number, rewardAccountId: string | null): { toPocket: "savings" | null; toAccountId: string | null; amount: number }[] {
  if (prev <= 0) return [];
  const toSavings = Math.floor((prev * pct) / 100 / 1000) * 1000;
  return [
    { toPocket: "savings" as const, toAccountId: null, amount: toSavings },
    ...(rewardAccountId ? [{ toPocket: null, toAccountId: rewardAccountId, amount: prev - toSavings }] : []),
  ].filter((t) => t.amount > 0);
}

/** Một khoản thu sắp ghi, đủ để sinh việc (UC-1206 bước 2–4). */
export interface IncomeForTasks {
  amount: number;
  taxable: boolean;
  /** Khoản lương (mở kỳ hoặc nhập vào kỳ): có ①. */
  salary: boolean;
  /** Lãi tiền gửi: không việc nào. */
  interest: boolean;
  accountPocket: Pocket | null;
  streamPocket: Pocket | null;
}

export interface TaskDraft {
  kind: TaskKind;
  /** true = việc của chính khoản thu (source_tx_id). */
  fromIncome: boolean;
  /** ②: mục tiêu (đích là tài khoản của mục tiêu, đọc lúc ghép). */
  goalId: string | null;
  /** ④ → Ví Thưởng: tài khoản Ví Thưởng lúc sinh việc. */
  toAccountId: string | null;
  toPocket: Pocket | null;
  pct: number | null;
  amount: number;
}

/**
 * Việc của một khoản thu nhập vào kỳ: ① (chỉ lương, không về / không đặt ngăn Tích luỹ — kể cả khi nhà chưa có tài khoản
 * Tích luỹ), ② Thuế (khoản `taxable`), ③ (nguồn đặt ngăn khác ngăn của tài khoản nhận). Lãi tiền gửi: không việc nào.
 */
export function incomeTasks(income: IncomeForTasks, savingsPct: number, goals: GoalInput[]): TaskDraft[] {
  if (income.interest) return [];
  const out: TaskDraft[] = [];
  const draft = (d: Pick<TaskDraft, "kind" | "toPocket" | "pct" | "amount"> & { goalId?: string }): TaskDraft => ({ fromIncome: true, goalId: null, toAccountId: null, ...d });
  if (income.salary && income.accountPocket !== "savings" && income.streamPocket !== "savings") {
    out.push(draft({ kind: "savings", toPocket: "savings", pct: savingsPct, amount: savingsAmount(income.amount, savingsPct) }));
  }
  if (income.taxable) {
    for (const t of taxTasks(goals, income.amount)) out.push(draft({ kind: "goal", goalId: t.goalId, toPocket: null, pct: t.pct, amount: t.amount }));
  }
  if (income.streamPocket !== null && income.streamPocket !== income.accountPocket) {
    out.push(draft({ kind: "move", toPocket: income.streamPocket, pct: null, amount: income.amount }));
  }
  return out;
}

/**
 * Việc khi kỳ mở, đúng thứ tự tạo (UC-1206 bước 1): ① và ② Thuế của khoản lương, ② mục tiêu, ③, ④.
 */
export function openingTasks(
  income: IncomeForTasks,
  opts: { savingsPct: number; goals: GoalInput[]; cyclePayday: string; paydayDay: number; prevOperating: number; surplusPct: number; rewardAccountId: string | null },
): TaskDraft[] {
  const own = incomeTasks(income, opts.savingsPct, opts.goals);
  const fixed = new Map(goalTasks(opts.goals, opts.cyclePayday, opts.paydayDay).map((g) => [g.goalId, g.amount]));
  const goals = opts.goals.flatMap((g): TaskDraft[] => {
    const tax = own.find((t) => t.kind === "goal" && t.goalId === g.id);
    if (tax) return [tax];
    const amount = fixed.get(g.id);
    return amount === undefined ? [] : [{ kind: "goal", fromIncome: false, goalId: g.id, toAccountId: null, toPocket: null, pct: null, amount }];
  });
  const surplus: TaskDraft[] = surplusTasks(opts.prevOperating, opts.surplusPct, opts.rewardAccountId).map((s) => ({
    kind: "surplus",
    fromIncome: false,
    goalId: null,
    toAccountId: s.toAccountId,
    toPocket: s.toPocket,
    pct: null,
    amount: s.amount,
  }));
  return [...own.filter((t) => t.kind === "savings"), ...goals, ...own.filter((t) => t.kind === "move"), ...surplus];
}

// ── Ghép chuyển khoản vào việc (UC-1206 bước 5) ─────────────────────

/**
 * Việc đang mở để ghép: đích là một tài khoản (`toAccountId`: ② tài khoản của mục tiêu, ④ tài khoản Ví Thưởng) hoặc một
 * ngăn (`toPocket`: ①, ③, ④ → Tích luỹ). Cả hai null (② mục tiêu đã bỏ gắn) → không ghép.
 */
export interface MatchTask {
  id: number;
  toPocket: Pocket | null;
  toAccountId: string | null;
  /** Phần còn thiếu (> 0). */
  missing: number;
}

/** Một đầu của chuyển khoản: `parentId` = tài khoản mẹ khi là tài khoản con (ADR-140). */
export interface TransferEnd {
  id: string;
  pocket: Pocket | null;
  parentId?: string | null;
}

/**
 * Chuyển khoản S → D (S ≠ D) ghép vào các việc đang mở theo thứ tự việc; mỗi việc nhận min(phần còn lại, phần còn thiếu):
 * việc có tài khoản đích khớp khi D là tài khoản đó hoặc một con của nó (không xét ngăn), trừ khi S cũng thuộc nhóm đó (chuyển
 * nội bộ mẹ ↔ con); việc có ngăn đích khớp khi D thuộc ngăn đó và S khác ngăn với D (S ngoài ngăn cũng được).
 */
export function allocateTransfer(tasks: MatchTask[], transfer: { from: TransferEnd; to: TransferEnd; available: number }): { taskId: number; amount: number }[] {
  const { from, to } = transfer;
  if (from.id === to.id || transfer.available <= 0) return [];
  const inGroup = (end: TransferEnd, root: string) => end.id === root || end.parentId === root;
  let left = transfer.available;
  const out: { taskId: number; amount: number }[] = [];
  for (const t of tasks) {
    if (left <= 0) break;
    const hit =
      t.toAccountId !== null
        ? inGroup(to, t.toAccountId) && !inGroup(from, t.toAccountId)
        : t.toPocket !== null && to.pocket === t.toPocket && from.pocket !== to.pocket;
    if (!hit || t.missing <= 0) continue;
    const take = Math.min(left, t.missing);
    out.push({ taskId: t.id, amount: take });
    left -= take;
  }
  return out;
}

/** Trạng thái hiện của một việc: `done` tay (status) hoặc tự (Σ ghép còn hiệu lực ≥ số của việc). */
export function taskState(task: { status: TaskStatus; amount: number }, linked: number): { state: TaskStatus; auto: boolean; missing: number } {
  if (task.status !== "open") return { state: task.status, auto: false, missing: 0 };
  if (linked >= task.amount) return { state: "done", auto: true, missing: 0 };
  return { state: "open", auto: false, missing: task.amount - linked };
}

/** Một việc kèm số đã ghép (chuyển khoản thật). */
export interface TaskFigures {
  kind: TaskKind;
  status: TaskStatus;
  amount: number;
  linked: number;
  /** Số tiền khoản thu sinh việc (① của khoản lương). */
  sourceAmount: number | null;
  toPocket: Pocket | null;
  /** ② của mục tiêu trả từ tiền chi tiêu (ADR-141): không tính vào phần chưa làm. */
  operatingGoal?: boolean;
}

/** Mức đạt Tích luỹ của kỳ (ADR-142): dưới 1% · 1–10% · 10–30% · từ 30% · 0% có lý do; null = chưa có mức. */
export type SavingsLevel = "below1" | "1to10" | "10to30" | "from30" | "zero" | null;

/**
 * Mức đạt (pocket UC-1206, ADR-142) từ phần đã trích (chuyển khoản thật) so với Σ khoản lương có ①: mọi ① bỏ qua / sửa về 0
 * và chưa trích gì → `zero`; base 0, hoặc chưa trích gì mà còn ① đang mở chưa ghép khoản nào → null.
 */
export function savingsLevel(savings: TaskFigures[], amount: number, base: number): SavingsLevel {
  if (base <= 0) return null;
  if (amount === 0 && savings.every((t) => t.status === "skipped" || t.amount === 0)) return "zero";
  if (amount === 0 && savings.some((t) => t.status === "open" && t.linked === 0 && t.amount > 0)) return null;
  if (amount * 100 < base) return "below1";
  if (amount * 100 < 10 * base) return "1to10";
  if (amount * 100 < 30 * base) return "10to30";
  return "from30";
}

/**
 * "Kỳ này đã trích" (UC-1206 bước 9): Σ phần đã ghép của ① (chuyển khoản thật tới tài khoản ngăn Tích luỹ), trên Σ khoản
 * lương có ①, kèm mức đạt. Tick tay không cộng.
 */
export function savingsDone(tasks: TaskFigures[]): { amount: number; base: number; pct: number | null; level: SavingsLevel } {
  const savings = tasks.filter((t) => t.kind === "savings" && t.status !== "void");
  const amount = savings.reduce((s, t) => s + Math.min(t.linked, t.amount), 0);
  const base = savings.reduce((s, t) => s + (t.sourceAmount ?? 0), 0);
  return { amount, base, pct: base > 0 ? Math.floor((amount * 100) / base) : null, level: savingsLevel(savings, amount, base) };
}

/**
 * Phần chưa làm (ledger UC-103): Σ phần còn thiếu của ① và ④ đang mở, cộng ② đang mở trừ khi khoản lương mở kỳ về
 * tài khoản ngăn Dự phòng / Tích luỹ; ③ và ② của mục tiêu trả từ tiền chi tiêu không tính.
 */
export function pendingTasks(tasks: TaskFigures[], salaryPocket: Pocket | null): number {
  const goalsOutside = salaryPocket === "reserve" || salaryPocket === "savings";
  return tasks.reduce((s, t) => {
    const { state, missing } = taskState(t, t.linked);
    if (state !== "open" || t.kind === "move" || (t.kind === "goal" && (goalsOutside || t.operatingGoal))) return s;
    return s + missing;
  }, 0);
}

// ── snapshot.payCycle ───────────────────────────────────────────────

export interface QrTarget {
  accountId: string;
  name: string;
  bank: string | null;
  accountNo: string;
  subAccount: string | null;
}

export interface PayCycleTask {
  id: number;
  kind: TaskKind;
  /** `done` gồm cả tự xong (`auto`). */
  status: "open" | "done" | "skipped";
  auto: boolean;
  suggested: number;
  amount: number;
  linked: number;
  missing: number;
  pct: number | null;
  reason: string | null;
  toPocket: Pocket | null;
  /** ②: mục tiêu và tài khoản thật của nó (`held` = số dư tài khoản đó; null khi đã bị bỏ gắn → tick tay 409 `goal_no_account`). */
  goal: { id: string; name: string; held: number | null; target: number | null; accountId: string | null } | null;
  /** ② tài khoản của mục tiêu · ④ → Ví Thưởng: tài khoản đích (ghép theo đúng tài khoản này, không xét ngăn); null cho ①, ③, ④ → Tích luỹ. */
  toAccountId: string | null;
  /** Khoản thu của việc; `{ hidden: true }` khi khoản đó bị giấu với người xem (access UC-504 AC-18). */
  source: { txId: number; amount: number; at: string; streamName: string | null } | { hidden: true } | null;
  doneAt: string | null;
  /** Lần chuyển khoản gần nhất đã ghép (còn hiệu lực) — "tự nhận từ chuyển khoản {d/m}". */
  lastTxAt: string | null;
  /** Tài khoản có số tài khoản để mở QR (UC-1206 bước 10), theo thứ tự tài khoản; rỗng = không QR. */
  targets: QrTarget[];
  /** Tên tài khoản đích cho câu "Chuyển sang {tên}" khi không QR; null khi không có. */
  targetName: string | null;
}

/** ① / ④ → Tích luỹ mà ngăn Tích luỹ không có tài khoản nào (không đích, không tên) — pocket UC-1206 AC-10; dùng chung PWA và tin. */
export const lacksSavingsAccount = (t: Pick<PayCycleTask, "toPocket" | "kind" | "targets" | "targetName">) =>
  t.toPocket === "savings" && (t.kind === "savings" || t.kind === "surplus") && t.targets.length === 0 && t.targetName === null;

export interface PayCycleView {
  id: number;
  startedAt: string;
  payday: string;
  nextPayday: string;
  lateDays: number;
  prevOperating: number;
  tasks: PayCycleTask[];
  openCount: number;
  savingsDone: { amount: number; base: number; pct: number | null; level: SavingsLevel };
}
