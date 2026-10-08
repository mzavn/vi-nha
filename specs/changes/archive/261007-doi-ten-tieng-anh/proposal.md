# 261007-doi-ten-tieng-anh: Tên trong code, dữ liệu, đường dẫn bằng tiếng Anh; "Phao khẩn cấp" thành "Quỹ an tâm"
- Status: archived
- BR: BR-10, BR-05, BR-07
- Đụng tới: UC-107 (ledger), UC-103 (ledger), UC-506 (access), UC-505 (access), UC-601, UC-602 (mcp), UC-402 (notify), UC-702, UC-707, UC-709, UC-710, UC-711 (pwa), UC-1005 (receivable)
- Đóng: [DIVERGENCE] mcp UC-604 — mô tả `list_pending_logs` / `assign_log` ghi "Cần bank feed (phase 04) — chưa triển khai" (đóng lúc hợp nhất, UC-604 v7)
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-07, chat — xác nhận `buffer`, bảng địa chỉ màn, tên tool, mô tả tiếng Anh; "làm luôn đi", xong trước 02:00 · Người duyệt kỹ thuật: reviewer agent, 2026-10-07, approve with changes — đã sửa theo 7 ý
- Commit: propose `0a843d7` · code `7424f26` · merge `—`

## Vì sao

Bước đầu của việc mở mã nguồn (lộ trình và các quyết định: `plans/reports/researcher-261007-mo-ma-nguon.md` §3–§4, §5b, §7).

> "tôi muốn dùng thì tiếng việt, nhưng code thì chuẩn hóa tiếng Anh hết nè ? comment trong app tiếng việt được, var const các thứ, tên hàm thì eng"
> "đường dẫn của API/ route cũng dùng tiếng anh nhé, chuẩn hóa thế giới đi, vì sau này AI đọc dễ support users mà"
> "nên để là Quỹ an tâm thay cho Quỹ khẩn cấp nhé, ngôn từ khẩn cấp nó mang tính tai họa"
> "DB hiện tại có mỗi nhà tôi thôi"

Hiện trạng (kiểm 2026-10-07):
- Giá trị lưu DB trộn hai thứ tiếng: `wallets.tier ∈ holding | tichsan | tax | nice | must`, `accounts.role ∈ heo | phao | so-tiet-kiem` (`docs/schema.sql:139,150`); khoá `config.emergency_months`.
- API: `GET /v1/tichsan`; snapshot `tiers.tichsan`, `emergency`; tài sản ròng `tichsanCash`, `tichsanAccounts`; Cài đặt `emergency_months`.
- Địa chỉ màn PWA tiếng Việt (`web/src/lib/hash-route.ts:4-7`); lối tắt `/#nhap`, `/#gan` trong `web/public/manifest.webmanifest`.
- Tool MCP: tên chưa đều (`reconcile` chỉ đọc nhưng nghe như hành động, `allocate` không rõ chia gì…); mô tả tiếng Việt, hai tool còn ghi sai "bank feed chưa triển khai" (`src/mcp/tools.ts:105,122`).
- Khoảng 35 tên hàm / biến / kiểu tiếng Việt quanh `tichsan`, `heo`, `phao`; 4 file tên tiếng Việt.
- Chữ "Phao khẩn cấp" ở 13 chỗ trong giao diện, tin Telegram ("Phao x/y tháng", `src/notify/format.ts:182`), mô tả tool MCP; trùng chữ "phao" với tài khoản phao dự phòng (open risk số 2 của handoff 2026-10-07).
- Chỉ có một DB thật (nhà mình), chưa ai khác dùng: đổi giá trị lưu trữ bây giờ là rẻ nhất.

Không đổi: cách tính tiền, số liệu, mã ví / mã tài khoản / mã người do người dùng đặt (`tich-san`, `co-thi-tot`…), chữ tiếng Việt trên giao diện (trừ "Phao khẩn cấp"), chú thích, tên test, specs.

## Thay đổi spec

Bảng tên (chủ nhà chốt 2026-10-07). Giá trị lưu DB / API dùng `snake_case`; trường JSON và tên trong TypeScript dùng `camelCase` / `PascalCase` của cùng chữ.

| Giao diện | Cũ | Mới |
|---|---|---|
| Tích sản (phe) | `tichsan` | `wealth_building` |
| Heo đất (vai tài khoản) | `heo` | `piggy_bank` |
| Phao dự phòng (vai tài khoản) | `phao` | `buffer` |
| Sổ tiết kiệm (vai tài khoản) | `so-tiet-kiem` | `term_deposit` |
| Quỹ an tâm (ngưỡng = số tháng × chi Must) | `emergency`, `emergency_months` | `safetyFund`, `safety_fund_months` |

`phao` → `buffer`, không phải `reserve` như bảng chủ nhà duyệt: `reserve` đã là tên của "ví quỹ giữ riêng" (`isReserve`, snapshot `reserves` — `src/domain/types.ts:93`, `src/domain/snapshot.ts:190`); dùng lại sẽ thành hai thứ một tên. `buffer` là phương án dự phòng chủ nhà đã nêu ("reserve (hoặc buffer)"); chủ nhà xác nhận 2026-10-07.

### UC-107 (ledger): Theo dõi tích luỹ
- ADDED AC-11: Given DB dựng tới migration 0027 có đủ loại cũ — ví `tichsan`, tài khoản `heo` (khoá), `phao`, `so-tiet-kiem` (khoá), giao dịch Tích sản, bỏ heo, mua tài sản, chi Must đủ 3 tháng, `config.emergency_months = 4` (dữ liệu mẫu, theo kiểu `prodLikeDb` của `test/heo-dat.test.ts`), When chạy migration đổi tên, Then: số dòng mọi bảng không đổi; `wallets.tier` thành `wealth_building`, `accounts.role` thành `piggy_bank` / `buffer` / `term_deposit`; `config.safety_fund_months = 4`, không còn `emergency_months`; snapshot (số dư từng ví, Tích sản tiền mặt / tài sản, Quỹ an tâm `cash` / `target` / `monthsCovered`), số dư sổ từng tài khoản và bảng Tích sản chi tiết **bằng đúng** trước migration (so theo tên mới); `PRAGMA foreign_key_check` rỗng.
- ADDED AC-12: Given DB mới chạy hết migration từ 0001, When đọc schema, Then CHECK của `wallets.tier` là `holding | wealth_building | tax | nice | must`, của `accounts.role` là `piggy_bank | buffer | term_deposit` (giữ luật cũ: `piggy_bank` / `term_deposit` chỉ khi `locked = 1`, `buffer` chỉ khi `locked = 0`); ghi `tichsan` hoặc `heo` bị từ chối.
- MODIFIED AC-6: `GET /v1/tichsan` → `GET /v1/wealth-building`, cùng nội dung; loại nguồn `heo` → `piggy_bank` (và `buffer`, `term_deposit` theo vai). `GET /v1/tichsan` → 404 như mọi đường dẫn không có.
- MODIFIED: mọi AC nhắc `tichsan` / `heo` / `phao` / `so-tiet-kiem` / `emergency` đổi theo bảng tên; số liệu kỳ vọng giữ nguyên.

### UC-103 (ledger), UC-1005 (receivable): Snapshot, tài sản ròng
- MODIFIED: snapshot `tiers.tichsan` → `tiers.wealth_building`; `emergency` → `safetyFund` (cùng các trường `cash`, `target`, `months`, `monthsCovered`, `pct`, `estimated`); tài sản ròng `tichsanCash` → `wealthBuildingCash`, `tichsanAccounts` → `wealthBuildingAccounts`. Giá trị không đổi.

### UC-505, UC-506 (access): Cấu hình
- MODIFIED: `GET /v1/settings` và `PUT /v1/settings/config` dùng `safety_fund_months` thay `emergency_months` (cùng luật 1..36, mặc định 6); gửi `emergency_months` → bị bỏ qua như trường lạ.
- MODIFIED: `role` của tài khoản nhận `piggy_bank | buffer | term_deposit | null`; giá trị cũ → 400 `invalid_input`.

### UC-601, UC-602 (mcp): Tool
- MODIFIED UC-601 AC-6: danh sách đúng 16 tên: `add_tenant_shared_expense, add_transaction, allocate_income, assign_log, get_budget, get_debts, get_goals, get_receivables, get_reconciliation, get_snapshot, get_spending_by_category, list_categories, list_pending_logs, list_tenants, list_transfer_orders, preview_allocation`. Đổi tên: `reconcile` → `get_reconciliation`, `spend_by_category` → `get_spending_by_category`, `allocate` → `allocate_income`, `get_tenants` → `list_tenants`, `add_tenant_paid_for_us` → `add_tenant_shared_expense`. Tham số và kết quả không đổi (trừ tên trường theo bảng tên).
- ADDED UC-602 AC-5: When `tools/list`, Then mô tả của mọi tool không còn "chưa triển khai" / "phase 04" (hiện ở `src/mcp/tools.ts:105,122`), không nhắc tên tool cũ, không còn chữ `tichsan` / "phao khẩn cấp"; dòng tóm tắt trả cho người đọc ("Còn để chi tuần này: …") giữ tiếng Việt. (Mô tả viết tiếng Anh theo ADR ngôn ngữ — kiểm khi review, không phải AC.)

### UC-711 (pwa): Điều hướng
- MODIFIED AC-6, AC-11: địa chỉ màn:

| Màn | Cũ | Mới |
|---|---|---|
| Hôm nay | `#homnay` | `#today` |
| Nhập | `#nhap` | `#entry` |
| Gán | `#gan` | `#assign` |
| Ví & quỹ | `#vi` | `#wallets` |
| Sổ giao dịch | `#so` | `#ledger` |
| Cài đặt | `#cai-dat` | `#settings` |
| › Ngân sách / Tích sản / Tài khoản / Phân tích / Chuyển tiền / Người thuê / Nợ | `#vi/ngansach` … `#vi/no` | `#wallets/budget`, `/wealth-building`, `/accounts`, `/analysis`, `/transfers`, `/tenants`, `/debts` |

- ADDED AC-12: Given địa chỉ cũ (`#nhap`, `#vi/tichsan`…), When mở app, Then về Hôm nay như mọi địa chỉ lạ (không giữ địa chỉ cũ song song). Lối tắt trong manifest là `/#entry`, `/#assign`.

### UC-710 (pwa): Mở app khi mất mạng
- ADDED AC-11: Given máy đang giữ snapshot / bootstrap / settings lưu từ bản trước (cache API của service worker và cache IndexedDB), When bản mới chạy lần đầu (kể cả khi mất mạng), Then không dùng bản lưu cũ: service worker xoá cache API khi đổi phiên bản; cache IndexedDB gắn phiên bản dữ liệu, khác phiên bản thì bỏ. Mất mạng mà không còn bản lưu hợp lệ → màn "chưa có dữ liệu" như lần đầu, **không** lỗi trắng màn. Hàng đợi ghi offline giữ nguyên và vẫn gửi được (chỉ mang mã ví / mã tài khoản / `meaning`, không mang `tier` / `role`).

### UC-702, UC-707, UC-709 (pwa), UC-402 (notify): Chữ "Quỹ an tâm"
- MODIFIED: mọi chỗ "Phao khẩn cấp" / "phao khẩn cấp" trên giao diện và trong tin nhắn thành "Quỹ an tâm"; dòng tin sáng "Phao x/y tháng" → "Quỹ an tâm x/y tháng"; ô Cài đặt "Phao khẩn cấp (số tháng)" → "Quỹ an tâm (số tháng)". "Phao dự phòng" (vai tài khoản) giữ nguyên chữ.

### Entity
- `wallets.tier`, `accounts.role`, `config.safety_fund_months`: như bảng tên; nghĩa, luật đặt giá trị, thời điểm không đổi (BR-07). View `v_tichsan` → `v_wealth_building`, `v_emergency_fund` → `v_safety_fund`.
- Bản ghi lịch sử không viết lại: `audit_log`, `notifications.payload` giữ chữ cũ đã ghi.

## Quyết định

**ADR nháp — Ngôn ngữ trong mã nguồn.**
- Tiếng Việt: chữ trên giao diện, tin nhắn, thông báo lỗi trả cho người, chú thích, tên test, specs.
- Tiếng Anh: tên biến / hằng / hàm / kiểu / file, giá trị lưu DB, tên trường API, đường dẫn API, địa chỉ màn PWA, tên và mô tả tool MCP.
- `docs/glossary.md` là bảng tra Việt ↔ Anh; `AGENTS.md` §5 thêm luật này.
- Loại: (1) giữ giá trị cũ, chỉ code mới tiếng Anh + bảng tra — chủ nhà muốn chuẩn hoá hết; (2) chỉ đổi tên TypeScript, giữ giá trị DB / API — một thứ có hai tên; (3) `profit` cho Tích sản — tiếng Anh hiểu là lợi nhuận, sai nghĩa; (4) `reserve` cho phao — trùng "ví quỹ giữ riêng".
- Hệ quả: một migration dựng lại hai bảng trên dữ liệu thật; kết nối Claude phải duyệt lại quyền tool sau khi đổi tên; bookmark địa chỉ cũ rơi về Hôm nay.

**ADR nháp — "Quỹ an tâm".** Ngưỡng `số tháng × chi Must trung bình` gọi là Quỹ an tâm trên giao diện và tin nhắn; trong code `safetyFund`. Lý do: chủ nhà — "khẩn cấp" mang nghĩa tai hoạ. Hết trùng chữ "phao" với tài khoản phao dự phòng. Loại: "Quỹ khẩn cấp".

## Thiết kế

**Migration `0028_english_names.sql`** (v1.27 → v1.28). Sao lưu D1 prod trước (`wrangler d1 export … --output .wrangler/backups/before-0028-<ngày>.sql`).
- `PRAGMA defer_foreign_keys = true` (D1 luôn bật khoá ngoại; `wallets`, `accounts` bị `allocations`, `categories`, `transactions`, `rules`, `bank_logs`, `cash_counts`, `transfer_orders`, `income_stream_locks`… trỏ tới). File migration **không** ghi `BEGIN` / `COMMIT` (D1 remote tự bọc mỗi migration trong một transaction và từ chối lệnh transaction trong file).
- Bảng phụ thuộc (đọc từ bản export prod 2026-10-07): view đọc thẳng hai bảng — `v_wallet_balance`, `v_goal_progress`, `v_tichsan`, `v_must_monthly_avg`, `v_emergency_fund`, `v_account_book`, `v_account_tx_from_logs`, `v_account_logs` (và các view đọc lại chúng, như `v_reconcile`); chỉ mục `idx_acct_no`; **không** có trigger nào trên hay nhắc tới hai bảng.
- Thứ tự (đã diễn tập): xoá các view → cất bản đã đổi giá trị (`CREATE TABLE _m0028_accounts AS SELECT … CASE role …`, `_m0028_wallets` tương tự) → `DROP TABLE wallets`, `DROP TABLE accounts` → `CREATE TABLE accounts` / `wallets` **cùng tên** với CHECK mới → `INSERT … SELECT` từ bản cất → xoá bản cất → tạo lại `idx_acct_no` → tạo lại view (tên mới cho `v_wealth_building`, `v_safety_fund`).
- **Không** dùng cách "tạo `accounts_new`, chép, xoá bảng cũ, `ALTER TABLE … RENAME`": diễn tập cho thấy hỏng `FOREIGN KEY constraint failed` lúc COMMIT — xoá bảng cha làm tăng bộ đếm vi phạm hoãn, đổi tên không làm nó giảm. Chèn dòng vào bảng cha **cùng tên** sau khi xoá thì bộ đếm giảm về 0. Cùng tinh thần migration 0014 (cất tạm).
- `UPDATE config SET k = 'safety_fund_months' WHERE k = 'emergency_months'`; `schema_version = '1.28'`.
- Không sửa nội dung các migration đã chạy (0007, 0020, 0024 vẫn ghi `tichsan` / `heo` — trên DB mới chúng chạy trước 0028).
- `docs/schema.sql` cập nhật y hệt; `docs/seed.sql` đổi sang giá trị mới (`docs/seed.sql:17` đang ghi `tichsan` — CHECK mới sẽ từ chối khi `test/schema.test.ts:38-40` nạp nó); bỏ assert `migrations/0002_seed.sql` bằng y `docs/seed.sql` (`test/schema.test.ts:45`) vì 0002 phải giữ giá trị cũ. `test/schema.test.ts` phải xanh.
- **Test harness:** `test/helpers/d1-sqlite.ts:10-13` chạy từng migration ở autocommit → `defer_foreign_keys` không có tác dụng, 0028 sẽ đỏ (reviewer thử bằng `node:sqlite` 3.51; diễn tập của em cũng hỏng khi không bọc transaction). Sửa: helper `applyMigrations(db, until?)` bọc **mỗi** file trong `BEGIN … COMMIT` — giống D1 — và mọi vòng chạy migration riêng trong test (`test/schema.test.ts:77,98,118,158,180,196`, `test/heo-dat.test.ts:22-32`) dùng helper này.
- **Diễn tập trước:** export prod → nạp vào SQLite local → chạy 0028 → so số dòng, số dư, Tích sản, Quỹ an tâm trước / sau (AC-11). Chỉ chạy prod khi diễn tập khớp. **Đã chạy bản nháp 2026-10-07** (script tạm ngoài repo, SQLite 3.51, bản export prod v1.27): số dòng mọi bảng, `v_wallet_balance`, `v_account_book`, `v_reconcile`, `v_goal_progress`, Tích sản, Quỹ an tâm (cash, target) đều khớp; `PRAGMA foreign_key_check` rỗng; `safety_fund_months` = 6 như cũ; sau migration tier `wealth_building` ×1, role `piggy_bank` ×2, `buffer` ×1; CHECK mới từ chối `tichsan`. Lúc apply chạy lại bằng `wrangler d1 migrations apply --local` trên bản export (đúng engine D1) trước khi chạy prod.

**Code** (không đổi logic):
- `src/domain/types.ts`, `src/domain/snapshot.ts`, `src/domain/entry.ts`, `src/domain/allocation.ts`, `src/services/ledger.ts`, `src/services/settings.ts`, `src/services/push.ts`, `src/routes/v1.ts`, `src/notify/format.ts`, `src/mcp/tools.ts`; `web/src/lib/*`, `web/src/screens/*`, `web/src/ui/shell.tsx`, `web/src/lib/hash-route.ts`, `web/public/manifest.webmanifest`.
- Đổi tên file: `web/src/lib/tichsan.ts` → `wealth-building.ts`, `tichsan-accounts.ts` → `wealth-building-accounts.ts` (+ test), `test/heo-dat.test.ts` → `test/piggy-bank.test.ts`, `test/phao.test.ts` → `test/buffer.test.ts`. Đổi tên file test ở commit riêng, sửa dòng `Tests:` trong specs cùng lúc để `specs:check` không đỏ.
- Đổi tên định danh bằng LSP rename. **Chuỗi literal LSP không bắt — sửa tay, đã liệt kê:** URL đẩy trong push `/#homnay`, `/#vi`, `/#gan`, `/#cai-dat` (`src/services/push.ts:39-45`, test `test/push.test.ts:298,322,417,477-479`); `location.hash === "#nhap"` (`web/src/ui/shell.tsx:79`); SQL `kind IN ('heo','phao','so-tiet-kiem')` (`src/services/ledger.ts:1039`), `tier 'tichsan'` (`src/services/settings.ts:362,366,376`), `v_tichsan` / `v_emergency_fund` / `k = 'emergency_months'` (`src/services/ledger.ts:143,242,757-759,998`), `emergency_months` (`src/services/settings.ts:168,592-596`); khoá `TIER_GROUPS` (`web/src/lib/settings.ts:197`); view đọc khoá config (`docs/schema.sql:593`). Xong thì grep `tichsan|'heo'|"heo"|'phao'|"phao"|so-tiet-kiem|emergency|#homnay|#nhap|#gan|#cai-dat|#vi\b` trong `src/`, `web/`, `test/`, `docs/schema.sql` phải chỉ còn chữ tiếng Việt trên giao diện / chú thích — không phải test, là bước kiểm khi review.
- Cache: `web/sw.js` bước `activate` xoá thêm cache `vi-nha-api` khi `VERSION` đổi. `web/src/offline/idb.ts`: `indexedDB.open(DB_NAME, 2)` + `onupgradeneeded` xoá kho `cache` (giữ kho hàng đợi), và xoá luôn đường lùi localStorage `vi-nha:cache:*` (`idb.ts:118-131`) — `web/src/state/store.ts:349-360` vẽ snapshot lưu sẵn trước khi gọi mạng, nên bản cũ + code mới là trắng màn.
- Không cần sửa hàng đợi offline (kiểm: `web/src/offline/queue.ts` chỉ mang mã ví / tài khoản / `meaning`).

**Thứ tự deploy:** sao lưu D1 → `npm run build` → `wrangler versions upload` (chưa kích hoạt) → `npm run db:migrate:remote` → `wrangler versions deploy` ngay sau đó; làm lúc khuya, tránh phút :00 / :15 / :30 / :45 (cron). Khoảng hở giữa migrate và deploy chỉ vài giây; Worker cũ đọc `tichsan` trong khoảng đó sẽ lỗi — chấp nhận, nhà mình duy nhất. Kiểm `wrangler d1 migrations list --remote` không còn migration chờ → chủ nhà bấm "Tải bản mới" trên hai điện thoại → thêm lại / duyệt lại quyền tool trong Claude.

**Rủi ro:**
- Migration dựng lại bảng trên dữ liệu thật: giảm bằng diễn tập + sao lưu + D1 Time Travel 30 ngày.
- Bỏ sót một chỗ còn `tichsan` / `heo` / `phao` trong chuỗi so sánh (`=== "tichsan"`) → logic sai lặng lẽ. Giảm: TypeScript union type bắt phần lớn; rà bằng grep sau khi đổi; 770 test.
- Specs: khoảng 446 chỗ nhắc tên cũ — sửa cơ học khi hợp nhất; `specs:gen` + `specs:check` 0 lỗi.

**AI làm / người quyết:** AI viết migration, đổi tên, test, specs. Chủ nhà: xác nhận `buffer`; duyệt bảng địa chỉ màn và tên tool (đã "oke" 2026-10-07); chọn giờ chạy migration prod.

## Review kỹ thuật
Reviewer agent (subagent `reviewer`, 2026-10-07), kết luận: **approve with changes**. Đã xử lý:
1. Harness test chạy migration ở autocommit → 0028 đỏ: thêm helper `applyMigrations` bọc mỗi file trong transaction (Thiết kế › Test harness).
2. `docs/seed.sql` mâu thuẫn `test/schema.test.ts:38-45`: đổi seed sang giá trị mới, bỏ assert 0002 = seed.
3. Chuỗi literal LSP không bắt (push URL, `shell.tsx`, SQL): đã liệt kê + bước grep khi review.
4. AC-11 dựa vào bản export prod (có dữ liệu thật, không commit được): viết lại trên dữ liệu mẫu kiểu `prodLikeDb`; diễn tập trên export prod giữ ở Việc cần làm.
5. Cache: thêm đường lùi localStorage và cách nâng phiên bản IndexedDB.
6. UC-602 AC-5 "viết tiếng Anh" không kiểm được bằng máy: viết lại theo thứ quan sát được qua `tools/list`.
7. Khoảng hở deploy: `versions upload` → migrate → `versions deploy`, tránh phút cron.
Xác nhận của reviewer: va chạm `reserve` đúng (`src/domain/types.ts:93`); thiết kế cất tạm (không `RENAME`) đúng.

## Việc cần làm
- [x] Chủ nhà xác nhận `buffer`; review kỹ thuật
- [x] Commit propose (`0a843d7`)
- [x] Diễn tập migration trên bản export prod (AC-11)
- [x] Test cho từng AC mới / sửa (đỏ trước) → code → xanh (`7424f26`)
- [x] Sao lưu D1 → migrate prod → deploy (2026-10-07 23:01)
- [ ] Chủ nhà: "Tải bản mới" trên hai điện thoại → duyệt lại tool Claude
- [x] Hợp nhất: UC chính + `## History`, ADR-92, ADR-93 vào `decisions.md`, `docs/glossary.md`, `AGENTS.md` §5
- [x] `specs:gen`, `specs:check` 0 lỗi; chuyển thư mục sang `changes/archive/`
- [x] Cập nhật tài liệu: `README.md`, `docs/` (chữ "Quỹ an tâm", tên mới trong `docs/schema.sql`, `docs/core_design_rules.md`, `docs/DESIGN.md` nếu nhắc địa chỉ màn) và chữ trong hướng dẫn người dùng GitBook (repo hướng dẫn riêng): 9 trang có chữ "Phao khẩn cấp" / "phao" (17 lần "khẩn cấp") → "Quỹ an tâm"; dữ liệu mẫu `tools/demo-heo-dat.sql` ghi thẳng `role = 'heo'` → `piggy_bank`
- [x] Chụp lại ảnh hướng dẫn bằng `tools/chup-lai.sh` (185 ảnh, 2026-10-07; dữ liệu mẫu `demo-heo-dat.sql`, `seed-demo.mjs` đổi sang giá trị mới; docs repo commit `32818af`)
