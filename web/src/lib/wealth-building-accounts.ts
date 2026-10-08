// Tài khoản Tích sản (ADR-88): heo đất, phao dự phòng, sổ tiết kiệm — tên gọi và lời nhắc dùng chung cho các màn. Thuần để test.

import { isWealthBuildingDeposit } from "../../../src/domain/entry";
import { formatVnd } from "./money";
import type { AccountRef, AccountRole } from "./types";

export const ROLE_LABEL: Record<AccountRole, string> = { piggy_bank: "Heo đất", buffer: "Phao dự phòng", term_deposit: "Sổ tiết kiệm" };

/** "Heo đất Chồng" (heo gọi theo người) · "Phao dự phòng · MB tiết kiệm (vợ)" · "Sổ tiết kiệm · Sổ 6 tháng". */
export function wealthBuildingAccountLabel(a: { role: AccountRole; name: string; memberName: string | null }): string {
  return a.role === "piggy_bank" ? `Heo đất ${a.memberName ?? a.name}` : `${ROLE_LABEL[a.role]} · ${a.name}`;
}

/**
 * Dòng nhắc dưới một chuyển nội bộ chưa chọn ví: tiền từ tài khoản thường vào tài khoản Tích sản là Tích sản — server tự
 * chuyển ví Có thì tốt → Tích sản (domain `wealthBuildingMove`). Rút ra hay chuyển giữa hai tài khoản Tích sản: null (chỉ đổi chỗ).
 */
export function wealthBuildingMoveHint(accounts: AccountRef[], fromAccountId: string | null | undefined, toAccountId: string | null | undefined): string | null {
  if (!isWealthBuildingDeposit(accounts, fromAccountId, toAccountId)) return null;
  const to = accounts.find((a) => a.id === toAccountId);
  return `Tiền vào ${to?.name ?? ""} là Tích sản: ghi xong, ví Có thì tốt chuyển sang Tích sản (như bỏ heo đất).`;
}

/**
 * Dòng nhắc ở sheet tài khoản (ADR-91): tài khoản **thành** tài khoản Tích sản không tính vào tiền chi được mà đang có tiền
 * → lưu xong, số dư đó vào Tích sản một lần (server chỉ ghi phần chưa là Tích sản). Đã là tài khoản Tích sản, vẫn tính
 * vào tiền chi được, hay số dư ≤ 0 → null.
 */
export function openingCreditHint(a: { wasRole: boolean; role: AccountRole | null; spendable: boolean; balance: number }): string | null {
  if (a.wasRole || !a.role || a.spendable || a.balance <= 0) return null;
  return `Số dư hiện có ${formatVnd(a.balance)} sẽ được tính vào Tích sản — một lần, không trừ ví nào; phần Tích sản đang nằm ở tài khoản thường coi như đã chuyển vào đây.`;
}
