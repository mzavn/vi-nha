import { afterEach, describe, expect, it } from "vitest";
import type { LookBack, LookBackGroup } from "../../../src/domain/look-back";
import { interestLineText } from "./interest";
import {
  barPct,
  compareText,
  cycleHeading,
  excludedText,
  isEmptyLookBack,
  limitText,
  LOOK_BACK_EMPTY,
  LOOK_BACK_NOTE,
  lookBackPath,
  queueNote,
  savingsLine,
  stepCycle,
} from "./look-back";
import { setAmountsHidden } from "./money";
import { bookPath, cycleFilter, filterChips, summaryPath } from "./tx-filter";
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

type CycleLookBack = Extract<LookBack, { kind: "cycle" }>;

/** Hộ mẫu D (proposal 261112-ba-ngan-nhin-lai), `GET /v1/spend-by-category` hôm nay 2026-11-25 — ledger UC-108 AC-4. */
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
const D: CycleLookBack = {
  kind: "cycle",
  cycle: { payday: "2026-11-10", start: "2026-11-10T01:00:00.000Z", end: null, stored: true, days: 30, daysElapsed: 16 },
  previous: { payday: "2026-10-10", start: "2026-10-10T01:00:00.000Z", end: "2026-11-10T01:00:00.000Z", stored: true },
  next: null,
  total: 10_950_000,
  previousTotal: 4_400_000,
  groups: [food, transport, school, shopping],
  ungrouped: { spent: 500_000, previousSpent: 0, categories: [cat("gifts", "Quà tặng", 500_000)] },
  interest: { spent: 300_000, previousSpent: 300_000, expected: 300_000, lines: [{ debtId: "vay-tieu-dung", name: "Vay tiêu dùng", expected: 300_000, paid: 300_000, dueDay: 5 }] },
  excluded: { debtPrincipal: 2_000_000 },
  categories: [],
};
/** Kỳ 10/10 (đã kết thúc), xem bằng ‹ — ledger UC-108 AC-5. */
const OCT: CycleLookBack = {
  ...D,
  cycle: { payday: "2026-10-10", start: "2026-10-10T01:00:00.000Z", end: "2026-11-10T01:00:00.000Z", stored: true, days: 31, daysElapsed: 31 },
  previous: { payday: "2026-09-10", start: "2026-09-09T17:00:00.000Z", end: "2026-10-10T01:00:00.000Z", stored: false },
  next: { payday: "2026-11-10", start: "2026-11-10T01:00:00.000Z", end: null, stored: true },
};
const boot = { categories: [{ id: "eating-out", name: "Ăn ngoài" }], accounts: [], members: [] } as unknown as Bootstrap;

afterEach(() => setAmountsHidden(false));

describe("Ví & quỹ › Nhìn lại: câu chữ (pwa UC-707)", () => {
  it("UC-707 AC-34: đầu tab \"Kỳ từ 10/11 · còn 15 ngày\"; lương trễ → \"Lương dự kiến 10/12 chưa về (trễ 2 ngày)\"", () => {
    expect(cycleHeading(D.cycle)).toBe("Kỳ từ 10/11 · còn 15 ngày");
    expect(cycleHeading({ ...D.cycle, daysElapsed: 30 })).toBe("Kỳ từ 10/11 · còn 1 ngày");
    expect(cycleHeading({ ...D.cycle, daysElapsed: 30, lateDays: 2 })).toBe("Kỳ từ 10/11 · Lương dự kiến 10/12 chưa về (trễ 2 ngày)");
  });

  it("UC-707 AC-34: Ăn uống còn 500.000 ₫, thanh 83%, so kỳ trước; Mua sắm vượt 200.000 ₫ (thanh đầy, không số âm); Học phí không thanh", () => {
    expect(limitText(food)).toBe(vnd("còn 500.000 ₫"));
    expect(barPct(food)).toBe(83);
    expect(compareText(food.spent, food.previousSpent)).toBe(vnd("kỳ trước 2.800.000 ₫ · ít hơn 300.000 ₫"));
    expect(compareText(shopping.spent, shopping.previousSpent)).toBe(vnd("kỳ trước 600.000 ₫ · nhiều hơn 600.000 ₫"));
    expect(compareText(500_000, 500_000)).toBe(vnd("kỳ trước 500.000 ₫"));
    expect(limitText(shopping)).toBe(vnd("vượt 200.000 ₫"));
    expect(barPct(shopping)).toBe(100);
    expect(limitText(school)).toBeNull();
    expect(barPct(school)).toBeNull();
  });

  it("UC-707 AC-34: hàng Lãi vay, chân \"Không tính: trả nợ gốc\" và câu hạn mức mềm; hàng đợi chưa tính; rỗng hai kỳ", () => {
    expect(interestLineText(D.interest.lines[0]!)).toBe(vnd("Vay tiêu dùng · trả ngày 5 · dự kiến 300.000 ₫ · đã trả 300.000 ₫"));
    expect(excludedText(D.excluded.debtPrincipal)).toBe(vnd("Không tính: trả nợ gốc 2.000.000 ₫"));
    expect(excludedText(0)).toBeNull();
    expect(LOOK_BACK_NOTE).toBe("Hạn mức mềm chỉ để nhìn lại — không giữ tiền, không âm, không bù.");
    expect(queueNote(2)).toBe("2 khoản chưa lên sổ chưa tính ở đây");
    expect(queueNote(0)).toBeNull();
    expect(isEmptyLookBack(D)).toBe(false);
    const none: CycleLookBack = {
      ...D,
      total: 0,
      previousTotal: 0,
      groups: [group({ id: "d-food", name: "Ăn uống" })],
      ungrouped: { spent: 0, previousSpent: 0, categories: [] },
      interest: { spent: 0, previousSpent: 0, expected: 300_000, lines: [{ debtId: "vay-tieu-dung", name: "Vay tiêu dùng", expected: 300_000, paid: 0, dueDay: 5 }] },
      excluded: { debtPrincipal: 0 },
    };
    expect(isEmptyLookBack(none)).toBe(true);
    expect(LOOK_BACK_EMPTY).toBe("Chưa có khoản chi nào trong kỳ này và kỳ trước.");
  });

  it("UC-707 AC-34: không chữ \"ví\", \"phong bì\", \"Ngân sách\", \"Phân tích\", không \"bù\" ngoài câu hạn mức mềm; che số áp mọi số, \"83%\" giữ", () => {
    const texts = [
      cycleHeading(D.cycle),
      cycleHeading(OCT.cycle),
      ...D.groups.flatMap((g) => [limitText(g), compareText(g.spent, g.previousSpent)]),
      excludedText(2_000_000),
      queueNote(1),
      LOOK_BACK_EMPTY,
    ].filter((t): t is string => t !== null);
    for (const t of texts) expect(t).not.toMatch(/\bví\b|phong bì|ngân sách|phân tích|\bbù\b|−/i);
    setAmountsHidden(true);
    expect(limitText(food)).toBe(vnd("còn •••• ₫"));
    expect(limitText(shopping)).toBe(vnd("vượt •••• ₫"));
    expect(compareText(food.spent, food.previousSpent)).toBe(vnd("kỳ trước •••• ₫ · ít hơn •••• ₫"));
    expect(excludedText(2_000_000)).toBe(vnd("Không tính: trả nợ gốc •••• ₫"));
    expect(barPct(food)).toBe(83);
  });

  it("UC-707 AC-35: ‹ về kỳ 10/10 (\"10/10 – 9/11\", địa chỉ có ngày); › về kỳ hiện tại (không ngày trên địa chỉ, không còn ›); kỳ 10/9 \"(theo ngày lương)\"", () => {
    expect(lookBackPath(null)).toBe("/v1/spend-by-category");
    expect(stepCycle(D, -1)).toEqual({ cycle: "2026-10-10" });
    expect(lookBackPath("2026-10-10")).toBe("/v1/spend-by-category?cycle=2026-10-10");
    expect(stepCycle(D, 1)).toBeNull();
    expect(cycleHeading(OCT.cycle)).toBe("10/10 – 9/11");
    expect(stepCycle(OCT, 1)).toEqual({ cycle: null });
    expect(stepCycle(OCT, -1)).toEqual({ cycle: "2026-09-10" });
    expect(stepCycle({ ...OCT, previous: null }, -1)).toBeNull();
    const sep = { payday: "2026-09-10", start: "2026-09-09T17:00:00.000Z", end: "2026-10-10T01:00:00.000Z", stored: false, days: 30, daysElapsed: 30 };
    expect(cycleHeading(sep)).toBe("10/9 – 9/10 (theo ngày lương)");
    expect(cycleHeading({ ...D.cycle, stored: false, start: "2026-11-09T17:00:00.000Z" })).toBe("Kỳ từ 10/11 · còn 15 ngày (theo ngày lương)");
  });

  it("UC-707 AC-35: chạm \"Ăn ngoài\" → Sổ giao dịch lọc danh mục và đúng kỳ (cycle=2026-11-10, không tháng), chip \"Kỳ từ 10/11\"; kỳ đã qua \"Kỳ 10/10 – 9/11\"", () => {
    const f = cycleFilter(D.cycle, "eating-out", now);
    expect(bookPath(f)).toBe("/v1/transactions?cycle=2026-11-10&category_id=eating-out&limit=51");
    expect(summaryPath(f)).toBe("/v1/transactions/summary?cycle=2026-11-10&category_id=eating-out");
    expect(filterChips(f, boot).map((c) => c.label)).toEqual(["Kỳ từ 10/11", "Ăn ngoài"]);
    expect(filterChips(cycleFilter(OCT.cycle, "eating-out", now), boot).map((c) => c.label)).toEqual(["Kỳ 10/10 – 9/11", "Ăn ngoài"]);
    expect(bookPath(cycleFilter(OCT.previous!, null, now))).toBe("/v1/transactions?cycle=2026-09-10&limit=51");
  });

  it("UC-108 AC-7: kỳ 10/10 (lương 30.000.000, đã trích 3.000.000) → 'Tích luỹ kỳ này: 3.000.000 ₫ (10% lương) · mức 10–30%'; kỳ 10/11 bỏ qua ① có lý do → 'Tích luỹ kỳ này: 0 ₫ · 0% — Tháng này trả viện phí'; kỳ danh nghĩa / không lương → không dòng; che số giữ %", () => {
    expect(savingsLine({ amount: 3_000_000, base: 30_000_000, level: "10to30", reason: null })).toBe(vnd("Tích luỹ kỳ này: 3.000.000 ₫ (10% lương) · mức 10–30%"));
    expect(savingsLine({ amount: 0, base: 30_000_000, level: "zero", reason: "Tháng này trả viện phí" })).toBe(vnd("Tích luỹ kỳ này: 0 ₫ · 0% — Tháng này trả viện phí"));
    expect(savingsLine({ amount: 200_000, base: 30_000_000, level: "below1", reason: null })).toBe(vnd("Tích luỹ kỳ này: 200.000 ₫ (0% lương) · mức dưới 1%"));
    expect(savingsLine({ amount: 9_500_000, base: 30_000_000, level: "from30", reason: null })).toBe(vnd("Tích luỹ kỳ này: 9.500.000 ₫ (31% lương) · mức từ 30%"));
    // Vừa có lương, ① còn mở chưa ghép: chưa có mức.
    expect(savingsLine({ amount: 0, base: 30_000_000, level: null, reason: null })).toBe(vnd("Tích luỹ kỳ này: 0 ₫ (0% lương)"));
    expect(savingsLine({ amount: 0, base: 0, level: null, reason: null })).toBeNull();
    expect(savingsLine(null)).toBeNull();
    expect(savingsLine(undefined)).toBeNull();
    setAmountsHidden(true);
    expect(savingsLine({ amount: 3_000_000, base: 30_000_000, level: "10to30", reason: null })).toBe(vnd("Tích luỹ kỳ này: •••• ₫ (10% lương) · mức 10–30%"));
  });
});
