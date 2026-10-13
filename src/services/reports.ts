// Lưu chuyển tiền và Kết quả thu chi (BR-15, UC-1105, UC-1106) + phân loại lại một giao dịch cho báo cáo. Phân loại mặc
// định chạy trong SQL (CASE theo bảng phân loại, dòng khớp đầu tiên thắng, LEFT JOIN transaction_report_classes) và gộp
// theo tháng × dòng — báo cáo năm cũng chỉ vài câu SQL, không câu nào lặp theo tháng (ADR nháp B, Workers Free).

import { dayKey } from "../domain/period";
import {
  buildCashFlow,
  buildIncomeStatement,
  finalLine,
  isLineKey,
  LINE_GROUP,
  parsePeriod,
  REPORT_CLASSES,
  type CashFlow,
  type CashFlowLineKey,
  type ClassifiedRow,
  type IncomeStatement,
  type ReportClass,
  type StatementRow,
} from "../domain/reports";
import { DomainError } from "../domain/types";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400): never => {
  throw new DomainError(code, message, status);
};

/** Dòng chi theo phe của ví bị trừ. */
const SPEND_LINE = `CASE w.tier WHEN 'must' THEN CASE w.must_group WHEN 'have' THEN 'spend_have' ELSE 'spend_must' END
  WHEN 'nice' THEN 'spend_nice' WHEN 'tax' THEN 'spend_tax' WHEN 'wealth_building' THEN 'spend_wealth' ELSE 'spend_other' END`;

/** Bảng phân loại mặc định (proposal UC-1105): xét từ trên xuống, dòng khớp đầu tiên thắng. */
const DEFAULT_LINE = `CASE
  WHEN t.meaning = 'income' AND t.tenant_id IS NOT NULL THEN 'rental_income'
  WHEN t.meaning = 'income' AND ca.role IN ('buffer', 'term_deposit') THEN 'passive_income'
  WHEN t.meaning = 'income' THEN 'salary_other'
  WHEN t.meaning = 'refund' THEN 'refund'
  WHEN t.meaning = 'spend' AND t.debt_id IS NOT NULL THEN 'debt_principal'
  WHEN t.meaning = 'spend' AND t.interest_debt_id IS NOT NULL THEN 'loan_interest'
  WHEN t.meaning = 'spend' THEN ${SPEND_LINE}
  WHEN t.meaning = 'buy_asset' THEN 'buy_asset'
  WHEN t.meaning = 'lend' THEN 'lend'
  WHEN t.meaning = 'collect' THEN 'collect'
  WHEN t.meaning = 'adjust' THEN 'adjust'
  ELSE 'other' END`;

/**
 * Giao dịch có đúng một phía tài khoản (chuyển nội bộ hai phía, chia tiền / chuyển ví không phía nào thì không phải tiền
 * vào ra), của tài khoản từng có mặt (tắt từ trước v1.31 — không rõ ngày tắt — thì không tính ở tháng nào).
 */
const cashFrom = (extraJoins = "") => `FROM transactions t
  JOIN accounts a ON a.id = COALESCE(t.account_id, t.counter_account_id)
  LEFT JOIN accounts ca ON ca.id = t.counter_account_id
  LEFT JOIN wallets w ON w.id = t.counter_wallet_id
  LEFT JOIN transaction_report_classes rc ON rc.transaction_id = t.id ${extraJoins}
  WHERE t.status = 'active' AND (t.account_id IS NULL) <> (t.counter_account_id IS NULL)
    AND (a.active = 1 OR a.deactivated_at IS NOT NULL)`;
const SIGNED = "CASE WHEN t.counter_account_id IS NOT NULL THEN t.amount ELSE -t.amount END";

const toClassified = (r: Row): ClassifiedRow => ({
  month: String(r.month),
  line: r.line as CashFlowLineKey,
  spendLine: (r.spendLine as CashFlowLineKey | null) ?? null,
  reportClass: (r.rc as ReportClass | null) ?? null,
  isIncome: Boolean(r.isIncome),
  amount: Number(r.amount),
  count: Number(r.n ?? 1),
});

/** `GET /v1/reports/cash-flow?period=` — bốn câu SQL: tài khoản, số dư theo tài khoản × tháng, giao dịch đã phân loại, lô. */
export async function getCashFlow(db: D1Database, period: string | undefined, now: Date): Promise<CashFlow> {
  const p = parsePeriod(period, dayKey(now));
  const [accounts, accountMonths, classified, lots] = await db.batch([
    db.prepare("SELECT id, kind, opening_balance AS openingBalance, opened_at AS openedAt, active, deactivated_at AS deactivatedAt FROM accounts"),
    db
      .prepare(
        `SELECT acc AS id, month, SUM(delta) AS delta FROM (
           SELECT account_id AS acc, month_key AS month, -amount AS delta FROM transactions
           WHERE status = 'active' AND account_id IS NOT NULL AND month_key <= ?1
           UNION ALL
           SELECT counter_account_id, month_key, amount FROM transactions
           WHERE status = 'active' AND counter_account_id IS NOT NULL AND month_key <= ?1
         ) GROUP BY acc, month`,
      )
      .bind(p.toMonth),
    db
      .prepare(
        `SELECT t.month_key AS month, ${DEFAULT_LINE} AS line, CASE WHEN t.meaning = 'spend' THEN ${SPEND_LINE} END AS spendLine,
                rc.report_class AS rc, t.meaning = 'income' AS isIncome, ${SIGNED} > 0 AS incoming, SUM(${SIGNED}) AS amount, COUNT(*) AS n
         ${cashFrom()} AND t.month_key BETWEEN ?1 AND ?2
         GROUP BY month, line, spendLine, rc, isIncome, incoming`,
      )
      .bind(p.fromMonth, p.toMonth),
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN bought_on BETWEEN ?1 AND ?2 THEN quantity_milli * unit_cost / 1000 END), 0) AS bought,
                COALESCE(SUM(CASE WHEN sold_on BETWEEN ?1 AND ?2 THEN quantity_milli * sold_unit_price / 1000 END), 0) AS sold
         FROM balance_lots WHERE status = 'active'`,
      )
      .bind(p.from, p.to),
  ]);
  const lot = rows<{ bought: number; sold: number }>(lots!)[0];
  return buildCashFlow({
    period: p,
    accounts: rows(accounts!).map((a) => ({
      id: String(a.id),
      kind: String(a.kind),
      openingBalance: Number(a.openingBalance),
      openedAt: (a.openedAt as string | null) ?? null,
      active: Boolean(a.active),
      deactivatedAt: (a.deactivatedAt as string | null) ?? null,
    })),
    accountMonths: rows(accountMonths!).map((r) => ({ id: String(r.id), month: String(r.month), delta: Number(r.delta) })),
    rows: rows(classified!).map(toClassified),
    lotNote: { bought: Number(lot?.bought ?? 0), sold: Number(lot?.sold ?? 0) },
  });
}

/** `GET /v1/reports/income-statement?period=` — một câu gộp theo tháng × loại × phe ví × phân loại lại. */
export async function getIncomeStatement(db: D1Database, period: string | undefined, now: Date): Promise<IncomeStatement> {
  const p = parsePeriod(period, dayKey(now));
  return buildIncomeStatement(p, await statementRows(db, p.fromMonth, p.toMonth));
}

/** Hàng gộp của Kết quả thu chi cho các tháng [fromMonth, toMonth] — dùng chung cho báo cáo và Mốc tự do (E, E_must, I). */
export async function statementRows(db: D1Database, fromMonth: string, toMonth: string): Promise<StatementRow[]> {
  const res = await db
    .prepare(
      `SELECT t.month_key AS month, t.meaning, rc.report_class AS rc, t.tenant_id IS NOT NULL AS tenant,
              COALESCE(ca.role IN ('buffer', 'term_deposit'), 0) AS passiveAccount, t.debt_id IS NOT NULL AS principal,
              t.interest_debt_id IS NOT NULL AS interest, w.tier, w.must_group AS mustGroup,
              SUM(t.amount) AS amount, SUM(${SIGNED}) AS signed
       FROM transactions t
       LEFT JOIN accounts ca ON ca.id = t.counter_account_id
       LEFT JOIN wallets w ON w.id = CASE t.meaning WHEN 'refund' THEN t.wallet_id ELSE t.counter_wallet_id END
       LEFT JOIN transaction_report_classes rc ON rc.transaction_id = t.id
       WHERE t.status = 'active' AND t.meaning IN ('income', 'spend', 'refund', 'buy_asset', 'adjust') AND t.month_key BETWEEN ?1 AND ?2
       GROUP BY month, t.meaning, rc, tenant, passiveAccount, principal, interest, w.tier, mustGroup`,
    )
    .bind(fromMonth, toMonth)
    .all();
  return rows(res).map(
    (r): StatementRow => ({
      month: String(r.month),
      meaning: r.meaning as StatementRow["meaning"],
      reportClass: (r.rc as ReportClass | null) ?? null,
      tenant: Boolean(r.tenant),
      passiveAccount: Boolean(r.passiveAccount),
      principal: Boolean(r.principal),
      interest: Boolean(r.interest),
      tier: (r.tier as string | null) ?? null,
      mustGroup: (r.mustGroup as string | null) ?? null,
      amount: Number(r.amount),
      signed: Number(r.signed),
    }),
  );
}

export interface ReportTx {
  id: number;
  at: string;
  /** Có dấu: + tiền vào, − tiền ra. */
  amount: number;
  meaning: string;
  note: string | null;
  categoryName: string | null;
  walletName: string | null;
  accountName: string | null;
  reportClass: ReportClass | null;
  defaultLine: CashFlowLineKey;
}

/** `GET /v1/reports/transactions?period=&line=` — các giao dịch của một dòng Lưu chuyển tiền (sau phân loại lại), mới nhất trước. */
export async function reportTransactions(db: D1Database, period: string | undefined, line: string | undefined, now: Date) {
  const p = parsePeriod(period, dayKey(now));
  if (!line || !isLineKey(line)) fail("invalid_input", "line là một dòng của báo cáo lưu chuyển tiền.");
  const res = await db
    .prepare(
      `SELECT t.id, t.at, t.meaning, t.note, ${SIGNED} AS amount, ${DEFAULT_LINE} AS line,
              CASE WHEN t.meaning = 'spend' THEN ${SPEND_LINE} END AS spendLine, rc.report_class AS rc, t.meaning = 'income' AS isIncome,
              c.name AS categoryName, COALESCE(w.name, wr.name) AS walletName, a.name AS accountName
       ${cashFrom("LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN wallets wr ON wr.id = t.wallet_id")}
         AND t.month_key BETWEEN ?1 AND ?2
       ORDER BY t.at DESC, t.id DESC`,
    )
    .bind(p.fromMonth, p.toMonth)
    .all();
  const transactions: ReportTx[] = rows(res)
    .filter((r) => finalLine(toClassified(r)) === line)
    .map((r) => ({
      id: Number(r.id),
      at: String(r.at),
      amount: Number(r.amount),
      meaning: String(r.meaning),
      note: (r.note as string | null) ?? null,
      categoryName: (r.categoryName as string | null) ?? null,
      walletName: (r.walletName as string | null) ?? null,
      accountName: (r.accountName as string | null) ?? null,
      reportClass: (r.rc as ReportClass | null) ?? null,
      defaultLine: r.line as CashFlowLineKey,
    }));
  return { period: p.period, line, group: LINE_GROUP[line as CashFlowLineKey], transactions };
}

/** Giao dịch phân loại lại được: còn hiệu lực, đúng một phía tài khoản; Thu nhập thụ động chỉ cho khoản thu. */
async function cashTx(db: D1Database, id: number) {
  const tx = await db.prepare("SELECT id, meaning, status, account_id, counter_account_id FROM transactions WHERE id = ?").bind(id).first<Row>();
  if (!tx) fail("not_found", "Không có giao dịch này.", 404);
  if (tx!.status !== "active") fail("already_void", "Giao dịch đã huỷ: báo cáo không tính nó.", 409);
  if ((tx!.account_id === null) === (tx!.counter_account_id === null)) {
    fail("not_cash_flow", "Chuyển giữa hai tài khoản của nhà hoặc khoản không chạm tài khoản nào không phải tiền vào ra — không xếp nhóm được.");
  }
  return tx!;
}

/** `PUT /v1/transactions/:id/report-class` — chỉ đổi báo cáo; ví, số dư, lần chia tiền không đổi. */
export async function setReportClass(db: D1Database, id: number, cls: unknown, memberId: string | null) {
  if (!REPORT_CLASSES.includes(cls as ReportClass)) fail("invalid_class", `class phải là một trong: ${REPORT_CLASSES.join(", ")}.`);
  const tx = await cashTx(db, id);
  if (cls === "passive_income" && tx.meaning !== "income") fail("invalid_class", "Thu nhập thụ động chỉ dành cho khoản thu.");
  await db
    .prepare(
      `INSERT INTO transaction_report_classes (transaction_id, report_class, by_member_id) VALUES (?1, ?2, ?3)
       ON CONFLICT (transaction_id) DO UPDATE SET report_class = excluded.report_class, by_member_id = excluded.by_member_id, updated_at = datetime('now')`,
    )
    .bind(id, cls, memberId)
    .run();
  return { transactionId: id, reportClass: cls as ReportClass };
}

/** `DELETE /v1/transactions/:id/report-class` — về phân loại mặc định. */
export async function clearReportClass(db: D1Database, id: number) {
  await cashTx(db, id);
  await db.prepare("DELETE FROM transaction_report_classes WHERE transaction_id = ?").bind(id).run();
  return { transactionId: id, reportClass: null };
}
