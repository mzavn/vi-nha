// Đường OAuth của bản cài (UC-601 AC-8, AC-9): trang uỷ quyền `/oauth/authorize` là của app (đăng nhập bằng mật khẩu
// của app rồi hỏi đồng ý), còn metadata, `/oauth/token` (đổi mã, refresh, thu hồi) và `/mcp` là của thư viện.
// Mount trước requireAuth. Không có `/oauth/register` (không mở Dynamic Client Registration) → 404 như đường không có.

import { AuthorizationError, CimdFetchError, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { issueSession, readSession } from "../routes/auth";
import { recordChange } from "../services/audit";
import { clientIp } from "../services/auth-throttle";
import { checkLogin, tooManyAttemptsMessage } from "../services/member-login";
import { isSetUp } from "../services/setup";
import { oauthApi, oauthServers, SCOPE_READ, SCOPE_WRITE, sharedStamp, type GrantMetadata, type GrantProps } from "./server";

const originOf = (c: Context<AppEnv>) => new URL(c.req.url).origin;

/** ExecutionContext của Worker cho thư viện: Hono khai kiểu rút gọn của nó, lúc chạy đây chính là ctx Worker nhận. */
const workerCtx = (c: Context<AppEnv>) => c.executionCtx as unknown as ExecutionContext;

/** Escape cho cả nội dung lẫn thuộc tính HTML — tên ứng dụng, tên miền đến từ tài liệu do client tự khai. */
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Chuyển hướng dựng bằng `new Response` — header của `Response.redirect()` không sửa được (securityHeaders cần gắn). */
const redirect = (headers: HeadersInit) => new Response(null, { status: 302, headers });

const NO_STORE = { "Cache-Control": "no-store" };

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Ví nhà</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;650&amp;display=swap">
<link rel="stylesheet" href="/oauth.css">
</head>
<body>
<main class="card">
${body}
</main>
</body>
</html>`;
}

const banner = (kind: "bad" | "warn", text: string) => `<p class="banner ${kind}" role="alert">${esc(text)}</p>`;

function errorPage(c: Context<AppEnv>, status: 400 | 401 | 409, message: string): Response {
  return c.html(page("Không nối được", `<h1>Không nối được ứng dụng</h1>\n${banner("bad", message)}\n<p class="note">Quay lại ứng dụng và bấm nối lại.</p>`), status, NO_STORE);
}

/** Form đăng nhập (UC-501): form POST về chính địa chỉ này, giữ nguyên query của yêu cầu uỷ quyền. */
async function loginPage(c: Context<AppEnv>, status: 200 | 400 | 401 | 429, error?: string): Promise<Response> {
  const members = await c.env.DB.prepare("SELECT id, name FROM members WHERE active = 1 ORDER BY role = 'owner' DESC, name").all<{ id: string; name: string }>();
  const options = members.results.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
  const body = `<h1>Đăng nhập để nối ứng dụng</h1>
<p class="sub">Một ứng dụng AI muốn dùng sổ của nhà. Đăng nhập bằng mật khẩu của Ví nhà, bước sau mới chọn quyền.</p>
${error ? banner("bad", error) : ""}
<form method="post">
<input type="hidden" name="step" value="login">
<label class="field">Người dùng<select name="member_id" required>${options}</select></label>
<label class="field">Mật khẩu<input type="password" name="password" autocomplete="current-password" required></label>
<button class="primary" type="submit">Đăng nhập</button>
</form>`;
  return c.html(page("Đăng nhập", body), status, NO_STORE);
}

/**
 * Trang đồng ý (UC-601 AC-9): tên miền đã xác minh của ứng dụng (CIMD) nổi bật, tên tự khai, nơi nhận token, cảnh báo
 * localhost, hai quyền — Xem (bắt buộc) và Ghi (tick sẵn, bỏ được). Chỉ tới đây (sau đăng nhập) mới ghi KV: `beginConsent`
 * lưu yêu cầu phía server, form chỉ mang handle dùng một lần, gắn với trình duyệt bằng cookie `__Host-`.
 */
async function consentPage(c: Context<AppEnv>, request: AuthRequest, memberId: string): Promise<Response> {
  const api = oauthApi(c.env, originOf(c));
  const details = await api.describeConsent(request);
  const member = await c.env.DB.prepare("SELECT name FROM members WHERE id = ?").bind(memberId).first<{ name: string }>();
  const consent = await api.beginConsent(request);
  const name = esc(details.clientName);
  const domain = details.clientDomain
    ? `<p class="domain"><strong>${esc(details.clientDomain)}</strong><span>tên miền đã xác minh của ứng dụng</span></p>`
    : banner("warn", "Ứng dụng này không có tên miền đã xác minh — tên bên dưới do nó tự khai.");
  const loopback = details.redirectIsLoopback
    ? banner("warn", "Quyền sẽ được gửi tới một chương trình trên chính máy này (localhost). Chỉ cho phép nếu vừa bấm nối từ chương trình đó.")
    : "";
  const body = `<h1>Cho ${name} dùng sổ của nhà?</h1>
${domain}
<dl class="facts">
<dt>Tên ứng dụng (tên tự khai)</dt><dd>${name}</dd>
<dt>Gửi quyền truy cập tới</dt><dd>${esc(details.redirectHost)}</dd>
<dt>Người cho phép</dt><dd>${esc(member?.name ?? memberId)}</dd>
</dl>
${loopback}
<form method="post">
<input type="hidden" name="step" value="consent">
<input type="hidden" name="handle" value="${esc(consent.handle)}">
<fieldset class="scopes">
<legend>Quyền</legend>
<input type="hidden" name="scope" value="${SCOPE_READ}">
<label class="scope"><input type="checkbox" checked disabled><span><b>Xem số liệu</b><small>Còn để chi, ngân sách, giao dịch, sổ nợ — bắt buộc</small></span></label>
<label class="scope"><input type="checkbox" name="scope" value="${SCOPE_WRITE}" checked><span><b>Ghi giao dịch, gán, chia tiền</b><small>Bỏ chọn nếu chỉ muốn hỏi số liệu</small></span></label>
</fieldset>
<button class="primary" type="submit" name="decision" value="approve">Cho phép</button>
<button class="secondary" type="submit" name="decision" value="deny">Từ chối</button>
</form>
<p class="note">Gỡ kết nối bất cứ lúc nào ở Cài đặt › Claude và ứng dụng AI.</p>`;
  return c.html(page(`Cho phép ${details.clientName}`, body), { status: 200, headers: consent.headers });
}

/**
 * Kiểm yêu cầu uỷ quyền theo bảng "Errors: redirect or render?" của thư viện: chỉ chuyển về ứng dụng khi client và
 * redirect_uri đã được xác thực, còn lại hiện lỗi tại chỗ. Hợp lệ → origin của redirect_uri vào CSP `form-action`.
 */
async function parseRequest(c: Context<AppEnv>): Promise<AuthRequest | Response> {
  try {
    const request = await oauthApi(c.env, originOf(c)).parseAuthRequest(c.req.raw);
    c.set("formActionOrigin", new URL(request.redirectUri).origin);
    return request;
  } catch (err) {
    if (err instanceof AuthorizationError) return err.redirectTo ? redirect({ Location: err.redirectTo, ...NO_STORE }) : errorPage(c, 400, "Yêu cầu nối không hợp lệ.");
    if (err instanceof CimdFetchError) return errorPage(c, 400, "Không xác minh được ứng dụng: không tải được thông tin của nó. Thử lại sau.");
    throw err;
  }
}

/** Đồng ý / Từ chối. Yêu cầu uỷ quyền lấy từ KV (theo handle), không từ form. */
async function decide(c: Context<AppEnv>, form: FormData): Promise<Response> {
  const api = oauthApi(c.env, originOf(c));
  const handle = String(form.get("handle") ?? "");
  try {
    if (form.get("decision") !== "approve") return redirect((await api.denyConsent(c.req.raw, handle)).headers);
    const memberId = await readSession(c);
    if (!memberId) return errorPage(c, 401, "Phiên đăng nhập đã hết.");
    const scope = form.getAll("scope").includes(SCOPE_WRITE) ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ];
    const approved = await api.approveConsent(c.req.raw, handle, { scope });
    // readSession đã kiểm người còn hoạt động và cách vào của cookie khớp cách người đó đang dùng.
    const member = (await c.env.DB.prepare("SELECT session_gen, password_hash IS NOT NULL AS private FROM members WHERE id = ?")
      .bind(memberId)
      .first<{ session_gen: number; private: number }>())!;
    const mode = member.private ? "p" : "h";
    const props: GrantProps = { memberId, sessionGen: member.session_gen, mode, sharedStamp: mode === "h" ? await sharedStamp(c.env.APP_PASSWORD, memberId) : null };
    const details = await api.describeConsent(approved.request);
    const metadata: GrantMetadata = { clientName: details.clientName, clientDomain: details.clientDomain ?? null, redirectHost: details.redirectHost };
    const { redirectTo } = await api.completeAuthorization({ request: approved.request, userId: memberId, metadata, scope: approved.request.scope, props });
    // Trang này ngoài requireAuth: đặt người làm trước khi ghi nhật ký; báo cả nhà như khi đổi kênh nhận tin (ADR-90).
    c.set("memberId", memberId);
    c.set("via", "session");
    const label = metadata.clientDomain ?? metadata.clientName;
    const rights = approved.request.scope.includes(SCOPE_WRITE) ? "xem và ghi" : "chỉ xem";
    await recordChange(c, "mcp.connect", `client:${label}`, { member_id: memberId, scopes: approved.request.scope }, { what: `nối ${label} vào sổ (${rights})` });
    approved.headers.set("Location", redirectTo);
    return redirect(approved.headers);
  } catch (err) {
    if (err instanceof AuthorizationError || err instanceof CimdFetchError) return errorPage(c, 400, "Trang cho phép đã hết hạn, đã dùng, hoặc mở ở trình duyệt khác.");
    throw err;
  }
}

export const oauthRoutes = new Hono<AppEnv>();

oauthRoutes.get("/authorize", async (c) => {
  if (!(await isSetUp(c.env.DB))) return errorPage(c, 409, "Nhà chưa thiết lập — mở app để thiết lập lần đầu.");
  const request = await parseRequest(c);
  if (request instanceof Response) return request;
  // Đã đăng nhập app trên trình duyệt này thì bỏ bước đăng nhập.
  const memberId = await readSession(c);
  return memberId ? consentPage(c, request, memberId) : loginPage(c, 200);
});

oauthRoutes.post("/authorize", async (c) => {
  const form = await c.req.raw.formData().catch(() => null);
  if (!form) return errorPage(c, 400, "Yêu cầu nối không hợp lệ.");
  if (form.get("step") === "consent") return decide(c, form);
  const request = await parseRequest(c);
  if (request instanceof Response) return request;
  const memberId = String(form.get("member_id") ?? "");
  const password = String(form.get("password") ?? "");
  const result = await checkLogin(c.env.DB, c.env.APP_PASSWORD, clientIp(c.req.header("CF-Connecting-IP")), memberId, password, new Date());
  if (result.ok) {
    // Cookie phiên app như đăng nhập thường: lần nối sau trên trình duyệt này bỏ bước đăng nhập.
    await issueSession(c, result.member.id, result.member.mode, result.member.sessionGen);
    return consentPage(c, request, result.member.id);
  }
  switch (result.reason) {
    case "too_many_attempts":
      c.header("Retry-After", String(result.retryAfter));
      return loginPage(c, 429, tooManyAttemptsMessage(result.retryAfter));
    case "setup_required":
      return errorPage(c, 409, "Nhà chưa thiết lập — mở app để thiết lập lần đầu.");
    case "wrong_password":
      return loginPage(c, 401, "Sai mật khẩu.");
    case "unknown_member":
      return loginPage(c, 400, "Chọn người dùng.");
  }
});

// Đổi mã lấy token (PKCE), refresh, thu hồi (RFC 7009): của thư viện.
oauthRoutes.all("/token", (c) => oauthServers(originOf(c)).auth.fetch(c.req.raw, c.env, workerCtx(c)));

/** Metadata RFC 8414 của authorization server; mount ở `/.well-known/oauth-authorization-server`. */
export const authorizationServerMetadata = (c: Context<AppEnv>) => oauthServers(originOf(c)).auth.fetch(c.req.raw, c.env, workerCtx(c));

/** `/mcp` và metadata RFC 9728 `/.well-known/oauth-protected-resource/mcp`: resource server của thư viện (401 kèm Bearer challenge khi thiếu token). */
export const mcpResource = (c: Context<AppEnv>) => oauthServers(originOf(c)).resource.fetch(c.req.raw, c.env, workerCtx(c));
