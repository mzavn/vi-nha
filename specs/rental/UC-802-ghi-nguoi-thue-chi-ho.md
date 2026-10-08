# UC-802: Ghi người thuê chi hộ & dòng sổ tay
- Status: implemented
- BR: BR-11, BR-03
- Decisions: ADR-58 (sổ phải thu ngoài sổ cái, chỉ ghi thêm), ADR-61 (chi hộ cộng vào chi chung); change `261001-cho-thue-lai`; ADR-92 (tên tool MCP tiếng Anh)
- Actor: người trong hộ (PWA "Loại khác › Người thuê chi" — [UC-705](../pwa/UC-705-nhap-loai-khac.md); màn Người thuê — [UC-713](../pwa/UC-713-man-nguoi-thue.md)); Claude qua MCP `add_tenant_shared_expense`
- Trigger: `POST /v1/rental/tenants/:id/lines { kind, amount, name?, category_id?, at?, client_id? }`; huỷ: `POST /v1/rental/lines/:id/void`

## History
- v1 (2026-10-01, commit `034b7ff`): ghi tay `paid_for_us` / `one_off` / `adjust`, chống trùng `client_id`, huỷ dòng; tool MCP `add_tenant_paid_for_us` (change `261001-cho-thue-lai`).
- v2 (2026-10-07, commit `7424f26`): tool MCP `add_tenant_paid_for_us` đổi tên `add_tenant_shared_expense`, `get_tenants` đổi tên `list_tenants` (ADR-92); mô tả tool tiếng Anh; tham số, `kind = paid_for_us` và câu tóm tắt "Đã ghi người thuê chi hộ …" không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).

## Preconditions
- Người thuê tồn tại. Cần mạng (sổ người thuê không đi qua hàng đợi offline).

## Main Flow — người thuê chi hộ (`paid_for_us`)
1. Người chọn người thuê, nhập số tiền **dương**, chọn danh mục chi chung (PWA chỉ liệt kê `sharedCategoryIds`), ghi chú, ngày (không quá hôm nay).
2. Server: có `client_id` và đã có dòng mang `client_id` đó → trả lại dòng cũ, 200 (bỏ qua bước 3–6).
3. Kiểm `kind ∈ {one_off, adjust, paid_for_us}`, `amount` nguyên dương; `category_id` bắt buộc và phải thuộc danh mục chi chung; người thuê phải `active`.
4. `name` không gửi → lấy tên danh mục. `at` chuẩn hoá bằng `normalizeAt` (sai dạng → `invalid_at`; quá một ngày ở tương lai → `future_at`), `month_key = monthKey(at)`.
5. Ghi một dòng `tenant_lines` với `amount = −số tiền` (giảm nợ) → 201.
6. Hệ quả: số dư người thuê giảm; **tổng chi chung tháng** đó tăng đúng số tiền (UC-803) — nên phần của mỗi người tăng `số tiền / số người`. Không ví, không tài khoản nào của hộ bị đụng.

## Alternative Flows
- 1a. **Phí một lần** (`one_off`, thẻ xe 100.000): số dương, **bắt buộc** `name`; lưu dương (nợ thêm). Không cần danh mục.
- 1b. **Chỉnh tay** (`adjust`): số ≠ 0, có dấu (dương = nợ thêm, âm = giảm nợ). PWA đòi tên/lý do; server không đòi.
- 1c. **MCP** `add_tenant_shared_expense { tenant_id, amount, category_id, note? }` gọi đúng `addLine(kind='paid_for_us')`; `note` thành `name`. Trả dòng đã ghi và câu "Đã ghi người thuê chi hộ …".
- 2a. Hai request cùng `client_id` chạy song song: bên thua gặp lỗi UNIQUE, đọc lại và trả dòng bên thắng (200).
- 7. **Huỷ dòng**: `POST /v1/rental/lines/:id/void` → `status = 'void'`, số dư người thuê đổi ngược lại. Áp cho mọi `kind`, kể cả dòng do chốt tháng ghi (cách sửa tháng đã chốt — UC-804).

## Exceptions
- E1. `kind` khác ba loại trên → 400 `invalid_kind` (dòng `fixed`/`shared` chỉ ghi qua chốt tháng; `opening` chỉ qua tạo người thuê).
- E2. `amount` không nguyên/0/quá 1e12 → 400 `invalid_amount`; `paid_for_us`/`one_off` ≤ 0 → 400 `invalid_amount`.
- E3. `paid_for_us` thiếu `category_id` → 400 `invalid_input`; danh mục không thuộc chi chung → 400 `not_shared_category`; người thuê đã ra → 400 `tenant_inactive`.
- E4. `one_off` thiếu tên → 400 `invalid_input`.
- E5. `client_id` đã dùng cho người thuê khác → 409 `client_id_conflict`.
- E6. Người thuê / dòng không có → 404 `not_found`; huỷ dòng đã huỷ → 409 `already_void`.
- E7. MCP: lỗi nghiệp vụ trả `isError: true` kèm thông điệp, không ghi gì.

## Acceptance Criteria

### AC-1: Chi hộ gửi số dương, lưu số âm, cộng vào tổng chi chung
- Given hộ chi ăn 7.300.000 + điện nước 560.000 trong tháng 10
- When ghi An chi hộ 300.000 danh mục `groceries`
- Then dòng lưu `amount = −300.000`; tổng chi chung tháng = 8.160.000; số dư An −300.000
- Tests: `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau"; `web/src/lib/rental.test.ts` › "dòng ghi tay › người thuê chi hộ: gửi số dương, phải thuộc danh mục chi chung"

### AC-2: Chỉ ghi chi hộ được cho danh mục chi chung
- Given danh mục `fuel-parking` không thuộc chi chung
- When ghi chi hộ 50.000 vào `fuel-parking` (REST hoặc MCP)
- Then REST 400 `not_shared_category`; MCP `isError: true`; không có dòng nào được ghi
- Tests: `test/rental.test.ts` › "/v1/rental › dòng ghi tay idempotent theo client_id; chi hộ chỉ nhận danh mục chi chung"; `test/mcp.test.ts` › "sổ người thuê › add_tenant_shared_expense với danh mục không phải chi chung → tool error"

### AC-3: Gửi lại cùng `client_id` chỉ ghi một lần
- Given đã ghi chi hộ với `client_id = "pfu-1"`
- When gửi lại đúng request đó
- Then 200, số dư không đổi (−300.000)
- Tests: `test/rental.test.ts` › "/v1/rental › dòng ghi tay idempotent theo client_id; chi hộ chỉ nhận danh mục chi chung"

### AC-4: MCP ghi chi hộ như REST
- Given An, danh mục `groceries`
- When Claude gọi `add_tenant_shared_expense { tenant_id: "an", amount: 300000, category_id: "groceries", note: "Đi chợ" }`
- Then dòng `{ kind: paid_for_us, amount: −300.000, categoryId: groceries, name: "Đi chợ" }`; `list_tenants` thấy số dư giảm
- Tests: `test/mcp.test.ts` › "sổ người thuê › add_tenant_shared_expense ghi dòng âm; list_tenants thấy số dư giảm"

### AC-5: Phí một lần cần tên; chỉnh tay có dấu
- Given form ghi tay
- When phí một lần không tên; hoặc chỉnh giảm nợ 200.000
- Then phí một lần bị chặn ("Nhập tên khoản phí."); chỉnh gửi `amount = −200.000`
- Tests: `web/src/lib/rental.test.ts` › "dòng ghi tay › chỉnh giảm nợ gửi số âm; phí một lần cần tên"; phía server (E4): ⚠ Chưa có test

### AC-6: Huỷ dòng đổi số dư; huỷ lần hai báo lỗi
- Given dòng chi hộ −300.000
- When huỷ dòng
- Then số dư về 0; huỷ lần hai → 409 `already_void`
- Tests: `test/rental.test.ts` › "/v1/rental › huỷ dòng sổ đổi số dư; huỷ giao dịch tiền trả thì số dư trở lại"

### AC-7: Người thuê đã ra không ghi chi hộ được
- Given người thuê `active = false`
- When ghi chi hộ
- Then 400 `tenant_inactive`
- Tests: ⚠ Chưa có test

### AC-8: Sổ chỉ ghi thêm ở tầng DB
- Given một dòng `tenant_lines`
- When UPDATE cột khác `status`, hoặc đổi `void → active`, hoặc DELETE
- Then DB ABORT `tenant_line_append_only`
- Tests: ⚠ Chưa có test

## Traceability
- Code: `src/routes/rental.ts` (`POST /tenants/:id/lines`, `POST /lines/:id/void`); `src/services/rental.ts` › `addLine`, `voidLine`; `src/mcp/tools.ts` › tool `add_tenant_shared_expense`
- PWA: `web/src/screens/other-entry-sheet.tsx` › `TenantPaidForm`; `web/src/screens/tenants.tsx` › `LineSheet`, nút "Huỷ dòng"; `web/src/lib/rental.ts` › `linePayload`
- Migrations/DB: `tenant_lines` (CHECK `paid_for_us`, UNIQUE `client_id`), trigger `trg_tenant_lines_append_only`, `trg_tenant_lines_no_delete` (`migrations/0007_income_streams_rental.sql`)

## Divergences & Open Questions
- [OPEN] Gửi lại `client_id` của một dòng đã `void` vẫn trả dòng void với 200 (tra theo `client_id`, không lọc `status`) — giống [OPEN] tương tự ở ledger UC-101.
- [OPEN] Danh mục chi chung được kiểm **lúc ghi**; bỏ danh mục khỏi cấu hình sau đó thì chi hộ cũ vẫn cộng vào tổng chi chung (câu `sharedTotal` cộng mọi `paid_for_us` của tháng, không lọc theo danh mục hiện tại), trong khi phần chi của hộ ở danh mục đó thì không còn được cộng.
- [OPEN] Chi hộ của **mọi** người thuê cộng vào một tổng chung rồi chia đều; một người thuê chi hộ nhiều thì các người thuê khác cũng chịu phần đó — đúng công thức proposal, nhưng chưa được nói rõ khi có hơn một người thuê.
- [OPEN] Dòng ghi tay không giới hạn tháng: ghi lùi ngày vào tháng đã chốt được (dòng vào tháng đó, số dư đổi), nhưng tổng chi chung đã lưu lúc chốt không đổi theo.
