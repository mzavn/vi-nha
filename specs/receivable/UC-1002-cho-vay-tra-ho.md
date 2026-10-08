# UC-1002: Cho vay / trả hộ
- Status: implemented
- BR: BR-13, BR-03, BR-04
- Decisions: ADR-72 (cho vay = `lend` mang `receivable_id`, không đụng ví; không phải chi tiêu), ADR-84 (mua hộ / trả hộ người khác, nhà mình không có phần = Cho vay; chia bill có phần mình = Chi tiêu + Hoàn tiền), ADR-03 (`lend` không đụng ví), D12 (hàng đợi offline), D14/ADR-66 (tiền ra từ tài khoản SePay báo tiền ra phải gán ở màn Gán); ADR-94 (mã hệ thống tiếng Anh)
- Actor: người trong hộ (PWA: màn Nhập › **Loại khác** › **Cho vay**, [UC-705](../pwa/UC-705-nhap-loai-khac.md); màn Gán, [UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md)); Claude qua MCP `add_transaction`/`assign_log` có `receivable_id`; script qua REST
- Trigger: `POST /v1/transactions { meaning: "lend", amount, receivable_id?, account_id?, category_id?, at?, note?, client_id? }` ([ledger UC-101](../ledger/UC-101-nhap-tay-khoan-tien.md)); split `{ meaning: "lend", amount, receivable_id?, … }` của `POST /v1/logs/:id/assign` ([ingest UC-305](../ingest/UC-305-gan-log-chua-gan.md))

## History
- v1 (2026-10-01, commit `2438ac0`): `lend` nhận `receivable_id` (cho vay thêm cho một khoản phải thu); thiếu danh mục thì lấy `cho-vay`; lỗi `receivable_only`, `unknown_receivable`, `inactive_receivable`; split gán log và MCP nhận `receivable_id` (ADR-72).
- v2 (2026-10-04, commit `c9c6acb`): change [`261004-gan-tham-chieu`](../changes/archive/261004-gan-tham-chieu/proposal.md) — ô **Cho ai vay** (Loại khác và màn Gán) luôn hiện, có **+ Người mới…** (cần mạng; tạo khoản phải thu số 0 rồi chọn luôn — [UC-1001](UC-1001-them-va-xem-khoan-phai-thu.md) AC-8) và dòng "{tên} còn nợ X · sau khoản này còn Y" (pwa UC-706 bước 5b). Server không đổi.
- v3 (2026-10-05, commit `ea0d365`): ADR-84 — chủ nhà: "nó là 2 nghiệp vụ khác nhau mà? 'đổi loại sang Chi tiêu › Thuốc thang' tức là tôi mua cho tôi; đây là tôi mua hộ cho bà Hoa, sau đó bà chị trả lại tiền cho tôi." Bước 1b nói rõ **mua hộ** cũng là trả hộ (Cho vay), và chỉ khi nhà mình không có phần; chia bill có phần mình là Chi tiêu. Chữ nhắc Cho vay ở màn Gán nói đúng luật này (pwa UC-706 v28). Server không đổi.
- v4 (2026-10-08, commit `21b9db0`): không đổi hành vi — danh mục cho vay mặc định là mã hệ thống `lending` (hằng `LEND_CATEGORY_ID`; migration 0029 đổi từ `cho-vay`, ADR-94). (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Khoản phải thu tồn tại và đang bật ([UC-1001](UC-1001-them-va-xem-khoan-phai-thu.md)) — hoặc không gắn khoản nào (`lend` như trước). Ghi tay: tiền ra từ tài khoản **không** báo tiền ra qua SePay; tài khoản báo tiền ra thì gán log.
- Ghi được khi mất mạng: khoản đi qua hàng đợi (pwa UC-704); danh sách khoản phải thu lấy từ `bootstrap.receivables` đã lưu.

## Main Flow
1. Người chọn **Cho vay** (Loại khác), **Cho vay thêm** (sheet chi tiết một khoản phải thu ở tab Nợ) hoặc loại Cho vay ở một dòng gán log tiền ra; nhập **số tiền**, **Tiền ra từ** (tài khoản chiều ra), chọn **Cho ai vay** — một khoản phải thu đang bật ("{tên} · còn X" từ `bootstrap.receivables`, chọn sẵn khoản còn phải thu nhiều nhất hoặc khoản đang mở; mục đầu "không gắn khoản phải thu"); ghi chú, ngày. Hộ chưa có khoản phải thu nào → gợi ý "Chưa có khoản phải thu — thêm ở Ví & quỹ › Nợ".
2. Server `buildEntry` (ledger UC-101): `receivable_id` chỉ đi với `lend`/`collect` (`receivable_only`); khoản phải có (`unknown_receivable`) và đang bật (`inactive_receivable`); không gửi `category_id` thì lấy `lending` nếu hộ có danh mục này. Dòng ghi: `account_id` = tài khoản tiền ra, `category_id`, `receivable_id`; **không** `wallet_id`, **không** `counter_wallet_id`.
3. Hệ quả:
   - **Tài khoản** giảm đúng số tiền (`v_account_book`) — tiền thật đã rời khỏi nhà; "tiền thật đang có" ([UC-1005](UC-1005-xem-buc-tranh-tien-that.md)) giảm.
   - **Không ví nào** đổi (`v_wallet_flow` loại `lend`); không vào "đã tiêu" (`v_spent_*`), không vào chi theo danh mục, "còn để chi tuần này" không đổi — tiền cho vay vẫn là tiền của nhà, chỉ đang nằm ở người khác (luật của chủ nhà 1, [README](README.md)).
   - Có `receivable_id` → còn phải thu tăng đúng số tiền (`v_receivable_balance.lent`); khoản hiện trong `movements` (`kind: "lend"`, `accountId` = tài khoản tiền ra).
4. Trả `{ tx, duplicate, wallet: null }` như mọi khoản nhập tay. Toast PWA: có khoản phải thu → "Đã ghi cho {tên} vay thêm X. Còn Y chưa trả." (`lendToast`, tính từ `bootstrap.receivables` trên máy); không có → "Đã ghi khoản cho vay."

## Alternative Flows
- 1a. Không chọn khoản phải thu → `lend` như trước v1: tài khoản giảm, không ví nào đổi, sổ phải thu không đổi.
- 1b. **Mua hộ / trả hộ** người khác mà nhà mình không có phần (mua giúp ai đó món đồ, trả giúp một hoá đơn; người ta sẽ trả lại): cùng là `lend` gắn khoản phải thu của người đó — không phải chi tiêu của hộ (ADR-84). Người ta trả lại là Nhận lại tiền cho vay ([UC-1003](UC-1003-nhan-lai-tien.md), trả dư thì phần dư là Thu nhập). Chia bill mà nhà mình có phần thì không phải cho vay: Chi tiêu cả bill, phần người khác chuyển lại là Hoàn tiền.
- 2a. **Gán log** tiền ra (ingest UC-305): split `lend` kèm `receivable_id` — cùng `buildEntry`, mọi kiểm tra chạy trước khi ghi; dòng mang `log_id`, `source = 'sepay'`.
- 2b. **MCP** `add_transaction { meaning: "lend", amount, receivable_id, by_member_id, … }` / `assign_log` (id lấy từ `get_receivables`) — cùng luật, cùng lỗi.
- 3a. **Offline**: khoản nằm trong hàng đợi; số ví không đổi tạm (không có ví); còn phải thu trên server chỉ đổi khi đồng bộ. Gửi lại cùng `client_id` chỉ ghi một lần (D12).
- 4a. **Huỷ** khoản cho vay (ledger UC-102) hay gỡ gán (ingest UC-306) → tài khoản và còn phải thu tự trở lại (luật chung S3).

## Exceptions
- E1. `receivable_id` trên khoản không phải `lend`/`collect` (kể cả `refund`) → 400 `receivable_only` "Khoản phải thu chỉ gắn được với cho vay hoặc nhận lại tiền cho vay."
- E2. `receivable_id` không có → 400 `unknown_receivable`; khoản đã tắt → 400 `inactive_receivable`.
- E3. Tài khoản báo cả tiền ra qua SePay (`sepay_out = 1`) → 400 `fed_account`: gán log thay vì nhập tay.
- E4. Đồng bộ bị từ chối (vd khoản vừa bị tắt) → khoản nằm lại `rejected` (UC-704).

## Acceptance Criteria

### AC-1: Cho vay gắn khoản phải thu làm tăng còn phải thu, không đụng ví
- Given Em Hai mở sổ 2.000.000
- When ghi `lend` 500.000 với `receivable_id: "em-hai"`, `account_id: "vcb-husband"`, không gửi danh mục
- Then 201; `tx` có `receivable_id = "em-hai"`, `account_id = "vcb-husband"`, `category_id = "lending"`, `wallet_id`/`counter_wallet_id` null; `book_balance` của `vcb-husband` −500.000, tài khoản khác không đổi; số dư mọi ví không đổi; `lent` 2.500.000, còn phải thu 2.500.000; `movements` có `{ kind: "lend", amount: 500000, accountId: "vcb-husband" }`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › cho vay thêm (lend gắn khoản phải thu) tăng số phải thu, trừ tài khoản, không trừ ví, danh mục mặc định Cho vay"

### AC-2: `receivable_id` chỉ gắn với cho vay hoặc nhận lại
- Given một khoản phải thu
- When ghi `refund`, `spend`, `income`, `transfer` kèm `receivable_id`
- Then 400 `receivable_only`; bảng `transactions` vẫn trống
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › receivable_id chỉ gắn với lend / collect: receivable_only, kể cả refund"

### AC-3: Khoản phải thu không có hoặc đã tắt bị từ chối
- Given `receivable_id = "khong-co"`; Em Hai đã tắt
- When ghi `collect` với mã không có; ghi `lend` gắn Em Hai
- Then 400 `unknown_receivable`; 400 `inactive_receivable`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › receivable_id không có hoặc đã tắt: unknown_receivable, inactive_receivable"

### AC-4: Huỷ khoản cho vay thì còn phải thu trở lại
- Given Em Hai mở sổ 2.000.000, rồi `lend` 500.000 và `collect` 800.000 (còn 1.700.000)
- When huỷ khoản `collect`, rồi huỷ khoản `lend`
- Then còn phải thu 2.500.000 rồi 2.000.000; `movements` rỗng
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › huỷ khoản cho vay hoặc khoản nhận lại thì số phải thu trở lại"

### AC-5: Gán log tiền ra thành cho vay
- Given log `out` 2.000.000 `pending`, khoản phải thu đang bật
- When gán `[{ meaning: "lend", amount: 2000000, receivable_id }]`
- Then 201; giao dịch `lend` mang `receivable_id`, `source = "sepay"`; còn phải thu +2.000.000; không ví nào đổi
- Tests: ⚠ Chưa có test (cùng `buildEntry` với AC-1; split `collect` được thử ở [UC-1003](UC-1003-nhan-lai-tien.md) AC-4)

### AC-6: Thân giao dịch cho vay ở PWA: cần số tiền và tài khoản, gắn khoản nếu có, không mang ví
- Given form Cho vay
- When thiếu số tiền / tài khoản; hoặc đủ, có chọn khoản phải thu; hoặc không chọn
- Then chặn "Nhập số tiền." / "Chọn tài khoản."; thân `{ meaning: "lend", amount, account_id, receivable_id?, … }` không có `wallet_id`; vào hàng đợi như mọi khoản nhập tay
- Tests: [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › thân giao dịch cho vay / nhận lại: cần số tiền và tài khoản, gắn khoản phải thu nếu có, không mang ví"; đồng bộ offline đúng một lần: ⚠ Chưa có test

## Traceability
- Code: `src/routes/v1.ts` › `POST /transactions` (`receivable_id`); `src/domain/entry.ts` › `buildEntry` (nhánh `lend`, `bookOf`, `receivable_only`, `LEND_CATEGORY_ID`); `src/services/ledger.ts` › `loadRefs` (`receivables`), `createEntry`; `src/routes/logs.ts` › `parseSplit`; `src/services/ingest.ts` › `Split.receivable_id`, `splitToEntryInput`; `src/mcp/tools.ts` › `add_transaction`, `assign_log`
- PWA: Loại khác › Cho vay ([UC-705](../pwa/UC-705-nhap-loai-khac.md)); tab Nợ › Cho vay thêm (`web/src/screens/debts.tsx` › `MoneyMoveSheet`, [UC-707](../pwa/UC-707-xem-vi-va-quy.md)); màn Gán ([UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md)); `web/src/lib/receivables.ts` › `moneyMoveBody`, `lendToast`, `defaultReceivableId`
- Migrations/DB: `transactions.receivable_id`, `idx_tx_receivable`, view `v_receivable_balance`, `v_wallet_flow` (loại `lend`) (`migrations/0014_receivables.sql`); danh mục "Cho vay" (`migrations/0002_seed.sql`), mã hệ thống `lending` từ `migrations/0029_system_ids.sql` (trước đó `cho-vay`, ADR-94; hằng `LEND_CATEGORY_ID`)

## Divergences & Open Questions
- [OPEN] Ô **cho ai** không bắt buộc: `lend` không gắn khoản phải thu vẫn ghi được (giữ hành vi cũ), nên tiền cho vay có thể "biến mất" khỏi sổ phải thu nếu người quên chọn — tài khoản vẫn đúng, chỉ sổ ghi nhớ thiếu.
