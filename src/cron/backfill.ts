// Lấy lại giao dịch qua SePay API v2 — lưới an toàn khi webhook bị sót. Một hàm cho hai đường (ADR-75):
// rà soát 02:00 sáng giờ VN (D11, phase 04) và "Đồng bộ lại SePay" theo khoảng ngày ở màn Cài đặt.

import { dayKey } from "../domain/period";
import { ingestLog, parseHistoryRow, recordIngestError, vnDateTimeToIso } from "../services/ingest";
import type { Env } from "../env";
import { loadSepayConnections } from "../services/secrets";
import { listTransactions, sepayErrorText } from "../services/sepay-api";

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD HH:mm:ss" giờ Việt Nam của một mốc UTC — khuôn mà API lịch sử SePay đòi hỏi. */
function vnDateTimeString(at: Date): string {
  const vn = new Date(at.getTime() + 7 * 3600_000);
  return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())}`;
}

/**
 * Khoảng rà soát của lượt 02:00 (giờ VN) — ba lớp chồng nhau, một lần gọi API cho lớp rộng nhất (chống trùng lo phần chồng):
 * - mỗi ngày: hôm qua 00:00 → bây giờ;
 * - thứ Hai: cả tuần trước (thứ Hai tuần trước 00:00 → bây giờ) — soát lại 7 lần rà ngày;
 * - ngày 1: cả tháng trước (ngày 1 tháng trước 00:00 → bây giờ) — soát lại cả rà tuần lẫn rà ngày.
 * Thứ Hai trùng ngày 1 thì lấy tháng (rộng hơn tuần). Xa hơn tháng trước không có ích: số dư đã đối soát hằng ngày.
 */
export function backfillWindow(now: Date): { from: Date; scope: "day" | "week" | "month" } {
  const vn = new Date(now.getTime() + 7 * 3600_000);
  const y = vn.getUTCFullYear(), m = vn.getUTCMonth(), d = vn.getUTCDate();
  const midnight = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd) - 7 * 3600_000);
  if (d === 1) return { from: midnight(y, m - 1, 1), scope: "month" };
  if (vn.getUTCDay() === 1) return { from: midnight(y, m, d - 7), scope: "week" };
  return { from: midnight(y, m, d - 1), scope: "day" };
}

export interface ConnectionSync {
  id: string;
  name: string;
  added: number;
  /** Giao dịch SePay trả về mà app đã có (từ webhook hoặc lần lấy trước). */
  duplicates: number;
  /** Giao dịch mới nhưng trước ngày mở sổ của tài khoản (ADR-76): đã nằm trong số dư đầu, lưu 'ignored', không vào sổ. */
  beforeOpening: number;
  error: string | null;
}

export interface SyncResult {
  added: number;
  duplicates: number;
  beforeOpening: number;
  perConnection: ConnectionSync[];
  /** "<tên kết nối>: <lỗi>" — một kết nối lỗi không chặn kết nối khác. */
  errors: string[];
}

type KnownAccount = { id: string; account_no: string; sub_account: string | null; sepay_connection_id: string | null };

const NO_TOKEN = "Chưa đặt token API SePay.";

/**
 * Lấy giao dịch trong `range` (giờ VN, "YYYY-MM-DD HH:mm:ss") của từng kết nối SePay đang bật — hoặc chỉ `connectionId` —
 * rồi ghi qua `ingestLog` như webhook. Mỗi kết nối chỉ giữ giao dịch của tài khoản thuộc nó, đã bật SePay và còn dùng.
 * Giao dịch đã có được nhận ra bằng một câu SELECT cho cả khoảng ngày (id hoặc (tài khoản, mã tham chiếu)), không tốn
 * truy vấn từng dòng — chạy lại cùng khoảng ngày chỉ tốn lời gọi SePay. `ingestLog` vẫn là chốt chống trùng cuối.
 */
export async function syncSepay(
  env: Env,
  range: { from: string; to: string },
  now: Date,
  fetchImpl: typeof fetch,
  opts: { connectionId?: string } = {},
): Promise<SyncResult> {
  const connections = (await loadSepayConnections(env, { activeOnly: true })).filter((c) => !opts.connectionId || c.id === opts.connectionId);
  const accounts = (
    await env.DB.prepare(
      "SELECT id, account_no, sub_account, sepay_connection_id FROM accounts WHERE sepay_enabled = 1 AND active = 1 AND account_no IS NOT NULL",
    ).all<KnownAccount>()
  ).results ?? [];

  const result: SyncResult = { added: 0, duplicates: 0, beforeOpening: 0, perConnection: [], errors: [] };
  let seen: { ids: Set<string>; refs: Set<string> } | null = null;

  for (const conn of connections) {
    const mine = accounts.filter((a) => a.sepay_connection_id === conn.id);
    // Chưa có tài khoản nào thuộc kết nối: không gọi SePay (API v2 không lọc theo số tài khoản, lấy về cũng bỏ hết).
    if (mine.length === 0) continue;
    const entry: ConnectionSync = { id: conn.id, name: conn.name, added: 0, duplicates: 0, beforeOpening: 0, error: null };
    result.perConnection.push(entry);
    if (!conn.apiToken) {
      entry.error = NO_TOKEN;
      continue;
    }

    let rowsFromApi: Record<string, unknown>[];
    try {
      rowsFromApi = await listTransactions(range, conn.apiToken, fetchImpl);
    } catch (err) {
      entry.error = sepayErrorText(err);
      console.error(`[backfill] lỗi gọi API lịch sử SePay (${conn.id}):`, err instanceof Error ? err.message : "unknown");
      continue;
    }

    seen ??= await existingLogs(env.DB, range);
    const bySub = new Map(mine.filter((a) => a.sub_account).map((a) => [a.sub_account!, a.id]));
    const byNo = new Map(mine.map((a) => [a.account_no, a.id]));
    for (const row of rowsFromApi) {
      // API v2 không lọc được theo số tài khoản: lấy cả công ty rồi chỉ giữ tài khoản của kết nối này.
      if (!byNo.has(String(row.account_number ?? "")) && !bySub.has(String(row.va ?? ""))) continue;
      let parsed;
      try {
        parsed = parseHistoryRow(row);
      } catch (err) {
        await recordIngestError(env.DB, "backfill", String(row.reference_number ?? row.id ?? "khong-co-id"), err instanceof Error ? err.message : "unknown", now);
        continue;
      }
      const accountId = (parsed.subAccount && bySub.get(parsed.subAccount)) || (parsed.accountNo && byNo.get(parsed.accountNo)) || null;
      if (seen.ids.has(parsed.id) || (parsed.referenceNumber && seen.refs.has(`${accountId}|${parsed.referenceNumber}`))) {
        entry.duplicates++;
        continue;
      }
      try {
        const r = await ingestLog(env.DB, parsed, "backfill", now, conn.id);
        if (r.beforeOpening) entry.beforeOpening++;
        else if (r.created) entry.added++;
        else entry.duplicates++;
        seen.ids.add(parsed.id);
      } catch (err) {
        console.error("[backfill] bỏ qua một dòng, lần sau thử lại:", err instanceof Error ? err.message : "unknown");
      }
    }
  }

  for (const c of result.perConnection) {
    result.added += c.added;
    result.duplicates += c.duplicates;
    result.beforeOpening += c.beforeOpening;
    if (c.error) result.errors.push(`${c.name}: ${c.error}`);
  }
  return result;
}

/** Log đã có quanh khoảng ngày (nới một ngày mỗi đầu cho chắc), một câu SELECT. */
async function existingLogs(db: D1Database, range: { from: string; to: string }) {
  const from = new Date(Date.parse(vnDateTimeToIso(range.from)) - 86_400_000).toISOString();
  const to = new Date(Date.parse(vnDateTimeToIso(range.to)) + 86_400_000).toISOString();
  const rows =
    (await db.prepare("SELECT id, account_id, reference_number FROM bank_logs WHERE at BETWEEN ? AND ?").bind(from, to).all<{
      id: string;
      account_id: string | null;
      reference_number: string | null;
    }>()).results ?? [];
  return {
    ids: new Set(rows.map((r) => r.id)),
    refs: new Set(rows.filter((r) => r.reference_number).map((r) => `${r.account_id}|${r.reference_number}`)),
  };
}

/** Rà soát 02:00 theo `backfillWindow` (ngày / tuần / tháng), mọi kết nối. Tách riêng để test tiêm `fetch` giả. */
export async function runBackfill(env: Env, now: Date, fetchImpl: typeof fetch): Promise<SyncResult> {
  const window = backfillWindow(now);
  const result = await syncSepay(env, { from: vnDateTimeString(window.from), to: vnDateTimeString(now) }, now, fetchImpl);
  // Không kết nối nào có cả token lẫn tài khoản để rà → bỏ qua lặng lẽ, không ghi dòng rà soát.
  if (!result.perConnection.some((c) => c.error !== NO_TOKEN)) return result;

  // Một dòng duy nhất mỗi lần chạy — tin 07:00 đọc đúng hợp đồng này.
  await env.DB.prepare("INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload, ok) VALUES ('backfill', ?, 'system', ?, 1)")
    .bind(dayKey(now), JSON.stringify({ added: result.added, scope: window.scope }))
    .run();
  return result;
}

export async function backfill(env: Env, now: Date): Promise<void> {
  await runBackfill(env, now, fetch);
}
