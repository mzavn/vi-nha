# UC-406: Tổng kết tuần (giờ nhắc, mặc định 08:00 thứ Hai)
- Status: implemented
- BR: BR-01, BR-06
- Decisions: D7 (phong bì tuần); ADR-68 (giờ nhắc chỉnh trong app); ADR-79 (hai bản: ngắn cho thông báo đẩy, đầy đủ cho Telegram); `docs/core_design_rules.md` §5 dòng "Hằng tuần" (counter tuần về 0, tiền dư không chuyển đi đâu), §8 dòng "8:00 thứ 2"; `docs/DESIGN.md` §5 "Kỳ" (`T38 (14–20/9)`); phase-07 § Thứ Hai; ADR-92 (địa chỉ màn PWA tiếng Anh)
- Actor: lượt cron (UC-401: mỗi 15 phút, 01:00–03:59 VN mỗi giờ) vào thứ `notify_weekly_day` (mặc định 1 = thứ Hai) từ giờ `notify_weekly_time` (mặc định 08:00 VN), khi `notify_weekly_enabled` bật; người nhận như UC-402
- Trigger: `runScheduledDigests` giành được mốc `weekly_run` của tuần được tổng kết → `src/cron/weekly.ts` › `weekly(env, now)`

## History
- v1 (2026-09-22, commit `13e89cc`): tổng kết tuần ISO vừa kết thúc: đã tiêu/mục tiêu từng ví phong bì tuần + top 5 danh mục.
- (commit `b8e8f0c`: chỉnh bối cảnh test, không đổi hành vi.)
- v2 (2026-10-01, commit `a301077`): ngày giờ gửi lấy từ Cài đặt › Thông báo › Giờ nhắc (mặc định thứ Hai 08:00) thay cho cron cố định `0 1 * * 1`; tắt được; tuần được tổng kết tính theo thứ trong tuần của `now` (`summarisedSunday`) nên gửi ngày nào cũng đúng; một lần mỗi tuần nhờ mốc `weekly_run` (UC-401, ADR-68).
- v3 (2026-10-01, commit `e72b5de`): giờ tổng kết là bội số 15 phút, chạy ở lượt cron 15 phút (giờ trong 01:00–03:59 chạy ở lượt mỗi giờ kế tiếp) (ADR-70).
- v4 (2026-10-03, commit `4e6d103`): tin dựng **hai bản** (ADR-79): bản đầy đủ (Telegram) giữ nguyên câu chữ; bản ngắn (thông báo đẩy) tiêu đề "Tuần T39: chi <tổng chi tuần>", nội dung là ví ≥ 80% dự kiến, danh mục tiêu nhiều nhất, rồi ví còn lại, ≤ 150 ký tự. Thêm tổng chi cả tuần (`totalSpent`). Thêm AC-9, AC-10.
- v5 (2026-10-07, commit `7424f26`): bấm thông báo tổng kết tuần mở `/#wallets` (trước `/#vi`, ADR-92); chữ tin không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md)).

## Preconditions
- `now` là ngày `notify_weekly_day` (giờ VN), từ giờ `notify_weekly_time`; mốc `weekly_run` của tuần được tổng kết chưa có.

## Main Flow
1. `lastSunday = summarisedSunday(now)` = `now − (thứ ISO % 7) ngày`: thứ Hai..thứ Bảy là Chủ nhật của tuần ISO vừa kết thúc (thứ Hai lùi 1 ngày như trước); Chủ nhật là chính hôm nay — tổng kết tuần đang kết thúc, tính tới lúc gửi. `weekKeyPrev = weekKey(lastSunday)`; `lastMonday = lastSunday − 6 ngày`.
2. Nhãn tuần `formatWeekLabel(weekKeyPrev, dayKey(lastMonday), dayKey(lastSunday))` → `T39 (21–27/9)`; tuần vắt hai tháng ghi tháng ở cả hai đầu → `T44 (26/10–1/11)`.
3. Phong bì tuần: `getBudget(db, weekKeyPrev, null)` (UC-104), giữ các dòng có `target ≠ null` — tức ví có luật nạp `mode='flat'`, `period='week'`; ví `private` bị ẩn với người xem null nên không có mặt. Mỗi dòng: `<tên>: <đã tiêu> / <dự kiến>` (đã tiêu = `spent ?? 0`), theo thứ tự `sort` của ví.
4. Chi theo danh mục: tổng `spend − refund` theo `category_id` của giao dịch `active` có `week_key = weekKeyPrev`, sắp giảm dần (cùng công thức với view `v_spend_by_category` nhưng lọc theo tuần). **Top 5** = các danh mục có tổng > 0, tối đa 5; tên danh mục (không có thì hiện `category_id`). **Tổng chi tuần** (`totalSpent`) = tổng mọi danh mục (kể cả danh mục hoàn nhiều hơn chi).
5. `weeklyMessage` dựng hai bản (ADR-79). Bản đầy đủ:
   - dòng đầu `📊 Tổng kết tuần <nhãn>`
   - các dòng phong bì
   - nếu có danh mục: `🏆 Top 5 danh mục tiêu nhiều nhất:` rồi `1. <tên> — <tiền>` …
   - nếu không có cả phong bì lẫn danh mục: `Không có dữ liệu chi tiêu tuần này.`
   Bản ngắn:
   - tiêu đề `Tuần T<số>: chi <tổng chi tuần>`; quá 25 ký tự thì `T<số>: chi <tổng>`, rồi `Tổng kết T<số>`
   - nội dung: các ví đã tiêu ≥ 80% dự kiến (cùng ngưỡng "sắp vỡ" của tin sáng), sắp theo % giảm dần, dạng `<tên> <đã tiêu không ₫>/<dự kiến>` (ví dự kiến 0 mà đã tiêu > 0 coi như vượt); rồi `tiêu nhiều nhất <danh mục> <tiền>`; rồi các ví còn lại theo % giảm dần; nối bằng ` · `, chữ đầu viết hoa, ≤ 150 ký tự (hết chỗ thì bỏ mục từ cuối lên, thêm ` …`). Không có cả phong bì lẫn danh mục → `Không có dữ liệu chi tiêu tuần này.`
6. `notifyMembers(env, "weekly", weekKeyPrev, message)` — Telegram nhận bản đầy đủ, máy đã bật nhận bản ngắn; chống trùng theo `(weekly, <tuần ISO>, chat_id)` (UC-408, UC-410).
7. Không có bước "reset" nào: counter tuần là view theo `week_key`, tự về 0; tiền dư tuần không bị quét (quét chỉ ở UC-403).

## Alternative Flows
- 0a. Đổi thứ/giờ sau khi tuần đó đã gửi (ví dụ đã gửi Chủ nhật rồi đổi về thứ Hai) → thứ Hai tổng kết cùng tuần đó, mốc `weekly_run` đã có → không gửi lại.
- 4a. Tuần không có chi tiêu → không có mục 🏆; phong bì vẫn hiện với `0 ₫`.

## Exceptions
- E1. Chưa có token / Telegram hỏng → như UC-408 (tin tuần đó mất, không gửi bù).

## Acceptance Criteria
### AC-1: Nội dung tổng kết đúng tuần, top 5 tính spend trừ refund
- Given chi W39: Đi chợ 400.000, Ăn ngoài 100.000, Xăng xe 150.000, Grab 80.000 (hoàn 20.000), Tụ tập 50.000, Y tế 40.000; và Đi chợ 500.000 ở W38
- When `weekly` chạy 01:00 UTC thứ Hai 28/9/2026
- Then hai người nhận cùng một tin; có 2 dòng `notifications(kind='weekly', day_key='2026-W39')`; tin đúng:
  `📊 Tổng kết tuần T39 (21–27/9)` / `Chơi (chồng): 50.000 ₫ / 820.000 ₫` / `Chơi (vợ): 0 ₫ / 820.000 ₫` / `Ăn uống: 500.000 ₫ / 625.000 ₫` / `Đi lại: 210.000 ₫ / 300.000 ₫` / `🏆 Top 5 danh mục tiêu nhiều nhất:` / `1. Đi chợ / nấu ăn — 400.000 ₫` … `5. Tụ tập / cà phê — 50.000 ₫` (Y tế hạng 6 bị loại; W38 không tính)
- Tests: `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › đã tiêu/dự kiến từng ví phong bì tuần + top 5 danh mục (spend trừ refund), loại tuần khác"

### AC-2: Chạy lại cùng tuần không gửi trùng
- When `weekly` chạy hai lần cùng thứ Hai
- Then Telegram chỉ được gọi 2 lần (mỗi người một)
- Tests: `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › chạy lại cùng tuần không gửi trùng"

### AC-3: Tuần không chi tiêu
- Given không có giao dịch
- Then tin chỉ có tiêu đề và 4 dòng phong bì `0 ₫ / <dự kiến>`; không có `🏆`, không có `Không có dữ liệu`
- Tests: `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › tuần không có chi tiêu: vẫn hiện các ví phong bì (0 đồng), không có mục top 5"

### AC-4: Định dạng tin tuần và trạng thái rỗng
- Given input có phong bì + danh mục / input rỗng
- Then đúng câu chữ; rỗng hoàn toàn → `📊 Tổng kết tuần T1 (29/12–4/1)` + `Không có dữ liệu chi tiêu tuần này.`
- Tests: `test/format.test.ts` › "weeklyMessage › tổng kết tuần: đã tiêu/dự kiến từng ví + top 5 danh mục"; "weeklyMessage › tuần không có dữ liệu chi tiêu: vẫn có tiêu đề, kèm câu trạng thái rỗng"

### AC-5: Nhãn tuần luôn kèm khoảng ngày
- Then `formatWeekLabel("2026-W38","2026-09-14","2026-09-20") = "T38 (14–20/9)"`; `formatWeekLabel("2026-W44","2026-10-26","2026-11-01") = "T44 (26/10–1/11)"`
- Tests: `test/format.test.ts` › "formatWeekLabel › cùng tháng: T38 (14–20/9)"; "formatWeekLabel › lệch tháng: ghi rõ tháng ở cả hai đầu"

### AC-6: Mặc định thứ Hai 08:00, đúng một lần mỗi tuần
- Given giờ nhắc mặc định; tin sáng tắt (cho dễ đếm)
- When các lượt 07:45, 08:00, 08:15 thứ Hai 28/9 và 08:00 thứ Ba 29/9
- Then chỉ lượt 08:00 thứ Hai gửi; đúng 2 dòng `notifications(kind='weekly', day_key='2026-W39')`
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tổng kết tuần › mặc định thứ Hai 08:00: gửi đúng một lần cho tuần vừa qua; ngày khác không gửi"

### AC-7: Chủ nhật tổng kết tuần đang kết thúc; đổi thứ sau khi gửi không gửi lại
- Given `notify_weekly_day = 7`, `notify_weekly_time = '20:00'`
- When lượt 19:45 rồi 20:00 Chủ nhật 27/9; sau đó đổi về thứ Hai 08:00 và lượt 08:00 thứ Hai 28/9
- Then 19:45 không gửi; 20:00 gửi tổng kết `2026-W39`; thứ Hai không gửi lại (vẫn 2 dòng `weekly`)
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tổng kết tuần › chọn Chủ nhật 20:00: tổng kết tuần kết thúc hôm nay; đổi về thứ Hai sau khi gửi thì không gửi lại tuần đó"

### AC-8: Tắt tổng kết tuần thì không gửi
- Given `notify_weekly_enabled = '0'`
- When lượt 08:00 thứ Hai
- Then không tin nào
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tổng kết tuần › tắt tổng kết tuần thì không gửi"

### AC-9: Bản ngắn: tổng chi ở tiêu đề, ví sát dự kiến lên đầu
- Given phong bì Chơi (chồng) 50.000/820.000, Ăn uống 540.000/625.000, Đi lại 310.000/300.000; danh mục nhiều nhất Đi chợ / nấu ăn 450.000; tổng chi 2.345.000; tuần T40 / tuần rỗng T1
- When `weeklyMessage`
- Then `title = "Tuần T40: chi 2.345.000 ₫"`, `body = "Đi lại 310.000/300.000 ₫ · Ăn uống 540.000/625.000 ₫ · tiêu nhiều nhất Đi chợ / nấu ăn 450.000 ₫ · Chơi (chồng) 50.000/820.000 ₫"`; tuần rỗng → `{ title: "Tuần T1: chi 0 ₫", body: "Không có dữ liệu chi tiêu tuần này." }`
- Tests: `test/format.test.ts` › "weeklyMessage › bản ngắn: tiêu đề tổng chi tuần; ví ≥ 80% dự kiến lên đầu (sắp % giảm dần), rồi danh mục tiêu nhiều nhất, rồi ví còn lại"; `test/format.test.ts` › "weeklyMessage › tuần không có dữ liệu chi tiêu: vẫn có tiêu đề, kèm câu trạng thái rỗng"; tổng chi đọc từ DB (W39: chi 400.000 + Grab 80.000 hoàn 20.000, W38 không tính → `Tuần T39: chi 460.000 ₫`, mở `/#wallets`): `test/push.test.ts` › "notifyMembers qua push › tổng kết tuần: máy nhận tiêu đề tổng chi cả tuần (spend trừ refund, mọi danh mục), mở màn Ví"

### AC-10: Bản ngắn không quá 25 / 150 ký tự
- Given tổng chi 12.345.000 ₫; tám phong bì
- When `weeklyMessage`
- Then tiêu đề `T40: chi 12.345.000 ₫` (bản có "Tuần" dài 26); nội dung ≤ 150 ký tự, mở bằng hai ví % cao nhất, kết thúc bằng ` …`
- Tests: `test/format.test.ts` › "weeklyMessage › bản ngắn: tổng chi dài thì tiêu đề bỏ chữ Tuần, vẫn ≤ 25; nhiều ví thì nội dung ≤ 150, kết thúc bằng …"

## Traceability
- Code: `src/cron/weekly.ts` › `weekly` (`totalSpent`), `summarisedSunday`; `src/cron/schedule.ts` › `runScheduledDigests`; `src/notify/format.ts` › `weeklyMessage`, `WeeklyMessageInput`, `NEAR_TARGET`, `NotifyMessage`, `fitJoin`, `firstFit`, `formatWeekLabel`, `formatMoney`; `src/services/ledger.ts` › `getBudget`; `src/domain/period.ts` › `weekKey`, `dayKey`, `isoWeekday`
- Migrations/DB: views `v_spent_week`, `v_spend_by_category` (công thức gốc) — `migrations/0001_schema.sql`; `notifications`

## Divergences & Open Questions
- [OPEN] Top 5 danh mục và tổng chi tuần ở tiêu đề bản ngắn cộng cả chi tiêu từ ví `private` (câu SQL không lọc theo ví), trong khi phong bì `private` bị ẩn — tổng theo danh mục có thể để lộ phần chi tiêu "ẩn lịch sự" (D6) trong tin gửi cả hai người.
- [OPEN] Tin chỉ liệt kê phong bì **tuần**; phong bì tháng và các ví khác không có trong tổng kết (`docs/core_design_rules.md` §8 chỉ ghi "tổng kết tuần + top 5 danh mục", không nói rõ phạm vi).
