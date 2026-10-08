# UC-404: Nhắc đếm ví / nhập số dư Chủ nhật
- Status: implemented
- BR: BR-04, BR-06
- Decisions: D14 (tài khoản có bank feed không nhập tay / chỉ đếm khi hết log chưa gán); `docs/core_design_rules.md` §5 dòng "Chủ nhật", §7 "Tiền mặt", §8 dòng "Chủ nhật"; phase-07 § Hằng ngày "Chủ nhật"
- Actor: tin sáng (UC-402) vào Chủ nhật theo lịch VN — giờ gửi là giờ tin sáng ở Cài đặt (`notify_daily_time`, mặc định 07:00); tắt tin sáng thì không có lời nhắc
- Trigger: `src/cron/daily.ts` › `daily` khi `isoWeekday(now) === 7`

Không có cron riêng: lời nhắc là một dòng trong tin sáng (UC-402). Việc đếm thật (ghi `cash_counts`, bút toán `adjust`) thuộc ledger: **UC-105 Đếm số dư tài khoản → bút toán điều chỉnh**; màn đếm thuộc pwa: **UC-708 Đếm ví / nhập số dư thật**.

## History
- v1 (2026-09-22, commit `13e89cc`): dòng 🧮 nhắc đếm ví tiền mặt và nhập số dư tài khoản ghi tay.
- (commit `b8e8f0c`: test chuyển sang bối cảnh tài khoản ngân hàng có feed / ghi tay tách biệt — D14.)
- v2 (2026-10-01, commit `a301077`): giờ nhắc = giờ tin sáng chỉnh ở Cài đặt (mặc định 07:00) thay cho cron cố định `0 0 * * *` (UC-401, ADR-68); `isoWeekday` chuyển sang `src/domain/period.ts`.
- v3 (2026-10-03, commit `4e6d103`): tin sáng xếp việc cần làm trước thông tin (ADR-79) — dòng 🧮 nằm trong phần việc cần làm (sau 📅, trước 🏠/🧹 và các dòng thông tin), không còn là dòng cuối; bản ngắn có mục `đếm ví tiền mặt`.

## Preconditions
- `now` là Chủ nhật theo giờ VN (`src/domain/period.ts` › `isoWeekday`, offset +7h).

## Main Flow
1. Lấy tài khoản đang hoạt động (`loadRefs` → `accounts WHERE active = 1`).
2. Chọn tài khoản cần đếm tay: `kind='cash'`, hoặc `kind ∈ {bank, ewallet}` **và** `sepay_enabled = 0` (tài khoản ghi tay). Tài khoản có bank feed bị loại.
3. Với mỗi tài khoản, `lastCountAt` = `MAX(cash_counts.at)` lấy từ `reconcile(db)` (UC-106). Giữ tài khoản khi không có `lastCountAt` hoặc `lastCountAt < now − 7 × 24 giờ`.
4. Nếu danh sách khác rỗng, tin sáng thêm dòng (phần việc cần làm, sau 📅, trước 🏠 — UC-402 § Luật định dạng): `🧮 Chủ nhật: đếm ví tiền mặt, nhập số dư — <tên TK>, <tên TK>` (tên đã escape HTML, nối bằng `, `); bản ngắn thêm mục `đếm ví tiền mặt`.

## Alternative Flows
- 1a. Không phải Chủ nhật → không tính, không có dòng 🧮.
- 4a. Mọi tài khoản ghi tay đã được đếm trong 7 ngày → không có dòng.

## Exceptions
- (không có xử lý riêng; lỗi DB làm hỏng cả tin sáng — UC-401 E1)

## Acceptance Criteria
### AC-1: Nhắc mọi ví tiền mặt chưa đếm trong 7 ngày; tài khoản có feed không cần đếm
- Given Chủ nhật 27/9/2026, mọi TK ngân hàng có `sepay_enabled = 1`, chưa có `cash_counts`
- When `daily` chạy 07:00 VN
- Then tin có `🧮 Chủ nhật: đếm ví tiền mặt, nhập số dư — Tiền mặt (chồng), Tiền mặt (vợ)`
- Tests: `test/cron-daily.test.ts` › "Chủ nhật: nhắc đếm ví tiền mặt / nhập số dư TK ghi tay › chưa có cash_counts trong 7 ngày → nhắc cả hai ví tiền mặt (tài khoản ngân hàng có feed thì không cần đếm)"

### AC-2: Đã đếm trong 7 ngày thì không nhắc lại
- Given `cash-husband` có `cash_counts` hôm qua
- Then tin nhắc `Tiền mặt (vợ)` nhưng không nhắc `Tiền mặt (chồng)`
- Tests: `test/cron-daily.test.ts` › "Chủ nhật: nhắc đếm ví tiền mặt / nhập số dư TK ghi tay › đã đếm trong 7 ngày thì không nhắc lại ví đó"

### AC-3: Tài khoản ngân hàng ghi tay cũng được nhắc
- Given mọi tài khoản `sepay_enabled = 0`
- Then dòng 🧮 có `VCB (chính)`
- Tests: `test/cron-daily.test.ts` › "Chủ nhật: nhắc đếm ví tiền mặt / nhập số dư TK ghi tay › tài khoản ngân hàng ghi tay cũng được nhắc nhập số dư"

### AC-4: Ngày khác không nhắc
- Given thứ Ba 22/9/2026
- Then tin không chứa `🧮`
- Tests: `test/cron-daily.test.ts` › "Chủ nhật: nhắc đếm ví tiền mặt / nhập số dư TK ghi tay › không phải Chủ nhật thì không có dòng nhắc"

### AC-5: Câu chữ dòng nhắc
- Given `cashCountReminder = ["Tiền mặt (chồng)", "Tiền mặt (vợ)"]`
- Then `🧮 Chủ nhật: đếm ví tiền mặt, nhập số dư — Tiền mặt (chồng), Tiền mặt (vợ)`
- Tests: `test/format.test.ts` › "dailyMessage › Chủ nhật: nhắc đếm ví/nhập số dư kèm tên tài khoản"

## Traceability
- Code: `src/cron/daily.ts` › `daily` (nhánh `isoWeekday(now) === 7`); `src/domain/period.ts` › `isoWeekday`; `src/services/ledger.ts` › `loadRefs`, `reconcile` (`lastCountAt`); `src/notify/format.ts` › `dailyMessage` (`cashCountReminder`)
- Migrations/DB: `cash_counts` (`migrations/0001_schema.sql`), `accounts.sepay_enabled`

## Divergences & Open Questions
- [OPEN] Câu chữ dòng 🧮 do agent phase-07 tự soạn, chưa được duyệt (`plans/reports/fullstack-developer-260922-0020-cron-telegram.md` "Giả định cần xác nhận" #2).
- [OPEN] Mốc "7 ngày" tính theo giờ tuyệt đối (`now − 7×86.400.000 ms`), không theo ngày lịch VN: một lần đếm lúc 08:00 Chủ nhật tuần trước sẽ vẫn được coi là "trong 7 ngày" ở lần nhắc 07:00 Chủ nhật này.
