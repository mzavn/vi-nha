# Cài Ví nhà bằng AI — kịch bản cho agent

> Dành cho agent AI (Claude Code, Codex, Cursor…) khi người dùng nói kiểu *"cài Ví nhà cho tôi"*. Người dùng thường
> **không biết code**: nói ngắn, tiếng Việt, mỗi lần chỉ nhờ họ làm một việc. Làm đúng thứ tự dưới đây.

## Luật

- **Chỉ chạy lệnh có trong kịch bản này.** Không tự soạn lệnh `wrangler` khác (`d1 create`, `kv namespace create`,
  `delete`, `secret put`…), không sửa tay `wrangler.jsonc`, không dùng `npm run deploy` cho lần cài đầu. `npm run setup`
  làm hết và chạy lại an toàn — gặp lỗi thì đọc thông báo, sửa nguyên nhân, chạy lại chính lệnh đó.
- **Không chạy `npx wrangler login` hộ** — lệnh đó mở trình duyệt và chờ người bấm; người dùng tự chạy trong terminal.
- **Mật khẩu chung chỉ hiện một lần**, ở đầu ra của `npm run setup`. Nhắc người dùng ghi lại ngay; **không bao giờ viết lại
  mật khẩu trong tin nhắn trả lời**, không lưu vào file nào của repo, không commit.
- Không hỏi, không nhận số tài khoản ngân hàng, số dư, khoá SePay / Telegram / Zalo — những thứ đó người dùng tự nhập
  trong app sau khi cài.

## Bước 1 — Kiểm máy

```bash
node --version
git --version
```

- Node **22 trở lên** (tối thiểu 20). Chưa có hoặc cũ hơn: nhờ người dùng cài bản LTS ở https://nodejs.org (hỏi trước khi
  tự cài bằng `brew` / `winget`), rồi mở lại terminal.
- Chưa ở trong thư mục repo Ví nhà (không thấy `package.json` có `"name": "vi-nha"`):

```bash
git clone https://github.com/mzavn/vi-nha.git
cd vi-nha
```

## Bước 2 — Cài thư viện

```bash
npm install
```

## Bước 3 — Đăng nhập Cloudflare (người dùng làm)

```bash
npx wrangler whoami
```

Thấy "You are not authenticated" → nói với người dùng:

> Bạn cần một tài khoản Cloudflare (miễn phí, đăng ký ở https://dash.cloudflare.com/sign-up). Rồi mở terminal trong thư
> mục `vi-nha`, chạy `npx wrangler login`, trình duyệt mở ra thì bấm **Allow**. Xong báo tôi.

(Trong Claude Code, người dùng có thể gõ `! npx wrangler login` ngay ở ô chat.) Người dùng báo xong thì chạy lại
`npx wrangler whoami` để chắc chắn.

## Bước 4 — Cài lên Cloudflare

```bash
npm run setup -- --yes --generate-password
```

Đọc **mã thoát** và thông báo cuối:

| Mã | Nghĩa | Làm gì |
|---|---|---|
| 0 | Xong | Sang bước 5 |
| 3 | Chưa đăng nhập | Quay lại bước 3 |
| 4 | Đăng nhập có nhiều account | Đọc danh sách account (tên — id) cho người dùng, hỏi dùng account nào, chạy lại với `--account-id <id>` |
| 5 | Account chưa có địa chỉ `workers.dev` | Đưa người dùng link `https://dash.cloudflare.com/<account>/workers/onboarding` trong thông báo, nhờ họ đặt một subdomain (tên ngắn, ví dụ tên nhà), báo xong thì chạy lại |
| 6 | Thiếu thông tin | Đọc thông báo — thường là thiếu `--yes` hoặc `--generate-password` |
| 1 | Lỗi khác | Kể cho người dùng phần lỗi (ngắn gọn); lỗi mạng thì chạy lại; báo hết cron ("cron" / "limit") thì giải thích: gói Free có 5 cron cho cả tài khoản, Ví nhà cần 2 — họ cần gỡ cron của Worker khác hoặc nâng gói |

Lệnh chạy lại bao nhiêu lần cũng được: không tạo database thứ hai, không đổi mật khẩu đã đặt.

## Bước 5 — Báo kết quả

Nói với người dùng (không chép lại mật khẩu):

> Xong rồi! Ví nhà của bạn ở **https://vi-nha.<…>.workers.dev**. Mật khẩu chung đã hiện **một lần** ở kết quả lệnh phía
> trên — chép ngay vào chỗ an toàn (trình quản lý mật khẩu, sổ tay); cả nhà dùng mật khẩu này để vào app. Địa chỉ mới có
> thể cần vài phút mới mở được.

## Bước 6 — Thiết lập nhà

Hỏi người dùng muốn **tự bấm trên app** (khuyên dùng) hay **để bạn làm hộ**. Dù cách nào cũng phỏng vấn trước, từng câu một:

1. **Nhà có mấy người dùng app** (1–6), gọi là gì (ví dụ "Bố", "Mẹ")? Người đầu tiên là chủ hộ.
2. **Tiền nằm ở đâu?** Từng tài khoản: tên (ví dụ "VCB của Bố", "Tiền mặt"), loại — ngân hàng (`bank`), tiền mặt
   (`cash`), ví điện tử (`ewallet`), thẻ tín dụng (`credit`) —, ngân hàng nào, của ai hay của chung. Chỉ hỏi tên, **không
   hỏi số tài khoản hay số dư** (nhập sau trong app).
3. **Khoản chi bắt buộc hằng tháng** (ví Must) có những gì: ăn uống (`food`), nhà ở (`housing`), đi lại (`transport`),
   điện nước (`utilities`)?
4. **Có thu nhập chưa bị khấu trừ thuế** (làm tự do, cho thuê…)? Có → trích ví Thuế 10% mỗi lần có thu nhập.

**Tự bấm trên app:** nhờ người dùng mở địa chỉ ở bước 5 → màn **Thiết lập**, nhập mật khẩu chung, rồi điền theo câu trả lời.

**Làm hộ qua API:** dựng body theo câu trả lời, gửi một lần. Mật khẩu chung lấy từ đầu ra bước 4 và chỉ nằm trong lệnh,
không viết ra tin nhắn trả lời:

```bash
curl -sS -X POST https://vi-nha.<…>.workers.dev/v1/setup \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "password": "<mật khẩu chung>",
  "members": [{ "name": "Bố" }, { "name": "Mẹ" }],
  "accounts": [
    { "name": "Tiền mặt", "kind": "cash", "owner": null },
    { "name": "VCB của Bố", "kind": "bank", "bank": "Vietcombank", "owner": 0 }
  ],
  "template": { "taxable": false, "must": ["food", "housing", "transport", "utilities"] }
}
JSON
```

- `owner`: số thứ tự người trong `members` (0 = người đầu), `null` = của chung.
- `bank` (tuỳ chọn, cho loại `bank` / `credit`) phải là đúng một mã: `MBBank`, `VietinBank`,
  `BIDV`, `ACB`, `VPBank`, `TPBank`, `Sacombank`, `MSB`, `OCB`, `KienlongBank` (các ngân hàng này nối được SePay để tự ghi
  sổ), `Vietcombank`, `Techcombank`, `Agribank`, `VIB`, `HDBank`, `SHB`, `SeABank`, `Eximbank`, `LPBank`, `NamABank`,
  `SCB`, `PVcomBank`, `Cake`, `Timo`, `Khac` (ghi tay).
- Tối đa 20 tài khoản; tên người / tài khoản không trùng nhau. Mật khẩu riêng từng người: để người dùng tự đặt sau trong
  app (Cài đặt › Thành viên).
- Kết quả: `201` → xong. `400` → đọc `error.field` / `error.message`, hỏi lại đúng ô đó rồi gửi lại. `401` → sai mật khẩu
  chung (nhờ người dùng kiểm lại, đừng thử đoán — sai nhiều lần sẽ bị chặn một lúc). `409` → nhà đã thiết lập rồi.

Kiểm: `curl -sS https://vi-nha.<…>.workers.dev/v1/setup` trả `{"ok":true,"data":{"needed":false}}` là xong.

## Bước 7 — Gợi ý tiếp

- Trên điện thoại: mở địa chỉ bằng trình duyệt → "Thêm vào màn hình chính".
- Hướng dẫn dùng từng màn: https://mzavn.gitbook.io/vi-nha
- Tự ghi sổ ngân hàng (SePay), nhắc qua Telegram / Zalo, nối Claude: người dùng tự làm trong app, mục **Cài đặt**.
- Cập nhật bản mới sau này: `git pull && npm install && npm run deploy`.
