# UC-206: Gỡ lần chia khi huỷ khoản thu
- Status: implemented
- BR: BR-04, BR-09
- Decisions: luật 1 "Sổ chỉ ghi thêm … huỷ = `status='void'`" (`docs/core_design_rules.md` §1); commits `099e54f` (gỡ lần chia khi huỷ/gỡ gán thu nhập), `eb7846e` (migration 0006 chặn đua); `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md` #2
- Actor: thành viên hộ — huỷ hoặc sửa một khoản thu ghi nhầm (PWA/REST), hoặc gỡ gán log đã thành thu nhập (kể cả "lương giả" lọt ngưỡng)
- Trigger: `POST /v1/transactions/:id/void` hoặc `POST /v1/transactions/:id/replace` với giao dịch `meaning='income'` (`voidTransaction`, `replaceTransaction`, ledger [UC-102](../ledger/UC-102-huy-giao-dich.md)); gỡ gán log ở màn Gán (`unassignTransaction`, ingest) khi trong các giao dịch của log có income

## History
- v1 (2026-09-22, commit `099e54f`): huỷ income đã chia thì huỷ mọi fund của đợt và bỏ (`skipped`) các lệnh chuyển còn `pending`; từ chối khi đợt đã có lệnh `done`. Lý do: "lương" giả do người ngoài chuyển tiền với nội dung khớp mẫu từng được ghi và chia mà không có đường lùi.
- v2 (2026-09-22, commit `eb7846e`): migration 0006 thêm trigger `trg_fund_void_needs_unsettled_batch` + `runUndo` đổi lỗi trigger thành 409. Lý do (reviewer #2): kiểm "đã chuyển thật chưa" là đọc-rồi-ghi; nếu người kia bấm "Đã chuyển" đúng lúc đó, lệnh ở lại `done` mà mọi fund bị huỷ — tiền đã đi thật nhưng biến mất khỏi sổ.
- v3 (2026-10-01, commit `49f8bce`): sửa một khoản thu (`replaceTransaction`, ADR-73) gỡ lần chia cũ theo cùng đường — các câu gỡ đi trong cùng batch với ghi khoản thu mới và huỷ khoản cũ; khoản thu mới chưa chia. Huỷ / sửa giao dịch ngân hàng ở sổ cái bị từ chối `bank_tx`, nên khoản thu từ log chỉ gỡ được bằng gỡ gán.

## Preconditions
- Khoản thu tồn tại, đang `active`.
- (Để gỡ được) không lệnh chuyển tiền nào của đợt `A<id>` ở trạng thái `done`.

## Main Flow
1. Caller xác định khoản thu cần huỷ:
   - `voidTransaction(id)` / `replaceTransaction(id, …)`: giao dịch phải tồn tại, `active`, không phải `source='system'` hay `meaning='fund'`, không phải giao dịch ngân hàng; nếu `meaning='income'` thì sang bước 2 (sửa: sau khi khoản mới đã qua kiểm tra).
   - `unassignTransaction(txId)`: mọi giao dịch `active` sinh từ (các) log của giao dịch đó; với mỗi giao dịch `income` trong số đó sang bước 2.
2. `undoAllocationStatements(incomeTxId)`:
   1. Tìm `allocation_runs` của khoản thu; không có (chưa chia) → không có lệnh gỡ nào.
   2. Đếm `transfer_orders` của `batch_id` có `status='done'`; > 0 → E3.
   3. Trả hai câu lệnh: `UPDATE transactions SET status='void' WHERE status='active' AND meaning='fund' AND batch_id=?` và `UPDATE transfer_orders SET status='skipped' WHERE status='pending' AND batch_id=?`.
   4. **Giữ nguyên** dòng `allocation_runs`.
3. `runUndo` chạy trong **một** `db.batch`: các câu gỡ + huỷ chính khoản thu (với sửa: + ghi khoản thu mới; với ingest: huỷ các giao dịch anh em, trả lệnh đã khớp log về `pending`, trả log về `pending`).
4. Trigger 0006 kiểm lại **trong** transaction: fund `active → void` của đợt có lệnh `done` → ABORT `allocation_settled` → cả batch huỷ → E4.
5. Kết quả: mọi ví về như trước lần chia (ví Thu nhập cũng về vì khoản thu đã `void`); lệnh chưa làm thành `skipped`.

## Alternative Flows
- 2a. Khoản thu chưa từng chia → chỉ huỷ khoản thu.
- 5a. Chia lại: khoản thu đã `void` → `/v1/allocate` trả 404 `not_income` (kiểm trước); dòng `allocation_runs` được giữ lại là lớp chặn thứ hai (theo chú thích code: "một khoản thu đã huỷ không bao giờ được chia lại"). Gỡ gán log rồi gán lại thành thu nhập sinh một income **mới** (id mới) → chia được như một khoản mới (UC-203).

## Exceptions
- E1. Không có giao dịch → `not_found` "Không có giao dịch này." (404 ở `voidTransaction`; 400 ở `unassignTransaction` vì `fail` của ingest dùng status mặc định); đã huỷ → 409 `already_void` "Giao dịch đã huỷ trước đó.".
- E2. Huỷ lẻ một fund hoặc bút toán hệ thống → 409 `system_tx` "Bút toán do hệ thống sinh ra không huỷ lẻ được.".
- E3. Đợt đã có lệnh `done` (thấy ở bước đọc) → 409 `allocation_settled` "Tiền của lần chia này đã được chuyển thật; gỡ lệnh chuyển tiền trước rồi mới huỷ được.".
- E4. Lệnh vừa thành `done` giữa bước đọc và bước ghi (trigger) → 409 `allocation_settled` "Tiền của lần chia này vừa được đánh dấu đã chuyển; gỡ lệnh chuyển tiền trước rồi mới huỷ được."; sổ không đổi.

## Acceptance Criteria
### AC-1: Huỷ khoản thu đã chia gỡ trọn lần chia và không chia lại được
- Given khoản thu 10.000.000 đã chia, lệnh chuyển còn `pending`
- When `POST /v1/transactions/:id/void`
- Then khoản thu `void`; mọi ví có số dư 0; mọi `transfer_orders` là `skipped`; `/v1/allocate` cho id đó trả ≥ 400
- Tests: `test/api.test.ts` › "chia lương end-to-end › huỷ khoản thu đã chia thì gỡ luôn lần chia: ví về như cũ, lệnh chuyển chưa làm bị bỏ, không chia lại được"

### AC-2: Tiền của đợt đã chuyển thật thì không huỷ được
- Given khoản thu đã chia và một lệnh của đợt đã `done`
- When huỷ khoản thu
- Then lỗi `allocation_settled`; khoản thu vẫn `active`
- Tests: `test/api.test.ts` › "chia lương end-to-end › tiền của lần chia đã chuyển thật thì không huỷ khoản thu được"

### AC-3: Đua "Đã chuyển" với "Huỷ" — DB từ chối, sổ giữ nguyên
- Given khoản thu 10.000.000 về `vcb-wife` đã chia; bước đọc của lần gỡ đã chạy (chưa có lệnh `done`)
- When request khác đánh dấu một lệnh `done` rồi lần gỡ mới ghi
- Then `runUndo` ném `allocation_settled`; tổng fund active vẫn 10.000.000; huỷ lại lần nữa cũng `allocation_settled`
- Tests: `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › người kia bấm 'Đã chuyển' đúng lúc đang gỡ lần chia → huỷ bị từ chối, sổ giữ nguyên"

### AC-4: Gỡ gán log lương (kể cả lương giả lọt ngưỡng) gỡ luôn lần chia
- Given log lương 5.000.000 đã tự ghi income và tự chia
- When gỡ gán giao dịch income
- Then không còn giao dịch `active`; log về `pending`; mọi ví số dư 0
- Tests: `test/ingest-integrity.test.ts` › "lương giả › lương giả lọt qua (đủ ngưỡng) vẫn gỡ được: gỡ gán log thì gỡ luôn lần chia"

### AC-5: Không huỷ lẻ được bút toán nạp ví
- Given một fund của lần chia
- When `POST /v1/transactions/<fund id>/void`
- Then 409 `system_tx`; fund vẫn `active`
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › không sửa / xoá lẻ bút toán hệ thống (fund của lần chia) → system_tx"

### AC-6: Sửa khoản thu đã chia gỡ lần chia cũ trong cùng một lần
- Given khoản thu 10.000.000 đã chia, lệnh chuyển còn `pending`
- When `POST /v1/transactions/:id/replace` thành 12.000.000
- Then không còn fund active của đợt cũ; lệnh chuyển `skipped`; khoản thu mới chưa chia và chia được
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa khoản thu đã chia: gỡ lần chia cũ, khoản thu mới chưa chia và chia lại được"

## Traceability
- Code: `src/services/ledger.ts` › `voidTransaction`, `replaceTransaction`, `undoAllocationStatements`, `runUndo`; `src/services/ingest.ts` › `unassignTransaction`; `src/routes/v1.ts` › `v1.post("/transactions/:id/void")`, `v1.post("/transactions/:id/replace")`
- Migrations/DB: `migrations/0006_allocation_undo_guard.sql` › trigger `trg_fund_void_needs_unsettled_batch`; `allocation_runs` (0003)

## Divergences & Open Questions
- [OPEN] Thông điệp E3/E4 bảo "gỡ lệnh chuyển tiền trước", nhưng không có API nào đưa lệnh `done` về `pending` (chỉ ingest làm khi gỡ gán log đã khớp) — xem UC-205 [OPEN]. Lệnh đánh dấu `done` bằng tay làm khoản thu của đợt không huỷ được vĩnh viễn.
- [OPEN] Gỡ một lần chia sau khi tháng đó đã chốt (UC-207): các bút toán quét dựa trên số dư có tính fund của đợt vẫn giữ nguyên, nên phong bì liên quan sẽ âm và được bù ở lần chia kế tiếp (suy ra từ code, chưa có test).
- [OPEN] Trigger 0006 chặn theo `batch_id` cho **mọi** fund `active → void`; ngoài lần chia không có nơi nào khác sinh fund nên hiện không ảnh hưởng luồng khác.
