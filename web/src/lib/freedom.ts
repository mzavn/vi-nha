// Mốc tự do (balance UC-1103; pwa UC-717 AC-4): câu chữ của card Thông số, Mốc an tâm, Thu nhập, Tự do.
// Thuần để test. Mọi số tính ở server (GET /v1/freedom); ở đây chỉ dựng chữ.

import { amountsHidden, formatVnd, moneyDigits } from "./money";
import { bpsText } from "./net-worth";
import type { FreedomMilestone, FreedomParams, IncomeMilestone, SafetyMilestone } from "./types";

export const expenseNeededText = "Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng";

const sourceText = (s: "manual" | "ledger" | null): string => (s === "manual" ? "tự nhập" : "theo sổ, 3 tháng gần nhất");

/** Card Thông số: "Chi 20.000.000 ₫/tháng (tự nhập) · Must 15.000.000 · SWR 3,5% · lạm phát 3,5%". */
export function paramsSummary(p: FreedomParams): string {
  const expense =
    p.expenseMonthly === null
      ? expenseNeededText
      : [`Chi ${formatVnd(p.expenseMonthly)}/tháng (${sourceText(p.expenseSource)})`, p.expenseMustMonthly !== null ? `Must ${moneyDigits(p.expenseMustMonthly)}` : null].filter(Boolean).join(" · ");
  return `${expense} · SWR ${bpsText(p.swrBps)}% · lạm phát ${bpsText(p.inflationBps)}%`;
}

/** Mốc an tâm: "Có 156.000.000 ₫ · cần 120.000.000 ₫ · 6 tháng". */
export const safetyText = (s: SafetyMilestone): string =>
  s.need === null ? `Có ${formatVnd(s.have)} · cần ${s.months} tháng chi phí — ${expenseNeededText}` : `Có ${formatVnd(s.have)} · cần ${formatVnd(s.need)} · ${s.months} tháng`;

/** Mốc thu nhập: "Thu nhập 45.000.000 ₫ · cần 33.333.334 ₫ — đạt" / "— còn thiếu X"; không có số → "chưa có số". */
export function incomeMilestoneText(m: IncomeMilestone): string {
  if (m.have === null || m.need === null) return m.need === null && m.have !== null ? expenseNeededText : "chưa có số";
  return `Thu nhập ${formatVnd(m.have)} · cần ${formatVnd(m.need)} — ${m.have >= m.need ? "đạt" : `còn thiếu ${formatVnd(m.need - m.have)}`}`;
}

/** Nguồn của thu nhập nhà dùng cho mốc thu nhập (Công thức 9). */
export const incomeSourceText = (s: "ledger" | "plan" | null): string | null => (s === "plan" ? "theo kế hoạch" : s === "ledger" ? "theo sổ, 3 tháng gần nhất" : null);

/** "Tài sản đầu tư trừ nợ 486.000.000 ₫ / cần 5.142.857.143 ₫". */
export const freedomHaveText = (f: FreedomMilestone): string =>
  f.need === null ? `Tài sản đầu tư trừ nợ ${formatVnd(f.have)} — ${expenseNeededText}` : `Tài sản đầu tư trừ nợ ${formatVnd(f.have)} / cần ${formatVnd(f.need)}`;

/** "hoặc dòng tiền ròng 104.166 ₫ / cần 15.000.000 ₫"; chưa có chi phí → null. */
export const freedomCashflowText = (f: FreedomMilestone): string | null =>
  f.cashflowNeed === null ? null : `hoặc dòng tiền ròng ${formatVnd(f.cashflowHave)} / cần ${formatVnd(f.cashflowNeed)}`;

/** Số quy theo giá tương lai — ước lượng, hai chữ số lẻ tỷ: "≈ 7,01 tỷ ₫"; đang che số (UC-718) thì "≈ •••• ₫". */
export const billionText = (n: number): string =>
  amountsHidden() ? `≈ ${formatVnd(n)}` : `≈ ${(Math.round(n / 1e7) / 100).toFixed(2).replace(".", ",")} tỷ ₫`.replace(" ₫", "\u00a0₫");

/** Hàng tuổi: "45 tuổi · năm 2035 · còn 9 năm · ≈ 7,01 tỷ ₫ theo giá 2035". */
export function freedomTargetText(t: NonNullable<FreedomMilestone["target"]>): string {
  const left = t.yearsLeft > 0 ? `còn ${t.yearsLeft} năm` : t.yearsLeft === 0 ? "năm nay" : `đã qua ${-t.yearsLeft} năm`;
  return [`${t.age} tuổi`, `năm ${t.year}`, left, t.needAtTargetYear !== null && t.yearsLeft > 0 ? `${billionText(t.needAtTargetYear)} theo giá ${t.year}` : null].filter(Boolean).join(" · ");
}

/** Tên và câu hỏi của từng mốc (Mốc an tâm đặt tên theo số tháng ở màn). */
export const MILESTONE_LABEL: Record<IncomeMilestone["key"] | FreedomMilestone["key"], { name: string; hint: string }> = {
  M2: { name: "M2 · Thu nhập đủ chi", hint: "Thu nhập nhà ≥ chi phí tháng" },
  M2p: { name: "M2′ · Đủ chi sau phần khóa", hint: "Thu nhập trừ phần khóa (Tích sản, Thuế) vẫn đủ chi phí tháng" },
  M3: { name: "M3 · Thu nhập gấp đôi chi", hint: "Thu nhập ≥ 2 lần chi phí tháng" },
  F1: { name: "F1 · Tự do cơ bản", hint: "Tài sản đầu tư trừ nợ đủ chi Must theo tỷ lệ rút an toàn" },
  F2: { name: "F2 · Tự do hoàn toàn", hint: "Đủ chi phí sống bình thường, có hệ số dự phòng" },
  F3: { name: "F3", hint: "Sống bằng lãi thực, không đụng vốn" },
};
