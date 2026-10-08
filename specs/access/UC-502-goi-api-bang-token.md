# UC-502: Gọi API bằng Bearer `API_TOKEN`
- Status: implemented
- BR: BR-09, BR-05
- Decisions: D6; `plans/260921-2228-profit-first-pwa/phase-01-worker-d1.md` bước 6; `plans/reports/redteam-260922-0100-auth-exposure.md` ("Bearer token + `X-Member-Id` … hành vi siêu token có chủ đích")
- Actor: Script / n8n / test tích hợp (máy, không phải người)
- Trigger: Bất kỳ request `/v1/*` (trừ health/session) có header `Authorization`

## History
- v1 (2026-09-22, commit `a773716`): Bearer token guard trên `/v1/*`.
- v2 (2026-09-22, commit `b92fc0f`): thêm cookie phiên song song; token chọn người qua `X-Member-Id`, mặc định chủ hộ.

## Preconditions
- `API_TOKEN` đã đặt.

## Main Flow
1. Request tới `/v1/*` có header `Authorization` → `requireAuth` đi nhánh token (kể cả khi cũng có cookie).
2. Header phải có dạng `Bearer <token>`; `<token>` so `safeEqual` với `API_TOKEN`.
3. Nếu có `X-Member-Id`: phải là thành viên `active` → dùng làm `memberId`.
4. Nếu không có `X-Member-Id`: `memberId` = thành viên `active` đầu tiên theo `ORDER BY role = 'owner' DESC, id` (chủ hộ); không có ai → `null`.
5. Đặt `via = "token"` và cho qua. Token có toàn quyền như một thành viên đã đăng nhập, gồm cả `/v1/settings/*`.

## Alternative Flows
- 3a. Request ghi bằng token **không** bị bắt buộc `Content-Type: application/json` (chỉ nhánh cookie bị bắt, UC-503).

## Exceptions
- E1. `Authorization` không bắt đầu bằng `Bearer ` (ví dụ chỉ gửi token trần), token rỗng, token sai, hoặc `API_TOKEN` chưa đặt → `401 { code: "unauthorized", message: "Cần đăng nhập." }`.
- E2. `X-Member-Id` không phải thành viên `active` → `400 { code: "unknown_member", message: "X-Member-Id không hợp lệ." }`.

## Acceptance Criteria
### AC-1: Thiếu hoặc sai token bị chặn
- Given `API_TOKEN = "test-token"`
- When gọi `/v1/wallets` không header; với `Bearer sai`; với `test-token` (không có tiền tố `Bearer `)
- Then cả ba → 401
- Tests: `test/app.test.ts` › "/v1/* cần Bearer token › thiếu hoặc sai token → 401"

### AC-2: Đúng token thì qua cửa
- Given `API_TOKEN = "test-token"`
- When gọi `/v1/wallets` với `Bearer test-token`
- Then qua được `requireAuth` (route không tồn tại nên nhận 404 JSON `not_found`, không phải 401)
- Tests: `test/app.test.ts` › "/v1/* cần Bearer token › đúng token → qua cửa (route chưa có nên 404 dạng JSON)"

### AC-3: Chưa cấu hình token thì khoá hẳn
- Given `API_TOKEN = ""`
- When gọi với `Bearer ` (token rỗng) hoặc không header
- Then 401
- Tests: `test/app.test.ts` › "/v1/* cần Bearer token › API_TOKEN chưa cấu hình thì khoá hẳn, kể cả với token rỗng"

### AC-4: `X-Member-Id` quyết định người ghi
- Given token đúng, `X-Member-Id: wife`
- When `POST /v1/transactions` chi tiền mặt
- Then giao dịch có `by_member_id = "wife"` và tài khoản mặc định là tiền mặt của `wife`
- Tests: `test/api.test.ts` › "nhập tay › chi tiền mặt: ví tự điền từ danh mục, tài khoản mặc định là tiền mặt của người nhập, trả về ví còn bao nhiêu"

### AC-5: Không có `X-Member-Id` thì người xem là chủ hộ
- Given token đúng, không `X-Member-Id`
- When `GET /v1/snapshot`
- Then kết quả trùng `get_snapshot` của MCP (người xem chủ hộ)
- Tests: `test/mcp.test.ts` › "tool đọc số liệu › get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB"

### AC-6: `X-Member-Id` sai bị từ chối
- Given token đúng
- When `X-Member-Id: ai-do`
- Then 400 `unknown_member`
- Tests: ⚠ Chưa có test

## Traceability
- Code: `src/routes/auth.ts` › `requireAuth`, `safeEqual`, `activeMember`, `unauthorized`; `src/env.d.ts` › `AppEnv.Variables.memberId`, `via`
- Migrations/DB: `members`

## Divergences & Open Questions
- [DIVERGENCE] `plans/260921-2228-profit-first-pwa/phase-03-api.md` §"Danh tính người dùng (D6)" nói "Gọi bằng bearer token thì truyền `by_member_id` trong body", nhưng code chọn người bằng header `X-Member-Id` và mặc định chủ hộ (`src/routes/auth.ts` › `requireAuth`); `POST /v1/transactions` không đọc `by_member_id` từ body (`src/routes/v1.ts`).
- [OPEN] Biến `via` được đặt nhưng không thấy route nào đọc `c.get("via")` trong `src/`.
