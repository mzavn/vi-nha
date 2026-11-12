// Ba ngăn Tích luỹ · Dự phòng · Vận hành (pocket UC-1201…1203, UC-1209, ADR-119, ADR-132) — hàm thuần, snapshot và PWA dùng
// chung. Một nguồn số cho tiền: số trong sổ của tài khoản đang dùng. Mỗi mục tiêu Dự phòng gắn một tài khoản thật ngăn Dự
// phòng; nhiều mục tiêu dùng chung được một tài khoản — A (đã có) chia từ số dư theo thứ tự ưu tiên (`fillGoals`). Phần an
// tâm và nợ ngắn hạn tính ra, không lưu.

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
/** Tài khoản đang dùng kèm số trong sổ (`v_account_book`); `parentId` = tài khoản mẹ khi là khoản gửi kỳ hạn (ADR-140). */
export interface PocketAccount {
  id: string;
  name: string;
  pocket: Pocket | null;
  confirmed: boolean;
  balance: number;
  parentId?: string | null;
}

/** Nơi để tiền của mục tiêu (ADR-141): một tài khoản để dành (mặc định) hoặc trả thẳng từ tiền chi tiêu (ngăn Vận hành). */
export type GoalPaysFrom = "account" | "operating";

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
  /** Thứ tự ưu tiên (`reserve_goals.sort`, nhỏ đứng trước — UC-1209 bước 10). */
  sort: number;
  /** Đã chi cho mục tiêu trong kỳ lương hiện tại (UC-1209 bước 11); 0 khi không có. */
  spent: number;
  /** Thiếu = `account`. `operating`: `accountId` null, lặp mỗi tháng — không vào `reserve`, vào `operating.goals`. */
  paysFrom?: GoalPaysFrom;
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
  /** Số trong sổ của riêng tài khoản này (không gộp con). */
  balance: number;
  /** Mục tiêu Dự phòng đang dùng gắn tài khoản này, theo thứ tự ưu tiên; rỗng = không gắn. */
  goalIds: string[];
  /** Tài khoản mẹ (khoản gửi kỳ hạn); null = không phải tài khoản con. */
  parentId: string | null;
}
export interface PocketGoal {
  id: string;
  name: string;
  accountId: string | null;
  /** A = đã có sau khi chia số dư tài khoản (UC-1209 bước 9; có thể âm); null = chưa gắn tài khoản. */
  held: number | null;
  /** Số cần (= B); null với mục tiêu % hoặc chưa gắn tài khoản. */
  need: number | null;
  /** Đã chi cho mục tiêu trong kỳ lương hiện tại. */
  spent: number;
  /** Còn thiếu = max(0, need − held − spent); null khi need null. */
  short: number | null;
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
/**
 * Nhóm mục tiêu của một tài khoản mẹ (UC-1203 bước 7) — tính ra, không lưu. `balance` = số dư gộp (mẹ + con đang dùng); số
 * chia cho mục tiêu = `balance − interest` (QĐ2). `need` / `short` / `extra` null khi nhóm là mục tiêu %.
 */
export interface GoalGroup {
  accountId: string;
  name: string;
  balance: number;
  need: number | null;
  spent: number;
  short: number | null;
  extra: number | null;
  goalIds: string[];
  /** Tài khoản con đang dùng của mẹ, theo thứ tự tài khoản. */
  childIds: string[];
  /** Tiền lãi của nhóm (`groupInterest`): không tính vào mục tiêu. */
  interest: number;
}

/** Mục tiêu trả thẳng từ tiền chi tiêu (UC-1203 bước 7, ADR-141): còn phải trả kỳ này = max(0, mỗi tháng − đã chi từ Vận hành). */
export interface OperatingGoal {
  id: string;
  name: string;
  monthly: number;
  spent: number;
  remaining: number;
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
    /** Chỉ mục tiêu để ở tài khoản (`paysFrom` `account`); mục tiêu trả từ tiền chi tiêu ở `operating.goals`. */
    goals: PocketGoal[];
    /** Mỗi tài khoản mẹ có ít nhất một mục tiêu đang dùng, theo thứ tự mục tiêu đầu tiên của nhóm. */
    groups: GoalGroup[];
    /**
     * Σ tài khoản Dự phòng không gắn mục tiêu đang dùng, không phải tài khoản Ví Thưởng, không phải con của tài khoản có mục
     * tiêu hay của Ví Thưởng (âm thì giữ âm).
     */
    peace: number;
    peaceMonths: PeaceMonths;
    /** Tài khoản Ví Thưởng (`config.surplus_reward_account`) khi đang dùng, ở ngăn Dự phòng, không gắn mục tiêu; `balance` gộp con; null = chưa chọn. */
    reward: { accountId: string; balance: number } | null;
  };
  /** `goals`: mục tiêu trả từ tiền chi tiêu theo thứ tự ưu tiên; `remaining` = R = Σ còn phải trả kỳ này. */
  operating: { total: number; accounts: PocketAccountLine[]; goals: OperatingGoal[]; remaining: number };
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
  /** Tiền lãi theo tài khoản mẹ có mục tiêu (`groupInterest`); thiếu = 0. */
  interest?: Record<string, number>;
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

/** Thứ tự ưu tiên (UC-1209 bước 10): `sort` tăng dần, rồi hạn (chưa có hạn xuống cuối), rồi tên (`vi`), rồi mã. */
export const goalOrder = (a: Pick<PocketGoalInput, "id" | "sort" | "dueDate" | "name">, b: Pick<PocketGoalInput, "id" | "sort" | "dueDate" | "name">) =>
  a.sort - b.sort ||
  (a.dueDate === b.dueDate ? 0 : a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate < b.dueDate ? -1 : 1) ||
  a.name.localeCompare(b.name, "vi") ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Số cần của mục tiêu = B (lặp: tích đã lưu ở `target_amount`); mục tiêu % (Thuế) không có số cần. */
export const goalNeed = (g: Pick<PocketGoalInput, "target" | "targetPct">): number | null => (g.targetPct !== null ? null : g.target);

export interface FillGoalInput {
  id: string;
  need: number | null;
  spent: number;
}
export interface FillGoals {
  goals: { id: string; held: number; spent: number; short: number | null }[];
  need: number | null;
  spent: number;
  short: number | null;
  extra: number | null;
}

/**
 * Chia số dư một tài khoản cho các mục tiêu của nó, đã xếp theo thứ tự ưu tiên (pocket UC-1209 bước 9, QĐ2-A, QĐ3).
 * quỹ = số dư + Σ đã chi (kẹp ≥ 0); mỗi mục tiêu trừ mục tiêu cuối lấy phần = min(max(số cần, đã chi), max(còn, 0)); mục tiêu
 * cuối nhận phần còn lại; đã có (held) = phần − đã chi. Bất biến Σ held = số dư. Mục tiêu % chỉ đứng một mình (QĐ1-A).
 */
export function fillGoals(balance: number, goals: FillGoalInput[]): FillGoals {
  if (goals.some((g) => g.need === null)) {
    if (goals.length !== 1) throw new Error("fillGoals: mục tiêu % không dùng chung tài khoản");
    const spent = Math.max(0, goals[0]!.spent);
    return { goals: [{ id: goals[0]!.id, held: balance, spent, short: null }], need: null, spent, short: null, extra: null };
  }
  const spents = goals.map((g) => Math.max(0, g.spent));
  let left = balance + spents.reduce((s, x) => s + x, 0);
  const out = goals.map((g, i) => {
    const need = g.need!;
    const part = i === goals.length - 1 ? left : Math.min(Math.max(need, spents[i]!), Math.max(left, 0));
    left -= part;
    const held = part - spents[i]!;
    return { id: g.id, held, spent: spents[i]!, short: Math.max(0, need - held - spents[i]!) };
  });
  const last = out.at(-1);
  const lastNeed = goals.at(-1)?.need ?? 0;
  return {
    goals: out,
    need: goals.reduce((s, g) => s + g.need!, 0),
    spent: spents.reduce((s, x) => s + x, 0),
    short: out.reduce((s, g) => s + g.short!, 0),
    extra: last ? Math.max(0, Math.min(last.held, last.held + last.spent - lastNeed)) : 0,
  };
}

/** Đã có / đã chi / còn thiếu của một mục tiêu đang dùng có tài khoản (kết quả `fillGoals`). */
export type FilledGoal = FillGoals["goals"][number];

/**
 * Nhóm mục tiêu tài khoản đang dùng theo tài khoản mẹ (đang dùng) và chia `số dư gộp − tiền lãi` của từng nhóm (UC-1209 bước
 * 9, QĐ2) — một luật cho snapshot, `GET /v1/settings`, việc ②, trừ tạm hàng đợi. Số dư gộp = mẹ + Σ con đang dùng (`parentId`).
 * `goals` đã xếp theo `goalOrder`; nhóm theo mục tiêu đầu tiên của nhóm; mục tiêu trả từ tiền chi tiêu bị bỏ qua.
 */
export function goalGroups(
  accounts: Pick<PocketAccount, "id" | "name" | "balance" | "parentId">[],
  goals: PocketGoalInput[],
  interest: Record<string, number> = {},
): { groups: GoalGroup[]; filled: Map<string, FilledGoal> } {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const goalsOf = new Map<string, PocketGoalInput[]>();
  for (const g of goals) {
    if (g.paysFrom === "operating" || g.accountId === null || !byId.has(g.accountId)) continue;
    goalsOf.set(g.accountId, [...(goalsOf.get(g.accountId) ?? []), g]);
  }
  const filled = new Map<string, FilledGoal>();
  const groups: GoalGroup[] = [];
  for (const [accountId, list] of goalsOf) {
    const account = byId.get(accountId)!;
    const children = accounts.filter((a) => a.parentId === accountId);
    const balance = account.balance + children.reduce((s, c) => s + c.balance, 0);
    const lockedInterest = interest[accountId] ?? 0;
    const fill = fillGoals(balance - lockedInterest, list.map((g) => ({ id: g.id, need: goalNeed(g), spent: g.spent })));
    for (const g of fill.goals) filled.set(g.id, g);
    groups.push({
      accountId,
      name: account.name,
      balance,
      need: fill.need,
      spent: fill.spent,
      short: fill.short,
      extra: fill.extra,
      goalIds: list.map((g) => g.id),
      childIds: children.map((c) => c.id),
      interest: lockedInterest,
    });
  }
  return { groups, filled };
}

/** Một giao dịch chạm nhóm mẹ + con, theo (`at`, `id`): số dư gộp đổi `delta`; `interest` = khoản lãi vào; `fromInterest` = rút từ lãi. */
export interface InterestStep {
  delta: number;
  interest: number;
  fromInterest: number;
}

/**
 * Tiền lãi của nhóm (QĐ2, ADR-140) — cộng dồn theo thời gian, kẹp từng bước: bắt đầu 0, sau mỗi giao dịch I = min(max(0, I +
 * lãi vào − rút từ lãi), max(0, số dư gộp sau giao dịch)). `opening` = Σ số dư đầu của mẹ và mọi con (kể cả con đã tắt).
 */
export function groupInterest(opening: number, steps: InterestStep[]): number {
  let balance = opening;
  let interest = 0;
  for (const s of steps) {
    balance += s.delta;
    interest = Math.min(Math.max(0, interest + s.interest - s.fromInterest), Math.max(0, balance));
  }
  return interest;
}

/** Mục tiêu trả từ tiền chi tiêu đang dùng (đã xếp `goalOrder`): còn phải trả kỳ này = max(0, mỗi tháng − đã chi). */
export function operatingGoals(goals: PocketGoalInput[]): OperatingGoal[] {
  return goals.flatMap((g) => {
    if (g.paysFrom !== "operating" || g.monthly === null) return [];
    const spent = Math.max(0, g.spent);
    return [{ id: g.id, name: g.name, monthly: g.monthly, spent, remaining: Math.max(0, g.monthly - spent) }];
  });
}

/**
 * Bất biến: bốn tổng cộng lại = Σ sổ mọi tài khoản đang dùng. A của mục tiêu = phần chia từ số dư gộp − tiền lãi của tài
 * khoản mẹ (`goalGroups`); phần an tâm = tài khoản Dự phòng không gắn mục tiêu, không phải Ví Thưởng, không phải con của tài
 * khoản có mục tiêu hay của Ví Thưởng. Mục tiêu trả từ tiền chi tiêu không vào ngăn Dự phòng (`operating.goals`). Tích luỹ tại
 * mỗi mốc theo trạng thái tại mốc (ADR-100), ngăn theo giá trị đang lưu.
 */
export function pocketsView({ accounts, goals, rewardAccountId, debts, savingsPct, history, operatingSpend, peaceTarget, interest }: PocketsInput): PocketsView {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ordered = [...goals].sort(goalOrder);
  const accountGoals = ordered.filter((g) => g.paysFrom !== "operating");
  const { groups, filled } = goalGroups(accounts, accountGoals, interest);
  const goalIdsOf = new Map(groups.map((g) => [g.accountId, g.goalIds]));
  const totals = pocketTotals(accounts);
  const lines: Record<Pocket | "outside", PocketAccountLine[]> = { savings: [], reserve: [], operating: [], outside: [] };
  for (const a of accounts) lines[a.pocket ?? "outside"].push({ id: a.id, name: a.name, balance: a.balance, goalIds: goalIdsOf.get(a.id) ?? [], parentId: a.parentId ?? null });
  const savingsAt = (mark: "since" | "prevSince") =>
    pocketTotals(history.accounts.flatMap((a) => (a[mark] === null ? [] : [{ pocket: a.pocket, balance: a[mark] }]))).savings;
  const atSince = savingsAt("since");
  const goalLines: PocketGoal[] = accountGoals.map(({ id, name, accountId, target, targetPct, monthly, repeatMonths, dueDate, debtId, spent }) => {
    const f = filled.get(id);
    return {
      id,
      name,
      accountId,
      held: f ? f.held : null,
      need: f ? goalNeed({ target, targetPct }) : null,
      spent: f ? f.spent : Math.max(0, spent),
      short: f ? f.short : null,
      target,
      targetPct,
      monthly,
      repeatMonths,
      dueDate,
      debtId,
    };
  });
  const rewardAccount = rewardAccountId === null ? undefined : byId.get(rewardAccountId);
  const reward =
    rewardAccount && rewardAccount.pocket === "reserve" && !goalIdsOf.has(rewardAccount.id)
      ? { accountId: rewardAccount.id, balance: accounts.filter((a) => a.id === rewardAccount.id || a.parentId === rewardAccount.id).reduce((s, a) => s + a.balance, 0) }
      : null;
  const owner = (a: PocketAccountLine) => a.parentId ?? a.id;
  const peace = lines.reserve.filter((a) => a.goalIds.length === 0 && !goalIdsOf.has(owner(a)) && owner(a) !== reward?.accountId).reduce((s, a) => s + a.balance, 0);
  const opGoals = operatingGoals(ordered);
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
      groups,
      peace,
      peaceMonths: { covered: peaceMonthsView(peace, spend.monthly, peaceTarget).covered, target: peaceTarget, monthly: spend.monthly, cycles: spend.cycles },
      reward,
    },
    operating: { total: totals.operating, accounts: lines.operating, goals: opGoals, remaining: opGoals.reduce((s, g) => s + g.remaining, 0) },
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
