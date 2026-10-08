# UC-205: Theo dõi & đánh dấu lệnh chuyển tiền
- Status: implemented
- BR: BR-04, BR-06
- Decisions: "Phân bổ trong app là ảo cho tới khi tiền đi thật … log về tự khớp memo → `done`. Quá 3 ngày chưa chuyển → nhắc." (`docs/core_design_rules.md` §4); commits `b92fc0f`, `c3ab508` (trigger hoàn tất một lần); ADR-67 (audit 261001 F20: lệnh nói tiền đi cho ví nào)
- Actor: thành viên hộ (PWA: danh sách lệnh chờ ở màn Ví / Hôm nay desktop); Claude (MCP `list_transfer_orders`); ingest (tự đánh dấu `done` khi log khớp memo); notify (đọc số lệnh quá hạn)
- Trigger: `GET /v1/transfer-orders?status=`; `POST /v1/transfer-orders/:id/done`; `POST /v1/transfer-orders/:id/skip`; MCP `list_transfer_orders`; `getSnapshot` (số chờ/quá hạn)

## History
- v1 (2026-09-22, commit `b92fc0f`): liệt kê, đánh dấu done/skip (chỉ từ `pending`), đếm lệnh chờ & quá 3 ngày trong snapshot.
- v2 (2026-09-22, commit `c3ab508`): trigger `trg_transfer_order_settles_once` (migration 0005) — lệnh chỉ hoàn tất một lần, nhưng trả về `pending` được (khi ingest gỡ gán log đã khớp).
- v3 (2026-10-01, commit `11c52a0`): mỗi lệnh trong danh sách có thêm `wallet_names` — tên các ví nhận tiền của lệnh đó, để PWA ghi "cho Tích sản, Thuế" thay vì chỉ hai tên tài khoản (audit 261001 F20, ADR-67). Không đổi schema.

## Preconditions
- Đã xác thực (`/v1/*`).
- Lệnh sinh ra từ UC-203, UC-207 hoặc quyết toán thuế (ledger).

## Main Flow
1. Người dùng mở danh sách: `GET /v1/transfer-orders` (mặc định `status=pending`) → các dòng `transfer_orders` kèm `from_name`, `to_name` (tên TK) và `wallet_names`, sắp `created_at` giảm dần, tối đa 200 dòng. `wallet_names` = tên các ví (nối bằng ", ", theo `wallets.sort` rồi tên, không lặp) của giao dịch `active` có `meaning` ∈ {`fund`, `transfer`} cùng `batch_id` với lệnh **và** ví đang trú ở tài khoản đích (`wallets.account_id = to_account_id`) — tức các ví mà lệnh này mang tiền tới (fund của lần chia; chuyển của quyết toán thuế); không có thì `null`. PWA hiện thành dòng phụ "cho {wallet_names}" (pwa UC-707, UC-702); MCP `list_transfer_orders` trả cùng trường.
2. Người dùng chuyển tiền thật ở ngân hàng với nội dung = `memo`.
3. a) Người dùng bấm "Đã chuyển": `POST /:id/done` → `UPDATE … SET status='done' WHERE id=? AND status='pending'`; trả dòng lệnh sau cập nhật.
   b) Hoặc log ngân hàng mang memo về và ingest tự đánh dấu `done` + gắn `matched_log_id` (ingest, "khớp lệnh chuyển tiền qua mã PF").
4. Snapshot (Hôm nay / tin sáng / MCP `get_snapshot`) đếm `attention.transferOrdersPending` = số lệnh `pending` và `attention.transferOrdersOverdue` = số lệnh `pending` có `created_at < datetime('now','-3 days')`.

## Alternative Flows
- 1a. `status` ∈ {`done`,`skipped`,`all`} → lọc tương ứng (`all` = không lọc).
- 1b. MCP `list_transfer_orders`: luôn `status=pending`.
- 3c. Người dùng bấm "Bỏ qua": `POST /:id/skip` → `pending → skipped` (PWA hỏi xác nhận trước — `web/src/screens/wallets.tsx`).
- 3d. Ingest gỡ gán log đã khớp → lệnh `done → pending`, `matched_log_id = NULL` (ingest).
- 4a. Có lệnh quá hạn → tin sáng 07:00 thêm dòng "🔁 <n> chuyển tiền cần làm (quá 3 ngày)" (notify UC-402 "Tin sáng 07:00").

## Exceptions
- E1. `status` ngoài danh sách → 400 `invalid_status` "Trạng thái không hợp lệ.".
- E2. `:id` không phải số nguyên dương → 400 `invalid_input` "id không hợp lệ.".
- E3. Lệnh không tồn tại hoặc không còn `pending` → 404 `not_pending` "Không có lệnh đang chờ với id này.".
- E4. Ở DB, mọi UPDATE `status` từ `done`/`skipped` sang `done`/`skipped` bị ABORT `order_not_pending` (trigger migration 0005).

## Acceptance Criteria
### AC-1: Chỉ lệnh đang chờ mới đánh dấu được; đã xong thì không đổi sang xong/bỏ qua lần nữa, nhưng trả về chờ được
- Given lệnh `id=1` đã `done`
- When UPDATE sang `done` hoặc `skipped`
- Then lỗi `order_not_pending`; UPDATE về `pending` thành công
- Tests: `test/schema.test.ts` › "chốt chặn toàn vẹn ở tầng DB › lệnh chuyển tiền chỉ hoàn tất một lần, nhưng trả về chờ được"

### AC-2: Đánh dấu "Đã chuyển" qua API
- Given lệnh `pending` của một lần chia
- When `POST /v1/transfer-orders/:id/done`
- Then lệnh `done` (và từ đó lần chia không gỡ được — UC-206 AC-2)
- Tests: `test/api.test.ts` › "chia lương end-to-end › tiền của lần chia đã chuyển thật thì không huỷ khoản thu được"

### AC-3: Log ngân hàng mang memo tự hoàn tất lệnh
- Given lệnh `PF K7Q3F2` `pending`
- When log `out` 1.200.000 nội dung "PF K7Q3F2 chia luong" về
- Then lệnh `done`, `matched_log_id` = log; một giao dịch `transfer` đúng hai tài khoản
- Tests: `test/ingest.test.ts` › "ingestLog: khớp lệnh chuyển tiền qua nội dung 'PF <mã lệnh>' › chân đầu tiên về khớp ngay: lệnh chuyển thành done, sinh transfer đúng account" (ingest sở hữu luồng khớp)

### AC-4: Nhắc lệnh quá 3 ngày
- Given một lệnh `pending` tạo lúc `2000-01-01 00:00:00`
- When cron 07:00 chạy
- Then tin có dòng "🔁 1 chuyển tiền cần làm (quá 3 ngày)"
- Tests: `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › lệnh chuyển tiền quá hạn 3 ngày"; định dạng: `test/format.test.ts` › "dailyMessage › đủ mọi mục: dòng 💰, rồi việc cần làm, rồi thông tin; đúng câu chữ"

### AC-5: Bỏ qua một lệnh và lọc danh sách
- Given lệnh `pending`
- When `POST /:id/skip` rồi `GET /v1/transfer-orders?status=skipped`
- Then lệnh nằm trong danh sách `skipped`, không còn trong `pending`; gọi `/skip` lần nữa → 404 `not_pending`
- Tests: ⚠ Chưa có test

### AC-6: Danh sách lệnh nói tiền đi cho ví nào
- Given chia lương 40.000.000 sinh lệnh VCB → TCB 12.000.000 (phần Tích sản, ví trú ở TCB)
- When `GET /v1/transfer-orders?status=pending`
- Then lệnh đến `tcb-husband` có `from_name`, `to_name`, `amount: 12000000` và `wallet_names: "Tích sản"`
- Tests: `test/api.test.ts` › "chia lương end-to-end › lệnh chuyển tiền nói tiền đi cho ví nào: danh sách kèm tên các ví nhận trong lô ở tài khoản đích"

## Traceability
- Code: `src/routes/v1.ts` › `v1.get("/transfer-orders")`, `v1.post("/transfer-orders/:id/done")`, `v1.post("/transfer-orders/:id/skip")`, `idParam`; `src/services/ledger.ts` › `listTransferOrders` (subquery `wallet_names`), `setTransferOrderStatus`, `getSnapshot` (truy vấn `pending`/`overdue`); `src/domain/snapshot.ts` › `buildSnapshot` (`attention.transferOrdersPending`, `attention.transferOrdersOverdue`); `src/notify/format.ts` › `dailyMessage`; `src/mcp/tools.ts` › tool `list_transfer_orders`; `web/src/lib/types.ts` › `TransferOrder.wallet_names`
- Migrations/DB: `transfer_orders` (`migrations/0001_schema.sql`), trigger `trg_transfer_order_settles_once` (`migrations/0005_ingest_integrity_guards.sql`)

## Divergences & Open Questions
- [OPEN] Không có đường nào đưa lệnh đã `done` **bằng tay** về `pending` (API chỉ đi từ `pending`; ingest chỉ trả về `pending` các lệnh có `matched_log_id` của log bị gỡ). Hệ quả với UC-206: bấm nhầm "Đã chuyển" thì khoản thu của đợt đó không bao giờ huỷ được, dù thông điệp lỗi bảo "gỡ lệnh chuyển tiền trước".
- [OPEN] "Quá 3 ngày" so `created_at` (UTC, `datetime('now')`) với `datetime('now','-3 days')` — tính theo 72 giờ tuyệt đối, không theo ngày lịch VN.
- [OPEN] Danh sách giới hạn cứng 200 dòng, không phân trang.
- [OPEN] `wallet_names` lấy ví theo **tài khoản hiện tại** của ví (`wallets.account_id`), không theo tài khoản lúc chia: đổi tài khoản chứa ví sau khi chia thì lệnh cũ có thể hiện sai ví hoặc `null`. Lệnh của nhiều lần chia cùng hai tài khoản vẫn tách đúng vì lọc theo `batch_id`.
