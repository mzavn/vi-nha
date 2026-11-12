// Màn "Hôm nay", tin Telegram sáng và tool MCP `get_snapshot` đều lấy số từ đúng một hàm này.

import type { PayCycleView, QrTarget } from "./pay-cycle";
import { dayKey, monthKey, weekKey, weeksLeftInMonth } from "./period";
import type { Pocket, PocketsView } from "./pockets";

export interface SnapshotData {
  now: Date;
  pending: { count: number; net: number };
  drift: { accountId: string; name: string; bookDrift: number | null }[];
  /** Log chờ của tài khoản riêng tư bị giấu với người xem (access UC-504): Gán chỉ hiện một dòng đếm. */
  hiddenPendingLogs: number;
  /** Tài khoản riêng tư bị giấu với người xem (access UC-504): không gợi ý làm nguồn chuyển thêm (`topUp.sources`). */
  hiddenAccountIds: readonly string[];
  /** Tài khoản đang dùng kèm ngăn — cho `nearSpend.excluded`. */
  accounts: { id: string; name: string; pocket: Pocket | null }[];
  /** Ba ngăn (pocket UC-1203), tính trước: tiền vận hành = tổng ngăn Vận hành. */
  pockets: PocketsView;
  /** Ngày lương (`config.payday_day`, 1–31). */
  paydayDay: number;
  /** Kỳ lương hiện tại và danh sách việc (pocket UC-1205, UC-1206); null = chưa có kỳ. */
  payCycle: PayCycleView | null;
  /** Phần chưa làm theo việc ngày lương (ledger UC-103) — trừ trước khi chia theo ngày. */
  pendingTasks: number;
  /** Đích của lời nhắc chuyển thêm: tài khoản ngân hàng ngăn Vận hành có số tài khoản đầu tiên (luật QR UC-1206 bước 10), không bị giấu với người xem (access UC-504); null = không có. */
  topUpTo: QrTarget | null;
  /** Có nguồn đang dùng bật "Mở kỳ lương" (UC-1205 bước 9). */
  hasCycleStream: boolean;
  /** Màn chuyển đổi còn dở (pocket UC-1208); null = không có / đã xong. */
  conversion: ConversionProgress | null;
}

/** Monday..Sunday của tuần chứa `now`, theo giờ VN. */
function weekRange(now: Date): { start: string; end: string } {
  const today = dayKey(now);
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  const start = new Date(d.getTime() - (dow - 1) * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Ngày lương mặc định khi chưa đặt `config.payday_day`. */
export const DEFAULT_PAYDAY_DAY = 10;

const DAY_MS = 86_400_000;

/** Ngày lương của tháng `month0` (có thể âm / quá 11): tháng ít ngày hơn `paydayDay` lấy ngày cuối tháng. */
export function paydayIn(year: number, month0: number, paydayDay: number): Date {
  const day = Math.min(paydayDay, new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month0, day));
}

/**
 * Ngày lương kế tiếp (`YYYY-MM-DD`) sau `today` (ngày VN, `dayKey`): ngày lương của tháng này nếu hôm nay còn trước nó,
 * ngược lại của tháng sau. Ngày lương là ngày đầu kỳ mới; tháng ít ngày hơn `paydayDay` lấy ngày cuối tháng.
 */
export function nextPayday(today: string, paydayDay: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const thisMonth = paydayIn(y, m - 1, paydayDay);
  return (d < thisMonth.getUTCDate() ? thisMonth : paydayIn(y, m, paydayDay)).toISOString().slice(0, 10);
}

/** Các số theo ngày của tiền vận hành — hàm thuần, PWA dùng lại để trừ tạm hàng đợi và tính lại khi mở bản lưu cũ. */
export interface NearSpendView {
  payday: string;
  /** Từ hôm nay (tính cả hôm nay) tới hết ngày trước ngày lương kế tiếp; luôn ≥ 1. */
  daysLeft: number;
  /** Tròn xuống 1.000; null khi hết tiền hoặc dưới 1.000. Tính trên `amount − pendingTasks − goalRemaining`. */
  perDay: number | null;
  /** 2 bữa: mỗi ngày (đã tròn) ÷ 2, tròn xuống 5.000; null khi dưới 5.000. */
  perMeal: number | null;
  /** 1 lần/ngày: mỗi ngày (đã tròn), tròn xuống 10.000; null khi dưới 10.000. */
  perMarket: number | null;
  /** Phần chưa làm theo danh sách việc ngày lương (ledger UC-103): trừ trước khi chia theo ngày; 0 khi không có kỳ. */
  pendingTasks: number;
  /** R: còn phải trả kỳ này của các mục tiêu trả từ tiền chi tiêu (ADR-141) — trừ trước khi chia theo ngày; 0 khi không có. */
  goalRemaining: number;
}

/** Kỳ lương hiện tại cho luật số ngày và phần chưa làm (ledger UC-103, pocket UC-1205 bước 7). */
export interface NearSpendCycle {
  /** Ngày lương danh nghĩa của kỳ hiện tại (`payCycle.payday`); null = chưa có kỳ. */
  cyclePayday: string | null;
  pendingTasks: number;
  /** R (`pockets.operating.remaining`, sau trừ tạm hàng đợi ở PWA); thiếu = 0. */
  goalRemaining?: number;
}

/**
 * Một hàm cho server và PWA (mọi chỗ tính lại số mỗi ngày): hôm nay trước ngày lương của kỳ hiện tại (lương về sớm) →
 * đếm tới ngày lương sau kỳ đó, còn lại tới ngày lương kế tiếp theo hôm nay; số mỗi ngày chia `amount − pendingTasks − R`.
 */
export function nearSpendView(amount: number, today: string, paydayDay: number, cycle: NearSpendCycle = { cyclePayday: null, pendingTasks: 0 }): NearSpendView {
  const payday = cycle.cyclePayday !== null && today < cycle.cyclePayday ? nextPayday(cycle.cyclePayday, paydayDay) : nextPayday(today, paydayDay);
  const daysLeft = Math.round((Date.parse(`${payday}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  const floorTo = (n: number, step: number) => {
    const r = Math.floor(n / step) * step;
    return r > 0 ? r : null;
  };
  const goalRemaining = cycle.goalRemaining ?? 0;
  const free = amount - cycle.pendingTasks - goalRemaining;
  const perDay = free > 0 ? floorTo(free / daysLeft, 1_000) : null;
  return {
    payday,
    daysLeft,
    perDay,
    perMeal: perDay === null ? null : floorTo(perDay / 2, 5_000),
    perMarket: perDay === null ? null : floorTo(perDay, 10_000),
    pendingTasks: cycle.pendingTasks,
    goalRemaining,
  };
}

/** Tiền vận hành (ledger UC-103, ADR-122), trả ở `snapshot.nearSpend`. */
export interface NearSpend extends NearSpendView {
  /** = `pockets.operating.total`: sổ các tài khoản ngăn Vận hành; âm được phép. */
  amount: number;
  /** Tài khoản ngăn Vận hành (số trong sổ), theo thứ tự server. */
  accounts: { accountId: string; name: string; balance: number }[];
  /** Tài khoản đang dùng không thuộc ngăn Vận hành. */
  excluded: { accountId: string; name: string; pocket: Pocket | null }[];
  paydayDay: number;
  /** Ngày lương danh nghĩa của kỳ hiện tại (null = chưa có kỳ) — PWA tính lại số ngày bằng đúng luật này. */
  cyclePayday: string | null;
}

/**
 * Tiền vận hành = tổng ngăn Vận hành, đếm ngược tới ngày lương; số mỗi ngày trừ trước phần chưa làm theo việc ngày lương.
 * Không trừ nợ.
 */
export function nearSpend(operating: PocketsView["operating"], accounts: SnapshotData["accounts"], today: string, paydayDay: number, cycle: NearSpendCycle): NearSpend {
  const ids = new Set(operating.accounts.map((a) => a.id));
  return {
    amount: operating.total,
    accounts: operating.accounts.map((a) => ({ accountId: a.id, name: a.name, balance: a.balance })),
    excluded: accounts.filter((a) => !ids.has(a.id)).map((a) => ({ accountId: a.id, name: a.name, pocket: a.pocket })),
    paydayDay,
    cyclePayday: cycle.cyclePayday,
    ...nearSpendView(operating.total, today, paydayDay, cycle),
  };
}

/** Một nguồn gợi ý chuyển vào tiền chi tiêu: số = min(phần còn thiếu, số dư dương của nguồn). */
export interface TopUpSource {
  accountId: string;
  name: string;
  amount: number;
}
/** `snapshot.topUp` (ledger UC-103 bước 7b, ADR-141): tính khi đọc, không lưu việc. */
export interface TopUp {
  /** Y = cần cho tới ngày lương − tiền chi tiêu, làm tròn lên 100.000. */
  amount: number;
  /** Ví Thưởng (số dư của chính nó) trước, rồi phần an tâm theo số dư lớn trước; không tài khoản con / Tích luỹ / có mục tiêu, không tài khoản riêng tư bị giấu với người xem (access UC-504). Σ < amount = phần chưa có nguồn. */
  sources: TopUpSource[];
  /** Đích QR; null (vd chỉ có tiền mặt) → "Chuyển vào tiền chi tiêu", không QR. */
  toAccountId: string | null;
  /** Số tài khoản của đích để dựng QR khi offline; null khi `toAccountId` null. */
  target: QrTarget | null;
}
export interface TopUpInput {
  /** Tiền chi tiêu = tổng ngăn Vận hành. */
  amount: number;
  pendingTasks: number;
  /** Kỳ hiện tại: phần còn thiếu của ④ → Ví Thưởng đang mở bị bỏ khỏi `need`. */
  payCycle: Pick<PayCycleView, "tasks"> | null;
  goalRemaining: number;
  pockets: PocketsView;
  target: QrTarget | null;
  /** Tài khoản riêng tư bị giấu với người xem (access UC-504, ADR-133): không bao giờ là nguồn. */
  hidden?: readonly string[];
}

const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;

/**
 * Nhắc chuyển thêm (ADR-141, QĐ3; chủ nhà 12/11 — chỉ nhắc khi quỹ không đủ trả các khoản chắc chắn): need = (phần chưa làm − ④ →
 * Ví Thưởng đang mở) + R (khoản phải trả còn lại theo số kỳ này); không có ăn tiêu ước tính. Y = need − tiền chi tiêu làm tròn
 * lên 100.000; Y ≤ 0 → null. Một hàm cho server và PWA (trừ tạm hàng đợi).
 */
export function topUpView({ amount, pendingTasks, payCycle, goalRemaining, pockets, target, hidden = [] }: TopUpInput): TopUp | null {
  const rewardTasks = (payCycle?.tasks ?? []).filter((t) => t.kind === "surplus" && t.toAccountId !== null && t.status === "open").reduce((s, t) => s + t.missing, 0);
  const short = pendingTasks - rewardTasks + goalRemaining - amount;
  if (short <= 0) return null;
  const y = ceilTo(short, 100_000);
  const rewardId = pockets.reserve.reward?.accountId ?? null;
  const own = pockets.reserve.accounts.filter((a) => !hidden.includes(a.id));
  const candidates = [
    ...own.filter((a) => a.id === rewardId),
    ...own.filter((a) => a.id !== rewardId && a.parentId === null && a.goalIds.length === 0).sort((a, b) => b.balance - a.balance),
  ];
  let left = y;
  const sources: TopUpSource[] = [];
  for (const a of candidates) {
    if (left <= 0) break;
    if (a.balance <= 0) continue;
    const take = Math.min(left, a.balance);
    sources.push({ accountId: a.id, name: a.name, amount: take });
    left -= take;
  }
  return { amount: y, sources, toAccountId: target?.accountId ?? null, target };
}

/** Màn chuyển đổi một lần còn dở (pocket UC-1208): số bước đã xong, bước kế tiếp; null = không có / đã xong. */
export interface ConversionProgress {
  done: number;
  total: 5;
  next: string;
}

export function buildSnapshot(data: SnapshotData) {
  const { now } = data;
  return {
    at: now.toISOString(),
    day: dayKey(now),
    week: { key: weekKey(now), ...weekRange(now), weeksLeftInMonth: weeksLeftInMonth(now) },
    month: monthKey(now),
    attention: {
      pendingLogs: data.pending.count,
      pendingNet: data.pending.net,
      drift: data.drift.filter((d) => (d.bookDrift ?? 0) !== 0),
      hiddenPendingLogs: data.hiddenPendingLogs,
    },
    /** Tiền vận hành (ADR-122): tổng ngăn Vận hành, đếm ngược tới ngày lương, trừ trước việc ngày lương chưa làm. */
    nearSpend: nearSpend(data.pockets.operating, data.accounts, dayKey(now), data.paydayDay, {
      cyclePayday: data.payCycle?.payday ?? null,
      pendingTasks: data.pendingTasks,
      goalRemaining: data.pockets.operating.remaining,
    }),
    /** Nhắc chuyển thêm vào tiền chi tiêu (ADR-141); null = đủ tới ngày lương. */
    topUp: snapshotTopUp(data),
    payCycle: data.payCycle,
    paySetup: { hasCycleStream: data.hasCycleStream },
    /** Ba ngăn chỉ đọc (pocket UC-1203). */
    pockets: data.pockets,
    /** Màn chuyển đổi một lần (pocket UC-1208); null = không có / đã xong. */
    conversion: data.conversion,
  };
}

function snapshotTopUp(data: SnapshotData): TopUp | null {
  return topUpView({
    amount: data.pockets.operating.total,
    pendingTasks: data.pendingTasks,
    payCycle: data.payCycle,
    goalRemaining: data.pockets.operating.remaining,
    pockets: data.pockets,
    target: data.topUpTo,
    hidden: data.hiddenAccountIds,
  });
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
