// Sổ người thuê (UC-801…805): người thuê, phí cố định, dòng sổ, tạm tính và chốt tháng.
// Tiền người thuê trả KHÔNG là dòng sổ: là giao dịch income mang tenant_id (ghi qua nhập tay hoặc màn Gán),
// nên huỷ giao dịch là số dư tự đúng lại (view v_tenant_balance).

import { normalizeAt } from "../domain/entry";
import { dayKey, monthKey } from "../domain/period";
import { closingBalance, monthDraft, sharePerHead, statementText, type TenantLineKind } from "../domain/rental";
import { DomainError } from "../domain/types";

type Row = Record<string, unknown>;
type Input = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400): never => {
  throw new DomainError(code, message, status);
};
const has = (b: Input, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const MAX_AMOUNT = 1_000_000_000_000;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function text(b: Input, k: string, required = false): string | null {
  const v = b[k];
  if (v === undefined || v === null || v === "") return required ? fail("invalid_input", `Thiếu ${k}.`) : null;
  if (typeof v !== "string") return fail("invalid_input", `${k} phải là chuỗi.`);
  return v.trim().slice(0, 120);
}

function money(b: Input, k: string, opts: { required?: boolean; positive?: boolean } = {}): number | null {
  const v = b[k];
  if (v === undefined || v === null) return opts.required ? fail("invalid_input", `Thiếu ${k}.`) : null;
  if (typeof v !== "number" || !Number.isInteger(v) || Math.abs(v) > MAX_AMOUNT) return fail("invalid_amount", `${k} phải là số nguyên VND.`);
  if (opts.positive ? v <= 0 : v === 0) fail("invalid_amount", opts.positive ? `${k} phải lớn hơn 0.` : `${k} phải khác 0.`);
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

// ── Cấu hình ───────────────────────────────────────────────────────

export interface RentalConfig {
  headcount: number;
  sharedCategoryIds: string[];
  incomeStreamId: string | null;
}

export async function rentalConfig(db: D1Database): Promise<RentalConfig> {
  const list = rows<{ k: string; v: string }>(
    await db.prepare("SELECT k, v FROM config WHERE k IN ('rental_headcount', 'rental_shared_categories', 'rental_income_stream_id')").all(),
  );
  const get = (k: string) => list.find((r) => r.k === k)?.v ?? "";
  const headcount = Number(get("rental_headcount"));
  return {
    headcount: Number.isInteger(headcount) && headcount > 0 ? headcount : 1,
    sharedCategoryIds: get("rental_shared_categories").split(",").map((s) => s.trim()).filter(Boolean),
    incomeStreamId: get("rental_income_stream_id") || null,
  };
}

const setConfig = (db: D1Database, k: string, v: string) =>
  db.prepare("INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, v);

export async function updateRentalConfig(db: D1Database, b: Input): Promise<RentalConfig> {
  const statements: D1PreparedStatement[] = [];
  if (has(b, "headcount")) {
    const n = b.headcount;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 50) fail("invalid_input", "headcount phải là số nguyên từ 1 đến 50.");
    statements.push(setConfig(db, "rental_headcount", String(n)));
  }
  if (has(b, "shared_category_ids")) {
    const ids = b.shared_category_ids;
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string" || !x)) return fail("invalid_input", "shared_category_ids phải là mảng mã danh mục.");
    const unique = [...new Set(ids as string[])];
    for (const id of unique) {
      if (!(await db.prepare("SELECT 1 FROM categories WHERE id = ?").bind(id).first())) fail("unknown_category", `Không có danh mục "${id}".`);
    }
    statements.push(setConfig(db, "rental_shared_categories", unique.join(",")));
  }
  if (has(b, "income_stream_id")) {
    const id = text(b, "income_stream_id", true)!;
    if (!(await db.prepare("SELECT 1 FROM income_streams WHERE id = ? AND active = 1").bind(id).first())) fail("unknown_income_stream", `Không có nguồn thu "${id}".`);
    statements.push(setConfig(db, "rental_income_stream_id", id));
  }
  if (statements.length) await db.batch(statements);
  return rentalConfig(db);
}

// ── Người thuê, phí cố định ─────────────────────────────────────────

const toFee = (r: Row) => ({ id: Number(r.id), name: String(r.name), amount: Number(r.amount), sort: Number(r.sort), active: Boolean(r.active) });

async function requireTenant(db: D1Database, id: string): Promise<{ id: string; name: string; active: number }> {
  return (await db.prepare("SELECT id, name, active FROM tenants WHERE id = ?").bind(id).first<{ id: string; name: string; active: number }>()) ??
    fail("not_found", "Không có người thuê này.", 404);
}

export async function getRental(db: D1Database) {
  const config = await rentalConfig(db);
  const [tenants, fees] = await db.batch([
    db.prepare("SELECT tenant_id AS id, name, active, balance FROM v_tenant_balance ORDER BY active DESC, name"),
    db.prepare("SELECT id, tenant_id, name, amount, sort, active FROM tenant_fixed_fees ORDER BY sort, id"),
  ]);
  const feeRows = rows(fees!);
  return {
    headcount: config.headcount,
    sharedCategoryIds: config.sharedCategoryIds,
    incomeStreamId: config.incomeStreamId,
    tenants: rows(tenants!).map((t) => ({
      id: String(t.id),
      name: String(t.name),
      active: Boolean(t.active),
      balance: Number(t.balance),
      fees: feeRows.filter((f) => f.tenant_id === t.id).map(toFee),
    })),
  };
}

export async function createTenant(db: D1Database, b: Input, now: Date) {
  const name = text(b, "name", true)!;
  const id = text(b, "id") ?? slug(name);
  if (!/^[a-z0-9-]{1,40}$/.test(id)) fail("invalid_id", "Mã chỉ gồm chữ thường, số và gạch nối.");
  if (await db.prepare("SELECT 1 FROM tenants WHERE id = ?").bind(id).first()) fail("duplicate_id", `Đã có người thuê mã "${id}".`, 409);
  const opening = b.opening_balance === undefined || b.opening_balance === null || b.opening_balance === 0 ? null : money(b, "opening_balance");
  const at = now.toISOString();
  await db.batch([
    db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").bind(id, name),
    ...(opening === null
      ? []
      : [
          db
            .prepare("INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount) VALUES (?, ?, ?, 'opening', 'Số dư mở sổ', ?)")
            .bind(id, monthKey(now), at, opening),
        ]),
  ]);
  return (await getRental(db)).tenants.find((t) => t.id === id)!;
}

export async function updateTenant(db: D1Database, id: string, b: Input) {
  await requireTenant(db, id);
  const name = has(b, "name") ? text(b, "name", true) : null;
  if (has(b, "active") && typeof b.active !== "boolean") fail("invalid_input", "active phải là true/false.");
  const statements: D1PreparedStatement[] = [];
  if (name !== null) statements.push(db.prepare("UPDATE tenants SET name = ? WHERE id = ?").bind(name, id));
  if (typeof b.active === "boolean") statements.push(db.prepare("UPDATE tenants SET active = ? WHERE id = ?").bind(b.active ? 1 : 0, id));
  if (statements.length) await db.batch(statements);
  return (await getRental(db)).tenants.find((t) => t.id === id)!;
}

export async function addFee(db: D1Database, tenantId: string, b: Input) {
  await requireTenant(db, tenantId);
  const name = text(b, "name", true)!;
  const amount = money(b, "amount", { required: true, positive: true })!;
  const sort = b.sort === undefined ? 100 : Number.isInteger(b.sort) ? (b.sort as number) : fail("invalid_input", "sort phải là số nguyên.");
  const res = await db.prepare("INSERT INTO tenant_fixed_fees (tenant_id, name, amount, sort) VALUES (?, ?, ?, ?)").bind(tenantId, name, amount, sort).run();
  return toFee((await db.prepare("SELECT * FROM tenant_fixed_fees WHERE id = ?").bind(res.meta.last_row_id).first<Row>())!);
}

export async function updateFee(db: D1Database, id: number, b: Input) {
  if (!(await db.prepare("SELECT 1 FROM tenant_fixed_fees WHERE id = ?").bind(id).first())) fail("not_found", "Không có khoản phí này.", 404);
  const cols: [string, unknown][] = [];
  if (has(b, "name")) cols.push(["name", text(b, "name", true)]);
  if (has(b, "amount")) cols.push(["amount", money(b, "amount", { required: true, positive: true })]);
  if (has(b, "sort")) cols.push(["sort", Number.isInteger(b.sort) ? b.sort : fail("invalid_input", "sort phải là số nguyên.")]);
  if (has(b, "active")) cols.push(["active", typeof b.active === "boolean" ? (b.active ? 1 : 0) : fail("invalid_input", "active phải là true/false.")]);
  if (cols.length) {
    await db
      .prepare(`UPDATE tenant_fixed_fees SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...cols.map(([, v]) => v), id)
      .run();
  }
  return toFee((await db.prepare("SELECT * FROM tenant_fixed_fees WHERE id = ?").bind(id).first<Row>())!);
}

// ── Dòng sổ ─────────────────────────────────────────────────────────

const LINE_SQL = `SELECT id, tenant_id AS tenantId, month_key AS monthKey, at, kind, name, amount, category_id AS categoryId,
  client_id AS clientId, status FROM tenant_lines`;
export type TenantLine = {
  id: number;
  tenantId: string;
  monthKey: string;
  at: string;
  kind: TenantLineKind;
  name: string | null;
  amount: number;
  categoryId: string | null;
  clientId: string | null;
  status: "active" | "void";
};

const MANUAL_KINDS = ["one_off", "adjust", "paid_for_us"] as const;

/** Ghi tay một dòng sổ (phí một lần, chỉnh tay, người thuê chi hộ). Trùng client_id → trả lại dòng cũ. */
export async function addLine(db: D1Database, tenantId: string, b: Input, now: Date): Promise<{ line: TenantLine; duplicate: boolean }> {
  const tenant = await requireTenant(db, tenantId);
  const clientId = text(b, "client_id");
  const existing = async () => (clientId ? await db.prepare(`${LINE_SQL} WHERE client_id = ?`).bind(clientId).first<TenantLine>() : null);
  const found = await existing();
  if (found) {
    if (found.tenantId !== tenantId) fail("client_id_conflict", "client_id này đã dùng cho người thuê khác.", 409);
    return { line: found, duplicate: true };
  }

  const kind = text(b, "kind", true) as (typeof MANUAL_KINDS)[number];
  if (!MANUAL_KINDS.includes(kind)) fail("invalid_kind", `kind phải là một trong: ${MANUAL_KINDS.join(", ")}.`);
  const raw = money(b, "amount", { required: true, positive: kind !== "adjust" })!;
  let categoryId: string | null = null;
  let name = text(b, "name");
  if (kind === "paid_for_us") {
    categoryId = text(b, "category_id", true);
    const { sharedCategoryIds } = await rentalConfig(db);
    if (!sharedCategoryIds.includes(categoryId!)) fail("not_shared_category", "Người thuê chỉ chi hộ được khoản thuộc danh mục chi chung.");
    name ??= (await db.prepare("SELECT name FROM categories WHERE id = ?").bind(categoryId).first<{ name: string }>())?.name ?? null;
  } else if (kind === "one_off" && !name) {
    fail("invalid_input", "Thiếu tên khoản phí một lần.");
  }
  if (kind === "paid_for_us" && !tenant.active) fail("tenant_inactive", "Người thuê này đã ngừng.");
  const at = normalizeAt(text(b, "at") ?? undefined, now);
  const amount = kind === "paid_for_us" ? -raw : raw;
  try {
    const res = await db
      .prepare("INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount, category_id, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(tenantId, monthKey(at), at, kind, name, amount, categoryId, clientId)
      .run();
    return { line: (await db.prepare(`${LINE_SQL} WHERE id = ?`).bind(res.meta.last_row_id).first<TenantLine>())!, duplicate: false };
  } catch (err) {
    // Hai request cùng client_id chạy song song: bên thua trả lại dòng bên thắng đã ghi.
    const raced = /UNIQUE/i.test(String(err)) ? await existing() : null;
    if (raced && raced.tenantId === tenantId) return { line: raced, duplicate: true };
    throw err;
  }
}

/** Sổ chỉ ghi thêm: sai thì huỷ dòng (status → void), không sửa, không xoá. */
export async function voidLine(db: D1Database, id: number): Promise<TenantLine> {
  const res = await db.prepare("UPDATE tenant_lines SET status = 'void' WHERE id = ? AND status = 'active'").bind(id).run();
  const line = await db.prepare(`${LINE_SQL} WHERE id = ?`).bind(id).first<TenantLine>();
  if (!line) return fail("not_found", "Không có dòng sổ này.", 404);
  if (!res.meta.changes) fail("already_void", "Dòng này đã huỷ trước đó.", 409);
  return line;
}

// ── Tạm tính / chốt tháng ───────────────────────────────────────────

/** Tổng chi chung tháng = hộ chi (chi − hoàn) trong danh mục chi chung + mọi người thuê đã chi hộ trong tháng. */
export async function sharedTotal(db: D1Database, month: string, categoryIds: string[]): Promise<number> {
  const household = categoryIds.length
    ? await db
        .prepare(
          `SELECT COALESCE(SUM(CASE meaning WHEN 'spend' THEN amount ELSE -amount END), 0) AS s FROM transactions
           WHERE status = 'active' AND meaning IN ('spend', 'refund') AND month_key = ? AND category_id IN (${categoryIds.map(() => "?").join(", ")})`,
        )
        .bind(month, ...categoryIds)
        .first<{ s: number }>()
    : null;
  const paidForUs = await db
    .prepare("SELECT COALESCE(SUM(-amount), 0) AS s FROM tenant_lines WHERE status = 'active' AND kind = 'paid_for_us' AND month_key = ?")
    .bind(month)
    .first<{ s: number }>();
  return Number(household?.s ?? 0) + Number(paidForUs?.s ?? 0);
}

function parseMonth(month: string | undefined | null, now: Date): string {
  const m = month || monthKey(now);
  if (!MONTH_RE.test(m)) fail("invalid_month", "Tháng phải có dạng 2026-10.");
  if (m > monthKey(now)) fail("future_month", "Tháng này chưa tới.");
  return m;
}

export async function tenantMonth(db: D1Database, tenantId: string, monthInput: string | undefined, now: Date) {
  const tenant = await requireTenant(db, tenantId);
  const month = parseMonth(monthInput, now);
  const config = await rentalConfig(db);
  const [settlement, lineRes, payRes, before, balance, fees] = await db.batch([
    db.prepare("SELECT headcount, shared_total FROM tenant_settlements WHERE tenant_id = ? AND month_key = ?").bind(tenantId, month),
    db.prepare(`${LINE_SQL} WHERE tenant_id = ? AND month_key = ? AND status = 'active' ORDER BY at, id`).bind(tenantId, month),
    db
      .prepare("SELECT id, at, amount FROM transactions WHERE tenant_id = ? AND meaning = 'income' AND status = 'active' AND month_key = ? ORDER BY at, id")
      .bind(tenantId, month),
    db.prepare(
      `SELECT COALESCE((SELECT SUM(amount) FROM tenant_lines WHERE tenant_id = ?1 AND status = 'active' AND month_key < ?2), 0)
            - COALESCE((SELECT SUM(amount) FROM transactions WHERE tenant_id = ?1 AND meaning = 'income' AND status = 'active' AND month_key < ?2), 0) AS s`,
    ).bind(tenantId, month),
    db.prepare("SELECT balance FROM v_tenant_balance WHERE tenant_id = ?").bind(tenantId),
    db.prepare("SELECT id, name, amount, sort, active FROM tenant_fixed_fees WHERE tenant_id = ? ORDER BY sort, id").bind(tenantId),
  ]);
  const settled = rows<{ headcount: number; shared_total: number }>(settlement!)[0] ?? null;
  const lines = rows<TenantLine>(lineRes!);
  const payments = rows<{ id: number; at: string; amount: number }>(payRes!).map((p) => ({ transactionId: p.id, at: p.at, amount: Number(p.amount) }));
  const openingBalance = Number(rows<{ s: number }>(before!)[0]?.s ?? 0);
  const headcount = settled ? settled.headcount : config.headcount;
  const total = settled ? settled.shared_total : await sharedTotal(db, month, config.sharedCategoryIds);
  const draft = settled ? [] : monthDraft(rows(fees!).map(toFee), total, headcount);
  const view = { openingBalance, lines, draft, payments: payments.map((p) => ({ day: dayKey(p.at), amount: p.amount })) };
  return {
    month,
    settled: settled !== null,
    openingBalance,
    sharedTotal: total,
    headcount,
    share: sharePerHead(total, headcount),
    draft,
    lines,
    payments,
    closingBalance: closingBalance(view),
    balance: Number(rows<{ balance: number }>(balance!)[0]?.balance ?? 0),
    text: statementText({ ...view, tenantName: tenant.name, month, settled: settled !== null, sharedTotal: total, headcount }),
  };
}

const SETTLE_KINDS = ["fixed", "shared", "adjust"] as const;

/** Chốt tháng: ghi tenant_settlements + các dòng trong MỘT batch. Trùng (người thuê, tháng) → cả batch huỷ → 409. */
export async function settleMonth(db: D1Database, tenantId: string, b: Input, now: Date) {
  await requireTenant(db, tenantId);
  const month = parseMonth(text(b, "month", true), now);
  const config = await rentalConfig(db);
  const headcount = b.headcount === undefined || b.headcount === null ? config.headcount : b.headcount;
  if (typeof headcount !== "number" || !Number.isInteger(headcount) || headcount < 1 || headcount > 50) fail("invalid_input", "headcount phải là số nguyên từ 1 đến 50.");
  if (!Array.isArray(b.lines)) fail("invalid_input", "lines phải là mảng.");
  const lines = (b.lines as unknown[]).map((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("invalid_input", `lines[${i}] phải là object.`);
    const l = raw as Input;
    const kind = text(l, "kind", true) as (typeof SETTLE_KINDS)[number];
    if (!SETTLE_KINDS.includes(kind)) fail("invalid_kind", `lines[${i}].kind phải là một trong: ${SETTLE_KINDS.join(", ")}.`);
    return { kind, name: text(l, "name"), amount: money(l, "amount", { required: true, positive: kind !== "adjust" })! };
  });
  const already = () => fail("already_settled", `Tháng ${month} đã chốt với người thuê này. Muốn sửa thì huỷ dòng rồi ghi điều chỉnh.`, 409);
  if (await db.prepare("SELECT 1 FROM tenant_settlements WHERE tenant_id = ? AND month_key = ?").bind(tenantId, month).first()) already();

  const total = await sharedTotal(db, month, config.sharedCategoryIds);
  const at = now.toISOString();
  try {
    await db.batch([
      db.prepare("INSERT INTO tenant_settlements (tenant_id, month_key, headcount, shared_total, at) VALUES (?, ?, ?, ?, ?)").bind(tenantId, month, headcount, total, at),
      ...lines.map((l) =>
        db.prepare("INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount) VALUES (?, ?, ?, ?, ?, ?)").bind(tenantId, month, at, l.kind, l.name, l.amount),
      ),
    ]);
  } catch (err) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(err)) && (await db.prepare("SELECT 1 FROM tenant_settlements WHERE tenant_id = ? AND month_key = ?").bind(tenantId, month).first())) {
      already();
    }
    throw err;
  }
  return tenantMonth(db, tenantId, month, now);
}

/** Người thuê đang ở mà chưa chốt tháng `month` — cho tin sáng ngày 1. */
export async function unsettledTenants(db: D1Database, month: string): Promise<{ id: string; name: string; balance: number }[]> {
  return rows<{ id: string; name: string; balance: number }>(
    await db
      .prepare(
        `SELECT b.tenant_id AS id, b.name, b.balance FROM v_tenant_balance b
         WHERE b.active = 1 AND NOT EXISTS (SELECT 1 FROM tenant_settlements s WHERE s.tenant_id = b.tenant_id AND s.month_key = ?)
         ORDER BY b.name`,
      )
      .bind(month)
      .all(),
  ).map((r) => ({ ...r, balance: Number(r.balance) }));
}
