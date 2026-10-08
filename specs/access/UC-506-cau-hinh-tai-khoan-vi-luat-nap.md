# UC-506: Cấu hình tài khoản, ví & luật nạp
- Status: implemented
- BR: BR-08, BR-02, BR-04
- Decisions: D4 (bố trí tài khoản, `sepay_enabled`), D10 (ví tích dồn riêng), `plans/260921-2228-profit-first-pwa/context.md` "Những chỗ bản cũ từng đi lệch" #2 (Tích sản là MỘT ví); commit `c80ae89`; ADR-59 (phần khóa theo từng nguồn thu); ADR-63 (ví giữ riêng "Thu cho thuê" do migration tạo); ADR-66 (danh mục ngân hàng theo tài liệu SePay, `sepay_out`); ADR-76 (số dư đầu là mốc — nghĩa của `opened_at`); ADR-77 (`accounts.locked` và ví giữ riêng "Heo đất" chỉ do migration tạo); ADR-82 (ví "Heo đất" tắt bằng migration 0020, rule heo trỏ ví Tích sản); ADR-85 (`accounts.spendable` — "Tính vào tiền chi được"); ADR-92 (giá trị lưu `tier` / `role` và mã lỗi tiếng Anh); ADR-94 (mã hệ thống tiếng Anh)
- Actor: Thành viên đã đăng nhập (không phân biệt `role`), hoặc script có `API_TOKEN`
- Trigger: `POST /v1/settings/accounts`, `PATCH /v1/settings/accounts/:id`, `POST /v1/settings/wallets`, `PATCH /v1/settings/wallets/:id`, `POST /v1/settings/income-streams`, `PATCH /v1/settings/income-streams/:id`

Entity Account, Wallet thuộc ledger; Allocation (luật nạp) là cấu hình mà engine chia tiền của allocation đọc. UC này chỉ đặc tả **cửa cấu hình** và các kiểm tra ở đó. Mọi thay đổi ở đây là cấu hình, không đụng `transactions`/`bank_logs` (`src/services/settings.ts` dòng 2).

## History
- v1 (2026-09-22, commit `c80ae89`): API thêm/sửa tài khoản và ví + luật nạp.
- v2 (2026-10-01, commit `034b7ff`): thêm/sửa nguồn thu kèm phần khóa (`/v1/settings/income-streams`); luật nạp có `split_weekly` (phong bì tháng chia đều theo tuần); ví giữ riêng (tier `holding`, vd "Thu cho thuê") không tạo/tắt được từ Cài đặt (change `261001-cho-thue-lai`).
- v3 (2026-10-01, commit `1f472a1`): tài khoản bỏ chủ được (`owner_member_id: null` = tài khoản chung của nhà, vd ví tiền mặt chung); chủ không có thật → `unknown_member`.
- v4 (2026-10-01, commit `39751b8`): ngân hàng của tài khoản ngân hàng/thẻ chọn trong danh mục `src/domain/banks.ts` (`invalid_bank`); SePay chỉ bật được cho ngân hàng SePay hỗ trợ (`bank_not_supported`); trường mới `sepay_out` ("SePay báo cả tiền ra") — mặc định theo tài liệu SePay khi bật SePay, chủ nhà bật tay được, tắt SePay thì về `false` (ADR-66).
- v5 (2026-10-03, commit `a8703fd`): tài khoản bật SePay thuộc đúng một **kết nối SePay** (`sepay_connection_id`, ADR-75) — không chọn thì giữ kết nối cũ, chưa có thì về kết nối mặc định `chinh`; kết nối không có hoặc đang tắt → `unknown_connection`; tắt SePay thì bỏ kết nối (`null`).
- v6 (2026-10-03, commit `f74bc70`): **`opened_at` là mốc của số dư đầu** (ADR-76) — `opening_balance` là số dư lúc bắt đầu ngày `opened_at` (giờ VN); giao dịch ngân hàng và bút toán trước ngày đó không vào sổ (ingest UC-302 2b, ledger UC-101 4j). `opened_at` phải là ngày có thật dạng `YYYY-MM-DD`, sai → `invalid_input` "opened_at có dạng 2026-10-01."; gửi `null`/rỗng = không có mốc.
- v7 (2026-10-03, commit `f74bc70`): cột **`accounts.locked`** (0/1, schema v1.17, ADR-77) — tiền thật nhưng chưa rút ngay được (heo đất MB). Chỉ migration đặt: API tài khoản không nhận, không đổi, `GET /v1/settings` không trả cột này. Migration 0017 tạo `piggy-husband`, `piggy-wife` (`locked = 1`) và ví giữ riêng `heo-dat` "Heo đất" khi nhà có `husband`/`wife`; ở Cài đặt chúng là tài khoản ghi tay và ví giữ riêng như mọi cái khác (sửa được tên, số dư đầu, ngày mở sổ; không tắt được ví — E8).
- v8 (2026-10-03, commit `e00814c`): **heo đất là Tích sản** (ADR-82) — migration 0020 (schema v1.20, chỉ dữ liệu): số dư ví `heo-dat` sang Tích sản bằng một bút toán hệ thống chỉ đổi ví, rule heo `wallet_id` → ví Tích sản đang dùng (prod `tich-san`), rồi tắt ví `heo-dat` (`active = 0`). Ở Cài đặt ví "Heo đất" hiện là ví đã tắt; tài khoản heo (`locked = 1`) giữ nguyên. Không đổi code Cài đặt.
- v9 (2026-10-06, commit `18569ce`): change [`261006-tien-chi-duoc`](../changes/archive/261006-tien-chi-duoc/proposal.md) — cột **`accounts.spendable`** (0/1, schema v1.22, migration 0022, ADR-85) "Tính vào tiền chi được": thêm tài khoản không gửi thì bật, thẻ tín dụng tắt; migration tắt cho thẻ tín dụng và heo đất; bật cho tài khoản `locked = 1` → `400 locked_account`. `GET /v1/settings` và phản hồi thêm/sửa tài khoản trả thêm `locked`, `spendable`. Chủ nhà: "tôi muốn nhìn ngay ở trang chủ vào là tôi còn lại thực tế là bao nhiêu tiền có thể chi tiêu (dựa trên tiền thật của các tài khoản của tôi nhé)" — chọn "chọn từng tài khoản".
- v10 (2026-10-06, commit `9c265ee`): change [`261006-tai-khoan-phao`](../changes/archive/261006-tai-khoan-phao/proposal.md), ADR-88 — cột **`accounts.role`** (schema v1.24, migration 0024): tài khoản Tích sản `heo` | `phao` | `so-tiet-kiem` (CHECK khớp `locked`: heo / sổ khóa, phao không). Thêm tài khoản nhận `role` `phao` (không khóa, mặc định không tính vào tiền chi được) hay `so-tiet-kiem` (khóa); `heo` chỉ migration; sửa chỉ đổi thường ↔ phao (`invalid_role`). Migration: heo có sẵn → `heo`; `mb-savings-wife` (prod) → phao, `spendable = 0`; rule phao → heo thôi chuyển ví. `locked_account` nói "Tài khoản đã khóa (heo đất, sổ tiết kiệm) không tính vào tiền chi được.". Chủ nhà: "tài khoản phao dự phòng của nhà tôi … đến 1 ngưỡng vợ tôi sẽ gửi tiết kiệm…" — "Gửi tiết kiệm có kỳ hạn = tài khoản khóa 'Sổ tiết kiệm'". AC-17, AC-18, AC-19; AC-14, AC-16 cập nhật.
- v11 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90, red-team INSIDER-04) — thêm / sửa tài khoản thành công thì ghi nhật ký `account.create` / `account.update` (`target = account:<id>`, `detail = { fields: [<tên trường đã gửi>] }`, không giá trị); lỗi thì không ghi. Ví, nguồn thu chưa ghi nhật ký. Thêm AC-20.
- v12 (2026-10-07, commit `d059eaa`): change [`261006-so-du-co-san-vao-tich-san`](../changes/archive/261006-so-du-co-san-vao-tich-san/proposal.md), ADR-91 — chủ nhà: "Sau này mở phao/sổ mới có sẵn tiền cũng làm vậy". Thêm tài khoản Tích sản (phao, sổ) có số dư đầu, hay đổi tài khoản thường đang có tiền sang phao, thì cùng lúc ghi một bút toán hệ thống chỉ ghi có ví Tích sản cho phần chưa là Tích sản (3g'). Đổi phao về thường không gỡ bút toán. `GET /v1/settings` › `accounts[]` và phản hồi thêm / sửa tài khoản trả thêm `book_balance`. AC-21, AC-22 mới.
- v13 (2026-10-07, commit `7424f26`): đổi tên tiếng Anh (ADR-92, migration 0028, schema v1.28) — `role` của tài khoản nhận `piggy_bank` (heo đất) | `buffer` (phao dự phòng) | `term_deposit` (sổ tiết kiệm) | `null`; giá trị cũ `heo` / `phao` / `so-tiet-kiem` → `400 invalid_input`. Ví Tích sản có `tier = 'wealth_building'` (thay `tichsan`); tạo ví Tích sản thứ hai → `409 one_wealth_building` (thay `one_tichsan`). Bút toán số dư có sẵn đọc view `v_wealth_building`; hàm `wealthBuildingOpeningEntry`, `openingWealthBuildingCredit`. Luật nghiệp vụ không đổi. Sửa bước 3e, 3g, 3g', 4, 8, E6, E8, E17, AC-6, AC-16, AC-17, AC-18, AC-21, AC-22 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v14 (2026-10-08, commit `21b9db0`): không đổi hành vi — test migration (0017/0019/0020, 0022, 0024) chuyển sang `test/migrations/` và tên test 0024 bỏ tên người; Traceability ghi ví "Thu cho thuê" theo tên (hộ mẫu `rental-income`). (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Qua `requireAuth`; body là object JSON (không thì `400 invalid_input` "Nội dung gửi lên phải là một object JSON.").

## Main Flow — Tài khoản
1. Thêm: `name` bắt buộc (≤ 60); `id` = `id` gửi lên hoặc slug không dấu của `name` (≤ 40, chỉ `[a-z0-9-]`); `kind` ∈ `bank|cash|ewallet|credit` (mặc định `bank`); `opening_balance` số nguyên trong ±1e12 (mặc định 0); `opened_at` mặc định ngày hiện tại (`date('now')`, ngày UTC). Trả `201` + tài khoản.
1a. **Ngày mở sổ** (ADR-76): `opened_at` = ngày (giờ VN) mà `opening_balance` là số dư lúc bắt đầu ngày đó — mọi giao dịch trước ngày đó đã nằm trong số dư đầu: log ngân hàng trước ngày đó được ghi `ignored` (ingest UC-302 2b), bút toán trước ngày đó bị từ chối `before_opening` (ledger UC-101 4j), sổ theo log chỉ tính từ ngày đó (ingest UC-308). Gửi lên phải là ngày có thật `YYYY-MM-DD` (`calendarDay`), không → E11 "opened_at có dạng 2026-10-01."; `null`/rỗng = không có mốc. Đổi `opened_at` về sau không đổi trạng thái log đã ghi.
2. Sửa: chỉ ghi các trường có mặt trong body (`patchRow`); trả tài khoản sau khi sửa.
3. `sepay_enabled = true` (sau khi ghép với giá trị cũ) bắt buộc có `account_no` — số này là khoá nhận diện giao dịch SePay (ingest).
3a. **Ngân hàng** (`sepayFields`, ADR-66): tài khoản `kind` `bank`/`credit` chỉ nhận `bank` là mã trong `BANKS` (`src/domain/banks.ts`) hoặc `null`; mã lạ → E13. `ewallet` giữ tên nhà cung cấp tự do. Chỉ kiểm khi request **đổi** `bank`/`kind` so với giá trị đang lưu — sửa tên một tài khoản cũ (ngân hàng gõ tay ngoài danh mục, hay đã nối SePay với ngân hàng ngoài danh sách SePay) không bị chặn.
3b. **SePay theo ngân hàng**: bật SePay (hoặc đổi ngân hàng/loại khi đang bật) chỉ được với `kind = bank` và ngân hàng có `sepay` trong danh mục; không → E14.
3c. **`sepay_out`** (boolean, "SePay báo cả tiền ra"): gửi lên thì lấy đúng giá trị đó — kể cả `true` khi tài liệu SePay nói ngân hàng không báo tiền ra (chủ nhà đã thử thấy về app); không gửi thì lúc **bật** SePay lấy mặc định `BANKS[].sepay.out` (VietinBank, TPBank, Sacombank = `true`; còn lại `false`), các lần sửa khác giữ giá trị cũ; SePay tắt → luôn `false`. GET `/v1/settings` trả `sepay_out` cho mỗi tài khoản; `/v1/bootstrap` trả `sepayOut` (ledger `loadRefs`).
3d. **Kết nối SePay** (`sepayConnectionId`, ADR-75): sau khi ghép, SePay bật → `sepay_connection_id` = giá trị gửi lên, hoặc giá trị đang lưu, hoặc `default`; giá trị **mới** (khác giá trị đang lưu) phải là kết nối có thật và đang bật, không → E15. Tài khoản đang thuộc một kết nối đã tắt vẫn sửa được các trường khác. SePay tắt → `sepay_connection_id = null`. Webhook và rà soát chỉ khớp giao dịch của kết nối vào tài khoản thuộc nó (ingest UC-301, UC-304). GET `/v1/settings` trả `sepay_connection_id` cho mỗi tài khoản.
3e. **Tài khoản đã khóa** (`accounts.locked = 1`, ADR-77 — heo đất; ADR-88 — sổ tiết kiệm): `accountFields` không đọc trường `locked`, nên không đặt hay đổi trực tiếp được cờ này (gửi lên bị bỏ qua); tài khoản mới chỉ `locked = 1` khi thêm với `role: "term_deposit"` (3g). Cờ quyết định tài khoản không tính vào tiền chi được và không bật được (3f); mọi luật khác (SePay, ngày mở sổ, tắt) như tài khoản thường.
3f. **Tính vào tiền chi được** (`spendable`, boolean, ADR-85): số dư sổ của tài khoản có cộng vào "Tiền chi được" ở Hôm nay không (ledger UC-103 bước 7b). Thêm: không gửi thì `true`, riêng `kind = credit` thì `false` (số dư thẻ tín dụng là nợ phải trả); gửi thì lấy đúng giá trị. Sửa: chỉ đổi khi có trong body; đổi `kind` không đổi cờ. Tài khoản `locked = 1` (heo đất) không bật được → E16; tắt / sửa trường khác vẫn được. `GET /v1/settings` trả `locked` và `spendable` cho mỗi tài khoản.
3g. **Giữ tiền Tích sản** (`role`, ADR-88; giá trị tiếng Anh từ migration 0028, ADR-92): `null` = tài khoản thường; `buffer` = phao dự phòng (không khóa); `term_deposit` = sổ tiết kiệm có kỳ hạn (khóa, `locked = 1`); `piggy_bank` = heo đất (chỉ migration). Tiền chuyển vào tài khoản có `role` từ tài khoản thường là Tích sản (ledger UC-101). Thêm: `role` ∈ `buffer | term_deposit` (gửi `piggy_bank` → E17); sổ tiết kiệm ghi `locked = 1` và `spendable = 0` (gửi `spendable: true` → E16); phao và sổ không gửi `spendable` thì `false`. Ngày gửi của sổ = `opened_at`; không có cột kỳ hạn. Sửa: chỉ đổi qua lại `null ↔ buffer`; đổi sang phao mà không gửi `spendable` thì `spendable = 0`; đổi `role` của tài khoản khóa (heo, sổ) hay sang `piggy_bank` / `term_deposit` → E17. Giá trị ngoài `piggy_bank | buffer | term_deposit` (kể cả giá trị cũ `heo`, `phao`, `so-tiet-kiem`) → E11 `invalid_input`. Sổ đã tất toán thì tắt "Đang dùng" (`active = false`). `GET /v1/settings` trả `role` cho mỗi tài khoản; `GET /v1/bootstrap` trả `accounts[].role`.
3g'. **Số dư có sẵn vào Tích sản** (ADR-91): tài khoản **thành** tài khoản Tích sản (thêm với `role`, hoặc sửa `null → buffer`) mà sau khi ghi không tính vào tiền chi được (khóa, hoặc `spendable = 0`) và có số dư sổ B > 0 (thêm: `opening_balance`; sửa: số dư sổ hiện có cộng phần đổi `opening_balance` nếu gửi kèm) → cùng một `db.batch` với thay đổi tài khoản, ghi `transfer` `source='system'`, chỉ `wallet_id` = ví Tích sản (dòng đầu `v_wealth_building`), `batch_id = 'O:<id>:<at>'`, `note` "Số dư có sẵn khi mở {tên} → Tích sản", số tiền `min(B, max(0, max(0, R + B) − max(0, C)))`. R = Σ số dư sổ các tài khoản Tích sản không tính khác, C = Tích sản tiền mặt — phần Tích sản đang ở tài khoản thường coi như đã chuyển vào đây (`openingWealthBuildingCredit`, `wealthBuildingOpeningEntry`). Bằng 0 thì không ghi. Có thì tốt và số dư sổ không đổi; Tiền chi được như khi chỉ đổi tài khoản. Đổi phao về thường không gỡ; đổi lại sang phao thì R + B ≤ C nên không ghi thêm. Sang phao mà gửi `spendable: true` thì không ghi (ghi sẽ làm Tiền chi được giảm).

## Main Flow — Ví + luật nạp
4. Thêm ví: `name` bắt buộc; `tier` ∈ `wealth_building|tax|nice|must` (không tạo được `holding` — cả ví Thu nhập lẫn ví giữ riêng như "Thu cho thuê" chỉ do migration tạo; ví "Heo đất" cũng do migration 0017 tạo và đã tắt ở migration 0020, ADR-82); `must_group` ∈ `must|have` bắt buộc khi `tier = must`; `kind` ∈ `envelope|accrual|bill`; `scope` mặc định `shared`, `personal` bắt buộc `member_id`; `sort` 0..10000 (mặc định 100); `private` boolean.
5. Nếu có `allocation`: `mode` ∈ `flat|percent|goal|lump` (không tạo được `remainder`); `period` ∈ `week|month`; `percent` là tỷ lệ 0..1; `target_date` dạng `YYYY-MM-DD`; `priority` 0..1000 (mặc định 100); `split_weekly` boolean. Ví và luật nạp được ghi **trong một `db.batch`**.
6. Sửa ví: `name`, `account_id`, `member_id` (chỉ khi ví `personal`), `private`, `sort`, `active`. Nếu có `allocation`: ghép với luật cũ rồi kiểm tra như bước 5; chưa có luật thì tạo mới.
7. Kiểm tra luật nạp (`checkAllocation`): `flat` cần `amount`; `percent` cần `percent`; `goal` cần `target_amount` và `target_date`; `lump` cần `amount` hoặc `target_amount`.
8. Kiểm tra **trước khi ghi** (`percentTotalOk`): tổng `percent` của các luật `percent` đang active thuộc tầng `wealth_building` + `tax` (ví active), cộng phần của ví đang sửa, không vượt 1 (100% thu nhập).
8a. `split_weekly` (`splitWeekly`): chỉ hợp lệ khi ví `kind = envelope`, `mode` ∈ `flat|lump` và `period` ≠ `week` (phong bì nạp theo tháng). Bật → dự kiến tuần = dự kiến tháng ÷ số thứ Hai của tháng (ledger UC-103/UC-104). Gửi `true` cho luật không hợp lệ → lỗi E9; luật đổi sang dạng không hợp lệ (vd về `period = week`) thì `split_weekly` tự tắt, không báo lỗi.

## Main Flow — Nguồn thu (`IncomeStream`, ADR-59)
9. Thêm: `POST /income-streams` `{ name, id?, sort?, locks? }` — `name` bắt buộc (≤ 60); `id` như tài khoản (slug của `name`); `sort` 0..10000 (mặc định 100); `locks` mặc định rỗng. Nguồn và phần khóa ghi trong một `db.batch`; trả `201` + `{ id, name, sort, active, locks: [{ walletId, percent }] }`.
10. Sửa: `PATCH /income-streams/:id` `{ name?, sort?, active?, locks? }`; `locks` có mặt thì **thay toàn bộ** phần khóa của nguồn (mảng rỗng = bỏ hết khóa). Trả nguồn sau khi sửa.
11. Kiểm phần khóa **trước khi ghi** (`lockStatements`): `locks` là mảng; mỗi phần tử `{ wallet_id, percent }` với `percent` là số `0 < p ≤ 1`; mỗi ví một lần trong một nguồn; ví phải có và đang `active`; không khóa vào chính ví Thu nhập; tổng `percent` ≤ 1 (đúng 1 = khóa trọn, không chạy dòng thác — allocation UC-201).
12. Không có nguồn = luật % chung như cũ. Nguồn cho thuê mặc định và cấu hình cho thuê (số người, danh mục chi chung) sửa ở `PATCH /v1/rental/config` — rental [UC-801](../rental/UC-801-thiet-lap-nguoi-thue.md).

## Alternative Flows
- 6a. Ví nhận phần còn lại (`mode = remainder`): chỉ sửa được `priority`; gửi `mode` khác → lỗi E7.

## Exceptions
- E1. Trùng `id` tài khoản / ví → `409 duplicate`.
- E2. `account_no` đã thuộc tài khoản khác → `409 duplicate` "Số tài khoản này đã có trong danh sách." (DB còn có unique index `idx_acct_no`).
- E3. Bật SePay mà thiếu số tài khoản → `400 missing_account_no`.
- E4. Tắt tài khoản còn ví `active` trú ở đó → `409 in_use`.
- E5. `owner_member_id` / `member_id` / `account_id` không tồn tại → `400 unknown_member` / `unknown_account`.
- E6. Tạo ví `wealth_building` khi đã có một ví `wealth_building` active → `409 one_wealth_building`.
- E7. Đổi `mode` của ví `remainder` → `409 remainder_fixed`.
- E8. Tắt ví `remainder`, ví tầng `wealth_building` hoặc `holding` (ví Thu nhập và mọi ví giữ riêng như "Thu cho thuê") → `409 required_wallet`.
- E9. Luật nạp thiếu trường theo `mode`, tổng % Tích sản + Thuế > 100%, hoặc bật `split_weekly` cho luật không phải phong bì tháng → `400 invalid_allocation`.
- E10. Không có tài khoản/ví/nguồn thu với `:id` → `404 not_found`.
- E11. Kiểu sai / ngoài khoảng → `400 invalid_input`; `id` sai định dạng → `400 invalid_id`.
- E12. Nguồn thu trùng `id` → `409 duplicate`. `locks` không phải mảng, phần tử sai dạng, `percent` ngoài `(0, 1]`, ví lặp lại → `400 invalid_input`; ví không có/đã tắt → `400 unknown_wallet`; khóa vào ví Thu nhập hoặc tổng > 100% → `400 invalid_lock`.
- E13. Tài khoản ngân hàng/thẻ với `bank` ngoài danh mục → `400 invalid_bank` "Ngân hàng phải chọn trong danh sách."
- E14. Bật SePay cho ngân hàng SePay không hỗ trợ (hoặc tài khoản không phải ngân hàng) → `400 bank_not_supported` "SePay chưa hỗ trợ ngân hàng này."
- E15. `sepay_connection_id` không có hoặc kết nối đang tắt → `400 unknown_connection` "Không có kết nối SePay này, hoặc kết nối đang tắt."
- E16. Bật `spendable` cho tài khoản `locked = 1` (heo đất, sổ tiết kiệm — kể cả lúc thêm sổ) → `400 locked_account` "Tài khoản đã khóa (heo đất, sổ tiết kiệm) không tính vào tiền chi được." (cột không đổi).
- E17. `role` không hợp lệ cho thao tác (thêm `piggy_bank`; đổi vai trò heo / sổ; đổi sang `piggy_bank` / `term_deposit`) → `400 invalid_role`; giá trị ngoài `piggy_bank|buffer|term_deposit` (kể cả giá trị cũ `heo|phao|so-tiet-kiem`) → `400 invalid_input`.

## Acceptance Criteria
### AC-1: Thêm tài khoản có SePay; thiếu số hoặc trùng số bị từ chối
- Given seed mặc định
- When thêm `MB (vợ)` (`bank: "MBBank"`) có `account_no` + SePay; thêm `BIDV` bật SePay không có số; thêm tài khoản trùng số
- Then lần 1 → 201 với `id = "mb-vo"`, `bank = "MBBank"`, `sepay_out = false`; lần 2 → `missing_account_no`; lần 3 → 409
- Tests: `test/settings.test.ts` › "tài khoản › thêm tài khoản MB có SePay; bật SePay mà thiếu số tài khoản thì từ chối; trùng số tài khoản thì từ chối"

### AC-2: Không tắt được tài khoản còn ví trú
- Given `vcb-husband` còn ví active
- When sửa `account_no`/`name` rồi gửi `active: false`
- Then sửa được số và tên; tắt → `in_use`
- Tests: `test/settings.test.ts` › "tài khoản › sửa số tài khoản mẫu thành số thật; không tắt được tài khoản còn ví trú ở đó"

### AC-9: Tài khoản chung của nhà (không gắn chủ)
- Given `cash-wife`
- When `PATCH` `{ owner_member_id: null, name: "Tiền mặt" }`; rồi `{ owner_member_id: "khong-co" }`
- Then lưu được chủ NULL; lần sau `unknown_member`
- Tests: `test/settings.test.ts` › "tài khoản › tài khoản chung của nhà (bỏ chủ, vd ví tiền mặt chung) lưu được; chủ không có thật thì từ chối"

### AC-3: Sửa số tiền phong bì giữ nguyên các trường không gửi
- Given ví `food` luật `flat`/`week`
- When `PATCH` `allocation: { amount: 700000, floor_amount: 550000 }`
- Then luật thành `{ mode: "flat", period: "week", amount: 700000, floor_amount: 550000 }`
- Tests: `test/settings.test.ts` › "ví & số tiền nạp › sửa số tiền phong bì Ăn uống"

### AC-4: Tổng % Tích sản + Thuế > 100% bị từ chối, không ghi gì
- Given `wealth-building` đang 30%
- When đặt `percent: 0.95`
- Then `invalid_allocation`, DB vẫn `percent = 0.3`
- Tests: `test/settings.test.ts` › "ví & số tiền nạp › tổng % Tích sản + Thuế vượt 100% thì từ chối — và không ghi gì"

### AC-5: Ví nhận phần còn lại là cố định
- Given ví `nice-to-have` (`remainder`)
- When đổi sang `flat`; hoặc tắt
- Then `remainder_fixed`; `required_wallet`
- Tests: `test/settings.test.ts` › "ví & số tiền nạp › ví nhận phần còn lại không đổi cách nạp được; không tắt được"

### AC-6: Thêm ví tích dồn có mục tiêu; không có Tích sản thứ hai
- Given seed mặc định
- When thêm ví `Bảo hiểm` `goal` đủ trường; thêm ví `goal` thiếu hạn; thêm ví `tier: "wealth_building"` thứ hai
- Then 201 `id = "bao-hiem"`; `invalid_allocation`; 409 (`one_wealth_building`)
- Tests: `test/settings.test.ts` › "ví & số tiền nạp › thêm ví tích dồn Bảo hiểm (quyết định D10) có mục tiêu; không tạo được ví Tích sản thứ hai"

### AC-7: Thêm/sửa nguồn thu; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối
- Given seed mặc định
- When thêm "Thưởng" khóa Tích sản 60% + Du lịch 50%; rồi khóa Tích sản 50%; sửa khóa vào `income`; sửa tên + khóa `rental-income` 100% + tắt; sửa nguồn `khong-co`
- Then `invalid_lock`; `201` `id = "thuong"`; `invalid_lock`; `{ id: "thuong", name: "Thưởng Tết", sort: 100, active: false, locks: [{ walletId: "rental-income", percent: 1 }] }`; 404
- Tests: `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › đọc hồ sơ nguồn thu seed; thêm/sửa nguồn; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối"

### AC-8: Phong bì tháng bật chia theo tuần; ví khác thì không
- Given ví `food` (phong bì), `transport` (phong bì tuần), `hometown` (tích dồn)
- When `food` đổi sang `period: month`, `amount: 2800000`, `split_weekly: true`; bật `split_weekly` cho `transport`, `hometown`; rồi `food` về `period: week`
- Then `food` có `splitWeekly: true`; hai ví kia `invalid_allocation`; về tuần thì `splitWeekly: false`
- Tests: `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › phong bì tháng bật chia theo tuần; ví tích dồn hay phong bì tuần thì không"

### AC-10: Ngân hàng chọn trong danh mục; SePay chỉ bật cho ngân hàng SePay hỗ trợ
- Given seed mặc định
- When thêm tài khoản ngân hàng `bank: "MB"` (tên gõ tay cũ); thêm `Vietcombank` bật SePay; thêm ví điện tử `bank: "MoMo"`; tài khoản Sacombank đang nối SePay đổi sang `Techcombank`
- Then `400 invalid_bank`; `400 bank_not_supported` "SePay chưa hỗ trợ ngân hàng này."; `201`; `bank_not_supported`
- Tests: `test/settings.test.ts` › "tài khoản › ngân hàng phải chọn trong danh mục; SePay chỉ bật được cho ngân hàng SePay hỗ trợ"

### AC-11: "SePay báo cả tiền ra" mặc định theo tài liệu SePay, chủ nhà bật tay được
- Given seed mặc định
- When thêm MB Bank bật SePay; thêm Sacombank bật SePay; `PATCH` MB `{ sepay_out: true }`; đổi tên MB; tắt SePay của MB kèm `sepay_out: true`; bật lại SePay; đọc `/v1/bootstrap`
- Then MB `sepay_out = false`, Sacombank `true`; MB thành `true` và giữ `true` khi đổi tên; tắt SePay → `false`; bật lại → `false` (mặc định tài liệu); bootstrap có `sepayEnabled: true, sepayOut: true` cho Sacombank
- Tests: `test/settings.test.ts` › "tài khoản › SePay báo cả tiền ra: mặc định theo tài liệu SePay (MB chỉ tiền vào, Sacombank cả ra), chủ nhà bật tay được, tắt SePay thì về tắt"

### AC-12: Tài khoản bật SePay thuộc đúng một kết nối SePay
- Given seed mặc định và kết nối thêm "SePay của vợ" (`sepay-wife`)
- When thêm "MB vợ" bật SePay không chọn kết nối; chuyển sang `sepay-wife`; chọn `khong-co`; tắt `default` rồi chọn `default`; đổi tên `vcb-husband` (đang thuộc `default` đã tắt); tắt SePay của "MB vợ"; thêm tài khoản tiền mặt
- Then `sepay_connection_id = "default"`; `"sepay-wife"`; `unknown_connection`; `unknown_connection`; đổi tên được, vẫn `default`; `sepay_enabled: false, sepay_connection_id: null`; `null`
- Tests: `test/settings.test.ts` › "tài khoản › tài khoản bật SePay thuộc một kết nối: không chọn thì về kết nối mặc định, chọn được kết nối khác; kết nối lạ hay đang tắt bị từ chối; tắt SePay thì bỏ"

### AC-13: Ngày mở sổ là ngày có thật dạng `YYYY-MM-DD`; bỏ trống là không có mốc (ADR-76)
- Given seed mặc định
- When sửa `vcb-husband` với `opened_at` lần lượt `"1/10/2026"`, `"2026-02-30"`, `"2026-10-01"`, `null`
- Then hai lần đầu `400 invalid_input`; rồi tài khoản có `opened_at = "2026-10-01"`; rồi `opened_at = null`
- Tests: `test/settings.test.ts` › "tài khoản › ngày mở sổ phải là ngày có thật dạng YYYY-MM-DD (là mốc so ngày giao dịch, ADR-76); bỏ trống thì không có mốc"

### AC-14: Tài khoản heo đất đã khóa do migration tạo, chỉ khi nhà có hai thành viên thật của prod; ví "Heo đất" đã tắt, rule heo trỏ Tích sản (ADR-77, ADR-82)
- Given nhà như prod (hai thành viên thật — dưới đây gọi là chồng / vợ, mã tài khoản là mã thay thế) chạy migration tới 0016 rồi 0017 + 0019 + 0020; và DB seed mẫu (`anh`/`em`)
- When đọc `accounts WHERE locked = 1`, ví `heo-dat` và rule có `counter_account_id`
- Then nhà như prod: `piggy-husband` (chủ là chồng), `piggy-wife` (chủ là vợ) — `bank = MBBank`, `sepay_enabled = 0`, `locked = 1`, `opening_balance = 0`, `opened_at = 2026-10-01`; ví `heo-dat` `active = 0`; rule `transfer` mẫu `CHUYEN TIEN LE LAM TRON` / `TIET KIEM TIEN LE` / `TICH LUY` cho mỗi tài khoản MB của đúng chủ (`mb-main-husband` → `piggy-husband`; `mb-spending-wife`, `mb-savings-wife` → `piggy-wife`), `from_wallet_id = co-thi-tot`, `wallet_id = tich-san` — riêng rule của `mb-savings-wife` (phao từ 0024, ADR-88) không ví. DB seed mẫu: không tài khoản `locked` nào, không ví `heo-dat`, không rule có tài khoản đầu kia, không bút toán hệ thống
- Tests: test migration ở repo gốc; test migration ở repo gốc; dữ liệu như prod khi chạy 0020 (số dư ví sang Tích sản, tắt ví, không còn rule trỏ `heo-dat`): test migration ở repo gốc

### AC-15: "Tính vào tiền chi được" mặc định bật, thẻ tín dụng mặc định tắt (ADR-85)
- Given seed mặc định
- When thêm ví điện tử MoMo, thẻ tín dụng không gửi `spendable`, thẻ tín dụng gửi `spendable: true`, tài khoản ngân hàng gửi `spendable: false`; chạy migration 0022 trên DB có thẻ tín dụng và tài khoản khóa
- Then `spendable` lần lượt `true`, `false`, `true`, `false`; sau 0022 tài khoản thường `1`, thẻ tín dụng và tài khoản khóa `0`; giá trị ngoài 0/1 bị CHECK chặn
- Tests: [`test/spendable-cash.test.ts`](../../test/spendable-cash.test.ts) › "tiền chi được — snapshot và công tắc tài khoản › thêm tài khoản: mặc định tính, thẻ tín dụng mặc định không tính (số dư thẻ là nợ), gửi tay thì theo người gửi"; test migration ở repo gốc

### AC-16: Heo đất không bật được "Tính vào tiền chi được"
- Given tài khoản `locked = 1`, `role = piggy_bank`, `spendable = 0`
- When `PATCH { spendable: true }`; rồi `PATCH { name }`
- Then lần 1 `400 locked_account` "Tài khoản đã khóa (heo đất, sổ tiết kiệm) không tính vào tiền chi được.", cột vẫn `0`; lần 2 sửa được tên, phản hồi `locked: true`, `spendable: false`; snapshot để tài khoản ở `spendableCash.excluded` với `role: "piggy_bank"`
- Tests: [`test/spendable-cash.test.ts`](../../test/spendable-cash.test.ts) › "tiền chi được — snapshot và công tắc tài khoản › heo đất (tài khoản khóa) không bật được Tính vào tiền chi được; vẫn sửa được tên"

### AC-17: Thêm phao dự phòng và sổ tiết kiệm (ADR-88)
- Given seed
- When thêm `MB tiết kiệm (vợ)` `role: "buffer"` và `Sổ 6 tháng` `role: "term_deposit"` (không gửi `spendable`); thêm `role: "piggy_bank"`; thêm sổ kèm `spendable: true`; thêm `role: "quy"`; thêm / sửa với giá trị cũ `role: "heo" | "phao" | "so-tiet-kiem"`
- Then phao `role: buffer, locked: 0, spendable: 0`; sổ `role: term_deposit, locked: 1, spendable: 0`; ba lần sau lần lượt `invalid_role`, `locked_account`, `invalid_input`; giá trị cũ → `invalid_input`
- Tests: [`test/buffer.test.ts`](../../test/buffer.test.ts) › "cấu hình tài khoản Tích sản (ADR-88) › thêm phao: không khóa, mặc định không tính vào tiền chi được; sổ tiết kiệm: khóa; heo không thêm tay được; sổ không bật tính được"

### AC-18: Đổi tài khoản thường ↔ phao; heo / sổ giữ vai trò (ADR-88)
- Given seed có sổ `so-6-thang`
- When `PATCH cash-husband { role: "buffer" }`; rồi `{ role: null, spendable: true }`; `PATCH so-6-thang { role: null }`; `PATCH cash-husband { role: "term_deposit" }` / `{ role: "piggy_bank" }`; `PATCH so-6-thang { name }`
- Then lần 1 `role: buffer, spendable: false, locked: false`; lần 2 về thường, `spendable: true`; ba lần sau `invalid_role`; đổi tên sổ được, vẫn `term_deposit`
- Tests: [`test/buffer.test.ts`](../../test/buffer.test.ts) › "cấu hình tài khoản Tích sản (ADR-88) › đổi qua lại tài khoản thường ↔ phao (sang phao thì tắt tính vào tiền chi được); heo / sổ giữ vai trò"

### AC-19: Migration 0024 — heo có sẵn là `heo`, MB tiết kiệm (vợ) là phao (ADR-88; giá trị lúc 0024, migration 0028 đổi thành `piggy_bank` / `buffer`)
- Given DB chạy migration tới 0023 có `piggy-wife` (`locked = 1`), `mb-savings-wife` (`spendable = 1`), rule `TICH LUY` `mb-savings-wife` → `piggy-wife` và `vcb-em` → `piggy-wife` (Có thì tốt → Tích sản)
- When chạy `0024_accounts_role.sql`
- Then `piggy-wife` `role = heo`; `mb-savings-wife` `role = phao`, `spendable = 0`; tài khoản khác `role` NULL; rule của `mb-savings-wife` mất hai cột ví, rule của `vcb-em` giữ nguyên; CHECK chặn heo thành phao, tài khoản không khóa thành sổ, giá trị lạ; `schema_version = 1.24`
- Tests: test migration ở repo gốc

### AC-20: Thêm / sửa tài khoản ghi nhật ký chỉ tên trường (ADR-90)
- Given gọi bằng API token (người mặc định "husband")
- When `POST /accounts { name: "Ví Momo", kind: "ewallet", opening_balance: 0 }`; `PATCH /accounts/vcb-husband { name: "VCB của Chồng" }`
- Then `audit_log` có `{ member_id: "husband", via: "token", action: "account.create", target: "account:vi-momo", detail: {"fields":["kind","name","opening_balance"]} }` rồi `{ …, action: "account.update", target: "account:vcb-husband", detail: {"fields":["name"]} }`
- Tests: `test/audit.test.ts` › "nhật ký thay đổi › sửa tài khoản, thành viên, khoá, kết nối SePay chỉ ghi tên trường — không bao giờ ghi khoá; nhật ký không sửa, không xoá được"

### AC-21: Thêm phao có số dư đầu: số dư đó vào Tích sản một lần (ADR-91)
- Given DB seed (Tích sản 0, phao / sổ có sẵn số dư 0)
- When thêm phao `opening_balance: 500.000`; rồi thêm phao `opening_balance: 0` và tài khoản thường `opening_balance: 300.000`
- Then một bút toán `{amount: 500.000, wallet_id: "wealth-building", counter_wallet_id / account_id / counter_account_id: null, source: "system", batch_id: "O:phao-2:…", note: "Số dư có sẵn khi mở Phao VCB → Tích sản"}`; Tích sản tiền mặt +500.000; Có thì tốt và Tiền chi được không đổi; số dư sổ phao 500.000; bảng Tích sản chi tiết (`wealthBuildingBreakdown`, `GET /v1/wealth-building`) có nguồn `opening` 500.000; hai tài khoản sau không ghi gì
- Tests: [`test/buffer.test.ts`](../../test/buffer.test.ts) › "số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91) › thêm phao có số dư đầu 500.000: Tích sản +500.000 bằng một bút toán hệ thống không ví nguồn; Có thì tốt, sổ tài khoản, Tiền chi được không đổi; không số dư hay tài khoản thường thì không ghi"

### AC-22: Phần đã là Tích sản không tính lại; đổi sang phao ghi một lần (ADR-91)
- Given (a) Tích sản tiền mặt 300.000 (chuyển ngân sách từ Có thì tốt, nằm ở tài khoản thường); (b) DB seed, tài khoản thường `cash-husband` số dư 200.000
- When (a) thêm sổ tiết kiệm `opening_balance: 1.000.000`; (b) đổi `cash-husband` sang phao, rồi về thường (`spendable: true`), rồi sang phao lần nữa; đổi `cash-wife` sang phao kèm `spendable: true`
- Then (a) ghi 700.000; Tích sản tiền mặt 1.000.000, `wealthBuildingHeld` 0, `wealthBuildingOutside` 1.000.000; (b) ghi đúng một lần 200.000 (`batch_id` "O:cash-husband:…"), Tích sản 200.000 sau khi về thường (không gỡ); Tiền chi được giảm đúng 200.000 (tài khoản rời "đang tính"), không giảm thêm; `cash-wife` không ghi
- Tests: [`test/buffer.test.ts`](../../test/buffer.test.ts) › "số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91) › Tích sản 300.000 đang ở tài khoản thường: thêm sổ 1.000.000 chỉ ghi 700.000 — Tiền chi được như khi thêm sổ mà không ghi gì"; [`test/buffer.test.ts`](../../test/buffer.test.ts) › "số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91) › đổi tài khoản thường có 200.000 sang phao: ghi 200.000; về thường không gỡ; sang phao lần nữa không ghi thêm; sang phao mà vẫn tính vào tiền chi được thì không ghi"

## Traceability
- Code: `src/routes/settings.ts` › `settingsRoutes.post("/accounts")`, `.patch("/accounts/:id")`, `.post("/wallets")`, `.patch("/wallets/:id")`, `.post("/income-streams")`, `.patch("/income-streams/:id")`, `body`; `src/services/audit.ts` › `recordChange`, `fieldNames` (nhật ký tài khoản, ADR-90); `src/services/settings.ts` › `ACCOUNT_SQL`, `ACCOUNT_ROLES`, `LOCKED_SPENDABLE`, `toAccount`, `createAccount`, `updateAccount`, `accountFields` (`opened_at` qua `calendarDay`, `spendable`, `role`), `sepayFields`, `sepayConnectionId`, `createWallet`, `updateWallet`, `allocationFields`, `checkAllocation`, `splitWeekly`, `percentTotalOk`, `allocationId`, `createIncomeStream`, `updateIncomeStream`, `getStream`, `lockStatements`, `patchRow`, `newId`, `slug`, `text`, `integer`, `bool`, `oneOf`; `src/domain/banks.ts` › `BANKS`, `bankByCode`; `src/domain/types.ts` › `AccountRole`; migration `migrations/0024_accounts_role.sql` (`accounts.role`, ADR-88)
- Code (số dư có sẵn vào Tích sản, ADR-91): `src/services/settings.ts` › `createAccount`, `updateAccount`, `patchStatement`, `ACCOUNT_SQL` (`book_balance`); `src/services/ledger.ts` › `wealthBuildingOpeningEntry`; `src/domain/snapshot.ts` › `openingWealthBuildingCredit`.
- Migrations/DB: `accounts` (`idx_acct_no`), `wallets` (CHECK `scope <> 'personal' OR member_id IS NOT NULL`, CHECK `tier <> 'must' OR must_group IS NOT NULL`), `allocations` (`migrations/0001_schema.sql`); `allocations.split_weekly`, `income_streams`, `income_stream_locks` (CHECK `0 < percent ≤ 1`, PK `(stream_id, wallet_id)`), ví "Thu cho thuê" (`migrations/0007_income_streams_rental.sql`; hộ mẫu `rental-income`); `accounts.sepay_out`, đổi `accounts.bank` sang mã danh mục (`migrations/0010_bank_catalog.sql`); `accounts.sepay_connection_id` → `sepay_connections` (`migrations/0015_sepay_connections.sql`); `accounts.locked`, tài khoản `piggy-husband`/`piggy-wife`, ví `heo-dat` (`migrations/0017_heo_dat.sql`); tắt ví `heo-dat`, rule heo → ví Tích sản (`migrations/0020_heo_tich_san.sql`); `accounts.spendable` (CHECK 0/1; tắt cho thẻ tín dụng và tài khoản khóa — `migrations/0022_accounts_spendable.sql`); giá trị tiếng Anh: CHECK `wallets.tier ∈ holding|wealth_building|tax|nice|must`, `accounts.role ∈ piggy_bank|buffer|term_deposit` (dựng lại hai bảng, view `v_wealth_building` — `migrations/0028_english_names.sql`, ADR-92)
- PWA form: xem `specs/pwa/`; engine chia dùng luật nạp: xem `specs/allocation/`

## Divergences & Open Questions
- [OPEN] `updateWallet` ghi các cột của ví (`patchRow(db, "wallets", …)`) **trước** khi kiểm tra `allocation`; nếu cùng request sửa `name` và gửi luật nạp sai, tên đã được lưu nhưng request trả lỗi (`src/services/settings.ts` › `updateWallet`). `createWallet` thì nguyên tử (`db.batch`). Chưa có test cho trường hợp trộn.
- [OPEN] Server nhận `private: true` cho ví `shared` (`member_id = null`); với luật ẩn `private && member_id !== viewerId`, ví đó bị ẩn số với **mọi** người. PWA chỉ gửi `private` khi `scope = personal` (`web/src/lib/settings.ts` › `walletPayload`), nhưng API không chặn.
- [OPEN] Không có API xoá tài khoản/ví — chỉ tắt (`active: false`).
- [OPEN] Tắt nguồn thu không bị chặn khi nguồn đang là nguồn cho thuê (`rental_income_stream_id`) hay đang gắn vào mẫu lương: tiền người thuê gán/nhập sau đó lỗi `inactive_income_stream`, còn mẫu lương vẫn chia theo nguồn đã tắt (ingest UC-303). Không có test.
- [OPEN] Tắt một ví đang nằm trong phần khóa của nguồn thu không bị chặn; `loadRefs` vẫn nạp phần khóa đó nên lần chia sau có thể nạp vào ví đã tắt — [INFERENCE] từ `src/services/ledger.ts` › `loadRefs` (truy vấn `income_stream_locks` không lọc ví `active`). Không có test.
- [OPEN] Danh mục ngân hàng chép tay từ tài liệu SePay (đọc 2026-10-01); SePay thêm/bớt ngân hàng hay đổi chiều hỗ trợ thì phải sửa `src/domain/banks.ts` — không có kiểm tra tự động với `/v2/bank-accounts`.
- [OPEN] `GET /v1/settings` trả `accounts.locked` từ v9 (sheet tài khoản khóa ô "Tính vào tiền chi được" cho heo đất), nhưng bật SePay hay tắt tài khoản heo vẫn không bị chặn. Thêm heo cho người thứ ba phải viết migration (ADR-77).
