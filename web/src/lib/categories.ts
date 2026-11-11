// Lưới danh mục và tự điền tài khoản cho màn Nhập (không còn ví, Đợt C). Dùng lại đúng luật của server (domain/entry).

import { cashAccountOf } from "../../../src/domain/entry";
import type { Refs } from "../../../src/domain/types";
import { dayKey } from "../../../src/domain/period";
import type { AccountRef, Bootstrap, CategoryRef } from "./types";

/**
 * 6 danh mục hay dùng nhất trong 30 ngày lên đầu. Hoà nhau thì theo `sort` rồi theo tên,
 * nên nhà mới chưa có dữ liệu vẫn thấy thứ tự đã sắp trong cấu hình.
 */
export function topCategories(categories: CategoryRef[], usage: Record<string, number>, n = 6): CategoryRef[] {
  return [...categories]
    .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0) || a.sort - b.sort || a.name.localeCompare(b.name, "vi"))
    .slice(0, n);
}

const refsOf = (accounts: AccountRef[]): Refs => ({
  accounts,
  categories: [],
  members: [],
  incomeStreams: [],
  tenants: [],
  debts: [],
  receivables: [],
  rentalIncomeStreamId: null,
});

/** Chiều tiền của tài khoản trong một khoản nhập tay: tiền vào tài khoản (thu, hoàn, chuyển đến) hay tiền ra (chi, cho vay, chuyển đi). */
export type AccountDirection = "in" | "out";

/**
 * Tài khoản nhập tay được cho chiều tiền này. Chiều nào SePay báo về thì tự về từ ngân hàng — nhập tay thêm là đếm
 * hai lần, nên server từ chối; ở đây ẩn luôn để người dùng không nhập xong mới biết (ADR-66): tiền vào tài khoản đã
 * nối SePay luôn tự về; tiền ra chỉ tự về khi tài khoản bật "SePay báo cả tiền ra". Có `day` thì khoản trước mốc theo dõi
 * SePay (`feedFrom`, tiền ra cả `sepayOutFrom`) nhập tay được — SePay không báo lại khoản đó (ADR-113). Tài khoản riêng tư của
 * người khác (`hiddenFromMe`) không bao giờ có: server từ chối ghi vào đó (access UC-504 bước 3, pwa UC-703 AC-16, UC-705).
 */
export function manualAccounts(accounts: AccountRef[], direction: AccountDirection, day?: string): AccountRef[] {
  // Ngày khoản trước ngày (giờ VN) của mốc theo dõi SePay (ADR-113): SePay không báo khoản đó → nhập tay được.
  const before = (mark: string | null | undefined) => !!day && !!mark && day < dayKey(new Date(mark));
  return accounts.filter(
    (a) => !a.hiddenFromMe && (!a.sepayEnabled || before(a.feedFrom) || (direction === "out" && (!a.sepayOut || before(a.sepayOutFrom)))),
  );
}

/** Tài khoản ngăn Vận hành trong danh sách (giữ thứ tự); không có thì cả danh sách (pwa UC-703 AC-15). */
const operatingFirst = (accounts: AccountRef[]): AccountRef[] => {
  const operating = accounts.filter((a) => a.pocket === "operating");
  return operating.length ? operating : accounts;
};

/**
 * Tài khoản mặc định (pwa UC-703 AC-15): ưu tiên tài khoản ngăn Vận hành nhập tay được theo chiều này — tiền mặt của người
 * đang nhập, rồi tài khoản của người đó, rồi tài khoản Vận hành đầu tiên. Không có tài khoản Vận hành nào nhập tay được →
 * luật cũ trên mọi tài khoản ghi được (trừ tài khoản riêng tư của người khác): tiền mặt của người đang nhập, không có thì tài
 * khoản đầu tiên nhập tay được.
 */
export function defaultAccountFor(boot: Pick<Bootstrap, "accounts">, memberId: string | null, direction: AccountDirection): string | null {
  const manual = manualAccounts(boot.accounts, direction);
  const operating = manual.filter((a) => a.pocket === "operating");
  if (operating.length)
    return cashAccountOf(refsOf(operating), memberId) ?? (operating.find((a) => a.ownerMemberId === memberId) ?? operating[0])!.id;
  return cashAccountOf(refsOf(boot.accounts.filter((a) => !a.hiddenFromMe)), memberId) ?? manual[0]?.id ?? null;
}

/** Tài khoản ngân hàng đầu tiên của người đang nhập — mặc định cho khoản thu; ưu tiên tài khoản ngăn Vận hành. */
export function defaultBankFor(accounts: AccountRef[], memberId: string | null): string | null {
  const open = operatingFirst(accounts);
  return (
    open.find((a) => a.kind === "bank" && a.ownerMemberId === memberId)?.id ??
    open.find((a) => a.kind === "bank")?.id ??
    open[0]?.id ??
    null
  );
}
