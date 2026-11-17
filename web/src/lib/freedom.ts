// Mốc tự do (balance UC-1103; pwa UC-717 AC-4, UC-707 AC-47): câu chữ của card Thông số, Thang mốc, Thu nhập và dòng đệm ở thẻ
// Tích luỹ. Thuần để test. Mọi số tính ở server (GET /v1/freedom) hoặc bằng hàm thuần dùng chung `cushionLadder`; ở đây chỉ dựng chữ.

import { cushionLadder } from "../../../src/domain/freedom";
import { amountsHidden, formatVnd, moneyDigits } from "./money";
import { bpsText } from "./net-worth";
import type { CushionStep, Freedom, FreedomMilestone, FreedomParams, IncomeMilestone } from "./types";

export const expenseNeededText = "Cần chi phí tháng — nhập ở Ngưỡng và tỉ lệ hoặc chờ hết tháng đầu tiên";

/** Nguồn chi phí tháng (Công thức 8): "tự nhập" / "theo sổ, N tháng" / "theo sổ, 3 tháng gần nhất". */
function sourceText(p: FreedomParams): string {
  if (p.expenseSource === "manual") return "tự nhập";
  const n = p.expenseLedgerMonths ?? 3;
  return n >= 3 ? "theo sổ, 3 tháng gần nhất" : `theo sổ, ${n} tháng`;
}

/** Card Thông số: "Chi 14.200.000 ₫/tháng (theo sổ, 1 tháng) · Thiết yếu 10.000.000 · SWR 3,5% · lạm phát 3,5%". */
export function paramsSummary(p: FreedomParams): string {
  const expense =
    p.expenseMonthly === null
      ? expenseNeededText
      : [`Chi ${formatVnd(p.expenseMonthly)}/tháng (${sourceText(p)})`, p.expenseMustMonthly !== null ? `Thiết yếu ${moneyDigits(p.expenseMustMonthly)}` : null].filter(Boolean).join(" · ");
  return `${expense} · SWR ${bpsText(p.swrBps)}% · lạm phát ${bpsText(p.inflationBps)}%`;
}

/** Mốc thu nhập: "Thu nhập 45.000.000 ₫ · cần 33.333.334 ₫ — đạt" / "— còn thiếu X"; không có số → "chưa có số". */
export function incomeMilestoneText(m: IncomeMilestone): string {
  if (m.have === null || m.need === null) return m.need === null && m.have !== null ? expenseNeededText : "chưa có số";
  return `Thu nhập ${formatVnd(m.have)} · cần ${formatVnd(m.need)} · ${m.have >= m.need ? "đạt" : `còn thiếu ${formatVnd(m.need - m.have)}`}`;
}

/** Nguồn của thu nhập nhà dùng cho mốc thu nhập (Công thức 9 — vẫn đủ 3 tháng trọn). */
export const incomeSourceText = (s: "ledger" | "plan" | null): string | null => (s === "plan" ? "theo kế hoạch" : s === "ledger" ? "theo sổ, 3 tháng gần nhất" : null);

/** Số quy theo giá tương lai — ước lượng, hai chữ số lẻ tỷ: "≈ 7,01 tỷ ₫"; đang che số (UC-718) thì "≈ ••••• ₫". */
export const billionText = (n: number): string =>
  amountsHidden() ? `≈ ${formatVnd(n)}` : `≈ ${(Math.round(n / 1e7) / 100).toFixed(2).replace(".", ",")} tỷ ₫`.replace(" ₫", "\u00a0₫");

/** Hàng tuổi: "45 tuổi · năm 2035 · còn 9 năm · ≈ 7,01 tỷ ₫ theo giá 2035". */
export function freedomTargetText(t: NonNullable<FreedomMilestone["target"]>): string {
  const left = t.yearsLeft > 0 ? `còn ${t.yearsLeft} năm` : t.yearsLeft === 0 ? "năm nay" : `đã qua ${-t.yearsLeft} năm`;
  return [`${t.age} tuổi`, `năm ${t.year}`, left, t.needAtTargetYear !== null && t.yearsLeft > 0 ? `${billionText(t.needAtTargetYear)} theo giá ${t.year}` : null].filter(Boolean).join(" · ");
}

/** Tên và câu hỏi của mốc thu nhập (card Thu nhập). */
export const MILESTONE_LABEL: Record<IncomeMilestone["key"], { name: string; hint: string }> = {
  M2: { name: "M2 · Thu nhập đủ chi", hint: "Thu nhập nhà ≥ chi phí tháng" },
  M2p: { name: "M2′ · Đủ chi sau phần trích trước", hint: "Thu nhập trừ phần trích trước (Tích luỹ, Thuế) vẫn đủ chi phí tháng" },
  M3: { name: "M3 · Thu nhập gấp đôi chi", hint: "Thu nhập ≥ 2 lần chi phí tháng" },
};

// ── Thang mốc (Công thức 10, 12; ADR-149) ────────────────────────────

type LadderKey = CushionStep["key"] | "halfway" | FreedomMilestone["key"];

/** Tên bậc và câu quyết định bậc đó mở (bảng Đã chốt của change 261117-thang-moc-de-tu-do). Bậc đệm ghi thêm số tháng ở màn. */
export const LADDER_LABEL: Record<LadderKey, { name: string; decision: string }> = {
  start: { name: "Khởi đầu", decision: "Thoát tiêu hết tháng" },
  calm: { name: "An tâm", decision: "Giữ chặt, chưa đầu tư" },
  safe: { name: "An toàn", decision: "Bắt đầu mua tài sản theo cơ hội" },
  solid: { name: "Vững vàng", decision: "Tích luỹ vượt mốc đem mua tài sản" },
  halfway: { name: "Nửa đường", decision: "Có thể giảm giờ làm" },
  F1: { name: "F1 · Tự do cơ bản", decision: "Nghỉ nếu chỉ chi thiết yếu" },
  F2: { name: "F2 · Tự do hoàn toàn", decision: "Nghỉ, giữ mức sống" },
  F3: { name: "F3 · Tự do trọn đời", decision: "Gốc không giảm, để lại cho con" },
};

export type LadderInput = Pick<Freedom, "params" | "cushion" | "halfway" | "freedom">;

export interface LadderRowView {
  key: LadderKey;
  /** Bốn bậc đệm một nhóm (câu số tháng đệm đứng ngay dưới), Nửa đường và F1–F3 nhóm sau. */
  group: "cushion" | "fire";
  name: string;
  decision: string;
  /** null → không chip (chưa có số cần). */
  reached: boolean | null;
  pct: number | null;
  /** "Đệm X / cần Y" · "Tài sản cho FIRE X / cần Y"; chưa có số cần → "… X · Cần chi phí tháng — …". */
  have: string;
  /** "hoặc dòng tiền ròng X / cần Y"; chưa có số cần dòng tiền → null. */
  cashflow: string | null;
  /** Hàng tuổi mục tiêu (F1–F3). */
  target: string | null;
}

const haveNeed = (label: string, have: number, need: number | null) => (need === null ? `${label} ${formatVnd(have)} · ${expenseNeededText}` : `${label} ${formatVnd(have)} / cần ${formatVnd(need)}`);
const cashflowText = (have: number, need: number | null) => (need === null ? null : `hoặc dòng tiền ròng ${formatVnd(have)} / cần ${formatVnd(need)}`);
const FIRE = "Tài sản cho FIRE";

/** Tám hàng của card Thang mốc, đúng thứ tự: Khởi đầu · An tâm · An toàn · Vững vàng · Nửa đường · F1 · F2 · F3. */
export function ladderRows(f: LadderInput): LadderRowView[] {
  const cushion = f.cushion.steps.map(
    (s): LadderRowView => ({
      key: s.key,
      group: "cushion",
      name: `${LADDER_LABEL[s.key].name} · ${s.months} tháng chi`,
      decision: LADDER_LABEL[s.key].decision,
      reached: s.reached,
      pct: s.pct,
      have: haveNeed("Đệm", s.have, s.need),
      cashflow: null,
      target: null,
    }),
  );
  const h = f.halfway;
  const halfway: LadderRowView = {
    key: "halfway",
    group: "fire",
    name: LADDER_LABEL.halfway.name,
    decision: LADDER_LABEL.halfway.decision,
    reached: h.reached,
    pct: h.pct,
    have: haveNeed(FIRE, h.have, h.need),
    cashflow: cashflowText(h.cashflowHave, h.cashflowNeed),
    target: null,
  };
  const freedom = f.freedom.map(
    (m): LadderRowView => ({
      key: m.key,
      group: "fire",
      name: LADDER_LABEL[m.key].name,
      decision: LADDER_LABEL[m.key].decision,
      reached: m.reached,
      pct: m.pct,
      have: haveNeed(FIRE, m.have, m.need),
      cashflow: cashflowText(m.cashflowHave, m.cashflowNeed),
      target: m.target ? freedomTargetText(m.target) : null,
    }),
  );
  return [...cushion, halfway, ...freedom];
}

/** Số tháng một chữ số lẻ, dấu phẩy: 0.5 → "0,5", 6 → "6". */
const monthsText = (n: number) => String(n).replace(".", ",");

/** Dưới bốn bậc đệm: "Tích luỹ 7.410.000 ₫ đủ 0,5 tháng chi."; chưa có E → null. */
export const cushionCoveredText = (c: Freedom["cushion"]): string | null =>
  c.monthsCovered === null ? null : `Tích luỹ ${formatVnd(c.amount)} đủ ${monthsText(c.monthsCovered)} tháng chi.`;

/** Chú card Thang mốc. */
export const ladderNote = (p: FreedomParams): string =>
  `Đệm = tiền ngăn Tích luỹ, kể cả Heo đất; không gồm vàng. Tài sản cho FIRE = tài sản đầu tư trừ nợ, không gồm tiền Vận hành, tiền mục tiêu Dự phòng, Ví Thưởng và đệm tới ${p.safetyMonths[2]} tháng chi.`;

/** Chú SWR cuối card Thang mốc — chỉ là chữ, không đổi công thức. */
export const swrNote = (p: FreedomParams): string => `SWR ${bpsText(p.swrBps)}% là giả định; lãi tiền gửi sau lạm phát thường chỉ quanh 2%/năm.`;

/**
 * Dòng đệm thẻ Tích luỹ (UC-707 AC-47): "Đủ 0,5 tháng chi · mốc Khởi đầu 1E"; qua hết bậc → "… · đã qua mốc Vững vàng 24E";
 * chưa có E → câu cần chi phí tháng. `amount` là tổng ngăn Tích luỹ của snapshot (đã trừ tạm hàng đợi); không có số tiền nên che
 * số không đổi dòng này.
 */
export function cushionLine(amount: number, expenseMonthly: number | null, safetyMonths: [number, number, number]): string {
  const c = cushionLadder(amount, expenseMonthly, safetyMonths);
  if (c.monthsCovered === null) return expenseNeededText;
  const next = c.next === null ? null : c.steps.find((s) => s.key === c.next)!;
  const last = c.steps[c.steps.length - 1]!;
  const tail = next ? `mốc ${LADDER_LABEL[next.key].name} ${next.months}E` : `đã qua mốc ${LADDER_LABEL[last.key].name} ${last.months}E`;
  return `Đủ ${monthsText(c.monthsCovered)} tháng chi · ${tail}`;
}
