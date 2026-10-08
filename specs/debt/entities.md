# Entity model — debt

Context này sở hữu: **Debt**, **DebtLine** và view **DebtBalance**. Tham chiếu theo tên: `Transaction` (ledger — khoản `spend` mang `debt_id` là tiền trả nợ),
`Category` `debt-payment` "Trả nợ" (ledger), `Wallet` "Thu cho thuê" (ledger, tier `holding`, kind `accrual` — ADR-63). Tất cả từ `migrations/0013_debts.sql` (schema v1.13).

---

## Debt — khoản nợ (`debts`)
| Trường | Ý nghĩa nghiệp vụ / luật |
|---|---|
| `id` | Mã `[a-z0-9-]{1,40}` (sai → `invalid_id`); không gửi thì sinh từ tên (bỏ dấu, `đ`→`d`, gạch nối) — `createDebt`; trùng → 409 `duplicate_id` |
| `name` | Tên chủ nợ/khoản nợ, bắt buộc; hiện ở tab Nợ, sheet Trả nợ, toast, `get_debts` |
| `note` | Ghi chú tuỳ chọn (`null` khi trống) |
| `active` | `1` = đang theo dõi. Tắt (`PATCH … {active:false}`): không gắn khoản chi (`inactive_debt`), không thêm dòng (`inactive_debt`), không vào tổng còn nợ, `bootstrap`, tin sáng. Bật lại được |
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

## DebtBalance — view `v_debt_balance`
`owed = Σ debt_lines.amount (status='active')`, `paid = Σ transactions.amount (meaning='spend', status='active', debt_id = d.id)`, `balance = owed − paid`; mọi khoản nợ (kể cả đã tắt), cột `debt_id, name, active, owed, paid, balance`.
Huỷ khoản trả nợ (ledger UC-102, gỡ gán ingest UC-306) là số còn nợ tự đúng lại — không có dòng nào phải huỷ kèm. `balance ≤ 0` = đã trả xong (`done`).

## Hình dạng API (`src/services/debts.ts`)
- `GET /v1/debts` → `{ totalBalance, debts: Debt[] }`; `totalBalance = Σ max(balance, 0)` các khoản đang bật.
- `Debt = { id, name, note, active, owed, paid, balance, done, createdAt, lines: DebtLine[], payments: DebtPayment[] }` — `lines` chỉ dòng `active`, mới nhất trước; `payments` = khoản `spend` `active` mang `debt_id`, mới nhất trước. Thứ tự: đang bật trước, chưa xong trước, `balance` giảm dần, tên.
- `DebtLine = { id, debtId, at, kind, amount, note, status }`; `DebtPayment = { transactionId, at, amount, walletId, accountId, note, source: 'manual'|'sepay'|'system' }`.
- `GET /v1/bootstrap` › `debts: [{ id, name, balance }]` — khoản đang bật, `balance` giảm dần rồi tên (có thể gồm khoản `balance ≤ 0`).

## Quan hệ
- `Debt` 1 — n `DebtLine`, 1 — n `Transaction(spend)` (qua `transactions.debt_id`).
- `Transaction(spend)` có `debt_id` thường n — 1 `Category` `debt-payment` và ví giữ riêng `rental-income` (mặc định của danh mục), nhưng ví/danh mục/tài khoản chọn tay vẫn được — sổ nợ chỉ đọc `amount`.
