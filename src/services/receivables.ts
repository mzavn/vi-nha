// Sổ phải thu (UC-1001…1004): khoản người khác nợ hộ (cho vay, trả hộ) — một sổ đối ứng ngoài sổ cái
// (src/services/memo-books.ts). Dòng sổ chỉ là ghi nhớ: không đổi ví, không đổi tài khoản, không phải thu nhập.
// Tiền đi / về là giao dịch thật mang receivable_id: `lend` (cho vay thêm, tiền ra) cộng số phải thu,
// `collect` (nhận lại, tiền vào, không cộng ví) trừ số phải thu; huỷ giao dịch là số tự đúng lại (v_receivable_balance).

import * as books from "./memo-books";

const RECEIVABLES: books.MemoBookSpec = {
  table: "receivables",
  lineTable: "receivable_lines",
  key: "receivable_id",
  lineKey: "receivableId",
  view: "v_receivable_balance",
  inCol: "lent",
  outCol: "collected",
  meanings: ["lend", "collect"],
  manualKinds: ["adjust"],
  positiveKinds: [],
  noun: "khoản phải thu",
  lineNoun: "dòng phải thu",
  inactiveCode: "inactive_receivable",
  zeroOpening: true,
};

export interface ReceivableLine {
  id: number;
  receivableId: string;
  at: string;
  kind: "opening" | "adjust";
  amount: number;
  note: string | null;
  status: "active" | "void";
}
/** Tiền thật gắn khoản phải thu: lend = cho vay thêm (tiền ra từ accountId), collect = nhận lại (tiền vào accountId). */
export interface ReceivableMovement {
  transactionId: number;
  at: string;
  amount: number;
  kind: "lend" | "collect";
  accountId: string | null;
  note: string | null;
  source: string;
}
export interface Receivable {
  id: string;
  name: string;
  note: string | null;
  active: boolean;
  /** Dòng sổ + tiền đã cho vay đi. */
  lent: number;
  /** Tiền đã nhận lại. */
  collected: number;
  balance: number;
  /** Còn phải thu ≤ 0: người ta đã trả đủ. */
  done: boolean;
  createdAt: string;
  lines: ReceivableLine[];
  movements: ReceivableMovement[];
}

function toReceivable({ in: lent, out: collected, movements, ...b }: books.MemoBook<ReceivableLine>): Receivable {
  return {
    ...b,
    lent,
    collected,
    movements: movements.map((t) => ({
      transactionId: Number(t.id),
      at: String(t.at),
      amount: Number(t.amount),
      kind: t.meaning as ReceivableMovement["kind"],
      accountId: ((t.meaning === "lend" ? t.account_id : t.counter_account_id) as string | null) ?? null,
      note: (t.note as string | null) ?? null,
      source: String(t.source),
    })),
  };
}

/** Mọi khoản phải thu: đang theo dõi trước, chưa trả đủ trước, còn phải thu nhiều trước. Tổng chỉ cộng phần dương của khoản đang theo dõi. */
export async function getReceivables(db: D1Database): Promise<{ totalBalance: number; receivables: Receivable[] }> {
  const { totalBalance, books: list } = await books.listBooks<ReceivableLine>(db, RECEIVABLES);
  return { totalBalance, receivables: list.map(toReceivable) };
}

/** Thêm khoản phải thu: số người ta đang nợ thành dòng 'opening' — chỉ ghi nhớ, không tiền nào đi. Số 0: chỉ thêm người, không dòng nào. */
export async function createReceivable(db: D1Database, b: books.Input, now: Date): Promise<Receivable> {
  return toReceivable(await books.getBook<ReceivableLine>(db, RECEIVABLES, await books.createBook(db, RECEIVABLES, b, now)));
}

export async function updateReceivable(db: D1Database, id: string, b: books.Input): Promise<Receivable> {
  await books.updateBook(db, RECEIVABLES, id, b);
  return toReceivable(await books.getBook<ReceivableLine>(db, RECEIVABLES, id));
}

/** Chỉnh tay (adjust ±). Cho vay thêm là giao dịch `lend`, không phải dòng sổ. */
export async function addReceivableLine(db: D1Database, receivableId: string, b: books.Input, now: Date): Promise<ReceivableLine> {
  return books.addLine<ReceivableLine>(db, RECEIVABLES, receivableId, b, now);
}

/** Sổ chỉ ghi thêm: sai thì huỷ dòng (status → void), không sửa, không xoá. */
export async function voidReceivableLine(db: D1Database, id: number): Promise<ReceivableLine> {
  return books.voidLine<ReceivableLine>(db, RECEIVABLES, id);
}
