# Ví nhà — sổ tiền cả nhà theo Profit First

> **English summary.** Ví nhà ("family wallet") is a self-hosted household money app built on the *Profit First* method:
> every income is split immediately into wallets (wealth building, tax, fun, must-pay, nice-to-have), locked money is never
> touched, and the app answers one question each day — *how much is left to spend this week?* It runs entirely on **your
> own Cloudflare account** (Workers + D1, Free plan is enough) as an installable PWA, can ingest bank transactions
> automatically through SePay (Vietnamese banks), sends reminders via web push / Telegram / Zalo, and exposes an MCP server
> so Claude can read and record transactions. The interface and documentation are in **Vietnamese**.
> Install with the **Deploy to Cloudflare** button, `npm run setup`, or by asking an AI coding agent to follow
> [`docs/cai-bang-ai.md`](docs/cai-bang-ai.md). License: AGPL-3.0.

Ví nhà trả lời một câu mỗi ngày: **"Tuần này còn bao nhiêu để chi?"**. Lương về là app chia ngay vào các ví — Tích sản,
Thuế, Hưởng thụ, Must, Có thì tốt; phần đã khoá thì không đụng tới, phần còn lại mới là tiền được tiêu. App chạy trên
**tài khoản Cloudflare của chính nhà bạn** (gói Free là đủ): số liệu nằm ở database của bạn, không đi qua máy chủ nào khác.

<p>
  <img src="https://2736867949-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FAkew07JyqLl5qmM1Jo26%2Fuploads%2Fgit-blob-bec8d942a542b3e9a038fd40f26db73269458726%2Fhom-nay-01-tong-quan-m.jpg?alt=media" alt="Màn Hôm nay" width="260">
  <img src="https://2736867949-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FAkew07JyqLl5qmM1Jo26%2Fuploads%2Fgit-blob-782c2d9e8db6d0fe86191b4680f807638ae8c4e5%2Fhom-nay-02-dong-thac-m.jpg?alt=media" alt="Dòng thác tháng này" width="260">
</p>

*(Hình minh hoạ dùng dữ liệu mẫu.)*

## App làm gì

| | |
|---|---|
| **Ghi khoản chi trong vài giây** | Gõ số tiền, chạm danh mục, bấm Lưu — app nói ngay ví đó còn bao nhiêu. Mất mạng vẫn ghi được, có mạng thì tự gửi |
| **Chia lương theo Profit First** | Thu nhập về → Tích sản → Thuế → Hưởng thụ → Must → Có thì tốt; app tính sẵn mỗi ví nhận bao nhiêu và nhắc các lệnh chuyển tiền cần làm |
| **Tự ghi sổ ngân hàng** | Tài khoản nối [SePay](https://sepay.vn) tự báo tiền vào / ra; bạn chỉ chọn "khoản này là gì", khoản lặp lại thì đặt luật tự gán |
| **Đối soát** | Sổ so với giao dịch ngân hàng và số dư thật; lệch là báo |
| **Nợ và phải thu** | Mình nợ ai, ai nợ mình, người thuê nhà còn phải trả bao nhiêu |
| **Nhắc việc** | Tin sáng, tổng kết tuần, giao dịch chưa gán — qua thông báo trên máy, Telegram hoặc Zalo |
| **Nói chuyện với Claude** | Nối Claude (OAuth, MCP): hỏi "tuần này còn bao nhiêu", ghi khoản chi bằng lời |
| **Cả nhà cùng dùng** | 1–6 người, mật khẩu chung hoặc mật khẩu riêng từng người; ví riêng ẩn số với người khác |

Hướng dẫn sử dụng đầy đủ (có hình từng màn): **https://mzavn.gitbook.io/vi-nha**

## Cài đặt — chọn một trong ba cách

Cần: một tài khoản [Cloudflare](https://dash.cloudflare.com/sign-up) (miễn phí). Cách 2 và 3 cần thêm
[Node.js 22](https://nodejs.org) và [git](https://git-scm.com) trên máy.

### Cách 1 — Nút Deploy (không gõ lệnh)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mzavn/vi-nha)

Bấm nút, đăng nhập Cloudflare và GitHub. Cloudflare tạo một repo GitHub của bạn, tự tạo database D1 `vi-nha` và kho KV,
hỏi **`APP_PASSWORD`** — mật khẩu chung của cả nhà (đặt dài, khó đoán, ghi lại ngay) — rồi build và deploy.
Xong sẽ có địa chỉ dạng `https://vi-nha.<tên-của-bạn>.workers.dev`.

### Cách 2 — `npm run setup`

```bash
git clone https://github.com/mzavn/vi-nha.git
cd vi-nha
npm install
npx wrangler login     # mở trình duyệt, bấm Allow
npm run setup
```

Script kiểm tra đăng nhập, hỏi account (nếu bạn có nhiều), deploy (Cloudflare tự tạo D1 / KV), dựng database, đặt
mật khẩu chung (bỏ trống thì tự sinh và in ra **một lần**) rồi in địa chỉ của bạn. Chạy lại an toàn: không tạo database
thứ hai, không đổi mật khẩu (đổi: `npm run setup -- --reset-password`). Các cờ khác: `npm run setup -- --help`.

### Cách 3 — Nhờ AI cài

Mở thư mục repo trong Claude Code, Codex, Cursor… và nói: *"Cài Ví nhà cho tôi theo docs/cai-bang-ai.md"*.
Agent chạy các lệnh trong [`docs/cai-bang-ai.md`](docs/cai-bang-ai.md); bạn chỉ cần bấm đăng nhập Cloudflare khi được
nhắc và trả lời vài câu (nhà có mấy người, có những tài khoản nào).

### Sau khi cài

Mở địa chỉ vừa có → màn **Thiết lập**: nhập mật khẩu chung, thêm người trong nhà, tài khoản tiền, chọn bộ ví mẫu.
Trên điện thoại: mở bằng trình duyệt → "Thêm vào màn hình chính" để dùng như app.

## Lưu ý trước khi cài

- **Gói Free của Cloudflare chỉ có 5 cron cho cả tài khoản.** Ví nhà dùng 2 (nhắc việc, rà soát giao dịch ban đêm).
  Tài khoản đã dùng hết cron cho việc khác thì deploy sẽ báo lỗi.
- **Tự ghi sổ ngân hàng cần [SePay](https://sepay.vn)** (dịch vụ bên thứ ba, nối tài khoản ngân hàng Việt Nam; giá xem ở sepay.vn).
  Không có SePay thì vẫn dùng được: ghi tay, chia tiền, nhắc việc đều chạy.
- **Nối Claude (hoặc ứng dụng AI khác) thì số liệu bạn hỏi sẽ đi qua nhà cung cấp AI đó.** Không nối thì số liệu chỉ nằm
  trong Cloudflare của bạn.
- Mật khẩu chung là chìa khoá vào app: đặt dài, không dùng lại mật khẩu khác; quên thì đặt lại bằng
  `npm run setup -- --reset-password` hoặc trong Cloudflare dashboard (Worker → Settings → Variables and Secrets).
- Muốn dùng tên miền riêng thay cho `workers.dev`: thêm `routes` vào `wrangler.jsonc`
  ([hướng dẫn của Cloudflare](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).

## Cập nhật bản mới

Xem có gì mới ở [`CHANGELOG.md`](CHANGELOG.md) — mục nào ghi "có migration" thì database được nâng cấp tự động khi deploy.

- **Cài bằng nút Deploy:** repo GitHub của bạn kéo bản mới từ `mzavn/vi-nha` (nút **Sync fork** nếu repo là fork, hoặc
  `git pull https://github.com/mzavn/vi-nha.git main` rồi `git push`) — Cloudflare tự build và deploy lại khi repo có commit mới.
- **Cài bằng `npm run setup` / AI:** `git pull && npm install && npm run deploy`.

`npm run deploy` = build → nâng cấp database (`wrangler d1 migrations apply DB --remote`) → deploy. Chỉ dùng để cập nhật;
lần đầu cài dùng nút Deploy hoặc `npm run setup`.

## Phát triển

Node.js 22.13 trở lên (test dùng `node:sqlite`), Python 3 (kiểm tra specs).

```bash
npm ci
cp .dev.vars.example .dev.vars        # điền APP_PASSWORD
npm run db:migrate:local
npm run dev                            # Worker ở http://localhost:8787 — giao diện: npm run build trước, hoặc npm run dev:web
npm test && npm run typecheck && npm run specs:check
```

- `src/` Worker (Hono, D1, cron, MCP) · `web/` PWA (Preact, Tailwind) · `migrations/` database · `test/` vitest.
- `specs/` là đặc tả đã chốt (Spec-Driven Development) — đọc `specs/README.md`; `docs/` là nguyên lý và thiết kế.
- Đóng góp: [`CONTRIBUTING.md`](CONTRIBUTING.md). Luật cho agent AI: [`AGENTS.md`](AGENTS.md).

## Giấy phép

[GNU AGPL-3.0](LICENSE). Bạn được dùng, sửa, chia sẻ tự do; nếu sửa rồi cho người khác dùng qua mạng thì phải công bố mã
nguồn bản đã sửa theo cùng giấy phép.
