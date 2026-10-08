// UC-601 (mcp): nối Claude bằng OAuth 2.1 thay cho đường dẫn chứa khoá; UC-602 / UC-603 người đã uỷ quyền;
// UC-508 Cài đặt › Claude và ứng dụng AI; UC-503 đường đi vào Worker. Luồng thật: Client ID Metadata Document (fetch giả),
// đăng nhập ở trang uỷ quyền, đồng ý, đổi mã lấy token bằng PKCE, gọi /mcp, thu hồi.
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { hashPassword } from "../src/services/passwords";
import { asD1, openDb } from "./helpers/d1-sqlite";
import {
  authorizePath,
  CLAUDE_ID,
  CLAUDE_REDIRECT,
  connectClaude,
  cookieOf,
  exchangeCode,
  form,
  handleOf,
  LOCAL_ID,
  LOCAL_REDIRECT,
  loginCookie,
  mcpPost,
  MemoryKV,
  pkce,
  refresh,
  RESOURCE,
  send,
  stubClientMetadata,
  toolCall,
} from "./helpers/oauth";

const SHARED = "mat-khau-chung";
const WIFE_PASSWORD = "mat-khau-rieng-cua-vo";
let raw: DatabaseSync;
let kv: MemoryKV;
let env: Env;

beforeEach(() => {
  raw = openDb();
  raw.prepare("UPDATE accounts SET sepay_enabled = 0").run();
  kv = new MemoryKV();
  env = { DB: asD1(raw), OAUTH_KV: kv as unknown as KVNamespace, API_TOKEN: "tok", APP_PASSWORD: SHARED } as Env;
  stubClientMetadata();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const audits = (action: string) => raw.prepare("SELECT member_id, via, target, detail FROM audit_log WHERE action = ? ORDER BY id").all(action);
const txCount = () => (raw.prepare("SELECT COUNT(*) n FROM transactions").get() as { n: number }).n;
const listTools = (token: string) => mcpPost(env, token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
const json = async (res: Response) => JSON.parse(await res.text());
const giveWifePassword = async () => raw.prepare("UPDATE members SET password_hash = ? WHERE id = 'wife'").run(await hashPassword(WIFE_PASSWORD));

describe("UC-601 AC-8: endpoint /mcp, metadata, chỉ CIMD", () => {
  it("gọi /mcp không có token → 401 kèm Bearer challenge trỏ tới metadata của resource", async () => {
    const res = await send(env, "/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    const challenge = res.headers.get("WWW-Authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"');
    expect(challenge).toContain('scope="mcp:read"');
  });

  it("token rác → 401 kèm Bearer challenge, không phải lỗi JSON-RPC", async () => {
    const res = await mcpPost(env, "husband:khong-co:rac", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  it("metadata resource và authorization server đúng origin; chỉ đăng ký bằng Client ID Metadata Document", async () => {
    const prm = await json(await send(env, "/.well-known/oauth-protected-resource/mcp"));
    expect(prm).toMatchObject({ resource: RESOURCE, authorization_servers: ["http://localhost"], scopes_supported: ["mcp:read"] });
    const as = await json(await send(env, "/.well-known/oauth-authorization-server"));
    expect(as).toMatchObject({
      issuer: "http://localhost",
      authorization_endpoint: "http://localhost/oauth/authorize",
      token_endpoint: "http://localhost/oauth/token",
      scopes_supported: ["mcp:read", "mcp:write"],
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
    });
    expect(as.registration_endpoint).toBeUndefined();
  });

  it("không mở Dynamic Client Registration: POST /oauth/register → 404, KV không có gì", async () => {
    const res = await send(env, "/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [CLAUDE_REDIRECT] }) });
    expect(res.status).toBe(404);
    expect(kv.count()).toBe(0);
  });

  it("đường dẫn chứa khoá cũ /mcp/<bất kỳ> → 404 như đường không có; /oauth/, /.well-known/ lạ cũng là 404 JSON", async () => {
    for (const path of ["/mcp/test-mcp-secret-du-dai-de-doan", "/oauth/khong-co", "/.well-known/khong-co"]) {
      const res = await send(env, path, { method: "POST", body: "{}" });
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: { code: "not_found", message: "Không có đường dẫn này." } });
    }
  });
});

describe("UC-601 AC-9: trang uỷ quyền", () => {
  it("nhà chưa thiết lập → trang báo lỗi, không có form", async () => {
    raw.prepare("DELETE FROM config WHERE k = 'setup_done'").run();
    const { challenge } = await pkce();
    const res = await send(env, authorizePath({ challenge }));
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(html).toContain("Nhà chưa thiết lập");
    expect(html).not.toContain("<form");
  });

  it("chưa đăng nhập → form chọn người + mật khẩu POST về chính địa chỉ này; chưa ghi gì vào KV", async () => {
    const { challenge } = await pkce();
    const res = await send(env, authorizePath({ challenge }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<form method="post">');
    expect(html).toContain('<option value="husband">Chồng</option>');
    expect(html).toContain('type="password"');
    expect(kv.count()).toBe(0);
  });

  it("sai mật khẩu → 401, tính vào bộ chặn dò scope login, KV vẫn trống; bị chặn → 429", async () => {
    const { challenge } = await pkce();
    const path = authorizePath({ challenge });
    const wrong = await send(env, path, form([["step", "login"], ["member_id", "husband"], ["password", "sai"]]));
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).toContain("Sai mật khẩu.");
    expect(raw.prepare("SELECT failures FROM auth_failures WHERE scope = 'login' AND ip = 'unknown'").get()).toEqual({ failures: 1 });
    expect(kv.count()).toBe(0);
    raw.prepare("UPDATE auth_failures SET failures = 10 WHERE ip = 'unknown'").run();
    const blocked = await send(env, path, form([["step", "login"], ["member_id", "husband"], ["password", SHARED]]));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await blocked.text()).toContain("Sai mật khẩu quá nhiều lần");
    expect(kv.count()).toBe(0);
  });

  it("người có mật khẩu riêng: mật khẩu chung bị từ chối, mật khẩu riêng vào được (luật UC-501)", async () => {
    await giveWifePassword();
    const { challenge } = await pkce();
    const path = authorizePath({ challenge });
    expect((await send(env, path, form([["step", "login"], ["member_id", "wife"], ["password", SHARED]]))).status).toBe(401);
    expect((await send(env, path, form([["step", "login"], ["member_id", "wife"], ["password", WIFE_PASSWORD]]))).status).toBe(200);
  });

  it("đăng nhập đúng → cookie phiên app + trang đồng ý: tên miền đã xác minh, tên tự khai, nơi nhận token, hai quyền, Ghi tick sẵn", async () => {
    const { challenge } = await pkce();
    const res = await send(env, authorizePath({ challenge }), form([["step", "login"], ["member_id", "husband"], ["password", SHARED]]));
    expect(res.status).toBe(200);
    expect(cookieOf(res, "pf_session=")).not.toBe("");
    expect(cookieOf(res, "__Host-oauth-consent")).not.toBe("");
    const html = await res.text();
    expect(html).toContain("<strong>claude.ai</strong>");
    expect(html).toContain("tên tự khai");
    expect(html).toContain("Gửi quyền truy cập tới</dt><dd>claude.ai</dd>");
    expect(html).toContain("Xem số liệu");
    expect(html).toContain('<input type="checkbox" name="scope" value="mcp:write" checked>');
    expect(html).toContain('name="decision" value="deny"');
    expect(html).not.toContain("localhost");
    // Không cho nhúng khung; form-action cho thêm origin của redirect_uri đã xác thực (không thì trình duyệt chặn bước về Claude).
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https://claude.ai;");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("đã có cookie phiên app → bỏ bước đăng nhập, vào thẳng trang đồng ý", async () => {
    const cookie = await loginCookie(env, "wife", SHARED);
    const { challenge } = await pkce();
    const res = await send(env, authorizePath({ challenge }), { headers: { Cookie: cookie } });
    const html = await res.text();
    expect(html).toContain("Người cho phép</dt><dd>Vợ</dd>");
    expect(handleOf(html)).not.toBe("");
  });

  it("redirect về máy (localhost) → cảnh báo; tên tự khai được escape", async () => {
    const cookie = await loginCookie(env, "husband", SHARED);
    const { challenge } = await pkce();
    const res = await send(env, authorizePath({ challenge, clientId: LOCAL_ID, redirectUri: LOCAL_REDIRECT }), { headers: { Cookie: cookie } });
    const html = await res.text();
    expect(html).toContain("localhost");
    expect(html).toContain("<strong>tool.example</strong>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&#60;img src=x onerror=&#34;alert(1)&#34;&#62;");
    expect(res.headers.get("Content-Security-Policy")).toContain("form-action 'self' http://127.0.0.1:33418;");
  });

  it("client không tải được tài liệu / redirect_uri không đăng ký → báo lỗi tại chỗ, không chuyển hướng", async () => {
    const { challenge } = await pkce();
    const unknown = await send(env, authorizePath({ challenge, clientId: "https://la.example/client.json" }));
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("Location")).toBeNull();
    const badRedirect = await send(env, authorizePath({ challenge, redirectUri: "https://ke-gian.example/cb" }));
    expect(badRedirect.status).toBe(400);
    expect(badRedirect.headers.get("Location")).toBeNull();
  });

  it("thiếu PKCE (client, redirect đã xác thực) → chuyển về ứng dụng với error, state, iss", async () => {
    const res = await send(env, authorizePath({ state: "s-1" }));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("Location")!);
    expect(to.origin + to.pathname).toBe(CLAUDE_REDIRECT);
    expect(to.searchParams.get("error")).toBe("invalid_request");
    expect(to.searchParams.get("state")).toBe("s-1");
    expect(to.searchParams.get("iss")).toBe("http://localhost");
  });

  it("Từ chối → chuyển về ứng dụng với access_denied; không có grant nào", async () => {
    const cookie = await loginCookie(env, "husband", SHARED);
    const { challenge } = await pkce();
    const path = authorizePath({ challenge, state: "s-2" });
    const page = await send(env, path, { headers: { Cookie: cookie } });
    const deny = form([["step", "consent"], ["handle", handleOf(await page.text())], ["decision", "deny"]]);
    const res = await send(env, path, { ...deny, headers: { ...deny.headers, Cookie: `${cookie}; ${cookieOf(page, "__Host-oauth-consent")}` } });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("Location")!);
    expect(to.searchParams.get("error")).toBe("access_denied");
    expect(to.searchParams.get("state")).toBe("s-2");
    expect(kv.count("grant:")).toBe(0);
    expect(audits("mcp.connect")).toEqual([]);
  });

  it("form đồng ý không giả mạo được: thiếu cookie gắn trình duyệt, hay dùng lại handle → trang lỗi, không cấp mã", async () => {
    const cookie = await loginCookie(env, "husband", SHARED);
    const { challenge } = await pkce();
    const path = authorizePath({ challenge });
    const page = await send(env, path, { headers: { Cookie: cookie } });
    const approve = form([["step", "consent"], ["handle", handleOf(await page.text())], ["scope", "mcp:read"], ["decision", "approve"]]);
    const forged = await send(env, path, { ...approve, headers: { ...approve.headers, Cookie: cookie } });
    expect(forged.status).toBe(400);
    expect(forged.headers.get("Location")).toBeNull();
    const bound = { ...approve, headers: { ...approve.headers, Cookie: `${cookie}; ${cookieOf(page, "__Host-oauth-consent")}` } };
    expect((await send(env, path, bound)).status).toBe(302);
    expect((await send(env, path, bound)).status).toBe(400);
  });

  it("Cho phép → mã chuyển về Claude; đổi mã lấy token cần đúng code_verifier (PKCE); nhật ký mcp.connect gắn người uỷ quyền", async () => {
    const cookie = await loginCookie(env, "wife", SHARED);
    const { verifier, challenge } = await pkce();
    const path = authorizePath({ challenge, state: "s-3" });
    const page = await send(env, path, { headers: { Cookie: cookie } });
    const approve = form([["step", "consent"], ["handle", handleOf(await page.text())], ["scope", "mcp:read"], ["scope", "mcp:write"], ["decision", "approve"]]);
    const res = await send(env, path, { ...approve, headers: { ...approve.headers, Cookie: `${cookie}; ${cookieOf(page, "__Host-oauth-consent")}` } });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("Location")!);
    expect(to.origin + to.pathname).toBe(CLAUDE_REDIRECT);
    expect(to.searchParams.get("state")).toBe("s-3");
    const code = to.searchParams.get("code")!;
    expect((await exchangeCode(env, code, "sai-verifier-sai-verifier-sai-verifier-123")).status).toBe(400);
    const ok = await exchangeCode(env, code, verifier);
    expect(ok.status).toBe(200);
    expect(ok.json.scope.split(" ").sort()).toEqual(["mcp:read", "mcp:write"]);
    expect(ok.json.access_token.startsWith("wife:")).toBe(true);
    expect(audits("mcp.connect")).toEqual([
      { member_id: "wife", via: "session", target: "client:claude.ai", detail: JSON.stringify({ member_id: "wife", scopes: ["mcp:read", "mcp:write"] }) },
    ]);
  });
});

describe("UC-601 AC-6, AC-11: quyền xem / ghi", () => {
  it("token chỉ Xem: initialize, tools/list (16 tool) và tool đọc chạy", async () => {
    const { access, scope } = await connectClaude(env, { memberId: "husband", password: SHARED, write: false });
    expect(scope).toBe("mcp:read");
    const init = await mcpPost(env, access, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(init.status).toBe(200);
    const list = await json(await listTools(access));
    expect(list.result.tools).toHaveLength(16);
    expect((await mcpPost(env, access, toolCall("get_snapshot"))).status).toBe(200);
  });

  it("token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì", async () => {
    const { access } = await connectClaude(env, { memberId: "husband", password: SHARED, write: false });
    for (const [name, args] of [
      ["add_transaction", { meaning: "spend", amount: 200_000, category_id: "fuel-parking" }],
      ["assign_log", { log_id: "L1", splits: [{ meaning: "spend", amount: 1 }] }],
      ["allocate_income", { income_tx_id: 1 }],
      ["add_tenant_shared_expense", { tenant_id: "t", amount: 1, category_id: "groceries" }],
    ] as const) {
      const res = await mcpPost(env, access, toolCall(name, args));
      expect(res.status, name).toBe(403);
      const challenge = res.headers.get("WWW-Authenticate") ?? "";
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toContain('scope="mcp:read mcp:write"');
      expect(challenge).toContain('resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"');
    }
    expect(txCount()).toBe(0);
  });

  it("lô JSON-RPC (mảng) có một tool ghi cũng bị 403 cả lô", async () => {
    const { access } = await connectClaude(env, { memberId: "husband", password: SHARED, write: false });
    const res = await mcpPost(env, access, [toolCall("get_goals", {}, 1), toolCall("add_transaction", { meaning: "spend", amount: 1000, category_id: "groceries" }, 2)]);
    expect(res.status).toBe(403);
    expect(txCount()).toBe(0);
  });

  it("token có Ghi → tool ghi chạy", async () => {
    const { access } = await connectClaude(env, { memberId: "husband", password: SHARED });
    const res = await mcpPost(env, access, toolCall("add_transaction", { meaning: "spend", amount: 200_000, category_id: "fuel-parking" }));
    expect(res.status).toBe(200);
    expect((await json(res)).result.isError).toBeFalsy();
    expect(txCount()).toBe(1);
  });
});

describe("UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền", () => {
  it("get_snapshot như trên app của người đó: ví private của người khác bị ẩn", async () => {
    raw.prepare("UPDATE wallets SET private = 1 WHERE id = 'fun-wife'").run();
    raw.prepare(
      "INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, week_key, month_key, source) VALUES (date('now'), 700000, 'fund', 'fun-wife', 'income', '2026-W40', strftime('%Y-%m', 'now'), 'system')",
    ).run();
    const balance = async (memberId: string) => {
      const { access } = await connectClaude(env, { memberId, password: SHARED, write: false });
      const res = await json(await mcpPost(env, access, toolCall("get_snapshot")));
      const blocks = res.result.content as { text: string }[];
      return (JSON.parse(blocks[blocks.length - 1]!.text) as { wallets: { id: string; balance: number | null }[] }).wallets.find((w) => w.id === "fun-wife")?.balance;
    };
    expect(await balance("husband")).toBeNull();
    expect(await balance("wife")).toBe(700_000);
  });

  it("add_transaction không gửi by_member_id → người ghi là người uỷ quyền; nhật ký via=mcp kèm người đó", async () => {
    const { access } = await connectClaude(env, { memberId: "wife", password: SHARED });
    const res = await json(await mcpPost(env, access, toolCall("add_transaction", { meaning: "spend", amount: 200_000, category_id: "fuel-parking" })));
    const blocks = res.result.content as { text: string }[];
    const tx = JSON.parse(blocks[blocks.length - 1]!.text).tx as { id: number; by_member_id: string; account_id: string };
    expect(tx).toMatchObject({ by_member_id: "wife", account_id: "cash-wife" });
    expect(audits("tx.create")).toEqual([{ member_id: "wife", via: "mcp", target: `tx:${tx.id}`, detail: JSON.stringify({ meaning: "spend", by_member_id: "wife" }) }]);
  });

  it("by_member_id gửi kèm phải là thành viên đang hoạt động", async () => {
    raw.prepare("UPDATE members SET active = 0 WHERE id = 'wife'").run();
    const { access } = await connectClaude(env, { memberId: "husband", password: SHARED });
    const res = await json(await mcpPost(env, access, toolCall("add_transaction", { meaning: "spend", amount: 1000, category_id: "groceries", by_member_id: "wife" })));
    expect(res.result.isError).toBe(true);
    expect(txCount()).toBe(0);
  });

  it("assign_log ghi người làm là người uỷ quyền, nhật ký via=mcp", async () => {
    raw
      .prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES ('L9', '2026-10-01T09:00:00.000Z', 50000, 'out', 'vcb-husband', 'CHI', 'pending')")
      .run();
    const { access } = await connectClaude(env, { memberId: "wife", password: SHARED });
    const res = await json(await mcpPost(env, access, toolCall("assign_log", { log_id: "L9", splits: [{ meaning: "spend", amount: 50_000, category_id: "groceries" }] })));
    expect(res.result.isError).toBeFalsy();
    expect(raw.prepare("SELECT by_member_id FROM transactions WHERE log_id = 'L9'").all()).toEqual([{ by_member_id: "wife" }]);
    expect(audits("log.assign")).toMatchObject([{ member_id: "wife", via: "mcp", target: "log:L9" }]);
  });
});

describe("UC-601 AC-10: gỡ kết nối khi quyền vào đổi", () => {
  it("refresh token chạy được khi grant còn", async () => {
    const { refresh: rt } = await connectClaude(env, { memberId: "husband", password: SHARED });
    const res = await refresh(env, rt);
    expect(res.status).toBe(200);
    expect((await listTools(res.json.access_token!)).status).toBe(200);
  });

  it("đổi mật khẩu riêng → mọi kết nối của người đó bị gỡ: /mcp 401, refresh chết", async () => {
    const wife = await connectClaude(env, { memberId: "wife", password: SHARED });
    const husband = await connectClaude(env, { memberId: "husband", password: SHARED });
    const res = await send(env, "/v1/settings/members/wife/password", {
      method: "PUT",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ password: WIFE_PASSWORD, household_password: SHARED }),
    });
    expect(res.status).toBe(200);
    expect((await listTools(wife.access)).status).toBe(401);
    expect((await refresh(env, wife.refresh)).status).toBe(400);
    expect((await listTools(husband.access)).status).toBe(200);
  });

  it("tắt người → kết nối của người đó bị gỡ", async () => {
    const wife = await connectClaude(env, { memberId: "wife", password: SHARED });
    const res = await send(env, "/v1/settings/members/wife", { method: "PATCH", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
    expect(res.status).toBe(200);
    expect((await listTools(wife.access)).status).toBe(401);
    expect((await refresh(env, wife.refresh)).status).toBe(400);
  });

  it("Đăng xuất mọi máy → kết nối Claude của cả nhà bị gỡ", async () => {
    const wife = await connectClaude(env, { memberId: "wife", password: SHARED });
    const husband = await connectClaude(env, { memberId: "husband", password: SHARED });
    const res = await send(env, "/v1/session/revoke-all", { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" } });
    expect(res.status).toBe(200);
    for (const c of [wife, husband]) {
      expect((await listTools(c.access)).status).toBe(401);
      expect((await refresh(env, c.refresh)).status).toBe(400);
    }
    expect(kv.count("grant:")).toBe(0);
  });

  it("đổi APP_PASSWORD → kết nối uỷ quyền bằng mật khẩu chung hết hiệu lực (401 + grant bị thu hồi); mật khẩu riêng vẫn chạy", async () => {
    await giveWifePassword();
    const wife = await connectClaude(env, { memberId: "wife", password: WIFE_PASSWORD });
    const husband = await connectClaude(env, { memberId: "husband", password: SHARED });
    env = { ...env, APP_PASSWORD: "mat-khau-chung-moi" };
    const res = await listTools(husband.access);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^Bearer /);
    expect((await refresh(env, husband.refresh)).status).toBe(400);
    expect((await listTools(wife.access)).status).toBe(200);
  });

  it("lớp phòng hậu: session_gen lệch (KV chưa kịp gỡ) → 401 kèm Bearer challenge và grant bị thu hồi để refresh không hồi sinh", async () => {
    const wife = await connectClaude(env, { memberId: "wife", password: SHARED });
    raw.prepare("UPDATE members SET session_gen = session_gen + 1 WHERE id = 'wife'").run();
    const res = await listTools(wife.access);
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
    expect((await refresh(env, wife.refresh)).status).toBe(400);
  });

  it("lớp phòng hậu: người đã đặt mật khẩu riêng mà token vào bằng mật khẩu chung → 401", async () => {
    const wife = await connectClaude(env, { memberId: "wife", password: SHARED });
    raw.prepare("UPDATE members SET password_hash = 'x' WHERE id = 'wife'").run();
    expect((await listTools(wife.access)).status).toBe(401);
  });
});

describe("UC-508: Cài đặt › Claude và ứng dụng AI", () => {
  const authed = { Authorization: "Bearer tok", "Content-Type": "application/json" };

  it("cần đăng nhập", async () => {
    expect((await send(env, "/v1/settings/mcp")).status).toBe(401);
    expect((await send(env, "/v1/settings/mcp/wife/abc", { method: "DELETE" })).status).toBe(401);
  });

  it("GET trả địa chỉ MCP và danh sách kết nối (ứng dụng, của ai, quyền, ngày nối) — không có token, mã, khoá", async () => {
    const wife = await connectClaude(env, { memberId: "wife", password: SHARED, write: false });
    const res = await send(env, "/v1/settings/mcp", { headers: authed });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      data: {
        endpoint: "http://localhost/mcp",
        connections: [
          {
            grantId: wife.grantId,
            memberId: "wife",
            memberName: "Vợ",
            clientName: "Claude",
            clientDomain: "claude.ai",
            redirectHost: "claude.ai",
            scopes: ["mcp:read"],
            createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
          },
        ],
      },
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(wife.access.split(":")[2]!);
    expect(text).not.toContain(wife.refresh.split(":")[2]!);
    const settings = JSON.stringify(await (await send(env, "/v1/settings", { headers: authed })).json());
    expect(settings).not.toContain(wife.grantId);
  });

  it("Gỡ một kết nối → token hết hiệu lực, refresh chết; nhật ký mcp.revoke; kết nối khác còn nguyên", async () => {
    const wife = await connectClaude(env, { memberId: "wife", password: SHARED });
    const husband = await connectClaude(env, { memberId: "husband", password: SHARED });
    const res = await send(env, `/v1/settings/mcp/wife/${wife.grantId}`, { method: "DELETE", headers: authed });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { revoked: true } });
    expect((await listTools(wife.access)).status).toBe(401);
    expect((await refresh(env, wife.refresh)).status).toBe(400);
    expect((await listTools(husband.access)).status).toBe(200);
    expect(audits("mcp.revoke")).toEqual([
      { member_id: "husband", via: "token", target: "client:claude.ai", detail: JSON.stringify({ member_id: "wife", grant_id: wife.grantId }) },
    ]);
  });

  it("gỡ kết nối không có → 404", async () => {
    const res = await send(env, "/v1/settings/mcp/wife/khong-co", { method: "DELETE", headers: authed });
    expect(res.status).toBe(404);
  });
});

describe("UC-503: header bảo mật trên đường OAuth / MCP", () => {
  it("token endpoint, metadata, /mcp mang CSP và chặn nhúng khung như mọi phản hồi của Worker", async () => {
    for (const res of [
      await send(env, "/.well-known/oauth-authorization-server"),
      await send(env, "/.well-known/oauth-protected-resource/mcp"),
      await send(env, "/mcp", { method: "POST" }),
      await send(env, "/oauth/token", form([["grant_type", "authorization_code"], ["code", "x"], ["client_id", CLAUDE_ID]])),
    ]) {
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Content-Security-Policy")).toContain("form-action 'self';");
    }
  });
});
