# UC-306: Ghép cặp tay & gỡ gán
- Status: implemented
- BR: BR-04
- Decisions: `phase-04-ingest-sepay.md` §"Rủi ro ghép cặp sai" (gỡ cặp = `void` rồi hai log về `pending`); `migrations/0001_schema.sql` nguyên tắc 2 "Sổ CHỈ GHI THÊM — không xoá; huỷ = status='void'"; commit `c3ab508` (gỡ mọi dòng tách + mở lại lệnh chuyển), `099e54f` (gỡ luôn lần chia), `eb7846e` (migration 0006 chặn gỡ khi tiền đã chuyển); [ADR-73](../decisions.md) (gỡ gán là đường duy nhất để sửa một giao dịch ngân hàng)
- Actor: thành viên trong hộ (PWA: màn Gán; nút **Gán lại** ở sheet chi tiết giao dịch — pwa [UC-715](../pwa/UC-715-xem-sua-xoa-giao-dich.md))
- Trigger: `POST /v1/logs/pair` body `{log_a, log_b}`; `POST /v1/logs/transactions/:txId/void`

## History
- v1 (2026-09-22, commit `c1a25c1`): ghép tay hai log thành một `transfer`; route gỡ gán thêm ngoài danh sách phase-04 vì `voidTransaction` của ledger không đụng `bank_logs` (`fullstack-developer-260922-0020-sepay-ingest.md` §4).
- v2 (2026-09-22, commit `c3ab508`): ghép tay nguyên tử (trigger chặn khi một chân vừa được gán); gỡ gán huỷ **mọi** dòng `active` của (các) log — trước đó chỉ huỷ một dòng rồi mở lại log, gán lại là đếm hai lần — và trả lệnh chuyển đã khớp về `pending`, tất cả trong một batch.
- v3 (2026-09-22, commit `099e54f`): gỡ một log lương đã chia thì gỡ luôn lần chia; bị từ chối nếu tiền đã chuyển thật theo lần chia đó.
- v4 (2026-09-22, commit `eb7846e`): race "bấm Đã chuyển đúng lúc gỡ" được migration 0006 chặn (`allocation_settled`).
- v5 (2026-10-01, commit `49f8bce`): route huỷ của sổ cái (ledger [UC-102](../ledger/UC-102-huy-giao-dich.md)) nay **từ chối** giao dịch ngân hàng (`bank_tx`), nên gỡ gán là đường duy nhất — hết cảnh log `assigned` mồ côi. PWA gọi gỡ gán từ nút **Gán lại** ở sheet chi tiết giao dịch rồi mở màn Gán đúng log đó (ADR-73).
- v6 (2026-10-03, commit `f74bc70`): ghép tay chịu luật **số dư đầu là mốc** (ADR-76): ngày VN của log sớm hơn trong hai log trước `opened_at` của một trong hai tài khoản → 400 `before_opening`, không ghi gì.
- v7 (2026-10-03, commit `c67420e`): không đổi code gỡ gán — chân thứ hai **gắn sau** vào chuyển nội bộ đã ghi (ADR-81, ingest UC-303 bước 2b, UC-305 bước 5b) nằm ở `log_id_2` nên gỡ gán giao dịch đó trả **cả hai** log về `pending` như một cặp ghép; thêm AC-10 và test. Sửa prod 3/10: gỡ gán giao dịch ghi lần hai (chỉ chân vào) → log chân vào về `pending`, màn Gán gợi ý khớp vào giao dịch còn lại (UC-305 AC-23).
- v8 (2026-10-03, commit `2608b66`): không đổi code — theo ingest UC-305 v15, log chân đầu mồ côi của lệnh `PF` (nội dung `PF …`, không phải rút tiền) không còn bị gợi ý "Rút tiền mặt"; cập nhật [OPEN] gỡ gán một chân.
- v9 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90, red-team INSIDER-04) — gỡ gán thành công ghi nhật ký `tx.unassign` (`target = tx:<id>`, `detail = { voided, logs }`, người gọi + `via`); lỗi không ghi. Thêm AC-11.

## Preconditions
- Ghép tay: cả hai log `pending`. Gỡ gán: giao dịch `active`, sinh từ log (`log_id` khác NULL).

## Main Flow
**Ghép tay (`pairLogs`)**
1. Hai id khác nhau; cả hai tồn tại; cả hai `pending`; cả hai có `account_id`; khác TK; ngược hướng; cùng số tiền. (Không giới hạn khoảng cách thời gian.) Ngày VN của log sớm hơn không trước `opened_at` của TK nào trong hai (`assertOpened`, ADR-76).
2. Một batch: một `transfer` (`account_id` = TK chân ra, `counter_account_id` = TK chân vào, `at` = của chân ra, `log_id` = chân ra, `log_id_2` = chân vào, note "Ghép cặp tay", `source='sepay'`) + `markAssigned` cả hai.
3. Trả 201 `{transactionId}`.

**Gỡ gán (`unassignTransaction`)**
4. Lấy giao dịch; tập log = `{log_id, log_id_2}` (bỏ rỗng).
5. Tìm mọi giao dịch `active` có `log_id` hoặc `log_id_2` thuộc tập log (một log có thể đã tách nhiều dòng).
6. Với các dòng `income` trong đó: lấy lệnh gỡ lần chia (`undoAllocationStatements`, allocation "Gỡ lần chia").
7. Một batch (`runUndo`): gỡ lần chia → `void` mọi dòng ở bước 5 → `transfer_orders` có `matched_log_id` thuộc tập log về `pending`, `matched_log_id = NULL` → log `assigned` thuộc tập log về `pending`.
8. Trả 200 `{voided: [txId…], logs: [logId…]}`. Log quay lại danh sách chờ gán (UC-305) và có thể được gán lại.

## Alternative Flows
- 7a. Tiền của lần chia đã được đánh dấu chuyển thật (lệnh `done`), kể cả do request khác vừa làm → cả batch bị huỷ, 409 `allocation_settled`; sổ giữ nguyên.

## Exceptions
- E1. `log_a`/`log_b` thiếu → 400 `invalid_input`; trùng nhau → 400 `same_log`; không tồn tại → 400 `not_found`.
- E2. Một log không `pending` → 409 `not_pending` ("Cả hai log phải đang chờ gán."); batch bị trigger huỷ → 409 `not_pending` ("Một trong hai log vừa được xử lý ở nơi khác.").
- E3. Thiếu TK → 400 `unknown_account`; cùng TK → 400 `same_account`; cùng hướng → 400 `same_direction`; khác tiền → 400 `amount_mismatch`.
- E4. `txId` không phải số nguyên dương → 400 `invalid_input`; không có → 400 `not_found`; không sinh từ log → 400 `not_from_log`; đã `void` → 409 `already_void`.

## Acceptance Criteria
### AC-1: Ghép tay hai log ngược hướng cùng tiền thành một transfer
- Given `pa` `out` 900.000 `vcb-husband`, `pb` `in` 900.000 `tcb-husband`
- Then 201; giao dịch `transfer` `vcb-husband` → `tcb-husband`
- Tests: `test/logs.test.ts` › "POST /v1/logs/pair — ghép tay khi thuật toán bỏ sót › ghép đúng 2 log ngược hướng cùng tiền thành 1 transfer"

### AC-2: Khác số tiền → từ chối
- Tests: `test/logs.test.ts` › "POST /v1/logs/pair — ghép tay khi thuật toán bỏ sót › khác số tiền thì từ chối"

### AC-3: Ghép tay khi một chân vừa được gán nơi khác → 409, không sinh giao dịch
- Tests: `test/ingest-integrity.test.ts` › "gán hai lần cùng lúc › ghép cặp tay khi một chân vừa được gán ở nơi khác → 409, không sinh giao dịch"

### AC-4: Gỡ cặp → giao dịch void, hai log về chờ
- Tests: `test/logs.test.ts` › "POST /v1/logs/transactions/:txId/void — gỡ cặp/gỡ gán › huỷ giao dịch sinh từ log rồi trả các log về pending"; `test/ingest.test.ts` › "ingestLog: ghép cặp chuyển khoản nội bộ (4 tình huống) › trùng số tiền ngẫu nhiên giữa hai người không liên quan → vẫn bị ghép nhầm (rủi ro đã biết), gỡ được bằng huỷ"

### AC-5: Gỡ log đã tách nhiều dòng → huỷ hết rồi mới mở lại; gán lại không đếm hai lần
- Given log 500.000 gán thành 300.000 `groceries` + 200.000 `health`
- When gỡ từ dòng đầu → `voided` có 2 id, 0 dòng `active`, ví `food` và `nice-to-have` = 0; gán lại 500.000 `groceries` → `food` = −500.000, `nice-to-have` = 0
- Tests: `test/ingest-integrity.test.ts` › "gỡ gán một log đã tách nhiều dòng › huỷ mọi dòng của log rồi mới trả log về chờ; gán lại không đếm hai lần"

### AC-6: Gỡ giao dịch khớp lệnh chuyển → lệnh quay lại chờ
- Tests: `test/ingest-integrity.test.ts` › "gỡ gán một log đã tách nhiều dòng › gỡ giao dịch khớp lệnh chuyển tiền thì lệnh đó quay lại chờ"

### AC-7: Gỡ log lương đã chia → gỡ luôn lần chia
- Given lương 5.000.000 lọt qua (đủ ngưỡng), đã chia
- When gỡ giao dịch `income`
- Then 0 giao dịch `active`, log `pending`, mọi ví số dư 0
- Tests: `test/ingest-integrity.test.ts` › "lương giả › lương giả lọt qua (đủ ngưỡng) vẫn gỡ được: gỡ gán log thì gỡ luôn lần chia"

### AC-8: Không gỡ được khi tiền của lần chia đã chuyển thật
- Tests: `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › người kia bấm 'Đã chuyển' đúng lúc đang gỡ lần chia → huỷ bị từ chối, sổ giữ nguyên"
- ⚠ Test này gọi trực tiếp `undoAllocationStatements`/`runUndo` của ledger trên một income nhập tay, không đi qua `unassignTransaction`.

### AC-9: Gỡ gán là đường duy nhất cho giao dịch ngân hàng
- Given log `out` 80.000 đã gán thành khoản chi
- When huỷ bằng route sổ cái `POST /v1/transactions/:id/void`, rồi bằng gỡ gán
- Then route sổ cái trả `bank_tx`, log vẫn `assigned`; gỡ gán được và log về `pending`
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › giao dịch từ ngân hàng không xoá được ở sổ cái (bank_tx), log vẫn đã gán; gỡ gán thì được"

### AC-10: Gỡ giao dịch có chân thứ hai gắn sau → huỷ giao dịch, cả hai log về chờ (ADR-81)
- Given chân ra 250.000 ở `vcb-husband` gán tay thành `transfer` sang `vcb-wife`; chân vào ở `vcb-wife` về sau, được gắn làm `log_id_2` của giao dịch đó
- When gỡ gán giao dịch đó
- Then `{voided: [id], logs: [chân ra, chân vào]}`; 0 giao dịch `active`; cả hai log `pending`
- Tests: [`test/ingest.test.ts`](../../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › gỡ gán giao dịch đã gắn chân thứ hai → huỷ giao dịch, cả hai log về chờ"

### AC-11: Gỡ gán ghi nhật ký (ADR-90)
- Given hai log `va` (ra, `vcb-husband`) và `vb` (vào, `tcb-husband`) 300.000 đã ghép tay thành giao dịch P
- When "husband" gỡ gán P (API token)
- Then `audit_log` có `{ member_id: "husband", via: "token", action: "tx.unassign", target: "tx:<P>", detail: {"voided":[P],"logs":["va","vb"]} }`
- Tests: `test/audit.test.ts` › "nhật ký thay đổi › huỷ, sửa, gỡ gán giao dịch đều ghi một dòng: ai, qua đâu, giao dịch nào"

## Traceability
- Code: `src/routes/logs.ts` › `logs.post("/logs/pair")`, `logs.post("/logs/transactions/:txId/void")`; `src/services/audit.ts` › `recordChange`; `src/services/ingest.ts` › `pairLogs`, `unassignTransaction`, `commit`, `logTxStmt`, `markAssigned`; `src/services/ledger.ts` › `getTransaction`, `undoAllocationStatements`, `runUndo`, `manualTxOrThrow` (chặn `bank_tx` ở sổ cái)
- Migrations/DB: `trg_tx_needs_pending_log` (0005); `migrations/0006_allocation_undo_guard.sql` (`allocation_settled`)
- PWA: `web/src/screens/tx-sheet.tsx` (Gán lại), `web/src/screens/assign.tsx` › `Assign` (điện thoại: mở thẳng sheet gán của log được chọn sẵn).

## Divergences & Open Questions
- [OPEN] Ghép tay không giới hạn khoảng cách thời gian và không kiểm memo `PF`; `at` của transfer lấy theo chân ra.
- [OPEN] Gỡ gán một giao dịch PF chỉ một chân: lệnh về `pending`, log về `pending`; nếu chân kia về sau, UC-303 bước 1.1 ghép lại cả hai (AC-5 của UC-303). Nếu chân kia **không** bao giờ về, log chân đầu nằm chờ không gợi ý gì (nội dung `PF …` không phải rút tiền — UC-305 v15; trước đó bị gợi ý "Rút tiền mặt") — người gán phải tự nhận ra đây là chuyển nội bộ.
