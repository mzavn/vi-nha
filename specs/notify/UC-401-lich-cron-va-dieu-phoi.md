# UC-401: Lịch cron & điều phối
- Status: implemented
- BR: BR-06, BR-10
- Decisions: D11 (cron 02:00 rà soát); ADR-68 (giờ nhắc chỉnh trong app); ADR-70 (nhịp 15 phút, đêm mỗi giờ); ADR-78 (khoảng rà của lượt 02:00 ba lớp — lịch không đổi); `docs/core_design_rules.md` §5 (nhịp kỳ), §9 "Kiến trúc: Cloudflare Worker + D1"; phase-07 § Cron ("Mọi `day_key` / `week_key` / 'hôm nay là ngày mấy' tính theo Asia/Ho_Chi_Minh")
- Actor: Cloudflare Cron Triggers
- Trigger: `scheduled(event)` với `event.cron` ∈ `wrangler.jsonc` › `triggers.crons`

## History
- v1 (2026-09-22, commit `a773716`): Worker skeleton khai đủ 4 cron trong `wrangler.jsonc` (handler còn stub).
- v2 (2026-09-22, commit `c6677a8`): `src/cron/index.ts` — hằng `CRONS` và `runScheduled` rẽ nhánh theo chuỗi cron; module cron là stub có chữ ký cố định để làm song song.
- v3 (2026-09-22, commits `13e89cc`, `c1a25c1`/`f7fe81c`): các handler `daily`, `weekly`, `notifyPendingLogs`, `backfill` có nội dung thật.
- v4 (2026-10-01, commit `7b71600`): cron `* * * * *` chạy song song hai việc — `notifyPendingLogs` (UC-407) và `runPushTestSeries` (lượt "Thử khi tắt app", UC-410) — qua `Promise.allSettled`: một việc lỗi không chặn việc kia.
- v5 (2026-10-01, commit `d75c563`): việc thứ hai của cron mỗi phút đổi thành `cancelStaleTestSeries` — chỉ huỷ lượt gửi thử `pending`/`running` quá 10 phút, không gửi gì (lượt gửi thử nay chạy trong request, UC-410).
- v6 (2026-10-01, commit `a301077`): chỉ còn hai cron — `0 19 * * *` và `*/5 * * * *` (288 lượt/ngày thay 1440). Bỏ `0 0 * * *` và `0 1 * * 1`: tin sáng và tổng kết tuần chạy trong lượt 5 phút theo giờ ở `config` (Cài đặt › Thông báo › Giờ nhắc), chống chạy hai lần bằng mốc `daily_run` / `weekly_run` (ADR-68).
- v7 (2026-10-01, commit `e72b5de`): hai biểu thức `*/15 0-17,21-23 * * *` (mỗi 15 phút, trừ 01:00–03:59 VN) và `0 18,19,20 * * *` (01:00, 02:00, 03:00 VN) cùng vào một lượt `tick` — ≈ 87 lượt/ngày thay 289. Bỏ cron riêng `0 19 * * *`: rà soát (ingest UC-304) chạy trong lượt có giờ VN đúng 02:00, cô lập với các việc khác bằng `Promise.allSettled` (ADR-70).
- v8 (2026-10-03, commit `d44390e`): lịch và lượt không đổi — rà soát vẫn chỉ chạy ở lượt 02:00 VN; khoảng rà của lượt đó thành ba lớp (ngày thường: hôm qua; thứ Hai: cả tuần trước; ngày 1: cả tháng trước — ingest UC-304, ADR-78), dòng `notifications(kind='backfill')` mang thêm `scope`. Không thêm cron riêng cho tuần/tháng (quota trigger ADR-56).

## Preconditions
- Worker đã deploy với `triggers.crons` như bảng dưới; `CRONS` trong code trùng từng ký tự.
- Bảng `config` có các khoá giờ nhắc (`migrations/0011_notify_schedule.sql`, làm tròn bước 15 phút ở `0012`); thiếu khoá hay giá trị hỏng thì dùng mặc định (notify [entities](entities.md) § Giờ nhắc).

## Main Flow
1. Cloudflare gọi `scheduled(event, env, ctx)` (`src/index.ts`).
2. Worker gọi `ctx.waitUntil(runScheduled(event.cron, env, new Date(event.scheduledTime)))` — mốc thời gian nghiệp vụ `now` là **thời điểm lịch** (`scheduledTime`), không phải lúc chạy thật.
3. `runScheduled` so `cron` với `CRONS`; cả hai khoá gọi cùng một lượt `tick`:

| `CRONS` | Cron (UTC) | Giờ VN | Lượt/ngày |
|---|---|---|---|
| `quarterHour` | `*/15 0-17,21-23 * * *` | mỗi 15 phút, trừ 01:00–03:59 (giờ UTC 18–20 bị bỏ) | 84 |
| `nightHourly` | `0 18,19,20 * * *` | 01:00, 02:00, 03:00 | 3 |

3b. `tick`: đọc trạng thái thông báo **một lần** bằng `loadNotifyState` — một câu `SELECT` gộp các khoá `notify_*` của `config` với `MAX(day_key)` của mốc `daily_run` / `weekly_run` — rồi chạy các việc cùng lúc bằng `Promise.allSettled`, chờ tất cả xong; có việc lỗi thì ném `AggregateError("lượt cron lỗi")` gom các lỗi (sau khi việc còn lại đã chạy xong):

| Việc | Khi | Chống làm lại |
|---|---|---|
| báo giao dịch chưa gán (UC-407) | `notify_pending_enabled` bật và giờ VN không trong giờ yên lặng | `notifications(kind='pending_log', day_key=<log id>, 'system', ok=1)` chỉ sau khi gửi được |
| `runScheduledDigests(env, now, state)` (bước 3c) | mọi lượt | mốc `notifications(kind='daily_run'/'weekly_run', 'system')` + chống gửi trùng của từng tin (UC-408); chốt tháng: `batch_id = 'S<yyyymm>'` (UC-403) |
| `cancelStaleTestSeries` (UC-410) | mọi lượt | `UPDATE … WHERE status IN ('pending','running')` — chạy lại không đổi thêm gì |
| `backfill` (ingest, UC-304) — không gửi tin; khoảng rà ngày / tuần (thứ Hai) / tháng (ngày 1) theo `backfillWindow` (ADR-78) | chỉ lượt có giờ VN đúng 02:00 (`minuteOfDay(now) = 120`, tức `scheduledTime` 19:00 UTC ngày hôm trước) | thuộc ingest: chống trùng log + `notifications(kind='backfill', day_key=dayKey(now), 'system')` `INSERT OR IGNORE` |

3c. `runScheduledDigests` (giờ VN của `now`, không đọc DB thêm khi không có việc):
   - **Tin sáng** đến hạn khi mốc `daily_run` gần nhất ≠ hôm nay **và** giờ hiện tại ≥ `notify_daily_time` **và** (tin sáng bật **hoặc** hôm nay là ngày 1). Đến hạn thì giành mốc `INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload, ok) VALUES ('daily_run', <ngày VN>, 'system', NULL, 1)`; chỉ lượt chèn được dòng mới chạy: tin sáng bật → `daily` (UC-402..405); tắt (chỉ ngày 1) → chỉ chốt tháng (UC-403), không gửi.
   - **Tổng kết tuần** đến hạn khi bật **và** thứ ISO hôm nay = `notify_weekly_day` **và** giờ ≥ `notify_weekly_time` **và** mốc `weekly_run` gần nhất ≠ tuần được tổng kết (UC-406). Giành mốc `weekly_run` với `day_key` = tuần đó rồi chạy `weekly`.
   - Việc đã giành mốc mà ném lỗi → xoá mốc vừa giành rồi ném tiếp: lượt cron sau làm lại (an toàn vì chốt tháng idempotent và `notifyMembers` không gửi lại người đã nhận).
   - Hệ quả: lượt đúng giờ bị lỡ thì lượt kế tiếp chạy bù; giờ nằm trong 01:00–03:59 chạy ở lượt mỗi giờ kế tiếp (01:30 → 02:00); không bao giờ chạy hai lần một ngày (một tuần); đổi giờ sau khi hôm nay đã chạy thì mai mới áp dụng.
4. Mỗi handler tự đổi `now` sang lịch VN bằng `src/domain/period.ts` (`dayKey`, `weekKey`, `monthKey`, `isoWeekday`, `minuteOfDay`, offset +7h cố định).

## Alternative Flows
- 3a. `event.cron` không khớp khoá nào (ví dụ Worker còn chạy cron cũ `*/5 * * * *` hay `0 19 * * *` trước khi deploy lại) → `console.warn("cron lạ: <cron>")`, không làm gì.

## Exceptions
- E1. Handler ném lỗi → không có bắt lỗi ở `runScheduled`; lỗi rơi vào `waitUntil` (chỉ còn log của Cloudflare, `observability.enabled: true`). Lượt theo lịch kế tiếp là lần thử lại duy nhất (tin theo giờ nhắc: mốc đã nhả nên lượt sau làm lại; rà soát: tới 02:00 đêm sau). Lỗi của một việc không chặn việc khác (bước 3b), rồi vẫn ném ra. [OPEN] chưa có quyết định giám sát lỗi cron (xem `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md` câu hỏi về Sentry/log tập trung).
- E2. Đọc trạng thái thông báo lỗi (bước 3b) → báo chưa gán và tin theo giờ cùng bỏ lượt này; dọn lượt gửi thử và rà soát (lượt 02:00) vẫn chạy.

## Acceptance Criteria
### AC-1: Ngày VN của cron sáng không bị lệch vì UTC
- Given cron sáng chạy với `now = 2026-09-30T23:30:00Z` (06:30 VN ngày 1/10)
- When `daily(env, now)` chạy
- Then dòng chống trùng có `day_key='2026-10-01'`, không có dòng nào với `day_key='2026-09-30'`
- Tests: `test/cron-daily.test.ts` › "múi giờ VN › cron chạy lúc 23:30 UTC hôm trước vẫn thuộc ngày VN hôm sau"

### AC-2: Rà soát 02:00 VN và tin sáng cùng một ngày VN
- Given lượt 02:00 VN ngày D+1 (`scheduledTime` 19:00 UTC ngày D) chạy rà soát và ghi `notifications(kind='backfill', day_key=dayKey(now))`
- When tin sáng chạy vào giờ nhắc của ngày VN D+1
- Then tin sáng đọc được dòng đó bằng `day_key = dayKey(now)` của chính nó (cùng ngày VN D+1)
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › đêm qua backfill vá bao nhiêu lấy từ notifications(kind='backfill', day_key=hôm nay); lượt soát tuần ghi rõ" (mô phỏng dòng backfill bằng SQL; phần ghi thật ở UC-304)

### AC-3: Hai biểu thức cron cùng vào một lượt; cron lạ không làm gì
- Given `CRONS` như bảng trên; giờ tin sáng 02:00
- When `runScheduled("0 18,19,20 * * *", …)` lúc 02:00 VN; `runScheduled("*/5 * * * *", …)` (cron cũ) rồi `runScheduled("*/15 0-17,21-23 * * *", …)` lúc 07:00 VN hôm sau
- Then lượt mỗi giờ gửi tin sáng; cron cũ chỉ có `console.warn("cron lạ: */5 * * * *")`, không gửi; lượt 15 phút gửi tin sáng hôm sau
- Tests: `test/cron-schedule.test.ts` › "lượt cron: hai biểu thức, rà soát 02:00 › cả hai biểu thức cron vào cùng một lượt; cron cũ chỉ cảnh báo, không làm gì"

### AC-4: Mỗi job chạy lại không sinh tác dụng trùng
- Given một job đã chạy xong cho kỳ của nó
- When Cloudflare gọi lại cùng job cùng kỳ
- Then không có tin gửi thêm và không có bút toán thêm (chi tiết ở AC chống trùng của UC-402, UC-403, UC-406, UC-407)
- Tests: `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › gửi đúng 2 người có tg_chat_id, cùng nội dung; chạy lại trong ngày không gửi thêm"; `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › chạy lại cùng tuần không gửi trùng"

### AC-5: Lượt cron: một việc lỗi không chặn việc khác
- Given một lượt gửi thử `running` tạo 11 phút trước; bảng `bank_logs` mất (báo giao dịch chưa gán ném lỗi)
- When `runScheduled("*/15 0-17,21-23 * * *", …)`
- Then lượt gửi thử vẫn thành `cancelled`; `runScheduled` vẫn báo lỗi (reject)
- Tests: `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › lượt cron: báo giao dịch chưa gán lỗi vẫn dọn lượt kẹt, rồi báo lỗi ra ngoài"

### AC-6: Lượt chưa tới giờ hay đã chạy rồi chỉ tốn một câu đọc
- Given giờ nhắc mặc định; `now` = 06:45 VN ngày 1/10 (chưa tới giờ tin sáng, dù là ngày chốt tháng), rồi 07:15 sau khi tin sáng đã gửi lúc 07:00
- When `loadNotifyState` rồi `runScheduledDigests`
- Then cả hai lượt chỉ có đúng một câu `prepare` (câu đọc lịch + mốc); lượt 06:45 không chốt tháng, lượt 07:15 không gửi thêm
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: lượt chưa tới giờ không tốn thêm truy vấn › chưa tới giờ (kể cả ngày 1) hay đã gửi rồi: chỉ một câu đọc lịch + mốc, không chốt tháng, không gửi"

### AC-7: Lỡ lượt đúng giờ thì lượt sau chạy bù, không bao giờ hai lần một ngày
- Given tin sáng 07:00; Worker không chạy lượt 07:00
- When lượt 07:15 rồi lượt 23:45 cùng ngày, rồi 07:00 hôm sau
- Then lượt 07:15 gửi; 23:45 không gửi thêm; hôm sau gửi tiếp
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › lỡ lượt đúng giờ thì lượt kế tiếp gửi bù; cả ngày chỉ một lần; hôm sau gửi tiếp"

### AC-8: Việc theo giờ lỗi giữa chừng thì nhả mốc, lượt sau làm lại
- Given tin sáng giành được mốc `daily_run` rồi ném lỗi (đọc DB hỏng)
- When lượt cron kế tiếp
- Then lượt lỗi không để lại mốc `daily_run`; lượt kế tiếp gửi tin sáng
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › tin sáng lỗi giữa chừng thì nhả mốc: lượt cron sau làm lại"

### AC-9: Rà soát chỉ chạy ở lượt 02:00 VN
- Given đã có token API SePay và một tài khoản nối SePay
- When các lượt 00:45, 01:00, 03:00, 04:00, 19:00 rồi 02:00
- Then không lượt nào gọi API SePay hay ghi dòng `backfill` cho tới lượt 02:00; lượt 02:00 gọi API một lần và ghi `notifications(kind='backfill', day_key='2026-09-22')`
- Tests: `test/cron-schedule.test.ts` › "lượt cron: hai biểu thức, rà soát 02:00 › rà soát giao dịch qua API SePay › chỉ chạy ở lượt 02:00 VN, không ở 01:00, 03:00 hay các lượt 15 phút"

### AC-10: Rà soát lỗi không chặn việc khác của lượt 02:00
- Given giờ tin sáng 02:00; rà soát ném lỗi khi đọc danh sách tài khoản
- When lượt 02:00
- Then tin sáng vẫn gửi; lượt vẫn báo lỗi (reject)
- Tests: `test/cron-schedule.test.ts` › "lượt cron: hai biểu thức, rà soát 02:00 › rà soát giao dịch qua API SePay › rà soát lỗi không chặn việc khác của lượt 02:00, rồi báo lỗi ra ngoài"

## Traceability
- Code: `wrangler.jsonc` › `triggers.crons`; `src/cron/index.ts` › `CRONS`, `runScheduled`, `tick`, `BACKFILL_MINUTE`; `src/cron/schedule.ts` › `loadNotifyState`, `runScheduledDigests`, `claimRun`, `runClaimed`; `src/cron/backfill.ts` › `backfill`; `src/domain/notify-schedule.ts` › `parseNotifySchedule`, `inQuietHours`, `clockMinutes`; `src/index.ts` › default export `scheduled`; `src/domain/period.ts` › `dayKey`, `weekKey`, `monthKey`, `isoWeekday`, `minuteOfDay`
- Migrations/DB: `migrations/0001_schema.sql` › `notifications` (`UNIQUE (kind, day_key, chat_id)`); `migrations/0011_notify_schedule.sql` (khoá `notify_*` trong `config`); `migrations/0012_notify_schedule_15min.sql` (làm tròn giờ về bội số 15 phút)

## Divergences & Open Questions
- [OPEN] Lịch khai hai nơi (`wrangler.jsonc` và `CRONS`) không có kiểm tra tự động giữ đồng bộ; lệch nhau thì job im lặng không chạy (chỉ `console.warn`).
- [OPEN] Phase-07 Todo "test local: `wrangler dev --test-scheduled` + `curl "/__scheduled?cron=0+0+*+*+*"`" — không có dấu vết đã làm trong repo (không kiểm chứng được).
