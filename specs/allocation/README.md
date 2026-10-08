# Bounded context: allocation — Chia tiền

Biến một khoản `income` đã xác nhận thành các bút toán `fund` (nạp ví) theo thứ tự ưu tiên Profit First (D1), chia ngay từng khoản (D2),
bù ví tiêu lố tháng trước và quét dư phong bì chung cuối tháng (D3), đổi phong bì tuần sang nhu cầu tháng theo số thứ Hai (D7).
Vì phân bổ trong app là ảo cho tới khi tiền đi thật, context này cũng sinh và theo dõi **lệnh chuyển tiền** (`transfer_orders`),
và gỡ một lần chia khi khoản thu bị huỷ. Engine (`src/domain/allocation.ts`) là hàm thuần, test không cần D1 (BR-10).

## Ngôn ngữ chung

| Thuật ngữ | Nghĩa trong context này |
|---|---|
| Lần chia (allocation run) | Một lần áp engine cho **một** `income`; khoá bởi `allocation_runs.income_tx_id`, mã đợt `batch_id = A<income_tx_id>` |
| Luật nạp (`WalletRule`) | Một dòng `allocations` đang active ghép với ví active của nó: `mode`, `period`, `amount`, `percent`, `target_amount`, `target_date`, `floor_amount`, `priority`, `splitWeekly` (chỉ cho dự kiến tuần ở ledger, không đổi nhu cầu) |
| Nguồn thu (`IncomeStream`) | Nguồn của một khoản thu (lương chồng, lương vợ, cho thuê…), gắn trên `transactions.income_stream_id`; quyết định phần khóa của lần chia (ADR-59). Không gắn nguồn = luật % chung như cũ |
| Phần khóa | Phần tính trên **chính số tiền khoản thu**, không phụ thuộc nhu cầu, rót trước dòng thác. Không có nguồn: phần trăm Tích sản và Thuế (Thuế chỉ khi `taxable`). Có nguồn: **phần khóa theo nguồn** = các `IncomeStreamLock` của nguồn (không trích Thuế); tổng 100% thì không chạy dòng thác |
| Pool | Số tiền còn lại để rót sau từng bước; không bao giờ âm |
| Nhu cầu tháng (`monthlyNeed`) | Số một ví cần trong tháng của khoản thu, chưa trừ phần đã nạp, chưa cộng hố |
| Sàn (`floorOf`) | `min(floor_amount × hệ số kỳ, nhu cầu tháng)` — vạch báo động, **khác** "sàn" trong ngôn ngữ thường là "không bóp xuống dưới": engine vẫn rót dưới sàn nếu thiếu tiền, chỉ gắn cờ |
| Hố (deficit) | `max(0, −số dư đầu tháng)` của ví **phong bì**; ví khác luôn 0 |
| Còn thiếu (`stillNeeded`) | `max(0, nhu cầu + hố − đã nạp trong tháng)` |
| `underfunded` | Danh sách ví nhóm Must nhận chưa tới sàn (tính cả phần đã nạp trước trong tháng) |
| `deficitCovered` / "đã bù X" | Phần hố mà **chính lần chia này** lấp, theo ví |
| Chốt tháng (sweep) | Chuyển số dư dương của phong bì chung (phe `must`/`nice`) sang Tích sản, `batch_id = S<YYYYMM>` |
| Lệnh chuyển tiền (transfer order) | Việc người trong nhà phải làm ở ngân hàng thật; nội dung `PF` + 6 ký tự ngẫu nhiên |
| `fund` | ⚠ Ở ledger là một `meaning` bất kỳ của sổ; ở đây chỉ bút toán hệ thống sinh ra từ lần chia (`source='system'`, `batch_id=A…`) |
| `batch_id` | ⚠ Dùng chung cột cho nhiều loại đợt: `A<id>` (chia), `S<YYYYMM>` (chốt tháng), `T<năm>` (quyết toán thuế, thuộc ledger) |

## Use cases

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-201](UC-201-tinh-phuong-an-chia.md) | Tính phương án chia một khoản thu (engine) | implemented | BR-02, BR-07, BR-10 |
| [UC-202](UC-202-xem-truoc-phuong-an-chia.md) | Xem trước phương án chia | implemented | BR-02, BR-05 |
| [UC-203](UC-203-chia-mot-khoan-thu-nhap.md) | Chia một khoản thu nhập (ghi sổ) | implemented | BR-02, BR-04 |
| [UC-204](UC-204-sinh-lenh-chuyen-tien.md) | Sinh lệnh chuyển tiền | implemented | BR-02, BR-04, BR-09 |
| [UC-205](UC-205-theo-doi-lenh-chuyen-tien.md) | Theo dõi & đánh dấu lệnh chuyển tiền | implemented | BR-04, BR-06 |
| [UC-206](UC-206-go-lan-chia-khi-huy-khoan-thu.md) | Gỡ lần chia khi huỷ khoản thu | implemented | BR-04, BR-09 |
| [UC-207](UC-207-chot-thang-quet-du.md) | Chốt tháng: quét dư phong bì chung sang Tích sản | implemented | BR-02, BR-07 |

Entity model: [entities.md](entities.md).

## Code thuộc context này
- `src/domain/allocation.ts` (engine), `src/domain/close.ts`, `src/domain/transfer-orders.ts`
- `src/services/ledger.ts`: `allocationContext`, `previewAllocation`, `allocateIncome`, `undoAllocationStatements`, `runUndo`, `salaryMinAmount`, `closeMonth`, `listTransferOrders`, `setTransferOrderStatus`
- `src/routes/v1.ts`: `POST /v1/allocate/preview`, `POST /v1/allocate`, `GET /v1/transfer-orders`, `POST /v1/transfer-orders/:id/done`, `POST /v1/transfer-orders/:id/skip`
- `migrations/0003_offline_entry_and_allocation_runs.sql` (bảng `allocation_runs`), `migrations/0006_allocation_undo_guard.sql`; bảng `allocations`, `transfer_orders` ở `migrations/0001_schema.sql`; `income_streams`, `income_stream_locks`, `allocations.split_weekly` ở `migrations/0007_income_streams_rental.sql`
- Test: `test/allocation.test.ts` (gồm khối `chia theo nguồn thu`), khối `chia lương end-to-end` và `nguồn thu, ví giữ riêng, chuyển ngân sách` trong `test/api.test.ts`

Dùng chung, không sở hữu: `src/domain/period.ts` (`mondaysInMonth`, `monthsLeft`, `monthKey`), `insertTx`/`getTransaction`/`loadRefs` (ledger).
