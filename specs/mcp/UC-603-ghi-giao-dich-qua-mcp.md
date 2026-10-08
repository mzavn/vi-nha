# UC-603: Ghi giao dịch nhập tay qua MCP
- Status: implemented
- BR: BR-05, BR-03
- Decisions: `plans/260921-2228-profit-first-pwa/phase-06-mcp.md` ("MCP không có session người dùng → `add_transaction` **bắt buộc `by_member_id`**" — đã đổi thành tuỳ chọn, mặc định người uỷ quyền, ADR-97); báo cáo `plans/reports/fullstack-developer-260922-0020-mcp-server.md` quyết định 2 (thêm `from_wallet_id`, `to_account_id`, `link_id`, `asset_kind`; không đưa `client_id`) và 3 (kiểm `by_member_id` là thành viên active); D14 (không nhập tay trên tài khoản có bank feed — áp qua `ledger.createEntry`); commit `bc0d2a2`; ADR-58 (tiền người thuê trả là `income` mang `tenant_id`); ADR-59 (nguồn thu chọn khi ghi); ADR-71 (trả nợ = khoản chi có `debt_id`); ADR-72 (nhận lại tiền cho vay = `collect`, `receivable_id` trên `lend`/`collect`); ADR-92 (tên và mô tả tool tiếng Anh); ADR-97 (MCP dùng OAuth 2.1 — tool ghi như người đã uỷ quyền); ADR-98 (quyền Ghi tick sẵn, bỏ được); ADR-90 (nhật ký thay đổi chỉ thêm)
- Actor: Claude (hoặc ứng dụng AI đã nối — UC-601), thay mặt người đã uỷ quyền kết nối hoặc một thành viên khác người đó nêu ("chi 200k xăng tiền mặt")
- Trigger: MCP `tools/call` `add_transaction`

## History
- v1 (2026-09-22, commit `bc0d2a2`): tool `add_transaction` gọi `ledger.createEntry` như REST.
- v2 (2026-09-22, commit `b8e8f0c`): `createEntry` từ chối nhập tay trên tài khoản đã nối bank feed (D14); test MCP chuyển mọi tài khoản sang ghi tay để giữ kịch bản.
- v3 (2026-10-01, commit `034b7ff`): nhận thêm `income_stream_id`, `tenant_id` (chỉ cho `income`); mô tả tool nói rõ "chuyển ngân sách" = `transfer` không tài khoản, có `from_wallet_id` + `wallet_id` (change `261001-cho-thue-lai`).
- v4 (2026-10-01, commit `39751b8`): D14 theo chiều tiền (ADR-66) — `fed_account` chỉ khi khoản chạm chiều SePay báo về (tiền vào tài khoản đã nối SePay; tiền ra khi tài khoản bật `sepay_out`); khoản chi từ tài khoản SePay chỉ báo tiền vào (vd MB) ghi được qua MCP.
- v5 (2026-10-01, commit `25db5b9`): nhận thêm `debt_id` (chỉ cho `spend` — trả nợ, id lấy từ tool `get_debts`; bỏ trống `category_id` thì lấy danh mục Trả nợ); mô tả tool nói rõ cách trả nợ (sổ nợ, debt [UC-902](../debt/UC-902-tra-no.md), ADR-71).
- v6 (2026-10-01, commit `2438ac0`): `meaning` nhận thêm `collect` (tiền cho vay quay về — tiền vào tài khoản, không cộng ví, không phải thu nhập) và trường `receivable_id` (chỉ `lend`/`collect`, id lấy từ `get_receivables`); mô tả tool nói rõ `collect` không phải thu nhập (sổ phải thu, receivable [UC-1003](../receivable/UC-1003-nhan-lai-tien.md), ADR-72).
- v7 (2026-10-07, commit `7424f26`): mô tả tool `add_transaction` viết tiếng Anh (ADR-92), chỉ id người thuê lấy từ tool mới `list_tenants` (trước là `get_tenants`); chuỗi thay khi chưa có thành viên là "no active members yet". Tham số, hành vi không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).
- v8 (2026-10-08, commit `e5ecf41`): `by_member_id` thành **không bắt buộc** — bỏ trống thì người ghi là người đã uỷ quyền kết nối (UC-601); có gửi thì phải là thành viên đang hoạt động. Cần quyền `mcp:write` (thiếu → HTTP 403 trước khi tool chạy). Mỗi lần ghi thêm nhật ký `tx.create` `via = mcp` mang người uỷ quyền. Sửa AC-1 (trích test mới thay test "thiếu by_member_id → tool error" đã bỏ), AC-2; thêm AC-10 (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md)).

## Preconditions
- Đã qua UC-601: token của kết nối có quyền `mcp:write` (Ghi). Mô tả tool (tiếng Anh, ADR-92) liệt kê sẵn id + tên thành viên active (`memberHint`) để Claude chọn `by_member_id` khi ghi thay người khác.

## Main Flow
1. SDK kiểm input theo zod: `meaning` ∈ `MANUAL_MEANINGS` (`spend`, `income`, `refund`, `transfer`, `buy_asset`, `lend`, `collect`), `amount` nguyên dương; `by_member_id` tuỳ chọn (có thì là chuỗi không rỗng); còn lại tuỳ chọn (bảng `README.md`).
2. Người ghi = `by_member_id` nếu có, không thì người đã uỷ quyền kết nối; handler kiểm người ghi thuộc tập thành viên `active` đã tải lúc `registerTools`.
3. Dựng `EntryInput`: trường thiếu → `null`, `taxable` thiếu → `false`, `at` giữ nguyên để `buildEntry` chuẩn hoá (`normalizeAt`). Không có `client_id`.
4. Gọi `ledger.createEntry(db, input, người ghi, now)` — cùng luật nhập tay với REST: suy ví từ danh mục (đổi sang ví cá nhân cùng tầng của người ghi nếu danh mục trỏ ví cá nhân người khác), suy tài khoản tiền mặt của người ghi, `by_member_id` = người ghi, `source = 'manual'`.
   - 4.1 `income` kèm `tenant_id` (id lấy từ `list_tenants`): người thuê phải có và còn ở; bỏ trống `income_stream_id` thì tự lấy nguồn cho thuê cấu hình (`rental_income_stream_id`); số dư người thuê giảm đúng số tiền (rental [UC-805](../rental/UC-805-nhan-tien-nguoi-thue-tra.md)). `income_stream_id` chọn nguồn thu → lần chia theo phần khóa của nguồn (ADR-59).
   - 4.2 `transfer` **không** có `account_id`/`to_account_id` mà có `from_wallet_id` + `wallet_id` → chuyển ngân sách giữa hai ví, tiền không rời tài khoản (ledger UC-101); `wallet` trong kết quả là trạng thái của **ví nhận**.
   - 4.3 `spend` kèm `debt_id` (id lấy từ `get_debts`): khoản nợ phải có và đang bật; bỏ trống `category_id` thì lấy `debt-payment` (ví mặc định "Thu cho thuê"); số còn nợ giảm đúng số tiền (debt [UC-902](../debt/UC-902-tra-no.md)).
   - 4.4 `lend` / `collect` kèm `receivable_id` (id lấy từ `get_receivables`): khoản phải thu phải có và đang bật; `account_id` = tài khoản tiền ra (`lend`) / tiền vào (`collect`), bỏ trống thì tài khoản tiền mặt của người ghi; `collect` không cộng ví, không phải thu nhập, không gọi `allocate_income` được (receivable [UC-1002](../receivable/UC-1002-cho-vay-tra-ho.md), [UC-1003](../receivable/UC-1003-nhan-lai-tien.md)).
5. Ghi nhật ký thay đổi `tx.create`, đích `tx:<id>`, người làm = người đã uỷ quyền, `via = mcp`, chi tiết `{ meaning, by_member_id }` (ADR-90).
6. Trả `{ tx, duplicate, wallet }` kèm tóm tắt "Đã ghi giao dịch.".

## Alternative Flows
- 6a. `createEntry` báo `duplicate` (chỉ khi có `client_id` trùng) → tóm tắt "Giao dịch này đã được ghi trước đó (trùng client_id)." và không ghi nhật ký — không xảy ra qua MCP vì tool không nhận `client_id` (xem [OPEN]).

## Exceptions
- E0. Token chỉ có quyền Xem (`mcp:read`) → HTTP 403 `insufficient_scope` trước khi tool chạy, không ghi gì (UC-601 AC-11).
- E1. Thiếu/sai kiểu trường bắt buộc → tool error do SDK tạo; handler không chạy, không ghi gì.
- E2. `by_member_id` không phải thành viên active (không có thật hoặc đã tắt) → tool error `Không có thành viên đang hoạt động với id "<id>".`, không ghi gì.
- E3. Lỗi nghiệp vụ từ `createEntry` → tool error với thông điệp của `DomainError`, ví dụ tài khoản đã nối bank feed (`fed_account`), Tích sản không đủ tiền mặt cho `buy_asset` (`insufficient_cash`), `link_id` hoàn tiền không trỏ về khoản chi còn hiệu lực (`invalid_link`), nguồn/người thuê trên khoản không phải thu nhập (`income_only`), người thuê không có/đã ra (`unknown_tenant`/`inactive_tenant`), nguồn thu không có/đã tắt (`unknown_income_stream`/`inactive_income_stream`), chuyển ngân sách sai ví (`missing_wallet`, `unknown_wallet`, `same_wallet`, `locked_wallet`), khoản nợ trên khoản không phải chi (`debt_spend_only`), khoản nợ không có/đã tắt (`unknown_debt`/`inactive_debt`), khoản phải thu trên khoản không phải `lend`/`collect` (`receivable_only`), khoản phải thu không có/đã tắt (`unknown_receivable`/`inactive_receivable`).

## Acceptance Criteria
### AC-1: Thiếu `by_member_id` → người ghi là người đã uỷ quyền kết nối
- Given kết nối do `husband` uỷ quyền (có quyền Ghi)
- When `add_transaction { meaning: "spend", amount: 200000, category_id: "fuel-parking" }` (không `by_member_id`)
- Then không lỗi; `tx` có `by_member_id = "husband"`, `account_id = "cash-husband"`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "add_transaction › thiếu by_member_id → người ghi là người đã uỷ quyền kết nối (UC-603)"

### AC-2: `by_member_id` không có thật hoặc đã tắt → tool error
- When `by_member_id: "ai-do"`; hoặc `by_member_id` của người đã tắt
- Then `isError: true`, text khớp `/không có thành viên/i`; không ghi gì
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "add_transaction › by_member_id không có thật → tool error"; [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › by_member_id gửi kèm phải là thành viên đang hoạt động"

### AC-3: "chi 200k xăng tiền mặt" ghi đúng ví và tài khoản của người ghi
- Given mọi tài khoản ghi tay (`sepay_enabled = 0`)
- When `add_transaction { meaning: "spend", amount: 200000, category_id: "fuel-parking", by_member_id: "wife" }`
- Then `tx` có `counter_wallet_id = "transport"`, `account_id = "cash-wife"`, `category_id = "fuel-parking"`, `by_member_id = "wife"`, `source = "manual"`; đúng 1 dòng ghi vào `transport`
- Tests: `test/mcp.test.ts` › `add_transaction › "chi 200k xăng tiền mặt" → ghi vào ví đi-lai, tài khoản tiền mặt của người ghi`

### AC-4: Tài khoản có bank feed không nhận nhập tay qua MCP
- Given tài khoản `sepay_enabled = 1` (và `sepay_out = 1` nếu là khoản tiền ra — ADR-66)
- When `add_transaction` chạm chiều tiền SePay báo về của tài khoản đó (tiền vào; tiền ra khi `sepay_out = 1`)
- Then tool error `fed_account`, không ghi gì
- Tests: ⚠ Chưa có test qua MCP (luật nằm ở `createEntry`, xem `specs/ledger/` UC-101)

### AC-5: Sau khi ghi, `get_snapshot` phản ánh khoản chi
- Given đã chia lương
- When ghi một khoản chi qua MCP rồi gọi `get_snapshot`
- Then `spendableThisWeek` giảm đúng như khi ghi qua REST (phase-06 §Success: "số ở màn Hôm nay đổi theo")
- Tests: ⚠ Chưa có test

### AC-6: Thu nhập kèm `tenant_id` → gắn người thuê, tự lấy nguồn thu cho thuê
- Given người thuê `an`
- When `add_transaction { meaning: "income", amount: 5191667, account_id: "vcb-husband", tenant_id: "an", by_member_id: "husband" }`
- Then không lỗi; `tx` có `tenant_id = "an"`, `income_stream_id = "rental"`
- Tests: `test/mcp.test.ts` › "add_transaction › income kèm tenant_id → gắn người thuê, tự lấy nguồn thu cho thuê"

### AC-7: Chuyển ngân sách giữa hai ví qua MCP
- When `add_transaction { meaning: "transfer", amount, from_wallet_id, wallet_id, by_member_id }` (không tài khoản)
- Then chỉ số dư hai ví đổi, tài khoản không đổi
- Tests: ⚠ Chưa có test qua MCP (luật nằm ở `buildEntry`, test REST ở ledger UC-101)

### AC-8: Trả nợ qua MCP: `add_transaction` nhận `debt_id`
- Given khoản nợ `co-mai` mở sổ 1.000.000
- When `add_transaction { meaning: "spend", amount: 400000, debt_id: "co-mai", by_member_id: "husband" }` (không danh mục)
- Then không lỗi; `tx` có `debt_id = "co-mai"`, `category_id = "debt-payment"`, `counter_wallet_id = "rental-income"`; `get_debts` trả `totalBalance = 600.000`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "sổ nợ › add_transaction nhận debt_id"

### AC-9: Nhận lại tiền cho vay qua MCP: `add_transaction` nhận `collect` + `receivable_id`
- Given khoản phải thu `em-hai` mở sổ 2.000.000
- When `add_transaction { meaning: "collect", amount: 500000, receivable_id: "em-hai", by_member_id: "husband" }` (không tài khoản)
- Then không lỗi; `tx` có `meaning = "collect"`, `receivable_id = "em-hai"`, `counter_account_id = "cash-husband"`, `wallet_id = null`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "sổ phải thu › add_transaction nhận collect + receivable_id; assign_log nhận split collect"

### AC-10: Ghi cần quyền Ghi; mỗi lần ghi có nhật ký `via = mcp` mang người uỷ quyền
- Given kết nối chỉ có quyền Xem
- When `add_transaction`
- Then HTTP 403 `insufficient_scope` (challenge ghi đủ `mcp:read mcp:write`); không ghi gì
- Given kết nối do `wife` uỷ quyền, có quyền Ghi
- When `add_transaction { meaning: "spend", amount: 200000, category_id: "fuel-parking" }` (không `by_member_id`)
- Then `tx` có `by_member_id = "wife"`, `account_id = "cash-wife"`; nhật ký đúng một dòng `tx.create` với người làm `wife`, `via = mcp`, đích `tx:<id>`, chi tiết `{ meaning: "spend", by_member_id: "wife" }`
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì" · "… › token có Ghi → tool ghi chạy"; [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › add_transaction không gửi by_member_id → người ghi là người uỷ quyền; nhật ký via=mcp kèm người đó"

## Traceability
- Code: `src/mcp/tools.ts` › `registerTools` (tool `add_transaction`, `memberIds`, `memberHint`, `actor` `{ memberId, via: "mcp" }`), `WRITE_TOOLS`; `src/routes/mcp.ts` › `mcpHandler` (kiểm `mcp:write` ở tầng HTTP); `src/services/audit.ts` › `audit`; `src/services/ledger.ts` › `createEntry`, `walletStatus`; `src/domain/entry.ts` › `MANUAL_MEANINGS`, `EntryInput`, `buildEntry`, `normalizeAt`, `walletFor`, `cashAccountOf`
- Liên quan: `specs/ledger/` (UC-101 Nhập tay khoản tiền)

## Divergences & Open Questions
- [DIVERGENCE] phase-06 bảng Tools liệt kê input `meaning, amount, category_id?, wallet_id?, account_id?, by_member_id, note?, at?, taxable?`; code nhận thêm `from_wallet_id`, `to_account_id`, `link_id`, `asset_kind` (`src/mcp/tools.ts`) — báo cáo MCP quyết định 2 giải thích là để `transfer`/`buy_asset`/`refund` dùng được.
- [DIVERGENCE] Proposal `261001-cho-thue-lai` không nhắc `add_transaction`; code nhận thêm `income_stream_id`, `tenant_id` để Claude ghi được tiền người thuê trả bằng tiền mặt/nhập tay, và mô tả tool thêm cách "chuyển ngân sách".
- [OPEN] Tool không nhận `client_id` nên không chống trùng: nếu Claude gọi lại (retry, người dùng nhắc lại), khoản tiền được ghi hai lần. Nhánh tóm tắt "trùng client_id" trong code không bao giờ chạy qua MCP. REST có `client_id` (D12) cho PWA offline.
