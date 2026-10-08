# 261004-gan-chua-chia: Gán khoản thu nhưng chưa chia, chia sau
- Status: implemented (2026-10-04, code + test xanh, commit `04c415b`; hợp nhất vào `specs/` cùng ngày) — duyệt: chủ nhà "ok nhé", 2026-10-04
- BR: BR-01 (phân bổ trước rồi mới chi), BR-05
- Đụng tới: pwa UC-706 (Gán), UC-705 (Loại khác › Thu nhập), UC-715 (sheet chi tiết giao dịch); allocation UC-202 (chia một khoản thu); notify UC-405 (nhắc ngày 10/25)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà

## Vì sao
Chủ nhà 2026-10-04, màn Gán một khoản tiền vào 250.000 ₫ ("… chuyen khoan nhanh qua Zalo"): "giao dịch này chỉ là 1 giao dịch mà tôi chưa muốn chia thì tôi cần làm như nào?"

Hiện tại chọn **Thu nhập** ở màn Gán chỉ có một nút **Gán, chia và ghi sổ** — gán xong là chia ngay. Không có cách ghi khoản thu vào sổ mà để chia sau; "Bỏ qua" thì khoản đó không bao giờ vào sổ (sai: tiền đã về thật). Trong khi đó hệ thống đã hỗ trợ trạng thái "thu nhập chưa chia": khoản thu nằm ở ví **Thu nhập** (giữ riêng, không vào "còn để chi"), tin sáng ngày 10/25 nhắc "còn N khoản thu chưa chia" (UC-405), sheet chi tiết ghi "Lần chia: chưa chia" — chỉ thiếu nút.

## Thay đổi spec
### pwa UC-706 (Gán)
- MODIFIED bước 9: dòng Thu nhập (kể cả Thu từ người thuê) có **hai nút**: **Gán, chia và ghi sổ** (như cũ) và **Gán, để chia sau** (nút phụ). Nút phụ gọi `POST /v1/logs/:id/assign` và **không** gọi `/v1/allocate`.
- ADDED AC: Given log tiền vào 250.000, chọn Thu nhập · When bấm "Gán, để chia sau" · Then có giao dịch `income` 250.000, chưa có lần chia; ví Thu nhập +250.000; "còn để chi" không đổi; toast "Đã ghi 250.000 ₫ vào ví Thu nhập, chưa chia. Chia ở Giao dịch gần đây › khoản này › Chia."

### pwa UC-705 (Loại khác › Thu nhập)
- MODIFIED: thêm nút phụ **Ghi, để chia sau** cạnh nút chia (cùng hành vi).

### pwa UC-715 (sheet chi tiết giao dịch)
- ADDED: khoản `income` còn hiệu lực, `allocated = 0` → nút **Chia** mở bảng chia thử (`AllocationPreview`, như UC-705) rồi gọi `/v1/allocate` cho đúng khoản đó. Cần mạng.
- ADDED AC: Given khoản thu chưa chia · When mở chi tiết, bấm Chia → Chia và ghi sổ · Then có lần chia, ví Thu nhập giảm đúng số đó, các ví nhận đúng như bảng chia thử.

### Hôm nay
- ADDED: banner vàng khi có khoản thu chưa chia: "N khoản thu chưa chia (X ₫) — tiền đang nằm ở ví Thu nhập." → **Chia** mở khoản cũ nhất. (Snapshot đã có số dư ví Thu nhập; cần thêm đếm khoản chưa chia vào `attention` — server.)

## Quyết định
Không cần ADR mới: dùng đúng trạng thái "chưa chia" đã có (ADR-34 chia idempotent theo khoản thu; ví Thu nhập là trạm trung chuyển). Phương án bị loại: **Bỏ qua rồi ghi tay sau** (mất liên kết với giao dịch ngân hàng, đối soát lệch); **gán thành Chuyển nội bộ / Hoàn tiền cho tạm** (sai bản chất, làm lệch ví).

## Thiết kế
- `web/src/screens/assign.tsx` (nút phụ, bỏ bước allocate), `web/src/screens/other-entry-sheet.tsx` (nút phụ), `web/src/screens/tx-sheet.tsx` (nút Chia + bảng chia thử dùng lại `AllocationPreview`), `web/src/screens/today.tsx` / `today-desktop.tsx` (banner).
- Server: `getSnapshot` thêm `attention.unallocatedIncome: { count, amount }` (một truy vấn trong batch sẵn có). Không migration.
- Rủi ro: khoản thu để lâu không chia → tiền nằm im ở ví Thu nhập; đã có nhắc 10/25 + banner mới.

### pwa UC-706 (Gán) — chữ nhắc theo loại
Chủ nhà 2026-10-04: "mình chi trước, nhận lại đúng khoản tiền đó thôi… thậm chí trả không khớp, hơn kém (mua hộ thuốc 244k, trả lại 250k) — mình vẫn ghi nhận chênh lệch thôi; có khá nhiều case phát sinh kiểu này vì đây là nghiệp vụ về tiền".
- ADDED: dưới hàng chip "Gán thành", chip đang chọn có một dòng giải thích (`.fhint`), lấy từ một bảng chữ chung (`web/src/lib/`), ví dụ:
  - Thu nhập: "Tiền mới của nhà (lương, thưởng, lãi, quà) — sẽ được chia vào các ví."
  - Thu từ người thuê: "Người thuê trả tiền — trừ vào số họ còn nợ, chia theo nguồn cho thuê."
  - Hoàn tiền: "Mình chi trước, người ta trả lại (đủ, hơn hay kém đều được) — chọn đúng danh mục, ví của khoản chi đó; phần chênh tự nằm lại trong danh mục."
  - Nhận lại tiền cho vay: "Người ta trả khoản mình đã ghi Cho vay — giảm số người khác nợ mình, không chia."
  - Chuyển nội bộ: "Tiền của chính nhà mình chuyển qua lại — không phải thu, không chia."
  - Tiền ra: Chi tiêu / Chuyển nội bộ / Cho vay ("Chi hộ người khác mà muốn nhớ ai còn nợ") / Mua tài sản.
- MODIFIED: banner vàng "Tiền vào luôn phải hỏi…" thêm câu "Không chắc chọn loại nào? Xem bảng chọn loại trong hướng dẫn."
- ADDED AC: mỗi loại có đúng một dòng giải thích; chữ của Hoàn tiền nói rõ trả hơn/kém vẫn ghi Hoàn tiền.

### Hướng dẫn (repo hướng dẫn GitBook)
- ADDED trang `ngan-hang/tien-vao-chon-loai.md` "Tiền vào: chọn loại nào?" — bảng chọn loại; mục "Mua hộ, trả hơn hoặc kém" (ví dụ 244.000 / 250.000 → Chi tiêu + Hoàn tiền cùng danh mục, thực chi −6.000); khi nào dùng Cho vay; "Gán, để chia sau". Dẫn tới từ Gán giao dịch, Loại khác và Lỗi thường gặp › Tiền vào luôn phải hỏi.

## Việc cần làm
- [x] Test cho từng AC mới/sửa (`test/logs.test.ts`, `web/src/lib/splits.test.ts`; nút / banner / dòng giải thích chưa có test giao diện — ghi ⚠ ở UC, đã xem tận mắt ở 390px và 1280px)
- [x] Code (snapshot thêm `oldestTxId` cạnh `count`, `amount` để **Chia** ở Hôm nay mở đúng khoản cũ nhất; bảng chữ chung `ASSIGN_CHOICES` chỉ dùng ở màn Gán — Loại khác có bộ loại khác)
- [x] Cập nhật UC chính + `## History` (pwa UC-702, UC-705, UC-706, UC-715; ledger UC-103; notify UC-405)
- [x] Sinh lại `traceability.md`, `open-issues.md`
