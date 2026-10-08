# 261007-ma-tieng-anh-an-danh: Mã dữ liệu hệ thống tiếng Anh, hộ mẫu tiếng Anh, ẩn danh tên người
- Status: archived
- BR: BR-10, BR-08
- Đụng tới: UC-109 (ledger), UC-101 (ledger), UC-508 (access), UC-801 (rental), UC-901 (debt), UC-709 (pwa)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-07 (giao việc trực tiếp: "làm tiếp đi", "không dùng tên tiếng việt trong code") · Người duyệt kỹ thuật: reviewer agent, 2026-10-07, approve with changes — đã sửa theo 8 ý
- Commit: propose `56414fd` · code `21b9db0` · merge `—`

## Vì sao

Bước 1 của việc mở mã nguồn (lộ trình: `plans/reports/researcher-261007-mo-ma-nguon.md` §6–§7), sau Change 0 [`261007-doi-ten-tieng-anh`](../261007-doi-ten-tieng-anh/proposal.md).

> "viết lại 1 số phần UC dạng không nhắc đến tên ai cả, đích danh ai nè"
> "phần anh/ em hay gì cũng phải đổi nhé, không dùng tên tiếng việt trong code nhé ?"

Hiện trạng (kiểm 2026-10-07):
- Code đọc thẳng vài mã dữ liệu tiếng Việt: kết nối SePay mặc định `chinh` (`src/services/secrets.ts:62`, `web/src/lib/settings.ts:301`, `web/src/lib/types.ts:405`); danh mục `tra-no` (`DEBT_CATEGORY_ID`, `src/domain/entry.ts:14`, và `web/src/screens/assign.tsx:172`, `budget-sheets.tsx:121,156`), `cho-vay` (`LEND_CATEGORY_ID`, `entry.ts:16`). Nguồn cho thuê `cho-thue` không bị code so thẳng, nhưng nằm trong giá trị `config.rental_income_stream_id` (`migrations/0007_income_streams_rental.sql:117`, đọc ở `src/services/ledger.ts:41`, dùng ở `src/domain/entry.ts:227-229`).
- Mã mục màn Cài đặt là định danh code tiếng Việt: `vi-nap`, `tai-khoan`, `cho-thue`, `nguon-thu`, `ma-ck`, `thong-bao`, `thanh-vien`, `ket-noi`, `tham-so`, `nhat-ky`, `may-nay`, `thong-bao-may`… (`web/src/screens/settings.tsx:50-66`), có công cụ chụp ảnh GitBook bám theo.
- Bảng icon danh mục trong code khoá theo mã tiếng Việt của hộ mẫu **và của nhà mình** ("Danh mục thật của nhà", `web/src/ui/icons.tsx:232-262`), trong khi bảng `categories` đã có cột `icon` (đang `NULL` ở mọi dòng prod).
- 22 file test dựa vào hộ mẫu "anh/em" của `migrations/0002_seed.sql` (`anh`, `em`, `vcb-anh`, `tich-san`, `co-thi-tot`, `an`…); `docs/seed.sql` là bản chép của hộ mẫu đó.
- Tên người thật (chủ nhà, vợ, người thuê, người quen) và số dư thật trong specs, docs, test, vài placeholder giao diện.
- Prod (đếm 2026-10-07): sepay `chinh` và một kết nối riêng của vợ; nguồn thu `cho-thue`, `luong-chong`, `luong-vo`; danh mục `tra-no` và 16 danh mục khác; không có `cho-vay`.

Không đổi: cách tính tiền; mã do người dùng tạo (ví, tài khoản, danh mục, thành viên của từng nhà — là dữ liệu, sinh từ tên người dùng gõ); chữ tiếng Việt trên giao diện; migration cũ `0001…0028` (ở lại repo private, không sang public).

## Thay đổi spec

### Mã hệ thống code đọc thẳng (UC-508, UC-109, UC-901, UC-801)
- ADDED AC (UC-508): Given DB prod có kết nối SePay `chinh` và tài khoản trỏ vào nó, When chạy migration 0029, Then kết nối mang mã `default`, mọi tài khoản trỏ `default`; kết nối mặc định vẫn dùng được khoá `wrangler secret` dự phòng như trước (UC-508 hiện hành), không đổi hành vi gửi / nhận.
- ADDED AC (UC-109, UC-901): Given danh mục `tra-no` có giao dịch, rule trỏ vào, When chạy 0029, Then danh mục mang mã `debt-payment`, mọi giao dịch / rule / phí người thuê trỏ mã mới, số chi theo danh mục và số dư sổ nợ không đổi; khoản trả nợ ghi mới không chọn danh mục vẫn vào `debt-payment`. `cho-vay` → `lending` (prod không có dòng nào; DB mới / hộ mẫu dùng mã mới).
- ADDED AC (UC-801): Given prod có nguồn thu `cho-thue` (khoá chia, giao dịch, rule trỏ vào) và `config.rental_income_stream_id = 'cho-thue'`, When chạy 0029, Then nguồn mang mã `rental`, mọi bảng con và giá trị config trỏ `rental`; `GET /v1/rental` trả `incomeStreamId = 'rental'`; khoản thu có `tenant_id` không chọn nguồn ghi `income_stream_id = 'rental'`. Nếu `config.rental_shared_categories` có `tra-no` thì thành `debt-payment`.
- ADDED AC (UC-109): Given danh mục prod `icon` đang `NULL`, When chạy 0029, Then mỗi danh mục có trong bảng icon hiện hành (29 dòng `web/src/ui/icons.tsx:233-262`, test giữ bảng kỳ vọng riêng) mang đúng icon đó; dòng đã có icon không bị ghi đè. Sau đó code không còn bảng icon theo mã: `CategoryIcon` dùng `categories.icon` nếu là tên icon có thật, không thì icon nhãn (`tag`). Mọi `icon` trong `docs/seed.sql` và 0029 là tên icon có thật.
- ADDED AC (UC-508): sau 0029, `GET /v1/settings` trả kết nối đầu tiên `id = 'default'`; kết nối `default` chưa đặt khoá thì vẫn lấy `SEPAY_API_TOKEN` / `SEPAY_API_KEY` dự phòng (như `chinh` trước đây).
- ADDED AC: DB mẫu (`docs/schema.sql` + `docs/seed.sql`) qua `PRAGMA foreign_key_check` rỗng và mọi view chạy không lỗi.

### Hộ mẫu (không đổi hành vi — test và tài liệu)
- `docs/seed.sql` thành hộ mẫu mã tiếng Anh, tên hiển thị tiếng Việt (bảng dưới), **gồm cả dữ liệu hệ thống mà migration cũ sinh ra**: bộ rule mẫu của 0004, ví / danh mục / nguồn thu / khoá chia / config `rental_*` của 0007, mã ngân hàng của 0010 (`Vietcombank`, `Techcombank`, `MBBank` theo `src/domain/banks.ts`), config `notify_*` của 0011, `tz`, `split_days`, `safety_fund_months`, `currency`, kết nối `default` và `sepay_connection_id = 'default'` cho tài khoản bật SePay (0015). Test dựng DB bằng `docs/schema.sql` + `docs/seed.sql` (đúng mô hình bản public: một file schema + dữ liệu mẫu), không dựa vào dữ liệu do migration cũ sinh ra.
- `test/schema.test.ts` vẫn bảo đảm chuỗi migration `0001…` dựng ra đúng `docs/schema.sql` (cả `schema_version`). Test kiểm chính các migration cũ chuyển vào `test/migrations/`, chỉ ở repo private: các test theo mốc trong `test/schema.test.ts` (0010, 0012, 0014, 0015, 0022, 0023, 0024 — ghim `vcb-anh`, `chinh`, `heo`), phần migration của `test/piggy-bank.test.ts` (`prodLikeDb` với mã thật vì 0017/0019/0024 ghim mã đó), test 0028, và test migration của 0029. Phần hành vi của `test/piggy-bank.test.ts` (bỏ heo, rút heo, tài sản ròng) viết lại trên hộ mẫu mới, tạo tài khoản heo qua code.

| Loại | Mã mới (hiển thị) |
|---|---|
| Thành viên | `husband` (Chồng, chủ hộ), `wife` (Vợ) |
| Tài khoản | `vcb-husband` (VCB chính), `tcb-husband` (TCB Tích sản), `mb-husband` (MB Thuế), `vcb-wife` (VCB vợ), `cash-husband` (Tiền mặt chồng), `cash-wife` (Tiền mặt vợ) |
| Ví | `income` (Thu nhập), `wealth-building` (Tích sản), `tax` (Thuế), `fun-husband`, `fun-wife` (Chơi), `travel` (Du lịch), `housing` (Nhà ở), `food` (Ăn uống), `transport` (Đi lại), `utilities` (Điện nước mạng), `hometown` (Về quê), `nice-to-have` (Có thì tốt), `rental-income` (Thu cho thuê) |
| Danh mục | `housing`, `groceries`, `eating-out`, `utilities`, `fuel-parking`, `ride-hailing`, `vehicle`, `work-gear`, `health`, `fitness`, `parents`, `gifts`, `charity`, `lending`, `bank-fees`, `shopping`, `travel`, `hangouts`, `entertainment`, `debt-payment` (mỗi dòng có `icon`) |
| Nguồn thu | `salary-husband`, `salary-wife`, `rental` |
| Kết nối SePay | `default` |

### Ẩn danh
- Specs, docs, test, placeholder giao diện: không còn tên người thật, tên miền thật, số dư thật. Chủ nhà / vợ → "chủ nhà", "Chồng", "Vợ"; người thuê, người quen → tên mẫu; số dư thật → số mẫu tròn (giữ phép cộng trong cùng đoạn). Lời trích của chủ nhà giữ nội dung.
- `scripts/check-private.mjs` + `.private-names` (không commit) quét những thư mục sẽ lên public; `npm run check:private` phải sạch (trừ `test/migrations/` và migration cũ, vốn ở lại private).
- Placeholder giao diện (UC-709): tên người thật trong ô gợi ý thành "SePay của vợ", "Anh An", "cô Lan".
- Mã mục màn Cài đặt đổi sang tiếng Anh (định danh code, không phải dữ liệu, không cần migration): `wallets-allocation`, `accounts`, `rental`, `income-streams`, `transfer-codes`, `notifications`, `members`, `connections`, `parameters`, `audit-log`, `this-device`, `device-notifications`… (đủ danh sách khi làm); công cụ chụp ảnh GitBook (`tools/chup-anh.mjs`) sửa theo.

## Quyết định

**ADR nháp — Mã dữ liệu code đọc thẳng là mã hệ thống tiếng Anh; mã người dùng tạo là dữ liệu.** Code chỉ được nhắc tới mã hệ thống cố định (`default`, `debt-payment`, `lending`, `rental`); mọi thứ khác (ví, tài khoản, danh mục, người) là dữ liệu của từng nhà, sinh từ tên người dùng gõ, code không được khoá theo. Icon thuộc dữ liệu (`categories.icon`), không thuộc code.
- Loại: (1) giữ bảng icon theo mã trong code — khoá code vào dữ liệu của một nhà; (2) đổi mã mọi ví / danh mục / tài khoản của nhà mình sang tiếng Anh — không cần, là dữ liệu riêng, và tốn migration trên mọi bảng con; (3) giữ hộ mẫu "anh/em" — trái luật ngôn ngữ (ADR-92).

## Thiết kế

- **Migration `0029_system_ids.sql`** (v1.28 → v1.29), `PRAGMA defer_foreign_keys = true`, thứ tự:
  1. `UPDATE sepay_connections SET id='default' WHERE id='chinh'` → `UPDATE accounts SET sepay_connection_id='default' WHERE sepay_connection_id='chinh'`.
  2. `UPDATE categories SET id='debt-payment' WHERE id='tra-no'`, `… 'lending' WHERE id='cho-vay'` → `transactions.category_id`, `rules.category_id`; `tenant_lines.category_id` có trigger chỉ ghi thêm (`trg_tenant_lines_append_only`, `docs/schema.sql:693-700`) → `DROP TRIGGER` → UPDATE → `CREATE TRIGGER` lại y nguyên; `config.rental_shared_categories` (chuỗi `a,b,c`) thay `tra-no` → `debt-payment`.
  3. `UPDATE income_streams SET id='rental' WHERE id='cho-thue'` → `income_stream_locks.stream_id`, `transactions.income_stream_id`, `rules.income_stream_id`; `config.rental_income_stream_id`.
  4. `UPDATE categories SET icon = CASE id … END WHERE icon IS NULL AND id IN (…)` theo 29 dòng bảng icon hiện tại (gồm danh mục của nhà mình — migration ở lại private).
  5. `schema_version = '1.29'`. Không bảng nào cần dựng lại (không CHECK nào ghim ba mã này). `audit_log` (target `sepay:chinh`) và `notifications.payload` không viết lại — lịch sử, và trigger không cho sửa.
  Diễn tập trên bản export prod như Change 0 (engine D1 local), so số chi theo danh mục, sổ nợ, sổ người thuê, khoá chia trước / sau; sao lưu D1 trước.
- Code: hằng `DEFAULT_SEPAY_CONNECTION_ID = "default"`, `DEBT_CATEGORY_ID = "debt-payment"`, `LEND_CATEGORY_ID = "lending"` đặt ở `src/domain/` (web đã import được `src/domain/entry`), mọi nơi dùng hằng (gồm `web/src/lib/settings.ts:301`, `web/src/lib/types.ts:405`, `budget-sheets.tsx:156`). Không có hằng cho nguồn cho thuê — code đọc `config.rental_income_stream_id`. Bỏ `CATEGORY_ICON` trong `web/src/ui/icons.tsx`; export danh sách tên icon để test kiểm.
- Test: `test/helpers/d1-sqlite.ts` › `openDb()` nạp `docs/schema.sql` + `docs/seed.sql`; `applyMigrations` giữ cho `test/migrations/`. `test/schema.test.ts` mục `seed` viết lại theo hộ mẫu mới. Đổi mã trong mọi file test theo bảng hộ mẫu. Dòng `- Tests:` trong specs sửa theo đường dẫn / tiêu đề mới.
- Tài liệu: `docs/seed.sql` là nguồn hộ mẫu (cũng dùng làm dữ liệu demo); GitBook `tools/` dữ liệu mẫu theo mã mới nếu đụng.
- Rủi ro: bỏ sót bảng con khi đổi mã → khoá ngoại hỏng lúc COMMIT (D1 từ chối cả migration, prod không đổi) — diễn tập bắt được; icon hiện sai — so ảnh màn Sổ / Nhập trước sau.
- **Thứ tự deploy** như Change 0: sao lưu → build → `wrangler versions upload` → migrate → `wrangler versions deploy`, tránh phút cron. Khoảng hở vài giây: Worker cũ không còn thấy `chinh` → webhook SePay của kết nối mặc định có thể 401 nếu kết nối đó đang dựa vào khoá dự phòng (kiểm `webhook_key` của `chinh` trên bản export; nếu NULL thì chấp nhận khoảng hở vài giây, SePay gửi lại / rà soát 02:00 vá); khoản trả nợ ghi trong khoảng đó có thể lỗi. Trước khi migrate, hai điện thoại mở app để xả hàng đợi offline (khoản trả nợ xếp hàng mang `category_id = 'tra-no'`).

**AI làm / người quyết:** AI làm hết; chủ nhà duyệt bảng mã và chọn giờ migrate prod.

## Review kỹ thuật
Reviewer agent (subagent `reviewer`, 2026-10-07). Đã sửa:
1. Bỏ sót `config.rental_income_stream_id = 'cho-thue'` (khoản thu người thuê sẽ lỗi `unknown_income_stream`) và `rental_shared_categories` → thêm vào 0029 và AC UC-801.
2. Trigger chỉ ghi thêm của `tenant_lines` chặn UPDATE `category_id` → DROP / CREATE lại trong 0029.
3. `cho-thue` ở `settings.tsx` là mã mục Cài đặt, không phải mã nguồn thu → bỏ hằng nguồn cho thuê; đổi mã mục Cài đặt sang tiếng Anh như đổi tên code.
4. `docs/schema.sql` + `docs/seed.sql` thiếu dữ liệu do 0004/0007/0010/0011/0015 sinh → hộ mẫu gồm cả dữ liệu đó.
5. Danh sách test migration phải chuyển đủ (0010, 0012, 0014, 0015, 0022, 0023, 0024, phần migration của piggy-bank); phần hành vi của piggy-bank viết lại trên hộ mẫu mới.
6. Thứ tự UPDATE cụ thể; hằng dùng chung đặt ở `src/domain/`.
7. AC icon kiểm được bằng máy (bảng kỳ vọng trong test, tên icon có thật); AC kết nối `default` + khoá dự phòng; AC DB mẫu sạch khoá ngoại.
8. Thứ tự deploy, khoảng hở webhook, xả hàng đợi offline trước migrate.

## Việc cần làm
- [x] Review kỹ thuật; chủ nhà duyệt; commit propose (`56414fd`)
- [x] Diễn tập 0029 trên bản export prod (2026-10-08, bản sao prod, engine D1 local: chi theo danh mục, sổ nợ, sổ người thuê, sổ phải thu, số dư ví, sổ tài khoản, số dòng khớp; `foreign_key_check` sạch)
- [x] Test (đỏ trước) → code → xanh (`21b9db0`, 787 test); `npm run check:private` sạch ở `src/`, `web/`, `test/`, `docs/schema.sql`, `docs/seed.sql`, `scripts/`, `specs/`
- [x] Sao lưu D1 (`.wrangler/backups/before-0029-<ngày giờ>.sql`) → migrate → deploy 2026-10-08; kiểm prod: v1.29, kết nối `default`, nguồn cho thuê `rental`, 17/17 danh mục có icon, số liệu Hôm nay không đổi, khoá ngoại sạch. Chủ nhà: "Tải bản mới" trên điện thoại
- [x] Hợp nhất: UC + History, ADR-94, `docs/glossary.md` (mã hệ thống)
- [x] `specs:gen`, `specs:check` 0 lỗi; archive
- [x] Cập nhật tài liệu: `docs/glossary.md` (mã hệ thống, hộ mẫu), `docs/seed.sql`, ẩn danh `docs/`, README (ví dụ); GitBook: `tools/chup-anh.mjs` theo mã mục Cài đặt mới, `seed-demo.mjs` danh mục `debt-payment`, chụp lại 185 ảnh
