# UC-302: Ghi log ngân hàng chống trùng
- Status: implemented
- BR: BR-04, BR-03
- Decisions: D11; S9 (khoá `(account_id, reference_number)`, `phase-04-ingest-sepay.md` §"Học từ hệ đang chạy"); ADR-76 (log trước ngày mở sổ); commit `c3ab508` (unique index), `b8e8f0c` (nhận diện song sinh), `43baea1` (song sinh: đánh dấu thay vì bỏ), `eb7846e` (lỗi sau khi ghi → ghi lại); `docs/core_design_rules.md` §9 dòng "Tài khoản có bank feed"; `plans/reports/redteam-260922-0100-money-correctness.md` Phát hiện 1
- Actor: hệ thống — gọi từ UC-301 (webhook) và UC-304 (backfill)
- Trigger: `ingestLog(db, parsed, source, now)`

## History
- v1 (2026-09-22, commit `c1a25c1`): chống trùng theo `id` và theo `(account_id, reference_number)` bằng đọc-trước-ghi; `INSERT OR IGNORE`.
- v2 (2026-09-22, commit `c3ab508`): migration 0005 biến `idx_logs_ref` thành UNIQUE (bỏ qua mã NULL/rỗng) → request thua race bị `INSERT OR IGNORE` loại.
- v3 (2026-09-22, commit `b8e8f0c`): webhook thiếu mã FT + backfill cùng giao dịch khác id từng sinh 2 log (lương 40tr bị chia thành 80tr); thêm nhận diện log "song sinh" khác nguồn trong 3 phút — lúc này **bỏ** log sau.
- v4 (2026-09-22, commit `11b12b3`): tra tài khoản theo `subAccount` trước `accountNumber`.
- v5 (2026-09-22, commit `43baea1`): bỏ log sau có thể làm mất một giao dịch thật cùng số tiền → nay vẫn **ghi** log sau nhưng **không tự khớp**, để chờ gán với nhãn "có thể trùng".
- v6 (2026-09-22, commit `eb7846e`): lỗi ở bước khớp sau khi log đã ghi → ghi `ingest_error` thay vì ném ra (webhook gửi lại cũng không bao giờ chạy lại bước khớp).
- v7 (2026-10-03, commit `f74bc70`): **số dư đầu là mốc** (ADR-76) — log mà ngày VN trước `opened_at` của tài khoản khớp được ghi thẳng `status='ignored'` (đã nằm trong số dư đầu), không khớp, không báo, không kiểm lệch feed; kết quả mang `beforeOpening: true`. Lỗi gốc: đồng bộ lại từ 28/9 đưa giao dịch tháng 9 vào sổ của tài khoản mở sổ 1/10.
- v8 (2026-10-06, commit `9c265ee`): **bỏ số lũy kế** (ADR-87, change [`261006-bo-luy-ke-sepay`](../changes/archive/261006-bo-luy-ke-sepay/proposal.md)) — chủ nhà: "bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè". `INSERT` không còn cột `accumulated`; sau khi khớp không còn bước kiểm lệch feed (`checkReconcileDrift`, UC-308 v5). AC-9 bỏ phần `accumulated` / `reconcile_drift`.

## Preconditions
- `parsed` đã hợp lệ (UC-301 bước 4 hoặc UC-304 `parseHistoryRow`).

## Main Flow
1. Nếu đã có log cùng `id` → trả `{created: false, logId: id}`; **không** chạy lại bước khớp.
2. Tra `account_id` (kèm `opened_at`): `accounts.sub_account = subAccount` (nếu có), không được thì `accounts.account_no = accountNo`; không được → `NULL`. Log **trước ngày mở sổ** = tài khoản có `opened_at` và `dayKey(at)` (ngày giờ VN) < `opened_at` (ADR-76).
3. Nếu có `referenceNumber`: đã có log cùng `reference_number` và cùng `account_id` (so bằng `IS`, nên cả `NULL`) → trả `{created: false, logId: <id log cũ>}`.
4. Nếu biết `account_id` và log không trước ngày mở sổ: tìm log **song sinh** (`findPossibleTwin`): khác `source`, cùng `account_id`, `amount`, `direction`, `at` trong ±180 giây, và ít nhất một bên thiếu `reference_number` (NULL/rỗng).
5. `INSERT OR IGNORE` log với `status='pending'` (trước ngày mở sổ: `'ignored'`), `received_at = now` (UTC, khuôn SQLite). Không có dòng nào được ghi (thua race trùng id hoặc trùng unique index) → `{created: false}`.
5b. Log trước ngày mở sổ → trả `{created: true, logId, beforeOpening: true}`; dừng ở đây (2b).
6. Nếu biết `account_id` **và** không có song sinh: chạy UC-303 (tự khớp). Không có bước kiểm lệch sau đó (ADR-87).
7. Trả `{created: true, logId}`.

## Alternative Flows
- 2a. Không tra được tài khoản → log vẫn được lưu `pending`, `account_id NULL`; bỏ qua bước 4 và 6. Cron báo chưa gán hiện "TK lạ" (notify UC-407).
- 2b. **Trước ngày mở sổ** (ADR-76): `opening_balance` đã gồm khoản này. Log vẫn được lưu (để đối chiếu, và để lần sau nhận ra trùng) nhưng ở `ignored`: không xét song sinh, không khớp lệnh chuyển / ghép cặp / rule (UC-303), không vào danh sách chờ gán (UC-305) hay tin báo chưa gán (notify UC-407), không kiểm lệch feed, không tính vào `v_account_logs` (UC-308). Log ngay ngày `opened_at` (từ 00:00 giờ VN) đi luồng thường. Tài khoản `opened_at` NULL: không có mốc.
- 4a. Có song sinh → log vẫn được lưu `pending`, **không** tự khớp, **không** kiểm lệch feed; màn Gán gắn gợi ý `possible_duplicate_of` (UC-305). Người trong nhà "Bỏ qua" nếu đúng là một, gán nếu là hai giao dịch thật.
- 6a. Bước khớp ném lỗi (ví dụ lương đã ghi nhưng chia lỗi) → `recordIngestError(db, source, id, "Đã ghi giao dịch nhưng xử lý tiếp bị lỗi: …")` (UC-308); vẫn chạy kiểm lệch feed và trả `created: true`.

## Exceptions
- E1. Lỗi D1 ở bước 1–5 → ném ra; caller quyết định (webhook: 503 để SePay gửi lại; backfill: bỏ dòng đó, `console.error`).

## Acceptance Criteria
### AC-1: Cùng id → một log, không xử lý lại
- Given log id `111` đã có
- When `ingestLog` lại với id `111`
- Then `created=false`, bảng có 1 log; nếu là lương thì vẫn chỉ 1 `allocation_runs`, 1 `income`
- Tests: `test/ingest.test.ts` › "ingestLog: chống trùng › gửi lại cùng id chỉ tạo một log"; "ingestLog: rule lương — chia đúng một lần dù webhook gửi lại › tạo income taxable=0 rồi chia ngay; gửi lại cùng id không chia lần hai"

### AC-2: Khác id nhưng cùng (tài khoản, mã tham chiếu) → một log, một giao dịch
- Given webhook id `webhook-9` mã `FT26265001` đã ghi và tự gán spend
- When backfill id `api-uuid-9` cùng mã, cùng TK
- Then `created=false`, 1 log, 1 `spend`, ví `food` = −100.000
- Tests: `test/ingest.test.ts` › "ingestLog: chống trùng › id khác nhau nhưng cùng (account_id, reference_number) vẫn coi là một log"; `test/ingest-integrity.test.ts` › "webhook và cron vá đêm cùng một giao dịch › khác id nhưng cùng mã tham chiếu trong cùng tài khoản → một log, một giao dịch"

### AC-3: Chạy chen → DB chặn log thứ hai
- Given log `w1` (TK `vcb-husband`, mã `FT1`) đã có
- When request thứ hai bỏ qua bước đọc, `INSERT OR IGNORE` log `b1` cùng TK + mã
- Then 0 dòng được ghi; mã rỗng `''` thì không bị ràng buộc
- Tests: `test/ingest-integrity.test.ts` › "webhook và cron vá đêm cùng một giao dịch › chạy chen: log đã có mà request thứ hai vẫn tới được bước ghi → unique index chặn"; `test/schema.test.ts` › "chốt chặn toàn vẹn ở tầng DB › một mã tham chiếu chỉ có một log trong mỗi tài khoản; mã rỗng thì không tính"

### AC-4: Song sinh thiếu mã → lương chỉ chia một lần, log sau chờ gán "có thể trùng"
- Given webhook `wh-77` lương 40.000.000 không có mã đã tự ghi + chia
- When backfill `api-9f3c` cùng TK/số tiền/chiều, lệch 40 giây, có mã `FT26092212345678`
- Then 1 `allocation_runs`; tổng `fund` active = 40.000.000; `wealth-building` = 12.000.000; `api-9f3c` ở `pending`; `listPendingLogs` gợi ý `possible_duplicate_of: "wh-77"`
- Tests: `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → chia đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng"

### AC-5: Không bao giờ bỏ lặng lẽ một giao dịch thật cùng số tiền
- Given webhook `wh-X` 500.000 không mã
- When backfill `api-Y` 500.000 cùng TK, lệch 2 phút, có mã khác
- Then `created=true`, 2 log, `api-Y` ở `pending`
- Tests: `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › một giao dịch THẬT khác, cùng số tiền, trong 3 phút, chỉ có ở rà soát đêm → không bị mất"

### AC-6: Hai webhook khác id, cùng nguồn, cùng nội dung → hai giao dịch thật
- Tests: `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › hai webhook khác id, giống hệt nhau, đều không có mã → vẫn là hai giao dịch thật"

### AC-7: Tài khoản lạ vẫn được lưu
- Given `accountNo` không có trong `accounts`
- Then log lưu `account_id NULL`, `status='pending'`
- Tests: `test/ingest.test.ts` › "ingestLog: chống trùng › tài khoản lạ vẫn lưu log, account_id NULL, trạng thái pending"

### AC-8: Lỗi sau khi đã ghi log không im lặng
- Given cấu hình chia hỏng (tắt allocation `remainder`)
- When lương 30.000.000 về
- Then `created=true`, 1 `income`, 0 `allocation_runs`, có `notifications(kind='ingest_error')` với message chứa "xử lý tiếp bị lỗi"
- Tests: `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › lương đã ghi nhưng bước chia lỗi → không im lặng: ghi lại để tin sáng báo, webhook không bị gửi lại vô ích"

### AC-9: Log trước ngày mở sổ → `ignored`, không vào sổ, không ghép cặp, không báo, số dư theo log không đổi (ADR-76)
- Given `vcb-husband` mở sổ `2026-09-22` với 1.000.000; đã có log `mo-1` vào 200.000 lúc 00:00 ngày 22/9 (giờ VN)
- When backfill log `truoc-1` ra 100.000 lúc 23:59 ngày 21/9 giờ VN, khớp mã `EAN`; rồi webhook log `tcb-in` vào 100.000 ở `tcb-husband` 3 phút sau (đủ điều kiện ghép cặp)
- Then `ingestLog` trả `{created: true, logId: "truoc-1", beforeOpening: true}`; `truoc-1` `ignored` (giữ `account_id`, số tiền), không giao dịch nào; `tcb-in` vẫn `pending`; `feed_balance` của `vcb-husband` = 1.200.000, `pending_count` = 1; danh sách chờ gán chỉ `mo-1`, `tcb-in`; gửi lại `truoc-1` → `created: false`
- Tests: `test/ingest.test.ts` › "số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76) › log trước mốc lưu 'ignored': không khớp rule, không ghép cặp, không báo chờ gán, không làm lệch đối soát; số dư theo log giữ nguyên"

### AC-10: Log đúng ngày mở sổ đi luồng thường
- Given như AC-9
- When log ra 100.000 lúc 00:00 ngày 22/9 giờ VN (`2026-09-21T17:00:00Z`), mã `EAN`
- Then log `assigned`, một `spend`; `feed_balance` = 900.000
- Tests: `test/ingest.test.ts` › "số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76) › log đúng ngày mở sổ đi luồng thường: khớp rule, vào sổ, vào số dư theo log"

### AC-11: Tài khoản không có ngày mở sổ — như trước
- Given `tcb-husband` `opened_at` NULL, `opening_balance` 300.000
- When log vào 100.000 ngày 01/01/2020
- Then log `pending`; `feed_balance` = 400.000
- Tests: `test/ingest.test.ts` › "số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76) › tài khoản không có ngày mở sổ: log cũ bao lâu vẫn chờ gán và vào số dư theo log như trước"

## Traceability
- Code: `src/services/ingest.ts` › `ingestLog` (`beforeOpening`), `findPossibleTwin`, `sqliteDateTime`, `recordIngestError`; `src/domain/period.ts` › `dayKey`
- Migrations/DB: `bank_logs` PK `id`; `idx_logs_ref` UNIQUE partial (`migrations/0005_ingest_integrity_guards.sql`); `accounts.opened_at` (`migrations/0001_schema.sql`), `v_account_logs` theo mốc (`migrations/0016_opening_date_cutoff.sql`)

## Divergences & Open Questions
- [DIVERGENCE] `phase-04-ingest-sepay.md` §"Rà soát 02:00" bước 2–3: trùng (TK, số tiền, hướng, thời điểm) → "Đã có → bỏ qua"; code (`43baea1`) vẫn ghi log và chỉ đánh dấu "có thể trùng". `docs/core_design_rules.md` §9 đã cập nhật theo code.
- [OPEN] Log `account_id NULL`: bước 3 vẫn chống trùng tuần tự (so bằng `IS`), nhưng unique index coi các `NULL` là khác nhau nên hai request chạy chen cho TK lạ cùng mã FT không bị DB chặn. Không có test.
- [OPEN] `findPossibleTwin` không lọc trạng thái log kia (log `ignored` cũng được tính) và so `at` bằng `BETWEEN` chuỗi — đúng khi mọi `at` cùng khuôn ISO `…Z` như `vnDateTimeToIso` sinh.
- [OPEN] Log song sinh ở `pending` vẫn là ứng viên ghép cặp nội bộ cho log đến sau (câu truy vấn ứng viên ở UC-303 chỉ lọc `status='pending'`) — [INFERENCE] từ code, không có test.
- [OPEN] Id webhook và id API lịch sử có trùng nhau không, và webhook MB có luôn mang `referenceCode` không — chưa quan sát thật (`phase-00-sepay-spike.md` bước 5; `redteam-260922-0100-money-correctness.md` câu hỏi 1).
