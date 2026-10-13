# 261013-an-so-va-ma-pin: Che số tiền trên máy này (chỉ hiện %) và khóa app bằng mã PIN
- Status: archived
- BR: BR-09 (dùng trên điện thoại an toàn, riêng tư)
- Đụng tới: pwa UC-718 (mới, Che số tiền trên máy này), UC-719 (mới, Khóa app bằng mã PIN), UC-709 (Cài đặt › Máy này), UC-711 (khung, thanh tiêu đề / thanh bên)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-13, chat (quyết định trích dưới) · Người duyệt kỹ thuật: reviewer agent, 2026-10-13, approve with changes — đã sửa
- Commit: propose `c148d31` · code `f7cf796` · merge `—`

## Vì sao

Chủ nhà, 2026-10-13: "có cái feat: 1. ẩn số ****, chỉ hiện % nè; 2. mã pin truy cập cho app". Chọn:
- Ẩn số: **nút con mắt, theo từng máy**; **ô nhập vẫn hiện số** (chỉ ẩn số hiển thị).
- PIN: **hỏi khi mở app hoặc quay lại sau 1 phút ở nền**; hỏi lại "đặt lại PIN kiểu gì" → đề xuất ở UC-719 (Đổi PIN ở Máy này; Quên PIN = đăng xuất máy này rồi đăng nhập lại bằng mật khẩu và đặt PIN mới).

Hiện trạng: mở app là thấy hết số (phiên đăng nhập 30 ngày, `src/routes/auth.ts`); không có chế độ ẩn số, không có khóa trên máy.

## Thay đổi spec

### UC-718 (mới, pwa): Che số tiền trên máy này
(Tên khác "ví ẩn số" của access UC-504 — đó là ví riêng tư; đây là che mắt trên một máy.)
- Main Flow: nút **con mắt** ở thanh tiêu đề mọi màn (điện thoại) và chân thanh bên (máy tính). Bật → mọi **số tiền hiển thị** thành `••••` (giữ "₫", giữ dấu −/+ và màu đỏ/xanh để biết tiền vào hay ra): số dư, tổng, hero Hôm nay (`Money`), dòng giao dịch, gợi ý từ sổ trong sheet ("Ví này còn X", "còn nợ X"), câu chữ có số tiền ("≈ 7,01 tỷ ₫"). **Không che**: phần trăm, số ngày / tháng / năm, số đếm ("12 giao dịch"), số lượng (chỉ, cổ phiếu), độ dài thanh tiến độ, và **số người đang gõ** (ô nhập, dòng "= X ₫" dưới ô, nút "Lưu X", nút cộng nhanh). Bật che thì xoá các thông báo đang hiện có số (toast, "vừa ghi"). Lựa chọn lưu ở máy (`localStorage` `vi-nha:hide-amounts`), đọc lúc khởi động như giao diện sáng/tối; không gửi server, không ảnh hưởng máy khác. Nhãn đọc màn hình: nút "Che số tiền" / "Hiện số tiền"; số đang che đọc là "đã che số tiền".
- Ngoài phạm vi: thông báo trên máy (Web Push), Telegram / Zalo, câu lỗi do server trả, MCP. Che số là che mắt, không phải bảo mật.
- AC-1: Given chưa che When bật che Then `formatVnd(1500000)`, `formatSigned`, `Money` ra `•••• ₫` (giữ dấu); `groupDigits`, số đếm, số lượng, phần trăm, `amountText` của ô nhập không đổi; tắt che → về số thật. (Test hàm thuần `web/src/lib/money.test.ts`; vẽ trên màn: ⚠ xem tận mắt 390/1280.)
- AC-2: Given đang che When mở Nhập, gõ 50.000 Then ô nhập và nút "Lưu 50.000 ₫" vẫn hiện số; toast sau khi lưu không có số tiền.
- AC-3: Given máy A che, máy B không When máy B mở app Then máy B vẫn hiện số; máy A tải lại vẫn che.

### UC-719 (mới, pwa): Khóa app bằng mã PIN
- Main Flow: Cài đặt › Máy này › **Mã PIN** (điện thoại; máy tính ở chân thanh bên) — hiện cả khi offline hoặc cài đặt chưa tải được, không phụ thuộc quyền chỉ-xem: **Đặt mã PIN** (6 số, nhập hai lần) → từ đó app khóa khi: **mở app**, hoặc **quay lại sau ≥ 60 giây** ở nền (đồng hồ bị chỉnh lùi → coi như quá 60 giây). Lúc app vào nền, nội dung được **che ngay** (không để ảnh chụp trình chuyển app thấy số — cố gắng tốt nhất); quay lại dưới 60 giây thì bỏ che. **Màn khóa thay cả màn app** (không phải lớp phủ): bàn phím số, đúng PIN → về đúng màn đang ở (giữ địa chỉ); nháp đang gõ dở (vd màn Nhập) mất. **Đổi mã PIN**: PIN cũ rồi PIN mới; **Tắt mã PIN**: PIN cũ.
- PIN gắn với **người đang đăng nhập trên máy**: bản ghi PIN mang `memberId`; đăng xuất (mọi cách), phiên hết hạn về màn đăng nhập, hay người khác đăng nhập trên máy → xoá PIN. Vừa đăng nhập bằng mật khẩu thì không hỏi PIN ngay.
- Lưu: `localStorage` `vi-nha:pin` = `{ v: 1, memberId, iter: 150000, salt (16 byte, base64), hash (PBKDF2-SHA-256, base64) }`, đọc đồng bộ lúc khởi động để màn khóa có trước khi số hiện ra; `vi-nha:pin-fails` đếm số lần sai (**tăng trước khi kiểm**, đúng thì về 0; Đổi/Tắt dùng chung bộ đếm). `localStorage` không dùng được → không cho bật PIN. Băm chỉ để không đọc thẳng được PIN; lớp bảo vệ chính là giới hạn 5 lần.
- Alt (quên PIN): màn khóa có **Quên mã PIN?** → hỏi lại "Đăng xuất máy này? Đăng nhập lại bằng mật khẩu rồi đặt PIN mới. Khoản chưa gửi vẫn giữ." → đăng xuất **ở máy ngay cả khi offline**: xoá PIN, ghi cờ `vi-nha:relogin` (app thấy cờ thì về màn đăng nhập dù phiên còn hạn; đăng nhập thành công mới xoá cờ); có mạng thì gọi thêm xoá phiên server và gỡ thông báo đẩy (lỗi thì bỏ qua). Đăng nhập cần mạng (UC-701 AC-6), nên đang offline thì phải chờ có mạng mới vào lại; hàng đợi khoản chưa gửi vẫn giữ.
- Exceptions: sai PIN → "Sai mã PIN, còn N lần"; sai **5 lần liên tiếp** → như Quên PIN.
- Giới hạn (ghi ở Máy này): PIN chặn người cầm máy mở app; không thay mật khẩu; Safari dạng tab (chưa cài ra màn hình chính) có thể tự xoá dữ liệu sau 7 ngày không mở — khi đó PIN mất, phải đặt lại.
- AC-1: `web/src/lib/pin.test.ts` — băm/kiểm PIN đúng/sai; bản ghi có `v`, `iter`, `salt`, `hash`, `memberId`. Given đã đặt PIN When mở app Then màn khóa trước khi thấy số, đúng PIN → về đúng địa chỉ (⚠ xem tận mắt).
- AC-2: `shouldLock` — ở nền 59 giây không hỏi; 60 và 61 giây hỏi; đồng hồ lùi hỏi.
- AC-3: sai 5 lần → `vi-nha:pin` xoá, `vi-nha:relogin` ghi, hàng đợi giữ; bộ đếm còn sau khi tải lại (tăng trước khi kiểm).
- AC-4: Đổi PIN với PIN cũ sai → lỗi, PIN không đổi, bộ đếm tăng; đúng → PIN mới dùng được, PIN cũ không.
- AC-5: Quên PIN offline → về màn đăng nhập, `checkSession` không vào thẳng app khi còn cờ `relogin`; đăng nhập thành công xoá cờ.
- AC-6: PIN của người A, đăng xuất rồi người B đăng nhập → không còn PIN.

### UC-709 MODIFIED (AC-15 nội dung Máy này) — thêm hàng **Mã PIN** (Đặt / Đổi / Tắt) + câu giới hạn. UC-711 MODIFIED (AC-1 Định dạng tiền) — số tiền có thể bị che; thanh tiêu đề / thanh bên có nút con mắt. pwa `entities.md`: thêm khóa `vi-nha:hide-amounts`, `vi-nha:pin`, `vi-nha:pin-fails`, `vi-nha:relogin`.

## Quyết định (ADR-110)
- PIN cục bộ trên máy, không qua server: mục tiêu là chặn người cầm máy; phiên đăng nhập đã có (30 ngày). Loại: PIN kiểm ở server (cần mạng, app offline-first).
- Che số ở chỗ định dạng **tiền**: `formatVnd`, `formatSigned`, `Money` và một hàm mới không kèm ₫; `groupDigits` giữ thuần cho số đếm, số lượng, ô nhập. Mọi chỗ đang gọi `groupDigits` cho số tiền chuyển sang hàm tiền (`freedom.ts`, `income-plan.ts`, `manual-split.ts`, `net-worth.ts`, `assign.tsx`, `ledger-book.tsx`, `memo-book.tsx`, `today-desktop.tsx`, `wallets.tsx`, `billionText`). Cờ nằm trong state app (vẽ lại cả cây) + setter ở `money.ts`; `money.ts` không đọc `localStorage` lúc import.
- Màn khóa là nhánh `return` sớm trong `App` (sheet dùng `<dialog>.showModal()` ở top layer, lớp phủ không che được).
- Quên PIN / sai 5 lần đăng xuất ở máy cả khi offline bằng cờ `relogin` (cookie phiên là HttpOnly, JS không xoá được).

## Thiết kế
- `web/src/lib/money.ts`: cờ ẩn (module state + setter), các hàm định dạng tiền trả `•••• ₫` khi bật; `AmountInput` dùng bộ định dạng không ẩn. Rà các chỗ tự ghép số tiền không qua `formatVnd`.
- `web/src/lib/pin.ts` (thuần, test; số vòng truyền vào được để test nhanh): băm/kiểm PIN (WebCrypto PBKDF2), đếm sai, `shouldLock`. `web/src/screens/lock.tsx`: màn khóa. `web/src/app.tsx`: chặn render khi khóa. `visibilitychange` ghi mốc vào nền.
- Không đổi server, không migration.

## Review kỹ thuật
Reviewer agent (2026-10-13) — approve with changes. Đã sửa: ranh giới che số (không che `groupDigits`; liệt kê chỗ phải chuyển; không che số đang gõ), cờ che trong state + xoá toast; quên PIN / sai 5 lần chạy được offline bằng cờ `relogin`; màn khóa là `return` sớm; bộ đếm lưu localStorage, tăng trước khi kiểm; che lúc vào nền; PBKDF2 150.000 vòng, bản ghi có phiên bản; nút PIN có cả trên máy tính và khi offline; PIN gắn người đăng nhập; ngoài phạm vi (push, Telegram/Zalo, lỗi server, MCP); đổi tên tránh trùng "ví ẩn số"; AC viết lại để test bằng hàm thuần; ADR-110.

## Việc cần làm
- [x] Review kỹ thuật; commit propose
- [x] Test đỏ → code: UC-718 AC-1…AC-3, UC-719 AC-1…AC-6
- [x] Deploy (2026-10-13 ~10:18 UTC, version `acbc5efd`; prod 390px: Hôm nay trước che 23 số tiền, sau che 0, tải lại vẫn che; nút Đặt mã PIN có ở Máy này); xem 390px / 1280px (bản cục bộ)
- [x] Hợp nhất specs (UC-718, UC-719 mới; UC-709, UC-711; ADR-110)
- [ ] GitBook (Ẩn số, Mã PIN)
