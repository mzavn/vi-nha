# UC-503: Phân quyền theo đường dẫn & không lộ bí mật qua lỗi
- Status: implemented
- BR: BR-09, BR-10
- Decisions: `plans/260921-2228-profit-first-pwa/phase-01-worker-d1.md` bước 4 & 6; commit `a5baefb` (không log path MCP — bỏ từ v8 vì đường dẫn không còn chứa khoá); `plans/reports/redteam-260922-0100-auth-exposure.md` ("CSRF cho phiên cookie", "Routing tĩnh/API"); ADR-95 (`/v1/setup` mở trước đăng nhập, chặn bằng mật khẩu chung); ADR-97 (MCP dùng OAuth 2.1, bỏ đường dẫn chứa khoá)
- Actor: Mọi client HTTP (PWA, script, SePay, Claude và ứng dụng AI qua OAuth, người lạ)
- Trigger: Mọi request tới Worker `vi-nha.example`

## History
- v1 (2026-09-22, commit `a773716`): Worker Hono, `/v1/health`, guard `/v1/*`, static assets + SPA fallback.
- v2 (2026-09-22, commit `b92fc0f`): cookie phiên, bắt JSON cho request ghi bằng cookie.
- v3 (2026-09-22, commit `c6677a8`): mount `/webhooks` và `/mcp` với xác thực riêng.
- v4 (2026-09-22, commit `a5baefb`): `onError` che path `/mcp/<secret>` trước khi log.
- v5 (2026-09-22, commit `c80ae89`): mount `/v1/settings` sau `requireAuth`.
- v6 (2026-10-06, commit `d059eaa`): **header bảo mật** cho mọi phản hồi (red-team 6/10 SC-01, ADV-003; ADR-89, change [`261006-bao-mat-dang-nhap`](../changes/archive/261006-bao-mat-dang-nhap/proposal.md)) — CSP chỉ cho script của app, HSTS, `nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` tắt camera/micro/vị trí/thanh toán/USB, chặn nhúng khung. Worker gắn qua middleware `securityHeaders`; app shell do Static Assets phục vụ thẳng đọc `web/public/_headers` (cùng giá trị). Đã chạy thử với `wrangler dev` + Chromium 390px / 1280px: `/`, `/hom-nay` (SPA fallback), `/sw.js`, `/assets/*`, `/v1/*` đều mang header; đăng nhập, Cài đặt, service worker `activated`, font Inter tải được, bật thông báo đẩy được — không có vi phạm CSP nào.
- v7 (2026-10-08, commit `1ed22e1`): `/v1/setup` (thiết lập nhà lần đầu, UC-510) gắn trước `requireAuth` như `/v1/session`; lỗi nghiệp vụ trả thêm `field` khi có. Bước 1, 4 sửa; thêm AC-7 (change [261007-thiet-lap-lan-dau](../changes/archive/261007-thiet-lap-lan-dau/proposal.md))
- v8 (2026-10-08, commit `e5ecf41`): **MCP qua OAuth** (ADR-97) — `/mcp`, `/oauth/*`, `/.well-known/*` vào Worker (`run_worker_first`) và mount trước `requireAuth`: trang uỷ quyền + token (`/oauth`), metadata (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`), `/mcp` đúng đường này; `/mcp/<bất kỳ>` → 404 JSON; `app.notFound` coi thêm `/oauth/`, `/.well-known/` là API; bỏ bước che `/mcp/<secret>` trong log. Trang uỷ quyền: CSP `form-action` thêm origin của `redirect_uri` đã xác thực; redirect dựng bằng `new Response`. Bước 0a mới, bước 1, 5, 6 sửa; thêm E3; AC-3 DEPRECATED; thêm AC-8, AC-9; đóng [OPEN] "`GET /mcp` rơi về SPA" (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md))
- v9 (2026-10-08, commit `934f30f`): CSP thêm `frame-src https://mzavn.gitbook.io` (sau `manifest-src`, trước `frame-ancestors`; chỉ đúng origin của `GUIDE_URL`) để màn Hướng dẫn nhúng GitBook trong app (pwa UC-711 AC-13); `web/public/_headers` khớp; `frame-ancestors 'none'` không đổi. Bước 0 và AC-6 sửa (change [261008-huong-dan-trong-app](../changes/archive/261008-huong-dan-trong-app/proposal.md))

## Preconditions
- `wrangler.jsonc` `assets.run_worker_first` = `["/v1/*", "/webhooks/*", "/mcp", "/mcp/*", "/oauth/*", "/.well-known/*"]` — các đường này luôn vào Worker (SPA không nuốt `/mcp`, trang uỷ quyền hay metadata), mọi path khác phục vụ file tĩnh PWA (`not_found_handling: "single-page-application"`) kèm header từ `public/_headers` (bản build của `web/public/_headers`; file này không được phục vụ ra ngoài). CSS của trang uỷ quyền là file tĩnh `/oauth.css` (ngoài `/oauth/`).

## Main Flow
0. Mọi phản hồi của Worker (kể cả 401/404/415/500 và bản PWA lấy qua `ASSETS.fetch`) mang `SECURITY_HEADERS` (`src/security-headers.ts`, middleware `securityHeaders` đăng ký đầu tiên): `Content-Security-Policy` = `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; worker-src 'self'; manifest-src 'self'; frame-src https://mzavn.gitbook.io; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` (service worker tự fetch Google Fonts để lưu offline nên `connect-src` có hai origin đó; `frame-src` chỉ cho đúng origin của `GUIDE_URL` để màn Hướng dẫn nhúng GitBook — pwa UC-711 AC-13 — còn `frame-ancestors 'none'` giữ nguyên: không ai nhúng được app; không `'unsafe-inline'` — `style={{}}` của Preact đi qua CSSOM), `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `X-Frame-Options: DENY`. App shell, `sw.js`, `/assets/*` (Static Assets phục vụ thẳng, không qua Worker) mang đúng bộ đó từ `_headers`.
0a. Trang uỷ quyền `/oauth/authorize` (mcp UC-601 AC-9): khi yêu cầu uỷ quyền hợp lệ (thư viện OAuth đã xác thực `redirect_uri` với tài liệu của ứng dụng), `form-action` của CSP thêm origin của `redirect_uri` đó (vd `form-action 'self' https://claude.ai`) — bấm Cho phép / Từ chối là form POST rồi chuyển hướng sang ứng dụng, trình duyệt áp `form-action` cho cả bước chuyển; yêu cầu không hợp lệ thì giữ `form-action 'self'`. Mọi chuyển hướng dựng bằng `new Response(null, { status: 302, headers })` để middleware gắn được header (header của `Response.redirect` không sửa được).
1. Worker định tuyến theo thứ tự mount trong `src/index.ts`: `/v1/health` → `/v1/session` → `/v1/setup` (thiết lập nhà lần đầu, UC-510 — lúc đó chưa có ai để đăng nhập) → `/webhooks` → `/oauth` (trang uỷ quyền, đổi mã lấy token) → `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp` (metadata) → `/mcp` (đúng đường này; tự xác thực bằng token OAuth — mcp UC-601) (đều **không** qua `requireAuth`, trừ `POST /v1/session/revoke-all` tự gắn `requireAuth` — UC-501 8b), rồi `app.use("/v1/*", requireAuth)`, rồi `/v1` (`v1.ts`, `logs.ts`) và `/v1/settings`. `/mcp/<bất kỳ>` (đường dẫn chứa khoá cũ) không còn route nào → bước 6.
2. Với `/v1/*` được bảo vệ, `requireAuth` chọn cửa: có header `Authorization` → nhánh token (UC-502); không có → nhánh cookie (UC-501).
3. Nhánh cookie: request không phải `GET`/`HEAD` phải có `Content-Type` bắt đầu bằng `application/json` — chặn form giả mạo từ trang khác (cùng với `SameSite=Lax`).
4. Handler chạy; lỗi nghiệp vụ `DomainError` → JSON `{ ok: false, error: { code, message, field? } }` với `status` của lỗi (`field` chỉ ô lỗi khi có — vd `members.1.name` ở UC-510, `household_password` ở UC-507).
5. Lỗi bất ngờ → log `[METHOD path]` + thông điệp (không đường dẫn nào còn chứa khoá nên log nguyên đường dẫn — bỏ bước che `/mcp/<secret>` từ v8, ADR-97); trả `500 { code: "internal", message: "Lỗi hệ thống. Thử lại sau." }` (không lộ chi tiết).
6. Không có route khớp: path bắt đầu bằng `/v1/`, `/webhooks/`, `/mcp/`, `/oauth/`, `/.well-known/` → `404 { ok: false, error: { code: "not_found", message: "Không có đường dẫn này." } }`; path khác → `ASSETS.fetch` (PWA).

## Alternative Flows
- 2a. Route `/v1/*` không tồn tại: vẫn qua `requireAuth` trước → chưa xác thực nhận 401, đã xác thực nhận 404 JSON.

## Exceptions
- E1. Ghi bằng cookie mà không phải JSON → `415 { code: "json_required", message: "Yêu cầu ghi phải gửi JSON." }`.
- E2. Chưa xác thực → 401 `unauthorized` (UC-501/502).
- E3. App cài trên iPhone (màn hình chính) có kho cookie riêng: Claude mở trang uỷ quyền bằng trình duyệt thường nên không thấy phiên của app → phải đăng nhập (chọn người + mật khẩu) ở trang uỷ quyền (mcp UC-601 AC-9).

## Acceptance Criteria
### AC-1: Chống giả mạo form với phiên cookie
- Given cookie phiên hợp lệ
- When `POST /v1/transactions` với `Content-Type: text/plain`
- Then 415
- Tests: `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › ghi bằng cookie mà không phải JSON thì bị chặn (chống form giả mạo)"

### AC-2: Route API không tồn tại trả JSON 404 sau khi xác thực
- Given token đúng
- When gọi `/v1/wallets` (không có route)
- Then 404 `{ ok: false, error: { code: "not_found" } }`, không rơi về SPA
- Tests: `test/app.test.ts` › "/v1/* cần Bearer token › đúng token → qua cửa (route chưa có nên 404 dạng JSON)"

### AC-3: Lỗi trên `/mcp/<secret>` không bao giờ log secret (DEPRECATED v8 — ADR-97)
- Đường dẫn chứa khoá đã bỏ: `/mcp/<bất kỳ>` → 404 như đường không có (AC-9), log không còn bước che đường dẫn.
- Tests: ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97)

### AC-4: Settings cần đăng nhập như mọi `/v1`
- Given không cookie, không token
- When `GET /v1/settings`
- Then 401
- Tests: `test/settings.test.ts` › "đọc cài đặt › cần đăng nhập"

### AC-5: Lỗi bất ngờ không lộ chi tiết
- Given handler ném lỗi không phải `DomainError`
- When request tới
- Then 500 `internal` với thông điệp chung
- Tests: ⚠ Chưa có test (trước v8 chỉ gián tiếp qua AC-3, nay AC-3 đã bỏ)

### AC-6: Header bảo mật trên API, webhook, app shell — kể cả phản hồi lỗi
- Given Worker với binding `ASSETS` trả trang HTML
- When `GET /v1/health` (200), `GET /v1/wallets` không token (401), `GET /v1/khong-co` có token (404), `POST /webhooks/sepay` không khoá (401), `GET /` (PWA qua `ASSETS.fetch`)
- Then mọi phản hồi mang đủ `SECURITY_HEADERS` (CSP có `script-src 'self';`, `frame-src https://mzavn.gitbook.io;` — chỉ origin GitBook của màn Hướng dẫn — và `frame-ancestors 'none'`); thân trang PWA giữ nguyên; `web/public/_headers` là một luật `/*` với đúng các header và giá trị đó
- Tests: `test/app.test.ts` › "header bảo mật (ADR-89) › API, webhook và app shell qua Worker đều mang CSP, HSTS, nosniff, chặn nhúng khung — kể cả phản hồi lỗi"; "header bảo mật (ADR-89) › web/public/_headers (app shell do Static Assets phục vụ thẳng) giống hệt header Worker gắn"

### AC-7: `/v1/setup` không cần đăng nhập
- Given DB chưa thiết lập, không cookie / token
- When `GET /v1/setup`
- Then 200 `{ needed: true }` — không qua `requireAuth`; `/v1/*` khác vẫn 401
- Tests: [`test/setup.test.ts`](../../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-1: GET /v1/setup không cần đăng nhập — DB chỉ có schema → needed true; có setup_done → needed false, không trả gì khác" · "UC-510 thiết lập nhà lần đầu › AC-7: chưa thiết lập › POST /v1/session → 409 setup_required; /v1/* cần đăng nhập → 401 như hiện nay"

### AC-8: Header bảo mật trên đường OAuth / MCP; trang uỷ quyền cho chuyển về đúng ứng dụng
- Given Worker có KV `OAUTH_KV`; Claude (Client ID Metadata Document, `redirect_uri` `https://claude.ai/api/mcp/auth_callback`)
- When `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource/mcp`, `POST /mcp` không token, `POST /oauth/token` mã sai; đăng nhập đúng ở `/oauth/authorize`
- Then mọi phản hồi mang `X-Frame-Options: DENY` và CSP `form-action 'self';`; trang đồng ý mang `frame-ancestors 'none'`, `form-action 'self' https://claude.ai;` (redirect về máy thì origin `http://127.0.0.1:<cổng>`), `Cache-Control: no-store`
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-503: header bảo mật trên đường OAuth / MCP › token endpoint, metadata, /mcp mang CSP và chặn nhúng khung như mọi phản hồi của Worker"; "UC-601 AC-9: trang uỷ quyền › đăng nhập đúng → cookie phiên app + trang đồng ý: tên miền đã xác minh, tên tự khai, nơi nhận token, hai quyền, Ghi tick sẵn" · "… › redirect về máy (localhost) → cảnh báo; tên tự khai được escape"

### AC-9: Đường dẫn chứa khoá cũ và đường OAuth lạ là 404 JSON, không rơi về SPA
- Given Worker sau v8
- When `POST /mcp/<chuỗi bất kỳ>`, `POST /oauth/khong-co`, `POST /.well-known/khong-co`
- Then 404 `{ ok: false, error: { code: "not_found", message: "Không có đường dẫn này." } }` cho cả ba
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-8: endpoint /mcp, metadata, chỉ CIMD › đường dẫn chứa khoá cũ /mcp/<bất kỳ> → 404 như đường không có; /oauth/, /.well-known/ lạ cũng là 404 JSON"

## Traceability
- Code: `src/index.ts` › `app`, `app.use("*", securityHeaders)`, mount `/oauth`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/mcp`, `app.onError`, `app.notFound` (chép phản hồi `ASSETS.fetch` để gắn header), default export `fetch`/`scheduled`; `src/security-headers.ts` › `SECURITY_HEADERS`, `securityHeaders` (`formActionOrigin`); `src/oauth/routes.ts` › `oauthRoutes` (đặt `formActionOrigin`, redirect bằng `new Response`), `authorizationServerMetadata`, `mcpResource`; `src/env.d.ts` › biến `formActionOrigin`; `src/routes/auth.ts` › `requireAuth`; `src/routes/setup.ts` › `setupRoutes`; `src/domain/types.ts` › `DomainError`
- Cấu hình: `wrangler.jsonc` › `routes` (`vi-nha.example`, `custom_domain`), `workers_dev: false`, `assets.run_worker_first`, `kv_namespaces` (`OAUTH_KV`), `compatibility_flags: ["global_fetch_strictly_public"]`; `web/public/_headers` (Vite chép sang `public/_headers`); `web/public/oauth.css`

## Divergences & Open Questions
- [OPEN] Nhánh token không bắt JSON cho request ghi — hợp lý vì token không tự đính kèm theo trình duyệt, nhưng chưa được ghi thành quyết định ở đâu.
