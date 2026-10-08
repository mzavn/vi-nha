# UC-204: Sinh lệnh chuyển tiền
- Status: implemented
- BR: BR-02, BR-04, BR-09
- Decisions: D4 (lương về TK nào thì lệnh xuất phát từ TK đó); commit `8ef7a99` (memo ngẫu nhiên riêng từng lệnh); `plans/reports/redteam-260922-0100-money-correctness.md` Phát hiện 4 (khớp nhầm lệnh khi memo dùng chung cả đợt)
- Actor: hệ thống — được gọi trong UC-202 (bản nháp), UC-203 và UC-207 (ghi), và quyết toán thuế năm (ledger)
- Trigger: lời gọi `transferOrders(moves, walletAccount, fromAccountId)` + `newTransferMemo()` lúc ghi

## History
- v1 (2026-09-22, commit `b92fc0f`): gộp fund theo tài khoản đích; memo `PF <batch_id>` dùng chung cả đợt.
- v2 (2026-09-22, commit `8ef7a99`): memo `PF` + 6 ký tự ngẫu nhiên **riêng từng lệnh**; ingest tra lệnh theo memo. Lý do: mã theo `batch_id` tuần tự đoán được — người ngoài chuyển đúng số tiền với memo đoán được vào TK của nhà là đánh dấu "đã chuyển" được một lệnh thật; và hai lệnh cùng đợt không phân biệt được.

## Preconditions
- Có danh sách `moves` (fund của lần chia, hoặc khoản quét về Tích sản) và bản đồ `wallet → account_id` của các ví active.

## Main Flow
1. `fromAccountId` rỗng → không có lệnh nào.
2. Với từng `move`: `to = walletAccount[walletId]`; bỏ qua nếu `to` rỗng, `to = fromAccountId`, hoặc `amount ≤ 0`.
3. Gộp theo `to`: mỗi tài khoản đích **một** bản nháp `{ fromAccountId, toAccountId, amount = Σ, walletIds[] }` (thứ tự theo lần đầu gặp).
4. Khi ghi (UC-203/UC-207), mỗi bản nháp → một dòng `transfer_orders` (`status='pending'`) với `memo = newTransferMemo()`:
   `"PF " + 6 ký tự`, mỗi ký tự = `ALPHABET[byte % 32]` với `ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"` (bỏ 0/O, 1/I), byte từ `crypto.getRandomValues`.

## Alternative Flows
- 3a. Mọi ví đích trú cùng TK nhận tiền → không có lệnh.
- 3b. Chốt tháng (UC-207): gọi riêng cho **từng TK nguồn** của các phong bì bị quét, với một `move` duy nhất về ví Tích sản → có thể nhiều lệnh cùng đích, khác nguồn.

## Exceptions
- Không có lỗi nghiệp vụ; hàm thuần trả danh sách (có thể rỗng).

## Acceptance Criteria
### AC-1: Lệnh gộp theo TK đích, xuất phát từ TK nhận lương, memo ngẫu nhiên dạng `PF XXXXXX`
- Given khoản thu 40.000.000 về `vcb-husband`; Tích sản trú `tcb-husband`
- When chia
- Then có đúng một lệnh tới `tcb-husband`: `from=vcb-husband`, `amount=12.000.000`, `memo` khớp `^PF [A-Z2-9]{6}$`
- Tests: `test/api.test.ts` › "chia lương end-to-end › preview không ghi gì; allocate ghi đúng các fund và lệnh chuyển tiền"; tương tự cho quyết toán thuế: `test/tax.test.ts` › "quyết toán thuế năm › thừa thì chuyển phần thừa sang Tích sản, sinh lệnh chuyển MB → TCB, chỉ quyết toán một lần"

### AC-2: Ví cùng tài khoản với TK nhận tiền không sinh lệnh; không biết TK nhận thì không sinh lệnh
- Given mọi ví đích trú ở TK nhận tiền, hoặc `fromAccountId = null`
- When sinh lệnh
- Then danh sách rỗng
- Tests: ⚠ Chưa có test (plan phase-02 Todo yêu cầu "mọi ví cùng TK → không sinh lệnh")

### AC-3: Lương về TK vợ thì lệnh xuất phát từ TK vợ (D4)
- Given khoản thu về `vcb-wife`, ví chung trú `vcb-husband`
- When chia
- Then các lệnh có `from_account_id = vcb-wife`
- Tests: ⚠ Chưa có test kiểm `from_account_id` (plan phase-02 Todo; test "người kia bấm 'Đã chuyển'…" dùng income `vcb-em` nhưng chỉ kiểm phần gỡ)

### AC-4: Memo kiểu cũ đoán được không còn khớp lệnh
- Given lệnh `PF H4K8M2` của đợt `A12`
- When người ngoài chuyển tiền vào với nội dung `PF A12`
- Then lệnh vẫn `pending`; `extractTransferMemo("PF A12")` và `"PF S202609"` = null
- Tests: `test/ingest-integrity.test.ts` › "lệnh chuyển tiền › người ngoài chuyển tiền vào với mã kiểu cũ đoán được không làm lệnh thành 'đã chuyển'"; `test/rules.test.ts` › "extractTransferMemo › mã kiểu cũ đoán được (PF A12, PF S202609) không còn là mã lệnh"

### AC-5: Một lần chia có nhiều lệnh — mỗi lệnh khớp đúng giao dịch của mình
- Given đợt `A5` có hai lệnh memo khác nhau tới `tcb-husband` và `mb-husband`
- When hai chân ngân hàng của từng lệnh về
- Then mỗi giao dịch transfer gắn đúng cặp log của lệnh mình
- Tests: `test/ingest-integrity.test.ts` › "lệnh chuyển tiền › một lần chia có hai lệnh: chân thứ hai gắn đúng giao dịch của lệnh mình" (khớp memo thuộc ingest)

## Traceability
- Code: `src/domain/transfer-orders.ts` › `transferOrders`, `newTransferMemo`, `MEMO_ALPHABET`, `TransferOrderDraft`, `Move`; `src/services/ledger.ts` › `walletAccounts`, `allocateIncome`, `closeMonth`, `settleTax`; nhận diện memo: `src/domain/rules.ts` › `extractTransferMemo` (ingest)
- Migrations/DB: `transfer_orders` (`migrations/0001_schema.sql` mục 10)

## Divergences & Open Questions
- [DIVERGENCE] Chú thích cột `memo` trong `migrations/0001_schema.sql:203` vẫn ghi `'PF <batch_id>'`; code và `docs/schema.sql` đã là `'PF XXXXXX' ngẫu nhiên, riêng từng lệnh` (`src/domain/transfer-orders.ts:37-40`). Migration là lịch sử nên không sửa; ghi lại để khỏi nhầm.
- [OPEN] Không có ràng buộc UNIQUE cho `transfer_orders.memo` và code không kiểm trùng khi sinh; không gian mã 32^6 (~1,07 tỷ). Ingest tra lệnh bằng `memo + amount + (from|to account)` và lấy dòng đầu — hai lệnh trùng memo, trùng số tiền và tài khoản sẽ mơ hồ.
