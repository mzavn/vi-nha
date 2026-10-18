// Lãi tiền gửi (change 261018-lai-tien-gui, ingest UC-303): nhận diện log lãi ngân hàng trả và chọn ví nhận lãi của
// chính tài khoản nhận. Hàm THUẦN: không đọc DB.

import { isFullLock, type WalletRule } from "./allocation";
import { normalizeContent } from "./rules";
import type { AccountRef, IncomeStreamRef, WalletRef } from "./types";

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

/**
 * Ví nhận lãi của tài khoản `account` (danh sách ví, nguồn thu, luật nạp: chỉ phần đang bật):
 * 1. tài khoản Tích sản (`role`) → ví Tích sản; 2. đúng một ví trú ở tài khoản, trừ mọi ví `holding` (ví Thu nhập, quỹ)
 * và mọi ví trong phần khóa của một nguồn thu đang bật khóa trọn 100% (tổng phần khóa = 1, vd Thu cho thuê, hay 70/30 hai
 * ví; khóa một phần như Tích sản 45% của lương thì không loại) → ví đó; 3. còn lại → ví Có thì tốt (luật nạp `remainder`);
 * 4. không có → null (để người chọn).
 */
export function interestWallet(
  account: Pick<AccountRef, "id" | "role">,
  wallets: Pick<WalletRef, "id" | "tier" | "accountId">[],
  streams: Pick<IncomeStreamRef, "active" | "locks">[],
  rules: Pick<WalletRule, "walletId" | "mode">[],
): string | null {
  if (account.role) return wallets.find((w) => w.tier === "wealth_building")?.id ?? null;
  const locked = new Set(streams.filter((s) => s.active && isFullLock(s.locks)).flatMap((s) => s.locks.map((l) => l.walletId)));
  const own = wallets.filter((w) => w.accountId === account.id && w.tier !== "holding" && !locked.has(w.id));
  if (own.length === 1) return own[0]!.id;
  const remainder = rules.find((r) => r.mode === "remainder")?.walletId;
  return remainder && wallets.some((w) => w.id === remainder) ? remainder : null;
}
