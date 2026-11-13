// Nhìn lại theo tháng — hàm thuần (pocket UC-1204, ledger UC-108, notify UC-402 dòng Chi tiêu tháng này, notify UC-406 số mỗi ngày).
// Số của hộ mẫu D (proposal 261112-ba-ngan-nhin-lai).
import { describe, expect, it } from "vitest";
import { groupSpend, limitFigures, limitNudges, weeklyRhythm, type CategoryGroupRef } from "../src/domain/look-back";

const groups: CategoryGroupRef[] = [
  { id: "d-food", name: "Ăn uống", essential: true, limit: 3_000_000 },
  { id: "d-transport", name: "Đi lại", essential: true, limit: 800_000 },
  { id: "d-school", name: "Học phí", essential: true, limit: null },
  { id: "d-shopping", name: "Mua sắm", essential: false, limit: 1_000_000 },
];
const row = (categoryId: string, groupId: string | null, spent: number, previousSpent = 0) => ({ categoryId, name: categoryId, groupId, spent, previousSpent });
const rowsD = [
  row("groceries", "d-food", 1_800_000, 2_800_000),
  row("eating-out", "d-food", 700_000),
  row("fuel-parking", "d-transport", 300_000, 700_000),
  row("ride-hailing", "d-transport", 150_000),
  row("school-fees", "d-school", 6_000_000),
  row("shopping", "d-shopping", 1_200_000, 600_000),
  row("gifts", null, 500_000),
];
const fig = (g: { limit: number | null; spent: number; pct: number | null; left: number | null; over: number | null }) => ({ limit: g.limit, spent: g.spent, pct: g.pct, left: g.left, over: g.over });

describe("hạn mức mềm theo nhóm danh mục: không âm, không bù", () => {
  it("UC-1204 AC-3: Ăn uống 83% còn 500.000, Đi lại 56%, Mua sắm 120% vượt 200.000, Học phí không hạn mức", () => {
    const { groups: g, ungrouped } = groupSpend(rowsD, groups);
    expect(g.map((x) => x.name)).toEqual(["Ăn uống", "Đi lại", "Học phí", "Mua sắm"]);
    expect(fig(g[0]!)).toEqual({ limit: 3_000_000, spent: 2_500_000, pct: 83, left: 500_000, over: 0 });
    expect(fig(g[1]!)).toEqual({ limit: 800_000, spent: 450_000, pct: 56, left: 350_000, over: 0 });
    expect(fig(g[3]!)).toEqual({ limit: 1_000_000, spent: 1_200_000, pct: 120, left: 0, over: 200_000 });
    expect(fig(g[2]!)).toEqual({ limit: null, spent: 6_000_000, pct: null, left: null, over: null });
    expect(g[0]!.categories.map((c) => [c.categoryId, c.spent, c.previousSpent])).toEqual([
      ["groceries", 1_800_000, 2_800_000],
      ["eating-out", 700_000, 0],
    ]);
    expect(g[0]!.previousSpent).toBe(2_800_000);
    expect(ungrouped).toMatchObject({ spent: 500_000, previousSpent: 0 });
    expect(ungrouped.categories.map((c) => c.categoryId)).toEqual(["gifts"]);
    for (const x of g) for (const v of [x.pct, x.left, x.over]) expect(v === null || v >= 0).toBe(true);
    // Sửa hạn mức "Mua sắm" thành 1.500.000: tháng này 80%, tháng 10 (600.000) 40%.
    expect(limitFigures(1_500_000, 1_200_000)).toEqual({ pct: 80, left: 300_000, over: 0 });
    expect(limitFigures(1_500_000, 600_000).pct).toBe(40);
  });

  it("UC-1204 AC-4: theo cấu hình hiện tại — Quà tặng vào Mua sắm (170%), Đi lại âm vẫn 0% còn đủ 800.000", () => {
    const moved = rowsD.map((r) => (r.categoryId === "gifts" ? { ...r, groupId: "d-shopping" } : r.categoryId === "fuel-parking" ? { ...r, spent: -1_700_000 } : r));
    const { groups: g, ungrouped } = groupSpend(moved, groups);
    expect(fig(g[3]!)).toEqual({ limit: 1_000_000, spent: 1_700_000, pct: 170, left: 0, over: 700_000 });
    expect(ungrouped.categories).toEqual([]);
    expect(fig(g[1]!)).toEqual({ limit: 800_000, spent: -1_550_000, pct: 0, left: 800_000, over: 0 });
  });

});

describe("dòng Chi tiêu tháng này của tin sáng", () => {
  const { groups: g } = groupSpend(rowsD, groups);

  it("UC-402 AC-6: ngày 16 / 30 → Mua sắm vượt 200.000 trước, rồi Ăn uống 83%; ngày 28 / 30 → chỉ nhóm vượt", () => {
    expect(limitNudges(g, { days: 30, daysElapsed: 16 })).toEqual([
      { name: "Mua sắm", pct: 120, over: 200_000 },
      { name: "Ăn uống", pct: 83, over: 0 },
    ]);
    expect(limitNudges(g, { days: 30, daysElapsed: 28 })).toEqual([{ name: "Mua sắm", pct: 120, over: 200_000 }]);
  });

  it("UC-402 AC-38: không hạn mức, mọi nhóm < 80%, hoặc 85% vào ngày 28 / 30 → không có nhóm nào", () => {
    expect(limitNudges(groupSpend(rowsD, groups.map((x) => ({ ...x, limit: null }))).groups, { days: 30, daysElapsed: 16 })).toEqual([]);
    expect(limitNudges(groupSpend([row("groceries", "d-food", 2_000_000)], groups).groups, { days: 30, daysElapsed: 16 })).toEqual([]);
    expect(limitNudges(groupSpend([row("groceries", "d-food", 2_550_000)], groups).groups, { days: 30, daysElapsed: 28 })).toEqual([]);
  });

  it("UC-402 AC-6: nhiều nhóm vượt — vượt nhiều trước, cùng % thì theo thứ tự nhóm", () => {
    const list = [
      { name: "A", pct: 90, over: 0 },
      { name: "B", pct: 150, over: 100 },
      { name: "C", pct: 90, over: 0 },
      { name: "D", pct: 110, over: 500 },
    ];
    expect(limitNudges(list, { days: 30, daysElapsed: 1 }).map((x) => x.name)).toEqual(["D", "B", "A", "C"]);
  });
});

describe("số mỗi ngày của tin tuần", () => {
  it("UC-406 AC-1, AC-11: 800.000 → 114.000/ngày, 1.600.000 → 228.000/ngày", () => {
    expect(weeklyRhythm(800_000)).toBe(114_000);
    expect(weeklyRhythm(1_600_000)).toBe(228_000);
    expect(weeklyRhythm(0)).toBe(0);
  });
});
