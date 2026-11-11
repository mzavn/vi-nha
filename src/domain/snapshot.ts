// Màn "Hôm nay", tin Telegram sáng và tool MCP `get_snapshot` đều lấy số từ đúng một hàm này.

import type { PayCycleView } from "./pay-cycle";
import { dayKey, monthKey, weekKey, weeksLeftInMonth } from "./period";
import type { Pocket, PocketsView } from "./pockets";

export interface SnapshotData {
  now: Date;
  pending: { count: number; net: number };
  drift: { accountId: string; name: string; bookDrift: number | null }[];
  /** Log chờ của tài khoản riêng tư bị giấu với người xem (access UC-504): Gán chỉ hiện một dòng đếm. */
  hiddenPendingLogs: number;
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
  /** Tròn xuống 1.000; null khi hết tiền hoặc dưới 1.000. Tính trên `amount − pendingTasks`. */
  perDay: number | null;
  /** 2 bữa: mỗi ngày (đã tròn) ÷ 2, tròn xuống 5.000; null khi dưới 5.000. */
  perMeal: number | null;
  /** 1 lần/ngày: mỗi ngày (đã tròn), tròn xuống 10.000; null khi dưới 10.000. */
  perMarket: number | null;
  /** Phần chưa làm theo danh sách việc ngày lương (ledger UC-103): trừ trước khi chia theo ngày; 0 khi không có kỳ. */
  pendingTasks: number;
}

/** Kỳ lương hiện tại cho luật số ngày và phần chưa làm (ledger UC-103, pocket UC-1205 bước 7). */
export interface NearSpendCycle {
  /** Ngày lương danh nghĩa của kỳ hiện tại (`payCycle.payday`); null = chưa có kỳ. */
  cyclePayday: string | null;
  pendingTasks: number;
}

/**
 * Một hàm cho server và PWA (mọi chỗ tính lại số mỗi ngày): hôm nay trước ngày lương của kỳ hiện tại (lương về sớm) →
 * đếm tới ngày lương sau kỳ đó, còn lại tới ngày lương kế tiếp theo hôm nay; số mỗi ngày chia `amount − pendingTasks`.
 */
export function nearSpendView(amount: number, today: string, paydayDay: number, cycle: NearSpendCycle = { cyclePayday: null, pendingTasks: 0 }): NearSpendView {
  const payday = cycle.cyclePayday !== null && today < cycle.cyclePayday ? nextPayday(cycle.cyclePayday, paydayDay) : nextPayday(today, paydayDay);
  const daysLeft = Math.round((Date.parse(`${payday}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  const floorTo = (n: number, step: number) => {
    const r = Math.floor(n / step) * step;
    return r > 0 ? r : null;
  };
  const free = amount - cycle.pendingTasks;
  const perDay = free > 0 ? floorTo(free / daysLeft, 1_000) : null;
  return {
    payday,
    daysLeft,
    perDay,
    perMeal: perDay === null ? null : floorTo(perDay / 2, 5_000),
    perMarket: perDay === null ? null : floorTo(perDay, 10_000),
    pendingTasks: cycle.pendingTasks,
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
    nearSpend: nearSpend(data.pockets.operating, data.accounts, dayKey(now), data.paydayDay, { cyclePayday: data.payCycle?.payday ?? null, pendingTasks: data.pendingTasks }),
    payCycle: data.payCycle,
    paySetup: { hasCycleStream: data.hasCycleStream },
    /** Ba ngăn chỉ đọc (pocket UC-1203). */
    pockets: data.pockets,
    /** Màn chuyển đổi một lần (pocket UC-1208); null = không có / đã xong. */
    conversion: data.conversion,
  };
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
