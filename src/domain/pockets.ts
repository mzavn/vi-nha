// Ba ngăn Tích luỹ · Dự phòng · Vận hành (pocket UC-1201…1203, UC-1209, ADR-119, ADR-132) — hàm thuần, snapshot và PWA dùng
// chung. Một nguồn số cho tiền: số trong sổ của tài khoản đang dùng. Mỗi mục tiêu Dự phòng gắn một tài khoản thật ngăn Dự
// phòng; nhiều mục tiêu dùng chung được một tài khoản — A (đã có) chia từ số dư theo thứ tự ưu tiên (`fillGoals`). Phần an
// tâm và nợ ngắn hạn tính ra, không lưu.

import type { QrTarget } from "./month-tasks";
import { monthKey } from "./period";
import { DomainError } from "./types";

export const POCKETS = ["savings", "reserve", "operating"] as const;
export type Pocket = (typeof POCKETS)[number];

/** Trần số tiền của mục tiêu / hạn mức (đồng). */
export const MONEY_MAX = 1e12;
/** % Tích luỹ trích từ mỗi khoản lương khi chưa đặt (config `savings_pct`, UC-507). */
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
  /** Đã chi cho mục tiêu trong cửa sổ của nó (UC-1209 bước 11, AC-24), gồm số các việc chuyển về kiểu B chưa huỷ (AC-28); 0 khi không có. */
  spent: number;
  /** Thiếu = `account`. `operating`: `accountId` null, lặp mỗi tháng — không vào `reserve`, vào `operating.goals`. */
  paysFrom?: GoalPaysFrom;
  /** Mục tiêu `operating`: số riêng cho tháng VN hiện tại (UC-1209 bước 12, ADR-143, ADR-144); thiếu / null = theo số mỗi tháng. */
  monthAmount?: number | null;
  /** Lý do ngắn của số tháng này; null = không có. */
  monthNote?: string | null;
  /** Mục tiêu `operating`: danh mục mà khoản chi từ Vận hành không gắn mục tiêu tính là đã trả (đã gộp vào `spent`). */
  categoryIds?: string[];
  /** Đã chốt xong trong kỳ hiện tại (`goalClosedInPeriod`, UC-1209 AC-25): phần cố định, không nhận phần còn lại. */
  closed?: boolean;
  /** Lúc chốt (ISO) khi `closed`; null = chưa chốt. */
  closedAt?: string | null;
  /** Σ (số − đã nhận) của các việc chuyển về đang mở của mục tiêu (AC-28): giữ riêng, trừ khỏi số chia của nhóm trước khi chia. */
  pendingRefund?: number;
  /** Σ khoản chi kiểu B (từ tài khoản khác, đã trừ hoàn) đã khớp trong cửa sổ — "Trả từ {tài khoản} X". */
  advance?: number;
  /** Tên các tài khoản đã trả kiểu B, theo thứ tự khoản. */
  advanceFrom?: string[];
  /** Mục tiêu lặp N tháng (N > 1): id đợt đang mở (`goal_periods`); null = đợt đầu chưa có dòng, hoặc mục tiêu khác. */
  periodId?: number | null;
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
  /** Đã chi cho mục tiêu trong tháng VN hiện tại. */
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
  /** Đã chốt xong trong kỳ hiện tại (UC-1209 AC-25). */
  closed: boolean;
  closedAt: string | null;
  /** Dư sau chốt = max(0, đã có) khi đã chốt; 0 nếu không. */
  leftover: number;
  /** Vượt = max(0, đã chi − cần); 0 với mục tiêu %. */
  over: number;
  /** Gợi ý "Đã chi đủ · Chốt xong": chưa chốt và đã chi ≥ cần (AC-26). */
  suggestClose: boolean;
  /** Thiếu vì mục tiêu đứng trước chi vượt (AC-26): mỗi phần ≤ số thiếu của mục tiêu này. */
  shortBecause: { goalId: string; amount: number }[];
  advance: number;
  advanceFrom: string[];
  pendingRefund: number;
  /** Mục tiêu lặp N tháng: id đợt đang mở — gửi kèm `POST /v1/goals/:id/close|reopen` (`period_id`); null với đợt đầu chưa có dòng / mục tiêu khác. */
  periodId: number | null;
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
  /** Σ phần chờ chuyển về của các việc đang mở (UC-1209 AC-28): không vào đã có của mục tiêu nào, không vào dư. */
  pending: number;
  /** Phần còn lại khi mọi mục tiêu của nhóm đã chốt (AC-25); 0 khi còn mục tiêu chưa chốt. */
  free: number;
  /** Số khoản chi / chuyển ra khỏi nhóm chưa gắn mục tiêu trong cửa sổ sớm nhất của các mục tiêu chưa chốt; 0 khi nhóm có < 2 mục tiêu chưa chốt. */
  unmatched: number;
}

/** Việc chuyển về kiểu B (UC-1209 AC-28, AC-29) như `snapshot.pockets.reserve.refunds[]`. */
export interface GoalRefundView {
  id: number;
  goalId: string;
  goalName: string;
  spendTxId: number;
  /** Tài khoản mục tiêu (chuyển từ). */
  fromAccountId: string;
  /** Tài khoản đã trả (chuyển về). */
  toAccountId: string;
  amount: number;
  /** Σ chuyển khoản đã ghép. */
  linked: number;
  /** Còn phải chuyển = max(0, số − đã ghép) khi đang mở; 0 khi xong / bỏ qua. */
  missing: number;
  /** `done` gồm cả tự xong (đã ghép đủ). */
  status: "open" | "done" | "skipped";
  reason: string | null;
  code: string;
  /** Nội dung chuyển khoản "CV {mã} T{tháng}". */
  memo: string;
  /** QR tới tài khoản đã trả; null khi không có số tài khoản hoặc một đầu bị giấu. */
  qr: QrTarget | null;
  /** Một đầu là tài khoản riêng tư của người khác: không hiện số tài khoản / QR. */
  hidden: boolean;
  createdAt: string;
}

/**
 * Mục tiêu trả thẳng từ tiền chi tiêu (UC-1203 bước 7, UC-1209 bước 12, ADR-141, ADR-143, ADR-144): còn phải trả tháng này =
 * max(0, số tháng này − đã trả); số tháng này = `monthAmount` nếu có, không thì `monthly`.
 */
export interface OperatingGoal {
  id: string;
  name: string;
  monthly: number;
  /** Số riêng cho tháng này (0 = tháng này không trả); null = theo số mỗi tháng. */
  monthAmount: number | null;
  note: string | null;
  categoryIds: string[];
  spent: number;
  remaining: number;
}

/** Tích luỹ thay đổi theo tháng (UC-1203 bước 10): `amount` = bây giờ − đầu tháng; `prevAmount` = đầu tháng − đầu tháng trước. */
export interface SavingsChange {
  since: string;
  amount: number;
  prevSince: string;
  prevAmount: number;
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
    /** Tài khoản Ví Thưởng (`config.surplus_reward_account`) khi đang dùng, ở ngăn Dự phòng, không gắn mục tiêu; `balance` gộp con; null = chưa chọn. */
    reward: { accountId: string; balance: number } | null;
    /** Việc chuyển về chưa huỷ: đang mở, hoặc khoản chi nằm trong cửa sổ của mục tiêu (UC-1209 AC-28). */
    refunds: GoalRefundView[];
  };
  /** `goals`: mục tiêu trả từ tiền chi tiêu theo thứ tự ưu tiên; `remaining` = R = Σ còn phải trả tháng này. */
  operating: { total: number; accounts: PocketAccountLine[]; goals: OperatingGoal[]; remaining: number };
  outside: { total: number; accounts: PocketAccountLine[] };
  unconfirmed: number;
  savingsPct: number;
  /** Nợ ngắn hạn cần trả — chỉ để nhắc, không trừ vào ngăn nào. */
  shortDebt: { total: number; count: number; items: ShortDebtItem[] };
}

/** Một tài khoản ở hai mốc đầu tháng / đầu tháng trước: số trong sổ tại mốc; null = không tính ở mốc đó (đã tắt trước mốc). */
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
  /** Trạng thái tại đầu tháng (`since`) và đầu tháng trước (`prevSince`), ngày `YYYY-MM-DD` giờ VN. */
  history: { since: string; prevSince: string; accounts: PocketAccountAt[] };
  /** Tiền lãi theo tài khoản mẹ có mục tiêu (`groupInterest`); thiếu = 0. */
  interest?: Record<string, number>;
  /** `unmatched` theo tài khoản mẹ có mục tiêu; thiếu = 0. */
  unmatched?: Record<string, number>;
  /** Việc chuyển về để hiện (`reserve.refunds`); thiếu = []. */
  refunds?: GoalRefundView[];
}

type Totals = Record<Pocket | "outside", number>;

/** Tổng ngăn X = Σ sổ các tài khoản ngăn X — một luật cho số bây giờ và số tại mỗi mốc đầu tháng. */
function pocketTotals(accounts: Pick<PocketAccount, "pocket" | "balance">[]): Totals {
  const totals: Totals = { savings: 0, reserve: 0, operating: 0, outside: 0 };
  for (const a of accounts) totals[a.pocket ?? "outside"] += a.balance;
  return totals;
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
  /** Đã chốt xong trong kỳ (UC-1209 AC-25): phần cố định, không nhận phần còn lại. */
  closed?: boolean;
}
export interface FillGoals {
  goals: {
    id: string;
    held: number;
    spent: number;
    short: number | null;
    closed: boolean;
    leftover: number;
    over: number;
    suggestClose: boolean;
    shortBecause: { goalId: string; amount: number }[];
  }[];
  need: number | null;
  spent: number;
  short: number | null;
  extra: number | null;
  /** Phần còn lại khi mọi mục tiêu đã chốt; 0 khi còn mục tiêu chưa chốt. */
  free: number;
}

/**
 * Chia số dư một tài khoản cho các mục tiêu của nó, đã xếp theo thứ tự ưu tiên (pocket UC-1209 bước 9, QĐ2-A, QĐ3, AC-25, AC-26).
 * quỹ = số dư − `pending` (phần chờ chuyển về, AC-28) + Σ đã chi; mỗi mục tiêu trừ mục tiêu chưa chốt cuối lấy phần = min(max(số
 * cần, đã chi), max(còn, 0)) — mục tiêu đã chốt giữ phần đó cố định; mục tiêu chưa chốt cuối nhận phần còn lại; mọi mục tiêu đã
 * chốt → phần còn lại là `free`. Đã có (held) = phần − đã chi. Bất biến Σ held + free = số dư − pending. `shortBecause`: phần vượt
 * max(0, đã chi − cần) của các mục tiêu đứng trước, phân từ mục tiêu cuối lên, mỗi mục tiêu tổng ≤ số thiếu của nó. Mục tiêu % chỉ
 * đứng một mình (QĐ1-A).
 */
export function fillGoals(balance: number, goals: FillGoalInput[], pending = 0): FillGoals {
  const base = balance - pending;
  if (goals.some((g) => g.need === null)) {
    if (goals.length !== 1) throw new Error("fillGoals: mục tiêu % không dùng chung tài khoản");
    const g = goals[0]!;
    const spent = Math.max(0, g.spent);
    return {
      goals: [{ id: g.id, held: base, spent, short: null, closed: g.closed ?? false, leftover: 0, over: 0, suggestClose: false, shortBecause: [] }],
      need: null,
      spent,
      short: null,
      extra: null,
      free: 0,
    };
  }
  const spents = goals.map((g) => Math.max(0, g.spent));
  const lastOpen = goals.reduce((at, g, i) => (g.closed ? at : i), -1);
  let left = base + spents.reduce((s, x) => s + x, 0);
  const parts = goals.map((g, i) => {
    if (i === lastOpen) return 0;
    const part = Math.min(Math.max(g.need!, spents[i]!), Math.max(left, 0));
    left -= part;
    return part;
  });
  if (lastOpen >= 0) {
    parts[lastOpen] = left;
    left = 0;
  }
  const out = goals.map((g, i) => {
    const need = g.need!;
    const spent = spents[i]!;
    const held = parts[i]! - spent;
    const closed = g.closed ?? false;
    return {
      id: g.id,
      held,
      spent,
      short: Math.max(0, need - held - spent),
      closed,
      leftover: closed ? Math.max(0, held) : 0,
      over: Math.max(0, spent - need),
      suggestClose: !closed && spent >= need,
      shortBecause: [] as { goalId: string; amount: number }[],
    };
  });
  const overLeft = out.map((g) => g.over);
  for (let i = out.length - 1; i > 0; i--) {
    let cap = out[i]!.short;
    for (let j = 0; j < i && cap > 0; j++) {
      const take = Math.min(cap, overLeft[j]!);
      if (take <= 0) continue;
      out[i]!.shortBecause.push({ goalId: out[j]!.id, amount: take });
      overLeft[j] = overLeft[j]! - take;
      cap -= take;
    }
  }
  const last = lastOpen >= 0 ? out[lastOpen] : undefined;
  const lastNeed = lastOpen >= 0 ? goals[lastOpen]!.need! : 0;
  return {
    goals: out,
    need: goals.reduce((s, g) => s + g.need!, 0),
    spent: spents.reduce((s, x) => s + x, 0),
    short: out.reduce((s, g) => s + g.short, 0),
    extra: last ? Math.max(0, Math.min(last.held, last.held + last.spent - lastNeed)) : 0,
    free: left,
  };
}

/** Đã có / đã chi / còn thiếu của một mục tiêu đang dùng có tài khoản (kết quả `fillGoals`). */
export type FilledGoal = FillGoals["goals"][number];

/**
 * Nhóm mục tiêu tài khoản đang dùng theo tài khoản mẹ (đang dùng) và chia `số dư gộp − tiền lãi − pending` của từng nhóm (UC-1209
 * bước 9, QĐ2, AC-25, AC-28) — một luật cho snapshot, `GET /v1/settings`, việc ②, trừ tạm hàng đợi. Số dư gộp = mẹ + Σ con đang
 * dùng (`parentId`); `pending` = Σ `pendingRefund` của các mục tiêu trong nhóm. `goals` đã xếp theo `goalOrder`; nhóm theo mục tiêu
 * đầu tiên của nhóm; mục tiêu trả từ tiền chi tiêu bị bỏ qua. `unmatched` theo tài khoản mẹ (đếm ở services); thiếu = 0.
 */
export function goalGroups(
  accounts: Pick<PocketAccount, "id" | "name" | "balance" | "parentId">[],
  goals: PocketGoalInput[],
  interest: Record<string, number> = {},
  unmatched: Record<string, number> = {},
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
    const pending = list.reduce((s, g) => s + (g.pendingRefund ?? 0), 0);
    const fill = fillGoals(balance - lockedInterest, list.map((g) => ({ id: g.id, need: goalNeed(g), spent: g.spent, closed: g.closed ?? false })), pending);
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
      pending,
      free: fill.free,
      unmatched: unmatched[accountId] ?? 0,
    });
  }
  return { groups, filled };
}

/**
 * Mục tiêu đã chốt xong trong kỳ hiện tại (UC-1209 AC-25): một lần = có lúc chốt; hằng tháng = lúc chốt trong tháng VN của `now`;
 * lặp N tháng (N > 1) không chốt ở đây — chốt khép đợt (`goal_periods`). Một luật với `goalClosedSql` (trigger 0049, `GOAL_VALUE`).
 */
export function goalClosedInPeriod(g: { repeatMonths: number | null; closedAt: string | null }, now: Date): boolean {
  if (g.closedAt === null) return false;
  return g.repeatMonths === null || (g.repeatMonths === 1 && monthKey(g.closedAt) === monthKey(now));
}

/** `goalClosedInPeriod` viết bằng SQL cho mục tiêu bí danh `g`; `vnMonth` = biểu thức tháng VN hiện tại ('YYYY-MM'). */
export const goalClosedSql = (g: string, vnMonth: string) =>
  `(${g}.closed_at IS NOT NULL AND (${g}.repeat_months IS NULL OR (${g}.repeat_months = 1 AND strftime('%Y-%m', ${g}.closed_at, '+7 hours') = ${vnMonth})))`;

/** Hạn của đợt sau (Q1): `day` + `months` tháng, kẹp ngày cuối tháng (31/01 + 1 → 28/02). */
export function addMonthsToDay(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
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

/** Mục tiêu trả từ tiền chi tiêu đang dùng (đã xếp `goalOrder`): còn phải trả tháng này = max(0, số tháng này − đã trả). */
export function operatingGoals(goals: PocketGoalInput[]): OperatingGoal[] {
  return goals.flatMap((g) => {
    if (g.paysFrom !== "operating" || g.monthly === null) return [];
    const spent = Math.max(0, g.spent);
    const monthAmount = g.monthAmount ?? null;
    return [{ id: g.id, name: g.name, monthly: g.monthly, monthAmount, note: g.monthNote ?? null, categoryIds: g.categoryIds ?? [], spent, remaining: Math.max(0, (monthAmount ?? g.monthly) - spent) }];
  });
}

/**
 * Bất biến: bốn tổng cộng lại = Σ sổ mọi tài khoản đang dùng. A của mục tiêu = phần chia từ số dư gộp − tiền lãi của tài
 * khoản mẹ (`goalGroups`); `peace` (Dự phòng chưa gắn mục tiêu) = tài khoản Dự phòng không gắn mục tiêu, không phải Ví Thưởng, không phải con của tài
 * khoản có mục tiêu hay của Ví Thưởng. Mục tiêu trả từ tiền chi tiêu không vào ngăn Dự phòng (`operating.goals`). Tích luỹ tại
 * mỗi mốc theo trạng thái tại mốc (ADR-100), ngăn theo giá trị đang lưu.
 */
export function pocketsView({ accounts, goals, rewardAccountId, debts, savingsPct, history, interest, unmatched, refunds = [] }: PocketsInput): PocketsView {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ordered = [...goals].sort(goalOrder);
  const accountGoals = ordered.filter((g) => g.paysFrom !== "operating");
  const { groups, filled } = goalGroups(accounts, accountGoals, interest, unmatched);
  const goalIdsOf = new Map(groups.map((g) => [g.accountId, g.goalIds]));
  const totals = pocketTotals(accounts);
  const lines: Record<Pocket | "outside", PocketAccountLine[]> = { savings: [], reserve: [], operating: [], outside: [] };
  for (const a of accounts) lines[a.pocket ?? "outside"].push({ id: a.id, name: a.name, balance: a.balance, goalIds: goalIdsOf.get(a.id) ?? [], parentId: a.parentId ?? null });
  const savingsAt = (mark: "since" | "prevSince") =>
    pocketTotals(history.accounts.flatMap((a) => (a[mark] === null ? [] : [{ pocket: a.pocket, balance: a[mark] }]))).savings;
  const atSince = savingsAt("since");
  const goalLines: PocketGoal[] = accountGoals.map((g) => {
    const { id, name, accountId, target, targetPct, monthly, repeatMonths, dueDate, debtId, spent } = g;
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
      closed: f ? f.closed : (g.closed ?? false),
      closedAt: g.closed ? (g.closedAt ?? null) : null,
      leftover: f ? f.leftover : 0,
      over: f ? f.over : 0,
      suggestClose: f ? f.suggestClose : false,
      shortBecause: f ? f.shortBecause : [],
      advance: g.advance ?? 0,
      advanceFrom: g.advanceFrom ?? [],
      pendingRefund: g.pendingRefund ?? 0,
      periodId: g.periodId ?? null,
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
      reward,
      refunds,
    },
    operating: { total: totals.operating, accounts: lines.operating, goals: opGoals, remaining: opGoals.reduce((s, g) => s + g.remaining, 0) },
    outside: { total: totals.outside, accounts: lines.outside },
    unconfirmed: accounts.filter((a) => !a.confirmed).length,
    savingsPct,
    shortDebt: { total: items.reduce((s, d) => s + d.balance, 0), count: items.length, items },
  };
}

/** Lời chúc khi không còn nợ ngắn hạn (thẻ Vận hành, dòng nợ ngắn hạn tin sáng), đúng thứ tự xoay. */
export const BLESSINGS = [
  "Không còn nợ ngắn hạn — tiền vận hành là của mình trọn vẹn",
  "Sạch nợ ngắn hạn — mỗi đồng chi hôm nay là tiền của mình",
  "Không nợ ngắn hạn nào. Giữ nhịp này nhé",
  "Hết nợ ngắn hạn — tháng này nhẹ hẳn",
] as const;

/** Lời chúc của ngày `YYYY-MM-DD` (giờ VN): số ngày từ 1970-01-01 mod 4. */
export function blessingFor(day: string): string {
  return BLESSINGS[Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000) % 4]!;
}
