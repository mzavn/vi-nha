// Zalo Bot (ADR-80): nối Zalo bằng mã, nhận tin của bot qua webhook, đặt webhook và gửi thử từ màn Cài đặt.
// Zalo chỉ cho biết chat_id khi người dùng nhắn bot, nên không nhập tay: app tạo mã 6 số, người đó nhắn mã cho bot,
// webhook ghi chat.id của tin vào members.zalo_chat_id. Không bao giờ ghi nội dung tin nhắn ra log.

import { dayKey } from "../domain/period";
import { DomainError } from "../domain/types";
import type { Env } from "../env";
import { callZalo, sendZalo, type ZaloReply } from "../notify/zalo";
import { alertMembers, audit, type Actor, type AuditVia } from "./audit";
import { getSecret } from "./secrets";

/** Mã nối dùng được 15 phút. */
export const ZALO_CODE_TTL_MS = 15 * 60_000;
const CODE_RE = /(?<!\d)\d{6}(?!\d)/;
/** Một chat nhắn sai mã quá 5 lần trong 1 giờ thì thôi thử mã tới khi hết giờ (ADR-90). */
export const ZALO_CODE_MAX_FAILURES = 5;
const ZALO_CODE_FAILURE_WINDOW_MS = 60 * 60_000;

const LIMITED =
  "Đã nhắn sai mã quá nhiều lần. Đợi 1 giờ rồi tạo mã mới trong app Ví nhà (Cài đặt › Thành viên › tên của bạn › Nối Zalo) và nhắn lại.";

const HELP =
  "Đây là bot báo tin của Ví nhà, bot không đọc tin nhắn. Muốn nhận tin ở Zalo: mở app Ví nhà › Cài đặt › Thành viên › tên của bạn › Nối Zalo, rồi nhắn mã 6 số app đưa vào đây (mã dùng được 15 phút).";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Câu dễ hiểu cho lỗi của Zalo Bot API. */
export function zaloErrorText(r: ZaloReply): string {
  if (r.status === 0) return `Không gọi được Zalo (${r.error ?? "lỗi mạng"}). Thử lại sau.`;
  if (r.code === 401) return "Bot token Zalo sai hoặc đã bị đặt lại — dán lại token mới ở Kết nối.";
  if (r.code === 426) return "Hôm nay đã đặt webhook quá số lần Zalo cho phép — để mai thử lại.";
  if (r.code === 429) return "Bot Zalo đã hết lượt gửi (gói miễn phí 3.000 tin mỗi tháng).";
  return `Zalo từ chối (${r.error ?? r.code}).`;
}

/**
 * `POST /v1/settings/members/:id/zalo-code` — mã 6 số để người đó nhắn cho bot. Mỗi người một mã đang chờ: tạo mã mới thì
 * mã cũ hết dùng; mã hết hạn của mọi người được dọn luôn. Chưa đặt bot token hay khoá webhook thì tin nhắn không tới app.
 * Người đã nối Zalo thì phải bỏ nối trước (ADR-90): nối lại không bao giờ âm thầm đè chat cũ. Mã nhớ ai tạo (`actor`).
 */
export async function createZaloLinkCode(env: Env, memberId: string, now: Date, actor: Actor) {
  const member = await env.DB.prepare("SELECT name, zalo_chat_id FROM members WHERE id = ? AND active = 1").bind(memberId).first<{ name: string; zalo_chat_id: string | null }>();
  if (!member) throw new DomainError("not_found", "Không có thành viên này.", 404);
  if (member.zalo_chat_id) {
    throw new DomainError("zalo_linked", `${member.name} đang nối Zalo. Bấm Bỏ nối Zalo trước rồi mới nối Zalo khác.`, 409);
  }
  const [token, secret] = await Promise.all([getSecret(env, "zalo_bot_token"), getSecret(env, "zalo_webhook_secret")]);
  if (!token || !secret) {
    throw new DomainError("zalo_not_ready", "Chưa đặt bot token và khoá webhook Zalo — đặt ở Cài đặt › Kết nối rồi bấm Đặt webhook.", 409);
  }
  const expiresAt = new Date(now.getTime() + ZALO_CODE_TTL_MS).toISOString();
  await env.DB.prepare("DELETE FROM zalo_link_codes WHERE member_id = ? OR expires_at <= ?").bind(memberId, now.toISOString()).run();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
    const r = await env.DB.prepare("INSERT OR IGNORE INTO zalo_link_codes (member_id, code, expires_at, created_by, created_via) VALUES (?, ?, ?, ?, ?)")
      .bind(memberId, code, expiresAt, actor.memberId, actor.via)
      .run();
    if (r.meta.changes) return { code, expires_at: expiresAt };
  }
  throw new Error("không tạo được mã nối Zalo không trùng");
}

/**
 * Một sự kiện webhook Zalo đã qua xác thực. Chỉ xử lý chat riêng (nhóm bỏ qua): tin có mã 6 số còn hạn → nối Zalo cho
 * đúng người, trả lời đã nối, ghi nhật ký (người tạo mã) và cảnh báo cả nhà; tin khác → trả lời hướng dẫn, tối đa một lần
 * mỗi chat mỗi ngày (giữ lượt gửi của gói miễn phí). Mã sai được đếm theo chat: quá 5 lần trong 1 giờ thì chat đó không
 * được thử mã nữa (trả lời một lần mỗi ngày). Người đã nối Zalo khác (nối xong sau khi tạo mã) thì không đè.
 * Trả lời chỉ gọi Zalo một lần, không thử lại, để webhook trả lời nhanh.
 */
export async function handleZaloUpdate(env: Env, payload: unknown, now: Date, fetchImpl: typeof fetch = fetch): Promise<"linked" | "help" | "ignored" | "limited" | "taken"> {
  const event = isObj(payload) && isObj(payload.result) ? payload.result : payload;
  if (!isObj(event) || !isObj(event.message)) return "ignored";
  const message = event.message;
  const chat = message.chat;
  if (!isObj(chat) || chat.chat_type !== "PRIVATE") return "ignored";
  const chatId = typeof chat.id === "string" || typeof chat.id === "number" ? String(chat.id) : "";
  if (!chatId || chatId.length > 64) return "ignored";

  const token = await getSecret(env, "zalo_bot_token");
  const reply = async (text: string) => {
    if (!token) return;
    const r = await callZalo(token, "sendMessage", { chat_id: chatId, text }, fetchImpl);
    if (!r.ok) console.error(`[zalo] trả lời webhook: ${r.error}`);
  };

  const code = typeof message.text === "string" ? message.text.match(CODE_RE)?.[0] : undefined;
  if (code) {
    const since = new Date(now.getTime() - ZALO_CODE_FAILURE_WINDOW_MS).toISOString();
    const failures = await env.DB.prepare("SELECT COUNT(*) AS n FROM zalo_code_failures WHERE chat_id = ? AND at > ?").bind(chatId, since).first<{ n: number }>();
    if ((failures?.n ?? 0) >= ZALO_CODE_MAX_FAILURES) {
      if (!token) return "limited";
      const claim = await env.DB.prepare("INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload, ok) VALUES ('zalo_limited', ?, ?, NULL, 1)")
        .bind(dayKey(now), `zalo:${chatId}`)
        .run();
      if (claim.meta.changes) await reply(LIMITED);
      return "limited";
    }
    const member = await env.DB.prepare(
      `SELECT m.id, m.name, m.zalo_chat_id AS linked, c.created_by AS createdBy, c.created_via AS createdVia
       FROM zalo_link_codes c JOIN members m ON m.id = c.member_id WHERE c.code = ? AND c.expires_at > ? AND m.active = 1`,
    )
      .bind(code, now.toISOString())
      .first<{ id: string; name: string; linked: string | null; createdBy: string | null; createdVia: AuditVia | null }>();
    if (member?.linked && member.linked !== chatId) {
      await env.DB.prepare("DELETE FROM zalo_link_codes WHERE member_id = ?").bind(member.id).run();
      await reply(`${member.name} đang nối Zalo khác. Vào app Ví nhà bỏ nối Zalo cũ trước rồi tạo mã mới.`);
      return "taken";
    }
    if (member) {
      await env.DB.batch([
        env.DB.prepare("UPDATE members SET zalo_chat_id = ? WHERE id = ?").bind(chatId, member.id),
        env.DB.prepare("DELETE FROM zalo_link_codes WHERE member_id = ?").bind(member.id),
      ]);
      await reply(`Đã nối Zalo cho ${member.name}. Ví nhà sẽ báo tin ở đây.`);
      const actor: Actor = { memberId: member.createdBy, via: member.createdVia ?? "session" };
      const id = await audit(env.DB, actor, "member.zalo_link", `member:${member.id}`, null);
      await alertMembers(env, id, actor, { what: `nối Zalo nhận tin cho ${member.name}` }).catch((err: unknown) =>
        console.error(`[zalo] cảnh báo nối Zalo: ${err instanceof Error ? err.message : String(err)}`),
      );
      return "linked";
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM zalo_code_failures WHERE at <= ?").bind(since),
      env.DB.prepare("INSERT INTO zalo_code_failures (chat_id, at) VALUES (?, ?)").bind(chatId, now.toISOString()),
    ]);
  }

  if (!token) return "help"; // chưa có token thì không trả lời được — đừng tiêu lượt hướng dẫn của hôm nay
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload, ok) VALUES ('zalo_help', ?, ?, NULL, 1)")
    .bind(dayKey(now), `zalo:${chatId}`)
    .run();
  if (claim.meta.changes) await reply(HELP);
  return "help";
}

/** `POST /v1/settings/zalo/webhook` — báo Zalo gửi tin nhắn của bot về `<origin>/webhooks/zalo`, kèm khoá webhook. */
export async function setZaloWebhook(env: Env, origin: string, fetchImpl: typeof fetch = fetch) {
  const url = `${origin}/webhooks/zalo`;
  const [token, secret] = await Promise.all([getSecret(env, "zalo_bot_token"), getSecret(env, "zalo_webhook_secret")]);
  if (!token) return { ok: false, url, verified: null, error: "Chưa đặt bot token Zalo." };
  if (!secret) return { ok: false, url, verified: null, error: "Chưa đặt khoá webhook Zalo." };
  const r = await callZalo(token, "setWebhook", { url, secret_token: secret }, fetchImpl);
  if (!r.ok) return { ok: false, url, verified: null, error: zaloErrorText(r) };
  // Zalo lưu địa chỉ rồi gọi thử ngay; kết quả gọi thử nằm ở result.verification.
  const verification = isObj(r.result) && isObj(r.result.verification) ? r.result.verification : null;
  const verified = typeof verification?.ok === "boolean" ? verification.ok : null;
  if (verified === false) {
    const outcome = typeof verification?.outcome === "string" ? ` (${verification.outcome.slice(0, 60)})` : "";
    return { ok: true, url, verified, error: `Zalo đã lưu địa chỉ nhưng gọi thử chưa được${outcome}.` };
  }
  return { ok: true, url, verified };
}

/** `POST /v1/settings/test/zalo` — tin thử tới Zalo của một người. */
export async function testZalo(env: Env, memberId: string, fetchImpl: typeof fetch = fetch) {
  const m = await env.DB.prepare("SELECT name, zalo_chat_id FROM members WHERE id = ? AND active = 1").bind(memberId).first<{ name: string; zalo_chat_id: string | null }>();
  if (!m) throw new DomainError("not_found", "Không có thành viên này.", 404);
  if (!m.zalo_chat_id) return { sent: false, error: "Người này chưa nối Zalo." };
  const token = await getSecret(env, "zalo_bot_token");
  if (!token) return { sent: false, error: "Chưa đặt bot token Zalo." };
  const r = await sendZalo(token, m.zalo_chat_id, `✅ Ví nhà đã nối Zalo cho ${m.name}.`, fetchImpl);
  return r.ok ? { sent: true } : { sent: false, error: zaloErrorText(r) };
}
