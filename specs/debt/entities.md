# Entity model — debt

Context này sở hữu: **Debt**, **DebtLine** và view **DebtBalance**, cùng read model **DebtInterest** (lãi dự kiến / lãi đã trả tháng). Tham chiếu theo tên: `Transaction` (ledger — khoản `spend` mang `debt_id` là tiền trả nợ gốc; mang `interest_debt_id` là tiền trả lãi),
`Category` `debt-payment` "Trả nợ" (ledger), `Wallet` "Thu cho thuê" (ledger, tier `holding`, kind `accrual` — ADR-63), `Category` / `Wallet` hệ thống `loan-interest` "Lãi vay" (ledger, ADR-106). Bảng từ `migrations/0013_debts.sql` (schema v1.13); cột lãi, kỳ hạn, ngày tắt từ `migrations/0031_balance_sheet.sql` (schema v1.31).

---

## Debt — khoản nợ (`debts`)
| Trường | Ý nghĩa nghiệp vụ / luật |
|---|---|
| `id` | Mã `[a-z0-9-]{1,40}` (sai → `invalid_id`); không gửi thì sinh từ tên (bỏ dấu, `đ`→`d`, gạch nối) — `createDebt`; trùng → 409 `duplicate_id` |
| `name` | Tên chủ nợ/khoản nợ, bắt buộc; hiện ở tab Nợ, sheet Trả nợ, toast, `get_debts` |
| `note` | Ghi chú tuỳ chọn (`null` khi trống) |
| `active` | `1` = đang theo dõi. Tắt (`PATCH … {active:false}`): không gắn khoản chi (`inactive_debt`), không thêm dòng (`inactive_debt`), không vào tổng còn nợ, `bootstrap`, tin sáng, lãi dự kiến của ví "Lãi vay". Bật lại được |
| `interest_rate_bps` | Lãi suất %/năm lưu phần vạn (18% = 1800), `INTEGER NOT NULL DEFAULT 0`, 0…10000. API nhận / trả `interest_rate` / `interestRate` theo % (cho phép lẻ; ngoài 0–100 → `invalid_rate`). 0 = không lãi (không có lãi dự kiến, không có dòng ở Ngân sách). Bảng cân đối xếp nhóm: 0 → không lãi; dưới `fi_high_interest_bps` (mặc định 15%) → lãi thường; còn lại → lãi cao (balance [UC-1102](../balance/UC-1102-xem-bang-can-doi.md)) — ADR-106 |
| `term` | `short` \| `long` (mặc định `short`; sai → `invalid_term`) — nợ ngắn / dài hạn ở bảng cân đối |
| `monthly_payment` | Số trả mỗi tháng (gốc + lãi), số nguyên > 0 hoặc NULL; điền sẵn ô Số tiền của sheet Trả nợ ([UC-902](UC-902-tra-no.md)) |
| `due_day` | Ngày trả trong tháng 1–28 hoặc NULL; chỉ để hiện ("trả ngày 5"), v1 không nhắc |
| `deactivated_at` | Ngày (giờ VN) tắt khoản: ghi khi `active` 1 → 0, xoá về NULL khi bật lại (`updateBook`); khoản tắt từ trước migration 0031 giữ NULL. Bảng cân đối / lịch sử tính khoản theo trạng thái tại từng ngày: có mặt ở ngày D khi đang bật hoặc `deactivated_at` > D (ADR-100) |
| `created_at` | `datetime('now')` UTC |

Không có xoá, không có seed: hộ tự thêm khoản nợ (vd 15.379.000 ₫ chia theo từng chủ nợ).

## DebtLine — dòng nợ (`debt_lines`)
| Trường | Luật |
|---|---|
| `id` | `INTEGER PRIMARY KEY` |
| `debt_id` | Khoản nợ (`REFERENCES debts`) |
| `at` | Thời điểm (ISO UTC); không gửi thì bây giờ |
| `kind` | `opening` · `borrow` · `adjust` (CHECK) — bảng dưới |
| `amount` | Số nguyên ≠ 0 (CHECK); `opening`/`borrow` > 0 (CHECK `kind = 'adjust' OR amount > 0`). Dương = nợ thêm; âm = bớt nợ |
| `note` | Ghi chú tuỳ chọn |
| `status` | `active` → `void` (một chiều) |
| `created_at` | `datetime('now')` UTC |

| `kind` | Ai ghi, khi nào | Dấu |
|---|---|---|
| `opening` | `POST /v1/debts` — số tiền khi thêm khoản nợ ([UC-901](UC-901-them-va-xem-khoan-no.md)) | + |
| `borrow` | `POST /v1/debts/:id/lines` — vay thêm ([UC-904](UC-904-vay-them-chinh-huy-dong-no.md)) | + |
| `adjust` | `POST /v1/debts/:id/lines` — chỉnh tay ([UC-904](UC-904-vay-them-chinh-huy-dong-no.md)) | ± |

Không có `kind = payment`: tiền trả là `Transaction(spend)` có `debt_id` ([UC-902](UC-902-tra-no.md), [UC-903](UC-903-gan-giao-dich-ngan-hang-la-tra-no.md)).

**Invariants**
- Chỉ ghi thêm: trigger `trg_debt_lines_append_only` chặn mọi UPDATE trừ `status` `active → void`; `trg_debt_lines_no_delete` chặn DELETE (ABORT `debt_line_append_only`).
- `voidDebtLine` chỉ đổi dòng đang `active` (409 `already_void` nếu không).

## Transaction.debt_id (cột của ledger)
`transactions.debt_id TEXT REFERENCES debts(id)`, index `idx_tx_debt`. Chỉ có nghĩa với `spend` (`buildEntry` → `debt_spend_only`; DB không có CHECK ràng với `meaning`). Khoản nợ phải có (`unknown_debt`) và đang bật (`inactive_debt`) lúc ghi. Gắn `debt_id` mà không gửi `category_id` → danh mục `debt-payment` (nếu có).

## Transaction.interest_debt_id (cột của ledger, `migrations/0031_balance_sheet.sql`)
`transactions.interest_debt_id TEXT REFERENCES debts(id)`, index `idx_tx_interest_debt` `(interest_debt_id, month_key)` khi khác NULL và `active`. Khoản **trả lãi** (ADR-106): chỉ `spend` (`interest_spend_only`), không cùng `debt_id` (`debt_and_interest`), khoản nợ phải có và đang bật; không gửi `category_id` → `loan-interest` "Lãi vay" (ví Must "Lãi vay"). **Không** vào `v_debt_balance` (số còn nợ không đổi) — chỉ vào lãi đã trả tháng (`DebtInterest.paid`) và Chi tiêu / dòng con Lãi vay của báo cáo (balance UC-1106).

## DebtInterest — lãi dự kiến tháng (read model, `debtInterest` ở `src/services/debts.ts`, một câu cho mọi khoản)
Cho tháng M (giờ VN): `openingBalance` (B0) = Σ `debt_lines.amount` `active` có `date(at, '+7 hours')` trước ngày 1 của M − Σ `spend` `active` mang `debt_id` có `month_key` < M; `expected` = `floor(max(0, B0) × interest_rate_bps ÷ 120000)` (khoản đã tắt hoặc 0% → 0); `paid` = Σ `spend` `active` mang `interest_debt_id` có `month_key` = M. Dùng chung cho `GET /v1/debts` (`interestThisMonth`, `interestPaidThisMonth`), `bootstrap.debts`, dự kiến tháng của ví "Lãi vay" (ledger UC-103, UC-104 `interestLines`) và lần chia (allocation UC-201). Dư nợ đầu tháng ổn định cả tháng — trả gốc trong tháng chỉ hạ lãi của tháng sau.

## DebtBalance — view `v_debt_balance`
`owed = Σ debt_lines.amount (status='active')`, `paid = Σ transactions.amount (meaning='spend', status='active', debt_id = d.id)`, `balance = owed − paid`; mọi khoản nợ (kể cả đã tắt), cột `debt_id, name, active, owed, paid, balance`.
Huỷ khoản trả nợ (ledger UC-102, gỡ gán ingest UC-306) là số còn nợ tự đúng lại — không có dòng nào phải huỷ kèm. `balance ≤ 0` = đã trả xong (`done`).

## Hình dạng API (`src/services/debts.ts`)
- `GET /v1/debts` → `{ totalBalance, debts: Debt[] }`; `totalBalance = Σ max(balance, 0)` các khoản đang bật.
- `Debt = { id, name, note, active, deactivatedAt, owed, paid, balance, done, createdAt, lines: DebtLine[], payments: DebtPayment[], interestRate, term, monthlyPayment, dueDay, interestPerYear, interestThisMonth, interestPaidThisMonth }` — `lines` chỉ dòng `active`, mới nhất trước; `payments` = khoản `spend` `active` mang `debt_id`, mới nhất trước (khoản trả lãi không nằm ở đây). `interestPerYear` = `floor(max(balance, 0) × interest_rate_bps ÷ 10000)`; `interestThisMonth` / `interestPaidThisMonth` = `DebtInterest.expected` / `paid` của tháng hiện tại. Thứ tự: đang bật trước, chưa xong trước, `balance` giảm dần, tên.
- `DebtLine = { id, debtId, at, kind, amount, note, status }`; `DebtPayment = { transactionId, at, amount, walletId, accountId, note, source: 'manual'|'sepay'|'system' }`.
- `GET /v1/bootstrap` › `debts: [{ id, name, balance, interestRate, monthlyPayment, dueDay, interestThisMonth, interestPaidThisMonth }]` — khoản đang bật, `balance` giảm dần rồi tên (có thể gồm khoản `balance ≤ 0`); đủ để sheet Trả nợ tách lãi / gốc khi offline.

## Quan hệ
- `Debt` 1 — n `DebtLine`, 1 — n `Transaction(spend)` (qua `transactions.debt_id`).
- `Debt` 1 — n `Transaction(spend)` trả lãi (qua `transactions.interest_debt_id`) — thường danh mục / ví `loan-interest`; không đổi số còn nợ.
- `Transaction(spend)` có `debt_id` thường n — 1 `Category` `debt-payment` và ví giữ riêng `rental-income` (mặc định của danh mục), nhưng ví/danh mục/tài khoản chọn tay vẫn được — sổ nợ chỉ đọc `amount`.
