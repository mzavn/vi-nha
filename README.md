# Ví nhà — sổ tiền cả nhà theo Profit First

> **English summary.** Ví nhà ("family wallet") is a self-hosted household money app built on the *Profit First* method:
> money is grouped into three pockets (savings / reserve / operating) of real accounts; goals are plans whose progress is
> read from real balances; payday creates a checklist. The app answers one question each day — *how much is left in Operating and per day
> until payday?* It runs entirely on **your own Cloudflare account** (Workers + D1, Free plan is enough) as an installable
> PWA, can ingest bank transactions
> automatically through [SePay](https://sepay.vn?gcid=arqcwdek) (Vietnamese banks), sends reminders via web push / Telegram / Zalo, and exposes an MCP server
> so Claude can read and record transactions. The interface and documentation are in **Vietnamese**.
> Install with the **Deploy to Cloudflare** button, `npm run setup`, or by asking an AI coding agent to follow
> [`docs/cai-bang-ai.md`](docs/cai-bang-ai.md). License: AGPL-3.0, Copyright (C) 2026 MZA. Security reports: [`SECURITY.md`](SECURITY.md).

Ví nhà trả lời một câu mỗi ngày: **"Vận hành còn bao nhiêu, mỗi ngày chi khoảng bao nhiêu tới kỳ lương?"**. Mỗi tài khoản
thật của nhà thuộc một trong ba ngăn — **Tích luỹ** (trích trước, không đụng), **Dự phòng** (các khoản đã biết sẽ phải trả;
phần còn lại là phần an tâm), **Vận hành** (tiền chi tiêu tới kỳ lương). Mọi số là tiền thật trong tài khoản, không có ví
trên giấy. Mục tiêu (học phí, thuế, điện nước…) là kế hoạch: số "đã có" đọc từ số dư thật — một tài khoản riêng hay dùng
chung, tài khoản mẹ kèm các khoản gửi kỳ hạn, hoặc trả thẳng từ tiền chi tiêu. Lương về, app đưa danh sách việc: trích
Tích luỹ, nạp mục tiêu, chia phần dư kỳ trước. App chạy trên
**tài khoản Cloudflare của chính nhà bạn** (gói Free là đủ): số liệu nằm ở database của bạn, không lưu ở máy chủ nào khác.
(Font chữ tải từ Google Fonts, nên Google thấy địa chỉ IP và loại trình duyệt khi bạn mở app; GitBook chỉ thấy khi bạn
bấm mở Hướng dẫn — không ai thấy số liệu.)

<p>
  <img src="https://2736867949-files.gitbook.io/~/files/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FAkew07JyqLl5qmM1Jo26%2Fuploads%2Fgit-blob-bec8d942a542b3e9a038fd40f26db73269458726%2Fhom-nay-01-tong-quan-m.jpg?alt=media" alt="Màn Hôm nay" width="260">
</p>

*(Hình minh hoạ dùng dữ liệu mẫu.)*

## App làm gì

| | |
|---|---|
| **Ghi khoản chi trong vài giây** | Gõ số tiền, chạm danh mục, bấm Lưu — app nói ngay Vận hành còn bao nhiêu. Mất mạng vẫn ghi được, có mạng thì tự gửi |
| **Ba ngăn** | Tích luỹ · Dự phòng · Vận hành, mỗi ngăn là một nhóm tài khoản thật; thẻ Vận hành cho biết còn bao nhiêu và chi khoảng bao nhiêu mỗi ngày tới kỳ lương |
| **Mục tiêu là kế hoạch** | Số "đã có" đọc từ số dư thật: tài khoản riêng hoặc dùng chung, tài khoản mẹ + khoản gửi kỳ hạn, hoặc trả thẳng từ tiền chi tiêu. Khoản phải trả đặt được số riêng cho kỳ này (0 cũng được); chi theo danh mục gắn với khoản tự tính là đã trả |
| **Trả cho mình trước** | Lương về có danh sách việc: trích Tích luỹ theo thang 1 · 10 · 30%, nạp mục tiêu, chia dư kỳ trước 50/50 Tích luỹ / Ví Thưởng; kèm mã QR, tự đánh dấu khi tiền tới đúng tài khoản |
| **Nhìn lại theo kỳ lương** | Chi theo nhóm danh mục so hạn mức mềm, so kỳ trước |
| **Tự ghi sổ ngân hàng** | Tài khoản nối [SePay](https://my.sepay.vn/register?gcid=arqcwdek) tự báo tiền vào / ra; bạn chỉ chọn "khoản này là gì", khoản lặp lại thì đặt luật tự gán |
| **Đối soát** | Sổ so với giao dịch ngân hàng và số dư thật; lệch là báo |
| **Nợ và phải thu** | Mình nợ ai, ai nợ mình, người thuê nhà còn phải trả bao nhiêu |
| **Nhắc việc** | Tin sáng, tổng kết tuần, giao dịch chưa gán — qua thông báo trên máy, Telegram hoặc Zalo. Chỉ nhắc chuyển thêm vào tiền chi tiêu khi thiếu tiền cho các khoản chắc chắn |
| **Nói chuyện với Claude** | Nối Claude (OAuth, MCP): hỏi "Vận hành còn bao nhiêu", ghi khoản chi bằng lời |
| **Cả nhà cùng dùng** | 1–6 người, mật khẩu chung hoặc mật khẩu riêng từng người; tài khoản riêng tư: người khác chỉ thấy tổng |

Hướng dẫn sử dụng đầy đủ (có hình từng màn): **https://mzavn.gitbook.io/vi-nha**

## v2 khác v1 thế nào

| | v1 (tới 1.8) | v2 |
|---|---|---|
| Tiền nằm ở đâu | Ví ảo đặt trên các tài khoản | Chỉ tài khoản thật, mỗi tài khoản thuộc một ngăn |
| Chia tiền | Luật nạp, rót theo dòng thác vào từng ví | Ba ngăn Tích luỹ · Dự phòng · Vận hành |
| Mục tiêu | Ví quỹ có số dư riêng trên giấy | Kế hoạch đọc từ số dư thật (tài khoản dùng chung, tài khoản mẹ + gửi kỳ hạn, hoặc trả từ tiền chi tiêu) |
| Con số hằng ngày | Còn bao nhiêu để chi tuần này, theo từng ví | Vận hành còn bao nhiêu, chi khoảng …/ngày tới kỳ lương |
| Nhịp | Theo tháng, chốt tháng | Theo kỳ lương, lương về có danh sách việc |
| Trích Tích luỹ | % khi chia một khoản thu | Thang 1 · 10 · 30% trong việc ngày lương |
| Nhìn lại | Theo ví | Theo nhóm danh mục, so hạn mức mềm và kỳ trước |
| Giữ nguyên | Trả cho mình trước · phần dư chia 50/50 · tự ghi sổ qua SePay | như v1 |

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
nhắc và trả lời vài câu (nhà có mấy người, có những tài khoản nào). Agent **không thấy mật khẩu chung**: script ghi nó vào
file `~/.vi-nha/vi-nha.txt` trên máy bạn, agent chỉ đưa đường dẫn để bạn tự mở; màn Thiết lập trong app bạn tự làm.

### Sau khi cài

Mở địa chỉ vừa có → màn **Thiết lập**: nhập mật khẩu chung, thêm người trong nhà, tài khoản tiền, xếp tài khoản vào ngăn,
ngày lương, % Tích luỹ, mục tiêu Dự phòng.
Trên điện thoại: mở bằng trình duyệt → "Thêm vào màn hình chính" để dùng như app.

## Lưu ý trước khi cài

- **Gói Free của Cloudflare chỉ có 5 cron cho cả tài khoản.** Ví nhà dùng 2 (nhắc việc, rà soát giao dịch ban đêm).
  Tài khoản đã dùng hết cron cho việc khác thì deploy sẽ báo lỗi.
- **Tự ghi sổ ngân hàng cần [SePay](https://sepay.vn?gcid=arqcwdek)** (dịch vụ bên thứ ba, nối tài khoản ngân hàng Việt Nam; giá xem ở [sepay.vn](https://sepay.vn?gcid=arqcwdek)).
  Chưa có tài khoản: [đăng ký SePay qua link giới thiệu của Ví nhà](https://my.sepay.vn/register?gcid=arqcwdek) (cũng có trong app: Cài đặt › Kết nối › SePay).
  Không có SePay thì vẫn dùng được: ghi tay, danh sách việc ngày lương, nhắc việc đều chạy.
- **Nối Claude (hoặc ứng dụng AI khác) thì số liệu bạn hỏi sẽ đi qua nhà cung cấp AI đó.** Không nối thì số liệu chỉ nằm
  trong Cloudflare của bạn.
- **`API_TOKEN` (tuỳ chọn) — để trống trừ khi bạn viết script gọi API.** Ai có token này gọi được toàn bộ `/v1/*` với
  `Authorization: Bearer <token>`, đóng vai **bất kỳ thành viên** nào qua header `X-Member-Id` (không có header thì là chủ
  hộ), và **"Đăng xuất mọi máy" không thu hồi nó**. Cần thì đặt bằng `npx wrangler secret put API_TOKEN` (chuỗi ngẫu nhiên
  dài); lộ hay không dùng nữa thì đặt lại giá trị mới hoặc xoá secret đó trong Cloudflare dashboard.
- Mật khẩu chung là chìa khoá vào app: đặt dài, không dùng lại mật khẩu khác; quên thì đặt lại bằng
  `npm run setup -- --reset-password` hoặc trong Cloudflare dashboard (Worker → Settings → Variables and Secrets).
- Muốn dùng tên miền riêng thay cho `workers.dev`: thêm `routes` vào `wrangler.jsonc`
  ([hướng dẫn của Cloudflare](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).

## Cập nhật bản mới

Xem có gì mới ở [`CHANGELOG.md`](CHANGELOG.md) — mục nào ghi "có migration" thì database được nâng cấp tự động khi deploy.
App tự biết có bản mới: **Cài đặt › Nâng cao › Cập nhật Ví nhà › Kiểm tra bản mới** (app chỉ hỏi GitHub khi bạn bấm).
Hướng dẫn từng bước kèm ảnh: [Cập nhật Ví nhà](https://mzavn.gitbook.io/vi-nha/bat-dau/cap-nhat-vi-nha).

- **Cài bằng nút Deploy:** bấm **Cập nhật** trong app (mở trang workflow **Cập nhật Ví nhà** trong repo GitHub của bạn), rồi
  **Run workflow**. Workflow kéo bản phát hành mới nhất vào repo của bạn, giữ tên Worker, tên miền riêng và id database / KV
  trong `wrangler.jsonc`; Cloudflare thấy commit mới thì tự build, nâng database và deploy. Sửa riêng trong code của repo sẽ bị
  ghi đè (trừ thư mục `.github/`). Repo cài trước khi có workflow này: thêm file
  [`.github/workflows/update.yml`](.github/workflows/update.yml) vào repo của bạn **một lần** (GitHub › Add file › Create new
  file, dán nội dung). Chỉ hỗ trợ repo trên GitHub. Sao lưu: D1 tự giữ lịch sử 7 ngày (Time Travel, gói Free); khôi phục cần
  `npx wrangler d1 time-travel restore`.
- **Cài bằng `npm run setup` / AI:** sao lưu rồi cập nhật trong thư mục `vi-nha`. Bản sao lưu chứa khoá kết nối và mọi giao
  dịch — để trong `.wrangler/` (thư mục không lên git), đừng commit, đừng gửi ai (thay `<ngày>` bằng ngày hôm nay, ví dụ `261013`):

  ```bash
  mkdir -p .wrangler/backups
  npx wrangler d1 export vi-nha --remote --output .wrangler/backups/vi-nha-<ngày>.sql
  git pull --autostash && npm ci && npm run deploy
  ```

  `--autostash`: `npm run setup` ghi `account_id` vào `wrangler.jsonc`, `git pull` trần sẽ từ chối.

`npm run deploy` = build → nâng cấp database (`wrangler d1 migrations apply DB --remote`) → deploy. Chỉ dùng để cập nhật;
lần đầu cài dùng nút Deploy hoặc `npm run setup`. Cập nhật xong, mở lại app (hay bấm **Tải bản mới** khi app báo) để chạy bản mới.

### Lên 2.0 từ 1.x — bản nâng database lớn

Bản 2.0 bỏ ví, chuyển sang ba ngăn tài khoản thật (chi tiết ở [`CHANGELOG.md`](CHANGELOG.md)). Database tự nâng khi cập
nhật và **không lùi lại được bằng nút Cập nhật**, nên:

1. **Sao lưu trước.** Chọn lúc cả nhà không ghi chép (~15 phút). Cài bằng `npm run setup` / AI: chạy lệnh export ở trên
   (đặt `CLOUDFLARE_ACCOUNT_ID` trước nếu máy đăng nhập nhiều tài khoản Cloudflare), mở được file thì mới cập nhật. Cài bằng
   nút Deploy: D1 tự giữ lịch sử 7 ngày (Time Travel) — **ghi lại giờ bạn bấm cập nhật**.
2. **Bước nâng database lỗi**: bấm **Retry** ở build Cloudflare hoặc chạy lại `npm run deploy` (bước nâng tiếp từ chỗ
   dừng). **Không** đưa code về 1.8 khi database chưa được khôi phục.
3. **Sau khi cập nhật**: làm màn **Chuyển sang ba ngăn** (5 bước, app tự mở lần đầu; bấm Để sau thì Hôm nay có banner).
4. **Lùi về 1.8** (chỉ khi thật cần): `npx wrangler d1 time-travel restore` về trước giờ cập nhật (hoặc nạp lại file sao
   lưu), rồi deploy lại bản 1.8.0. Mọi thứ ghi sau giờ đó mất.

Hướng dẫn kèm ảnh: [Cập nhật Ví nhà](https://mzavn.gitbook.io/vi-nha/bat-dau/cap-nhat-vi-nha).

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
- Đóng góp: [`CONTRIBUTING.md`](CONTRIBUTING.md). Luật cho agent AI: [`AGENTS.md`](AGENTS.md). Báo lỗ hổng bảo mật:
  [`SECURITY.md`](SECURITY.md).

## Liên hệ

Người duy trì: MZA — Facebook <https://www.facebook.com/minhtv11>. Lỗi và đề xuất: mở
[issue](https://github.com/mzavn/vi-nha/issues). Lỗ hổng bảo mật: **không** mở issue công khai, xem [`SECURITY.md`](SECURITY.md).

## Giấy phép

Ví nhà — Copyright (C) 2026 MZA. Phát hành theo [GNU AGPL-3.0](LICENSE) (xem thêm [`NOTICE`](NOTICE)). Bạn được dùng, sửa,
chia sẻ tự do; nếu sửa rồi cho người khác dùng qua mạng thì phải công bố mã nguồn bản đã sửa theo cùng giấy phép — app có
sẵn hàng **Cài đặt › Máy này › Về Ví nhà** (phiên bản + link mã nguồn); bản đã sửa thì trỏ link đó về mã nguồn của bạn
(`SOURCE_URL` trong `web/src/lib/splits.ts`).
