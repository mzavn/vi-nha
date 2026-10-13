// Lưu chuyển tiền và Kết quả thu chi (BR-15, change 261008-bang-can-doi lát 2 — Công thức 14, 15, ADR nháp F). Hàm thuần:
// SQL đã xếp mỗi giao dịch vào dòng mặc định (CASE theo bảng phân loại, dòng khớp đầu tiên thắng) và gộp theo tháng;
// ở đây chỉ áp phân loại lại lên các hàng đã gộp, cộng nhóm và dựng kỳ. Tiền là số nguyên đồng.

import { monthEnd, pct } from "./balance";
import { DomainError } from "./types";

export type CashFlowGroup = "operating" | "investing" | "financing";
export type ReportClass = "operating" | "passive_income" | "investing" | "financing";
export const REPORT_CLASSES: readonly ReportClass[] = ["operating", "passive_income", "investing", "financing"];

/** Mọi dòng của Lưu chuyển tiền, theo thứ tự hiện trong nhóm. */
const LINES = {
  operating: {
    salary_other: "Lương và thu khác",
    rental_income: "Thu cho thuê lại",
    refund: "Hoàn tiền",
    loan_interest: "Lãi vay",
    spend_must: "Chi Must",
    spend_have: "Chi Có thì tốt",
    spend_nice: "Chi Hưởng thụ",
    spend_tax: "Thuế đã nộp",
    spend_wealth: "Chi từ Tích sản",
    spend_other: "Chi khác",
    adjust: "Điều chỉnh khi đếm số dư",
    other: "Khác",
  },
  investing: {
    passive_income: "Lãi, cổ tức, tiền thuê thu về",
    asset_sale: "Bán tài sản, thu hồi đầu tư",
    buy_asset: "Mua tài sản qua app",
    asset_purchase: "Mua tài sản",
  },
  financing: {
    borrow: "Vay, nhận tiền",
    debt_principal: "Trả nợ gốc",
    lend: "Cho vay / trả hộ",
    collect: "Thu hồi cho vay",
    financing_out: "Chi tài chính khác",
  },
} as const;

type LinesOf<G extends CashFlowGroup> = keyof (typeof LINES)[G];
export type CashFlowLineKey = LinesOf<"operating"> | LinesOf<"investing"> | LinesOf<"financing">;
export const GROUPS: readonly CashFlowGroup[] = ["operating", "investing", "financing"];
export const LINE_GROUP = Object.fromEntries(
  GROUPS.flatMap((g) => Object.keys(LINES[g]).map((line) => [line, g])),
) as Record<CashFlowLineKey, CashFlowGroup>;
export const LINE_LABEL = Object.fromEntries(GROUPS.flatMap((g) => Object.entries(LINES[g]))) as Record<CashFlowLineKey, string>;
export const isLineKey = (v: string): v is CashFlowLineKey => Object.prototype.hasOwnProperty.call(LINE_GROUP, v);

/** Một hàng đã gộp của truy vấn phân loại (hoặc một giao dịch). */
export interface ClassifiedRow {
  month: string;
  /** Dòng mặc định (SQL CASE). */
  line: CashFlowLineKey;
  /** Dòng theo phe ví của khoản chi (null khi không phải chi) — dùng khi xếp lại về Sinh hoạt. */
  spendLine: CashFlowLineKey | null;
  reportClass: ReportClass | null;
  isIncome: boolean;
  /** Có dấu: + tiền vào tài khoản, − tiền ra. */
  amount: number;
  count: number;
}

/**
 * Dòng cuối cùng sau phân loại lại. Cùng nhóm với mặc định → giữ dòng mặc định; Thu nhập thụ động chỉ cho khoản thu
 * (khoản khác giữ mặc định — API đã chặn); Sinh hoạt → dòng chi theo phe ví / Lương và thu khác / Khác; Đầu tư, Tài chính →
 * dòng vào / ra của nhóm.
 */
export function finalLine(r: Pick<ClassifiedRow, "line" | "spendLine" | "reportClass" | "isIncome" | "amount">): CashFlowLineKey {
  const rc = r.reportClass;
  if (!rc) return r.line;
  if (rc === "passive_income") return r.isIncome ? "passive_income" : r.line;
  if (rc === LINE_GROUP[r.line]) return r.line;
  const incoming = r.amount > 0;
  if (rc === "operating") return r.spendLine ?? (r.isIncome ? "salary_other" : "other");
  if (rc === "investing") return incoming ? "asset_sale" : "asset_purchase";
  return incoming ? "borrow" : "financing_out";
}

// ── Kỳ ──────────────────────────────────────────────────────────────

export interface Period {
  period: string;
  kind: "month" | "year";
  /** Tháng đầu / cuối 'YYYY-MM' (kỳ đang chạy: cuối = tháng hiện tại). */
  fromMonth: string;
  toMonth: string;
  /** Ngày đầu kỳ và ngày cuối (kỳ đang chạy: hôm nay). */
  from: string;
  to: string;
}

/** `2026-10` hoặc `2026`; sai dạng hoặc sau tháng / năm hiện tại → 400 invalid_period. */
export function parsePeriod(period: string | undefined, today: string): Period {
  const bad = (): never => {
    throw new DomainError("invalid_period", "Kỳ phải có dạng 2026-10 (tháng) hoặc 2026 (năm), không sau kỳ hiện tại.");
  };
  const p = period ?? "";
  const thisMonth = today.slice(0, 7);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) {
    if (p > thisMonth || p < "2000-01") bad();
    return { period: p, kind: "month", fromMonth: p, toMonth: p, from: `${p}-01`, to: p === thisMonth ? today : monthEnd(p) };
  }
  if (/^\d{4}$/.test(p)) {
    if (p > today.slice(0, 4) || p < "2000") bad();
    const last = p === today.slice(0, 4) ? thisMonth : `${p}-12`;
    return { period: p, kind: "year", fromMonth: `${p}-01`, toMonth: last, from: `${p}-01-01`, to: last === thisMonth ? today : monthEnd(last) };
  }
  return bad();
}

/** Các tháng 'YYYY-MM' từ `from` tới `to` (kể cả hai đầu). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let [y, m] = from.split("-").map(Number) as [number, number]; `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

// ── Lưu chuyển tiền (Công thức 14) ──────────────────────────────────

export interface CashAccount {
  id: string;
  kind: string;
  openingBalance: number;
  openedAt: string | null;
  active: boolean;
  deactivatedAt: string | null;
}
/** Σ có dấu của giao dịch theo (tài khoản, tháng). */
export interface AccountMonth {
  id: string;
  month: string;
  delta: number;
}

const neverPresent = (a: CashAccount) => !a.active && a.deactivatedAt === null;
const presentAt = (a: CashAccount, date: string) =>
  (a.active || (a.deactivatedAt !== null && a.deactivatedAt > date)) && (a.openedAt === null || a.openedAt <= date);

/** Σ sổ (gồm thẻ tín dụng âm) của tài khoản có mặt tại cuối ngày `date`, giao dịch tới hết tháng `month`. */
function bookAt(accounts: CashAccount[], deltas: Map<string, Map<string, number>>, date: string, month: string) {
  let total = 0;
  let card = 0;
  for (const a of accounts) {
    if (!presentAt(a, date)) continue;
    let b = a.openingBalance;
    for (const [m, d] of deltas.get(a.id) ?? []) if (m <= month) b += d;
    total += b;
    if (a.kind === "credit" && b < 0) card -= b;
  }
  return { total, card };
}

const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const prevMonth = (month: string) => dayBefore(`${month}-01`).slice(0, 7);

export interface CashFlowLine {
  line: CashFlowLineKey;
  label: string;
  total: number;
  count: number;
  reclassified: number;
}
export interface CashFlowMonth {
  month: string;
  opening: number;
  openedAccounts: number;
  closedAccounts: number;
  operating: number;
  investing: number;
  financing: number;
  closing: number;
}
export interface CashFlow {
  period: string;
  kind: "month" | "year";
  from: string;
  to: string;
  opening: number;
  openedAccounts: number;
  closedAccounts: number;
  closing: number;
  creditCardDebt: number;
  groups: { group: CashFlowGroup; total: number; lines: CashFlowLine[] }[];
  lotNote: { bought: number; sold: number };
  months: CashFlowMonth[] | null;
}

/** Đầu kỳ, mở / tắt trong kỳ, cuối kỳ của một khoảng tháng [from, to] tới ngày `toDate`. */
function bounds(accounts: CashAccount[], deltas: Map<string, Map<string, number>>, fromMonth: string, toMonth: string, toDate: string) {
  const fromDate = `${fromMonth}-01`;
  const start = bookAt(accounts, deltas, dayBefore(fromDate), prevMonth(fromMonth));
  const end = bookAt(accounts, deltas, toDate, toMonth);
  let opened = 0;
  let closed = 0;
  for (const a of accounts) {
    if (neverPresent(a)) continue;
    if (a.openedAt !== null && a.openedAt >= fromDate && a.openedAt <= toDate) opened += a.openingBalance;
    if (!a.active && a.deactivatedAt !== null && a.deactivatedAt >= fromDate && a.deactivatedAt <= toDate) {
      // Không có giao dịch nào sau ngày tắt: số dư lúc tắt = số dư đầu + mọi giao dịch của tài khoản.
      let b = a.openingBalance;
      for (const d of deltas.get(a.id)?.values() ?? []) b += d;
      closed -= b;
    }
  }
  return { opening: start.total, openedAccounts: opened, closedAccounts: closed, closing: end.total, creditCardDebt: end.card };
}

/**
 * Báo cáo lưu chuyển tiền: đầu kỳ + mở trong kỳ + tắt trong kỳ + Sinh hoạt + Đầu tư + Tài chính = cuối kỳ = Σ sổ cuối kỳ
 * (bất biến do dựng cùng một nguồn: số dư sổ theo `month_key`, như ba nhóm).
 */
export function buildCashFlow(input: {
  period: Period;
  accounts: CashAccount[];
  accountMonths: AccountMonth[];
  rows: ClassifiedRow[];
  lotNote: { bought: number; sold: number };
}): CashFlow {
  const { period: p, accounts, rows } = input;
  const deltas = new Map<string, Map<string, number>>();
  for (const r of input.accountMonths) {
    const m = deltas.get(r.id) ?? new Map<string, number>();
    m.set(r.month, (m.get(r.month) ?? 0) + r.delta);
    deltas.set(r.id, m);
  }
  const lines = new Map<CashFlowLineKey, CashFlowLine>();
  const byMonth = new Map<string, Record<CashFlowGroup, number>>();
  for (const r of rows) {
    const line = finalLine(r);
    const l = lines.get(line) ?? { line, label: LINE_LABEL[line], total: 0, count: 0, reclassified: 0 };
    l.total += r.amount;
    l.count += r.count;
    if (r.reportClass) l.reclassified += r.count;
    lines.set(line, l);
    const m = byMonth.get(r.month) ?? { operating: 0, investing: 0, financing: 0 };
    m[LINE_GROUP[line]] += r.amount;
    byMonth.set(r.month, m);
  }
  const groups = GROUPS.map((group) => {
    const list = Object.keys(LINES[group]).flatMap((k) => lines.get(k as CashFlowLineKey) ?? []);
    return { group, total: list.reduce((s, l) => s + l.total, 0), lines: list };
  });
  const whole = bounds(accounts, deltas, p.fromMonth, p.toMonth, p.to);

  let months: CashFlowMonth[] | null = null;
  if (p.kind === "year") {
    // Bỏ các tháng trước tháng đầu tiên có dữ liệu trong năm (tài khoản mở sổ hoặc giao dịch).
    const dataMonths = [
      ...accounts.flatMap((a) => (a.openedAt ? [a.openedAt.slice(0, 7)] : [])),
      ...input.accountMonths.map((r) => r.month),
    ].filter((m) => m >= p.fromMonth && m <= p.toMonth);
    const first = dataMonths.length ? dataMonths.reduce((a, b) => (b < a ? b : a)) : p.toMonth;
    months = monthRange(first, p.toMonth).map((month) => {
      const g = byMonth.get(month) ?? { operating: 0, investing: 0, financing: 0 };
      return { month, ...bounds(accounts, deltas, month, month, month === p.toMonth ? p.to : monthEnd(month)), ...g };
    }).map(({ creditCardDebt: _c, ...m }) => m);
  }
  return {
    period: p.period,
    kind: p.kind,
    from: p.from,
    to: p.to,
    opening: whole.opening,
    openedAccounts: whole.openedAccounts,
    closedAccounts: whole.closedAccounts,
    closing: whole.closing,
    creditCardDebt: whole.creditCardDebt,
    groups,
    lotNote: input.lotNote,
    months,
  };
}

// ── Kết quả thu chi (Công thức 15) ──────────────────────────────────

/** Một hàng đã gộp cho Kết quả thu chi. */
export interface StatementRow {
  month: string;
  meaning: "income" | "spend" | "refund" | "buy_asset" | "adjust";
  reportClass: ReportClass | null;
  tenant: boolean;
  /** Khoản thu vào tài khoản phao / sổ tiết kiệm. */
  passiveAccount: boolean;
  principal: boolean;
  interest: boolean;
  /** Phe / nhóm của ví bị trừ (chi) hoặc được hoàn (hoàn tiền). */
  tier: string | null;
  mustGroup: string | null;
  /** Số tiền dương; `signed` có dấu theo tài khoản (cho điều chỉnh). */
  amount: number;
  signed: number;
}

export type IncomeLineKey = "salary_other" | "rental_income" | "passive_income";
export type ExpenseLineKey = "must" | "have" | "nice" | "tax" | "wealth_building" | "other";
export interface StatementLine {
  line: string;
  label: string;
  total: number;
  children?: StatementLine[];
}
export interface IncomeStatementMonth {
  month: string;
  income: number;
  expense: number;
  savings: number;
  savingsRate: number | null;
}
export interface IncomeStatement {
  period: string;
  kind: "month" | "year";
  income: { total: number; lines: StatementLine[] };
  expense: { total: number; lines: StatementLine[] };
  savings: number;
  savingsRate: number | null;
  excluded: { debtPrincipal: number; buyAsset: number; reclassifiedInvesting: number; reclassifiedFinancing: number; adjust: number };
  months: IncomeStatementMonth[] | null;
}

const INCOME_LABEL: Record<IncomeLineKey, string> = { salary_other: "Lương và thu khác", rental_income: "Cho thuê lại", passive_income: "Thu nhập thụ động" };
const EXPENSE_LABEL: Record<ExpenseLineKey, string> = {
  must: "Must",
  have: "Có thì tốt",
  nice: "Hưởng thụ",
  tax: "Thuế đã nộp",
  wealth_building: "Chi từ Tích sản",
  other: "Khác",
};

const expenseLine = (r: StatementRow): ExpenseLineKey =>
  r.tier === "must" ? (r.mustGroup === "have" ? "have" : "must") : r.tier === "nice" ? "nice" : r.tier === "tax" ? "tax" : r.tier === "wealth_building" ? "wealth_building" : "other";

const outOfStatement = (r: StatementRow) => r.reportClass === "investing" || r.reportClass === "financing";

/** Thu nhập − Chi tiêu = Để dành; trả nợ gốc, mua tài sản, khoản xếp lại Đầu tư / Tài chính, điều chỉnh chỉ ở chân. */
export function buildIncomeStatement(period: Period, rows: StatementRow[]): IncomeStatement {
  const income: Record<IncomeLineKey, number> = { salary_other: 0, rental_income: 0, passive_income: 0 };
  const expense: Record<ExpenseLineKey, number> = { must: 0, have: 0, nice: 0, tax: 0, wealth_building: 0, other: 0 };
  let interest = 0;
  const excluded = { debtPrincipal: 0, buyAsset: 0, reclassifiedInvesting: 0, reclassifiedFinancing: 0, adjust: 0 };
  const perMonth = new Map<string, { income: number; expense: number }>();
  for (const r of rows) {
    const m = perMonth.get(r.month) ?? { income: 0, expense: 0 };
    perMonth.set(r.month, m);
    if (r.meaning === "buy_asset") excluded.buyAsset += r.amount;
    else if (r.meaning === "adjust") excluded.adjust += r.signed;
    else if (r.meaning === "spend" && r.principal) excluded.debtPrincipal += r.amount;
    else if (outOfStatement(r)) {
      if (r.reportClass === "investing") excluded.reclassifiedInvesting += r.amount;
      else excluded.reclassifiedFinancing += r.amount;
    } else if (r.meaning === "income") {
      const line: IncomeLineKey =
        r.reportClass === "passive_income" ? "passive_income" : r.tenant ? "rental_income" : !r.reportClass && r.passiveAccount ? "passive_income" : "salary_other";
      income[line] += r.amount;
      m.income += r.amount;
    } else {
      const signed = r.meaning === "refund" ? -r.amount : r.amount;
      const line = expenseLine(r);
      expense[line] += signed;
      if (line === "must" && r.interest) interest += signed;
      m.expense += signed;
    }
  }
  const incomeTotal = Object.values(income).reduce((s, v) => s + v, 0);
  const expenseTotal = Object.values(expense).reduce((s, v) => s + v, 0);
  const months =
    period.kind === "year"
      ? [...perMonth.keys()].sort().map((month) => {
          const m = perMonth.get(month)!;
          return { month, income: m.income, expense: m.expense, savings: m.income - m.expense, savingsRate: pct(m.income - m.expense, m.income) };
        })
      : null;
  return {
    period: period.period,
    kind: period.kind,
    income: { total: incomeTotal, lines: (Object.keys(income) as IncomeLineKey[]).map((line) => ({ line, label: INCOME_LABEL[line], total: income[line] })) },
    expense: {
      total: expenseTotal,
      lines: (Object.keys(expense) as ExpenseLineKey[]).map((line) => ({
        line,
        label: EXPENSE_LABEL[line],
        total: expense[line],
        ...(line === "must" ? { children: [{ line: "loan_interest", label: "Lãi vay", total: interest }] } : {}),
      })),
    },
    savings: incomeTotal - expenseTotal,
    savingsRate: pct(incomeTotal - expenseTotal, incomeTotal),
    excluded,
    months,
  };
}
