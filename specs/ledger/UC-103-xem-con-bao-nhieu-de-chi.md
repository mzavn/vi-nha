# UC-103: Xem "còn bao nhiêu để chi" (snapshot)
- Status: implemented
- BR: BR-01, BR-05, BR-07, BR-04
- Decisions: D6 (`private` là ẩn lịch sự), D7 (tuần → tháng), D9 (phao theo nhóm Must); `plans/260921-2228-profit-first-pwa/phase-03-api.md` "Định nghĩa còn để chi tuần này"; ADR-63 (ví giữ riêng "Thu cho thuê" không vào "còn để chi"); ADR-77 (heo đất — phần ví thay bởi ADR-82); ADR-82 (heo đất là Tích sản: tiền bỏ heo vào Tích sản, Quỹ an tâm đếm cả tiền heo; ví `heo-dat` tắt); ADR-85 ("Tiền chi được": tiền thật ở tài khoản đang tính − Tích sản và Thuế còn giữ); ADR-92 (tên tiếng Anh trong code, dữ liệu, API); ADR-93 ("Quỹ an tâm"); ADR-94 (mã hệ thống tiếng Anh)
- Actor: thành viên (màn Hôm nay), Claude (MCP `get_snapshot`), cron 07:00 (notify UC-402)
- Trigger: `GET /v1/snapshot`

## History
- v1 (2026-09-22, commit `b92fc0f`): một hàm thuần `buildSnapshot` + `getSnapshot` một `db.batch` 10 truy vấn; là nguồn số cho PWA, MCP và Telegram.
- v2 (2026-10-01, commit `034b7ff`): thêm `reserves` (ví giữ riêng, ngoài "còn để chi"); mục tiêu tuần qua `weekTarget` — phong bì tháng bật `split_weekly` có mức tuần = `floor(mục tiêu tháng ÷ số thứ Hai)` và dùng công thức có mức tuần trong "còn để chi"; `walletStatus.weekRemaining` dùng cùng mục tiêu tuần (change `261001-cho-thue-lai`).
- v3 (2026-10-03, commit `f74bc70`): ví giữ riêng thứ hai **"Heo đất"** (`heo-dat`, migration 0017 — chỉ có khi nhà có `husband`/`wife`, ADR-77) đi đúng đường của "Thu cho thuê": nằm ở `reserves`, không vào "còn để chi", không vào phe nào, không vào phao. Bỏ heo (chuyển nội bộ kèm chuyển ví Có thì tốt → Heo đất) chỉ làm "còn để chi" giảm ở phong bì Có thì tốt. Không đổi code snapshot.
- v4 (2026-10-03, commit `e00814c`): **heo đất là Tích sản** (ADR-82) — ví "Heo đất" tắt (migration 0020) nên không còn ở `reserves`; bỏ heo chuyển ví Có thì tốt → **Tích sản**: `tiers.tichsan.cash` tăng, phao (`emergency.cash`) tăng đúng số tiền, "còn để chi" vẫn chỉ giảm ở phong bì Có thì tốt. Không đổi code snapshot.
- v5 (2026-10-04, commit `04c415b`): change [`261004-gan-chua-chia`](../changes/archive/261004-gan-chua-chia/proposal.md) — `attention.unallocatedIncome: { count, amount, oldestTxId }`: khoản thu còn hiệu lực chưa có lần chia (tiền đang nằm ở ví Thu nhập), truy vấn thứ 11 trong batch (`UNALLOCATED_INCOME_SQL`, `src/services/ledger.ts`). Cùng một định nghĩa với nhắc ngày 10 & 25 (notify UC-405) — cron nay đọc số này từ snapshot thay cho truy vấn riêng. Banner Hôm nay dùng `oldestTxId` để mở khoản cũ nhất (pwa UC-702).
- v6 (2026-10-06, commit `18569ce`): change [`261006-tien-chi-duoc`](../changes/archive/261006-tien-chi-duoc/proposal.md) — snapshot trả thêm **`spendableCash`** (ADR-85): Σ số dư sổ của tài khoản đang tính (`accounts.active`, `locked = 0`, `spendable = 1`) − Tích sản đang giữ (ngoài phần đã nằm ở heo đất) − Thuế đang giữ; truy vấn thứ 12 trong batch (`v_account_book` JOIN `accounts`), hàm thuần `spendableCash`. Chủ nhà: "tôi muốn nhìn ngay ở trang chủ vào là tôi còn lại thực tế là bao nhiêu tiền có thể chi tiêu (dựa trên tiền thật của các tài khoản của tôi nhé), không nói dựa trên tổng tài sản". MCP `get_snapshot` có cùng số.
- v7 (2026-10-06, commit `9c265ee`): **bỏ số lũy kế SePay** (ADR-87, change [`261006-bo-luy-ke-sepay`](../changes/archive/261006-bo-luy-ke-sepay/proposal.md)) — chủ nhà: "bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè". `attention.drift` = tài khoản có `bookDrift ≠ 0`, phần tử `{accountId, name, bookDrift}` (bỏ `feedDrift`); AC-6 có test.
- v8 (2026-10-06, commit `9c265ee`): change [`261006-tai-khoan-phao`](../changes/archive/261006-tai-khoan-phao/proposal.md), ADR-88 — `spendableCash.tichsanInLocked` đổi thành **`tichsanOutside`**: phần Tích sản nằm ở **tài khoản Tích sản không tính** (heo đất, phao dự phòng, sổ tiết kiệm — `accounts.role`) không trừ lại; `excluded[]` mang `role` thay `locked`. Chủ nhà về `mb-savings-wife`: "tài khoản phao dự phòng của nhà tôi: thường là tôi sẽ chuyển khoản tích lũy cho vợ, đến 1 ngưỡng vợ tôi sẽ gửi tiết kiệm…". Tài khoản thường tắt công tắc vẫn không coi là Tích sản (AC-13 giữ nguyên). AC-12–14 sửa câu chữ, thêm AC-16, AC-17.
- v9 (2026-10-07, commit `7424f26`): tên tiếng Anh (ADR-92), số không đổi: snapshot `tiers.tichsan` → `tiers.wealth_building`, `emergency` → `safetyFund` (cùng các trường `cash`, `target`, `months`, `monthsCovered`, `pct`, `estimated`); `spendableCash.tichsanHeld` / `tichsanOutside` → `wealthBuildingHeld` / `wealthBuildingOutside`; `role` trong `excluded` là `piggy_bank` / `buffer` / `term_deposit`; đọc `v_wealth_building`, `v_safety_fund`, `config.safety_fund_months` (migration 0028, schema v1.28). "Phao khẩn cấp" gọi là **Quỹ an tâm** (ADR-93) (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v10 (2026-10-08, commit `21b9db0`): không đổi hành vi — Traceability ghi ví "Thu cho thuê" theo tên (hộ mẫu `rental-income`); test migration chuyển sang `test/migrations/` (ADR-94). (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Người xem đã xác thực; `viewerId` = member của request (cron truyền `null`).

## Main Flow
1. `getSnapshot` đọc trong **một batch**: số dư mọi ví (`v_wallet_balance`), đã tiêu tuần hiện tại (`v_spent_week`, `weekKey(now)`), đã tiêu tháng hiện tại (`v_spent_month`, `monthKey(now)`), `v_wealth_building`, `v_safety_fund`, `config.safety_fund_months`, `v_goal_progress`, số log `pending` và tổng ròng (vào +, ra −), `v_reconcile`, số lệnh chuyển `pending` và số quá hạn (`created_at < now − 3 ngày`), khoản thu chưa chia (`UNALLOCATED_INCOME_SQL`: `transactions` `status='active'`, `meaning='income'`, không có dòng `allocation_runs` — đếm, tổng tiền, id khoản cũ nhất theo (`at`, `id`)), số dư sổ từng tài khoản đang dùng kèm `locked`, `spendable` (`v_account_book` JOIN `accounts`, theo `kind`, `name`).
2. `buildSnapshot` dựng từng dòng ví (ví active, theo `sort`): `balance`, `monthTarget`, `spentMonth`; `weekTarget` = dự kiến tuần (mục dưới), `spentWeek` chỉ khi có dự kiến tuần (ngược lại cả hai `null`). Ví `private` của người khác: mọi số = `null`.
3. **Còn để chi tuần này** (`spendableThisWeek`) = tổng trên các ví `tier='must'` **và** `kind='envelope'` **và** không bị ẩn, mỗi ví:
   - có mức tuần: `min(weekTarget − spentWeek, balance)`;
   - không có mức tuần (ví dụ Có thì tốt): `balance ≤ 0` → `balance`; ngược lại `floor(balance ÷ weeksLeftInMonth)`.
   Ví âm **được phép kéo tổng xuống**. Chi tiết từng ví trả ở `spendableByWallet`.
4. Tổng theo phe (`tiers`): `wealth_building` (`balance`, `cash`, `assets`), `tax` (`balance`), `nice`, `must` (nhóm Must), `have` (nhóm Có thì tốt) — mỗi nhóm `balance` và tổng `monthTarget`. **Ví giữ riêng** (`tier='holding'`, `kind≠'holding'`, `isReserve` — "Thu cho thuê") trả riêng ở `reserves: [{walletId, name, balance}]` (`balance = null` nếu ẩn); không vào phe nào, không vào "còn để chi". Tiền chuyển từ phong bì sang ví khác rời "còn để chi" đúng ở phong bì đó — bỏ heo đất (Có thì tốt → Tích sản, ADR-82) làm `tiers.wealth_building.cash` tăng. Ví "Heo đất" (`heo-dat`) đã tắt từ migration 0020 nên không còn dòng ví nào, không ở `reserves`.
5. **Quỹ an tâm** (`safetyFund`, ADR-93): `target` = `v_safety_fund.target` nếu có (≥ 3 tháng dữ liệu), ngược lại **ước** = Σ `monthTarget` các ví nhóm Must × `safety_fund_months` (mặc định 6 nếu thiếu config) và `estimated: true`; `cash` = cash của Tích sản (gồm cả tiền đã bỏ heo qua app, ADR-82); `monthsCovered` = `cash ÷ (target ÷ months)` làm tròn 1 số lẻ; `pct` ≤ 100, 1 số lẻ.
6. Mục tiêu (`goals`): mỗi ví luật `goal` với `pct` ≤ 100.
7. Cần chú ý (`attention`): `pendingLogs`, `pendingNet`, `drift` = các tài khoản có `bookDrift` ≠ 0 (NULL coi như 0; phần tử `{accountId, name, bookDrift}` — không có số ngân hàng báo, ADR-87), `transferOrdersPending`, `transferOrdersOverdue`, `unallocatedIncome: { count, amount, oldestTxId }` (không có khoản nào: `{ 0, 0, null }`) — tiền của các khoản này nằm ở ví Thu nhập, không vào "còn để chi".
7b. **Tiền chi được** (`spendableCash`, ADR-85, `src/domain/snapshot.ts` › `spendableCash`):
   - tài khoản đang tính = `locked = 0` **và** `spendable = 1` (tài khoản khóa không bao giờ tính, dù cột là gì); `accounts: [{accountId, name, balance}]` theo thứ tự server; `excluded: [{accountId, name, role}]` = các tài khoản đang dùng còn lại (`role` = vai trò Tích sản, null với tài khoản thường);
   - Tích sản ở ngoài = `max(0, Σ số dư sổ tài khoản Tích sản không tính)` (`role` ∈ `piggy_bank` heo đất, `buffer` phao dự phòng, `term_deposit` sổ tiết kiệm — ADR-82, ADR-88); `wealthBuildingOutside = min(Tích sản ở ngoài, max(0, tiers.wealth_building.cash))` — không trừ lại; `wealthBuildingHeld = max(0, tiers.wealth_building.cash) − wealthBuildingOutside`; `taxHeld = max(0, tiers.tax.balance)`. Tài khoản thường tắt công tắc: sổ không biết tiền trong đó là gì, không coi là Tích sản (sai về phía thấp an toàn hơn);
   - `amount = Σ balance(accounts) − wealthBuildingHeld − taxHeld`, âm được phép. Không trừ ví giữ riêng, khoản thu chưa chia, nợ.
8. Trả thêm `day`, `week {key, start, end (thứ Hai..Chủ nhật, giờ VN), weeksLeftInMonth}`, `month`.

### Dự kiến tháng (`monthTarget`)
- `flat`: `amount × mondaysInMonth(tháng)` nếu `period='week'`, ngược lại `amount`.
- `lump`: `amount ?? target_amount`.
- `percent`, `goal`, `remainder`, không có luật: `null`.

### Dự kiến tuần (`weekTarget`, `src/domain/snapshot.ts`)
- `flat` + `period='week'`: `amount`.
- Phong bì (`kind='envelope'`) luật `flat`/`lump` bật `split_weekly` (chia đều theo tuần — chỉ bật được với phong bì nạp theo tháng, access UC-506): `floor(monthTarget(tháng) ÷ mondaysInMonth(tháng))`, với tháng = tháng chứa **thứ Hai đầu tuần** (`weekStart(weekKey)` / `weekRange(now).start`), không phải tháng của hôm nay.
- Ví khác: `null`.
- Cùng hàm dùng cho `walletStatus.weekRemaining` sau khi nhập tay (`min(dự kiến tuần − đã chi tuần, số dư)`, ledger UC-101 bước 7) và cho bảng ngân sách kỳ tuần (UC-104). Không ảnh hưởng lần chia: nhu cầu tháng của phong bì vẫn là dự kiến tháng (allocation UC-201).

## Alternative Flows
- 2a. `viewerId = null` (cron): mọi ví `private` có `member_id` đều bị ẩn và bị loại khỏi "còn để chi".
- 5a. Chưa đủ 3 tháng trọn chi nhóm Must → `estimated: true` (xem UC-107 cho phần view).

## Exceptions
- Không có mã lỗi nghiệp vụ riêng; lỗi DB đi qua `onError` chung.

## Acceptance Criteria
### AC-1: Sau khi chia lương và chi, "còn để chi" và phe Tích sản đúng
- Given `income` 40.000.000 hôm nay đã chia, rồi `spend` 125.000 danh mục `groceries` (ví `food`, mức tuần 625.000)
- When `GET /v1/snapshot`
- Then `tiers.wealth_building = {balance: 12.000.000, cash: 12.000.000, assets: 0}`; dòng `food` trong `spendableByWallet` = 500.000; `safetyFund.estimated = true`
- Tests: `test/api.test.ts` › "chia lương end-to-end › snapshot: còn để chi tuần này và phe Tích sản ra đúng sau khi chia + chi"

### AC-2: MCP trả đúng số như REST
- Given cùng một DB sau khi chia lương + chi
- When gọi `get_snapshot` qua MCP và `GET /v1/snapshot`
- Then dữ liệu trùng nhau
- Tests: `test/mcp.test.ts` › "tool đọc số liệu › get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB"

### AC-3: Ví không có mức tuần chia đều theo số tuần còn lại
- Given Có thì tốt số dư dương, không có luật `flat`/`week`
- When dựng snapshot
- Then phần của ví = `floor(balance ÷ weeksLeftInMonth)`
- Tests: gián tiếp — `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví nhận phần dư (không có mức tuần) cũng khớp công thức chia theo tuần còn lại"; `test/period.test.ts` › "tuần → tháng › số tuần còn lại tính cả tuần đang chạy"

### AC-4: Ví riêng tư của người khác: hiện tên, ẩn số
- Given ví `private` của `husband`, người xem là `wife`
- When dựng snapshot
- Then dòng ví đó có `balance`, `monthTarget`, `spentMonth`, `weekTarget`, `spentWeek` = `null`, và không vào tổng "còn để chi"
- Tests: gián tiếp — `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví riêng tư của người kia không bị đụng (không có số để trừ)"

### AC-5: Ví tiêu lố kéo tổng xuống
- Given một phong bì Must có `weekTarget − spentWeek < 0`
- When dựng snapshot
- Then phần âm được cộng vào `spendableThisWeek`
- Tests: ⚠ Chưa có test

### AC-6: Chỉ báo lệch khi lệch thật
- Given một tài khoản có `bookDrift = 0` (log chưa gán), một tài khoản `bookDrift = null` (không có log), một tài khoản `bookDrift = 50.000`
- When dựng snapshot
- Then `attention.drift` chỉ chứa tài khoản thứ ba
- Tests: `test/logs.test.ts` › "lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán (ledger UC-103, UC-106 — ADR-87) › snapshot và /v1/accounts: lệch khi bookDrift ≠ 0; log chưa gán (bookDrift 0) và tài khoản không có log (null) không lệch; không còn số ngân hàng báo"

### AC-7: Phong bì tháng chia theo tuần — dự kiến tuần = tháng ÷ số thứ Hai, "còn để chi" dùng dự kiến tuần
- Given ví `food` đổi sang `flat` 2.800.000/tháng, `split_weekly = 1`; đã chia 40.000.000; chi 100.000 danh mục `groceries` tuần này
- When `GET /v1/snapshot`
- Then dòng `food` có `weekTarget = floor(2.800.000 ÷ mondaysInMonth(tháng của week.start))`, `spentWeek = 100.000`; phần của `food` trong `spendableByWallet` = `weekTarget − 100.000`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › phong bì tháng chia theo tuần: dự kiến tuần = tháng ÷ số thứ Hai, còn để chi dùng dự kiến tuần"; thứ Hai đầu tuần: `test/period.test.ts` › "tuần ISO › thứ Hai của %s là %s"

### AC-8: Ví giữ riêng nằm ở `reserves`, không vào "còn để chi"
- Given tiền người thuê 5.191.667 đã chia trọn vào `rental-income`, rồi trả nợ 3.000.000 từ ví đó
- When `GET /v1/snapshot`
- Then `reserves = [{walletId:"rental-income", name:"Thu cho thuê", balance:2191667}]`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"

### AC-9: Nhập tay vào phong bì chia theo tuần trả "tuần còn" theo dự kiến tuần
- Given phong bì tháng bật `split_weekly`
- When ghi `spend` vào ví đó (`POST /v1/transactions`)
- Then `wallet.weekRemaining = min(weekTarget − đã chi tuần, số dư)` (trước đây luôn `null` với ví nạp theo tháng)
- Tests: ⚠ Chưa có test

### AC-10: Bỏ heo đất — tiền vào Tích sản, "còn để chi" chỉ giảm ở Có thì tốt, Quỹ an tâm tăng đúng số tiền (ADR-82)
- Given nhà như prod sau migration 0017 + 0019 + 0020 (`mb-main-husband` báo cả tiền ra); log `out` 5.600 "CHUYEN TIEN LE LAM TRON … (TIET KIEM TIEN LE)" tự gán thành chuyển nội bộ `mb-main-husband` → `piggy-husband`, ví `nice-to-have` → `wealth-building` (ingest UC-303)
- When `getSnapshot` trước và sau
- Then `tiers.wealth_building.cash` +5.600; ví `nice-to-have` −5.600; trong `spendableByWallet` chỉ dòng `nice-to-have` đổi; `safetyFund.cash` +5.600; `v_spent_raw` không có dòng nào
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › tài khoản SePay báo cả tiền ra: tự gán chuyển nội bộ sang heo của chính chủ, ví Có thì tốt → Tích sản — không phải chi tiêu"

### AC-11: Đếm khoản thu chưa chia — bỏ khoản đã chia và khoản đã huỷ, chỉ ra khoản cũ nhất
- Given bốn khoản thu gán từ ngân hàng 300.000 / 400.000 / 500.000 / 600.000 (khoản 500.000 lùi về 1/9 — cũ nhất); chia khoản 300.000; gỡ gán (huỷ) khoản 400.000
- When `GET /v1/snapshot`
- Then `attention.unallocatedIncome = { count: 2, amount: 1.100.000, oldestTxId: <khoản 500.000> }`; trước khi có khoản nào là `{ 0, 0, null }`; gán thu nhập mà chưa chia thì "còn để chi" không đổi
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "gán thu nhập, để chia sau (pwa UC-706, ledger UC-103) › snapshot đếm khoản thu chưa chia: bỏ khoản đã chia và khoản đã huỷ, khoản cũ nhất trước"; [`test/logs.test.ts`](../../test/logs.test.ts) › "gán thu nhập, để chia sau (pwa UC-706, ledger UC-103) › gán mà không gọi /v1/allocate: khoản thu nằm ở ví Thu nhập, chưa chia, còn để chi không đổi; chia sau vẫn được"

### AC-12: Tiền chi được = tài khoản đang tính − Tích sản đang giữ − Thuế đang giữ (ADR-85)
- Given seed; `cash-husband` số dư đầu 500.000; khoản thu 10.000.000 có tính thuế vào `cash-wife` đã chia (Tích sản 3.000.000, Thuế 1.000.000)
- When `GET /v1/snapshot`
- Then `spendableCash = { amount: 6.500.000, wealthBuildingHeld: 3.000.000, wealthBuildingOutside: 0, taxHeld: 1.000.000, excluded: [] }`, `accounts` có `cash-wife` 10.000.000 và `cash-husband` 500.000
- Tests: [`test/spendable-cash.test.ts`](../../test/spendable-cash.test.ts) › "tiền chi được — snapshot và công tắc tài khoản › GET /v1/snapshot: Σ số dư sổ tài khoản đang tính − Tích sản đang giữ − Thuế đang giữ"

### AC-13: Tắt một tài khoản thì tiền chi được giảm đúng số dư của nó
- Given như AC-12
- When `PATCH /v1/settings/accounts/cash-husband { spendable: false }` rồi bật lại
- Then `amount` giảm đúng 500.000, `cash-husband` rời `accounts` sang `excluded` (`role: null`); bật lại thì `amount` như trước
- Tests: [`test/spendable-cash.test.ts`](../../test/spendable-cash.test.ts) › "tiền chi được — snapshot và công tắc tài khoản › tắt Tính vào tiền chi được của một tài khoản: số giảm đúng số dư của nó, tài khoản sang danh sách không tính; bật lại như cũ"

### AC-14: Bỏ heo đất không trừ hai lần (ADR-82, ADR-85, ADR-88)
- Given nhà như prod (heo `husband`/`wife` khóa); bỏ heo 7.000 từ `mb-main-husband` và 5.000 từ `mb-spending-wife` (Có thì tốt → Tích sản)
- When `getSnapshot` trước và sau
- Then `spendableCash.amount` giảm đúng 12.000 (không phải 24.000), `wealthBuildingOutside` +12.000, `wealthBuildingHeld` không đổi; hai heo ở `excluded` với `role: "piggy_bank"`, không ở `accounts`
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "tiền chi được: heo đất không tính, phần Tích sản ở heo không trừ lại (ADR-85) › bỏ heo 12.000: tiền chi được giảm đúng 12.000 (tiền rời tài khoản chi tiêu), không phải 24.000; heo ở danh sách không tính"

### AC-15: Công thức ở biên — heo nhiều hơn Tích sản, số âm, không tài khoản nào tính
- Given hàm thuần `spendableCash`
- When heo 50.000 > Tích sản 20.000; Tích sản / Thuế âm; tài khoản khóa có `spendable = 1`; không tài khoản nào đang tính
- Then `wealthBuildingHeld = 0`; phần âm không cộng ngược vào; tài khoản khóa vẫn không tính; `amount = −(Tích sản + Thuế đang giữ)`
- Tests: [`test/spendable-cash.test.ts`](../../test/spendable-cash.test.ts) › "tiền chi được — công thức (hàm thuần) › cộng tài khoản đang tính, trừ Tích sản ngoài heo và Thuế; heo và tài khoản tắt nằm ở danh sách không tính"; [`test/spendable-cash.test.ts`](../../test/spendable-cash.test.ts) › "tiền chi được — công thức (hàm thuần) › heo nhiều hơn Tích sản: không trừ Tích sản; tài khoản khóa không bao giờ tính dù cột bật; Tích sản / Thuế âm không cộng ngược"; [`test/spendable-cash.test.ts`](../../test/spendable-cash.test.ts) › "tiền chi được — công thức (hàm thuần) › không có tài khoản nào đang tính: âm đúng bằng phần phải giữ"

### AC-16: Phao và sổ tiết kiệm — tiền vào Tích sản một lần, gửi / tất toán chỉ đổi chỗ (ADR-88)
- Given DB seed mới, `cash-wife` số dư đầu 5.000.000; thêm phao `MB tiết kiệm (vợ)` (`role: "buffer"`) và `Sổ 6 tháng` (`role: "term_deposit"`)
- When chuyển nội bộ 1.000.000 `cash-wife` → phao (không chọn ví); rồi 800.000 phao → sổ; rồi tất toán 820.000 về phao (800.000 chuyển sổ → phao + 20.000 Thu nhập vào phao)
- Then sau bước 1: `tiers.wealth_building.cash` +1.000.000, `spendableCash.amount` −1.000.000 (một lần), `wealthBuildingOutside` = 1.000.000, Quỹ an tâm (`safetyFund.cash`) +1.000.000, ví Có thì tốt −1.000.000; bước 2: Tích sản, tiền chi được, Quỹ an tâm không đổi; bước 3: Tích sản không đổi, phao 1.020.000, sổ 0, `attention.unallocatedIncome.amount` = 20.000, tiền chi được như sau bước 1; sổ tắt "Đang dùng" được
- Tests: [`test/buffer.test.ts`](../../test/buffer.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › DB mới: chuyển 1.000.000 vào phao → Tích sản +1.000.000, Tiền chi được −1.000.000 một lần; gửi 800.000 phao → sổ không đổi gì; tất toán 820.000 (20.000 lãi là Thu nhập) → Tích sản về phao"

### AC-17: Chỉ tài khoản Tích sản không tính là chỗ giữ Tích sản (ADR-88)
- Given hàm thuần `spendableCash`: MB 2.000.000 đang tính; phao 200.000 và sổ 800.000 không tính; tài khoản thường tắt 5.000.000; thẻ −300.000; Tích sản 1.500.000
- When tính; rồi bật tính cho phao
- Then `wealthBuildingOutside = 1.000.000` (phao + sổ; tài khoản thường tắt và thẻ không tính), `wealthBuildingHeld = 500.000`, `amount = 1.500.000`; phao bật tính thì nó là tài khoản đang tính: `wealthBuildingOutside = 800.000`, `amount = 2.200.000 − 700.000`
- Tests: [`test/spendable-cash.test.ts`](../../test/spendable-cash.test.ts) › "tiền chi được — công thức (hàm thuần) › phao và sổ tiết kiệm không tính giữ Tích sản như heo (ADR-88); tài khoản thường tắt công tắc hay thẻ tín dụng thì không — sổ không biết tiền trong đó là gì"

## Traceability
- Code: `src/routes/v1.ts` › `GET /snapshot`; `src/services/ledger.ts` › `getSnapshot`, `UNALLOCATED_INCOME_SQL`, `loadRefs`, `walletStatus`; `src/domain/snapshot.ts` › `buildSnapshot`, `monthTarget`, `weekTarget`, `weekRange`, `spendableCash`, `SpendableCash`; `src/domain/types.ts` › `isReserve`; `src/domain/period.ts` › `dayKey`, `weekKey`, `monthKey`, `mondaysInMonth`, `weeksLeftInMonth`, `weekStart`
- Migrations/DB: views `v_wallet_balance`, `v_spent_week`, `v_spent_month`, `v_wealth_building`, `v_safety_fund`, `v_goal_progress`, `v_reconcile`, `v_account_book` (`migrations/0001_schema.sql`; hai view Tích sản / Quỹ an tâm mang tên này từ `migrations/0028_english_names.sql`); `config.safety_fund_months` (`migrations/0002_seed.sql`, đổi tên khoá ở 0028); `allocations.split_weekly`, ví "Thu cho thuê" (`migrations/0007_income_streams_rental.sql`; hộ mẫu `rental-income`); ví `heo-dat` (`migrations/0017_heo_dat.sql`, tắt ở `migrations/0020_heo_tich_san.sql`); `accounts.spendable` (`migrations/0022_accounts_spendable.sql`); `accounts.role` (`migrations/0024_accounts_role.sql`; giá trị `piggy_bank` / `buffer` / `term_deposit` và `wallets.tier` `wealth_building` từ `migrations/0028_english_names.sql`, schema v1.28)
- Dùng bởi: MCP `get_snapshot` (mcp UC-602), cron 07:00 (notify UC-402), PWA màn Hôm nay.

## Divergences & Open Questions
- [DIVERGENCE] `phase-03-api.md` dòng 49: "`GET /snapshot` dùng ≤ 3 query D1" — `getSnapshot` gọi `loadRefs` (một batch 9 truy vấn, từ change `261001-cho-thue-lai` thêm nguồn thu, phần khóa, người thuê, config cho thuê) + một batch 12 truy vấn (từ change `261004-gan-chua-chia` thêm khoản thu chưa chia, change `261006-tien-chi-duoc` thêm số dư sổ từng tài khoản).
- [OPEN] Cron gọi với `viewerId = null` nên mọi ví `private` bị ẩn khỏi tin Telegram; nếu một phong bì Must được đặt `private`, con số Telegram khác con số của chủ ví trên app (BR-01 "cùng một con số"). Seed hiện không có ví `private`.
- [OPEN] Quỹ an tâm ước lượng dùng tổng `monthTarget` của các dòng **không bị ẩn**; ví Must `private` của người khác không được tính.
- [OPEN] `transferOrdersOverdue` so `created_at` (UTC `datetime('now')`) với `datetime('now','-3 days')` — là khoảng thời gian, không theo ngày VN.
- [OPEN] Dự kiến tuần chia đều là `floor(tháng ÷ số thứ Hai)` nên tổng các tuần hụt tối đa (số thứ Hai − 1) đồng so với dự kiến tháng; tuần vắt qua hai tháng lấy dự kiến của tháng chứa thứ Hai, trong khi tiền nạp và dự kiến tháng tính theo tháng dương lịch.
- [OPEN] `reserves` lặp lại thông tin: ví giữ riêng (và ví Thu nhập) vẫn có dòng trong `wallets`.
- [OPEN] Tiền chi được (ADR-85): tắt một tài khoản **thường** đang giữ tiền Tích sản / Thuế (vd TCB Tích sản, MB Thuế của seed) làm phần đó bị trừ hai lần — số thấp hơn thật; sheet tài khoản dặn để bật. Từ ADR-88, tài khoản để dành tiền Tích sản nên đánh dấu Phao dự phòng (phần Tích sản ở đó không trừ lại); phần Thuế vẫn theo luật này. Chủ nhà chọn giữ luật hay coi số dư tài khoản trú của ví Tích sản / Thuế là tiền của ví khi tài khoản đó tắt.
- [OPEN] Tiền chi được vẫn gồm khoản thu chưa chia (ví Thu nhập) và ví giữ riêng (Thu cho thuê) — một phần sẽ thành Tích sản / Thuế khi chia.
