# UC-405: Nhắc khoản thu chưa chia ngày 10 & 25
- Status: implemented
- BR: BR-02, BR-06
- Decisions: D2 ("Chia ngay từng income … Ngày 10/25 chỉ là lời nhắc nếu còn income chưa chia"); `docs/core_design_rules.md` §5 dòng "Ngày 10 & 25", §9 "Nhịp chia"; phase-07 § Hằng ngày "Ngày 10 & 25 … Chỉ nhắc, không tự chia. Gộp vào cron này để tiết kiệm trigger"
- Actor: tin sáng (UC-402) vào ngày 10 hoặc 25 theo lịch VN — giờ gửi là giờ tin sáng ở Cài đặt (`notify_daily_time`, mặc định 07:00); tắt tin sáng thì không có lời nhắc
- Trigger: `src/cron/daily.ts` › `daily` khi `dayOfMonth ∈ {10, 25}`

Việc chia thật thuộc allocation: **UC-203 Chia một khoản thu nhập**.

## History
- v1 (2026-09-22, commit `13e89cc`): dòng 📅 trong tin sáng ngày 10 & 25.
- v2 (2026-10-01, commit `a301077`): giờ nhắc = giờ tin sáng chỉnh ở Cài đặt (mặc định 07:00) thay cho cron cố định `0 0 * * *` (UC-401, ADR-68).
- v3 (2026-10-03, commit `4e6d103`): tin sáng xếp việc cần làm trước thông tin (ADR-79) — dòng 📅 nằm sau ⚠️, trước 🧮; bản ngắn có mục `còn <N> khoản thu chưa chia`.
- v4 (2026-10-04, commit `04c415b`): change [`261004-gan-chua-chia`](../changes/archive/261004-gan-chua-chia/proposal.md) — số đếm lấy từ snapshot (`attention.unallocatedIncome.count`, ledger UC-103) thay cho truy vấn riêng trong cron: một định nghĩa "chưa chia" cho lời nhắc này và banner Hôm nay (pwa UC-702). Hành vi tin không đổi. Khoản thu chưa chia nay còn có thể do người nhà chủ ý chọn "Gán, để chia sau" / "Ghi, để chia sau" (pwa UC-706, UC-705) — lời nhắc vẫn đếm chúng.

## Preconditions
- `dayKey(now)` (giờ VN) là ngày 10 hoặc 25.

## Main Flow
1. Đếm `transactions` có `status='active'`, `meaning='income'` và **không** có dòng `allocation_runs` với `income_tx_id` tương ứng — không giới hạn theo tháng. Số này là `snapshot.attention.unallocatedIncome.count` (`UNALLOCATED_INCOME_SQL`, ledger UC-103), cùng số banner "khoản thu chưa chia" ở Hôm nay.
2. Nếu số đếm > 0, tin sáng thêm dòng: `📅 Hôm nay ngày <10|25>: còn <N> khoản thu chưa chia` (phần việc cần làm, sau ⚠️, trước 🧮 — UC-402 § Luật định dạng); bản ngắn thêm mục `còn <N> khoản thu chưa chia`.
3. Không gọi engine chia — không có bút toán `fund` nào được tạo.

## Alternative Flows
- 1a. Ngày khác 10/25 → không có dòng 📅 dù còn khoản thu chưa chia (snapshot vẫn đếm, tin không dùng).
- 2a. Không còn khoản thu chưa chia → không có dòng.

## Exceptions
- (không có xử lý riêng — UC-401 E1)

## Acceptance Criteria
### AC-1: Ngày 10 nhắc nhưng không tự chia
- Given một income 10.000.000 ₫ chưa chia
- When `daily` chạy 07:00 VN ngày 10/9/2026
- Then tin có `📅 Hôm nay ngày 10: còn 1 khoản thu chưa chia` và không có giao dịch `meaning='fund'` nào
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › ngày 10: nhắc nếu còn income chưa chia, không tự chia"

### AC-2: Ngày thường không nhắc
- Given một income chưa chia, ngày 22/9
- Then tin không chứa `📅`
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › ngày thường (không 10/25) thì không có dòng nhắc income dù còn chưa chia"

### AC-3: Ngày 25 cũng nhắc
- Given một income chưa chia
- When `daily` chạy ngày 25
- Then tin có `📅 Hôm nay ngày 25: còn 1 khoản thu chưa chia`
- Tests: ⚠ Chưa có test

## Traceability
- Code: `src/cron/daily.ts` › `daily` (nhánh `dayOfMonth === 10 || dayOfMonth === 25`, đọc `snapshot.attention.unallocatedIncome`); `src/services/ledger.ts` › `getSnapshot`, `UNALLOCATED_INCOME_SQL`; `src/notify/format.ts` › `dailyMessage` (`incomeReminder`)
- Migrations/DB: `allocation_runs` (`migrations/0003_offline_entry_and_allocation_runs.sql`), `transactions`

## Divergences & Open Questions
- [OPEN] Đếm mọi khoản thu chưa chia từ trước tới nay, kể cả khoản người nhà cố ý không chia — không có cách đánh dấu "không cần chia" nên lời nhắc lặp lại ở mọi ngày 10/25 cho tới khi khoản đó được chia hoặc huỷ.
- [OPEN] Khoản thu bị tự chia ngay khi về (lương qua bank feed, UC-203/UC-303) không bao giờ được báo qua Telegram — xem UC-409 và `plans/reports/redteam-260922-0100-auth-exposure.md` (sửa tối thiểu (c)).
