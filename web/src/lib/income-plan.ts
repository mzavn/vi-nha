// Kế hoạch thu nhập theo năm (balance UC-1104): câu chữ card Kế hoạch, sheet Sửa kế hoạch, danh sách các năm.
// Thuần để test. Mỗi lần lưu là một bản mới ở server (chỉ ghi thêm); ở đây chỉ dựng chữ và kiểm ô nhập.

import { formatVnd, moneyDigits } from "./money";
import { shortDate } from "./period";
import type { Result } from "./settings";
import type { IncomePlanMember, IncomePlanSummary, IncomePlanYear } from "./types";

/** Phần trăm của kế hoạch luôn một chữ số lẻ ("87,0%", "100,0%"); null → "—". */
const pct1 = (p: number | null): string => (p === null ? "—" : `${p.toFixed(1).replace(".", ",")}%`);

/** "Cả nhà 43.500.000 / 45.000.000 ₫ mỗi tháng · 96,6%"; chưa có số → "Cả nhà chưa có số / 45.000.000 ₫ mỗi tháng". */
export function planHeadline(y: IncomePlanYear): string {
  const target = y.current?.householdMonthly ?? 0;
  const a = y.actual.monthlyAverage;
  return a === null ? `Cả nhà chưa có số / ${formatVnd(target)} mỗi tháng` : `Cả nhà ${moneyDigits(a)} / ${formatVnd(target)} mỗi tháng · ${pct1(y.actual.pctOfCurrent)}`;
}

/** "Đầu năm 50.000.000 ₫ (87,0%) · cả năm 8,0% · tính trên 1 tháng đã kết thúc"; đầu năm = hiện tại thì bỏ phần đó. */
export function planSub(y: IncomePlanYear): string {
  const changed = y.first && y.current && y.first.id !== y.current.id;
  return [
    changed ? `Đầu năm ${formatVnd(y.first!.householdMonthly)}${y.actual.pctOfFirst === null ? "" : ` (${pct1(y.actual.pctOfFirst)})`}` : null,
    y.actual.monthlyAverage === null ? null : `cả năm ${pct1(y.actual.pctOfYear)}`,
    y.actual.monthsCounted > 0 ? `tính trên ${y.actual.monthsCounted} tháng đã kết thúc` : "chưa có tháng nào kết thúc trong sổ",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "sửa 1 lần, lần cuối 1/7"; chưa sửa lần nào → null. */
export function editedText(y: IncomePlanYear): string | null {
  const edits = y.versions.length - 1;
  if (edits <= 0) return null;
  return `sửa ${edits} lần, lần cuối ${shortDate(y.versions.at(-1)!.createdAt)}`;
}

/** Một người: "28.000.000 / 30.000.000 ₫ · 93,3%"; chưa có tháng nào kết thúc → "chưa có số / 30.000.000 ₫". */
export const memberPlanText = (m: IncomePlanMember, counted = true): string =>
  counted ? `${moneyDigits(m.actual)} / ${formatVnd(m.planned)} · ${pct1(m.pct)}` : `chưa có số / ${formatVnd(m.planned)}`;

/** Một năm trong "Các năm": "đầu năm 50.000.000 ₫ · thực tế 43.500.000 ₫/tháng · 96,6% · cả năm 8,0%". */
export function planYearRow(s: IncomePlanSummary): string {
  if (s.monthlyAverage === null) return "thực tế chưa có số";
  return [
    s.firstMonthly !== s.currentMonthly ? `đầu năm ${formatVnd(s.firstMonthly)}` : null,
    `thực tế ${formatVnd(s.monthlyAverage)}/tháng`,
    pct1(s.pctOfCurrent),
    `cả năm ${pct1(s.pctOfYear)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ── Sheet Sửa kế hoạch ─────────────────────────────────────────────

export interface PlanLineForm {
  key: number;
  name: string;
  /** null = Chung. */
  memberId: string | null;
  monthly: number;
}

export interface PlanForm {
  household: number;
  lines: PlanLineForm[];
}

/** Điền sẵn bản hiện tại; chưa có kế hoạch → trống. */
export const planFormFrom = (y: IncomePlanYear | null): PlanForm => ({
  household: y?.current?.householdMonthly ?? 0,
  lines: (y?.current?.lines ?? []).map((l, i) => ({ key: i + 1, name: l.name, memberId: l.memberId, monthly: l.monthly })),
});

/** "Chưa chia 3.000.000 ₫" / "Chia vượt 1.000.000 ₫"; không chia hoặc khớp → null. */
export function planSplitHint(household: number, lines: { monthly: number }[]): string | null {
  if (lines.length === 0) return null;
  const diff = household - lines.reduce((s, l) => s + l.monthly, 0);
  if (diff === 0) return null;
  return diff > 0 ? `Chưa chia ${formatVnd(diff)}` : `Chia vượt ${formatVnd(-diff)}`;
}

/** Thân PUT /v1/income-plans/:year: mục tiêu cả nhà bắt buộc > 0; mỗi dòng chia có tên, số > 0. */
export function planPayload(f: PlanForm): Result<{ household_monthly: number; lines?: { name: string; member_id: string | null; monthly_amount: number }[] }> {
  const errors: Record<string, string> = {};
  if (!(f.household > 0)) errors.household = "Cần mục tiêu cả nhà";
  f.lines.forEach((l) => {
    if (!l.name.trim()) errors[`line${l.key}`] = "Nhập tên dòng (vd Lương, Cho thuê).";
    else if (!(l.monthly > 0)) errors[`line${l.key}`] = "Nhập số mỗi tháng.";
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      household_monthly: f.household,
      ...(f.lines.length > 0 ? { lines: f.lines.map((l) => ({ name: l.name.trim(), member_id: l.memberId, monthly_amount: l.monthly })) } : {}),
    },
  };
}
