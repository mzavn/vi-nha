# UC-903: Gán giao dịch ngân hàng là trả nợ
- Status: implemented
- BR: BR-12, BR-04
- Decisions: ADR-71 (trả nợ = khoản chi có `debt_id`), D14/ADR-66 (khoản chi từ tài khoản SePay báo tiền ra chỉ vào sổ qua gán log), luật 6 (`docs/core_design_rules.md` §1 — máy không tự đoán khoản nợ); ADR-106 (khoản có lãi: tách dòng lãi `interest_debt_id` và dòng gốc `debt_id`)
- Actor: người trong hộ (PWA màn Gán — [UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md)); Claude qua MCP `assign_log`
- Trigger: `POST /v1/logs/:id/assign { splits: [{ meaning: "spend", amount, debt_id?, interest_debt_id?, category_id?, wallet_id?, note? }, …] }` ([ingest UC-305](../ingest/UC-305-gan-log-chua-gan.md))

## History
- v1 (2026-10-01, commit `25db5b9`): mỗi split `spend` nhận `debt_id` (cùng luật với nhập tay, qua `buildEntry`); MCP `assign_log` nhận `debt_id` trong split (ADR-71).
- v2 (2026-10-08, commit `8cd48b8`): split `spend` nhận `interest_debt_id` (trả lãi, cùng luật ledger UC-101 4k) — route, `assign_log` MCP; màn Gán chọn "Trả nợ cho" một khoản có lãi thì tách sẵn hai dòng lãi / gốc, sửa được trước khi Gán (ADR-106). Thêm AC-4 (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))

## Preconditions
- Log `out` đang `pending` (tiền trả nợ đi từ tài khoản có SePay — webhook hoặc rà soát 02:00). Khoản nợ tồn tại và đang bật ([UC-901](UC-901-them-va-xem-khoan-no.md)).

## Main Flow
1. Log tiền ra về, nằm `pending` ở màn Gán. Máy **không** tự gắn khoản nợ: rule tự gán không có `debt_id` (UC-307), nên trả nợ luôn là một lần gán tay.
2. Ở sheet gán (pwa [UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md) bước 5a), dòng **Chi tiêu** có ô **Trả nợ cho** (khoản còn nợ từ `bootstrap.debts`, mỗi khoản "{tên} · còn X", mặc định "không phải trả nợ"); chọn một khoản thì danh mục thành Trả nợ, ví theo danh mục (ví giữ riêng). Có thể tách log thành nhiều dòng, chỉ một phần là trả nợ.
   - **Khoản có lãi suất > 0** ([UC-901](UC-901-them-va-xem-khoan-no.md), ADR-106): chọn khoản đó thì dòng được **tách sẵn hai dòng** bằng tách dòng có sẵn của màn Gán (`assignDebtRows`): **lãi** = `min(số tiền dòng, max(0, lãi dự kiến tháng này − lãi đã trả tháng này))` — danh mục "Lãi vay" (`loan-interest`), ví mặc định của danh mục, `interest_debt_id` = khoản nợ, dòng phụ "Trả lãi cho {tên} — chi phí tháng ở ví Lãi vay, không giảm nợ."; **gốc** = phần còn lại — danh mục Trả nợ, `debt_id`. Phần bằng 0 thì không có dòng đó. Hai dòng sửa được (số tiền, danh mục, ví) trước khi Gán; tổng vẫn phải bằng số tiền log. Khoản 0% → một dòng như cũ.
3. `POST /v1/logs/:id/assign`: route đọc `debt_id`, `interest_debt_id` của từng split (`parseSplit`); `assignLog` → `splitToEntryInput` → `buildEntry` với cùng luật như UC-902 bước 4 (`debt_spend_only`, `unknown_debt`, `inactive_debt`, thiếu danh mục → `debt-payment`; split lãi: `interest_spend_only`, `debt_and_interest`, thiếu danh mục → `loan-interest` — ledger UC-101 4k). Mọi kiểm tra chạy **trước** khi ghi; một batch chèn mọi dòng + `markAssigned`.
4. Dòng `spend` mang `debt_id`, `log_id`, `source = 'sepay'` → còn nợ giảm đúng số tiền dòng đó; khoản trả hiện trong `payments` của khoản nợ với `source: 'sepay'`. Dòng mang `interest_debt_id` không giảm nợ — vào ví "Lãi vay" và "lãi đã trả tháng này" của khoản.

## Alternative Flows
- 2a. **MCP** `assign_log { log_id, splits: [{ meaning: "spend", amount, debt_id, … }] }` — cùng `assignLog`; khoản có lãi thì Claude gửi hai split (một `interest_debt_id`, một `debt_id`).
- 3a. Tài khoản "chỉ tiền vào" (`sepay_out = 0`, ADR-66): khoản trả có thể đã nhập tay (UC-902); log `out` về sau mang lời nhắc "có thể đã nhập tay" — người Bỏ qua log thay vì gán lần hai.
- 5. **Gỡ gán** (ingest UC-306) → giao dịch `void`, log về `pending`, còn nợ tự trở lại.

## Exceptions
- E1. `debt_id` trên split không phải `spend` → 400 `debt_spend_only`, log vẫn `pending`, không ghi gì.
- E2. `debt_id` / `interest_debt_id` không có / khoản đã tắt → 400 `unknown_debt` / `inactive_debt`, không ghi gì; split mang cả hai → 400 `debt_and_interest`; `interest_debt_id` trên split không phải `spend` → 400 `interest_spend_only`.
- E3. Tổng split ≠ số tiền log → 400 `split_mismatch` (UC-305).

## Acceptance Criteria

### AC-1: Gán log tiền ra thành khoản trả nợ làm giảm số còn nợ
- Given Cô Mai mở sổ 5.000.000; log `out` 2.000.000 ở `vcb-husband` `pending`
- When gán `[{ meaning: "spend", amount: 2000000, debt_id: "co-mai" }]` (không chọn danh mục)
- Then 201; giao dịch có `debt_id = "co-mai"`, `category_id = "debt-payment"`, `source = "sepay"`; `paid` 2.000.000, còn nợ 3.000.000; `payments` có `{ amount: 2000000, accountId: "vcb-husband", source: "sepay" }`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền ra thành khoản trả nợ (debt_id) làm giảm số còn nợ"

### AC-2: `debt_id` sai trên split bị từ chối, không ghi nửa chừng
- Given log `out` 1.000 `pending`
- When gán split `transfer` kèm `debt_id`; hoặc `spend` với `debt_id` không có / đã tắt
- Then 400 `debt_spend_only` / `unknown_debt` / `inactive_debt`; log vẫn `pending`, 0 giao dịch
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền ra thành khoản trả nợ (debt_id) làm giảm số còn nợ" (phần `debt_spend_only`); `unknown_debt`/`inactive_debt` khi gán: ⚠ Chưa có test

### AC-3: Gỡ gán khoản trả nợ thì số còn nợ trở lại
- Given log đã gán thành khoản trả nợ 2.000.000
- When gỡ gán (`POST /v1/logs/transactions/:txId/void`)
- Then log về `pending`, còn nợ về 15.379.000
- Tests: ⚠ Chưa có test

### AC-4: Gán log trả khoản có lãi tách sẵn hai dòng lãi / gốc
- Given log tiền ra 2.300.000 ở `vcb-husband` `pending`; khoản "Vay tiêu dùng" 18%, lãi dự kiến tháng 11 là 300.000, chưa trả lãi
- When ở màn Gán chọn "Trả nợ cho" khoản đó; Gán `[{ meaning: "spend", amount: 300000, interest_debt_id: "vay-tieu-dung" }, { meaning: "spend", amount: 2000000, debt_id: "vay-tieu-dung" }]`
- Then màn tách sẵn hai dòng: lãi 300.000 (`loan-interest`, `interest_debt_id`), gốc 2.000.000 (`debt_id`) — khoản 0% một dòng như cũ; sửa được trước khi Gán; Gán → 201, hai giao dịch: 300.000 `category_id = "loan-interest"`, `interest_debt_id`, `debt_id = null`; 2.000.000 `category_id = "debt-payment"`, `debt_id`; còn nợ 18.000.000
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "debt, ledger, allocation: lãi vay hằng tháng (ADR nháp H) › UC-903 AC-4: Gán log tiền ra 2.300.000 thành hai dòng — lãi 300.000 (interest_debt_id) và gốc 2.000.000 (debt_id)"; [`web/src/lib/interest.test.ts`](../../web/src/lib/interest.test.ts) › "lãi vay: sheet Trả nợ tách lãi / gốc › UC-903 AC-4: Gán log tiền ra 2.300.000 cho khoản có lãi → tách sẵn hai dòng: lãi 300.000 (`loan-interest`, `interest_debt_id`), gốc 2.000.000 (`debt_id`); khoản 0% một dòng như cũ"; màn Gán thật (chọn khoản → hai dòng hiện, sửa rồi Gán): ⚠ Chưa có test (repo chưa có test giao diện; khi apply chưa thử trên giao diện vì cần một log ngân hàng đang chờ gán)

## Traceability
- Code: `src/routes/logs.ts` › `parseSplit` (`debt_id`, `interest_debt_id`); `src/services/ingest.ts` › `Split.debt_id`, `Split.interest_debt_id`, `assignLog`, `splitToEntryInput`; `src/domain/entry.ts` › `buildEntry`; `src/mcp/tools.ts` › `assign_log`
- PWA: màn Gán ([UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md)) — `web/src/screens/assign.tsx` (ô "Trả nợ cho", tách lãi / gốc), `web/src/lib/interest.ts` › `assignDebtRows`, `hasInterest`; `web/src/lib/splits.ts` › `Split.interest_debt_id`
- Migrations/DB: `transactions.debt_id`, view `v_debt_balance` (`migrations/0013_debts.sql`); `trg_tx_needs_pending_log` (migration 0005); `transactions.interest_debt_id`, danh mục `loan-interest` (`migrations/0031_balance_sheet.sql`)

## Divergences & Open Questions
- [OPEN] `create_rule` vẫn chỉ lưu ví/danh mục (bảng `rules` không có `debt_id`): rule rút từ một lần gán trả nợ không mang khoản nợ, nên log cùng nội dung lần sau tự gán thành chi `debt-payment` **không** giảm còn nợ — người phải tránh tạo rule cho khoản trả nợ.
