import { afterEach, describe, expect, it } from "vitest";
import {
  billionText,
  cushionCoveredText,
  cushionLine,
  expenseNeededText,
  freedomTargetText,
  incomeMilestoneText,
  incomeSourceText,
  LADDER_LABEL,
  ladderNote,
  ladderRows,
  MILESTONE_LABEL,
  paramsSummary,
  swrNote,
  type LadderInput,
} from "./freedom";
import { setAmountsHidden } from "./money";
import type { FreedomParams } from "./types";

afterEach(() => setAmountsHidden(false));

const NBSP = "\u00a0";
const vnd = (s: string) => s.replaceAll(" ₫", `${NBSP}₫`);

const params: FreedomParams = {
  expenseMonthly: 20_000_000,
  expenseSource: "manual",
  expenseMustMonthly: 15_000_000,
  expenseMustSource: "manual",
  expenseLedgerMonths: null,
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

/** Hộ UC-1103 AC-9 ngày 17/11/2026: E 14.200.000 theo sổ 1 tháng, E_must 10.000.000, đệm 7.410.000; tài sản cho FIRE 456.000.000. */
const ladderHome = (): LadderInput => ({
  params: { ...params, expenseMonthly: 14_200_000, expenseSource: "ledger", expenseMustMonthly: 10_000_000, expenseMustSource: "ledger", expenseLedgerMonths: 1 },
  cushion: {
    amount: 7_410_000,
    monthsCovered: 0.5,
    next: "start",
    steps: [
      { key: "start", months: 1, need: 14_200_000, have: 7_410_000, pct: 52.1, reached: false },
      { key: "calm", months: 6, need: 85_200_000, have: 7_410_000, pct: 8.6, reached: false },
      { key: "safe", months: 12, need: 170_400_000, have: 7_410_000, pct: 4.3, reached: false },
      { key: "solid", months: 24, need: 340_800_000, have: 7_410_000, pct: 2.1, reached: false },
    ],
  },
  halfway: { need: 1_714_285_715, have: 456_000_000, pct: 26.6, cashflowNeed: 7_100_000, cashflowHave: 104_166, reached: false },
  freedom: [
    { key: "F1", need: 3_428_571_429, have: 456_000_000, pct: 13.3, cashflowNeed: 10_000_000, cashflowHave: 104_166, reached: false, target: null },
    { key: "F2", need: 5_355_428_572, have: 456_000_000, pct: 8.5, cashflowNeed: 15_620_000, cashflowHave: 104_166, reached: false, target: null },
    { key: "F3", need: 6_248_000_000, have: 456_000_000, pct: 7.3, cashflowNeed: 15_620_000, cashflowHave: 104_166, reached: false, target: null },
  ],
});

/** Cùng hộ khi sổ chưa hết tháng nào: không E, không E_must; đệm vẫn 7.410.000. */
const ladderNoExpense = (): LadderInput => {
  const h = ladderHome();
  return {
    params: { ...h.params, expenseMonthly: null, expenseSource: null, expenseMustMonthly: null, expenseMustSource: null, expenseLedgerMonths: null },
    cushion: { amount: 7_410_000, monthsCovered: null, next: null, steps: h.cushion.steps.map((s) => ({ ...s, need: null, pct: null, reached: null })) },
    halfway: { need: null, have: 456_000_000, pct: null, cashflowNeed: null, cashflowHave: 104_166, reached: null },
    freedom: h.freedom.map((m) => ({ ...m, need: null, pct: null, cashflowNeed: null, reached: null })),
  };
};

describe("Mốc tự do: câu chữ", () => {
  it("UC-1103 AC-12: card Thông số \"Chi 14.200.000 ₫/tháng (theo sổ, 1 tháng) · Thiết yếu 10.000.000 · SWR 3,5% · lạm phát 3,5%\"; tự nhập, đủ 3 tháng ghi rõ; chưa có E → câu chờ hết tháng đầu tiên", () => {
    expect(paramsSummary(ladderHome().params)).toBe(vnd("Chi 14.200.000 ₫/tháng (theo sổ, 1 tháng) · Thiết yếu 10.000.000 · SWR 3,5% · lạm phát 3,5%"));
    expect(paramsSummary({ ...ladderHome().params, expenseLedgerMonths: 2 })).toMatch("(theo sổ, 2 tháng)");
    expect(paramsSummary({ ...ladderHome().params, expenseLedgerMonths: 3 })).toMatch("(theo sổ, 3 tháng gần nhất)");
    expect(paramsSummary(params)).toBe(vnd("Chi 20.000.000 ₫/tháng (tự nhập) · Thiết yếu 15.000.000 · SWR 3,5% · lạm phát 3,5%"));
    expect(paramsSummary(ladderNoExpense().params)).toBe("Cần chi phí tháng — nhập ở Ngưỡng và tỉ lệ hoặc chờ hết tháng đầu tiên · SWR 3,5% · lạm phát 3,5%");
    expect(expenseNeededText).toBe("Cần chi phí tháng — nhập ở Ngưỡng và tỉ lệ hoặc chờ hết tháng đầu tiên");
  });

  it("UC-1103 AC-12: Thang mốc 8 hàng đúng thứ tự, mỗi hàng có câu quyết định; Khởi đầu \"Đệm 7.410.000 ₫ / cần 14.200.000 ₫\" 52,1% chưa đạt; Nửa đường, F1 \"Tài sản cho FIRE … / cần …\" và dòng tiền ròng", () => {
    const rows = ladderRows(ladderHome());
    expect(rows.map((r) => r.name)).toEqual([
      "Khởi đầu · 1 tháng chi",
      "An tâm · 6 tháng chi",
      "An toàn · 12 tháng chi",
      "Vững vàng · 24 tháng chi",
      "Nửa đường",
      "F1 · Tự do cơ bản",
      "F2 · Tự do hoàn toàn",
      "F3 · Tự do trọn đời",
    ]);
    expect(rows.map((r) => r.decision)).toEqual([
      "Thoát tiêu hết tháng",
      "Giữ chặt, chưa đầu tư",
      "Bắt đầu mua tài sản theo cơ hội",
      "Tích luỹ vượt mốc đem mua tài sản",
      "Có thể giảm giờ làm",
      "Nghỉ nếu chỉ chi thiết yếu",
      "Nghỉ, giữ mức sống",
      "Gốc không giảm, để lại cho con",
    ]);
    expect(rows[0]).toMatchObject({ have: vnd("Đệm 7.410.000 ₫ / cần 14.200.000 ₫"), pct: 52.1, reached: false, cashflow: null });
    expect(rows[3]).toMatchObject({ have: vnd("Đệm 7.410.000 ₫ / cần 340.800.000 ₫"), pct: 2.1 });
    expect(rows[4]).toMatchObject({
      have: vnd("Tài sản cho FIRE 456.000.000 ₫ / cần 1.714.285.715 ₫"),
      cashflow: vnd("hoặc dòng tiền ròng 104.166 ₫ / cần 7.100.000 ₫"),
      pct: 26.6,
      reached: false,
    });
    expect(rows[5]).toMatchObject({ have: vnd("Tài sản cho FIRE 456.000.000 ₫ / cần 3.428.571.429 ₫"), cashflow: vnd("hoặc dòng tiền ròng 104.166 ₫ / cần 10.000.000 ₫") });
    expect(rows.filter((r) => r.group === "cushion")).toHaveLength(4);
  });

  it("UC-1103 AC-12: dưới bốn bậc đệm \"Tích luỹ 7.410.000 ₫ đủ 0,5 tháng chi.\"; chú card đệm / tài sản cho FIRE; chú SWR so lãi tiền gửi thực", () => {
    expect(cushionCoveredText(ladderHome().cushion)).toBe(vnd("Tích luỹ 7.410.000 ₫ đủ 0,5 tháng chi."));
    expect(cushionCoveredText(ladderNoExpense().cushion)).toBeNull();
    expect(ladderNote(params)).toBe(
      "Đệm = tiền ngăn Tích luỹ, kể cả Heo đất; không gồm vàng. Tài sản cho FIRE = tài sản đầu tư trừ nợ, không gồm tiền Vận hành, tiền mục tiêu Dự phòng, Ví Thưởng và đệm tới 24 tháng chi.",
    );
    expect(swrNote(params)).toBe("SWR 3,5% là giả định; lãi tiền gửi sau lạm phát thường chỉ quanh 2%/năm.");
  });

  it("UC-1103 AC-12: che số → mọi số tiền của Thang mốc thành \"•••••\" (Đệm, cần, Tài sản cho FIRE, dòng tiền ròng, câu số tháng đệm); %, số tháng, tên bậc, câu quyết định giữ nguyên", () => {
    setAmountsHidden(true);
    const rows = ladderRows(ladderHome());
    expect(rows[0]).toMatchObject({ name: "Khởi đầu · 1 tháng chi", decision: "Thoát tiêu hết tháng", pct: 52.1, have: vnd("Đệm ••••• ₫ / cần ••••• ₫") });
    expect(rows[4]).toMatchObject({ have: vnd("Tài sản cho FIRE ••••• ₫ / cần ••••• ₫"), cashflow: vnd("hoặc dòng tiền ròng ••••• ₫ / cần ••••• ₫"), pct: 26.6 });
    expect(rows[5]!.have).toBe(vnd("Tài sản cho FIRE ••••• ₫ / cần ••••• ₫"));
    expect(ladderRows(ladderNoExpense())[0]!.have).toBe(vnd(`Đệm ••••• ₫ · ${expenseNeededText}`));
    expect(cushionCoveredText(ladderHome().cushion)).toBe(vnd("Tích luỹ ••••• ₫ đủ 0,5 tháng chi."));
    expect(JSON.stringify([rows, cushionCoveredText(ladderHome().cushion)])).not.toMatch(/\d\.\d{3}/);
  });

  it("UC-1103 AC-12: sổ chưa hết tháng → các hàng theo E không chip, chữ \"Cần chi phí tháng — …\"; hàng đệm vẫn \"Đệm 7.410.000 ₫\"", () => {
    const rows = ladderRows(ladderNoExpense());
    expect(rows.every((r) => r.reached === null && r.pct === null && r.cashflow === null)).toBe(true);
    expect(rows[0]!.have).toBe(vnd(`Đệm 7.410.000 ₫ · ${expenseNeededText}`));
    expect(rows[4]!.have).toBe(vnd(`Tài sản cho FIRE 456.000.000 ₫ · ${expenseNeededText}`));
    expect(rows[5]!.have).toBe(vnd(`Tài sản cho FIRE 456.000.000 ₫ · ${expenseNeededText}`));
  });

  it("UC-707 AC-47: dòng đệm thẻ Tích luỹ — \"Đủ 0,5 tháng chi · mốc Khởi đầu 1E\"; 6,3 → An toàn 12E; 28,1 → đã qua Vững vàng 24E; E trống → câu cần chi phí tháng; đệm âm → 0", () => {
    const six = [6, 12, 24] as [number, number, number];
    expect(cushionLine(7_410_000, 14_200_000, six)).toBe("Đủ 0,5 tháng chi · mốc Khởi đầu 1E");
    expect(cushionLine(90_000_000, 14_200_000, six)).toBe("Đủ 6,3 tháng chi · mốc An toàn 12E");
    expect(cushionLine(400_000_000, 14_200_000, six)).toBe("Đủ 28,1 tháng chi · đã qua mốc Vững vàng 24E");
    expect(cushionLine(7_410_000, null, six)).toBe(expenseNeededText);
    expect(cushionLine(6_410_000, 14_200_000, six)).toBe("Đủ 0,4 tháng chi · mốc Khởi đầu 1E");
    expect(cushionLine(-1_000_000, 14_200_000, six)).toBe("Đủ 0 tháng chi · mốc Khởi đầu 1E");
    expect(cushionLine(50_000_000, 14_200_000, [3, 6, 12])).toBe("Đủ 3,5 tháng chi · mốc An toàn 6E");
  });

  it("UC-1103 AC-4: mốc thu nhập — đạt / còn thiếu; thu nhập theo kế hoạch ghi \"theo kế hoạch\"; không có số → \"chưa có số\"", () => {
    expect(incomeMilestoneText({ key: "M2p", need: 33_333_334, have: 45_000_000, reached: true })).toBe(vnd("Thu nhập 45.000.000 ₫ · cần 33.333.334 ₫ · đạt"));
    expect(incomeMilestoneText({ key: "M3", need: 40_000_000, have: 30_000_000, reached: false })).toBe(vnd("Thu nhập 30.000.000 ₫ · cần 40.000.000 ₫ · còn thiếu 10.000.000 ₫"));
    expect(incomeMilestoneText({ key: "M2", need: 20_000_000, have: null, reached: null })).toBe("chưa có số");
    expect(incomeSourceText("plan")).toBe("theo kế hoạch");
    expect(incomeSourceText("ledger")).toBe("theo sổ, 3 tháng gần nhất");
    expect(incomeSourceText(null)).toBeNull();
  });

  it("UC-1103 AC-2: F1 \"45 tuổi · năm 2035 · còn 9 năm · ≈ 7,01 tỷ ₫ theo giá 2035\"; F2 \"≈ 12,21 tỷ ₫ theo giá 2040\"", () => {
    expect(freedomTargetText({ age: 45, year: 2035, yearsLeft: 9, needAtTargetYear: 7_009_186_388 })).toBe(vnd("45 tuổi · năm 2035 · còn 9 năm · ≈ 7,01 tỷ ₫ theo giá 2035"));
    expect(freedomTargetText({ age: 50, year: 2040, yearsLeft: 14, needAtTargetYear: 12_209_581_541 })).toBe(vnd("50 tuổi · năm 2040 · còn 14 năm · ≈ 12,21 tỷ ₫ theo giá 2040"));
    expect(billionText(950_000_000)).toBe(vnd("≈ 0,95 tỷ ₫"));
    expect(freedomTargetText({ age: 45, year: 2026, yearsLeft: 0, needAtTargetYear: 5_142_857_143 })).toBe("45 tuổi · năm 2026 · năm nay");
  });

  it("UC-717 AC-6: M2′ \"Đủ chi sau phần trích trước (Tích luỹ, Thuế)\", F1 \"chi thiết yếu\"; không chữ Must, Có thì tốt, Hưởng thụ, phần khóa, Tích sản", () => {
    expect(MILESTONE_LABEL.M2p).toEqual({ name: "M2′ · Đủ chi sau phần trích trước", hint: "Thu nhập trừ phần trích trước (Tích luỹ, Thuế) vẫn đủ chi phí tháng" });
    expect(LADDER_LABEL.F1.decision).toBe("Nghỉ nếu chỉ chi thiết yếu");
    expect(`${JSON.stringify(MILESTONE_LABEL)} ${JSON.stringify(LADDER_LABEL)} ${paramsSummary(params)}`).not.toMatch(/Must|Có thì tốt|Hưởng thụ|phần khóa|Tích sản/);
  });
});
