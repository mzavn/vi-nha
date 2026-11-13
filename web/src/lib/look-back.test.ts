import { afterEach, describe, expect, it } from "vitest";
import type { LookBack, LookBackGroup } from "../../../src/domain/look-back";
import { interestLineText } from "./interest";
import { barPct, compareText, excludedText, isEmptyLookBack, limitText, LOOK_BACK_EMPTY, LOOK_BACK_NOTE, lookBackGroups, lookBackPath, monthHeading, principalText, queueNote, savingsLine, stepMonth } from "./look-back";
import { setAmountsHidden } from "./money";
import { bookPath, filterChips, monthFilter, summaryPath } from "./tx-filter";
import type { Bootstrap } from "./types";

const vnd = (s: string) => s.replace(/ ₫/g, "\u00a0₫");
const now = new Date("2026-11-25T03:00:00Z");

const cat = (categoryId: string | null, name: string, spent: number, previousSpent = 0) => ({ categoryId, name, spent, previousSpent });
const group = (g: Partial<LookBackGroup> & Pick<LookBackGroup, "id" | "name">): LookBackGroup => ({
  essential: true,
  limit: null,
  spent: 0,
  previousSpent: 0,
  pct: null,
  left: null,
  over: null,
  categories: [],
  ...g,
});

/** Hộ mẫu D, `GET /v1/spend-by-category` hôm nay 2026-11-25 — ledger UC-108 AC-8 (tháng 11, 30 ngày, đã qua 25). */
const food = group({
  id: "d-food",
  name: "Ăn uống",
  limit: 3_000_000,
  spent: 2_500_000,
  previousSpent: 2_800_000,
  pct: 83,
  left: 500_000,
  over: 0,
  categories: [cat("groceries", "Đi chợ / nấu ăn", 1_800_000), cat("eating-out", "Ăn ngoài", 700_000)],
});
const transport = group({ id: "d-transport", name: "Đi lại", limit: 800_000, spent: 450_000, previousSpent: 700_000, pct: 56, left: 350_000, over: 0 });
const school = group({ id: "d-school", name: "Học phí", spent: 6_000_000 });
const shopping = group({ id: "d-shopping", name: "Mua sắm", essential: false, limit: 1_000_000, spent: 1_200_000, previousSpent: 600_000, pct: 120, left: 0, over: 200_000 });
const D: LookBack = {
  kind: "month",
  month: "2026-11",
  previous: "2026-10",
  next: null,
  days: 30,
  daysElapsed: 25,
  savings: { amount: 2_000_000, base: 20_000_000, pct: 10, level: "10to30", reason: null },
  total: 10_950_000,
  previousTotal: 4_400_000,
  groups: [food, transport, school, shopping],
  ungrouped: { spent: 500_000, previousSpent: 0, categories: [cat("gifts", "Quà tặng", 500_000)] },
  interest: { spent: 300_000, previousSpent: 300_000, expected: 300_000, lines: [{ debtId: "vay-tieu-dung", name: "Vay tiêu dùng", expected: 300_000, paid: 300_000, dueDay: 5 }] },
  excluded: { debtPrincipal: 2_000_000 },
  categories: [],
};
/** Tháng 10 (đã qua), xem bằng ‹. */
const OCT: LookBack = { ...D, month: "2026-10", previous: "2026-09", next: "2026-11", days: 31, daysElapsed: 31 };
const boot = { categories: [{ id: "eating-out", name: "Ăn ngoài" }], accounts: [], members: [] } as unknown as Bootstrap;

afterEach(() => setAmountsHidden(false));

describe("Ví & quỹ › Nhìn lại: câu chữ (pwa UC-707)", () => {
  it("UC-707 AC-34: đầu tab \"Tháng 11/2026 · còn 5 ngày\"; ngày cuối tháng → \"ngày cuối tháng\"; tháng đã qua \"Tháng 10/2026\"; không chữ kỳ / lương trễ", () => {
    expect(monthHeading(D)).toBe("Tháng 11/2026 · còn 5 ngày");
    expect(monthHeading({ ...D, daysElapsed: 29 })).toBe("Tháng 11/2026 · còn 1 ngày");
    expect(monthHeading({ ...D, daysElapsed: 30 })).toBe("Tháng 11/2026 · ngày cuối tháng");
    expect(monthHeading(OCT)).toBe("Tháng 10/2026");
    expect([monthHeading(D), monthHeading(OCT)].join()).not.toMatch(/kỳ|trễ/i);
  });

  it("UC-707 AC-34: Ăn uống còn 500.000 ₫, thanh 83%, so tháng trước; Mua sắm vượt 200.000 ₫ (thanh đầy, không số âm); Học phí không thanh", () => {
    expect(limitText(food)).toBe(vnd("còn 500.000 ₫"));
    expect(barPct(food)).toBe(83);
    expect(compareText(food.spent, food.previousSpent)).toBe(vnd("tháng trước 2.800.000 ₫ · ít hơn 300.000 ₫"));
    expect(compareText(shopping.spent, shopping.previousSpent)).toBe(vnd("tháng trước 600.000 ₫ · nhiều hơn 600.000 ₫"));
    expect(compareText(500_000, 500_000)).toBe(vnd("tháng trước 500.000 ₫"));
    expect(limitText(shopping)).toBe(vnd("vượt 200.000 ₫"));
    expect(barPct(shopping)).toBe(100);
    expect(limitText(school)).toBeNull();
    expect(barPct(school)).toBeNull();
  });

  it("UC-707 AC-34: hàng Lãi vay, chân \"Không tính: trả nợ gốc\" và câu hạn mức mềm; hàng đợi chưa tính; rỗng hai tháng", () => {
    expect(interestLineText(D.interest.lines[0]!)).toBe(vnd("Vay tiêu dùng · trả ngày 5 · dự kiến 300.000 ₫ · đã trả 300.000 ₫"));
    expect(excludedText(D, null)).toBe(vnd("Không tính: trả nợ gốc 2.000.000 ₫"));
    expect(excludedText({ ...D, excluded: { debtPrincipal: 0 } }, null)).toBeNull();
  });

  it("UC-707 AC-44: trả gốc ghi ở hàng nhóm Trả nợ bằng chữ mờ, không số 0, chân không lặp; tháng không trả gốc và nhóm bằng 0 thì ẩn hàng Trả nợ", () => {
    const debt = group({ id: "d-debt", name: "Trả nợ" });
    const withDebt: LookBack = { ...D, groups: [food, debt] };
    expect(lookBackGroups(withDebt, "d-debt").map((g) => g.id)).toEqual(["d-food", "d-debt"]);
    expect(principalText(withDebt, "d-debt", "d-debt")).toBe(vnd("Trả gốc 2.000.000 ₫, không tính vào chi"));
    expect(principalText(withDebt, "d-food", "d-debt")).toBeNull();
    expect(excludedText(withDebt, "d-debt")).toBeNull();
    const noPrincipal: LookBack = { ...withDebt, excluded: { debtPrincipal: 0 } };
    expect(lookBackGroups(noPrincipal, "d-debt").map((g) => g.id)).toEqual(["d-food"]);
    expect(principalText(noPrincipal, "d-debt", "d-debt")).toBeNull();
    const spentInGroup: LookBack = { ...noPrincipal, groups: [food, { ...debt, spent: 50_000 }] };
    expect(lookBackGroups(spentInGroup, "d-debt").map((g) => g.id)).toEqual(["d-food", "d-debt"]);
    // Chưa có nhóm chứa danh mục Trả nợ → chân giữ câu cũ.
    expect(lookBackGroups(withDebt, null).map((g) => g.id)).toEqual(["d-food", "d-debt"]);
    expect(excludedText(withDebt, null)).toBe(vnd("Không tính: trả nợ gốc 2.000.000 ₫"));
  });

  it("UC-707 AC-34: câu hạn mức mềm, hàng đợi chưa tính, rỗng hai tháng", () => {
    expect(LOOK_BACK_NOTE).toBe("Hạn mức mềm chỉ để nhìn lại, không giữ tiền, không âm, không bù.");
    expect(queueNote(2)).toBe("2 khoản chưa lên sổ, chưa tính ở đây");
    expect(queueNote(0)).toBeNull();
    expect(isEmptyLookBack(D)).toBe(false);
    const none: LookBack = {
      ...D,
      total: 0,
      previousTotal: 0,
      groups: [group({ id: "d-food", name: "Ăn uống" })],
      ungrouped: { spent: 0, previousSpent: 0, categories: [] },
      interest: { spent: 0, previousSpent: 0, expected: 300_000, lines: [{ debtId: "vay-tieu-dung", name: "Vay tiêu dùng", expected: 300_000, paid: 0, dueDay: 5 }] },
      excluded: { debtPrincipal: 0 },
    };
    expect(isEmptyLookBack(none)).toBe(true);
    expect(LOOK_BACK_EMPTY).toBe("Chưa có khoản chi nào trong tháng này và tháng trước.");
  });

  it("UC-707 AC-34: không chữ \"ví\", \"phong bì\", \"Ngân sách\", \"Phân tích\", không \"bù\" ngoài câu hạn mức mềm; che số áp mọi số, \"83%\" giữ", () => {
    const texts = [
      monthHeading(D),
      monthHeading(OCT),
      ...D.groups.flatMap((g) => [limitText(g), compareText(g.spent, g.previousSpent)]),
      excludedText(D, null),
      queueNote(1),
      LOOK_BACK_EMPTY,
    ].filter((t): t is string => t !== null);
    for (const t of texts) expect(t).not.toMatch(/\bví\b|phong bì|ngân sách|phân tích|\bbù\b|−/i);
    setAmountsHidden(true);
    expect(limitText(food)).toBe(vnd("còn ••••• ₫"));
    expect(limitText(shopping)).toBe(vnd("vượt ••••• ₫"));
    expect(compareText(food.spent, food.previousSpent)).toBe(vnd("tháng trước ••••• ₫ · ít hơn ••••• ₫"));
    expect(excludedText(D, null)).toBe(vnd("Không tính: trả nợ gốc ••••• ₫"));
    expect(barPct(food)).toBe(83);
  });

  it("UC-707 AC-35: ‹ về tháng 10 (địa chỉ mang tháng, `?period=2026-10`); › từ tháng 10 về tháng hiện tại (không tháng trên địa chỉ); tháng hiện tại không có ›", () => {
    expect(lookBackPath(null)).toBe("/v1/spend-by-category");
    expect(stepMonth(D, -1, "2026-11")).toEqual({ month: "2026-10" });
    expect(lookBackPath("2026-10")).toBe("/v1/spend-by-category?period=2026-10");
    expect(stepMonth(D, 1, "2026-11")).toBeNull();
    expect(stepMonth(OCT, 1, "2026-11")).toEqual({ month: null });
    expect(stepMonth(OCT, -1, "2026-11")).toEqual({ month: "2026-09" });
    expect(lookBackPath("2026-09")).not.toContain("cycle");
  });

  it("UC-707 AC-40: hộ mẫu D, 25/11 → \"Tháng 11/2026 · còn 5 ngày\"; ‹ → tháng 10; chạm Ăn ngoài → Sổ giao dịch lọc tháng + Ăn ngoài, Chi đọc cùng tháng (`month`, không `cycle`)", () => {
    expect(monthHeading(D)).toBe("Tháng 11/2026 · còn 5 ngày");
    const f = monthFilter(OCT.month, "eating-out", now);
    expect(bookPath(f)).toBe("/v1/transactions?month=2026-10&category_id=eating-out&limit=51");
    expect(summaryPath(f)).toBe("/v1/transactions/summary?month=2026-10&category_id=eating-out");
    expect(filterChips(f, boot).map((c) => c.label)).toEqual(["Ăn ngoài"]);
    expect(bookPath(monthFilter(D.month, null, now))).toBe("/v1/transactions?month=2026-11&limit=51");
  });

  it("UC-108 AC-7: tháng 10 (lương 30.000.000, đã trích 3.000.000) → 'Tích luỹ tháng 10: 3.000.000 ₫ (10% lương) · mức 10–30%'; bỏ qua ① có lý do → '… 0 ₫ · 0% — Tháng này trả viện phí'; không lương → không dòng; che số giữ %", () => {
    expect(savingsLine("2026-10", { amount: 3_000_000, base: 30_000_000, level: "10to30", reason: null })).toBe(vnd("Tích luỹ tháng 10: 3.000.000 ₫ (10% lương) · mức 10–30%"));
    expect(savingsLine("2026-11", { amount: 0, base: 30_000_000, level: "zero", reason: "Tháng này trả viện phí" })).toBe(vnd("Tích luỹ tháng 11: 0 ₫ · 0% — Tháng này trả viện phí"));
    expect(savingsLine("2026-11", { amount: 200_000, base: 30_000_000, level: "below1", reason: null })).toBe(vnd("Tích luỹ tháng 11: 200.000 ₫ (0% lương) · mức dưới 1%"));
    expect(savingsLine("2026-11", { amount: 9_500_000, base: 30_000_000, level: "from30", reason: null })).toBe(vnd("Tích luỹ tháng 11: 9.500.000 ₫ (31% lương) · mức từ 30%"));
    expect(savingsLine("2026-11", { amount: 0, base: 30_000_000, level: null, reason: null })).toBe(vnd("Tích luỹ tháng 11: 0 ₫ (0% lương)"));
    expect(savingsLine("2026-11", { amount: 0, base: 0, level: null, reason: null })).toBeNull();
    expect(savingsLine("2026-11", null)).toBeNull();
    expect(savingsLine("2026-11", undefined)).toBeNull();
    setAmountsHidden(true);
    expect(savingsLine("2026-10", { amount: 3_000_000, base: 30_000_000, level: "10to30", reason: null })).toBe(vnd("Tích luỹ tháng 10: ••••• ₫ (10% lương) · mức 10–30%"));
  });
});
