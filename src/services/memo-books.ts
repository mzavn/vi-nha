// Sổ đối ứng ngoài sổ cái: một đối tác + dòng sổ chỉ ghi thêm (ghi nhớ "ai nợ ai", không đổi ví, không đổi tài khoản)
// + giao dịch tiền thật mang id đối tác + view số dư. Cùng một khuôn với sổ người thuê (ADR-58); dùng chung cho
// sổ nợ (ADR-71, src/services/debts.ts) và sổ phải thu (ADR-72, src/services/receivables.ts).
// Sổ người thuê không dùng file này: nó còn kỳ tháng, chốt tháng và phí cố định.

import { normalizeAt } from "../domain/entry";
import { DomainError } from "../domain/types";

type Row = Record<string, unknown>;
export type Input = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400): never => {
  throw new DomainError(code, message, status);
};
const has = (b: Input, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const MAX_AMOUNT = 1_000_000_000_000;

function text(b: Input, k: string, required = false, max = 120): string | null {
  const v = b[k];
  if (v === undefined || v === null || v === "") return required ? fail("invalid_input", `Thiếu ${k}.`) : null;
  if (typeof v !== "string") return fail("invalid_input", `${k} phải là chuỗi.`);
  return v.trim().slice(0, max) || (required ? fail("invalid_input", `Thiếu ${k}.`) : null);
}

function money(b: Input, k: string, positive: boolean): number {
  const v = b[k];
  if (v === undefined || v === null) return fail("invalid_input", `Thiếu ${k}.`);
  if (typeof v !== "number" || !Number.isInteger(v) || Math.abs(v) > MAX_AMOUNT) return fail("invalid_amount", `${k} phải là số nguyên VND.`);
  if (positive ? v <= 0 : v === 0) fail("invalid_amount", positive ? `${k} phải lớn hơn 0.` : `${k} phải khác 0.`);
  return v;
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** Một loại sổ đối ứng: tên bảng, cột id đối tác, view số dư, loại dòng ghi tay và chữ dùng trong lỗi. */
export interface MemoBookSpec {
  /** Bảng đối tác (debts | receivables) và bảng dòng sổ. */
  table: string;
  lineTable: string;
  /** Cột id đối tác ở bảng dòng, ở transactions và ở view (debt_id | receivable_id). */
  key: string;
  /** Tên trường id đối tác trong JSON của dòng sổ (debtId | receivableId). */
  lineKey: string;
  /** View: `<key>, name, active, <inCol>, <outCol>, balance`. */
  view: string;
  inCol: string;
  outCol: string;
  /** Giao dịch tiền thật thuộc sổ này (meaning IN …). */
  meanings: readonly string[];
  /** Loại dòng ghi tay qua POST …/lines, và loại nào bắt buộc > 0. */
  manualKinds: readonly string[];
  positiveKinds: readonly string[];
  /** "khoản nợ" | "khoản phải thu" — dùng trong câu báo lỗi. */
  noun: string;
  /** "dòng nợ" | "dòng phải thu". */
  lineNoun: string;
  /** Mã lỗi khi đối tác đã tắt (inactive_debt | inactive_receivable). */
  inactiveCode: string;
  /** Mở sổ được với số 0 (không dòng 'opening') — chỉ sổ phải thu. */
  zeroOpening?: boolean;
}

/** Phần chung của một dòng sổ; mỗi sổ thêm trường id đối tác riêng (`lineKey`). */
export interface MemoLine {
  id: number;
  at: string;
  kind: string;
  amount: number;
  note: string | null;
  status: "active" | "void";
}

/** Một đối tác kèm số dư (vào − ra), các dòng sổ còn hiệu lực và các giao dịch tiền thật còn hiệu lực (mới nhất trước). */
export interface MemoBook<L extends MemoLine = MemoLine> {
  id: string;
  name: string;
  note: string | null;
  active: boolean;
  in: number;
  out: number;
  balance: number;
  /** Số dư ≤ 0: đã xong (trả hết / nhận đủ). */
  done: boolean;
  createdAt: string;
  lines: L[];
  movements: Row[];
}

const lineSql = (s: MemoBookSpec) => `SELECT id, ${s.key} AS ${s.lineKey}, at, kind, amount, note, status FROM ${s.lineTable}`;

/**
 * Mọi đối tác của sổ: đang theo dõi trước, chưa xong trước, số dư lớn trước, rồi theo tên.
 * Tổng (`totalBalance`) chỉ cộng phần dương của đối tác đang theo dõi: dư ở khoản này không bù sang khoản khác.
 */
export async function listBooks<L extends MemoLine>(db: D1Database, s: MemoBookSpec, onlyId?: string): Promise<{ totalBalance: number; books: MemoBook<L>[] }> {
  const meanings = s.meanings.map((m) => `'${m}'`).join(", ");
  const [bookRes, lineRes, txRes] = await db.batch([
    db.prepare(
      `SELECT d.id, d.name, d.note, d.active, d.created_at AS createdAt, b.${s.inCol} AS inSum, b.${s.outCol} AS outSum, b.balance
       FROM ${s.table} d JOIN ${s.view} b ON b.${s.key} = d.id
       WHERE ?1 IS NULL OR d.id = ?1
       ORDER BY d.active DESC, (b.balance <= 0), b.balance DESC, d.name`,
    ).bind(onlyId ?? null),
    db.prepare(`${lineSql(s)} WHERE status = 'active' AND (?1 IS NULL OR ${s.key} = ?1) ORDER BY at DESC, id DESC`).bind(onlyId ?? null),
    db.prepare(
      `SELECT * FROM transactions
       WHERE ${s.key} IS NOT NULL AND meaning IN (${meanings}) AND status = 'active' AND (?1 IS NULL OR ${s.key} = ?1)
       ORDER BY at DESC, id DESC`,
    ).bind(onlyId ?? null),
  ]);
  const lines = rows(lineRes!);
  const txs = rows(txRes!);
  const books = rows(bookRes!).map((d): MemoBook<L> => {
    const balance = Number(d.balance);
    return {
      id: String(d.id),
      name: String(d.name),
      note: (d.note as string | null) ?? null,
      active: Boolean(d.active),
      in: Number(d.inSum),
      out: Number(d.outSum),
      balance,
      done: balance <= 0,
      createdAt: String(d.createdAt),
      lines: lines.filter((l) => l[s.lineKey] === d.id) as unknown as L[],
      movements: txs.filter((t) => t[s.key] === d.id),
    };
  });
  return { totalBalance: books.reduce((sum, b) => sum + (b.active ? Math.max(b.balance, 0) : 0), 0), books };
}

export async function getBook<L extends MemoLine>(db: D1Database, s: MemoBookSpec, id: string): Promise<MemoBook<L>> {
  return (await listBooks<L>(db, s, id)).books[0] ?? fail("not_found", `Không có ${s.noun} này.`, 404);
}

/**
 * Thêm đối tác: số tiền lúc mở sổ thành dòng 'opening' trong cùng một batch. Trả id.
 * Sổ cho mở sổ 0 (`zeroOpening`) nhận `amount: 0`: chỉ thêm đối tác, không dòng nào (thêm người ngay ở màn Gán).
 */
export async function createBook(db: D1Database, s: MemoBookSpec, b: Input, now: Date): Promise<string> {
  const name = text(b, "name", true)!;
  const id = text(b, "id") ?? slug(name);
  if (!/^[a-z0-9-]{1,40}$/.test(id)) fail("invalid_id", "Mã chỉ gồm chữ thường, số và gạch nối.");
  const amount = s.zeroOpening && b.amount === 0 ? 0 : money(b, "amount", true);
  const note = text(b, "note", false, 500);
  const at = normalizeAt(text(b, "at") ?? undefined, now);
  if (await db.prepare(`SELECT 1 FROM ${s.table} WHERE id = ?`).bind(id).first()) fail("duplicate_id", `Đã có ${s.noun} mã "${id}".`, 409);
  await db.batch([
    db.prepare(`INSERT INTO ${s.table} (id, name, note) VALUES (?, ?, ?)`).bind(id, name, note),
    ...(amount > 0 ? [db.prepare(`INSERT INTO ${s.lineTable} (${s.key}, at, kind, amount) VALUES (?, ?, 'opening', ?)`).bind(id, at, amount)] : []),
  ]);
  return id;
}

/** Đổi tên, ghi chú, bật/tắt theo dõi. */
export async function updateBook(db: D1Database, s: MemoBookSpec, id: string, b: Input): Promise<void> {
  await getBook(db, s, id);
  const cols: [string, unknown][] = [];
  if (has(b, "name")) cols.push(["name", text(b, "name", true)]);
  if (has(b, "note")) cols.push(["note", text(b, "note", false, 500)]);
  if (has(b, "active")) cols.push(["active", typeof b.active === "boolean" ? (b.active ? 1 : 0) : fail("invalid_input", "active phải là true/false.")]);
  if (cols.length) {
    await db
      .prepare(`UPDATE ${s.table} SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...cols.map(([, v]) => v), id)
      .run();
  }
}

/** Ghi tay một dòng sổ (loại trong `manualKinds`). */
export async function addLine<L extends MemoLine>(db: D1Database, s: MemoBookSpec, bookId: string, b: Input, now: Date): Promise<L> {
  const book = await getBook(db, s, bookId);
  const kind = text(b, "kind", true)!;
  if (!s.manualKinds.includes(kind)) fail("invalid_kind", `kind phải là một trong: ${s.manualKinds.join(", ")}.`);
  const amount = money(b, "amount", s.positiveKinds.includes(kind));
  const note = text(b, "note", false, 500);
  const at = normalizeAt(text(b, "at") ?? undefined, now);
  if (!book.active) fail(s.inactiveCode, `${s.noun.charAt(0).toUpperCase()}${s.noun.slice(1)} ${book.name} đã tắt.`);
  const res = await db
    .prepare(`INSERT INTO ${s.lineTable} (${s.key}, at, kind, amount, note) VALUES (?, ?, ?, ?, ?)`)
    .bind(bookId, at, kind, amount, note)
    .run();
  return (await db.prepare(`${lineSql(s)} WHERE id = ?`).bind(res.meta.last_row_id).first<L>())!;
}

/** Sổ chỉ ghi thêm: sai thì huỷ dòng (status → void), không sửa, không xoá. */
export async function voidLine<L extends MemoLine>(db: D1Database, s: MemoBookSpec, id: number): Promise<L> {
  const res = await db.prepare(`UPDATE ${s.lineTable} SET status = 'void' WHERE id = ? AND status = 'active'`).bind(id).run();
  const line = await db.prepare(`${lineSql(s)} WHERE id = ?`).bind(id).first<L>();
  if (!line) return fail("not_found", `Không có ${s.lineNoun} này.`, 404);
  if (!res.meta.changes) fail("already_void", "Dòng này đã huỷ trước đó.", 409);
  return line;
}
