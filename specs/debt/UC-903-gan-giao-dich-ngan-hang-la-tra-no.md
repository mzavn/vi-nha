# UC-903: Gán giao dịch ngân hàng là trả nợ
- Status: implemented
- BR: BR-12, BR-04
- Decisions: ADR-71 (trả nợ = khoản chi có `debt_id`), D14/ADR-66 (khoản chi từ tài khoản SePay báo tiền ra chỉ vào sổ qua gán log), luật 6 (`docs/core_design_rules.md` §1 — máy không tự đoán khoản nợ)
- Actor: người trong hộ (PWA màn Gán — [UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md)); Claude qua MCP `assign_log`
- Trigger: `POST /v1/logs/:id/assign { splits: [{ meaning: "spend", amount, debt_id, category_id?, wallet_id?, note? }, …] }` ([ingest UC-305](../ingest/UC-305-gan-log-chua-gan.md))

## History
- v1 (2026-10-01, commit `25db5b9`): mỗi split `spend` nhận `debt_id` (cùng luật với nhập tay, qua `buildEntry`); MCP `assign_log` nhận `debt_id` trong split (ADR-71).

## Preconditions
- Log `out` đang `pending` (tiền trả nợ đi từ tài khoản có SePay — webhook hoặc rà soát 02:00). Khoản nợ tồn tại và đang bật ([UC-901](UC-901-them-va-xem-khoan-no.md)).

## Main Flow
1. Log tiền ra về, nằm `pending` ở màn Gán. Máy **không** tự gắn khoản nợ: rule tự gán không có `debt_id` (UC-307), nên trả nợ luôn là một lần gán tay.
2. Ở sheet gán (pwa [UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md) bước 5a), dòng **Chi tiêu** có ô **Trả nợ cho** (khoản còn nợ từ `bootstrap.debts`, mỗi khoản "{tên} · còn X", mặc định "không phải trả nợ"); chọn một khoản thì danh mục thành Trả nợ, ví theo danh mục (ví giữ riêng). Có thể tách log thành nhiều dòng, chỉ một phần là trả nợ.
3. `POST /v1/logs/:id/assign`: route đọc `debt_id` của từng split (`parseSplit`); `assignLog` → `splitToEntryInput` → `buildEntry` với cùng luật như UC-902 bước 4 (`debt_spend_only`, `unknown_debt`, `inactive_debt`, thiếu danh mục → `debt-payment`). Mọi kiểm tra chạy **trước** khi ghi; một batch chèn mọi dòng + `markAssigned`.
4. Dòng `spend` mang `debt_id`, `log_id`, `source = 'sepay'` → còn nợ giảm đúng số tiền dòng đó; khoản trả hiện trong `payments` của khoản nợ với `source: 'sepay'`.

## Alternative Flows
- 2a. **MCP** `assign_log { log_id, splits: [{ meaning: "spend", amount, debt_id, … }] }` — cùng `assignLog`.
- 3a. Tài khoản "chỉ tiền vào" (`sepay_out = 0`, ADR-66): khoản trả có thể đã nhập tay (UC-902); log `out` về sau mang lời nhắc "có thể đã nhập tay" — người Bỏ qua log thay vì gán lần hai.
- 5. **Gỡ gán** (ingest UC-306) → giao dịch `void`, log về `pending`, còn nợ tự trở lại.

## Exceptions
- E1. `debt_id` trên split không phải `spend` → 400 `debt_spend_only`, log vẫn `pending`, không ghi gì.
- E2. `debt_id` không có / khoản đã tắt → 400 `unknown_debt` / `inactive_debt`, không ghi gì.
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

## Traceability
- Code: `src/routes/logs.ts` › `parseSplit` (`debt_id`); `src/services/ingest.ts` › `Split.debt_id`, `assignLog`, `splitToEntryInput`; `src/domain/entry.ts` › `buildEntry`; `src/mcp/tools.ts` › `assign_log`
- PWA: màn Gán ([UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md))
- Migrations/DB: `transactions.debt_id`, view `v_debt_balance` (`migrations/0013_debts.sql`); `trg_tx_needs_pending_log` (migration 0005)

## Divergences & Open Questions
- [OPEN] `create_rule` vẫn chỉ lưu ví/danh mục (bảng `rules` không có `debt_id`): rule rút từ một lần gán trả nợ không mang khoản nợ, nên log cùng nội dung lần sau tự gán thành chi `debt-payment` **không** giảm còn nợ — người phải tránh tạo rule cho khoản trả nợ.
