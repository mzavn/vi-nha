# 261016-lech-gia-khi-noi-sepay-sau: Tài khoản nối SePay sau báo lệch giả vì chuyển khoản cũ ghi từ log của tài khoản kia
- Status: archived
- BR: BR-04 (tiền thật khớp sổ)
- Đụng tới: ledger UC-106 (đối soát)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-16, chat ("ủa sao trên live lệch nè ???") — sửa lỗi, không đổi luật · Người duyệt kỹ thuật: lead (lỗi view, một công thức)
- Commit: propose (cùng commit code) · code `3c0b2f9` · merge (commit này)

## Vì sao

Chủ nhà thấy tài khoản tiết kiệm của vợ báo "Sổ khác giao dịch ngân hàng đã gán +11.600.000". Kiểm live 2026-10-16: số dư sổ đúng; lệch là giả. Tài khoản này mới nối SePay ngày 15/10. Các khoản chuyển vào trước đó (9.000.000, 2.500.000, 100.000) ghi từ log của **tài khoản gửi** (không có log ở tài khoản nhận). `v_account_tx_from_logs` cộng mọi giao dịch có `log_id` chạm tài khoản — kể cả khi log thuộc tài khoản kia — nên tài khoản nhận có "phần sổ sinh từ log" +11.600.000 mà không có log nào tương ứng (`assigned_net` chỉ có −100.000).

## Thay đổi spec

### ledger UC-106 — MODIFIED công thức `book_drift`
- `tx_net` của tài khoản A chỉ gồm giao dịch `active` mà **một trong hai log** (`log_id`, `log_id_2`) **thuộc A** và nằm trong phạm vi đối soát của A (ngày VN của log ≥ `opened_at`, như `v_account_logs`); dấu theo phía của A trong giao dịch (A là `account_id` → trừ, `counter_account_id` → cộng). Giao dịch ghi từ log của tài khoản khác không còn tính vào A.
- ADDED AC-8: Given A, B nối SePay; chuyển 9.000.000 B → A ghi từ log ra của B (A chưa có log), rồi A có log ra 100.000 đã ghép cặp sang B When đọc `v_reconcile` Then `book_drift` của A = 0, của B = 0; số dư sổ không đổi.
- ADDED AC-9: Given log của A trước `opened_at` của A (đã `ignored`) mà một giao dịch vẫn mang log đó When đọc Then giao dịch đó không vào `tx_net` của A (cùng phạm vi với `assigned_net`).

## Thiết kế
Migration 0035 (schema v1.35): dựng lại `v_account_tx_from_logs` (và `v_reconcile` đọc nó): nối `transactions` với `bank_logs` qua `log_id` và qua `log_id_2`, lấy giao dịch có log thuộc tài khoản, lọc ngày log như `v_account_logs`; một giao dịch đếm một lần cho mỗi tài khoản. `docs/schema.sql`, `test/schema.test.ts` (phiên bản).

## Việc cần làm
- [x] Proposal
- [x] Test đỏ → migration → test xanh
- [x] Sao lưu D1 (before-0035), diễn tập trên bản sao (lệch 11.600.000 → 0, số dư sổ không đổi), deploy 2026-10-17 11:30 (version `3ddbdcf7`); live: cả ba tài khoản có SePay `book_drift` 0
- [x] Hợp nhất UC-106 (v8, AC-8, AC-9), ledger entities; CHANGELOG mục Chưa phát hành (dự kiến v1.4.0)
