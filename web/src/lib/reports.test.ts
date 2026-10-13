import { describe, expect, it } from "vitest";
import {
  canGoNext,
  cashFlowMonthSub,
  cashFlowSummary,
  classOptions,
  closingNotes,
  currentPeriod,
  excludedText,
  lineSub,
  lotNoteText,
  periodEnd,
  periodFromHash,
  periodHash,
  periodLabel,
  reclassToast,
  reportTxSub,
  reportTxTitle,
  savingsRateText,
  shiftPeriod,
  shownExpenseLines,
  statementMonthSub,
  switchKind,
} from "./reports";
import type { CashFlow, StatementLine } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => s.replaceAll(" ₫", `${NBSP}₫`);

const TODAY = "2026-11-15";

describe("chọn kỳ báo cáo", () => {
  it("UC-717 AC-3 (F5 giữ kỳ): kỳ đọc từ phần thứ ba của địa chỉ; kỳ lạ hoặc sau hôm nay → tháng hiện tại; địa chỉ ghi lại đúng phần và kỳ", () => {
    expect(periodFromHash("#net-worth/cash-flow/2026-09", TODAY)).toBe("2026-09");
    expect(periodFromHash("#net-worth/income/2025", TODAY)).toBe("2025");
    expect(periodFromHash("#net-worth/income/2026", TODAY)).toBe("2026");
    for (const bad of ["#net-worth/cash-flow", "#net-worth/cash-flow/2026-13", "#net-worth/cash-flow/2026-12", "#net-worth/income/2027", "#net-worth/income/abc"]) {
      expect(periodFromHash(bad, TODAY), bad).toBe("2026-11");
    }
    expect(periodHash("cash-flow", "2026-09")).toBe("#net-worth/cash-flow/2026-09");
    expect(periodHash("income", "2026")).toBe("#net-worth/income/2026");
  });

  it("UC-717 AC-3: ‹ / › đọc kỳ liền trước / liền sau; không có › khi đang ở kỳ hiện tại; đổi Tháng / Năm đọc kỳ tương ứng", () => {
    expect(currentPeriod("month", TODAY)).toBe("2026-11");
    expect(currentPeriod("year", TODAY)).toBe("2026");
    expect(shiftPeriod("2026-11", -1)).toBe("2026-10");
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2025-12", 1)).toBe("2026-01");
    expect(shiftPeriod("2026", -1)).toBe("2025");
    expect(canGoNext("2026-11", TODAY)).toBe(false);
    expect(canGoNext("2026-10", TODAY)).toBe(true);
    expect(canGoNext("2026", TODAY)).toBe(false);
    expect(canGoNext("2025", TODAY)).toBe(true);
    expect(switchKind("2026-10", "year", TODAY)).toBe("2026");
    expect(switchKind("2026", "month", TODAY)).toBe("2026-11");
    expect(switchKind("2025", "month", TODAY)).toBe("2025-12");
    expect(switchKind("2026-10", "month", TODAY)).toBe("2026-10");
  });

  it("nhãn kỳ \"Tháng 10/2026\" · \"Năm 2026\"; ngày cuối kỳ để chú Σ sổ — kỳ đang chạy là hôm nay", () => {
    expect(periodLabel("2026-10")).toBe("Tháng 10/2026");
    expect(periodLabel("2026")).toBe("Năm 2026");
    expect(periodEnd("2026-10", TODAY)).toBe("2026-10-31");
    expect(periodEnd("2026-02", TODAY)).toBe("2026-02-28");
    expect(periodEnd("2026-11", TODAY)).toBe(TODAY);
    expect(periodEnd("2025", TODAY)).toBe("2025-12-31");
  });
});

// Tháng mẫu của balance UC-1105 AC-1.
const october: Pick<CashFlow, "opening" | "openedAccounts" | "closedAccounts" | "groups" | "closing"> = {
  opening: 12_000_000,
  openedAccounts: 0,
  closedAccounts: 0,
  groups: [
    { group: "operating", total: 16_400_000, lines: [] },
    { group: "investing", total: -5_800_000, lines: [] },
    { group: "financing", total: 44_400_000, lines: [] },
  ],
  closing: 67_000_000,
};

describe("lưu chuyển tiền: card tóm tắt và chú", () => {
  it("UC-1105 AC-1: tiền đầu kỳ 12.000.000 · Sinh hoạt +16.400.000 · Đầu tư −5.800.000 · Tài chính +44.400.000 · Tiền cuối kỳ 67.000.000 (đậm) = Σ sổ ngày 31/10", () => {
    expect(cashFlowSummary(october).map((r) => [r.label, r.value, r.signed])).toEqual([
      ["Tiền đầu kỳ", 12_000_000, false],
      ["Sinh hoạt", 16_400_000, true],
      ["Đầu tư", -5_800_000, true],
      ["Tài chính", 44_400_000, true],
      ["Tiền cuối kỳ", 67_000_000, false],
    ]);
    expect(cashFlowSummary(october).at(-1)!.strong).toBe(true);
    expect(closingNotes({ to: "2026-10-31", creditCardDebt: 0 })).toEqual(["= Σ sổ tài khoản ngày 31/10/2026"]);
  });

  it("UC-1105 AC-3, AC-8: dòng \"Tài khoản mở trong kỳ\" +14.000.000 và \"Tài khoản tắt trong kỳ\" −3.000.000 chỉ hiện khi khác 0, ngoài ba nhóm", () => {
    const rows = cashFlowSummary({ ...october, opening: 1_000_000, openedAccounts: 14_000_000, closedAccounts: -3_000_000 });
    expect(rows.map((r) => r.key)).toEqual(["opening", "opened", "closed", "operating", "investing", "financing", "closing"]);
    expect(rows.find((r) => r.key === "opened")).toMatchObject({ label: "Tài khoản mở trong kỳ", value: 14_000_000, signed: true });
    expect(rows.find((r) => r.key === "closed")).toMatchObject({ label: "Tài khoản tắt trong kỳ", value: -3_000_000 });
  });

  it("UC-1105 AC-6: thẻ tín dụng âm → chú \"Gồm −3.000.000 ₫ thẻ tín dụng — ở bảng cân đối nằm ở Nợ ngắn hạn\"", () => {
    expect(closingNotes({ to: "2026-11-15", creditCardDebt: 3_000_000 })).toEqual([
      "= Σ sổ tài khoản ngày 15/11/2026",
      vnd("Gồm −3.000.000 ₫ thẻ tín dụng — ở bảng cân đối nằm ở Nợ ngắn hạn"),
    ]);
  });

  it("UC-1105 AC-4: lô mua ở màn tài sản chỉ là ghi chú dưới Đầu tư, không cộng vào tổng", () => {
    expect(lotNoteText({ bought: 10_200_000, sold: 0 })).toBe(vnd("Lô mua 10.200.000 ₫ ghi ở màn tài sản — không cộng vào tổng"));
    expect(lotNoteText({ bought: 0, sold: 5_300_000 })).toBe(vnd("Lô bán 5.300.000 ₫ ghi ở màn tài sản — không cộng vào tổng"));
    expect(lotNoteText({ bought: 0, sold: 0 })).toBeNull();
  });

  it("UC-1105 AC-3: kỳ năm có card Từng tháng — dòng phụ ba nhóm có dấu, mở / tắt tài khoản khi có", () => {
    const m = { month: "2026-10", opening: 13_000_000, openedAccounts: 2_000_000, closedAccounts: 0, operating: 16_400_000, investing: -5_800_000, financing: 44_400_000, closing: 70_000_000 };
    expect(cashFlowMonthSub(m)).toBe(vnd("mở +2.000.000 ₫ · sinh hoạt +16.400.000 ₫ · đầu tư −5.800.000 ₫ · tài chính +44.400.000 ₫"));
  });
});

describe("phân loại lại một giao dịch", () => {
  it("UC-1105 AC-2: xếp khoản thu 50.000.000 vào Tài chính / về mặc định — toast nói chỉ đổi báo cáo; \"Thu nhập thụ động\" chỉ có ở khoản thu; dòng có khoản đã xếp lại ghi rõ", () => {
    expect(classOptions("income")).toEqual(["operating", "passive_income", "investing", "financing"]);
    expect(classOptions("spend")).toEqual(["operating", "investing", "financing"]);
    expect(reclassToast(50_000_000, "financing")).toBe(vnd("Đã xếp khoản 50.000.000 ₫ vào Tài chính — chỉ đổi báo cáo, ví và số dư giữ nguyên."));
    expect(reclassToast(-50_000_000, null)).toBe(vnd("Đã đưa khoản 50.000.000 ₫ về nhóm mặc định."));
    expect(lineSub({ count: 1, reclassified: 1 })).toBe("1 giao dịch, 1 đã xếp lại");
    expect(lineSub({ count: 3, reclassified: 0 })).toBe("3 giao dịch");
    const tx = { id: 5, at: "2026-10-06T03:00:00Z", amount: 50_000_000, meaning: "income", note: "bố mẹ cho vay", categoryName: null, walletName: "Thu nhập", accountName: "VCB", reportClass: "financing" as const, defaultLine: "salary_other" as const };
    expect(reportTxTitle(tx)).toBe("Thu nhập");
    expect(reportTxTitle({ ...tx, categoryName: "Ăn ngoài" })).toBe("Ăn ngoài");
    expect(reportTxSub(tx)).toBe("6/10 · VCB · ví Thu nhập · bố mẹ cho vay");
  });
});

describe("kết quả thu chi", () => {
  const line = (l: string, total: number, children?: StatementLine[]): StatementLine => ({ line: l, label: l, total, ...(children ? { children } : {}) });

  it("UC-1106 AC-1: tỷ lệ để dành 50,3%; chân \"Không tính: trả nợ gốc 5.000.000 ₫, mua tài sản 6.000.000 ₫, phân loại lại Tài chính 50.000.000 ₫, điều chỉnh −100.000 ₫\"", () => {
    expect(savingsRateText(50.3)).toBe("tỷ lệ 50,3%");
    expect(savingsRateText(null)).toBe("tỷ lệ —");
    expect(excludedText({ debtPrincipal: 5_000_000, buyAsset: 6_000_000, reclassifiedInvesting: 0, reclassifiedFinancing: 50_000_000, adjust: -100_000 })).toBe(
      vnd("Không tính: trả nợ gốc 5.000.000 ₫, mua tài sản 6.000.000 ₫, phân loại lại Tài chính 50.000.000 ₫, điều chỉnh −100.000 ₫ — xem Lưu chuyển tiền."),
    );
    expect(excludedText({ debtPrincipal: 0, buyAsset: 0, reclassifiedInvesting: 0, reclassifiedFinancing: 0, adjust: 0 })).toBeNull();
    expect(statementMonthSub({ month: "2026-10", income: 33_200_000, expense: 16_500_000, savings: 16_700_000, savingsRate: 50.3 })).toBe(
      vnd("thu 33.200.000 ₫ · chi 16.500.000 ₫ · tỷ lệ 50,3%"),
    );
  });

  it("UC-1106 AC-2, AC-3: chi tiêu ẩn dòng 0; Thuế đã nộp hiện khi có; Must có dòng con Lãi vay 300.000 khi có lãi", () => {
    const lines = [line("must", 11_800_000, [line("loan_interest", 300_000)]), line("have", 3_000_000), line("nice", 0), line("tax", 1_000_000), line("wealth_building", 0), line("other", 0)];
    expect(shownExpenseLines(lines).map((l) => [l.line, l.total, l.children?.map((c) => c.line)])).toEqual([
      ["must", 11_800_000, ["loan_interest"]],
      ["have", 3_000_000, undefined],
      ["tax", 1_000_000, undefined],
    ]);
    expect(shownExpenseLines([line("must", 5, [line("loan_interest", 0)])])[0]!.children).toEqual([]);
  });
});
