# UC-301: Nhận webhook SePay
- Status: implemented
- BR: BR-03, BR-04, BR-09
- Decisions: D4, D5; ADR-75 (nhiều kết nối SePay); ADR-76 (giao dịch trước ngày mở sổ); commit `a954744` (không bỏ lặng lẽ, từ chối ngày không có thật), `11b12b3` (tài khoản ảo), `c80ae89` (khoá đặt từ Cài đặt); `plans/reports/researcher-260921-2228-third-party-assumptions.md` A.1–A.2 (hợp đồng SePay)
- Actor: SePay (hệ thống ngoài)
- Trigger: `POST /webhooks/sepay` (không qua `requireAuth`; xác thực riêng bằng API key)

## History
- v0 (2026-09-22, commit `c6677a8`): khung route rỗng.
- v1 (2026-09-22, commit `c1a25c1`): xác thực `Apikey`, parse payload, gọi `ingestLog`; mọi lỗi đều trả `{"success":true}` và chỉ `console.error`.
- v2 (2026-09-22, commit `a954744`): payload không đọc được → ghi `notifications(kind='ingest_error')` để tin sáng báo, vẫn trả 200; lỗi tạm thời (D1) → 503 để SePay gửi lại. Ngày không có thật (30/02) bị từ chối thay vì trôi sang tháng sau; chấp nhận giờ thiếu giây; số tiền phải là số nguyên an toàn ≤ 1.000 tỷ.
- v3 (2026-09-22, commit `11b12b3`): đọc `subAccount`, khớp tài khoản ảo trước số TK chính (vá phát hiện 2 của `plans/reports/redteam-260922-0100-offline-ingest-robustness.md`).
- v4 (2026-09-22, commit `c80ae89`): khoá so sánh lấy từ `getSecret(env, "sepay_webhook_key")` (Cài đặt trong D1, dự phòng `SEPAY_API_KEY`); đọc khoá lỗi → 503.
- v5 (2026-10-03, commit `a8703fd`): nhiều kết nối SePay (ADR-75) — cùng một địa chỉ, nhận khoá của **bất kỳ kết nối đang bật** (`loadSepayConnections`, so `safeEqual` với từng khoá, không dừng sớm); kết nối khớp khoá được truyền vào `ingestLog`, log chỉ khớp vào tài khoản thuộc kết nối đó (khoá SePay của vợ không ghi được vào tài khoản của chồng). Khoá cũ trong `config` chuyển sang kết nối mặc định `chinh` (migration 0015), `SEPAY_API_KEY` là dự phòng của riêng kết nối này.
- v6 (2026-10-03, commit `f74bc70`): giao dịch có ngày (giờ VN) trước ngày mở sổ (`opened_at`) của tài khoản khớp được ghi `ignored` — đã nằm trong số dư đầu (UC-302 2b, ADR-76); webhook vẫn trả 200 `{"success": true}`.
- v7 (2026-10-06, commit `9c265ee`): **không đọc số lũy kế** (ADR-87, change [`261006-bo-luy-ke-sepay`](../changes/archive/261006-bo-luy-ke-sepay/proposal.md)) — chủ nhà: "bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè". `ParsedBankLog` bỏ `accumulated`; trường đó chỉ còn trong `raw`.
- v8 (2026-10-06, commit `d059eaa`): **chặn dò khoá webhook** (red-team 6/10 INFRA-01, ADR-89, change [`261006-bao-mat-dang-nhap`](../changes/archive/261006-bao-mat-dang-nhap/proposal.md)) — khoá sai 20 lần trong 15 phút từ một IP (`CF-Connecting-IP`, bộ đếm `webhook` chung với `/webhooks/zalo`) → 429 trước khi đọc khoá nào từ D1; mỗi lần 401 ghi một lần sai (log số lần, không có khoá). Khoá webhook đặt mới cần ≥ 24 ký tự (access UC-508); khoá đã lưu vẫn dùng được. Đóng [DIVERGENCE] "không giới hạn tần suất" (giới hạn theo lần **sai**, không theo mọi request — webhook thật của SePay không bị đếm).

## Preconditions
- Ít nhất một kết nối SePay đang bật có khoá webhook (cột `sepay_connections.webhook_key`, hoặc env `SEPAY_API_KEY` cho kết nối mặc định `default`) — access: SepayConnection, UC-508.
- Tài khoản của hộ có `account_no` (và/hoặc `sub_account`) khớp với SePay, bật SePay và thuộc đúng kết nối gửi webhook (`accounts.sepay_connection_id`; sửa ở access UC-506).

## Main Flow
0. Lấy IP người gọi (`CF-Connecting-IP`); IP này đã sai khoá ≥ 20 lần trong 15 phút (`blockedFor(db, "webhook", …)`, access entity AuthFailure) → E4, **trước** khi đọc khoá nào.
1. Đọc header `Authorization`; chỉ nhận dạng `Apikey <key>`.
2. Đọc mọi kết nối đang bật (một câu SELECT); so khoá gửi lên với khoá của **từng** kết nối bằng `safeEqual` (so thời gian hằng, so hết, không dừng ở kết nối đầu tiên khớp). Kết nối khớp là kết nối của giao dịch. Không khớp → ghi một lần sai cho IP (`recordFailure`, log `[auth] webhook sai: ip <ip>, lần <n> trong 15 phút`) → E1.
3. Parse body JSON; phải là object (không phải mảng).
4. `parseWebhookPayload` chuẩn hoá thành `ParsedBankLog`:
   - `id` bắt buộc (ép chuỗi); `transactionDate` bắt buộc, giờ VN → ISO UTC (`vnDateTimeToIso`);
   - `transferType` phải là `in`/`out` → `direction`;
   - `transferAmount` → `amount` (làm tròn, số nguyên dương, ≤ 1e12);
   - `content ?? description` → `content`; `code ?? extractCode(content)` viết hoa → `refCode`;
   - `referenceCode` → `referenceNumber`; `accountNumber`, `subAccount`; giữ `raw` (nguyên payload). `accumulated` (số lũy kế SePay) **không đọc** — chỉ nằm trong `raw` (ADR-87).
5. Gọi `ingestLog(db, parsed, "webhook", now, <kết nối>)` (UC-302 → UC-303): tra tài khoản theo `sub_account` rồi `account_no` **chỉ trong các tài khoản có `sepay_connection_id` = kết nối đó**; không có thì log ghi với `account_id = NULL` (như tài khoản lạ), chờ gán. Giao dịch trước ngày mở sổ của tài khoản → log `ignored`, không vào sổ (UC-302 2b).
6. Trả HTTP 200 `{"success": true}`.

## Alternative Flows
- 4a. Payload hỏng (không phải object, thiếu `id`/`transactionDate`, `transferType` lạ, số tiền vô lý, ngày không có thật) → `recordIngestError(db, "webhook", <id hoặc "khong-co-id">, message)` (UC-308, lỗi ghi cũng bị nuốt) → trả 200 `{"success": true}`: gửi lại vô ích, nhưng không mất lặng lẽ.
- 5a. Lỗi xảy ra **sau** khi log đã ghi (bước khớp, ví dụ chia lương lỗi) → được `ingestLog` tự bắt và ghi `ingest_error` (UC-302 E2); webhook vẫn trả 200.

## Exceptions
- E1. Header thiếu / không bắt đầu bằng `Apikey ` / khoá không khớp kết nối đang bật nào (kể cả khoá của kết nối đã tắt) / chưa kết nối nào có khoá → 401 `{"success": false}`.
- E2. Đọc kết nối, đọc hay ghi bộ đếm lần sai từ D1 lỗi → 503 `{"success": false}` (SePay gửi lại).
- E3. `ingestLog` ném lỗi (D1 trục trặc trước/khi ghi log) → `console.error` một dòng không kèm payload → 503 `{"success": false}`; SePay gửi lại (8 lần/~33 phút theo tài liệu SePay), `ingestLog` idempotent nên lần gửi lại ghi đúng một log.
- Không bao giờ ghi payload hay số tài khoản ra console; bản ghi `ingest_error` chỉ chứa `source` + thông điệp ≤ 200 ký tự.
- E4. IP đang bị chặn (bước 0) → 429 `{"success": false}`; không đọc khoá, không ghi log, không đếm thêm. Hết 15 phút từ lần sai đầu thì IP đó gửi được lại.

## Acceptance Criteria
### AC-1: Chỉ SePay có khoá mới ghi được
- Given khoá webhook là `sepay-key`
- When gọi không có key, sai key, hoặc khi chưa cấu hình khoá nào
- Then HTTP 401 và không ghi log
- Tests: `test/webhooks.test.ts` › "xác thực webhook SePay › thiếu key → 401"; "xác thực webhook SePay › sai key → 401"; "xác thực webhook SePay › chưa cấu hình SEPAY_API_KEY → khoá hẳn"

### AC-2: Đúng hợp đồng trả lời SePay
- Given key đúng và payload hợp lệ
- When POST
- Then HTTP 200, body đúng `{"success": true}`
- Tests: `test/webhooks.test.ts` › "xác thực webhook SePay › đúng key → 200, body đúng chuẩn {\"success\":true}"

### AC-3: Webhook → rule mã → giao dịch (nối trọn)
- Given payload `out` có `code: "EAN"` vào TK `vcb-husband`
- When POST
- Then có đúng một `spend` ví `food`, danh mục `groceries`, TK `vcb-husband`
- Tests: `test/webhooks.test.ts` › "nối trọn: webhook → rule mã → transaction › mã EAN qua webhook thật tạo spend đúng ví/danh mục"

### AC-4: Payload hỏng không làm SePay gửi lại vô ích, nhưng không mất lặng lẽ
- Given payload thiếu trường bắt buộc, hoặc `transactionDate` = `2026-02-30 09:00:00`
- When POST
- Then 200 `{"success": true}`, không có `bank_logs`; với ngày sai có một `notifications(kind='ingest_error')` payload `source: "webhook"` và không chứa số tài khoản
- Tests: `test/webhooks.test.ts` › "nối trọn: webhook → rule mã → transaction › payload thiếu trường bắt buộc vẫn trả success (SePay không nên bị coi là lỗi để retry vô ích)"; "payload hỏng và lỗi tạm thời › ngày không có thật (30/02) bị từ chối thay vì ghi sang tháng 3; được ghi lại để tin sáng báo"
- ⚠ Chưa có test khẳng định có bản ghi `ingest_error` cho payload *thiếu trường* (test chỉ kiểm 200 + 0 log).

### AC-5: Định dạng thời điểm & số tiền
- Given `transactionDate` thiếu giây `2026-09-22 09:00`; hoặc `transferAmount` = 1e20
- When POST
- Then log thứ nhất có `at = 2026-09-22T02:00:00.000Z`; log thứ hai không được ghi
- Tests: `test/webhooks.test.ts` › "payload hỏng và lỗi tạm thời › thiếu giây vẫn đọc được; số tiền vô lý (> 1.000 tỷ) bị từ chối"

### AC-6: Lỗi tạm thời → SePay gửi lại, và lần gửi lại ghi đúng một log
- Given D1 ném lỗi ở `prepare`
- When POST lần 1, rồi D1 hồi phục và SePay gửi lại cùng payload
- Then lần 1 trả 503; lần 2 trả `{"success": true}` và có đúng 1 log id `2004`
- Tests: `test/webhooks.test.ts` › "payload hỏng và lỗi tạm thời › D1 lỗi tạm thời → trả lỗi để SePay gửi lại; lần gửi lại ghi được đúng một log"

### AC-7: Tài khoản ảo khớp trước số TK chính
- Given `accounts.sub_account='VA-EM-01'` cho `vcb-wife`; payload `accountNumber` của `vcb-husband` + `subAccount='VA-EM-01'`
- When POST
- Then `bank_logs.account_id = 'vcb-wife'`
- Tests: `test/webhooks.test.ts` › "tài khoản ảo (subAccount) › khớp tài khoản theo subAccount trước số tài khoản chính"

### AC-8: SePay gửi lại nhiều lần qua HTTP → một log, một giao dịch
- Tests: `test/webhooks.test.ts` › "chống trùng qua HTTP › gửi lại đúng id (SePay retry) → chỉ có một bank_log, không sinh transaction thứ hai"

### AC-9: Một địa chỉ cho mọi kết nối SePay — khoá của kết nối nào đang bật cũng vào được
- Given kết nối mặc định `default` (khoá `sepay-key`) và kết nối `sepay-wife` (khoá `wife-key-0002`), `vcb-wife` thuộc `sepay-wife`
- When POST bằng khoá `default` cho `vcb-husband`, bằng khoá vợ cho `vcb-wife`, bằng khoá lạ, rồi tắt `sepay-wife` và POST lại bằng khoá vợ
- Then 200 / 200 / 401 / 401; log `5001` ở `vcb-husband`, `5002` ở `vcb-wife`, không có log nào khác
- Tests: `test/webhooks.test.ts` › "nhiều kết nối SePay — cùng một địa chỉ webhook, mỗi kết nối một khoá (ADR-75) › khoá của mỗi kết nối đang bật đều vào được; khoá lạ hay khoá của kết nối đã tắt bị từ chối"; `test/settings.test.ts` › "khoá kết nối SePay / Telegram › webhook dùng đúng khoá đặt ở màn Cài đặt; xoá khoá thì webhook khoá lại"

### AC-10: Khoá của SePay người này không ghi được vào tài khoản người kia
- Given như AC-9
- When SePay của vợ (khoá `wife-key-0002`) gửi giao dịch mang số tài khoản `0011xxxxxxx` của `vcb-husband` (thuộc `default`)
- Then 200; log ghi với `account_id = NULL`, `pending`; không sinh giao dịch nào
- Tests: `test/webhooks.test.ts` › "nhiều kết nối SePay — cùng một địa chỉ webhook, mỗi kết nối một khoá (ADR-75) › khoá của SePay của vợ không ghi được vào tài khoản của chồng: log không gắn tài khoản nào, không tự sinh giao dịch"

### AC-11: Khoá sai tới ngưỡng thì IP đó bị chặn trước khi đọc khoá; IP khác không
- Given IP `192.0.2.66` đã sai khoá 19 lần trong 15 phút
- When gửi khoá sai; rồi từ IP đó gửi khoá **đúng** tới `/webhooks/sepay` và khoá Zalo đúng tới `/webhooks/zalo`; rồi khoá đúng từ IP `198.51.100.20`; (ca khác) hết 15 phút
- Then 401 và bộ đếm = 20; hai request sau → 429, chỉ chạy đúng hai câu SQL, cả hai đọc `auth_failures` (không đọc `sepay_connections` hay `config`); IP khác → 200; khoá Zalo sai cũng được đếm; hết cửa sổ thì IP bị chặn gửi lại được (200)
- Tests: `test/webhooks.test.ts` › "chặn dò khoá webhook theo IP (ADR-89) › sai khoá lần thứ 20 trong 15 phút → mọi webhook từ IP đó 429 trước khi đọc khoá, kể cả khoá đúng; IP khác vẫn vào"; "chặn dò khoá webhook theo IP (ADR-89) › khoá Zalo sai cũng được đếm; hết 15 phút thì IP đó gửi lại được"

## Traceability
- Code: `src/routes/webhooks.ts` › `webhooks.post("/sepay")`; `src/services/auth-throttle.ts` › `clientIp`, `blockedFor`, `recordFailure`; `src/routes/auth.ts` › `safeEqual`; `src/services/secrets.ts` › `loadSepayConnections`; `src/services/ingest.ts` › `parseWebhookPayload`, `vnDateTimeToIso`, `vndAmount`, `recordIngestError`, `ingestLog` (tham số `connectionId`); `src/domain/rules.ts` › `extractCode`; `src/index.ts` (`app.route("/webhooks", webhooks)` trước `requireAuth`)
- Migrations/DB: `bank_logs` (`migrations/0001_schema.sql`), `notifications`, `sepay_connections` + `accounts.sepay_connection_id` (`migrations/0015_sepay_connections.sql`), `auth_failures` (`migrations/0025_auth_failures.sql`)

## Divergences & Open Questions
- [DIVERGENCE] `phase-04-ingest-sepay.md` §"Hợp đồng webhook" nói `transactionDate` đổi sang ISO `+07:00`; code lưu ISO UTC `…Z` (`src/services/ingest.ts` › `vnDateTimeToIso`). Cùng một thời điểm, khác biểu diễn.
- [DIVERGENCE] Báo cáo `fullstack-developer-260922-0020-sepay-ingest.md` §1 mô tả "lỗi xử lý … luôn trả `{"success": true}`"; hiện tại (sau `a954744`) lỗi tạm thời trả 503.
- [OPEN] Xác thực HMAC-SHA256 SePay (an toàn hơn Apikey) chưa làm — phase-04 ghi "để sau V1".
- [OPEN] Phase 00 (bắt payload thật MB) chưa được điền bảng kết quả (`phase-00-sepay-spike.md`); D5 (chủ nhà: MB có tiền ra) trái với bảng hỗ trợ SePay (researcher A.3: MB "Tiền ra: Không"). Toàn bộ test dùng payload tự dựng.
- [OPEN] `accounts.sub_account` không có unique index; nếu hai TK cùng `sub_account`, `SELECT … WHERE sub_account = ?` lấy dòng bất kỳ.
- [OPEN] Tra tài khoản không lọc `active`: log của TK ngưng dùng vẫn được gắn vào TK đó. (Từ v5, TK tắt SePay không còn thuộc kết nối nào nên webhook không gắn log vào nó — `ingestLog` gọi không kèm kết nối, chỉ có ở test, vẫn tra mọi TK.)
- [OPEN] Log mang số TK của kết nối khác (AC-10) nằm chờ gán như log tài khoản lạ, không có cảnh báo riêng "khoá SePay này gửi giao dịch của tài khoản không thuộc nó" — thường là cấu hình nhầm (tài khoản chưa chọn đúng kết nối ở Cài đặt).
