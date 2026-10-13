// Kế hoạch thu nhập theo năm (BR-15, UC-1104): mỗi lần lưu là một bản mới (chỉ ghi thêm); so với thu nhập thật của Kết quả
// thu chi (khoản xếp lại Đầu tư / Tài chính không là thu nhập) trong các tháng đã kết thúc của năm, tính từ tháng có giao
// dịch đầu tiên của sổ. Theo người: chủ tài khoản nhận tiền; tài khoản không chủ hoặc tiền người thuê trả → Chung.

import { pct } from "../domain/balance";
import { dayKey } from "../domain/period";
import type { IncomePlanActual, IncomePlanMember, IncomePlanSummary, IncomePlanVersion, IncomePlanYear } from "../domain/freedom";
import { DomainError } from "../domain/types";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400): never => {
  throw new DomainError(code, message, status);
};
const CHUNG = "Chung";

/**
 * Bản kế hoạch, dòng của bản hiện tại và thu nhập thật cho các năm `years` (null = mọi năm có kế hoạch) — năm câu SQL,
 * không câu nào lặp theo năm hay theo tháng.
 */
async function loadYears(db: D1Database, years: number[] | null, now: Date): Promise<IncomePlanYear[]> {
  const thisMonth = dayKey(now).slice(0, 7);
  const filter = years ? `year IN (${years.map(() => "?").join(", ")})` : "1 = 1";
  const args = years ?? [];
  const [plans, lines, actual, first, members] = await db.batch([
    db.prepare(`SELECT id, year, household_monthly AS householdMonthly, created_at AS createdAt FROM income_plans WHERE ${filter} ORDER BY year DESC, id`).bind(...args),
    db
      .prepare(
        `SELECT l.plan_id AS planId, l.name, l.member_id AS memberId, l.monthly_amount AS monthly FROM income_plan_lines l
         WHERE l.plan_id IN (SELECT MAX(id) FROM income_plans WHERE ${filter} GROUP BY year) ORDER BY l.plan_id, l.sort, l.id`,
      )
      .bind(...args),
    db
      .prepare(
        `SELECT t.month_key AS month, CASE WHEN t.tenant_id IS NULL THEN a.owner_member_id END AS memberId, SUM(t.amount) AS amount
         FROM transactions t
         LEFT JOIN accounts a ON a.id = t.counter_account_id
         LEFT JOIN transaction_report_classes rc ON rc.transaction_id = t.id
         WHERE t.status = 'active' AND t.meaning = 'income' AND t.month_key < ?1
           AND (rc.report_class IS NULL OR rc.report_class IN ('operating', 'passive_income'))
         GROUP BY month, memberId`,
      )
      .bind(thisMonth),
    db.prepare("SELECT MIN(month_key) AS m FROM transactions WHERE status = 'active'"),
    db.prepare("SELECT id, name FROM members"),
  ]);
  const names = new Map(rows<{ id: string; name: string }>(members!).map((m) => [m.id, m.name]));
  const memberName = (id: string | null) => (id === null ? CHUNG : names.get(id) ?? id);
  const firstMonth = rows<{ m: string | null }>(first!)[0]?.m ?? null;
  const incomeRows = rows<{ month: string; memberId: string | null; amount: number }>(actual!);
  const lineRows = rows<{ planId: number; name: string; memberId: string | null; monthly: number }>(lines!);
  const byYear = new Map<number, { id: number; createdAt: string; householdMonthly: number }[]>();
  for (const p of rows<{ id: number; year: number; householdMonthly: number; createdAt: string }>(plans!)) {
    const list = byYear.get(p.year) ?? [];
    list.push({ id: p.id, createdAt: p.createdAt, householdMonthly: p.householdMonthly });
    byYear.set(p.year, list);
  }
  return (years ?? [...byYear.keys()]).map((year) => {
    const versions = byYear.get(year) ?? [];
    const version = (v: (typeof versions)[number] | undefined, withLines: boolean): IncomePlanVersion | null =>
      v
        ? {
            ...v,
            lines: withLines
              ? lineRows.filter((l) => l.planId === v.id).map((l) => ({ name: l.name, memberId: l.memberId, memberName: memberName(l.memberId), monthly: l.monthly }))
              : [],
          }
        : null;
    const current = version(versions[versions.length - 1], true);
    const firstVersion = versions.length > 1 ? version(versions[0], false) : current;
    // Tháng đã kết thúc của năm, từ tháng có giao dịch đầu tiên của sổ.
    const counted = (m: string) => m.startsWith(`${year}-`) && m < thisMonth && firstMonth !== null && m >= firstMonth;
    const monthsCounted = firstMonth === null ? 0 : Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter(counted).length;
    const inYear = incomeRows.filter((r) => counted(r.month));
    const total = inYear.reduce((s, r) => s + r.amount, 0);
    const avg = monthsCounted > 0 ? Math.round(total / monthsCounted) : null;
    const actualBlock: IncomePlanActual = {
      monthsCounted,
      total,
      monthlyAverage: avg,
      pctOfCurrent: avg === null || !current ? null : pct(avg, current.householdMonthly),
      pctOfFirst: avg === null || !firstVersion ? null : pct(avg, firstVersion.householdMonthly),
      pctOfYear: monthsCounted === 0 || !current ? null : pct(total, current.householdMonthly * 12),
    };
    let byMember: IncomePlanMember[] | null = null;
    if (current && current.lines.length > 0) {
      const ids: (string | null)[] = [];
      for (const id of [...current.lines.map((l) => l.memberId), ...inYear.map((r) => r.memberId)]) if (!ids.includes(id)) ids.push(id);
      byMember = ids.map((memberId) => {
        const planned = current.lines.filter((l) => l.memberId === memberId).reduce((s, l) => s + l.monthly, 0);
        const sum = inYear.filter((r) => r.memberId === memberId).reduce((s, r) => s + r.amount, 0);
        const actualAvg = monthsCounted > 0 ? Math.round(sum / monthsCounted) : 0;
        return { memberId, memberName: memberName(memberId), planned, actual: actualAvg, pct: monthsCounted > 0 ? pct(actualAvg, planned) : null };
      });
    }
    return { year, current, first: firstVersion, versions, actual: actualBlock, byMember };
  });
}

const validYear = (raw: string | number, now: Date): number => {
  const year = Number(raw);
  const max = Number(dayKey(now).slice(0, 4)) + 1;
  if (!Number.isInteger(year) || year < 2000 || year > max) fail("invalid_year", `Năm phải từ 2000 tới ${max}.`);
  return year;
};

/** `GET /v1/income-plans/:year` — kể cả năm chưa có kế hoạch (current null). */
export async function getYear(db: D1Database, year: string | number, now: Date): Promise<IncomePlanYear> {
  return (await loadYears(db, [validYear(year, now)], now))[0]!;
}

/** `GET /v1/income-plans` — mỗi năm có kế hoạch một hàng, năm mới trước. */
export async function listYears(db: D1Database, now: Date): Promise<{ years: IncomePlanSummary[] }> {
  const years = await loadYears(db, null, now);
  return {
    years: years.map((y) => ({
      year: y.year,
      currentMonthly: y.current!.householdMonthly,
      firstMonthly: y.first!.householdMonthly,
      versions: y.versions.length,
      monthsCounted: y.actual.monthsCounted,
      monthlyAverage: y.actual.monthlyAverage,
      pctOfCurrent: y.actual.pctOfCurrent,
      pctOfFirst: y.actual.pctOfFirst,
      pctOfYear: y.actual.pctOfYear,
    })),
  };
}

/** `PUT /v1/income-plans/:year` — ghi một bản mới (không sửa đè): mục tiêu cả nhà bắt buộc > 0, chia theo người tuỳ chọn. */
export async function saveYear(db: D1Database, rawYear: string, b: Record<string, unknown>, memberId: string | null, now: Date): Promise<IncomePlanYear> {
  const year = validYear(rawYear, now);
  const bad = (message: string): never => fail("invalid_plan", message);
  const household = b.household_monthly;
  if (typeof household !== "number" || !Number.isInteger(household) || household <= 0 || household > 1e12) bad("Cần mục tiêu cả nhà (thu nhập ròng mỗi tháng, lớn hơn 0).");
  const rawLines = b.lines ?? [];
  if (!Array.isArray(rawLines) || rawLines.length > 30) bad("lines phải là danh sách (tối đa 30 dòng).");
  const memberIds = new Set(rows<{ id: string }>(await db.prepare("SELECT id FROM members").all()).map((m) => m.id));
  const lines = (rawLines as unknown[]).map((raw, i) => {
    const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const name = typeof l.name === "string" ? l.name.trim().slice(0, 60) : "";
    if (!name) bad(`Dòng ${i + 1}: cần tên.`);
    const member = l.member_id ?? null;
    if (member !== null && (typeof member !== "string" || !memberIds.has(member))) bad(`Dòng ${i + 1}: không có người này.`);
    const amount = l.monthly_amount;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0 || amount > 1e12) bad(`Dòng ${i + 1}: số mỗi tháng phải là số nguyên không âm.`);
    return { name, member: member as string | null, amount: amount as number };
  });
  await db.batch([
    db.prepare("INSERT INTO income_plans (year, household_monthly, created_at, by_member_id) VALUES (?, ?, ?, ?)").bind(year, household, now.toISOString(), memberId),
    ...lines.map((l, i) =>
      db
        .prepare("INSERT INTO income_plan_lines (plan_id, member_id, name, monthly_amount, sort) VALUES ((SELECT MAX(id) FROM income_plans), ?, ?, ?, ?)")
        .bind(l.member, l.name, l.amount, i),
    ),
  ]);
  return getYear(db, year, now);
}
