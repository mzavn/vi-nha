# Cài Ví nhà bằng AI — kịch bản cho agent

> Dành cho agent AI (Claude Code, Codex, Cursor…) khi người dùng nói kiểu *"cài Ví nhà cho tôi"*. Người dùng thường
> **không biết code**: nói ngắn, tiếng Việt, mỗi lần chỉ nhờ họ làm một việc. Làm đúng thứ tự dưới đây.

## Luật

- **Chỉ chạy lệnh có trong kịch bản này.** Không tự soạn lệnh `wrangler` khác (`d1 create`, `kv namespace create`,
  `delete`, `secret put`…), không sửa tay `wrangler.jsonc`, không dùng `npm run deploy` cho lần cài đầu. `npm run setup`
  làm hết và chạy lại an toàn — gặp lỗi thì đọc thông báo, sửa nguyên nhân, chạy lại chính lệnh đó.
- **Không chạy `npx wrangler login` hộ** — lệnh đó mở trình duyệt và chờ người bấm; người dùng tự chạy trong terminal.
- **Bạn không bao giờ thấy mật khẩu chung.** Chạy không có terminal, `npm run setup` không in mật khẩu mà ghi vào
  `~/.vi-nha/<tên-worker>.txt` và chỉ in đường dẫn. **Không đọc, không `cat`, không mở, không chép file đó** (bằng bất kỳ
  công cụ nào) — đưa đường dẫn cho người dùng để họ tự mở. Không hỏi mật khẩu, không nhận nếu người dùng dán vào chat
  (nhắc họ đừng dán), không gọi API cần mật khẩu, không đặt `APP_PASSWORD` hộ.
- **Lỡ thấy mật khẩu** (lệnh chạy trong terminal giả nên `npm run setup` in thẳng mật khẩu ra): không nhắc lại, không
  chép, không dùng nó. Báo người dùng mật khẩu đã lọt vào phiên AI, nhờ họ tự chạy `npm run setup -- --reset-password`
  trong terminal riêng của họ (không qua bạn) để đặt mật khẩu mới.
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

Lần đầu cài (hoặc có `--reset-password`), cuối đầu ra có **đường dẫn file mật khẩu** (dạng
`/Users/<tên>/.vi-nha/vi-nha.txt` hoặc `C:\Users\<tên>\.vi-nha\vi-nha.txt`) — mật khẩu không có trong đầu ra. Chỉ ghi
nhớ đường dẫn; **không mở file**. Chạy lại khi mật khẩu đã có thì không có dòng này: mật khẩu cũ giữ nguyên.

## Bước 5 — Báo kết quả, người dùng tự lấy mật khẩu

Nói với người dùng (thay đường dẫn thật vào):

> Xong rồi! Ví nhà của bạn ở **https://vi-nha.<…>.workers.dev** (địa chỉ mới có thể cần vài phút mới mở được).
> Mật khẩu chung của cả nhà nằm trong file **`<đường dẫn>`** — tôi không mở file này. Bạn tự mở nhé:
> - **macOS:** mở Finder, bấm ⌘ + Shift + G, dán đường dẫn, Enter, rồi mở file bằng TextEdit.
> - **Windows:** mở File Explorer, dán đường dẫn vào thanh địa chỉ, Enter (mở bằng Notepad).
>
> Chép mật khẩu vào chỗ an toàn (trình quản lý mật khẩu, sổ tay) — cả nhà dùng nó để vào app. Chép xong xoá file cũng
> được. **Đừng dán mật khẩu vào đây** và đừng mở file bằng lệnh trong ô chat này (kiểu `! cat …`) — như thế mật khẩu lại
> nằm trong cuộc trò chuyện.

Người dùng lỡ dán mật khẩu vào chat: không nhắc lại, không dùng nó; khuyên họ đặt mật khẩu mới bằng
`npm run setup -- --yes --generate-password --reset-password` (file được ghi đè) rồi lấy lại từ file.

## Bước 6 — Thiết lập nhà (người dùng tự làm trong app)

Bạn không làm Thiết lập hộ (cần mật khẩu chung). Bạn có thể phỏng vấn trước, từng câu một, rồi đưa người dùng bản tóm
tắt để họ gõ vào màn **Thiết lập**:

1. **Nhà có mấy người dùng app** (1–6), gọi là gì (ví dụ "Bố", "Mẹ")? Người đầu tiên là chủ hộ.
2. **Tiền nằm ở đâu?** Từng tài khoản: tên (ví dụ "VCB của Bố", "Tiền mặt"), loại (Ngân hàng, Tiền mặt, Ví điện tử,
   Thẻ tín dụng), ngân hàng nào, của ai hay của chung. Chỉ hỏi tên, **không hỏi số tài khoản hay số dư** (nhập sau trong
   app). Tối đa 20 tài khoản; tên người / tài khoản không trùng nhau.
3. **Khoản chi bắt buộc hằng tháng** (ví Must) có những gì: ăn uống, nhà ở, đi lại, điện nước?
4. **Có thu nhập phải tự nộp thuế** (làm tự do, cho thuê…)? Có → app trích ví Thuế 10% mỗi lần có thu nhập.

Rồi nói với người dùng: mở địa chỉ ở bước 5 → màn **Thiết lập** → ô **Mật khẩu chung**: dán mật khẩu từ file → điền theo
bản tóm tắt (người, tài khoản, bộ ví mẫu). Mật khẩu riêng từng người: tuỳ chọn, đặt ngay ở bước Thành viên hoặc sau trong
app (Cài đặt › Thành viên). Màn báo sai mật khẩu chung → nhờ người dùng kiểm lại file, đừng thử đoán (sai nhiều lần sẽ bị
chặn một lúc).

## Bước 7 — Gợi ý tiếp

- Trên điện thoại: mở địa chỉ bằng trình duyệt → "Thêm vào màn hình chính".
- Hướng dẫn dùng từng màn: https://mzavn.gitbook.io/vi-nha
- Tự ghi sổ ngân hàng (SePay), nhắc qua Telegram / Zalo, nối Claude: người dùng tự làm trong app, mục **Cài đặt**. Chưa có tài khoản
  SePay: gửi người dùng link đăng ký <https://my.sepay.vn/register?gcid=arqcwdek> (link giới thiệu của Ví nhà, cũng có ở Cài đặt ›
  Kết nối › SePay).
- Cập nhật bản mới sau này: `git pull && npm install && npm run deploy`.
