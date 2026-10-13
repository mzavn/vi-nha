# UC-719: Khóa app bằng mã PIN
- Status: implemented
- BR: BR-09
- Decisions: ADR-110 (PIN cục bộ trên máy, không qua server; màn khóa là `return` sớm; quên PIN / sai 5 lần đăng xuất ở máy cả khi offline bằng cờ `relogin`)
- Actor: người đang đăng nhập trên một máy
- Trigger: Cài đặt › Máy này › **Mã PIN** (điện thoại) hoặc chân thanh bên (máy tính); mở app; quay lại app sau khi ở nền

## History
- v1 (2026-10-13, commit `f7cf796`): khởi tạo — chủ nhà: "mã pin truy cập cho app"; hỏi khi mở app hoặc quay lại sau 1 phút ở nền; quên PIN = đăng xuất máy này rồi đăng nhập lại bằng mật khẩu và đặt PIN mới (change [261013-an-so-va-ma-pin](../changes/archive/261013-an-so-va-ma-pin/proposal.md))

## Preconditions
- Đã đăng nhập (UC-701). `localStorage` dùng được (không thì không cho bật PIN).

## Main Flow
1. **Đặt mã PIN** (Cài đặt › Máy này, hiện cả khi offline hoặc cài đặt chưa tải được, không phụ thuộc quyền chỉ-xem — pwa UC-709; máy tính: chân thanh bên): 6 số, nhập hai lần → lưu `localStorage` `vi-nha:pin` = `{ v: 1, memberId, iter: 150000, salt (16 byte, base64), hash (PBKDF2-SHA-256, base64) }` — không chứa PIN. Băm chỉ để không đọc thẳng được PIN; lớp bảo vệ chính là giới hạn 5 lần.
2. Từ đó app khóa khi: **mở app** (bản ghi đọc đồng bộ lúc vào app, nên màn khóa có trước khi số hiện ra), hoặc **quay lại sau ≥ 60 giây** ở nền (đồng hồ bị chỉnh lùi → coi như quá 60 giây). Vừa đăng nhập bằng mật khẩu thì không hỏi PIN ngay.
3. Lúc app vào nền (có PIN), nội dung **che ngay** (để ảnh trình chuyển app không thấy số — cố gắng tốt nhất); quay lại dưới 60 giây thì bỏ che, không khóa.
4. **Màn khóa thay cả màn app** (không phải lớp phủ): 6 chấm, bàn phím số, nút xoá một số. Mỗi lần thử: bộ đếm `vi-nha:pin-fails` **tăng trước khi kiểm**; đúng → về 0, về đúng màn đang ở (địa chỉ giữ nguyên); nháp đang gõ dở (vd màn Nhập) mất.
5. **Đổi mã PIN**: PIN cũ rồi PIN mới; **Tắt mã PIN**: PIN cũ. Đổi / Tắt dùng chung bộ đếm sai.
6. PIN gắn với **người đang đăng nhập trên máy** (`memberId`): đăng xuất (mọi cách), phiên hết hạn về màn đăng nhập, hay người khác đăng nhập trên máy → xoá PIN.

## Alternative Flows
- 4a. **Quên mã PIN?** ở màn khóa → hỏi lại "Đăng xuất máy này? Đăng nhập lại bằng mật khẩu rồi đặt PIN mới. Khoản chưa gửi vẫn giữ." (offline thì thêm "Đang không có mạng: đăng nhập lại cần mạng.") → **Đăng xuất máy này**: xoá PIN, ghi cờ `vi-nha:relogin`, về màn đăng nhập — chạy được cả khi offline; có mạng thì gọi thêm gỡ thông báo đẩy và xoá phiên server (lỗi thì bỏ qua). Còn cờ `relogin` thì `checkSession` về màn đăng nhập dù cookie phiên còn hạn; đăng nhập thành công mới xoá cờ. Đăng nhập cần mạng (UC-701 AC-6); hàng đợi khoản chưa gửi vẫn giữ.

## Exceptions
- E1. Sai PIN → "Sai mã PIN, còn N lần".
- E2. Sai **5 lần liên tiếp** (kể cả khi Đổi / Tắt) → như Quên PIN (4a).
- E3. `localStorage` không dùng được → không cho bật PIN.
- E4. Bản ghi PIN hỏng hay sai phiên bản → coi như chưa đặt.

## Postconditions
- Không đổi gì ở server. Giới hạn (ghi ở Máy này): PIN chặn người cầm máy mở app, không thay mật khẩu; Safari chưa thêm ra màn hình chính có thể tự xoá dữ liệu sau 7 ngày không mở — khi đó PIN mất, phải đặt lại.

## Acceptance Criteria

### AC-1: Đặt PIN; mở app thấy màn khóa trước khi thấy số
- Given đã đặt PIN
- When băm / kiểm; đọc lại bản ghi; mở app ở `#wallets`
- Then PIN đúng qua, sai không; bản ghi có `v`, `iter`, `salt`, `hash`, `memberId`, không chứa PIN, đọc lại đồng bộ, hỏng / sai phiên bản = chưa đặt; màn khóa hiện trước khi số nào hiện ra, đúng PIN → về `/#wallets`
- Tests: [`web/src/lib/pin.test.ts`](../../web/src/lib/pin.test.ts) › "mã PIN trên máy này (pwa UC-719) › UC-719 AC-1: băm rồi kiểm PIN đúng / sai; bản ghi có v, iter, salt, hash, memberId và không chứa PIN" · "… › UC-719 AC-1: bản ghi đọc lại đồng bộ từ localStorage `vi-nha:pin`; hỏng hay sai phiên bản thì coi như chưa đặt"; màn khóa trước số, về đúng địa chỉ: ⚠ Chưa có test (giao diện — xem tay trên `wrangler dev` cục bộ)

### AC-2: Khóa khi quay lại sau 60 giây
- Given đã đặt PIN, app vào nền
- When quay lại sau 59 / 60 / 61 giây; đồng hồ chỉnh lùi; chưa vào nền
- Then 59 không hỏi; 60, 61 hỏi; đồng hồ lùi hỏi; chưa vào nền không hỏi
- Tests: [`web/src/lib/pin.test.ts`](../../web/src/lib/pin.test.ts) › "mã PIN trên máy này (pwa UC-719) › UC-719 AC-2: shouldLock — ở nền 59 giây không hỏi; 60 và 61 giây hỏi; đồng hồ chỉnh lùi hỏi; chưa vào nền không hỏi"; che lúc vào nền: ⚠ Chưa có test (chưa thử trên điện thoại thật — ảnh trình chuyển app của iOS)

### AC-3: Sai 5 lần thì đăng xuất máy này
- Given đã đặt PIN
- When sai liên tiếp, tải lại giữa chừng; sai lần thứ 5
- Then bộ đếm tăng trước khi kiểm và còn sau khi tải lại; đúng thì về 0; lần 5 → `vi-nha:pin` xoá, `vi-nha:relogin` ghi, hàng đợi khoản chưa gửi giữ nguyên
- Tests: [`web/src/lib/pin.test.ts`](../../web/src/lib/pin.test.ts) › "mã PIN trên máy này (pwa UC-719) › UC-719 AC-3: bộ đếm sai tăng TRƯỚC khi kiểm (tải lại giữa chừng không mất lần đếm) và còn sau khi tải lại; đúng thì về 0" · "… › UC-719 AC-3: sai 5 lần liên tiếp → `vi-nha:pin` xoá, `vi-nha:relogin` ghi, hàng đợi khoản chưa gửi giữ nguyên"

### AC-4: Đổi PIN cần PIN cũ
- Given đã đặt PIN
- When Đổi với PIN cũ sai; rồi đúng
- Then lỗi, PIN không đổi, bộ đếm tăng; rồi PIN mới dùng được, PIN cũ không
- Tests: [`web/src/lib/pin.test.ts`](../../web/src/lib/pin.test.ts) › "mã PIN trên máy này (pwa UC-719) › UC-719 AC-4: Đổi PIN với PIN cũ sai → lỗi, PIN không đổi, bộ đếm tăng; PIN cũ đúng → PIN mới dùng được, PIN cũ không"

### AC-5: Quên PIN chạy được offline, phải đăng nhập lại
- Given đã đặt PIN, offline
- When Quên mã PIN? › Đăng xuất máy này; rồi có mạng, tải lại (cookie phiên còn hạn); rồi đăng nhập
- Then xoá PIN, ghi cờ `relogin`, về màn đăng nhập; còn cờ thì không vào thẳng app; đăng nhập thành công xoá cờ
- Tests: [`web/src/lib/pin.test.ts`](../../web/src/lib/pin.test.ts) › "mã PIN trên máy này (pwa UC-719) › UC-719 AC-5: Quên PIN (cả khi offline) → xoá PIN, ghi cờ relogin; còn cờ thì phải đăng nhập lại; đăng nhập thành công xoá cờ"; luồng `checkSession` / `login` trong store: ⚠ Chưa có test (xem tay trên trình duyệt)

### AC-6: PIN thuộc người đang đăng nhập
- Given PIN của người A
- When đăng xuất rồi người B đăng nhập trên máy này
- Then không còn PIN
- Tests: [`web/src/lib/pin.test.ts`](../../web/src/lib/pin.test.ts) › "mã PIN trên máy này (pwa UC-719) › UC-719 AC-6: PIN của người A; đăng xuất rồi người B đăng nhập trên máy này → không còn PIN"

## Dependencies
- Upstream UC: UC-701 (đăng nhập, đăng xuất), UC-709 (Cài đặt › Máy này)
- External Systems: WebCrypto (PBKDF2)

## Divergences & Open Questions
- [OPEN] Che lúc vào nền chưa thử trên điện thoại thật — chưa biết ảnh trình chuyển app của iOS còn thấy số không.

## Traceability
- Code: `web/src/lib/pin.ts` › `PIN_KEY`, `PIN_FAILS_KEY`, `RELOGIN_KEY`, `PIN_ITERATIONS`, `MAX_PIN_FAILS`, `LOCK_AFTER_MS`, `createPinRecord`, `pinMatches`, `readPin`, `savePin`, `clearPin`, `keepPinFor`, `pinFails`, `checkPin`, `changePin`, `removePin`, `forgetPinOnDevice`, `needsRelogin`, `clearRelogin`, `shouldLock`, `deviceStorage`; `web/src/screens/lock.tsx` › `Lock`; `web/src/screens/pin-sheet.tsx` › `PinRow`, `PinSheet`, `usePinSet`, `PIN_LIMITS`; `web/src/state/store.ts` › `locked`, `unlock`, `forgetPin`, `checkSession`, `login`, `signedOut`, `start` (`visibilitychange`, `data-cover`); `web/src/app.tsx` (màn khóa là `return` sớm); `web/src/ui/shell.tsx` › `Sidebar` (Đặt / Đổi mã PIN); `web/src/screens/settings.tsx` (hàng Mã PIN ở Máy này)
- Dữ liệu: `localStorage` `vi-nha:pin`, `vi-nha:pin-fails`, `vi-nha:relogin` (pwa `entities.md`); không đổi server
