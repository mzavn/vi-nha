// Tháng dương lịch thay kỳ lương (ADR-144): nhắc ① trích Tích luỹ của từng khoản lương, việc chia dư cuối tháng, lương về
// sớm (pocket UC-1205, UC-1206, UC-1207, ledger UC-103). Hàm thuần: server ghép chuyển khoản vào việc, tính dư tháng và dựng
// `snapshot.month` / `snapshot.monthClose`; PWA dùng lại kiểu, chữ và phép chia khi đổi %.

import { nextPayday, paydayIn } from "./snapshot";

export const TASK_KINDS = ["savings", "surplus"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export type TaskStatus = "open" | "done" | "skipped" | "void";
/** Trần số tiền của một việc (đồng). */
export const TASK_AMOUNT_MAX = 1e12;
/** Cửa sổ lương về sớm (ngày) trước ngày lương. */
export const EARLY_DAYS = 7;
/** % dư cuối tháng vào Tích luỹ khi chưa đặt (config `surplus_savings_pct`). */
export const DEFAULT_SURPLUS_SAVINGS_PCT = 50;
/**
 * Việc → Tích luỹ (① và chia dư → Tích luỹ) chỉ tự nhận chuyển khoản từ số này (chủ nhà 12/11, UC-1206 AC-19): khoản lẻ heo đất
 * MB tự gom (8.000, 1.000…) không phải "đã trích". Tick tay không xét ngưỡng; việc → Ví Thưởng không có ngưỡng.
 */
export const AUTO_MATCH_MIN = 100_000;
/** Ngưỡng nhắc trích khi chưa đặt (config `salary_reminder_min`, Q1-B): khoản thu không nguồn từ số này thì ô "Đây là lương" bật sẵn. */
export const DEFAULT_SALARY_REMINDER_MIN = 5_000_000;

const DAY_MS = 86_400_000;
const ceil1000 = (n: number) => Math.ceil(n / 1000) * 1000;
const floor1000 = (n: number) => Math.floor(n / 1000) * 1000;

// ── Tháng VN ────────────────────────────────────────────────────────

/** 00:00 giờ VN của ngày `day` (ISO UTC). */
export const vnMidnight = (day: string) => new Date(`${day}T00:00:00+07:00`).toISOString();
/** Ngày VN của một thời điểm ISO. */
export const vnDay = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** Tháng sau / trước của `YYYY-MM`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
export function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
/** Số ngày của tháng `YYYY-MM`. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** 00:00 VN ngày 1 của tháng (ISO UTC): mốc đầu tháng. */
export const monthStart = (month: string) => vnMidnight(`${month}-01`);
/** Ngày lương của tháng `YYYY-MM` (kẹp cuối tháng như `nextPayday`). */
export function paydayOf(month: string, paydayDay: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return paydayIn(y, m - 1, paydayDay).toISOString().slice(0, 10);
}

/** ① trích Tích luỹ: khoản lương × % ÷ 100, làm tròn lên 1.000. */
export const savingsAmount = (income: number, pct: number) => ceil1000((income * pct) / 100);

// ── Lương về sớm (ledger UC-103, ADR-144) ──────────────────────────

/**
 * `nearSpend.salaryPayday`: chỉ khi `payday_day` > 7 và có khoản lương (`is_salary`, chưa huỷ) có ngày VN trong cửa sổ
 * [ngày lương sắp tới − 7 ngày, ngày lương sắp tới) → ngày lương sắp tới; còn lại null. Khoản đầu tiên trong cửa sổ quyết, khoản
 * thứ hai trở đi không đổi gì thêm. `salaries`: thời điểm (ISO) các khoản lương.
 */
export function earlySalaryPayday(salaries: readonly string[], today: string, paydayDay: number): string | null {
  if (paydayDay <= EARLY_DAYS) return null;
  const upcoming = nextPayday(today, paydayDay);
  const from = addDays(upcoming, -EARLY_DAYS);
  return salaries.some((at) => {
    const d = vnDay(at);
    return d >= from && d < upcoming && d <= today;
  })
    ? upcoming
    : null;
}

// ── Chia dư cuối tháng (pocket UC-1207, Q2-A) ──────────────────────

/**
 * D: giữ cho ăn tiêu tới ngày lương = ⌈(ăn tiêu tháng M ÷ số ngày tháng M) × (ngày lương tháng M+1 − 1)⌉ lên bội 1.000.
 * `paydayDay` là ngày lương thật của tháng M+1 (đã kẹp cuối tháng); ngày lương 1 → 0.
 */
export function heldToPayday(eatSpend: number, daysInMonthM: number, paydayDay: number): number {
  const days = Math.max(0, paydayDay - 1);
  if (days === 0 || eatSpend <= 0) return 0;
  return ceil1000((eatSpend * days) / daysInMonthM);
}

export interface SurplusInput {
  /** E: Vận hành cuối tháng (theo sổ tại 00:00 VN ngày 1 tháng sau). */
  E: number;
  /** W: phần còn thiếu, tại mốc, của các việc tạo trước mốc mà chưa xong. */
  W: number;
  /** L: lương của tháng sau về trước mốc (chỉ khi `payday_day` ≤ 7). */
  L: number;
  /** P: khoản phải trả tháng sau. */
  P: number;
  /** D: ăn tiêu tới ngày lương (`heldToPayday`). */
  D: number;
  /** % vào Tích luỹ (`surplus_savings_pct` hoặc % người bấm chọn). */
  pct: number;
  /** Tài khoản Ví Thưởng; null = chưa chọn → không có phần Ví Thưởng, phần còn lại ở Vận hành. */
  rewardAccount: string | null;
}

/** S = E − W − L − P − D; S > 0: Tích luỹ = ⌊S × % ÷ 100⌋ xuống bội 1.000, Ví Thưởng = S − phần đó (0 khi chưa chọn). */
export function monthSurplus({ E, W, L, P, D, pct, rewardAccount }: SurplusInput): { surplus: number; savingsAmount: number; rewardAmount: number } {
  const surplus = E - W - L - P - D;
  if (surplus <= 0) return { surplus, savingsAmount: 0, rewardAmount: 0 };
  const savings = floor1000((surplus * pct) / 100);
  return { surplus, savingsAmount: savings, rewardAmount: rewardAccount === null ? 0 : surplus - savings };
}

// ── Ghép chuyển khoản vào việc (UC-1206) ───────────────────────────

/**
 * Việc đang mở để ghép: đích là một ngăn (`toPocket`: ①, chia dư → Tích luỹ) hoặc một tài khoản (`toAccountId`: chia dư →
 * Ví Thưởng). `since` = mốc của việc (ISO): ① là thời điểm khoản lương, việc chia dư là lúc bấm Chia.
 */
export interface MatchTask {
  id: number;
  toPocket: "savings" | null;
  toAccountId: string | null;
  /** Phần còn thiếu (> 0). */
  missing: number;
  since: string;
}

/** Một đầu của chuyển khoản: `parentId` = tài khoản mẹ khi là tài khoản con (ADR-140). */
export interface TransferEnd {
  id: string;
  pocket: string | null;
  parentId?: string | null;
}

/**
 * Chuyển khoản S → D (S ≠ D, thời điểm `at`, số `amount`, còn `available` chưa dùng) ghép vào các việc đang mở có mốc ≤ `at`,
 * theo thứ tự việc; mỗi việc nhận min(phần còn lại, phần còn thiếu); việc → ngăn Tích luỹ chỉ nhận khi `amount` ≥ `AUTO_MATCH_MIN`: việc có tài khoản đích khớp khi D là tài khoản đó hoặc một con của nó, trừ khi S cũng thuộc
 * nhóm đó; việc có ngăn đích khớp khi D thuộc ngăn đó và S khác ngăn với D.
 */
export function allocateTransfer(tasks: MatchTask[], transfer: { from: TransferEnd; to: TransferEnd; amount: number; available: number; at: string }): { taskId: number; amount: number }[] {
  const { from, to } = transfer;
  if (from.id === to.id || transfer.available <= 0) return [];
  const inGroup = (end: TransferEnd, root: string) => end.id === root || end.parentId === root;
  let left = transfer.available;
  const out: { taskId: number; amount: number }[] = [];
  for (const t of tasks) {
    if (left <= 0) break;
    if (transfer.at < t.since || t.missing <= 0) continue;
    if (t.toPocket !== null && transfer.amount < AUTO_MATCH_MIN) continue;
    const hit =
      t.toAccountId !== null
        ? inGroup(to, t.toAccountId) && !inGroup(from, t.toAccountId)
        : t.toPocket !== null && to.pocket === t.toPocket && from.pocket !== to.pocket;
    if (!hit) continue;
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
  /** Số tiền khoản lương sinh nhắc ① (null cho việc chia dư). */
  sourceAmount: number | null;
}

/** Mức đạt Tích luỹ của tháng (ADR-142): dưới 1% · 1–10% · 10–30% · từ 30% · 0% có lý do; null = chưa có mức. */
export type SavingsLevel = "below1" | "1to10" | "10to30" | "from30" | "zero" | null;

/**
 * Mức đạt từ phần đã trích (chuyển khoản thật) so với Σ khoản lương có ①: mọi ① bỏ qua / sửa về 0 và chưa trích gì → `zero`;
 * base 0, hoặc chưa trích gì mà còn ① đang mở chưa ghép khoản nào → null.
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

/** Tích luỹ của một tháng (`month.savings`, Nhìn lại `savings`): ① của các khoản lương trong tháng đó. */
export interface MonthSavings {
  amount: number;
  base: number;
  pct: number | null;
  level: SavingsLevel;
}

/**
 * "Tháng này đã trích" (UC-1206): Σ phần đã ghép của ① chưa void (chuyển khoản thật tới ngăn Tích luỹ), trên Σ khoản lương có
 * ①, kèm mức đạt. Tick tay không cộng. Gọi với các ① của đúng một tháng (`month_key`).
 */
export function savingsDone(tasks: TaskFigures[]): MonthSavings {
  const savings = tasks.filter((t) => t.kind === "savings" && t.status !== "void");
  const amount = savings.reduce((s, t) => s + Math.min(t.linked, t.amount), 0);
  const base = savings.reduce((s, t) => s + (t.sourceAmount ?? 0), 0);
  return { amount, base, pct: base > 0 ? Math.floor((amount * 100) / base) : null, level: savingsLevel(savings, amount, base) };
}

/** Phần chưa làm (ledger UC-103): Σ phần còn thiếu của mọi việc đang mở (① mọi tháng, việc chia dư đang mở). */
export function pendingTasks(tasks: Pick<TaskFigures, "status" | "amount" | "linked">[]): number {
  return tasks.reduce((s, t) => {
    const { state, missing } = taskState(t, t.linked);
    return state === "open" ? s + missing : s;
  }, 0);
}

// ── Mã việc trong nội dung chuyển khoản (UC-1206 AC-20, ingest UC-303 AC-33) ──

/** 32 ký tự: chữ hoa và số, bỏ 0 / O / 1 / I (dễ nhầm khi gõ tay nội dung chuyển khoản). */
export const TASK_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
/** Nhân với một số lẻ theo modulo 2^20 là song ánh: mã khác nhau cho mọi id < 1.048.576, trông không theo thứ tự. */
const CODE_MULTIPLIER = 742_297;
const CODE_SPACE = 1 << 20;

/**
 * Mã 4 ký tự của việc `id` — cùng công thức với cột sinh `month_tasks.code` (migration 0047): không cần sinh ngẫu nhiên, không
 * bao giờ trùng, không đua giữa hai máy.
 */
export function taskCode(id: number): string {
  const n = (id * CODE_MULTIPLIER) % CODE_SPACE;
  return [15, 10, 5, 0].map((shift) => TASK_CODE_ALPHABET[(n >> shift) & 31]).join("");
}

/** Tiền tố theo loại việc: TL = trích lương (①), CD = chia dư → Tích luỹ, VT = chia dư → Ví Thưởng. */
export type TaskPrefix = "TL" | "CD" | "VT";
export const taskPrefix = (t: Pick<MonthTask, "kind" | "toAccountId">): TaskPrefix => (t.kind === "savings" ? "TL" : t.toAccountId !== null ? "VT" : "CD");

/**
 * Nội dung chuyển khoản của QR: "TL 7K2Q T11" (tiền tố, mã, tháng của việc). Không có chữ "TICH LUY": mẫu tự gán heo đất MB
 * khớp chữ đó và gán nhầm khoản trích về heo đất.
 */
export function taskMemo(t: Pick<MonthTask, "kind" | "toAccountId" | "month" | "code">): string {
  return `${taskPrefix(t)} ${t.code} T${Number(t.month.slice(5, 7))}`;
}

/**
 * Mọi bộ (tiền tố, mã, tháng) có trong nội dung ngân hàng — viết thường, dính chữ, dấu chấm / gạch đều đọc được. Bắt buộc hậu tố
 * `T{tháng}` như nội dung QR: thiếu hậu tố thì không đọc là mã, để mô tả cửa hàng kiểu "VTVCAB…" không khớp nhầm.
 */
export function codesIn(content: string | null): { prefix: TaskPrefix; code: string; month: number }[] {
  if (!content) return [];
  const out: { prefix: TaskPrefix; code: string; month: number }[] = [];
  for (const m of content.toUpperCase().matchAll(/(TL|CD|VT)[\s.\-_]?([2-9A-HJ-NP-Z]{4})[\s.\-_]?T(1[0-2]|0?[1-9])(?!\d)/g)) {
    out.push({ prefix: m[1] as TaskPrefix, code: m[2]!, month: Number(m[3]) });
  }
  return out;
}

// ── snapshot.month / snapshot.monthClose ───────────────────────────

export interface QrTarget {
  accountId: string;
  name: string;
  bank: string | null;
  accountNo: string;
  subAccount: string | null;
}

export interface MonthTask {
  id: number;
  kind: TaskKind;
  /** `month_key`: tháng của khoản lương (①) / tháng được chia (chia dư). */
  month: string;
  /** Mã 4 ký tự trong nội dung chuyển khoản (`taskMemo`); ingest nhận ra thì gán đúng việc này. */
  code: string;
  /** `done` gồm cả tự xong (`auto`). */
  status: "open" | "done" | "skipped";
  auto: boolean;
  amount: number;
  linked: number;
  missing: number;
  pct: number | null;
  reason: string | null;
  toPocket: "savings" | null;
  /** Chia dư → Ví Thưởng: tài khoản đích (ghép theo đúng tài khoản này); null cho ① và chia dư → Tích luỹ. */
  toAccountId: string | null;
  /** ①: khoản lương; `{ hidden: true }` khi khoản đó bị giấu với người xem (access UC-504 AC-18); null cho việc chia dư. */
  source: { txId: number; amount: number; at: string; streamName: string | null } | { hidden: true } | null;
  /** Lần đổi trạng thái / số gần nhất (ISO). */
  updatedAt: string;
  /** Lần chuyển khoản gần nhất đã ghép (còn hiệu lực) — "tự nhận từ chuyển khoản {d/m}". */
  lastTxAt: string | null;
  /** Tài khoản có số tài khoản để mở QR, theo thứ tự tài khoản; rỗng = không QR. */
  targets: QrTarget[];
  /** Tên tài khoản đích cho câu "Chuyển sang {tên}" khi không QR; null khi không có. */
  targetName: string | null;
}

/** ① / chia dư → Tích luỹ mà ngăn Tích luỹ không có tài khoản nào (không đích, không tên) — UC-1206 AC-10; PWA và tin dùng chung. */
export const lacksSavingsAccount = (t: Pick<MonthTask, "toPocket" | "targets" | "targetName">) =>
  t.toPocket === "savings" && t.targets.length === 0 && t.targetName === null;

/** `snapshot.month` (UC-1206, UC-702). */
export interface MonthView {
  /** Tháng VN hiện tại `YYYY-MM`. */
  key: string;
  /** Việc chưa void: đang mở (mọi tháng), hoặc xong / bỏ qua trong 24 giờ qua — thẻ thu gọn rồi tự ẩn. */
  tasks: MonthTask[];
  openCount: number;
  /** Tích luỹ tháng hiện tại (① có `month_key` = `key`). */
  savings: MonthSavings;
  /** Gợi ý không bắt buộc dưới nhắc ①: mục tiêu tài khoản đầu tiên (thứ tự ưu tiên) còn thiếu; null = mọi mục tiêu đủ (UC-1206 AC-18). */
  goalHint: { goalId: string; name: string; short: number } | null;
}

/** `snapshot.monthClose` (UC-1207): dư của tháng vừa hết, trong suốt tháng sau. */
export interface MonthClose {
  month: string;
  operatingEnd: number;
  pendingAtEnd: number;
  earlySalary: number;
  heldPayables: number;
  heldToPayday: number;
  surplus: number;
  savingsAmount: number;
  rewardAmount: number;
  /** % vào Tích luỹ: đã chia → % đã chọn; còn lại `surplus_savings_pct`. */
  pct: number;
  /** `ask` = chưa chia, chưa bỏ qua (thẻ Tháng dư chỉ hiện khi này). */
  status: "ask" | "split" | "skipped";
}
