// Sổ nợ (UC-901…904): khoản hộ nợ người khác — một sổ đối ứng ngoài sổ cái (src/services/memo-books.ts).
// Tiền trả nợ KHÔNG là dòng sổ: là giao dịch spend mang debt_id (nhập tay hoặc màn Gán),
// nên huỷ giao dịch là số còn nợ tự đúng lại (view v_debt_balance).
// Lãi vay (ADR nháp H): khoản nợ có lãi suất; trả lãi là khoản chi riêng mang interest_debt_id (không giảm nợ).

import { monthlyInterest, percentToBps, yearlyInterest } from "../domain/interest";
import { monthKey } from "../domain/period";
import { DomainError } from "../domain/types";
import * as books from "./memo-books";

const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};
const has = (b: books.Input, k: string) => Object.prototype.hasOwnProperty.call(b, k);

/** Lãi suất %/năm (0–100, cho phép lẻ), kỳ hạn, số trả mỗi tháng (> 0 hoặc null), ngày trả (1–28 hoặc null). */
function debtCols(b: books.Input): [string, unknown][] {
  const cols = books.termCols(b);
  if (has(b, "interest_rate")) {
    const r = b.interest_rate;
    if (typeof r !== "number" || !Number.isFinite(r) || r < 0 || r > 100) fail("invalid_rate", "Lãi suất phải là số từ 0 tới 100 (%/năm).");
    cols.push(["interest_rate_bps", percentToBps(r as number)]);
  }
  if (has(b, "monthly_payment")) {
    const v = b.monthly_payment;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v <= 0 || v > 1e12)) {
      fail("invalid_input", "Số trả mỗi tháng phải là số nguyên dương (đồng), hoặc để trống.");
    }
    cols.push(["monthly_payment", v]);
  }
  if (has(b, "due_day")) {
    const v = b.due_day;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 28)) fail("invalid_input", "Ngày trả phải từ 1 tới 28, hoặc để trống.");
    cols.push(["due_day", v]);
  }
  return cols;
}

const DEBTS: books.MemoBookSpec = {
  table: "debts",
  lineTable: "debt_lines",
  key: "debt_id",
  lineKey: "debtId",
  view: "v_debt_balance",
  inCol: "owed",
  outCol: "paid",
  meanings: ["spend"],
  manualKinds: ["borrow", "adjust"],
  positiveKinds: ["borrow"],
  noun: "khoản nợ",
  lineNoun: "dòng nợ",
  inactiveCode: "inactive_debt",
  extra: {
    select: "d.interest_rate_bps AS interestRateBps, d.term, d.monthly_payment AS monthlyPayment, d.due_day AS dueDay",
    parse: debtCols,
  },
};

export type DebtLineKind = "opening" | "borrow" | "adjust";
export interface DebtLine {
  id: number;
  debtId: string;
  at: string;
  kind: DebtLineKind;
  amount: number;
  note: string | null;
  status: "active" | "void";
}
export interface DebtPayment {
  transactionId: number;
  at: string;
  amount: number;
  walletId: string | null;
  accountId: string | null;
  note: string | null;
  source: string;
}
export interface Debt {
  id: string;
  name: string;
  note: string | null;
  active: boolean;
  owed: number;
  paid: number;
  balance: number;
  /** Còn nợ ≤ 0: đã trả xong. */
  done: boolean;
  createdAt: string;
  deactivatedAt: string | null;
  lines: DebtLine[];
  payments: DebtPayment[];
  /** Lãi suất %/năm. */
  interestRate: number;
  term: "short" | "long";
  monthlyPayment: number | null;
  dueDay: number | null;
  /** floor(còn nợ × lãi suất). */
  interestPerYear: number;
  /** Lãi dự kiến tháng này theo dư nợ đầu tháng (Công thức 18); khoản đã tắt → 0. */
  interestThisMonth: number;
  interestPaidThisMonth: number;
}

/** Lãi dự kiến và lãi đã trả của một khoản nợ trong một tháng (Công thức 18). */
export interface DebtInterest {
  debtId: string;
  name: string;
  active: boolean;
  rateBps: number;
  dueDay: number | null;
  monthlyPayment: number | null;
  /** Còn nợ lúc bắt đầu ngày 1 của tháng (giờ VN). */
  openingBalance: number;
  /** Lãi dự kiến; khoản đã tắt hoặc 0% → 0. */
  expected: number;
  /** Σ chi `interest_debt_id` của khoản trong tháng. */
  paid: number;
}

/**
 * Một câu cho mọi khoản nợ: dư nợ đầu tháng `month` = Σ dòng nợ có ngày (giờ VN) trước tháng − Σ chi trả gốc có
 * `month_key` trước tháng; lãi đã trả = Σ chi trả lãi trong tháng. Dùng chung cho sổ nợ, ngân sách, snapshot, engine.
 */
export async function debtInterest(db: D1Database, month: string): Promise<DebtInterest[]> {
  const res = await db
    .prepare(
      `SELECT d.id, d.name, d.active, d.interest_rate_bps AS rateBps, d.due_day AS dueDay, d.monthly_payment AS monthlyPayment,
              COALESCE((SELECT SUM(l.amount) FROM debt_lines l
                        WHERE l.debt_id = d.id AND l.status = 'active' AND date(l.at, '+7 hours') < ?1 || '-01'), 0)
            - COALESCE((SELECT SUM(x.amount) FROM transactions x
                        WHERE x.debt_id = d.id AND x.meaning = 'spend' AND x.status = 'active' AND x.month_key < ?1), 0) AS b0,
              COALESCE((SELECT SUM(x.amount) FROM transactions x
                        WHERE x.interest_debt_id = d.id AND x.meaning = 'spend' AND x.status = 'active' AND x.month_key = ?1), 0) AS paid
       FROM debts d ORDER BY d.name`,
    )
    .bind(month)
    .all<{ id: string; name: string; active: number; rateBps: number; dueDay: number | null; monthlyPayment: number | null; b0: number; paid: number }>();
  return (res.results ?? []).map((r) => ({
    debtId: r.id,
    name: r.name,
    active: Boolean(r.active),
    rateBps: Number(r.rateBps),
    dueDay: r.dueDay ?? null,
    monthlyPayment: r.monthlyPayment ?? null,
    openingBalance: Number(r.b0),
    expected: r.active ? monthlyInterest(Number(r.b0), Number(r.rateBps)) : 0,
    paid: Number(r.paid),
  }));
}

/** Σ lãi dự kiến tháng của các khoản nợ đang bật có lãi — dự kiến tháng của ví "Lãi vay". */
export const expectedInterestTotal = (list: DebtInterest[]) => list.reduce((s, d) => s + d.expected, 0);

function toDebt({ in: owed, out: paid, movements, extra, ...b }: books.MemoBook<DebtLine>, interest: DebtInterest[]): Debt {
  const rateBps = Number(extra.interestRateBps ?? 0);
  const month = interest.find((i) => i.debtId === b.id);
  return {
    ...b,
    owed,
    paid,
    payments: movements.map((p) => ({
      transactionId: Number(p.id),
      at: String(p.at),
      amount: Number(p.amount),
      walletId: (p.counter_wallet_id as string | null) ?? null,
      accountId: (p.account_id as string | null) ?? null,
      note: (p.note as string | null) ?? null,
      source: String(p.source),
    })),
    interestRate: rateBps / 100,
    term: extra.term as Debt["term"],
    monthlyPayment: (extra.monthlyPayment as number | null) ?? null,
    dueDay: (extra.dueDay as number | null) ?? null,
    interestPerYear: yearlyInterest(b.balance, rateBps),
    interestThisMonth: month?.expected ?? 0,
    interestPaidThisMonth: month?.paid ?? 0,
  };
}

/** Mọi khoản nợ: đang theo dõi trước, chưa trả xong trước, còn nợ nhiều trước. Tổng còn nợ chỉ cộng phần dương của khoản đang theo dõi. */
export async function getDebts(db: D1Database, now: Date = new Date()): Promise<{ totalBalance: number; debts: Debt[] }> {
  const [{ totalBalance, books: list }, interest] = await Promise.all([books.listBooks<DebtLine>(db, DEBTS), debtInterest(db, monthKey(now))]);
  return { totalBalance, debts: list.map((d) => toDebt(d, interest)) };
}

async function oneDebt(db: D1Database, id: string, now: Date): Promise<Debt> {
  return toDebt(await books.getBook<DebtLine>(db, DEBTS, id), await debtInterest(db, monthKey(now)));
}

/** Thêm khoản nợ: số tiền đang nợ thành dòng 'opening'. */
export async function createDebt(db: D1Database, b: books.Input, now: Date): Promise<Debt> {
  return oneDebt(db, await books.createBook(db, DEBTS, b, now), now);
}

export async function updateDebt(db: D1Database, id: string, b: books.Input, now: Date): Promise<Debt> {
  await books.updateBook(db, DEBTS, id, b, now);
  return oneDebt(db, id, now);
}

/** Vay thêm (borrow > 0) hoặc chỉnh tay (adjust ±). */
export async function addDebtLine(db: D1Database, debtId: string, b: books.Input, now: Date): Promise<DebtLine> {
  return books.addLine<DebtLine>(db, DEBTS, debtId, b, now);
}

/** Sổ chỉ ghi thêm: sai thì huỷ dòng (status → void), không sửa, không xoá. */
export async function voidDebtLine(db: D1Database, id: number): Promise<DebtLine> {
  return books.voidLine<DebtLine>(db, DEBTS, id);
}
