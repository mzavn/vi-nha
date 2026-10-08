import { Hono } from "hono";
import type { AppEnv } from "../env";
import { householdPasswordOk } from "../services/passwords";
import { alreadySetup, createHousehold, isSetUp, parseSetup } from "../services/setup";
import { issueSession, loginBlocked, passwordAccepted, wrongPassword } from "./auth";

// /v1/setup — thiết lập nhà lần đầu (UC-510). Gắn trước requireAuth như /v1/session: lúc này chưa có ai để đăng nhập.
export const setupRoutes = new Hono<AppEnv>();

// Chỉ trả một cờ: nhà đã thiết lập chưa.
setupRoutes.get("/", async (c) => c.json({ ok: true, data: { needed: !(await isSetUp(c.env.DB)) } }));

/**
 * Thứ tự: đang bị chặn dò → 429 (trước khi so); đã thiết lập → 409; sai mật khẩu chung hoặc APP_PASSWORD chưa đặt → 401,
 * tính một lần sai (scope `login`); body lỗi → 400 kèm `field`; xong → 201 chủ hộ + cookie phiên của chủ hộ.
 */
setupRoutes.post("/", async (c) => {
  const now = new Date();
  const blocked = await loginBlocked(c, now);
  if (blocked) return blocked;
  if (await isSetUp(c.env.DB)) throw alreadySetup();
  const body: unknown = await c.req.json().catch(() => null);
  const password = body && typeof body === "object" && "password" in body && typeof body.password === "string" ? body.password : "";
  if (!householdPasswordOk(c.env.APP_PASSWORD, password)) return wrongPassword(c, now, "password");
  await passwordAccepted(c);
  const owner = await createHousehold(c.env.DB, parseSetup(body));
  await issueSession(c, owner.id, owner.mode, 0);
  return c.json({ ok: true, data: { member: { id: owner.id, name: owner.name } } }, 201);
});
