# 261008-ban-cong-khai: Bản công khai — cài bằng nút Deploy, `npm run setup` hoặc AI; một migration baseline; script đẩy sang repo public
- Status: approved
- BR: BR-10, BR-14 (nháp, mới)
- Đụng tới: UC-509 (access); tài liệu cài đặt; không đổi hành vi app
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-07 / 08 (hai repo, `mzavn/vi-nha`, AGPL-3.0, README tiếng Việt + tóm tắt Anh, "làm change 4"); đẩy public cần chủ nhà đồng ý lần cuối · Người duyệt kỹ thuật: reviewer agent, 2026-10-08, approve with changes — đã sửa
- Commit: propose `—` · code `—` · merge `—`

## Vì sao

Bước 4 (cuối) của việc mở mã nguồn (lộ trình: `plans/reports/researcher-261007-mo-ma-nguon.md` §5, §6, §7).

> "mục tiêu là tôi muốn opensource con này + doc của nó cho mọi người cùng xài … làm sao cho dân nontech deploy nhanh + dễ dùng"
> "nhưng nếu mà có dân non tech + AI setup thì sao ???"
> "cái migration cuối cùng chỉ dùng 1 cái duy nhất thôi nhé, còn mình dev thì n cái cũng được"

Chủ nhà đã chốt (2026-10-07 / 08): hai repo — repo này (private) là nơi phát triển, nhà mình deploy từ đây; repo public **`github.com/mzavn/vi-nha`** chỉ nhận bản stable, đẩy bằng script; license **AGPL-3.0**; nhận issue và PR; `plans/` chỉ ở private; README tiếng Việt, có đoạn tóm tắt tiếng Anh đầu trang; bản public chỉ có **một** migration baseline, sau đó mới thêm migration kế tiếp.

Đã có sẵn từ Change 0–3: tên tiếng Anh, hộ mẫu tiếng Anh, ẩn danh + `npm run check:private`, màn Thiết lập lần đầu, chỉ `APP_PASSWORD` bắt buộc, Claude qua OAuth.

BR-14 (nháp, chủ nhà duyệt): **Một nhà khác tự cài và dùng được Ví nhà trên Cloudflare Free của chính họ, không cần biết code.** Success metric: hai đồng nghiệp, tài khoản Cloudflare của họ, đi từ README tới lúc ghi được khoản chi đầu tiên — qua nút Deploy (không gõ lệnh) hoặc qua AI chạy lệnh (chỉ bấm đăng nhập Cloudflare và trả lời câu hỏi). Out of scope: dịch vụ chung nhiều nhà, ngôn ngữ khác, ngân hàng ngoài SePay.

## Thay đổi spec

Không đổi hành vi app. Tiêu chí nghiệm thu (AC của change, test bằng script / chạy thật):

- AC-1 (baseline): baseline sinh **đúng một lần** ở `v1.0.0` từ `docs/schema.sql` (cấu trúc + dữ liệu hệ thống, không hộ mẫu), lưu **cố định** ở `publish/migrations/0030_baseline.sql` trong repo private (mang số migration private cuối cùng, để `wrangler d1 migrations create` ở hai repo cùng ra `0031`). Given repo public dựng bằng script, When đếm `migrations/`, Then có `0030_baseline.sql` + mọi `migrations/00NN_*.sql` của private với NN > 0030 (hằng `BASELINE_AFTER` trong script); DB dựng từ đó có `schema_version` mới nhất, `GET /v1/setup` → `needed: true`; `test/schema.test.ts` ở public (chuỗi migration == `docs/schema.sql`) là lưới an toàn. Không bao giờ sinh lại baseline ở bản sau (máy đã cài sẽ chạy trùng).
- AC-2 (script đẩy): `node scripts/publish-public.mjs <thư-mục-repo-public> --version vX.Y.Z` **đồng bộ kiểu gương** theo danh sách cho phép (file ở đích không còn trong danh sách thì xoá; giữ `.git/`, `node_modules/`, `.wrangler/`, `public/`, `.dev.vars`) — danh sách gồm cả `.gitignore`, `package-lock.json` (đổi `name`), `.claude/skills/mk-specs/` (scripts của `specs:gen` / `specs:check`, không có dữ liệu riêng); thay bằng bản public của `wrangler.jsonc`, `.dev.vars.example`, `package.json` (script deploy), `README.md`; **không** chép `plans/`, `test/migrations/`, migration cũ `0001…`, `.wrangler/`, `.prod.secrets`, `.private-names`; trong `specs/`: link tới `plans/…` thành chữ thường, trích dẫn tới `test/migrations/…` thành ghi chú "test migration ở repo gốc" (hoặc `ignore` của verify nếu có); chạy `check:private` **quét toàn cây thư mục đích** (0 chỗ), `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm run specs:check` ngay trong thư mục đích; commit + tag `vX.Y.Z`. Không tự `git push` (có cờ `--push` riêng). Chạy lại với cùng nội dung → không tạo commit rỗng.
- AC-3 (`npm run setup`, trong repo public): chạy được **hoàn toàn không tương tác** (agent AI không có TTY) bằng cờ / env: `--account-id` hoặc `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (tuỳ), `APP_PASSWORD` qua env hoặc `--generate-password`, `--yes`; có TTY thì hỏi. Luồng: (1) `wrangler whoami` — chưa đăng nhập thì dừng, bảo người dùng tự chạy `npx wrangler login` trong terminal (script / agent không chạy hộ, vì lệnh đó chờ trình duyệt); (2) nhiều account mà không có `--account-id` → dừng, liệt kê account; account đã chọn ghi vào `wrangler.jsonc` của người dùng; (3) chưa có subdomain `workers.dev` → dừng, in link `https://dash.cloudflare.com/<account>/workers/onboarding`; (4) `wrangler deploy` để Cloudflare **tự tạo** D1 `vi-nha` và KV (tên tự sinh `vi-nha-oauth-kv`) — cùng đường với nút Deploy, không tự tạo bằng lệnh riêng; (5) `wrangler d1 migrations apply DB --remote`; (6) `APP_PASSWORD` qua stdin của `wrangler secret put` — mật khẩu sinh ra in **một lần** ra stdout, không bao giờ nằm trên dòng lệnh; (7) in địa chỉ `https://vi-nha.<subdomain>.workers.dev`. Chạy lần hai: không tạo D1 / KV thứ hai (Cloudflare tra theo tên), không đổi mật khẩu (trừ `--reset-password`), deploy lại. Node ≥ 20 để cài; phát triển / test cần Node ≥ 22.13 (`node:sqlite`) — ghi `engines` trong `package.json` public.
- AC-4 (nút Deploy to Cloudflare): `wrangler.jsonc` public không có `account_id`, `routes`; `workers_dev: true`; binding D1 `DB` (`database_name: vi-nha`, không id) và KV `OAUTH_KV` (không id) để Cloudflare tự tạo (wrangler ≥ 4.45 / nút Deploy); `.dev.vars.example` chỉ có `APP_PASSWORD` (mô tả trong `package.json` › `cloudflare.bindings`); script `deploy` = build → migrate remote → deploy. `npm run deploy` chỉ để cập nhật (README nói rõ: lần đầu dùng `npm run setup` hoặc nút Deploy). Kiểm thật ngay sau khi chủ nhà duyệt đẩy `mzavn/vi-nha` (cần URL GitHub công khai), rồi đồng nghiệp thử.
- AC-5 (cài bằng AI): `docs/cai-bang-ai.md` là kịch bản cho agent AI (Claude Code, Codex, Cursor): kiểm Node, `npm install`, `npm run setup`, nhắc người dùng bấm đăng nhập Cloudflare, rồi hướng dẫn mở địa chỉ và đi màn Thiết lập (hoặc gọi `POST /v1/setup` theo câu trả lời phỏng vấn); không tự soạn lệnh `wrangler` ngoài kịch bản; không in lại mật khẩu vào chat sau lần đầu. `AGENTS.md` bản public có mục "Cài Ví nhà" trỏ tới file này.
- AC-6 (tài liệu public): README (tiếng Việt, tóm tắt tiếng Anh đầu trang, ảnh, ba đường cài, cảnh báo gói Free chỉ có 5 cron cho cả tài khoản — Ví nhà dùng 2, cần SePay để tự ghi sổ ngân hàng, số liệu đi qua nhà cung cấp AI khi nối Claude); `LICENSE` (AGPL-3.0); `CONTRIBUTING.md` (PR theo `mk-specs`: proposal, AC, test; luật tiền / quyền / bảo mật do người duy trì quyết; PR được nhận thì chép về repo private, phát hành lại); link hướng dẫn GitBook.
- AC-7 (thử thật trên `*.workers.dev`): dựng một bản thử từ thư mục public trên tài khoản MZA bằng `npm run setup` (Worker tên khác, D1 / KV riêng), đi màn Thiết lập **với 3 người có mật khẩu riêng** (đo CPU `POST /v1/setup`: mỗi mật khẩu ~5 ms băm — nếu vượt 10 ms thường xuyên thì màn Thiết lập chỉ nhận mật khẩu riêng của chủ hộ, người khác đặt sau ở Cài đặt, cần AC mới), ghi một khoản chi, gửi webhook SePay thử (khoá sai → 401; khoá đúng → ghi log) để biết `*.workers.dev` có chặn webhook (Browser Integrity Check) không — bị chặn thì README bắt buộc tên miền riêng trên Cloudflare cho SePay / Zalo; xong thì xoá Worker / D1 / KV thử.
- AC-9 (an toàn dữ liệu): trước khi đẩy, specs không còn số tài khoản / số tiền thật: thay số sổ tiết kiệm thật trong `specs/ingest/UC-305` (dòng có `AC - 347…`) và `UC-307` bằng số mẫu; `.private-names` thêm số đó, `account_id`, id D1 / KV của MZA, tên repo private.
- AC-10 (CI): `.github/workflows/test.yml` ở public chạy `npm ci`, `npm test`, `npm run typecheck`, `npm run specs:check` cho mỗi PR (Node 22.13+).
- AC-8 (phiên bản): `CHANGELOG.md` ở repo public, mục `v1.0.0` ghi rõ "có migration: baseline". `GET /v1/health` không đổi.

## Quyết định

**ADR nháp — Bản public: một baseline + chép bằng script từ repo private.** Loại: public repo là nơi phát triển chính (chủ nhà chọn hai repo); `git push` thẳng từ private (lộ lịch sử); gộp migration ngay trong repo private (prod đã chạy theo tên file).

## Thiết kế

- `publish/` (mới, trong repo private): `wrangler.jsonc`, `.dev.vars.example`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`, `AGENTS.md` phần thêm "Cài Ví nhà" — bản public; `package.json` public sinh từ bản private + thay script `deploy`, thêm `setup`, `cloudflare.bindings`.
- `scripts/publish-public.mjs`, `scripts/setup.mjs` (chạy được cả ở private để thử với `--name`/`--config`), `docs/cai-bang-ai.md`.
- `scripts/check-private.mjs` nhận thư mục gốc làm tham số; với thư mục đích thì quét **toàn cây** (kể cả `migrations/`, `wrangler.jsonc`, `.github/`), không chỉ `PUBLIC_PATHS`. `publish/` thêm vào `PUBLIC_PATHS` khi quét repo private.
- `test/schema.test.ts` ở bản public: chuỗi migration (= baseline) dựng đúng `docs/schema.sql` — giữ được vì baseline sinh từ chính file đó.
- Ghi chú: dòng History trong specs trỏ hash commit của repo private; bản public ghi một dòng giải thích ở `specs/README.md`.
- Chưa kiểm chứng (để thử ở AC-7 / với đồng nghiệp): nút Deploy có tự tạo D1 / KV khi `wrangler.jsonc` không có id; có bỏ qua dòng chú thích trong `.dev.vars.example`; Sync fork có tự deploy lại.

**AI làm / người quyết:** AI làm hết tới lúc có thư mục public chạy xanh + bản thử trên workers.dev; **chủ nhà đồng ý lần cuối trước khi tạo repo `mzavn/vi-nha` và đẩy lên** (công khai, không rút lại được).

## Review kỹ thuật
Reviewer agent (subagent `reviewer`, 2026-10-08). Bắt buộc — đã sửa: (1) baseline đóng băng, không sinh lại; (2) specs public phải qua `specs:check`: chép `.claude/skills/mk-specs/`, xử lý link `plans/` và trích dẫn `test/migrations/`; (3) số sổ tiết kiệm thật còn trong specs, `check:private` chưa có số / id → AC-9; (4) `setup.mjs` không tương tác cho agent (đăng nhập tách riêng, account, subdomain, mật khẩu qua stdin). Nên — đã nhận: dùng `wrangler deploy` tự tạo D1 / KV (tên KV `vi-nha-oauth-kv`), danh sách cho phép thêm `.gitignore` / lock + đồng bộ kiểu gương + quét toàn cây đích, baseline mang số `0030`, Node 22.13 cho test + CI, đo CPU màn Thiết lập nhiều mật khẩu, phương án nếu `workers.dev` chặn webhook. Đề xuất thử nút Deploy trên repo public tạm: không làm — nội dung y hệt bản thật nên lộ y hệt; thử ngay trên `mzavn/vi-nha` sau khi chủ nhà duyệt.

## Việc cần làm
- [x] Review kỹ thuật; commit propose
- [x] Code: `publish/`, `scripts/publish-public.mjs`, `scripts/setup.mjs`, `docs/cai-bang-ai.md`, check-private theo thư mục
- [x] Dựng thư mục public cục bộ, chạy xanh (AC-1, AC-2, AC-6)
- [x] Bản thử trên workers.dev bằng `npm run setup` (AC-3, AC-7), xoá sau khi thử — 2026-10-08: `setup.mjs --name vi-nha-thu --yes` từ thư mục public, 20 s, thoát 0 (deploy tự tạo D1 + KV, migration `0030_baseline` chạy, mật khẩu chung đặt qua stdin). `POST /v1/setup` với 3 người có mật khẩu riêng → 201; đăng nhập mật khẩu riêng 200, sai 401; webhook không khóa 401; `/mcp` không token 401; metadata OAuth đúng issuer. CPU 9 request: max 21,1 ms, P50 10,8 ms, 0 lỗi (không bị chặn vượt CPU) — giữ màn Thiết lập nhận mật khẩu riêng cho cả 3 người. Chưa thử: ghi khoản chi trên giao diện bản thử. Đã xoá Worker, D1, KV.
- [x] Chủ nhà đồng ý → tạo `mzavn/vi-nha`, đẩy `v1.0.0` — 2026-10-08 (chủ nhà: "Đẩy ngay"; tác giả commit "MZA", skill mk-specs ghi công MZA trỏ org). Repo public, AGPL-3.0, bật báo lỗ hổng riêng, release v1.0.0; CI lần đầu xanh (npm ci, test, typecheck, specs:check).
- [ ] Hai đồng nghiệp thử nút Deploy / AI (AC-4, AC-5)
- [ ] Hợp nhất: UC-509 + History, ADR, BR-14; archive
- [ ] Cập nhật tài liệu: GitBook (trang "Cài Ví nhà cho nhà bạn": ba cách), README private
