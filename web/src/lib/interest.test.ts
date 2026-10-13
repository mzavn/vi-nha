import { describe, expect, it } from "vitest";
import {
  assignDebtRows,
  debtInterestText,
  debtPaymentEntries,
  debtTermsPayload,
  debtTermsToForm,
  interestDue,
  interestLineText,
  prefillSplit,
  splitOf,
  splitPaymentToast,
  withAmount,
  withInterest,
  withPrincipal,
} from "./interest";

const NBSP = "\u00a0";
const vnd = (s: string) => s.replaceAll(" ₫", `${NBSP}₫`);

// "Vay tiêu dùng" 18%, dư nợ đầu tháng 11 là 20.000.000, số trả mỗi tháng 2.300.000, ngày trả 5.
const loan = { name: "Vay tiêu dùng", balance: 20_000_000, interestRate: 18, monthlyPayment: 2_300_000, dueDay: 5, interestThisMonth: 300_000, interestPaidThisMonth: 0 };
const family = { name: "Vay người nhà", balance: 300_000_000, interestRate: 0, monthlyPayment: null, dueDay: null, interestThisMonth: 0, interestPaidThisMonth: 0 };

describe("lãi vay: sheet Trả nợ tách lãi / gốc", () => {
  it("UC-902 AC-10: mở sheet khoản 18% → Số tiền 2.300.000, Tiền lãi 300.000, Tiền gốc 2.000.000; mở lại sau khi đã trả lãi tháng này → lãi 0", () => {
    expect(splitOf(prefillSplit(loan))).toEqual({ amount: 2_300_000, interest: 300_000, principal: 2_000_000 });
    expect(interestDue({ ...loan, interestPaidThisMonth: 300_000 })).toBe(0);
    expect(splitOf(prefillSplit({ ...loan, interestPaidThisMonth: 300_000 }))).toEqual({ amount: 2_300_000, interest: 0, principal: 2_300_000 });
  });

  it("UC-902 AC-10: Lưu → hai khoản chi — lãi 300.000 (`loan-interest`, ví Lãi vay, `interest_debt_id`), gốc 2.000.000 (`debt_id`, `debt-payment`); toast nói lãi, gốc, còn nợ", () => {
    let n = 0;
    const entries = debtPaymentEntries({
      split: splitOf(prefillSplit(loan)),
      debtId: "vay-tieu-dung",
      at: "2026-11-05T03:00:00.000Z",
      accountId: "vcb",
      principalWalletId: "rental-income",
      interestWalletId: "loan-interest",
      newId: () => `c${++n}`,
    });
    expect(entries).toEqual([
      { meaning: "spend", amount: 300_000, at: "2026-11-05T03:00:00.000Z", client_id: "c1", category_id: "loan-interest", wallet_id: "loan-interest", account_id: "vcb", interest_debt_id: "vay-tieu-dung" },
      { meaning: "spend", amount: 2_000_000, at: "2026-11-05T03:00:00.000Z", client_id: "c2", category_id: "debt-payment", wallet_id: "rental-income", account_id: "vcb", debt_id: "vay-tieu-dung" },
    ]);
    expect(entries[0]).not.toHaveProperty("debt_id");
    expect(splitPaymentToast(splitOf(prefillSplit(loan)), loan)).toBe(vnd("Đã trả 2.300.000 ₫ cho Vay tiêu dùng: lãi 300.000 ₫, gốc 2.000.000 ₫. Còn nợ 18.000.000 ₫."));
  });

  it("UC-902 AC-11: phần bằng 0 không ghi — khoản 0% chỉ một khoản gốc như cũ; trả đúng bằng lãi chỉ một khoản lãi", () => {
    const base = { debtId: "vay-nguoi-nha", at: "2026-11-05T03:00:00.000Z", accountId: "vcb", principalWalletId: "rental-income", interestWalletId: "loan-interest", newId: () => "x" };
    const zero = debtPaymentEntries({ ...base, split: splitOf({ ...prefillSplit(family), amount: 5_000_000 }) });
    expect(zero).toHaveLength(1);
    expect(zero[0]).toMatchObject({ amount: 5_000_000, debt_id: "vay-nguoi-nha", category_id: "debt-payment" });
    const onlyInterest = debtPaymentEntries({ ...base, debtId: "vay-tieu-dung", split: splitOf({ amount: 300_000, interest: 300_000 }) });
    expect(onlyInterest).toHaveLength(1);
    expect(onlyInterest[0]).toMatchObject({ interest_debt_id: "vay-tieu-dung", category_id: "loan-interest" });
  });

  it("UC-712 AC-13: sửa Tiền lãi 350.000 → gốc 1.950.000; rồi Số tiền 200.000 → lãi 200.000, gốc 0; hai ô không bao giờ âm", () => {
    let d = prefillSplit(loan);
    d = withInterest(d, 350_000);
    expect(splitOf(d)).toEqual({ amount: 2_300_000, interest: 350_000, principal: 1_950_000 });
    d = withAmount(d, 200_000);
    expect(splitOf(d)).toEqual({ amount: 200_000, interest: 200_000, principal: 0 });
    expect(splitOf(withPrincipal(prefillSplit(loan), 2_500_000))).toEqual({ amount: 2_300_000, interest: 0, principal: 2_300_000 });
    expect(splitOf(withPrincipal(prefillSplit(loan), 1_000_000))).toEqual({ amount: 2_300_000, interest: 1_300_000, principal: 1_000_000 });
    expect(splitOf(withInterest(prefillSplit(loan), -5))).toEqual({ amount: 2_300_000, interest: 0, principal: 2_300_000 });
  });

  it("UC-903 AC-4: Gán log tiền ra 2.300.000 cho khoản có lãi → tách sẵn hai dòng: lãi 300.000 (`loan-interest`, `interest_debt_id`), gốc 2.000.000 (`debt_id`); khoản 0% một dòng như cũ", () => {
    const ids = { debtCategoryId: "debt-payment", principalWalletId: "rental-income", interestWalletId: "loan-interest" };
    expect(assignDebtRows(2_300_000, { id: "vay-tieu-dung", ...loan }, ids)).toEqual([
      { meaning: "spend", amount: 300_000, category_id: "loan-interest", wallet_id: "loan-interest", interest_debt_id: "vay-tieu-dung", debt_id: null },
      { meaning: "spend", amount: 2_000_000, category_id: "debt-payment", wallet_id: "rental-income", debt_id: "vay-tieu-dung", interest_debt_id: null },
    ]);
    expect(assignDebtRows(200_000, { id: "vay-tieu-dung", ...loan }, ids)).toEqual([
      { meaning: "spend", amount: 200_000, category_id: "loan-interest", wallet_id: "loan-interest", interest_debt_id: "vay-tieu-dung", debt_id: null },
    ]);
    expect(assignDebtRows(5_000_000, { id: "vay-nguoi-nha", ...family }, ids)).toEqual([
      { meaning: "spend", amount: 5_000_000, category_id: "debt-payment", wallet_id: "rental-income", debt_id: "vay-nguoi-nha", interest_debt_id: null },
    ]);
  });
});

describe("lãi vay: câu chữ", () => {
  it("UC-707 AC-25: dòng phụ dưới ví Lãi vay — trước khi trả \"đã trả 0 ₫\", sau khi trả \"đã trả 300.000 ₫\"", () => {
    expect(interestLineText({ name: "Vay tiêu dùng", expected: 300_000, paid: 0, dueDay: 5 })).toBe(vnd("Vay tiêu dùng · trả ngày 5 · dự kiến 300.000 ₫ · đã trả 0 ₫"));
    expect(interestLineText({ name: "Vay tiêu dùng", expected: 300_000, paid: 300_000, dueDay: 5 })).toBe(vnd("Vay tiêu dùng · trả ngày 5 · dự kiến 300.000 ₫ · đã trả 300.000 ₫"));
    expect(interestLineText({ name: "Vay A", expected: 1_000, paid: 0, dueDay: null })).toBe(vnd("Vay A · dự kiến 1.000 ₫ · đã trả 0 ₫"));
  });

  it("UC-901 AC-9, AC-10: dòng lãi của khoản nợ — 18%/năm, lãi 3.600.000 ₫/năm, tháng này 300.000 ₫, trả ngày 5; khoản 0% không có dòng lãi", () => {
    expect(debtInterestText({ interestRate: 18, interestPerYear: 3_600_000, interestThisMonth: 300_000, dueDay: 5 })).toBe(vnd("18%/năm · lãi 3.600.000 ₫/năm · tháng này 300.000 ₫ · trả ngày 5"));
    expect(debtInterestText({ interestRate: 10.5, interestPerYear: 1, interestThisMonth: 0, dueDay: null })).toBe(vnd("10,5%/năm · lãi 1 ₫/năm · tháng này 0 ₫"));
    expect(debtInterestText({ interestRate: 0, interestPerYear: 0, interestThisMonth: 0, dueDay: null })).toBeNull();
  });
});

describe("lãi vay: ô lãi suất, kỳ hạn, số trả, ngày trả", () => {
  it("UC-901 AC-9: gửi `interest_rate` 18, `term` short, `monthly_payment` 2.300.000, `due_day` 5; để trống → 0 / null; sai → lỗi tại ô", () => {
    expect(debtTermsPayload({ rate: "18", term: "short", monthlyPayment: 2_300_000, dueDay: "5" })).toEqual({
      ok: true,
      value: { interest_rate: 18, term: "short", monthly_payment: 2_300_000, due_day: 5 },
    });
    expect(debtTermsPayload({ rate: "", term: "long", monthlyPayment: 0, dueDay: "" })).toEqual({ ok: true, value: { interest_rate: 0, term: "long", monthly_payment: null, due_day: null } });
    expect(debtTermsPayload({ rate: "10,5%", term: "short", monthlyPayment: 0, dueDay: "" })).toMatchObject({ ok: true, value: { interest_rate: 10.5 } });
    expect(debtTermsPayload({ rate: "120", term: "short", monthlyPayment: 0, dueDay: "" })).toMatchObject({ ok: false, errors: { rate: expect.any(String) } });
    expect(debtTermsPayload({ rate: "-1", term: "short", monthlyPayment: 0, dueDay: "" }).ok).toBe(false);
    expect(debtTermsPayload({ rate: "18", term: "short", monthlyPayment: 0, dueDay: "29" })).toMatchObject({ ok: false, errors: { dueDay: expect.any(String) } });
    expect(debtTermsPayload({ rate: "18", term: "short", monthlyPayment: 0, dueDay: "0" }).ok).toBe(false);
  });

  it("form đọc lại đúng số đã lưu; khoản cũ chưa có trường lãi → trống, ngắn hạn", () => {
    expect(debtTermsToForm({ interestRate: 18, term: "long", monthlyPayment: 2_300_000, dueDay: 5 })).toEqual({ rate: "18", term: "long", monthlyPayment: 2_300_000, dueDay: "5" });
    expect(debtTermsToForm(null)).toEqual({ rate: "", term: "short", monthlyPayment: 0, dueDay: "" });
  });
});
