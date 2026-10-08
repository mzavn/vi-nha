# UC-409: Báo lương về & đã chia
- Status: spec-only
- BR: BR-02, BR-06
- Decisions: `docs/core_design_rules.md` §8 dòng "Lương về & đã chia → bảng chia + lệnh chuyển tiền cần làm" (có từ commit `5ad880f`); `plans/reports/redteam-260922-0100-auth-exposure.md` "Sửa tối thiểu" (c): "chí ít gửi ngay một tin Telegram khi có `income` mới được tự nhận diện + tự chia"
- Actor: hệ thống, sau khi một khoản thu được chia (UC-203 Chia một khoản thu nhập)
- Trigger: [OPEN] chưa có trong code — docs không nói rõ là mọi lần chia hay chỉ lần tự chia qua bank feed

## History
- Chưa có commit nào hiện thực. Luật nằm trong `docs/core_design_rules.md` §8 từ commit `5ad880f` (2026-09-22).

## Preconditions
- Một khoản thu vừa có `allocation_runs` (đã chia).

## Main Flow (theo docs, chưa hiện thực)
1. Sau khi chia, gửi cho người nhận (UC-408) một tin gồm bảng chia và các lệnh chuyển tiền cần làm của lần chia đó.

## Alternative Flows
- (chưa quyết)

## Exceptions
- (chưa quyết)

## Acceptance Criteria
### AC-1: Có tin khi lương về và đã chia
- Given một khoản lương được ghi sổ và chia (tay hoặc tự động)
- When lần chia hoàn tất
- Then mỗi người nhận có một tin chứa bảng chia và lệnh chuyển tiền cần làm
- Tests: ⚠ Chưa có test (chưa hiện thực)

## Traceability
- Code: không có. `notifyMembers` chỉ được gọi từ `src/cron/daily.ts`, `src/cron/weekly.ts`, `src/cron/pending-notifier.ts`; `src/services/ledger.ts` › `allocateIncome` không gửi tin.
- Migrations/DB: —

## Divergences & Open Questions
- [DIVERGENCE] `docs/core_design_rules.md` §8 hứa tin "Lương về & đã chia", nhưng code không gửi tin nào khi chia (`src/services/ledger.ts` › `allocateIncome`; không có lời gọi `notifyMembers` ngoài `src/cron/`). Lương tự chia qua bank feed không xuất hiện ở tin chưa gán (UC-407, không còn `pending`) lẫn nhắc 10/25 (UC-405, đã chia) — người nhà chỉ thấy khi mở app.
- [OPEN] Khoá chống trùng dự kiến (ví dụ `kind` + id khoản thu) và nội dung "bảng chia" chưa được quyết.
