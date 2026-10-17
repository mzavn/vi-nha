// Nối log ngân hàng vào khoản đã nhập tay (change 261017-webhook-truoc-moc, mở rộng ADR-113). Dùng chung cho ingest
// (webhook trước mốc tự nối, nút Nối ở màn Gán) và ledger (nhập tay khoản mà SePay đã báo).
//
// Khoản tay khớp một log của tài khoản A: giao dịch active, source 'manual', không phải điều chỉnh, chưa mang log của A,
// đúng chiều (tiền vào A: counter_account_id = A; tiền ra A: account_id = A), cùng số tiền, ngày VN lệch ≤ 1 ngày.
// Nối không tạo giao dịch, không đổi ví / danh mục / ghi chú: tiền ra A → log_id; tiền vào A → log_id_2 nếu là chuyển
// khoản (chân nhận), ngược lại log_id. Trigger ở DB (0005, 0037) chỉ cho gắn log còn 'pending'.

type Row = Record<string, unknown>;

export interface LogSide {
  accountId: string;
  direction: "in" | "out";
  amount: number;
  at: string;
}

/** Khoản tay khớp một log, như màn Gán thấy ("Đã nhập tay?"). */
export interface ManualMatch {
  id: number;
  at: string;
  amount: number;
  meaning: string;
  category_id: string | null;
  wallet_id: string | null;
  counter_wallet_id: string | null;
  account_id: string | null;
  counter_account_id: string | null;
  note: string | null;
}

/** Cột của giao dịch nhận log: tiền ra → log_id; tiền vào → log_id_2 nếu là chuyển khoản (chân nhận), không thì log_id. */
export const linkColumn = (direction: "in" | "out", meaning: string): "log_id" | "log_id_2" =>
  direction === "in" && meaning === "transfer" ? "log_id_2" : "log_id";

/**
 * Mốc của log webhook tài khoản A (ADR-113): tiền vào trước `feed_from`; tiền ra trước `feed_from` hay trước lúc bật "báo
 * cả tiền ra" (`sepay_out_from`) — lấy mốc muộn hơn. null = tài khoản không có mốc cho chiều này.
 */
export function feedMark(direction: "in" | "out", feedFrom: string | null, sepayOutFrom: string | null): string | null {
  const marks = [feedFrom, direction === "out" ? sepayOutFrom : null].filter((m): m is string => m !== null);
  if (marks.length === 0) return null;
  return marks.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/** Khoản tay khớp `log`, gần giờ nhất trước. `before`: chỉ khoản có `at` trước mốc này. */
export async function manualMatches(db: D1Database, log: LogSide, before: string | null = null): Promise<ManualMatch[]> {
  const res = await db
    .prepare(
      `SELECT t.id, t.at, t.amount, t.meaning, t.category_id, t.wallet_id, t.counter_wallet_id, t.account_id, t.counter_account_id, t.note
       FROM transactions t
       WHERE t.status = 'active' AND t.source = 'manual' AND t.meaning <> 'adjust' AND t.amount = ?1
         AND (CASE ?2 WHEN 'in' THEN t.counter_account_id ELSE t.account_id END) = ?3
         AND (CASE WHEN ?2 = 'in' AND t.meaning = 'transfer' THEN t.log_id_2 ELSE t.log_id END) IS NULL
         AND NOT EXISTS (SELECT 1 FROM bank_logs l WHERE l.id IN (t.log_id, t.log_id_2) AND l.account_id = ?3)
         AND abs(julianday(date(t.at, '+7 hours')) - julianday(date(?4, '+7 hours'))) <= 1
         AND (?5 IS NULL OR julianday(t.at) < julianday(?5))
       ORDER BY abs(julianday(t.at) - julianday(?4)), t.id
       LIMIT 10`,
    )
    .bind(log.amount, log.direction, log.accountId, log.at, before)
    .all<Row>();
  return ((res.results ?? []) as unknown as ManualMatch[]).map((m) => ({ ...m, id: Number(m.id), amount: Number(m.amount) }));
}

/** Khoản gần giờ `at` nhất; hai khoản lệch bằng nhau thì không đoán (null). */
export function closest<T extends { at: string }>(list: T[], at: string): T | null {
  const t = Date.parse(at);
  const gap = (x: T) => Math.abs(Date.parse(x.at) - t);
  const [first, second] = [...list].sort((a, b) => gap(a) - gap(b));
  if (!first || (second && gap(second) === gap(first))) return null;
  return first;
}

/** Lệnh nối `logId` vào cột `column` của giao dịch `txId` và đổi log sang 'assigned' — log chỉ đổi khi giao dịch nhận nó. */
export function linkStatements(db: D1Database, txId: number, logId: string, column: "log_id" | "log_id_2"): D1PreparedStatement[] {
  return [
    db.prepare(`UPDATE transactions SET ${column} = ? WHERE id = ? AND status = 'active' AND source = 'manual' AND ${column} IS NULL`).bind(logId, txId),
    db
      .prepare(`UPDATE bank_logs SET status = 'assigned' WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND ${column} = ?)`)
      .bind(logId, txId, logId),
  ];
}

/** Nối một log vào khoản tay; log vừa bị xử lý ở request khác thì không nối (false). */
export async function linkLogToTx(db: D1Database, txId: number, logId: string, column: "log_id" | "log_id_2"): Promise<boolean> {
  try {
    await db.batch(linkStatements(db, txId, logId, column));
  } catch (err) {
    if (/log_not_pending/.test(String(err))) return false;
    throw err;
  }
  return !!(await db.prepare(`SELECT 1 AS ok FROM transactions WHERE id = ? AND ${column} = ?`).bind(txId, logId).first());
}
