import { Hono } from "hono";
import type { AppEnv } from "../env";
import { DomainError } from "../domain/types";
import { blockedFor, clientIp, recordFailure } from "../services/auth-throttle";
import { ingestLog, parseWebhookPayload, recordIngestError } from "../services/ingest";
import { getSecret, loadSepayConnections } from "../services/secrets";
import { safeEqual } from "../services/passwords";
import { handleZaloUpdate } from "../services/zalo";

// POST /webhooks/sepay — phase 04. Một địa chỉ cho mọi kết nối SePay (ADR-75): khoá gửi kèm cho biết kết nối nào.
// POST /webhooks/zalo — tin nhắn gửi tới bot Zalo của nhà (ADR-80), xác thực bằng khoá webhook Zalo.
// Hai đường dùng chung bộ đếm khoá sai theo IP (ADR-89): quá ngưỡng thì 429 ngay, trước khi đọc khoá nào từ D1.
export const webhooks = new Hono<AppEnv>();

webhooks.post("/sepay", async (c) => {
  const header = c.req.header("Authorization") ?? "";
  const provided = header.startsWith("Apikey ") ? header.slice("Apikey ".length) : "";
  const now = new Date();
  const ip = clientIp(c.req.header("CF-Connecting-IP"));
  let connectionId: string | null = null;
  try {
    if ((await blockedFor(c.env.DB, "webhook", ip, now)) > 0) return c.json({ success: false }, 429);
    // So hết mọi kết nối đang bật, không dừng sớm khi trùng — thời gian trả lời không lộ khoá nào khớp.
    for (const conn of await loadSepayConnections(c.env, { activeOnly: true })) {
      if (conn.webhookKey && provided && safeEqual(provided, conn.webhookKey) && connectionId === null) connectionId = conn.id;
    }
    if (connectionId === null) {
      await recordFailure(c.env.DB, "webhook", ip, now);
      return c.json({ success: false }, 401);
    }
  } catch {
    return c.json({ success: false }, 503); // D1 trục trặc: để SePay gửi lại
  }

  // SePay yêu cầu HTTP 200/201 với đúng body {"success":true} trong 30s, nếu không sẽ gửi lại tối đa 8 lần (~33 phút).
  // - Payload hỏng: gửi lại vô ích → trả success, nhưng ghi lại để tin sáng báo (không mất lặng lẽ).
  // - Lỗi tạm thời (D1 trục trặc…): trả lỗi để SePay tự gửi lại; ghi log là idempotent nên gửi lại an toàn.
  // Không bao giờ log payload hay số tài khoản ra console.
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    payload = null;
  }
  const ref = payload && typeof payload === "object" && "id" in payload ? String((payload as { id: unknown }).id) : "khong-co-id";
  let parsed;
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new DomainError("invalid_payload", "Payload không phải object JSON.");
    parsed = parseWebhookPayload(payload as Record<string, unknown>);
  } catch (err) {
    await recordIngestError(c.env.DB, "webhook", ref, err instanceof Error ? err.message : "unknown", now).catch(() => {});
    return c.json({ success: true }, 200);
  }
  try {
    await ingestLog(c.env.DB, parsed, "webhook", now, connectionId);
  } catch (err) {
    console.error("[webhooks/sepay] lỗi tạm thời, để SePay gửi lại:", err instanceof Error ? err.message : "unknown");
    return c.json({ success: false }, 503);
  }
  return c.json({ success: true }, 200);
});

webhooks.post("/zalo", async (c) => {
  const provided = c.req.header("X-Bot-Api-Secret-Token") ?? "";
  const now = new Date();
  const ip = clientIp(c.req.header("CF-Connecting-IP"));
  try {
    if ((await blockedFor(c.env.DB, "webhook", ip, now)) > 0) return c.json({ ok: false }, 429);
    const secret = await getSecret(c.env, "zalo_webhook_secret");
    if (!secret || !provided || !safeEqual(provided, secret)) {
      await recordFailure(c.env.DB, "webhook", ip, now);
      return c.json({ ok: false }, 401);
    }
  } catch {
    return c.json({ ok: false }, 503); // D1 trục trặc: chưa xác thực được
  }

  // Zalo cần 2xx thật nhanh. Đã xác thực thì luôn trả 200: payload hỏng hay lỗi khi xử lý chỉ ghi log (không kèm nội dung tin).
  let payload: unknown = null;
  try {
    payload = await c.req.json();
  } catch {
    payload = null;
  }
  try {
    await handleZaloUpdate(c.env, payload, now);
  } catch (err) {
    console.error("[webhooks/zalo]", err instanceof Error ? err.message : "unknown");
  }
  return c.json({ ok: true }, 200);
});
