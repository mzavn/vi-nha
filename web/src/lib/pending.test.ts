import { describe, expect, it } from "vitest";
import { pocketsView } from "../../../src/domain/pockets";
import type { QueuedEntry } from "../offline/queue";
import { nearSpendB, pocketsB } from "./household-b.fixture";
import { applyQueue, entryToast, localNearSpend, queuedLineAfter } from "./pending";
import type { EntryBody, Snapshot } from "./types";

const NBSP = "\u00a0";
const NOW = new Date("2026-11-11T03:00:00Z");

/** Snapshot tối thiểu cho phần trừ tạm: chỉ các trường `applyQueue` đọc. */
const snapOf = (day: string, pockets: Snapshot["pockets"], nearSpend: Snapshot["nearSpend"], payCycle: Snapshot["payCycle"] = null) =>
  ({ day, pockets, nearSpend, payCycle }) as unknown as Snapshot;

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

  it("UC-704 bước 7a: hàng đợi chi 200.000 từ tài khoản chính và chuyển nội bộ 500.000 sang tài khoản tích luỹ → Vận hành 3.400.000, 117.000/ngày, Tích luỹ 7.000.000, kỳ này vẫn +800.000; chi 200.000 từ tài khoản tiết kiệm → phần an tâm 31.300.000, đủ 3,1 tháng; chi 500.000 từ tài khoản học phí → Học phí đã có 3.500.000, phần an tâm không đổi", () => {
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
    expect(reserve).toMatchObject({ total: 37_800_000, peace: 31_300_000, peaceMonths: { covered: 3.1, monthly: 10_000_000, cycles: 3 } });
    const goal = applyQueue(snapB, [item({ meaning: "spend", amount: 500_000, category_id: "school", account_id: "tuition-acc" })]).pockets.reserve;
    expect(goal).toMatchObject({ total: 37_500_000, peace: 31_500_000 });
    expect(goal.goals.find((g) => g.id === "tuition")!.held).toBe(3_500_000);
  });

  it("UC-702 AC-25: lương về sớm (kỳ 10/12), hôm nay 4/12, hàng đợi chi 370.000 → 'Chi khoảng 396.000/ngày' (nearSpendView, vẫn trừ việc chưa làm); chuyển sang tích luỹ trong hàng đợi không tự tick, phần chưa làm không trừ tạm", () => {
    const p = pocketsView({
      accounts: [
        { id: "main", name: "tài khoản chính", pocket: "operating", confirmed: true, balance: 21_200_000 },
        { id: "wealth", name: "tài khoản tích luỹ", pocket: "savings", confirmed: true, balance: 6_000_000 },
      ],
      goals: [],
      rewardAccountId: null,
      debts: [],
      savingsPct: 10,
      history: { since: "2026-12-10", prevSince: "2026-11-10", accounts: [] },
      operatingSpend: { cycles: [], dataStart: null },
      peaceTarget: 6,
    });
    const cycle = { cyclePayday: "2026-12-10", pendingTasks: 6_160_000 };
    const payCycle = { id: 3, openCount: 5 } as Snapshot["payCycle"];
    const s = snapOf("2026-12-04", p, nearSpendB(p, "2026-12-04", cycle), payCycle);
    expect(s.nearSpend).toMatchObject({ amount: 21_200_000, daysLeft: 37, perDay: 406_000 });
    const after = applyQueue(s, [item({ meaning: "spend", amount: 370_000, category_id: "groceries", account_id: "main" })]);
    expect(after.nearSpend).toMatchObject({ amount: 20_830_000, daysLeft: 37, perDay: 396_000, pendingTasks: 6_160_000, cyclePayday: "2026-12-10" });
    const moved = applyQueue(s, [item({ meaning: "transfer", amount: 2_000_000, account_id: "main", to_account_id: "wealth" })]);
    expect(moved.payCycle).toBe(payCycle);
    expect(moved.nearSpend).toMatchObject({ amount: 19_200_000, pendingTasks: 6_160_000 });
  });

  it("UC-704 AC-27: khoản cũ trong hàng đợi chỉ giữa hai ví (không tài khoản) không đổi số nào", () => {
    const legacy = item({ meaning: "transfer", amount: 500_000 });
    expect(applyQueue(snapB, [legacy])).toBe(snapB);
  });
});

describe("toast sau khi ghi (pwa UC-703)", () => {
  it("UC-703 AC-14: server trả nearSpend → 'Đã ghi · Vận hành còn 21.000.000 ₫ ≈ 700.000/ngày'; hết tiền → không có phần mỗi ngày; không biết → 'Đã ghi.'", () => {
    expect(entryToast({ amount: 21_000_000, perDay: 700_000 }, false)).toBe(`Đã ghi · Vận hành còn 21.000.000${NBSP}₫ ≈ 700.000/ngày`);
    expect(entryToast({ amount: -50_000, perDay: null }, false)).toBe(`Đã ghi · Vận hành còn −50.000${NBSP}₫`);
    expect(entryToast(null, false)).toBe("Đã ghi.");
  });

  it("UC-703 AC-5: offline → toast theo Vận hành đã trừ tạm khoản vừa nhập, kèm chờ đồng bộ", () => {
    const view = applyQueue(snapOf("2026-11-11", pocketsB(), nearSpendB()), [item({ meaning: "spend", amount: 200_000, category_id: "groceries", account_id: "main" })]);
    expect(entryToast(localNearSpend(view), true)).toBe(`Đã ghi, chờ đồng bộ · Vận hành còn 3.900.000${NBSP}₫ ≈ 134.000/ngày`);
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
