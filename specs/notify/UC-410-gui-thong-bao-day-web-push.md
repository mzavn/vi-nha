# UC-410: Gửi thông báo đẩy tới máy đã bật (Web Push)
- Status: implemented
- BR: BR-06, BR-09
- Decisions: ADR-64 (Web Push chuẩn trên PWA); ADR-09 (claim `notifications` trước khi gửi); ADR-79 (máy nhận bản ngắn dựng sẵn, không cắt từ tin Telegram); ADR-90 (chỉ push service thật, tối đa 10 máy, gỡ theo id, thêm máy thì báo cả nhà); change `261001-pwa-web-push`; `plans/reports/researcher-261001-pwa-web-push.md`; ADR-92 (địa chỉ màn PWA tiếng Anh)
- Actor: các cron của notify qua `notifyMembers` (UC-408); mỗi lượt cron (UC-401) dọn lượt gửi thử kẹt; thành viên đã đăng nhập trên PWA (UC-714) hoặc script có `API_TOKEN`; push service của trình duyệt (Apple, Google, Mozilla…)
- Trigger: `pushToMembers(env, kind, dayKey, push)` (gọi từ `notifyMembers`); `cancelStaleTestSeries(env, now)` (lượt cron `*/15 0-17,21-23 * * *` / `0 18,19,20 * * *`); `GET /v1/push`, `POST /v1/push/subscriptions`, `POST /v1/push/subscriptions/remove`, `DELETE /v1/push/subscriptions/:id`, `POST /v1/push/test`, `POST /v1/push/test-series`, `POST /v1/push/test-series/cancel`

Kênh thứ hai của cửa gửi `notifyMembers` (**UC-408 Gửi tin Telegram chống gửi trùng**). Máy được bật/tắt ở **UC-714 Bật thông báo trên máy này** (pwa); service worker hiện thông báo ở **UC-710**.

## History
- v1 (2026-10-01, commit `5dc53be`): bảng `push_subscriptions`, khoá VAPID tự sinh trong `config`, API `/v1/push`, kênh push trong `notifyMembers`, gửi thử; xoá máy khi push service trả 404/410 (change `261001-pwa-web-push`).
- v2 (2026-10-01, commit `7b71600`): lượt "Thử khi tắt app" — bảng `push_test_series`, `POST /v1/push/test-series` (+ `/cancel`), `GET /v1/push` trả `series`; cron mỗi phút gửi lần lượt tin thử với `tag` riêng từng tin, `TTL 300`, `Urgency: high`; `sendPush` nhận `ttl`/`urgency` tuỳ chọn (mặc định giữ như v1).
- v3 (2026-10-01, commit `d75c563`): lượt gửi thử ngắn và nhanh hơn — 1–2 tin (mặc định 2), `interval_s` chỉ nhận 10; dòng ghi thẳng `running` và chính request gửi nền qua `waitUntil` (chờ 10 giây rồi tin 1, thêm 10 giây tin 2, ≈ 20 giây); cron mỗi phút không gửi nữa, chỉ huỷ lượt `pending`/`running` quá 10 phút; bỏ cửa sổ 15 phút khi kiểm `series_running`.
- v4 (2026-10-01, commit `a301077`): dọn lượt gửi thử kẹt chạy trong cron mỗi 5 phút (`*/5 * * * *`) thay cho cron mỗi phút (ADR-68); ngưỡng 10 phút giữ nguyên, nên lượt kẹt được huỷ sau 10–15 phút.
- v5 (2026-10-01, commit `e72b5de`): dọn lượt gửi thử kẹt chạy trong lượt cron mỗi 15 phút (đêm 01:00–03:59 VN mỗi giờ) (ADR-70); ngưỡng 10 phút giữ nguyên, nên lượt kẹt được huỷ sau 10–25 phút (đêm có thể tới ~70 phút).
- v6 (2026-10-03, commit `4e6d103`): nội dung push là **bản ngắn dựng sẵn** `{ title, body }` của từng tin (ADR-79, `src/notify/format.ts`) — tiêu đề mang con số chính thay cho tiêu đề cố định theo loại tin, nội dung ≤ 150 ký tự; bỏ đường bỏ thẻ HTML / cắt 1000 ký tự từ tin Telegram. Dòng `push:<id>` lưu đúng bản đã gửi. AC-12 sửa.
- v7 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90, red-team INSIDER-01, INFRA-05) — endpoint chỉ thuộc push service thật (`PUSH_HOSTS`); nhãn máy lấy từ header `User-Agent` (body `user_agent` bỏ qua); mỗi người tối đa 10 máy; **gỡ theo id** `DELETE /v1/push/subscriptions/:id`; thêm máy mới → nhật ký `push.add` + cảnh báo cả nhà (tin `security`, mở `/#cai-dat`, ưu tiên cao); gỡ → nhật ký `push.remove`; mỗi lần gọi push service tối đa 10 giây. AC-4 sửa; thêm AC-22…26; đóng [OPEN] "gỡ theo endpoint không kiểm chủ".
- v8 (2026-10-07, commit `7424f26`): đường mở khi bấm thông báo dùng địa chỉ màn mới (ADR-92): `daily` → `/#today`, `weekly` → `/#wallets`, `pending_batch` → `/#assign`, `test` / `security` / lượt "Thử khi tắt app" → `/#settings` (trước `/#homnay`, `/#vi`, `/#gan`, `/#cai-dat`). AC-12 sửa theo (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).

## Preconditions
- Mọi route `/v1/push*` qua `requireAuth` (access UC-503); người gắn máy = `memberId` của phiên, hoặc của `X-Member-Id`/chủ hộ khi gọi bằng token.
- Gửi theo lịch cần khoá VAPID đã có (sinh ở lần `GET /v1/push` hoặc `POST /v1/push/test` đầu tiên) và ≥ 1 máy của thành viên `active = 1`.

## Main Flow — Khoá VAPID
1. `GET /v1/push` và `POST /v1/push/test` gọi `ensureVapid(env, origin)`: `config` có đủ `secret:vapid_private_jwk` và `vapid_public` thì dùng; chưa có thì sinh cặp ECDSA P-256 bằng Web Crypto rồi ghi ba khoá bằng `INSERT OR IGNORE` trong một `DB.batch` — `secret:vapid_private_jwk` (JWK của khoá riêng), `vapid_public` (khoá công khai dạng raw 65 byte, base64url không đệm), `vapid_subject` = origin của request — và đọc lại. Hai request sinh cùng lúc: bản ghi trước thắng, cả hai dùng cùng một khoá.
2. Cron không có request: `loadVapid` chỉ đọc, **không** sinh.

## Main Flow — Xem, đăng ký, gỡ máy
3. `GET /v1/push` → `{ publicKey, subscriptions: [{ id, memberId, memberName, device, createdAt, lastOkAt, mine }], series }`: mọi máy của mọi thành viên, sắp theo `created_at, id`. `device` = nhãn đoán từ User-Agent đã lưu (`deviceLabel`: "iPhone · Safari", "Android · Chrome"…; `null` nếu không đoán được); `mine` = máy của người đang gọi. Không trả `endpoint`, khoá của máy hay User-Agent thô. `series` = lượt gửi thử mới nhất **của người đang gọi** tạo trong 15 phút qua `{ id, status, sent, count, interval_s, createdAt }`, không có → `null`.
4. `POST /v1/push/subscriptions { endpoint, keys: { p256dh, auth } }`:
   - `endpoint` là URL `https:`, tối đa 1000 ký tự, **thuộc push service thật** (`isPushEndpoint`, ADR-90): cổng mặc định, không user/password, host là một trong `PUSH_HOSTS.exact` (`fcm.googleapis.com`, `updates.push.services.mozilla.com`) hoặc có đuôi trong `PUSH_HOSTS.suffix` (`.push.apple.com`, `.notify.windows.com`); khác → 400 "endpoint không thuộc dịch vụ thông báo của trình duyệt (Google, Mozilla, Apple, Microsoft)." `p256dh`, `auth` là base64url (bỏ `=` cuối, 1–200 ký tự `[A-Za-z0-9_-]`).
   - Nhãn máy: header `User-Agent` của **chính request** (cắt 500 ký tự); trường `user_agent` trong body bị bỏ qua.
   - Máy mới với người gọi (chưa có endpoint, hoặc endpoint đang gắn người khác) mà người gọi đã có 10 máy (`MAX_DEVICES_PER_MEMBER`) → **409** `too_many_devices` "Mỗi người nhận thông báo trên tối đa 10 máy — gỡ bớt máy cũ ở Cài đặt › Thông báo."
   - Upsert theo `endpoint` (`UNIQUE`): chưa có → tạo dòng, **201** `{ id }`; đã có → thay khoá, chuyển `member_id` sang người đang gọi, giữ `user_agent` cũ nếu request không có header, **200** `{ id }` cùng id cũ.
   - Máy mới với người gọi (tạo mới hay vừa chuyển từ người khác) → nhật ký `push.add` (`target = push:<id>`, `detail = { member_id, device }`) và cảnh báo cả nhà "⚠️ <người> vừa thêm máy nhận thông báo: <nhãn máy> — nếu không phải người nhà làm, vào Cài đặt gỡ ngay." (access UC-508 § cảnh báo, ADR-90). Đăng ký lại máy đang là của mình: không ghi, không báo.
5. `POST /v1/push/subscriptions/remove { endpoint }` → xoá dòng có `endpoint` đó, **của ai cũng được** (máy đổi người/đăng xuất phải tự gỡ được dù đang gắn người cũ) → `{ removed: 1 | 0 }`; có xoá thì nhật ký `push.remove`.
5a. `DELETE /v1/push/subscriptions/:id` → xoá máy có `id` đó, **của ai cũng được** (máy lạ phải gỡ được từ danh sách ở Cài đặt, UC-714) → `{ removed: 1 }` + nhật ký `push.remove { member_id, device }`; không có → 404 `not_found`; `id` không phải số nguyên dương → 400.

## Main Flow — Gửi theo lịch (kênh push của `notifyMembers`)
6. `pushToMembers`: lấy mọi `push_subscriptions` JOIN `members` có `active = 1`, sắp theo `id`. Không có → trả 0.
7. `loadVapid`; chưa có khoá → trả 0, không claim gì.
8. Dựng nội dung một lần (`pushPayload(kind, push)`): `title`, `body` giữ nguyên bản ngắn người gọi truyền (UC-402, UC-406, UC-407 § bản ngắn); `url` theo bảng dưới; `tag = kind`.
9. Với **từng** máy, tuần tự:
   1. Claim `INSERT OR IGNORE INTO notifications (kind, day_key, chat_id = 'push:<id>', payload = title + "\n" + body)`.
   2. Không chèn được → bỏ qua máy này.
   3. `sendPush` (luật dưới).
   4. Cập nhật `ok = 1 | 0`; hỏng → `console.error("[push] <kind> <dayKey> #<id>: <lỗi>")`.
10. Trả số máy gửi được.

| `kind` | `title` (ví dụ) | `url` mở khi bấm |
|---|---|---|
| `daily` | `Còn 3.250.000 ₫ tuần này` (UC-402) | `/#today` |
| `weekly` | `Tuần T40: chi 2.345.000 ₫` (UC-406) | `/#wallets` |
| `pending_batch` | `2 giao dịch chưa gán` (UC-407) | `/#assign` |
| `test` | `Gửi thử` | `/#settings` |
| khác | do người gọi truyền | `/` |

### Luật gửi của `sendPush`
- Mã hoá và ký bằng `buildPushPayload` của `@block65/webcrypto-web-push`: `Content-Encoding: aes128gcm`; `Authorization: vapid t=<JWT ES256>, k=<vapid_public>`, JWT có `aud` = origin của endpoint, `sub` = `vapid_subject`; `TTL` mặc định `86400`; `Urgency` mặc định `high` cho `tag` `test` và `pending_batch`, `normal` cho loại khác. Người gọi truyền `ttl`/`urgency` thì dùng giá trị đó (lượt thử: `300` / `high`).
- 2xx → `last_ok_at = datetime('now')`, thành công.
- 404 hoặc 410 → subscription đã chết: **xoá dòng**, dừng, không thử lại.
- 429, 5xx, lỗi mạng → thử lượt tiếp; tối đa 3 lượt, nghỉ `500 ms × lượt` giữa các lượt (không nghỉ sau lượt cuối).
- Mỗi lần gọi push service chờ tối đa **10 giây** (`SEND_TIMEOUT_MS`, `AbortSignal.timeout`); hết giờ tính như lỗi mạng (ADR-90 — một máy treo không giữ cả lượt cron).
- Tin `security` (cảnh báo, ADR-90) mở `/#settings`, `Urgency: high`.
- 4xx khác (VAPID sai, payload sai…) → dừng ngay.
- Hỏng → `{ ok: false, error: "HTTP <status>" | <thông điệp lỗi> }`.

## Main Flow — Gửi thử
11. `POST /v1/push/test` → mọi máy của **người đang gọi**. Có → `ensureVapid`, gửi `{ title: "Gửi thử", body: "✅ Ví nhà sẽ báo tin lên máy này." }` (kind `test`) tới từng máy qua `sendPush`, **không** ghi `notifications` (bấm bao nhiêu lần gửi bấy nhiêu) → `{ sent, failed }`.

## Main Flow — Thử khi tắt app (lượt gửi thử)
12. `POST /v1/push/test-series { count?, interval_s? }`: `ensureVapid(env, origin)`, rồi `createTestSeries`: `count` số nguyên 1–2 (mặc định 2), `interval_s` chỉ nhận đúng 10 (mặc định 10) — để 10 + (count − 1) × `interval_s` ≤ 25 giây, gọn trong ~30 giây `waitUntil` giữ Worker sau khi trả lời. Người gọi không có máy → 409 `no_subscription`. Còn lượt `pending`/`running` của chính mình → 409 `series_running` "Đang có một lượt gửi thử chưa xong." (kiểm và chèn trong cùng một câu `INSERT … SELECT … WHERE NOT EXISTS`). Còn lại → chèn `push_test_series` `status = 'running'`, đưa `runTestSeries` vào `executionCtx.waitUntil` rồi trả **201** `{ id, count, interval_s }` ngay — người dùng tắt app ngay sau khi bấm. (Không có ExecutionContext — `app.request` trong test — thì chờ chạy xong rồi mới trả.)
13. `POST /v1/push/test-series/cancel` (`cancelTestSeries`) → mọi lượt `pending`/`running` của người gọi thành `cancelled` → `{ cancelled: n }`.
14. `runTestSeries(env, series, vapid)` — tin `i = 1..count`:
    1. Ngủ: trước tin 1 là 10 giây (`SERIES_FIRST_DELAY_S`, đủ để vuốt tắt app), trước tin sau là `interval_s` giây.
    2. Đọc lại `status` — khác `running` (đã huỷ) → dừng, giữ `cancelled`. Đọc lại máy của người hẹn (máy bị xoá vì 404/410 ở tin trước thì thôi) — hết máy → dừng.
    3. Gửi tới từng máy qua `sendPush` với `{ title: "Thử khi tắt app", body: "Tin i/count — thấy tin này khi app đã tắt là thông báo chạy tốt.", url: "/#settings", tag: "test-series-<id>-<i>" }` (tag khác nhau để iOS không gộp các tin), `ttl: 300`, `urgency: "high"`; hỏng → `console.error("[push] test-series <id> tin <i> #<máy>: <lỗi>")`; ghi `sent = i`. **Không** ghi `notifications`.
    4. Hết vòng → `status = 'done'` (chỉ khi vẫn `running`).
15. Mỗi lượt cron (UC-401) gọi `cancelStaleTestSeries(env, now)` (cùng lúc với UC-407): lượt `pending`/`running` có `created_at` cũ hơn `now − 10 phút` → `cancelled` (lượt thật xong trong ≈ 20 giây; còn chạy là Worker đã bị dừng giữa chừng). Cron không gửi gì.

## Alternative Flows
- 4a. Cùng máy (cùng `endpoint`) được người khác đăng ký → máy chuyển sang người mới; người cũ không nhận tin trên máy đó nữa.
- 6a. Thành viên `active = 0` → máy của họ không nhận; dòng vẫn còn.
- 9.2a. Chạy lại cùng `(kind, day_key)` → claim bị bỏ qua, không gửi thêm.
- 11a. Người gọi không có máy nào → 409 `no_subscription` "Máy này chưa bật thông báo.", không gọi push service.
- 12a. Lượt kẹt `running` (Worker bị dừng giữa chừng) chặn lượt mới của người đó cho tới khi bấm **Huỷ** hoặc cron đổi `cancelled` (≤ 10 phút + 1 phút); không hiện ở `GET /v1/push` sau 15 phút.

## Exceptions
- E1. Body không phải object JSON; `endpoint` không phải `https:`, dài hơn 1000 ký tự hoặc không thuộc `PUSH_HOSTS`; khoá không phải base64url; gỡ mà thiếu `endpoint`; `id` gỡ không phải số nguyên dương; `count` không phải số nguyên 1–2 hoặc `interval_s` khác 10 → 400 `invalid_input`.
- E2. Không xác định được người gọi (`memberId` null: gọi bằng token, không `X-Member-Id`, không có chủ hộ `active`) → 400 `no_member` khi đăng ký, gửi thử, hẹn hoặc huỷ lượt gửi thử.
- E3. Worker chết giữa claim (9.1) và cập nhật (9.4) → dòng ở lại `ok = 0`, không ai gửi lại (như UC-408 E1).
- E4. Gửi hỏng không phải 404/410 → `ok = 0` vĩnh viễn cho khoá đó; máy vẫn được giữ.
- E5. Worker bị dừng giữa lượt gửi thử (quá giới hạn `waitUntil`, lỗi) → dòng ở lại `running` với `sent` = số tin đã gửi; không ai gửi tiếp; cron đổi `cancelled` sau 10 phút (bước 15).

## Acceptance Criteria
### AC-1: Khoá VAPID sinh một lần; khoá riêng không bao giờ ra API
- Given `config` chưa có khoá VAPID
- When `GET /v1/push` hai lần từ `https://vi-nha.example`
- Then cùng `publicKey` (65 byte, byte đầu `0x04`); không phản hồi nào chứa `d` của JWK; `vapid_subject = https://vi-nha.example`; `config` có đúng 3 khoá chứa `vapid`
- Tests: `test/push.test.ts` › "khoá VAPID › sinh một lần ở lần GET đầu, giữ nguyên về sau; khoá riêng không bao giờ ra API"

### AC-2: Push ký bằng đúng khoá riêng ứng với khoá công khai đã đưa trình duyệt
- Given một máy đã đăng ký
- When gửi thử
- Then header `Authorization` có `k` = `publicKey`, chữ ký JWT kiểm được bằng khoá đó, `aud` = origin endpoint, `sub` = origin app
- Tests: `test/push.test.ts` › "khoá VAPID › JWT gửi kèm push ký bằng đúng khoá riêng ứng với khoá công khai đã đưa cho trình duyệt"

### AC-3: Đăng ký lại cùng endpoint thì cập nhật và chuyển sang người đang gọi
- Given "husband" đăng ký endpoint E (201)
- When "wife" đăng ký lại E
- Then 200, cùng `id`, `member_id = wife`; "husband" xem danh sách thấy `{ memberName: "Vợ", device: "iPhone · Safari", lastOkAt: null, mine: false }`
- Tests: `test/push.test.ts` › "đăng ký máy › cùng endpoint đăng ký lại thì cập nhật (200) và chuyển sang người đang đăng nhập"

### AC-4: Từ chối endpoint và khoá sai (MODIFIED v7)
- Given endpoint `http://…`, endpoint dài hơn 1000 ký tự, `auth` chứa `+`/`/`; endpoint https ngoài `PUSH_HOSTS`
- Then 400, không ghi dòng nào
- Tests: `test/push.test.ts` › "đăng ký máy › từ chối endpoint không phải https và khoá không phải base64url"; `test/push.test.ts` › "đăng ký máy › chỉ nhận endpoint của push service thật (FCM, Mozilla, Apple, Microsoft); URL https khác bị từ chối, không ghi gì"

### AC-5: Gỡ theo endpoint, của ai cũng được
- Given máy E gắn "wife"
- When "husband" gỡ E hai lần
- Then lần đầu `{ removed: 1 }`, lần hai `{ removed: 0 }`; bảng rỗng
- Tests: `test/push.test.ts` › "đăng ký máy › gỡ theo endpoint, của ai cũng được; gỡ lần hai báo 0"

### AC-6: Gửi thử chỉ tới máy của người đang gọi
- Given máy A của "husband", máy B của "wife"
- When "husband" gửi thử
- Then chỉ A nhận, `{ sent: 1, failed: 0 }`, header `urgency: high`, `ttl: 86400`, `content-encoding: aes128gcm`; chỉ A có `last_ok_at`
- Tests: `test/push.test.ts` › "gửi thử › chỉ gửi tới máy của người đang đăng nhập, ưu tiên cao, ghi last_ok_at"

### AC-7: Gửi thử khi mình chưa có máy nào
- Then 409 `no_subscription`, không gọi push service
- Tests: `test/push.test.ts` › "gửi thử › chưa có máy nào của mình thì 409 no_subscription"

### AC-8: Mỗi máy nhận một lần cho mỗi (kind, day_key), không cần Telegram
- Given hai máy đã bật, không có bot token
- When `notifyMembers(env, "daily", "2026-10-01", …)` hai lần
- Then lần đầu trả 2, `urgency: normal`, `notifications` có `push:1` và `push:2` `ok = 1`; lần hai trả 0, không gọi push service
- Tests: `test/push.test.ts` › "notifyMembers qua push › không có token Telegram vẫn đẩy tới mọi máy; chạy lại cùng (kind, day_key) không gửi thêm"

### AC-9: Push service trả 404/410 thì xoá máy; máy khác vẫn nhận
- Given máy A trả 410, máy B trả 201
- Then trả 1; dòng của A bị xoá; `push:1` `ok = 0`, `push:2` `ok = 1`
- Tests: `test/push.test.ts` › "notifyMembers qua push › push service trả 410 thì xoá máy đó, claim giữ ok=0; máy khác vẫn nhận"

### AC-10: Chưa có khoá VAPID thì bỏ qua push, không tự sinh
- Tests: `test/push.test.ts` › "notifyMembers qua push › chưa có khoá VAPID (chưa ai mở app) thì bỏ qua push, không tự sinh"

### AC-11: Máy của thành viên đã nghỉ không nhận
- Tests: `test/push.test.ts` › "notifyMembers qua push › thành viên đã nghỉ không nhận"

### AC-12: Nội dung push là bản ngắn dựng sẵn; đường mở theo loại tin (MODIFIED v6)
- Given bản ngắn `{ title: "2 giao dịch chưa gán", body: "−24.400 ₫ MB · +50.000 ₫ TK lạ" }`; tin sáng thật từ `daily`
- Then `pushPayload` giữ nguyên `title`/`body`, `url` theo bảng (`pending_batch` → `/#assign`, `weekly` → `/#wallets`, `test` → `/#settings`, khác → `/`), `tag = kind`; máy giải mã tin sáng ra `{ title: "Còn 0 ₫ tuần này", url: "/#today", tag: "daily" }`, nội dung ≤ 150 ký tự; `notifications.payload` của `push:<id>` là `title` + xuống dòng + `body`
- Tests: `test/push.test.ts` › "nội dung push › giữ nguyên tiêu đề và nội dung đã dựng; đường mở theo loại tin"; `test/push.test.ts` › "notifyMembers qua push › tin sáng: Telegram nhận bản đầy đủ, máy nhận bản ngắn mở màn Hôm nay; notifications lưu đúng bản đã gửi"

### AC-13: Luật thử lại theo mã lỗi
- Given push service trả 503 ba lần / trả 403
- When `sendPush`
- Then 3 lần gọi rồi `{ ok: false, error: "HTTP 503" }`, máy vẫn còn / 1 lần gọi rồi `{ ok: false, error: "HTTP 403" }`, máy vẫn còn
- Tests: ⚠ Chưa có test

### AC-14: Bấm nút trả lời ngay, việc gửi chạy nền; mặc định và kiểm tham số
- Given máy của "husband" đã bật; request có ExecutionContext
- When `POST /v1/push/test-series {}`; rồi với `count` 0, 3, 1.5, "2", `interval_s` 5, 15
- Then 201 `{ id: 1, count: 2, interval_s: 10 }` trước khi gọi push service, đúng một việc vào `waitUntil`, dòng `running`, `sent = 0`; các lần sau 400 và không thêm việc nền
- Tests: `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › bấm nút trả lời ngay (mặc định 2 tin cách 10 giây), việc gửi chạy nền qua waitUntil; tham số ngoài khoảng thì 400"

### AC-15: Bấm khi chưa có máy / khi đang có lượt
- Then "wife" chưa có máy → 409 `no_subscription`; "husband" đang có lượt chạy → 409 `series_running`; huỷ (`{ cancelled: 1 }`) rồi bấm lại → 201
- Tests: `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › chưa có máy của mình thì 409 no_subscription; đang có lượt chạy thì 409 series_running; huỷ xong thì bấm lại được"

### AC-16: `GET /v1/push` trả lượt gần nhất của chính mình
- Then chưa bấm → `series: null`; sau khi bấm → `{ id, status: "running", sent: 0, count, interval_s: 10, createdAt }`; người khác thấy `null`; lượt tạo quá 15 phút → `null`
- Tests: `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › GET /v1/push trả lượt gần nhất của mình (trong 15 phút), không trả của người khác"

### AC-17: Gửi đủ số tin, đúng nhịp, tag riêng từng tin
- Given "husband" có máy A, A2; "wife" có máy B; lượt mặc định (2 tin)
- When `runTestSeries` (ngủ giả)
- Then ngủ 10 000 ms rồi 10 000 ms; 4 lần gửi A, A2, A, A2 (B không nhận); header `urgency: high`, `ttl: 300`; giải mã payload ra tag `test-series-1-1`, `-1-2` theo thứ tự và nội dung "Tin 2/2 — …"; dòng `done`, `sent = 2`
- Tests: `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › chờ 10 giây rồi gửi tin 1, cách interval_s giây gửi tin 2, tới mọi máy của người hẹn, tag riêng từng tin"

### AC-18: Hai lần cron chồng nhau không gửi trùng (deprecated v3: cron không còn gửi; mỗi lượt chỉ có đúng một việc nền do chính request tạo ra nó chạy)

### AC-19: Huỷ giữa chừng thì dừng trước tin kế tiếp
- Given lượt mặc định của "husband" và một lượt đang chạy của "wife"
- When "husband" huỷ trong lúc chờ trước tin 2
- Then huỷ trả `{ cancelled: 1 }` (lượt của "wife" không bị đụng); chỉ tin 1 được gửi; dòng `cancelled`, `sent = 1`
- Tests: `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › huỷ giữa chừng thì dừng trước tin kế tiếp; huỷ chỉ đụng lượt của mình"

### AC-20: Lượt kẹt quá 10 phút thì cron huỷ
- Given lượt `running` và lượt `pending` tạo 11 phút trước, một lượt `running` vừa tạo
- When lượt cron `*/15 0-17,21-23 * * *`
- Then hai lượt cũ `cancelled`, lượt mới vẫn `running`; không gọi push service
- Tests: `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › lượt cron huỷ lượt kẹt quá 10 phút, không đụng lượt đang chạy, không gửi gì"

### AC-21: Không còn máy thì kết thúc
- Given máy bị gỡ trong lúc chờ tin 1
- Then ngủ đúng một lần (10 giây), không gửi; dòng `done`, `sent = 0`
- Tests: `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › máy bị gỡ trong lúc chờ thì kết thúc, không gửi"

### AC-22: Chỉ nhận endpoint của push service thật (ADR-90)
- Given endpoint `https://fcm.googleapis.com/fcm/send/…`, `https://updates.push.services.mozilla.com/wpush/v2/…`, `https://web.push.apple.com/…`, `https://api.push.apple.com/…`, `https://wns2-par02p.notify.windows.com/w/?token=…`; và `https://attacker.example/p`, `https://fcm.googleapis.com.attacker.example/p`, `https://evilpush.apple.com/p`, `https://push.apple.com.evil/p`, cổng 8443, có `user:pw@`
- When `isPushEndpoint` / `POST /v1/push/subscriptions`
- Then năm cái đầu hợp lệ; sáu cái sau 400, bảng không có dòng nào
- Tests: `test/push.test.ts` › "đăng ký máy › chỉ nhận endpoint của push service thật (FCM, Mozilla, Apple, Microsoft); URL https khác bị từ chối, không ghi gì"

### AC-23: Nhãn máy lấy từ header của request (ADR-90)
- Given header `User-Agent` của Chrome Android, body có `user_agent` của iPhone Safari
- When đăng ký rồi `GET /v1/push`
- Then `device = "Android · Chrome"`
- Tests: `test/push.test.ts` › "đăng ký máy › nhãn máy lấy từ User-Agent của request, không nhận user_agent trong body"

### AC-24: Gỡ máy theo id, của ai cũng được (ADR-90)
- Given máy của "wife"
- When "husband" `DELETE /v1/push/subscriptions/:id` hai lần; rồi id `abc`
- Then 200 `{ removed: 1 }`, bảng rỗng; 404; 400; nhật ký có `push.add` (wife) rồi `push.remove` (husband) cùng `{ member_id: "wife", device: "iPhone · Safari" }`
- Tests: `test/push.test.ts` › "đăng ký máy › gỡ một máy theo id, của ai cũng được (máy lạ gỡ được từ Cài đặt); gỡ lại báo 404; có nhật ký"

### AC-25: Mỗi người tối đa 10 máy (ADR-90)
- Given "husband" đã có 10 máy
- When đăng ký máy thứ 11; chuyển máy của "wife" sang "husband"; đăng ký lại một máy đã có của "husband"
- Then 409 `too_many_devices`; 409; 200 — "husband" vẫn đúng 10 máy
- Tests: `test/push.test.ts` › "đăng ký máy › mỗi người tối đa 10 máy: máy thứ 11 (kể cả máy chuyển từ người khác) bị từ chối 409; đăng ký lại máy đã có vẫn được"

### AC-26: Thêm máy mới thì cảnh báo cả nhà; đăng ký lại máy của mình thì không (ADR-90)
- Given bot token Telegram, "husband" có `tg_chat_id 1001`
- When "wife" đăng ký máy Android (API token); "wife" đăng ký lại đúng máy đó; "husband" đăng ký máy đó
- Then chat 1001 nhận "⚠️ Vợ (qua API token) vừa thêm máy nhận thông báo: Android · Chrome — nếu không phải người nhà làm, vào Cài đặt gỡ ngay."; lần hai không thêm tin; lần ba thêm một tin; nhật ký hai dòng `push.add` (em, anh)
- Tests: `test/push.test.ts` › "đăng ký máy › thêm máy mới (hay chuyển máy sang người khác) thì cảnh báo mọi kênh của cả nhà; đăng ký lại máy của chính mình thì không"

## Traceability
- Code: `src/services/push.ts` › `ensureVapid`, `loadVapid`, `PushText`, `pushPayload`, `sendPush`, `SEND_TIMEOUT_MS`, `pushToMembers`, `deviceLabel`, `getPush`, `PUSH_HOSTS`, `isPushEndpoint`, `MAX_DEVICES_PER_MEMBER`, `subscribe`, `unsubscribe`, `removeSubscription`, `sendTest`, `createTestSeries`, `runTestSeries`, `cancelTestSeries`, `cancelStaleTestSeries`; `src/routes/push.ts` › `pushRoutes`; `src/services/audit.ts` › `afterResponse`, `recordChange`; `src/cron/index.ts` › `everyMinute` (cron `pendingLogs`); `src/index.ts` › `app.route("/v1/push", pushRoutes)` (sau `requireAuth`); `src/notify/telegram.ts` › `notifyMembers`; `src/notify/format.ts` › `NotifyMessage` (bản ngắn của từng tin); `package.json` › `@block65/webcrypto-web-push`

## Divergences & Open Questions
- [OPEN] `vapid_subject` là origin của request đầu tiên sinh khoá và không bao giờ đổi; không có cách xoay khoá hay đổi `sub` từ app. Nếu lần đầu đi qua `http://localhost` (dev trỏ D1 thật) thì `sub` không phải `https:`/`mailto:` — báo cáo nghiên cứu §4 ghi Apple từ chối JWT có `sub` sai.
- [OPEN] Push hỏng không phải 404/410 (vd 403 khi VAPID sai) chỉ ghi `ok = 0` và log; máy vẫn hiện "Đang bật" ở PWA, không ai biết — cùng gốc với [DIVERGENCE] badge ở UC-408.
- (Đã đóng ở v6, ADR-79: dòng `notifications` của `push:<id>` trước đây lưu văn bản HTML của Telegram; nay lưu đúng bản ngắn đã gửi.)
- (Đã đóng ở v7, ADR-90: gỡ theo `endpoint` vẫn không kiểm chủ, nhưng nay mọi máy gỡ được theo id từ Cài đặt và nhãn máy không do người gọi tự khai; máy lạ chỉ đăng ký được tới push service thật và luôn báo cả nhà.)
- [OPEN] Máy của thành viên `active = 0` và máy không bao giờ nhận được (lỗi khác 404/410) không bị dọn; `notifications` thêm một dòng mỗi máy mỗi tin, không có thời hạn lưu.
- [OPEN] `push_subscriptions.id` là `INTEGER PRIMARY KEY` không `AUTOINCREMENT`: xoá máy có `id` lớn nhất (404/410 hoặc Tắt) rồi một máy khác đăng ký thì SQLite có thể cấp lại đúng `id` đó — claim cũ `push:<id>` cùng `(kind, day_key)` sẽ chặn máy mới nhận tin đó.
- [OPEN] Lượt gửi thử chạy trong `waitUntil` của request: mỗi tin tới mỗi máy là một lần ECDH + ECDSA (Web Crypto) và một `fetch`. Gói Workers Free giới hạn CPU mỗi request 10 ms — 2 tin × vài máy có thể chạm giới hạn; thời gian ngủ không tính CPU. `waitUntil` chỉ được hứa ≈ 30 giây sau khi trả lời; lượt dài nhất ≈ 20 giây cộng thời gian gửi. Chưa đo trên Cloudflare thật.
- [OPEN] Cột `push_test_series` vẫn mang CHECK của bản đầu (`count` 1–5, `interval_s` 10–60, trạng thái `pending`) — code chỉ ghi `count` 1–2, `interval_s` = 10, `running`; giữ để không phải sửa migration 0009 đã chạy production. Bảng không có dọn dẹp.
