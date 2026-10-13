// Mốc tự do (BR-15, UC-1103 — Công thức 8–13 của change 261008-bang-can-doi). Hàm thuần: tiền là số nguyên đồng, tỷ lệ là
// phần vạn (SWR 3,5% = 350) để không lệch số thực; số theo giá năm mục tiêu chỉ là ước lượng.

import { pct } from "./balance";

export interface FreedomParams {
  expenseMonthly: number | null;
  expenseSource: "manual" | "ledger" | null;
  expenseMustMonthly: number | null;
  expenseMustSource: "manual" | "ledger" | null;
  incomeMonthly: number | null;
  incomeSource: "ledger" | "plan" | null;
  /** Σ phần trăm luật `percent` đang bật của ví Tích sản và Thuế (phần vạn). */
  lockedBps: number;
  swrBps: number;
  inflationBps: number;
  fatBps: number;
  legacyRateBps: number;
  highInterestBps: number;
  safetyMonths: [number, number, number];
  birthYear: number | null;
  targetAges: { f1: number | null; f2: number | null; f3: number | null };
}
export interface SafetyMilestone {
  key: "A1" | "A2" | "A3";
  months: number;
  need: number | null;
  have: number;
  pct: number | null;
  reached: boolean | null;
}
export interface IncomeMilestone {
  key: "M2" | "M2p" | "M3";
  need: number | null;
  have: number | null;
  reached: boolean | null;
}
export interface FreedomTarget {
  age: number;
  year: number;
  yearsLeft: number;
  /** Số cần quy theo giá năm mục tiêu (lạm phát kép) — ước lượng. */
  needAtTargetYear: number;
}
export interface FreedomMilestone {
  key: "F1" | "F2" | "F3";
  need: number | null;
  have: number;
  pct: number | null;
  cashflowNeed: number | null;
  cashflowHave: number;
  reached: boolean | null;
  target: FreedomTarget | null;
}
export interface FreedomMilestones {
  liquid: number;
  monthsCovered: number | null;
  safety: SafetyMilestone[];
  income: IncomeMilestone[];
  investable: number;
  liabilities: number;
  investableNet: number;
  cashflowMonthly: number;
  netCashflowMonthly: number;
  freedom: FreedomMilestone[];
}

/** Bảng cân đối hôm nay, phần Mốc tự do cần. */
export interface SheetFigures {
  liquid: number;
  investable: number;
  liabilities: number;
  cashflowMonthly: number;
  netCashflowMonthly: number;
}

/** Chia làm tròn lên (số nguyên dương). */
const ceilDiv = (a: number, b: number) => Math.ceil(a / b);

/** Mốc an tâm A1–A3 (Công thức 10), thu nhập M2 / M2′ / M3 (11), Tự do F1–F3 (12) và tuổi mục tiêu (13). */
export function milestones(p: FreedomParams, s: SheetFigures, year: number): FreedomMilestones {
  const E = p.expenseMonthly;
  const Em = p.expenseMustMonthly;
  const I = p.incomeMonthly;
  const aNet = s.investable - s.liabilities;
  const safety = (["A1", "A2", "A3"] as const).map((key, i): SafetyMilestone => {
    const months = p.safetyMonths[i]!;
    const need = E === null ? null : months * E;
    return { key, months, need, have: s.liquid, pct: need === null ? null : pct(s.liquid, need), reached: need === null ? null : s.liquid >= need };
  });
  const incomeNeeds: [IncomeMilestone["key"], number | null][] = [
    ["M2", E],
    ["M2p", E === null ? null : ceilDiv(E * 10_000, 10_000 - p.lockedBps)],
    ["M3", E === null ? null : 2 * E],
  ];
  const income = incomeNeeds.map(([key, need]): IncomeMilestone => ({ key, need, have: I, reached: need === null || I === null ? null : I >= need }));
  const growth = 1 + p.inflationBps / 10_000;
  const target = (age: number | null, need: number | null): FreedomTarget | null => {
    if (age === null || p.birthYear === null || need === null) return null;
    const at = p.birthYear + age;
    return { age, year: at, yearsLeft: at - year, needAtTargetYear: Math.round(need * Math.pow(growth, at - year)) };
  };
  const fatCashflow = E === null ? null : ceilDiv(E * p.fatBps, 10_000);
  const defs: [FreedomMilestone["key"], number | null, number | null, number | null][] = [
    ["F1", Em === null ? null : ceilDiv(12 * Em * 10_000, p.swrBps), Em, p.targetAges.f1],
    ["F2", E === null ? null : ceilDiv(12 * E * p.fatBps, p.swrBps), fatCashflow, p.targetAges.f2],
    ["F3", E === null ? null : ceilDiv(12 * E * p.fatBps, p.legacyRateBps), fatCashflow, p.targetAges.f3],
  ];
  const freedom = defs.map(([key, need, cashflowNeed, age]): FreedomMilestone => ({
    key,
    need,
    have: aNet,
    pct: need === null ? null : pct(aNet, need),
    cashflowNeed,
    cashflowHave: s.netCashflowMonthly,
    reached: need === null ? null : aNet >= need || (cashflowNeed !== null && s.netCashflowMonthly >= cashflowNeed),
    target: target(age, need),
  }));
  return {
    liquid: s.liquid,
    monthsCovered: E === null || E <= 0 ? null : Math.trunc((10 * s.liquid) / E) / 10,
    safety,
    income,
    investable: s.investable,
    liabilities: s.liabilities,
    investableNet: aNet,
    cashflowMonthly: s.cashflowMonthly,
    netCashflowMonthly: s.netCashflowMonthly,
    freedom,
  };
}

// ── Kế hoạch thu nhập năm (UC-1104) và điểm xuất phát Thử số (UC-1107): hình dạng API, dùng chung với web ──

export interface IncomePlanLine {
  name: string;
  memberId: string | null;
  memberName: string;
  monthly: number;
}
export interface IncomePlanVersion {
  id: number;
  createdAt: string;
  householdMonthly: number;
  lines: IncomePlanLine[];
}
export interface IncomePlanActual {
  monthsCounted: number;
  total: number;
  monthlyAverage: number | null;
  pctOfCurrent: number | null;
  pctOfFirst: number | null;
  pctOfYear: number | null;
}
export interface IncomePlanMember {
  memberId: string | null;
  memberName: string;
  planned: number;
  actual: number;
  pct: number | null;
}
export interface IncomePlanYear {
  year: number;
  current: IncomePlanVersion | null;
  first: IncomePlanVersion | null;
  versions: { id: number; createdAt: string; householdMonthly: number }[];
  actual: IncomePlanActual;
  byMember: IncomePlanMember[] | null;
}
export interface IncomePlanSummary {
  year: number;
  currentMonthly: number;
  firstMonthly: number;
  versions: number;
  monthsCounted: number;
  monthlyAverage: number | null;
  pctOfCurrent: number | null;
  pctOfFirst: number | null;
  pctOfYear: number | null;
}

export interface ProjectionIncomeLine {
  name: string;
  memberId: string | null;
  monthly: number;
}
export interface ProjectionStart {
  investable: number;
  liabilities: number;
  incomeLines: ProjectionIncomeLine[];
  incomeSource: "plan" | "ledger" | null;
  expenseMonthly: number | null;
  expenseMustMonthly: number | null;
  inflationBps: number;
  swrBps: number;
  fatBps: number;
  birthYear: number | null;
  targetAgeF1: number | null;
  targetAgeF2: number | null;
  /** Bình quân theo giá trị của lợi suất kỳ vọng các mục tài sản đầu tư có số; không có → null. */
  expectedReturnBps: number | null;
  /** Tỷ lệ để dành 3 tháng trọn gần nhất (Kết quả thu chi); chưa đủ → null. */
  savingsRatePct: number | null;
}
export type Freedom = FreedomMilestones & {
  today: string;
  year: number;
  params: FreedomParams;
  projectionStart: ProjectionStart;
  incomePlan: IncomePlanYear | null;
};

