// Thử số / Dự phóng (balance UC-1107, ADR nháp G; Công thức 16): tính ở máy trên nền số thật, không lưu, không gửi server.
// Hàm thuần: năm t = 1…N (năm = năm nay + t), mọi số làm tròn tới đồng từng bước.

import type { Result } from "./settings";
import type { ProjectionStart } from "./types";

export interface ProjectionIncome {
  name: string;
  /** Thu nhập ròng / tháng hôm nay. */
  monthly: number;
  /** % tăng mỗi năm. */
  growthPct: number;
}

export interface ProjectionInput {
  /** Năm nay. */
  year: number;
  /** Tài sản đầu tư A và nợ L (nợ giữ nguyên). */
  investable: number;
  liabilities: number;
  incomes: ProjectionIncome[];
  /** Chi phí tháng E và E_must hôm nay. */
  expense: number;
  expenseMust: number;
  /** Để dành = phần còn lại (thu nhập − chi phí) hay tỷ lệ cố định của thu nhập. */
  savingsMode: "rest" | "rate";
  savingsRatePct: number;
  /** Lợi suất tài sản đầu tư, lạm phát, tỷ lệ rút an toàn, hệ số dự phòng F2 — đều %. */
  returnPct: number;
  inflationPct: number;
  swrPct: number;
  fatPct: number;
  birthYear: number | null;
  targetAgeF1: number | null;
  targetAgeF2: number | null;
}

export interface ProjectionRow {
  year: number;
  age: number | null;
  /** Thu nhập / chi phí / để dành mỗi tháng của năm đó. Chi phí null = để dành theo tỷ lệ (không dùng E). */
  income: number;
  expense: number | null;
  savings: number;
  savingsRate: number | null;
  /** Tài sản đầu tư cuối năm và phần đã trừ nợ. */
  investable: number;
  net: number;
  /** Mốc F1, F2 quy theo giá năm đó. */
  f1Need: number;
  f2Need: number;
  f1Pct: number | null;
  f2Pct: number | null;
  f1: boolean;
  f2: boolean;
}

/** Năm đạt một mốc; `diff` = năm đạt − năm mục tiêu (dương = trễ). */
export interface Reach {
  year: number;
  age: number | null;
  targetYear: number | null;
  diff: number | null;
}

export interface Projection {
  /** F1, F2 hôm nay (Công thức 12) từ các ô đang gõ. */
  f1Today: number;
  f2Today: number;
  rows: ProjectionRow[];
  f1: Reach | null;
  f2: Reach | null;
}

export const MAX_YEARS = 40;

const bps = (pct: number): number => Math.round(pct * 100);
/** Phần trăm cắt về 0 sau một chữ số lẻ; mẫu số 0 → null. */
const pct = (x: number, y: number): number | null => (y === 0 ? null : Math.trunc((1000 * x) / y) / 10);

export function project(p: ProjectionInput): Projection {
  const swr = bps(p.swrPct);
  const f1Today = swr > 0 ? Math.ceil((12 * p.expenseMust * 10000) / swr) : 0;
  const f2Today = swr > 0 ? Math.ceil((12 * p.expense * bps(p.fatPct)) / swr) : 0;
  const r = p.returnPct / 100;
  const pi = p.inflationPct / 100;
  const rows: ProjectionRow[] = [];
  let a = p.investable;
  for (let t = 1; t <= MAX_YEARS; t++) {
    const year = p.year + t;
    const income = p.incomes.reduce((s, x) => s + Math.round(x.monthly * Math.pow(1 + x.growthPct / 100, t)), 0);
    const expense = p.savingsMode === "rest" ? Math.round(p.expense * Math.pow(1 + pi, t)) : null;
    const savings = expense !== null ? income - expense : Math.round((income * p.savingsRatePct) / 100);
    a = Math.round(a * (1 + r)) + 12 * savings;
    const net = a - p.liabilities;
    const f1Need = Math.round(f1Today * Math.pow(1 + pi, t));
    const f2Need = Math.round(f2Today * Math.pow(1 + pi, t));
    rows.push({
      year,
      age: p.birthYear === null ? null : year - p.birthYear,
      income,
      expense,
      savings,
      savingsRate: expense === null ? p.savingsRatePct : pct(savings, income),
      investable: a,
      net,
      f1Need,
      f2Need,
      f1Pct: pct(net, f1Need),
      f2Pct: pct(net, f2Need),
      f1: f1Need > 0 && net >= f1Need,
      f2: f2Need > 0 && net >= f2Need,
    });
  }
  const reach = (hit: (row: ProjectionRow) => boolean, targetAge: number | null): Reach | null => {
    const row = rows.find(hit);
    if (!row) return null;
    const targetYear = p.birthYear !== null && targetAge !== null ? p.birthYear + targetAge : null;
    return { year: row.year, age: row.age, targetYear, diff: targetYear === null ? null : row.year - targetYear };
  };
  const f1 = reach((x) => x.f1, p.targetAgeF1);
  const f2 = reach((x) => x.f2, p.targetAgeF2);
  // Bảng tới năm tuổi mục tiêu lớn nhất và năm đạt mốc; mốc nào chưa tới thì đủ 40 năm.
  const ends = [f1?.year, f2?.year, f1?.targetYear, f2?.targetYear].filter((y): y is number => typeof y === "number");
  const last = f1 && f2 && ends.length > 0 ? Math.min(Math.max(...ends), p.year + MAX_YEARS) : p.year + MAX_YEARS;
  return { f1Today, f2Today, rows: rows.filter((x) => x.year <= last), f1, f2 };
}

/** "F1 ở 46 tuổi (2036) — trễ 1 năm" · "F2 ở 49 tuổi (2039) — sớm 1 năm" · "Chưa tới F1 trong 40 năm". */
export function reachText(name: "F1" | "F2", r: Reach | null): string {
  if (!r) return `Chưa tới ${name} trong ${MAX_YEARS} năm`;
  const at = r.age === null ? `${name} năm ${r.year}` : `${name} ở ${r.age} tuổi (${r.year})`;
  if (r.diff === null) return at;
  return `${at} — ${r.diff === 0 ? "đúng mục tiêu" : `${r.diff > 0 ? "trễ" : "sớm"} ${Math.abs(r.diff)} năm`}`;
}

// ── Ô giả định ─────────────────────────────────────────────────────

export interface ProjectionIncomeForm {
  key: number;
  name: string;
  monthly: number;
  /** % tăng/năm, chữ người dùng gõ. */
  growth: string;
}

/** Các ô của card Giả định: tiền là số đồng (ô AmountInput), tỷ lệ / năm / tuổi là chữ người dùng gõ. */
export interface ProjectionForm {
  investable: number;
  liabilities: number;
  incomes: ProjectionIncomeForm[];
  expense: number;
  expenseMust: number;
  savingsMode: "rest" | "rate";
  savingsRate: string;
  returnPct: string;
  inflation: string;
  swr: string;
  /** Hệ số F2 lấy từ thông số, không có ô riêng. */
  fat: string;
  birthYear: string;
  f1: string;
  f2: string;
}

const pctOf = (bps: number | null): string => (bps === null ? "" : String(bps / 100).replace(".", ","));
const intOf = (n: number | null): string => (n === null ? "" : String(n));

/**
 * Điểm xuất phát = số thật (`GET /v1/freedom` › `projectionStart`); cũng là đích của "Đặt lại về số thật".
 * Dòng thu nhập của một người ghi kèm tên người ("Lương · Chồng") để hai dòng "Lương" không lẫn nhau.
 */
export function startToForm(s: ProjectionStart, memberName: (id: string) => string | undefined = () => undefined): ProjectionForm {
  return {
    investable: s.investable,
    liabilities: s.liabilities,
    incomes: s.incomeLines.map((l, i) => {
      const who = l.memberId ? memberName(l.memberId) : undefined;
      return { key: i + 1, name: who ? `${l.name} · ${who}` : l.name, monthly: l.monthly, growth: "0" };
    }),
    expense: s.expenseMonthly ?? 0,
    expenseMust: s.expenseMustMonthly ?? 0,
    savingsMode: "rest",
    savingsRate: s.savingsRatePct === null ? "" : String(s.savingsRatePct).replace(".", ","),
    returnPct: pctOf(s.expectedReturnBps),
    inflation: pctOf(s.inflationBps),
    swr: pctOf(s.swrBps),
    fat: pctOf(s.fatBps),
    birthYear: intOf(s.birthYear),
    f1: intOf(s.targetAgeF1),
    f2: intOf(s.targetAgeF2),
  };
}

/** "12,5" / "-3" → số; trống → `empty`; sai → NaN. */
function num(text: string, empty: number | null): number | null {
  const t = text.trim().replace("%", "").replace(",", ".").replace("−", "-").trim();
  if (t === "") return empty;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** Ô → đầu vào của `project`. Ô sai thì báo tại ô, bảng chờ sửa xong. Lợi suất để trống = 0. */
export function formToInput(f: ProjectionForm, year: number): Result<ProjectionInput> {
  const errors: Record<string, string> = {};
  const check = (key: string, v: number | null, ok: (n: number) => boolean, message: string): number | null => {
    if (v === null) return null;
    if (Number.isNaN(v) || !ok(v)) errors[key] = message;
    return v;
  };
  const incomes = f.incomes.map((l) => ({ name: l.name.trim() || "Thu nhập", monthly: l.monthly, growthPct: check(`growth${l.key}`, num(l.growth, 0), (n) => n >= -100 && n <= 100, "Tăng/năm từ −100% đến 100%.") ?? 0 }));
  const returnPct = check("returnPct", num(f.returnPct, 0), (n) => n >= -100 && n <= 100, "Lợi suất từ −100% đến 100%.") ?? 0;
  const inflationPct = check("inflation", num(f.inflation, 0), (n) => n >= 0 && n <= 50, "Lạm phát từ 0% đến 50%.") ?? 0;
  const swrPct = check("swr", num(f.swr, null), (n) => n > 0 && n <= 20, "Tỷ lệ rút an toàn lớn hơn 0%, tối đa 20%.");
  if (swrPct === null) errors.swr = "Nhập tỷ lệ rút an toàn.";
  const fatPct = num(f.fat, 100) ?? 100;
  const savingsRatePct = f.savingsMode === "rate" ? check("savingsRate", num(f.savingsRate, null), (n) => n >= 0 && n <= 100, "Tỷ lệ để dành từ 0% đến 100%.") : 0;
  if (f.savingsMode === "rate" && savingsRatePct === null) errors.savingsRate = "Nhập tỷ lệ để dành.";
  const birthYear = check("birthYear", num(f.birthYear, null), (n) => Number.isInteger(n) && n >= 1900 && n <= year, `Năm sinh từ 1900 đến ${year}.`);
  const age = (key: "f1" | "f2") => check(key, num(f[key], null), (n) => Number.isInteger(n) && n > 0 && n <= 100, "Tuổi từ 1 đến 100.");
  const targetAgeF1 = age("f1");
  const targetAgeF2 = age("f2");
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      year,
      investable: f.investable,
      liabilities: f.liabilities,
      incomes,
      expense: f.expense,
      expenseMust: f.expenseMust,
      savingsMode: f.savingsMode,
      savingsRatePct: savingsRatePct ?? 0,
      returnPct,
      inflationPct,
      swrPct: swrPct!,
      fatPct: Number.isNaN(fatPct) ? 100 : fatPct,
      birthYear,
      targetAgeF1,
      targetAgeF2,
    },
  };
}

// Số gõ chỉ nằm trong bộ nhớ của trang (UC-1107 AC-2): rời màn rồi quay lại còn nguyên, tải lại app thì mất. Không gửi đi đâu.
let kept: ProjectionForm | null = null;
export const keepDraft = (f: ProjectionForm | null): void => {
  kept = f;
};
export const keptDraft = (): ProjectionForm | null => kept;
