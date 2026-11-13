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
  type SpendKind,
  type StatementRow,
} from "../domain/reports";
import { DomainError } from "../domain/types";
import { unsalaryStatements } from "./month-tasks";
import { assertTxChangeable, hiddenAccountIds, hiddenTxSql, txNotFound } from "./privacy";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400): never => {
  throw new DomainError(code, message, status);
};

/**
 * Khoản gốc của khoản hoàn (`link_id`), danh mục (khoản hoàn có `link_id` lấy danh mục khoản gốc), nhóm danh mục đang dùng,
 * mốc khoản cũ (`config.legacy_max_tx_id`, ADR-131) và mục tiêu Thuế (theo % thu chịu thuế, đang dùng) gắn tài khoản `a`.
 * Người gọi join `a` = tài khoản của khoản (trả, nhận hoàn, nhận thu) trước các join này.
 */
const SPEND_JOINS = `
  LEFT JOIN transactions o ON o.id = t.link_id AND t.meaning = 'refund'
  LEFT JOIN categories c ON c.id = CASE WHEN o.id IS NOT NULL THEN o.category_id ELSE t.category_id END
  LEFT JOIN category_groups g ON g.id = c.group_id AND g.active = 1
  LEFT JOIN config lm ON lm.k = 'legacy_max_tx_id'
  LEFT JOIN reserve_goals tg ON tg.account_id = a.id AND tg.active = 1 AND tg.target_pct IS NOT NULL`;

/**
 * Loại chi (balance UC-1105 / UC-1106, ADR-128) — dừng ở luật đầu tiên khớp; khoản hoàn đi cùng luật. Khoản cũ (`id` ≤ mốc)
 * chỉ đọc `legacy_class` (`tax` → Thuế đã nộp, `savings` → Chi từ Tích luỹ); khoản mới: chi từ tài khoản của mục tiêu Thuế →
 * Thuế đã nộp, tài khoản trả / nhận hoàn thuộc ngăn Tích luỹ → Chi từ Tích luỹ. Thiết yếu / Mong muốn theo nhóm danh mục cho cả hai.
 */
const SPEND_KIND = `CASE
  WHEN COALESCE(o.interest_debt_id, t.interest_debt_id) IS NOT NULL THEN 'interest'
  WHEN CASE WHEN t.id <= CAST(lm.v AS INTEGER) THEN t.legacy_class = 'tax' ELSE tg.id IS NOT NULL END THEN 'tax'
  WHEN CASE WHEN t.id <= CAST(lm.v AS INTEGER) THEN t.legacy_class = 'savings' ELSE a.pocket = 'savings' END THEN 'savings'
  WHEN c.id IS NULL THEN 'other'
  WHEN g.essential = 1 THEN 'essential'
  ELSE 'flex' END`;

/** Khoản thu không nguồn, không người thuê, vào tài khoản ngăn Tích luỹ / Dự phòng (thu nhập thụ động không cần xếp tay). */
const PASSIVE_INCOME = "t.meaning = 'income' AND t.tenant_id IS NULL AND t.income_stream_id IS NULL AND a.pocket IN ('savings', 'reserve')";

/** Dòng chi của Lưu chuyển tiền theo loại chi. */
const SPEND_LINE = `CASE ${SPEND_KIND} WHEN 'interest' THEN 'loan_interest' WHEN 'essential' THEN 'spend_essential' WHEN 'flex' THEN 'spend_flex'
  WHEN 'tax' THEN 'spend_tax' WHEN 'savings' THEN 'spend_savings' ELSE 'spend_other' END`;

/**
 * Bảng phân loại mặc định (proposal UC-1105): xét từ trên xuống, dòng khớp đầu tiên thắng. Khoản hoàn ở "Hoàn tiền", trừ khi
 * khớp Thuế đã nộp / Chi từ Tích luỹ — khi đó cộng ngược vào dòng đó.
 */
const DEFAULT_LINE = `CASE
  WHEN t.meaning = 'income' AND t.tenant_id IS NOT NULL THEN 'rental_income'
  WHEN ${PASSIVE_INCOME} THEN 'passive_income'
  WHEN t.meaning = 'income' THEN 'salary_other'
  WHEN t.meaning = 'refund' THEN CASE ${SPEND_KIND} WHEN 'tax' THEN 'spend_tax' WHEN 'savings' THEN 'spend_savings' ELSE 'refund' END
  WHEN t.meaning = 'spend' AND t.debt_id IS NOT NULL THEN 'debt_principal'
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
  ${SPEND_JOINS}
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

/** `GET /v1/reports/income-statement?period=` — một câu gộp theo tháng × loại × loại chi × nhóm danh mục × phân loại lại. */
export async function getIncomeStatement(db: D1Database, period: string | undefined, now: Date): Promise<IncomeStatement> {
  const p = parsePeriod(period, dayKey(now));
  return buildIncomeStatement(p, await statementRows(db, p.fromMonth, p.toMonth));
}

/** Hàng gộp của Kết quả thu chi cho các tháng [fromMonth, toMonth] — dùng chung cho báo cáo và Mốc tự do (E, E_must, I). */
export async function statementRows(db: D1Database, fromMonth: string, toMonth: string): Promise<StatementRow[]> {
  const res = await db
    .prepare(
      `SELECT month, meaning, rc, tenant, passiveAccount, principal, kind, groupId, groupName, groupSort, SUM(amount) AS amount, SUM(signed) AS signed
       FROM (
         SELECT t.month_key AS month, t.meaning, rc.report_class AS rc, t.tenant_id IS NOT NULL AS tenant,
                COALESCE(${PASSIVE_INCOME}, 0) AS passiveAccount, t.debt_id IS NOT NULL AS principal,
                CASE WHEN t.meaning IN ('spend', 'refund') THEN ${SPEND_KIND} END AS kind, g.id AS groupId, g.name AS groupName, g.sort AS groupSort,
                t.amount, ${SIGNED} AS signed
         FROM transactions t
         LEFT JOIN accounts a ON a.id = COALESCE(t.account_id, t.counter_account_id)
         ${SPEND_JOINS}
         LEFT JOIN transaction_report_classes rc ON rc.transaction_id = t.id
         WHERE t.status = 'active' AND t.meaning IN ('income', 'spend', 'refund', 'buy_asset', 'adjust') AND t.month_key BETWEEN ?1 AND ?2
       )
       GROUP BY month, meaning, rc, tenant, passiveAccount, principal, kind, groupId, groupName, groupSort`,
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
      kind: (r.kind as SpendKind | null) ?? null,
      group: r.groupId === null ? null : { id: String(r.groupId), name: String(r.groupName), sort: Number(r.groupSort) },
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
  /** Danh mục (khoản hoàn có `link_id`: của khoản gốc). */
  categoryName: string | null;
  /** Nhóm danh mục đang dùng của danh mục đó; null = không danh mục / chưa xếp nhóm. */
  groupName: string | null;
  accountName: string | null;
  reportClass: ReportClass | null;
  defaultLine: CashFlowLineKey;
}

/**
 * `GET /v1/reports/transactions?period=&line=` — các giao dịch của một dòng Lưu chuyển tiền (sau phân loại lại), mới nhất trước.
 * Bỏ khoản bị giấu với người xem; tổng dòng ở `getCashFlow` vẫn cộng đủ (balance UC-1105 bước 9, access UC-504 AC-15).
 */
export async function reportTransactions(db: D1Database, period: string | undefined, line: string | undefined, now: Date, viewerId: string | null) {
  const p = parsePeriod(period, dayKey(now));
  if (!line || !isLineKey(line)) fail("invalid_input", "line là một dòng của báo cáo Dòng tiền.");
  const priv = hiddenTxSql("t", await hiddenAccountIds(db, viewerId));
  const res = await db
    .prepare(
      `SELECT t.id, t.at, t.meaning, t.note, ${SIGNED} AS amount, ${DEFAULT_LINE} AS line,
              CASE WHEN t.meaning = 'spend' THEN ${SPEND_LINE} END AS spendLine, rc.report_class AS rc, t.meaning = 'income' AS isIncome,
              c.name AS categoryName, g.name AS groupName, a.name AS accountName
       ${cashFrom()}
         AND t.month_key BETWEEN ?1 AND ?2 AND NOT ${priv.sql}
       ORDER BY t.at DESC, t.id DESC`,
    )
    .bind(p.fromMonth, p.toMonth, ...priv.binds)
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
      groupName: (r.groupName as string | null) ?? null,
      accountName: (r.accountName as string | null) ?? null,
      reportClass: (r.rc as ReportClass | null) ?? null,
      defaultLine: r.line as CashFlowLineKey,
    }));
  return { period: p.period, line, group: LINE_GROUP[line as CashFlowLineKey], transactions };
}

/**
 * Giao dịch phân loại lại được: còn hiệu lực, đúng một phía tài khoản; Thu nhập thụ động chỉ cho khoản thu. Khoản bị giấu
 * với người làm → 404 trước mọi lỗi khác; chạm tài khoản riêng tư của người khác → 403 (balance UC-1105 bước 4, access UC-504 AC-11).
 */
async function cashTx(db: D1Database, id: number, viewerId: string | null) {
  const tx = await db.prepare("SELECT id, meaning, status, account_id, counter_account_id FROM transactions WHERE id = ?").bind(id).first<Row>();
  if (!tx) throw txNotFound();
  assertTxChangeable(tx, await hiddenAccountIds(db, viewerId));
  if (tx.status !== "active") fail("already_void", "Giao dịch đã huỷ, báo cáo không tính.", 409);
  if ((tx.account_id === null) === (tx.counter_account_id === null)) {
    fail("not_cash_flow", "Chuyển giữa hai tài khoản nhà hoặc khoản không qua tài khoản không phải tiền vào ra: không xếp nhóm được.");
  }
  return tx;
}

/**
 * `PUT /v1/transactions/:id/report-class` — chỉ đổi báo cáo; số dư, ngăn không đổi. Khoản thu đổi sang Thu nhập thụ động thì
 * không còn là lương (pocket UC-1205): `is_salary` về 0 và nhắc trích Tích luỹ của nó `void`, cùng batch với câu phân loại.
 */
export async function setReportClass(db: D1Database, id: number, cls: unknown, memberId: string | null, now: Date = new Date()) {
  if (!REPORT_CLASSES.includes(cls as ReportClass)) fail("invalid_class", `class phải là một trong: ${REPORT_CLASSES.join(", ")}.`);
  const tx = await cashTx(db, id, memberId);
  if (cls === "passive_income" && tx.meaning !== "income") fail("invalid_class", "Thu nhập thụ động chỉ dành cho khoản thu.");
  await db.batch([
    db
      .prepare(
        `INSERT INTO transaction_report_classes (transaction_id, report_class, by_member_id) VALUES (?1, ?2, ?3)
         ON CONFLICT (transaction_id) DO UPDATE SET report_class = excluded.report_class, by_member_id = excluded.by_member_id, updated_at = datetime('now')`,
      )
      .bind(id, cls, memberId),
    ...(cls === "passive_income" ? unsalaryStatements(db, id, now) : []),
  ]);
  return { transactionId: id, reportClass: cls as ReportClass };
}

/** `DELETE /v1/transactions/:id/report-class` — về phân loại mặc định. */
export async function clearReportClass(db: D1Database, id: number, viewerId: string | null) {
  await cashTx(db, id, viewerId);
  await db.prepare("DELETE FROM transaction_report_classes WHERE transaction_id = ?").bind(id).run();
  return { transactionId: id, reportClass: null };
}
