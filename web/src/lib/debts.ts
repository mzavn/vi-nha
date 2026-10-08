// Sổ nợ (mình nợ): sổ đối ứng dùng chung lib/memo-books, cộng câu chữ riêng của sổ nợ.
// Thuần, không đụng DOM hay mạng. Số còn nợ = đã vay (dòng nợ) − đã trả (khoản chi gắn khoản nợ); ≤ 0 là trả xong.

import { bookLinePayload, type BookLineForm, bookPayload, defaultRefId, groupBook, openRefs, progressPct } from "./memo-books";
import { formatVnd } from "./money";
import type { Result } from "./settings";
import type { Debt, DebtRef } from "./types";

/** Khoản đang mở: còn nợ nhiều lên trước. Trả xong tách riêng, theo tên. Khoản đã tắt không hiện. */
export function groupDebts(debts: Debt[]): { open: Debt[]; paid: Debt[] } {
  const g = groupBook(debts);
  return { open: g.open, paid: g.done };
}

/** Khoản còn nợ để chọn khi trả: còn nợ nhiều nhất lên đầu. Bản bootstrap cũ không có `debts` thì rỗng. */
export const payableDebts = (debts: DebtRef[] | undefined): DebtRef[] => openRefs(debts);

/** Khoản chọn sẵn khi trả nợ: khoản được mở từ (nếu còn nợ), không thì khoản còn nợ nhiều nhất. */
export const defaultDebtId = (debts: DebtRef[] | undefined, preferred?: string | null): string | null => defaultRefId(openRefs(debts), preferred);

/** Phần đã trả trên tổng đã vay, 0..100, cho thanh tiến độ. */
export const paidPct = (d: Pick<Debt, "owed" | "paid">): number => progressPct(d.owed, d.paid);

/** Câu hệ quả sau mỗi lần ghi sổ nợ: còn nợ bao nhiêu, hoặc hết nợ (trả dư cũng là hết nợ). */
export const owedText = (balance: number): string => (balance > 0 ? `Còn nợ ${formatVnd(balance)}.` : "Hết nợ.");

/** Toast sau khi trả: nói số đã trả và còn nợ bao nhiêu (DESIGN.md §4). */
export function paymentToast(amount: number, debt: Pick<DebtRef, "name" | "balance">): string {
  return `Đã trả ${formatVnd(amount)} cho ${debt.name}. ${owedText(debt.balance - amount)}`;
}

/** Thân POST /v1/debts: số tiền là số còn nợ lúc mở sổ. */
export const debtPayload = (f: { name: string; amount: number; note: string }): Result<{ name: string; amount: number; note?: string }> =>
  bookPayload(f, { name: "Nhập tên khoản nợ.", amount: "Nhập số tiền còn nợ." });

export type DebtLineForm = BookLineForm<"borrow" | "adjust">;

/** Thân POST /v1/debts/:id/lines: vay thêm luôn dương; chỉnh mang dấu theo chiều chọn. */
export const debtLinePayload = (f: DebtLineForm): Result<{ kind: "borrow" | "adjust"; amount: number; note?: string }> => bookLinePayload(f);
