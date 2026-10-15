// Có / Không Tích sản khi chia một khoản thu (allocation UC-202, UC-203; ADR-112).
// Có: thanh 1–100%, mặc định luôn 10% (không theo % luật nạp); kéo ra số, gõ số thì thanh nhảy theo.
// Không: Tích sản 0, bắt buộc lý do. Mọi số chia còn lại vẫn do server tính.

import { setSplitAmount, type ManualSplit } from "./manual-split";

export const DEFAULT_WEALTH_PCT = 10;
/** Vạch trên thanh: 1% tối thiểu, 10% mặc định, 30% hướng tới. */
export const WEALTH_TICKS = [1, 10, 30] as const;

export type WealthChoice = { mode: "on"; pct: number; amount: number } | { mode: "off"; note: string };

/** Số Tích sản của `pct`% khoản thu: dưới 100.000 làm tròn tới đồng (tối thiểu 1), còn lại tới nghìn; không vượt khoản thu. */
export function wealthAmountFor(pct: number, income: number): number {
  if (income <= 0) return 0;
  const raw = (pct * income) / 100;
  const rounded = income < 100_000 ? Math.max(1, Math.round(raw)) : Math.round(raw / 1000) * 1000;
  return Math.min(rounded, income);
}

/** Số gõ tay → % (một chữ số lẻ). Dưới 1% kẹp lên 1%; vượt khoản thu thì 100%. */
export function wealthFromAmount(amount: number, income: number): { pct: number; amount: number } {
  if (income <= 0) return { pct: DEFAULT_WEALTH_PCT, amount: 0 };
  if (amount >= income) return { pct: 100, amount: income };
  const pct = Math.round((amount / income) * 1000) / 10;
  if (pct < 1) return { pct: 1, amount: wealthAmountFor(1, income) };
  return { pct, amount };
}

export function initialWealth(income: number): WealthChoice {
  return { mode: "on", pct: DEFAULT_WEALTH_PCT, amount: wealthAmountFor(DEFAULT_WEALTH_PCT, income) };
}

/** Đổi số khoản thu: giữ %, tính lại số. */
export function withIncome(choice: WealthChoice, income: number): WealthChoice {
  return choice.mode === "on" ? { ...choice, amount: wealthAmountFor(choice.pct, income) } : choice;
}

/** Không Tích sản mà chưa có lý do → nút ghi tắt. */
export function wealthBlocked(choice: WealthChoice | null): boolean {
  return choice?.mode === "off" && choice.note.trim() === "";
}

/** Thân `/v1/allocate(/preview)` khi chia theo luật. `null` (nguồn khóa 100%) → không gửi gì thêm. */
export function wealthBody(choice: WealthChoice | null): { wealth_amount?: number; wealth_note?: string } {
  if (!choice) return {};
  return choice.mode === "on" ? { wealth_amount: choice.amount } : { wealth_amount: 0, wealth_note: choice.note.trim() };
}

/** Tự chia: số Tích sản đã nằm trong `amounts`; chỉ gửi lý do khi Không Tích sản. */
export function wealthSplitNote(choice: WealthChoice | null): { wealth_note?: string } {
  return choice?.mode === "off" ? { wealth_note: choice.note.trim() } : {};
}

/** Tự chia: ô Tích sản theo lựa chọn (Có → số của thanh, Không → 0). */
export function syncSplitWealth(split: ManualSplit, walletId: string, choice: WealthChoice): ManualSplit {
  return setSplitAmount(split, walletId, choice.mode === "on" ? choice.amount : 0, true);
}
