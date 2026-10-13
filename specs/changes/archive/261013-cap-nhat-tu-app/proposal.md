# 261013-cap-nhat-tu-app: Cập nhật bản mới từ trong app — app báo có bản mới, bấm Cập nhật chạy workflow GitHub trong repo của nhà
- Status: archived
- BR: BR-14 (nháp)
- Đụng tới: UC-709 (pwa) — Cài đặt › Nâng cao, phần mới **Cập nhật Ví nhà**; UC-503 (access) — CSP `connect-src`; bản công khai (`publish/`, `scripts/`) — workflow cập nhật cho bản cài bằng nút Deploy, phát hành tạo GitHub Release; tài liệu cập nhật (README public, `docs/cai-bang-ai.md`, GitBook)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-13 (giao việc trực tiếp, chat: "làm theo cách A đi, viết thêm hướng dẫn trong doc") · Người duyệt kỹ thuật: reviewer agent, 2026-10-13, approve with changes — đã sửa
- Commit: propose `68e4fca` · code `ae0f0b5` · merge (commit này)

## Vì sao

Đồng nghiệp đã cài Ví nhà bằng nút **Deploy to Cloudflare**. Muốn lên bản mới, họ phải tự kéo code từ `mzavn/vi-nha` về repo
GitHub của mình. Nút Deploy tạo một repo **chép** (không phải fork), nên GitHub không có nút **Sync fork**. Cloudflare còn ghi
cấu hình riêng của nhà (tên Worker, id D1 / KV) vào `wrangler.jsonc` của repo đó, nên `git pull` dễ xung đột. README public
(dòng "Sync fork nếu repo là fork") và GitBook (`bat-dau/cai-vi-nha.md` › Cập nhật bản mới) đang chỉ đường không dùng được.

> "goal mong muốn của tôi là trong app họ deploy rồi -> click update là tự kéo code mới về cho case này"
> "làm theo cách A đi, viết thêm hướng dẫn trong doc của doc-vinha nhé"

Cách A (chủ nhà chọn 2026-10-13, giữa ba cách): app chỉ **báo** có bản mới và mở trang workflow trên GitHub. Người cài bấm
**Run workflow**, workflow kéo bản mới vào repo, Cloudflare tự build, nâng database và deploy. Không lưu token nào trong app.
Bị loại: B (token GitHub ghi được repo lưu trong Worker — lộ token là đẩy được code lên Worker giữ sổ tiền); C (Worker tự deploy
qua API Cloudflare — token quyền rộng, code chạy lệch repo).

## Thay đổi spec

### UC-709 (pwa)
- Main Flow bước 2: hàng Nâng cao thêm "Cập nhật Ví nhà"; phần **Cập nhật Ví nhà** đứng cuối Nâng cao (sau Nhật ký thay đổi). Cài đặt không tải được (`GET /v1/settings` lỗi) thì phần này vẫn hiện dưới thanh lỗi — bản lỗi vẫn cập nhật được.
- MODIFIED AC-15: danh sách phần trong Nâng cao thêm "Cập nhật Ví nhà" (cuối).
- ADDED AC-30: Phần Cập nhật Ví nhà báo có bản mới và chỉ đúng cách cập nhật theo cách đã cài
  - Given app chạy bản `1.0.1`; bản phát hành mới nhất (GitHub Release) của `mzavn/vi-nha` là `v1.1.0`
  - When mở Cài đặt › Nâng cao › **Cập nhật Ví nhà**, bấm **Kiểm tra bản mới**
  - Then app hỏi GitHub **chỉ khi bấm** (không tự hỏi nền), rồi hiện "Có bản mới 1.1.0." + link **Xem có gì mới** (`https://github.com/mzavn/vi-nha/releases/tag/v1.1.0`, tab mới), và:
    - app được Cloudflare build từ repo GitHub `an/vi-nha` (cài bằng nút Deploy): nút **Cập nhật** mở `https://github.com/an/vi-nha/actions/workflows/update.yml` ở tab mới, kèm "Trên GitHub bấm Run workflow, rồi bấm Run workflow lần nữa. Vài phút sau Cloudflare cài xong bản mới."
    - Cloudflare build nhưng không biết repo GitHub: "Mở repo Ví nhà của bạn trên GitHub › Actions › Cập nhật Ví nhà › Run workflow."
    - build trên máy (cài bằng `npm run setup` / nhờ AI): "Trong thư mục vi-nha trên máy, chạy:" + `git pull --autostash && npm ci && npm run deploy`
    - cả ba kèm link **Hướng dẫn cập nhật** (GitBook `bat-dau/cap-nhat-vi-nha`, tab mới)
  - Bản mới nhất bằng hoặc cũ hơn → "Đang dùng bản mới nhất (1.0.1)."; so theo số (`1.10.0` mới hơn `1.9.0`; tag có hay không có `v` đều được); tag không phải `X.Y.Z`, GitHub lỗi hay mất mạng → "Chưa kiểm tra được. Thử lại sau." (bấm lại được); offline → nút tắt; bản phát triển (không có phiên bản) → "Bản phát triển — cập nhật bằng git." và không có nút Kiểm tra.
- ADDED AC-31: Tên repo lấy lúc build chỉ là `chủ/tên` GitHub, không bao giờ mang khoá
  - Given lúc build trên Cloudflare (`WORKERS_CI=1`), remote `origin` là `https://x-access-token:abc@github.com/an/vi-nha.git` / `git@github.com:an/vi-nha.git` / `ssh://git@github.com/an/vi-nha` / `https://github.com/an/vi-nha` / `https://gitlab.com/an/vi-nha.git` / `https://github.com/an/vi-nha/../x` / không có remote
  - Then repo là `an/vi-nha` ×4 / không có / không có / không có; chỉ nhận `chủ` `[A-Za-z0-9-]` và `tên` `[A-Za-z0-9._-]`; build không trên Cloudflare luôn là "build trên máy" và không đọc remote.

### UC-503 (access)
- Main Flow bước 0: CSP `connect-src` thêm `https://api.github.com` (nút Kiểm tra bản mới, UC-709 AC-30). Worker và `web/public/_headers` vẫn giống hệt (test có sẵn).

### Bản công khai — workflow cập nhật (AC của change, test bằng script)
Hợp đồng cố định (repo nhà giữ mãi bản `update.yml` đầu tiên — mọi bản script sau phải chạy được với nó): YAML chỉ có bước `run:`,
không `uses:`; gọi đúng `node "$RUNNER_TEMP/update.mjs"` (không tham số) trong thư mục repo nhà, script lấy từ
`scripts/update-from-upstream.mjs` của nhánh `main` `mzavn/vi-nha`; script một file, chỉ dùng `node:*`; mã thoát 0 = xong (có
hoặc không có commit mới), khác 0 = lỗi, không commit. Workflow push khi `HEAD` khác nhánh trên GitHub.

- AC-U1 (áp bản mới): script lấy tag `vX.Y.Z` cao nhất của `mzavn/vi-nha` (`git ls-remote --tags` — không gọi API GitHub, khỏi vướng giới hạn lượt của máy Actions dùng chung IP; tag chỉ có ở bản đã phát hành; tham số `<tag>` / `--from <repo>` chỉ để thử), `fetch` đúng tag đó, rồi làm mọi file (trừ `.github/` và `wrangler.jsonc`) giống hệt tag: thêm file mới, sửa file đổi, **xoá** file tag không còn; `.github/` để nguyên (token Actions không được sửa workflow); một commit "chore: cập nhật Ví nhà lên vX.Y.Z" tên `github-actions[bot]`. Bản trên GitHub bằng bản đang có → "Đã là bản mới nhất (X.Y.Z).", không commit; cũ hơn → "Bản trên GitHub (…) cũ hơn bản đang có (…) — không cập nhật.", không commit (code cũ không chạy trên database đã nâng).
- AC-U2 (giữ cấu hình Cloudflare của nhà): `wrangler.jsonc` = bản của tag + giữ từ bản của nhà: `name`, `account_id`, `routes`, `route`, `workers_dev`, `database_name` / `database_id` của D1 cùng `binding`, `id` của KV cùng `binding`; ghi ra JSON (mất chú thích). `wrangler.jsonc` của nhà không có / đọc không được (nhận chú thích `//` `/* */`, dấu phẩy thừa) → thoát 1 "Không đọc được wrangler.jsonc của repo — chưa cập nhật.", không đổi file nào, không commit (lùi về bản của tag có thể làm Worker gắn một D1 trống).
- AC-U3 (workflow): `.github/workflows/update.yml` tên "Cập nhật Ví nhà", chỉ `workflow_dispatch`, `permissions: contents: write`, `concurrency` một lượt; job chỉ chạy khi repo không phải `mzavn/vi-nha` **và** đang ở nhánh mặc định; token chỉ có trong lệnh clone và push (`http.extraheader` theo lệnh, không lưu vào `.git/config`), bước chạy script không có token.
- AC-U4 (phát hành): `publish-public.mjs --push` sau khi push tạo GitHub Release cho tag (nội dung = mục CHANGELOG của bản đó) bằng `gh`; Release đã có thì bỏ qua; không có `gh` → báo "chưa tạo Release — tạo tay", vì nút Kiểm tra bản mới trong app chỉ thấy bản đã có Release.
- AC-U5 (thử thật, sau khi phát hành): bản cài bằng nút Deploy ở bản cũ hơn, thêm `update.yml`, bấm Run workflow → repo có commit mới → Cloudflare build (build → migrate → deploy) → tải lại app, Cài đặt › Nâng cao › Cập nhật Ví nhà ghi bản mới; dữ liệu còn nguyên.
- AC-U6 (tài liệu): README public "Cập nhật bản mới" và GitBook trang **Cập nhật Ví nhà** (nút trong app; bản cài trước khi có workflow thêm `update.yml` một lần qua giao diện GitHub; cài bằng lệnh; sao lưu: cài bằng lệnh thì `wrangler d1 export`, cài bằng nút Deploy thì D1 Time Travel tự giữ 7 ngày (gói Free) — khôi phục cần chạy lệnh; tải lại app sau khi cài; sửa riêng trong code bị ghi đè; chỉ hỗ trợ repo GitHub); bỏ hướng dẫn "Sync fork"; lệnh cập nhật bản cài bằng lệnh đổi thành `git pull --autostash && npm ci && npm run deploy` (setup ghi `account_id` vào `wrangler.jsonc` nên `git pull` trần bị chặn).

## Quyết định

**ADR nháp — Cập nhật bản cài bằng nút Deploy qua workflow GitHub của chính repo nhà, app chỉ báo và dẫn đường.** Nới ADR-89
(CSP thêm `https://api.github.com` ở `connect-src`).
Bối cảnh: Worker không có git, không có quyền ghi repo của nhà; nút Deploy tạo repo chép (không fork, lịch sử riêng) và ghi
cấu hình Cloudflare vào `wrangler.jsonc`. Quyết định: workflow `workflow_dispatch` dùng `GITHUB_TOKEN` của Actions (chỉ sống
trong lượt chạy) **chép đè** cây của tag phát hành mới nhất (trừ `.github/`) và gộp `wrangler.jsonc` theo danh sách khoá của nhà;
app hỏi GitHub Release mới nhất khi người dùng bấm, rồi mở trang workflow. Mọi logic nằm trong script của bản mới; YAML cố định.
Bị loại: token GitHub lưu trong Worker (một chạm trong app, nhưng lộ token / chiếm phiên chủ hộ là đẩy được code); Worker tự
deploy qua API Cloudflare; `git merge` bản mới (repo chép không chung lịch sử → xung đột ở mọi file đã đổi); kéo `main` thay vì
Release (app và workflow lệch nguồn); tự chạy theo lịch (chủ nhà chưa chọn — thêm `schedule` sau là đủ); app tự hỏi GitHub nền.
Hệ quả: sửa riêng trong code của repo nhà bị ghi đè khi cập nhật (trừ `.github/` và các khoá cấu hình kể trên); workflow của bản
sau không tự tới repo nhà; tên `chủ/repo` GitHub nằm trong JS của app (file tĩnh, ai biết địa chỉ app đều đọc được) và lúc bấm
Kiểm tra, GitHub thấy IP và `Origin` (địa chỉ app) — chủ nhà có thể bỏ, khi đó app chỉ còn câu chỉ đường.

## Thiết kế

- `publish/.github/workflows/update.yml` (mới, chỉ ở bản public) theo hợp đồng trên.
- `scripts/update-from-upstream.mjs` (+ `.d.mts` cho test): `parseJsonc`, `mergeWranglerConfig`, `compareVersions`, `applyRelease`, có test (repo git tạm); chạy chính: đọc `wrangler.jsonc` + `package.json`, `git ls-remote --tags` lấy tag cao nhất, `git fetch --depth=1 <from> refs/tags/<tag>`, `git restore --source=FETCH_HEAD --staged --worktree -- . ':(exclude).github' ':(exclude)wrangler.jsonc'` (no-overlay: xoá file không còn), ghi `wrangler.jsonc`, commit. `compareVersions` lặp ở web (script phải một file, không import TS).
- `scripts/publish-public.mjs`: `--push` → `gh release create` (AC-U4).
- `web/src/lib/install-info.ts` (mới, không import gì — chạy lúc build): `githubRepo`, `installInfo(ci, readRemote)`; test `install-info.test.ts`. `web/src/lib/app-update.ts` (mới): `compareVersions`, `releaseTag`, `updateView`, `LATEST_RELEASE_API`, `UPDATE_COMMAND`, `UPDATE_GUIDE_URL`; test `app-update.test.ts`. `web/vite.config.ts` define `__INSTALL__` từ `installInfo`; `web/src/vite-env.d.ts` khai kiểu.
- `web/src/screens/settings.tsx`: `SECTIONS` thêm `app-update` (advanced), `AppUpdate`; hàng Nâng cao nhắc "bản mới"; nhánh lỗi tải cài đặt cũng hiện `AppUpdate`.
- `src/security-headers.ts`, `web/public/_headers`: `connect-src` thêm `https://api.github.com`.
- Tài liệu: `publish/README.md`, `publish/CHANGELOG.md` (mục `v1.1.0` — chủ nhà giao "làm luôn", số bản theo SemVer: thêm tính năng tương thích ngược → tăng Y), `docs/cai-bang-ai.md`; GitBook (repo tài liệu): trang mới `bat-dau/cap-nhat-vi-nha.md`, `SUMMARY.md`, mục Cập nhật ở `bat-dau/cai-vi-nha.md` trỏ sang, `cai-dat/README.md`, `cai-dat/may-nay.md`; công cụ chụp ảnh thêm chủ đề `cap-nhat`.
- Không đổi DB, không migration.
- Chưa kiểm chứng (AC-U5): push của `GITHUB_TOKEN` có kích hoạt Workers Builds không (GitHub chỉ chặn push đó tạo **lượt chạy workflow**; Workers Builds nhận webhook qua GitHub App) [INFERENCE]; Workers Builds có `.git` để đọc remote không [INFERENCE] — không có thì rơi về câu chỉ đường; repo chép mới có bật Actions không [INFERENCE].
- AI làm / người quyết: AI làm code, test, tài liệu; chủ nhà chốt số phiên bản, lúc phát hành, có giữ tên repo trong app không (Hệ quả ADR), rồi nhờ đồng nghiệp thử AC-U5.

## Review kỹ thuật
Reviewer agent (subagent `reviewer`, 2026-10-13): approve with changes. Bắt buộc — đã sửa: (B1) `wrangler.jsonc` của nhà thiếu /
hỏng thì dừng, không lùi về bản upstream (có thể gắn D1 trống) → AC-U2; (B2) `update.yml` nằm mãi ở repo nhà → hợp đồng cố định,
YAML không `uses:`, logic vào script, token không có ở bước chạy script → AC-U3; (B3) app hỏi Release còn workflow kéo `main`,
phát hành không tạo Release → workflow kéo tag Release, phát hành tạo Release → AC-U1, AC-U4; (B4) `git pull` trần hỏng vì setup
ghi `account_id` → `git pull --autostash && npm ci && npm run deploy`; (B5) thiếu UC-503 và AC-15 → đã thêm, ADR nới ADR-89.
Nên — đã nhận: GitLab không chỉ sang Actions, lọc `chủ/tên` chặt + `ssh://` (N1); riêng tư ghi vào Hệ quả ADR, chủ nhà quyết (N2);
nhánh mặc định, `concurrency`, từ chối bản cũ hơn (N3); bỏ gộp `vars` và nhánh chép nguyên văn (N4); sao lưu bằng Time Travel
cho nút Deploy (N5); phần Cập nhật hiện cả khi cài đặt lỗi, nhắc tải lại app (N6); `installInfo` thuần, `vite-env.d.ts`, tag lạ
→ "Chưa kiểm tra được", link release dựng từ tag (N7). Không nhận: test đọc chữ trong `update.yml` (test chữ nguồn, không bắt
hành vi — kiểm bằng mắt lúc review và thử thật AC-U5).

## Việc cần làm
- [x] Review kỹ thuật
- [x] Test cho AC-30, AC-31, AC-U1, AC-U2 (đỏ trước khi code)
- [x] Code: script, workflow, phát hành tạo Release, vite define, `app-update.ts`, `install-info.ts`, phần Cài đặt, CSP
- [x] Tài liệu: README public, CHANGELOG (mục "Chưa phát hành"), `docs/cai-bang-ai.md`, GitBook (trang mới + ảnh `cap-nhat-01-co-ban-moi`, chụp lại ảnh Cài đặt)
- [ ] Phát hành `v1.1.0` (chủ nhà giao làm luôn 2026-10-13), thử thật AC-U5 với đồng nghiệp
- [x] Hợp nhất: UC-709 (v30, AC-15 sửa, AC-30, AC-31), UC-503 (v10), ADR-109; archive
