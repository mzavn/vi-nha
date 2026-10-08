# 261006-so-giao-dich: Màn Sổ giao dịch đầy đủ (xem lại theo tháng, lọc, sửa, ghi thêm)
- Status: implemented (2026-10-06, code + test xanh, commit `43e4699`; hợp nhất vào `specs/` cùng ngày) — duyệt: chủ nhà "ok", 2026-10-06
- BR: BR-01, BR-03 (sổ chỉ ghi thêm), BR-05
- Đụng tới: ledger UC-111 (`GET /v1/transactions` thêm bộ lọc + tổng); pwa UC-702, UC-703 (card Giao dịch gần đây dẫn sang màn mới), UC-715 (sheet chi tiết — dùng lại), UC-711 (điều hướng); pwa UC mới **UC-716 Sổ giao dịch**
- Người duyệt nghiệp vụ: chủ nhà

## Vì sao
Chủ nhà 2026-10-06, chỉ vào card "Giao dịch gần đây": "hình như bạn làm thiếu của tôi một màn chi tiết các record đã ghi đúng không? Nhấn từ chỗ này ra thì mở ra full màn đó cho tôi. Mục tiêu là tôi xem lại lịch sử các khoản chi của các tháng, có thể chỉnh sửa / thay thế, ghi chép thêm ở đó nếu cần."

Hiện tại: card chỉ có trang trước/sau theo thời gian, không chọn được tháng, không lọc theo loại/danh mục/ví/tài khoản/người, không có tổng; muốn xem chi tháng 9 thì phải bấm "Trang sau" nhiều lần.

## Thay đổi spec
### pwa UC-716 (mới): Sổ giao dịch
- Mở từ: tiêu đề card **Giao dịch gần đây** thành link **"Xem tất cả ›"** (Hôm nay máy tính, màn Nhập điện thoại); Ví & quỹ › Ngân sách: chạm một ví/danh mục → Sổ giao dịch lọc sẵn ví đó, tháng đó; hash `#so` (mở thẳng được, có trong thanh bên máy tính).
- Đầu màn: **Tháng** (‹ tháng 10/2026 ›, mặc định tháng hiện tại; chọn "Tất cả" được) · ô **Tìm** (ghi chú, nội dung ngân hàng, tên danh mục/người) · nút **Lọc** mở sheet: Loại (Chi tiêu, Thu nhập, Hoàn tiền, Chuyển nội bộ, Cho vay, Nhận lại, Mua tài sản, Điều chỉnh), Danh mục, Ví, Tài khoản, Người ghi, Nguồn (Ghi tay / Ngân hàng), Hiện khoản đã xoá. Bộ lọc đang bật hiện thành chip, chạm × để bỏ.
- **Dòng tổng** theo bộ lọc, theo đúng nghĩa tiền thật: **Chi** (chi tiêu − hoàn tiền), **Thu** (thu nhập), **Cho vay / nhận lại**, **Chuyển nội bộ** (không cộng vào thu chi) — số giao dịch.
- Danh sách nhóm theo ngày ("Thứ Hai 5/10 · chi 312.000"), mỗi dòng như card hiện tại; chạm → sheet chi tiết UC-715 (Sửa / Xoá / Gán lại / Chia, liên kết hai chiều) — không làm sheet mới.
- Cuộn tải thêm (50 dòng một lần, con trỏ `before` như UC-111), giữ bộ lọc và vị trí khi đóng sheet.
- **Ghi thêm**: nút **+ Ghi khoản** ở đầu màn mở màn Nhập (điện thoại) / sheet Nhập (máy tính); ghi với ngày trong tháng đang xem nếu tháng đó không phải tháng hiện tại (ngày mặc định = ngày cuối tháng đó, đổi được) — dùng `atForDay` sẵn có. Sau khi ghi/sửa/xoá: danh sách và tổng tải lại.
- Điện thoại 390px: một cột, đầu màn dính khi cuộn; máy tính: bảng cột Ngày · Khoản · Danh mục/Ví · Tài khoản · Người · Số tiền.
- AC: lọc tháng 9 + Chi tiêu + danh mục Thuốc thang → đúng các khoản, tổng chi đúng; tìm "shopee" ra khoản có ghi chú / nội dung chứa chữ đó; khoản đã xoá chỉ hiện khi bật; sửa một khoản từ sổ → danh sách và tổng cập nhật, khoản cũ thành "đã xoá" (ẩn mặc định); ghi thêm khi đang xem tháng 9 → ngày mặc định 30/9.

### ledger UC-111: `GET /v1/transactions` thêm lọc và tổng
- Tham số tuỳ chọn: `month=YYYY-MM` (theo `month_key`), `meaning` (nhiều, phẩy), `category_id`, `wallet_id` (khớp `wallet_id` hoặc `counter_wallet_id`), `account_id` (khớp `account_id` hoặc `counter_account_id`), `member_id` (`by_member_id`), `source=manual|bank`, `q` (LIKE trên note, nội dung log, tên danh mục, tên người phải thu/nợ/người thuê; tối thiểu 2 ký tự), giữ `limit`, `before`, `include_void`. Sai định dạng → `invalid_input`.
- `GET /v1/transactions/summary` cùng bộ lọc (không `limit/before`) → `{ count, spend, refund, income, lend, collect, transfer, buy_asset, adjust_in, adjust_out }` — một truy vấn GROUP BY. Ví riêng tư của người kia: dòng hiện như sổ hiện nay (ADR D6 — [OPEN] UC-111 giữ nguyên).
- Index: `transactions(month_key, at)` nếu truy vấn tháng cần (đo trên dữ liệu thật trước khi thêm; migration chỉ khi cần).

## Quyết định
Không cần ADR: dùng lại sổ giao dịch (UC-111), sheet chi tiết (UC-715), luật sửa = huỷ + ghi mới (ADR-73). Phương án bị loại: mở rộng card Giao dịch gần đây thành có bộ lọc (card chật trên Hôm nay, lẫn vai trò "liếc nhanh" với "tra sổ"); xuất CSV (chưa ai cần; làm sau nếu có).

## Thiết kế
- Server: `src/services/ledger.ts` `listTransactions(filter)` + `transactionSummary(filter)`, một hàm dựng WHERE dùng chung; `src/routes/v1.ts` parse/validate tham số.
- PWA: `web/src/screens/ledger-book.tsx` (màn mới), `web/src/lib/tx-filter.ts` (bộ lọc ↔ query string ↔ chip, thuần + test), route `#so` trong `web/src/app.tsx`, link từ `RecentTransactions` và Ngân sách.
- Rủi ro: truy vấn `q` LIKE trên vài nghìn dòng — chấp nhận ở quy mô hộ; giới hạn 50 dòng/lần.

## Việc cần làm
- [x] Test cho từng AC mới/sửa (`test/api.test.ts` › "lọc và tổng (change 261006-so-giao-dich)", `web/src/lib/tx-filter.test.ts`; luồng chạm trên màn — sửa / xoá / ghi thêm / mở từ Ngân sách — chưa có test giao diện, ghi ⚠ ở UC-716, đã chạy tay trên `wrangler dev` cục bộ ở 390px và 1280px, sáng / tối)
- [x] Code — `txWhere` dùng chung cho `listTransactions` và `transactionSummary` (một GROUP BY), `txFilter` kiểm mọi tham số ở route; màn `web/src/screens/ledger-book.tsx` + `web/src/lib/tx-filter.ts`; route `#so` (thanh bên máy tính, không FAB, không tab thứ năm); "Xem tất cả ›" ở `RecentTransactions`; tên ví ở Ngân sách mở sổ lọc ví đó; màn Nhập nhận ngày điền sẵn (`entryPreset`) và quay về sổ. Index: đo `EXPLAIN QUERY PLAN` trên 6.000 khoản — lọc tháng đi qua `idx_tx_cat`, < 1 ms; không migration. Máy tính không có "sheet Nhập": "+ Ghi khoản" mở màn Nhập ([DIVERGENCE] ở UC-716).
- [x] Cập nhật UC chính + `## History` (pwa UC-716 mới, UC-702, UC-703, UC-707, UC-711, UC-715; ledger UC-111 AC-10…AC-14); `docs/DESIGN.md` §4, §7b
- [x] Sinh lại `traceability.md`, `open-issues.md`
