// Đối soát (ledger UC-106) — một luật cho mọi màn (Hôm nay, bảng điều khiển, Ví & quỹ › Tài khoản, card Tiền chi được):
// tài khoản lệch khi sổ khác các giao dịch ngân hàng đã gán (`bookDrift` ≠ 0). Số lũy kế SePay gửi kèm không dùng (ADR-87).

export const DRIFT_LABEL = "Sổ khác giao dịch ngân hàng đã gán";

/** Số lệch có dấu; null = khớp hoặc chưa có giao dịch ngân hàng để so. Chỉ đọc `bookDrift` — snapshot cũ còn lưu trên máy
 *  có thể còn `feedDrift` (số SePay báo), không được làm hiện lệch. */
export function driftOf(r: { bookDrift: number | null }): number | null {
  return r.bookDrift ? r.bookDrift : null;
}
