// Thang Tích luỹ 1 · 10 · 30% (ADR-142) — chữ và phép tính dùng chung cho sheet "Trích Tích luỹ", Tham số, Thiết lập, bước 5
// màn chuyển đổi, thẻ Tích luỹ và Nhìn lại.

import { savingsAmount, type SavingsLevel } from "../../../src/domain/pay-cycle";
import { formatVnd } from "./money";

/** Vạch trên thanh 1–100% và nhãn của từng vạch. */
export const SAVINGS_MARKS = [
  { pct: 1, label: "tối thiểu" },
  { pct: 10, label: "thường" },
  { pct: 30, label: "hướng tới" },
] as const;

export const SAVINGS_SCALE_TEXT =
  "Thang của nhà: tối thiểu 1% · thường 10% · hướng tới 30%. Kỳ nào không trích được thì bỏ qua việc trích ở Hôm nay và ghi lý do.";

/** Kéo thanh: số tiền = khoản lương × % ÷ 100, làm tròn lên 1.000 (như ①). */
export const amountOfPct = (income: number, pct: number): number => savingsAmount(income, pct);

/** Gõ số tiền: thanh nhảy tới ⌊số × 100 ÷ lương⌋, kẹp 1…100. */
export const pctOfAmount = (amount: number, income: number): number => (income > 0 ? Math.min(100, Math.max(1, Math.floor((amount * 100) / income))) : 1);

/** Số > 0 mà dưới 1% lương → câu nhắc (vẫn lưu được); còn lại null. */
export function belowMinText(amount: number, income: number): string | null {
  return amount > 0 && amount * 100 < income ? `Dưới mức tối thiểu 1% (${formatVnd(amountOfPct(income, 1))})` : null;
}

/** "đạt mức …" của kỳ; `zero` kèm lý do bỏ qua. null khi chưa có mức. */
export function levelText(level: SavingsLevel, reason: string | null = null): string | null {
  switch (level) {
    case "below1":
      return "đạt mức dưới 1%";
    case "1to10":
      return "đạt mức 1–10%";
    case "10to30":
      return "đạt mức 10–30%";
    case "from30":
      return "đạt mức từ 30%";
    case "zero":
      return reason ? `0% — ${reason}` : "0%";
    default:
      return null;
  }
}
