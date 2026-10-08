// Ngân sách: dòng tổng và chuyển ngân sách giữa các ví (kể cả "Bù" ví âm).
// Thuần, không đụng DOM hay mạng.

import { isIncomeHolding } from "../../../src/domain/types";
import type { BudgetLine, Wallet } from "./types";

export { isIncomeHolding };

export interface BudgetTotals {
  target: number;
  spent: number;
  remaining: number;
}

/** Dòng Tổng của bảng ngân sách: chỉ cộng ví chi tiêu (Hưởng thụ, Must, Có thì tốt), bỏ ô ẩn số. */
export function budgetTotals(lines: BudgetLine[]): BudgetTotals | null {
  const spending = lines.filter((l) => l.tier === "nice" || l.tier === "must");
  if (spending.length === 0) return null;
  const target = spending.reduce((s, l) => s + (l.target ?? 0), 0);
  const spent = spending.reduce((s, l) => s + (l.spent ?? 0), 0);
  return { target, spent, remaining: target - spent };
}

/**
 * Thứ tự các phong bì cộng thành số "còn để chi tuần này": ví âm lên đầu (âm nhiều nhất trước) để không bị ví còn dư
 * che mất; các ví còn lại giữ nguyên thứ tự server gửi để mỗi ví luôn nằm một chỗ.
 */
export function orderSpendable<T extends { amount: number }>(parts: T[]): T[] {
  const negative = parts.filter((p) => p.amount < 0).sort((a, b) => a.amount - b.amount);
  return [...negative, ...parts.filter((p) => p.amount >= 0)];
}

/** Ví dùng được khi chuyển ngân sách: không bao giờ là ví Thu nhập hay ví riêng của người kia; Tích sản chỉ được nhận, không được rút. */
export function moveWallets(wallets: Wallet[], memberId: string | null, role: "from" | "to"): Wallet[] {
  return wallets.filter(
    (w) => !isIncomeHolding(w) && !(w.scope === "personal" && w.memberId !== null && w.memberId !== memberId) && (role === "to" || w.tier !== "wealth_building"),
  );
}

export interface MoveDraft {
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: number;
}

/**
 * "Bù" một ví âm: đích là ví đó, số tiền = phần âm, nguồn là ví Có thì tốt còn dư nhiều nhất;
 * Có thì tốt không còn thì ví chi tiêu khác còn dư nhiều nhất; không ví nào dư thì vẫn chọn Có thì tốt.
 */
export function coverPrefill(targetId: string, balance: number, wallets: Wallet[], balances: Record<string, number | null>, memberId: string | null): MoveDraft {
  const sources = moveWallets(wallets, memberId, "from").filter((w) => w.id !== targetId && (w.tier === "must" || w.tier === "nice"));
  const bal = (w: Wallet) => balances[w.id] ?? 0;
  const byBalance = (a: Wallet, b: Wallet) => bal(b) - bal(a);
  const have = sources.filter((w) => w.mustGroup === "have").sort(byBalance);
  const from = have.find((w) => bal(w) > 0) ?? [...sources].sort(byBalance).find((w) => bal(w) > 0) ?? have[0] ?? null;
  return { fromWalletId: from?.id ?? null, toWalletId: targetId, amount: balance < 0 ? -balance : 0 };
}

/** Lý do chưa chuyển được, hoặc null khi đủ. */
export function moveProblem(d: MoveDraft): string | null {
  if (!d.amount || d.amount <= 0) return "Nhập số tiền";
  if (!d.fromWalletId || !d.toWalletId) return "Chọn hai ví";
  if (d.fromWalletId === d.toWalletId) return "Hai ví phải khác nhau";
  return null;
}
