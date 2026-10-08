import { Hono } from "hono";
import type { AppEnv } from "../env";

export const health = new Hono<AppEnv>();

// Không cần đăng nhập: chỉ trả phiên bản schema, dùng để biết Worker và D1 đã nối được với nhau.
health.get("/", async (c) => {
  const row = await c.env.DB.prepare("SELECT v FROM config WHERE k = 'schema_version'").first<{ v: string }>();
  if (!row) return c.json({ ok: false, error: { code: "db_not_migrated", message: "Chưa chạy migration D1." } }, 503);
  return c.json({ ok: true, db: `v${row.v}` });
});
