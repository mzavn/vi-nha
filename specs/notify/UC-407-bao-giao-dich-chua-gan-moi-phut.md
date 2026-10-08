# UC-407: Báo giao dịch chưa gán (mỗi 15 phút, có giờ yên lặng)
- Status: implemented
- BR: BR-03, BR-04, BR-06
- Decisions: ADR-68 (bật/tắt, giờ yên lặng); ADR-70 (nhịp 15 phút, đêm mỗi giờ); ADR-79 (hai bản: ngắn cho thông báo đẩy, đầy đủ cho Telegram); ADR-80 (kênh Zalo, bản đầy đủ dạng chữ thường); `docs/core_design_rules.md` §8 dòng "Có log chưa gán" ("cron mỗi 15 phút (đêm 01:00–04:00 mỗi giờ) gom log đã chờ ≥ 60 giây (để chân thứ hai của chuyển nội bộ kịp về)"), §6 luật khớp cặp bước 4 ("không khớp mà là tiền vào → pending, luôn hỏi"); commit `b468f54`; `plans/reports/redteam-260922-0100-offline-ingest-robustness.md` (claim trước khi gửi làm mất cảnh báo); `plans/reports/summary-260922-0130-overnight-build.md` ("Chỉ đánh dấu 'đã báo' khi gửi được")
- Actor: Cron `*/15 0-17,21-23 * * *` và `0 18,19,20 * * *` (UC-401); người nhận như UC-402 (Telegram), mọi máy đã bật thông báo (UC-410) và mọi người đã nối Zalo (UC-411)
- Trigger: lượt `tick` → (bật và ngoài giờ yên lặng) `src/cron/pending-notifier.ts` › `notifyPendingLogs(env, now)`

Log chưa gán sinh ra ở ingest (**UC-303 Tự khớp log vào sổ** để lại `pending`); người gán ở **UC-305 Gán log chưa gán** / **UC-706 Gán giao dịch ngân hàng (màn Gán)**.

## History
- v1 (2026-09-22, commit `c6677a8`): stub.
- v2 (2026-09-22, commit `c1a25c1`, merge `f7fe81c`): gom log `pending` đã nhận ≥ 60 giây; chống trùng theo **từng log** bằng `INSERT OR IGNORE notifications(kind='pending_log', day_key=<log id>)` **trước** khi gửi.
- v3 (2026-09-22, commit `b468f54`): claim-trước-khi-gửi làm một lần Telegram hỏng là khoản tiền lạ không bao giờ được báo → chỉ đánh dấu `pending_log` (`ok=1`) **sau** khi gửi thành công; thử lại trong 24 giờ; escape HTML tên tài khoản; giới hạn 20 dòng để dưới 4096 ký tự của Telegram.
- v4 (2026-10-01, commit `5dc53be`): `notifyMembers` gửi cả push (UC-408 v3, UC-410) → `sent` cộng số máy nhận push; tin tới **một máy** cũng tính là "đã báo", không cần bot token. Push của tin này đi với `Urgency: high`, mở màn Gán khi bấm (change `261001-pwa-web-push`).
- v5 (2026-10-01, commit `a301077`): cron chạy mỗi 5 phút thay vì mỗi phút (vẫn chờ ≥ 60 giây, nên báo sau 1–5 phút); tắt được (`notify_pending_enabled`); giờ yên lặng `notify_quiet_start`–`notify_quiet_end` (mặc định 22:00–06:30, khung qua nửa đêm được) — trong giờ yên lặng không gọi `notifyPendingLogs`, lượt đầu tiên sau đó gom mọi log còn chờ thành một tin (UC-401, ADR-68).
- v6 (2026-10-01, commit `e72b5de`): lượt cron mỗi 15 phút, đêm 01:00–03:59 VN mỗi giờ (vẫn chờ ≥ 60 giây, nên báo sau tối đa ~15 phút; log về giữa đêm chờ tới lượt mỗi giờ kế tiếp, mà mặc định đêm nằm trong giờ yên lặng) (UC-401, ADR-70).
- v7 (2026-10-03, commit `4e6d103`): tin dựng **hai bản** trong `pendingMessage` (`src/notify/format.ts`, ADR-79): bản đầy đủ (Telegram) giữ nguyên câu chữ; bản ngắn (thông báo đẩy) tiêu đề "N giao dịch chưa gán", nội dung các khoản trên một dòng, hết chỗ thì "… và K khoản", ≤ 150 ký tự. AC-7 có test phần nội dung; thêm AC-13.
- v8 (2026-10-03, commit `5bd3117`): `notifyMembers` gửi thêm kênh Zalo (UC-408 v5, UC-411, ADR-80) — người đã nối Zalo nhận bản đầy đủ dạng chữ thường; `sent` cộng số chat Zalo nhận được, tin tới **một chat Zalo** cũng tính là "đã báo".

## Preconditions
- Có ít nhất một kênh gửi được (UC-408): bot token + ≥ 1 người có `tg_chat_id`, hoặc khoá VAPID + ≥ 1 máy đã bật thông báo (UC-410), hoặc bot token Zalo + ≥ 1 người đã nối Zalo (UC-411); nếu không, mọi lần chạy đều không gửi được và log được thử lại tới hết cửa sổ 24 giờ.

## Main Flow
0. Lượt `tick` (UC-401) chỉ gọi `notifyPendingLogs` khi `notify_pending_enabled` bật **và** giờ VN của `now` không nằm trong giờ yên lặng `[quiet_start, quiet_end)` (`inQuietHours`; `quiet_start > quiet_end` là khung qua nửa đêm; bằng nhau là không có giờ yên lặng). Không gọi thì log để nguyên, không đánh dấu gì.
1. `cutoff = now − 60 giây`, `oldest = now − 24 giờ` (dạng `YYYY-MM-DD HH:MM:SS` UTC, `sqliteDateTime`).
2. Chọn `bank_logs` có `status='pending'`, `received_at` trong `[oldest, cutoff]` (theo **lúc server nhận**, không theo `at` của ngân hàng), và **chưa** có `notifications(kind='pending_log', day_key=<log id>, ok=1)`; sắp theo `received_at` tăng dần. Không có → dừng.
3. Dựng một tin gộp, hai bản (`pendingMessage`, ADR-79). Bản đầy đủ:
   - dòng đầu `⚠️ <tổng số> giao dịch chưa gán:`
   - tối đa 20 dòng `<+|−><số tiền vi-VN> ₫ — <tên tài khoản>` (`+` cho `in`, `−` U+2212 cho `out`; tên escape HTML; tài khoản không xác định → `TK lạ`)
   - còn dư → `… và <N> khoản khác`
   Bản ngắn: tiêu đề `<tổng số> giao dịch chưa gán` (quá 25 ký tự thì `<tổng số> chưa gán`); nội dung `<+|−><số tiền> ₫ <tên tài khoản>` từng khoản nối bằng ` · ` (tên giữ chữ thật), ≤ 150 ký tự — không vừa thì giữ các khoản đầu và thêm ` … và <K> khoản`.
4. `sent = notifyMembers(env, "pending_batch", now.toISOString(), message)` — Telegram nhận bản đầy đủ, máy đã bật nhận bản ngắn, Zalo nhận bản đầy đủ dạng chữ thường; khoá `pending_batch` mới cho mỗi lần chạy nên không bị chống trùng chặn lần thử lại (UC-408). `sent` = số người nhận Telegram + số máy nhận push + số chat Zalo nhận.
5. Nếu `sent > 0`: trong một `DB.batch`, ghi/đè `notifications(kind='pending_log', day_key=<log id>, chat_id='system', payload={amount,direction}, ok=1)` cho **mọi** log của tin (kể cả phần bị gom vào "… và N khoản khác").

## Alternative Flows
- 0a. Đang giờ yên lặng → không báo; lượt đầu tiên từ `quiet_end` (ví dụ lượt 06:30) gom mọi log chờ ≥ 60 giây trong 24 giờ qua thành một tin. Đang tắt → không báo; bật lại thì lượt kế tiếp báo những log còn chờ (trong 24 giờ). Log vẫn đếm ở dòng 📥 của tin sáng và ở màn Gán.
- 2a. Log đã được ghép cặp / gán trong 60 giây đầu (ví dụ chân thứ hai của chuyển nội bộ về kịp) → không còn `pending`, không báo.
- 2b. Log đã báo thành công → không báo lại, dù vẫn `pending` mãi.
- 2c. Log `pending` quá 24 giờ mà chưa báo được → không thử nữa; vẫn được đếm ở dòng 📥 của tin sáng (UC-402).
- 5a. `sent = 0` (không kênh nào: không token/không người nhận, không máy nào bật và không ai nối Zalo, hoặc mọi lần gửi hỏng) → không đánh dấu; lượt cron kế tiếp thử lại toàn bộ.

## Exceptions
- E1. Gửi được cho một người nhận, một máy hoặc một chat Zalo nhưng hỏng với nơi khác → vẫn tính là "đã báo" (điều kiện chỉ là `sent > 0`); nơi hỏng không nhận lại tin này.

## Acceptance Criteria
### AC-1: Chờ đủ 60 giây để chuyển nội bộ kịp ghép cặp
- Given hai chân `out`/`in` của một chuyển nội bộ về cách nhau 20 giây
- When cron chạy ở giây 70
- Then không có tin nào
- Tests: `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › chuyển nội bộ 2 chân về cách nhau 20 giây → ghép cặp trước khi cron chạy, không có tin 'cần gán'"

### AC-2: Chưa đủ 60 giây thì chưa báo
- Given một log lạ vừa về
- When cron chạy ở giây 30
- Then không có tin
- Tests: `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › chưa đủ 60 giây thì chưa báo"

### AC-3: Báo đúng một lần khi gửi được
- Given một log lạ `pending`
- When cron chạy ở giây 65 rồi giây 140
- Then Telegram được gọi đúng 1 lần
- Tests: `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › báo đúng một lần cho log pending đủ 60 giây, không báo lại lần sau"

### AC-4: Telegram hỏng thì thử lại tới khi gửi được, rồi thôi
- Given Telegram trả HTTP 500 ở lần chạy giây 65
- When Telegram hoạt động lại ở lần chạy giây 125 và giây 185
- Then lần giây 125 gửi 1 tin; lần giây 185 không gửi thêm
- Tests: `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › Telegram lỗi thì lần chạy sau báo lại; báo được rồi thì thôi"

### AC-5: Tên tài khoản được escape
- Given tài khoản tên `<b>VCB</b> & co`
- Then tin chứa `&lt;b&gt;VCB&lt;/b&gt; &amp; co`
- Tests: `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › tên tài khoản được escape trước khi vào tin HTML"

### AC-6: Cửa sổ thử lại 24 giờ
- Given một log `pending` có `received_at` cũ hơn 24 giờ, chưa báo được
- When cron chạy
- Then log đó không có trong tin
- Tests: ⚠ Chưa có test

### AC-7: Giới hạn 20 dòng
- Given 25 log chưa báo
- Then tin có dòng đầu `⚠️ 25 giao dịch chưa gán:`, 20 dòng chi tiết, dòng `… và 5 khoản khác`; sau khi gửi được cả 25 log đều được đánh dấu
- Tests: `test/format.test.ts` › "pendingMessage › nhiều khoản: bản đầy đủ dừng ở 20 dòng; bản ngắn ≤ 150, đuôi … và N khoản" (phần đánh dấu cả 25 log: ⚠ Chưa có test)

### AC-8: Chỉ có máy đã bật thông báo (không Telegram) vẫn tính là đã báo
- Given không có bot token; một máy đã bật thông báo; một log lạ `pending`
- When cron chạy ở giây 65 rồi giây 140
- Then lần đầu push tới máy (urgency `high`) và log được đánh dấu `pending_log` `ok=1`; lần sau không gửi thêm
- Tests: ⚠ Chưa có test (gián tiếp: `test/push.test.ts` › "notifyMembers qua push › push service trả 410 thì xoá máy đó, claim giữ ok=0; máy khác vẫn nhận" — `notifyMembers` với `pending_batch` trả số máy nhận push)

### AC-9: Giờ yên lặng qua nửa đêm: không báo, hết giờ thì gom một tin
- Given giờ yên lặng mặc định 22:00–06:30; log lạ về lúc 23:00 và 03:00
- When các lượt 23:15, 03:00 (lượt mỗi giờ), 06:15, 06:30, 06:45
- Then không tin nào tới hết lượt 06:15; lượt 06:30 gửi mỗi người một tin `2 giao dịch chưa gán`; 06:45 không gửi thêm
- Tests: `test/cron-schedule.test.ts` › "giờ yên lặng & bật/tắt báo giao dịch chưa gán › về trong giờ yên lặng 22:00–06:30 thì không báo; lượt 06:30 gom lại báo một tin"

### AC-10: Giờ yên lặng không qua nửa đêm
- Given giờ yên lặng 12:00–13:30; log về 11:00 và 12:10
- When các lượt 11:15, 12:15, 13:15, 13:30
- Then 11:15 báo log 11:00; log 12:10 chỉ được báo ở lượt 13:30
- Tests: `test/cron-schedule.test.ts` › "giờ yên lặng & bật/tắt báo giao dịch chưa gán › khung không qua nửa đêm (12:00–13:30): ngoài khung báo ngay lượt sau, trong khung chờ tới 13:30"

### AC-11: Tắt thì không báo; bật lại báo khoản còn chờ
- Given `notify_pending_enabled = '0'`; log lạ về 10:00
- When lượt 10:15; bật lại; lượt 10:30
- Then 10:15 không gửi; 10:30 gửi
- Tests: `test/cron-schedule.test.ts` › "giờ yên lặng & bật/tắt báo giao dịch chưa gán › tắt báo giao dịch chưa gán thì không báo kể cả ngoài giờ yên lặng; bật lại thì báo những khoản còn chờ"

### AC-12: Biên giờ yên lặng; bắt đầu = kết thúc là không đặt
- Given khung 22:00–06:30 / khung 00:00–00:00
- Then 22:00 là yên lặng, 06:30 không; khung bằng nhau không bao giờ yên lặng; giá trị hỏng trong `config` dùng mặc định
- Tests: `test/cron-schedule.test.ts` › "giờ yên lặng & bật/tắt báo giao dịch chưa gán › giờ yên lặng bắt đầu = kết thúc là không đặt; giá trị hỏng trong config thì dùng mặc định"

### AC-13: Bản ngắn cho thông báo đẩy
- Given −24.400 ₫ ở MB chính (chồng) và +50.000 ₫ ở tài khoản không xác định; hoặc 25 khoản; hoặc tên tài khoản `A&B <x>`
- When `pendingMessage`
- Then `{ title: "2 giao dịch chưa gán", body: "−24.400 ₫ MB chính (chồng) · +50.000 ₫ TK lạ" }`; 25 khoản → tiêu đề `25 giao dịch chưa gán`, nội dung ≤ 150 ký tự kết thúc bằng ` … và <K> khoản` với K = số khoản không hiện; bản ngắn giữ `A&B <x>`, bản đầy đủ escape
- Tests: `test/format.test.ts` › "pendingMessage › bản đầy đủ mỗi khoản một dòng; bản ngắn gộp một dòng, tài khoản không rõ là TK lạ"; `test/format.test.ts` › "pendingMessage › nhiều khoản: bản đầy đủ dừng ở 20 dòng; bản ngắn ≤ 150, đuôi … và N khoản"; `test/format.test.ts` › "pendingMessage › escape HTML ở bản đầy đủ, bản ngắn giữ chữ thật"

## Traceability
- Code: `src/cron/index.ts` › `tick` (điều kiện bật + giờ yên lặng); `src/domain/notify-schedule.ts` › `inQuietHours`, `parseNotifySchedule`; `src/cron/pending-notifier.ts` › `notifyPendingLogs`, `DELAY_MS`, `RETRY_WINDOW_MS`; `src/notify/format.ts` › `pendingMessage`, `PendingLog`, `PENDING_MAX_LINES`, `fitJoin`, `firstFit`; `src/services/ingest.ts` › `sqliteDateTime`; `src/notify/telegram.ts` › `notifyMembers`, `escapeHtml`; `src/services/push.ts` › `pushToMembers`, `pushPayload` (kind `pending_batch`)
- Migrations/DB: `bank_logs.received_at DEFAULT (datetime('now'))`, `bank_logs.status` (`migrations/0001_schema.sql`); `notifications` kinds `pending_batch`, `pending_log`

## Divergences & Open Questions
- [DIVERGENCE] `docs/core_design_rules.md` §8 mô tả tin là "5 giao dịch chưa gán"; code gửi `⚠️ 5 giao dịch chưa gán:` kèm từng dòng số tiền/tài khoản (`src/notify/format.ts` › `pendingMessage`). Khác về hình thức, cùng ý.
- [OPEN] Số tiền trong tin này định dạng bằng `toLocaleString("vi-VN")` + `" ₫"` tại chỗ (`pendingMessage`), không qua `formatMoney` — hai chỗ định dạng tiền song song trong `src/notify/format.ts`.
- [OPEN] Khi mọi kênh hỏng kéo dài, mỗi lượt cron (ngoài giờ yên lặng) sinh thêm một dòng `pending_batch` cho mỗi người nhận Telegram và mỗi máy đã bật (khoá là timestamp), không có dọn dẹp.
- [OPEN] Khoản thu bị tự ghi sổ + tự chia (không qua `pending`) không bao giờ được báo ở đây (`plans/reports/redteam-260922-0100-auth-exposure.md`, `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md`) — xem UC-409.
