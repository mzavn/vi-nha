# Entity model — rental

Context này sở hữu: **Tenant**, **FixedFee**, **TenantLine**, **TenantSettlement**, **RentalConfig** (ba khoá `config`) và view **TenantBalance**.
Tham chiếu theo tên: `Transaction` (ledger — khoản `income` mang `tenant_id` là tiền người thuê trả), `Category` (ledger), `IncomeStream` (allocation),
`Rule` (ingest — cột `tenant_id`), `Wallet` "Thu cho thuê" (ledger, tier `holding`, kind `accrual`). Tất cả từ `migrations/0007_income_streams_rental.sql`.

---

## Tenant — người thuê (`tenants`)
| Trường | Ý nghĩa nghiệp vụ / luật |
|---|---|
| `id` | Mã `[a-z0-9-]{1,40}`; không gửi thì sinh từ tên (bỏ dấu, `đ`→`d`, gạch nối) — `createTenant`; trùng → 409 `duplicate_id` |
| `name` | Tên hiện trên bảng kê, tin sáng, màn Gán |
| `active` | `1` = đang ở. Tắt khi người thuê ra (sau khi chốt tháng cuối — quy trình, server không kiểm). Người đã ra: không ghi chi hộ (`tenant_inactive`), không gắn khoản thu (`inactive_tenant`), không được nhắc chốt tháng; PWA vẫn hiện tới khi số dư về 0 |
| `created_at` | `datetime('now')` UTC |

Không đăng nhập, không phải `member`, không có xoá.

## FixedFee — phí cố định (`tenant_fixed_fees`)
| Trường | Luật |
|---|---|
| `tenant_id` | Người thuê |
| `name` | Tên khoản (Nhà, Gửi xe…); là tên dòng `fixed` của bản nháp chốt |
| `amount` | Số nguyên > 0 (CHECK + `money(..., positive)`) |
| `sort`, `active` | Thứ tự; phí tắt không vào bản nháp (`monthDraft`) |

Không có xoá — chỉ tắt. Bản nháp của một tháng chưa chốt luôn dùng danh sách phí **hiện tại**.

## TenantLine — dòng sổ người thuê (`tenant_lines`)
| Trường | Luật |
|---|---|
| `tenant_id`, `month_key` | Tháng của dòng (`monthKey(at)` cho dòng ghi tay; tháng được chốt cho dòng chốt) |
| `at` | Thời điểm (ISO UTC). Ghi tay nhận `at` (qua `normalizeAt`), mặc định bây giờ |
| `kind` | `opening` · `fixed` · `shared` · `one_off` · `paid_for_us` · `adjust` (CHECK) — bảng dưới |
| `name` | Tên dòng (bắt buộc cho `one_off`; `paid_for_us` mặc định là tên danh mục) |
| `amount` | Số nguyên ≠ 0. **Dương = người thuê nợ thêm; âm = giảm nợ** |
| `category_id` | Chỉ `paid_for_us`: danh mục chi chung (CHECK `kind <> 'paid_for_us' OR (amount < 0 AND category_id IS NOT NULL)`) |
| `client_id` | Chống trùng khi ghi tay (UNIQUE khi khác NULL) |
| `status` | `active` → `void` (một chiều) |

| `kind` | Ai ghi, khi nào | Dấu |
|---|---|---|
| `opening` | `createTenant` khi có `opening_balance ≠ 0` — tên "Số dư mở sổ", tháng tạo | ± |
| `fixed` | Chốt tháng (UC-804), mỗi phí một dòng | + |
| `shared` | Chốt tháng: phần chi chung mỗi người | + |
| `one_off` | Ghi tay: phí một lần (thẻ xe 100.000) | + |
| `paid_for_us` | Ghi tay / MCP: người thuê chi hộ một khoản chi chung — gửi số dương, lưu số âm | − |
| `adjust` | Ghi tay hoặc lúc chốt: chỉnh (ra giữa tháng, giảm tiền nhà…) | ± |

Không có `kind = payment`: tiền người thuê trả là `Transaction(income)` có `tenant_id` (UC-805).

**Invariants**
- Chỉ ghi thêm: trigger `trg_tenant_lines_append_only` chặn mọi UPDATE trừ `status` `active → void`; `trg_tenant_lines_no_delete` chặn DELETE (ABORT `tenant_line_append_only`).
- `voidLine` chỉ đổi dòng đang `active` (409 `already_void` nếu không).

## TenantSettlement — lần chốt tháng (`tenant_settlements`)
| Trường | Luật |
|---|---|
| `tenant_id`, `month_key` | PRIMARY KEY → mỗi người thuê chốt mỗi tháng **đúng một lần**; trùng khoá làm cả batch chốt huỷ → 409 `already_settled` |
| `headcount` | Số người chia đã dùng khi chốt (> 0) |
| `shared_total` | Tổng chi chung tháng **tính lại ở server lúc chốt** (không lấy số client gửi) |
| `at` | Thời điểm chốt |

Tồn tại = tháng đã chốt: tạm tính của tháng đó dùng `headcount`/`shared_total` đã lưu và không còn bản nháp. Không có "mở lại".

## RentalConfig — ba khoá `config`
| Khoá | Ý nghĩa | Seed | Ghi |
|---|---|---|---|
| `rental_headcount` | Số người chia mặc định | `3` | `PATCH /v1/rental/config` (1–50); đọc sai → 1 |
| `rental_shared_categories` | Danh sách mã danh mục chi chung, ngăn cách dấu phẩy | `groceries,eating-out,utilities` | phải là danh mục có thật (`unknown_category`) |
| `rental_income_stream_id` | Nguồn thu mặc định cho tiền người thuê trả | `rental` | phải là nguồn đang dùng (`unknown_income_stream`) |

## TenantBalance — view `v_tenant_balance`
`balance = Σ tenant_lines.amount (status='active') − Σ transactions.amount (meaning='income', status='active', tenant_id = t.id)`, mọi người thuê (kể cả đã ra).
Huỷ khoản thu (UC-102/UC-306) là số dư tự đúng lại — không có dòng nào phải huỷ kèm.

## Quan hệ
- `Tenant` 1 — n `FixedFee`, 1 — n `TenantLine`, 1 — n `TenantSettlement`, 1 — n `Transaction(income)` (qua `transactions.tenant_id`), 0..n `Rule` (qua `rules.tenant_id`, chỉ để gợi ý — ADR-60).
- `TenantLine(paid_for_us)` n — 1 `Category` (phải thuộc `rental_shared_categories` lúc ghi).
- `RentalConfig.rental_income_stream_id` → `IncomeStream` (allocation); nguồn seed `rental` khóa 100% vào ví `rental-income`.
