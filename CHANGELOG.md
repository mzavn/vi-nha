# Nhật ký thay đổi

Mỗi bản phát hành một mục. Mục có dòng **"có migration"** nghĩa là database được nâng cấp khi deploy
(`npm run deploy` hoặc Cloudflare tự build lại) — không cần làm gì thêm, nhưng nên sao lưu D1 trước
(`npx wrangler d1 export vi-nha --remote --output backup.sql`).

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
