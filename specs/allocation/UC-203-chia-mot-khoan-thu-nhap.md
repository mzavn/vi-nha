# UC-203: Chia một khoản thu nhập (ghi sổ)
- Status: implemented
- BR: BR-02, BR-04
- Decisions: D2 (chia ngay từng income đã xác nhận; 10/25 chỉ là lời nhắc), D4 (lệnh chuyển xuất phát từ TK nhận lương); commits `b92fc0f`, `099e54f`, `eb7846e`; `plans/reports/redteam-260922-0100-money-correctness.md` (PoC 4: chia đua chỉ ghi một lần); `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md` #3, #4; ADR-59 (phần khóa theo nguồn thu), ADR-60 (tiền người thuê chỉ gợi ý, không tự gán), ADR-63 (tiền cho thuê vào ví giữ riêng); ADR-92 (tên tool MCP tiếng Anh `allocate_income`); ADR-108 (Tự chia: số tay thắng luật nạp và phần khóa cho một lần chia); ADR-112 (Có / Không Tích sản khi chia; Tích sản 0 cần lý do — thay một phần ADR-108); ADR-114 (chia lãi tiền gửi: một fund, không lệnh chuyển, Thu nhập thụ động)
- Actor: thành viên hộ (PWA: sau khi ghi thu nhập tay hoặc gán log thành thu nhập); Claude (MCP `allocate_income`, UC-605); hệ thống (ingest tự chia lương khớp mẫu)
- Trigger: `POST /v1/allocate { income_tx_id, amounts?, wealth_amount?, wealth_note? }`; MCP tool `allocate_income`; ingest `matchLog` khi log tiền vào khớp rule lương và đủ ngưỡng `salary_min_amount`

## History
- v1 (2026-09-22, commit `b92fc0f`): `allocateIncome` ghi nguyên tử `allocation_runs` + fund + `transfer_orders` trong một `db.batch`; một khoản thu chia tối đa một lần (schema v1.4, migration 0003).
- v2 (2026-09-22, commit `8ef7a99`): memo mỗi lệnh chuyển là mã ngẫu nhiên riêng (UC-204).
- v3 (2026-09-22, commit `099e54f`): ingest chỉ tự ghi + tự chia khoản khớp mẫu lương khi `amount ≥ salary_min_amount` (mặc định 1.000.000 ₫); dưới ngưỡng để `pending` hỏi người — chặn "lương giả" 1.000 ₫ nội dung `LUONG THANG`.
- v4 (2026-09-22, commit `eb7846e`): `salary_min_amount = 0` bỏ ngưỡng (trước đó 0 rơi về mặc định — reviewer #4); lỗi chia sau khi lương đã ghi được ghi lại cho tin sáng thay vì trả 503 (reviewer #3).
- v5 (2026-10-01, commit `034b7ff`): lần chia dùng nguồn thu gắn trên khoản thu (`income.income_stream_id`); tiền người thuê (nguồn `cho-thue` khóa 100%) vào trọn "Thu cho thuê", không `underfunded`/`deficitCovered`, `fundedThisMonth` của ví chi tiêu không đổi; rule lương mang `income_stream_id` → khoản thu tự ghi gắn nguồn đó (change `261001-cho-thue-lai`).
- v6 (2026-10-07, commit `7424f26`): tool MCP `allocate` đổi tên `allocate_income` (ADR-92, mcp UC-601); tham số `income_tx_id` và kết quả không đổi; route `POST /v1/allocate` và hàm `allocateIncome` giữ tên (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v7 (2026-10-12, commit `a8b43f7`): **Tự chia** (ADR-108): `POST /v1/allocate` nhận `amounts: [{ wallet_id, amount }]` — ghi đúng các số, bỏ luật nạp, phần khóa nguồn thu, sàn / bù thiếu; hợp đồng `amounts` (E6 `invalid_amounts`, E7 `amounts_mismatch`); chỉ khoản thu chưa chia (lương đã tự chia thì huỷ lần chia theo UC-206 rồi chia lại). Thêm 4b, E6, E7, AC-11, AC-12 (change [261012-tu-chia](../changes/archive/261012-tu-chia/proposal.md))
- v8 (2026-10-16, commit `0528219`): **Tích sản người chọn** (ADR-112): `POST /v1/allocate` nhận `wealth_amount` (hợp đồng như UC-202 3b) và `wealth_note`; Tích sản 0 khi bản chia chỉnh được Tích sản cần lý do (400 `wealth_note_required`), lưu `allocation_runs.wealth_note` (migration 0034); nhật ký `income.allocate`; lý do lọc ký tự điều khiển. Lệch đề bài (D13): chỉ bắt lý do khi `adjustable` — nguồn khóa 100% không cần. Thêm 4c, 4d, E6b, E8, AC-13, AC-14 (change [261015-chot-thang-va-keo-tich-san](../changes/archive/261015-chot-thang-va-keo-tich-san/proposal.md))
- v9 (2026-10-18, commit `6afc8c8`): **chia lãi tiền gửi** (ADR-114) — `allocateIncome` nhận cờ nội bộ `interest` (cùng `amounts`, không mở ở `/v1/allocate` hay MCP): một fund trọn số vào ví nhận lãi, không `transfer_orders`, không luật Tích sản / lý do (ADR-112), ghi report class `passive_income` cho khoản thu cùng batch. Thêm 5d, AC-15 (change [261018-lai-tien-gui](../changes/archive/261018-lai-tien-gui/proposal.md))

## Preconditions
- `income_tx_id` là một `transactions` có `meaning='income'`, `status='active'`.
- Chưa có dòng `allocation_runs` cho khoản thu này.

## Main Flow
1. Route kiểm `income_tx_id` là số nguyên; có `amounts` thì đọc hình dạng (`parseManualAmounts`: mảng `{ wallet_id, amount }`, số nguyên ≥ 0 — sai → E6); `wealth_amount` (số nguyên ≥ 0, sai → E6) và `wealth_note` (cắt khoảng trắng hai đầu, tối đa 500 ký tự, không có ký tự điều khiển trừ xuống dòng — sai → 400 `invalid_input`).
2. `allocateIncome` đọc khoản thu; không phải income active → E2.
3. Có `allocation_runs.income_tx_id` = id → E3 (kèm mã đợt cũ).
4. Tính phương án qua UC-202 (`previewAllocation`) với `amount`, `taxable` (của khoản thu), `at` = `income.at`, `accountId = income.counter_account_id` (TK tiền vào), `incomeStreamId = income.income_stream_id` (nguồn thu; NULL = luật % chung). Có `amounts` (**Tự chia**, ADR-108) → phương án là đúng các số đó (`manualFunds`): bỏ qua luật nạp, phần khóa của nguồn thu (ADR-59) và sàn / bù thiếu — `underfunded = []`, `deficitCovered = {}`; mỗi số > 0 một fund, số 0 bỏ qua; lệnh chuyển sinh như chia theo luật. Khoản thu tính thuế mà ví Thuế nhận ít hơn luật vẫn được — số đã trích thuế là Σ fund vào ví Thuế như hiện nay.
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
- 4b. **Tự chia dùng được khi nào**: khoản thu **chưa chia** (chưa có `allocation_runs`). Lương đã tự chia theo rule (0a) → 409 `already_allocated`; muốn tự chia thì huỷ lần chia (UC-206) rồi chia lại với `amounts`. Không gửi `amounts` → như hiện nay. PWA gửi `amounts` từ sheet Chia thử (UC-202 5b); màn Gán nhiều dòng thu nhập chỉ gửi cho dòng đầu tiên. MCP `allocate_income` không nhận `amounts`.
- 4c. **Tích sản người chọn** (`wealth_amount`, ADR-112): như UC-202 3b — thay khoản cắt % Tích sản (không nguồn thu) hoặc phần khóa Tích sản của nguồn; Thuế vẫn cắt; phần còn lại theo luật. **Lý do Tích sản 0**: khi bản chia chỉnh được Tích sản (`wealth.adjustable` — nguồn không khóa 100%) và có gửi `wealth_amount` hoặc `amounts`, mà Tích sản = 0 (qua `wealth_amount: 0` hoặc `amounts` không có / bằng 0 Tích sản) thì phải có `wealth_note` → không có thì E8. Lý do lưu ở `allocation_runs.wealth_note` (chỉ khi Tích sản 0; migration 0034), trả trong kết quả (`wealthNote`), ở `GET /v1/transactions/:id` (`wealth_note`) và `GET /v1/wealth-building` › `skippedRuns` (chỉ khoản thu còn hiệu lực — pwa UC-707). Nguồn khóa 100% (vd Tự chia tiền người thuê không có Tích sản) → không bắt lý do, không lưu. Chia tự động (lương khớp rule ở ingest, 0a) và MCP `allocate_income` không áp mức 1%, không bắt lý do.
- 4d. Mỗi lần `POST /v1/allocate` ghi nhật ký `income.allocate` (target `tx:<id>`, detail `wealth_amount`, `manual`, `no_wealth`) — biết ai bấm bỏ Tích sản.
- 5a. `income.counter_account_id` NULL hoặc mọi ví đích trú cùng TK đó → không có lệnh chuyển tiền.
- 5b. Hai request chia cùng một khoản đua nhau: cả hai qua bước 3, batch thứ hai vi phạm PRIMARY KEY `allocation_runs.income_tx_id` → **toàn bộ** batch thứ hai huỷ (không fund, không lệnh) → E4.
- 5d. **Chia lãi tiền gửi** (ADR-114; ingest UC-303 bước 4, UC-305 5c — chỉ đường nội bộ): `allocateIncome(income, { amounts: [{ví nhận lãi, trọn số}], interest: true })` → `manualFunds` như Tự chia (ví phải đang dùng, không phải ví giữ tiền) nhưng **không** lệnh chuyển (tiền đã nằm ở tài khoản nhận), **không** xét Tích sản 0 / lý do; cùng batch ghi `transaction_report_classes (income, 'passive_income')` (giữ phân loại tay có trước). Fund tính vào "đã rót tháng này" của ví nhận như mọi fund — lần chia lương sau rót cho ví đó ít đi đúng số lãi. Gọi lại → 409 `already_allocated` như mọi khoản đã chia.

## Exceptions
- E1. `income_tx_id` không phải số nguyên → 400 `invalid_input` "income_tx_id phải là số nguyên.".
- E2. Không có / không phải income / đã `void` → 404 `not_income` "Không có khoản thu nhập còn hiệu lực với id này.".
- E3. Đã chia → 409 `already_allocated` "Khoản thu này đã được chia (đợt <batch_id>).".
- E4. Batch lỗi có chữ `UNIQUE`/`PRIMARY KEY` → 409 `already_allocated` "Khoản thu này vừa được chia ở nơi khác.".
- E6. `amounts` sai: không phải danh sách, dòng thiếu `wallet_id` / `amount`, số âm / lẻ / không phải số nguyên, ví không có hoặc đã tắt, ví giữ tiền (`holding` — Thu nhập, Thu cho thuê), trùng `wallet_id` → 400 `invalid_amounts` "Số tự chia không hợp lệ: …"; không ghi gì.
- E7. Σ `amounts` ≠ số tiền khoản thu → 400 `amounts_mismatch` "Tổng tự chia X khác số tiền khoản thu Y."; không ghi gì.
- E6b. `wealth_amount` âm / lẻ / không phải số nguyên / vượt khoản thu, gửi cùng `amounts`, nguồn khóa 100%, hay Tích sản + Thuế + phần khóa khác > khoản thu → 400 `invalid_amounts` (không 500). Thứ tự kiểm: `invalid_amounts` → `amounts_mismatch` → `wealth_note_required`.
- E8. Tích sản 0 thiếu lý do (4c) → 400 `wealth_note_required` "Tích sản 0: cần ghi lý do."; không ghi gì. `/allocate/preview` không bao giờ trả lỗi này.
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

### AC-11: Tự chia ghi đúng các số gửi lên
- Given khoản thu 19.000.000 chưa chia
- When `POST /v1/allocate` với `amounts` như UC-202 AC-6; rồi tổng 18.999.000; rồi có ví Thu nhập; rồi gọi lại
- Then 201, đúng 7 dòng `fund` có số như gửi, Tích sản +200.000, lệnh chuyển gộp theo tài khoản của ví, luật nạp không được dùng; 400 `amounts_mismatch`; 400 `invalid_amounts`; 409 `already_allocated`. Trùng ví, ví không có, ví đã tắt, số âm / lẻ / chuỗi → `invalid_amounts`; preview nhận `amounts` và bỏ qua nguồn thu
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "tự chia một khoản thu (change 261012-tu-chia) › UC-203 AC-11: ghi đúng các số gửi lên, bỏ luật nạp; lệnh chuyển gộp theo tài khoản của ví; tổng lệch → amounts_mismatch; ví Thu nhập → invalid_amounts; gọi lại → 409" · "… › UC-203 AC-11: hợp đồng amounts — trùng ví, ví không có, ví đã tắt, số âm / lẻ / chuỗi → invalid_amounts; preview nhận amounts và bỏ qua nguồn thu"

### AC-12: Số tay thắng phần khóa của nguồn thu
- Given nguồn thu khóa 30% Tích sản
- When tự chia Tích sản 100.000
- Then ghi đúng 100.000 vào Tích sản (không phải 30%)
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "tự chia một khoản thu (change 261012-tu-chia) › UC-203 AC-12: nguồn thu khóa 30% Tích sản, tự chia Tích sản 100.000 → ghi đúng 100.000 (số tay thắng phần khóa)"

### AC-13: Tích sản người chọn; Tích sản 0 cần lý do
- Given khoản thu 24.000.000, luật Tích sản 30%
- When `POST /v1/allocate { wealth_amount: 3600000 }`; khoản khác `wealth_amount: 0` không `wealth_note`; rồi có note; khoản thu 10.000.000 tính thuế 10% với `wealth_amount: 9500000`
- Then Tích sản +3.600.000, phần còn lại 20.400.000 theo luật; 400 `wealth_note_required`, không ghi gì; có note → ghi, `allocation_runs.wealth_note` lưu, `GET /v1/transactions/:id` có `wealth_note`, `GET /v1/wealth-building` liệt kê trong `skippedRuns`; 400 `invalid_amounts` (không 500)
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "Tích sản người chọn khi chia và lý do Tích sản 0 › UC-203 AC-13: POST /v1/allocate { wealth_amount: 3600000 } trên khoản thu 24.000.000 → Tích sản +3.600.000, phần còn lại 20.400.000 theo luật" · "… › UC-203 AC-13: wealth_amount 0 không wealth_note → 400 wealth_note_required, không ghi gì; có note → ghi, allocation_runs.wealth_note lưu, GET /v1/transactions/:id có wealth_note, GET /v1/wealth-building liệt kê trong skippedRuns" · "… › UC-203 AC-13: khoản thu 10.000.000 tính thuế 10%, wealth_amount 9.500.000 → 400 invalid_amounts (không 500)" · "… › UC-203: hợp đồng wealth_amount — âm / lẻ / chuỗi / vượt khoản thu / gửi cùng amounts / nguồn khóa 100% → 400 invalid_amounts ở cả preview lẫn allocate; preview trả wealth.adjustable false cho nguồn khóa 100%" · "… › UC-203: thứ tự lỗi invalid_amounts → amounts_mismatch → wealth_note_required" · "… › UC-203: lương tự chia ở ingest (nguồn không khóa Tích sản) và MCP allocate_income không bắt lý do dù Tích sản 0"; [`test/allocation.test.ts`](../../test/allocation.test.ts) › "wealthOverride: Tích sản người chọn khi chia › UC-203 AC-13: wealthOverride 3.600.000 trên khoản thu 24.000.000 (luật Tích sản 30%) → Tích sản 3.600.000, phần còn lại 20.400.000 chia theo luật" · "… › UC-203 AC-13: khoản thu 10.000.000 tính thuế 10%, wealthOverride 9.500.000 → DomainError invalid_amounts, không phải AllocationConfigError" · "… › UC-203: nguồn thu khóa Tích sản 45% → override thay phần khóa; nguồn không khóa Tích sản → thêm khoản cắt; nguồn khóa 100% → invalid_amounts" · "… › UC-203: wealthOverride 0 → không có fund Tích sản, Thuế vẫn cắt; override âm / lẻ / vượt khoản thu → invalid_amounts"; test migration ở repo gốc

### AC-14: Tự chia không có Tích sản cũng cần lý do
- Given Tự chia, `amounts` không có Tích sản
- When `POST /v1/allocate`; preview cùng body; gửi kèm `wealth_note`
- Then 400 `wealth_note_required`; preview 200; có lý do → ghi
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "Tích sản người chọn khi chia và lý do Tích sản 0 › UC-203 AC-14: Tự chia amounts không có Tích sản → 400 wealth_note_required; preview cùng body → 200; gửi kèm wealth_note → ghi"

### AC-15: Chia lãi tiền gửi — một fund, không lệnh chuyển, Thu nhập thụ động
- Given khoản thu lãi 37 ở ví Thu nhập, tài khoản phao (ví Tích sản trú ở tài khoản khác)
- When chia lãi vào Tích sản (đường nội bộ của ingest)
- Then đợt chia `A<id>` có đúng một fund 37 vào Tích sản, 0 lệnh chuyển tiền (dù ví đích trú ở tài khoản khác), report class `passive_income`, không đòi lý do Tích sản; số dư ví Thu nhập như trước
- Tests: [`test/ingest.test.ts`](../../test/ingest.test.ts) › "lãi tiền gửi: máy tự ghi vào ví của chính tài khoản (261018-lai-tien-gui) › UC-303: log +37 BankAPINotify tài khoản phao → 1 khoản thu 37 + 1 fund 37 vào Tích sản, 0 lệnh chuyển, Thu nhập thụ động, log đã gán; ví Thu nhập không đổi"; [`test/mcp.test.ts`](../../test/mcp.test.ts) › "assign_log nhận dòng lãi tiền gửi (261018-lai-tien-gui) › UC-604: assign_log split { meaning: income, interest: true, wallet_id } → khoản thu + một fund vào ví đó, 0 lệnh chuyển, Thu nhập thụ động"

## Traceability
- Code (chia lãi, ADR-114): `src/services/ledger.ts` › `previewAllocation` (`interest`: không `transferOrders`, `wealth: null`), `allocateIncome` (`interest`: report class `passive_income`)
- Code: `src/routes/v1.ts` › `v1.post("/allocate")` (`amounts`); `src/domain/allocation.ts` › `ManualAmount`, `parseManualAmounts`, `manualFunds`, `wealthOverride`, `isFullLock`; `src/routes/v1.ts` › `wealthAmount`, `wealth_note` (lọc ký tự điều khiển), nhật ký `income.allocate`; `src/services/ledger.ts` › `allocateIncome`, `previewAllocation`, `insertTx`, `getTransaction`, `salaryMinAmount`; `src/services/ingest.ts` › `matchLog` (nhánh rule lương, `incomeStreamId`), `loadRuleRows`, `recordIngestError`; `src/mcp/tools.ts` › tool `allocate_income`; `src/domain/transfer-orders.ts` › `newTransferMemo`
- Migrations/DB: `migrations/0003_offline_entry_and_allocation_runs.sql` (`allocation_runs`, `idx_tx_batch`); `allocation_runs.wealth_note` (`migrations/0034_month_closes.sql`, schema v1.34); CHECK fund ở `migrations/0001_schema.sql`; `transactions.income_stream_id`, `rules.income_stream_id`, `rules.tenant_id` (`migrations/0007_income_streams_rental.sql`)

## Divergences & Open Questions
- [DIVERGENCE] `docs/core_design_rules.md` §4: "Chạy ngay khi một khoản income được xác nhận". Với nhập tay qua REST/MCP, server **không** tự chia sau `POST /v1/transactions` — việc chia ngay là do client gọi tiếp `/v1/allocate` (PWA làm; MCP cần Claude gọi tool `allocate_income` riêng). Chỉ nhánh lương của ingest tự chia ở server (`src/services/ingest.ts:374`).
- [OPEN] Kiểm "đã chia" (bước 3) là đọc-rồi-ghi; tính đúng khi đua dựa hoàn toàn vào PRIMARY KEY và việc nhận diện lỗi bằng regex `/UNIQUE|PRIMARY KEY/i` trên thông điệp lỗi D1 (`src/services/ledger.ts:300`). Một vi phạm UNIQUE khác trong batch (vd `allocation_runs.batch_id`) cũng sẽ được báo là `already_allocated`.
- [OPEN] Lần chia dùng nguồn của khoản thu kể cả khi nguồn đã tắt (`loadRefs` nạp cả nguồn `active=0`), và nhánh tự ghi lương gắn nguồn của rule mà không kiểm nguồn còn bật — chỉ nhập tay/gán mới chặn `inactive_income_stream`. Sửa phần khóa của nguồn sau khi ghi khoản thu mà trước khi chia cũng đổi kết quả chia.
- [DIVERGENCE] Proposal `261001-cho-thue-lai` (UC-805) ghi thêm một `TenantLine(payment)` sau khi chia; code không có `payment` — tiền người thuê trả chính là khoản `income` gắn `tenant_id`, và `v_tenant_balance` trừ thẳng các khoản đó (huỷ khoản thu thì số dư tự trở lại).
