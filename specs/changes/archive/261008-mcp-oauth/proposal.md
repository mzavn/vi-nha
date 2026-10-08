# 261008-mcp-oauth: Nối Claude qua OAuth thay cho đường dẫn chứa khoá
- Status: archived
- BR: BR-05, BR-09
- Đụng tới: UC-601, UC-602, UC-603, UC-604, UC-605 (mcp), UC-503, UC-505, UC-508 (access), UC-709 (pwa)
- Đóng: [OPEN] UC-601 "secret chuyển sang header", "chưa chạy với Claude thật", UC-503 "`GET /mcp` rơi về SPA", phần "xác thực bằng header" của [OPEN] ADR-30; [DIVERGENCE] UC-602 "MCP luôn dùng chủ hộ" (xem History các UC)
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-07 / 08 (chọn B; "oke, làm luôn nhé") · Người duyệt kỹ thuật: reviewer agent, 2026-10-08, approve with changes — đã sửa 7 mục
- Commit: propose `5d4cda5` · code `e5ecf41` · merge `—`

## Vì sao

Bước 3 của việc mở mã nguồn (lộ trình: `plans/reports/researcher-261007-mo-ma-nguon.md` §5b, §5c, §7). Chủ nhà chọn phương án B (OAuth) ngày 2026-10-07: "tôi nghĩ làm B đi ?"; "oke, làm luôn nhé" (2026-10-08).

Hiện trạng (kiểm 2026-10-07 / 08):
- Claude nối bằng `https://<host>/mcp/<MCP_SECRET>` (chế độ "No sign-in", `src/routes/mcp.ts:9-16`). Ai có đường dẫn là đọc hết sổ và ghi được (`add_transaction`, `assign_log`, `allocate_income`) mà không cần mật khẩu; đường dẫn dễ lộ qua ảnh chụp, chat chia sẻ.
- Không biết ai làm: tool đọc luôn nhìn như chủ hộ (`src/mcp/tools.ts:47`); `assign_log` ghi người làm rỗng; kiểu `via: "mcp"` có trong nhật ký nhưng không chỗ nào ghi.
- Không thu hồi riêng từng kết nối, không có chế độ chỉ đọc; `MCP_SECRET` do người dùng tự gõ, có thể ngắn; người không biết code không đặt được.
- Gói Free đủ cho OAuth: KV 1.000 lượt ghi / 100.000 lượt đọc mỗi ngày; kiểm token mỗi lần gọi tool là đọc KV + giải mã nhỏ (báo cáo §5c).

## Thay đổi spec

### UC-601 (mcp): Kết nối — viết lại thành "Nối Claude bằng OAuth"
- MODIFIED: endpoint MCP là `https://<host>/mcp` (Streamable HTTP, không giữ phiên như hiện nay), bảo vệ bằng OAuth 2.1 theo chuẩn MCP authorization; thư viện `@cloudflare/workers-oauth-provider` 1.x, lưu trong KV `OAUTH_KV`. Issuer và resource lấy theo origin của chính bản cài (mỗi nhà một tên miền / `*.workers.dev`).
- DEPRECATED AC-1, AC-2, AC-3, AC-5 (đường dẫn chứa khoá, `MCP_SECRET`): bỏ hẳn. `/mcp/<bất kỳ>` → 404 như đường dẫn không có. `MCP_SECRET` không còn được đọc.
- ADDED AC-8: When gọi `/mcp` không có token, Then 401 kèm `WWW-Authenticate: Bearer resource_metadata="<host>/.well-known/oauth-protected-resource/mcp"`; `GET /.well-known/oauth-protected-resource/mcp` và `GET /.well-known/oauth-authorization-server` trả metadata đúng origin; client đăng ký **chỉ bằng Client ID Metadata Document** (Claude web / Desktop / mobile / Code, ChatGPT, Cursor đều dùng cách này); **không mở** Dynamic Client Registration (`POST /oauth/register` → 404) — endpoint công khai ghi KV sẽ bị spam làm cạn 1.000 lượt ghi / ngày của gói Free.
- ADDED AC-9: Trang uỷ quyền `GET /oauth/authorize` (nhà chưa thiết lập → trang báo lỗi như đăng nhập): chưa đăng nhập thì hiện form chọn người + mật khẩu (form POST giữ nguyên query của yêu cầu uỷ quyền) (luật y hệt UC-501: mật khẩu riêng nếu có, không thì mật khẩu chung; bộ chặn dò scope `login`; 429 khi bị chặn); đã đăng nhập (cookie phiên app còn hiệu lực) thì bỏ bước này. Chỉ sau khi đăng nhập xong mới bắt đầu phiên đồng ý của thư viện (ghi KV) — người lạ chưa có mật khẩu không ghi được gì vào KV. Trang đồng ý hiện nổi bật **tên miền đã xác minh của ứng dụng** (CIMD, ví dụ `claude.ai`), tên ứng dụng (escape, ghi rõ 'tên tự khai'), tên miền nhận token, cảnh báo khi là `localhost`, và hai quyền: **Xem số liệu** (`mcp:read`, bắt buộc) và **Ghi giao dịch, gán, chia tiền** (`mcp:write`, được bỏ tick). Đồng ý → chuyển về ứng dụng với mã; Từ chối → `access_denied`. Trang không cho nhúng khung, form không giả mạo được (cookie + handle của thư viện).
- ADDED AC-10: Token mang `member_id` của người đã uỷ quyền, quyền đã chọn, `session_gen` lúc uỷ quyền và cách đăng nhập (chung / riêng; phiên chung kèm dấu HMAC có khoá của `APP_PASSWORD`, không phải băm trơn). Các việc sau **gỡ hết kết nối Claude của người đó** (grant bị thu hồi, refresh token chết theo): đổi / gỡ mật khẩu riêng, tắt người (UC-507); **Đăng xuất mọi máy** gỡ kết nối của **cả nhà** (nút khẩn cấp, ADR-89). Đổi `APP_PASSWORD` → kết nối của người đã uỷ quyền bằng mật khẩu chung hết hiệu lực. Lớp phòng hậu: mỗi lần gọi `/mcp` kiểm `active`, `session_gen`, dấu mật khẩu chung; lệch thì trả 401 kèm Bearer challenge (không phải lỗi JSON-RPC) và thu hồi grant để refresh không hồi sinh. KV lan truyền tối đa 60 giây nên "hết hiệu lực" nghĩa là trong vòng 60 giây.
- MODIFIED AC-6: `initialize` / `tools/list` cần token có `mcp:read`; danh sách 16 tool như cũ.
- ADDED AC-11: Token chỉ có `mcp:read` gọi tool ghi (`add_transaction`, `assign_log`, `allocate_income`, `add_tenant_shared_expense`) → **HTTP 403** `insufficient_scope` với challenge ghi đủ `mcp:read mcp:write` (chuẩn MCP, Claude xin thêm quyền được); không ghi gì. Kiểm ở tầng HTTP trước khi giao cho transport MCP (đọc body JSON-RPC, cả dạng mảng), vì lỗi trong tool luôn bị gói thành 200.

### UC-602, UC-603, UC-604, UC-605 (mcp): Tool
- MODIFIED UC-602: tool đọc nhìn số liệu **như người đã uỷ quyền** (ví `private` của người khác bị ẩn như trên app — UC-504), không còn mặc định chủ hộ.
- MODIFIED UC-603 AC-1, AC-2: `by_member_id` thành **không bắt buộc**, mặc định là người đã uỷ quyền; có gửi thì phải là thành viên đang hoạt động (như hôm nay).
- ADDED (UC-603, UC-604, UC-605): mọi lần ghi qua MCP ghi nhật ký `via = mcp` kèm người đã uỷ quyền; `assign_log` ghi người làm là người đã uỷ quyền.

### UC-508 / UC-709 (Cài đặt › Kết nối › Claude)
- ADDED AC: Cài đặt có mục **Claude và ứng dụng AI**: địa chỉ MCP `https://<host>/mcp` (nút Chép), danh sách kết nối đang có (tên ứng dụng, của ai, quyền, ngày nối), nút **Gỡ** từng kết nối → token của kết nối đó hết hiệu lực trong vòng 60 giây (KV). Tên ứng dụng / tên miền lưu ở `metadata` của grant lúc uỷ quyền (thư viện chỉ trả `clientId` khi liệt kê). Gỡ: `DELETE /v1/settings/mcp/:memberId/:grantId`. Ai đăng nhập cũng gỡ được (thành viên ngang quyền, ADR-96).
- ADDED AC: Nối mới (đồng ý ở trang uỷ quyền) và gỡ kết nối → nhật ký `mcp.connect` / `mcp.revoke` và báo cả nhà như khi đổi kênh nhận tin (ADR-90).
- `GET /v1/settings` không trả token, mã, khoá của kết nối.

### UC-503 (access)
- MODIFIED: `/mcp`, `/oauth/*`, `/.well-known/*` đi vào Worker (`run_worker_first`; SPA không còn nuốt các đường này) và mount trước `requireAuth`; `app.notFound` coi `/oauth/`, `/.well-known/` là API; bỏ phần che `/mcp/<secret>` trong log. Trang `/oauth/authorize` mang header bảo mật như mọi trang, riêng `form-action` cho thêm origin của `redirect_uri` đã được thư viện xác thực (không thì trình duyệt chặn bước chuyển về Claude). Redirect dựng bằng `new Response(null, { status: 302, headers })` (header của `Response.redirect` không sửa được). CSS của trang là file tĩnh ngoài `/oauth/` (ví dụ `/oauth.css`).
- Exceptions: app cài trên iPhone có kho cookie riêng → khi Claude mở trình duyệt thường vẫn phải đăng nhập ở trang uỷ quyền.

### Entity
- KV `OAUTH_KV` (binding mới): client đăng ký, grant, token (thư viện chỉ lưu băm của token / mã; `props` mã hoá).
- `props` của grant: `{ memberId, sessionGen }`; quyền: `mcp:read`, `mcp:write`.

## Quyết định

**ADR nháp — MCP dùng OAuth 2.1 của chuẩn MCP; bỏ đường dẫn chứa khoá** (chủ nhà chọn B, 2026-10-07).
- Loại: (A) giữ khoá trong URL, quản lý trong app — ai có URL vẫn vào được; (C) tắt MCP ở bản public — mất tính năng nổi bật; giữ song song đường dẫn cũ một thời gian — đúng là chỗ lộ cần bịt, nhà mình chỉ cần thêm lại connector một lần.
- Đăng nhập ở trang uỷ quyền dùng chính mật khẩu của app (không thêm nhà cung cấp danh tính ngoài).
- Hệ quả: kết nối Claude hiện tại của nhà mình đứt khi deploy — thêm lại connector với địa chỉ mới, đăng nhập, chọn quyền. `MCP_SECRET` bỏ khỏi danh sách secret. Mỗi nhà cần một KV namespace (nút Deploy tự tạo).

**ADR nháp — Quyền mặc định ở trang đồng ý: Xem + Ghi đều tick, Ghi bỏ tick được.** Nhà mình đang dùng Claude để ghi khoản chi bằng lời; người muốn an toàn bỏ tick Ghi. Loại: mặc định chỉ Xem (thêm một bước cho cách dùng chính).

## Thiết kế

- `npm i @cloudflare/workers-oauth-provider@^1.2`. `authorizeEndpoint: '/oauth/authorize'` tường minh (mặc định của thư viện là `/authorize`). Thời hạn: access token 1 giờ, refresh token trượt (`refreshTokenIdleTTL`, ví dụ 60 ngày không dùng mới hết) — ngân sách KV ~2 lượt ghi / giờ / kết nối khi đang dùng, 6 người vẫn dưới 1.000 / ngày. Binding KV `OAUTH_KV` trong `wrangler.jsonc` (prod: tạo namespace `vi-nha-oauth` trên tài khoản MZA); `compatibility_flags: ["global_fetch_strictly_public"]` (cần cho Client ID Metadata Document).
- `src/oauth/*`: dựng `OAuthAuthorizationServer` + `OAuthResourceServer` (cùng Worker) theo origin của request (cache theo origin); `scopesSupported: ["mcp:read", "mcp:write"]`, `requiredScopes: ["mcp:read"]`; trang `/oauth/authorize` (GET hiện form, POST đăng nhập / đồng ý) dùng `parseAuthRequest`, `describeConsent`, `beginConsent`, `approveConsent`, `denyConsent`, `completeAuthorization` như tài liệu thư viện (`docs/consent-page.md`); xử lý lỗi theo bảng "Errors: redirect or render?" của thư viện. Đăng nhập ở trang này dùng lại hàm so mật khẩu của `src/routes/session.ts` (tách ra service dùng chung) và bộ chặn dò.
- `/oauth/authorize` ngoài `requireAuth` → đặt `memberId`, `via` trước khi ghi nhật ký `mcp.connect`. `setMemberPassword`, `updateMember(active=false)`, `revokeAllSessions` gọi thu hồi grant (`listUserGrants` + `revokeGrant`).
- `src/routes/mcp.ts`: handler của resource server; kiểm `active` + `session_gen` + dấu mật khẩu chung của `props`; kiểm `mcp:write` cho tool ghi ở tầng HTTP; truyền `memberId`, quyền vào `registerTools`; tool ghi kiểm `mcp:write` → `insufficientScope`. Bỏ route `/:secret`, bỏ `MCP_SECRET` khỏi `Env`, `.dev.vars.example`, README.
- `src/mcp/tools.ts`: `viewerId` = người uỷ quyền; `by_member_id` tuỳ chọn; ghi nhật ký `via: "mcp"`.
- Cài đặt: `GET /v1/settings/mcp` (danh sách grant: tên client, người, quyền, ngày) và `DELETE /v1/settings/mcp/:grantId` (thu hồi) — dùng API grant của thư viện (`listUserGrants` / `revokeGrant` theo từng thành viên).
- PWA: Cài đặt › mục Claude (địa chỉ, danh sách, Gỡ).
- Test: điều kiện trước — `vi.mock('cloudflare:workers')` trong `setupFiles` (thư viện import `WorkerEntrypoint` ở đầu file); helper gọi `app.request(path, init, env, ctxStub)` vì resource server gán `ctx.props` / `ctx.auth`; KV giả có `get`, `put` (`expirationTtl`, `metadata`), `delete`, `list` (prefix, cursor, limit, trả metadata). Issuer `http://localhost` được thư viện chấp nhận. Luồng OAuth đầy đủ trong `vitest` (đăng ký client → authorize với cookie phiên → đồng ý → đổi mã lấy token (PKCE) → `tools/list` → tool ghi với / không có `mcp:write` → thu hồi → 401); KV giả trong bộ test (Map) nếu harness chưa có.
- Rủi ro: CPU trang uỷ quyền (băm mật khẩu ~5 ms, như đăng nhập); Claude không hỗ trợ một bước nào đó của chuẩn → thử thật với Claude sau deploy, giữ bản sao lưu và version cũ để quay lại (`wrangler rollback`).

**AI làm / người quyết:** AI làm hết; chủ nhà đã chọn B; duyệt hai ADR nháp (cắt hẳn đường dẫn cũ; quyền mặc định); sau deploy thêm lại connector trong Claude.

## Review kỹ thuật
Reviewer agent (subagent `reviewer`, 2026-10-08): khả thi với thư viện 1.2.3 (Claude dùng CIMD, callback `https://claude.ai/api/mcp/auth_callback`, PKCE S256, step-up 403). 7 mục bắt buộc — đã sửa: (1) CSP `form-action` chặn chuyển về Claude, redirect bằng `new Response`; (2) không mở DCR, không ghi KV trước khi đăng nhập (chống cạn hạn mức Free); (3) AC-10: đổi `APP_PASSWORD`, Đăng xuất mọi máy, thu hồi grant khi lệch để refresh không hồi sinh; (4) "ngay" → trong 60 giây (KV); (5) kiểm `mcp:write` ở tầng HTTP; (6) điều kiện test (`cloudflare:workers`, ctx, KV giả); (7) `run_worker_first`, `notFound`, bỏ che log. Gợi ý đã nhận: hiện tên miền CIMD, metadata grant để liệt kê, refresh trượt, actor nhật ký ở trang uỷ quyền, CSS ngoài `/oauth/`, nhà chưa thiết lập, `authorizeEndpoint` tường minh.
Quyết định bảo mật AI chọn phương án chặt hơn (chủ nhà xem lại): Đăng xuất mọi máy gỡ cả kết nối Claude của cả nhà; đổi `APP_PASSWORD` làm hết hiệu lực kết nối uỷ quyền bằng mật khẩu chung.

## Việc cần làm
- [x] Review kỹ thuật; commit propose
- [x] Test → code → xanh (`e5ecf41`)
- [x] Tạo KV prod (`vi-nha-oauth`) → deploy (2026-10-08 09:37, version `ebbde909`) → thử thật bằng client CIMD của Claude Code: `/mcp` không token 401 + Bearer challenge, metadata đúng origin, chỉ CIMD, `/oauth/register` 404, `/mcp/<cũ>` 404; đăng nhập + đồng ý → mã → token `mcp:read mcp:write` → `tools/list` 16 tool, `get_snapshot` chạy; `GET /v1/settings/mcp` liệt kê kết nối (KV list chậm > 70 giây mới hiện); gỡ 200
- [ ] Chủ nhà thêm lại connector trong Claude (địa chỉ mới `https://<host>/mcp`, đăng nhập, chọn quyền)
- [x] Hợp nhất: UC + History, ADR-97, ADR-98, entities
- [x] `specs:gen`, `specs:check` 0 lỗi; archive
- [x] Cập nhật tài liệu: README (Nối Claude, bỏ `MCP_SECRET`), `docs/DESIGN.md` (mục Cài đặt, trang uỷ quyền); GitBook: trang Nối Claude, bảo mật, máy này, thành viên và mật khẩu; ảnh mục Claude và trang uỷ quyền (docs repo)
