import { describe, expect, it } from "vitest";
import { formToInput, keepDraft, keptDraft, project, type ProjectionInput, reachText, startToForm } from "./projection";
import type { ProjectionStart } from "./types";

// Điểm xuất phát của balance UC-1107 AC-1.
const base: ProjectionInput = {
  year: 2026,
  investable: 806_000_000,
  liabilities: 320_000_000,
  incomes: [
    { name: "Chồng", monthly: 30_000_000, growthPct: 10 },
    { name: "Vợ", monthly: 12_000_000, growthPct: 5 },
  ],
  expense: 20_000_000,
  expenseMust: 15_000_000,
  savingsMode: "rest",
  savingsRatePct: 0,
  returnPct: 6,
  inflationPct: 3.5,
  swrPct: 3.5,
  fatPct: 110,
  birthYear: 1990,
  targetAgeF1: 45,
  targetAgeF2: 50,
};

describe("Thử số / Dự phóng (tính ở máy, không lưu)", () => {
  it("UC-1107 AC-1: hàng 2027 (37 tuổi) — thu nhập 45.600.000, chi phí 20.700.000, để dành 24.900.000/tháng (54,6%), tài sản cuối năm 1.153.160.000, ròng 833.160.000, F1 15,6%, F2 10,6%", () => {
    const p = project(base);
    expect(p.rows[0]).toEqual({
      year: 2027,
      age: 37,
      income: 45_600_000,
      expense: 20_700_000,
      savings: 24_900_000,
      savingsRate: 54.6,
      investable: 1_153_160_000,
      net: 833_160_000,
      f1Need: 5_322_857_143,
      f2Need: 7_806_857_143,
      f1Pct: 15.6,
      f2Pct: 10.6,
      f1: false,
      f2: false,
    });
  });

  it("UC-1107 AC-1: F1 đạt năm 2036 (46 tuổi — trễ 1 năm), F2 đạt năm 2039 (49 tuổi — sớm 1 năm); bảng tới năm tuổi mục tiêu lớn nhất", () => {
    const p = project(base);
    expect(p.f1).toEqual({ year: 2036, age: 46, targetYear: 2035, diff: 1 });
    expect(p.f2).toEqual({ year: 2039, age: 49, targetYear: 2040, diff: -1 });
    expect(reachText("F1", p.f1)).toBe("F1 ở 46 tuổi (2036) — trễ 1 năm");
    expect(reachText("F2", p.f2)).toBe("F2 ở 49 tuổi (2039) — sớm 1 năm");
    expect(p.rows.at(-1)!.year).toBe(2040);
    expect(p.rows.find((r) => r.year === 2036)!.f1).toBe(true);
    expect(p.rows.find((r) => r.year === 2035)!.f1).toBe(false);
  });

  it("UC-1107 AC-3: để dành = tỷ lệ cố định 40% → hàng 2027 để dành 18.240.000/tháng, chi phí \"theo tỷ lệ\" (null)", () => {
    const r = project({ ...base, savingsMode: "rate", savingsRatePct: 40 }).rows[0]!;
    expect(r.savings).toBe(18_240_000);
    expect(r.expense).toBeNull();
    expect(r.savingsRate).toBe(40);
    expect(r.investable).toBe(854_360_000 + 12 * 18_240_000);
    expect(r.net).toBe(r.investable - 320_000_000);
  });

  it("không tới mốc trong 40 năm → \"chưa tới F1 trong 40 năm\"; không có năm sinh → không có tuổi, so mục tiêu bỏ", () => {
    const poor = project({ ...base, incomes: [{ name: "Cả nhà", monthly: 20_000_000, growthPct: 0 }], returnPct: 0 });
    expect(poor.f1).toBeNull();
    expect(poor.rows).toHaveLength(40);
    expect(reachText("F1", poor.f1)).toBe("Chưa tới F1 trong 40 năm");
    const noAge = project({ ...base, birthYear: null });
    expect(noAge.rows[0]!.age).toBeNull();
    expect(noAge.f1).toEqual({ year: 2036, age: null, targetYear: null, diff: null });
    expect(reachText("F1", noAge.f1)).toBe("F1 năm 2036");
    expect(reachText("F2", { year: 2040, age: 50, targetYear: 2040, diff: 0 })).toBe("F2 ở 50 tuổi (2040) — đúng mục tiêu");
  });

  it("UC-1107 AC-2: hàm thuần — cùng đầu vào cùng kết quả, không đổi đầu vào", () => {
    const input = structuredClone(base);
    expect(project(input)).toEqual(project(base));
    expect(input).toEqual(base);
  });
});

describe("Thử số: ô giả định", () => {
  const start: ProjectionStart = {
    investable: 806_000_000,
    liabilities: 320_000_000,
    incomeLines: [
      { name: "Chồng", memberId: "husband", monthly: 30_000_000 },
      { name: "Vợ", memberId: "wife", monthly: 12_000_000 },
    ],
    incomeSource: "plan",
    expenseMonthly: 20_000_000,
    expenseMustMonthly: 15_000_000,
    inflationBps: 350,
    swrBps: 350,
    fatBps: 11000,
    birthYear: 1990,
    targetAgeF1: 45,
    targetAgeF2: 50,
    expectedReturnBps: 600,
    savingsRatePct: 54.6,
  };

  it("UC-1107 AC-1: điểm xuất phát là số thật; gõ +10%/năm, +5%/năm → cùng bảng như AC-1", () => {
    const f = startToForm(start);
    expect(f).toMatchObject({ investable: 806_000_000, liabilities: 320_000_000, expense: 20_000_000, savingsMode: "rest", returnPct: "6", inflation: "3,5", swr: "3,5", fat: "110", birthYear: "1990", f1: "45", f2: "50", savingsRate: "54,6" });
    expect(f.incomes.map((l) => [l.name, l.monthly, l.growth])).toEqual([
      ["Chồng", 30_000_000, "0"],
      ["Vợ", 12_000_000, "0"],
    ]);
    const typed = { ...f, incomes: [{ ...f.incomes[0]!, growth: "10" }, { ...f.incomes[1]!, growth: "5" }] };
    const r = formToInput(typed, 2026);
    expect(r).toEqual({ ok: true, value: base });
  });

  it("UC-1107 AC-2: Đặt lại về số thật đưa mọi ô về điểm xuất phát; số gõ chỉ giữ trong bộ nhớ trang", () => {
    const f = startToForm(start);
    const typed = { ...f, investable: 1, swr: "4" };
    keepDraft(typed);
    expect(keptDraft()).toBe(typed);
    keepDraft(null);
    expect(keptDraft()).toBeNull();
    expect(startToForm(start)).toEqual(f);
  });

  it("dòng thu nhập của một người ghi kèm tên người: \"Lương · Chồng\"", () => {
    const names: Record<string, string> = { husband: "Chồng" };
    const f = startToForm({ ...start, incomeLines: [{ name: "Lương", memberId: "husband", monthly: 1 }, { name: "Cho thuê", memberId: null, monthly: 2 }] }, (id) => names[id]);
    expect(f.incomes.map((l) => l.name)).toEqual(["Lương · Chồng", "Cho thuê"]);
  });

  it("ô sai báo tại ô: SWR trống / 0, tỷ lệ để dành trống khi chọn tỷ lệ cố định, năm sinh tương lai", () => {
    const f = startToForm(start);
    expect(formToInput({ ...f, swr: "" }, 2026)).toMatchObject({ ok: false, errors: { swr: expect.any(String) } });
    expect(formToInput({ ...f, swr: "0" }, 2026).ok).toBe(false);
    expect(formToInput({ ...f, savingsMode: "rate", savingsRate: "" }, 2026)).toMatchObject({ ok: false, errors: { savingsRate: expect.any(String) } });
    expect(formToInput({ ...f, savingsMode: "rate", savingsRate: "40" }, 2026)).toMatchObject({ ok: true, value: { savingsMode: "rate", savingsRatePct: 40 } });
    expect(formToInput({ ...f, birthYear: "2030" }, 2026).ok).toBe(false);
    expect(formToInput({ ...f, returnPct: "" }, 2026)).toMatchObject({ ok: true, value: { returnPct: 0 } });
    expect(formToInput({ ...f, birthYear: "", f1: "" }, 2026)).toMatchObject({ ok: true, value: { birthYear: null, targetAgeF1: null } });
  });
});
