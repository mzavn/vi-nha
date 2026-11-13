# AGENTS.md — dành cho agent AI cài Ví nhà

## Cài Ví nhà

Người dùng nhờ bạn **cài Ví nhà lên Cloudflare của họ** (không phải sửa code): đọc [`docs/cai-bang-ai.md`](docs/cai-bang-ai.md) và làm đúng từng bước trong đó. Không tự soạn lệnh `wrangler` ngoài kịch bản; không chạy `npx wrangler login` hộ (người dùng tự chạy trong terminal); **không bao giờ đọc, `cat` hay mở file mật khẩu `~/.vi-nha/*.txt`** — đưa đường dẫn để người dùng tự mở; lỡ thấy mật khẩu trong đầu ra thì không nhắc lại, nhờ người dùng tự chạy `npm run setup -- --reset-password` trong terminal riêng; không làm Thiết lập hộ (người dùng tự làm trong app).
