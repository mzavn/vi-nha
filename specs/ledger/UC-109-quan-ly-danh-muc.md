# UC-109: Quản lý danh mục chi
- Status: implemented
- BR: BR-08, BR-03
- Decisions: D10 (bỏ `hoc-phi` khỏi seed; khoản mới thì tạo ví tích dồn riêng); `docs/core_design_rules.md` §9 "Danh mục: tách khỏi ví; chọn danh mục thì ví tự điền"; commit `4b6d298` (route chỉ nhận đúng trường, đúng kiểu); ADR-94 (danh mục hệ thống `debt-payment`, `lending`; icon là dữ liệu `categories.icon`)
- Actor: người gọi API (bearer/session); Claude (MCP `list_categories`, chỉ đọc). PWA chỉ **đọc** danh mục (qua `/v1/bootstrap`), không có màn tạo/sửa.
- Trigger: `GET /v1/categories`, `POST /v1/categories`, `PATCH /v1/categories/:id`

## History
- v1 (2026-09-22, commit `b92fc0f`): đọc/tạo/sửa danh mục; mã tự sinh từ tên bỏ dấu.
- v2 (2026-09-22, commit `4b6d298`): `categoryInput` chọn và kiểm kiểu từng trường thay vì đẩy nguyên body xuống service.
- v3 (2026-10-08, commit `21b9db0`): mã hệ thống tiếng Anh (ADR-94) — migration 0029 (schema v1.29) đổi danh mục `tra-no` → `debt-payment`, `cho-vay` → `lending` ở danh mục và mọi bảng con, và chép icon từ bảng icon cũ trong code vào `categories.icon` (dòng còn trống). Code không còn bảng icon theo mã: PWA vẽ icon từ `categories.icon`, tên lạ hoặc trống thì icon nhãn. Hộ mẫu `docs/seed.sql` mã tiếng Anh, danh mục nào cũng có icon. Thêm AC-5, AC-6, AC-7 (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Đã xác thực.

## Main Flow — tạo
1. Route lấy đúng các trường `id`, `name`, `default_wallet_id` (chuỗi hoặc `null`), `icon` (chuỗi hoặc `null`), `sort` (số nguyên), `active` (chỉ `true` là bật); sai kiểu → `invalid_input`.
2. `default_wallet_id` nếu có phải là ví active.
3. `name` bắt buộc (trim); `id` = `id` gửi lên hoặc slug của tên (bỏ dấu, `đ→d`, chữ thường, ký tự khác `[a-z0-9]` thành `-`, cắt 40); phải khớp `^[a-z0-9-]{1,40}$`.
4. Ghi `(id, name ≤ 60 ký tự, default_wallet_id, icon, sort ?? 100)`; trả danh mục, HTTP 201.

## Main Flow — sửa
1. Danh mục phải tồn tại.
2. Chỉ trường nào gửi mới đổi: `name` (rỗng → giữ tên cũ), `default_wallet_id`/`icon` (gửi `null` là xoá), `sort`, `active` (`false` = tắt, không xoá). Trả danh mục sau khi sửa.

## Main Flow — đọc
1. `GET /v1/categories` trả danh mục **active**, sắp theo `sort`, rồi `name`, kèm `defaultWalletId`.

## Alternative Flows
- Lưới nhập của PWA ưu tiên 6 danh mục hay dùng nhất 30 ngày qua — số liệu `categoryUsage` trả trong `/v1/bootstrap` (UC-111).
- PWA vẽ icon danh mục từ `icon` của chính danh mục; tên không phải icon có thật hoặc trống → icon nhãn. Không có bảng icon theo mã danh mục trong code.
- Hai danh mục là **mã hệ thống** code đọc thẳng (ADR-94): `debt-payment` (khoản trả nợ không chọn danh mục — debt UC-902) và `lending` (cho vay / trả hộ không chọn danh mục — receivable UC-1002). Mọi danh mục khác là dữ liệu của từng nhà.

## Exceptions
- E1. `default_wallet_id` không phải ví active → `unknown_wallet` 400 "Ví mặc định không tồn tại."
- E2. Tạo thiếu tên → `missing_name` 400; mã sai dạng → `invalid_id` 400.
- E3. Tạo trùng mã (hoặc lỗi ghi bất kỳ) → `duplicate` 409 "Đã có danh mục với mã này."
- E4. Sửa danh mục không có → `not_found` 404.

## Acceptance Criteria
### AC-1: Danh mục trỏ về ví có thật; không còn học phí trỏ về Nhà ở
- Given seed
- When kiểm danh mục
- Then mọi `default_wallet_id` là ví có thật; không có `hoc-phi`
- Tests: `test/schema.test.ts` › "seed › mọi danh mục trỏ về ví có thật; mọi ví trú ở một tài khoản có thật"; `test/schema.test.ts` › "seed › không còn danh mục học phí trỏ về ví Nhà ở; thuế suất chỉ nằm ở allocations"

### AC-2: Đọc danh mục kèm ví mặc định
- Given seed
- When MCP `list_categories`
- Then `fuel-parking` có `defaultWalletId = "transport"`
- Tests: `test/mcp.test.ts` › "tool đọc số liệu › list_categories trả danh mục kèm ví mặc định"

### AC-3: Tạo danh mục, mã sinh từ tên tiếng Việt
- Given không có danh mục "Học phí"
- When `POST /v1/categories {name:"Học phí", default_wallet_id:"nice-to-have"}`
- Then 201, `id = "hoc-phi"`, `sort = 100`; gửi lại → 409 `duplicate`
- Tests: ⚠ Chưa có test

### AC-4: Tắt danh mục thay vì xoá
- Given danh mục `ride-hailing`
- When `PATCH /v1/categories/ride-hailing {active:false}`
- Then danh mục biến khỏi `GET /v1/categories` và `/v1/bootstrap`; giao dịch cũ vẫn giữ `category_id = "ride-hailing"`
- Tests: ⚠ Chưa có test

### AC-5: Migration 0029 đổi danh mục hệ thống sang mã tiếng Anh, số liệu không đổi
- Given DB như prod có danh mục `tra-no` có giao dịch, rule và dòng sổ người thuê trỏ vào (và `cho-vay` nếu có)
- When chạy migration 0029
- Then danh mục mang mã `debt-payment` (`lending`), mọi giao dịch / rule / dòng sổ người thuê trỏ mã mới; số chi theo danh mục, số dư sổ nợ, sổ người thuê không đổi; trigger chỉ ghi thêm của sổ người thuê y nguyên; chạy lại không đổi gì; khoản trả nợ ghi mới không chọn danh mục vào `debt-payment`
- Tests: test migration ở repo gốc

### AC-6: Icon danh mục là dữ liệu
- Given danh mục prod `icon` đang trống
- When chạy migration 0029
- Then mỗi danh mục có trong bảng icon cũ (29 dòng) mang đúng icon đó; dòng đã có icon giữ nguyên; danh mục lạ để trống; mọi icon là tên icon có thật. Hộ mẫu: mọi danh mục có icon là tên icon có thật
- Tests: test migration ở repo gốc; [`test/schema.test.ts`](../../test/schema.test.ts) › "seed › mọi danh mục có icon là tên icon có thật; mọi mã trong hộ mẫu là tiếng Anh (chữ thường, số, gạch nối)"; PWA dùng icon nhãn khi tên lạ: ⚠ Chưa có test (component)

### AC-7: Hộ mẫu sạch khoá ngoại, đủ dữ liệu hệ thống
- Given DB mẫu dựng từ `docs/schema.sql` + `docs/seed.sql`
- When `PRAGMA foreign_key_check` và đọc mọi view
- Then không có vi phạm khoá ngoại, mọi view chạy không lỗi; có kết nối SePay `default` cho mọi tài khoản bật SePay, danh mục `debt-payment` / `lending`, nguồn thu `rental`, config `rental_*` và `notify_*`
- Tests: [`test/schema.test.ts`](../../test/schema.test.ts) › "seed › DB mẫu (docs/schema.sql + docs/seed.sql): khoá ngoại sạch, mọi view chạy không lỗi" · "seed › có đủ dữ liệu hệ thống: kết nối SePay 'default' cho mọi tài khoản bật SePay, danh mục trả nợ / cho vay, nguồn thu cho thuê, config rental_* và notify_*"

## Traceability
- Code: `src/routes/v1.ts` › `GET/POST /categories`, `PATCH /categories/:id`, `categoryInput`; `src/services/ledger.ts` › `saveCategory`, `slug`, `loadRefs`, `categoryUsage`; `src/domain/system-ids.ts` › `DEBT_CATEGORY_ID`, `LEND_CATEGORY_ID`; `web/src/ui/icons.tsx` › `CategoryIcon`; `web/src/ui/icon-names.ts` › `ICON_NAMES`, `isIconName`
- Migrations/DB: bảng `categories` (`migrations/0001_schema.sql`); hộ mẫu `docs/seed.sql` (mã tiếng Anh, có `icon`; `migrations/0002_seed.sql` giữ hộ mẫu cũ cho chuỗi migration); `migrations/0029_system_ids.sql` (mã hệ thống, icon)

## Divergences & Open Questions
- [OPEN] Mọi lỗi khi `INSERT` (không chỉ trùng khoá) đều trả `duplicate` 409 (`saveCategory`, `catch {}`).
- [OPEN] Sửa danh mục không kiểm lại dạng `id`; đổi mã danh mục không làm được (chỉ có `PATCH` theo mã cũ).
- [OPEN] Kiểm `default_wallet_id` chỉ khi giá trị khác rỗng; ví đã tắt sau đó không làm danh mục mất ví mặc định — khi nhập, `walletFor` báo `unknown_wallet`.
- [OPEN] BR-08 (cấu hình không cần sửa code): PWA không gọi `POST/PATCH /v1/categories` (không có trong `web/src`), và `GET /v1/settings` chỉ trả danh sách danh mục — tạo/sửa danh mục hiện chỉ làm được bằng gọi API trực tiếp.
