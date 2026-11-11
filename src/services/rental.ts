// Sổ người thuê (rental UC-801, UC-805…807): người thuê, bản tính tháng (khoản theo hai hạng), chốt & gửi, sửa sau khi gửi.
// Số dư người thuê = Σ dòng sổ tenant_lines còn hiệu lực − Σ income mang tenant_id (view v_tenant_balance). Bản tính nháp không
// đụng sổ; chốt & gửi ghi MỘT dòng kind='bill' bằng tổng (at = lần gửi đầu); sửa sau khi gửi huỷ dòng cũ + ghi dòng mới cùng
// at trong một batch. Mọi lần ghi bản tính kèm `revision` đang thấy (khoá lạc quan): câu cuối batch tăng revision, các câu
// trước mang cùng điều kiện — revision lệch thì không câu nào ghi → 409 bill_changed.

import { monthKey, previousMonth } from "../domain/period";
import {
  billItemsInput,
  billMemo,
  billMonthLabel,
  billTotals,
  itemKey,
  memoKey,
  previousAmounts,
  statementText,
  type BillCategory,
  type BillItem,
} from "../domain/rental";
import { DomainError } from "../domain/types";
import { transferQr } from "../domain/vietqr";
import { audit, type Actor } from "./audit";
import { hiddenAccountIds, hiddenTxSql } from "./privacy";

type Input = Record<string, unknown>;
const rows = <T>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400): never => {
  throw new DomainError(code, message, status);
};
const has = (b: Input, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const MAX_AMOUNT = 1_000_000_000_000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const NO_QR = "Chưa có mã QR — chọn tài khoản nhận trên bản tính.";
const billChanged = () => fail("bill_changed", "Bản tính vừa được sửa ở máy khác — tải lại.", 409);

function text(b: Input, k: string, required = false): string | null {
  const v = b[k];
  if (v === undefined || v === null || v === "") return required ? fail("invalid_input", `Thiếu ${k}.`) : null;
  if (typeof v !== "string") return fail("invalid_input", `${k} phải là chuỗi.`);
  return v.trim().slice(0, 120);
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

/** Tháng ở của bản tính: dạng YYYY-MM, không sau tháng hiện tại (QĐ7). */
function parseMonth(month: string | null | undefined, now: Date): string {
  const m = month || previousMonth(monthKey(now));
  if (!MONTH_RE.test(m)) fail("invalid_month", "Tháng phải có dạng 2026-10.");
  if (m > monthKey(now)) fail("future_month", "Tháng này chưa tới.");
  return m;
}

// ── Cấu hình ───────────────────────────────────────────────────────

export interface RentalConfig {
  incomeStreamId: string | null;
}

export async function rentalConfig(db: D1Database): Promise<RentalConfig> {
  const row = await db.prepare("SELECT v FROM config WHERE k = 'rental_income_stream_id'").first<{ v: string }>();
  return { incomeStreamId: row?.v || null };
}

/** `PATCH /v1/rental/config { income_stream_id }`. Khoá chia chi chung cũ → 400 model_changed (QĐ2). */
export async function updateRentalConfig(db: D1Database, b: Input): Promise<RentalConfig> {
  const old = ["headcount", "shared_category_ids"].filter((k) => has(b, k));
  if (old.length) throw new DomainError("model_changed", "Ví nhà v2.2 bỏ chia chi chung theo số người: chỉ còn nguồn thu (income_stream_id).", 400, undefined, old);
  if (has(b, "income_stream_id")) {
    const id = text(b, "income_stream_id", true)!;
    if (!(await db.prepare("SELECT 1 FROM income_streams WHERE id = ? AND active = 1").bind(id).first())) fail("unknown_income_stream", `Không có nguồn thu "${id}".`);
    await db.prepare("INSERT INTO config (k, v) VALUES ('rental_income_stream_id', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(id).run();
  }
  return rentalConfig(db);
}

// ── Người thuê ──────────────────────────────────────────────────────

type TenantRow = { id: string; name: string; active: number };

async function requireTenant(db: D1Database, id: string): Promise<TenantRow> {
  return (await db.prepare("SELECT id, name, active FROM tenants WHERE id = ?").bind(id).first<TenantRow>()) ?? fail("not_found", "Không có người thuê này.", 404);
}

export interface TenantSummary {
  id: string;
  name: string;
  active: boolean;
  balance: number;
  /** Bản tính của tháng trước — tháng đang tới hạn gửi (QĐ7). */
  bill: { id: number; month: string; status: "draft" | "issued"; total: number; revision: number; edited: boolean } | null;
}

export async function getRental(db: D1Database, now: Date): Promise<RentalConfig & { tenants: TenantSummary[] }> {
  const month = previousMonth(monthKey(now));
  const list = rows<{ id: string; name: string; active: number; balance: number; billId: number | null; status: "draft" | "issued"; total: number; revision: number; editedAt: string | null }>(
    await db
      .prepare(
        `SELECT v.tenant_id AS id, v.name, v.active, v.balance, b.id AS billId, b.status, b.total, b.revision, b.edited_at AS editedAt
         FROM v_tenant_balance v LEFT JOIN tenant_bills b ON b.tenant_id = v.tenant_id AND b.month_key = ?
         ORDER BY v.active DESC, v.name`,
      )
      .bind(month)
      .all(),
  );
  return {
    ...(await rentalConfig(db)),
    tenants: list.map((t) => ({
      id: t.id,
      name: t.name,
      active: Boolean(t.active),
      balance: Number(t.balance),
      bill: t.billId === null ? null : { id: t.billId, month, status: t.status, total: Number(t.total), revision: t.revision, edited: t.editedAt !== null },
    })),
  };
}

export async function createTenant(db: D1Database, b: Input, now: Date): Promise<TenantSummary> {
  const name = text(b, "name", true)!;
  const id = text(b, "id") ?? slug(name);
  if (!/^[a-z0-9-]{1,40}$/.test(id)) fail("invalid_id", "Mã chỉ gồm chữ thường, số và gạch nối.");
  if (await db.prepare("SELECT 1 FROM tenants WHERE id = ?").bind(id).first()) fail("duplicate_id", `Đã có người thuê mã "${id}".`, 409);
  const opening = b.opening_balance === undefined || b.opening_balance === null || b.opening_balance === 0 ? null : b.opening_balance;
  if (opening !== null && (typeof opening !== "number" || !Number.isInteger(opening) || Math.abs(opening) > MAX_AMOUNT)) fail("invalid_amount", "opening_balance phải là số nguyên VND.");
  await db.batch([
    db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").bind(id, name),
    ...(opening === null
      ? []
      : [
          db
            .prepare("INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount) VALUES (?, ?, ?, 'opening', 'Số dư mở sổ', ?)")
            .bind(id, monthKey(now), now.toISOString(), opening),
        ]),
  ]);
  return (await getRental(db, now)).tenants.find((t) => t.id === id)!;
}

export async function updateTenant(db: D1Database, id: string, b: Input, now: Date): Promise<TenantSummary> {
  await requireTenant(db, id);
  const name = has(b, "name") ? text(b, "name", true) : null;
  if (has(b, "active") && typeof b.active !== "boolean") fail("invalid_input", "active phải là true/false.");
  const statements: D1PreparedStatement[] = [];
  if (name !== null) statements.push(db.prepare("UPDATE tenants SET name = ? WHERE id = ?").bind(name, id));
  if (typeof b.active === "boolean") statements.push(db.prepare("UPDATE tenants SET active = ? WHERE id = ?").bind(b.active ? 1 : 0, id));
  if (statements.length) await db.batch(statements);
  return (await getRental(db, now)).tenants.find((t) => t.id === id)!;
}

// ── Bản tính tháng ──────────────────────────────────────────────────

interface BillRow {
  id: number;
  tenant_id: string;
  month_key: string;
  status: "draft" | "issued";
  copied_from_id: number | null;
  receive_account_id: string | null;
  total: number;
  revision: number;
  issued_at: string | null;
  edited_at: string | null;
}
const BILL_SQL = "SELECT id, tenant_id, month_key, status, copied_from_id, receive_account_id, total, revision, issued_at, edited_at FROM tenant_bills";

const billById = (db: D1Database, id: number) => db.prepare(`${BILL_SQL} WHERE id = ?`).bind(id).first<BillRow>();
const billOf = (db: D1Database, tenantId: string, month: string) => db.prepare(`${BILL_SQL} WHERE tenant_id = ? AND month_key = ?`).bind(tenantId, month).first<BillRow>();
/** Bản tính gần nhất trước tháng `month` (đã gửi hay nháp) — nguồn chép và mốc so sánh. */
const billBefore = (db: D1Database, tenantId: string, month: string) =>
  db.prepare(`${BILL_SQL} WHERE tenant_id = ? AND month_key < ? ORDER BY month_key DESC LIMIT 1`).bind(tenantId, month).first<BillRow>();

async function itemsOf(db: D1Database, billId: number): Promise<BillItem[]> {
  return rows<BillItem>(await db.prepare("SELECT name, category, amount FROM tenant_bill_items WHERE bill_id = ? ORDER BY sort, id").bind(billId).all());
}

type AccountRow = { id: string; name: string; kind: string; bank: string | null; account_no: string | null; sub_account: string | null; sepay_enabled: number; active: number; private: number };
const accountOf = (db: D1Database, id: string) =>
  db.prepare("SELECT id, name, kind, bank, account_no, sub_account, sepay_enabled, active, private FROM accounts WHERE id = ?").bind(id).first<AccountRow>();
/** Tài khoản nhận hợp lệ (QĐ6): ngân hàng, đang dùng, không riêng tư. */
const receivable = (a: AccountRow | null): a is AccountRow => a !== null && a.active === 1 && a.kind === "bank" && a.private === 0;

async function checkReceiveAccount(db: D1Database, id: string): Promise<void> {
  const a = await accountOf(db, id);
  if (!a || a.active !== 1 || a.kind !== "bank") fail("unknown_account", "Tài khoản nhận phải là tài khoản ngân hàng đang dùng.");
  if (a!.private === 1) fail("tenant_private_account", "Tiền thuê không ghi vào tài khoản riêng tư — chọn tài khoản khác.");
}

export type BillQr = { payload: string; label: string; memo: string; transfer: string } | { reason: string };

export interface BillView {
  tenant: { id: string; name: string; active: boolean };
  month: string;
  status: "none" | "draft" | "issued";
  bill: {
    id: number;
    status: "draft" | "issued";
    revision: number;
    issuedAt: string | null;
    editedAt: string | null;
    receiveAccountId: string | null;
    copiedFromMonth: string | null;
    items: (BillItem & { previous: number | null })[];
  } | null;
  previous: { month: string; total: number; items: BillItem[] } | null;
  totals: { fixed: number; variable: number; total: number };
  total: number;
  previousBalance: number;
  text: string | null;
  qrAmount: number;
  qr: BillQr | null;
  payments: { transactionId: number; at: string; amount: number }[];
  balance: number;
}

async function billQr(db: D1Database, bill: BillRow, tenantId: string, amount: number): Promise<BillQr | null> {
  if (amount <= 0) return null;
  const account = bill.receive_account_id ? await accountOf(db, bill.receive_account_id) : null;
  if (!receivable(account)) return { reason: NO_QR };
  const memo = billMemo(bill.month_key, tenantId);
  const qr = transferQr({
    amount,
    memo,
    to_name: account.name,
    to_kind: account.kind,
    to_bank: account.bank,
    to_account_no: account.account_no,
    to_sub_account: account.sub_account,
    to_sepay_enabled: account.sepay_enabled,
  });
  if (!("payload" in qr)) return { reason: qr.reason ?? NO_QR };
  // Nhãn của transferQr là "<ngân hàng> · <số TK / VA> · <tên tài khoản>": tin gửi chỉ cần ngân hàng và số.
  return { ...qr, memo, transfer: `${qr.label.slice(0, -` · ${account.name}`.length)} · nội dung ${memo}` };
}

/**
 * Bản tính tháng `month` của người thuê nhìn như `viewerId` (UC-807): khoản + số tháng trước, tổng, "Các tháng trước", tin gửi,
 * QR, tiền đã trả từ lúc gửi (bỏ khoản bị giấu — tổng giữ, ADR-133 (5)).
 */
export async function getBill(db: D1Database, tenantId: string, monthInput: string | undefined, viewerId: string | null, now: Date): Promise<BillView> {
  const tenant = await requireTenant(db, tenantId);
  const month = parseMonth(monthInput, now);
  const [bill, prevRow] = await Promise.all([billOf(db, tenantId, month), billBefore(db, tenantId, month)]);
  const [items, prevItems] = await Promise.all([bill ? itemsOf(db, bill.id) : [], prevRow ? itemsOf(db, prevRow.id) : []]);
  const totals = billTotals(items);
  const mark = bill?.issued_at ?? now.toISOString();
  // "Các tháng trước" (QĐ4): dòng của bản tính khác tính theo tháng của bản tính; dòng không thuộc bản tính nào và tiền
  // đã trả tính theo lúc ghi so với mốc (lần gửi đầu, hoặc lúc đọc với bản nháp).
  const hidden = await hiddenAccountIds(db, viewerId);
  const hide = hiddenTxSql("t", hidden);
  const [before, balance, pays] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE((SELECT SUM(l.amount) FROM tenant_lines l JOIN tenant_bills b ON b.id = l.bill_id
                          WHERE l.tenant_id = ?1 AND l.status = 'active' AND b.month_key < ?2), 0)
              + COALESCE((SELECT SUM(amount) FROM tenant_lines WHERE tenant_id = ?1 AND status = 'active' AND bill_id IS NULL AND at < ?3), 0)
              - COALESCE((SELECT SUM(amount) FROM transactions WHERE tenant_id = ?1 AND meaning = 'income' AND status = 'active' AND at < ?3), 0) AS s`,
      )
      .bind(tenantId, month, mark),
    db.prepare("SELECT balance FROM v_tenant_balance WHERE tenant_id = ?").bind(tenantId),
    db
      .prepare(
        `SELECT t.id AS transactionId, t.at, t.amount FROM transactions t
         WHERE t.tenant_id = ? AND t.meaning = 'income' AND t.status = 'active' AND t.at >= ? AND NOT ${hide.sql} ORDER BY t.at, t.id`,
      )
      .bind(tenantId, bill?.issued_at ?? "9999", ...hide.binds),
  ]);
  const previousBalance = Number(rows<{ s: number }>(before!)[0]?.s ?? 0);
  const previous = prevRow ? { month: prevRow.month_key, total: Number(prevRow.total), items: prevItems } : null;
  const qrAmount = bill && totals.total > 0 ? totals.total : 0;
  const qr = bill ? await billQr(db, bill, tenantId, qrAmount) : null;
  const prevAmounts = previousAmounts(items, prevItems);
  return {
    tenant: { id: tenant.id, name: tenant.name, active: tenant.active === 1 },
    month,
    status: bill ? bill.status : "none",
    bill: bill
      ? {
          id: bill.id,
          status: bill.status,
          revision: bill.revision,
          issuedAt: bill.issued_at,
          editedAt: bill.edited_at,
          receiveAccountId: bill.receive_account_id,
          copiedFromMonth: bill.copied_from_id === null ? null : ((await billById(db, bill.copied_from_id))?.month_key ?? null),
          items: items.map((i, n) => ({ ...i, previous: prevAmounts[n] ?? null })),
        }
      : null,
    previous,
    totals,
    total: totals.total,
    previousBalance,
    text: bill
      ? statementText({
          tenantName: tenant.name,
          month,
          status: bill.status,
          editedAt: bill.edited_at,
          items,
          previous: previous && { month: previous.month, total: previous.total },
          transfer: qr && "transfer" in qr ? qr.transfer : null,
          previousBalance,
        })
      : null,
    qrAmount,
    qr,
    payments: rows<{ transactionId: number; at: string; amount: number }>(pays!).map((p) => ({ ...p, amount: Number(p.amount) })),
    balance: Number(rows<{ balance: number }>(balance!)[0]?.balance ?? 0),
  };
}

/** Lập bản tính tháng M (UC-806 bước 2): chép khoản + tài khoản nhận còn hợp lệ của bản gần nhất trước M. Đã có → trả lại. */
export async function createBill(db: D1Database, tenantId: string, b: Input, actor: Actor, now: Date): Promise<{ view: BillView; created: boolean }> {
  const month = parseMonth(text(b, "month", true), now);
  const tenant = await requireTenant(db, tenantId);
  const existing = async () => ({ view: await getBill(db, tenantId, month, actor.memberId, now), created: false });
  if (await billOf(db, tenantId, month)) return existing();
  if (tenant.active !== 1) fail("tenant_inactive", "Người thuê này đã ra — không lập bản tính mới.");
  const prev = await billBefore(db, tenantId, month);
  const items = prev ? await itemsOf(db, prev.id) : [];
  const receive = prev?.receive_account_id && receivable(await accountOf(db, prev.receive_account_id)) ? prev.receive_account_id : null;
  const billId = "(SELECT id FROM tenant_bills WHERE tenant_id = ? AND month_key = ?)";
  try {
    await db.batch([
      db
        .prepare("INSERT INTO tenant_bills (tenant_id, month_key, copied_from_id, receive_account_id, total) VALUES (?, ?, ?, ?, ?)")
        .bind(tenantId, month, prev?.id ?? null, receive, billTotals(items).total),
      ...items.map((i, n) =>
        db.prepare(`INSERT INTO tenant_bill_items (bill_id, sort, name, category, amount) VALUES (${billId}, ?, ?, ?, ?)`).bind(tenantId, month, n, i.name, i.category, i.amount),
      ),
    ]);
  } catch (err) {
    // Hai máy cùng lập: bên thua trả lại bản bên thắng đã tạo.
    if (/UNIQUE/i.test(String(err)) && (await billOf(db, tenantId, month))) return existing();
    throw err;
  }
  await audit(db, actor, "tenant.bill_create", `tenant:${tenantId}`, { month, copied_from: prev?.month_key ?? null });
  return { view: await getBill(db, tenantId, month, actor.memberId, now), created: true };
}

function parseRevision(b: Input): number {
  const r = b.revision;
  return typeof r === "number" && Number.isInteger(r) && r >= 0 ? r : fail("invalid_input", "Thiếu revision (số nguyên) của bản tính đang xem.");
}

/**
 * Ghi lại danh sách khoản (+ tài khoản nhận) của bản tính đang ở `revision`. Bản đã gửi mà tổng đổi: trong cùng batch huỷ mọi
 * dòng sổ còn hiệu lực của bản tính, ghi dòng `bill` mới bằng tổng mới (≠ 0) với at = lần gửi đầu. Câu cuối tăng revision;
 * `meta.changes = 0` (revision đã đổi) → không câu nào ghi → 409.
 */
async function writeBill(db: D1Database, bill: BillRow, revision: number, items: BillItem[], receive: string | null, now: Date): Promise<number> {
  if (revision !== bill.revision) billChanged();
  const total = billTotals(items).total;
  const guard = "EXISTS (SELECT 1 FROM tenant_bills WHERE id = ? AND revision = ?)";
  const statements = [
    db.prepare(`DELETE FROM tenant_bill_items WHERE bill_id = ? AND ${guard}`).bind(bill.id, bill.id, revision),
    ...items.map((i, n) =>
      db.prepare(`INSERT INTO tenant_bill_items (bill_id, sort, name, category, amount) SELECT ?, ?, ?, ?, ? WHERE ${guard}`).bind(bill.id, n, i.name, i.category, i.amount, bill.id, revision),
    ),
  ];
  if (bill.status === "issued" && total !== bill.total) {
    statements.push(
      db
        .prepare(`UPDATE tenant_lines SET status = 'void' WHERE bill_id = ? AND status = 'active' AND EXISTS (SELECT 1 FROM tenant_bills WHERE id = ? AND revision = ? AND status = 'issued')`)
        .bind(bill.id, bill.id, revision),
    );
    if (total !== 0) {
      statements.push(
        db
          .prepare(
            `INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount, bill_id)
             SELECT tenant_id, month_key, issued_at, 'bill', ?, ?, id FROM tenant_bills WHERE id = ? AND revision = ? AND status = 'issued'`,
          )
          .bind(`Bản tính tháng ${billMonthLabel(bill.month_key)}`, total, bill.id, revision),
      );
    }
  }
  statements.push(
    db
      .prepare(
        `UPDATE tenant_bills SET revision = revision + 1, total = ?, receive_account_id = ?, edited_at = CASE WHEN status = 'issued' THEN ? ELSE edited_at END
         WHERE id = ? AND revision = ?`,
      )
      .bind(total, receive, now.toISOString(), bill.id, revision),
  );
  try {
    const results = await db.batch(statements);
    if (!results.at(-1)!.meta.changes) billChanged();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) billChanged();
    throw err;
  }
  return total;
}

const itemsOrFail = (raw: unknown): BillItem[] => {
  const r = billItemsInput(raw);
  if (!r.ok) throw new DomainError(r.code, r.message);
  return r.items;
};

/** `PUT /v1/rental/bills/:id` — lưu nháp, hoặc sửa bản đã gửi (QĐ5): nhật ký tổng cũ → mới, dấu "đã sửa sau khi gửi". */
export async function saveBill(db: D1Database, billId: number, b: Input, actor: Actor, now: Date): Promise<BillView> {
  const bill = (await billById(db, billId)) ?? fail("not_found", "Không có bản tính này.", 404);
  const revision = parseRevision(b);
  const items = itemsOrFail(b.items);
  let receive = bill.receive_account_id;
  if (has(b, "receive_account_id")) {
    const v = b.receive_account_id;
    if (v !== null && typeof v !== "string") fail("invalid_input", "receive_account_id phải là mã tài khoản hoặc null.");
    receive = (v as string | null) || null;
    // Chỉ kiểm khi đổi: bản cũ trỏ tài khoản vừa bật riêng tư vẫn sửa được khoản (QR mất, có lý do).
    if (receive !== null && receive !== bill.receive_account_id) await checkReceiveAccount(db, receive);
  }
  const total = await writeBill(db, bill, revision, items, receive, now);
  if (bill.status === "issued") await audit(db, actor, "tenant.bill_edit", `tenant:${bill.tenant_id}`, { month: bill.month_key, from: Number(bill.total), to: total });
  else await audit(db, actor, "tenant.bill_save", `tenant:${bill.tenant_id}`, { month: bill.month_key, total });
  return getBill(db, bill.tenant_id, bill.month_key, actor.memberId, now);
}

/** `POST /v1/rental/bills/:id/issue` — chốt & gửi: một dòng `bill` bằng tổng (tổng 0 thì không ghi). Đã gửi → trả lại (5a). */
export async function issueBill(db: D1Database, billId: number, b: Input, actor: Actor, now: Date): Promise<BillView> {
  const bill = (await billById(db, billId)) ?? fail("not_found", "Không có bản tính này.", 404);
  const view = () => getBill(db, bill.tenant_id, bill.month_key, actor.memberId, now);
  if (bill.status === "issued") return view();
  const revision = parseRevision(b);
  if (revision !== bill.revision) billChanged();
  const total = billTotals(await itemsOf(db, bill.id)).total;
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (total !== 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount, bill_id)
           SELECT tenant_id, month_key, ?, 'bill', ?, ?, id FROM tenant_bills WHERE id = ? AND status = 'draft' AND revision = ?`,
        )
        .bind(at, `Bản tính tháng ${billMonthLabel(bill.month_key)}`, total, bill.id, revision),
    );
  }
  statements.push(
    db
      .prepare("UPDATE tenant_bills SET status = 'issued', issued_at = ?, total = ?, revision = revision + 1 WHERE id = ? AND status = 'draft' AND revision = ?")
      .bind(at, total, bill.id, revision),
  );
  let written = false;
  try {
    written = Boolean((await db.batch(statements)).at(-1)!.meta.changes);
  } catch (err) {
    if (!/UNIQUE/i.test(String(err))) throw err;
  }
  if (!written) {
    // Bấm hai lần / hai máy cùng chốt: bên thua thấy bản đã gửi thì trả lại nó, không thì bản vừa bị sửa.
    if ((await billById(db, billId))?.status === "issued") return view();
    billChanged();
  }
  await audit(db, actor, "tenant.bill_issue", `tenant:${bill.tenant_id}`, { month: bill.month_key, total });
  return view();
}

/** `DELETE /v1/rental/bills/:id` — chỉ bản nháp (lập nhầm tháng); bản đã gửi sửa về rỗng chứ không xoá. */
export async function deleteBill(db: D1Database, billId: number, actor: Actor): Promise<{ id: number }> {
  const bill = (await billById(db, billId)) ?? fail("not_found", "Không có bản tính này.", 404);
  if (bill.status === "issued") fail("bill_issued", "Bản tính đã gửi không xoá được — sửa khoản về rỗng nếu cần.", 409);
  const res = await db.batch([
    db.prepare("DELETE FROM tenant_bill_items WHERE bill_id = ? AND EXISTS (SELECT 1 FROM tenant_bills WHERE id = ? AND status = 'draft')").bind(billId, billId),
    db.prepare("DELETE FROM tenant_bills WHERE id = ? AND status = 'draft'").bind(billId),
  ]);
  if (!res.at(-1)!.meta.changes) fail("bill_issued", "Bản tính vừa được chốt & gửi ở máy khác.", 409);
  await audit(db, actor, "tenant.bill_delete", `tenant:${bill.tenant_id}`, { month: bill.month_key });
  return { id: billId };
}

/**
 * Claude sửa một khoản trong bản nháp (MCP `set_tenant_bill_item`, UC-806 AC-15): khớp theo tên (không phân biệt hoa thường),
 * không có thì thêm (hạng mặc định Chi phí); chưa có nháp thì lập bằng chép tháng trước; bản đã gửi → `bill_issued`.
 */
export async function setBillItem(
  db: D1Database,
  b: { tenant_id: string; month?: string; name: string; category?: BillCategory; amount: number },
  actor: Actor,
  now: Date,
): Promise<BillView> {
  const month = parseMonth(b.month, now);
  const view = (await createBill(db, b.tenant_id, { month }, actor, now)).view;
  if (view.bill!.status === "issued") fail("bill_issued", "Bản tính đã gửi — sửa trên app.", 409);
  const bill = (await billById(db, view.bill!.id))!;
  const items = await itemsOf(db, bill.id);
  const key = itemKey(b.name);
  const at = items.findIndex((i) => itemKey(i.name) === key);
  if (at >= 0) items[at] = { ...items[at]!, amount: b.amount, ...(b.category ? { category: b.category } : {}) };
  else items.push({ name: b.name, category: b.category ?? "variable", amount: b.amount });
  await writeBill(db, bill, bill.revision, itemsOrFail(items), bill.receive_account_id, now);
  await audit(db, actor, "tenant.bill_item", `tenant:${bill.tenant_id}`, { month, name: b.name.trim(), amount: b.amount });
  return getBill(db, bill.tenant_id, month, actor.memberId, now);
}

/** Người thuê đang ở chưa có bản tính ĐÃ GỬI của tháng `month` — tin sáng ngày 1 (UC-806 AC-12). */
export async function billReminder(db: D1Database, month: string): Promise<{ id: string; name: string; balance: number }[]> {
  return rows<{ id: string; name: string; balance: number }>(
    await db
      .prepare(
        `SELECT v.tenant_id AS id, v.name, v.balance FROM v_tenant_balance v
         WHERE v.active = 1 AND NOT EXISTS (SELECT 1 FROM tenant_bills b WHERE b.tenant_id = v.tenant_id AND b.month_key = ? AND b.status = 'issued')
         ORDER BY v.name`,
      )
      .bind(month)
      .all(),
  ).map((r) => ({ ...r, balance: Number(r.balance) }));
}

/** Mã nội dung QR (memoKey) của mọi bản tính đã gửi — để gợi ý "Thu từ <tên>" cho log tiền vào (UC-805 AC-11). */
export async function issuedBillMemos(db: D1Database): Promise<{ tenantId: string; tenantName: string; key: string }[]> {
  const list = rows<{ tenantId: string; tenantName: string; month: string }>(
    await db
      .prepare("SELECT DISTINCT b.tenant_id AS tenantId, t.name AS tenantName, b.month_key AS month FROM tenant_bills b JOIN tenants t ON t.id = b.tenant_id WHERE b.status = 'issued'")
      .all(),
  );
  const seen = new Set<string>();
  return list.flatMap(({ tenantId, tenantName, month }) => {
    const key = memoKey(billMemo(month, tenantId));
    if (seen.has(`${tenantId} ${key}`)) return [];
    seen.add(`${tenantId} ${key}`);
    return [{ tenantId, tenantName, key }];
  });
}
