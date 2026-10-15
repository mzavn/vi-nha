// Tự chia một khoản thu (allocation UC-202, UC-203): số tay cho từng ví thay cho bảng chia theo luật.

import { transferOrders, type TransferOrderDraft } from "../../../src/domain/transfer-orders";
import { moneyDigits } from "./money";
import type { AllocationPlan, Wallet } from "./types";

/** Số đang gõ của từng ví; `invalid`: ô có phép tính sai (âm, không ra số) — chưa ghi được. */
export interface ManualSplit {
  amounts: Record<string, number>;
  invalid: string[];
}

export interface SplitCheck {
  /** "Đã chia X / Y". */
  done: string;
  /** "còn Z" / "chia vượt Z"; null khi khớp. */
  rest: string | null;
  over: boolean;
  /** Được bấm Chia và ghi sổ: tổng khớp và không ô nào sai. */
  ok: boolean;
}

/** Ví có ô số: mọi ví đang dùng trừ ví giữ tiền (Thu nhập, Thu cho thuê); Tích sản đứng đầu, còn lại theo thứ tự ví. */
export function splitWallets(wallets: Wallet[]): Wallet[] {
  const usable = wallets.filter((w) => w.tier !== "holding");
  return [...usable.filter((w) => w.tier === "wealth_building"), ...usable.filter((w) => w.tier !== "wealth_building")];
}

/** Điền sẵn số của bảng chia theo luật; ví không có trong bảng thì 0. */
export function prefillSplit(plan: AllocationPlan, wallets: Wallet[]): ManualSplit {
  const amounts: Record<string, number> = {};
  for (const w of splitWallets(wallets)) amounts[w.id] = plan.funds.find((f) => f.walletId === w.id)?.amount ?? 0;
  return { amounts, invalid: [] };
}

export function setSplitAmount(split: ManualSplit, walletId: string, amount: number, valid: boolean): ManualSplit {
  const others = split.invalid.filter((id) => id !== walletId);
  return { amounts: { ...split.amounts, [walletId]: amount }, invalid: valid ? others : [...others, walletId] };
}

/** Chỉ xét tổng và ô sai; Tích sản 0 cần lý do do lựa chọn Không Tích sản bắt (ADR-112). */
export function checkSplit(split: ManualSplit, amount: number): SplitCheck {
  const total = Object.values(split.amounts).reduce((s, n) => s + n, 0);
  const diff = amount - total;
  return {
    done: `Đã chia ${moneyDigits(total)} / ${moneyDigits(amount)}`,
    rest: diff > 0 ? `còn ${moneyDigits(diff)}` : diff < 0 ? `chia vượt ${moneyDigits(-diff)}` : null,
    over: diff < 0,
    ok: diff === 0 && split.invalid.length === 0,
  };
}

/** `amounts` gửi lên `/v1/allocate`: chỉ các số > 0. */
export function splitPayload(split: ManualSplit): { wallet_id: string; amount: number }[] {
  return Object.entries(split.amounts)
    .filter(([, amount]) => amount > 0)
    .map(([wallet_id, amount]) => ({ wallet_id, amount }));
}

/** Lệnh chuyển xem trước: theo nơi ở của ví như chia theo luật (UC-204) — cùng hàm server dùng. */
export function splitOrders(split: ManualSplit, wallets: Wallet[], fromAccountId: string | null): TransferOrderDraft[] {
  const moves = splitPayload(split).map((a) => ({ walletId: a.wallet_id, amount: a.amount }));
  return transferOrders(moves, Object.fromEntries(wallets.map((w) => [w.id, w.accountId])), fromAccountId);
}
