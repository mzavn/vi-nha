// Lưu chuyển tiền và Kết quả thu chi (balance UC-1105, UC-1106; pwa UC-717 AC-3): kỳ tháng / năm, câu chữ, phân loại lại.
// Thuần để test. Mọi số đã tính ở server (GET /v1/reports/…); ở đây chỉ chọn kỳ và dựng chữ.

import { formatVnd } from "./money";
import { dateText, pctText, signedVnd } from "./net-worth";
import { shortDate } from "./period";
import { MEANING_LABEL } from "./transactions";
import type { CashFlow, CashFlowMonth, IncomeStatement, IncomeStatementMonth, ReportClass, ReportTx, StatementLine } from "./types";

export type PeriodKind = "month" | "year";

/** Kỳ hiện tại theo ngày hôm nay (giờ VN, "YYYY-MM-DD"): "2026-10" hoặc "2026". */
export const currentPeriod = (kind: PeriodKind, today: string): string => (kind === "month" ? today.slice(0, 7) : today.slice(0, 4));

export const periodKind = (period: string): PeriodKind => (period.length === 4 ? "year" : "month");

/** Kỳ liền trước / liền sau: tháng qua năm thì đổi năm. */
export function shiftPeriod(period: string, step: -1 | 1): string {
  if (periodKind(period) === "year") return String(Number(period) + step);
  const [y, m] = period.split("-").map(Number) as [number, number];
  const n = y * 12 + (m - 1) + step;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}

/** Không có `›` khi đang ở kỳ hiện tại (UC-717 AC-3). */
export const canGoNext = (period: string, today: string): boolean => period < currentPeriod(periodKind(period), today);

/** Kỳ trên địa chỉ "#net-worth/cash-flow/2026-09" (F5 giữ kỳ, UC-717 AC-3): kỳ lạ hoặc sau hôm nay → tháng hiện tại. */
export function periodFromHash(hash: string, today: string): string {
  const p = hash.replace(/^#/, "").split("/")[2] ?? "";
  const valid = /^\d{4}$/.test(p) || (/^\d{4}-(0[1-9]|1[0-2])$/.test(p));
  return valid && p <= currentPeriod(periodKind(p), today) ? p : currentPeriod("month", today);
}

/** Địa chỉ của phần báo cáo kèm kỳ. */
export const periodHash = (section: "cash-flow" | "income", period: string): string => `#net-worth/${section}/${period}`;

/** Đổi Tháng ↔ Năm: giữ năm đang xem; năm nay thì về tháng hiện tại, năm trước thì về tháng 12. */
export function switchKind(period: string, kind: PeriodKind, today: string): string {
  if (periodKind(period) === kind) return period;
  if (kind === "year") return period.slice(0, 4);
  return period === today.slice(0, 4) ? today.slice(0, 7) : `${period}-12`;
}

/** "Tháng 10/2026" · "Năm 2026". */
export const periodLabel = (period: string): string => (periodKind(period) === "year" ? `Năm ${period}` : `Tháng ${Number(period.slice(5, 7))}/${period.slice(0, 4)}`);

/** Ngày cuối kỳ để chú "= Σ sổ tài khoản ngày 31/10": kỳ đang chạy thì hôm nay. */
export function periodEnd(period: string, today: string): string {
  if (!canGoNext(period, today)) return today;
  if (periodKind(period) === "year") return `${period}-12-31`;
  const [y, m] = period.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

// ── Lưu chuyển tiền ────────────────────────────────────────────────

export const GROUP_LABEL: Record<CashFlow["groups"][number]["group"], string> = { operating: "Sinh hoạt", investing: "Đầu tư", financing: "Tài chính" };

export interface SummaryRow {
  key: string;
  label: string;
  value: number;
  /** Có dấu ± (ba nhóm, mở / tắt trong kỳ); đầu kỳ, cuối kỳ thì không. */
  signed: boolean;
  strong?: boolean;
}

/** Card tóm tắt: Tiền đầu kỳ · (Tài khoản mở trong kỳ) · (Tài khoản tắt trong kỳ) · Sinh hoạt · Đầu tư · Tài chính · Tiền cuối kỳ. */
export function cashFlowSummary(cf: Pick<CashFlow, "opening" | "openedAccounts" | "closedAccounts" | "groups" | "closing">): SummaryRow[] {
  const rows: (SummaryRow | false)[] = [
    { key: "opening", label: "Tiền đầu kỳ", value: cf.opening, signed: false },
    cf.openedAccounts !== 0 && { key: "opened", label: "Tài khoản mở trong kỳ", value: cf.openedAccounts, signed: true },
    cf.closedAccounts !== 0 && { key: "closed", label: "Tài khoản tắt trong kỳ", value: cf.closedAccounts, signed: true },
    ...cf.groups.map((g) => ({ key: g.group, label: GROUP_LABEL[g.group], value: g.total, signed: true })),
    { key: "closing", label: "Tiền cuối kỳ", value: cf.closing, signed: false, strong: true },
  ];
  return rows.filter((r): r is SummaryRow => r !== false);
}

/** Chú dưới số cuối kỳ: "= Σ sổ tài khoản ngày 31/10/2026" (+ "Gồm −3.000.000 ₫ thẻ tín dụng — ở bảng cân đối nằm ở Nợ ngắn hạn"). */
export function closingNotes(cf: Pick<CashFlow, "to" | "creditCardDebt">): string[] {
  return [
    `= Σ sổ tài khoản ngày ${dateText(cf.to)}`,
    ...(cf.creditCardDebt > 0 ? [`Gồm ${formatVnd(-cf.creditCardDebt)} thẻ tín dụng — ở bảng cân đối nằm ở Nợ ngắn hạn`] : []),
  ];
}

/** Ghi chú dưới nhóm Đầu tư (balance UC-1105 AC-4): "Lô mua ghi ở màn tài sản: 10.200.000 ₫ — không cộng vào tổng". */
export function lotNoteText(n: CashFlow["lotNote"]): string | null {
  const parts = [n.bought > 0 ? `lô mua ${formatVnd(n.bought)}` : null, n.sold > 0 ? `lô bán ${formatVnd(n.sold)}` : null].filter((x): x is string => x !== null);
  if (parts.length === 0) return null;
  const text = parts.join(", ");
  return `${text[0]!.toUpperCase()}${text.slice(1)} ghi ở màn tài sản — không cộng vào tổng`;
}

/** Dòng phụ của một dòng nhóm: "3 giao dịch" · "3 giao dịch, 1 đã xếp lại". */
export const lineSub = (l: { count: number; reclassified: number }): string => `${l.count} giao dịch${l.reclassified > 0 ? `, ${l.reclassified} đã xếp lại` : ""}`;

/** Hàng "Từng tháng" của kỳ năm: tháng trái, cuối kỳ phải; dòng phụ "sinh hoạt +16.400.000 ₫ · đầu tư −5.800.000 ₫ · tài chính +44.400.000 ₫". */
export function cashFlowMonthSub(m: CashFlowMonth): string {
  return [
    m.openedAccounts !== 0 ? `mở ${signedVnd(m.openedAccounts)}` : null,
    m.closedAccounts !== 0 ? `tắt ${signedVnd(m.closedAccounts)}` : null,
    `sinh hoạt ${signedVnd(m.operating)}`,
    `đầu tư ${signedVnd(m.investing)}`,
    `tài chính ${signedVnd(m.financing)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ── Phân loại lại (chỉ đổi báo cáo) ────────────────────────────────

export const CLASS_LABEL: Record<ReportClass, string> = { operating: "Sinh hoạt", passive_income: "Thu nhập thụ động", investing: "Đầu tư", financing: "Tài chính" };

/** Nhóm chọn được cho một giao dịch: "Thu nhập thụ động" chỉ cho khoản thu (server trả `invalid_class` nếu khác). */
export const classOptions = (meaning: string): ReportClass[] =>
  meaning === "income" ? ["operating", "passive_income", "investing", "financing"] : ["operating", "investing", "financing"];

/** Tên một giao dịch trong danh sách của dòng: danh mục, không có thì loại ("Thu nhập", "Mua tài sản"…). */
export const reportTxTitle = (t: ReportTx): string => t.categoryName ?? MEANING_LABEL[t.meaning] ?? t.meaning;

/** Dòng phụ: "15/10 · VCB · ví Ăn uống · ghi chú". */
export const reportTxSub = (t: ReportTx): string => [shortDate(t.at), t.accountName, t.walletName ? `ví ${t.walletName}` : null, t.note].filter(Boolean).join(" · ");

/** Toast sau khi xếp lại: "Đã xếp khoản 50.000.000 ₫ vào Tài chính — chỉ đổi báo cáo, ví và số dư giữ nguyên." */
export const reclassToast = (amount: number, cls: ReportClass | null): string =>
  cls
    ? `Đã xếp khoản ${formatVnd(Math.abs(amount))} vào ${CLASS_LABEL[cls]} — chỉ đổi báo cáo, ví và số dư giữ nguyên.`
    : `Đã đưa khoản ${formatVnd(Math.abs(amount))} về nhóm mặc định.`;

// ── Kết quả thu chi ────────────────────────────────────────────────

/** Chi tiêu: ẩn dòng 0 (cả dòng con); thu nhập luôn đủ ba dòng. */
export const shownExpenseLines = (lines: StatementLine[]): StatementLine[] =>
  lines.filter((l) => l.total !== 0).map((l) => (l.children ? { ...l, children: l.children.filter((c) => c.total !== 0) } : l));

/** "tỷ lệ 50,3%"; thu nhập 0 → "tỷ lệ —". */
export const savingsRateText = (rate: number | null): string => `tỷ lệ ${pctText(rate)}`;

/** Chân: "Không tính: trả nợ gốc 5.000.000 ₫, mua tài sản 6.000.000 ₫, phân loại lại Tài chính 50.000.000 ₫, điều chỉnh −100.000 ₫ — xem Lưu chuyển tiền." */
export function excludedText(x: IncomeStatement["excluded"]): string | null {
  const parts = [
    x.debtPrincipal ? `trả nợ gốc ${formatVnd(x.debtPrincipal)}` : null,
    x.buyAsset ? `mua tài sản ${formatVnd(x.buyAsset)}` : null,
    x.reclassifiedInvesting ? `phân loại lại Đầu tư ${formatVnd(x.reclassifiedInvesting)}` : null,
    x.reclassifiedFinancing ? `phân loại lại Tài chính ${formatVnd(x.reclassifiedFinancing)}` : null,
    x.adjust ? `điều chỉnh ${formatVnd(x.adjust)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? `Không tính: ${parts.join(", ")} — xem Lưu chuyển tiền.` : null;
}

/** Hàng "Từng tháng" của Thu chi: "thu 33.200.000 ₫ · chi 16.500.000 ₫ · tỷ lệ 50,3%". */
export const statementMonthSub = (m: IncomeStatementMonth): string => `thu ${formatVnd(m.income)} · chi ${formatVnd(m.expense)} · ${savingsRateText(m.savingsRate)}`;
