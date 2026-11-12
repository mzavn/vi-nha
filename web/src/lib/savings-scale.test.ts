import { describe, expect, it } from "vitest";
import { formatVnd } from "./money";
import { amountOfPct, belowMinText, levelText, pctOfAmount, SAVINGS_MARKS, SAVINGS_SCALE_TEXT } from "./savings-scale";

describe("thang Tích luỹ 1 · 10 · 30% (ADR-142)", () => {
  it("UC-702 AC-35: lương 30.000.000 — 10% → 3.000.000; kéo tới vạch 30 → 9.000.000; gõ 150.000 → thanh 1 và câu dưới mức tối thiểu 300.000 ₫; 0 → không câu", () => {
    expect(SAVINGS_MARKS.map((m) => [m.pct, m.label])).toEqual([[1, "tối thiểu"], [10, "thường"], [30, "hướng tới"]]);
    expect(amountOfPct(30_000_000, 10)).toBe(3_000_000);
    expect(amountOfPct(30_000_000, 30)).toBe(9_000_000);
    expect(pctOfAmount(150_000, 30_000_000)).toBe(1);
    expect(pctOfAmount(40_000_000, 30_000_000)).toBe(100);
    expect(belowMinText(150_000, 30_000_000)).toBe(`Dưới mức tối thiểu 1% (${formatVnd(300_000)})`);
    expect(belowMinText(300_000, 30_000_000)).toBeNull();
    expect(belowMinText(0, 30_000_000)).toBeNull();
  });

  it("UC-709 AC-37: câu thang của nhà", () => {
    expect(SAVINGS_SCALE_TEXT).toBe("Thang của nhà: tối thiểu 1% · thường 10% · hướng tới 30%. Kỳ nào không trích được thì bỏ qua việc trích ở Hôm nay và ghi lý do.");
  });

  it("UC-702 AC-36: chữ mức đạt", () => {
    expect([levelText("below1"), levelText("1to10"), levelText("10to30"), levelText("from30")]).toEqual(["đạt mức dưới 1%", "đạt mức 1–10%", "đạt mức 10–30%", "đạt mức từ 30%"]);
    expect(levelText("zero", "Tháng này trả viện phí")).toBe("0% — Tháng này trả viện phí");
    expect(levelText(null)).toBeNull();
  });
});
