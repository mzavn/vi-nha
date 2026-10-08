// Mã hệ thống: những mã dữ liệu duy nhất code được nhắc thẳng tới (migration 0029). Mọi mã khác (ví, tài khoản, danh mục,
// thành viên) là dữ liệu của từng nhà, sinh từ tên người dùng gõ — code không khoá theo.

/** Kết nối SePay có sẵn từ schema; chỉ nó được dùng `wrangler secret` SEPAY_API_TOKEN / SEPAY_API_KEY khi cột để trống. */
export const DEFAULT_SEPAY_CONNECTION_ID = "default";
/** Danh mục mặc định của khoản trả nợ. */
export const DEBT_CATEGORY_ID = "debt-payment";
/** Danh mục mặc định của khoản cho vay / trả hộ. Chỉ là nhãn: cho vay không vào chi theo danh mục. */
export const LEND_CATEGORY_ID = "lending";
