// OAuth 2.1 cho Claude (UC-601, ADR nháp "MCP dùng OAuth"): một Worker vừa là authorization server vừa là resource
// server `/mcp`, thư viện @cloudflare/workers-oauth-provider, lưu trong KV `OAUTH_KV`. Issuer và resource lấy theo origin
// của chính bản cài (mỗi nhà một tên miền), dựng một lần cho mỗi origin. Client chỉ đăng ký bằng Client ID Metadata
// Document — không mở Dynamic Client Registration (endpoint công khai ghi KV sẽ bị spam làm cạn hạn mức Free).

import { OAuthAuthorizationServer, OAuthResourceServer, type GrantSummary, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../env";
import { mcpHandler } from "../routes/mcp";
import { b64url, safeEqual } from "../services/passwords";

export const SCOPE_READ = "mcp:read";
export const SCOPE_WRITE = "mcp:write";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const TOKEN_PATH = "/oauth/token";
export const MCP_PATH = "/mcp";

const ACCESS_TOKEN_TTL = 60 * 60;
/** Refresh token trượt: 60 ngày không dùng mới hết — ~2 lượt ghi KV / giờ / kết nối khi đang dùng. */
const REFRESH_IDLE_TTL = 60 * 86_400;

/** `props` của grant (mã hoá trong KV): ai uỷ quyền, lúc phiên ở thế hệ nào, vào bằng mật khẩu nào. */
export interface GrantProps {
  memberId: string;
  sessionGen: number;
  /** `h` = mật khẩu chung, `p` = mật khẩu riêng — như cookie phiên. */
  mode: "h" | "p";
  /** Chỉ cách vào `h`: HMAC có khoá là `APP_PASSWORD` — đổi mật khẩu chung là dấu lệch. */
  sharedStamp: string | null;
}

/** `metadata` của grant (không mã hoá): thư viện chỉ trả `clientId` khi liệt kê, nên lưu sẵn để màn Cài đặt hiện. */
export interface GrantMetadata {
  clientName: string;
  clientDomain: string | null;
  redirectHost: string;
}

const enc = new TextEncoder();

/** Dấu mật khẩu chung của một người: HMAC-SHA256(khoá = APP_PASSWORD), không phải băm trơn của mật khẩu. */
export async function sharedStamp(appPassword: string, memberId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(appPassword), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`mcp-grant:${memberId}`))));
}

/**
 * Lớp phòng hậu cho mỗi lần gọi `/mcp` (UC-601 AC-10): người còn hoạt động, `session_gen` khớp, cách vào vẫn đúng cách
 * người đó đang dùng, và (mật khẩu chung) dấu vẫn khớp `APP_PASSWORD` hiện tại.
 */
async function grantStillValid(env: Env, props: GrantProps): Promise<boolean> {
  const row = await env.DB.prepare("SELECT session_gen AS gen, password_hash IS NOT NULL AS private FROM members WHERE id = ? AND active = 1")
    .bind(props.memberId)
    .first<{ gen: number; private: number }>();
  if (!row || row.gen !== props.sessionGen || props.mode !== (row.private ? "p" : "h")) return false;
  if (props.mode === "p") return true;
  return Boolean(env.APP_PASSWORD) && typeof props.sharedStamp === "string" && safeEqual(props.sharedStamp, await sharedStamp(env.APP_PASSWORD, props.memberId));
}

interface Servers {
  auth: OAuthAuthorizationServer<Env>;
  resource: OAuthResourceServer<Env, GrantProps>;
}
const byOrigin = new Map<string, Servers>();

/** Authorization server + resource server `/mcp` của một origin (`https://<host>`; `http` chỉ cho localhost). */
export function oauthServers(origin: string): Servers {
  const cached = byOrigin.get(origin);
  if (cached) return cached;
  const resourceUrl = `${origin}${MCP_PATH}`;
  const auth = new OAuthAuthorizationServer<Env>({
    issuer: origin,
    resources: [resourceUrl],
    authorizeEndpoint: AUTHORIZE_PATH,
    tokenEndpoint: TOKEN_PATH,
    scopesSupported: [SCOPE_READ, SCOPE_WRITE],
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: ACCESS_TOKEN_TTL,
    refreshTokenTTL: REFRESH_IDLE_TTL,
    refreshTokenIdleTTL: REFRESH_IDLE_TTL,
  });
  const resource = new OAuthResourceServer<Env, GrantProps>({
    resourceMetadata: { resource: resourceUrl, authorization_servers: [origin], resource_name: "Ví nhà" },
    requiredScopes: [SCOPE_READ],
    // Token hợp lệ nhưng lệch (đổi / gỡ mật khẩu, tắt người, đổi mật khẩu chung) → 401 kèm Bearer challenge, và thu hồi
    // grant để refresh token không hồi sinh kết nối. Token có dạng `<userId>:<grantId>:<bí mật>`.
    validateToken: (env) => async (res, token) => {
      const validated = await auth.validateToken<GrantProps>(res, token, env);
      if (!validated) return null;
      if (validated.props.memberId === validated.userId && (await grantStillValid(env, validated.props))) return validated;
      await auth.getOAuthApi(env).revokeGrant(token.split(":")[1]!, validated.userId);
      return null;
    },
    handler: mcpHandler,
  });
  const servers = { auth, resource };
  byOrigin.set(origin, servers);
  return servers;
}

export const oauthApi = (env: Env, origin: string): OAuthHelpers => oauthServers(origin).auth.getOAuthApi(env);

/** Mọi grant của một người (đủ các trang). */
export async function listMemberGrants(api: OAuthHelpers, memberId: string): Promise<GrantSummary[]> {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listUserGrants(memberId, cursor ? { cursor } : undefined);
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return grants;
}

/** Gỡ mọi kết nối Claude của một người (đổi / gỡ mật khẩu riêng, tắt người): grant cùng token của nó, refresh chết theo. */
export async function revokeMemberGrants(env: Env, origin: string, memberId: string): Promise<void> {
  const api = oauthApi(env, origin);
  for (const grant of await listMemberGrants(api, memberId)) await api.revokeGrant(grant.id, memberId);
}

/** Đăng xuất mọi máy (ADR-89): gỡ kết nối Claude của cả nhà, kể cả người đã tắt. */
export async function revokeAllGrants(env: Env, origin: string): Promise<void> {
  const members = await env.DB.prepare("SELECT id FROM members").all<{ id: string }>();
  for (const m of members.results) await revokeMemberGrants(env, origin, m.id);
}
