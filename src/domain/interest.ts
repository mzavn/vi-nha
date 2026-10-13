// Lãi vay hằng tháng (ADR nháp H, Công thức 5 và 18 của change 261008-bang-can-doi). Hàm thuần: tiền là số nguyên đồng,
// lãi suất lưu phần vạn/năm (18% = 1800) để không lệch số thực.

import type { WalletRule } from "./allocation";
import { LOAN_INTEREST_ID } from "./system-ids";

export type InterestGroup = "none" | "normal" | "high";

/** Lãi dự kiến tháng = floor(max(0, dư nợ đầu tháng) × lãi suất ÷ 12). Khoản 0% → 0. */
export const monthlyInterest = (openingBalance: number, rateBps: number): number =>
  rateBps > 0 ? Math.floor((Math.max(0, openingBalance) * rateBps) / 120_000) : 0;

/** Tiền lãi/năm = floor(còn nợ × lãi suất). */
export const yearlyInterest = (balance: number, rateBps: number): number => Math.floor((Math.max(0, balance) * rateBps) / 10_000);

/** Nhóm lãi ở bảng cân đối: 0 → không lãi; dưới ngưỡng lãi cao → lãi thường; còn lại → lãi cao. */
export const interestGroup = (rateBps: number, highBps: number): InterestGroup => (rateBps <= 0 ? "none" : rateBps < highBps ? "normal" : "high");

/** Ô Tiền lãi của sheet Trả nợ: min(số tiền, max(0, lãi dự kiến − lãi đã trả tháng này)). */
export const interestPart = (amount: number, expected: number, paid: number): number => Math.min(amount, Math.max(0, expected - paid));

/** "18" (%/năm, cho phép lẻ) → 1800 phần vạn. */
export const percentToBps = (percent: number): number => Math.round(percent * 100);

/**
 * Luật dựng sẵn của ví "Lãi vay" khi ví không có luật nạp tay đang bật: `flat` tháng, sàn = số = Σ lãi dự kiến tháng,
 * nên engine rót ở bước sàn Must như mọi khoản Must bắt buộc. Không có lãi dự kiến, ví đã tắt, hoặc có luật tay → không thêm gì.
 */
export function withInterestRule(
  rules: WalletRule[],
  wallets: { id: string; tier: string; mustGroup: "must" | "have" | null; kind: string }[],
  expectedTotal: number,
): WalletRule[] {
  const wallet = wallets.find((w) => w.id === LOAN_INTEREST_ID);
  if (!wallet || expectedTotal <= 0 || rules.some((r) => r.walletId === LOAN_INTEREST_ID)) return rules;
  return [
    ...rules,
    {
      walletId: LOAN_INTEREST_ID,
      tier: wallet.tier as WalletRule["tier"],
      mustGroup: wallet.mustGroup,
      kind: wallet.kind as WalletRule["kind"],
      mode: "flat",
      period: "month",
      amount: expectedTotal,
      percent: null,
      targetAmount: null,
      targetDate: null,
      floorAmount: expectedTotal,
      priority: 100,
    },
  ];
}
