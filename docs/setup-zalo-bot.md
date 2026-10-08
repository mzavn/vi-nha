# Cài Zalo Bot nhận thông báo Ví nhà

Đã chạy được ngày 3/10/2026 với bot **Bot tccn mza**. Thiết kế: ADR-80, notify UC-411.

Zalo nhận **bản đầy đủ** của mỗi tin (giống Telegram, tối đa 2.000 ký tự); thông báo đẩy trên máy nhận **bản ngắn** (ADR-79).

## Giới hạn (gói Basic, miễn phí)
- Tối đa 3 bot, mỗi bot tối đa 50 người, **3.000 tin/tháng**. Hai người × tin sáng + tổng kết tuần + tin chưa gán: dư xa.
- Bot chỉ nhắn được cho người **đã nhắn bot trước** — vì vậy nối bằng mã, không nhập chat id tay.
- Hết hạn mức tháng thì Zalo trả lỗi 429: tin đó mất ở Zalo, Telegram và thông báo đẩy vẫn nhận.

## 1. Tạo bot (một lần)
1. Trong app Zalo, tìm OA **Zalo Bot Manager** › **Tạo bot** (mở Zalo Bot Creator).
2. Tên bot bắt đầu bằng "Bot" (ví dụ "Bot Ví nhà") › **Tạo Bot**.
3. Zalo nhắn **Bot Token** (dạng `12345689:abc-xyz`) về tài khoản của anh. Token không hết hạn trừ khi bấm đặt lại.

## 2. Mở cửa Cloudflare cho webhook (một lần, bắt buộc)
Cloudflare **Browser Integrity Check** chặn máy chủ Zalo (user agent `Java/1.8.0_…`, mạng VNG) bằng lỗi 403 trước khi tin tới app.

Cloudflare › **tên miền của bạn** › **Rules** › **Configuration Rules** › **Create rule**:
- Tên: `Webhook không kiểm trình duyệt`
- Expression:
  ```
  (http.host eq "vi-nha.example" and starts_with(http.request.uri.path, "/webhooks/"))
  ```
- **Browser Integrity Check: Off** (thêm Security Level: Essentially Off nếu có) › **Deploy**.

Luật **Skip** trong Security › WAF › Custom rules **không đủ** (đã thử, vẫn 403). Luật này mở luôn cho webhook SePay. An toàn: cả hai webhook tự kiểm khoá bí mật.

## 3. Nối bot vào app (một lần)
App Ví nhà › Cài đặt › Nâng cao › **Kết nối** › **Zalo Bot**:
1. Dán **Bot token**.
2. Đặt **Khoá webhook**: 8–256 ký tự, chỉ chữ, số, `_`, `-`. Tự nghĩ một chuỗi dài, không dùng lại khoá SePay.
3. Bấm **Đặt webhook** — app báo Zalo gửi tin nhắn của bot về `https://vi-nha.example/webhooks/zalo`. Zalo giới hạn số lần đặt mỗi ngày, đừng bấm liên tục.

## 4. Mỗi người nối Zalo của mình
1. Cài đặt › **Thành viên** › tên mình › **Nối Zalo** → app hiện **mã 6 số**, dùng được 15 phút.
2. Mở chat với **bot của nhà** (tin nhắn lúc tạo bot có link / QR, hoặc tìm theo tên bot). **Không** gửi cho Zalo Bot Creator / Zalo Bot Manager.
3. Nhắn đúng 6 số. Bot trả lời "Đã nối Zalo cho {tên}. Ví nhà sẽ báo tin ở đây."
4. Trong app bấm **Đã nhắn xong** › **Gửi thử**.

Bỏ nối: cùng chỗ đó › **Bỏ nối Zalo** (bấm hai lần).

## Khi không chạy
| Dấu hiệu | Nguyên nhân | Làm gì |
|---|---|---|
| Nhắn mã, bot im lặng | Cloudflare chặn (bước 2), hoặc chưa Đặt webhook | Kiểm bằng lệnh `testWebhook` bên dưới |
| Bot trả lời câu hướng dẫn | Mã sai hoặc quá 15 phút | **Tạo mã mới**, nhắn lại |
| Đặt webhook báo "quá số lần" | Zalo giới hạn `setWebhook` mỗi ngày | Để mai |
| Gửi thử báo hết lượt | Quá 3.000 tin/tháng | Chờ tháng sau |
| Gửi thử báo token sai | Token đã đặt lại | Dán token mới ở Kết nối |

Kiểm tra webhook từ máy có token (đừng dán token vào chat/log):
```bash
curl -s -X POST "https://bot-api.zaloplatforms.com/bot<BOT_TOKEN>/testWebhook" -H "Content-Type: application/json" -d '{}'
```
- `"outcome":"webhook.ok"` — thông.
- `"outcome":"webhook.http.403"` — Cloudflare chặn: xem Security › Events, lọc đường dẫn `/webhooks/zalo`, cột **Service**; làm lại bước 2.
- `getWebhookInfo` (cùng dạng lệnh) cho biết địa chỉ webhook Zalo đang lưu.

Tài liệu Zalo: <https://docs.zaloplatforms.com/docs/BOT> · bảng giá: <https://bot.zaloplatforms.com/>
