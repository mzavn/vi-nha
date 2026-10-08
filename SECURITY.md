# Chính sách bảo mật

## Phạm vi

Mã nguồn trong repo này: Worker (`src/`), PWA (`web/`), migration, script cài đặt (`scripts/setup.mjs`) và kịch bản cài
bằng AI (`docs/cai-bang-ai.md`). Ví dụ: đọc / ghi số liệu của nhà khác khi không có mật khẩu, vượt đăng nhập, lộ khoá kết
nối, chèn mã vào app, webhook giả.

Ngoài phạm vi: cấu hình tài khoản Cloudflare, SePay, Telegram, Zalo của từng nhà; dịch vụ bên thứ ba; tấn công cần đã biết
mật khẩu chung hoặc `API_TOKEN` của nhà đó; từ chối dịch vụ bằng cách làm cạn hạn mức gói Free.

## Báo lỗ hổng

**Đừng mở issue công khai.** Dùng
[Report a vulnerability](https://github.com/mzavn/vi-nha/security/advisories/new) (GitHub private vulnerability
reporting): mô tả lỗi, cách tái hiện, ảnh hưởng. Đừng gửi số liệu thật, mật khẩu hay khoá của bất kỳ nhà nào.

Người duy trì làm một mình nên phản hồi **theo khả năng** (thường trong vài ngày); lỗi đã xác nhận được sửa ở bản phát
hành kế tiếp và ghi trong `CHANGELOG.md`, kèm ghi công nếu bạn muốn.

## Bản được hỗ trợ

Chỉ **bản phát hành mới nhất** (xem [Releases](https://github.com/mzavn/vi-nha/releases)). Cập nhật: README › "Cập nhật bản mới".

---

**English.** Scope: the code in this repository (Worker, PWA, migrations, install script, AI install guide); not
per-household Cloudflare / SePay / Telegram / Zalo configuration or third-party services. Report vulnerabilities privately
via GitHub's [Report a vulnerability](https://github.com/mzavn/vi-nha/security/advisories/new) — please do not open a
public issue and do not include real household data or secrets. Single maintainer: responses are best-effort. Only the
latest release is supported.
