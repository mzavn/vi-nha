# 261001-pwa-web-push: Thông báo đẩy trên PWA (kênh thứ hai bên cạnh Telegram)
- Status: implemented (2026-10-01, code + test xanh, commit `5dc53be`; hợp nhất vào `specs/` cùng ngày)
- BR: BR-06 (+ BR-09 cho khoá VAPID và việc gỡ máy khi đổi người)
- Đụng tới: notify UC-407/UC-408 + UC-410 mới · access ma trận xác thực, `Config` (khoá VAPID) · pwa UC-701/UC-709/UC-710 + UC-714 mới · ADR-64
- Đóng: —
- Nghiên cứu: `plans/reports/researcher-261001-pwa-web-push.md`

## Vì sao

Mọi lời nhắc (tin sáng 07:00, tổng kết tuần, giao dịch chưa gán) chỉ đi qua Telegram. Vợ ít dùng Telegram nên gần như không thấy tin — BR-06 "không cần mở app cũng biết tình hình" chỉ đúng với một người. PWA đã cài trên điện thoại của cả hai người nhưng không báo được gì.

## Thay đổi spec

### notify
- **UC-410 mới** — Gửi thông báo đẩy tới máy đã bật: bảng `push_subscriptions` (mỗi máy một dòng, gắn người đang đăng nhập), API `/v1/push` (xem, đăng ký, gỡ, gửi thử), gửi bằng Web Push chuẩn (VAPID, `aes128gcm`), push service trả 404/410 thì xoá máy.
- **UC-408** — `notifyMembers` thành cửa gửi nhiều kênh: Telegram (như cũ) **và** từng máy đã bật; chống trùng bằng cùng bảng `notifications` với `chat_id = 'push:<id>'`; thiếu bot token chỉ bỏ kênh Telegram, không còn trả 0 ngay; số trả về cộng cả hai kênh. AC-4 sửa theo.
- **UC-407** — "đã báo" (`sent > 0`) nay tính cả push.
- Entity: `PushSubscription` mới; `Notification.chat_id` thêm nghĩa `push:<id>`.

### access
- Ma trận xác thực: `/v1/push*` đi qua `requireAuth` như `/v1/*`; người được gắn máy = `memberId` của phiên/token.
- `Config`: ba khoá `secret:vapid_private_jwk`, `vapid_public`, `vapid_subject`; khoá riêng không bao giờ ra API, không ghi log. `schema_version` lên `1.8`.

### pwa
- **UC-714 mới** — Bật thông báo trên máy này (thẻ "Thông báo" ở Cài đặt): 5 trạng thái, Bật · Gửi thử · Tắt, danh sách máy, chặn iPhone/iPad chưa thêm vào màn hình chính, đồng bộ lúc vào app.
- **UC-701** — Đăng xuất gỡ thông báo của máy trước khi xoá phiên; vào app bằng người khác người đã bật thì gỡ.
- **UC-709** — thêm phần "Thông báo" (9 phần).
- **UC-710** — service worker xử lý `push`, `notificationclick`, `pushsubscriptionchange`.

### BR-06
- Success metric thêm: tin tới cả mọi máy đã bật thông báo trên PWA.

## Quyết định
ADR-64 (`specs/decisions.md`): Web Push chuẩn qua `@block65/webcrypto-web-push`, khoá VAPID tự sinh lưu `config`, gửi tới mọi kênh đang bật, xoá máy khi 404/410. Loại: dịch vụ push trả phí, chỉ Declarative Web Push, tự viết phần mã hoá, cho mỗi người chọn kênh.

## Thiết kế
`migrations/0008_push_subscriptions.sql` (v1.7 → v1.8; nhớ sao lưu D1 production trước) · `src/services/push.ts` · `src/routes/push.ts` · `src/notify/telegram.ts` › `notifyMembers` · `src/index.ts` · `web/sw.js` · `web/src/lib/push.ts` · `web/src/state/push.ts` · `web/src/state/store.ts` · `web/src/screens/settings.tsx`.

## Việc cần làm
- [x] Test cho từng AC mới/sửa (`test/push.test.ts`, `web/src/lib/push.test.ts`; AC giao diện/service worker chưa có test — ghi ⚠ ở UC)
- [x] Code
- [x] Cập nhật UC chính + `## History`
- [x] Sinh lại `traceability.md`, `open-issues.md`
