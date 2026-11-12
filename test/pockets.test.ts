// Ba ngăn (pocket UC-1203, UC-1209, ADR-119, ADR-132): tổng ngăn = Σ sổ tài khoản theo ngăn, mục tiêu Dự phòng = tài khoản
// thật (A = số dư), phần an tâm, Ví Thưởng, nợ ngắn hạn, Tích luỹ theo kỳ, tháng vận hành — hàm thuần.
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { blessingFor, fillGoals, goalOrder, groupInterest, peaceMonthsView, pocketsView, type PocketAccount, type PocketDebt, type PocketGoalInput, type PocketsInput, type PocketsView } from "../src/domain/pockets";
import { cycleRanges } from "../src/domain/pay-cycle";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";

const acct = (id: string, pocket: PocketAccount["pocket"], balance: number, confirmed = true): PocketAccount => ({ id, name: id, pocket, balance, confirmed });
const goal = (id: string, accountId: string | null, o: Partial<PocketGoalInput> = {}): PocketGoalInput => ({
  id, name: id, accountId, target: null, targetPct: null, monthly: null, repeatMonths: null, dueDate: null, debtId: null, sort: 100, spent: 0, ...o,
});
const total = (v: PocketsView) => v.savings.total + v.reserve.total + v.operating.total + v.outside.total;
/** Hôm nay 11/11/2026, ngày lương 10: không có lịch sử, chưa có chi vận hành, đích 6 tháng, chưa chọn Ví Thưởng — trừ khi ca nói khác. */
const view = (input: Pick<PocketsInput, "accounts" | "goals" | "debts" | "savingsPct"> & Partial<PocketsInput>) =>
  pocketsView({
    rewardAccountId: null,
    history: { since: "2026-11-10", prevSince: "2026-10-10", accounts: [] },
    operatingSpend: { cycles: [], dataStart: null },
    peaceTarget: 6,
    ...input,
  });
/** Ba kỳ lương trọn trước kỳ 10/11 (cũ trước): 31 + 30 + 31 = 92 ngày. */
const cycles = (a: number, b: number, c: number) => [
  { start: "2026-08-10", amount: a, days: 31 },
  { start: "2026-09-10", amount: b, days: 30 },
  { start: "2026-10-10", amount: c, days: 31 },
];

describe("pocketsView", () => {
  it("UC-1203 AC-1: nhiều tài khoản — tổng ngăn = Σ sổ tài khoản của ngăn, không chuyển số giữa ngăn; mục tiêu A = số dư tài khoản gắn; tổng = Σ sổ", () => {
    const accounts = [
      acct("main", "operating", 3_000_000),
      acct("card", "operating", -800_000),
      acct("saving", "reserve", 10_000_000),
      acct("piggy", "savings", 500_000),
      acct("wealth", "savings", 6_000_000),
      acct("momo", null, 200_000),
    ];
    const goals = [goal("tuition", "saving", { target: 6_000_000, monthly: 2_000_000, repeatMonths: 3, dueDate: "2027-01-15" }), goal("car", null, { target: 4_800_000, dueDate: "2027-03-31" })];
    const v = view({ accounts, goals, debts: [], savingsPct: 20 });
    expect([v.savings.total, v.reserve.total, v.operating.total, v.outside.total]).toEqual([6_500_000, 10_000_000, 2_200_000, 200_000]);
    expect(total(v)).toBe(18_900_000);
    expect(v.reserve.accounts).toEqual([{ id: "saving", name: "saving", balance: 10_000_000, goalIds: ["tuition"], parentId: null }]);
    expect(v.operating.accounts.find((a) => a.id === "card")).toEqual({ id: "card", name: "card", balance: -800_000, goalIds: [], parentId: null });
    expect(v.reserve.goals).toEqual([
      { id: "tuition", name: "tuition", accountId: "saving", held: 10_000_000, need: 6_000_000, spent: 0, short: 0, target: 6_000_000, targetPct: null, monthly: 2_000_000, repeatMonths: 3, dueDate: "2027-01-15", debtId: null },
      { id: "car", name: "car", accountId: null, held: null, need: null, spent: 0, short: null, target: 4_800_000, targetPct: null, monthly: null, repeatMonths: null, dueDate: "2027-03-31", debtId: null },
    ]);
    expect([v.reserve.peace, v.reserve.reward]).toEqual([0, null]);
    expect(v).not.toHaveProperty("savings.holds");
    expect(v.savingsPct).toBe(20);
    expect(v.unconfirmed).toBe(0);
  });

  it("UC-1203 AC-4: nợ ngắn hạn chỉ để nhắc — đủ số còn nợ, kèm số dư tài khoản của mục tiêu Trả nợ (chưa gắn → 0); không trừ vào ngăn nào", () => {
    const debts: PocketDebt[] = [
      { id: "mortgage", name: "Vay mua nhà", term: "long", active: true, balance: 50_000_000, monthlyPayment: 5_000_000, dueDay: 5 },
      { id: "installment", name: "Mua trả góp", term: "short", active: true, balance: 3_000_000, monthlyPayment: null, dueDay: null },
      { id: "family", name: "Vay người thân", term: "short", active: true, balance: 5_000_000, monthlyPayment: 1_000_000, dueDay: 15 },
      { id: "paid", name: "Đã trả xong", term: "short", active: true, balance: 0, monthlyPayment: null, dueDay: 1 },
      { id: "off", name: "Đã tắt", term: "short", active: false, balance: 2_000_000, monthlyPayment: null, dueDay: 2 },
    ];
    const accounts = [acct("main", "operating", 4_000_000), acct("repay-acc", "reserve", 1_000_000)];
    const goals = [
      goal("repay", "repay-acc", { target: 1_000_000, monthly: 1_000_000, repeatMonths: 1, debtId: "family" }),
      goal("installment-goal", null, { target: 3_000_000, debtId: "installment" }),
    ];
    const v = view({ accounts, goals, debts, savingsPct: 10 });
    expect(v.shortDebt).toEqual({
      total: 8_000_000,
      count: 2,
      items: [
        { id: "family", name: "Vay người thân", balance: 5_000_000, monthlyPayment: 1_000_000, dueDay: 15, goalId: "repay", heldFor: 1_000_000 },
        { id: "installment", name: "Mua trả góp", balance: 3_000_000, monthlyPayment: null, dueDay: null, goalId: "installment-goal", heldFor: 0 },
      ],
    });
    expect(v.operating.total).toBe(view({ accounts, goals, debts: [], savingsPct: 10 }).operating.total);
    expect(view({ accounts, goals: [], debts: [], savingsPct: 10 }).shortDebt).toEqual({ total: 0, count: 0, items: [] });
  });

  it("UC-1203 AC-5: Tích luỹ theo kỳ — bây giờ 6.500.000, đầu kỳ 5.700.000, đầu kỳ trước 5.000.000 → +800.000 / +700.000; tài khoản tắt sau mốc vẫn tính ở mốc", () => {
    const accounts = [acct("main", "operating", 3_000_000), acct("saving", "reserve", 40_000_000), acct("wealth", "savings", 6_000_000), acct("piggy", "savings", 500_000)];
    const history: PocketsInput["history"] = {
      since: "2026-11-10",
      prevSince: "2026-10-10",
      accounts: [
        { id: "main", pocket: "operating", since: 3_800_000, prevSince: 4_500_000 },
        { id: "saving", pocket: "reserve", since: 40_000_000, prevSince: 40_000_000 },
        { id: "wealth", pocket: "savings", since: 5_200_000, prevSince: 4_500_000 },
        { id: "piggy", pocket: "savings", since: 500_000, prevSince: 500_000 },
      ],
    };
    const v = view({ accounts, goals: [], debts: [], savingsPct: 10, history });
    expect(v.savings.total).toBe(6_500_000);
    expect(v.savings.change).toEqual({ since: "2026-11-10", amount: 800_000, prevSince: "2026-10-10", prevAmount: 700_000 });

    // Tài khoản Tích luỹ thứ hai có 1.000.000 ở cả hai mốc, hôm nay chuyển hết rồi tắt (không còn trong `accounts`).
    const closed = view({ accounts, goals: [], debts: [], savingsPct: 10, history: { ...history, accounts: [...history.accounts, { id: "old", pocket: "savings", since: 1_000_000, prevSince: 1_000_000 }] } });
    expect(closed.savings.change).toMatchObject({ amount: -200_000, prevAmount: 700_000 });
    // Tắt trước đầu kỳ này (sau đầu kỳ trước): chỉ tính ở đầu kỳ trước.
    const closedEarlier = view({ accounts, goals: [], debts: [], savingsPct: 10, history: { ...history, accounts: [...history.accounts, { id: "old", pocket: "savings", since: null, prevSince: 1_000_000 }] } });
    expect(closedEarlier.savings.change).toMatchObject({ amount: 800_000, prevAmount: -300_000 });
  });

  it("UC-1203 AC-6: phần an tâm = tài khoản Dự phòng không gắn mục tiêu (31.500.000); tháng vận hành chuẩn hoá theo ngày — Σ chi × 30 ÷ Σ ngày của kỳ trọn đủ dữ liệu có chi > 0; 0 / 1 / 2 / 3 kỳ; phần an tâm âm → 0", () => {
    const at = (spend: PocketsInput["operatingSpend"], peaceBalance = 31_500_000) =>
      view({
        accounts: [acct("buffer", "reserve", peaceBalance), acct("tuition-acc", "reserve", 6_500_000)],
        goals: [goal("tuition", "tuition-acc", { target: 9_000_000 })],
        debts: [],
        savingsPct: 10,
        operatingSpend: spend,
      }).reserve;
    expect(at({ cycles: cycles(9_000_000, 10_500_000, 10_500_000), dataStart: "2026-07-01" })).toMatchObject({
      total: 38_000_000,
      peace: 31_500_000,
      peaceMonths: { covered: 3.2, target: 6, monthly: 9_782_608, cycles: 3 },
    });
    // Ngày bắt đầu dữ liệu 15/8 → kỳ 10/8–9/9 bị bỏ dù có chi: 21.000.000 × 30 ÷ 61.
    expect(at({ cycles: cycles(9_000_000, 10_500_000, 10_500_000), dataStart: "2026-08-15" }).peaceMonths).toEqual({ covered: 3, target: 6, monthly: 10_327_868, cycles: 2 });
    expect(at({ cycles: cycles(0, 0, 6_000_000), dataStart: "2026-07-01" }).peaceMonths).toEqual({ covered: 5.4, target: 6, monthly: 5_806_451, cycles: 1 });
    expect(at({ cycles: cycles(9_000_000, 10_500_000, 10_500_000), dataStart: "2026-10-20" }).peaceMonths).toEqual({ covered: null, target: 6, monthly: null, cycles: 0 });
    expect(at({ cycles: [], dataStart: null }).peaceMonths).toEqual({ covered: null, target: 6, monthly: null, cycles: 0 });
    const short = at({ cycles: cycles(9_000_000, 10_500_000, 10_500_000), dataStart: "2026-07-01" }, -1_000_000);
    expect([short.peace, short.peaceMonths.covered]).toEqual([-1_000_000, 0]);
  });

  it("UC-1203 AC-6: peaceMonthsView — số nguyên phần mười: 23.000.000 / 10.000.000, đích 5 → 2,3 và thanh 46 (không phải 45); 31.300.000 → 3,1 / 51; monthly null → null", () => {
    expect(peaceMonthsView(23_000_000, 10_000_000, 5)).toEqual({ covered: 2.3, pct: 46 });
    expect(peaceMonthsView(31_500_000, 10_000_000, 6)).toEqual({ covered: 3.1, pct: 51 });
    expect(peaceMonthsView(31_500_000 - 200_000, 10_000_000, 6)).toEqual({ covered: 3.1, pct: 51 });
    expect(peaceMonthsView(31_500_000, 10_500_000, 6)).toEqual({ covered: 3, pct: 50 });
    expect(peaceMonthsView(90_000_000, 10_000_000, 6)).toEqual({ covered: 9, pct: 100 });
    expect(peaceMonthsView(0, 10_000_000, 6)).toEqual({ covered: 0, pct: 0 });
    expect(peaceMonthsView(-1_000_000, 10_000_000, 6)).toEqual({ covered: 0, pct: 0 });
    expect(peaceMonthsView(31_500_000, null, 6)).toEqual({ covered: null, pct: null });
  });

  it("UC-1203 AC-7: mục tiêu theo thứ tự ưu tiên (sort, rồi hạn — chưa có hạn xuống cuối, rồi tên); mỗi mục tiêu có accountId, held = số dư khi một mục tiêu một tài khoản; đổi sort của Thuế về 5 → Thuế đứng đầu", () => {
    const goals = [
      goal("tuition", "a-tuition", { name: "Học phí", dueDate: "2027-01-15" }),
      goal("car", "a-car", { name: "Bảo dưỡng xe", dueDate: "2027-03-31" }),
      goal("tax", null, { name: "Thuế", targetPct: 10 }),
      goal("repay", "a-repay", { name: "Trả nợ Vay người thân", dueDate: "2026-11-15" }),
      goal("bike", "a-bike", { name: "Áo mưa", dueDate: "2027-03-31" }),
    ];
    const input = { accounts: [acct("a-tuition", "reserve", 4_000_000), acct("a-car", "reserve", 1_000_000), acct("a-repay", "reserve", 1_000_000), acct("a-bike", "reserve", 0)], debts: [], savingsPct: 10 };
    const v = view({ ...input, goals });
    expect(v.reserve.goals.map((g) => [g.name, g.accountId, g.held])).toEqual([
      ["Trả nợ Vay người thân", "a-repay", 1_000_000],
      ["Học phí", "a-tuition", 4_000_000],
      ["Áo mưa", "a-bike", 0],
      ["Bảo dưỡng xe", "a-car", 1_000_000],
      ["Thuế", null, null],
    ]);
    const taxFirst = view({ ...input, goals: goals.map((g) => (g.id === "tax" ? { ...g, sort: 5 } : g)) });
    expect(taxFirst.reserve.goals.map((g) => g.id)).toEqual(["tax", "repay", "tuition", "bike", "car"]);
  });

  // Dữ liệu giả của pocket UC-1203 AC-11 / UC-1209 AC-8.
  const sharedAccounts = (saving = 12_000_000) => [
    acct("tk-chung", "reserve", 9_000_000),
    acct("tk-tiet-kiem", "reserve", saving),
    acct("tk-thue", "reserve", 1_500_000),
    acct("phao", "reserve", 5_000_000),
  ];
  const sharedGoals = (spent: Record<string, number> = {}) =>
    [
      goal("hoa-don", "tk-chung", { name: "Hoá đơn", target: 2_000_000, monthly: 2_000_000, repeatMonths: 1, dueDate: "2026-11-20", sort: 10 }),
      goal("nha-o", "tk-tiet-kiem", { name: "Nhà ở", target: 7_500_000, monthly: 7_500_000, repeatMonths: 1, dueDate: "2026-12-05", sort: 20 }),
      goal("hoc-tap", "tk-tiet-kiem", { name: "Học tập", target: 6_000_000, dueDate: "2027-01-15", sort: 30 }),
      goal("bao-duong-xe", "tk-chung", { name: "Bảo dưỡng xe", target: 4_800_000, dueDate: "2027-03-31", sort: 40 }),
      goal("hieu-hi", "tk-chung", { name: "Hiếu hỉ", target: 3_000_000, sort: 50 }),
      goal("thue", "tk-thue", { name: "Thuế", targetPct: 10, sort: 60 }),
    ].map((g) => ({ ...g, spent: spent[g.id] ?? 0 }));
  const savingGroup = (v: PocketsView) => v.reserve.groups.find((g) => g.accountId === "tk-tiet-kiem")!;
  const heldOf = (v: PocketsView) => Object.fromEntries(v.reserve.goals.map((g) => [g.id, g.held]));
  const sumHeld = (v: PocketsView, accountId: string) => v.reserve.goals.filter((g) => g.accountId === accountId).reduce((s, g) => s + g.held!, 0);

  it("UC-1203 AC-11: nhóm tài khoản chung — held chia theo thứ tự ưu tiên, groups theo mục tiêu đầu tiên của nhóm, Σ held mỗi nhóm = balance, phần an tâm chỉ phao", () => {
    const v = view({ accounts: sharedAccounts(), goals: sharedGoals(), debts: [], savingsPct: 10 });
    expect(v.reserve.total).toBe(27_500_000);
    expect(heldOf(v)).toEqual({ "hoa-don": 2_000_000, "nha-o": 7_500_000, "hoc-tap": 4_500_000, "bao-duong-xe": 4_800_000, "hieu-hi": 2_200_000, thue: 1_500_000 });
    expect(v.reserve.groups).toEqual([
      { accountId: "tk-chung", name: "tk-chung", balance: 9_000_000, need: 9_800_000, spent: 0, short: 800_000, extra: 0, goalIds: ["hoa-don", "bao-duong-xe", "hieu-hi"], childIds: [], interest: 0 },
      { accountId: "tk-tiet-kiem", name: "tk-tiet-kiem", balance: 12_000_000, need: 13_500_000, spent: 0, short: 1_500_000, extra: 0, goalIds: ["nha-o", "hoc-tap"], childIds: [], interest: 0 },
      { accountId: "tk-thue", name: "tk-thue", balance: 1_500_000, need: null, spent: 0, short: null, extra: null, goalIds: ["thue"], childIds: [], interest: 0 },
    ]);
    for (const g of v.reserve.groups) expect(sumHeld(v, g.accountId)).toBe(g.balance);
    expect(v.reserve.peace).toBe(5_000_000);
    expect(v.reserve.accounts.find((a) => a.id === "tk-chung")!.goalIds).toEqual(["hoa-don", "bao-duong-xe", "hieu-hi"]);
    expect(v.reserve.goals.find((g) => g.id === "hieu-hi")).toMatchObject({ need: 3_000_000, spent: 0, short: 800_000 });
    expect(v.reserve.goals.find((g) => g.id === "thue")).toMatchObject({ need: null, short: null });
  });

  it("UC-1203 AC-12: vượt và âm — mục tiêu cuối nhận phần còn lại (15.000.000 → 7.500.000 / 7.500.000, extra 1.500.000; −1.000.000 → 0 / −1.000.000; 0 → 0 / 0)", () => {
    const at = (saving: number) => view({ accounts: sharedAccounts(saving), goals: sharedGoals(), debts: [], savingsPct: 10 });
    const over = at(15_000_000);
    expect([heldOf(over)["nha-o"], heldOf(over)["hoc-tap"]]).toEqual([7_500_000, 7_500_000]);
    expect(over.reserve.goals.find((g) => g.id === "hoc-tap")!.short).toBe(0);
    expect(savingGroup(over)).toMatchObject({ short: 0, extra: 1_500_000 });
    const neg = at(-1_000_000);
    expect([heldOf(neg)["nha-o"], heldOf(neg)["hoc-tap"]]).toEqual([0, -1_000_000]);
    expect(savingGroup(neg)).toMatchObject({ short: 14_500_000, extra: 0 });
    const zero = at(0);
    expect([heldOf(zero)["nha-o"], heldOf(zero)["hoc-tap"]]).toEqual([0, 0]);
    expect(savingGroup(zero)).toMatchObject({ short: 13_500_000, extra: 0 });
  });

  it("UC-1203 AC-13: phần đã chi trong kỳ — chi gắn mục tiêu không làm hụt mục tiêu trước; chi vượt số cần lấy vào phần sau; Σ held = số dư; tổng ngăn và phần an tâm không đổi", () => {
    const at = (saving: number, spent: Record<string, number>) => view({ accounts: sharedAccounts(saving), goals: sharedGoals(spent), debts: [], savingsPct: 10 });
    const goalOf = (v: PocketsView, id: string) => v.reserve.goals.find((g) => g.id === id)!;
    const paid = at(4_500_000, { "nha-o": 7_500_000 });
    expect(goalOf(paid, "nha-o")).toMatchObject({ held: 0, spent: 7_500_000, short: 0 });
    expect(goalOf(paid, "hoc-tap")).toMatchObject({ held: 4_500_000, spent: 0, short: 1_500_000 });
    expect(savingGroup(paid)).toMatchObject({ balance: 4_500_000, spent: 7_500_000, short: 1_500_000 });
    const overPaid = at(3_000_000, { "nha-o": 9_000_000 });
    expect([goalOf(overPaid, "nha-o").held, goalOf(overPaid, "hoc-tap").held, savingGroup(overPaid).short]).toEqual([0, 3_000_000, 3_000_000]);
    const later = at(0, { "hoc-tap": 6_000_000 });
    expect(goalOf(later, "nha-o")).toMatchObject({ held: 6_000_000, short: 1_500_000 });
    expect(goalOf(later, "hoc-tap")).toMatchObject({ held: -6_000_000, spent: 6_000_000, short: 6_000_000 });
    expect(savingGroup(later).short).toBe(7_500_000);
    const refunded = at(4_700_000, { "nha-o": 7_300_000 });
    expect(goalOf(refunded, "nha-o")).toMatchObject({ held: 200_000, spent: 7_300_000, short: 0 });
    expect(goalOf(refunded, "hoc-tap").held).toBe(4_500_000);
    for (const v of [paid, overPaid, later, refunded]) {
      expect(sumHeld(v, "tk-tiet-kiem")).toBe(savingGroup(v).balance);
      expect(v.reserve.peace).toBe(5_000_000);
    }
    expect(paid.reserve.total).toBe(20_000_000);
  });

  it("UC-1203 AC-10: phần an tâm chỉ gồm tài khoản Dự phòng không gắn mục tiêu, không phải Ví Thưởng; reward = tài khoản Ví Thưởng; nhà một tài khoản → mọi ngăn khác 0", () => {
    const accounts = [
      acct("main", "operating", 3_000_000),
      acct("saving", "reserve", 10_000_000),
      acct("bills", "reserve", 0),
      acct("spare", "reserve", 4_000_000),
      acct("buffer", "reserve", 5_000_000),
    ];
    const goals = [goal("tuition", "saving", { target: 2_000_000 }), goal("bills-goal", "bills", { target: 1_300_000 })];
    const v = view({ accounts, goals, rewardAccountId: "spare", debts: [], savingsPct: 10 });
    expect([v.reserve.total, v.reserve.peace]).toEqual([19_000_000, 5_000_000]);
    expect(v.reserve.reward).toEqual({ accountId: "spare", balance: 4_000_000 });
    expect(v.reserve.accounts.map((a) => [a.id, a.goalIds])).toEqual([
      ["saving", ["tuition"]],
      ["bills", ["bills-goal"]],
      ["spare", []],
      ["buffer", []],
    ]);
    // Ví Thưởng đã tắt / không còn ở ngăn Dự phòng → chưa chọn, tiền về phần an tâm hoặc ngăn của nó.
    expect(view({ accounts: accounts.filter((a) => a.id !== "spare"), goals, rewardAccountId: "spare", debts: [], savingsPct: 10 }).reserve).toMatchObject({ reward: null, peace: 5_000_000 });
    const moved = view({ accounts: accounts.map((a) => (a.id === "spare" ? { ...a, pocket: "operating" as const } : a)), goals, rewardAccountId: "spare", debts: [], savingsPct: 10 });
    expect([moved.reserve.reward, moved.reserve.peace, moved.operating.total]).toEqual([null, 5_000_000, 7_000_000]);
    expect(view({ accounts, goals, rewardAccountId: null, debts: [], savingsPct: 10 }).reserve.peace).toBe(9_000_000);

    const single = view({ accounts: [acct("main", "operating", 12_000_000)], goals: [goal("tuition", null, { target: 2_000_000 })], debts: [], savingsPct: 10 });
    expect([single.savings.total, single.savings.accounts, single.reserve.total, single.reserve.peace, single.operating.total, total(single)]).toEqual([0, [], 0, 0, 12_000_000, 12_000_000]);
    expect(single.reserve.goals.map((g) => [g.id, g.held])).toEqual([["tuition", null]]);
  });

  it("UC-1203 AC-14: phần an tâm và tài khoản con — phao + con 25.000.000; con của tài khoản có mục tiêu và của Ví Thưởng không vào; reward.balance gộp 12.000.000; tổng Dự phòng gồm mọi con", () => {
    const accounts = [
      acct("tk-tiet-kiem", "reserve", 5_000_000),
      { ...acct("gui-6-thang", "reserve", 100_000_000), parentId: "tk-tiet-kiem" },
      acct("phao", "reserve", 5_000_000),
      { ...acct("gui-3-thang", "reserve", 20_000_000), parentId: "phao" },
      acct("tk-bidv", "reserve", 2_000_000),
      { ...acct("gui-bidv", "reserve", 10_000_000), parentId: "tk-bidv" },
    ];
    const v = view({ accounts, goals: [goal("hoc-tap", "tk-tiet-kiem", { target: 30_000_000 })], rewardAccountId: "tk-bidv", debts: [], savingsPct: 10 });
    expect(v.reserve.peace).toBe(25_000_000);
    expect(v.reserve.reward).toEqual({ accountId: "tk-bidv", balance: 12_000_000 });
    expect(v.reserve.total).toBe(142_000_000);
    expect(v.reserve.accounts.find((a) => a.id === "gui-6-thang")).toEqual({ id: "gui-6-thang", name: "gui-6-thang", balance: 100_000_000, goalIds: [], parentId: "tk-tiet-kiem" });
  });

  it("UC-1209 AC-16: mục tiêu ở mẹ thấy tiền trong khoản gửi, lãi không tính — gộp 105.000.000 → 60 / 30 / 15 triệu; gộp 108.000.000, lãi 3.000.000 → Tập luyện vẫn 15.000.000; nhóm có childIds, interest", () => {
    const goals = [
      goal("nha-o", "tk-tiet-kiem", { target: 60_000_000, sort: 10 }),
      goal("hoc-tap", "tk-tiet-kiem", { target: 30_000_000, sort: 20 }),
      goal("tap-luyen", "tk-tiet-kiem", { target: 10_000_000, sort: 30 }),
    ];
    const before = view({ accounts: [acct("tk-tiet-kiem", "reserve", 5_000_000), { ...acct("gui-6-thang", "reserve", 100_000_000), parentId: "tk-tiet-kiem" }], goals, debts: [], savingsPct: 10 });
    expect(before.reserve.goals.map((g) => g.held)).toEqual([60_000_000, 30_000_000, 15_000_000]);
    expect(before.reserve.groups).toEqual([
      { accountId: "tk-tiet-kiem", name: "tk-tiet-kiem", balance: 105_000_000, need: 100_000_000, spent: 0, short: 0, extra: 5_000_000, goalIds: ["nha-o", "hoc-tap", "tap-luyen"], childIds: ["gui-6-thang"], interest: 0 },
    ]);
    expect(before.reserve.peace).toBe(0);
    // Đáo hạn: con đã tắt (không còn trong danh sách tài khoản đang dùng), lãi 3.000.000 vẫn là tiền lãi của nhóm.
    const after = view({ accounts: [acct("tk-tiet-kiem", "reserve", 108_000_000)], goals, interest: { "tk-tiet-kiem": 3_000_000 }, debts: [], savingsPct: 10 });
    expect(after.reserve.goals.map((g) => g.held)).toEqual([60_000_000, 30_000_000, 15_000_000]);
    expect(after.reserve.groups[0]).toMatchObject({ balance: 108_000_000, interest: 3_000_000, childIds: [] });
    expect(after.reserve.total).toBe(108_000_000);
  });

  it("UC-1209 AC-18: mục tiêu trả từ tiền chi tiêu — operating.goals theo thứ tự ưu tiên, remaining = max(0, mỗi tháng − đã chi); không ở reserve.goals / groups, không đổi phần an tâm / tổng Dự phòng", () => {
    const goals = [
      goal("dien-nuoc", null, { paysFrom: "operating", target: 2_000_000, monthly: 2_000_000, repeatMonths: 1, sort: 10, spent: 1_000_000 }),
      goal("thuoc", null, { paysFrom: "operating", target: 500_000, monthly: 500_000, repeatMonths: 1, sort: 20, spent: 300_000 }),
      goal("thien-phuoc", null, { paysFrom: "operating", target: 1_000_000, monthly: 1_000_000, repeatMonths: 1, sort: 30 }),
      goal("ve-que", null, { paysFrom: "operating", target: 1_000_000, monthly: 1_000_000, repeatMonths: 1, sort: 40, spent: 1_500_000 }),
      goal("hoc-tap", "tk-tiet-kiem", { target: 30_000_000, sort: 5 }),
    ];
    const v = view({ accounts: [acct("tk-chi-tieu-chong", "operating", 15_000_000), acct("tk-tiet-kiem", "reserve", 5_000_000), acct("phao", "reserve", 1_000_000)], goals, debts: [], savingsPct: 10 });
    expect(v.operating.goals).toEqual([
      { id: "dien-nuoc", name: "dien-nuoc", monthly: 2_000_000, spent: 1_000_000, remaining: 1_000_000 },
      { id: "thuoc", name: "thuoc", monthly: 500_000, spent: 300_000, remaining: 200_000 },
      { id: "thien-phuoc", name: "thien-phuoc", monthly: 1_000_000, spent: 0, remaining: 1_000_000 },
      { id: "ve-que", name: "ve-que", monthly: 1_000_000, spent: 1_500_000, remaining: 0 },
    ]);
    expect(v.operating.remaining).toBe(2_200_000);
    expect(v.reserve.goals.map((g) => g.id)).toEqual(["hoc-tap"]);
    expect([v.reserve.total, v.reserve.peace, v.operating.total]).toEqual([6_000_000, 1_000_000, 15_000_000]);
  });
});

describe("fillGoals / goalOrder (pocket UC-1209 bước 9, bước 10)", () => {
  it("UC-1203 AC-11: ví dụ chủ nhà — 12.000.000 cho Nhà ở (7.500.000) trước Học tập (6.000.000) → 7.500.000 / 4.500.000, nhóm thiếu 1.500.000; một mục tiêu nhận cả số dư; mục tiêu % đi chung là lỗi lập trình", () => {
    expect(fillGoals(12_000_000, [{ id: "nha-o", need: 7_500_000, spent: 0 }, { id: "hoc-tap", need: 6_000_000, spent: 0 }])).toEqual({
      goals: [
        { id: "nha-o", held: 7_500_000, spent: 0, short: 0 },
        { id: "hoc-tap", held: 4_500_000, spent: 0, short: 1_500_000 },
      ],
      need: 13_500_000,
      spent: 0,
      short: 1_500_000,
      extra: 0,
    });
    expect(fillGoals(-300_000, [{ id: "a", need: 1_000_000, spent: 0 }]).goals[0]!.held).toBe(-300_000);
    expect(fillGoals(1_500_000, [{ id: "thue", need: null, spent: 0 }])).toEqual({ goals: [{ id: "thue", held: 1_500_000, spent: 0, short: null }], need: null, spent: 0, short: null, extra: null });
    expect(() => fillGoals(1_000_000, [{ id: "thue", need: null, spent: 0 }, { id: "a", need: 1, spent: 0 }])).toThrow();
    // spent âm (hoàn nhiều hơn chi) kẹp về 0
    expect(fillGoals(1_000_000, [{ id: "a", need: 500_000, spent: -200_000 }, { id: "b", need: 500_000, spent: 0 }]).goals.map((g) => g.held)).toEqual([500_000, 500_000]);
  });

  it("UC-1209 AC-11: goalOrder — sort, rồi hạn (chưa có hạn xuống cuối), rồi tên theo tiếng Việt, rồi mã", () => {
    const g = (id: string, sort: number, dueDate: string | null, name = id) => ({ id, sort, dueDate, name });
    const list = [g("thue", 30, null, "Thuế"), g("hoa-don", 30, null, "Hoá đơn"), g("bdx", 20, "2027-03-31"), g("hoc-phi", 10, "2027-01-15"), g("z", 20, null, "A"), g("y", 20, null, "A")];
    expect([...list].sort(goalOrder).map((x) => x.id)).toEqual(["hoc-phi", "bdx", "y", "z", "hoa-don", "thue"]);
  });
});

describe("tiền lãi của nhóm (groupInterest, pocket UC-1209 bước 9)", () => {
  // Mỗi bước: số dư gộp đổi bao nhiêu, lãi vào, rút "từ tiền lãi". Chuyển nội bộ mẹ ↔ con: delta 0.
  const step = (delta: number, interest = 0, fromInterest = 0) => ({ delta, interest, fromInterest });
  it("UC-1209 AC-16: đáo hạn — lãi 3.000.000 vào con; chuyển về mẹ (nội bộ) → 3.000.000; rút từ lãi → 0; rút không chọn → vẫn 3.000.000; tiền cho không thành lãi", () => {
    const matured = [step(3_000_000, 3_000_000), step(0)];
    expect(groupInterest(105_000_000, matured)).toBe(3_000_000);
    expect(groupInterest(105_000_000, [...matured, step(-3_000_000, 0, 3_000_000)])).toBe(0);
    expect(groupInterest(105_000_000, [...matured, step(-3_000_000)])).toBe(3_000_000);
    expect(groupInterest(105_000_000, [...matured, step(2_000_000)])).toBe(3_000_000);
  });

  it("UC-1209 AC-19: cộng dồn, kẹp từng bước — 3.000.000 → rút 500.000 → 2.500.000 → rút 2.500.000 → 0 → lãi mới 1.000.000 → 1.000.000; rút sạch → 0; nạp 2.000.000 → vẫn 0", () => {
    const s = [step(3_000_000, 3_000_000), step(-500_000, 0, 500_000)];
    expect(groupInterest(105_000_000, s)).toBe(2_500_000);
    const t = [...s, step(-2_500_000, 0, 2_500_000), step(1_000_000, 1_000_000)];
    expect(groupInterest(105_000_000, t)).toBe(1_000_000);
    const u = [...t, step(-106_000_000)];
    expect(groupInterest(105_000_000, u)).toBe(0);
    expect(groupInterest(105_000_000, [...u, step(2_000_000)])).toBe(0);
    expect(groupInterest(0, [])).toBe(0);
  });
});

describe("đầu kỳ lương khi chưa có kỳ lưu (cycleRanges)", () => {
  const starts = (today: string, paydayDay: number, since: string) =>
    cycleRanges([], paydayDay, new Date(`${today}T10:00:00+07:00`), new Date(`${since}T00:00:00+07:00`).toISOString()).map((r) => r.payday).reverse();
  it("UC-1203 AC-5: đầu kỳ = ngày lương gần nhất ≤ hôm nay, kẹp cuối tháng — 11/11 → 10/11, 10/10; đúng ngày lương 10/12 → 10/12, 10/11; ngày lương 31, 5/3/2027 → 28/2", () => {
    expect(starts("2026-11-11", 10, "2026-08-10")).toEqual(["2026-11-10", "2026-10-10", "2026-09-10", "2026-08-10"]);
    expect(starts("2026-12-10", 10, "2026-11-10")).toEqual(["2026-12-10", "2026-11-10"]);
    expect(starts("2027-03-05", 31, "2027-01-01")).toEqual(["2027-02-28", "2027-01-31", "2026-12-31"]);
    expect(starts("2027-01-05", 10, "2026-11-10")).toEqual(["2026-12-10", "2026-11-10"]);
  });
});

describe("lời chúc khi hết nợ ngắn hạn (blessingFor)", () => {
  it("UC-702 AC-17: 11/11 → câu 1, 12/11 → câu 2, 13/11 → câu 3, 14/11 → câu 4, 15/11 lại câu 1", () => {
    expect(["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map(blessingFor)).toEqual([
      "Không còn nợ ngắn hạn 🎉 — tiền vận hành là của mình trọn vẹn",
      "Sạch nợ ngắn hạn — mỗi đồng chi hôm nay là tiền của mình",
      "Không nợ ngắn hạn nào. Giữ nhịp này nhé 👏",
      "Hết nợ ngắn hạn — tháng này nhẹ hẳn",
      "Không còn nợ ngắn hạn 🎉 — tiền vận hành là của mình trọn vẹn",
    ]);
  });
});

describe("xếp ngăn khi có tài khoản con (UC-1201, service)", () => {
  const put = async (raw: DatabaseSync, accounts: { id: string; pocket: string | null }[]) => {
    const res = await app.request(
      "https://app.example.com/v1/settings/pockets",
      { method: "PUT", headers: { Authorization: "Bearer tok", "X-Member-Id": "husband", "Content-Type": "application/json" }, body: JSON.stringify({ accounts }) },
      { DB: asD1(raw), API_TOKEN: "tok" } as Env,
    );
    return { status: res.status, json: (await res.json()) as { error?: { code: string; message: string } } };
  };

  it("UC-1201 AC-6: đổi mẹ sang Tích luỹ và con sang Vận hành → cả hai Tích luỹ, nhật ký pockets.confirm ghi con đổi theo mẹ; dòng chỉ của con bị bỏ qua; đổi mẹ sang Vận hành → 409 account_has_children, không đổi gì", async () => {
    const raw = openDb();
    raw.exec(`
      INSERT INTO accounts (id, name, kind, bank, opening_balance, pocket, pocket_confirmed) VALUES ('tk-tiet-kiem', 'MB tiết kiệm', 'bank', 'MBBank', 20000000, 'reserve', 1);
      INSERT INTO accounts (id, name, kind, bank, opening_balance, pocket, pocket_confirmed, parent_account_id) VALUES ('gui-6-thang', 'Gửi 6 tháng', 'bank', 'MBBank', 0, 'reserve', 1, 'tk-tiet-kiem');
    `);
    const pockets = () => raw.prepare("SELECT id, pocket, pocket_confirmed FROM accounts WHERE id IN ('tk-tiet-kiem', 'gui-6-thang') ORDER BY id").all();
    const audits = () => (raw.prepare("SELECT detail FROM audit_log WHERE action = 'pockets.confirm' ORDER BY id").all() as { detail: string }[]).map((r) => JSON.parse(r.detail));

    expect((await put(raw, [{ id: "tk-tiet-kiem", pocket: "savings" }, { id: "gui-6-thang", pocket: "operating" }])).status).toBe(200);
    expect(pockets()).toEqual([
      { id: "gui-6-thang", pocket: "savings", pocket_confirmed: 1 },
      { id: "tk-tiet-kiem", pocket: "savings", pocket_confirmed: 1 },
    ]);
    expect(audits()).toEqual([
      { accounts: 2, changes: { "tk-tiet-kiem": { from: "reserve", to: "savings" }, "gui-6-thang": { from: "reserve", to: "savings", parent: "tk-tiet-kiem" } } },
    ]);

    expect((await put(raw, [{ id: "gui-6-thang", pocket: "operating" }])).status).toBe(200);
    expect(pockets()).toEqual([
      { id: "gui-6-thang", pocket: "savings", pocket_confirmed: 1 },
      { id: "tk-tiet-kiem", pocket: "savings", pocket_confirmed: 1 },
    ]);
    expect(audits().at(-1)).toEqual({ accounts: 1, changes: {} });

    const blocked = await put(raw, [{ id: "tk-tiet-kiem", pocket: "operating" }]);
    expect([blocked.status, blocked.json.error?.code, blocked.json.error?.message]).toEqual([409, "account_has_children", "Tất toán / tắt các khoản gửi của MB tiết kiệm trước."]);
    expect(pockets()).toEqual([
      { id: "gui-6-thang", pocket: "savings", pocket_confirmed: 1 },
      { id: "tk-tiet-kiem", pocket: "savings", pocket_confirmed: 1 },
    ]);
    expect(audits()).toHaveLength(2);
  });
});
