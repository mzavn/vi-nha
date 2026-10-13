import { describe, expect, it } from "vitest";
import {
  billionText,
  expenseNeededText,
  freedomCashflowText,
  freedomHaveText,
  freedomTargetText,
  incomeMilestoneText,
  incomeSourceText,
  paramsSummary,
  safetyText,
} from "./freedom";
import type { FreedomParams } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => s.replaceAll(" ₫", `${NBSP}₫`);

const params: FreedomParams = {
  expenseMonthly: 20_000_000,
  expenseSource: "manual",
  expenseMustMonthly: 15_000_000,
  expenseMustSource: "manual",
  incomeMonthly: 45_000_000,
  incomeSource: "ledger",
  lockedBps: 4000,
  swrBps: 350,
  inflationBps: 350,
  fatBps: 11000,
  legacyRateBps: 300,
  highInterestBps: 1500,
  safetyMonths: [6, 12, 24],
  birthYear: 1990,
  targetAges: { f1: 45, f2: 50, f3: null },
};

describe("Mốc tự do: câu chữ", () => {
  it("UC-1103 AC-1: card Thông số một dòng — \"Chi 20.000.000 ₫/tháng (tự nhập) · Must 15.000.000 · SWR 3,5% · lạm phát 3,5%\"; chi phí theo sổ ghi rõ", () => {
    expect(paramsSummary(params)).toBe(vnd("Chi 20.000.000 ₫/tháng (tự nhập) · Must 15.000.000 · SWR 3,5% · lạm phát 3,5%"));
    expect(paramsSummary({ ...params, expenseSource: "ledger", expenseMustSource: "ledger" })).toBe(vnd("Chi 20.000.000 ₫/tháng (theo sổ, 3 tháng gần nhất) · Must 15.000.000 · SWR 3,5% · lạm phát 3,5%"));
  });

  it("UC-1103 AC-5: chưa có chi phí tháng → \"Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng\"", () => {
    expect(paramsSummary({ ...params, expenseMonthly: null, expenseSource: null, expenseMustMonthly: null, expenseMustSource: null })).toBe("Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng · SWR 3,5% · lạm phát 3,5%");
    expect(expenseNeededText).toBe("Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng");
  });

  it("UC-1103 AC-3: Mốc an tâm — \"Có 156.000.000 ₫ · cần 120.000.000 ₫ · 6 tháng\"; chưa có E thì chỉ \"Có …\" và câu cần chi phí", () => {
    expect(safetyText({ key: "A1", months: 6, need: 120_000_000, have: 156_000_000, pct: 130, reached: true })).toBe(vnd("Có 156.000.000 ₫ · cần 120.000.000 ₫ · 6 tháng"));
    expect(safetyText({ key: "A1", months: 6, need: null, have: 30_000_000, pct: null, reached: null })).toBe(vnd("Có 30.000.000 ₫ · cần 6 tháng chi phí — Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng"));
  });

  it("UC-1103 AC-4: mốc thu nhập — đạt / còn thiếu; thu nhập theo kế hoạch ghi \"theo kế hoạch\"; không có số → \"chưa có số\"", () => {
    expect(incomeMilestoneText({ key: "M2p", need: 33_333_334, have: 45_000_000, reached: true })).toBe(vnd("Thu nhập 45.000.000 ₫ · cần 33.333.334 ₫ — đạt"));
    expect(incomeMilestoneText({ key: "M3", need: 40_000_000, have: 30_000_000, reached: false })).toBe(vnd("Thu nhập 30.000.000 ₫ · cần 40.000.000 ₫ — còn thiếu 10.000.000 ₫"));
    expect(incomeMilestoneText({ key: "M2", need: 20_000_000, have: null, reached: null })).toBe("chưa có số");
    expect(incomeSourceText("plan")).toBe("theo kế hoạch");
    expect(incomeSourceText("ledger")).toBe("theo sổ, 3 tháng gần nhất");
    expect(incomeSourceText(null)).toBeNull();
  });

  it("UC-1103 AC-1: F1 \"Tài sản đầu tư trừ nợ 486.000.000 ₫ / cần 5.142.857.143 ₫\", \"hoặc dòng tiền ròng 104.166 ₫ / cần 15.000.000 ₫\"", () => {
    const f1 = { key: "F1" as const, need: 5_142_857_143, have: 486_000_000, pct: 9.4, cashflowNeed: 15_000_000, cashflowHave: 104_166, reached: false, target: null };
    expect(freedomHaveText(f1)).toBe(vnd("Tài sản đầu tư trừ nợ 486.000.000 ₫ / cần 5.142.857.143 ₫"));
    expect(freedomCashflowText(f1)).toBe(vnd("hoặc dòng tiền ròng 104.166 ₫ / cần 15.000.000 ₫"));
    expect(freedomHaveText({ ...f1, need: null })).toBe(vnd("Tài sản đầu tư trừ nợ 486.000.000 ₫ — Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng"));
  });

  it("UC-1103 AC-2: F1 \"45 tuổi · năm 2035 · còn 9 năm · ≈ 7,01 tỷ ₫ theo giá 2035\"; F2 \"≈ 12,21 tỷ ₫ theo giá 2040\"", () => {
    expect(freedomTargetText({ age: 45, year: 2035, yearsLeft: 9, needAtTargetYear: 7_009_186_388 })).toBe(vnd("45 tuổi · năm 2035 · còn 9 năm · ≈ 7,01 tỷ ₫ theo giá 2035"));
    expect(freedomTargetText({ age: 50, year: 2040, yearsLeft: 14, needAtTargetYear: 12_209_581_541 })).toBe(vnd("50 tuổi · năm 2040 · còn 14 năm · ≈ 12,21 tỷ ₫ theo giá 2040"));
    expect(billionText(950_000_000)).toBe(vnd("≈ 0,95 tỷ ₫"));
    expect(freedomTargetText({ age: 45, year: 2026, yearsLeft: 0, needAtTargetYear: 5_142_857_143 })).toBe("45 tuổi · năm 2026 · năm nay");
  });
});
