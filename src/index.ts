import { Hono } from "hono";
import { runScheduled } from "./cron";
import { DomainError } from "./domain/types";
import type { AppEnv, Env } from "./env";
import { authorizationServerMetadata, mcpResource, oauthRoutes } from "./oauth/routes";
import { requireAuth } from "./routes/auth";
import { bookRoutes } from "./routes/books";
import { health } from "./routes/health";
import { logs } from "./routes/logs";
import { pushRoutes } from "./routes/push";
import { rentalRoutes } from "./routes/rental";
import { session } from "./routes/session";
import { settingsRoutes } from "./routes/settings";
import { setupRoutes } from "./routes/setup";
import { v1 } from "./routes/v1";
import { webhooks } from "./routes/webhooks";
import { securityHeaders } from "./security-headers";

const app = new Hono<AppEnv>();

app.use("*", securityHeaders);

// Không cần đăng nhập: kiểm tra sống, màn đăng nhập và thiết lập nhà lần đầu (UC-510).
app.route("/v1/health", health);
app.route("/v1/session", session);
app.route("/v1/setup", setupRoutes);
app.route("/webhooks", webhooks); // xác thực riêng: API key SePay, khoá webhook Zalo
// Claude (MCP) qua OAuth (UC-601): trang uỷ quyền, token, metadata và `/mcp` tự xác thực; `/mcp/<bất kỳ>` → 404.
app.route("/oauth", oauthRoutes);
app.all("/.well-known/oauth-authorization-server", authorizationServerMetadata);
app.all("/.well-known/oauth-protected-resource/mcp", mcpResource);
app.all("/mcp", mcpResource);

app.use("/v1/*", requireAuth);
app.route("/v1", v1);
app.route("/v1", logs);
app.route("/v1", bookRoutes);
app.route("/v1/settings", settingsRoutes);
app.route("/v1/rental", rentalRoutes);
app.route("/v1/push", pushRoutes);

app.onError((err, c) => {
  if (err instanceof DomainError) {
    const field = err.field ? { field: err.field } : {};
    return c.json({ ok: false, error: { code: err.code, message: err.message, ...field } }, err.status as 400);
  }
  console.error(`[${c.req.method} ${new URL(c.req.url).pathname}]`, err instanceof Error ? err.message : err);
  return c.json({ ok: false, error: { code: "internal", message: "Lỗi hệ thống. Thử lại sau." } }, 500);
});

app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  const isApi = ["/v1/", "/webhooks/", "/mcp/", "/oauth/", "/.well-known/"].some((p) => path.startsWith(p));
  if (isApi) return c.json({ ok: false, error: { code: "not_found", message: "Không có đường dẫn này." } }, 404);
  // Phản hồi của fetch() có header bất biến: chép sang Response mới để securityHeaders gắn được.
  return c.env.ASSETS.fetch(c.req.raw).then((res) => new Response(res.body, res));
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(event.cron, env, new Date(event.scheduledTime)));
  },
} satisfies ExportedHandler<Env>;
