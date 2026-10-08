# UC-110: Quyết toán thuế năm
- Status: implemented
- BR: BR-07, BR-02
- Decisions: `docs/core_design_rules.md` §9 "Thuế: 10% chỉ trên thu nhập chưa khấu trừ; thừa cuối năm → Tích sản", §5 "Cuối năm"; `docs/profit_first_phuong_phap.md` §3; commit `58306aa`, `8ef7a99` (memo ngẫu nhiên cho lệnh chuyển); ADR-92 (phe Tích sản lưu là `wealth_building`)
- Actor: chủ nhà (gọi API)
- Trigger: `GET /v1/tax/:year` (xem số), `POST /v1/tax/:year/settle` (quyết toán)

## History
- v1 (2026-09-22, commit `58306aa`): đã trích = mọi `fund` vào ví Thuế trong năm; đã nộp = mọi `spend` từ ví Thuế trong năm; thừa chuyển sang Tích sản kèm lệnh chuyển tiền; mỗi năm quyết toán một lần, chỉ sau khi năm kết thúc.
- v2 (2026-09-22, commit `8ef7a99`): lệnh chuyển tiền dùng memo `PF` + 6 ký tự ngẫu nhiên riêng từng lệnh (`newTransferMemo`) thay vì suy ra từ `batch_id`.
- v3 (2026-10-07, commit `7424f26`): phe ví Tích sản nhận phần thuế thừa lưu là `tier='wealth_building'` thay `tichsan` (migration 0028, schema v1.28, ADR-92); luật quyết toán không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Có ví `tier='tax'` và ví `tier='wealth_building'` (Tích sản) active (thiếu → `config` 400).
- `year` là số nguyên 2000–2100.

## Main Flow — xem (`getTax`)
1. `provisioned` = Σ `amount` các `fund` active vào ví Thuế có `month_key` thuộc năm (`LIKE 'YYYY-%'`).
2. `paid` = Σ `amount` các `spend` active trừ ví Thuế (`counter_wallet_id`) có `month_key` thuộc năm.
3. Trả `{year, provisioned, paid, difference = provisioned − paid, walletBalance (số dư hiện tại của ví Thuế), settlement (dòng tax_settlements hoặc null)}`.

## Main Flow — quyết toán (`settleTax`)
1. Từ chối nếu `year ≥` năm hiện tại theo giờ VN (`year_not_over`) hoặc năm đã quyết toán (`already_settled`).
2. `surplus = max(0, min(provisioned − paid, walletBalance))` — chỉ chuyển phần thừa **thật sự còn trong ví Thuế**.
3. `surplus > 0` → trong cùng batch:
   - một `transfer` `source='system'`, `batch_id = "T<năm>"`, `wallet_id` = Tích sản, `counter_wallet_id` = Thuế, không tài khoản, `note = "Quyết toán thuế <năm>: phần thừa chuyển sang Tích sản"`;
   - lệnh chuyển tiền từ tài khoản của ví Thuế sang tài khoản của ví Tích sản, sinh theo luật của allocation UC-204 "Sinh lệnh chuyển tiền" (`transferOrders`, memo `newTransferMemo`).
4. Ghi `tax_settlements (year, provisioned, paid, surplus_tx_id, settled_at)`; `surplus_tx_id` = id bút toán `transfer` của `T<năm>` (NULL khi không thừa).
5. Trả kết quả `getTax` sau khi ghi kèm `surplus`, HTTP 201.

## Alternative Flows
- 2a. Thiếu (`paid > provisioned`) hoặc ví Thuế không còn tiền → `surplus = 0`: chỉ ghi dòng `tax_settlements` để ghi nhận; phần nộp thêm là một khoản chi từ ví Thuế (nhập như `spend`).

## Exceptions
- E1. `year` không phải số nguyên hoặc ngoài 2000–2100 (ví dụ `/v1/tax/abc`) → `invalid_year` 400.
- E2. Năm chưa kết thúc → `year_not_over` 409 "Chỉ quyết toán năm đã kết thúc."
- E3. Năm đã quyết toán → `already_settled` 409 "Năm <năm> đã quyết toán."
- E4. Thiếu ví Thuế/Tích sản → `config` 400.

## Acceptance Criteria
### AC-1: Thừa → chuyển phần thừa sang Tích sản, sinh lệnh chuyển MB → TCB, chỉ một lần
- Given 2026: thu nhập ngoài 20.000.000 `taxable` đã chia (2.000.000 vào ví Thuế); đã nộp 1.500.000 từ ví Thuế
- When `GET` năm 2026, rồi quyết toán ngày 05/01/2027, rồi quyết toán lại
- Then `provisioned 2.000.000, paid 1.500.000, difference 500.000, walletBalance 500.000`; `surplus = 500.000`; `settlement.surplus_tx_id` là số; ví Thuế về 0; đúng một lệnh `T2026` `mb-husband → tcb-husband` 500.000 memo `PF XXXXXX`; lần hai `already_settled`
- Tests: `test/tax.test.ts` › "quyết toán thuế năm › thừa thì chuyển phần thừa sang Tích sản, sinh lệnh chuyển MB → TCB, chỉ quyết toán một lần"

### AC-2: Chưa hết năm thì không cho quyết toán
- Given ngày 31/12/2026
- When quyết toán năm 2026
- Then `year_not_over`
- Tests: `test/tax.test.ts` › "quyết toán thuế năm › chưa hết năm thì không cho quyết toán"

### AC-3: Năm sai định dạng → 400
- Given —
- When `GET /v1/tax/abc`
- Then 400
- Tests: `test/tax.test.ts` › "quyết toán thuế năm › REST: năm sai định dạng → 400"

### AC-4: Thiếu thuế → chỉ ghi nhận, không có bút toán
- Given đã nộp nhiều hơn đã trích
- When quyết toán
- Then `surplus = 0`, có dòng `tax_settlements` với `surplus_tx_id` NULL, không có `transfer` `T<năm>` nào
- Tests: ⚠ Chưa có test

## Traceability
- Code: `src/routes/v1.ts` › `GET /tax/:year`, `POST /tax/:year/settle`; `src/services/ledger.ts` › `taxFigures`, `validYear`, `getTax`, `settleTax`, `insertTx`, `walletAccounts`; `src/domain/transfer-orders.ts` › `transferOrders`, `newTransferMemo` (allocation)
- Migrations/DB: bảng `tax_settlements` (`year` PRIMARY KEY), `transfer_orders` (`migrations/0001_schema.sql`)

## Divergences & Open Questions
- [OPEN] Không có màn PWA, tool MCP hay cron nào gọi quyết toán (không có `/v1/tax` trong `web/src`, không có tool thuế trong `src/mcp/tools.ts`); `docs/core_design_rules.md` §5 coi quyết toán là một nhịp "Cuối năm".
- [OPEN] "Đã nộp" = mọi `spend` trừ ví Thuế, bất kể danh mục; seed không có danh mục nộp thuế (test tự tạo `nop-thue`).
- [OPEN] `walletBalance` là số dư ví Thuế **hiện tại** (mọi năm), không phải cuối năm được quyết toán; thuế trích năm sau đã nằm trong ví sẽ được tính vào giới hạn chuyển.
- [OPEN] Hai request quyết toán song song: khoá chính `tax_settlements.year` làm batch thứ hai huỷ cả (không có `transfer` thứ hai), nhưng lỗi DB không được đổi sang `already_settled` (`[INFERENCE]` từ `settleTax` không bắt lỗi batch).
- [OPEN] Bút toán `T<năm>` là `source='system'` nên không huỷ được qua UC-102; không có đường gỡ một lần quyết toán.
