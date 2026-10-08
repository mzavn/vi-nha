# Entity model — ledger

Context này sở hữu: **Account**, **Wallet**, **Category**, **Transaction**, **CashCount**, **TaxSettlement**, value object **Period**,
và các **read model** tính ra (view SQL + hàm thuần): WalletBalance, Spent, WealthBuilding, SafetyFund, GoalProgress, AccountBook, Reconcile, Snapshot, Budget.

Tham chiếu theo tên (không sở hữu):
- `Member`, `Config` — **access** (`specs/access/entities.md`). Ở ledger, member chỉ là **nhãn**: "ai chi" (`transactions.by_member_id`), chủ tài khoản (`accounts.owner_member_id`), chủ ví cá nhân (`wallets.member_id`). Tiền thuộc về **hộ** (`migrations/0001_schema.sql` dòng 14: "Đơn vị là HỘ GIA ĐÌNH; `by_member_id` chỉ là nhãn").
- `AllocationRule` (bảng `allocations`), `AllocationRun`, `TransferOrder`, `IncomeStream` (nguồn thu + phần khóa), và hai dạng bút toán `FundEntry`/`SweepEntry` — **allocation** (`specs/allocation/entities.md`). Ledger chỉ **đọc** luật nạp để tính dự kiến kỳ (`monthTarget`, `weekTarget`), và **ghi** `TransferOrder` khi quyết toán thuế (UC-110).
- `BankLog`, `Rule` — **ingest** (`specs/ingest/entities.md`).
- `Tenant` (người thuê) — **rental** (`specs/rental/`). Khoản `income` gắn `tenant_id` là tiền người thuê trả; sổ người thuê nằm ngoài sổ cái (ADR-58).
- `Debt` (khoản nợ) — **debt** (`specs/debt/`). Khoản `spend` gắn `debt_id` là tiền trả nợ; sổ nợ nằm ngoài sổ cái (ADR-71).
- `Receivable` (khoản phải thu) — **receivable** (`specs/receivable/`). Khoản `lend`/`collect` gắn `receivable_id` là tiền cho vay đi / nhận lại; sổ phải thu nằm ngoài sổ cái (ADR-72). Cả ba sổ (người thuê, nợ, phải thu) là **sổ đối ứng ngoài sổ cái**: ghi nhớ "ai nợ ai", không phải tiền ([receivable/README.md](../receivable/README.md)).

Ba trục độc lập (`migrations/0001_schema.sql` dòng 15; `docs/profit_first_phuong_phap.md` §6): **Ví** = ngân sách · **Tài khoản** = tiền nằm đâu · **Danh mục** = nhãn phân tích.

---

## Account — tài khoản (bảng `accounts`, `migrations/0001_schema.sql` mục 2)
Nơi tiền thật **nằm**: ngân hàng, ví tiền mặt, ví điện tử.

| Trường | Nghĩa & luật |
|---|---|
| `id` | Mã chữ (`vcb-husband`, `cash-wife`); tạo từ Cài đặt (access). |
| `kind` | `bank` \| `cash` \| `ewallet` \| `credit` (CHECK, 0001). Tiền mặt là một account `kind='cash'`; rút ATM = `transfer` bank → cash (`docs/core_design_rules.md` §9). `credit` có trong CHECK nhưng thẻ tín dụng là non-goal V1 (`context.md`). |
| `bank` | `kind` `bank`/`credit`: **mã ngân hàng trong danh mục** `src/domain/banks.ts` › `BANKS` (ADR-66) — 10 ngân hàng SePay hỗ trợ (`MBBank`, `VietinBank`, `BIDV`, `ACB`, `VPBank`, `TPBank`, `Sacombank`, `MSB`, `OCB`, `KienlongBank`) kèm khả năng SePay (`in`/`out`/`vaRequired`), các ngân hàng ghi tay (`Vietcombank`, `Techcombank`, …) và `Khac`; mã lạ → `invalid_bank` (access UC-506). `ewallet`: tên nhà cung cấp tự do. Migration 0010 đổi tên gõ tay cũ sang mã (`MB`/`MBB`/`MB Bank` → `MBBank`, `TCB` → `Techcombank`, `VCB` → `Vietcombank`, `CTG` → `VietinBank`, `STB` → `Sacombank`, `VPB` → `VPBank`, `TPB` → `TPBank`, không phân biệt hoa thường). |
| `sepay_enabled` | 1 = **tài khoản có feed**: SePay báo **tiền vào** của tài khoản này. Chỉ bật được khi ngân hàng có SePay (`bank_not_supported`) và có `account_no` (`missing_account_no`) — `src/services/settings.ts` › `createAccount`/`updateAccount`. D14 theo chiều (ADR-48, ADR-66): **không nhận nhập tay tiền vào** tài khoản này (`createEntry` → `fed_account`) và **không cho đếm số dư khi còn log chưa gán** (`countAccount` → `pending_logs`). |
| `sepay_out` | 1 = SePay báo **cả tiền ra** (migration 0010, CHECK 0/1, mặc định 0). Luôn 0 khi `sepay_enabled = 0`. Mặc định khi bật SePay lấy theo tài liệu SePay (`BANKS[].sepay.out`: chỉ VietinBank, TPBank, Sacombank); chủ nhà bật tay được khi đã thử thấy tiền ra về app (ADR-66). 1 → nhập tay tiền ra từ tài khoản này bị `fed_account`, log `out` tự gán theo rule; 0 → tiền ra nhập tay được, log `out` không tự gán theo rule (ingest UC-303). `AccountRef.sepayOut` ở `loadRefs`/bootstrap = `sepay_enabled AND sepay_out`. |
| `sepay_connection_id` | Kết nối SePay (tài khoản công ty SePay) báo giao dịch của tài khoản này — `sepay_connections.id` (migration 0015, ADR-75). Bật SePay thì có đúng một (mặc định `default`), tắt SePay thì NULL (access UC-506). Webhook / rà soát của một kết nối chỉ khớp log vào tài khoản thuộc nó (ingest UC-301, UC-304). |
| `account_no` | Số tài khoản để khớp webhook; duy nhất khi khác NULL (`idx_acct_no`, 0001). |
| `owner_member_id` | Nhãn chủ TK; NULL = **tài khoản chung của nhà** (vd một ví tiền mặt chung — nhà như prod dùng `cash`). `cashAccountOf` chọn TK tiền mặt mặc định cho `spend`/`refund`/`lend`/`collect` theo thứ tự: của người đang nhập → TK tiền mặt chung (chủ NULL) → TK tiền mặt bất kỳ (`src/domain/entry.ts`). Settings cho bỏ chủ (`owner_member_id: null`). |
| `opening_balance` | Số dư lúc bắt đầu ngày `opened_at` (giờ VN) — đã gồm mọi giao dịch trước ngày đó; cộng vào `v_account_book.book_balance` và `v_account_logs.feed_balance`. **Không** vào ví nào (xem [OPEN] ở README). |
| `opened_at` | Ngày mở sổ `YYYY-MM-DD` (giờ VN), mốc của `opening_balance` (ADR-76): log ngân hàng trước ngày này ingest ghi `ignored` (ingest UC-302 2b), bút toán trước ngày này bị `before_opening` (UC-101 4j), `v_account_logs` chỉ tính log từ ngày này. NULL = không có mốc. Mặc định `date('now')` khi thêm (access UC-506). |
| `active` | 0 = ẩn khỏi `loadRefs` (không chọn được khi nhập), khỏi `v_account_book`/`v_reconcile`. Không tắt được khi còn ví active trú ở đó (`updateAccount` → `in_use`, 409). |
| `locked` | 1 = tiền thật của nhà nhưng chưa rút ngay được — heo đất MB (migration 0017, CHECK 0/1, mặc định 0, ADR-77). Nằm trong `cash` của `GET /v1/networth` và được tách ra ở `locked` (tổng + từng tài khoản kèm chủ, receivable UC-1005) — là phần Tích sản tiền mặt đang nằm ở heo (tiền bỏ heo vào ví Tích sản, ADR-82), không cộng thêm lần nữa. Không đổi sổ, đối soát, đếm số dư hay luật nhập tay. Chỉ migration đặt: API Cài đặt không đọc, không ghi cột này; `GET /v1/settings` trả nó từ ADR-85 (để khóa ô "Tính vào tiền chi được" — access UC-505, UC-506). Seed: `piggy-husband`, `piggy-wife` khi có thành viên `husband`/`wife`. |
| `spendable` | 1 = số dư sổ cộng vào "Tiền chi được" ở Hôm nay (`snapshot.spendableCash`, ledger UC-103 bước 7b, ADR-85) — "Tính vào tiền chi được" ở Cài đặt (access UC-506 3f). CHECK 0/1, mặc định 1; migration 0022 đặt 0 cho thẻ tín dụng và tài khoản `locked`. Tài khoản `locked = 1` không bao giờ tính dù cột là gì (server chặn bật — `locked_account`). Không đổi sổ, đối soát hay tiền thật đang có. |
| `role` | Vai tài khoản Tích sản (ADR-88, `migrations/0024_accounts_role.sql`; giá trị tiếng Anh từ `migrations/0028_english_names.sql`, ADR-92): NULL = tài khoản thường · `piggy_bank` (heo đất) · `buffer` (phao dự phòng) · `term_deposit` (sổ tiết kiệm). CHECK: `piggy_bank` / `term_deposit` chỉ khi `locked = 1`, `buffer` chỉ khi `locked = 0`. Chuyển vào từ tài khoản thường là bỏ tiền vào Tích sản (UC-101 AC-24); tài khoản không tính có vai là chỗ giữ Tích sản (`spendableCash.wealthBuildingOutside`, UC-103); `GET /v1/wealth-building` liệt kê theo vai (UC-107). Đặt / đổi ở Cài đặt (access UC-506). |

## Wallet — ví (bảng `wallets`, 0001 mục 3)
Đơn vị **ngân sách**. Số dư ví là số tính ra (WalletBalance), không lưu.

| Trường | Nghĩa & luật |
|---|---|
| `tier` (phe) | `holding` \| `wealth_building` (Tích sản) \| `tax` \| `nice` (Hưởng thụ) \| `must` (Vận hành) (CHECK, 0001; giá trị Tích sản là `wealth_building` thay `tichsan` từ `migrations/0028_english_names.sql`, ADR-92). Phe `holding` gồm hai loại (`src/domain/types.ts`): **ví Thu nhập** (`kind='holding'`, `isIncomeHolding` — trạm trung chuyển) và **ví giữ riêng** (`kind≠'holding'`, `isReserve` — `rental-income` "Thu cho thuê", `kind='accrual'`, seed `migrations/0007_income_streams_rental.sql`): tiền đã tách khỏi chi tiêu, dùng theo quyết định từng lần (ADR-63); không có luật nạp, không vào "còn để chi", không vào `/v1/budget`, không vào Quỹ an tâm, hiện ở snapshot `reserves`. Ví `heo-dat` "Heo đất" (`kind='accrual'`, `shared`, trú ở `piggy-husband`, seed `migrations/0017_heo_dat.sql` — ADR-77) đã tắt (`active = 0`) ở `migrations/0020_heo_tich_san.sql` (ADR-82): tiền heo nay là Tích sản; dòng cũ mang `heo-dat` giữ nguyên trong sổ. |
| `must_group` | `must` (tối thiểu) \| `have` (Có thì tốt); bắt buộc khi `tier='must'` (CHECK `tier <> 'must' OR must_group IS NOT NULL`, 0001). |
| `kind` | `envelope` (tiêu theo kỳ) \| `accrual` (tích dồn) \| `bill` (hoá đơn) \| `holding` (CHECK, 0001). |
| `scope`, `member_id` | `shared` \| `personal`; ví cá nhân bắt buộc có `member_id` (CHECK `scope <> 'personal' OR member_id IS NOT NULL`, 0001). |
| `account_id` | Tài khoản ví **trú**; nhiều ví chung một tài khoản được. Quyết định lệnh chuyển tiền (allocation). |
| `private` | Ẩn **số** với người khác, vẫn hiện tên — "ẩn lịch sự, không phải bảo mật" (D6). Áp ở `buildSnapshot`, `getBudget`, `walletStatus`, `/v1/bootstrap` (`hidden`). |
| `active` | 0 = không vào `loadRefs`. |

Invariant (hộ):
- Đúng **một** ví `wealth_building` (Tích sản) active — app chặn tạo thêm (`createWallet` → `one_wealth_building`); `buildEntry`/`settleTax` lấy ví `wealth_building` **đầu tiên** tìm thấy. Không có ràng buộc DB.
- Đúng **một** ví Thu nhập (`tier='holding' AND kind='holding'`) — không tạo được từ Cài đặt (`TIERS` trong `settings.ts` không có `holding`); seed test kiểm. Không có ràng buộc DB (`phase-01-worker-d1.md` "Rủi ro"). Ví giữ riêng cũng không tạo được từ Cài đặt — chỉ có qua migration.
- Không tắt được ví phe `holding` (cả ví giữ riêng), `wealth_building`, ví luật `remainder` (`updateWallet` → `required_wallet`, 409).
- `tier`, `kind`, `scope` không đổi được sau khi tạo (`updateWallet` không vá các cột này).
- Khoá chi: `spend` không được trừ ví Thu nhập/`wealth_building` (ví giữ riêng thì được — trả nợ); `transfer` không được lấy từ ví `wealth_building`; chuyển ngân sách (transfer chỉ có ví) không được lấy từ hoặc chuyển vào ví Thu nhập (`buildEntry` → `locked_wallet`).

## Category — danh mục chi (bảng `categories`, 0001 mục 5)
Nhãn phân tích, **không có ngân sách riêng**. Chọn danh mục thì ví tự điền (`default_wallet_id`) (`docs/core_design_rules.md` §9).

| Trường | Luật |
|---|---|
| `id` | `[a-z0-9-]{1,40}`; không gửi thì sinh từ tên bỏ dấu (`slug` trong `src/services/ledger.ts`). Trùng → `duplicate` 409. |
| `name` | Bắt buộc khi tạo; cắt 60 ký tự. |
| `default_wallet_id` | Phải là ví active (`saveCategory` → `unknown_wallet`). Nếu là **ví cá nhân của người khác**, khi nhập sẽ đổi sang ví cá nhân cùng phe của người nhập (`walletFor`). |
| `sort`, `icon` | Thứ tự/biểu tượng; `sort` mặc định 100. |
| `active` | Tắt = ẩn khỏi lưới nhập (`loadRefs` chỉ lấy `active = 1`); không xoá. |

Seed danh mục `debt-payment` "Trả nợ" (ví mặc định `rental-income`, `migrations/0007_income_streams_rental.sql`): trả nợ = `spend` từ ví giữ riêng.

## Transaction — giao dịch đã diễn giải (bảng `transactions`, 0001 mục 7; `client_id` ở 0003)
Lớp 2 của sổ. **Chỉ ghi thêm**: code chỉ đổi `status` `active → void` và gắn `log_id_2` (ingest, khi còn NULL); không có `DELETE` nào (`src/services/*.ts`). Không có trigger DB cấm UPDATE/DELETE — bất biến chỉ giữ bằng code.

### Quy ước dấu — một luật, không ngoại lệ (0001 dòng 17–24; `docs/core_design_rules.md` §1.4)
- `wallet_id` = ví **được cộng** (+) · `counter_wallet_id` = ví **bị trừ** (−).
- `account_id` = tài khoản tiền **RA** · `counter_account_id` = tài khoản tiền **VÀO**.
- Tiền là INTEGER VND.

### Chín `meaning` và cột được đặt (theo code hiện tại)
| `meaning` | Ai ghi | `wallet_id` (+) | `counter_wallet_id` (−) | `account_id` (ra) | `counter_account_id` (vào) | Đổi số dư ví? |
|---|---|---|---|---|---|---|
| `spend` | nhập tay, ingest | — | ví chi | TK chi | — | có (−) |
| `income` | nhập tay, ingest | ví Thu nhập | — | — | TK nhận | có (+) |
| `refund` | nhập tay, ingest | ví được hoàn | — | — | TK nhận | có (+) |
| `transfer` (nhập tay) | nhập tay, ingest | ví đích (tuỳ chọn) | ví nguồn (tuỳ chọn) | TK nguồn | TK đích | chỉ khi có cặp ví |
| `transfer` (chuyển ngân sách) | nhập tay | ví đích | ví nguồn | — | — | có (chỉ đổi ví, không đổi tài khoản) |
| `transfer` (hệ thống) | chốt tháng `S…`, quyết toán thuế `T…`, migration 0020 (một lần, ADR-82: số dư dương ví `heo-dat` → Tích sản, `batch_id` NULL, note "Heo đất là Tích sản: chuyển số dư ví Heo đất sang Tích sản") | Tích sản | ví bị quét / Thuế / `heo-dat` | — | — | có |
| `fund` | allocation `A…` | ví đích | ví `holding` | — | — | có |
| `buy_asset` | nhập tay, ingest | ví `wealth_building` | — | TK (tuỳ chọn) | — | **không** (loại khỏi `v_wallet_flow`) |
| `lend` | nhập tay, ingest | — | — | TK chi | — | **không** (loại khỏi `v_wallet_flow`) |
| `collect` | nhập tay, ingest (ADR-72) | — | — | — | TK nhận | **không** (loại khỏi `v_wallet_flow`); không phải thu nhập, không vào `v_spent_*`, không chia |
| `adjust` | đếm số dư (UC-105) | ví `remainder` nếu thật > sổ | ví `remainder` nếu thật < sổ | TK nếu thật < sổ | TK nếu thật > sổ | có |

### Trường mang nghĩa nghiệp vụ
| Trường | Luật |
|---|---|
| `at` | Thời điểm khoản tiền xảy ra, lưu ISO UTC. Nhập tay: không gửi = lúc server nhận; gửi thì phải parse được (`invalid_at`) và không muộn hơn `now + 24h` (`future_at`) (`normalizeAt`). Hàng đợi offline gửi kèm giờ lúc nhập (`web/src/lib/types.ts` › `EntryBody`). |
| `amount` | > 0 (CHECK, 0001). Nhập tay: số nguyên, `≤ 1.000.000.000.000` (`MAX_AMOUNT`, `entry.ts` → `invalid_amount`). |
| `category_id` | Bắt buộc với `spend` — CHECK `meaning <> 'spend' OR category_id IS NOT NULL` (0001) và `missing_category` ở `buildEntry`. |
| `by_member_id` | Nhãn người ghi: người của phiên / `X-Member-Id` / owner mặc định với bearer (access), `by_member_id` với MCP. |
| `link_id` | `refund` → `spend` gốc (nhập tay phải trỏ về `spend` còn `active`, `invalid_link`); `fund` → `income` (allocation). |
| `batch_id` | Đợt hệ thống: `A<income_id>` (chia), `S<YYYYMM>` (chốt tháng), `T<năm>` (quyết toán thuế). NULL với nhập tay. |
| `asset_kind` | Chỉ `buy_asset`: `stock` \| `gold` \| `re` \| `fund` — kiểm ở app (`ASSET_KINDS` → `invalid_asset_kind`), **không** có CHECK DB. |
| `taxable` | Chỉ có nghĩa với `income`: 1 = thu nhập chưa khấu trừ, engine trích Thuế. Nhập tay: chỉ `true` JSON mới thành 1 (`src/routes/v1.ts`). |
| `income_stream_id` | Chỉ `income` (`income_only` nếu khác): nguồn thu quyết định phần khóa khi chia (allocation UC-201, ADR-59). Nhập tay/gán: chọn tay, hoặc có `tenant_id` thì lấy config `rental_income_stream_id`; ingest tự ghi lương: lấy từ rule lương. Nguồn phải có và đang bật khi nhập tay/gán. NULL = luật % chung như cũ. Cột thêm ở `migrations/0007_income_streams_rental.sql` (`REFERENCES income_streams`). |
| `tenant_id` | Chỉ `income`: tiền người thuê trả; người thuê phải có và còn ở. Giảm số dư phải thu `v_tenant_balance` (Σ dòng sổ người thuê − Σ `income` active gắn `tenant_id`); huỷ khoản thu thì số dư trở lại. Có `REFERENCES tenants` và index `idx_tx_tenant` (0007), nhưng không có CHECK ràng với `meaning` — "chỉ `income`" chỉ giữ ở `buildEntry`. |
| `debt_id` | Chỉ `spend` (`debt_spend_only` nếu khác): khoản trả nợ; khoản nợ phải có (`unknown_debt`) và đang bật (`inactive_debt`); không gửi `category_id` thì lấy `debt-payment`. Giảm số còn nợ `v_debt_balance` (Σ dòng nợ active − Σ `spend` active gắn `debt_id`); huỷ khoản chi thì số còn nợ trở lại. Có `REFERENCES debts` và index `idx_tx_debt` (`migrations/0013_debts.sql`), không có CHECK ràng với `meaning` — "chỉ `spend`" chỉ giữ ở `buildEntry`. |
| `receivable_id` | Chỉ `lend`/`collect` (`receivable_only` nếu khác, kể cả `refund`): khoản phải thu; phải có (`unknown_receivable`) và đang bật (`inactive_receivable`). `lend` tăng, `collect` giảm còn phải thu `v_receivable_balance` (Σ dòng sổ active + Σ `lend` − Σ `collect` active); huỷ thì số trở lại. `lend` không gửi `category_id` → `lending`. Có `REFERENCES receivables` và index `idx_tx_receivable` (`migrations/0014_receivables.sql`), không có CHECK ràng với `meaning` — chỉ giữ ở `buildEntry`. |
| `week_key`, `month_key` | Tính ở app từ `at` theo giờ VN (`weekKey`/`monthKey`); view nhóm theo hai cột này. Ngoại lệ: bút toán chốt tháng lấy `month_key` = tháng được chốt; `fund` chép kỳ của khoản thu; bút toán migration 0020 chép `at`/`week_key`/`month_key` của dòng `active` gần nhất đụng ví `heo-dat` (kỳ do app tính, không tính lại trong SQL). |
| `source` | `manual` \| `system` \| `sepay` \| `import` (CHECK, 0001; **mặc định DB là `sepay`**). `system` không huỷ lẻ được. `import` không có code nào ghi. |
| `status` | `active` \| `void` (CHECK). Mọi view chỉ đếm `active`. |
| `client_id` | Sinh ở máy (D12); duy nhất khi khác NULL (`idx_tx_client`, `migrations/0003_offline_entry_and_allocation_runs.sql`); route chỉ nhận `[A-Za-z0-9_-]{8,64}`. Server chống trùng: gửi lại trả bản đã ghi. |
| `log_id`, `log_id_2` | Log ngân hàng sinh ra giao dịch (ingest). Trigger `trg_tx_needs_pending_log`, `trg_tx_second_leg_needs_pending_log` (`migrations/0005_ingest_integrity_guards.sql`). |
| `note` | Nhập tay: trim, cắt 500 ký tự. |

### Trạng thái
```
active ──void──▶ void   (một chiều, không có đường quay lại)
```
- Chặn huỷ: `source='system'` hoặc `meaning='fund'` (`system_tx`); đã `void` (`already_void`).
- Huỷ `income` kéo theo huỷ các `fund` cùng lần chia + bỏ lệnh chuyển chưa làm (allocation UC-206). Trigger `trg_fund_void_needs_unsettled_batch` (`migrations/0006_allocation_undo_guard.sql`) chặn huỷ `fund` khi lệnh cùng `batch_id` đã `done`.

### Ràng buộc DB (CHECK, `migrations/0001_schema.sql`; bảng dựng lại ở `migrations/0014_receivables.sql` để thêm `collect`, giữ nguyên các CHECK khác)
- `amount > 0`; `meaning` ∈ 9 giá trị (`spend, income, refund, transfer, fund, buy_asset, lend, collect, adjust`); `source` ∈ 4; `status` ∈ 2.
- `meaning <> 'refund' OR wallet_id IS NOT NULL`
- `meaning <> 'spend' OR counter_wallet_id IS NOT NULL`
- `meaning <> 'spend' OR category_id IS NOT NULL`
- `meaning <> 'fund' OR (wallet_id IS NOT NULL AND counter_wallet_id IS NOT NULL)`

## CashCount — lần đếm số dư (bảng `cash_counts`, 0001 mục 9)
Một lần người nhà nhập **số dư thật** của một tài khoản (UC-105).
- `counted` (thật), `book` (sổ lúc đếm), `at`, `account_id` (NOT NULL), `adjust_tx_id` → bút toán `adjust` (NULL khi khớp).
- Luôn ghi **một dòng mỗi lần đếm**, kể cả khi khớp; chung batch với bút toán `adjust` (`countAccount`).
- `MAX(at)` theo tài khoản là `lastCountAt` của `GET /v1/accounts`; notify dùng để nhắc Chủ nhật (UC-404).

## TaxSettlement — quyết toán thuế năm (bảng `tax_settlements`, 0001 mục 11)
- `year` là PRIMARY KEY → mỗi năm quyết toán **một lần** (DB) + `already_settled` (app).
- `provisioned` (đã trích), `paid` (đã nộp), `surplus_tx_id` → bút toán `transfer` hệ thống `T<năm>` (NULL khi không thừa), `settled_at`.

## Period — kỳ (value object, `src/domain/period.ts`)
Mọi kỳ theo giờ Việt Nam (UTC+7, không giờ mùa hè), không theo UTC của Worker (`docs/core_design_rules.md` §4 "Ba ràng buộc kỹ thuật").
| Khái niệm | Hàm | Luật |
|---|---|---|
| Ngày | `dayKey` | `YYYY-MM-DD` theo giờ VN. |
| Tháng | `monthKey` | `YYYY-MM` theo giờ VN. |
| Tuần | `weekKey` | Tuần ISO 8601 `YYYY-Www` (thứ Hai đầu tuần; tuần 1 chứa thứ Năm đầu năm); không dùng `strftime('%W')`. |
| Số thứ Hai của tháng | `mondaysInMonth` | 4 hoặc 5 — hệ số đổi phong bì tuần sang nhu cầu tháng (D7). Tháng sai → throw. |
| Tuần còn lại | `weeksLeftInMonth` | `1 +` số thứ Hai **sau** hôm nay trong tháng (tính cả tuần đang chạy). |
| Thứ Hai đầu tuần | `weekStart` | `YYYY-MM-DD` của thứ Hai tuần ISO `YYYY-Www`; tuần ngoài 1..53 → throw. Dùng để chọn tháng cho dự kiến tuần của phong bì chia theo tuần (`weekTarget`). |
| Tháng còn lại | `monthsLeft` | Dùng bởi allocation (goal); tối thiểu 1. |

---

## Read models (tính ra, không lưu — `docs/core_design_rules.md` §1.5)

| Read model | Nguồn | Định nghĩa |
|---|---|---|
| WalletFlow / WalletBalance | `v_wallet_flow`, `v_wallet_balance` (0001; `v_wallet_flow` dựng lại ở 0014) | `+amount` theo `wallet_id`, `−amount` theo `counter_wallet_id`, chỉ `active`, **trừ** `buy_asset`, `lend`, `collect`. Số dư = tổng mọi thời gian. |
| Spent (đã tiêu ròng) | `v_spent_raw`, `v_spent_week`, `v_spent_month` | `spend` (+, theo `counter_wallet_id`) − `refund` (theo `wallet_id`), nhóm theo `week_key`/`month_key` **của chính dòng đó** (hoàn tiền lệch kỳ tính vào kỳ của khoản hoàn). |
| SpendByCategory | `v_spend_by_category` | `spend − refund` theo `category_id × month_key`. |
| WealthBuilding (Tích sản) | `v_wealth_building` (tên từ 0028) | `total` = số dư ví Tích sản; `assets` = Σ `buy_asset` active; `cash = total − assets`. |
| MustMonthlyAvg | `v_must_monthly_avg` | TB chi ròng nhóm Must (`tier='must' AND must_group='must'`) của tối đa 3 **tháng đã kết thúc** gần nhất (tháng VN `strftime('%Y-%m','now','+7 hours')`) (D9). |
| SafetyFund (Quỹ an tâm, ADR-93) | `v_safety_fund` (tên từ 0028) | Có ≥ 3 tháng: `target = avg × config.safety_fund_months`, `months_covered`, `pct ≤ 100`; chưa đủ → cả ba NULL. `cash` = Tích sản cash (gồm cả tiền đã bỏ heo qua app — ADR-82). |
| GoalProgress | `v_goal_progress` | Mỗi ví có luật `goal` active: `balance`, `missing`, `pct`, `days_left` (theo `julianday('now')`). |
| AccountBook (sổ TK) | `v_account_book` | `opening_balance + Σ(vào) − Σ(ra)` mọi `transactions` active chạm TK (gồm nhập tay); chỉ TK active. |
| AccountLogs / TxFromLogs | `v_account_logs`, `v_account_tx_from_logs` | Sổ theo log (mọi trạng thái log, chỉ log từ ngày `opened_at` — ADR-76, migration 0016), phần sổ sinh từ log. `v_account_bank` (số lũy kế SePay) bỏ ở migration 0023 (ADR-87). |
| Reconcile | `v_reconcile` | `feed_balance` (mở sổ + Σ log); `book_drift = tx_net − assigned_net` (NULL nếu TK không có log nào) — lệch duy nhất; `pending_net`/`pending_count` = "chưa gán" (không phải lệch); `last_at` = `MAX(at)` log của TK. Không có số dư ngân hàng (ADR-87). |
| Snapshot | `buildSnapshot` (`src/domain/snapshot.ts`) | Xem UC-103 (gồm `reserves` — ví giữ riêng). |
| Budget | `getBudget` (`src/services/ledger.ts`) | Query có tham số kỳ, không phải view (`migrations/0001_schema.sql` dòng 268–270; view mù kỳ đã bỏ). Mỗi dòng có `balance`; ví âm luôn hiện. Xem UC-104. |

## Quan hệ
- `Account` 1 — n `Wallet` (ví trú ở TK); `Account` n — 0..1 `Member` (chủ, nhãn).
- `Wallet` n — 0..1 `Member` (ví cá nhân); `Wallet` 1 — 0..1 `AllocationRule` active (allocation).
- `Category` n — 0..1 `Wallet` (ví mặc định).
- `Transaction` n — 0..2 `Wallet` (+/−), n — 0..2 `Account` (ra/vào), n — 0..1 `Category`, n — 0..1 `Member`.
- `Transaction(income)` n — 0..1 `IncomeStream` (allocation) qua `income_stream_id`; n — 0..1 `Tenant` (rental) qua `tenant_id`.
- `Transaction(spend)` n — 0..1 `Debt` (debt) qua `debt_id`.
- `Transaction(lend|collect)` n — 0..1 `Receivable` (receivable) qua `receivable_id`.
- `Transaction(refund)` n — 0..1 `Transaction(spend)` qua `link_id`.
- `Transaction` n — 0..2 `BankLog` qua `log_id`/`log_id_2` (ingest).
- `CashCount` n — 1 `Account`; `CashCount` 1 — 0..1 `Transaction(adjust)`.
- `TaxSettlement` 1 — 0..1 `Transaction(transfer, T<năm>)`; 0..n `TransferOrder` cùng `batch_id` (allocation sở hữu entity).
