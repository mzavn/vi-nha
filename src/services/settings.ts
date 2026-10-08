// Màn Cài đặt: tài khoản, ví + luật nạp, thành viên, mã chuyển khoản, tham số, khoá kết nối SePay/Telegram/Zalo.
// Mọi thay đổi ở đây là cấu hình, không phải sổ: không đụng tới transactions hay bank_logs — trừ một bút toán hệ thống
// khi một tài khoản thành tài khoản Tích sản với số dư có sẵn (ADR-91, `wealthBuildingOpeningEntry` của ledger).

import { bankByCode } from "../domain/banks";
import { clockMinutes, NOTIFY_CONFIG_KEYS, parseNotifySchedule, type NotifySchedule } from "../domain/notify-schedule";
import { dayKey } from "../domain/period";
import { DomainError } from "../domain/types";
import type { Env } from "../env";
import { escapeHtml, sendTelegram } from "../notify/telegram";
import { syncSepay } from "../cron/backfill";
import { DEFAULT_SEPAY_CONNECTION_ID } from "../domain/system-ids";
import { describeSecret, getSecret, loadSepayConnections, SECRET_NAMES, setSecret, type SecretName, type SepayConnection } from "./secrets";
import { wealthBuildingOpeningEntry } from "./ledger";
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from "./passwords";
import { listBankAccounts, listTransactions, sepayErrorText, type SepayBankAccount } from "./sepay-api";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400, field?: string): never => {
  throw new DomainError(code, message, status, field);
};

// ── Kiểm tra đầu vào ────────────────────────────────────────────────
type Input = Record<string, unknown>;
const has = (b: Input, k: string) => Object.prototype.hasOwnProperty.call(b, k);
function text(b: Input, k: string, opts: { required?: boolean; max?: number } = {}): string | null {
  const v = b[k];
  if (v === undefined || v === null || v === "") return opts.required ? fail("invalid_input", `Thiếu ${k}.`) : null;
  if (typeof v !== "string") return fail("invalid_input", `${k} phải là chuỗi.`);
  return v.trim().slice(0, opts.max ?? 120);
}
function integer(b: Input, k: string, opts: { min?: number; max?: number } = {}): number | null {
  const v = b[k];
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "number" || !Number.isInteger(v)) return fail("invalid_input", `${k} phải là số nguyên.`);
  if ((opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max)) fail("invalid_input", `${k} ngoài khoảng cho phép.`);
  return v;
}
const bool = (b: Input, k: string) => (b[k] === undefined ? null : b[k] === true);
function oneOf<T extends string>(b: Input, k: string, allowed: readonly T[], required = false): T | null {
  const v = text(b, k, { required });
  if (v !== null && !allowed.includes(v as T)) fail("invalid_input", `${k} phải là một trong: ${allowed.join(", ")}.`);
  return v as T | null;
}
/** Mã sinh từ tên (bỏ dấu, chữ thường, gạch nối) — tài khoản, ví, thành viên, nguồn thu. */
export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
const newId = (b: Input, name: string) => {
  const id = text(b, "id") ?? slug(name);
  if (!/^[a-z0-9-]{1,40}$/.test(id)) fail("invalid_id", "Mã chỉ gồm chữ thường, số và gạch nối.");
  return id;
};
const exists = async (db: D1Database, table: "accounts" | "wallets" | "members" | "categories" | "income_streams", id: string | null) =>
  id === null || Boolean(await db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).bind(id).first());

/** Câu UPDATE chỉ với các cột có trong input; không có cột nào thì null. */
function patchStatement(db: D1Database, table: string, id: string | number, cols: Record<string, unknown>): D1PreparedStatement | null {
  const entries = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return null;
  return db
    .prepare(`UPDATE ${table} SET ${entries.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .bind(...entries.map(([, v]) => (typeof v === "boolean" ? (v ? 1 : 0) : v)), id);
}

async function patchRow(db: D1Database, table: string, id: string | number, cols: Record<string, unknown>) {
  await patchStatement(db, table, id, cols)?.run();
}

// ── Đọc ─────────────────────────────────────────────────────────────
const ACCOUNT_SQL =
  "SELECT id, name, kind, bank, account_no, sub_account, sepay_enabled, sepay_out, sepay_connection_id, owner_member_id, opening_balance, opened_at, active, locked, spendable, role, (SELECT b.book_balance FROM v_account_book b WHERE b.account_id = accounts.id) AS book_balance FROM accounts";
const toAccount = (r: Row) => ({
  ...r,
  id: String(r.id),
  sepay_enabled: Boolean(r.sepay_enabled),
  sepay_out: Boolean(r.sepay_out),
  active: Boolean(r.active),
  locked: Boolean(r.locked),
  spendable: Boolean(r.spendable),
});

const WALLET_SQL = `SELECT w.id, w.name, w.tier, w.must_group, w.kind, w.scope, w.member_id, w.account_id, w.private, w.sort, w.active,
  a.mode, a.period, a.amount, a.percent, a.target_amount, a.target_date, a.floor_amount, a.priority, a.split_weekly
  FROM wallets w LEFT JOIN allocations a ON a.wallet_id = w.id AND a.active = 1`;
const toWallet = (r: Row) => ({
  id: r.id,
  name: r.name,
  tier: r.tier,
  must_group: r.must_group,
  kind: r.kind,
  scope: r.scope,
  member_id: r.member_id,
  account_id: r.account_id,
  private: Boolean(r.private),
  sort: r.sort,
  active: Boolean(r.active),
  allocation: r.mode
    ? {
        mode: r.mode,
        period: r.period,
        amount: r.amount,
        percent: r.percent,
        target_amount: r.target_amount,
        target_date: r.target_date,
        floor_amount: r.floor_amount,
        priority: r.priority,
        splitWeekly: Boolean(r.split_weekly),
      }
    : null,
});
const toRule = (r: Row) => ({ ...r, is_salary: Boolean(r.is_salary), active: Boolean(r.active), incomeStreamId: r.income_stream_id ?? null });

const STREAM_SQL = "SELECT id, name, sort, active FROM income_streams ORDER BY sort, name";
const LOCK_SQL = "SELECT stream_id, wallet_id, percent FROM income_stream_locks ORDER BY sort, wallet_id";
const toStreams = (streams: Row[], locks: Row[]) =>
  streams.map((s) => ({
    id: s.id as string,
    name: s.name as string,
    sort: Number(s.sort),
    active: Boolean(s.active),
    locks: locks.filter((l) => l.stream_id === s.id).map((l) => ({ walletId: l.wallet_id as string, percent: Number(l.percent) })),
  }));

/** Giờ nhắc của cả nhà, một câu SELECT; khoá thiếu/hỏng thì lấy mặc định (cùng cách cron đọc). */
async function readNotifySchedule(db: D1Database): Promise<NotifySchedule> {
  const keys = Object.values(NOTIFY_CONFIG_KEYS);
  const res = await db
    .prepare(`SELECT k, v FROM config WHERE k IN (${keys.map(() => "?").join(", ")})`)
    .bind(...keys)
    .all<{ k: string; v: string }>();
  return parseNotifySchedule(Object.fromEntries(rows<{ k: string; v: string }>(res).map((r) => [r.k, r.v])));
}

async function configNumber(db: D1Database, k: string, fallback: number) {
  const row = await db.prepare("SELECT v FROM config WHERE k = ?").bind(k).first<{ v: string }>();
  const n = row ? Number(row.v) : NaN;
  return Number.isInteger(n) ? n : fallback;
}

export async function getSettings(env: Env, origin: string) {
  const db = env.DB;
  const [accounts, wallets, members, rules, categories, streams, locks] = await db.batch([
    db.prepare(`${ACCOUNT_SQL} ORDER BY active DESC, kind, name`),
    db.prepare(`${WALLET_SQL} ORDER BY w.sort, w.name`),
    db.prepare(`SELECT ${MEMBER_COLS} FROM members ORDER BY role = 'owner' DESC, name`),
    db.prepare("SELECT * FROM rules ORDER BY active DESC, priority, id"),
    db.prepare("SELECT id, name, default_wallet_id AS defaultWalletId FROM categories WHERE active = 1 ORDER BY sort, name"),
    db.prepare(STREAM_SQL),
    db.prepare(LOCK_SQL),
  ]);
  const secrets = Object.fromEntries(await Promise.all(SECRET_NAMES.map(async (n) => [n, await describeSecret(env, n)] as const)));
  const accountRows = rows(accounts!);
  const connections = (await loadSepayConnections(env)).map((c) => connectionView(c, accountRows));
  return {
    accounts: accountRows.map(toAccount),
    wallets: rows(wallets!).map(toWallet),
    members: rows<MemberRow>(members!).map(toMember),
    rules: rows(rules!).map(toRule),
    categories: rows(categories!),
    incomeStreams: toStreams(rows(streams!), rows(locks!)),
    config: {
      salary_min_amount: await configNumber(db, "salary_min_amount", 1_000_000),
      safety_fund_months: await configNumber(db, "safety_fund_months", 6),
    },
    notifySchedule: await readNotifySchedule(db),
    integrations: { webhook_url: `${origin}/webhooks/sepay`, zalo_webhook_url: `${origin}/webhooks/zalo`, ...secrets, sepay_connections: connections },
  };
}

// ── Tài khoản ───────────────────────────────────────────────────────
export const ACCOUNT_KINDS = ["bank", "cash", "ewallet", "credit"] as const;
/** Tài khoản ngân hàng / thẻ chỉ nhận mã trong danh mục ngân hàng (ADR-66); ví điện tử, tiền mặt giữ tên tự do. */
export const bankOk = (kind: string, bank: string | null) => (kind !== "bank" && kind !== "credit") || bank === null || Boolean(bankByCode(bank));
/** Tài khoản Tích sản (ADR-88). Heo đất chỉ do migration tạo; sổ tiết kiệm chỉ đặt lúc thêm (khóa từ đầu). */
const ACCOUNT_ROLES = ["piggy_bank", "buffer", "term_deposit"] as const;
const LOCKED_SPENDABLE = "Tài khoản đã khóa (heo đất, sổ tiết kiệm) không tính vào tiền chi được.";

async function accountFields(db: D1Database, b: Input, currentId: string | null) {
  const accountNo = has(b, "account_no") ? text(b, "account_no", { max: 40 }) : undefined;
  if (accountNo) {
    const clash = await db.prepare("SELECT id FROM accounts WHERE account_no = ? AND id <> ?").bind(accountNo, currentId ?? "").first();
    if (clash) fail("duplicate", "Số tài khoản này đã có trong danh sách.", 409);
  }
  const owner = has(b, "owner_member_id") ? text(b, "owner_member_id") : undefined;
  // Không gắn chủ (null) = tài khoản chung của nhà, vd ví tiền mặt chung.
  if (owner && !(await exists(db, "members", owner))) fail("unknown_member", "Không có thành viên này.");
  // Ngày mở sổ là mốc so ngày giao dịch (ADR-76): phải là ngày có thật dạng YYYY-MM-DD thì so chuỗi mới đúng.
  const openedAt = has(b, "opened_at") ? text(b, "opened_at", { max: 10 }) : undefined;
  if (openedAt && calendarDay(openedAt) === null) fail("invalid_input", "opened_at có dạng 2026-10-01.");
  return {
    name: has(b, "name") ? text(b, "name", { required: true, max: 60 }) : undefined,
    kind: has(b, "kind") ? oneOf(b, "kind", ACCOUNT_KINDS, true) : undefined,
    bank: has(b, "bank") ? text(b, "bank", { max: 40 }) : undefined,
    account_no: accountNo,
    sub_account: has(b, "sub_account") ? text(b, "sub_account", { max: 60 }) : undefined,
    sepay_enabled: has(b, "sepay_enabled") ? bool(b, "sepay_enabled") : undefined,
    sepay_out: has(b, "sepay_out") ? bool(b, "sepay_out") : undefined,
    sepay_connection_id: has(b, "sepay_connection_id") ? text(b, "sepay_connection_id", { max: 40 }) : undefined,
    owner_member_id: owner,
    opening_balance: has(b, "opening_balance") ? integer(b, "opening_balance", { min: -1e12, max: 1e12 }) ?? 0 : undefined,
    opened_at: openedAt,
    active: has(b, "active") ? bool(b, "active") : undefined,
    spendable: has(b, "spendable") ? bool(b, "spendable") : undefined,
    role: has(b, "role") ? oneOf(b, "role", ACCOUNT_ROLES) : undefined,
  };
}

/**
 * Ngân hàng và SePay sau khi ghép input với giá trị cũ (ADR-66). Tài khoản ngân hàng/thẻ chỉ nhận mã trong danh mục;
 * ví điện tử giữ tên tự do. Chỉ kiểm khi bật SePay hoặc đổi ngân hàng/loại, để sửa một tài khoản cũ (tên ngân hàng gõ tay,
 * hay đã nối SePay trước khi có danh mục) mà không đụng hai cột này thì không bị chặn.
 * `sepay_out` mặc định theo tài liệu SePay lúc bật SePay; chủ nhà được bật tay (đã thử thấy tiền ra về app); tắt SePay thì về 0.
 */
function sepayFields(
  f: { kind?: string | null; bank?: string | null; sepay_enabled?: boolean | null; sepay_out?: boolean | null },
  current: { kind: string; bank: string | null; sepay_enabled: boolean; sepay_out: boolean },
) {
  const kind = f.kind ?? current.kind;
  const bank = f.bank === undefined ? current.bank : f.bank;
  const enabled = f.sepay_enabled ?? current.sepay_enabled;
  const turningOn = enabled && !current.sepay_enabled;
  const touched = (f.bank !== undefined && f.bank !== current.bank) || (f.kind != null && f.kind !== current.kind);
  if (touched && !bankOk(kind, bank)) {
    fail("invalid_bank", "Ngân hàng phải chọn trong danh sách.");
  }
  const sepay = bankByCode(bank)?.sepay ?? null;
  if (enabled && (turningOn || touched) && (kind !== "bank" || !sepay)) {
    fail("bank_not_supported", "SePay chưa hỗ trợ ngân hàng này.");
  }
  const out = !enabled ? false : (f.sepay_out ?? (turningOn ? Boolean(sepay?.out) : current.sepay_out));
  return { sepay_out: out };
}

/**
 * Kết nối SePay của tài khoản sau khi ghép input (ADR-75): bật SePay thì thuộc đúng một kết nối — không chọn thì giữ kết nối
 * cũ, chưa có thì về kết nối mặc định; tắt SePay thì bỏ. Chỉ kiểm kết nối có thật và đang bật khi nó vừa được chọn / gán.
 */
async function sepayConnectionId(db: D1Database, enabled: boolean, requested: string | null | undefined, current: string | null): Promise<string | null> {
  if (!enabled) return null;
  const id = requested || current || DEFAULT_SEPAY_CONNECTION_ID;
  if (id !== current && !(await db.prepare("SELECT 1 FROM sepay_connections WHERE id = ? AND active = 1").bind(id).first())) {
    fail("unknown_connection", "Không có kết nối SePay này, hoặc kết nối đang tắt.");
  }
  return id;
}

export async function createAccount(db: D1Database, b: Input) {
  const name = text(b, "name", { required: true, max: 60 })!;
  const id = newId(b, name);
  if (await db.prepare("SELECT 1 FROM accounts WHERE id = ?").bind(id).first()) fail("duplicate", "Đã có tài khoản với mã này.", 409);
  const f = await accountFields(db, { kind: "bank", ...b, name }, null);
  if (f.sepay_enabled && !f.account_no) fail("missing_account_no", "Bật SePay thì cần số tài khoản để nhận diện giao dịch.");
  const { sepay_out } = sepayFields(f, { kind: "bank", bank: null, sepay_enabled: false, sepay_out: false });
  const connectionId = await sepayConnectionId(db, Boolean(f.sepay_enabled), f.sepay_connection_id, null);
  if (f.role === "piggy_bank") fail("invalid_role", "Heo đất do app tạo, không thêm tay được.");
  const locked = f.role === "term_deposit";
  if (locked && f.spendable) fail("locked_account", LOCKED_SPENDABLE);
  // Không gửi "Tính vào tiền chi được" thì bật, trừ thẻ tín dụng (số dư thẻ là nợ phải trả — ADR-85) và tài khoản
  // Tích sản (phao, sổ tiết kiệm — ADR-88): tiền ở đó là để dành, không để tiêu.
  const spendable = !locked && (f.spendable ?? (f.kind !== "credit" && !f.role));
  // Tài khoản Tích sản không tính mở với số dư có sẵn: phần chưa là Tích sản vào Tích sản cùng lúc (ADR-91).
  const opening = f.role && !spendable ? await wealthBuildingOpeningEntry(db, { id, name: f.name!, balance: f.opening_balance ?? 0 }, new Date()) : null;
  await db.batch([
    db
      .prepare(
        `INSERT INTO accounts (id, name, kind, bank, account_no, sub_account, sepay_enabled, sepay_out, sepay_connection_id, owner_member_id, opening_balance, opened_at, spendable, locked, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?)`,
      )
      .bind(
        id, f.name, f.kind, f.bank ?? null, f.account_no ?? null, f.sub_account ?? null, f.sepay_enabled ? 1 : 0, sepay_out ? 1 : 0, connectionId,
        f.owner_member_id ?? null, f.opening_balance ?? 0, f.opened_at ?? null, spendable ? 1 : 0, locked ? 1 : 0, f.role ?? null,
      ),
    ...(opening ? [opening] : []),
  ]);
  return toAccount((await db.prepare(`${ACCOUNT_SQL} WHERE id = ?`).bind(id).first<Row>())!);
}

export async function updateAccount(db: D1Database, id: string, b: Input) {
  const current = await db.prepare(`${ACCOUNT_SQL} WHERE id = ?`).bind(id).first<Row>();
  if (!current) fail("not_found", "Không có tài khoản này.", 404);
  const f = await accountFields(db, b, id);
  const sepayOn = f.sepay_enabled ?? Boolean(current!.sepay_enabled);
  const accountNo = f.account_no === undefined ? (current!.account_no as string | null) : f.account_no;
  if (sepayOn && !accountNo) fail("missing_account_no", "Bật SePay thì cần số tài khoản để nhận diện giao dịch.");
  const { sepay_out } = sepayFields(f, {
    kind: current!.kind as string,
    bank: (current!.bank as string | null) ?? null,
    sepay_enabled: Boolean(current!.sepay_enabled),
    sepay_out: Boolean(current!.sepay_out),
  });
  const connectionId = await sepayConnectionId(db, sepayOn, f.sepay_connection_id, (current!.sepay_connection_id as string | null) ?? null);
  if (f.spendable && current!.locked) fail("locked_account", LOCKED_SPENDABLE);
  // Chỉ đổi qua lại tài khoản thường ↔ phao (không khóa); heo đất và sổ tiết kiệm giữ vai trò từ lúc tạo (ADR-88).
  const roleChanged = f.role !== undefined && f.role !== current!.role;
  if (roleChanged && (current!.locked || f.role === "piggy_bank" || f.role === "term_deposit")) {
    fail("invalid_role", "Chỉ đổi được giữa tài khoản thường và phao dự phòng; heo đất và sổ tiết kiệm giữ nguyên.");
  }
  // Sang phao mà không nói gì về "Tính vào tiền chi được" thì tắt: tiền phao là để dành.
  const spendable = f.spendable ?? (roleChanged && f.role === "buffer" ? false : undefined);
  if (f.active === false) {
    const used = await db.prepare("SELECT 1 FROM wallets WHERE account_id = ? AND active = 1").bind(id).first();
    if (used) fail("in_use", "Còn ví đang trú ở tài khoản này; chuyển ví sang tài khoản khác trước.", 409);
  }
  // Tài khoản thường thành phao (không tính) mà đang có tiền: phần chưa là Tích sản vào Tích sản cùng lúc (ADR-91).
  // Đổi phao về thường không gỡ bút toán đó.
  const becomesOutside = roleChanged && f.role !== null && !(spendable ?? Boolean(current!.spendable)) && (f.active ?? Boolean(current!.active));
  const balance = Number(current!.book_balance ?? 0) + (f.opening_balance == null ? 0 : f.opening_balance - Number(current!.opening_balance));
  const opening = becomesOutside ? await wealthBuildingOpeningEntry(db, { id, name: f.name ?? String(current!.name), balance }, new Date()) : null;
  const patch = patchStatement(db, "accounts", id, { ...f, spendable, sepay_out, sepay_connection_id: connectionId });
  const writes = [patch, opening].filter((s): s is D1PreparedStatement => s !== null);
  if (writes.length > 0) await db.batch(writes);
  return toAccount((await db.prepare(`${ACCOUNT_SQL} WHERE id = ?`).bind(id).first<Row>())!);
}

// ── Ví + luật nạp ───────────────────────────────────────────────────
const TIERS = ["wealth_building", "tax", "nice", "must"] as const;
const WALLET_KINDS = ["envelope", "accrual", "bill"] as const;
const MODES = ["flat", "percent", "goal", "lump"] as const; // 'remainder' chỉ có một, do seed, không tạo/đổi từ đây

function allocationFields(a: Input) {
  const f = {
    period: has(a, "period") ? oneOf(a, "period", ["week", "month"] as const) : undefined,
    amount: has(a, "amount") ? integer(a, "amount", { min: 0, max: 1e12 }) : undefined,
    percent: undefined as number | null | undefined,
    target_amount: has(a, "target_amount") ? integer(a, "target_amount", { min: 0, max: 1e12 }) : undefined,
    target_date: has(a, "target_date") ? text(a, "target_date", { max: 10 }) : undefined,
    floor_amount: has(a, "floor_amount") ? integer(a, "floor_amount", { min: 0, max: 1e12 }) : undefined,
    priority: has(a, "priority") ? integer(a, "priority", { min: 0, max: 1000 }) ?? 100 : undefined,
    split_weekly: has(a, "split_weekly") ? bool(a, "split_weekly") : undefined,
  };
  if (has(a, "percent")) {
    const p = a.percent;
    if (p !== null && (typeof p !== "number" || !(p >= 0 && p <= 1))) fail("invalid_input", "percent là tỷ lệ từ 0 đến 1 (0.3 = 30%).");
    f.percent = p as number | null;
  }
  if (f.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.target_date)) fail("invalid_input", "target_date có dạng 2026-12-31.");
  return f;
}

/** Kiểm tra luật nạp sau khi ghép với giá trị cũ — đúng các CHECK của bảng allocations, báo lỗi dễ hiểu. */
function checkAllocation(a: Record<string, unknown>) {
  if (a.mode === "flat" && a.amount == null) fail("invalid_allocation", "Nạp cố định cần số tiền.");
  if (a.mode === "percent" && a.percent == null) fail("invalid_allocation", "Nạp theo phần trăm cần tỷ lệ.");
  if (a.mode === "goal" && (a.target_amount == null || a.target_date == null)) fail("invalid_allocation", "Mục tiêu cần số tiền đích và hạn.");
  if (a.mode === "lump" && a.amount == null && a.target_amount == null) fail("invalid_allocation", "Trả cục cần số tiền.");
}

/** Chia đều theo tuần chỉ có nghĩa với phong bì nạp theo tháng; đổi sang luật khác thì tự tắt. */
function splitWeekly(kind: unknown, a: Record<string, unknown>, requested: boolean | null | undefined): boolean {
  const eligible = kind === "envelope" && (a.mode === "flat" || a.mode === "lump") && a.period !== "week";
  if (requested && !eligible) fail("invalid_allocation", "Chỉ phong bì nạp theo tháng mới chia đều theo tuần được.");
  return eligible && Boolean(requested ?? a.split_weekly);
}

/** Kiểm tra TRƯỚC khi ghi: tổng phần trăm Tích sản + Thuế sau thay đổi không được vượt 100% thu nhập. */
async function percentTotalOk(db: D1Database, walletId: string, tier: unknown, mode: unknown, percent: unknown) {
  const r = await db
    .prepare(
      "SELECT COALESCE(SUM(a.percent), 0) AS p FROM allocations a JOIN wallets w ON w.id = a.wallet_id WHERE a.active = 1 AND w.active = 1 AND a.mode = 'percent' AND w.tier IN ('wealth_building','tax') AND w.id <> ?",
    )
    .bind(walletId)
    .first<{ p: number }>();
  const mine = mode === "percent" && (tier === "wealth_building" || tier === "tax") ? Number(percent ?? 0) : 0;
  if (Number(r?.p ?? 0) + mine > 1) fail("invalid_allocation", "Tổng phần trăm Tích sản + Thuế vượt 100% thu nhập.");
}

export async function createWallet(db: D1Database, b: Input) {
  const name = text(b, "name", { required: true, max: 60 })!;
  const id = newId(b, name);
  if (await db.prepare("SELECT 1 FROM wallets WHERE id = ?").bind(id).first()) fail("duplicate", "Đã có ví với mã này.", 409);
  const tier = oneOf(b, "tier", TIERS, true)!;
  const mustGroup = tier === "must" ? oneOf(b, "must_group", ["must", "have"] as const, true) : null;
  if (tier === "wealth_building" && (await db.prepare("SELECT 1 FROM wallets WHERE tier = 'wealth_building' AND active = 1").first())) {
    fail("one_wealth_building", "Tích sản là MỘT ví; không tạo ví Tích sản thứ hai.", 409);
  }
  const kind = oneOf(b, "kind", WALLET_KINDS, true)!;
  const scope = oneOf(b, "scope", ["shared", "personal"] as const) ?? "shared";
  const memberId = text(b, "member_id");
  if (scope === "personal" && !memberId) fail("invalid_input", "Ví cá nhân cần chọn thành viên.");
  if (!(await exists(db, "members", memberId))) fail("unknown_member", "Không có thành viên này.");
  const accountId = text(b, "account_id");
  if (!(await exists(db, "accounts", accountId))) fail("unknown_account", "Không có tài khoản này.");

  const alloc = (b.allocation ?? null) as Input | null;
  const statements = [
    db
      .prepare("INSERT INTO wallets (id, name, tier, must_group, kind, scope, member_id, account_id, private, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, name, tier, mustGroup, kind, scope, scope === "personal" ? memberId : null, accountId, bool(b, "private") ? 1 : 0, integer(b, "sort", { min: 0, max: 10000 }) ?? 100),
  ];
  if (alloc) {
    const mode = oneOf(alloc, "mode", MODES, true)!;
    const f = allocationFields(alloc);
    const merged: Record<string, unknown> = { mode, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v ?? null])) };
    checkAllocation(merged);
    merged.split_weekly = splitWeekly(kind, merged, f.split_weekly);
    await percentTotalOk(db, id, tier, mode, merged.percent);
    statements.push(
      db
        .prepare("INSERT INTO allocations (wallet_id, mode, period, amount, percent, target_amount, target_date, floor_amount, priority, split_weekly) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, mode, merged.period ?? null, merged.amount ?? null, merged.percent ?? null, merged.target_amount ?? null, merged.target_date ?? null, merged.floor_amount ?? null, merged.priority ?? 100, merged.split_weekly ? 1 : 0),
    );
  }
  await db.batch(statements);
  return toWallet((await db.prepare(`${WALLET_SQL} WHERE w.id = ?`).bind(id).first<Row>())!);
}

export async function updateWallet(db: D1Database, id: string, b: Input) {
  const current = await db.prepare(`${WALLET_SQL} WHERE w.id = ?`).bind(id).first<Row>();
  if (!current) fail("not_found", "Không có ví này.", 404);
  const accountId = has(b, "account_id") ? text(b, "account_id") : undefined;
  if (accountId !== undefined && !(await exists(db, "accounts", accountId))) fail("unknown_account", "Không có tài khoản này.");
  const memberId = has(b, "member_id") ? text(b, "member_id") : undefined;
  if (memberId !== undefined && !(await exists(db, "members", memberId))) fail("unknown_member", "Không có thành viên này.");
  const active = has(b, "active") ? bool(b, "active") : undefined;
  if (active === false && (current!.mode === "remainder" || current!.tier === "wealth_building" || current!.tier === "holding")) {
    fail("required_wallet", "Không tắt được ví Thu nhập, Tích sản hay ví nhận phần còn lại.", 409);
  }
  await patchRow(db, "wallets", id, {
    name: has(b, "name") ? text(b, "name", { required: true, max: 60 }) : undefined,
    account_id: accountId,
    member_id: current!.scope === "personal" ? memberId : undefined,
    private: has(b, "private") ? bool(b, "private") : undefined,
    sort: has(b, "sort") ? integer(b, "sort", { min: 0, max: 10000 }) : undefined,
    active,
  });

  if (b.allocation && typeof b.allocation === "object") {
    const a = b.allocation as Input;
    const currentMode = current!.mode as string | null;
    if (currentMode === "remainder") {
      if (has(a, "mode") && a.mode !== "remainder") fail("remainder_fixed", "Ví nhận phần còn lại luôn nhận phần còn lại; không đổi cách nạp được.", 409);
      if (has(a, "priority")) await patchRow(db, "allocations", await allocationId(db, id), { priority: integer(a, "priority", { min: 0, max: 1000 }) });
    } else {
      const mode = has(a, "mode") ? oneOf(a, "mode", MODES, true)! : currentMode;
      if (!mode) fail("invalid_allocation", "Ví này chưa có luật nạp; chọn cách nạp.");
      const f = allocationFields(a);
      const merged: Record<string, unknown> = {
        mode,
        period: current!.period,
        amount: current!.amount,
        percent: current!.percent,
        target_amount: current!.target_amount,
        target_date: current!.target_date,
        floor_amount: current!.floor_amount,
        priority: current!.priority ?? 100,
        split_weekly: Boolean(current!.split_weekly),
        ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)),
      };
      checkAllocation(merged);
      merged.split_weekly = splitWeekly(current!.kind, merged, f.split_weekly);
      await percentTotalOk(db, id, current!.tier, merged.mode, merged.percent);
      if (currentMode) {
        await patchRow(db, "allocations", await allocationId(db, id), merged);
      } else {
        await db
          .prepare("INSERT INTO allocations (wallet_id, mode, period, amount, percent, target_amount, target_date, floor_amount, priority, split_weekly) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, merged.mode, merged.period ?? null, merged.amount ?? null, merged.percent ?? null, merged.target_amount ?? null, merged.target_date ?? null, merged.floor_amount ?? null, merged.priority ?? 100, merged.split_weekly ? 1 : 0)
          .run();
      }
    }
  }
  return toWallet((await db.prepare(`${WALLET_SQL} WHERE w.id = ?`).bind(id).first<Row>())!);
}

async function allocationId(db: D1Database, walletId: string): Promise<number> {
  const r = await db.prepare("SELECT id FROM allocations WHERE wallet_id = ? AND active = 1 LIMIT 1").bind(walletId).first<{ id: number }>();
  return r?.id ?? fail("not_found", "Ví này chưa có luật nạp.", 404);
}

// ── Thành viên ──────────────────────────────────────────────────────
/** Tối đa 6 người đang hoạt động, ngang quyền (BR-08). */
export const MAX_ACTIVE_MEMBERS = 6;
export const MEMBER_NAME_MAX = 40;
const MEMBER_COLS = "id, name, role, tg_chat_id, zalo_chat_id, active, password_hash IS NOT NULL AS has_password";
type MemberRow = Omit<MemberView, "active" | "has_password"> & { active: number; has_password: number };
const toMember = (m: MemberRow): MemberView => ({ ...m, active: Boolean(m.active), has_password: Boolean(m.has_password) });
/** `has_password` cho biết người đó vào bằng mật khẩu riêng; không bao giờ trả băm, muối hay số vòng (UC-507). */
export type MemberView = {
  id: string;
  name: string;
  role: string;
  tg_chat_id: string | null;
  zalo_chat_id: string | null;
  active: boolean;
  has_password: boolean;
};

/** Một thành viên như màn Cài đặt thấy; không có → null. */
export async function readMember(db: D1Database, id: string): Promise<MemberView | null> {
  const m = await db.prepare(`SELECT ${MEMBER_COLS} FROM members WHERE id = ?`).bind(id).first<MemberRow>();
  return m ? toMember(m) : null;
}

/** Tên so trùng không phân biệt hoa thường, bỏ dấu cách hai đầu (thành viên, tài khoản lúc thiết lập). */
export const nameKey = (name: string) => name.trim().toLocaleLowerCase("vi");

/** Tên thành viên: chuỗi, bỏ dấu cách hai đầu, 1–40 ký tự, ra được mã. Lỗi gắn `field`. */
export function memberName(v: unknown, field: string): { name: string; id: string } {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name) fail("invalid_input", "Nhập tên.", 400, field);
  if (name.length > MEMBER_NAME_MAX) fail("invalid_input", `Tên tối đa ${MEMBER_NAME_MAX} ký tự.`, 400, field);
  const id = slug(name);
  if (!id) fail("invalid_input", "Tên cần có chữ hoặc số.", 400, field);
  return { name, id };
}

/** Mật khẩu riêng gửi lên: thiếu / null / rỗng → null (dùng mật khẩu chung); có thì 8–200 ký tự. */
export function memberPassword(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return fail("invalid_input", "Mật khẩu phải là chuỗi.", 400, field);
  if (v.length < PASSWORD_MIN) fail("invalid_input", `Mật khẩu riêng cần ít nhất ${PASSWORD_MIN} ký tự.`, 400, field);
  if (v.length > PASSWORD_MAX) fail("invalid_input", `Mật khẩu riêng tối đa ${PASSWORD_MAX} ký tự.`, 400, field);
  return v;
}

/** Chèn có điều kiện: chỉ khi còn dưới 6 người đang hoạt động — hai yêu cầu cùng lúc không vượt được giới hạn. */
const UNDER_LIMIT = `(SELECT COUNT(*) FROM members WHERE active = 1) < ${MAX_ACTIVE_MEMBERS}`;
const tooMany = () => fail("too_many_members", `Nhà tối đa ${MAX_ACTIVE_MEMBERS} người đang dùng — tắt bớt một người trước.`, 409);

/**
 * Thêm người (UC-507): vai `adult`, đang hoạt động, mã sinh từ tên. Trùng tên hoặc trùng mã với bất kỳ ai (kể cả người đã
 * tắt) → 409 duplicate; đã đủ 6 người đang hoạt động → 409 too_many_members. Có mật khẩu riêng thì lưu băm.
 */
export async function createMember(db: D1Database, b: Input): Promise<MemberView> {
  const { name, id } = memberName(b.name, "name");
  const password = memberPassword(b.password, "password");
  const existing = rows<{ id: string; name: string }>(await db.prepare("SELECT id, name FROM members").all());
  if (existing.some((m) => m.id === id || nameKey(m.name) === nameKey(name))) fail("duplicate", "Đã có người tên này (kể cả người đã tắt).", 409, "name");
  const hash = password ? await hashPassword(password) : null;
  const res = await db
    .prepare(`INSERT INTO members (id, name, role, password_hash) SELECT ?, ?, 'adult', ? WHERE ${UNDER_LIMIT}`)
    .bind(id, name, hash)
    .run();
  if (!res.meta.changes) tooMany();
  return (await readMember(db, id))!;
}

/**
 * Sửa tên / kênh báo tin / bật-tắt. Tắt: không tắt được chủ hộ (409 owner_required); `session_gen` tăng → mọi phiên của
 * người đó hết hiệu lực ngay; ví, tài khoản, giao dịch giữ nguyên. Bật lại: tính vào giới hạn 6 người.
 */
export async function updateMember(db: D1Database, id: string, b: Input): Promise<MemberView> {
  const current = await db.prepare("SELECT role, active FROM members WHERE id = ?").bind(id).first<{ role: string; active: number }>();
  if (!current) fail("not_found", "Không có thành viên này.", 404);
  const chat = has(b, "tg_chat_id") ? text(b, "tg_chat_id", { max: 32 }) : undefined;
  if (chat && !/^-?\d{3,20}$/.test(chat)) fail("invalid_input", "chat_id Telegram là một dãy số (nhóm thì có dấu − ở đầu).");
  // Zalo chỉ nối bằng mã nhắn cho bot (webhook ghi chat_id); ở đây chỉ bỏ nối.
  if (has(b, "zalo_chat_id") && b.zalo_chat_id !== null) fail("invalid_input", "Nối Zalo bằng mã: bấm Nối Zalo rồi nhắn mã cho bot, không nhập tay.");
  if (has(b, "active") && typeof b.active !== "boolean") fail("invalid_input", "active phải là true hoặc false.", 400, "active");
  if (b.active === false && current!.role === "owner") fail("owner_required", "Không tắt được chủ hộ.", 409);
  if (b.active === true && !current!.active) {
    const res = await db.prepare(`UPDATE members SET active = 1 WHERE id = ? AND ${UNDER_LIMIT}`).bind(id).run();
    if (!res.meta.changes) tooMany();
  }
  if (b.active === false && current!.active) await db.prepare("UPDATE members SET active = 0, session_gen = session_gen + 1 WHERE id = ?").bind(id).run();
  await patchRow(db, "members", id, {
    name: has(b, "name") ? text(b, "name", { required: true, max: MEMBER_NAME_MAX }) : undefined,
    tg_chat_id: chat,
    zalo_chat_id: has(b, "zalo_chat_id") ? null : undefined,
  });
  return (await readMember(db, id))!;
}

/**
 * Đặt / đổi (`password` chuỗi) hoặc gỡ (`null`) mật khẩu riêng — người gọi đã kiểm quyền. `session_gen` tăng → mọi phiên cũ
 * của người đó hết hiệu lực. Gỡ khi chưa có mật khẩu riêng thì không đổi gì (`changed = false`).
 */
export async function setMemberPassword(db: D1Database, id: string, password: string | null): Promise<{ member: MemberView; changed: boolean; gen: number }> {
  const current = await db.prepare("SELECT password_hash, session_gen FROM members WHERE id = ?").bind(id).first<{ password_hash: string | null; session_gen: number }>();
  if (!current) return fail("not_found", "Không có thành viên này.", 404);
  if (password === null && !current.password_hash) return { member: (await readMember(db, id))!, changed: false, gen: current.session_gen };
  const hash = password === null ? null : await hashPassword(password);
  const row = await db
    .prepare("UPDATE members SET password_hash = ?, session_gen = session_gen + 1 WHERE id = ? RETURNING session_gen")
    .bind(hash, id)
    .first<{ session_gen: number }>();
  return { member: (await readMember(db, id))!, changed: true, gen: row!.session_gen };
}

// ── Mã chuyển khoản (rules) ─────────────────────────────────────────
export async function updateRule(db: D1Database, id: number, b: Input) {
  const current = await db.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<Row>();
  if (!current) fail("not_found", "Không có mã này.", 404);
  const matchType = has(b, "match_type") ? oneOf(b, "match_type", ["code", "content", "account"] as const, true) : undefined;
  const meaning = has(b, "meaning") ? oneOf(b, "meaning", ["spend", "transfer", "income"] as const, true) : undefined;
  const isSalary = has(b, "is_salary") ? bool(b, "is_salary") : undefined;
  const finalMeaning = meaning ?? current!.meaning;
  const finalSalary = isSalary ?? Boolean(current!.is_salary);
  // Luật 6: máy chỉ được tự gán thu nhập cho mẫu lương.
  if (finalMeaning === "income" && !finalSalary) fail("income_needs_salary", "Mã tự gán thu nhập phải là mẫu lương.");
  const walletId = has(b, "wallet_id") ? text(b, "wallet_id") : undefined;
  if (walletId !== undefined && !(await exists(db, "wallets", walletId))) fail("unknown_wallet", "Không có ví này.");
  const categoryId = has(b, "category_id") ? text(b, "category_id") : undefined;
  if (categoryId !== undefined && !(await exists(db, "categories", categoryId))) fail("unknown_category", "Không có danh mục này.");
  const streamId = has(b, "income_stream_id") ? text(b, "income_stream_id") : undefined;
  if (streamId && finalMeaning !== "income") fail("invalid_input", "Chỉ mẫu lương mới gắn nguồn thu.");
  if (streamId && !(await exists(db, "income_streams", streamId))) fail("unknown_income_stream", "Không có nguồn thu này.");
  let pattern = has(b, "pattern") ? text(b, "pattern", { required: true, max: 80 }) : undefined;
  if (pattern !== undefined && (matchType ?? current!.match_type) !== "account") pattern = pattern!.toUpperCase();
  await patchRow(db, "rules", id, {
    match_type: matchType,
    pattern,
    meaning,
    is_salary: isSalary,
    wallet_id: walletId,
    category_id: categoryId,
    income_stream_id: streamId,
    priority: has(b, "priority") ? integer(b, "priority", { min: 0, max: 1000 }) : undefined,
    active: has(b, "active") ? bool(b, "active") : undefined,
  });
  return toRule((await db.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<Row>())!);
}

// ── Nguồn thu: phần khóa riêng của từng nguồn ───────────────────────
async function getStream(db: D1Database, id: string) {
  const [streams, locks] = await db.batch([
    db.prepare("SELECT id, name, sort, active FROM income_streams WHERE id = ?").bind(id),
    db.prepare("SELECT stream_id, wallet_id, percent FROM income_stream_locks WHERE stream_id = ? ORDER BY sort, wallet_id").bind(id),
  ]);
  return toStreams(rows(streams!), rows(locks!))[0] ?? fail("not_found", "Không có nguồn thu này.", 404);
}

/** Lệnh thay toàn bộ phần khóa của một nguồn. Kiểm tra trước khi ghi: ví còn dùng, không phải ví Thu nhập, tổng ≤ 100%. */
async function lockStatements(db: D1Database, streamId: string, raw: unknown): Promise<D1PreparedStatement[]> {
  if (!Array.isArray(raw)) fail("invalid_input", "locks phải là danh sách.");
  const statements = [db.prepare("DELETE FROM income_stream_locks WHERE stream_id = ?").bind(streamId)];
  const seen = new Set<string>();
  let total = 0;
  for (const [i, lock] of (raw as unknown[]).entries()) {
    if (!lock || typeof lock !== "object") fail("invalid_input", "Mỗi phần khóa gồm wallet_id và percent.");
    const l = lock as Input;
    const walletId = text(l, "wallet_id", { required: true })!;
    if (typeof l.percent !== "number" || !(l.percent > 0 && l.percent <= 1)) fail("invalid_input", "percent là tỷ lệ lớn hơn 0, tối đa 1 (0.45 = 45%).");
    if (seen.has(walletId)) fail("invalid_input", "Mỗi ví chỉ khóa một lần trong một nguồn.");
    seen.add(walletId);
    const w = await db.prepare("SELECT tier, kind FROM wallets WHERE id = ? AND active = 1").bind(walletId).first<Row>();
    if (!w) fail("unknown_wallet", `Không có ví "${walletId}".`);
    if (w!.tier === "holding" && w!.kind === "holding") fail("invalid_lock", "Không khóa tiền vào chính ví Thu nhập.");
    total += l.percent as number;
    statements.push(
      db.prepare("INSERT INTO income_stream_locks (stream_id, wallet_id, percent, sort) VALUES (?, ?, ?, ?)").bind(streamId, walletId, l.percent, (i + 1) * 10),
    );
  }
  if (total > 1 + 1e-9) fail("invalid_lock", "Tổng phần khóa của nguồn thu vượt 100%.");
  return statements;
}

export async function createIncomeStream(db: D1Database, b: Input) {
  const name = text(b, "name", { required: true, max: 60 })!;
  const id = newId(b, name);
  if (await exists(db, "income_streams", id)) fail("duplicate", "Đã có nguồn thu với mã này.", 409);
  const locks = await lockStatements(db, id, b.locks ?? []);
  await db.batch([
    db.prepare("INSERT INTO income_streams (id, name, sort) VALUES (?, ?, ?)").bind(id, name, integer(b, "sort", { min: 0, max: 10000 }) ?? 100),
    ...locks,
  ]);
  return getStream(db, id);
}

export async function updateIncomeStream(db: D1Database, id: string, b: Input) {
  await getStream(db, id);
  const locks = has(b, "locks") ? await lockStatements(db, id, b.locks) : [];
  await patchRow(db, "income_streams", id, {
    name: has(b, "name") ? text(b, "name", { required: true, max: 60 }) : undefined,
    sort: has(b, "sort") ? integer(b, "sort", { min: 0, max: 10000 }) : undefined,
    active: has(b, "active") ? bool(b, "active") : undefined,
  });
  if (locks.length) await db.batch(locks);
  return getStream(db, id);
}

// ── Tham số ─────────────────────────────────────────────────────────
export async function updateConfig(db: D1Database, b: Input) {
  const salary = integer(b, "salary_min_amount", { min: 0, max: 1e12 });
  const months = integer(b, "safety_fund_months", { min: 1, max: 36 });
  const upsert = (k: string, v: number) => db.prepare("INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(k, String(v));
  const statements = [...(salary !== null ? [upsert("salary_min_amount", salary)] : []), ...(months !== null ? [upsert("safety_fund_months", months)] : [])];
  if (statements.length) await db.batch(statements);
  return { salary_min_amount: await configNumber(db, "salary_min_amount", 1_000_000), safety_fund_months: await configNumber(db, "safety_fund_months", 6) };
}

// ── Giờ nhắc (cả nhà) ───────────────────────────────────────────────
const SCHEDULE_CLOCKS = { daily_time: "dailyTime", weekly_time: "weeklyTime", quiet_start: "quietStart", quiet_end: "quietEnd" } as const;
const SCHEDULE_FLAGS = { daily_enabled: "dailyEnabled", weekly_enabled: "weeklyEnabled", pending_enabled: "pendingEnabled" } as const;

/** PATCH: chỉ ghi các trường có gửi. Giờ "HH:MM" giờ VN, phút chia hết cho 15 vì cron chạy mỗi 15 phút (ADR-70). */
export async function updateNotifySchedule(db: D1Database, b: Input) {
  const values: [keyof NotifySchedule, string][] = [];
  for (const [field, key] of Object.entries(SCHEDULE_CLOCKS)) {
    if (!has(b, field)) continue;
    const v = b[field];
    const minutes = typeof v === "string" ? clockMinutes(v) : null;
    if (minutes === null) fail("invalid_input", `${field} có dạng HH:MM (00:00–23:45).`);
    if (minutes! % 15 !== 0) fail("invalid_input", `${field}: Giờ phải chia hết cho 15 phút.`);
    values.push([key, v as string]);
  }
  if (has(b, "weekly_day")) {
    const v = b.weekly_day;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 7) fail("invalid_input", "weekly_day là số từ 1 (thứ Hai) đến 7 (Chủ nhật).");
    values.push(["weeklyDay", String(v)]);
  }
  for (const [field, key] of Object.entries(SCHEDULE_FLAGS)) {
    if (!has(b, field)) continue;
    if (typeof b[field] !== "boolean") fail("invalid_input", `${field} phải là true hoặc false.`);
    values.push([key, b[field] ? "1" : "0"]);
  }
  if (values.length) {
    await db.batch(
      values.map(([key, v]) => db.prepare("INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(NOTIFY_CONFIG_KEYS[key], v)),
    );
  }
  return readNotifySchedule(db);
}

// ── Kết nối ─────────────────────────────────────────────────────────
/** Khoá/token gửi lên: không có trường → undefined; null hoặc rỗng → null (xoá); còn lại phải đủ dài. */
function secretValue(b: Input, k: string): string | null | undefined {
  if (!has(b, k)) return undefined;
  const v = b[k];
  if (v !== null && typeof v !== "string") fail("invalid_input", `${k} phải là chuỗi hoặc null.`);
  const trimmed = typeof v === "string" ? v.trim() : "";
  if (trimmed && trimmed.length < 8) fail("invalid_input", "Khoá quá ngắn — dán đủ khoá từ SePay / BotFather / Zalo Bot Creator.");
  // Khoá webhook SePay mới phải đủ dài để không dò được (ADR-89); khoá đã lưu trước đó vẫn dùng được — chỉ kiểm khi đặt.
  if (trimmed && k === "webhook_key" && trimmed.length < 24) {
    fail("invalid_input", "Khoá webhook SePay cần ít nhất 24 ký tự — đặt khoá dài, ngẫu nhiên trong SePay rồi dán vào đây.");
  }
  // Khoá webhook Zalo đi trong header X-Bot-Api-Secret-Token: 8–256 ký tự, chỉ chữ, số, - và _.
  if (trimmed && k === "zalo_webhook_secret" && !/^[A-Za-z0-9_-]{8,256}$/.test(trimmed)) {
    fail("invalid_input", "Khoá webhook Zalo dài 8–256 ký tự, chỉ gồm chữ không dấu, số, - và _.");
  }
  return trimmed || null;
}

export async function updateIntegrations(env: Env, b: Input) {
  for (const name of SECRET_NAMES) {
    const v = secretValue(b, name);
    if (v !== undefined) await setSecret(env, name as SecretName, v);
  }
  return Object.fromEntries(await Promise.all(SECRET_NAMES.map(async (n) => [n, await describeSecret(env, n)] as const)));
}

/** Kết nối SePay như màn Cài đặt thấy: khoá chỉ có đã đặt / 2 ký tự cuối, kèm tài khoản thuộc kết nối. */
function connectionView(c: SepayConnection, accounts: Row[]) {
  return {
    id: c.id,
    name: c.name,
    active: c.active,
    api_token: c.apiTokenInfo,
    webhook_key: c.webhookKeyInfo,
    accounts: accounts.filter((a) => a.sepay_connection_id === c.id).map((a) => a.id as string),
  };
}

async function readConnection(env: Env, id: string) {
  const conn = (await loadSepayConnections(env)).find((c) => c.id === id);
  if (!conn) return fail("not_found", "Không có kết nối SePay này.", 404);
  const accounts = rows(await env.DB.prepare("SELECT id, sepay_connection_id FROM accounts WHERE sepay_connection_id = ?").bind(id).all());
  return connectionView(conn, accounts);
}

/** Hai kết nối cùng khoá webhook thì không biết giao dịch thuộc ai — chặn từ lúc đặt. */
async function webhookKeyFree(env: Env, key: string | null | undefined, ownId: string | null) {
  if (!key) return;
  if ((await loadSepayConnections(env)).some((c) => c.id !== ownId && c.webhookKey === key)) {
    fail("duplicate_key", "Khoá webhook này đang dùng cho kết nối khác — mỗi tài khoản SePay đặt một khoá riêng.", 409);
  }
}

export async function createSepayConnection(env: Env, b: Input) {
  const name = text(b, "name", { required: true, max: 60 })!;
  const id = newId(b, name);
  if (await env.DB.prepare("SELECT 1 FROM sepay_connections WHERE id = ?").bind(id).first()) fail("duplicate", "Đã có kết nối SePay với tên này.", 409);
  const apiToken = secretValue(b, "api_token") ?? null;
  const webhookKey = secretValue(b, "webhook_key") ?? null;
  await webhookKeyFree(env, webhookKey, null);
  await env.DB.prepare("INSERT INTO sepay_connections (id, name, api_token, webhook_key) VALUES (?, ?, ?, ?)").bind(id, name, apiToken, webhookKey).run();
  return readConnection(env, id);
}

export async function updateSepayConnection(env: Env, id: string, b: Input) {
  if (!(await env.DB.prepare("SELECT 1 FROM sepay_connections WHERE id = ?").bind(id).first())) fail("not_found", "Không có kết nối SePay này.", 404);
  const webhookKey = secretValue(b, "webhook_key");
  await webhookKeyFree(env, webhookKey, id);
  await patchRow(env.DB, "sepay_connections", id, {
    name: has(b, "name") ? text(b, "name", { required: true, max: 60 }) : undefined,
    active: has(b, "active") ? bool(b, "active") : undefined,
    api_token: secretValue(b, "api_token"),
    webhook_key: webhookKey,
  });
  return readConnection(env, id);
}

export async function testTelegram(env: Env, memberId: string, fetchImpl: typeof fetch = fetch) {
  const m = await env.DB.prepare("SELECT name, tg_chat_id FROM members WHERE id = ? AND active = 1").bind(memberId).first<{ name: string; tg_chat_id: string | null }>();
  if (!m) fail("not_found", "Không có thành viên này.", 404);
  if (!m!.tg_chat_id) return { sent: false, error: "Chưa có chat_id Telegram của người này." };
  const token = await getSecret(env, "telegram_bot_token");
  if (!token) return { sent: false, error: "Chưa đặt bot token Telegram." };
  const r = await sendTelegram(token, m!.tg_chat_id, `✅ Ví nhà đã nối Telegram cho ${escapeHtml(m!.name)}.`, fetchImpl);
  return r.ok ? { sent: true } : { sent: false, error: `Telegram từ chối (${r.error}). Kiểm tra token và chat_id, và đã nhắn /start cho bot chưa.` };
}

/**
 * "Kiểm tra" một kết nối SePay (API v2): token còn dùng được, SePay đang nối những tài khoản ngân hàng nào (`linked`),
 * từng tài khoản của kết nối này ở app có trong SePay không và có bao nhiêu giao dịch 7 ngày qua.
 * Tối đa hai lời gọi cho cả công ty; chưa có tài khoản nào ở app thì không đọc giao dịch.
 */
export async function testSepay(env: Env, connectionId: string, now: Date, fetchImpl: typeof fetch = fetch) {
  const conn = (await loadSepayConnections(env)).find((c) => c.id === connectionId);
  if (!conn) return fail("not_found", "Không có kết nối SePay này.", 404);
  const accounts = rows<{ id: string; name: string; account_no: string }>(
    await env.DB.prepare("SELECT id, name, account_no FROM accounts WHERE sepay_enabled = 1 AND account_no IS NOT NULL AND active = 1 AND sepay_connection_id = ?")
      .bind(connectionId)
      .all(),
  );
  const allFail = (error: string) => ({ ok: false, error, accounts: accounts.map((a) => ({ id: a.id, name: a.name, transactions: 0, error })), linked: [] });
  if (!conn.apiToken) return allFail("Chưa đặt token API SePay.");
  const vn = new Date(now.getTime() + 7 * 3600_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const range = { from: `${day(new Date(vn.getTime() - 7 * 86_400_000))} 00:00:00`, to: `${day(vn)} 23:59:59` };
  let linked: SepayBankAccount[];
  let txs: Record<string, unknown>[] = [];
  try {
    linked = await listBankAccounts(conn.apiToken, fetchImpl);
    if (accounts.length) txs = await listTransactions(range, conn.apiToken, fetchImpl);
  } catch (err) {
    return allFail(sepayErrorText(err));
  }
  const results = accounts.map((a) =>
    linked.some((l) => l.account_number === a.account_no)
      ? { id: a.id, name: a.name, transactions: txs.filter((t) => t.account_number === a.account_no).length }
      : { id: a.id, name: a.name, transactions: 0, error: "SePay chưa nối số tài khoản này." },
  );
  return {
    ok: results.every((r) => !("error" in r)),
    accounts: results,
    linked: linked.map((l) => ({ account_number: l.account_number, bank: l.bank_short_name ?? null, label: l.label ?? null })),
  };
}

// ── Đồng bộ lại SePay theo khoảng ngày ───────────────────────────────
const SYNC_MAX_DAYS = 31;

/** Ngày "YYYY-MM-DD" có thật → mốc UTC 00:00 của nó (chỉ để so và đếm ngày); sai → null. */
function calendarDay(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v ? null : t;
}

/**
 * `POST /v1/settings/sepay/sync` — lấy lại giao dịch SePay của các ngày `from`…`to` (giờ VN, tính cả hai đầu), cùng đường
 * với rà soát 02:00 (`syncSepay`). Tối đa 31 ngày, không quá hôm nay. Bỏ `connection_id` = mọi kết nối đang bật.
 */
export async function syncSepayRange(env: Env, b: Input, now: Date, fetchImpl: typeof fetch = fetch) {
  const from = calendarDay(b.from);
  const to = calendarDay(b.to);
  if (from === null || to === null) return fail("invalid_range", "Ngày phải có dạng YYYY-MM-DD (vd 2026-10-01).");
  if (from > to) fail("invalid_range", "Từ ngày phải trước hoặc bằng Đến ngày.");
  if (to > calendarDay(dayKey(now))!) fail("invalid_range", "Không đồng bộ được ngày trong tương lai.");
  if ((to - from) / 86_400_000 + 1 > SYNC_MAX_DAYS) fail("invalid_range", `Mỗi lần đồng bộ tối đa ${SYNC_MAX_DAYS} ngày.`);
  const connectionId = text(b, "connection_id", { max: 40 }) ?? undefined;
  if (connectionId && !(await loadSepayConnections(env, { activeOnly: true })).some((c) => c.id === connectionId)) {
    fail("not_found", "Không có kết nối SePay này, hoặc kết nối đang tắt.", 404);
  }
  const range = { from: b.from as string, to: b.to as string };
  const result = await syncSepay(env, { from: `${range.from} 00:00:00`, to: `${range.to} 23:59:59` }, now, fetchImpl, { connectionId });
  return { ...range, ...result };
}
