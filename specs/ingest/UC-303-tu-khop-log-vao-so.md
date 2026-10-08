# UC-303: Tự khớp log vào sổ
- Status: implemented
- BR: BR-04, BR-02, BR-03
- Decisions: D2 (chia ngay income đã xác nhận), D4; luật 6 (`docs/core_design_rules.md` §1); §6 "Luật khớp cặp chuyển nội bộ"; §9 "Mẫu lương"; commit `c3ab508` (ghi nguyên tử + trigger), `8ef7a99` (memo ngẫu nhiên riêng từng lệnh), `099e54f` (ngưỡng lương chống giả mạo), `eb7846e` (chân đầu bị gỡ vẫn được ghép lại); `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md` #1; ADR-59 (phần khóa theo nguồn thu của mẫu lương); ADR-60 (rule người thuê chỉ gợi ý, không tự gán); ADR-66 (log tiền ra của tài khoản "chỉ tiền vào" không tự gán theo rule); ADR-76 (số dư đầu là mốc); ADR-77 (rule gắn tài khoản; rule chuyển nội bộ tới tài khoản đầu kia kèm chuyển ví — bỏ heo đất); ADR-81 (chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi); ADR-82 (heo đất là Tích sản: bỏ heo chuyển ví Có thì tốt → Tích sản); ADR-92 (tên hàm và giá trị `role` tiếng Anh)
- Actor: hệ thống — chạy ngay sau khi UC-302 ghi được log mới có `account_id` và không có song sinh
- Trigger: `matchLog(db, log)` (nội bộ `src/services/ingest.ts`), cho cả nguồn `webhook` lẫn `backfill`

## History
- v1 (2026-09-22, commit `c1a25c1`): thứ tự PF → ghép cặp → rule → lương → pending; khớp lệnh theo `PF <batch_id>`.
- v2 (2026-09-22, commit `c3ab508`): mỗi nhánh ghi giao dịch + `markAssigned` trong **một** batch; trigger migration 0005 huỷ cả batch nếu log không còn `pending` hoặc lệnh đã hoàn tất → không ghi lần hai; chuẩn hoá khoảng trắng trước khi so từ khoá.
- v3 (2026-09-22, commit `8ef7a99`): memo `PF` + 6 ký tự ngẫu nhiên riêng từng lệnh (memo cũ đoán được cho phép người ngoài "hoàn tất" lệnh); chân thứ hai gắn vào giao dịch của **log đã khớp lệnh đó**, không theo `batch_id`.
- v4 (2026-09-22, commit `099e54f`): mẫu lương chỉ tự ghi + tự chia khi `amount ≥ salary_min_amount` (mặc định 1.000.000); nhỏ hơn thì `pending`.
- v5 (2026-09-22, commit `eb7846e`): khi lệnh còn `pending`, tìm cả chân kia đang `pending` mang cùng memo để ghép một lần (chân đầu từng bị gỡ gán không mồ côi); `salary_min_amount = 0` tắt ngưỡng.
- v6 (2026-10-01, commit `034b7ff`): mẫu lương mang `income_stream_id` → khoản `income` tự ghi gắn nguồn đó, lần chia tự động theo phần khóa của nguồn; rule mang `tenant_id` bị loại khỏi bước tự khớp (chỉ gợi ý ở màn Gán) (change `261001-cho-thue-lai`).
- v7 (2026-10-01, commit `39751b8`): log `out` của tài khoản SePay **không** báo tiền ra (`sepay_enabled AND sepay_out` = 0, ADR-66) bỏ qua bước rule — giữ `pending`, vì khoản chi đó có thể đã được nhập tay (D14 theo chiều cho phép). Memo PF và ghép cặp nội bộ vẫn chạy như cũ.
- v8 (2026-10-03, commit `f74bc70`): log trước ngày mở sổ của tài khoản không tới bước này (UC-302 2b, ADR-76); ứng viên ghép cặp nội bộ cũng bỏ log `pending` có ngày VN trước `opened_at` của tài khoản nó (log nhận trước khi có luật này).
- v9 (2026-10-03, commit `f74bc70`): **rule gắn tài khoản** (ADR-77, schema v1.17) — rule có `account_id` chỉ xét cho log của đúng tài khoản đó; rule `transfer` có `counter_account_id` tự gán chuyển nội bộ TK log → tài khoản đó (không tìm TK tiền mặt), kèm chuyển ví `from_wallet_id` → `wallet_id` khi rule có đủ hai ví (bỏ heo đất: MB → heo của chính chủ, Có thì tốt → Heo đất); ngày VN của log trước `opened_at` của tài khoản đầu kia → không tự gán, giữ `pending` (ADR-76).
- v10 (2026-10-03, commit `c67420e`): bước **2b** mới — log không ghép cặp được nhưng là chân còn lại của một `transfer` đã ghi từ **một** chân ở tài khoản đầu kia (chân đó đã được gán tay hoặc theo rule trước khi log này về) → gắn làm `log_id_2` của giao dịch đó, không ghi giao dịch mới (ADR-81). Prod 3/10: một lần chuyển 250.000 `mb-main-husband` → `mb-spending-wife` (hai kết nối SePay) nằm trong sổ hai lần.
- v11 (2026-10-03, commit `e00814c`): **heo đất là Tích sản** (ADR-82, migration 0020, schema v1.20) — rule heo trỏ ví Tích sản thay ví `heo-dat` (đã tắt), nên bỏ heo tự gán thành chuyển nội bộ MB → heo của chính chủ kèm chuyển ví **Có thì tốt → Tích sản**: Tích sản tiền mặt (và phao) tăng đúng số đó, "còn để chi" chỉ đổi ở Có thì tốt. Logic `matchLog` không đổi (ví vẫn lấy từ rule).
- v12 (2026-10-06, commit `9c265ee`): change [`261006-tai-khoan-phao`](../changes/archive/261006-tai-khoan-phao/proposal.md), ADR-88 — chuyển nội bộ do **ghép cặp** (bước 2, cả ghép tay UC-306) và do **rule `transfer` không mang ví** mà tài khoản đích là tài khoản Tích sản (heo, phao, sổ tiết kiệm), nguồn là tài khoản thường → mang chuyển ví Có thì tốt → Tích sản như nhập tay (`tichsanMove`). Lệnh chuyển tiền `PF` không đổi (ví đã nạp lúc chia). Chủ nhà: "Tiền vào phao tự vào Tích sản (như heo đất)". AC-22.
- v13 (2026-10-07, commit `7424f26`): đổi tên tiếng Anh (ADR-92, migration 0028): hàm chuyển ví vào Tích sản `tichsanMove` → `wealthBuildingMove` (cùng `isWealthBuildingDeposit`), ví Tích sản tìm theo `tier = 'wealth_building'`; vai tài khoản phao dự phòng lưu `role = 'buffer'`. Logic khớp không đổi. Sửa bước 2a, AC-22, Traceability (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Log vừa được ghi, `status='pending'`, `account_id` khác NULL, không có song sinh, không trước ngày mở sổ của tài khoản (UC-302).

## Main Flow
Thử lần lượt; bước đầu tiên ghi được thì dừng.
1. **Memo lệnh chuyển `PF XXXXXX`** (`extractTransferMemo`: `PF` + 6 ký tự `[0-9A-Z]`, dung sai khoảng trắng/hoa thường, trên nội dung đã chuẩn hoá). Tìm `transfer_orders` có `memo` đó, `amount` bằng log, và TK của log là nguồn hoặc đích. Hướng phải đúng vai: log ở TK nguồn phải `out`, ở TK đích phải `in`.
   - 1.1 Lệnh `pending`: tìm chân kia đang `pending` (TK còn lại của lệnh, cùng số tiền, ngược hướng, cùng memo). Một batch: `UPDATE transfer_orders SET status='done', matched_log_id=<log>` (đặt đầu batch) → một `transfer` (`account_id` = TK nguồn, `counter_account_id` = TK đích, `batch_id` = của lệnh, `log_id` = chân ra nếu có, `log_id_2` = chân vào nếu cả hai đã về) → `markAssigned` các log liên quan.
   - 1.2 Lệnh `done` và `matched_log_id` ≠ log này: tìm `transfer` `active` có `log_id = matched_log_id` và `log_id_2 IS NULL`; một batch gắn `log_id_2 = <log>` + `markAssigned` — **không** sinh giao dịch mới.
   - Không thoả (không có lệnh, sai hướng, lệnh `skipped`, không tìm được giao dịch để gắn) → sang bước 2.
2. **Ghép cặp nội bộ** (bước 2+3 của docs gộp làm một cơ chế, `canPair`): tìm log `pending` khác, `account_id` khác NULL và khác TK này, không trước ngày mở sổ của TK nó (`date(at, '+7 hours') >= opened_at` hoặc TK không có mốc — ADR-76), cùng `amount`, ngược `direction`, `|Δat| ≤ 10 phút`. Có → một batch: một `transfer` (`account_id` = TK của chân ra, `counter_account_id` = TK của chân vào, `log_id` = chân ra, `log_id_2` = chân vào, `at` = của log vừa về, note "Tự ghép cặp chuyển khoản nội bộ") + `markAssigned` cả hai.
   - 2a. **Vào tài khoản Tích sản** (ADR-88): TK chân vào là tài khoản Tích sản (`accounts.role` khác NULL — `piggy_bank`, `buffer`, `term_deposit`), TK chân ra là tài khoản thường → giao dịch mang `wallet_id` = ví Tích sản, `counter_wallet_id` = ví `remainder` (Có thì tốt) — `wealthBuildingMove(loadRefs)`; ngược lại không ví.
   - 2b. **Gắn vào chuyển nội bộ đã ghi một chân** (ADR-81, `findSingleLegTransfer`): tìm `transfer` `active`, `log_id_2 IS NULL`, `amount` = log, mà log `log_id` của nó trọn số tiền đó (không tách dòng), ngược chiều log này, nằm ở **tài khoản đầu kia** của giao dịch (`account_id` nếu là chân ra, `counter_account_id` nếu là chân vào), còn log này nằm đúng ở đầu còn lại theo chiều tiền (tiền vào → `counter_account_id`, tiền ra → `account_id`), lệch ≤ 10 phút (`canPair`); nhiều giao dịch thì lấy chân gần giờ nhất. Có → một batch (`attachSecondLeg`): `UPDATE transactions SET log_id_2 = <log>` (chỉ khi còn `active` và `log_id_2 IS NULL`) + đổi log sang `assigned` **chỉ khi** giao dịch đã nhận nó — **không** sinh giao dịch mới; ví, ghi chú, người ghi của giao dịch giữ nguyên. Giao dịch vừa bị huỷ / vừa có chân thứ hai ở request khác → log vẫn `pending`, sang bước 3.
3. **Rule** (`matchRule` trên rule `active` **không mang `tenant_id`** — rule người thuê bị lọc bỏ trước khi khớp, ADR-60; UC-307 — **và** không gắn tài khoản hoặc gắn đúng TK của log: `rules.account_id IS NULL OR = log.account_id`, ADR-77). **Trước đó**, log `out` của tài khoản mà SePay không được coi là báo tiền ra (`outNotFed`: `sepay_enabled AND sepay_out` = 0 — ADR-66) dừng ngay ở đây, giữ `pending` (3.0a):
   - 3.1 Rule `income` (chỉ khớp log `in` + `is_salary`) **và** `amount ≥ salaryMinAmount` → batch: `income` (`wallet_id` = ví của rule, `counter_account_id` = TK log, `by_member_id` của rule, `taxable=0`, `income_stream_id` = nguồn thu của rule hoặc NULL) + `markAssigned`; rồi gọi `allocateIncome` (allocation "Chia thu nhập") ngay — có nguồn thì chia theo phần khóa của nguồn (không trích thuế theo luật chung), không nguồn thì theo luật % chung như cũ (ADR-59); lỗi `already_allocated` bị nuốt, lỗi khác ném ra (UC-302 6a ghi `ingest_error`).
   - 3.2 Rule `spend` (chỉ khớp log `out`) **có** `category_id` → batch: `spend` (`counter_wallet_id` = ví rule, `category_id`, `account_id` = TK log, `by_member_id` của rule) + `markAssigned`.
   - 3.3 Rule `transfer` (log `out`):
     - có `counter_account_id` (tài khoản đầu kia, ADR-77) → batch: `transfer` TK log → tài khoản đó (`by_member_id` của rule) + `markAssigned`; rule có cả `from_wallet_id` và `wallet_id` thì dòng mang chuyển ví (`counter_wallet_id` = `from_wallet_id`, `wallet_id` = `wallet_id` của rule) — ví dụ bỏ heo đất: `mb-main-husband` → `piggy-husband`, Có thì tốt → Tích sản (ADR-82: tiền bỏ heo là Tích sản tiền mặt nằm ở tài khoản khóa). Ghi thẳng bằng `logTxStmt`, không qua `buildEntry`;
     - rule không mang ví mà tài khoản đầu kia là tài khoản Tích sản (phao, sổ tiết kiệm — ADR-88) → chuyển ví Có thì tốt → Tích sản như 2a;
     - không có → tìm TK tiền mặt (`cashAccountFor`: TK `cash` `active` của `by_member_id` rule, không có thì của chủ TK nguồn) → batch: `transfer` TK log → TK tiền mặt + `markAssigned`, không chuyển ví.
4. **Còn lại: giữ `pending`** (mặc định lúc ghi). Không báo trong request; lượt cron kế tiếp (mỗi 15 phút, đêm mỗi giờ) báo khi log đã chờ ≥ 60 giây, ngoài giờ yên lặng (notify UC-407) để chân thứ hai của chuyển nội bộ kịp về.

Mọi giao dịch sinh ở đây có `source='sepay'`, `week_key`/`month_key` tính từ `at`.

## Alternative Flows
- 1a/2a/3a. Batch bị trigger huỷ (`log_not_pending` / `order_not_pending`: request khác vừa xử lý đúng log/lệnh này) → `commit` trả `false`, không ghi gì, dừng; log giữ nguyên trạng thái do request kia đặt.
- 3.0a. Log `out` của tài khoản để "chỉ tiền vào" (`sepay_out = 0`, hoặc chưa nối SePay) không khớp memo PF hay ghép cặp → **không** tự gán theo rule (kể cả rule `spend` đủ danh mục, rule `transfer`); giữ `pending`. Màn Gán gợi ý theo rule khớp kèm lời nhắc "có thể đã nhập tay" (UC-305 bước 2b). Không bao giờ bỏ log.
- 3.1a. Mẫu lương nhưng `amount < salary_min_amount` → không khớp nhánh nào → `pending` (hỏi như mọi tiền vào).
- 3.1b. Log `in` chỉ khớp rule người thuê (`tenant_id`) → không nhánh nào khớp → `pending`; màn Gán gợi ý "Thu từ <tên>" để người xác nhận (UC-305, ADR-60).
- 3.2a. Rule `spend` thiếu `category_id` → `pending`; màn Gán gợi ý ví (UC-305).
- 3.3a. Rule `transfer` không có tài khoản đầu kia và không tìm được TK tiền mặt → `pending`.
- 3.3b. Rule `transfer` có tài khoản đầu kia mà ngày VN của log (`dayKey(log.at)`) trước `opened_at` của tài khoản đó (ADR-76 — số dư đầu của nó đã gồm khoản này) → không tự gán, `pending`.

## Exceptions
- E1. Lỗi không phải trigger chống trùng trong `commit`, hoặc lỗi chia lương khác `already_allocated` → ném ra; UC-302 bắt và ghi `ingest_error`.

## Acceptance Criteria
### AC-1: Thứ tự ưu tiên — mã rule đứng sau memo PF và ghép cặp; trong rule, `code` thắng `content`
- Given nội dung vừa có mã `EAN` vừa có `XANG`, rule `content XANG` priority nhỏ hơn
- Then rule `code EAN` thắng
- Tests: `test/rules.test.ts` › "matchRule › khớp mã chính xác trước, rồi mới tới từ khoá nội dung"
- ⚠ Chưa có test đầu-cuối khẳng định log vừa khớp memo PF vừa khớp rule (hoặc vừa ghép cặp được vừa khớp rule) đi đúng nhánh trước.

### AC-2: Chân đầu của lệnh chuyển về → lệnh `done`, sinh một transfer đúng TK
- Given lệnh `PF K7Q3F2` 1.200.000 `vcb-husband` → `tcb-husband` đang `pending`
- When log `out` 1.200.000 ở `vcb-husband` nội dung "PF K7Q3F2 chia luong"
- Then lệnh `done`, `matched_log_id='L1'`; 1 `transfer` `vcb-husband`→`tcb-husband`, `batch_id='A999'`, `log_id_2` NULL
- Tests: `test/ingest.test.ts` › "ingestLog: khớp lệnh chuyển tiền qua nội dung 'PF <mã lệnh>' › chân đầu tiên về khớp ngay: lệnh chuyển thành done, sinh transfer đúng account"

### AC-3: Chân thứ hai gắn vào đúng giao dịch, không đếm hai lần
- Given chân ra đã khớp lệnh
- When chân vào cùng memo về ở TK đích
- Then vẫn 1 giao dịch của lệnh, `log_id='L1'`, `log_id_2='L2'`, L2 `assigned`; khi một lần chia có hai lệnh, chân thứ hai gắn vào giao dịch của đúng lệnh mình
- Tests: `test/ingest.test.ts` › "ingestLog: khớp lệnh chuyển tiền qua nội dung 'PF <mã lệnh>' › chân thứ hai về sau: gắn log_id_2 vào ĐÚNG giao dịch đã tạo, không sinh giao dịch mới"; `test/ingest-integrity.test.ts` › "lệnh chuyển tiền › một lần chia có hai lệnh: chân thứ hai gắn đúng giao dịch của lệnh mình"

### AC-4: Memo đoán được không hoàn tất lệnh
- Given lệnh memo `PF H4K8M2`
- When người ngoài chuyển vào đúng số tiền với nội dung `PF A12`
- Then lệnh vẫn `pending`
- Tests: `test/ingest-integrity.test.ts` › "lệnh chuyển tiền › người ngoài chuyển tiền vào với mã kiểu cũ đoán được không làm lệnh thành 'đã chuyển'"; `test/rules.test.ts` › "extractTransferMemo › mã kiểu cũ đoán được (PF A12, PF S202609) không còn là mã lệnh"

### AC-5: Chân đầu bị gỡ trước khi chân sau về → ghép lại cả hai, không log mồ côi
- Tests: `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › gỡ gán chân đầu của lệnh chuyển trước khi chân sau về → chân sau ghép lại cả hai, không log nào mồ côi"

### AC-6: Chuyển giữa hai TK của hộ → một transfer, không sinh thu nhập
- Given log `out` 2.000.000 `vcb-husband` lúc T, log `in` 2.000.000 `tcb-husband` lúc T+5'
- Then 1 `transfer` `vcb-husband`→`tcb-husband`, cả hai log `assigned`; tương tự vợ → chồng (`vcb-wife`→`vcb-husband`, lệch 3')
- Tests: `test/ingest.test.ts` › "ingestLog: ghép cặp chuyển khoản nội bộ (4 tình huống) › chuyển giữa 2 TK của cùng một người → 1 transfer, không sinh thu nhập"; "… › vợ chuyển cho chồng → ghép thành transfer giữa 2 TK của hộ"

### AC-7: Điều kiện ghép cặp
- Then chỉ ghép khi khác TK, ngược hướng, cùng số tiền, lệch ≤ 10 phút (11 phút thì không)
- Tests: `test/rules.test.ts` › "canPair › ghép khi ngược hướng, cùng số tiền, khác tài khoản, lệch ≤ 10 phút"; "canPair › không ghép nếu cùng tài khoản, cùng hướng, khác số tiền, hoặc lệch quá 10 phút"

### AC-8: Rủi ro đã chấp nhận — trùng số tiền ngẫu nhiên bị ghép nhầm, gỡ được
- Given chồng trả quán 300.000 lúc T, vợ nhận 300.000 từ khách lúc T+2'
- Then bị ghép thành 1 transfer; gỡ (UC-306) → transfer `void`, hai log `pending`
- Tests: `test/ingest.test.ts` › "ingestLog: ghép cặp chuyển khoản nội bộ (4 tình huống) › trùng số tiền ngẫu nhiên giữa hai người không liên quan → vẫn bị ghép nhầm (rủi ro đã biết), gỡ được bằng huỷ"

### AC-9: Tiền vào không rõ nguồn luôn phải hỏi
- Given log `in` 777.000 không có chân đối ứng, không khớp mẫu lương
- Then 0 giao dịch, log `pending`
- Tests: `test/ingest.test.ts` › "ingestLog: ghép cặp chuyển khoản nội bộ (4 tình huống) › khách chuyển tiền thật (không có chân ra đối ứng) → vẫn pending, không tự đoán thu nhập"; `test/rules.test.ts` › "matchRule › rule income chỉ khớp khi hướng là 'in' và is_salary=1"; "matchRule › rule spend/transfer không bao giờ khớp khi hướng là 'in'"

### AC-10: Lương đủ ngưỡng tự ghi và chia đúng một lần; lương giả nhỏ nằm chờ
- Given rule `LUONG THANG` (is_salary)
- When log `in` 40.000.000 "LUONG THANG 9" → `income` `taxable=0`, ví `income`, `counter_account_id='vcb-husband'`, 1 `allocation_runs`, tổng `fund` = 40.000.000
- When log `in` 1.000 cùng nội dung → `pending`, 0 giao dịch; nâng `salary_min_amount` lên 50.000.000 thì 30.000.000 cũng `pending`; `0` tắt ngưỡng
- Tests: `test/ingest.test.ts` › "ingestLog: rule lương — chia đúng một lần dù webhook gửi lại › tạo income taxable=0 rồi chia ngay; gửi lại cùng id không chia lần hai"; `test/ingest-integrity.test.ts` › "lương giả › người ngoài chuyển 1.000 ₫ nội dung 'LUONG THANG' → không tự ghi thu nhập, không tự chia; nằm chờ để hỏi"; "lương giả › lương thật (đủ ngưỡng) vẫn tự chia ngay; ngưỡng chỉnh được trong config"; "rà lại các bản sửa (reviewer cuối) › salary_min_amount = 0 thì bỏ ngưỡng"

### AC-11: Rule mã / từ khoá tự gán khoản chi
- Given mã `EAN` → spend ví `food`, danh mục `groceries`; nội dung có dấu "đổ xăng" → rule `XANG`; `ref_code` đã lưu được ưu tiên, không suy lại; nội dung nhiều khoảng trắng/tab vẫn khớp rule nhiều từ
- Tests: `test/ingest.test.ts` › "ingestLog: rule mã / từ khoá › mã EAN → spend vào ví food, danh mục groceries"; "… › từ khoá trên nội dung có dấu (đổ xăng) → nhận diện như mã EXE"; "… › khớp mã nhưng SePay đã đưa sẵn code khác vẫn ưu tiên ref_code đã lưu, không suy luận lại"; `test/ingest-integrity.test.ts` › "nội dung nhiều khoảng trắng › rule từ khoá vẫn khớp khi ngân hàng chèn nhiều khoảng trắng / tab"

### AC-12: Một giao dịch ngân hàng vào sổ nhiều nhất một lần (chốt ở DB)
- Given log đã `assigned`/`ignored`, hoặc chân thứ hai đã `assigned`, hoặc lệnh đã `done`
- When có lệnh ghi giao dịch trỏ tới log đó / gắn `log_id_2` / hoàn tất lệnh lần nữa
- Then DB ném `log_not_pending` / `order_not_pending`; lệnh trả về `pending` thì vẫn được
- Tests: `test/schema.test.ts` › "chốt chặn toàn vẹn ở tầng DB › không ghi được giao dịch cho log đã gán hoặc đã bỏ qua"; "… › chân thứ hai của cặp cũng phải đang chờ"; "… › lệnh chuyển tiền chỉ hoàn tất một lần, nhưng trả về chờ được"
- ⚠ Chưa có test đầu-cuối cho hai `matchLog` chạy chen trên cùng log (nhánh `commit` trả `false`).

### AC-13: Chân thứ hai về trong 60 giây → đã ghép trước khi cron báo
- Tests: `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › chuyển nội bộ 2 chân về cách nhau 20 giây → ghép cặp trước khi cron chạy, không có tin 'cần gán'"

### AC-14: Rule `transfer` không có tài khoản đầu kia (rút tiền mặt cố định) → transfer sang TK tiền mặt
- ⚠ Chưa có test (seed không có rule `transfer` nào thiếu tài khoản đầu kia; rule `transfer` duy nhất được seed là rule heo đất của migration 0017 — AC-18).

### AC-15: Mẫu lương mang nguồn thu → khoản thu tự ghi gắn nguồn, chia theo phần khóa của nguồn
- Given rule lương `LUONG THANG` có `income_stream_id = 'salary-wife'` (khóa Tích sản 45%)
- When log `in` 11.000.000 "LUONG THANG 9"
- Then `income` có `income_stream_id = 'salary-wife'`; fund vào `wealth-building` = 4.950.000
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule lương mang income_stream_id → khoản thu tự ghi gắn nguồn, chia theo phần khóa của nguồn"

### AC-16: Rule người thuê không bao giờ tự gán
- Given người thuê `an` và rule `content "AN CK"` `income` mang `tenant_id = 'an'`
- When log `in` 5.191.667 "AN CK TIEN NHA T10"
- Then log `pending`, 0 giao dịch; màn Gán gợi ý `{meaning:"income", tenant_id:"an", label:"Thu từ An"}`
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán"

### AC-17: Log tiền ra của tài khoản "chỉ tiền vào" không tự gán theo rule; tiền vào và ghép cặp vẫn như cũ (ADR-66)
- Given `mb-husband` nối SePay, `sepay_out = 0`; rule `code EAN` → spend ví `food`, danh mục `groceries`
- When log `out` 100.000 ở `mb-husband` mã `EAN`; log `in` 40.000.000 "LUONG THANG 9" ở `mb-husband`; log `out` 2.000.000 ở `mb-husband` rồi log `in` 2.000.000 ở `vcb-husband` 4 phút sau
- Then log `EAN` `pending`, 0 giao dịch; lương tự ghi `income` vào `mb-husband`, log `assigned`; cặp chuyển thành 1 `transfer` `mb-husband` → `vcb-husband`, `log_id_2` = chân vào
- Tests: `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền ra khớp rule chi → không tự gán, giữ pending; màn Gán gợi ý theo rule kèm lời nhắc có thể đã nhập tay"; `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền vào vẫn tự khớp rule lương như trước"; `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › chuyển nội bộ từ tài khoản chỉ-tiền-vào vẫn ghép cặp với chân tiền vào"

### AC-18: Rule chuyển nội bộ có tài khoản đầu kia → tự gán sang đúng tài khoản đó kèm chuyển ví, không phải chi tiêu (ADR-77, ADR-82)
- Given nhà như prod sau migration 0017 + 0019 + 0020; `mb-main-husband` nối SePay và báo cả tiền ra (`sepay_out = 1`)
- When log `out` 5.600 ở `mb-main-husband` nội dung "CHUYEN TIEN LE LAM TRON SAU GIAO DICH CHUYEN KHOAN VAO TAI KHOAN DANG GOM (TIET KIEM TIEN LE)"
- Then log `assigned`; 1 `transfer` 5.600 `account_id = mb-main-husband`, `counter_account_id = piggy-husband`, `counter_wallet_id = nice-to-have`, `wallet_id = wealth-building`, `category_id` NULL; `v_spent_raw` rỗng; ví `nice-to-have` = −5.600, Tích sản tiền mặt +5.600, phao +5.600; "còn để chi" chỉ đổi ở `nice-to-have`
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › tài khoản SePay báo cả tiền ra: tự gán chuyển nội bộ sang heo của chính chủ, ví Có thì tốt → Tích sản — không phải chi tiêu"

### AC-19: Rule gắn tài khoản chỉ áp cho log của tài khoản đó — mỗi người một con heo (ADR-77, ADR-82)
- Given `mb-spending-wife` nối SePay, báo cả tiền ra; rule heo của `mb-main-husband` (→ `piggy-husband`) và của `mb-spending-wife` (→ `piggy-wife`) cùng mẫu nội dung
- When log `out` 3.000 nội dung làm tròn ở `mb-spending-wife`
- Then 1 `transfer` `mb-spending-wife` → `piggy-wife`, ví → `wealth-building`, `by_member_id = wife`; rule của `mb-main-husband` không áp
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › mỗi người một con heo: log của tài khoản MB của vợ vào heo của vợ; rule của chồng không áp sang"

### AC-20: Log trước ngày mở sổ của tài khoản đầu kia không tự gán (ADR-76, ADR-77)
- Given `piggy-husband` mở sổ `2026-10-01`; `mb-main-husband` báo cả tiền ra, không có mốc
- When log `out` làm tròn 5.600 ở `mb-main-husband` lúc `2026-09-30T03:00Z`
- Then 0 giao dịch, log `pending`
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › log trước ngày mở sổ của heo không tự gán (số dư đầu đã gồm nó)"

### AC-21: Chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi, không ghi lần hai (ADR-81)
- Given `vcb-husband` thuộc kết nối `default`, `vcb-wife` thuộc kết nối `sepay-wife`; log `out` 250.000 ở `vcb-husband` lúc 11:20Z đã gán tay thành `transfer` `vcb-husband` → `vcb-wife` (`log_id_2` NULL)
- When log `in` 250.000 ở `vcb-wife` cùng lúc về qua `sepay-wife`
- Then vẫn 1 giao dịch `active`, `log_id` = chân ra, `log_id_2` = chân vào, chân vào `assigned`; `book_balance` `vcb-husband` −250.000, `vcb-wife` +250.000, `book_drift` 0 cả hai. Ngược lại (chân vào đã gán tay `transfer` từ `vcb-husband`, chân ra về sau 9 phút) cũng gắn: `log_id` = chân vào, `log_id_2` = chân ra
- And không gắn khi lệch số tiền (240.000), lệch quá 10 phút (11:30:01Z), đầu kia khác tài khoản (`tcb-husband`), hay giao dịch đã đủ hai chân — log `pending`
- Tests: [`test/ingest.test.ts`](../../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › chân ra đã gán tay, chân vào về sau qua kết nối khác → gắn vào đúng giao dịch đó; mỗi tài khoản đúng 250.000"; [`test/ingest.test.ts`](../../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › chân vào đã gán tay trước, chân ra về sau → cũng gắn, không ghi thêm"; [`test/ingest.test.ts`](../../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › lệch số tiền, lệch quá 10 phút, hay đầu kia khác tài khoản → không gắn: chờ gán, gán thì ghi giao dịch riêng"; [`test/ingest.test.ts`](../../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › giao dịch đã đủ hai chân thì không gắn thêm chân nào"

### AC-22: Ghép cặp hay rule vào tài khoản Tích sản mang chuyển ví Có thì tốt → Tích sản (ADR-88)
- Given DB seed, phao `phao` (`role: "buffer"`) nối SePay (`0999`, kết nối `default`)
- When log `out` 500.000 ở `vcb-husband` rồi log `in` 500.000 ở phao cùng lúc; rồi log `out` 200.000 ở phao và `in` 200.000 ở `vcb-husband`; rồi (`vcb-husband` báo cả tiền ra) rule `content` "GUI PHAO" `transfer` `vcb-husband` → phao không mang ví và log `out` "GUI PHAO THANG 10"
- Then cặp đầu: `transfer` `vcb-husband` → phao, `wallet_id = wealth-building`, `counter_wallet_id = nice-to-have`; cặp sau (phao → `vcb-husband`) không ví; log rule tự gán `vcb-husband` → phao kèm Có thì tốt → Tích sản
- Tests: [`test/buffer.test.ts`](../../test/buffer.test.ts) › "tự khớp vào tài khoản Tích sản (ADR-88) › ghép cặp hai log VCB → phao: chuyển nội bộ mang ví Có thì tốt → Tích sản; phao → VCB chỉ đổi chỗ"; [`test/buffer.test.ts`](../../test/buffer.test.ts) › "tự khớp vào tài khoản Tích sản (ADR-88) › rule chuyển nội bộ sang phao không mang ví: tự gán cũng chuyển ví Có thì tốt → Tích sản"

## Traceability
- Code: `src/services/ingest.ts` › `matchLog`, `pairLogs`, `findSingleLegTransfer`, `attachSecondLeg`, `outNotFed`, `commit`, `logTxStmt`, `markAssigned`, `loadRuleRows`, `LoadedRule`, `cashAccountFor`; `src/domain/rules.ts` › `extractTransferMemo`, `normalizeContent`, `matchRule`, `canPair`, `PAIR_WINDOW_MS`; `src/domain/entry.ts` › `wealthBuildingMove`, `isWealthBuildingDeposit` (ADR-88); `src/services/ledger.ts` › `salaryMinAmount`, `allocateIncome`, `loadRefs`
- Migrations/DB: triggers `trg_tx_needs_pending_log`, `trg_tx_second_leg_needs_pending_log`, `trg_transfer_order_settles_once` (`migrations/0005_ingest_integrity_guards.sql`); `transfer_orders`; `rules` CHECK; `rules.income_stream_id`, `rules.tenant_id`, `transactions.income_stream_id` (`migrations/0007_income_streams_rental.sql`); `accounts.sepay_out` (`migrations/0010_bank_catalog.sql`); `rules.account_id`, `rules.counter_account_id`, `rules.from_wallet_id`, rule heo đất (`migrations/0017_heo_dat.sql`, mẫu `TICH LUY` ở `migrations/0019_heo_settlement_rule.sql`, ví đích Tích sản ở `migrations/0020_heo_tich_san.sql`)

## Divergences & Open Questions
- [DIVERGENCE] `docs/core_design_rules.md` §6 và `phase-04-ingest-sepay.md` §Luồng tách bước 2 "tài khoản đối ứng thuộc `accounts` của hộ" khỏi bước 3 "log ngược hướng, cùng tiền, ≤10 phút"; code gộp làm một (`src/domain/rules.ts` › `canPair` doc-comment) vì payload SePay không có trường TK đối ứng (`fullstack-developer-260922-0020-sepay-ingest.md` §2, câu hỏi mở 4).
- [DIVERGENCE] `migrations/0001_schema.sql` chú thích `transfer_orders.memo` là `'PF <batch_id>'`; code/`docs/core_design_rules.md` §4 dùng `PF` + mã ngẫu nhiên riêng từng lệnh (`8ef7a99`).
- [DIVERGENCE] `phase-04-ingest-sepay.md` bước 4 cho phép rule khớp → `spend | transfer` "kèm category"; seed 0002/0004 không có rule `transfer`; migration 0017 chỉ seed rule `transfer` có tài khoản đầu kia (heo đất, ADR-77). Rule `transfer` không có tài khoản đầu kia vẫn chỉ đi tới TK tiền mặt của thành viên — không phải mọi `transfer` nội bộ.
- [OPEN] Khi nhiều log ứng viên cùng thoả `canPair`, câu truy vấn không có `ORDER BY` → không xác định log nào được chọn.
- [OPEN] Red team `redteam-260922-0100-offline-ingest-robustness.md` Phát hiện 1 (CÒN MỞ): mã `[QE]xx` bắt ở bất kỳ đâu trong nội dung (ví dụ "EMS" bưu điện, "QUA") → tự gán sai danh mục, không vào hàng chờ. `extractCode` chỉ lấy mã **đầu tiên** khớp regex, nên một từ `QUA` đứng trước `EAN` sẽ che mã thật.
- [OPEN] Tin sáng liệt kê "đã tự ghép N cặp" dựa vào `log_id_2 IS NOT NULL` (notify UC-402); giao dịch PF mới có một chân (`log_id_2` NULL) không được đếm là cặp.
- [OPEN] Nhánh 3.1 ghi thẳng bằng `logTxStmt`, không qua `buildEntry`, nên không kiểm nguồn thu của rule còn `active`: nguồn đã tắt vẫn được gắn vào khoản thu tự ghi và `allocateIncome` vẫn chia theo phần khóa của nó (`loadRefs` nạp cả nguồn đã tắt). Nhập tay/gán tay thì bị chặn `inactive_income_stream`. Không có test.
- [OPEN] Tài khoản để "chỉ tiền vào" mà SePay thật ra có báo tiền ra: khoản chi đã nhập tay và log `out` cùng khoản đều tồn tại; app chỉ nhắc ở màn Gán (UC-305), không chặn người gán tiếp — gán thì đếm hai lần, `book_drift` không thấy (nó không so bút toán nhập tay). Chủ nhà cần bật "SePay báo cả tiền ra" ngay khi thấy lời nhắc này (ADR-66).
- [OPEN] Nhánh 3.3 có tài khoản đầu kia ghi thẳng bằng `logTxStmt`, không qua `buildEntry`: không kiểm tài khoản đầu kia hay hai ví của rule còn `active` (`loadRuleRows` nối `accounts` không lọc `active`), không áp chặn `locked_wallet`. Rule loại này hiện chỉ tạo được bằng migration (ADR-77). Không có test.
