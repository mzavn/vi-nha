# UC-108: Chi theo danh mục (so với tháng trước)
- Status: implemented
- BR: BR-01, BR-05
- Decisions: `docs/core_design_rules.md` §9 "Danh mục: tách khỏi ví"; `docs/profit_first_phuong_phap.md` §6 (ba trục); ADR-92 (tên tiếng Anh: tool MCP `get_spending_by_category`)
- Actor: thành viên (màn Ví, khối phân tích), Claude (MCP `get_spending_by_category`)
- Trigger: `GET /v1/spend-by-category?period=YYYY-MM` (không gửi = tháng hiện tại theo giờ VN)

## History
- v1 (2026-09-22, commit `b92fc0f`): `spendByCategory` đọc `v_spend_by_category` cho tháng được hỏi và tháng liền trước.
- v2 (2026-10-07, commit `7424f26`): tool MCP đọc chi theo danh mục đổi tên `spend_by_category` → `get_spending_by_category` (ADR-92); hàm `spendByCategory`, `GET /v1/spend-by-category`, view `v_spend_by_category` và số liệu không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- `period` đúng dạng `YYYY-MM` (tháng 01–12).

## Main Flow
1. Tính tháng liền trước (tháng 01 → tháng 12 năm trước).
2. Đọc `v_spend_by_category` cho hai tháng: chi ròng = Σ `spend` − Σ `refund` theo `category_id` × `month_key`, chỉ giao dịch `active`.
3. Gộp theo danh mục: `spent` (tháng hỏi, mặc định 0), `previousSpent` (tháng trước, mặc định 0), `name` (tên danh mục; không có thì dùng mã).
4. Sắp giảm dần theo `spent`; trả `{month, previous, categories}`.

## Alternative Flows
- 2a. Danh mục chỉ có chi ở tháng trước vẫn xuất hiện với `spent = 0`.

## Exceptions
- E1. Tháng sai dạng → `invalid_period` 400 "Tháng phải có dạng 2026-09."

## Acceptance Criteria
### AC-1: Chi ròng theo danh mục, có cột tháng trước
- Given tháng 09 chi `groceries` 400.000 và hoàn 100.000; tháng 08 chi `groceries` 200.000
- When `GET /v1/spend-by-category?period=2026-09`
- Then dòng `groceries`: `spent = 300.000`, `previousSpent = 200.000`; `previous = "2026-08"`
- Tests: ⚠ Chưa có test

### AC-2: Tháng 1 so với tháng 12 năm trước
- Given `period=2027-01`
- When gọi
- Then `previous = "2026-12"`
- Tests: ⚠ Chưa có test

### AC-3: Kỳ sai dạng bị từ chối
- Given `period=2026-13`
- When gọi
- Then 400 `invalid_period`
- Tests: ⚠ Chưa có test

## Traceability
- Code: `src/routes/v1.ts` › `GET /spend-by-category`; `src/services/ledger.ts` › `spendByCategory`
- Migrations/DB: view `v_spend_by_category` (`migrations/0001_schema.sql`)
- Dùng bởi: MCP `get_spending_by_category` (mcp UC-602); top 5 danh mục của tổng kết tuần tính riêng ở notify UC-406.

## Divergences & Open Questions
- [OPEN] `refund` không có danh mục (không gửi `category_id`, không `link_id`) được gộp vào nhóm `category_id = NULL` với giá trị âm; code trả `categoryId: null`, `name: null`.
- [OPEN] Danh mục đã tắt (`active = 0`) vẫn hiện nếu có chi — view không lọc `categories.active`.
- [DIVERGENCE] `src/services/ledger.ts` dòng 2: "REST, MCP và cron đều đi qua đây — không route nào tự viết SQL nghiệp vụ" — `src/cron/weekly.ts` tự viết lại công thức `spend − refund` theo `week_key` cho top 5 danh mục thay vì đi qua ledger.
