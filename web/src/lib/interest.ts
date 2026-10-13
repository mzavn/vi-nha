// Lãi vay hằng tháng (ADR nháp H): khoản nợ có lãi suất > 0 có lãi dự kiến tháng (server tính theo dư nợ đầu tháng — Công thức 18).
// Trả nợ khoản có lãi tách hai khoản chi: lãi (danh mục / ví "Lãi vay", `interest_debt_id` — chi phí, không giảm nợ) và gốc (`debt_id`).
// Thuần để test: ô Tiền lãi / Tiền gốc, thân hai khoản chi, câu chữ dòng lãi ở Ngân sách, sổ nợ và bảng cân đối.

import { DEBT_CATEGORY_ID, LOAN_INTEREST_ID } from "../../../src/domain/system-ids";
import { formatVnd } from "./money";
import type { Result } from "./settings";
import type { Split } from "./splits";
import type { EntryBody } from "./types";


/** Trường lãi của một khoản nợ (bootstrap `DebtRef`, `GET /v1/debts`). */
export interface InterestFields {
  name: string;
  balance: number;
  /** %/năm; 0 = không lãi. Bản bootstrap cũ chưa có trường này: coi như 0. */
  interestRate?: number;
  monthlyPayment?: number | null;
  dueDay?: number | null;
  interestThisMonth?: number;
  interestPaidThisMonth?: number;
}

export const hasInterest = (d: Pick<InterestFields, "interestRate">): boolean => (d.interestRate ?? 0) > 0;

/** Lãi tháng này còn phải trả = max(0, lãi dự kiến − lãi đã trả). */
export const interestDue = (d: InterestFields): number => Math.max(0, (d.interestThisMonth ?? 0) - (d.interestPaidThisMonth ?? 0));

/** Ô Số tiền và phần lãi người dùng muốn (chưa kẹp theo số tiền). */
export interface SplitDraft {
  amount: number;
  interest: number;
}

export interface PaySplit {
  amount: number;
  interest: number;
  principal: number;
}

/** Lãi tối đa bằng số tiền, cả hai ô không bao giờ âm. */
export function splitOf(d: SplitDraft): PaySplit {
  const interest = Math.min(d.amount, Math.max(0, d.interest));
  return { amount: d.amount, interest, principal: d.amount - interest };
}

/** Mở sheet Trả nợ: Số tiền = số trả mỗi tháng (nếu có), Tiền lãi = lãi còn phải trả tháng này. Khoản 0% không có lãi. */
export const prefillSplit = (d: InterestFields): SplitDraft => ({ amount: hasInterest(d) ? (d.monthlyPayment ?? 0) : 0, interest: hasInterest(d) ? interestDue(d) : 0 });

/** Sửa Số tiền: giữ phần lãi đã chọn (kẹp theo số tiền), gốc tự tính lại. */
export const withAmount = (d: SplitDraft, amount: number): SplitDraft => ({ ...d, amount });
/** Sửa Tiền lãi: gốc = số tiền − lãi. */
export const withInterest = (d: SplitDraft, interest: number): SplitDraft => ({ ...d, interest });
/** Sửa Tiền gốc: lãi = số tiền − gốc (gốc kẹp theo số tiền). */
export const withPrincipal = (d: SplitDraft, principal: number): SplitDraft => ({ ...d, interest: d.amount - Math.min(principal, d.amount) });

/**
 * Thân các khoản chi của một lần trả: khoản lãi (danh mục / ví "Lãi vay", `interest_debt_id`) rồi khoản gốc (`debt_id`, danh mục Trả nợ,
 * ví đang mở sheet). Phần bằng 0 thì không ghi. Mỗi khoản một `client_id` — cùng vào hàng đợi khi offline.
 */
export function debtPaymentEntries(p: {
  split: PaySplit;
  debtId: string | null;
  at: string;
  accountId: string;
  principalWalletId: string;
  interestWalletId: string;
  note?: string;
  newId: () => string;
}): EntryBody[] {
  const note = p.note?.trim() ? { note: p.note.trim() } : {};
  const out: EntryBody[] = [];
  if (p.split.interest > 0 && p.debtId) {
    out.push({
      meaning: "spend",
      amount: p.split.interest,
      at: p.at,
      client_id: p.newId(),
      category_id: LOAN_INTEREST_ID,
      wallet_id: p.interestWalletId,
      account_id: p.accountId,
      interest_debt_id: p.debtId,
      ...note,
    });
  }
  if (p.split.principal > 0) {
    out.push({
      meaning: "spend",
      amount: p.split.principal,
      at: p.at,
      client_id: p.newId(),
      category_id: DEBT_CATEGORY_ID,
      wallet_id: p.principalWalletId,
      account_id: p.accountId,
      ...(p.debtId ? { debt_id: p.debtId } : {}),
      ...note,
    });
  }
  return out;
}

/** Toast sau khi trả khoản có lãi: "Đã trả 2.300.000 ₫ cho Vay tiêu dùng: lãi 300.000 ₫, gốc 2.000.000 ₫. Còn nợ 18.000.000 ₫." */
export function splitPaymentToast(split: PaySplit, debt: Pick<InterestFields, "name" | "balance">): string {
  const left = debt.balance - split.principal;
  return `Đã trả ${formatVnd(split.amount)} cho ${debt.name}: lãi ${formatVnd(split.interest)}, gốc ${formatVnd(split.principal)}. ${left > 0 ? `Còn nợ ${formatVnd(left)}.` : "Hết nợ."}`;
}

/** "18" · "10,5" — lãi suất %/năm như người dùng gõ. */
export const rateText = (rate: number): string => String(rate).replace(".", ",");

/**
 * Màn Gán chọn "Trả cho khoản nợ" (debt UC-903 AC-4): khoản có lãi tách sẵn hai dòng — lãi (lãi còn phải trả tháng này, tối đa bằng số tiền)
 * và gốc (phần còn lại) — bằng tách dòng có sẵn của `assign_log`; phần bằng 0 thì không có dòng. Sửa được trước khi Gán.
 */
export function assignDebtRows(
  amount: number,
  d: InterestFields & { id: string },
  ids: { debtCategoryId: string; principalWalletId: string | null; interestWalletId: string },
): Split[] {
  const s = splitOf({ amount, interest: hasInterest(d) ? interestDue(d) : 0 });
  const rows: Split[] = [];
  if (s.interest > 0) rows.push({ meaning: "spend", amount: s.interest, category_id: LOAN_INTEREST_ID, wallet_id: ids.interestWalletId, interest_debt_id: d.id, debt_id: null });
  if (s.principal > 0 || rows.length === 0) rows.push({ meaning: "spend", amount: s.principal, category_id: ids.debtCategoryId, wallet_id: ids.principalWalletId, debt_id: d.id, interest_debt_id: null });
  return rows;
}

/** Dòng phụ dưới ví "Lãi vay" ở Ngân sách: "Vay tiêu dùng · trả ngày 5 · dự kiến 300.000 ₫ · đã trả 0 ₫". */
export function interestLineText(l: { name: string; expected: number; paid: number; dueDay: number | null }): string {
  return [l.name, l.dueDay ? `trả ngày ${l.dueDay}` : null, `dự kiến ${formatVnd(l.expected)}`, `đã trả ${formatVnd(l.paid)}`].filter(Boolean).join(" · ");
}

/** Dòng phụ của khoản nợ có lãi (sổ nợ, bảng cân đối): "18%/năm · lãi 3.600.000 ₫/năm · tháng này 300.000 ₫ · trả ngày 5". Khoản 0% → null. */
export function debtInterestText(d: { interestRate: number; interestPerYear: number; interestThisMonth: number; dueDay: number | null }): string | null {
  if (!(d.interestRate > 0)) return null;
  return [`${rateText(d.interestRate)}%/năm`, `lãi ${formatVnd(d.interestPerYear)}/năm`, `tháng này ${formatVnd(d.interestThisMonth)}`, d.dueDay ? `trả ngày ${d.dueDay}` : null]
    .filter(Boolean)
    .join(" · ");
}

export interface DebtTermsForm {
  /** Chữ người dùng gõ, đơn vị %/năm; trống = 0. */
  rate: string;
  term: "short" | "long";
  monthlyPayment: number;
  /** "" = chưa đặt. */
  dueDay: string;
}

export interface DebtTermsBody {
  interest_rate: number;
  term: "short" | "long";
  monthly_payment: number | null;
  due_day: number | null;
}

export const debtTermsToForm = (d: { interestRate?: number; term?: "short" | "long"; monthlyPayment?: number | null; dueDay?: number | null } | null): DebtTermsForm => ({
  rate: d?.interestRate ? rateText(d.interestRate) : "",
  term: d?.term ?? "short",
  monthlyPayment: d?.monthlyPayment ?? 0,
  dueDay: d?.dueDay ? String(d.dueDay) : "",
});

/** Lãi suất 0–100 %/năm (tối đa 2 chữ số lẻ), ngày trả 1–28, số trả mỗi tháng để trống = không đặt (debt UC-901). */
export function debtTermsPayload(f: DebtTermsForm): Result<DebtTermsBody> {
  const errors: Record<string, string> = {};
  const t = f.rate.trim().replace("%", "").replace(",", ".").trim();
  const rate = t === "" ? 0 : /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : null;
  if (rate === null || rate > 100) errors.rate = "Lãi suất là số từ 0 đến 100 (%/năm).";
  const day = f.dueDay.trim() === "" ? null : /^\d+$/.test(f.dueDay.trim()) ? Number(f.dueDay.trim()) : NaN;
  if (day !== null && !(day >= 1 && day <= 28)) errors.dueDay = "Ngày trả là số từ 1 đến 28.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { interest_rate: rate!, term: f.term, monthly_payment: f.monthlyPayment > 0 ? f.monthlyPayment : null, due_day: day } };
}
