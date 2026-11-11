// Khoản chưa đồng bộ vẫn phải hiện trong số "còn lại" (D12): trừ tạm vào ba ngăn và tiền vận hành đang hiển thị.
// Chỉ điều chỉnh theo đúng công thức của domain cho những tài khoản bị ảnh hưởng — không tính lại cả màn. Không ví (Đợt C):
// khoản chuyển trong hàng đợi không tự tick việc ngày lương, phần chưa làm (`pendingTasks`) không trừ tạm (chỉ server tick).

import { peaceMonthsView, type PocketAccountLine } from "../../../src/domain/pockets";
import { nearSpendView } from "../../../src/domain/snapshot";
import type { QueuedEntry } from "../offline/queue";
import { formatVnd, moneyDigits } from "./money";
import { nearSpendCycle } from "./near-spend";
import type { EntryNearSpend, Snapshot } from "./types";

/** Tác động của các khoản trong hàng đợi lên số dư từng tài khoản: chi trừ, hoàn cộng, chuyển nội bộ trừ bên gửi cộng bên nhận. */
function accountEffects(items: QueuedEntry[]): Map<string, number> {
  const fx = new Map<string, number>();
  const add = (accountId: string | undefined, amount: number) => {
    if (accountId) fx.set(accountId, (fx.get(accountId) ?? 0) + amount);
  };
  for (const { body: b } of items) {
    if (b.meaning === "spend") add(b.account_id, -b.amount);
    else if (b.meaning === "refund") add(b.account_id, b.amount);
    else if (b.meaning === "transfer") {
      add(b.account_id, -b.amount);
      add(b.to_account_id, b.amount);
    }
  }
  return fx;
}

/** Tiền vận hành sau khi trừ tạm: số mỗi ngày tính lại bằng `nearSpendView` dùng chung (vẫn trừ việc chưa làm). */
function shiftNearSpend(s: Snapshot, fx: Map<string, number>, amount: number): Snapshot["nearSpend"] {
  const ns = s.nearSpend;
  return {
    ...ns,
    ...nearSpendView(amount, s.day, ns.paydayDay, nearSpendCycle(ns)),
    amount,
    accounts: ns.accounts.map((a) => (fx.get(a.accountId) ? { ...a, balance: a.balance + fx.get(a.accountId)! } : a)),
  };
}

/**
 * Ba ngăn trừ / cộng tạm khoản trong hàng đợi vào số của tài khoản liên quan và tổng ngăn chứa nó (UC-704, ADR-122):
 * tiền vận hành = tổng ngăn Vận hành, số mỗi ngày tính lại; phần an tâm đổi đúng bằng khoản trên tài khoản Dự phòng không
 * gắn mục tiêu, không phải Ví Thưởng; số dư (A) của mục tiêu theo tài khoản của nó; số tháng tính lại bằng `peaceMonthsView`. Số đo theo kỳ (`savings.change`, `monthly`, `cycles`) và việc ngày lương không trừ tạm.
 */
export function applyQueue(s: Snapshot, items: QueuedEntry[]): Snapshot {
  if (items.length === 0) return s;
  const fx = accountEffects(items);
  const p = s.pockets;
  const shift = <T extends { total: number; accounts: PocketAccountLine[] }>(g: T): T => {
    let delta = 0;
    const accounts = g.accounts.map((a) => {
      const d = fx.get(a.id);
      if (!d) return a;
      delta += d;
      return { ...a, balance: a.balance + d };
    });
    return delta === 0 ? g : { ...g, total: g.total + delta, accounts };
  };
  const [savings, reserve, operating, outside] = [shift(p.savings), shift(p.reserve), shift(p.operating), shift(p.outside)];
  if (savings === p.savings && reserve === p.reserve && operating === p.operating && outside === p.outside) return s;
  const r = p.reserve;
  const rewardId = r.reward?.accountId ?? null;
  const peace = r.peace + r.accounts.filter((a) => a.goalId === null && a.id !== rewardId).reduce((sum, a) => sum + (fx.get(a.id) ?? 0), 0);
  const { monthly, target } = r.peaceMonths;
  const pockets = {
    ...p,
    savings,
    operating,
    outside,
    reserve: {
      ...reserve,
      goals: r.goals.map((g) => (g.held !== null && g.accountId && fx.get(g.accountId) ? { ...g, held: g.held + fx.get(g.accountId)! } : g)),
      peace,
      peaceMonths: { ...r.peaceMonths, covered: peaceMonthsView(peace, monthly, target).covered },
      reward: r.reward && fx.get(r.reward.accountId) ? { ...r.reward, balance: r.reward.balance + fx.get(r.reward.accountId)! } : r.reward,
    },
  };
  return { ...s, pockets, nearSpend: shiftNearSpend(s, fx, operating.total) };
}

/** Tiền vận hành cho toast khi khoản chưa lên được server: lấy từ snapshot đã trừ tạm hàng đợi (gồm khoản vừa nhập). */
export const localNearSpend = (s: Snapshot | null): EntryNearSpend | null => (s?.nearSpend ? { amount: s.nearSpend.amount, perDay: s.nearSpend.perDay } : null);

/** Dòng "vừa ghi" của khoản đang chờ đồng bộ (`watch`) sau khi hàng đợi đổi: còn chờ → `undefined` (giữ nguyên);
 *  bị server từ chối → `null` (xoá — lý do đã ở chip và thẻ Chưa lên sổ); không còn trong hàng đợi = đã lên sổ → `watch.synced`. */
export function queuedLineAfter(queue: QueuedEntry[], watch: { clientId: string; synced: string }): string | null | undefined {
  const item = queue.find((q) => q.clientId === watch.clientId);
  if (!item) return watch.synced;
  return item.status === "rejected" ? null : undefined;
}

/** Toast luôn nói kết quả kèm hệ quả (UC-703): "Đã ghi · Vận hành còn 21.000.000 ₫ ≈ 700.000/ngày". */
export function entryToast(ns: EntryNearSpend | null, queued: boolean): string {
  const head = queued ? "Đã ghi, chờ đồng bộ" : "Đã ghi";
  if (!ns) return `${head}.`;
  return `${head} · Vận hành còn ${formatVnd(ns.amount)}${ns.perDay !== null ? ` ≈ ${moneyDigits(ns.perDay)}/ngày` : ""}`;
}
