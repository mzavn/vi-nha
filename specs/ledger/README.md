# Bounded context: ledger — Sổ tiền của hộ

Lõi tiền của app: ba trục **ví** (ngân sách) · **tài khoản** (tiền nằm đâu) · **danh mục** (nhãn), sổ `transactions` chỉ ghi thêm
với một quy ước dấu duy nhất, và mọi con số tổng hợp **tính ra** (view + hàm thuần), không lưu. Context này ghi các khoản nhập tay
(kể cả gửi lại từ hàng đợi offline), huỷ/đếm/điều chỉnh, quyết toán thuế năm, và trả lời "còn bao nhiêu để chi", ngân sách theo kỳ,
tích lũy, đối soát — cùng một nguồn số cho PWA, MCP và Telegram.

## Ngôn ngữ chung

| Thuật ngữ | Nghĩa trong ledger | Khác context khác? |
|---|---|---|
| Ví (`wallets`) | Đơn vị ngân sách; số dư = tổng dòng tiền `active` (`v_wallet_balance`) | — |
| Phe (`tier`) | `holding` (Thu nhập — trạm trung chuyển; và ví giữ riêng) · `wealth_building` (Tích sản) · `tax` · `nice` (Hưởng thụ) · `must` (Vận hành) | — |
| Ví giữ riêng (`isReserve`) | Ví phe `holding` mà `kind ≠ 'holding'` ("Thu cho thuê"): tiền đã tách khỏi chi tiêu, dùng theo quyết định từng lần (trả nợ, sang Tích sản — ADR-63); không vào "còn để chi", bảng ngân sách và Quỹ an tâm, hiện ở snapshot `reserves`. Chỉ migration tạo. Ví "Heo đất" (`heo-dat`, ADR-77) đã tắt từ migration 0020 (ADR-82) — không còn là ví giữ riêng đang dùng | pwa: nhóm "Quỹ giữ riêng" |
| Chuyển ngân sách | `transfer` không có tài khoản, chỉ hai ví: chuyển tiền giữa hai ví, tiền không rời tài khoản (UC-101 4e) | pwa: nút "Chuyển ngân sách" / "Bù" ví âm |
| Nhóm Must / Có thì tốt (`must_group`) | Hai nhóm **trong** phe `must`: `must` = mức sống tối thiểu (dùng cho Quỹ an tâm), `have` = Có thì tốt (ví nhận phần còn lại) | ⚠ "Must" vừa là tên phe vừa là tên nhóm |
| Tài khoản (`accounts`) | Nơi tiền thật nằm; số dư sổ = `v_account_book` | — |
| Tài khoản Tích sản (`accounts.role`) | Tài khoản để dành tiền Tích sản (ADR-88): `piggy_bank` (heo đất, khóa) · `buffer` (phao dự phòng, không khóa) · `term_deposit` (sổ tiết kiệm, khóa); NULL = tài khoản thường. Chuyển vào từ tài khoản thường là bỏ tiền vào Tích sản (ví Có thì tốt → Tích sản) | pwa / access: chữ "Heo đất", "Phao dự phòng", "Sổ tiết kiệm" |
| Tài khoản đã khóa (`accounts.locked = 1`) | Tiền thật của nhà nhưng chưa rút ngay được — heo đất MB (`piggy-husband`, `piggy-wife`, ADR-77). Vẫn nằm trong tiền thật đang có (`cash` của `GET /v1/networth`), được tách thành `locked` (tổng + từng tài khoản kèm chủ) — là phần Tích sản tiền mặt đang nằm ở heo, không cộng thêm lần nữa (ADR-82). Ngoài ra như tài khoản ghi tay thường (sổ, đếm số dư, chuyển nội bộ). Chỉ migration đặt cờ | receivable UC-1005: "trong đó Tích sản … đã khóa (gồm heo đất …)" dưới Tiền thật đang có |
| Heo đất | MB "Tiết kiệm tiền lẻ": phần lẻ làm tròn mỗi lần chuyển khoản / quét QR đi vào sổ tích lũy. Mỗi người một tài khoản heo (đã khóa, ADR-77); tiền heo là **Tích sản** tiền mặt (ADR-82): bỏ heo = chuyển nội bộ MB → heo kèm chuyển ví Có thì tốt → Tích sản (nên Quỹ an tâm đếm cả tiền heo); heo trả về = chỉ chuyển tài khoản heo → tài khoản nhận, không chuyển ví — tiền vẫn thuộc Tích sản. Tổng heo theo người ở `locked` của `GET /v1/networth`, không có ví riêng (ví `heo-dat` tắt từ migration 0020) | ingest: rule `transfer` gắn tài khoản (UC-303, UC-305) |
| Tài khoản có feed | `sepay_enabled = 1`: tiền vào tự về từ ngân hàng, cả tiền ra nếu `sepay_out = 1`; chiều tự về thì **không** nhập tay (D14 theo chiều, ADR-66) | ingest gọi là "TK đã nối SePay" |
| Danh mục (`categories`) | Nhãn phân tích chi, có ví mặc định; không có ngân sách riêng | — |
| Giao dịch (`transactions`) | Một dòng đã diễn giải của sổ, có `meaning` | ⚠ ingest: "log" (`bank_logs`) là dữ liệu thô, **không** phải giao dịch |
| `meaning` | Ý nghĩa quyết định tác động ví, không phải hướng tiền: `spend` `income` `refund` `transfer` `fund` `buy_asset` `lend` `collect` `adjust` | ⚠ allocation dùng `fund` chỉ cho bút toán lần chia; receivable: `lend`/`collect` là tiền thật của sổ phải thu (ADR-72) |
| Nhập tay | Khoản do người ghi qua `POST /v1/transactions` (hoặc MCP), `source='manual'` | pwa: "Nhập nhanh" / "Loại khác" là giao diện của cùng API |
| Huỷ (`void`) | Đổi `status` sang `void`; không xoá, không sửa đè | ingest: "gỡ gán" là huỷ + trả log về `pending` |
| Đếm số dư | Nhập số dư thật của một tài khoản; lệch → bút toán `adjust` | notify: "đếm ví" Chủ nhật |
| Đã tiêu (`spent`) | `spend − refund` của ví trong **kỳ** (tuần ISO / tháng) theo `week_key`/`month_key` của từng dòng | — |
| Dự kiến tháng (`monthTarget`) | Số định chi của ví trong tháng — `flat`: tiền × (số thứ Hai nếu tuần); `lump`: tiền; loại khác (`goal`, `percent`, `remainder`): không có. Không gọi là "mục tiêu" — chữ đó dành cho quỹ để dành có đích (luật `goal`, ADR-74) | ⚠ allocation "nhu cầu tháng" (`monthlyNeed`) có tính `goal` (phần còn thiếu ÷ số tháng còn lại); ledger thì `goal` → không có dự kiến tháng |
| Dự kiến kỳ (budget `target`) | Tuần: dự kiến tuần (`weekTarget` — phong bì tuần, hoặc phong bì tháng chia đều theo tuần); tháng: `monthTarget`, riêng ví `remainder` = số đã được chia trong tháng | — |
| Còn để chi tuần này (`spendableThisWeek`) | Tổng trên phong bì phe `must` không bị ẩn: có mức tuần → `min(mức − đã chi tuần, số dư)`; không → số dư ÷ tuần còn lại (âm giữ nguyên) | Là số hero của pwa, dòng đầu tin sáng notify, `get_snapshot` mcp |
| Tích sản cash / assets | Một ví, hai trạng thái tiền: `assets` = Σ `buy_asset`, `cash` = số dư − assets | — |
| Quỹ an tâm (`safetyFund`) | Ngưỡng động trong Tích sản: `safety_fund_months ×` TB chi nhóm Must 3 tháng đã kết thúc; không phải ví. Tiền mặt đo Quỹ an tâm = Tích sản cash, gồm cả tiền đã bỏ heo qua app (ADR-82). Trước ADR-93 gọi là "Phao khẩn cấp" — khác "Phao dự phòng" (vai tài khoản `buffer`) | notify: dòng tin sáng "Quỹ an tâm x/y tháng" |
| Chưa gán | Log `pending` của tài khoản (`pending_net`, `pending_count`) — **không** tính là lệch | ⚠ `transfer_orders.status='pending'` (allocation) là "lệnh chưa chuyển" |
| Lệch (đối soát) | `book_drift` (log đã gán ↔ giao dịch sinh từ log). Không có lệch so với số dư ngân hàng báo — số lũy kế SePay không dùng (ADR-87); số dư thật chỉ đến từ Nhập số dư (UC-105) | — |
| Riêng tư (`private`) | Ẩn **số** ví với người khác, vẫn hiện tên; ẩn lịch sự, không phải bảo mật (D6) | access UC-504 |
| Kỳ | Ngày / tuần ISO / tháng theo giờ Việt Nam (`src/domain/period.ts`) | — |

## Use cases

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-101](UC-101-nhap-tay-khoan-tien.md) | Nhập tay một khoản tiền (spend/income/refund/transfer/buy_asset/lend/collect) | implemented | BR-03, BR-04, BR-01 |
| [UC-102](UC-102-huy-giao-dich.md) | Huỷ / sửa giao dịch ghi tay | implemented | BR-04, BR-02, BR-03 |
| [UC-103](UC-103-xem-con-bao-nhieu-de-chi.md) | Xem "còn bao nhiêu để chi" (snapshot) | implemented | BR-01, BR-05, BR-07, BR-04 |
| [UC-104](UC-104-ngan-sach-theo-ky.md) | Ngân sách theo kỳ (dự kiến / thực tế / còn lại) | implemented | BR-01, BR-05 |
| [UC-105](UC-105-dem-so-du-dieu-chinh.md) | Đếm số dư tài khoản → bút toán điều chỉnh | implemented | BR-04, BR-07 |
| [UC-106](UC-106-doi-soat-tai-khoan.md) | Đối soát tài khoản | implemented | BR-04, BR-01, BR-05 |
| [UC-107](UC-107-theo-doi-tich-luy.md) | Theo dõi tích lũy — Tích sản, Quỹ an tâm, quỹ mục tiêu | implemented | BR-07, BR-01, BR-05 |
| [UC-108](UC-108-chi-theo-danh-muc.md) | Chi theo danh mục (so với tháng trước) | implemented | BR-01, BR-05 |
| [UC-109](UC-109-quan-ly-danh-muc.md) | Quản lý danh mục chi | implemented | BR-08, BR-03 |
| [UC-110](UC-110-quyet-toan-thue-nam.md) | Quyết toán thuế năm | implemented | BR-07, BR-02 |
| [UC-111](UC-111-so-giao-dich-va-du-lieu-nen.md) | Xem sổ giao dịch & tải dữ liệu nền | implemented | BR-03, BR-01, BR-09 |

Entity model: [entities.md](entities.md) — Account, Wallet, Category, Transaction, CashCount, TaxSettlement, Period, read models.

## Code thuộc context này
- `src/domain/types.ts`, `src/domain/entry.ts`, `src/domain/snapshot.ts`, `src/domain/period.ts` (dùng chung với allocation)
- `src/services/ledger.ts`: `loadRefs`, `insertTx`, `getTransaction`, `walletStatus`, `createEntry`, `voidTransaction`, `listTransactions`, `countAccount`, `getSnapshot`, `getBudget`, `spendByCategory`, `reconcile`, `goals`, `wealthBuildingBreakdown`, `wealthBuildingOpeningEntry`, `categoryUsage`, `saveCategory`, `taxFigures`, `getTax`, `settleTax`. **Không** gồm (allocation): `allocationContext`, `previewAllocation`, `allocateIncome`, `undoAllocationStatements`, `runUndo`, `salaryMinAmount`, `closeMonth`, `listTransferOrders`, `setTransferOrderStatus`.
- `src/routes/v1.ts`: `GET /bootstrap`, `/snapshot`, `/budget`, `/goals`, `/wealth-building`, `/accounts`, `/spend-by-category`, `/transactions`, `/categories`, `/tax/:year`; `POST /accounts/:id/count`, `/transactions`, `/transactions/:id/void`, `/transactions/:id/replace`, `/categories`, `/tax/:year/settle`; `PATCH /categories/:id`.
- `migrations/0001_schema.sql` (bảng `accounts`, `wallets`, `categories`, `transactions`, `cash_counts`, `tax_settlements`; mọi view), `migrations/0002_seed.sql` (= `docs/seed.sql`), `migrations/0003_offline_entry_and_allocation_runs.sql` (phần `client_id`, `idx_tx_batch`), `migrations/0005_ingest_integrity_guards.sql` (trigger trên `transactions`, dùng chung với ingest), `migrations/0017_heo_dat.sql` (`accounts.locked`, tài khoản heo đất, ví `heo-dat`), `migrations/0020_heo_tich_san.sql` (ADR-82: số dư dương của `heo-dat` sang Tích sản bằng **một** `transfer` hệ thống chỉ đổi ví — không tài khoản, `source='system'`, note "Heo đất là Tích sản: chuyển số dư ví Heo đất sang Tích sản", `at`/`week_key`/`month_key` chép từ dòng `active` gần nhất đụng `heo-dat`, như bút toán chốt tháng; rule `heo-dat` → Tích sản; tắt ví `heo-dat`; dòng cũ giữ nguyên), `migrations/0024_accounts_role.sql` (`accounts.role`, ADR-88), `migrations/0027_so_du_co_san_tich_san.sql` (ADR-91), `migrations/0028_english_names.sql` (ADR-92: dựng lại `wallets` / `accounts` với giá trị tiếng Anh, khoá `safety_fund_months`, view `v_wealth_building`, `v_safety_fund`); `docs/schema.sql`, `docs/seed.sql`.
- Test: `test/api.test.ts` (khối "nhập tay" và các ca đọc/đếm của "chia lương end-to-end"), `test/schema.test.ts`, `test/period.test.ts`, `test/tax.test.ts`, `test/piggy-bank.test.ts` (heo đất, dùng chung với ingest/receivable), `test/helpers/d1-sqlite.ts`.

## Phụ thuộc sang context khác (theo tên)
- allocation: UC-203 "Chia một khoản thu nhập" (income nhập tay không tự chia), UC-204 "Sinh lệnh chuyển tiền" (dùng khi quyết toán thuế), UC-206 "Gỡ lần chia khi huỷ khoản thu" (UC-102 gọi), UC-207 "Chốt tháng" (ghi `transfer` hệ thống `S…`); entity AllocationRule, TransferOrder.
- ingest: UC-305 "Gán log chưa gán" (dùng `buildEntry` với `source='sepay'`), UC-306 "Ghép cặp tay & gỡ gán", UC-308 "Ghi sự cố ingest"; entity BankLog.
- access: Member, Config (`safety_fund_months`); UC-504 "Ẩn lịch sự ví private"; UC-506 "Cấu hình tài khoản, ví, luật nạp" (tạo/sửa Account, Wallet, bật `sepay_enabled`).
- mcp: UC-602 "Đọc số liệu qua MCP" (`get_snapshot`, `get_budget`, `get_goals`, `get_spending_by_category`, `list_categories`, `get_reconciliation`), UC-603 "Ghi giao dịch qua MCP" (`createEntry`).
- notify: UC-402 "Tin sáng 07:00" (snapshot, `ledger.reconcile`), UC-404 "Nhắc đếm ví Chủ nhật" (`cash_counts`), UC-406 "Tổng kết tuần thứ Hai" (`getBudget`).
- pwa: UC-702 "Xem Hôm nay", UC-703 "Nhập nhanh khoản chi", UC-704 "Hàng đợi nhập offline", UC-705 "Nhập loại khác", UC-707 "Xem ví và quỹ", UC-708 "Đếm ví, nhập số dư thật".

## Divergences & Open Questions (cấp context)
- [DIVERGENCE] `migrations/0001_schema.sql` dòng 270, `docs/core_design_rules.md` §10, `plans/.../phase-01-worker-d1.md` dòng 27, `phase-03-api.md` dòng 47: SQL tập trung ở `src/db/queries.ts` — thư mục `src/db/` **rỗng**; SQL nằm trong `src/services/ledger.ts` (và một phần ở `src/cron/weekly.ts`).
- [DIVERGENCE] `plans/.../context.md` "Constraints" và `docs/core_design_rules.md` §9 "Kiến trúc": core thuần qua port `Store/Notifier/Config` — không có interface port nào trong `src/`; `src/domain/*` là hàm thuần nhận dữ liệu, `src/services/ledger.ts` gọi thẳng `D1Database`.
- [DIVERGENCE] `docs/core_design_rules.md` §10: "`schema.sql` (v1.3) … 13 bảng + 15 view" — schema hiện là v1.30 (`migrations/0030_setup_and_member_passwords.sql`), 31 bảng trong `docs/schema.sql` (thêm `allocation_runs`, rồi `income_streams`, `income_stream_locks`, `tenants`, `tenant_fixed_fees`, `tenant_lines`, `tenant_settlements`, rồi `push_subscriptions`, rồi `push_test_series`, rồi `debts`, `debt_lines`, rồi `receivables`, `receivable_lines`, rồi `sepay_connections`, rồi `zalo_link_codes`) và thêm hai trigger trên `tenant_lines`, hai trên `debt_lines`, hai trên `receivable_lines`; v1.17 chỉ thêm cột (`accounts.locked`, `rules.account_id`, `rules.counter_account_id`, `rules.from_wallet_id`), không thêm bảng; v1.18 thêm `members.zalo_chat_id` và bảng `zalo_link_codes` (ADR-80); v1.19 chỉ seed rule (mẫu heo đất `TICH LUY`, ADR-77); v1.20 chỉ đổi dữ liệu (rule heo → Tích sản, ví `heo-dat` tắt, ADR-82), không thêm bảng; v1.22 thêm cột `accounts.spendable` (ADR-85); v1.23 bỏ cột `bank_logs.accumulated` và view `v_account_bank` (ADR-87); v1.24 thêm cột `accounts.role` (tài khoản Tích sản, ADR-88), không thêm bảng; v1.25 thêm `auth_failures` (ADR-89), v1.26 thêm `audit_log` (ADR-90); v1.27 chỉ ghi bút toán `O:0027` (ADR-91); v1.28 dựng lại `wallets` / `accounts` với giá trị tiếng Anh (`wealth_building`, `piggy_bank` / `buffer` / `term_deposit`), đổi khoá `safety_fund_months`, view `v_wealth_building`, `v_safety_fund` (ADR-92), không thêm bảng; v1.29 đổi mã hệ thống `default`, `debt-payment`, `lending`, `rental` và chép icon vào `categories.icon` (ADR-94), không thêm bảng; v1.30 thêm cột `members.password_hash`, `members.session_gen` và khoá `config.setup_done` (ADR-95), không thêm bảng; dòng tiêu đề `docs/schema.sql` ghi đúng phiên bản (đúng từ ADR-75; trước đó vẫn ghi `v1.3`). Test giữ `docs/` và migrations cùng hình dạng: `test/schema.test.ts` › "migrations › chạy hết chuỗi migration ra đúng schema mô tả ở docs/ (docs là nguồn sự thật)".
- [OPEN] `accounts.opening_balance` vào số dư sổ tài khoản nhưng không vào ví nào; không có luồng nào đưa số dư mở sổ vào ngân sách, nên tổng số dư ví ≠ tổng số dư tài khoản ngay từ đầu (cộng thêm `buy_asset`, `lend`, `collect` là các loại chỉ đổi tài khoản).
- [OPEN] Append-only chỉ giữ bằng code (chỉ `UPDATE status` và `log_id_2`); DB không có trigger cấm `UPDATE`/`DELETE` trên `transactions`.
- [OPEN] `transactions.source` mặc định DB là `'sepay'`, và giá trị `'import'` được CHECK cho phép nhưng không có code nào ghi.
