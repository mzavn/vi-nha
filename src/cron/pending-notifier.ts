// Mỗi lượt cron (15 phút; đêm 01:00–03:59 VN mỗi giờ): gom log `pending` đã nhận ≥ 60 giây mà chưa báo → một tin Telegram gộp. Phase 04.
// Tắt ở Cài đặt hay đang giờ yên lặng thì src/cron/index.ts không gọi hàm này; log chờ tới lượt sau giờ yên lặng.
// Không báo ngay trong webhook: chân thứ nhất của một chuyển khoản nội bộ sẽ bị báo nhầm là "tiền lạ"
// trước khi chân thứ hai kịp về và ghép cặp.

import { pendingMessage, type PendingLog } from "../notify/format";
import { notifyMembers } from "../notify/telegram";
import { sqliteDateTime } from "../services/ingest";
import type { Env } from "../env";

const DELAY_MS = 60_000;
/** Telegram hỏng lâu (token sai, chat_id sai) thì thôi thử lại sau một ngày; tin sáng vẫn báo số chưa gán. */
const RETRY_WINDOW_MS = 24 * 3600_000;

type PendingRow = PendingLog & { id: string };

export async function notifyPendingLogs(env: Env, now: Date): Promise<void> {
  const cutoff = sqliteDateTime(new Date(now.getTime() - DELAY_MS));
  const oldest = sqliteDateTime(new Date(now.getTime() - RETRY_WINDOW_MS));
  // Log chờ ≥ 60 giây mà CHƯA báo thành công. Báo thành công mới đánh dấu ok = 1: gửi lỗi thì lần chạy sau thử lại,
  // vì một khoản tiền lạ mà không ai được báo là đúng cái thứ cảnh báo này tồn tại để chặn.
  const pending = await env.DB.prepare(
    `SELECT l.id, l.amount, l.direction, a.name AS accountName
     FROM bank_logs l LEFT JOIN accounts a ON a.id = l.account_id
     WHERE l.status = 'pending' AND l.received_at <= ? AND l.received_at >= ?
       AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.kind = 'pending_log' AND n.day_key = l.id AND n.ok = 1)
     ORDER BY l.received_at`,
  )
    .bind(cutoff, oldest)
    .all<PendingRow>();
  const rows = pending.results ?? [];
  if (rows.length === 0) return;

  const sent = await notifyMembers(env, "pending_batch", now.toISOString(), pendingMessage(rows));
  if (sent === 0) return; // không ai nhận được: để nguyên, lần chạy sau thử lại

  await env.DB.batch(
    rows.map((r) =>
      env.DB.prepare(
        `INSERT INTO notifications (kind, day_key, chat_id, payload, ok) VALUES ('pending_log', ?, 'system', ?, 1)
         ON CONFLICT (kind, day_key, chat_id) DO UPDATE SET ok = 1`,
      ).bind(r.id, JSON.stringify({ amount: r.amount, direction: r.direction })),
    ),
  );
}
