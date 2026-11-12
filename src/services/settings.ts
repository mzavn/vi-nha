// Màn Cài đặt: tài khoản, thành viên, mã chuyển khoản, nguồn thu, tham số, khoá kết nối SePay/Telegram/Zalo.
// Mọi thay đổi ở đây là cấu hình, không phải sổ: không đụng tới transactions hay bank_logs. Ví, luật nạp, phần khoá và vai
// trò / công tắc tài khoản đã bỏ (ADR-123, ADR-131): `/v1/settings/wallets*` trả 410, `locks` / `month_close_*` /
// `spendable` / `locked` / `role` / `surplus_reward_earmark` trả 400 `model_changed`.

import { bankByCode } from "../domain/banks";
import { rejectOldFields } from "../domain/entry";
import { INTEREST_MAX_AMOUNT_LIMIT } from "../domain/interest-deposit";
import { clockMinutes, NOTIFY_CONFIG_KEYS, parseNotifySchedule, type NotifySchedule } from "../domain/notify-schedule";
import { dayKey } from "../domain/period";
import { DEFAULT_SURPLUS_SAVINGS_PCT } from "../domain/pay-cycle";
import { DEFAULT_PAYDAY_DAY } from "../domain/snapshot";
import { DomainError } from "../domain/types";
import type { Env } from "../env";
import { escapeHtml, sendTelegram } from "../notify/telegram";
import { DEFAULT_ACCOUNT_POCKET, DEFAULT_SAVINGS_PCT, POCKETS, type Pocket } from "../domain/pockets";
import { syncSepay } from "../cron/backfill";
import { DEFAULT_SEPAY_CONNECTION_ID } from "../domain/system-ids";
import { describeSecret, getSecret, loadSepayConnections, SECRET_NAMES, setSecret, type SecretName, type SepayConnection } from "./secrets";
import { interestMaxAmount } from "./ledger";
import { hashPassword, PASSWORD_MAX, PASSWORD_MIN } from "./passwords";
import { assertRowWritable, hiddenAccountIds } from "./privacy";
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
const exists = async (db: D1Database, table: "accounts" | "members" | "categories" | "income_streams", id: string | null) =>
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
// `first_log_at`: log SePay sớm nhất của tài khoản — sheet tài khoản gợi ý đặt mốc theo dõi khi log này sau ngày số dư đầu (ADR-113).
const ACCOUNT_SQL =
  "SELECT id, name, kind, bank, account_no, sub_account, sepay_enabled, sepay_out, sepay_connection_id, owner_member_id, opening_balance, opened_at, feed_from, sepay_out_from, active, deactivated_at, pocket, pocket_confirmed, private, parent_account_id, (SELECT b.book_balance FROM v_account_book b WHERE b.account_id = accounts.id) AS book_balance, (SELECT MIN(l.at) FROM bank_logs l WHERE l.account_id = accounts.id) AS first_log_at FROM accounts";
const toAccount = (r: Row) => ({
  ...r,
  id: String(r.id),
  sepay_enabled: Boolean(r.sepay_enabled),
  sepay_out: Boolean(r.sepay_out),
  active: Boolean(r.active),
  pocket_confirmed: Boolean(r.pocket_confirmed),
  private: Boolean(r.private),
});

/** Một tài khoản như màn Cài đặt thấy; không có → null. */
export async function readAccount(db: D1Database, id: string) {
  const row = await db.prepare(`${ACCOUNT_SQL} WHERE id = ?`).bind(id).first<Row>();
  return row ? toAccount(row) : null;
}

/** Mọi tài khoản như màn Cài đặt thấy: đang dùng trước. */
export async function listAccounts(db: D1Database) {
  return rows(await db.prepare(`${ACCOUNT_SQL} ORDER BY active DESC, kind, name`).all()).map(toAccount);
}

// ── Ngăn của tài khoản và mục tiêu Dự phòng gắn với nó (pocket UC-1201, UC-1209) ──
/** Ngăn gửi lên: một trong ba ngăn hoặc null (ngoài ngăn / theo tài khoản nhận); sai → 400 kèm tên ô. */
export function pocketValue(v: unknown, field = "pocket"): Pocket | null {
  if (v === null) return null;
  if (typeof v === "string" && (POCKETS as readonly string[]).includes(v)) return v as Pocket;
  return fail("invalid_input", "Ngăn là savings (Tích luỹ), reserve (Dự phòng), operating (Vận hành) hoặc null.", 400, field);
}

/**
 * Tài khoản đang gắn mục tiêu Dự phòng đang dùng → 409 account_has_goal: không rời ngăn Dự phòng, không tắt được (UC-1209
 * bước 3). Trigger trg_accounts_keep_goal chặn ở tầng dữ liệu; hàm này dựng câu báo lỗi.
 */
export async function assertNoGoal(db: D1Database, accountId: string): Promise<void> {
  const goal = await db
    .prepare("SELECT a.name AS account, g.name FROM reserve_goals g JOIN accounts a ON a.id = g.account_id WHERE g.account_id = ? AND g.active = 1")
    .bind(accountId)
    .first<{ account: string; name: string }>();
  if (!goal) return;
  fail("account_has_goal", `${goal.account} đang gắn mục tiêu "${goal.name}": bỏ gắn tài khoản hoặc tắt mục tiêu trước.`, 409, "pocket");
}

// ── Tài khoản con: khoản gửi kỳ hạn (access UC-506, ADR-140) ─────────
const PARENT_TEXT = "Tài khoản mẹ phải là tài khoản ngân hàng đang dùng, không ở ngăn Vận hành, không là khoản gửi của tài khoản khác.";
const invalidParent = (message = PARENT_TEXT): never => fail("invalid_parent", message, 400, "parent_account_id");
const pocketFollowsParent = (parent: string, field: string): never =>
  fail("pocket_follows_parent", `Khoản gửi theo ngăn, riêng tư và chủ của ${parent}: bỏ ô ${field}.`, 400, field);
const childSepay = (): never => fail("bank_not_supported", "Khoản gửi kỳ hạn không bật SePay: giao dịch ngân hàng báo về tài khoản mẹ.", 400, "sepay_enabled");
const hasChildren = (parent: string): never => fail("account_has_children", `Tất toán / tắt các khoản gửi của ${parent} trước.`, 409);

type ParentRow = { id: string; name: string; active: number; pocket: Pocket | null; pocket_confirmed: number; private: number; owner_member_id: string | null };

/** Tài khoản mẹ hợp lệ cho `childId` (null = tài khoản sắp tạo): đang dùng nếu con đang dùng, ngân hàng, không ở Vận hành, không là con. */
async function readParent(db: D1Database, parentId: string, childId: string | null, childActive: boolean): Promise<ParentRow> {
  if (parentId === childId) invalidParent("Tài khoản không là khoản gửi của chính nó.");
  const parent = await db
    .prepare("SELECT id, name, active, pocket, pocket_confirmed, private, owner_member_id FROM accounts WHERE id = ? AND kind = 'bank' AND parent_account_id IS NULL AND pocket IS NOT 'operating'")
    .bind(parentId)
    .first<ParentRow>();
  if (!parent) return invalidParent();
  if (childActive && !parent.active) invalidParent(`${parent.name} đang tắt: bật lại tài khoản mẹ trước.`);
  return parent;
}

/** Mọi tài khoản con (kể cả đã tắt) của một tài khoản — sửa mẹ thì cả bọn theo (trg_accounts_children_follow). */
export async function childAccountIds(db: D1Database, id: string): Promise<string[]> {
  return rows<{ id: string }>(await db.prepare("SELECT id FROM accounts WHERE parent_account_id = ? ORDER BY id").bind(id).all()).map((r) => r.id);
}

/**
 * Chạy batch ghi tài khoản; trigger chặn (hai máy cùng lúc) → lỗi API tương ứng, không đổi gì: 409 account_has_goal,
 * 409 account_has_children, 409 goal_on_child, 400 invalid_parent, 400 pocket_follows_parent.
 */
export async function accountBatch(db: D1Database, statements: D1PreparedStatement[], accountIds: string[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (err) {
    const raised = String(err);
    if (/account_has_goal/.test(raised)) {
      for (const id of accountIds) await assertNoGoal(db, id);
      fail("account_has_goal", "Tài khoản đang gắn mục tiêu Dự phòng: bỏ gắn tài khoản hoặc tắt mục tiêu trước.", 409, "pocket");
    }
    if (/account_has_children/.test(raised)) {
      const marks = accountIds.map(() => "?").join(", ");
      const parent = await db
        .prepare(`SELECT name FROM accounts a WHERE a.id IN (${marks}) AND EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = a.id AND c.active = 1)`)
        .bind(...accountIds)
        .first<{ name: string }>();
      hasChildren(parent?.name ?? "tài khoản mẹ");
    }
    if (/goal_on_child/.test(raised)) fail("goal_on_child", "Tài khoản đang gắn mục tiêu không làm khoản gửi được: bỏ gắn tài khoản hoặc tắt mục tiêu trước.", 409, "parent_account_id");
    if (/invalid_parent/.test(raised)) invalidParent();
    if (/pocket_follows_parent/.test(raised)) fail("pocket_follows_parent", "Khoản gửi theo ngăn, riêng tư và chủ của tài khoản mẹ.", 400, "pocket");
    throw err;
  }
}

/** Vai trò / công tắc tài khoản đã bỏ (ADR-131, access UC-506): gửi lên dù giá trị gì (kể cả null) → 400 model_changed. */
const OLD_ACCOUNT_FIELDS = ["spendable", "locked", "role"] as const;
function rejectOldAccountFields(b: Input): void {
  const fields = OLD_ACCOUNT_FIELDS.filter((k) => has(b, k));
  if (fields.length) throw new DomainError("model_changed", `Ví nhà v2 xếp tài khoản theo ngăn: bỏ trường ${fields.join(", ")}.`, 400, undefined, fields);
}

const toRule = (r: Row) => ({ ...r, is_salary: Boolean(r.is_salary), active: Boolean(r.active), incomeStreamId: r.income_stream_id ?? null });

const STREAM_COLS = "id, name, sort, active, pocket, opens_cycle";
const toStream = (s: Row) => ({
  id: s.id as string,
  name: s.name as string,
  sort: Number(s.sort),
  active: Boolean(s.active),
  pocket: (s.pocket as Pocket | null) ?? null,
  opens_cycle: Boolean(s.opens_cycle),
});

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
  const [accounts, members, rules, categories, streams] = await db.batch([
    db.prepare(`${ACCOUNT_SQL} ORDER BY active DESC, kind, name`),
    db.prepare(`SELECT ${MEMBER_COLS} FROM members ORDER BY role = 'owner' DESC, name`),
    db.prepare("SELECT * FROM rules ORDER BY active DESC, priority, id"),
    db.prepare("SELECT id, name, group_id AS groupId FROM categories WHERE active = 1 ORDER BY sort, name"),
    db.prepare(`SELECT ${STREAM_COLS} FROM income_streams ORDER BY sort, name`),
  ]);
  const secrets = Object.fromEntries(await Promise.all(SECRET_NAMES.map(async (n) => [n, await describeSecret(env, n)] as const)));
  const accountRows = rows(accounts!);
  const connections = (await loadSepayConnections(env)).map((c) => connectionView(c, accountRows));
  return {
    accounts: accountRows.map(toAccount),
    members: rows<MemberRow>(members!).map(toMember),
    rules: rows(rules!).map(toRule),
    categories: rows(categories!),
    incomeStreams: rows(streams!).map(toStream),
    config: await readConfig(db),
    notifySchedule: await readNotifySchedule(db),
    integrations: { webhook_url: `${origin}/webhooks/sepay`, zalo_webhook_url: `${origin}/webhooks/zalo`, ...secrets, sepay_connections: connections },
  };
}

// ── Tài khoản ───────────────────────────────────────────────────────
export const ACCOUNT_KINDS = ["bank", "cash", "ewallet", "credit"] as const;
/** Tài khoản ngân hàng / thẻ chỉ nhận mã trong danh mục ngân hàng (ADR-66); ví điện tử, tiền mặt giữ tên tự do. */
export const bankOk = (kind: string, bank: string | null) => (kind !== "bank" && kind !== "credit") || bank === null || Boolean(bankByCode(bank));

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
    pocket: has(b, "pocket") ? pocketValue(b.pocket) : undefined,
    // Tài khoản mẹ của khoản gửi kỳ hạn; null = tài khoản riêng (bỏ mẹ).
    parent_account_id: has(b, "parent_account_id") ? text(b, "parent_account_id") : undefined,
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

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Mốc theo dõi SePay gửi lên (ADR-113): `null` = từ ngày số dư đầu; còn lại là thời điểm ISO có múi giờ, không ở tương lai,
 * không trước 00:00 giờ VN của ngày số dư đầu. Lưu dạng `toISOString()` — cùng dạng `bank_logs.at`, log đúng bằng mốc
 * nằm trong phạm vi.
 */
function feedFromValue(v: unknown, openedAt: string | null, now: Date): string | null {
  if (v === null) return null;
  const t = typeof v === "string" && ISO_INSTANT.test(v) ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) return fail("invalid_input", "Mốc theo dõi SePay là thời điểm có múi giờ, vd 2026-10-15T15:25:00.000Z.", 400, "feed_from");
  if (t > now.getTime()) fail("invalid_input", "Mốc theo dõi SePay không được ở tương lai.", 400, "feed_from");
  if (openedAt && t < Date.parse(`${openedAt}T00:00:00+07:00`)) fail("invalid_input", "Mốc theo dõi SePay không được trước ngày số dư đầu.", 400, "feed_from");
  return new Date(t).toISOString();
}

/** Mã tài khoản thân này sẽ tạo (gửi `id`, hoặc slug của tên) — chưa kiểm thân; không suy ra được → null (pocket UC-1209 bước 8). */
export function accountIdOf(b: Input): string | null {
  const id = typeof b.id === "string" && b.id.trim() ? b.id.trim().slice(0, 120) : typeof b.name === "string" ? slug(b.name.trim().slice(0, 60)) : "";
  return id || null;
}

/**
 * Kiểm thân thêm tài khoản (access UC-506) rồi dựng câu chèn. `where`: điều kiện SQL của câu chèn — không khớp thì câu không
 * chèn gì (tạo + gắn mục tiêu trong một batch, ADR-134).
 */
export async function accountInsert(db: D1Database, b: Input, where?: { sql: string; binds: unknown[] }): Promise<{ id: string; statement: D1PreparedStatement }> {
  rejectOldAccountFields(b);
  const name = text(b, "name", { required: true, max: 60 })!;
  const id = newId(b, name);
  if (await db.prepare("SELECT 1 FROM accounts WHERE id = ?").bind(id).first()) fail("duplicate", "Đã có tài khoản với mã này.", 409);
  const f = await accountFields(db, { kind: "bank", ...b, name }, null);
  // Khoản gửi kỳ hạn (access UC-506): ngân hàng, không SePay; ngăn / xác nhận / riêng tư / chủ lấy của mẹ trong cùng câu chèn.
  let parent: ParentRow | null = null;
  if (f.parent_account_id) {
    if (f.kind !== "bank") invalidParent("Khoản gửi kỳ hạn là tài khoản ngân hàng.");
    if (f.sepay_enabled) childSepay();
    parent = await readParent(db, f.parent_account_id, id, true);
    if (f.pocket !== undefined) pocketFollowsParent(parent.name, "pocket");
    if (f.owner_member_id !== undefined && f.owner_member_id !== parent.owner_member_id) pocketFollowsParent(parent.name, "owner_member_id");
  }
  if (f.sepay_enabled && !f.account_no) fail("missing_account_no", "Bật SePay thì cần số tài khoản để nhận diện giao dịch.");
  const { sepay_out } = sepayFields(f, { kind: "bank", bank: null, sepay_enabled: false, sepay_out: false });
  const connectionId = await sepayConnectionId(db, Boolean(f.sepay_enabled), f.sepay_connection_id, null);
  // Không gửi ngăn thì Vận hành (mọi loại, kể cả thẻ tín dụng), chưa xác nhận (pocket UC-1201 bước 4); gửi ngăn = đã xác nhận.
  const pocket = parent ? parent.pocket : f.pocket !== undefined ? f.pocket : DEFAULT_ACCOUNT_POCKET;
  const confirmed = parent ? parent.pocket_confirmed : f.pocket !== undefined ? 1 : 0;
  const owner = parent ? parent.owner_member_id : (f.owner_member_id ?? null);
  // Tài khoản mới luôn công khai (`private` 0, access UC-504): chủ tài khoản tự bật ở sheet tài khoản. Khoản gửi theo mẹ.
  const statement = db
    .prepare(
      `INSERT INTO accounts (id, name, kind, bank, account_no, sub_account, sepay_enabled, sepay_out, sepay_connection_id, owner_member_id, opening_balance, opened_at, pocket, pocket_confirmed, private, parent_account_id)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, date('now')), ?, ?, ?, ? WHERE ${where?.sql ?? "1"}`,
    )
    .bind(
      id, f.name, f.kind, f.bank ?? null, f.account_no ?? null, f.sub_account ?? null, f.sepay_enabled ? 1 : 0, sepay_out ? 1 : 0, connectionId,
      owner, f.opening_balance ?? 0, f.opened_at ?? null, pocket, confirmed, parent?.private ?? 0, parent?.id ?? null, ...(where?.binds ?? []),
    );
  return { id, statement };
}

export async function createAccount(db: D1Database, b: Input) {
  const { id, statement } = await accountInsert(db, b);
  await accountBatch(db, [statement], [id]);
  return toAccount((await db.prepare(`${ACCOUNT_SQL} WHERE id = ?`).bind(id).first<Row>())!);
}

/** `actor`: người đang sửa (phiên / X-Member-Id) — chỉ chủ tài khoản bật / tắt riêng tư (access UC-504). */
export async function updateAccount(db: D1Database, id: string, b: Input, now: Date = new Date(), actor: string | null = null) {
  const current = await db.prepare(`${ACCOUNT_SQL} WHERE id = ?`).bind(id).first<Row>();
  if (!current) fail("not_found", "Không có tài khoản này.", 404);
  rejectOldAccountFields(b);
  const f = await accountFields(db, b, id);
  // Khoản gửi kỳ hạn (access UC-506): `parentId` là mẹ sau khi sửa — gắn mẹ bằng PATCH được khi tài khoản không gắn mục tiêu,
  // không bật SePay, không là Ví Thưởng, không có con; con theo ngăn / riêng tư / chủ của mẹ. Bỏ mẹ thì giữ ngăn đang có.
  const currentParent = (current!.parent_account_id as string | null) ?? null;
  const parentId = f.parent_account_id === undefined ? currentParent : f.parent_account_id;
  const attaching = parentId !== null && parentId !== currentParent;
  let parent: ParentRow | null = null;
  if (parentId !== null) {
    if ((f.kind ?? current!.kind) !== "bank") invalidParent("Khoản gửi kỳ hạn là tài khoản ngân hàng.");
    if (f.sepay_enabled ?? Boolean(current!.sepay_enabled)) {
      if (current!.sepay_enabled && f.sepay_enabled !== true) invalidParent(`${current!.name} đang bật SePay: tắt SePay trước rồi mới làm khoản gửi.`);
      childSepay();
    }
    if (attaching) {
      const goal = await db.prepare("SELECT name FROM reserve_goals WHERE account_id = ? AND active = 1").bind(id).first<{ name: string }>();
      if (goal) fail("goal_on_child", `${current!.name} đang gắn mục tiêu "${goal.name}": bỏ gắn tài khoản hoặc tắt mục tiêu trước.`, 409, "parent_account_id");
      if (await db.prepare("SELECT 1 FROM config WHERE k = 'surplus_reward_account' AND v = ?").bind(id).first()) {
        invalidParent(`${current!.name} là Ví Thưởng: Ví Thưởng không làm khoản gửi được.`);
      }
      if ((await childAccountIds(db, id)).length) invalidParent(`${current!.name} đang có khoản gửi riêng: không làm khoản gửi của tài khoản khác được.`);
    }
    parent = await readParent(db, parentId, id, f.active ?? Boolean(current!.active));
    if (f.pocket !== undefined) pocketFollowsParent(parent.name, "pocket");
  } else if (f.active === false || f.pocket === "operating" || (f.kind != null && f.kind !== "bank")) {
    // Mẹ có con đang dùng: không tắt, không sang Vận hành, không đổi loại (trg_accounts_keep_children).
    if (await db.prepare("SELECT 1 FROM accounts WHERE parent_account_id = ? AND active = 1").bind(id).first()) hasChildren(String(current!.name));
  }
  if (f.opened_at) {
    // Không giao dịch nào được nằm trước ngày mở sổ (ADR-76): lưu chuyển tiền giữ bất biến đầu kỳ + ba nhóm = cuối kỳ.
    const first = await db
      .prepare("SELECT MIN(date(at, '+7 hours')) AS d FROM transactions WHERE status = 'active' AND (account_id = ?1 OR counter_account_id = ?1)")
      .bind(id)
      .first<{ d: string | null }>();
    if (first?.d && f.opened_at > first.d) {
      const vi = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}/${d.slice(0, 4)}`;
      fail(
        "opening_after_entries",
        `Tài khoản đã có giao dịch từ ${vi(first.d)} — huỷ hoặc sửa các giao dịch trước ${vi(f.opened_at)} trước, hoặc chọn ngày mở sổ từ ${vi(first.d)} trở về trước.`,
        409,
        "opened_at",
      );
    }
  }
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
  const turningOn = sepayOn && !current!.sepay_enabled;
  if (turningOn) {
    // Log chờ gán cũ (nối rồi tắt) sẽ nằm trước mốc mới: không còn trong "chưa gán" ở tab Tài khoản mà vẫn ở màn Gán.
    const pending = await db.prepare("SELECT COUNT(*) AS n FROM bank_logs WHERE account_id = ? AND status = 'pending'").bind(id).first<{ n: number }>();
    if (Number(pending?.n ?? 0) > 0) {
      fail("pending_logs", `${current!.name} còn ${pending!.n} giao dịch chưa gán. Gán hoặc bỏ qua hết rồi mới bật SePay.`, 409);
    }
  }
  const openedAt = f.opened_at === undefined ? ((current!.opened_at as string | null) ?? null) : f.opened_at;
  // Mốc theo dõi SePay (ADR-113): gửi lên thì lấy; không gửi mà vừa bật SePay cho tài khoản đã có dữ liệu trong sổ
  // (giao dịch từ ngày số dư đầu, hoặc đã Nhập số dư) thì là lúc bật — SePay gửi lại lịch sử trước đó là đếm hai lần.
  // Tài khoản chưa dùng thì để trống: Đồng bộ lại vẫn lấy được lịch sử từ ngày số dư đầu.
  let feed_from = has(b, "feed_from") ? feedFromValue(b.feed_from, openedAt, now) : undefined;
  if (feed_from === undefined && turningOn) {
    const used = await db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM transactions WHERE status = 'active' AND (account_id = ?1 OR counter_account_id = ?1)
                          AND (?2 IS NULL OR date(at, '+7 hours') >= ?2))
             OR EXISTS (SELECT 1 FROM cash_counts WHERE account_id = ?1) AS used`,
      )
      .bind(id, openedAt)
      .first<{ used: number }>();
    if (used?.used) feed_from = now.toISOString();
  }
  // Mốc mới không được vượt qua log lịch sử đã nhận (chờ gán / đã gán): dời mốc như vậy là giấu log khỏi đối soát, hay để
  // khoản đó ghi tay lần nữa. Dời sớm hơn luôn được. Log webhook luôn trong phạm vi nên không tính.
  if (feed_from && feed_from !== current!.feed_from) {
    const crossed = await db
      .prepare("SELECT 1 FROM bank_logs WHERE account_id = ? AND status IN ('pending', 'assigned') AND source <> 'webhook' AND julianday(at) < julianday(?) LIMIT 1")
      .bind(id, feed_from)
      .first();
    if (crossed) fail("feed_from_after_logs", "Đã có giao dịch ngân hàng của tài khoản này trước mốc này — chọn mốc sớm hơn.", 409, "feed_from");
  }
  // Bật "báo cả tiền ra" trên tài khoản đã nối: khoản chi trước lúc đó nhập tay, log ra cũ SePay gửi lại không tự gán.
  // Vừa bật SePay thì mốc theo dõi đã lo phần trước đó.
  const sepay_out_from = turningOn ? null : sepay_out && !current!.sepay_out ? now.toISOString() : undefined;
  // Tài khoản đang gắn mục tiêu Dự phòng đang dùng không rời ngăn Dự phòng, không tắt được (pocket UC-1209 bước 3).
  if ((f.pocket !== undefined && f.pocket !== "reserve") || f.active === false) await assertNoGoal(db, id);
  // Tài khoản riêng tư cần có chủ; chỉ chủ (cũ và mới, nếu đổi chủ cùng lúc) đổi được cờ. Gửi lại đúng giá trị đang có
  // (lưu cả sheet) không phải là đổi.
  if (has(b, "private") && typeof b.private !== "boolean") fail("invalid_input", "private phải là true hoặc false.", 400, "private");
  const requested = b.private as boolean | undefined;
  // Khoản gửi: gửi riêng tư / chủ khác mẹ → 400 pocket_follows_parent; gắn mẹ thì lấy của mẹ.
  if (parent && requested !== undefined && requested !== Boolean(parent.private)) pocketFollowsParent(parent.name, "private");
  if (parent && f.owner_member_id !== undefined && f.owner_member_id !== parent.owner_member_id) pocketFollowsParent(parent.name, "owner_member_id");
  const currentOwner = (current!.owner_member_id as string | null) ?? null;
  const owner = parent ? parent.owner_member_id : f.owner_member_id === undefined ? currentOwner : f.owner_member_id;
  const nextPrivate = parent ? Boolean(parent.private) : (requested ?? Boolean(current!.private));
  const privateChanged = nextPrivate !== Boolean(current!.private);
  // Đổi chủ tài khoản đang riêng tư mà chủ còn hoạt động: chỉ chủ đổi được (access UC-504 bước 1, ADR-133 (4)). Chủ đã tắt
  // thì tài khoản không còn bị giấu — ai cũng đổi được.
  if (owner !== currentOwner && current!.private && currentOwner !== null && currentOwner !== actor) {
    const ownerActive = await db.prepare("SELECT 1 FROM members WHERE id = ? AND active = 1").bind(currentOwner).first();
    if (ownerActive) fail("not_owner", "Chỉ chủ tài khoản riêng tư đổi được chủ.", 403, "owner_member_id");
  }
  if (nextPrivate && !owner) {
    fail("private_needs_owner", "Tài khoản riêng tư cần có chủ: chọn chủ tài khoản trước.", 400, "private");
  }
  if (privateChanged && [currentOwner, owner].some((o) => o !== null && o !== actor)) {
    fail("not_owner", "Chỉ chủ tài khoản bật / tắt được riêng tư.", 403, "private");
  }
  // Tắt ghi ngày tắt (giờ VN) để bảng cân đối vẫn tính tài khoản ở các tháng trước đó; bật lại xoá ngày tắt.
  const deactivated_at = f.active === false && current!.active ? dayKey(new Date()) : f.active === true ? null : undefined;
  const pocket_confirmed = f.pocket !== undefined ? true : undefined;
  const patch = patchStatement(db, "accounts", id, {
    ...f,
    sepay_out,
    sepay_connection_id: connectionId,
    deactivated_at,
    feed_from,
    sepay_out_from,
    pocket_confirmed,
    private: privateChanged ? nextPrivate : undefined,
    // Gắn mẹ: ngăn / xác nhận / chủ theo mẹ trong cùng câu ghi (trg_accounts_parent_follow).
    ...(attaching && parent ? { pocket: parent.pocket, pocket_confirmed: Boolean(parent.pocket_confirmed), owner_member_id: parent.owner_member_id } : {}),
  });
  if (patch) await accountBatch(db, [patch], [id]);
  return toAccount((await db.prepare(`${ACCOUNT_SQL} WHERE id = ?`).bind(id).first<Row>())!);
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
/** `actor`: người sửa — mẫu cũ hay giá trị mới có tài khoản riêng tư bị giấu với người đó → 403 private_account (ingest UC-307). */
export async function updateRule(db: D1Database, id: number, b: Input, actor: string | null = null) {
  rejectOldFields(b, ["wallet_id", "from_wallet_id"]);
  const current = await db.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<Row>();
  if (!current) fail("not_found", "Không có mã này.", 404);
  const hidden = await hiddenAccountIds(db, actor);
  assertRowWritable(current!, hidden);
  assertRowWritable({ account_id: has(b, "account_id") ? b.account_id : null, counter_account_id: has(b, "counter_account_id") ? b.counter_account_id : null }, hidden);
  const matchType = has(b, "match_type") ? oneOf(b, "match_type", ["code", "content", "account"] as const, true) : undefined;
  const meaning = has(b, "meaning") ? oneOf(b, "meaning", ["spend", "transfer", "income"] as const, true) : undefined;
  const isSalary = has(b, "is_salary") ? bool(b, "is_salary") : undefined;
  const finalMeaning = meaning ?? current!.meaning;
  const finalSalary = isSalary ?? Boolean(current!.is_salary);
  // Luật 6: máy chỉ được tự gán thu nhập cho mẫu lương.
  if (finalMeaning === "income" && !finalSalary) fail("income_needs_salary", "Mã tự gán thu nhập phải là mẫu lương.");
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
    category_id: categoryId,
    income_stream_id: streamId,
    priority: has(b, "priority") ? integer(b, "priority", { min: 0, max: 1000 }) : undefined,
    active: has(b, "active") ? bool(b, "active") : undefined,
  });
  return toRule((await db.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<Row>())!);
}

// ── Nguồn thu: ngăn của tiền về, mở kỳ lương ───────────────────────
/** Một nguồn thu như màn Cài đặt thấy; không có → 404. */
export async function getStream(db: D1Database, id: string) {
  const row = await db.prepare(`SELECT ${STREAM_COLS} FROM income_streams WHERE id = ?`).bind(id).first<Row>();
  return row ? toStream(row) : fail("not_found", "Không có nguồn thu này.", 404);
}

/**
 * "Mở kỳ lương" gửi lên (pocket UC-1205): thiếu → undefined; không phải boolean → 400 invalid_input; nguồn cho thuê
 * (`config.rental_income_stream_id`) không bật được → 400 cannot_open_cycle. Phần khoá đã bỏ → 400 model_changed.
 */
async function streamOpensCycle(db: D1Database, streamId: string, b: Input): Promise<boolean | undefined> {
  rejectOldFields(b, ["locks"]);
  if (!has(b, "opens_cycle")) return undefined;
  if (typeof b.opens_cycle !== "boolean") return fail("invalid_input", "opens_cycle phải là true hoặc false.", 400, "opens_cycle");
  if (b.opens_cycle) {
    const rental = await db.prepare("SELECT v FROM config WHERE k = 'rental_income_stream_id'").first<{ v: string }>();
    if (rental?.v === streamId) fail("cannot_open_cycle", "Tiền cho thuê không mở kỳ lương.", 400, "opens_cycle");
  }
  return b.opens_cycle;
}

export async function createIncomeStream(db: D1Database, b: Input) {
  const name = text(b, "name", { required: true, max: 60 })!;
  const id = newId(b, name);
  const opensCycle = await streamOpensCycle(db, id, b);
  if (await exists(db, "income_streams", id)) fail("duplicate", "Đã có nguồn thu với mã này.", 409);
  await db
    .prepare("INSERT INTO income_streams (id, name, sort, pocket, opens_cycle) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, integer(b, "sort", { min: 0, max: 10000 }) ?? 100, has(b, "pocket") ? pocketValue(b.pocket) : null, opensCycle ? 1 : 0)
    .run();
  return getStream(db, id);
}

export async function updateIncomeStream(db: D1Database, id: string, b: Input) {
  await getStream(db, id);
  const opensCycle = await streamOpensCycle(db, id, b);
  await patchRow(db, "income_streams", id, {
    name: has(b, "name") ? text(b, "name", { required: true, max: 60 }) : undefined,
    sort: has(b, "sort") ? integer(b, "sort", { min: 0, max: 10000 }) : undefined,
    active: has(b, "active") ? bool(b, "active") : undefined,
    // Ngăn của tiền về (UC-506): null = theo tài khoản nhận.
    pocket: has(b, "pocket") ? pocketValue(b.pocket) : undefined,
    opens_cycle: opensCycle,
  });
  return getStream(db, id);
}

// ── Tham số ─────────────────────────────────────────────────────────
/** Tham số bảng cân đối / Mốc tự do (BR-15): phần vạn, có khoảng; mặc định do migration 0031 ghi. */
const FI_RANGES = {
  fi_swr_bps: [100, 1000, 350],
  fi_inflation_bps: [0, 2000, 350],
  fi_fat_bps: [10000, 20000, 11000],
  fi_legacy_rate_bps: [50, 1000, 300],
  fi_high_interest_bps: [100, 10000, 1500],
} as const;
/** Để trống = theo sổ / chưa đặt (xoá dòng config). */
const FI_OPTIONAL = ["fi_expense_monthly", "fi_expense_must_monthly", "fi_birth_year", "fi_target_age_f1", "fi_target_age_f2", "fi_target_age_f3"] as const;
const FI_SAFETY_DEFAULT = "6,12,24";

export type FiConfig = { [K in keyof typeof FI_RANGES]: number } & { [K in (typeof FI_OPTIONAL)[number]]: number | null } & { fi_safety_months: string };

/** Mọi tham số fi_* trong một câu; thiếu / hỏng → mặc định (khoá bắt buộc) hoặc null (khoá tuỳ chọn). */
export async function readFiConfig(db: D1Database): Promise<FiConfig> {
  const res = await db.prepare("SELECT k, v FROM config WHERE k LIKE 'fi\\_%' ESCAPE '\\'").all<{ k: string; v: string }>();
  const map = new Map((res.results ?? []).map((r) => [r.k, r.v]));
  const num = (k: string) => {
    const n = Number(map.get(k));
    return map.has(k) && Number.isInteger(n) ? n : null;
  };
  const out = { fi_safety_months: map.get("fi_safety_months") ?? FI_SAFETY_DEFAULT } as FiConfig;
  for (const [k, [, , fallback]] of Object.entries(FI_RANGES)) (out as Record<string, unknown>)[k] = num(k) ?? fallback;
  for (const k of FI_OPTIONAL) out[k] = num(k);
  return out;
}

async function readConfig(db: D1Database) {
  const reward = await db.prepare("SELECT v FROM config WHERE k = 'surplus_reward_account'").first<{ v: string }>();
  return {
    salary_min_amount: await configNumber(db, "salary_min_amount", 1_000_000),
    interest_max_amount: await interestMaxAmount(db),
    safety_fund_months: await configNumber(db, "safety_fund_months", 6),
    payday_day: await configNumber(db, "payday_day", DEFAULT_PAYDAY_DAY),
    ...(await readFiConfig(db)),
    savings_pct: await configNumber(db, "savings_pct", DEFAULT_SAVINGS_PCT),
    surplus_savings_pct: await configNumber(db, "surplus_savings_pct", DEFAULT_SURPLUS_SAVINGS_PCT),
    // Giá trị đã lưu, không lọc tài khoản đã tắt / đổi ngăn — để Cài đặt vẫn thấy đã chọn gì; kỳ lương tự coi là chưa chọn.
    surplus_reward_account: reward?.v || null,
  };
}

/** Tham số chốt tháng đã bỏ (ADR-123): gửi lên dù giá trị gì → 400 model_changed, không ghi gì. */
const MONTH_CLOSE_KEYS = ["month_close_wealth_pct", "month_close_reward_wallet"] as const;

const REWARD_ACCOUNT_TEXT = "Ví Thưởng phải là một tài khoản đang dùng ở ngăn Dự phòng, không gắn mục tiêu nào, không là khoản gửi của tài khoản khác.";

/**
 * Dư kỳ trước (pocket UC-1207, UC-1209 bước 4): `surplus_savings_pct` số nguyên 0–100 → 400 invalid_input;
 * `surplus_reward_account` là tài khoản đang dùng, ngăn Dự phòng, không gắn mục tiêu đang dùng, không là tài khoản con
 * (khoản gửi kỳ hạn) → không thì 400 invalid_account; null / "" = bỏ chọn.
 */
async function surplusConfigWrites(db: D1Database, b: Input): Promise<D1PreparedStatement[]> {
  const upsert = (k: string, v: string) => db.prepare("INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(k, v);
  const out: D1PreparedStatement[] = [];
  if (has(b, "surplus_savings_pct")) {
    const v = b.surplus_savings_pct;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100) {
      fail("invalid_input", "Phần dư kỳ trước vào Tích luỹ là số nguyên từ 0 đến 100.", 400, "surplus_savings_pct");
    }
    out.push(upsert("surplus_savings_pct", String(v)));
  }
  if (has(b, "surplus_reward_account")) {
    const v = b.surplus_reward_account;
    if (v === null || v === "") {
      out.push(db.prepare("DELETE FROM config WHERE k = 'surplus_reward_account'"));
    } else {
      const ok =
        typeof v === "string" &&
        (await db
          .prepare(
            `SELECT 1 FROM accounts a WHERE a.id = ? AND a.active = 1 AND a.pocket = 'reserve' AND a.parent_account_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = a.id AND g.active = 1)`,
          )
          .bind(v)
          .first());
      if (!ok) fail("invalid_account", REWARD_ACCOUNT_TEXT, 400, "surplus_reward_account");
      out.push(upsert("surplus_reward_account", v as string));
    }
  }
  return out;
}

/** Kiểm các khoá fi_* có trong body (sai → 400 invalid_input kèm tên ô), trả lệnh ghi; khoá tuỳ chọn gửi null / "" → xoá. */
async function fiConfigWrites(db: D1Database, b: Input, now: Date): Promise<D1PreparedStatement[]> {
  const bad = (k: string, message: string): never => fail("invalid_input", message, 400, k);
  const upsert = (k: string, v: string) => db.prepare("INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(k, v);
  const whole = (k: string, min: number, max: number) => {
    const v = b[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) bad(k, `${k} phải là số nguyên từ ${min} tới ${max}.`);
    return v as number;
  };
  const out: D1PreparedStatement[] = [];
  for (const [k, [min, max]] of Object.entries(FI_RANGES)) if (has(b, k)) out.push(upsert(k, String(whole(k, min, max))));
  if (has(b, "fi_safety_months")) {
    const raw = b.fi_safety_months;
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",").map((s) => Number(s.trim())) : [];
    const ok = list.length === 3 && list.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 60 && (i === 0 || n > list[i - 1]));
    if (!ok) bad("fi_safety_months", "Mốc an tâm là ba số tháng 1–60, tăng dần (ví dụ 6,12,24).");
    out.push(upsert("fi_safety_months", list.join(",")));
  }
  const year = Number(new Date(now.getTime() + 7 * 3600_000).getUTCFullYear());
  const stored = await readFiConfig(db);
  const blank = (k: string) => b[k] === null || b[k] === "";
  const birth = has(b, "fi_birth_year") ? (blank("fi_birth_year") ? null : whole("fi_birth_year", 1900, year)) : stored.fi_birth_year;
  for (const k of FI_OPTIONAL) {
    if (!has(b, k)) continue;
    if (blank(k)) {
      out.push(db.prepare("DELETE FROM config WHERE k = ?").bind(k));
      continue;
    }
    if (k === "fi_expense_monthly" || k === "fi_expense_must_monthly") out.push(upsert(k, String(whole(k, 0, 1e12))));
    else if (k === "fi_birth_year") out.push(upsert(k, String(birth)));
    else {
      // Tuổi mục tiêu phải lớn hơn tuổi hiện tại (khi đã có năm sinh), tối đa 100.
      const age = whole(k, 1, 100);
      if (birth !== null && age <= year - birth) bad(k, `Tuổi mục tiêu phải lớn hơn tuổi hiện tại (${year - birth}).`);
      out.push(upsert(k, String(age)));
    }
  }
  return out;
}

export async function updateConfig(db: D1Database, b: Input, now: Date = new Date()) {
  const old = MONTH_CLOSE_KEYS.filter((k) => has(b, k));
  if (old.length) {
    throw new DomainError("model_changed", `Ví nhà v2 đã bỏ chốt tháng: dư kỳ trước chia theo surplus_savings_pct / surplus_reward_account — bỏ trường ${old.join(", ")}.`, 400, undefined, [...old]);
  }
  if (has(b, "surplus_reward_earmark")) {
    throw new DomainError("model_changed", "Ví nhà v2: Ví Thưởng là một tài khoản Dự phòng — gửi surplus_reward_account, bỏ trường surplus_reward_earmark.", 400, undefined, ["surplus_reward_earmark"]);
  }
  const salary = integer(b, "salary_min_amount", { min: 0, max: 1e12 });
  const months = integer(b, "safety_fund_months", { min: 1, max: 36 });
  const payday = integer(b, "payday_day", { min: 1, max: 31 });
  const savingsPct = b.savings_pct;
  if (has(b, "savings_pct") && (typeof savingsPct !== "number" || !Number.isInteger(savingsPct) || savingsPct < 1 || savingsPct > 100)) {
    fail("invalid_input", "% Tích luỹ là số nguyên từ 1 đến 100.", 400, "savings_pct");
  }
  const interest = b.interest_max_amount;
  if (has(b, "interest_max_amount") && (typeof interest !== "number" || !Number.isInteger(interest) || interest < 0 || interest > INTEREST_MAX_AMOUNT_LIMIT)) {
    fail("invalid_input", "Ngưỡng lãi tiền gửi là số nguyên từ 0 đến 10.000.000 (0 = tắt).", 400, "interest_max_amount");
  }
  const upsert = (k: string, v: number) => db.prepare("INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(k, String(v));
  const statements = [
    ...(salary !== null ? [upsert("salary_min_amount", salary)] : []),
    ...(has(b, "interest_max_amount") ? [upsert("interest_max_amount", interest as number)] : []),
    ...(months !== null ? [upsert("safety_fund_months", months)] : []),
    ...(payday !== null ? [upsert("payday_day", payday)] : []),
    ...(await fiConfigWrites(db, b, now)),
    ...(await surplusConfigWrites(db, b)),
    ...(has(b, "savings_pct") ? [upsert("savings_pct", savingsPct as number)] : []),
  ];
  try {
    if (statements.length) await db.batch(statements);
  } catch (err) {
    // Trigger 0041 (ADR-134) / 0044: máy khác vừa gắn tài khoản này vào một mục tiêu hay biến nó thành khoản gửi — không ghi gì.
    if (!/reward_has_goal|reward_is_child/.test(String(err))) throw err;
    fail("invalid_account", REWARD_ACCOUNT_TEXT, 400, "surplus_reward_account");
  }
  return readConfig(db);
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
