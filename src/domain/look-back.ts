// Nhìn lại theo tháng dương lịch (ledger UC-108, pocket UC-1204 — ADR-127 sửa theo ADR-144). Hàm thuần: gộp chi ròng theo danh
// mục vào nhóm theo cấu hình hiện tại, so hạn mức mềm mỗi tháng (không âm, không bù), luật dòng Chi tiêu tháng này của tin sáng, số mỗi ngày
// của tin tuần. Server dùng cho `GET /v1/spend-by-category`, MCP, cron; PWA dùng lại kiểu và chữ "còn / vượt".

import type { MonthSavings } from "./month-tasks";

/** Ngưỡng "gần chạm" hạn mức (%), dùng chung dòng Chi tiêu tháng này tin sáng và tin tuần bản ngắn. */
export const NEAR_LIMIT_PCT = 80;

/** Chi ròng của một danh mục ở tháng chọn và tháng trước. `categoryId` null: khoản hoàn không danh mục. */
export interface LookBackCategory {
  categoryId: string | null;
  name: string;
  spent: number;
  previousSpent: number;
}

/** Nhóm danh mục đang dùng (cấu hình hiện tại). */
export interface CategoryGroupRef {
  id: string;
  name: string;
  essential: boolean;
  limit: number | null;
}

export interface LimitFigures {
  pct: number | null;
  left: number | null;
  over: number | null;
}

export interface LookBackGroup extends CategoryGroupRef, LimitFigures {
  spent: number;
  previousSpent: number;
  categories: LookBackCategory[];
}

export interface LookBackInterestLine {
  debtId: string;
  name: string;
  expected: number;
  paid: number;
  dueDay: number | null;
}

/**
 * Tích luỹ của một tháng (ledger UC-108, ADR-142): `savingsDone` trên các nhắc ① có `month_key` đó — `amount` đã trích
 * (chuyển khoản thật đã ghép), `base` = Σ khoản lương có ①, `pct`, `level` như `savingsLevel`; `reason` = lý do bỏ qua / sửa về 0
 * khi `level` là `zero`, còn lại null.
 */
export interface LookBackSavings extends MonthSavings {
  reason: string | null;
}

interface LookBackBody {
  total: number;
  previousTotal: number;
  groups: LookBackGroup[];
  ungrouped: { spent: number; previousSpent: number; categories: LookBackCategory[] };
  interest: { spent: number; previousSpent: number; expected: number; lines: LookBackInterestLine[] };
  excluded: { debtPrincipal: number };
  categories: LookBackCategory[];
}

/** Kết quả `GET /v1/spend-by-category` (ledger UC-108 bước 5–6): luôn một tháng VN. */
export type LookBack = {
  kind: "month";
  /** `YYYY-MM` của tháng chọn. */
  month: string;
  previous: string;
  /** Tháng sau; null khi tháng chọn là tháng hiện tại (hoặc sau đó). */
  next: string | null;
  /** Số ngày của tháng. */
  days: number;
  /** Số ngày đã qua tính cả hôm nay (tháng hiện tại); tháng đã hết = `days`, tháng chưa tới = 0. */
  daysElapsed: number;
  /** Tích luỹ của tháng theo nhắc ①; null khi tháng không có khoản lương nào có ①. */
  savings: LookBackSavings | null;
} & LookBackBody;

/**
 * `pct` = ⌊max(0, spent) × 100 ÷ limit⌋, `left` = max(0, limit − max(0, spent)) (hoàn nhiều hơn chi vẫn chỉ "còn" đủ hạn mức,
 * UC-1204 AC-4), `over` = max(0, spent − limit); không hạn mức → null.
 */
export function limitFigures(limit: number | null, spent: number): LimitFigures {
  if (limit === null) return { pct: null, left: null, over: null };
  const used = Math.max(0, spent);
  return { pct: Math.floor((used * 100) / limit), left: Math.max(0, limit - used), over: Math.max(0, spent - limit) };
}

/**
 * Gộp danh mục vào nhóm (UC-1204 bước 2, UC-108 bước 3): danh mục có `groupId` của một nhóm đang dùng vào nhóm đó (kể cả
 * danh mục đã tắt), còn lại vào `ungrouped`. Nhóm giữ thứ tự `groups` (theo `sort`); danh mục trong nhóm giảm dần theo `spent`.
 * Hạn mức (`limit`, mỗi tháng) luôn được so.
 */
export function groupSpend(
  rows: (LookBackCategory & { groupId: string | null })[],
  groups: CategoryGroupRef[],
): { groups: LookBackGroup[]; ungrouped: LookBackBody["ungrouped"] } {
  const byDesc = (a: LookBackCategory, b: LookBackCategory) => b.spent - a.spent || b.previousSpent - a.previousSpent;
  const strip = ({ groupId: _, ...c }: LookBackCategory & { groupId: string | null }): LookBackCategory => c;
  const known = new Set(groups.map((g) => g.id));
  const sum = (list: LookBackCategory[], k: "spent" | "previousSpent") => list.reduce((s, c) => s + c[k], 0);
  const out = groups.map((g) => {
    const categories = rows.filter((r) => r.groupId === g.id).map(strip).sort(byDesc);
    const spent = sum(categories, "spent");
    return { ...g, spent, previousSpent: sum(categories, "previousSpent"), ...limitFigures(g.limit, spent), categories };
  });
  const rest = rows.filter((r) => r.groupId === null || !known.has(r.groupId)).map(strip).sort(byDesc);
  return { groups: out, ungrouped: { spent: sum(rest, "spent"), previousSpent: sum(rest, "previousSpent"), categories: rest } };
}

/** Một nhóm vào dòng Chi tiêu tháng này của tin sáng / mục nhóm ở bản ngắn. */
export interface LimitNudge {
  name: string;
  pct: number;
  over: number;
}

/**
 * Dòng "Chi tiêu tháng này" (notify UC-402 bước 4): nhóm có hạn mức đã vượt, hoặc ≥ 80% khi còn hơn 1/5 tháng
 * (`daysElapsed × 100 < 80 × days`). Vượt trước (vượt nhiều trước), rồi `pct` giảm dần, rồi thứ tự nhóm.
 */
export function limitNudges(groups: Pick<LookBackGroup, "name" | "pct" | "over">[], month: { days: number; daysElapsed: number }): LimitNudge[] {
  const early = month.daysElapsed * 100 < NEAR_LIMIT_PCT * month.days;
  return groups
    .map((g, i) => ({ name: g.name, pct: g.pct, over: g.over, i }))
    .filter((g): g is { name: string; pct: number; over: number; i: number } => g.pct !== null && g.over !== null && (g.over > 0 || (g.pct >= NEAR_LIMIT_PCT && early)))
    .sort((a, b) => b.over - a.over || b.pct - a.pct || a.i - b.i)
    .map(({ name, pct, over }) => ({ name, pct, over }));
}

/** Số mỗi ngày của tuần (notify UC-406 bước 3): ⌊chi từ Vận hành ÷ 7 ÷ 1.000⌋ × 1.000. */
export const weeklyRhythm = (operatingSpent: number) => Math.floor(operatingSpent / 7 / 1000) * 1000;
