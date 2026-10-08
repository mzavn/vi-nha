# 261005-lien-ket-khoan-goc: Tiền về chỉ đúng giao dịch gốc (cho vay ↔ nhận lại, chi ↔ hoàn) và xem được hai chiều
- Status: implemented (2026-10-05, code + test xanh, commit `d7992d1`; hợp nhất vào `specs/` cùng ngày) — duyệt: chủ nhà "oke", 2026-10-05
- BR: BR-01, BR-13
- Đụng tới: pwa UC-706 (Gán), UC-705 (Loại khác), UC-707 (tab Nợ › Nhận lại tiền), UC-715 (chi tiết giao dịch); ledger UC-101 (`link_id` cho `collect`), UC-102 (sửa khoản gốc kéo theo khoản trả về), UC-111 (`link-candidates`, `linked_from` / `link`); ingest UC-305 (split `link_id`); mcp UC-604 (`assign_log` nhận `link_id`); receivable UC-1003
- Người duyệt nghiệp vụ: chủ nhà

## Vì sao
Chủ nhà 2026-10-05, sau khi có ô "Trả lại cho khoản chi" (change 261004-gan-tham-chieu): "vay với trả tôi muốn nó link theo dạng giao dịch đã ghi lại ấy — kiểu bill này nhận về, thế bill chi đi là bill nào?"

Hiện tại: Hoàn tiền gắn được với khoản chi gốc (`link_id`), nhưng **Nhận lại tiền cho vay** chỉ gắn với **người** (khoản phải thu), không gắn với **lần cho vay** cụ thể. Và chiều ngược lại không xem được: mở khoản chi / khoản cho vay không thấy nó đã được trả lại bằng giao dịch nào, chênh bao nhiêu.

## Thay đổi spec
### ledger UC-101 — `link_id` cho `collect`
- MODIFIED: `link_id` hợp lệ cho `refund` (→ `spend` còn hiệu lực, như cũ) **và** `collect` (→ `lend` còn hiệu lực). Sai loại → `invalid_link` "Khoản nhận lại phải trỏ về một khoản cho vay còn hiệu lực." `collect` có `link_id` mà không gửi `receivable_id` → kế thừa `receivable_id` của khoản cho vay (nếu có); gửi cả hai mà khác nhau → `invalid_link`.
- Không đổi số dư, không đổi sổ phải thu: `link_id` chỉ là liên kết để đọc.

### pwa UC-706 / UC-705 — ô "Trả cho khoản cho vay"
- ADDED: dòng **Nhận lại tiền cho vay** có ô tuỳ chọn **Trả cho khoản cho vay** (cùng component với "Trả lại cho khoản chi"): các khoản `lend` còn hiệu lực **180 ngày** gần nhất, ưu tiên khoản của người đang chọn ở "Ai trả", rồi số tiền gần nhất, rồi mới nhất; mỗi mục "d/m · {người} · {ghi chú / nội dung ngân hàng} · X ₫". Chọn một khoản → "Ai trả" tự chọn người của khoản đó; dưới ô "Cho vay X · trả lại Y · còn Z / trả dư Z".
- ADDED AC: chọn khoản cho vay 1.000.000 cho dòng nhận lại 600.000 → split có `link_id`, `receivable_id` kế thừa; dòng dưới "còn 400.000".

### pwa UC-715 — xem liên kết hai chiều
- ADDED ở chi tiết giao dịch:
  - Khoản `refund` / `collect` có `link_id`: dòng **"Trả cho"**: "{loại gốc} {d/m} · X ₫" — chạm mở chi tiết khoản gốc.
  - Khoản `spend` / `lend`: mục **"Đã nhận lại"** liệt kê các khoản còn hiệu lực trỏ về nó ("{d/m} · Y ₫", chạm mở), tổng đã nhận và **chênh** = tổng nhận − gốc ("trả dư Z" / "còn thiếu Z" / "đủ").
- Server: `GET /v1/transactions/:id` thêm `linked_from: [{ id, at, amount, meaning }]` (các khoản active có `link_id` = id) — một truy vấn, không thêm request.
- ADDED AC: khoản chi 244.000 có hoàn 250.000 → chi tiết khoản chi hiện "Đã nhận lại 250.000 · trả dư 6.000"; chi tiết khoản hoàn hiện "Trả cho khoản chi 4/10 · 244.000".

### Giới hạn
Chỉ liên kết **giao dịch đã vào sổ**. Khoản gốc còn "chưa gán" ở màn Gán thì phải gán trước (ô hiện gợi ý "Khoản gốc còn chờ gán? Gán nó trước rồi quay lại").

## Quyết định
Không cần ADR: mở rộng `link_id` sẵn có (schema ghi "refund → spend gốc") sang `collect → lend`, cùng nguyên tắc ADR-72 (cho vay/thu hồi là đầu tư, không phải thu chi). Phương án bị loại: bảng liên kết nhiều-nhiều riêng (một khoản về chỉ trả cho một khoản gốc là đủ cho hộ; khoản trả gộp nhiều lần vay thì tách dòng ở Gán); tự gắn theo số tiền (đoán sai im lặng).

## Thiết kế
- `src/services/ledger.ts`: `resolveRefundLink` → `resolveLink` theo meaning; `transactionView` thêm `linked_from`; `lendCandidates` (hoặc tham số `meaning` cho `refund-candidates`, ưu tiên một endpoint `GET /v1/transactions/link-candidates?meaning=spend|lend&days=`).
- `docs/schema.sql`: sửa chú thích cột `link_id` (refund → spend, collect → lend). Không migration.
- PWA: `web/src/screens/ref-pickers.tsx` tổng quát hoá picker; `tx-sheet.tsx` hai mục mới; helper thuần trong `web/src/lib/refunds.ts`.

## Việc cần làm
- [x] Test cho từng AC mới/sửa (`test/logs.test.ts`, `test/receivables.test.ts`, `test/mcp.test.ts`, `web/src/lib/refunds.test.ts`, `web/src/lib/receivables.test.ts`; hàng chạm được và ô chọn trong sheet chưa có test giao diện — ghi ⚠ ở UC, đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ)
- [x] Code — một `resolveLink` (refund → spend, collect → lend; collect kế thừa người của khoản cho vay, khác người → `invalid_link`) cho nhập tay, sửa, gán log (REST và MCP `assign_log`), MCP `add_transaction`; một endpoint `GET /v1/transactions/link-candidates?meaning=spend|lend&days=` thay `refund-candidates` (PWA chuyển hẳn, route cũ bỏ); `transactionView` thêm `linked_from` + `link` trong một batch; một `LinkSourcePicker` cho Gán, Loại khác và tab Nợ › Nhận lại tiền (`onlyReceivable`); `tx-sheet` hai mục mới với helper thuần `linkOriginText` (khoản gốc đã xoá → "· khoản gốc đã xoá"), `returnedText`. Bổ sung khi hợp nhất (ba [OPEN] phát hiện lúc làm, đóng luôn): sửa khoản gốc (huỷ + ghi mới, ADR-73) kéo khoản trả về sang khoản mới trong cùng batch, đổi loại / đổi người → `invalid_link`; huỷ khoản gốc giữ liên kết; MCP `assign_log` nhận `link_id`; tab Nợ › Nhận lại tiền có ô Trả cho khoản cho vay.
- [x] Cập nhật UC chính + `## History` (ledger UC-101, UC-102, UC-111; ingest UC-305; mcp UC-604; pwa UC-705, UC-706, UC-707, UC-715; receivable UC-1003); `docs/schema.sql` chú thích `link_id`
- [x] Sinh lại `traceability.md`, `open-issues.md`
