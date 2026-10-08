# UC-805: Nhận tiền người thuê trả & dùng tiền "Thu cho thuê"
- Status: implemented
- BR: BR-11, BR-02, BR-04
- Decisions: ADR-58 (ghi thu theo tiền thật), ADR-59 (phần khóa theo nguồn thu), ADR-60 (chỉ gợi ý, không tự gán), ADR-63 (ví giữ riêng; trả nợ/sang Tích sản do người quyết); D14 (ADR-48); change `261001-cho-thue-lai`; ADR-94 (mã hệ thống tiếng Anh)
- Actor: người trong hộ (PWA màn Gán — [UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md); "Loại khác › Thu nhập" — [UC-705](../pwa/UC-705-nhap-loai-khac.md); thẻ "Thu cho thuê" ở Ví & Quỹ — [UC-712](../pwa/UC-712-chuyen-ngan-sach-va-bu.md)); Claude qua MCP `add_transaction`/`assign_log`; hệ thống (ingest gợi ý)
- Trigger: gán log `in` với split `{ meaning: "income", tenant_id }` ([ingest UC-305](../ingest/UC-305-gan-log-chua-gan.md)); hoặc `POST /v1/transactions { meaning: "income", tenant_id, … }` ([ledger UC-101](../ledger/UC-101-nhap-tay-khoan-tien.md)); sau đó chia ([allocation UC-203](../allocation/UC-203-chia-mot-khoan-thu-nhap.md))

## History
- v1 (2026-10-01, commit `034b7ff`): tiền người thuê trả là `income` mang `tenant_id`, tự lấy nguồn thu cho thuê → chia 100% vào "Thu cho thuê"; rule người thuê chỉ gợi ý "Thu từ <tên>"; trả nợ = chi danh mục `tra-no` từ ví giữ riêng; sang Tích sản = chuyển kèm `from_wallet_id` (change `261001-cho-thue-lai`).
- v2 (2026-10-08, commit `21b9db0`): không đổi hành vi — nguồn cho thuê và danh mục trả nợ mang mã hệ thống `rental`, `debt-payment` (migration 0029, ADR-94); code đọc nguồn qua `config.rental_income_stream_id`. (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Người thuê tồn tại và đang ở. `config.rental_income_stream_id` trỏ tới một nguồn đang dùng (seed `rental` = `{rental-income: 100%}`).
- Tiền chuyển khoản vào tài khoản có SePay → đi đường gán log; tiền mặt → nhập tay vào tài khoản tiền mặt (D14 cấm nhập tay trên tài khoản có feed).

## Main Flow — tiền về tài khoản có SePay
1. Log `in` về (webhook/rà soát). Ingest **không** tự gán tiền người thuê: rule mang `tenant_id` bị bỏ khỏi bước tự khớp (ADR-60), log nằm `pending`.
2. Màn Gán: nếu nội dung khớp rule của người thuê, log mang gợi ý `{ meaning: "income", tenant_id, label: "Thu từ <tên>" }`; PWA điền sẵn dòng "Thu từ người thuê" và hiện banner "Máy chỉ gợi ý — xem đúng người, đúng số rồi mới bấm Gán". Không khớp thì người tự chọn "Thu từ người thuê" và chọn người.
3. Người bấm Gán → split `income` mang `tenant_id` (không chọn nguồn) → `buildEntry`: người thuê phải có và đang ở; nguồn = `config.rental_income_stream_id`; ghi `transactions.tenant_id`, `income_stream_id`.
4. Chia (PWA gọi `/v1/allocate` ngay sau gán, như mọi khoản thu): nguồn khóa 100% → đúng **một** fund vào "Thu cho thuê"; không dòng thác, không `underfunded`, không `deficitCovered`; ví chi tiêu và "còn để chi" không đổi (UC-201).
5. Số dư người thuê giảm đúng số tiền (`v_tenant_balance` trừ mọi `income` `active` mang `tenant_id`). Không có dòng sổ người thuê nào được ghi.

## Alternative Flows
- 1a. **Tiền mặt / tài khoản không feed**: "Loại khác › Thu nhập", chọn "Người thuê trả"; hoặc REST/MCP `add_transaction { meaning: "income", tenant_id, account_id, by_member_id }`. Bước 3–5 như trên.
- 3a. Chọn tay nguồn khác (`income_stream_id`) → chia theo nguồn đó thay cho nguồn cho thuê.
- 4a. Tài khoản nhận tiền khác tài khoản trú của ví "Thu cho thuê" → lần chia sinh lệnh chuyển tiền (UC-204) như mọi fund.
- 5a. **Huỷ** khoản thu (UC-102 / gỡ gán UC-306) → lần chia bị gỡ (UC-206) và số dư người thuê tự trở lại.
- 6. **Trả nợ từ "Thu cho thuê"** (vợ chồng quyết số tiền — ADR-63): khoản `spend` danh mục `debt-payment` "Trả nợ" (ví mặc định `rental-income`). Nhập tay (thẻ "Thu cho thuê" › "Trả nợ", tài khoản không feed) hoặc gán log `out` ở màn Gán. Ví giữ riêng **được** chi trực tiếp (chỉ ví Thu nhập và Tích sản bị chặn).
- 7. **Sang Tích sản**: gán log `out` thành `transfer` kèm `from_wallet_id = rental-income`, `wallet_id = wealth-building` (tiền đi MB → BIDV thật và số chuyển ví cùng lúc); hoặc "Chuyển ngân sách" chỉ đổi ví ([UC-712](../pwa/UC-712-chuyen-ngan-sach-va-bu.md)).

## Exceptions
- E1. `tenant_id` không có → 400 `unknown_tenant`; người thuê đã ra → 400 `inactive_tenant`.
- E2. `tenant_id` hoặc `income_stream_id` trên khoản không phải `income` → 400 `income_only`.
- E3. Nguồn (chọn tay hoặc cấu hình) không có → 400 `unknown_income_stream`; đã tắt → 400 `inactive_income_stream`.
- E4. Tạo rule người thuê cho `meaning ≠ income` → 400 `tenant_rule_income_only` (UC-307).
- E5. Chuyển kèm ví chỉ có một trong `from_wallet_id`/`wallet_id`, hoặc hai ví trùng → PWA chặn ("chuyển ví cần hai ví khác nhau, hoặc bỏ trống cả hai").

## Acceptance Criteria

### AC-1: Nhập tay tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào "Thu cho thuê"
- Given An đang ở; nguồn cho thuê `rental`
- When `POST /v1/transactions { meaning: income, amount: 5.191.667, tenant_id: an }` rồi chia
- Then giao dịch có `tenant_id = an`, `income_stream_id = rental`; đúng một fund 5.191.667 vào `rental-income`; snapshot `reserves` có "Thu cho thuê"; bảng ngân sách không có ví này
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; qua MCP: `test/mcp.test.ts` › "add_transaction › income kèm tenant_id → gắn người thuê, tự lấy nguồn thu cho thuê"

### AC-2: Gán log tiền vào cho người thuê
- Given log `in` 5.191.667 chưa gán
- When gán một split `{ meaning: income, tenant_id: an }`
- Then nguồn `rental` được gắn, chia 100% vào "Thu cho thuê", số dư người thuê giảm 5.191.667
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền vào cho người thuê → nguồn cho thuê mặc định, chia 100% vào Thu cho thuê, số dư người thuê giảm"

### AC-3: Rule người thuê chỉ gợi ý, không tự gán; chỉ dùng cho tiền vào
- Given rule `content "AN CK" → income, tenant_id an`
- When log `in` "AN CK TIEN NHA T10" về
- Then log vẫn `pending`, gợi ý `Thu từ An`; tạo rule người thuê với `meaning = spend` → `tenant_rule_income_only`
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán"; `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ dùng cho tiền vào"

### AC-4: Huỷ khoản tiền trả thì số dư người thuê trở lại
- Given An trả 1.000.000 (số dư −1.000.000)
- When khoản thu đó bị `void`
- Then số dư về 0, không cần huỷ gì ở sổ người thuê
- Tests: `test/rental.test.ts` › "/v1/rental › huỷ dòng sổ đổi số dư; huỷ giao dịch tiền trả thì số dư trở lại"

### AC-5: Tiền người thuê không vào ví chi tiêu
- Given nguồn `rental` = `{rental-income: 100%}`
- When chia 5.191.667
- Then đúng một fund vào "Thu cho thuê"; không ví chi tiêu nào nhận, không cờ thiếu sàn
- Tests: `test/allocation.test.ts` › "chia theo nguồn thu › nguồn cho thuê khóa 100% vào Thu cho thuê: đúng một fund, không chạy dòng thác, không cờ thiếu sàn"

### AC-6: Người thuê sai / gắn sai loại bị từ chối
- Given `tenant_id = "khong-co"`; hoặc `income_stream_id` trên một khoản chi
- When ghi
- Then 400 `unknown_tenant`; 400 `income_only`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối"; người thuê đã ra (`inactive_tenant`): ⚠ Chưa có test

### AC-7: Trả nợ chi thẳng từ "Thu cho thuê"
- Given "Thu cho thuê" có 5.191.667
- When chi 3.000.000 danh mục `debt-payment`
- Then 201, `counter_wallet_id = rental-income`, số dư ví còn 2.191.667
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"

### AC-8: Sang Tích sản bằng gán log ra kèm chuyển ví
- Given log `out` 3.000.000 từ tài khoản giữ "Thu cho thuê"
- When gán `transfer` sang tài khoản khác của hộ (`other_account_id`) với `from_wallet_id = rental-income`, `wallet_id = wealth-building`
- Then giao dịch có `counter_wallet_id = rental-income`, `wallet_id = wealth-building`; "Thu cho thuê" −3.000.000, Tích sản +3.000.000
- And PWA không cho gửi chuyển kèm ví thiếu một đầu
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền ra thành chuyển khoản kèm chuyển ví Thu cho thuê → Tích sản"; `web/src/lib/splits.test.ts` › "tách log: tổng phải khớp số tiền log › chuyển kèm ví: đủ cả hai ví khác nhau, hoặc không ví nào"

## Traceability
- Code: `src/domain/entry.ts` › `buildEntry` (nhánh `income`: `tenant_id`, `income_stream_id`; `income_only`); `src/services/ingest.ts` › `matchLog` (bỏ rule có `tenant_id`), `suggestFor`, `splitToEntryInput`, `assignLog`, `createRule`; `src/services/ledger.ts` › `loadRefs` (`tenants`, `rentalIncomeStreamId`), `allocateIncome`; `src/domain/allocation.ts` › `allocate` (`stream`); `src/mcp/tools.ts` › `add_transaction`, `assign_log`
- PWA: `web/src/screens/assign.tsx` (lựa chọn "Thu từ người thuê", banner gợi ý, "Từ ví/Đến ví"); `web/src/screens/other-entry-sheet.tsx` › `IncomeForm` ("Người thuê trả"); `web/src/screens/budget-sheets.tsx` › `DebtSheet`
- Migrations/DB: `transactions.tenant_id`, `transactions.income_stream_id`, `rules.tenant_id`, `v_tenant_balance`, ví "Thu cho thuê", danh mục "Trả nợ", nguồn cho thuê (`migrations/0007_income_streams_rental.sql`; mã hệ thống `debt-payment`, `rental` từ `migrations/0029_system_ids.sql`, ADR-94)

## Divergences & Open Questions
- Ghi chú khác proposal (không phải lệch hành vi): proposal v5 ghi thêm `TenantLine(payment)` khi nhận tiền; code không có `kind = payment` — tiền trả **là** khoản `income` mang `tenant_id`, `v_tenant_balance` trừ thẳng. Lợi ích: huỷ khoản thu là số dư tự đúng, không có hai bản ghi phải giữ khớp.
- [DIVERGENCE] Proposal v5 (allocation, "Dùng tiền trong Thu cho thuê"): sang Tích sản = `transfer` MB → BIDV kèm ví. PWA có thêm nút "Chuyển sang Tích sản" trên thẻ "Thu cho thuê" nhưng nút này mở **Chuyển ngân sách** (chỉ đổi ví, không đổi tài khoản — `web/src/screens/wallets.tsx`), nên khi Tích sản ở BIDV còn tiền nằm ở MB: số dư ví và số dư tài khoản lệch nơi ở, không có lệnh chuyển tiền nào được sinh. Cần quyết: nút này nên sinh lệnh chuyển tiền / mở "Chuyển nội bộ", hay giữ như ghi chú trong sheet ("ví nằm ở hai tài khoản khác nhau thì chuyển tiền thật bằng Chuyển nội bộ").
- [OPEN] Nguồn thu cho thuê khóa 100% nên khoản thu `taxable = true` của người thuê **không** bị trích Thuế (có nguồn thì engine không chạy luật thuế chung — UC-201).
- [OPEN] Người thuê trả bằng tiền mặt vào tài khoản tiền mặt của một thành viên: fund vào "Thu cho thuê" (trú ở MB) sinh lệnh chuyển tiền mặt → MB; chưa có quyết định đây có phải điều chủ nhà muốn.
- [OPEN] `suggestFor` chỉ trả gợi ý người thuê khi rule khớp; log `in` của người thuê không khớp rule nào không có gợi ý gì — người phải nhớ chọn "Thu từ người thuê", nếu không khoản đó vào luật % chung như lương.
