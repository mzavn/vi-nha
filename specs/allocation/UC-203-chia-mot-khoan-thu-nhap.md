# UC-203: Chia một khoản thu nhập (ghi sổ)
- Status: implemented
- BR: BR-02, BR-04
- Decisions: D2 (chia ngay từng income đã xác nhận; 10/25 chỉ là lời nhắc), D4 (lệnh chuyển xuất phát từ TK nhận lương); commits `b92fc0f`, `099e54f`, `eb7846e`; `plans/reports/redteam-260922-0100-money-correctness.md` (PoC 4: chia đua chỉ ghi một lần); `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md` #3, #4; ADR-59 (phần khóa theo nguồn thu), ADR-60 (tiền người thuê chỉ gợi ý, không tự gán), ADR-63 (tiền cho thuê vào ví giữ riêng); ADR-92 (tên tool MCP tiếng Anh `allocate_income`)
- Actor: thành viên hộ (PWA: sau khi ghi thu nhập tay hoặc gán log thành thu nhập); Claude (MCP `allocate_income`, UC-605); hệ thống (ingest tự chia lương khớp mẫu)
- Trigger: `POST /v1/allocate { income_tx_id }`; MCP tool `allocate_income`; ingest `matchLog` khi log tiền vào khớp rule lương và đủ ngưỡng `salary_min_amount`

## History
- v1 (2026-09-22, commit `b92fc0f`): `allocateIncome` ghi nguyên tử `allocation_runs` + fund + `transfer_orders` trong một `db.batch`; một khoản thu chia tối đa một lần (schema v1.4, migration 0003).
- v2 (2026-09-22, commit `8ef7a99`): memo mỗi lệnh chuyển là mã ngẫu nhiên riêng (UC-204).
- v3 (2026-09-22, commit `099e54f`): ingest chỉ tự ghi + tự chia khoản khớp mẫu lương khi `amount ≥ salary_min_amount` (mặc định 1.000.000 ₫); dưới ngưỡng để `pending` hỏi người — chặn "lương giả" 1.000 ₫ nội dung `LUONG THANG`.
- v4 (2026-09-22, commit `eb7846e`): `salary_min_amount = 0` bỏ ngưỡng (trước đó 0 rơi về mặc định — reviewer #4); lỗi chia sau khi lương đã ghi được ghi lại cho tin sáng thay vì trả 503 (reviewer #3).
- v5 (2026-10-01, commit `034b7ff`): lần chia dùng nguồn thu gắn trên khoản thu (`income.income_stream_id`); tiền người thuê (nguồn `cho-thue` khóa 100%) vào trọn "Thu cho thuê", không `underfunded`/`deficitCovered`, `fundedThisMonth` của ví chi tiêu không đổi; rule lương mang `income_stream_id` → khoản thu tự ghi gắn nguồn đó (change `261001-cho-thue-lai`).
- v6 (2026-10-07, commit `7424f26`): tool MCP `allocate` đổi tên `allocate_income` (ADR-92, mcp UC-601); tham số `income_tx_id` và kết quả không đổi; route `POST /v1/allocate` và hàm `allocateIncome` giữ tên (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- `income_tx_id` là một `transactions` có `meaning='income'`, `status='active'`.
- Chưa có dòng `allocation_runs` cho khoản thu này.

## Main Flow
1. Route kiểm `income_tx_id` là số nguyên.
2. `allocateIncome` đọc khoản thu; không phải income active → E2.
3. Có `allocation_runs.income_tx_id` = id → E3 (kèm mã đợt cũ).
4. Tính phương án qua UC-202 (`previewAllocation`) với `amount`, `taxable` (của khoản thu), `at` = `income.at`, `accountId = income.counter_account_id` (TK tiền vào), `incomeStreamId = income.income_stream_id` (nguồn thu; NULL = luật % chung).
5. `batchId = "A" + income_tx_id`. Trong **một** `db.batch` (nguyên tử):
   1. `INSERT allocation_runs (income_tx_id, batch_id)`;
   2. mỗi fund → một `transactions` `meaning='fund'`: `wallet_id` = ví đích, `counter_wallet_id` = `income.wallet_id` (ví Thu nhập), `at`/`week_key`/`month_key`/`by_member_id` chép từ khoản thu, `link_id = income_tx_id`, `batch_id`, `source='system'`, `taxable=0`, không tài khoản;
   3. mỗi bản nháp lệnh chuyển → `INSERT transfer_orders` với `memo = newTransferMemo()` (UC-204).
6. Trả `201 { ok: true, data: { batchId, funds, underfunded, deficitCovered, transferOrders } }`.

Kết quả: ví Thu nhập về đúng số dư trước khoản thu (Σ fund = income.amount, UC-201).

## Alternative Flows
- 0a. **Tự chia lương (ingest):** log tiền vào khớp rule `meaning='income'` (chỉ rule `is_salary=1`) **và** `log.amount ≥ salaryMinAmount()` → ingest ghi income + đánh dấu log `assigned` nguyên tử, rồi gọi `allocateIncome`; lỗi `already_allocated` bị nuốt (request khác đã chia).
  - `salaryMinAmount()`: đọc `config.salary_min_amount`; nếu là số nguyên ≥ 0 thì dùng, ngược lại (thiếu key, không phải số, âm, lẻ) → **1.000.000**. Giá trị `0` = không có ngưỡng. Sửa qua `PUT /v1/settings/config` (access UC-507, cho phép 0..1e12).
  - Rule lương có `income_stream_id` → khoản income tự ghi mang nguồn đó, lần chia theo phần khóa của nguồn (không kiểm nguồn còn bật). Rule có `tenant_id` **không** bao giờ tự ghi / tự chia — chỉ gợi ý ở màn Gán (ADR-60, ingest UC-305).
  - Dưới ngưỡng → không tự ghi, không tự chia; log nằm `pending` chờ gán tay (ingest).
- 0b. **Gán tay / nhập tay:** PWA gọi `/v1/allocate` ngay sau `POST /v1/logs/:id/assign` (với mỗi giao dịch income vừa tạo) hoặc sau khi ghi thu nhập tay; coi `already_allocated` là thành công (`web/src/screens/assign.tsx`, `web/src/screens/other-entry-sheet.tsx`).
- 0c. Khoản thu chưa được chia (không có luồng nào gọi) → vẫn `active`, không có `allocation_runs`; notify nhắc ngày 10 & 25, **không tự chia** (UC-405 "Nhắc khoản thu chưa chia ngày 10 & 25").
- 4a. **Khoản thu gắn nguồn khóa 100%** (ví dụ tiền người thuê, nguồn `rental` → `rental-income`; ledger UC-101 4f, rental [UC-805](../rental/UC-805-nhan-tien-nguoi-thue-tra.md)): đúng một fund vào ví giữ riêng, `underfunded = []`, `deficitCovered = {}`; không fund nào vào ví chi tiêu nên `fundedThisMonth` của chúng và "còn để chi" không đổi (UC-201 2b). Ví giữ riêng trú cùng TK với ví Thu nhập (seed) → không có lệnh chuyển tiền.
- 5a. `income.counter_account_id` NULL hoặc mọi ví đích trú cùng TK đó → không có lệnh chuyển tiền.
- 5b. Hai request chia cùng một khoản đua nhau: cả hai qua bước 3, batch thứ hai vi phạm PRIMARY KEY `allocation_runs.income_tx_id` → **toàn bộ** batch thứ hai huỷ (không fund, không lệnh) → E4.

## Exceptions
- E1. `income_tx_id` không phải số nguyên → 400 `invalid_input` "income_tx_id phải là số nguyên.".
- E2. Không có / không phải income / đã `void` → 404 `not_income` "Không có khoản thu nhập còn hiệu lực với id này.".
- E3. Đã chia → 409 `already_allocated` "Khoản thu này đã được chia (đợt <batch_id>).".
- E4. Batch lỗi có chữ `UNIQUE`/`PRIMARY KEY` → 409 `already_allocated` "Khoản thu này vừa được chia ở nơi khác.".
- E5. Engine lỗi cấu hình → 500 `internal` (xem UC-202 E5). Trong luồng tự chia (0a), lỗi khác `already_allocated` làm ingest ghi `notifications` `kind='ingest_error'` với thông điệp "Đã ghi giao dịch nhưng xử lý tiếp bị lỗi: <lý do>" để tin sáng báo; khoản thu vẫn `active`, chưa chia.

## Acceptance Criteria
### AC-1: Chia ghi đúng fund, trả mã đợt, ví Thu nhập về 0, sinh lệnh chuyển sang TK Tích sản
- Given khoản thu 40.000.000 ngày 2026-09-10 về `vcb-husband` (ghi tay)
- When `POST /v1/allocate { income_tx_id }`
- Then 201, `batchId = "A<id>"`; `v_wallet_balance`: `income` = 0, `wealth-building` = 12.000.000; đúng một lệnh `vcb-husband → tcb-husband` 12.000.000 với memo khớp `^PF [A-Z2-9]{6}$`
- Tests: `test/api.test.ts` › "chia lương end-to-end › preview không ghi gì; allocate ghi đúng các fund và lệnh chuyển tiền"

### AC-2: Một khoản thu không bao giờ được chia hai lần
- Given khoản thu 30.000.000 đã chia
- When gọi `/v1/allocate` lần nữa
- Then 409 `already_allocated`; tổng fund vẫn 30.000.000
- Tests: `test/api.test.ts` › "chia lương end-to-end › một khoản thu không bao giờ được chia hai lần"

### AC-3: Hai lần chia đồng thời chỉ ghi một
- Given cùng `income_tx_id`, hai request song song
- When cả hai tới bước ghi
- Then đúng một `allocation_runs`, không có fund thừa; request thua nhận `already_allocated`
- Tests: ⚠ Chưa có test thường trực (red team xác nhận bằng PoC 4, `plans/reports/redteam-260922-0100-money-correctness.md`, rồi xoá)

### AC-4: Webhook lương gửi lại không chia lần hai
- Given log lương 40.000.000 id `500` đã tự ghi + tự chia
- When SePay gửi lại cùng id
- Then vẫn 1 `allocation_runs`, 1 income; tổng fund 40.000.000; income có `taxable=0`
- Tests: `test/ingest.test.ts` › "ingestLog: rule lương — chia đúng một lần dù webhook gửi lại › tạo income taxable=0 rồi chia ngay; gửi lại cùng id không chia lần hai"

### AC-5: Ngưỡng tự chia lương
- Given rule lương khớp nội dung `LUONG THANG 9`
- When log 1.000 ₫ về → Then log `pending`, không có giao dịch nào
- When log 30.000.000 về (ngưỡng mặc định) → Then có fund; When đặt `salary_min_amount = 50000000` và log 30.000.000 khác về → Then log đó `pending`
- When `salary_min_amount = '0'` → Then `salaryMinAmount()` = 0
- Tests: `test/ingest-integrity.test.ts` › "lương giả › người ngoài chuyển 1.000 ₫ nội dung 'LUONG THANG' → không tự ghi thu nhập, không tự chia; nằm chờ để hỏi"; "lương giả › lương thật (đủ ngưỡng) vẫn tự chia ngay; ngưỡng chỉnh được trong config"; "rà lại các bản sửa (reviewer cuối) › salary_min_amount = 0 thì bỏ ngưỡng"

### AC-6: Chia lỗi sau khi lương đã ghi thì không im lặng
- Given luật `remainder` bị tắt (cấu hình hỏng)
- When log lương 30.000.000 về
- Then log được tạo (`created: true`), có 1 income, 0 `allocation_runs`, và một `notifications` `kind='ingest_error'` có message khớp /xử lý tiếp bị lỗi/
- Tests: `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › lương đã ghi nhưng bước chia lỗi → không im lặng: ghi lại để tin sáng báo, webhook không bị gửi lại vô ích"

### AC-7: Webhook và rà soát đêm cùng một khoản lương → chia đúng một lần
- Given webhook lương 40.000.000 không có mã tham chiếu, rồi backfill cùng giao dịch với id khác có mã
- When cả hai được ingest
- Then 1 `allocation_runs`, tổng fund active 40.000.000, Tích sản 12.000.000
- Tests: `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → chia đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng" (chống trùng log thuộc ingest; ở đây chỉ là hệ quả lên lần chia)

### AC-8: Tiền người thuê chia trọn vào "Thu cho thuê"
- Given người thuê `an`; khoản `income` 5.191.667 gắn `tenant_id = an` (server tự gắn nguồn `rental`), nhập tay hoặc gán từ log tiền vào
- When chia khoản đó
- Then fund duy nhất `{ wallet_id: "rental-income", amount: 5.191.667 }`; (gán log) số dư người thuê `v_tenant_balance` = −5.191.667
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền vào cho người thuê → nguồn cho thuê mặc định, chia 100% vào Thu cho thuê, số dư người thuê giảm"

### AC-9: Khoản thu gắn nguồn khóa một phần chia theo nguồn
- Given khoản `income` 11.000.000 gắn `income_stream_id = salary-wife` (Tích sản 45%) — nhập tay, hoặc tự ghi từ log lương khi rule lương mang `income_stream_id`
- When chia
- Then Tích sản nhận 4.950.000; khoản tự ghi có `income_stream_id = "salary-wife"`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối"; `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule lương mang income_stream_id → khoản thu tự ghi gắn nguồn, chia theo phần khóa của nguồn"

### AC-10: Rule người thuê không tự ghi, không tự chia
- Given rule `income` có `tenant_id = an`, khớp nội dung `AN CK`
- When log tiền vào 5.191.667 nội dung `AN CK TIEN NHA T10` về
- Then log `pending`, không có giao dịch, không có lần chia; gợi ý "Thu từ An"
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán"

## Traceability
- Code: `src/routes/v1.ts` › `v1.post("/allocate")`; `src/services/ledger.ts` › `allocateIncome`, `previewAllocation`, `insertTx`, `getTransaction`, `salaryMinAmount`; `src/services/ingest.ts` › `matchLog` (nhánh rule lương, `incomeStreamId`), `loadRuleRows`, `recordIngestError`; `src/mcp/tools.ts` › tool `allocate_income`; `src/domain/transfer-orders.ts` › `newTransferMemo`
- Migrations/DB: `migrations/0003_offline_entry_and_allocation_runs.sql` (`allocation_runs`, `idx_tx_batch`); CHECK fund ở `migrations/0001_schema.sql`; `transactions.income_stream_id`, `rules.income_stream_id`, `rules.tenant_id` (`migrations/0007_income_streams_rental.sql`)

## Divergences & Open Questions
- [DIVERGENCE] `docs/core_design_rules.md` §4: "Chạy ngay khi một khoản income được xác nhận". Với nhập tay qua REST/MCP, server **không** tự chia sau `POST /v1/transactions` — việc chia ngay là do client gọi tiếp `/v1/allocate` (PWA làm; MCP cần Claude gọi tool `allocate_income` riêng). Chỉ nhánh lương của ingest tự chia ở server (`src/services/ingest.ts:374`).
- [OPEN] Kiểm "đã chia" (bước 3) là đọc-rồi-ghi; tính đúng khi đua dựa hoàn toàn vào PRIMARY KEY và việc nhận diện lỗi bằng regex `/UNIQUE|PRIMARY KEY/i` trên thông điệp lỗi D1 (`src/services/ledger.ts:300`). Một vi phạm UNIQUE khác trong batch (vd `allocation_runs.batch_id`) cũng sẽ được báo là `already_allocated`.
- [OPEN] Lần chia dùng nguồn của khoản thu kể cả khi nguồn đã tắt (`loadRefs` nạp cả nguồn `active=0`), và nhánh tự ghi lương gắn nguồn của rule mà không kiểm nguồn còn bật — chỉ nhập tay/gán mới chặn `inactive_income_stream`. Sửa phần khóa của nguồn sau khi ghi khoản thu mà trước khi chia cũng đổi kết quả chia.
- [DIVERGENCE] Proposal `261001-cho-thue-lai` (UC-805) ghi thêm một `TenantLine(payment)` sau khi chia; code không có `payment` — tiền người thuê trả chính là khoản `income` gắn `tenant_id`, và `v_tenant_balance` trừ thẳng các khoản đó (huỷ khoản thu thì số dư tự trở lại).
