// Bộ dựng cho test OAuth / MCP (UC-601): KV giả trong bộ nhớ (get / put có hạn + metadata / delete / list theo prefix,
// cursor, limit — trả metadata), ExecutionContext giả (resource server gán ctx.props / ctx.auth), tài liệu Client ID
// Metadata Document của Claude giả qua fetch, và luồng nối đầy đủ: đăng nhập → đồng ý → đổi mã lấy token (PKCE).
import { vi } from "vitest";
import type { Env } from "../../src/env";
import { app } from "../../src/index";

type Entry = { value: string; expiresAt?: number; metadata?: unknown };

/** KV giả: đủ những gì @cloudflare/workers-oauth-provider dùng. */
export class MemoryKV {
  readonly data = new Map<string, Entry>();

  #live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (e?.expiresAt !== undefined && e.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  async get(key: string, opts?: "text" | "json" | { type?: "text" | "json" }): Promise<unknown> {
    const e = this.#live(key);
    if (!e) return null;
    const type = typeof opts === "string" ? opts : opts?.type;
    return type === "json" ? JSON.parse(e.value) : e.value;
  }

  async put(key: string, value: string, opts?: { expirationTtl?: number; expiration?: number; metadata?: unknown }): Promise<void> {
    if (opts?.expirationTtl !== undefined && opts.expirationTtl < 60) throw new Error(`KV: expirationTtl ${opts.expirationTtl} < 60`);
    const expiresAt = opts?.expirationTtl !== undefined ? Date.now() + opts.expirationTtl * 1000 : opts?.expiration !== undefined ? opts.expiration * 1000 : undefined;
    this.data.set(key, { value, expiresAt, metadata: opts?.metadata });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(opts: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const keys = [...this.data.keys()].filter((k) => k.startsWith(opts.prefix ?? "") && this.#live(k)).sort();
    const after = opts.cursor ? keys.filter((k) => k > opts.cursor!) : keys;
    const page = after.slice(0, opts.limit ?? 1000);
    const complete = page.length === after.length;
    return {
      keys: page.map((name) => {
        const metadata = this.data.get(name)!.metadata;
        return metadata === undefined ? { name } : { name, metadata };
      }),
      list_complete: complete,
      ...(complete ? {} : { cursor: page[page.length - 1] }),
    };
  }

  /** Số khoá theo prefix (đếm lượt ghi đã để lại trong KV). */
  count(prefix = ""): number {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix)).length;
  }
}

/** ExecutionContext giả, mới cho mỗi request: việc sau trả lời (waitUntil) chạy luôn, lỗi bỏ qua. */
export const ctxStub = (): ExecutionContext =>
  ({
    waitUntil: (p: Promise<unknown>) => void p.catch(() => {}),
    passThroughOnException: () => {},
    props: {},
  }) as unknown as ExecutionContext;

/** Gọi app như Worker thật: kèm env và ExecutionContext. */
export const send = (env: Env, path: string, init: RequestInit = {}) => app.request(path, init, env, ctxStub());

export const ORIGIN = "http://localhost";
export const RESOURCE = `${ORIGIN}/mcp`;
export const CLAUDE_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
export const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
/** Client chạy trên máy (redirect về localhost), tên tự khai có HTML. */
export const LOCAL_ID = "https://tool.example/oauth/client.json";
export const LOCAL_REDIRECT = "http://127.0.0.1:33418/callback";

const documents: Record<string, Record<string, unknown>> = {
  [CLAUDE_ID]: {
    client_id: CLAUDE_ID,
    client_name: "Claude",
    redirect_uris: [CLAUDE_REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
  [LOCAL_ID]: {
    client_id: LOCAL_ID,
    client_name: 'Công cụ <img src=x onerror="alert(1)">',
    redirect_uris: [LOCAL_REDIRECT],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
};

/** fetch ra ngoài chỉ tới tài liệu CIMD đã biết; địa chỉ khác → 404. Trả mock để test đếm lượt tải. */
export function stubClientMetadata() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const doc = documents[url];
    return doc ? Response.json(doc) : new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export function authorizePath(opts: { challenge?: string; clientId?: string; redirectUri?: string; state?: string; scope?: string }) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId ?? CLAUDE_ID,
    redirect_uri: opts.redirectUri ?? CLAUDE_REDIRECT,
    scope: opts.scope ?? "mcp:read",
    state: opts.state ?? "trang-thai-1",
    resource: RESOURCE,
  });
  if (opts.challenge) {
    q.set("code_challenge", opts.challenge);
    q.set("code_challenge_method", "S256");
  }
  return `/oauth/authorize?${q}`;
}

/** Cookie `tên=giá trị` đầu tiên có tên bắt đầu bằng `prefix` trong Set-Cookie của phản hồi. */
export const cookieOf = (res: Response, prefix: string) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.startsWith(prefix)) ?? "";

export async function loginCookie(env: Env, memberId: string, password: string): Promise<string> {
  const res = await send(env, "/v1/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ member_id: memberId, password }) });
  if (res.status !== 200) throw new Error(`đăng nhập ${memberId}: ${res.status}`);
  return cookieOf(res, "pf_session=");
}

export const handleOf = (html: string) => /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? "";

export const form = (fields: [string, string][]) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

export async function exchangeCode(env: Env, code: string, verifier: string) {
  const res = await send(env, "/oauth/token", {
    ...form([
      ["grant_type", "authorization_code"],
      ["code", code],
      ["redirect_uri", CLAUDE_REDIRECT],
      ["client_id", CLAUDE_ID],
      ["code_verifier", verifier],
      ["resource", RESOURCE],
    ]),
  });
  return { status: res.status, json: (await res.json()) as { access_token: string; refresh_token: string; scope: string; error?: string } };
}

export async function refresh(env: Env, refreshToken: string) {
  const res = await send(env, "/oauth/token", {
    ...form([
      ["grant_type", "refresh_token"],
      ["refresh_token", refreshToken],
      ["client_id", CLAUDE_ID],
    ]),
  });
  return { status: res.status, json: (await res.json()) as { access_token?: string; error?: string } };
}

/**
 * Nối Claude cho một người như ngoài đời: đăng nhập app (cookie phiên) → mở trang uỷ quyền → bấm Cho phép (có / không tick
 * Ghi) → đổi mã lấy token bằng PKCE. Trả token và grantId (token có dạng `<memberId>:<grantId>:<bí mật>`).
 */
export async function connectClaude(env: Env, opts: { memberId: string; password: string; write?: boolean }) {
  const cookie = await loginCookie(env, opts.memberId, opts.password);
  const { verifier, challenge } = await pkce();
  const path = authorizePath({ challenge });
  const page = await send(env, path, { headers: { Cookie: cookie } });
  if (page.status !== 200) throw new Error(`trang uỷ quyền: ${page.status}`);
  const consentCookie = cookieOf(page, "__Host-oauth-consent");
  const fields: [string, string][] = [
    ["step", "consent"],
    ["handle", handleOf(await page.text())],
    ["scope", "mcp:read"],
    ["decision", "approve"],
  ];
  if (opts.write !== false) fields.push(["scope", "mcp:write"]);
  const approve = form(fields);
  const approved = await send(env, path, { ...approve, headers: { ...approve.headers, Cookie: `${cookie}; ${consentCookie}` } });
  const location = approved.headers.get("Location");
  if (approved.status !== 302 || !location) throw new Error(`đồng ý: ${approved.status}`);
  const code = new URL(location).searchParams.get("code")!;
  const { json } = await exchangeCode(env, code, verifier);
  return { access: json.access_token, refresh: json.refresh_token, scope: json.scope, grantId: json.access_token.split(":")[1]! };
}

export type JsonRpc = { jsonrpc: "2.0"; id: number; method: string; params?: Record<string, unknown> };

/** POST /mcp kèm Bearer token. */
export const mcpPost = (env: Env, token: string, body: unknown, headers: Record<string, string> = {}) =>
  send(env, "/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });

export const toolCall = (name: string, args: Record<string, unknown> = {}, id = 1): JsonRpc => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});
