// Hỗ trợ hoàn tác (pwa UC-702 AC-44, UC-703 AC-19, UC-706 AC-41, UC-715 AC-18, AC-19).
// Thuần để test: dựng thân ghi lại khoản đã xoá, tái tạo splits cho log assign, và các câu thông báo.

import { draftFromTx, isWalletOnlyTransfer } from "./transactions";
import type { EntryBody, ManualMeaning, TxRow } from "./types";

export const TOAST_UNDO_DONE = "Đã hoàn tác.";
export const TOAST_BANK_TX_ERROR = "Khoản này đã khớp giao dịch ngân hàng, dùng Gán lại ở Sổ.";

const MANUAL_MEANINGS = new Set(["spend", "income", "refund", "transfer", "buy_asset", "lend", "collect"]);

/**
 * Khoản xoá được bằng một chạm có Hoàn tác (UC-715 AC-18).
 * Khoản adjust và giao dịch cách tính cũ (legacy) vẫn xoá hai bước, không hoàn tác.
 */
export function canUndoVoid(tx: TxRow): boolean {
  if (tx.legacy || tx.meaning === "adjust" || isWalletOnlyTransfer(tx)) return false;
  return MANUAL_MEANINGS.has(tx.meaning);
}

/** Server trả `is_salary` dạng 0/1 (cột SQLite). Khoản thu luôn gửi rõ true / false để giữ đúng lựa chọn cũ (không để server tự đoán). */
const salaryOf = (tx: TxRow): boolean | undefined => (tx.meaning === "income" ? Number(tx.is_salary) === 1 : undefined);

/**
 * Dựng thân POST /v1/transactions để ghi lại đúng khoản đã xoá (UC-715 AC-18).
 * Giữ nguyên `at` gốc, các phân loại, cờ lương/lãi, mục tiêu, nhưng mang `client_id` mới.
 */
export function restoreBody(tx: TxRow, clientId: string): EntryBody {
  const draft = draftFromTx(tx);
  return {
    meaning: tx.meaning as ManualMeaning,
    amount: draft.amount,
    at: tx.at,
    client_id: clientId,
    category_id: draft.category_id ?? undefined,
    account_id: draft.account_id ?? undefined,
    to_account_id: draft.to_account_id ?? undefined,
    note: draft.note || undefined,
    taxable: draft.taxable ? true : undefined,
    link_id: draft.link_id ?? undefined,
    asset_kind: draft.asset_kind ?? undefined,
    income_stream_id: draft.income_stream_id ?? undefined,
    tenant_id: draft.tenant_id ?? undefined,
    debt_id: draft.debt_id ?? undefined,
    receivable_id: draft.receivable_id ?? undefined,
    interest_debt_id: tx.interest_debt_id ?? undefined,
    goal_id: draft.goal_id ?? undefined,
    is_salary: salaryOf(tx),
    is_interest: draft.is_interest ? true : undefined,
    from_interest: draft.from_interest ? true : undefined,
  };
}

export interface SplitItem {
  meaning: string;
  amount: number;
  category_id?: string | null;
  other_account_id?: string | null;
  income_stream_id?: string | null;
  tenant_id?: string | null;
  debt_id?: string | null;
  interest_debt_id?: string | null;
  receivable_id?: string | null;
  link_id?: number | null;
  taxable?: boolean;
  asset_kind?: string | null;
  interest?: boolean;
  is_salary?: boolean;
  note?: string | null;
  goal_id?: string | null;
  from_interest?: boolean;
}

/**
 * Tái tạo danh sách splits cho POST /v1/logs/:id/assign từ các dòng giao dịch đã gán (UC-715 AC-19).
 * other_account_id là tài khoản đầu kia theo chiều tiền đối với chuyển khoản.
 */
export function splitsFromTxs(txs: TxRow[], logAccountId?: string | null): SplitItem[] {
  return txs.map((tx) => {
    let otherAccountId: string | null = null;
    if (tx.meaning === "transfer") {
      if (logAccountId) {
        otherAccountId = tx.account_id === logAccountId ? tx.counter_account_id : tx.account_id;
      } else {
        otherAccountId = tx.counter_account_id ?? tx.account_id;
      }
    }
    return {
      meaning: tx.meaning,
      amount: tx.amount,
      category_id: tx.category_id ?? null,
      other_account_id: otherAccountId ?? null,
      income_stream_id: tx.income_stream_id ?? null,
      tenant_id: tx.tenant_id ?? null,
      debt_id: tx.debt_id ?? null,
      interest_debt_id: tx.interest_debt_id ?? null,
      receivable_id: tx.receivable_id ?? null,
      link_id: tx.link_id ?? null,
      taxable: Boolean(tx.taxable),
      asset_kind: tx.asset_kind ?? null,
      interest: tx.is_interest === true,
      ...(salaryOf(tx) !== undefined ? { is_salary: salaryOf(tx) } : {}),
      note: tx.note ?? null,
      goal_id: tx.goal_id ?? null,
      from_interest: tx.from_interest === true,
    };
  });
}
