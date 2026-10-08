# UC-801: Thiết lập người thuê, phí cố định & chi chung
- Status: implemented
- BR: BR-11, BR-08
- Decisions: ADR-58 (sổ người thuê là sổ phải thu ngoài sổ cái), ADR-61 (phí cố định + chi chung chia đều), ADR-63 (ví giữ riêng "Thu cho thuê"), ADR-94 (nguồn cho thuê mang mã hệ thống `rental`); change `261001-cho-thue-lai`
- Actor: chủ hộ (PWA Cài đặt › Cho thuê — [UC-709](../pwa/UC-709-sua-cau-hinh-man-cai-dat.md)); client có Bearer token
- Trigger: `POST /v1/rental/tenants`, `PATCH /v1/rental/tenants/:id`, `POST /v1/rental/tenants/:id/fees`, `PATCH /v1/rental/fees/:id`, `PATCH /v1/rental/config`; đọc: `GET /v1/rental`

## History
- v1 (2026-10-01, commit `034b7ff`): người thuê, phí cố định, số dư mở sổ, cấu hình chi chung (số người, danh mục, nguồn thu cho thuê); migration 0007 tạo sẵn ví "Thu cho thuê", danh mục "Trả nợ", nguồn `cho-thue` khóa 100% (change `261001-cho-thue-lai`).
- v2 (2026-10-01, commit `034b7ff`): PWA bắt buộc chọn nguồn thu cho tiền người thuê (`rentalConfigPayload` báo lỗi khi trống, không bao giờ gửi `null`); ô chọn chỉ liệt kê nguồn đang dùng (cộng nguồn đang chọn), bỏ mục "Mặc định" — khớp server (change `261001-cho-thue-lai`).
- v3 (2026-10-08, commit `21b9db0`): mã hệ thống tiếng Anh (ADR-94) — migration 0029 (schema v1.29) đổi nguồn thu cho thuê `cho-thue` → `rental` ở nguồn, khoá chia, giao dịch, rule và `config.rental_income_stream_id`; danh mục trả nợ `tra-no` → `debt-payment` (kể cả trong `config.rental_shared_categories`). Hộ mẫu (`docs/seed.sql`) dùng mã tiếng Anh; AC-7 viết lại theo hộ mẫu, thêm AC-8 (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Đã đăng nhập (cookie phiên hoặc Bearer). Migration 0007 đã chạy (schema v1.7).
- Mọi việc ghi cần mạng (PWA không đưa vào hàng đợi).

## Main Flow
1. **Thêm người thuê** — `POST /v1/rental/tenants { name, id?, opening_balance? }`:
   - `name` bắt buộc (cắt 120 ký tự); `id` không gửi thì sinh từ tên (`An` → `an`); `id` phải khớp `^[a-z0-9-]{1,40}$`.
   - `opening_balance` khác 0 → trong **cùng batch** ghi dòng `opening` "Số dư mở sổ" tháng hiện tại (dương = người thuê đang nợ, âm = đã trả dư).
   - Trả 201 người thuê kèm `balance`, `fees`.
2. **Thêm phí cố định** — `POST /v1/rental/tenants/:id/fees { name, amount, sort? }`: `amount` nguyên > 0; trả 201 phí.
3. **Cấu hình chi chung** — `PATCH /v1/rental/config { headcount?, shared_category_ids?, income_stream_id? }`: mỗi khoá có mặt mới được ghi, cả lượt trong một batch; trả cấu hình mới.
4. **Đọc** — `GET /v1/rental` → `{ headcount, sharedCategoryIds, incomeStreamId, tenants: [{ id, name, active, balance, fees[] }] }`, người đang ở trước, rồi theo tên.

## Alternative Flows
- 1a. Sửa tên / cho người thuê ra: `PATCH /v1/rental/tenants/:id { name?, active? }`. Người ra = `active: false` **sau khi** chốt tháng cuối (UC-804) — server không kiểm việc này.
- 2a. Sửa / tắt phí: `PATCH /v1/rental/fees/:id { name?, amount?, sort?, active? }`. Không có xoá; phí tắt không vào bản nháp chốt.
- 3a. Phí một lần (thẻ xe) không phải phí cố định: ghi tay dòng `one_off` ở UC-802.
- 4a. PWA: người thuê đã ra nhưng số dư ≠ 0 vẫn hiện ở màn Người thuê tới khi về 0 ([UC-713](../pwa/UC-713-man-nguoi-thue.md)).

## Exceptions
- E1. Thiếu `name` → 400 `invalid_input`; `id` sai dạng → 400 `invalid_id`; trùng mã → 409 `duplicate_id`.
- E2. Số tiền không nguyên / quá 1e12 → 400 `invalid_amount`; phí ≤ 0 → 400 `invalid_amount`.
- E3. Người thuê / phí không có → 404 `not_found`.
- E4. `headcount` ngoài 1–50 → 400 `invalid_input`; danh mục không có → 400 `unknown_category`; `shared_category_ids` không phải mảng chuỗi → 400 `invalid_input`; nguồn thu không có hoặc đã tắt → 400 `unknown_income_stream`; `income_stream_id` rỗng/`null` → 400 `invalid_input` ("Thiếu income_stream_id.").

## Acceptance Criteria

### AC-1: Thêm người thuê và phí cố định
- Given chưa có người thuê
- When thêm "An" rồi bốn phí Nhà 2.500.000, Gửi xe 50.000, Mạng 75.000, Dịch vụ 66.667
- Then 201 cho mỗi lệnh, mã người thuê sinh từ tên là `an`, bản nháp tháng có đúng bốn dòng `fixed` đó
- Tests: `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau"; form phí: `web/src/lib/rental.test.ts` › "Cài đặt › Cho thuê › phí cố định cần tên và số dương"

### AC-2: Số dư mở sổ là một dòng `opening`, tháng sau thấy ở số dư đầu kỳ
- Given ngày 15/9 thêm An với `opening_balance = 7.075.000`
- When xem tạm tính tháng 10
- Then `openingBalance = 7.075.000`, số dư hôm nay 7.075.000
- And form PWA gửi số có dấu theo lựa chọn "còn nợ"/"đã trả dư"; 0 thì không gửi
- Tests: `test/rental.test.ts` › "/v1/rental › số dư mở sổ là dòng opening; tháng sau thấy nó ở số dư đầu kỳ"; `web/src/lib/rental.test.ts` › "Cài đặt › Cho thuê › người thuê mới: số dư mở sổ có dấu, 0 thì không gửi"

### AC-3: Đổi số người chia thì phần chi chung tính lại
- Given tổng chi chung tháng 8.160.000, số người 3 (phần mỗi người 2.720.000)
- When `PATCH /v1/rental/config { headcount: 4 }`
- Then cấu hình trả `headcount = 4`, tạm tính tháng có `share = 2.040.000`
- And form PWA chặn số người < 1, danh sách danh mục chung rỗng và nguồn thu trống ("Chọn nguồn thu cho tiền người thuê trả.")
- Tests: `test/rental.test.ts` › "/v1/rental › đổi số người chia (4) → phần chi chung giảm"; `web/src/lib/rental.test.ts` › "Cài đặt › Cho thuê › cấu hình: số người ≥ 1, ít nhất một danh mục chung, bắt buộc chọn nguồn thu"

### AC-4: Phí đã tắt không vào bản nháp
- Given hai phí, một phí `active = false`
- When dựng bản nháp với tổng chi chung 8.160.000 và 4 người
- Then nháp = `[fixed Nhà 2.500.000, shared "Chi chung" 2.040.000]`
- Tests: `test/rental.test.ts` › "domain rental › phần chi chung = floor(tổng / số người), phí tắt không vào nháp"

### AC-5: Người thuê đã ra không được nhắc chốt tháng
- Given người thuê `active = false`
- When cron sáng ngày 1
- Then không có dòng "Chốt tháng với …" cho người đó
- Tests: `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › nhắc chốt tháng với người thuê đang ở chưa chốt tháng trước; đã chốt hoặc đã ngừng thì không nhắc"

### AC-6: Cấu hình sai bị từ chối, không ghi gì
- Given `headcount = 0`, hoặc danh mục chi chung không có thật, hoặc nguồn thu đã tắt
- When `PATCH /v1/rental/config`
- Then 400 (`invalid_input` / `unknown_category` / `unknown_income_stream`), cấu hình cũ giữ nguyên
- Tests: ⚠ Chưa có test

### AC-7: Dữ liệu mặc định cho thuê trong hộ mẫu
- Given DB mẫu (`docs/schema.sql` + `docs/seed.sql`; cùng dữ liệu mà migration 0007 rồi 0029 sinh ra trên DB cũ)
- When đọc cấu hình
- Then có ví `rental-income` "Thu cho thuê" (tier `holding`, kind `accrual`, cùng tài khoản với ví Thu nhập), danh mục `debt-payment` "Trả nợ", nguồn `rental` khóa 100% vào `rental-income`, `rental_headcount = 3`, `rental_shared_categories = groceries,eating-out,utilities`, `rental_income_stream_id = rental`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó" (nguồn `rental` → `rental-income` 100%, `debt-payment` trỏ ví `rental-income`); `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › đọc hồ sơ nguồn thu seed; thêm/sửa nguồn; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối" (nguồn `salary-wife`); [`test/schema.test.ts`](../../test/schema.test.ts) › "seed › có đủ dữ liệu hệ thống: kết nối SePay 'default' cho mọi tài khoản bật SePay, danh mục trả nợ / cho vay, nguồn thu cho thuê, config rental_* và notify_*"; `rental_headcount`/`rental_shared_categories`: phủ gián tiếp qua `test/rental.test.ts` (số người 3, `groceries`/`utilities` là danh mục chung)

### AC-8: Migration 0029 đổi nguồn cho thuê sang mã hệ thống `rental`, số liệu không đổi
- Given DB như prod có nguồn thu `cho-thue` (khoá chia, giao dịch, rule trỏ vào), `config.rental_income_stream_id = 'cho-thue'`, `config.rental_shared_categories` có `tra-no`
- When chạy migration 0029
- Then nguồn mang mã `rental`, mọi khoá chia / giao dịch / rule và giá trị config trỏ `rental`; `rental_shared_categories` có `debt-payment` thay `tra-no`; sổ người thuê, số dư ví, số chi theo danh mục không đổi; `GET /v1/rental` trả `incomeStreamId = 'rental'`; khoản thu có `tenant_id` không chọn nguồn ghi `income_stream_id = 'rental'`
- Tests: test migration ở repo gốc

## Traceability
- Code: `src/routes/rental.ts` (`GET /`, `PATCH /config`, `POST /tenants`, `PATCH /tenants/:id`, `POST /tenants/:id/fees`, `PATCH /fees/:id`); `src/services/rental.ts` › `rentalConfig`, `updateRentalConfig`, `getRental`, `createTenant`, `updateTenant`, `addFee`, `updateFee`; `src/domain/rental.ts` › `monthDraft`
- PWA: `web/src/screens/settings.tsx` › `RentalSettings`; `web/src/screens/settings-sheets.tsx` › `TenantSheet`, `FeeSheet`, `RentalConfigSheet`; `web/src/lib/rental.ts` › `tenantPayload`, `feePayload`, `rentalConfigPayload`
- Migrations/DB: `migrations/0007_income_streams_rental.sql` — `tenants`, `tenant_fixed_fees`, `tenant_lines(kind='opening')`, `v_tenant_balance`, config `rental_*`, ví giữ riêng "Thu cho thuê", danh mục "Trả nợ", nguồn cho thuê (mã lúc đó `thu-cho-thue`, `tra-no`, `cho-thue`); `migrations/0029_system_ids.sql` đổi nguồn sang `rental`, danh mục sang `debt-payment`; hộ mẫu `docs/seed.sql` (`rental-income`, `debt-payment`, `rental`). Code không so thẳng mã nguồn cho thuê — đọc `config.rental_income_stream_id` (`src/services/ledger.ts` › `loadRefs`).

## Divergences & Open Questions
- [OPEN] Cho người thuê ra không kiểm tháng cuối đã chốt hay số dư = 0; chỉ là quy trình. Người đã ra vẫn chốt tháng được (`settleMonth` không kiểm `active`) và vẫn ghi được `one_off`/`adjust` (chỉ `paid_for_us` bị chặn).
- [OPEN] Sửa/tắt phí cố định đổi bản nháp của **mọi** tháng chưa chốt, kể cả tháng đã qua (nháp luôn dùng danh sách phí hiện tại).
- [OPEN] Ví "Thu cho thuê" chỉ tạo được bằng migration: Cài đặt không tạo được ví tier `holding` (`TIERS` trong `src/services/settings.ts`) và không tắt được ví tier `holding` (`required_wallet`). Thêm ví giữ riêng thứ hai cần SQL.
- [OPEN] `sort` của phí nhận mọi số nguyên (kể cả âm); `name` cắt im lặng ở 120 ký tự.
