# Nhật ký thay đổi

Bản nào cần nâng cấp database thì có ghi rõ. Database tự nâng khi bạn cập nhật, không phải làm gì thêm — nhưng nên sao lưu
trước: `mkdir -p .wrangler/backups && npx wrangler d1 export vi-nha --remote --output .wrangler/backups/vi-nha.sql`.

## v1.0.1 — 08/10/2026

Không cần nâng cấp database.

**Mới**

- Đọc hướng dẫn ngay trong app: bấm **Hướng dẫn** là mở, không phải ra trình duyệt.
- Cài đặt › Máy này cho biết đang chạy phiên bản nào, kèm link tới mã nguồn.
- Chưa có SePay? Cài đặt › Kết nối có nút đăng ký.

**An toàn hơn**

- Nhờ AI cài thì AI không còn thấy mật khẩu chung: mật khẩu được lưu vào một file trên máy bạn, bạn tự mở xem.
- Cập nhật bản vá bảo mật cho thư viện nối Claude.
- File sao lưu database không còn dễ bị đẩy nhầm lên GitHub.

Cho người sửa code: CI chỉ có quyền đọc, Dependabot, cách báo lỗ hổng ở `SECURITY.md`.

## v1.0.0 — 08/10/2026

Bản công khai đầu tiên.

Ví nhà là sổ tiền của cả nhà theo Profit First: lương về là chia ngay vào các ví, phần cần giữ thì khoá lại, phần còn
lại là tiền được tiêu.

- Ghi khoản chi trong vài giây, biết ngay tuần này còn bao nhiêu.
- Chia thu nhập theo Profit First; ví, quỹ, sổ nợ, cho thuê.
- Nối SePay để giao dịch ngân hàng tự về.
- Nhắc việc qua thông báo trên máy, Telegram, Zalo.
- Hỏi số liệu nhà mình qua Claude.

Cài bằng nút Deploy to Cloudflare, `npm run setup` hoặc nhờ AI — xem README. Chạy được trên gói Cloudflare miễn phí.

Ghi chú: database dựng từ một file `migrations/0030_baseline.sql`; các bản sau đánh số từ `0031`.
