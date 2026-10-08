# 261004-gan-tham-chieu: Gán tiền vào chỉ rõ khoản đã chi / khoản cho vay
- Status: implemented (2026-10-04, code + test xanh, commit `c9c6acb`; hợp nhất vào `specs/` cùng ngày) — duyệt: chủ nhà "oke, duyệt nhé", 2026-10-04
- BR: BR-01, BR-13 (sổ phải thu)
- Đụng tới: pwa UC-706 (Gán), UC-705 (Loại khác › Hoàn tiền / Cho vay / Nhận lại tiền cho vay); ingest UC-305 (split `link_id`); ledger UC-101 (refund `link_id` — kiểm dùng chung), UC-111 (`GET /v1/transactions/refund-candidates`); receivable UC-1001 (mở sổ 0), UC-1002, UC-1003, README S1
- Người duyệt nghiệp vụ: chủ nhà

## Vì sao
Chủ nhà 2026-10-04, màn Gán khoản +250.000 chọn "Nhận lại tiền cho vay", ô "Ai trả" = "không gắn khoản phải thu": "chỗ này nên có optional thêm khoản cho vay hoặc khoản đã chi là khoản nào". Bối cảnh: mua hộ thuốc 244.000, người ta trả lại 250.000 — người cần thấy tiền về là của khoản nào và chênh bao nhiêu.

Hiện tại: Nhận lại tiền cho vay chỉ chọn được một **khoản phải thu đã có** (theo người); chưa có người đó thì không tạo được ngay tại màn Gán. Hoàn tiền không chọn được khoản chi gốc ở màn Gán, dù server đã nhận `link_id` cho `refund` (ledger UC-101: kiểm `link_id` trỏ về `spend` còn hiệu lực, kế thừa `category_id`).

## Thay đổi spec
### pwa UC-706 (Gán) — dòng Hoàn tiền
- ADDED ô tuỳ chọn **Trả lại cho khoản chi** — mục đầu "không chỉ khoản nào"; liệt kê các khoản `spend` còn hiệu lực 30 ngày gần nhất, ưu tiên khoản gần số tiền nhất (|chênh| tăng dần, rồi mới nhất), mỗi mục "d/m · {danh mục} · {ghi chú hoặc nội dung ngân hàng} · X ₫".
- Chọn một khoản → danh mục và ví tự điền theo khoản đó; split gửi `link_id`; dưới ô hiện "Khoản chi X · trả lại Y · chênh ±Z ₫ (nằm lại trong danh mục {tên})".
- ADDED AC: chọn khoản chi 244.000 cho dòng Hoàn tiền 250.000 → split có `link_id`, danh mục & ví bằng khoản gốc, dòng chênh "+6.000"; không chọn → như cũ.

### pwa UC-706 (Gán) — dòng Nhận lại tiền cho vay / Cho vay
- MODIFIED ô **Ai trả** / **Cho ai vay**: thêm mục cuối **+ Người mới…** → hỏi tên (một ô) → tạo khoản phải thu (`POST /v1/receivables`, số mở sổ 0) rồi chọn luôn. Nhận lại tiền cho người mới khi số mở sổ 0 → khoản phải thu âm (người ta trả dư) — hiện gợi ý "Nếu đây là mua hộ đã ghi là Chi tiêu, chọn Hoàn tiền thay vì Nhận lại tiền cho vay."
- ADDED: chọn một khoản phải thu → dưới ô hiện "{tên} còn nợ X · sau khoản này còn Y" (âm thì "trả dư Z").
- ADDED AC: tạo người mới ngay tại Gán; số còn nợ trước/sau hiện đúng.

### pwa UC-705 (Loại khác)
- Hoàn tiền / Nhận lại tiền cho vay dùng cùng hai ô trên (component chung).

## Quyết định
Không cần ADR: dùng đúng `link_id` (đã có) và sổ phải thu (ADR-72). Phương án bị loại: bắt buộc chọn khoản gốc (nhiều khoản hoàn không có khoản chi trong sổ — chi trước khi mở sổ, chi tiền mặt quên ghi); tự khớp khoản gốc theo số tiền (hơn/kém là chuyện thường — đoán sai im lặng).

## Thiết kế
- Server: `GET /v1/transactions/refund-candidates?amount=&days=30` (hoặc dùng `GET /v1/transactions` lọc phía máy — chọn cách ít request nhất); `assignLog` / split đã chuyển `link_id` cho `refund`? — kiểm, thêm nếu thiếu, kèm test.
- PWA: component chung `RefundSourcePicker`, `ReceivablePicker` (+ Người mới) trong `web/src/screens/`; dùng ở `assign.tsx`, `other-entry-sheet.tsx`.
- Rủi ro: danh sách khoản chi dài → giới hạn 30 ngày, 20 mục.

## Việc cần làm
- [x] Test cho từng AC mới/sửa (`test/logs.test.ts`, `test/receivables.test.ts`, `web/src/lib/refunds.test.ts`, `web/src/lib/receivables.test.ts`, `web/src/lib/categories.test.ts`; ô chọn trong sheet chưa có test giao diện — ghi ⚠ ở UC, đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ)
- [x] Code — danh sách khoản chi: endpoint riêng `GET /v1/transactions/refund-candidates?days=30` (một request; `GET /v1/transactions` tối đa 200 dòng mọi loại mỗi trang nên 30 ngày có thể cần nhiều trang, và không có nội dung ngân hàng); xếp theo số tiền ở máy (đổi số không hỏi lại). Split gán log trước đây bỏ qua `link_id` → thêm, kiểm chung `resolveRefundLink` với nhập tay. "+ Người mới…" cần server nhận `amount: 0` (DB chặn dòng `opening` ≤ 0) → sổ phải thu `zeroOpening`: chỉ ghi người, không dòng nào. Ví điền từ khoản gốc đi qua `walletOfMember` (ví cá nhân người kia → ví cùng phe người nhập, đúng ví server ghi).
- [x] Cập nhật UC chính + `## History` (pwa UC-705, UC-706; ingest UC-305; ledger UC-101, UC-111; receivable UC-1001, UC-1002, UC-1003, README)
- [x] Sinh lại `traceability.md`, `open-issues.md`
