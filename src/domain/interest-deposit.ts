// Lãi tiền gửi (change 261018-lai-tien-gui, ingest UC-303): nhận diện log lãi ngân hàng trả. Hàm THUẦN: không đọc DB.
// Từ v2 (ADR-123) lãi không chọn ví: khoản thu nằm ở ngăn của tài khoản nhận.

import { normalizeContent } from "./rules";

/** Ngưỡng mặc định (config `interest_max_amount` thiếu / hỏng): log lãi phải nhỏ hơn số này. */
export const INTEREST_MAX_AMOUNT_DEFAULT = 10_000;
/** Trần ngưỡng đặt được ở Cài đặt › Tham số (access UC-507). */
export const INTEREST_MAX_AMOUNT_LIMIT = 10_000_000;

/** Cụm chữ (đã chuẩn hoá) ngân hàng ghi khi trả lãi; không khớp "LAI" / "TRA LAI" đơn ("trả lại", "cho thuê lại"). */
const INTEREST_PHRASES = ["LAI TIEN GUI", "LAI KHONG KY HAN"];

/**
 * Log lãi: tiền vào, 0 < số tiền < `maxAmount` (0 = tắt), nội dung chuẩn hoá rỗng, đúng `BANKAPINOTIFY`, hoặc chứa
 * "LAI TIEN GUI" / "LAI KHONG KY HAN" ("TRA LAI TIEN GUI" đã chứa cụm đầu).
 */
export function isInterestLog(log: { direction: string; amount: number; content: string | null }, maxAmount: number): boolean {
  if (log.direction !== "in" || log.amount <= 0 || log.amount >= maxAmount) return false;
  const text = normalizeContent(log.content);
  return text === "" || text === "BANKAPINOTIFY" || INTEREST_PHRASES.some((p) => text.includes(p));
}
