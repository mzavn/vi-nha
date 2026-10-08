# UC-601: Nối Claude (và ứng dụng AI) bằng OAuth
- Status: implemented
- BR: BR-05, BR-09, BR-10
- Decisions: ADR-97 (MCP dùng OAuth 2.1, bỏ đường dẫn chứa khoá — thay ADR-30); ADR-98 (quyền mặc định Xem + Ghi, Ghi bỏ tick được; Đăng xuất mọi máy và đổi mật khẩu chung gỡ cả kết nối AI); ADR-89 (bộ chặn dò mật khẩu, Đăng xuất mọi máy bằng thế hệ phiên); ADR-90 (nhật ký thay đổi, báo cả nhà); ADR-96 (thành viên ngang quyền); ADR-92 (tên tool tiếng Anh); `plans/260921-2228-profit-first-pwa/phase-06-mcp.md` §"Cách làm" (stateless, tool-only); `plans/reports/researcher-261007-mo-ma-nguon.md` §5b, §5c
- Actor: Người trong nhà thêm "custom connector" trong Claude (web, Desktop, mobile, Claude Code) hoặc ứng dụng AI khác hỗ trợ MCP + OAuth (ChatGPT, Cursor…), rồi đăng nhập và chọn quyền ở trang uỷ quyền của Ví nhà; sau đó ứng dụng AI gọi tool thay mặt người đó
- Trigger: Ứng dụng AI gọi `https://<host>/mcp` (JSON-RPC `initialize`, `tools/list`, `tools/call`); trình duyệt mở `/oauth/authorize`; ứng dụng gọi `/oauth/token`, `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`

## History
- v1 (2026-09-22, commit `c6677a8`): stub route `/mcp`.
- v2 (2026-09-22, commit `bc0d2a2`): `McpServer` + `StreamableHTTPTransport` mới mỗi request, 12 tool; sai secret → 404; mọi lỗi bắt tại chỗ để không lọt lên `app.onError`.
- v3 (2026-09-22, commit `a5baefb`): `app.onError` che path `/mcp/.*` trước khi log.
- v4 (2026-10-01, commit `034b7ff`): thêm tool `get_tenants`, `add_tenant_paid_for_us` → 14 tool; test liệt kê tool đổi tên "…đúng 14 tool…" (change `261001-cho-thue-lai`).
- v5 (2026-10-01, commit `25db5b9`): thêm tool `get_debts` → 15 tool; test liệt kê tool đổi tên "…đúng 15 tool…" (sổ nợ, ADR-71).
- v6 (2026-10-01, commit `2438ac0`): thêm tool `get_receivables` → 16 tool; test liệt kê tool đổi tên "…đúng 16 tool…" (sổ phải thu, ADR-72).
- v7 (2026-10-07, commit `7424f26`): đổi tên 5 tool theo ADR-92 — `reconcile` → `get_reconciliation`, `spend_by_category` → `get_spending_by_category`, `allocate` → `allocate_income`, `get_tenants` → `list_tenants`, `add_tenant_paid_for_us` → `add_tenant_shared_expense`; vẫn 16 tool, tham số không đổi; AC-6 liệt kê tên mới. Kết nối Claude phải duyệt lại quyền tool sau khi đổi tên (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).
- v8 (2026-10-08, commit `e5ecf41`): viết lại thành "Nối Claude (và ứng dụng AI) bằng OAuth" (ADR-97, thay ADR-30): endpoint `https://<host>/mcp` bảo vệ bằng OAuth 2.1 của chuẩn MCP (thư viện `@cloudflare/workers-oauth-provider`, KV `OAUTH_KV`), client chỉ đăng ký bằng Client ID Metadata Document, không mở DCR; trang uỷ quyền `/oauth/authorize` đăng nhập bằng mật khẩu của app (luật UC-501) rồi hỏi đồng ý hai quyền Xem / Ghi (Ghi tick sẵn, bỏ được — ADR-98); token mang người uỷ quyền; gỡ kết nối khi đổi / gỡ mật khẩu riêng, tắt người, Đăng xuất mọi máy, đổi `APP_PASSWORD`. Bỏ `MCP_SECRET`, đường dẫn chứa khoá (`/mcp/<bất kỳ>` → 404), phần che `/mcp/[redacted]` trong log và `@hono/mcp` (thay bằng `WebStandardStreamableHTTPServerTransport` của SDK). DEPRECATED AC-1, AC-2, AC-3, AC-5; sửa AC-4 (tên test mới ở `describe` "transport MCP"), AC-6 (cần token có `mcp:read`); thêm AC-8 → AC-11. Đóng [OPEN] chuyển secret sang header (không còn secret), [OPEN] `GET /mcp` rơi về SPA (`/mcp` vào Worker, không token → 401), [OPEN] chưa chạy với Claude thật (prod 2026-10-08 version `ebbde909`: Claude Code nối bằng CIMD + PKCE, đăng nhập + đồng ý, token `mcp:read mcp:write`, `tools/list` 16 tool, `get_snapshot` chạy, gỡ 200). Thêm [OPEN] danh sách kết nối trễ do KV, [OPEN] chưa thử thật với ứng dụng khác Claude Code (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md))

## Preconditions
- Nhà đã thiết lập (UC-510 access), có `APP_PASSWORD` (mật khẩu chung) và thành viên đang hoạt động.
- Worker có binding KV `OAUTH_KV` (lưu client, grant, token của OAuth); nút Deploy tạo sẵn mỗi nhà một namespace.
- Ứng dụng AI hỗ trợ MCP authorization với Client ID Metadata Document (CIMD) và PKCE.

## Main Flow
1. Người dùng thêm connector với địa chỉ `https://<host>/mcp` (địa chỉ hiện ở Cài đặt › Claude và ứng dụng AI — access UC-508, pwa UC-709).
2. Ứng dụng gọi `/mcp` chưa có token → 401 kèm `WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp"`.
3. Ứng dụng đọc metadata của resource (RFC 9728) rồi của authorization server (RFC 8414): issuer là origin của chính bản cài, trang uỷ quyền `/oauth/authorize`, đổi mã `/oauth/token`, quyền `mcp:read`, `mcp:write`, nhận Client ID Metadata Document, không có endpoint đăng ký client.
4. Ứng dụng mở trình duyệt tới `/oauth/authorize` với `client_id` là URL tài liệu của nó, `redirect_uri`, `state`, `code_challenge` (PKCE S256); Worker tải tài liệu đó để xác minh ứng dụng và nơi nhận token.
5. Chưa đăng nhập app trên trình duyệt này → form chọn người + mật khẩu; luật y hệt đăng nhập app (UC-501): người có mật khẩu riêng dùng mật khẩu riêng, còn lại dùng mật khẩu chung; sai mật khẩu tính vào bộ chặn dò (ADR-89). Đúng → trình duyệt nhận cookie phiên app như đăng nhập thường.
6. Trang đồng ý hiện nổi bật **tên miền đã xác minh** của ứng dụng (ví dụ `claude.ai`), tên ứng dụng (ghi rõ "tên tự khai"), nơi nhận quyền truy cập, người cho phép, cảnh báo khi nơi nhận là chính máy này (`localhost`), và hai quyền: **Xem số liệu** (`mcp:read`, bắt buộc) và **Ghi giao dịch, gán, chia tiền** (`mcp:write`, tick sẵn, bỏ được — ADR-98). Chỉ từ bước này (đã đăng nhập) mới ghi KV.
7. Bấm **Cho phép** → tạo kết nối (grant) mang người đã uỷ quyền và quyền đã chọn; ghi nhật ký `mcp.connect` và báo cả nhà (ADR-90); chuyển về ứng dụng với mã dùng một lần.
8. Ứng dụng đổi mã lấy token ở `/oauth/token` kèm `code_verifier` (PKCE): token truy cập 1 giờ + refresh token (60 ngày không dùng mới hết).
9. Mỗi lần gọi `/mcp` kèm token: kiểm token; kiểm người uỷ quyền vẫn còn quyền vào như lúc uỷ quyền (lớp phòng hậu, AC-10); kiểm quyền trước khi chạy tool (AC-11); rồi chạy tool **như người đã uỷ quyền** — tool đọc nhìn số liệu như người đó trên app (UC-602), tool ghi ghi người đó là người ghi / người gán kèm nhật ký `via = mcp` (UC-603, UC-604, UC-605).
10. Không giữ phiên MCP: mỗi request dựng server và 16 tool mới; `tools/list`, `tools/call` chạy được không cần `initialize` trước; trả JSON-RPC dạng JSON.

## Alternative Flows
- 5a. Trình duyệt đã đăng nhập app (cookie phiên còn hiệu lực) → bỏ bước đăng nhập, vào thẳng trang đồng ý.
- 6a. Bỏ tick Ghi → kết nối chỉ Xem; gọi tool ghi bị từ chối kèm lời xin thêm quyền `mcp:write` (AC-11), ứng dụng có thể mở lại trang uỷ quyền.
- 8a. Token truy cập hết hạn → ứng dụng dùng refresh token lấy token mới, không phải đăng nhập lại; refresh token 60 ngày không dùng thì hết, phải nối lại.
- 9a. `initialize` → `serverInfo.name = "vi-nha"` và `protocolVersion`.
- 9b. Gỡ một kết nối ở Cài đặt › Claude và ứng dụng AI (access UC-508, pwa UC-709) → token và refresh token của kết nối đó hết hiệu lực; nhật ký `mcp.revoke`, báo cả nhà.
- 9c. Đổi / gỡ mật khẩu riêng hoặc tắt người (access UC-507) → gỡ mọi kết nối của người đó; **Đăng xuất mọi máy** (access UC-501) → gỡ kết nối của cả nhà; đổi `APP_PASSWORD` → kết nối uỷ quyền bằng mật khẩu chung hết hiệu lực (ADR-98).

## Exceptions
- E1. Gọi `/mcp` không token, token rác, hết hạn hay đã bị gỡ → 401 kèm `WWW-Authenticate: Bearer … resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp"` (không phải lỗi JSON-RPC) để ứng dụng tự nối lại.
- E2. Token còn hạn nhưng người uỷ quyền đã đổi quyền vào (đã tắt, `session_gen` lệch, cách vào khác, mật khẩu chung đã đổi) mà KV chưa kịp gỡ → 401 kèm Bearer challenge và thu hồi luôn kết nối để refresh không hồi sinh.
- E3. Thiếu quyền: token không có `mcp:read` → 403; token chỉ Xem gọi tool ghi (cả khi nằm trong một lô JSON-RPC) → 403 `insufficient_scope` với challenge ghi đủ `mcp:read mcp:write`; không ghi gì.
- E4. Nhà chưa thiết lập → trang uỷ quyền báo lỗi (409), không có form.
- E5. Không tải được tài liệu của ứng dụng, `client_id` hay `redirect_uri` không hợp lệ / không đăng ký trong tài liệu → trang báo lỗi tại chỗ (400), **không** chuyển hướng.
- E6. Ứng dụng và nơi nhận đã xác minh nhưng yêu cầu sai (ví dụ thiếu PKCE) → chuyển về ứng dụng với `error`, `state`, `iss`.
- E7. Bấm **Từ chối** → chuyển về ứng dụng với `error=access_denied`; không tạo kết nối, không ghi nhật ký.
- E8. Sai mật khẩu → form lại với "Sai mật khẩu." (401), tính vào bộ chặn dò scope `login`; đang bị chặn → 429 kèm `Retry-After`; không chọn người → 400.
- E9. Form đồng ý giả mạo, thiếu cookie gắn trình duyệt, handle đã dùng hoặc hết hạn → trang lỗi "Trang cho phép đã hết hạn, đã dùng, hoặc mở ở trình duyệt khác.", không cấp mã.
- E10. `POST /oauth/register` (Dynamic Client Registration) → 404; `/mcp/<bất kỳ>` (đường dẫn chứa khoá cũ) và đường lạ dưới `/oauth/`, `/.well-known/` → 404 JSON `not_found` như đường dẫn không có.
- E11. Lỗi giao thức MCP (Content-Type sai, JSON hỏng…) → transport trả lỗi JSON-RPC (ví dụ 415), không lọt lên `app.onError`.
- E12. KV lan truyền tối đa 60 giây: gỡ kết nối, đổi mật khẩu, tắt người, Đăng xuất mọi máy có hiệu lực ở mọi nơi trong vòng 60 giây (lớp phòng hậu chặn sớm hơn khi đọc được D1).
- E13. App cài trên iPhone (PWA) có kho cookie riêng: khi ứng dụng AI mở trình duyệt thường vẫn phải đăng nhập ở trang uỷ quyền.

## Acceptance Criteria
### AC-1: Sai secret giống hệt route không tồn tại (DEPRECATED v8 — ADR-97)
- Đường dẫn chứa khoá đã bỏ; `/mcp/<bất kỳ>` → 404 nay thuộc AC-8.
- Tests: ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97)

### AC-2: Thiếu secret → 404 (DEPRECATED v8 — ADR-97)
- Đường dẫn chứa khoá đã bỏ; xem AC-8.
- Tests: ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97)

### AC-3: Chưa cấu hình `MCP_SECRET` thì khoá hẳn (DEPRECATED v8 — ADR-97)
- `MCP_SECRET` không còn được đọc; không token thì `/mcp` luôn 401 (AC-8).
- Tests: ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97)

### AC-4: Lỗi giao thức trả JSON-RPC, không lọt lên `app.onError`
- Given token hợp lệ
- When `POST /mcp` với `Content-Type: text/plain`
- Then 415 với body JSON-RPC có `error`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "transport MCP › request lỗi (Content-Type sai) → transport trả lỗi JSON-RPC 415, không văng lên app.onError"

### AC-5: Không bao giờ log secret (DEPRECATED v8 — ADR-97)
- Không còn secret trong đường dẫn nên bỏ phần che `/mcp/[redacted]`; token, mã không bao giờ nằm trong URL của `/mcp`.
- Tests: ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97)

### AC-6: Bắt tay và liệt kê tool không cần phiên
- Given token có `mcp:read` (kể cả chỉ Xem)
- When `initialize`; và riêng `tools/list` không `initialize` trước
- Then `serverInfo.name = "vi-nha"`; danh sách đúng 16 tên: `add_tenant_shared_expense, add_transaction, allocate_income, assign_log, get_budget, get_debts, get_goals, get_receivables, get_reconciliation, get_snapshot, get_spending_by_category, list_categories, list_pending_logs, list_tenants, list_transfer_orders, preview_allocation`; tool đọc chạy được
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "giao thức MCP › bắt tay initialize" · "… › tools/list trả đúng 16 tool (không cần gọi initialize trước — server không giữ phiên)"; [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem: initialize, tools/list (16 tool) và tool đọc chạy"

### AC-7: Chi phí dựng server mỗi request chấp nhận được
- When gọi `get_snapshot` 10 lần
- Then thời gian tường trung bình < 1000 ms (Node, không phải CPU time Workers)
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "chi phí CPU ước lượng › một lần tools/call (dựng McpServer + zod mới mỗi request) chạy trong thời gian hợp lý"

### AC-8: Endpoint `/mcp` đòi token; metadata đúng origin; chỉ đăng ký bằng CIMD
- When gọi `/mcp` không token hoặc token rác
- Then 401 kèm `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`, không phải lỗi JSON-RPC
- When `GET /.well-known/oauth-protected-resource/mcp` và `GET /.well-known/oauth-authorization-server`
- Then metadata lấy đúng origin của bản cài (resource `<origin>/mcp`, issuer `<origin>`, `/oauth/authorize`, `/oauth/token`, quyền `mcp:read`, `mcp:write`), nhận Client ID Metadata Document, không có `registration_endpoint`
- When `POST /oauth/register`; `/mcp/<bất kỳ>`; đường lạ dưới `/oauth/`, `/.well-known/`
- Then 404 JSON như đường dẫn không có; KV không bị ghi gì
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-8: endpoint /mcp, metadata, chỉ CIMD › gọi /mcp không có token → 401 kèm Bearer challenge trỏ tới metadata của resource" · "… › token rác → 401 kèm Bearer challenge, không phải lỗi JSON-RPC" · "… › metadata resource và authorization server đúng origin; chỉ đăng ký bằng Client ID Metadata Document" · "… › không mở Dynamic Client Registration: POST /oauth/register → 404, KV không có gì" · "… › đường dẫn chứa khoá cũ /mcp/<bất kỳ> → 404 như đường không có; /oauth/, /.well-known/ lạ cũng là 404 JSON"

### AC-9: Trang uỷ quyền: đăng nhập bằng mật khẩu của app rồi đồng ý
- Given nhà chưa thiết lập → trang báo lỗi, không có form
- Given chưa đăng nhập → form chọn người + mật khẩu POST về chính địa chỉ đó (giữ nguyên yêu cầu uỷ quyền); luật UC-501 (mật khẩu riêng nếu có, không thì mật khẩu chung; sai → 401 và tính vào bộ chặn dò scope `login`; bị chặn → 429); chưa đăng nhập xong thì KV không bị ghi gì
- Given đã có cookie phiên app → vào thẳng trang đồng ý
- Then trang đồng ý: tên miền đã xác minh, tên tự khai (escape), nơi nhận token, cảnh báo `localhost`, quyền Xem (bắt buộc) và Ghi (tick sẵn, bỏ được)
- When ứng dụng chưa xác minh được / `redirect_uri` không đăng ký → báo lỗi tại chỗ, không chuyển hướng; xác minh được mà thiếu PKCE → chuyển về với `error`, `state`, `iss`; Từ chối → `access_denied`, không có grant; form giả mạo / handle dùng lại → trang lỗi, không cấp mã
- When Cho phép
- Then chuyển về ứng dụng với mã; đổi mã lấy token cần đúng `code_verifier`; token có quyền đã chọn; nhật ký `mcp.connect` gắn người uỷ quyền (`detail` có `member_id`, `scopes`)
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-9: trang uỷ quyền › nhà chưa thiết lập → trang báo lỗi, không có form" · "… › chưa đăng nhập → form chọn người + mật khẩu POST về chính địa chỉ này; chưa ghi gì vào KV" · "… › sai mật khẩu → 401, tính vào bộ chặn dò scope login, KV vẫn trống; bị chặn → 429" · "… › người có mật khẩu riêng: mật khẩu chung bị từ chối, mật khẩu riêng vào được (luật UC-501)" · "… › đăng nhập đúng → cookie phiên app + trang đồng ý: tên miền đã xác minh, tên tự khai, nơi nhận token, hai quyền, Ghi tick sẵn" · "… › đã có cookie phiên app → bỏ bước đăng nhập, vào thẳng trang đồng ý" · "… › redirect về máy (localhost) → cảnh báo; tên tự khai được escape" · "… › client không tải được tài liệu / redirect_uri không đăng ký → báo lỗi tại chỗ, không chuyển hướng" · "… › thiếu PKCE (client, redirect đã xác thực) → chuyển về ứng dụng với error, state, iss" · "… › Từ chối → chuyển về ứng dụng với access_denied; không có grant nào" · "… › form đồng ý không giả mạo được: thiếu cookie gắn trình duyệt, hay dùng lại handle → trang lỗi, không cấp mã" · "… › Cho phép → mã chuyển về Claude; đổi mã lấy token cần đúng code_verifier (PKCE); nhật ký mcp.connect gắn người uỷ quyền"

### AC-10: Kết nối bị gỡ khi quyền vào của người uỷ quyền đổi
- Given kết nối còn hiệu lực → refresh token lấy được token mới
- When đổi / gỡ mật khẩu riêng hoặc tắt người
- Then mọi kết nối của người đó bị gỡ: `/mcp` 401, refresh chết
- When Đăng xuất mọi máy
- Then kết nối của cả nhà bị gỡ
- When đổi `APP_PASSWORD`
- Then kết nối uỷ quyền bằng mật khẩu chung hết hiệu lực (401 + grant bị thu hồi); kết nối uỷ quyền bằng mật khẩu riêng vẫn chạy
- When KV chưa kịp gỡ mà `session_gen` lệch, hoặc người đã đặt mật khẩu riêng còn token vào bằng mật khẩu chung
- Then 401 kèm Bearer challenge và grant bị thu hồi để refresh không hồi sinh
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-10: gỡ kết nối khi quyền vào đổi › refresh token chạy được khi grant còn" · "… › đổi mật khẩu riêng → mọi kết nối của người đó bị gỡ: /mcp 401, refresh chết" · "… › tắt người → kết nối của người đó bị gỡ" · "… › Đăng xuất mọi máy → kết nối Claude của cả nhà bị gỡ" · "… › đổi APP_PASSWORD → kết nối uỷ quyền bằng mật khẩu chung hết hiệu lực (401 + grant bị thu hồi); mật khẩu riêng vẫn chạy" · "… › lớp phòng hậu: session_gen lệch (KV chưa kịp gỡ) → 401 kèm Bearer challenge và grant bị thu hồi để refresh không hồi sinh" · "… › lớp phòng hậu: người đã đặt mật khẩu riêng mà token vào bằng mật khẩu chung → 401"

### AC-11: Tool ghi cần quyền Ghi, kiểm ở tầng HTTP
- Given token chỉ có `mcp:read`
- When gọi `add_transaction`, `assign_log`, `allocate_income` hoặc `add_tenant_shared_expense` (kể cả nằm trong một lô JSON-RPC dạng mảng)
- Then HTTP 403, `WWW-Authenticate` có `error="insufficient_scope"`, `scope="mcp:read mcp:write"` và `resource_metadata`; không ghi gì
- Given token có `mcp:write`
- Then tool ghi chạy
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì" · "… › lô JSON-RPC (mảng) có một tool ghi cũng bị 403 cả lô" · "… › token có Ghi → tool ghi chạy"

## Traceability
- Code: `src/oauth/server.ts` › `oauthServers` (cache theo origin; `OAuthAuthorizationServer` CIMD bật, không DCR; `OAuthResourceServer` `requiredScopes`, `validateToken`), `oauthApi`, `SCOPE_READ`, `SCOPE_WRITE`, `AUTHORIZE_PATH`, `TOKEN_PATH`, `MCP_PATH`, `GrantProps`, `GrantMetadata`, `sharedStamp`, `grantStillValid`, `listMemberGrants`, `revokeMemberGrants`, `revokeAllGrants`; `src/oauth/routes.ts` › `oauthRoutes` (`GET`/`POST /authorize`, `/token`), `parseRequest`, `loginPage`, `consentPage`, `decide`, `errorPage`, `authorizationServerMetadata`, `mcpResource`; `src/services/member-login.ts` › `checkLogin`, `tooManyAttemptsMessage` (dùng chung với `POST /v1/session`); `src/routes/mcp.ts` › `mcpHandler`, `callsWriteTool`; `src/mcp/tools.ts` › `registerTools`, `WRITE_TOOLS`; `src/index.ts` › mount `/oauth`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/mcp` trước `requireAuth`, `app.notFound`; gỡ kết nối: `src/routes/settings.ts` (tắt người, đặt / gỡ mật khẩu riêng → `revokeMemberGrants`; `GET`/`DELETE /v1/settings/mcp`), `src/routes/session.ts` (Đăng xuất mọi máy → `revokeAllGrants`); `src/security-headers.ts` (CSP `form-action` thêm origin của `redirect_uri` đã xác thực)
- Cấu hình: `wrangler.jsonc` `compatibility_flags: ["global_fetch_strictly_public"]` (tải tài liệu CIMD), `assets.run_worker_first` (`/mcp`, `/mcp/*`, `/oauth/*`, `/.well-known/*`), `kv_namespaces` `OAUTH_KV`; `src/env.d.ts` › `OAUTH_KV`; thư viện `@cloudflare/workers-oauth-provider` 1.x, `@modelcontextprotocol/sdk` (`WebStandardStreamableHTTPServerTransport`); `web/public/oauth.css`
- Kiểm thật: prod 2026-10-08 (version `ebbde909`) — `/mcp` không token → 401 + Bearer challenge; metadata đúng origin, chỉ CIMD; `/oauth/register` 404; `/mcp/<cũ>` 404; Claude Code nối bằng CIMD + PKCE: đăng nhập + đồng ý → token `mcp:read mcp:write` → `tools/list` 16 tool, `get_snapshot` chạy; `GET /v1/settings/mcp` liệt kê kết nối; gỡ 200
- Liên quan: access [UC-501](../access/UC-501-dang-nhap-mat-khau-chung.md), [UC-503](../access/UC-503-phan-quyen-theo-duong-dan.md), [UC-507](../access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md), [UC-508](../access/UC-508-quan-ly-khoa-ket-noi.md); pwa [UC-709](../pwa/UC-709-sua-cau-hinh-man-cai-dat.md)

## Divergences & Open Questions
- [OPEN] phase-06 Todo "đo CPU time … so với ngưỡng 10 ms của gói Free": chỉ có số đo wall time trên Node (báo cáo MCP ghi trung bình 1.62 ms); CPU time thật trên Workers chưa đo.
- [OPEN] Cài đặt › Claude và ứng dụng AI (`GET /v1/settings/mcp`) đọc danh sách grant bằng KV `list`, vốn trễ: trên prod 2026-10-08 một kết nối vừa tạo phải sau hơn 70 giây mới hiện; còn grant đã cấp mã mà ứng dụng chưa đổi mã vẫn hiện trong danh sách tới 10 phút (hạn của mã). Chưa quyết có cần hiện "đang nối…" hay lọc grant chưa đổi mã.
- [OPEN] Kiểm thật trên prod mới chạy với Claude Code; Claude web / Desktop / mobile, ChatGPT, Cursor chưa thử thật (cùng chuẩn CIMD + PKCE).
