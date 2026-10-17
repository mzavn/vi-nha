# 261017-webhook-truoc-moc: Giao dịch SePay báo trễ mang giờ trước mốc — nối vào khoản đã nhập tay, không ghi hai lần
- Status: archived
- BR: BR-01 (một giao dịch ngân hàng vào sổ một lần), BR-04
- Đụng tới: ingest UC-302 (ghi log), UC-305 (Gán) · ledger UC-101 (nhập tay), UC-102 (sửa) · ingest UC-303, UC-305, UC-306 · access UC-506 (đóng [OPEN] webhook trễ)
- Đóng: [OPEN] "Webhook về trễ mang giờ trước mốc luôn được nhận (ADR-113), mà khoản trước mốc lại nhập tay được…" (`specs/access/UC-506-…`, `open-issues.md`)
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-17, chat ("xử lí luôn nó kiểu trước giờ kết nối luôn nhé, fix triệt để") — sửa lỗi, không đổi luật tiền · Người duyệt kỹ thuật: reviewer agent, 2026-10-17, request changes → đã sửa
- Commit: propose `649642e` · code `e207802` · merge `—`

## Vì sao
ADR-113: log webhook không bao giờ bị bỏ vì mốc (bỏ là mất tiền nếu chưa ai ghi). Nhưng khoản trước mốc nhập tay được. Nên khi webhook về trễ mang giờ trước mốc (giao dịch 22:20, bật SePay 22:24, webhook 22:25) và người nhà đã / sẽ nhập tay khoản đó, gán log là ghi hai lần, đối soát không thấy (khoản tay trước mốc tính vào phần "trước mốc" của số theo ngân hàng).

## Thay đổi spec
Gọi **log trước mốc** = log `source='webhook'` của tài khoản A có mốc, `at < feed_from` (tiền ra: hoặc `at < sepay_out_from`). **Khoản tay khớp** = giao dịch active `source='manual'`, `meaning <> 'adjust'`, chưa mang log của A; tiền vào A: `counter_account_id = A` (thu, hoàn, thu nợ, chuyển đến); tiền ra A: `account_id = A` (chi, cho vay, chuyển đi, mua tài sản); tổng tiền giao dịch = `amount` của log; ngày VN của giao dịch lệch ≤ 1 ngày với log.

Nối log vào giao dịch: tiền ra A → `log_id`; tiền vào A → `log_id_2` nếu giao dịch là chuyển khoản (chân nhận), ngược lại `log_id`. Log `assigned`. Không tạo giao dịch, không đổi ví / hạng mục / ghi chú.

### ingest UC-302 / UC-303 — MODIFIED
- Log trước mốc về (webhook): **trước** ghép cặp chuyển khoản nội bộ và rule tự gán, tìm khoản tay khớp có `at < mốc`: đúng một (nhiều thì lệch giờ nhỏ nhất; hoà → không nối) → nối, báo "SePay báo khoản … — đã có trong sổ (nhập tay), đã nối". Không có → như cũ.
- ADDED UC-302 AC-13: mốc 15/10 22:24, khoản tay "thu 500.000" 15/10 22:20 → webhook vào 500.000 `at` 22:20 về 22:25 → log `assigned` vào khoản tay, số giao dịch không đổi, `book_drift` 0; không có khoản tay → `pending`; khoản tay là chuyển B→A và log B đang `pending` → vẫn nối vào khoản tay, không ghép cặp tạo giao dịch mới.

### ingest UC-305 / UC-306 — MODIFIED (Gán: nối vào khoản đã ghi)
- Màn Gán, log `pending` bất kỳ (không riêng trước mốc): danh sách "Đã nhập tay?" liệt kê khoản tay khớp (định nghĩa trên, bỏ điều kiện mốc) → bấm **Nối** = nối log vào giao dịch đó. `POST /v1/logs/:id/link { transaction_id }`; sai điều kiện → 409 `link_mismatch`. Khoản tay tách thành nhiều giao dịch (vd 500.000 + 300.000 cho log 800.000): không nối được, dùng **Bỏ qua** (giải thích trong sheet).
- Gỡ gán một giao dịch `source='manual'` đã nối log: chỉ gỡ log khỏi giao dịch (log về `pending`), **không huỷ** giao dịch.
- ADDED UC-305 AC: log pending 500.000, khoản tay khớp → hiện trong "Đã nhập tay?"; Nối → log `assigned`, giao dịch giữ nguyên ví/hạng mục; gỡ gán → giao dịch còn active, log `pending`.

### ledger UC-101 — MODIFIED
- Nhập tay khoản trước mốc của A, có log trước mốc khớp (cùng định nghĩa, ngược chiều tìm):
  - log `pending` → nối luôn log vào khoản vừa ghi.
  - log `assigned` → 409 `bank_log_exists` "SePay đã báo khoản này và đã có trong sổ — ghi nữa là hai lần." Gửi lại `confirm_duplicate: true` thì ghi (hai khoản cùng số tiền thật). PWA hiện hộp xác nhận "Vẫn ghi"; MCP `create_transaction` nhận `confirm_duplicate`.
- ADDED UC-101 AC-26: log trước mốc `pending` 500.000 → nhập tay khoản đó → log nối vào khoản tay, Gán trống; log đã gán → 409; `confirm_duplicate` → 201.

### Migration 0037 (schema v1.37)
- Trigger `BEFORE UPDATE OF log_id ON transactions`: log mới phải đang `pending` (như `trg_tx_second_leg_needs_pending_log`). Không đổi dữ liệu.

## Quyết định
Mở rộng ADR-113 (không ADR mới): log webhook trước mốc không bỏ, mà khớp với khoản tay trước mốc theo số tiền + chiều + ngày; trùng mơ hồ thì để người chọn. Loại: bỏ hẳn log webhook trước mốc (mất tiền khi chưa ai ghi); cấm nhập tay trước mốc (mất cách ghi bù).

## Review kỹ thuật
Reviewer agent 2026-10-17 — bản đầu chưa duyệt; đã sửa: cột chiều tiền vào (`counter_account_id`), bỏ `adjust`, chỉ `manual`; nối khoản tay chạy trước ghép cặp / rule; gỡ gán khoản tay không huỷ giao dịch; trigger `log_id`; số AC; Gán có Nối vào khoản đã ghi (tách dòng → Bỏ qua); chi tiết `confirm_duplicate` PWA + MCP.

## Việc cần làm
- [x] Review kỹ thuật; commit propose
- [x] Test đỏ → code
- [x] Sao lưu D1 (`before-0037`), diễn tập 0037 trên bản sao (v1.37, integrity ok), deploy prod 2026-10-17 ~17:18 giờ VN (version `d4b0ce71`); kiểm live: health v1.37, ba tài khoản SePay lệch 0, màn Gán trống
- [x] Hợp nhất specs (+ bổ sung ADR-113)
- [x] CHANGELOG; phát hành v1.5.0; GitBook (28accb1)
