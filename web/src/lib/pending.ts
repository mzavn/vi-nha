// Khoản chưa đồng bộ vẫn phải hiện trong số "còn lại" (D12): trừ tạm vào snapshot / bảng ngân sách đang hiển thị.
// Chỉ điều chỉnh theo đúng công thức của domain/snapshot.ts cho những ví bị ảnh hưởng — không tính lại cả màn.

import type { QueuedEntry } from "../offline/queue";
import { formatVnd } from "./money";
import { monthKey, weekKey } from "./period";
import type { Budget, Snapshot, WalletStatus } from "./types";

type Line = Snapshot["wallets"][number];
interface Effect {
  balance: number;
  spentWeek: number;
  spentMonth: number;
}

/** Tác động của các khoản trong hàng đợi lên từng ví, trong tuần / tháng cho trước. Khớp v_wallet_flow và v_spent_raw. */
export function effectsOf(items: QueuedEntry[], week: string, month: string): Map<string, Effect> {
  const fx = new Map<string, Effect>();
  const add = (walletId: string | undefined, balance: number, spent: number, at: string) => {
    if (!walletId) return;
    const e = fx.get(walletId) ?? { balance: 0, spentWeek: 0, spentMonth: 0 };
    e.balance += balance;
    if (weekKey(at) === week) e.spentWeek += spent;
    if (monthKey(at) === month) e.spentMonth += spent;
    fx.set(walletId, e);
  };
  for (const { body: b } of items) {
    if (b.meaning === "spend") add(b.wallet_id, -b.amount, b.amount, b.at);
    else if (b.meaning === "refund") add(b.wallet_id, b.amount, -b.amount, b.at);
    else if (b.meaning === "transfer" && b.wallet_id && b.from_wallet_id) {
      add(b.wallet_id, b.amount, 0, b.at);
      add(b.from_wallet_id, -b.amount, 0, b.at);
    }
  }
  return fx;
}

/** Phần "còn để chi tuần này" của một ví — cùng công thức với buildSnapshot. */
export function spendableAmount(l: Line, weeksLeft: number): number {
  const balance = l.balance ?? 0;
  if (l.weekTarget !== null) return Math.min(l.weekTarget - (l.spentWeek ?? 0), balance);
  return balance <= 0 ? balance : Math.floor(balance / weeksLeft);
}

function tierKey(l: Line): keyof Snapshot["tiers"] | null {
  if (l.tier === "wealth_building" || l.tier === "tax" || l.tier === "nice") return l.tier;
  if (l.tier === "must") return l.mustGroup === "have" ? "have" : "must";
  return null;
}

export function applyQueue(s: Snapshot, items: QueuedEntry[]): Snapshot {
  if (items.length === 0) return s;
  const fx = effectsOf(items, s.week.key, s.month);
  if (fx.size === 0) return s;

  const tiers = structuredClone(s.tiers);
  const wallets = s.wallets.map((l) => {
    const e = fx.get(l.id);
    if (!e || l.balance === null) return l;
    const key = tierKey(l);
    if (key) tiers[key].balance += e.balance;
    return {
      ...l,
      balance: l.balance + e.balance,
      spentWeek: l.spentWeek === null ? null : l.spentWeek + e.spentWeek,
      spentMonth: l.spentMonth === null ? null : l.spentMonth + e.spentMonth,
    };
  });

  let delta = 0;
  const spendableByWallet = s.spendableByWallet.map((p) => {
    const line = wallets.find((l) => l.id === p.walletId);
    if (!line || !fx.has(p.walletId)) return p;
    const amount = spendableAmount(line, s.week.weeksLeftInMonth);
    delta += amount - p.amount;
    return { ...p, amount };
  });

  return { ...s, wallets, tiers, spendableByWallet, spendableThisWeek: s.spendableThisWeek + delta };
}

/** Bảng ngân sách một kỳ, cộng thêm các khoản chưa đồng bộ rơi vào kỳ đó. */
export function applyQueueToBudget(b: Budget, items: QueuedEntry[]): Budget {
  const fx = effectsOf(items, b.kind === "week" ? b.period : "", b.kind === "month" ? b.period : "");
  if (fx.size === 0) return b;
  return {
    ...b,
    lines: b.lines.map((l) => {
      const e = fx.get(l.walletId);
      if (!e) return l;
      const spent = b.kind === "week" ? e.spentWeek : e.spentMonth;
      const balance = l.balance === undefined || l.balance === null ? l.balance : l.balance + e.balance;
      if (l.spent === null) return { ...l, balance };
      return { ...l, balance, spent: l.spent + spent, remaining: l.remaining === null ? null : l.remaining - spent };
    }),
  };
}

/**
 * Ví này còn bao nhiêu, tính từ snapshot đã trừ tạm hàng đợi — dùng khi khoản vừa nhập chưa lên được server.
 * Snapshot cũ từ tuần / tháng trước thì không dùng số tuần / tháng của nó.
 */
export function localWalletStatus(s: Snapshot, walletId: string, now: Date): WalletStatus | null {
  const l = s.wallets.find((w) => w.id === walletId);
  if (!l) return null;
  if (l.balance === null) return { walletId, name: l.name, balance: null, weekRemaining: null, monthRemaining: null };
  const sameWeek = s.week.key === weekKey(now);
  const sameMonth = s.month === monthKey(now);
  return {
    walletId,
    name: l.name,
    balance: l.balance,
    weekRemaining: sameWeek && l.weekTarget !== null ? Math.min(l.weekTarget - (l.spentWeek ?? 0), l.balance) : null,
    monthRemaining: sameMonth && l.monthTarget !== null ? l.monthTarget - (l.spentMonth ?? 0) : null,
  };
}

/** Hệ quả lên ví sau khi ghi / sửa / xoá: "Đi lại còn 950.000 ₫ tuần này." — rỗng khi ví ẩn số hoặc không biết. */
export function walletRemain(status: WalletStatus | null): string {
  if (!status || status.balance === null) return "";
  if (status.weekRemaining !== null) return `${status.name} còn ${formatVnd(status.weekRemaining)} tuần này.`;
  if (status.monthRemaining !== null) return `${status.name} còn ${formatVnd(status.monthRemaining)} tháng này.`;
  return `${status.name} còn ${formatVnd(status.balance)}.`;
}

/** Hệ quả của một lần chia: "Còn N lệnh chuyển tiền cần làm." với N là **tổng** lệnh đang chờ (snapshot vừa tải lại, cùng
 *  số ở Hôm nay); chưa tải lại được tổng (null) thì "Có thêm N lệnh…" theo số lệnh lần chia này vừa sinh; không có thì rỗng. */
export function ordersLeft(newOrders: number, pendingOrders: number | null): string {
  if (pendingOrders !== null) return pendingOrders > 0 ? `Còn ${pendingOrders} lệnh chuyển tiền cần làm.` : "";
  return newOrders > 0 ? `Có thêm ${newOrders} lệnh chuyển tiền cần làm.` : "";
}

/** Dòng "vừa ghi" của khoản đang chờ đồng bộ (`watch`) sau khi hàng đợi đổi: còn chờ → `undefined` (giữ nguyên);
 *  bị server từ chối → `null` (xoá — lý do đã ở chip và thẻ Chưa lên sổ); không còn trong hàng đợi = đã lên sổ → `watch.synced`. */
export function queuedLineAfter(queue: QueuedEntry[], watch: { clientId: string; synced: string }): string | null | undefined {
  const item = queue.find((q) => q.clientId === watch.clientId);
  if (!item) return watch.synced;
  return item.status === "rejected" ? null : undefined;
}

/** Toast luôn nói kết quả kèm hệ quả (DESIGN.md §4): "Đã ghi 250.000 ₫. Đi lại còn 950.000 ₫ tuần này." */
export function entryToast(amount: number, status: WalletStatus | null, queued: boolean): string {
  const head = `Đã ghi ${formatVnd(amount)}${queued ? ", chờ đồng bộ." : "."}`;
  const tail = walletRemain(status);
  return tail ? `${head} ${tail}` : head;
}
