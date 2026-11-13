// Sổ người thuê (context rental, UC-805…807) — hàm THUẦN: kiểm khoản của bản tính tháng, tổng theo hạng, so với tháng
// trước, nội dung QR và tin gửi người thuê. Sổ người thuê là sổ phải thu ngoài sổ cái: dương = người thuê còn nợ, âm = trả dư.

import { dayKey } from "./period";
import { qrMemo } from "./vietqr";

export type TenantLineKind = "opening" | "fixed" | "shared" | "one_off" | "paid_for_us" | "adjust" | "bill";

/** Hai hạng cố định (QĐ1): Chi phí cứng (tiền nhà, gửi xe, mạng) · Chi phí (ăn, điện, nước). */
export type BillCategory = "fixed" | "variable";
export const BILL_CATEGORIES: readonly BillCategory[] = ["fixed", "variable"];
export const CATEGORY_LABEL: Record<BillCategory, string> = { fixed: "Chi phí cứng", variable: "Chi phí" };

export const MAX_BILL_ITEMS = 30;
export const MAX_ITEM_NAME = 60;
export const MAX_ITEM_AMOUNT = 1_000_000_000_000;

export interface BillItem {
  name: string;
  category: BillCategory;
  amount: number;
}

/** Khoá so tên khoản: cắt khoảng trắng, không phân biệt hoa thường — tên không trùng trong một bản tính. */
export const itemKey = (name: string) => name.normalize("NFC").trim().toLowerCase();

export type ItemsCheck = { ok: true; items: BillItem[] } | { ok: false; code: string; message: string; index: number | null };

/** Kiểm danh sách khoản gửi lên (UC-806 bước 3, Exceptions). Trả khoản đã cắt khoảng trắng tên, đúng thứ tự. */
export function billItemsInput(raw: unknown): ItemsCheck {
  const bad = (code: string, message: string, index: number | null = null): ItemsCheck => ({ ok: false, code, message, index });
  if (!Array.isArray(raw)) return bad("invalid_input", "items phải là mảng.");
  if (raw.length > MAX_BILL_ITEMS) return bad("invalid_input", `Một bản tính tối đa ${MAX_BILL_ITEMS} khoản.`);
  const items: BillItem[] = [];
  const seen = new Set<string>();
  for (const [i, x] of raw.entries()) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return bad("invalid_input", `Khoản ${i + 1} không hợp lệ.`, i);
    const r = x as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.normalize("NFC").trim() : "";
    if (!name) return bad("invalid_input", `Khoản ${i + 1} cần tên.`, i);
    if (name.length > MAX_ITEM_NAME) return bad("invalid_input", `Tên khoản ${i + 1} tối đa ${MAX_ITEM_NAME} ký tự.`, i);
    if (!BILL_CATEGORIES.includes(r.category as BillCategory)) return bad("invalid_category", `Hạng của "${name}" phải là Chi phí cứng hoặc Chi phí.`, i);
    const amount = r.amount;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_ITEM_AMOUNT) {
      return bad("invalid_amount", `Số tiền của "${name}" phải là số nguyên VND khác 0.`, i);
    }
    const key = itemKey(name);
    if (seen.has(key)) return bad("duplicate_item", `Hai khoản cùng tên "${name}".`, i);
    seen.add(key);
    items.push({ name, category: r.category as BillCategory, amount });
  }
  return { ok: true, items };
}

export interface BillTotals {
  fixed: number;
  variable: number;
  total: number;
}

export function billTotals(items: readonly BillItem[]): BillTotals {
  const sum = (c: BillCategory) => items.filter((i) => i.category === c).reduce((s, i) => s + i.amount, 0);
  const fixed = sum("fixed");
  const variable = sum("variable");
  return { fixed, variable, total: fixed + variable };
}

/** Số tháng trước của khoản cùng tên (so theo `itemKey`), `null` khi tháng trước không có khoản đó. */
export function previousAmounts(items: readonly BillItem[], previous: readonly BillItem[]): (number | null)[] {
  const byKey = new Map(previous.map((p) => [itemKey(p.name), p.amount]));
  return items.map((i) => byKey.get(itemKey(i.name)) ?? null);
}

/** Nội dung chuyển khoản của bản tính tháng `month` (QĐ7): `TIEN NHA T10 AN`, ≤ 25 ký tự không dấu (mã cắt cho vừa). */
export function billMemo(month: string, tenantId: string): string {
  return qrMemo(`TIEN NHA T${Number(month.slice(5, 7))} ${tenantId.toUpperCase()}`);
}

/** Chỉ giữ chữ và số, viết hoa — so nội dung chuyển khoản với mã QR bản tính (UC-805 AC-11). */
export function memoKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const MINUS = "\u2212";
export const formatMoney = (n: number) => `${n < 0 ? MINUS : ""}${Math.abs(Math.round(n)).toLocaleString("vi-VN")} ₫`;

/** "10/2026" */
export const billMonthLabel = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

/** "d/m" theo giờ VN. */
export const shortDay = (at: string) => {
  const [, m, d] = dayKey(at).split("-");
  return `${Number(d)}/${Number(m)}`;
};

export interface StatementInput {
  tenantName: string;
  month: string;
  status: "draft" | "issued";
  /** Lần sửa gần nhất sau khi gửi (ISO), `null` = chưa sửa. */
  editedAt: string | null;
  items: readonly BillItem[];
  /** Bản tính gần nhất trước tháng này (UC-807 1a: không có thì không so). */
  previous: { month: string; total: number } | null;
  /** "MB Bank · 0123456789 · nội dung TIEN NHA T10 AN" khi có QR, `null` thì không có dòng chuyển khoản. */
  transfer: string | null;
  /** Nợ (dương) / trả dư (âm) các tháng trước — một dòng riêng, không cộng vào tổng (QĐ4). */
  previousBalance: number;
}

/** Tin gửi người thuê (UC-807 bước 1). */
export function statementText(input: StatementInput): string {
  const { month } = input;
  const monthName = (m: string) => (m.slice(0, 4) === month.slice(0, 4) ? `tháng ${Number(m.slice(5, 7))}` : `tháng ${billMonthLabel(m)}`);
  const out: string[] = [];
  if (input.status === "draft") out.push("(nháp)");
  else if (input.editedAt) out.push(`(đã sửa ${shortDay(input.editedAt)}, thay tin trước)`);
  out.push(`Tiền nhà tháng ${billMonthLabel(month)} — ${input.tenantName}`);
  for (const c of BILL_CATEGORIES) {
    const group = input.items.filter((i) => i.category === c);
    if (!group.length) continue;
    out.push(CATEGORY_LABEL[c]);
    for (const i of group) out.push(`· ${i.name}: ${formatMoney(i.amount)}`);
  }
  const { total } = billTotals(input.items);
  let compare = "";
  if (input.previous) {
    const diff = total - input.previous.total;
    const change = diff > 0 ? `nhiều hơn ${formatMoney(diff)}` : diff < 0 ? `ít hơn ${formatMoney(-diff)}` : "không đổi";
    compare = ` (${monthName(input.previous.month)}: ${formatMoney(input.previous.total)}, ${change})`;
  }
  out.push(`Tổng ${monthName(month)}: ${formatMoney(total)}${compare}`);
  if (input.transfer) out.push(`Chuyển khoản: ${input.transfer}`);
  if (input.previousBalance > 0) out.push(`Các tháng trước còn nợ ${formatMoney(input.previousBalance)} (chưa tính ở trên)`);
  else if (input.previousBalance < 0) out.push(`Các tháng trước trả dư ${formatMoney(-input.previousBalance)} (chưa tính ở trên)`);
  return out.join("\n");
}
