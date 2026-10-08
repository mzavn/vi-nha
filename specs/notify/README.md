# Context: notify — lịch cron, tin Telegram, thông báo đẩy & Zalo

Nhịp đồng hồ của hệ thống và chiều ra thông báo. Hai biểu thức cron của Worker (khai ở `wrangler.jsonc`, điều phối ở `src/cron/index.ts`) cùng vào một lượt: mỗi 15 phút, riêng 01:00–03:59 VN mỗi giờ (ADR-70). Lượt này sinh tin sáng, tổng kết tuần, các lời nhắc gắn theo ngày (Chủ nhật, ngày 1, 10, 25) theo **Giờ nhắc** cả nhà chỉnh ở Cài đặt (mặc định 07:00 và 08:00 thứ Hai, ADR-68), cảnh báo giao dịch chưa gán (có giờ yên lặng), và ở lượt 02:00 thì chạy thêm rà soát của ingest (UC-304). Mọi tin đi qua một cửa gửi duy nhất (`notifyMembers`) có chống gửi trùng bằng bảng `notifications`; cửa này gửi qua ba kênh: Telegram (UC-408), thông báo đẩy tới từng máy đã bật trên PWA (UC-410, từ change `261001-pwa-web-push`) và Zalo Bot (UC-411, ADR-80). Context này **chỉ đọc số** từ ledger/allocation/ingest và **kích hoạt** chốt tháng; engine chốt tháng thuộc allocation (UC-207), rà soát 02:00 thuộc ingest (UC-304).

Chỉ có chiều ra: bot không nhận lệnh (`plans/260921-2228-profit-first-pwa/phase-07-cron-telegram.md` § Telegram: "Chiều vào … ngoài phạm vi V1"). Ngoại lệ duy nhất là webhook Zalo (`POST /webhooks/zalo`, UC-411): bot Zalo đọc tin nhắn chỉ để **nối** chat với thành viên bằng mã 6 số (Zalo chỉ cho biết `chat_id` khi người dùng nhắn bot) — không có lệnh nào khác.

## Ngôn ngữ chung

| Thuật ngữ | Nghĩa trong context này |
|---|---|
| Giờ VN | UTC+7, không giờ mùa hè. Mọi "hôm nay / hôm qua / thứ mấy / ngày mấy" tính theo giờ VN (`src/domain/period.ts` › `dayKey`, `weekKey`). **Biểu thức cron thì theo UTC** — xem UC-401. |
| Tin sáng | Tin tổng hợp gửi mỗi ngày vào giờ tin sáng (mặc định 07:00 VN, UC-402), gộp cả các lời nhắc theo ngày (UC-403..405). |
| Tổng kết tuần | Tin vào thứ và giờ đã chọn (mặc định 08:00 VN thứ Hai) về tuần ISO vừa kết thúc — Chủ nhật thì tuần kết thúc hôm đó (UC-406). |
| Giờ nhắc | Bộ giờ dùng chung cả nhà trong `config` (`notify_*`): giờ tin sáng, thứ + giờ tổng kết tuần, giờ yên lặng, bật/tắt từng loại. Giờ VN, bội số 15 phút. Xem `entities.md` § Giờ nhắc. |
| Giờ yên lặng | Khung `[quiet_start, quiet_end)` (mặc định 22:00–06:30) không báo giao dịch chưa gán; hết khung thì gom lại báo một tin (UC-407). Không ảnh hưởng tin sáng / tổng kết tuần. |
| Mốc chạy | Dòng `notifications(kind='daily_run'/'weekly_run', chat_id='system')` giành được trước khi chạy tin theo giờ — mỗi ngày (tuần) chỉ một lượt cron giành được (UC-401). |
| Sắp vỡ | Ví `kind='envelope'` thuộc phe Vận hành (`tier` `must`/`nice`) đã tiêu ≥ 80% dự kiến tuần (nếu ví có dự kiến tuần) hoặc dự kiến tháng. Chỉ là một dòng trong tin sáng, không có cảnh báo tức thời. |
| Chưa gán | `bank_logs.status='pending'` — cùng nghĩa với ingest. |
| Đã báo (log chưa gán) | Có dòng `notifications(kind='pending_log', day_key=<log id>, ok=1)`: tin gộp chứa log đó đã gửi thành công tới **ít nhất một** người nhận Telegram hoặc một máy đã bật thông báo (UC-407). |
| Chuyển tiền cần làm quá hạn | `transfer_orders.status='pending'` và `created_at` cũ hơn 3 ngày (theo đồng hồ DB). |
| Đêm qua vá | Số log mà cron rà soát 02:00 (UC-304, ingest) tạo thêm, đọc từ `notifications(kind='backfill')`; lượt thứ Hai soát cả tuần trước, lượt ngày 1 soát cả tháng trước (`scope`, ADR-78). |
| Cần xem tay | Số dòng `notifications(kind='ingest_error')` trong 24 giờ qua (ingest ghi, UC-308). |
| Người nhận | Kênh Telegram: thành viên `members.active=1` có `tg_chat_id` khác rỗng (Member thuộc context access, UC-507). Kênh push: mỗi **máy đã bật** của thành viên `active=1` (UC-410). Kênh Zalo: thành viên `active=1` có `zalo_chat_id` (đã nối bằng mã, UC-411). Một người có thể nhận ở cả ba kênh và trên nhiều máy. |
| Máy đã bật (push subscription) | Một trình duyệt/PWA trên một thiết bị đã cho phép thông báo và gửi subscription lên server — một dòng `push_subscriptions`, gắn với người đăng nhập lúc gửi lên (UC-410, pwa UC-714). |
| `day_key` (của `notifications`) | ⚠ **Khác nghĩa với `day_key` ở nơi khác**: đây là *khoá chống trùng theo từng `kind`*, không phải lúc nào cũng là ngày — có thể là tuần ISO (`2026-W39`), timestamp ISO, id của log, hay chuỗi ghép `<ngày>:<nguồn>:<ref>`. Xem `entities.md`. |
| `chat_id` (của `notifications`) | ⚠ Không phải lúc nào cũng là chat Telegram: tin push dùng `'push:<id push_subscriptions>'`; tin Zalo và câu hướng dẫn của bot Zalo dùng `'zalo:<zalo_chat_id>'`; dòng đánh dấu nội bộ dùng `'system'` hoặc `account_id`. |
| Bản đầy đủ / bản ngắn | Mỗi tin có hai bản dựng cùng lúc từ cùng số liệu (ADR-79): **bản đầy đủ** (`full`) gửi Telegram — HTML, mọi dòng, < 4096 ký tự — và Zalo (đã bỏ thẻ, ≤ 2000 ký tự, ADR-80); **bản ngắn** (`push: { title, body }`) gửi thông báo đẩy — chữ thường, tiêu đề ≤ 25 ký tự mang con số chính, nội dung ≤ 150 ký tự. |
| Nối Zalo / mã nối | Thành viên bấm **Nối Zalo** ở Cài đặt, app tạo mã 6 số hạn 15 phút (`zalo_link_codes`); người đó nhắn mã cho bot Zalo của nhà trong chat riêng, webhook ghi `members.zalo_chat_id` (UC-411, access UC-507). |
| Việc cần làm / thông tin | Hai nhóm dòng của tin sáng. **Việc cần làm**: chưa gán, cần xem tay, chuyển tiền quá hạn, sắp vỡ, ngày 10/25 chưa chia, Chủ nhật đếm ví, ngày 1 chốt người thuê / quét tháng. **Thông tin**: mục tiêu / Quỹ an tâm, nợ, phải thu, đối soát, tự ghép, vá đêm. Việc cần làm luôn đứng trước — ở cả hai bản (UC-402). |

## Danh sách Use Case

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-401](UC-401-lich-cron-va-dieu-phoi.md) | Lịch cron & điều phối | implemented | BR-06, BR-10 |
| [UC-402](UC-402-tin-sang-0700.md) | Tin sáng (giờ nhắc, mặc định 07:00) | implemented | BR-01, BR-04, BR-06, BR-07 |
| [UC-403](UC-403-kich-hoat-chot-thang-ngay-1.md) | Kích hoạt chốt tháng ngày 1 | implemented | BR-02, BR-06, BR-07 |
| [UC-404](UC-404-nhac-dem-vi-chu-nhat.md) | Nhắc đếm ví / nhập số dư Chủ nhật | implemented | BR-04, BR-06 |
| [UC-405](UC-405-nhac-khoan-thu-chua-chia-ngay-10-25.md) | Nhắc khoản thu chưa chia ngày 10 & 25 | implemented | BR-02, BR-06 |
| [UC-406](UC-406-tong-ket-tuan-thu-hai.md) | Tổng kết tuần (giờ nhắc, mặc định 08:00 thứ Hai) | implemented | BR-01, BR-06 |
| [UC-407](UC-407-bao-giao-dich-chua-gan-moi-phut.md) | Báo giao dịch chưa gán (mỗi 15 phút, có giờ yên lặng) | implemented | BR-03, BR-04, BR-06 |
| [UC-408](UC-408-gui-telegram-chong-gui-trung.md) | Gửi tin Telegram chống gửi trùng | implemented | BR-06, BR-08, BR-09 |
| [UC-409](UC-409-bao-luong-ve-da-chia.md) | Báo lương về & đã chia | spec-only | BR-02, BR-06 |
| [UC-410](UC-410-gui-thong-bao-day-web-push.md) | Gửi thông báo đẩy tới máy đã bật (Web Push) | implemented | BR-06, BR-09 |
| [UC-411](UC-411-gui-tin-zalo-bot.md) | Gửi tin qua Zalo Bot (nối bằng mã) | implemented | BR-06, BR-08, BR-09 |

Entity: xem [`entities.md`](entities.md) — `Notification`, `PushSubscription`, `CronTrigger`, Giờ nhắc, các giá trị tin (`DailyMessageInput`, `WeeklyMessageInput`, `PendingLog`) và cặp tin `NotifyMessage` (bản đầy đủ + bản ngắn).

## Code thuộc context này
- `wrangler.jsonc` › `triggers.crons`
- `src/cron/index.ts`, `src/cron/schedule.ts`, `src/cron/daily.ts`, `src/cron/weekly.ts`, `src/cron/pending-notifier.ts`, `src/domain/notify-schedule.ts`, `migrations/0011_notify_schedule.sql`, `migrations/0012_notify_schedule_15min.sql`
  (`src/cron/backfill.ts` thuộc ingest — UC-304)
- `src/notify/telegram.ts`, `src/notify/format.ts`, `src/notify/zalo.ts`
- `src/services/push.ts`, `src/routes/push.ts` (`/v1/push`, mount sau `requireAuth`; lượt "Thử khi tắt app" gửi nền trong request, UC-410), `migrations/0008_push_subscriptions.sql`, `migrations/0009_push_test_series.sql`
- `src/services/zalo.ts` (mã nối, xử lý webhook, Đặt webhook, gửi thử — UC-411; route ở `src/routes/webhooks.ts` và `src/routes/settings.ts`), `migrations/0018_zalo.sql`
- `src/index.ts` › handler `scheduled` (chỉ phần gọi `runScheduled`)
- Tests: `test/cron-schedule.test.ts`, `test/cron-daily.test.ts`, `test/cron-weekly.test.ts`, `test/format.test.ts`, khối `describe("cron/pending-notifier — gom log pending ≥ 60 giây")` trong `test/cron-sepay.test.ts`, `test/push.test.ts`, `test/zalo.test.ts`
