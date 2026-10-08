# 261008-huong-dan-trong-app: Xem Hướng dẫn ngay trong app (nhúng GitBook)
- Status: archived
- BR: BR-08
- Đụng tới: UC-711 (pwa, điều hướng), UC-709 (pwa, Cài đặt › Máy này), UC-503 (access, header bảo mật)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-08, chat (giao việc trực tiếp) · Người duyệt kỹ thuật: reviewer agent, 2026-10-08, approve with changes — đã sửa
- Commit: propose `0bc9418` · code `934f30f` · merge `—`

## Vì sao

> "cái phần hướng dẫn sử dụng -> viết ngắn thành Hướng dẫn, với tôi thấy có thêm việc nhúng <iframe src=… width=\"100%\" height=\"700px\" style=\"border: none;\"> trực tiếp, k cần mở app, để chạy trong PWA cho dễ nè, hoặc xem ngay trong site"

Hiện trạng (kiểm 2026-10-08): "Hướng dẫn sử dụng" ở thanh bên máy tính (`web/src/ui/shell.tsx:151-154`) và Cài đặt › Máy này (`web/src/screens/settings.tsx:368-373`) mở GitBook `https://mzavn.gitbook.io/vi-nha` ở tab mới (`GUIDE_URL`, `web/src/lib/splits.ts:68`). Trong app cài trên điện thoại, tab mới là trình duyệt riêng — rời app. GitBook cho nhúng khung từ trang `https:` (`frame-ancestors https:`, kiểm header 2026-10-08); CSP của app hiện chặn mọi khung ngoài (`default-src 'self'`, `src/security-headers.ts`).

## Thay đổi spec

### UC-711 (pwa): Điều hướng
- ADDED AC-13: Given đang ở bất kỳ màn nào, When bấm **Hướng dẫn** (thanh bên máy tính; Cài đặt › Máy này trên điện thoại), Then mở màn `#guide` trong app: tiêu đề "Hướng dẫn", khung GitBook chiếm hết chiều cao còn lại (không cuộn hai lớp), nút **Mở ở tab mới** (mở `GUIDE_URL` như cũ). F5 ở `#guide` vẫn ở màn đó. Thanh dưới (điện thoại) vẫn hiện để quay về.
- ADDED AC-14: Given mất mạng, When mở `#guide`, Then không vẽ khung, hiện câu "Hướng dẫn cần mạng" và nút Mở ở tab mới.
- MODIFIED: chữ "Hướng dẫn sử dụng" → "Hướng dẫn" ở thanh bên (Alt 1a: mục thanh bên đi `#guide`, không mở tab mới). Main Flow 1: ba màn phụ không có tab — `#settings`, `#ledger`, `#guide`; bước 3 / AC-3: FAB ẩn ở Nhập, Cài đặt, Sổ giao dịch và Hướng dẫn; AC-6: bảng địa chỉ có 7 màn (thêm `#guide`).
- AC-14 (chi tiết): nguồn trạng thái mạng là `app.online`; khung đã tải mà rớt mạng thì giữ nguyên khung (GitBook tự xử lý), chỉ khi mở màn lúc đang mất mạng mới hiện câu báo.

### UC-709 (pwa): Cài đặt › Máy này
- MODIFIED: hàng "Hướng dẫn sử dụng · Mở hướng dẫn (tab mới)" → "Hướng dẫn · Mở hướng dẫn" đi màn `#guide` trong app.

### UC-503 (access): Header bảo mật
- MODIFIED bước 0 và AC-6: CSP thêm `frame-src https://mzavn.gitbook.io` (đặt sau `manifest-src`, trước `frame-ancestors`; không cần `child-src`) (chỉ đúng origin của `GUIDE_URL`); `web/public/_headers` khớp `src/security-headers.ts` như test hiện có. Không đổi `frame-ancestors 'none'` của app (app vẫn không cho ai nhúng mình).

## Quyết định
Nhúng thay vì tự vẽ nội dung hướng dẫn: GitBook đã là nơi viết + chụp ảnh. Loại: chép markdown vào app (hai nơi phải giữ khớp); để nguyên tab mới (rời PWA trên điện thoại).

## Thiết kế
- `web/src/lib/hash-route.ts`: thêm tab `guide`; sửa `web/src/lib/hash-route.test.ts` (7 màn, `parseHash('#guide')`) và chú thích "hai màn phụ" (`web/src/app.tsx:1-2`, `web/src/state/store.ts`).
- Chống cuộn hai lớp: `main` của màn này lớp `app app-guide` — `height: 100dvh; display: flex; flex-direction: column; overflow: hidden;` chừa đáy cho thanh dưới (điện thoại), máy tính không chừa; khung `flex: 1; min-height: 0; width: 100%; border: 0`, có `title`, không `sandbox` (GitBook cần script). `test/app.test.ts` thêm kiểm `frame-src` cạnh `frame-ancestors 'none'`. `web/src/screens/guide.tsx` (mới). `web/src/app.tsx`: vẽ `Guide` cho cả điện thoại và máy tính, không FAB. `web/src/ui/shell.tsx`, `web/src/screens/settings.tsx`: nút đi `#guide`.
- `src/security-headers.ts` + `web/public/_headers`: `frame-src`.
- Bản public sau này dùng cùng `GUIDE_URL` (hướng dẫn chung, dữ liệu mẫu).

## Review kỹ thuật
Reviewer agent (2026-10-08): hướng đúng (`frame-src` một origin đủ, service worker không đụng khung ngoài, có sẵn `app.online`). Đã sửa: MODIFIED UC-711 Main Flow / Alt / AC-3 / AC-6 và test "6 màn"; UC-503 bước 0 + AC-6 và test CSP; thêm mục UC-709; nêu cách chống cuộn hai lớp; nguồn offline và hành vi khi rớt mạng.

## Việc cần làm
- [x] Review kỹ thuật; commit propose
- [x] Test (hash `#guide`, CSP `frame-src`) → code → xem 390px + máy tính (`934f30f`)
- [x] Deploy (2026-10-08 ~11:00, version `867fe7a2`; kiểm prod 390px và 1280px: màn `#guide` hiện GitBook, khung cao 719 / 807 px, trang không cuộn thêm, không lỗi CSP); hợp nhất UC-711, UC-709, UC-503; archive
- [x] Cập nhật tài liệu GitBook: Máy này (mở hướng dẫn trong app), làm quen màn Hôm nay, Cài đặt, trang chào; chụp lại ảnh có thanh bên
