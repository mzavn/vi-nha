// Bank feed SePay → bank_logs (bất biến) → transactions. Phase 04.
// Chữ ký các hàm dưới đây là hợp đồng dùng chung với MCP (phase 06) — giữ nguyên tên và tham số.

import { assertOpened, buildEntry, wealthBuildingMove, type EntryInput } from "../domain/entry";
import { dayKey, minuteOfDay, monthKey, weekKey } from "../domain/period";
import { canPair, extractCode, extractTransferMemo, looksLikeCashWithdrawal, matchRule, type PairCandidate, type RuleRow } from "../domain/rules";
import { DomainError } from "../domain/types";
import { allocateIncome, getTransaction, loadRefs, resolveLink, runUndo, salaryMinAmount, undoAllocationStatements } from "./ledger";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];

export type SplitMeaning = "spend" | "transfer" | "income" | "refund" | "lend" | "collect" | "buy_asset";

export interface Split {
  meaning: SplitMeaning;
  amount: number;
  wallet_id?: string | null;
  category_id?: string | null;
  /** transfer: tài khoản đầu kia của giao dịch (ví dụ Tiền mặt khi rút ATM). */
  other_account_id?: string | null;
  /** transfer: ví nguồn khi chuyển cả ví (wallet_id là ví đích), ví dụ "Thu cho thuê" → Tích sản. */
  from_wallet_id?: string | null;
  /** income: nguồn thu (chia theo phần khóa của nguồn); bỏ trống mà có tenant_id thì lấy nguồn cho thuê. */
  income_stream_id?: string | null;
  /** income: tiền người thuê trả (giảm số dư sổ người thuê). */
  tenant_id?: string | null;
  /** spend: khoản trả nợ (giảm số còn nợ ở sổ nợ). */
  debt_id?: string | null;
  /** lend: cho vay thêm · collect: tiền cho vay trả về (không phải thu nhập, không chia) — ở sổ phải thu. */
  receivable_id?: string | null;
  /** refund: khoản chi gốc được trả lại · collect: khoản cho vay gốc được trả — kiểm ở `resolveLink` (ledger UC-101 bước 4b). */
  link_id?: number | null;
  taxable?: boolean;
  asset_kind?: string | null;
  note?: string | null;
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
    fail("invalid_payload", `Thời điểm giao dịch không hợp lệ: "${vnDateTime}".`);
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

// ── Ghi transaction sinh ra từ log (khác insertTx của ledger.ts: cần thêm log_id/log_id_2) ──

interface LogTxInput {
  at: string;
  amount: number;
  meaning: "spend" | "income" | "transfer";
  walletId: string | null;
  counterWalletId: string | null;
  accountId: string | null;
  counterAccountId: string | null;
  categoryId: string | null;
  byMemberId: string | null;
  batchId: string | null;
  note: string | null;
  /** income: nguồn thu (rule lương mang theo). */
  incomeStreamId?: string | null;
}

function logTxStmt(db: D1Database, row: LogTxInput, logId: string, logId2: string | null): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO transactions
         (log_id, log_id_2, at, amount, meaning, wallet_id, counter_wallet_id, account_id, counter_account_id,
          category_id, by_member_id, link_id, batch_id, asset_kind, taxable, week_key, month_key, source, note, income_stream_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?, ?, 'sepay', ?, ?)`,
    )
    .bind(
      logId,
      logId2,
      row.at,
      row.amount,
      row.meaning,
      row.walletId,
      row.counterWalletId,
      row.accountId,
      row.counterAccountId,
      row.categoryId,
      row.byMemberId,
      row.batchId,
      weekKey(row.at),
      monthKey(row.at),
      row.note,
      row.incomeStreamId ?? null,
    );
}

/** Đổi các log sang 'assigned' — luôn đi cùng batch với giao dịch sinh ra từ chúng. */
const markAssigned = (db: D1Database, ...ids: string[]) =>
  db.prepare(`UPDATE bank_logs SET status = 'assigned' WHERE status = 'pending' AND id IN (${ids.map(() => "?").join(", ")})`).bind(...ids);

/**
 * Ghi nguyên tử. Trigger ở DB (migration 0005) huỷ cả batch khi log không còn 'pending' hoặc lệnh chuyển tiền
 * đã hoàn tất — tức là một request khác vừa xử lý xong đúng giao dịch này. Khi đó trả false: không ghi lần hai.
 */
async function commit(db: D1Database, statements: D1PreparedStatement[]): Promise<boolean> {
  try {
    await db.batch(statements);
    return true;
  } catch (err) {
    if (/log_not_pending|order_not_pending/.test(String(err))) return false;
    throw err;
  }
}

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
 * dụng (`accountId`, null = mọi tài khoản), tài khoản đầu kia + ví nguồn của rule chuyển nội bộ (bỏ heo đất).
 */
type LoadedRule = RuleRow & {
  incomeStreamId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  accountId: string | null;
  counterAccountId: string | null;
  counterAccountName: string | null;
  counterOpenedAt: string | null;
  fromWalletId: string | null;
};

async function loadRuleRows(db: D1Database): Promise<LoadedRule[]> {
  const res = await db
    .prepare(
      `SELECT r.id, r.priority, r.match_type AS matchType, r.pattern, r.meaning, r.is_salary AS isSalary,
              r.wallet_id AS walletId, r.category_id AS categoryId, r.by_member_id AS byMemberId,
              r.income_stream_id AS incomeStreamId, r.tenant_id AS tenantId, t.name AS tenantName,
              r.account_id AS accountId, r.counter_account_id AS counterAccountId, c.name AS counterAccountName,
              c.opened_at AS counterOpenedAt, r.from_wallet_id AS fromWalletId
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
 * Luồng khớp log (phase-04 "Luồng"): PF memo → ghép cặp nội bộ → gắn làm chân thứ hai của chuyển nội bộ đã ghi
 * (ADR-81) → rule mã/từ khoá (spend/transfer) hoặc rule lương (income) → còn lại giữ 'pending'. Dùng chung cho
 * webhook lẫn backfill (cùng rule, cùng ghép cặp).
 */
async function matchLog(db: D1Database, log: LogCtx): Promise<void> {
  // 1. Nội dung chứa mã 'PF XXXXXX' → khớp đúng lệnh chuyển tiền do chính app sinh ra (mã riêng từng lệnh).
  const memo = extractTransferMemo(log.content);
  if (memo) {
    const order = await db
      .prepare("SELECT * FROM transfer_orders WHERE memo = ? AND amount = ? AND (from_account_id = ? OR to_account_id = ?)")
      .bind(memo, log.amount, log.accountId, log.accountId)
      .first<Row>();
    if (order) {
      const expectedDirection = order.from_account_id === log.accountId ? "out" : "in";
      if (log.direction === expectedDirection) {
        if (order.status === "pending") {
          // Chân kia của đúng lệnh này có thể đang nằm chờ (nó về trước rồi bị gỡ gán, hoặc về trước khi lệnh
          // được khớp): ghép luôn cả hai vào một giao dịch, không để nó mồ côi rồi bị gợi ý gán lần nữa.
          const otherAccount = log.accountId === order.from_account_id ? (order.to_account_id as string) : (order.from_account_id as string);
          const others = rows<{ id: string; content: string | null }>(
            await db
              .prepare("SELECT id, content FROM bank_logs WHERE status = 'pending' AND id <> ? AND account_id = ? AND amount = ? AND direction <> ?")
              .bind(log.id, otherAccount, log.amount, log.direction)
              .all(),
          );
          const otherLeg = others.find((o) => extractTransferMemo(o.content) === memo)?.id ?? null;
          const [outLeg, inLeg] = log.direction === "out" ? [log.id, otherLeg] : [otherLeg ?? log.id, otherLeg ? log.id : null];
          await commit(db, [
            // Đặt đầu batch: lệnh đã hoàn tất ở request khác thì trigger huỷ luôn phần ghi giao dịch phía sau.
            db.prepare("UPDATE transfer_orders SET status = 'done', matched_log_id = ? WHERE id = ?").bind(log.id, order.id),
            logTxStmt(
              db,
            {
              at: log.at,
              amount: log.amount,
              meaning: "transfer",
              walletId: null,
              counterWalletId: null,
              accountId: order.from_account_id as string,
              counterAccountId: order.to_account_id as string,
              categoryId: null,
              byMemberId: null,
              batchId: order.batch_id as string,
              note: null,
            },
            outLeg,
            inLeg,
            ),
            markAssigned(db, ...[log.id, otherLeg].filter((x): x is string => x !== null)),
          ]);
          return;
        }
        if (order.status === "done" && order.matched_log_id !== log.id) {
          // Chân thứ hai của lệnh đã khớp trước đó bằng chân kia — gắn thêm vào đúng giao dịch của lệnh này
          // (một lần chia có thể sinh nhiều lệnh cùng batch_id, nên tìm theo log đã khớp chứ không theo batch).
          const tx = await db
            .prepare("SELECT id FROM transactions WHERE log_id = ? AND meaning = 'transfer' AND status = 'active' AND log_id_2 IS NULL LIMIT 1")
            .bind(order.matched_log_id)
            .first<{ id: number }>();
          if (tx) {
            await commit(db, [
              db.prepare("UPDATE transactions SET log_id_2 = ? WHERE id = ? AND log_id_2 IS NULL").bind(log.id, tx.id),
              markAssigned(db, log.id),
            ]);
            return;
          }
        }
      }
    }
  }

  // 2+3. Ghép cặp nội bộ: log ngược hướng, cùng số tiền, khác TK của hộ, lệch ≤ 10 phút, chưa gán — và không trước
  // ngày mở sổ của tài khoản nó (ADR-76; log như vậy nhận trước khi có luật này có thể còn 'pending').
  const candidates = await db
    .prepare(
      `SELECT l.id, l.at, l.account_id AS accountId, l.direction, l.amount FROM bank_logs l JOIN accounts a ON a.id = l.account_id
       WHERE l.status = 'pending' AND l.account_id <> ? AND l.amount = ? AND l.direction <> ? AND l.id <> ?
         AND (a.opened_at IS NULL OR date(l.at, '+7 hours') >= a.opened_at)`,
    )
    .bind(log.accountId, log.amount, log.direction, log.id)
    .all<PairCandidate>();
  const self: PairCandidate = { id: log.id, accountId: log.accountId, direction: log.direction, amount: log.amount, at: log.at };
  const match = rows<PairCandidate>(candidates).find((c) => canPair(self, c));
  if (match) {
    const outLeg = log.direction === "out" ? self : match;
    const inLeg = log.direction === "in" ? self : match;
    // Ghép cặp vào tài khoản Tích sản từ tài khoản thường là bỏ tiền vào Tích sản (ADR-88).
    const move = wealthBuildingMove(await loadRefs(db), outLeg.accountId, inLeg.accountId);
    await commit(db, [
      logTxStmt(
      db,
      {
        at: log.at,
        amount: log.amount,
        meaning: "transfer",
        walletId: move?.wallet_id ?? null,
        counterWalletId: move?.from_wallet_id ?? null,
        accountId: outLeg.accountId,
        counterAccountId: inLeg.accountId,
        categoryId: null,
        byMemberId: null,
        batchId: null,
        note: "Tự ghép cặp chuyển khoản nội bộ",
      },
      outLeg.id,
      inLeg.id,
      ),
      markAssigned(db, log.id, match.id),
    ]);
    return;
  }

  // 2b. Chân còn lại của chuyển nội bộ đã ghi từ một chân (ADR-81): chân kia đã được gán (tay hoặc rule) trước khi
  // log này về — không còn log 'pending' nào để ghép cặp — nên gắn vào giao dịch đó thay vì ghi lần hai.
  const single = await findSingleLegTransfer(db, self);
  if (single && (await attachSecondLeg(db, single.txId, log.id))) return;

  // 4+5. Rule mã CK / từ khoá (chi ra) hoặc rule lương (tiền vào, is_salary=1).
  // Rule người thuê chỉ để gợi ý ở màn Gán (ADR-60), không bao giờ tự gán.
  // Tiền ra của tài khoản đang để "chỉ tiền vào" (sepay_out = 0) được nhập tay ở màn Nhập (ADR-66): log này có thể
  // là đúng khoản đã nhập, nên không tự gán theo rule — giữ 'pending' để người xem (gợi ý kèm lời nhắc ở màn Gán).
  if (log.direction === "out" && (await outNotFed(db, log.accountId))) return;
  const rule = matchRule(
    (await loadRuleRows(db)).filter((r) => !r.tenantId && (!r.accountId || r.accountId === log.accountId)),
    log.direction,
    log.content,
    log.refCode,
  ) as LoadedRule | null;
  // Mẫu lương chỉ dựa vào nội dung chuyển khoản — ai biết số tài khoản cũng gõ được. Khoản nhỏ hơn ngưỡng thì
  // không tự ghi thu nhập, không tự chia: để 'pending' cho người trong nhà xác nhận (luật 6: tiền vào phải hỏi).
  if (rule?.meaning === "income" && log.amount >= (await salaryMinAmount(db))) {
    const written = await commit(db, [
      logTxStmt(
      db,
      {
        at: log.at,
        amount: log.amount,
        meaning: "income",
        walletId: rule.walletId,
        incomeStreamId: rule.incomeStreamId,
        counterWalletId: null,
        accountId: null,
        counterAccountId: log.accountId,
        categoryId: null,
        byMemberId: rule.byMemberId,
        batchId: null,
        note: null,
      },
      log.id,
      null,
      ),
      markAssigned(db, log.id),
    ]);
    if (!written) return;
    const income = await db.prepare("SELECT id FROM transactions WHERE log_id = ? AND meaning = 'income' AND status = 'active'").bind(log.id).first<{ id: number }>();
    // D2: chia ngay. allocation_runs chặn chia hai lần nếu request khác cũng đang chia đúng khoản này.
    if (income) await allocateIncome(db, income.id).catch((err) => {
      if (!(err instanceof DomainError && err.code === "already_allocated")) throw err;
    });
    return;
  }
  if (rule?.meaning === "spend" && rule.categoryId) {
    await commit(db, [
      logTxStmt(
      db,
      {
        at: log.at,
        amount: log.amount,
        meaning: "spend",
        walletId: null,
        counterWalletId: rule.walletId,
        accountId: log.accountId,
        counterAccountId: null,
        categoryId: rule.categoryId,
        byMemberId: rule.byMemberId,
        batchId: null,
        note: null,
      },
      log.id,
      null,
      ),
      markAssigned(db, log.id),
    ]);
    return;
  }
  if (rule?.meaning === "transfer") {
    // Rule có tài khoản đầu kia (bỏ heo đất, ADR-77) chuyển đúng tới đó, kèm chuyển ví; không có thì là rút tiền mặt.
    // Ngày log trước ngày mở sổ của đầu kia thì để người gán (ADR-76: số dư đầu đã gồm khoản đó).
    if (rule.counterAccountId && rule.counterOpenedAt && dayKey(log.at) < rule.counterOpenedAt) return;
    const counter = rule.counterAccountId ?? (await cashAccountFor(db, rule.byMemberId, log.accountId));
    // Rule không mang ví mà đầu kia là tài khoản Tích sản (phao, sổ tiết kiệm): như nhập tay (ADR-88).
    const move =
      rule.counterAccountId && rule.walletId && rule.fromWalletId
        ? { wallet_id: rule.walletId, from_wallet_id: rule.fromWalletId }
        : counter
          ? wealthBuildingMove(await loadRefs(db), log.accountId, counter)
          : null;
    if (counter) {
      await commit(db, [
        logTxStmt(
        db,
        {
          at: log.at,
          amount: log.amount,
          meaning: "transfer",
          walletId: move?.wallet_id ?? null,
          counterWalletId: move?.from_wallet_id ?? null,
          accountId: log.accountId,
          counterAccountId: counter,
          categoryId: null,
          byMemberId: rule.byMemberId,
          batchId: null,
          note: null,
        },
        log.id,
        null,
        ),
        markAssigned(db, log.id),
      ]);
      return;
    }
  }
  // 6. Còn lại: giữ 'pending' (giá trị mặc định lúc insert), không làm gì thêm — lượt cron kế tiếp (≤ 15 phút) sẽ báo.
}

/** Tài khoản mà SePay không được coi là báo tiền ra (không nối, hoặc sepay_out = 0): tiền ra của nó nhập tay được (ADR-66). */
async function outNotFed(db: D1Database, accountId: string): Promise<boolean> {
  const row = await db.prepare("SELECT sepay_enabled AND sepay_out AS fed FROM accounts WHERE id = ?").bind(accountId).first<{ fed: number }>();
  return !!row && !row.fed;
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
 * không báo, không ghép cặp — `beforeOpening: true`.
 */
export async function ingestLog(
  db: D1Database,
  parsed: ParsedBankLog,
  source: "webhook" | "backfill",
  now: Date,
  connectionId?: string,
): Promise<{ created: boolean; logId: string; beforeOpening?: boolean }> {
  const byId = await db.prepare("SELECT id FROM bank_logs WHERE id = ?").bind(parsed.id).first<{ id: string }>();
  if (byId) return { created: false, logId: parsed.id };

  // Tài khoản ảo (VA) của SePay mang subAccount riêng: khớp nó trước, rồi mới tới số tài khoản chính.
  const scope = connectionId === undefined ? "" : " AND sepay_connection_id = ?";
  const lookup = (col: "sub_account" | "account_no", value: string) => {
    const st = db.prepare(`SELECT id, opened_at FROM accounts WHERE ${col} = ?${scope}`);
    return (connectionId === undefined ? st.bind(value) : st.bind(value, connectionId)).first<{ id: string; opened_at: string | null }>();
  };
  const account =
    (parsed.subAccount ? await lookup("sub_account", parsed.subAccount) : null) ?? (parsed.accountNo ? await lookup("account_no", parsed.accountNo) : null);
  const accountId = account?.id ?? null;
  const beforeOpening = !!account?.opened_at && dayKey(parsed.at) < account.opened_at;

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
  if (beforeOpening) return { created: true, logId: parsed.id, beforeOpening: true };

  if (accountId && !twin) {
    try {
      await matchLog(db, { id: parsed.id, at: parsed.at, amount: parsed.amount, direction: parsed.direction, accountId, content: parsed.content, refCode: parsed.refCode });
    } catch (err) {
      // Log đã được ghi: gửi lại không chạy lại bước khớp (ingestLog dừng sớm khi log đã có), nên lỗi ở đây —
      // ví dụ lương đã ghi nhưng chia lỗi — phải được ghi lại để tin sáng báo, không được im lặng.
      await recordIngestError(db, source, parsed.id, `Đã ghi giao dịch nhưng xử lý tiếp bị lỗi: ${err instanceof Error ? err.message : "unknown"}`, now);
    }
  }
  return { created: true, logId: parsed.id };
}

// ── Đọc log chưa gán, kèm gợi ý ───────────────────────────────────────

export async function listPendingLogs(db: D1Database, limit: number): Promise<Record<string, unknown>[]> {
  const res = await db
    .prepare(
      `SELECT l.*, a.name AS account_name FROM bank_logs l LEFT JOIN accounts a ON a.id = l.account_id
       WHERE l.status = 'pending' ORDER BY l.at DESC LIMIT ?`,
    )
    .bind(Math.min(Math.max(limit, 1), 200))
    .all<Row>();
  const list = rows(res);
  const ruleRows = await loadRuleRows(db);
  const sepayOut = new Map(
    rows<{ id: string; fed: number }>(await db.prepare("SELECT id, sepay_enabled AND sepay_out AS fed FROM accounts").all()).map((a) => [a.id, Boolean(a.fed)]),
  );
  // Tài khoản tiền mặt để gợi ý "Rút tiền mặt" chỉ phụ thuộc tài khoản nguồn: hỏi DB một lần cho mỗi tài khoản.
  const cashCache = new Map<string, Promise<string | null>>();
  const cashOf = (accountId: string) => {
    if (!cashCache.has(accountId)) cashCache.set(accountId, cashAccountFor(db, null, accountId));
    return cashCache.get(accountId)!;
  };
  return Promise.all(
    list.map(async (log) => {
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
      if (leg) {
        const minute = minuteOfDay(leg.at);
        const hhmm = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        return { ...log, suggestion: { meaning: "transfer", other_account_id: leg.accountId, attach_to_tx: leg.txId, label: `Khớp chuyển nội bộ đã ghi lúc ${hhmm}` } };
      }
      return { ...log, suggestion: await suggestFor(log, ruleRows, cashOf, sepayOut.get(log.account_id as string) === false) };
    }),
  );
}

const OUT_NOT_FED_NOTE =
  "SePay vừa báo tiền ra cho tài khoản đang để 'chỉ tiền vào'. Nếu khoản này đã nhập tay thì Bỏ qua; rồi bật 'SePay báo cả tiền ra' ở Cài đặt.";
const PIGGY_BANK_RETURN_NOTE = "Chỉ đổi chỗ tiền; tiền vẫn thuộc Tích sản cho tới khi anh tự chuyển ví.";

/**
 * Gợi ý cho màn Gán: rule khớp mã nhưng thiếu danh mục → gợi ý ví; log `out` không khớp rule mà nội dung trông như
 * rút tiền mặt (`looksLikeCashWithdrawal` — ATM, RUT TIEN…) → gợi ý Rút tiền mặt; không khớp gì khác → không gợi ý
 * (trả QR, hoá đơn không phải rút tiền — màn Gán mặc định Chi tiêu);
 * log `in` khớp rule người thuê → gợi ý "Thu từ <tên>". Log `out` của tài khoản "chỉ tiền vào" (`outNotFed`, ADR-66)
 * không được tự gán, nên gợi ý luôn theo rule khớp và kèm lời nhắc có thể đã nhập tay. Rule chuyển nội bộ có tài khoản
 * đầu kia (heo đất, ADR-77/ADR-82): tiền ra gợi ý chuyển sang đó kèm chuyển ví vào Tích sản; tiền vào khớp cùng rule là
 * heo trả về — gợi ý chuyển tài khoản chiều ngược lại, không chuyển ví (tiền vẫn thuộc Tích sản), không bao giờ tự gán.
 */
async function suggestFor(
  log: Row,
  allRules: LoadedRule[],
  cashOf: (accountId: string) => Promise<string | null>,
  outNotFed: boolean,
): Promise<Record<string, unknown> | null> {
  if (!log.account_id) return null;
  const rules = allRules.filter((r) => !r.accountId || r.accountId === log.account_id);
  if (log.direction === "in") {
    // Tiền vào luôn hỏi; chỉ gợi ý người thuê khi khớp rule của họ, người vẫn phải bấm xác nhận.
    const tenantRules = rules.filter((r) => r.tenantId).map((r) => ({ ...r, meaning: "income" as const, isSalary: true }));
    const hit = matchRule(tenantRules, "in", log.content as string | null, log.ref_code as string | null) as LoadedRule | null;
    if (hit) return { meaning: "income", tenant_id: hit.tenantId, label: `Thu từ ${hit.tenantName ?? hit.tenantId}` };
    const backRules = rules.filter((r) => r.meaning === "transfer" && r.counterAccountId).map((r) => ({ ...r, meaning: "income" as const, isSalary: true }));
    const back = matchRule(backRules, "in", log.content as string | null, log.ref_code as string | null) as LoadedRule | null;
    if (!back) return null;
    return { meaning: "transfer", other_account_id: back.counterAccountId, label: `Rút heo về ${log.account_name ?? log.account_id}`, note: PIGGY_BANK_RETURN_NOTE };
  }
  const rule = matchRule(rules, "out", log.content as string | null, log.ref_code as string | null) as LoadedRule | null;
  let base: Record<string, unknown> | null = null;
  if (rule?.meaning === "spend" && !rule.categoryId) {
    base = { meaning: "spend", wallet_id: rule.walletId, note: "Khớp mã nhưng thiếu danh mục — chọn danh mục để lưu." };
  } else if (rule?.meaning === "spend" && outNotFed) {
    base = { meaning: "spend", wallet_id: rule.walletId, category_id: rule.categoryId };
  } else if (rule?.meaning === "transfer" && rule.counterAccountId && outNotFed) {
    const move = rule.walletId && rule.fromWalletId ? { from_wallet_id: rule.fromWalletId, wallet_id: rule.walletId } : {};
    base = { meaning: "transfer", other_account_id: rule.counterAccountId, ...move, label: `Chuyển sang ${rule.counterAccountName ?? rule.counterAccountId}` };
  } else if ((!rule && looksLikeCashWithdrawal(log.content as string | null)) || (rule?.meaning === "transfer" && outNotFed)) {
    const cash = await cashOf(log.account_id as string);
    if (cash) base = { meaning: "transfer", other_account_id: cash, label: "Rút tiền mặt" };
  }
  if (!outNotFed) return base;
  return { ...base, note: base?.note ? `${OUT_NOT_FED_NOTE} ${base.note as string}` : OUT_NOT_FED_NOTE };
}

// ── Gán / bỏ qua / ghép tay ───────────────────────────────────────────

function splitToEntryInput(log: Row, split: Split): EntryInput {
  const base = {
    meaning: split.meaning as EntryInput["meaning"],
    amount: split.amount,
    at: String(log.at),
    category_id: split.category_id ?? undefined,
    wallet_id: split.wallet_id ?? undefined,
    note: split.note ?? undefined,
    taxable: split.taxable,
    asset_kind: split.asset_kind ?? undefined,
    from_wallet_id: split.from_wallet_id ?? undefined,
    income_stream_id: split.income_stream_id ?? undefined,
    tenant_id: split.tenant_id ?? undefined,
    debt_id: split.debt_id ?? undefined,
    receivable_id: split.receivable_id ?? undefined,
    link_id: split.link_id ?? undefined,
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

/**
 * Gán một log thành 1..N giao dịch; tổng các split phải bằng đúng số tiền log. Gán đúng một dòng chuyển nội bộ trọn số
 * tiền mà log là chân còn lại của chuyển nội bộ đã ghi sang đúng tài khoản đó (ADR-81) → gắn vào giao dịch ấy
 * (`attached: true`, không ghi thêm; ví của giao dịch đã ghi giữ nguyên).
 */
export async function assignLog(
  db: D1Database,
  logId: string,
  splits: Split[],
  memberId: string | null,
  now: Date,
): Promise<{ log: Record<string, unknown>; transactions: Record<string, unknown>[]; attached: boolean }> {
  if (!Array.isArray(splits) || splits.length === 0) return fail("missing_splits", "Cần ít nhất một dòng gán.");
  const log = await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>();
  if (!log) return fail("not_found", "Không có log này.");
  if (log.status !== "pending") throw new DomainError("not_pending", "Log này đã được xử lý.", 409);

  const total = splits.reduce((sum, s) => sum + (Number.isFinite(s.amount) ? s.amount : 0), 0);
  if (total !== Number(log.amount)) {
    fail("split_mismatch", `Tổng các dòng (${total}) phải bằng đúng số tiền log (${log.amount}).`);
  }

  const only = splits.length === 1 ? splits[0]! : null;
  if (only?.meaning === "transfer" && only.other_account_id && log.account_id) {
    const leg = await findSingleLegTransfer(
      db,
      { id: logId, accountId: log.account_id as string, direction: log.direction as "in" | "out", amount: Number(log.amount), at: String(log.at) },
      only.other_account_id,
    );
    if (leg && (await attachSecondLeg(db, leg.txId, logId))) {
      const updated = (await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>())!;
      const tx = (await db.prepare("SELECT * FROM transactions WHERE id = ?").bind(leg.txId).first<Row>())!;
      return { log: updated, transactions: [tx], attached: true };
    }
  }

  const refs = await loadRefs(db);
  const built = splits.map((s) => {
    const row = buildEntry(splitToEntryInput(log, s), refs, memberId, now);
    return { ...row, source: "sepay" as const };
  });
  for (const row of built) await resolveLink(db, row);

  const statements = [
    ...built.map((row) =>
      db
        .prepare(
          `INSERT INTO transactions
             (log_id, at, amount, meaning, wallet_id, counter_wallet_id, account_id, counter_account_id, category_id,
              by_member_id, link_id, batch_id, asset_kind, taxable, week_key, month_key, source, note, client_id, income_stream_id, tenant_id,
              debt_id, receivable_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          logId,
          row.at,
          row.amount,
          row.meaning,
          row.wallet_id,
          row.counter_wallet_id,
          row.account_id,
          row.counter_account_id,
          row.category_id,
          row.by_member_id,
          row.link_id,
          row.batch_id,
          row.asset_kind,
          row.taxable,
          row.week_key,
          row.month_key,
          row.source,
          row.note,
          row.client_id,
          row.income_stream_id ?? null,
          row.tenant_id ?? null,
          row.debt_id ?? null,
          row.receivable_id ?? null,
        ),
    ),
    markAssigned(db, logId),
  ];
  if (!(await commit(db, statements))) throw new DomainError("not_pending", "Log này vừa được xử lý ở nơi khác.", 409);

  const updatedLog = (await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>())!;
  const created = await db.prepare("SELECT * FROM transactions WHERE log_id = ? ORDER BY id DESC LIMIT ?").bind(logId, splits.length).all<Row>();
  return { log: updatedLog, transactions: rows(created), attached: false };
}

/** Đánh dấu log là không cần ghi sổ (ví dụ giao dịch thử). */
export async function ignoreLog(db: D1Database, logId: string): Promise<Record<string, unknown>> {
  const res = await db.prepare("UPDATE bank_logs SET status = 'ignored' WHERE id = ? AND status = 'pending'").bind(logId).run();
  if (!res.meta.changes) {
    const existing = await db.prepare("SELECT id FROM bank_logs WHERE id = ?").bind(logId).first();
    throw new DomainError(existing ? "not_pending" : "not_found", existing ? "Log này đã được xử lý." : "Không có log này.", existing ? 409 : 404);
  }
  return (await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logId).first<Row>())!;
}

/** Gộp tay 2 log thành 1 transfer khi thuật toán ghép cặp tự động bỏ sót. */
export async function pairLogs(db: D1Database, logAId: string, logBId: string): Promise<{ transactionId: number }> {
  if (logAId === logBId) return fail("same_log", "Hai log phải khác nhau.");
  const a = await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logAId).first<Row>();
  const b = await db.prepare("SELECT * FROM bank_logs WHERE id = ?").bind(logBId).first<Row>();
  if (!a || !b) return fail("not_found", "Không có log này.");
  if (a.status !== "pending" || b.status !== "pending") throw new DomainError("not_pending", "Cả hai log phải đang chờ gán.", 409);
  if (!a.account_id || !b.account_id) return fail("unknown_account", "Cả hai log phải thuộc tài khoản đã biết.");
  if (a.account_id === b.account_id) return fail("same_account", "Hai log phải thuộc hai tài khoản khác nhau.");
  if (a.direction === b.direction) return fail("same_direction", "Hai log phải ngược hướng nhau.");
  if (Number(a.amount) !== Number(b.amount)) return fail("amount_mismatch", "Hai log phải cùng số tiền để ghép thành một khoản chuyển.");
  // Số dư đầu là mốc (ADR-76): khoản ghép chạm cả hai tài khoản, nên không được sớm hơn ngày mở sổ của tài khoản nào.
  const opened = rows<{ id: string; name: string; openedAt: string | null }>(
    await db.prepare("SELECT id, name, opened_at AS openedAt FROM accounts WHERE id IN (?, ?)").bind(a.account_id, b.account_id).all(),
  );
  const earliest = String(a.at) < String(b.at) ? String(a.at) : String(b.at);
  for (const account of opened) assertOpened(account, earliest);

  const outLog = a.direction === "out" ? a : b;
  const inLog = a.direction === "out" ? b : a;
  const move = wealthBuildingMove(await loadRefs(db), outLog.account_id as string, inLog.account_id as string);
  const written = await commit(db, [
    logTxStmt(
    db,
    {
      at: String(outLog.at),
      amount: Number(outLog.amount),
      meaning: "transfer",
      walletId: move?.wallet_id ?? null,
      counterWalletId: move?.from_wallet_id ?? null,
      accountId: outLog.account_id as string,
      counterAccountId: inLog.account_id as string,
      categoryId: null,
      byMemberId: null,
      batchId: null,
      note: "Ghép cặp tay",
    },
    outLog.id as string,
    inLog.id as string,
    ),
    markAssigned(db, a.id as string, b.id as string),
  ]);
  if (!written) throw new DomainError("not_pending", "Một trong hai log vừa được xử lý ở nơi khác.", 409);
  const tx = await db.prepare("SELECT id FROM transactions WHERE log_id = ? AND log_id_2 = ? AND status = 'active'").bind(outLog.id, inLog.id).first<{ id: number }>();
  return { transactionId: tx!.id };
}

/**
 * Gỡ cặp/gỡ gán sai: huỷ MỌI giao dịch còn hiệu lực sinh ra từ (các) log đó — một log có thể đã được tách
 * thành nhiều dòng — trả lệnh chuyển tiền đã khớp về 'pending', rồi đưa log về 'pending'. Tất cả trong một batch:
 * gỡ nửa chừng mà log đã về 'pending' thì lần gán sau sẽ đếm tiền hai lần.
 */
export async function unassignTransaction(db: D1Database, txId: number): Promise<{ voided: number[]; logs: string[] }> {
  const tx = await getTransaction(db, txId);
  if (!tx) return fail("not_found", "Không có giao dịch này.");
  if (!tx.log_id) return fail("not_from_log", "Giao dịch này không sinh ra từ log ngân hàng.");
  if (tx.status !== "active") throw new DomainError("already_void", "Giao dịch đã huỷ trước đó.", 409);

  const logIds = [tx.log_id, tx.log_id_2].filter((x): x is string => typeof x === "string" && x.length > 0);
  const marks = logIds.map(() => "?").join(", ");
  const siblings = rows<{ id: number; meaning: string }>(
    await db
      .prepare(`SELECT id, meaning FROM transactions WHERE status = 'active' AND (log_id IN (${marks}) OR log_id_2 IN (${marks}))`)
      .bind(...logIds, ...logIds)
      .all(),
  );
  // Khoản thu đã được chia thì gỡ luôn lần chia (không được nếu tiền đã chuyển thật theo lần chia đó).
  const undo = (await Promise.all(siblings.filter((t) => t.meaning === "income").map((t) => undoAllocationStatements(db, t.id)))).flat();
  const ids = siblings.map((t) => t.id);
  await runUndo(db, [
    ...undo,
    db.prepare(`UPDATE transactions SET status = 'void' WHERE status = 'active' AND id IN (${ids.map(() => "?").join(", ")})`).bind(...ids),
    db.prepare(`UPDATE transfer_orders SET status = 'pending', matched_log_id = NULL WHERE matched_log_id IN (${marks})`).bind(...logIds),
    db.prepare(`UPDATE bank_logs SET status = 'pending' WHERE status = 'assigned' AND id IN (${marks})`).bind(...logIds),
  ]);
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
  wallet_id?: string | null;
  category_id?: string | null;
  by_member_id?: string | null;
  /** Rule income của người thuê: chỉ gợi ý "Thu từ <tên>" ở màn Gán, không tự gán. */
  tenant_id?: string | null;
  /** Rule lương: nguồn thu gắn vào khoản income tự ghi. */
  income_stream_id?: string | null;
}

export async function createRule(db: D1Database, input: RuleInput): Promise<Record<string, unknown>> {
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
  const res = await db
    .prepare(
      `INSERT INTO rules (priority, match_type, pattern, meaning, is_salary, wallet_id, category_id, by_member_id, tenant_id, income_stream_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.priority ?? 100,
      input.match_type,
      input.pattern.trim(),
      input.meaning,
      isSalary ? 1 : 0,
      input.wallet_id ?? null,
      input.category_id ?? null,
      input.by_member_id ?? null,
      tenantId,
      streamId,
    )
    .run();
  return (await db.prepare("SELECT * FROM rules WHERE id = ?").bind(res.meta.last_row_id).first<Row>())!;
}

/** "Luôn coi mã/nội dung này là ..." — sinh từ một lần gán tay, chỉ cho spend/transfer (luật 6). */
export async function createRuleFromSplit(db: D1Database, split: Split, matchType: string, pattern: string, memberId: string | null): Promise<Record<string, unknown>> {
  if (split.meaning !== "spend" && split.meaning !== "transfer") {
    fail("rule_meaning_restricted", "Chỉ tạo được rule tự động cho spend hoặc transfer.");
  }
  return createRule(db, {
    match_type: matchType,
    pattern,
    meaning: split.meaning,
    wallet_id: split.wallet_id ?? null,
    category_id: split.category_id ?? null,
    by_member_id: memberId,
  });
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
