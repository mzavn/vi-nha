import { Hono, type Context } from "hono";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import { afterResponse, recordChange } from "../services/audit";
import * as push from "../services/push";

// /v1/push — thông báo đẩy trên PWA. Mount sau requireAuth; người dùng = c.get("memberId").
export const pushRoutes = new Hono<AppEnv>();

const ok = <T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) => c.json({ ok: true, data }, status);

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new DomainError("invalid_input", "Nội dung gửi lên phải là một object JSON.");
  return data as Record<string, unknown>;
}

pushRoutes.get("/", async (c) => ok(c, await push.getPush(c.env, c.get("memberId"), new URL(c.req.url).origin)));

pushRoutes.post("/subscriptions", async (c) => {
  const r = await push.subscribe(c.env, c.get("memberId"), await body(c), c.req.header("User-Agent") ?? null);
  if (r.added) {
    const device = r.device ?? "máy không rõ";
    await recordChange(c, "push.add", `push:${r.id}`, { member_id: r.memberId, device }, { what: `thêm máy nhận thông báo: ${device}` });
  }
  return ok(c, { id: r.id }, r.created ? 201 : 200);
});

pushRoutes.post("/subscriptions/remove", async (c) => {
  const r = await push.unsubscribe(c.env, await body(c));
  if (r) await recordChange(c, "push.remove", `push:${r.id}`, { member_id: r.memberId, device: r.device });
  return ok(c, { removed: r ? 1 : 0 });
});

pushRoutes.delete("/subscriptions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new DomainError("invalid_input", "id không hợp lệ.");
  const r = await push.removeSubscription(c.env, id);
  await recordChange(c, "push.remove", `push:${r.id}`, { member_id: r.memberId, device: r.device });
  return ok(c, { removed: 1 });
});

pushRoutes.post("/test", async (c) => ok(c, await push.sendTest(c.env, c.get("memberId"), new URL(c.req.url).origin)));

pushRoutes.post("/test-series", async (c) => {
  const vapid = await push.ensureVapid(c.env, new URL(c.req.url).origin);
  const series = await push.createTestSeries(c.env, c.get("memberId"), await body(c));
  await afterResponse(c, push.runTestSeries(c.env, series, vapid));
  return ok(c, { id: series.id, count: series.count, interval_s: series.interval_s }, 201);
});

pushRoutes.post("/test-series/cancel", async (c) => ok(c, await push.cancelTestSeries(c.env, c.get("memberId"))));
