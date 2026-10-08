// Chốt tháng: số dư DƯƠNG của phong bì chung quét sang Tích sản.
// Ví cá nhân, ví tích dồn, ví hoá đơn giữ nguyên; ví âm không bị đụng — nó được bù ở lần chia kế tiếp.

import type { WalletRef } from "./types";

export interface Sweep {
  fromWalletId: string;
  amount: number;
}

export function monthSweep(wallets: WalletRef[], balancesAtMonthEnd: Record<string, number>): Sweep[] {
  return wallets
    .filter((w) => w.kind === "envelope" && w.scope === "shared" && (w.tier === "must" || w.tier === "nice"))
    .map((w) => ({ fromWalletId: w.id, amount: balancesAtMonthEnd[w.id] ?? 0 }))
    .filter((s) => s.amount > 0);
}

/** Tháng liền trước của `YYYY-MM`. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Thời điểm cuối cùng của tháng theo giờ VN, dạng ISO UTC — bút toán chốt tháng thuộc về chính tháng đó. */
export function endOfMonthIso(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) - 7 * 3600_000 - 1000).toISOString();
}
