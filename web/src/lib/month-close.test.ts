import { describe, expect, it } from "vitest";
import {
  CLOSE_PCT_STEP,
  closePctLock,
  closePctStep,
  monthCloseCard,
  monthCloseLines,
  monthClosePath,
  monthCloseToast,
  monthCloseWarning,
  rewardWalletOptions,
} from "./month-close";
import type { MonthCloseDone, MonthCloseOpen, MonthCloseResult, Wallet } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => `${s}${NBSP}₫`;

const wallet = (id: string, name: string, patch: Partial<Wallet> = {}): Wallet => ({
  id,
  name,
  tier: "must",
  mustGroup: "must",
  kind: "envelope",
  scope: "shared",
  memberId: null,
  accountId: "vcb",
  private: false,
  sort: 40,
  hidden: false,
  ...patch,
});

const WALLETS: Wallet[] = [
  wallet("wealth-building", "Tích sản", { tier: "wealth_building", mustGroup: null, accountId: "tcb" }),
  wallet("tax", "Thuế", { tier: "tax", mustGroup: null }),
  wallet("income", "Thu nhập", { tier: "holding", mustGroup: null, kind: "holding" }),
  wallet("food", "Ăn uống"),
  wallet("transport", "Đi lại"),
  wallet("other", "Khác"),
  wallet("shopping", "Mua sắm"),
  wallet("travel", "Du lịch", { tier: "nice", mustGroup: null }),
  wallet("reward", "Ví Thưởng", { kind: "accrual" }),
  wallet("pocket-wife", "Tiêu vặt Vợ", { scope: "personal", memberId: "wife" }),
  wallet("electric", "Tiền điện", { kind: "bill" }),
];

const participant = (walletId: string, name: string, p: Partial<MonthCloseOpen["participants"][number]> = {}): MonthCloseOpen["participants"][number] => ({
  walletId,
  name,
  monthEndBalance: 0,
  hole: 0,
  coveredByNextIncome: 0,
  contributed: 0,
  coverReceived: 0,
  toWealth: 0,
  toReward: 0,
  balanceNow: 0,
  balanceAfter: 0,
  ...p,
});

// UC-207 AC-6: Ăn uống +2.000.000, Đi lại +400.000, Khác −1.500.000, Mua sắm −600.000, X = 50.
const AC6: MonthCloseOpen = {
  month: "2026-10",
  closed: false,
  wealthPct: 50,
  defaultWealthPct: 50,
  wealthWalletId: "wealth-building",
  rewardWalletId: "reward",
  positiveTotal: 2_400_000,
  holeTotal: 2_100_000,
  covered: 2_100_000,
  profit: 300_000,
  toWealth: 150_000,
  toReward: 150_000,
  participants: [
    participant("food", "Ăn uống", { monthEndBalance: 2_000_000, contributed: 1_750_000, toWealth: 125_000, toReward: 125_000, balanceNow: 2_000_000 }),
    participant("transport", "Đi lại", { monthEndBalance: 400_000, contributed: 350_000, toWealth: 25_000, toReward: 25_000, balanceNow: 400_000 }),
    participant("other", "Khác", { monthEndBalance: -1_500_000, hole: 1_500_000, coverReceived: 1_500_000, balanceNow: -1_500_000 }),
    participant("shopping", "Mua sắm", { monthEndBalance: -600_000, hole: 600_000, coverReceived: 600_000, balanceNow: -600_000 }),
  ],
  covers: [
    { fromWalletId: "food", toWalletId: "other", amount: 1_500_000 },
    { fromWalletId: "food", toWalletId: "shopping", amount: 250_000 },
    { fromWalletId: "transport", toWalletId: "shopping", amount: 350_000 },
  ],
  sweeps: [
    { fromWalletId: "food", toWalletId: "wealth-building", kind: "wealth", amount: 125_000 },
    { fromWalletId: "food", toWalletId: "reward", kind: "reward", amount: 125_000 },
    { fromWalletId: "transport", toWalletId: "wealth-building", kind: "wealth", amount: 25_000 },
    { fromWalletId: "transport", toWalletId: "reward", kind: "reward", amount: 25_000 },
  ],
  transferOrders: [{ fromAccountId: "vcb", toAccountId: "tcb", amount: 150_000, walletIds: ["wealth-building"] }],
  warnings: [],
};

const NO_REWARD: MonthCloseOpen = {
  ...AC6,
  month: "2026-09",
  wealthPct: 100,
  defaultWealthPct: 100,
  rewardWalletId: null,
  positiveTotal: 4_640_000,
  covered: 500_000,
  profit: 4_140_000,
  toWealth: 4_140_000,
  toReward: 0,
};

describe("chốt tháng ở PWA (change 261015-chot-thang-va-keo-tich-san)", () => {
  it("UC-207 AC-1: thẻ \"Chốt tháng 9\" kèm số dư sau khi bù; closed → không có thẻ; không có gì để chốt → không có thẻ", () => {
    expect(monthClosePath()).toBe("/v1/month-close");
    expect(monthClosePath(50)).toBe("/v1/month-close?wealth_pct=50");
    expect(monthCloseCard(NO_REWARD)).toEqual({ title: "Chốt tháng 9", line: `Dư ${vnd("4.140.000")} sau khi bù chi lố ${vnd("500.000")}` });
    expect(monthCloseCard({ ...NO_REWARD, covered: 0, holeTotal: 0 })).toEqual({ title: "Chốt tháng 9", line: `Dư ${vnd("4.140.000")}` });
    const done: MonthCloseDone = { month: "2026-09", closed: true, closedAt: "2026-10-03 01:02:03", byMemberId: "husband", wealthPct: 100 };
    expect(monthCloseCard(done)).toBeNull();
    // Không ví dương (AC-3, hoặc chỉ có ví âm): thẻ ẩn như tin mời sáng.
    expect(monthCloseCard({ ...NO_REWARD, positiveTotal: 0, covered: 0, profit: 0, toWealth: 0 })).toBeNull();
  });

  it("UC-207 AC-6: bảng bù, L, Tích sản / Ví Thưởng lấy đúng số server trả, không tự tính", () => {
    const lines = monthCloseLines(AC6, WALLETS);
    expect(lines.covers.map((l) => [l.label, l.value])).toEqual([
      ["Ăn uống → Khác", 1_500_000],
      ["Ăn uống → Mua sắm", 250_000],
      ["Đi lại → Mua sắm", 350_000],
    ]);
    expect(lines.sweeps.map((l) => [l.label, l.value])).toEqual([
      ["Ăn uống → Tích sản", 125_000],
      ["Ăn uống → Ví Thưởng", 125_000],
      ["Đi lại → Tích sản", 25_000],
      ["Đi lại → Ví Thưởng", 25_000],
    ]);
    expect(lines.total.map((l) => [l.label, l.value])).toEqual([
      ["Bù chi lố", 2_100_000],
      ["Lợi nhuận thêm", 300_000],
      ["Vào Tích sản (50%)", 150_000],
      ["Vào Ví Thưởng (50%)", 150_000],
    ]);
    // Số lấy từ server: đổi số server thì dòng đổi theo, không tính lại từ phần trăm.
    expect(monthCloseLines({ ...AC6, toWealth: 151_000 }, WALLETS).total[2]!.value).toBe(151_000);
    expect(monthCloseToast({ ...AC6, closed: true, batchId: "S202610", closedAt: "2026-11-02 08:00:00" } as MonthCloseResult)).toBe(
      `Đã chốt tháng 10: bù ${vnd("2.100.000")}, Tích sản +${vnd("150.000")}, Ví Thưởng +${vnd("150.000")}, 1 lệnh chuyển`,
    );
  });

  it("UC-207 AC-7: L = 0 nhưng có bù → câu \"Chi lố được bù …, không còn dư\"; ví âm chưa bù hết hiện số còn lại chờ lần chia sau", () => {
    const ac7: MonthCloseOpen = {
      ...NO_REWARD,
      positiveTotal: 500_000,
      holeTotal: 1_500_000,
      covered: 500_000,
      profit: 0,
      toWealth: 0,
      participants: [
        participant("food", "Ăn uống", { monthEndBalance: 500_000, contributed: 500_000, balanceNow: 500_000 }),
        participant("other", "Khác", { monthEndBalance: -1_500_000, hole: 1_500_000, coverReceived: 500_000, balanceNow: -1_500_000, balanceAfter: -1_000_000 }),
      ],
      covers: [{ fromWalletId: "food", toWalletId: "other", amount: 500_000 }],
      sweeps: [],
      transferOrders: [],
    };
    expect(monthCloseCard(ac7)).toEqual({ title: "Chốt tháng 9", line: `Chi lố được bù ${vnd("500.000")}, không còn dư` });
    const lines = monthCloseLines(ac7, WALLETS);
    expect(lines.total.map((l) => l.label)).toEqual(["Bù chi lố", "Lợi nhuận thêm"]);
    // Số còn lại = phần chưa bù của hố (hole − coverReceived), đúng như server trả.
    expect(lines.left.map((l) => [l.label, l.value])).toEqual([["Khác", -1_000_000]]);
    expect(monthCloseLines(AC6, WALLETS).left).toEqual([]);
    expect(monthCloseToast({ ...ac7, closed: true, batchId: "S202609", closedAt: "" } as MonthCloseResult)).toBe(`Đã chốt tháng 9: bù ${vnd("500.000")}`);
  });

  it("UC-207 AC-8: chưa có Ví Thưởng → thanh khoá ở 100%, kèm câu chỉ tới Cài đặt › Tham số; có Ví Thưởng → thanh bước 5", () => {
    expect(closePctLock(NO_REWARD)).toBe("Chưa đặt Ví Thưởng — cả phần dư vào Tích sản. Đặt ở Cài đặt › Tham số.");
    expect(closePctLock(AC6)).toBeNull();
    expect(CLOSE_PCT_STEP).toBe(5);
    expect(closePctStep(AC6)).toBe(5);
    // Tham số đặt số không chia hết cho 5 (vd 33): thanh bước 1 để không nhảy khỏi số đã đặt.
    expect(closePctStep({ ...AC6, defaultWealthPct: 33 })).toBe(1);
    expect(monthCloseLines(NO_REWARD, WALLETS).total.map((l) => l.label)).toEqual(["Bù chi lố", "Lợi nhuận thêm", "Vào Tích sản (100%)"]);
  });

  it("UC-207: cảnh báo ví âm sau chốt đúng câu chữ, tháng sau tính đúng khi chốt tháng 12", () => {
    const w = { walletId: "food", name: "Ăn uống", balanceAfter: -300_000 };
    expect(monthCloseWarning(AC6, w)).toBe(`Sau khi chốt, Ăn uống còn −${vnd("300.000")} (đã chi tháng 11 bằng tiền dư tháng 10) — sẽ bù ở lần chốt tháng 11`);
    expect(monthCloseWarning({ ...AC6, month: "2026-12" }, w)).toBe(`Sau khi chốt, Ăn uống còn −${vnd("300.000")} (đã chi tháng 1 bằng tiền dư tháng 12) — sẽ bù ở lần chốt tháng 1`);
  });

  it("UC-507: chọn Ví Thưởng chỉ liệt kê ví đang dùng phe Must / Hưởng thụ, không phải phong bì chung", () => {
    expect(rewardWalletOptions(WALLETS).map((w) => w.id)).toEqual(["reward", "electric"]);
  });

  it("UC-507: ví cá nhân và ví riêng tư không có trong danh sách chọn Ví Thưởng", () => {
    const secret = wallet("secret", "Quỹ riêng", { kind: "accrual", private: true });
    const ids = rewardWalletOptions([...WALLETS, secret]).map((w) => w.id);
    expect(ids).not.toContain("pocket-wife");
    expect(ids).not.toContain("secret");
  });
});
