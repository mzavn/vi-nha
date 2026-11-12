// Kỳ lương và việc ngày lương — hàm thuần (pocket UC-1205, UC-1206, UC-1207; ledger UC-103). Hộ mẫu C (Đợt C, mục tiêu là
// tài khoản thật từ Đợt E): payday_day 10, savings_pct 10, surplus 50, Học phí (2.000.000/tháng × 3, A = số dư tài khoản
// 4.000.000), Bảo dưỡng xe (B 4.800.000, A 1.000.000, hạn 2027-03-31), Thuế 10% thu chịu thuế, Ví Thưởng = tài khoản `bonus`.
import { describe, expect, it } from "vitest";
import {
  allocateTransfer,
  cycleDays,
  cycleDecision,
  cycleRanges,
  lateDays,
  nominalPayday,
  openingTasks,
  incomeTasks,
  pendingTasks,
  savingsDone,
  surplusTasks,
  taskState,
  type CycleRange,
  type GoalInput,
  type IncomeForTasks,
  type TaskDraft,
  type TaskFigures,
} from "../src/domain/pay-cycle";
import { nearSpendView } from "../src/domain/snapshot";

const goals: GoalInput[] = [
  { id: "hoc-phi", held: 4_000_000, target: 6_000_000, targetPct: null, monthly: 2_000_000, dueDate: "2027-01-15" },
  { id: "bao-duong-xe", held: 1_000_000, target: 4_800_000, targetPct: null, monthly: null, dueDate: "2027-03-31" },
  { id: "thue", held: 0, target: null, targetPct: 10, monthly: null, dueDate: null },
];
const salary: IncomeForTasks = { amount: 20_000_000, taxable: false, salary: true, interest: false, accountPocket: "operating", streamPocket: null };
const open = (income: IncomeForTasks, o: Partial<Parameters<typeof openingTasks>[1]> = {}) =>
  openingTasks(income, { savingsPct: 10, goals, cyclePayday: "2026-11-10", paydayDay: 10, prevOperating: 1_200_000, surplusPct: 50, rewardAccountId: "bonus", ...o });
const brief = (ts: TaskDraft[]) => ts.map((t) => [t.kind, t.goalId ?? t.toAccountId ?? t.toPocket, t.amount]);

describe("kỳ lương: ngày lương danh nghĩa và luật mở kỳ", () => {
  it("UC-1205 AC-2: lương sớm ≤ 7 ngày mở kỳ mới, sớm hơn nhập vào kỳ cũ; lương thứ hai nhập vào; trễ mở kỳ của ngày lương đã qua; kẹp cuối tháng; đổi payday_day không dời kỳ đã có", () => {
    const at = (day: string, current: string | null, pd = 10) => {
      const p = nominalPayday(day, pd);
      return [p, cycleDecision(current, p)];
    };
    expect(at("2026-11-10", "2026-10-10")).toEqual(["2026-11-10", "open"]);
    expect(at("2026-12-04", "2026-11-10")).toEqual(["2026-12-10", "open"]);
    expect(at("2026-12-02", "2026-11-10")).toEqual(["2026-11-10", "join"]);
    expect(at("2026-11-13", "2026-11-10")).toEqual(["2026-11-10", "join"]);
    expect(at("2026-12-12", "2026-11-10")).toEqual(["2026-12-10", "open"]);
    expect(at("2027-01-12", "2026-11-10")).toEqual(["2027-01-10", "open"]);
    expect(at("2027-02-27", null, 31)).toEqual(["2027-02-28", "open"]);
    expect(at("2026-11-25", "2026-11-10", 25)).toEqual(["2026-11-25", "open"]);
    expect(at("2026-10-05", "2026-11-10")).toEqual(["2026-10-10", "skip"]);
    // Trễ hơn 23 ngày (về trong 7 ngày trước ngày lương kế) → kỳ của ngày lương kế.
    expect(at("2026-12-04", "2026-10-10")).toEqual(["2026-12-10", "open"]);
    expect(lateDays("2026-11-10", "2026-12-12", 10)).toBe(2);
    expect(lateDays("2026-11-10", "2026-12-10", 10)).toBe(0);
    expect(lateDays("2026-11-10", "2026-11-30", 25)).toBe(5);
  });
});

describe("việc ngày lương", () => {
  it("UC-1206 AC-1: lương 20.000.000 → ① 2.000.000, Học phí 2.000.000 (A = số dư tài khoản 4.000.000), Bảo dưỡng xe 760.000 (n = 5), ④ 600.000 + 600.000 → tài khoản Ví Thưởng, không Thuế; số dư tài khoản Học phí 6.000.000 → không việc; 15% → 3.000.000; 12.345.678 → 1.235.000", () => {
    expect(brief(open(salary))).toEqual([
      ["savings", "savings", 2_000_000],
      ["goal", "hoc-phi", 2_000_000],
      ["goal", "bao-duong-xe", 760_000],
      ["surplus", "savings", 600_000],
      ["surplus", "bonus", 600_000],
    ]);
    expect(open(salary).find((t) => t.kind === "surplus" && t.toAccountId)).toMatchObject({ toPocket: null, goalId: null });
    const full = goals.map((g) => (g.id === "hoc-phi" ? { ...g, held: 6_000_000 } : g));
    expect(open(salary, { goals: full }).some((t) => t.goalId === "hoc-phi")).toBe(false);
    expect(open(salary, { savingsPct: 15 })[0]!.amount).toBe(3_000_000);
    expect(open({ ...salary, amount: 12_345_678 })[0]!.amount).toBe(1_235_000);
  });

  it("UC-103 AC-22: kỳ lương sớm 2026-12-10 → Bảo dưỡng xe 950.000 (n = 4)", () => {
    expect(open(salary, { cyclePayday: "2026-12-10" }).find((t) => t.goalId === "bao-duong-xe")!.amount).toBe(950_000);
  });

  it("UC-1206 AC-2: khoản thu nhập vào kỳ — lương thứ hai có ①; khoản chịu thuế có Thuế, không ①; nguồn đặt ngăn khác → ③ cả khoản; về / đặt ngăn Tích luỹ → không ①; lãi → không việc", () => {
    const tasks = (i: Partial<IncomeForTasks>) => incomeTasks({ ...salary, ...i }, 10, goals).map((t) => [t.kind, t.goalId ?? t.toPocket, t.amount]);
    expect(tasks({ amount: 5_000_000 })).toEqual([["savings", "savings", 500_000]]);
    expect(tasks({ amount: 3_000_000, salary: false, taxable: true })).toEqual([["goal", "thue", 300_000]]);
    expect(tasks({ amount: 4_000_000, salary: false, accountPocket: "savings" })).toEqual([]);
    expect(tasks({ amount: 4_000_000, salary: false, accountPocket: "savings", streamPocket: "reserve" })).toEqual([["move", "reserve", 4_000_000]]);
    expect(tasks({ accountPocket: "savings" })).toEqual([]);
    expect(tasks({ streamPocket: "savings" })).toEqual([["move", "savings", 20_000_000]]);
    expect(tasks({ streamPocket: "operating" })).toEqual([["savings", "savings", 2_000_000]]);
    expect(tasks({ amount: 37, salary: false, interest: true, taxable: true })).toEqual([]);
  });

  it("UC-1207 AC-1: dư 1.200.000 → 600.000 Tích luỹ / 600.000 tài khoản Ví Thưởng; 1.234.567 → 617.000 / 617.567; 100% → một việc; chưa chọn Ví Thưởng → chỉ Tích luỹ; dư ≤ 0 → không việc", () => {
    const s = (prev: number, pct = 50, reward: string | null = "bonus") => surplusTasks(prev, pct, reward).map((t) => [t.toAccountId ?? t.toPocket, t.amount]);
    expect(s(1_200_000)).toEqual([["savings", 600_000], ["bonus", 600_000]]);
    expect(s(1_234_567)).toEqual([["savings", 617_000], ["bonus", 617_567]]);
    expect(s(1_200_000, 100)).toEqual([["savings", 1_200_000]]);
    expect(s(1_200_000, 0)).toEqual([["bonus", 1_200_000]]);
    expect(s(1_200_000, 50, null)).toEqual([["savings", 600_000]]);
    expect(s(-300_000)).toEqual([]);
    expect(s(0)).toEqual([]);
  });

  // ① / ④-Tích luỹ đích là ngăn Tích luỹ; Học phí ↔ tài khoản tiết kiệm, Bảo dưỡng xe ↔ tài khoản bảo dưỡng xe, ④-Ví Thưởng ↔ tài khoản Ví Thưởng.
  const tasks = [
    { id: 1, toPocket: "savings" as const, toAccountId: null, missing: 2_000_000 },
    { id: 2, toPocket: null, toAccountId: "tiet-kiem", missing: 2_000_000 },
    { id: 3, toPocket: null, toAccountId: "xe", missing: 760_000 },
    { id: 4, toPocket: "savings" as const, toAccountId: null, missing: 600_000 },
    { id: 5, toPocket: null, toAccountId: "thuong", missing: 600_000 },
  ];
  const acc = (id: string, pocket: "savings" | "reserve" | "operating" | null) => ({ id, pocket });

  it("UC-1206 AC-3: ghép theo thứ tự việc, mỗi việc nhận phần còn thiếu; chuyển 3.000.000 tài khoản chính → tài khoản tiết kiệm chỉ khớp Học phí (đích là tài khoản tiết kiệm), Bảo dưỡng xe và Ví Thưởng ở tài khoản khác không khớp; chuyển dư ở lại; cùng ngăn không ghép ①; tiền từ ngoài ngăn vào tích luỹ tính", () => {
    const main = acc("chinh", "operating");
    expect(allocateTransfer(tasks, { from: main, to: acc("tich-luy", "savings"), available: 2_600_000 })).toEqual([
      { taskId: 1, amount: 2_000_000 },
      { taskId: 4, amount: 600_000 },
    ]);
    expect(allocateTransfer(tasks, { from: main, to: acc("tiet-kiem", "reserve"), available: 3_000_000 })).toEqual([{ taskId: 2, amount: 2_000_000 }]);
    expect(allocateTransfer(tasks, { from: main, to: acc("the", "operating"), available: 1_000_000 })).toEqual([]);
    expect(allocateTransfer(tasks, { from: acc("vi-dien-tu", null), to: acc("tich-luy", "savings"), available: 2_000_000 })).toEqual([{ taskId: 1, amount: 2_000_000 }]);
    expect(allocateTransfer(tasks, { from: main, to: acc("tich-luy", "savings"), available: 9_000_000 })).toEqual([
      { taskId: 1, amount: 2_000_000 },
      { taskId: 4, amount: 600_000 },
    ]);
  });

  it("UC-1206 AC-9: ② và ④-Ví Thưởng khớp theo đúng tài khoản đích, không xét ngăn — phao → tài khoản bảo dưỡng xe (cùng ngăn Dự phòng) khớp; tài khoản tiết kiệm → tài khoản Ví Thưởng khớp; tích luỹ → tích luỹ khác (cùng ngăn) không khớp ①; phao → tài khoản tiết kiệm không khớp Bảo dưỡng xe; S = D không ghép", () => {
    const phao = acc("phao", "reserve");
    expect(allocateTransfer(tasks, { from: phao, to: acc("xe", "reserve"), available: 760_000 })).toEqual([{ taskId: 3, amount: 760_000 }]);
    expect(allocateTransfer(tasks, { from: acc("tiet-kiem", "reserve"), to: acc("thuong", "reserve"), available: 600_000 })).toEqual([{ taskId: 5, amount: 600_000 }]);
    expect(allocateTransfer(tasks, { from: acc("tich-luy", "savings"), to: acc("tich-luy-2", "savings"), available: 500_000 })).toEqual([]);
    const onlyCar = tasks.filter((t) => t.id === 3);
    expect(allocateTransfer(onlyCar, { from: phao, to: acc("tiet-kiem", "reserve"), available: 760_000 })).toEqual([]);
    expect(allocateTransfer(tasks, { from: acc("xe", "reserve"), to: acc("xe", "reserve"), available: 760_000 })).toEqual([]);
    // ② mục tiêu đã bỏ gắn: không đích nào, không ghép.
    expect(allocateTransfer([{ id: 9, toPocket: null, toAccountId: null, missing: 1_000 }], { from: phao, to: acc("xe", "reserve"), available: 1_000 })).toEqual([]);
  });

  it("UC-1206 AC-5: trạng thái việc — tick tay, tự xong khi ghép đủ, ghép thiếu còn thiếu phần còn lại, bỏ qua", () => {
    expect(taskState({ status: "open", amount: 3_000_000 }, 2_000_000)).toEqual({ state: "open", auto: false, missing: 1_000_000 });
    expect(taskState({ status: "open", amount: 2_000_000 }, 2_000_000)).toEqual({ state: "done", auto: true, missing: 0 });
    expect(taskState({ status: "done", amount: 2_000_000 }, 0)).toEqual({ state: "done", auto: false, missing: 0 });
    expect(taskState({ status: "skipped", amount: 2_000_000 }, 0)).toEqual({ state: "skipped", auto: false, missing: 0 });
  });

  it("UC-1206 AC-3, ledger UC-103 AC-21: đã trích kỳ này và phần chưa làm (② không tính khi lương về ngăn Dự phòng / Tích luỹ, ③ không tính)", () => {
    const t = (kind: TaskFigures["kind"], amount: number, linked = 0, o: Partial<TaskFigures> = {}): TaskFigures => ({
      kind, status: "open", amount, linked, sourceAmount: kind === "savings" ? 20_000_000 : null, toPocket: null, ...o,
    });
    const fresh = [t("savings", 2_000_000), t("goal", 2_000_000), t("goal", 760_000), t("surplus", 600_000), t("surplus", 600_000), t("move", 4_000_000)];
    expect(pendingTasks(fresh, "operating")).toBe(5_960_000);
    expect(pendingTasks(fresh, "reserve")).toBe(3_200_000);
    expect(savingsDone(fresh)).toEqual({ amount: 0, base: 20_000_000, pct: 0, level: null });
    const after = [t("savings", 2_000_000, 2_000_000), t("goal", 2_000_000, 2_000_000), t("goal", 760_000, 760_000), t("surplus", 600_000, 600_000), t("surplus", 600_000, 240_000)];
    expect(pendingTasks(after, "operating")).toBe(360_000);
    expect(savingsDone(after)).toEqual({ amount: 2_000_000, base: 20_000_000, pct: 10, level: "10to30" });
    // ① tick tay (kể cả khi chưa có tài khoản Tích luỹ, UC-1206 AC-10): xong, không cộng vào đã trích, không còn trong chưa làm.
    const manual = [t("savings", 2_000_000, 0, { status: "done" })];
    expect(savingsDone(manual)).toEqual({ amount: 0, base: 20_000_000, pct: 0, level: "below1" });
    expect(pendingTasks(manual, "operating")).toBe(0);
    expect(savingsDone([t("savings", 2_000_000, 500_000, { status: "done" })]).amount).toBe(500_000);
    expect(savingsDone([])).toEqual({ amount: 0, base: 0, pct: null, level: null });
  });

  it("UC-702 AC-36: mức đạt của kỳ — base 30.000.000: đã trích 200.000 / 1.500.000 / 3.000.000 / 9.000.000 → below1 / 1to10 / 10to30 / from30; bỏ qua cả hai ① → zero; vừa có lương, ① còn mở chưa ghép → null", () => {
    const t = (amount: number, source: number, linked: number, o: Partial<TaskFigures> = {}): TaskFigures => ({
      kind: "savings", status: "open", amount, linked, sourceAmount: source, toPocket: "savings", ...o,
    });
    // Hai khoản lương 20.000.000 + 10.000.000; phần đã trích chia vào hai ① (số của việc đủ lớn để không chặn).
    const two = (a: number, b: number) => [t(9_000_000, 20_000_000, a), t(9_000_000, 10_000_000, b)];
    expect(savingsDone(two(200_000, 0)).level).toBe("below1");
    expect(savingsDone(two(1_000_000, 500_000)).level).toBe("1to10");
    expect(savingsDone(two(2_000_000, 1_000_000)).level).toBe("10to30");
    expect(savingsDone(two(6_000_000, 3_000_000))).toMatchObject({ amount: 9_000_000, base: 30_000_000, level: "from30" });
    const skipped = [t(2_000_000, 20_000_000, 0, { status: "skipped" }), t(1_000_000, 10_000_000, 0, { status: "skipped" })];
    expect(savingsDone(skipped).level).toBe("zero");
    expect(savingsDone([t(0, 20_000_000, 0), t(1_000_000, 10_000_000, 0, { status: "skipped" })]).level).toBe("zero");
    expect(savingsDone([t(2_000_000, 20_000_000, 0), t(1_000_000, 10_000_000, 0)]).level).toBeNull();
  });

  it("UC-1209 AC-20: phần chưa làm bỏ qua ② của mục tiêu trả từ tiền chi tiêu (chốt hai lớp)", () => {
    const t = (kind: TaskFigures["kind"], amount: number, o: Partial<TaskFigures> = {}): TaskFigures => ({ kind, status: "open", amount, linked: 0, sourceAmount: null, toPocket: null, ...o });
    expect(pendingTasks([t("goal", 2_000_000, { operatingGoal: true }), t("goal", 760_000)], "operating")).toBe(760_000);
  });

  it("UC-1206 AC-15: ② đích tài khoản mẹ — chuyển nội bộ mẹ → con không ghép; chuyển từ tài khoản chính sang con ghép; con → mẹ cũng là nội bộ", () => {
    const tasks = [{ id: 1, toPocket: null, toAccountId: "tk-tiet-kiem", missing: 2_000_000 }];
    const parent = { id: "tk-tiet-kiem", pocket: "reserve" as const, parentId: null };
    const child = { id: "gui-6-thang", pocket: "reserve" as const, parentId: "tk-tiet-kiem" };
    const main = { id: "tk-chinh", pocket: "operating" as const, parentId: null };
    expect(allocateTransfer(tasks, { from: parent, to: child, available: 5_000_000 })).toEqual([]);
    expect(allocateTransfer(tasks, { from: main, to: child, available: 2_000_000 })).toEqual([{ taskId: 1, amount: 2_000_000 }]);
    expect(allocateTransfer(tasks, { from: child, to: parent, available: 2_000_000 })).toEqual([]);
    expect(allocateTransfer(tasks, { from: main, to: parent, available: 2_000_000 })).toEqual([{ taskId: 1, amount: 2_000_000 }]);
  });
});

describe("số mỗi ngày", () => {
  it("UC-103 AC-24: trừ phần còn phải trả — Vận hành 15.000.000, 20 ngày, R 3.500.000 → 575.000 (không phải 750.000); trả đủ: 11.500.000, R 0 → vẫn 575.000; 3.000.000 với R 3.500.000 → null", () => {
    const cycle = { cyclePayday: "2026-11-10", pendingTasks: 0 };
    expect(nearSpendView(15_000_000, "2026-11-20", 10, { ...cycle, goalRemaining: 3_500_000 })).toMatchObject({ daysLeft: 20, perDay: 575_000, goalRemaining: 3_500_000 });
    expect(nearSpendView(15_000_000, "2026-11-20", 10, cycle)).toMatchObject({ perDay: 750_000, goalRemaining: 0 });
    expect(nearSpendView(11_500_000, "2026-11-20", 10, { ...cycle, goalRemaining: 0 }).perDay).toBe(575_000);
    expect(nearSpendView(3_000_000, "2026-11-20", 10, { ...cycle, goalRemaining: 3_500_000 }).perDay).toBeNull();
  });

  it("UC-103 AC-21: 21.200.000 trừ 5.960.000 chưa làm, 30 ngày → 508.000/ngày; sau hai chuyển khoản 15.600.000 trừ 360.000 → 508.000", () => {
    const cycle = { cyclePayday: "2026-11-10", pendingTasks: 5_960_000 };
    expect(nearSpendView(21_200_000, "2026-11-10", 10, cycle)).toMatchObject({ payday: "2026-12-10", daysLeft: 30, perDay: 508_000, pendingTasks: 5_960_000 });
    expect(nearSpendView(15_600_000, "2026-11-10", 10, { ...cycle, pendingTasks: 360_000 }).perDay).toBe(508_000);
    expect(nearSpendView(21_200_000, "2026-11-10", 10)).toMatchObject({ daysLeft: 30, perDay: 706_000, pendingTasks: 0 });
    expect(nearSpendView(1_000_000, "2026-11-10", 10, { ...cycle, pendingTasks: 2_000_000 }).perDay).toBeNull();
  });

  it("UC-103 AC-22: lương về sớm 2026-12-04 (kỳ 2026-12-10) → đếm tới 2027-01-10, 37 ngày, 406.000/ngày; ngày 2026-12-10 → 31 ngày", () => {
    const cycle = { cyclePayday: "2026-12-10", pendingTasks: 6_150_000 };
    expect(nearSpendView(21_200_000, "2026-12-04", 10, cycle)).toMatchObject({ payday: "2027-01-10", daysLeft: 37, perDay: 406_000 });
    expect(nearSpendView(21_200_000, "2026-12-10", 10, cycle)).toMatchObject({ payday: "2027-01-10", daysLeft: 31 });
  });
});

// Mốc kỳ dùng chung cho Nhìn lại, tháng vận hành, Tích luỹ theo kỳ (ledger UC-108 bước 1, ADR-127).
describe("mốc kỳ lương: kỳ lưu và kỳ danh nghĩa trước kỳ lưu đầu", () => {
  const vn = (s: string) => new Date(`${s}+07:00`).toISOString();
  const D: { payday: string; startedAt: string }[] = [
    { payday: "2026-10-10", startedAt: vn("2026-10-10T08:00") },
    { payday: "2026-11-10", startedAt: vn("2026-11-10T08:00") },
  ];
  const now = new Date(vn("2026-11-25T10:00"));
  const brief = (rs: CycleRange[]) => rs.map((r) => [r.payday, r.start, r.end, r.stored]);

  it("UC-108 AC-4: kỳ hiện tại là kỳ lưu 2026-11-10 (30 ngày, hôm nay ngày 16), kỳ trước là kỳ lưu 2026-10-10", () => {
    const rs = cycleRanges(D, 10, now, vn("2026-10-01T00:00"));
    expect(brief(rs)).toEqual([
      ["2026-09-10", vn("2026-09-10T00:00"), vn("2026-10-10T08:00"), false],
      ["2026-10-10", vn("2026-10-10T08:00"), vn("2026-11-10T08:00"), true],
      ["2026-11-10", vn("2026-11-10T08:00"), null, true],
    ]);
    expect(cycleDays(rs[2]!, 10, "2026-11-25")).toEqual({ days: 30, daysElapsed: 16 });
    expect(cycleDays(rs[1]!, 10, "2026-11-25")).toEqual({ days: 31, daysElapsed: 31 });
    expect(cycleDays(rs[0]!, 10, "2026-11-25")).toEqual({ days: 30, daysElapsed: 30 });
  });

  it("UC-108 AC-5: chỉ trả kỳ có end sau `since`; kỳ danh nghĩa kẹp cuối tháng như nextPayday", () => {
    expect(brief(cycleRanges(D, 10, now, vn("2026-10-10T08:00"))).map((r) => r[0])).toEqual(["2026-10-10", "2026-11-10"]);
    const rs = cycleRanges([], 31, new Date(vn("2026-03-05T10:00")), vn("2026-02-01T00:00"));
    expect(rs.map((r) => [r.payday, r.end])).toEqual([
      ["2026-01-31", vn("2026-02-28T00:00")],
      ["2026-02-28", null],
    ]);
  });

  it("UC-108 AC-5: chưa có kỳ lưu → kỳ hiện tại là kỳ danh nghĩa 2026-11-10 từ 00:00 VN; kỳ void không tính", () => {
    const rs = cycleRanges([], 10, now, vn("2026-11-01T00:00"));
    expect(brief(rs)).toEqual([
      ["2026-10-10", vn("2026-10-10T00:00"), vn("2026-11-10T00:00"), false],
      ["2026-11-10", vn("2026-11-10T00:00"), null, false],
    ]);
    // Huỷ khoản lương mở kỳ 2026-11-10 (người gọi chỉ đưa kỳ active): kỳ 2026-10-10 kéo tới bây giờ, không có kỳ danh nghĩa sau.
    expect(brief(cycleRanges(D.slice(0, 1), 10, now, vn("2026-10-01T00:00"))).slice(-1)).toEqual([["2026-10-10", vn("2026-10-10T08:00"), null, true]]);
  });

  it("UC-108 AC-5: lương đầu tiên về trễ — kỳ danh nghĩa 2026-10-10 kéo tới lúc mở kỳ lưu 2026-11-10, không có hai kỳ cùng ngày lương", () => {
    const late = [{ payday: "2026-11-10", startedAt: vn("2026-12-02T08:00") }];
    const rs = cycleRanges(late, 10, new Date(vn("2026-12-05T10:00")), vn("2026-10-01T00:00"));
    expect(brief(rs)).toEqual([
      ["2026-09-10", vn("2026-09-10T00:00"), vn("2026-10-10T00:00"), false],
      ["2026-10-10", vn("2026-10-10T00:00"), vn("2026-12-02T08:00"), false],
      ["2026-11-10", vn("2026-12-02T08:00"), null, true],
    ]);
    expect(cycleDays(rs[1]!, 10, "2026-12-05")).toEqual({ days: 53, daysElapsed: 53 });
    expect(cycleDays(rs[2]!, 10, "2026-12-05")).toEqual({ days: 8, daysElapsed: 4 });
    expect(cycleDays(rs[2]!, 10, "2026-12-12")).toEqual({ days: 8, daysElapsed: 8, lateDays: 2 });
  });

  it("UC-108 AC-5: lương sớm — kỳ 2026-12-10 mở 2026-12-04 08:00, ngày 05/12 → 37 ngày, ngày thứ 2", () => {
    const early = [...D, { payday: "2026-12-10", startedAt: vn("2026-12-04T08:00") }];
    const rs = cycleRanges(early, 10, new Date(vn("2026-12-05T10:00")), vn("2026-11-01T00:00"));
    expect(rs.map((r) => r.payday)).toEqual(["2026-10-10", "2026-11-10", "2026-12-10"]);
    expect(cycleDays(rs[1]!, 10, "2026-12-05")).toEqual({ days: 24, daysElapsed: 24 });
    expect(cycleDays(rs[2]!, 10, "2026-12-05")).toEqual({ days: 37, daysElapsed: 2 });
  });
});
