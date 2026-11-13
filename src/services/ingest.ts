// Bank feed SePay → bank_logs (bất biến) → transactions. Phase 04.
// Chữ ký các hàm dưới đây là hợp đồng dùng chung với MCP (phase 06) — giữ nguyên tên và tham số.
// Từ v2 (ADR-123) đường ghi không còn ví: tiền thuộc ngăn của tài khoản; khoản lương đi kèm nhắc ① trích Tích luỹ trong cùng
// batch (pocket UC-1205, ADR-144), mỗi lần ghi chuyển khoản chạy tự tick việc tháng (UC-1206).

import { assertOpened, buildEntry, rejectOldFields, type EntryInput, type TxRow } from "../domain/entry";
import { isInterestLog } from "../domain/interest-deposit";
import { dayKey, minuteOfDay, monthKey, weekKey } from "../domain/period";
import { canPair, extractCode, looksLikeCashWithdrawal, matchRule, type PairCandidate, type RuleRow } from "../domain/rules";
import { memoKey } from "../domain/rental";
import { DomainError, type Refs } from "../domain/types";
import { assertInterestCap, getTransaction, insertTx, interestMaxAmount, loadRefs, resolveLink, rethrowEntryTrigger, salaryMinAmount, type WriteEffects } from "./ledger";
import { closest, feedMark, linkColumn, linkLogToTx, manualMatches } from "./manual-links";
import { afterWrite, codeTarget, incomeStatements, linkByCode, resolveIsSalary, voidTxStatements, type SavingsPlan } from "./month-tasks";
import { assertLogChangeable, assertRowWritable, assertTenantAccount, assertTxChangeable, hiddenAccountIds } from "./privacy";
import { issuedBillMemos } from "./rental";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];

export type SplitMeaning = "spend" | "transfer" | "income" | "refund" | "lend" | "collect" | "buy_asset";

export interface Split {
  meaning: SplitMeaning;
  amount: number;
  category_id?: string | null;
  /** transfer: tài khoản đầu kia của giao dịch (ví dụ Tiền mặt khi rút ATM). */
  other_account_id?: string | null;
  /** income: nguồn thu (quyết "Đây là lương" mặc định và ngăn của tiền về); bỏ trống mà có tenant_id thì lấy nguồn cho thuê. */
  income_stream_id?: string | null;
  /** income: tiền người thuê trả (giảm số dư sổ người thuê). */
  tenant_id?: string | null;
  /** spend: khoản trả nợ (giảm số còn nợ ở sổ nợ). */
  debt_id?: string | null;
  /** spend: trả LÃI cho khoản nợ (không giảm nợ; danh mục mặc định "Lãi vay"). */
  interest_debt_id?: string | null;
  /** lend: cho vay thêm · collect: tiền cho vay trả về (không phải thu nhập) — ở sổ phải thu. */
  receivable_id?: string | null;
  /** refund: khoản chi gốc được trả lại · collect: khoản cho vay gốc được trả — kiểm ở `resolveLink` (ledger UC-101 bước 4b). */
  link_id?: number | null;
  taxable?: boolean;
  asset_kind?: string | null;
  /** income: lãi tiền gửi — một dòng, khoản thu Thu nhập thụ động, không bao giờ là lương. */
  interest?: boolean;
  /** Cùng nghĩa `interest` (tên chung với `POST /v1/transactions`, ADR-140). */
  is_interest?: boolean;
  /** income: "Đây là lương" (pocket UC-1205, Q1-B); không gửi = nguồn lương, hoặc khoản không nguồn từ `salary_reminder_min`. */
  is_salary?: boolean;
  note?: string | null;
  /** spend / transfer ra: mục tiêu Dự phòng của tài khoản log dùng tiền (pocket UC-1209 bước 11); bỏ trống = tự gắn nếu tài khoản một mục tiêu. */
  goal_id?: string | null;
  /** spend / transfer ra khỏi nhóm mẹ có mục tiêu + con: rút từ tiền lãi (không kèm `goal_id`; không vượt tiền lãi hiện có). */
  from_interest?: boolean;
}

// ── Chuẩn hoá payload SePay → dữ liệu thô lưu vào bank_logs ──────────

export interface ParsedBankLog {
  id: string;
  at: string; // ISO UTC
  amount: number;
  direction: "in" | "out";
  accountNo: string | null;
  /** Tài khoản ảo (VA) SePay, nếu có. */
  subAccount?: string | null;
  content: string | null;
  refCode: string | null;
  referenceNumber: string | null;
  raw: unknown;
}

const fail = (code: string, message: string): never => {
  throw new DomainError(code, message);
};

const VN_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * "YYYY-MM-DD HH:mm[:ss]" giờ Việt Nam (không có mốc múi giờ) → ISO UTC.
 * Kiểm tra ngày có thật: Date.parse lặng lẽ đẩy 30/02 sang 02/03, tức là ghi giao dịch vào sai tháng.
 */
export function vnDateTimeToIso(vnDateTime: string): string {
  const m = VN_DATETIME.exec(vnDateTime.trim());
  const [y, mo, d, h, mi, s] = m ? m.slice(1).map((x) => Number(x ?? 0)) : [];
  const t = m ? Date.UTC(y!, mo! - 1, d!, h! - 7, mi!, s!) : NaN;
  const back = new Date(t + 7 * 3600_000);
  if (!m || back.getUTCFullYear() !== y || back.getUTCMonth() !== mo! - 1 || back.getUTCDate() !== d || h! > 23 || mi! > 59 || s! > 59) {
    fail("invalid_payload", `Ngày giờ giao dịch không hợp lệ: "${vnDateTime}".`);
  }
  return new Date(t).toISOString();
}

/** Số tiền VND hợp lệ: số nguyên dương, không vượt 1.000 tỷ (mọi số lớn hơn là dữ liệu hỏng). */
function vndAmount(value: unknown, field: string): number {
  const amount = Math.round(Number(value));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000_000) fail("invalid_payload", `${field} không hợp lệ.`);
  return amount;
}

/** SQLite `datetime('now')` sinh "YYYY-MM-DD HH:MM:SS" UTC — dùng cùng khuôn để so sánh chuỗi được. */
export function sqliteDateTime(at: Date): string {
  return at.toISOString().slice(0, 19).replace("T", " ");
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function parseWebhookPayload(payload: Record<string, unknown>): ParsedBankLog {
  const id = payload.id;
  if (id === undefined || id === null || id === "") return fail("invalid_payload", "Thiếu id giao dịch.");
  const transactionDate = payload.transactionDate;
  if (typeof transactionDate !== "string" || !transactionDate) return fail("invalid_payload", "Thiếu transactionDate.");
  const direction = payload.transferType === "in" ? "in" : payload.transferType === "out" ? "out" : null;
  if (!direction) return fail("invalid_payload", "transferType phải là 'in' hoặc 'out'.");
  const amount = vndAmount(payload.transferAmount, "transferAmount");
  const content = str(payload.content) ?? str(payload.description);
  const code = str(payload.code);
  return {
    id: String(id),
    at: vnDateTimeToIso(transactionDate),
    amount,
    direction,
    accountNo: str(payload.accountNumber),
    subAccount: str(payload.subAccount),
    content,
    refCode: (code ?? extractCode(content))?.toUpperCase() ?? null,
    referenceNumber: str(payload.referenceCode),
    raw: payload,
  };
}

/** Một dòng trong `data[]` của SePay API v2 `GET /v2/transactions` (rà soát 02:00). `id` là UUID, tiền là số nguyên. */
export function parseHistoryRow(row: Record<string, unknown>): ParsedBankLog {
  const id = row.id;
  if (id === undefined || id === null || id === "") return fail("invalid_payload", "Thiếu id giao dịch (API lịch sử).");
  const transactionDate = row.transaction_date;
  if (typeof transactionDate !== "string" || !transactionDate) return fail("invalid_payload", "Thiếu transaction_date.");
  const amountIn = Number(row.amount_in ?? 0);
  const amountOut = Number(row.amount_out ?? 0);
  const direction: "in" | "out" = row.transfer_type === "in" ? "in" : row.transfer_type === "out" ? "out" : amountIn > 0 ? "in" : "out";
  const amount = vndAmount(direction === "in" ? amountIn : amountOut, "amount_in/amount_out");
  const content = str(row.transaction_content);
  const code = str(row.code);
  return {
    id: String(id),
    at: vnDateTimeToIso(transactionDate),
    amount,
    direction,
    accountNo: str(row.account_number),
    subAccount: str(row.va),
    content,
    refCode: (code ?? extractCode(content))?.toUpperCase() ?? null,
    referenceNumber: str(row.reference_number),
    raw: row,
  };
}

// ── Ghi transaction sinh ra từ log (insertTx của ledger kèm log_id/log_id_2) ──

interface LogTxInput {
  at: string;
  amount: number;
  meaning: "spend" | "income" | "transfer";
  accountId: string | null;
  counterAccountId: string | null;
  categoryId: string | null;
  byMemberId: string | null;
  note: string | null;
  /** income: nguồn thu (rule lương mang theo). */
  incomeStreamId?: string | null;
  /** Mẫu tự gán đã ghi khoản này (ingest UC-307 AC-25); gán tay, ghép cặp, mã việc, lãi: không có. */
  ruleId?: number | null;
}

function logRow(row: LogTxInput): TxRow {
  return {
    at: row.at,
    amount: row.amount,
    meaning: row.meaning,
    account_id: row.accountId,
    counter_account_id: row.counterAccountId,
    category_id: row.categoryId,
    by_member_id: row.byMemberId,
    link_id: null,
    batch_id: null,
    asset_kind: null,
    taxable: 0,
    week_key: weekKey(row.at),
    month_key: monthKey(row.at),
    source: "sepay",
    note: row.note,
    client_id: null,
    income_stream_id: row.incomeStreamId ?? null,
    rule_id: row.ruleId ?? null,
  };
}

const logTxStmt = (db: D1Database, row: TxRow, logId: string, logId2: string | null) => insertTx(db, row, { log_id: logId, log_id_2: logId2 });

/** Đổi các log sang 'assigned' — luôn đi cùng batch với giao dịch sinh ra từ chúng. */
const markAssigned = (db: D1Database, ...ids: string[]) =>
  db.prepare(`UPDATE bank_logs SET status = 'assigned' WHERE status = 'pending' AND id IN (${ids.map(() => "?").join(", ")})`).bind(...ids);

/**
 * Ghi nguyên tử. Trigger ở DB (migration 0005) huỷ cả batch khi log không còn 'pending' — tức là một request khác vừa xử
 * lý xong đúng giao dịch này. Khi đó trả false (không ghi lần hai); ghi được thì true.
 */
async function commit(db: D1Database, statements: D1PreparedStatement[]): Promise<boolean> {
  try {
    await db.batch(statements);
    return true;
  } catch (err) {
    if (/log_not_pending/.test(String(err))) return false;
    rethrowEntryTrigger(err);
    throw err;
  }
}

/**
 * Câu kèm khoản thu lãi tiền gửi (ingest UC-303, UC-305): phân loại Thu nhập thụ động (người phân loại NULL) — đặt NGAY SAU
 * câu INSERT khoản thu, không nhắc trích (lãi không bao giờ là lương), không `fund`, không ví.
 */
const interestClass = (db: D1Database) =>
  db.prepare(
    "INSERT OR IGNORE INTO transaction_report_classes (transaction_id, report_class, by_member_id) VALUES ((SELECT MAX(id) FROM transactions), 'passive_income', NULL)",
  );

/**
 * Chuyển nội bộ đã ghi từ MỘT chân mà `log` (đang chờ) có thể là chân còn lại (ADR-81): còn hiệu lực, chưa có chân
 * thứ hai, cùng số tiền với cả log của chân đã ghi (không tách dòng), log đó nằm ở tài khoản đầu kia, `log` nằm đúng ở
 * đầu còn lại theo chiều tiền, lệch ≤ 10 phút như ghép cặp (ADR-29). Gán tay truyền `otherAccountId` = tài khoản đầu
 * kia người gán chọn. Nhiều giao dịch hợp lệ thì lấy giao dịch có chân gần giờ nhất.
 */
async function findSingleLegTransfer(db: D1Database, log: PairCandidate, otherAccountId?: string): Promise<{ txId: number; accountId: string; at: string } | null> {
  const legs = rows<PairCandidate & { txId: number }>(
    await db
      .prepare(
        `SELECT t.id AS txId, l.id, l.account_id AS accountId, l.direction, l.amount, l.at
         FROM transactions t JOIN bank_logs l ON l.id = t.log_id
         WHERE t.meaning = 'transfer' AND t.status = 'active' AND t.log_id_2 IS NULL AND t.amount = ? AND l.amount = t.amount
           AND l.direction <> ? AND l.account_id = CASE l.direction WHEN 'out' THEN t.account_id ELSE t.counter_account_id END
           AND (CASE ? WHEN 'in' THEN t.counter_account_id ELSE t.account_id END) = ?`,
      )
      .bind(log.amount, log.direction, log.direction, log.accountId)
      .all(),
  );
  const at = Date.parse(log.at);
  const hit = legs
    .filter((l) => (otherAccountId === undefined || l.accountId === otherAccountId) && canPair(log, l))
    .sort((a, b) => Math.abs(Date.parse(a.at) - at) - Math.abs(Date.parse(b.at) - at))[0];
  return hit ? { txId: hit.txId, accountId: hit.accountId, at: hit.at } : null;
}

/**
 * Gắn `logId` làm chân thứ hai (`log_id_2`) của giao dịch `txId` và đổi log sang 'assigned' — một batch; log chỉ đổi
 * trạng thái khi giao dịch thật sự nhận nó (giao dịch vừa bị huỷ hay vừa có chân thứ hai ở request khác thì không).
 * Trả true khi đã gắn.
 */
async function attachSecondLeg(db: D1Database, txId: number, logId: string): Promise<boolean> {
  const written = await commit(db, [
    db.prepare("UPDATE transactions SET log_id_2 = ? WHERE id = ? AND status = 'active' AND log_id_2 IS NULL").bind(logId, txId),
    db
      .prepare("UPDATE bank_logs SET status = 'assigned' WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND log_id_2 = ?)")
      .bind(logId, txId, logId),
  ]);
  return written && !!(await db.prepare("SELECT 1 AS ok FROM transactions WHERE id = ? AND log_id_2 = ?").bind(txId, logId).first());
}

/**
 * Rule kèm cột của change 261001: nguồn thu (rule lương) và người thuê (chỉ gợi ý); và của ADR-77: tài khoản rule áp
 * dụng (`accountId`, null = mọi tài khoản), tài khoản đầu kia của rule chuyển nội bộ (bỏ heo đất). Rule không còn cột ví
 * (bỏ ở 0040, ADR-131).
 */
type LoadedRule = RuleRow & {
  incomeStreamId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  accountId: string | null;
  counterAccountId: string | null;
  counterAccountName: string | null;
  counterOpenedAt: string | null;
};

async function loadRuleRows(db: D1Database): Promise<LoadedRule[]> {
  const res = await db
    .prepare(
      `SELECT r.id, r.priority, r.match_type AS matchType, r.pattern, r.meaning, r.is_salary AS isSalary,
              r.category_id AS categoryId, r.by_member_id AS byMemberId,
              r.income_stream_id AS incomeStreamId, r.tenant_id AS tenantId, t.name AS tenantName,
              r.account_id AS accountId, r.counter_account_id AS counterAccountId, c.name AS counterAccountName,
              c.opened_at AS counterOpenedAt
       FROM rules r LEFT JOIN tenants t ON t.id = r.tenant_id LEFT JOIN accounts c ON c.id = r.counter_account_id
       WHERE r.active = 1`,
    )
    .all<Row>();
  return rows(res).map((r) => ({ ...r, isSalary: Boolean(r.isSalary) })) as unknown as LoadedRule[];
}

/** Tài khoản tiền mặt của một thành viên; không có thì của chủ tài khoản nguồn; vẫn không có thì ví tiền mặt chung. */
async function cashAccountFor(db: D1Database, byMemberId: string | null, sourceAccountId: string): Promise<string | null> {
  const forMember = async (memberId: string) =>
    (await db.prepare("SELECT id FROM accounts WHERE kind = 'cash' AND owner_member_id = ? AND active = 1 LIMIT 1").bind(memberId).first<{ id: string }>())?.id ?? null;
  if (byMemberId) {
    const found = await forMember(byMemberId);
    if (found) return found;
  }
  const owner = await db.prepare("SELECT owner_member_id FROM accounts WHERE id = ?").bind(sourceAccountId).first<{ owner_member_id: string | null }>();
  const own = owner?.owner_member_id ? await forMember(owner.owner_member_id) : null;
  if (own) return own;
  return (
    (await db
      .prepare("SELECT id FROM accounts WHERE kind = 'cash' AND active = 1 ORDER BY owner_member_id IS NOT NULL, id LIMIT 1")
      .first<{ id: string }>())?.id ?? null
  );
}

interface LogCtx {
  id: string;
  at: string;
  amount: number;
  direction: "in" | "out";
  accountId: string;
  content: string | null;
  refCode: string | null;
}

/**
 * Luồng khớp log (ingest UC-303): ghép cặp nội bộ → gắn làm chân thứ hai của chuyển nội bộ đã ghi (ADR-81) → rule mã/từ
 * khoá (spend/transfer) hoặc rule lương (income) → log lãi tiền gửi → còn lại giữ 'pending'. Dùng chung cho webhook lẫn
 * backfill (cùng rule, cùng ghép cặp). Không còn khớp mã `PF` (lệnh chuyển đã bỏ, ADR-124). Chuyển khoản chỉ tài khoản →
 * tài khoản; sau khi ghi khoản thu / chuyển khoản chạy tự tick việc tháng (pocket UC-1206). Trả id khoản thu khi rule lương
 * vừa ghi một khoản lương có nhắc ① (để webhook báo lương về, notify UC-412); còn lại null.
 */
async function matchLog(db: D1Database, log: LogCtx): Promise<number | null> {
  // 1. Ghép cặp nội bộ: log ngược hướng, cùng số tiền, khác TK của hộ, lệch ≤ 10 phút, chưa gán — và không trước
  // ngày mở sổ của tài khoản nó, hay là log lịch sử trước mốc theo dõi SePay (ADR-76, ADR-113; log như vậy nhận trước khi
  // có luật này có thể còn 'pending'). Log webhook không bao giờ bị loại vì mốc.
  const candidates = await db
    .prepare(
      `SELECT l.id, l.at, l.account_id AS accountId, l.direction, l.amount FROM bank_logs l JOIN accounts a ON a.id = l.account_id
       WHERE l.status = 'pending' AND l.account_id <> ? AND l.amount = ? AND l.direction <> ? AND l.id <> ?
         AND (a.opened_at IS NULL OR date(l.at, '+7 hours') >= a.opened_at)
         AND (a.feed_from IS NULL OR julianday(l.at) >= julianday(a.feed_from) OR l.source = 'webhook')`,
    )
    .bind(log.accountId, log.amount, log.direction, log.id)
    .all<PairCandidate>();
  const self: PairCandidate = { id: log.id, accountId: log.accountId, direction: log.direction, amount: log.amount, at: log.at };
  const match = rows<PairCandidate>(candidates).find((c) => canPair(self, c));
  if (match) {
    const outLeg = log.direction === "out" ? self : match;
    const inLeg = log.direction === "in" ? self : match;
    const row = logRow({
      at: log.at,
      amount: log.amount,
      meaning: "transfer",
      accountId: outLeg.accountId,
      counterAccountId: inLeg.accountId,
      categoryId: null,
      byMemberId: null,
      note: "Tự ghép cặp chuyển khoản nội bộ",
    });
    if (await commit(db, [logTxStmt(db, row, outLeg.id, inLeg.id), markAssigned(db, log.id, match.id)])) await afterCodedWrite(db, outLeg.id);
    return null;
  }

  // 2. Chân còn lại của chuyển nội bộ đã ghi từ một chân (ADR-81): chân kia đã được gán (tay hoặc rule) trước khi
  // log này về — không còn log 'pending' nào để ghép cặp — nên gắn vào giao dịch đó thay vì ghi lần hai.
  const single = await findSingleLegTransfer(db, self);
  if (single && (await attachSecondLeg(db, single.txId, log.id))) {
    await linkByCode(db, single.txId);
    await afterWrite(db);
    return null;
  }

  // 3. Rule mã CK / từ khoá (chi ra) hoặc rule lương (tiền vào, is_salary=1).
  // Rule người thuê chỉ để gợi ý ở màn Gán (ADR-60), không bao giờ tự gán.
  // Tiền ra của tài khoản đang để "chỉ tiền vào" (sepay_out = 0) được nhập tay ở màn Nhập (ADR-66): log này có thể
  // là đúng khoản đã nhập, nên không tự gán theo rule — giữ 'pending' để người xem (gợi ý kèm lời nhắc ở màn Gán).
  // Log ra trước lúc bật "báo cả tiền ra" (sepay_out_from, SePay gửi lại lịch sử) cũng vậy: khoản chi đó đã nhập tay.
  if (log.direction === "out" && (await outNotFed(db, log.accountId, log.at))) return null;
  // 3a. Mã việc trong nội dung (UC-303 AC-33, "TL 7K2Q T11"): khớp một việc đang mở → thắng mọi mẫu tự gán — chuyển khoản tới
  // đích của việc, ghép thẳng vào việc đó (không xét ngưỡng tự nhận). Mã không khớp việc nào thì đi tiếp luồng thường.
  const coded = log.direction === "out" ? await codeTarget(db, log.content) : null;
  if (coded && coded.accountId !== log.accountId) {
    const row = logRow({ at: log.at, amount: log.amount, meaning: "transfer", accountId: log.accountId, counterAccountId: coded.accountId, categoryId: null, byMemberId: null, note: null });
    if (await commit(db, [logTxStmt(db, row, log.id, null), markAssigned(db, log.id)])) await afterCodedWrite(db, log.id);
    return null;
  }
  const rule = matchRule(
    (await loadRuleRows(db)).filter((r) => !r.tenantId && (!r.accountId || r.accountId === log.accountId)),
    log.direction,
    log.content,
    log.refCode,
  ) as LoadedRule | null;
  // Mẫu lương chỉ dựa vào nội dung chuyển khoản — ai biết số tài khoản cũng gõ được. Khoản nhỏ hơn ngưỡng thì
  // không tự ghi thu nhập: để 'pending' cho người trong nhà xác nhận (luật 6: tiền vào phải hỏi). Đủ ngưỡng: khoản thu
  // gắn nguồn của rule, "Đây là lương" theo Q1-B (UC-1205), cùng batch với nhắc ① trích Tích luỹ.
  if (rule?.meaning === "income" && log.amount >= (await salaryMinAmount(db))) {
    const refs = await loadRefs(db);
    const row = logRow({
      at: log.at,
      amount: log.amount,
      meaning: "income",
      accountId: null,
      counterAccountId: log.accountId,
      categoryId: null,
      byMemberId: rule.byMemberId,
      note: null,
      incomeStreamId: rule.incomeStreamId,
      ruleId: Number(rule.id),
    });
    row.is_salary = resolveIsSalary(refs, row, undefined, { interest: false }) ? 1 : 0;
    const income = await incomeStatements(db, refs, row, { memberId: rule.byMemberId });
    if (!(await commit(db, [logTxStmt(db, row, log.id, null), ...income.statements, markAssigned(db, log.id)]))) return null;
    await afterWrite(db);
    if (!income.savings) return null;
    const tx = await db.prepare("SELECT id FROM transactions WHERE log_id = ? AND status = 'active'").bind(log.id).first<{ id: number }>();
    return tx ? Number(tx.id) : null;
  }
  // Rule chi không danh mục không tự gán (Cài đặt hiện "Cần chọn danh mục", ingest UC-307).
  if (rule?.meaning === "spend" && rule.categoryId) {
    const row = logRow({
      at: log.at,
      amount: log.amount,
      meaning: "spend",
      accountId: log.accountId,
      counterAccountId: null,
      categoryId: rule.categoryId,
      byMemberId: rule.byMemberId,
      note: null,
      ruleId: Number(rule.id),
    });
    await commit(db, [logTxStmt(db, row, log.id, null), markAssigned(db, log.id)]);
    return null;
  }
  if (rule?.meaning === "transfer") {
    // Rule có tài khoản đầu kia (bỏ heo đất, ADR-77) chuyển đúng tới đó; không có thì là rút tiền mặt.
    // Ngày log trước ngày mở sổ của đầu kia thì để người gán (ADR-76: số dư đầu đã gồm khoản đó).
    if (rule.counterAccountId && rule.counterOpenedAt && dayKey(log.at) < rule.counterOpenedAt) return null;
    const counter = rule.counterAccountId ?? (await cashAccountFor(db, rule.byMemberId, log.accountId));
    if (counter) {
      const row = logRow({
        at: log.at,
        amount: log.amount,
        meaning: "transfer",
        accountId: log.accountId,
        counterAccountId: counter,
        categoryId: null,
        byMemberId: rule.byMemberId,
        note: null,
        ruleId: Number(rule.id),
      });
      if (await commit(db, [logTxStmt(db, row, log.id, null), markAssigned(db, log.id)])) await afterWrite(db);
      return null;
    }
  }
  // 4. Log lãi tiền gửi (bước cuối, change 261018-lai-tien-gui): tài khoản nhận đang dùng → tự ghi khoản thu Thu nhập thụ
  // động (không bao giờ là lương); tài khoản đã tắt thì giữ 'pending'.
  // 5. Còn lại: giữ 'pending' (giá trị mặc định lúc insert), không làm gì thêm — lượt cron kế tiếp (≤ 15 phút) sẽ báo.
  if (isInterestLog(log, await interestMaxAmount(db))) {
    const refs = await loadRefs(db);
    if (!refs.accounts.some((a) => a.id === log.accountId)) return null;
    const row = logRow({ at: log.at, amount: log.amount, meaning: "income", accountId: null, counterAccountId: log.accountId, categoryId: null, byMemberId: null, note: null });
    await commit(db, [logTxStmt(db, row, log.id, null), interestClass(db), markAssigned(db, log.id)]);
  }
  return null;
}

/** Sau khi ghi chuyển khoản từ log `logId`: ghép theo mã trong nội dung trước, rồi tự tick theo luật (pocket UC-1206). */
async function afterCodedWrite(db: D1Database, logId: string): Promise<void> {
  const tx = await db.prepare("SELECT id FROM transactions WHERE log_id = ? AND status = 'active'").bind(logId).first<{ id: number }>();
  if (tx) await linkByCode(db, Number(tx.id));
  await afterWrite(db);
}

/**
 * Log ra mà SePay không được coi là báo tiền ra (tài khoản không nối, sepay_out = 0, hoặc log trước lúc bật "báo cả tiền
 * ra" — `sepay_out_from`): khoản chi đó nhập tay được (ADR-66, ADR-113).
 */
async function outNotFed(db: D1Database, accountId: string, at: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT sepay_enabled AND sepay_out AS fed, sepay_out_from AS since FROM accounts WHERE id = ?")
    .bind(accountId)
    .first<{ fed: number; since: string | null }>();
  return !!row && (!row.fed || (row.since !== null && Date.parse(at) < Date.parse(row.since)));
}

/** Log có thể là cùng một giao dịch với log đang xét: khác nguồn, cùng tài khoản/số tiền/chiều, lệch ≤ 3 phút, một bên thiếu mã. */
async function findPossibleTwin(
  db: D1Database,
  log: { accountId: string; amount: number; direction: string; at: string; source: string; referenceNumber: string | null; excludeId?: string },
): Promise<string | null> {
  const at = Date.parse(log.at);
  const row = await db
    .prepare(
      `SELECT id FROM bank_logs
       WHERE account_id = ? AND amount = ? AND direction = ? AND source <> ? AND id <> ?
         AND (reference_number IS NULL OR reference_number = '' OR ? IS NULL OR ? = '')
         AND at BETWEEN ? AND ?
       ORDER BY at LIMIT 1`,
    )
    .bind(log.accountId, log.amount, log.direction, log.source, log.excludeId ?? "", log.referenceNumber, log.referenceNumber ?? "", new Date(at - 180_000).toISOString(), new Date(at + 180_000).toISOString())
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Ghi log ngân hàng idempotent rồi chạy khớp; dùng chung cho webhook và backfill.
 * `connectionId` (ADR-75): log đến qua kết nối SePay nào thì chỉ khớp vào tài khoản thuộc kết nối đó — khoá webhook
 * của SePay người này không ghi được vào tài khoản của người kia. Không khớp được thì như tài khoản lạ (account_id NULL).
 * Log của ngày trước ngày mở sổ của tài khoản (ADR-76) đã nằm trong số dư đầu: lưu 'ignored' để đối chiếu, không khớp,
 * không báo, không ghép cặp — `beforeOpening: true`. Log LỊCH SỬ (rà soát, Đồng bộ lại) trước mốc theo dõi SePay
 * (`feed_from`, ADR-113) đã vào sổ bằng đường khác: xử lý y như vậy — `beforeFeed: true`. Webhook là SePay báo lúc đó (kể cả
 * về trễ mang giờ trước mốc): không bao giờ bị bỏ vì mốc. `salaryTxId`: id khoản lương có nhắc ① mà rule lương vừa ghi — chỉ
 * webhook báo lương về (notify UC-412); rà soát đêm / Đồng bộ lịch sử bỏ qua.
 */
export async function ingestLog(
  db: D1Database,
  parsed: ParsedBankLog,
  source: "webhook" | "backfill",
  now: Date,
  connectionId?: string,
): Promise<{ created: boolean; logId: string; beforeOpening?: boolean; beforeFeed?: boolean; linkedTo?: number; salaryTxId?: number }> {
  const byId = await db.prepare("SELECT id FROM bank_logs WHERE id = ?").bind(parsed.id).first<{ id: string }>();
  if (byId) return { created: false, logId: parsed.id };

  // Tài khoản ảo (VA) của SePay mang subAccount riêng: khớp nó trước, rồi mới tới số tài khoản chính.
  const scope = connectionId === undefined ? "" : " AND sepay_connection_id = ?";
  const lookup = (col: "sub_account" | "account_no", value: string) => {
    const st = db.prepare(`SELECT id, opened_at, feed_from, sepay_out_from FROM accounts WHERE ${col} = ?${scope}`);
    return (connectionId === undefined ? st.bind(value) : st.bind(value, connectionId)).first<{
      id: string;
      opened_at: string | null;
      feed_from: string | null;
      sepay_out_from: string | null;
    }>();
  };
  const account =
    (parsed.subAccount ? await lookup("sub_account", parsed.subAccount) : null) ?? (parsed.accountNo ? await lookup("account_no", parsed.accountNo) : null);
  const accountId = account?.id ?? null;
  const beforeOpeningDay = !!account?.opened_at && dayKey(parsed.at) < account.opened_at;
  // Log lịch sử trước mốc theo dõi SePay (ADR-113): khoản đó đã vào sổ bằng đường khác — xử lý như log trước ngày mở sổ.
  // Webhook về trễ (mang giờ trước mốc) vẫn là SePay báo lúc đó, không bỏ.
  const beforeFeed = source !== "webhook" && !beforeOpeningDay && !!account?.feed_from && Date.parse(parsed.at) < Date.parse(account.feed_from);
  const beforeOpening = beforeOpeningDay || beforeFeed;

  if (parsed.referenceNumber) {
    // S9: khoá chống trùng giữa webhook và rà soát là (account_id, reference_number), không chỉ riêng id.
    const byRef = await db.prepare("SELECT id FROM bank_logs WHERE reference_number = ? AND account_id IS ?").bind(parsed.referenceNumber, accountId).first<{ id: string }>();
    if (byRef) return { created: false, logId: byRef.id };
  }

  // Một bên thiếu mã tham chiếu (webhook có lúc không gửi mã FT) thì khoá (tài khoản, mã) không bắt được trùng.
  // Nếu có log từ NGUỒN KHÁC cùng tài khoản, số tiền, chiều, lệch ≤ 3 phút thì KHÔNG chứng minh được là một hay hai
  // giao dịch (hai khoản 500k thật trong 3 phút là chuyện thường). Hai cách xử lý sai đều tệ: bỏ log mới là mất
  // tiền lặng lẽ, tự khớp log mới là có thể chia lương hai lần. Nên: vẫn ghi log, không tự khớp, để chờ người gán —
  // màn Gán hiện "có thể trùng", đúng là một thì bấm Bỏ qua.
  const twin = accountId && !beforeOpening ? await findPossibleTwin(db, { accountId, amount: parsed.amount, direction: parsed.direction, at: parsed.at, source, referenceNumber: parsed.referenceNumber }) : null;

  const insert = await db
    .prepare(
      `INSERT OR IGNORE INTO bank_logs (id, at, amount, direction, account_id, account_no, content, ref_code, reference_number, raw, source, status, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      parsed.id,
      parsed.at,
      parsed.amount,
      parsed.direction,
      accountId,
      parsed.accountNo,
      parsed.content,
      parsed.refCode,
      parsed.referenceNumber,
      JSON.stringify(parsed.raw),
      source,
      beforeOpening ? "ignored" : "pending",
      sqliteDateTime(now),
    )
    .run();
  // Thua race chống trùng: trùng id, hoặc trùng (tài khoản, mã tham chiếu) nhờ unique index ở migration 0005.
  if (!insert.meta.changes) return { created: false, logId: parsed.id };
  if (beforeOpeningDay) return { created: true, logId: parsed.id, beforeOpening: true };
  if (beforeFeed) return { created: true, logId: parsed.id, beforeFeed: true };

  if (accountId && !twin) {
    try {
      // Webhook về trễ mang giờ trước mốc (ADR-113): khoản đó có thể đã nhập tay trước lúc nối. Nối vào đúng khoản tay đó
      // TRƯỚC ghép cặp và rule — ghép cặp với chân kia đang chờ hay rule tự gán là ghi lần hai.
      const mark = source === "webhook" ? feedMark(parsed.direction, account!.feed_from, account!.sepay_out_from) : null;
      if (mark && Date.parse(parsed.at) < Date.parse(mark)) {
        const hit = closest(await manualMatches(db, { accountId, direction: parsed.direction, amount: parsed.amount, at: parsed.at }, mark), parsed.at);
        if (hit && (await linkLogToTx(db, hit.id, parsed.id, linkColumn(parsed.direction, hit.meaning)))) {
          return { created: true, logId: parsed.id, linkedTo: hit.id };
        }
      }
      const salaryTxId = await matchLog(db, { id: parsed.id, at: parsed.at, amount: parsed.amount, direction: parsed.direction, accountId, content: parsed.content, refCode: parsed.refCode });
      if (salaryTxId) return { created: true, logId: parsed.id, salaryTxId };
    } catch (err) {
      // Log đã được ghi: gửi lại không chạy lại bước khớp (ingestLog dừng sớm khi log đã có), nên lỗi ở đây —
      // ví dụ ghi khoản lương + nhắc lỗi (log còn chờ) — phải được ghi lại để tin sáng báo, không được im lặng.
      await recordIngestError(db, source, parsed.id, `Đã lưu nhưng xử lý tiếp bị lỗi: ${err instanceof Error ? err.message : "unknown"}`, now);
    }
  }
  return { created: true, logId: parsed.id };
}

// ── Đọc log chưa gán, kèm gợi ý ───────────────────────────────────────

/**
 * Log đang chờ gán, mới trước, kèm gợi ý (ingest UC-305). Log của tài khoản riêng tư bị giấu với `viewerId` không liệt kê
 * (access UC-504: Gán chỉ hiện dòng đếm `attention.hiddenPendingLogs`); gợi ý trỏ tài khoản đầu kia bị giấu (chân hai, rút
 * heo, mẫu chuyển) bị bỏ (access UC-504 AC-17). Không còn gợi ý lệnh chuyển (`order_matches`), không trường ví (ADR-123).
 */
export async function listPendingLogs(db: D1Database, limit: number, viewerId: string | null): Promise<Record<string, unknown>[]> {
  const hidden = await hiddenAccountIds(db, viewerId);
  const res = await db
    .prepare(
      `SELECT l.*, a.name AS account_name FROM bank_logs l LEFT JOIN accounts a ON a.id = l.account_id
       WHERE l.status = 'pending' AND (l.account_id IS NULL OR l.account_id NOT IN (${hidden.map(() => "?").join(", ")}))
       ORDER BY l.at DESC LIMIT ?`,
    )
    .bind(...hidden, Math.min(Math.max(limit, 1), 200))
    .all<Row>();
  const list = rows(res);
  const ruleRows = await loadRuleRows(db);
  const accountRows = rows<{ id: string; fed: number; since: string | null; private: number }>(
    await db.prepare("SELECT id, sepay_enabled AND sepay_out AS fed, sepay_out_from AS since, private FROM accounts").all(),
  );
  const sepayOut = new Map(accountRows.map((a) => [a.id, { fed: Boolean(a.fed), since: a.since }]));
  // Gợi ý người thuê (rental UC-805 AC-11): mã QR các bản tính đã gửi, đọc một lần cho cả danh sách; log của tài khoản
  // riêng tư (bất kể người xem) không nhận gợi ý người thuê — tiền thuê không vào tài khoản riêng tư (N-1).
  const tenantHints: TenantHints = {
    privateAccounts: new Set(accountRows.filter((a) => a.private).map((a) => a.id)),
    memos: list.some((r) => r.direction === "in") ? await issuedBillMemos(db) : [],
  };
  // Tài khoản tiền mặt để gợi ý "Rút tiền mặt" chỉ phụ thuộc tài khoản nguồn: hỏi DB một lần cho mỗi tài khoản.
  const cashCache = new Map<string, Promise<string | null>>();
  const cashOf = (accountId: string) => {
    if (!cashCache.has(accountId)) cashCache.set(accountId, cashAccountFor(db, null, accountId));
    return cashCache.get(accountId)!;
  };
  // Gợi ý Lãi tiền gửi (change 261018-lai-tien-gui): log lãi của tài khoản đang dùng.
  const maxInterest = await interestMaxAmount(db);
  let refs: Promise<Refs> | null = null;
  const interestOf = async (row: Row): Promise<boolean> => {
    if (!isInterestLog({ direction: String(row.direction), amount: Number(row.amount), content: (row.content as string | null) ?? null }, maxInterest)) return false;
    refs ??= loadRefs(db);
    return (await refs).accounts.some((a) => a.id === row.account_id);
  };
  return Promise.all(
    list.map(async (row) => {
      // "Đã nhập tay?" ở màn Gán: khoản tay khớp log (không riêng log trước mốc) — Nối là gắn log vào đó, không ghi thêm.
      const manual_matches = row.account_id
        ? await manualMatches(db, { accountId: row.account_id as string, direction: row.direction as "in" | "out", amount: Number(row.amount), at: String(row.at) })
        : [];
      const log: Row = { ...row, manual_matches };
      const twin = log.account_id
        ? await findPossibleTwin(db, {
            accountId: log.account_id as string,
            amount: Number(log.amount),
            direction: String(log.direction),
            at: String(log.at),
            source: String(log.source),
            referenceNumber: (log.reference_number as string | null) ?? null,
            excludeId: String(log.id),
          })
        : null;
      // Có thể trùng thì gợi ý bỏ qua, không gợi ý gán — gán nhầm là đếm hai lần.
      if (twin) return { ...log, suggestion: { possible_duplicate_of: twin, label: "Có thể trùng giao dịch đã ghi" } };
      // Chân còn lại của chuyển nội bộ đã ghi (ADR-81): gán là gắn vào giao dịch đó, không ghi thêm.
      const leg = log.account_id
        ? await findSingleLegTransfer(db, { id: String(log.id), accountId: log.account_id as string, direction: log.direction as "in" | "out", amount: Number(log.amount), at: String(log.at) })
        : null;
      if (leg && !hidden.includes(leg.accountId)) {
        const minute = minuteOfDay(leg.at);
        const hhmm = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        return { ...log, suggestion: { meaning: "transfer", other_account_id: leg.accountId, attach_to_tx: leg.txId, label: `Khớp chuyển nội bộ đã ghi lúc ${hhmm}` } };
      }
      // Log ra không được coi là SePay báo (ADR-66), hay từ trước lúc bật "báo cả tiền ra" (ADR-113): nhắc có thể đã nhập tay.
      const out = sepayOut.get(log.account_id as string);
      const outNote = !out ? null : !out.fed ? OUT_NOT_FED_NOTE : out.since !== null && Date.parse(String(log.at)) < Date.parse(out.since) ? OUT_BEFORE_MARK_NOTE : null;
      return { ...log, suggestion: await suggestFor(log, ruleRows, cashOf, outNote, interestOf, hidden, tenantHints) };
    }),
  );
}

const OUT_NOT_FED_NOTE =
  "SePay vừa báo tiền ra cho tài khoản đang để 'chỉ tiền vào'. Nếu khoản này đã ghi tay thì Bỏ qua, rồi bật 'SePay báo cả tiền ra' ở Cài đặt.";
const OUT_BEFORE_MARK_NOTE = "Khoản chi này trước lúc bật 'SePay báo cả tiền ra', lúc đó còn ghi tay. Nếu đã ghi tay thì Bỏ qua.";

/** Dữ liệu gợi ý người thuê đọc một lần cho cả danh sách log chờ. */
type TenantHints = { privateAccounts: Set<string>; memos: { tenantId: string; tenantName: string; key: string }[] };

/**
 * Gợi ý cho màn Gán (không trường ví, ADR-123): rule chi khớp mã nhưng thiếu danh mục → gợi ý chọn danh mục; log `out` không
 * khớp rule mà nội dung trông như rút tiền mặt (`looksLikeCashWithdrawal` — ATM, RUT TIEN…) → gợi ý Rút tiền mặt; không khớp
 * gì khác → không gợi ý (trả QR, hoá đơn không phải rút tiền — màn Gán mặc định Chi tiêu);
 * log `in` khớp rule người thuê, hay nội dung chứa mã QR bản tính đã gửi của đúng một người thuê (so `memoKey` — chỉ chữ số,
 * viết hoa; khớp nhiều người → không gợi ý) → gợi ý "Thu từ <tên>" (rental UC-805 AC-11; chỉ gợi ý, ADR-60) — trừ log của
 * tài khoản riêng tư (N-1); log `in` là log lãi tiền gửi → gợi ý "Lãi tiền gửi".
 * Log `out` của tài khoản "chỉ tiền vào" (`outNotFed`, ADR-66) hay từ trước lúc bật "báo cả tiền ra" (ADR-113) không được tự
 * gán, nên gợi ý luôn theo rule khớp và kèm lời nhắc `outNote` (có thể đã nhập tay). Rule chuyển nội bộ có tài khoản đầu kia
 * (heo đất, ADR-77/ADR-82): tiền ra gợi ý chuyển sang đó; tiền vào khớp cùng rule là heo trả về — gợi ý chuyển chiều ngược lại,
 * không bao giờ tự gán. Gợi ý chuyển sang / về tài khoản trong `hidden` (riêng tư bị giấu với người xem) bị bỏ (access UC-504 AC-17).
 */
async function suggestFor(
  log: Row,
  allRules: LoadedRule[],
  cashOf: (accountId: string) => Promise<string | null>,
  outNote: string | null,
  interestOf: (log: Row) => Promise<boolean>,
  hidden: string[],
  tenantHints: TenantHints,
): Promise<Record<string, unknown> | null> {
  if (!log.account_id) return null;
  const outNotFed = outNote !== null;
  const rules = allRules.filter((r) => !r.accountId || r.accountId === log.account_id);
  if (log.direction === "in") {
    // Tiền vào luôn hỏi; chỉ gợi ý người thuê khi khớp rule của họ hay mã QR bản tính, người vẫn phải bấm xác nhận.
    if (!tenantHints.privateAccounts.has(String(log.account_id))) {
      const tenantRules = rules.filter((r) => r.tenantId).map((r) => ({ ...r, meaning: "income" as const, isSalary: true }));
      const hit = matchRule(tenantRules, "in", log.content as string | null, log.ref_code as string | null) as LoadedRule | null;
      if (hit) return { meaning: "income", tenant_id: hit.tenantId, label: `Thu từ ${hit.tenantName ?? hit.tenantId}` };
      const content = memoKey(String(log.content ?? ""));
      const matched = new Map(tenantHints.memos.filter((m) => m.key && content.includes(m.key)).map((m) => [m.tenantId, m.tenantName]));
      if (matched.size === 1) {
        const [tenantId, tenantName] = [...matched][0]!;
        return { meaning: "income", tenant_id: tenantId, label: `Thu từ ${tenantName}` };
      }
    }
    const backRules = rules.filter((r) => r.meaning === "transfer" && r.counterAccountId).map((r) => ({ ...r, meaning: "income" as const, isSalary: true }));
    const back = matchRule(backRules, "in", log.content as string | null, log.ref_code as string | null) as LoadedRule | null;
    if (back && !hidden.includes(back.counterAccountId!)) return { meaning: "transfer", other_account_id: back.counterAccountId, label: `Rút heo về ${log.account_name ?? log.account_id}` };
    return (await interestOf(log)) ? { meaning: "income", interest: true, label: "Lãi tiền gửi" } : null;
  }
  const rule = matchRule(rules, "out", log.content as string | null, log.ref_code as string | null) as LoadedRule | null;
  let base: Record<string, unknown> | null = null;
  if (rule?.meaning === "spend" && !rule.categoryId) {
    base = { meaning: "spend", note: "Khớp mã nhưng thiếu danh mục: chọn danh mục để lưu." };
  } else if (rule?.meaning === "spend" && outNotFed) {
    base = { meaning: "spend", category_id: rule.categoryId };
  } else if (rule?.meaning === "transfer" && rule.counterAccountId && outNotFed) {
    base = { meaning: "transfer", other_account_id: rule.counterAccountId, label: `Chuyển sang ${rule.counterAccountName ?? rule.counterAccountId}` };
  } else if ((!rule && looksLikeCashWithdrawal(log.content as string | null)) || (rule?.meaning === "transfer" && outNotFed)) {
    const cash = await cashOf(log.account_id as string);
    if (cash) base = { meaning: "transfer", other_account_id: cash, label: "Rút tiền mặt" };
  }
  if (typeof base?.other_account_id === "string" && hidden.includes(base.other_account_id)) base = null;
  if (!outNote) return base;
  return { ...base, note: base?.note ? `${outNote} ${base.note as string}` : outNote };
}

// ── Gán / bỏ qua / ghép tay ───────────────────────────────────────────

function splitToEntryInput(log: Row, split: Split): EntryInput {
  const base = {
    meaning: split.meaning as EntryInput["meaning"],
    amount: split.amount,
    at: String(log.at),
    category_id: split.category_id ?? undefined,
    note: split.note ?? undefined,
    taxable: split.taxable,
    asset_kind: split.asset_kind ?? undefined,
    income_stream_id: split.income_stream_id ?? undefined,
    tenant_id: split.tenant_id ?? undefined,
    debt_id: split.debt_id ?? undefined,
    interest_debt_id: split.interest_debt_id ?? undefined,
    receivable_id: split.receivable_id ?? undefined,
    link_id: split.link_id ?? undefined,
    is_salary: split.is_salary,
    goal_id: split.goal_id ?? undefined,
    from_interest: split.from_interest === true,
  };
  const accountId = (log.account_id as string | null) ?? undefined;
  if (split.meaning === "transfer") {
    if (!split.other_account_id) fail("missing_account", "Chuyển khoản cần tài khoản đầu kia (other_account_id).");
    return log.direction === "out"
      ? { ...base, account_id: accountId, to_account_id: split.other_account_id }
      : { ...base, account_id: split.other_account_id, to_account_id: accountId };
  }
  return { ...base, account_id: accountId };
}

/** Nhắc ① của các dòng lương trong một lần gán: cộng số (cùng `savings_pct`); không dòng nào có nhắc → null. */
function sumSavings(list: (SavingsPlan | null)[]): SavingsPlan | null {
  const plans = list.filter((p): p is SavingsPlan => p !== null);
  return plans.length ? { amount: plans.reduce((s, p) => s + p.amount, 0), pct: plans[0]!.pct } : null;
}

/**
 * Gán một log thành 1..N giao dịch (ingest UC-305); tổng các split phải bằng đúng số tiền log. Dòng có trường cũ (ví,
 * `earmark_id`, `opens_cycle`) → 400 `model_changed` (ADR-123, ADR-131 (7), ADR-144). Log của tài khoản riêng tư bị giấu với
 * người gán, dòng chuyển khoản sang tài khoản đó, hay gắn chân hai vào chuyển khoản chạm tài khoản đó → 403 `private_account`
 * (access UC-504 AC-17, ADR-133). Gán đúng một dòng chuyển nội bộ trọn số tiền mà log là chân còn lại của chuyển nội bộ đã
 * ghi sang đúng tài khoản đó (ADR-81) → gắn vào giao dịch ấy (`attached: true`, không ghi thêm). Dòng thu nhập: "Đây là lương"
 * theo Q1-B (`is_salary` ghi đè), khoản lương có nhắc ① cùng batch (pocket UC-1205); dòng lãi tiền gửi (`interest`): khoản thu
 * Thu nhập thụ động, không bao giờ là lương. Sau khi ghi chạy tự tick; `effects` như nhập tay.
 */
export async function assignLog(
  db: D1Database,
  logId: string,
  splits: Split[],
  memberId: string | null,
  now: Date,
): Promise<{ log: Record<string, unknown>; transactions: Record<string, unknown>[]; attached: boolean; effects: WriteEffects }> {
  if (!Array.isArray(splits) || splits.length === 0) return fail("missing_splits", "Cần ít nhất một dòng gán.");
  for (const s of splits) rejectOldFields(s as unknown as Record<string, unknown>);
  const log = await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>();
  if (!log) return fail("not_found", "Không có log này.");
  const hidden = await hiddenAccountIds(db, memberId);
  assertLogChangeable(log, hidden);
  if (log.status !== "pending") throw new DomainError("not_pending", "Giao dịch này đã được xử lý.", 409);

  const total = splits.reduce((sum, s) => sum + (Number.isFinite(s.amount) ? s.amount : 0), 0);
  if (total !== Number(log.amount)) {
    fail("split_mismatch", `Tổng các dòng (${total}) phải bằng đúng số tiền (${log.amount}).`);
  }
  // Lãi tiền gửi: đúng một dòng thu nhập của tiền vào, không bao giờ là lương (pocket UC-1205). `is_interest` cùng nghĩa `interest`.
  const interest = splits.some((s) => s.interest || s.is_interest);
  if (interest) {
    const s = splits[0]!;
    if (log.direction !== "in" || splits.length !== 1 || s.meaning !== "income" || s.tenant_id || s.income_stream_id || s.link_id || s.taxable) {
      fail("invalid_input", "Lãi tiền gửi là một dòng thu nhập của tiền vào: không tách, không kèm người thuê, nguồn thu, khoản gốc hay thuế.");
    }
  }

  const only = splits.length === 1 ? splits[0]! : null;
  if (only?.meaning === "transfer" && only.other_account_id && log.account_id) {
    const leg = await findSingleLegTransfer(
      db,
      { id: logId, accountId: log.account_id as string, direction: log.direction as "in" | "out", amount: Number(log.amount), at: String(log.at) },
      only.other_account_id,
    );
    if (leg) {
      const target = (await db.prepare("SELECT account_id, counter_account_id FROM transactions WHERE id = ?").bind(leg.txId).first<Row>())!;
      assertTxChangeable(target, hidden);
    }
    if (leg && (await attachSecondLeg(db, leg.txId, logId))) {
      const { tasksDone } = await afterWrite(db);
      const updated = (await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>())!;
      const tx = (await db.prepare("SELECT * FROM transactions WHERE id = ?").bind(leg.txId).first<Row>())!;
      return { log: updated, transactions: [tx], attached: true, effects: { savings: null, tasksDone } };
    }
  }

  const refs = await loadRefs(db);
  const built = splits.map((s) => {
    const row: TxRow = { ...buildEntry(splitToEntryInput(log, s), refs, memberId, now), source: "sepay" };
    row.is_salary = resolveIsSalary(refs, row, s.is_salary, { interest }) ? 1 : 0;
    return row;
  });
  for (const row of built) {
    assertRowWritable(row, hidden);
    assertTenantAccount(row, refs);
  }
  for (const row of built) await resolveLink(db, row, undefined, hidden);
  // "Từ tiền lãi" (UC-1209 bước 9): mọi dòng rút từ lãi của log (cùng tài khoản) cộng lại không vượt tiền lãi của nhóm.
  const fromInterest = built.filter((row) => row.from_interest === 1);
  if (fromInterest.length) await assertInterestCap(db, refs, { ...fromInterest[0]!, amount: fromInterest.reduce((s, r) => s + r.amount, 0) });

  // Mỗi khoản: câu INSERT rồi NGAY SAU là câu kèm của chính nó (nhắc ①, phân loại lãi) — các câu kèm trỏ khoản vừa chèn
  // bằng MAX(id), nên không được chen khoản khác vào giữa.
  const statements: D1PreparedStatement[] = [];
  const plans: (SavingsPlan | null)[] = [];
  for (const row of built) {
    statements.push(insertTx(db, row, { log_id: logId, log_id_2: null }));
    if (row.meaning === "income" && interest) statements.push(interestClass(db));
    else if (row.meaning === "income") {
      const income = await incomeStatements(db, refs, row, { memberId });
      statements.push(...income.statements);
      plans.push(income.savings);
    }
  }
  statements.push(markAssigned(db, logId));
  if (!(await commit(db, statements))) throw new DomainError("not_pending", "Giao dịch này vừa được xử lý ở nơi khác.", 409);
  const { tasksDone } = await afterWrite(db);

  const updatedLog = (await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>())!;
  const created = await db.prepare("SELECT * FROM transactions WHERE log_id = ? ORDER BY id DESC LIMIT ?").bind(logId, splits.length).all<Row>();
  return { log: updatedLog, transactions: rows(created), attached: false, effects: { savings: sumSavings(plans), tasksDone } };
}

/**
 * Nút **Nối** ở màn Gán ("Đã nhập tay?"): gắn log đang chờ vào khoản nhập tay đã ghi đúng khoản đó — không tạo giao dịch,
 * không đổi danh mục / ghi chú. Giao dịch không phải khoản tay khớp log (sai chiều, sai số tiền, lệch quá 1 ngày,
 * tách dòng, đã mang log của tài khoản này) → 409 `link_mismatch`. Log của tài khoản riêng tư bị giấu với người nối → 403
 * `private_account` (access UC-504 AC-13).
 */
export async function linkLog(db: D1Database, logId: string, txId: number, memberId: string | null): Promise<{ log: Record<string, unknown>; transaction: Record<string, unknown> }> {
  const log = await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>();
  if (!log) throw new DomainError("not_found", "Không có log này.", 404);
  assertLogChangeable(log, await hiddenAccountIds(db, memberId));
  if (log.status !== "pending") throw new DomainError("not_pending", "Giao dịch này đã được xử lý.", 409);
  const mismatch = () => new DomainError("link_mismatch", "Khoản này không khớp giao dịch ngân hàng (chiều tiền, số tiền, ngày), không nối được.", 409);
  if (!log.account_id) throw mismatch();
  const direction = log.direction as "in" | "out";
  const hit = (await manualMatches(db, { accountId: log.account_id as string, direction, amount: Number(log.amount), at: String(log.at) })).find((m) => m.id === txId);
  if (!hit) throw mismatch();
  if (!(await linkLogToTx(db, txId, logId, linkColumn(direction, hit.meaning)))) throw new DomainError("not_pending", "Giao dịch này vừa được xử lý ở nơi khác.", 409);
  return {
    log: (await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>())!,
    transaction: (await db.prepare("SELECT * FROM transactions WHERE id = ?").bind(txId).first<Row>())!,
  };
}

/** Đánh dấu log là không cần ghi sổ (ví dụ giao dịch thử). Log của tài khoản riêng tư bị giấu → 403 `private_account` (access UC-504 AC-13). */
export async function ignoreLog(db: D1Database, logId: string, memberId: string | null): Promise<Record<string, unknown>> {
  const log = await db.prepare("SELECT account_id FROM bank_logs WHERE id = ?").bind(logId).first<Row>();
  if (!log) throw new DomainError("not_found", "Không có log này.", 404);
  assertLogChangeable(log, await hiddenAccountIds(db, memberId));
  const res = await db.prepare("UPDATE bank_logs SET status = 'ignored' WHERE id = ? AND status = 'pending'").bind(logId).run();
  if (!res.meta.changes) throw new DomainError("not_pending", "Giao dịch này đã được xử lý.", 409);
  return (await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>())!;
}

/** Hoàn tác "Bỏ qua" (ingest UC-305 AC-38): log `ignored` về `pending`. Luật riêng tư như `ignoreLog`; không `ignored` → 409 `not_ignored`. */
export async function unignoreLog(db: D1Database, logId: string, memberId: string | null): Promise<Record<string, unknown>> {
  const log = await db
    .prepare(
      `SELECT l.account_id, (a.opened_at IS NOT NULL AND date(l.at, '+7 hours') < a.opened_at)
         OR (a.feed_from IS NOT NULL AND julianday(l.at) < julianday(a.feed_from) AND l.source <> 'webhook') AS beforeOpening
       FROM bank_logs l LEFT JOIN accounts a ON a.id = l.account_id WHERE l.id = ?`,
    )
    .bind(logId)
    .first<Row>();
  if (!log) throw new DomainError("not_found", "Không có log này.", 404);
  assertLogChangeable(log, await hiddenAccountIds(db, memberId));
  // Log trước ngày mở sổ / mốc theo dõi SePay do máy bỏ qua: số đó đã nằm trong số dư đầu — đưa về chờ gán là đếm hai lần.
  if (Number(log.beforeOpening) === 1) throw new DomainError("before_opening", "Giao dịch này trước ngày mở sổ, đã nằm trong số dư đầu.", 409);
  const res = await db.prepare("UPDATE bank_logs SET status = 'pending' WHERE id = ? AND status = 'ignored'").bind(logId).run();
  if (!res.meta.changes) throw new DomainError("not_ignored", "Giao dịch này không còn ở trạng thái bỏ qua.", 409);
  return (await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>())!;
}

/**
 * Gộp tay 2 log thành 1 transfer khi thuật toán ghép cặp tự động bỏ sót (chỉ tài khoản → tài khoản, rồi tự tick). Một trong
 * hai log thuộc tài khoản riêng tư bị giấu với người ghép → 403 `private_account` (ingest UC-306, access UC-504 AC-13).
 */
export async function pairLogs(db: D1Database, logAId: string, logBId: string, memberId: string | null): Promise<{ transactionId: number }> {
  if (logAId === logBId) return fail("same_log", "Hai log phải khác nhau.");
  const a = await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logAId).first<Row>();
  const b = await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logBId).first<Row>();
  if (!a || !b) return fail("not_found", "Không có log này.");
  const hidden = await hiddenAccountIds(db, memberId);
  assertLogChangeable(a, hidden);
  assertLogChangeable(b, hidden);
  if (a.status !== "pending" || b.status !== "pending") throw new DomainError("not_pending", "Hai khoản phải đang chờ gán.", 409);
  if (!a.account_id || !b.account_id) return fail("unknown_account", "Hai khoản phải thuộc tài khoản đã có.");
  if (a.account_id === b.account_id) return fail("same_account", "Hai khoản phải ở hai tài khoản khác nhau.");
  if (a.direction === b.direction) return fail("same_direction", "Hai log phải ngược hướng nhau.");
  if (Number(a.amount) !== Number(b.amount)) return fail("amount_mismatch", "Hai khoản phải cùng số tiền để ghép thành khoản chuyển.");
  // Số dư đầu là mốc (ADR-76): khoản ghép chạm cả hai tài khoản, nên không được sớm hơn ngày mở sổ của tài khoản nào.
  const opened = rows<{ id: string; name: string; openedAt: string | null }>(
    await db.prepare("SELECT id, name, opened_at AS openedAt FROM accounts WHERE id IN (?, ?)").bind(a.account_id, b.account_id).all(),
  );
  const earliest = String(a.at) < String(b.at) ? String(a.at) : String(b.at);
  for (const account of opened) assertOpened(account, earliest);

  const outLog = a.direction === "out" ? a : b;
  const inLog = a.direction === "out" ? b : a;
  const row = logRow({
    at: String(outLog.at),
    amount: Number(outLog.amount),
    meaning: "transfer",
    accountId: outLog.account_id as string,
    counterAccountId: inLog.account_id as string,
    categoryId: null,
    byMemberId: null,
    note: "Ghép cặp tay",
  });
  const written = await commit(db, [logTxStmt(db, row, outLog.id as string, inLog.id as string), markAssigned(db, a.id as string, b.id as string)]);
  if (!written) throw new DomainError("not_pending", "Một trong hai giao dịch vừa được xử lý ở nơi khác.", 409);
  await afterWrite(db);
  const tx = await db.prepare("SELECT id FROM transactions WHERE log_id = ? AND log_id_2 = ? AND status = 'active'").bind(outLog.id, inLog.id).first<{ id: number }>();
  return { transactionId: tx!.id };
}

/**
 * Gỡ cặp/gỡ gán sai (ingest UC-306): huỷ MỌI giao dịch còn hiệu lực sinh ra từ (các) log đó — một log có thể đã được tách
 * thành nhiều dòng — kèm câu huỷ dây chuyền của chúng (`voidTxStatements`: nhắc ① của khoản lương về `void`, `fund` cùng lô
 * của khoản thu cũ đã chia), rồi đưa log về 'pending'. Tất cả trong một
 * batch: gỡ nửa chừng mà log đã về 'pending' thì lần gán sau sẽ đếm tiền hai lần. Sau đó ghép lại việc (việc thiếu mở lại).
 * Khoản nhập tay đã nối log (261017-webhook-truoc-moc): chỉ gỡ log khỏi giao dịch, log về 'pending' — KHÔNG huỷ khoản tay.
 * Giao dịch bị giấu với người gỡ → 404 `not_found`; chạm tài khoản riêng tư của người khác → 403 `private_account` (access
 * UC-504 AC-11, AC-13) — kiểm trước mọi lỗi khác để không lộ khoản bị giấu.
 */
export async function unassignTransaction(db: D1Database, txId: number, memberId: string | null): Promise<{ voided: number[]; logs: string[] }> {
  const tx = await getTransaction(db, txId);
  if (!tx) return fail("not_found", "Không có giao dịch này.");
  assertTxChangeable(tx, await hiddenAccountIds(db, memberId));
  if (!tx.log_id && !tx.log_id_2) return fail("not_from_log", "Giao dịch này không do ngân hàng báo về.");
  if (tx.status !== "active") throw new DomainError("already_void", "Giao dịch này đã huỷ rồi.", 409);

  const logIds = [tx.log_id, tx.log_id_2].filter((x): x is string => typeof x === "string" && x.length > 0);
  const marks = logIds.map(() => "?").join(", ");
  if (tx.source === "manual") {
    await db.batch([
      db.prepare("UPDATE transactions SET log_id = NULL, log_id_2 = NULL WHERE id = ? AND status = 'active'").bind(txId),
      db.prepare(`UPDATE bank_logs SET status = 'pending' WHERE status = 'assigned' AND id IN (${marks})`).bind(...logIds),
    ]);
    return { voided: [], logs: logIds };
  }
  const ids = rows<{ id: number }>(
    await db
      .prepare(`SELECT id FROM transactions WHERE status = 'active' AND (log_id IN (${marks}) OR log_id_2 IN (${marks}))`)
      .bind(...logIds, ...logIds)
      .all(),
  ).map((t) => t.id);
  await db.batch([
    ...voidTxStatements(db, ids),
    db.prepare(`UPDATE transactions SET status = 'void' WHERE status = 'active' AND id IN (${ids.map(() => "?").join(", ")})`).bind(...ids),
    db.prepare(`UPDATE bank_logs SET status = 'pending' WHERE status = 'assigned' AND id IN (${marks})`).bind(...logIds),
  ]);
  await afterWrite(db);
  return { voided: ids, logs: logIds };
}

// ── Rules (bảng `rules`) ──────────────────────────────────────────────

const MATCH_TYPES = ["code", "content", "account"] as const;
const RULE_MEANINGS = ["spend", "transfer", "income"] as const;

export async function listRules(db: D1Database): Promise<Record<string, unknown>[]> {
  return rows(await db.prepare("SELECT * FROM rules ORDER BY priority").all<Row>());
}

export interface RuleInput {
  priority?: number;
  match_type: string;
  pattern: string;
  meaning: string;
  is_salary?: boolean;
  category_id?: string | null;
  by_member_id?: string | null;
  /** Rule income của người thuê: chỉ gợi ý "Thu từ <tên>" ở màn Gán, không tự gán. */
  tenant_id?: string | null;
  /** Rule lương: nguồn thu gắn vào khoản income tự ghi. */
  income_stream_id?: string | null;
  /** Rule chỉ áp cho log của tài khoản này (NULL = mọi tài khoản, ADR-77). */
  account_id?: string | null;
  /** Rule `transfer`: tài khoản đầu kia (heo đất, ADR-77). */
  counter_account_id?: string | null;
}

/**
 * Tạo rule (ingest UC-307). `account_id` / `counter_account_id` là tài khoản riêng tư bị giấu với người làm (`actorId`)
 * → 403 `private_account` (ADR-133 (3)) — kiểm trước mọi lỗi khác.
 */
export async function createRule(db: D1Database, input: RuleInput, actorId: string | null): Promise<Record<string, unknown>> {
  const accountId = input.account_id ?? null;
  const counterId = input.counter_account_id ?? null;
  if (accountId || counterId) assertRowWritable({ account_id: accountId, counter_account_id: counterId }, await hiddenAccountIds(db, actorId));
  if (!(MATCH_TYPES as readonly string[]).includes(input.match_type)) fail("invalid_match_type", `match_type phải là một trong: ${MATCH_TYPES.join(", ")}.`);
  if (!input.pattern?.trim()) fail("missing_pattern", "Cần có pattern.");
  if (!(RULE_MEANINGS as readonly string[]).includes(input.meaning)) fail("invalid_meaning", `meaning phải là một trong: ${RULE_MEANINGS.join(", ")}.`);
  const tenantId = input.tenant_id ?? null;
  // Luật 6: máy chỉ được đoán spend/transfer; income chỉ khi khớp mẫu lương — hoặc rule người thuê. Rule người thuê
  // lưu is_salary = 1 (DB đòi mọi rule income có cờ này) nhưng matchLog bỏ qua nó: chỉ gợi ý ở màn Gán (ADR-60).
  const isSalary = input.is_salary === true || tenantId !== null;
  if (input.meaning === "income" && !isSalary) fail("income_needs_salary", "Rule income chỉ được tạo khi is_salary = true.");
  if (tenantId) {
    if (input.meaning !== "income") fail("tenant_rule_income_only", "Rule người thuê chỉ dùng cho tiền vào (income).");
    if (!(await db.prepare("SELECT 1 FROM tenants WHERE id = ?").bind(tenantId).first())) fail("unknown_tenant", `Không có người thuê "${tenantId}".`);
  }
  const streamId = input.income_stream_id ?? null;
  if (streamId && !(await db.prepare("SELECT 1 FROM income_streams WHERE id = ?").bind(streamId).first())) fail("unknown_income_stream", `Không có nguồn thu "${streamId}".`);
  if (streamId && input.meaning !== "income") fail("income_only", "Nguồn thu chỉ gắn được với rule thu nhập.");
  for (const id of [accountId, counterId]) {
    if (id && !(await db.prepare("SELECT 1 FROM accounts WHERE id = ?").bind(id).first())) fail("unknown_account", `Không có tài khoản "${id}".`);
  }
  if (counterId && input.meaning !== "transfer") fail("transfer_only", "Tài khoản đầu kia chỉ gắn được với rule chuyển nội bộ.");
  const res = await db
    .prepare(
      `INSERT INTO rules (priority, match_type, pattern, meaning, is_salary, category_id, by_member_id, tenant_id, income_stream_id, account_id, counter_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.priority ?? 100,
      input.match_type,
      input.pattern.trim(),
      input.meaning,
      isSalary ? 1 : 0,
      input.category_id ?? null,
      input.by_member_id ?? null,
      tenantId,
      streamId,
      accountId,
      counterId,
    )
    .run();
  return (await db.prepare("SELECT * FROM rules WHERE id = ?").bind(res.meta.last_row_id).first<Row>())!;
}

/** "Luôn coi mã/nội dung này là ..." — sinh từ một lần gán tay, chỉ cho spend/transfer (luật 6); cùng luật riêng tư với `createRule`. */
export async function createRuleFromSplit(db: D1Database, split: Split, matchType: string, pattern: string, memberId: string | null): Promise<Record<string, unknown>> {
  if (split.meaning !== "spend" && split.meaning !== "transfer") {
    fail("rule_meaning_restricted", "Chỉ tạo được rule tự động cho spend hoặc transfer.");
  }
  return createRule(
    db,
    {
      match_type: matchType,
      pattern,
      meaning: split.meaning,
      category_id: split.category_id ?? null,
      by_member_id: memberId,
    },
    memberId,
  );
}

/**
 * Giao dịch ngân hàng không đọc được (payload hỏng) — lỗi vĩnh viễn, gửi lại không giúp gì. Ghi lại một dòng
 * (không kèm số tài khoản hay nội dung) để tin sáng báo cho người trong nhà thay vì mất lặng lẽ.
 */
export async function recordIngestError(db: D1Database, source: "webhook" | "backfill", ref: string, message: string, now: Date): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload, ok) VALUES ('ingest_error', ?, ?, ?, 1)")
    .bind(`${dayKey(now)}:${source}:${ref.slice(0, 64)}`, "system", JSON.stringify({ source, message: message.slice(0, 200) }))
    .run();
}
