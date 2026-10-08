# 261006-bao-mat-dang-nhap: Chặn dò mật khẩu và khoá webhook, Đăng xuất mọi máy, header bảo mật
- Status: archived
- BR: BR-09
- Đụng tới: UC-501, UC-503, UC-508 (access); UC-301 (ingest); UC-411 (notify); UC-701 (pwa)
- Đóng: [OPEN] "Không giới hạn số lần thử mật khẩu ngoài độ trễ 400 ms", [OPEN] "Không có đường thu hồi một phiên đơn lẻ … ngoài đổi `APP_PASSWORD`" (UC-501); [DIVERGENCE] "route không giới hạn tần suất" (UC-301)
- Người duyệt nghiệp vụ: chủ nhà ("kêu đội red-team vào xử lí bảo mật", 2026-10-06 — đã duyệt, không chờ) · Người duyệt kỹ thuật: —

## Vì sao
Chủ nhà, 2026-10-06: "kêu đội red-team vào xử lí bảo mật". Red-team bốn vai (6/10) báo, đã kiểm lại trên code hiện tại:
- **ADV-001** (Medium): `POST /v1/session` chỉ chờ 400 ms mỗi lần sai; Worker chạy song song nên dò được hàng nghìn mật khẩu mỗi phút; không log lần sai nào. Id thành viên công khai (`GET /v1/session/members`).
- **INFRA-01** (Medium): `/webhooks/sepay`, `/webhooks/zalo` mở cho mọi người (BIC tắt cho `/webhooks/*`), đọc khoá từ D1 ở mọi request trước khi từ chối, khoá SePay chỉ cần 8 ký tự, không giới hạn lần sai — tốn lượt đọc D1 và dò được khoá để ghi giao dịch giả.
- **INSIDER-03 / ADV-002** (Medium / Low): cookie 30 ngày không lưu server; đăng xuất chỉ xoá cookie ở trình duyệt; mất điện thoại thì không có cách thu hồi từ app.
- **SC-01 / ADV-003** (Medium / Low): app shell và API không có CSP, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, chặn nhúng khung; app hiện nội dung chuyển khoản do người lạ đặt.

## Thay đổi spec

### UC-501 (access — đăng nhập)
- Main Flow: ADDED 2b — kiểm bộ đếm lần sai theo IP (`CF-Connecting-IP`) **trước** khi so mật khẩu; bước 4 mật khẩu đúng thì xoá đếm của IP; bước 5 cookie ký theo thế hệ phiên.
- ADDED 8b: `POST /v1/session/revoke-all` (qua `requireAuth`) tăng `config` `session_epoch` → mọi cookie đã phát hết hiệu lực; ghi nhật ký `session.revoke_all`, báo cả nhà (ADR-90); xoá cookie máy đang bấm. 8a ghi rõ đăng xuất chỉ xoá cookie ở trình duyệt.
- MODIFIED E1: sai mật khẩu ghi một lần sai (IP + dòng chung), log số lần (không mật khẩu), vẫn chờ 400 ms rồi 401. MODIFIED E4: thêm "đã bấm Đăng xuất mọi máy". ADDED E6 (429 `too_many_attempts` "Sai mật khẩu quá nhiều lần, thử lại sau N phút.", `Retry-After`), E7 (revoke-all không xác thực → 401, form → 415).
- ADDED AC-7: Given IP đã sai 8 lần When sai 2 lần rồi đúng mật khẩu từ IP đó, rồi đúng từ IP khác Then 401, 401, 429 (không cookie, `Retry-After` > 14 phút, câu "… thử lại sau 15 phút."), 200; log có "lần 10", không có mật khẩu.
- ADDED AC-8: Given 10 lần sai bắt đầu 16 phút trước When đúng mật khẩu, rồi sai một lần Then 200 và bảng rỗng; rồi hai dòng `('login','*',1)`, `('login',<ip>,1)`.
- ADDED AC-9: Given trần chung đã 29 When IP A đúng, IP B sai, IP A đúng Then 200, 401, 429.
- ADDED AC-10: Given cookie của `em` và `anh` When `em` gọi revoke-all, đăng nhập lại, rồi gọi lần nữa bằng API token Then cả hai cookie cũ 401 (`GET /v1/session` → `member: null`), cookie mới 200, API token 200; lần thứ hai làm cookie phát sau lần đầu cũng 401.
- ADDED AC-11: revoke-all không cookie → 401; cookie giả → 401; form thường → 415; phiên không đổi.

### UC-503 (access — đường dẫn)
- Main Flow ADDED 0: mọi phản hồi Worker mang `SECURITY_HEADERS`; app shell / `sw.js` / `/assets/*` qua Static Assets mang cùng bộ từ `web/public/_headers`.
- ADDED AC-6: `/v1/health`, `/v1/wallets` (401), `/v1/khong-co` (404), `/webhooks/sepay` (401), `/` (qua `ASSETS.fetch`) đều mang đủ header; `_headers` giống hệt hằng số.

### UC-508 (access — khoá kết nối)
- MODIFIED 5a / E1: `webhook_key` SePay đặt mới ≥ 24 ký tự ("Khoá webhook SePay cần ít nhất 24 ký tự — đặt khoá dài, ngẫu nhiên trong SePay rồi dán vào đây."); khoá đã lưu vẫn dùng được.
- ADDED AC-14: 23 ký tự → 400; thêm kết nối với khoá 19 ký tự → 400; 24 ký tự → 200; khoá cũ 12 ký tự nằm sẵn trong DB vẫn nhận webhook (200).

### UC-301 (ingest — webhook SePay)
- Main Flow ADDED 0: IP đã sai khoá ≥ 20 lần trong 15 phút → E4 (429) trước khi đọc khoá; bước 2 khoá không khớp → ghi một lần sai. MODIFIED E2 (lỗi D1 của bộ đếm cũng 503). ADDED E4.
- ADDED AC-11: Given IP đã sai 19 lần When sai lần 20, rồi khoá SePay đúng và khoá Zalo đúng từ IP đó, rồi khoá đúng từ IP khác Then 401 (đếm 20), 429, 429 chỉ với hai câu SQL đọc `auth_failures`, 200; khoá Zalo sai cũng đếm; hết 15 phút thì gửi lại được.

### UC-411 (notify — webhook Zalo)
- MODIFIED bước 10: kiểm bộ đếm `webhook` trước khi đọc khoá; khoá sai → ghi một lần sai. MODIFIED E4. ADDED AC-10 (dùng chung test với UC-301 AC-11).

### UC-701 (pwa — đăng nhập, đăng xuất)
- ADDED bước 7: **Đăng xuất mọi máy** — điện thoại: Cài đặt › Máy này, hàng "Mất máy, lộ mật khẩu?"; màn rộng: liên kết ở chân thanh bên; lần đầu luôn hỏi lại ("Mọi máy đang đăng nhập, cả máy này, sẽ phải nhập lại mật khẩu. Dùng khi mất điện thoại hoặc nghi lộ mật khẩu."); lần hai `unbindPush` → `POST /v1/session/revoke-all` → dọn máy như Đăng xuất.
- MODIFIED E2: câu 429 hiện nguyên văn. ADDED E3b (offline). ADDED AC-7 (⚠ chưa có test tự động phía PWA — chỉ nối nút với API; luật server có test UC-501 AC-10/11; đã chạy thử trên trình duyệt).

### Entity
- `auth_failures (scope, ip, first_at, failures)` — migration 0025, schema v1.25 (access entity AuthFailure). Ngưỡng `login` 10 / IP, 30 chung; `webhook` 20 / IP; cửa sổ 15 phút.
- `config.session_epoch` — thế hệ phiên, thiếu = 0 (access entity Session, Config).
- SepayConnection.`webhook_key`: đặt mới ≥ 24 ký tự.

## Quyết định
**ADR-89** (chép vào `specs/decisions.md`): bộ đếm lần sai theo IP ở D1 cho đăng nhập và webhook; khoá webhook SePay mới ≥ 24 ký tự; thế hệ phiên + Đăng xuất mọi máy; header bảo mật một nguồn cho Worker và Static Assets; `GET /v1/session/members` công khai là rủi ro chấp nhận. Phương án bị loại: Workers Rate Limiting binding (gần đúng, không test được), chỉ luật WAF Cloudflare (ngoài repo, không test), khoá theo thành viên (id công khai → khoá được cả nhà), đếm mọi request webhook (chặn được webhook thật), bảng phiên / thu hồi từng máy, giữ máy đang bấm đăng nhập, `hono/secure-headers`, `'unsafe-inline'`.

## Thiết kế
- `migrations/0025_auth_failures.sql` (bảng mới, `schema_version` 1.25) · `docs/schema.sql` (mục 20, ghi chú `session_epoch` ở mục 13) · `test/schema.test.ts`. Không đổi dữ liệu cũ — không cần sao lưu đặc biệt (vẫn sao lưu D1 production như thường lệ trước khi chạy).
- `src/services/auth-throttle.ts` (mới) › `THROTTLE_LIMITS`, `clientIp`, `blockedFor`, `recordFailure`, `clearFailures`.
- `src/routes/session.ts` › `session.post("/")` (429, đếm, xoá đếm), `session.post("/revoke-all")`; `src/routes/auth.ts` › `sessionEpoch`, `sign(env, epoch, payload)`, `revokeAllSessions`.
- `src/routes/webhooks.ts` › hai route: kiểm chặn trong `try` (D1 lỗi → 503), ghi lần sai khi 401.
- `src/services/settings.ts` › `secretValue` (`webhook_key` ≥ 24).
- `src/security-headers.ts` (mới) › `SECURITY_HEADERS`, `securityHeaders`; `src/index.ts` đăng ký middleware đầu tiên, `notFound` chép phản hồi `ASSETS.fetch` (header bất biến); `web/public/_headers` (mới).
- PWA: `web/src/state/store.ts` › `logout(everywhere)`; `web/src/ui/shell.tsx` › `useLogout(everywhere)`, `signOutEverywhereNote`, `Sidebar`; `web/src/screens/settings.tsx` › `DeviceCard`; `web/src/screens/settings-sheets.tsx` lời dặn khoá webhook 24 ký tự.
- Rủi ro: trần chung là đường chặn đăng nhập mới của cả nhà 15 phút (phiên đang có không ảnh hưởng); cả nhà chung IP thì chung đếm; một lần đọc `config` thêm mỗi request cookie; bản app shell cũ trong cache service worker chưa có CSP tới lần cập nhật kế tiếp.

## Việc cần làm
- [x] Test cho từng AC mới/sửa
- [x] Code
- [x] Cập nhật UC chính + `## History`
- [ ] Sinh lại `traceability.md`, `open-issues.md` (người tích hợp)
