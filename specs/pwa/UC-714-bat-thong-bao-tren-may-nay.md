# UC-714: Bật thông báo trên máy này
- Status: implemented
- BR: BR-06, BR-09
- Decisions: ADR-64 (Web Push chuẩn trên PWA); ADR-79 (máy nhận bản ngắn, Telegram nhận bản đầy đủ); ADR-80 (Zalo cũng nhận bản đầy đủ); D6 (máy dùng chung, chọn người); change `261001-pwa-web-push`; `plans/reports/researcher-261001-pwa-web-push.md` (§1 nền tảng iOS, Common Pitfalls); ADR-92 (tên trong mã nguồn, dữ liệu, địa chỉ màn bằng tiếng Anh); ADR-94 (mã hệ thống tiếng Anh)
- Actor: Chồng hoặc Vợ trên điện thoại / máy tính của mình (có thể dùng chung); trình duyệt và service worker; server `/v1/push` (notify UC-410)
- Trigger: thẻ **Thông báo trên máy này** ở Cài đặt (`#settings`, phần `notifications`, ngay dưới thẻ Giờ nhắc của UC-709); vào app (`enter`); Đăng xuất; trình duyệt bắn `push` / `notificationclick` / `pushsubscriptionchange` vào service worker

Server lưu máy và gửi tin ở **notify UC-410 Gửi thông báo đẩy tới máy đã bật**; cửa gửi chung ở **notify UC-408**. Phần Cài đặt chứa thẻ này: **UC-709**; đăng xuất/đổi người: **UC-701**; service worker: **UC-710**.

## History
- v1 (2026-10-01, commit `5dc53be`): thẻ "Thông báo trên máy này" (5 trạng thái, Bật · Gửi thử · Tắt, danh sách máy), đồng bộ subscription lúc vào app, gỡ khi đăng xuất hoặc khi máy đang gắn người khác, service worker hiện thông báo, mở đúng màn khi bấm và tự đăng ký lại khi subscription đổi (change `261001-pwa-web-push`).
- v2 (2026-10-01, commit `7b71600`): dòng **Thử khi tắt app** ở trạng thái `on` — hẹn lượt gửi thử (5 tin, cách 15 giây) để kiểm thông báo về khi app đã vuốt tắt, hướng dẫn tắt app, nút **Huỷ** khi lượt còn chờ/đang gửi, đọc lại mỗi 5 giây trong lúc lượt chạy.
- v3 (2026-10-01, commit `d75c563`): lượt gửi thử ngắn — 2 tin, tin 1 sau khoảng 10 giây, tin 2 sau khoảng 20 giây, server gửi nền ngay trong request; câu hướng dẫn "Vuốt tắt app ngay. Tin 1 về sau khoảng 10 giây, tin 2 sau khoảng 20 giây."; bỏ trạng thái "Đang chờ gửi thử".
- v4 (2026-10-01, commit `a301077`): phần Thông báo của Cài đặt mở đầu bằng thẻ **Giờ nhắc** của cả nhà (pwa UC-709, ADR-68); thẻ này đứng ngay sau, `id` card đổi từ `thong-bao` thành `thong-bao-may` (hàng chip nhảy tới thẻ Giờ nhắc). Hành vi thẻ không đổi.
- v5 (2026-10-03, commit `4e6d103`): ghi chú thẻ nói rõ hai bản (ADR-79): "Tin gửi cho mỗi người tới Telegram (bản đầy đủ) và mọi máy người đó đã bật ở đây (bản ngắn, việc cần làm trước). …"; thông báo nhận được có tiêu đề mang con số chính (ví dụ "2 giao dịch chưa gán") thay cho tiêu đề cố định theo loại tin.
- v6 (2026-10-03, commit `5bd3117`): kênh Zalo (ADR-80) — ghi chú thẻ "Tin gửi cho mỗi người tới Telegram và Zalo (bản đầy đủ) và mọi máy người đó đã bật ở đây (bản ngắn, việc cần làm trước). …"; câu "Tin vẫn tới Telegram." (máy không hỗ trợ, sau khi Tắt) thành "Tin vẫn tới Telegram, Zalo.". Hành vi thẻ không đổi.
- v7 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90) — danh sách "Các máy đang nhận" hiện "bật ngày …" và nút **Gỡ** (bấm hai lần "Gỡ hẳn", cao 44px) cho **mọi** máy (`DELETE /v1/push/subscriptions/:id`, notify UC-410 AC-24); máy này thì gỡ như nút Tắt. Bật thông báo không gửi `user_agent` nữa (server lấy từ header). ⚠ Chưa có test UI (kiểm tay ở 390px: nút 48×44, gỡ được, nhật ký hiện dòng gỡ).
- v8 (2026-10-07, commit `7424f26`): địa chỉ Cài đặt `#settings`, URL mở từ thông báo dùng địa chỉ mới (`/#assign`…) — ADR-92 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v9 (2026-10-08, commit `21b9db0`): không đổi hành vi — mã mục Cài đặt `notifications`, card `device-notifications` (trước `thong-bao`, `thong-bao-may`). (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Bản build production (service worker đã đăng ký — UC-710). Bản dev không có service worker nên coi như máy không hỗ trợ.
- iPhone/iPad: iOS/iPadOS ≥ 16.4 và app mở từ icon đã "Thêm vào MH chính" (báo cáo nghiên cứu §1).
- Đã đăng nhập (UC-701); Bật / Gửi thử / Tắt / Thử khi tắt app / Huỷ cần mạng.

## Main Flow — Thẻ "Thông báo trên máy này"
1. Mở Cài đặt → phần `notifications`: sau thẻ Giờ nhắc (UC-709) là card `device-notifications` "Thông báo trên máy này", ghi chú: "Tin gửi cho mỗi người tới Telegram và Zalo (bản đầy đủ) và mọi máy người đó đã bật ở đây (bản ngắn, việc cần làm trước). Đổi người hay đăng xuất thì máy này tự tắt."
2. Đọc trạng thái máy (`readPushState` → `pushState`), xét theo thứ tự:
   | Trạng thái | Khi | Dòng hiện |
   |---|---|---|
   | `needs-install` | iPhone/iPad (kể cả iPadOS tự nhận là Mac: `Macintosh` + `maxTouchPoints > 1`) mà **không** mở ở chế độ `standalone` — xét trước cả "hỗ trợ" vì Safari thường không có `PushManager` | "Thêm Ví nhà vào màn hình chính trước" — "iPhone, iPad chỉ nhận thông báo khi app mở từ icon ngoài màn hình chính. Trong Safari bấm Chia sẻ → Thêm vào MH chính, rồi mở Ví nhà từ icon đó và bật ở đây." |
   | `unsupported` | Thiếu `serviceWorker`/`PushManager`/`Notification` hoặc chưa có bản đăng ký service worker | "Máy này không nhận được thông báo" — "{nhãn máy} không hỗ trợ thông báo đẩy. Tin vẫn tới Telegram, Zalo." |
   | `blocked` | `Notification.permission = "denied"` (kể cả khi còn subscription cũ) | "Thông báo đang bị chặn" + cách mở lại: iOS "Mở Cài đặt của máy → Thông báo → Ví nhà → bật Cho phép thông báo, rồi quay lại đây."; máy khác "Bấm biểu tượng cạnh địa chỉ trang → Thông báo → Cho phép, rồi tải lại trang. App cài trên Android: Cài đặt → Ứng dụng → Ví nhà → Thông báo." |
   | `on` | Quyền `granted` **và** máy có subscription | "Đang bật cho {tên người đang dùng}" — {nhãn máy}; nút **Gửi thử**, **Tắt**; dưới đó dòng lượt gửi thử (bước 16) |
   | `off` | Còn lại | "Chưa bật" — "Bật để {nhãn máy} nhận tin sáng, tổng kết tuần và nhắc gán giao dịch."; nút **Bật thông báo** ("Đang bật…" khi đang chạy) |
3. Tải `GET /v1/push` (khoá công khai, danh sách máy, lượt gửi thử gần nhất `series` của mình). Vẽ lại khi trạng thái mạng đổi, khi người đang dùng đổi, và khi việc gắn máy đổi ở chỗ khác (`onPushChange`).
4. Mục "Các máy đang nhận": mỗi máy một dòng — tên người (+ chip **máy này** nếu `id` trùng `vi-nha:push` và trạng thái là `on`), nhãn máy server trả (không có → "Máy không rõ"), dòng phụ "nhận tin gần nhất HH:mm d/m" (giờ VN, từ `last_ok_at` UTC) hoặc "chưa nhận tin nào". Rỗng → "Chưa máy nào bật" — "Mở Ví nhà trên điện thoại của từng người và bật ở đây."

## Main Flow — Bật
5. Bấm **Bật thông báo** (nút chỉ bật khi online, không bận, đã có khoá công khai) → `enablePush`: gọi `Notification.requestPermission()` **ngay trong cú bấm, trước mọi việc khác** (iOS bỏ qua lời hỏi ngoài cử chỉ người dùng). App không bao giờ tự hỏi quyền khi vừa mở.
6. `granted` → lấy subscription sẵn có hoặc `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) })` (khoá raw 65 byte).
7. `POST /v1/push/subscriptions { endpoint, keys: { p256dh, auth }, user_agent: navigator.userAgent }` → ghi `localStorage` `vi-nha:push = { memberId, id }`.
8. Kết quả: "Đã bật. Máy này sẽ nhận tin sáng, tổng kết tuần và nhắc gán giao dịch."; đọc lại trạng thái và danh sách.

## Main Flow — Gửi thử và Tắt
9. **Gửi thử** → `POST /v1/push/test` (mọi máy của người đang dùng — UC-410) → "Đã gửi tin thử tới N máy[, F máy không nhận]. Xem thông báo." (đỏ nếu `F > 0`); `sent = 0` → "Chưa gửi được: máy không nhận. Tắt rồi bật lại thông báo."; 409 `no_subscription` → "Server không còn giữ máy này. Tắt rồi bật lại thông báo."
10. **Tắt** → `unbindPush`: có subscription thì `POST /v1/push/subscriptions/remove { endpoint }`, rồi `subscription.unsubscribe()`, xoá `vi-nha:push` → "Đã tắt. Máy này không nhận thông báo nữa; tin vẫn tới Telegram, Zalo."

## Main Flow — Giữ máy gắn đúng người
11. Mỗi lần vào app (`enter`, sau `refresh`), chạy nền `syncPush(member.id)`, im lặng với mọi lỗi:
    - quyền khác `granted` → không làm gì;
    - không còn subscription → xoá `vi-nha:push`;
    - `vi-nha:push` ghi **người khác** người đang vào → `unbindPush` (tin của người trước không hiện trên máy này nữa);
    - còn lại → gửi lại subscription (`POST /v1/push/subscriptions`): giữ gắn đúng người, hồi sinh dòng server đã xoá.
12. Đăng xuất (UC-701): `unbindPush` **trước** `DELETE /v1/session` (server cần phiên để gỡ).

## Main Flow — Service worker (`web/sw.js`)
13. `push`: đọc JSON `{ title, body, url, tag }` (không phải JSON → coi cả chuỗi là `body`) → **luôn** `showNotification` trong `event.waitUntil` (iOS thu hồi quyền nếu push không hiện gì): tiêu đề trống → "Ví nhà"; `icon` `/icons/icon-192.png`; `tag` (cùng loại tin thay thông báo cũ); `data.url` (trống → `/`).
14. `notificationclick`: đóng thông báo; có cửa sổ cùng origin → `focus` rồi `navigate` tới `url` nếu khác (đổi `#` là đổi màn, app tự chuyển qua `hashchange`); không có → `openWindow(url)`.
15. `pushsubscriptionchange` (trình duyệt đổi/huỷ subscription): dùng `newSubscription`; không có thì đăng ký lại bằng `applicationServerKey` cũ, hoặc hỏi `GET /v1/push` lấy `publicKey`; `POST /v1/push/subscriptions` bằng cookie phiên (server gắn máy với người đang đăng nhập); `endpoint` cũ khác mới → `POST /v1/push/subscriptions/remove` cái cũ. Lỗi gì cũng bỏ qua.

## Main Flow — Thử khi tắt app
16. Ở trạng thái `on`, dòng thứ hai lấy theo `seriesView(info.series)`:
    | `series` | Dòng hiện | Nút |
    |---|---|---|
    | `null` | "Kiểm tra khi app đã tắt" — "Gửi 2 tin thử để xem thông báo có về khi app đã đóng." | **Thử khi tắt app** |
    | `running` (cả `pending` còn sót từ bản đầu) | "Đang gửi thử: {sent}/{count} tin" — "Vuốt tắt app ngay. Tin 1 về sau khoảng 10 giây, tin 2 sau khoảng {10 + interval_s} giây." (lượt 1 tin: chỉ vế tin 1) | **Huỷ** |
    | `done`, `sent > 0` | "Đã gửi thử {sent}/{count} tin" — "Thấy đủ tin khi app đã tắt là thông báo chạy tốt." | **Thử khi tắt app** |
    | `done`, `sent = 0` | "Chưa gửi được tin thử nào" — "Server không còn giữ máy này. Tắt rồi bật lại thông báo." | **Thử khi tắt app** |
    | `cancelled` | "Đã huỷ gửi thử" — "Đã gửi {sent}/{count} tin trước khi huỷ." | **Thử khi tắt app** |
17. **Thử khi tắt app** (bật khi online, không bận, đã có `GET /v1/push`) → `POST /v1/push/test-series` (mặc định server: 2 tin, cách 10 giây — notify UC-410 bước 12) → đọc lại thẻ, dòng thành "Đang gửi thử: 0/2 tin" kèm hướng dẫn tắt app. Server gửi nền ngay sau khi trả lời (chờ 10 giây rồi tin 1, thêm 10 giây tin 2 — UC-410 bước 14), nên vuốt tắt app vẫn nhận.
    - 409 `no_subscription` → "Server không còn giữ máy này. Tắt rồi bật lại thông báo." (đỏ)
    - 409 `series_running` → "Đang có một lượt gửi thử chưa xong. Đợi xong hoặc bấm Huỷ." (đỏ)
18. **Huỷ** → `POST /v1/push/test-series/cancel` → đọc lại; dòng thành "Đã huỷ gửi thử".
19. Trong lúc lượt còn `running` và có mạng, thẻ đọc lại `GET /v1/push` mỗi 5 giây (số tin đã gửi, nút Huỷ khớp server khi app còn mở). Mở lại app sau khi vuốt tắt → thẻ tải lại từ đầu (bước 3).

## Alternative Flows
- 5a. Người đóng hộp hỏi quyền (`default`) → "Chưa cho phép thông báo. Bấm Bật thông báo rồi chọn Cho phép." (đỏ), vẫn `off`.
- 5b. Người chọn Chặn (`denied`) → không có câu kết quả; thẻ chuyển sang `blocked`.
- 6a. Không có bản đăng ký service worker → lỗi "App chưa cài xong phần chạy nền. Tải lại trang rồi thử lại."
- 10a. Gỡ ở server lỗi nhưng không phải mất mạng → vẫn huỷ ở máy (endpoint chết, lần gửi sau server tự xoá — UC-410).
- 11a. Vào app offline → `syncPush` hỏng im lặng, làm lại lần mở sau.
- Offline: thẻ vẫn hiện (không theo chế độ chỉ-xem của Cài đặt); mọi nút (Bật, Gửi thử, Tắt, Thử khi tắt app, Huỷ) tắt khi `online = false`, việc đọc lại mỗi 5 giây dừng; danh sách máy có thể là bản lưu của service worker (UC-710).

## Exceptions
- E1. Tắt hoặc đăng xuất khi mất mạng → `unbindPush` ném lỗi, giữ nguyên subscription và `vi-nha:push` (lần sau làm lại); đăng xuất hiện toast "Đăng xuất cần mạng." và vẫn ở trong app (UC-701 E3).
- E2. `GET /v1/push` lỗi khi chưa có bản nào → câu lỗi đỏ ở mục "Các máy đang nhận"; nút Bật tắt (chưa có khoá công khai).
- E3. `localStorage` bị chặn → không nhớ được "máy này" (không có chip, không phát hiện đổi người ở bước 11); việc gửi vẫn chạy.

## Acceptance Criteria
### AC-1: Năm trạng thái của thẻ
- Given các tổ hợp (iOS, standalone, hỗ trợ, quyền, có subscription)
- Then iOS chưa thêm vào màn hình chính → `needs-install` (dù có hay không `PushManager`); iOS standalone đi theo quyền như máy khác, iOS cũ không có `PushManager` → `unsupported`; không hỗ trợ thắng mọi quyền; `denied` thắng cả khi còn subscription; `on` chỉ khi vừa `granted` vừa có subscription
- Tests: `web/src/lib/push.test.ts` › "pushState › iPhone chưa thêm vào màn hình chính thì chỉ cách cài, kể cả khi Safari không có PushManager"; `web/src/lib/push.test.ts` › "pushState › iPhone mở từ màn hình chính đi theo quyền như máy khác; iOS cũ không có PushManager là không hỗ trợ"; `web/src/lib/push.test.ts` › "pushState › máy không có push là không hỗ trợ, bất kể quyền"; `web/src/lib/push.test.ts` › "pushState › bị chặn thắng cả khi còn subscription cũ"; `web/src/lib/push.test.ts` › "pushState › chỉ 'đã bật' khi vừa có quyền vừa có subscription"

### AC-2: Nhận ra iPhone/iPad, kể cả iPadOS tự nhận là Mac
- Given UA iPhone; UA Mac + 5 điểm chạm; UA Mac không cảm ứng; Android có cảm ứng
- Then iOS / iOS / không / không
- Tests: `web/src/lib/push.test.ts` › "isIos › nhận iPhone và iPadOS tự nhận là Mac khi có cảm ứng"; `web/src/lib/push.test.ts` › "isIos › Mac thật (không cảm ứng) và Android không phải iOS"

### AC-3: Khoá công khai đổi đúng thành `applicationServerKey`
- Given khoá base64url không đệm, có `-` và `_`
- Then giải đúng byte; khoá P-256 raw ra 65 byte mở đầu `0x04`
- Tests: `web/src/lib/push.test.ts` › "base64UrlToBytes › giải base64url không đệm, có - và _"; `web/src/lib/push.test.ts` › "base64UrlToBytes › khoá công khai P-256 dạng raw ra đúng 65 byte, mở đầu 0x04"

### AC-4: Bật chỉ hỏi quyền khi bấm, rồi gắn máy với người đang dùng
- Given trạng thái `off`, có mạng
- When bấm **Bật thông báo** và chọn Cho phép
- Then trình duyệt hỏi quyền trong cú bấm; subscription được gửi lên; `vi-nha:push` ghi `{ memberId, id }`; thẻ thành "Đang bật cho {tên}", danh sách có chip **máy này**
- Tests: ⚠ Chưa có test (phía server: notify UC-410 AC-3)

### AC-5: Gửi thử báo đúng kết quả
- Given trạng thái `on`
- When bấm **Gửi thử**
- Then máy hiện thông báo "Gửi thử"; thẻ ghi "Đã gửi tin thử tới 1 máy. Xem thông báo."; server mất máy → "Server không còn giữ máy này. Tắt rồi bật lại thông báo."
- Tests: ⚠ Chưa có test (phía server: notify UC-410 AC-6, AC-7)

### AC-6: Tắt gỡ ở server rồi huỷ ở máy; mất mạng thì giữ nguyên
- Given trạng thái `on`
- When bấm **Tắt** có mạng / không mạng
- Then dòng server bị xoá, subscription bị huỷ, `vi-nha:push` bị xoá, thẻ về `off` / không đổi gì (nút Tắt vốn đã tắt khi offline)
- Tests: ⚠ Chưa có test

### AC-7: Danh sách máy đọc được
- Then nhãn "thiết bị · trình duyệt" (iPhone · Safari, iPhone · Chrome, iPad · Safari, Mac · Safari, Android · Chrome, Android · Samsung Internet, Windows · Edge, Mac · Firefox; UA lạ → "Máy không rõ"); lần nhận gần nhất đọc giờ SQLite UTC thành giờ VN ("nhận tin gần nhất 08:05 1/10"); chưa nhận → "chưa nhận tin nào"
- Tests: `web/src/lib/push.test.ts` › "deviceLabel › gọi máy theo thiết bị · trình duyệt"; `web/src/lib/push.test.ts` › "deviceLabel › user agent lạ vẫn có nhãn"; `web/src/lib/push.test.ts` › "lastOkText › giờ SQLite (UTC, không múi) đọc theo giờ VN"; `web/src/lib/push.test.ts` › "lastOkText › máy chưa nhận tin nào"

### AC-8: Vào app giữ máy gắn đúng người
- Given máy đã bật cho "Chồng", phiên hết hạn, "Vợ" đăng nhập trên máy đó
- When vào app
- Then máy bị gỡ (server và trình duyệt), "Vợ" không nhận tin của "Chồng" trên máy này; nếu cùng người thì subscription được gửi lại, dòng server đã mất được tạo lại
- Tests: ⚠ Chưa có test (phía server — đăng ký lại cùng endpoint chuyển người: notify UC-410 AC-3)

### AC-9: Đăng xuất tắt thông báo của máy
- Given trạng thái `on`, có mạng
- When Đăng xuất
- Then máy được gỡ trước khi xoá phiên; người sau dùng máy không nhận tin của người trước
- Tests: ⚠ Chưa có test

### AC-10: Thông báo hiện ra và mở đúng màn
- Given server gửi `{ title: "2 giao dịch chưa gán", body: "−24.400 ₫ MB chính (chồng) · +50.000 ₫ TK lạ", url: "/#assign", tag: "pending_batch" }` (bản ngắn của UC-407)
- When push tới máy, người bấm vào thông báo
- Then thông báo hiện với tiêu đề/nội dung đó; app (đang mở thì được đưa lên, không thì mở mới) chuyển tới màn Gán
- Tests: ⚠ Chưa có test (nội dung/đường mở theo loại tin: notify UC-410 AC-12)

### AC-11: Subscription đổi thì tự đăng ký lại
- Given trình duyệt bắn `pushsubscriptionchange` với `endpoint` mới
- Then `endpoint` mới được gửi lên bằng cookie phiên, `endpoint` cũ bị gỡ
- Tests: ⚠ Chưa có test

### AC-12: Dòng "Thử khi tắt app" theo trạng thái lượt gửi thử
- Given `series` `running` 0/2 (10 giây) / `running` 1 tin / `pending` / `done` 2/2 / `done` 0 tin / `cancelled` sau 1 tin / không có lượt
- Then ba dòng đầu có nút Huỷ, câu "Vuốt tắt app ngay. Tin 1 về sau khoảng 10 giây, tin 2 sau khoảng 20 giây." (lượt 1 tin: "Vuốt tắt app ngay. Tin 1 về sau khoảng 10 giây."); các trường hợp còn lại không có nút Huỷ, câu kết quả như bảng bước 16
- Tests: `web/src/lib/push.test.ts` › "seriesView › đang gửi thì hiện hướng dẫn tắt app theo đúng nhịp của lượt, kèm nút Huỷ"; `web/src/lib/push.test.ts` › "seriesView › xong, huỷ hay chưa có lượt nào thì không còn nút Huỷ; xong mà không gửi được tin nào thì báo lỗi"

### AC-13: Thử khi tắt app — tin về khi app đã vuốt tắt
- Given trạng thái `on` trên iPhone (app mở từ màn hình chính), có mạng
- When bấm **Thử khi tắt app** rồi vuốt tắt app
- Then khoảng 10 giây sau có thông báo "Thử khi tắt app" — "Tin 1/2 — …", khoảng 10 giây nữa "Tin 2/2 — …", hai thông báo riêng (không gộp); mở lại app thấy "Đã gửi thử 2/2 tin"
- Tests: ⚠ Chưa có test (phía server: notify UC-410 AC-14..AC-17, AC-19..AC-21; chưa thử trên iPhone thật)

## Traceability
- Code: `web/src/screens/settings.tsx` › `PushNotifications`, `SECTIONS` (`notifications`); `web/src/state/push.ts` › `enablePush`, `unbindPush`, `syncPush`, `readPushState`, `boundSubscriptionId`, `onPushChange`, `loadPushInfo`, `sendTestPush`, `startTestSeries`, `cancelTestSeries`; `web/src/lib/push.ts` › `pushState`, `isIos`, `base64UrlToBytes`, `deviceLabel`, `sqliteUtcToIso`, `lastOkText`, `seriesView`; `web/src/lib/types.ts` › `PushInfo`, `PushDevice`, `PushTestResult`, `PushTestSeries`; `web/src/state/store.ts` › `enter` (`syncPush`), `logout` (`unbindPush`); `web/sw.js` › handler `push`, `notificationclick`, `pushsubscriptionchange`, `openApp`, `resubscribe`
- Lưu trên máy: `localStorage` `vi-nha:push` (`{ memberId, id }`); subscription của trình duyệt (`PushManager`)
- Server: notify UC-410 (`/v1/push`, `/v1/push/test-series`, `push_subscriptions`, `push_test_series`)

## Divergences & Open Questions
- [OPEN] Hai bộ đoán nhãn máy khác nhau: dòng trạng thái dùng `web/src/lib/push.ts` › `deviceLabel` (biết iPadOS qua điểm chạm, Opera, ChromeOS, không rõ → "Máy không rõ"), còn danh sách dùng nhãn server (`src/services/push.ts` › `deviceLabel`, chỉ có User-Agent) — cùng một iPad hiện "iPad · Safari" ở trên nhưng "Mac · Safari" trong danh sách.
- [OPEN] `localStorage` bị chặn (E3) và người trước không Đăng xuất (phiên hết hạn rồi người khác đăng nhập): bước 11 không biết máy đang gắn ai, nên gửi lại subscription và **chuyển máy sang người vừa vào** mà người đó không bấm Bật — người mới nhận tin trên máy người trước đã bật.
- [OPEN] Trạng thái `on` chỉ dựa vào quyền + subscription ở máy, không hỏi server: máy bị server xoá (404/410) vẫn hiện "Đang bật" tới lần vào app sau (bước 11 tạo lại dòng).
- [OPEN] Chưa thử trên iPhone thật (thêm vào MH chính, bật, nhận, bấm mở màn) — cùng mục [OPEN] ở UC-710.
