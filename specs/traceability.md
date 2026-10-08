# Traceability — UC ↔ AC ↔ Test

> Sinh tự động từ các file `specs/*/UC-*.md` (dòng `- Tests:` dưới mỗi AC). Đừng sửa tay — sửa UC rồi sinh lại.
> Mọi tên test ở đây đã được kiểm là có thật trong file test (2026-10-03).

| Context | UC | AC | Có test | ⚠ Chưa có test |
|---|---|---|---|---|
| ledger | 11 | 118 | 94 | 24 |
| allocation | 7 | 57 | 46 | 11 |
| ingest | 8 | 112 | 105 | 7 |
| notify | 11 | 122 | 110 | 12 |
| access | 10 | 117 | 109 | 8 |
| mcp | 5 | 39 | 24 | 15 |
| pwa | 16 | 239 | 123 | 116 |
| rental | 5 | 39 | 29 | 10 |
| debt | 4 | 26 | 23 | 3 |
| receivable | 5 | 39 | 34 | 5 |
| **Tổng** | **82** | **908** | **697** | **211** |

## Sổ cái (ledger)

### [UC-101](ledger/UC-101-nhap-tay-khoan-tien.md) Nhập tay một khoản tiền
Status: `implemented` · BR: BR-03, BR-04, BR-01

| AC | Test |
|---|---|
| ✅ AC-1: Chi tiền mặt 3 chạm — ví theo danh mục, TK tiền mặt của người nhập, trả ví còn bao nhiêu | `test/api.test.ts` › "nhập tay › chi tiền mặt: ví tự điền từ danh mục, tài khoản mặc định là tiền mặt của người nhập, trả về ví còn bao nhiêu"; qua MCP: `test/mcp.test.ts` › "add_transaction › \"chi 200k xăng tiền mặt\" → ghi vào ví đi-lai, tài khoản tiền mặt của người ghi" |
| ✅ AC-2: Danh mục trỏ về ví cá nhân người khác → đổi sang ví của người nhập | `test/api.test.ts` › "nhập tay › vợ chọn danh mục trỏ về ví Chơi của chồng → tự đổi sang ví Chơi của vợ" |
| ✅ AC-3: Gửi lại cùng `client_id` chỉ ghi một lần (D12) | `test/api.test.ts` › "nhập tay › gửi lại cùng client_id (hàng đợi offline) chỉ ghi một lần" |
| ⚠ AC-4: Hai lần gửi cùng `client_id` song song vẫn chỉ một dòng | ⚠ Chưa có test |
| ✅ AC-5: Từ chối đầu vào sai, không ghi gì | `test/api.test.ts` › "nhập tay › từ chối đầu vào sai: %j → %s" |
| ✅ AC-6: Không nhập tay trên tài khoản có feed (D14) | `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › nhập tay khoản chi bằng tài khoản đã nối feed → từ chối, hướng sang màn Gán" |
| ✅ AC-7: Rút ATM là chuyển nội bộ — không đổi ví, chỉ đổi nơi tiền nằm | `test/api.test.ts` › "nhập tay › rút ATM là chuyển nội bộ: không đổi số dư ví, chỉ đổi tiền nằm ở đâu" |
| ⚠ AC-8: Hoàn tiền giảm "đã tiêu" và cộng lại ví | ⚠ Chưa có test (red-team đã kiểm bằng PoC — `plans/reports/redteam-260922-0100-money-correctness.md` "Thuộc tính đã kiểm chứng") |
| ⚠ AC-9: Mua tài sản chỉ đổi trạng thái tiền trong Tích sản | ⚠ Chưa có test (chỉ có nhánh `insufficient_cash` ở AC-5; red-team kiểm bằng PoC) |
| ✅ AC-10: Cho vay không đụng ví | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › cho vay thêm (lend gắn khoản phải thu) tăng số phải thu, trừ tài khoản, không trừ ví, danh mục mặc định Cho vay" |
| ✅ AC-11: Kỳ của khoản nhập tính theo giờ Việt Nam, tuần ISO | `test/period.test.ts` › "kỳ theo giờ Việt Nam › 23:30 UTC đã là ngày hôm sau ở VN"; `test/period.test.ts` › "tuần ISO › %s → %s" |
| ✅ AC-12: Tiền người thuê tự gắn nguồn cho thuê; trả nợ chi thẳng từ ví giữ riêng | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; qua MCP: `test/mcp.test.ts` › "add_transaction › income kèm tenant_id → gắn người thuê, tự lấy nguồn thu cho thuê" |
| ✅ AC-13: Nguồn thu chọn tay được lưu trên khoản thu; chỉ khoản thu nhập mới gắn được nguồn / người thuê | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối" |
| ✅ AC-14: Chuyển ngân sách giữa hai ví — chỉ đổi số dư ví, tài khoản không đổi, báo ví nhận | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › chuyển ngân sách giữa hai ví: chỉ đổi số dư ví, tài khoản không đổi; báo ví nhận" |
| ✅ AC-15: Chuyển ngân sách sai bị từ chối | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › chuyển ngân sách sai: %j → %s" |
| ⚠ AC-16: Người thuê đã ngừng hoặc nguồn thu đã tắt thì không ghi được khoản thu | ⚠ Chưa có test |
| ✅ AC-17: Nhà dùng chung một ví tiền mặt | `web/src/lib/categories.test.ts` › "tài khoản nhập tay được › nhà dùng chung một ví tiền mặt (không gắn chủ) thì ai nhập cũng mặc định vào ví đó, không rơi sang ngân hàng" (PWA dùng chính `cashAccountOf` của `src/domain/entry.ts`) |
| ✅ AC-18: Tài khoản SePay chỉ báo tiền vào — khoản chi nhập tay được, tiền vào thì không (ADR-66) | `test/ingest-integrity.test.ts` › "D14 theo chiều tiền (ADR-66): MB nối SePay, chỉ báo tiền vào › nhập tay khoản chi trả bằng MB được — SePay không báo tiền ra nên không đếm hai lần"; `test/ingest-integrity.test.ts` › "D14 theo chiều tiền (ADR-66): MB nối SePay, chỉ báo tiền vào › nhập tay tiền vào MB (thu nhập, hoàn tiền, chuyển vào) → từ chối fed_account" |
| ✅ AC-19: Bật "SePay báo cả tiền ra" thì khoản chi từ tài khoản đó bị chặn | `test/ingest-integrity.test.ts` › "D14 theo chiều tiền (ADR-66): MB nối SePay, chỉ báo tiền vào › chủ nhà bật 'SePay báo cả tiền ra' (sepay_out = 1) → khoản chi trả bằng MB bị từ chối fed_account" |
| ✅ AC-20: Trả nợ: khoản chi nhận `debt_id`, mặc định danh mục `debt-payment`; gắn sai thì bị từ chối | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › trả nợ không chọn danh mục thì lấy danh mục debt-payment"; [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › debt_id chỉ gắn với khoản chi: debt_spend_only"; [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › debt_id không có hoặc đã tắt: unknown_debt, inactive_debt" |
| ✅ AC-21: Nhận lại tiền cho vay (`collect`): tài khoản tăng, không ví nào đổi, không phải thu nhập; `receivable_id` chỉ trên `lend`/`collect` | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › collect nâng số dư sổ của tài khoản nhận, không đụng ví nào, trừ số phải thu"; [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › collect không có tài khoản thì vào tiền mặt của người ghi"; [`test/receivables.test.ts`](../test/receivables.test.ts) › "tiền cho vay về không phải thu nhập (ADR-72) › lỗi cũ: cho vay 300.000 rồi nhận lại 300.000 — không ví nào đổi, tài khoản về như cũ, còn phải thu 0"; [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › receivable_id chỉ gắn với lend / collect: receivable_only, kể cả refund" |
| ✅ AC-22: Không ghi giao dịch trước ngày mở sổ của tài khoản (ADR-76) | `test/api.test.ts` › "số dư đầu là mốc: không ghi giao dịch trước ngày mở sổ (ADR-76) › nhập tay ngày trước mốc (theo giờ VN) → 400 before_opening, sổ không đổi; đúng ngày mở sổ thì ghi được"; `test/api.test.ts` › "số dư đầu là mốc: không ghi giao dịch trước ngày mở sổ (ADR-76) › tài khoản ở đầu nhận của chuyển khoản cũng bị chặn; sửa một khoản sang ngày trước mốc cũng bị chặn"; `test/api.test.ts` › "số dư đầu là mốc: không ghi giao dịch trước ngày mở sổ (ADR-76) › tài khoản không có ngày mở sổ và chuyển ngân sách giữa hai ví (không chạm tài khoản) không bị chặn" |
| ✅ AC-23: Nhận lại tiền cho vay chỉ đúng khoản cho vay gốc (`link_id`) | [`test/receivables.test.ts`](../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › nhận lại có link_id về khoản cho vay: không chọn người thì lấy người của khoản cho vay; khác người, trỏ khoản chi hay khoản đã huỷ → invalid_link; sửa giữ liên kết" |
| ✅ AC-24: Chuyển vào tài khoản Tích sản từ tài khoản thường là bỏ tiền vào Tích sản (ADR-88) | [`test/buffer.test.ts`](../test/buffer.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › từ tài khoản thường vào phao, không chọn ví: ví Có thì tốt → Tích sản; rút ra, phao → sổ, sổ → tài khoản thường: chỉ đổi chỗ; chọn ví thì theo ví đã chọn" |

### [UC-102](ledger/UC-102-huy-giao-dich.md) Huỷ / sửa giao dịch ghi tay
Status: `implemented` · BR: BR-04, BR-02, BR-03

| AC | Test |
|---|---|
| ✅ AC-1: Huỷ là đổi trạng thái, không xoá; huỷ lần hai báo lỗi | `test/api.test.ts` › "nhập tay › huỷ giao dịch là đổi trạng thái, không xoá; huỷ lần hai báo lỗi" |
| ✅ AC-2: Huỷ khoản thu đã chia gỡ luôn lần chia | `test/api.test.ts` › "chia lương end-to-end › huỷ khoản thu đã chia thì gỡ luôn lần chia: ví về như cũ, lệnh chuyển chưa làm bị bỏ, không chia lại được" |
| ✅ AC-3: Tiền của lần chia đã chuyển thật → không huỷ được khoản thu | `test/api.test.ts` › "chia lương end-to-end › tiền của lần chia đã chuyển thật thì không huỷ khoản thu được" |
| ✅ AC-4: Đua với "Đã chuyển" — DB chặn cả batch | `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › người kia bấm 'Đã chuyển' đúng lúc đang gỡ lần chia → huỷ bị từ chối, sổ giữ nguyên" |
| ✅ AC-5: Không huỷ / sửa lẻ bút toán hệ thống | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › không sửa / xoá lẻ bút toán hệ thống (fund của lần chia) → system_tx" (chốt tháng `S…` / quyết toán `T…` đi cùng nhánh `source='system'`: ⚠ Chưa có test riêng) |
| ✅ AC-6: Xoá khoản chi ghi tay trả lại tiền cho ví | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › xoá khoản chi ghi tay: dòng thành void, ví được trả lại tiền" |
| ✅ AC-7: Giao dịch ngân hàng không huỷ được ở sổ cái — chỉ gỡ gán | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › giao dịch từ ngân hàng không xoá được ở sổ cái (bank_tx), log vẫn đã gán; gỡ gán thì được" |
| ✅ AC-8: Sửa khoản chi trong một lần — số tiền, danh mục, ví | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa khoản chi: đổi số tiền, danh mục, ví trong một lần — khoản cũ void, khoản mới active, số dư ví đúng" |
| ✅ AC-9: Khoản mới sai thì khoản cũ còn nguyên | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa bằng dữ liệu mới sai → từ chối, khoản cũ còn nguyên: %j → %s" |
| ✅ AC-10: Không sửa được giao dịch ngân hàng | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa giao dịch từ ngân hàng → bank_tx, không ghi gì mới" |
| ✅ AC-11: Sửa khoản thu đã chia — gỡ lần chia cũ, khoản mới chưa chia | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa khoản thu đã chia: gỡ lần chia cũ, khoản thu mới chưa chia và chia lại được" |
| ✅ AC-12: Sửa khoản thu bị chặn khi tiền của lần chia đã chuyển thật | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa khoản thu mà tiền của lần chia đã chuyển thật → allocation_settled, sổ giữ nguyên" |
| ✅ AC-13: Gửi lại cùng `client_id` khi sửa chỉ ghi một lần | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › gửi lại cùng client_id khi sửa chỉ ghi một lần" |
| ✅ AC-14: Sửa giữ chỗ gắn sổ nợ, sổ phải thu, người thuê — kể cả khi đối tác đã tắt | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa giữ chỗ gắn sổ nợ, sổ phải thu, người thuê — kể cả khi khoản đó đã tắt" |
| ✅ AC-15: Sửa giữ người ghi | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa giữ người ghi là người ghi khoản cũ" |
| ✅ AC-16: Điều chỉnh sau đếm ví chỉ xoá được | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › khoản điều chỉnh sau đếm ví chỉ xoá được, không sửa (not_editable)" |
| ✅ AC-17: Sửa khoản gốc kéo theo khoản trả về; đổi loại hay đổi người thì bị chặn; huỷ thì liên kết giữ | [`test/receivables.test.ts`](../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › sửa khoản gốc: khoản trả về trỏ sang khoản mới; đổi loại hay đổi người của khoản gốc thì invalid_link, không đổi gì; xoá khoản gốc thì liên kết giữ, khoản gốc hiện đã xoá" |
| ✅ AC-18: Huỷ và sửa ghi nhật ký ai làm, qua đâu; lỗi thì không ghi (ADR-90) | `test/audit.test.ts` › "nhật ký thay đổi › huỷ, sửa, gỡ gán giao dịch đều ghi một dòng: ai, qua đâu, giao dịch nào" |

### [UC-103](ledger/UC-103-xem-con-bao-nhieu-de-chi.md) Xem "còn bao nhiêu để chi" (snapshot)
Status: `implemented` · BR: BR-01, BR-05, BR-07, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Sau khi chia lương và chi, "còn để chi" và phe Tích sản đúng | `test/api.test.ts` › "chia lương end-to-end › snapshot: còn để chi tuần này và phe Tích sản ra đúng sau khi chia + chi" |
| ✅ AC-2: MCP trả đúng số như REST | `test/mcp.test.ts` › "tool đọc số liệu › get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB" |
| ✅ AC-3: Ví không có mức tuần chia đều theo số tuần còn lại | gián tiếp — `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví nhận phần dư (không có mức tuần) cũng khớp công thức chia theo tuần còn lại"; `test/period.test.ts` › "tuần → tháng › số tuần còn lại tính cả tuần đang chạy" |
| ✅ AC-4: Ví riêng tư của người khác: hiện tên, ẩn số | gián tiếp — `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví riêng tư của người kia không bị đụng (không có số để trừ)" |
| ⚠ AC-5: Ví tiêu lố kéo tổng xuống | ⚠ Chưa có test |
| ✅ AC-6: Chỉ báo lệch khi lệch thật | `test/logs.test.ts` › "lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán (ledger UC-103, UC-106 — ADR-87) › snapshot và /v1/accounts: lệch khi bookDrift ≠ 0; log chưa gán (bookDrift 0) và tài khoản không có log (null) không lệch; không còn số ngân hàng báo" |
| ✅ AC-7: Phong bì tháng chia theo tuần — dự kiến tuần = tháng ÷ số thứ Hai, "còn để chi" dùng dự kiến tuần | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › phong bì tháng chia theo tuần: dự kiến tuần = tháng ÷ số thứ Hai, còn để chi dùng dự kiến tuần"; thứ Hai đầu tuần: `test/period.test.ts` › "tuần ISO › thứ Hai của %s là %s" |
| ✅ AC-8: Ví giữ riêng nằm ở `reserves`, không vào "còn để chi" | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó" |
| ⚠ AC-9: Nhập tay vào phong bì chia theo tuần trả "tuần còn" theo dự kiến tuần | ⚠ Chưa có test |
| ✅ AC-10: Bỏ heo đất — tiền vào Tích sản, "còn để chi" chỉ giảm ở Có thì tốt, Quỹ an tâm tăng đúng số tiền (ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › tài khoản SePay báo cả tiền ra: tự gán chuyển nội bộ sang heo của chính chủ, ví Có thì tốt → Tích sản — không phải chi tiêu" |
| ✅ AC-11: Đếm khoản thu chưa chia — bỏ khoản đã chia và khoản đã huỷ, chỉ ra khoản cũ nhất | [`test/logs.test.ts`](../test/logs.test.ts) › "gán thu nhập, để chia sau (pwa UC-706, ledger UC-103) › snapshot đếm khoản thu chưa chia: bỏ khoản đã chia và khoản đã huỷ, khoản cũ nhất trước"; [`test/logs.test.ts`](../test/logs.test.ts) › "gán thu nhập, để chia sau (pwa UC-706, ledger UC-103) › gán mà không gọi /v1/allocate: khoản thu nằm ở ví Thu nhập, chưa chia, còn để chi không đổi; chia sau vẫn được" |
| ✅ AC-12: Tiền chi được = tài khoản đang tính − Tích sản đang giữ − Thuế đang giữ (ADR-85) | [`test/spendable-cash.test.ts`](../test/spendable-cash.test.ts) › "tiền chi được — snapshot và công tắc tài khoản › GET /v1/snapshot: Σ số dư sổ tài khoản đang tính − Tích sản đang giữ − Thuế đang giữ" |
| ✅ AC-13: Tắt một tài khoản thì tiền chi được giảm đúng số dư của nó | [`test/spendable-cash.test.ts`](../test/spendable-cash.test.ts) › "tiền chi được — snapshot và công tắc tài khoản › tắt Tính vào tiền chi được của một tài khoản: số giảm đúng số dư của nó, tài khoản sang danh sách không tính; bật lại như cũ" |
| ✅ AC-14: Bỏ heo đất không trừ hai lần (ADR-82, ADR-85, ADR-88) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "tiền chi được: heo đất không tính, phần Tích sản ở heo không trừ lại (ADR-85) › bỏ heo 12.000: tiền chi được giảm đúng 12.000 (tiền rời tài khoản chi tiêu), không phải 24.000; heo ở danh sách không tính" |
| ✅ AC-15: Công thức ở biên — heo nhiều hơn Tích sản, số âm, không tài khoản nào tính | [`test/spendable-cash.test.ts`](../test/spendable-cash.test.ts) › "tiền chi được — công thức (hàm thuần) › cộng tài khoản đang tính, trừ Tích sản ngoài heo và Thuế; heo và tài khoản tắt nằm ở danh sách không tính"; [`test/spendable-cash.test.ts`](../test/spendable-cash.test.ts) › "tiền chi được — công thức (hàm thuần) › heo nhiều hơn Tích sản: không trừ Tích sản; tài khoản khóa không bao giờ tính dù cột bật; Tích sản / Thuế âm không cộng ngược"; [`test/spendable-cash.test.ts`](../test/spendable-cash.test.ts) › "tiền chi được — công thức (hàm thuần) › không có tài khoản nào đang tính: âm đúng bằng phần phải giữ" |
| ✅ AC-16: Phao và sổ tiết kiệm — tiền vào Tích sản một lần, gửi / tất toán chỉ đổi chỗ (ADR-88) | [`test/buffer.test.ts`](../test/buffer.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › DB mới: chuyển 1.000.000 vào phao → Tích sản +1.000.000, Tiền chi được −1.000.000 một lần; gửi 800.000 phao → sổ không đổi gì; tất toán 820.000 (20.000 lãi là Thu nhập) → Tích sản về phao" |
| ✅ AC-17: Chỉ tài khoản Tích sản không tính là chỗ giữ Tích sản (ADR-88) | [`test/spendable-cash.test.ts`](../test/spendable-cash.test.ts) › "tiền chi được — công thức (hàm thuần) › phao và sổ tiết kiệm không tính giữ Tích sản như heo (ADR-88); tài khoản thường tắt công tắc hay thẻ tín dụng thì không — sổ không biết tiền trong đó là gì" |

### [UC-104](ledger/UC-104-ngan-sach-theo-ky.md) Ngân sách theo kỳ (dự kiến / thực tế / còn lại)
Status: `implemented` · BR: BR-01, BR-05

| AC | Test |
|---|---|
| ✅ AC-1: Phong bì tuần tính theo số thứ Hai thật của tháng | `test/api.test.ts` › "chia lương end-to-end › ngân sách tháng: phong bì tuần tính theo số thứ Hai thật"; `test/period.test.ts` › "tuần → tháng › đếm số thứ Hai thật của tháng" |
| ✅ AC-2: Ngân sách tuần chỉ tính khoản của đúng tuần đó, trừ hoàn tiền | gián tiếp — `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › đã tiêu/dự kiến từng ví phong bì tuần + top 5 danh mục (spend trừ refund), loại tuần khác" |
| ⚠ AC-3: Dự kiến tháng của Có thì tốt = phần đã được chia trong tháng | ⚠ Chưa có test |
| ✅ AC-4: Không trả bảng rỗng đầu tuần | `test/schema.test.ts` › "migrations › đã bỏ hai view ngân sách mù kỳ"; gián tiếp — `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › tuần không có chi tiêu: vẫn hiện các ví phong bì (0 đồng), không có mục top 5" |
| ✅ AC-5: Kỳ tuần của phong bì tháng chia theo tuần | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › phong bì tháng chia theo tuần: dự kiến tuần = tháng ÷ số thứ Hai, còn để chi dùng dự kiến tuần"; `test/period.test.ts` › "tuần ISO › thứ Hai của %s là %s" |
| ✅ AC-6: Ví giữ riêng không nằm trong bảng ngân sách | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó" |
| ⚠ AC-7: Ví âm vẫn có dòng dù không có dự kiến, không có chi | ⚠ Chưa có test |

### [UC-105](ledger/UC-105-dem-so-du-dieu-chinh.md) Đếm số dư tài khoản → bút toán điều chỉnh
Status: `implemented` · BR: BR-04, BR-07

| AC | Test |
|---|---|
| ✅ AC-1: Đếm lệch → một bút toán điều chỉnh vào Có thì tốt, sổ khớp tiền thật | `test/api.test.ts` › "chia lương end-to-end › đếm ví lệch → một bút toán điều chỉnh vào Có-thì-tốt, sổ khớp tiền thật" |
| ✅ AC-2: TK có feed còn log chưa gán → từ chối, không sinh điều chỉnh | `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › đếm số dư tài khoản có bank feed khi còn log chưa gán → từ chối (không sinh bút toán điều chỉnh)" |
| ⚠ AC-3: Đếm khớp vẫn ghi lần đếm, không sinh bút toán | ⚠ Chưa có test |
| ⚠ AC-4: Tiền thật nhiều hơn sổ → cộng Có thì tốt | ⚠ Chưa có test |

### [UC-106](ledger/UC-106-doi-soat-tai-khoan.md) Đối soát tài khoản
Status: `implemented` · BR: BR-04, BR-01, BR-05

| AC | Test |
|---|---|
| ✅ AC-1: Log chưa gán hiện là "chưa gán", không phải lệch | `test/schema.test.ts` › "đối soát › log chưa gán hiện là 'chưa gán', không phải lệch" |
| ✅ AC-2: Log đã gán mà sổ diễn giải thiếu tiền → `book_drift` lộ ra | `test/schema.test.ts` › "đối soát › log đã gán mà sổ diễn giải thiếu tiền thì book_drift lộ ra" |
| ⚠ AC-3: Ngân hàng báo số dư khác tổng log → `feed_drift` lộ ra (deprecated v6: ADR-87 — không còn so với số SePay báo) | ⚠ Chưa có test |
| ✅ AC-4: Tài khoản không có feed không bị tính lệch | `test/schema.test.ts` › "đối soát › tài khoản không có feed (tiền mặt) không bị tính book_drift" |
| ✅ AC-5: Kênh khác đọc cùng một nguồn | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › đối soát lệch dùng ledger.reconcile(): sổ diễn giải khác giao dịch ngân hàng đã gán" |
| ⚠ AC-5b: Số lũy kế âm không phải số dư ngân hàng (deprecated v6: ADR-87 — `v_account_bank` không còn, mọi số lũy kế đều bỏ) | ⚠ Chưa có test |
| ⚠ AC-6: `GET /v1/accounts` trả kèm lần đếm gần nhất | ⚠ Chưa có test |
| ✅ AC-7: Số lũy kế SePay sai không làm lệch | `test/webhooks.test.ts` › "nối trọn: webhook → rule mã → transaction › số lũy kế SePay gửi kèm sai hẳn số dư thật → không lưu, không báo lệch đối soát ở đâu cả (ADR-87)"; `test/logs.test.ts` › "lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán (ledger UC-103, UC-106 — ADR-87) › snapshot và /v1/accounts: lệch khi bookDrift ≠ 0; log chưa gán (bookDrift 0) và tài khoản không có log (null) không lệch; không còn số ngân hàng báo"; `test/migrations/milestones.test.ts` › "migrations › 0023 bỏ số lũy kế SePay trên DB đang có log: log và bản thô giữ nguyên, view đối soát chạy lại (ADR-87)" |

### [UC-107](ledger/UC-107-theo-doi-tich-luy.md) Theo dõi tích lũy — Tích sản cash/assets, Quỹ an tâm, quỹ mục tiêu
Status: `implemented` · BR: BR-07, BR-01, BR-05

| AC | Test |
|---|---|
| ✅ AC-1: Quỹ an tâm không báo đầy khi mới có vài khoản chi của tháng đang chạy | `test/schema.test.ts` › "phao khẩn cấp › không báo đầy khi mới có vài khoản chi của tháng đang chạy" |
| ✅ AC-2: Đủ 3 tháng trọn → target = số tháng × chi Must trung bình, không tính Có thì tốt | `test/schema.test.ts` › "phao khẩn cấp › đủ 3 tháng trọn thì target = số tháng × chi Must trung bình, không tính nhóm Have" |
| ⚠ AC-3: Mua tài sản chuyển cash → assets, tổng không đổi | ⚠ Chưa có test |
| ⚠ AC-4: Tiến độ quỹ mục tiêu | ⚠ Chưa có test |
| ✅ AC-5: Snapshot ước Quỹ an tâm khi chưa đủ dữ liệu | `test/api.test.ts` › "chia lương end-to-end › snapshot: còn để chi tuần này và phe Tích sản ra đúng sau khi chia + chi" |
| ✅ AC-6: `GET /v1/wealth-building` — bỏ heo theo từng heo, chia từ thu nhập, mua vàng; đường cũ không còn | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "GET /v1/wealth-building: Tích sản theo loại, chỗ nằm, nguồn (ADR-86) › bỏ heo theo từng heo, chia từ thu nhập, mua vàng: cùng số với snapshot; vào − ra = tiền"; [`test/api.test.ts`](../test/api.test.ts) › "chia lương end-to-end › GET /v1/wealth-building: cùng số Tích sản với snapshot, nguồn chia lương là 'fund'; đường cũ → 404" |
| ✅ AC-7: Số dư ví Heo đất cũ, chốt tháng, chuyển ngân sách tay là ba nguồn riêng | `test/migrations/piggy-bank.test.ts` › "GET /v1/wealth-building trên DB như prod › số dư ví Heo đất cũ (migration 0020), chốt tháng quét dư, chuyển ngân sách tay: ba nhóm riêng, ví đã tắt được đánh dấu" |
| ✅ AC-8: Log heo chờ gán đếm vào đúng heo, số theo phía heo | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "GET /v1/wealth-building: Tích sản theo loại, chỗ nằm, nguồn (ADR-86) › log heo còn chờ gán: đếm vào đúng heo của chủ tài khoản, số theo phía heo (rút heo âm)" |
| ✅ AC-9: Phao và sổ tiết kiệm ở chỗ nằm; chuyển vào phao là một nguồn (ADR-88) | [`test/buffer.test.ts`](../test/buffer.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › DB mới: chuyển 1.000.000 vào phao → Tích sản +1.000.000, Tiền chi được −1.000.000 một lần; gửi 800.000 phao → sổ không đổi gì; tất toán 820.000 (20.000 lãi là Thu nhập) → Tích sản về phao" |
| ✅ AC-10: Migration 0027 — số dư có sẵn còn trong heo / phao vào Tích sản một lần (ADR-91) | `test/migrations/piggy-bank.test.ts` › "migration 0027: số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91) › như prod 6/10: heo + phao 136.364, Tích sản 76.300 → một bút toán hệ thống 60.064 chỉ ghi có ví Tích sản; Có thì tốt, sổ tài khoản, Tiền chi được không đổi; chạy lại không ghi thêm"; `test/migrations/piggy-bank.test.ts` › "migration 0027: số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91) › DB seed mẫu và nhà chưa có số dư có sẵn: không ghi gì" |
| ✅ AC-11: Migration 0028 — tên tiếng Anh trong dữ liệu, số liệu giữ nguyên (ADR-92) | `test/migrations/piggy-bank.test.ts` › "migration 0028: tên tiếng Anh trong dữ liệu › DB như prod tới 0027 có đủ loại cũ: tier / role / khoá config đổi tên; số dòng, số dư, Tích sản, Quỹ an tâm, sổ tài khoản giữ nguyên; khoá ngoại sạch" |
| ✅ AC-12: DB mới chỉ nhận giá trị tiếng Anh (ADR-92) | [`test/schema.test.ts`](../test/schema.test.ts) › "migrations › 0028 DB mới: CHECK tier là holding | wealth_building | tax | nice | must, role là piggy_bank | buffer | term_deposit theo locked; giá trị cũ bị từ chối" |

### [UC-108](ledger/UC-108-chi-theo-danh-muc.md) Chi theo danh mục (so với tháng trước)
Status: `implemented` · BR: BR-01, BR-05

| AC | Test |
|---|---|
| ⚠ AC-1: Chi ròng theo danh mục, có cột tháng trước | ⚠ Chưa có test |
| ⚠ AC-2: Tháng 1 so với tháng 12 năm trước | ⚠ Chưa có test |
| ⚠ AC-3: Kỳ sai dạng bị từ chối | ⚠ Chưa có test |

### [UC-109](ledger/UC-109-quan-ly-danh-muc.md) Quản lý danh mục chi
Status: `implemented` · BR: BR-08, BR-03

| AC | Test |
|---|---|
| ✅ AC-1: Danh mục trỏ về ví có thật; không còn học phí trỏ về Nhà ở | `test/schema.test.ts` › "seed › mọi danh mục trỏ về ví có thật; mọi ví trú ở một tài khoản có thật"; `test/schema.test.ts` › "seed › không còn danh mục học phí trỏ về ví Nhà ở; thuế suất chỉ nằm ở allocations" |
| ✅ AC-2: Đọc danh mục kèm ví mặc định | `test/mcp.test.ts` › "tool đọc số liệu › list_categories trả danh mục kèm ví mặc định" |
| ⚠ AC-3: Tạo danh mục, mã sinh từ tên tiếng Việt | ⚠ Chưa có test |
| ⚠ AC-4: Tắt danh mục thay vì xoá | ⚠ Chưa có test |
| ✅ AC-5: Migration 0029 đổi danh mục hệ thống sang mã tiếng Anh, số liệu không đổi | `test/migrations/system-ids.test.ts` › "migration 0029: mã hệ thống tiếng Anh › kết nối 'chinh' → 'default', danh mục 'tra-no' / 'cho-vay' → 'debt-payment' / 'lending', nguồn 'cho-thue' → 'rental' ở mọi bảng con và config; số chi, sổ nợ, sổ người thuê, ví, sổ tài khoản không đổi; khoá ngoại sạch" · "… › sổ người thuê vẫn chỉ ghi thêm: trigger tạo lại y nguyên như docs/schema.sql" · "… › chạy lại không đổi gì thêm" · "migration 0029: mã hệ thống tiếng Anh › code sau 0029 › GET /v1/rental trả incomeStreamId 'rental'; khoản thu của người thuê không chọn nguồn ghi 'rental'; trả nợ không chọn danh mục vào 'debt-payment'" |
| ✅ AC-6: Icon danh mục là dữ liệu | `test/migrations/system-ids.test.ts` › "migration 0029: mã hệ thống tiếng Anh › icon danh mục đúng bảng icon cũ (29 dòng); dòng đã có icon giữ nguyên; danh mục lạ để trống; mọi icon là tên icon có thật"; [`test/schema.test.ts`](../test/schema.test.ts) › "seed › mọi danh mục có icon là tên icon có thật; mọi mã trong hộ mẫu là tiếng Anh (chữ thường, số, gạch nối)"; PWA dùng icon nhãn khi tên lạ: ⚠ Chưa có test (component) |
| ✅ AC-7: Hộ mẫu sạch khoá ngoại, đủ dữ liệu hệ thống | [`test/schema.test.ts`](../test/schema.test.ts) › "seed › DB mẫu (docs/schema.sql + docs/seed.sql): khoá ngoại sạch, mọi view chạy không lỗi" · "seed › có đủ dữ liệu hệ thống: kết nối SePay 'default' cho mọi tài khoản bật SePay, danh mục trả nợ / cho vay, nguồn thu cho thuê, config rental_* và notify_*" |

### [UC-110](ledger/UC-110-quyet-toan-thue-nam.md) Quyết toán thuế năm
Status: `implemented` · BR: BR-07, BR-02

| AC | Test |
|---|---|
| ✅ AC-1: Thừa → chuyển phần thừa sang Tích sản, sinh lệnh chuyển MB → TCB, chỉ một lần | `test/tax.test.ts` › "quyết toán thuế năm › thừa thì chuyển phần thừa sang Tích sản, sinh lệnh chuyển MB → TCB, chỉ quyết toán một lần" |
| ✅ AC-2: Chưa hết năm thì không cho quyết toán | `test/tax.test.ts` › "quyết toán thuế năm › chưa hết năm thì không cho quyết toán" |
| ✅ AC-3: Năm sai định dạng → 400 | `test/tax.test.ts` › "quyết toán thuế năm › REST: năm sai định dạng → 400" |
| ⚠ AC-4: Thiếu thuế → chỉ ghi nhận, không có bút toán | ⚠ Chưa có test |

### [UC-111](ledger/UC-111-so-giao-dich-va-du-lieu-nen.md) Xem sổ giao dịch & tải dữ liệu nền
Status: `implemented` · BR: BR-03, BR-01, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Sổ không lộ bút toán nạp ví; khoản đã xoá ẩn mặc định, xem lại được | `test/api.test.ts` › "sổ giao dịch (UC-111) › khoản đã xoá ẩn khỏi sổ mặc định, vẫn còn trong sổ và xem lại được bằng include_void=1" |
| ⚠ AC-2: Giới hạn số dòng | ⚠ Chưa có test |
| ⚠ AC-3: Bootstrap đánh dấu ví riêng tư của người khác | ⚠ Chưa có test |
| ⚠ AC-4: Bootstrap cho biết tài khoản nào có feed | ⚠ Chưa có test |
| ✅ AC-5: Trang sau theo đúng thứ tự sắp — khoản nhập lùi ngày không bị bỏ sót hay lặp | `test/api.test.ts` › "sổ giao dịch (UC-111) › trang sau theo (ngày, id): khoản nhập lùi ngày không bị bỏ sót hay lặp" |
| ✅ AC-6: Mở một giao dịch theo id | `test/api.test.ts` › "sổ giao dịch (UC-111) › mở một giao dịch theo id: cùng hình dạng dòng sổ, kèm cờ đã chia và tên sổ đối ứng" |
| ✅ AC-7: Khoản chi để nối hoàn tiền: còn hiệu lực, trong N ngày, kèm nội dung ngân hàng | [`test/logs.test.ts`](../test/logs.test.ts) › "trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu) › GET /v1/transactions/link-candidates?meaning=spend: khoản chi còn hiệu lực 30 ngày gần nhất, mới nhất trước, kèm danh mục, ví đã trừ, nội dung ngân hàng" |
| ✅ AC-8: Khoản cho vay để nối khoản nhận lại: còn hiệu lực, trong N ngày, kèm người vay | [`test/logs.test.ts`](../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › GET /v1/transactions/link-candidates?meaning=lend: khoản cho vay còn hiệu lực trong số ngày hỏi, mới nhất trước, kèm người vay; meaning hay days sai → invalid_input" |
| ✅ AC-9: Mở một giao dịch thấy liên kết hai chiều | [`test/logs.test.ts`](../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › GET /v1/transactions/:id: khoản gốc kèm các khoản còn hiệu lực đã trả về nó (linked_from), khoản trả về kèm tóm tắt khoản gốc (link)" |
| ✅ AC-10: Lọc theo tháng, loại, danh mục, ví, tài khoản, người, nguồn; tổng cùng bộ lọc | [`test/api.test.ts`](../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › lọc tháng 9 + Chi tiêu + một danh mục: đúng các khoản, tổng chi đúng; các bộ lọc khác khớp đúng cột" |
| ✅ AC-11: Tìm chữ trên ghi chú, nội dung ngân hàng, tên danh mục, tên người | [`test/api.test.ts`](../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tìm chữ: ghi chú, nội dung ngân hàng, tên danh mục, tên người; ít hơn 2 ký tự thì báo sai" |
| ✅ AC-12: Tổng theo loại, điều chỉnh tách hai chiều, không có nạp ví | [`test/api.test.ts`](../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tổng theo nghĩa tiền thật: chi, hoàn, thu, cho vay / nhận lại, chuyển nội bộ, mua tài sản, điều chỉnh hai chiều" |
| ✅ AC-13: Tham số sai → invalid_input nói rõ tham số nào | [`test/api.test.ts`](../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tham số sai định dạng → invalid_input, nói rõ tham số nào" |
| ✅ AC-14: Tìm có dấu khớp cả nội dung ngân hàng không dấu | [`test/api.test.ts`](../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tìm có dấu cũng khớp nội dung ngân hàng không dấu; tìm không dấu chưa khớp chữ có dấu đã lưu" |

## Chia tiền (allocation)

### [UC-201](allocation/UC-201-tinh-phuong-an-chia.md) Tính phương án chia một khoản thu (engine)
Status: `implemented` · BR: BR-02, BR-07, BR-10

| AC | Test |
|---|---|
| ✅ AC-1: Đủ tiền — mọi ví đủ dự kiến, Have nhận phần dư (phase-02 case A) | `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › A — đủ tiền: mọi ví đủ dự kiến, Có-thì-tốt nhận phần dư" |
| ✅ AC-2: Thiếu nhẹ — Have về 0 trước, rồi Hưởng thụ bị bóp; Must vẫn đủ (case B) | `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › B — thiếu nhẹ: Have về 0, Hưởng thụ bị bóp, hai ví Chơi chia đều, Must vẫn đủ" |
| ✅ AC-3: Thiếu nặng — Must rót sàn theo priority, dưới sàn bị gắn cờ, phần khóa nguyên vẹn (case C) | `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › C — thiếu nặng: Must dưới sàn bị gắn cờ, Tích sản vẫn đúng 30%" |
| ✅ AC-4: Thuế chỉ trích khi khoản thu chịu thuế (case D) | `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › D — thu nhập ngoài chịu thuế: trích 10% vào ví Thuế" |
| ✅ AC-5: Khoản thu thứ hai trong tháng chỉ nạp phần còn thiếu; B + E = A (case E, D2) | `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › E — khoản thu thứ hai trong tháng chỉ nạp phần còn thiếu, và B + E = A" |
| ✅ AC-6: Phong bì tuần cần số tuần = số thứ Hai của tháng (case F, D7) | `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › F — tháng có 5 thứ Hai: phong bì tuần cần 5 tuần tiền"; hàm đếm: `test/period.test.ts` › "tuần → tháng › đếm số thứ Hai thật của tháng" |
| ✅ AC-7: Phong bì tiêu lố tháng trước được bù đúng một lần, phần bù lấy từ Have (case G, D3) | `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › G — ví tiêu lố tháng trước được bù, phần bù lấy từ Có-thì-tốt" |
| ✅ AC-8: Chỉ phong bì mới được bù hố | `test/allocation.test.ts` › "bất biến và ca biên › ví tích dồn bị âm không được tự bù (chỉ phong bì mới tiêu lố)" |
| ✅ AC-9: Bất biến Σ fund = thu nhập, mọi fund là số nguyên dương | `test/allocation.test.ts` › "bất biến và ca biên › tổng các fund luôn bằng đúng thu nhập (%i ₫)" |
| ✅ AC-10: Tích sản luôn đúng tỷ lệ dù thiếu tới đâu (làm tròn xuống) | `test/allocation.test.ts` › "bất biến và ca biên › Tích sản luôn đúng 30% dù thiếu tới đâu" |
| ✅ AC-11: Ví mục tiêu — đạt rồi thì thôi, quá hạn thì dồn hết | `test/allocation.test.ts` › "bất biến và ca biên › mục tiêu đã đạt thì không nạp nữa"; "bất biến và ca biên › mục tiêu quá hạn: dồn hết phần còn thiếu vào tháng này"; `test/period.test.ts` › "số tháng còn lại tới hạn mục tiêu › tính cả tháng hiện tại, tối thiểu 1" |
| ✅ AC-12: Ví không có luật nạp active thì không nhận gì | `test/allocation.test.ts` › "bất biến và ca biên › ví không có trong luật nạp thì không nhận gì" |
| ✅ AC-13: Cấu hình sai thì báo lỗi, không chia bừa | `test/allocation.test.ts` › "bất biến và ca biên › cấu hình sai thì báo lỗi rõ ràng thay vì chia bừa" |
| ⚠ AC-14: Cùng priority thiếu tiền — đồng lẻ làm tròn về ví đầu nhóm | ⚠ Chưa có test cho phần lẻ (AC-2 chỉ phủ trường hợp chia hết) |
| ⚠ AC-15: Nhóm Have có luật riêng rót sau Hưởng thụ, trước phần dư | ⚠ Chưa có test |
| ✅ AC-16: Nguồn cho thuê khóa 100% — đúng một fund, không dòng thác, không cờ | `test/allocation.test.ts` › "chia theo nguồn thu › nguồn cho thuê khóa 100% vào Thu cho thuê: đúng một fund, không chạy dòng thác, không cờ thiếu sàn" |
| ✅ AC-17: Nguồn khóa một phần — khóa trước, phần còn lại lấp chỗ thiếu, không trích Thuế | `test/allocation.test.ts` › "chia theo nguồn thu › lương vợ khóa 45% Tích sản trước, phần còn lại lấp chỗ thiếu; không trích thuế theo luật chung" |
| ✅ AC-18: Nguồn không khóa gì — toàn bộ vào dòng thác | `test/allocation.test.ts` › "chia theo nguồn thu › nguồn không khóa gì: toàn bộ vào dòng thác, không cắt Tích sản/Thuế" |
| ✅ AC-19: Không có nguồn thì y như cũ | `test/allocation.test.ts` › "chia theo nguồn thu › stream null y hệt không khai báo nguồn" |
| ✅ AC-20: Khóa trọn 100% chia nhiều ví — đồng lẻ về ví khóa đầu tiên | `test/allocation.test.ts` › "chia theo nguồn thu › khóa trọn 100% chia nhiều ví: đồng lẻ làm tròn về ví khóa đầu tiên" |

### [UC-202](allocation/UC-202-xem-truoc-phuong-an-chia.md) Xem trước phương án chia
Status: `implemented` · BR: BR-02, BR-05

| AC | Test |
|---|---|
| ✅ AC-1: Preview không ghi gì và cho đúng số như lần chia thật | `test/api.test.ts` › "chia lương end-to-end › preview không ghi gì; allocate ghi đúng các fund và lệnh chuyển tiền" |
| ⚠ AC-2: Ngữ cảnh tháng tính theo `month_key` của `at` | ⚠ Chưa có test ở tầng service (engine phủ bởi UC-201 AC-5, AC-7 với input dựng tay) |
| ⚠ AC-3: Cấu hình hỏng không trả số bừa | ⚠ Chưa có test cho route (engine: UC-201 AC-13) |
| ✅ AC-4: Xem trước theo nguồn thu | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối" |
| ⚠ AC-5: Nguồn thu không có bị từ chối | ⚠ Chưa có test |

### [UC-203](allocation/UC-203-chia-mot-khoan-thu-nhap.md) Chia một khoản thu nhập (ghi sổ)
Status: `implemented` · BR: BR-02, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Chia ghi đúng fund, trả mã đợt, ví Thu nhập về 0, sinh lệnh chuyển sang TK Tích sản | `test/api.test.ts` › "chia lương end-to-end › preview không ghi gì; allocate ghi đúng các fund và lệnh chuyển tiền" |
| ✅ AC-2: Một khoản thu không bao giờ được chia hai lần | `test/api.test.ts` › "chia lương end-to-end › một khoản thu không bao giờ được chia hai lần" |
| ⚠ AC-3: Hai lần chia đồng thời chỉ ghi một | ⚠ Chưa có test thường trực (red team xác nhận bằng PoC 4, `plans/reports/redteam-260922-0100-money-correctness.md`, rồi xoá) |
| ✅ AC-4: Webhook lương gửi lại không chia lần hai | `test/ingest.test.ts` › "ingestLog: rule lương — chia đúng một lần dù webhook gửi lại › tạo income taxable=0 rồi chia ngay; gửi lại cùng id không chia lần hai" |
| ✅ AC-5: Ngưỡng tự chia lương | `test/ingest-integrity.test.ts` › "lương giả › người ngoài chuyển 1.000 ₫ nội dung 'LUONG THANG' → không tự ghi thu nhập, không tự chia; nằm chờ để hỏi"; "lương giả › lương thật (đủ ngưỡng) vẫn tự chia ngay; ngưỡng chỉnh được trong config"; "rà lại các bản sửa (reviewer cuối) › salary_min_amount = 0 thì bỏ ngưỡng" |
| ✅ AC-6: Chia lỗi sau khi lương đã ghi thì không im lặng | `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › lương đã ghi nhưng bước chia lỗi → không im lặng: ghi lại để tin sáng báo, webhook không bị gửi lại vô ích" |
| ✅ AC-7: Webhook và rà soát đêm cùng một khoản lương → chia đúng một lần | `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → chia đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng" (chống trùng log thuộc ingest; ở đây chỉ là hệ quả lên lần chia) |
| ✅ AC-8: Tiền người thuê chia trọn vào "Thu cho thuê" | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền vào cho người thuê → nguồn cho thuê mặc định, chia 100% vào Thu cho thuê, số dư người thuê giảm" |
| ✅ AC-9: Khoản thu gắn nguồn khóa một phần chia theo nguồn | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối"; `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule lương mang income_stream_id → khoản thu tự ghi gắn nguồn, chia theo phần khóa của nguồn" |
| ✅ AC-10: Rule người thuê không tự ghi, không tự chia | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán" |

### [UC-204](allocation/UC-204-sinh-lenh-chuyen-tien.md) Sinh lệnh chuyển tiền
Status: `implemented` · BR: BR-02, BR-04, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Lệnh gộp theo TK đích, xuất phát từ TK nhận lương, memo ngẫu nhiên dạng `PF XXXXXX` | `test/api.test.ts` › "chia lương end-to-end › preview không ghi gì; allocate ghi đúng các fund và lệnh chuyển tiền"; tương tự cho quyết toán thuế: `test/tax.test.ts` › "quyết toán thuế năm › thừa thì chuyển phần thừa sang Tích sản, sinh lệnh chuyển MB → TCB, chỉ quyết toán một lần" |
| ⚠ AC-2: Ví cùng tài khoản với TK nhận tiền không sinh lệnh; không biết TK nhận thì không sinh lệnh | ⚠ Chưa có test (plan phase-02 Todo yêu cầu "mọi ví cùng TK → không sinh lệnh") |
| ⚠ AC-3: Lương về TK vợ thì lệnh xuất phát từ TK vợ (D4) | ⚠ Chưa có test kiểm `from_account_id` (plan phase-02 Todo; test "người kia bấm 'Đã chuyển'…" dùng income `vcb-em` nhưng chỉ kiểm phần gỡ) |
| ✅ AC-4: Memo kiểu cũ đoán được không còn khớp lệnh | `test/ingest-integrity.test.ts` › "lệnh chuyển tiền › người ngoài chuyển tiền vào với mã kiểu cũ đoán được không làm lệnh thành 'đã chuyển'"; `test/rules.test.ts` › "extractTransferMemo › mã kiểu cũ đoán được (PF A12, PF S202609) không còn là mã lệnh" |
| ✅ AC-5: Một lần chia có nhiều lệnh — mỗi lệnh khớp đúng giao dịch của mình | `test/ingest-integrity.test.ts` › "lệnh chuyển tiền › một lần chia có hai lệnh: chân thứ hai gắn đúng giao dịch của lệnh mình" (khớp memo thuộc ingest) |

### [UC-205](allocation/UC-205-theo-doi-lenh-chuyen-tien.md) Theo dõi & đánh dấu lệnh chuyển tiền
Status: `implemented` · BR: BR-04, BR-06

| AC | Test |
|---|---|
| ✅ AC-1: Chỉ lệnh đang chờ mới đánh dấu được; đã xong thì không đổi sang xong/bỏ qua lần nữa, nhưng trả về chờ được | `test/schema.test.ts` › "chốt chặn toàn vẹn ở tầng DB › lệnh chuyển tiền chỉ hoàn tất một lần, nhưng trả về chờ được" |
| ✅ AC-2: Đánh dấu "Đã chuyển" qua API | `test/api.test.ts` › "chia lương end-to-end › tiền của lần chia đã chuyển thật thì không huỷ khoản thu được" |
| ✅ AC-3: Log ngân hàng mang memo tự hoàn tất lệnh | `test/ingest.test.ts` › "ingestLog: khớp lệnh chuyển tiền qua nội dung 'PF <mã lệnh>' › chân đầu tiên về khớp ngay: lệnh chuyển thành done, sinh transfer đúng account" (ingest sở hữu luồng khớp) |
| ✅ AC-4: Nhắc lệnh quá 3 ngày | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › lệnh chuyển tiền quá hạn 3 ngày"; định dạng: `test/format.test.ts` › "dailyMessage › đủ mọi mục: dòng 💰, rồi việc cần làm, rồi thông tin; đúng câu chữ" |
| ⚠ AC-5: Bỏ qua một lệnh và lọc danh sách | ⚠ Chưa có test |
| ✅ AC-6: Danh sách lệnh nói tiền đi cho ví nào | `test/api.test.ts` › "chia lương end-to-end › lệnh chuyển tiền nói tiền đi cho ví nào: danh sách kèm tên các ví nhận trong lô ở tài khoản đích" |

### [UC-206](allocation/UC-206-go-lan-chia-khi-huy-khoan-thu.md) Gỡ lần chia khi huỷ khoản thu
Status: `implemented` · BR: BR-04, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Huỷ khoản thu đã chia gỡ trọn lần chia và không chia lại được | `test/api.test.ts` › "chia lương end-to-end › huỷ khoản thu đã chia thì gỡ luôn lần chia: ví về như cũ, lệnh chuyển chưa làm bị bỏ, không chia lại được" |
| ✅ AC-2: Tiền của đợt đã chuyển thật thì không huỷ được | `test/api.test.ts` › "chia lương end-to-end › tiền của lần chia đã chuyển thật thì không huỷ khoản thu được" |
| ✅ AC-3: Đua "Đã chuyển" với "Huỷ" — DB từ chối, sổ giữ nguyên | `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › người kia bấm 'Đã chuyển' đúng lúc đang gỡ lần chia → huỷ bị từ chối, sổ giữ nguyên" |
| ✅ AC-4: Gỡ gán log lương (kể cả lương giả lọt ngưỡng) gỡ luôn lần chia | `test/ingest-integrity.test.ts` › "lương giả › lương giả lọt qua (đủ ngưỡng) vẫn gỡ được: gỡ gán log thì gỡ luôn lần chia" |
| ✅ AC-5: Không huỷ lẻ được bút toán nạp ví | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › không sửa / xoá lẻ bút toán hệ thống (fund của lần chia) → system_tx" |
| ✅ AC-6: Sửa khoản thu đã chia gỡ lần chia cũ trong cùng một lần | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa khoản thu đã chia: gỡ lần chia cũ, khoản thu mới chưa chia và chia lại được" |

### [UC-207](allocation/UC-207-chot-thang-quet-du.md) Chốt tháng — quét dư phong bì chung sang Tích sản
Status: `implemented` · BR: BR-02, BR-07

| AC | Test |
|---|---|
| ✅ AC-1: Quét dư dương của phong bì chung đúng một lần; ví cá nhân và ví âm không bị đụng | `test/api.test.ts` › "chia lương end-to-end › chốt tháng: quét dư dương của phong bì chung sang Tích sản đúng một lần; ví cá nhân và ví âm không bị đụng" |
| ✅ AC-2: Cron ngày 1 chốt tháng trước, chạy lại không quét thêm, tin sáng báo đúng số và lệnh chuyển | `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › quét đúng một lần dù chạy cron hai lần; ví cá nhân không bị đụng" |
| ✅ AC-3: Không có gì để quét thì không có dòng chốt tháng | `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › không có gì để quét thì không có dòng chốt tháng"; `test/format.test.ts` › "dailyMessage › chốt tháng quét được 0 đồng thì không thêm dòng nào"; "dailyMessage › ngày 1: dòng chốt tháng kèm lệnh chuyển tiền, chỉ hiện khi số quét > 0" |
| ⚠ AC-4: Bút toán quét thuộc về chính tháng được chốt | ⚠ Chưa có test kiểm `at`/`month_key` của bút toán quét |
| ⚠ AC-5: Phong bì chung ở nhiều tài khoản → mỗi tài khoản nguồn một lệnh chuyển | ⚠ Chưa có test (seed chỉ có phong bì chung ở `vcb-anh`) |

## Bank feed (ingest)

### [UC-301](ingest/UC-301-nhan-webhook-sepay.md) Nhận webhook SePay
Status: `implemented` · BR: BR-03, BR-04, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Chỉ SePay có khoá mới ghi được | `test/webhooks.test.ts` › "xác thực webhook SePay › thiếu key → 401"; "xác thực webhook SePay › sai key → 401"; "xác thực webhook SePay › chưa cấu hình SEPAY_API_KEY → khoá hẳn" |
| ✅ AC-2: Đúng hợp đồng trả lời SePay | `test/webhooks.test.ts` › "xác thực webhook SePay › đúng key → 200, body đúng chuẩn {\"success\":true}" |
| ✅ AC-3: Webhook → rule mã → giao dịch (nối trọn) | `test/webhooks.test.ts` › "nối trọn: webhook → rule mã → transaction › mã EAN qua webhook thật tạo spend đúng ví/danh mục" |
| ✅ AC-4: Payload hỏng không làm SePay gửi lại vô ích, nhưng không mất lặng lẽ | `test/webhooks.test.ts` › "nối trọn: webhook → rule mã → transaction › payload thiếu trường bắt buộc vẫn trả success (SePay không nên bị coi là lỗi để retry vô ích)"; "payload hỏng và lỗi tạm thời › ngày không có thật (30/02) bị từ chối thay vì ghi sang tháng 3; được ghi lại để tin sáng báo" |
| ✅ AC-5: Định dạng thời điểm & số tiền | `test/webhooks.test.ts` › "payload hỏng và lỗi tạm thời › thiếu giây vẫn đọc được; số tiền vô lý (> 1.000 tỷ) bị từ chối" |
| ✅ AC-6: Lỗi tạm thời → SePay gửi lại, và lần gửi lại ghi đúng một log | `test/webhooks.test.ts` › "payload hỏng và lỗi tạm thời › D1 lỗi tạm thời → trả lỗi để SePay gửi lại; lần gửi lại ghi được đúng một log" |
| ✅ AC-7: Tài khoản ảo khớp trước số TK chính | `test/webhooks.test.ts` › "tài khoản ảo (subAccount) › khớp tài khoản theo subAccount trước số tài khoản chính" |
| ✅ AC-8: SePay gửi lại nhiều lần qua HTTP → một log, một giao dịch | `test/webhooks.test.ts` › "chống trùng qua HTTP › gửi lại đúng id (SePay retry) → chỉ có một bank_log, không sinh transaction thứ hai" |
| ✅ AC-9: Một địa chỉ cho mọi kết nối SePay — khoá của kết nối nào đang bật cũng vào được | `test/webhooks.test.ts` › "nhiều kết nối SePay — cùng một địa chỉ webhook, mỗi kết nối một khoá (ADR-75) › khoá của mỗi kết nối đang bật đều vào được; khoá lạ hay khoá của kết nối đã tắt bị từ chối"; `test/settings.test.ts` › "khoá kết nối SePay / Telegram › webhook dùng đúng khoá đặt ở màn Cài đặt; xoá khoá thì webhook khoá lại" |
| ✅ AC-10: Khoá của SePay người này không ghi được vào tài khoản người kia | `test/webhooks.test.ts` › "nhiều kết nối SePay — cùng một địa chỉ webhook, mỗi kết nối một khoá (ADR-75) › khoá của SePay của vợ không ghi được vào tài khoản của chồng: log không gắn tài khoản nào, không tự sinh giao dịch" |
| ✅ AC-11: Khoá sai tới ngưỡng thì IP đó bị chặn trước khi đọc khoá; IP khác không | `test/webhooks.test.ts` › "chặn dò khoá webhook theo IP (ADR-89) › sai khoá lần thứ 20 trong 15 phút → mọi webhook từ IP đó 429 trước khi đọc khoá, kể cả khoá đúng; IP khác vẫn vào"; "chặn dò khoá webhook theo IP (ADR-89) › khoá Zalo sai cũng được đếm; hết 15 phút thì IP đó gửi lại được" |

### [UC-302](ingest/UC-302-ghi-log-chong-trung.md) Ghi log ngân hàng chống trùng
Status: `implemented` · BR: BR-04, BR-03

| AC | Test |
|---|---|
| ✅ AC-1: Cùng id → một log, không xử lý lại | `test/ingest.test.ts` › "ingestLog: chống trùng › gửi lại cùng id chỉ tạo một log"; "ingestLog: rule lương — chia đúng một lần dù webhook gửi lại › tạo income taxable=0 rồi chia ngay; gửi lại cùng id không chia lần hai" |
| ✅ AC-2: Khác id nhưng cùng (tài khoản, mã tham chiếu) → một log, một giao dịch | `test/ingest.test.ts` › "ingestLog: chống trùng › id khác nhau nhưng cùng (account_id, reference_number) vẫn coi là một log"; `test/ingest-integrity.test.ts` › "webhook và cron vá đêm cùng một giao dịch › khác id nhưng cùng mã tham chiếu trong cùng tài khoản → một log, một giao dịch" |
| ✅ AC-3: Chạy chen → DB chặn log thứ hai | `test/ingest-integrity.test.ts` › "webhook và cron vá đêm cùng một giao dịch › chạy chen: log đã có mà request thứ hai vẫn tới được bước ghi → unique index chặn"; `test/schema.test.ts` › "chốt chặn toàn vẹn ở tầng DB › một mã tham chiếu chỉ có một log trong mỗi tài khoản; mã rỗng thì không tính" |
| ✅ AC-4: Song sinh thiếu mã → lương chỉ chia một lần, log sau chờ gán "có thể trùng" | `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → chia đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng" |
| ✅ AC-5: Không bao giờ bỏ lặng lẽ một giao dịch thật cùng số tiền | `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › một giao dịch THẬT khác, cùng số tiền, trong 3 phút, chỉ có ở rà soát đêm → không bị mất" |
| ✅ AC-6: Hai webhook khác id, cùng nguồn, cùng nội dung → hai giao dịch thật | `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › hai webhook khác id, giống hệt nhau, đều không có mã → vẫn là hai giao dịch thật" |
| ✅ AC-7: Tài khoản lạ vẫn được lưu | `test/ingest.test.ts` › "ingestLog: chống trùng › tài khoản lạ vẫn lưu log, account_id NULL, trạng thái pending" |
| ✅ AC-8: Lỗi sau khi đã ghi log không im lặng | `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › lương đã ghi nhưng bước chia lỗi → không im lặng: ghi lại để tin sáng báo, webhook không bị gửi lại vô ích" |
| ✅ AC-9: Log trước ngày mở sổ → `ignored`, không vào sổ, không ghép cặp, không báo, số dư theo log không đổi (ADR-76) | `test/ingest.test.ts` › "số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76) › log trước mốc lưu 'ignored': không khớp rule, không ghép cặp, không báo chờ gán, không làm lệch đối soát; số dư theo log giữ nguyên" |
| ✅ AC-10: Log đúng ngày mở sổ đi luồng thường | `test/ingest.test.ts` › "số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76) › log đúng ngày mở sổ đi luồng thường: khớp rule, vào sổ, vào số dư theo log" |
| ✅ AC-11: Tài khoản không có ngày mở sổ — như trước | `test/ingest.test.ts` › "số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76) › tài khoản không có ngày mở sổ: log cũ bao lâu vẫn chờ gán và vào số dư theo log như trước" |

### [UC-303](ingest/UC-303-tu-khop-log-vao-so.md) Tự khớp log vào sổ
Status: `implemented` · BR: BR-04, BR-02, BR-03

| AC | Test |
|---|---|
| ✅ AC-1: Thứ tự ưu tiên — mã rule đứng sau memo PF và ghép cặp; trong rule, `code` thắng `content` | `test/rules.test.ts` › "matchRule › khớp mã chính xác trước, rồi mới tới từ khoá nội dung" |
| ✅ AC-2: Chân đầu của lệnh chuyển về → lệnh `done`, sinh một transfer đúng TK | `test/ingest.test.ts` › "ingestLog: khớp lệnh chuyển tiền qua nội dung 'PF <mã lệnh>' › chân đầu tiên về khớp ngay: lệnh chuyển thành done, sinh transfer đúng account" |
| ✅ AC-3: Chân thứ hai gắn vào đúng giao dịch, không đếm hai lần | `test/ingest.test.ts` › "ingestLog: khớp lệnh chuyển tiền qua nội dung 'PF <mã lệnh>' › chân thứ hai về sau: gắn log_id_2 vào ĐÚNG giao dịch đã tạo, không sinh giao dịch mới"; `test/ingest-integrity.test.ts` › "lệnh chuyển tiền › một lần chia có hai lệnh: chân thứ hai gắn đúng giao dịch của lệnh mình" |
| ✅ AC-4: Memo đoán được không hoàn tất lệnh | `test/ingest-integrity.test.ts` › "lệnh chuyển tiền › người ngoài chuyển tiền vào với mã kiểu cũ đoán được không làm lệnh thành 'đã chuyển'"; `test/rules.test.ts` › "extractTransferMemo › mã kiểu cũ đoán được (PF A12, PF S202609) không còn là mã lệnh" |
| ✅ AC-5: Chân đầu bị gỡ trước khi chân sau về → ghép lại cả hai, không log mồ côi | `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › gỡ gán chân đầu của lệnh chuyển trước khi chân sau về → chân sau ghép lại cả hai, không log nào mồ côi" |
| ✅ AC-6: Chuyển giữa hai TK của hộ → một transfer, không sinh thu nhập | `test/ingest.test.ts` › "ingestLog: ghép cặp chuyển khoản nội bộ (4 tình huống) › chuyển giữa 2 TK của cùng một người → 1 transfer, không sinh thu nhập"; "… › vợ chuyển cho chồng → ghép thành transfer giữa 2 TK của hộ" |
| ✅ AC-7: Điều kiện ghép cặp | `test/rules.test.ts` › "canPair › ghép khi ngược hướng, cùng số tiền, khác tài khoản, lệch ≤ 10 phút"; "canPair › không ghép nếu cùng tài khoản, cùng hướng, khác số tiền, hoặc lệch quá 10 phút" |
| ✅ AC-8: Rủi ro đã chấp nhận — trùng số tiền ngẫu nhiên bị ghép nhầm, gỡ được | `test/ingest.test.ts` › "ingestLog: ghép cặp chuyển khoản nội bộ (4 tình huống) › trùng số tiền ngẫu nhiên giữa hai người không liên quan → vẫn bị ghép nhầm (rủi ro đã biết), gỡ được bằng huỷ" |
| ✅ AC-9: Tiền vào không rõ nguồn luôn phải hỏi | `test/ingest.test.ts` › "ingestLog: ghép cặp chuyển khoản nội bộ (4 tình huống) › khách chuyển tiền thật (không có chân ra đối ứng) → vẫn pending, không tự đoán thu nhập"; `test/rules.test.ts` › "matchRule › rule income chỉ khớp khi hướng là 'in' và is_salary=1"; "matchRule › rule spend/transfer không bao giờ khớp khi hướng là 'in'" |
| ✅ AC-10: Lương đủ ngưỡng tự ghi và chia đúng một lần; lương giả nhỏ nằm chờ | `test/ingest.test.ts` › "ingestLog: rule lương — chia đúng một lần dù webhook gửi lại › tạo income taxable=0 rồi chia ngay; gửi lại cùng id không chia lần hai"; `test/ingest-integrity.test.ts` › "lương giả › người ngoài chuyển 1.000 ₫ nội dung 'LUONG THANG' → không tự ghi thu nhập, không tự chia; nằm chờ để hỏi"; "lương giả › lương thật (đủ ngưỡng) vẫn tự chia ngay; ngưỡng chỉnh được trong config"; "rà lại các bản sửa (reviewer cuối) › salary_min_amount = 0 thì bỏ ngưỡng" |
| ✅ AC-11: Rule mã / từ khoá tự gán khoản chi | `test/ingest.test.ts` › "ingestLog: rule mã / từ khoá › mã EAN → spend vào ví food, danh mục groceries"; "… › từ khoá trên nội dung có dấu (đổ xăng) → nhận diện như mã EXE"; "… › khớp mã nhưng SePay đã đưa sẵn code khác vẫn ưu tiên ref_code đã lưu, không suy luận lại"; `test/ingest-integrity.test.ts` › "nội dung nhiều khoảng trắng › rule từ khoá vẫn khớp khi ngân hàng chèn nhiều khoảng trắng / tab" |
| ✅ AC-12: Một giao dịch ngân hàng vào sổ nhiều nhất một lần (chốt ở DB) | `test/schema.test.ts` › "chốt chặn toàn vẹn ở tầng DB › không ghi được giao dịch cho log đã gán hoặc đã bỏ qua"; "… › chân thứ hai của cặp cũng phải đang chờ"; "… › lệnh chuyển tiền chỉ hoàn tất một lần, nhưng trả về chờ được" |
| ✅ AC-13: Chân thứ hai về trong 60 giây → đã ghép trước khi cron báo | `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › chuyển nội bộ 2 chân về cách nhau 20 giây → ghép cặp trước khi cron chạy, không có tin 'cần gán'" |
| ⚠ AC-14: Rule `transfer` không có tài khoản đầu kia (rút tiền mặt cố định) → transfer sang TK tiền mặt | ⚠ Chưa có test |
| ✅ AC-15: Mẫu lương mang nguồn thu → khoản thu tự ghi gắn nguồn, chia theo phần khóa của nguồn | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule lương mang income_stream_id → khoản thu tự ghi gắn nguồn, chia theo phần khóa của nguồn" |
| ✅ AC-16: Rule người thuê không bao giờ tự gán | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán" |
| ✅ AC-17: Log tiền ra của tài khoản "chỉ tiền vào" không tự gán theo rule; tiền vào và ghép cặp vẫn như cũ (ADR-66) | `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền ra khớp rule chi → không tự gán, giữ pending; màn Gán gợi ý theo rule kèm lời nhắc có thể đã nhập tay"; `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền vào vẫn tự khớp rule lương như trước"; `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › chuyển nội bộ từ tài khoản chỉ-tiền-vào vẫn ghép cặp với chân tiền vào" |
| ✅ AC-18: Rule chuyển nội bộ có tài khoản đầu kia → tự gán sang đúng tài khoản đó kèm chuyển ví, không phải chi tiêu (ADR-77, ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › tài khoản SePay báo cả tiền ra: tự gán chuyển nội bộ sang heo của chính chủ, ví Có thì tốt → Tích sản — không phải chi tiêu" |
| ✅ AC-19: Rule gắn tài khoản chỉ áp cho log của tài khoản đó — mỗi người một con heo (ADR-77, ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › mỗi người một con heo: log của tài khoản MB của vợ vào heo của vợ; rule của chồng không áp sang" |
| ✅ AC-20: Log trước ngày mở sổ của tài khoản đầu kia không tự gán (ADR-76, ADR-77) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › log trước ngày mở sổ của heo không tự gán (số dư đầu đã gồm nó)" |
| ✅ AC-21: Chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi, không ghi lần hai (ADR-81) | [`test/ingest.test.ts`](../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › chân ra đã gán tay, chân vào về sau qua kết nối khác → gắn vào đúng giao dịch đó; mỗi tài khoản đúng 250.000"; [`test/ingest.test.ts`](../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › chân vào đã gán tay trước, chân ra về sau → cũng gắn, không ghi thêm"; [`test/ingest.test.ts`](../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › lệch số tiền, lệch quá 10 phút, hay đầu kia khác tài khoản → không gắn: chờ gán, gán thì ghi giao dịch riêng"; [`test/ingest.test.ts`](../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › giao dịch đã đủ hai chân thì không gắn thêm chân nào" |
| ✅ AC-22: Ghép cặp hay rule vào tài khoản Tích sản mang chuyển ví Có thì tốt → Tích sản (ADR-88) | [`test/buffer.test.ts`](../test/buffer.test.ts) › "tự khớp vào tài khoản Tích sản (ADR-88) › ghép cặp hai log VCB → phao: chuyển nội bộ mang ví Có thì tốt → Tích sản; phao → VCB chỉ đổi chỗ"; [`test/buffer.test.ts`](../test/buffer.test.ts) › "tự khớp vào tài khoản Tích sản (ADR-88) › rule chuyển nội bộ sang phao không mang ví: tự gán cũng chuyển ví Có thì tốt → Tích sản" |

### [UC-304](ingest/UC-304-ra-soat-0200-backfill.md) Rà soát 02:00 & đồng bộ lại theo khoảng ngày qua API SePay
Status: `implemented` · BR: BR-03, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Không kết nối nào có token → bỏ qua, không gọi API | `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › bỏ qua lặng lẽ khi chưa cấu hình SEPAY_API_TOKEN" |
| ✅ AC-2: Vá đúng giao dịch webhook sót, idempotent, gọi API v2 đúng cửa sổ ngày (ngày thường) | `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › gọi /v2/transactions theo khoảng ngày giờ VN, vá đúng 1 giao dịch bị sót; chạy lần hai không tạo thêm" |
| ✅ AC-3: Đi hết các trang; chỉ giữ giao dịch của TK bật SePay; tiền ra theo `transfer_type` | `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › đi hết các trang; bỏ giao dịch của tài khoản không bật SePay ở app; tiền ra đọc theo transfer_type" |
| ✅ AC-3b: API lỗi không làm hỏng cron (lỗi trả theo tên kết nối); 429 thì chờ rồi thử lại | `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › API lỗi (mạng, 401) không làm hỏng cron, vẫn ghi dòng rà soát"; `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › 429 thì chờ Retry-After rồi thử lại một lần" |
| ✅ AC-4: Webhook và backfill cùng giao dịch → một log, một giao dịch; thiếu mã → chia lương đúng một lần | `test/ingest-integrity.test.ts` › "webhook và cron vá đêm cùng một giao dịch › khác id nhưng cùng mã tham chiếu trong cùng tài khoản → một log, một giao dịch"; "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → chia đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng" |
| ⚠ AC-5: Dòng API hỏng không mất lặng lẽ | ⚠ Chưa có test |
| ⚠ AC-6: Cửa sổ rà không hở giữa hai đêm; mỗi giao dịch được soát lại trong tuần và trong tháng | ⚠ Chưa có test |
| ✅ AC-7: Rà soát đi qua từng kết nối bằng token riêng; mỗi kết nối chỉ giữ giao dịch tài khoản của nó | `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › rà soát đi qua từng kết nối bằng token riêng; mỗi kết nối chỉ giữ giao dịch của tài khoản thuộc nó" |
| ✅ AC-8: Một kết nối lỗi không chặn kết nối kia | `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › một kết nối lỗi (token sai) không chặn kết nối kia; lỗi ghi theo tên kết nối, dòng rà soát vẫn có" |
| ✅ AC-9: Đồng bộ lại — khoảng ngày sai bị từ chối trước khi gọi SePay | `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › đồng bộ lại theo khoảng ngày (POST /v1/settings/sepay/sync) › ngày sai dạng hoặc không có thật, Từ sau Đến, ngày tương lai, quá 31 ngày → invalid_range; kết nối lạ → not_found; không gọi SePay" |
| ✅ AC-10: Đồng bộ lại hai lần cùng khoảng ngày → lần hai không thêm gì | `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › đồng bộ lại theo khoảng ngày (POST /v1/settings/sepay/sync) › chạy hai lần cùng khoảng ngày: lần hai không thêm gì; giao dịch webhook đã có tính là có sẵn; chỉ gọi kết nối được chọn" |
| ✅ AC-11: Khoảng ngày vắt qua ngày mở sổ — giao dịch trước mốc đếm riêng, không vào sổ (ADR-76) | `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › đồng bộ lại theo khoảng ngày (POST /v1/settings/sepay/sync) › khoảng ngày vắt qua ngày mở sổ: giao dịch trước mốc lưu 'ignored', đếm riêng beforeOpening, không vào sổ, không làm lệch số dư theo log (ADR-76)" |
| ✅ AC-12: Khoảng rà 02:00 ba lớp — ngày thường soát hôm qua, thứ Hai soát cả tuần trước, ngày 1 soát cả tháng trước (ADR-78) | `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › khoảng rà 02:00 ba lớp: ngày thường soát hôm qua, thứ Hai soát cả tuần trước, ngày 1 soát cả tháng trước (thắng cả thứ Hai)" |

### [UC-305](ingest/UC-305-gan-log-chua-gan.md) Gán log chưa gán
Status: `implemented` · BR: BR-03, BR-04, BR-02

| AC | Test |
|---|---|
| ✅ AC-1: Danh sách chỉ gồm log chờ gán, kèm gợi ý Rút tiền mặt cho log ra rút ATM không khớp rule | `test/logs.test.ts` › "GET /v1/logs?status=pending › chỉ liệt kê log pending, kèm gợi ý"; `test/ingest.test.ts` › "gợi ý Rút tiền mặt chỉ cho log `out` trông như rút tiền › listPendingLogs gợi ý transfer sang ví tiền mặt của đúng chủ tài khoản" |
| ✅ AC-2: Tiền vào không có gợi ý | `test/ingest.test.ts` › "gợi ý Rút tiền mặt chỉ cho log `out` trông như rút tiền › log tiền vào không khớp gì thì không gợi ý (luôn phải hỏi)" |
| ✅ AC-3: Log có thể trùng được gợi ý bỏ qua, không gợi ý gán | `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → chia đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng" |
| ✅ AC-4: Tổng các dòng phải bằng đúng số tiền log | `test/logs.test.ts` › "POST /v1/logs/:id/assign › tổng splits khớp số tiền log → 201, tạo transaction, log 'assigned'"; "… › tổng splits không khớp → 400 split_mismatch"; "… › tách một log thành nhiều dòng, tổng vẫn phải đúng"; `test/ingest.test.ts` › "assign / ignore › gán với tổng splits không khớp số tiền log → lỗi split_mismatch"; "assign / ignore › gán đúng tổng tiền thì tạo transaction, log chuyển 'assigned'" |
| ✅ AC-5: Không gán hai lần | `test/ingest-integrity.test.ts` › "gán hai lần cùng lúc › lần gán thứ hai bị từ chối 409, sổ chỉ có một bộ giao dịch"; `test/logs.test.ts` › "POST /v1/logs/:id/assign › log đã xử lý rồi thì không gán lại được" |
| ✅ AC-6: Rule từ lần gán — chỉ chi/chuyển; từ chối thì không ghi sổ nửa chừng | `test/logs.test.ts` › "POST /v1/logs/:id/assign › gán kèm create_rule tạo luôn rule cho lần sau; income bị từ chối vì luật 6" |
| ✅ AC-7: `create_rule` boolean như PWA gửi | `test/logs.test.ts` › "POST /v1/logs/:id/assign › create_rule dạng true/false như PWA gửi: false không tạo rule, true tự rút mẫu từ nội dung"; "… › create_rule: true với tiền vào thì vẫn gán được, chỉ báo không tạo rule"; "… › mẫu rule tự rút: ưu tiên mã [QE]xx; nội dung toàn số thì không có mẫu" |
| ✅ AC-8: Bỏ qua | `test/ingest.test.ts` › "assign / ignore › ignore log pending → 'ignored'; ignore lần hai báo lỗi not_pending"; `test/logs.test.ts` › "POST /v1/logs/:id/ignore › chuyển log sang ignored"; "POST /v1/logs/:id/ignore › log không tồn tại → 404" |
| ✅ AC-9: Status khác `pending` bị từ chối | `test/logs.test.ts` › "GET /v1/logs?status=pending › status khác 'pending' bị từ chối" |
| ✅ AC-10: Log tiền vào khớp rule người thuê được gợi ý, không tự gán | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán" |
| ✅ AC-11: Gán tiền vào cho người thuê → nguồn cho thuê, chia trọn vào "Thu cho thuê", số dư người thuê giảm | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền vào cho người thuê → nguồn cho thuê mặc định, chia 100% vào Thu cho thuê, số dư người thuê giảm" |
| ✅ AC-12: Gán log tiền ra thành chuyển khoản kèm chuyển ví | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền ra thành chuyển khoản kèm chuyển ví Thu cho thuê → Tích sản" |
| ⚠ AC-13: Nguồn thu / người thuê trên dòng không phải thu nhập bị từ chối | ⚠ Chưa có test (luật nằm ở `buildEntry`, được thử qua `POST /v1/transactions` ở ledger UC-101) |
| ✅ AC-14: Ví tiền mặt chung nhận gợi ý Rút tiền mặt | `test/ingest.test.ts` › "gợi ý Rút tiền mặt chỉ cho log `out` trông như rút tiền › nhà chỉ có một ví tiền mặt chung (không gắn chủ) thì gợi ý rút tiền về ví chung đó" |
| ✅ AC-15: Log tiền ra của tài khoản "chỉ tiền vào" — gợi ý kèm lời nhắc có thể đã nhập tay (ADR-66) | `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền ra khớp rule chi → không tự gán, giữ pending; màn Gán gợi ý theo rule kèm lời nhắc có thể đã nhập tay"; `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền ra không khớp gì → không gợi ý loại, chỉ còn lời nhắc; nội dung rút ATM thì gợi ý Rút tiền mặt kèm lời nhắc" |
| ✅ AC-16: Gán log tiền ra thành khoản trả nợ làm giảm số còn nợ | [`test/logs.test.ts`](../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền ra thành khoản trả nợ (debt_id) làm giảm số còn nợ" |
| ✅ AC-17: Gán log tiền vào là nhận lại tiền cho vay — không thành thu nhập, không chia, ví không đổi | [`test/logs.test.ts`](../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền vào là nhận lại tiền cho vay (collect): trừ khoản phải thu, không thành thu nhập, không chia, ví không đổi" |
| ✅ AC-18: Log trước ngày mở sổ lỡ còn chờ gán → không gán được (ADR-76) | `test/ingest.test.ts` › "số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76) › log trước mốc lỡ còn 'pending' (nhận trước khi có luật): gán và ghép cặp tay đều bị chặn before_opening, log vẫn chờ" |
| ✅ AC-19: Log bỏ heo đất của tài khoản "chỉ tiền vào" — gợi ý điền sẵn chuyển nội bộ kèm chuyển ví vào Tích sản (ADR-77, ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › MB chỉ báo tiền vào (sepay_out = 0 như prod): giữ chờ, gợi ý điền sẵn đúng chuyển nội bộ + chuyển ví; gán theo gợi ý ra cùng kết quả" |
| ✅ AC-20: Rút heo về tài khoản — chỉ gợi ý chuyển tài khoản heo → tài khoản này, không chuyển ví; tiền vẫn thuộc Tích sản (ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "rút heo về tài khoản › tiền vào khớp mẫu heo: không tự gán, gợi ý chỉ chuyển tài khoản heo → tài khoản này; tiền vẫn thuộc Tích sản" |
| ✅ AC-21: MB tất toán sổ tích lũy (nội dung thật) — cùng gợi ý rút heo của chính chủ (ADR-77, ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "rút heo về tài khoản › MB tất toán sổ tích lũy (nội dung thật): cùng gợi ý rút heo của chính chủ về tài khoản" |
| ✅ AC-22: Tiền ra khớp `TICH LUY` ở tài khoản "chỉ tiền vào" — gợi ý bỏ heo vào Tích sản (ADR-77, ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "rút heo về tài khoản › tiền ra khớp 'TICH LUY' (tự gửi thêm vào sổ tích lũy): tài khoản báo cả tiền ra tự gán bỏ heo; 'chỉ tiền vào' thì gợi ý" |
| ✅ AC-23: Chân thứ hai đang chờ của chuyển nội bộ đã ghi — gợi ý khớp; gán là gắn, không ghi thêm (ADR-81) | [`test/ingest.test.ts`](../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › chân thứ hai đang chờ (như prod sau khi gỡ giao dịch ghi lần hai): gợi ý khớp; gán tay thì gắn vào giao dịch đã ghi"; [`test/ingest.test.ts`](../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › lệch số tiền, lệch quá 10 phút, hay đầu kia khác tài khoản → không gắn: chờ gán, gán thì ghi giao dịch riêng" |
| ✅ AC-24: Log tiền ra không khớp rule mà không phải rút tiền → không gợi ý Rút tiền mặt | `test/ingest.test.ts` › "gợi ý Rút tiền mặt chỉ cho log `out` trông như rút tiền › trả QR, hoá đơn, chuyển khoản không khớp rule → không gợi ý Rút tiền mặt (màn Gán mặc định Chi tiêu)"; `test/rules.test.ts` › "looksLikeCashWithdrawal › nội dung rút tiền mặt (ATM, RUT TIEN, RUT TM, CASH WITHDRAWAL) — có dấu, thường hay hoa đều nhận"; `test/rules.test.ts` › "looksLikeCashWithdrawal › trả QR, hoá đơn, chuyển khoản, tên quán chứa ATM giữa chữ → không phải rút tiền" |
| ✅ AC-25: Gán log tiền vào là hoàn tiền nối về khoản chi gốc (`link_id`) | [`test/logs.test.ts`](../test/logs.test.ts) › "trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu) › gán log tiền vào là hoàn tiền có link_id: nối khoản chi gốc, danh mục theo khoản gốc; phần chênh nằm lại trong ví của danh mục"; [`test/logs.test.ts`](../test/logs.test.ts) › "trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu) › link_id phải trỏ về khoản chi còn hiệu lực: không thì invalid_link (như nhập tay), log vẫn chờ, không ghi gì" |
| ✅ AC-26: Gán log tiền vào là nhận lại tiền cho vay nối về khoản cho vay gốc (`link_id`) | [`test/logs.test.ts`](../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › gán log tiền vào là nhận lại có link_id về khoản cho vay: lấy người của khoản cho vay; khác người hay trỏ khoản chi → invalid_link, log vẫn chờ" |

### [UC-306](ingest/UC-306-ghep-cap-tay-va-go-gan.md) Ghép cặp tay & gỡ gán
Status: `implemented` · BR: BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Ghép tay hai log ngược hướng cùng tiền thành một transfer | `test/logs.test.ts` › "POST /v1/logs/pair — ghép tay khi thuật toán bỏ sót › ghép đúng 2 log ngược hướng cùng tiền thành 1 transfer" |
| ✅ AC-2: Khác số tiền → từ chối | `test/logs.test.ts` › "POST /v1/logs/pair — ghép tay khi thuật toán bỏ sót › khác số tiền thì từ chối" |
| ✅ AC-3: Ghép tay khi một chân vừa được gán nơi khác → 409, không sinh giao dịch | `test/ingest-integrity.test.ts` › "gán hai lần cùng lúc › ghép cặp tay khi một chân vừa được gán ở nơi khác → 409, không sinh giao dịch" |
| ✅ AC-4: Gỡ cặp → giao dịch void, hai log về chờ | `test/logs.test.ts` › "POST /v1/logs/transactions/:txId/void — gỡ cặp/gỡ gán › huỷ giao dịch sinh từ log rồi trả các log về pending"; `test/ingest.test.ts` › "ingestLog: ghép cặp chuyển khoản nội bộ (4 tình huống) › trùng số tiền ngẫu nhiên giữa hai người không liên quan → vẫn bị ghép nhầm (rủi ro đã biết), gỡ được bằng huỷ" |
| ✅ AC-5: Gỡ log đã tách nhiều dòng → huỷ hết rồi mới mở lại; gán lại không đếm hai lần | `test/ingest-integrity.test.ts` › "gỡ gán một log đã tách nhiều dòng › huỷ mọi dòng của log rồi mới trả log về chờ; gán lại không đếm hai lần" |
| ✅ AC-6: Gỡ giao dịch khớp lệnh chuyển → lệnh quay lại chờ | `test/ingest-integrity.test.ts` › "gỡ gán một log đã tách nhiều dòng › gỡ giao dịch khớp lệnh chuyển tiền thì lệnh đó quay lại chờ" |
| ✅ AC-7: Gỡ log lương đã chia → gỡ luôn lần chia | `test/ingest-integrity.test.ts` › "lương giả › lương giả lọt qua (đủ ngưỡng) vẫn gỡ được: gỡ gán log thì gỡ luôn lần chia" |
| ✅ AC-8: Không gỡ được khi tiền của lần chia đã chuyển thật | `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › người kia bấm 'Đã chuyển' đúng lúc đang gỡ lần chia → huỷ bị từ chối, sổ giữ nguyên" |
| ✅ AC-9: Gỡ gán là đường duy nhất cho giao dịch ngân hàng | `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › giao dịch từ ngân hàng không xoá được ở sổ cái (bank_tx), log vẫn đã gán; gỡ gán thì được" |
| ✅ AC-10: Gỡ giao dịch có chân thứ hai gắn sau → huỷ giao dịch, cả hai log về chờ (ADR-81) | [`test/ingest.test.ts`](../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › gỡ gán giao dịch đã gắn chân thứ hai → huỷ giao dịch, cả hai log về chờ" |
| ✅ AC-11: Gỡ gán ghi nhật ký (ADR-90) | `test/audit.test.ts` › "nhật ký thay đổi › huỷ, sửa, gỡ gán giao dịch đều ghi một dòng: ai, qua đâu, giao dịch nào" |

### [UC-307](ingest/UC-307-quan-ly-rule-tu-gan.md) Quản lý rule tự gán
Status: `implemented` · BR: BR-08, BR-02, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Rule seed có đủ bộ mã đang chạy | `test/logs.test.ts` › "GET/POST /v1/rules › liệt kê rule đã seed (bao gồm EAN, EXE, EMS, LUONG THANG)" |
| ✅ AC-2: Tạo rule chi | `test/logs.test.ts` › "GET/POST /v1/rules › tạo rule mới cho spend" |
| ✅ AC-3: Máy không bao giờ được đoán thu nhập ngoài mẫu lương | `test/logs.test.ts` › "GET/POST /v1/rules › tạo rule income mà không is_salary → từ chối (luật 6)"; `test/rules.test.ts` › "matchRule › rule income chỉ khớp khi hướng là 'in' và is_salary=1" |
| ✅ AC-4: `match_type` không hợp lệ bị từ chối | `test/logs.test.ts` › "GET/POST /v1/rules › match_type không hợp lệ → từ chối" |
| ✅ AC-5: Chuẩn hoá nội dung như hệ cũ | `test/rules.test.ts` › "normalizeContent › bỏ dấu tiếng Việt và viết hoa, như MzaSepaySheetLib đang làm"; "extractCode › bắt mã 3 chữ cái [QE]xx không phân biệt hoa thường"; "matchRule › dò từ khoá trên nội dung đã bỏ dấu khi không có mã"; "matchRule › không khớp gì thì trả null" |
| ✅ AC-6: Rule spend/transfer không khớp tiền vào | `test/rules.test.ts` › "matchRule › rule spend/transfer không bao giờ khớp khi hướng là 'in'" |
| ✅ AC-7: Rule tự rút khớp lại được lần chuyển sau | `test/logs.test.ts` › "POST /v1/logs/:id/assign › create_rule dạng true/false như PWA gửi: false không tạo rule, true tự rút mẫu từ nội dung" |
| ✅ AC-8: Rule người thuê chỉ dùng cho tiền vào | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ dùng cho tiền vào" |
| ✅ AC-9: Rule người thuê tạo được không cần `is_salary`, nhưng chỉ gợi ý | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán" |
| ✅ AC-10: Mẫu lương mang nguồn thu | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule lương mang income_stream_id → khoản thu tự ghi gắn nguồn, chia theo phần khóa của nguồn" |
| ✅ AC-11: Migration 0017 + 0019 + 0020 seed rule heo đất cho mọi tài khoản MB của đúng chủ, chuyển ví vào Tích sản; DB không có hai thành viên thật của prod thì không seed gì (ADR-77, ADR-82) | `test/migrations/piggy-bank.test.ts` › "migration 0017 + 0019 + 0020: heo đất › nhà có hai thành viên của prod: mỗi người một tài khoản heo đã khóa, rule cho mọi tài khoản MB thường của đúng chủ chuyển ví Có thì tốt → Tích sản; phao → heo chỉ đổi chỗ (0024)"; `test/migrations/piggy-bank.test.ts` › "migration 0017 + 0019 + 0020: heo đất › 0020 trên dữ liệu như prod: số dư ví Heo đất sang Tích sản bằng một bút toán hệ thống chỉ đổi ví, rồi tắt ví; tiền thật không đổi"; `test/migrations/piggy-bank.test.ts` › "migration 0017 + 0019 + 0020: heo đất › DB seed mẫu (không có hai thành viên của prod) chỉ thêm cột, không có heo nào" |
| ✅ AC-12: Mẫu `TICH LUY` — tiền ra là bỏ heo (ADR-77, ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "rút heo về tài khoản › tiền ra khớp 'TICH LUY' (tự gửi thêm vào sổ tích lũy): tài khoản báo cả tiền ra tự gán bỏ heo; 'chỉ tiền vào' thì gợi ý" |

### [UC-308](ingest/UC-308-doi-soat-feed-va-su-co-ingest.md) Ghi sự cố ingest
Status: `implemented` · BR: BR-04, BR-06

| AC | Test |
|---|---|
| ⚠ AC-1: Ngân hàng báo số dư khác tổng log → ghi cờ lệch (deprecated v5: ADR-87 — không còn so với số SePay báo) | ⚠ Chưa có test |
| ⚠ AC-2: `accumulated = 0` không tính là lệch (deprecated v5: ADR-87 — `accumulated` không còn được đọc) | ⚠ Chưa có test |
| ⚠ AC-3: Log chưa gán không bật báo lệch giả (deprecated v5: chuyển về ledger UC-106 AC-1) | ⚠ Chưa có test |
| ✅ AC-4: Payload hỏng được ghi lại, không lộ số tài khoản | `test/webhooks.test.ts` › "payload hỏng và lỗi tạm thời › ngày không có thật (30/02) bị từ chối thay vì ghi sang tháng 3; được ghi lại để tin sáng báo" |
| ✅ AC-5: Lỗi sau khi ghi log được ghi lại | `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › lương đã ghi nhưng bước chia lỗi → không im lặng: ghi lại để tin sáng báo, webhook không bị gửi lại vô ích" |
| ✅ AC-6: Số lũy kế lệch không bật cờ gì, bản thô giữ nguyên | `test/ingest.test.ts` › "số lũy kế SePay gửi kèm không được lưu hay so (ADR-87) › webhook mang accumulated lệch hẳn sổ → log ghi bình thường, không cờ reconcile_drift, raw giữ nguyên payload" |

## Nhắc & Telegram (notify)

### [UC-401](notify/UC-401-lich-cron-va-dieu-phoi.md) Lịch cron & điều phối
Status: `implemented` · BR: BR-06, BR-10

| AC | Test |
|---|---|
| ✅ AC-1: Ngày VN của cron sáng không bị lệch vì UTC | `test/cron-daily.test.ts` › "múi giờ VN › cron chạy lúc 23:30 UTC hôm trước vẫn thuộc ngày VN hôm sau" |
| ✅ AC-2: Rà soát 02:00 VN và tin sáng cùng một ngày VN | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › đêm qua backfill vá bao nhiêu lấy từ notifications(kind='backfill', day_key=hôm nay); lượt soát tuần ghi rõ" (mô phỏng dòng backfill bằng SQL; phần ghi thật ở UC-304) |
| ✅ AC-3: Hai biểu thức cron cùng vào một lượt; cron lạ không làm gì | `test/cron-schedule.test.ts` › "lượt cron: hai biểu thức, rà soát 02:00 › cả hai biểu thức cron vào cùng một lượt; cron cũ chỉ cảnh báo, không làm gì" |
| ✅ AC-4: Mỗi job chạy lại không sinh tác dụng trùng | `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › gửi đúng 2 người có tg_chat_id, cùng nội dung; chạy lại trong ngày không gửi thêm"; `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › chạy lại cùng tuần không gửi trùng" |
| ✅ AC-5: Lượt cron: một việc lỗi không chặn việc khác | `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › lượt cron: báo giao dịch chưa gán lỗi vẫn dọn lượt kẹt, rồi báo lỗi ra ngoài" |
| ✅ AC-6: Lượt chưa tới giờ hay đã chạy rồi chỉ tốn một câu đọc | `test/cron-schedule.test.ts` › "giờ nhắc: lượt chưa tới giờ không tốn thêm truy vấn › chưa tới giờ (kể cả ngày 1) hay đã gửi rồi: chỉ một câu đọc lịch + mốc, không chốt tháng, không gửi" |
| ✅ AC-7: Lỡ lượt đúng giờ thì lượt sau chạy bù, không bao giờ hai lần một ngày | `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › lỡ lượt đúng giờ thì lượt kế tiếp gửi bù; cả ngày chỉ một lần; hôm sau gửi tiếp" |
| ✅ AC-8: Việc theo giờ lỗi giữa chừng thì nhả mốc, lượt sau làm lại | `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › tin sáng lỗi giữa chừng thì nhả mốc: lượt cron sau làm lại" |
| ✅ AC-9: Rà soát chỉ chạy ở lượt 02:00 VN | `test/cron-schedule.test.ts` › "lượt cron: hai biểu thức, rà soát 02:00 › rà soát giao dịch qua API SePay › chỉ chạy ở lượt 02:00 VN, không ở 01:00, 03:00 hay các lượt 15 phút" |
| ✅ AC-10: Rà soát lỗi không chặn việc khác của lượt 02:00 | `test/cron-schedule.test.ts` › "lượt cron: hai biểu thức, rà soát 02:00 › rà soát giao dịch qua API SePay › rà soát lỗi không chặn việc khác của lượt 02:00, rồi báo lỗi ra ngoài" |

### [UC-402](notify/UC-402-tin-sang-0700.md) Tin sáng (giờ nhắc, mặc định 07:00)
Status: `implemented` · BR: BR-01, BR-04, BR-06, BR-07

| AC | Test |
|---|---|
| ✅ AC-1: Mỗi người nhận đúng một tin mỗi ngày | `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › gửi đúng 2 người có tg_chat_id, cùng nội dung; chạy lại trong ngày không gửi thêm" |
| ✅ AC-2: Thành viên không có chat_id không nhận tin | `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › thành viên không có tg_chat_id thì không nhận tin" |
| ✅ AC-3: Tin với dữ liệu seed chưa chia lương | `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › chưa chia lương: còn để chi = 0, tiến độ quỹ/phao ban đầu vẫn hiện, đối soát khớp" |
| ✅ AC-4: Thứ tự và câu chữ đầy đủ: việc cần làm trước, thông tin sau | `test/format.test.ts` › "dailyMessage › đủ mọi mục: dòng 💰, rồi việc cần làm, rồi thông tin; đúng câu chữ"; `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › tin dài nhất: tiêu đề ≤ 25, nội dung ≤ 150; cắt từ cuối, giữ việc đứng đầu, kết thúc bằng …" |
| ✅ AC-5: Không có gì để báo → tin 2 dòng | `test/format.test.ts` › "dailyMessage › không có gì cảnh báo → tin ngắn đúng 2 dòng" |
| ✅ AC-6: Sắp vỡ ≥ 80%, sắp giảm dần | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › ví sắp vỡ ≥80% dự kiến tuần"; `test/format.test.ts` › "dailyMessage › atRisk đã sắp theo % giảm dần được giữ nguyên thứ tự truyền vào (cron chịu trách nhiệm sắp)" |
| ✅ AC-7: Chưa gán đếm từ bank_logs pending | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › giao dịch chưa gán đếm từ bank_logs pending" |
| ✅ AC-8: Đối soát lệch lấy từ reconcile | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › đối soát lệch dùng ledger.reconcile(): sổ diễn giải khác giao dịch ngân hàng đã gán" |
| ✅ AC-9: Chuyển tiền cần làm quá 3 ngày | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › lệnh chuyển tiền quá hạn 3 ngày" |
| ✅ AC-10: Ghép cặp hôm qua theo thời điểm giao dịch | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › hôm qua tự ghép cặp chuyển nội bộ (theo `at`, không phải lúc ghi sổ)" |
| ✅ AC-11: Đêm qua vá; lượt soát tuần/tháng ghi rõ | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › đêm qua backfill vá bao nhiêu lấy từ notifications(kind='backfill', day_key=hôm nay); lượt soát tuần ghi rõ"; không có `scope`: `test/format.test.ts` › "dailyMessage › đủ mọi mục: dòng 💰, rồi việc cần làm, rồi thông tin; đúng câu chữ" (nhánh `month`: ⚠ Chưa có test) |
| ✅ AC-12: Giao dịch ngân hàng cần xem tay | `test/format.test.ts` › "dòng giao dịch ngân hàng không đọc được › hiện khi có, và không hiện khi không có" (phần đếm `ingest_error` 24 giờ trong `daily`: ⚠ Chưa có test) |
| ✅ AC-13: Tên được escape HTML ở bản đầy đủ, giữ chữ thật ở bản ngắn | `test/format.test.ts` › "dailyMessage › escape HTML trong tên ví/tài khoản vì tin gửi bằng parse_mode=HTML" |
| ✅ AC-14: Định dạng tiền | `test/format.test.ts` › "formatMoney: vi-VN, dấu trừ U+2212, không làm tròn › %d → %s"; "formatMoney: vi-VN, dấu trừ U+2212, không làm tròn › dấu trừ là U+2212, không phải gạch nối thường" |
| ⚠ AC-15: Ví private không lộ số trong tin gửi chung | ⚠ Chưa có test |
| ✅ AC-16: Ngày 1 nhắc chốt tháng với người thuê chưa chốt | `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › nhắc chốt tháng với người thuê đang ở chưa chốt tháng trước; đã chốt hoặc đã ngừng thì không nhắc"; `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › ngày thường không nhắc chốt tháng người thuê" |
| ✅ AC-17: Mỗi người thuê một dòng trong phần việc cần làm, số dư đúng dấu | `test/format.test.ts` › "dailyMessage › ngày 1: mỗi người thuê chưa chốt tháng trước một dòng nhắc kèm số dư" |
| ✅ AC-18: Giờ mặc định 07:00, đúng một lần | `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › mặc định 07:00: lượt 06:45 chưa gửi, lượt 07:00 gửi, lượt 07:15 không gửi lại" |
| ✅ AC-19: Giờ tự chọn | `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › giờ tự chọn 06:30: lượt 06:15 chưa gửi, lượt 06:30 gửi" |
| ✅ AC-20: Đổi giờ sau khi hôm nay đã gửi không gửi lại | `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › đã gửi rồi mới đổi giờ (sớm hơn hay muộn hơn) thì hôm đó không gửi lại" |
| ✅ AC-21: Tắt tin sáng thì không gửi, ngày thường không ghi mốc | `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › tắt tin sáng: không gửi gì, nhưng ngày 1 vẫn chốt tháng trước từ giờ tin sáng" |
| ✅ AC-22: Giờ trong 01:00–04:00 gửi ở lượt mỗi giờ kế tiếp | `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › giờ trong 01:00–04:00 chạy ở lượt mỗi giờ kế tiếp: 01:30 gửi lúc 02:00" |
| ⚠ AC-23: Tin sáng báo còn nợ; hết nợ thì không có dòng | [`test/format.test.ts`](../test/format.test.ts) › "dailyMessage › tin sáng báo còn nợ X (N khoản), hết nợ thì không có dòng"; phần đếm từ `v_debt_balance` trong `daily`: ⚠ Chưa có test |
| ✅ AC-24: Tin sáng báo người khác nợ mình ngay sau dòng còn nợ; không còn ai nợ thì không có dòng | [`test/format.test.ts`](../test/format.test.ts) › "dailyMessage › tin sáng báo người khác nợ mình X (N khoản) ngay sau dòng còn nợ, không còn ai nợ thì không có dòng"; [`test/cron-daily.test.ts`](../test/cron-daily.test.ts) › "các dòng lấy đúng số từ DB › người khác nợ mình: chỉ cộng khoản đang theo dõi còn phải thu > 0" |
| ✅ AC-25: Bản ngắn khi không có việc cần làm | `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › không có việc: tiêu đề còn để chi tuần này, nội dung báo không có việc và đối soát khớp; thông tin không lên"; `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › chỉ lệch đối soát: nội dung là chỗ lệch" |
| ✅ AC-26: Bản ngắn xếp việc cần làm trước, chỗ lệch sau | `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › việc cần làm theo thứ tự chưa gán → xem tay → chuyển tiền → sắp vỡ → chưa chia → đếm ví → chốt người thuê → quét tháng, rồi chỗ lệch" |
| ✅ AC-27: Bản ngắn không quá 25 / 150 ký tự | `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › tin dài nhất: tiêu đề ≤ 25, nội dung ≤ 150; cắt từ cuối, giữ việc đứng đầu, kết thúc bằng …"; `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › một việc dài hơn cả nội dung thì cắt giữa chừng, vẫn kết thúc bằng …"; `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › tiêu đề không bao giờ quá 25 ký tự" |
| ✅ AC-28: Telegram nhận bản đầy đủ, máy nhận bản ngắn | `test/push.test.ts` › "notifyMembers qua push › tin sáng: Telegram nhận bản đầy đủ, máy nhận bản ngắn mở màn Hôm nay; notifications lưu đúng bản đã gửi" |
| ✅ AC-29: "Còn để chi" âm viết là "đã chi vượt" | `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › còn để chi âm: không viết 'Còn −X' mà nói thẳng đã chi vượt, cả bản ngắn lẫn bản đầy đủ" |

### [UC-403](notify/UC-403-kich-hoat-chot-thang-ngay-1.md) Kích hoạt chốt tháng ngày 1
Status: `implemented` · BR: BR-02, BR-06, BR-07

| AC | Test |
|---|---|
| ✅ AC-1: Quét đúng một lần dù cron chạy hai lần; ví cá nhân và ví âm không bị đụng | `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › quét đúng một lần dù chạy cron hai lần; ví cá nhân không bị đụng" |
| ✅ AC-2: Không có gì để quét thì không có dòng chốt tháng | `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › không có gì để quét thì không có dòng chốt tháng"; `test/format.test.ts` › "dailyMessage › chốt tháng quét được 0 đồng thì không thêm dòng nào" |
| ✅ AC-3: Dòng chốt tháng kèm lệnh chuyển tiền, đúng vị trí | `test/format.test.ts` › "dailyMessage › ngày 1: dòng chốt tháng kèm lệnh chuyển tiền, chỉ hiện khi số quét > 0" |
| ⚠ AC-4: Không phải ngày 1 thì không chốt | ⚠ Chưa có test (gián tiếp: các test `daily` ngày 22/9 không sinh giao dịch `S…`, nhưng không test khẳng định) |
| ✅ AC-5: Tắt tin sáng vẫn chốt tháng ngày 1, đúng giờ tin sáng, một lần | `test/cron-schedule.test.ts` › "giờ nhắc: tin sáng theo giờ ở Cài đặt › tắt tin sáng: không gửi gì, nhưng ngày 1 vẫn chốt tháng trước từ giờ tin sáng" |

### [UC-404](notify/UC-404-nhac-dem-vi-chu-nhat.md) Nhắc đếm ví / nhập số dư Chủ nhật
Status: `implemented` · BR: BR-04, BR-06

| AC | Test |
|---|---|
| ✅ AC-1: Nhắc mọi ví tiền mặt chưa đếm trong 7 ngày; tài khoản có feed không cần đếm | `test/cron-daily.test.ts` › "Chủ nhật: nhắc đếm ví tiền mặt / nhập số dư TK ghi tay › chưa có cash_counts trong 7 ngày → nhắc cả hai ví tiền mặt (tài khoản ngân hàng có feed thì không cần đếm)" |
| ✅ AC-2: Đã đếm trong 7 ngày thì không nhắc lại | `test/cron-daily.test.ts` › "Chủ nhật: nhắc đếm ví tiền mặt / nhập số dư TK ghi tay › đã đếm trong 7 ngày thì không nhắc lại ví đó" |
| ✅ AC-3: Tài khoản ngân hàng ghi tay cũng được nhắc | `test/cron-daily.test.ts` › "Chủ nhật: nhắc đếm ví tiền mặt / nhập số dư TK ghi tay › tài khoản ngân hàng ghi tay cũng được nhắc nhập số dư" |
| ✅ AC-4: Ngày khác không nhắc | `test/cron-daily.test.ts` › "Chủ nhật: nhắc đếm ví tiền mặt / nhập số dư TK ghi tay › không phải Chủ nhật thì không có dòng nhắc" |
| ✅ AC-5: Câu chữ dòng nhắc | `test/format.test.ts` › "dailyMessage › Chủ nhật: nhắc đếm ví/nhập số dư kèm tên tài khoản" |

### [UC-405](notify/UC-405-nhac-khoan-thu-chua-chia-ngay-10-25.md) Nhắc khoản thu chưa chia ngày 10 & 25
Status: `implemented` · BR: BR-02, BR-06

| AC | Test |
|---|---|
| ✅ AC-1: Ngày 10 nhắc nhưng không tự chia | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › ngày 10: nhắc nếu còn income chưa chia, không tự chia" |
| ✅ AC-2: Ngày thường không nhắc | `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › ngày thường (không 10/25) thì không có dòng nhắc income dù còn chưa chia" |
| ⚠ AC-3: Ngày 25 cũng nhắc | ⚠ Chưa có test |

### [UC-406](notify/UC-406-tong-ket-tuan-thu-hai.md) Tổng kết tuần (giờ nhắc, mặc định 08:00 thứ Hai)
Status: `implemented` · BR: BR-01, BR-06

| AC | Test |
|---|---|
| ✅ AC-1: Nội dung tổng kết đúng tuần, top 5 tính spend trừ refund | `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › đã tiêu/dự kiến từng ví phong bì tuần + top 5 danh mục (spend trừ refund), loại tuần khác" |
| ✅ AC-2: Chạy lại cùng tuần không gửi trùng | `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › chạy lại cùng tuần không gửi trùng" |
| ✅ AC-3: Tuần không chi tiêu | `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › tuần không có chi tiêu: vẫn hiện các ví phong bì (0 đồng), không có mục top 5" |
| ✅ AC-4: Định dạng tin tuần và trạng thái rỗng | `test/format.test.ts` › "weeklyMessage › tổng kết tuần: đã tiêu/dự kiến từng ví + top 5 danh mục"; "weeklyMessage › tuần không có dữ liệu chi tiêu: vẫn có tiêu đề, kèm câu trạng thái rỗng" |
| ✅ AC-5: Nhãn tuần luôn kèm khoảng ngày | `test/format.test.ts` › "formatWeekLabel › cùng tháng: T38 (14–20/9)"; "formatWeekLabel › lệch tháng: ghi rõ tháng ở cả hai đầu" |
| ✅ AC-6: Mặc định thứ Hai 08:00, đúng một lần mỗi tuần | `test/cron-schedule.test.ts` › "giờ nhắc: tổng kết tuần › mặc định thứ Hai 08:00: gửi đúng một lần cho tuần vừa qua; ngày khác không gửi" |
| ✅ AC-7: Chủ nhật tổng kết tuần đang kết thúc; đổi thứ sau khi gửi không gửi lại | `test/cron-schedule.test.ts` › "giờ nhắc: tổng kết tuần › chọn Chủ nhật 20:00: tổng kết tuần kết thúc hôm nay; đổi về thứ Hai sau khi gửi thì không gửi lại tuần đó" |
| ✅ AC-8: Tắt tổng kết tuần thì không gửi | `test/cron-schedule.test.ts` › "giờ nhắc: tổng kết tuần › tắt tổng kết tuần thì không gửi" |
| ✅ AC-9: Bản ngắn: tổng chi ở tiêu đề, ví sát dự kiến lên đầu | `test/format.test.ts` › "weeklyMessage › bản ngắn: tiêu đề tổng chi tuần; ví ≥ 80% dự kiến lên đầu (sắp % giảm dần), rồi danh mục tiêu nhiều nhất, rồi ví còn lại"; `test/format.test.ts` › "weeklyMessage › tuần không có dữ liệu chi tiêu: vẫn có tiêu đề, kèm câu trạng thái rỗng"; tổng chi đọc từ DB (W39: chi 400.000 + Grab 80.000 hoàn 20.000, W38 không tính → `Tuần T39: chi 460.000 ₫`, mở `/#wallets`): `test/push.test.ts` › "notifyMembers qua push › tổng kết tuần: máy nhận tiêu đề tổng chi cả tuần (spend trừ refund, mọi danh mục), mở màn Ví" |
| ✅ AC-10: Bản ngắn không quá 25 / 150 ký tự | `test/format.test.ts` › "weeklyMessage › bản ngắn: tổng chi dài thì tiêu đề bỏ chữ Tuần, vẫn ≤ 25; nhiều ví thì nội dung ≤ 150, kết thúc bằng …" |

### [UC-407](notify/UC-407-bao-giao-dich-chua-gan-moi-phut.md) Báo giao dịch chưa gán (mỗi 15 phút, có giờ yên lặng)
Status: `implemented` · BR: BR-03, BR-04, BR-06

| AC | Test |
|---|---|
| ✅ AC-1: Chờ đủ 60 giây để chuyển nội bộ kịp ghép cặp | `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › chuyển nội bộ 2 chân về cách nhau 20 giây → ghép cặp trước khi cron chạy, không có tin 'cần gán'" |
| ✅ AC-2: Chưa đủ 60 giây thì chưa báo | `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › chưa đủ 60 giây thì chưa báo" |
| ✅ AC-3: Báo đúng một lần khi gửi được | `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › báo đúng một lần cho log pending đủ 60 giây, không báo lại lần sau" |
| ✅ AC-4: Telegram hỏng thì thử lại tới khi gửi được, rồi thôi | `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › Telegram lỗi thì lần chạy sau báo lại; báo được rồi thì thôi" |
| ✅ AC-5: Tên tài khoản được escape | `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › tên tài khoản được escape trước khi vào tin HTML" |
| ⚠ AC-6: Cửa sổ thử lại 24 giờ | ⚠ Chưa có test |
| ✅ AC-7: Giới hạn 20 dòng | `test/format.test.ts` › "pendingMessage › nhiều khoản: bản đầy đủ dừng ở 20 dòng; bản ngắn ≤ 150, đuôi … và N khoản" (phần đánh dấu cả 25 log: ⚠ Chưa có test) |
| ⚠ AC-8: Chỉ có máy đã bật thông báo (không Telegram) vẫn tính là đã báo | ⚠ Chưa có test (gián tiếp: `test/push.test.ts` › "notifyMembers qua push › push service trả 410 thì xoá máy đó, claim giữ ok=0; máy khác vẫn nhận" — `notifyMembers` với `pending_batch` trả số máy nhận push) |
| ✅ AC-9: Giờ yên lặng qua nửa đêm: không báo, hết giờ thì gom một tin | `test/cron-schedule.test.ts` › "giờ yên lặng & bật/tắt báo giao dịch chưa gán › về trong giờ yên lặng 22:00–06:30 thì không báo; lượt 06:30 gom lại báo một tin" |
| ✅ AC-10: Giờ yên lặng không qua nửa đêm | `test/cron-schedule.test.ts` › "giờ yên lặng & bật/tắt báo giao dịch chưa gán › khung không qua nửa đêm (12:00–13:30): ngoài khung báo ngay lượt sau, trong khung chờ tới 13:30" |
| ✅ AC-11: Tắt thì không báo; bật lại báo khoản còn chờ | `test/cron-schedule.test.ts` › "giờ yên lặng & bật/tắt báo giao dịch chưa gán › tắt báo giao dịch chưa gán thì không báo kể cả ngoài giờ yên lặng; bật lại thì báo những khoản còn chờ" |
| ✅ AC-12: Biên giờ yên lặng; bắt đầu = kết thúc là không đặt | `test/cron-schedule.test.ts` › "giờ yên lặng & bật/tắt báo giao dịch chưa gán › giờ yên lặng bắt đầu = kết thúc là không đặt; giá trị hỏng trong config thì dùng mặc định" |
| ✅ AC-13: Bản ngắn cho thông báo đẩy | `test/format.test.ts` › "pendingMessage › bản đầy đủ mỗi khoản một dòng; bản ngắn gộp một dòng, tài khoản không rõ là TK lạ"; `test/format.test.ts` › "pendingMessage › nhiều khoản: bản đầy đủ dừng ở 20 dòng; bản ngắn ≤ 150, đuôi … và N khoản"; `test/format.test.ts` › "pendingMessage › escape HTML ở bản đầy đủ, bản ngắn giữ chữ thật" |

### [UC-408](notify/UC-408-gui-telegram-chong-gui-trung.md) Gửi tin Telegram chống gửi trùng
Status: `implemented` · BR: BR-06, BR-08, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Mỗi người nhận một tin cho mỗi (kind, day_key) | `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › gửi đúng 2 người có tg_chat_id, cùng nội dung; chạy lại trong ngày không gửi thêm"; `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › chạy lại cùng tuần không gửi trùng" |
| ✅ AC-2: Chỉ gửi cho thành viên có chat_id | `test/cron-daily.test.ts` › "cron 07:00 VN: gửi tin & chống gửi trùng › thành viên không có tg_chat_id thì không nhận tin" |
| ✅ AC-3: Token đặt ở màn Cài đặt được dùng khi gửi | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › tin Telegram dùng bot token đặt ở màn Cài đặt" |
| ⚠ AC-4: Không có token thì không gửi Telegram, không claim Telegram; push vẫn gửi (MODIFIED v3) | `test/push.test.ts` › "notifyMembers qua push › không có token Telegram vẫn đẩy tới mọi máy; chạy lại cùng (kind, day_key) không gửi thêm" (phần push vẫn gửi khi thiếu token); thiếu token mà có `tg_chat_id` thì không claim Telegram: ⚠ Chưa có test |
| ⚠ AC-5: Luật thử lại theo mã lỗi | ⚠ Chưa có test (gián tiếp: `test/cron-sepay.test.ts` › "cron/pending-notifier — gom log pending ≥ 60 giây › Telegram lỗi thì lần chạy sau báo lại; báo được rồi thì thôi" chỉ khẳng định có gọi) |
| ⚠ AC-6: Gửi hỏng ghi ok = 0 | ⚠ Chưa có test |
| ✅ AC-7: Số trả về cộng cả Telegram lẫn push | `test/push.test.ts` › "notifyMembers qua push › đếm cả Telegram lẫn push" |
| ✅ AC-8: Telegram nhận bản đầy đủ, máy nhận bản ngắn; mỗi kênh lưu đúng bản đã gửi | `test/push.test.ts` › "notifyMembers qua push › tin sáng: Telegram nhận bản đầy đủ, máy nhận bản ngắn mở màn Hôm nay; notifications lưu đúng bản đã gửi" |

### [UC-409](notify/UC-409-bao-luong-ve-da-chia.md) Báo lương về & đã chia
Status: `spec-only` · BR: BR-02, BR-06

| AC | Test |
|---|---|
| ⚠ AC-1: Có tin khi lương về và đã chia | ⚠ Chưa có test (chưa hiện thực) |

### [UC-410](notify/UC-410-gui-thong-bao-day-web-push.md) Gửi thông báo đẩy tới máy đã bật (Web Push)
Status: `implemented` · BR: BR-06, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Khoá VAPID sinh một lần; khoá riêng không bao giờ ra API | `test/push.test.ts` › "khoá VAPID › sinh một lần ở lần GET đầu, giữ nguyên về sau; khoá riêng không bao giờ ra API" |
| ✅ AC-2: Push ký bằng đúng khoá riêng ứng với khoá công khai đã đưa trình duyệt | `test/push.test.ts` › "khoá VAPID › JWT gửi kèm push ký bằng đúng khoá riêng ứng với khoá công khai đã đưa cho trình duyệt" |
| ✅ AC-3: Đăng ký lại cùng endpoint thì cập nhật và chuyển sang người đang gọi | `test/push.test.ts` › "đăng ký máy › cùng endpoint đăng ký lại thì cập nhật (200) và chuyển sang người đang đăng nhập" |
| ✅ AC-4: Từ chối endpoint và khoá sai (MODIFIED v7) | `test/push.test.ts` › "đăng ký máy › từ chối endpoint không phải https và khoá không phải base64url"; `test/push.test.ts` › "đăng ký máy › chỉ nhận endpoint của push service thật (FCM, Mozilla, Apple, Microsoft); URL https khác bị từ chối, không ghi gì" |
| ✅ AC-5: Gỡ theo endpoint, của ai cũng được | `test/push.test.ts` › "đăng ký máy › gỡ theo endpoint, của ai cũng được; gỡ lần hai báo 0" |
| ✅ AC-6: Gửi thử chỉ tới máy của người đang gọi | `test/push.test.ts` › "gửi thử › chỉ gửi tới máy của người đang đăng nhập, ưu tiên cao, ghi last_ok_at" |
| ✅ AC-7: Gửi thử khi mình chưa có máy nào | `test/push.test.ts` › "gửi thử › chưa có máy nào của mình thì 409 no_subscription" |
| ✅ AC-8: Mỗi máy nhận một lần cho mỗi (kind, day_key), không cần Telegram | `test/push.test.ts` › "notifyMembers qua push › không có token Telegram vẫn đẩy tới mọi máy; chạy lại cùng (kind, day_key) không gửi thêm" |
| ✅ AC-9: Push service trả 404/410 thì xoá máy; máy khác vẫn nhận | `test/push.test.ts` › "notifyMembers qua push › push service trả 410 thì xoá máy đó, claim giữ ok=0; máy khác vẫn nhận" |
| ✅ AC-10: Chưa có khoá VAPID thì bỏ qua push, không tự sinh | `test/push.test.ts` › "notifyMembers qua push › chưa có khoá VAPID (chưa ai mở app) thì bỏ qua push, không tự sinh" |
| ✅ AC-11: Máy của thành viên đã nghỉ không nhận | `test/push.test.ts` › "notifyMembers qua push › thành viên đã nghỉ không nhận" |
| ✅ AC-12: Nội dung push là bản ngắn dựng sẵn; đường mở theo loại tin (MODIFIED v6) | `test/push.test.ts` › "nội dung push › giữ nguyên tiêu đề và nội dung đã dựng; đường mở theo loại tin"; `test/push.test.ts` › "notifyMembers qua push › tin sáng: Telegram nhận bản đầy đủ, máy nhận bản ngắn mở màn Hôm nay; notifications lưu đúng bản đã gửi" |
| ⚠ AC-13: Luật thử lại theo mã lỗi | ⚠ Chưa có test |
| ✅ AC-14: Bấm nút trả lời ngay, việc gửi chạy nền; mặc định và kiểm tham số | `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › bấm nút trả lời ngay (mặc định 2 tin cách 10 giây), việc gửi chạy nền qua waitUntil; tham số ngoài khoảng thì 400" |
| ✅ AC-15: Bấm khi chưa có máy / khi đang có lượt | `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › chưa có máy của mình thì 409 no_subscription; đang có lượt chạy thì 409 series_running; huỷ xong thì bấm lại được" |
| ✅ AC-16: `GET /v1/push` trả lượt gần nhất của chính mình | `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › GET /v1/push trả lượt gần nhất của mình (trong 15 phút), không trả của người khác" |
| ✅ AC-17: Gửi đủ số tin, đúng nhịp, tag riêng từng tin | `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › chờ 10 giây rồi gửi tin 1, cách interval_s giây gửi tin 2, tới mọi máy của người hẹn, tag riêng từng tin" |
| ⚠ AC-18: Hai lần cron chồng nhau không gửi trùng (deprecated v3: cron không còn gửi; mỗi lượt chỉ có đúng một việc nền do chính request tạo ra nó chạy) | ⚠ Chưa có test |
| ✅ AC-19: Huỷ giữa chừng thì dừng trước tin kế tiếp | `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › huỷ giữa chừng thì dừng trước tin kế tiếp; huỷ chỉ đụng lượt của mình" |
| ✅ AC-20: Lượt kẹt quá 10 phút thì cron huỷ | `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › lượt cron huỷ lượt kẹt quá 10 phút, không đụng lượt đang chạy, không gửi gì" |
| ✅ AC-21: Không còn máy thì kết thúc | `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › máy bị gỡ trong lúc chờ thì kết thúc, không gửi" |
| ✅ AC-22: Chỉ nhận endpoint của push service thật (ADR-90) | `test/push.test.ts` › "đăng ký máy › chỉ nhận endpoint của push service thật (FCM, Mozilla, Apple, Microsoft); URL https khác bị từ chối, không ghi gì" |
| ✅ AC-23: Nhãn máy lấy từ header của request (ADR-90) | `test/push.test.ts` › "đăng ký máy › nhãn máy lấy từ User-Agent của request, không nhận user_agent trong body" |
| ✅ AC-24: Gỡ máy theo id, của ai cũng được (ADR-90) | `test/push.test.ts` › "đăng ký máy › gỡ một máy theo id, của ai cũng được (máy lạ gỡ được từ Cài đặt); gỡ lại báo 404; có nhật ký" |
| ✅ AC-25: Mỗi người tối đa 10 máy (ADR-90) | `test/push.test.ts` › "đăng ký máy › mỗi người tối đa 10 máy: máy thứ 11 (kể cả máy chuyển từ người khác) bị từ chối 409; đăng ký lại máy đã có vẫn được" |
| ✅ AC-26: Thêm máy mới thì cảnh báo cả nhà; đăng ký lại máy của mình thì không (ADR-90) | `test/push.test.ts` › "đăng ký máy › thêm máy mới (hay chuyển máy sang người khác) thì cảnh báo mọi kênh của cả nhà; đăng ký lại máy của chính mình thì không" |

### [UC-411](notify/UC-411-gui-tin-zalo-bot.md) Gửi tin qua Zalo Bot (nối bằng mã)
Status: `implemented` · BR: BR-06, BR-08, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Webhook chỉ nhận khi đúng khoá; chưa đặt khoá thì khoá hẳn | `test/zalo.test.ts` › "webhook Zalo › thiếu hoặc sai khoá X-Bot-Api-Secret-Token → 401; chưa đặt khoá webhook → khoá hẳn" |
| ✅ AC-2: Nhắn đúng mã còn hạn thì nối đúng người, mã dùng một lần; ghi nhật ký và báo cả nhà (MODIFIED v4) | `test/zalo.test.ts` › "webhook Zalo › nhắn đúng mã còn hạn trong chat riêng → nối zalo_chat_id cho đúng người, mã dùng một lần, bot trả lời đã nối" |
| ✅ AC-3: Mã sai hoặc hết hạn → hướng dẫn, tối đa một lần mỗi chat mỗi ngày | `test/zalo.test.ts` › "webhook Zalo › mã sai hoặc hết hạn → trả lời hướng dẫn, tối đa một lần mỗi chat mỗi ngày, không nối ai" |
| ✅ AC-4: Tin trong nhóm bị bỏ qua | `test/zalo.test.ts` › "webhook Zalo › tin trong nhóm bị bỏ qua: không nối, không trả lời" |
| ✅ AC-5: Payload hỏng vẫn trả 200 | `test/zalo.test.ts` › "webhook Zalo › payload hỏng vẫn trả 200, không ném lỗi" |
| ✅ AC-6: Mã 6 số hạn 15 phút; tạo lại thì mã cũ hết dùng; chưa sẵn sàng thì 409 | `test/zalo.test.ts` › "mã nối Zalo › tạo mã 6 số hạn 15 phút, tạo lại thì mã cũ hết dùng; chưa đặt token và khoá webhook thì báo chưa sẵn sàng" |
| ✅ AC-7: Người đã nối nhận bản đầy đủ dạng chữ thường; chống trùng; đếm vào số đã gửi | `test/zalo.test.ts` › "gửi tin qua Zalo › notifyMembers gửi bản đầy đủ dạng chữ thường cho người đã nối Zalo, chống gửi trùng, đếm vào số đã gửi" |
| ✅ AC-8: `zaloText` bỏ thẻ, trả ký tự đã escape, cắt ở 2000 ký tự | `test/zalo.test.ts` › "gửi tin qua Zalo › zaloText bỏ thẻ, trả ký tự đã escape, cắt ở 2000 ký tự kèm …" |
| ✅ AC-9: 429 thì ghi lỗi, không thử lại | `test/zalo.test.ts` › "gửi tin qua Zalo › Zalo trả 429 thì ghi lỗi, không thử lại" |
| ✅ AC-10: Khoá sai tới ngưỡng thì IP bị chặn trước khi đọc khoá | `test/webhooks.test.ts` › "chặn dò khoá webhook theo IP (ADR-89) › sai khoá lần thứ 20 trong 15 phút → mọi webhook từ IP đó 429 trước khi đọc khoá, kể cả khoá đúng; IP khác vẫn vào"; "chặn dò khoá webhook theo IP (ADR-89) › khoá Zalo sai cũng được đếm; hết 15 phút thì IP đó gửi lại được" |
| ✅ AC-11: Đã nối thì phải bỏ nối trước; mã không đè chat đã nối (ADR-90) | `test/zalo.test.ts` › "mã nối Zalo › người đã nối Zalo thì không tạo được mã — phải bỏ nối trước; mã tạo trước khi người đó nối chat khác không đè chat đó" |
| ✅ AC-12: Một chat nhắn sai mã 5 lần trong 1 giờ thì thôi thử mã tới hết giờ (ADR-90) | `test/zalo.test.ts` › "mã nối Zalo › một chat nhắn sai mã 5 lần trong 1 giờ thì mã đúng cũng không được nhận; hết giờ thì nối được" |

## Truy cập & cấu hình (access)

### [UC-501](access/UC-501-dang-nhap-mat-khau-chung.md) Đăng nhập bằng mật khẩu chung (hoặc mật khẩu riêng) + chọn người
Status: `implemented` · BR: BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Danh sách người không cần đăng nhập, chủ hộ đứng đầu | `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › danh sách người cho màn đăng nhập không cần đăng nhập" |
| ✅ AC-2: Sai mật khẩu bị từ chối, đúng mật khẩu nhận cookie dùng được | `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › sai mật khẩu → 401, đúng → cookie dùng được cho /v1" |
| ✅ AC-3: Cookie giả mạo và đổi mật khẩu làm phiên vô hiệu | `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › cookie bị sửa thì không qua; đổi mật khẩu thì phiên cũ hết hiệu lực" |
| ⚠ AC-4: `member_id` chứa dấu chấm vẫn đăng nhập được | ⚠ Chưa có test |
| ⚠ AC-5: Đúng mật khẩu, chọn người không tồn tại | ⚠ Chưa có test |
| ⚠ AC-6: Thành viên bị tắt mất quyền ngay | ⚠ Chưa có test |
| ✅ AC-7: Sai mật khẩu tới ngưỡng thì IP đó bị chặn, IP khác không | `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › chặn dò mật khẩu (ADR-89) › sai tới lần thứ 10 trong 15 phút từ một IP → 429 kể cả khi đúng mật khẩu; IP khác vẫn vào được; log đếm, không có mật khẩu" |
| ✅ AC-8: Hết cửa sổ 15 phút thì thử lại được; đăng nhập đúng xoá đếm của IP | `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › chặn dò mật khẩu (ADR-89) › hết 15 phút thì được thử lại; đăng nhập đúng xoá đếm của IP đó" |
| ✅ AC-9: Trần chung 30 lần sai mọi IP | `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › chặn dò mật khẩu (ADR-89) › trần chung: 30 lần sai từ nhiều IP trong 15 phút thì mọi IP tạm không đăng nhập được" |
| ✅ AC-10: Đăng xuất mọi máy làm mọi cookie đã phát hết hiệu lực | `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › đăng xuất mọi máy (ADR-89) › mọi cookie đã phát (mọi người, cả máy đang bấm) hết hiệu lực; đăng nhập lại được; API token không bị ảnh hưởng" |
| ✅ AC-11: Đăng xuất mọi máy cần đăng nhập | `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › đăng xuất mọi máy (ADR-89) › cần đăng nhập: không cookie, cookie giả hay gửi form thường đều bị chặn, phiên không đổi" |
| ✅ AC-12: Người chưa có mật khẩu riêng đăng nhập bằng mật khẩu chung như trước | [`test/login.test.ts`](../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-12: người chưa có mật khẩu riêng đăng nhập bằng mật khẩu chung như hiện nay" |
| ✅ AC-13: Người đã có mật khẩu riêng chỉ vào bằng mật khẩu riêng; lỗi không lộ ai có mật khẩu riêng | [`test/login.test.ts`](../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-13: người đã có mật khẩu riêng — mật khẩu chung bị 401, mật khẩu riêng vào được; sai lần nào cũng tính; lỗi không lộ ai có mật khẩu riêng" · "… › AC-13: người lạ — sai mật khẩu thì 401 trước; đúng mật khẩu chung thì 400 unknown_member (giữ E2/AC-5)" |
| ✅ AC-14: Không cần `API_TOKEN` để đăng nhập; khoá ký phiên tự sinh trong D1 | [`test/login.test.ts`](../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-14: khoá ký phiên tự sinh trong D1 › chưa đặt API_TOKEN: đăng nhập đúng thì phiên dùng được; REST bằng token vẫn bị khoá" · "… › khoá 32 byte ngẫu nhiên sinh một lần (hai lần đăng nhập đầu cùng lúc dùng cùng khoá), không API nào trả ra" |
| ✅ AC-15: Phiên chung / phiên riêng; đổi mật khẩu chung chỉ làm hết phiên chung | [`test/login.test.ts`](../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-15: phiên chung / phiên riêng › đổi APP_PASSWORD: phiên vào bằng mật khẩu chung hết hiệu lực, phiên vào bằng mật khẩu riêng vẫn dùng được" · "… › cookie chỉ mang member_id, cờ chung / riêng, session_gen, hạn và chữ ký — không mang băm hay mật khẩu" · "… › cookie chung của người đã có mật khẩu riêng bị từ chối; đổi cờ hay session_gen trong cookie cũng không qua" · "… › đăng xuất mọi máy vẫn đăng xuất cả phiên vào bằng mật khẩu riêng"; chưa thiết lập → 409: [`test/setup.test.ts`](../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-7: chưa thiết lập › POST /v1/session → 409 setup_required; /v1/* cần đăng nhập → 401 như hiện nay" · "… › đăng nhập khi đang bị chặn dò vẫn 429 trước, rồi mới tới 409 setup_required" |
| ✅ AC-16: Đăng xuất mọi máy gỡ cả kết nối Claude của cả nhà (ADR-98) | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-10: gỡ kết nối khi quyền vào đổi › Đăng xuất mọi máy → kết nối Claude của cả nhà bị gỡ" |
| ✅ AC-17: Đổi mật khẩu chung làm hết hiệu lực kết nối uỷ quyền bằng mật khẩu chung (ADR-98) | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-10: gỡ kết nối khi quyền vào đổi › đổi APP_PASSWORD → kết nối uỷ quyền bằng mật khẩu chung hết hiệu lực (401 + grant bị thu hồi); mật khẩu riêng vẫn chạy" |
| ✅ AC-18: Trang uỷ quyền Claude dùng đúng luật đăng nhập này | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-9: trang uỷ quyền › sai mật khẩu → 401, tính vào bộ chặn dò scope login, KV vẫn trống; bị chặn → 429" · "… › người có mật khẩu riêng: mật khẩu chung bị từ chối, mật khẩu riêng vào được (luật UC-501)" |

### [UC-502](access/UC-502-goi-api-bang-token.md) Gọi API bằng Bearer `API_TOKEN`
Status: `implemented` · BR: BR-09, BR-05

| AC | Test |
|---|---|
| ✅ AC-1: Thiếu hoặc sai token bị chặn | `test/app.test.ts` › "/v1/* cần Bearer token › thiếu hoặc sai token → 401" |
| ✅ AC-2: Đúng token thì qua cửa | `test/app.test.ts` › "/v1/* cần Bearer token › đúng token → qua cửa (route chưa có nên 404 dạng JSON)" |
| ✅ AC-3: Chưa cấu hình token thì khoá hẳn | `test/app.test.ts` › "/v1/* cần Bearer token › API_TOKEN chưa cấu hình thì khoá hẳn, kể cả với token rỗng" |
| ✅ AC-4: `X-Member-Id` quyết định người ghi | `test/api.test.ts` › "nhập tay › chi tiền mặt: ví tự điền từ danh mục, tài khoản mặc định là tiền mặt của người nhập, trả về ví còn bao nhiêu" |
| ✅ AC-5: Không có `X-Member-Id` thì người xem là chủ hộ | `test/mcp.test.ts` › "tool đọc số liệu › get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB" |
| ⚠ AC-6: `X-Member-Id` sai bị từ chối | ⚠ Chưa có test |

### [UC-503](access/UC-503-phan-quyen-theo-duong-dan.md) Phân quyền theo đường dẫn & không lộ bí mật qua lỗi
Status: `implemented` · BR: BR-09, BR-10

| AC | Test |
|---|---|
| ✅ AC-1: Chống giả mạo form với phiên cookie | `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › ghi bằng cookie mà không phải JSON thì bị chặn (chống form giả mạo)" |
| ✅ AC-2: Route API không tồn tại trả JSON 404 sau khi xác thực | `test/app.test.ts` › "/v1/* cần Bearer token › đúng token → qua cửa (route chưa có nên 404 dạng JSON)" |
| ⚠ AC-3: Lỗi trên `/mcp/<secret>` không bao giờ log secret (DEPRECATED v8 — ADR-97) | ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97) |
| ✅ AC-4: Settings cần đăng nhập như mọi `/v1` | `test/settings.test.ts` › "đọc cài đặt › cần đăng nhập" |
| ⚠ AC-5: Lỗi bất ngờ không lộ chi tiết | ⚠ Chưa có test (trước v8 chỉ gián tiếp qua AC-3, nay AC-3 đã bỏ) |
| ✅ AC-6: Header bảo mật trên API, webhook, app shell — kể cả phản hồi lỗi | `test/app.test.ts` › "header bảo mật (ADR-89) › API, webhook và app shell qua Worker đều mang CSP, HSTS, nosniff, chặn nhúng khung — kể cả phản hồi lỗi"; "header bảo mật (ADR-89) › web/public/_headers (app shell do Static Assets phục vụ thẳng) giống hệt header Worker gắn" |
| ✅ AC-7: `/v1/setup` không cần đăng nhập | [`test/setup.test.ts`](../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-1: GET /v1/setup không cần đăng nhập — DB chỉ có schema → needed true; có setup_done → needed false, không trả gì khác" · "UC-510 thiết lập nhà lần đầu › AC-7: chưa thiết lập › POST /v1/session → 409 setup_required; /v1/* cần đăng nhập → 401 như hiện nay" |
| ✅ AC-8: Header bảo mật trên đường OAuth / MCP; trang uỷ quyền cho chuyển về đúng ứng dụng | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-503: header bảo mật trên đường OAuth / MCP › token endpoint, metadata, /mcp mang CSP và chặn nhúng khung như mọi phản hồi của Worker"; "UC-601 AC-9: trang uỷ quyền › đăng nhập đúng → cookie phiên app + trang đồng ý: tên miền đã xác minh, tên tự khai, nơi nhận token, hai quyền, Ghi tick sẵn" · "… › redirect về máy (localhost) → cảnh báo; tên tự khai được escape" |
| ✅ AC-9: Đường dẫn chứa khoá cũ và đường OAuth lạ là 404 JSON, không rơi về SPA | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-8: endpoint /mcp, metadata, chỉ CIMD › đường dẫn chứa khoá cũ /mcp/<bất kỳ> → 404 như đường không có; /oauth/, /.well-known/ lạ cũng là 404 JSON" |

### [UC-504](access/UC-504-an-lich-su-vi-private.md) Ẩn lịch sự số dư ví `private`
Status: `implemented` · BR: BR-01, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Ví riêng tư của người kia không có số | `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví riêng tư của người kia không bị đụng (không có số để trừ)" |
| ✅ AC-2: Toast sau khi ghi vào ví ẩn số không nói số dư | `web/src/lib/pending.test.ts` › "toast phản hồi ngân sách › ví tháng, ví ẩn số, snapshot của tuần trước" |
| ⚠ AC-3: Server ẩn số trong snapshot/budget theo người xem | ⚠ Chưa có test phía server (`test/`) |
| ✅ AC-4: Ví `private` của người đã tắt không còn bị ẩn (ADR-96) | [`test/members.test.ts`](../test/members.test.ts) › "UC-504: ví private của người đã tắt không còn bị ẩn › tắt X → người khác thấy số ví private của X ở /v1/snapshot, /v1/budget, /v1/bootstrap; bật lại → ẩn như cũ" |
| ✅ AC-5: Claude nhìn số như người đã uỷ quyền (ADR-97) | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › get_snapshot như trên app của người đó: ví private của người khác bị ẩn" |

### [UC-505](access/UC-505-xem-cau-hinh.md) Xem toàn bộ cấu hình (màn Cài đặt)
Status: `implemented` · BR: BR-08, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Trả đủ các phần, URL webhook theo origin của request | `test/settings.test.ts` › "đọc cài đặt › trả đủ các phần, kèm URL webhook để dán vào SePay" |
| ✅ AC-2: Cần đăng nhập | `test/settings.test.ts` › "đọc cài đặt › cần đăng nhập" |
| ✅ AC-3: Không bao giờ trả nguyên khoá | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › đặt từ màn Cài đặt: chỉ trả lại 2 ký tự cuối, không bao giờ trả nguyên khoá"; "khoá kết nối SePay / Telegram › thêm kết nối SePay thứ hai với token và khoá riêng, không bao giờ trả nguyên khoá; đổi tên, tạm tắt được; khoá webhook trùng kết nối khác bị chặn" |
| ✅ AC-4: Đọc hồ sơ nguồn thu seed | `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › đọc hồ sơ nguồn thu seed; thêm/sửa nguồn; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối" |
| ✅ AC-5: Khoá Zalo chỉ trả 2 ký tự cuối, kèm địa chỉ webhook Zalo (MODIFIED v8) | `test/zalo.test.ts` › "cài đặt Zalo › khoá Zalo không bao giờ trả nguyên văn, chỉ 2 ký tự cuối; khoá webhook chỉ gồm chữ, số, - và _" |
| ✅ AC-6: Nhật ký thay đổi — 50 dòng mới nhất, mới trước (ADR-90) | `test/audit.test.ts` › "nhật ký thay đổi › GET /v1/settings/audit trả 50 dòng mới nhất, mới trước, kèm tên người" |
| ✅ AC-7: Thành viên có `has_password`, không lộ băm (ADR-95) | [`test/members.test.ts`](../test/members.test.ts) › "UC-507 AC-14: GET /v1/settings trả has_password › mỗi thành viên có has_password: boolean, không bao giờ có băm, muối hay số vòng"; [`test/login.test.ts`](../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-14: khoá ký phiên tự sinh trong D1 › khoá 32 byte ngẫu nhiên sinh một lần (hai lần đăng nhập đầu cùng lúc dùng cùng khoá), không API nào trả ra" |
| ✅ AC-8: Cấu hình không chứa gì của kết nối Claude (ADR-97) | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › GET trả địa chỉ MCP và danh sách kết nối (ứng dụng, của ai, quyền, ngày nối) — không có token, mã, khoá" |

### [UC-506](access/UC-506-cau-hinh-tai-khoan-vi-luat-nap.md) Cấu hình tài khoản, ví & luật nạp
Status: `implemented` · BR: BR-08, BR-02, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Thêm tài khoản có SePay; thiếu số hoặc trùng số bị từ chối | `test/settings.test.ts` › "tài khoản › thêm tài khoản MB có SePay; bật SePay mà thiếu số tài khoản thì từ chối; trùng số tài khoản thì từ chối" |
| ✅ AC-2: Không tắt được tài khoản còn ví trú | `test/settings.test.ts` › "tài khoản › sửa số tài khoản mẫu thành số thật; không tắt được tài khoản còn ví trú ở đó" |
| ✅ AC-9: Tài khoản chung của nhà (không gắn chủ) | `test/settings.test.ts` › "tài khoản › tài khoản chung của nhà (bỏ chủ, vd ví tiền mặt chung) lưu được; chủ không có thật thì từ chối" |
| ✅ AC-3: Sửa số tiền phong bì giữ nguyên các trường không gửi | `test/settings.test.ts` › "ví & số tiền nạp › sửa số tiền phong bì Ăn uống" |
| ✅ AC-4: Tổng % Tích sản + Thuế > 100% bị từ chối, không ghi gì | `test/settings.test.ts` › "ví & số tiền nạp › tổng % Tích sản + Thuế vượt 100% thì từ chối — và không ghi gì" |
| ✅ AC-5: Ví nhận phần còn lại là cố định | `test/settings.test.ts` › "ví & số tiền nạp › ví nhận phần còn lại không đổi cách nạp được; không tắt được" |
| ✅ AC-6: Thêm ví tích dồn có mục tiêu; không có Tích sản thứ hai | `test/settings.test.ts` › "ví & số tiền nạp › thêm ví tích dồn Bảo hiểm (quyết định D10) có mục tiêu; không tạo được ví Tích sản thứ hai" |
| ✅ AC-7: Thêm/sửa nguồn thu; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối | `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › đọc hồ sơ nguồn thu seed; thêm/sửa nguồn; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối" |
| ✅ AC-8: Phong bì tháng bật chia theo tuần; ví khác thì không | `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › phong bì tháng bật chia theo tuần; ví tích dồn hay phong bì tuần thì không" |
| ✅ AC-10: Ngân hàng chọn trong danh mục; SePay chỉ bật cho ngân hàng SePay hỗ trợ | `test/settings.test.ts` › "tài khoản › ngân hàng phải chọn trong danh mục; SePay chỉ bật được cho ngân hàng SePay hỗ trợ" |
| ✅ AC-11: "SePay báo cả tiền ra" mặc định theo tài liệu SePay, chủ nhà bật tay được | `test/settings.test.ts` › "tài khoản › SePay báo cả tiền ra: mặc định theo tài liệu SePay (MB chỉ tiền vào, Sacombank cả ra), chủ nhà bật tay được, tắt SePay thì về tắt" |
| ✅ AC-12: Tài khoản bật SePay thuộc đúng một kết nối SePay | `test/settings.test.ts` › "tài khoản › tài khoản bật SePay thuộc một kết nối: không chọn thì về kết nối mặc định, chọn được kết nối khác; kết nối lạ hay đang tắt bị từ chối; tắt SePay thì bỏ" |
| ✅ AC-13: Ngày mở sổ là ngày có thật dạng `YYYY-MM-DD`; bỏ trống là không có mốc (ADR-76) | `test/settings.test.ts` › "tài khoản › ngày mở sổ phải là ngày có thật dạng YYYY-MM-DD (là mốc so ngày giao dịch, ADR-76); bỏ trống thì không có mốc" |
| ✅ AC-14: Tài khoản heo đất đã khóa do migration tạo, chỉ khi nhà có hai thành viên thật của prod; ví "Heo đất" đã tắt, rule heo trỏ Tích sản (ADR-77, ADR-82) | `test/migrations/piggy-bank.test.ts` › "migration 0017 + 0019 + 0020: heo đất › nhà có hai thành viên của prod: mỗi người một tài khoản heo đã khóa, rule cho mọi tài khoản MB thường của đúng chủ chuyển ví Có thì tốt → Tích sản; phao → heo chỉ đổi chỗ (0024)"; `test/migrations/piggy-bank.test.ts` › "migration 0017 + 0019 + 0020: heo đất › DB seed mẫu (không có hai thành viên của prod) chỉ thêm cột, không có heo nào"; dữ liệu như prod khi chạy 0020 (số dư ví sang Tích sản, tắt ví, không còn rule trỏ `heo-dat`): `test/migrations/piggy-bank.test.ts` › "migration 0017 + 0019 + 0020: heo đất › 0020 trên dữ liệu như prod: số dư ví Heo đất sang Tích sản bằng một bút toán hệ thống chỉ đổi ví, rồi tắt ví; tiền thật không đổi" |
| ✅ AC-15: "Tính vào tiền chi được" mặc định bật, thẻ tín dụng mặc định tắt (ADR-85) | [`test/spendable-cash.test.ts`](../test/spendable-cash.test.ts) › "tiền chi được — snapshot và công tắc tài khoản › thêm tài khoản: mặc định tính, thẻ tín dụng mặc định không tính (số dư thẻ là nợ), gửi tay thì theo người gửi"; `test/migrations/milestones.test.ts` › "migrations › 0022 thêm accounts.spendable: tài khoản thường bật, thẻ tín dụng và heo đất (locked) tắt (ADR-85)" |
| ✅ AC-16: Heo đất không bật được "Tính vào tiền chi được" | [`test/spendable-cash.test.ts`](../test/spendable-cash.test.ts) › "tiền chi được — snapshot và công tắc tài khoản › heo đất (tài khoản khóa) không bật được Tính vào tiền chi được; vẫn sửa được tên" |
| ✅ AC-17: Thêm phao dự phòng và sổ tiết kiệm (ADR-88) | [`test/buffer.test.ts`](../test/buffer.test.ts) › "cấu hình tài khoản Tích sản (ADR-88) › thêm phao: không khóa, mặc định không tính vào tiền chi được; sổ tiết kiệm: khóa; heo không thêm tay được; sổ không bật tính được" |
| ✅ AC-18: Đổi tài khoản thường ↔ phao; heo / sổ giữ vai trò (ADR-88) | [`test/buffer.test.ts`](../test/buffer.test.ts) › "cấu hình tài khoản Tích sản (ADR-88) › đổi qua lại tài khoản thường ↔ phao (sang phao thì tắt tính vào tiền chi được); heo / sổ giữ vai trò" |
| ✅ AC-19: Migration 0024 — heo có sẵn là `heo`, MB tiết kiệm (vợ) là phao (ADR-88; giá trị lúc 0024, migration 0028 đổi thành `piggy_bank` / `buffer`) | `test/migrations/milestones.test.ts` › "migrations › 0024 thêm accounts.role: heo đất có sẵn là 'heo'; MB tiết kiệm của vợ là phao, không tính; rule phao → heo thôi chuyển ví; CHECK giữ role khớp locked (ADR-88)" |
| ✅ AC-20: Thêm / sửa tài khoản ghi nhật ký chỉ tên trường (ADR-90) | `test/audit.test.ts` › "nhật ký thay đổi › sửa tài khoản, thành viên, khoá, kết nối SePay chỉ ghi tên trường — không bao giờ ghi khoá; nhật ký không sửa, không xoá được" |
| ✅ AC-21: Thêm phao có số dư đầu: số dư đó vào Tích sản một lần (ADR-91) | [`test/buffer.test.ts`](../test/buffer.test.ts) › "số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91) › thêm phao có số dư đầu 500.000: Tích sản +500.000 bằng một bút toán hệ thống không ví nguồn; Có thì tốt, sổ tài khoản, Tiền chi được không đổi; không số dư hay tài khoản thường thì không ghi" |
| ✅ AC-22: Phần đã là Tích sản không tính lại; đổi sang phao ghi một lần (ADR-91) | [`test/buffer.test.ts`](../test/buffer.test.ts) › "số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91) › Tích sản 300.000 đang ở tài khoản thường: thêm sổ 1.000.000 chỉ ghi 700.000 — Tiền chi được như khi thêm sổ mà không ghi gì"; [`test/buffer.test.ts`](../test/buffer.test.ts) › "số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91) › đổi tài khoản thường có 200.000 sang phao: ghi 200.000; về thường không gỡ; sang phao lần nữa không ghi thêm; sang phao mà vẫn tính vào tiền chi được thì không ghi" |

### [UC-507](access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md) Cấu hình thành viên, mã chuyển khoản, tham số, giờ nhắc
Status: `implemented` · BR: BR-08, BR-02, BR-06

| AC | Test |
|---|---|
| ✅ AC-1: chat_id Telegram phải là dãy số | `test/settings.test.ts` › "thành viên, mã chuyển khoản, tham số › chat_id Telegram phải là dãy số" |
| ✅ AC-2: Sửa mã viết hoa; mã thu nhập phải là mẫu lương | `test/settings.test.ts` › "thành viên, mã chuyển khoản, tham số › sửa mã chuyển khoản; mã tự gán thu nhập phải là mẫu lương (luật 6)" |
| ✅ AC-3: Ngưỡng lương 0 hợp lệ, số tháng Quỹ an tâm phải ≥ 1; khoá cũ bị bỏ qua | `test/settings.test.ts` › "thành viên, mã chuyển khoản, tham số › ngưỡng lương và số tháng phao" |
| ✅ AC-4: Mẫu lương gắn nguồn thu; mã chi thì không gắn được | `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › mẫu lương gắn nguồn thu; mã chi thì không gắn được" |
| ✅ AC-5: Sửa giờ nhắc chỉ đổi trường có gửi | `test/settings.test.ts` › "giờ nhắc (cả nhà) › PATCH chỉ đổi trường có gửi, GET sau đó thấy giá trị mới" |
| ✅ AC-6: Giờ nhắc sai bị từ chối, không ghi gì | `test/settings.test.ts` › "giờ nhắc (cả nhà) › từ chối giờ sai dạng, phút không chia hết cho 15, thứ ngoài 1–7, bật/tắt không phải boolean — không ghi gì" |
| ✅ AC-7: Giờ bội số 15 phút được nhận, kể cả ban đêm | `test/settings.test.ts` › "giờ nhắc (cả nhà) › giờ bội số 15 phút được nhận, kể cả trong 01:00–04:00" |
| ✅ AC-8: Bỏ nối Zalo bằng `zalo_chat_id: null` — báo chat cũ và cả nhà, có nhật ký; không nhập `chat_id` Zalo bằng tay (MODIFIED v8) | `test/zalo.test.ts` › "mã nối Zalo › bỏ nối Zalo bằng zalo_chat_id null — chat cũ và cả nhà được cảnh báo, có nhật ký; không nhập chat_id Zalo bằng tay" |
| ✅ AC-9: Tạo mã nối Zalo; đã nối thì phải bỏ nối trước (MODIFIED v8) | `test/zalo.test.ts` › "mã nối Zalo › tạo mã 6 số hạn 15 phút, tạo lại thì mã cũ hết dùng; chưa đặt token và khoá webhook thì báo chưa sẵn sàng"; `test/zalo.test.ts` › "mã nối Zalo › người đã nối Zalo thì không tạo được mã — phải bỏ nối trước; mã tạo trước khi người đó nối chat khác không đè chat đó" |
| ✅ AC-10: Đổi chat Telegram thì chat cũ, chat mới và cả nhà đều được báo; không đổi thì không báo (ADR-90) | `test/audit.test.ts` › "cảnh báo cả nhà khi kênh báo tin hay khoá đổi › đổi chat Telegram của một người → chat cũ, chat mới và cả nhà đều được báo; mỗi kênh một lần" |
| ✅ AC-11: Thêm người — tối đa 6 người đang hoạt động, không trùng tên hay mã (ADR-96) | [`test/members.test.ts`](../test/members.test.ts) › "UC-507 AC-11: thêm người › POST /v1/settings/members → 201 người lớn, đang hoạt động, mã sinh từ tên; nhật ký member.create, báo cả nhà" · "… › trùng tên (không phân biệt hoa thường) hoặc trùng mã với bất kỳ ai, kể cả người đã tắt → 409 duplicate" · "… › đã có 6 người đang hoạt động → 409 too_many_members; người đã tắt không tính" · "… › có mật khẩu riêng (≥ 8 ký tự) → người mới vào bằng mật khẩu riêng ngay, không qua mật khẩu chung; ngắn hơn → 400"; phía app: [`web/src/lib/members.test.ts`](../web/src/lib/members.test.ts) › "UC-507 AC-11: thêm người › tên bắt buộc, tối đa 40 ký tự; mật khẩu riêng để trống được, có thì ít nhất 8 ký tự" · "… › trùng tên (không phân biệt hoa thường) hoặc trùng mã với bất kỳ ai, kể cả người đã tắt" · "… › đã có 6 người đang dùng thì không thêm được; người đã tắt không tính" · "… › lỗi server: trùng → ô tên; quá 6 người, 429 → câu chung" |
| ✅ AC-12: Tắt / bật lại người — phiên hết hiệu lực, dữ liệu giữ nguyên (ADR-96) | [`test/members.test.ts`](../test/members.test.ts) › "UC-507 AC-12: tắt / bật lại người › tắt → biến khỏi màn đăng nhập, mọi phiên hết hiệu lực ngay, session_gen tăng, ví / tài khoản / giao dịch giữ nguyên; nhật ký, báo cả nhà" · "… › tắt chủ hộ → 409 owner_required, kể cả qua token không kèm X-Member-Id" · "… › tự tắt mình qua cookie → được, phản hồi xoá cookie" · "… › bật lại → đăng nhập lại được (cookie cũ vẫn hết hiệu lực); tính vào giới hạn 6 người; nhật ký member.activate"; nút Tắt / Bật lại ở PWA: ⚠ Chưa có test (giao diện, đã xem tay ở 390px) |
| ✅ AC-13: Đặt / đổi / gỡ mật khẩu riêng (ADR-95) | [`test/members.test.ts`](../test/members.test.ts) › "UC-507 AC-13: đặt / đổi / gỡ mật khẩu riêng › tự đặt bằng mật khẩu hiện tại (chung): lưu băm, phiên cũ hết hiệu lực, phản hồi cấp cookie riêng mới; nhật ký không ghi mật khẩu, không báo cả nhà" · "… › tự đổi: `current` phải là mật khẩu riêng đang dùng; tự gỡ (null) → quay về mật khẩu chung, cookie mới là cookie chung" · "… › mật khẩu chung đúng → đổi / gỡ được cho bất kỳ ai, kể cả chủ hộ quên mật khẩu; đổi cho người khác thì báo cả nhà" · "… › gửi cả hai thì household_password được xét trước" · "… › token REST luôn phải có household_password; `current` không dùng được cho người khác" · "… › sai current / household_password → 401 wrong_password, tính vào bộ chặn dò; đang bị chặn → 429 trước khi so" · "… › null khi người đó chưa có mật khẩu riêng → 200, không đổi gì, không tăng session_gen; mật khẩu ngắn → 400"; phía app: [`web/src/lib/members.test.ts`](../web/src/lib/members.test.ts) › "UC-507 AC-13: đặt / đổi / gỡ mật khẩu riêng › đổi của người khác luôn hỏi mật khẩu chung" · "… › đổi của mình: hỏi mật khẩu đang dùng; chọn dùng mật khẩu chung thì gửi mật khẩu chung" · "… › gỡ gửi password null; mật khẩu mới ít nhất 8 ký tự; phải nhập mật khẩu xác nhận"; [`web/src/lib/api.test.ts`](../web/src/lib/api.test.ts) › "lỗi server: field và 401 › UC-507 AC-13: 401 sai mật khẩu (đổi mật khẩu riêng, thiết lập) không đẩy về màn đăng nhập; 401 hết phiên thì có" |
| ✅ AC-14: Cài đặt cho biết ai dùng mật khẩu riêng, không bao giờ lộ băm | [`test/members.test.ts`](../test/members.test.ts) › "UC-507 AC-14: GET /v1/settings trả has_password › mỗi thành viên có has_password: boolean, không bao giờ có băm, muối hay số vòng" |
| ✅ AC-15: Tắt người hay đổi mật khẩu riêng thì kết nối Claude của người đó bị gỡ (ADR-98) | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-10: gỡ kết nối khi quyền vào đổi › đổi mật khẩu riêng → mọi kết nối của người đó bị gỡ: /mcp 401, refresh chết" · "… › tắt người → kết nối của người đó bị gỡ" |

### [UC-508](access/UC-508-quan-ly-khoa-ket-noi.md) Quản lý kết nối SePay, khoá Telegram, Zalo & gửi thử
Status: `implemented` · BR: BR-08, BR-09, BR-03, BR-06

| AC | Test |
|---|---|
| ✅ AC-1: Chỉ trả 2 ký tự cuối, không bao giờ trả nguyên khoá (MODIFIED v8) | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › đặt từ màn Cài đặt: chỉ trả lại 2 ký tự cuối, không bao giờ trả nguyên khoá" |
| ✅ AC-2: Webhook dùng đúng khoá của app; xoá khoá thì webhook khoá lại | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › webhook dùng đúng khoá đặt ở màn Cài đặt; xoá khoá thì webhook khoá lại" |
| ✅ AC-3: Khoá `wrangler secret` vẫn dùng được, được đánh dấu `server` | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › khoá đặt bằng wrangler secret vẫn dùng được khi màn Cài đặt để trống" |
| ✅ AC-4: Khoá quá ngắn bị từ chối | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › khoá quá ngắn bị từ chối" |
| ✅ AC-5: Tin Telegram dùng bot token của app | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › tin Telegram dùng bot token đặt ở màn Cài đặt" |
| ✅ AC-6: Gửi thử Telegram báo rõ nguyên nhân | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › gửi thử Telegram: báo rõ khi thiếu chat_id, thiếu token, hoặc gửi được" |
| ✅ AC-7: Kiểm tra một kết nối SePay (API v2): liệt kê tài khoản SePay đang nối, đếm theo tài khoản, báo tài khoản chưa nối, báo token sai | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › kiểm tra một kết nối SePay (API v2): liệt kê tài khoản SePay đang nối; tài khoản có trong SePay thì đếm giao dịch 7 ngày; chưa nối thì báo; token sai thì báo" |
| ⚠ AC-8: PWA chỉ cho xoá khoá lưu trong app | ⚠ Chưa có test (UI `web/src/screens/settings-sheets.tsx` › `SecretSheet`) |
| ✅ AC-9: Thêm kết nối SePay thứ hai; không bao giờ trả nguyên khoá; khoá webhook không được trùng | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › thêm kết nối SePay thứ hai với token và khoá riêng, không bao giờ trả nguyên khoá; đổi tên, tạm tắt được; khoá webhook trùng kết nối khác bị chặn" |
| ✅ AC-10: Migration 0015 chuyển khoá SePay cũ sang kết nối mặc định (mã lúc đó `chinh`, 0029 đổi thành `default` — AC-18) | `test/migrations/milestones.test.ts` › "migrations › 0015 chuyển khoá SePay cũ trong config sang kết nối mặc định 'chinh'; tài khoản đang bật SePay thuộc kết nối đó" |
| ✅ AC-11: Khoá Zalo không bao giờ trả nguyên văn; khoá webhook chỉ gồm chữ, số, `-`, `_` | `test/zalo.test.ts` › "cài đặt Zalo › khoá Zalo không bao giờ trả nguyên văn, chỉ 2 ký tự cuối; khoá webhook chỉ gồm chữ, số, - và _" |
| ✅ AC-12: Đặt webhook gọi `setWebhook` đúng địa chỉ và khoá; lỗi Zalo nói dễ hiểu | `test/zalo.test.ts` › "cài đặt Zalo › Đặt webhook gọi setWebhook với địa chỉ /webhooks/zalo và khoá webhook; báo lỗi Zalo dễ hiểu" |
| ✅ AC-13: Gửi thử Zalo báo rõ nguyên nhân | `test/zalo.test.ts` › "cài đặt Zalo › gửi thử Zalo: báo khi chưa nối, chưa có token, hoặc gửi được" |
| ✅ AC-14: Khoá webhook SePay mới cần ít nhất 24 ký tự; khoá ngắn đã lưu vẫn dùng được | `test/settings.test.ts` › "khoá kết nối SePay / Telegram › khoá webhook SePay mới cần ít nhất 24 ký tự; khoá ngắn đã lưu từ trước vẫn nhận webhook (ADR-89)" |
| ✅ AC-15: Đổi khoá / token SePay hay tắt kết nối thì báo cả nhà; chỉ đổi tên thì không (ADR-90) | `test/audit.test.ts` › "cảnh báo cả nhà khi kênh báo tin hay khoá đổi › đặt/đổi khoá webhook, token SePay hay tắt kết nối → mọi kênh được báo; chỉ đổi tên thì không" |
| ✅ AC-16: Đổi bot token Telegram / khoá Zalo thì báo cả nhà (ADR-90) | `test/audit.test.ts` › "cảnh báo cả nhà khi kênh báo tin hay khoá đổi › đổi bot token Telegram / Zalo thì báo cả nhà (qua token mới tới các chat đang có)" |
| ✅ AC-17: Nhật ký khoá và kết nối chỉ ghi tên trường, không bao giờ ghi khoá (ADR-90) | `test/audit.test.ts` › "nhật ký thay đổi › sửa tài khoản, thành viên, khoá, kết nối SePay chỉ ghi tên trường — không bao giờ ghi khoá; nhật ký không sửa, không xoá được" |
| ✅ AC-18: Migration 0029 đổi kết nối mặc định `chinh` → `default`, gửi / nhận không đổi | `test/migrations/system-ids.test.ts` › "migration 0029: mã hệ thống tiếng Anh › kết nối 'chinh' → 'default', danh mục 'tra-no' / 'cho-vay' → 'debt-payment' / 'lending', nguồn 'cho-thue' → 'rental' ở mọi bảng con và config; số chi, sổ nợ, sổ người thuê, ví, sổ tài khoản không đổi; khoá ngoại sạch" · "… › chạy lại không đổi gì thêm" |
| ✅ AC-19: Kết nối `default` vẫn dùng khoá `wrangler secret` dự phòng | `test/migrations/system-ids.test.ts` › "migration 0029: mã hệ thống tiếng Anh › code sau 0029 › GET /v1/settings: kết nối đầu tiên là 'default'; chưa đặt khoá thì dùng khoá wrangler secret dự phòng như 'chinh' trước đây"; hộ mẫu: [`test/schema.test.ts`](../test/schema.test.ts) › "seed › có đủ dữ liệu hệ thống: kết nối SePay 'default' cho mọi tài khoản bật SePay, danh mục trả nợ / cho vay, nguồn thu cho thuê, config rental_* và notify_*" |
| ✅ AC-20: Mục Claude cần đăng nhập | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › cần đăng nhập" |
| ✅ AC-21: Liệt kê kết nối — ứng dụng, của ai, quyền, ngày nối; không token, mã, khoá (ADR-97) | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › GET trả địa chỉ MCP và danh sách kết nối (ứng dụng, của ai, quyền, ngày nối) — không có token, mã, khoá" |
| ✅ AC-22: Gỡ một kết nối — token hết hiệu lực, refresh chết, có nhật ký; kết nối khác còn nguyên (ADR-96, ADR-97) | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › Gỡ một kết nối → token hết hiệu lực, refresh chết; nhật ký mcp.revoke; kết nối khác còn nguyên" |
| ✅ AC-23: Gỡ kết nối không có → 404 | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-508: Cài đặt › Claude và ứng dụng AI › gỡ kết nối không có → 404" |
| ✅ AC-24: Nối mới ghi nhật ký `mcp.connect` gắn người uỷ quyền | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-9: trang uỷ quyền › Cho phép → mã chuyển về Claude; đổi mã lấy token cần đúng code_verifier (PKCE); nhật ký mcp.connect gắn người uỷ quyền" |

### [UC-509](access/UC-509-kiem-tra-song.md) Kiểm tra sống (health)
Status: `implemented` · BR: BR-10

| AC | Test |
|---|---|
| ✅ AC-1: Trả phiên bản schema, không cần token | `test/app.test.ts` › "GET /v1/health › trả phiên bản schema, không cần token" |
| ✅ AC-2: D1 chưa migrate → 503 | `test/app.test.ts` › "GET /v1/health › báo 503 khi D1 chưa chạy migration" |

### [UC-510](access/UC-510-thiet-lap-nha-lan-dau.md) Thiết lập nhà lần đầu
Status: `implemented` · BR: BR-08, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Hỏi đã thiết lập chưa, không cần đăng nhập | [`test/setup.test.ts`](../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-1: GET /v1/setup không cần đăng nhập — DB chỉ có schema → needed true; có setup_done → needed false, không trả gì khác"; PWA: [`web/src/lib/setup.test.ts`](../web/src/lib/setup.test.ts) › "UC-701 AC-8: mở app hỏi GET /v1/setup › needed: true → màn Thiết lập; needed: false → màn đăng nhập" |
| ✅ AC-2: Sai mật khẩu chung hay chưa đặt mật khẩu chung thì không tạo được nhà | [`test/setup.test.ts`](../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-2: sai mật khẩu chung › sai mật khẩu chung → 401 wrong_password, tính một lần sai vào bộ chặn dò, không tạo gì" · "… › APP_PASSWORD chưa đặt hoặc rỗng → luôn 401, bất kể body (kể cả mật khẩu rỗng)" · "… › đang bị chặn dò → 429 kiểm trước khi so, kể cả mật khẩu đúng; không tạo gì" |
| ✅ AC-3: Đúng mật khẩu, dữ liệu hợp lệ → tạo nhà trong một lần ghi, chủ hộ được đăng nhập | [`test/setup.test.ts`](../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-3: đúng mật khẩu, body hợp lệ → 201 chủ hộ + cookie của chủ hộ; thành viên theo thứ tự, mật khẩu riêng lưu băm, tài khoản, setup_done, nhật ký setup.done" · "UC-510 thiết lập nhà lần đầu › AC-3: chủ hộ không có mật khẩu riêng → cookie vào bằng mật khẩu chung; người sau đăng nhập bằng mật khẩu chung" |
| ✅ AC-4: Dữ liệu lỗi → 400 kèm ô lỗi, không tạo gì | [`test/setup.test.ts`](../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-4: body lỗi → 400 invalid_input kèm field, không tạo gì › 0 thành viên" · "… › hơn 6 thành viên" · "… › thiếu members" · "… › tên rỗng" · "… › tên dài hơn 40 ký tự" · "… › tên trùng (không phân biệt hoa thường, bỏ dấu cách hai đầu)" · "… › hai tên ra cùng mã (Mẹ / Me)" · "… › mật khẩu riêng ngắn hơn 8 ký tự" · "… › không có tài khoản" · "… › tên tài khoản rỗng" · "… › tên tài khoản trùng" · "… › tên tài khoản ra cùng mã" · "… › loại tài khoản lạ" · "… › ngân hàng ngoài danh mục" · "… › owner ngoài khoảng chỉ số" · "… › owner âm" · "… › ví Must ngoài danh sách" · "… › ví Must trùng"; phía app: [`web/src/lib/setup.test.ts`](../web/src/lib/setup.test.ts) › "UC-510 AC-4 (phía app): kiểm từng bước trước khi bấm Tiếp › bước 1: phải nhập mật khẩu chung" · "… › bước 2: 1–6 người; tên 1–40 ký tự" · "… › bước 2: tên trùng không phân biệt hoa thường, bỏ dấu cách hai đầu, hoặc ra cùng mã (Mẹ / Me) — báo ở ô sau" · "… › bước 2: mật khẩu riêng để trống được, có thì ít nhất 8 ký tự" · "… › bước 3: ít nhất một tài khoản; tên bắt buộc, không trùng (kể cả cùng mã); người giữ phải là một người ở bước 2" · "… › bước 4: phải trả lời câu thu nhập tự nộp thuế"; [`web/src/lib/setup.test.ts`](../web/src/lib/setup.test.ts) › "UC-510: thân POST /v1/setup › đúng hình dạng: tên đã cắt khoảng trắng, chỉ gửi mật khẩu riêng khi có, ngân hàng chỉ khi không phải tiền mặt, ví Must theo thứ tự cố định" · "… › còn lỗi ở bất kỳ bước nào thì không dựng thân" |
| ✅ AC-5: Chỉ thiết lập được một lần, kể cả hai yêu cầu cùng lúc | [`test/setup.test.ts`](../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-5: đã thiết lập › POST /v1/setup lần nữa (kể cả mật khẩu đúng) → 409 already_setup, không đổi gì" · "… › hai yêu cầu cùng lúc: chỉ một tạo được nhà, yêu cầu kia 409, không lỗi 500" · "… › batch vấp khoá chính của dòng setup_done (yêu cầu kia vừa xong) → 409 already_setup, cả batch huỷ" |
| ✅ AC-6: Bộ ví mẫu "Profit First cơ bản" dùng được ngay | [`test/setup.test.ts`](../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-6: mẫu Profit First cơ bản › có thuế, chọn đủ bốn ví Must: ví, luật nạp, danh mục có icon; mọi ví trú ở tài khoản ngân hàng đầu tiên" · "… › không có thuế, không chọn ví Must, không có tài khoản ngân hàng: không có ví Thuế, chỉ bốn danh mục luôn có, ví trú ở tài khoản đầu tiên" · "… › sau thiết lập ghi được khoản chi ngay; chia thử 10.000.000: Tích sản 1.000.000, Thuế 1.000.000, Có thì tốt nhận phần còn lại" |
| ✅ AC-7: Chưa thiết lập thì không đăng nhập được, phần khác vẫn chạy | [`test/setup.test.ts`](../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-7: chưa thiết lập › POST /v1/session → 409 setup_required; /v1/* cần đăng nhập → 401 như hiện nay" · "… › đăng nhập khi đang bị chặn dò vẫn 429 trước, rồi mới tới 409 setup_required" · "… › REST bằng token và cron chạy không lỗi khi chưa có thành viên" |
| ✅ AC-8: Nhà đang dùng (đã có thành viên) không phải thiết lập lại | `test/migrations/setup-and-passwords.test.ts` › "UC-510 AC-8: migration 0030 trên DB đã có thành viên › ghi setup_done; ngoài schema_version và hai cột mới (password_hash NULL, session_gen 0) không dòng nào đổi; GET /v1/setup → needed false" · "… › đã có dòng setup_done từ trước → INSERT OR IGNORE: migration không lỗi, giữ nguyên giá trị cũ" · "… › DB chưa có thành viên nào → không ghi setup_done (vẫn cần thiết lập)" |

## MCP cho Claude

### [UC-601](mcp/UC-601-noi-claude-bang-oauth.md) Nối Claude (và ứng dụng AI) bằng OAuth
Status: `implemented` · BR: BR-05, BR-09, BR-10

| AC | Test |
|---|---|
| ⚠ AC-1: Sai secret giống hệt route không tồn tại (DEPRECATED v8 — ADR-97) | ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97) |
| ⚠ AC-2: Thiếu secret → 404 (DEPRECATED v8 — ADR-97) | ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97) |
| ⚠ AC-3: Chưa cấu hình `MCP_SECRET` thì khoá hẳn (DEPRECATED v8 — ADR-97) | ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97) |
| ✅ AC-4: Lỗi giao thức trả JSON-RPC, không lọt lên `app.onError` | [`test/mcp.test.ts`](../test/mcp.test.ts) › "transport MCP › request lỗi (Content-Type sai) → transport trả lỗi JSON-RPC 415, không văng lên app.onError" |
| ⚠ AC-5: Không bao giờ log secret (DEPRECATED v8 — ADR-97) | ⚠ Chưa có test (DEPRECATED: đường dẫn chứa khoá đã bỏ, ADR-97) |
| ✅ AC-6: Bắt tay và liệt kê tool không cần phiên | [`test/mcp.test.ts`](../test/mcp.test.ts) › "giao thức MCP › bắt tay initialize" · "… › tools/list trả đúng 16 tool (không cần gọi initialize trước — server không giữ phiên)"; [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem: initialize, tools/list (16 tool) và tool đọc chạy" |
| ✅ AC-7: Chi phí dựng server mỗi request chấp nhận được | [`test/mcp.test.ts`](../test/mcp.test.ts) › "chi phí CPU ước lượng › một lần tools/call (dựng McpServer + zod mới mỗi request) chạy trong thời gian hợp lý" |
| ✅ AC-8: Endpoint `/mcp` đòi token; metadata đúng origin; chỉ đăng ký bằng CIMD | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-8: endpoint /mcp, metadata, chỉ CIMD › gọi /mcp không có token → 401 kèm Bearer challenge trỏ tới metadata của resource" · "… › token rác → 401 kèm Bearer challenge, không phải lỗi JSON-RPC" · "… › metadata resource và authorization server đúng origin; chỉ đăng ký bằng Client ID Metadata Document" · "… › không mở Dynamic Client Registration: POST /oauth/register → 404, KV không có gì" · "… › đường dẫn chứa khoá cũ /mcp/<bất kỳ> → 404 như đường không có; /oauth/, /.well-known/ lạ cũng là 404 JSON" |
| ✅ AC-9: Trang uỷ quyền: đăng nhập bằng mật khẩu của app rồi đồng ý | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-9: trang uỷ quyền › nhà chưa thiết lập → trang báo lỗi, không có form" · "… › chưa đăng nhập → form chọn người + mật khẩu POST về chính địa chỉ này; chưa ghi gì vào KV" · "… › sai mật khẩu → 401, tính vào bộ chặn dò scope login, KV vẫn trống; bị chặn → 429" · "… › người có mật khẩu riêng: mật khẩu chung bị từ chối, mật khẩu riêng vào được (luật UC-501)" · "… › đăng nhập đúng → cookie phiên app + trang đồng ý: tên miền đã xác minh, tên tự khai, nơi nhận token, hai quyền, Ghi tick sẵn" · "… › đã có cookie phiên app → bỏ bước đăng nhập, vào thẳng trang đồng ý" · "… › redirect về máy (localhost) → cảnh báo; tên tự khai được escape" · "… › client không tải được tài liệu / redirect_uri không đăng ký → báo lỗi tại chỗ, không chuyển hướng" · "… › thiếu PKCE (client, redirect đã xác thực) → chuyển về ứng dụng với error, state, iss" · "… › Từ chối → chuyển về ứng dụng với access_denied; không có grant nào" · "… › form đồng ý không giả mạo được: thiếu cookie gắn trình duyệt, hay dùng lại handle → trang lỗi, không cấp mã" · "… › Cho phép → mã chuyển về Claude; đổi mã lấy token cần đúng code_verifier (PKCE); nhật ký mcp.connect gắn người uỷ quyền" |
| ✅ AC-10: Kết nối bị gỡ khi quyền vào của người uỷ quyền đổi | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-10: gỡ kết nối khi quyền vào đổi › refresh token chạy được khi grant còn" · "… › đổi mật khẩu riêng → mọi kết nối của người đó bị gỡ: /mcp 401, refresh chết" · "… › tắt người → kết nối của người đó bị gỡ" · "… › Đăng xuất mọi máy → kết nối Claude của cả nhà bị gỡ" · "… › đổi APP_PASSWORD → kết nối uỷ quyền bằng mật khẩu chung hết hiệu lực (401 + grant bị thu hồi); mật khẩu riêng vẫn chạy" · "… › lớp phòng hậu: session_gen lệch (KV chưa kịp gỡ) → 401 kèm Bearer challenge và grant bị thu hồi để refresh không hồi sinh" · "… › lớp phòng hậu: người đã đặt mật khẩu riêng mà token vào bằng mật khẩu chung → 401" |
| ✅ AC-11: Tool ghi cần quyền Ghi, kiểm ở tầng HTTP | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì" · "… › lô JSON-RPC (mảng) có một tool ghi cũng bị 403 cả lô" · "… › token có Ghi → tool ghi chạy" |

### [UC-602](mcp/UC-602-doc-so-lieu-qua-mcp.md) Đọc số liệu qua MCP (`get_snapshot` = màn Hôm nay)
Status: `implemented` · BR: BR-05, BR-01, BR-07, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: `get_snapshot` trùng `GET /v1/snapshot` của cùng người xem | `test/mcp.test.ts` › "tool đọc số liệu › get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB" |
| ✅ AC-2: `list_categories` trả ví mặc định để map lời nói | `test/mcp.test.ts` › "tool đọc số liệu › list_categories trả danh mục kèm ví mặc định" |
| ⚠ AC-3: `get_budget`, `get_goals`, `get_spending_by_category`, `list_transfer_orders`, `get_reconciliation` trùng REST tương ứng | ⚠ Chưa có test |
| ⚠ AC-4: Kỳ sai định dạng là tool error, không phải HTTP lỗi | ⚠ Chưa có test |
| ✅ AC-5: Mô tả tool không còn chữ sai, tên cũ | `test/mcp.test.ts` › "giao thức MCP › mô tả tool không còn 'chưa triển khai' / 'phase 04', không nhắc tên tool cũ, tên cũ của Tích sản hay chữ khẩn cấp" |
| ✅ AC-6: `get_snapshot` nhìn như người đã uỷ quyền: ví `private` của người khác bị ẩn | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › get_snapshot như trên app của người đó: ví private của người khác bị ẩn" |

### [UC-603](mcp/UC-603-ghi-giao-dich-qua-mcp.md) Ghi giao dịch nhập tay qua MCP
Status: `implemented` · BR: BR-05, BR-03

| AC | Test |
|---|---|
| ✅ AC-1: Thiếu `by_member_id` → người ghi là người đã uỷ quyền kết nối | [`test/mcp.test.ts`](../test/mcp.test.ts) › "add_transaction › thiếu by_member_id → người ghi là người đã uỷ quyền kết nối (UC-603)" |
| ✅ AC-2: `by_member_id` không có thật hoặc đã tắt → tool error | [`test/mcp.test.ts`](../test/mcp.test.ts) › "add_transaction › by_member_id không có thật → tool error"; [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › by_member_id gửi kèm phải là thành viên đang hoạt động" |
| ✅ AC-3: "chi 200k xăng tiền mặt" ghi đúng ví và tài khoản của người ghi | `test/mcp.test.ts` › `add_transaction › "chi 200k xăng tiền mặt" → ghi vào ví đi-lai, tài khoản tiền mặt của người ghi` |
| ⚠ AC-4: Tài khoản có bank feed không nhận nhập tay qua MCP | ⚠ Chưa có test qua MCP (luật nằm ở `createEntry`, xem `specs/ledger/` UC-101) |
| ⚠ AC-5: Sau khi ghi, `get_snapshot` phản ánh khoản chi | ⚠ Chưa có test |
| ✅ AC-6: Thu nhập kèm `tenant_id` → gắn người thuê, tự lấy nguồn thu cho thuê | `test/mcp.test.ts` › "add_transaction › income kèm tenant_id → gắn người thuê, tự lấy nguồn thu cho thuê" |
| ⚠ AC-7: Chuyển ngân sách giữa hai ví qua MCP | ⚠ Chưa có test qua MCP (luật nằm ở `buildEntry`, test REST ở ledger UC-101) |
| ✅ AC-8: Trả nợ qua MCP: `add_transaction` nhận `debt_id` | [`test/mcp.test.ts`](../test/mcp.test.ts) › "sổ nợ › add_transaction nhận debt_id" |
| ✅ AC-9: Nhận lại tiền cho vay qua MCP: `add_transaction` nhận `collect` + `receivable_id` | [`test/mcp.test.ts`](../test/mcp.test.ts) › "sổ phải thu › add_transaction nhận collect + receivable_id; assign_log nhận split collect" |
| ✅ AC-10: Ghi cần quyền Ghi; mỗi lần ghi có nhật ký `via = mcp` mang người uỷ quyền | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì" · "… › token có Ghi → tool ghi chạy"; [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › add_transaction không gửi by_member_id → người ghi là người uỷ quyền; nhật ký via=mcp kèm người đó" |

### [UC-604](mcp/UC-604-gan-log-qua-mcp.md) Gán log ngân hàng qua MCP
Status: `implemented` · BR: BR-05, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Liệt kê log chưa gán | `test/mcp.test.ts` › "tool đọc số liệu › list_pending_logs trả các log chưa gán" |
| ✅ AC-2: Tổng tách sai là tool error, không phải HTTP 500 | `test/mcp.test.ts` › "tool đọc số liệu › assign_log sai (tổng tách không khớp số tiền log) trả lỗi tool, không phải HTTP 500" |
| ⚠ AC-3: Gán đúng qua MCP ghi sổ như REST | ⚠ Chưa có test |
| ⚠ AC-4: Gán tiền người thuê / chuyển kèm ví qua MCP | ⚠ Chưa có test qua MCP (luật được thử ở `test/ingest.test.ts`, ingest UC-305) |
| ✅ AC-5: Gán log tiền vào là nhận lại tiền cho vay qua MCP | [`test/mcp.test.ts`](../test/mcp.test.ts) › "sổ phải thu › add_transaction nhận collect + receivable_id; assign_log nhận split collect" |
| ✅ AC-6: Gán nhận lại tiền cho vay nối về khoản cho vay gốc qua MCP | [`test/mcp.test.ts`](../test/mcp.test.ts) › "sổ phải thu › assign_log nhận link_id trên split như REST: nhận lại nối về khoản cho vay, lấy người của nó; khoản gốc sai → lỗi tool, log vẫn chờ (change 261005-lien-ket-khoan-goc)" |
| ✅ AC-7: Người gán là người đã uỷ quyền; cần quyền Ghi; nhật ký `via = mcp` | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì"; [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền › assign_log ghi người làm là người uỷ quyền, nhật ký via=mcp" |

### [UC-605](mcp/UC-605-chia-thu-nhap-qua-mcp.md) Xem trước & chia thu nhập qua MCP
Status: `implemented` · BR: BR-05, BR-02

| AC | Test |
|---|---|
| ⚠ AC-1: Xem trước không ghi sổ | ⚠ Chưa có test qua MCP |
| ⚠ AC-2: Chia một lần duy nhất | ⚠ Chưa có test qua MCP (REST `POST /v1/allocate` được dùng trong `test/mcp.test.ts` › "tool đọc số liệu › get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB") |
| ⚠ AC-3: Kết quả chia trùng REST | ⚠ Chưa có test |
| ✅ AC-4: Chia thật cần quyền Ghi | [`test/mcp-oauth.test.ts`](../test/mcp-oauth.test.ts) › "UC-601 AC-6, AC-11: quyền xem / ghi › token chỉ Xem gọi tool ghi → HTTP 403 insufficient_scope, challenge ghi đủ mcp:read mcp:write; không ghi gì" |
| ⚠ AC-5: Chia qua MCP có nhật ký `via = mcp` mang người uỷ quyền | ⚠ Chưa có test (test qua MCP mới kiểm nhật ký của `add_transaction`, `assign_log`) |

## PWA

### [UC-701](pwa/UC-701-dang-nhap-dang-xuat-doi-nguoi.md) Đăng nhập, đăng xuất, đổi người trên máy dùng chung
Status: `implemented` · BR: BR-09, BR-03

| AC | Test |
|---|---|
| ⚠ AC-1: Chọn người và nhớ người lần trước | ⚠ Chưa có test |
| ⚠ AC-2: Người khác vào máy thì không thấy số của người trước | ⚠ Chưa có test |
| ⚠ AC-3: Không rõ người lần trước thì coi là người khác | ⚠ Chưa có test |
| ⚠ AC-4: Đăng xuất hỏi lại khi còn khoản chưa lên sổ, và không xoá hàng đợi | ⚠ Chưa có test (việc `cacheClear` không đụng hàng đợi chỉ được xác nhận bằng review: `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md`) |
| ✅ AC-5: Phiên hết hạn đưa về màn đăng nhập mà không mất hàng đợi | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › 401: dừng, giữ nguyên hàng đợi để gửi sau khi đăng nhập lại" |
| ⚠ AC-6: Đăng nhập cần mạng | ⚠ Chưa có test |
| ⚠ AC-7: Đăng xuất mọi máy luôn hỏi lại, rồi đưa mọi máy về màn đăng nhập | ⚠ Chưa có test tự động phía PWA (hook `useLogout(true)` + `logout(true)` chỉ nối nút với API; luật server có test ở access UC-501 AC-10/AC-11). Đã chạy thử 6/10 trên `wrangler dev` + Chromium 390px: đúng như trên; màn rộng 1280px hiện liên kết ở chân thanh bên. |
| ✅ AC-8: DB mới → màn Thiết lập bốn bước, xong vào thẳng Hôm nay | [`web/src/lib/setup.test.ts`](../web/src/lib/setup.test.ts) › "UC-701 AC-8: mở app hỏi GET /v1/setup › needed: true → màn Thiết lập; needed: false → màn đăng nhập" · "… › mất mạng, server lỗi, hay chỉ có bản service worker lưu từ trước → màn đăng nhập như hiện nay" · "UC-701 AC-8: form Thiết lập — bắt đầu › một người, một tài khoản ngân hàng trống, đủ bốn ví Must, chưa trả lời câu thuế" · "UC-701 AC-8: bớt người ở bước 2 giữ đúng người giữ tài khoản › tài khoản của người bị bớt thành chung; chỉ số người sau lùi một" · "UC-701 AC-8: lỗi server hiện đúng ô › field dấu chấm → đúng bước" · "… › 400 có field: lỗi gắn vào ô đó (cả dạng members[0].name), mở đúng bước" · "… › 401 sai mật khẩu chung → ô mật khẩu ở bước 1" · "… › 409 đã thiết lập, 429, mất mạng → câu chung, giữ bước đang đứng"; [`web/src/lib/api.test.ts`](../web/src/lib/api.test.ts) › "lỗi server: field và 401 › UC-701 AC-8: 400 kèm field → ApiError.field chỉ ô lỗi"; [`web/src/lib/sw-fresh.test.ts`](../web/src/lib/sw-fresh.test.ts) › "freshFor: bao lâu service worker trả bản lưu không hỏi mạng › health, thiết lập và phiên luôn hỏi mạng"; vẽ màn, 390px, vào thẳng Hôm nay: ⚠ Chưa có test (giao diện — đã xem tay ở 390px với server giả) |
| ✅ AC-9: Màn đăng nhập không lộ ai dùng mật khẩu riêng | server: [`test/login.test.ts`](../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-13: người đã có mật khẩu riêng — mật khẩu chung bị 401, mật khẩu riêng vào được; sai lần nào cũng tính; lỗi không lộ ai có mật khẩu riêng"; màn đăng nhập: ⚠ Chưa có test (giao diện) |

### [UC-702](pwa/UC-702-xem-hom-nay.md) Xem Hôm nay (điện thoại và bảng điều khiển máy tính)
Status: `implemented` · BR: BR-01, BR-07, BR-04

| AC | Test |
|---|---|
| ⚠ AC-1: Hero là số ra quyết định và đã trừ tạm hàng đợi | `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › chi 250.000 từ Đi lại: khớp đúng số server sẽ tính sau khi ghi"; phần chip: ⚠ Chưa có test |
| ✅ AC-2: Hàng đợi rỗng thì số đúng như server | `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › không có gì trong hàng đợi thì giữ nguyên số của server" |
| ⚠ AC-3: Banner chỉ khi có việc | ⚠ Chưa có test |
| ⚠ AC-4: Banner dẫn thẳng tới chỗ làm | ⚠ Chưa có test |
| ⚠ AC-5: Chạm một phe mở Ví & quỹ đã lọc | ⚠ Chưa có test |
| ✅ AC-6: Ví riêng tư của người kia không bị trừ tạm | `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví riêng tư của người kia không bị đụng (không có số để trừ)" |
| ⚠ AC-7: Màn rộng: log trong Việc cần làm mở đúng log ở màn Gán | ⚠ Chưa có test |
| ✅ AC-8: Hero kê từng phong bì, ví âm lên đầu | `web/src/lib/budget.test.ts` › "các phong bì dưới số còn để chi tuần này › ví âm lên đầu, âm nhiều nhất trước; ví còn dư giữ thứ tự server (kể cả ví bằng 0)" |
| ✅ AC-9: Lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán, cùng luật với tab Tài khoản | [`web/src/lib/drift.test.ts`](../web/src/lib/drift.test.ts) › "lệch đối soát: một luật cho Hôm nay và Tài khoản (ADR-87) › chỉ sổ khác giao dịch ngân hàng đã gán mới là lệch, giữ dấu; 0 hay chưa có giao dịch ngân hàng (null) là không lệch"; [`web/src/lib/drift.test.ts`](../web/src/lib/drift.test.ts) › "lệch đối soát: một luật cho Hôm nay và Tài khoản (ADR-87) › snapshot cũ còn lưu trên máy mang số SePay báo (feedDrift) mà sổ khớp → không báo lệch"; banner, hàng: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ, webhook mang `accumulated` 1.400.000) |
| ✅ AC-10: Số hero âm viết là "đã chi vượt", dòng phụ đếm tuần sau tuần này | `web/src/lib/period.test.ts` › "số hero 'còn để chi tuần này' viết đủ chữ › âm thì đổi nhãn thành 'đã chi vượt' và hiện số dương, không còn '−X' dưới chữ 'còn'"; `web/src/lib/period.test.ts` › "số hero 'còn để chi tuần này' viết đủ chữ › dòng phụ: ngày cuối tuần và số tuần còn lại SAU tuần này (Chủ nhật 4/10/2026: còn 4 tuần, không phải 5)" |
| ✅ AC-11: Khoản thu chưa chia hiện ở Hôm nay, Chia mở khoản cũ nhất | [`test/logs.test.ts`](../test/logs.test.ts) › "gán thu nhập, để chia sau (pwa UC-706, ledger UC-103) › snapshot đếm khoản thu chưa chia: bỏ khoản đã chia và khoản đã huỷ, khoản cũ nhất trước" (server); banner, hàng: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ) |
| ✅ AC-12: Card Tiền chi được kê đủ dòng, chỉ dòng trừ ≠ 0, âm nói "thiếu" (ADR-85) | [`web/src/lib/spendable-cash.test.ts`](../web/src/lib/spendable-cash.test.ts) › "Tiền chi được ở Hôm nay (ADR-85, ADR-88) › kê từng tài khoản đang tính theo thứ tự server, rồi trừ Tích sản và Thuế đang giữ; câu Không tính gộp heo đất, kể phao theo tên, nói phần Tích sản không trừ lại"; [`web/src/lib/spendable-cash.test.ts`](../web/src/lib/spendable-cash.test.ts) › "Tiền chi được ở Hôm nay (ADR-85, ADR-88) › dòng trừ bằng 0 thì không hiện; không có Tích sản nằm ngoài thì chỉ kể tên, nhãn trừ Tích sản không kèm ngoặc; tính hết thì không có câu Không tính"; [`web/src/lib/spendable-cash.test.ts`](../web/src/lib/spendable-cash.test.ts) › "Tiền chi được ở Hôm nay (ADR-85, ADR-88) › âm: số to là phần thiếu (dương), câu nói rõ đang thiếu bao nhiêu"; [`web/src/lib/spendable-cash.test.ts`](../web/src/lib/spendable-cash.test.ts) › "Tiền chi được ở Hôm nay (ADR-85, ADR-88) › tài khoản lệch đối soát thì có dòng phụ nhắc Đối soát; lệch bằng 0 / null hay tài khoản không tính thì không"; card trên màn: ⚠ Chưa có test (đã xem tận mắt 390px trên `wrangler dev` cục bộ, DB mới có phao) |

### [UC-703](pwa/UC-703-nhap-nhanh-khoan-chi.md) Nhập nhanh khoản chi (3 chạm)
Status: `implemented` · BR: BR-03, BR-01

| AC | Test |
|---|---|
| ⚠ AC-1: Ba chạm để ghi một khoản tiền mặt | `web/src/lib/categories.test.ts` › "tự điền ví và tài khoản › vợ chọn Tụ tập / cà phê → ví Chơi (vợ), tài khoản Tiền mặt (vợ)"; luồng chạm: ⚠ Chưa có test |
| ✅ AC-2: Lưới 6 danh mục theo tần suất | `web/src/lib/categories.test.ts` › "6 danh mục hay dùng nhất › tần suất 30 ngày lên đầu, lấy đúng 6"; "6 danh mục hay dùng nhất › chưa có dữ liệu thì theo thứ tự cấu hình"; "6 danh mục hay dùng nhất › hoà tần suất thì theo sort" |
| ✅ AC-3: Không bao giờ mặc định vào tài khoản mà chiều tiền đó tự về | `web/src/lib/categories.test.ts` › "tài khoản nhập tay được › chiều tiền SePay báo về thì ẩn: tiền vào ẩn mọi tài khoản đã nối; tiền ra chỉ ẩn tài khoản SePay báo cả tiền ra" |
| ✅ AC-4: Toast nói kết quả kèm hệ quả | `web/src/lib/pending.test.ts` › "toast phản hồi ngân sách › đúng câu của DESIGN.md khi có mức tuần"; "toast phản hồi ngân sách › vượt mức thì nói số âm, không làm dịu"; "toast phản hồi ngân sách › ví tháng, ví ẩn số, snapshot của tuần trước" |
| ✅ AC-5: Offline vẫn có phản hồi ngân sách | `web/src/lib/pending.test.ts` › "toast phản hồi ngân sách › offline: vẫn báo ví còn bao nhiêu, kèm chờ đồng bộ" |
| ⚠ AC-6: Không lưu được vào máy thì không mất số | `web/src/offline/idb.test.ts` › "hàng đợi khi không có IndexedDB › localStorage đầy hoặc bị chặn → báo lỗi, không nuốt"; phần giữ form: ⚠ Chưa có test |
| ✅ AC-7: Ô số tiền gõ tự nhiên và chặn trần | `web/src/lib/money.test.ts` › "nhập số › ô nhập gốc: gõ số hiện nhóm chấm, xoá hết thì trống"; "nhập số › chặn vượt trần: giữ số trước đó"; "nhập số › nút nhanh và +000" |
| ✅ AC-8: Ngày chọn lùi rơi đúng ngày | `web/src/lib/period.test.ts` › "nhãn kỳ › ngày chọn lùi lấy 12:00 giờ VN, hôm nay giữ giờ thật" |
| ⚠ AC-9: Lưu xong sẵn sàng cho khoản kế tiếp | ⚠ Chưa có test |
| ⚠ AC-10: Gõ phép tính trong ô số tiền | `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › cộng trừ nhân cùng đơn vị đồng như ô hiện, nhân trước cộng sau"; "phép tính trong ô số tiền › dấu phép tính ở cuối khi đang gõ: hiện kết quả trước đó, không báo sai"; "phép tính trong ô số tiền › số thường không thành phép tính: gõ, dán số có dấu chấm hay dấu trừ đứng đầu vẫn như cũ"; ô + chip + rời ô: ⚠ Chưa có test |
| ⚠ AC-11: Phép tính sai thì không lưu được | `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › không ra số tiền hợp lệ thì null: kết quả ≤ 0, vượt trần, hai dấu liền nhau, ký tự lạ"; nút tắt: ⚠ Chưa có test |
| ⚠ AC-12: Phép tính dài vẫn đọc được: số nhóm chấm, thấy phần cuối | `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › mỗi số trong phép tính nhóm chấm khi gõ, kết quả không đổi"; "phép tính trong ô số tiền › con trỏ giữ đúng chỗ khi dấu chấm thêm vào hay bớt đi"; cuộn tới phần cuối: ⚠ Chưa có test |
| ✅ AC-13: Giao dịch gần đây chia trang, cỡ trang chọn được | `web/src/lib/tx-paging.test.ts` › "phân trang Giao dịch gần đây › cỡ trang đã lưu chỉ nhận 5/10/20/50/100, còn lại về mặc định 10"; "phân trang Giao dịch gần đây › đọc thừa một dòng; trang sau theo con trỏ before; khoản đã xoá chỉ khi bật"; "phân trang Giao dịch gần đây › dòng thừa báo còn trang sau và không hiện; đủ hoặc thiếu thì là trang cuối"; luồng bấm trên giao diện: ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-03, 390×844 và 1280×900, sáng/tối) |

### [UC-704](pwa/UC-704-hang-doi-nhap-offline.md) Hàng đợi nhập offline và đồng bộ
Status: `implemented` · BR: BR-03, BR-04, BR-01

| AC | Test |
|---|---|
| ✅ AC-1: Offline 3 khoản → online → đúng 3 giao dịch | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › tắt mạng nhập 3 khoản → bật mạng → server có đúng 3 giao dịch, gửi lại không sinh trùng"; server: `test/api.test.ts` › "nhập tay › gửi lại cùng client_id (hàng đợi offline) chỉ ghi một lần" |
| ✅ AC-2: Mất phản hồi sau khi server đã ghi | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › server ghi rồi mà phản hồi mất: khoản nằm lại, lần sau gửi lại vẫn chỉ một giao dịch" |
| ✅ AC-3: Phân loại phản hồi | `web/src/offline/queue.test.ts` › "phân loại phản hồi › các trường hợp" |
| ✅ AC-4: Bị từ chối thì nằm lại kèm lý do, không chặn khoản khác, chỉ gửi lại khi người bấm | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › bị từ chối (4xx có mã) thì nằm lại kèm lý do, các khoản khác vẫn đi" |
| ✅ AC-5: 5xx không chặn khoản sau, mất mạng dừng cả lượt | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › lỗi 5xx: giữ lại để thử sau nhưng không chặn khoản phía sau; mất mạng thì dừng cả loạt" |
| ✅ AC-6: Trình duyệt báo offline thì không gửi gì | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › trình duyệt báo offline thì không gửi gì" |
| ✅ AC-7: Chỉ gửi khoản của người đang đăng nhập; đổi người giữa lượt thì dừng | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › chỉ gửi khoản của người đang đăng nhập"; "đổi người giữa lúc đang gửi › dừng ngay, không gửi các khoản còn lại của người trước dưới phiên người sau" |
| ✅ AC-8: Đồng bộ chồng nhau không gửi trùng; khoản thêm giữa lượt được gửi luôn | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › gọi đồng bộ chồng nhau (online + visibility + bấm tay) không gửi một khoản hai lần"; "hàng đợi nhập offline › khoản thêm vào trong lúc đang đồng bộ được gửi luôn trong lượt đó" |
| ✅ AC-9: Đúng thứ tự nhập | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › gửi theo đúng thứ tự nhập" |
| ⚠ AC-10: Chỉ mất khi người chủ động bỏ | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › bỏ một khoản chỉ khi người dùng chủ động bỏ"; xác nhận hai bước trên giao diện: ⚠ Chưa có test |
| ✅ AC-11: Không có IndexedDB vẫn giữ được khoản | `web/src/offline/idb.test.ts` › "hàng đợi khi không có IndexedDB › lùi về localStorage và đọc lại được" |
| ✅ AC-12: Trừ tạm khớp công thức server | `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví nhận phần dư (không có mức tuần) cũng khớp công thức chia theo tuần còn lại"; "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › khoản của tuần trước chỉ trừ số dư, không cộng vào đã chi tuần này"; "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › bảng ngân sách tuần / tháng cộng khoản chờ vào thực tế" |
| ✅ AC-13: Giao diện được báo mỗi khi hàng đợi đổi | `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › báo thay đổi hàng đợi cho giao diện" |
| ⚠ AC-14: Quay lại app không trừ hai lần | ⚠ Chưa có test (chỉ đọc mã: `start` trong `web/src/state/store.ts:311`) |
| ⚠ AC-15: Toast nút Đồng bộ nói đúng kết quả | ⚠ Chưa có test |
| ⚠ AC-16: Dòng "vừa ghi" không còn nói "chờ đồng bộ" khi khoản đó bị từ chối hay đã lên sổ | `web/src/lib/pending.test.ts` › "dòng 'vừa ghi' của khoản chờ đồng bộ khi hàng đợi đổi › còn chờ thì giữ; bị từ chối thì xoá; lên sổ (rời hàng đợi) thì thành câu đã ghi"; nối vào `syncer.onChange`: ⚠ Chưa có test |

### [UC-705](pwa/UC-705-nhap-loai-khac.md) Nhập loại khác — thu nhập, hoàn tiền, mua tài sản, cho vay, chuyển nội bộ
Status: `implemented` · BR: BR-02, BR-03, BR-07

| AC | Test |
|---|---|
| ⚠ AC-1: Thu nhập chỉ ghi được khi đã xem bảng chia thử | ⚠ Chưa có test |
| ⚠ AC-2: "Đã bù X" hiện ở bảng chia thử | ⚠ Chưa có test |
| ⚠ AC-3: Chia lỗi không ghi khoản thu hai lần | ⚠ Chưa có test |
| ⚠ AC-4: Chuyển nội bộ phải là hai tài khoản khác nhau | ⚠ Chưa có test |
| ✅ AC-5: Hoàn tiền trả lại ví đã trừ | `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví nhận phần dư (không có mức tuần) cũng khớp công thức chia theo tuần còn lại" |
| ⚠ AC-6: Bốn loại ghi được khi offline | ⚠ Chưa có test |
| ✅ AC-7: Tài khoản thu nhập mặc định là ngân hàng của người nhập | `web/src/lib/categories.test.ts` › "tự điền ví và tài khoản › tài khoản nhận thu nhập mặc định là ngân hàng của người đang nhập" |
| ⚠ AC-8: Nguồn thu chọn tay quyết định phần khóa | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối"; `test/allocation.test.ts` › "chia theo nguồn thu › stream null y hệt không khai báo nguồn"; ô chọn: ⚠ Chưa có test |
| ⚠ AC-9: Người thuê trả mà không chọn nguồn → nguồn cho thuê | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; chia thử theo nguồn cấu hình: ⚠ Chưa có test |
| ✅ AC-10: Người thuê chi gửi số dương, chỉ danh mục chi chung | `web/src/lib/rental.test.ts` › "dòng ghi tay › người thuê chi hộ: gửi số dương, phải thuộc danh mục chi chung"; `test/rental.test.ts` › "/v1/rental › dòng ghi tay idempotent theo client_id; chi hộ chỉ nhận danh mục chi chung" |
| ⚠ AC-11: Người thuê chi cần mạng | ⚠ Chưa có test |
| ✅ AC-12: Ô tài khoản theo chiều tiền (ADR-66) | `web/src/lib/categories.test.ts` › "tài khoản nhập tay được › chiều tiền SePay báo về thì ẩn: tiền vào ẩn mọi tài khoản đã nối; tiền ra chỉ ẩn tài khoản SePay báo cả tiền ra" (hàm lọc; màn hình chỉ gọi đúng chiều — không có test UI) |
| ⚠ AC-13: Sheet mở thẳng một việc không hỏi lại loại | ⚠ Chưa có test |
| ⚠ AC-14: Chuyển nội bộ không mặc định hai tài khoản trùng nhau | ⚠ Chưa có test |
| ⚠ AC-15: Cho vay / Nhận lại tiền cho vay gắn khoản phải thu, không mang ví | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › thân giao dịch cho vay / nhận lại: cần số tiền và tài khoản, gắn khoản phải thu nếu có, không mang ví"; [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › chọn sẵn khoản được mở từ, không thì khoản còn phải thu nhiều nhất; ai cũng đã trả đủ thì không chọn ai; bootstrap cũ không có trường thì null"; sheet: ⚠ Chưa có test |
| ✅ AC-16: Toast và nhãn ô chọn nói còn bao nhiêu chưa trả | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › toast sau khi nhận lại: còn bao nhiêu chưa trả, hoặc đã trả đủ (trả dư cũng là đủ)"; [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › nhãn ô chọn khoản: còn bao nhiêu; trả dư bao nhiêu; 0 thì chỉ tên (người mới chưa nợ gì không thành 'đã trả đủ')" |
| ⚠ AC-17: Ô số tiền trong sheet gõ được phép tính | `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › cộng trừ nhân cùng đơn vị đồng như ô hiện, nhân trước cộng sau"; "phép tính trong ô số tiền › không ra số tiền hợp lệ thì null: kết quả ≤ 0, vượt trần, hai dấu liền nhau, ký tự lạ"; sheet: ⚠ Chưa có test |
| ✅ AC-18: Ghi thu nhập, để chia sau | `web/src/lib/splits.test.ts` › "gán thu nhập, để chia sau › toast nói tiền nằm ở ví Thu nhập, chưa chia, và chia ở đâu"; nút: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |
| ✅ AC-19: Hoàn tiền, Cho vay, Nhận lại dùng chung ô chọn với màn Gán | [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả lại cho khoản chi › dòng chênh: trả hơn +, trả kém −, phần chênh nằm lại trong danh mục; trả đúng thì trả đủ"; [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › dòng dưới ô Ai trả / Cho ai vay: còn nợ trước và sau khoản này; nhận lại vượt số còn nợ thì báo phần dư của lần trả này"; [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › trả dư: nhận lại đúng số còn nợ, phần dư là Thu nhập (màn Gán tách dòng, Loại khác ghi riêng); Hoàn tiền chỉ cho chia bill có phần mình (ADR-84)"; sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |
| ✅ AC-20: Nhận lại tiền cho vay chỉ đúng khoản cho vay gốc | [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › dòng dưới ô Trả cho khoản cho vay: cho vay X · trả lại Y · còn Z, trả dư Z, hoặc trả đủ"; [`test/receivables.test.ts`](../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › nhận lại có link_id về khoản cho vay: không chọn người thì lấy người của khoản cho vay; khác người, trỏ khoản chi hay khoản đã huỷ → invalid_link; sửa giữ liên kết" (server); sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ — gồm đổi loại qua lại) |
| ⚠ AC-21: Tên người mới chưa bấm Thêm người không bị mất, không ghi khi chưa có người | ⚠ Chưa có test (repo chưa có test giao diện; đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |
| ✅ AC-22: Chuyển nội bộ vào tài khoản Tích sản nhắc tiền thành Tích sản; tài khoản Tích sản không là mặc định (ADR-88) | [`web/src/lib/wealth-building-accounts.test.ts`](../web/src/lib/wealth-building-accounts.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › từ tài khoản thường vào phao / sổ / heo: nhắc tiền vào là Tích sản, ví Có thì tốt chuyển sang Tích sản"; [`web/src/lib/wealth-building-accounts.test.ts`](../web/src/lib/wealth-building-accounts.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › rút ra, gửi phao → sổ, tất toán sổ → phao, chuyển giữa hai tài khoản thường, chưa chọn tài khoản: không nhắc (chỉ đổi chỗ)"; [`web/src/lib/categories.test.ts`](../web/src/lib/categories.test.ts) › "tài khoản nhập tay được › tài khoản Tích sản (heo đất, phao — ADR-88) không bao giờ là mặc định khi còn tài khoản khác, dù tên đứng trước"; dòng nhắc trên sheet: ⚠ Chưa có test (repo chưa có test giao diện; đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |

### [UC-706](pwa/UC-706-gan-giao-dich-ngan-hang.md) Gán giao dịch ngân hàng (màn Gán)
Status: `implemented` · BR: BR-03, BR-04, BR-02

| AC | Test |
|---|---|
| ⚠ AC-1: Rỗng là thành tựu | ⚠ Chưa có test |
| ✅ AC-2: Tổng các dòng phải khớp đúng số tiền log | `web/src/lib/splits.test.ts` › "tách log: tổng phải khớp số tiền log › thiếu thì chặn và nói thiếu bao nhiêu"; "tách log: tổng phải khớp số tiền log › khớp đúng thì cho gán"; "tách log: tổng phải khớp số tiền log › thừa thì chặn" |
| ✅ AC-3: Mỗi dòng đủ thông tin theo loại | `web/src/lib/splits.test.ts` › "tách log: tổng phải khớp số tiền log › mỗi dòng phải đủ thông tin theo loại" |
| ⚠ AC-4: Rút tiền mặt là chuyển nội bộ, không phải chi tiêu | `web/src/lib/splits.test.ts` › "tách log: tổng phải khớp số tiền log › rút tiền mặt: một dòng chuyển nội bộ đủ số"; nút: ⚠ Chưa có test |
| ⚠ AC-5: Tiền vào luôn phải hỏi | ⚠ Chưa có test |
| ⚠ AC-6: Log nghi trùng được đánh dấu, người quyết định | ⚠ Chưa có test |
| ⚠ AC-7: Thu nhập qua Gán được chia ngay và không chia hai lần | ⚠ Chưa có test |
| ⚠ AC-8: Bỏ qua cần hai bước | ⚠ Chưa có test |
| ⚠ AC-9: Gán cần mạng | ⚠ Chưa có test |
| ⚠ AC-10: Tiền người thuê chỉ được gợi ý | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán"; `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ dùng cho tiền vào"; chip/banner: ⚠ Chưa có test |
| ✅ AC-11: Gán cho người thuê vào nguồn cho thuê | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền vào cho người thuê → nguồn cho thuê mặc định, chia 100% vào Thu cho thuê, số dư người thuê giảm" |
| ✅ AC-12: Chuyển nội bộ kèm chuyển ví: đủ hai ví hoặc không ví nào | `web/src/lib/splits.test.ts` › "tách log: tổng phải khớp số tiền log › chuyển kèm ví: đủ cả hai ví khác nhau, hoặc không ví nào"; `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền ra thành chuyển khoản kèm chuyển ví Thu cho thuê → Tích sản" |
| ⚠ AC-13: Nguồn thu chọn được khi gán thu nhập | ⚠ Chưa có test |
| ⚠ AC-14: Chip và câu chữ không lộ khoá kỹ thuật; "phải hỏi" không dùng màu đỏ | ⚠ Chưa có test |
| ⚠ AC-15: Gán log tiền vào là nhận lại tiền cho vay — không thành thu nhập, không chia | [`test/logs.test.ts`](../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền vào là nhận lại tiền cho vay (collect): trừ khoản phải thu, không thành thu nhập, không chia, ví không đổi" (server); sheet: ⚠ Chưa có test |
| ⚠ AC-16: Gợi ý chuyển nội bộ điền sẵn: bỏ heo kèm chuyển ví Có thì tốt → Tích sản; rút heo về chỉ chuyển tài khoản (ADR-77, ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › MB chỉ báo tiền vào (sepay_out = 0 như prod): giữ chờ, gợi ý điền sẵn đúng chuyển nội bộ + chuyển ví; gán theo gợi ý ra cùng kết quả" (server); [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "rút heo về tài khoản › tiền vào khớp mẫu heo: không tự gán, gợi ý chỉ chuyển tài khoản heo → tài khoản này; tiền vẫn thuộc Tích sản" (server); [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "rút heo về tài khoản › MB tất toán sổ tích lũy (nội dung thật): cùng gợi ý rút heo của chính chủ về tài khoản" (server); `initialRows`, chip, banner: ⚠ Chưa có test |
| ⚠ AC-17: Toast sau khi gán nói hệ quả; số lệnh chuyển tiền là tổng đang chờ | `web/src/lib/splits.test.ts` › "toast sau khi gán: kết quả kèm hệ quả › một dòng chi: số tiền, danh mục, ví còn bao nhiêu"; "toast sau khi gán: kết quả kèm hệ quả › chuyển nội bộ và tách nhiều dòng"; "toast sau khi gán: kết quả kèm hệ quả › thu nhập: 'Còn N lệnh' là tổng lệnh đang chờ, không chỉ lệnh của lần chia này"; tải lại số trước toast: ⚠ Chưa có test |
| ✅ AC-18: Chân còn lại của chuyển nội bộ đã ghi — chip, banner, dòng mặc định; gán là gắn (ADR-81) | [`test/ingest.test.ts`](../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › chân thứ hai đang chờ (như prod sau khi gỡ giao dịch ghi lần hai): gợi ý khớp; gán tay thì gắn vào giao dịch đã ghi" (server); chip, banner, dòng mặc định, toast: ⚠ Chưa có test (đã xem tận mắt ở 390px) |
| ✅ AC-19: Chỉ log rút tiền mới được gợi ý Rút tiền mặt; trả QR mặc định Chi tiêu | `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền ra không khớp gì → không gợi ý loại, chỉ còn lời nhắc; nội dung rút ATM thì gợi ý Rút tiền mặt kèm lời nhắc" (server); chip, dòng mặc định: ⚠ Chưa có test (đã xem tận mắt ở màn rộng 1280px, `wrangler dev` cục bộ) |
| ✅ AC-20: Gán thu nhập, để chia sau | [`test/logs.test.ts`](../test/logs.test.ts) › "gán thu nhập, để chia sau (pwa UC-706, ledger UC-103) › gán mà không gọi /v1/allocate: khoản thu nằm ở ví Thu nhập, chưa chia, còn để chi không đổi; chia sau vẫn được" (server); `web/src/lib/splits.test.ts` › "gán thu nhập, để chia sau › toast nói tiền nằm ở ví Thu nhập, chưa chia, và chia ở đâu"; nút: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ) |
| ✅ AC-21: Mỗi loại có đúng một dòng giải thích; mua hộ là Cho vay, chia bill có phần mình là Chi tiêu + Hoàn tiền (ADR-84) | `web/src/lib/splits.test.ts` › "chữ nhắc dưới hàng chip 'Gán thành' › mỗi loại của mỗi chiều có đúng một dòng giải thích riêng; tiền vào có Thu từ người thuê"; "chữ nhắc dưới hàng chip 'Gán thành' › mua hộ người khác (nhà mình không có phần) là Cho vay, chia bill có phần mình là Chi tiêu + Hoàn tiền; trả dư tách Thu nhập (ADR-84)"; dòng `.fhint` trong sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px) |
| ✅ AC-22: Hoàn tiền chỉ rõ khoản chi gốc — danh mục, ví theo khoản đó; dòng chênh | [`test/logs.test.ts`](../test/logs.test.ts) › "trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu) › gán log tiền vào là hoàn tiền có link_id: nối khoản chi gốc, danh mục theo khoản gốc; phần chênh nằm lại trong ví của danh mục" (server); [`test/logs.test.ts`](../test/logs.test.ts) › "trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu) › link_id phải trỏ về khoản chi còn hiệu lực: không thì invalid_link (như nhập tay), log vẫn chờ, không ghi gì" (server); [`test/logs.test.ts`](../test/logs.test.ts) › "trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu) › GET /v1/transactions/link-candidates?meaning=spend: khoản chi còn hiệu lực 30 ngày gần nhất, mới nhất trước, kèm danh mục, ví đã trừ, nội dung ngân hàng" (danh sách); [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả lại cho khoản chi › 5 khoản gần số tiền nhất lên trước (bằng nhau thì mới nhất trước), rồi mọi khoản còn lại mới nhất trước — không cắt bớt"; [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả lại cho khoản chi › nhãn mục: ngày · danh mục · ghi chú (không có thì nội dung ngân hàng, cắt ở 40 ký tự) · số tiền"; [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả lại cho khoản chi › dòng chênh: trả hơn +, trả kém −, phần chênh nằm lại trong danh mục; trả đúng thì trả đủ"; [`web/src/lib/categories.test.ts`](../web/src/lib/categories.test.ts) › "tự điền ví và tài khoản › hoàn tiền cho khoản chi gốc ở ví cá nhân người kia → điền ví cùng phe của người đang nhập (đúng ví server sẽ ghi)"; ô chọn trong sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ) |
| ✅ AC-23: Thêm người ngay tại Gán; số còn nợ trước / sau hiện đúng | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › dòng dưới ô Ai trả / Cho ai vay: còn nợ trước và sau khoản này; nhận lại vượt số còn nợ thì báo phần dư của lần trả này"; [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › trả dư: nhận lại đúng số còn nợ, phần dư là Thu nhập (màn Gán tách dòng, Loại khác ghi riêng); Hoàn tiền chỉ cho chia bill có phần mình (ADR-84)"; [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › thêm người với số 0 (+ Người mới… ở màn Gán): không dòng opening, còn phải thu 0; nhận lại thì thành trả dư" (server); ô chọn, ô tên, nút Thêm người: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ) |
| ✅ AC-24: Nhận lại tiền cho vay chỉ đúng khoản cho vay gốc | [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › xếp khoản cho vay: của người đang chọn ở Ai trả lên trước, rồi gần số tiền nhất, rồi mới nhất; nhãn có tên người"; [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › dòng dưới ô Trả cho khoản cho vay: cho vay X · trả lại Y · còn Z, trả dư Z, hoặc trả đủ"; [`test/logs.test.ts`](../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › gán log tiền vào là nhận lại có link_id về khoản cho vay: lấy người của khoản cho vay; khác người hay trỏ khoản chi → invalid_link, log vẫn chờ" (server); [`test/logs.test.ts`](../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › GET /v1/transactions/link-candidates?meaning=lend: khoản cho vay còn hiệu lực trong số ngày hỏi, mới nhất trước, kèm người vay; meaning hay days sai → invalid_input" (danh sách); ô chọn, gợi ý, Ai trả tự theo: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |
| ✅ AC-25: Không ai còn nợ thì không chọn sẵn ai; tên người mới không bị mất | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › chọn sẵn khoản được mở từ, không thì khoản còn phải thu nhiều nhất; ai cũng đã trả đủ thì không chọn ai; bootstrap cũ không có trường thì null"; ô tên, nút Gán tắt, rời ô là thêm: ⚠ Chưa có test (repo chưa có test giao diện; đã xem tận mắt ở 390px, `wrangler dev` cục bộ — gồm Huỷ không thêm, Thêm người / Enter một lần, đổi sang người khác ở ô Ai trả không thêm, đóng sheet vẫn thêm) |
| ✅ AC-26: Dòng nhắc khoản gốc nói có khoản để chọn | `web/src/lib/refunds.test.ts` › "dòng nhắc khi chưa chọn khoản gốc › người đang chọn có khoản cho vay thì nói có mấy khoản để chọn, không nhắc 'khoản gốc còn chờ gán'" |
| ✅ AC-27: Ghi chú riêng cho từng dòng gán | `test/logs.test.ts` › "POST /v1/logs/:id/assign › mỗi dòng gán mang ghi chú riêng; ghi chú lưu vào giao dịch, dòng không ghi thì để trống"; ô trên màn: ⚠ Chưa có test (kiểm tay 390px 2026-10-06) |
| ✅ AC-28: Chia bill — khoản bill vẫn chọn được dù có nhiều khoản chi gần số tiền trả | `web/src/lib/refunds.test.ts` › "trả lại cho khoản chi › chia bill: bill 800.000 vẫn có trong danh sách khi người ta trả 200.000 dù có nhiều khoản chi quanh 200.000" |
| ✅ AC-29: Gán chuyển nội bộ vào tài khoản Tích sản nhắc tiền thành Tích sản (ADR-88) | [`web/src/lib/wealth-building-accounts.test.ts`](../web/src/lib/wealth-building-accounts.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › từ tài khoản thường vào phao / sổ / heo: nhắc tiền vào là Tích sản, ví Có thì tốt chuyển sang Tích sản"; [`web/src/lib/wealth-building-accounts.test.ts`](../web/src/lib/wealth-building-accounts.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › rút ra, gửi phao → sổ, tất toán sổ → phao, chuyển giữa hai tài khoản thường, chưa chọn tài khoản: không nhắc (chỉ đổi chỗ)"; [`test/buffer.test.ts`](../test/buffer.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › từ tài khoản thường vào phao, không chọn ví: ví Có thì tốt → Tích sản; rút ra, phao → sổ, sổ → tài khoản thường: chỉ đổi chỗ; chọn ví thì theo ví đã chọn" (server, cùng `buildEntry` mà gán dùng); dòng nhắc trên màn Gán: ⚠ Chưa có test (cần log ngân hàng thật; repo chưa có test giao diện) |

### [UC-707](pwa/UC-707-xem-vi-va-quy.md) Xem Ví & Quỹ và làm chuyển tiền cần làm
Status: `partial` · BR: BR-01, BR-07, BR-04, BR-02, BR-12, BR-13

| AC | Test |
|---|---|
| ✅ AC-1: Ngân sách cộng khoản chờ đồng bộ đúng kỳ | `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › bảng ngân sách tuần / tháng cộng khoản chờ vào thực tế" |
| ⚠ AC-2: Vượt mức nói thật | `web/src/lib/money.test.ts` › "định dạng tiền › số âm dùng dấu trừ U+2212, không phải gạch nối"; hiển thị: ⚠ Chưa có test |
| ⚠ AC-3: Mua tài sản lúc nào cũng được; Quỹ an tâm chưa đủ thì chỉ nhắc | ⚠ Chưa có test |
| ✅ AC-4: Tài khoản không có feed dẫn tới đếm ví; chưa gán không tính là lệch | `test/logs.test.ts` › "lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán (ledger UC-103, UC-106 — ADR-87) › snapshot và /v1/accounts: lệch khi bookDrift ≠ 0; log chưa gán (bookDrift 0) và tài khoản không có log (null) không lệch; không còn số ngân hàng báo" (dữ liệu server); hiển thị: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |
| ⚠ AC-5: Lệnh chuyển tiền: chép và đánh dấu | ⚠ Chưa có test |
| ⚠ AC-6: Bỏ qua lệnh cần hai bước | ⚠ Chưa có test |
| ⚠ AC-7: Kỳ trước trên màn rộng | `web/src/lib/period.test.ts` › "nhãn kỳ › tháng trước, kể cả qua năm"; bảng: ⚠ Chưa có test |
| ⚠ AC-8: Quỹ giữ riêng không nằm trong bảng ngân sách | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; card: ⚠ Chưa có test |
| ⚠ AC-9: Bảy tab con thấy hết trên điện thoại | ⚠ Chưa có test |
| ⚠ AC-10: Lệnh chuyển tiền nói tiền đi cho ví nào | `test/api.test.ts` › "chia lương end-to-end › lệnh chuyển tiền nói tiền đi cho ví nào: danh sách kèm tên các ví nhận trong lô ở tài khoản đích" (dữ liệu server); hiển thị: ⚠ Chưa có test |
| ⚠ AC-11: Tab Nợ xếp khoản còn nợ nhiều lên trước, trả xong tách riêng | [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › sắp xếp khoản nợ: còn nợ nhiều lên trước, trả xong tách riêng"; hiển thị: ⚠ Chưa có test |
| ⚠ AC-12: Thêm khoản nợ và dòng nợ chặn thiếu tên, thiếu số tiền | [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › kiểm tra khoản nợ mới và dòng nợ: thiếu tên, số tiền"; nút: ⚠ Chưa có test |
| ⚠ AC-13: Tab Nợ mở bằng tiền thật, ghi nhớ đứng sau, tài sản ròng cuối | [`web/src/lib/networth.test.ts`](../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › đủ mọi nhóm: tiền thật đầu tiên và là số hero, tài sản ròng cuối cùng và nhỏ hơn, nợ mang dấu âm"; [`web/src/lib/networth.test.ts`](../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › ẩn dòng bằng 0: không tài sản, không ai nợ, không người thuê trả trước — vẫn giữ tiền thật và tài sản ròng"; hiển thị và câu ghi nhớ: ⚠ Chưa có test |
| ⚠ AC-14: Card Người khác nợ mình xếp còn phải thu nhiều lên trước; lịch sử trộn dòng sổ và tiền đi/về | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › sắp khoản phải thu: còn nhiều lên trước, đã trả đủ tách riêng theo tên, khoản tắt không hiện"; [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › lịch sử trộn dòng sổ và lần tiền đi / về, mới nhất trước"; hiển thị: ⚠ Chưa có test |
| ⚠ AC-15: Heo đất là tiền Tích sản: không có card "Heo đất"; tab Nợ nói heo là một phần của Tích sản kèm từng người (ADR-82) | [`web/src/lib/networth.test.ts`](../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › heo, phao, sổ tiết kiệm là chỗ tiền Tích sản đang nằm: nói là một phần của Tích sản (tổng kèm từng tài khoản), không kể thêm lần nữa (ADR-82, ADR-88)"; [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "GET /v1/networth: heo đất là tiền Tích sản đã khóa › nằm trong tiền thật và trong Tích sản, tách tổng và từng người — không đếm hai lần" (server); `test/migrations/piggy-bank.test.ts` › "migration 0017 + 0019 + 0020: heo đất › 0020 trên dữ liệu như prod: số dư ví Heo đất sang Tích sản bằng một bút toán hệ thống chỉ đổi ví, rồi tắt ví; tiền thật không đổi" (ví tắt, không còn trong `reserves`); [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › tài khoản SePay báo cả tiền ra: tự gán chuyển nội bộ sang heo của chính chủ, ví Có thì tốt → Tích sản — không phải chi tiêu" (Tích sản, Quỹ an tâm +5.600); card và hiển thị: ⚠ Chưa có test |
| ✅ AC-16: Lệch đối soát: một luật, chỉ sổ khác giao dịch ngân hàng đã gán | [`web/src/lib/drift.test.ts`](../web/src/lib/drift.test.ts) › "lệch đối soát: một luật cho Hôm nay và Tài khoản (ADR-87) › chỉ sổ khác giao dịch ngân hàng đã gán mới là lệch, giữ dấu; 0 hay chưa có giao dịch ngân hàng (null) là không lệch"; [`test/webhooks.test.ts`](../test/webhooks.test.ts) › "nối trọn: webhook → rule mã → transaction › số lũy kế SePay gửi kèm sai hẳn số dư thật → không lưu, không báo lệch đối soát ở đâu cả (ADR-87)" (server); hiển thị: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ) |
| ✅ AC-17: Tích sản như prod nói tiền nằm ở hai con heo và đến từ bỏ heo, đủ ₫ | [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › như prod: tiền 76.300 nằm ở hai con heo, đến từ bỏ heo từng người và số dư ví Heo đất cũ — đủ ₫, không rút gọn"; [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › phần không nằm ở heo là 'trong các tài khoản thường'; heo 0 không chờ gì thì không có dòng"; câu giải thích thay chip: ⚠ Chưa có test (chạy tay 390px / 1280px trên `wrangler dev` cục bộ) |
| ✅ AC-18: Heo dư, heo âm, heo chờ gán nói thật | [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › heo nhiều hơn Tích sản: nói tổng, phần là Tích sản và phần dư có từ trước khi dùng app; không có dòng tài khoản thường"; [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › heo âm hiện đúng số âm và lý do; không trừ vào Tích sản — phần còn lại vẫn ở tài khoản thường"; [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › heo có log rút đang chờ gán: nói 'đang chờ gán' kèm số theo phía heo, kể cả khi số dư heo là 0" |
| ✅ AC-19: Chia từ thu nhập, mua vàng, chốt tháng, chuyển ngân sách: mỗi nguồn một dòng | [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › chia từ thu nhập và mua vàng: nguồn vào, tiền ra thành tài sản theo loại, còn lại là tiền"; [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › chốt tháng, thuế dư, chuyển ngân sách vào / ra: mỗi nguồn một nhãn riêng" |
| ⚠ AC-20: Xem các khoản Tích sản mở sổ lọc ví Tích sản, mọi tháng | ⚠ Chưa có test — chỉ là `go("ledger", { book })` với `month: null`; đã chạy tay trên `wrangler dev` cục bộ (390px): sổ mở "Cả sổ, mọi tháng", chip "Ví Tích sản", 4 giao dịch |
| ✅ AC-21: Phao và sổ tiết kiệm ở "Tiền đang ở đâu" cạnh heo; chuyển vào phao là một nguồn (ADR-88) | [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › phao và sổ tiết kiệm (ADR-88): mỗi tài khoản Tích sản một dòng cạnh heo, phần còn lại ở tài khoản thường; nguồn 'Chuyển vào phao'"; [`web/src/lib/wealth-building-accounts.test.ts`](../web/src/lib/wealth-building-accounts.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › tên gọi: heo theo người, phao và sổ theo tên tài khoản"; hiển thị: ⚠ Chưa có test (đã xem tận mắt 390px trên `wrangler dev` cục bộ, DB mới) |
| ✅ AC-22: Như prod sau khi nhập số dư đầu heo: các số cộng lại khớp, Quỹ an tâm không ghi "0 tháng" khi có tiền | [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › như prod sau khi nhập số dư đầu heo: câu phần dư cộng lại khớp các dòng, chỉ kể loại tài khoản đang có tiền"; [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › phao khẩn cấp: có tiền mà làm tròn ra 0 tháng thì nói 'dưới 0,1', không '0'; số tiền nói có / cần"; [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › chia từ thu nhập và mua vàng: nguồn vào, tiền ra thành tài sản theo loại, còn lại là tiền" (câu chia từ thu nhập); hiển thị: ⚠ Chưa có test (đã xem tận mắt trên `wrangler dev` cục bộ, DB dựng như prod: 390px, 1024–1440px, không tràn ngang) |
| ✅ AC-23: Số dư có sẵn là một nguồn vào; Tích sản bằng heo + phao thì không còn câu phần dư (ADR-91) | [`web/src/lib/wealth-building.test.ts`](../web/src/lib/wealth-building.test.ts) › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › như prod sau migration 0027 (ADR-91): số dư có sẵn là một nguồn vào; Tích sản bằng heo + phao thì không còn câu phần dư"; hiển thị: ⚠ Chưa có test (đã xem tận mắt trên `wrangler dev` cục bộ, DB dựng như prod rồi chạy 0027: 1280px và 390px, không tràn ngang) |

### [UC-708](pwa/UC-708-dem-vi-nhap-so-du-that.md) Đếm ví / nhập số dư thật
Status: `implemented` · BR: BR-04

| AC | Test |
|---|---|
| ⚠ AC-1: Hiện chênh lệch trước khi ghi | `web/src/lib/money.test.ts` › "định dạng tiền › chênh lệch có dấu +"; sheet: ⚠ Chưa có test |
| ⚠ AC-2: Khớp sổ vẫn ghi một lần đếm | ⚠ Chưa có test |
| ⚠ AC-3: Đếm ví cần mạng | ⚠ Chưa có test |
| ⚠ AC-4: Phép tính sai không thành lần đếm 0 ₫ | `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › không ra số tiền hợp lệ thì null: kết quả ≤ 0, vượt trần, hai dấu liền nhau, ký tự lạ"; sheet: ⚠ Chưa có test |

### [UC-709](pwa/UC-709-sua-cau-hinh-man-cai-dat.md) Sửa cấu hình ở màn Cài đặt
Status: `implemented` · BR: BR-08, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Khoá chỉ ghi không bao giờ hiện đủ | `web/src/lib/settings.test.ts` › "bí mật chỉ ghi › hiện 2 ký tự cuối, không bao giờ cả khoá" |
| ✅ AC-2: Khoá mới phải hợp lệ | `web/src/lib/settings.test.ts` › "bí mật chỉ ghi › đặt khoá mới: bỏ khoảng trắng hai đầu, chặn rỗng và khoảng trắng giữa" |
| ⚠ AC-3: Khoá đặt trên máy chủ không xoá được từ app | ⚠ Chưa có test |
| ✅ AC-4: Tham số hợp lệ | `web/src/lib/settings.test.ts` › "thành viên, tham số › số tháng phao 1–24, ngưỡng lương không âm" |
| ✅ AC-5: Thành viên chỉ gửi trường đã đổi | `web/src/lib/settings.test.ts` › "thành viên, tham số › chỉ gửi trường đã đổi; chat_id là dãy số, nhóm có dấu trừ" |
| ✅ AC-6: Ví nhận phần còn lại không đổi được cách nạp | `web/src/lib/settings.test.ts` › "ví › ví nhận phần còn lại: không gửi allocation khi sửa" |
| ✅ AC-7: SePay chỉ cho tài khoản ngân hàng có số tài khoản | `web/src/lib/settings.test.ts` › "tài khoản › SePay chỉ cho tài khoản ngân hàng có số tài khoản" |
| ⚠ AC-8: Offline chỉ xem | ⚠ Chưa có test |
| ⚠ AC-9: Lưu xong mọi màn thấy thay đổi | ⚠ Chưa có test |
| ✅ AC-10: Phần khóa của nguồn thu hợp lệ | `web/src/lib/settings.test.ts` › "nguồn thu: phần khóa › tổng quá 100%, ví trùng, ô trống hay 0% đều bị chặn"; `web/src/lib/settings.test.ts` › "nguồn thu: phần khóa › phần trăm gõ tay thành phân số; tổng đúng 100% vẫn được (khóa trọn, không chạy dòng thác)"; `web/src/lib/settings.test.ts` › "nguồn thu: phần khóa › form đọc lại đúng số đã lưu"; `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › đọc hồ sơ nguồn thu seed; thêm/sửa nguồn; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối" |
| ✅ AC-11: Chia đều theo tuần chỉ cho phong bì nạp theo tháng | `web/src/lib/settings.test.ts` › "phong bì chia đều theo tuần › phong bì nạp theo tháng: gửi split_weekly theo ô chọn"; `web/src/lib/settings.test.ts` › "phong bì chia đều theo tuần › nạp theo tuần hoặc ví tích dồn: không bao giờ bật"; `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › phong bì tháng bật chia theo tuần; ví tích dồn hay phong bì tuần thì không"; `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › phong bì tháng chia theo tuần: dự kiến tuần = tháng ÷ số thứ Hai, còn để chi dùng dự kiến tuần" |
| ✅ AC-12: Chỉ mã lương gắn được nguồn thu | `web/src/lib/settings.test.ts` › "mã lương chọn nguồn thu › sửa mã lương gửi nguồn; mã khác luôn xoá nguồn"; `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › mẫu lương gắn nguồn thu; mã chi thì không gắn được" |
| ✅ AC-13: Form Cho thuê | `web/src/lib/rental.test.ts` › "Cài đặt › Cho thuê › người thuê mới: số dư mở sổ có dấu, 0 thì không gửi"; `web/src/lib/rental.test.ts` › "Cài đặt › Cho thuê › phí cố định cần tên và số dương"; `web/src/lib/rental.test.ts` › "Cài đặt › Cho thuê › cấu hình: số người ≥ 1, ít nhất một danh mục chung, bắt buộc chọn nguồn thu" |
| ✅ AC-14: Ngân hàng chọn trong danh mục, SePay theo khả năng của ngân hàng (ADR-66) | `web/src/lib/settings.test.ts` › "tài khoản › SePay chỉ bật được cho ngân hàng SePay hỗ trợ; tài khoản cũ đã nối sẵn vẫn sửa tên được"; `web/src/lib/settings.test.ts` › "tài khoản › SePay báo cả tiền ra chỉ gửi true khi SePay đang bật"; `web/src/lib/settings.test.ts` › "tài khoản › gợi ý khả năng SePay theo ngân hàng: chỉ tiền vào, cả hai chiều, chưa hỗ trợ, bắt buộc VA" |
| ⚠ AC-15: Thứ hay sửa lên trước, việc làm một lần vào Nâng cao | ⚠ Chưa có test |
| ✅ AC-16: Thẻ Giờ nhắc tóm tắt đúng, kể cả khi tắt | `web/src/lib/settings.test.ts` › "giờ nhắc › tóm tắt: tắt thì ghi Tắt (tin sáng tắt vẫn nói ngày 1 chốt tháng), giờ yên lặng bằng nhau là Không đặt" |
| ✅ AC-17: Sheet Giờ nhắc gửi đủ trường, chặn giờ sai ở máy | `web/src/lib/settings.test.ts` › "giờ nhắc › thân PATCH đủ trường snake_case; giờ phải HH:MM, phút chia hết cho 15; thứ 1–7" |
| ⚠ AC-18: Giờ nhắc chỉ xem khi offline | ⚠ Chưa có test |
| ✅ AC-19: Ô "Nối qua" chỉ hiện khi cần và không lặng lẽ đổi kết nối | `web/src/lib/settings.test.ts` › "kết nối SePay › ô Nối qua hiện khi có từ hai kết nối đang bật hoặc kết nối đã lưu đang tắt; kết nối đã lưu đang tắt vẫn được giữ, kết nối tắt khác không chọn được"; `web/src/lib/settings.test.ts` › "tài khoản › chỉ gửi kết nối SePay khi đang bật SePay và đã chọn kết nối" |
| ✅ AC-20: Đồng bộ lại SePay — khoảng ngày kiểm ở máy như server | `web/src/lib/settings.test.ts` › "kết nối SePay › đồng bộ lại: tối đa 31 ngày tính cả hai đầu, không lùi ngược, không quá hôm nay" |
| ⚠ AC-21: Ngày của số dư đầu nói rõ nghĩa; đồng bộ lại báo giao dịch trước mốc (ADR-76) | ⚠ Chưa có test (sheet đã chạy tay trên `wrangler dev` cục bộ 2026-10-03; phía server: ingest UC-304 AC-11) |
| ⚠ AC-22: Nhóm Zalo Bot ở Kết nối; Đặt webhook chỉ bấm được khi đủ hai khoá (ADR-80) | ⚠ Chưa có test (UI `web/src/screens/settings.tsx` › `Connections`; phía server: access UC-508 AC-11, AC-12) |
| ⚠ AC-23: Nối Zalo bằng mã có đếm ngược; không nhập chat_id Zalo tay (ADR-80) | ⚠ Chưa có test (UI `web/src/screens/settings-sheets.tsx` › `ZaloLink`; phía server: notify UC-411 AC-2, AC-6) |
| ⚠ AC-24: Đã nối Zalo: Gửi thử và Bỏ nối hai bước (ADR-80) | ⚠ Chưa có test (UI `web/src/screens/settings-sheets.tsx` › `ZaloLink`; phía server: access UC-507 AC-8, UC-508 AC-13) |
| ✅ AC-25: Ô "Tính vào tiền chi được" theo loại tài khoản; heo đất không bật được (ADR-85) | [`web/src/lib/settings.test.ts`](../web/src/lib/settings.test.ts) › "tài khoản › Tính vào tiền chi được: thêm mới thì bật, thẻ tín dụng mặc định tắt; heo đất không bao giờ gửi bật (ADR-85)"; ô trên sheet và mở thẳng phần Tài khoản: ⚠ Chưa có test (UI: `AccountSheet` trong `web/src/screens/settings-sheets.tsx`, `Settings` trong `web/src/screens/settings.tsx`) |
| ✅ AC-26: Ô "Giữ tiền Tích sản" — phao, sổ tiết kiệm; heo / sổ giữ vai trò (ADR-88) | [`web/src/lib/settings.test.ts`](../web/src/lib/settings.test.ts) › "tài khoản › Giữ tiền Tích sản (ADR-88): thêm phao / sổ tiết kiệm gửi role, mặc định không tính vào tiền chi được; sổ không bao giờ gửi bật; sửa heo / sổ không gửi role"; server: access UC-506 AC-17, AC-18; ô trên sheet (ẩn SePay, ô Ngày gửi): ⚠ Chưa có test (repo chưa có test giao diện; đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |
| ✅ AC-27: Sheet tài khoản nhắc số dư có sẵn sẽ vào Tích sản (ADR-91) | [`web/src/lib/wealth-building-accounts.test.ts`](../web/src/lib/wealth-building-accounts.test.ts) › "số dư có sẵn khi thành tài khoản Tích sản (ADR-91) › thêm phao / sổ có số dư, hay đổi tài khoản thường có tiền sang phao: nhắc số đó vào Tích sản; đã là tài khoản Tích sản, vẫn tính vào tiền chi được, hay không có tiền thì không nhắc"; hiển thị: ⚠ Chưa có test (đã xem tận mắt 390px trên `wrangler dev` cục bộ, lưu xong Tích sản 136.000 → 636.000, Có thì tốt và Tiền chi được không đổi) |
| ✅ AC-28: Thành viên — thêm người, tắt / bật lại, mật khẩu riêng (ADR-95, ADR-96) | [`web/src/lib/members.test.ts`](../web/src/lib/members.test.ts) › "UC-507 AC-11: thêm người › tên bắt buộc, tối đa 40 ký tự; mật khẩu riêng để trống được, có thì ít nhất 8 ký tự" · "… › trùng tên (không phân biệt hoa thường) hoặc trùng mã với bất kỳ ai, kể cả người đã tắt" · "… › đã có 6 người đang dùng thì không thêm được; người đã tắt không tính" · "… › lỗi server: trùng → ô tên; quá 6 người, 429 → câu chung" · "UC-709: dòng nhỏ mật khẩu › dùng mật khẩu riêng / dùng mật khẩu chung" · "UC-507 AC-13: đặt / đổi / gỡ mật khẩu riêng › đổi của người khác luôn hỏi mật khẩu chung" · "… › đổi của mình: hỏi mật khẩu đang dùng; chọn dùng mật khẩu chung thì gửi mật khẩu chung" · "… › gỡ gửi password null; mật khẩu mới ít nhất 8 ký tự; phải nhập mật khẩu xác nhận" · "mã thành viên sinh từ tên (như server) › bỏ dấu, chữ thường, gạch nối; tên không có chữ / số thì mã rỗng"; [`web/src/lib/api.test.ts`](../web/src/lib/api.test.ts) › "lỗi server: field và 401 › UC-507 AC-13: 401 sai mật khẩu (đổi mật khẩu riêng, thiết lập) không đẩy về màn đăng nhập; 401 hết phiên thì có"; nút Tắt / Bật lại và bước hỏi lại: ⚠ Chưa có test (giao diện — đã xem tay ở 390px) |
| ✅ AC-29: Mục Claude và ứng dụng AI — địa chỉ, danh sách kết nối, Gỡ; nhật ký đọc được (ADR-97) | [`web/src/lib/ai-connections.test.ts`](../web/src/lib/ai-connections.test.ts) › "UC-508: quyền của kết nối Claude › chỉ mcp:read là Xem, có thêm mcp:write là Xem + Ghi, không phụ thuộc thứ tự" · "… › quyền lạ bị bỏ qua, không có quyền nào thì nói rõ" · "UC-508: ngày nối › cùng năm chỉ hiện ngày/tháng theo giờ VN" · "… › khác năm thì kèm năm" · "UC-508: danh sách kết nối › mỗi kết nối: tên ứng dụng, tên miền đã xác minh, của ai, quyền, ngày nối" · "… › mới nối đứng trước" · "… › không có tên miền xác minh thì hiện nơi chuyển về; tên ứng dụng trùng tên miền thì không lặp" · "… › đường gỡ mã hoá mã người và mã grant"; [`web/src/lib/settings.test.ts`](../web/src/lib/settings.test.ts) › "nhật ký thay đổi › UC-508: nối / gỡ ứng dụng AI và việc ghi qua Claude có tên dễ đọc"; giao diện thẻ (Chép, Gỡ → Gỡ hẳn, toast, tắt khi chỉ xem): ⚠ Chưa có test (repo không có test giao diện) |

### [UC-710](pwa/UC-710-mo-app-khi-mat-mang.md) Mở app khi mất mạng (service worker, số cũ theo người)
Status: `implemented` · BR: BR-03, BR-09, BR-10

| AC | Test |
|---|---|
| ⚠ AC-1: Mở app ở chế độ máy bay vẫn thấy số gần nhất và nhập được | ⚠ Chưa có test (đã thử tay, báo cáo `ui-ux-designer-260922-0020-pwa-mobile-offline.md`) |
| ⚠ AC-2: Bản lưu không lẫn giữa hai người | ⚠ Chưa có test |
| ⚠ AC-3: Service worker không cache yêu cầu ghi, ghi xong thì xoá cache API, không đụng đường của Worker (MODIFIED v8) | ⚠ Chưa có test (đã chạy thử `public/sw.js` với `caches`/`fetch` giả lập, không giữ lại) |
| ⚠ AC-4: 401 không để lại bản lưu giả đăng nhập | ⚠ Chưa có test |
| ⚠ AC-5: Bản build mới tới được người dùng | ⚠ Chưa có test |
| ⚠ AC-6: Cài được lên màn hình chính | ⚠ Chưa có test |
| ⚠ AC-7: Hạn tươi theo đường dẫn | `web/src/lib/sw-fresh.test.ts` › "freshFor: bao lâu service worker trả bản lưu không hỏi mạng › cấu hình, danh mục, người thuê: 5 phút"; "freshFor: bao lâu service worker trả bản lưu không hỏi mạng › số tiền và danh sách hay đổi: 30 giây"; "freshFor: bao lâu service worker trả bản lưu không hỏi mạng › đường con của nhóm 5 phút không thừa hưởng 5 phút"; "freshFor: bao lâu service worker trả bản lưu không hỏi mạng › health, thiết lập và phiên luôn hỏi mạng"; "freshFor: bao lâu service worker trả bản lưu không hỏi mạng › đường lạ: 30 giây"; phần service worker trả cache: ⚠ Chưa có test |
| ⚠ AC-8: Bấm Đồng bộ / Tải lại luôn hỏi server | ⚠ Chưa có test |
| ✅ AC-9: GET trùng đang chạy đi chung một lượt; ghi xong thì không dùng lại | `web/src/lib/api.test.ts` › "inflight: gộp GET trùng đang chạy › hai lời gọi cùng khoá lúc đang chạy đi chung một lượt"; "inflight: gộp GET trùng đang chạy › khoá khác nhau chạy riêng"; "inflight: gộp GET trùng đang chạy › xong rồi thì lời gọi sau đi lượt mới, kể cả khi lượt trước lỗi"; "inflight: gộp GET trùng đang chạy › clear (sau yêu cầu ghi): GET mới không nhận kết quả của GET bắt đầu trước khi ghi" |
| ⚠ AC-10: Có bản mới thì hiện thanh mời tải, bấm là chạy bản mới | ⚠ Chưa có test tự động (repo không có test giao diện / service worker) — kiểm tay 2026-10-06 trên `wrangler dev`: build mới → `reg.update()` → `controllerchange` → thanh hiện; bấm → script mới, cache shell mới, thanh mất |
| ✅ AC-11: Bản lưu của phiên bản dữ liệu trước không được dùng; hàng đợi giữ nguyên (ADR-92) | [`web/src/offline/idb.test.ts`](../web/src/offline/idb.test.ts) › "bản lưu của phiên bản dữ liệu trước (pwa UC-710 AC-11) › chưa có dấu phiên bản mới: bỏ bản lưu cũ ở localStorage một lần (đọc ra null), hàng đợi nhập giữ nguyên và vẫn đọc được" · "… › đã đúng phiên bản: bản lưu giữ nguyên"; service worker xoá `vi-nha-api` và IndexedDB lên phiên bản: ⚠ Chưa có test (repo không có test service worker / IndexedDB thật) |
| ✅ AC-12: Đường của Worker đi thẳng ra mạng — trang uỷ quyền Claude không bị thay bằng app (ADR-97) | [`web/src/lib/sw-fresh.test.ts`](../web/src/lib/sw-fresh.test.ts) › "UC-503: bypassWorker — đường của Worker service worker không đụng tới › MCP, trang uỷ quyền OAuth, CSS của nó, metadata và webhook đi thẳng ra mạng" · "… › app shell, API và đường gần giống vẫn qua service worker"; handler `fetch` của `web/sw.js` gọi `bypassWorker`: ⚠ Chưa có test (repo không có test service worker) |

### [UC-711](pwa/UC-711-khung-dieu-huong-va-luat-hien-thi.md) Khung điều hướng và luật hiển thị (DESIGN.md)
Status: `implemented` · BR: BR-01

| AC | Test |
|---|---|
| ✅ AC-1: Định dạng tiền | `web/src/lib/money.test.ts` › "định dạng tiền › chấm phân nhóm, ₫ sau số"; "định dạng tiền › số âm dùng dấu trừ U+2212, không phải gạch nối"; "định dạng tiền › không làm tròn"; "định dạng tiền › chênh lệch có dấu +" |
| ✅ AC-2: Nhãn kỳ | `web/src/lib/period.test.ts` › "nhãn kỳ › tuần trong một tháng: T39 (21–27/9)"; "nhãn kỳ › tuần vắt qua hai tháng ghi đủ cả hai"; "nhãn kỳ › tuần tính theo giờ VN, không theo UTC"; "nhãn kỳ › tháng"; "nhãn kỳ › ngày và giờ" |
| ⚠ AC-3: FAB ẩn ở Nhập, Cài đặt, Sổ giao dịch và Hướng dẫn | ⚠ Chưa có test |
| ⚠ AC-4: Một mốc 1024px, điện thoại không đổi | ⚠ Chưa có test (so ảnh/DOM bằng tay trong báo cáo `ui-ux-designer-260922-1210-desktop-redesign.md`) |
| ⚠ AC-5: Phím N | ⚠ Chưa có test |
| ⚠ AC-6: Điều hướng bằng hash | [`web/src/lib/hash-route.test.ts`](../web/src/lib/hash-route.test.ts) › "màn trong hash › bảng địa chỉ màn tiếng Anh: đủ 7 màn (có Hướng dẫn) và 7 tab con, mỗi địa chỉ đọc lại ra đúng chỗ"; mở từ shortcut và nút quay lại: ⚠ Chưa có test |
| ✅ AC-11: F5 ở tab con Ví & quỹ mở lại đúng tab con | [`web/src/lib/hash-route.test.ts`](../web/src/lib/hash-route.test.ts) › "màn trong hash › F5 ở Ví & quỹ › Tích sản mở lại đúng Tích sản: hash ghi cả tab con và đọc lại ra đúng chỗ"; [`web/src/lib/hash-route.test.ts`](../web/src/lib/hash-route.test.ts) › "màn trong hash › link cũ \"#wallets\" hay tab con lạ → Ví & quỹ, giữ tab con đang có; hash lạ → Hôm nay; tab con chỉ thuộc Ví & quỹ" |
| ✅ AC-12: Địa chỉ tiếng Việt cũ về Hôm nay, không giữ song song (ADR-92) | [`web/src/lib/hash-route.test.ts`](../web/src/lib/hash-route.test.ts) › "màn trong hash › địa chỉ tiếng Việt cũ (bookmark trước khi đổi tên) → Hôm nay như mọi hash lạ, không giữ song song"; lối tắt manifest: ⚠ Chưa có test (kiểm bằng đọc `web/public/manifest.webmanifest`) |
| ✅ AC-13: Hướng dẫn mở ngay trong app | [`web/src/lib/hash-route.test.ts`](../web/src/lib/hash-route.test.ts) › "màn trong hash › bảng địa chỉ màn tiếng Anh: đủ 7 màn (có Hướng dẫn) và 7 tab con, mỗi địa chỉ đọc lại ra đúng chỗ"; vẽ khung, chiều cao, không cuộn hai lớp: ⚠ Chưa có test (giao diện — kiểm tay trên prod 2026-10-08 ở 390px và 1280px: khung cao 719 / 807 px, trang không cuộn thêm, không lỗi CSP) |
| ⚠ AC-14: Hướng dẫn khi mất mạng | ⚠ Chưa có test (giao diện) |
| ⚠ AC-7: Toast tự tắt và đọc được bằng trình đọc màn hình | ⚠ Chưa có test |
| ⚠ AC-8: Sheet đóng bằng Esc, scrim, nút Đóng | ⚠ Chưa có test |
| ⚠ AC-9: Giao diện người chọn đè theo máy | ⚠ Chưa có test |
| ⚠ AC-10: FAB không che nội dung cuối trang | ⚠ Chưa có test |

### [UC-712](pwa/UC-712-chuyen-ngan-sach-va-bu.md) Chuyển ngân sách & Bù ví âm
Status: `implemented` · BR: BR-01, BR-02, BR-04, BR-12

| AC | Test |
|---|---|
| ✅ AC-1: Dòng Tổng chỉ cộng ví chi tiêu | `web/src/lib/budget.test.ts` › "dòng Tổng của bảng ngân sách › chỉ cộng ví chi tiêu, bỏ Tích sản / Thuế và ô ẩn số"; `web/src/lib/budget.test.ts` › "dòng Tổng của bảng ngân sách › không có ví chi tiêu thì không có dòng Tổng" |
| ✅ AC-2: Bù điền sẵn đúng số và nguồn | `web/src/lib/budget.test.ts` › "chuyển ngân sách › Bù ví âm: số = phần âm, nguồn ưu tiên Có thì tốt còn dư"; `web/src/lib/budget.test.ts` › "chuyển ngân sách › Có thì tốt hết tiền thì lấy ví chi tiêu còn dư nhiều nhất, không đụng ví giữ riêng"; `web/src/lib/budget.test.ts` › "chuyển ngân sách › không ví nào dư thì vẫn đề xuất Có thì tốt" |
| ✅ AC-3: Không bao giờ rút ví Thu nhập hay Tích sản | `web/src/lib/budget.test.ts` › "chuyển ngân sách › không bao giờ dùng ví Thu nhập; Tích sản chỉ nhận; ví riêng người kia bị ẩn" |
| ✅ AC-4: Nút chính nói bước còn thiếu | `web/src/lib/budget.test.ts` › "chuyển ngân sách › lý do chưa chuyển được" |
| ✅ AC-5: Chuyển ngân sách chỉ đổi số dư ví, tài khoản không đổi | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › chuyển ngân sách giữa hai ví: chỉ đổi số dư ví, tài khoản không đổi; báo ví nhận"; `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › chuyển ngân sách sai: %j → %s" |
| ✅ AC-6: Chuyển chưa đồng bộ vẫn hiện ngay, không tính là chi | `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › chuyển ngân sách chưa đồng bộ: số dư hai ví đổi ngay, thực tế chi không đổi" |
| ⚠ AC-7: Chuyển ngân sách ghi được khi offline | ⚠ Chưa có test |
| ⚠ AC-8: Trả nợ chi thẳng từ quỹ giữ riêng | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; `web/src/lib/categories.test.ts` › "tự điền ví và tài khoản › danh sách ví chi được: bỏ Thu nhập, Tích sản, ví cá nhân người kia; ví giữ riêng chi được (trả nợ)"; sheet Trả nợ: ⚠ Chưa có test |
| ⚠ AC-9: Chuyển sang Tích sản điền sẵn số dư quỹ | ⚠ Chưa có test |
| ⚠ AC-10: Dòng "Số dư thật … chưa bù" chỉ cho ví âm thấy được số | ⚠ Chưa có test |
| ⚠ AC-11: Sheet Trả nợ chọn sẵn khoản còn nợ nhiều nhất, không gắn vào khoản hết nợ | [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › trả nợ mặc định chọn khoản còn nợ nhiều nhất"; sheet: ⚠ Chưa có test |
| ✅ AC-12: Toast sau khi trả nợ nói còn nợ bao nhiêu | [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › toast sau khi trả nợ: Đã trả X cho tên. Còn nợ Y." |

### [UC-713](pwa/UC-713-man-nguoi-thue.md) Màn Người thuê
Status: `implemented` · BR: BR-11, BR-03

| AC | Test |
|---|---|
| ✅ AC-1: Dấu số dư nói đúng ai nợ ai | `web/src/lib/rental.test.ts` › "số dư người thuê › dương là còn nợ, âm là trả dư mang sang tháng sau" |
| ⚠ AC-2: Tạm tính = phí cố định đang thu + phần chi chung | `test/rental.test.ts` › "domain rental › phần chi chung = floor(tổng / số người), phí tắt không vào nháp"; `web/src/lib/rental.test.ts` › "chốt tháng › bản nháp cộng đúng phần phải trả"; bảng: ⚠ Chưa có test |
| ✅ AC-3: Đổi số người lúc chốt | `web/src/lib/rental.test.ts` › "chốt tháng › đổi số người: chi chung tính lại, phần lẻ hộ chịu; phí cố định giữ nguyên"; `test/rental.test.ts` › "/v1/rental › đổi số người chia (4) → phần chi chung giảm" |
| ✅ AC-4: Form chốt chặn số sai | `web/src/lib/rental.test.ts` › "chốt tháng › thân yêu cầu: dòng chỉnh được âm, phí không được âm, số người ≥ 1" |
| ⚠ AC-5: Mỗi tháng chốt một lần | `test/rental.test.ts` › "/v1/rental › chốt lần hai cùng tháng → 409 already_settled, không ghi thêm dòng"; câu trong sheet: ⚠ Chưa có test |
| ⚠ AC-6: Không đi tới tháng chưa tới | `test/rental.test.ts` › "/v1/rental › không chốt được tháng chưa tới"; nút: ⚠ Chưa có test |
| ✅ AC-7: Dòng ghi tay gửi đúng dấu và đúng danh mục | `web/src/lib/rental.test.ts` › "dòng ghi tay › người thuê chi hộ: gửi số dương, phải thuộc danh mục chi chung"; `web/src/lib/rental.test.ts` › "dòng ghi tay › chỉnh giảm nợ gửi số âm; phí một lần cần tên"; `test/rental.test.ts` › "/v1/rental › dòng ghi tay idempotent theo client_id; chi hộ chỉ nhận danh mục chi chung" |
| ⚠ AC-8: Huỷ dòng hai bước, số dư theo | `test/rental.test.ts` › "/v1/rental › huỷ dòng sổ đổi số dư; huỷ giao dịch tiền trả thì số dư trở lại"; hai bước: ⚠ Chưa có test |
| ✅ AC-9: Trọn một tháng: tạm tính, chốt, nhận tiền, mang sang | `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau"; `test/rental.test.ts` › "/v1/rental › số dư mở sổ là dòng opening; tháng sau thấy nó ở số dư đầu kỳ" |
| ⚠ AC-10: Ghi sổ người thuê cần mạng | ⚠ Chưa có test |
| ⚠ AC-11: Người đã ra còn hiện tới khi hết nợ | ⚠ Chưa có test |
| ⚠ AC-12: Hai con số được gọi đúng tên | ⚠ Chưa có test |
| ⚠ AC-13: Sheet chốt gọn một màn | ⚠ Chưa có test |

### [UC-714](pwa/UC-714-bat-thong-bao-tren-may-nay.md) Bật thông báo trên máy này
Status: `implemented` · BR: BR-06, BR-09

| AC | Test |
|---|---|
| ✅ AC-1: Năm trạng thái của thẻ | `web/src/lib/push.test.ts` › "pushState › iPhone chưa thêm vào màn hình chính thì chỉ cách cài, kể cả khi Safari không có PushManager"; `web/src/lib/push.test.ts` › "pushState › iPhone mở từ màn hình chính đi theo quyền như máy khác; iOS cũ không có PushManager là không hỗ trợ"; `web/src/lib/push.test.ts` › "pushState › máy không có push là không hỗ trợ, bất kể quyền"; `web/src/lib/push.test.ts` › "pushState › bị chặn thắng cả khi còn subscription cũ"; `web/src/lib/push.test.ts` › "pushState › chỉ 'đã bật' khi vừa có quyền vừa có subscription" |
| ✅ AC-2: Nhận ra iPhone/iPad, kể cả iPadOS tự nhận là Mac | `web/src/lib/push.test.ts` › "isIos › nhận iPhone và iPadOS tự nhận là Mac khi có cảm ứng"; `web/src/lib/push.test.ts` › "isIos › Mac thật (không cảm ứng) và Android không phải iOS" |
| ✅ AC-3: Khoá công khai đổi đúng thành `applicationServerKey` | `web/src/lib/push.test.ts` › "base64UrlToBytes › giải base64url không đệm, có - và _"; `web/src/lib/push.test.ts` › "base64UrlToBytes › khoá công khai P-256 dạng raw ra đúng 65 byte, mở đầu 0x04" |
| ⚠ AC-4: Bật chỉ hỏi quyền khi bấm, rồi gắn máy với người đang dùng | ⚠ Chưa có test (phía server: notify UC-410 AC-3) |
| ⚠ AC-5: Gửi thử báo đúng kết quả | ⚠ Chưa có test (phía server: notify UC-410 AC-6, AC-7) |
| ⚠ AC-6: Tắt gỡ ở server rồi huỷ ở máy; mất mạng thì giữ nguyên | ⚠ Chưa có test |
| ✅ AC-7: Danh sách máy đọc được | `web/src/lib/push.test.ts` › "deviceLabel › gọi máy theo thiết bị · trình duyệt"; `web/src/lib/push.test.ts` › "deviceLabel › user agent lạ vẫn có nhãn"; `web/src/lib/push.test.ts` › "lastOkText › giờ SQLite (UTC, không múi) đọc theo giờ VN"; `web/src/lib/push.test.ts` › "lastOkText › máy chưa nhận tin nào" |
| ⚠ AC-8: Vào app giữ máy gắn đúng người | ⚠ Chưa có test (phía server — đăng ký lại cùng endpoint chuyển người: notify UC-410 AC-3) |
| ⚠ AC-9: Đăng xuất tắt thông báo của máy | ⚠ Chưa có test |
| ⚠ AC-10: Thông báo hiện ra và mở đúng màn | ⚠ Chưa có test (nội dung/đường mở theo loại tin: notify UC-410 AC-12) |
| ⚠ AC-11: Subscription đổi thì tự đăng ký lại | ⚠ Chưa có test |
| ✅ AC-12: Dòng "Thử khi tắt app" theo trạng thái lượt gửi thử | `web/src/lib/push.test.ts` › "seriesView › đang gửi thì hiện hướng dẫn tắt app theo đúng nhịp của lượt, kèm nút Huỷ"; `web/src/lib/push.test.ts` › "seriesView › xong, huỷ hay chưa có lượt nào thì không còn nút Huỷ; xong mà không gửi được tin nào thì báo lỗi" |
| ⚠ AC-13: Thử khi tắt app — tin về khi app đã vuốt tắt | ⚠ Chưa có test (phía server: notify UC-410 AC-14..AC-17, AC-19..AC-21; chưa thử trên iPhone thật) |

### [UC-715](pwa/UC-715-xem-sua-xoa-giao-dich.md) Xem, sửa, xoá một giao dịch
Status: `implemented` · BR: BR-03, BR-04, BR-01

| AC | Test |
|---|---|
| ✅ AC-1: Việc làm được theo nguồn | `web/src/lib/transactions.test.ts` › "việc làm được với một giao dịch › ghi tay: sửa và xoá được"; "việc làm được với một giao dịch › từ ngân hàng: không sửa không xoá, chỉ gán lại — kể cả khi chỉ có log_id"; "việc làm được với một giao dịch › hệ thống (chốt tháng, nạp ví của lần chia): chỉ xem, nói vì sao"; "việc làm được với một giao dịch › điều chỉnh sau đếm ví: chỉ xoá; khoản đã xoá: không làm gì nữa" |
| ✅ AC-2: Sửa mở đúng form đã dùng để nhập | `web/src/lib/transactions.test.ts` › "việc làm được với một giao dịch › form sửa: khoản chi ở màn Nhập, chuyển chỉ giữa hai ví ở Chuyển ngân sách, còn lại đúng loại của nó" |
| ✅ AC-3: Form sửa điền đúng từ dòng sổ | `web/src/lib/transactions.test.ts` › "điền sẵn form sửa từ dòng sổ (quy ước dấu) › khoản chi: ví bị trừ thành ví chọn, tài khoản tiền ra, giữ khoản nợ; ngày theo giờ VN"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › thu nhập: tài khoản tiền vào, thuế, nguồn thu, người thuê"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › hoàn tiền: ví được cộng, tài khoản tiền về, nối về khoản chi gốc"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › chuyển nội bộ kèm ví và chuyển ngân sách: nguồn là ví bị trừ, đích là ví được cộng"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › cho vay / nhận lại: tài khoản theo chiều tiền, giữ khoản phải thu; mua tài sản giữ loại tài sản" |
| ✅ AC-4: Sửa không đổi ngày thì giữ giờ cũ; ô chọn giữ lựa chọn đang gắn | `web/src/lib/transactions.test.ts` › "điền sẵn form sửa từ dòng sổ (quy ước dấu) › giờ ghi khi sửa: không đổi ngày thì giữ đúng giờ cũ, đổi ngày thì 12:00 ngày đó"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › danh sách chọn giữ lựa chọn đang gắn dù nó không nằm trong danh sách mặc định" |
| ✅ AC-5: Câu xác nhận và toast nói hệ quả | `web/src/lib/transactions.test.ts` › "câu xác nhận và toast sau khi sửa / xoá › xoá: nói số tiền, khoản gì, và ví còn bao nhiêu"; "câu xác nhận và toast sau khi sửa / xoá › xoá khoản thu đã chia: hỏi lại có nói lần chia cũng được gỡ, toast nói đã gỡ"; "câu xác nhận và toast sau khi sửa / xoá › sửa: nói số mới và ví còn bao nhiêu; chuyển chỉ giữa hai ví gọi là chuyển ngân sách" |
| ⚠ AC-6: Luồng chạm trên giao diện | ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-02) |
| ✅ AC-7: Chia sau một khoản thu chưa chia | [`test/logs.test.ts`](../test/logs.test.ts) › "gán thu nhập, để chia sau (pwa UC-706, ledger UC-103) › gán mà không gọi /v1/allocate: khoản thu nằm ở ví Thu nhập, chưa chia, còn để chi không đổi; chia sau vẫn được" (server: bảng chia thử theo các trường của khoản = lần chia); nút, bảng, toast: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ) |
| ✅ AC-8: Xem hai chiều: khoản gốc thấy đã nhận lại bao nhiêu, khoản trả về thấy trả cho khoản nào | [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › chi tiết giao dịch: dòng Trả cho nói loại gốc, ngày, số tiền; Đã nhận lại nói tổng và chênh (trả dư / còn thiếu / đủ)"; [`test/logs.test.ts`](../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › GET /v1/transactions/:id: khoản gốc kèm các khoản còn hiệu lực đã trả về nó (linked_from), khoản trả về kèm tóm tắt khoản gốc (link)" (server); hàng chạm được trong sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ) |
| ✅ AC-9: Khoản gốc đã xoá: khoản trả về vẫn nói trả cho khoản nào | [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › khoản gốc đã xoá: liên kết giữ, dòng Trả cho nói khoản gốc đã xoá"; [`test/receivables.test.ts`](../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › sửa khoản gốc: khoản trả về trỏ sang khoản mới; đổi loại hay đổi người của khoản gốc thì invalid_link, không đổi gì; xoá khoản gốc thì liên kết giữ, khoản gốc hiện đã xoá" (server); hàng trong sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |

### [UC-716](pwa/UC-716-so-giao-dich.md) Sổ giao dịch
Status: `implemented` · BR: BR-01, BR-03, BR-05

| AC | Test |
|---|---|
| ✅ AC-1: Bộ lọc thành đúng query cho danh sách và tổng | `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › mặc định là tháng hiện tại, không lọc gì; tháng 9 + Chi tiêu + Thuốc thang thành đúng query cho danh sách và tổng" |
| ✅ AC-2: Lọc tháng 9 + Chi tiêu + một danh mục ra đúng các khoản, tổng chi đúng | [`test/api.test.ts`](../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › lọc tháng 9 + Chi tiêu + một danh mục: đúng các khoản, tổng chi đúng; các bộ lọc khác khớp đúng cột"; màn hình: ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-06, ~185 giao dịch tháng 8–10: tháng 9 + Chi tiêu + Thuốc thang ra 13 khoản, Chi 1.340.000 ₫ khớp API) |
| ✅ AC-3: Tìm "shopee" ra khoản có ghi chú hoặc nội dung ngân hàng chứa chữ đó | [`test/api.test.ts`](../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tìm chữ: ghi chú, nội dung ngân hàng, tên danh mục, tên người; ít hơn 2 ký tự thì báo sai"; "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tìm có dấu cũng khớp nội dung ngân hàng không dấu; tìm không dấu chưa khớp chữ có dấu đã lưu"; `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › chữ tìm: gửi khi đủ 2 ký tự (đã cắt khoảng trắng, mã hoá URL), ngắn hơn thì chưa tìm" |
| ✅ AC-4: Chip bộ lọc đọc được, chạm × bỏ đúng bộ lọc đó | `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › bộ lọc đang bật thành chip có tên dễ đọc; chạm × bỏ đúng bộ lọc đó; loại giữ thứ tự của danh sách" |
| ✅ AC-5: Đi tháng không quá tháng hiện tại | `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › đi tháng: lùi tự do, tới không quá tháng hiện tại; đang xem cả sổ thì ‹ về tháng này" |
| ✅ AC-6: Dòng tổng theo nghĩa tiền thật; tiêu đề ngày nói chi thật của ngày | `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › dòng tổng theo nghĩa tiền thật: Chi = chi tiêu − hoàn tiền, Thu luôn có; loại khác chỉ hiện khi có số"; "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › nhóm theo ngày giờ VN, tiêu đề ngày nói chi thật của ngày (trừ hoàn tiền, bỏ khoản đã xoá)"; [`test/api.test.ts`](../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tổng theo nghĩa tiền thật: chi, hoàn, thu, cho vay / nhận lại, chuyển nội bộ, mua tài sản, điều chỉnh hai chiều" (server) |
| ⚠ AC-7: Sửa / xoá từ sổ: danh sách và tổng cập nhật, khoản cũ thành "đã xoá" (ẩn mặc định) | ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-06, 390px: Chi 10.454.000 → 10.004.000 sau xoá 450.000, scrollY giữ 4461; 10.004.000 → 10.046.000 sau sửa 35.000 → 77.000) |
| ✅ AC-8: Ghi thêm khi đang xem tháng 9 → ngày mặc định 30/9 | `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › ghi thêm khi đang xem tháng 9 → ngày mặc định 30/9; tháng này hay cả sổ → hôm nay"; màn hình: ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-06, 390px và 1280px) |
| ⚠ AC-9: Mở từ Giao dịch gần đây và từ Ngân sách | ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-06, 390px và 1280px, sáng / tối) |

## Cho thuê lại (rental)

### [UC-801](rental/UC-801-thiet-lap-nguoi-thue.md) Thiết lập người thuê, phí cố định & chi chung
Status: `implemented` · BR: BR-11, BR-08

| AC | Test |
|---|---|
| ✅ AC-1: Thêm người thuê và phí cố định | `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau"; form phí: `web/src/lib/rental.test.ts` › "Cài đặt › Cho thuê › phí cố định cần tên và số dương" |
| ✅ AC-2: Số dư mở sổ là một dòng `opening`, tháng sau thấy ở số dư đầu kỳ | `test/rental.test.ts` › "/v1/rental › số dư mở sổ là dòng opening; tháng sau thấy nó ở số dư đầu kỳ"; `web/src/lib/rental.test.ts` › "Cài đặt › Cho thuê › người thuê mới: số dư mở sổ có dấu, 0 thì không gửi" |
| ✅ AC-3: Đổi số người chia thì phần chi chung tính lại | `test/rental.test.ts` › "/v1/rental › đổi số người chia (4) → phần chi chung giảm"; `web/src/lib/rental.test.ts` › "Cài đặt › Cho thuê › cấu hình: số người ≥ 1, ít nhất một danh mục chung, bắt buộc chọn nguồn thu" |
| ✅ AC-4: Phí đã tắt không vào bản nháp | `test/rental.test.ts` › "domain rental › phần chi chung = floor(tổng / số người), phí tắt không vào nháp" |
| ✅ AC-5: Người thuê đã ra không được nhắc chốt tháng | `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › nhắc chốt tháng với người thuê đang ở chưa chốt tháng trước; đã chốt hoặc đã ngừng thì không nhắc" |
| ⚠ AC-6: Cấu hình sai bị từ chối, không ghi gì | ⚠ Chưa có test |
| ✅ AC-7: Dữ liệu mặc định cho thuê trong hộ mẫu | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó" (nguồn `rental` → `rental-income` 100%, `debt-payment` trỏ ví `rental-income`); `test/settings.test.ts` › "nguồn thu và chia phong bì theo tuần › đọc hồ sơ nguồn thu seed; thêm/sửa nguồn; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối" (nguồn `salary-wife`); [`test/schema.test.ts`](../test/schema.test.ts) › "seed › có đủ dữ liệu hệ thống: kết nối SePay 'default' cho mọi tài khoản bật SePay, danh mục trả nợ / cho vay, nguồn thu cho thuê, config rental_* và notify_*"; `rental_headcount`/`rental_shared_categories`: phủ gián tiếp qua `test/rental.test.ts` (số người 3, `groceries`/`utilities` là danh mục chung) |
| ✅ AC-8: Migration 0029 đổi nguồn cho thuê sang mã hệ thống `rental`, số liệu không đổi | `test/migrations/system-ids.test.ts` › "migration 0029: mã hệ thống tiếng Anh › kết nối 'chinh' → 'default', danh mục 'tra-no' / 'cho-vay' → 'debt-payment' / 'lending', nguồn 'cho-thue' → 'rental' ở mọi bảng con và config; số chi, sổ nợ, sổ người thuê, ví, sổ tài khoản không đổi; khoá ngoại sạch" · "migration 0029: mã hệ thống tiếng Anh › code sau 0029 › GET /v1/rental trả incomeStreamId 'rental'; khoản thu của người thuê không chọn nguồn ghi 'rental'; trả nợ không chọn danh mục vào 'debt-payment'" |

### [UC-802](rental/UC-802-ghi-nguoi-thue-chi-ho.md) Ghi người thuê chi hộ & dòng sổ tay
Status: `implemented` · BR: BR-11, BR-03

| AC | Test |
|---|---|
| ✅ AC-1: Chi hộ gửi số dương, lưu số âm, cộng vào tổng chi chung | `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau"; `web/src/lib/rental.test.ts` › "dòng ghi tay › người thuê chi hộ: gửi số dương, phải thuộc danh mục chi chung" |
| ✅ AC-2: Chỉ ghi chi hộ được cho danh mục chi chung | `test/rental.test.ts` › "/v1/rental › dòng ghi tay idempotent theo client_id; chi hộ chỉ nhận danh mục chi chung"; `test/mcp.test.ts` › "sổ người thuê › add_tenant_shared_expense với danh mục không phải chi chung → tool error" |
| ✅ AC-3: Gửi lại cùng `client_id` chỉ ghi một lần | `test/rental.test.ts` › "/v1/rental › dòng ghi tay idempotent theo client_id; chi hộ chỉ nhận danh mục chi chung" |
| ✅ AC-4: MCP ghi chi hộ như REST | `test/mcp.test.ts` › "sổ người thuê › add_tenant_shared_expense ghi dòng âm; list_tenants thấy số dư giảm" |
| ⚠ AC-5: Phí một lần cần tên; chỉnh tay có dấu | `web/src/lib/rental.test.ts` › "dòng ghi tay › chỉnh giảm nợ gửi số âm; phí một lần cần tên"; phía server (E4): ⚠ Chưa có test |
| ✅ AC-6: Huỷ dòng đổi số dư; huỷ lần hai báo lỗi | `test/rental.test.ts` › "/v1/rental › huỷ dòng sổ đổi số dư; huỷ giao dịch tiền trả thì số dư trở lại" |
| ⚠ AC-7: Người thuê đã ra không ghi chi hộ được | ⚠ Chưa có test |
| ⚠ AC-8: Sổ chỉ ghi thêm ở tầng DB | ⚠ Chưa có test |

### [UC-803](rental/UC-803-xem-tam-tinh.md) Xem tạm tính tháng & bảng kê
Status: `implemented` · BR: BR-11

| AC | Test |
|---|---|
| ✅ AC-1: Tạm tính đúng ví dụ của proposal | `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau" |
| ✅ AC-2: Phần chi chung làm tròn xuống, phần lẻ hộ chịu | `test/rental.test.ts` › "domain rental › phần chi chung = floor(tổng / số người), phí tắt không vào nháp" |
| ✅ AC-3: Tiền đã chuyển hiện trong tháng, bảng kê nói rõ số dư mang sang | `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau" |
| ✅ AC-4: Số dư đầu tháng mang từ các tháng trước | `test/rental.test.ts` › "/v1/rental › số dư mở sổ là dòng opening; tháng sau thấy nó ở số dư đầu kỳ" |
| ✅ AC-5: Dấu số dư: dương còn nợ, âm trả dư | `web/src/lib/rental.test.ts` › "số dư người thuê › dương là còn nợ, âm là trả dư mang sang tháng sau" |
| ⚠ AC-6: Xem tạm tính không ghi gì | ⚠ Chưa có test |
| ⚠ AC-7: Không xem được tháng chưa tới | ⚠ Chưa có test (chỉ có test cho chốt tháng — UC-804 AC-3) |

### [UC-804](rental/UC-804-chot-thang-voi-nguoi-thue.md) Chốt tháng với người thuê
Status: `implemented` · BR: BR-11, BR-06

| AC | Test |
|---|---|
| ✅ AC-1: Chốt ghi các dòng một lần, số dư cộng đủ | `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau" |
| ✅ AC-2: Chốt lần hai cùng tháng bị từ chối, không ghi thêm | `test/rental.test.ts` › "/v1/rental › chốt lần hai cùng tháng → 409 already_settled, không ghi thêm dòng" |
| ✅ AC-3: Không chốt được tháng chưa tới | `test/rental.test.ts` › "/v1/rental › không chốt được tháng chưa tới" |
| ✅ AC-4: Sửa bản nháp trước khi lưu — đổi số người | `web/src/lib/rental.test.ts` › "chốt tháng › đổi số người: chi chung tính lại, phần lẻ hộ chịu; phí cố định giữ nguyên"; `web/src/lib/rental.test.ts` › "chốt tháng › bản nháp cộng đúng phần phải trả" |
| ⚠ AC-5: Thân yêu cầu chốt: dòng chỉnh được âm, phí không được âm | `web/src/lib/rental.test.ts` › "chốt tháng › thân yêu cầu: dòng chỉnh được âm, phí không được âm, số người ≥ 1"; kiểm tương ứng ở server (E2): ⚠ Chưa có test |
| ✅ AC-6: Tin sáng ngày 1 nhắc chốt với từng người thuê chưa chốt tháng trước | `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › nhắc chốt tháng với người thuê đang ở chưa chốt tháng trước; đã chốt hoặc đã ngừng thì không nhắc"; `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › ngày thường không nhắc chốt tháng người thuê"; `test/format.test.ts` › "dailyMessage › ngày 1: mỗi người thuê chưa chốt tháng trước một dòng nhắc kèm số dư" |
| ⚠ AC-7: Sau khi chốt, tạm tính dùng số người và tổng chi chung đã lưu | ⚠ Chưa có test |
| ⚠ AC-8: Sửa tháng đã chốt bằng huỷ dòng + chỉnh | `test/rental.test.ts` › "/v1/rental › huỷ dòng sổ đổi số dư; huỷ giao dịch tiền trả thì số dư trở lại" (phần huỷ dòng); trọn luồng trên dòng chốt: ⚠ Chưa có test |

### [UC-805](rental/UC-805-nhan-tien-nguoi-thue-tra.md) Nhận tiền người thuê trả & dùng tiền "Thu cho thuê"
Status: `implemented` · BR: BR-11, BR-02, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Nhập tay tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào "Thu cho thuê" | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; qua MCP: `test/mcp.test.ts` › "add_transaction › income kèm tenant_id → gắn người thuê, tự lấy nguồn thu cho thuê" |
| ✅ AC-2: Gán log tiền vào cho người thuê | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền vào cho người thuê → nguồn cho thuê mặc định, chia 100% vào Thu cho thuê, số dư người thuê giảm" |
| ✅ AC-3: Rule người thuê chỉ gợi ý, không tự gán; chỉ dùng cho tiền vào | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán"; `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ dùng cho tiền vào" |
| ✅ AC-4: Huỷ khoản tiền trả thì số dư người thuê trở lại | `test/rental.test.ts` › "/v1/rental › huỷ dòng sổ đổi số dư; huỷ giao dịch tiền trả thì số dư trở lại" |
| ✅ AC-5: Tiền người thuê không vào ví chi tiêu | `test/allocation.test.ts` › "chia theo nguồn thu › nguồn cho thuê khóa 100% vào Thu cho thuê: đúng một fund, không chạy dòng thác, không cờ thiếu sàn" |
| ⚠ AC-6: Người thuê sai / gắn sai loại bị từ chối | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối"; người thuê đã ra (`inactive_tenant`): ⚠ Chưa có test |
| ✅ AC-7: Trả nợ chi thẳng từ "Thu cho thuê" | `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó" |
| ✅ AC-8: Sang Tích sản bằng gán log ra kèm chuyển ví | `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền ra thành chuyển khoản kèm chuyển ví Thu cho thuê → Tích sản"; `web/src/lib/splits.test.ts` › "tách log: tổng phải khớp số tiền log › chuyển kèm ví: đủ cả hai ví khác nhau, hoặc không ví nào" |

## Sổ nợ (debt)

### [UC-901](debt/UC-901-them-va-xem-khoan-no.md) Thêm và xem khoản nợ
Status: `implemented` · BR: BR-12, BR-05

| AC | Test |
|---|---|
| ✅ AC-1: Thêm khoản nợ ghi dòng mở sổ; còn nợ bằng số tiền | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › tạo khoản nợ ghi dòng opening, số còn nợ bằng số tiền" |
| ✅ AC-2: Số tiền phải lớn hơn 0; trùng mã báo `duplicate_id` | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › thêm khoản nợ: số tiền phải lớn hơn 0, trùng mã báo duplicate_id"; [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › kiểm tra khoản nợ mới và dòng nợ: thiếu tên, số tiền" |
| ✅ AC-3: Trả hết thì khoản nợ được đánh dấu `done` | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › trả hết thì khoản nợ được đánh dấu done" |
| ✅ AC-4: Tab Nợ xếp khoản còn nợ nhiều lên trước, trả xong tách riêng | [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › sắp xếp khoản nợ: còn nợ nhiều lên trước, trả xong tách riêng" |
| ✅ AC-5: `bootstrap` trả các khoản nợ đang mở kèm số còn nợ | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › bootstrap trả các khoản nợ đang mở kèm số còn nợ" |
| ✅ AC-6: MCP `get_debts` trả cùng dữ liệu như REST | [`test/mcp.test.ts`](../test/mcp.test.ts) › "sổ nợ › get_debts trả các khoản nợ và tổng còn nợ" |
| ✅ AC-7: Tắt khoản nợ thì không trả, không vay thêm được và ra khỏi tổng | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › debt_id không có hoặc đã tắt: unknown_debt, inactive_debt"; [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › bootstrap trả các khoản nợ đang mở kèm số còn nợ" |
| ✅ AC-8: Đổi mã danh mục trả nợ không làm đổi còn nợ | `test/migrations/system-ids.test.ts` › "migration 0029: mã hệ thống tiếng Anh › kết nối 'chinh' → 'default', danh mục 'tra-no' / 'cho-vay' → 'debt-payment' / 'lending', nguồn 'cho-thue' → 'rental' ở mọi bảng con và config; số chi, sổ nợ, sổ người thuê, ví, sổ tài khoản không đổi; khoá ngoại sạch" · "migration 0029: mã hệ thống tiếng Anh › code sau 0029 › GET /v1/rental trả incomeStreamId 'rental'; khoản thu của người thuê không chọn nguồn ghi 'rental'; trả nợ không chọn danh mục vào 'debt-payment'"; [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › trả nợ không chọn danh mục thì lấy danh mục debt-payment" |

### [UC-902](debt/UC-902-tra-no.md) Trả nợ: ghi tay, offline, từ ví giữ riêng
Status: `implemented` · BR: BR-12, BR-03, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Khoản chi có `debt_id` làm giảm số còn nợ | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › khoản chi có debt_id làm giảm số còn nợ" |
| ✅ AC-2: Huỷ khoản trả nợ thì số còn nợ trở lại | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › huỷ khoản trả nợ thì số còn nợ trở lại" |
| ✅ AC-3: `debt_id` chỉ gắn với khoản chi | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › debt_id chỉ gắn với khoản chi: debt_spend_only" |
| ✅ AC-4: Khoản nợ không có hoặc đã tắt bị từ chối | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › debt_id không có hoặc đã tắt: unknown_debt, inactive_debt" |
| ✅ AC-5: Trả nợ không chọn danh mục thì lấy danh mục `debt-payment` | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › trả nợ không chọn danh mục thì lấy danh mục debt-payment" |
| ✅ AC-6: MCP `add_transaction` nhận `debt_id` | [`test/mcp.test.ts`](../test/mcp.test.ts) › "sổ nợ › add_transaction nhận debt_id" |
| ✅ AC-7: Sheet Trả nợ chọn sẵn khoản còn nợ nhiều nhất | [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › trả nợ mặc định chọn khoản còn nợ nhiều nhất" |
| ✅ AC-8: Toast nói đã trả bao nhiêu và còn nợ bao nhiêu | [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › toast sau khi trả nợ: Đã trả X cho tên. Còn nợ Y." |
| ⚠ AC-9: Trả nợ ghi được khi offline, đồng bộ đúng một lần | ⚠ Chưa có test |

### [UC-903](debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md) Gán giao dịch ngân hàng là trả nợ
Status: `implemented` · BR: BR-12, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Gán log tiền ra thành khoản trả nợ làm giảm số còn nợ | [`test/logs.test.ts`](../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền ra thành khoản trả nợ (debt_id) làm giảm số còn nợ" |
| ⚠ AC-2: `debt_id` sai trên split bị từ chối, không ghi nửa chừng | [`test/logs.test.ts`](../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền ra thành khoản trả nợ (debt_id) làm giảm số còn nợ" (phần `debt_spend_only`); `unknown_debt`/`inactive_debt` khi gán: ⚠ Chưa có test |
| ⚠ AC-3: Gỡ gán khoản trả nợ thì số còn nợ trở lại | ⚠ Chưa có test |

### [UC-904](debt/UC-904-vay-them-chinh-huy-dong-no.md) Vay thêm, chỉnh tay, huỷ dòng nợ
Status: `implemented` · BR: BR-12, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Vay thêm làm tăng số còn nợ | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › vay thêm làm tăng số còn nợ" |
| ✅ AC-2: Chỉnh tay cộng hoặc trừ số còn nợ | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › chỉnh tay cộng hoặc trừ số còn nợ" |
| ✅ AC-3: Huỷ dòng nợ đổi lại số còn nợ; huỷ lần hai báo lỗi | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › huỷ dòng nợ thì số còn nợ đổi lại, huỷ lần hai báo already_void" |
| ✅ AC-4: Sổ nợ chỉ ghi thêm ở tầng DB | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › dòng nợ chỉ ghi thêm: chỉ đổi active sang void, không xoá"; [`test/schema.test.ts`](../test/schema.test.ts) › "chốt chặn toàn vẹn ở tầng DB › debt_lines chỉ ghi thêm và v_debt_balance trừ khoản trả nợ" |
| ✅ AC-5: Form dòng nợ ở PWA gửi đúng dấu | [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › kiểm tra khoản nợ mới và dòng nợ: thiếu tên, số tiền" |
| ✅ AC-6: Khoản nợ đã tắt không nhận dòng mới | [`test/debts.test.ts`](../test/debts.test.ts) › "sổ nợ › debt_id không có hoặc đã tắt: unknown_debt, inactive_debt" |

## Sổ phải thu (receivable)

### [UC-1001](receivable/UC-1001-them-va-xem-khoan-phai-thu.md) Thêm và xem khoản phải thu
Status: `implemented` · BR: BR-13, BR-05

| AC | Test |
|---|---|
| ✅ AC-1: Thêm khoản phải thu ghi dòng mở sổ, không đổi ví hay tài khoản | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › thêm khoản phải thu chỉ ghi nhớ: dòng opening, không tài khoản nào, không ví nào đổi" |
| ✅ AC-2: Số tiền không được âm hay lẻ; trùng mã báo `duplicate_id` | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › thêm khoản phải thu: số tiền âm hoặc lẻ bị từ chối, trùng mã báo duplicate_id"; [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › kiểm tra khoản phải thu mới và dòng chỉnh: thiếu tên, số tiền âm hay lẻ; số 0 được (thêm người chưa nợ gì); chỉnh mang dấu" |
| ✅ AC-3: Nhận đủ thì khoản được đánh dấu `done`, xếp sau khoản còn nợ | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › trả đủ thì khoản phải thu done, xuống cuối danh sách, không còn trong tổng" |
| ✅ AC-4: `bootstrap` trả các khoản phải thu đang bật kèm số còn phải thu | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › bootstrap trả các khoản phải thu đang mở kèm số còn phải thu" |
| ✅ AC-5: MCP `get_receivables` trả cùng dữ liệu như REST | [`test/mcp.test.ts`](../test/mcp.test.ts) › "sổ phải thu › get_receivables trả các khoản phải thu và tổng còn phải thu" |
| ✅ AC-6: Tắt khoản phải thu thì không gắn được giao dịch, không nhận dòng, ra khỏi tổng | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › receivable_id không có hoặc đã tắt: unknown_receivable, inactive_receivable" |
| ⚠ AC-7: Tab Nợ xếp khoản còn phải thu nhiều lên trước, đã trả đủ tách riêng | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › sắp khoản phải thu: còn nhiều lên trước, đã trả đủ tách riêng theo tên, khoản tắt không hiện"; hiển thị: ⚠ Chưa có test |
| ✅ AC-8: Thêm người với số 0 — không dòng mở sổ; nhận lại thì thành trả dư | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › thêm người với số 0 (+ Người mới… ở màn Gán): không dòng opening, còn phải thu 0; nhận lại thì thành trả dư" |
| ✅ AC-9: Tab Nợ thêm được người chưa nợ gì | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › kiểm tra khoản phải thu mới và dòng chỉnh: thiếu tên, số tiền âm hay lẻ; số 0 được (thêm người chưa nợ gì); chỉnh mang dấu"; [`web/src/lib/debts.test.ts`](../web/src/lib/debts.test.ts) › "sổ nợ › kiểm tra khoản nợ mới và dòng nợ: thiếu tên, số tiền"; [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › thêm người với số 0 (+ Người mới… ở màn Gán): không dòng opening, còn phải thu 0; nhận lại thì thành trả dư" (server); nút, toast: ⚠ Chưa có test (repo chưa có test giao diện; đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |

### [UC-1002](receivable/UC-1002-cho-vay-tra-ho.md) Cho vay / trả hộ
Status: `implemented` · BR: BR-13, BR-03, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Cho vay gắn khoản phải thu làm tăng còn phải thu, không đụng ví | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › cho vay thêm (lend gắn khoản phải thu) tăng số phải thu, trừ tài khoản, không trừ ví, danh mục mặc định Cho vay" |
| ✅ AC-2: `receivable_id` chỉ gắn với cho vay hoặc nhận lại | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › receivable_id chỉ gắn với lend / collect: receivable_only, kể cả refund" |
| ✅ AC-3: Khoản phải thu không có hoặc đã tắt bị từ chối | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › receivable_id không có hoặc đã tắt: unknown_receivable, inactive_receivable" |
| ✅ AC-4: Huỷ khoản cho vay thì còn phải thu trở lại | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › huỷ khoản cho vay hoặc khoản nhận lại thì số phải thu trở lại" |
| ⚠ AC-5: Gán log tiền ra thành cho vay | ⚠ Chưa có test (cùng `buildEntry` với AC-1; split `collect` được thử ở [UC-1003](receivable/UC-1003-nhan-lai-tien.md) AC-4) |
| ⚠ AC-6: Thân giao dịch cho vay ở PWA: cần số tiền và tài khoản, gắn khoản nếu có, không mang ví | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › thân giao dịch cho vay / nhận lại: cần số tiền và tài khoản, gắn khoản phải thu nếu có, không mang ví"; đồng bộ offline đúng một lần: ⚠ Chưa có test |

### [UC-1003](receivable/UC-1003-nhan-lai-tien.md) Nhận lại tiền
Status: `implemented` · BR: BR-13, BR-04, BR-01

| AC | Test |
|---|---|
| ✅ AC-1: Nhận lại tiền giảm còn phải thu, tăng tài khoản, không đụng ví | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › collect nâng số dư sổ của tài khoản nhận, không đụng ví nào, trừ số phải thu"; [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › collect không có tài khoản thì vào tiền mặt của người ghi" |
| ✅ AC-2: Vòng cho vay → nhận lại không làm ví phồng (lỗi cũ `lend` → `refund`) | [`test/receivables.test.ts`](../test/receivables.test.ts) › "tiền cho vay về không phải thu nhập (ADR-72) › lỗi cũ: cho vay 300.000 rồi nhận lại 300.000 — không ví nào đổi, tài khoản về như cũ, còn phải thu 0" |
| ✅ AC-3: `collect` không phải thu nhập, không là "đã tiêu", không đổi "còn để chi" | [`test/receivables.test.ts`](../test/receivables.test.ts) › "tiền cho vay về không phải thu nhập (ADR-72) › collect không đổi 'còn để chi tuần này', không vào đã tiêu, không chia được như thu nhập — chỉ tiền chi được tăng (tiền thật về tài khoản)" |
| ✅ AC-4: Gán log tiền vào là nhận lại tiền, không bao giờ là thu nhập | [`test/logs.test.ts`](../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền vào là nhận lại tiền cho vay (collect): trừ khoản phải thu, không thành thu nhập, không chia, ví không đổi" |
| ✅ AC-5: `refund` không còn gắn được khoản phải thu | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › receivable_id chỉ gắn với lend / collect: receivable_only, kể cả refund" |
| ✅ AC-6: Migration 0014 nhận `collect` mà giữ nguyên dữ liệu; `v_wallet_flow` bỏ qua `lend`/`collect` | `test/migrations/milestones.test.ts` › "migrations › 0014 dựng lại transactions để nhận meaning collect mà giữ nguyên dữ liệu, bảng con, index và trigger"; [`test/schema.test.ts`](../test/schema.test.ts) › "chốt chặn toàn vẹn ở tầng DB › receivable_lines chỉ ghi thêm; v_receivable_balance cộng tiền cho vay, trừ tiền nhận lại; ví không đổi" |
| ✅ AC-7: MCP ghi và gán được `collect` | [`test/mcp.test.ts`](../test/mcp.test.ts) › "sổ phải thu › add_transaction nhận collect + receivable_id; assign_log nhận split collect" |
| ✅ AC-8: Toast sau khi nhận lại nói còn bao nhiêu chưa trả | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › toast sau khi nhận lại: còn bao nhiêu chưa trả, hoặc đã trả đủ (trả dư cũng là đủ)" |
| ✅ AC-9: Nhận lại chỉ đúng lần cho vay; hai khoản thấy nhau | [`test/logs.test.ts`](../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › gán log tiền vào là nhận lại có link_id về khoản cho vay: lấy người của khoản cho vay; khác người hay trỏ khoản chi → invalid_link, log vẫn chờ"; [`test/receivables.test.ts`](../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › nhận lại có link_id về khoản cho vay: không chọn người thì lấy người của khoản cho vay; khác người, trỏ khoản chi hay khoản đã huỷ → invalid_link; sửa giữ liên kết"; [`web/src/lib/refunds.test.ts`](../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › chi tiết giao dịch: dòng Trả cho nói loại gốc, ngày, số tiền; Đã nhận lại nói tổng và chênh (trả dư / còn thiếu / đủ)" |
| ✅ AC-10: Nhận lại tiền ở tab Nợ chỉ đúng lần cho vay của người đó | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › nhận lại ở tab Nợ chọn khoản cho vay gốc: gửi link_id; cho vay thì không bao giờ gửi (change 261005-lien-ket-khoan-goc)"; ô chọn: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |
| ✅ AC-11: Cho vay và nhận lại có thể khác tài khoản | `test/receivables.test.ts` › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › cho vay và nhận lại khác tài khoản (tiền mặt ↔ ngân hàng) vẫn nối được; số phải thu và số dư từng tài khoản đúng" |
| ✅ AC-12: Ai trả chỉ chọn sẵn người còn nợ | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › chọn sẵn khoản được mở từ, không thì khoản còn phải thu nhiều nhất; ai cũng đã trả đủ thì không chọn ai; bootstrap cũ không có trường thì null"; ô chọn: ⚠ Chưa có test (repo chưa có test giao diện; Loại khác và màn Gán đã xem tận mắt ở 390px, `wrangler dev` cục bộ) |
| ✅ AC-13: Mua hộ trả dư: Nhận lại đúng số còn nợ, phần dư là Thu nhập (ADR-84) | [`test/logs.test.ts`](../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › mua hộ là cho vay (ADR-84): trả dư thì tách Nhận lại đúng số còn nợ + Thu nhập phần dư — hết nợ, phần dư chia được, chi tiêu không đổi" (server); [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › dòng dưới ô Ai trả / Cho ai vay: còn nợ trước và sau khoản này; nhận lại vượt số còn nợ thì báo phần dư của lần trả này"; [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › trả dư: nhận lại đúng số còn nợ, phần dư là Thu nhập (màn Gán tách dòng, Loại khác ghi riêng); Hoàn tiền chỉ cho chia bill có phần mình (ADR-84)"; dòng gợi ý trong sheet: ⚠ Chưa có test (repo chưa có test giao diện) |

### [UC-1004](receivable/UC-1004-chinh-huy-dong-phai-thu.md) Chỉnh / huỷ dòng phải thu
Status: `implemented` · BR: BR-13, BR-04

| AC | Test |
|---|---|
| ✅ AC-1: Chỉnh tay cộng hoặc trừ còn phải thu; chỉ nhận `adjust` | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › chỉnh tay cộng hoặc trừ số phải thu; chỉ ghi tay được dòng adjust" |
| ✅ AC-2: Huỷ dòng đổi lại còn phải thu; huỷ lần hai báo lỗi | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › huỷ dòng phải thu thì số phải thu đổi lại, huỷ lần hai báo already_void" |
| ✅ AC-3: Sổ phải thu chỉ ghi thêm ở tầng DB | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › dòng phải thu chỉ ghi thêm: chỉ đổi active sang void, không xoá"; [`test/schema.test.ts`](../test/schema.test.ts) › "chốt chặn toàn vẹn ở tầng DB › receivable_lines chỉ ghi thêm; v_receivable_balance cộng tiền cho vay, trừ tiền nhận lại; ví không đổi" |
| ✅ AC-4: Khoản đã tắt không nhận dòng mới | [`test/receivables.test.ts`](../test/receivables.test.ts) › "sổ phải thu › receivable_id không có hoặc đã tắt: unknown_receivable, inactive_receivable" |
| ✅ AC-5: Form chỉnh ở PWA gửi đúng dấu | [`web/src/lib/receivables.test.ts`](../web/src/lib/receivables.test.ts) › "sổ phải thu › kiểm tra khoản phải thu mới và dòng chỉnh: thiếu tên, số tiền âm hay lẻ; số 0 được (thêm người chưa nợ gì); chỉnh mang dấu" |

### [UC-1005](receivable/UC-1005-xem-buc-tranh-tien-that.md) Xem bức tranh tiền thật
Status: `implemented` · BR: BR-13, BR-01, BR-07

| AC | Test |
|---|---|
| ✅ AC-1: Hộ chưa có gì thì mọi số bằng 0 | [`test/receivables.test.ts`](../test/receivables.test.ts) › "GET /v1/networth — tiền thật trước, ghi nhớ ai nợ ai sau › chưa có gì: mọi số bằng 0" |
| ✅ AC-2: Tiền thật = tổng sổ tài khoản đang dùng; ghi nhớ không bao giờ vào tiền thật | [`test/receivables.test.ts`](../test/receivables.test.ts) › "GET /v1/networth — tiền thật trước, ghi nhớ ai nợ ai sau › tiền thật = Σ số dư sổ tài khoản đang dùng; sổ phải thu / nợ / người thuê không bao giờ vào tiền thật" |
| ⚠ AC-3: Khối tiền thật xếp đúng thứ tự, tiền thật là số hero, tài sản ròng đứng cuối | [`web/src/lib/networth.test.ts`](../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › đủ mọi nhóm: tiền thật đầu tiên và là số hero, tài sản ròng cuối cùng và nhỏ hơn, nợ mang dấu âm"; hiển thị: ⚠ Chưa có test |
| ✅ AC-4: Dòng bằng 0 ẩn, tiền thật và tài sản ròng luôn còn | [`web/src/lib/networth.test.ts`](../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › ẩn dòng bằng 0: không tài sản, không ai nợ, không người thuê trả trước — vẫn giữ tiền thật và tài sản ròng"; [`web/src/lib/networth.test.ts`](../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › chỉ người thuê còn nợ: nhóm Người khác nợ mình kèm đúng một dòng chi tiết" |
| ✅ AC-5: Heo đất là tiền Tích sản đã khóa — nằm trong tiền thật và trong Tích sản, tách tổng và từng người, không đếm hai lần (ADR-77, ADR-82) | [`test/piggy-bank.test.ts`](../test/piggy-bank.test.ts) › "GET /v1/networth: heo đất là tiền Tích sản đã khóa › nằm trong tiền thật và trong Tích sản, tách tổng và từng người — không đếm hai lần" |
| ⚠ AC-6: Dòng phụ của tiền thật nói heo đất là một phần của Tích sản (tổng kèm từng người), không kể thêm lần nữa (ADR-82) | [`web/src/lib/networth.test.ts`](../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › heo, phao, sổ tiết kiệm là chỗ tiền Tích sản đang nằm: nói là một phần của Tích sản (tổng kèm từng tài khoản), không kể thêm lần nữa (ADR-82, ADR-88)"; [`test/buffer.test.ts`](../test/buffer.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › DB mới: chuyển 1.000.000 vào phao → Tích sản +1.000.000, Tiền chi được −1.000.000 một lần; gửi 800.000 phao → sổ không đổi gì; tất toán 820.000 (20.000 lãi là Thu nhập) → Tích sản về phao" (server `wealthBuildingAccounts`); hiển thị: ⚠ Chưa có test |
