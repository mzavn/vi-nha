# 261008-cung-co-ban-cong-khai: Củng cố bản công khai trước v1.0.1 — mật khẩu khi nhờ AI cài, ghi công AGPL và "Về Ví nhà", vệ sinh repo / CI
- Status: approved
- BR: BR-10, BR-14 (nháp)
- Đụng tới: UC-509 (access) — cài đặt và phát hành bản công khai; UC-709 (pwa) — Cài đặt › Máy này; UC-711 (pwa) — chân thanh bên máy tính; ẩn danh số liệu trong specs / test
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-08, chat (các quyết định trích dưới) · Người duyệt kỹ thuật: reviewer agent, 2026-10-08, approve with changes — đã sửa
- Commit: propose `—` · code `—` · merge `—`

## Vì sao

Rà bảo mật bản public v1.0.1 trước khi đẩy (ba báo cáo `plans/reports/security-scan-261008.md`,
`security-app-261008.md`, `security-supply-261008.md`) thấy:

- Commit của repo public mang email cá nhân của người duy trì (script phát hành đặt cứng email đó) — ai `git log` cũng thấy.
- Luồng "nhờ AI cài" in mật khẩu chung ra kết quả lệnh → mật khẩu nằm trong ngữ cảnh gửi nhà cung cấp AI và transcript
  lưu trên máy; đường "Làm hộ qua API" còn bảo agent đặt mật khẩu vào lệnh `curl`. Mật khẩu chung là chìa khoá cả sổ tiền.
- Lệnh sao lưu D1 trong CHANGELOG ghi `backup.sql` ngay thư mục repo, `.gitignore` không chặn — bản sao lưu chứa khoá
  SePay / Telegram / Zalo, khoá ký phiên, băm mật khẩu và toàn bộ giao dịch; `git add -A` là lên fork công khai.
- `API_TOKEN` (toàn quyền, đóng vai bất kỳ thành viên, không bị "Đăng xuất mọi máy" thu hồi) chưa được ghi ở đâu cho người tự cài.
- AGPL-3.0 nhưng không có dòng bản quyền, app không chỉ ra đang chạy bản nào và mã nguồn ở đâu.
- CI không khai `permissions:`, action ghim theo tag; chưa có `SECURITY.md`, `dependabot.yml`;
  `@modelcontextprotocol/sdk` 1.30.0 dính GHSA-6qxp-vccf-f47h (`npm audit --omit=dev`: 1 high).
- README nói số liệu "không đi qua máy chủ nào khác" nhưng font tải từ Google Fonts và màn Hướng dẫn nhúng GitBook.
- Ba proposal đã lưu trữ chép số dư thật của nhà, tên file sao lưu và version id deploy.

Chủ nhà chốt (2026-10-08, chat):

> Tác giả commit repo public không dùng email cá nhân nữa → `MZA <mzavn@users.noreply.github.com>`; liên hệ công khai là
> Facebook của chủ nhà https://www.facebook.com/minhtv11 (README "Liên hệ", CONTRIBUTING); báo lỗ hổng vẫn qua GitHub
> private vulnerability reporting.

> Cài bằng AI: khi `scripts/setup.mjs` tự sinh mật khẩu chung mà không có TTY (agent chạy) thì KHÔNG in ra — ghi vào
> `~/.vi-nha/<tên-worker>.txt` (thư mục 0700, file 0600, ghi đè khi `--reset-password`), chỉ in đường dẫn; có TTY thì vẫn
> in một lần như hiện nay. `docs/cai-bang-ai.md`: agent không bao giờ đọc / cat file đó, bảo người dùng tự mở; bỏ đường
> "Làm hộ qua API" đưa mật khẩu vào curl — người dùng tự làm Thiết lập trong app (agent vẫn được phỏng vấn và đưa câu trả
> lời để người dùng gõ).

> Mật khẩu tối thiểu giữ ≥ 8 (không đổi).

> `API_TOKEN`: giữ; ghi rõ trong README public + `.dev.vars.example` (toàn quyền, đóng vai bất kỳ thành viên qua
> `Authorization: Bearer` + `X-Member-Id`, "Đăng xuất mọi máy" không thu hồi, để trống trừ khi viết script gọi API; đổi
> bằng cách đặt lại secret).

> AGPL: thêm "Copyright (C) 2026 MZA" (README public + file NOTICE, giữ nguyên văn LICENSE); trong app Cài đặt › Máy này
> có hàng "Về Ví nhà": phiên bản (từ package.json lúc build) + link "Mã nguồn" → https://github.com/mzavn/vi-nha (tab mới).
> Phiên bản của package.json public do script phát hành đặt.

## Thay đổi spec

### UC-509 (cài đặt và phát hành bản công khai — AC của change, đánh số tiếp sau AC-1…AC-10 của change [261008-ban-cong-khai](../261008-ban-cong-khai/proposal.md) cũng chờ hợp nhất vào UC-509; test bằng unit test + script phát hành)
- ADDED AC-11 (mật khẩu khi không có terminal): Given `npm run setup -- --yes --generate-password` chạy không có TTY
  (agent AI), Worker tên `vi-nha` chưa có mật khẩu (hoặc có `--reset-password`), When script tự sinh mật khẩu chung và
  đặt xong, Then mật khẩu **không** xuất hiện ở đầu ra; nó nằm trong `~/.vi-nha/vi-nha.txt` (thư mục quyền 0700, file
  0600; chạy lại với `--reset-password` thì ghi đè), đầu ra chỉ có đường dẫn file và lời dặn "tự mở, đừng dán vào chat".
  Có TTY: in mật khẩu một lần như cũ, không ghi file. Mật khẩu người dùng tự gõ hoặc đưa qua `APP_PASSWORD`: không in,
  không ghi file. Độ dài tối thiểu giữ 8. Thay phần "in mật khẩu ra một lần" của AC-3 / AC-5 change 261008-ban-cong-khai
  cho trường hợp không có TTY, và bỏ đường "gọi `POST /v1/setup`" của AC-5.
  - Tests: `test/setup-script.test.ts` › "setup: mật khẩu tự sinh khi không có terminal › file mật khẩu nằm ở ~/.vi-nha/<tên-worker>.txt"; `test/setup-script.test.ts` › "setup: mật khẩu tự sinh khi không có terminal › ghi file quyền 0600 trong thư mục 0700, chạy lại thì ghi đè"; `test/setup-script.test.ts` › "setup: mật khẩu tự sinh khi không có terminal › không có terminal: chỉ in đường dẫn, không in mật khẩu; có terminal: in một lần"
- ADDED AC-12 (kịch bản AI): `docs/cai-bang-ai.md` chạy `npm run setup -- --yes --generate-password`, đưa người dùng
  đường dẫn file mật khẩu và bảo họ **tự mở** (agent không đọc, không `cat`, không mở file đó; người dùng không mở bằng
  lệnh trong ô chat của agent); không còn đường gọi `POST /v1/setup` hộ — người dùng tự làm màn Thiết lập, agent được
  phỏng vấn trước và đưa bản tóm tắt câu trả lời để người dùng gõ. `AGENTS.md` bản public nhắc cùng luật.
- ADDED AC-13 (danh tính công khai): repo public dựng bằng `scripts/publish-public.mjs` có commit / tag của
  `MZA <mzavn@users.noreply.github.com>`; README có mục "Liên hệ" (Facebook https://www.facebook.com/minhtv11), CONTRIBUTING
  trỏ cùng chỗ; `SECURITY.md` (tiếng Việt + tóm tắt tiếng Anh: phạm vi, báo qua GitHub private vulnerability reporting,
  phản hồi theo khả năng, chỉ hỗ trợ bản phát hành mới nhất).
- ADDED AC-14 (ghi công AGPL): bản public có `NOTICE` ("Ví nhà — Copyright (C) 2026 MZA", AGPL-3.0, mã nguồn ở
  https://github.com/mzavn/vi-nha) và README ghi cùng dòng bản quyền; `LICENSE` giữ nguyên văn.
- ADDED AC-15 (`API_TOKEN` có tài liệu): README public và `.dev.vars.example` nói rõ `API_TOKEN` cho toàn quyền đóng vai
  bất kỳ thành viên (`Authorization: Bearer` + `X-Member-Id`), "Đăng xuất mọi máy" không thu hồi, để trống trừ khi viết
  script gọi API, đổi bằng cách đặt lại secret.
- ADDED AC-16 (vệ sinh repo và CI): `.gitignore` chặn bản sao lưu D1 ở gốc repo (`/*.sql`, `backup*.sql`, `backups/`)
  mà không chặn `migrations/` hay `docs/*.sql`; lệnh sao lưu trong CHANGELOG / README ghi vào `.wrangler/backups/`;
  workflow CI có `permissions: contents: read`, `actions/checkout` / `actions/setup-node` ghim SHA commit đầy đủ kèm chú
  thích phiên bản; `.github/dependabot.yml` (npm + github-actions, hằng tuần); `npm audit --omit=dev` trong bản public ra
  0 lỗ hổng (nâng `@modelcontextprotocol/sdk`); README sửa câu riêng tư (font từ Google Fonts, màn Hướng dẫn nhúng GitBook
  nên IP / trình duyệt đến Google / GitBook; số liệu vẫn chỉ ở Cloudflare của bạn); specs / docs / test không còn số dư thật
  của nhà, tên file sao lưu, version id deploy (thay bằng số mẫu tự khớp nhau, giữ nghĩa — luật sẵn có "không số dư thật
  trong specs/docs/src/test"; test migration chỉ ở repo gốc giữ dữ liệu thật như thiết kế, tên test bỏ số); các số đặc
  trưng thêm vào `.private-names` để `check:private` bắt về sau.

### UC-709
- ADDED AC-30: Given bản build từ `package.json` có `version` "1.0.1", When mở Cài đặt › **Máy này**, Then có hàng
  **Về Ví nhà** ghi "Phiên bản 1.0.1" và link **Mã nguồn** mở https://github.com/mzavn/vi-nha ở tab mới; bản build không có
  `version` (repo phát triển) ghi "Bản phát triển".
  - Tests: `web/src/lib/settings.test.ts` › "về Ví nhà › phiên bản lấy từ package.json lúc build; không có thì ghi Bản phát triển"
- Main Flow bước 2: card Máy này thêm hàng "Về Ví nhà" (sau Hướng dẫn, trước Đang dùng).

### UC-711 (thanh bên máy tính)
- ADDED AC-15: Given màn rộng (≥ 1024px), bản build có `version` "1.0.1", When nhìn chân thanh bên, Then dưới "Đăng xuất
  mọi máy" có dòng nhỏ "Ví nhà · Phiên bản 1.0.1 · Mã nguồn" (link https://github.com/mzavn/vi-nha, tab mới; repo phát
  triển: "Bản phát triển") — màn rộng không có card Máy này nên đây là chỗ thay cho hàng "Về Ví nhà" của UC-709 AC-30.
  - Tests: `web/src/lib/settings.test.ts` › "về Ví nhà › phiên bản lấy từ package.json lúc build; không có thì ghi Bản phát triển" (chữ phiên bản dùng chung `appVersionLabel`); hiển thị: ⚠ Chưa có test

### Entity
- Không đổi.

## Quyết định

**ADR nháp — Mật khẩu chung tự sinh khi không có terminal đi vào file riêng của người dùng, không vào đầu ra.**
Bối cảnh: agent AI đọc mọi dòng đầu ra; luật "đừng nhắc lại" không lấy mật khẩu ra khỏi ngữ cảnh đã gửi đi. Quyết định:
không TTY thì ghi `~/.vi-nha/<tên-worker>.txt` (0700 / 0600), in đường dẫn; agent không mở file. Loại: bắt người dùng tự
gõ `APP_PASSWORD` trong terminal riêng (khó với người không biết code); in mật khẩu như cũ (rò vào transcript). Hệ quả:
mật khẩu nằm ở ổ đĩa người dùng tới khi họ xoá; trên Windows quyền 0600 không có tác dụng (chỉ thư mục người dùng).

## Thiết kế

- `scripts/setup.mjs`: hàm thuần `passwordFilePath(name, home)`, `savePasswordFile(path, password)` (tạo thư mục 0700,
  `chmod` lại nếu đã có; file 0600, ghi đè), `generatedPasswordMessage({ password, interactive, savedPath })`; `main()`
  ghi file ngay trước `wrangler secret put`, chỉ khi tự sinh và không có TTY (ghi lỗi thì dừng, mật khẩu cũ còn nguyên;
  `secret put` lỗi thì báo mật khẩu trong file chưa được đặt). USAGE / thông báo lỗi sửa chữ.
- `docs/cai-bang-ai.md` bước 4–6; `publish/AGENTS.md` mục "Cài Ví nhà".
- `scripts/publish-public.mjs`: email tác giả `mzavn@users.noreply.github.com`.
- `web/vite.config.ts`: `define: { __APP_VERSION__ }` từ `package.json`; `web/src/vite-env.d.ts` khai kiểu;
  `web/src/lib/settings.ts` › `appVersionLabel`; `web/src/lib/splits.ts` › `SOURCE_URL`; `web/src/screens/settings.tsx` ›
  `DeviceCard` thêm hàng; `web/src/ui/shell.tsx` › `Sidebar` thêm dòng chân (`.side-about` trong `styles.css`).
- `publish/`: `README.md` (bản quyền, Liên hệ, `API_TOKEN`, câu riêng tư, sao lưu), `CONTRIBUTING.md`, `CHANGELOG.md`
  (mục v1.0.1, lệnh sao lưu), `.dev.vars.example`, `NOTICE`, `SECURITY.md`, `.github/workflows/test.yml`,
  `.github/dependabot.yml`. `.gitignore` (chép sang public nguyên văn). `README.md` repo gốc không đổi lệnh sao lưu
  (đã ghi `.wrangler/backups/`).
- `package.json` / lock: `@modelcontextprotocol/sdk` ≥ 1.31 (bản vá GHSA-6qxp-vccf-f47h). Lỗ hổng chỉ ở gói dev (wrangler
  → miniflare / sharp) không vào bundle Worker, ghi nhận, không xử lý trong change này.
- Ẩn danh (bộ số mẫu dùng chung): Tích sản 55.000 = heo vợ 50.000 (bỏ heo 11 lần 41.000 + ví Heo đất cũ 9.000) + heo
  chồng 5.000; sau khi nhập số dư đầu: heo chồng 30.000, heo vợ 95.000, phao 10.000 (= 135.000), số dư có sẵn 80.000; số
  dư đầu 425.000 / 235.000 / 10.000 (= 670.000), rút về 400.000 + 190.000 (= 590.000); Quỹ an tâm cần 96.000.000; ví dụ
  Tiền chi được: Tích sản 2.055.000, Tích sản ở ngoài 1.055.000; lũy kế SePay âm −540.000 … −590.000 (lệch giả 840.000),
  dương: số dư thật 2.000.000 (lệch giả 600.000). Sửa ở `specs/decisions.md` (ADR-83, ADR-85, ADR-86, ADR-87, ADR-91),
  UC-105, UC-106, UC-107, UC-305, UC-702, UC-707, UC-709, UC-711, các proposal lưu trữ `261006-tich-san-ro-rang`,
  `261006-tien-chi-duoc`, `261006-so-du-co-san-vao-tich-san`, `261006-bo-luy-ke-sepay`, `261007-ma-tieng-anh-an-danh`;
  test `web/src/lib/wealth-building*.test.ts`, `web/src/lib/spendable-cash.test.ts`, `test/spendable-cash.test.ts`;
  chú thích `web/src/lib/wealth-building.ts`, `web/src/screens/wallets.tsx`. `test/migrations/piggy-bank.test.ts` (chỉ
  ở repo gốc) giữ dữ liệu thật, chỉ đổi tên test cho khỏi mang số.
- Không migration. Rủi ro: người dùng cài bằng AI cần biết mở file ẩn — kịch bản chỉ cách cho macOS / Windows.

**AI làm / người quyết:** AI làm code + tài liệu + chạy cổng; chủ nhà quyết đẩy public (viết lại lịch sử repo public là
việc của người dẫn).

## Review kỹ thuật
Reviewer agent (2026-10-08): đúng với quyết định chủ nhà (file mật khẩu 0700/0600 chỉ khi tự sinh + không terminal, ghi trước `secret put`; `--name` đã kiểm nên không traversal; CI pin SHA khớp v4.4.0; `.gitignore` không chặn file đang theo dõi; số ẩn danh khớp số học; MCP SDK 1.32.1 xanh). Đã sửa: luật dự phòng khi agent chạy trong terminal giả và lỡ thấy mật khẩu (`docs/cai-bang-ai.md`, `publish/AGENTS.md`); siết quyền file có sẵn về 0600 trước khi ghi đè.

## Việc cần làm
- [ ] Review kỹ thuật; commit propose
- [x] Test cho AC-11 (UC-509), AC-30 (UC-709) — đỏ trước khi code (2026-10-08: 4 test đỏ → xanh)
- [x] Code + tài liệu (AC-11 … AC-16 của UC-509, AC-30 của UC-709, AC-15 của UC-711)
- [x] Dựng bản public `v1.0.1` ở thư mục thử, mọi cổng xanh, tác giả `MZA <mzavn@users.noreply.github.com>`,
  `npm audit --omit=dev` 0 (còn 3 high chỉ ở gói dev: wrangler → miniflare → sharp, không vào bundle Worker)
- [ ] Xem tận mắt hàng "Về Ví nhà" trên điện thoại 390px và dòng chân thanh bên ở 1280px
- [ ] Hợp nhất: UC-509, UC-709 + `## History`, ADR vào decisions.md; archive
