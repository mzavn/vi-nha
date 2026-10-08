# <yyMMdd>-<slug>: <Tên thay đổi>
- Status: draft
- BR: BR-YY
- Đụng tới: UC-XXX (<context>), UC-ZZZ (<context>)
- Đóng: <[DIVERGENCE]/[OPEN] nào trong open-issues.md, hoặc —>
- Người duyệt nghiệp vụ: <tên, ngày, kênh — hoặc "chờ"> · Người duyệt kỹ thuật: <reviewer, ngày, kết luận — hoặc "chờ">
- Commit: propose `—` · code `—` · merge `—`

## Vì sao
<Vấn đề thật: sự cố, số liệu, phản hồi. Trích nguyên lời người yêu cầu trong khối trích dẫn. Chưa nói giải pháp.>

> "<nguyên văn>"

## Thay đổi spec
### UC-XXX
- ADDED AC-n: Given … When … Then …
- MODIFIED AC-m: <cũ> → <mới>
- DEPRECATED AC-k: <lý do>
- Main Flow / Alternative Flows / Exceptions: <đoạn đổi, ngôn ngữ nghiệp vụ>

### Entity
- <Entity>.<thuộc tính>: <nghĩa, rule đặt giá trị, thời điểm, có đổi về sau không, BR nguồn>

## Quyết định
<ADR nháp nếu có lựa chọn đáng ghi: bối cảnh, quyết định, phương án bị loại (và vì sao), hệ quả. Khi hợp nhất lấy ID kế tiếp.>

## Thiết kế
<File/symbol sẽ đổi, migration (sao lưu dữ liệu thật trước), rủi ro, phần AI làm / phần người quyết.>

## Review kỹ thuật
<Tóm tắt nhận xét của người duyệt kỹ thuật (người hoặc reviewer agent) và cách đã xử lý từng ý.>

## Việc cần làm
- [ ] Test cho từng AC mới/sửa (đỏ trước khi code)
- [ ] Code
- [ ] Hợp nhất: UC chính + `## History` (hash commit code), ADR vào decisions.md
- [ ] Sinh lại + kiểm (gen, verify xanh); chuyển thư mục sang `changes/archive/`
