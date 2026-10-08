# UC-106: Đối soát tài khoản
- Status: implemented
- BR: BR-04, BR-01, BR-05
- Decisions: `docs/core_design_rules.md` §7; `phase-01-worker-d1.md` S4 (tách `book_drift`, log `pending` là "chưa gán" không phải lệch), S5 (TK không có số dư feed đối soát bằng nhập số dư thật); ADR-76 (số dư đầu là mốc); ADR-87 (bỏ hẳn số lũy kế SePay — không còn lớp so với số ngân hàng báo); ADR-92 (tên tiếng Anh: tool MCP `get_reconciliation`)
- Actor: thành viên (màn Tài khoản), Claude (MCP `get_reconciliation`), cron 07:00 (notify UC-402), snapshot (UC-103)
- Trigger: `GET /v1/accounts`

## History
- v1 (2026-09-22, commit `a773716`): schema v1.3 — `v_reconcile` hai lớp, `v_account_book`, `v_account_bank`, `v_account_logs`, `v_account_tx_from_logs`.
- v2 (2026-09-22, commit `b92fc0f`): `ledger.reconcile` + route `GET /v1/accounts` (kèm `lastCountAt`).
- v3 (2026-10-03, commit `f74bc70`): schema v1.16 (migration 0016, ADR-76) — `v_account_logs` chỉ tính log từ ngày mở sổ (`opened_at`, giờ VN): `feedBalance`, phần `assigned` của `bookDrift`, `pendingNet`, `pendingCount` không còn gồm log trước ngày đó (đã nằm trong `opening_balance`). `bookBalance` không cần đổi: sổ không nhận giao dịch trước ngày mở sổ (UC-101 bước 4j).
- v4 (2026-10-03, commit `85e6558`): schema v1.21 (migration 0021, ADR-83) — `bankBalance` bỏ `accumulated` **âm** ở tài khoản không phải thẻ tín dụng (coi như ngân hàng không báo số dư, giống 0). SePay báo −590.000 cho MB chi tiêu (vợ) khi số dư thật khoảng 250.000 → app báo "Lệch 840.000 ₫" giả.
- v5 (2026-10-03, commit `2608b66`): không đổi API hay view — PWA đọc hai lớp theo **một luật** cho mọi màn (`driftLayers`, `web/src/lib/drift.ts`): lớp nào ≠ 0 thì báo lớp đó (lớp 1 `feedDrift` "Ngân hàng báo khác sổ theo SePay — có thể sót giao dịch", lớp 2 `bookDrift` "Sổ diễn giải lệch"), "khớp" chỉ khi cả hai 0 hoặc NULL — đúng luật `attention.drift` của snapshot. Trước đó tab Tài khoản gộp `bookDrift ?? feedDrift`, nên `bookDrift = 0` che mất lệch lớp 1 (pwa UC-707 v14, UC-702 v9).
- v6 (2026-10-06, commit `9c265ee`): schema v1.23 (migration 0023, ADR-87) — chủ nhà: "tôi nghĩ là bạn bỏ phần lấy lũy kế của sepay đi, nó không đúng đâu à, bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè" (SePay báo 1.400.000 cho MB chi tiêu (vợ) khi số dư thật 2.000.000 và sổ khớp; app báo lệch 600.000 ₫ giả). Bỏ `bankBalance`, `feedDrift` (lớp 1), view `v_account_bank`, cột `bank_logs.accumulated`; lệch chỉ còn `bookDrift`; số dư thật chỉ đến từ Nhập số dư (UC-105) — PWA cho Nhập số dư ở mọi tài khoản (pwa UC-707 v19). Đổi tên UC (bỏ "hai lớp"). Change [`261006-bo-luy-ke-sepay`](../changes/archive/261006-bo-luy-ke-sepay/proposal.md).
- v7 (2026-10-07, commit `7424f26`): tool MCP đọc đối soát đổi tên `reconcile` → `get_reconciliation` (ADR-92); hàm `ledger.reconcile`, `GET /v1/accounts`, view `v_reconcile` và số liệu không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Không có.

## Main Flow
1. Với mỗi tài khoản **active**, đọc một dòng `v_reconcile` và `MAX(cash_counts.at)` của tài khoản.
2. Trả mỗi dòng: `accountId`, `name`, `kind`,
   - `bookBalance` = sổ (lớp 2): `opening_balance` + mọi `transactions` active chạm TK (vào +, ra −), gồm cả nhập tay và `adjust`;
   - `feedBalance` = `opening_balance` + Σ log của TK (vào +, ra −), **mọi trạng thái** log, chỉ log từ ngày `opened_at` (giờ VN) trở đi — TK không có `opened_at` thì mọi log (ADR-76, ingest UC-308);
   - `bookDrift` = Σ giao dịch active **sinh từ log** (`log_id` NOT NULL) chạm TK − Σ log `assigned` (từ ngày mở sổ) → ≠ 0 nghĩa là diễn giải lệch — **lệch đối soát duy nhất** (ADR-87); NULL khi TK chưa có log nào từ ngày mở sổ;
   - `pendingNet`, `pendingCount` = log `pending` ("chưa gán") từ ngày mở sổ, **không** tính là lệch;
   - `lastAt` = `at` log mới nhất của TK (mọi log); `lastCountAt` = lần đếm / nhập số dư gần nhất (UC-105).
3. Không có số dư do ngân hàng báo: số lũy kế SePay gửi kèm không được lưu hay so (ADR-87). Số dư thật chỉ đến từ người nhà Nhập số dư (UC-105), cho mọi tài khoản.

## Alternative Flows
- 2a. Tài khoản không có feed (tiền mặt, TK ghi tay): `bookDrift` = NULL; đối soát bằng đếm số dư (UC-105).

## Exceptions
- Không có mã lỗi nghiệp vụ.

## Acceptance Criteria
### AC-1: Log chưa gán hiện là "chưa gán", không phải lệch
- Given `vcb-husband` có một log `in` 500.000 `pending`
- When đọc `v_reconcile`
- Then `book_drift = 0`, `pending_net = 500.000`, `pending_count = 1`
- Tests: `test/schema.test.ts` › "đối soát › log chưa gán hiện là 'chưa gán', không phải lệch"

### AC-2: Log đã gán mà sổ diễn giải thiếu tiền → `book_drift` lộ ra
- Given log `out` 300.000 đã `assigned`, giao dịch sinh từ log chỉ 250.000
- When đọc `v_reconcile`
- Then `book_drift = 50.000`
- Tests: `test/schema.test.ts` › "đối soát › log đã gán mà sổ diễn giải thiếu tiền thì book_drift lộ ra"

### AC-3: Ngân hàng báo số dư khác tổng log → `feed_drift` lộ ra (deprecated v6: ADR-87 — không còn so với số SePay báo)

### AC-4: Tài khoản không có feed không bị tính lệch
- Given `cash-husband` không có log
- When đọc `v_reconcile`
- Then `book_drift = null`
- Tests: `test/schema.test.ts` › "đối soát › tài khoản không có feed (tiền mặt) không bị tính book_drift"

### AC-5: Kênh khác đọc cùng một nguồn
- Given log `out` 300.000 của `vcb-wife` đã gán mà giao dịch sinh từ log chỉ 250.000
- When cron 07:00 chạy
- Then dòng đối soát "lệch 50.000 ₫ ở VCB (vợ)" lấy từ `ledger.reconcile()`
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › đối soát lệch dùng ledger.reconcile(): sổ diễn giải khác giao dịch ngân hàng đã gán"

### AC-5b: Số lũy kế âm không phải số dư ngân hàng (deprecated v6: ADR-87 — `v_account_bank` không còn, mọi số lũy kế đều bỏ)

### AC-6: `GET /v1/accounts` trả kèm lần đếm gần nhất
- Given một lần đếm `cash-husband`
- When `GET /v1/accounts`
- Then dòng `cash-husband` có `lastCountAt` = `at` của lần đếm
- Tests: ⚠ Chưa có test

### AC-7: Số lũy kế SePay sai không làm lệch
- Given webhook SePay cho `vcb-husband` mang `accumulated` 1.400.000 khác hẳn sổ (như MB chi tiêu (vợ) 6/10/2026)
- When đọc `/v1/accounts` (`ledger.reconcile`) và snapshot
- Then dòng `vcb-husband` không có `bankBalance` / `feedDrift`, `bookDrift = 0`; `attention.drift` rỗng; không có `reconcile_drift`; `bank_logs` không có cột `accumulated`, `raw` giữ nguyên payload; một TK có `bookDrift` +50.000 thì `/v1/accounts` và `attention.drift` cùng báo đúng TK đó
- Tests: `test/webhooks.test.ts` › "nối trọn: webhook → rule mã → transaction › số lũy kế SePay gửi kèm sai hẳn số dư thật → không lưu, không báo lệch đối soát ở đâu cả (ADR-87)"; `test/logs.test.ts` › "lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán (ledger UC-103, UC-106 — ADR-87) › snapshot và /v1/accounts: lệch khi bookDrift ≠ 0; log chưa gán (bookDrift 0) và tài khoản không có log (null) không lệch; không còn số ngân hàng báo"; test migration ở repo gốc

## Traceability
- Code: `src/routes/v1.ts` › `GET /accounts`; `src/services/ledger.ts` › `reconcile`
- Migrations/DB: views `v_account_book`, `v_account_logs`, `v_account_tx_from_logs`, `v_reconcile` (`migrations/0001_schema.sql`; `v_account_logs` theo ngày mở sổ ở `migrations/0016_opening_date_cutoff.sql`; `v_reconcile` dựng lại không còn `bank_balance` / `feed_drift`, `v_account_bank` và `bank_logs.accumulated` bỏ ở `migrations/0023_drop_bank_accumulated.sql`); bảng `cash_counts`
- Dùng bởi: `getSnapshot` (UC-103), MCP `get_reconciliation` (mcp UC-602), cron daily (notify UC-402), PWA Ví & quỹ › Tài khoản và Hôm nay (pwa UC-707, UC-702 — cùng luật `driftOf`, `web/src/lib/drift.ts`).

## Divergences & Open Questions
- [DIVERGENCE] `docs/core_design_rules.md` §7: "tổng các `transactions` tách ra từ một log phải **bằng đúng** `log.amount`" — `v_reconcile` so theo **tổng tài khoản**, không theo từng log; mọi giao dịch không sinh từ log (nhập tay, `adjust`, `buy_asset`, hệ thống có `account_id`) nằm ngoài phép so `book_drift` (red-team #3, `plans/reports/redteam-260922-0100-money-correctness.md`). D14 chặn nhập tay trên TK có feed.
- [DIVERGENCE] `phase-03-api.md` dòng 32: `GET/POST /accounts` "thêm TK" — `/v1/accounts` chỉ có GET; thêm TK ở Cài đặt (access UC-506).
- [OPEN] TK chưa có log nào có `book_drift = NULL`, snapshot coi NULL như 0 (`src/domain/snapshot.ts` › `attention.drift`) — red-team #4 chỉ ra TK bị trừ oan không có log thì không lộ ra.
- Đã đóng 2026-10-06 (v6, ADR-87): [OPEN] cũ "số lũy kế **dương nhưng lệch gốc** vẫn bị coi là số dư ngân hàng và báo lệch giả" — app không còn đọc số lũy kế.
