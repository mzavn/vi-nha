// Ba ngăn (pocket UC-1203, UC-1209, ADR-119, ADR-132): tổng ngăn = Σ sổ tài khoản theo ngăn, mục tiêu Dự phòng = tài khoản
// thật (A = số dư), phần an tâm, Ví Thưởng, nợ ngắn hạn, Tích luỹ theo kỳ, tháng vận hành — hàm thuần.
import { describe, expect, it } from "vitest";
import { blessingFor, peaceMonthsView, pocketsView, type PocketAccount, type PocketDebt, type PocketGoalInput, type PocketsInput, type PocketsView } from "../src/domain/pockets";
import { cycleRanges } from "../src/domain/pay-cycle";

const acct = (id: string, pocket: PocketAccount["pocket"], balance: number, confirmed = true): PocketAccount => ({ id, name: id, pocket, balance, confirmed });
const goal = (id: string, accountId: string | null, o: Partial<PocketGoalInput> = {}): PocketGoalInput => ({
  id, name: id, accountId, target: null, targetPct: null, monthly: null, repeatMonths: null, dueDate: null, debtId: null, ...o,
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
    expect(v.reserve.accounts).toEqual([{ id: "saving", name: "saving", balance: 10_000_000, goalId: "tuition" }]);
    expect(v.operating.accounts.find((a) => a.id === "card")).toEqual({ id: "card", name: "card", balance: -800_000, goalId: null });
    expect(v.reserve.goals).toEqual([
      { id: "tuition", name: "tuition", accountId: "saving", held: 10_000_000, target: 6_000_000, targetPct: null, monthly: 2_000_000, repeatMonths: 3, dueDate: "2027-01-15", debtId: null },
      { id: "car", name: "car", accountId: null, held: null, target: 4_800_000, targetPct: null, monthly: null, repeatMonths: null, dueDate: "2027-03-31", debtId: null },
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

  it("UC-1203 AC-7: mục tiêu sắp theo hạn (chưa có hạn xuống cuối) rồi theo tên; mỗi mục tiêu có accountId, held theo tài khoản", () => {
    const v = view({
      accounts: [acct("a-tuition", "reserve", 4_000_000), acct("a-car", "reserve", 1_000_000), acct("a-repay", "reserve", 1_000_000), acct("a-bike", "reserve", 0)],
      goals: [
        goal("tuition", "a-tuition", { name: "Học phí", dueDate: "2027-01-15" }),
        goal("car", "a-car", { name: "Bảo dưỡng xe", dueDate: "2027-03-31" }),
        goal("tax", null, { name: "Thuế", targetPct: 10 }),
        goal("repay", "a-repay", { name: "Trả nợ Vay người thân", dueDate: "2026-11-15" }),
        goal("bike", "a-bike", { name: "Áo mưa", dueDate: "2027-03-31" }),
      ],
      debts: [],
      savingsPct: 10,
    });
    expect(v.reserve.goals.map((g) => [g.name, g.accountId, g.held])).toEqual([
      ["Trả nợ Vay người thân", "a-repay", 1_000_000],
      ["Học phí", "a-tuition", 4_000_000],
      ["Áo mưa", "a-bike", 0],
      ["Bảo dưỡng xe", "a-car", 1_000_000],
      ["Thuế", null, null],
    ]);
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
    expect(v.reserve.accounts.map((a) => [a.id, a.goalId])).toEqual([
      ["saving", "tuition"],
      ["bills", "bills-goal"],
      ["spare", null],
      ["buffer", null],
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
