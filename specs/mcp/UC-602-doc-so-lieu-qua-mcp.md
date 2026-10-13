# UC-602: Đọc số liệu qua MCP (`get_snapshot` = màn Hôm nay)
- Status: implemented
- BR: BR-05, BR-01, BR-07, BR-04, BR-15
- Decisions: `plans/260921-2228-profit-first-pwa/phase-06-mcp.md` §Tools ("`get_snapshot` … đúng dữ liệu của `GET /v1/snapshot` (cùng hàm)"), §Success; báo cáo `plans/reports/fullstack-developer-260922-0020-mcp-server.md` quyết định 1 (người xem mặc định = chủ hộ — đã thay bằng người uỷ quyền kết nối, ADR-97) và 5 (`list_transfer_orders` cố định `pending`); commit `bc0d2a2`; ADR-92 (tên và mô tả tool tiếng Anh), ADR-93 (Quỹ an tâm); ADR-97 (MCP dùng OAuth 2.1 — tool chạy như người đã uỷ quyền); ADR-99 (bảng cân đối là số thật — tiền, phải thu, nợ luôn từ sổ); ADR-100 (tính theo trạng thái tại từng ngày — `get_balance_sheet { date }`); ADR-101 (dòng tiền thật tách lợi suất kỳ vọng); ADR-104 (nhóm lưu chuyển suy từ dữ liệu, phân loại lại từng giao dịch); ADR-105 (Thử số tính ở máy, không lưu — không có tool)
- Actor: Claude (hoặc ứng dụng AI đã nối — UC-601), thay mặt người đã uỷ quyền kết nối
- Trigger: MCP `tools/call` với `get_snapshot`, `get_budget`, `get_goals`, `list_categories`, `get_spending_by_category`, `list_transfer_orders`, `get_reconciliation`, `get_balance_sheet`, `get_reports`; MCP `tools/list` (mô tả tool)

## History
- v1 (2026-09-22, commit `bc0d2a2`): bảy tool đọc, mỗi tool gọi đúng hàm service của REST.
- v2 (2026-10-01, commit `2438ac0`): không đổi bảy tool đọc ở đây; ghi rõ ba tool đọc sổ đối ứng (`get_tenants`, `get_debts`, `get_receivables` — mới, ADR-72) đặc tả ở context của sổ đó, và số của chúng là ghi nhớ "ai nợ ai", không phải tiền đang có.
- v3 (2026-10-01, commit `e5bae84`): mô tả tool `get_budget` nói "Bảng dự kiến / thực tế / còn lại theo từng ví…" thay cho "mục tiêu" (ADR-74); `get_goals` vẫn là "mục tiêu có hạn" (quỹ để dành có đích). Không đổi hành vi.
- v4 (2026-10-06, commit `18569ce`): `get_snapshot` trả thêm `spendableCash` ("Tiền chi được", ADR-85 — ledger UC-103 bước 7b) vì dùng chung `getSnapshot`; không đổi code MCP (change [`261006-tien-chi-duoc`](../changes/archive/261006-tien-chi-duoc/proposal.md)).
- v5 (2026-10-06, commit `9c265ee`): tool `reconcile` không còn `bankBalance` / `feedDrift` (ADR-87 — bỏ số lũy kế SePay; chủ nhà: "bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè"); mô tả tool nói lệch là "lệch giữa sổ và các giao dịch ngân hàng đã gán (bookDrift)" và "Không có số dư do ngân hàng báo." (change [`261006-bo-luy-ke-sepay`](../changes/archive/261006-bo-luy-ke-sepay/proposal.md)).
- v6 (2026-10-07, commit `7424f26`): đổi tên tool `spend_by_category` → `get_spending_by_category`, `reconcile` → `get_reconciliation` (ADR-92; hàm service `ledger.spendByCategory`, `ledger.reconcile` giữ tên); `get_goals` trả khoá `safetyFund` (Quỹ an tâm, ADR-93) và `wealthBuilding` thay `emergency`, `tichsan`; snapshot `tiers.wealth_building`, `safetyFund`. Mô tả mọi tool viết tiếng Anh, bỏ câu sai "chưa triển khai"; dòng tóm tắt trả cho người đọc giữ tiếng Việt. Thêm AC-5 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).
- v7 (2026-10-08, commit `e5ecf41`): tool đọc nhìn số liệu **như người đã uỷ quyền kết nối** (người xem = `memberId` của token OAuth, UC-601), không còn mặc định chủ hộ — ví `private` của người khác bị ẩn như trên app của người đó (UC-504); cần token có `mcp:read`. Thêm AC-6. Đóng [DIVERGENCE] MCP luôn nhìn như chủ hộ còn màn Hôm nay nhìn như người đăng nhập, [DIVERGENCE] thứ tự chọn chủ hộ khác REST token (MCP không còn tự chọn người xem), [OPEN] MCP không biết ai đang hỏi (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md)).
- v8 (2026-10-08, commit `8cd48b8`): tool đọc mới **`get_balance_sheet { date? }`** — cùng số với `GET /v1/balance-sheet` (bảng cân đối A/B/C/D, tháp tài sản, từng mục nhập tay kèm lô, lãi / lỗ, giá chốt lời / cắt lỗ, trạng thái, CAGR; lãi tháng này của khoản nợ — balance [UC-1102](../balance/UC-1102-xem-bang-can-doi.md)); dòng tóm tắt "Vốn chủ: …". Tổng số tool 18 (AC-5). Bước 2, 2b sửa (MCP đã có bức tranh tiền thật: tiền, phải thu, nợ, vốn chủ); thêm E1a, AC-7 (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))
- v9 (2026-10-08, commit `31e3505`): tool đọc mới **`get_reports { kind, period }`** — `kind` `cash_flow` | `income_statement`, `period` tháng `YYYY-MM` hoặc năm `YYYY`; cùng số với `GET /v1/reports/cash-flow`, `/income-statement` (balance [UC-1105](../balance/UC-1105-luu-chuyen-tien.md), [UC-1106](../balance/UC-1106-ket-qua-thu-chi.md)). Thử số / Dự phóng không có tool (không phải số thật, ADR-105). Tổng số tool 19 — AC-5 sửa; E1 thêm câu lỗi kỳ báo cáo; thêm AC-8 (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))
- v10 (2026-10-08, commit `d4f0ab3`): `get_balance_sheet` trả thêm khối **`freedom`** = `GET /v1/freedom` (Mốc an tâm, mốc thu nhập, mốc Tự do kèm tuổi mục tiêu, thông số đang dùng, kế hoạch thu nhập năm nay — balance [UC-1103](../balance/UC-1103-moc-tu-do.md), [UC-1104](../balance/UC-1104-ke-hoach-thu-nhap.md)); khối này luôn tính tới hôm nay, kể cả khi gửi `date`. Thêm AC-9 (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))

## Preconditions
- Đã qua UC-601: token của kết nối có quyền `mcp:read`.

## Main Flow
1. Người xem = người đã uỷ quyền kết nối (`memberId` mang trong token, UC-601) — như người đó mở app.
2. Claude gọi một tool đọc; handler gọi đúng hàm service (bảng tool ở `README.md`). Mô tả tool trong `tools/list` viết tiếng Anh (ADR-92); dòng tóm tắt trả cho người đọc viết tiếng Việt:
   - `get_snapshot` → `ledger.getSnapshot(db, memberId, now)` — cùng hàm với `GET /v1/snapshot` (màn Hôm nay); kèm dòng tóm tắt `Còn để chi tuần này: <số> ₫` (số làm tròn, định dạng `vi-VN`).
   - `get_budget { period? }` → `ledger.getBudget(db, period ?? tháng hiện tại, memberId)` — bảng dự kiến / thực tế / còn lại theo ví (ledger UC-104); `period` dạng `2026-09` hoặc `2026-W39`.
   - `get_goals` → `ledger.goals(db)` → `{ goals, safetyFund, wealthBuilding }` (mục tiêu có hạn, Quỹ an tâm, Tích sản cash + assets).
   - `list_categories` → `ledger.loadRefs(db).categories` (danh mục active + `defaultWalletId`).
   - `get_spending_by_category { period? }` → `ledger.spendByCategory(db, period ?? tháng hiện tại)`.
   - `list_transfer_orders` → `ledger.listTransferOrders(db, "pending")`.
   - `get_reconciliation` → `ledger.reconcile(db)`.
   - `get_balance_sheet { date? }` → `balance.getBalanceSheet(db, date, now)` — cùng hàm với `GET /v1/balance-sheet` (balance UC-1102): bảng cân đối tới cuối ngày `date` (mặc định hôm nay, giờ VN) — tài sản A / B theo mục, nợ C theo kỳ hạn × nhóm lãi (kèm lãi/năm, lãi tháng này), vốn chủ, % trên tổng nguồn vốn và trên vốn chủ, tháp, dòng tiền thật/tháng và sau bù lạm phát, từng mục nhập tay kèm lô, lãi / lỗ, khoảng cách tới giá chốt lời / cắt lỗ, trạng thái, CAGR. Kèm khối `freedom` = `freedom.getFreedom(db, now)` — cùng hàm với `GET /v1/freedom` (balance UC-1103), luôn tại hôm nay. Dòng tóm tắt `Vốn chủ: <số> ₫ (tài sản <số> ₫, nợ <số> ₫)`.
   - `get_reports { kind, period }` → `kind = cash_flow`: `reports.getCashFlow(db, period, now)` (`GET /v1/reports/cash-flow`, balance UC-1105), tóm tắt `Tiền đầu kỳ <số> ₫ → cuối kỳ <số> ₫.`; `kind = income_statement`: `reports.getIncomeStatement(db, period, now)` (`GET /v1/reports/income-statement`, balance UC-1106), tóm tắt `Thu nhập <số> ₫, chi tiêu <số> ₫, để dành <số> ₫.`. `period` = tháng `2026-10` hoặc năm `2026`. Báo cáo không đổi ví hay số dư nào. Số gõ thử ở Thử số / Dự phóng không đọc được qua MCP (ADR-105).
3. Trả kết quả service dạng JSON ở khối text cuối.

## Alternative Flows
- 2a. Ví `private` của người khác bị ẩn số đúng như trên app của người uỷ quyền (access [UC-504](../access/UC-504-an-lich-su-vi-private.md) "Ẩn lịch sự số dư ví `private`"); ví `private` của chính người đó vẫn hiện số.
- 2b. **Tool đọc sổ đối ứng** — `list_tenants` (rental [UC-803](../rental/UC-803-xem-tam-tinh.md)), `get_debts` (debt [UC-901](../debt/UC-901-them-va-xem-khoan-no.md)), `get_receivables` (receivable [UC-1001](../receivable/UC-1001-them-va-xem-khoan-phai-thu.md)) — cùng khuôn: gọi đúng service của REST, trả `totalBalance` + từng đối tác. Số này trả lời "ai nợ ai", **không** cộng vào "nhà có bao nhiêu tiền" (BR-13). Tiền thật, phải thu, nợ và vốn chủ đặt cạnh nhau ở `get_balance_sheet` (bước 2; receivable [UC-1005](../receivable/UC-1005-xem-buc-tranh-tien-that.md)); số dư sổ từng tài khoản vẫn ở `get_reconciliation`.

## Exceptions
- E1. `period` sai định dạng → `DomainError invalid_period` → tool error với thông điệp "Kỳ phải có dạng 2026-09 hoặc 2026-W39." (`get_budget`), "Tháng phải có dạng 2026-09." (`get_spending_by_category`) hoặc "Kỳ phải có dạng 2026-10 (tháng) hoặc 2026 (năm), không sau kỳ hiện tại." (`get_reports` — kể cả kỳ sau kỳ hiện tại).
- E1a. `get_balance_sheet` với `date` không phải ngày `YYYY-MM-DD` → tool error `invalid_input` "date có dạng 2026-11-15."; ngày sau hôm nay → `future_date` "Ngày xem không được sau hôm nay.". `get_reports` thiếu `kind` / `period` hay `kind` ngoài `cash_flow | income_statement` → tool error do SDK tạo (zod), handler không chạy.
- E2. Lỗi lạ → tool error "Lỗi hệ thống. Thử lại sau."

## Acceptance Criteria
### AC-1: `get_snapshot` trùng `GET /v1/snapshot` của cùng người xem
- Given DB đã ghi thu nhập 40.000.000 vào `vcb-husband`, đã chia, và chi 125.000 danh mục `groceries`; kết nối Claude do `husband` (chủ hộ) uỷ quyền
- When lấy `GET /v1/snapshot` (Bearer, không `X-Member-Id` — người xem là chủ hộ) và MCP `get_snapshot`
- Then hai kết quả bằng nhau hoàn toàn sau khi bỏ trường `at`
- Tests: `test/mcp.test.ts` › "tool đọc số liệu › get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB"

### AC-2: `list_categories` trả ví mặc định để map lời nói
- When `list_categories`
- Then danh mục `fuel-parking` có `defaultWalletId = "transport"`
- Tests: `test/mcp.test.ts` › "tool đọc số liệu › list_categories trả danh mục kèm ví mặc định"

### AC-3: `get_budget`, `get_goals`, `get_spending_by_category`, `list_transfer_orders`, `get_reconciliation` trùng REST tương ứng
- Given cùng DB
- When gọi tool và route REST tương ứng (bảng `README.md`)
- Then cùng dữ liệu
- Tests: ⚠ Chưa có test

### AC-4: Kỳ sai định dạng là tool error, không phải HTTP lỗi
- When `get_budget { period: "sai" }`
- Then JSON-RPC 200, `isError: true`, thông điệp tiếng Việt của `invalid_period`
- Tests: ⚠ Chưa có test

### AC-5: Mô tả tool không còn chữ sai, tên cũ (MODIFIED v9)
- When `tools/list`
- Then mô tả của mọi tool (19 tool) không còn "chưa triển khai" / "phase 04", không nhắc tên tool cũ (`reconcile`, `spend_by_category`, `allocate`, `get_tenants`, `add_tenant_paid_for_us`), không còn chữ `tichsan` / "phao khẩn cấp"; dòng tóm tắt trả cho người đọc ("Còn để chi tuần này: …") vẫn tiếng Việt
- Tests: `test/mcp.test.ts` › "giao thức MCP › mô tả tool không còn 'chưa triển khai' / 'phase 04', không nhắc tên tool cũ, tên cũ của Tích sản hay chữ khẩn cấp"

### AC-6: `get_snapshot` nhìn như người đã uỷ quyền: ví `private` của người khác bị ẩn
- Given ví `fun-wife` của `wife` để `private`, có 700.000
- When `get_snapshot` qua kết nối do `husband` uỷ quyền, và qua kết nối do `wife` uỷ quyền (cả hai chỉ Xem)
- Then kết nối của `husband` thấy số dư `fun-wife` là `null`; kết nối của `wife` thấy 700.000
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › get_snapshot như trên app của người đó: ví private của người khác bị ẩn"

### AC-7: `get_balance_sheet` trùng `GET /v1/balance-sheet`, kèm lô, trạng thái và lãi tháng này
- Given mục "Vàng" (`vang`, A1, phòng vệ, theo lô "chỉ") có một lô mua 2026-01-10, 2 chỉ, giá 5.000.000 ₫/chỉ, giá cắt lỗ 4.000.000; khoản nợ "Vay tiêu dùng" 20.000.000 lãi 18%/năm mở từ 2026-01-01; kết nối Claude của `husband` chỉ Xem
- When `get_balance_sheet` (không `date`) và `GET /v1/balance-sheet`
- Then tool không lỗi; khối JSON bỏ `freedom` bằng đúng phản hồi REST; lô của Vàng có `position.status = "holding"`, `pnl = 0` (chưa có giá mới → giá mua); dòng nợ `debt:vay-tieu-dung` có `interestThisMonth = 300.000`
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › UC-602 AC-7: get_balance_sheet trả cùng số với GET /v1/balance-sheet, kèm lô, lãi / lỗ, trạng thái của từng lô và lãi tháng này của khoản nợ"

### AC-8: `get_reports` trùng `GET /v1/reports/…`
- Given một khoản chi 200.000 danh mục `groceries` từ `cash-husband` trong tháng này; kết nối Claude của `husband` chỉ Xem
- When `get_reports { kind: "cash_flow", period: <tháng này> }` và `{ kind: "income_statement", period: <tháng này> }`
- Then tool không lỗi; khối JSON bằng đúng `GET /v1/reports/cash-flow?period=<tháng này>` và `GET /v1/reports/income-statement?period=<tháng này>`; kết quả thu chi có `expense.total = 200.000`. Không có tool cho Thử số
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › UC-602 AC-8: get_reports (cash_flow | income_statement, period) trả cùng số với GET /v1/reports/…"

### AC-9: `get_balance_sheet` có khối `freedom` = `GET /v1/freedom`
- Given chi phí tháng nhập tay E = 20.000.000, E_must = 15.000.000 (`PUT /v1/settings/config`); kế hoạch thu nhập năm nay cả nhà 45.000.000/tháng; kết nối Claude của `husband` chỉ Xem
- When `get_balance_sheet` và `GET /v1/freedom`
- Then `freedom` của tool bằng đúng phản hồi REST (mốc, thông số, kế hoạch thu nhập); `freedom.incomePlan.current.householdMonthly = 45.000.000`
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › UC-602 AC-9: get_balance_sheet có khối freedom = GET /v1/freedom (mốc, kế hoạch thu nhập năm nay)"

## Traceability
- Code: `src/mcp/tools.ts` › `registerTools` (`memberId` = người đã uỷ quyền, tool `get_snapshot`, `get_budget`, `get_goals`, `list_categories`, `get_spending_by_category`, `list_transfer_orders`, `get_reconciliation`), `ok`, `fail`, `vnd`; `src/routes/mcp.ts` › `mcpHandler` (truyền `memberId` của token); `src/services/ledger.ts` › `getSnapshot`, `getBudget`, `goals`, `loadRefs`, `spendByCategory`, `listTransferOrders`, `reconcile`; `src/domain/snapshot.ts` › `buildSnapshot`; `src/domain/period.ts` › `monthKey`; views `v_safety_fund`, `v_wealth_building` (`goals`)
- Code (bảng cân đối, báo cáo, Mốc tự do): `src/mcp/tools.ts` › `registerTools` (tool `get_balance_sheet`, `get_reports`); `src/services/balance.ts` › `getBalanceSheet`, `sheetDate`; `src/services/freedom.ts` › `getFreedom`; `src/services/reports.ts` › `getCashFlow`, `getIncomeStatement`; `src/domain/reports.ts` › `parsePeriod`; REST tương ứng `src/routes/balance.ts`, `src/routes/reports.ts`, `src/routes/freedom.ts`
- Liên quan: `specs/ledger/` (UC-103 Xem "còn bao nhiêu để chi", UC-104 Ngân sách theo kỳ, UC-106 Đối soát tài khoản, UC-107 Tích lũy, UC-108 Chi theo danh mục)

## Divergences & Open Questions
- [DIVERGENCE] phase-06 bảng Tools: `get_goals` trả "% đạt, cần nạp mỗi kỳ, phao"; `ledger.goals` trả `target`, `targetDate`, `balance`, `missing`, `pct`, `daysLeft` (view `v_goal_progress`) — không có trường "cần nạp mỗi kỳ".
- [OPEN] `get_budget` mặc định tháng; REST `GET /v1/budget` có thêm `kind=week` để mặc định tuần hiện tại (`src/routes/v1.ts`). Claude muốn xem tuần phải tự truyền `2026-Wxx`.
