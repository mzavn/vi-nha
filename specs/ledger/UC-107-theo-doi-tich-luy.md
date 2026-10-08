# UC-107: Theo dõi tích lũy — Tích sản cash/assets, Quỹ an tâm, quỹ mục tiêu
- Status: implemented
- BR: BR-07, BR-01, BR-05
- Decisions: D9 (phao theo nhóm Must); `docs/core_design_rules.md` §9 "Tích sản", "Quỹ an tâm"; `phase-01-worker-d1.md` S3 (phao vỡ lúc khởi động); ADR-92 (tên tiếng Anh trong code, dữ liệu, API); ADR-93 ("Phao khẩn cấp" gọi là "Quỹ an tâm")
- Actor: thành viên (màn Tích sản/Hôm nay qua snapshot, tab Tích sản qua `GET /v1/wealth-building`), Claude (MCP `get_goals`)
- Trigger: `GET /v1/goals`; cùng số liệu được nhúng trong `GET /v1/snapshot` (UC-103); `GET /v1/wealth-building` (tab Ví & quỹ › Tích sản, pwa UC-707)

## History
- v1 (2026-09-22, commit `a773716`): schema v1.3 — `v_tichsan`, `v_must_monthly_avg` chỉ nhóm Must + tháng đã kết thúc, `v_emergency_fund` NULL khi < 3 tháng, `v_goal_progress`.
- v2 (2026-09-22, commit `b92fc0f`): `ledger.goals` + `GET /v1/goals`; snapshot tự ước phao khi view trả NULL.
- v3 (2026-10-06, commit `18569ce`): change [`261006-tich-san-ro-rang`](../changes/archive/261006-tich-san-ro-rang/proposal.md), ADR-86 — `GET /v1/tichsan` (`tichsanBreakdown`): tiền / tài sản, từng tài khoản heo (số dư sổ, log heo chờ gán), ví Tích sản vào / ra gộp theo nguồn bằng SQL. Chủ nhà: "tích sản sao đã có 55.000 vậy? tôi chưa đưa vào mà??" — "nếu là tích sản thì phải rõ là tiền nào, loại nào chứ? … phải đoán nó là tiền gì, đang ở đâu". AC-6…AC-8 mới.
- v4 (2026-10-06, commit `9c265ee`): change [`261006-tai-khoan-phao`](../changes/archive/261006-tai-khoan-phao/proposal.md), ADR-88 — `locked[]` đổi thành **`accounts[]`**: mọi tài khoản Tích sản đang dùng (`accounts.role` ∈ heo, phao, sổ tiết kiệm) kèm `role`, xếp theo `role` rồi `id`; `flows[].kind` thêm `phao`, `so-tiet-kiem` (chuyển vào ví Tích sản mà tài khoản nhận có vai trò đó; `heo` nay theo `role = 'heo'`). Chủ nhà: "tài khoản phao dự phòng của nhà tôi … đến 1 ngưỡng vợ tôi sẽ gửi tiết kiệm". Phao khẩn cấp vẫn đếm Tích sản tiền mặt — gồm tiền ở phao và sổ tiết kiệm. AC-6, AC-8 đổi tên trường; AC-9 mới.
- v5 (2026-10-06, commit `d059eaa`): không đổi API / số. Chủ nhà nhìn tab Tích sản sau khi nhập số dư đầu thật của hai heo: "sai gì đó nè" — tài khoản Tích sản có 135.000 ₫ (heo chồng 30.000, heo vợ 95.000, phao 10.000) mà tiền Tích sản chỉ 55.000 ₫, vì số dư có sẵn của heo / phao không phải Tích sản (ADR-86, ADR-88). Chữ hiển thị sửa ở pwa UC-707 v21; câu hỏi luật tiền ghi [OPEN] dưới, chờ chủ nhà quyết.
- v6 (2026-10-07, commit `d059eaa`): change [`261006-so-du-co-san-vao-tich-san`](../changes/archive/261006-so-du-co-san-vao-tich-san/proposal.md), ADR-91. Chủ nhà chọn "Chuyển phần còn trong heo/phao vào Tích sản (một lần)" — "Sau này mở phao/sổ mới có sẵn tiền cũng làm vậy". Migration 0027 (schema v1.27) ghi một bút toán hệ thống `O:0027` = max(0, Σ số dư tài khoản Tích sản không tính − Tích sản tiền mặt), chỉ ghi có ví Tích sản. Prod lúc quyết: 80.000, Tích sản 55.000 → 135.000. `flows[].kind` thêm `opening`. AC-10 mới; đóng [OPEN] "số dư có sẵn có vào Tích sản không".
- v7 (2026-10-07, commit `7424f26`): tên tiếng Anh (ADR-92), số không đổi: `GET /v1/tichsan` → `GET /v1/wealth-building` (`wealthBuildingBreakdown`; đường cũ 404 — AC-6 viết lại, thêm test API); `/v1/goals` trả `{goals, safetyFund, wealthBuilding}`; loại nguồn / vai tài khoản `heo`, `phao`, `so-tiet-kiem` → `piggy_bank`, `buffer`, `term_deposit`; view `v_tichsan` → `v_wealth_building`, `v_emergency_fund` → `v_safety_fund`, khoá `emergency_months` → `safety_fund_months`. Migration `0028_english_names.sql` (schema v1.28) dựng lại `wallets` / `accounts` với CHECK mới; thêm AC-11 (migration giữ nguyên số liệu), AC-12 (DB mới từ chối giá trị cũ). "Phao khẩn cấp" gọi là **Quỹ an tâm** (ADR-93), cả trong tên UC (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- `config.safety_fund_months` có giá trị (seed `6`; sửa ở Cài đặt, access).

## Main Flow
1. `goals` đọc một batch ba view:
   - **Quỹ mục tiêu** (`v_goal_progress`): mỗi ví có luật `goal` active → `target`, `targetDate`, `balance`, `missing = target − balance`, `pct` (1 số lẻ, không chặn 100), `daysLeft = max(0, target_date − hôm nay)`.
   - **Quỹ an tâm** (`v_safety_fund`, ADR-93): `cash` = tiền mặt của Tích sản; `monthsOfData` = số tháng đã kết thúc có chi nhóm Must (tối đa 3); đủ 3 tháng → `target = TB chi Must 3 tháng × safety_fund_months`, `monthsCovered = cash ÷ TB`, `pct = min(100, cash ÷ target)`; chưa đủ → cả ba NULL.
   - **Tích sản** (`v_wealth_building`): `total` = số dư ví, `assets` = Σ `buy_asset` active, `cash = total − assets`.
2. Trả `{goals, safetyFund, wealthBuilding}`.
3. `GET /v1/wealth-building` (`wealthBuildingBreakdown`, ADR-86) — một dòng đầu `v_wealth_building` (như snapshot) rồi một batch hai câu:
   - `walletId`, `name`, `cash`, `assets` của `v_wealth_building`.
   - `accounts[]`: mỗi tài khoản Tích sản đang dùng (`role IS NOT NULL` — `piggy_bank` heo đất, `buffer` phao dự phòng, `term_deposit` sổ tiết kiệm; ADR-88), xếp theo `role` (thứ tự `piggy_bank`, `buffer`, `term_deposit`) rồi `id` — `accountId`, `name`, `role`, `memberId`, `memberName`, `balance` = số dư sổ (`v_account_book`, có thể âm), `pendingCount` / `pendingNet` = log `pending` của chính tài khoản đó hoặc của tài khoản có rule `content` đang bật trỏ `counter_account_id` vào nó (`rules.account_id` = tài khoản của log, nội dung chứa mẫu — `INSTR(UPPER(content), UPPER(pattern))`); `pendingNet` theo phía tài khoản Tích sản: tiền ra từ tài khoản chi (chuyển vào) +, tiền vào tài khoản chi (rút về) −.
   - `flows[]`: mọi dòng `active` có `wallet_id` hoặc `counter_wallet_id` là ví Tích sản, gộp một `GROUP BY` theo `kind` × `direction` × (`accountId` | `walletId` | `assetKind`): `buy_asset` (luôn `out`, tách theo `assetKind`); `fund` (chia từ thu nhập); `piggy_bank` / `buffer` / `term_deposit` (chuyển vào, tài khoản nhận có `role` đó, tách theo tài khoản + tên chủ); `sweep` (`transfer` `source='system'`, lô `S…` — chốt tháng UC-207); `tax` (lô `T…` — quyết toán thuế UC-110); `wallet` (chuyển ví khác, tách theo ví kia, `walletName`, `walletActive` — ví đã tắt như `heo-dat` là số dư ví cũ của ADR-82); `other`. `direction` = `in` khi ví Tích sản được cộng (trừ `buy_asset`), còn lại `out`. `count` = số lần: dòng cùng lô (`batch_id`) tính một lần. Xếp `in` trước, số lớn trước. Gửi phao → sổ, tất toán sổ → phao không chạm ví nên không có nguồn.
   - `opening` (ADR-91): `transfer` `source='system'`, lô `O:…`, chỉ có ví Tích sản (không ví nguồn, không tài khoản) — số dư có sẵn của tài khoản Tích sản: migration 0027 (`O:0027`, một dòng tổng) và lúc một tài khoản thành tài khoản Tích sản ở Cài đặt (`O:<tài khoản>:<at>`, access UC-506 3g). Luôn `in`, không tách theo tài khoản.
   - Bất biến: Σ `in` − Σ `out` không tính `buy_asset` = số dư ví Tích sản; trừ thêm Σ `buy_asset` = `cash`.

### Luật tính "chi Must" cho Quỹ an tâm (`v_must_monthly_avg`)
- Chỉ ví `tier='must' AND must_group='must'` (không gồm Có thì tốt) — D9.
- Chỉ **tháng đã kết thúc** theo giờ VN (`month_key < strftime('%Y-%m','now','+7 hours')`), lấy 3 tháng gần nhất.
- Chi = `spend − refund` theo tháng (`v_spent_month`).

## Alternative Flows
- 1a. Snapshot (UC-103) thay `target` NULL bằng ước lượng `Σ monthTarget nhóm Must × safety_fund_months` và gắn `estimated: true`; `/v1/goals` **không** ước lượng.

## Exceptions
- Không có mã lỗi nghiệp vụ.

## Acceptance Criteria
### AC-1: Quỹ an tâm không báo đầy khi mới có vài khoản chi của tháng đang chạy
- Given DB mới, một khoản chi Must 250.000 trong tháng hiện tại
- When đọc `v_safety_fund`
- Then `months_of_data = 0`, `target = null`, `pct = null`
- Tests: `test/schema.test.ts` › "phao khẩn cấp › không báo đầy khi mới có vài khoản chi của tháng đang chạy"

### AC-2: Đủ 3 tháng trọn → target = số tháng × chi Must trung bình, không tính Có thì tốt
- Given 3 tháng trước mỗi tháng chi 2.000.000 ví `food` (Must) và 9.000.000 ví `nice-to-have` (Have); `safety_fund_months = 6`
- When đọc `v_safety_fund`
- Then `months_of_data = 3`, `target = 12.000.000`
- Tests: `test/schema.test.ts` › "phao khẩn cấp › đủ 3 tháng trọn thì target = số tháng × chi Must trung bình, không tính nhóm Have"

### AC-3: Mua tài sản chuyển cash → assets, tổng không đổi
- Given Tích sản cash 12.000.000
- When `buy_asset` 2.000.000 (UC-101)
- Then `wealthBuilding.total` 12.000.000, `assets` 2.000.000, `cash` 10.000.000; `safetyFund.cash` = 10.000.000
- Tests: ⚠ Chưa có test

### AC-4: Tiến độ quỹ mục tiêu
- Given ví `travel` luật `goal` 15.000.000, số dư 3.000.000
- When `GET /v1/goals`
- Then dòng `travel`: `missing = 12.000.000`, `pct = 20`
- Tests: ⚠ Chưa có test

### AC-5: Snapshot ước Quỹ an tâm khi chưa đủ dữ liệu
- Given chưa có tháng nào kết thúc
- When `GET /v1/snapshot`
- Then `safetyFund.estimated = true`
- Tests: `test/api.test.ts` › "chia lương end-to-end › snapshot: còn để chi tuần này và phe Tích sản ra đúng sau khi chia + chi"

### AC-6: `GET /v1/wealth-building` — bỏ heo theo từng heo, chia từ thu nhập, mua vàng; đường cũ không còn
- Given nhà như prod có heo chồng, heo vợ; Vợ bỏ heo 5.000 + 4.000, chồng 7.000 (tự gán); một khoản thu 10.000.000 vào BIDV chồng được chia (phần Tích sản > 0); mua vàng 3.000. Riêng DB seed: một khoản lương 40.000.000 đã chia (`POST /v1/allocate`)
- When `GET /v1/wealth-building` (`wealthBuildingBreakdown`); gọi `GET /v1/tichsan`
- Then `cash`/`assets` bằng `snapshot.tiers.wealth_building`, `assets` 3.000; `accounts` heo chồng 7.000, heo vợ 9.000 (`role: piggy_bank`), phao `mb-savings-wife` 0 (`role: buffer`, migration 0024), không log chờ; `flows` đúng bốn nhóm: `piggy_bank` vợ (2 lần, 9.000), `piggy_bank` chồng (1 lần, 7.000), `fund` (1 lần, đúng phần Tích sản của lần chia), `buy_asset` `gold` (`out`, 3.000); Σ vào − Σ ra (trừ mua) = số dư ví, trừ mua = `cash`. Loại nguồn của tài khoản Tích sản là chính `role` của tài khoản nhận: `piggy_bank`, `buffer`, `term_deposit`. DB seed: 200, `walletId = wealth-building`, `cash` 12.000.000 (cùng số Tích sản với snapshot), `accounts` rỗng, `flows` đúng một nhóm `fund` `in` 12.000.000. `GET /v1/tichsan` → 404 như mọi đường dẫn không có
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "GET /v1/wealth-building: Tích sản theo loại, chỗ nằm, nguồn (ADR-86) › bỏ heo theo từng heo, chia từ thu nhập, mua vàng: cùng số với snapshot; vào − ra = tiền"; [`test/api.test.ts`](../../test/api.test.ts) › "chia lương end-to-end › GET /v1/wealth-building: cùng số Tích sản với snapshot, nguồn chia lương là 'fund'; đường cũ → 404"

### AC-7: Số dư ví Heo đất cũ, chốt tháng, chuyển ngân sách tay là ba nguồn riêng
- Given DB như prod trước 0020 có bỏ heo 9.000 vào ví `heo-dat`, rồi chạy migration 0020; một dòng chốt tháng `S202609` 20.000 từ ví Ăn uống; một lần chuyển ngân sách tay 50.000 từ Du lịch sang Tích sản
- When `wealthBuildingBreakdown`
- Then `flows`: `wallet` Du lịch (`walletActive = true`, 50.000), `sweep` (1 lần, 20.000), `wallet` Heo đất (`walletActive = false`, 9.000)
- Tests: test migration ở repo gốc

### AC-8: Log heo chờ gán đếm vào đúng heo, số theo phía heo
- Given log tiền vào 400.000 "Tat toan truoc han tien gui sotich luy …" của MB chồng đang chờ gán (rule `TICH LUY` của MB chồng trỏ heo chồng)
- When `wealthBuildingBreakdown`
- Then heo chồng `pendingCount = 1`, `pendingNet = −400.000`; heo vợ, phao 0 / 0
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "GET /v1/wealth-building: Tích sản theo loại, chỗ nằm, nguồn (ADR-86) › log heo còn chờ gán: đếm vào đúng heo của chủ tài khoản, số theo phía heo (rút heo âm)"

### AC-9: Phao và sổ tiết kiệm ở chỗ nằm; chuyển vào phao là một nguồn (ADR-88)
- Given DB seed, phao `phao` và sổ `so-6-thang`; chuyển 1.000.000 `cash-wife` → phao, rồi 800.000 phao → sổ
- When `wealthBuildingBreakdown`
- Then `accounts` = phao 200.000 (`role: buffer`), sổ 800.000 (`role: term_deposit`); `flows` đúng một nhóm `{kind: "buffer", direction: "in", accountId: "phao", count: 1, amount: 1.000.000}` (gửi sổ không thêm nguồn); sổ tất toán và tắt "Đang dùng" thì rời `accounts`
- Tests: [`test/buffer.test.ts`](../../test/buffer.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › DB mới: chuyển 1.000.000 vào phao → Tích sản +1.000.000, Tiền chi được −1.000.000 một lần; gửi 800.000 phao → sổ không đổi gì; tất toán 820.000 (20.000 lãi là Thu nhập) → Tích sản về phao"

### AC-10: Migration 0027 — số dư có sẵn còn trong heo / phao vào Tích sản một lần (ADR-91)
- Given DB như prod 6/10: heo chồng số dư đầu 425.000, heo vợ 235.000, phao 10.000; bỏ heo qua app 50.000 + 5.000 (Có thì tốt → Tích sản); rút heo về 400.000 + 190.000. Heo 30.000 + 95.000 + phao 10.000 = 135.000, Tích sản tiền mặt 55.000
- When chạy `migrations/0027_so_du_co_san_tich_san.sql` (rồi chạy lại lần nữa)
- Then đúng một dòng `transfer` `source='system'` 80.000, `wallet_id = 'tich-san'`, `counter_wallet_id` / `account_id` / `counter_account_id` NULL, `batch_id = 'O:0027'`, `at` = lúc chạy, `week_key` / `month_key` như `weekKey` / `monthKey` của app. Tích sản tiền mặt 135.000; Có thì tốt (−55.000), Σ số dư sổ tài khoản, Tiền chi được không đổi (`wealthBuildingHeld` 0); `flows` có `{kind: "opening", direction: "in", count: 1, amount: 80.000}`; schema v1.27; chạy lại không thêm dòng. DB seed mẫu: không có dòng `O:` nào
- Tests: test migration ở repo gốc; test migration ở repo gốc

### AC-11: Migration 0028 — tên tiếng Anh trong dữ liệu, số liệu giữ nguyên (ADR-92)
- Given DB dựng tới migration 0027 có đủ loại cũ — ví `tichsan`, tài khoản `heo` (khoá), `phao`, `so-tiet-kiem` (khoá), giao dịch Tích sản, bỏ heo, mua tài sản, chi Must đủ 3 tháng, `config.emergency_months = 4` (dữ liệu mẫu kiểu `prodLikeDb`)
- When chạy `migrations/0028_english_names.sql`
- Then số dòng mọi bảng không đổi; `wallets.tier` thành `wealth_building`, `accounts.role` thành `piggy_bank` / `buffer` / `term_deposit`; `config.safety_fund_months = 4`, không còn `emergency_months`; snapshot (số dư từng ví, Tích sản tiền mặt / tài sản, Quỹ an tâm `cash` / `target` / `monthsCovered`), số dư sổ từng tài khoản và bảng Tích sản chi tiết **bằng đúng** trước migration (so theo tên mới); không còn `v_tichsan`, `v_emergency_fund`; `PRAGMA foreign_key_check` rỗng; schema v1.28
- Tests: test migration ở repo gốc

### AC-12: DB mới chỉ nhận giá trị tiếng Anh (ADR-92)
- Given DB mới chạy hết migration từ 0001
- When đọc schema và ghi thử giá trị cũ
- Then CHECK của `wallets.tier` là `holding | wealth_building | tax | nice | must`, của `accounts.role` là `piggy_bank | buffer | term_deposit` (giữ luật cũ: `piggy_bank` / `term_deposit` chỉ khi `locked = 1`, `buffer` chỉ khi `locked = 0`); `config.safety_fund_months = 6`; ghi `tichsan` hoặc `heo` bị từ chối
- Tests: [`test/schema.test.ts`](../../test/schema.test.ts) › "migrations › 0028 DB mới: CHECK tier là holding | wealth_building | tax | nice | must, role là piggy_bank | buffer | term_deposit theo locked; giá trị cũ bị từ chối"

## Traceability
- Code: `src/routes/v1.ts` › `GET /goals`, `GET /wealth-building`; `src/services/ledger.ts` › `goals`, `getSnapshot`, `wealthBuildingBreakdown`, `WealthBuildingFlowKind`, `wealthBuildingOpeningEntry` (ADR-91); `src/domain/snapshot.ts` › `buildSnapshot` (khối `safetyFund`, `goals`, `tiers.wealth_building`), `openingWealthBuildingCredit` (ADR-91); `src/domain/types.ts` › `WalletRef.tier`, `AccountRole`
- Migrations/DB: views `v_wealth_building`, `v_must_monthly_avg`, `v_safety_fund`, `v_goal_progress` (`migrations/0001_schema.sql`); `config.safety_fund_months` (`migrations/0002_seed.sql`); `accounts.role` (`migrations/0024_accounts_role.sql`, ADR-88); số dư có sẵn vào Tích sản (`migrations/0027_so_du_co_san_tich_san.sql`, ADR-91); tên tiếng Anh — `wallets.tier` `wealth_building`, `accounts.role` `piggy_bank` / `buffer` / `term_deposit`, khoá `safety_fund_months`, hai view đổi tên, dựng lại `wallets` / `accounts` với CHECK mới (`migrations/0028_english_names.sql`, schema v1.28, ADR-92)
- Dùng bởi: MCP `get_goals` (mcp UC-602); pwa UC-707 tab Tích sản (`GET /v1/wealth-building`).

## Divergences & Open Questions
- [OPEN] Hai nguồn số Quỹ an tâm khác nhau khi < 3 tháng dữ liệu: `/v1/goals` và MCP `get_goals` trả `safetyFund.target = null`, còn snapshot (màn app, Telegram) trả số ước lượng — lệch với BR-05 "đúng số như app".
- [DIVERGENCE] "Mọi kỳ tính theo Asia/Ho_Chi_Minh" (`docs/core_design_rules.md` §4) — `v_goal_progress.days_left` dùng `julianday('now')` UTC, không cộng +7 giờ như `v_must_monthly_avg`.
- [OPEN] `v_goal_progress` và `v_wealth_building` không lọc `wallets.active`; `v_safety_fund` không trả dòng nào nếu thiếu `config.safety_fund_months` (JOIN chéo).
- [OPEN] `v_goal_progress.pct` không chặn 100; snapshot thì chặn (`Math.min(100, …)`).
- [OPEN] `pendingCount` của heo so mẫu rule bằng `UPPER`/`INSTR` trong SQL, không bỏ dấu như `matchRule` (`normalizeContent`): mẫu heo hiện là chữ không dấu nên khớp; mẫu có dấu sẽ không đếm log chờ (ADR-86).
- Đã đóng 2026-10-07 (ADR-91): [OPEN] "số dư có sẵn của tài khoản Tích sản (heo / phao / sổ) có vào Tích sản không" (mở v5, chủ nhà "sai gì đó nè"). Chủ nhà chọn chuyển một lần phần còn trong heo / phao (migration 0027, prod 80.000 → Tích sản 135.000) và làm như vậy khi mở phao / sổ mới có sẵn tiền (access UC-506 3g).
