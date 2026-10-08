# 261006-so-du-co-san-vao-tich-san: Số dư có sẵn của heo / phao / sổ tiết kiệm vào Tích sản
- Status: archived
- BR: BR-07, BR-01
- Đụng tới: UC-107 (ledger) · UC-506 (access) · UC-707, UC-709 (pwa)
- Đóng: [OPEN] ledger UC-107 / pwa UC-707 "số dư có sẵn của tài khoản Tích sản có vào Tích sản không" (mở 2026-10-06, pwa UC-707 v21)
- Người duyệt nghiệp vụ: chủ nhà (chọn phương án B1, xem "Vì sao") · Người duyệt kỹ thuật: —

## Vì sao
Chủ nhà nhìn tab Ví & quỹ › Tích sản sau khi nhập số dư đầu thật của hai heo: "sai gì đó nè". Các tài khoản Tích sản đang có 135.000 ₫ (heo chồng 30.000, heo vợ 95.000, phao MB tiết kiệm (vợ) 10.000), nhưng Tích sản chỉ có 55.000 ₫ (số minh hoạ trong proposal này, không phải số thật của nhà). Lý do là theo ADR-86 / ADR-88, tiền đã có trong heo / phao / sổ trước khi dùng app (số dư đầu) không phải Tích sản. Card phải giải thích phần chênh 80.000 ₫ bằng một câu riêng.

Chủ nhà được hỏi ba phương án (giữ luật; B1 chuyển một lần phần còn trong heo / phao; B2 coi cả số dư đầu 670.000 ₫ là Tích sản). Chủ nhà chọn **B1**: "Chuyển phần còn trong heo/phao vào Tích sản (một lần)", và đồng ý với ý đi kèm: "Sau này mở phao/sổ mới có sẵn tiền cũng làm vậy."

## Thay đổi spec

### UC-107 (ledger — Theo dõi tích lũy)
- Main Flow 3 (nguồn): thêm `kind = 'opening'` cho dòng ghi có ví Tích sản do hệ thống ghi (`transfer`, `source = 'system'`, `batch_id` bắt đầu bằng `O`, không ví nguồn, không tài khoản).
- ADDED AC-10: Given DB như prod (Tích sản 55.000 từ bỏ heo; heo chồng 30.000, heo vợ 95.000, phao 10.000, cả ba không tính vào Tiền chi được) When chạy migration 0027 Then có đúng một bút toán `transfer` hệ thống 80.000 ghi có ví Tích sản (`counter_wallet_id`, `account_id`, `counter_account_id` NULL, `batch_id = 'O:0027'`), Tích sản tiền mặt 135.000, Có thì tốt / Σ số dư sổ các tài khoản / Tiền chi được không đổi; `GET /v1/tichsan` có nguồn `opening` 80.000; chạy lại migration không ghi thêm.

### UC-506 (access — Cài đặt tài khoản)
- Main Flow 3g' (mới): tài khoản **thành** tài khoản Tích sản (thêm với `role`, hoặc sửa `null → phao`), và sau khi ghi nó không tính vào tiền chi được (khóa hoặc `spendable = 0`), mà có số dư sổ dương B (thêm: `opening_balance`; sửa: số dư sổ hiện có) → cùng lúc ghi một bút toán hệ thống ghi có ví Tích sản `min(B, max(0, max(0, R + B) − max(0, C)))`. Trong đó R = Σ số dư sổ các tài khoản Tích sản không tính khác **trước** khi ghi, C = Tích sản tiền mặt. Bằng 0 thì không ghi. `batch_id = 'O:<id tài khoản>:<at>'`, `note` "Số dư có sẵn khi mở {tên} → Tích sản". Đổi `phao → null` không gỡ bút toán.
- ADDED AC-21: Given DB seed (Tích sản 0) When thêm phao `opening_balance: 500.000` Then Tích sản tiền mặt +500.000, Có thì tốt không đổi, Tiền chi được không đổi; thêm phao `opening_balance: 0` hoặc tài khoản thường có số dư → không có bút toán.
- ADDED AC-22: Given Tích sản tiền mặt 300.000 nằm ở tài khoản thường (không có tài khoản Tích sản có tiền) When thêm sổ tiết kiệm `opening_balance: 1.000.000` Then chỉ ghi 700.000 (300.000 coi như phần Tích sản đã chuyển vào sổ). Tiền chi được bằng như khi thêm sổ mà không ghi gì: ADR-88 đã coi 300.000 nằm ở sổ, `tichsanHeld` 0. Given tài khoản thường có số dư 200.000 When đổi sang phao Then ghi 200.000; Tiền chi được chỉ giảm 200.000 vì tài khoản rời "đang tính", không giảm thêm. Khi đổi về thường rồi lại sang phao thì không ghi thêm (R + B − C ≤ 0). Đổi sang phao nhưng gửi `spendable: true` → không ghi.

### UC-707 (pwa — tab Tích sản)
- Card "Tiền Tích sản đến từ đâu" › Vào: thêm dòng "Số dư có sẵn khi mở tài khoản (N lần)", ghi chú "tiền có sẵn trong heo / phao / sổ tiết kiệm trước khi ghi vào app — tính một lần vào Tích sản".
- "Tiền đang ở đâu": câu phần dư chỉ hiện khi các tài khoản Tích sản còn nhiều tiền hơn tiền Tích sản (hành vi có sẵn, v21). Sau migration, prod hết chênh nên câu này không hiện.
- ADDED AC-23: Given nguồn `opening` 80.000 (1 lần) và các dòng prod When xem Then Vào có "Số dư có sẵn khi mở tài khoản (1 lần) 80.000 ₫"; tiền Tích sản 135.000 = heo + phao thì không có câu phần dư.

### UC-709 (pwa — sheet tài khoản)
- Main Flow 6b (mới): khi chọn Phao dự phòng / Sổ tiết kiệm lúc thêm mà số dư đầu > 0, hoặc đổi tài khoản thường (số dư sổ > 0) sang Phao dự phòng, và ô "Tính vào tiền chi được" tắt, thì hiện dòng nhắc "Số dư hiện có X ₫ sẽ được tính vào Tích sản — một lần, không trừ ví nào; phần Tích sản đang nằm ở tài khoản thường coi như đã chuyển vào đây." `GET /v1/settings` › `accounts[]` trả thêm `book_balance` (số dư sổ; null khi tài khoản đã tắt).
- ADDED AC-27: Given sheet Thêm tài khoản When chọn Phao dự phòng, Số dư đầu 500.000 Then có dòng nhắc trên; bật Tính vào tiền chi được, chọn Không, Số dư đầu 0, hay sửa tài khoản đã là phao thì không có.

## Quyết định
ADR-91 (mới): Số dư có sẵn của tài khoản Tích sản tính vào Tích sản một lần, không lấy từ ví nào; phần đã là Tích sản không tính lại.
- Bối cảnh: như "Vì sao". ADR-82 đã làm một việc tương tự cho ví Heo đất cũ, nhưng lúc đó có ví nguồn (`heo-dat`). Ở đây tiền trước khi dùng app không nằm trong ví nào.
- Lựa chọn: bút toán `transfer` hệ thống chỉ có `wallet_id` = ví Tích sản. Không có ví nguồn nên Có thì tốt không đổi. Không có tài khoản nên số dư sổ không đổi. Số tiền tính như trên. Công thức này luôn giữ Tiền chi được (ADR-85/88) như trước khi ghi, vì phần ghi thêm luôn nằm gọn trong `tichsanOutside`.
- Phương án bị loại: giữ luật (chủ nhà không chọn); B2 coi cả số dư đầu là Tích sản (590.000 ₫ đã rút về tài khoản thường sẽ thành Tích sản trong tài khoản thường, Tiền chi được giảm 590.000); lấy từ Có thì tốt (ví âm thêm, như tiêu tiền); một bút toán migration cho từng tài khoản (sổ không biết phần nào của từng tài khoản đã là Tích sản, chia ra là bịa); gỡ bút toán khi đổi phao về thường (tiền vẫn là tiền để dành, rút ra cũng chỉ đổi chỗ như ADR-82); đặt `counter_account_id` vào bút toán để biết tài khoản (làm sai số dư sổ của tài khoản đó).

## Thiết kế
- `migrations/0027_so_du_co_san_tich_san.sql` (schema v1.27, chỉ dữ liệu): một dòng tổng `max(0, R − C)` ghi có ví Tích sản đang dùng đầu tiên (`ORDER BY sort`, như 0020). `at` là lúc chạy migration (UTC), kỳ tính theo giờ VN (tuần ISO bằng mẹo thứ Năm, test so với `weekKey`). Có chặn: không ghi nếu đã có `batch_id = 'O:0027'`. Sao lưu D1 production trước khi chạy.
- `src/domain/snapshot.ts` › `openingTichsanCredit` (hàm thuần). `src/services/ledger.ts` › `tichsanOpeningEntry` (dựng câu INSERT) và `tichsanBreakdown` (nguồn `opening`). `src/services/settings.ts` › `createAccount`, `updateAccount` (ghi tài khoản và bút toán trong một `db.batch`), `ACCOUNT_SQL` (`book_balance`).
- Web: `web/src/lib/tichsan.ts` › `tichsanSources` (dòng `opening`); `web/src/lib/tichsan-accounts.ts` › `openingCreditHint`; `web/src/screens/settings-sheets.tsx` › `AccountSheet`; `web/src/lib/types.ts`.
- Rủi ro: tài khoản Tích sản có số dư âm làm R nhỏ đi (số ghi ít hơn, an toàn). Phao bật "Tính vào tiền chi được" thì không được ghi, vì ghi sẽ làm Tiền chi được giảm.

## Việc cần làm
- [x] Test cho từng AC mới/sửa
- [x] Code
- [x] Cập nhật UC chính + `## History`
- [ ] Sinh lại `traceability.md`, `open-issues.md` (main agent)
