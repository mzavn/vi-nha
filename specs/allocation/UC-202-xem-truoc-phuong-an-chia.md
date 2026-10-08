# UC-202: Xem trước phương án chia
- Status: implemented
- BR: BR-02, BR-05
- Decisions: D2, D3 ("giao diện phải ghi rõ đã bù X", `docs/core_design_rules.md` §4); commit `b92fc0f`; dry-run theo `phase-02-allocation-core.md` (Todo "dry-run"); ADR-59 (phần khóa theo nguồn thu)
- Actor: thành viên hộ (PWA, màn nhập thu nhập / màn Gán); Claude qua MCP tool `preview_allocation` (UC-605 "Chia thu nhập qua MCP")
- Trigger: `POST /v1/allocate/preview`; MCP `preview_allocation`

## History
- v1 (2026-09-22, commit `b92fc0f`): route preview + `previewAllocation` (cùng đường tính với lần chia thật, không ghi).
- v2 (2026-10-01, commit `034b7ff`): nhận `income_stream_id` — chia theo phần khóa của nguồn; nguồn không có → `unknown_income_stream` (change `261001-cho-thue-lai`).

## Preconditions
- Người gọi đã xác thực (`/v1/*` qua `requireAuth` — access UC-502/UC-503).
- Có cấu hình luật nạp hợp lệ (UC-201 E2/E3).

## Main Flow
1. Route đọc body JSON: `amount` (bắt buộc, số nguyên), `taxable` (chỉ `true` mới tính là chịu thuế), `at` (tuỳ chọn; rỗng → thời điểm hiện tại, qua `normalizeAt`), `account_id` (tuỳ chọn; tài khoản nhận tiền), `income_stream_id` (tuỳ chọn; nguồn thu).
2. `previewAllocation` nạp luật nạp active và mọi nguồn thu kèm phần khóa (`loadRefs`), và ngữ cảnh tháng của `at` (`allocationContext`):
   - `fundedThisMonth`: `SUM(amount)` các `transactions` `status='active'`, `meaning='fund'`, `month_key = monthKey(at)`, theo `wallet_id`.
   - `balances`: `v_wallet_balance` hiện tại.
   - `openingBalances`: `SUM(delta)` của `v_wallet_flow` với `month_key < monthKey(at)`.
3. Có `income_stream_id` → tìm nguồn trong `refs.incomeStreams` (gồm cả nguồn đã tắt); không thấy → E6. Gọi engine `allocate` (UC-201) với `stream` = nguồn đó (`null` nếu không gửi).
4. Sinh bản nháp lệnh chuyển tiền `transferOrders(funds, wallet→account, account_id)` (UC-204; không có memo).
5. Trả `200 { ok: true, data: { funds, underfunded, deficitCovered, transferOrders } }`. **Không ghi gì vào DB.**

## Alternative Flows
- 1a. Không có `account_id` → không sinh lệnh chuyển tiền (`transferOrders` trả `[]`).
- 1b. MCP `preview_allocation`: input `{ amount: int > 0, taxable: boolean }` (zod), `at` = thời điểm gọi, `accountId = null` → luôn không có lệnh chuyển tiền; không nhận nguồn thu → luôn chia theo luật % chung.
- 1c. PWA (nhập thu nhập tay, màn Gán) gửi nguồn đang chọn; chọn người thuê mà không chọn nguồn thì gửi nguồn cho thuê ở cấu hình (`incomeStreamId` của `/v1/rental`), cho khớp với nguồn server sẽ gắn khi ghi (ledger UC-101 4f). Route **không** tự suy nguồn từ `tenant_id`.
- 5a. PWA hiển thị từng fund kèm "đã bù X cho tháng trước" khi `deficitCovered[wallet]` > 0 và banner "Chưa tới sàn: …" khi `underfunded` không rỗng (`web/src/screens/other-entry-sheet.tsx`) — chi tiết UI thuộc `specs/pwa/`.

## Exceptions
- E1. Body không phải object JSON → 400 `invalid_input` "Nội dung gửi lên phải là một object JSON.".
- E2. `amount` không phải số nguyên → 400 `invalid_input` "amount phải là số nguyên.".
- E3. `at` không parse được → 400 `invalid_at` "Ngày giờ không hợp lệ.".
- E4. `at`/`account_id` không phải chuỗi → 400 `invalid_input` "<tên> phải là chuỗi.".
- E5. Engine ném `AllocationConfigError` (thu nhập ≤ 0, cấu hình remainder/phần trăm sai) → vì không phải `DomainError`, `app.onError` trả **500** `internal` "Lỗi hệ thống. Thử lại sau." (MCP: `isError` với cùng thông điệp chung).
- E6. `income_stream_id` không phải chuỗi → 400 `invalid_input`; không có nguồn này → 400 `unknown_income_stream` "Không có nguồn thu "<id>".".

## Acceptance Criteria
### AC-1: Preview không ghi gì và cho đúng số như lần chia thật
- Given DB seed, chưa có fund nào
- When `POST /v1/allocate/preview { amount: 40000000, at: "2026-09-10T09:00:00+07:00", account_id: "vcb-husband" }`
- Then `data.funds` chứa `{ walletId: "wealth-building", amount: 12000000 }` và bảng `transactions` vẫn không có dòng `meaning='fund'`
- Tests: `test/api.test.ts` › "chia lương end-to-end › preview không ghi gì; allocate ghi đúng các fund và lệnh chuyển tiền"

### AC-2: Ngữ cảnh tháng tính theo `month_key` của `at`
- Given đã có fund trong tháng 9 và ví Ăn âm từ tháng 8
- When preview với `at` trong tháng 9
- Then engine nhận `fundedThisMonth` chỉ gồm fund `active` của tháng 9 và `openingBalances` gồm mọi dòng chảy có `month_key` < `2026-09`
- Tests: ⚠ Chưa có test ở tầng service (engine phủ bởi UC-201 AC-5, AC-7 với input dựng tay)

### AC-3: Cấu hình hỏng không trả số bừa
- Given không có luật `remainder` active
- When preview
- Then không có phương án nào được trả; HTTP 500 `internal`
- Tests: ⚠ Chưa có test cho route (engine: UC-201 AC-13)

### AC-4: Xem trước theo nguồn thu
- Given nguồn `salary-wife` khóa 45% Tích sản
- When `POST /v1/allocate/preview { amount: 11000000, at: "2026-09-10T09:00:00+07:00", income_stream_id: "salary-wife" }`
- Then `data.funds` chứa `{ walletId: "wealth-building", amount: 4950000 }`; chia thật cùng khoản (nguồn `salary-wife`) cho đúng Tích sản 4.950.000
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối"

### AC-5: Nguồn thu không có bị từ chối
- Given không có nguồn `khong-co`
- When preview với `income_stream_id: "khong-co"`
- Then 400 `unknown_income_stream`, không có phương án
- Tests: ⚠ Chưa có test

## Traceability
- Code: `src/routes/v1.ts` › `v1.post("/allocate/preview")`, `body`, `int`, `str`; `src/domain/entry.ts` › `normalizeAt`; `src/services/ledger.ts` › `previewAllocation`, `allocationContext`, `walletAccounts`, `AllocationPlan`, `loadRefs` (`incomeStreams`); `src/mcp/tools.ts` › tool `preview_allocation`; `src/index.ts` › `app.onError`
- Migrations/DB: views `v_wallet_balance`, `v_wallet_flow` (`migrations/0001_schema.sql`); `income_streams`, `income_stream_locks` (`migrations/0007_income_streams_rental.sql`)

## Divergences & Open Questions
- [OPEN] Lỗi cấu hình chia (`AllocationConfigError`) ra 500 "Lỗi hệ thống" thay vì một mã 4xx có thông điệp tiếng Việt của engine (`src/index.ts:27-35`); người dùng không biết phải sửa gì. Chưa rõ đây là quyết định hay sót.
- [OPEN] Route không chặn `amount ≤ 0` (chỉ kiểm số nguyên) nên 0/âm rơi vào E5 (500), trong khi MCP chặn bằng zod `.positive()`.
- [OPEN] Nguồn thu đã tắt vẫn xem trước được (`loadRefs` nạp cả nguồn `active=0`), trong khi ghi khoản thu với nguồn đó bị từ chối `inactive_income_stream` (ledger UC-101) — preview có thể cho phương án mà không ghi được.
- [OPEN] MCP `preview_allocation` không nhận nguồn thu, nên Claude xem trước tiền người thuê / lương vợ sẽ ra phương án theo luật % chung, khác với lần chia thật (UC-203 dùng nguồn trên khoản thu).
