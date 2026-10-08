// Khoá kết nối ngoài (SePay, Telegram, Zalo). Đặt được từ màn Cài đặt (lưu trong D1) để cả nhà cấu hình bằng điện thoại;
// `wrangler secret` vẫn dùng được làm phương án dự phòng. Không bao giờ trả nguyên khoá ra ngoài.
// SePay: mỗi tài khoản công ty SePay là một kết nối (bảng sepay_connections — ADR-75); Telegram, Zalo: khoá trong config.

import { DEFAULT_SEPAY_CONNECTION_ID } from "../domain/system-ids";
import type { Env } from "../env";

export const SECRET_NAMES = ["telegram_bot_token", "zalo_bot_token", "zalo_webhook_secret"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

const ENV_FALLBACK: Record<SecretName, keyof Env> = {
  telegram_bot_token: "TG_BOT_TOKEN",
  zalo_bot_token: "ZALO_BOT_TOKEN",
  zalo_webhook_secret: "ZALO_WEBHOOK_SECRET",
};

const configKey = (name: SecretName) => `secret:${name}`;

export interface SecretInfo {
  set: boolean;
  hint: string | null;
  source: "app" | "server" | null;
}

/**
 * Chỉ cho biết đã đặt chưa, 2 ký tự cuối, và khoá nằm ở đâu — "app" (đặt từ màn Cài đặt, xoá được từ đó) hay
 * "server" (`wrangler secret`, chỉ thay được bằng cách đặt khoá mới ở app hoặc sửa trên Cloudflare).
 * Gợi ý không bao giờ quá 25% khoá (ADR-90): khoá ngắn nhất nhận được dài 8 ký tự; ngắn hơn (khoá server cũ) thì chỉ "••".
 */
function describeValue(fromApp: string | null | undefined, fallback: string | undefined): SecretInfo {
  const value = fromApp || fallback || "";
  return {
    set: value.length > 0,
    hint: value.length >= 8 ? value.slice(-2) : value ? "••" : null,
    source: fromApp ? "app" : value ? "server" : null,
  };
}

/** Giá trị đang dùng: đặt ở màn Cài đặt thì dùng nó, không thì lấy từ `wrangler secret`. Rỗng = chưa cấu hình. */
export async function getSecret(env: Env, name: SecretName): Promise<string> {
  const row = await env.DB.prepare("SELECT v FROM config WHERE k = ?").bind(configKey(name)).first<{ v: string }>();
  return row?.v || (env[ENV_FALLBACK[name]] as string | undefined) || "";
}

export async function describeSecret(env: Env, name: SecretName): Promise<SecretInfo> {
  const row = await env.DB.prepare("SELECT v FROM config WHERE k = ?").bind(configKey(name)).first<{ v: string }>();
  return describeValue(row?.v, env[ENV_FALLBACK[name]] as string | undefined);
}

/** `null` hoặc chuỗi rỗng = xoá (quay về `wrangler secret` nếu có). */
export async function setSecret(env: Env, name: SecretName, value: string | null): Promise<void> {
  const v = value?.trim() ?? "";
  if (v) {
    await env.DB.prepare("INSERT INTO config (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(configKey(name), v).run();
  } else {
    await env.DB.prepare("DELETE FROM config WHERE k = ?").bind(configKey(name)).run();
  }
}

// ── Kết nối SePay ────────────────────────────────────────────────────

/** Một kết nối với khoá đã giải (cột trong D1, hoặc `wrangler secret` cho kết nối mặc định). Chỉ dùng trong server. */
export interface SepayConnection {
  id: string;
  name: string;
  active: boolean;
  apiToken: string;
  webhookKey: string;
  apiTokenInfo: SecretInfo;
  webhookKeyInfo: SecretInfo;
}

type ConnectionRow = { id: string; name: string; api_token: string | null; webhook_key: string | null; active: number };

function resolveConnection(env: Env, r: ConnectionRow): SepayConnection {
  const isDefault = r.id === DEFAULT_SEPAY_CONNECTION_ID;
  const tokenFallback = isDefault ? (env.SEPAY_API_TOKEN as string | undefined) : undefined;
  const keyFallback = isDefault ? (env.SEPAY_API_KEY as string | undefined) : undefined;
  return {
    id: r.id,
    name: r.name,
    active: r.active === 1,
    apiToken: r.api_token || tokenFallback || "",
    webhookKey: r.webhook_key || keyFallback || "",
    apiTokenInfo: describeValue(r.api_token, tokenFallback),
    webhookKeyInfo: describeValue(r.webhook_key, keyFallback),
  };
}

/** Mọi kết nối (hoặc chỉ những kết nối đang bật), một câu SELECT, theo thứ tự tạo. */
export async function loadSepayConnections(env: Env, opts: { activeOnly?: boolean } = {}): Promise<SepayConnection[]> {
  const res = await env.DB.prepare(
    `SELECT id, name, api_token, webhook_key, active FROM sepay_connections${opts.activeOnly ? " WHERE active = 1" : ""} ORDER BY created_at, id`,
  ).all<ConnectionRow>();
  return (res.results ?? []).map((r) => resolveConnection(env, r));
}
