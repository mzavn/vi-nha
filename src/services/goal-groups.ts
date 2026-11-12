// Tiền lãi của các nhóm mẹ + con có mục tiêu (pocket UC-1209 bước 9, QĐ2, ADR-140) — đọc D1 rồi tính bằng hàm thuần
// `groupInterest`. Một luật cho snapshot, `GET /v1/settings`, việc ②, `GET /v1/goals` và trần "Từ tiền lãi" lúc ghi khoản.
// Khoản lãi = khoản thu vào mẹ / con (kể cả con đã tắt) có dòng phân loại `passive_income` tường minh; không suy từ báo cáo.

import { groupInterest, type InterestStep } from "../domain/pockets";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];

/** Hai câu (chạy chung batch được): tài khoản của các nhóm có mục tiêu tài khoản đang dùng, và giao dịch chạm các tài khoản đó. */
export const groupInterestStatements = (db: D1Database): [D1PreparedStatement, D1PreparedStatement] => {
  const ROOTS = "SELECT account_id FROM reserve_goals WHERE active = 1 AND account_id IS NOT NULL AND pays_from = 'account'";
  const MEMBERS = `SELECT id FROM accounts WHERE COALESCE(parent_account_id, id) IN (${ROOTS})`;
  return [
    db.prepare(`SELECT id, COALESCE(parent_account_id, id) AS root, opening_balance AS opening FROM accounts WHERE COALESCE(parent_account_id, id) IN (${ROOTS})`),
    db.prepare(
      `SELECT t.id, t.amount, t.meaning, t.account_id AS fromId, t.counter_account_id AS toId, t.from_interest AS fromInterest,
              (SELECT r.report_class FROM transaction_report_classes r WHERE r.transaction_id = t.id) AS reportClass
       FROM transactions t
       WHERE t.status = 'active' AND (t.account_id IN (${MEMBERS}) OR t.counter_account_id IN (${MEMBERS}))
       ORDER BY t.at, t.id`,
    ),
  ];
};

/** `tài khoản mẹ → tiền lãi` từ kết quả hai câu trên; `excludeTxId` = khoản đang được thay (UC-102: trần tính không gồm khoản cũ). */
export function groupInterestFrom(accounts: D1Result, txs: D1Result, excludeTxId: number | null = null): Record<string, number> {
  const rootOf = new Map<string, string>();
  const opening = new Map<string, number>();
  for (const a of rows<{ id: string; root: string; opening: number }>(accounts)) {
    rootOf.set(a.id, a.root);
    opening.set(a.root, (opening.get(a.root) ?? 0) + Number(a.opening));
  }
  const steps = new Map<string, InterestStep[]>();
  for (const t of rows<{ id: number; amount: number; meaning: string; fromId: string | null; toId: string | null; fromInterest: number; reportClass: string | null }>(txs)) {
    if (excludeTxId !== null && Number(t.id) === excludeTxId) continue;
    const from = t.fromId === null ? undefined : rootOf.get(t.fromId);
    const to = t.toId === null ? undefined : rootOf.get(t.toId);
    const amount = Number(t.amount);
    const touched = new Set([from, to].filter((r): r is string => r !== undefined));
    for (const root of touched) {
      const delta = (to === root ? amount : 0) - (from === root ? amount : 0);
      const interest = to === root && from !== root && t.meaning === "income" && t.reportClass === "passive_income" ? amount : 0;
      const fromInterest = from === root && to !== root && Number(t.fromInterest) === 1 ? amount : 0;
      steps.set(root, [...(steps.get(root) ?? []), { delta, interest, fromInterest }]);
    }
  }
  return Object.fromEntries([...opening].map(([root, open]) => [root, groupInterest(open, steps.get(root) ?? [])]));
}

/** Tiền lãi hiện có của mọi nhóm mẹ + con có mục tiêu tài khoản đang dùng. */
export async function groupInterests(db: D1Database, excludeTxId: number | null = null): Promise<Record<string, number>> {
  const [accounts, txs] = await db.batch(groupInterestStatements(db));
  return groupInterestFrom(accounts!, txs!, excludeTxId);
}
