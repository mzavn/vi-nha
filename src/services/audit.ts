// Nhật ký thay đổi (ADR-90): ai làm gì, qua đâu, lúc nào — cho các việc mà người có phiên/token bị lộ có thể lợi dụng
// (huỷ/sửa/gỡ gán giao dịch, sửa cài đặt, khoá kết nối, kênh báo tin). Bảng audit_log chỉ thêm. `detail` không bao giờ
// chứa khoá/token: chỉ tên trường đã đổi và giá trị không bí mật.
// Kênh báo tin mới hay khoá đổi → cảnh báo tới MỌI kênh hiện có của cả nhà, để người bị chiếm quyền biết mà gỡ.

import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { escapeHtml, notifyMembers, sendTelegram } from "../notify/telegram";
import { sendZalo, zaloText } from "../notify/zalo";
import { getSecret } from "./secrets";

export type AuditVia = "session" | "token" | "mcp";
export interface Actor {
  memberId: string | null;
  via: AuditVia;
}
export type AuditDetail = Record<string, unknown>;

export const AUDIT_LIST_LIMIT = 50;

export const actorOf = (c: Context<AppEnv>): Actor => ({ memberId: c.get("memberId"), via: c.get("via") });

/** Tên trường có trong body (chỉ tên, không giá trị) — để nhật ký nói "đổi gì" mà không chép khoá. */
export const fieldNames = (b: Record<string, unknown>): string[] =>
  Object.keys(b)
    .filter((k) => /^[a-z_]{1,40}$/.test(k))
    .sort()
    .slice(0, 20);

/** Ghi một dòng nhật ký, trả id. */
export async function audit(db: D1Database, actor: Actor, action: string, target: string | null, detail: AuditDetail | null = null): Promise<number> {
  const row = await db
    .prepare("INSERT INTO audit_log (member_id, via, action, target, detail) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(actor.memberId, actor.via, action, target, detail ? JSON.stringify(detail) : null)
    .first<{ id: number }>();
  return row!.id;
}

export interface AuditEntry {
  id: number;
  at: string;
  memberId: string | null;
  memberName: string | null;
  via: AuditVia;
  action: string;
  target: string | null;
  detail: AuditDetail | null;
}

/** `GET /v1/settings/audit` — 50 dòng mới nhất. */
export async function listAudit(db: D1Database, limit = AUDIT_LIST_LIMIT): Promise<AuditEntry[]> {
  const res = await db
    .prepare(
      `SELECT a.id, a.at, a.member_id AS memberId, m.name AS memberName, a.via, a.action, a.target, a.detail
       FROM audit_log a LEFT JOIN members m ON m.id = a.member_id ORDER BY a.id DESC LIMIT ?`,
    )
    .bind(limit)
    .all<Omit<AuditEntry, "detail"> & { detail: string | null }>();
  return (res.results ?? []).map((r) => ({ ...r, detail: r.detail ? (JSON.parse(r.detail) as AuditDetail) : null }));
}

const VIA_LABEL: Record<AuditVia, string> = { session: "", token: " (qua API token)", mcp: " (qua Claude)" };

async function actorLabel(db: D1Database, actor: Actor): Promise<string> {
  const m = actor.memberId ? await db.prepare("SELECT name FROM members WHERE id = ?").bind(actor.memberId).first<{ name: string }>() : null;
  return `${m?.name ?? "Ai đó"}${VIA_LABEL[actor.via]}`;
}

export interface Alert {
  /** Vế sau "<người> vừa …", vd "thêm máy nhận thông báo: Android · Chrome". */
  what: string;
  /** Kênh vừa bị gỡ/thay: báo cả nó, vì notifyMembers chỉ còn thấy kênh mới. */
  also?: { telegram?: string | null; zalo?: string | null };
}

const ALERT_KIND = "security";

/**
 * Cảnh báo tới mọi kênh của cả nhà (Telegram, Zalo, mọi máy đã bật) qua notifyMembers, claim theo
 * `(security, audit:<id>)` nên mỗi dòng nhật ký báo đúng một lần mỗi kênh; thêm kênh cũ vừa bị gỡ/thay nếu có.
 */
export async function alertMembers(env: Env, auditId: number, actor: Actor, alert: Alert): Promise<number> {
  const text = `${await actorLabel(env.DB, actor)} vừa ${alert.what} — nếu không phải người nhà làm, vào Cài đặt gỡ ngay.`;
  const full = `⚠️ ${escapeHtml(text)}`;
  const dayKey = `audit:${auditId}`;
  let sent = await notifyMembers(env, ALERT_KIND, dayKey, { full, push: { title: "Ví nhà: có thay đổi cần xem", body: text.slice(0, 150) } });
  const claim = async (chatId: string) =>
    (await env.DB.prepare("INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload, ok) VALUES (?, ?, ?, ?, 1)").bind(ALERT_KIND, dayKey, chatId, full).run()).meta.changes > 0;
  const tg = alert.also?.telegram;
  if (tg && (await claim(tg))) {
    const token = await getSecret(env, "telegram_bot_token");
    if (token && (await sendTelegram(token, tg, full)).ok) sent++;
  }
  const zalo = alert.also?.zalo;
  if (zalo && (await claim(`zalo:${zalo}`))) {
    const token = await getSecret(env, "zalo_bot_token");
    if (token && (await sendZalo(token, zalo, zaloText(full))).ok) sent++;
  }
  return sent;
}

/** Việc chạy sau khi trả lời: `waitUntil` (Worker giữ thêm ~30 giây). Không có ExecutionContext (gọi `app.request` trong test) thì chờ luôn. */
export async function afterResponse(c: Context<AppEnv>, work: Promise<void>): Promise<void> {
  let ctx: Context<AppEnv>["executionCtx"] | null;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = null;
  }
  if (ctx) ctx.waitUntil(work);
  else await work;
}

/** Ghi nhật ký cho request đang xử lý; có `alert` thì cảnh báo cả nhà sau khi trả lời (lỗi gửi chỉ ghi log). */
export async function recordChange(c: Context<AppEnv>, action: string, target: string | null, detail: AuditDetail | null, alert?: Alert): Promise<void> {
  const actor = actorOf(c);
  const id = await audit(c.env.DB, actor, action, target, detail);
  if (!alert) return;
  await afterResponse(
    c,
    alertMembers(c.env, id, actor, alert).then(
      () => undefined,
      (err: unknown) => console.error(`[audit] cảnh báo #${id}: ${err instanceof Error ? err.message : String(err)}`),
    ),
  );
}
