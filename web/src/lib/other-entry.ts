// Thân yêu cầu và lý do chưa ghi được của sheet "Loại khác" / "Ghi thu nhập" (pwa UC-705, Đợt C): không ví, không chia.
// Thu nhập mang ô "Đây là lương" (mặc định theo Q1-B). Thuần để test.

import { DEFAULT_SALARY_REMINDER_MIN } from "../../../src/domain/month-tasks";
import type { EntryBody, IncomeStream } from "./types";

/**
 * Ô "Đây là lương" bật sẵn (pocket UC-1205 Q1-B, UC-705 AC-39, UC-706 AC-40): có nguồn → theo "Nguồn lương" của nguồn; không nguồn →
 * số tiền từ ngưỡng nhắc trích (`salary_reminder_min`, chưa biết → 5.000.000) trở lên. Tiền người thuê và lãi không có ô (người gọi bỏ).
 */
export function isSalaryDefault(streams: Pick<IncomeStream, "id" | "is_salary">[], streamId: string, amount: number, reminderMin: number | undefined): boolean {
  if (streamId) return streams.find((s) => s.id === streamId)?.is_salary ?? false;
  return amount > 0 && amount >= (reminderMin ?? DEFAULT_SALARY_REMINDER_MIN);
}

export interface IncomeDraft {
  amount: number;
  at: string;
  clientId: string;
  accountId: string;
  taxable: boolean;
  streamId: string;
  tenantId: string;
  note: string;
  isSalary: boolean;
  /** Ô "Đây là tiền lãi" (QĐ2): chỉ bật được khi tài khoản nhận thuộc nhóm mẹ có mục tiêu (`incomeInterest`). */
  isInterest?: boolean;
}

/** Thân POST /v1/transactions của "Ghi thu nhập": gửi `is_salary` theo ô, trừ tiền người thuê và tiền lãi (không bao giờ là lương). */
export function incomeBody(d: IncomeDraft): EntryBody {
  return {
    meaning: "income",
    amount: d.amount,
    at: d.at,
    client_id: d.clientId,
    account_id: d.accountId,
    taxable: d.taxable,
    ...(d.streamId ? { income_stream_id: d.streamId } : {}),
    ...(d.tenantId ? { tenant_id: d.tenantId } : d.isInterest ? {} : { is_salary: d.isSalary }),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
    ...(d.isInterest ? { is_interest: true } : {}),
  };
}

export type QueuedKind = "spend" | "refund" | "buy_asset" | "lend" | "collect" | "transfer";

export interface QueuedDraft {
  kind: QueuedKind;
  amount: number;
  at: string;
  clientId: string;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  linkId: number | null;
  receivableId: string | null;
  assetKind: string | null;
  note: string;
  /** "Cho mục tiêu" (pocket UC-1209 bước 11): đã kiểm thuộc tài khoản tiền ra (`goalField`); chỉ chi / chuyển gửi. */
  goalId?: string | null;
  /** Chip "Từ tiền lãi" (QĐ2, đã kiểm bằng `goalField`): chỉ chi / chuyển gửi, thay cho `goal_id`. */
  fromInterest?: boolean;
}

/** Lý do nút ghi còn tắt (chữ trên nút); null = ghi được. Chuyển nội bộ: bắt buộc hai tài khoản khác nhau (UC-705 AC-35). */
export function queuedMissing(d: Pick<QueuedDraft, "kind" | "amount" | "accountId" | "toAccountId" | "categoryId">, naming = false): string | null {
  if (!d.amount) return "Nhập số tiền";
  if (d.kind === "spend" && !d.categoryId) return "Chọn danh mục";
  if (d.kind === "transfer" && (!d.accountId || !d.toAccountId)) return "Chọn hai tài khoản";
  if (d.kind === "transfer" && d.accountId === d.toAccountId) return "Hai tài khoản phải khác nhau";
  if ((d.kind === "lend" || d.kind === "collect" || d.kind === "spend") && !d.accountId) return "Chọn tài khoản";
  if (naming) return "Bấm Thêm người trước khi ghi";
  return null;
}

/** Thân POST /v1/transactions của năm loại đi qua hàng đợi và Chi tiêu — mỗi loại chỉ trường của nó, không trường ví. */
export function queuedBody(d: QueuedDraft): EntryBody {
  const { kind } = d;
  return {
    meaning: kind,
    amount: d.amount,
    at: d.at,
    client_id: d.clientId,
    ...(d.accountId ? { account_id: d.accountId } : {}),
    ...(kind === "transfer" && d.toAccountId ? { to_account_id: d.toAccountId } : {}),
    ...((kind === "refund" || kind === "collect") && d.linkId ? { link_id: d.linkId } : {}),
    ...((kind === "refund" || kind === "spend") && d.categoryId ? { category_id: d.categoryId } : {}),
    ...((kind === "lend" || kind === "collect") && d.receivableId ? { receivable_id: d.receivableId } : {}),
    ...(kind === "buy_asset" && d.assetKind ? { asset_kind: d.assetKind } : {}),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
    ...((kind === "spend" || kind === "transfer") && (d.fromInterest ? { from_interest: true } : d.goalId ? { goal_id: d.goalId } : {})),
  };
}
