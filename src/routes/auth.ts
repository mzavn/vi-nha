import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env } from "../env";
import { blockedFor, clearFailures, clientIp } from "../services/auth-throttle";
import { recordWrongPassword, tooManyAttemptsMessage } from "../services/member-login";
import { b64url, safeEqual } from "../services/passwords";

export const SESSION_COOKIE = "pf_session";
const SESSION_DAYS = 30;

/** Cách vào của phiên: `h` = mật khẩu chung của nhà, `p` = mật khẩu riêng của người đó (UC-501 AC-15). */
export type SessionMode = "h" | "p";

const enc = new TextEncoder();

/** Khoá ký phiên ngẫu nhiên app tự sinh lần đầu cần (UC-501 AC-14); nằm trong D1, không API nào trả ra. */
const SESSION_KEY = "secret:session_key";
const SIGNING_SQL = `SELECT (SELECT v FROM config WHERE k = '${SESSION_KEY}') AS key,
  COALESCE((SELECT v FROM config WHERE k = 'session_epoch'), '0') AS epoch`;
type Signing = { key: string | null; epoch: string };

// Phiên riêng ký bằng session_key; phiên chung trộn thêm APP_PASSWORD vào khoá → đổi mật khẩu chung là mọi phiên chung cũ
// hết hiệu lực, phiên riêng vẫn còn. Thế hệ phiên (`session_epoch`, "Đăng xuất mọi máy" — ADR-89) luôn trộn vào khoá.
async function sign(env: Env, s: { key: string; epoch: string }, mode: SessionMode, payload: string): Promise<string> {
  const secret = `session:${s.key}:${s.epoch}${mode === "h" ? `:${env.APP_PASSWORD}` : ""}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload))));
}

/**
 * Cookie `<member_id>.<cách vào>.<session_gen>.<hạn>.<chữ ký>`: member_id đứng đầu (có thể chứa dấu chấm), các phần sau
 * không bao giờ có dấu chấm. Không mang băm hay mật khẩu nào. `gen` = members.session_gen lúc phát.
 */
export async function issueSession(c: Context<AppEnv>, memberId: string, mode: SessionMode, gen: number) {
  const db = c.env.DB;
  // INSERT OR IGNORE rồi đọc lại: hai lần đăng nhập đầu cùng lúc dùng cùng một khoá.
  await db.prepare("INSERT OR IGNORE INTO config (k, v) VALUES (?, ?)").bind(SESSION_KEY, b64url(crypto.getRandomValues(new Uint8Array(32)))).run();
  const signing = (await db.prepare(SIGNING_SQL).first<Signing>())!;
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400;
  const payload = `${memberId}.${mode}.${gen}.${exp}`;
  setCookie(c, SESSION_COOKIE, `${payload}.${await sign(c.env, { key: signing.key!, epoch: signing.epoch }, mode, payload)}`, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

/** Đăng xuất mọi máy: tăng thế hệ phiên → mọi cookie đã phát (mọi người, mọi máy) hết hiệu lực. API_TOKEN không đổi. */
export async function revokeAllSessions(db: D1Database): Promise<void> {
  await db
    .prepare("INSERT INTO config (k, v) VALUES ('session_epoch', '1') ON CONFLICT (k) DO UPDATE SET v = CAST(v AS INTEGER) + 1")
    .run();
}

export const clearSession = (c: Context<AppEnv>) => deleteCookie(c, SESSION_COOKIE, { path: "/" });

/**
 * Trả member_id nếu cookie hợp lệ, chưa hết hạn, người đó còn hoạt động, `session_gen` khớp và cách vào đúng cách người đó
 * đang dùng (có mật khẩu riêng thì cookie chung bị từ chối). Một câu SELECT đọc cả người lẫn khoá ký.
 */
export async function readSession(c: Context<AppEnv>): Promise<string | null> {
  const raw = getCookie(c, SESSION_COOKIE);
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 5) return null;
  const [sig, exp, gen, mode] = [parts.pop()!, parts.pop()!, parts.pop()!, parts.pop()!];
  const memberId = parts.join(".");
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000 || !/^\d+$/.test(gen) || (mode !== "h" && mode !== "p")) return null;
  const row = await c.env.DB.prepare(
    `SELECT m.session_gen AS gen, m.password_hash IS NOT NULL AS private, s.key, s.epoch
     FROM members m, (${SIGNING_SQL}) s WHERE m.id = ? AND m.active = 1`,
  )
    .bind(memberId)
    .first<Signing & { gen: number; private: number }>();
  if (!row?.key || String(row.gen) !== gen || mode !== (row.private ? "p" : "h")) return null;
  if (mode === "h" && !c.env.APP_PASSWORD) return null;
  return safeEqual(sig, await sign(c.env, { key: row.key, epoch: row.epoch }, mode, `${memberId}.${mode}.${gen}.${exp}`)) ? memberId : null;
}

const unauthorized = (c: Context<AppEnv>) =>
  c.json({ ok: false, error: { code: "unauthorized", message: "Cần đăng nhập." } }, 401);

/** Bị chặn dò đăng nhập (scope `login`, ADR-89) thì trả 429 — gọi TRƯỚC khi so mật khẩu; null = được thử. */
export async function loginBlocked(c: Context<AppEnv>, now: Date): Promise<Response | null> {
  const wait = await blockedFor(c.env.DB, "login", clientIp(c.req.header("CF-Connecting-IP")), now);
  if (wait <= 0) return null;
  return tooManyAttempts(c, wait);
}

/** 429 kèm Retry-After (giây). */
export function tooManyAttempts(c: Context<AppEnv>, wait: number): Response {
  c.header("Retry-After", String(wait));
  return c.json({ ok: false, error: { code: "too_many_attempts", message: tooManyAttemptsMessage(wait) } }, 429);
}

/** 401 "Sai mật khẩu." — lần sai đã được ghi vào bộ chặn dò. */
export const wrongPasswordResponse = (c: Context<AppEnv>, field?: string) =>
  c.json({ ok: false, error: { code: "wrong_password", message: "Sai mật khẩu.", ...(field ? { field } : {}) } }, 401);

/** Sai mật khẩu (thiết lập, đổi mật khẩu riêng): ghi một lần sai vào bộ chặn dò, chậm một nhịp, 401. */
export async function wrongPassword(c: Context<AppEnv>, now: Date, field?: string): Promise<Response> {
  await recordWrongPassword(c.env.DB, clientIp(c.req.header("CF-Connecting-IP")), now);
  return wrongPasswordResponse(c, field);
}

/** Đúng mật khẩu: xoá đếm sai của IP này. */
export const passwordAccepted = (c: Context<AppEnv>) => clearFailures(c.env.DB, "login", clientIp(c.req.header("CF-Connecting-IP")));

/** /v1/*: cookie đăng nhập của PWA, hoặc `Authorization: Bearer <API_TOKEN>` cho script / n8n. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  if (header) {
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    // API_TOKEN chưa cấu hình thì khoá hẳn, không mở cửa cho token rỗng.
    if (!c.env.API_TOKEN || !token || !safeEqual(token, c.env.API_TOKEN)) return unauthorized(c);
    const asked = c.req.header("X-Member-Id");
    const member = asked
      ? await c.env.DB.prepare("SELECT id FROM members WHERE id = ? AND active = 1").bind(asked).first<{ id: string }>()
      : await c.env.DB.prepare("SELECT id FROM members WHERE active = 1 ORDER BY role = 'owner' DESC, id LIMIT 1").first<{ id: string }>();
    if (asked && !member) return c.json({ ok: false, error: { code: "unknown_member", message: "X-Member-Id không hợp lệ." } }, 400);
    c.set("memberId", member?.id ?? null);
    c.set("via", "token");
    return next();
  }

  // readSession đã kiểm người còn hoạt động trong cùng câu đọc khoá ký.
  const memberId = await readSession(c);
  if (!memberId) return unauthorized(c);
  // Cookie đi kèm mọi request cùng site: ghi dữ liệu phải là JSON để form của trang khác không giả mạo được.
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !(c.req.header("Content-Type") ?? "").startsWith("application/json")) {
    return c.json({ ok: false, error: { code: "json_required", message: "Yêu cầu ghi phải gửi JSON." } }, 415);
  }
  c.set("memberId", memberId);
  c.set("via", "session");
  return next();
};
