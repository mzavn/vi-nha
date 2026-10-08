// Kênh Zalo Bot (ADR-80): gọi Bot API của Zalo và gửi bản đầy đủ của mỗi tin cho người đã nối Zalo.
// Chống gửi trùng cùng bảng `notifications` như Telegram và push, với chat_id = 'zalo:<chat_id>'.

import type { Env } from "../env";
import { SEND_TIMEOUT_MS } from "../services/push";
import { getSecret } from "../services/secrets";

const ZALO_API = "https://bot-api.zaloplatforms.com";
/** Zalo nhận `text` dài 1–2000 ký tự; đếm theo đơn vị UTF-16 cho chắc (emoji tính 2). */
export const ZALO_TEXT_MAX = 2000;

/** Kết quả một lời gọi Bot API. `status` 0 = không tới được Zalo; `code` = mã lỗi Zalo (error_code), không có thì mã HTTP. */
export interface ZaloReply {
  ok: boolean;
  status: number;
  code?: number;
  error?: string;
  result?: unknown;
}

/** Một lời gọi Bot API, không thử lại. Zalo có thể trả HTTP 200 kèm `ok: false` — coi là lỗi. */
export async function callZalo(token: string, method: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<ZaloReply> {
  let res: Response;
  try {
    res = await fetchImpl(`${ZALO_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
  type Body = { ok?: unknown; result?: unknown; error_code?: unknown; errorCode?: unknown; description?: unknown };
  let data: Body | null;
  try {
    data = (await res.json()) as Body | null;
  } catch {
    data = null;
  }
  if (res.ok && data?.ok !== false) return { ok: true, status: res.status, result: data?.result };
  const code = Number(data?.error_code ?? data?.errorCode ?? res.status) || res.status;
  const description = typeof data?.description === "string" ? ` ${data.description.slice(0, 200)}` : "";
  return { ok: false, status: res.status, code, error: `${code}${description}` };
}

/** Gửi một tin, tối đa 3 lượt; chỉ thử lại khi lỗi mạng, Zalo lỗi 5xx hay quá giờ (408). Hết lượt (429) dừng ngay. */
export async function sendZalo(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch): Promise<ZaloReply> {
  let last: ZaloReply = { ok: false, status: 0 };
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await callZalo(token, "sendMessage", { chat_id: chatId, text }, fetchImpl);
    if (last.ok) return last;
    const transient = last.status === 0 || last.status >= 500 || (last.code ?? 0) >= 500 || last.code === 408;
    if (!transient || attempt === 3) break;
    await new Promise((r) => setTimeout(r, 500 * attempt)); // tsconfig lib ES2022: chưa có Promise.withResolvers
  }
  return last;
}

/**
 * Bản đầy đủ (viết cho Telegram parse_mode=HTML) → chữ thường cho Zalo: bỏ thẻ, trả các ký tự đã escape về nguyên dạng,
 * dài quá 2000 thì cắt và kết bằng "…". Gửi không kèm parse_mode nên tên ví/tài khoản hiện đúng từng ký tự.
 */
export function zaloText(full: string): string {
  const plain = full
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  if (plain.length <= ZALO_TEXT_MAX) return plain;
  let out = "";
  for (const ch of plain) {
    if (out.length + ch.length > ZALO_TEXT_MAX - 1) break;
    out += ch;
  }
  return `${out}…`;
}

/**
 * Kênh Zalo của notifyMembers: mỗi chat Zalo của thành viên đang hoạt động đúng một lần cho cặp (kind, dayKey).
 * Chưa đặt bot token thì bỏ qua. Trả số tin gửi được.
 */
export async function zaloToMembers(env: Env, kind: string, dayKey: string, full: string): Promise<number> {
  const token = await getSecret(env, "zalo_bot_token");
  if (!token) return 0;
  const text = zaloText(full);
  const members = await env.DB.prepare("SELECT zalo_chat_id AS chatId FROM members WHERE active = 1 AND zalo_chat_id IS NOT NULL AND zalo_chat_id <> ''").all<{ chatId: string }>();
  let sent = 0;
  for (const { chatId } of members.results ?? []) {
    const key = `zalo:${chatId}`;
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload) VALUES (?, ?, ?, ?)").bind(kind, dayKey, key, text).run();
    if (!claim.meta.changes) continue; // đã gửi (hoặc đang gửi) ở lần chạy khác, hay cùng chat đã nối cho người khác
    const result = await sendZalo(token, chatId, text);
    await env.DB.prepare("UPDATE notifications SET ok = ? WHERE kind = ? AND day_key = ? AND chat_id = ?")
      .bind(result.ok ? 1 : 0, kind, dayKey, key)
      .run();
    if (result.ok) sent++;
    else console.error(`[zalo] ${kind} ${dayKey}: ${result.error}`);
  }
  return sent;
}
