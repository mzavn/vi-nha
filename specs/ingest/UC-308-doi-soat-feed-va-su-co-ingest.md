# UC-308: Ghi sự cố ingest
- Status: implemented
- BR: BR-04, BR-06
- Decisions: `docs/core_design_rules.md` §7; ADR-87 (bỏ hẳn số lũy kế SePay — phần "lệch feed lớp 1" của UC này bỏ); commit `a954744` (không bỏ lặng lẽ giao dịch hỏng), `eb7846e` (lỗi sau khi ghi → ghi lại)
- Actor: hệ thống (trong UC-301/302/304); người đọc là tin sáng (notify UC-402)
- Trigger: `recordIngestError` khi payload/dòng API hỏng hoặc bước khớp lỗi

## History
- v1 (2026-09-22, commit `c1a25c1`): `checkReconcileDrift` sau mỗi log → `notifications(kind='reconcile_drift')`.
- v2 (2026-09-22, commit `a954744`): `recordIngestError` cho payload webhook/dòng API không đọc được; tin 07:00 báo số giao dịch không đọc được.
- v3 (2026-09-22, commit `eb7846e`): lỗi xử lý sau khi log đã ghi (ví dụ lương đã ghi nhưng chia lỗi) cũng ghi `ingest_error`.
- v4 (2026-10-03, commit `f74bc70`): **số dư đầu là mốc** (ADR-76, migration 0016) — `v_account_logs` chỉ cộng log có ngày VN từ `opened_at` trở đi (log trước đó đã nằm trong `opening_balance`; ingest ghi chúng `ignored` và không kiểm lệch cho chúng — UC-302 2b). Trước đây `feed_balance` cộng mọi log của TK nên giao dịch tháng 9 đồng bộ lại vào TK mở sổ 1/10 bị đếm hai lần.
- v5 (2026-10-06, commit `9c265ee`): **bỏ đối soát feed lớp 1** (ADR-87, change [`261006-bo-luy-ke-sepay`](../changes/archive/261006-bo-luy-ke-sepay/proposal.md)) — chủ nhà: "bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè". `accumulated` không được đọc / lưu (cột bỏ ở migration 0023); `checkReconcileDrift` và `notifications(kind='reconcile_drift')` bỏ; `v_account_bank` bỏ, `v_reconcile` không còn `bank_balance` / `feed_drift`. Đổi tên UC từ "Đối soát feed lớp 1 & ghi sự cố ingest". Sổ theo log (`v_account_logs`) và lệch sổ (`book_drift`) vẫn ở ledger UC-106.

## Preconditions
- Không có.

## Main Flow
1. Số lũy kế SePay gửi kèm (`accumulated`) không được đọc, không lưu, không so — chỉ còn trong `bank_logs.raw` (ADR-87). Không có cờ lệch nào được ghi khi nhận log; đối soát là việc của ledger UC-106.
2. `recordIngestError(db, source, ref, message)` → `INSERT OR IGNORE notifications (kind='ingest_error', day_key='<ngày VN>:<source>:<ref ≤64 ký tự>', chat_id='system', payload={source, message ≤200 ký tự}, ok=1)`. Không ghi số tài khoản hay nội dung chuyển khoản.
3. Tin 07:00 đếm `ingest_error` trong 24 giờ qua thành "giao dịch ngân hàng cần xem tay" (notify UC-402).

## Alternative Flows
- 2a. Cùng `source` + `ref` lỗi nhiều lần trong một ngày VN → một dòng.

## Exceptions
- E1. Lỗi khi ghi `ingest_error` từ webhook bị nuốt (`.catch(() => {})`); webhook vẫn trả 200.

## Acceptance Criteria
### AC-1: Ngân hàng báo số dư khác tổng log → ghi cờ lệch (deprecated v5: ADR-87 — không còn so với số SePay báo)

### AC-2: `accumulated = 0` không tính là lệch (deprecated v5: ADR-87 — `accumulated` không còn được đọc)

### AC-3: Log chưa gán không bật báo lệch giả (deprecated v5: chuyển về ledger UC-106 AC-1)

### AC-4: Payload hỏng được ghi lại, không lộ số tài khoản
- Tests: `test/webhooks.test.ts` › "payload hỏng và lỗi tạm thời › ngày không có thật (30/02) bị từ chối thay vì ghi sang tháng 3; được ghi lại để tin sáng báo"

### AC-5: Lỗi sau khi ghi log được ghi lại
- Tests: `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › lương đã ghi nhưng bước chia lỗi → không im lặng: ghi lại để tin sáng báo, webhook không bị gửi lại vô ích"

### AC-6: Số lũy kế lệch không bật cờ gì, bản thô giữ nguyên
- Given `vcb-husband`, webhook log `in` 500.000 có `accumulated` 999.999.999 trong payload
- When ingest ghi log
- Then log `pending` ở `vcb-husband`, dòng `bank_logs` không có cột `accumulated`, `raw` đúng payload gốc; không có dòng `notifications` `reconcile_drift`
- Tests: `test/ingest.test.ts` › "số lũy kế SePay gửi kèm không được lưu hay so (ADR-87) › webhook mang accumulated lệch hẳn sổ → log ghi bình thường, không cờ reconcile_drift, raw giữ nguyên payload"

## Traceability
- Code: `src/services/ingest.ts` › `recordIngestError`, `ParsedBankLog` (không có `accumulated`); `src/domain/period.ts` › `dayKey`; `src/cron/daily.ts` (đọc `ingest_error`, `backfill`)
- Migrations/DB: `bank_logs.accumulated` và `v_account_bank` bỏ ở `migrations/0023_drop_bank_accumulated.sql`; `notifications` UNIQUE `(kind, day_key, chat_id)`

## Divergences & Open Questions
- Đã đóng 2026-10-06 (v5, ADR-87): [DIVERGENCE] cũ "ingest chỉ **ghi** `reconcile_drift`, không nơi nào đọc" và "`checkReconcileDrift` chỉ xét lớp 1"; [OPEN] cũ "`v_account_bank` chọn log mới nhất thiếu `accumulated`" và "`accumulated` không đáng tin" — không còn ghi `reconcile_drift`, không còn đọc `accumulated`.
