# UC-XXX: <Tên use case theo ngôn ngữ nghiệp vụ>
- Status: draft
- BR: BR-YY
- Owner: <người chịu trách nhiệm nghiệp vụ>
- Decisions: ADR-NN (<một dòng: vì sao>)
- Actor: <ai khởi tạo: người dùng, quản trị, job định kỳ, webhook, CS…>
- Trigger: <khi nào bắt đầu: bấm nút, webhook tới, lịch chạy…>

## History
- v1 (YYYY-MM-DD, chưa commit): khởi tạo

## Preconditions
- <điều phải đúng trước khi chạy>

## Main Flow
1. <bước — ngôn ngữ nghiệp vụ, người đọc không cần biết code>
2. <bước>
   - Kỹ thuật: <tuỳ chọn — endpoint, symbol, mã lỗi cho dev>

## Alternative Flows
- 2a. <biến thể hợp lệ, đánh số theo bước gốc>

## Exceptions
- E1. <tình huống lỗi đã có quyết định xử lý> → <hệ thống làm gì, người dùng thấy gì>

## Postconditions
- <trạng thái hệ thống sau khi thành công> (tuỳ chọn)

## Acceptance Criteria

### AC-1: <tên ngắn>
- Given <dữ liệu cụ thể: số tiền, ngày, trạng thái>
- When <hành động>
- Then <kết quả đo được>; <hệ quả phủ định nếu có: KHÔNG tạo …>
- Tests: [`path/to/file.test.ts`](../../path/to/file.test.ts) › "describe › it"

### AC-2: <tên ngắn>
- Given …
- When …
- Then …
- Tests: ⚠ Chưa có test (<lý do, khi nào bổ sung>)

## Dependencies
- Upstream UC: <UC phải có trước> (tuỳ chọn)
- Downstream UC: <UC phụ thuộc UC này>
- External Systems: <cổng thanh toán, email, …>

## Divergences & Open Questions
- [OPEN] <câu hỏi chưa có câu trả lời — ai cần trả lời>
- [DIVERGENCE] <tài liệu nói X, code làm Y — chưa quyết bên nào đúng>

## Traceability
- Code: `src/...` › `symbol`
- API / sự kiện: `POST /...` (lỗi `...`)
- Dữ liệu: migration `...`, bảng `...`
