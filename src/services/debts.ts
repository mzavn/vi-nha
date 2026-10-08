// Sổ nợ (UC-901…904): khoản hộ nợ người khác — một sổ đối ứng ngoài sổ cái (src/services/memo-books.ts).
// Tiền trả nợ KHÔNG là dòng sổ: là giao dịch spend mang debt_id (nhập tay hoặc màn Gán),
// nên huỷ giao dịch là số còn nợ tự đúng lại (view v_debt_balance).

import * as books from "./memo-books";

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
  lines: DebtLine[];
  payments: DebtPayment[];
}

function toDebt({ in: owed, out: paid, movements, ...b }: books.MemoBook<DebtLine>): Debt {
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
  };
}

/** Mọi khoản nợ: đang theo dõi trước, chưa trả xong trước, còn nợ nhiều trước. Tổng còn nợ chỉ cộng phần dương của khoản đang theo dõi. */
export async function getDebts(db: D1Database): Promise<{ totalBalance: number; debts: Debt[] }> {
  const { totalBalance, books: list } = await books.listBooks<DebtLine>(db, DEBTS);
  return { totalBalance, debts: list.map(toDebt) };
}

/** Thêm khoản nợ: số tiền đang nợ thành dòng 'opening'. */
export async function createDebt(db: D1Database, b: books.Input, now: Date): Promise<Debt> {
  return toDebt(await books.getBook<DebtLine>(db, DEBTS, await books.createBook(db, DEBTS, b, now)));
}

export async function updateDebt(db: D1Database, id: string, b: books.Input): Promise<Debt> {
  await books.updateBook(db, DEBTS, id, b);
  return toDebt(await books.getBook<DebtLine>(db, DEBTS, id));
}

/** Vay thêm (borrow > 0) hoặc chỉnh tay (adjust ±). */
export async function addDebtLine(db: D1Database, debtId: string, b: books.Input, now: Date): Promise<DebtLine> {
  return books.addLine<DebtLine>(db, DEBTS, debtId, b, now);
}

/** Sổ chỉ ghi thêm: sai thì huỷ dòng (status → void), không sửa, không xoá. */
export async function voidDebtLine(db: D1Database, id: number): Promise<DebtLine> {
  return books.voidLine<DebtLine>(db, DEBTS, id);
}
