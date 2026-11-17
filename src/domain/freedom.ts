// Mốc tự do (BR-15, UC-1103 — Công thức 8–13 của change 261008-bang-can-doi; đệm, thang mốc, tài sản cho FIRE của change
// 261117-thang-moc-de-tu-do). Hàm thuần: tiền là số nguyên đồng, tỷ lệ là phần vạn (SWR 3,5% = 350) để không lệch số thực; số
// theo giá năm mục tiêu chỉ là ước lượng.

import { pct } from "./balance";

export interface FreedomParams {
  expenseMonthly: number | null;
  expenseSource: "manual" | "ledger" | null;
  expenseMustMonthly: number | null;
  expenseMustSource: "manual" | "ledger" | null;
  /** N của Công thức 8 (1..3): số tháng trọn E / E_must theo sổ đã lấy; null khi cả hai không lấy từ sổ. */
  expenseLedgerMonths: number | null;
  incomeMonthly: number | null;
  incomeSource: "ledger" | "plan" | null;
  /** Phần trích trước của M2′ (phần vạn): `savings_pct` + Σ `target_pct` của mục tiêu Thuế đang dùng, tối đa 99%. */
  lockedBps: number;
  swrBps: number;
  inflationBps: number;
  fatBps: number;
  legacyRateBps: number;
  highInterestBps: number;
  /** Ba mốc đệm An tâm · An toàn · Vững vàng (tháng chi, `fi_safety_months`). */
  safetyMonths: [number, number, number];
  birthYear: number | null;
  targetAges: { f1: number | null; f2: number | null; f3: number | null };
}
/** Một bậc đệm (Công thức 10): Khởi đầu 1 × E, An tâm / An toàn / Vững vàng = `safetyMonths` × E. */
export interface CushionStep {
  key: "start" | "calm" | "safe" | "solid";
  months: number;
  need: number | null;
  have: number;
  pct: number | null;
  reached: boolean | null;
}
export interface CushionLadder {
  monthsCovered: number | null;
  steps: CushionStep[];
  /** Bậc chưa đạt đầu tiên; null khi đã qua mọi bậc hoặc chưa có E. */
  next: CushionStep["key"] | null;
}
/** Đệm = tổng ngăn Tích luỹ (kể cả Heo đất; vàng và mục tài sản không vào). */
export type Cushion = CushionLadder & { amount: number };
/** Tài sản cho FIRE (Công thức 12): `net` = investable − liabilities − operating − reserveGoals − reward − cushionKept. */
export interface FireAssets {
  investable: number;
  liabilities: number;
  operating: number;
  reserveGoals: number;
  reward: number;
  cushionKept: number;
  net: number;
}
/** Nửa đường: tài sản cho FIRE ≥ ⌈F1 ÷ 2⌉ hoặc dòng tiền ròng ≥ ⌈E ÷ 2⌉. */
export interface Halfway {
  need: number | null;
  have: number;
  pct: number | null;
  cashflowNeed: number | null;
  cashflowHave: number;
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
  cushion: Cushion;
  income: IncomeMilestone[];
  investable: number;
  liabilities: number;
  fireAssets: FireAssets;
  halfway: Halfway;
  cashflowMonthly: number;
  netCashflowMonthly: number;
  freedom: FreedomMilestone[];
}

/** Bảng cân đối và ba ngăn hôm nay, phần Mốc tự do cần (Công thức 12: V, G, W; Công thức 10: đệm). */
export interface SheetFigures {
  investable: number;
  liabilities: number;
  /** V: phần các tài khoản ngăn Vận hành góp vào Tiền trong app (thẻ tín dụng đang âm góp 0). */
  operating: number;
  /** G: phần các tài khoản Dự phòng gắn mục tiêu đang dùng và tài khoản con của chúng. */
  reserveGoals: number;
  /** W: `pockets.reserve.reward?.balance ?? 0`. */
  reward: number;
  /** Đệm: tổng ngăn Tích luỹ. */
  cushion: number;
  cashflowMonthly: number;
  netCashflowMonthly: number;
}

/** Chia làm tròn lên (số nguyên dương). */
const ceilDiv = (a: number, b: number) => Math.ceil(a / b);

const CUSHION_KEYS = ["start", "calm", "safe", "solid"] as const;

/**
 * Bậc đệm (Công thức 10) — dùng chung server (`cushion`) và thẻ Tích luỹ (gọi lại với số đã trừ tạm). E không có / ≤ 0 → không
 * có số cần, không số tháng. Số tháng = max(0, ⌊10 × đệm ÷ E⌋ ÷ 10).
 */
export function cushionLadder(amount: number, expenseMonthly: number | null, safetyMonths: [number, number, number]): CushionLadder {
  const E = expenseMonthly !== null && expenseMonthly > 0 ? expenseMonthly : null;
  const steps = CUSHION_KEYS.map((key, i): CushionStep => {
    const months = i === 0 ? 1 : safetyMonths[i - 1]!;
    const need = E === null ? null : months * E;
    return { key, months, need, have: amount, pct: need === null ? null : pct(amount, need), reached: need === null ? null : amount >= need };
  });
  return {
    monthsCovered: E === null ? null : Math.max(0, Math.trunc((10 * amount) / E) / 10),
    steps,
    next: E === null ? null : (steps.find((s) => !s.reached)?.key ?? null),
  };
}

/**
 * Đệm, thu nhập M2 / M2′ / M3 (11), tài sản cho FIRE, Nửa đường, Tự do F1–F3 (12) và tuổi mục tiêu (13). E / E_must ≤ 0 coi như
 * chưa có (không có số cần nào theo chúng).
 */
export function milestones(p: FreedomParams, s: SheetFigures, year: number): FreedomMilestones {
  const E = p.expenseMonthly !== null && p.expenseMonthly > 0 ? p.expenseMonthly : null;
  const Em = p.expenseMustMonthly !== null && p.expenseMustMonthly > 0 ? p.expenseMustMonthly : null;
  const I = p.incomeMonthly;
  const kept = Math.max(s.cushion, 0);
  const cushionKept = E === null ? kept : Math.min(kept, p.safetyMonths[2] * E);
  const net = s.investable - s.liabilities - s.operating - s.reserveGoals - s.reward - cushionKept;
  const fireAssets: FireAssets = { investable: s.investable, liabilities: s.liabilities, operating: s.operating, reserveGoals: s.reserveGoals, reward: s.reward, cushionKept, net };
  const P = s.netCashflowMonthly;
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
    have: net,
    pct: need === null ? null : pct(net, need),
    cashflowNeed,
    cashflowHave: P,
    reached: need === null ? null : net >= need || (cashflowNeed !== null && P >= cashflowNeed),
    target: target(age, need),
  }));
  const f1 = defs[0]![1];
  const halfNeed = f1 === null ? null : ceilDiv(f1, 2);
  const halfCashflow = E === null ? null : ceilDiv(E, 2);
  const halfway: Halfway = {
    need: halfNeed,
    have: net,
    pct: halfNeed === null ? null : pct(net, halfNeed),
    cashflowNeed: halfCashflow,
    cashflowHave: P,
    reached: halfNeed === null && halfCashflow === null ? null : (halfNeed !== null && net >= halfNeed) || (halfCashflow !== null && P >= halfCashflow),
  };
  return {
    cushion: { amount: s.cushion, ...cushionLadder(s.cushion, E, p.safetyMonths) },
    income,
    investable: s.investable,
    liabilities: s.liabilities,
    fireAssets,
    halfway,
    cashflowMonthly: s.cashflowMonthly,
    netCashflowMonthly: P,
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

