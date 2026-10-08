import { describe, expect, it } from "vitest";
import type { WalletRule } from "../../../src/domain/allocation";
import { buildSnapshot, type SnapshotData } from "../../../src/domain/snapshot";
import type { WalletRef } from "../../../src/domain/types";
import type { QueuedEntry } from "../offline/queue";
import { applyQueue, applyQueueToBudget, entryToast, localWalletStatus, queuedLineAfter } from "./pending";
import type { Budget, EntryBody } from "./types";

const NOW = new Date("2026-09-22T03:00:00Z"); // thứ Ba 22/9 giờ VN, tuần 39

const w = (id: string, tier: WalletRef["tier"], mustGroup: WalletRef["mustGroup"], extra: Partial<WalletRef> = {}): WalletRef => ({
  id,
  name: id,
  tier,
  mustGroup,
  kind: "envelope",
  scope: "shared",
  memberId: null,
  accountId: null,
  private: false,
  sort: 0,
  ...extra,
});
const rule = (walletId: string, over: Partial<WalletRule>): WalletRule => ({
  walletId,
  tier: "must",
  mustGroup: "must",
  kind: "envelope",
  mode: "flat",
  period: "week",
  amount: null,
  percent: null,
  targetAmount: null,
  targetDate: null,
  floorAmount: null,
  priority: 50,
  ...over,
});

const wallets = [
  w("wealth-building", "wealth_building", null, { kind: "accrual" }),
  w("food", "must", "must"),
  w("transport", "must", "must", { name: "Đi lại" }),
  w("nice-to-have", "must", "have"),
  w("fun-wife", "nice", null, { scope: "personal", memberId: "wife", private: true }),
];
const rules = [
  rule("food", { amount: 625_000 }),
  rule("transport", { amount: 300_000 }),
  rule("nice-to-have", { mode: "remainder", period: "month", mustGroup: "have" }),
];

function data(balances: Record<string, number>, spentWeek: Record<string, number>, spentMonth: Record<string, number>): SnapshotData {
  return {
    now: NOW,
    viewerId: "husband",
    wallets,
    rules,
    balances,
    spentWeek,
    spentMonth,
    wealthBuilding: { cash: 4_000_000, assets: 0 },
    safetyFund: null,
    safetyFundMonths: 6,
    goals: [],
    pending: { count: 0, net: 0 },
    drift: [],
    transferOrders: { pending: 0, overdue: 0 },
    unallocatedIncome: { count: 0, amount: 0, oldestTxId: null },
    accounts: [],
  };
}

const base = { "wealth-building": 4_000_000, food: 1_500_000, "transport": 1_000_000, "nice-to-have": 3_000_000 };
const snap = buildSnapshot(data(base, { food: 100_000 }, { food: 400_000 }));

let seq = 0;
const item = (body: Partial<EntryBody> & Pick<EntryBody, "meaning" | "amount">): QueuedEntry => {
  const clientId = `client-${++seq}`;
  return { clientId, memberId: "husband", createdAt: NOW.toISOString(), status: "pending", attempts: 0, body: { at: NOW.toISOString(), client_id: clientId, ...body } };
};

describe("trừ tạm khoản chưa đồng bộ vào số đang hiển thị", () => {
  it("không có gì trong hàng đợi thì giữ nguyên số của server", () => {
    expect(applyQueue(snap, [])).toBe(snap);
  });

  it("chi 250.000 từ Đi lại: khớp đúng số server sẽ tính sau khi ghi", () => {
    const after = applyQueue(snap, [item({ meaning: "spend", amount: 250_000, wallet_id: "transport", category_id: "ride-hailing" })]);
    const server = buildSnapshot(data({ ...base, "transport": 750_000 }, { food: 100_000, "transport": 250_000 }, { food: 400_000, "transport": 250_000 }));
    expect(after.spendableThisWeek).toBe(server.spendableThisWeek);
    expect(after.spendableByWallet).toEqual(server.spendableByWallet);
    expect(after.tiers).toEqual(server.tiers);
    expect(after.wallets).toEqual(server.wallets);
  });

  it("ví nhận phần dư (không có mức tuần) cũng khớp công thức chia theo tuần còn lại", () => {
    const after = applyQueue(snap, [
      item({ meaning: "spend", amount: 900_000, wallet_id: "nice-to-have", category_id: "health" }),
      item({ meaning: "refund", amount: 100_000, wallet_id: "food" }),
    ]);
    const server = buildSnapshot(
      data({ ...base, "nice-to-have": 2_100_000, food: 1_600_000 }, { food: 0, "nice-to-have": 900_000 }, { food: 300_000, "nice-to-have": 900_000 }),
    );
    expect(after.spendableThisWeek).toBe(server.spendableThisWeek);
    expect(after.tiers).toEqual(server.tiers);
  });

  it("khoản của tuần trước chỉ trừ số dư, không cộng vào đã chi tuần này", () => {
    const after = applyQueue(snap, [item({ meaning: "spend", amount: 50_000, wallet_id: "food", category_id: "groceries", at: "2026-09-19T05:00:00Z" })]);
    const an = after.wallets.find((l) => l.id === "food")!;
    expect(an.balance).toBe(1_450_000);
    expect(an.spentWeek).toBe(100_000);
    expect(an.spentMonth).toBe(450_000);
  });

  it("ví riêng tư của người kia không bị đụng (không có số để trừ)", () => {
    const after = applyQueue(snap, [item({ meaning: "spend", amount: 50_000, wallet_id: "fun-wife", category_id: "hangouts" })]);
    expect(after.wallets.find((l) => l.id === "fun-wife")!.balance).toBeNull();
    expect(after.spendableThisWeek).toBe(snap.spendableThisWeek);
  });

  it("bảng ngân sách tuần / tháng cộng khoản chờ vào thực tế", () => {
    const budget: Budget = {
      period: "2026-W39",
      kind: "week",
      weeks: 1,
      lines: [{ walletId: "transport", name: "Đi lại", tier: "must", mustGroup: "must", target: 300_000, spent: 0, remaining: 300_000 }],
    };
    const q = [item({ meaning: "spend", amount: 250_000, wallet_id: "transport", category_id: "ride-hailing" })];
    expect(applyQueueToBudget(budget, q).lines[0]).toMatchObject({ spent: 250_000, remaining: 50_000 });
    const month: Budget = { ...budget, period: "2026-09", kind: "month", weeks: 4 };
    expect(applyQueueToBudget(month, q).lines[0]).toMatchObject({ spent: 250_000, remaining: 50_000 });
    const other: Budget = { ...budget, period: "2026-W40" };
    expect(applyQueueToBudget(other, q)).toEqual(other);
  });

  it("chuyển ngân sách chưa đồng bộ: số dư hai ví đổi ngay, thực tế chi không đổi", () => {
    const budget: Budget = {
      period: "2026-09",
      kind: "month",
      weeks: 4,
      lines: [
        { walletId: "food", name: "Ăn", tier: "must", mustGroup: "must", target: 7_000_000, spent: 7_300_000, remaining: -300_000, balance: -300_000 },
        { walletId: "other", name: "Khác", tier: "must", mustGroup: "have", target: 225_000, spent: 0, remaining: 225_000, balance: 225_000 },
      ],
    };
    const q = [item({ meaning: "transfer", amount: 300_000, from_wallet_id: "other", wallet_id: "food" })];
    const [an, khac] = applyQueueToBudget(budget, q).lines;
    expect(an).toMatchObject({ balance: 0, spent: 7_300_000, remaining: -300_000 });
    expect(khac).toMatchObject({ balance: -75_000, spent: 0 });
  });
});

describe("toast phản hồi ngân sách", () => {
  it("đúng câu của DESIGN.md khi có mức tuần", () => {
    const s = { walletId: "transport", name: "Đi lại", balance: 1_000_000, weekRemaining: 950_000, monthRemaining: 1_000_000 };
    expect(entryToast(250_000, s, false)).toBe("Đã ghi 250.000 ₫. Đi lại còn 950.000 ₫ tuần này.");
  });

  it("offline: vẫn báo ví còn bao nhiêu, kèm chờ đồng bộ", () => {
    const after = applyQueue(snap, [item({ meaning: "spend", amount: 250_000, wallet_id: "transport", category_id: "ride-hailing" })]);
    const status = localWalletStatus(after, "transport", NOW);
    expect(status).toMatchObject({ weekRemaining: 50_000, balance: 750_000 });
    expect(entryToast(250_000, status, true)).toBe("Đã ghi 250.000 ₫, chờ đồng bộ. Đi lại còn 50.000 ₫ tuần này.");
  });

  it("vượt mức thì nói số âm, không làm dịu", () => {
    const s = { walletId: "food", name: "Ăn uống", balance: 100_000, weekRemaining: -40_000, monthRemaining: null };
    expect(entryToast(90_000, s, false)).toBe("Đã ghi 90.000 ₫. Ăn uống còn −40.000 ₫ tuần này.");
  });

  it("ví tháng, ví ẩn số, snapshot của tuần trước", () => {
    expect(entryToast(10_000, { walletId: "x", name: "Có thì tốt", balance: 5, weekRemaining: null, monthRemaining: 2_000_000 }, false)).toBe(
      "Đã ghi 10.000 ₫. Có thì tốt còn 2.000.000 ₫ tháng này.",
    );
    expect(entryToast(10_000, { walletId: "x", name: "Chơi (vợ)", balance: null, weekRemaining: null, monthRemaining: null }, false)).toBe(
      "Đã ghi 10.000 ₫.",
    );
    const nextWeek = new Date("2026-09-29T03:00:00Z");
    expect(localWalletStatus(snap, "transport", nextWeek)?.weekRemaining).toBeNull();
  });
});

describe("dòng 'vừa ghi' của khoản chờ đồng bộ khi hàng đợi đổi", () => {
  it("còn chờ thì giữ; bị từ chối thì xoá; lên sổ (rời hàng đợi) thì thành câu đã ghi", () => {
    const mine = item({ meaning: "spend", amount: 40_000, wallet_id: "food", category_id: "eating-out" });
    const other = item({ meaning: "spend", amount: 10_000, wallet_id: "food", category_id: "eating-out" });
    const watch = { clientId: mine.clientId, synced: "Đã ghi 40.000 ₫. Ăn uống còn 360.000 ₫ tuần này." };
    expect(queuedLineAfter([mine, other], watch)).toBeUndefined();
    expect(queuedLineAfter([{ ...mine, attempts: 2, error: { code: "network", message: "Không có mạng." } }], watch)).toBeUndefined();
    expect(queuedLineAfter([{ ...mine, status: "rejected", error: { code: "before_opening", message: "…" } }, other], watch)).toBeNull();
    // khoản khác bị từ chối không đụng tới dòng của khoản này
    expect(queuedLineAfter([mine, { ...other, status: "rejected" }], watch)).toBeUndefined();
    expect(queuedLineAfter([other], watch)).toBe(watch.synced);
  });
});
