// Thông báo chiều ra: Telegram + Zalo + Web Push trên PWA. Ghi `notifications` TRƯỚC khi gửi (UNIQUE kind + day_key +
// chat_id): cron chạy lại hay chạy trùng cũng không gửi hai lần.

import type { Env } from "../env";
import { pushToMembers, SEND_TIMEOUT_MS } from "../services/push";
import type { NotifyMessage } from "./format";
import { getSecret } from "../services/secrets";
import { zaloToMembers } from "./zalo";

export async function sendTelegram(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break; // lỗi phía mình (chat_id sai...) thì thử lại vô ích
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  return { ok: false, error: last };
}

/** Chuỗi an toàn để chèn vào tin parse_mode=HTML. */
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Gửi một tin cho mọi thành viên đang hoạt động — qua Telegram (có tg_chat_id), qua Zalo (đã nối zalo_chat_id) và qua
 * từng máy đã bật thông báo trên PWA — mỗi kênh đúng một lần cho cặp (kind, dayKey). Telegram (HTML) và Zalo (chữ
 * thường, ADR-80) nhận bản đầy đủ `full`, máy nhận bản ngắn `push` (ADR-79). Trả tổng số tin đã gửi thành công trên mọi kênh.
 */
export async function notifyMembers(env: Env, kind: string, dayKey: string, message: NotifyMessage): Promise<number> {
  const text = message.full;
  const token = await getSecret(env, "telegram_bot_token");
  let sent = 0;
  if (token) {
    const members = await env.DB.prepare("SELECT tg_chat_id AS chatId FROM members WHERE active = 1 AND tg_chat_id IS NOT NULL AND tg_chat_id <> ''").all<{ chatId: string }>();
    for (const { chatId } of members.results ?? []) {
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload) VALUES (?, ?, ?, ?)")
        .bind(kind, dayKey, chatId, text)
        .run();
      if (!claim.meta.changes) continue; // đã gửi (hoặc đang gửi) ở lần chạy khác
      const result = await sendTelegram(token, chatId, text);
      await env.DB.prepare("UPDATE notifications SET ok = ? WHERE kind = ? AND day_key = ? AND chat_id = ?")
        .bind(result.ok ? 1 : 0, kind, dayKey, chatId)
        .run();
      if (result.ok) sent++;
      else console.error(`[telegram] ${kind} ${dayKey}: ${result.error}`);
    }
  }
  sent += await zaloToMembers(env, kind, dayKey, text);
  return sent + (await pushToMembers(env, kind, dayKey, message.push));
}
