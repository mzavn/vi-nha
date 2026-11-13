// Khoản chưa đồng bộ vẫn phải hiện trong số "còn lại" (D12): trừ tạm vào ba ngăn và tiền vận hành đang hiển thị.
// Chỉ điều chỉnh theo đúng công thức của domain cho những tài khoản bị ảnh hưởng — không tính lại cả màn. Không ví (Đợt C):
// khoản chuyển trong hàng đợi không tự tick nhắc trích Tích luỹ, phần chưa chuyển (`pendingTasks`) không trừ tạm (chỉ server tick).

import { goalGroups, peaceMonthsView, type PocketAccountLine, type PocketsView } from "../../../src/domain/pockets";
import { nearSpendView, topUpView } from "../../../src/domain/snapshot";
import type { QueuedEntry } from "../offline/queue";
import { formatVnd, moneyDigits } from "./money";
import { nearSpendContext } from "./near-spend";
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

/** Khoản chi / chuyển ra trong hàng đợi có tài khoản tiền ra. */
const outflows = (items: QueuedEntry[]) => items.map((q) => q.body).filter((b) => (b.meaning === "spend" || b.meaning === "transfer") && b.account_id);

/**
 * Đã chi cho mục tiêu của các khoản chi / chuyển ra trong hàng đợi: theo `goal_id`; không gửi `goal_id` (và không "Từ tiền lãi") từ
 * tài khoản đúng một mục tiêu thì server tự gắn mục tiêu đó (pocket UC-1209 bước 11) — tính như đã gắn.
 */
function goalSpends(items: QueuedEntry[], accounts: PocketAccountLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of outflows(items)) {
    const own = accounts.find((a) => a.id === b.account_id)?.goalIds ?? [];
    const goalId = b.goal_id ?? (own.length === 1 && !b.from_interest ? own[0] : undefined);
    if (goalId) out.set(goalId, (out.get(goalId) ?? 0) + b.amount);
  }
  return out;
}

/**
 * Chia lại cho mục tiêu bằng `goalGroups` dùng chung (UC-704 AC-29, ADR-140): số dư gộp mẹ + con đã trừ tạm (`accounts`), tiền lãi
 * trừ phần "Từ tiền lãi" xếp hàng (kẹp 0 … số dư gộp), `spent` cộng khoản xếp hàng gắn mục tiêu.
 */
function refillGoals(r: PocketsView["reserve"], accounts: PocketAccountLine[], items: QueuedEntry[]): Pick<PocketsView["reserve"], "goals" | "groups"> {
  const queued = goalSpends(items, r.accounts);
  const rootOf = new Map(accounts.map((a) => [a.id, a.parentId ?? a.id]));
  const drawn = new Map<string, number>();
  for (const b of outflows(items)) {
    const root = rootOf.get(b.account_id!);
    if (b.from_interest && root) drawn.set(root, (drawn.get(root) ?? 0) + b.amount);
  }
  const interest = Object.fromEntries(
    r.groups.map((g) => {
      const gross = accounts.filter((a) => a.id === g.accountId || a.parentId === g.accountId).reduce((s, a) => s + a.balance, 0);
      return [g.accountId, Math.min(Math.max(0, (g.interest ?? 0) - (drawn.get(g.accountId) ?? 0)), Math.max(0, gross))];
    }),
  );
  // `reserve.goals` đã theo thứ tự ưu tiên của server: thứ tự trong mảng làm `sort`.
  const goals = r.goals.map((g, sort) => ({ ...g, sort, spent: g.spent + (queued.get(g.id) ?? 0) }));
  const { groups, filled } = goalGroups(accounts.map((a) => ({ ...a, parentId: a.parentId ?? null })), goals, interest);
  return { groups, goals: r.goals.map((g) => (filled.has(g.id) ? { ...g, ...filled.get(g.id)! } : g)) };
}

/**
 * Mục tiêu trả từ tiền chi tiêu sau trừ tạm (ADR-141, ADR-143): khoản xếp hàng từ tài khoản Vận hành gắn mục tiêu đó, hoặc không
 * gắn mục tiêu mà thuộc danh mục của nó (khoản chi), cộng vào đã trả; R tính lại theo số tháng này.
 */
function shiftOperatingGoals(o: PocketsView["operating"], items: QueuedEntry[]): Pick<PocketsView["operating"], "goals" | "remaining"> {
  const ids = new Set(o.accounts.map((a) => a.id));
  const byCategory = new Map((o.goals ?? []).flatMap((g) => (g.categoryIds ?? []).map((c) => [c, g.id] as const)));
  const paid = new Map<string, number>();
  for (const b of outflows(items)) {
    if (!ids.has(b.account_id!)) continue;
    const goalId = b.goal_id ?? (b.meaning === "spend" && b.category_id ? byCategory.get(b.category_id) : undefined);
    if (goalId) paid.set(goalId, (paid.get(goalId) ?? 0) + b.amount);
  }
  const goals = (o.goals ?? []).map((g) => {
    const spent = g.spent + (paid.get(g.id) ?? 0);
    return spent === g.spent ? g : { ...g, spent, remaining: Math.max(0, (g.monthAmount ?? g.monthly) - spent) };
  });
  return { goals, remaining: goals.reduce((s, g) => s + g.remaining, 0) };
}

/**
 * Ba ngăn trừ / cộng tạm khoản trong hàng đợi vào số của tài khoản liên quan và tổng ngăn chứa nó (UC-704, ADR-122, ADR-140,
 * ADR-141): tiền vận hành = tổng ngăn Vận hành; R giảm theo khoản xếp hàng gắn mục tiêu trả từ tiền chi tiêu; số mỗi ngày tính lại
 * bằng `nearSpendView`; phần an tâm đổi đúng bằng khoản trên tài khoản Dự phòng không gắn mục tiêu, không phải Ví Thưởng, không phải
 * con của tài khoản có mục tiêu hay của Ví Thưởng; đã có (A) của mục tiêu chia lại bằng `goalGroups`; số tháng tính lại bằng
 * `peaceMonthsView`; nhắc chuyển thêm tính lại bằng `topUpView` (giữ đích QR của server; không gợi ý tài khoản riêng tư của người
 * khác — `hidden`, từ `accounts[].hiddenFromMe` ở bootstrap, access UC-504). Số đo theo tháng (`savings.change`, `monthly`, `months`)
 * và việc tháng (nhắc trích, chia dư — `pendingTasks`) không trừ tạm.
 */
export function applyQueue(s: Snapshot, items: QueuedEntry[], hidden: readonly string[] = []): Snapshot {
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
  const [savings, reserve, shiftedOperating, outside] = [shift(p.savings), shift(p.reserve), shift(p.operating), shift(p.outside)];
  if (savings === p.savings && reserve === p.reserve && shiftedOperating === p.operating && outside === p.outside) return s;
  const operating = { ...shiftedOperating, ...shiftOperatingGoals(shiftedOperating, items) };
  const r = p.reserve;
  const rewardId = r.reward?.accountId ?? null;
  const goalRoots = new Set(r.groups.map((g) => g.accountId));
  const owner = (a: PocketAccountLine) => a.parentId ?? a.id;
  const moved = (keep: (a: PocketAccountLine) => boolean) => r.accounts.filter(keep).reduce((sum, a) => sum + (fx.get(a.id) ?? 0), 0);
  const peace = r.peace + moved((a) => a.goalIds.length === 0 && !goalRoots.has(owner(a)) && owner(a) !== rewardId);
  const rewardDelta = rewardId === null ? 0 : moved((a) => owner(a) === rewardId);
  const { monthly, target } = r.peaceMonths;
  const pockets = {
    ...p,
    savings,
    operating,
    outside,
    reserve: {
      ...reserve,
      ...refillGoals(r, reserve.accounts, items),
      peace,
      peaceMonths: { ...r.peaceMonths, covered: peaceMonthsView(peace, monthly, target).covered },
      reward: r.reward && rewardDelta ? { ...r.reward, balance: r.reward.balance + rewardDelta } : r.reward,
    },
  };
  const ns = s.nearSpend;
  const ctx = { ...nearSpendContext(ns), goalRemaining: operating.remaining };
  const view = nearSpendView(operating.total, s.day, ns.paydayDay, ctx);
  const nearSpend = {
    ...ns,
    ...view,
    amount: operating.total,
    accounts: ns.accounts.map((a) => (fx.get(a.accountId) ? { ...a, balance: a.balance + fx.get(a.accountId)! } : a)),
  };
  const topUp = topUpView({
    amount: operating.total,
    pendingTasks: ctx.pendingTasks,
    month: s.month,
    goalRemaining: operating.remaining,
    pockets,
    // Đích của server đã bỏ tài khoản bị giấu; giữ lại phép thử phòng bản lưu cũ trên máy (access UC-504 AC-19).
    target: s.topUp?.target && !hidden.includes(s.topUp.target.accountId) ? s.topUp.target : null,
    hidden,
  });
  return { ...s, pockets, nearSpend, topUp };
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
  const head = queued ? "Đã ghi, chờ gửi" : "Đã ghi";
  if (!ns) return `${head}.`;
  return `${head} · Vận hành còn ${formatVnd(ns.amount)}${ns.perDay !== null ? ` ≈ ${moneyDigits(ns.perDay)}/ngày` : ""}`;
}
