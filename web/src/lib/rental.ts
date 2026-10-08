// Sổ người thuê: số dư, bản nháp chốt tháng, dòng ghi tay, và form Cài đặt › Cho thuê.
// Thuần, không đụng DOM hay mạng. Số dư dương = người thuê còn nợ; âm = đã trả dư, trừ vào tháng sau.

import { formatVnd } from "./money";
import { done, type Errors, parseInteger, type Result } from "./settings";
import type { TenantMonth } from "./types";

export function balanceText(balance: number): string {
  if (balance > 0) return `còn nợ ${formatVnd(balance)}`;
  if (balance < 0) return `trả dư ${formatVnd(-balance)}, trừ tháng sau`;
  return "đã hết nợ";
}

// ── Chốt tháng ─────────────────────────────────────────────────────

export interface SettleLine {
  key: number;
  kind: "fixed" | "shared" | "adjust";
  name: string;
  /** Có dấu: dương = người thuê nợ thêm. fixed/shared luôn dương. */
  amount: number;
}

/** Bản nháp app điền sẵn (phí cố định + phần chi chung), người sửa trước khi lưu. */
export function draftLines(m: Pick<TenantMonth, "draft">): SettleLine[] {
  return m.draft.map((d, i) => ({ key: i + 1, kind: d.kind, name: d.name, amount: d.amount }));
}

/** Đổi số người chia: dòng chi chung tính lại floor(tổng / số người); phần lẻ hộ chịu. */
export function withHeadcount(lines: SettleLine[], sharedTotal: number, headcount: number): SettleLine[] {
  if (!Number.isInteger(headcount) || headcount < 1) return lines;
  const share = Math.floor(sharedTotal / headcount);
  return lines.map((l) => (l.kind === "shared" ? { ...l, amount: share } : l));
}

export const settleTotal = (lines: SettleLine[]): number => lines.reduce((s, l) => s + l.amount, 0);

export interface SettleBody {
  month: string;
  headcount: number;
  lines: { kind: SettleLine["kind"]; name: string; amount: number }[];
}

export function settlePayload(month: string, headcountText: string, lines: SettleLine[]): Result<SettleBody> {
  const errors: Errors = {};
  const headcount = parseInteger(headcountText, 1, 50);
  if (headcount === null) errors.headcount = "Số người chia là số nguyên từ 1.";
  lines.forEach((l, i) => {
    if (!l.name.trim()) errors[`line-${l.key}`] = `Dòng ${i + 1} cần tên.`;
    else if (!Number.isInteger(l.amount) || l.amount === 0) errors[`line-${l.key}`] = `Dòng ${i + 1} cần số tiền.`;
    else if (l.kind !== "adjust" && l.amount < 0) errors[`line-${l.key}`] = `Dòng ${i + 1} không được âm; giảm thì thêm dòng chỉnh.`;
  });
  return done(errors, () => ({ month, headcount: headcount!, lines: lines.map((l) => ({ kind: l.kind, name: l.name.trim(), amount: l.amount })) }));
}

// ── Dòng ghi tay ───────────────────────────────────────────────────

export type ManualLineKind = "one_off" | "adjust" | "paid_for_us";

export interface LineForm {
  kind: ManualLineKind;
  amount: number;
  /** Chỉ cho adjust: +1 tăng nợ, −1 giảm nợ. */
  sign: 1 | -1;
  name: string;
  category_id: string;
}

/**
 * Thân POST /v1/rental/tenants/:id/lines. paid_for_us gửi số DƯƠNG (server lưu âm) và phải thuộc danh mục chi chung;
 * phí một lần và chỉnh tay cần tên để bảng kê đọc được.
 */
export function linePayload(f: LineForm, sharedCategoryIds: string[]): Result<{ kind: ManualLineKind; amount: number; name?: string; category_id?: string }> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!Number.isInteger(f.amount) || f.amount <= 0) errors.amount = "Nhập số tiền.";
  if (f.kind === "paid_for_us" && !sharedCategoryIds.includes(f.category_id)) errors.category_id = "Chọn một danh mục chi chung.";
  if (f.kind !== "paid_for_us" && !name) errors.name = f.kind === "one_off" ? "Nhập tên khoản phí." : "Nhập lý do chỉnh.";
  return done(errors, () => ({
    kind: f.kind,
    amount: f.kind === "adjust" ? f.sign * f.amount : f.amount,
    ...(name ? { name } : {}),
    ...(f.kind === "paid_for_us" ? { category_id: f.category_id } : {}),
  }));
}

// ── Cài đặt › Cho thuê ─────────────────────────────────────────────

export function tenantPayload(f: { name: string; opening: number; openingSign: 1 | -1; active: boolean }, isNew: boolean): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên người thuê.";
  return done(errors, () => (isNew ? { name, ...(f.opening ? { opening_balance: f.openingSign * f.opening } : {}) } : { name, active: f.active }));
}

export function feePayload(f: { name: string; amount: number; active: boolean }, isNew: boolean): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên khoản phí.";
  if (!Number.isInteger(f.amount) || f.amount <= 0) errors.amount = "Nhập số tiền mỗi tháng.";
  return done(errors, () => (isNew ? { name, amount: f.amount } : { name, amount: f.amount, active: f.active }));
}

export function rentalConfigPayload(f: { headcount: string; shared_category_ids: string[]; income_stream_id: string }): Result<{ headcount: number; shared_category_ids: string[]; income_stream_id: string }> {
  const errors: Errors = {};
  const headcount = parseInteger(f.headcount, 1, 50);
  if (headcount === null) errors.headcount = "Số người chia là số nguyên từ 1.";
  if (f.shared_category_ids.length === 0) errors.shared_category_ids = "Chọn ít nhất một danh mục chi chung.";
  // Tiền người thuê luôn phải có nguồn: không có thì nó bị chia như lương, chảy vào ví chi tiêu.
  if (!f.income_stream_id) errors.income_stream_id = "Chọn nguồn thu cho tiền người thuê trả.";
  return done(errors, () => ({ headcount: headcount!, shared_category_ids: f.shared_category_ids, income_stream_id: f.income_stream_id }));
}
