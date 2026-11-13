// Một dòng sổ nhìn từ phía người dùng: nó từ đâu tới, làm được gì với nó (sửa / xoá / gán lại), mở form nào để sửa,
// và câu toast sau khi sửa / xoá. Luật thật nằm ở server (ledger UC-102, ADR-73); ở đây chỉ để không hiện nút vô ích.

import { formatVnd, moneyDigits } from "./money";
import { atForDay, dayKey } from "./period";
import type { Bootstrap, EntryNearSpend, LegacyClass, ManualMeaning, TxRow } from "./types";

export const MEANING_LABEL: Record<string, string> = {
  spend: "Chi tiêu",
  income: "Thu nhập",
  refund: "Hoàn tiền",
  transfer: "Chuyển nội bộ",
  buy_asset: "Mua tài sản",
  lend: "Cho vay",
  collect: "Nhận lại tiền cho vay",
  adjust: "Điều chỉnh sau đếm ví",
  fund: "Nạp ví (cách tính cũ)",
};

/** Tên ngắn của một dòng: danh mục nếu có, không thì loại giao dịch. Chuyển cũ chỉ giữa hai ví là "Chuyển ngân sách". */
export function txLabel(tx: TxRow): string {
  if (tx.category_name) return tx.category_name;
  if (isWalletOnlyTransfer(tx)) return "Chuyển ngân sách";
  return MEANING_LABEL[tx.meaning] ?? tx.meaning;
}

/** Chuyển cũ chỉ giữa hai ví, không tài khoản (UC-715): còn hiện, không sửa được (chỉ xoá). */
export const isWalletOnlyTransfer = (tx: Pick<TxRow, "meaning" | "account_id" | "counter_account_id">): boolean =>
  tx.meaning === "transfer" && !tx.account_id && !tx.counter_account_id;

/** Nhãn nhỏ "cách tính cũ" ở Sổ (UC-716 AC-21, AC-24): khoản cũ — id ≤ `config.legacy_max_tx_id`, server gắn `legacy`. */
export const LEGACY_LABEL = "cách tính cũ";
export const isLegacyTx = (tx: Pick<TxRow, "legacy">): boolean => tx.legacy === true;

/** Loại chi chép từ phe của ví cũ (ADR-131); khoản đang giữ (`holding`) không có dòng loại chi. */
const LEGACY_CLASS_LABEL: Record<LegacyClass, string | null> = { essential: "Thiết yếu", flex: "Mong muốn", tax: "Thuế", savings: "Tích luỹ", holding: null };

/**
 * Phần "Theo cách tính cũ" của giao dịch cũ, chỉ đọc, không tên ví (UC-715 AC-10, AC-14, AC-15): loại chi theo `legacy_class`,
 * khoản thu đã chia, lý do lần chia không trả cho mình. Giao dịch mới: rỗng.
 */
export function legacyRows(tx: TxRow): [string, string][] {
  const cls = tx.legacy_class ? LEGACY_CLASS_LABEL[tx.legacy_class] : null;
  const split = tx.meaning === "income" && !!tx.allocated;
  return [
    ...(cls ? [["Loại chi (cách tính cũ)", cls] as [string, string]] : []),
    ...(split ? [["Lần chia", "đã chia vào các ví (bản cũ)"] as [string, string]] : []),
    ...(split && tx.wealth_note ? [["Không trả cho mình lần này", tx.wealth_note] as [string, string]] : []),
  ];
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
  if (tx.source === "sepay" || tx.log_id || tx.log_id_2) return "bank";
  if (tx.source === "system" || tx.meaning === "fund") return "system";
  return "manual";
}

export const ORIGIN_LABEL: Record<TxOrigin, string> = { manual: "Ghi tay", bank: "Từ ngân hàng (SePay)", system: "Tự động" };

const EDITABLE: readonly string[] = ["spend", "income", "refund", "transfer", "buy_asset", "lend", "collect"] satisfies ManualMeaning[];

export interface TxActions {
  edit: boolean;
  remove: boolean;
  /** Giao dịch ngân hàng: gỡ gán rồi gán lại ở màn Gán. */
  reassign: boolean;
  /** Câu giải thích vì sao không có nút (hoặc chỉ có một nút). */
  note: string | null;
}

/**
 * Việc làm được với một dòng sổ, theo nguồn và loại — cùng luật với `voidTransaction` / `replaceTransaction` ở server. Khoản
 * chạm tài khoản riêng tư của người khác (`hiddenFromMe` ở bootstrap): chỉ chủ tài khoản sửa / xoá / gỡ gán được (pwa UC-715
 * AC-16, access UC-504 bước 3 — server 403 `private_account`).
 */
export function txActions(tx: TxRow, boot: Pick<Bootstrap, "accounts" | "members">): TxActions {
  const none = { edit: false, remove: false, reassign: false };
  if (tx.status !== "active") return { ...none, note: "Khoản này đã xoá. Sổ giữ lại để xem, không tính vào số nào." };
  const hidden = boot.accounts.find((a) => a.hiddenFromMe && (a.id === tx.account_id || a.id === tx.counter_account_id));
  if (hidden) {
    const owner = boot.members.find((m) => m.id === hidden.ownerMemberId)?.name ?? hidden.ownerMemberId ?? "người khác";
    return { ...none, note: `Thuộc tài khoản riêng tư của ${owner}, chỉ chủ tài khoản sửa được` };
  }
  const origin = txOrigin(tx);
  if (origin === "bank") return { ...none, reassign: true, note: "Giao dịch ngân hàng không xoá được, chỉ gán lại cho đúng." };
  if (origin === "system") {
    return {
      ...none,
      note:
        tx.meaning === "fund"
          ? "Khoản nạp ví theo cách tính cũ: muốn gỡ thì xoá khoản thu đó."
          : "Khoản do Ví nhà tự ghi (chốt tháng, quyết toán thuế): không sửa, không xoá lẻ được.",
    };
  }
  if (!EDITABLE.includes(tx.meaning)) {
    return { ...none, remove: true, note: "Khoản điều chỉnh sau đếm ví không sửa được: xoá rồi đếm lại ví." };
  }
  if (isWalletOnlyTransfer(tx)) return { ...none, remove: true, note: "Chuyển giữa hai ví theo cách tính cũ: không sửa được, chỉ xoá." };
  return { ...none, edit: true, remove: true, note: null };
}

/** Form mở ra khi bấm Sửa: màn Nhập cho khoản chi, còn lại là Loại khác đúng loại. */
export type EditForm = "spend" | "income" | "refund" | "buy_asset" | "lend" | "collect" | "transfer";

export function editForm(tx: TxRow): EditForm {
  return tx.meaning as EditForm;
}

/** Trạng thái đầu của form sửa: các trường của POST /v1/transactions lấy ngược từ dòng sổ theo quy ước dấu. */
export interface TxDraft {
  amount: number;
  /** Ngày theo giờ VN (`YYYY-MM-DD`). */
  day: string;
  note: string;
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  taxable: boolean;
  link_id: number | null;
  asset_kind: string | null;
  income_stream_id: string | null;
  tenant_id: string | null;
  debt_id: string | null;
  receivable_id: string | null;
  /** Mục tiêu của khoản chi / chuyển ra (chip "Cho mục tiêu" đang chọn); null = không. */
  goal_id: string | null;
  /** Khoản thu là tiền lãi (ô "Đây là tiền lãi"); sửa khoản giữ cờ. */
  is_interest: boolean;
  /** Khoản chi / chuyển ra "Từ tiền lãi"; sửa khoản giữ cờ. */
  from_interest: boolean;
}

// Quy ước dấu (src/domain/entry.ts): account_id = tài khoản tiền RA · counter_account_id = tài khoản tiền VÀO. Sửa khoản cũ
// không mang ví theo (Đợt C).
export function draftFromTx(tx: TxRow): TxDraft {
  const moneyIn = tx.meaning === "income" || tx.meaning === "refund" || tx.meaning === "collect";
  const transfer = tx.meaning === "transfer";
  return {
    amount: tx.amount,
    day: dayKey(tx.at),
    note: tx.note ?? "",
    category_id: tx.category_id,
    account_id: moneyIn ? tx.counter_account_id : tx.account_id,
    to_account_id: transfer ? tx.counter_account_id : null,
    taxable: Boolean(tx.taxable),
    link_id: tx.link_id ?? null,
    asset_kind: tx.asset_kind,
    income_stream_id: tx.income_stream_id ?? null,
    tenant_id: tx.tenant_id ?? null,
    debt_id: tx.debt_id ?? null,
    receivable_id: tx.receivable_id ?? null,
    goal_id: tx.goal_id ?? null,
    is_interest: tx.is_interest === true,
    from_interest: tx.from_interest === true,
  };
}

/** Giờ ghi của khoản sửa: không đổi ngày thì giữ đúng giờ cũ; đổi ngày thì như khi nhập (12:00 ngày đó, hôm nay thì giờ thật). */
export function editedAt(day: string, originalAt: string, now: Date): string {
  return day === dayKey(originalAt) ? originalAt : atForDay(day, now);
}

/** " Vận hành còn 21.000.000 ₫ ≈ 700.000/ngày." sau khi sửa / xoá khoản chi / hoàn tiền; rỗng khi không biết. */
function nearSpendTail(tx: TxRow, ns: EntryNearSpend | null): string {
  if (!ns || (tx.meaning !== "spend" && tx.meaning !== "refund")) return "";
  return ` Vận hành còn ${formatVnd(ns.amount)}${ns.perDay !== null ? ` ≈ ${moneyDigits(ns.perDay)}/ngày` : ""}.`;
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

/** Câu xác nhận trước khi xoá: nói cả hệ quả không thấy được (nhắc trích Tích luỹ của khoản lương, phần nạp ví cũ). */
export function voidConfirm(tx: TxRow): string {
  if (tx.meaning !== "income") return "Xoá hẳn khoản này?";
  return `Xoá hẳn khoản này? Nhắc trích Tích luỹ từ khoản này (nếu có) cũng bị huỷ${tx.allocated ? "; phần đã nạp vào ví theo cách tính cũ được gỡ" : ""}.`;
}

/** "Đã xoá 45.000 ₫ Ăn uống. Vận hành còn 3.945.000 ₫ ≈ 136.000/ngày." */
export function voidToast(tx: TxRow, ns: EntryNearSpend | null): string {
  return `Đã xoá ${formatVnd(tx.amount)} ${txLabel(tx)}.${nearSpendTail(tx, ns)}`;
}

/** "Đã sửa thành 120.000 ₫ Xăng xe. Vận hành còn …" */
export function editToast(tx: TxRow, ns: EntryNearSpend | null): string {
  return `Đã sửa thành ${formatVnd(tx.amount)} ${txLabel(tx)}.${nearSpendTail(tx, ns)}`;
}
