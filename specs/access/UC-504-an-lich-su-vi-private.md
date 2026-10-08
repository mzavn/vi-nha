# UC-504: Ẩn lịch sự số dư ví `private`
- Status: implemented
- BR: BR-01, BR-09
- Decisions: D6 ("`private` chỉ là ẩn lịch sự, không phải bảo mật"); `docs/core_design_rules.md` §9 (dòng "Đăng nhập"); `plans/260921-2228-profit-first-pwa/phase-03-api.md` §"Danh tính người dùng (D6)" ("Ví `private` của người khác: trả tên, ẩn số"); ADR-96 (ví `private` của người đã tắt không còn bị ẩn); ADR-97 (Claude nối bằng OAuth — tool nhìn như người đã uỷ quyền)
- Actor: Thành viên đang xem (người xem = `memberId` của request; qua Claude là người đã uỷ quyền kết nối)
- Trigger: `GET /v1/snapshot`, `GET /v1/budget`, `GET /v1/bootstrap`, toast sau `POST /v1/transactions`; MCP `get_snapshot`, `get_budget` (người xem = người đã uỷ quyền kết nối Claude, mcp UC-602)

## History
- v1 (2026-09-22, commit `a773716`): cột `wallets.private` trong schema v1.3.
- v2 (2026-09-22, commit `b92fc0f`): ẩn số theo người xem trong snapshot, budget, trạng thái ví sau khi ghi, cờ `hidden` ở bootstrap.
- v3 (2026-09-22, commit `c80ae89`): bật/tắt `private` từ màn Cài đặt (UC-506).
- v4 (2026-10-08, commit `1ed22e1`): ví `private` chỉ bị ẩn khi **chủ ví còn hoạt động** — tắt người (UC-507, ADR-96) thì người khác thấy số ví riêng của họ ("tiền vẫn nằm trong ví, chủ hộ thấy"); bật lại thì ẩn như cũ. Điều kiện nằm một chỗ ở `loadRefs`. Bước 2 sửa, thêm 2b, AC-4 (change [261007-thiet-lap-lan-dau](../changes/archive/261007-thiet-lap-lan-dau/proposal.md))
- v5 (2026-10-08, commit `e5ecf41`): tool MCP `get_snapshot`, `get_budget` nhìn **như người đã uỷ quyền kết nối Claude** (ADR-97, mcp UC-602) — ví `private` của người khác bị ẩn số như trên app của người đó; trước đây MCP luôn nhìn như chủ hộ. Bước 1 sửa, thêm AC-5 (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md))

## Preconditions
- Ví có `private = 1` và `member_id` (ví cá nhân). Seed không có ví `private` nào (`migrations/0002_seed.sql`).

## Main Flow
1. Server xác định người xem: `memberId` từ phiên / `X-Member-Id` / chủ hộ (UC-501, UC-502); qua MCP là người đã uỷ quyền kết nối Claude (`member_id` trong token OAuth — mcp UC-601, UC-602).
2. Một ví bị ẩn với người xem khi ví `private`, **chủ ví còn hoạt động** và chủ ví ≠ người xem (`private && member_id !== viewerId`, trong đó `private` đã gồm điều kiện chủ ví còn hoạt động — `src/services/ledger.ts` › `loadRefs`; `src/domain/snapshot.ts` › `hidden`). Chủ ví bị tắt (UC-507 1b, ADR-96) → ví không còn bị ẩn: tiền vẫn nằm trong ví, người khác thấy và chuyển ra được.
3. Snapshot: dòng ví bị ẩn vẫn có `id`, `name`, `tier`, `mustGroup`, `kind` nhưng `balance`, `monthTarget`, `spentMonth`, `weekTarget`, `spentWeek` = `null`.
4. Hệ quả tính tổng: ví bị ẩn **không** góp vào `spendableThisWeek` (lọc `balance !== null`) và góp `0` vào tổng từng tầng (`tiers.*`) — tổng hiển thị phụ thuộc người xem.
5. Budget: dòng ví bị ẩn có `target`, `spent`, `remaining` = `null`.
6. Trạng thái ví sau khi ghi (`ledger.walletStatus`): ví bị ẩn trả `balance`, `weekRemaining`, `monthRemaining` = `null`.
7. Bootstrap: mỗi ví có thêm `hidden = private && memberId !== người xem` để PWA không hiện số.

## Alternative Flows
- 2a. Chủ ví xem ví của chính mình → thấy đủ số.
- 2b. Chủ ví bị tắt → mọi người xem thấy số ví đó; bật lại chủ ví → ví lại bị ẩn với người khác như cũ. `GET /v1/settings` vẫn trả cờ `private` gốc của ví.

## Exceptions
- Không có lỗi: ẩn là trình bày, không chặn ghi. Người kia vẫn ghi được giao dịch vào ví `private` (không có kiểm tra nào trong `createEntry`).

## Acceptance Criteria
### AC-1: Ví riêng tư của người kia không có số
- Given ví `fun-wife` `private` của `wife`, người xem `husband`
- When dựng snapshot và trừ tạm một khoản chi vào `fun-wife`
- Then `balance` của `fun-wife` là `null` và `spendableThisWeek` không đổi
- Tests: `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví riêng tư của người kia không bị đụng (không có số để trừ)"

### AC-2: Toast sau khi ghi vào ví ẩn số không nói số dư
- Given `walletStatus` trả mọi số `null`
- When PWA hiện toast
- Then chỉ "Đã ghi 10.000 ₫."
- Tests: `web/src/lib/pending.test.ts` › "toast phản hồi ngân sách › ví tháng, ví ẩn số, snapshot của tuần trước"

### AC-3: Server ẩn số trong snapshot/budget theo người xem
- Given ví `private` của `wife`
- When `GET /v1/snapshot` và `GET /v1/budget` bằng phiên của `husband` rồi của `wife`
- Then với `husband` các số của ví đó là `null`; với `wife` có số
- Tests: ⚠ Chưa có test phía server (`test/`)

### AC-4: Ví `private` của người đã tắt không còn bị ẩn (ADR-96)
- Given ví `private` của X có số dư, người xem khác X
- When tắt X rồi người khác gọi `/v1/snapshot`, `/v1/budget`, `/v1/bootstrap`; rồi bật lại X
- Then thấy số của ví đó (bootstrap `hidden = false`); bật lại X thì ví lại bị ẩn như cũ
- Tests: [`test/members.test.ts`](../../test/members.test.ts) › "UC-504: ví private của người đã tắt không còn bị ẩn › tắt X → người khác thấy số ví private của X ở /v1/snapshot, /v1/budget, /v1/bootstrap; bật lại → ẩn như cũ"

### AC-5: Claude nhìn số như người đã uỷ quyền (ADR-97)
- Given ví `fun-wife` `private` của `wife` có 700.000; `husband` và `wife` mỗi người nối Claude (quyền Xem)
- When gọi tool `get_snapshot` bằng token của từng người
- Then với token của `husband`, `balance` của `fun-wife` là `null`; với token của `wife` là `700000`
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › get_snapshot như trên app của người đó: ví private của người khác bị ẩn"

## Traceability
- Code: `src/domain/snapshot.ts` › `buildSnapshot` (`hidden`); `src/services/ledger.ts` › `getSnapshot`, `getBudget`, `walletStatus`, `loadRefs` (`private` = cờ ví và chủ ví còn hoạt động); `src/routes/v1.ts` › `v1.get("/bootstrap")` (`hidden`); `src/mcp/tools.ts` › `registerTools` (`get_snapshot`, `get_budget` truyền `memberId` người uỷ quyền)
- Migrations/DB: `wallets.private INTEGER NOT NULL DEFAULT 0` (`migrations/0001_schema.sql`)
- PWA hiển thị: xem `specs/pwa/`

## Divergences & Open Questions
- [OPEN] Các đường sau **không** ẩn số ví `private`: `GET /v1/goals` / MCP `get_goals` (`ledger.goals` đọc `v_goal_progress` không có người xem), `snapshot.goals` (lấy từ `v_goal_progress`), `GET /v1/transactions` (`ledger.listTransactions` không nhận người xem), `GET /v1/settings` (trả cờ `private` nhưng không có số dư). Phù hợp với D6 "không phải bảo mật", nhưng chưa có quyết định nói rõ phạm vi ẩn.
- [OPEN] Vì ví bị ẩn tính `0` vào `tiers.*`, tổng tầng giữa hai người xem khác nhau — chưa rõ là chủ ý hay hệ quả phụ.
