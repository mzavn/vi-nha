# UC-105: Đếm số dư tài khoản → bút toán điều chỉnh
- Status: implemented
- BR: BR-04, BR-07
- Decisions: D14 (không đếm TK có feed khi còn log chưa gán); `docs/core_design_rules.md` §5 (Chủ nhật đếm ví), §7 (tiền mặt: chênh lệch ghi `adjust`, không sửa đè lịch sử); `phase-01-worker-d1.md` S5 (TK không có số dư feed đối soát bằng nhập số dư thật); commit `b8e8f0c` (red-team #2)
- Actor: thành viên (sheet Đếm ở màn Tài khoản); nhắc bởi cron Chủ nhật (notify UC-404)
- Trigger: `POST /v1/accounts/:id/count` body `{counted}`

## History
- v1 (2026-09-22, commit `b92fc0f`): đếm → so với sổ → lệch thì một bút toán `adjust` vào ví nhận phần còn lại; luôn ghi `cash_counts`.
- v2 (2026-09-22, commit `b8e8f0c`): tài khoản có feed mà còn log `pending` thì từ chối — log chưa gán là tiền đã đi thật nhưng chưa vào sổ; đếm lúc đó rồi gán log sau là trừ khoản đó lần hai (`plans/reports/redteam-260922-0100-money-correctness.md` #2).
- v3 (2026-10-03, commit `a18730c`): ghi chú bút toán viết số như tiền trên app ("sổ −1.500.000 ₫, thật 800.000 ₫") thay vì số trần "-1500000" (audit 261003); dòng cũ giữ nguyên chữ đã ghi.

## Preconditions
- Tài khoản active; có một luật `remainder` active (ví Có thì tốt).

## Main Flow
1. Route kiểm `counted` là số nguyên (sai → `invalid_input`); service kiểm `counted ≥ 0`.
2. Nếu tài khoản `sepay_enabled=1`: đếm số log `pending` của tài khoản; > 0 → từ chối `pending_logs`.
3. `book` = `v_account_book.book_balance` của tài khoản; `diff = counted − book`.
4. `diff ≠ 0` → một dòng `transactions` `meaning='adjust'`, `amount = |diff|`, `source='manual'`, `by_member_id` = người đếm, `at = now`, `note = "Đối soát số dư: sổ <book>, thật <counted>"` (hai số viết như tiền trên app: `−1.500.000 ₫`):
   - tiền thật **nhiều hơn** sổ: `wallet_id` = ví `remainder` (+), `counter_account_id` = tài khoản (vào);
   - tiền thật **ít hơn** sổ: `counter_wallet_id` = ví `remainder` (−), `account_id` = tài khoản (ra).
5. Luôn ghi một dòng `cash_counts (at, account_id, counted, book, adjust_tx_id)`; `adjust_tx_id` = id bút toán vừa ghi hoặc NULL khi khớp. Bước 4–5 trong **một batch**.
6. Trả `{accountId, book, counted, diff}` HTTP 201. Sau đó `book_balance` = `counted`.

## Alternative Flows
- 2a. Tài khoản ghi tay (`sepay_enabled=0`, gồm tiền mặt) → bỏ qua bước 2.
- 4a. `diff = 0` → không có bút toán, vẫn có dòng `cash_counts` (dấu "đã đếm", notify dùng để không nhắc lại trong 7 ngày).

## Exceptions
- E1. `counted` không phải số nguyên → `invalid_input` 400; âm → `invalid_amount` 400 "Số dư đếm được phải là số nguyên không âm."
- E2. Tài khoản không có/không active → `unknown_account` 404.
- E3. TK có feed còn log chưa gán → `pending_logs` 409 "<tên> còn N giao dịch chưa gán. Gán hết rồi mới đối soát số dư."
- E4. Không có luật `remainder` → `config` 400 "Chưa có ví nhận phần còn lại để ghi chênh lệch."

## Acceptance Criteria
### AC-1: Đếm lệch → một bút toán điều chỉnh vào Có thì tốt, sổ khớp tiền thật
- Given `cash-husband` sổ 500.000 (sau một `transfer` từ `vcb-husband`)
- When đếm được 450.000
- Then trả `{accountId:"cash-husband", book:500000, counted:450000, diff:-50000}`; `book_balance` = 450.000; số dư `nice-to-have` = −50.000
- Tests: `test/api.test.ts` › "chia lương end-to-end › đếm ví lệch → một bút toán điều chỉnh vào Có-thì-tốt, sổ khớp tiền thật"

### AC-2: TK có feed còn log chưa gán → từ chối, không sinh điều chỉnh
- Given `vcb-husband` có feed và một log `out` 300.000 đang `pending`
- When đếm `vcb-husband` = 700.000
- Then lỗi `pending_logs`; không có dòng `adjust` nào
- Tests: `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › đếm số dư tài khoản có bank feed khi còn log chưa gán → từ chối (không sinh bút toán điều chỉnh)"

### AC-3: Đếm khớp vẫn ghi lần đếm, không sinh bút toán
- Given `book_balance` = X
- When đếm được đúng X
- Then `diff = 0`; có một dòng `cash_counts` với `adjust_tx_id` NULL; không có `adjust` mới
- Tests: ⚠ Chưa có test

### AC-4: Tiền thật nhiều hơn sổ → cộng Có thì tốt
- Given sổ tiền mặt 100.000
- When đếm được 150.000
- Then một `adjust` 50.000 có `wallet_id` = ví `remainder`, `counter_account_id` = tài khoản; `book_balance` = 150.000
- Tests: ⚠ Chưa có test

## Traceability
- Code: `src/routes/v1.ts` › `POST /accounts/:id/count`; `src/services/ledger.ts` › `countAccount`, `insertTx`, `loadRefs`
- Migrations/DB: bảng `cash_counts`, view `v_account_book`, CHECK `meaning` gồm `adjust` (`migrations/0001_schema.sql`)
- PWA: `web/src/screens/count-sheet.tsx` (pwa context).

## Divergences & Open Questions
- [DIVERGENCE] `docs/core_design_rules.md` §2: `adjust` "+ hoặc − tuỳ đặt ở `wallet_id` hay `counter_wallet_id`" (ví bất kỳ) — code luôn dùng **ví nhận phần còn lại** (Có thì tốt); không chọn được ví khác.
- [DIVERGENCE] `plans/reports/redteam-260922-0100-money-correctness.md` câu hỏi mở 2 đề xuất hai hướng (chặn hẳn, hoặc trừ phần `pending` trước khi tính lệch); code chọn chặn khi còn `pending` nhưng **vẫn cho** đếm TK có feed khi không còn log chờ — trong khi `phase-03-api.md` dòng 33 mô tả đếm cho "tiền mặt **hoặc** TK ngân hàng không có số dư feed".
- [OPEN] Bút toán `adjust` có `source='manual'` nên huỷ được qua UC-102; huỷ nó không đụng dòng `cash_counts`.
- [OPEN] Hai lần đếm song song cùng tài khoản đọc cùng `book`, cả hai đều ghi `adjust` → chênh lệch bị ghi hai lần (không có khoá; `[INFERENCE]` từ `countAccount` đọc-rồi-ghi ngoài batch).
