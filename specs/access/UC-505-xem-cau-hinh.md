# UC-505: Xem toàn bộ cấu hình (màn Cài đặt)
- Status: implemented
- BR: BR-08, BR-09
- Decisions: commit `c80ae89` ("Everything that previously needed wrangler or SQL can now be configured from the app"); `plans/reports/ui-ux-designer-260922-1150-settings-screen.md`; ADR-92 (tên khoá cấu hình tiếng Anh); ADR-93 (Quỹ an tâm — `safety_fund_months`); ADR-95 (`has_password`, không lộ băm); ADR-97 (kết nối Claude qua OAuth — danh sách riêng ở `GET /v1/settings/mcp`, không nằm trong cấu hình)
- Actor: Thành viên đã đăng nhập, hoặc script có `API_TOKEN`
- Trigger: `GET /v1/settings`, `GET /v1/settings/audit`

## History
- v1 (2026-09-22, commit `c80ae89`): trả đủ các phần cấu hình + URL webhook.
- v2 (2026-09-22, commit `6fcbdf8`): mỗi khoá kết nối có thêm `source` (`app`/`server`).
- v3 (2026-10-01, commit `034b7ff`): thêm phần `incomeStreams` (nguồn thu kèm phần khóa); luật nạp có `splitWeekly`; rule có `incomeStreamId` (change `261001-cho-thue-lai`).
- v4 (2026-10-01, commit `a301077`): thêm phần `notifySchedule` — giờ nhắc của cả nhà (ADR-68, UC-507).
- v5 (2026-10-03, commit `a8703fd`): `integrations` thay hai khoá SePay bằng danh sách `sepay_connections` (ADR-75, UC-508); mỗi tài khoản có thêm `sepay_connection_id`.
- v6 (2026-10-03, commit `f74bc70`): rule trả thêm `account_id`, `counter_account_id`, `from_wallet_id` (mọi cột, schema v1.17, ADR-77); tài khoản **không** trả `locked` (heo đất chỉ thấy ở bức tranh tiền thật — receivable UC-1005).
- v7 (2026-10-03, commit `5bd3117`): thành viên trả thêm `zalo_chat_id`; `integrations` thêm `zalo_bot_token`, `zalo_webhook_secret` (`{ set, hint, source }`) và `zalo_webhook_url` = `<origin>/webhooks/zalo` (ADR-80, UC-508, notify UC-411).
- v8 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90) — `hint` của khoá chỉ còn 2 ký tự cuối; thêm `GET /v1/settings/audit` (50 dòng nhật ký thay đổi mới nhất, mới trước, kèm tên người). AC-3, AC-5 đổi tên test; thêm AC-6.
- v9 (2026-10-07, commit `7424f26`): khoá cấu hình số tháng Quỹ an tâm (trước gọi "phao khẩn cấp") đổi tên `emergency_months` → `safety_fund_months` (migration 0028, schema v1.28; ADR-92, ADR-93): `config` trả `{ salary_min_amount, safety_fund_months }`, mặc định vẫn `6`. AC-1 sửa theo tên mới (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v10 (2026-10-08, commit `1ed22e1`): thành viên trả thêm `has_password` (ADR-95), không bao giờ trả băm / muối / số vòng; `secret:session_key`, `setup_done` không trả ra. Thêm AC-7 (change [261007-thiet-lap-lan-dau](../changes/archive/261007-thiet-lap-lan-dau/proposal.md))
- v11 (2026-10-08, commit `e5ecf41`): kết nối Claude / ứng dụng AI (OAuth, ADR-97) **không** nằm trong `GET /v1/settings` — không token, mã hay khoá nào, kể cả mã grant; danh sách riêng ở `GET /v1/settings/mcp` (UC-508). Nhật ký thay đổi có thêm `mcp.connect`, `mcp.revoke` và việc ghi qua Claude (`via = mcp`). Thêm bước 3a, AC-8 (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md))

## Preconditions
- Qua `requireAuth` (UC-503). Không phân quyền theo `role`: mọi thành viên đã đăng nhập đều xem được.

## Main Flow
1. Server đọc trong một `db.batch`: tài khoản, ví (kèm luật nạp đang `active`), thành viên, mã chuyển khoản, danh mục đang `active`, nguồn thu (`income_streams`) và phần khóa (`income_stream_locks`).
2. Server mô tả khoá Telegram và Zalo bằng `describeSecret` và đọc mọi kết nối SePay bằng `loadSepayConnections` (UC-508) — không bao giờ trả giá trị khoá.
3. Trả `{ accounts, wallets, members, rules, categories, incomeStreams, config, notifySchedule, integrations }`:
   - `accounts`: xếp `active DESC, kind, name`; `sepay_enabled`, `sepay_out`, `active` là boolean; `sepay_connection_id` = kết nối SePay của tài khoản hoặc `null` (UC-506). Không có `locked` (`ACCOUNT_SQL` liệt kê cột, ADR-77).
   - `wallets`: xếp `sort, name`; `private`, `active` boolean; `allocation` = luật nạp đang `active` (`mode, period, amount, percent, target_amount, target_date, floor_amount, priority, splitWeekly`) hoặc `null`; `splitWeekly` boolean (phong bì tháng chia đều theo tuần, UC-506).
   - `members`: `id, name, role, tg_chat_id, zalo_chat_id, active, has_password` — chủ hộ trước, rồi theo `name`. `zalo_chat_id` khác `null` = đã nối Zalo (mã nối đang chờ không bao giờ trả ở đây). `has_password` = người đó vào bằng mật khẩu riêng (ADR-95); **không bao giờ** trả băm, muối hay số vòng. Khoá ký phiên `secret:session_key` và `setup_done` trong `config` không bao giờ trả ra.
   - `rules`: mọi cột (kể cả `income_stream_id`, `tenant_id`, `account_id`, `counter_account_id`, `from_wallet_id`), xếp `active DESC, priority, id`; thêm `incomeStreamId` (= `income_stream_id` hoặc `null`).
   - `categories`: `id, name, defaultWalletId` của danh mục `active`.
   - `incomeStreams`: mọi nguồn thu (kể cả đã tắt), xếp `sort, name`: `{ id, name, sort, active, locks: [{ walletId, percent }] }` — `locks` xếp `sort, wallet_id`, rỗng = không khóa gì (ADR-59). Cấu hình cho thuê không nằm ở đây mà ở `GET /v1/rental` (rental [UC-801](../rental/UC-801-thiet-lap-nguoi-thue.md)).
   - `config`: `{ salary_min_amount, safety_fund_months }` — `safety_fund_months` là số tháng chi Must của Quỹ an tâm (ADR-93); thiếu/không phải số nguyên thì mặc định `1_000_000` và `6`.
   - `notifySchedule`: `{ dailyTime, weeklyDay, weeklyTime, quietStart, quietEnd, dailyEnabled, weeklyEnabled, pendingEnabled }` — giờ `"HH:MM"` giờ VN, `weeklyDay` 1 = thứ Hai .. 7 = Chủ nhật, cờ là boolean; đọc một câu từ các khoá `notify_*` của `config`, thiếu/hỏng thì mặc định `07:00`, 1, `08:00`, `22:00`, `06:30`, bật cả ba (notify [entities](../notify/entities.md) § Giờ nhắc).
   - `integrations`: `{ webhook_url: "<origin>/webhooks/sepay", telegram_bot_token: { set, hint, source }, zalo_bot_token: { set, hint, source }, zalo_webhook_secret: { set, hint, source }, zalo_webhook_url: "<origin>/webhooks/zalo", sepay_connections: [{ id, name, active, api_token: { set, hint, source }, webhook_key: { set, hint, source }, accounts: [<id tài khoản>] }] }` — kết nối theo thứ tự tạo, mọi kết nối kể cả đã tắt (UC-508); `hint` = 2 ký tự cuối (ADR-90).
3a. Kết nối Claude / ứng dụng AI (grant OAuth trong KV `OAUTH_KV`, ADR-97) **không** có trong phản hồi này — không token, mã đổi, khoá hay mã grant nào. Màn Cài đặt đọc chúng riêng qua `GET /v1/settings/mcp` (UC-508 — chỉ tên ứng dụng, tên miền, của ai, quyền, ngày nối).
4. `GET /v1/settings/audit` → 50 dòng `audit_log` mới nhất (`id DESC`): `[{ id, at, memberId, memberName, via, action, target, detail }]` — `detail` đã parse JSON, không bao giờ chứa khoá (access entities § AuditLog, ADR-90). `via` ∈ `session` · `token` · `mcp`; `action` gồm cả nối / gỡ ứng dụng AI (`mcp.connect`, `mcp.revoke`) và việc ghi qua Claude (`tx.create`, `log.assign`, `income.allocate`, `tenant.paid_for_us`).

## Alternative Flows
- Không có.

## Exceptions
- E1. Chưa xác thực → 401.

## Acceptance Criteria
### AC-1: Trả đủ các phần, URL webhook theo origin của request
- Given seed mặc định, gọi từ `https://vi-nha.example`
- When `GET /v1/settings`
- Then khoá đúng chín phần `accounts, categories, config, incomeStreams, integrations, members, notifySchedule, rules, wallets`; `integrations.webhook_url = "https://vi-nha.example/webhooks/sepay"`; `config = { salary_min_amount: 1000000, safety_fund_months: 6 }`; `notifySchedule` là bộ mặc định (`07:00`, thứ 1 `08:00`, yên lặng `22:00`–`06:30`, bật cả ba); ví `nice-to-have` có `allocation.mode = "remainder"`
- Tests: `test/settings.test.ts` › "đọc cài đặt › trả đủ các phần, kèm URL webhook để dán vào SePay"

### AC-2: Cần đăng nhập
- Given không cookie/token
- When `GET /v1/settings`
- Then 401
- Tests: `test/settings.test.ts` › "đọc cài đặt › cần đăng nhập"

### AC-3: Không bao giờ trả nguyên khoá
- Given khoá webhook đã đặt từ app (kết nối `default`, rồi kết nối thứ hai "SePay của vợ")
- When `GET /v1/settings`
- Then toàn bộ JSON trả về không chứa chuỗi khoá
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › đặt từ màn Cài đặt: chỉ trả lại 2 ký tự cuối, không bao giờ trả nguyên khoá"; "khoá kết nối SePay / Telegram › thêm kết nối SePay thứ hai với token và khoá riêng, không bao giờ trả nguyên khoá; đổi tên, tạm tắt được; khoá webhook trùng kết nối khác bị chặn"

### AC-4: Đọc hồ sơ nguồn thu seed
- Given seed mặc định (migration 0007)
- When `GET /v1/settings`
- Then `incomeStreams` có `{ id: "salary-wife", name: "Lương vợ", sort: 20, active: true, locks: [{ walletId: "wealth-building", percent: 0.45 }] }`
- Tests: `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › đọc hồ sơ nguồn thu seed; thêm/sửa nguồn; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối"

### AC-5: Khoá Zalo chỉ trả 2 ký tự cuối, kèm địa chỉ webhook Zalo (MODIFIED v8)
- Given `zalo_bot_token`, `zalo_webhook_secret` đặt từ app
- When `GET /v1/settings`
- Then `integrations.zalo_bot_token`/`zalo_webhook_secret` là `{ set: true, hint, source: "app" }`, JSON không chứa khoá; `integrations.zalo_webhook_url = "<origin>/webhooks/zalo"`
- Tests: `test/zalo.test.ts` › "cài đặt Zalo › khoá Zalo không bao giờ trả nguyên văn, chỉ 2 ký tự cuối; khoá webhook chỉ gồm chữ, số, - và _"

### AC-6: Nhật ký thay đổi — 50 dòng mới nhất, mới trước (ADR-90)
- Given 60 dòng `audit_log` (`tx.void`, xen kẽ "husband"/"wife")
- When `GET /v1/settings/audit`
- Then 200, 50 dòng; dòng đầu `{ id: 60, memberId: "wife", memberName: "Vợ", via: "session", action: "tx.void", target: "tx:60", detail: null }`; dòng cuối `id = 11`
- Tests: `test/audit.test.ts` › "nhật ký thay đổi › GET /v1/settings/audit trả 50 dòng mới nhất, mới trước, kèm tên người"

### AC-7: Thành viên có `has_password`, không lộ băm (ADR-95)
- Given một người có mật khẩu riêng, một người không
- When `GET /v1/settings`
- Then mỗi phần tử `members` có `has_password` `true` / `false`; JSON không chứa băm, muối, số vòng hay `secret:session_key`
- Tests: [`test/members.test.ts`](../../test/members.test.ts) › "UC-507 AC-14: GET /v1/settings trả has_password › mỗi thành viên có has_password: boolean, không bao giờ có băm, muối hay số vòng"; [`test/login.test.ts`](../../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-14: khoá ký phiên tự sinh trong D1 › khoá 32 byte ngẫu nhiên sinh một lần (hai lần đăng nhập đầu cùng lúc dùng cùng khoá), không API nào trả ra"

### AC-8: Cấu hình không chứa gì của kết nối Claude (ADR-97)
- Given `wife` đã nối Claude (có token, refresh token, mã grant)
- When `GET /v1/settings`; `GET /v1/settings/mcp`
- Then JSON của `GET /v1/settings` không chứa mã grant; `GET /v1/settings/mcp` chỉ có `endpoint` và `connections` (tên ứng dụng, tên miền, của ai, quyền, ngày nối) — không chứa token hay refresh token
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › GET trả địa chỉ MCP và danh sách kết nối (ứng dụng, của ai, quyền, ngày nối) — không có token, mã, khoá"

## Traceability
- Code: `src/routes/settings.ts` › `settingsRoutes.get("/")`; `src/services/settings.ts` › `getSettings`, `ACCOUNT_SQL`, `toAccount`, `WALLET_SQL`, `toWallet`, `toRule`, `STREAM_SQL`, `LOCK_SQL`, `toStreams`, `configNumber`, `readNotifySchedule`, `connectionView`; `src/domain/notify-schedule.ts` › `parseNotifySchedule`; `src/services/secrets.ts` › `describeSecret`, `SECRET_NAMES`, `loadSepayConnections`
- Migrations/DB: `accounts`, `wallets`, `allocations` (`split_weekly`), `members` (`zalo_chat_id`: `migrations/0018_zalo.sql`; `password_hash` → `has_password`: `migrations/0030_setup_and_member_passwords.sql`), `rules`, `categories`, `config` (khoá `notify_*`: `migrations/0011_notify_schedule.sql`; `emergency_months` → `safety_fund_months`: `migrations/0028_english_names.sql`), `income_streams`, `income_stream_locks` (`migrations/0007_income_streams_rental.sql`), `sepay_connections`, `accounts.sepay_connection_id` (`migrations/0015_sepay_connections.sql`)

## Divergences & Open Questions
- [OPEN] `config.salary_min_amount` ở màn Cài đặt dùng `configNumber` (mọi số nguyên, mặc định 1.000.000), còn ingest dùng `ledger.salaryMinAmount` (chỉ số nguyên ≥ 0, mặc định 1.000.000). Hai hàm đọc cùng khoá với luật hơi khác; API ghi chỉ cho 0..1e12 nên hiện chưa lệch được qua app.
