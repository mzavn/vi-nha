// Mốc tự do (BR-15, UC-1103) + điểm xuất phát của Thử số (UC-1107). Số thật lấy từ bảng cân đối hôm nay (UC-1102), Kết quả
// thu chi 3 tháng trọn gần nhất (UC-1106), kế hoạch thu nhập năm nay (UC-1104) và tham số fi_* (UC-507) — không số nào cứng
// trong code. Thử số tính ở máy (ADR nháp G): server chỉ trả điểm xuất phát.

import { monthsBack } from "../domain/balance";
import { milestones, type Freedom, type FreedomParams, type ProjectionIncomeLine } from "../domain/freedom";
import { dayKey } from "../domain/period";
import { buildIncomeStatement } from "../domain/reports";
import { getBalanceSheet } from "./balance";
import { getYear } from "./income-plans";
import { statementRows } from "./reports";
import { readFiConfig } from "./settings";

/** `GET /v1/freedom` (và khối `freedom` của MCP get_balance_sheet). */
export async function getFreedom(db: D1Database, now: Date): Promise<Freedom> {
  const today = dayKey(now);
  const year = Number(today.slice(0, 4));
  // Ba tháng đã kết thúc gần nhất; đủ khi sổ có giao dịch từ tháng sớm nhất trong ba tháng đó trở về trước.
  const last3 = monthsBack(today.slice(0, 7), 4).slice(0, 3);
  const [sheet, cfg, plan, rows3, meta] = await Promise.all([
    getBalanceSheet(db, undefined, now),
    readFiConfig(db),
    getYear(db, year, now),
    statementRows(db, last3[0]!, last3[2]!),
    db.batch([
      db.prepare("SELECT MIN(month_key) AS m FROM transactions WHERE status = 'active'"),
      db.prepare(
        `SELECT COALESCE(SUM(a.percent), 0) AS p FROM allocations a JOIN wallets w ON w.id = a.wallet_id
         WHERE a.active = 1 AND w.active = 1 AND a.mode = 'percent' AND w.tier IN ('wealth_building', 'tax')`,
      ),
    ]),
  ]);
  const firstMonth = (meta[0]!.results?.[0] as { m: string | null } | undefined)?.m ?? null;
  const lockedBps = Math.round(Number((meta[1]!.results?.[0] as { p: number } | undefined)?.p ?? 0) * 10_000);

  // E, E_must, I theo sổ (Công thức 8, 9): TB 3 tháng trọn của Kết quả thu chi.
  const full = firstMonth !== null && firstMonth <= last3[0]!;
  const st = buildIncomeStatement({ period: "", kind: "month", fromMonth: last3[0]!, toMonth: last3[2]!, from: "", to: "" }, rows3);
  const line = (k: string) => st.expense.lines.find((l) => l.line === k)!.total;
  const ledger = full
    ? {
        expense: Math.round((line("must") + line("have") + line("nice")) / 3),
        must: Math.round(line("must") / 3),
        income: Math.round(st.income.total / 3),
        savingsRatePct: st.savingsRate,
      }
    : null;
  const planned = plan.current?.householdMonthly ?? null;
  const params: FreedomParams = {
    expenseMonthly: cfg.fi_expense_monthly ?? ledger?.expense ?? null,
    expenseSource: cfg.fi_expense_monthly !== null ? "manual" : ledger ? "ledger" : null,
    expenseMustMonthly: cfg.fi_expense_must_monthly ?? ledger?.must ?? null,
    expenseMustSource: cfg.fi_expense_must_monthly !== null ? "manual" : ledger ? "ledger" : null,
    incomeMonthly: ledger?.income ?? planned,
    incomeSource: ledger ? "ledger" : planned !== null ? "plan" : null,
    lockedBps,
    swrBps: cfg.fi_swr_bps,
    inflationBps: cfg.fi_inflation_bps,
    fatBps: cfg.fi_fat_bps,
    legacyRateBps: cfg.fi_legacy_rate_bps,
    highInterestBps: cfg.fi_high_interest_bps,
    safetyMonths: cfg.fi_safety_months.split(",").map(Number) as [number, number, number],
    birthYear: cfg.fi_birth_year,
    targetAges: { f1: cfg.fi_target_age_f1, f2: cfg.fi_target_age_f2, f3: cfg.fi_target_age_f3 },
  };

  const rows = sheet.assets.flatMap((s) => s.rows);
  const figures = {
    liquid: rows.filter((r) => r.liquid).reduce((s, r) => s + r.value, 0),
    investable: rows.filter((r) => r.investable).reduce((s, r) => s + r.value, 0),
    liabilities: sheet.totalLiabilities,
    cashflowMonthly: sheet.cashflowMonthly,
    netCashflowMonthly: sheet.netCashflowMonthly,
  };

  const weighted = sheet.items.filter((i) => i.present && i.investable && i.expectedReturnBps !== null && i.value! > 0);
  const weight = weighted.reduce((s, i) => s + i.value!, 0);
  const incomeLines: ProjectionIncomeLine[] = plan.current
    ? plan.current.lines.length
      ? plan.current.lines.map((l) => ({ name: l.name, memberId: l.memberId, monthly: l.monthly }))
      : [{ name: "Cả nhà", memberId: null, monthly: plan.current.householdMonthly }]
    : ledger
      ? [{ name: "Cả nhà", memberId: null, monthly: ledger.income }]
      : [];
  return {
    today,
    year,
    params,
    ...milestones(params, figures, year),
    projectionStart: {
      investable: figures.investable,
      liabilities: figures.liabilities,
      incomeLines,
      incomeSource: plan.current ? "plan" : ledger ? "ledger" : null,
      expenseMonthly: params.expenseMonthly,
      expenseMustMonthly: params.expenseMustMonthly,
      inflationBps: params.inflationBps,
      swrBps: params.swrBps,
      fatBps: params.fatBps,
      birthYear: params.birthYear,
      targetAgeF1: params.targetAges.f1,
      targetAgeF2: params.targetAges.f2,
      expectedReturnBps: weight > 0 ? Math.round(weighted.reduce((s, i) => s + i.value! * i.expectedReturnBps!, 0) / weight) : null,
      savingsRatePct: ledger?.savingsRatePct ?? null,
    },
    incomePlan: plan.current ? plan : null,
  };
}
