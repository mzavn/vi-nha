# Bounded context: rental — Cho thuê lại

Nhà thuê nguyên căn, có người ở ghép (người thuê). Context này giữ **sổ người thuê**: sổ phải thu nằm **ngoài sổ cái**, ghi người thuê nợ bao nhiêu
(phí cố định + phần chi chung chia đều theo số người) và đã giảm nợ bao nhiêu (tự chi hộ, chỉnh tay). Tiền người thuê trả là một khoản `income` thật
của sổ cái, mang `tenant_id`, chia theo nguồn thu cho thuê (khóa 100% vào ví giữ riêng "Thu cho thuê"). Mỗi tuần ngồi với người thuê xem tạm tính;
cuối tháng chốt tay một lần; chênh lệch tự mang sang tháng sau bằng số dư (ADR-58, ADR-61, ADR-63). Context mới từ change `261001-cho-thue-lai`.

## Ngôn ngữ chung

| Thuật ngữ | Nghĩa trong context này |
|---|---|
| Người thuê (`Tenant`) | Người ngoài hộ ở cùng nhà. Không đăng nhập, **không phải** `member`; tiền họ chuyển không phải chuyển nội bộ |
| Sổ người thuê | Các dòng `tenant_lines` của một người thuê + các khoản `income` mang `tenant_id`. Chỉ ghi thêm; sai thì huỷ dòng (`void`) |
| Số dư người thuê | `v_tenant_balance.balance` = Σ dòng sổ `active` − Σ `income` `active` có `tenant_id`. **Dương = người thuê còn nợ; âm = đã trả dư, tự trừ vào tháng sau** |
| Phí cố định (`FixedFee`) | Khoản cố định mỗi tháng của một người thuê (Nhà, Gửi xe, Mạng, Dịch vụ) |
| Danh mục chi chung | Danh mục chi của hộ được chia cho người thuê (`config.rental_shared_categories`, seed `groceries,eating-out,utilities`) |
| Số người chia (`headcount`) | Số người cùng chia chi chung (`config.rental_headcount`, seed 3); sửa được lúc chốt |
| Tổng chi chung tháng | Σ (`spend` − `refund`) của hộ trong danh mục chi chung có `month_key` = tháng + Σ tiền mọi người thuê đã chi hộ trong tháng |
| Phần chi chung mỗi người | `floor(tổng chi chung / số người)`; phần lẻ hộ chịu; tổng ≤ 0 → 0 |
| Chi hộ (`paid_for_us`) | Người thuê tự bỏ tiền chi một khoản chi chung của nhà (đi chợ). Giảm nợ **và** cộng vào tổng chi chung tháng; không đụng ví nào của nhà |
| Tạm tính | Bảng của tháng chưa chốt: số dư đầu tháng + dòng đã ghi + bản nháp chốt − tiền đã chuyển. Chỉ đọc |
| Bản nháp chốt (`draft`) | Một dòng `fixed` cho mỗi phí đang thu + một dòng `shared` "Chi chung" (nếu > 0). Người sửa được trước khi lưu |
| Chốt tháng (settle) | Ghi một lần mỗi (người thuê, tháng): dòng `tenant_settlements` + các dòng sổ đã sửa. ⚠ Khác "chốt tháng" của allocation (quét dư phong bì, UC-207) |
| Bảng kê | Văn bản chép gửi người thuê (`statementText`) |
| Nguồn thu cho thuê | `config.rental_income_stream_id` (seed `rental` = khóa 100% vào ví `rental-income`) — ngôn ngữ của allocation, xem UC-201 |
| Ví giữ riêng "Thu cho thuê" | Ví `rental-income` (tier `holding`, kind `accrual`): không vào "còn để chi"; vợ chồng quyết từng lần trả nợ (chi danh mục `debt-payment`) hay chuyển sang Tích sản (ADR-63) |

## Use cases

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-801](UC-801-thiet-lap-nguoi-thue.md) | Thiết lập người thuê, phí cố định & chi chung | implemented | BR-11, BR-08 |
| [UC-802](UC-802-ghi-nguoi-thue-chi-ho.md) | Ghi người thuê chi hộ & dòng sổ tay | implemented | BR-11, BR-03 |
| [UC-803](UC-803-xem-tam-tinh.md) | Xem tạm tính tháng & bảng kê | implemented | BR-11 |
| [UC-804](UC-804-chot-thang-voi-nguoi-thue.md) | Chốt tháng với người thuê | implemented | BR-11, BR-06 |
| [UC-805](UC-805-nhan-tien-nguoi-thue-tra.md) | Nhận tiền người thuê trả & dùng tiền "Thu cho thuê" | implemented | BR-11, BR-02, BR-04 |

Entity model: [entities.md](entities.md). Màn PWA: [pwa/UC-713](../pwa/UC-713-man-nguoi-thue.md).

## Code thuộc context này
- `src/domain/rental.ts` (thuần): `sharePerHead`, `monthDraft`, `closingBalance`, `statementText`
- `src/services/rental.ts`: `rentalConfig`, `updateRentalConfig`, `getRental`, `createTenant`, `updateTenant`, `addFee`, `updateFee`, `addLine`, `voidLine`, `sharedTotal`, `tenantMonth`, `settleMonth`, `unsettledTenants`
- `src/routes/rental.ts` (mount `/v1/rental` sau `requireAuth`, `src/index.ts`)
- `migrations/0007_income_streams_rental.sql`: bảng `tenants`, `tenant_fixed_fees`, `tenant_lines`, `tenant_settlements`; cột `transactions.tenant_id`, `rules.tenant_id`; view `v_tenant_balance`; trigger `trg_tenant_lines_append_only`, `trg_tenant_lines_no_delete`; config `rental_*`
- MCP: `list_tenants`, `add_tenant_shared_expense` (`src/mcp/tools.ts`); nhắc ngày 1: `src/cron/daily.ts` + `src/notify/format.ts` › `dailyMessage`
- PWA: `web/src/screens/tenants.tsx`, `web/src/lib/rental.ts`; phần "Người thuê chi" trong `web/src/screens/other-entry-sheet.tsx`, "Thu từ người thuê" trong `web/src/screens/assign.tsx`, mục "Cho thuê" trong `web/src/screens/settings{,-sheets}.tsx`
- Test: `test/rental.test.ts`, `web/src/lib/rental.test.ts`; khối người thuê trong `test/{api,ingest,mcp,cron-daily,format}.test.ts`

Dùng chung, không sở hữu: `Transaction(income)` + `buildEntry` (ledger, UC-101), nguồn thu + engine chia (allocation, UC-201/UC-203), gán log + rule (ingest, UC-305/UC-307), `Category` (ledger), tin sáng (notify, UC-402).
