# Nhật ký thay đổi

Mỗi bản phát hành một mục. Mục có dòng **"có migration"** nghĩa là database được nâng cấp khi deploy
(`npm run deploy` hoặc Cloudflare tự build lại) — không cần làm gì thêm, nhưng nên sao lưu D1 trước vào `.wrangler/`
(thư mục không lên git; bản sao lưu chứa khoá kết nối và mọi giao dịch, đừng commit):
`mkdir -p .wrangler/backups && npx wrangler d1 export vi-nha --remote --output .wrangler/backups/vi-nha-<ngày>.sql`.

## v1.0.1 — 2026-10-08

Không có migration.

- Màn **Hướng dẫn** mở ngay trong app (nhúng GitBook), tràn hết màn; mở một lần thì quay lại hiện ngay, không tải lại.
- Cài đặt › Kết nối › SePay: hàng **Chưa có tài khoản SePay?** với link đăng ký (link giới thiệu của Ví nhà).
- Cài đặt › Máy này (điện thoại) và chân thanh bên (máy tính): **Về Ví nhà** — phiên bản đang chạy và link **Mã nguồn** (AGPL-3.0). Thêm `NOTICE`
  (Copyright (C) 2026 MZA), `SECURITY.md`, mục "Liên hệ" trong README.
- Nhờ AI cài (`npm run setup` không có terminal + `--generate-password`): mật khẩu chung **không in ra** nữa mà ghi vào
  `~/.vi-nha/<tên-worker>.txt` (chỉ chủ máy đọc được), agent chỉ đưa đường dẫn; Thiết lập nhà do người dùng tự làm trong
  app. Có terminal thì vẫn in một lần như cũ.
- README và `.dev.vars.example` ghi rõ `API_TOKEN` (tuỳ chọn, toàn quyền, "Đăng xuất mọi máy" không thu hồi) và việc font
  Google / màn Hướng dẫn GitBook thấy IP khi mở app.
- `.gitignore` chặn file sao lưu D1 ở gốc repo (`/*.sql`, `backup*.sql`, `backups/`).
- Nâng `@modelcontextprotocol/sdk` (vá GHSA-6qxp-vccf-f47h). CI: quyền chỉ đọc, action ghim SHA, Dependabot.

## v1.0.0 — 2026-10-08

Bản công khai đầu tiên.

- **Có migration: baseline** — `migrations/0030_baseline.sql` dựng toàn bộ database (schema v1.30) trong một file.
  Migration sau này đánh số từ `0031`.
- Ghi chi tiêu, chia thu nhập theo Profit First, ví và quỹ, đối soát, sổ nợ / phải thu, cho thuê lại.
- Tự ghi sổ ngân hàng qua SePay (webhook + rà soát ban đêm), luật tự gán.
- Nhắc việc qua thông báo trên máy, Telegram, Zalo.
- Nối Claude qua OAuth (MCP).
- Màn Thiết lập lần đầu: mật khẩu chung, 1–6 người (mật khẩu riêng tuỳ chọn), tài khoản, bộ ví mẫu.
- Cài bằng nút Deploy to Cloudflare, `npm run setup` hoặc nhờ AI (`docs/cai-bang-ai.md`).
