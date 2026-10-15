import { describe, expect, it } from "vitest";
import { prefillSplit } from "./manual-split";
import type { AllocationPlan, Wallet } from "./types";
import {
  DEFAULT_WEALTH_PCT,
  WEALTH_TICKS,
  initialWealth,
  syncSplitWealth,
  wealthAmountFor,
  wealthBlocked,
  wealthBody,
  wealthFromAmount,
  wealthSplitNote,
  withIncome,
} from "./wealth-slider";

const INCOME = 24_000_000;

describe("Có / Không Tích sản khi chia (change 261015-chot-thang-va-keo-tich-san)", () => {
  it("UC-202 AC-8: khoản thu 24.000.000, luật Tích sản 30% → mặc định Có Tích sản, 10%, 2.400.000", () => {
    expect(DEFAULT_WEALTH_PCT).toBe(10);
    expect(WEALTH_TICKS).toEqual([1, 10, 30]);
    // Mặc định không theo % luật nạp: luật 30% vẫn ra 10%.
    expect(initialWealth(INCOME)).toEqual({ mode: "on", pct: 10, amount: 2_400_000 });
  });

  it("UC-202 AC-8: kéo 30% → 7.200.000; gõ 3.600.000 → 15%; gõ 100.000 → kẹp 1% (240.000)", () => {
    expect(wealthAmountFor(30, INCOME)).toBe(7_200_000);
    expect(wealthFromAmount(3_600_000, INCOME)).toEqual({ pct: 15, amount: 3_600_000 });
    expect(wealthFromAmount(100_000, INCOME)).toEqual({ pct: 1, amount: 240_000 });
    // một chữ số lẻ
    expect(wealthFromAmount(3_000_000, 19_000_000)).toEqual({ pct: 15.8, amount: 3_000_000 });
  });

  it("UC-202 AC-8: chọn Không Tích sản → cần lý do, nút ghi tắt tới khi có lý do; body là wealth_amount 0 + wealth_note", () => {
    expect(wealthBlocked({ mode: "off", note: "" })).toBe(true);
    expect(wealthBlocked({ mode: "off", note: "   " })).toBe(true);
    expect(wealthBlocked({ mode: "off", note: " Trả học phí kỳ 1 " })).toBe(false);
    expect(wealthBlocked(initialWealth(INCOME))).toBe(false);
    expect(wealthBlocked(null)).toBe(false);
    expect(wealthBody({ mode: "off", note: " Trả học phí kỳ 1 " })).toEqual({ wealth_amount: 0, wealth_note: "Trả học phí kỳ 1" });
    expect(wealthBody(initialWealth(INCOME))).toEqual({ wealth_amount: 2_400_000 });
    // Nguồn khóa 100%: không có lựa chọn → không gửi gì thêm.
    expect(wealthBody(null)).toEqual({});
  });

  it("UC-202: khoản thu dưới 100.000 làm tròn tới đồng, tối thiểu 1 đồng; khoản thu lẻ nghìn ở 100% không vượt khoản thu; gõ quá khoản thu → 100%", () => {
    expect(wealthAmountFor(10, 55_555)).toBe(5_556);
    expect(wealthAmountFor(1, 50)).toBe(1);
    expect(wealthAmountFor(10, 1_234_567)).toBe(123_000);
    expect(wealthAmountFor(100, 1_234_567)).toBe(1_234_567);
    expect(wealthAmountFor(99, 1_000_600)).toBeLessThanOrEqual(1_000_600);
    expect(wealthFromAmount(30_000_000, INCOME)).toEqual({ pct: 100, amount: INCOME });
    // Đổi số khoản thu: giữ %, tính lại số; Không Tích sản giữ nguyên lý do.
    expect(withIncome({ mode: "on", pct: 30, amount: 7_200_000 }, 10_000_000)).toEqual({ mode: "on", pct: 30, amount: 3_000_000 });
    expect(withIncome({ mode: "off", note: "x" }, 10_000_000)).toEqual({ mode: "off", note: "x" });
  });

  it("UC-202 AC-7: Tự chia — ô Tích sản theo thanh; Không Tích sản → ô Tích sản 0, gửi wealth_note", () => {
    const wallets = [
      { id: "wealth-building", name: "Tích sản", tier: "wealth_building" },
      { id: "food", name: "Ăn uống", tier: "must" },
    ] as Wallet[];
    const plan = { funds: [{ walletId: "wealth-building", amount: 7_200_000 }, { walletId: "food", amount: 16_800_000 }] } as AllocationPlan;
    const split = { ...prefillSplit(plan, wallets), invalid: ["wealth-building"] };
    expect(syncSplitWealth(split, "wealth-building", initialWealth(INCOME))).toEqual({
      amounts: { "wealth-building": 2_400_000, food: 16_800_000 },
      invalid: [],
    });
    expect(syncSplitWealth(split, "wealth-building", { mode: "off", note: "" }).amounts["wealth-building"]).toBe(0);
    expect(wealthSplitNote({ mode: "off", note: " Trả nợ gấp " })).toEqual({ wealth_note: "Trả nợ gấp" });
    expect(wealthSplitNote(initialWealth(INCOME))).toEqual({});
    expect(wealthSplitNote(null)).toEqual({});
  });
});
