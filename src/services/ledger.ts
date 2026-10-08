// Tầng dịch vụ: đọc/ghi D1 rồi gọi các hàm thuần trong src/domain.
// REST (/v1), MCP và cron đều đi qua đây — không route nào tự viết SQL nghiệp vụ.

import { allocate, type AllocationResult, type WalletRule } from "../domain/allocation";
import { endOfMonthIso, monthSweep } from "../domain/close";
import { buildEntry, MANUAL_MEANINGS, type EntryInput, type TxRow } from "../domain/entry";
import { mondaysInMonth, monthKey, weekKey, weekStart } from "../domain/period";
import { normalizeContent } from "../domain/rules";
import { buildSnapshot, monthTarget, openingWealthBuildingCredit, weekTarget, type Snapshot, type SnapshotData } from "../domain/snapshot";
import { newTransferMemo, transferOrders, type TransferOrderDraft } from "../domain/transfer-orders";
import { DomainError, type AccountRole, type Refs, type WalletRef } from "../domain/types";
import { formatMoney } from "../notify/format";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const toMap = (list: { w: string; s: number | null }[]) => Object.fromEntries(list.map((x) => [x.w, Number(x.s ?? 0)]));

// ── Dữ liệu tham chiếu ─────────────────────────────────────────────

export async function loadRefs(db: D1Database): Promise<Refs> {
  const [wallets, rules, categories, accounts, members, streams, locks, tenants, rental, debts, receivables] = await db.batch([
    // `private` ở đây là "đang ẩn với người khác": ví private của người đã tắt không còn ẩn (UC-504) — tiền vẫn nằm đó,
    // chủ hộ phải thấy để chuyển ra. Cờ gốc của ví đọc ở màn Cài đặt (settings.WALLET_SQL).
    db.prepare(
      `SELECT w.id, w.name, w.tier, w.must_group AS mustGroup, w.kind, w.scope, w.member_id AS memberId, w.account_id AS accountId,
              (w.private = 1 AND EXISTS (SELECT 1 FROM members m WHERE m.id = w.member_id AND m.active = 1)) AS private, w.sort
       FROM wallets w WHERE w.active = 1 ORDER BY w.sort`,
    ),
    db.prepare(
      `SELECT w.id AS walletId, w.tier, w.must_group AS mustGroup, w.kind, a.mode, a.period, a.amount, a.percent,
              a.target_amount AS targetAmount, a.target_date AS targetDate, a.floor_amount AS floorAmount, a.priority,
              a.split_weekly AS splitWeekly
       FROM allocations a JOIN wallets w ON w.id = a.wallet_id WHERE a.active = 1 AND w.active = 1`,
    ),
    db.prepare(`SELECT id, name, default_wallet_id AS defaultWalletId, icon, sort FROM categories WHERE active = 1 ORDER BY sort, name`),
    db.prepare(
      `SELECT id, name, kind, owner_member_id AS ownerMemberId, sepay_enabled AS sepayEnabled, sepay_out AS sepayOut, opened_at AS openedAt, locked, role
       FROM accounts WHERE active = 1 ORDER BY kind, name`,
    ),
    db.prepare(`SELECT id, name, role FROM members WHERE active = 1 ORDER BY role = 'owner' DESC, name`),
    db.prepare(`SELECT id, name, active FROM income_streams ORDER BY sort, name`),
    db.prepare(`SELECT stream_id AS streamId, wallet_id AS walletId, percent FROM income_stream_locks ORDER BY sort, wallet_id`),
    db.prepare(`SELECT id, name, active FROM tenants ORDER BY name`),
    db.prepare(`SELECT v FROM config WHERE k = 'rental_income_stream_id'`),
    db.prepare(`SELECT debt_id AS id, name, active, balance FROM v_debt_balance ORDER BY balance DESC, name`),
    db.prepare(`SELECT receivable_id AS id, name, active, balance FROM v_receivable_balance ORDER BY balance DESC, name`),
  ]);
  const lockRows = rows<{ streamId: string; walletId: string; percent: number }>(locks!);
  const books = (res: D1Result) =>
    rows<{ id: string; name: string; active: number; balance: number }>(res).map((b) => ({ ...b, active: Boolean(b.active), balance: Number(b.balance) }));
  return {
    wallets: rows<Omit<WalletRef, "private"> & { private: number }>(wallets!).map((w) => ({ ...w, private: Boolean(w.private) })),
    rules: rows<Omit<WalletRule, "splitWeekly"> & { splitWeekly: number }>(rules!).map((r) => ({ ...r, splitWeekly: Boolean(r.splitWeekly) })),
    categories: rows(categories!) as unknown as Refs["categories"],
    accounts: rows<Omit<Refs["accounts"][number], "sepayEnabled" | "sepayOut" | "locked"> & { sepayEnabled: number; sepayOut: number; locked: number }>(accounts!).map((a) => ({
      ...a,
      sepayEnabled: Boolean(a.sepayEnabled),
      sepayOut: Boolean(a.sepayEnabled) && Boolean(a.sepayOut),
      locked: Boolean(a.locked),
    })),
    members: rows(members!) as unknown as Refs["members"],
    incomeStreams: rows<{ id: string; name: string; active: number }>(streams!).map((s) => ({
      ...s,
      active: Boolean(s.active),
      locks: lockRows.filter((l) => l.streamId === s.id).map(({ walletId, percent }) => ({ walletId, percent })),
    })),
    tenants: rows<{ id: string; name: string; active: number }>(tenants!).map((t) => ({ ...t, active: Boolean(t.active) })),
    debts: books(debts!),
    receivables: books(receivables!),
    rentalIncomeStreamId: rows<{ v: string }>(rental!)[0]?.v || null,
  };
}

const TX_COLUMNS = [
  "at", "amount", "meaning", "wallet_id", "counter_wallet_id", "account_id", "counter_account_id", "category_id",
  "by_member_id", "link_id", "batch_id", "asset_kind", "taxable", "week_key", "month_key", "source", "note", "client_id",
  "income_stream_id", "tenant_id", "debt_id", "receivable_id",
] as const;

export function insertTx(db: D1Database, row: TxRow): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO transactions (${TX_COLUMNS.join(", ")}) VALUES (${TX_COLUMNS.map(() => "?").join(", ")})`)
    .bind(...TX_COLUMNS.map((c) => row[c] ?? null));
}

export const getTransaction = (db: D1Database, id: number) => db.prepare("SELECT * FROM transactions WHERE id = ?").bind(id).first<Row>();

// ── Nhập tay ────────────────────────────────────────────────────────

export interface WalletStatus {
  walletId: string;
  name: string;
  balance: number | null;
  weekRemaining: number | null;
  monthRemaining: number | null;
}

/** Số liệu đưa vào toast ngay sau khi ghi: ví này còn bao nhiêu. */
export async function walletStatus(db: D1Database, walletId: string, viewerId: string | null, now: Date): Promise<WalletStatus | null> {
  const refs = await loadRefs(db);
  const wallet = refs.wallets.find((w) => w.id === walletId);
  if (!wallet) return null;
  if (wallet.private && wallet.memberId !== viewerId) return { walletId, name: wallet.name, balance: null, weekRemaining: null, monthRemaining: null };
  const [bal, wk, mo] = await db.batch([
    db.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = ?").bind(walletId),
    db.prepare("SELECT spent FROM v_spent_week WHERE wallet_id = ? AND week_key = ?").bind(walletId, weekKey(now)),
    db.prepare("SELECT spent FROM v_spent_month WHERE wallet_id = ? AND month_key = ?").bind(walletId, monthKey(now)),
  ]);
  const rule = refs.rules.find((r) => r.walletId === walletId);
  const balance = Number(rows<{ balance: number }>(bal!)[0]?.balance ?? 0);
  const spentWeek = Number(rows<{ spent: number }>(wk!)[0]?.spent ?? 0);
  const spentMonth = Number(rows<{ spent: number }>(mo!)[0]?.spent ?? 0);
  const target = monthTarget(rule, monthKey(now));
  const week = weekTarget(rule, weekStart(weekKey(now)).slice(0, 7));
  return {
    walletId,
    name: wallet.name,
    balance,
    weekRemaining: week === null ? null : Math.min(week - spentWeek, balance),
    monthRemaining: target === null ? null : target - spentMonth,
  };
}

export async function createEntry(db: D1Database, input: EntryInput, memberId: string | null, now: Date) {
  const clientId = input.client_id?.trim() || null;
  const existing = async () =>
    clientId ? db.prepare("SELECT * FROM transactions WHERE client_id = ?").bind(clientId).first<Row>() : null;

  const already = await existing();
  if (already) return { tx: already, duplicate: true, wallet: null };

  const refs = await loadRefs(db);
  const row = buildEntry(input, refs, memberId, now);

  // Chiều tiền mà SePay báo về thì tự về từ ngân hàng. Ghi tay thêm chiều đó là đếm cùng một khoản tiền hai lần
  // (nhập tay rồi lại gán log), và đối soát không bắt được vì nó chỉ so log với log (ADR-48, tinh chỉnh ADR-66):
  // tiền VÀO tài khoản đã nối SePay luôn bị chặn; tiền RA chỉ bị chặn khi SePay báo cả tiền ra (`sepay_out`).
  const fed =
    refs.accounts.find((a) => a.sepayEnabled && a.id === row.counter_account_id) ??
    refs.accounts.find((a) => a.sepayOut && a.id === row.account_id);
  if (fed) {
    throw new DomainError("fed_account", `${fed.name} đã nối ngân hàng: khoản này sẽ tự về, gán nó ở màn Gán thay vì nhập tay.`);
  }

  if (row.meaning === "buy_asset") {
    const cash = Number((await db.prepare("SELECT cash FROM v_wealth_building").first<{ cash: number }>())?.cash ?? 0);
    if (row.amount > cash) throw new DomainError("insufficient_cash", "Tích sản không đủ tiền mặt để mua khoản này.", 409);
  }
  await resolveLink(db, row);

  let id: number;
  try {
    const res = await insertTx(db, row).run();
    id = Number(res.meta.last_row_id);
  } catch (err) {
    // Hai lần gửi cùng client_id chạy song song: lần thua đọc lại bản đã ghi.
    const raced = await existing();
    if (raced) return { tx: raced, duplicate: true, wallet: null };
    throw err;
  }
  // Chuyển ngân sách (không có tài khoản): báo ví nhận, thường là ví vừa được bù.
  const walletId = row.meaning === "transfer" && !row.account_id ? row.wallet_id : row.counter_wallet_id ?? row.wallet_id;
  return {
    tx: await getTransaction(db, id),
    duplicate: false,
    wallet: walletId ? await walletStatus(db, walletId, memberId, now) : null,
  };
}

/**
 * Các lệnh gỡ một lần chia của khoản thu `incomeTxId` (rỗng nếu khoản đó chưa được chia): huỷ mọi bút toán nạp ví
 * của lần chia và bỏ các lệnh chuyển tiền chưa làm. Tiền đã chuyển thật theo lần chia này thì không gỡ được.
 * Dùng khi huỷ một khoản thu ghi nhầm — kể cả "lương" giả do người ngoài chuyển tiền với nội dung khớp mẫu.
 */
export async function undoAllocationStatements(db: D1Database, incomeTxId: number): Promise<D1PreparedStatement[]> {
  const run = await db.prepare("SELECT batch_id FROM allocation_runs WHERE income_tx_id = ?").bind(incomeTxId).first<{ batch_id: string }>();
  if (!run) return [];
  const settled = await db.prepare("SELECT COUNT(*) AS n FROM transfer_orders WHERE batch_id = ? AND status = 'done'").bind(run.batch_id).first<{ n: number }>();
  if (Number(settled?.n ?? 0) > 0) {
    throw new DomainError("allocation_settled", "Tiền của lần chia này đã được chuyển thật; gỡ lệnh chuyển tiền trước rồi mới huỷ được.", 409);
  }
  // allocation_runs giữ nguyên: một khoản thu đã huỷ không bao giờ được chia lại.
  return [
    db.prepare("UPDATE transactions SET status = 'void' WHERE status = 'active' AND meaning = 'fund' AND batch_id = ?").bind(run.batch_id),
    db.prepare("UPDATE transfer_orders SET status = 'skipped' WHERE status = 'pending' AND batch_id = ?").bind(run.batch_id),
  ];
}

/** Kiểm một giao dịch có huỷ / sửa tay được không: chỉ khoản ghi tay. Giao dịch ngân hàng đi đường gỡ gán (ingest UC-306). */
async function manualTxOrThrow(db: D1Database, id: number) {
  const tx = await getTransaction(db, id);
  if (!tx) throw new DomainError("not_found", "Không có giao dịch này.", 404);
  if (tx.status !== "active") throw new DomainError("already_void", "Giao dịch đã huỷ trước đó.", 409);
  if (tx.source === "system" || tx.meaning === "fund") {
    throw new DomainError("system_tx", "Bút toán do hệ thống sinh ra không huỷ lẻ được.", 409);
  }
  if (tx.source === "sepay" || tx.log_id) {
    throw new DomainError("bank_tx", "Giao dịch từ ngân hàng không xoá được — gỡ gán để gán lại.", 409);
  }
  return tx;
}

export async function voidTransaction(db: D1Database, id: number) {
  const tx = await manualTxOrThrow(db, id);
  const undo = tx.meaning === "income" ? await undoAllocationStatements(db, id) : [];
  await runUndo(db, [...undo, db.prepare("UPDATE transactions SET status = 'void' WHERE id = ? AND status = 'active'").bind(id)]);
  return getTransaction(db, id);
}

/**
 * Sửa một khoản ghi tay (ADR-73): kiểm khoản mới đầy đủ như khi nhập, rồi trong MỘT batch huỷ khoản cũ (gỡ luôn
 * lần chia nếu là khoản thu đã chia) và ghi khoản mới — sổ vẫn chỉ ghi thêm, không lúc nào thiếu khoản đó.
 * Khoản thu mới không tự chia. Người ghi giữ là người ghi khoản cũ. Gửi lại cùng `client_id` trả đúng khoản đã ghi.
 */
export async function replaceTransaction(db: D1Database, id: number, input: EntryInput, memberId: string | null, now: Date) {
  const clientId = input.client_id?.trim() || null;
  // Trả về dạng dòng sổ (kèm tên danh mục…) để PWA nói được "Đã sửa thành 120.000 ₫ Xăng xe".
  const existing = async () => (clientId ? db.prepare(`${TX_VIEW} WHERE t.client_id = ?`).bind(clientId).first<Row>() : null);
  const already = await existing();
  if (already) return { tx: already, replaced: id, duplicate: true, wallet: null };

  const old = await manualTxOrThrow(db, id);
  if (!(MANUAL_MEANINGS as readonly unknown[]).includes(old.meaning)) {
    throw new DomainError("not_editable", "Khoản điều chỉnh sau đếm ví không sửa được — xoá rồi đếm lại.", 409);
  }
  const author = (old.by_member_id as string | null) ?? memberId;
  // Sổ đối ứng / người thuê đã tắt sau khi ghi: khoản cũ vẫn sửa được mà giữ nguyên chỗ gắn.
  const keep = <T extends { id: string; active: boolean }>(list: T[], linked: unknown) => list.map((b) => (b.id === linked ? { ...b, active: true } : b));
  const loaded = await loadRefs(db);
  const refs: Refs = {
    ...loaded,
    debts: keep(loaded.debts, old.debt_id),
    receivables: keep(loaded.receivables, old.receivable_id),
    tenants: keep(loaded.tenants, old.tenant_id),
  };
  const row = buildEntry(input, refs, author, now);

  const fed =
    refs.accounts.find((a) => a.sepayEnabled && a.id === row.counter_account_id) ??
    refs.accounts.find((a) => a.sepayOut && a.id === row.account_id);
  if (fed) {
    throw new DomainError("fed_account", `${fed.name} đã nối ngân hàng: khoản này sẽ tự về, gán nó ở màn Gán thay vì nhập tay.`);
  }
  if (row.meaning === "buy_asset") {
    const cash = Number((await db.prepare("SELECT cash FROM v_wealth_building").first<{ cash: number }>())?.cash ?? 0);
    // Khoản cũ cũng là mua tài sản thì tiền của nó được trả lại Tích sản khi huỷ.
    const freed = old.meaning === "buy_asset" ? Number(old.amount) : 0;
    if (row.amount > cash + freed) throw new DomainError("insufficient_cash", "Tích sản không đủ tiền mặt để mua khoản này.", 409);
  }
  await resolveLink(db, row, id);
  // Khoản gốc đang có khoản hoàn tiền / nhận lại trỏ về: khoản mới thay nó phải còn là khoản gốc hợp lệ của chúng
  // (cùng meaning; khoản cho vay đổi người thì không khác người của khoản nhận lại) — rồi chúng trỏ sang khoản mới.
  const returns = rows<{ receivable_id: string | null }>(await db.prepare(`SELECT receivable_id FROM ${LINKED_RETURNS}`).bind(id).all());
  const otherPerson = returns.some((r) => row.receivable_id && r.receivable_id && r.receivable_id !== row.receivable_id);
  if (returns.length > 0 && (row.meaning !== old.meaning || otherPerson)) {
    throw new DomainError("invalid_link", "Khoản này đang có khoản trả lại trỏ về — gỡ liên kết trước.");
  }

  const undo = old.meaning === "income" ? await undoAllocationStatements(db, id) : [];
  // Khoản mới chỉ được ghi khi khoản cũ còn hiệu lực ngay trong batch: huỷ chen ở request khác thì không ghi gì mới.
  const insert = db
    .prepare(
      `INSERT INTO transactions (${TX_COLUMNS.join(", ")}) SELECT ${TX_COLUMNS.map(() => "?").join(", ")}
       WHERE EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'active')`,
    )
    .bind(...TX_COLUMNS.map((c) => row[c] ?? null), id);
  // Ngay sau INSERT cùng điều kiện: last_insert_rowid() là khoản mới; khoản cũ đã huỷ chen thì không ghi, không trỏ.
  const relink = db
    .prepare(
      `UPDATE transactions SET link_id = last_insert_rowid()
       WHERE id IN (SELECT id FROM ${LINKED_RETURNS}) AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND status = 'active')`,
    )
    .bind(id, id);
  let results: D1Result[];
  try {
    results = await runUndo(db, [...undo, insert, relink, db.prepare("UPDATE transactions SET status = 'void' WHERE id = ? AND status = 'active'").bind(id)]);
  } catch (err) {
    // Hai lần gửi cùng client_id chạy song song: lần thua đọc lại bản đã ghi.
    const raced = await existing();
    if (raced) return { tx: raced, replaced: id, duplicate: true, wallet: null };
    throw err;
  }
  const written = results[undo.length]!.meta;
  if (!written.changes) throw new DomainError("already_void", "Giao dịch đã huỷ trước đó.", 409);
  const newId = Number(written.last_row_id);
  const walletId = row.meaning === "transfer" && !row.account_id ? row.wallet_id : row.counter_wallet_id ?? row.wallet_id;
  return {
    tx: await transactionView(db, newId),
    replaced: id,
    duplicate: false,
    wallet: walletId ? await walletStatus(db, walletId, memberId, now) : null,
  };
}

/**
 * Chạy batch có gỡ lần chia. Kiểm tra "tiền đã chuyển thật chưa" ở undoAllocationStatements là đọc-rồi-ghi;
 * nếu lệnh vừa được đánh dấu 'done' ở request khác, trigger (migration 0006) huỷ cả batch — báo lỗi rõ ràng.
 */
export async function runUndo(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  try {
    return await db.batch(statements);
  } catch (err) {
    if (/allocation_settled/.test(String(err))) {
      throw new DomainError("allocation_settled", "Tiền của lần chia này vừa được đánh dấu đã chuyển; gỡ lệnh chuyển tiền trước rồi mới huỷ được.", 409);
    }
    throw err;
  }
}

/**
 * Ngưỡng tối thiểu để một khoản khớp mẫu lương được tự ghi và tự chia; dưới ngưỡng thì hỏi như mọi tiền vào khác.
 * Đặt 0 để bỏ ngưỡng.
 */
export async function salaryMinAmount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT v FROM config WHERE k = 'salary_min_amount'").first<{ v: string }>();
  const n = row ? Number(row.v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : 1_000_000;
}

/** Các khoản hoàn tiền / nhận lại còn hiệu lực trỏ về một khoản gốc (`link_id` = ?, ledger UC-101 bước 4b). */
const LINKED_RETURNS = `transactions WHERE link_id = ? AND status = 'active' AND meaning IN ('refund', 'collect')`;

/** Một dòng sổ để xem: kèm tên danh mục, ví, sổ đối ứng, người thuê và cờ khoản thu đã được chia chưa. */
const TX_FROM = `FROM transactions t
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN wallets w ON w.id = t.wallet_id
  LEFT JOIN wallets cw ON cw.id = t.counter_wallet_id
  LEFT JOIN debts d ON d.id = t.debt_id
  LEFT JOIN receivables r ON r.id = t.receivable_id
  LEFT JOIN tenants tn ON tn.id = t.tenant_id`;
const TX_VIEW = `SELECT t.*, c.name AS category_name, COALESCE(w.name, cw.name) AS wallet_name,
         d.name AS debt_name, r.name AS receivable_name, tn.name AS tenant_name,
         EXISTS (SELECT 1 FROM allocation_runs ar WHERE ar.income_tx_id = t.id) AS allocated
  ${TX_FROM}`;

/** Các loại xem được trong sổ (mọi loại trừ `fund` — bút toán nạp ví của lần chia không hiện, ledger UC-111). */
export const BOOK_MEANINGS = ["spend", "income", "refund", "transfer", "lend", "collect", "buy_asset", "adjust"] as const;

/** Bộ lọc sổ giao dịch (pwa UC-716): mọi trường tuỳ chọn, các trường có mặt cùng phải khớp. */
export interface TxFilter {
  /** `YYYY-MM`, so với `month_key`. */
  month?: string;
  meanings?: string[];
  categoryId?: string;
  /** Khớp ví được cộng hoặc ví bị trừ. */
  walletId?: string;
  /** Khớp tài khoản tiền ra hoặc tiền vào. */
  accountId?: string;
  /** Người ghi (`by_member_id`). */
  memberId?: string;
  /** `bank`: từ ngân hàng (`source='sepay'` hoặc có log); `manual`: ghi tay. */
  source?: "manual" | "bank";
  /** Chữ cần tìm (đã cắt khoảng trắng, ≥ 2 ký tự): ghi chú, nội dung ngân hàng, tên danh mục / người. */
  q?: string;
  includeVoid?: boolean;
}

/** Một chỗ dựng WHERE cho cả danh sách lẫn tổng — hai thứ luôn cùng một tập dòng. Dùng các bí danh của `TX_FROM`. */
function txWhere(f: TxFilter): { sql: string; binds: unknown[] } {
  const parts = ["t.meaning <> 'fund'"];
  const binds: unknown[] = [];
  if (!f.includeVoid) parts.push("t.status = 'active'");
  if (f.month) {
    parts.push("t.month_key = ?");
    binds.push(f.month);
  }
  if (f.meanings?.length) {
    parts.push(`t.meaning IN (${f.meanings.map(() => "?").join(", ")})`);
    binds.push(...f.meanings);
  }
  if (f.categoryId) {
    parts.push("t.category_id = ?");
    binds.push(f.categoryId);
  }
  if (f.walletId) {
    parts.push("(t.wallet_id = ? OR t.counter_wallet_id = ?)");
    binds.push(f.walletId, f.walletId);
  }
  if (f.accountId) {
    parts.push("(t.account_id = ? OR t.counter_account_id = ?)");
    binds.push(f.accountId, f.accountId);
  }
  if (f.memberId) {
    parts.push("t.by_member_id = ?");
    binds.push(f.memberId);
  }
  if (f.source === "bank") parts.push("(t.source = 'sepay' OR t.log_id IS NOT NULL)");
  if (f.source === "manual") parts.push("(t.source = 'manual' AND t.log_id IS NULL)");
  if (f.q) {
    // LIKE so chữ đã lưu (không phân biệt hoa thường với chữ không dấu); % và _ người gõ là chữ thường. Thêm dạng bỏ dấu
    // của chữ tìm (`normalizeContent`) để "thuốc" khớp nội dung ngân hàng không dấu "CHUYEN TIEN THUOC".
    const likes = [...new Set([f.q, normalizeContent(f.q)])].map((s) => `%${s.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    const cols = ["t.note", "c.name", "d.name", "r.name", "tn.name"];
    const hit = (col: string) => likes.map(() => `${col} LIKE ? ESCAPE '\\'`).join(" OR ");
    parts.push(`(${cols.map(hit).join(" OR ")} OR EXISTS (SELECT 1 FROM bank_logs l WHERE l.id IN (t.log_id, t.log_id_2) AND (${hit("l.content")})))`);
    binds.push(...cols.flatMap(() => likes), ...likes);
  }
  return { sql: parts.join(" AND "), binds };
}

/**
 * Sổ giao dịch, mới nhất trước, theo bộ lọc. `before` là id của dòng cuối trang trước: trang sau bắt đầu ngay sau dòng
 * đó theo (at, id). Mặc định ẩn khoản đã xoá (`status='void'`) — chúng vẫn nằm trong sổ (luật ghi thêm, ADR-02), chỉ
 * không hiện; `includeVoid` để xem lại.
 */
export async function listTransactions(db: D1Database, filter: TxFilter, limit: number, before?: number) {
  const where = txWhere(filter);
  const res = await db
    .prepare(
      `${TX_VIEW}
       WHERE ${where.sql}
         AND (? IS NULL OR (t.at, t.id) < (SELECT at, id FROM transactions WHERE id = ?))
       ORDER BY t.at DESC, t.id DESC LIMIT ?`,
    )
    .bind(...where.binds, before ?? null, before ?? null, Math.min(Math.max(limit, 1), 200))
    .all();
  return rows(res);
}

export interface TxSummary {
  count: number;
  spend: number;
  refund: number;
  income: number;
  lend: number;
  collect: number;
  transfer: number;
  buy_asset: number;
  /** Điều chỉnh sau đếm ví: tiền thật nhiều hơn sổ (tiền vào tài khoản). */
  adjust_in: number;
  /** … ít hơn sổ (tiền ra khỏi tài khoản). */
  adjust_out: number;
}

/**
 * Tổng của đúng tập dòng mà sổ đang lọc, theo loại — một truy vấn GROUP BY. Chỉ khoản còn hiệu lực: khoản đã xoá
 * không tính vào số nào, kể cả khi đang bật xem chúng.
 */
export async function transactionSummary(db: D1Database, filter: TxFilter): Promise<TxSummary> {
  const where = txWhere({ ...filter, includeVoid: false });
  const res = await db
    .prepare(
      `SELECT CASE WHEN t.meaning <> 'adjust' THEN t.meaning WHEN t.counter_account_id IS NOT NULL THEN 'adjust_in' ELSE 'adjust_out' END AS k,
              COUNT(*) AS n, SUM(t.amount) AS s
       ${TX_FROM}
       WHERE ${where.sql}
       GROUP BY k`,
    )
    .bind(...where.binds)
    .all();
  const out: TxSummary = { count: 0, spend: 0, refund: 0, income: 0, lend: 0, collect: 0, transfer: 0, buy_asset: 0, adjust_in: 0, adjust_out: 0 };
  for (const g of rows<{ k: Exclude<keyof TxSummary, "count">; n: number; s: number }>(res)) {
    out.count += Number(g.n);
    out[g.k] = Number(g.s);
  }
  return out;
}

/**
 * Khoản tiền về nối về khoản gốc (`link_id`, ledger UC-101 bước 4b): `refund` → `spend` còn hiệu lực (không chọn danh mục
 * thì lấy danh mục của khoản chi), `collect` → `lend` còn hiệu lực (không chọn khoản phải thu thì lấy của khoản cho vay;
 * chọn khác người thì `invalid_link`). Khoản gốc khác chính khoản đang được thay `selfId`. Chỉ là liên kết để đọc: không đổi
 * số dư nào. Dùng chung cho nhập tay, sửa, và gán log (ingest UC-305 bước 6.7).
 */
export async function resolveLink(db: D1Database, row: Pick<TxRow, "meaning" | "link_id" | "category_id" | "receivable_id">, selfId?: number) {
  if (row.link_id === null) return;
  const linked = row.link_id === selfId ? null : await getTransaction(db, row.link_id);
  const valid = linked?.status === "active";
  if (row.meaning === "collect") {
    if (!valid || linked!.meaning !== "lend") {
      throw new DomainError("invalid_link", "Khoản nhận lại phải trỏ về một khoản cho vay còn hiệu lực.");
    }
    const lentTo = (linked!.receivable_id as string | null) ?? null;
    if (row.receivable_id && lentTo !== null && row.receivable_id !== lentTo) {
      throw new DomainError("invalid_link", "Khoản nhận lại phải cùng người với khoản cho vay gốc.");
    }
    row.receivable_id ??= lentTo;
    return;
  }
  if (!valid || linked!.meaning !== "spend") {
    throw new DomainError("invalid_link", "Khoản hoàn tiền phải trỏ về một khoản chi còn hiệu lực.");
  }
  row.category_id ??= (linked!.category_id as string | null) ?? null;
}

/**
 * Khoản gốc còn hiệu lực `days` ngày gần nhất để nối khoản tiền về (pwa UC-705, UC-706): `spend` cho "Trả lại cho khoản chi",
 * `lend` cho "Trả cho khoản cho vay". Mới nhất trước, tối đa 500. Kèm tên danh mục, ví đã trừ (`wallet_id` =
 * `counter_wallet_id` — khoản cho vay không có), người vay, ghi chú và nội dung ngân hàng của log (nếu có).
 * PWA tự xếp theo số tiền đang gõ (và người đang chọn) — một lần tải, đổi số không hỏi lại.
 */
export async function linkCandidates(db: D1Database, meaning: "spend" | "lend", now: Date, days: number) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const res = await db
    .prepare(
      `SELECT t.id, t.at, t.amount, t.category_id, c.name AS category_name, t.counter_wallet_id AS wallet_id, w.name AS wallet_name,
              t.receivable_id, r.name AS receivable_name, t.note, l.content AS bank_content
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN wallets w ON w.id = t.counter_wallet_id
       LEFT JOIN receivables r ON r.id = t.receivable_id
       LEFT JOIN bank_logs l ON l.id = t.log_id
       WHERE t.meaning = ? AND t.status = 'active' AND t.at >= ?
       ORDER BY t.at DESC, t.id DESC LIMIT 500`,
    )
    .bind(meaning, since)
    .all();
  return rows(res);
}

/**
 * Một giao dịch theo id, cùng hình dạng một dòng của sổ giao dịch — để mở chi tiết từ bất kỳ danh sách nào (pwa UC-715).
 * Kèm liên kết hai chiều trong cùng một batch: `linked_from` — các khoản hoàn tiền / nhận lại còn hiệu lực trỏ về khoản này
 * (cũ trước); `link` — tóm tắt khoản gốc của một khoản hoàn tiền / nhận lại có `link_id` (null nếu không có).
 */
export async function transactionView(db: D1Database, id: number) {
  const [tx, from, link] = await db.batch([
    db.prepare(`${TX_VIEW} WHERE t.id = ?`).bind(id),
    db.prepare(`SELECT id, at, amount, meaning FROM ${LINKED_RETURNS} ORDER BY at, id`).bind(id),
    db
      .prepare(
        `SELECT o.id, o.at, o.amount, o.meaning, o.status, c.name AS category_name, r.name AS receivable_name
         FROM transactions t
         JOIN transactions o ON o.id = t.link_id
         LEFT JOIN categories c ON c.id = o.category_id
         LEFT JOIN receivables r ON r.id = o.receivable_id
         WHERE t.id = ? AND t.meaning IN ('refund', 'collect')`,
      )
      .bind(id),
  ]);
  const row = rows(tx!)[0];
  if (!row) throw new DomainError("not_found", "Không có giao dịch này.", 404);
  return { ...row, linked_from: rows(from!), link: rows(link!)[0] ?? null };
}

// ── Chia tiền ───────────────────────────────────────────────────────

async function allocationContext(db: D1Database, at: string) {
  const month = monthKey(at);
  const [funded, balances, opening] = await db.batch([
    db
      .prepare("SELECT wallet_id AS w, SUM(amount) AS s FROM transactions WHERE status = 'active' AND meaning = 'fund' AND month_key = ? GROUP BY wallet_id")
      .bind(month),
    db.prepare("SELECT wallet_id AS w, balance AS s FROM v_wallet_balance"),
    db.prepare("SELECT wallet_id AS w, SUM(delta) AS s FROM v_wallet_flow WHERE month_key < ? GROUP BY wallet_id").bind(month),
  ]);
  return {
    fundedThisMonth: toMap(rows(funded!)),
    balances: toMap(rows(balances!)),
    openingBalances: toMap(rows(opening!)),
  };
}

const walletAccounts = (refs: Refs) => Object.fromEntries(refs.wallets.map((w) => [w.id, w.accountId]));

export interface AllocationPlan extends AllocationResult {
  transferOrders: TransferOrderDraft[];
}

export async function previewAllocation(
  db: D1Database,
  income: { amount: number; taxable: boolean; at: string; accountId: string | null; incomeStreamId?: string | null },
): Promise<AllocationPlan> {
  const refs = await loadRefs(db);
  const stream = income.incomeStreamId ? refs.incomeStreams.find((s) => s.id === income.incomeStreamId) : null;
  if (stream === undefined) throw new DomainError("unknown_income_stream", `Không có nguồn thu "${income.incomeStreamId}".`);
  const result = allocate({ income, rules: refs.rules, stream, ...(await allocationContext(db, income.at)) });
  return { ...result, transferOrders: transferOrders(result.funds, walletAccounts(refs), income.accountId) };
}

export async function allocateIncome(db: D1Database, incomeTxId: number) {
  const income = await getTransaction(db, incomeTxId);
  if (!income || income.meaning !== "income" || income.status !== "active") {
    throw new DomainError("not_income", "Không có khoản thu nhập còn hiệu lực với id này.", 404);
  }
  const done = await db.prepare("SELECT batch_id FROM allocation_runs WHERE income_tx_id = ?").bind(incomeTxId).first<{ batch_id: string }>();
  if (done) throw new DomainError("already_allocated", `Khoản thu này đã được chia (đợt ${done.batch_id}).`, 409);

  const at = String(income.at);
  const plan = await previewAllocation(db, {
    amount: Number(income.amount),
    taxable: Boolean(income.taxable),
    at,
    accountId: (income.counter_account_id as string | null) ?? null,
    incomeStreamId: (income.income_stream_id as string | null) ?? null,
  });
  const batchId = `A${incomeTxId}`;
  const holding = String(income.wallet_id);
  const statements = [
    // Trùng khoá chính ở đây làm cả batch huỷ: một khoản thu không bao giờ được chia hai lần.
    db.prepare("INSERT INTO allocation_runs (income_tx_id, batch_id) VALUES (?, ?)").bind(incomeTxId, batchId),
    ...plan.funds.map((f) =>
      insertTx(db, {
        at,
        amount: f.amount,
        meaning: "fund",
        wallet_id: f.walletId,
        counter_wallet_id: holding,
        account_id: null,
        counter_account_id: null,
        category_id: null,
        by_member_id: (income.by_member_id as string | null) ?? null,
        link_id: incomeTxId,
        batch_id: batchId,
        asset_kind: null,
        taxable: 0,
        week_key: String(income.week_key),
        month_key: String(income.month_key),
        source: "system",
        note: null,
        client_id: null,
      }),
    ),
    ...plan.transferOrders.map((o) =>
      db
        .prepare("INSERT INTO transfer_orders (batch_id, from_account_id, to_account_id, amount, memo) VALUES (?, ?, ?, ?, ?)")
        .bind(batchId, o.fromAccountId, o.toAccountId, o.amount, newTransferMemo()),
    ),
  ];
  try {
    await db.batch(statements);
  } catch (err) {
    if (/UNIQUE|PRIMARY KEY/i.test(String(err))) throw new DomainError("already_allocated", "Khoản thu này vừa được chia ở nơi khác.", 409);
    throw err;
  }
  return { batchId, ...plan };
}

// ── Chốt tháng ──────────────────────────────────────────────────────

export async function closeMonth(db: D1Database, month: string) {
  const batchId = `S${month.replace("-", "")}`;
  const already = await db.prepare("SELECT 1 FROM transactions WHERE batch_id = ? LIMIT 1").bind(batchId).first();
  if (already) return { batchId, already: true, sweeps: [], transferOrders: [] as TransferOrderDraft[] };

  const refs = await loadRefs(db);
  const wealthBuilding = refs.wallets.find((w) => w.tier === "wealth_building");
  if (!wealthBuilding) throw new DomainError("config", "Chưa có ví Tích sản.");
  const balances = toMap(
    rows(await db.prepare("SELECT wallet_id AS w, SUM(delta) AS s FROM v_wallet_flow WHERE month_key <= ? GROUP BY wallet_id").bind(month).all()),
  );
  const sweeps = monthSweep(refs.wallets, balances);
  if (sweeps.length === 0) return { batchId, already: false, sweeps, transferOrders: [] as TransferOrderDraft[] };

  const at = endOfMonthIso(month);
  const accountOf = walletAccounts(refs);
  const bySource = new Map<string | null, number>();
  for (const s of sweeps) bySource.set(accountOf[s.fromWalletId] ?? null, (bySource.get(accountOf[s.fromWalletId] ?? null) ?? 0) + s.amount);
  const orders = [...bySource].flatMap(([from, amount]) => transferOrders([{ walletId: wealthBuilding.id, amount }], accountOf, from));

  await db.batch([
    ...sweeps.map((s) =>
      insertTx(db, {
        at,
        amount: s.amount,
        meaning: "transfer",
        wallet_id: wealthBuilding.id,
        counter_wallet_id: s.fromWalletId,
        account_id: null,
        counter_account_id: null,
        category_id: null,
        by_member_id: null,
        link_id: null,
        batch_id: batchId,
        asset_kind: null,
        taxable: 0,
        week_key: weekKey(at),
        month_key: month,
        source: "system",
        note: `Chốt tháng ${month}: quét dư sang Tích sản`,
        client_id: null,
      }),
    ),
    ...orders.map((o) =>
      db
        .prepare("INSERT INTO transfer_orders (batch_id, from_account_id, to_account_id, amount, memo) VALUES (?, ?, ?, ?, ?)")
        .bind(batchId, o.fromAccountId, o.toAccountId, o.amount, newTransferMemo()),
    ),
  ]);
  return { batchId, already: false, sweeps, transferOrders: orders };
}

// ── Đếm ví / nhập số dư thật ────────────────────────────────────────

export async function countAccount(db: D1Database, accountId: string, counted: number, memberId: string | null, now: Date) {
  if (!Number.isInteger(counted) || counted < 0) throw new DomainError("invalid_amount", "Số dư đếm được phải là số nguyên không âm.");
  const refs = await loadRefs(db);
  const account = refs.accounts.find((a) => a.id === accountId);
  if (!account) throw new DomainError("unknown_account", "Không có tài khoản này.", 404);
  if (account.sepayEnabled) {
    // Log chưa gán là tiền đã đi thật nhưng chưa vào sổ: đếm lúc này, chênh lệch sẽ thành bút toán điều chỉnh,
    // rồi gán log về sau là trừ khoản đó lần thứ hai.
    const pending = await db.prepare("SELECT COUNT(*) AS n FROM bank_logs WHERE account_id = ? AND status = 'pending'").bind(accountId).first<{ n: number }>();
    if (Number(pending?.n ?? 0) > 0) {
      throw new DomainError("pending_logs", `${account.name} còn ${pending!.n} giao dịch chưa gán. Gán hết rồi mới đối soát số dư.`, 409);
    }
  }
  const have = refs.rules.find((r) => r.mode === "remainder");
  if (!have) throw new DomainError("config", "Chưa có ví nhận phần còn lại để ghi chênh lệch.");
  const book = Number((await db.prepare("SELECT book_balance FROM v_account_book WHERE account_id = ?").bind(accountId).first<{ book_balance: number }>())?.book_balance ?? 0);
  const diff = counted - book;
  const at = now.toISOString();
  const statements: D1PreparedStatement[] = [];
  if (diff !== 0) {
    statements.push(
      insertTx(db, {
        at,
        amount: Math.abs(diff),
        meaning: "adjust",
        // Tiền thật nhiều hơn sổ: cộng vào Có-thì-tốt; ít hơn: trừ Có-thì-tốt. Không sửa đè lịch sử.
        wallet_id: diff > 0 ? have.walletId : null,
        counter_wallet_id: diff < 0 ? have.walletId : null,
        account_id: diff < 0 ? accountId : null,
        counter_account_id: diff > 0 ? accountId : null,
        category_id: null,
        by_member_id: memberId,
        link_id: null,
        batch_id: null,
        asset_kind: null,
        taxable: 0,
        week_key: weekKey(at),
        month_key: monthKey(at),
        source: "manual",
        note: `Đối soát số dư: sổ ${formatMoney(book)}, thật ${formatMoney(counted)}`,
        client_id: null,
      }),
    );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO cash_counts (at, account_id, counted, book, adjust_tx_id)
         VALUES (?, ?, ?, ?, CASE WHEN ? THEN last_insert_rowid() ELSE NULL END)`,
      )
      .bind(at, accountId, counted, book, diff !== 0 ? 1 : 0),
  );
  await db.batch(statements);
  return { accountId, book, counted, diff };
}

// ── Đọc số liệu ─────────────────────────────────────────────────────

/**
 * Khoản thu còn hiệu lực chưa có lần chia (tiền đang nằm ở ví Thu nhập), khoản cũ nhất trước.
 * Một định nghĩa cho banner Hôm nay (`attention.unallocatedIncome`) và nhắc ngày 10 & 25 (cron/daily.ts).
 */
export const UNALLOCATED_INCOME_SQL = `WITH u AS (
    SELECT t.id, t.at, t.amount FROM transactions t
    LEFT JOIN allocation_runs r ON r.income_tx_id = t.id
    WHERE t.status = 'active' AND t.meaning = 'income' AND r.income_tx_id IS NULL
  )
  SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount, (SELECT id FROM u ORDER BY at, id LIMIT 1) AS oldestTxId FROM u`;

export async function getSnapshot(db: D1Database, viewerId: string | null, now: Date): Promise<Snapshot> {
  const refs = await loadRefs(db);
  const [balances, spentWeek, spentMonth, wealthBuilding, safetyFund, months, goals, pending, drift, orders, unallocated, accounts] = await db.batch([
    db.prepare("SELECT wallet_id AS w, balance AS s FROM v_wallet_balance"),
    db.prepare("SELECT wallet_id AS w, spent AS s FROM v_spent_week WHERE week_key = ?").bind(weekKey(now)),
    db.prepare("SELECT wallet_id AS w, spent AS s FROM v_spent_month WHERE month_key = ?").bind(monthKey(now)),
    db.prepare("SELECT cash, assets FROM v_wealth_building"),
    db.prepare("SELECT cash, target, months_of_data AS monthsOfData FROM v_safety_fund"),
    db.prepare("SELECT v FROM config WHERE k = 'safety_fund_months'"),
    db.prepare("SELECT wallet_id AS walletId, name, target_amount AS target, balance, target_date AS targetDate FROM v_goal_progress"),
    db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS net FROM bank_logs WHERE status = 'pending'"),
    db.prepare("SELECT account_id AS accountId, name, book_drift AS bookDrift FROM v_reconcile"),
    db.prepare(
      `SELECT COUNT(*) AS pending, COALESCE(SUM(created_at < datetime('now', '-3 days')), 0) AS overdue
       FROM transfer_orders WHERE status = 'pending'`,
    ),
    db.prepare(UNALLOCATED_INCOME_SQL),
    db.prepare(
      `SELECT b.account_id AS id, b.name, a.role, a.locked, a.spendable, b.book_balance AS balance
       FROM v_account_book b JOIN accounts a ON a.id = b.account_id ORDER BY a.kind, a.name`,
    ),
  ]);
  const first = <T>(r: D1Result) => rows<T>(r)[0] ?? null;
  return buildSnapshot({
    now,
    viewerId,
    wallets: refs.wallets,
    rules: refs.rules,
    balances: toMap(rows(balances!)),
    spentWeek: toMap(rows(spentWeek!)),
    spentMonth: toMap(rows(spentMonth!)),
    wealthBuilding: first(wealthBuilding!),
    safetyFund: first(safetyFund!),
    safetyFundMonths: Number(first<{ v: string }>(months!)?.v ?? 6),
    goals: rows(goals!) as SnapshotGoal[],
    pending: first(pending!) ?? { count: 0, net: 0 },
    drift: rows(drift!) as Snapshot["attention"]["drift"],
    transferOrders: first(orders!) ?? { pending: 0, overdue: 0 },
    unallocatedIncome: first(unallocated!) ?? { count: 0, amount: 0, oldestTxId: null },
    accounts: rows<Omit<SnapshotData["accounts"][number], "locked" | "spendable"> & { locked: number; spendable: number }>(accounts!).map((a) => ({
      ...a,
      locked: Boolean(a.locked),
      spendable: Boolean(a.spendable),
      balance: Number(a.balance),
    })),
  });
}
type SnapshotGoal = { walletId: string; name: string; target: number; balance: number; targetDate: string };

/**
 * Bức tranh tiền thật (UC-1005): tiền thật trước, ghi nhớ ai nợ ai sau. Chỉ cộng lại số các view đã có.
 * `cash` = Σ số dư theo sổ của mọi tài khoản đang dùng (tiền mặt + tài khoản) — con số quyết định;
 * Tích sản tiền mặt nằm trong đó. Tài khoản Tích sản (heo đất, phao, sổ tiết kiệm — ADR-82, ADR-88) cũng nằm trong đó:
 * `wealthBuildingAccounts` tách tổng và từng tài khoản (kèm vai trò, chủ) — là chỗ tiền Tích sản đang nằm, không phải một khoản thêm.
 * Tài sản (vàng, chứng khoán…) không phải tiền. Phải thu / nợ / người
 * thuê là sổ đối ứng ngoài sổ cái: chỉ cộng phần dương của khoản đang theo dõi, không bao giờ vào `cash`.
 */
export async function netWorth(db: D1Database, viewerId: string | null, now: Date) {
  const snapshot = await getSnapshot(db, viewerId, now);
  const [cash, receivables, debts, tenants, places] = await db.batch([
    db.prepare("SELECT COALESCE(SUM(book_balance), 0) AS n FROM v_account_book"),
    db.prepare("SELECT COALESCE(SUM(balance), 0) AS n FROM v_receivable_balance WHERE active = 1 AND balance > 0"),
    db.prepare("SELECT COALESCE(SUM(balance), 0) AS n FROM v_debt_balance WHERE active = 1 AND balance > 0"),
    db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN balance > 0 THEN balance END), 0) AS owed, COALESCE(SUM(CASE WHEN balance < 0 THEN -balance END), 0) AS prepaid
       FROM v_tenant_balance WHERE active = 1`,
    ),
    db.prepare(
      `SELECT b.account_id AS accountId, b.name, a.role, a.owner_member_id AS memberId, m.name AS memberName, b.book_balance AS balance
       FROM v_account_book b JOIN accounts a ON a.id = b.account_id LEFT JOIN members m ON m.id = a.owner_member_id
       WHERE a.role IS NOT NULL ORDER BY CASE a.role WHEN 'piggy_bank' THEN 0 WHEN 'buffer' THEN 1 ELSE 2 END, a.id`,
    ),
  ]);
  const sum = (r: D1Result) => Number(rows<{ n: number }>(r)[0]?.n ?? 0);
  const tenant = rows<{ owed: number; prepaid: number }>(tenants!)[0];
  const wealthBuildingAccounts = rows<{ accountId: string; name: string; role: AccountRole; memberId: string | null; memberName: string | null; balance: number }>(places!);
  const statement = {
    cash: sum(cash!),
    wealthBuildingCash: snapshot.tiers.wealth_building.cash,
    wealthBuildingAccounts: { total: wealthBuildingAccounts.reduce((s, a) => s + a.balance, 0), accounts: wealthBuildingAccounts },
    spendableThisWeek: snapshot.spendableThisWeek,
    assets: snapshot.tiers.wealth_building.assets,
    receivables: sum(receivables!),
    tenants: Number(tenant?.owed ?? 0),
    tenantsPrepaid: Number(tenant?.prepaid ?? 0),
    debts: sum(debts!),
  };
  return {
    ...statement,
    netWorth: statement.cash + statement.assets + statement.receivables + statement.tenants - statement.debts - statement.tenantsPrepaid,
  };
}

/** Bảng dự kiến / thực tế / còn lại cho một tháng (`2026-09`) hoặc một tuần ISO (`2026-W39`). */
export async function getBudget(db: D1Database, period: string, viewerId: string | null) {
  const isWeek = /^\d{4}-W\d{2}$/.test(period);
  if (!isWeek && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new DomainError("invalid_period", "Kỳ phải có dạng 2026-09 hoặc 2026-W39.");
  }
  const refs = await loadRefs(db);
  const [spent, funded, balances] = await db.batch([
    isWeek
      ? db.prepare("SELECT wallet_id AS w, spent AS s FROM v_spent_week WHERE week_key = ?").bind(period)
      : db.prepare("SELECT wallet_id AS w, spent AS s FROM v_spent_month WHERE month_key = ?").bind(period),
    db
      .prepare("SELECT wallet_id AS w, SUM(amount) AS s FROM transactions WHERE status = 'active' AND meaning = 'fund' AND month_key = ? GROUP BY wallet_id")
      .bind(isWeek ? "" : period),
    db.prepare("SELECT wallet_id AS w, balance AS s FROM v_wallet_balance"),
  ]);
  const spentBy = toMap(rows(spent!));
  const fundedBy = toMap(rows(funded!));
  const balanceBy = toMap(rows(balances!));
  const weekMonth = isWeek ? weekStart(period).slice(0, 7) : "";
  const lines = refs.wallets
    .filter((w) => w.tier !== "holding") // ví Thu nhập và ví quỹ giữ riêng không phải ngân sách chi
    .map((w) => {
      const rule = refs.rules.find((r) => r.walletId === w.id);
      let target: number | null = null;
      if (isWeek) target = weekTarget(rule, weekMonth);
      else if (rule?.mode === "remainder") target = fundedBy[w.id] ?? 0; // Có-thì-tốt: dự kiến là phần đã được chia
      else target = monthTarget(rule, period);
      return { w, target };
    })
    // Ví âm vẫn hiện để còn bù từ ví khác.
    .filter(({ w, target }) => target !== null || (spentBy[w.id] ?? 0) !== 0 || (balanceBy[w.id] ?? 0) < 0);
  return {
    period,
    kind: isWeek ? "week" : "month",
    weeks: isWeek ? 1 : mondaysInMonth(period),
    lines: lines.map(({ w, target }) => {
      const secret = w.private && w.memberId !== viewerId;
      const actual = spentBy[w.id] ?? 0;
      return {
        walletId: w.id,
        name: w.name,
        tier: w.tier,
        mustGroup: w.mustGroup,
        target: secret ? null : target,
        spent: secret ? null : actual,
        remaining: secret || target === null ? null : target - actual,
        balance: secret ? null : balanceBy[w.id] ?? 0,
      };
    }),
  };
}

export async function spendByCategory(db: D1Database, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new DomainError("invalid_period", "Tháng phải có dạng 2026-09.");
  const [y, m] = month.split("-").map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const res = await db
    .prepare("SELECT category_id AS categoryId, name, month_key AS month, spent FROM v_spend_by_category WHERE month_key IN (?, ?) ORDER BY spent DESC")
    .bind(month, prev)
    .all();
  const list = rows<{ categoryId: string; name: string; month: string; spent: number }>(res);
  const ids = [...new Set(list.map((r) => r.categoryId))];
  return {
    month,
    previous: prev,
    categories: ids
      .map((id) => ({
        categoryId: id,
        name: list.find((r) => r.categoryId === id)?.name ?? id,
        spent: list.find((r) => r.categoryId === id && r.month === month)?.spent ?? 0,
        previousSpent: list.find((r) => r.categoryId === id && r.month === prev)?.spent ?? 0,
      }))
      .sort((a, b) => b.spent - a.spent),
  };
}

export async function reconcile(db: D1Database) {
  return rows(
    await db
      .prepare(
        `SELECT r.account_id AS accountId, r.name, r.kind, r.book_balance AS bookBalance, r.feed_balance AS feedBalance,
                r.book_drift AS bookDrift,
                r.pending_net AS pendingNet, r.pending_count AS pendingCount, r.last_at AS lastAt,
                (SELECT MAX(at) FROM cash_counts c WHERE c.account_id = r.account_id) AS lastCountAt
         FROM v_reconcile r`,
      )
      .all(),
  );
}

export async function goals(db: D1Database) {
  const [goalRows, safetyFund, wealthBuilding] = await db.batch([
    db.prepare("SELECT wallet_id AS walletId, name, target_amount AS target, target_date AS targetDate, balance, missing, pct, days_left AS daysLeft FROM v_goal_progress"),
    db.prepare("SELECT cash, target, months_covered AS monthsCovered, pct, months_of_data AS monthsOfData FROM v_safety_fund"),
    db.prepare("SELECT total, cash, assets FROM v_wealth_building"),
  ]);
  return { goals: rows(goalRows!), safetyFund: rows(safetyFund!)[0] ?? null, wealthBuilding: rows(wealthBuilding!)[0] ?? null };
}

/** Nguồn / đích của tiền ví Tích sản (pwa UC-707, ledger UC-107 — ADR-86, ADR-88). `AccountRole`: chuyển vào tài khoản Tích sản đó. `opening`: số dư có sẵn của tài khoản Tích sản (ADR-91). */
export type WealthBuildingFlowKind = AccountRole | "fund" | "sweep" | "tax" | "opening" | "wallet" | "other" | "buy_asset";

/**
 * Số dư có sẵn của một tài khoản vừa thành tài khoản Tích sản không tính (ADR-91; access UC-506 3g): bút toán hệ thống ghi
 * có ví Tích sản, không ví nguồn, không tài khoản — Có thì tốt và số dư sổ không đổi. Số tiền theo `openingWealthBuildingCredit`,
 * đọc Tích sản tiền mặt (dòng đầu `v_wealth_building`, như snapshot) và Σ số dư các tài khoản Tích sản không tính khác trước khi
 * ghi. Trả câu INSERT để ghi cùng batch với thay đổi tài khoản; không có gì để ghi thì null.
 */
export async function wealthBuildingOpeningEntry(db: D1Database, account: { id: string; name: string; balance: number }, now: Date): Promise<D1PreparedStatement | null> {
  if (account.balance <= 0) return null;
  const [ts, outside] = await db.batch([
    db.prepare("SELECT wallet_id AS walletId, cash FROM v_wealth_building"),
    db
      .prepare(
        `SELECT COALESCE(SUM(b.book_balance), 0) AS total FROM v_account_book b JOIN accounts a ON a.id = b.account_id
         WHERE a.role IS NOT NULL AND (a.locked = 1 OR a.spendable = 0) AND a.id <> ?`,
      )
      .bind(account.id),
  ]);
  const wealthBuilding = rows<{ walletId: string; cash: number }>(ts!)[0];
  if (!wealthBuilding) return null;
  const amount = openingWealthBuildingCredit(account.balance, Number(rows<{ total: number }>(outside!)[0]?.total ?? 0), Number(wealthBuilding.cash));
  if (amount === 0) return null;
  const at = now.toISOString();
  return insertTx(db, {
    at,
    amount,
    meaning: "transfer",
    wallet_id: wealthBuilding.walletId,
    counter_wallet_id: null,
    account_id: null,
    counter_account_id: null,
    category_id: null,
    by_member_id: null,
    link_id: null,
    batch_id: `O:${account.id}:${at}`,
    asset_kind: null,
    taxable: 0,
    week_key: weekKey(at),
    month_key: monthKey(at),
    source: "system",
    note: `Số dư có sẵn khi mở ${account.name} → Tích sản`,
    client_id: null,
  });
}

/**
 * Tích sản nói rõ tiền nào, loại nào, đang ở đâu (ADR-86): tiền / tài sản như `v_wealth_building`; từng tài khoản Tích sản (heo,
 * phao, sổ tiết kiệm — ADR-88) với số dư sổ và log còn chờ gán; ví Tích sản vào / ra gộp theo nguồn bằng một GROUP BY.
 * Bất biến: Σ vào − Σ ra (trừ mua tài sản) = số dư ví; trừ thêm mua tài sản = `cash`.
 */
export async function wealthBuildingBreakdown(db: D1Database) {
  // Cùng dòng đầu của `v_wealth_building` như snapshot — một nguồn số cho cả card lẫn Quỹ an tâm.
  const ts = await db.prepare("SELECT wallet_id AS walletId, name, cash, assets FROM v_wealth_building").first<{ walletId: string; name: string; cash: number; assets: number }>();
  if (!ts) throw new DomainError("config", "Chưa có ví Tích sản.");
  const [places, flows] = await db.batch([
    // Log chờ gán của tài khoản Tích sản: log của chính nó, hoặc log của tài khoản có rule (heo) trỏ tới nó và nội dung
    // chứa mẫu. Số theo phía tài khoản Tích sản: chuyển vào (tiền ra từ tài khoản chi) +, rút về (tiền vào tài khoản chi) −.
    db.prepare(
      `SELECT a.id AS accountId, a.name, a.role, a.owner_member_id AS memberId, m.name AS memberName, b.book_balance AS balance,
              COUNT(l.id) AS pendingCount,
              COALESCE(SUM(CASE WHEN (l.account_id = a.id) = (l.direction = 'in') THEN l.amount ELSE -l.amount END), 0) AS pendingNet
       FROM v_account_book b
       JOIN accounts a ON a.id = b.account_id
       LEFT JOIN members m ON m.id = a.owner_member_id
       LEFT JOIN bank_logs l ON l.status = 'pending' AND (
         l.account_id = a.id OR EXISTS (
           SELECT 1 FROM rules r
           WHERE r.active = 1 AND r.match_type = 'content' AND r.counter_account_id = a.id AND r.account_id = l.account_id
             AND INSTR(UPPER(COALESCE(l.content, '')), UPPER(r.pattern)) > 0))
       WHERE a.role IS NOT NULL
       GROUP BY a.id ORDER BY CASE a.role WHEN 'piggy_bank' THEN 0 WHEN 'buffer' THEN 1 ELSE 2 END, a.id`,
    ),
    db
      .prepare(
        `WITH k AS (
           SELECT CASE
                    WHEN t.meaning = 'buy_asset' THEN 'buy_asset'
                    WHEN t.wallet_id = ?1 AND t.meaning = 'fund' THEN 'fund'
                    WHEN t.wallet_id = ?1 AND t.meaning = 'transfer' AND ca.role IS NOT NULL THEN ca.role
                    WHEN t.wallet_id = ?1 AND t.meaning = 'transfer' AND t.source = 'system' AND t.batch_id LIKE 'S%' THEN 'sweep'
                    WHEN t.wallet_id = ?1 AND t.meaning = 'transfer' AND t.source = 'system' AND t.batch_id LIKE 'T%' THEN 'tax'
                    WHEN t.wallet_id = ?1 AND t.meaning = 'transfer' AND t.source = 'system' AND t.batch_id LIKE 'O%' THEN 'opening'
                    WHEN t.meaning = 'transfer' THEN 'wallet'
                    ELSE 'other'
                  END AS kind,
                  CASE WHEN t.wallet_id = ?1 AND t.meaning <> 'buy_asset' THEN 'in' ELSE 'out' END AS direction,
                  t.counter_account_id AS toAccount,
                  CASE WHEN t.wallet_id = ?1 THEN t.counter_wallet_id ELSE t.wallet_id END AS otherWallet,
                  t.asset_kind, COALESCE(t.batch_id, 'tx' || t.id) AS grp, t.amount
           FROM transactions t LEFT JOIN accounts ca ON ca.id = t.counter_account_id
           WHERE t.status = 'active' AND (t.wallet_id = ?1 OR t.counter_wallet_id = ?1)
         ), f AS (
           SELECT kind, direction, grp, amount,
                  CASE WHEN kind IN ('piggy_bank', 'buffer', 'term_deposit') THEN toAccount END AS accountId,
                  CASE WHEN kind = 'wallet' THEN otherWallet END AS walletId,
                  CASE WHEN kind = 'buy_asset' THEN asset_kind END AS assetKind
           FROM k
         )
         SELECT f.kind, f.direction, f.accountId, a.name AS accountName, m.name AS memberName,
                f.walletId, w.name AS walletName, w.active AS walletActive, f.assetKind,
                COUNT(DISTINCT f.grp) AS count, SUM(f.amount) AS amount
         FROM f
         LEFT JOIN accounts a ON a.id = f.accountId
         LEFT JOIN members m ON m.id = a.owner_member_id
         LEFT JOIN wallets w ON w.id = f.walletId
         GROUP BY f.kind, f.direction, f.accountId, f.walletId, f.assetKind
         ORDER BY f.direction, SUM(f.amount) DESC`,
      )
      .bind(ts.walletId),
  ]);
  type Flow = {
    kind: WealthBuildingFlowKind;
    direction: "in" | "out";
    accountId: string | null;
    accountName: string | null;
    memberName: string | null;
    walletId: string | null;
    walletName: string | null;
    walletActive: number | null;
    assetKind: string | null;
    count: number;
    amount: number;
  };
  return {
    walletId: ts.walletId,
    name: ts.name,
    cash: Number(ts.cash),
    assets: Number(ts.assets),
    accounts: rows<{ accountId: string; name: string; role: AccountRole; memberId: string | null; memberName: string | null; balance: number; pendingCount: number; pendingNet: number }>(
      places!,
    ).map((a) => ({ ...a, balance: Number(a.balance), pendingCount: Number(a.pendingCount), pendingNet: Number(a.pendingNet) })),
    flows: rows<Flow>(flows!).map((f) => ({
      ...f,
      walletActive: f.walletActive === null ? null : Boolean(f.walletActive),
      count: Number(f.count),
      amount: Number(f.amount),
    })),
  };
}

// ── Lệnh chuyển tiền ────────────────────────────────────────────────

/**
 * `wallet_names`: các ví mà lệnh này mang tiền tới — ví nhận tiền trong cùng lô (fund của lần chia, chuyển của
 * quyết toán thuế) đang trú ở tài khoản đích. Để PWA nói "cho Tích sản, Thuế" thay vì chỉ hai tên tài khoản.
 */
export async function listTransferOrders(db: D1Database, status: string) {
  if (!["pending", "done", "skipped", "all"].includes(status)) throw new DomainError("invalid_status", "Trạng thái không hợp lệ.");
  return rows(
    await db
      .prepare(
        `SELECT o.*, fa.name AS from_name, ta.name AS to_name,
           (SELECT group_concat(name, ', ') FROM (
              SELECT w.name FROM transactions t JOIN wallets w ON w.id = t.wallet_id
              WHERE t.batch_id = o.batch_id AND t.status = 'active' AND t.meaning IN ('fund', 'transfer') AND w.account_id = o.to_account_id
              GROUP BY w.id ORDER BY MIN(w.sort), w.name)) AS wallet_names
         FROM transfer_orders o
         JOIN accounts fa ON fa.id = o.from_account_id JOIN accounts ta ON ta.id = o.to_account_id
         WHERE ? = 'all' OR o.status = ? ORDER BY o.created_at DESC LIMIT 200`,
      )
      .bind(status, status)
      .all(),
  );
}

export async function setTransferOrderStatus(db: D1Database, id: number, status: "done" | "skipped") {
  const res = await db.prepare("UPDATE transfer_orders SET status = ? WHERE id = ? AND status = 'pending'").bind(status, id).run();
  if (!res.meta.changes) throw new DomainError("not_pending", "Không có lệnh đang chờ với id này.", 404);
  return db.prepare("SELECT * FROM transfer_orders WHERE id = ?").bind(id).first();
}

// ── Danh mục ────────────────────────────────────────────────────────

/** Tần suất dùng 30 ngày gần nhất — lưới danh mục đưa 6 cái hay dùng nhất lên đầu. */
export async function categoryUsage(db: D1Database, now: Date) {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  return toMap(
    rows(
      await db
        .prepare("SELECT category_id AS w, COUNT(*) AS s FROM transactions WHERE status = 'active' AND meaning = 'spend' AND at >= ? GROUP BY category_id")
        .bind(since)
        .all(),
    ),
  );
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

export async function saveCategory(
  db: D1Database,
  input: { id?: string; name?: string; default_wallet_id?: string | null; icon?: string | null; sort?: number; active?: boolean },
  existingId?: string,
) {
  const refs = await loadRefs(db);
  if (input.default_wallet_id && !refs.wallets.some((w) => w.id === input.default_wallet_id)) {
    throw new DomainError("unknown_wallet", "Ví mặc định không tồn tại.");
  }
  if (!existingId) {
    const name = input.name?.trim();
    if (!name) throw new DomainError("missing_name", "Danh mục cần có tên.");
    const id = input.id?.trim() || slug(name);
    if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new DomainError("invalid_id", "Mã danh mục chỉ gồm chữ thường, số và gạch nối.");
    try {
      await db
        .prepare("INSERT INTO categories (id, name, default_wallet_id, icon, sort) VALUES (?, ?, ?, ?, ?)")
        .bind(id, name.slice(0, 60), input.default_wallet_id ?? null, input.icon ?? null, input.sort ?? 100)
        .run();
    } catch {
      throw new DomainError("duplicate", "Đã có danh mục với mã này.", 409);
    }
    return db.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first();
  }
  const current = await db.prepare("SELECT * FROM categories WHERE id = ?").bind(existingId).first<Row>();
  if (!current) throw new DomainError("not_found", "Không có danh mục này.", 404);
  await db
    .prepare("UPDATE categories SET name = ?, default_wallet_id = ?, icon = ?, sort = ?, active = ? WHERE id = ?")
    .bind(
      input.name?.trim().slice(0, 60) || current.name,
      input.default_wallet_id === undefined ? current.default_wallet_id : input.default_wallet_id,
      input.icon === undefined ? current.icon : input.icon,
      input.sort ?? current.sort,
      input.active === undefined ? current.active : input.active ? 1 : 0,
      existingId,
    )
    .run();
  return db.prepare("SELECT * FROM categories WHERE id = ?").bind(existingId).first();
}

// ── Quyết toán thuế năm ─────────────────────────────────────────────
// Thuế đã trích = mọi fund vào ví Thuế trong năm; đã nộp = mọi khoản chi từ ví Thuế trong năm.
// Thừa → chuyển sang Tích sản (không tiêu); thiếu → chỉ ghi nhận, phần nộp thêm là khoản chi từ ví Thuế.

async function taxFigures(db: D1Database, year: number) {
  const refs = await loadRefs(db);
  const tax = refs.wallets.find((w) => w.tier === "tax");
  const wealthBuilding = refs.wallets.find((w) => w.tier === "wealth_building");
  if (!tax || !wealthBuilding) throw new DomainError("config", "Chưa có ví Thuế hoặc ví Tích sản.");
  const like = `${year}-%`;
  const [provisioned, paid, balance, settled] = await db.batch([
    db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE status = 'active' AND meaning = 'fund' AND wallet_id = ? AND month_key LIKE ?").bind(tax.id, like),
    db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE status = 'active' AND meaning = 'spend' AND counter_wallet_id = ? AND month_key LIKE ?").bind(tax.id, like),
    db.prepare("SELECT balance AS s FROM v_wallet_balance WHERE wallet_id = ?").bind(tax.id),
    db.prepare("SELECT * FROM tax_settlements WHERE year = ?").bind(year),
  ]);
  const num = (r: D1Result) => Number(rows<{ s: number }>(r)[0]?.s ?? 0);
  return { refs, tax, wealthBuilding, provisioned: num(provisioned!), paid: num(paid!), walletBalance: num(balance!), settlement: rows(settled!)[0] ?? null };
}

const validYear = (year: number) => {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new DomainError("invalid_year", "Năm không hợp lệ.");
};

export async function getTax(db: D1Database, year: number) {
  validYear(year);
  const f = await taxFigures(db, year);
  return {
    year,
    provisioned: f.provisioned,
    paid: f.paid,
    difference: f.provisioned - f.paid,
    walletBalance: f.walletBalance,
    settlement: f.settlement,
  };
}

export async function settleTax(db: D1Database, year: number, now: Date) {
  validYear(year);
  if (year >= Number(monthKey(now).slice(0, 4))) throw new DomainError("year_not_over", "Chỉ quyết toán năm đã kết thúc.", 409);
  const f = await taxFigures(db, year);
  if (f.settlement) throw new DomainError("already_settled", `Năm ${year} đã quyết toán.`, 409);
  // Chỉ chuyển phần thừa thật sự còn nằm trong ví Thuế, không chuyển quá số dư.
  const surplus = Math.max(0, Math.min(f.provisioned - f.paid, f.walletBalance));
  const at = now.toISOString();
  const batchId = `T${year}`;
  const statements: D1PreparedStatement[] = [];
  if (surplus > 0) {
    statements.push(
      insertTx(db, {
        at,
        amount: surplus,
        meaning: "transfer",
        wallet_id: f.wealthBuilding.id,
        counter_wallet_id: f.tax.id,
        account_id: null,
        counter_account_id: null,
        category_id: null,
        by_member_id: null,
        link_id: null,
        batch_id: batchId,
        asset_kind: null,
        taxable: 0,
        week_key: weekKey(at),
        month_key: monthKey(at),
        source: "system",
        note: `Quyết toán thuế ${year}: phần thừa chuyển sang Tích sản`,
        client_id: null,
      }),
    );
    for (const o of transferOrders([{ walletId: f.wealthBuilding.id, amount: surplus }], walletAccounts(f.refs), f.tax.accountId)) {
      statements.push(
        db
          .prepare("INSERT INTO transfer_orders (batch_id, from_account_id, to_account_id, amount, memo) VALUES (?, ?, ?, ?, ?)")
          .bind(batchId, o.fromAccountId, o.toAccountId, o.amount, newTransferMemo()),
      );
    }
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO tax_settlements (year, provisioned, paid, surplus_tx_id, settled_at)
         VALUES (?, ?, ?, (SELECT id FROM transactions WHERE batch_id = ? AND meaning = 'transfer'), ?)`,
      )
      .bind(year, f.provisioned, f.paid, batchId, at),
  );
  await db.batch(statements);
  return { ...(await getTax(db, year)), surplus };
}
