// Ví & quỹ › Nhìn lại (pwa UC-707, ledger UC-108, pocket UC-1204 — ADR-127): câu chữ của tab từ `GET /v1/spend-by-category`.
// Thuần để test. Mọi số tiền qua `formatVnd` (che số, UC-718); %, số ngày, ngày tháng không che. Hạn mức mềm chỉ để nhìn:
// không số âm, không nút gì để "lấy thêm" — chỉ "còn" hoặc "vượt".

import type { CycleRef, LookBack, LookBackCycle, LookBackGroup } from "../../../src/domain/look-back";
import type { SavingsLevel } from "../../../src/domain/pay-cycle";
import { formatVnd } from "./money";
import { dayKey, previousDay, shortDate } from "./period";
import { levelText } from "./savings-scale";

export const LOOK_BACK_NOTE = "Hạn mức mềm chỉ để nhìn lại — không giữ tiền, không âm, không bù.";
export const LOOK_BACK_EMPTY = "Chưa có khoản chi nào trong kỳ này và kỳ trước.";

/** `GET /v1/spend-by-category`: không gửi kỳ = kỳ lương hiện tại. */
export const lookBackPath = (cycle: string | null): string => (cycle ? `/v1/spend-by-category?cycle=${cycle}` : "/v1/spend-by-category");

/**
 * Ngày đầu và ngày cuối (giờ VN) của một kỳ `[start, end)`: kỳ kết thúc lúc lương kỳ sau về (10/11 08:00) hay 00:00 ngày lương
 * danh nghĩa kế, nên ngày cuối là ngày trước ngày của `end` ("10/10 – 9/11"). `to` null = kỳ đang chạy.
 */
export function cycleSpan(ref: Pick<CycleRef, "start" | "end">): { from: string; to: string | null } {
  const from = dayKey(ref.start);
  if (!ref.end) return { from, to: null };
  const to = previousDay(dayKey(ref.end));
  return { from, to: to < from ? from : to };
}

/** "10/10 – 9/11" (kỳ đã qua) hoặc "Kỳ từ 10/11" (kỳ đang chạy). */
export function spanText(span: { from: string; to: string | null }): string {
  return span.to ? `${shortDate(span.from)} – ${shortDate(span.to)}` : `Kỳ từ ${shortDate(span.from)}`;
}

/**
 * Đầu tab: kỳ đang chạy "Kỳ từ 10/11 · còn 15 ngày" (còn = days − daysElapsed + 1, tính cả hôm nay); lương trễ "Kỳ từ 10/11 ·
 * Lương dự kiến 10/12 chưa về (trễ 2 ngày)" (ngày lương kế = ngày đầu + days); kỳ đã qua "10/10 – 9/11"; kỳ danh nghĩa
 * (chưa có kỳ lưu) thêm "(theo ngày lương)".
 */
export function cycleHeading(c: LookBackCycle): string {
  const span = cycleSpan(c);
  let text = spanText(span);
  if (!span.to) {
    // Ngày lương kế = ngày đầu kỳ + `days` (ledger UC-108 bước 5).
    const nextPayday = new Date(Date.parse(`${span.from}T00:00:00Z`) + c.days * 86_400_000).toISOString().slice(0, 10);
    text += c.lateDays ? ` · Lương dự kiến ${shortDate(nextPayday)} chưa về (trễ ${c.lateDays} ngày)` : ` · còn ${c.days - c.daysElapsed + 1} ngày`;
  }
  return c.stored ? text : `${text} (theo ngày lương)`;
}

/** Nút ‹ / ›: kỳ liền trước / kế; về kỳ hiện tại thì địa chỉ không mang ngày (`cycle` null). null = không có nút. */
export function stepCycle(d: Extract<LookBack, { kind: "cycle" }>, dir: -1 | 1): { cycle: string | null } | null {
  const ref = dir < 0 ? d.previous : d.next;
  if (!ref) return null;
  return { cycle: ref.end === null ? null : ref.payday };
}

/** "còn 500.000 ₫" / "vượt 200.000 ₫"; nhóm không hạn mức → null. */
export function limitText(g: Pick<LookBackGroup, "left" | "over">): string | null {
  if (g.over) return `vượt ${formatVnd(g.over)}`;
  return g.left === null ? null : `còn ${formatVnd(g.left)}`;
}

/** Độ đầy của thanh: `pct` kẹp ở 100 (vượt thì thanh đầy, chữ nói "vượt"); không hạn mức → không thanh. */
export const barPct = (g: Pick<LookBackGroup, "pct">): number | null => (g.pct === null ? null : Math.min(100, g.pct));

/** Dòng phụ so kỳ trước: "kỳ trước 2.800.000 ₫ · ít hơn 300.000 ₫". */
export function compareText(spent: number, previousSpent: number): string {
  const delta = spent - previousSpent;
  const base = `kỳ trước ${formatVnd(previousSpent)}`;
  return delta === 0 ? base : `${base} · ${delta > 0 ? "nhiều hơn" : "ít hơn"} ${formatVnd(Math.abs(delta))}`;
}

/** Chân tab: trả nợ gốc không phải chi tiêu nên không vào nhóm nào. */
export const excludedText = (debtPrincipal: number): string | null => (debtPrincipal > 0 ? `Không tính: trả nợ gốc ${formatVnd(debtPrincipal)}` : null);

/** Khoản chờ đồng bộ không cộng vào Nhìn lại (số của server). */
export const queueNote = (n: number): string | null => (n > 0 ? `${n} khoản chưa lên sổ chưa tính ở đây` : null);

/** Hai kỳ không có khoản chi nào (nhóm, chưa xếp nhóm, lãi vay, trả gốc). Dòng lãi dự kiến chưa trả không tính là khoản chi. */
export function isEmptyLookBack(d: LookBack): boolean {
  const none = (x: { spent: number; previousSpent: number }) => x.spent === 0 && x.previousSpent === 0;
  return d.groups.every(none) && none(d.ungrouped) && d.ungrouped.categories.length === 0 && none(d.interest) && d.excluded.debtPrincipal === 0;
}

/**
 * Dòng Tích luỹ của kỳ (ledger UC-108, ADR-142): "Tích luỹ kỳ này: 3.000.000 ₫ (10% lương) · mức 10–30%"; mọi ① bỏ qua → "… 0 ₫ ·
 * 0% — {lý do}"; chưa có mức → bỏ phần "· mức …". Kỳ danh nghĩa (`savings` null) hay không có lương (base 0) → null.
 */
export function savingsLine(s: { amount: number; base: number; level: SavingsLevel; reason: string | null } | null | undefined): string | null {
  if (!s || s.base <= 0) return null;
  const head = `Tích luỹ kỳ này: ${formatVnd(s.amount)}`;
  if (s.level === "zero") return `${head} · ${levelText(s.level, s.reason)}`;
  const level = levelText(s.level)?.replace(/^đạt /, "");
  return `${head} (${Math.floor((s.amount * 100) / s.base)}% lương)${level ? ` · ${level}` : ""}`;
}
