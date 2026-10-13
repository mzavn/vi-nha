// Bảng cân đối (BR-15, UC-1101, UC-1102): mục tài sản nhập tay (định giá theo ngày, lô) + dòng từ sổ. Đọc bằng một câu
// SQL mỗi nguồn gộp theo tháng giờ VN (ADR nháp B — vừa trần CPU Workers Free), rồi dựng bảng bằng hàm thuần
// src/domain/balance.ts. Ghi: chỉ các bảng balance_* — không bao giờ sinh giao dịch, không đổi ví, số dư hay chia tiền.

import {
  ASSET_KINDS,
  firstDataMonth,
  ITEM_SECTIONS,
  itemAt,
  monthEnd,
  monthsBack,
  PYRAMID,
  sheetAt,
  type AssetKind,
  type ItemSrc,
  type ItemView,
  type LotSrc,
  type PyramidTier,
  type Sheet,
  type Sources,
  type ValueSrc,
} from "../domain/balance";
import { percentToBps } from "../domain/interest";
import { dayKey, monthKey } from "../domain/period";
import { DomainError } from "../domain/types";
import { debtInterest } from "./debts";

type Row = Record<string, unknown>;
type Input = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const has = (b: Input, k: string) => Object.prototype.hasOwnProperty.call(b, k);
const fail = (code: string, message: string, status = 400): never => {
  throw new DomainError(code, message, status);
};
const MAX_AMOUNT = 1_000_000_000_000;

/** Ngày theo lịch VN: 'YYYY-MM-DD' có thật. */
function isDay(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
}

// ── Đọc ─────────────────────────────────────────────────────────────

/** Ngày giờ VN của cột `at` (ISO UTC). */
const VN_DAY = (col: string) => `date(${col}, '+7 hours')`;
const VN_MONTH = (col: string) => `strftime('%Y-%m', ${col}, '+7 hours')`;

const ITEM_COLS = `id, name, section, pyramid, measure, unit, liquid, investable, asset_kind AS assetKind, cost_basis AS costBasis,
  acquired_on AS acquiredOn, take_profit_value AS takeProfitValue, stop_loss_value AS stopLossValue, note, sort, created_at AS createdAt`;
const VALUE_COLS = `id, item_id AS itemId, as_of AS asOf, value, unit_price AS unitPrice, cashflow, cashflow_period AS cashflowPeriod,
  expected_return_bps AS expectedReturnBps, created_at AS createdAt`;
const LOT_COLS = `id, item_id AS itemId, bought_on AS boughtOn, quantity_milli AS quantityMilli, unit_cost AS unitCost, sold_on AS soldOn,
  sold_unit_price AS soldUnitPrice, take_profit_price AS takeProfitPrice, stop_loss_price AS stopLossPrice, note, created_at AS createdAt`;

const toItem = (r: Row): ItemSrc => ({ ...(r as unknown as ItemSrc), liquid: Boolean(r.liquid), investable: Boolean(r.investable) });

/** Mục + định giá + lô tới ngày D (ba câu). */
function itemStatements(db: D1Database, date: string) {
  return [
    db.prepare(`SELECT ${ITEM_COLS} FROM balance_items ORDER BY sort, name, id`),
    db.prepare(`SELECT ${VALUE_COLS} FROM balance_values WHERE status = 'active' AND as_of <= ? ORDER BY item_id, as_of, id`).bind(date),
    db.prepare(`SELECT ${LOT_COLS} FROM balance_lots WHERE status = 'active' AND bought_on <= ? ORDER BY item_id, bought_on, id`).bind(date),
  ];
}

/**
 * Mọi nguồn của bảng cân đối tới cuối ngày `date`, mỗi nguồn MỘT câu gộp theo tháng (UC-1102 AC-9): tài khoản; giao dịch theo
 * tài khoản × tháng; dòng nợ + trả nợ theo khoản × tháng; phải thu theo khoản × tháng; người thuê theo tháng; buy_asset theo
 * loại × tháng; mục; định giá; lô; tham số. Không câu nào lặp theo tháng hay theo mục.
 */
export async function loadSources(db: D1Database, date: string): Promise<Sources> {
  const [accounts, accountTx, debts, receivables, tenants, appAssets, items, values, lots, config] = await db.batch([
    db.prepare(
      `SELECT id, name, kind, opening_balance AS openingBalance, opened_at AS openedAt, active, deactivated_at AS deactivatedAt FROM accounts`,
    ),
    db
      .prepare(
        `SELECT acc AS id, m AS month, SUM(delta) AS delta FROM (
           SELECT account_id AS acc, ${VN_MONTH("at")} AS m, -amount AS delta FROM transactions
           WHERE status = 'active' AND account_id IS NOT NULL AND ${VN_DAY("at")} <= ?1
           UNION ALL
           SELECT counter_account_id, ${VN_MONTH("at")}, amount FROM transactions
           WHERE status = 'active' AND counter_account_id IS NOT NULL AND ${VN_DAY("at")} <= ?1
         ) GROUP BY acc, m`,
      )
      .bind(date),
    db
      .prepare(
        `SELECT d.id, d.name, d.active, d.deactivated_at AS deactivatedAt, d.interest_rate_bps AS rateBps, d.term, d.due_day AS dueDay,
                x.m AS month, SUM(x.delta) AS delta
         FROM debts d JOIN (
           SELECT debt_id AS id, ${VN_MONTH("at")} AS m, amount AS delta FROM debt_lines WHERE status = 'active' AND ${VN_DAY("at")} <= ?1
           UNION ALL
           SELECT debt_id, ${VN_MONTH("at")}, -amount FROM transactions
           WHERE debt_id IS NOT NULL AND meaning = 'spend' AND status = 'active' AND ${VN_DAY("at")} <= ?1
         ) x ON x.id = d.id
         GROUP BY d.id, x.m`,
      )
      .bind(date),
    db
      .prepare(
        `SELECT r.id, r.name, r.active, r.deactivated_at AS deactivatedAt, r.term, x.m AS month, SUM(x.delta) AS delta
         FROM receivables r JOIN (
           SELECT receivable_id AS id, ${VN_MONTH("at")} AS m, amount AS delta FROM receivable_lines
           WHERE status = 'active' AND ${VN_DAY("at")} <= ?1
           UNION ALL
           SELECT receivable_id, ${VN_MONTH("at")}, CASE meaning WHEN 'lend' THEN amount ELSE -amount END FROM transactions
           WHERE receivable_id IS NOT NULL AND meaning IN ('lend', 'collect') AND status = 'active' AND ${VN_DAY("at")} <= ?1
         ) x ON x.id = r.id
         GROUP BY r.id, x.m`,
      )
      .bind(date),
    db
      .prepare(
        `SELECT x.id, x.m AS month, SUM(x.delta) AS delta FROM tenants t JOIN (
           SELECT tenant_id AS id, ${VN_MONTH("at")} AS m, amount AS delta FROM tenant_lines WHERE status = 'active' AND ${VN_DAY("at")} <= ?1
           UNION ALL
           SELECT tenant_id, ${VN_MONTH("at")}, -amount FROM transactions
           WHERE tenant_id IS NOT NULL AND meaning = 'income' AND status = 'active' AND ${VN_DAY("at")} <= ?1
         ) x ON x.id = t.id
         WHERE t.active = 1
         GROUP BY x.id, x.m`,
      )
      .bind(date),
    db
      .prepare(
        `SELECT asset_kind AS id, ${VN_MONTH("at")} AS month, SUM(amount) AS delta FROM transactions
         WHERE meaning = 'buy_asset' AND status = 'active' AND asset_kind IS NOT NULL AND ${VN_DAY("at")} <= ?1
         GROUP BY asset_kind, month`,
      )
      .bind(date),
    ...itemStatements(db, date),
    db.prepare("SELECT k, v FROM config WHERE k IN ('fi_high_interest_bps', 'fi_inflation_bps')"),
  ]);
  const num = (r: Row) => ({ id: String(r.id), month: String(r.month), delta: Number(r.delta) });
  const metas = <T extends { id: string }>(list: Row[], pick: (r: Row) => T) => [...new Map(list.map((r) => [String(r.id), pick(r)])).values()];
  const cfg = Object.fromEntries(rows<{ k: string; v: string }>(config!).map((r) => [r.k, Number(r.v)]));
  const debtRows = rows(debts!);
  const receivableRows = rows(receivables!);
  return {
    accounts: rows(accounts!).map((a) => ({
      id: String(a.id),
      name: String(a.name),
      kind: String(a.kind),
      openingBalance: Number(a.openingBalance),
      openedAt: (a.openedAt as string | null) ?? null,
      active: Boolean(a.active),
      deactivatedAt: (a.deactivatedAt as string | null) ?? null,
    })),
    accountTx: rows(accountTx!).map(num),
    debts: metas(debtRows, (d) => ({
      id: String(d.id),
      name: String(d.name),
      active: Boolean(d.active),
      deactivatedAt: (d.deactivatedAt as string | null) ?? null,
      rateBps: Number(d.rateBps),
      term: d.term as "short" | "long",
      dueDay: (d.dueDay as number | null) ?? null,
    })),
    debtTx: debtRows.map(num),
    receivables: metas(receivableRows, (r) => ({
      id: String(r.id),
      name: String(r.name),
      active: Boolean(r.active),
      deactivatedAt: (r.deactivatedAt as string | null) ?? null,
      term: r.term as "short" | "long",
    })),
    receivableTx: receivableRows.map(num),
    tenantTx: rows(tenants!).map(num),
    appAssets: rows(appAssets!).map(num),
    items: rows(items!).map(toItem),
    values: rows<ValueSrc>(values!),
    lots: rows<LotSrc>(lots!),
    highInterestBps: Number.isInteger(cfg.fi_high_interest_bps) ? cfg.fi_high_interest_bps! : 1500,
    inflationBps: Number.isInteger(cfg.fi_inflation_bps) ? cfg.fi_inflation_bps! : 350,
  };
}

export type BalanceSheet = Sheet & { today: string };

/** `?date=` tuỳ chọn: ngày có thật, không sau hôm nay (giờ VN). */
function sheetDate(date: string | undefined, today: string): string {
  if (date === undefined || date === "") return today;
  if (!isDay(date)) fail("invalid_input", "date có dạng 2026-11-15.");
  if (date > today) fail("future_date", "Ngày xem không được sau hôm nay.");
  return date;
}

/** Bảng cân đối tới cuối ngày `date` (mặc định hôm nay, giờ VN) — UC-1102. */
export async function getBalanceSheet(db: D1Database, date: string | undefined, now: Date): Promise<BalanceSheet> {
  const today = dayKey(now);
  const d = sheetDate(date, today);
  const [src, interest] = await Promise.all([loadSources(db, d), debtInterest(db, d.slice(0, 7))]);
  return { ...sheetAt(src, d, Object.fromEntries(interest.map((i) => [i.debtId, i.expected]))), today };
}

export interface HistoryPoint {
  month: string;
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  change: number | null;
  pyramid: Record<PyramidTier, number>;
}

/**
 * Mỗi cuối tháng một điểm cho `months` tháng gần nhất (tháng đang chạy là hôm nay), bỏ các tháng trước tháng sớm nhất có dữ
 * liệu. Một lần đọc nguồn (loadSources), cộng dồn ở JS — mỗi điểm bằng đúng bảng của ngày đó.
 */
export async function getBalanceHistory(db: D1Database, months: number, now: Date): Promise<{ points: HistoryPoint[] }> {
  if (!Number.isInteger(months) || months < 1 || months > 60) fail("invalid_input", "months là số nguyên 1–60.");
  const today = dayKey(now);
  const src = await loadSources(db, today);
  const first = firstDataMonth(src) ?? monthKey(now);
  const points: HistoryPoint[] = [];
  for (const month of monthsBack(today.slice(0, 7), months)) {
    if (month < first) continue;
    const date = month === today.slice(0, 7) ? today : monthEnd(month);
    const s = sheetAt(src, date);
    const prev = points[points.length - 1];
    points.push({
      month,
      date,
      totalAssets: s.totalAssets,
      totalLiabilities: s.totalLiabilities,
      equity: s.equity,
      change: prev ? s.equity - prev.equity : null,
      pyramid: Object.fromEntries(s.pyramid.map((p) => [p.tier, p.total])) as Record<PyramidTier, number>,
    });
  }
  return { points };
}

/** Cho tab Nợ (UC-1005): Σ giá trị hôm nay của mục nhập tay (`balanceItems`). */
export async function itemsTotal(db: D1Database, today: string): Promise<number> {
  const [items, values, lots] = await db.batch(itemStatements(db, today));
  return rows(items!)
    .map((i) => itemAt(toItem(i), rows<ValueSrc>(values!), rows<LotSrc>(lots!), today))
    .reduce((s, v) => s + (v.present ? v.value! : 0), 0);
}

/** Một mục như ở bảng hôm nay — kết quả của mọi thao tác ghi. */
export async function getItem(db: D1Database, id: string, now: Date): Promise<ItemView> {
  const today = dayKey(now);
  const [items, values, lots] = await db.batch(itemStatements(db, today));
  const item = rows(items!).find((r) => r.id === id) ?? fail("not_found", "Không có mục tài sản này.", 404);
  return itemAt(toItem(item), rows<ValueSrc>(values!), rows<LotSrc>(lots!), today);
}

// ── Kiểm đầu vào ────────────────────────────────────────────────────

function text(b: Input, k: string, max: number, required = false): string | null {
  const v = b[k];
  if (v === undefined || v === null || v === "") return required ? fail("invalid_input", `Thiếu ${k}.`) : null;
  if (typeof v !== "string") return fail("invalid_input", `${k} phải là chuỗi.`);
  return v.trim().slice(0, max) || (required ? fail("invalid_input", `Thiếu ${k}.`) : null);
}

/** Số tiền nguyên ≥ 0 (hoặc > 0); null / thiếu → null. */
function money(b: Input, k: string, positive = false, code = "invalid_amount"): number | null {
  const v = b[k];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v > MAX_AMOUNT || (positive ? v <= 0 : v < 0)) {
    fail(code, positive ? `${k} phải là số nguyên dương (đồng).` : `${k} phải là số nguyên không âm (đồng).`);
  }
  return v as number;
}

/** Ngày 'YYYY-MM-DD' giờ VN, không sau hôm nay. */
function day(b: Input, k: string, today: string, required: boolean): string | null {
  const v = b[k];
  if (v === undefined || v === null || v === "") return required ? fail("invalid_input", `Thiếu ${k}.`) : null;
  if (!isDay(v)) fail("invalid_input", `${k} có dạng 2026-10-01.`);
  if ((v as string) > today) fail("future_date", "Ngày không được sau hôm nay.");
  return v as string;
}

const oneOf = <T extends string>(b: Input, k: string, allowed: readonly T[]): T => {
  const v = b[k];
  return allowed.includes(v as T) ? (v as T) : fail("invalid_input", `${k} phải là một trong: ${allowed.join(", ")}.`);
};

/** Giá chốt lời / cắt lỗ: > 0 hoặc null; có cả hai thì cắt lỗ < chốt lời. */
function targets(b: Input, tpKey: string, slKey: string, current: { tp: number | null; sl: number | null }) {
  const read = (k: string, fallback: number | null) => (has(b, k) ? money(b, k, true, "invalid_target") : fallback);
  const tp = read(tpKey, current.tp);
  const sl = read(slKey, current.sl);
  if (tp !== null && sl !== null && sl >= tp) fail("invalid_target", "Giá cắt lỗ phải thấp hơn giá chốt lời.");
  return { tp, sl };
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

function section(b: Input) {
  if (b.section === "A3") fail("use_receivable_book", "Khoản người khác nợ mình ghi ở sổ phải thu (tab Nợ).");
  return oneOf(b, "section", ITEM_SECTIONS);
}

function assetKind(b: Input): AssetKind | null {
  return b.asset_kind === null || b.asset_kind === undefined || b.asset_kind === "" ? null : oneOf(b, "asset_kind", ASSET_KINDS);
}

function flag(b: Input, k: string): number {
  if (typeof b[k] !== "boolean") fail("invalid_input", `${k} phải là true hoặc false.`);
  return b[k] ? 1 : 0;
}

/** Một dòng định giá từ body (Công thức 1, 2, 7): giá trị cho mục theo giá trị, giá một đơn vị cho mục theo lô. */
interface ValueInsert {
  as_of: string;
  value: number | null;
  unit_price: number | null;
  cashflow: number;
  cashflow_period: "month" | "year" | null;
  expected_return_bps: number | null;
}

function valueRow(measure: "value" | "units", b: Input, today: string): ValueInsert {
  const [want, other] = measure === "value" ? ["value", "unit_price"] : ["unit_price", "value"];
  if (b[other] !== undefined && b[other] !== null) {
    fail("wrong_measure", measure === "value" ? "Mục theo giá trị ghi value, không ghi giá một đơn vị." : "Mục theo lô ghi giá một đơn vị (unit_price), không ghi value.");
  }
  const amount = money(b, want!) ?? fail("invalid_amount", `Thiếu ${want}.`);
  const cashflow = money(b, "cashflow") ?? 0;
  const period = b.cashflow_period === undefined || b.cashflow_period === null || b.cashflow_period === "" ? null : oneOf(b, "cashflow_period", ["month", "year"] as const);
  if (cashflow > 0 && !period) fail("missing_period", "Dòng tiền phải kèm kỳ: tháng hay năm.");
  let expected: number | null = null;
  if (b.expected_return !== undefined && b.expected_return !== null && b.expected_return !== "") {
    const r = b.expected_return;
    if (typeof r !== "number" || !Number.isFinite(r) || r < -100 || r > 1000) fail("invalid_rate", "Lợi suất kỳ vọng phải từ −100 tới 1000 (%/năm).");
    expected = percentToBps(r as number);
  }
  return {
    as_of: day(b, "as_of", today, false) ?? today,
    value: measure === "value" ? amount : null,
    unit_price: measure === "units" ? amount : null,
    cashflow,
    cashflow_period: cashflow > 0 ? period : null,
    expected_return_bps: expected,
  };
}

const insertValue = (db: D1Database, itemId: string, v: ValueInsert, memberId: string | null) =>
  db
    .prepare(
      `INSERT INTO balance_values (item_id, as_of, value, unit_price, cashflow, cashflow_period, expected_return_bps, by_member_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(itemId, v.as_of, v.value, v.unit_price, v.cashflow, v.cashflow_period, v.expected_return_bps, memberId);

async function itemRow(db: D1Database, id: string): Promise<ItemSrc> {
  const r = await db.prepare(`SELECT ${ITEM_COLS} FROM balance_items WHERE id = ?`).bind(id).first<Row>();
  return r ? toItem(r) : fail("not_found", "Không có mục tài sản này.", 404);
}

const hasRows = async (db: D1Database, id: string) =>
  Boolean(await db.prepare("SELECT 1 FROM balance_values WHERE item_id = ?1 UNION ALL SELECT 1 FROM balance_lots WHERE item_id = ?1 LIMIT 1").bind(id).first());

// ── Ghi ─────────────────────────────────────────────────────────────

/**
 * Thêm mục (UC-1101 bước 1). Tiền lỏng mặc định bật ở A1; tài sản đầu tư mặc định tắt ở tầng cố định. Có `value` /
 * `unit_price` thì ghi luôn dòng định giá đầu tiên trong cùng batch.
 */
export async function createItem(db: D1Database, b: Input, memberId: string | null, now: Date): Promise<ItemView> {
  const today = dayKey(now);
  const name = text(b, "name", 60, true)!;
  const sec = section(b);
  const id = text(b, "id", 40) ?? slug(name);
  if (!/^[a-z0-9-]{1,40}$/.test(id)) fail("invalid_id", "Mã chỉ gồm chữ thường, số và gạch nối.");
  const pyramid = oneOf(b, "pyramid", PYRAMID);
  const measure = oneOf(b, "measure", ["value", "units"] as const);
  const unit = text(b, "unit", 20);
  if (measure === "units" && !unit) fail("invalid_input", "Mục theo lô cần đơn vị (chỉ, lượng, cổ phiếu…).");
  const valueOnly = ["cost_basis", "acquired_on", "take_profit_value", "stop_loss_value"].filter((k) => b[k] !== undefined && b[k] !== null);
  if (measure === "units" && valueOnly.length) fail("wrong_measure", "Mục theo lô đặt giá mua, chốt lời / cắt lỗ ở từng lô.");
  const t = targets(b, "take_profit_value", "stop_loss_value", { tp: null, sl: null });
  const first = b.value !== undefined || b.unit_price !== undefined ? valueRow(measure, b, today) : null;
  if (await db.prepare("SELECT 1 FROM balance_items WHERE id = ?").bind(id).first()) fail("duplicate_id", `Đã có mục tài sản mã "${id}".`, 409);
  await db.batch([
    db
      .prepare(
        `INSERT INTO balance_items (id, name, section, pyramid, measure, unit, liquid, investable, asset_kind, cost_basis, acquired_on,
           take_profit_value, stop_loss_value, note, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, name, sec, pyramid, measure, measure === "units" ? unit : null,
        has(b, "liquid") ? flag(b, "liquid") : sec === "A1" ? 1 : 0,
        has(b, "investable") ? flag(b, "investable") : pyramid === "fixed" ? 0 : 1,
        assetKind(b), money(b, "cost_basis"), day(b, "acquired_on", today, false), t.tp, t.sl, text(b, "note", 500),
        has(b, "sort") ? (Number.isInteger(b.sort) ? b.sort : fail("invalid_input", "sort phải là số nguyên.")) : 100,
      ),
    ...(first ? [insertValue(db, id, first, memberId)] : []),
  ]);
  return getItem(db, id, now);
}

/** Sửa tên / mục / tầng / cờ / giá mua / chốt lời, cắt lỗ (áp cho cả lịch sử). Đổi cách tính chỉ khi chưa có dòng nào. */
export async function updateItem(db: D1Database, id: string, b: Input, now: Date): Promise<ItemView> {
  const today = dayKey(now);
  const cur = await itemRow(db, id);
  const cols: [string, unknown][] = [];
  let measure = cur.measure;
  if (has(b, "measure") && b.measure !== cur.measure) {
    measure = oneOf(b, "measure", ["value", "units"] as const);
    if (await hasRows(db, id)) fail("item_has_values", "Mục đã có định giá hoặc lô: không đổi được cách tính.", 409);
    cols.push(["measure", measure]);
  }
  if (has(b, "name")) cols.push(["name", text(b, "name", 60, true)]);
  if (has(b, "section")) cols.push(["section", section(b)]);
  if (has(b, "pyramid")) cols.push(["pyramid", oneOf(b, "pyramid", PYRAMID)]);
  if (has(b, "liquid")) cols.push(["liquid", flag(b, "liquid")]);
  if (has(b, "investable")) cols.push(["investable", flag(b, "investable")]);
  if (has(b, "asset_kind")) cols.push(["asset_kind", assetKind(b)]);
  if (has(b, "note")) cols.push(["note", text(b, "note", 500)]);
  if (has(b, "sort")) cols.push(["sort", Number.isInteger(b.sort) ? b.sort : fail("invalid_input", "sort phải là số nguyên.")]);
  const unit = has(b, "unit") ? text(b, "unit", 20) : cur.unit;
  if (measure === "units" && !unit) fail("invalid_input", "Mục theo lô cần đơn vị (chỉ, lượng, cổ phiếu…).");
  if (has(b, "unit") || measure !== cur.measure) cols.push(["unit", measure === "units" ? unit : null]);
  const valueOnly = ["cost_basis", "acquired_on", "take_profit_value", "stop_loss_value"].filter((k) => has(b, k));
  if (valueOnly.length) {
    if (measure === "units") fail("wrong_measure", "Mục theo lô đặt giá mua, chốt lời / cắt lỗ ở từng lô.");
    if (has(b, "cost_basis")) cols.push(["cost_basis", money(b, "cost_basis")]);
    if (has(b, "acquired_on")) cols.push(["acquired_on", day(b, "acquired_on", today, false)]);
    const t = targets(b, "take_profit_value", "stop_loss_value", { tp: cur.takeProfitValue, sl: cur.stopLossValue });
    cols.push(["take_profit_value", t.tp], ["stop_loss_value", t.sl]);
  }
  if (cols.length) {
    await db
      .prepare(`UPDATE balance_items SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .bind(...cols.map(([, v]) => v), id)
      .run();
  }
  return getItem(db, id, now);
}

/** Xoá mục chỉ khi chưa từng có dòng định giá / lô nào (kể cả đã huỷ). */
export async function deleteItem(db: D1Database, id: string): Promise<{ id: string }> {
  await itemRow(db, id);
  if (await hasRows(db, id)) fail("item_has_values", "Mục đã có định giá hoặc lô: bán lô hoặc ghi giá trị 0 thay vì xoá.", 409);
  await db.prepare("DELETE FROM balance_items WHERE id = ?").bind(id).run();
  return { id };
}

/** Cập nhật giá (UC-1101 bước 3; MCP record_asset_value — UC-606). */
export async function addValue(db: D1Database, itemId: string, b: Input, memberId: string | null, now: Date): Promise<ItemView> {
  const item = await itemRow(db, itemId);
  await insertValue(db, itemId, valueRow(item.measure, b, dayKey(now)), memberId).run();
  return getItem(db, itemId, now);
}

export async function voidValue(db: D1Database, id: number, now: Date): Promise<ItemView> {
  const v = await db.prepare("SELECT item_id AS itemId, status FROM balance_values WHERE id = ?").bind(id).first<{ itemId: string; status: string }>();
  if (!v) fail("not_found", "Không có dòng định giá này.", 404);
  if (v!.status !== "active") fail("already_void", "Dòng này đã huỷ trước đó.", 409);
  await db.prepare("UPDATE balance_values SET status = 'void' WHERE id = ?").bind(id).run();
  return getItem(db, v!.itemId, now);
}

/** Số lượng tới 3 chữ số lẻ → phần nghìn đơn vị. */
function quantityMilli(b: Input): number {
  const q = b.quantity;
  if (typeof q !== "number" || !Number.isFinite(q) || q <= 0) fail("invalid_amount", "Số lượng phải lớn hơn 0.");
  const milli = Math.round((q as number) * 1000);
  if (Math.abs(milli - (q as number) * 1000) > 1e-6 || milli <= 0 || milli > MAX_AMOUNT) fail("invalid_amount", "Số lượng tối đa 3 chữ số lẻ.");
  return milli;
}

export async function addLot(db: D1Database, itemId: string, b: Input, memberId: string | null, now: Date): Promise<ItemView> {
  const today = dayKey(now);
  const item = await itemRow(db, itemId);
  if (item.measure !== "units") fail("wrong_measure", "Mục theo giá trị không có lô — cập nhật giá trị cả mục.");
  const boughtOn = day(b, "bought_on", today, true)!;
  const milli = quantityMilli(b);
  const unitCost = money(b, "unit_cost") ?? fail("invalid_amount", "Thiếu giá mua một đơn vị (unit_cost).");
  const t = targets(b, "take_profit_price", "stop_loss_price", { tp: null, sl: null });
  await db
    .prepare(
      `INSERT INTO balance_lots (item_id, bought_on, quantity_milli, unit_cost, take_profit_price, stop_loss_price, note, by_member_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(itemId, boughtOn, milli, unitCost, t.tp, t.sl, text(b, "note", 500), memberId)
    .run();
  return getItem(db, itemId, now);
}

async function lotRow(db: D1Database, id: number) {
  const lot = await db.prepare(`SELECT ${LOT_COLS}, status FROM balance_lots WHERE id = ?`).bind(id).first<LotSrc & { status: string }>();
  return lot ?? fail("not_found", "Không có lô này.", 404);
}

/** Giá chốt lời / cắt lỗ của lô đang giữ (sửa tự do, null = bỏ). */
export async function updateLotTargets(db: D1Database, id: number, b: Input, now: Date): Promise<ItemView> {
  const lot = await lotRow(db, id);
  if (lot.status !== "active" || lot.soldOn !== null) fail("invalid_sale", "Lô đã bán hoặc đã huỷ: không đặt giá được.");
  const t = targets(b, "take_profit_price", "stop_loss_price", { tp: lot.takeProfitPrice, sl: lot.stopLossPrice });
  await db.prepare("UPDATE balance_lots SET take_profit_price = ?, stop_loss_price = ? WHERE id = ?").bind(t.tp, t.sl, id).run();
  return getItem(db, lot.itemId, now);
}

/** Bán cả lô một lần (ngày bán ≥ ngày mua). Không ghi giao dịch nào — tiền bán về ghi ở sổ như mọi khoản khác. */
export async function sellLot(db: D1Database, id: number, b: Input, now: Date): Promise<ItemView> {
  const lot = await lotRow(db, id);
  if (lot.status !== "active" || lot.soldOn !== null) fail("invalid_sale", "Lô này đã bán hoặc đã huỷ.");
  const soldOn = day(b, "sold_on", dayKey(now), true)!;
  if (soldOn < lot.boughtOn) fail("invalid_sale", "Ngày bán phải từ ngày mua trở đi.");
  const price = money(b, "sold_unit_price") ?? fail("invalid_amount", "Thiếu giá bán một đơn vị (sold_unit_price).");
  await db.prepare("UPDATE balance_lots SET sold_on = ?, sold_unit_price = ? WHERE id = ? AND sold_on IS NULL").bind(soldOn, price, id).run();
  return getItem(db, lot.itemId, now);
}

export async function voidLot(db: D1Database, id: number, now: Date): Promise<ItemView> {
  const lot = await lotRow(db, id);
  if (lot.status !== "active") fail("already_void", "Lô này đã huỷ trước đó.", 409);
  await db.prepare("UPDATE balance_lots SET status = 'void' WHERE id = ?").bind(id).run();
  return getItem(db, lot.itemId, now);
}
