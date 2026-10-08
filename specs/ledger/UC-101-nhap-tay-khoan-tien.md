# UC-101: Nhập tay một khoản tiền
- Status: implemented
- BR: BR-03, BR-04, BR-01
- Decisions: D6, D12, D14; commit `b8e8f0c` (D14, red-team `plans/reports/redteam-260922-0100-money-correctness.md` #3), `11b12b3` (thông điệp `future_at`); ADR-59 (phần khóa theo nguồn thu), ADR-62 (mua vàng không đợi phao đầy), ADR-63 (ví giữ riêng "Thu cho thuê", trả nợ từng lần), ADR-66 (D14 theo chiều tiền SePay báo), ADR-71 (trả nợ = khoản chi có `debt_id`), ADR-72 (nhận lại tiền cho vay = `collect`; `receivable_id` trên `lend`/`collect`), ADR-76 (số dư đầu là mốc: không ghi giao dịch trước ngày mở sổ), ADR-92 (tên tiếng Anh trong code, dữ liệu, API), ADR-93 ("Quỹ an tâm"); ADR-94 (mã hệ thống tiếng Anh)
- Actor: thành viên trong hộ (PWA, session cookie) · script (bearer `API_TOKEN` + `X-Member-Id`) · Claude qua MCP `add_transaction` (mcp UC-603)
- Trigger: `POST /v1/transactions`

## History
- v1 (2026-09-22, commit `b92fc0f`): nhập tay 6 `meaning`, chống trùng theo `client_id` (migration 0003), đổi ví cá nhân theo người nhập, trả "ví còn bao nhiêu".
- v2 (2026-09-22, commit `b8e8f0c`): **D14** — từ chối nhập tay chạm tài khoản có feed (`fed_account`): nhập tay rồi gán log là đếm một khoản hai lần mà `book_drift` không bắt được (red-team #3).
- v3 (2026-09-22, commit `11b12b3`): `future_at` giải thích rằng đồng hồ điện thoại có thể chạy nhanh (nhập offline).
- v4 (2026-10-01, commit `034b7ff`): `income` nhận `income_stream_id`/`tenant_id` (tiền người thuê tự lấy nguồn cho thuê), khoản khác gửi hai trường này → `income_only`; `transfer` không tài khoản = **chuyển ngân sách** giữa hai ví, trả trạng thái ví nhận; được `spend` từ ví giữ riêng (Trả nợ); `buy_asset` không kiểm phao được ADR-62 chốt (change `261001-cho-thue-lai`).
- v5 (2026-10-01, commit `1f472a1`): nhà dùng **một ví tiền mặt chung** (`cash`, không gắn chủ). TK mặc định khi không gửi `account_id`: tiền mặt của người nhập → tiền mặt chung → tiền mặt bất kỳ (`cashAccountOf`).
- v6 (2026-10-01, commit `39751b8`): **D14 theo chiều tiền** (ADR-66) — chỉ chặn chiều SePay báo về: tiền **vào** tài khoản `sepay_enabled=1` luôn bị `fed_account`; tiền **ra** chỉ bị chặn khi tài khoản bật `sepay_out` ("SePay báo cả tiền ra"). Theo tài liệu SePay, MB chỉ báo tiền vào nên khoản chi trả bằng MB nhập tay được.
- v7 (2026-10-01, commit `25db5b9`): `spend` nhận `debt_id` (trả nợ — sổ nợ, debt [UC-902](../debt/UC-902-tra-no.md)); khoản khác gửi `debt_id` → `debt_spend_only`; khoản nợ không có/đã tắt → `unknown_debt`/`inactive_debt`; có `debt_id` mà không gửi `category_id` → danh mục `tra-no` (ADR-71).
- v8 (2026-10-01, commit `2438ac0`): meaning thứ bảy **`collect`** — tiền cho vay quay về: tiền vào một tài khoản, không ví, không danh mục, không phải thu nhập (ADR-72; đóng [OPEN] vòng `lend` → `refund`). `lend`/`collect` nhận `receivable_id` (sổ phải thu, receivable [UC-1002](../receivable/UC-1002-cho-vay-tra-ho.md), [UC-1003](../receivable/UC-1003-nhan-lai-tien.md)); khoản khác gửi `receivable_id` (kể cả `refund`) → `receivable_only`; khoản phải thu không có/đã tắt → `unknown_receivable`/`inactive_receivable`; `lend` không gửi `category_id` → danh mục `cho-vay`.
- v9 (2026-10-03, commit `f74bc70`): **số dư đầu là mốc** (ADR-76) — dòng chạm tài khoản (`account_id` hoặc `counter_account_id`) có `opened_at` mà ngày VN của `at` trước ngày đó → `before_opening` (4j). Áp cho mọi đường dùng `buildEntry`: nhập tay, sửa (UC-102), gán log (ingest UC-305), MCP `add_transaction`.
- v10 (2026-10-04, commit `c9c6acb`): không đổi hành vi nhập tay — kiểm `link_id` của `refund` (4b) tách thành `resolveRefundLink` (`src/services/ledger.ts`), dùng chung cho nhập tay, sửa (UC-102) và gán log (ingest UC-305 bước 6.7, change [`261004-gan-tham-chieu`](../changes/archive/261004-gan-tham-chieu/proposal.md)). PWA điền ví từ khoản gốc qua `walletOfMember` (ví cá nhân người kia → ví cùng phe của người nhập).
- v11 (2026-10-05, commit `d7992d1`): change [`261005-lien-ket-khoan-goc`](../changes/archive/261005-lien-ket-khoan-goc/proposal.md) — `link_id` hợp lệ cả cho **`collect`** (→ `lend` còn hiệu lực; 4b): sai loại → `invalid_link` "Khoản nhận lại phải trỏ về một khoản cho vay còn hiệu lực."; không gửi `receivable_id` thì lấy của khoản cho vay; gửi người khác người của khoản cho vay → `invalid_link` "Khoản nhận lại phải cùng người với khoản cho vay gốc." `resolveRefundLink` → `resolveLink` (theo `meaning`), dùng chung cho nhập tay, sửa (UC-102), gán log (ingest UC-305 bước 6.7). `link_id` chỉ là liên kết để đọc: không đổi số dư, không đổi sổ phải thu.
- v12 (2026-10-06, commit `9c265ee`): change [`261006-tai-khoan-phao`](../changes/archive/261006-tai-khoan-phao/proposal.md), ADR-88 — `transfer` có hai tài khoản mà **không gửi ví**: đích là tài khoản Tích sản (heo đất, phao dự phòng, sổ tiết kiệm — `accounts.role`), nguồn là tài khoản thường → server tự chuyển ví **Có thì tốt (ví `remainder`) → Tích sản** (`tichsanMove`); nguồn cũng là tài khoản Tích sản hay đích là tài khoản thường → chỉ đổi chỗ. Chủ nhà: "Tiền vào phao tự vào Tích sản (như heo đất)". AC-24.
- v13 (2026-10-07, commit `7424f26`): tên tiếng Anh (ADR-92), luật không đổi: phe ví Tích sản là `wealth_building` (khoá chi `locked_wallet`, `buy_asset` cần ví này), `buy_asset` kiểm `v_wealth_building.cash`; vai tài khoản Tích sản `piggy_bank` / `buffer` / `term_deposit` (AC-24); hàm `isWealthBuildingDeposit`, `wealthBuildingMove` (migration 0028, schema v1.28). "Phao khẩn cấp" gọi là Quỹ an tâm (ADR-93) (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v14 (2026-10-08, commit `21b9db0`): không đổi hành vi — danh mục mặc định của trả nợ / cho vay là mã hệ thống `debt-payment` / `lending` (hằng ở `src/domain/system-ids.ts`; migration 0029 đổi từ `tra-no` / `cho-vay`, ADR-94). Tên test AC-20 đổi theo. (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Người gọi đã xác thực; `memberId` được access đặt (session, `X-Member-Id`, hoặc owner mặc định khi dùng bearer).
- Có đúng một ví Thu nhập (`tier='holding'` **và** `kind='holding'`, `isIncomeHolding`) (cho `income`) và một ví Tích sản (`tier='wealth_building'`) (cho `buy_asset`); thiếu → `config` 400. Ví `tier='holding'` khác (ví giữ riêng, `isReserve`, ví dụ `rental-income`) không phải ví Thu nhập.

## Main Flow (luật chung, mọi `meaning`)
1. Route đọc body JSON object (sai → `invalid_input`); `meaning` phải thuộc `MANUAL_MEANINGS` = `spend, income, refund, transfer, buy_asset, lend, collect` (sai, kể cả `fund`/`adjust` → `invalid_input`).
2. Route kiểm kiểu: `amount` là số nguyên JS; các trường id (kể cả `income_stream_id`, `tenant_id`, `debt_id`, `receivable_id`)/`at`/`note` là chuỗi; `link_id` số nguyên; `taxable` chỉ `true` mới là có; `client_id` nếu có phải khớp `^[A-Za-z0-9_-]{8,64}$` (`src/routes/v1.ts`).
3. Có `client_id` và đã có dòng `transactions` mang `client_id` đó → trả **dòng cũ**, `duplicate: true`, `wallet: null`, HTTP **200**; không kiểm gì thêm (`createEntry`).
4. `buildEntry` (hàm thuần) dựng đúng **một** dòng theo quy ước dấu (bảng ở dưới): `amount` nguyên, `1 ≤ amount ≤ 1.000.000.000.000`; `at` chuẩn hoá (`normalizeAt`); `week_key`/`month_key` tính từ `at` theo giờ VN; `source='manual'`; `by_member_id` = người nhập; `note` trim ≤ 500 ký tự. `meaning ≠ 'income'` mà có `income_stream_id` hoặc `tenant_id` → `income_only`; `meaning ≠ 'spend'` mà có `debt_id` → `debt_spend_only`; `meaning ∉ {lend, collect}` mà có `receivable_id` → `receivable_only`.
5. **D14 theo chiều** (ADR-48, ADR-66): `counter_account_id` (tiền **vào**) là tài khoản `sepay_enabled=1`, hoặc `account_id` (tiền **ra**) là tài khoản `sepay_enabled=1` **và** `sepay_out=1` → từ chối `fed_account` (400) "…đã nối ngân hàng: khoản này sẽ tự về, gán nó ở màn Gán thay vì nhập tay." Theo bảng ánh xạ dưới: chiều vào = `income`, `refund`, `collect`, đích của `transfer`; chiều ra = `spend`, `lend`, `buy_asset` có tài khoản, nguồn của `transfer`.
6. Kiểm theo `meaning` (`buy_asset`: đủ tiền mặt Tích sản; `refund` / `collect` có `link_id`: khoản gốc hợp lệ) — xem Alternative Flows.
7. Ghi một `INSERT`; trả `{ tx, duplicate: false, wallet }` HTTP **201**, trong đó `wallet` = `walletStatus` của ví bị trừ (hoặc được cộng nếu không có ví bị trừ; riêng **chuyển ngân sách** — `transfer` không tài khoản — là ví **nhận**; `null` khi dòng không có ví — `lend`, `collect`, `transfer` chỉ tài khoản): `balance`, `weekRemaining` (`min(dự kiến tuần − đã chi tuần, số dư)`, chỉ khi ví có dự kiến tuần theo `weekTarget` — `flat`/`week`, hoặc phong bì tháng bật `split_weekly`: `floor(dự kiến tháng ÷ số thứ Hai)` của tháng chứa thứ Hai đầu tuần; xem UC-103), `monthRemaining` (`monthTarget − đã chi tháng`, `null` nếu không có dự kiến tháng); ví `private` của người khác → các số là `null`.

### Ánh xạ từng `meaning` (`src/domain/entry.ts` › `buildEntry`)
| `meaning` | Bắt buộc | Mặc định | Cột được đặt |
|---|---|---|---|
| `spend` | `category_id` (có `debt_id` thì mặc định `debt-payment`) | ví = `wallet_id` ?? ví mặc định của danh mục; TK = `account_id` ?? TK tiền mặt của người nhập | `counter_wallet_id`=ví, `category_id`, `account_id`=TK, `debt_id`; ví giữ riêng được phép (danh mục `debt-payment` "Trả nợ" → `rental-income`) |
| `income` | `account_id` (TK nhận) | ví Thu nhập; nguồn = `income_stream_id` ?? (có `tenant_id` → config `rental_income_stream_id`) ?? không | `wallet_id`=Thu nhập, `counter_account_id`=TK, `taxable`, `income_stream_id`, `tenant_id` |
| `refund` | ví (trực tiếp hoặc qua danh mục) | TK nhận = `account_id` ?? TK tiền mặt | `wallet_id`=ví, `counter_account_id`, `category_id`, `link_id` |
| `transfer` | `account_id` (nguồn), `to_account_id` (đích) — hoặc **không cả hai** mà có ví (chuyển ngân sách): `from_wallet_id`, `wallet_id` | — | `account_id`, `counter_account_id`; nếu gửi ví: `wallet_id`=ví đích, `counter_wallet_id`=`from_wallet_id`; không gửi ví mà đích là tài khoản Tích sản và nguồn là tài khoản thường (ADR-88): `wallet_id`=ví Tích sản, `counter_wallet_id`=ví `remainder` (Có thì tốt). Chuyển ngân sách: chỉ hai cột ví, hai cột tài khoản NULL |
| `buy_asset` | `asset_kind` ∈ `stock,gold,re,fund` | TK tuỳ chọn | `wallet_id`=Tích sản, `asset_kind`, `account_id` |
| `lend` | TK chi (trực tiếp hoặc TK tiền mặt) | danh mục tuỳ chọn (có thì giữ; không gửi → `lending` nếu hộ có) | `account_id`, `category_id`, `receivable_id`; không đụng ví |
| `collect` | TK nhận (trực tiếp hoặc TK tiền mặt) | có `link_id` mà không gửi `receivable_id` → `receivable_id` của khoản cho vay gốc (4b) | `counter_account_id`=TK, `receivable_id`, `link_id`; không ví, không danh mục — không phải thu nhập, không chia (ADR-72) |

## Alternative Flows
- 3a. Hai request cùng `client_id` chạy song song: bên thua dính unique index `idx_tx_client` (0003), đọc lại dòng đã ghi và trả `duplicate: true` (`createEntry`, nhánh `catch`).
- 4a. **Ví cá nhân của người khác** (ví dụ danh mục `hangouts` → `fun-husband`, người nhập là `wife`): đổi sang ví `personal` cùng `tier` của người nhập nếu có (`walletFor`). Áp cho `spend`, `refund`, và cả hai ví của `transfer` có tài khoản (chuyển ngân sách thì **không** đổi — 4e).
- 4b. **Khoản tiền về nối về khoản gốc** (`link_id`, `resolveLink`; chỉ là liên kết để đọc — số dư ví, tài khoản, sổ phải thu như khi không nối; `buildEntry` bỏ qua `link_id` của `meaning` khác):
  - `refund` → khoản gốc phải tồn tại, `active`, `meaning='spend'` (không thì `invalid_link` "Khoản hoàn tiền phải trỏ về một khoản chi còn hiệu lực."); nếu `refund` không có `category_id` thì lấy danh mục của khoản gốc. Ví **không** tự lấy từ khoản gốc ở server (PWA tự điền ví khoản gốc đã trừ — `walletOfMember`, pwa UC-705 / UC-706 ô "Trả lại cho khoản chi").
  - `collect` → khoản gốc phải tồn tại, `active`, `meaning='lend'` (không thì `invalid_link` "Khoản nhận lại phải trỏ về một khoản cho vay còn hiệu lực."); không gửi `receivable_id` thì lấy `receivable_id` của khoản cho vay (nếu có); gửi một người khác người của khoản cho vay → `invalid_link` "Khoản nhận lại phải cùng người với khoản cho vay gốc." (khoản cho vay không gắn người thì người gửi lên được giữ). Người kế thừa không kiểm lại `inactive_receivable`.
  - Sửa (UC-102): khoản gốc không được là chính khoản đang sửa. Gán log ngân hàng thành `refund` / `collect` kèm `link_id` qua cùng bước này (ingest UC-305 bước 6.7). Chi tiết giao dịch đọc hai chiều (UC-111 bước 3, pwa UC-715).
- 4c. `transfer` chỉ có tài khoản (ví dụ rút ATM `vcb → cash`): số dư ví không đổi, chỉ sổ tài khoản đổi. Gửi một trong hai ví thì phải gửi đủ cả hai (`missing_wallet`).
- 4d. `income` nhập tay **không tự chia**; chia là bước riêng (allocation UC-203 "Chia một khoản thu nhập", `POST /v1/allocate`), theo phần khóa của nguồn thu gắn trên khoản (ADR-59, allocation UC-201).
- 4e. **Chuyển ngân sách** (ADR-63; PWA "Chuyển ngân sách" / "Bù" ví âm — pwa [UC-712](../pwa/UC-712-chuyen-ngan-sach-va-bu.md)): `transfer` không có `account_id` lẫn `to_account_id` nhưng có `wallet_id` hoặc `from_wallet_id` → chỉ chuyển tiền giữa hai ví, tiền không rời tài khoản nào. Cần đủ hai ví (`missing_wallet`; id không có/không active → `unknown_wallet`); dùng **đúng** ví được gửi, không đổi sang ví cá nhân của người nhập; ví nguồn ≠ ví đích (`same_wallet`); không lấy từ Tích sản, không lấy từ hoặc chuyển vào ví Thu nhập (`locked_wallet`). Tích sản nhận được; ví giữ riêng chuyển ra/vào được. Không chạm tài khoản nên không bị D14 chặn.
- 4f. `income` có `tenant_id` (tiền người thuê trả — rental [UC-805](../rental/UC-805-nhan-tien-nguoi-thue-tra.md)): người thuê phải có (`unknown_tenant`) và còn ở (`inactive_tenant`); không gửi `income_stream_id` thì lấy nguồn ở config `rental_income_stream_id` (seed `rental`, khóa 100% vào `rental-income`). Có nguồn (gửi tay hay lấy mặc định) thì nguồn phải có (`unknown_income_stream`) và đang bật (`inactive_income_stream`). Khoản `income` gắn `tenant_id` làm giảm số dư phải thu của người thuê (`v_tenant_balance`); huỷ nó thì số dư trở lại.
- 4g. `spend` từ ví giữ riêng (`isReserve`, ví dụ "Thu cho thuê") được phép — trả nợ: danh mục `debt-payment` "Trả nợ" có ví mặc định `rental-income` (ADR-63).
- 4h. `spend` có `debt_id` (trả nợ — debt [UC-902](../debt/UC-902-tra-no.md)): khoản nợ phải có (`unknown_debt`) và đang bật (`inactive_debt`); không gửi `category_id` thì lấy danh mục `debt-payment` nếu hộ có (ví mặc định `rental-income`). Dòng ghi mang `debt_id` nên số còn nợ giảm đúng số tiền (view `v_debt_balance`); huỷ nó (UC-102) thì số còn nợ trở lại. Trả bằng tài khoản SePay báo cả tiền ra vẫn bị `fed_account` — trả bằng gán log (debt [UC-903](../debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md)).
- 4i. `lend`/`collect` có `receivable_id` (sổ phải thu — receivable [UC-1002](../receivable/UC-1002-cho-vay-tra-ho.md), [UC-1003](../receivable/UC-1003-nhan-lai-tien.md)): khoản phải thu phải có (`unknown_receivable`) và đang bật (`inactive_receivable`). `lend` làm còn phải thu tăng, `collect` làm giảm (view `v_receivable_balance`); huỷ (UC-102) thì số trở lại. Cả hai chỉ đổi số dư sổ tài khoản (`v_account_book`), không vào `v_wallet_flow`, `v_spent_*`, không chia (`/v1/allocate` → `not_income`). `collect` vào tài khoản nối SePay vẫn bị `fed_account` — gán log tiền vào ở màn Gán.
- 4j. **Số dư đầu là mốc** (ADR-76; `assertOpened`, cuối `buildEntry`): `opening_balance` của tài khoản là số dư lúc bắt đầu ngày `opened_at` (giờ VN), đã gồm mọi khoản trước ngày đó. Dòng có `account_id` hoặc `counter_account_id` là tài khoản có `opened_at` mà `dayKey(at)` < `opened_at` → `before_opening` 400 "Ngày này trước ngày mở sổ của tài khoản {tên} ({d/m/yyyy}) — số dư đầu đã tính khoản này." (kiểm trước D14). Đúng ngày `opened_at` từ 00:00 giờ VN thì được. Tài khoản `opened_at` NULL và chuyển ngân sách (không tài khoản) không bị chặn.
- 6a. `buy_asset`: `amount > v_wealth_building.cash` → `insufficient_cash` (409). Không kiểm Quỹ an tâm đã đầy hay chưa — đúng ý chủ nhà theo ADR-62 (Quỹ an tâm chỉ tính tiền mặt, mua vàng không đợi Quỹ an tâm đầy).

## Exceptions
- E1. Body không phải object JSON / kiểu trường sai / `meaning` ngoài danh sách / `client_id` sai dạng → `invalid_input` 400.
- E2. `amount` ≤ 0 hoặc > 10^12 → `invalid_amount` 400 "Số tiền phải là số nguyên dương, tính bằng đồng."
- E3. `at` không parse được → `invalid_at` 400; `at` > now + 24h → `future_at` 400.
- E4. `spend` thiếu danh mục → `missing_category`; danh mục không có/không active → `unknown_category`; không xác định được ví → `missing_wallet`; ví không có → `unknown_wallet` (400).
- E5. `spend` từ ví Thu nhập/`wealth_building`, `transfer` lấy từ ví `wealth_building`, hoặc chuyển ngân sách lấy từ / chuyển vào ví Thu nhập → `locked_wallet` 400.
- E6. Thiếu tài khoản cần thiết → `missing_account`; tài khoản không có/không active → `unknown_account` (400).
- E7. `transfer` cùng tài khoản → `same_account`; cùng ví → `same_wallet` (400).
- E8. `buy_asset` sai loại tài sản → `invalid_asset_kind` 400; không đủ tiền mặt Tích sản → `insufficient_cash` 409.
- E9. `refund.link_id` không hợp lệ → `invalid_link` 400.
- E10. Chạm chiều tiền SePay báo về của tài khoản có feed → `fed_account` 400 (D14 theo chiều, ADR-66).
- E11. `income_stream_id`/`tenant_id` gửi kèm `meaning ≠ 'income'` → `income_only` 400 "Nguồn thu và người thuê chỉ gắn được với khoản thu nhập."
- E12. `income` với người thuê không có → `unknown_tenant`; người thuê đã ngừng → `inactive_tenant`; nguồn thu không có → `unknown_income_stream`; nguồn đã tắt → `inactive_income_stream` (400).
- E13. `debt_id` gửi kèm `meaning ≠ 'spend'` → `debt_spend_only` 400 "Khoản nợ chỉ gắn được với khoản chi (trả nợ)."; khoản nợ không có → `unknown_debt`; đã tắt → `inactive_debt` (400).
- E14. `receivable_id` gửi kèm `meaning ∉ {lend, collect}` (kể cả `refund`) → `receivable_only` 400 "Khoản phải thu chỉ gắn được với cho vay hoặc nhận lại tiền cho vay."; khoản phải thu không có → `unknown_receivable`; đã tắt → `inactive_receivable` (400).
- E15. Ngày (giờ VN) trước ngày mở sổ của tài khoản dòng chạm tới → `before_opening` 400 (4j, ADR-76).

## Acceptance Criteria
### AC-1: Chi tiền mặt 3 chạm — ví theo danh mục, TK tiền mặt của người nhập, trả ví còn bao nhiêu
- Given `wife` đăng nhập, danh mục `fuel-parking` có ví mặc định `transport`, chưa chia lương
- When `POST /v1/transactions {meaning:"spend", amount:200000, category_id:"fuel-parking"}`
- Then 201; `tx` có `counter_wallet_id="transport"`, `account_id="cash-wife"`, `by_member_id="wife"`, `source="manual"`; `wallet.weekRemaining = -200000`
- Tests: `test/api.test.ts` › "nhập tay › chi tiền mặt: ví tự điền từ danh mục, tài khoản mặc định là tiền mặt của người nhập, trả về ví còn bao nhiêu"; qua MCP: `test/mcp.test.ts` › "add_transaction › \"chi 200k xăng tiền mặt\" → ghi vào ví đi-lai, tài khoản tiền mặt của người ghi"

### AC-2: Danh mục trỏ về ví cá nhân người khác → đổi sang ví của người nhập
- Given danh mục `hangouts` → `fun-husband`, người nhập `wife` có ví `fun-wife` cùng phe
- When `wife` ghi `spend` 50.000 danh mục `hangouts`
- Then `counter_wallet_id = "fun-wife"`
- Tests: `test/api.test.ts` › "nhập tay › vợ chọn danh mục trỏ về ví Chơi của chồng → tự đổi sang ví Chơi của vợ"

### AC-3: Gửi lại cùng `client_id` chỉ ghi một lần (D12)
- Given một khoản đã ghi với `client_id="c-2f9a8b7e-0001"`
- When gửi lại đúng khoản đó
- Then lần đầu 201, lần sau 200 với `duplicate: true` và cùng `tx.id`; DB có đúng 1 dòng mang `client_id` đó
- Tests: `test/api.test.ts` › "nhập tay › gửi lại cùng client_id (hàng đợi offline) chỉ ghi một lần"

### AC-4: Hai lần gửi cùng `client_id` song song vẫn chỉ một dòng
- Given hai request cùng `client_id` cùng vượt qua bước kiểm tra đọc
- When cả hai `INSERT`
- Then unique index `idx_tx_client` chặn một bên; bên đó trả dòng đã ghi với `duplicate: true`
- Tests: ⚠ Chưa có test

### AC-5: Từ chối đầu vào sai, không ghi gì
- Given dữ liệu seed
- When gửi lần lượt: `spend` thiếu danh mục; `amount` 1000.5; `amount` −5; danh mục không có; `spend` từ `wealth-building`; `transfer` cùng tài khoản; `transfer` lấy từ ví `wealth-building`; `buy_asset` khi Tích sản 0 đồng; `meaning:"fund"`; `at:"2099-01-01"`
- Then mã lỗi lần lượt `missing_category`, `invalid_input`, `invalid_amount`, `unknown_category`, `locked_wallet`, `same_account`, `locked_wallet`, `insufficient_cash`, `invalid_input`, `future_at`, HTTP ≥ 400
- Tests: `test/api.test.ts` › "nhập tay › từ chối đầu vào sai: %j → %s"

### AC-6: Không nhập tay trên tài khoản có feed (D14)
- Given `vcb-husband` nối SePay báo cả tiền ra (`sepay_enabled=1`, `sepay_out=1`)
- When ghi `spend` 150.000 với `account_id="vcb-husband"`
- Then lỗi `fed_account`; cùng khoản đó không gửi `account_id` → ghi vào `cash-husband` bình thường
- Tests: `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › nhập tay khoản chi bằng tài khoản đã nối feed → từ chối, hướng sang màn Gán"

### AC-7: Rút ATM là chuyển nội bộ — không đổi ví, chỉ đổi nơi tiền nằm
- Given mọi tài khoản ghi tay
- When `transfer` 2.000.000 từ `vcb-husband` sang `cash-husband`, không gửi ví
- Then `book_balance`: `cash-husband` = 2.000.000, `vcb-husband` = −2.000.000; không ví nào có số dư ≠ 0
- Tests: `test/api.test.ts` › "nhập tay › rút ATM là chuyển nội bộ: không đổi số dư ví, chỉ đổi tiền nằm ở đâu"

### AC-8: Hoàn tiền giảm "đã tiêu" và cộng lại ví
- Given một `spend` 500.000 ví `food` còn `active`
- When `refund` 200.000 `link_id` = khoản đó, `wallet_id="food"`
- Then `v_spent_month` của `food` = 300.000, số dư `food` = −300.000; `refund` mang `category_id` của khoản gốc
- Tests: ⚠ Chưa có test (red-team đã kiểm bằng PoC — `plans/reports/redteam-260922-0100-money-correctness.md` "Thuộc tính đã kiểm chứng")

### AC-9: Mua tài sản chỉ đổi trạng thái tiền trong Tích sản
- Given Tích sản có cash ≥ 1.000.000
- When `buy_asset` 1.000.000 `asset_kind="gold"`
- Then `v_wealth_building.assets` +1.000.000, `cash` −1.000.000, `total` không đổi
- Tests: ⚠ Chưa có test (chỉ có nhánh `insufficient_cash` ở AC-5; red-team kiểm bằng PoC)

### AC-10: Cho vay không đụng ví
- Given khoản phải thu `em-hai` đang bật
- When `lend` 500.000 từ `vcb-husband` kèm `receivable_id`, không gửi danh mục
- Then không ví nào đổi số dư; `book_balance` của `vcb-husband` giảm 500.000; `category_id = "lending"`, `wallet_id`/`counter_wallet_id` null
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › cho vay thêm (lend gắn khoản phải thu) tăng số phải thu, trừ tài khoản, không trừ ví, danh mục mặc định Cho vay"

### AC-11: Kỳ của khoản nhập tính theo giờ Việt Nam, tuần ISO
- Given `at` = `2026-09-30T23:30:00Z`
- When ghi
- Then `month_key = "2026-10"`; `week_key` theo ISO (ví dụ `2027-01-03T12:00+07:00` → `2026-W53`)
- Tests: `test/period.test.ts` › "kỳ theo giờ Việt Nam › 23:30 UTC đã là ngày hôm sau ở VN"; `test/period.test.ts` › "tuần ISO › %s → %s"

### AC-12: Tiền người thuê tự gắn nguồn cho thuê; trả nợ chi thẳng từ ví giữ riêng
- Given người thuê `an` đang ở; config `rental_income_stream_id = rental` (khóa 100% `rental-income`)
- When `POST /v1/transactions {meaning:"income", amount:5191667, account_id:"vcb-husband", tenant_id:"an"}` rồi `POST /v1/allocate`; sau đó `spend` 3.000.000 danh mục `debt-payment`
- Then `tx` có `wallet_id="income"`, `tenant_id="an"`, `income_stream_id="rental"`; đúng một fund 5.191.667 vào `rental-income`; khoản trả nợ 201 với `counter_wallet_id="rental-income"`, số dư ví còn 2.191.667; snapshot `reserves` = `[{walletId:"rental-income", name:"Thu cho thuê", balance:2191667}]`; ví này không có trong `/v1/budget`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; qua MCP: `test/mcp.test.ts` › "add_transaction › income kèm tenant_id → gắn người thuê, tự lấy nguồn thu cho thuê"

### AC-13: Nguồn thu chọn tay được lưu trên khoản thu; chỉ khoản thu nhập mới gắn được nguồn / người thuê
- Given nguồn `salary-wife` khóa 45% Tích sản
- When ghi `income` 11.000.000 với `income_stream_id:"salary-wife"` rồi chia; ghi `spend` kèm `income_stream_id`; ghi `income` với `tenant_id:"khong-co"`
- Then Tích sản = 4.950.000; khoản `spend` bị từ chối `income_only`; khoản thu với người thuê không có bị từ chối `unknown_tenant`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối"

### AC-14: Chuyển ngân sách giữa hai ví — chỉ đổi số dư ví, tài khoản không đổi, báo ví nhận
- Given đã chia 40.000.000
- When `POST /v1/transactions {meaning:"transfer", amount:500000, from_wallet_id:"nice-to-have", wallet_id:"food"}` (không gửi tài khoản)
- Then 201; `tx` có `account_id=null`, `counter_account_id=null`, `wallet_id="food"`, `counter_wallet_id="nice-to-have"`, `source="manual"`; `wallet.walletId="food"`; `food` +500.000, `nice-to-have` −500.000; `book_balance` của `vcb-husband` không đổi
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › chuyển ngân sách giữa hai ví: chỉ đổi số dư ví, tài khoản không đổi; báo ví nhận"

### AC-15: Chuyển ngân sách sai bị từ chối
- Given dữ liệu seed
- When chuyển ngân sách lần lượt: từ `wealth-building` sang `food`; từ `nice-to-have` vào `income`; từ `income` sang `food`; từ `food` sang `food`; chỉ gửi `wallet_id:"food"`
- Then 400 với mã lần lượt `locked_wallet`, `locked_wallet`, `locked_wallet`, `same_wallet`, `missing_wallet`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › chuyển ngân sách sai: %j → %s"

### AC-16: Người thuê đã ngừng hoặc nguồn thu đã tắt thì không ghi được khoản thu
- Given người thuê `active=0`, hoặc nguồn thu `active=0`
- When ghi `income` với `tenant_id` đó, hoặc `income_stream_id` đó
- Then 400 `inactive_tenant` / `inactive_income_stream`; nguồn không có → `unknown_income_stream`
- Tests: ⚠ Chưa có test

### AC-17: Nhà dùng chung một ví tiền mặt
- Given chỉ có một tài khoản tiền mặt `cash`, không gắn chủ
- When chồng hay vợ ghi `spend` không gửi `account_id`
- Then tài khoản mặc định là `cash` cho cả hai (không rơi sang ngân hàng)
- Tests: `web/src/lib/categories.test.ts` › "tài khoản nhập tay được › nhà dùng chung một ví tiền mặt (không gắn chủ) thì ai nhập cũng mặc định vào ví đó, không rơi sang ngân hàng" (PWA dùng chính `cashAccountOf` của `src/domain/entry.ts`)

### AC-18: Tài khoản SePay chỉ báo tiền vào — khoản chi nhập tay được, tiền vào thì không (ADR-66)
- Given `mb-husband` nối SePay, `sepay_out=0` (MB theo tài liệu SePay chỉ báo tiền vào)
- When ghi `spend` 150.000 với `account_id="mb-husband"`; rồi ghi `income` vào `mb-husband`, `refund` về `mb-husband`, `transfer` từ `cash-husband` sang `mb-husband`
- Then khoản chi 201 (`account_id="mb-husband"`, `source="manual"`); ba khoản tiền vào đều `fed_account`
- Tests: `test/ingest-integrity.test.ts` › "D14 theo chiều tiền (ADR-66): MB nối SePay, chỉ báo tiền vào › nhập tay khoản chi trả bằng MB được — SePay không báo tiền ra nên không đếm hai lần"; `test/ingest-integrity.test.ts` › "D14 theo chiều tiền (ADR-66): MB nối SePay, chỉ báo tiền vào › nhập tay tiền vào MB (thu nhập, hoàn tiền, chuyển vào) → từ chối fed_account"

### AC-19: Bật "SePay báo cả tiền ra" thì khoản chi từ tài khoản đó bị chặn
- Given `mb-husband` nối SePay, chủ nhà bật `sepay_out=1`
- When ghi `spend` 150.000 với `account_id="mb-husband"`
- Then lỗi `fed_account`
- Tests: `test/ingest-integrity.test.ts` › "D14 theo chiều tiền (ADR-66): MB nối SePay, chỉ báo tiền vào › chủ nhà bật 'SePay báo cả tiền ra' (sepay_out = 1) → khoản chi trả bằng MB bị từ chối fed_account"

### AC-20: Trả nợ: khoản chi nhận `debt_id`, mặc định danh mục `debt-payment`; gắn sai thì bị từ chối
- Given khoản nợ `co-mai` đang bật
- When ghi `spend` kèm `debt_id: "co-mai"` không gửi `category_id`; ghi `income`/`refund`/`lend` kèm `debt_id`; ghi `spend` với `debt_id` không có, rồi với khoản nợ đã tắt
- Then khoản chi có `category_id = "debt-payment"`, `counter_wallet_id = "rental-income"`, `debt_id = "co-mai"`, số còn nợ giảm; còn lại lần lượt 400 `debt_spend_only`, `unknown_debt`, `inactive_debt`
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › trả nợ không chọn danh mục thì lấy danh mục debt-payment"; [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › debt_id chỉ gắn với khoản chi: debt_spend_only"; [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › debt_id không có hoặc đã tắt: unknown_debt, inactive_debt"

### AC-21: Nhận lại tiền cho vay (`collect`): tài khoản tăng, không ví nào đổi, không phải thu nhập; `receivable_id` chỉ trên `lend`/`collect`
- Given khoản phải thu `em-hai` đang bật
- When ghi `collect` 700.000 vào `vcb-husband`; `collect` không gửi tài khoản; `lend` 300.000 rồi `collect` 300.000; ghi `refund`/`spend`/`income`/`transfer` kèm `receivable_id`
- Then `collect` có `counter_account_id = "vcb-husband"`, không ví, không danh mục, `book_balance` +700.000, mọi ví không đổi; không gửi tài khoản → `cash-husband`; vòng cho vay → nhận lại để mọi ví và tài khoản như cũ; bốn khoản sau 400 `receivable_only`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › collect nâng số dư sổ của tài khoản nhận, không đụng ví nào, trừ số phải thu"; [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › collect không có tài khoản thì vào tiền mặt của người ghi"; [`test/receivables.test.ts`](../../test/receivables.test.ts) › "tiền cho vay về không phải thu nhập (ADR-72) › lỗi cũ: cho vay 300.000 rồi nhận lại 300.000 — không ví nào đổi, tài khoản về như cũ, còn phải thu 0"; [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › receivable_id chỉ gắn với lend / collect: receivable_only, kể cả refund"

### AC-22: Không ghi giao dịch trước ngày mở sổ của tài khoản (ADR-76)
- Given `cash-wife` mở sổ `2026-10-01` với 35.906
- When `spend` 24.400 từ `cash-wife` lúc 23:59 30/9 giờ VN; `transfer` 50.000 `vcb-husband` → `cash-wife` ngày 28/9; sửa (`/replace`) một khoản chi ngày 2/10 sang ngày 29/9; rồi `spend` lúc 00:00 1/10 giờ VN (`2026-09-30T17:00:00Z`)
- Then ba lần đầu 400 `before_opening` "Ngày này trước ngày mở sổ của tài khoản Tiền mặt (vợ) (1/10/2026) — số dư đầu đã tính khoản này."; `book_balance` vẫn 35.906; khoản bị sửa còn `active`; lần cuối 201. Tài khoản không có `opened_at` ghi được ngày 01/01/2020; chuyển ngân sách giữa hai ví ngày đó cũng được
- Tests: `test/api.test.ts` › "số dư đầu là mốc: không ghi giao dịch trước ngày mở sổ (ADR-76) › nhập tay ngày trước mốc (theo giờ VN) → 400 before_opening, sổ không đổi; đúng ngày mở sổ thì ghi được"; `test/api.test.ts` › "số dư đầu là mốc: không ghi giao dịch trước ngày mở sổ (ADR-76) › tài khoản ở đầu nhận của chuyển khoản cũng bị chặn; sửa một khoản sang ngày trước mốc cũng bị chặn"; `test/api.test.ts` › "số dư đầu là mốc: không ghi giao dịch trước ngày mở sổ (ADR-76) › tài khoản không có ngày mở sổ và chuyển ngân sách giữa hai ví (không chạm tài khoản) không bị chặn"

### AC-23: Nhận lại tiền cho vay chỉ đúng khoản cho vay gốc (`link_id`)
- Given khoản phải thu Em Hai và Chị Lan (số 0); cho vay 1.000.000 gắn Em Hai (khoản L); một khoản chi; một khoản cho vay 200.000 đã huỷ
- When ghi `collect` 600.000 `link_id = L` không gửi `receivable_id`; ghi `collect` `link_id = L` kèm `receivable_id = chi-lan`, `link_id` = khoản chi, `link_id` = khoản cho vay đã huỷ; sửa khoản nhận lại thành 700.000 vẫn `link_id = L`
- Then khoản đầu 201 có `link_id = L`, `receivable_id = em-hai`, không ví, không danh mục, Em Hai còn 400.000; ba khoản sau 400 `invalid_link`, không dòng nào thêm; khoản sửa giữ `link_id = L`, `receivable_id = em-hai`, Em Hai còn 300.000
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › nhận lại có link_id về khoản cho vay: không chọn người thì lấy người của khoản cho vay; khác người, trỏ khoản chi hay khoản đã huỷ → invalid_link; sửa giữ liên kết"

### AC-24: Chuyển vào tài khoản Tích sản từ tài khoản thường là bỏ tiền vào Tích sản (ADR-88)
- Given DB seed, phao `phao` (`role: "buffer"`), sổ `so-6-thang` (`role: "term_deposit"`)
- When ghi `transfer` không ví: `cash-wife` → phao; phao → sổ; sổ → `cash-wife`; phao → `cash-husband`; `cash-wife` → `cash-husband`; rồi `cash-wife` → phao kèm `from_wallet_id: food`, `wallet_id: wealth-building`
- Then dòng đầu `wallet_id = wealth-building`, `counter_wallet_id = nice-to-have`; bốn dòng sau không ví; dòng cuối theo ví đã gửi (`food` → `wealth-building`)
- Tests: [`test/buffer.test.ts`](../../test/buffer.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › từ tài khoản thường vào phao, không chọn ví: ví Có thì tốt → Tích sản; rút ra, phao → sổ, sổ → tài khoản thường: chỉ đổi chỗ; chọn ví thì theo ví đã chọn"

## Traceability
- Code: `src/routes/v1.ts` › `POST /transactions`, `body`, `str`, `int`; `src/services/ledger.ts` › `createEntry` (D14 theo chiều), `insertTx`, `walletStatus`, `loadRefs` (`sepayOut`, `openedAt`, `role`, `debts`, `receivables`), `getTransaction`, `resolveLink`; `src/domain/entry.ts` › `MANUAL_MEANINGS`, `buildEntry`, `isWealthBuildingDeposit`, `wealthBuildingMove`, `assertOpened`, `bookOf`, `DEBT_CATEGORY_ID`, `LEND_CATEGORY_ID`, `normalizeAt`, `walletFor`, `cashAccountOf`; `src/domain/types.ts` › `isIncomeHolding`, `isReserve`, `AccountRef`, `AccountRole`, `BookRef`; `src/domain/period.ts` › `dayKey`, `weekKey`, `monthKey`, `weekStart`; `src/domain/snapshot.ts` › `monthTarget`, `weekTarget`
- Migrations/DB: CHECK của `transactions` (`migrations/0001_schema.sql`; bảng dựng lại ở `migrations/0014_receivables.sql` để CHECK `meaning` nhận `collect`); `idx_tx_client` (`migrations/0003_offline_entry_and_allocation_runs.sql`); cột `transactions.income_stream_id`, `transactions.tenant_id`, ví "Thu cho thuê", danh mục "Trả nợ", config `rental_income_stream_id`, view `v_tenant_balance` (`migrations/0007_income_streams_rental.sql`); cột `accounts.sepay_out` (`migrations/0010_bank_catalog.sql`); cột `transactions.debt_id`, view `v_debt_balance` (`migrations/0013_debts.sql`); cột `transactions.receivable_id`, view `v_receivable_balance`, `v_wallet_flow` loại `lend`/`collect` (`migrations/0014_receivables.sql`); danh mục "Cho vay" (`migrations/0002_seed.sql`); mã hệ thống `debt-payment`, `lending` (hằng `DEBT_CATEGORY_ID`, `LEND_CATEGORY_ID` ở `src/domain/system-ids.ts`; `migrations/0029_system_ids.sql` đổi từ `tra-no`, `cho-vay` — ADR-94); views `v_wallet_balance`, `v_spent_week`, `v_spent_month`, `v_wealth_building` (tên này và `tier='wealth_building'`, `accounts.role` `piggy_bank` / `buffer` / `term_deposit` từ `migrations/0028_english_names.sql`, schema v1.28)
- Dùng lại: ingest gán log bằng chính `buildEntry` (ghi đè `source='sepay'`) và `resolveLink` — ingest UC-305 "Gán log chưa gán"; MCP `add_transaction` gọi `createEntry` (nhận `link_id`) — mcp UC-603.

## Divergences & Open Questions
- `buy_asset` chỉ kiểm `amount ≤ v_wealth_building.cash`, không kiểm Quỹ an tâm (trước gọi là phao) — trước đây lệch với `docs/profit_first_phuong_phap.md` §5 ("phao đầy rồi mới sang assets"); đã chốt bằng ADR-62 (mua vàng không đợi phao đầy, phao chỉ tính tiền mặt), docs §5 sửa theo ADR-62 (change `261001-cho-thue-lai`).
- [DIVERGENCE] `plans/.../phase-03-api.md` dòng 21: "Gọi bằng bearer token thì truyền `by_member_id` trong body" — REST không đọc `by_member_id`; người ghi lấy từ `X-Member-Id` hoặc owner mặc định (`src/routes/auth.ts`). Chỉ MCP nhận `by_member_id`.
- [OPEN] D14 ghi "đề xuất sau red team 22/9, **chờ chủ nhà xác nhận**" (`plans/.../context.md` D14) nhưng code đã áp dụng.
- [OPEN] `refund` không bị chặn vào ví `holding`/`wealth_building`, và không bị giới hạn bởi số tiền khoản gốc (`buildEntry` nhánh `refund`).
- Trước đây chu trình `lend` → `refund` làm ví **tăng** so với trước khi cho vay (`lend` không trừ ví nhưng `refund` luôn cộng một ví — CHECK `wallet_id NOT NULL`; docs cũ chỉ nói "`lend` không đụng ví (chờ `refund` về)"); đã đóng bằng meaning **`collect`** — tiền về tài khoản, không cộng ví (ADR-72, AC-21). `refund` không còn gắn được khoản phải thu (`receivable_only`).
- Trước đây không chuyển được ngân sách giữa hai ví cùng tài khoản bằng nhập tay (`transfer` luôn cần hai tài khoản khác nhau, `same_account`); đã có **chuyển ngân sách** — `transfer` không tài khoản, chỉ hai ví (4e, change `261001-cho-thue-lai`).
- [OPEN] Gửi lại `client_id` của một dòng đã `void` vẫn trả dòng void với `duplicate: true` (tra theo `client_id`, không lọc `status`).
- [OPEN] Chuyển ngân sách dùng đúng ví được gửi, không lọc theo người nhập: qua REST/MCP một thành viên chuyển được tiền ra khỏi ví cá nhân (kể cả `private`) của người kia; chỉ PWA ẩn các ví này (`moveWallets`, pwa [UC-712](../pwa/UC-712-chuyen-ngan-sach-va-bu.md)).
- [OPEN] Chặn ví Thu nhập (`locked_wallet`) chỉ áp cho chuyển ngân sách; `transfer` có tài khoản kèm ví vẫn lấy từ / chuyển vào ví Thu nhập được (nhánh có tài khoản chỉ chặn nguồn `wealth_building`).
- [OPEN] `income` có `tenant_id` mà config `rental_income_stream_id` trống/thiếu → khoản thu không có nguồn và sẽ chia theo luật % chung như lương (tiền người thuê vào ví chi tiêu, trái BR-11). Server không cho đặt config này về `null` (rental [UC-801](../rental/UC-801-thiet-lap-nguoi-thue.md)) nhưng không chặn khi key bị thiếu.
- [OPEN] `taxable: true` kèm nguồn thu thì không trích Thuế (allocation UC-201 bước 2b) mà nhập tay không báo gì.
