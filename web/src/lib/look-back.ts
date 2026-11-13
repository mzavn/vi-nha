// Ví & quỹ › Nhìn lại (pwa UC-707, ledger UC-108, pocket UC-1204 — ADR-144): câu chữ của tab từ `GET /v1/spend-by-category`,
// theo tháng dương lịch. Thuần để test. Mọi số tiền qua `formatVnd` (che số, UC-718); %, số ngày, tháng không che. Hạn mức mềm chỉ
// để nhìn: không số âm, không nút gì để "lấy thêm" — chỉ "còn" hoặc "vượt".

import type { LookBack, LookBackGroup, LookBackSavings } from "../../../src/domain/look-back";
import { formatVnd } from "./money";
import { levelText } from "./savings-scale";

export const LOOK_BACK_NOTE = "Hạn mức mềm chỉ để nhìn lại, không giữ tiền, không âm, không bù.";
export const LOOK_BACK_EMPTY = "Chưa có khoản chi nào trong tháng này và tháng trước.";

/** `GET /v1/spend-by-category`: không gửi tháng = tháng hiện tại; tháng khác `?period=YYYY-MM`. */
export const lookBackPath = (month: string | null): string => (month ? `/v1/spend-by-category?period=${month}` : "/v1/spend-by-category");

/** "2026-11" → "11/2026". */
const monthText = (month: string) => `${Number(month.slice(5, 7))}/${month.slice(0, 4)}`;

/**
 * Đầu tab (UC-707 AC-40): tháng đang chạy "Tháng 11/2026 · còn 5 ngày" (còn = days − daysElapsed; ngày cuối tháng → "ngày cuối
 * tháng"); tháng đã qua "Tháng 10/2026".
 */
export function monthHeading(d: Pick<LookBack, "month" | "next" | "days" | "daysElapsed">): string {
  const head = `Tháng ${monthText(d.month)}`;
  if (d.next !== null) return head;
  const left = d.days - d.daysElapsed;
  return left > 0 ? `${head} · còn ${left} ngày` : `${head} · ngày cuối tháng`;
}

/** Nút ‹ / ›: tháng liền trước / kế; về tháng hiện tại thì địa chỉ không mang tháng (`month` null). null = không có nút. */
export function stepMonth(d: Pick<LookBack, "previous" | "next">, dir: -1 | 1, currentMonth: string): { month: string | null } | null {
  const target = dir < 0 ? d.previous : d.next;
  if (!target) return null;
  return { month: target === currentMonth ? null : target };
}

/** "còn 500.000 ₫" / "vượt 200.000 ₫"; nhóm không hạn mức → null. */
export function limitText(g: Pick<LookBackGroup, "left" | "over">): string | null {
  if (g.over) return `vượt ${formatVnd(g.over)}`;
  return g.left === null ? null : `còn ${formatVnd(g.left)}`;
}

/** Độ đầy của thanh: `pct` kẹp ở 100 (vượt thì thanh đầy, chữ nói "vượt"); không hạn mức → không thanh. */
export const barPct = (g: Pick<LookBackGroup, "pct">): number | null => (g.pct === null ? null : Math.min(100, g.pct));

/** Dòng phụ so tháng trước: "tháng trước 2.800.000 ₫ · ít hơn 300.000 ₫". */
export function compareText(spent: number, previousSpent: number): string {
  const delta = spent - previousSpent;
  const base = `tháng trước ${formatVnd(previousSpent)}`;
  return delta === 0 ? base : `${base} · ${delta > 0 ? "nhiều hơn" : "ít hơn"} ${formatVnd(Math.abs(delta))}`;
}

/**
 * Nhóm hiện ở bảng (UC-707 AC-44): nhóm chứa danh mục Trả nợ (`debtGroupId`) ẩn khi hai tháng đều 0 và tháng này không trả gốc — trả
 * gốc không vào danh mục nên nhóm này gần như luôn 0.
 */
export function lookBackGroups(d: Pick<LookBack, "groups" | "excluded">, debtGroupId: string | null): LookBackGroup[] {
  return d.groups.filter((g) => g.id !== debtGroupId || g.spent !== 0 || g.previousSpent !== 0 || d.excluded.debtPrincipal > 0);
}

/** Chữ mờ ở hàng nhóm Trả nợ: "Trả gốc 4.000.000 ₫, không tính vào chi"; nhóm khác hoặc không trả gốc → null. */
export function principalText(d: Pick<LookBack, "excluded">, groupId: string, debtGroupId: string | null): string | null {
  return d.excluded.debtPrincipal > 0 && groupId === debtGroupId ? `Trả gốc ${formatVnd(d.excluded.debtPrincipal)}, không tính vào chi` : null;
}

/** Chân tab: trả nợ gốc không phải chi tiêu; chỉ hiện khi không có hàng nhóm Trả nợ để ghi (không lặp). */
export const excludedText = (d: Pick<LookBack, "groups" | "excluded">, debtGroupId: string | null): string | null =>
  d.excluded.debtPrincipal > 0 && !d.groups.some((g) => g.id === debtGroupId) ? `Không tính: trả nợ gốc ${formatVnd(d.excluded.debtPrincipal)}` : null;

/** Khoản chờ đồng bộ không cộng vào Nhìn lại (số của server). */
export const queueNote = (n: number): string | null => (n > 0 ? `${n} khoản chưa lên sổ, chưa tính ở đây` : null);

/** Hai tháng không có khoản chi nào (nhóm, chưa xếp nhóm, lãi vay, trả gốc). Dòng lãi dự kiến chưa trả không tính là khoản chi. */
export function isEmptyLookBack(d: LookBack): boolean {
  const none = (x: { spent: number; previousSpent: number }) => x.spent === 0 && x.previousSpent === 0;
  return d.groups.every(none) && none(d.ungrouped) && d.ungrouped.categories.length === 0 && none(d.interest) && d.excluded.debtPrincipal === 0;
}

/**
 * Dòng Tích luỹ của tháng (ledger UC-108, ADR-142): "Tích luỹ tháng 11: 3.000.000 ₫ (10% lương) · mức 10–30%"; mọi ① bỏ qua → "… 0 ₫
 * · 0% — {lý do}"; chưa có mức → bỏ phần "· mức …". Không có lương trong tháng (`savings` null hay base 0) → null.
 */
export function savingsLine(month: string, s: Pick<LookBackSavings, "amount" | "base" | "level" | "reason"> | null | undefined): string | null {
  if (!s || s.base <= 0) return null;
  const head = `Tích luỹ tháng ${Number(month.slice(5, 7))}: ${formatVnd(s.amount)}`;
  if (s.level === "zero") return `${head} · ${levelText(s.level, s.reason)}`;
  const level = levelText(s.level)?.replace(/^đạt /, "");
  return `${head} (${Math.floor((s.amount * 100) / s.base)}% lương)${level ? ` · ${level}` : ""}`;
}
