// Ba ngăn Tích luỹ · Dự phòng · Vận hành (pocket UC-1201…1203, UC-1209, ADR-119, ADR-132) — hàm thuần, snapshot và PWA dùng
// chung. Một nguồn số cho tiền: số trong sổ của tài khoản đang dùng. Mỗi mục tiêu Dự phòng là một tài khoản thật ngăn Dự
// phòng (A = số dư tài khoản đó); phần an tâm và nợ ngắn hạn tính ra, không lưu.

import { DomainError } from "./types";

export const POCKETS = ["savings", "reserve", "operating"] as const;
export type Pocket = (typeof POCKETS)[number];

/** Trần số tiền của mục tiêu / hạn mức (đồng). */
export const MONEY_MAX = 1e12;
/** % Tích luỹ mỗi kỳ lương khi chưa đặt (config `savings_pct`, UC-507). */
export const DEFAULT_SAVINGS_PCT = 10;
/** Ngăn của tài khoản thêm mới không gửi `pocket` (UC-1201 bước 4): mọi loại, kể cả thẻ tín dụng, vào Vận hành, chưa xác nhận. */
export const DEFAULT_ACCOUNT_POCKET: Pocket = "operating";

// ── Kiểm mục tiêu Dự phòng ──────────────────────────────────────────
/** Các cột cách đặt số của một mục tiêu sau khi ghép input với giá trị đang lưu. */
export interface GoalDraft {
  target_amount: number | null;
  target_pct: number | null;
  monthly_amount: number | null;
  repeat_months: number | null;
  due_date: string | null;
  debt_id: string | null;
}

const bad = (message: string, field: string): never => {
  throw new DomainError("invalid_input", message, 400, field);
};
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Kiểm cách đặt số của một mục tiêu (UC-1209 Exceptions) — đúng các CHECK của bảng reserve_goals, báo lỗi dễ hiểu kèm tên
 * ô. Lặp (`monthly_amount` + `repeat_months`) thì B = tích: trả bản đã điền `target_amount`.
 */
export function checkGoal(e: GoalDraft): GoalDraft {
  const money = (v: number | null, field: string) => {
    if (v !== null && (!Number.isInteger(v) || v <= 0 || v > MONEY_MAX)) bad("Số tiền là số nguyên lớn hơn 0, tối đa 1.000.000.000.000.", field);
  };
  money(e.target_amount, "target_amount");
  money(e.monthly_amount, "monthly_amount");
  if (e.repeat_months !== null && (!Number.isInteger(e.repeat_months) || e.repeat_months < 1 || e.repeat_months > 12)) bad("Mấy tháng một lần: từ 1 đến 12.", "repeat_months");
  if (e.target_pct !== null && (!Number.isInteger(e.target_pct) || e.target_pct < 1 || e.target_pct > 100)) bad("% thu chịu thuế là số nguyên từ 1 đến 100.", "target_pct");
  if (e.due_date !== null && !isDay(e.due_date)) bad("Hạn có dạng 2027-01-15.", "due_date");
  if ((e.monthly_amount === null) !== (e.repeat_months === null)) bad("Mục tiêu lặp cần cả số mỗi tháng lẫn mấy tháng một lần.", "repeat_months");
  if (e.target_pct !== null) {
    if (e.target_amount !== null) bad("Mục tiêu đặt theo số cần hoặc theo % thu chịu thuế, không cả hai.", "target_pct");
    if (e.repeat_months !== null) bad("Mục tiêu theo % thu chịu thuế không lặp.", "target_pct");
    return e;
  }
  if (e.monthly_amount !== null) {
    const target = e.monthly_amount * e.repeat_months!;
    if (e.target_amount !== null && e.target_amount !== target) bad("Số cần của mục tiêu lặp = số mỗi tháng × số tháng.", "target_amount");
    money(target, "monthly_amount");
    return { ...e, target_amount: target };
  }
  if (e.target_amount === null) bad("Mục tiêu cần số cần (lặp hoặc một lần) hoặc % thu chịu thuế.", "target_amount");
  return e;
}

// ── Tính ba ngăn ────────────────────────────────────────────────────
/** Tài khoản đang dùng kèm số trong sổ (`v_account_book`). */
export interface PocketAccount {
  id: string;
  name: string;
  pocket: Pocket | null;
  confirmed: boolean;
  balance: number;
}

/** Mục tiêu Dự phòng đang dùng (`reserve_goals.active = 1`); `accountId` = tài khoản thật của mục tiêu, null = chưa gắn. */
export interface PocketGoalInput {
  id: string;
  name: string;
  accountId: string | null;
  target: number | null;
  targetPct: number | null;
  monthly: number | null;
  repeatMonths: number | null;
  dueDate: string | null;
  debtId: string | null;
}

/** Khoản nợ (`v_debt_balance` JOIN `debts`). */
export interface PocketDebt {
  id: string;
  name: string;
  term: "short" | "long";
  active: boolean;
  balance: number;
  monthlyPayment: number | null;
  dueDay: number | null;
}

export interface PocketAccountLine {
  id: string;
  name: string;
  balance: number;
  /** Mục tiêu Dự phòng đang dùng gắn tài khoản này; null = không gắn. */
  goalId: string | null;
}
export interface PocketGoal {
  id: string;
  name: string;
  accountId: string | null;
  /** A = số dư sổ của tài khoản gắn; null = chưa gắn tài khoản. */
  held: number | null;
  /** B; `null` khi đặt theo % thu chịu thuế. */
  target: number | null;
  targetPct: number | null;
  monthly: number | null;
  repeatMonths: number | null;
  dueDate: string | null;
  debtId: string | null;
}
export interface ShortDebtItem {
  id: string;
  name: string;
  /** Đủ số còn nợ — không trừ `heldFor`. */
  balance: number;
  monthlyPayment: number | null;
  dueDay: number | null;
  goalId: string | null;
  heldFor: number;
}

/** Tích luỹ thay đổi theo kỳ (UC-1203 bước 10): `amount` = bây giờ − đầu kỳ; `prevAmount` = đầu kỳ − đầu kỳ trước. */
export interface SavingsChange {
  since: string;
  amount: number;
  prevSince: string;
  prevAmount: number;
}

/** Phần an tâm đo bằng tháng vận hành (UC-1203 bước 11). `covered` / `monthly` null khi chưa có kỳ lương trọn nào để đo. */
export interface PeaceMonths {
  covered: number | null;
  target: number;
  monthly: number | null;
  cycles: number;
}

/** `snapshot.pockets` (UC-1203 bước 7). Số theo đồng, số nguyên. */
export interface PocketsView {
  savings: { total: number; accounts: PocketAccountLine[]; change: SavingsChange };
  reserve: {
    total: number;
    accounts: PocketAccountLine[];
    goals: PocketGoal[];
    /** Σ tài khoản Dự phòng không gắn mục tiêu đang dùng, không phải tài khoản Ví Thưởng (âm thì giữ âm). */
    peace: number;
    peaceMonths: PeaceMonths;
    /** Tài khoản Ví Thưởng (`config.surplus_reward_account`) khi đang dùng, ở ngăn Dự phòng, không gắn mục tiêu; null = chưa chọn. */
    reward: { accountId: string; balance: number } | null;
  };
  operating: { total: number; accounts: PocketAccountLine[] };
  outside: { total: number; accounts: PocketAccountLine[] };
  unconfirmed: number;
  savingsPct: number;
  /** Nợ ngắn hạn cần trả — chỉ để nhắc, không trừ vào ngăn nào. */
  shortDebt: { total: number; count: number; items: ShortDebtItem[] };
}

/** Một tài khoản ở hai mốc đầu kỳ / đầu kỳ trước: số trong sổ tại mốc; null = không tính ở mốc đó (đã tắt trước mốc). */
export interface PocketAccountAt {
  id: string;
  pocket: Pocket | null;
  since: number | null;
  prevSince: number | null;
}

export interface PocketsInput {
  accounts: PocketAccount[];
  goals: PocketGoalInput[];
  /** `config.surplus_reward_account`; null = chưa chọn. */
  rewardAccountId: string | null;
  debts: PocketDebt[];
  savingsPct: number;
  /** Trạng thái tại đầu kỳ (`since`) và đầu kỳ trước (`prevSince`), ngày `YYYY-MM-DD` giờ VN. */
  history: { since: string; prevSince: string; accounts: PocketAccountAt[] };
  /** Chi vận hành của tối đa 3 kỳ lương trọn gần nhất (ngày VN đầu kỳ, số, số ngày của kỳ), và ngày bắt đầu dữ liệu (null = chưa có). */
  operatingSpend: { cycles: { start: string; amount: number; days: number }[]; dataStart: string | null };
  /** Số tháng vận hành muốn có ở phần an tâm (`safety_fund_months`). */
  peaceTarget: number;
}

type Totals = Record<Pocket | "outside", number>;

/** Tổng ngăn X = Σ sổ các tài khoản ngăn X — một luật cho số bây giờ và số tại mỗi mốc đầu kỳ. */
function pocketTotals(accounts: Pick<PocketAccount, "pocket" | "balance">[]): Totals {
  const totals: Totals = { savings: 0, reserve: 0, operating: 0, outside: 0 };
  for (const a of accounts) totals[a.pocket ?? "outside"] += a.balance;
  return totals;
}

/**
 * Phần an tâm theo tháng vận hành, bằng số nguyên phần mười: `covered` làm tròn xuống (an toàn), % thanh chặn 100.
 * PWA gọi lại sau khi trừ tạm hàng đợi. `monthly` null → không đo được; phần an tâm ≤ 0 → 0.
 */
export function peaceMonthsView(peace: number, monthly: number | null, target: number): { covered: number | null; pct: number | null } {
  if (monthly === null || monthly <= 0) return { covered: null, pct: null };
  if (peace <= 0) return { covered: 0, pct: 0 };
  const c10 = Math.floor((peace * 10) / monthly);
  return { covered: c10 / 10, pct: Math.min(100, Math.floor((c10 * 10) / target)) };
}

/**
 * Chi vận hành một tháng, chuẩn hoá theo ngày (UC-1203 bước 11, ADR-127 (8)): ⌊Σ chi × 30 ÷ Σ số ngày⌋ của các kỳ có ngày đầu
 * ≥ ngày bắt đầu dữ liệu và có chi > 0 — kỳ lưu mở sớm / trễ dài 8–53 ngày không làm lệch.
 */
function operatingMonthly({ cycles, dataStart }: PocketsInput["operatingSpend"]): { monthly: number | null; cycles: number } {
  const used = dataStart === null ? [] : cycles.filter((c) => c.start >= dataStart && c.amount > 0);
  const days = used.reduce((s, c) => s + c.days, 0);
  return { monthly: used.length && days > 0 ? Math.floor((used.reduce((s, c) => s + c.amount, 0) * 30) / days) : null, cycles: used.length };
}

/** Mục tiêu theo hạn (tăng dần, chưa có hạn xuống cuối) rồi theo tên — thẻ Dự phòng, tin sáng, MCP dùng đúng thứ tự này. */
const byDueThenName = (a: Pick<PocketGoal, "dueDate" | "name">, b: Pick<PocketGoal, "dueDate" | "name">) =>
  (a.dueDate === b.dueDate ? 0 : a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate < b.dueDate ? -1 : 1) || a.name.localeCompare(b.name, "vi");

/**
 * Bất biến: bốn tổng cộng lại = Σ sổ mọi tài khoản đang dùng. A của mục tiêu = số dư tài khoản gắn; phần an tâm = tài
 * khoản Dự phòng không gắn mục tiêu, không phải Ví Thưởng. Tích luỹ tại mỗi mốc theo trạng thái tại mốc (ADR-100), ngăn theo
 * giá trị đang lưu.
 */
export function pocketsView({ accounts, goals, rewardAccountId, debts, savingsPct, history, operatingSpend, peaceTarget }: PocketsInput): PocketsView {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const goalOf = new Map<string, string>();
  for (const g of goals) if (g.accountId !== null && byId.has(g.accountId)) goalOf.set(g.accountId, g.id);
  const totals = pocketTotals(accounts);
  const lines: Record<Pocket | "outside", PocketAccountLine[]> = { savings: [], reserve: [], operating: [], outside: [] };
  for (const a of accounts) lines[a.pocket ?? "outside"].push({ id: a.id, name: a.name, balance: a.balance, goalId: goalOf.get(a.id) ?? null });
  const savingsAt = (mark: "since" | "prevSince") =>
    pocketTotals(history.accounts.flatMap((a) => (a[mark] === null ? [] : [{ pocket: a.pocket, balance: a[mark] }]))).savings;
  const atSince = savingsAt("since");
  const goalLines: PocketGoal[] = goals
    .map(({ id, name, accountId, target, targetPct, monthly, repeatMonths, dueDate, debtId }) => {
      const account = accountId === null ? undefined : byId.get(accountId);
      return { id, name, accountId, held: account ? account.balance : null, target, targetPct, monthly, repeatMonths, dueDate, debtId };
    })
    .sort(byDueThenName);
  const rewardAccount = rewardAccountId === null ? undefined : byId.get(rewardAccountId);
  const reward = rewardAccount && rewardAccount.pocket === "reserve" && !goalOf.has(rewardAccount.id) ? { accountId: rewardAccount.id, balance: rewardAccount.balance } : null;
  const peace = lines.reserve.filter((a) => a.goalId === null && a.id !== reward?.accountId).reduce((s, a) => s + a.balance, 0);
  const items = debts
    .filter((d) => d.active && d.term === "short" && d.balance > 0)
    .map((d) => {
      const goal = goalLines.find((g) => g.debtId === d.id);
      return { id: d.id, name: d.name, balance: d.balance, monthlyPayment: d.monthlyPayment, dueDay: d.dueDay, goalId: goal?.id ?? null, heldFor: goal?.held ?? 0 };
    })
    .sort((a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99) || a.name.localeCompare(b.name, "vi"));
  const spend = operatingMonthly(operatingSpend);
  return {
    savings: {
      total: totals.savings,
      accounts: lines.savings,
      change: { since: history.since, amount: totals.savings - atSince, prevSince: history.prevSince, prevAmount: atSince - savingsAt("prevSince") },
    },
    reserve: {
      total: totals.reserve,
      accounts: lines.reserve,
      goals: goalLines,
      peace,
      peaceMonths: { covered: peaceMonthsView(peace, spend.monthly, peaceTarget).covered, target: peaceTarget, monthly: spend.monthly, cycles: spend.cycles },
      reward,
    },
    operating: { total: totals.operating, accounts: lines.operating },
    outside: { total: totals.outside, accounts: lines.outside },
    unconfirmed: accounts.filter((a) => !a.confirmed).length,
    savingsPct,
    shortDebt: { total: items.reduce((s, d) => s + d.balance, 0), count: items.length, items },
  };
}

/** Lời chúc khi không còn nợ ngắn hạn (thẻ Vận hành, dòng 💳 tin sáng), đúng thứ tự xoay. */
export const BLESSINGS = [
  "Không còn nợ ngắn hạn 🎉 — tiền vận hành là của mình trọn vẹn",
  "Sạch nợ ngắn hạn — mỗi đồng chi hôm nay là tiền của mình",
  "Không nợ ngắn hạn nào. Giữ nhịp này nhé 👏",
  "Hết nợ ngắn hạn — tháng này nhẹ hẳn",
] as const;

/** Lời chúc của ngày `YYYY-MM-DD` (giờ VN): số ngày từ 1970-01-01 mod 4. */
export function blessingFor(day: string): string {
  return BLESSINGS[Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000) % 4]!;
}
