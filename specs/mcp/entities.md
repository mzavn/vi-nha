# Entity model — mcp

MCP không có bảng D1 riêng và không giữ phiên MCP giữa các request. Trạng thái duy nhất context này sở hữu là các **kết nối OAuth** (client, grant, token) trong KV `OAUTH_KV`, do thư viện `@cloudflare/workers-oauth-provider` quản lý. Dữ liệu nghiệp vụ (Transaction, BankLog, Wallet, TransferOrder, …) thuộc ledger/ingest/allocation; Member, mật khẩu, phiên app, nhật ký thay đổi thuộc access.

## McpEndpoint (điểm nối)
| Thuộc tính | Giá trị / luật | Nơi thực thi |
|---|---|---|
| Đường dẫn | `/mcp` (đúng đường này, mọi method HTTP); `/mcp/<bất kỳ>` → 404 JSON `not_found` như đường không có | `src/index.ts` › `app.all("/mcp", mcpResource)`, `app.notFound` |
| Bảo vệ | OAuth 2.1 resource server: thiếu / sai token → 401 kèm `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`; lớp phòng hậu kiểm người uỷ quyền còn hoạt động, `session_gen`, cách vào, dấu mật khẩu chung — lệch → 401 và thu hồi grant | `src/oauth/server.ts` › `oauthServers` (`OAuthResourceServer`, `validateToken`), `grantStillValid` |
| Quyền | Cần `mcp:read`; tool ghi (`WRITE_TOOLS`) cần thêm `mcp:write` — kiểm ở tầng HTTP trước transport (đọc body JSON-RPC, cả dạng mảng), thiếu → 403 `insufficient_scope` | `src/routes/mcp.ts` › `mcpHandler`, `callsWriteTool` |
| Server info | `name: "vi-nha"`, `version: "1.0.0"` | `new McpServer(...)` |
| Transport | `WebStandardStreamableHTTPServerTransport` của `@modelcontextprotocol/sdk` với `sessionIdGenerator: undefined` (stateless) và `enableJsonResponse: true` (trả JSON thường, không SSE cho POST); lỗi giao thức (Content-Type sai, JSON hỏng…) do transport trả lỗi JSON-RPC | `mcpHandler` |
| Vòng đời | Mỗi request: dựng `McpServer` mới → `registerTools(server, db, memberId, now)` → `connect` → `handleRequest`; không Durable Object, không `Mcp-Session-Id` | `mcpHandler` |

Bất biến: token, mã uỷ quyền, refresh token **không bao giờ** nằm trong URL của `/mcp`, không được ghi log, không trả qua API nào ngoài `/oauth/token` (danh sách kết nối ở Cài đặt không có token, mã, khoá). KV chỉ lưu băm của token / mã; `props` của grant được thư viện mã hoá.

## OAuthGrant (kết nối)
Một lần người trong nhà cho một ứng dụng AI dùng sổ (UC-601). Lưu trong KV `OAUTH_KV`, khoá theo người uỷ quyền (`userId` = `memberId`).

| Thuộc tính | Giá trị / luật | Nơi thực thi |
|---|---|---|
| `userId` | `memberId` của người đã đăng nhập ở trang uỷ quyền | `src/oauth/routes.ts` › `decide` (`completeAuthorization`) |
| `props` (mã hoá) | `GrantProps { memberId, sessionGen, mode: "h" \| "p", sharedStamp }` — `session_gen` lúc uỷ quyền; `mode` = vào bằng mật khẩu chung (`h`) / riêng (`p`); `sharedStamp` = HMAC (khoá `APP_PASSWORD`) chỉ khi `mode = h`, không phải băm trơn | `src/oauth/server.ts` › `GrantProps`, `sharedStamp` |
| `metadata` (không mã hoá) | `GrantMetadata { clientName, clientDomain, redirectHost }` — lưu lúc uỷ quyền để Cài đặt liệt kê (thư viện chỉ trả `clientId`) | `GrantMetadata`, `decide` |
| Quyền | `mcp:read` (luôn có) + `mcp:write` (khi để tick Ghi — mặc định tick, ADR-98) | `decide` |
| Vòng đời | Đồng ý → mã dùng một lần (10 phút) → đổi mã (PKCE) lấy token truy cập 1 giờ + refresh token trượt (60 ngày không dùng mới hết) → bị thu hồi khi: gỡ ở Cài đặt (access UC-508); đổi / gỡ mật khẩu riêng hoặc tắt người (`revokeMemberGrants`); Đăng xuất mọi máy (`revokeAllGrants`, cả nhà); lớp phòng hậu thấy lệch (đổi `APP_PASSWORD`, `session_gen` lệch…). Thu hồi grant làm chết cả token lẫn refresh token; KV lan truyền tối đa 60 giây | `src/oauth/server.ts` › `ACCESS_TOKEN_TTL`, `REFRESH_IDLE_TTL`, `revokeMemberGrants`, `revokeAllGrants`, `listMemberGrants` |
| Nhật ký | Tạo → `mcp.connect` (đích `client:<tên miền \| tên>`, chi tiết `{ member_id, scopes }`); gỡ ở Cài đặt → `mcp.revoke` (chi tiết `{ member_id, grant_id }`); cả hai báo cả nhà (ADR-90) | `decide`; `src/routes/settings.ts` |

## OAuthClient (ứng dụng AI)
- Chỉ đăng ký bằng **Client ID Metadata Document** (CIMD): `client_id` là URL tài liệu JSON của ứng dụng (ví dụ của Claude), Worker tải về để xác minh tên miền và `redirect_uri` (cần `compatibility_flags: ["global_fetch_strictly_public"]`). Tên miền đã xác minh hiện nổi bật ở trang đồng ý; tên ứng dụng là "tên tự khai".
- **Không** mở Dynamic Client Registration: `POST /oauth/register` → 404 (endpoint công khai ghi KV sẽ bị spam làm cạn hạn mức Free).
- Nơi thực thi: `src/oauth/server.ts` › `oauthServers` (`clientIdMetadataDocumentEnabled: true`, không có `clientRegistrationEndpoint`).

## OAuthMetadata (tài liệu khám phá)
| Tài liệu | Đường dẫn | Nội dung chính |
|---|---|---|
| Protected resource (RFC 9728) | `/.well-known/oauth-protected-resource/mcp` | `resource = <origin>/mcp`, `authorization_servers = [<origin>]`, `resource_name = "Ví nhà"` |
| Authorization server (RFC 8414) | `/.well-known/oauth-authorization-server` | `issuer = <origin>`, `authorization_endpoint = <origin>/oauth/authorize`, `token_endpoint = <origin>/oauth/token`, quyền `mcp:read`, `mcp:write`, hỗ trợ CIMD, PKCE |

Issuer và resource lấy theo origin của request (mỗi nhà một tên miền / `*.workers.dev`); server dựng một lần cho mỗi origin (`oauthServers`, cache theo origin). Mount trước `requireAuth` (`src/index.ts`); `run_worker_first` gồm `/mcp`, `/mcp/*`, `/oauth/*`, `/.well-known/*`.

## ToolCatalog (danh mục tool)
- Đúng 16 tool, tên cố định (bảng ở `README.md`): `add_tenant_shared_expense`, `add_transaction`, `allocate_income`, `assign_log`, `get_budget`, `get_debts`, `get_goals`, `get_receivables`, `get_reconciliation`, `get_snapshot`, `get_spending_by_category`, `list_categories`, `list_pending_logs`, `list_tenants`, `list_transfer_orders`, `preview_allocation`; đăng ký bởi `registerTools(server, db, memberId, now)` (`memberId` = người đã uỷ quyền kết nối). Tên và mô tả tool tiếng Anh (ADR-92). Change `261001-cho-thue-lai` thêm hai tool sổ người thuê (nay là `list_tenants`, `add_tenant_shared_expense`; trước đó 12); sổ nợ (ADR-71) thêm `get_debts`; sổ phải thu (ADR-72) thêm `get_receivables`; change `261007-doi-ten-tieng-anh` đổi tên `reconcile` → `get_reconciliation`, `spend_by_category` → `get_spending_by_category`, `allocate` → `allocate_income`, `get_tenants` → `list_tenants`, `add_tenant_paid_for_us` → `add_tenant_shared_expense`.
- Mỗi request `registerTools` chạy **một** truy vấn `members` (active, `ORDER BY role = 'owner' DESC, name`) để:
  - `memberIds`: tập id hợp lệ cho người ghi của `add_transaction` (`by_member_id`, bỏ trống = người uỷ quyền);
  - `memberHint`: chuỗi `"<id> (<tên>)"` nhúng vào mô tả `add_transaction` (hoặc "no active members yet");
- Người xem / người làm: tool đọc nhìn như người uỷ quyền (`memberId`) — không còn tự chọn chủ hộ; tool ghi mang `actor = { memberId, via: "mcp" }` cho nhật ký thay đổi.
- `WRITE_TOOLS` = `add_transaction`, `assign_log`, `allocate_income`, `add_tenant_shared_expense`: cần quyền `mcp:write` (kiểm ở `mcpHandler`); ghi thành công → nhật ký `tx.create` (`tx:<id>`), `log.assign` (`log:<log_id>`), `income.allocate` (`tx:<income_tx_id>`), `tenant.paid_for_us` (`tenant:<id>`), `via = mcp`.
- Luật: tool **không** có SQL nghiệp vụ; chỉ gọi hàm `services/ledger.ts` / `services/ingest.ts` / `services/rental.ts` / `services/debts.ts` (comment đầu `src/mcp/tools.ts`; commit `bc0d2a2`).

## ToolResult (kết quả tool)
| Trạng thái | Hình dạng | Nguồn |
|---|---|---|
| Thành công | `content: [{type:"text", text: <tóm tắt>}?, {type:"text", text: JSON.stringify(data)}]` | `ok(data, summary?)` |
| Lỗi nghiệp vụ | `content: [{type:"text", text: DomainError.message}], isError: true` | `fail(err)` với `DomainError` |
| Lỗi lạ | `content: [{type:"text", text: "Lỗi hệ thống. Thử lại sau."}], isError: true`; log `"[mcp] lỗi khi chạy tool:"` + message | `fail(err)` |
| Input sai schema zod | Tool error do SDK tạo (`isError: true`), handler không chạy | `@modelcontextprotocol/sdk` |

Mọi ToolResult đi trong JSON-RPC HTTP 200; chỉ lỗi xác thực (401), quyền (403) và tầng giao thức (ví dụ 415) mới có mã khác (UC-601).
