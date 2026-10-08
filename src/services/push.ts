// Thông báo đẩy (Web Push) cho PWA: mỗi máy đã bật là một dòng push_subscriptions, gắn với người đang đăng nhập.
// Khoá VAPID tự sinh lần đầu có request (cần origin làm `sub`), lưu trong config; khoá riêng không bao giờ ra ngoài.

import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import { DomainError } from "../domain/types";
import type { Env } from "../env";
import { sqliteDateTime } from "./ingest";

const PRIVATE_KEY = "secret:vapid_private_jwk";
const PUBLIC_KEY = "vapid_public";
const SUBJECT_KEY = "vapid_subject";

const TTL = 86_400;
/** Một lần gọi push service chờ tối đa 10 giây: một máy treo không giữ cả lượt cron. */
export const SEND_TIMEOUT_MS = 10_000;
/** Mỗi người tối đa 10 máy nhận thông báo. */
export const MAX_DEVICES_PER_MEMBER = 10;

/**
 * Push service thật của các trình duyệt (ADR-90): endpoint phải là https, cổng mặc định, host đúng một trong `exact` hoặc
 * đuôi `suffix`. Chrome/Edge Android/Samsung/Opera: FCM; Firefox: autopush của Mozilla; Safari (macOS, iOS 16.4+):
 * APNs web push (Apple: "allow `https://*.push.apple.com`"); Edge trên Windows: WNS (`wns2-….notify.windows.com`).
 */
export const PUSH_HOSTS = {
  exact: ["fcm.googleapis.com", "updates.push.services.mozilla.com"],
  suffix: [".push.apple.com", ".notify.windows.com"],
} as const;

export function isPushEndpoint(url: URL): boolean {
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.exact.some((h) => host === h) || PUSH_HOSTS.suffix.some((s) => host.endsWith(s) && host.length > s.length);
}

/** Bản ngắn của một tin, dựng sẵn ở `src/notify/format.ts` (ADR-79): chữ thường, không HTML. */
export type PushText = { title: string; body: string };
export type PushPayload = PushText & { url: string; tag: string };

const URLS: Record<string, string> = {
  daily: "/#today",
  weekly: "/#wallets",
  pending_batch: "/#assign",
  test: "/#settings",
  security: "/#settings",
};

/** Bản ngắn → nội dung thông báo: thêm đường mở theo loại tin, `tag` = loại tin. */
export function pushPayload(kind: string, push: PushText): PushPayload {
  return { ...push, url: URLS[kind] ?? "/", tag: kind };
}

/** Khoá đang dùng; chưa có thì null (cron không có request nên không tự sinh). */
export async function loadVapid(env: Env): Promise<VapidKeys | null> {
  const rows = await env.DB.prepare("SELECT k, v FROM config WHERE k IN (?, ?, ?)").bind(PRIVATE_KEY, PUBLIC_KEY, SUBJECT_KEY).all<{ k: string; v: string }>();
  const config: Record<string, string> = Object.fromEntries((rows.results ?? []).map((r) => [r.k, r.v]));
  const jwk = config[PRIVATE_KEY];
  const publicKey = config[PUBLIC_KEY];
  if (!jwk || !publicKey) return null;
  return { subject: config[SUBJECT_KEY], publicKey, privateKey: (JSON.parse(jwk) as JsonWebKey).d };
}

/**
 * Khoá đang dùng, chưa có thì sinh cặp ECDSA P-256 mới với `sub` = origin của request.
 * INSERT OR IGNORE trong một batch: hai request sinh cùng lúc thì bản ghi trước thắng, cả hai đọc lại cùng một khoá.
 */
export async function ensureVapid(env: Env, origin: string): Promise<VapidKeys> {
  const existing = await loadVapid(env);
  if (existing) return existing;
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  const insert = "INSERT OR IGNORE INTO config (k, v) VALUES (?, ?)";
  await env.DB.batch([
    env.DB.prepare(insert).bind(PRIVATE_KEY, JSON.stringify(jwk)),
    env.DB.prepare(insert).bind(PUBLIC_KEY, btoa(String.fromCharCode(...new Uint8Array(raw))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")),
    env.DB.prepare(insert).bind(SUBJECT_KEY, origin),
  ]);
  return (await loadVapid(env))!;
}

export type SubscriptionRow = { id: number; endpoint: string; p256dh: string; auth: string };
type SendOptions = { ttl?: number; urgency?: "high" | "normal"; fetchImpl?: typeof fetch };

/**
 * Gửi một thông báo tới một máy. 2xx → ghi last_ok_at; 404/410 → subscription đã chết, xoá luôn.
 * 429/5xx/lỗi mạng thì thử lại tối đa 3 lần như Telegram; lỗi khác (VAPID sai...) thử lại vô ích.
 */
export async function sendPush(env: Env, sub: SubscriptionRow, payload: PushPayload, vapid: VapidKeys, opts: SendOptions = {}): Promise<{ ok: boolean; error?: string }> {
  const { ttl = TTL, urgency = payload.tag === "test" || payload.tag === "pending_batch" || payload.tag === "security" ? "high" : "normal", fetchImpl = fetch } = opts;
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const req = await buildPushPayload(
        { data: payload, options: { ttl, urgency } },
        { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        vapid,
      );
      const res = await fetchImpl(sub.endpoint, { ...req, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
      if (res.ok) {
        await env.DB.prepare("UPDATE push_subscriptions SET last_ok_at = datetime('now') WHERE id = ?").bind(sub.id).run();
        return { ok: true };
      }
      last = `HTTP ${res.status}`;
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
        break;
      }
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  return { ok: false, error: last };
}

/**
 * Kênh push của notifyMembers: mỗi máy của thành viên đang hoạt động đúng một lần cho cặp (kind, dayKey),
 * claim trong notifications với chat_id = 'push:<id>'. Chưa có khoá VAPID thì bỏ qua. Trả số máy gửi được.
 */
export async function pushToMembers(env: Env, kind: string, dayKey: string, push: PushText): Promise<number> {
  const subs = await env.DB.prepare(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN members m ON m.id = s.member_id
     WHERE m.active = 1 ORDER BY s.id`,
  ).all<SubscriptionRow>();
  if (!subs.results?.length) return 0;
  const vapid = await loadVapid(env);
  if (!vapid) return 0;
  const payload = pushPayload(kind, push);
  let sent = 0;
  for (const sub of subs.results) {
    const chatId = `push:${sub.id}`;
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload) VALUES (?, ?, ?, ?)")
      .bind(kind, dayKey, chatId, `${push.title}\n${push.body}`)
      .run();
    if (!claim.meta.changes) continue;
    const result = await sendPush(env, sub, payload, vapid);
    await env.DB.prepare("UPDATE notifications SET ok = ? WHERE kind = ? AND day_key = ? AND chat_id = ?")
      .bind(result.ok ? 1 : 0, kind, dayKey, chatId)
      .run();
    if (result.ok) sent++;
    else console.error(`[push] ${kind} ${dayKey} #${sub.id}: ${result.error}`);
  }
  return sent;
}

/** Nhãn ngắn cho máy, đoán từ User-Agent: "iPhone · Safari", "Android · Chrome"... */
export function deviceLabel(ua: string | null): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows"
    : /Linux/.test(ua) ? "Linux"
    : null;
  const browser = /Edg\//.test(ua) ? "Edge"
    : /SamsungBrowser\//.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : null;
  return [os, browser].filter(Boolean).join(" · ") || null;
}

export async function getPush(env: Env, memberId: string | null, origin: string) {
  const vapid = await ensureVapid(env, origin);
  const rows = await env.DB.prepare(
    `SELECT s.id, s.member_id AS memberId, m.name AS memberName, s.user_agent AS userAgent, s.created_at AS createdAt, s.last_ok_at AS lastOkAt
     FROM push_subscriptions s JOIN members m ON m.id = s.member_id ORDER BY s.created_at, s.id`,
  ).all<{ id: number; memberId: string; memberName: string; userAgent: string | null; createdAt: string; lastOkAt: string | null }>();
  const series = memberId
    ? await env.DB.prepare(
        `SELECT id, status, sent, count, interval_s, created_at AS createdAt FROM push_test_series
         WHERE member_id = ? AND created_at > datetime('now', ?) ORDER BY id DESC LIMIT 1`,
      )
        .bind(memberId, SERIES_RECENT)
        .first<{ id: number; status: SeriesStatus; sent: number; count: number; interval_s: number; createdAt: string }>()
    : null;
  return {
    publicKey: vapid.publicKey!,
    subscriptions: (rows.results ?? []).map(({ userAgent, ...r }) => ({ ...r, device: deviceLabel(userAgent), mine: r.memberId === memberId })),
    series: series ?? null,
  };
}

const requireMember = (memberId: string | null): string => {
  if (!memberId) throw new DomainError("no_member", "Chưa xác định người dùng.");
  return memberId;
};

const B64URL = /^[A-Za-z0-9_-]{1,200}$/;
const key = (v: unknown, name: string): string => {
  const s = typeof v === "string" ? v.replace(/=+$/, "") : "";
  if (!B64URL.test(s)) throw new DomainError("invalid_input", `keys.${name} phải là chuỗi base64url.`);
  return s;
};

/** Máy vừa đăng ký / gỡ, đủ cho nhật ký và câu cảnh báo (không có endpoint, không khoá). */
export interface DeviceChange {
  id: number;
  memberId: string;
  device: string | null;
}

/**
 * Upsert theo endpoint; máy đã đăng ký cho người khác thì chuyển sang người đang đăng nhập. Endpoint phải thuộc push
 * service thật (`PUSH_HOSTS`); nhãn máy rút từ User-Agent của chính request (`userAgent`), không nhận từ body.
 * `added` = máy mới với người này (tạo mới hoặc vừa chuyển từ người khác) — chỗ gọi cảnh báo cả nhà.
 */
export async function subscribe(env: Env, memberId: string | null, input: Record<string, unknown>, userAgent: string | null): Promise<DeviceChange & { created: boolean; added: boolean }> {
  const member = requireMember(memberId);
  const endpoint = input.endpoint;
  let url: URL | null = null;
  try {
    url = typeof endpoint === "string" && endpoint.length <= 1000 ? new URL(endpoint) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:") throw new DomainError("invalid_input", "endpoint phải là URL https, tối đa 1000 ký tự.");
  if (!isPushEndpoint(url)) throw new DomainError("invalid_input", "endpoint không thuộc dịch vụ thông báo của trình duyệt (Google, Mozilla, Apple, Microsoft).");
  const keys = (input.keys ?? {}) as Record<string, unknown>;
  const p256dh = key(keys.p256dh, "p256dh");
  const auth = key(keys.auth, "auth");
  const ua = userAgent ? userAgent.slice(0, 500) : null;

  const existing = await env.DB.prepare("SELECT id, member_id AS memberId FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).first<{ id: number; memberId: string }>();
  const added = existing?.memberId !== member;
  if (added) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE member_id = ?").bind(member).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_DEVICES_PER_MEMBER) {
      throw new DomainError("too_many_devices", `Mỗi người nhận thông báo trên tối đa ${MAX_DEVICES_PER_MEMBER} máy — gỡ bớt máy cũ ở Cài đặt › Thông báo.`, 409);
    }
  }
  const row = await env.DB.prepare(
    `INSERT INTO push_subscriptions (member_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth,
       user_agent = COALESCE(excluded.user_agent, push_subscriptions.user_agent)
     RETURNING id, user_agent AS userAgent`,
  )
    .bind(member, endpoint, p256dh, auth, ua)
    .first<{ id: number; userAgent: string | null }>();
  return { id: row!.id, memberId: member, device: deviceLabel(row!.userAgent), created: !existing, added };
}

const REMOVED = "RETURNING id, member_id AS memberId, user_agent AS userAgent";
type RemovedRow = { id: number; memberId: string; userAgent: string | null };
const toChange = (r: RemovedRow | null): DeviceChange | null => (r ? { id: r.id, memberId: r.memberId, device: deviceLabel(r.userAgent) } : null);

/** Gỡ theo endpoint, của ai cũng được: máy đổi người/đăng xuất phải tự gỡ được dù đang gắn người cũ. */
export async function unsubscribe(env: Env, input: Record<string, unknown>): Promise<DeviceChange | null> {
  if (typeof input.endpoint !== "string" || !input.endpoint) throw new DomainError("invalid_input", "Thiếu endpoint.");
  return toChange(await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? ${REMOVED}`).bind(input.endpoint).first<RemovedRow>());
}

/** `DELETE /v1/push/subscriptions/:id` — gỡ một máy trong danh sách ở Cài đặt, của ai cũng được (máy lạ phải gỡ được). */
export async function removeSubscription(env: Env, id: number): Promise<DeviceChange> {
  const r = toChange(await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ? ${REMOVED}`).bind(id).first<RemovedRow>());
  if (!r) throw new DomainError("not_found", "Không có máy này (có thể đã được gỡ).", 404);
  return r;
}

/** Gửi thử tới mọi máy của người đang đăng nhập (không ghi notifications: bấm bao nhiêu lần gửi bấy nhiêu). */
export async function sendTest(env: Env, memberId: string | null, origin: string, fetchImpl: typeof fetch = fetch): Promise<{ sent: number; failed: number }> {
  const member = requireMember(memberId);
  const subs = await env.DB.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE member_id = ? ORDER BY id").bind(member).all<SubscriptionRow>();
  if (!subs.results?.length) throw new DomainError("no_subscription", "Máy này chưa bật thông báo.", 409);
  const vapid = await ensureVapid(env, origin);
  const payload = pushPayload("test", { title: "Gửi thử", body: "✅ Ví nhà sẽ báo tin lên máy này." });
  let sent = 0;
  for (const sub of subs.results) {
    const r = await sendPush(env, sub, payload, vapid, { fetchImpl });
    if (r.ok) sent++;
    else console.error(`[push] test #${sub.id}: ${r.error}`);
  }
  return { sent, failed: subs.results.length - sent };
}

export type SeriesStatus = "pending" | "running" | "done" | "cancelled";
export type TestSeries = { id: number; member: string; count: number; interval_s: number };
/** Lượt gửi thử cũ hơn thế này không hiện trên app nữa. */
const SERIES_RECENT = "-15 minutes";
/** Chờ trước tin đầu: đủ để người dùng vuốt tắt app. */
const SERIES_FIRST_DELAY_S = 10;
/** Lượt chạy trong waitUntil (~30 giây sau khi trả lời): 10 + (2 − 1) × 10 = 20 giây là tối đa. */
const SERIES_MAX_COUNT = 2;
const SERIES_INTERVAL_S = 10;
/** Tin thử hết hạn sau 5 phút: máy tắt mạng lâu hơn thì thôi. */
const SERIES_TTL = 300;
/** Lượt kẹt (Worker bị dừng giữa chừng) quá lâu thì cron huỷ, để không chặn lượt mới. */
const SERIES_STALE_MS = 10 * 60_000;

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const intIn = (v: unknown, name: string, min: number, max: number, fallback: number): number => {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new DomainError("invalid_input", min === max ? `${name} phải là ${min}.` : `${name} phải là số nguyên ${min}–${max}.`);
  }
  return v;
};

/**
 * Ghi một lượt gửi thử cho mọi máy của người đang đăng nhập, đã ở trạng thái 'running'.
 * Việc gửi (runTestSeries) chạy nền ngay sau khi trả lời, nên tắt app ngay sau khi bấm vẫn nhận được.
 */
export async function createTestSeries(env: Env, memberId: string | null, input: Record<string, unknown>): Promise<TestSeries> {
  const member = requireMember(memberId);
  const count = intIn(input.count, "count", 1, SERIES_MAX_COUNT, SERIES_MAX_COUNT);
  const interval = intIn(input.interval_s, "interval_s", SERIES_INTERVAL_S, SERIES_INTERVAL_S, SERIES_INTERVAL_S);
  const device = await env.DB.prepare("SELECT 1 AS x FROM push_subscriptions WHERE member_id = ? LIMIT 1").bind(member).first();
  if (!device) throw new DomainError("no_subscription", "Máy này chưa bật thông báo.", 409);
  const row = await env.DB.prepare(
    `INSERT INTO push_test_series (member_id, count, interval_s, status)
     SELECT ?, ?, ?, 'running' WHERE NOT EXISTS (
       SELECT 1 FROM push_test_series WHERE member_id = ? AND status IN ('pending', 'running'))
     RETURNING id`,
  )
    .bind(member, count, interval, member)
    .first<{ id: number }>();
  if (!row) throw new DomainError("series_running", "Đang có một lượt gửi thử chưa xong.", 409);
  return { id: row.id, member, count, interval_s: interval };
}

/**
 * Gửi lượt thử: chờ 10 giây rồi tin 1, sau đó cứ `interval_s` giây một tin. Trước mỗi tin đọc lại trạng thái
 * (đã huỷ thì dừng) và máy của người hẹn (máy bị push service báo 404/410 đã bị xoá ở tin trước).
 */
export async function runTestSeries(env: Env, series: TestSeries, vapid: VapidKeys, sleep: Sleep = realSleep): Promise<void> {
  const { id, member, count, interval_s } = series;
  for (let i = 1; i <= count; i++) {
    await sleep((i === 1 ? SERIES_FIRST_DELAY_S : interval_s) * 1000);
    const row = await env.DB.prepare("SELECT status FROM push_test_series WHERE id = ?").bind(id).first<{ status: string }>();
    if (row?.status !== "running") return; // đã huỷ
    const subs = await env.DB.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE member_id = ? ORDER BY id").bind(member).all<SubscriptionRow>();
    if (!subs.results?.length) break;
    const payload = {
      title: "Thử khi tắt app",
      body: `Tin ${i}/${count} — thấy tin này khi app đã tắt là thông báo chạy tốt.`,
      url: "/#settings",
      tag: `test-series-${id}-${i}`, // tag khác nhau để iOS không gộp các tin làm một
    };
    for (const sub of subs.results) {
      const r = await sendPush(env, sub, payload, vapid, { ttl: SERIES_TTL, urgency: "high" });
      if (!r.ok) console.error(`[push] test-series ${id} tin ${i} #${sub.id}: ${r.error}`);
    }
    await env.DB.prepare("UPDATE push_test_series SET sent = ? WHERE id = ?").bind(i, id).run();
  }
  await env.DB.prepare("UPDATE push_test_series SET status = 'done' WHERE id = ? AND status = 'running'").bind(id).run();
}

/** Huỷ lượt gửi thử đang chạy của người đang đăng nhập; lượt dừng trước tin kế tiếp. */
export async function cancelTestSeries(env: Env, memberId: string | null): Promise<{ cancelled: number }> {
  const member = requireMember(memberId);
  const r = await env.DB.prepare("UPDATE push_test_series SET status = 'cancelled' WHERE member_id = ? AND status IN ('pending', 'running')").bind(member).run();
  return { cancelled: r.meta.changes ?? 0 };
}

/** Mỗi lượt cron: lượt còn 'pending'/'running' quá 10 phút là đã chết (lượt thật xong trong ~20 giây) → 'cancelled'. */
export async function cancelStaleTestSeries(env: Env, now: Date): Promise<void> {
  await env.DB.prepare("UPDATE push_test_series SET status = 'cancelled' WHERE status IN ('pending', 'running') AND created_at < ?")
    .bind(sqliteDateTime(new Date(now.getTime() - SERIES_STALE_MS)))
    .run();
}
