# UC-403: Mời chốt tháng ngày 1
- Status: implemented
- BR: BR-02, BR-06, BR-07
- Decisions: ADR-111 (chốt tháng là quyết định của người — cron chỉ mời, không ghi); D3 (chỉ phong bì chung tham gia); `docs/core_design_rules.md` §5 dòng "Cuối tháng", §9 "Tuần dư"; phase-07 § Hằng ngày "Ngày 1 hằng tháng"
- Actor: lượt cron (UC-401) ngày 1 theo lịch VN, từ giờ tin sáng `notify_daily_time` (mặc định 07:00), **chỉ khi tin sáng bật**
- Trigger: `src/cron/daily.ts` › `daily` → `monthCloseInvite(db, now)`

Engine chốt tháng (bù chi lố, chia phần dư) thuộc allocation: **UC-207** (`previewMonthClose`, `closeMonth`) — người bấm chốt trên PWA. UC này chỉ quy định *khi nào* mời và *mời thế nào*.

## History
- v1 (2026-09-22, commit `13e89cc`): tin sáng ngày 1 gọi `closeMonth(previousMonth)` trước khi dựng tin; thêm dòng 🧹 và các dòng 🔁 lệnh chuyển tiền.
- v2 (2026-10-01, commit `a301077`): giờ chốt = giờ tin sáng ở Cài đặt (mặc định 07:00) thay cho cron cố định; tách `closePreviousMonthOnDayOne` khỏi `daily` để tắt tin sáng vẫn chốt tháng (việc của sổ), chỉ không gửi; lượt lỗi nhả mốc nên lượt 5 phút sau thử lại (UC-401, ADR-68).
- v3 (2026-10-01, commit `e72b5de`): lượt cron mỗi 15 phút (đêm 01:00–03:59 mỗi giờ) thay cho mỗi 5 phút; lượt lỗi được lượt cron kế tiếp làm lại (ADR-70).
- v4 (2026-10-03, commit `4e6d103`): tin sáng xếp việc cần làm trước thông tin (ADR-79) — dòng 🧹/🔁 thành mục cuối của phần việc cần làm, trước 🎯 và 🏦; bản ngắn của tin sáng có mục `quét <tiền> dư tháng <m> (<k> lệnh chuyển)`. AC-3 sửa.
- v5 (2026-10-16, commit `0528219`): **cron ngày 1 không chốt nữa** (ADR-111): `closePreviousMonthOnDayOne` bỏ, thay bằng `monthCloseInvite` (chỉ đọc `previewMonthClose`); tin sáng có dòng 📌 mời mở app chốt; tắt tin sáng thì ngày 1 không chạy gì (bỏ ngoại lệ "tắt tin sáng vẫn chốt" của v2). Bỏ dòng 🧹 / 🔁 của chốt tháng. Đóng các [OPEN] "không có đường chốt tay", "chạy lại không báo đã quét", "chưa có bot token vẫn chốt". AC viết lại (change [261015-chot-thang-va-keo-tich-san](../changes/archive/261015-chot-thang-va-keo-tich-san/proposal.md))

## Preconditions
- `now` rơi vào ngày 1 theo giờ VN; tin sáng bật (`notify_daily_enabled = '1'`).

## Main Flow
0. Tới giờ tin sáng ngày 1 (UC-401 bước 3c) → `daily` (UC-402).
1. `monthCloseInvite(db, now)`: không phải ngày 1 → `null`; `previewMonthClose(db, now)` (UC-207, chỉ đọc) cho tháng liền trước.
2. Tháng đã chốt (`month_closes` có dòng) hoặc không có phong bì chung nào dương (`positiveTotal = 0`) → `null`.
3. Ngược lại `monthClose = { month, profit, covered }`. Cron **không ghi** giao dịch, lệnh chuyển hay `month_closes`.
4. Tin sáng (UC-402) thêm, cuối phần việc cần làm (sau 🏠, trước các dòng thông tin):
   - `profit > 0` → `📌 Tháng <m>: dư <tiền> sau khi bù chi lố — mở app để chốt`
   - `profit = 0`, `covered > 0` → `📌 Tháng <m>: chi lố được bù <tiền>, không còn dư — mở app để chốt`
   Bản ngắn thêm mục `chốt tháng <m>`.

## Alternative Flows
- 0a. Tin sáng tắt → ngày 1 không chạy gì: không câu mời, không ghi mốc `daily_run`, không giao dịch `S…`. Người vẫn chốt từ thẻ Hôm nay (pwa UC-702).
- 2a. Tháng đã chốt trước giờ tin sáng → không mời.
- 2b. `profit = 0` và `covered = 0` → không có dòng 📌.

## Exceptions
- E1. `previewMonthClose` ném lỗi (vd nhà chưa có ví Tích sản — `DomainError("config")`) → `daily` dừng, không gửi tin sáng; mốc `daily_run` được nhả nên lượt cron kế tiếp thử lại (UC-401 bước 3c, E1).

## Acceptance Criteria
### AC-1: Ngày 1 mời chốt, không ghi gì (MODIFIED v5)
- Given tháng 9 đã chia lương 40.000.000 ₫, Ăn uống âm 500.000 ₫
- When `daily` chạy 07:00 VN 1/10
- Then không có giao dịch `batch_id='S202609'`; tin có `📌 Tháng 9: dư 4.140.000 ₫ sau khi bù chi lố — mở app để chốt`
- Tests: [`test/cron-daily.test.ts`](../../test/cron-daily.test.ts) › "ngày 1: chốt tháng trước › UC-207 AC-2: ngày 1 cron không tạo giao dịch S…; tin sáng có câu mời \"Tháng 9: dư 4.140.000 ₫ sau khi bù chi lố — mở app để chốt\""

### AC-2: Không có gì để chốt, hoặc đã chốt, thì không mời (MODIFIED v5)
- Given không ví dương, không ví âm; hoặc tháng đã chốt trước giờ tin sáng
- When `daily` chạy 1/10
- Then tin không có dòng 📌
- Tests: [`test/cron-daily.test.ts`](../../test/cron-daily.test.ts) › "ngày 1: chốt tháng trước › UC-207 AC-3: không ví dương, không ví âm → không có dòng mời chốt" · "… › UC-207: tháng đã chốt trước giờ tin sáng → không mời"

### AC-3: Câu mời đúng câu chữ, đúng vị trí (MODIFIED v5)
- Given `monthClose` còn dư; chỉ có bù; `profit 0` và `covered 0`
- When `dailyMessage`
- Then dòng `📌 … — mở app để chốt` / câu riêng khi chỉ có bù / không có dòng
- Tests: [`test/format.test.ts`](../../test/format.test.ts) › "dailyMessage › UC-207 AC-2: dòng 📌 mời chốt khi còn dư; câu riêng khi chỉ có bù; profit 0 và covered 0 → không có dòng"; [`test/cron-daily.test.ts`](../../test/cron-daily.test.ts) › "ngày 1: chốt tháng trước › UC-207 AC-2: chỉ có bù, không còn dư → \"Tháng 9: chi lố được bù …, không còn dư — mở app để chốt\""

### AC-4: Không phải ngày 1 thì không mời
- Given `now` là ngày 2..31 (VN)
- When `daily` chạy
- Then `monthCloseInvite` trả `null` trước khi đọc sổ
- Tests: ⚠ Chưa có test (gián tiếp: các test `daily` ngày thường không có dòng 📌, nhưng không test khẳng định)

### AC-5: Tắt tin sáng thì ngày 1 không chạy gì (MODIFIED v5)
- Given `notify_daily_enabled = '0'`
- When các lượt ngày 1/10 sau giờ tin sáng
- Then không ghi mốc `daily_run`, không có giao dịch `S…`, không tin nào được gửi
- Tests: [`test/cron-schedule.test.ts`](../../test/cron-schedule.test.ts) › "giờ nhắc: tin sáng theo giờ ở Cài đặt › UC-207 AC-2: tắt tin sáng → ngày 1 không chạy gì, không ghi mốc daily_run, không có giao dịch S…"; [`test/cron-schedule.test.ts`](../../test/cron-schedule.test.ts) › "giờ nhắc: lượt chưa tới giờ không tốn thêm truy vấn › chưa tới giờ (kể cả ngày 1) hay đã gửi rồi: chỉ một câu đọc lịch + mốc, không chốt tháng, không gửi"

## Traceability
- Code: `src/cron/daily.ts` › `monthCloseInvite`, `daily`; `src/cron/schedule.ts` › `runScheduledDigests`; `src/services/ledger.ts` › `previewMonthClose`; `src/notify/format.ts` › `dailyMessage` (`monthClose`, 📌)
- Migrations/DB: `month_closes` (`migrations/0034_month_closes.sql`, thuộc allocation)

## Divergences & Open Questions
- [OPEN] Nhà chưa có ví Tích sản thì ngày 1 `previewMonthClose` ném lỗi `config` → tin sáng ngày 1 không gửi (giữ như cũ, báo cáo CloseBackend).
