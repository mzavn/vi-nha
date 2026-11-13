# Đóng góp cho Ví nhà

Cảm ơn bạn muốn góp tay. Issue và pull request đều được nhận — viết tiếng Việt hoặc tiếng Anh đều được.

## Báo lỗi, đề xuất

Mở [issue](https://github.com/mzavn/vi-nha/issues): bạn làm gì, mong thấy gì, thấy gì thay vào đó; kèm ảnh màn hình
nếu là giao diện. **Đừng dán số tài khoản, số dư thật, mật khẩu hay khoá API** vào issue.

Lỗi bảo mật: đừng mở issue công khai — dùng [Report a vulnerability](https://github.com/mzavn/vi-nha/security/advisories/new)
của GitHub (chi tiết: [`SECURITY.md`](SECURITY.md)).

Muốn hỏi riêng người duy trì (MZA): nhắn qua Facebook <https://www.facebook.com/minhtv11>. Lỗi bảo mật vẫn báo qua GitHub
như trên, không gửi qua Facebook.

## Pull request

1. Mỗi thay đổi kèm test (`npm test`); sửa lỗi thì thêm test tái hiện lỗi trước.
2. **Đổi database**: migration mới trong `migrations/` (số kế tiếp), cập nhật `docs/schema.sql` và `schema_version`;
   **không sửa** `migrations/0030_baseline.sql` hay migration đã phát hành.
3. Trước khi mở PR: `npm test`, `npm run typecheck`, `npm run build` đều xanh (CI chạy lại cho mỗi PR).

Ngôn ngữ: giao diện, tin nhắn, chú thích, tên test viết tiếng Việt; tên biến / hàm / kiểu / file, giá trị lưu DB,
đường dẫn API viết tiếng Anh.

## Ai quyết

**Luật về tiền, quyền truy cập và bảo mật do người duy trì quyết** — mở issue bàn trước khi gửi PR đổi những luật này.
Phần còn lại: PR đủ test là được nhận.

## PR được nhận rồi thì sao

Ví nhà được phát triển ở một repo riêng; repo này nhận **bản phát hành ổn định** đẩy sang bằng script. PR được nhận sẽ
được chép về repo phát triển (giữ tên bạn là tác giả trong ghi chú phát hành) rồi xuất hiện ở đây trong bản phát hành kế
tiếp — vì vậy PR có thể được đóng kèm link tới bản phát hành thay vì bấm Merge.

Bằng việc gửi PR, bạn đồng ý phần đóng góp được phát hành theo [AGPL-3.0](LICENSE).
