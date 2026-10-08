# UC-304: Rà soát 02:00 & đồng bộ lại theo khoảng ngày qua API SePay
- Status: implemented
- BR: BR-03, BR-04
- Decisions: D11; S9; ADR-75 (nhiều kết nối SePay, đồng bộ lại theo khoảng ngày); ADR-76 (giao dịch trước ngày mở sổ đếm riêng, không vào sổ); ADR-78 (khoảng rà 02:00 ba lớp: ngày, tuần, tháng); commit `a954744` (dòng API không đọc được được ghi lại), `c80ae89` (token đặt từ Cài đặt); `docs/core_design_rules.md` §5, §7 "Rà soát 02:00"
- Actor: Cloudflare Cron; Thành viên đã đăng nhập hoặc script có `API_TOKEN` (đồng bộ lại)
- Trigger: (a) lượt cron `0 18,19,20 * * *` có giờ VN đúng 02:00 (`scheduledTime` 19:00 UTC) → `runScheduled` → `tick` → `backfill(env, now)` → `runBackfill(env, now, fetch)` (notify UC-401); (b) `POST /v1/settings/sepay/sync { connection_id?, from, to }` — thẻ "Đồng bộ lại SePay" ở Cài đặt › Kết nối (pwa UC-709). Cả hai chạy cùng một hàm `syncSepay`.

## History
- v1 (2026-09-22, commit `c1a25c1`): gọi `my.sepay.vn/userapi/transactions/list` cho từng TK `sepay_enabled`, mỗi dòng qua `ingestLog(..., 'backfill')`; ghi `notifications(kind='backfill')`.
- v2 (2026-09-22, commit `a954744`): dòng API không parse được → `recordIngestError(..., 'backfill', ...)` thay vì chỉ `console.error`.
- v3 (2026-09-22, commit `c80ae89`): token lấy qua `getSecret(env, "sepay_api_token")` (Cài đặt, dự phòng env `SEPAY_API_TOKEN`).
- v4 (2026-10-01, commit `9bb75a8`): chuyển sang **SePay API v2** (`https://userapi.sepay.vn/v2/transactions`; API cũ `my.sepay.vn/userapi/*` là bản legacy). v2 không lọc theo số tài khoản → một lượt gọi cho cả công ty trong cửa sổ ngày, đi hết các trang (`page`/`per_page=100`, tới `has_more=false`, tối đa 50 trang), rồi chỉ giữ dòng có `account_number` hoặc `va` thuộc TK bật SePay ở app. Hướng tiền lấy theo `transfer_type`; tài khoản ảo là trường `va`; tiền là số nguyên; `id` là UUID. 429 → chờ `Retry-After` (≤ 5 giây) rồi thử lại một lần (`src/services/sepay-api.ts`, ADR-65).
- v5 (2026-10-01, commit `e72b5de`): không còn cron riêng `0 19 * * *`; rà soát chạy trong lượt cron chung có giờ VN đúng 02:00 (lượt mỗi giờ 01:00/02:00/03:00 của đêm), song song và cô lập với các việc khác của lượt (`Promise.allSettled`) — rà soát lỗi không chặn tin theo giờ hay báo chưa gán, và ngược lại (notify UC-401 AC-9, AC-10; ADR-70).
- v6 (2026-10-03, commit `a8703fd`): **nhiều kết nối SePay** (ADR-75) — lặp từng kết nối đang bật bằng token riêng; mỗi kết nối chỉ giữ giao dịch của tài khoản thuộc nó (`accounts.sepay_connection_id`), ghi qua `ingestLog(..., connectionId)`; một kết nối lỗi không chặn kết nối khác, lỗi trả theo tên kết nối. Cron và **đồng bộ lại theo khoảng ngày** (`POST /v1/settings/sepay/sync`, ≤ 31 ngày, không quá hôm nay) dùng chung `syncSepay(env, range, …)`. Giao dịch đã có (trùng `id`, hoặc trùng (tài khoản, mã tham chiếu)) nhận ra bằng **một** câu SELECT cho cả khoảng ngày rồi đếm vào `duplicates`, không tốn truy vấn từng dòng. `runBackfill` trả `{ added, duplicates, perConnection, errors }`; dòng `notifications(kind='backfill')` giữ payload `{"added":N}`.
- v7 (2026-10-03, commit `f74bc70`): **số dư đầu là mốc** (ADR-76) — giao dịch mới có ngày trước `opened_at` của tài khoản được `ingestLog` ghi `ignored` (UC-302 2b) và đếm vào `beforeOpening` (mỗi kết nối và tổng), không vào `added` (kể cả payload `{"added":N}` của dòng `backfill`). PWA báo thêm "N giao dịch trước ngày mở sổ — đã có trong số dư đầu, không ghi lại.". Lỗi gốc: đồng bộ lại 28/9–3/10 đưa các khoản 28–30/9 vào sổ tài khoản mở sổ 1/10.
- v8 (2026-10-03, commit `d44390e`): **khoảng rà 02:00 ba lớp** (ADR-78) — `backfillWindow(now)` thay `yesterdayMidnightVn`: ngày thường soát từ 00:00 hôm qua (`day`), thứ Hai soát từ 00:00 thứ Hai tuần trước (`week` — soát lại bảy lượt ngày), ngày 1 soát từ 00:00 ngày 1 tháng trước (`month` — soát lại cả lượt tuần lẫn lượt ngày; thắng cả thứ Hai). Vẫn một lượt gọi API mỗi kết nối cho lớp rộng nhất; phần chồng nhau thành `duplicates`. Dòng `notifications(kind='backfill')` mang payload `{"added":N,"scope":"day"|"week"|"month"}` (tin sáng ghi rõ lượt soát tuần/tháng — notify UC-402). Dòng lỗi tạm thời (6a) nay được rà lại muộn nhất ở thứ Hai kế tiếp — đóng khe hở "đêm sau thử lại" cũ.
- v9 (2026-10-06, commit `9c265ee`): **không đọc số lũy kế** (ADR-87, change [`261006-bo-luy-ke-sepay`](../changes/archive/261006-bo-luy-ke-sepay/proposal.md)) — `parseHistoryRow` bỏ `accumulated`; dòng API giữ nguyên trong `raw`.

## Preconditions
- Ít nhất một kết nối SePay đang bật có token API (`sepay_connections.api_token`, hoặc env `SEPAY_API_TOKEN` cho kết nối mặc định `default`) và ít nhất một tài khoản thuộc nó — access: SepayConnection, UC-508. Cron: không kết nối nào đủ cả hai → bỏ qua lặng lẽ, không ghi dòng `backfill`.
- TK cần rà của một kết nối: `sepay_enabled = 1 AND account_no IS NOT NULL AND active = 1 AND sepay_connection_id = <kết nối>`.

## Main Flow
1. Khoảng ngày (giờ VN, khuôn `YYYY-MM-DD HH:mm:ss`): cron = `backfillWindow(now)` → `now`, ba lớp chồng nhau (ADR-78): **ngày thường** từ 00:00 của ngày hôm qua (`scope='day'`); **thứ Hai** từ 00:00 thứ Hai tuần trước — cả tuần trước, soát lại bảy lượt ngày (`week`); **ngày 1** từ 00:00 ngày 1 tháng trước — cả tháng trước, soát lại cả lượt tuần lẫn lượt ngày (`month`; ngày 1 rơi vào thứ Hai thì lấy tháng). Một lượt gọi API cho lớp rộng nhất, không gọi riêng từng lớp; phần chồng với các lượt trước thành `duplicates` (bước 5–6). Không bao giờ rà xa hơn ngày 1 tháng trước. Đồng bộ lại = `<from> 00:00:00` tới `<to> 23:59:59` (Main Flow — Đồng bộ lại, bước 8).
2. Đọc mọi kết nối đang bật (chỉ `connection_id` nếu có) và mọi TK cần rà (hai câu SELECT). Lần lượt từng kết nối, theo thứ tự tạo; kết nối không có TK nào → bỏ qua, không gọi SePay; có TK mà chưa có token → lỗi kết nối "Chưa đặt token API SePay.".
3. Một lượt gọi cho cả công ty của kết nối: `GET https://userapi.sepay.vn/v2/transactions?transaction_date_from=…&transaction_date_to=…&transaction_date_sort=asc&page=N&per_page=100`, header `Authorization: Bearer <token của kết nối>`; lặp `page` tới khi `meta.pagination.has_more = false` (tối đa 50 trang). Lỗi gọi API → lỗi của kết nối (`sepayErrorText`: 401/403 "Token không hợp lệ.", HTTP khác "SePay trả lỗi HTTP N.", mạng "Không gọi được SePay.") + `console.error`, sang kết nối sau.
4. Bỏ dòng có `account_number` và `va` đều không thuộc TK của kết nối này (so với `account_no` hoặc `sub_account`). Mỗi dòng còn lại: `parseHistoryRow` (`id` UUID, `transaction_date`, `transfer_type` → `direction` (thiếu thì `in` nếu `amount_in > 0`), `amount_in`/`amount_out` số nguyên, `account_number`, `va` → `subAccount`, `transaction_content`, `reference_number`, `code`; cả dòng giữ trong `raw` — `accumulated` không đọc, ADR-87).
5. Giao dịch đã có: lần đầu cần, đọc một lần `id, account_id, reference_number` của mọi `bank_logs` có `at` trong khoảng ngày nới thêm một ngày mỗi đầu. Dòng trùng `id`, hoặc trùng (TK khớp theo `va` rồi số TK, `reference_number`) → `duplicates += 1`, không gọi `ingestLog`.
6. Còn lại: `ingestLog(db, parsed, "backfill", now, <kết nối>)` — cùng chống trùng (UC-302) và cùng bước khớp (UC-303) như webhook, tra TK chỉ trong kết nối đó; `beforeOpening` (giao dịch trước ngày mở sổ của TK, ghi `ignored` — UC-302 2b) → `beforeOpening += 1`; không thì `created=true` → `added += 1`, còn lại `duplicates += 1`.
7. Kết quả `{ added, duplicates, beforeOpening, perConnection: [{ id, name, added, duplicates, beforeOpening, error }], errors: ["<tên kết nối>: <lỗi>"] }` (chỉ kết nối có TK). Cron: nếu có ít nhất một kết nối đã thực sự rà (không phải lỗi thiếu token) → `INSERT OR IGNORE INTO notifications (kind='backfill', day_key=dayKey(now), chat_id='system', payload='{"added":N,"scope":"day"|"week"|"month"}', ok=1)` (`scope` = lớp của bước 1); tin 07:00 cùng ngày đọc dòng này (notify UC-402).

## Main Flow — Đồng bộ lại theo khoảng ngày
8. `POST /v1/settings/sepay/sync { connection_id?, from: "YYYY-MM-DD", to: "YYYY-MM-DD" }` (ngày VN, tính cả hai đầu). Kiểm trước khi gọi SePay, sai → 400 `invalid_range`: ngày sai dạng hoặc không có thật "Ngày phải có dạng YYYY-MM-DD (vd 2026-10-01)."; `from > to` "Từ ngày phải trước hoặc bằng Đến ngày."; `to` sau hôm nay (giờ VN) "Không đồng bộ được ngày trong tương lai."; quá 31 ngày "Mỗi lần đồng bộ tối đa 31 ngày.". `connection_id` không có hoặc đang tắt → 404 `not_found`. Bỏ `connection_id` = mọi kết nối đang bật.
9. Chạy bước 2–7 (không ghi dòng `backfill`), trả `200 { ok: true, data: { from, to, added, duplicates, beforeOpening, perConnection, errors } }`. PWA báo "Đã lấy thêm N giao dịch, M đã có sẵn." và, khi `beforeOpening > 0`, thêm " K giao dịch trước ngày mở sổ — đã có trong số dư đầu, không ghi lại." (pwa UC-709).

## Alternative Flows
- 4a. Dòng không parse được → `recordIngestError(db, "backfill", reference_number ?? id ?? "khong-co-id", message)` (UC-308), sang dòng sau.
- 6a. `ingestLog` ném lỗi (lỗi tạm thời) → `console.error`, bỏ dòng đó, sang dòng sau (không đếm). Dòng đó được thử lại ở lượt sau có khoảng rà chứa nó: lượt đêm sau nếu giao dịch rơi vào 00:00–02:00, không thì lượt thứ Hai kế tiếp (muộn nhất 7 ngày), và lần nữa ở lượt ngày 1 kế tiếp (ADR-78).
- 3a. Một kết nối lỗi (token sai, mạng) không chặn kết nối khác; cron vẫn ghi dòng `backfill` với số đã vá được.
- 7a. Chạy lại trong cùng ngày VN → không sinh log trùng (UC-302); dòng `notifications` giữ nguyên giá trị lần chạy đầu (`INSERT OR IGNORE`). Đồng bộ lại cùng khoảng ngày lần hai → `added = 0`, `beforeOpening = 0`, mọi dòng (kể cả log `ignored` trước ngày mở sổ đã ghi lần đầu) vào `duplicates`.

## Exceptions
- E1. Đọc kết nối/danh sách TK từ D1 lỗi → ném ra khỏi lượt cron (không có xử lý riêng); các việc khác của lượt 02:00 vẫn chạy (notify UC-401 AC-10). Ở đồng bộ lại → 500 `internal` (UC-503).

## Acceptance Criteria
### AC-1: Không kết nối nào có token → bỏ qua, không gọi API
- Tests: `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › bỏ qua lặng lẽ khi chưa cấu hình SEPAY_API_TOKEN"

### AC-2: Vá đúng giao dịch webhook sót, idempotent, gọi API v2 đúng cửa sổ ngày (ngày thường)
- Given một giao dịch 500.000 `in` (mã `FT500`, id UUID) có ở API v2 nhưng chưa có trong sổ
- When cron chạy lúc 19:00 UTC (02:00 VN thứ Tư 23/9), rồi chạy lại lúc 19:05
- Then đúng một lời gọi `https://userapi.sepay.vn/v2/transactions` với `transaction_date_from = "2026-09-22 00:00:00"`, `transaction_date_to = "2026-09-23 02:00:00"`; lần 1 `added=1`, log mang id UUID `source='backfill'`, `status='pending'`; `notifications(kind='backfill')` payload `{"added":1,"scope":"day"}`; lần 2 `added=0`, `duplicates=1`, vẫn 1 log
- Tests: `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › gọi /v2/transactions theo khoảng ngày giờ VN, vá đúng 1 giao dịch bị sót; chạy lần hai không tạo thêm"

### AC-3: Đi hết các trang; chỉ giữ giao dịch của TK bật SePay; tiền ra theo `transfer_type`
- Given trang 1 có giao dịch của TK app và của TK lạ, trang 2 có một giao dịch `out` 120.000
- Then gọi `page=1`, `page=2`; ghi 2 log (TK lạ bị bỏ); log tiền ra `direction='out'`, `amount=120000`
- Tests: `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › đi hết các trang; bỏ giao dịch của tài khoản không bật SePay ở app; tiền ra đọc theo transfer_type"

### AC-3b: API lỗi không làm hỏng cron (lỗi trả theo tên kết nối); 429 thì chờ rồi thử lại
- Then mạng lỗi → `errors: ["SePay chính: Không gọi được SePay."]`; 401 → `errors: ["SePay chính: Token không hợp lệ."]`; vẫn ghi dòng `backfill` mỗi đêm
- Tests: `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › API lỗi (mạng, 401) không làm hỏng cron, vẫn ghi dòng rà soát"; `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › 429 thì chờ Retry-After rồi thử lại một lần"

### AC-4: Webhook và backfill cùng giao dịch → một log, một giao dịch; thiếu mã → chia lương đúng một lần
- Tests: `test/ingest-integrity.test.ts` › "webhook và cron vá đêm cùng một giao dịch › khác id nhưng cùng mã tham chiếu trong cùng tài khoản → một log, một giao dịch"; "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → chia đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng"

### AC-5: Dòng API hỏng không mất lặng lẽ
- Given API trả một dòng thiếu `transaction_date`
- Then có `notifications(kind='ingest_error')` payload `source: "backfill"`, các dòng khác vẫn được xử lý
- ⚠ Chưa có test.

### AC-6: Cửa sổ rà không hở giữa hai đêm; mỗi giao dịch được soát lại trong tuần và trong tháng
- Given cron chạy mỗi 02:00 VN
- Then mọi thời điểm giao dịch thuộc cửa sổ của ít nhất một lượt ngày (00:00 hôm qua → 02:00 hôm nay), của lượt thứ Hai kế tiếp (thứ Hai tuần trước 00:00 → 02:00) và của lượt ngày 1 kế tiếp (ngày 1 tháng trước 00:00 → 02:00) — ADR-78
- ⚠ Chưa có test cho tính chất phủ kín (suy từ `backfillWindow`; lớp ngày đã xác nhận bằng đọc mã ở `redteam-260922-0100-offline-ingest-robustness.md` mục "Cửa sổ rà soát 02:00"; các mốc cụ thể ở AC-12).

### AC-7: Rà soát đi qua từng kết nối bằng token riêng; mỗi kết nối chỉ giữ giao dịch tài khoản của nó
- Given kết nối `default` (token `husband-token-0001`, TK `vcb-husband`…) và `sepay-wife` (token `wife-token-0002`, TK `vcb-wife`); SePay của mỗi bên trả cả một dòng mang số TK của bên kia
- When cron 02:00
- Then gọi lần lượt bằng `husband-token-0001` rồi `wife-token-0002`; `perConnection` mỗi kết nối `added: 1`; log `m1` ở `vcb-husband`, `t1` ở `vcb-wife`; hai dòng mang số TK của bên kia bị bỏ (tổng 2 log)
- Tests: `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › rà soát đi qua từng kết nối bằng token riêng; mỗi kết nối chỉ giữ giao dịch của tài khoản thuộc nó"

### AC-8: Một kết nối lỗi không chặn kết nối kia
- Given như AC-7, token của vợ bị SePay trả 401
- Then `added: 1` (của `default`), `errors: ["SePay của vợ: Token không hợp lệ."]`; dòng `backfill` payload `{"added":1,"scope":"day"}`
- Tests: `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › một kết nối lỗi (token sai) không chặn kết nối kia; lỗi ghi theo tên kết nối, dòng rà soát vẫn có"

### AC-9: Đồng bộ lại — khoảng ngày sai bị từ chối trước khi gọi SePay
- Given hôm nay là 03/10 (giờ VN)
- When `from` sai dạng (`2026-9-1`), ngày không có thật (`2026-02-30`), thiếu `from`, `from > to`, `to = 2026-10-04`, `2026-09-01…2026-10-02` (32 ngày); `connection_id` lạ
- Then 400 `invalid_range` cho các khoảng sai, 404 `not_found` cho kết nối lạ, không lời gọi SePay nào; `2026-09-03…2026-10-03` (đúng 31 ngày, tới hôm nay) được nhận
- Tests: `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › đồng bộ lại theo khoảng ngày (POST /v1/settings/sepay/sync) › ngày sai dạng hoặc không có thật, Từ sau Đến, ngày tương lai, quá 31 ngày → invalid_range; kết nối lạ → not_found; không gọi SePay"

### AC-10: Đồng bộ lại hai lần cùng khoảng ngày → lần hai không thêm gì
- Given webhook đã ghi giao dịch mã `FT-t2` của `vcb-wife`; SePay của vợ trả `t1` (mới) và `t2` (mã `FT-t2`)
- When đồng bộ lại `connection_id = "sepay-wife"`, `2026-09-21…2026-09-22`, hai lần
- Then chỉ gọi bằng token vợ, `transaction_date_from = "2026-09-21 00:00:00"`, `transaction_date_to = "2026-09-22 23:59:59"`; lần 1 `added: 1, duplicates: 1`; lần 2 `added: 0, duplicates: 2`; tổng 2 log
- Tests: `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › đồng bộ lại theo khoảng ngày (POST /v1/settings/sepay/sync) › chạy hai lần cùng khoảng ngày: lần hai không thêm gì; giao dịch webhook đã có tính là có sẵn; chỉ gọi kết nối được chọn"

### AC-11: Khoảng ngày vắt qua ngày mở sổ — giao dịch trước mốc đếm riêng, không vào sổ (ADR-76)
- Given `vcb-wife` (kết nối `sepay-wife`) mở sổ `2026-10-01` với 35.906; SePay của vợ trả vào 50.000 lúc 09:00 28/9, ra 24.400 lúc 23:59 30/9, ra 10.000 lúc 00:00 1/10
- When đồng bộ lại `2026-09-28…2026-10-02`, hai lần
- Then lần 1 `added: 1, duplicates: 0, beforeOpening: 2` (cả trong `perConnection`); hai log tháng 9 `ignored`, log 1/10 `pending`; không giao dịch nào sinh từ log; `feed_balance` của `vcb-wife` = 25.906, `pending_count` = 1; lần 2 `added: 0, duplicates: 3, beforeOpening: 0`
- Tests: `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › đồng bộ lại theo khoảng ngày (POST /v1/settings/sepay/sync) › khoảng ngày vắt qua ngày mở sổ: giao dịch trước mốc lưu 'ignored', đếm riêng beforeOpening, không vào sổ, không làm lệch số dư theo log (ADR-76)"

### AC-12: Khoảng rà 02:00 ba lớp — ngày thường soát hôm qua, thứ Hai soát cả tuần trước, ngày 1 soát cả tháng trước (ADR-78)
- Given token API đặt cho kết nối `default`
- When cron 02:00 VN các ngày 07/10/2026 (thứ Tư), 12/10/2026 (thứ Hai), 01/11/2026 (Chủ nhật, ngày 1), 01/03/2027 (thứ Hai, ngày 1), 01/01/2027 (ngày 1, sang năm mới)
- Then `transaction_date_from` lần lượt `2026-10-06 00:00:00`, `2026-10-05 00:00:00`, `2026-10-01 00:00:00`, `2027-02-01 00:00:00` (ngày 1 thắng thứ Hai), `2026-12-01 00:00:00`; dòng `backfill` của từng ngày mang `scope` `day`, `week`, `month`, `month`, `month`
- Tests: `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › khoảng rà 02:00 ba lớp: ngày thường soát hôm qua, thứ Hai soát cả tuần trước, ngày 1 soát cả tháng trước (thắng cả thứ Hai)"

## Traceability
- Code: `src/cron/backfill.ts` › `syncSepay`, `existingLogs`, `runBackfill`, `backfill`, `vnDateTimeString`, `backfillWindow`; `src/cron/index.ts` › `CRONS`, `runScheduled`, `tick`, `BACKFILL_MINUTE`; `src/services/settings.ts` › `syncSepayRange`, `calendarDay`; `src/routes/settings.ts` › `settingsRoutes.post("/sepay/sync")`; `src/services/sepay-api.ts` › `listTransactions`, `sepayErrorText`; `src/services/ingest.ts` › `parseHistoryRow`, `ingestLog`, `recordIngestError`; `src/services/secrets.ts` › `loadSepayConnections`; `wrangler.jsonc` `triggers.crons`
- Migrations/DB: `bank_logs.source` CHECK (`webhook`,`backfill`); `notifications` UNIQUE `(kind, day_key, chat_id)`; `sepay_connections`, `accounts.sepay_connection_id` (`migrations/0015_sepay_connections.sql`)

## Divergences & Open Questions
- [DIVERGENCE] `phase-04-ingest-sepay.md` bước 4: "Có tạo thêm log nào → ghi `notifications(kind='backfill')`"; code luôn ghi (kể cả `added=0`) mỗi lần chạy có ít nhất một kết nối có token và tài khoản.
- [OPEN] Dòng lỗi tạm thời (6a) chỉ ra `console.error`, không có `ingest_error`: từ ADR-78 nó được rà lại muộn nhất ở lượt thứ Hai kế tiếp, nhưng trong khoảng đó tin sáng không biết có dòng bị bỏ. (Khe hở cũ "đêm sau thử lại" mà cửa sổ đêm sau không chứa dòng đó — đã đóng bằng lượt tuần/tháng.)
- [OPEN] Rà soát đêm lỗi (ví dụ token sai 401) có trong kết quả `errors` nhưng cron chỉ ra `console.error`; tin sáng vẫn nhận `added=0` như một đêm bình thường — không có tín hiệu "rà soát thất bại". Đồng bộ lại tay thì người bấm thấy lỗi ngay.
- [OPEN] Mỗi dòng mới vẫn tốn nhiều truy vấn D1 (`ingestLog` + bước khớp); đồng bộ lại một khoảng dài có nhiều giao dịch **chưa có** có thể chạm giới hạn truy vấn mỗi request của gói Workers Free (ADR-54). Dòng đã có không tốn truy vấn nào (bước 5).
- [OPEN] Webhook SePay mang `id` số nguyên, API v2 mang `id` UUID: hai nguồn không còn trùng `id` bao giờ. Chống trùng giữa webhook và rà soát giờ **chỉ** dựa vào `(account_id, reference_number)` (UC-302); giao dịch ngân hàng không có mã tham chiếu sẽ hiện ở màn Gán với nhãn "có thể trùng" (ADR-49) thay vì tự nhận ra. Với API v1, `id` hai nguồn giống nhau nên trùng `id` cũng chặn được.
- [OPEN] Tài khoản ảo: v2 trả trường `va` (số VA); app so `va` với `accounts.sub_account`. Chưa kiểm bằng dữ liệu thật.
- [OPEN] `phase-04-ingest-sepay.md` §"Chạy song song với hệ Google Sheet" (một tháng song song rồi mới tắt Apps Script) — quy trình vận hành, không có trong code.
