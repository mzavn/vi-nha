# Entity model — receivable

Context này sở hữu: **Receivable**, **ReceivableLine**, view **ReceivableBalance** và read model **NetWorth** (bức tranh tiền thật). Tham chiếu theo tên: `Transaction` (ledger — `lend` mang `receivable_id` là tiền cho vay đi, `collect` mang `receivable_id` là tiền nhận lại),
`Category` `lending` "Cho vay / trả hộ" (ledger, seed), `Account` (ledger — nơi tiền ra/vào), `Debt` (debt), `Tenant` (rental). Bảng và view từ `migrations/0014_receivables.sql` (schema v1.14). Khuôn chung với sổ nợ: [README.md](README.md) mục "Sổ đối ứng ngoài sổ cái — luật chung".

---

## Receivable — khoản phải thu (`receivables`)
| Trường | Ý nghĩa nghiệp vụ / luật |
|---|---|
| `id` | Mã `[a-z0-9-]{1,40}` (sai → `invalid_id`); không gửi thì sinh từ tên — `createBook`; trùng → 409 `duplicate_id` (luật chung S1) |
| `name` | Tên người/nơi đang nợ hộ, bắt buộc; hiện ở tab Nợ, ô chọn khoản phải thu (Loại khác, Gán), `get_receivables` |
| `note` | Ghi chú tuỳ chọn (`null` khi trống) |
| `active` | `1` = đang theo dõi. Tắt: không gắn giao dịch (`inactive_receivable`), không thêm dòng (`inactive_receivable`), không vào tổng, `bootstrap`, tin sáng, `GET /v1/networth`. Bật lại được (luật chung S5) |
| `created_at` | `datetime('now')` UTC |

Không có xoá, không có seed.

## ReceivableLine — dòng phải thu (`receivable_lines`)
| Trường | Luật |
|---|---|
| `id` | `INTEGER PRIMARY KEY` |
| `receivable_id` | Khoản phải thu (`REFERENCES receivables`) |
| `at` | Thời điểm (ISO UTC); không gửi thì bây giờ |
| `kind` | `opening` · `adjust` (CHECK) |
| `amount` | Số nguyên ≠ 0 (CHECK); `opening` > 0 (CHECK `kind = 'adjust' OR amount > 0`). Dương = người ta nợ thêm; âm = bớt |
| `note` | Ghi chú tuỳ chọn |
| `status` | `active` → `void` (một chiều) |
| `created_at` | `datetime('now')` UTC |

| `kind` | Ai ghi, khi nào | Dấu |
|---|---|---|
| `opening` | `POST /v1/receivables` — số người ta đang nợ lúc bắt đầu theo dõi ([UC-1001](UC-1001-them-va-xem-khoan-phai-thu.md)) | + |
| `adjust` | `POST /v1/receivables/:id/lines` — chỉnh tay ([UC-1004](UC-1004-chinh-huy-dong-phai-thu.md)) | ± |

Không có `kind = lend` hay `collect`: cho vay thêm và nhận lại là **tiền thật** — `Transaction(lend)` / `Transaction(collect)` mang `receivable_id` ([UC-1002](UC-1002-cho-vay-tra-ho.md), [UC-1003](UC-1003-nhan-lai-tien.md)).

**Invariants**
- Chỉ ghi thêm: trigger `trg_receivable_lines_append_only` chặn mọi UPDATE trừ `status` `active → void`; `trg_receivable_lines_no_delete` chặn DELETE (ABORT `receivable_line_append_only`).
- `voidLine` chỉ đổi dòng đang `active` (409 `already_void` nếu không).
- Không dòng nào đổi ví hay tài khoản (luật chung S6).

## Transaction.receivable_id (cột của ledger)
`transactions.receivable_id TEXT REFERENCES receivables(id)`, index `idx_tx_receivable`. Chỉ có nghĩa với `lend` và `collect` (`buildEntry` → `receivable_only`, kể cả `refund`; DB không có CHECK ràng với `meaning`). Khoản phải thu phải có (`unknown_receivable`) và đang bật (`inactive_receivable`) lúc ghi. `lend` gắn `receivable_id` mà không gửi `category_id` → danh mục `lending` (nếu có; chỉ là nhãn — cho vay không vào chi theo danh mục).

| `meaning` | Cột tài khoản | Ví | Tác động sổ phải thu |
|---|---|---|---|
| `lend` | `account_id` = tài khoản tiền **ra** | không | `lent` + amount |
| `collect` | `counter_account_id` = tài khoản tiền **vào** (`account_id` gửi lên ?? tài khoản tiền mặt của người nhập) | không; không danh mục (`category_id` gửi lên không được ghi) | `collected` + amount |

## ReceivableBalance — view `v_receivable_balance`
`lent = Σ receivable_lines.amount (status='active') + Σ transactions.amount (meaning='lend', status='active', receivable_id = r.id)`, `collected = Σ transactions.amount (meaning='collect', status='active', receivable_id = r.id)`, `balance = lent − collected`; mọi khoản (kể cả đã tắt), cột `receivable_id, name, active, lent, collected, balance`.
Huỷ giao dịch (ledger UC-102, gỡ gán ingest UC-306) là số tự đúng lại (luật chung S3). `balance ≤ 0` = đã trả đủ (`done`).

## NetWorth — bức tranh tiền thật (`GET /v1/networth`, read model, không lưu)
| Trường | Nguồn | Nghĩa |
|---|---|---|
| `cash` | Σ `v_account_book.book_balance` các tài khoản `active` | **Tiền thật đang có** (VAS 24 §04 "Tiền") — số ra quyết định |
| `wealthBuildingCash` | snapshot `tiers.wealth_building.cash` | Phần tiền thật đã khóa ở Tích sản — **nằm trong** `cash`, không cộng thêm; gồm cả tiền đã bỏ heo qua app (bỏ heo chuyển ví Có thì tốt → Tích sản, ADR-82) |
| `wealthBuildingAccounts` | `{ total, accounts: [{ accountId, name, role, memberId, memberName, balance }] }` — `v_account_book` của tài khoản `active` có `accounts.role` (`piggy_bank` heo đất, `buffer` phao dự phòng, `term_deposit` sổ tiết kiệm — ADR-88, ADR-92), kèm chủ, xếp heo đất → phao → sổ rồi `id` | Chỗ tiền Tích sản tiền mặt đang nằm (ADR-82, ADR-88); **nằm trong** `cash` (và, với tiền chuyển vào qua app, trong `wealthBuildingCash`), không cộng thêm. PWA: tổng ≤ Tích sản → "Tích sản X đã khóa (gồm Y ở tài khoản Tích sản: Heo đất chồng … · Phao dự phòng · …)"; nhiều hơn Tích sản (tiền có từ trước khi dùng app) → "Tích sản X đã khóa, Tài khoản Tích sản Y (…)" (UC-1005) |
| `spendableThisWeek` | snapshot `spendableThisWeek` (người xem = người đăng nhập) | Còn để chi tuần này — nằm trong `cash` |
| `assets` | snapshot `tiers.wealth_building.assets` | Tài sản đã mua (vàng, CK…) — không phải tiền, không phải tương đương tiền |
| `receivables` | Σ `max(balance, 0)` khoản phải thu đang bật | Người khác nợ mình — chưa phải tiền |
| `tenants` | Σ `max(balance, 0)` người thuê đang ở (`v_tenant_balance`) | Người thuê còn nợ — chưa phải tiền |
| `tenantsPrepaid` | Σ `max(−balance, 0)` người thuê đang ở | Người thuê trả trước — mình còn nợ dịch vụ |
| `debts` | Σ `max(balance, 0)` khoản nợ đang bật (`v_debt_balance`) | Mình còn nợ |
| `netWorth` | `cash + assets + receivables + tenants − debts − tenantsPrepaid` | Tổng nếu ai cũng trả đủ — đứng **sau** tiền thật, không phải số hero (`docs/DESIGN.md` §4) |

Bất biến: không dòng sổ đối ứng nào chạm `cash` — `cash` chỉ đổi khi một giao dịch tiền thật chạm tài khoản (`lend` giảm, `collect` tăng).

## Hình dạng API (`src/services/receivables.ts`)
- `GET /v1/receivables` → `{ totalBalance, receivables: Receivable[] }`; `totalBalance = Σ max(balance, 0)` các khoản đang bật.
- `Receivable = { id, name, note, active, lent, collected, balance, done, createdAt, lines: ReceivableLine[], movements: ReceivableMovement[] }` — `lines` chỉ dòng `active`, mới nhất trước; `movements` = `lend`/`collect` `active` mang `receivable_id`, mới nhất trước. Thứ tự: luật chung S4.
- `ReceivableLine = { id, receivableId, at, kind: 'opening'|'adjust', amount, note, status }`; `ReceivableMovement = { transactionId, at, amount, kind: 'lend'|'collect', accountId, note, source }` (`accountId` = tài khoản tiền rời đi với `lend`, tài khoản tiền vào với `collect`).
- `GET /v1/bootstrap` › `receivables: [{ id, name, balance }]` — khoản đang bật, `balance` giảm dần rồi tên.

## Quan hệ
- `Receivable` 1 — n `ReceivableLine`, 1 — n `Transaction(lend|collect)` (qua `transactions.receivable_id`).
- `Transaction(lend)` có `receivable_id` thường n — 1 `Category` `lending`; `Transaction(collect)` không có danh mục, không có ví.
