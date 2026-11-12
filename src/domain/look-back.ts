// Nhìn lại theo kỳ lương (ledger UC-108, pocket UC-1204 — ADR-127). Hàm thuần: gộp chi ròng theo danh mục vào nhóm theo cấu
// hình hiện tại, so hạn mức mềm hiện tại (không âm, không bù), luật dòng 🔎 của tin sáng, số mỗi ngày của tin tuần. Server
// dùng cho `GET /v1/spend-by-category`, MCP, cron; PWA dùng lại kiểu và chữ "còn / vượt".

import type { SavingsLevel } from "./pay-cycle";

/** Ngưỡng "gần chạm" hạn mức (%), dùng chung dòng 🔎 tin sáng và tin tuần bản ngắn. */
export const NEAR_LIMIT_PCT = 80;

/** Chi ròng của một danh mục ở kỳ chọn và kỳ trước. `categoryId` null: khoản hoàn không danh mục. */
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

export interface LookBackCycle {
  payday: string;
  start: string;
  end: string | null;
  stored: boolean;
  days: number;
  daysElapsed: number;
  lateDays?: number;
}

export type CycleRef = Pick<LookBackCycle, "payday" | "start" | "end" | "stored">;

/**
 * Tích luỹ của một kỳ lưu (ledger UC-108, ADR-142): tính như `savingsDone` trên các việc ① của chính kỳ đó — `amount` đã trích
 * (chuyển khoản thật đã ghép), `base` = Σ khoản lương có ①, `level` như `savingsLevel`; `reason` = lý do bỏ qua / sửa về 0
 * khi `level` là `zero`, còn lại null.
 */
export interface LookBackSavings {
  amount: number;
  base: number;
  level: SavingsLevel;
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

/** Kết quả `GET /v1/spend-by-category` (ledger UC-108 bước 5–6). */
export type LookBack =
  | ({ kind: "cycle"; cycle: LookBackCycle; previous: CycleRef | null; next: CycleRef | null; savings?: LookBackSavings | null } & LookBackBody)
  | ({ kind: "month"; month: string; previous: string } & LookBackBody);

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
 * `withLimits` false (tháng lịch): mọi `limit` / `pct` / `left` / `over` = null.
 */
export function groupSpend(
  rows: (LookBackCategory & { groupId: string | null })[],
  groups: CategoryGroupRef[],
  withLimits: boolean,
): { groups: LookBackGroup[]; ungrouped: LookBackBody["ungrouped"] } {
  const byDesc = (a: LookBackCategory, b: LookBackCategory) => b.spent - a.spent || b.previousSpent - a.previousSpent;
  const strip = ({ groupId: _, ...c }: LookBackCategory & { groupId: string | null }): LookBackCategory => c;
  const known = new Set(groups.map((g) => g.id));
  const sum = (list: LookBackCategory[], k: "spent" | "previousSpent") => list.reduce((s, c) => s + c[k], 0);
  const out = groups.map((g) => {
    const categories = rows.filter((r) => r.groupId === g.id).map(strip).sort(byDesc);
    const spent = sum(categories, "spent");
    const limit = withLimits ? g.limit : null;
    return { ...g, limit, spent, previousSpent: sum(categories, "previousSpent"), ...limitFigures(limit, spent), categories };
  });
  const rest = rows.filter((r) => r.groupId === null || !known.has(r.groupId)).map(strip).sort(byDesc);
  return { groups: out, ungrouped: { spent: sum(rest, "spent"), previousSpent: sum(rest, "previousSpent"), categories: rest } };
}

/** Một nhóm vào dòng 🔎 của tin sáng / mục nhóm ở bản ngắn. */
export interface LimitNudge {
  name: string;
  pct: number;
  over: number;
}

/**
 * Dòng 🔎 "Nhìn lại kỳ này" (notify UC-402 bước 4): nhóm có hạn mức đã vượt, hoặc ≥ 80% khi còn hơn 1/5 kỳ
 * (`daysElapsed × 100 < 80 × days`). Vượt trước (vượt nhiều trước), rồi `pct` giảm dần, rồi thứ tự nhóm.
 */
export function limitNudges(groups: Pick<LookBackGroup, "name" | "pct" | "over">[], cycle: Pick<LookBackCycle, "days" | "daysElapsed">): LimitNudge[] {
  const early = cycle.daysElapsed * 100 < NEAR_LIMIT_PCT * cycle.days;
  return groups
    .map((g, i) => ({ name: g.name, pct: g.pct, over: g.over, i }))
    .filter((g): g is { name: string; pct: number; over: number; i: number } => g.pct !== null && g.over !== null && (g.over > 0 || (g.pct >= NEAR_LIMIT_PCT && early)))
    .sort((a, b) => b.over - a.over || b.pct - a.pct || a.i - b.i)
    .map(({ name, pct, over }) => ({ name, pct, over }));
}

/** Số mỗi ngày của tuần (notify UC-406 bước 3): ⌊chi từ Vận hành ÷ 7 ÷ 1.000⌋ × 1.000. */
export const weeklyRhythm = (operatingSpent: number) => Math.floor(operatingSpent / 7 / 1000) * 1000;
