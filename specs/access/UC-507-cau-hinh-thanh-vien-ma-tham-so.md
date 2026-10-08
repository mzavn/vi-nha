# UC-507: Cấu hình thành viên, mã chuyển khoản, tham số, giờ nhắc
- Status: implemented
- BR: BR-08, BR-02, BR-06
- Decisions: `docs/core_design_rules.md` §1 luật 6 (máy chỉ tự gán thu nhập cho mẫu lương — comment "Luật 6" trong `updateRule`); commit `c80ae89`; commit `eb7846e` (`salary_min_amount = 0` tắt ngưỡng); ADR-59 (mẫu lương gắn nguồn thu); ADR-68 (giờ nhắc chỉnh trong app, một bộ cho cả nhà); ADR-80 (nối Zalo bằng mã, không nhập `chat_id` tay); ADR-82 (ví của rule heo đất là Tích sản); ADR-90 (đổi kênh báo tin thì báo cả nhà và chat cũ, ghi nhật ký; phải bỏ nối Zalo trước khi nối lại); ADR-92 (tên khoá cấu hình tiếng Anh); ADR-93 (Quỹ an tâm — `safety_fund_months`); ADR-95 (mật khẩu riêng tuỳ chọn); ADR-96 (tối đa 6 người ngang quyền; tắt người không xoá dữ liệu); ADR-97 (Claude nối bằng OAuth, mỗi kết nối gắn một người); ADR-98 (đổi mật khẩu / tắt người gỡ cả kết nối AI của người đó)
- Actor: Thành viên đã đăng nhập (không phân biệt `role`), hoặc script có `API_TOKEN`
- Trigger: `POST /v1/settings/members`, `PATCH /v1/settings/members/:id`, `PUT /v1/settings/members/:id/password`, `POST /v1/settings/members/:id/zalo-code`, `PATCH /v1/settings/rules/:id`, `PUT /v1/settings/config`, `PATCH /v1/settings/notify-schedule`

Rule (mã chuyển khoản) thuộc ingest ("Quản lý rule tự gán"); UC này chỉ là cửa sửa rule từ màn Cài đặt. Member và Config thuộc access (`entities.md`). Cấu hình cho thuê (số người chia, danh mục chi chung, nguồn thu cho thuê — các khoá `rental_*` trong `config`) **không** sửa qua `PUT /config` mà qua `PATCH /v1/rental/config` — xem rental [UC-801](../rental/UC-801-thiet-lap-nguoi-thue.md).

## History
- v1 (2026-09-22, commit `c80ae89`): sửa tên/chat_id thành viên, sửa rule, đặt ngưỡng lương và số tháng phao.
- v2 (2026-10-01, commit `034b7ff`): `PATCH /rules/:id` nhận `income_stream_id` (chỉ cho mẫu lương); rule trả về có `incomeStreamId` (change `261001-cho-thue-lai`).
- v3 (2026-10-01, commit `a301077`): `PATCH /notify-schedule` — giờ tin sáng, thứ + giờ tổng kết tuần, giờ yên lặng, bật/tắt ba loại tin; ghi vào các khoá `notify_*` của `config` (ADR-68, notify UC-401).
- v4 (2026-10-01, commit `e72b5de`): giờ nhắc phải là bội số 15 phút (cron chạy mỗi 15 phút, ADR-70); sai bước → `400 invalid_input` "<trường>: Giờ phải chia hết cho 15 phút.".
- v5 (2026-10-03, commit `f74bc70`): rule có thêm `account_id`, `counter_account_id`, `from_wallet_id` (schema v1.17, ADR-77 — rule heo đất do migration 0017 tạo). `PATCH /rules/:id` **không** nhận ba trường này (giữ nguyên giá trị đang lưu); rule trả về có chúng vì `SELECT *`.
- v6 (2026-10-03, commit `5bd3117`): **nối Zalo** (ADR-80, notify UC-411) — `POST /members/:id/zalo-code` tạo mã 6 số hạn 15 phút; `PATCH /members/:id` nhận `zalo_chat_id: null` (bỏ nối), chuỗi bất kỳ → 400 (nối chỉ bằng mã); thành viên trả về có `zalo_chat_id` (schema v1.18).
- v7 (2026-10-03, commit `e00814c`): migration 0020 (ADR-82) đổi `wallet_id` của mọi rule heo đất từ `heo-dat` sang ví Tích sản đang dùng (prod `tich-san`) — rule heo chuyển ví Có thì tốt → Tích sản. Không đổi code `updateRule`.
- v8 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90, red-team INSIDER-01, INSIDER-04) — `PATCH /members/:id` ghi nhật ký `member.update` (chỉ tên trường); đặt/đổi/bỏ `tg_chat_id` hay bỏ nối Zalo → cảnh báo cả nhà **và chat cũ**; `POST /members/:id/zalo-code` ghi nhật ký `member.zalo_code`, người đã nối Zalo → `409 zalo_linked`. AC-8, AC-9 sửa; thêm AC-10.
- v9 (2026-10-07, commit `7424f26`): tham số số tháng Quỹ an tâm (trước gọi "phao khẩn cấp") đổi khoá `emergency_months` → `safety_fund_months` (migration 0028 chép giá trị cũ sang, schema v1.28; ADR-92, ADR-93): `PUT /config` nhận `safety_fund_months` (cùng luật 1..36, mặc định 6), gửi `emergency_months` bị bỏ qua như trường lạ. AC-3 sửa (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v10 (2026-10-08, commit `1ed22e1`): **thêm / tắt thành viên, mật khẩu riêng tuỳ chọn** (ADR-95, ADR-96; migration 0030, schema v1.30) — `POST /members` (tối đa 6 người đang hoạt động, không trùng tên / mã kể cả người đã tắt), `PATCH /members/:id { active }` (tắt làm mọi phiên của người đó hết hiệu lực, dữ liệu giữ nguyên, không tắt được chủ hộ), `PUT /members/:id/password` (đặt / đổi / gỡ bằng mật khẩu hiện tại của chính mình hoặc mật khẩu chung cho bất kỳ ai); thành viên trả về có `has_password`. Bước 1 sửa (`active` sửa được), thêm 1a–1c, E4a, AC-11…AC-14; đóng phần tạo / tắt thành viên của [OPEN] "không có API tạo/tắt thành viên" (đổi vai vẫn mở) (change [261007-thiet-lap-lan-dau](../changes/archive/261007-thiet-lap-lan-dau/proposal.md))
- v11 (2026-10-08, commit `e5ecf41`): **gỡ kết nối Claude khi quyền vào đổi** (ADR-97, ADR-98) — tắt người (1b) và đặt / đổi / gỡ mật khẩu riêng (1c) gỡ thêm mọi kết nối Claude / ứng dụng AI người đó đã uỷ quyền (grant bị thu hồi, refresh token chết; token đang cầm hết hiệu lực trong vòng 60 giây — KV); câu báo cả nhà khi tắt người: "tắt {tên} (mọi máy và kết nối Claude của người này bị gỡ)". Thêm AC-15 (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md))

## Preconditions
- Qua `requireAuth`; body là object JSON.

## Main Flow — Thành viên
1. `PATCH /members/:id` nhận `name` (bắt buộc nếu có, ≤ 40), `tg_chat_id` (≤ 32, phải khớp `^-?\d{3,20}$`; rỗng/`null` = xoá) và `zalo_chat_id` — **chỉ** `null` (bỏ nối Zalo); chuỗi bất kỳ → `400 invalid_input` (nối Zalo chỉ bằng mã, bước 2a). Không sửa được `id`, `role`; `active` theo bước 1b (AC-12).
1a. **Thêm người** — `POST /members { name, password? }` (ADR-96): tên bỏ dấu cách hai đầu, 1–40 ký tự; mã sinh từ tên như tài khoản / ví (bỏ dấu, chữ thường, gạch nối). Trùng tên (không phân biệt hoa thường) **hoặc** trùng mã với bất kỳ thành viên nào, kể cả người đã tắt → `409 duplicate`; đã có 6 người đang hoạt động → `409 too_many_members` (kiểm ngay trong câu ghi, hai yêu cầu cùng lúc không vượt được). Người mới vai `adult`, đang hoạt động; có `password` (≥ 8 ký tự) thì lưu băm — người đó vào bằng mật khẩu riêng ngay. Nhật ký `member.create` và báo cả nhà (ADR-90). Trả `201` thành viên.
1b. **Tắt / bật lại** — `PATCH /members/:id { active }` (ADR-96): tắt → người đó biến khỏi màn đăng nhập, mọi phiên của họ hết hiệu lực ngay (`session_gen` tăng), **mọi kết nối Claude / ứng dụng AI họ đã uỷ quyền bị gỡ** (grant bị thu hồi, refresh token chết — ADR-98; mcp UC-601 AC-10), ví / tài khoản / giao dịch giữ nguyên; ví `private` của người đã tắt không còn bị ẩn với người khác (UC-504). Không tắt được chủ hộ (`409 owner_required`, kể cả qua token). Tự tắt mình qua cookie → được, phản hồi xoá cookie. Bật lại tính vào giới hạn 6 người (kết nối đã gỡ không tự trở lại — phải nối lại). Nhật ký `member.deactivate` / `member.activate` và báo cả nhà ("tắt {tên} (mọi máy và kết nối Claude của người này bị gỡ)" / "bật lại {tên}"); chỉ gửi `active` thì không ghi thêm `member.update`.
1c. **Mật khẩu riêng** — `PUT /members/:id/password { current?, household_password?, password | null }` (ADR-95): (1) đang bị chặn dò → `429`, trước khi so; (2) có `household_password` → so với mật khẩu chung, đúng thì được đổi / gỡ cho **bất kỳ ai** kể cả chính mình và chủ hộ quên mật khẩu (xét trước `current`); (3) không có thì `current` chỉ dùng khi `:id` là người của phiên cookie — phải là mật khẩu đang dùng để vào tên đó (riêng nếu có, không thì chung); gọi bằng token REST luôn phải có `household_password`. Thiếu cả hai → `400 invalid_input` (`field` = `current` cho chính mình, `household_password` cho người khác). Sai → `401 wrong_password`, tính một lần sai vào bộ chặn dò (scope `login`). `password` 8–200 ký tự → lưu băm; `null` → gỡ, người đó quay lại mật khẩu chung; `null` khi chưa có mật khẩu riêng → 200, không đổi gì. Đổi / gỡ xong: `session_gen` tăng → mọi phiên của người đó hết hiệu lực **và mọi kết nối Claude / ứng dụng AI của người đó bị gỡ** (ADR-98; mcp UC-601 AC-10); người đổi là chính họ thì phản hồi cấp cookie mới đúng cách vào mới; nhật ký `member.password` (không ghi mật khẩu); đổi cho người khác thì báo cả nhà.
2. Trả `{ id, name, role, tg_chat_id, zalo_chat_id, active, has_password }` — không bao giờ trả băm, muối hay số vòng.
2c. Sau khi ghi (ADR-90): nhật ký `member.update`, `target = member:<id>`, `detail = { fields: [<tên trường đã gửi>] }`. Nếu `tg_chat_id` khác trước (đặt mới, đổi, hay bỏ) và/hoặc `zalo_chat_id` vừa từ có thành `null` → cảnh báo cả nhà "⚠️ <người>[ (qua API token)] vừa <đổi chat Telegram nhận tin của {tên} | bỏ chat Telegram nhận tin của {tên}>[ và ]<bỏ nối Zalo của {tên}> — nếu không phải người nhà làm, vào Cài đặt gỡ ngay." tới mọi kênh hiện có của mọi thành viên **và** chat Telegram / chat Zalo cũ vừa bị thay/gỡ (mỗi kênh một lần — `notifications (security, audit:<id>, …)`). Chỉ đổi tên hay gửi lại chat như cũ → không báo.

## Main Flow — Nối Zalo bằng mã
2a. `POST /members/:id/zalo-code` → thành viên phải có và `active`; **đã nối Zalo** → `409 zalo_linked` (phải Bỏ nối trước — ADR-90, không bao giờ âm thầm đè chat cũ); chưa đặt bot token **hoặc** khoá webhook Zalo (UC-508) → `409 zalo_not_ready`. Có đủ → `createZaloLinkCode`: xoá mã hết hạn, tạo mã 6 chữ số hạn 15 phút thay mã cũ của người đó, nhớ người tạo (`created_by`, `created_via`) → nhật ký `member.zalo_code` → **201** `{ code, expires_at }`.
2b. Người đó nhắn mã cho bot Zalo của nhà trong chat riêng; webhook (notify UC-411) ghi `zalo_chat_id`, xoá mã, ghi nhật ký `member.zalo_link` (người tạo mã) và báo cả nhà. PWA tải lại cài đặt để thấy "Đã nối Zalo" (pwa UC-709).

## Main Flow — Mã chuyển khoản (rule)
3. `PATCH /rules/:id` (`id` nguyên dương) nhận `match_type` ∈ `code|content|account`, `pattern` (≤ 80), `meaning` ∈ `spend|transfer|income`, `is_salary`, `wallet_id`, `category_id`, `income_stream_id` (chuỗi hoặc `null` = bỏ nguồn), `priority` 0..1000, `active`.
4. `pattern` được viết HOA trừ khi `match_type` (mới hoặc cũ) là `account`.
5. Sau khi ghép với giá trị cũ: `meaning = income` bắt buộc `is_salary = true`.
6. `wallet_id`/`category_id` phải tồn tại. `income_stream_id` khác `null` chỉ được khi `meaning` (sau khi ghép) là `income`, và nguồn phải có (không xét `active`) — mẫu lương mang nguồn thì khoản thu tự ghi chia theo phần khóa của nguồn (ingest UC-303). Trả rule sau khi sửa (`toRule`: thêm `incomeStreamId`).
6a. `account_id` (rule chỉ áp cho log của tài khoản đó), `counter_account_id` + `from_wallet_id` (rule `transfer` tới tài khoản đầu kia kèm chuyển ví — ADR-77) không sửa được ở đây: gửi lên bị bỏ qua. Ở Cài đặt rule heo đất chỉ đổi được mẫu, ưu tiên, ví (từ migration 0020 là ví Tích sản, `from_wallet_id` = `nice-to-have` — ADR-82), bật/tắt như rule khác; đổi `meaning` của nó khỏi `transfer` thì tài khoản đầu kia còn nằm trong dòng nhưng không còn được dùng (ingest UC-303 bước 3.3, UC-305 bước 2).

## Main Flow — Tham số
7. `PUT /config` nhận `salary_min_amount` (số nguyên 0..1e12) và/hoặc `safety_fund_months` — số tháng chi Must của Quỹ an tâm (số nguyên 1..36, ADR-93); upsert vào `config` trong một `db.batch`. Trường khác (kể cả khoá cũ `emergency_months`) bị bỏ qua.
8. Trả `{ salary_min_amount, safety_fund_months }` hiện hành (mặc định 1.000.000 / 6 nếu thiếu).

## Main Flow — Giờ nhắc (cả nhà)
9. `PATCH /notify-schedule` nhận (mọi trường đều tuỳ chọn, chỉ ghi trường có gửi) `daily_time`, `weekly_time`, `quiet_start`, `quiet_end` — chuỗi `HH:MM` 00:00–23:45, phút chia hết cho 15 (cron chạy mỗi 15 phút; giờ trong 01:00–03:59 chạy ở lượt mỗi giờ kế tiếp); `weekly_day` — số nguyên 1 (thứ Hai) .. 7 (Chủ nhật); `daily_enabled`, `weekly_enabled`, `pending_enabled` — boolean. Kiểm hết rồi mới ghi: một trường sai thì không ghi trường nào.
10. Upsert các khoá `notify_daily_time`, `notify_weekly_time`, `notify_quiet_start`, `notify_quiet_end`, `notify_weekly_day` (`'1'..'7'`), `notify_daily_enabled` / `notify_weekly_enabled` / `notify_pending_enabled` (`'1'`/`'0'`) trong một `db.batch`.
11. Trả `notifySchedule` hiện hành — cùng hình dạng với `GET /v1/settings` (UC-505). Có hiệu lực từ lượt cron kế tiếp; tin hôm nay đã gửi thì không gửi lại (notify UC-401).

## Alternative Flows
- 7a. Body không có trường nào hợp lệ → không ghi gì, vẫn trả giá trị hiện hành.
- 9a. Body rỗng `{}` → không ghi gì, trả giờ nhắc hiện hành. `quiet_start = quiet_end` hợp lệ: không có giờ yên lặng.

## Exceptions
- E1. `tg_chat_id` không phải dãy số → `400 invalid_input`. `zalo_chat_id` khác `null` → `400 invalid_input`.
- E2. Rule `income` mà không `is_salary` → `400 income_needs_salary` "Mã tự gán thu nhập phải là mẫu lương."
- E3. `wallet_id`/`category_id` không tồn tại → `400 unknown_wallet` / `unknown_category`; `income_stream_id` không tồn tại → `400 unknown_income_stream`.
- E3a. Gắn `income_stream_id` cho rule không phải `income` → `400 invalid_input` "Chỉ mẫu lương mới gắn nguồn thu."
- E4a. Thêm người trùng tên / mã → `409 duplicate`; quá 6 người đang hoạt động → `409 too_many_members`; tắt chủ hộ → `409 owner_required`; mật khẩu riêng ngắn hơn 8 ký tự → `400 invalid_input`; sai mật khẩu chung / hiện tại khi đổi mật khẩu riêng → `401 wrong_password` (đếm vào bộ chặn dò), đang bị chặn → `429 too_many_attempts`.
- E4. `:id` rule không phải số nguyên dương → `400 invalid_input`; không có thành viên/rule → `404 not_found`; `zalo-code` cho thành viên không có hoặc đã nghỉ → `404 not_found`, đã nối Zalo → `409 zalo_linked`, chưa đặt token / khoá webhook Zalo → `409 zalo_not_ready`.
- E5. Tham số ngoài khoảng / không nguyên → `400 invalid_input`.
- E6. Giờ nhắc sai (giờ không đúng `HH:MM` hay không phải chuỗi, `weekly_day` ngoài 1–7 hay không phải số nguyên, cờ không phải boolean) → `400 invalid_input`, câu báo nêu tên trường (ví dụ "daily_time có dạng HH:MM (00:00–23:45)."); giờ đúng dạng mà phút không chia hết cho 15 → `400 invalid_input` "<trường>: Giờ phải chia hết cho 15 phút.".

## Acceptance Criteria
### AC-1: chat_id Telegram phải là dãy số
- Given thành viên `wife`
- When đặt `tg_chat_id = "@vo"`; rồi `"987654321"`
- Then 400; rồi lưu `"987654321"`
- Tests: `test/settings.test.ts` › "thành viên, mã chuyển khoản, tham số › chat_id Telegram phải là dãy số"

### AC-2: Sửa mã viết hoa; mã thu nhập phải là mẫu lương
- Given rule `EAN`
- When gửi `pattern: "ean", priority: 5`; rồi `meaning: "income"`
- Then rule có `pattern = "EAN"`, `priority = 5`; lần sau → `income_needs_salary`
- Tests: `test/settings.test.ts` › "thành viên, mã chuyển khoản, tham số › sửa mã chuyển khoản; mã tự gán thu nhập phải là mẫu lương (luật 6)"

### AC-3: Ngưỡng lương 0 hợp lệ, số tháng Quỹ an tâm phải ≥ 1; khoá cũ bị bỏ qua
- Given seed mặc định
- When `PUT /config { salary_min_amount: 0, safety_fund_months: 3 }`; rồi `{ safety_fund_months: 0 }`; rồi `{ emergency_months: 12 }`
- Then trả `{ salary_min_amount: 0, safety_fund_months: 3 }`; lần hai 400; lần ba không ghi gì, trả `{ salary_min_amount: 0, safety_fund_months: 3 }` (`GET /v1/settings` › `config` cũng vậy)
- Tests: `test/settings.test.ts` › "thành viên, mã chuyển khoản, tham số › ngưỡng lương và số tháng phao"

### AC-4: Mẫu lương gắn nguồn thu; mã chi thì không gắn được
- Given rule `LUONG THANG` (lương) và rule `EAN` (chi)
- When `PATCH` rule lương `{ income_stream_id: "salary-husband" }`; rồi `{ income_stream_id: null }`; rồi `PATCH` rule `EAN` `{ income_stream_id: "salary-husband" }`
- Then `incomeStreamId = "salary-husband"`; rồi `null`; lần cuối 400
- Tests: `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › mẫu lương gắn nguồn thu; mã chi thì không gắn được"

### AC-5: Sửa giờ nhắc chỉ đổi trường có gửi
- Given giờ nhắc mặc định
- When `PATCH /notify-schedule { daily_time: "06:30", weekly_day: 7, pending_enabled: false }`
- Then 200, trả `dailyTime = "06:30"`, `weeklyDay = 7`, `pendingEnabled = false`, các trường khác giữ mặc định (`weeklyTime = "08:00"`, `dailyEnabled = true`); `GET /v1/settings` › `notifySchedule` trả đúng như vậy
- Tests: `test/settings.test.ts` › "giờ nhắc (cả nhà) › PATCH chỉ đổi trường có gửi, GET sau đó thấy giá trị mới"

### AC-6: Giờ nhắc sai bị từ chối, không ghi gì
- Given giờ nhắc mặc định
- When gửi lần lượt `daily_time: "7:00"`, `weekly_time: "24:00"`, `quiet_start: "22:03"`, `daily_time: "07:05"`, `quiet_end: 630`, `weekly_day: 0 | 8 | "1"`, `daily_enabled: "1"`, và `{ daily_time: "06:00", weekly_enabled: 0 }`
- Then mỗi lần `400 invalid_input`, câu báo chứa tên trường sai (riêng `07:05`: "Giờ phải chia hết cho 15 phút."); giờ tin sáng vẫn `07:00` (lần cuối không ghi cả `daily_time` hợp lệ)
- Tests: `test/settings.test.ts` › "giờ nhắc (cả nhà) › từ chối giờ sai dạng, phút không chia hết cho 15, thứ ngoài 1–7, bật/tắt không phải boolean — không ghi gì"

### AC-7: Giờ bội số 15 phút được nhận, kể cả ban đêm
- Given giờ nhắc mặc định
- When `PATCH /notify-schedule { daily_time: "01:45", weekly_time: "23:45", quiet_start: "00:15", quiet_end: "05:00" }`
- Then 200, trả đúng bốn giờ đó
- Tests: `test/settings.test.ts` › "giờ nhắc (cả nhà) › giờ bội số 15 phút được nhận, kể cả trong 01:00–04:00"

### AC-8: Bỏ nối Zalo bằng `zalo_chat_id: null` — báo chat cũ và cả nhà, có nhật ký; không nhập `chat_id` Zalo bằng tay (MODIFIED v8)
- Given bot token Zalo; "husband" nối `chat-husband`, "wife" nối `chat-wife`
- When `PATCH /members/anh { zalo_chat_id: "chat-khac" }`; rồi `{ zalo_chat_id: null }` (API token)
- Then 400, `zalo_chat_id` giữ nguyên; rồi 200, `zalo_chat_id = null`; `chat-husband` (chat cũ) và `chat-wife` mỗi chat nhận đúng một tin "⚠️ Chồng (qua API token) vừa bỏ nối Zalo của Chồng — nếu không phải người nhà làm, vào Cài đặt gỡ ngay."; nhật ký đúng một dòng `member.update { fields: ["zalo_chat_id"] }`
- Tests: `test/zalo.test.ts` › "mã nối Zalo › bỏ nối Zalo bằng zalo_chat_id null — chat cũ và cả nhà được cảnh báo, có nhật ký; không nhập chat_id Zalo bằng tay"

### AC-9: Tạo mã nối Zalo; đã nối thì phải bỏ nối trước (MODIFIED v8)
- Given token và khoá webhook Zalo đã đặt / chưa đặt; "husband" đã nối Zalo
- When `POST /members/em/zalo-code`; `POST /members/anh/zalo-code`
- Then 201 `{ code: <6 chữ số>, expires_at: +15 phút }`, tạo lại thì mã cũ hết dùng / 409 `zalo_not_ready` (chi tiết ở notify UC-411 AC-6); "husband" → 409 `zalo_linked`, không tạo mã
- Tests: `test/zalo.test.ts` › "mã nối Zalo › tạo mã 6 số hạn 15 phút, tạo lại thì mã cũ hết dùng; chưa đặt token và khoá webhook thì báo chưa sẵn sàng"; `test/zalo.test.ts` › "mã nối Zalo › người đã nối Zalo thì không tạo được mã — phải bỏ nối trước; mã tạo trước khi người đó nối chat khác không đè chat đó"

### AC-10: Đổi chat Telegram thì chat cũ, chat mới và cả nhà đều được báo; không đổi thì không báo (ADR-90)
- Given bot token Telegram; "husband" chat `1001`, "wife" chat `2002`
- When `PATCH /members/em { tg_chat_id: "9999" }`; rồi `{ tg_chat_id: "9999", name: "Vợ" }`
- Then 200; `1001`, `2002` (chat cũ của "wife"), `9999` mỗi chat đúng một tin "⚠️ Chồng (qua API token) vừa đổi chat Telegram nhận tin của Vợ — nếu không phải người nhà làm, vào Cài đặt gỡ ngay."; lần hai không gửi tin nào
- Tests: `test/audit.test.ts` › "cảnh báo cả nhà khi kênh báo tin hay khoá đổi › đổi chat Telegram của một người → chat cũ, chat mới và cả nhà đều được báo; mỗi kênh một lần"

### AC-11: Thêm người — tối đa 6 người đang hoạt động, không trùng tên hay mã (ADR-96)
- Given hộ mẫu (2 người); rồi một người đã tắt; rồi đủ 6 người đang hoạt động
- When `POST /v1/settings/members { name }`; thêm tên trùng (khác hoa thường) hay tên ra cùng mã với người đang có hoặc đã tắt; thêm người thứ 7; thêm kèm `password` 8 ký tự rồi người đó đăng nhập
- Then 201 người `adult`, `active`, mã sinh từ tên, nhật ký `member.create`, cả nhà được báo; 409 `duplicate`; 409 `too_many_members` (người đã tắt không tính); người mới vào được bằng mật khẩu riêng, mật khẩu chung bị 401; mật khẩu ngắn hơn 8 ký tự → 400
- Tests: [`test/members.test.ts`](../../test/members.test.ts) › "UC-507 AC-11: thêm người › POST /v1/settings/members → 201 người lớn, đang hoạt động, mã sinh từ tên; nhật ký member.create, báo cả nhà" · "… › trùng tên (không phân biệt hoa thường) hoặc trùng mã với bất kỳ ai, kể cả người đã tắt → 409 duplicate" · "… › đã có 6 người đang hoạt động → 409 too_many_members; người đã tắt không tính" · "… › có mật khẩu riêng (≥ 8 ký tự) → người mới vào bằng mật khẩu riêng ngay, không qua mật khẩu chung; ngắn hơn → 400"; phía app: [`web/src/lib/members.test.ts`](../../web/src/lib/members.test.ts) › "UC-507 AC-11: thêm người › tên bắt buộc, tối đa 40 ký tự; mật khẩu riêng để trống được, có thì ít nhất 8 ký tự" · "… › trùng tên (không phân biệt hoa thường) hoặc trùng mã với bất kỳ ai, kể cả người đã tắt" · "… › đã có 6 người đang dùng thì không thêm được; người đã tắt không tính" · "… › lỗi server: trùng → ô tên; quá 6 người, 429 → câu chung"

### AC-12: Tắt / bật lại người — phiên hết hiệu lực, dữ liệu giữ nguyên (ADR-96)
- Given `wife` đang đăng nhập, có ví / tài khoản / giao dịch
- When `PATCH /v1/settings/members/wife { active: false }`; tắt chủ hộ (kể cả qua token không kèm `X-Member-Id`); `wife` tự tắt mình qua cookie; bật lại `wife`
- Then `wife` biến khỏi `GET /v1/session/members`, cookie cũ → 401, `session_gen` tăng, ví / tài khoản / giao dịch còn nguyên, nhật ký `member.deactivate`, cả nhà được báo; chủ hộ → 409 `owner_required`; tự tắt → 200 kèm `Set-Cookie` xoá phiên; bật lại → đăng nhập lại được (cookie cũ vẫn 401), tính vào giới hạn 6, nhật ký `member.activate`
- Tests: [`test/members.test.ts`](../../test/members.test.ts) › "UC-507 AC-12: tắt / bật lại người › tắt → biến khỏi màn đăng nhập, mọi phiên hết hiệu lực ngay, session_gen tăng, ví / tài khoản / giao dịch giữ nguyên; nhật ký, báo cả nhà" · "… › tắt chủ hộ → 409 owner_required, kể cả qua token không kèm X-Member-Id" · "… › tự tắt mình qua cookie → được, phản hồi xoá cookie" · "… › bật lại → đăng nhập lại được (cookie cũ vẫn hết hiệu lực); tính vào giới hạn 6 người; nhật ký member.activate"; nút Tắt / Bật lại ở PWA: ⚠ Chưa có test (giao diện, đã xem tay ở 390px)

### AC-13: Đặt / đổi / gỡ mật khẩu riêng (ADR-95)
- Given `wife` chưa có mật khẩu riêng, đăng nhập bằng mật khẩu chung; `husband` (chủ hộ) có mật khẩu riêng
- When `wife` tự đặt với `current` = mật khẩu chung; tự đổi với `current` sai / đúng; tự gỡ (`null`); dùng `household_password` để đổi / gỡ mật khẩu của `husband`; gửi cả `current` sai lẫn `household_password` đúng; gọi bằng token không có `household_password`; gỡ khi chưa có
- Then lưu băm, cookie cũ hết hiệu lực, phản hồi cấp cookie riêng mới, nhật ký `member.password` không có mật khẩu, không báo cả nhà; `current` sai → 401 `wrong_password` (đếm vào bộ chặn dò; đang bị chặn → 429 trước khi so); gỡ → cookie mới là cookie chung; đổi của chủ hộ bằng mật khẩu chung được, cả nhà được báo; `household_password` được xét trước; token thiếu mật khẩu chung → 400; gỡ khi chưa có → 200, `session_gen` không đổi
- Tests: [`test/members.test.ts`](../../test/members.test.ts) › "UC-507 AC-13: đặt / đổi / gỡ mật khẩu riêng › tự đặt bằng mật khẩu hiện tại (chung): lưu băm, phiên cũ hết hiệu lực, phản hồi cấp cookie riêng mới; nhật ký không ghi mật khẩu, không báo cả nhà" · "… › tự đổi: `current` phải là mật khẩu riêng đang dùng; tự gỡ (null) → quay về mật khẩu chung, cookie mới là cookie chung" · "… › mật khẩu chung đúng → đổi / gỡ được cho bất kỳ ai, kể cả chủ hộ quên mật khẩu; đổi cho người khác thì báo cả nhà" · "… › gửi cả hai thì household_password được xét trước" · "… › token REST luôn phải có household_password; `current` không dùng được cho người khác" · "… › sai current / household_password → 401 wrong_password, tính vào bộ chặn dò; đang bị chặn → 429 trước khi so" · "… › null khi người đó chưa có mật khẩu riêng → 200, không đổi gì, không tăng session_gen; mật khẩu ngắn → 400"; phía app: [`web/src/lib/members.test.ts`](../../web/src/lib/members.test.ts) › "UC-507 AC-13: đặt / đổi / gỡ mật khẩu riêng › đổi của người khác luôn hỏi mật khẩu chung" · "… › đổi của mình: hỏi mật khẩu đang dùng; chọn dùng mật khẩu chung thì gửi mật khẩu chung" · "… › gỡ gửi password null; mật khẩu mới ít nhất 8 ký tự; phải nhập mật khẩu xác nhận"; [`web/src/lib/api.test.ts`](../../web/src/lib/api.test.ts) › "lỗi server: field và 401 › UC-507 AC-13: 401 sai mật khẩu (đổi mật khẩu riêng, thiết lập) không đẩy về màn đăng nhập; 401 hết phiên thì có"

### AC-14: Cài đặt cho biết ai dùng mật khẩu riêng, không bao giờ lộ băm
- Given `husband` có mật khẩu riêng, `wife` không
- When `GET /v1/settings`
- Then mỗi thành viên có `has_password: boolean` (`true` / `false`); JSON không có băm, muối hay số vòng
- Tests: [`test/members.test.ts`](../../test/members.test.ts) › "UC-507 AC-14: GET /v1/settings trả has_password › mỗi thành viên có has_password: boolean, không bao giờ có băm, muối hay số vòng"

### AC-15: Tắt người hay đổi mật khẩu riêng thì kết nối Claude của người đó bị gỡ (ADR-98)
- Given `wife` và `husband` mỗi người đã nối Claude bằng mật khẩu chung (token + refresh token)
- When đặt mật khẩu riêng cho `wife` (`household_password` đúng); hoặc tắt `wife`
- Then cả hai lần: `/mcp` bằng token của `wife` → 401, refresh token của `wife` không đổi được token mới; lần đổi mật khẩu: kết nối của `husband` vẫn chạy
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-10: gỡ kết nối khi quyền vào đổi › đổi mật khẩu riêng → mọi kết nối của người đó bị gỡ: /mcp 401, refresh chết" · "… › tắt người → kết nối của người đó bị gỡ"

## Traceability
- Code: `src/routes/settings.ts` › `settingsRoutes.post("/members")`, `.put("/members/:id/password")`, `settingsRoutes.patch("/members/:id")` (cả hai gọi `revokeMemberGrants`), `.post("/members/:id/zalo-code")`, `.patch("/rules/:id")`, `.put("/config")`, `.patch("/notify-schedule")`; `src/oauth/server.ts` › `revokeMemberGrants`, `listMemberGrants`; `src/services/settings.ts` › `readMember`, `createMember`, `updateMember`, `setMemberPassword`, `memberName`, `memberPassword`, `nameKey`, `MAX_ACTIVE_MEMBERS`, `updateRule`, `toRule`, `updateConfig`, `configNumber`, `updateNotifySchedule`, `readNotifySchedule`; `src/services/audit.ts` › `recordChange`, `alertMembers`, `fieldNames`; `src/services/zalo.ts` › `createZaloLinkCode`, `ZALO_CODE_TTL_MS`; `src/domain/notify-schedule.ts` › `clockMinutes`, `NOTIFY_CONFIG_KEYS`, `parseNotifySchedule`
- Migrations/DB: `members` (`zalo_chat_id`, migration 0018; `password_hash`, `session_gen`, migration 0030), `zalo_link_codes` (migration 0018; `created_by`, `created_via` — 0026), `audit_log` (0026), `rules` (`income_stream_id`, migration 0007), `config` (`emergency_months` → `safety_fund_months`, migration 0028); người đọc `salary_min_amount`: `src/services/ledger.ts` › `salaryMinAmount`; người đọc `safety_fund_months`: `ledger.getSnapshot`, view `v_safety_fund`
- Người nhận tin theo `tg_chat_id` / `zalo_chat_id`: xem `specs/notify/` (UC-408 Gửi tin Telegram chống gửi trùng, UC-411 Gửi tin qua Zalo Bot)

## Divergences & Open Questions
- [DIVERGENCE] Số tháng Quỹ an tâm: PWA chỉ cho 1–24 (`web/src/lib/settings.ts` › `configPayload`, test `web/src/lib/settings.test.ts` › "thành viên, tham số › số tháng phao 1–24, ngưỡng lương không âm"), server cho 1–36 (`src/services/settings.ts` › `updateConfig`).
- [DIVERGENCE] `tg_chat_id`: PWA đòi 5–20 chữ số (`web/src/lib/settings.ts` › `memberPayload`, regex `^-?\d{5,20}$`), server chấp nhận 3–20 (`updateMember`, regex `^-?\d{3,20}$`).
- [OPEN] Khoá `tz`, `split_days`, `currency` được seed trong `config` (`migrations/0002_seed.sql`) nhưng không có mã nào trong `src/` hay `web/src` đọc chúng; múi giờ đang hard-code UTC+7 (`src/domain/period.ts` › `VN_OFFSET_MS`) và ngày nhắc chia hard-code `dayOfMonth === 10 || dayOfMonth === 25` (`src/cron/daily.ts`). Không sửa được từ Cài đặt.
- [OPEN] Không có API đổi `role` (vai `teen` / `child` / `guest` có trong schema nhưng chưa có luật — ADR-96). Thêm / tắt người đã có ở 1a / 1b.
- [OPEN] Đổi tên thành viên qua `PATCH /members/:id` chưa kiểm trùng tên / trùng mã với người khác (chỉ lúc thêm người mới kiểm — AC-11).
- [OPEN] Đổi `meaning` của rule từ `income` sang `spend`/`transfer` không xoá `income_stream_id` cũ ở server (`updateRule` chỉ chặn khi request gửi nguồn khác `null`); PWA luôn gửi `null` cho rule không phải lương nên qua app không xảy ra. `updateRule` cũng không sửa được `tenant_id` (rule người thuê, ingest UC-307).
