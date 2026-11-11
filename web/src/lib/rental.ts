// Sổ người thuê (pwa UC-713, rental UC-806/807): bản tính tháng — kiểm khoản trên máy, tổng và so với tháng trước, dấu
// "kiểm lại số", tài khoản nhận, chip trạng thái, dấu "đã gửi lại" theo máy, chia sẻ tin + QR; và form Cài đặt › Cho thuê.
// Thuần, không đụng DOM hay mạng. Số dư dương = người thuê còn nợ; âm = đã trả dư, trừ vào tháng sau.

import { billItemsInput, type BillCategory, type BillItem } from "../../../src/domain/rental";
import { formatSigned, formatVnd } from "./money";
import { done, type Errors, type Result } from "./settings";
import type { AccountRef, BillView, TenantBillSummary } from "./types";

export function balanceText(balance: number): string {
  if (balance > 0) return `còn nợ ${formatVnd(balance)}`;
  if (balance < 0) return `trả dư ${formatVnd(-balance)}, trừ tháng sau`;
  return "đã hết nợ";
}

/** Dòng dưới tin gửi: số dư hiện tại sau các khoản đã chuyển (UC-807 bước 4). */
export function owedText(balance: number): string {
  if (balance > 0) return `Còn nợ tất cả: ${formatVnd(balance)}`;
  if (balance < 0) return `Trả dư ${formatVnd(-balance)}`;
  return "Đã trả đủ";
}

// ── Tiền thuê không vào tài khoản riêng tư (N-1) ────────────────────

export const TENANT_PRIVATE_ACCOUNT = "Tiền thuê không ghi vào tài khoản riêng tư.";

const isPrivate = (a: Pick<AccountRef, "private" | "hiddenFromMe"> | null | undefined) => !!(a && (a.private || a.hiddenFromMe));

/** Câu chặn khi khoản thu của người thuê đi vào tài khoản riêng tư (UC-705 AC-36, UC-706 AC-38); không chặn → null. */
export function tenantAccountBlock(tenantId: string | null | undefined, account: Pick<AccountRef, "private" | "hiddenFromMe"> | null | undefined): string | null {
  return tenantId && isPrivate(account) ? TENANT_PRIVATE_ACCOUNT : null;
}

/** Log của tài khoản riêng tư không gán được cho người thuê: chip "Thu từ người thuê" tắt kèm câu này. */
export const tenantChipBlock = (account: Pick<AccountRef, "private" | "hiddenFromMe"> | null | undefined): string | null =>
  isPrivate(account) ? TENANT_PRIVATE_ACCOUNT : null;

/** Tài khoản nhận của bản tính: ngân hàng, không riêng tư (bootstrap chỉ có tài khoản đang dùng). */
export const receiveAccounts = (accounts: readonly AccountRef[]): AccountRef[] => accounts.filter((a) => a.kind === "bank" && !isPrivate(a));

// ── Sửa bản tính ───────────────────────────────────────────────────

export interface BillRow {
  key: number;
  name: string;
  category: BillCategory;
  amount: number;
}

let rowSeq = 0;
export const newRow = (category: BillCategory): BillRow => ({ key: ++rowSeq, name: "", category, amount: 0 });

/** Hàng sửa từ khoản của bản tính, đúng thứ tự. */
export const rowsOf = (items: readonly BillItem[]): BillRow[] => items.map((i) => ({ key: ++rowSeq, name: i.name, category: i.category, amount: i.amount }));

/** Khoản gửi lên theo thứ tự hiện trên màn: Chi phí cứng trước, Chi phí sau. */
export const orderedRows = (rows: readonly BillRow[]): BillRow[] => [...rows.filter((r) => r.category === "fixed"), ...rows.filter((r) => r.category === "variable")];

/** Nguồn số "tháng trước": bản tính gần nhất trước tháng này; server không gửi thì lấy `previous` của từng khoản. */
export function previousSource(view: Pick<BillView, "previous" | "bill">): BillItem[] {
  if (view.previous) return view.previous.items;
  return (view.bill?.items ?? []).flatMap((i) => (i.previous === null ? [] : [{ name: i.name, category: i.category, amount: i.previous }]));
}

/** "kiểm lại số": khoản Chi phí của bản nháp vừa chép, số còn y như tháng trước — mất khi sửa số (UC-713 AC-14). */
export const needsCheck = (status: BillView["status"], category: BillCategory, amount: number, previous: number | null): boolean =>
  status === "draft" && category === "variable" && previous !== null && amount === previous;

export interface BillBody {
  revision: number;
  items: BillItem[];
  receive_account_id: string | null;
}

/** Thân PUT /v1/rental/bills/:id — kiểm như server (`billItemsInput`): tên cần, ≤ 60, không trùng, số ≠ 0. Lỗi gắn ô `item-<key>`. */
export function billPayload(revision: number, rows: readonly BillRow[], receiveAccountId: string | null): Result<BillBody> {
  const ordered = orderedRows(rows);
  const check = billItemsInput(ordered.map(({ name, category, amount }) => ({ name, category, amount })));
  const errors: Errors = {};
  if (!check.ok) {
    const row = check.index === null ? undefined : ordered[check.index];
    errors[row ? `item-${row.key}` : "items"] = check.message;
  }
  return done(errors, () => ({ revision, items: check.ok ? check.items : [], receive_account_id: receiveAccountId || null }));
}

/** Tên tháng ngắn: cùng năm với `month` thì "tháng 9", khác năm "tháng 12/2025". */
export function monthName(m: string, month: string): string {
  const n = Number(m.slice(5, 7));
  return m.slice(0, 4) === month.slice(0, 4) ? `tháng ${n}` : `tháng ${n}/${m.slice(0, 4)}`;
}

/** Chân dính: "Tổng tháng 10 4.220.000 ₫ · tháng 9 4.180.000 ₫ (+40.000)". Không có tháng trước thì chỉ tổng. */
export function billCompare(month: string, total: number, previous: { month: string; total: number } | null): string {
  const head = `Tổng ${monthName(month, month)} ${formatVnd(total)}`;
  if (!previous) return head;
  const diff = total - previous.total;
  return `${head} · ${monthName(previous.month, month)} ${formatVnd(previous.total)} (${diff === 0 ? "không đổi" : formatSigned(diff)})`;
}

/** Câu dưới nút Lập: chép từ tháng nào (UC-806 bước 1). */
export function createHint(month: string, previous: BillView["previous"]): string {
  if (!previous) return "Chưa có tháng trước — bắt đầu trống";
  return `Chép ${previous.items.length} khoản từ ${monthName(previous.month, month)}`;
}

/** Hỏi trước khi lưu bản đã gửi (UC-806 bước 6). */
export const resendConfirm = (from: number, to: number, tenantName: string): string => `Tổng đổi từ ${formatVnd(from)} thành ${formatVnd(to)} — gửi lại tin cho ${tenantName}.`;

// ── Dấu "đã gửi" trên máy này ───────────────────────────────────────

export const SENT_KEY = "vi-nha:rental-sent";
type SentStorage = Pick<Storage, "getItem" | "setItem">;

/** Bản tính id → `revision` lần cuối bấm Gửi / Chép tin trên máy này. localStorage hỏng hay bị chặn → {}. */
export function sentRevisions(storage: SentStorage | null): Record<string, number> {
  try {
    const raw = storage?.getItem(SENT_KEY);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function markSent(storage: SentStorage | null, billId: number, revision: number): void {
  try {
    storage?.setItem(SENT_KEY, JSON.stringify({ ...sentRevisions(storage), [billId]: revision }));
  } catch {
    // không ghi được: chip "Đã sửa — gửi lại" còn hiện, không hại gì
  }
}

/** Đã sửa sau khi gửi mà máy này chưa gửi lại bản mới nhất (UC-713 AC-16). */
export const needsResend = (bill: { id: number; revision: number; edited: boolean }, sent: Record<string, number>): boolean =>
  bill.edited && bill.revision > (sent[bill.id] ?? 0);

export type BillChip = { text: string; tone: "" | "warn" | "ok" | "bad" };

/** Chip bản tính tháng trước ở danh sách người thuê. */
export function billChip(bill: TenantBillSummary | null, sent: Record<string, number>): BillChip {
  if (!bill) return { text: "Chưa lập", tone: "bad" };
  if (bill.status === "draft") return { text: "Nháp", tone: "warn" };
  if (needsResend(bill, sent)) return { text: "Đã sửa — gửi lại", tone: "warn" };
  return { text: "Đã gửi", tone: "ok" };
}

// ── Gửi cho người thuê ──────────────────────────────────────────────

export interface ShareNav {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}

/**
 * Nội dung chia sẻ (UC-807 bước 3): có ảnh QR và máy chia sẻ được ảnh → tin + ảnh; không có QR mà máy chia sẻ được → tin.
 * null = chép tin (QR vẫn hiện trên màn để chụp).
 */
export function billShare(nav: ShareNav | null, text: string, qrFile: File | null): ShareData | null {
  if (!nav?.share) return null;
  if (qrFile) return nav.canShare?.({ files: [qrFile] }) ? { text, files: [qrFile] } : null;
  return { text };
}

// ── Cài đặt › Cho thuê ─────────────────────────────────────────────

export function tenantPayload(f: { name: string; opening: number; openingSign: 1 | -1; active: boolean }, isNew: boolean): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên người thuê.";
  return done(errors, () => (isNew ? { name, ...(f.opening ? { opening_balance: f.openingSign * f.opening } : {}) } : { name, active: f.active }));
}

/** Thân PATCH /v1/rental/config: bắt buộc chọn nguồn thu — không bao giờ gửi `income_stream_id: null`. */
export function rentalConfigPayload(f: { income_stream_id: string }): Result<{ income_stream_id: string }> {
  const errors: Errors = {};
  // Tiền người thuê luôn phải có nguồn: không có thì nó bị coi như lương.
  if (!f.income_stream_id) errors.income_stream_id = "Chọn nguồn thu cho tiền người thuê trả.";
  return done(errors, () => ({ income_stream_id: f.income_stream_id }));
}
