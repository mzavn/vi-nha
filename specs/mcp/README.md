# Context: mcp — Claude đọc/ghi qua MCP

Server MCP **stateless, tool-only** ở `https://<host>/mcp` để Claude (web, Desktop, mobile, Claude Code) và ứng dụng AI khác hỗ trợ MCP (ChatGPT, Cursor…) hỏi số liệu và ghi giao dịch bằng lời. Endpoint được bảo vệ bằng **OAuth 2.1** theo chuẩn MCP authorization (ADR-97): người trong nhà thêm connector, đăng nhập bằng mật khẩu của app ở trang uỷ quyền, chọn quyền Xem / Ghi; mọi tool chạy **như người đã uỷ quyền** (UC-601). Mỗi tool chỉ gọi lại đúng hàm service dùng chung với REST (`src/services/ledger.ts`, `src/services/ingest.ts`, `src/services/rental.ts`, `src/services/debts.ts`, `src/services/receivables.ts`) — không có SQL nghiệp vụ riêng — nên số Claude nói trùng số của app (BR-05). Token, mã uỷ quyền không bao giờ nằm trong URL, log hay câu trả lời của API (BR-09).

## Ngôn ngữ chung

| Thuật ngữ | Nghĩa trong context này | Ghi chú khác context |
|---|---|---|
| Tool | Một hàm MCP Claude gọi qua `tools/call`; đăng ký bằng `server.registerTool` với `inputSchema` zod dạng object phẳng. Tên và mô tả tool viết tiếng Anh (ADR-92), tên theo khuôn động từ + danh từ (`get_…`, `list_…`, `add_…`) | 16 tool, danh sách cố định |
| Kết nối (grant) | Một lần người trong nhà cho một ứng dụng AI dùng sổ ở trang uỷ quyền: mang người đã uỷ quyền và quyền đã chọn; gỡ được ở Cài đặt › Claude và ứng dụng AI | Access UC-508 / pwa UC-709 liệt kê và gỡ |
| Token OAuth | Token truy cập (1 giờ) + refresh token (60 ngày không dùng mới hết) ứng dụng AI nhận sau khi đổi mã (PKCE); gửi `Authorization: Bearer` tới `/mcp` | Khác `API_TOKEN` (UC-502 access) và cookie phiên app — không dùng chung |
| Quyền `mcp:read` / `mcp:write` | **Xem số liệu** (bắt buộc) / **Ghi giao dịch, gán, chia tiền** (tick sẵn, bỏ được — ADR-98). Tool ghi cần `mcp:write`, kiểm ở tầng HTTP (thiếu → 403 `insufficient_scope`) | |
| Người uỷ quyền | Thành viên đã đăng nhập ở trang uỷ quyền (`memberId` mang trong token); tool đọc nhìn như người đó, tool ghi ghi người đó + nhật ký `via = mcp` | Access: như người đăng nhập app (UC-504 ẩn ví `private` của người khác) |
| Stateless | Mỗi HTTP request dựng `McpServer` + đăng ký tool mới; không có `Mcp-Session-Id`, không Durable Object | `initialize` không bắt buộc trước `tools/call` |
| `by_member_id` | Người ghi ở `add_transaction`, **không bắt buộc**: bỏ trống là người uỷ quyền; có gửi thì phải là thành viên đang hoạt động | Ở REST suy ra từ phiên / `X-Member-Id` |
| Tool error | Kết quả `{ content: [{type:"text", text}], isError: true }` trong JSON-RPC 200 — lỗi nghiệp vụ, không phải lỗi HTTP | |
| Kết quả tool | `content` = [dòng tóm tắt tiếng Việt (tuỳ tool)] + một khối text là JSON của kết quả service | Khối JSON luôn là khối cuối; mô tả tool tiếng Anh, dòng tóm tắt tiếng Việt |

## Bảng tool (`src/mcp/tools.ts` › `registerTools`)

| Tool | Input (zod) | Service được gọi | Tương đương REST | Output (khối JSON) | Tóm tắt |
|---|---|---|---|---|---|
| `get_snapshot` | — | `ledger.getSnapshot(db, memberId, now)` | `GET /v1/snapshot` | Snapshot màn Hôm nay (`spendableThisWeek`, `spendableByWallet`, `tiers` (gồm `wealth_building`), `wallets`, `reserves`, `safetyFund` (Quỹ an tâm, ADR-93), `goals`, `attention`, …) | `Còn để chi tuần này: <số> ₫` |
| `get_budget` | `period?: string` (mặc định tháng hiện tại `monthKey(now)`) | `ledger.getBudget(db, period, memberId)` | `GET /v1/budget` | `{ period, kind, weeks, lines[] }` | — |
| `get_goals` | — | `ledger.goals(db)` | `GET /v1/goals` | `{ goals, safetyFund, wealthBuilding }` | — |
| `list_pending_logs` | `limit?: int > 0, ≤ 200` (mặc định 20) | `ingest.listPendingLogs(db, limit)` | `GET /v1/logs` (mặc định 50) | Mảng log `pending` | — |
| `assign_log` (cần `mcp:write`) | `log_id: string (min 1)`, `splits` (≥ 1 phần tử): `{ meaning ∈ {spend, transfer, income, refund, lend, collect, buy_asset}, amount: int > 0, wallet_id?, category_id?, other_account_id?, from_wallet_id?, income_stream_id?, tenant_id?, debt_id?, receivable_id?, taxable?: bool, asset_kind?, note? }` | `ingest.assignLog(db, log_id, splits, memberId, now)`; nhật ký `log.assign` | `POST /v1/logs/:id/assign` | `{ log, transactions }` | — |
| `add_transaction` (cần `mcp:write`) | `meaning ∈ MANUAL_MEANINGS = {spend, income, refund, transfer, buy_asset, lend, collect}`, `amount: int > 0`, `by_member_id?: string (min 1)`, `category_id?`, `wallet_id?`, `from_wallet_id?`, `account_id?`, `to_account_id?`, `note?`, `at?`, `taxable?: bool`, `link_id?: int > 0`, `asset_kind?`, `income_stream_id?`, `tenant_id?`, `debt_id?`, `receivable_id?` | người ghi = `by_member_id ?? memberId`, kiểm ∈ thành viên active, rồi `ledger.createEntry(db, input, người ghi, now)`; nhật ký `tx.create` | `POST /v1/transactions` | `{ tx, duplicate, wallet }` | `Đã ghi giao dịch.` |
| `list_categories` | — | `ledger.loadRefs(db).categories` | `GET /v1/categories` | Danh mục active kèm `defaultWalletId` | — |
| `get_spending_by_category` | `period?: string` (mặc định tháng hiện tại) | `ledger.spendByCategory(db, period)` | `GET /v1/spend-by-category` | `{ month, previous, categories: [{ categoryId, name, spent, previousSpent }] }` | — |
| `list_transfer_orders` | — (cố định `status = "pending"`) | `ledger.listTransferOrders(db, "pending")` | `GET /v1/transfer-orders` | Lệnh chuyển đang chờ | — |
| `preview_allocation` | `amount: int > 0`, `taxable: bool` | `ledger.previewAllocation(db, { amount, taxable, at: now, accountId: null })` | `POST /v1/allocate/preview` | Kế hoạch chia (không ghi), kèm `transferOrders` | — |
| `allocate_income` (cần `mcp:write`) | `income_tx_id: int > 0` | `ledger.allocateIncome(db, income_tx_id)`; nhật ký `income.allocate` | `POST /v1/allocate` | `{ batchId, …kế hoạch chia (funds, transferOrders…) }` | — |
| `get_reconciliation` | — | `ledger.reconcile(db)` | `GET /v1/accounts` | Mỗi tài khoản: `bookBalance`, `feedBalance`, `bookDrift`, `pendingNet`, `pendingCount`, `lastAt`, `lastCountAt` — không có số dư ngân hàng báo (ADR-87) | — |
| `list_tenants` | — | `rental.getRental(db)` | `GET /v1/rental` | `{ headcount, sharedCategoryIds, incomeStreamId, tenants: [{ id, name, active, balance, fees[] }] }` — số dư dương = người thuê còn nợ (rental [UC-803](../rental/UC-803-xem-tam-tinh.md)) | — |
| `add_tenant_shared_expense` (cần `mcp:write`) | `tenant_id: string (min 1)`, `amount: int > 0`, `category_id: string (min 1)`, `note?` | `rental.addLine(db, tenant_id, { kind: "paid_for_us", amount, category_id, name: note }, now)`; nhật ký `tenant.paid_for_us` | `POST /v1/rental/tenants/:id/lines` (`kind = paid_for_us`) | Dòng sổ người thuê vừa ghi (số âm) (rental [UC-802](../rental/UC-802-ghi-nguoi-thue-chi-ho.md)) | `Đã ghi người thuê chi hộ <số> ₫.` |
| `get_debts` | — | `debts.getDebts(db)` | `GET /v1/debts` | `{ totalBalance, debts: [{ id, name, note, active, owed, paid, balance, done, createdAt, lines[], payments[] }] }` — `balance` = còn nợ, ≤ 0 là đã trả xong (debt [UC-901](../debt/UC-901-them-va-xem-khoan-no.md)) | `Còn nợ: <số> ₫` |
| `get_receivables` | — | `receivables.getReceivables(db)` | `GET /v1/receivables` | `{ totalBalance, receivables: [{ id, name, note, active, lent, collected, balance, done, createdAt, lines[], movements[] }] }` — `balance` = còn phải thu, ≤ 0 là đã trả đủ; mô tả tool nói rõ "a memo of who owes whom, not money on hand" (ghi nhớ ai nợ ai, không phải tiền đang có) (receivable [UC-1001](../receivable/UC-1001-them-va-xem-khoan-phai-thu.md)) | `Người khác còn nợ: <số> ₫` |

Mọi số tiền là số nguyên VND (mô tả tool nói rõ). Không có resource/prompt nào được đăng ký. Bốn tool ghi (`WRITE_TOOLS`: `add_transaction`, `assign_log`, `allocate_income`, `add_tenant_shared_expense`) cần quyền `mcp:write`; mỗi lần ghi thành công có một dòng nhật ký thay đổi `via = mcp` mang người đã uỷ quyền (ADR-90). `memberId` = người đã uỷ quyền kết nối.

## Use case

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-601](UC-601-noi-claude-bang-oauth.md) | Nối Claude (và ứng dụng AI) bằng OAuth | implemented | BR-05, BR-09, BR-10 |
| [UC-602](UC-602-doc-so-lieu-qua-mcp.md) | Đọc số liệu qua MCP (`get_snapshot` = màn Hôm nay) | implemented | BR-05, BR-01, BR-07, BR-04 |
| [UC-603](UC-603-ghi-giao-dich-qua-mcp.md) | Ghi giao dịch nhập tay qua MCP | implemented | BR-05, BR-03 |
| [UC-604](UC-604-gan-log-qua-mcp.md) | Gán log ngân hàng qua MCP | implemented | BR-05, BR-04 |
| [UC-605](UC-605-chia-thu-nhap-qua-mcp.md) | Xem trước & chia thu nhập qua MCP | implemented | BR-05, BR-02 |

Entity model: [entities.md](entities.md).

## Code sở hữu
- `src/oauth/server.ts`, `src/oauth/routes.ts` (authorization server, trang uỷ quyền, resource server `/mcp`), `src/routes/mcp.ts`, `src/mcp/tools.ts`, `web/public/oauth.css`
- Dùng chung với access: `src/services/member-login.ts` (đăng nhập bằng mật khẩu của app — UC-501); màn Cài đặt › Claude và ứng dụng AI (`GET`/`DELETE /v1/settings/mcp`) đặc tả ở access [UC-508](../access/UC-508-quan-ly-khoa-ket-noi.md), pwa [UC-709](../pwa/UC-709-sua-cau-hinh-man-cai-dat.md)
- Test: `test/mcp.test.ts`, `test/mcp-oauth.test.ts` (trừ phần UC-508, UC-503), `test/helpers/oauth.ts`
- Tool sổ người thuê (`list_tenants`, `add_tenant_shared_expense`) đặc tả ở context rental: [UC-802](../rental/UC-802-ghi-nguoi-thue-chi-ho.md), [UC-803](../rental/UC-803-xem-tam-tinh.md)
- Tool sổ nợ `get_debts` và `debt_id` ở `add_transaction`/`assign_log` đặc tả ở context debt: [UC-901](../debt/UC-901-them-va-xem-khoan-no.md), [UC-902](../debt/UC-902-tra-no.md), [UC-903](../debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md)
- Tool sổ phải thu `get_receivables` và `collect`/`receivable_id` ở `add_transaction`/`assign_log` đặc tả ở context receivable: [UC-1001](../receivable/UC-1001-them-va-xem-khoan-phai-thu.md), [UC-1002](../receivable/UC-1002-cho-vay-tra-ho.md), [UC-1003](../receivable/UC-1003-nhan-lai-tien.md)
- Kế hoạch & báo cáo: `plans/260921-2228-profit-first-pwa/phase-06-mcp.md`, `plans/reports/fullstack-developer-260922-0020-mcp-server.md`
