# UC-606: Cập nhật giá tài sản qua MCP
- Status: implemented
- BR: BR-05, BR-15
- Decisions: ADR-97 (MCP dùng OAuth 2.1 — tool ghi như người đã uỷ quyền); ADR-98 (quyền Ghi tick sẵn, bỏ được — tool ghi cần `mcp:write`); ADR-90 (nhật ký thay đổi chỉ thêm); ADR-92 (tên và mô tả tool tiếng Anh); ADR-100 (định giá là dòng chỉ ghi thêm có ngày, số hiện tại là dòng mới nhất); ADR-101 (dòng tiền thật tách lợi suất kỳ vọng, số nhập luôn kèm kỳ); ADR-103 (giá theo ngày thuộc mục, áp cho mọi lô của mục; vàng định giá theo giá tiệm mua vào)
- Actor: Claude (hoặc ứng dụng AI đã nối — [UC-601](UC-601-noi-claude-bang-oauth.md)), thay mặt người đã uỷ quyền kết nối ("vàng hôm nay 5 triệu 250 một chỉ")
- Trigger: MCP `tools/call` `record_asset_value`

Cùng luật với ô **Cập nhật giá** ở màn Tài sản & tự do (balance [UC-1101](../balance/UC-1101-quan-ly-tai-san-lo-gia.md) bước cập nhật giá): MCP chỉ là một cửa khác ghi **một dòng định giá** cho một mục tài sản đã có. Không có tool tạo / sửa / xoá mục, thêm / bán / huỷ lô, đặt giá chốt lời / cắt lỗ hay phân loại lại báo cáo — những việc đó làm ở app.

## History
- v1 (2026-10-08, commit `8cd48b8`): khởi tạo — tool ghi `record_asset_value` (`item_id`; `value` cho mục theo giá trị hoặc `unit_price` cho mục theo lô; tuỳ chọn `as_of`, `cashflow`, `cashflow_period`, `expected_return`) gọi đúng hàm của `POST /v1/balance-items/:id/values`; nằm trong `WRITE_TOOLS` (cần quyền Ghi); ghi nhật ký `balance.value.add` `via = mcp` mang người uỷ quyền; không bao giờ tạo giao dịch. AC-1 (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))

## Preconditions
- Đã qua UC-601: token của kết nối có quyền `mcp:write` (Ghi).
- Mục tài sản đã có (thêm ở app — balance UC-1101); Claude lấy `item_id` từ `get_balance_sheet` › `items` (UC-602).

## Main Flow
1. Claude gọi `record_asset_value { item_id, value? | unit_price?, as_of?, cashflow?, cashflow_period?, expected_return? }`. SDK kiểm input theo zod: `item_id` chuỗi không rỗng; `value`, `unit_price`, `cashflow` số nguyên ≥ 0 (đồng); `cashflow_period` ∈ `month | year`; `expected_return` số (%/năm); `as_of` chuỗi.
2. Gọi `balance.addValue(db, item_id, …, người uỷ quyền, now)` — cùng hàm với `POST /v1/balance-items/:id/values` (balance UC-1101), cùng luật:
   - Mục **theo giá trị** nhận `value` (giá trị cả mục); mục **theo lô** nhận `unit_price` (giá một đơn vị, áp cho mọi lô của mục — với vàng là giá tiệm mua vào). Thiếu số cần có → E3; gửi số của cách tính kia → E4.
   - `as_of` = ngày định giá `YYYY-MM-DD` (giờ VN), bỏ trống = hôm nay; không được sau hôm nay.
   - `cashflow` = dòng tiền thật nhận được từ tài sản (sau thuế), > 0 thì phải kèm `cashflow_period` (`month` | `year`); `expected_return` = lợi suất kỳ vọng %/năm trong −100…1000, lưu phần vạn (12 → 1200) — chỉ để xem / dự phóng, không phải thu nhập (ADR-101).
3. Ghi **thêm** một dòng `balance_values` (`status = active`, `by_member_id` = người uỷ quyền) — không sửa dòng cũ; giá hiện tại của mục là dòng `active` có `as_of` lớn nhất (cùng ngày: dòng ghi sau). Không tạo giao dịch nào; ví, số dư tài khoản, "còn để chi" không đổi.
4. Ghi nhật ký thay đổi `balance.value.add`, đích `balance_item:<item_id>`, người làm = người đã uỷ quyền, `via = mcp`, chi tiết rỗng (ADR-90); không báo cả nhà.
5. Trả mục sau khi ghi (cùng hình dạng mục trong `get_balance_sheet` › `items`: `value`, `unitPrice`, lô, lãi / lỗ, trạng thái…) kèm tóm tắt `Đã cập nhật giá <tên>: <giá> ₫/<đơn vị>.` (mục theo lô) hoặc `Đã cập nhật giá <tên>: <giá trị> ₫.` (mục theo giá trị).

## Alternative Flows
- 2a. Ghi nhầm → huỷ dòng định giá ở app (`POST /v1/balance-values/:id/void`, balance UC-1101); MCP không có tool huỷ.

## Exceptions
- E0. Token chỉ có quyền Xem (`mcp:read`) → HTTP 403 `insufficient_scope` (challenge ghi đủ `mcp:read mcp:write`) trước khi tool chạy, không ghi gì ([UC-601](UC-601-noi-claude-bang-oauth.md) AC-11).
- E1. Input sai schema zod (thiếu `item_id`, số âm hay không nguyên, `cashflow_period` lạ) → tool error do SDK tạo; handler không chạy, không ghi gì.
- E2. `item_id` không có → tool error `not_found` "Không có mục tài sản này.".
- E3. Thiếu `value` (mục theo giá trị) / `unit_price` (mục theo lô) → `invalid_amount` "Thiếu value." / "Thiếu unit_price.".
- E4. Gửi `unit_price` cho mục theo giá trị / `value` cho mục theo lô → `wrong_measure`.
- E5. `as_of` sai dạng → `invalid_input` "as_of có dạng 2026-10-01."; sau hôm nay → `future_date` "Ngày không được sau hôm nay.".
- E6. `cashflow` > 0 mà thiếu kỳ → `missing_period` "Dòng tiền phải kèm kỳ: tháng hay năm."; `expected_return` ngoài −100…1000 → `invalid_rate`.
- Mọi lỗi E2–E6 là tool error trong JSON-RPC 200 (`isError: true`), không ghi gì, không ghi nhật ký.

## Postconditions
- Thêm đúng một dòng định giá `active` cho mục; bảng cân đối, tháp, lãi / lỗ từng lô và Mốc tự do lần đọc sau dùng giá mới (balance UC-1102, UC-1103); không có giao dịch, ví hay số dư tài khoản nào đổi.

## Acceptance Criteria

### AC-1: "Vàng hôm nay 5 triệu 250 một chỉ" → một dòng giá, nhật ký `via = mcp`; quyền chỉ Xem bị 403
- Given mục "Vàng" (`vang`, A1, phòng vệ, theo lô "chỉ") có lô 24 chỉ mua 2026-01-10 giá 5.000.000 ₫/chỉ; kết nối Claude của `wife` có quyền Ghi; kết nối khác của `husband` chỉ Xem
- When qua kết nối của `wife`: `record_asset_value { item_id: "vang", unit_price: 5250000 }`; rồi qua kết nối của `husband`: `record_asset_value { item_id: "vang", unit_price: 1 }`
- Then lần đầu tool trả mục `vang` có `unitPrice = 5.250.000`, `value = 126.000.000` (24 chỉ × 5.250.000 — như balance [UC-1101](../balance/UC-1101-quan-ly-tai-san-lo-gia.md) AC-2); nhật ký đúng một dòng `balance.value.add` với người làm `wife`, `via = mcp`, đích `balance_item:vang`; không có giao dịch nào được ghi. Lần hai HTTP 403 `insufficient_scope`, không ghi gì
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › UC-606 AC-1: record_asset_value { item_id: vang, unit_price: 5.250.000 } → giá Vàng hôm nay, nhật ký via=mcp; quyền chỉ Xem → 403"; [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì"

## Dependencies
- Upstream UC: [UC-601](UC-601-noi-claude-bang-oauth.md) (kết nối, quyền Ghi); balance [UC-1101](../balance/UC-1101-quan-ly-tai-san-lo-gia.md) (mục tài sản, luật định giá)
- Downstream UC: [UC-602](UC-602-doc-so-lieu-qua-mcp.md) (`get_balance_sheet` đọc giá mới); balance [UC-1102](../balance/UC-1102-xem-bang-can-doi.md), [UC-1103](../balance/UC-1103-moc-tu-do.md); pwa [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md)

## Divergences & Open Questions
- [OPEN] Trang đồng ý ở UC-601 mô tả quyền Ghi là "Ghi giao dịch, gán, chia tiền" (`src/oauth/routes.ts`) — chưa nói quyền này cũng cho cập nhật giá tài sản. Chưa quyết có đổi chữ không.
- [OPEN] Lỗi E2–E6 qua MCP chưa có test riêng (luật nằm ở `balance.addValue`, test REST ở balance UC-1101).

## Traceability
- Code: `src/mcp/tools.ts` › `registerTools` (tool `record_asset_value`, `actor` `{ memberId, via: "mcp" }`), `WRITE_TOOLS`; `src/routes/mcp.ts` › `mcpHandler`, `callsWriteTool` (kiểm `mcp:write` ở tầng HTTP); `src/services/audit.ts` › `audit`; `src/services/balance.ts` › `addValue`, `valueRow`, `insertValue`, `itemRow`, `getItem`
- API tương đương: `POST /v1/balance-items/:id/values` (`src/routes/balance.ts`, nhật ký `balance.value.add` `via = session|token`)
- Dữ liệu: bảng `balance_values` (chỉ ghi thêm, trigger chặn sửa số / xoá — `migrations/0031_balance_sheet.sql`, schema v1.31); `audit_log`
