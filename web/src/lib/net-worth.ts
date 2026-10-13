// Màn Tài sản & tự do (pwa UC-717), phần Cân đối và Tháp: nhãn mục, câu chữ từng dòng, lô, chốt lời / cắt lỗ, lịch sử, thân các request ghi.
// Thuần để test. Mọi số đã tính ở server (GET /v1/balance-sheet — balance UC-1101, UC-1102); ở đây chỉ dựng chữ và kiểm ô nhập.
// Phần trăm server trả đã cắt về 0 sau một chữ số lẻ; null = mẫu số 0 → "—".

import { formatVnd, groupDigits, MINUS, moneyDigits } from "./money";
import type { Result } from "./settings";
import type { BalanceHistoryPoint, BalanceItem, BalanceLot, BalancePosition, BalanceRow, BalanceSection, BalanceValue, LiabilityRow, PyramidTier } from "./types";

type Errors = Record<string, string>;

// ── Nhãn ───────────────────────────────────────────────────────────

export const SECTION_LABEL: Record<BalanceSection, string> = {
  A1: "1. Tiền và tương đương",
  A2: "2. Đầu tư tài chính ngắn hạn",
  A3: "3. Phải thu ngắn hạn",
  A4: "4. Hàng tồn kho",
  A5: "5. Tài sản ngắn hạn khác",
  B1: "1. Phải thu dài hạn",
  B2: "2. Tài sản cố định",
  B3: "3. Bất động sản đầu tư",
  B4: "4. Tài sản dở dang",
  B5: "5. Đầu tư tài chính dài hạn",
  B6: "6. Tài sản dài hạn khác",
};

/** Mục chọn được khi thêm tài sản tay: không có A3 — phải thu ghi ở sổ phải thu (tab Nợ). */
export const ITEM_SECTIONS: BalanceSection[] = ["A1", "A2", "A4", "A5", "B1", "B2", "B3", "B4", "B5", "B6"];

export const sectionGroupLabel = (s: BalanceSection): string => (s.startsWith("A") ? "A. Tài sản ngắn hạn" : "B. Tài sản dài hạn");

/** Năm tầng, từ đỉnh xuống đáy. */
export const PYRAMID: { tier: PyramidTier; label: string }[] = [
  { tier: "speculative", label: "Mạo hiểm" },
  { tier: "growth", label: "Tăng trưởng" },
  { tier: "income", label: "Tạo thu nhập" },
  { tier: "protective", label: "Phòng vệ" },
  { tier: "fixed", label: "Cố định" },
];
export const pyramidLabel = (t: PyramidTier): string => PYRAMID.find((p) => p.tier === t)?.label ?? t;

export const TERM_LABEL = { short: "Ngắn hạn", long: "Dài hạn" } as const;
export const INTEREST_GROUP_LABEL = { none: "Không lãi", normal: "Lãi thường", high: "Lãi cao" } as const;

export const ASSET_KIND_LABEL = { gold: "Vàng", stock: "Chứng khoán", fund: "Chứng chỉ quỹ", re: "Bất động sản" } as const;

// ── Số và ngày ─────────────────────────────────────────────────────

const comma = (n: number): string => String(n).replace(".", ",").replace("-", MINUS);

/** 15.5 → "15,5%"; null → "—". */
export const pctText = (p: number | null): string => (p === null ? "—" : `${comma(p)}%`);

/** Có dấu và luôn một chữ số lẻ: 5 → "+5,0%", −12.5 → "−12,5%"; null → "—". */
export const signedPct = (p: number | null): string => (p === null ? "—" : `${p > 0 ? "+" : ""}${comma(Number(p.toFixed(1))).replace(/^(−?\d+)$/, "$1,0")}%`);

/** 1200 → "12"; 1250 → "12,5". */
export const bpsText = (bps: number): string => comma(bps / 100);

/** "+2.000.000 ₫" · "−3.000.000 ₫" · "0 ₫". */
export const signedVnd = (n: number): string => (n > 0 ? `+${formatVnd(n)}` : formatVnd(n));

/** "2026-11-15" → "15/11/2026". */
export function dateText(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return `${d}/${m}/${y}`;
}
/** "2026-11-01" → "1/11". */
const dayMonth = (day: string): string => dateText(day).replace(/\/\d+$/, "");

/** 24000 phần nghìn → "24 chỉ"; 500 → "0,5 chỉ". */
export const quantityText = (milli: number, unit: string | null): string => `${groupDigits(milli / 1000)}${unit ? ` ${unit}` : ""}`;

/** "2026-11" → "11/2026". */
export const monthText = (month: string): string => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

// ── Dòng bảng cân đối ──────────────────────────────────────────────

/** "dòng tiền 250.000 ₫/tháng (3.000.000 ₫/năm) · kỳ vọng 12%/năm" (balance UC-1101 AC-5); không có thì phần đó bỏ. */
export function returnText(x: Pick<BalanceItem, "cashflow" | "cashflowPeriod" | "cashflowMonthly" | "expectedReturnBps">): string | null {
  const parts: string[] = [];
  if (x.cashflow > 0 && x.cashflowMonthly !== null) {
    parts.push(x.cashflowPeriod === "year" ? `dòng tiền ${formatVnd(x.cashflowMonthly)}/tháng (${formatVnd(x.cashflow)}/năm)` : `dòng tiền ${formatVnd(x.cashflowMonthly)}/tháng`);
  }
  if (x.expectedReturnBps !== null) parts.push(`kỳ vọng ${bpsText(x.expectedReturnBps)}%/năm`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Dòng phụ 12px của một dòng tài sản: "15,5% tổng · 25,6% vốn chủ · dòng tiền … · kỳ vọng 12%/năm · giá ngày 1/11". */
export function assetRowSub(row: BalanceRow, item: BalanceItem | null): string {
  const ret = item ? returnText(item) : row.cashflowMonthly || row.expectedReturnBps !== null ? returnText({ cashflow: row.cashflowMonthly ?? 0, cashflowPeriod: "month", cashflowMonthly: row.cashflowMonthly, expectedReturnBps: row.expectedReturnBps }) : null;
  return [`${pctText(row.pctOfTotal)} tổng`, `${pctText(row.pctOfEquity)} vốn chủ`, ret, row.valuedOn ? `giá ngày ${dayMonth(row.valuedOn)}` : null].filter(Boolean).join(" · ");
}

/** Mục theo lô: "24 chỉ · lãi +2.000.000 ₫ (+1,6%)"; chip "1 lô chạm cắt lỗ" / "2 lô chạm chốt lời". */
export function lotsSummary(item: BalanceItem): { text: string | null; chips: { label: string; tone: "ok" | "bad" }[] } {
  if (item.measure !== "units") return { text: null, chips: [] };
  const u = item.unrealized;
  const text = [quantityText(item.heldQuantityMilli, item.unit), u === null ? null : `${u < 0 ? "lỗ" : "lãi"} ${signedVnd(u)} (${signedPct(item.unrealizedPct)})`].filter(Boolean).join(" · ");
  const chips: { label: string; tone: "ok" | "bad" }[] = [];
  if (item.hitTakeProfit > 0) chips.push({ label: `${item.hitTakeProfit} lô chạm chốt lời`, tone: "ok" });
  if (item.hitStopLoss > 0) chips.push({ label: `${item.hitStopLoss} lô chạm cắt lỗ`, tone: "bad" });
  return { text, chips };
}

/** Dòng phụ của một khoản nợ: "% tổng · % vốn chủ" rồi phần lãi (khoản có lãi) — "18%/năm · lãi 3.600.000 ₫/năm · tháng này 300.000 ₫ · trả ngày 5". */
export function liabilityRowSub(r: LiabilityRow): string {
  const interest =
    r.interestRateBps > 0
      ? [`${bpsText(r.interestRateBps)}%/năm`, `lãi ${formatVnd(r.interestPerYear)}/năm`, `tháng này ${formatVnd(r.interestThisMonth)}`, r.dueDay ? `trả ngày ${r.dueDay}` : null]
      : [];
  return [`${pctText(r.pctOfTotal)} tổng`, `${pctText(r.pctOfEquity)} vốn chủ`, ...interest].filter(Boolean).join(" · ");
}

/** Tên dòng nợ: thẻ tín dụng còn nợ ghi rõ "Thẻ tín dụng · Thẻ VCB" (ADR nháp I). */
export const liabilityName = (r: LiabilityRow): string => (r.kind === "credit_card" ? `Thẻ tín dụng · ${r.name}` : r.name);

/** Dòng từ sổ không mở sheet sửa: chạm → màn nguồn (pwa UC-717 AC-1). */
export type LedgerTarget = { tab: "wallets"; walletsTab: "accounts" | "debts" | "tenants" | "wealth-building" };
export function ledgerTarget(key: string): LedgerTarget {
  if (key.startsWith("app:")) return { tab: "wallets", walletsTab: "wealth-building" };
  if (key === "tenants" || key === "tenants-prepaid") return { tab: "wallets", walletsTab: "tenants" };
  if (key.startsWith("receivables") || key.startsWith("debt:")) return { tab: "wallets", walletsTab: "debts" };
  return { tab: "wallets", walletsTab: "accounts" };
}

// ── Khoản đầu tư: lãi / lỗ, chốt lời / cắt lỗ, CAGR (Công thức 17) ──

/** "+5.000.000 ₫ (+5,0%)"; giá mua 0 → "+5.000.000 ₫ (—)". */
export const pnlText = (p: Pick<BalancePosition, "pnl" | "pnlPct">): string => `${signedVnd(p.pnl)} (${signedPct(p.pnlPct)})`;

export function statusLabel(p: Pick<BalancePosition, "status" | "toTakeProfitPct" | "toStopLossPct">): { label: string; tone: "ok" | "bad" | null } {
  if (p.status === "take_profit") return { label: `Đã chạm chốt lời${p.toTakeProfitPct === null ? "" : ` (${signedPct(-p.toTakeProfitPct)})`}`, tone: "ok" };
  if (p.status === "stop_loss") return { label: `Đã chạm cắt lỗ${p.toStopLossPct === null ? "" : ` (${signedPct(p.toStopLossPct)})`}`, tone: "bad" };
  return { label: "Đang giữ", tone: null };
}

/** "còn cách chốt lời 4,7%", "còn cách cắt lỗ 8,5%" — chỉ khi đang giữ và có đặt giá. */
export function targetTexts(p: BalancePosition): string[] {
  if (p.status !== "holding") return [];
  return [p.toTakeProfitPct !== null ? `còn cách chốt lời ${pctText(p.toTakeProfitPct)}` : null, p.toStopLossPct !== null ? `còn cách cắt lỗ ${pctText(p.toStopLossPct)}` : null].filter(
    (x): x is string => x !== null,
  );
}

/** "CAGR 14,4%/năm — cao hơn kỳ vọng 2,4 điểm" · "+5,0% từ ngày mua (chưa đủ 1 năm)" · giá mua / giá hiện tại 0 → "CAGR —". */
export function growthText(p: BalancePosition): string {
  if (p.heldDays !== null && p.heldDays < 365) return `${signedPct(p.pnlPct)} từ ngày mua (chưa đủ 1 năm)`;
  if (p.cagrPct === null) return "CAGR —";
  const cagr = `CAGR ${pctText(p.cagrPct)}/năm`;
  if (p.cagrVsExpected === null) return cagr;
  if (p.cagrVsExpected === 0) return `${cagr} — bằng kỳ vọng`;
  return `${cagr} — ${p.cagrVsExpected > 0 ? "cao" : "thấp"} hơn kỳ vọng ${comma(Math.abs(p.cagrVsExpected))} điểm`;
}

/** Một câu cho một lô / mục: lãi / lỗ · khoảng cách · trạng thái · tăng trưởng (đã chạm giá thì chỉ lãi / lỗ và trạng thái). */
export function positionText(p: BalancePosition): string {
  const st = statusLabel(p).label;
  return p.status === "holding" ? [pnlText(p), ...targetTexts(p), st, growthText(p)].join(" · ") : [pnlText(p), st].join(" · ");
}

/** Hàng lô: "Mua 10/3/2026 · 20 chỉ × 5.000.000 ₫". */
export const lotTitle = (l: BalanceLot, unit: string | null): string => `Mua ${dateText(l.boughtOn)} · ${quantityText(l.quantityMilli, unit)} × ${formatVnd(l.unitCost)}`;

/** Dòng phụ lô đang giữ: "giá trị 105.000.000 ₫ · chốt lời 5.500.000 · còn 4,7% · cắt lỗ 4.800.000 · còn 8,5%". */
export function lotSub(l: BalanceLot): string {
  const p = l.position;
  const holding = p?.status === "holding";
  return [
    `giá trị ${formatVnd(l.value)}`,
    l.takeProfitPrice !== null ? `chốt lời ${moneyDigits(l.takeProfitPrice)}` : null,
    l.takeProfitPrice !== null && holding && p.toTakeProfitPct !== null ? `còn ${pctText(p.toTakeProfitPct)}` : null,
    l.stopLossPrice !== null ? `cắt lỗ ${moneyDigits(l.stopLossPrice)}` : null,
    l.stopLossPrice !== null && holding && p.toStopLossPct !== null ? `còn ${pctText(p.toStopLossPct)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Lô đã bán: "Bán 10/11/2026 × 5.300.000 ₫ · đã chốt −2.800.000 ₫". */
export const soldLotText = (l: BalanceLot): string =>
  `Bán ${l.soldOn ? dateText(l.soldOn) : "—"} × ${formatVnd(l.soldUnitPrice ?? 0)} · đã chốt ${signedVnd(l.realized ?? 0)}`;

/** Hàng tổng các lô: "Vốn 124.000.000 ₫ · lãi chưa chốt +2.000.000 ₫ (+1,6%) · 1 lô đã chạm cắt lỗ". */
export function lotsTotalText(item: BalanceItem): string {
  return [
    `Vốn ${formatVnd(item.cost)}`,
    item.unrealized === null ? null : `${item.unrealized < 0 ? "lỗ" : "lãi"} chưa chốt ${signedVnd(item.unrealized)} (${signedPct(item.unrealizedPct)})`,
    item.hitTakeProfit > 0 ? `${item.hitTakeProfit} lô đã chạm chốt lời` : null,
    item.hitStopLoss > 0 ? `${item.hitStopLoss} lô đã chạm cắt lỗ` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Lịch sử định giá: "1/11/2026 · 5.250.000 ₫/chỉ · dòng tiền 3.000.000 ₫/năm · kỳ vọng 12%/năm". */
export function valueText(v: BalanceValue, unit: string | null): string {
  const amount = v.unitPrice !== null ? `${formatVnd(v.unitPrice)}${unit ? `/${unit}` : ""}` : formatVnd(v.value ?? 0);
  return [
    dateText(v.asOf),
    amount,
    v.cashflow > 0 ? `dòng tiền ${formatVnd(v.cashflow)}/${v.cashflowPeriod === "year" ? "năm" : "tháng"}` : null,
    v.expectedReturnBps !== null ? `kỳ vọng ${bpsText(v.expectedReturnBps)}%/năm` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Toast sau khi cập nhật giá (pwa UC-717 AC-2): "Đã cập nhật giá Vàng: 5.250.000 ₫/chỉ ngày 15/11/2026." */
export function valueToast(item: Pick<BalanceItem, "name" | "measure" | "unit">, amount: number, day: string): string {
  return item.measure === "units"
    ? `Đã cập nhật giá ${item.name}: ${formatVnd(amount)}${item.unit ? `/${item.unit}` : ""} ngày ${dateText(day)}.`
    : `Đã cập nhật giá trị ${item.name}: ${formatVnd(amount)} ngày ${dateText(day)}.`;
}

// ── Tháp, lịch sử ──────────────────────────────────────────────────

/** "Dòng tiền thật 250.000 ₫/tháng · sau bù lạm phát 104.166 ₫/tháng". */
export const cashflowFooter = (p: number, net: number): string => `Dòng tiền thật ${formatVnd(p)}/tháng · sau bù lạm phát ${formatVnd(net)}/tháng`;

/** Hàng "Theo tháng": "tài sản 811.000.000 ₫ · nợ 320.000.000 ₫ · so tháng trước +6.000.000 ₫". */
export function historySub(p: BalanceHistoryPoint): string {
  return [`tài sản ${formatVnd(p.totalAssets)}`, `nợ ${formatVnd(p.totalLiabilities)}`, p.change === null ? null : `so tháng trước ${signedVnd(p.change)}`].filter(Boolean).join(" · ");
}

// ── Ô nhập ─────────────────────────────────────────────────────────

/** "12,5" / "12.5" / "−3" → số; trống → null; không đọc được → NaN. */
function parseDecimal(text: string): number | null {
  const t = text.trim().replace("%", "").replace(",", ".").replace(MINUS, "-").trim();
  if (t === "") return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

export interface ItemForm {
  name: string;
  section: BalanceSection;
  pyramid: PyramidTier;
  measure: "value" | "units";
  unit: string;
  liquid: boolean;
  investable: boolean;
  assetKind: "" | "gold" | "stock" | "fund" | "re";
  note: string;
}

/** Cờ mặc định theo mục / tầng (balance UC-1101 (1)): Tiền lỏng bật ở A1; Tài sản đầu tư tắt ở tầng cố định. */
export const defaultFlags = (section: BalanceSection, pyramid: PyramidTier): { liquid: boolean; investable: boolean } => ({ liquid: section === "A1", investable: pyramid !== "fixed" });

export function itemToForm(i: BalanceItem | null): ItemForm {
  if (!i) return { name: "", section: "A1", pyramid: "protective", measure: "value", unit: "", ...defaultFlags("A1", "protective"), assetKind: "", note: "" };
  return { name: i.name, section: i.section, pyramid: i.pyramid, measure: i.measure, unit: i.unit ?? "", liquid: i.liquid, investable: i.investable, assetKind: i.assetKind ?? "", note: i.note ?? "" };
}

/** Thân POST / PATCH /v1/balance-items. Sửa: không gửi `measure` (đổi được chỉ khi chưa có dòng — server kiểm). */
export function itemPayload(f: ItemForm, existing: BalanceItem | null): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên tài sản.";
  const unit = f.unit.trim();
  if (f.measure === "units" && !unit) errors.unit = "Nhập đơn vị (chỉ, lượng, cổ phiếu…).";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const body: Record<string, unknown> = {
    name,
    section: f.section,
    pyramid: f.pyramid,
    liquid: f.liquid,
    investable: f.investable,
    asset_kind: f.assetKind || null,
    note: f.note.trim() || null,
  };
  if (!existing || existing.measure !== f.measure) body.measure = f.measure;
  if (f.measure === "units") body.unit = unit;
  return { ok: true, value: body };
}

export interface ValueForm {
  day: string;
  /** Giá trị (mục theo giá trị) hoặc giá một đơn vị (mục theo lô). */
  amount: number;
  cashflow: number;
  period: "month" | "year";
  /** %/năm, chữ người dùng gõ. */
  expected: string;
}

/** Ô điền sẵn từ dòng mới nhất (balance UC-1101 (3)). */
export function valueToForm(item: BalanceItem, today: string): ValueForm {
  const last = item.values[0];
  return {
    day: today,
    amount: (item.measure === "units" ? item.unitPrice : item.value) ?? 0,
    cashflow: last?.cashflow ?? 0,
    period: last?.cashflowPeriod ?? "month",
    expected: last?.expectedReturnBps != null ? bpsText(last.expectedReturnBps) : "",
  };
}

/** Thân POST /v1/balance-items/:id/values: `value` hoặc `unit_price` theo cách tính; dòng tiền > 0 luôn kèm kỳ; lợi suất −100…1000%. */
export function valuePayload(f: ValueForm, measure: "value" | "units", today: string): Result<Record<string, unknown>> {
  const errors: Errors = {};
  if (!f.day || f.day > today) errors.day = "Chọn ngày từ hôm nay trở về trước.";
  if (!Number.isInteger(f.amount) || f.amount < 0) errors.amount = "Nhập số không âm.";
  const expected = parseDecimal(f.expected);
  if (Number.isNaN(expected) || (expected !== null && (expected < -100 || expected > 1000))) errors.expected = "Lợi suất là số từ −100 đến 1000 (%/năm).";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      as_of: f.day,
      [measure === "units" ? "unit_price" : "value"]: f.amount,
      ...(f.cashflow > 0 ? { cashflow: f.cashflow, cashflow_period: f.period } : {}),
      ...(expected !== null ? { expected_return: expected } : {}),
    },
  };
}

export interface LotForm {
  day: string;
  /** Số lượng, tới 3 chữ số lẻ ("20", "0,5"). */
  quantity: string;
  unitCost: number;
  note: string;
}

export function lotPayload(f: LotForm, today: string): Result<{ bought_on: string; quantity: number; unit_cost: number; note?: string }> {
  const errors: Errors = {};
  if (!f.day || f.day > today) errors.day = "Chọn ngày mua từ hôm nay trở về trước.";
  const t = f.quantity.trim().replace(",", ".");
  const q = /^\d+(\.\d{1,3})?$/.test(t) ? Number(t) : NaN;
  if (!(q > 0)) errors.quantity = "Số lượng lớn hơn 0, tối đa 3 chữ số lẻ.";
  if (!Number.isInteger(f.unitCost) || f.unitCost < 0) errors.unitCost = "Nhập giá mua một đơn vị.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { bought_on: f.day, quantity: q, unit_cost: f.unitCost, ...(f.note.trim() ? { note: f.note.trim() } : {}) } };
}

export function sellPayload(f: { day: string; price: number }, lot: Pick<BalanceLot, "boughtOn">, today: string): Result<{ sold_on: string; sold_unit_price: number }> {
  const errors: Errors = {};
  if (!f.day || f.day > today) errors.day = "Chọn ngày bán từ hôm nay trở về trước.";
  else if (f.day < lot.boughtOn) errors.day = `Ngày bán không trước ngày mua ${dateText(lot.boughtOn)}.`;
  if (!Number.isInteger(f.price) || f.price < 0) errors.price = "Nhập giá bán một đơn vị.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { sold_on: f.day, sold_unit_price: f.price } };
}

/** Giá chốt lời / cắt lỗ: để trống (0) = bỏ; có cả hai thì cắt lỗ phải thấp hơn chốt lời. */
export function targetsPayload(f: { takeProfit: number; stopLoss: number }): Result<{ take_profit_price: number | null; stop_loss_price: number | null }> {
  const tp = f.takeProfit > 0 ? f.takeProfit : null;
  const sl = f.stopLoss > 0 ? f.stopLoss : null;
  if (tp !== null && sl !== null && sl >= tp) return { ok: false, errors: { stopLoss: "Giá cắt lỗ phải thấp hơn giá chốt lời." } };
  return { ok: true, value: { take_profit_price: tp, stop_loss_price: sl } };
}

/** Giá mua & mục tiêu của mục theo giá trị: PATCH /v1/balance-items/:id. */
export function itemTargetsPayload(f: { costBasis: number; acquiredOn: string; takeProfit: number; stopLoss: number }, today: string): Result<Record<string, unknown>> {
  const t = targetsPayload(f);
  if (!t.ok) return t;
  if (f.acquiredOn && f.acquiredOn > today) return { ok: false, errors: { acquiredOn: "Chọn ngày mua từ hôm nay trở về trước." } };
  return {
    ok: true,
    value: {
      cost_basis: f.costBasis > 0 ? f.costBasis : null,
      acquired_on: f.acquiredOn || null,
      take_profit_value: t.value.take_profit_price,
      stop_loss_value: t.value.stop_loss_price,
    },
  };
}
