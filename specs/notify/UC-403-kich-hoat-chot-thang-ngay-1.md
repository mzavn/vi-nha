# UC-403: Kích hoạt chốt tháng ngày 1
- Status: implemented
- BR: BR-02, BR-06, BR-07
- Decisions: D3 (chỉ quét số dư dương của phong bì chung; ví âm không bị đụng); `docs/core_design_rules.md` §5 dòng "Cuối tháng", §9 "Tuần dư"; phase-07 § Hằng ngày "Ngày 1 hằng tháng"
- Actor: lượt cron (UC-401: mỗi 15 phút, 01:00–03:59 VN mỗi giờ) ngày 1 theo lịch VN, từ giờ tin sáng `notify_daily_time` (mặc định 07:00) — **kể cả khi tin sáng đang tắt**
- Trigger: `src/cron/daily.ts` › `closePreviousMonthOnDayOne` — gọi từ `daily` (tin sáng bật) hoặc thẳng từ `runScheduledDigests` (tin sáng tắt)

Engine quét dư và sinh lệnh chuyển tiền thuộc allocation: **UC-207 Chốt tháng: quét dư phong bì chung sang Tích sản** (`closeMonth`). UC này chỉ quy định *khi nào* gọi và *báo gì*.

## History
- v1 (2026-09-22, commit `13e89cc`): tin sáng ngày 1 gọi `closeMonth(previousMonth)` trước khi dựng tin; thêm dòng 🧹 và các dòng 🔁 lệnh chuyển tiền.
- v2 (2026-10-01, commit `a301077`): giờ chốt = giờ tin sáng ở Cài đặt (mặc định 07:00) thay cho cron cố định; tách `closePreviousMonthOnDayOne` khỏi `daily` để tắt tin sáng vẫn chốt tháng (việc của sổ), chỉ không gửi; lượt lỗi nhả mốc nên lượt 5 phút sau thử lại (UC-401, ADR-68).
- v3 (2026-10-01, commit `e72b5de`): lượt cron mỗi 15 phút (đêm 01:00–03:59 mỗi giờ) thay cho mỗi 5 phút; lượt lỗi được lượt cron kế tiếp làm lại (ADR-70).
- v4 (2026-10-03, commit `4e6d103`): tin sáng xếp việc cần làm trước thông tin (ADR-79) — dòng 🧹/🔁 thành mục cuối của phần việc cần làm, trước 🎯 và 🏦; bản ngắn của tin sáng có mục `quét <tiền> dư tháng <m> (<k> lệnh chuyển)`. AC-3 sửa.

## Preconditions
- `now` rơi vào ngày 1 theo giờ VN (`dayKey(now)` kết thúc bằng `-01`).

## Main Flow
0. Tới giờ tin sáng ngày 1 (UC-401 bước 3c): tin sáng bật → `daily` gọi bước 1–4 rồi dựng tin; tắt → `runScheduledDigests` chỉ gọi bước 1–4, bỏ bước 5.
1. `month = previousMonth(monthKey(now))` (ví dụ 07:00 VN 1/10/2026 → `2026-09`).
2. `closed = closeMonth(db, month)` (UC-207) — chạy **trước** `getSnapshot`, nên các số trong tin sáng đã phản ánh việc quét.
3. `sweptAmount = Σ closed.sweeps[].amount`.
4. Nếu `sweptAmount > 0`: dựng `monthClose = { month, amount, transfers }`, mỗi lệnh chuyển tiền đổi `fromAccountId`/`toAccountId` sang tên tài khoản qua `loadRefs` (không tìm thấy → giữ id).
5. Tin sáng (UC-402) thêm, cuối phần việc cần làm (sau 🏠, trước các dòng thông tin 🎯 … 🏦):
   - `🧹 Đã quét <tiền> dư tháng <số tháng> sang Tích sản`
   - mỗi lệnh: `🔁 Chuyển <tiền> từ <TK nguồn> sang <TK đích>`
   Bản ngắn (thông báo đẩy) thêm một mục `quét <tiền> dư tháng <số tháng>`, kèm ` (<k> lệnh chuyển)` khi có lệnh (UC-402 § Bản ngắn).

## Alternative Flows
- 2a. Tháng đã chốt (đã có giao dịch mang `batch_id = 'S<yyyymm>'`) → `closeMonth` trả `already: true`, `sweeps: []` → không quét lại, không có dòng 🧹.
- 4a. Không có gì để quét (`sweptAmount = 0`) → không có dòng 🧹.

## Exceptions
- E1. `closeMonth` ném lỗi → `daily` dừng, không gửi tin sáng; mốc `daily_run` được nhả nên lượt cron kế tiếp chốt và gửi lại (UC-401 bước 3c, E1).

## Acceptance Criteria
### AC-1: Quét đúng một lần dù cron chạy hai lần; ví cá nhân và ví âm không bị đụng
- Given tháng 9 đã chia lương 40.000.000 ₫, Ăn uống tiêu 3.000.000 ₫ (âm 500.000 ₫)
- When `daily` chạy 07:00 VN 1/10 hai lần
- Then có đúng 2 giao dịch `batch_id='S202609'`; Tích sản = 12.000.000 + 1.200.000 + 3.440.000 ₫; `fun-husband` giữ 3.280.000 ₫; tin có `🧹 Đã quét 4.640.000 ₫ dư tháng 9 sang Tích sản` và `🔁 Chuyển 4.640.000 ₫ từ VCB (chính) sang TCB (Tích sản)`; lần chạy thứ hai không thêm giao dịch và không gửi thêm tin
- Tests: `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › quét đúng một lần dù chạy cron hai lần; ví cá nhân không bị đụng"

### AC-2: Không có gì để quét thì không có dòng chốt tháng
- Given DB seed, không có số dư phong bì chung
- When `daily` chạy 1/10
- Then tin không chứa `🧹`
- Tests: `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › không có gì để quét thì không có dòng chốt tháng"; `test/format.test.ts` › "dailyMessage › chốt tháng quét được 0 đồng thì không thêm dòng nào"

### AC-3: Dòng chốt tháng kèm lệnh chuyển tiền, đúng vị trí
- Given `monthClose = { month: "2026-09", amount: 4640000, transfers: [VCB (chính) → TCB (Tích sản)] }`
- When `dailyMessage`
- Then bản đầy đủ đúng bốn dòng `💰 …`, `🧹 Đã quét 4.640.000 ₫ dư tháng 9 sang Tích sản`, `🔁 Chuyển 4.640.000 ₫ từ VCB (chính) sang TCB (Tích sản)`, `🏦 Đối soát: khớp` — 🧹 và 🔁 nằm **trước** dòng đối soát
- Tests: `test/format.test.ts` › "dailyMessage › ngày 1: dòng chốt tháng kèm lệnh chuyển tiền, chỉ hiện khi số quét > 0"

### AC-4: Không phải ngày 1 thì không chốt
- Given `now` là ngày 2..31 (VN)
- When `daily` chạy
- Then `closeMonth` không được gọi
- Tests: ⚠ Chưa có test (gián tiếp: các test `daily` ngày 22/9 không sinh giao dịch `S…`, nhưng không test khẳng định)

### AC-5: Tắt tin sáng vẫn chốt tháng ngày 1, đúng giờ tin sáng, một lần
- Given tháng 9 đã chia lương 40.000.000 ₫; `notify_daily_enabled = '0'`, giờ tin sáng 07:00
- When các lượt 06:45, 07:00, 07:15 ngày 1/10
- Then 06:45 chưa có giao dịch `S202609`; 07:00 có; 07:15 không thêm; không tin nào được gửi
- Tests: `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › tắt tin sáng: không gửi gì, nhưng ngày 1 vẫn chốt tháng trước từ giờ tin sáng"

## Traceability
- Code: `src/cron/daily.ts` › `closePreviousMonthOnDayOne`, `daily`; `src/cron/schedule.ts` › `runScheduledDigests`; `src/domain/close.ts` › `previousMonth`; `src/services/ledger.ts` › `closeMonth`, `loadRefs`; `src/notify/format.ts` › `dailyMessage` (`monthClose`)
- Migrations/DB: `transactions.batch_id`, `transfer_orders` (thuộc allocation/ledger)

## Divergences & Open Questions
- [DIVERGENCE] Phase-07 ghi "Idempotent nhờ `batch_id = sweep-<month_key>`" (`plans/260921-2228-profit-first-pwa/phase-07-cron-telegram.md` § Hằng ngày) nhưng code dùng `batch_id = 'S' + yyyymm` (`src/services/ledger.ts` › `closeMonth`: `` `S${month.replace("-", "")}` ``; test khẳng định `'S202609'`).
- [OPEN] `closeMonth` chỉ được gọi từ lượt cron ngày 1 (không có route/MCP tool nào gọi nó — grep `closeMonth` trong `src/`). Lượt lỗi hay lỡ được lượt 5 phút sau làm bù trong ngày 1 (UC-401), nhưng nếu Worker không chạy suốt ngày 1 thì tháng trước không bao giờ được chốt tự động và không có đường chốt tay.
- [OPEN] Nếu lần chạy đầu đã chốt xong nhưng hỏng trước khi gửi, lần chạy lại cùng ngày gửi tin **không có** dòng 🧹 (vì `closeMonth` trả `already`) — người nhà không được báo đã quét.
- [OPEN] Chưa có bot token vẫn chốt tháng (tác dụng phụ xảy ra dù không ai được báo).
