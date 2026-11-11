// Hộ mẫu B (proposal 261112-ba-ngan-ba-the, mục tiêu là tài khoản thật từ Đợt E) cho test PWA: số ba ngăn qua đúng
// `pocketsView` / `nearSpend` của server. Hôm nay 11/11/2026, ngày lương 10. Chỉ test dùng.

import { pocketsView, type PocketGoalInput, type PocketsInput, type PocketsView } from "../../../src/domain/pockets";
import { nearSpend, type NearSpend, type NearSpendCycle, type SnapshotData } from "../../../src/domain/snapshot";

const goal = (id: string, name: string, accountId: string | null, o: Partial<PocketGoalInput> = {}): PocketGoalInput => ({
  id, name, accountId, target: null, targetPct: null, monthly: null, repeatMonths: null, dueDate: null, debtId: null, sort: 100, spent: 0, ...o,
});

/** Tài khoản đang dùng kèm ngăn — cho `nearSpend.excluded`. */
export const B_ACCOUNTS: SnapshotData["accounts"] = [
  { id: "main", name: "tài khoản chính", pocket: "operating" },
  { id: "spending", name: "tài khoản chi tiêu", pocket: "operating" },
  { id: "card", name: "thẻ tín dụng", pocket: "operating" },
  { id: "wealth", name: "tài khoản tích luỹ", pocket: "savings" },
  { id: "piggy", name: "heo đất", pocket: "savings" },
  { id: "saving", name: "tài khoản tiết kiệm", pocket: "reserve" },
  { id: "repay-acc", name: "tài khoản Trả nợ", pocket: "reserve" },
  { id: "tuition-acc", name: "tài khoản học phí", pocket: "reserve" },
  { id: "car-acc", name: "tài khoản bảo dưỡng xe", pocket: "reserve" },
  { id: "tax-acc", name: "tài khoản thuế", pocket: "reserve" },
  { id: "momo", name: "ví điện tử", pocket: null },
];

const BALANCE: Record<string, number> = {
  main: 3_000_000,
  spending: 1_400_000,
  card: -300_000,
  wealth: 6_000_000,
  piggy: 500_000,
  saving: 31_500_000,
  "repay-acc": 1_000_000,
  "tuition-acc": 4_000_000,
  "car-acc": 1_000_000,
  "tax-acc": 500_000,
  momo: 200_000,
};

export function pocketsB(over: Partial<PocketsInput> = {}): PocketsView {
  return pocketsView({
    accounts: B_ACCOUNTS.map((a) => ({ id: a.id, name: a.name, pocket: a.pocket, confirmed: true, balance: BALANCE[a.id]! })),
    goals: [
      goal("repay", "Trả nợ Vay người thân", "repay-acc", { target: 1_000_000, monthly: 1_000_000, repeatMonths: 1, dueDate: "2026-11-15", debtId: "family", sort: 10 }),
      goal("tuition", "Học phí", "tuition-acc", { target: 6_000_000, monthly: 2_000_000, repeatMonths: 3, dueDate: "2027-01-15", sort: 20 }),
      goal("car", "Bảo dưỡng xe", "car-acc", { target: 4_800_000, dueDate: "2027-03-31", sort: 30 }),
      goal("tax", "Thuế", "tax-acc", { targetPct: 10, sort: 40 }),
    ],
    rewardAccountId: null,
    debts: [
      { id: "family", name: "Vay người thân", term: "short", active: true, balance: 5_000_000, monthlyPayment: 1_000_000, dueDay: 15 },
      { id: "installment", name: "Mua trả góp", term: "short", active: true, balance: 3_000_000, monthlyPayment: null, dueDay: null },
      { id: "mortgage", name: "Vay mua nhà", term: "long", active: true, balance: 50_000_000, monthlyPayment: null, dueDay: null },
    ],
    savingsPct: 10,
    history: {
      since: "2026-11-10",
      prevSince: "2026-10-10",
      accounts: [
        { id: "wealth", pocket: "savings", since: 5_200_000, prevSince: 4_500_000 },
        { id: "piggy", pocket: "savings", since: 500_000, prevSince: 500_000 },
        { id: "saving", pocket: "reserve", since: 31_500_000, prevSince: 31_500_000 },
      ],
    },
    // Kỳ 30 ngày: tháng vận hành chuẩn hoá theo ngày (UC-1203 bước 11) bằng đúng trung bình theo kỳ.
    operatingSpend: {
      cycles: [
        { start: "2026-08-10", amount: 9_000_000, days: 30 },
        { start: "2026-09-10", amount: 10_500_000, days: 30 },
        { start: "2026-10-10", amount: 10_500_000, days: 30 },
      ],
      dataStart: "2026-07-01",
    },
    peaceTarget: 6,
    ...over,
  });
}

export function nearSpendB(pockets: PocketsView = pocketsB(), today = "2026-11-11", cycle: NearSpendCycle = { cyclePayday: null, pendingTasks: 0 }): NearSpend {
  return nearSpend(pockets.operating, B_ACCOUNTS, today, 10, cycle);
}

/** Dữ liệu giả của pocket UC-1203 AC-11 / UC-1209 AC-8: hai tài khoản chung (VCB chung, MB tiết kiệm), TK thuế riêng, phao. */
export const SHARED_ACCOUNTS: { id: string; name: string; balance: number }[] = [
  { id: "tk-chung", name: "VCB chung", balance: 9_000_000 },
  { id: "tk-tiet-kiem", name: "MB tiết kiệm", balance: 12_000_000 },
  { id: "tk-thue", name: "TK thuế", balance: 1_500_000 },
  { id: "phao", name: "phao", balance: 5_000_000 },
];

export const sharedGoals = (spent: Record<string, number> = {}): PocketGoalInput[] =>
  [
    goal("hoa-don", "Hoá đơn", "tk-chung", { target: 2_000_000, monthly: 2_000_000, repeatMonths: 1, dueDate: "2026-11-20", sort: 10 }),
    goal("nha-o", "Nhà ở", "tk-tiet-kiem", { target: 7_500_000, monthly: 7_500_000, repeatMonths: 1, dueDate: "2026-12-05", sort: 20 }),
    goal("hoc-tap", "Học tập", "tk-tiet-kiem", { target: 6_000_000, dueDate: "2027-01-15", sort: 30 }),
    goal("bao-duong-xe", "Bảo dưỡng xe", "tk-chung", { target: 4_800_000, dueDate: "2027-03-31", sort: 40 }),
    goal("hieu-hi", "Hiếu hỉ", "tk-chung", { target: 3_000_000, sort: 50 }),
    goal("thue", "Thuế", "tk-thue", { targetPct: 10, sort: 60 }),
  ].map((g) => ({ ...g, spent: spent[g.id] ?? 0 }));

/** Ba ngăn của dữ liệu giả UC-1203 AC-11; `saving` = số dư MB tiết kiệm, `spent` = đã chi trong kỳ theo mục tiêu. */
export function pocketsShared({ saving = 12_000_000, spent = {} }: { saving?: number; spent?: Record<string, number> } = {}): PocketsView {
  return pocketsView({
    accounts: SHARED_ACCOUNTS.map((a) => ({ id: a.id, name: a.name, pocket: "reserve", confirmed: true, balance: a.id === "tk-tiet-kiem" ? saving : a.balance })),
    goals: sharedGoals(spent),
    rewardAccountId: null,
    debts: [],
    savingsPct: 10,
    history: { since: "2026-11-10", prevSince: "2026-10-10", accounts: [] },
    operatingSpend: { cycles: [], dataStart: null },
    peaceTarget: 6,
  });
}
