# UC-408: Gửi tin Telegram chống gửi trùng
- Status: implemented
- BR: BR-06, BR-08, BR-09
- Decisions: `docs/core_design_rules.md` §8 ("Ghi `notifications` trước khi gửi (UNIQUE kind+day_key+chat_id) → cron chạy lại không gửi trùng"), §9 "Thông báo: Telegram bot"; phase-07 § Telegram và Todo "gửi lỗi: ghi ok=0 … thử lại tối đa 3 lần trong cùng lần chạy"; commit `c80ae89` (token đặt từ app); ADR-64 (kênh thứ hai: Web Push, change `261001-pwa-web-push`); ADR-79 (hai bản: Telegram nhận bản đầy đủ, máy nhận bản ngắn); ADR-80 (kênh thứ ba: Zalo Bot, nhận bản đầy đủ dạng chữ thường)
- Actor: các cron của notify (UC-402..407) gọi vào; Telegram Bot API; push service của các máy đã bật thông báo (UC-410); Zalo Bot API (UC-411)
- Trigger: hàm `notifyMembers(env, kind, dayKey, { full, push })` (không có route HTTP)

Từ v3 đây là **cửa gửi nhiều kênh**: Telegram (UC này), thông báo đẩy tới từng máy đã bật trên PWA (**UC-410 Gửi thông báo đẩy tới máy đã bật**) và — từ v5 — Zalo (**UC-411 Gửi tin qua Zalo Bot (nối bằng mã)**). Tên UC giữ nguyên vì ID vĩnh viễn.

Nơi cấu hình: bot token ở **UC-508 Quản lý kết nối SePay, khoá Telegram & gửi thử** (gồm cả nút "Gửi thử" — `testTelegram`, dùng chung `sendTelegram`; bot token và khoá webhook Zalo cũng ở đây), `tg_chat_id` và nối Zalo của thành viên ở **UC-507 Sửa thành viên / mã chuyển khoản / tham số**.

## History
- v1 (2026-09-22, commit `c6677a8`): `sendTelegram` (3 lượt thử, HTML) và `notifyMembers` (claim `INSERT OR IGNORE` trước khi gửi, ghi `ok` sau), token từ `env.TG_BOT_TOKEN`.
- v2 (2026-09-22, commit `c80ae89`): token lấy qua `getSecret(env, "telegram_bot_token")` — ưu tiên giá trị đặt ở màn Cài đặt (bảng `config`, khoá `secret:telegram_bot_token`), không có thì dùng `wrangler secret` `TG_BOT_TOKEN`; `sendTelegram` nhận `fetchImpl` để test/nút gửi thử.
- v3 (2026-10-01, commit `5dc53be`): `notifyMembers` gửi qua **mọi kênh**: Telegram như cũ, rồi `pushToMembers` (UC-410) tới từng máy đã bật, chống trùng cùng bảng `notifications` với `chat_id = 'push:<id>'`. Thiếu bot token chỉ bỏ kênh Telegram, **không còn trả 0 ngay**; số trả về cộng cả hai kênh. AC-4 sửa, thêm AC-7 (change `261001-pwa-web-push`).
- v4 (2026-10-03, commit `4e6d103`): tham số thứ tư là **cặp tin** `{ full, push: { title, body } }` dựng sẵn ở `src/notify/format.ts` (ADR-79): Telegram gửi và lưu `full`; kênh push nhận `push`. Chống trùng, claim-trước-gửi, số trả về không đổi. Thêm AC-8.
- v5 (2026-10-03, commit `5bd3117`): kênh thứ ba **Zalo** (ADR-80, UC-411) — sau kênh Telegram, trước kênh push, `zaloToMembers(env, kind, dayKey, full)` gửi bản đầy đủ đổi sang chữ thường tới mọi thành viên `active` có `zalo_chat_id` (khi có bot token Zalo), claim `chat_id = 'zalo:<chat_id>'`; số trả về cộng cả Zalo. Telegram và push không đổi.
- v6 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90, red-team INFRA-05) — mỗi lượt gọi Telegram chờ tối đa 10 giây (hết giờ = lỗi mạng, thử lại như cũ). `notifyMembers` có thêm người gọi: cảnh báo kênh/khoá đổi (`alertMembers`, kind `security`, `day_key = audit:<id>`, access UC-507/UC-508). AC không đổi.

## Preconditions
- Kênh Telegram: có token (app hoặc wrangler secret). Kênh push: xem UC-410. Kênh Zalo: xem UC-411. Thiếu cả ba thì không gửi gì.

## Main Flow
1. `token = getSecret(env, "telegram_bot_token")`.
2. Lấy người nhận: `members` có `active = 1` và `tg_chat_id` khác NULL, khác rỗng.
3. Với **từng** người nhận, tuần tự:
   1. Claim: `INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload=full)` (`ok` mặc định 0).
   2. Không chèn được (đã có dòng cùng khoá) → bỏ qua người này.
   3. `sendTelegram(token, chatId, full)`: `POST https://api.telegram.org/bot<token>/sendMessage` với `{chat_id, text: full, parse_mode: "HTML", disable_web_page_preview: true}`.
   4. Cập nhật `ok = 1` nếu gửi được, `ok = 0` nếu không (và `console.error("[telegram] <kind> <dayKey>: <lỗi>")`).
4. Kênh push: `pushToMembers(env, kind, dayKey, push)` (UC-410) — mỗi máy đã bật của thành viên `active` một claim `chat_id = 'push:<id>'`, cùng luật claim-trước-gửi; máy nhận bản ngắn, không nhận `full`.
4b. Kênh Zalo (chạy ngay sau Telegram, trước kênh push ở bước 4): `zaloToMembers(env, kind, dayKey, full)` (UC-411) — có bot token Zalo thì mỗi chat Zalo của thành viên `active` một claim `chat_id = 'zalo:<chat_id>'`, cùng luật claim-trước-gửi; gửi `zaloText(full)` (bỏ thẻ, ≤ 2000 ký tự). Không có token → bỏ qua kênh này.
5. Trả **tổng** số tin gửi thành công: số người nhận Telegram + số máy nhận push + số chat Zalo nhận.

### Luật thử lại của `sendTelegram`
- Tối đa 3 lượt trong cùng một lần gọi; nghỉ `500 ms × số lượt` giữa các lượt.
- HTTP 2xx → thành công ngay.
- HTTP 5xx, 429, hoặc lỗi mạng (exception) → thử lượt tiếp. Mỗi lượt chờ tối đa **10 giây** (`SEND_TIMEOUT_MS`, `AbortSignal.timeout`, ADR-90); hết giờ là lỗi mạng.
- HTTP 4xx khác 429 (chat_id sai, token sai…) → dừng ngay, không thử lại.
- Hết lượt → `{ ok: false, error: "HTTP <status>" | <thông điệp lỗi> }`.

### Luật an toàn nội dung
- Bản đầy đủ gửi `parse_mode=HTML`; mọi chuỗi động (tên ví, tài khoản, danh mục) phải qua `escapeHtml` (`&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`) ở nơi dựng tin (UC-402, UC-406, UC-407). Bản ngắn là chữ thường (thông báo đẩy không hiểu HTML), không escape. Zalo nhận bản đầy đủ đã bỏ thẻ và trả ký tự escape về chữ (`zaloText`, UC-411) — Zalo hiện chữ thường, không diễn giải HTML. Hiện không tin nào chứa nội dung chuyển khoản (`bank_logs.content`, do người gửi tự đặt) — ghi nhận ở `plans/reports/redteam-260922-0100-auth-exposure.md` mục XSS.

## Alternative Flows
- 1a. Không có token → bỏ qua bước 2–3 (**không ghi dòng `notifications` Telegram nào**, lần gọi sau cùng khoá vẫn có thể gửi Telegram); vẫn chạy bước 4, 4b.
- 2a. Không ai có `tg_chat_id` → kênh Telegram gửi 0; vẫn chạy bước 4, 4b.
- 3.2a. Hai lần chạy cron chồng nhau → chỉ lần chèn được dòng claim mới gửi.

## Exceptions
- E1. Worker chết giữa bước claim (3.1) và cập nhật (3.4) → dòng ở lại `ok = 0`, không ai gửi lại cho khoá đó.
- E2. Gửi hỏng sau 3 lượt → dòng `ok = 0` vĩnh viễn; với `daily`/`weekly` tin đó mất với người nhận ấy (claim cũ chặn mọi lần thử sau). Chỉ UC-407 có cơ chế thử lại (khoá mới mỗi lượt cron).

## Acceptance Criteria
### AC-1: Mỗi người nhận một tin cho mỗi (kind, day_key)
- Given hai người nhận, `daily` đã gửi hôm nay
- When `notifyMembers(env, "daily", today, text)` được gọi lại
- Then không có lời gọi Telegram nào thêm
- Tests: `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › gửi đúng 2 người có tg_chat_id, cùng nội dung; chạy lại trong ngày không gửi thêm"; `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › chạy lại cùng tuần không gửi trùng"

### AC-2: Chỉ gửi cho thành viên có chat_id
- Tests: `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › thành viên không có tg_chat_id thì không nhận tin"

### AC-3: Token đặt ở màn Cài đặt được dùng khi gửi
- Given token `123456:telegram-token-zz99` đặt qua `PUT /v1/settings/integrations`
- When `notifyMembers(env, "daily", "2026-09-22", { full: "xin chào", push })`
- Then URL gọi chứa `/bot123456:telegram-token-zz99/sendMessage`
- Tests: `test/settings.test.ts` › "khoá kết nối SePay / Telegram › tin Telegram dùng bot token đặt ở màn Cài đặt"

### AC-4: Không có token thì không gửi Telegram, không claim Telegram; push vẫn gửi (MODIFIED v3)
- Given không có token ở `config` lẫn env; hai máy đã bật thông báo
- When `notifyMembers(env, "daily", …)`
- Then không gọi Telegram, không có dòng `notifications` Telegram mới; hai máy nhận push, hàm trả 2
- Tests: `test/push.test.ts` › "notifyMembers qua push › không có token Telegram vẫn đẩy tới mọi máy; chạy lại cùng (kind, day_key) không gửi thêm" (phần push vẫn gửi khi thiếu token); thiếu token mà có `tg_chat_id` thì không claim Telegram: ⚠ Chưa có test

### AC-5: Luật thử lại theo mã lỗi
- Given Telegram trả 500 ba lần / trả 400
- When `sendTelegram`
- Then 3 lần gọi rồi `{ok:false, error:"HTTP 500"}` / 1 lần gọi rồi `{ok:false, error:"HTTP 400"}`
- Tests: ⚠ Chưa có test (gián tiếp: `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › Telegram lỗi thì lần chạy sau báo lại; báo được rồi thì thôi" chỉ khẳng định có gọi)

### AC-6: Gửi hỏng ghi ok = 0
- Given Telegram luôn trả 500
- When `notifyMembers(env, "daily", …)`
- Then dòng `notifications` của người đó có `ok = 0`, hàm trả 0
- Tests: ⚠ Chưa có test

### AC-7: Số trả về cộng cả Telegram lẫn push
- Given "husband" có `tg_chat_id`, có token; hai máy đã bật thông báo
- When `notifyMembers(env, "weekly", "2026-W40", …)`
- Then 1 lời gọi Telegram, hàm trả 3
- Tests: `test/push.test.ts` › "notifyMembers qua push › đếm cả Telegram lẫn push"

### AC-8: Telegram nhận bản đầy đủ, máy nhận bản ngắn; mỗi kênh lưu đúng bản đã gửi
- Given "husband" có `tg_chat_id`, có token; hai máy đã bật thông báo
- When `daily` gọi `notifyMembers(env, "daily", …, { full, push })`
- Then lời gọi Telegram mang `text = full`; mỗi máy giải mã được `push.title`/`push.body`; `notifications.payload` là `full` ở dòng Telegram và `title` + xuống dòng + `body` ở dòng `push:<id>`
- Tests: `test/push.test.ts` › "notifyMembers qua push › tin sáng: Telegram nhận bản đầy đủ, máy nhận bản ngắn mở màn Hôm nay; notifications lưu đúng bản đã gửi"

## Traceability
- Code: `src/notify/telegram.ts` › `notifyMembers`, `sendTelegram`, `escapeHtml`; `src/services/push.ts` › `pushToMembers` (kênh push, UC-410); `src/notify/zalo.ts` › `zaloToMembers` (kênh Zalo, UC-411); `src/services/secrets.ts` › `getSecret`, `SECRET_NAMES`, `ENV_FALLBACK`; `src/env.d.ts` › `TG_BOT_TOKEN`; dùng lại ở `src/services/settings.ts` › `testTelegram` (access)
- Migrations/DB: `notifications` `UNIQUE (kind, day_key, chat_id)` (`migrations/0001_schema.sql`); `members.tg_chat_id`, `members.zalo_chat_id` (`migrations/0018_zalo.sql`), `members.active`; `config` khoá `secret:telegram_bot_token`, `secret:zalo_bot_token`; `push_subscriptions` (`migrations/0008_push_subscriptions.sql`)

## Divergences & Open Questions
- [DIVERGENCE] Phase-07 Todo "gửi lỗi: ghi ok=0, **hiện badge trong PWA**" — code có ghi `ok=0` và thử 3 lượt, nhưng không có API/màn nào đọc `notifications.ok` (không có trong `src/routes`, `web/src`). Người nhà không biết tin sáng bị hỏng.
- [OPEN] `ok = 0` vừa nghĩa "đang gửi" vừa nghĩa "hỏng" — không phân biệt được, và không có thử lại cho `daily`/`weekly` (E1, E2).
- [OPEN] Lượt thử cuối cùng vẫn nghỉ `500 ms × 3` trước khi trả kết quả (vòng lặp nghỉ sau mỗi lượt hỏng không phải 4xx) — kéo dài thời gian cron vô ích.
