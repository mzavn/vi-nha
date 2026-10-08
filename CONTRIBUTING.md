# Đóng góp cho Ví nhà

Cảm ơn bạn muốn góp tay. Issue và pull request đều được nhận — viết tiếng Việt hoặc tiếng Anh đều được.

## Báo lỗi, đề xuất

Mở [issue](https://github.com/mzavn/vi-nha/issues): bạn làm gì, mong thấy gì, thấy gì thay vào đó; kèm ảnh màn hình
nếu là giao diện. **Đừng dán số tài khoản, số dư thật, mật khẩu hay khoá API** vào issue.

Lỗi bảo mật: đừng mở issue công khai — dùng [Report a vulnerability](https://github.com/mzavn/vi-nha/security/advisories/new)
của GitHub.

## Pull request

Repo này làm theo **Spec-Driven Development** (skill `mk-specs`, đọc `.claude/skills/mk-specs/SKILL.md` và
`specs/README.md`): spec đứng trước code.

1. **Đổi hành vi** (tính năng, luật nghiệp vụ, API, giao diện người dùng thấy): viết proposal trong
   `specs/changes/<yymmdd>-<tên>/proposal.md` theo mẫu — vì sao, AC (tiêu chí nghiệm thu Given / When / Then), thiết kế.
   Mở PR proposal trước (hoặc cùng PR với code, proposal ở commit đầu) để người duy trì duyệt.
2. **Test trước, code sau**: mỗi AC có test trích dẫn trong spec (`- Tests: ...`).
3. **Đổi database**: migration mới trong `migrations/` (số kế tiếp, ví dụ `0031_...sql`), cập nhật `docs/schema.sql`
   và `schema_version`; **không sửa** `migrations/0030_baseline.sql` hay migration đã phát hành.
4. Trước khi mở PR: `npm test`, `npm run typecheck`, `npm run build`, `npm run specs:check` đều xanh
   (CI chạy lại cho mỗi PR). Sửa bug nhỏ, chữ, tài liệu thì không cần proposal.
5. Commit mang ID use case nếu có: `fix(UC-305): ...`, `feat(UC-510): ...`.

Ngôn ngữ: giao diện, tin nhắn, chú thích, tên test, specs viết tiếng Việt; tên biến / hàm / kiểu / file, giá trị lưu DB,
đường dẫn API viết tiếng Anh (bảng tra: `docs/glossary.md`).

## Ai quyết

**Luật về tiền, quyền truy cập và bảo mật do người duy trì quyết** — PR đổi những luật này cần proposal được duyệt trước.
Phần còn lại: PR đủ test, đúng spec là được nhận.

## PR được nhận rồi thì sao

Ví nhà được phát triển ở một repo riêng; repo này nhận **bản phát hành ổn định** đẩy sang bằng script. PR được nhận sẽ
được chép về repo phát triển (giữ tên bạn là tác giả trong ghi chú phát hành) rồi xuất hiện ở đây trong bản phát hành kế
tiếp — vì vậy PR có thể được đóng kèm link tới bản phát hành thay vì bấm Merge. Lịch sử commit và hash trong `specs/`
trỏ về repo phát triển.

Bằng việc gửi PR, bạn đồng ý phần đóng góp được phát hành theo [AGPL-3.0](LICENSE).
