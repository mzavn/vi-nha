// Tuổi tiền (ledger UC-103 AC-27, Q4-A, ADR-144 — bản này chỉ đo): tiền đang tiêu ở ngăn Vận hành về cách đây bao nhiêu ngày.
// Vào trước tiêu trước trên các lô vào; tuổi của một khoản ra = trung bình theo số tiền của tuổi các lô nó tiêu. Hàm thuần.

import { daysBetween, vnDay } from "./month-tasks";

/** Số khoản chi gần nhất lấy trung bình. */
export const MONEY_AGE_SAMPLE = 10;
/** Từ số ngày này trở lên là "đủ đệm một tháng". */
export const MONEY_AGE_BUFFERED_DAYS = 30;
/** Cửa sổ đọc giao dịch (ngày). */
export const MONEY_AGE_WINDOW_DAYS = 400;

/**
 * Một dòng tiền của ngăn Vận hành theo thứ tự thời gian: `in` = lô vào (thu, chuyển từ ngăn khác vào, hoàn tiền, nhận lại tiền
 * cho vay, điều chỉnh dương); `out` = ra không phải chi (chuyển sang ngăn khác, cho vay, mua tài sản, điều chỉnh âm) — tiêu lô
 * nhưng không vào mẫu; `spend` = khoản chi — tiêu lô và vào mẫu. Chuyển giữa hai tài khoản Vận hành không có ở đây.
 */
export interface MoneyFlow {
  at: string;
  amount: number;
  kind: "in" | "out" | "spend";
}

export interface MoneyAge {
  /** ⌊trung bình tuổi của `sample` khoản chi gần nhất⌋ (ngày). */
  days: number;
  sample: number;
  /** `days` ≥ 30: đủ đệm một tháng. */
  buffered: boolean;
}

/**
 * `opening`: lô số dư ngăn Vận hành tại đầu cửa sổ (đặt ngày đầu cửa sổ; âm → nợ của hàng đợi). Khoản ra khi hàng đợi cạn:
 * phần thiếu có tuổi 0 và thành nợ; lô vào sau trả nợ trước. Dưới `MONEY_AGE_SAMPLE` khoản chi → null.
 */
export function moneyAge(opening: { at: string; amount: number }, flows: readonly MoneyFlow[]): MoneyAge | null {
  const lots: { day: string; left: number }[] = [];
  let debt = 0;
  const addLot = (day: string, amount: number) => {
    const pay = Math.min(debt, amount);
    debt -= pay;
    if (amount > pay) lots.push({ day, left: amount - pay });
  };
  if (opening.amount > 0) lots.push({ day: vnDay(opening.at), left: opening.amount });
  else debt = -opening.amount;
  const ages: number[] = [];
  for (const f of flows) {
    if (f.amount <= 0) continue;
    const day = vnDay(f.at);
    if (f.kind === "in") {
      addLot(day, f.amount);
      continue;
    }
    let need = f.amount;
    let weighted = 0;
    while (need > 0 && lots.length > 0) {
      const lot = lots[0]!;
      const take = Math.min(need, lot.left);
      weighted += take * daysBetween(lot.day, day);
      lot.left -= take;
      need -= take;
      if (lot.left === 0) lots.shift();
    }
    debt += need;
    if (f.kind === "spend") ages.push(weighted / f.amount);
  }
  if (ages.length < MONEY_AGE_SAMPLE) return null;
  const recent = ages.slice(-MONEY_AGE_SAMPLE);
  // Tuổi từng khoản là phân số (trung bình theo số tiền): cộng sai số dấu phẩy động không được kéo 30 về 29.
  const days = Math.floor(recent.reduce((s, a) => s + a, 0) / MONEY_AGE_SAMPLE + 1e-9);
  return { days, sample: MONEY_AGE_SAMPLE, buffered: days >= MONEY_AGE_BUFFERED_DAYS };
}
