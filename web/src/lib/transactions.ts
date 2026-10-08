// Một dòng sổ nhìn từ phía người dùng: nó từ đâu tới, làm được gì với nó (sửa / xoá / gán lại), mở form nào để sửa,
// và câu toast sau khi sửa / xoá. Luật thật nằm ở server (ledger UC-102, ADR-73); ở đây chỉ để không hiện nút vô ích.

import { formatVnd } from "./money";
import { walletRemain } from "./pending";
import { atForDay, dayKey } from "./period";
import type { ManualMeaning, TxRow, WalletStatus } from "./types";

export const MEANING_LABEL: Record<string, string> = {
  spend: "Chi tiêu",
  income: "Thu nhập",
  refund: "Hoàn tiền",
  transfer: "Chuyển nội bộ",
  buy_asset: "Mua tài sản",
  lend: "Cho vay",
  collect: "Nhận lại tiền cho vay",
  adjust: "Điều chỉnh sau đếm ví",
  fund: "Nạp ví khi chia lương",
};

/** Tên ngắn của một dòng: danh mục nếu có, không thì loại giao dịch. Chuyển chỉ giữa hai ví là "Chuyển ngân sách". */
export function txLabel(tx: TxRow): string {
  if (tx.category_name) return tx.category_name;
  if (tx.meaning === "transfer" && !tx.account_id && !tx.counter_account_id) return "Chuyển ngân sách";
  return MEANING_LABEL[tx.meaning] ?? tx.meaning;
}

const SIGN: Record<string, "+" | "−"> = { spend: "−", lend: "−", income: "+", refund: "+", collect: "+" };

/**
 * Dấu theo hướng tiền với nhà: vào +, ra −, đổi chỗ trong nhà thì không dấu. Điều chỉnh sau đếm ví luôn lưu số dương:
 * thật nhiều hơn sổ thì tiền vào tài khoản (`counter_account_id`) → `+`, ít hơn → `−`.
 */
export function txSign(tx: Pick<TxRow, "meaning" | "counter_account_id">): "+" | "−" | "" {
  if (tx.meaning === "adjust") return tx.counter_account_id ? "+" : "−";
  return SIGN[tx.meaning] ?? "";
}

export type TxOrigin = "manual" | "bank" | "system";

export function txOrigin(tx: TxRow): TxOrigin {
  if (tx.source === "sepay" || tx.log_id) return "bank";
  if (tx.source === "system" || tx.meaning === "fund") return "system";
  return "manual";
}

export const ORIGIN_LABEL: Record<TxOrigin, string> = { manual: "Ghi tay", bank: "Từ ngân hàng (SePay)", system: "Hệ thống" };

const EDITABLE: readonly string[] = ["spend", "income", "refund", "transfer", "buy_asset", "lend", "collect"] satisfies ManualMeaning[];

export interface TxActions {
  edit: boolean;
  remove: boolean;
  /** Giao dịch ngân hàng: gỡ gán rồi gán lại ở màn Gán. */
  reassign: boolean;
  /** Câu giải thích vì sao không có nút (hoặc chỉ có một nút). */
  note: string | null;
}

/** Việc làm được với một dòng sổ, theo nguồn và loại — cùng luật với `voidTransaction` / `replaceTransaction` ở server. */
export function txActions(tx: TxRow): TxActions {
  const none = { edit: false, remove: false, reassign: false };
  if (tx.status !== "active") return { ...none, note: "Khoản này đã xoá. Sổ giữ lại để xem, không tính vào số nào." };
  const origin = txOrigin(tx);
  if (origin === "bank") return { ...none, reassign: true, note: "Giao dịch ngân hàng không xoá được, chỉ gán lại cho đúng." };
  if (origin === "system") {
    return {
      ...none,
      note:
        tx.meaning === "fund"
          ? "Bút toán nạp ví của một lần chia lương: muốn gỡ thì xoá khoản thu đó."
          : "Bút toán do hệ thống ghi (chốt tháng, quyết toán thuế): không sửa, không xoá lẻ được.",
    };
  }
  if (!EDITABLE.includes(tx.meaning)) {
    return { ...none, remove: true, note: "Khoản điều chỉnh sau đếm ví không sửa được: xoá rồi đếm lại ví." };
  }
  return { ...none, edit: true, remove: true, note: null };
}

/** Form mở ra khi bấm Sửa: màn Nhập cho khoản chi, sheet Chuyển ngân sách cho chuyển chỉ giữa hai ví, còn lại là Loại khác. */
export type EditForm = "spend" | "move" | "income" | "refund" | "buy_asset" | "lend" | "collect" | "transfer";

export function editForm(tx: TxRow): EditForm {
  if (tx.meaning === "transfer" && !tx.account_id && !tx.counter_account_id) return "move";
  return tx.meaning as EditForm;
}

/** Trạng thái đầu của form sửa: các trường của POST /v1/transactions lấy ngược từ dòng sổ theo quy ước dấu. */
export interface TxDraft {
  amount: number;
  /** Ngày theo giờ VN (`YYYY-MM-DD`). */
  day: string;
  note: string;
  category_id: string | null;
  wallet_id: string | null;
  from_wallet_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  taxable: boolean;
  link_id: number | null;
  asset_kind: string | null;
  income_stream_id: string | null;
  tenant_id: string | null;
  debt_id: string | null;
  receivable_id: string | null;
}

// Quy ước dấu (src/domain/entry.ts): wallet_id = ví được cộng · counter_wallet_id = ví bị trừ ·
// account_id = tài khoản tiền RA · counter_account_id = tài khoản tiền VÀO.
export function draftFromTx(tx: TxRow): TxDraft {
  const moneyIn = tx.meaning === "income" || tx.meaning === "refund" || tx.meaning === "collect";
  const transfer = tx.meaning === "transfer";
  return {
    amount: tx.amount,
    day: dayKey(tx.at),
    note: tx.note ?? "",
    category_id: tx.category_id,
    wallet_id: tx.meaning === "spend" ? tx.counter_wallet_id : tx.wallet_id,
    from_wallet_id: transfer ? tx.counter_wallet_id : null,
    account_id: moneyIn ? tx.counter_account_id : tx.account_id,
    to_account_id: transfer ? tx.counter_account_id : null,
    taxable: Boolean(tx.taxable),
    link_id: tx.link_id ?? null,
    asset_kind: tx.asset_kind,
    income_stream_id: tx.income_stream_id ?? null,
    tenant_id: tx.tenant_id ?? null,
    debt_id: tx.debt_id ?? null,
    receivable_id: tx.receivable_id ?? null,
  };
}

/** Giờ ghi của khoản sửa: không đổi ngày thì giữ đúng giờ cũ; đổi ngày thì như khi nhập (12:00 ngày đó, hôm nay thì giờ thật). */
export function editedAt(day: string, originalAt: string, now: Date): string {
  return day === dayKey(originalAt) ? originalAt : atForDay(day, now);
}

/** Ví mà toast nói "còn bao nhiêu" sau khi xoá / sửa: ví bị trừ của khoản chi, ví được cộng của hoàn tiền. */
export function txWalletId(tx: TxRow): string | null {
  if (tx.meaning === "spend") return tx.counter_wallet_id;
  if (tx.meaning === "refund") return tx.wallet_id;
  return null;
}

/**
 * Danh sách chọn của form sửa luôn có lựa chọn đang gắn với khoản đó — kể cả ví của người kia, khoản phải thu đã tắt,
 * người thuê đã dọn đi — để form không lặng lẽ đổi sang thứ khác. `extra` dựng mục đó khi nó không có trong danh sách.
 */
export function withChosen<T extends { id: string }>(list: T[], id: string | null | undefined, extra: () => T | undefined): T[] {
  if (!id || list.some((x) => x.id === id)) return list;
  const item = extra();
  return item ? [...list, item] : list;
}

/** Câu xác nhận trước khi xoá: nói cả hệ quả không thấy được (lần chia của khoản thu cũng bị gỡ). */
export function voidConfirm(tx: TxRow): string {
  return tx.meaning === "income" && tx.allocated ? "Xoá hẳn khoản này? Lần chia của khoản này cũng được gỡ: các ví trả lại số đã nạp." : "Xoá hẳn khoản này?";
}

/** "Đã xoá 45.000 ₫ Ăn uống. Ăn uống còn 300.000 ₫ tuần này." */
export function voidToast(tx: TxRow, status: WalletStatus | null): string {
  const head = `Đã xoá ${formatVnd(tx.amount)} ${txLabel(tx)}.${tx.meaning === "income" && tx.allocated ? " Đã gỡ lần chia." : ""}`;
  const tail = walletRemain(status);
  return tail ? `${head} ${tail}` : head;
}

/** "Đã sửa thành 120.000 ₫ Xăng xe. Đi lại còn 830.000 ₫ tuần này." */
export function editToast(tx: TxRow, status: WalletStatus | null): string {
  const head = `Đã sửa thành ${formatVnd(tx.amount)} ${txLabel(tx)}.`;
  const tail = walletRemain(status);
  return tail ? `${head} ${tail}` : head;
}
