# UC-402: Tin sáng (giờ nhắc, mặc định 07:00)
- Status: implemented
- BR: BR-01, BR-04, BR-06, BR-07
- Decisions: D2 (10/25 chỉ nhắc), D3 (chốt tháng), D11 (rà soát 02:00); ADR-68 (giờ nhắc chỉnh trong app); `docs/core_design_rules.md` §8 (dòng "7:00 sáng", "Vượt ngân sách: chỉ hiện mục ≥ 80%"), §7 ("Lệch ≠ 0 → … nhắc Telegram sáng hôm sau"); `docs/DESIGN.md` §5 (tiền, kỳ), §6 (giọng chữ); commits `a954744`, `eb7846e`; ADR-61 (chốt tay mỗi tháng với người thuê — tin sáng chỉ nhắc); ADR-71 (sổ nợ — dòng 💳); ADR-72 (sổ phải thu — dòng 🤝); ADR-78 (rà soát ba lớp — dòng 🩹 ghi rõ lượt soát tuần/tháng); ADR-79 (hai bản: ngắn cho thông báo đẩy, đầy đủ cho Telegram; việc cần làm trước); ADR-92 (tên trong code tiếng Anh); ADR-93 (Quỹ an tâm)
- Actor: lượt cron (UC-401: mỗi 15 phút, 01:00–03:59 VN mỗi giờ) từ giờ tin sáng `notify_daily_time` (mặc định 07:00 VN), khi `notify_daily_enabled` bật; người nhận: mọi thành viên đang hoạt động có `tg_chat_id`
- Trigger: `runScheduledDigests` giành được mốc `daily_run` của hôm nay → `src/cron/daily.ts` › `daily(env, now)`

## History
- v1 (2026-09-22, commit `13e89cc`): tin sáng đầy đủ các dòng 💰 ⚠️ 📥 🎯 🏦 🔁 🔗 🩹 (+ 🧹 ngày 1, 📅 ngày 10/25, 🧮 Chủ nhật); formatter thuần `src/notify/format.ts`.
- v2 (2026-09-22, commit `a954744`): thêm dòng ❗ — payload ngân hàng không đọc được trong 24 giờ qua (trước đó bị bỏ lặng lẽ).
- v3 (2026-09-22, commit `eb7846e`): dòng ❗ đổi nghĩa thành "cần xem tay": gồm cả giao dịch đã ghi nhưng xử lý tiếp bị lỗi (ví dụ lương chưa chia) — theo `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md`.
- (commits `c3ab508`, `b8e8f0c` chỉ chỉnh bối cảnh test: tài khoản có bank feed không nhận nhập tay, D14.)
- v4 (2026-10-01, commit `034b7ff`): ngày 1 thêm dòng 🏠 nhắc chốt tháng trước với từng người thuê đang ở mà chưa chốt, kèm số dư (change `261001-cho-thue-lai`).
- v5 (2026-10-01, commit `a301077`): giờ gửi lấy từ Cài đặt › Thông báo › Giờ nhắc (`notify_daily_time`, mặc định 07:00, bội số 5 phút) thay cho cron cố định `0 0 * * *`; tắt được (`notify_daily_enabled`); một lần mỗi ngày nhờ mốc `daily_run` (UC-401, ADR-68).
- v6 (2026-10-01, commit `e72b5de`): lượt cron mỗi 15 phút (01:00–03:59 VN mỗi giờ), giờ tin sáng là bội số 15 phút; giờ trong 01:00–03:59 gửi ở lượt mỗi giờ kế tiếp (ADR-70).
- v7 (2026-10-01, commit `25db5b9`): thêm dòng `💳 Còn nợ X (N khoản)` sau 🎯 khi tổng còn nợ > 0 (sổ nợ, debt [UC-901](../debt/UC-901-them-va-xem-khoan-no.md), ADR-71); hết nợ thì không có dòng.
- v8 (2026-10-01, commit `2438ac0`): thêm dòng `🤝 Người khác nợ mình X (N khoản)` ngay sau 💳 khi tổng còn phải thu > 0 (sổ phải thu, receivable [UC-1001](../receivable/UC-1001-them-va-xem-khoan-phai-thu.md), ADR-72); không còn ai nợ thì không có dòng.
- v9 (2026-10-03, commit `d44390e`): dòng 🩹 ghi rõ lượt rà soát rộng (ADR-78, ingest [UC-304](../ingest/UC-304-ra-soat-0200-backfill.md)): payload dòng `backfill` có thêm `scope`; `week` (thứ Hai) → thêm " (soát lại cả tuần trước)", `month` (ngày 1) → " (soát lại cả tháng trước)"; `day` hoặc dòng cũ không có `scope` → chữ như cũ.
- v10 (2026-10-03, commit `4e6d103`): tin dựng **hai bản** (ADR-79). Bản đầy đủ (Telegram) xếp lại: 💰, rồi các dòng việc cần làm (📥 ❗ 🔁 ⚠️ 📅 🧮 🏠 🧹/🔁), rồi các dòng thông tin (🎯 💳 🤝 🏦 🔗 🩹); dòng ❗ rút còn "❗ N giao dịch ngân hàng cần xem tay". Bản ngắn (thông báo đẩy): tiêu đề "Còn X tuần này", nội dung là việc cần làm rồi chỗ lệch đối soát, ≤ 150 ký tự. AC-4, AC-12, AC-13, AC-17 sửa; thêm AC-25…AC-28.
- v11 (2026-10-03, commit `e91b68f`): "còn để chi" âm không còn viết "Còn … −X" (dễ đọc nhầm): bản đầy đủ "💰 Tuần này đã chi vượt X (còn N ngày)", bản ngắn tiêu đề "Tuần này vượt X" (dự phòng "Vượt X"). Cùng luật với hero PWA (pwa UC-702 v9). Thêm AC-29.
- v12 (2026-10-06, commit `9c265ee`): **bỏ số lũy kế SePay** (ADR-87, change [`261006-bo-luy-ke-sepay`](../changes/archive/261006-bo-luy-ke-sepay/proposal.md)) — chủ nhà: "bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè". 🏦 Đối soát chỉ còn `bookDrift ≠ 0` (sổ khác giao dịch ngân hàng đã gán); AC-8 viết lại theo lệch sổ.
- v13 (2026-10-07, commit `7424f26`): chip 🎯 "Phao x/y tháng" thành "Quỹ an tâm x/y tháng" (ADR-93 — "khẩn cấp" mang nghĩa tai hoạ; hết trùng chữ với tài khoản phao dự phòng); số đọc từ `snapshot.safetyFund` (trước là `emergency`), N = `config.safety_fund_months`, view `v_safety_fund`; trường `DailyMessageInput` thành `safetyFundMonthsCovered`, `safetyFundMonthsTarget`; push tin sáng mở `/#today` (ADR-92). AC-3, AC-5, AC-25, AC-28 sửa chữ theo (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).

## Preconditions
- Có bot token (`telegram_bot_token`, UC-508) và ≥ 1 thành viên có `tg_chat_id` — nếu không, tin được dựng nhưng không ai nhận (UC-408).

## Main Flow
0. Lượt cron gọi `daily` khi tới giờ tin sáng và hôm nay chưa chạy (UC-401 bước 3c). Giờ trong 01:00–03:59 chạy ở lượt mỗi giờ kế tiếp. Đổi giờ sau khi hôm nay đã gửi thì mai mới áp dụng. Tắt tin sáng thì không gọi `daily`; ngày 1 vẫn chốt tháng (UC-403).
1. `today = dayKey(now)` theo giờ VN; `dayOfMonth` = ngày trong `today`.
2. Nếu `dayOfMonth = 1`: chốt tháng trước **trước khi** dựng tin (UC-403).
3. `snapshot = getSnapshot(db, null, now)` (UC-103) — **người xem = null**: ví `private` của từng người bị ẩn số (`src/domain/snapshot.ts` › `hidden`), nên không góp vào "còn để chi" hay "sắp vỡ" của tin gửi chung.
4. Tính các dòng:
   - **💰 Còn để chi tuần này** = `snapshot.spendableThisWeek`; số ngày = `8 − thứ ISO (VN)` (tính cả hôm nay). Âm → **"💰 Tuần này đã chi vượt X (còn N ngày)"** với X là số dương; tiêu đề bản ngắn "Tuần này vượt X".
   - **⚠️ Sắp vỡ**: ví `kind='envelope'`, `tier ∈ {must, nice}`; % = `spentWeek/weekTarget` nếu `weekTarget > 0`, không thì `spentMonth/monthTarget` nếu `monthTarget > 0`; giữ % ≥ 80 (so trên số chưa làm tròn), sắp % giảm dần.
   - **📥 N giao dịch chưa gán** = `snapshot.attention.pendingLogs` (mọi `bank_logs` `pending`, không giới hạn tuổi).
   - **🎯** = các ví mục tiêu có `pct ≠ null` (`snapshot.goals`) + "Quỹ an tâm X,Y/N tháng" nếu `snapshot.safetyFund.monthsCovered ≠ null` (N = `snapshot.safetyFund.months` = `config.safety_fund_months`, UC-507). Luôn hiện khi có dữ liệu, kể cả 0% — không phải dòng cảnh báo.
   - **💳 Còn nợ X (N khoản)**: một câu đọc `v_debt_balance` các khoản đang bật (`active = 1`) có `balance > 0` — X = tổng `balance`, N = số khoản (debt [UC-901](../debt/UC-901-them-va-xem-khoan-no.md)). X = 0 thì không có dòng. Khoản đã tắt hay đã trả xong không được tính.
   - **🤝 Người khác nợ mình X (N khoản)**: một câu đọc `v_receivable_balance` các khoản đang bật (`active = 1`) có `balance > 0` — X = tổng `balance`, N = số khoản (receivable [UC-1001](../receivable/UC-1001-them-va-xem-khoan-phai-thu.md)). X = 0 thì không có dòng. Đây là ghi nhớ ai nợ ai, không cộng vào 💰.
   - **🏦 Đối soát**: từ `reconcile(db)` (UC-106); tài khoản lệch khi `bookDrift ≠ 0` (sổ khác giao dịch ngân hàng đã gán — không có số ngân hàng báo, ADR-87); số hiển thị = **trị tuyệt đối** của `bookDrift` (tin không nói lệch lên hay xuống).
   - **🔁 N chuyển tiền cần làm (quá 3 ngày)** = `snapshot.attention.transferOrdersOverdue`: `transfer_orders` `pending` có `created_at < datetime('now','-3 days')` (UC-205).
   - **🔗 Hôm qua tự ghép N cặp chuyển nội bộ**: `transactions` `active`, `meaning='transfer'`, `log_id_2 IS NOT NULL`, lọc thô `at >= now − 2 ngày` rồi giữ những dòng có `dayKey(at)` = ngày VN hôm qua (theo thời điểm giao dịch, không theo lúc ghi sổ).
   - **🩹 Đêm qua vá N giao dịch webhook bỏ sót** (+ " (soát lại cả tuần trước)" khi `scope='week'`, " (soát lại cả tháng trước)" khi `scope='month'`): N = `payload.added`, `scope` = `payload.scope` của `notifications(kind='backfill', day_key=today)` (UC-304 ghi, ADR-78); không có dòng → 0. `scope='day'` hoặc thiếu `scope` → không thêm gì.
   - **❗ N giao dịch ngân hàng cần xem tay**: `COUNT(*)` của `notifications(kind='ingest_error')` có `at >= datetime('now','-1 day')` (UC-308 ghi). Chi tiết (không đọc được, hay đã ghi nhưng xử lý tiếp bị lỗi) xem ở app ngân hàng / màn Gán; dòng không giải thích thêm để gọn.
   - Ngày 10/25: dòng 📅 (UC-405). Chủ nhật: dòng 🧮 (UC-404).
   - **🏠 Chốt tháng với <tên> (số dư <tiền>)** — chỉ ngày 1: `unsettledTenants(db, previousMonth(monthKey(now)))` = người thuê `active = 1` chưa có `tenant_settlements` cho tháng trước, xếp theo tên; mỗi người một dòng, số dư hiện tại từ `v_tenant_balance` (dương = còn nợ, âm = trả dư). Chỉ nhắc — chốt tay trên PWA (rental [UC-804](../rental/UC-804-chot-thang-voi-nguoi-thue.md)).
5. `dailyMessage(input)` dựng **hai bản** `{ full, push }` (ADR-79); `notifyMembers(env, "daily", today, message)` gửi `full` qua Telegram và `push` tới từng máy đã bật (UC-408, UC-410).

### Luật định dạng (`src/notify/format.ts`)
- Thứ tự dòng cố định — 💰, rồi **việc cần làm**: 📥 → ❗ → 🔁 (quá hạn) → ⚠️ → 📅 (ngày 10/25) → 🧮 (Chủ nhật) → 🏠 (ngày 1) → 🧹/🔁 (ngày 1); rồi **thông tin**: 🎯 → 💳 → 🤝 → 🏦 → 🔗 → 🩹. Chỉ 💰 và 🏦 luôn có; mọi dòng khác chỉ hiện khi số > 0 / danh sách khác rỗng.
- Tiền: `formatMoney` — nhóm nghìn kiểu `vi-VN` (`1.250.000 ₫`), `₫` sau số cách một khoảng, số âm dùng dấu `−` U+2212, không rút gọn (`DESIGN.md` §5).
- Phần trăm: làm tròn số nguyên (`92%`). Quỹ an tâm: số tháng một chữ số thập phân, dấu phẩy (`3,2`).
- Mục trong cùng dòng nối bằng ` · `. Mọi tên ví/tài khoản/danh mục của bản đầy đủ đi qua `escapeHtml` (`&`, `<`, `>`) vì tin gửi `parse_mode=HTML`; bản ngắn giữ chữ thật.

### Bản ngắn (thông báo đẩy, ADR-79)
- Tiêu đề: `Còn <tiền> tuần này`; dài quá 25 ký tự thì `Còn <tiền>`.
- Nội dung: các mục việc cần làm theo đúng thứ tự trên — `<N> chưa gán` · `<N> cần xem tay` · `<N> chuyển tiền quá hạn` · mỗi ví sắp vỡ `<tên> <pct>%` · `còn <N> khoản thu chưa chia` · `đếm ví tiền mặt` · `chốt tháng <tên>, <tên>` · `quét <tiền> dư tháng <m>` (+ ` (<k> lệnh chuyển)` khi có lệnh) — rồi mỗi tài khoản lệch `lệch <tiền> ở <tên>`; nối bằng ` · `, chữ đầu viết hoa. Không có mục nào → `Không có việc cần làm · đối soát khớp`. Mục tiêu, phao, nợ, phải thu, tự ghép, vá đêm không lên bản ngắn.
- Tối đa 150 ký tự (đếm theo ký tự, không theo byte): không vừa thì bỏ mục từ cuối lên và thêm ` …`; một mục dài hơn cả 150 thì cắt giữa chừng, kết thúc bằng `…`. Không emoji, không HTML.
- Giọng chữ: không xưng hô, không chấm than (`DESIGN.md` §6, chú thích đầu `format.ts`).

## Alternative Flows
- 2a. Ngày 1 nhưng quét được 0 ₫ (hoặc tháng đã chốt từ trước) → không có dòng 🧹 (UC-403).
- 5a. Đã có dòng `notifications(daily, today, chat_id)` cho người nhận → bỏ qua người đó (chống trùng, UC-408).

## Exceptions
- E1. Chưa có bot token → `notifyMembers` trả 0, không ghi `notifications`; các tác dụng phụ trước đó (chốt tháng) vẫn đã xảy ra. Không có lần gửi bù trong ngày.
- E2. Telegram từ chối/hỏng sau 3 lượt → `ok=0`, tin ngày đó mất với người nhận ấy (UC-408 E2).

## Acceptance Criteria
### AC-1: Mỗi người nhận đúng một tin mỗi ngày
- Given hai thành viên có `tg_chat_id` `111`, `222`
- When `daily` chạy lúc 07:00 VN rồi chạy lại cùng ngày
- Then Telegram được gọi đúng 2 lần, cùng nội dung; có 2 dòng `notifications(kind='daily', day_key='2026-09-22')`; lần chạy lại không gửi thêm
- Tests: `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › gửi đúng 2 người có tg_chat_id, cùng nội dung; chạy lại trong ngày không gửi thêm"

### AC-2: Thành viên không có chat_id không nhận tin
- Given `wife` có `tg_chat_id = NULL`
- When `daily` chạy
- Then chỉ chat `111` nhận
- Tests: `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › thành viên không có tg_chat_id thì không nhận tin"

### AC-3: Tin với dữ liệu seed chưa chia lương
- Given DB seed, chưa có income, thứ Ba
- When `daily` chạy
- Then tin đúng 3 dòng: `💰 Còn để chi tuần này: 0 ₫ (6 ngày)`, `🎯 Du lịch 0% · Quỹ an tâm 0,0/6 tháng`, `🏦 Đối soát: khớp`
- Tests: `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › chưa chia lương: còn để chi = 0, tiến độ quỹ/phao ban đầu vẫn hiện, đối soát khớp"

### AC-4: Thứ tự và câu chữ đầy đủ: việc cần làm trước, thông tin sau
- Given input có mọi mục cảnh báo
- When `dailyMessage`
- Then bản đầy đủ đúng 9 dòng theo thứ tự 💰 📥 🔁 ⚠️ 📅 🎯 🏦 🔗 🩹 với câu chữ như test; với mọi mục bật cùng lúc, thứ tự là 💰 📥 ❗ 🔁 ⚠️ 📅 🧮 🏠 🧹 🔁 🎯 💳 🤝 🏦 🔗 🩹 và tin dưới 4096 ký tự
- Tests: `test/format.test.ts` › "dailyMessage › đủ mọi mục: dòng 💰, rồi việc cần làm, rồi thông tin; đúng câu chữ"; `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › tin dài nhất: tiêu đề ≤ 25, nội dung ≤ 150; cắt từ cuối, giữ việc đứng đầu, kết thúc bằng …"

### AC-5: Không có gì để báo → tin 2 dòng
- Given không cảnh báo, không mục tiêu, Quỹ an tâm `null`
- When `dailyMessage`
- Then chỉ còn dòng 💰 và `🏦 Đối soát: khớp`
- Tests: `test/format.test.ts` › "dailyMessage › không có gì cảnh báo → tin ngắn đúng 2 dòng"

### AC-6: Sắp vỡ ≥ 80%, sắp giảm dần
- Given Ăn uống tiêu 550.000/625.000 ₫ tuần này (88%)
- When `daily` chạy
- Then tin có `⚠️ Sắp vỡ: Ăn uống 88%`; nhiều ví thì giữ thứ tự % giảm dần do cron sắp
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › ví sắp vỡ ≥80% dự kiến tuần"; `test/format.test.ts` › "dailyMessage › atRisk đã sắp theo % giảm dần được giữ nguyên thứ tự truyền vào (cron chịu trách nhiệm sắp)"

### AC-7: Chưa gán đếm từ bank_logs pending
- Given 3 `bank_logs` `pending`
- Then tin có `📥 3 giao dịch chưa gán`
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › giao dịch chưa gán đếm từ bank_logs pending"

### AC-8: Đối soát lệch lấy từ reconcile
- Given log `out` 300.000 ₫ của `vcb-wife` đã gán mà giao dịch sinh từ log chỉ 250.000 ₫
- Then tin có `🏦 Đối soát: ❌ lệch 50.000 ₫ ở VCB (vợ)`
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › đối soát lệch dùng ledger.reconcile(): sổ diễn giải khác giao dịch ngân hàng đã gán"

### AC-9: Chuyển tiền cần làm quá 3 ngày
- Given một `transfer_orders` `pending` tạo từ năm 2000
- Then tin có `🔁 1 chuyển tiền cần làm (quá 3 ngày)`
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › lệnh chuyển tiền quá hạn 3 ngày"

### AC-10: Ghép cặp hôm qua theo thời điểm giao dịch
- Given một `transfer` có `log_id_2`, `at` = 12:00 VN hôm qua
- Then tin có `🔗 Hôm qua tự ghép 1 cặp chuyển nội bộ`
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › hôm qua tự ghép cặp chuyển nội bộ (theo `at`, không phải lúc ghi sổ)"

### AC-11: Đêm qua vá; lượt soát tuần/tháng ghi rõ
- Given `notifications(kind='backfill', day_key='2026-09-22', payload='{"added":3,"scope":"week"}')`
- When `daily` chạy ngày 2026-09-22
- Then tin có `🩹 Đêm qua vá 3 giao dịch webhook bỏ sót (soát lại cả tuần trước)`; với `scope='month'` là `… (soát lại cả tháng trước)`; với `scope='day'` hoặc không có `scope` là `🩹 Đêm qua vá 3 giao dịch webhook bỏ sót`
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › đêm qua backfill vá bao nhiêu lấy từ notifications(kind='backfill', day_key=hôm nay); lượt soát tuần ghi rõ"; không có `scope`: `test/format.test.ts` › "dailyMessage › đủ mọi mục: dòng 💰, rồi việc cần làm, rồi thông tin; đúng câu chữ" (nhánh `month`: ⚠ Chưa có test)

### AC-12: Giao dịch ngân hàng cần xem tay
- Given `unreadableBankTransactions = 2` / `0`
- Then có đúng dòng `❗ 2 giao dịch ngân hàng cần xem tay` / không có dòng nào chứa "cần xem tay"
- Tests: `test/format.test.ts` › "dòng giao dịch ngân hàng không đọc được › hiện khi có, và không hiện khi không có" (phần đếm `ingest_error` 24 giờ trong `daily`: ⚠ Chưa có test)

### AC-13: Tên được escape HTML ở bản đầy đủ, giữ chữ thật ở bản ngắn
- Given tên ví `Ăn <uống> & chơi`
- Then bản đầy đủ chứa `Ăn &lt;uống&gt; &amp; chơi 90%`, không chứa `<uống>`; nội dung bản ngắn là `Ăn <uống> & chơi 90%`
- Tests: `test/format.test.ts` › "dailyMessage › escape HTML trong tên ví/tài khoản vì tin gửi bằng parse_mode=HTML"

### AC-14: Định dạng tiền
- Given `1250000`, `0`, `820000`, `-50000`
- Then `1.250.000 ₫`, `0 ₫`, `820.000 ₫`, `−50.000 ₫` (dấu trừ U+2212)
- Tests: `test/format.test.ts` › "formatMoney: vi-VN, dấu trừ U+2212, không làm tròn › %d → %s"; "formatMoney: vi-VN, dấu trừ U+2212, không làm tròn › dấu trừ là U+2212, không phải gạch nối thường"

### AC-15: Ví private không lộ số trong tin gửi chung
- Given ví phong bì `private` của một thành viên
- When `daily` dựng tin (người xem = null)
- Then ví đó không góp vào "Còn để chi" và không xuất hiện ở "Sắp vỡ"
- Tests: ⚠ Chưa có test

### AC-16: Ngày 1 nhắc chốt tháng với người thuê chưa chốt
- Given người thuê đang ở chưa chốt tháng trước, một người đã chốt, một người đã ngừng
- When `daily` chạy ngày 1
- Then chỉ người chưa chốt có dòng `🏠 Chốt tháng với <tên> (số dư <tiền>)`; ngày thường không có dòng 🏠
- Tests: `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › nhắc chốt tháng với người thuê đang ở chưa chốt tháng trước; đã chốt hoặc đã ngừng thì không nhắc"; `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › ngày thường không nhắc chốt tháng người thuê"

### AC-17: Mỗi người thuê một dòng trong phần việc cần làm, số dư đúng dấu
- Given `rentalSettleReminder = [{ name: "An", balance: -80000 }, { name: "Bình", balance: 5111667 }]`
- When `dailyMessage`
- Then bản đầy đủ đúng bốn dòng `💰 …`, `🏠 Chốt tháng với An (số dư −80.000 ₫)`, `🏠 Chốt tháng với Bình (số dư 5.111.667 ₫)`, `🏦 Đối soát: khớp`
- Tests: `test/format.test.ts` › "dailyMessage › ngày 1: mỗi người thuê chưa chốt tháng trước một dòng nhắc kèm số dư"

### AC-18: Giờ mặc định 07:00, đúng một lần
- Given giờ nhắc mặc định (07:00, bật)
- When các lượt 06:45, 07:00, 07:15 cùng ngày (thứ Ba)
- Then 06:45 không gửi; 07:00 gửi mỗi người một tin; 07:15 không gửi thêm
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › mặc định 07:00: lượt 06:45 chưa gửi, lượt 07:00 gửi, lượt 07:15 không gửi lại"

### AC-19: Giờ tự chọn
- Given `notify_daily_time = '06:30'`
- When lượt 06:15 rồi 06:30
- Then 06:15 không gửi; 06:30 gửi
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › giờ tự chọn 06:30: lượt 06:15 chưa gửi, lượt 06:30 gửi"

### AC-20: Đổi giờ sau khi hôm nay đã gửi không gửi lại
- Given tin sáng đã gửi lúc 07:00
- When đổi giờ thành 06:00 (lượt 07:15) rồi 09:00 (lượt 09:00)
- Then không có tin sáng nào thêm trong ngày
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › đã gửi rồi mới đổi giờ (sớm hơn hay muộn hơn) thì hôm đó không gửi lại"

### AC-21: Tắt tin sáng thì không gửi, ngày thường không ghi mốc
- Given `notify_daily_enabled = '0'`
- When lượt 07:00 ngày 30/9 và các lượt ngày 1/10
- Then không có tin nào; ngày 30/9 không có dòng `daily_run` (ngày 1 xem UC-403 AC-5)
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › tắt tin sáng: không gửi gì, nhưng ngày 1 vẫn chốt tháng trước từ giờ tin sáng"

### AC-22: Giờ trong 01:00–04:00 gửi ở lượt mỗi giờ kế tiếp
- Given `notify_daily_time = '01:30'`
- When lượt mỗi giờ 01:00 rồi 02:00
- Then 01:00 không gửi; 02:00 gửi
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › giờ trong 01:00–04:00 chạy ở lượt mỗi giờ kế tiếp: 01:30 gửi lúc 02:00"

### AC-23: Tin sáng báo còn nợ; hết nợ thì không có dòng
- Given `debts = { balance: 15379000, count: 2 }`; hoặc `{ balance: 0, count: 0 }`
- When `dailyMessage` (không cảnh báo khác)
- Then tin đúng ba dòng `💰 Còn để chi tuần này: …`, `💳 Còn nợ 15.379.000 ₫ (2 khoản)`, `🏦 Đối soát: khớp`; hết nợ thì không có dòng 💳
- Tests: [`test/format.test.ts`](../../test/format.test.ts) › "dailyMessage › tin sáng báo còn nợ X (N khoản), hết nợ thì không có dòng"; phần đếm từ `v_debt_balance` trong `daily`: ⚠ Chưa có test

### AC-24: Tin sáng báo người khác nợ mình ngay sau dòng còn nợ; không còn ai nợ thì không có dòng
- Given `debts = { balance: 15379000, count: 2 }`, `receivables = { balance: 3000000, count: 1 }`; hoặc `receivables = { balance: 0, count: 0 }`
- When `dailyMessage` (không cảnh báo khác); và `daily` đọc DB có Em Hai còn 2.000.000, Chú Tư mở sổ 500.000 đã nhận lại 800.000, một khoản đã tắt 9.000.000
- Then tin đúng bốn dòng `💰 …`, `💳 Còn nợ 15.379.000 ₫ (2 khoản)`, `🤝 Người khác nợ mình 3.000.000 ₫ (1 khoản)`, `🏦 Đối soát: khớp`; hết thì không có 🤝; từ DB: `🤝 Người khác nợ mình 2.000.000 ₫ (1 khoản)` (khoản tắt và khoản trả dư không tính)
- Tests: [`test/format.test.ts`](../../test/format.test.ts) › "dailyMessage › tin sáng báo người khác nợ mình X (N khoản) ngay sau dòng còn nợ, không còn ai nợ thì không có dòng"; [`test/cron-daily.test.ts`](../../test/cron-daily.test.ts) › "các dòng lấy đúng số từ DB › người khác nợ mình: chỉ cộng khoản đang theo dõi còn phải thu > 0"

### AC-25: Bản ngắn khi không có việc cần làm
- Given không có mục việc cần làm; có mục tiêu, Quỹ an tâm, nợ, tự ghép, vá đêm; đối soát khớp / lệch 120.000 ₫ ở MB
- When `dailyMessage`
- Then `push = { title: "Còn 3.250.000 ₫ tuần này", body: "Không có việc cần làm · đối soát khớp" }` (thông tin không lên bản ngắn) / `body = "Lệch 120.000 ₫ ở MB"`
- Tests: `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › không có việc: tiêu đề còn để chi tuần này, nội dung báo không có việc và đối soát khớp; thông tin không lên"; `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › chỉ lệch đối soát: nội dung là chỗ lệch"

### AC-26: Bản ngắn xếp việc cần làm trước, chỗ lệch sau
- Given 3 chưa gán, 1 cần xem tay, 2 chuyển tiền quá hạn, Ăn uống 88%, ngày 10 còn 1 khoản thu chưa chia, lệch 5.000 ₫ ở MB; hoặc Chủ nhật đếm ví + ngày 1 chốt An + quét 4.640.000 ₫ có 1 lệnh chuyển
- When `dailyMessage`
- Then `body = "3 chưa gán · 1 cần xem tay · 2 chuyển tiền quá hạn · Ăn uống 88% · còn 1 khoản thu chưa chia · lệch 5.000 ₫ ở MB"`; `"Đếm ví tiền mặt · chốt tháng An · quét 4.640.000 ₫ dư tháng 9 (1 lệnh chuyển)"`
- Tests: `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › việc cần làm theo thứ tự chưa gán → xem tay → chuyển tiền → sắp vỡ → chưa chia → đếm ví → chốt người thuê → quét tháng, rồi chỗ lệch"

### AC-27: Bản ngắn không quá 25 / 150 ký tự
- Given mọi mục bật cùng lúc, còn để chi 123.456.789 ₫, ba ví sắp vỡ tên dài; hoặc một ví tên 400 ký tự; hoặc còn để chi từ âm tới 999 tỷ
- When `dailyMessage`
- Then tiêu đề `Còn 123.456.789 ₫` (bản có "tuần này" dài 26) và luôn ≤ 25 ký tự; nội dung ≤ 150 ký tự, giữ các việc đứng đầu, bỏ phần sau và kết thúc bằng ` …`; mục quá dài bị cắt còn đúng 150 ký tự, kết thúc bằng `…`
- Tests: `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › tin dài nhất: tiêu đề ≤ 25, nội dung ≤ 150; cắt từ cuối, giữ việc đứng đầu, kết thúc bằng …"; `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › một việc dài hơn cả nội dung thì cắt giữa chừng, vẫn kết thúc bằng …"; `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › tiêu đề không bao giờ quá 25 ký tự"

### AC-28: Telegram nhận bản đầy đủ, máy nhận bản ngắn
- Given "husband" có `tg_chat_id`, có token; hai máy đã bật thông báo; DB seed thứ Ba 22/9
- When `daily` chạy
- Then Telegram nhận tin mở bằng `💰 Còn để chi tuần này: 0 ₫ (6 ngày)`; mỗi máy giải mã được `{ title: "Còn 0 ₫ tuần này", body (≤ 150, không emoji 💰), url: "/#today", tag: "daily" }`; `notifications.payload` của Telegram là bản đầy đủ, của `push:<id>` là `title` + xuống dòng + `body`
- Tests: `test/push.test.ts` › "notifyMembers qua push › tin sáng: Telegram nhận bản đầy đủ, máy nhận bản ngắn mở màn Hôm nay; notifications lưu đúng bản đã gửi"

### AC-29: "Còn để chi" âm viết là "đã chi vượt"
- Given `spendableThisWeek` = −415.300, còn 1 ngày
- When dựng tin sáng
- Then dòng đầu bản đầy đủ "💰 Tuần này đã chi vượt 415.300 ₫ (còn 1 ngày)"; tiêu đề bản ngắn "Tuần này vượt 415.300 ₫"
- Tests: `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › còn để chi âm: không viết 'Còn −X' mà nói thẳng đã chi vượt, cả bản ngắn lẫn bản đầy đủ"

## Traceability
- Code: `src/cron/daily.ts` › `daily`, `closePreviousMonthOnDayOne`; `src/cron/schedule.ts` › `runScheduledDigests`; `src/domain/period.ts` › `isoWeekday`; `src/notify/format.ts` › `dailyMessage`, `DailyMessageInput` (`safetyFundMonthsCovered`, `safetyFundMonthsTarget`, `debts`, `receivables`, `backfillScope`), `NotifyMessage`, `PUSH_TITLE_MAX`, `PUSH_BODY_MAX`, `fitJoin`, `firstFit`, `formatMoney`, `formatDecimal1`, `formatPct`; `src/notify/telegram.ts` › `notifyMembers`, `escapeHtml`; `src/services/ledger.ts` › `getSnapshot`, `reconcile`, `loadRefs`; `src/domain/snapshot.ts` › `buildSnapshot`; `src/services/rental.ts` › `unsettledTenants`
- Migrations/DB: `notifications` (đọc `backfill`, `ingest_error`; ghi `daily`); views `v_reconcile`, `v_goal_progress` (`migrations/0001_schema.sql`), `v_safety_fund` (gốc `v_emergency_fund` ở `migrations/0001_schema.sql`, đổi tên ở `migrations/0028_english_names.sql`), config `safety_fund_months`; view `v_tenant_balance`, `tenant_settlements` (`migrations/0007_income_streams_rental.sql`); view `v_debt_balance` (`migrations/0013_debts.sql`); view `v_receivable_balance` (`migrations/0014_receivables.sql`)

## Divergences & Open Questions
- [DIVERGENCE] Mẫu tin phase-07 xếp `⚠️ Sắp vỡ: Ăn uống 92% · Đi lại 105%` (`plans/260921-2228-profit-first-pwa/phase-07-cron-telegram.md` § Hằng ngày) nhưng code sắp % giảm dần → `Đi lại 105% · Ăn uống 92%` (`src/cron/daily.ts` › `.sort((a, b) => b.pct - a.pct)`; test AC-4 chốt thứ tự code).
- [DIVERGENCE] Phase-07: "không có gì cảnh báo thì tin ngắn 2 dòng"; code luôn hiện 🎯 khi có ví mục tiêu hoặc Quỹ an tâm tính được (kể cả 0%) nên với dữ liệu thật tin tối thiểu là 3 dòng (AC-3). Lý do ghi ở `plans/reports/fullstack-developer-260922-0020-cron-telegram.md` "Giả định cần xác nhận" #4 — chưa được xác nhận.
- [DIVERGENCE] Phase-07 Todo "gửi lỗi: ghi ok=0, **hiện badge trong PWA**": không có code nào trong `src/routes` hay `web/src` đọc `notifications.ok`.
- [OPEN] Dòng 🏦 bỏ dấu của số lệch (`Math.abs`): người đọc không biết ngân hàng cao hay thấp hơn sổ.
- [OPEN] "Quá 3 ngày" và "24 giờ qua" (❗) tính theo đồng hồ DB (`datetime('now', …)`), không theo `now` của lần chạy; chỉ khác khi chạy tay với `now` giả.
- [OPEN] Câu chữ dòng 🧮 và việc dùng lại icon 🔁 cho lệnh chuyển tiền của chốt tháng là do agent tự soạn, chưa được duyệt (báo cáo phase-07, "Giả định cần xác nhận" #2, #3).
- [DIVERGENCE] Proposal `261001-cho-thue-lai` §Thiết kế: "tin sáng ngày 1 nhắc chốt tháng với từng người thuê đang `active`"; code chỉ nhắc người `active` **chưa** chốt tháng trước (`src/services/rental.ts` › `unsettledTenants`), và kèm số dư hiện tại.
