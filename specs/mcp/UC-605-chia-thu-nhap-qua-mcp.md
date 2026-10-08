# UC-605: Xem trước & chia thu nhập qua MCP
- Status: implemented
- BR: BR-05, BR-02
- Decisions: D1 (thứ tự ưu tiên engine), D2 (chia ngay từng income đã xác nhận); `plans/260921-2228-profit-first-pwa/phase-06-mcp.md` bảng Tools (`preview_allocation` "bảng chia (không ghi)", `allocate` "N `fund`"); báo cáo `plans/reports/fullstack-developer-260922-0020-mcp-server.md` quyết định 4 (`at = now`, `accountId = null`); commit `bc0d2a2`; ADR-92 (tool `allocate` đổi tên `allocate_income`); ADR-97 (MCP dùng OAuth 2.1 — tool ghi như người đã uỷ quyền); ADR-98 (quyền Ghi tick sẵn, bỏ được); ADR-90 (nhật ký thay đổi chỉ thêm)
- Actor: Claude (hoặc ứng dụng AI đã nối — UC-601), thay mặt người đã uỷ quyền kết nối
- Trigger: MCP `tools/call` `preview_allocation`, `allocate_income`

## History
- v1 (2026-09-22, commit `bc0d2a2`): hai tool gọi `ledger.previewAllocation` / `ledger.allocateIncome`.
- v2 (2026-10-07, commit `7424f26`): tool `allocate` đổi tên `allocate_income` (ADR-92 — tên nói rõ chia gì); tham số `income_tx_id`, hàm `ledger.allocateIncome` và kết quả không đổi; mô tả hai tool viết tiếng Anh (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).
- v3 (2026-10-08, commit `e5ecf41`): `allocate_income` cần quyền `mcp:write` (token chỉ Xem → HTTP 403 trước khi tool chạy, không chia gì); chia xong ghi nhật ký `income.allocate` `via = mcp` mang người đã uỷ quyền; `preview_allocation` chỉ cần `mcp:read`. Thêm AC-4, AC-5 (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md)).

## Preconditions
- Đã qua UC-601: `preview_allocation` cần quyền Xem (`mcp:read`); `allocate_income` cần quyền Ghi (`mcp:write`). Với `allocate_income`: đã có giao dịch `income` còn hiệu lực (ví dụ ghi qua UC-603 với `meaning = income`).

## Main Flow — Xem trước
1. `preview_allocation { amount, taxable }` (amount nguyên dương, taxable boolean bắt buộc).
2. Gọi `ledger.previewAllocation(db, { amount, taxable, at: now().toISOString(), accountId: null })` — cùng engine chia với REST (`specs/allocation/`), không ghi sổ.
3. Vì `accountId = null`, `transferOrders` luôn là mảng rỗng (`src/domain/transfer-orders.ts` › `transferOrders` trả `[]` khi không có tài khoản nguồn).

## Main Flow — Chia thật
4. `allocate_income { income_tx_id }` → `ledger.allocateIncome(db, income_tx_id)`: lấy khoản thu, tính kế hoạch với tài khoản nhận là `counter_account_id` của khoản thu, ghi các `fund` và lệnh chuyển tiền cho ví trú ở tài khoản khác; mỗi khoản thu chỉ chia một lần (luật chi tiết ở `specs/allocation/`).
5. Chia xong ghi nhật ký thay đổi `income.allocate`, đích `tx:<income_tx_id>`, người làm = người đã uỷ quyền, `via = mcp` (ADR-90).
6. Trả `{ batchId, …kế hoạch }`.

## Alternative Flows
- Không có.

## Exceptions
- E0. `allocate_income` với token chỉ có quyền Xem → HTTP 403 `insufficient_scope` (challenge ghi đủ `mcp:read mcp:write`) trước khi tool chạy, không chia gì (UC-601 AC-11).
- E1. `income_tx_id` không phải khoản `income` còn hiệu lực → tool error "Không có khoản thu nhập còn hiệu lực với id này." (`not_income`).
- E2. Khoản thu đã chia → tool error "Khoản thu này đã được chia (đợt <batch_id>)." (`already_allocated`).
- E3. Input sai schema (ví dụ thiếu `taxable`) → tool error do SDK.

## Acceptance Criteria
### AC-1: Xem trước không ghi sổ
- Given DB bất kỳ
- When `preview_allocation { amount: 40000000, taxable: false }`
- Then trả kế hoạch chia; số dòng `transactions` và `allocation_runs` không đổi; `transferOrders = []`
- Tests: ⚠ Chưa có test qua MCP

### AC-2: Chia một lần duy nhất
- Given khoản thu `income` chưa chia
- When `allocate_income` hai lần cùng `income_tx_id`
- Then lần 1 trả `batchId`; lần 2 tool error `already_allocated`
- Tests: ⚠ Chưa có test qua MCP (REST `POST /v1/allocate` được dùng trong `test/mcp.test.ts` › "tool đọc số liệu › get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB")

### AC-3: Kết quả chia trùng REST
- Given cùng DB và cùng khoản thu
- When `allocate_income` qua MCP so với `POST /v1/allocate`
- Then cùng các `fund` và lệnh chuyển
- Tests: ⚠ Chưa có test

### AC-4: Chia thật cần quyền Ghi
- Given kết nối chỉ có quyền Xem
- When `allocate_income { income_tx_id }`
- Then HTTP 403, `WWW-Authenticate` có `error="insufficient_scope"`, `scope="mcp:read mcp:write"`; không ghi gì
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì"

### AC-5: Chia qua MCP có nhật ký `via = mcp` mang người uỷ quyền
- Given kết nối có quyền Ghi do một thành viên uỷ quyền; khoản thu `income` chưa chia
- When `allocate_income { income_tx_id }`
- Then nhật ký có một dòng `income.allocate`, đích `tx:<income_tx_id>`, người làm là người uỷ quyền, `via = mcp`
- Tests: ⚠ Chưa có test (test qua MCP mới kiểm nhật ký của `add_transaction`, `assign_log`)

## Traceability
- Code: `src/mcp/tools.ts` › `registerTools` (tool `preview_allocation`, `allocate_income`, `actor` `{ memberId, via: "mcp" }`), `WRITE_TOOLS`; `src/routes/mcp.ts` › `mcpHandler` (kiểm `mcp:write` ở tầng HTTP); `src/services/audit.ts` › `audit`; `src/services/ledger.ts` › `previewAllocation`, `allocateIncome`; `src/domain/transfer-orders.ts` › `transferOrders`
- Liên quan: `specs/allocation/` (chia income theo Profit First — `allocateIncome`); REST `src/routes/v1.ts` › `v1.post("/allocate/preview")`, `v1.post("/allocate")`

## Divergences & Open Questions
- [OPEN] `preview_allocation` không nhận `account_id` hay `at` như REST `POST /v1/allocate/preview` (`src/routes/v1.ts`), nên Claude không xem trước được lệnh chuyển tiền và luôn tính theo thời điểm hiện tại (ảnh hưởng phần "đã nạp trong tháng" của D2).
- [OPEN] MCP không có tool huỷ giao dịch: `allocate_income` chạy ngay không có bước xác nhận (phụ thuộc Claude hỏi người dùng), còn gỡ một lần chia (huỷ khoản thu → `ledger.voidTransaction` gỡ các `fund` nếu chưa có lệnh chuyển nào `done`) chỉ làm được qua REST `POST /v1/transactions/:id/void` / PWA. Red-team `plans/reports/redteam-260922-0100-auth-exposure.md` #1 từng ghi "không có cách nào hoàn tác qua API" — code hiện tại đã có đường gỡ (`undoAllocationStatements`, migration `0006_allocation_undo_guard.sql`).
