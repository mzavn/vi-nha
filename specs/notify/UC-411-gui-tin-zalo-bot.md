# UC-411: Gửi tin qua Zalo Bot (nối bằng mã)
- Status: implemented
- BR: BR-06, BR-08, BR-09
- Decisions: ADR-80 (Zalo Bot là kênh thứ ba, nối bằng mã 6 số qua webhook); ADR-09 (claim `notifications` trước khi gửi); ADR-64 (`notifyMembers` gửi tới mọi kênh đang bật); ADR-79 (kênh chat nhận bản đầy đủ); ADR-90 (không đè chat đã nối, giới hạn mã sai, nối Zalo thì báo cả nhà); tài liệu [Zalo Bot Platform](https://docs.zaloplatforms.com/docs/BOT) (`sendMessage`, `setWebhook`, payload webhook)
- Actor: các cron của notify qua `notifyMembers` (UC-408); thành viên nhắn mã cho bot trong app Zalo; Zalo Bot Platform (gửi webhook, nhận `sendMessage`)
- Trigger: `zaloToMembers(env, kind, dayKey, full)` (gọi từ `notifyMembers`); `POST /webhooks/zalo` (không qua `requireAuth`; xác thực bằng header `X-Bot-Api-Secret-Token`); `POST /v1/settings/members/:id/zalo-code`

Kênh thứ ba của cửa gửi `notifyMembers` (**UC-408 Gửi tin Telegram chống gửi trùng**), cạnh thông báo đẩy (**UC-410**). Nơi cấu hình: bot token, khoá webhook, nút "Đặt webhook" và "Gửi thử" ở **access UC-508**; tạo mã nối / bỏ nối `zalo_chat_id` ở **access UC-507**; màn Cài đặt ở **pwa UC-709**.

## History
- v1 (2026-10-03, commit `5bd3117`): kênh Zalo trong `notifyMembers` (bản đầy đủ đổi sang chữ thường, ≤ 2000 ký tự, claim `zalo:<chat_id>`, 429 không thử lại); nối bằng mã 6 số hạn 15 phút nhắn cho bot; webhook `/webhooks/zalo` (khoá `X-Bot-Api-Secret-Token`, bỏ qua nhóm, hướng dẫn tối đa một lần mỗi chat mỗi ngày) — ADR-80, schema v1.18.
- v2 (2026-10-03, không đổi code): thêm điều kiện hạ tầng — Cloudflare **Browser Integrity Check** chặn (403) request của Zalo (`User-Agent: Java/1.8.0_192`, AS38244 VNG) trước khi tới Worker; cần Configuration Rule tắt BIC cho `/webhooks/*` (ADR-80 Consequences). Kiểm bằng `testWebhook` → `webhook.ok`.
- v3 (2026-10-06, commit `d059eaa`): **chặn dò khoá webhook** (red-team 6/10 INFRA-01, ADR-89, change [`261006-bao-mat-dang-nhap`](../changes/archive/261006-bao-mat-dang-nhap/proposal.md)) — khoá sai ở `/webhooks/zalo` được đếm chung bộ `webhook` với `/webhooks/sepay` theo IP; 20 lần trong 15 phút → 429 trước khi đọc khoá webhook từ D1.
- v4 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90, red-team INSIDER-01, INSIDER-05, INFRA-05) — người đã nối Zalo không tạo được mã (`409 zalo_linked`) và mã không đè chat đã nối (bỏ 13a); mã sai đếm theo chat, quá 5 lần / 1 giờ thì chat đó thôi thử mã; nối xong ghi nhật ký `member.zalo_link` (người tạo mã — `zalo_link_codes.created_by/created_via`, migration 0026) và cảnh báo cả nhà; `callZalo` chờ tối đa 10 giây. AC-2 sửa; thêm AC-11, AC-12.

## Preconditions
- Gửi tin: có bot token (`config` `secret:zalo_bot_token`, dự phòng `wrangler secret` `ZALO_BOT_TOKEN`) và ≥ 1 thành viên `active = 1` có `members.zalo_chat_id`.
- Nối Zalo: có cả bot token và khoá webhook (`secret:zalo_webhook_secret`, dự phòng `ZALO_WEBHOOK_SECRET`), và đã bấm **Đặt webhook** để Zalo gửi tin nhắn của bot tới `<origin>/webhooks/zalo` (UC-508).
- Hạ tầng: zone của tên miền có **Configuration Rule** `(http.host eq "vi-nha.example" and starts_with(http.request.uri.path, "/webhooks/"))` → Browser Integrity Check **Off**. Thiếu luật này thì Cloudflare trả 403 cho Zalo trước khi Worker nhận được gì (`testWebhook` báo `webhook.http.403`). Luật Skip trong WAF Custom rules (bỏ qua BIC + Security Level) là chưa đủ — đã thử 2026-10-03, vẫn 403. Hướng dẫn cài từng bước: [`docs/setup-zalo-bot.md`](../../docs/setup-zalo-bot.md).

## Main Flow — Gửi tin (kênh Zalo của `notifyMembers`)
1. `notifyMembers(env, kind, dayKey, { full, push })` chạy kênh Telegram, rồi `zaloToMembers(env, kind, dayKey, full)`, rồi kênh push (UC-410).
2. `token = getSecret(env, "zalo_bot_token")`; rỗng → trả 0, không claim gì.
3. `text = zaloText(full)`: bỏ mọi thẻ `<…>`, trả `&lt;` `&gt;` `&quot;` `&#39;` rồi `&amp;` (sau cùng — `&amp;lt;` thành chữ `&lt;`) về ký tự; dài hơn `ZALO_TEXT_MAX` = 2000 đơn vị UTF-16 thì giữ các ký tự đầu (không tách đôi emoji) trong 1999 đơn vị và thêm "…". Zalo không hiểu HTML — gửi chữ thường, không `parse_mode`.
4. Người nhận: `members` có `active = 1` và `zalo_chat_id` khác NULL, khác rỗng.
5. Với **từng** người nhận, tuần tự:
   1. Claim `INSERT OR IGNORE INTO notifications (kind, day_key, chat_id = 'zalo:<zalo_chat_id>', payload = text)` (`ok` mặc định 0).
   2. Không chèn được (cùng khoá đã có — kể cả khi một chat Zalo nối cho hai người) → bỏ qua.
   3. `sendZalo(token, chatId, text)` (luật dưới).
   4. Cập nhật `ok = 1 | 0`; hỏng → `console.error("[zalo] <kind> <dayKey>: <lỗi>")` (lỗi là mã + mô tả của Zalo, không kèm nội dung tin).
6. Trả số chat gửi được; `notifyMembers` cộng vào tổng (Telegram + Zalo + push). "Đã báo" của UC-407 tính cả Zalo.

### Luật gửi của `sendZalo`
- `callZalo(token, "sendMessage", { chat_id, text })`: `POST https://bot-api.zaloplatforms.com/bot<token>/sendMessage`, JSON, chờ tối đa 10 giây (`SEND_TIMEOUT_MS`, ADR-90; hết giờ = lỗi mạng). Thành công khi HTTP 2xx **và** thân không mang `ok: false` (Zalo có thể trả HTTP 200 kèm `ok: false`).
- Tối đa 3 lượt; chỉ thử lượt tiếp khi lỗi mạng, HTTP ≥ 500, `error_code` ≥ 500 hoặc 408; nghỉ `500 ms × lượt` giữa các lượt (không nghỉ sau lượt cuối).
- 429 (hết hạn mức tin của gói, ADR-80) và mọi lỗi khác (400/401/403/404) → dừng ngay, không thử lại.
- Hỏng → `{ ok: false, status, code, error: "<error_code hoặc mã HTTP>[ <description ≤ 200 ký tự>]" }`; không tới được Zalo → `status = 0`, `error` = thông điệp lỗi mạng.

## Main Flow — Tạo mã nối (`POST /v1/settings/members/:id/zalo-code`, access UC-507)
7. Thành viên phải có và `active = 1` (không → 404); **đã nối Zalo** (`zalo_chat_id` khác NULL) → 409 `zalo_linked` "{tên} đang nối Zalo. Bấm Bỏ nối Zalo trước rồi mới nối Zalo khác." (ADR-90 — nối lại không bao giờ âm thầm đè chat cũ); chưa có bot token **hoặc** khoá webhook → 409 `zalo_not_ready` "Chưa đặt bot token và khoá webhook Zalo — đặt ở Cài đặt › Kết nối rồi bấm Đặt webhook." (nhắn mã cũng không tới app).
8. `createZaloLinkCode`: xoá mã cũ của người đó và mọi mã đã hết hạn (của bất kỳ ai); sinh mã 6 chữ số ngẫu nhiên (Web Crypto), `INSERT OR IGNORE` vào `zalo_link_codes (member_id, code, expires_at = now + 15 phút, created_by, created_via)` — `created_by/created_via` là người gọi (`memberId`, `via`); trùng mã đang chờ của người khác thì sinh lại (tối đa 5 lần). Ghi nhật ký `member.zalo_code`.
9. Trả **201** `{ code, expires_at }` (ISO UTC). PWA hiện mã kèm đếm ngược (pwa UC-709).

## Main Flow — Webhook nhận tin nhắn (`POST /webhooks/zalo`)
10. IP người gọi (`CF-Connecting-IP`) đã sai khoá webhook ≥ 20 lần trong 15 phút (bộ đếm `webhook` chung với `/webhooks/sepay`, access entity AuthFailure) → **429** `{ ok: false }`, không đọc khoá. Đọc khoá webhook hiệu lực; chưa đặt → **401** (cửa khoá hẳn, không bao giờ "mở cho chuỗi rỗng"). So header `X-Bot-Api-Secret-Token` với khoá bằng `safeEqual` (thời gian hằng); thiếu, rỗng hoặc sai → ghi một lần sai cho IP (log số lần, không có khoá) → **401** `{ ok: false }`.
11. Sau xác thực, mọi trường hợp đều trả **200** `{ ok: true }` — kể cả thân không phải JSON, payload lạ, lỗi khi xử lý (`handleZaloUpdate` ném lỗi thì chỉ log `[webhooks/zalo] <thông điệp lỗi>`, không log nội dung tin). Zalo cần câu trả lời 2xx nhanh.
12. Đọc sự kiện: thân bọc `{ ok, result: { … } }` thì lấy `result`, không thì lấy chính thân. Cần `message` là object, `message.chat` là object có `chat_type = "PRIVATE"` và `chat.id` là chuỗi/số dài 1–64 ký tự; thiếu điều kiện nào → bỏ qua (không nối, không trả lời). Tin trong nhóm (`GROUP`) bị bỏ qua như vậy.
13. Lấy **mã** = dãy đúng 6 chữ số đầu tiên trong `message.text` không dính chữ số khác (`482913`, "Mã của em: 482913" khớp; "123 456" hay dãy 7 số không khớp). Có mã:
    1. Chat này đã có ≥ 5 dòng `zalo_code_failures` trong 1 giờ qua (`ZALO_CODE_MAX_FAILURES`) → không xét mã; có bot token thì claim `notifications (kind = 'zalo_limited', day_key = <ngày VN>, chat_id = 'zalo:<chat.id>', ok = 1)`, giành được thì trả lời "Đã nhắn sai mã quá nhiều lần. Đợi 1 giờ rồi tạo mã mới trong app Ví nhà (Cài đặt › Thành viên › tên của bạn › Nối Zalo) và nhắn lại." → kết quả `limited`.
    2. Mã còn hạn, của thành viên `active`, mà người đó **đã nối chat khác** (nối xong sau khi tạo mã) → xoá mã, trả lời "{tên} đang nối Zalo khác. Vào app Ví nhà bỏ nối Zalo cũ trước rồi tạo mã mới.", không đổi gì → `taken`.
    3. Mã còn hạn, của thành viên `active` → trong một batch: ghi `members.zalo_chat_id = chat.id`, xoá mã của người đó; trả lời "Đã nối Zalo cho {tên}. Ví nhà sẽ báo tin ở đây."; ghi nhật ký `member.zalo_link` (`member_id`/`via` = người tạo mã, `target = member:<id>`); cảnh báo cả nhà "⚠️ {người tạo mã}[ (qua API token)] vừa nối Zalo nhận tin cho {tên} — nếu không phải người nhà làm, vào Cài đặt gỡ ngay." (lỗi gửi chỉ log `[zalo] cảnh báo nối Zalo: …`) → `linked`.
    4. Mã không khớp mã còn hạn nào → ghi một dòng `zalo_code_failures (chat_id, at)` (xoá dòng cũ hơn 1 giờ cùng lúc), rồi như bước 14.
14. Mọi tin chat riêng khác (không có mã, mã sai, mã đã dùng, mã hết hạn, sticker…) → không nối ai. Có bot token thì claim `notifications (kind = 'zalo_help', day_key = <ngày VN>, chat_id = 'zalo:<chat.id>', ok = 1)`; giành được thì gửi câu hướng dẫn "Đây là bot báo tin của Ví nhà, bot không đọc tin nhắn. Muốn nhận tin ở Zalo: mở app Ví nhà › Cài đặt › Thành viên › tên của bạn › Nối Zalo, rồi nhắn mã 6 số app đưa vào đây (mã dùng được 15 phút)."; không giành được (đã hướng dẫn chat này hôm nay) → im lặng.
15. Câu trả lời ở webhook gửi **một lượt** `sendMessage` (`callZalo`), không thử lại; hỏng chỉ log `[zalo] trả lời webhook: <lỗi>`. Không có bot token thì không trả lời (vẫn nối nếu mã đúng).

## Alternative Flows
- 2a. Không có bot token → kênh Zalo gửi 0, không ghi dòng `notifications` Zalo nào; Telegram và push vẫn chạy (UC-408).
- 5.2a. Chạy lại cùng `(kind, day_key)` → claim bị bỏ qua, không gửi thêm.
- 8a. Bấm "Tạo mã mới" trước khi mã cũ hết hạn → mã cũ hết dùng ngay.
- 13a. Người đã nối muốn đổi tài khoản Zalo → bấm **Bỏ nối Zalo** (access UC-507; báo cả nhà và chat cũ) rồi tạo mã mới (ADR-90; trước v4 nhắn mã mới thì đè thẳng chat cũ).
- 13b. Một chat Zalo nhắn mã của hai người → cả hai cùng `zalo_chat_id`; chat đó nhận một tin mỗi `(kind, day_key)` (claim theo chat).
- 14a. Chưa đặt bot token mà có tin lạ → không claim `zalo_help` (để không tiêu lượt hướng dẫn của hôm nay khi chưa trả lời được).

## Exceptions
- E1. Zalo trả 429 (hết 3.000 tin/tháng của gói Basic) → `ok = 0`, log, không thử lại; tin đó mất ở kênh Zalo (các kênh khác vẫn nhận).
- E2. Gửi hỏng → `ok = 0` vĩnh viễn cho khoá đó (như UC-408 E2); chỉ UC-407 có thử lại (khoá `pending_batch` mới mỗi lượt).
- E3. Worker chết giữa claim (5.1) và cập nhật (5.4) → dòng ở lại `ok = 0`, không ai gửi lại (như UC-408 E1).
- E4. D1 lỗi khi đọc bộ đếm lần sai, đọc khoá webhook hoặc ghi lần sai → **503** `{ ok: false }` (chưa xác thực được; Zalo gửi lại hay không tuỳ Zalo).
- E5. `zalo-code` cho thành viên không có / đã nghỉ → 404 `not_found`; đã nối Zalo → 409 `zalo_linked`; thiếu token hoặc khoá webhook → 409 `zalo_not_ready`.

## Acceptance Criteria
### AC-1: Webhook chỉ nhận khi đúng khoá; chưa đặt khoá thì khoá hẳn
- Given chưa đặt khoá webhook; rồi khoá webhook đã đặt
- When `POST /webhooks/zalo` kèm khoá bất kỳ; rồi thiếu header, sai khoá, header rỗng, đúng khoá
- Then 401; rồi 401 / 401 / 401 / 200
- Tests: `test/zalo.test.ts` › "webhook Zalo › thiếu hoặc sai khoá X-Bot-Api-Secret-Token → 401; chưa đặt khoá webhook → khoá hẳn"

### AC-2: Nhắn đúng mã còn hạn thì nối đúng người, mã dùng một lần; ghi nhật ký và báo cả nhà (MODIFIED v4)
- Given mã của "wife" (Vợ) do "husband" tạo bằng API token, còn hạn
- When chat riêng `chat-vo` nhắn "Mã của em: <mã>"; rồi chat `chat-la` nhắn lại đúng mã đó
- Then `members.zalo_chat_id` của "wife" = `chat-vo`, "husband" vẫn `NULL`; không còn mã đang chờ; `sendMessage` đầu `{ chat_id: "chat-vo", text: "Đã nối Zalo cho Vợ. Ví nhà sẽ báo tin ở đây." }`, rồi cảnh báo tới mọi kênh (ở đây chỉ `chat-vo`) "⚠️ Chồng (qua API token) vừa nối Zalo nhận tin cho Vợ — …"; nhật ký `member.zalo_code` rồi `member.zalo_link` (cùng `husband`, `token`, `member:wife`); lần hai "wife" vẫn `chat-vo`, `chat-la` nhận câu hướng dẫn (có "Nối Zalo")
- Tests: `test/zalo.test.ts` › "webhook Zalo › nhắn đúng mã còn hạn trong chat riêng → nối zalo_chat_id cho đúng người, mã dùng một lần, bot trả lời đã nối"

### AC-3: Mã sai hoặc hết hạn → hướng dẫn, tối đa một lần mỗi chat mỗi ngày
- Given mã của "husband" đã hết hạn
- When chat `c1` nhắn mã đó, rồi "xin chào", rồi "123 456"; chat `c2` nhắn "?"
- Then không ai được nối; `c1` nhận đúng một câu hướng dẫn (có "Cài đặt › Thành viên"); `c2` vẫn nhận câu hướng dẫn của nó
- Tests: `test/zalo.test.ts` › "webhook Zalo › mã sai hoặc hết hạn → trả lời hướng dẫn, tối đa một lần mỗi chat mỗi ngày, không nối ai"

### AC-4: Tin trong nhóm bị bỏ qua
- Given mã của "husband" còn hạn
- When tin chứa đúng mã đến từ chat `GROUP`
- Then 200; không nối, mã vẫn còn, không gọi `sendMessage`
- Tests: `test/zalo.test.ts` › "webhook Zalo › tin trong nhóm bị bỏ qua: không nối, không trả lời"

### AC-5: Payload hỏng vẫn trả 200
- Given đúng khoá
- When thân là chữ không phải JSON, mảng, `{}`, `message` không phải object, `result: null`, `chat.id` là object
- Then mỗi lần 200 `{ ok: true }`, không gọi Zalo
- Tests: `test/zalo.test.ts` › "webhook Zalo › payload hỏng vẫn trả 200, không ném lỗi"

### AC-6: Mã 6 số hạn 15 phút; tạo lại thì mã cũ hết dùng; chưa sẵn sàng thì 409
- Given chưa đặt khoá nào; rồi chỉ có token; rồi đủ cả hai
- When `POST /v1/settings/members/anh/zalo-code`; `createZaloLinkCode(env, "husband", 2026-10-03T03:00Z)` hai lần; mã cho thành viên không có
- Then 409 `zalo_not_ready`; 409; mã khớp `^\d{6}$`, `expires_at = "2026-10-03T03:15:00.000Z"`; sau lần hai chỉ còn mã thứ hai của "husband"; 404
- Tests: `test/zalo.test.ts` › "mã nối Zalo › tạo mã 6 số hạn 15 phút, tạo lại thì mã cũ hết dùng; chưa đặt token và khoá webhook thì báo chưa sẵn sàng"

### AC-7: Người đã nối nhận bản đầy đủ dạng chữ thường; chống trùng; đếm vào số đã gửi
- Given bot token; "husband" nối `z-husband`, "wife" nối `z-wife`; bản đầy đủ `⚠️ 1 giao dịch chưa gán:\n+50.000 ₫ — A &amp; B &lt;x&gt;`
- When `notifyMembers(env, "pending_batch", k, message)` hai lần; rồi "wife" nối cùng `z-husband` và gửi `weekly`; rồi xoá bot token và gửi `daily`
- Then lần đầu trả 2, mỗi chat một `sendMessage` với `text = "⚠️ 1 giao dịch chưa gán:\n+50.000 ₫ — A & B <x>"`, dòng `zalo:z-husband`, `zalo:z-wife` `ok = 1`; lần hai trả 0; `weekly` trả 1 (chat chung nhận một tin); không token → trả 0, không gọi Zalo
- Tests: `test/zalo.test.ts` › "gửi tin qua Zalo › notifyMembers gửi bản đầy đủ dạng chữ thường cho người đã nối Zalo, chống gửi trùng, đếm vào số đã gửi"

### AC-8: `zaloText` bỏ thẻ, trả ký tự đã escape, cắt ở 2000 ký tự
- Given `<b>Đậm</b> Ăn &amp; uống &lt;3 &quot;ok&quot;`; `&amp;lt;`; 2000 chữ `a`; 2500 chữ `a`; 1500 emoji 💰 (3000 đơn vị UTF-16)
- Then `Đậm Ăn & uống <3 "ok"`; `&lt;`; giữ nguyên; đúng 2000 ký tự kết thúc `a…`; ≤ 2000 đơn vị, không emoji nào bị cắt đôi, kết thúc "…"
- Tests: `test/zalo.test.ts` › "gửi tin qua Zalo › zaloText bỏ thẻ, trả ký tự đã escape, cắt ở 2000 ký tự kèm …"

### AC-9: 429 thì ghi lỗi, không thử lại
- Given Zalo trả HTTP 429 `{ ok: false, error_code: 429, description: "Quota exceeded" }`
- When `notifyMembers(env, "daily", "2026-10-03", message)`
- Then trả 0; đúng một lời gọi `sendMessage`; log `[zalo] daily 2026-10-03: 429 Quota exceeded`; dòng `zalo:z-husband` `ok = 0`
- Tests: `test/zalo.test.ts` › "gửi tin qua Zalo › Zalo trả 429 thì ghi lỗi, không thử lại"

### AC-10: Khoá sai tới ngưỡng thì IP bị chặn trước khi đọc khoá
- Given IP đã sai khoá webhook (SePay hoặc Zalo) 20 lần trong 15 phút; khoá Zalo đúng là `zalo-secret-1234`
- When `POST /webhooks/zalo` từ IP đó kèm khoá đúng; (ca khác) khoá Zalo sai một lần
- Then 429, chỉ đọc `auth_failures` (không đọc `config`); khoá sai → 401 và bộ đếm `webhook` của IP = 1
- Tests: `test/webhooks.test.ts` › "chặn dò khoá webhook theo IP (ADR-89) › sai khoá lần thứ 20 trong 15 phút → mọi webhook từ IP đó 429 trước khi đọc khoá, kể cả khoá đúng; IP khác vẫn vào"; "chặn dò khoá webhook theo IP (ADR-89) › khoá Zalo sai cũng được đếm; hết 15 phút thì IP đó gửi lại được"

### AC-11: Đã nối thì phải bỏ nối trước; mã không đè chat đã nối (ADR-90)
- Given "husband" đã nối `chat-husband`; mã còn hạn của "wife", rồi "wife" được nối `chat-wife` bằng đường khác
- When `POST /v1/settings/members/anh/zalo-code`; chat `chat-la` nhắn mã của "wife"
- Then 409 `zalo_linked`, không có mã nào; `taken`, "wife" vẫn `chat-wife`, mã bị xoá, `chat-la` nhận câu có "bỏ nối Zalo cũ trước"
- Tests: `test/zalo.test.ts` › "mã nối Zalo › người đã nối Zalo thì không tạo được mã — phải bỏ nối trước; mã tạo trước khi người đó nối chat khác không đè chat đó"

### AC-12: Một chat nhắn sai mã 5 lần trong 1 giờ thì thôi thử mã tới hết giờ (ADR-90)
- Given mã còn hạn của "wife"
- When chat `ke-do` nhắn 5 mã sai; rồi nhắn mã đúng hai lần; 1 giờ sau tạo mã mới và nhắn
- Then 5 lần `help` (một câu hướng dẫn); hai lần `limited` (một câu "Đã nhắn sai mã quá nhiều lần…"), "wife" chưa nối; hết giờ → `linked`, "wife" nối `ke-do`
- Tests: `test/zalo.test.ts` › "mã nối Zalo › một chat nhắn sai mã 5 lần trong 1 giờ thì mã đúng cũng không được nhận; hết giờ thì nối được"

## Traceability
- Code: `src/notify/zalo.ts` › `ZALO_TEXT_MAX`, `ZaloReply`, `callZalo`, `sendZalo`, `zaloText`, `zaloToMembers`; `src/notify/telegram.ts` › `notifyMembers`; `src/services/zalo.ts` › `ZALO_CODE_TTL_MS`, `ZALO_CODE_MAX_FAILURES`, `createZaloLinkCode`, `handleZaloUpdate`, `zaloErrorText`; `src/services/audit.ts` › `audit`, `alertMembers`; `src/routes/webhooks.ts` › `webhooks.post("/zalo")`; `src/services/auth-throttle.ts` › `blockedFor`, `recordFailure`; `src/routes/settings.ts` › `.post("/members/:id/zalo-code")`; `src/routes/auth.ts` › `safeEqual`; `src/services/secrets.ts` › `SECRET_NAMES`, `getSecret`
- Migrations/DB: `members.zalo_chat_id`, `zalo_link_codes` (`migrations/0018_zalo.sql`, schema v1.18; `created_by`, `created_via` — `migrations/0026_audit_log.sql`); `zalo_code_failures` (0026); `notifications.chat_id = 'zalo:<chat_id>'`, kind `zalo_help`, `zalo_limited`; `config` khoá `secret:zalo_bot_token`, `secret:zalo_webhook_secret`; `auth_failures` (`migrations/0025_auth_failures.sql`); `audit_log` (0026)
- Liên quan: access UC-507 (mã nối, bỏ nối), UC-508 (khoá, Đặt webhook, Gửi thử); pwa UC-709; `wrangler.jsonc` `assets.run_worker_first` đã có `/webhooks/*`

## Divergences & Open Questions
- [OPEN] Hết hạn mức 3.000 tin/tháng (429) không có cảnh báo ở đâu ngoài log và dòng `ok = 0` — cùng gốc với [DIVERGENCE] badge ở UC-408.
- [OPEN] Zalo cắt tin ở 2000 ký tự: tin sáng dài (nhiều ví sắp vỡ, nhiều tài khoản lệch) mất các dòng cuối ở Zalo — thường là phần thông tin, việc cần làm đứng trước (ADR-79).
- [OPEN] Dòng `zalo_help` được ghi `ok = 1` ngay lúc claim, kể cả khi câu hướng dẫn gửi hỏng — hôm đó chat đó không được hướng dẫn lại.
- [OPEN] Không có thời hạn lưu / dọn dòng `zalo_help` và dòng `zalo:<id>` của `notifications` (như UC-410).
- [OPEN] Chưa thử với bot Zalo thật (đặt webhook, nhận `result.verification`, nhắn mã, nhận tin) — test dùng `fetch` giả theo tài liệu Zalo.
