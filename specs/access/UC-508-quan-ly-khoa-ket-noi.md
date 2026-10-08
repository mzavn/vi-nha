# UC-508: Quản lý kết nối SePay, khoá Telegram, Zalo & gửi thử
- Status: implemented
- BR: BR-08, BR-09, BR-03, BR-06
- Decisions: commit `c80ae89` (khoá đặt được từ app, lưu D1, chỉ trả 4 ký tự cuối — nay 2, ADR-90; `wrangler secret` là dự phòng); commit `6fcbdf8` (báo khoá nằm ở đâu, chỉ cho xoá khoá lưu trong app); ADR-75 (nhiều kết nối SePay — mỗi kết nối một token và một khoá webhook); ADR-80 (Zalo Bot: bot token, khoá webhook, Đặt webhook, gửi thử); ADR-90 (đổi khoá / tắt kết nối thì báo cả nhà và ghi nhật ký; gợi ý 2 ký tự cuối); ADR-94 (kết nối mặc định mang mã hệ thống `default`); ADR-96 (thành viên ngang quyền — ai đăng nhập cũng gỡ được kết nối AI của bất kỳ ai); ADR-97 (Claude nối bằng OAuth; liệt kê và gỡ từng kết nối ở Cài đặt); ADR-98 (đổi mật khẩu, tắt người, Đăng xuất mọi máy cũng gỡ kết nối AI)
- Actor: Thành viên đã đăng nhập (không phân biệt `role`), hoặc script có `API_TOKEN`; Zalo Bot API (`setWebhook`, `sendMessage`); trang uỷ quyền Claude (ghi nhật ký `mcp.connect`)
- Trigger: `PUT /v1/settings/integrations`, `POST /v1/settings/test/telegram`, `POST /v1/settings/test/zalo`, `POST /v1/settings/zalo/webhook`, `POST /v1/settings/sepay/connections`, `PATCH /v1/settings/sepay/connections/:id`, `POST /v1/settings/sepay/connections/:id/test`, `GET /v1/settings/mcp`, `DELETE /v1/settings/mcp/:memberId/:grantId`; mục Kết nối và mục Claude và ứng dụng AI ở màn Cài đặt

## History
- v1 (2026-09-22, commit `c80ae89`): đặt/xoá khoá từ app, `{ set, hint }`, hai nút gửi thử.
- v2 (2026-09-22, commit `6fcbdf8`): thêm `source: "app" | "server" | null`; PWA chỉ hiện nút "Xoá khoá" khi khoá **không** nằm ở server, khoá `server` thì hiện hướng dẫn "xoá thì phải xoá trên Cloudflare".
- v3 (2026-10-01, commit `5dc53be`): không đổi hành vi UC này. Ghi rõ ranh giới: khoá VAPID của thông báo đẩy (`config` `secret:vapid_private_jwk`) **không** phải khoá kết nối — không nằm trong `SECRET_NAMES`, không hiện/không sửa được ở mục Kết nối, không bao giờ trả ra API hay ghi log; tự sinh ở notify UC-410 (change `261001-pwa-web-push`, ADR-64).
- v4 (2026-10-01, commit `9bb75a8`): "Kiểm tra SePay" chuyển sang SePay API v2 (`/v2/bank-accounts` + `/v2/transactions`, hai lời gọi cho cả công ty), báo riêng tài khoản bật SePay ở app mà SePay chưa nối (ADR-65).
- v5 (2026-10-03, commit `a8703fd`): **nhiều kết nối SePay** (ADR-75). Khoá SePay rời `config`/`SECRET_NAMES` sang bảng `sepay_connections` (mỗi kết nối: tên, token API, khoá webhook, bật/tắt); migration 0015 chuyển khoá cũ sang kết nối mặc định `chinh`, `SEPAY_API_TOKEN`/`SEPAY_API_KEY` là dự phòng của riêng kết nối này. Thêm / đổi tên / tạm tắt kết nối, đặt / xoá token và khoá webhook của từng kết nối; hai kết nối không được cùng khoá webhook. "Kiểm tra" theo từng kết nối (`POST /sepay/connections/:id/test`, thay `POST /test/sepay`) và trả thêm `linked` — các tài khoản ngân hàng SePay đang nối với token đó. `PUT /integrations` chỉ còn `telegram_bot_token`.
- v6 (2026-10-03, commit `5bd3117`): **Zalo Bot** (ADR-80, notify UC-411) — `PUT /integrations` nhận thêm `zalo_bot_token`, `zalo_webhook_secret` (khoá webhook 8–256 ký tự, chỉ `A–Z a–z 0–9 _ -`); `SECRET_NAMES` thêm hai khoá (dự phòng `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET`); nút **Đặt webhook** (`POST /zalo/webhook` → `setWebhook` của Zalo với `<origin>/webhooks/zalo`); **Gửi thử Zalo** (`POST /test/zalo`). Đổi tên UC (thêm "Zalo").
- v7 (2026-10-06, commit `d059eaa`): **khoá webhook SePay đặt mới ≥ 24 ký tự** (red-team 6/10 INFRA-01, ADR-89, change [`261006-bao-mat-dang-nhap`](../changes/archive/261006-bao-mat-dang-nhap/proposal.md)) — chỉ kiểm lúc đặt (`secretValue`, 5a/5b); khoá đã lưu (kể cả `SEPAY_API_KEY`) vẫn nhận webhook. Lời dặn ở sheet khoá và sheet thêm kết nối đổi theo.
- v8 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90, red-team INSIDER-01, INSIDER-02, INSIDER-06) — `hint` chỉ còn **2 ký tự cuối** (không bao giờ quá 25% khoá); đặt/đổi/xoá bot token Telegram, Zalo hay khoá webhook Zalo, thêm kết nối SePay có khoá, đặt/đổi/xoá khoá webhook hay token SePay, tắt kết nối → ghi nhật ký (chỉ tên khoá/trường) và **cảnh báo cả nhà**; chỉ đổi tên kết nối → nhật ký, không báo. AC-1, AC-3, AC-9, AC-11 đổi số gợi ý; thêm AC-15…17.
- v9 (2026-10-08, commit `21b9db0`): mã hệ thống tiếng Anh (ADR-94) — migration 0029 (schema v1.29) đổi kết nối mặc định `chinh` → `default` và mọi tài khoản trỏ vào nó; kết nối `default` vẫn là kết nối duy nhất dùng `SEPAY_API_TOKEN` / `SEPAY_API_KEY` dự phòng (hằng `DEFAULT_SEPAY_CONNECTION_ID`). Nhật ký cũ (`target = sepay:chinh`) không viết lại. Thêm AC-18, AC-19 (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))
- v10 (2026-10-08, commit `e5ecf41`): **Claude và ứng dụng AI** (ADR-97) — `GET /v1/settings/mcp` trả địa chỉ MCP `<origin>/mcp` và mọi kết nối OAuth của cả nhà (tên ứng dụng, tên miền đã xác minh, nơi chuyển về, của ai, quyền, ngày nối — không token, mã, khoá); `DELETE /v1/settings/mcp/:memberId/:grantId` gỡ một kết nối (ai đăng nhập cũng gỡ được — ADR-96), nhật ký `mcp.revoke` và báo cả nhà; nối mới ở trang uỷ quyền ghi `mcp.connect` và báo cả nhà (ADR-90). Thêm bước 9–12, alt 9a, E5, AC-20…AC-24, [OPEN] danh sách KV trễ. Đã thử trên prod 2026-10-08 với Claude Code: kết nối mới hiện trong danh sách sau hơn 70 giây; gỡ → 200 (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md))
- v11 (2026-10-08, commit `3e4f427`): Gỡ kết nối đọc thẳng khoá grant trong KV thay vì liệt kê (KV list trễ hơn 1 phút trên prod — vừa nối xong bấm Gỡ thì 404). Kiểm trên prod: nối bằng client CIMD Claude Code → Gỡ → sau 65 giây token cũ 401, refresh 400.

## Preconditions
- Qua `requireAuth`; body là object JSON.

## Main Flow — Khoá Telegram, Zalo
1. `PUT /integrations`: body có thể chứa `telegram_bot_token`, `zalo_bot_token`, `zalo_webhook_secret`; trường không có mặt thì giữ nguyên.
2. Giá trị là chuỗi hoặc `null`. Chuỗi sau `trim` khác rỗng phải dài ≥ 8 ký tự (`secretValue`, dùng chung cho mọi khoá; câu lỗi "Khoá quá ngắn — dán đủ khoá từ SePay / BotFather / Zalo Bot Creator."). `zalo_webhook_secret` thêm: khớp `^[A-Za-z0-9_-]{8,256}$` — Zalo gửi lại nó trong header `X-Bot-Api-Secret-Token`; sai → "Khoá webhook Zalo dài 8–256 ký tự, chỉ gồm chữ không dấu, số, - và _.".
3. Kiểm và ghi lần lượt theo thứ tự `SECRET_NAMES` (`telegram_bot_token`, `zalo_bot_token`, `zalo_webhook_secret`): chuỗi khác rỗng → upsert `config` khoá `secret:<tên>` (giá trị đã `trim`); `null` hoặc chuỗi rỗng → xoá dòng `config` đó, giá trị hiệu lực quay về `wrangler secret` (nếu có) hoặc "chưa đặt".
4. Trả `{ telegram_bot_token, zalo_bot_token, zalo_webhook_secret }`, mỗi khoá `{ set, hint, source }` (không bao giờ trả giá trị; `hint` = 2 ký tự cuối khi khoá dài ≥ 8, không thì "••" — ADR-90).
4a. Body có ít nhất một khoá trong `SECRET_NAMES` (và đã ghi xong) → nhật ký `integrations.update`, `target = null`, `detail = { set: [<tên khoá đặt>], cleared: [<tên khoá xoá>] }` (không bao giờ giá trị) và cảnh báo cả nhà "⚠️ <người>[ (qua API token)] vừa đổi <bot token Telegram, bot token Zalo, khoá webhook Zalo> — nếu không phải người nhà làm, vào Cài đặt gỡ ngay." (`alertMembers`, ADR-90: mọi kênh của mọi thành viên — Telegram bằng token **mới**, Zalo, mọi máy push; gửi sau khi trả lời).
5. Nơi dùng khoá đọc ở mỗi lần dùng (không cache): gửi Telegram / Zalo (`getSecret`), webhook Zalo (`zalo_webhook_secret`), webhook SePay / rà soát 02:00 / đồng bộ lại / nút Kiểm tra (`loadSepayConnections`). Đổi khoá có hiệu lực ngay request kế tiếp. Đổi khoá webhook Zalo thì phải bấm **Đặt webhook** lại — Zalo vẫn gửi khoá cũ tới khi được đặt lại (webhook trả 401).

## Main Flow — Kết nối SePay
5a. `POST /sepay/connections { name, id?, api_token?, webhook_key? }` → `name` bắt buộc (≤ 60); `id` mặc định là slug của tên (`SePay của vợ` → `sepay-cua-vo`), trùng → `409 duplicate`; token/khoá theo luật bước 2, riêng `webhook_key` phải dài ≥ 24 ký tự sau `trim` (E1); khoá webhook đã thuộc kết nối khác → `409 duplicate_key`. Trả `201` kết nối.
5b. `PATCH /sepay/connections/:id` với tập con của `{ name, active, api_token, webhook_key }`: `null`/rỗng = xoá (kết nối `default` quay về `wrangler secret` nếu có); không có kết nối → `404 not_found`; khoá webhook trùng kết nối khác → `409 duplicate_key`. Tắt (`active: false`) = webhook từ chối khoá của nó, rà soát/đồng bộ lại bỏ qua nó, tài khoản không chọn được nó nữa; tài khoản đang thuộc nó giữ nguyên.
5c. Kết nối trả ra (ở `GET /v1/settings` › `integrations.sepay_connections`, theo thứ tự tạo, và ở phản hồi 5a/5b): `{ id, name, active, api_token: { set, hint, source }, webhook_key: { set, hint, source }, accounts: [<id tài khoản thuộc kết nối>] }` — không bao giờ trả token hay khoá.
5d. Sau 5a/5b thành công: nhật ký `sepay.create` / `sepay.update` (`target = sepay:<id>`, `detail = { fields: [<tên trường đã gửi>] }`, 5b thêm `active` hiện tại). Cảnh báo cả nhà (ADR-90 — khoá webhook là chìa vào sổ, tắt kết nối làm giao dịch thật rơi mất) khi: 5a gửi `webhook_key` hoặc `api_token` khác rỗng; 5b gửi `webhook_key` / `api_token` (đặt hay xoá) hoặc `active: false` — câu "⚠️ <người> vừa <đặt khoá webhook | xoá khoá webhook | đặt token API | xoá token API | tắt>[, …] kết nối SePay “<tên>” — …". Chỉ đổi tên / bật lại → không báo.

## Main Flow — Gửi thử Telegram
6. `POST /test/telegram { member_id }` → tìm thành viên `active`; thiếu `tg_chat_id` → `{ sent: false, error: "Chưa có chat_id Telegram của người này." }`; chưa có bot token → `{ sent: false, error: "Chưa đặt bot token Telegram." }`; gửi tin "✅ Ví nhà đã nối Telegram cho <tên>." (tên đã escape HTML) → `{ sent: true }` hoặc `{ sent: false, error: "Telegram từ chối (…). Kiểm tra token và chat_id, và đã nhắn /start cho bot chưa." }`.

## Main Flow — Đặt webhook Zalo
6a. `POST /zalo/webhook` (`setZaloWebhook`) → chưa có bot token → `{ ok: false, url, verified: null, error: "Chưa đặt bot token Zalo." }`; chưa có khoá webhook → `… "Chưa đặt khoá webhook Zalo."`; có đủ → một lời gọi `setWebhook` của Zalo (`POST https://bot-api.zaloplatforms.com/bot<token>/setWebhook`) với `{ url: "<origin>/webhooks/zalo", secret_token: <khoá webhook> }`, không thử lại.
6b. Zalo nhận → `{ ok: true, url, verified }`, `verified` = `result.verification.ok` (Zalo tự gọi thử địa chỉ ngay khi lưu), không có thì `null`; `verified = false` → thêm `error: "Zalo đã lưu địa chỉ nhưng gọi thử chưa được (<outcome>)."`. Zalo từ chối → `{ ok: false, url, verified: null, error }` theo `zaloErrorText`: 426 "Hôm nay đã đặt webhook quá số lần Zalo cho phép — để mai thử lại."; 401 "Bot token Zalo sai hoặc đã bị đặt lại — dán lại token mới ở Kết nối."; 429 "Bot Zalo đã hết lượt gửi (gói miễn phí 3.000 tin mỗi tháng)."; lỗi mạng "Không gọi được Zalo (…). Thử lại sau."; khác "Zalo từ chối (<mã + mô tả>)." Mã lỗi đọc từ `error_code` (hoặc `errorCode`) của thân, không có thì mã HTTP.

## Main Flow — Gửi thử Zalo
6c. `POST /test/zalo { member_id }` (`testZalo`) → thành viên không có / không `active` → `404 not_found`; chưa nối Zalo → `{ sent: false, error: "Người này chưa nối Zalo." }`; chưa có bot token → `{ sent: false, error: "Chưa đặt bot token Zalo." }`; gửi "✅ Ví nhà đã nối Zalo cho <tên>." qua `sendZalo` (luật thử lại của notify UC-411) → `{ sent: true }` hoặc `{ sent: false, error: <zaloErrorText> }`. Không ghi `notifications`.

## Main Flow — Kiểm tra một kết nối SePay
7. `POST /sepay/connections/:id/test` (SePay API v2, ADR-65) → với `Authorization: Bearer <token của kết nối>`: `GET https://userapi.sepay.vn/v2/bank-accounts` (các tài khoản đã nối SePay của công ty đó) và — nếu kết nối có tài khoản ở app — `GET https://userapi.sepay.vn/v2/transactions` khoảng 7 ngày trước đến hết hôm nay (giờ VN), đi hết các trang.
8. Với mỗi tài khoản `active`, `sepay_enabled = 1`, có `account_no`, **thuộc kết nối này**: có trong danh sách SePay → `transactions` = số giao dịch có `account_number` đó; không có → `error: "SePay chưa nối số tài khoản này."`. Lỗi gọi API (`sepayErrorText`): 401/403 → "Token không hợp lệ."; mã HTTP khác → "SePay trả lỗi HTTP N."; lỗi mạng → "Không gọi được SePay." — vào `error` và mọi tài khoản. Trả `{ ok, error?, accounts: [{ id, name, transactions, error? }], linked: [{ account_number, bank, label }] }`; `ok = true` khi gọi được và không tài khoản nào lỗi.

## Main Flow — Claude và ứng dụng AI
9. `GET /v1/settings/mcp` → `{ endpoint: "<origin>/mcp", connections: [{ grantId, memberId, memberName, clientName, clientDomain, redirectHost, scopes, createdAt }] }`: mọi kết nối (grant OAuth, KV `OAUTH_KV`) của mọi thành viên (kể cả người đã tắt — thường đã bị gỡ khi tắt, UC-507 1b), mới nối trước. `clientName` (tên ứng dụng tự khai), `clientDomain` (tên miền đã xác minh của Client ID Metadata Document, vd `claude.ai`, không có thì `null`), `redirectHost` (nơi nhận token) lấy từ thông tin lưu kèm grant lúc uỷ quyền; `scopes` ⊆ `mcp:read`, `mcp:write`; `createdAt` ISO UTC. Không bao giờ trả token, refresh token, mã đổi hay khoá nào.
10. `DELETE /v1/settings/mcp/:memberId/:grantId` → grant phải thuộc người đó, không có → `404 not_found` "Không có kết nối này."; có → thu hồi grant cùng mọi token của nó (refresh chết theo; token đang cầm hết hiệu lực trong vòng 60 giây — KV lan truyền), các kết nối khác giữ nguyên → `{ revoked: true }`. Ai đã đăng nhập cũng gỡ được kết nối của bất kỳ ai (thành viên ngang quyền, ADR-96).
11. Gỡ xong: nhật ký `mcp.revoke`, `target = client:<tên miền | tên ứng dụng>`, `detail = { member_id, grant_id }` và báo cả nhà "⚠️ <người>[ (qua API token)] vừa gỡ kết nối <tên miền | tên ứng dụng> của <tên> — nếu không phải người nhà làm, vào Cài đặt gỡ ngay." (ADR-90).
12. Nối mới (người trong nhà đăng nhập và bấm Cho phép ở trang uỷ quyền — mcp UC-601 AC-9): trang uỷ quyền ghi nhật ký `mcp.connect` (người làm = người uỷ quyền, `via = session`), `target = client:<tên miền | tên ứng dụng>`, `detail = { member_id, scopes }` và báo cả nhà "… vừa nối <tên miền | tên ứng dụng> vào sổ (xem và ghi | chỉ xem) …" (ADR-90). Kết nối gỡ bởi đổi mật khẩu / tắt người / Đăng xuất mọi máy (UC-507, UC-501, ADR-98) không ghi `mcp.revoke` riêng — nằm trong nhật ký của việc đó.

## Alternative Flows
- 7a. Kết nối chưa có token → `error` và mọi tài khoản `"Chưa đặt token API SePay."`, `ok: false`, `linked: []`, không gọi SePay. Kết nối không có → `404 not_found`.
- 9a. Kết nối vừa nối có thể chưa hiện ngay trong danh sách: bản liệt kê của KV cập nhật chậm hơn bản ghi (thử trên prod 2026-10-08: hơn 70 giây). Yêu cầu uỷ quyền đã cấp mã mà ứng dụng chưa đổi lấy token cũng hiện như một kết nối, tối đa 10 phút (hạn của mã).

## Exceptions
- E1. Giá trị khoá không phải chuỗi/`null` → `400 invalid_input`; khoá ngắn hơn 8 ký tự → `400 invalid_input` "Khoá quá ngắn — dán đủ khoá từ SePay / BotFather."; `webhook_key` SePay ngắn hơn 24 ký tự → `400 invalid_input` "Khoá webhook SePay cần ít nhất 24 ký tự — đặt khoá dài, ngẫu nhiên trong SePay rồi dán vào đây." (ADR-89); khoá webhook trùng kết nối khác → `409 duplicate_key` "Khoá webhook này đang dùng cho kết nối khác — mỗi tài khoản SePay đặt một khoá riêng."
- E2. `/test/telegram` thiếu `member_id` → `400 invalid_input` "Thiếu member_id."; thành viên không tồn tại/không active → `404 not_found`.
- E3. SePay trả 401/403 → `error: "Token không hợp lệ."`; mã khác → `"SePay trả lỗi HTTP <mã>."`; lỗi mạng → `"Không gọi được SePay."`.
- E4. `zalo_webhook_secret` dài hơn 256 ký tự hoặc có ký tự ngoài `A–Z a–z 0–9 _ -` → `400 invalid_input`. `/test/zalo` thiếu `member_id` → `400 invalid_input`; thành viên không tồn tại/không active → `404 not_found`. Zalo trả lỗi khi đặt webhook → `{ ok: false, error: <câu dễ hiểu> }` (không ném lỗi).
- E5. `GET` / `DELETE /v1/settings/mcp…` không đăng nhập → 401 (UC-503); gỡ kết nối không có (sai người hoặc sai mã grant) → `404 not_found`.

## Acceptance Criteria
### AC-1: Chỉ trả 2 ký tự cuối, không bao giờ trả nguyên khoá (MODIFIED v8)
- Given đặt khoá webhook `…ab12` của kết nối `default` và `telegram_bot_token` `…zz99` từ app
- When đọc phản hồi `PATCH`/`PUT` và `GET /v1/settings`
- Then `webhook_key = { set: true, hint: "12", source: "app" }`, `telegram_bot_token.hint = "99"`, JSON không chứa khoá; `default` = `{ id: "default", name: "SePay chính", active: true, api_token: { set: false, hint: null, source: null }, …, accounts: ["mb-husband", "tcb-husband", "vcb-husband", "vcb-wife"] }`
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › đặt từ màn Cài đặt: chỉ trả lại 2 ký tự cuối, không bao giờ trả nguyên khoá"

### AC-2: Webhook dùng đúng khoá của app; xoá khoá thì webhook khoá lại
- Given đặt khoá webhook của `default` từ app, không có `SEPAY_API_KEY`
- When webhook gửi đúng khoá / khoá sai / đúng khoá sau khi gửi `null`
- Then 200 / 401 / 401
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › webhook dùng đúng khoá đặt ở màn Cài đặt; xoá khoá thì webhook khoá lại"

### AC-3: Khoá `wrangler secret` vẫn dùng được, được đánh dấu `server`
- Given `SEPAY_API_KEY` đặt ở env, không có khoá trong app
- When `GET /v1/settings`
- Then kết nối `default` có `webhook_key = { set: true, hint: "76", source: "server" }` (khoá `…9876`)
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › khoá đặt bằng wrangler secret vẫn dùng được khi màn Cài đặt để trống"

### AC-4: Khoá quá ngắn bị từ chối
- When `PUT` `telegram_bot_token: "abc"`
- Then 400
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › khoá quá ngắn bị từ chối"

### AC-5: Tin Telegram dùng bot token của app
- Given `telegram_bot_token` đặt từ app, `husband` có `tg_chat_id`
- When `notifyMembers` gửi tin
- Then URL gọi chứa `/bot<token>/sendMessage`
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › tin Telegram dùng bot token đặt ở màn Cài đặt"

### AC-6: Gửi thử Telegram báo rõ nguyên nhân
- Given lần lượt: thiếu chat_id; có chat_id thiếu token; đủ cả hai
- When `testTelegram(env, "husband")`
- Then lỗi chat_id; lỗi chứa "bot token"; `{ sent: true }`
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › gửi thử Telegram: báo rõ khi thiếu chat_id, thiếu token, hoặc gửi được"

### AC-7: Kiểm tra một kết nối SePay (API v2): liệt kê tài khoản SePay đang nối, đếm theo tài khoản, báo tài khoản chưa nối, báo token sai
- Given token của `default` đặt từ app; SePay có tài khoản `0011xxxxxxx` (của `vcb-husband`, MBBank, nhãn "Chồng") và 2 giao dịch của nó trong 7 ngày
- When kiểm tra `default`; rồi SePay trả 401
- Then gọi lần lượt `/v2/bank-accounts`, `/v2/transactions`; `linked = [{ account_number: "0011xxxxxxx", bank: "MBBank", label: "Chồng" }]`; `vcb-husband` có `transactions: 2`; `tcb-husband` (không có trong SePay) báo "SePay chưa nối số tài khoản này.", `ok: false`; rồi `error: "Token không hợp lệ."`
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › kiểm tra một kết nối SePay (API v2): liệt kê tài khoản SePay đang nối; tài khoản có trong SePay thì đếm giao dịch 7 ngày; chưa nối thì báo; token sai thì báo"

### AC-8: PWA chỉ cho xoá khoá lưu trong app
- Given khoá có `source = "server"`
- When mở sheet khoá
- Then không có nút "Xoá khoá", chỉ có gợi ý xoá trên Cloudflare
- Tests: ⚠ Chưa có test (UI `web/src/screens/settings-sheets.tsx` › `SecretSheet`)

### AC-9: Thêm kết nối SePay thứ hai; không bao giờ trả nguyên khoá; khoá webhook không được trùng
- Given chỉ có kết nối `default`
- When thêm "SePay của vợ" (`id: "sepay-wife"`) với token `…7777` và khoá webhook `…8888`; thêm lại cùng tên; đặt khoá `…8888` cho `default`; đặt khoá 4 ký tự cho vợ; đổi tên thành "SePay vợ", tắt, xoá token; sửa kết nối không có
- Then `201 { id: "sepay-wife", api_token.hint "77", webhook_key.hint "88", accounts: [] }`; `409`; `409 duplicate_key`; `400`; kết nối `{ name: "SePay vợ", active: false, api_token: { set: false } }`; `GET` không chứa khoá, thứ tự `["default", "sepay-wife"]`; `404`
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › thêm kết nối SePay thứ hai với token và khoá riêng, không bao giờ trả nguyên khoá; đổi tên, tạm tắt được; khoá webhook trùng kết nối khác bị chặn"

### AC-10: Migration 0015 chuyển khoá SePay cũ sang kết nối mặc định (mã lúc đó `chinh`, 0029 đổi thành `default` — AC-18)
- Given trước 0015, `config` có `secret:sepay_api_token`, `secret:sepay_webhook_key`, `secret:telegram_bot_token`; `vcb-em` tắt SePay
- When chạy `migrations/0015_sepay_connections.sql`
- Then có đúng kết nối `chinh` "SePay chính" mang token và khoá cũ; `config` chỉ còn `secret:telegram_bot_token`; các TK đang bật SePay thuộc `chinh`, `vcb-em` không thuộc kết nối nào; gán kết nối không có → lỗi khoá ngoại
- Tests: test migration ở repo gốc

### AC-11: Khoá Zalo không bao giờ trả nguyên văn; khoá webhook chỉ gồm chữ, số, `-`, `_`
- Given đặt `zalo_bot_token` và `zalo_webhook_secret` từ app
- When đọc phản hồi `PUT` và `GET /v1/settings`; rồi đặt khoá webhook có khoảng trắng / chữ có dấu / dài 257 ký tự; rồi xoá khoá webhook; rồi xoá bot token khi có `ZALO_BOT_TOKEN` ở env
- Then mỗi khoá `{ set: true, hint: <2 ký tự cuối>, source: "app" }`, JSON không chứa khoá; nhật ký đúng một dòng `integrations.update { set: ["zalo_bot_token", "zalo_webhook_secret"], cleared: [] }`; `integrations.zalo_webhook_url = "https://vi-nha.example/webhooks/zalo"`; ba khoá sai dạng → 400; xoá → `{ set: false, hint: null, source: null }`; bot token quay về `{ set: true, hint: "77", source: "server" }`
- Tests: `test/zalo.test.ts` › "cài đặt Zalo › khoá Zalo không bao giờ trả nguyên văn, chỉ 2 ký tự cuối; khoá webhook chỉ gồm chữ, số, - và _"

### AC-12: Đặt webhook gọi `setWebhook` đúng địa chỉ và khoá; lỗi Zalo nói dễ hiểu
- Given chưa đặt khoá; rồi token và khoá webhook đã đặt; gọi từ `https://vi-nha.example`
- When `POST /v1/settings/zalo/webhook`; rồi Zalo trả 426; rồi 401; rồi Zalo lưu nhưng `verification.ok = false`
- Then `{ ok: false, verified: null, error: "Chưa đặt bot token Zalo." }`; lời gọi `/bot<token>/setWebhook` mang `{ url: "https://vi-nha.example/webhooks/zalo", secret_token: <khoá webhook> }`, trả `{ ok: true, url, verified: true }`; 426 → lỗi nói đặt quá số lần; 401 → lỗi nói token Zalo sai; gọi thử chưa được → `{ ok: true, verified: false }` kèm `outcome` của Zalo trong lỗi
- Tests: `test/zalo.test.ts` › "cài đặt Zalo › Đặt webhook gọi setWebhook với địa chỉ /webhooks/zalo và khoá webhook; báo lỗi Zalo dễ hiểu"

### AC-13: Gửi thử Zalo báo rõ nguyên nhân
- Given lần lượt: người chưa nối Zalo; đã nối mà chưa có token; đủ cả hai
- When `testZalo(env, "husband")`; rồi `POST /v1/settings/test/zalo { member_id: "husband" }`
- Then "Người này chưa nối Zalo."; lỗi nói chưa đặt bot token; `{ sent: true }` với `sendMessage` `{ chat_id: "z-husband", text: "✅ Ví nhà đã nối Zalo cho Chồng." }`; route trả `{ sent: true }`
- Tests: `test/zalo.test.ts` › "cài đặt Zalo › gửi thử Zalo: báo khi chưa nối, chưa có token, hoặc gửi được"

### AC-14: Khoá webhook SePay mới cần ít nhất 24 ký tự; khoá ngắn đã lưu vẫn dùng được
- Given kết nối `default`
- When đặt khoá webhook 23 ký tự; thêm kết nối mới với khoá 19 ký tự; đặt khoá 24 ký tự; rồi (như dữ liệu cũ) khoá 12 ký tự `khoa-cu-5678` nằm sẵn trong `sepay_connections` và SePay gửi webhook kèm khoá đó
- Then 400 với câu "… ít nhất 24 ký tự …"; 400; 200; webhook 200
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › khoá webhook SePay mới cần ít nhất 24 ký tự; khoá ngắn đã lưu từ trước vẫn nhận webhook (ADR-89)"

### AC-15: Đổi khoá / token SePay hay tắt kết nối thì báo cả nhà; chỉ đổi tên thì không (ADR-90)
- Given bot token Telegram; "husband" chat `1001`, "wife" chat `2002`
- When "wife" đặt khoá webhook của `default` (API token); đổi tên `default` thành "SePay nhà"; tắt `default` và xoá token; thêm kết nối "SePay lạ" có khoá webhook
- Then cả `1001` và `2002` nhận "⚠️ Vợ (qua API token) vừa đặt khoá webhook kết nối SePay “SePay chính” — nếu không phải người nhà làm, vào Cài đặt gỡ ngay."; đổi tên không gửi tin nào; tắt → hai tin "… vừa xoá token API, tắt kết nối SePay “SePay nhà” …"; thêm → hai tin "… vừa đặt khoá webhook kết nối SePay “SePay lạ” …"
- Tests: `test/audit.test.ts` › "cảnh báo cả nhà khi kênh báo tin hay khoá đổi › đặt/đổi khoá webhook, token SePay hay tắt kết nối → mọi kênh được báo; chỉ đổi tên thì không"

### AC-16: Đổi bot token Telegram / khoá Zalo thì báo cả nhà (ADR-90)
- Given bot token Telegram cũ; chat `1001`, `2002`
- When `PUT /integrations { telegram_bot_token: <mới>, zalo_webhook_secret: … }`
- Then hai tin gửi bằng **token mới** tới `1001`, `2002`, có "vừa đổi bot token Telegram, khoá webhook Zalo"
- Tests: `test/audit.test.ts` › "cảnh báo cả nhà khi kênh báo tin hay khoá đổi › đổi bot token Telegram / Zalo thì báo cả nhà (qua token mới tới các chat đang có)"

### AC-17: Nhật ký khoá và kết nối chỉ ghi tên trường, không bao giờ ghi khoá (ADR-90)
- Given khoá webhook, token SePay, bot token Telegram
- When `PUT /integrations`, thêm kết nối có token + khoá, sửa `default` (khoá mới, tắt)
- Then nhật ký `integrations.update { set: ["telegram_bot_token"], cleared: [] }`, `sepay.create { fields: ["api_token", "name", "webhook_key"] }`, `sepay.update { fields: ["active", "webhook_key"], active: false }`; toàn bộ bảng `audit_log` không chứa chuỗi khoá nào
- Tests: `test/audit.test.ts` › "nhật ký thay đổi › sửa tài khoản, thành viên, khoá, kết nối SePay chỉ ghi tên trường — không bao giờ ghi khoá; nhật ký không sửa, không xoá được"

### AC-18: Migration 0029 đổi kết nối mặc định `chinh` → `default`, gửi / nhận không đổi
- Given DB như prod có kết nối SePay `chinh` (token, khoá webhook) và tài khoản trỏ vào nó
- When chạy migration 0029
- Then kết nối mang mã `default` giữ nguyên token, khoá webhook, tên; mọi tài khoản trỏ `default`; khoá ngoại sạch; chạy lại không đổi gì; nhật ký cũ giữ nguyên
- Tests: test migration ở repo gốc

### AC-19: Kết nối `default` vẫn dùng khoá `wrangler secret` dự phòng
- Given sau 0029, kết nối `default` chưa đặt token / khoá webhook trong app; `SEPAY_API_TOKEN` / `SEPAY_API_KEY` đặt ở env
- When `GET /v1/settings`
- Then kết nối đầu tiên trong `integrations.sepay_connections` có `id = 'default'`, token và khoá webhook `source: "server"` (lấy từ env, như `chinh` trước đây)
- Tests: test migration ở repo gốc; hộ mẫu: [`test/schema.test.ts`](../../test/schema.test.ts) › "seed › có đủ dữ liệu hệ thống: kết nối SePay 'default' cho mọi tài khoản bật SePay, danh mục trả nợ / cho vay, nguồn thu cho thuê, config rental_* và notify_*"

### AC-20: Mục Claude cần đăng nhập
- Given không cookie / token
- When `GET /v1/settings/mcp`; `DELETE /v1/settings/mcp/wife/abc`
- Then 401 cả hai
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › cần đăng nhập"

### AC-21: Liệt kê kết nối — ứng dụng, của ai, quyền, ngày nối; không token, mã, khoá (ADR-97)
- Given `wife` nối Claude (CIMD `claude.ai`) chỉ quyền Xem
- When `GET /v1/settings/mcp` (gọi từ `http://localhost`)
- Then `{ endpoint: "http://localhost/mcp", connections: [{ grantId, memberId: "wife", memberName: "Vợ", clientName: "Claude", clientDomain: "claude.ai", redirectHost: "claude.ai", scopes: ["mcp:read"], createdAt: <ISO> }] }`; JSON không chứa token, refresh token; `GET /v1/settings` không chứa mã grant
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › GET trả địa chỉ MCP và danh sách kết nối (ứng dụng, của ai, quyền, ngày nối) — không có token, mã, khoá"

### AC-22: Gỡ một kết nối — token hết hiệu lực, refresh chết, có nhật ký; kết nối khác còn nguyên (ADR-96, ADR-97)
- Given `wife` và `husband` mỗi người nối Claude
- When `DELETE /v1/settings/mcp/wife/<grant của wife>` bằng API token (người làm mặc định chủ hộ)
- Then 200 `{ revoked: true }`; `/mcp` bằng token của `wife` → 401, refresh của `wife` chết; token của `husband` vẫn chạy; nhật ký đúng một dòng `mcp.revoke` (`member_id = "husband"`, `via = "token"`, `target = "client:claude.ai"`, `detail = { member_id: "wife", grant_id }`)
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › Gỡ một kết nối → token hết hiệu lực, refresh chết; nhật ký mcp.revoke; kết nối khác còn nguyên"

### AC-23: Gỡ kết nối không có → 404
- Given không có grant `khong-co` của `wife`
- When `DELETE /v1/settings/mcp/wife/khong-co`
- Then 404
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › gỡ kết nối không có → 404"

### AC-24: Nối mới ghi nhật ký `mcp.connect` gắn người uỷ quyền
- Given `wife` đăng nhập ở trang uỷ quyền, bấm Cho phép với quyền Xem + Ghi
- When Claude đổi mã lấy token (đúng `code_verifier`)
- Then nhật ký đúng một dòng `mcp.connect` (`member_id = "wife"`, `via = "session"`, `target = "client:claude.ai"`, `detail = { member_id: "wife", scopes: ["mcp:read", "mcp:write"] }`)
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-9: trang uỷ quyền › Cho phép → mã chuyển về Claude; đổi mã lấy token cần đúng code_verifier (PKCE); nhật ký mcp.connect gắn người uỷ quyền"

## Traceability
- Code: `src/routes/settings.ts` › `settingsRoutes.put("/integrations")`, `SECRET_LABEL`, `sepayAlert`, `.post("/test/telegram")`, `.post("/sepay/connections")`, `.patch("/sepay/connections/:id")`, `.post("/sepay/connections/:id/test")`; `src/services/audit.ts` › `recordChange`, `alertMembers`, `fieldNames`; `src/services/settings.ts` › `secretValue`, `updateIntegrations`, `connectionView`, `readConnection`, `webhookKeyFree`, `createSepayConnection`, `updateSepayConnection`, `testTelegram`, `testSepay`, `getSettings`; `src/services/secrets.ts` › `SECRET_NAMES`, `ENV_FALLBACK`, `describeValue`, `getSecret`, `describeSecret`, `setSecret`, `loadSepayConnections`; `src/domain/system-ids.ts` › `DEFAULT_SEPAY_CONNECTION_ID`; `src/services/sepay-api.ts` › `listBankAccounts`, `sepayErrorText`; người dùng khoá: `src/routes/webhooks.ts`, `src/cron/backfill.ts` › `syncSepay`, `src/notify/telegram.ts` › `notifyMembers`
- Code (Zalo, ADR-80): `src/routes/settings.ts` › `.post("/test/zalo")`, `.post("/zalo/webhook")`; `src/services/zalo.ts` › `setZaloWebhook`, `testZalo`; `src/notify/zalo.ts` › `callZalo`, `sendZalo`; `src/services/settings.ts` › `updateIntegrations` (kiểm khoá webhook Zalo), `getSettings` (`zalo_webhook_url`); `src/env.d.ts` › `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET`
- PWA: `web/src/screens/settings.tsx` › `Connections`; `web/src/screens/settings-sheets.tsx` › `SecretSheet`; `web/src/lib/settings.ts` › `secretPayload`, `clearSecretPayload`
- Migrations/DB: `config` khoá `secret:telegram_bot_token`, `secret:zalo_bot_token`, `secret:zalo_webhook_secret`; `sepay_connections` (`migrations/0015_sepay_connections.sql`; mã kết nối mặc định đổi `chinh` → `default` ở `migrations/0029_system_ids.sql`; hộ mẫu `docs/schema.sql` có sẵn dòng `default`)
- Code (Claude và ứng dụng AI, ADR-97): `src/routes/settings.ts` › `settingsRoutes.get("/mcp")`, `settingsRoutes.delete("/mcp/:memberId/:grantId")`; `src/oauth/server.ts` › `oauthApi`, `listMemberGrants`, `GrantMetadata`, `MCP_PATH`; `src/oauth/routes.ts` › `decide` (nhật ký `mcp.connect`); KV `OAUTH_KV` (`wrangler.jsonc` › `kv_namespaces`)
- Liên quan: `specs/ingest/` (UC-301 Nhận webhook SePay, UC-304 Rà soát 02:00 & đồng bộ lại), `specs/notify/` (Gửi tin Telegram chống gửi trùng; UC-411 Gửi tin qua Zalo Bot), ADR-75, ADR-80

## Divergences & Open Questions
- [OPEN] Khoá lưu **nguyên văn** trong D1 (`config`, `sepay_connections`), không mã hoá. Bản sao lưu `wrangler d1 export …` (hướng dẫn trong `README.md`) sẽ chứa khoá. Red-team SC-02 (6/10): ghi nhận là rủi ro chấp nhận ở ADR-90, backlog mã hoá bằng khoá trong `wrangler secret`.
- [OPEN] Server vẫn chấp nhận `null` cho khoá có `source = "server"` (không lỗi, không đổi gì vì cột/dòng app đã trống); việc "chỉ cho xoá khoá app" chỉ được thực thi ở PWA.
- [OPEN] Không xoá được kết nối SePay, chỉ tạm tắt (tài khoản và log cũ vẫn trỏ về nó).
- [OPEN] PWA chặn khoá có khoảng trắng ở giữa (`secretPayload`, test `web/src/lib/settings.test.ts` › "bí mật chỉ ghi › đặt khoá mới: bỏ khoảng trắng hai đầu, chặn rỗng và khoảng trắng giữa"); server không chặn.
- [OPEN] Đổi khoá webhook Zalo trong app không tự gọi lại `setWebhook` — Zalo vẫn gửi khoá cũ và webhook trả 401 cho tới khi bấm **Đặt webhook** lại; app không nhắc việc này ngoài trạng thái nút.
- [OPEN] `PUT /integrations` kiểm và ghi từng khoá lần lượt: một khoá sau sai dạng (vd `zalo_webhook_secret`) thì khoá trước trong cùng request (vd `zalo_bot_token`) đã được ghi dù request trả 400 — và lần ghi dở đó **không** có nhật ký hay cảnh báo (ADR-90 chỉ ghi khi request thành công).
- [OPEN] Kết nối mới hiện trong `GET /v1/settings/mcp` chậm (bản liệt kê của KV cập nhật sau bản ghi — thử trên prod 2026-10-08: hơn 70 giây), và yêu cầu đã cấp mã mà ứng dụng chưa đổi lấy token cũng hiện như kết nối tới 10 phút (alt 9a). Chưa có cách hiện "đang chờ" hay tự tải lại; người nhà nối xong không thấy ngay có thể tưởng chưa được.
