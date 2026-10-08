# Entity Model — notify

## Notification (bảng `notifications`)

**Nghĩa:** sổ "đã gửi / đã đánh dấu" dùng để chống làm lại. Mỗi dòng là một *lời hứa làm đúng một lần* cho bộ khoá `(kind, day_key, chat_id)`: hoặc một tin Telegram cho một người nhận, hoặc một thông báo đẩy cho một máy đã bật (từ change `261001-pwa-web-push`), hoặc một tin Zalo cho một chat Zalo (ADR-80), hoặc một dấu nội bộ (không gửi gì) mà cron khác đọc lại. Không phải hộp thư: nội dung tin chỉ được lưu làm bằng chứng (`payload`), không ai gửi lại từ bảng này.

Định nghĩa: `migrations/0001_schema.sql` (mục "12. THÔNG BÁO — idempotent cho cron"), bản sao ở `docs/schema.sql`. Không migration nào sau đó sửa bảng này.

| Trường | Nghĩa nghiệp vụ / luật |
|---|---|
| `id` | khoá kỹ thuật, không mang nghĩa. |
| `at` | thời điểm ghi, `DEFAULT (datetime('now'))` — đồng hồ DB, UTC, dạng `YYYY-MM-DD HH:MM:SS`. Tin sáng đếm `ingest_error` theo cột này (24 giờ qua). |
| `kind` | loại việc; quyết định nghĩa của `day_key`, `chat_id`, `payload` (bảng dưới). |
| `day_key` | khoá chống trùng *trong* một `kind` — **không nhất thiết là ngày**. |
| `chat_id` | tin thật: người nhận Telegram (`members.tg_chat_id`) **hoặc** `'push:<id>'` — một máy đã bật thông báo (`push_subscriptions.id`, UC-410) **hoặc** `'zalo:<zalo_chat_id>'` — một chat Zalo đã nối (UC-411); dấu nội bộ: `'system'` hoặc `account_id`. Gửi thử push (`POST /v1/push/test`), gửi thử Zalo và câu "Đã nối Zalo" của bot không ghi bảng này. |
| `payload` | tin nhắn đã gửi (tin thật — dòng Telegram: bản đầy đủ HTML; dòng `push:<id>`: bản ngắn đã gửi, `title` + xuống dòng + `body`, ADR-79; dòng `push:<id>` ghi trước ADR-79 vẫn là văn bản HTML của Telegram; dòng `zalo:<id>`: chữ thường đã gửi, `zaloText(full)`) hoặc JSON nhỏ (dấu nội bộ). |
| `ok` | `0` mặc định. Tin thật: `1` = Telegram / push service / Zalo nhận, `0` = đang gửi **hoặc** gửi hỏng (không phân biệt được). Dấu nội bộ: ghi thẳng `1`. |

### Các `kind` đang có trong code

| `kind` | Ai ghi | `day_key` | `chat_id` | `payload` | `ok` | Ai đọc |
|---|---|---|---|---|---|---|
| `daily` | `notifyMembers` từ `src/cron/daily.ts` › `daily` | `dayKey(now)` giờ VN, `2026-09-22` | chat của thành viên, `push:<id>` hoặc `zalo:<id>` | văn bản tin | 0 → 1/0 | — |
| `weekly` | `notifyMembers` từ `src/cron/weekly.ts` › `weekly` | `weekKey` của tuần được tổng kết (`summarisedSunday`), `2026-W39` | chat của thành viên, `push:<id>` hoặc `zalo:<id>` | văn bản tin | 0 → 1/0 | — |
| `daily_run` | `src/cron/schedule.ts` › `claimRun` (giành mốc trước khi chạy tin sáng / chốt tháng), `INSERT OR IGNORE` | `dayKey(now)` giờ VN | `'system'` | `NULL` | 1 | `loadNotifyState` (`MAX(day_key)`) — đã chạy hôm nay chưa; việc lỗi thì `runClaimed` xoá dòng |
| `weekly_run` | `claimRun` trước khi chạy tổng kết tuần | `weekKey` của tuần được tổng kết | `'system'` | `NULL` | 1 | `loadNotifyState` — tuần này đã tổng kết chưa |
| `pending_batch` | `notifyMembers` từ `src/cron/pending-notifier.ts` › `notifyPendingLogs` | `now.toISOString()` — mỗi lần chạy một khoá mới | chat của thành viên, `push:<id>` hoặc `zalo:<id>` | văn bản tin | 0 → 1/0 | — |
| `pending_log` | `notifyPendingLogs`, chỉ sau khi tin gộp gửi được ≥ 1 người nhận, ≥ 1 máy hoặc ≥ 1 chat Zalo | `bank_logs.id` | `'system'` | `{"amount","direction"}` | 1 (`ON CONFLICT … DO UPDATE SET ok = 1`) | `notifyPendingLogs` (loại log đã báo) |
| `backfill` | ingest: `src/cron/backfill.ts` (UC-304), `INSERT OR IGNORE` | `dayKey(now)` của lần chạy 02:00 VN | `'system'` | `{"added":n,"scope":"day"\|"week"\|"month"}` — `scope` = khoảng rà của lượt đó (ADR-78); dòng ghi trước ADR-78 chỉ có `added` | 1 | `daily` (dòng 🩹) |
| `ingest_error` | ingest: `src/services/ingest.ts` › `recordIngestError` (UC-308) | `<dayKey>:<source>:<ref ≤64 ký tự>` | `'system'` | `{"source","message ≤200"}` | 1 | `daily` (dòng ❗, đếm theo `at` trong 1 ngày) |
| `reconcile_drift` | Không còn ghi từ ADR-87 (2026-10-06, migration 0023 — bỏ số lũy kế SePay); dòng cũ do `checkReconcileDrift` (UC-308 v1–v4) ghi nằm lại, vô hại | `dayKey(now)` | `account_id` | `NULL` | 1 | Không ai đọc |
| `zalo_help` | `src/services/zalo.ts` › `handleZaloUpdate` (UC-411), `INSERT OR IGNORE` trước khi bot trả lời câu hướng dẫn cho tin chat riêng không nối được (chỉ khi đã có bot token) | `dayKey(now)` giờ VN của lúc nhận tin | `'zalo:<chat.id>'` | `NULL` | 1 (ghi thẳng lúc claim, kể cả khi câu trả lời gửi hỏng) | `handleZaloUpdate` (giành được mới trả lời — tối đa một lần mỗi chat mỗi ngày) |
| `zalo_limited` | `handleZaloUpdate` (UC-411, ADR-90), `INSERT OR IGNORE` trước khi trả lời chat đã nhắn sai mã quá 5 lần / giờ | `dayKey(now)` giờ VN | `'zalo:<chat.id>'` | `NULL` | 1 | `handleZaloUpdate` (một câu "nhắn sai quá nhiều" mỗi chat mỗi ngày) |
| `security` | `alertMembers` (`src/services/audit.ts`, ADR-90) qua `notifyMembers`, và claim riêng cho kênh cũ vừa bị thay/gỡ | `'audit:<audit_log.id>'` | chat của thành viên, `push:<id>`, `zalo:<id>`, hoặc chat cũ | văn bản cảnh báo | 0 → 1/0 (kênh cũ ghi 1 lúc claim) | — |

### Trạng thái (chỉ với tin thật: `daily`, `weekly`, `pending_batch`)
```
(không có dòng) --claim: INSERT OR IGNORE, ok=0--> ĐANG GỬI --Telegram / push service / Zalo 2xx--> ĐÃ GỬI (ok=1)
                                                          \--hết lượt thử, push 404/410, hoặc Zalo 429--> HỎNG (ok=0, kết thúc)
```
- Không có chuyển trạng thái nào từ HỎNG về lại ĐANG GỬI: claim lần sau cùng khoá bị `INSERT OR IGNORE` bỏ qua (`src/notify/telegram.ts` › `notifyMembers`, `src/services/push.ts` › `pushToMembers`, `src/notify/zalo.ts` › `zaloToMembers`). Vì vậy tin `daily`/`weekly` hỏng là mất; chỉ `pending_*` được thử lại, nhờ khoá `pending_batch` mới mỗi lượt cron và điều kiện `pending_log.ok = 1`.
- Push service trả 404/410: dòng `push:<id>` thành HỎNG **và** máy bị xoá khỏi `push_subscriptions` (UC-410).
- Không có thời hạn lưu / dọn dẹp bảng. [OPEN]

### Bất biến
- **I1. Mỗi bộ `(kind, day_key, chat_id)` có tối đa một dòng** → mỗi người nhận Telegram, mỗi máy đã bật và mỗi chat Zalo nhận một tin cho mỗi `(kind, day_key)`. Nơi chặn: `UNIQUE (kind, day_key, chat_id)` trong `migrations/0001_schema.sql`; code dùng `INSERT OR IGNORE` và đọc `meta.changes` để biết mình có giành được quyền gửi không (`notifyMembers`, `pushToMembers`, `zaloToMembers`, `handleZaloUpdate`).
- **I2. Ghi trước, gửi sau** (claim-before-send) cho tin thật: hai lần chạy cron trùng nhau không thể cùng gửi cho một người. Nguồn quyết định: `docs/core_design_rules.md` §8, phase-07 § Telegram.
- **I3. Log chưa gán chỉ được đánh dấu "đã báo" sau khi gửi thành công** (khác I2 — đổi ở commit `b468f54`). Nơi chặn: `notifyPendingLogs` (`if (sent === 0) return;` trước `DB.batch`).
- I4. Mọi writer hiện tại đều truyền `day_key` và `chat_id` khác NULL, nên I1 có hiệu lực (SQLite coi các NULL trong UNIQUE là khác nhau). [OPEN] không có CHECK NOT NULL ở DB bảo đảm điều này.

### Quan hệ
- `chat_id` của tin Telegram = `Member.tg_chat_id` (Member thuộc access, UC-507) — không có FK.
- `chat_id` của tin push = `'push:' || PushSubscription.id` — không có FK; dòng `notifications` ở lại khi máy bị xoá.
- `chat_id` của tin Zalo = `'zalo:' || Member.zalo_chat_id` — không có FK; hai thành viên nối cùng một chat Zalo dùng chung một dòng (chat đó nhận một tin).
- `day_key` của `pending_log` = `BankLog.id` (ingest) — không có FK.
- `chat_id` của `reconcile_drift` (dòng cũ) = `Account.id` (ledger) — không có FK.

## PushSubscription (bảng `push_subscriptions`)

**Nghĩa:** một máy (trình duyệt/PWA trên một thiết bị) đã bật thông báo, gắn với **một** thành viên — người đang đăng nhập lúc máy gửi subscription lên. Một người có thể có nhiều máy; một máy chỉ thuộc một người tại một thời điểm.

Định nghĩa: `migrations/0008_push_subscriptions.sql` (schema v1.7 → v1.8), bản sao ở `docs/schema.sql` mục 16.

| Trường | Nghĩa nghiệp vụ / luật |
|---|---|
| `id` | `INTEGER PRIMARY KEY`; dùng trong `notifications.chat_id = 'push:<id>'` và để PWA nhận ra "máy này" (`localStorage` `vi-nha:push`, UC-714). |
| `member_id` | `NOT NULL REFERENCES members(id)`, index `idx_push_member`. Đăng ký lại cùng `endpoint` thì chuyển sang người đang gọi (`subscribe`). |
| `endpoint` | URL push service của máy, `UNIQUE`; server chỉ nhận `https:` ≤ 1000 ký tự thuộc `PUSH_HOSTS` (FCM, Mozilla, `*.push.apple.com`, `*.notify.windows.com` — ADR-90). **Không bao giờ trả ra API** — ai có `endpoint` gỡ được máy (`unsubscribe` không kiểm chủ); máy nào cũng gỡ được theo `id` (`removeSubscription`). |
| `p256dh`, `auth` | Khoá công khai và bí mật xác thực của máy (base64url) để mã hoá nội dung push (`aes128gcm`). Không trả ra API. |
| `user_agent` | Header `User-Agent` của request đăng ký (ADR-90 — không nhận từ body), cắt 500 ký tự; request không có header thì giữ cũ. API chỉ trả nhãn suy ra (`device`, `deviceLabel`). |
| `created_at` | `DEFAULT (datetime('now'))`, UTC. |
| `last_ok_at` | Lần cuối push service nhận tin cho máy này (`sendPush` 2xx), UTC; `NULL` = chưa nhận tin nào. |

### Vòng đời
```
(không có) --POST /v1/push/subscriptions (201)--> GẮN người A
GẮN người A --cùng endpoint, người B đăng ký (200)--> GẮN người B
GẮN --POST /v1/push/subscriptions/remove | DELETE /v1/push/subscriptions/:id | push service 404/410--> (xoá dòng)
```
- Thành viên `active = 0`: dòng còn, không nhận tin (`pushToMembers` JOIN `members.active = 1`).

### Bất biến
- **P1. Một `endpoint` một dòng** (`UNIQUE`), upsert `ON CONFLICT (endpoint)` (`subscribe`).
- **P3. Mỗi thành viên tối đa 10 máy** (`MAX_DEVICES_PER_MEMBER`, ADR-90): `subscribe` từ chối máy mới (kể cả chuyển từ người khác) khi người gọi đã có 10. Chỉ thi hành ở code, không có ràng buộc DB.
- **P2. Push service đã báo máy chết (404/410) thì dòng bị xoá ngay** (`sendPush`), không thử lại.
- `id` là `INTEGER PRIMARY KEY` không `AUTOINCREMENT`: xoá máy có `id` lớn nhất rồi đăng ký máy mới thì SQLite có thể cấp lại đúng `id` đó — dòng `notifications` cũ `push:<id>` khi ấy chỉ sang máy mới. [OPEN] (UC-410)

## PushTestSeries (bảng `push_test_series`)

**Nghĩa:** một lượt "Thử khi tắt app" (UC-714) — 1–2 tin thử tới **mọi máy** của một thành viên, để người đó tắt app rồi xem thông báo có về không. Bấm nút ghi dòng `running`; chính request đó gửi nền qua `waitUntil` (chờ 10 giây rồi tin 1, thêm 10 giây tin 2 — UC-410 bước 12–14), nên app tắt vẫn nhận. Cron mỗi phút chỉ dọn lượt kẹt (bước 15).

Định nghĩa: `migrations/0009_push_test_series.sql` (schema v1.8 → v1.9), bản sao ở `docs/schema.sql` mục 17.

| Trường | Nghĩa nghiệp vụ / luật |
|---|---|
| `id` | `INTEGER PRIMARY KEY`; nằm trong `tag` của từng tin (`test-series-<id>-<i>`). |
| `member_id` | `NOT NULL REFERENCES members(id)` — người hẹn; tin tới mọi máy của người này lúc gửi. |
| `count` | Số tin. DB `CHECK 1–5` (từ bản đầu, khi cron gửi); API v3 chỉ nhận 1–2, mặc định 2. |
| `interval_s` | Giây giữa hai tin. DB `CHECK 10–60`; API v3 chỉ nhận đúng 10 (tin 1 luôn sau 10 giây chờ cố định). |
| `status` | `pending` · `running` · `done` · `cancelled` (`CHECK`), DB mặc định `pending`. API v3 ghi thẳng `running`; `pending` chỉ còn ở dòng của bản đầu. |
| `sent` | Số tin đã gửi (mỗi tin tới mọi máy), ghi sau từng tin. |
| `created_at` | `DEFAULT (datetime('now'))`, UTC. Lượt quá 15 phút không hiện ở `GET /v1/push`; còn `pending`/`running` quá 10 phút thì cron đổi `cancelled`. |

### Vòng đời
```
(không có) --POST /v1/push/test-series (201)--> running --gửi đủ / hết máy--> done
running --POST …/cancel (dừng trước tin kế tiếp)--> cancelled
pending | running --quá 10 phút (Worker bị dừng giữa chừng), cron mỗi phút--> cancelled
```

### Bất biến
- **S1. Một lượt chỉ một việc gửi**: việc nền do chính request tạo dòng đưa vào `waitUntil`; không có đường nào khác gửi (`runTestSeries`).
- **S2. Mỗi người tối đa một lượt `pending`/`running`**: kiểm và chèn trong một câu `INSERT … SELECT … WHERE NOT EXISTS` (`createTestSeries`); không có ràng buộc ở DB. Lượt kẹt hết chặn khi bấm Huỷ hoặc khi cron huỷ (≤ 10 phút).
- Không ghi `notifications`; không có dọn dẹp bảng. [OPEN] (UC-410)

## Khoá VAPID (cấu hình, không phải bảng)
Ba dòng trong `config` (Config thuộc access — xem [access/entities.md](../access/entities.md)): `secret:vapid_private_jwk` (khoá riêng ECDSA P-256 dạng JWK — bí mật), `vapid_public` (khoá công khai raw 65 byte, base64url, trả cho PWA làm `applicationServerKey`), `vapid_subject` (origin của request sinh khoá, làm `sub` của JWT). Tự sinh một lần ở `ensureVapid` (UC-410 bước 1); cron chỉ đọc (`loadVapid`).

## CronTrigger (cấu hình, không phải bảng)

**Nghĩa:** một nhịp đồng hồ của Worker. Khai **hai nơi phải giống hệt nhau từng ký tự**: `wrangler.jsonc` › `triggers.crons` (Cloudflare gọi theo lịch này) và `src/cron/index.ts` › `CRONS` (điều phối so sánh chuỗi `event.cron`). Lệch nhau → job không chạy, chỉ có `console.warn("cron lạ: …")`. Không có kiểm tra tự động nào giữ hai nơi khớp nhau. [OPEN]

| Khoá `CRONS` | Biểu thức (UTC) | Giờ VN | Handler | Context sở hữu việc |
|---|---|---|---|---|
| `quarterHour` | `*/15 0-17,21-23 * * *` | mỗi 15 phút, trừ 01:00–03:59 (84 lượt/ngày) | `tick` | notify (UC-401..407, UC-410), gọi chốt tháng của allocation (UC-207) |
| `nightHourly` | `0 18,19,20 * * *` | 01:00, 02:00, 03:00 (3 lượt/ngày) | `tick` | như trên; lượt 02:00 thêm rà soát của ingest (UC-304) |

`tick`: `runScheduledDigests` (tin sáng, tổng kết tuần theo Giờ nhắc) + `notifyPendingLogs` (khi bật, ngoài giờ yên lặng) + `cancelStaleTestSeries` + `backfill` (chỉ khi giờ VN đúng 02:00), song song bằng `Promise.allSettled` (ADR-70).

Trước ADR-68 còn hai cron cố định `0 0 * * *` (tin sáng 07:00) và `0 1 * * 1` (tổng kết tuần 08:00 thứ Hai); ADR-68 thay bằng `*/5 * * * *` + `0 19 * * *` (rà soát); ADR-70 thay cả hai bằng hai biểu thức trên.

## Giờ nhắc (cấu hình, không phải bảng)

**Nghĩa:** một bộ giờ dùng chung cả nhà cho tin theo lịch và báo giao dịch chưa gán (ADR-68). Tám dòng trong `config` (Config thuộc access — xem [access/entities.md](../access/entities.md)); `migrations/0011_notify_schedule.sql` chèn mặc định. Sửa qua `PATCH /v1/settings/notify-schedule` (access UC-507), đọc ở `GET /v1/settings` › `notifySchedule` (access UC-505), sửa trên PWA ở Cài đặt › Thông báo › Giờ nhắc (pwa UC-709).

| Khoá `config` | Trường API (`notifySchedule`) | Mặc định | Luật |
|---|---|---|---|
| `notify_daily_time` | `dailyTime` | `07:00` | giờ VN `HH:MM`, phút chia hết cho 15 (giờ trong 01:00–03:59 chạy ở lượt mỗi giờ kế tiếp); giờ tin sáng (UC-402..405) và giờ chốt tháng ngày 1 (UC-403) |
| `notify_daily_enabled` | `dailyEnabled` | `1` | `'1'`/`'0'`; tắt chỉ tắt tin, không tắt chốt tháng |
| `notify_weekly_day` | `weeklyDay` | `1` | thứ ISO 1 = thứ Hai .. 7 = Chủ nhật (UC-406) |
| `notify_weekly_time` | `weeklyTime` | `08:00` | như `notify_daily_time` |
| `notify_weekly_enabled` | `weeklyEnabled` | `1` | `'1'`/`'0'` |
| `notify_pending_enabled` | `pendingEnabled` | `1` | `'1'`/`'0'`; báo giao dịch chưa gán (UC-407) |
| `notify_quiet_start` | `quietStart` | `22:00` | đầu giờ yên lặng (tính vào giờ yên lặng) |
| `notify_quiet_end` | `quietEnd` | `06:30` | cuối giờ yên lặng (không tính vào); `start > end` là khung qua nửa đêm; `start = end` là không đặt |

- Đọc ở cron bằng một câu cùng với mốc `daily_run`/`weekly_run` (`src/cron/schedule.ts` › `loadNotifyState`), ở API bằng một câu riêng (`src/services/settings.ts` › `readNotifySchedule`). Cả hai đi qua `parseNotifySchedule`: khoá thiếu hay giá trị hỏng (giờ sai dạng, thứ ngoài 1–7, cờ khác `'0'`/`'1'`) thì dùng mặc định, không làm hỏng cron. Đọc không ép bội số 15 phút (giờ lệch bước chạy ở lượt kế tiếp); chỉ API ghi mới ép, và `migrations/0012_notify_schedule_15min.sql` đã làm tròn xuống các giờ đã lưu.
- Không theo từng người: hai thành viên nhận cùng giờ.

## Giá trị tin (value object, không lưu riêng)

- **`DailyMessageInput`** (`src/notify/format.ts`): số liệu đã tính sẵn cho tin sáng — `spendableThisWeek`, `daysLeftInWeek`, `atRisk[]`, `unassignedCount`, `goals[]`, `safetyFundMonthsCovered|null` (Quỹ an tâm, ADR-93 — chip "Quỹ an tâm x/y tháng"), `safetyFundMonthsTarget`, `driftAccounts[]`, `transferOrdersOverdue`, `pairedTransfersYesterday`, `backfillAddedLastNight`, `backfillScope?` (`day`/`week`/`month`), `unreadableBankTransactions?`, `monthClose|null`, `incomeReminder|null`, `cashCountReminder[]`. Luật: hàm định dạng **thuần** — không đọc DB, không biết giờ hiện tại (chú thích đầu `src/notify/format.ts`).
- **`WeeklyMessageInput`**: `weekLabel`, `envelopes[]` (đã tiêu/dự kiến), `topCategories[]` (≤ 5, đã sắp giảm dần), `totalSpent` (tổng chi cả tuần, spend − refund mọi danh mục — tiêu đề bản ngắn).
- **`PendingLog`**: `amount`, `direction`, `accountName|null` — một log chưa gán trong tin gộp UC-407.
- **`NotifyMessage`** (cặp tin, ADR-79): `full` — bản đầy đủ cho Telegram (HTML đã escape, < 4096 ký tự) và Zalo (đổi sang chữ thường bằng `zaloText`, ≤ 2000 ký tự — `ZALO_TEXT_MAX`, ADR-80); `push: { title, body }` (`PushText`, `src/services/push.ts`) — bản ngắn cho thông báo đẩy, chữ thường, `title` ≤ 25 ký tự (`PUSH_TITLE_MAX`), `body` ≤ 150 ký tự (`PUSH_BODY_MAX`), việc cần làm trước. `dailyMessage`, `weeklyMessage`, `pendingMessage` trả cặp này; `notifyMembers` nhận nó. Luật: hai bản dựng từ cùng số liệu trong cùng một hàm thuần.
- Văn bản cuối cùng chỉ được lưu dưới dạng `Notification.payload` (mỗi kênh lưu đúng bản nó nhận). Payload là bản ghi lịch sử, không viết lại: dòng gửi trước v1.28 giữ chữ cũ (ví dụ "Phao x/y tháng"); migration `0028_english_names.sql` không đụng bảng `notifications`.

## Entity của context khác được dùng (tham chiếu theo tên)
Member (`tg_chat_id`, `zalo_chat_id`, `active`) — access · ZaloLinkCode (mã nối Zalo) — access · IntegrationSecret `telegram_bot_token`, `zalo_bot_token`, `zalo_webhook_secret` — access · Config `secret:vapid_private_jwk`, `vapid_public`, `vapid_subject` — access · BankLog — ingest · Transaction, Account, CashCount, Snapshot (`safetyFund`), Budget — ledger · TransferOrder, AllocationRun, chốt tháng — allocation · Config `safety_fund_months` — access.
