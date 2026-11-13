import { describe, expect, it } from "vitest";
import { pocketsView } from "../../../src/domain/pockets";
import { topUpView } from "../../../src/domain/snapshot";
import type { QueuedEntry } from "../offline/queue";
import { nearSpendB, nearSpendV23, pocketsB, pocketsShared, pocketsV23, TOP_UP_TARGET } from "./household-b.fixture";
import { applyQueue, entryToast, localNearSpend, queuedLineAfter } from "./pending";
import type { EntryBody, Snapshot } from "./types";

const NBSP = "\u00a0";
const NOW = new Date("2026-11-11T03:00:00Z");

/** Snapshot tối thiểu cho phần trừ tạm: chỉ các trường `applyQueue` đọc. */
const snapOf = (day: string, pockets: Snapshot["pockets"], nearSpend: Snapshot["nearSpend"], month: Snapshot["month"] | null = null, topUp: Snapshot["topUp"] = null) =>
  ({ day, pockets, nearSpend, month, topUp }) as unknown as Snapshot;

let seq = 0;
const item = (body: Partial<EntryBody> & Pick<EntryBody, "meaning" | "amount">): QueuedEntry => {
  const clientId = `client-${++seq}`;
  return { clientId, memberId: "husband", createdAt: NOW.toISOString(), status: "pending", attempts: 0, body: { at: NOW.toISOString(), client_id: clientId, ...body } };
};

describe("trừ tạm khoản chưa đồng bộ vào số đang hiển thị", () => {
  const snapB = snapOf("2026-11-11", pocketsB(), nearSpendB());

  it("không có gì trong hàng đợi thì giữ nguyên số của server", () => {
    expect(applyQueue(snapB, [])).toBe(snapB);
  });

  it("UC-704 bước 7a: hàng đợi chi 200.000 từ tài khoản chính và chuyển nội bộ 500.000 sang tài khoản tích luỹ → Vận hành 3.400.000, 117.000/ngày, Tích luỹ 7.000.000, tháng này vẫn +800.000; chi 200.000 từ tài khoản tiết kiệm → phần an tâm 31.300.000, đủ 3,1 tháng; chi 500.000 từ tài khoản học phí → Học phí đã có 3.500.000, phần an tâm không đổi", () => {
    expect(snapB.nearSpend).toMatchObject({ amount: 4_100_000, daysLeft: 29, perDay: 141_000 });
    const after = applyQueue(snapB, [
      item({ meaning: "spend", amount: 200_000, category_id: "groceries", account_id: "main" }),
      item({ meaning: "transfer", amount: 500_000, account_id: "main", to_account_id: "wealth" }),
    ]);
    expect(after.nearSpend).toMatchObject({ amount: 3_400_000, daysLeft: 29, perDay: 117_000 });
    expect(after.pockets.operating.total).toBe(3_400_000);
    expect(after.nearSpend.accounts.find((a) => a.accountId === "main")!.balance).toBe(2_300_000);
    expect(after.pockets.savings).toMatchObject({ total: 7_000_000, change: { amount: 800_000, prevAmount: 700_000 } });
    const reserve = applyQueue(snapB, [item({ meaning: "spend", amount: 200_000, category_id: "groceries", account_id: "saving" })]).pockets.reserve;
    expect(reserve).toMatchObject({ total: 37_800_000, peace: 31_300_000, peaceMonths: { covered: 3.1, monthly: 10_000_000, months: 3 } });
    const goal = applyQueue(snapB, [item({ meaning: "spend", amount: 500_000, category_id: "school", account_id: "tuition-acc" })]).pockets.reserve;
    expect(goal).toMatchObject({ total: 37_500_000, peace: 31_500_000 });
    expect(goal.goals.find((g) => g.id === "tuition")!.held).toBe(3_500_000);
  });

  it("UC-704 AC-29: MB tiết kiệm 12.000.000 chung Nhà ở / Học tập; xếp hàng chi 7.500.000 gắn Nhà ở → Nhà ở đã có 0 + đã chi 7.500.000 (đủ), Học tập 4.500.000; thêm chi 1.000.000 không gắn → Học tập 3.500.000; Σ đã có = số dư đã trừ tạm", () => {
    const snap = snapOf("2026-11-11", pocketsShared(), nearSpendB());
    const goalOf = (s: Snapshot, id: string) => s.pockets.reserve.goals.find((g) => g.id === id)!;
    const group = (s: Snapshot) => s.pockets.reserve.groups.find((g) => g.accountId === "tk-tiet-kiem")!;
    const paid = item({ meaning: "spend", amount: 7_500_000, category_id: "rent", account_id: "tk-tiet-kiem", goal_id: "nha-o" });
    const one = applyQueue(snap, [paid]);
    expect(goalOf(one, "nha-o")).toMatchObject({ held: 0, spent: 7_500_000, short: 0 });
    expect(goalOf(one, "hoc-tap")).toMatchObject({ held: 4_500_000, spent: 0, short: 1_500_000 });
    expect(group(one)).toMatchObject({ balance: 4_500_000, spent: 7_500_000, short: 1_500_000 });
    const two = applyQueue(snap, [paid, item({ meaning: "spend", amount: 1_000_000, category_id: "food", account_id: "tk-tiet-kiem" })]);
    expect(goalOf(two, "nha-o")).toMatchObject({ held: 0, spent: 7_500_000 });
    expect(goalOf(two, "hoc-tap")).toMatchObject({ held: 3_500_000, short: 2_500_000 });
    expect(goalOf(two, "nha-o").held! + goalOf(two, "hoc-tap").held!).toBe(3_500_000);
    expect(group(two)).toMatchObject({ balance: 3_500_000, short: 2_500_000 });
    expect(two.pockets.reserve.peace).toBe(5_000_000);
    expect(goalOf(two, "hoa-don")).toMatchObject({ held: 2_000_000, spent: 0 });
  });

  it("UC-103 AC-26: lương về sớm (salaryPayday 10/12), hôm nay 4/12, nhắc chưa chuyển 6.160.000, hàng đợi chi 370.000 → 'Chi khoảng 396.000/ngày' (nearSpendView, vẫn trừ nhắc chưa chuyển, còn 37 ngày); chuyển sang tích luỹ trong hàng đợi không tự tick, phần chưa chuyển không trừ tạm", () => {
    const p = pocketsView({
      accounts: [
        { id: "main", name: "tài khoản chính", pocket: "operating", confirmed: true, balance: 21_200_000 },
        { id: "wealth", name: "tài khoản tích luỹ", pocket: "savings", confirmed: true, balance: 6_000_000 },
      ],
      goals: [],
      rewardAccountId: null,
      debts: [],
      savingsPct: 10,
      history: { since: "2026-12-01", prevSince: "2026-11-01", accounts: [] },
      operatingSpend: { months: [], dataStart: null },
      peaceTarget: 6,
    });
    const ctx = { salaryPayday: "2026-12-10", pendingTasks: 6_160_000 };
    const month = { key: "2026-12", openCount: 1 } as Snapshot["month"];
    const s = snapOf("2026-12-04", p, nearSpendB(p, "2026-12-04", ctx), month);
    expect(s.nearSpend).toMatchObject({ amount: 21_200_000, daysLeft: 37, perDay: 406_000 });
    const after = applyQueue(s, [item({ meaning: "spend", amount: 370_000, category_id: "groceries", account_id: "main" })]);
    expect(after.nearSpend).toMatchObject({ amount: 20_830_000, daysLeft: 37, perDay: 396_000, pendingTasks: 6_160_000, salaryPayday: "2026-12-10" });
    const moved = applyQueue(s, [item({ meaning: "transfer", amount: 2_000_000, account_id: "main", to_account_id: "wealth" })]);
    expect(moved.month).toBe(month);
    expect(moved.nearSpend).toMatchObject({ amount: 19_200_000, pendingTasks: 6_160_000 });
  });

  it("UC-704 AC-27: khoản cũ trong hàng đợi chỉ giữa hai ví (không tài khoản) không đổi số nào", () => {
    const legacy = item({ meaning: "transfer", amount: 500_000 });
    expect(applyQueue(snapB, [legacy])).toBe(snapB);
  });

  it("UC-704 bước 7a: trừ tạm theo nhóm mẹ + con — chi 15.000.000 từ 'Gửi 6 tháng' gắn Nhà ở → nhóm MB tiết kiệm 90.000.000, Nhà ở đã có 45.000.000 + đã chi 15.000.000; chuyển nội bộ mẹ → con không đổi mục tiêu; sau đáo hạn chi 1.000.000 không chọn → Tập luyện 14.000.000, 'Từ tiền lãi' → tiền lãi 2.000.000, mục tiêu không đổi; chi từ con của Phao trừ phần an tâm, từ con của tài khoản có mục tiêu / Ví Thưởng thì không", () => {
    const p = pocketsV23();
    const snap = snapOf("2026-11-20", p, nearSpendV23(p));
    const goalOf = (s: Snapshot, id: string) => s.pockets.reserve.goals.find((g) => g.id === id)!;
    const group = (s: Snapshot) => s.pockets.reserve.groups.find((g) => g.accountId === "tk-tiet-kiem")!;
    const paid = applyQueue(snap, [item({ meaning: "spend", amount: 15_000_000, category_id: "housing", account_id: "gui-6-thang", goal_id: "nha-o" })]);
    expect(group(paid)).toMatchObject({ balance: 90_000_000, spent: 15_000_000, interest: 0, childIds: ["gui-6-thang"] });
    expect(goalOf(paid, "nha-o")).toMatchObject({ held: 45_000_000, spent: 15_000_000, short: 0 });
    expect([goalOf(paid, "hoc-tap").held, goalOf(paid, "tap-luyen").held]).toEqual([30_000_000, 15_000_000]);
    expect(paid.pockets.reserve.peace).toBe(24_000_000);
    const inside = applyQueue(snap, [item({ meaning: "transfer", amount: 5_000_000, account_id: "tk-tiet-kiem", to_account_id: "gui-6-thang" })]);
    expect(group(inside).balance).toBe(105_000_000);
    expect(goalOf(inside, "tap-luyen").held).toBe(15_000_000);

    const m = pocketsV23({ matured: true });
    const matured = snapOf("2026-11-20", m, nearSpendV23(m));
    const plain = applyQueue(matured, [item({ meaning: "spend", amount: 1_000_000, category_id: "food", account_id: "tk-tiet-kiem" })]);
    expect(group(plain)).toMatchObject({ balance: 107_000_000, interest: 3_000_000 });
    expect(goalOf(plain, "tap-luyen").held).toBe(14_000_000);
    const fromInterest = applyQueue(matured, [item({ meaning: "spend", amount: 1_000_000, category_id: "food", account_id: "tk-tiet-kiem", from_interest: true })]);
    expect(group(fromInterest)).toMatchObject({ balance: 107_000_000, interest: 2_000_000 });
    expect(goalOf(fromInterest, "tap-luyen").held).toBe(15_000_000);

    const peaceOf = (accountId: string) => applyQueue(snap, [item({ meaning: "spend", amount: 1_000_000, category_id: "food", account_id: accountId })]).pockets.reserve;
    expect(peaceOf("gui-3-thang").peace).toBe(23_000_000);
    expect(peaceOf("gui-6-thang").peace).toBe(24_000_000);
    expect(peaceOf("tk-bidv")).toMatchObject({ peace: 24_000_000, reward: { accountId: "tk-bidv", balance: 1_000_000 } });
  });

  it("UC-704 bước 7a: khoản xếp hàng gắn mục tiêu trả từ tiền chi tiêu giảm R — chi 1.000.000 từ tiền mặt gắn Điện nước → Vận hành 14.000.000, R 2.500.000, vẫn 575.000/ngày, Điện nước đã trả 2.000.000; chi chợ 200.000 không gắn → 565.000/ngày; goal_id của mục tiêu tài khoản không đụng R", () => {
    const p = pocketsV23();
    const snap = snapOf("2026-11-20", p, nearSpendV23(p));
    expect(snap.nearSpend).toMatchObject({ amount: 15_000_000, daysLeft: 20, perDay: 575_000, goalRemaining: 3_500_000 });
    const bill = item({ meaning: "spend", amount: 1_000_000, category_id: "utilities", account_id: "tien-mat", goal_id: "dien-nuoc" });
    const one = applyQueue(snap, [bill]);
    expect(one.nearSpend).toMatchObject({ amount: 14_000_000, perDay: 575_000, goalRemaining: 2_500_000 });
    expect(one.pockets.operating.remaining).toBe(2_500_000);
    expect(one.pockets.operating.goals.find((g) => g.id === "dien-nuoc")).toEqual({ id: "dien-nuoc", name: "Điện nước", monthly: 2_000_000, monthAmount: null, note: null, categoryIds: [], spent: 2_000_000, remaining: 0 });
    const two = applyQueue(snap, [bill, item({ meaning: "spend", amount: 200_000, category_id: "groceries", account_id: "tien-mat" })]);
    expect(two.nearSpend).toMatchObject({ amount: 13_800_000, perDay: 565_000, goalRemaining: 2_500_000 });
    expect(entryToast(localNearSpend(two), true)).toBe(`Đã ghi, chờ gửi · Vận hành còn 13.800.000${NBSP}₫ ≈ 565.000/ngày`);
    const over = applyQueue(snap, [item({ meaning: "spend", amount: 3_000_000, category_id: "utilities", account_id: "tk-chi-tieu-vo", goal_id: "dien-nuoc" })]);
    expect(over.pockets.operating.goals[0]).toMatchObject({ spent: 4_000_000, remaining: 0 });
    expect(over.nearSpend.goalRemaining).toBe(2_500_000);
    const account = applyQueue(snap, [item({ meaning: "spend", amount: 1_000_000, category_id: "housing", account_id: "tk-tiet-kiem", goal_id: "nha-o" })]);
    expect(account.pockets.operating.remaining).toBe(3_500_000);
  });

  it("UC-704 bước 7a: nhắc chuyển thêm tính lại sau trừ tạm bằng topUpView, giữ đích của server — Vận hành 1.000.000, R 3.500.000 → cần 2.500.000; chi thêm 1.000.000 → cần 3.500.000 (BIDV 2.000.000, Phao 1.500.000); chuyển 2.000.000 từ BIDV và 500.000 từ Phao vào tài khoản chi tiêu → hết nhắc; server không nhắc mà hàng đợi làm thiếu → nhắc không đích", () => {
    const p = pocketsV23({ operating: [{ id: "tk-chi-tieu-chong", name: "MB chi tiêu chồng", balance: 1_000_000 }] });
    const ns = nearSpendV23(p);
    const server = topUpView({ amount: ns.amount, pendingTasks: 0, month: null, goalRemaining: p.operating.remaining, pockets: p, target: TOP_UP_TARGET });
    expect(server).toMatchObject({ amount: 2_500_000 });
    const snap = snapOf("2026-11-20", p, ns, null, server);
    const more = applyQueue(snap, [item({ meaning: "spend", amount: 1_000_000, category_id: "groceries", account_id: "tk-chi-tieu-chong" })]);
    expect(more.topUp).toEqual({
      amount: 3_500_000,
      sources: [
        { accountId: "tk-bidv", name: "BIDV", amount: 2_000_000 },
        { accountId: "phao", name: "Phao", amount: 1_500_000 },
      ],
      toAccountId: "tk-chi-tieu-chong",
      target: TOP_UP_TARGET,
    });
    const moved = applyQueue(snap, [
      item({ meaning: "transfer", amount: 2_000_000, account_id: "tk-bidv", to_account_id: "tk-chi-tieu-chong" }),
      item({ meaning: "transfer", amount: 500_000, account_id: "phao", to_account_id: "tk-chi-tieu-chong" }),
    ]);
    expect(moved.topUp).toBeNull();
    const rich = pocketsV23({ operating: [{ id: "tk-chi-tieu-chong", name: "MB chi tiêu chồng", balance: 3_500_000 }] });
    const noNudge = snapOf("2026-11-20", rich, nearSpendV23(rich), null, null);
    expect(applyQueue(noNudge, [item({ meaning: "spend", amount: 1_000_000, category_id: "groceries", account_id: "tk-chi-tieu-chong" })]).topUp).toMatchObject({ amount: 1_000_000, toAccountId: null, target: null });
  });

  it("UC-504 AC-19: BIDV riêng tư của người khác (hiddenFromMe) → nhắc chuyển thêm tính lại sau trừ tạm chỉ gợi ý Phao, không BIDV; đích bị giấu → không đích, không QR", () => {
    const p = pocketsV23({ operating: [{ id: "tk-chi-tieu-chong", name: "MB chi tiêu chồng", balance: 1_000_000 }] });
    const ns = nearSpendV23(p);
    const server = topUpView({ amount: ns.amount, pendingTasks: 0, month: null, goalRemaining: p.operating.remaining, pockets: p, target: TOP_UP_TARGET, hidden: ["tk-bidv"] });
    expect(server!.sources).toEqual([{ accountId: "phao", name: "Phao", amount: 2_500_000 }]);
    const more = applyQueue(snapOf("2026-11-20", p, ns, null, server), [item({ meaning: "spend", amount: 1_000_000, category_id: "groceries", account_id: "tk-chi-tieu-chong" })], ["tk-bidv"]);
    expect(more.topUp).toMatchObject({ amount: 3_500_000, sources: [{ accountId: "phao", name: "Phao", amount: 3_500_000 }] });
    const hiddenTarget = applyQueue(snapOf("2026-11-20", p, ns, null, server), [item({ meaning: "spend", amount: 1_000_000, category_id: "groceries", account_id: "tk-chi-tieu-chong" })], ["tk-bidv", TOP_UP_TARGET.accountId]);
    expect(hiddenTarget.topUp).toMatchObject({ amount: 3_500_000, toAccountId: null, target: null });
  });
});

describe("toast sau khi ghi (pwa UC-703)", () => {
  it("UC-703 AC-14: server trả nearSpend → 'Đã ghi · Vận hành còn 21.000.000 ₫ ≈ 700.000/ngày'; hết tiền → không có phần mỗi ngày; không biết → 'Đã ghi.'", () => {
    expect(entryToast({ amount: 21_000_000, perDay: 700_000 }, false)).toBe(`Đã ghi · Vận hành còn 21.000.000${NBSP}₫ ≈ 700.000/ngày`);
    expect(entryToast({ amount: -50_000, perDay: null }, false)).toBe(`Đã ghi · Vận hành còn −50.000${NBSP}₫`);
    expect(entryToast(null, false)).toBe("Đã ghi.");
  });

  it("UC-703 AC-5: offline → toast theo Vận hành đã trừ tạm khoản vừa nhập, kèm chờ gửi", () => {
    const view = applyQueue(snapOf("2026-11-11", pocketsB(), nearSpendB()), [item({ meaning: "spend", amount: 200_000, category_id: "groceries", account_id: "main" })]);
    expect(entryToast(localNearSpend(view), true)).toBe(`Đã ghi, chờ gửi · Vận hành còn 3.900.000${NBSP}₫ ≈ 134.000/ngày`);
    expect(localNearSpend(null)).toBeNull();
  });
});

describe("dòng 'vừa ghi' của khoản chờ đồng bộ khi hàng đợi đổi", () => {
  it("còn chờ thì giữ; bị từ chối thì xoá; lên sổ (rời hàng đợi) thì thành câu đã ghi", () => {
    const mine = item({ meaning: "spend", amount: 40_000, category_id: "eating-out" });
    const other = item({ meaning: "spend", amount: 10_000, category_id: "eating-out" });
    const watch = { clientId: mine.clientId, synced: "Đã ghi · Vận hành còn 360.000 ₫" };
    expect(queuedLineAfter([mine, other], watch)).toBeUndefined();
    expect(queuedLineAfter([{ ...mine, attempts: 2, error: { code: "network", message: "Không có mạng." } }], watch)).toBeUndefined();
    expect(queuedLineAfter([{ ...mine, status: "rejected", error: { code: "before_opening", message: "…" } }, other], watch)).toBeNull();
    // khoản khác bị từ chối không đụng tới dòng của khoản này
    expect(queuedLineAfter([mine, { ...other, status: "rejected" }], watch)).toBeUndefined();
    expect(queuedLineAfter([other], watch)).toBe(watch.synced);
  });
});
