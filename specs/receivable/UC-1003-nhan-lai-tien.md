# UC-1003: Nhận lại tiền
- Status: implemented
- BR: BR-13, BR-04, BR-01
- Decisions: ADR-72 (meaning `collect` thay cho dùng `refund`: tiền về tài khoản, không cộng ví, không phải thu nhập, không chia), ADR-84 (mua hộ người khác là Cho vay → người ta trả là Nhận lại; trả dư thì phần dư là Thu nhập; Hoàn tiền chỉ cho chia bill có phần mình), luật 6 (`docs/core_design_rules.md` §1 — tiền vào luôn phải hỏi; máy không tự đoán khoản phải thu), D14/ADR-66 (tiền vào tài khoản nối SePay chỉ vào sổ qua gán log), D12 (hàng đợi offline)
- Actor: người trong hộ (PWA: Loại khác › **Nhận lại tiền cho vay**, [UC-705](../pwa/UC-705-nhap-loai-khac.md); màn Gán — log tiền vào, [UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md)); Claude qua MCP `add_transaction`/`assign_log`; script qua REST
- Trigger: `POST /v1/transactions { meaning: "collect", amount, receivable_id?, link_id?, account_id?, at?, note?, client_id? }` ([ledger UC-101](../ledger/UC-101-nhap-tay-khoan-tien.md)); split `{ meaning: "collect", amount, receivable_id?, link_id? }` của `POST /v1/logs/:id/assign` ([ingest UC-305](../ingest/UC-305-gan-log-chua-gan.md))

## History
- v1 (2026-10-01, commit `2438ac0`): meaning mới `collect` (migration 0014 dựng lại `transactions` cho CHECK), nhập tay và gán log; `v_wallet_flow` loại `collect`; đóng vòng `lend` → `refund` làm ví phồng (ADR-72).
- v2 (2026-10-04, commit `c9c6acb`): change [`261004-gan-tham-chieu`](../changes/archive/261004-gan-tham-chieu/proposal.md) — ô **Ai trả** (Loại khác và màn Gán) luôn hiện, có **+ Người mới…** (tạo khoản phải thu số 0 rồi chọn luôn — [UC-1001](UC-1001-them-va-xem-khoan-phai-thu.md) AC-8) và dòng "{tên} còn nợ X · sau khoản này còn Y"; nhận lại làm số phải thu âm (trả dư — thường là mua hộ đã ghi Chi tiêu) thì gợi ý "Nếu đây là mua hộ đã ghi là Chi tiêu, chọn Hoàn tiền thay vì Nhận lại tiền cho vay." Server không đổi.
- v3 (2026-10-05, commit `d7992d1`): change [`261005-lien-ket-khoan-goc`](../changes/archive/261005-lien-ket-khoan-goc/proposal.md) — khoản nhận lại chỉ được **lần cho vay** cụ thể (`link_id` → `lend` còn hiệu lực; bước 2e): ô **Trả cho khoản cho vay** ở Loại khác, màn Gán và sheet **Nhận lại tiền** của tab Nợ (khoản cho vay 180 ngày; Loại khác / màn Gán: của người đang chọn lên trước, chọn thì Ai trả theo người của khoản đó; tab Nợ: chỉ khoản của người đang chọn; "Cho vay X · trả lại Y · còn Z / trả dư Z"); server kế thừa `receivable_id` của khoản cho vay khi không gửi người, khác người → `invalid_link`; MCP `assign_log` cũng nhận `link_id`. Chi tiết khoản cho vay có mục **Đã nhận lại** (tổng, còn thiếu / trả dư / đủ), chi tiết khoản nhận lại có hàng **Trả cho** (pwa UC-715 bước 2b). Số phải thu không đổi cách tính (theo `receivable_id`, không theo `link_id`).
- v4 (2026-10-05, commit `4d6de93`): chủ nhà: "có thể cho vay tiền mặt trả bằng stk hay ngược lại đều được" — đã đúng sẵn (không ràng buộc tài khoản giữa `lend` và `collect`); thêm AC-11 và test giữ hành vi này.
- v5 (2026-10-05, commit `6f5e77a`): chủ nhà báo ô Ai trả ở màn Gán chọn sẵn "nhà bạn · đã trả đủ" khi chưa ai nợ (pwa UC-706 v25): Ai trả chỉ chọn sẵn người **còn nợ** (> 0, nhiều nhất trước) hoặc khoản được mở từ; không ai còn nợ thì không chọn ai — Loại khác / màn Gán đứng ở "không gắn khoản phải thu" (tab Nợ: nút Nhận lại tiền đã tắt khi không ai còn nợ). Tên người mới gõ mà chưa bấm Thêm người thì rời ô là thêm (không mất). AC-12.
- v6 (2026-10-05, commit `ea0d365`): ADR-84 — chủ nhà sửa luật mua hộ: "nó là 2 nghiệp vụ khác nhau mà? 'đổi loại sang Chi tiêu › Thuốc thang' tức là tôi mua cho tôi; đây là tôi mua hộ cho bà Hoa, sau đó bà chị trả lại tiền cho tôi." Gợi ý khi nhận lại vượt số còn nợ (bước 3a) thôi khuyên Hoàn tiền cho mua hộ (v2): nay "Trả dư X? Bấm Tách thêm dòng: Nhận lại đúng số còn nợ, phần dư ghi Thu nhập." (`overpaidHint`; Loại khác: ghi riêng một khoản Thu nhập), Hoàn tiền chỉ cho chia bill nhà mình có phần. AC-13. Đóng [OPEN] "App không nhắc" tách lãi / phần dư. Server không đổi.

## Preconditions
- Khoản phải thu tồn tại và đang bật ([UC-1001](UC-1001-them-va-xem-khoan-phai-thu.md)) — hoặc không gắn khoản nào.
- Nhập tay: tiền về tài khoản **không** nối SePay (tiền mặt, tài khoản nhập tay). Tiền về tài khoản nối SePay thì log tiền vào sẽ về màn Gán — gán ở đó (bước 2a), không nhập tay.

## Main Flow — nhập tay
1. Người chọn **Nhận lại tiền cho vay** (Loại khác) hoặc **Nhận lại tiền** (tab Nợ — card "Người khác nợ mình" hay sheet chi tiết một khoản); nhập **số tiền**, **Tiền vào** (tài khoản chiều vào, mặc định tiền mặt), chọn **Ai trả** — khoản phải thu đang bật ("{tên} · còn X" từ `bootstrap.receivables`, chọn sẵn khoản đang mở hoặc khoản còn phải thu nhiều nhất — `defaultReceivableId`; không ai còn nợ thì không chọn ai; mục đầu "không gắn khoản phải thu"; ở Loại khác thêm mục cuối **+ Người mới…** và dòng còn nợ trước / sau — pwa [UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md) bước 5b), (có mạng, tuỳ chọn) **Trả cho khoản cho vay** (bước 2e; ở tab Nợ chỉ liệt kê khoản cho vay của người ở Ai trả, đổi người là bỏ khoản đã chọn — `LinkSourcePicker onlyReceivable`, thân gửi `link_id` qua `moneyMoveBody`), ngày, ghi chú. Nút "Ghi nhận lại tiền".
2. Server `buildEntry` (ledger UC-101): `receivable_id` chỉ đi với `lend`/`collect` (`receivable_only`); khoản phải có và đang bật (`unknown_receivable`, `inactive_receivable`). Dòng ghi: `counter_account_id` = tài khoản tiền vào (`account_id` gửi lên ?? tài khoản tiền mặt của người nhập), `receivable_id`; **không** ví, **không** danh mục, **không** `taxable`, **không** nguồn thu. D14: tiền vào tài khoản `sepay_enabled = 1` → `fed_account`.
3. Hệ quả — tiền gốc quay về, không phải thu nhập (luật của chủ nhà 2, [README](README.md)):
   - **Tài khoản** tăng đúng số tiền (`v_account_book`); "tiền thật đang có" ([UC-1005](UC-1005-xem-buc-tranh-tien-that.md)) tăng.
   - **Không ví nào** đổi (`v_wallet_flow` loại `collect`): khác `refund` cũ (luôn cộng một ví, làm ví tăng so với trước khi cho vay — ADR-72). Không vào `v_spent_*` (không làm giảm "đã tiêu"), không là `income`, không chia, không đổi "còn để chi tuần này".
   - Còn phải thu giảm đúng số tiền (`v_receivable_balance.collected`); về 0 thì khoản `done`.
4. Trả `{ tx, duplicate, wallet: null }`. Toast PWA: "Đã nhận lại X từ {tên}. Còn Y chưa trả." — đủ hoặc dư thì "… Đã trả đủ." (`collectToast`); không gắn khoản → "Đã ghi khoản nhận lại."

## Main Flow — gán một khoản chuyển khoản tiền vào
2a. Log `in` về (webhook/rà soát), nằm `pending` ở màn Gán. Máy **không** tự gán: tiền vào luôn phải hỏi (rule không sinh `collect`, ingest UC-307 R1), và không đoán khoản phải thu.
2b. Ở sheet gán, log tiền vào có loại **Nhận lại tiền cho vay** (bỏ ví, bỏ danh mục của dòng) với ô **Ai trả** (luôn hiện; **+ Người mới…** tạo người số 0 ngay tại chỗ; dưới ô "{tên} còn nợ X · sau khoản này còn Y" — pwa UC-706 bước 5b); split gửi `{ meaning: "collect", amount, receivable_id }`. Có thể tách log: một phần là tiền trả lại, phần khác là thu nhập.
2c. `POST /v1/logs/:id/assign` → `assignLog` → `splitToEntryInput` → `buildEntry` với cùng luật bước 2; `counter_account_id` = tài khoản của log; dòng mang `log_id`, `source = 'sepay'`. **Không bao giờ** là `income` và **không bao giờ** được chia: PWA chỉ gọi `/v1/allocate` cho giao dịch `income` trả về, và server từ chối chia mọi khoản không phải thu nhập (404 `not_income`), nên dòng `collect` không vào dòng thác Tích sản/Thuế/ví.

## Alternative Flows
- 1a. Không chọn khoản phải thu → `collect` vẫn ghi được: tài khoản tăng, không ví nào đổi, sổ phải thu không đổi.
- 2d. **MCP** `add_transaction { meaning: "collect", amount, receivable_id, link_id?, by_member_id }` / `assign_log` split `collect` (kèm `link_id?`, mcp UC-604 AC-6) — cùng luật, cùng lỗi.
- 2e. **Trả cho khoản cho vay** (`link_id`, tuỳ chọn — Loại khác, màn Gán, tab Nợ › Nhận lại tiền, pwa [UC-705](../pwa/UC-705-nhap-loai-khac.md), [UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md) bước 5e, [UC-707](../pwa/UC-707-xem-vi-va-quy.md)): khoản nhận lại chỉ đúng lần cho vay được trả. Server (`resolveLink`, ledger UC-101 bước 4b): khoản gốc phải là `lend` còn hiệu lực, không thì `invalid_link`; không gửi `receivable_id` thì lấy người của khoản cho vay; gửi người khác → `invalid_link`. Chỉ là liên kết để đọc: còn phải thu vẫn tính theo `receivable_id`. Chi tiết hai khoản thấy nhau (pwa UC-715 bước 2b: "Trả cho khoản cho vay d/m · X ₫" / "Đã nhận lại Y ₫ · còn thiếu Z").
- 3a. Nhận nhiều hơn còn phải thu → còn phải thu âm (người ta trả dư), khoản ở nhóm "Đã trả đủ". Ở ô Ai trả, PWA báo trước "… sau khoản này trả dư Z" kèm gợi ý tách phần dư (`receivableEffect` — `overpaid` là phần dư của riêng lần trả này; `overpaidHint`): màn Gán "Trả dư X? Bấm Tách thêm dòng: Nhận lại đúng số còn nợ, phần dư ghi Thu nhập. Chia bill nhà mình có phần (đã ghi Chi tiêu cả bill) thì chọn Hoàn tiền."; Loại khác "Trả dư X? Ghi Nhận lại đúng số còn nợ, phần dư ghi riêng một khoản Thu nhập. …" (cùng câu cuối). Phần dư là tiền mới của nhà — Thu nhập, được chia (ADR-84).
- 3b. **Offline** (nhập tay): khoản đi qua hàng đợi như khoản cho vay (UC-704); không đổi số ví tạm.
- 3c. Nhận ít hơn số đã cho vay (mua hộ 244.000, người ta trả 240.000): Nhận lại 240.000, còn phải thu 4.000. Xoá phần thiếu bằng **Chỉnh** ([UC-1004](UC-1004-chinh-huy-dong-phai-thu.md)) chỉ sửa sổ nhớ, không thành khoản chi của nhà — xem [OPEN] ở ADR-84.
- 4a. **Huỷ** (ledger UC-102) hay gỡ gán (ingest UC-306) → tài khoản và còn phải thu tự trở lại (luật chung S3).

## Exceptions
- E1. `receivable_id` trên khoản không phải `lend`/`collect` → 400 `receivable_only` (gồm `refund` — đường cũ không còn nhận khoản phải thu).
- E2. Khoản không có / đã tắt → 400 `unknown_receivable` / `inactive_receivable`, không ghi gì (gán log: log vẫn `pending`). `link_id` không phải khoản cho vay còn hiệu lực, hay khác người với `receivable_id` gửi lên → 400 `invalid_link`.
- E3. Nhập tay tiền vào tài khoản nối SePay → 400 `fed_account`.
- E4. Tổng split ≠ số tiền log → 400 `split_mismatch` (UC-305).

## Acceptance Criteria

### AC-1: Nhận lại tiền giảm còn phải thu, tăng tài khoản, không đụng ví
- Given Em Hai mở sổ 2.000.000
- When ghi `collect` 700.000 `receivable_id: "em-hai"`, `account_id: "vcb-husband"`; rồi một `collect` không gửi tài khoản
- Then 201; `tx` có `counter_account_id = "vcb-husband"`, `account_id`/`wallet_id`/`counter_wallet_id`/`category_id` null; `book_balance` của `vcb-husband` +700.000, tài khoản khác không đổi; số dư mọi ví không đổi; `collected` 700.000, còn phải thu 1.300.000; `movements` có `{ kind: "collect", amount: 700000, accountId: "vcb-husband", source: "manual" }`; lần không gửi tài khoản vào `cash-husband`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › collect nâng số dư sổ của tài khoản nhận, không đụng ví nào, trừ số phải thu"; [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › collect không có tài khoản thì vào tiền mặt của người ghi"

### AC-2: Vòng cho vay → nhận lại không làm ví phồng (lỗi cũ `lend` → `refund`)
- Given số dư mọi ví và mọi tài khoản trước khi cho vay
- When `lend` 300.000 từ `vcb-husband` gắn khoản phải thu, rồi `collect` 300.000 về `vcb-husband`
- Then mọi ví và mọi tài khoản về đúng số ban đầu; `lent = collected = 300.000`, còn phải thu 0, `done = true`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "tiền cho vay về không phải thu nhập (ADR-72) › lỗi cũ: cho vay 300.000 rồi nhận lại 300.000 — không ví nào đổi, tài khoản về như cũ, còn phải thu 0"

### AC-3: `collect` không phải thu nhập, không là "đã tiêu", không đổi "còn để chi"
- Given đã chia lương, "còn để chi tuần này" > 0
- When ghi `collect` 1.500.000 rồi gọi `POST /v1/allocate` với khoản đó
- Then snapshot y như trước; `v_spent_week` không đổi; chia bị từ chối 404 `not_income`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "tiền cho vay về không phải thu nhập (ADR-72) › collect không đổi 'còn để chi tuần này', không vào đã tiêu, không chia được như thu nhập — chỉ tiền chi được tăng (tiền thật về tài khoản)"

### AC-4: Gán log tiền vào là nhận lại tiền, không bao giờ là thu nhập
- Given Em Hai mở sổ 3.000.000; log `in` 1.000.000 ở `vcb-husband` `pending`
- When gán `[{ meaning: "collect", amount: 1000000, receivable_id: "em-hai" }]`; rồi gán một log khác thành `refund` kèm `receivable_id`
- Then 201; giao dịch `collect`, `counter_account_id = "vcb-husband"`, không ví, `source = "sepay"`; số dư ví không đổi; không có `income`/`fund` nào; chia → 404 `not_income`; còn phải thu 2.000.000, `movements` có `{ kind: "collect", source: "sepay" }`; lần sau 400 `receivable_only`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền vào là nhận lại tiền cho vay (collect): trừ khoản phải thu, không thành thu nhập, không chia, ví không đổi"

### AC-5: `refund` không còn gắn được khoản phải thu
- Given một khoản phải thu
- When ghi `refund` (và `spend`, `income`, `transfer`) kèm `receivable_id`
- Then 400 `receivable_only`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › receivable_id chỉ gắn với lend / collect: receivable_only, kể cả refund"

### AC-6: Migration 0014 nhận `collect` mà giữ nguyên dữ liệu; `v_wallet_flow` bỏ qua `lend`/`collect`
- Given DB đã chạy tới 0013 có khoản chi gắn log, hoàn tiền, thu nhập đã chia, lần đếm, quyết toán
- When chạy `migrations/0014_receivables.sql`; rồi chèn `lend`/`collect` lỡ mang ví
- Then mọi dòng `transactions` giữ nguyên (thêm `receivable_id = null`), số dư sổ tài khoản, `allocation_runs`, `cash_counts`, `tax_settlements` giữ nguyên, không còn bảng tạm, khoá ngoại/unique/trigger vẫn chặn, CHECK nhận `collect` và từ chối meaning lạ; `v_receivable_balance` cộng `lend`, trừ `collect`, số dư ví không đổi
- Tests: test migration ở repo gốc; [`test/schema.test.ts`](../../test/schema.test.ts) › "chốt chặn toàn vẹn ở tầng DB › receivable_lines chỉ ghi thêm; v_receivable_balance cộng tiền cho vay, trừ tiền nhận lại; ví không đổi"

### AC-7: MCP ghi và gán được `collect`
- Given Em Hai mở sổ 2.000.000
- When `add_transaction { meaning: "collect", amount: 500000, receivable_id: "em-hai", by_member_id: "husband" }`; rồi `assign_log` log `in` 300.000 với split `collect`
- Then không lỗi; `tx` có `counter_account_id = "cash-husband"`, `wallet_id = null`; `get_receivables` trả `totalBalance = 1.200.000`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "sổ phải thu › add_transaction nhận collect + receivable_id; assign_log nhận split collect"

### AC-8: Toast sau khi nhận lại nói còn bao nhiêu chưa trả
- Given Em Hai còn 2.000.000 trong `bootstrap.receivables`
- When ghi Nhận lại tiền cho vay 500.000; hoặc đúng / hơn số còn lại
- Then "Đã nhận lại 500.000 ₫ từ Em Hai. Còn 1.500.000 ₫ chưa trả."; trả đủ hoặc dư → "… Đã trả đủ."
- Tests: [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › toast sau khi nhận lại: còn bao nhiêu chưa trả, hoặc đã trả đủ (trả dư cũng là đủ)"

### AC-9: Nhận lại chỉ đúng lần cho vay; hai khoản thấy nhau
- Given Chị Lan; cho vay 1.000.000 ngày 15/9 gắn Chị Lan; log tiền vào 600.000 đang chờ
- When gán log là Nhận lại tiền cho vay với Trả cho khoản cho vay = khoản 15/9 (không gửi người); mở chi tiết khoản cho vay
- Then giao dịch `collect` có `link_id` = khoản cho vay, `receivable_id` = Chị Lan; Chị Lan còn 400.000; chi tiết khoản cho vay "Đã nhận lại 600.000 ₫ · còn thiếu 400.000 ₫"; gửi kèm người khác → `invalid_link`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › gán log tiền vào là nhận lại có link_id về khoản cho vay: lấy người của khoản cho vay; khác người hay trỏ khoản chi → invalid_link, log vẫn chờ"; [`test/receivables.test.ts`](../../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › nhận lại có link_id về khoản cho vay: không chọn người thì lấy người của khoản cho vay; khác người, trỏ khoản chi hay khoản đã huỷ → invalid_link; sửa giữ liên kết"; [`web/src/lib/refunds.test.ts`](../../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › chi tiết giao dịch: dòng Trả cho nói loại gốc, ngày, số tiền; Đã nhận lại nói tổng và chênh (trả dư / còn thiếu / đủ)"

### AC-10: Nhận lại tiền ở tab Nợ chỉ đúng lần cho vay của người đó
- Given Chị Lan (cho vay 1.000.000 ngày 15/9 "mượn sửa xe") và Em Hai (cho vay 500.000 ngày 20/9)
- When tab Nợ › **Nhận lại tiền**, Ai trả = Chị Lan, số tiền 700.000, Trả cho khoản cho vay = khoản 15/9; đổi Ai trả sang Em Hai rồi về Chị Lan, chọn lại; bấm Ghi
- Then ô chỉ có khoản của người đang chọn (Chị Lan: "15/9 · Chị Lan · mượn sửa xe · 1.000.000 ₫"; Em Hai: "20/9 · Em Hai · 500.000 ₫"); dưới ô "Cho vay 1.000.000 ₫ · trả lại 700.000 ₫ · còn 300.000 ₫"; đổi người thì ô về "không chỉ khoản nào"; thân gửi `link_id` (chỉ cho nhận lại, cho vay thêm không bao giờ gửi), giao dịch `collect` có `link_id` = khoản 15/9, `receivable_id = chi-lan`
- Tests: [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › nhận lại ở tab Nợ chọn khoản cho vay gốc: gửi link_id; cho vay thì không bao giờ gửi (change 261005-lien-ket-khoan-goc)"; ô chọn: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ)

### AC-11: Cho vay và nhận lại có thể khác tài khoản
- Given cho Em Hai vay 500.000 bằng **tiền mặt** (`lend`, `account_id = cash-husband`)
- When Em Hai trả 500.000 vào **tài khoản ngân hàng** (`collect`, `account_id = vcb-husband`, `link_id` = khoản cho vay)
- Then ghi được, liên kết giữ nguyên, Em Hai còn nợ 0; tiền mặt −500.000, ngân hàng +500.000 — sổ phải thu theo người, không theo tài khoản (chiều ngược lại cũng vậy)
- Tests: `test/receivables.test.ts` › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › cho vay và nhận lại khác tài khoản (tiền mặt ↔ ngân hàng) vẫn nối được; số phải thu và số dư từng tài khoản đúng"

### AC-12: Ai trả chỉ chọn sẵn người còn nợ
- Given nhà bạn 0 (đã trả đủ), Em Tú còn 300.000, Em trai còn 5.000.000, Chị Lan −250.000 (trả dư)
- When mở Nhận lại tiền cho vay (Loại khác, màn Gán, tab Nợ › Nhận lại tiền) không từ khoản nào; mở từ nhà bạn; khi chỉ còn nhà bạn và Chị Lan
- Then chọn sẵn lần lượt Em trai; nhà bạn (khoản được mở từ, kể cả đã trả đủ); không ai — Loại khác / màn Gán đứng ở "không gắn khoản phải thu"
- Tests: [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › chọn sẵn khoản được mở từ, không thì khoản còn phải thu nhiều nhất; ai cũng đã trả đủ thì không chọn ai; bootstrap cũ không có trường thì null"; ô chọn: ⚠ Chưa có test (repo chưa có test giao diện; Loại khác và màn Gán đã xem tận mắt ở 390px, `wrangler dev` cục bộ)

### AC-13: Mua hộ trả dư: Nhận lại đúng số còn nợ, phần dư là Thu nhập (ADR-84)
- Given mua hộ Chị Lan 244.000 đã gán là Cho vay (Chị Lan còn nợ 244.000); log tiền vào 250.000 "CHI LAN TRA TIEN THUOC" đang chờ
- When ở màn Gán chọn Nhận lại tiền cho vay, Ai trả = Chị Lan (chưa tách); rồi bấm Tách thêm dòng: dòng 1 Nhận lại 244.000 chỉ khoản cho vay đó, dòng 2 Thu nhập 6.000; bấm Gán, chia khoản thu
- Then trước khi tách: dưới ô "Chị Lan còn nợ 244.000 ₫ · sau khoản này trả dư 6.000 ₫" kèm "Trả dư 6.000 ₫? Bấm Tách thêm dòng: Nhận lại đúng số còn nợ, phần dư ghi Thu nhập. Chia bill nhà mình có phần (đã ghi Chi tiêu cả bill) thì chọn Hoàn tiền." (Loại khác: "Ghi Nhận lại đúng số còn nợ, phần dư ghi riêng một khoản Thu nhập."); sau khi gán: `collect` 244.000 (`link_id` = khoản cho vay, `receivable_id` = Chị Lan) và `income` 6.000; Chị Lan còn 0; không có khoản chi / hoàn tiền nào; khoản thu 6.000 chia được
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › mua hộ là cho vay (ADR-84): trả dư thì tách Nhận lại đúng số còn nợ + Thu nhập phần dư — hết nợ, phần dư chia được, chi tiêu không đổi" (server); [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › dòng dưới ô Ai trả / Cho ai vay: còn nợ trước và sau khoản này; nhận lại vượt số còn nợ thì báo phần dư của lần trả này"; [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › trả dư: nhận lại đúng số còn nợ, phần dư là Thu nhập (màn Gán tách dòng, Loại khác ghi riêng); Hoàn tiền chỉ cho chia bill có phần mình (ADR-84)"; dòng gợi ý trong sheet: ⚠ Chưa có test (repo chưa có test giao diện)

## Traceability
- Code: `src/domain/entry.ts` › `MANUAL_MEANINGS` (`collect`), `buildEntry` (nhánh `collect`, `link_id`); `src/services/ledger.ts` › `createEntry` (D14 chiều vào), `resolveLink`; `src/routes/logs.ts` › `SPLIT_MEANINGS`, `parseSplit`; `src/services/ingest.ts` › `SplitMeaning`, `assignLog`, `splitToEntryInput`; `src/mcp/tools.ts` › `add_transaction`, `assign_log`
- PWA: Loại khác › Nhận lại tiền cho vay ([UC-705](../pwa/UC-705-nhap-loai-khac.md)); tab Nợ › Nhận lại tiền (`web/src/screens/debts.tsx` › `MoneyMoveSheet`, [UC-707](../pwa/UC-707-xem-vi-va-quy.md)); màn Gán ([UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md)); ô Trả cho khoản cho vay (`web/src/screens/ref-pickers.tsx` › `LinkSourcePicker`); ô Ai trả (`ReceivablePicker`, `split`); chi tiết giao dịch ([UC-715](../pwa/UC-715-xem-sua-xoa-giao-dich.md)); `web/src/lib/receivables.ts` › `moneyMoveBody`, `collectToast`, `unpaidText`, `defaultReceivableId`, `receivableEffect`, `overpaidHint`
- Migrations/DB: CHECK `transactions.meaning` (thêm `collect`), `transactions.receivable_id`, `v_wallet_flow` (loại `collect`), `v_receivable_balance` (`migrations/0014_receivables.sql`)

## Divergences & Open Questions
- Đã đóng (2026-10-05, ADR-84): Lãi / phần người ta trả thêm (nhận nhiều hơn số còn nợ) ghi cả cục là `collect` thì phần dư không bao giờ thành thu nhập — trước đây app không nhắc. Nay ô Ai trả báo "Trả dư X?" và chỉ cách tách `collect` (đúng số còn nợ) + `income` (phần dư) (`overpaidHint`, AC-13). App vẫn không tự tách: người gán bấm Tách thêm dòng.
