import { Hono } from "hono";
import type { AppEnv } from "../env";
import { revokeAllGrants } from "../oauth/server";
import { recordChange } from "../services/audit";
import { clientIp } from "../services/auth-throttle";
import { checkLogin } from "../services/member-login";
import { clearSession, issueSession, readSession, requireAuth, revokeAllSessions, tooManyAttempts, wrongPasswordResponse } from "./auth";

export const session = new Hono<AppEnv>();

// Màn đăng nhập cần danh sách người để chọn — chỉ tên, không có số liệu nào.
session.get("/members", async (c) => {
  const res = await c.env.DB.prepare("SELECT id, name FROM members WHERE active = 1 ORDER BY role = 'owner' DESC, name").all();
  return c.json({ ok: true, data: res.results });
});

session.get("/", async (c) => {
  const memberId = await readSession(c);
  const member = memberId
    ? await c.env.DB.prepare("SELECT id, name FROM members WHERE id = ? AND active = 1").bind(memberId).first()
    : null;
  return c.json({ ok: true, data: { member } });
});

/**
 * Đăng nhập (UC-501), luật ở services/member-login.ts: đang bị chặn dò → 429 (ADR-89); chưa thiết lập nhà → 409;
 * sai mật khẩu → 401; đúng mà người lạ → 400. Thông báo lỗi không cho biết người đó có mật khẩu riêng hay không.
 */
session.post("/", async (c) => {
  const body = await c.req.json<{ password?: unknown; member_id?: unknown }>().catch(() => ({}) as Record<string, unknown>);
  const password = typeof body.password === "string" ? body.password : "";
  const memberId = typeof body.member_id === "string" ? body.member_id : "";
  const result = await checkLogin(c.env.DB, c.env.APP_PASSWORD, clientIp(c.req.header("CF-Connecting-IP")), memberId, password, new Date());
  if (result.ok) {
    await issueSession(c, result.member.id, result.member.mode, result.member.sessionGen);
    return c.json({ ok: true, data: { member: { id: result.member.id, name: result.member.name } } });
  }
  switch (result.reason) {
    case "too_many_attempts":
      return tooManyAttempts(c, result.retryAfter);
    case "setup_required":
      return c.json({ ok: false, error: { code: "setup_required", message: "Nhà chưa thiết lập — mở app để thiết lập lần đầu." } }, 409);
    case "wrong_password":
      return wrongPasswordResponse(c);
    case "unknown_member":
      return c.json({ ok: false, error: { code: "unknown_member", message: "Chọn người dùng." } }, 400);
  }
});

session.delete("/", (c) => {
  clearSession(c);
  return c.json({ ok: true, data: null });
});

// Đăng xuất mọi máy (mất điện thoại, lộ cookie): cần phiên hoặc API token; mọi cookie đã phát — kể cả máy đang bấm — hết hiệu lực,
// và mọi kết nối Claude của cả nhà bị gỡ (UC-601 AC-10). Ghi nhật ký và báo cả nhà (ADR-90): kẻ cầm cookie bấm thì người nhà cũng biết.
session.post("/revoke-all", requireAuth, async (c) => {
  await revokeAllSessions(c.env.DB);
  await revokeAllGrants(c.env, new URL(c.req.url).origin);
  await recordChange(c, "session.revoke_all", null, null, { what: "đăng xuất mọi máy và gỡ mọi kết nối Claude" });
  clearSession(c);
  return c.json({ ok: true, data: null });
});
