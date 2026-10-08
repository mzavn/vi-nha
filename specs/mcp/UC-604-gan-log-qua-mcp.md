# UC-604: Gán log ngân hàng qua MCP
- Status: implemented
- BR: BR-05, BR-04
- Decisions: `plans/260921-2228-profit-first-pwa/phase-06-mcp.md` bảng Tools (`list_pending_logs`, `assign_log` "cần phase 04"); commit `bc0d2a2`; commit `8c319c1` (cập nhật test MCP khi bank feed đã có); ADR-60 (tiền vào từ người thuê chỉ gợi ý — gợi ý `tenant_id` hiện trong `list_pending_logs`); ADR-71 (trả nợ = khoản chi có `debt_id`); ADR-72 (tiền cho vay về = split `collect`, không bao giờ là thu nhập); ADR-92 (mô tả tool tiếng Anh); ADR-97 (MCP dùng OAuth 2.1 — người gán là người đã uỷ quyền); ADR-98 (quyền Ghi tick sẵn, bỏ được); ADR-90 (nhật ký thay đổi chỉ thêm)
- Actor: Claude (hoặc ứng dụng AI đã nối — UC-601), thay mặt người đã uỷ quyền kết nối
- Trigger: MCP `tools/call` `list_pending_logs`, `assign_log`

## History
- v1 (2026-09-22, commit `bc0d2a2`): hai tool chuyển tiếp `ingest.listPendingLogs` / `ingest.assignLog`; lúc đó ingest còn ném `not_implemented` nên test chỉ kiểm tool error.
- v2 (2026-09-22, commit `8c319c1`): ingest đã làm xong; test MCP đổi sang kiểm log `pending` thật và lỗi tổng tách không khớp.
- v3 (2026-10-01, commit `034b7ff`): mỗi split của `assign_log` nhận thêm `from_wallet_id` (`transfer` kèm chuyển ví), `income_stream_id`, `tenant_id` (`income`) — cùng luật với REST (change `261001-cho-thue-lai`).
- v4 (2026-10-01, commit `25db5b9`): mỗi split của `assign_log` nhận thêm `debt_id` (`spend` = trả nợ, id lấy từ `get_debts`) — cùng luật với REST (debt [UC-903](../debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md), ADR-71).
- v5 (2026-10-01, commit `2438ac0`): split của `assign_log` nhận `meaning: "collect"` và `receivable_id` (trên `lend`/`collect`, id lấy từ `get_receivables`) — cùng luật với REST (receivable [UC-1003](../receivable/UC-1003-nhan-lai-tien.md), ADR-72).
- v6 (2026-10-05, commit `d7992d1`): change [`261005-lien-ket-khoan-goc`](../changes/archive/261005-lien-ket-khoan-goc/proposal.md) — split của `assign_log` nhận `link_id` (số nguyên dương; `refund` → khoản chi gốc, `collect` → khoản cho vay gốc) — cùng `resolveLink` với REST (ingest UC-305 bước 6.7). Trước đó zod bỏ qua trường này: gán qua Claude không nối được khoản tiền về với khoản gốc.
- v7 (2026-10-07, commit `7424f26`): mô tả hai tool viết tiếng Anh (ADR-92), bỏ câu sai "Cần bank feed (phase 04) — hiện chưa triển khai…" — đóng [DIVERGENCE] mô tả tool nói chưa triển khai (mcp UC-602 AC-5 kiểm qua `tools/list`). Hành vi không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).
- v8 (2026-10-08, commit `e5ecf41`): `assign_log` ghi người gán là **người đã uỷ quyền kết nối** (UC-601) thay cho `null` — giao dịch tạo ra mang `by_member_id` của người đó và luật đổi sang ví cá nhân của người gán áp dụng như REST; cần quyền `mcp:write` (thiếu → HTTP 403); gán xong ghi nhật ký `log.assign` `via = mcp`. Sửa AC-3, AC-4 (bỏ "trừ `by_member_id = null`"); thêm AC-7. Đóng [OPEN] `assign_log` truyền người gán `null` (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md)).

## Preconditions
- Đã qua UC-601 (`list_pending_logs` cần quyền Xem `mcp:read`; `assign_log` cần quyền Ghi `mcp:write`). Có log `bank_logs.status = 'pending'` (từ webhook hoặc rà soát — `specs/ingest/`).

## Main Flow
1. `list_pending_logs { limit? }` → `ingest.listPendingLogs(db, limit ?? 20)`: log `pending` mới nhất trước, kèm `account_name` và `suggestion` (log `in` khớp rule người thuê → `{meaning:"income", tenant_id, label:"Thu từ <tên>"}`, ingest UC-305); `limit` bị kẹp trong 1..200 ở service (zod cũng chặn > 200).
2. Claude chọn `log_id`, gọi `assign_log { log_id, splits[] }`; mỗi split (`meaning, amount, wallet_id?, category_id?, other_account_id?, from_wallet_id?, income_stream_id?, tenant_id?, debt_id?, receivable_id?, link_id?, taxable?, asset_kind?, note?`; `meaning` gồm cả `collect`) được chuẩn hoá: trường thiếu → `null` (trừ `taxable` giữ `undefined`). `from_wallet_id` + `wallet_id` trên `transfer` = chuyển cả ngân sách ví; `tenant_id` trên `income` = tiền người thuê trả (bỏ trống nguồn thì lấy nguồn cho thuê); `income_stream_id` = nguồn thu; `debt_id` trên `spend` = khoản trả nợ (bỏ trống danh mục thì lấy `debt-payment`); `collect` (log tiền vào) = tiền cho vay quay về, `receivable_id` trên `lend`/`collect` = khoản phải thu; `link_id` trên `refund` / `collect` = khoản chi / khoản cho vay gốc (`collect` bỏ trống người thì lấy người của khoản cho vay; sai → `invalid_link`) (ingest UC-305 bước 6.1–6.7).
3. Handler gọi `ingest.assignLog(db, log_id, splits, memberId, now)` — người gán là người đã uỷ quyền kết nối.
4. Service kiểm log tồn tại, còn `pending`, tổng `amount` các split bằng đúng số tiền log, rồi ghi giao dịch (người ghi = người gán) và chuyển log sang đã gán (luật chi tiết ở `specs/ingest/` UC-305 Gán log chưa gán).
5. Gán xong ghi nhật ký thay đổi `log.assign`, đích `log:<log_id>`, người làm = người đã uỷ quyền, `via = mcp`, chi tiết `{ splits: <số dòng> }` (ADR-90).
6. Trả `{ log, transactions }`.

## Alternative Flows
- Không có tuỳ chọn tạo rule từ lần gán (REST `POST /v1/logs/:id/assign` có `create_rule`; tool không có).

## Exceptions
- E0. `assign_log` với token chỉ có quyền Xem → HTTP 403 `insufficient_scope` trước khi tool chạy, không ghi gì (UC-601 AC-11).
- E1. Không có split → tool error "Cần ít nhất một dòng gán." (zod `.min(1)` chặn trước ở tầng SDK).
- E2. Không có log → tool error "Không có log này."; log đã xử lý → "Log này đã được xử lý."
- E3. Tổng split ≠ số tiền log → tool error `split_mismatch` "Tổng các dòng (<tổng>) phải bằng đúng số tiền log (<số>)."
- E4. Lỗi kiểm của `buildEntry` với trường mới (`income_only`, `unknown_tenant`/`inactive_tenant`, `unknown_income_stream`/`inactive_income_stream`, `same_wallet`/`locked_wallet`/`missing_wallet`, `debt_spend_only`/`unknown_debt`/`inactive_debt`, `receivable_only`/`unknown_receivable`/`inactive_receivable`) → tool error với thông điệp tương ứng.
- Mọi lỗi E1–E4 là JSON-RPC 200 + `isError: true`, không phải HTTP 500; không ghi nhật ký.

## Acceptance Criteria
### AC-1: Liệt kê log chưa gán
- Given log `L1` `pending` 10.000 vào `vcb-husband`
- When `list_pending_logs`
- Then HTTP 200, không `isError`, nội dung chứa `L1`
- Tests: `test/mcp.test.ts` › "tool đọc số liệu › list_pending_logs trả các log chưa gán"

### AC-2: Tổng tách sai là tool error, không phải HTTP 500
- Given log `L2` `pending` 50.000 tiền ra
- When `assign_log { log_id: "L2", splits: [{ meaning: "spend", amount: 10000, category_id: "groceries" }] }`
- Then HTTP 200, `isError: true`
- Tests: `test/mcp.test.ts` › "tool đọc số liệu › assign_log sai (tổng tách không khớp số tiền log) trả lỗi tool, không phải HTTP 500"

### AC-3: Gán đúng qua MCP ghi sổ như REST
- Given log `pending`
- When `assign_log` với split tổng đúng
- Then log thành đã gán và các giao dịch được tạo giống `POST /v1/logs/:id/assign` do người đã uỷ quyền gán
- Tests: ⚠ Chưa có test

### AC-4: Gán tiền người thuê / chuyển kèm ví qua MCP
- Given log `in` (hoặc `out`) `pending`
- When `assign_log` với split `income` kèm `tenant_id` (hoặc `transfer` kèm `from_wallet_id` + `wallet_id`)
- Then giống hệt REST (ingest UC-305 AC-11, AC-12) do người đã uỷ quyền gán
- Tests: ⚠ Chưa có test qua MCP (luật được thử ở `test/ingest.test.ts`, ingest UC-305)

### AC-5: Gán log tiền vào là nhận lại tiền cho vay qua MCP
- Given khoản phải thu `em-hai` còn 1.500.000; log `in` 300.000 ở `vcb-husband` `pending`
- When `assign_log { log_id, splits: [{ meaning: "collect", amount: 300000, receivable_id: "em-hai" }] }`
- Then không lỗi; `get_receivables` trả `totalBalance = 1.200.000`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "sổ phải thu › add_transaction nhận collect + receivable_id; assign_log nhận split collect"

### AC-6: Gán nhận lại tiền cho vay nối về khoản cho vay gốc qua MCP
- Given Em Hai; `add_transaction` cho vay 1.000.000 Em Hai (khoản L); log `in` 400.000 và 100.000 ở `vcb-husband` `pending`
- When `assign_log` log 400.000 với `[{ meaning: "collect", amount: 400000, link_id: L }]`; log 100.000 với `link_id: 9999`
- Then lần đầu không lỗi, giao dịch `collect` có `link_id = L`, `receivable_id = em-hai`; lần sau tool error, log vẫn `pending`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "sổ phải thu › assign_log nhận link_id trên split như REST: nhận lại nối về khoản cho vay, lấy người của nó; khoản gốc sai → lỗi tool, log vẫn chờ (change 261005-lien-ket-khoan-goc)"

### AC-7: Người gán là người đã uỷ quyền; cần quyền Ghi; nhật ký `via = mcp`
- Given kết nối chỉ có quyền Xem
- When `assign_log`
- Then HTTP 403 `insufficient_scope`; không ghi gì
- Given log `L9` `pending` 50.000 tiền ra ở `vcb-husband`; kết nối do `wife` uỷ quyền, có quyền Ghi
- When `assign_log { log_id: "L9", splits: [{ meaning: "spend", amount: 50000, category_id: "groceries" }] }`
- Then không lỗi; giao dịch của `L9` có `by_member_id = "wife"`; nhật ký `log.assign` với người làm `wife`, `via = mcp`, đích `log:L9`
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì"; [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › assign_log ghi người làm là người uỷ quyền, nhật ký via=mcp"

## Traceability
- Code: `src/mcp/tools.ts` › `registerTools` (tool `list_pending_logs`, `assign_log`, `actor` `{ memberId, via: "mcp" }`), `WRITE_TOOLS`; `src/routes/mcp.ts` › `mcpHandler` (kiểm `mcp:write` ở tầng HTTP); `src/services/audit.ts` › `audit`; `src/services/ingest.ts` › `listPendingLogs`, `assignLog`, `Split`; `src/routes/logs.ts` (REST tương đương)
- Liên quan: `specs/ingest/` (UC-305 Gán log chưa gán)

## Divergences & Open Questions
- [OPEN] Mặc định `limit` khác REST: MCP 20, `GET /v1/logs` 50 (`src/routes/logs.ts`).
