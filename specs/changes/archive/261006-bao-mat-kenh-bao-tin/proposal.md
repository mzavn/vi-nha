# 261006-bao-mat-kenh-bao-tin: Kênh báo tin không cài lén được, cảnh báo cả nhà khi kênh/khoá đổi, nhật ký thay đổi
- Status: archived
- BR: BR-09, BR-06, BR-08
- Đụng tới: UC-505, UC-506, UC-507, UC-508 (access); UC-408, UC-410, UC-411 (notify); UC-306 (ingest); UC-102 (ledger); UC-709, UC-714 (pwa)
- Đóng: [OPEN] "Gỡ máy theo `endpoint` … an toàn dựa vào việc `endpoint` không bao giờ ra API" (UC-410) — nay gỡ được theo id ở Cài đặt; nhãn máy không còn do người gọi tự khai
- Người duyệt nghiệp vụ: chủ nhà ("kêu đội red-team vào xử lí bảo mật", 2026-10-06 — đã duyệt, không chờ) · Người duyệt kỹ thuật: —

## Vì sao
Chủ nhà, 2026-10-06: "kêu đội red-team vào xử lí bảo mật". Red-team bốn vai (6/10) báo, đã kiểm lại trên code hiện tại:
- **INSIDER-01** (High): ai có cookie / API token đều cài được kênh nhận tin tiền **sống qua lần đổi mật khẩu**: `POST /v1/push/subscriptions` nhận endpoint https bất kỳ kèm khoá của kẻ gian và nhãn máy do người gọi tự khai (`user_agent` trong body); danh sách máy ở Cài đặt không có nút gỡ (gỡ chỉ theo endpoint, mà API không bao giờ trả endpoint). Nối Zalo lại cho người đã nối thì âm thầm đè chat cũ; `tg_chat_id` sửa thẳng được; đổi bot token không báo ai.
- **INSIDER-02** (Medium): đổi khoá webhook / token SePay hay tắt kết nối không báo ai — khoá do kẻ gian đặt cho phép gửi giao dịch giả từ bất kỳ đâu; tắt kết nối làm giao dịch thật rơi mất.
- **INSIDER-04** (Medium): huỷ / sửa / gỡ gán giao dịch, sửa cài đặt, đổi khoá không để lại ai làm, lúc nào.
- **INSIDER-05** (Low): mã nối Zalo 6 số thử không giới hạn. **INSIDER-06** (Low): gợi ý khoá lộ 4 ký tự cuối trong khi khoá ngắn nhất 8 ký tự (50%).
- **INFRA-05** (Low): push nhận host bất kỳ, không giới hạn số máy; mọi `fetch` ra ngoài (push, Telegram, Zalo) không có thời hạn — một máy treo giữ cả lượt cron.
- Ghi nhận, không làm (ADR-90 › Rủi ro chấp nhận): SC-02 (khoá lưu thẳng trong D1 và bản sao lưu), SC-03 (Google Fonts), INSIDER-07 (MCP secret trong URL bị Workers Logs ghi).

## Thay đổi spec

### UC-410 (notify — Web Push)
- MODIFIED bước 4: endpoint phải thuộc `PUSH_HOSTS` (FCM, autopush Mozilla, `*.push.apple.com`, `*.notify.windows.com`; https, cổng mặc định, không user/password); nhãn máy lấy từ header `User-Agent` của request, body `user_agent` bị bỏ qua; mỗi người tối đa 10 máy (`409 too_many_devices`, kể cả máy chuyển từ người khác); máy mới với người đó → nhật ký `push.add` + cảnh báo cả nhà.
- ADDED bước 5a: `DELETE /v1/push/subscriptions/:id` — gỡ theo id, của ai cũng được; không có → 404; nhật ký `push.remove`. Gỡ theo endpoint cũng ghi `push.remove`.
- MODIFIED luật gửi: mỗi lần gọi push service tối đa 10 giây (`AbortSignal.timeout`); hết giờ = lỗi mạng (thử lại như cũ). Tin `security` mở `/#cai-dat`, `Urgency: high`.
- MODIFIED AC-4 (endpoint ngoài danh sách cũng 400). ADDED AC-22 (danh sách host), AC-23 (nhãn từ header), AC-24 (gỡ theo id), AC-25 (tối đa 10 máy), AC-26 (cảnh báo khi thêm máy).

### UC-411 (notify — Zalo)
- ADDED: người đã nối Zalo không tạo được mã (`409 zalo_linked`, "… đang nối Zalo. Bấm Bỏ nối Zalo trước rồi mới nối Zalo khác."); mã còn hạn mà người đó đã nối chat khác thì không đè (trả lời "… đang nối Zalo khác …", xoá mã).
- ADDED: mã sai đếm theo chat trong `zalo_code_failures`; quá 5 lần / 1 giờ thì chat đó không được thử mã (trả lời một lần mỗi ngày "Đã nhắn sai mã quá nhiều lần…").
- ADDED: nối xong → nhật ký `member.zalo_link` mang người tạo mã (`created_by`, `created_via`), cảnh báo cả nhà. `callZalo` tối đa 10 giây.
- MODIFIED AC-2 (thêm cảnh báo + nhật ký). ADDED AC-11 (phải bỏ nối trước; không đè), AC-12 (giới hạn mã sai).

### UC-408 (notify — Telegram)
- MODIFIED luật gửi: mỗi lần gọi Telegram tối đa 10 giây. ADDED: tin `security` (cảnh báo, ADR-90) đi qua `notifyMembers` với `day_key = audit:<id>`.

### UC-507 (access — thành viên)
- ADDED: đổi `tg_chat_id` (đặt / đổi / bỏ) hay bỏ nối Zalo → nhật ký `member.update` (chỉ tên trường) + cảnh báo cả nhà **và chat cũ**; tạo mã nối Zalo → nhật ký `member.zalo_code`; người đã nối Zalo → 409.
- MODIFIED AC-8 (bỏ nối có cảnh báo + nhật ký), AC-9 (đã nối → 409). ADDED AC-10 (đổi chat Telegram báo chat cũ, chat mới, cả nhà; không đổi thì không báo).

### UC-508 (access — khoá kết nối)
- MODIFIED: `hint` = **2 ký tự cuối** (khoá ≥ 8), không bao giờ quá 25% khoá. AC-1, AC-3, AC-9, AC-11 đổi số gợi ý.
- ADDED: `PUT /integrations` có khoá → nhật ký `integrations.update { set, cleared }` + cảnh báo cả nhà; kết nối SePay: thêm có khoá/token, đặt/đổi/xoá khoá hay token, tắt → nhật ký `sepay.create|update { fields, active }` + cảnh báo; chỉ đổi tên → nhật ký, không cảnh báo.
- ADDED AC-15 (cảnh báo SePay), AC-16 (cảnh báo khoá Telegram/Zalo), AC-17 (nhật ký không bao giờ chứa khoá).

### UC-505 (access — xem cấu hình)
- ADDED: `GET /v1/settings/audit` → 50 dòng mới nhất, mới trước, kèm tên người. ADDED AC-6. MODIFIED AC-5 (2 ký tự cuối).

### UC-506 (access — tài khoản)
- ADDED: thêm / sửa tài khoản → nhật ký `account.create|update { fields }`.

### UC-102 (ledger — huỷ/sửa) · UC-306 (ingest — gỡ gán)
- ADDED: huỷ → `tx.void`, sửa (không trùng `client_id`) → `tx.replace`, gỡ gán → `tx.unassign { voided, logs }`; lỗi thì không ghi.

### UC-714, UC-709 (pwa)
- UC-714: danh sách máy có "bật ngày …" và nút **Gỡ** (hai bước "Gỡ hẳn", ≥ 44px) cho mọi máy; máy này thì tắt như nút Tắt. Không gửi `user_agent` nữa.
- UC-709: phần mới **Nhật ký thay đổi** trong Nâng cao (50 dòng: việc + đối tượng, ai · qua đâu · giờ, tên trường đã đổi); gợi ý khoá "2 ký tự cuối".

### Entity
- `audit_log` (mới, access): `id, at, member_id, via ('session'|'token'|'mcp'), action, target, detail (JSON hợp lệ, không khoá)`; trigger chặn UPDATE/DELETE.
- `zalo_link_codes.created_by`, `.created_via` (mới); `zalo_code_failures (id, chat_id, at)` (mới).
- `push_subscriptions.user_agent`: nay là header `User-Agent` của request đăng ký.
- `notifications.kind = 'security'`, `day_key = 'audit:<id>'`; `kind = 'zalo_limited'`.

## Quyết định
ADR-90 (chép vào `specs/decisions.md`): kênh báo tin chỉ thêm được qua đường kiểm soát + mọi kênh/khoá mới báo cả nhà + nhật ký chỉ thêm. Phương án bị loại: bắt nhập lại mật khẩu khi đổi khoá (step-up) — app không có tài khoản riêng từng người, mật khẩu chung bị lộ thì step-up vô nghĩa; gỡ máy cũ nhất khi quá 10 máy — kẻ gian dùng được để đẩy máy thật ra; nối Zalo lại thì báo chat cũ rồi đè — vẫn mất kênh của nạn nhân.

## Thiết kế
- Migration `0026_audit_log.sql` (schema 1.26): `audit_log` + 2 trigger; `zalo_link_codes` thêm 2 cột; `zalo_code_failures` + index. Sao lưu D1 production trước khi chạy.
- `src/services/audit.ts` (mới): `audit`, `listAudit`, `alertMembers`, `recordChange`, `afterResponse` (chuyển từ `routes/push.ts`), `actorOf`, `fieldNames`. Cảnh báo chạy trong `waitUntil`.
- `src/services/push.ts`: `PUSH_HOSTS`, `isPushEndpoint`, `MAX_DEVICES_PER_MEMBER`, `SEND_TIMEOUT_MS`, `subscribe(…, userAgent)`, `unsubscribe` trả máy đã gỡ, `removeSubscription`. `src/routes/push.ts`: `DELETE /subscriptions/:id`.
- `src/services/zalo.ts`: `createZaloLinkCode(…, actor)`, `handleZaloUpdate` (giới hạn, không đè, nhật ký, cảnh báo). `src/notify/telegram.ts`, `src/notify/zalo.ts`: timeout.
- `src/services/secrets.ts` `describeValue` 2 ký tự. `src/routes/settings.ts`, `v1.ts`, `logs.ts`: ghi nhật ký / cảnh báo sau khi việc chính thành công. `src/services/settings.ts`: `readMember`, `toAccount.id`.
- PWA: `web/src/screens/settings.tsx` (`PushNotifications` nút Gỡ, `AuditLog`), `web/src/lib/settings.ts` (`secretLabel` 2 ký tự, `auditView`), `web/src/state/push.ts` (bỏ `user_agent`).
- Rủi ro: nhật ký ghi sau việc chính (không cùng batch) — Worker chết giữa hai câu thì mất một dòng; cảnh báo không tới khi chưa ai có kênh; người có token vẫn chọn được `X-Member-Id` (nhật ký ghi `via: token` để phân biệt).

## Việc cần làm
- [x] Test cho từng AC mới/sửa
- [x] Code
- [x] Cập nhật UC chính + `## History`
- [ ] Sinh lại `traceability.md`, `open-issues.md` (agent chính làm sau khi hai nhánh xong)
