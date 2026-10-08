# Bounded context: ingest (bank feed SePay)

Nhận mọi biến động của các tài khoản ngân hàng đã nối SePay — qua một hay nhiều tài khoản SePay của nhà (kết nối SePay, ADR-75) — (webhook thời gian thực + rà soát 02:00 và đồng bộ lại theo khoảng ngày qua API lịch sử),
lưu nguyên văn vào lớp thô `bank_logs`, rồi đưa mỗi giao dịch vào sổ `transactions` **nhiều nhất một lần**: tự khớp khi
chắc chắn (lệnh chuyển `PF`, ghép cặp nội bộ, rule chi/chuyển, mẫu lương đủ ngưỡng), còn lại để người trong nhà gán.
Không bao giờ bỏ lặng lẽ một giao dịch: payload hỏng, lỗi sau khi ghi, log có thể trùng đều được ghi lại và báo.

## Ngôn ngữ chung (ubiquitous language)

| Thuật ngữ | Nghĩa trong ingest | Ghi chú khác context |
|---|---|---|
| Log (log ngân hàng, `bank_logs`) | Một biến động ngân hàng thô SePay báo về; bất biến về nội dung, chỉ đổi `status` | Ledger gọi phần diễn giải là "giao dịch" (`transactions`) — log ≠ giao dịch |
| Chưa gán (`pending`) | Log chưa sinh giao dịch nào và chưa bị bỏ qua | Ở ledger/PWA "chưa gán" là con số `pending_net`/`pending_count` của `v_reconcile`; `transfer_orders.status='pending'` là "lệnh chưa chuyển", nghĩa khác |
| Gán (`assigned`) | Log đã sinh ≥1 giao dịch `active` (tự động hoặc tay) | |
| Bỏ qua (`ignored`) | Log được xác nhận không cần ghi sổ (giao dịch thử, bản trùng), hoặc log trước ngày mở sổ của tài khoản — đã nằm trong số dư đầu, ingest ghi thẳng `ignored` (ADR-76) | |
| Trước ngày mở sổ (`beforeOpening`) | Log có ngày giờ VN trước `accounts.opened_at` của tài khoản nó | Ledger gọi cùng mốc này là `before_opening` (bút toán bị từ chối) |
| Nguồn (`source`) | `webhook` hay `backfill` (rà soát 02:00) của log | `transactions.source` là trục khác (`sepay`/`manual`/`import`/`system`) |
| Mã tham chiếu (`reference_number`) | Mã FT ngân hàng; khoá chống trùng giữa hai nguồn trong một tài khoản | Khác `ref_code` |
| Mã CK (`ref_code`) | Mã 3 chữ cái `[QE]xx` do người nhà gõ trong nội dung (hoặc `payload.code`) để rule nhận diện | Settings gọi rule là "mã chuyển khoản" |
| Memo lệnh (`PF XXXXXX`) | Nội dung chuyển tiền do app sinh cho từng lệnh chuyển (`transfer_orders.memo`) | Lệnh do allocation sinh; ingest chỉ khớp |
| Ghép cặp (pairing) | Hai log ngược hướng của hai TK trong hộ gộp thành **một** `transfer` (`log_id` + `log_id_2`). Chân về sau khi chân kia đã thành chuyển nội bộ (gán tay, rule) được **gắn** vào giao dịch đó làm `log_id_2` (ADR-81) | |
| Có thể trùng (possible twin) | Log khác nguồn, cùng TK/số tiền/chiều, lệch ≤ 3 phút, một bên thiếu mã tham chiếu | Chỉ là cờ gợi ý, không phải dedupe |
| Rule | Quy tắc tự gán theo `code`/`content`/`account`; chỉ `spend`/`transfer`, hoặc `income` khi `is_salary`. Có thể gắn một tài khoản (`account_id` — chỉ áp cho log của tài khoản đó) | Settings sửa rule qua màn "Mã chuyển khoản" |
| Rule chuyển nội bộ có đầu kia | Rule `transfer` có `counter_account_id` (+ `from_wallet_id`): log `out` tự gán chuyển sang đúng tài khoản đó kèm chuyển ví thay vì "Rút tiền mặt"; log `in` cùng mẫu chỉ gợi ý chiều ngược lại, **không** chuyển ví. Dùng cho heo đất MB (ADR-77, ADR-82) | ledger: bỏ heo = chuyển nội bộ MB → heo, Có thì tốt → Tích sản; rút heo về = chỉ chuyển tài khoản heo → MB, tiền vẫn thuộc Tích sản |
| Mẫu lương | Rule `income` có `is_salary=1`; chỉ tự ghi khi số tiền ≥ `salary_min_amount` | |

## Use cases

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-301](UC-301-nhan-webhook-sepay.md) | Nhận webhook SePay | implemented | BR-03, BR-04, BR-09 |
| [UC-302](UC-302-ghi-log-chong-trung.md) | Ghi log ngân hàng chống trùng | implemented | BR-04, BR-03 |
| [UC-303](UC-303-tu-khop-log-vao-so.md) | Tự khớp log vào sổ | implemented | BR-04, BR-02, BR-03 |
| [UC-304](UC-304-ra-soat-0200-backfill.md) | Rà soát 02:00 & đồng bộ lại theo khoảng ngày qua API SePay | implemented | BR-03, BR-04 |
| [UC-305](UC-305-gan-log-chua-gan.md) | Gán log chưa gán | implemented | BR-03, BR-04, BR-02 |
| [UC-306](UC-306-ghep-cap-tay-va-go-gan.md) | Ghép cặp tay & gỡ gán | implemented | BR-04 |
| [UC-307](UC-307-quan-ly-rule-tu-gan.md) | Quản lý rule tự gán | implemented | BR-08, BR-02, BR-04 |
| [UC-308](UC-308-doi-soat-feed-va-su-co-ingest.md) | Ghi sự cố ingest | implemented | BR-04, BR-06 |

Entity: [entities.md](entities.md) — `BankLog`, `Rule`.

## Code sở hữu
- `src/services/ingest.ts` (trừ phần chỉ đọc lại từ ledger/allocation: `allocateIncome`, `undoAllocationStatements`, `runUndo`, `salaryMinAmount`)
- `src/domain/rules.ts`
- `src/routes/webhooks.ts`, `src/routes/logs.ts`
- `src/cron/backfill.ts`
- `migrations/0004_sepay_rules.sql`, `migrations/0005_ingest_integrity_guards.sql`, `migrations/0016_opening_date_cutoff.sql` (`v_account_logs` theo ngày mở sổ), `migrations/0017_heo_dat.sql` (`rules.account_id`, `rules.counter_account_id`, `rules.from_wallet_id`, rule heo đất), `migrations/0019_heo_settlement_rule.sql` (mẫu `TICH LUY`), `migrations/0020_heo_tich_san.sql` (rule heo chuyển ví vào Tích sản thay ví `heo-dat`, ADR-82); bảng `bank_logs`, `rules` trong `migrations/0001_schema.sql`
- Test: `test/ingest.test.ts`, `test/ingest-integrity.test.ts`, `test/webhooks.test.ts`, `test/logs.test.ts`, `test/rules.test.ts`, `test/cron-sepay.test.ts` (phần backfill), `test/piggy-bank.test.ts` (rule heo đất: bỏ heo, rút heo về), `test/schema.test.ts` › "chốt chặn toàn vẹn ở tầng DB"

## Phụ thuộc sang context khác (theo tên)
- ledger: entity Transaction, Account, `v_reconcile`; UC-101 Nhập tay một khoản tiền (`buildEntry`, D14 `fed_account`), UC-102 Huỷ / sửa giao dịch ghi tay (từ chối giao dịch ngân hàng — `bank_tx`), UC-105 Đếm số dư → điều chỉnh (`pending_logs`), UC-106 Đối soát tài khoản hai lớp (`book_drift`).
- allocation: entity TransferOrder (ingest khớp memo `PF`, đổi `done`/`pending`); "Chia thu nhập" (`allocateIncome`, `allocation_runs`), "Gỡ lần chia" (`undoAllocationStatements`, migration 0006).
- notify: UC-407 Báo giao dịch chưa gán (mỗi 15 phút, có giờ yên lặng); UC-402 Tin sáng (giờ nhắc, mặc định 07:00) (đọc `notifications` kind `backfill`/`ingest_error`); UC-401 Lịch cron (lượt 02:00 chạy rà soát UC-304).
- access: SepayConnection (token API + khoá webhook của từng tài khoản SePay, `accounts.sepay_connection_id` — ADR-75), UC-508 (quản lý kết nối), UC-506 (tài khoản chọn kết nối); config `salary_min_amount`; UC-507 (sửa rule từ Cài đặt).
- mcp: UC-604 Gán log qua MCP (gọi `listPendingLogs`/`assignLog`).
- pwa: màn Gán (`web/src/screens/assign.tsx`) gọi `/v1/logs…`.
