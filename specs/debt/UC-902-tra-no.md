# UC-902: Trả nợ: ghi tay, offline, từ ví giữ riêng
- Status: implemented
- BR: BR-12, BR-03, BR-04
- Decisions: ADR-71 (trả nợ = khoản chi có `debt_id`; huỷ giao dịch là số còn nợ tự đúng lại), ADR-63 (ví giữ riêng "Thu cho thuê"; trả nợ do vợ chồng quyết từng lần), D12 (hàng đợi offline), D14/ADR-66 (khoản chi từ tài khoản SePay báo tiền ra phải gán ở màn Gán); ADR-94 (mã hệ thống tiếng Anh)
- Actor: người trong hộ (PWA: card quỹ giữ riêng › **Trả nợ**, hoặc nút trả ở tab Nợ — sheet Trả nợ, [UC-712](../pwa/UC-712-chuyen-ngan-sach-va-bu.md)); Claude qua MCP `add_transaction` có `debt_id`; script qua REST
- Trigger: `POST /v1/transactions { meaning: "spend", amount, debt_id, category_id?, wallet_id?, account_id?, at?, note?, client_id? }` ([ledger UC-101](../ledger/UC-101-nhap-tay-khoan-tien.md))

## History
- v1 (2026-10-01, commit `25db5b9`): khoản chi nhận `debt_id`; thiếu danh mục thì lấy `tra-no`; lỗi `debt_spend_only`, `unknown_debt`, `inactive_debt`; sheet Trả nợ chọn khoản nợ (mặc định khoản còn nợ nhiều nhất), toast "Đã trả X cho tên. Còn nợ Y."; MCP `add_transaction` nhận `debt_id` (ADR-71).
- v2 (2026-10-01, commit `2438ac0`): không đổi hành vi — ghi lại [DIVERGENCE] với VAS 24 §11(d): trả nợ gốc đang là khoản chi (`spend`, "đã tiêu") trong khi chuẩn mực xếp nó vào hoạt động tài chính; đề xuất meaning `repay` đối xứng với `collect` (ADR-72), chủ nhà chưa quyết.
- v3 (2026-10-08, commit `21b9db0`): không đổi hành vi — danh mục trả nợ mặc định là mã hệ thống `debt-payment` (hằng `DEBT_CATEGORY_ID` ở `src/domain/system-ids.ts`, dùng chung server và PWA); migration 0029 đổi `tra-no` → `debt-payment` (ADR-94). Tên test AC-5 đổi theo. (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Khoản nợ tồn tại và đang bật ([UC-901](UC-901-them-va-xem-khoan-no.md)). Ghi tay: tiền ra từ tài khoản **không** báo tiền ra qua SePay (tiền mặt, hoặc tài khoản `sepay_out = 0` — ADR-66); tài khoản báo tiền ra thì làm UC-903.
- Ghi được khi mất mạng: khoản trả đi qua hàng đợi như mọi khoản chi (pwa UC-704); danh sách khoản nợ lấy từ `bootstrap.debts` đã lưu trên máy.

## Main Flow
1. Người mở sheet **Trả nợ** (từ card "Thu cho thuê", nút Trả nợ của tab Nợ, hoặc sheet chi tiết một khoản nợ — pwa UC-712 bước 11). Ô **Trả cho khoản nợ** liệt kê khoản còn nợ (`balance > 0`) theo còn nợ giảm dần (`payableDebts`); chọn sẵn khoản được mở từ (nếu còn nợ), không thì khoản còn nợ nhiều nhất (`defaultDebtId`); dưới ô là "{tên} còn nợ X.".
2. Người nhập **số tiền**, chọn **Tiền ra từ** (tài khoản nhập tay được chiều ra), **Ngày** (≤ hôm nay), ghi chú tuỳ chọn. Ví là quỹ đang mở sheet (vd `rental-income`); mở từ tab Nợ thì là ví mặc định của danh mục `debt-payment`.
3. PWA `saveEntry({ meaning: "spend", amount, at, client_id, category_id: "debt-payment", wallet_id, account_id, debt_id, note? })` → hàng đợi → gửi `POST /v1/transactions`.
4. Server `buildEntry` (ledger UC-101): `debt_id` chỉ đi với `spend` (`debt_spend_only`); khoản nợ phải có (`unknown_debt`) và đang bật (`inactive_debt`); không gửi `category_id` thì lấy `debt-payment` (nếu hộ có danh mục này); ví mặc định của `debt-payment` là ví giữ riêng `rental-income`, ví giữ riêng chi được. Ghi một dòng `transactions` mang `debt_id` → 201 `{ tx, duplicate, wallet }` như mọi khoản chi.
5. Hệ quả: còn nợ của khoản giảm đúng số tiền (`v_debt_balance.paid` cộng khoản này); ví và tài khoản bị trừ như một khoản chi thường. Không có dòng nợ nào được ghi.
6. Toast: "Đã trả X cho {tên}. Còn nợ Y." — trả đủ hoặc dư thì "Đã trả X cho {tên}. Hết nợ." (`paymentToast`, tính từ còn nợ trong `bootstrap.debts` trên máy).

## Alternative Flows
- 1a. Không còn khoản nào còn nợ (hoặc `bootstrap` cũ chưa có `debts`) → sheet không có ô khoản nợ (ô ghi chú thành "Trả cho"); khoản chi ghi như trước, không gắn `debt_id`.
- 3a. **Offline**: khoản nằm trong hàng đợi, số dư ví trừ tạm (UC-704); còn nợ trên server chỉ đổi khi đồng bộ xong. Gửi lại cùng `client_id` chỉ ghi một lần (D12).
- 4a. **MCP** `add_transaction { meaning: "spend", amount, debt_id, by_member_id, … }` (id lấy từ `get_debts`) — cùng `createEntry`, cùng luật và lỗi.
- 4b. Gửi `category_id` khác `debt-payment` vẫn được: sổ nợ chỉ đọc `debt_id` và `amount`.
- 5a. **Huỷ** khoản trả (ledger UC-102) → còn nợ tự trở lại; không cần huỷ gì ở sổ nợ.

## Exceptions
- E1. `debt_id` trên khoản không phải `spend` → 400 `debt_spend_only` "Khoản nợ chỉ gắn được với khoản chi (trả nợ)."
- E2. `debt_id` không có → 400 `unknown_debt`; khoản nợ đã tắt → 400 `inactive_debt`.
- E3. Tài khoản báo cả tiền ra qua SePay (`sepay_out = 1`) → 400 `fed_account`: trả bằng gán log ở UC-903.
- E4. Đồng bộ bị từ chối (vd khoản nợ vừa bị tắt) → khoản nằm lại `rejected` trong hàng đợi (UC-704).
- E5. MCP: lỗi nghiệp vụ trả `isError: true`, không ghi gì.

## Acceptance Criteria

### AC-1: Khoản chi có `debt_id` làm giảm số còn nợ
- Given Cô Mai còn 10.000.000
- When ghi `spend` 4.000.000 với `debt_id: "co-mai"`, danh mục `debt-payment`, ví `rental-income`
- Then 201, `tx.debt_id = "co-mai"`; `owed` 10.000.000, `paid` 4.000.000, còn nợ 6.000.000, `done = false`; `payments` có khoản đó (`walletId: "rental-income"`, `source: "manual"`)
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › khoản chi có debt_id làm giảm số còn nợ"

### AC-2: Huỷ khoản trả nợ thì số còn nợ trở lại
- Given Cô Mai còn 10.000.000, đã trả 4.000.000
- When huỷ khoản trả đó (`POST /v1/transactions/:id/void`)
- Then `paid` 0, còn nợ về 10.000.000, `payments` rỗng; không dòng nợ nào bị đổi
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › huỷ khoản trả nợ thì số còn nợ trở lại"

### AC-3: `debt_id` chỉ gắn với khoản chi
- Given một khoản nợ
- When ghi `income`, `refund`, `lend` kèm `debt_id`
- Then 400 `debt_spend_only`; bảng `transactions` vẫn trống
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › debt_id chỉ gắn với khoản chi: debt_spend_only"

### AC-4: Khoản nợ không có hoặc đã tắt bị từ chối
- Given `debt_id = "khong-co"`; một khoản nợ đã tắt
- When ghi `spend` kèm hai `debt_id` đó
- Then 400 `unknown_debt`; 400 `inactive_debt`
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › debt_id không có hoặc đã tắt: unknown_debt, inactive_debt"

### AC-5: Trả nợ không chọn danh mục thì lấy danh mục `debt-payment`
- Given hộ có danh mục `debt-payment` (ví mặc định `rental-income`)
- When ghi `spend` 300.000 kèm `debt_id`, không gửi `category_id` (người ghi `husband`); rồi ghi 100.000 với `category_id: "eating-out"`
- Then lần đầu `category_id = "debt-payment"`, `counter_wallet_id = "rental-income"`, `account_id = "cash-husband"`; lần sau giữ `eating-out`, vẫn mang `debt_id`
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › trả nợ không chọn danh mục thì lấy danh mục debt-payment"

### AC-6: MCP `add_transaction` nhận `debt_id`
- Given Cô Mai mở sổ 1.000.000
- When Claude gọi `add_transaction { meaning: "spend", amount: 400000, debt_id: "co-mai", by_member_id: "husband" }`
- Then không lỗi; `tx` có `debt_id = "co-mai"`, `category_id = "debt-payment"`, `counter_wallet_id = "rental-income"`; `get_debts` trả `totalBalance = 600.000`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "sổ nợ › add_transaction nhận debt_id"

### AC-7: Sheet Trả nợ chọn sẵn khoản còn nợ nhiều nhất
- Given Cô Lan còn 6.000.000, Anh Tú còn 9.379.000, một khoản đã trả xong
- When mở sheet Trả nợ (không từ khoản nào); mở từ Cô Lan; mở từ khoản đã xong
- Then chọn sẵn lần lượt Anh Tú, Cô Lan, Anh Tú (không bao giờ gắn vào khoản hết nợ); không có `debts` → không chọn gì
- Tests: [`web/src/lib/debts.test.ts`](../../web/src/lib/debts.test.ts) › "sổ nợ › trả nợ mặc định chọn khoản còn nợ nhiều nhất"

### AC-8: Toast nói đã trả bao nhiêu và còn nợ bao nhiêu
- Given Cô Lan còn 15.379.000
- When trả 2.000.000; hoặc trả đúng / trả hơn số còn nợ
- Then "Đã trả 2.000.000 ₫ cho Cô Lan. Còn nợ 13.379.000 ₫."; "… Hết nợ."
- Tests: [`web/src/lib/debts.test.ts`](../../web/src/lib/debts.test.ts) › "sổ nợ › toast sau khi trả nợ: Đã trả X cho tên. Còn nợ Y."

### AC-9: Trả nợ ghi được khi offline, đồng bộ đúng một lần
- Given máy offline, `bootstrap.debts` đã lưu
- When ghi trả nợ rồi có mạng lại
- Then khoản vào hàng đợi kèm `debt_id`, sheet đóng; khi đồng bộ server ghi đúng một khoản và còn nợ giảm
- Tests: ⚠ Chưa có test

## Traceability
- Code: `src/routes/v1.ts` › `POST /transactions` (`debt_id`); `src/domain/entry.ts` › `buildEntry` (`debt_spend_only`, `unknown_debt`, `inactive_debt`, `DEBT_CATEGORY_ID`); `src/services/ledger.ts` › `loadRefs` (`debts`), `createEntry`, `insertTx`; `src/mcp/tools.ts` › `add_transaction`
- PWA: `web/src/lib/debts.ts` › `payableDebts`, `defaultDebtId`, `paymentToast`, `owedText`; `web/src/screens/budget-sheets.tsx` › `DebtSheet` (sheet Trả nợ — [UC-712](../pwa/UC-712-chuyen-ngan-sach-va-bu.md)); `web/src/state/store.ts` › `saveEntry`
- Migrations/DB: `transactions.debt_id`, `idx_tx_debt`, view `v_debt_balance` (`migrations/0013_debts.sql`); danh mục "Trả nợ", ví "Thu cho thuê" (`migrations/0007_income_streams_rental.sql`); mã danh mục hệ thống `debt-payment` từ `migrations/0029_system_ids.sql` (trước đó `tra-no`, ADR-94), hằng `DEBT_CATEGORY_ID` (`src/domain/system-ids.ts`); hộ mẫu: ví `rental-income`

## Divergences & Open Questions
- [OPEN] Toast tính còn nợ từ `bootstrap.debts` trên máy, không từ phản hồi server: offline hoặc khi người kia vừa trả cùng khoản thì "Còn nợ Y" có thể lệch với số thật cho tới lần tải lại.
- [OPEN] Không chặn trả quá số còn nợ: còn nợ âm (trả dư) chỉ hiện "Hết nợ."/nhóm "Đã trả xong", không có cảnh báo hay đường hoàn lại.
- [DIVERGENCE] [VAS 24](https://docs.kreston.vn/vbpl/ke-toan/chuan-muc-ke-toan/vas-24) §11(c)(d) xếp "Tiền thu từ các khoản đi vay" và "Tiền chi trả các khoản nợ gốc đã vay" vào **hoạt động tài chính** — không phải chi phí; app ghi trả nợ gốc là `spend` danh mục `debt-payment`: trừ ví, vào "đã tiêu" (`v_spent_*`), chi theo danh mục và trung bình chi nếu ví thuộc nhóm Must, trong khi tiền cho vay quay về đã thôi là "thu" (`collect`, ADR-72, VAS 24 §10(d)). Đề xuất (chưa làm, chủ nhà chưa quyết): thêm meaning `repay` đối xứng với `collect` — tiền **ra** khỏi tài khoản, gắn `debt_id`, không là "đã tiêu", không vào chi theo danh mục; còn việc ngân sách nào chịu khoản trả (hiện là ví giữ riêng "Thu cho thuê", ADR-63) thì đi kèm một bút toán chuyển ngân sách rõ ràng thay vì ẩn trong một khoản chi. Cho tới khi quyết, giữ `spend`: số còn nợ vẫn đúng (`v_debt_balance` chỉ đọc `amount`), chỉ có "đã tiêu" của ví trả nợ là tính cả tiền gốc.
