# UC-803: Xem tạm tính tháng & bảng kê
- Status: implemented
- BR: BR-11
- Decisions: ADR-58 (sổ phải thu, chỉ đọc), ADR-61 (phí cố định + chi chung chia đều; chênh lệch mang sang bằng số dư); change `261001-cho-thue-lai`; ADR-92 (tên tool MCP tiếng Anh)
- Actor: người trong hộ, mỗi tuần ngồi với người thuê (PWA Ví & Quỹ › Người thuê — [UC-713](../pwa/UC-713-man-nguoi-thue.md)); Claude qua MCP `list_tenants` (chỉ số dư)
- Trigger: `GET /v1/rental/tenants/:id/month?month=YYYY-MM` (mặc định tháng hiện tại theo giờ VN); `GET /v1/rental`

## History
- v1 (2026-10-01, commit `034b7ff`): tạm tính theo tháng (số dư đầu kỳ, dòng đã ghi, bản nháp chốt, tiền đã chuyển, số dư cuối), bảng kê chữ để chép gửi người thuê; tool MCP `get_tenants` (change `261001-cho-thue-lai`).
- v2 (2026-10-07, commit `7424f26`): tool MCP `get_tenants` đổi tên `list_tenants` (ADR-92); mô tả tool tiếng Anh; dữ liệu trả về không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).

## Preconditions
- Người thuê tồn tại. Không ghi gì — gọi bao nhiêu lần cũng được.

## Main Flow
1. Kiểm `month` dạng `YYYY-MM` và không sau tháng hiện tại.
2. Đọc trong một batch: lần chốt của (người thuê, tháng) nếu có; dòng sổ `active` của tháng (theo `at`, `id`); khoản `income` `active` mang `tenant_id` của tháng (**tiền đã chuyển**); số dư trước tháng; số dư hôm nay (`v_tenant_balance`); phí cố định.
3. **Số dư đầu tháng** `openingBalance` = Σ dòng sổ `active` có `month_key < tháng` − Σ `income` mang `tenant_id` có `month_key < tháng`.
4. Chưa chốt: số người = `config.rental_headcount`; **tổng chi chung** = Σ (`spend` − `refund`) `active` của hộ trong danh mục chi chung, `month_key` = tháng + Σ (−`amount`) các dòng `paid_for_us` `active` của mọi người thuê trong tháng; **bản nháp** = `monthDraft(phí, tổng, số người)`.
   Đã chốt: số người và tổng lấy từ `tenant_settlements`; bản nháp rỗng (dòng chốt đã nằm trong "dòng đã ghi").
5. `share = sharePerHead(tổng, số người)` = `floor(tổng / số người)` (tổng ≤ 0 hoặc số người không hợp lệ → 0).
6. **Số dư cuối tháng** `closingBalance` = đầu tháng + Σ dòng đã ghi + Σ nháp − Σ tiền đã chuyển (tạm tính nếu chưa chốt).
7. Trả `{ month, settled, openingBalance, sharedTotal, headcount, share, draft, lines, payments[{transactionId, at, amount}], closingBalance, balance, text }`.

**Bảng kê** (`text`, `statementText`): dòng đầu `Bảng kê tháng M/YYYY — <tên>` (+ ` (tạm tính)` khi chưa chốt); `Số dư tháng trước: …`; mỗi dòng sổ rồi mỗi dòng nháp
(`Chi chung (<tổng> ÷ <n> người): …`, `<tên> đã chi hộ (<ghi chú>): −…`); mỗi khoản đã chuyển `Đã chuyển dd/mm: −…`; dòng cuối `Còn phải trả: …` / `Trả dư: … — trừ vào tháng sau` / `Đã thanh toán đủ`. Tiền theo `vi-VN`, dấu trừ U+2212.

## Alternative Flows
- 1a. Không gửi `month` → tháng hiện tại.
- 2a. `GET /v1/rental` / MCP `list_tenants`: chỉ số dư hôm nay của mọi người thuê + phí + cấu hình, không có tạm tính tháng.
- 4a. Tháng đã qua mà chưa chốt: vẫn có bản nháp (dùng phí và số người **hiện tại**).

## Exceptions
- E1. `month` sai dạng → 400 `invalid_month`; tháng sau tháng hiện tại → 400 `future_month`.
- E2. Người thuê không có → 404 `not_found`.

## Acceptance Criteria

### AC-1: Tạm tính đúng ví dụ của proposal
- Given An có bốn phí (2.500.000 + 50.000 + 75.000 + 66.667); hộ chi `groceries` 7.300.000, `utilities` 560.000, `fuel-parking` 999.000 (không phải chi chung); An chi hộ 300.000; số người 3
- When xem tạm tính tháng 10
- Then `sharedTotal = 8.160.000`, `share = 2.720.000`, nháp = `[2.500.000, 50.000, 75.000, 66.667, 2.720.000]`, `closingBalance = 5.111.667`, `balance` (hôm nay) = −300.000, `settled = false`
- Tests: `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau"

### AC-2: Phần chi chung làm tròn xuống, phần lẻ hộ chịu
- Given tổng 10 ₫, 3 người; tổng âm
- When tính phần mỗi người
- Then 3 ₫; tổng âm → 0
- Tests: `test/rental.test.ts` › "domain rental › phần chi chung = floor(tổng / số người), phí tắt không vào nháp"

### AC-3: Tiền đã chuyển hiện trong tháng, bảng kê nói rõ số dư mang sang
- Given tháng 10 đã chốt 5.111.667, An chuyển 5.191.667 ngày 10/10
- When xem tạm tính tháng 10
- Then `payments = [{ amount: 5.191.667, at: 2026-10-10… }]`, `closingBalance = −80.000`; bảng kê có `Chi chung (8.160.000 ₫ ÷ 3 người): 2.720.000 ₫` và `Trả dư: 80.000 ₫ — trừ vào tháng sau`
- Tests: `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau"

### AC-4: Số dư đầu tháng mang từ các tháng trước
- Given số dư mở sổ 7.075.000 ghi tháng 9
- When xem tháng 10 (không gửi `month`)
- Then `month = "2026-10"`, `openingBalance = 7.075.000`
- Tests: `test/rental.test.ts` › "/v1/rental › số dư mở sổ là dòng opening; tháng sau thấy nó ở số dư đầu kỳ"

### AC-5: Dấu số dư: dương còn nợ, âm trả dư
- Given số dư 500.000 / −80.000 / 0
- When hiển thị
- Then "còn nợ 500.000 ₫" / "trả dư 80.000 ₫, trừ tháng sau" / "đã hết nợ"
- Tests: `web/src/lib/rental.test.ts` › "số dư người thuê › dương là còn nợ, âm là trả dư mang sang tháng sau"

### AC-6: Xem tạm tính không ghi gì
- Given bất kỳ trạng thái nào
- When gọi `GET …/month` nhiều lần
- Then không có dòng `tenant_lines`/`tenant_settlements` mới
- Tests: ⚠ Chưa có test

### AC-7: Không xem được tháng chưa tới
- Given hôm nay tháng 10
- When `GET …/month?month=2026-11`
- Then 400 `future_month`
- Tests: ⚠ Chưa có test (chỉ có test cho chốt tháng — UC-804 AC-3)

## Traceability
- Code: `src/routes/rental.ts` (`GET /tenants/:id/month`, `GET /`); `src/services/rental.ts` › `tenantMonth`, `sharedTotal`, `parseMonth`, `getRental`; `src/domain/rental.ts` › `sharePerHead`, `monthDraft`, `closingBalance`, `statementText`; `src/mcp/tools.ts` › tool `list_tenants`
- PWA: `web/src/screens/tenants.tsx` › `TenantMonthCard`; `web/src/lib/rental.ts` › `balanceText`
- Migrations/DB: `v_tenant_balance`, `tenant_lines`, `tenant_settlements`, `transactions.tenant_id` (`migrations/0007_income_streams_rental.sql`)

## Divergences & Open Questions
- [DIVERGENCE] Proposal v5 (UC-804) muốn bảng kê có dòng "đề xuất chuyển tháng sau = phí cố định + phần chi chung theo ngân sách"; `statementText` không có dòng này — chỉ có số dư cuối và "Còn phải trả"/"Trả dư".
- [OPEN] Tổng chi chung gồm mọi `spend`/`refund` của hộ trong danh mục chi chung, kể cả chi từ ví `private` hay ví cá nhân; người xem không ảnh hưởng (không ẩn theo D6).
- [OPEN] Tháng đã qua chưa chốt dùng phí và số người **hiện tại**, không phải của tháng đó.
- [OPEN] `month_key` của tiền đã chuyển theo ngày tiền về (giờ VN); tiền tháng 10 chuyển ngày 2/11 nằm ở tháng 11 — đúng ý "chênh lệch tự mang sang", nhưng bảng kê tháng 10 sẽ báo "Còn phải trả".
