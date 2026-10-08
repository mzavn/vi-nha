# Anti-pattern và cách chữa

Tổng hợp từ ebook (tr.42, 59–60) và kinh nghiệm vận hành các repo dùng mk-specs. Dùng ở mode `audit` và khi review proposal/commit.

| Anti-pattern | Dấu hiệu | Cách chữa trong mk-specs |
|---|---|---|
| Spec viết sau code | Commit code có trước commit proposal; History thêm "cho đủ" | Ba commit: propose → code → merge; review nhìn timeline là thấy |
| Spec không có AC | UC chỉ có mô tả, không Given/When/Then | Không AC thì không code; AC phải test được |
| Spec quá chi tiết từ đầu | Proposal dài vài trang, chữ trên giao diện từng nút ngay vòng đầu | Time-box 1–2 giờ/UC; vòng đầu đủ Main Flow + vài AC; chi tiết kỹ thuật xuống "Thiết kế"/`## Traceability` |
| Spec đặc kỹ thuật | Main Flow/AC đầy endpoint, tên hàm, mã lỗi; người nghiệp vụ không đọc nổi | Ngôn ngữ nghiệp vụ ở flow/AC; kỹ thuật vào `- Kỹ thuật:` hoặc `## Traceability`; `audit.py` liệt kê |
| AI bỏ qua spec | Code có rule spec không nói (ngưỡng, hạn, quyền) | Trả lại: "rule này từ spec nào?" → sửa spec trước hoặc bỏ rule |
| AI đoán quyết định nghiệp vụ | Giá trị mặc định "hợp lý" tự chọn (thời hạn, phí, quyền) | Dừng, ghi `[OPEN]`, hỏi chủ sản phẩm; tiền/quyền/bảo mật luôn để người quyết |
| Tự viết, tự duyệt | Proposal không có người duyệt kỹ thuật, hoặc tác giả tự ký | Duyệt hai phía; reviewer agent khác tác giả; ghi tên + ngày |
| Test tự chứng minh code | Test sinh từ code vừa viết, mock lõi nghiệp vụ | Test từ AC, kiểm hành vi; test đầu tiên của một mẫu do người review kỹ |
| Spec coverage ảo | Nhiều file spec nhưng AC không có test | Đo AC Coverage + Spec Coverage; `⚠ Chưa có test` phải có lý do |
| Không có History | Không biết rule thêm từ khi nào, vì sao | Mỗi UC/BR có `## History`, dòng mang hash commit |
| Changelog trong README | README dài hàng chục dòng "Cập nhật…" | Tối đa 5 dòng banner; gen.py bỏ dòng cũ; lịch sử ở History + git |
| Sửa tay file sinh | `traceability.md` lệch UC | Chỉ sửa UC/ADR rồi chạy gen.py; check fail nếu link/test sai |
| Xoá AC, dùng lại ID | AC-3 biến mất rồi AC-3 mới mang nghĩa khác | ID vĩnh viễn; `(deprecated vN: lý do)` |
| Im lặng chọn một bên | Tài liệu nói X, code làm Y, spec chép theo code không ghi gì | `[DIVERGENCE]` + đưa vào hàng đợi quyết định |
| Spec từ code là sự thật | Brownfield: AI đọc code rồi ghi thành rule đã chốt | Ghi mức tin cậy rõ/đoán/bí ẩn; kiểm chứng với nghiệp vụ |
| Big-bang rewrite | Viết lại cả module bằng AI khi chưa có baseline | Characterization test → refactor có bảo vệ, từng phần |
| Refactor kèm đổi luật | Một thay đổi vừa dời cấu trúc vừa đổi rule | Tách hai thay đổi; refactor giữ nguyên AC |
| Commit không có ID | `feat: add thing` | `<type>(UC-xxx): …`; theo dõi Trace Ratio |
| Baseline sửa tuỳ tiện | Đang nghĩ feature mới thì sửa thẳng UC chính | Đề xuất ở `changes/`; chỉ merge khi làm xong và đã review |
| Khoá chặt vào tool | Spec nằm trong định dạng riêng của một tool | Markdown thuần trong git; scripts chỉ dùng Python chuẩn |
| Chọn tool mất hàng tuần | Bàn tool thay vì làm | Làm thử một UC từ đầu tới cuối rồi đánh giá (tr.41) |

## Câu hỏi review nhanh

1. Thay đổi này có proposal/mục spec không? Commit proposal có trước commit code không?
2. Mỗi AC mới/sửa có test không? Test kiểm hành vi hay chi tiết cài đặt?
3. Rule nào trong code không có trong spec?
4. Đoạn nào AI tự đề xuất, đoạn nào người quyết? Có luật tiền/quyền/bảo mật nào chưa có người duyệt?
5. Main Flow/AC mới có đọc được với người không biết code không?
6. History, ADR (phương án bị loại, Verified in code), open-issues đã cập nhật chưa? Còn `chưa commit` không?
