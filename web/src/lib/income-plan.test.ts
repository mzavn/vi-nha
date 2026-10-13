import { describe, expect, it } from "vitest";
import { editedText, memberPlanText, planFormFrom, planHeadline, planPayload, planSplitHint, planSub, planYearRow } from "./income-plan";
import type { IncomePlanYear } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => s.replaceAll(" ₫", `${NBSP}₫`);

// Năm 2026 của balance UC-1104 AC-1.
const y2026: IncomePlanYear = {
  year: 2026,
  current: {
    id: 2,
    createdAt: "2026-07-01T03:00:00Z",
    householdMonthly: 45_000_000,
    lines: [
      { name: "Lương", memberId: "husband", memberName: "Chồng", monthly: 30_000_000 },
      { name: "Lương", memberId: "wife", memberName: "Vợ", monthly: 12_000_000 },
      { name: "Cho thuê", memberId: null, memberName: "Chung", monthly: 3_000_000 },
    ],
  },
  first: { id: 1, createdAt: "2026-01-02T03:00:00Z", householdMonthly: 50_000_000, lines: [] },
  versions: [
    { id: 1, createdAt: "2026-01-02T03:00:00Z", householdMonthly: 50_000_000 },
    { id: 2, createdAt: "2026-07-01T03:00:00Z", householdMonthly: 45_000_000 },
  ],
  actual: { monthsCounted: 1, total: 43_500_000, monthlyAverage: 43_500_000, pctOfCurrent: 96.6, pctOfFirst: 87, pctOfYear: 8 },
  byMember: [
    { memberId: "husband", memberName: "Chồng", planned: 30_000_000, actual: 28_000_000, pct: 93.3 },
    { memberId: "wife", memberName: "Vợ", planned: 12_000_000, actual: 12_500_000, pct: 104.1 },
    { memberId: null, memberName: "Chung", planned: 3_000_000, actual: 3_000_000, pct: 100 },
  ],
};

describe("Kế hoạch thu nhập theo năm", () => {
  it("UC-1104 AC-1: \"Cả nhà 43.500.000 / 45.000.000 ₫ mỗi tháng · 96,6%\"; \"Đầu năm 50.000.000 ₫ (87,0%) · cả năm 8,0% · tính trên 1 tháng đã kết thúc\"; \"sửa 1 lần, lần cuối 1/7\"", () => {
    expect(planHeadline(y2026)).toBe(vnd("Cả nhà 43.500.000 / 45.000.000 ₫ mỗi tháng · 96,6%"));
    expect(planSub(y2026)).toBe(vnd("Đầu năm 50.000.000 ₫ (87,0%) · cả năm 8,0% · tính trên 1 tháng đã kết thúc"));
    expect(editedText(y2026)).toBe("sửa 1 lần, lần cuối 1/7");
  });

  it("UC-1104 AC-1: theo người — \"Lương · Chồng\" \"28.000.000 / 30.000.000 ₫ · 93,3%\", Vợ 104,1%, Chung 100,0%", () => {
    expect(memberPlanText(y2026.byMember![0]!)).toBe(vnd("28.000.000 / 30.000.000 ₫ · 93,3%"));
    expect(memberPlanText(y2026.byMember![1]!)).toBe(vnd("12.500.000 / 12.000.000 ₫ · 104,1%"));
    expect(memberPlanText(y2026.byMember![2]!)).toBe(vnd("3.000.000 / 3.000.000 ₫ · 100,0%"));
    // Chưa có tháng nào kết thúc trong sổ: không hiện số 0 hay "(—)".
    const empty = { ...y2026, actual: { monthsCounted: 0, total: 0, monthlyAverage: null, pctOfCurrent: null, pctOfFirst: null, pctOfYear: null } };
    expect(planHeadline(empty)).toBe(vnd("Cả nhà chưa có số / 45.000.000 ₫ mỗi tháng"));
    expect(planSub(empty)).toBe(vnd("Đầu năm 50.000.000 ₫ · chưa có tháng nào kết thúc trong sổ"));
    expect(memberPlanText(y2026.byMember![0]!, false)).toBe(vnd("chưa có số / 30.000.000 ₫"));
  });

  it("UC-1104 AC-2: chỉ mục tiêu cả nhà → một bản không chia; thiếu / 0 mục tiêu cả nhà → lỗi \"Cần mục tiêu cả nhà\"; dòng không tên hay số 0 bị chặn", () => {
    expect(planPayload({ household: 60_000_000, lines: [] })).toEqual({ ok: true, value: { household_monthly: 60_000_000 } });
    expect(planPayload({ household: 0, lines: [] })).toEqual({ ok: false, errors: { household: "Cần mục tiêu cả nhà" } });
    expect(planPayload({ household: 45_000_000, lines: [{ key: 1, name: " Lương ", memberId: "husband", monthly: 30_000_000 }, { key: 2, name: "Cho thuê", memberId: null, monthly: 3_000_000 }] })).toEqual({
      ok: true,
      value: {
        household_monthly: 45_000_000,
        lines: [
          { name: "Lương", member_id: "husband", monthly_amount: 30_000_000 },
          { name: "Cho thuê", member_id: null, monthly_amount: 3_000_000 },
        ],
      },
    });
    expect(planPayload({ household: 45_000_000, lines: [{ key: 1, name: "", memberId: null, monthly: 1 }] }).ok).toBe(false);
  });

  it("chia theo người không bắt buộc bằng mục tiêu cả nhà: \"chưa chia 3.000.000 ₫\" / \"chia vượt 1.000.000 ₫\"; form sửa điền sẵn bản hiện tại", () => {
    expect(planSplitHint(45_000_000, [{ monthly: 30_000_000 }, { monthly: 12_000_000 }])).toBe(vnd("Chưa chia 3.000.000 ₫"));
    expect(planSplitHint(45_000_000, [{ monthly: 46_000_000 }])).toBe(vnd("Chia vượt 1.000.000 ₫"));
    expect(planSplitHint(45_000_000, [{ monthly: 45_000_000 }])).toBeNull();
    expect(planSplitHint(45_000_000, [])).toBeNull();
    const f = planFormFrom(y2026);
    expect(f.household).toBe(45_000_000);
    expect(f.lines.map((l) => [l.name, l.memberId, l.monthly])).toEqual([
      ["Lương", "husband", 30_000_000],
      ["Lương", "wife", 12_000_000],
      ["Cho thuê", null, 3_000_000],
    ]);
    expect(planFormFrom(null).household).toBe(0);
  });

  it("UC-1104 AC-3: các năm — 2026 \"45.000.000 ₫ · đầu năm 50.000.000 ₫ · 96,6% · cả năm 8,0%\"; 2025 thực tế \"chưa có số\"", () => {
    expect(planYearRow({ year: 2026, currentMonthly: 45_000_000, firstMonthly: 50_000_000, versions: 2, monthlyAverage: 43_500_000, monthsCounted: 1, pctOfCurrent: 96.6, pctOfFirst: 87, pctOfYear: 8 })).toBe(
      vnd("đầu năm 50.000.000 ₫ · thực tế 43.500.000 ₫/tháng · 96,6% · cả năm 8,0%"),
    );
    expect(planYearRow({ year: 2025, currentMonthly: 40_000_000, firstMonthly: 40_000_000, versions: 1, monthlyAverage: null, monthsCounted: 0, pctOfCurrent: null, pctOfFirst: null, pctOfYear: null })).toBe("thực tế chưa có số");
  });
});
