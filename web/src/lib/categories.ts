// Lưới danh mục và tự điền ví / tài khoản cho màn Nhập. Dùng lại đúng luật của server (domain/entry).

import { cashAccountOf, walletFor } from "../../../src/domain/entry";
import type { Refs } from "../../../src/domain/types";
import { isIncomeHolding } from "./budget";
import type { AccountRef, Bootstrap, CategoryRef, Wallet } from "./types";

/**
 * 6 danh mục hay dùng nhất trong 30 ngày lên đầu. Hoà nhau thì theo `sort` rồi theo tên,
 * nên nhà mới chưa có dữ liệu vẫn thấy thứ tự đã sắp trong cấu hình.
 */
export function topCategories(categories: CategoryRef[], usage: Record<string, number>, n = 6): CategoryRef[] {
  return [...categories]
    .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.sort - b.sort || a.name.localeCompare(b.name, "vi"))
    .slice(0, n);
}

const refsOf = (boot: Pick<Bootstrap, "wallets" | "accounts" | "categories">): Refs => ({
  wallets: boot.wallets,
  accounts: boot.accounts,
  categories: boot.categories,
  members: [],
  rules: [],
  incomeStreams: [],
  tenants: [],
  debts: [],
  receivables: [],
  rentalIncomeStreamId: null,
});

/** Ví mặc định của danh mục, đã đổi sang ví cá nhân của người đang nhập nếu danh mục trỏ vào ví người kia. */
export function defaultWalletFor(boot: Pick<Bootstrap, "wallets" | "accounts" | "categories">, category: CategoryRef, memberId: string | null): Wallet | null {
  return walletOfMember(boot, category.defaultWalletId, memberId);
}

/** Ví server sẽ ghi khi chọn `walletId` (domain `walletFor`): ví cá nhân của người kia đổi sang ví cùng phe của người đang nhập. */
export function walletOfMember(boot: Pick<Bootstrap, "wallets" | "accounts" | "categories">, walletId: string | null, memberId: string | null): Wallet | null {
  if (!walletId) return null;
  try {
    const w = walletFor(refsOf(boot), walletId, memberId);
    return boot.wallets.find((x) => x.id === w.id) ?? null;
  } catch {
    return null;
  }
}

/** Chiều tiền của tài khoản trong một khoản nhập tay: tiền vào tài khoản (thu, hoàn, chuyển đến) hay tiền ra (chi, cho vay, chuyển đi). */
export type AccountDirection = "in" | "out";

/**
 * Tài khoản nhập tay được cho chiều tiền này. Chiều nào SePay báo về thì tự về từ ngân hàng — nhập tay thêm là đếm
 * hai lần, nên server từ chối; ở đây ẩn luôn để người dùng không nhập xong mới biết (ADR-66): tiền vào tài khoản đã
 * nối SePay luôn tự về; tiền ra chỉ tự về khi tài khoản bật "SePay báo cả tiền ra".
 */
export const manualAccounts = (accounts: AccountRef[], direction: AccountDirection): AccountRef[] =>
  accounts.filter((a) => !a.sepayEnabled || (direction === "out" && !a.sepayOut));

/** Tài khoản mặc định: tiền mặt của người đang nhập, không có thì tài khoản đầu tiên nhập tay được theo chiều này (không lấy tài khoản Tích sản — heo, phao, sổ). */
export function defaultAccountFor(boot: Pick<Bootstrap, "wallets" | "accounts" | "categories">, memberId: string | null, direction: AccountDirection): string | null {
  const manual = manualAccounts(boot.accounts, direction);
  return cashAccountOf(refsOf(boot), memberId) ?? (manual.find((a) => !a.role) ?? manual[0])?.id ?? null;
}

/** Tài khoản ngân hàng đầu tiên của người đang nhập — mặc định cho khoản thu. Tài khoản Tích sản (heo, phao, sổ — ADR-88) chỉ khi không còn tài khoản nào khác. */
export function defaultBankFor(accounts: AccountRef[], memberId: string | null): string | null {
  const open = accounts.filter((a) => !a.role);
  return (
    open.find((a) => a.kind === "bank" && a.ownerMemberId === memberId)?.id ??
    open.find((a) => a.kind === "bank")?.id ??
    open[0]?.id ??
    accounts[0]?.id ??
    null
  );
}

/** Ví chi được: bỏ Thu nhập và Tích sản (server chặn), bỏ ví cá nhân của người kia. Ví giữ riêng (Thu cho thuê) chi được — trả nợ. */
export function spendableWallets(wallets: Wallet[], memberId: string | null): Wallet[] {
  return wallets.filter(
    (w) => !isIncomeHolding(w) && w.tier !== "wealth_building" && !(w.scope === "personal" && w.memberId !== null && w.memberId !== memberId),
  );
}
