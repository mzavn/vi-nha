# 261012-tu-chia: Tự chia một khoản thu — gõ số cho từng ví thay cho bảng chia sẵn
- Status: archived
- BR: BR-02 (chia thu nhập)
- Đụng tới: allocation UC-202, UC-203 · pwa sheet Chia thử trước khi ghi (nhập thu nhập tay UC-706, màn Gán UC-705, chi tiết khoản thu UC-715)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-12, chat (quyết định trích dưới) · Người duyệt kỹ thuật: reviewer agent, 2026-10-12, approve with changes — đã sửa
- Commit: propose `25a96d9` · code `a8b43f7` · merge `—`

## Vì sao

Chủ nhà, 2026-10-12, về sheet **Chia thử trước khi ghi**: "khoản này buồn cười ở chỗ là tôi muốn tự chia được không? k cần template". Nhà chia lương mỗi tháng một khác (bảng tính riêng: tiền nhà, tập, ăn, điện nước, trả nợ, bảo dưỡng xe), không khớp bảng chia sẵn theo luật nạp. Về Tích sản: "nên cho custom tích sản là bao nhiêu theo triết lý profit-first, cho nhập 1 số tiền nhỏ nhỏ cũng được".

Hiện trạng (kiểm 2026-10-12): `POST /v1/allocate` chỉ chia theo luật nạp (`src/routes/v1.ts:202-205`, `src/services/ledger.ts` › `allocateIncome`); muốn khác phải chia rồi chuyển ngân sách từng ví.

Ngoài phạm vi (đã xử lý bằng dữ liệu, không cần code): tài khoản giữ tiền nhà mà đang là phao thì tiền chuyển vào bị tính thành Tích sản (ADR-88). Chủ nhà chọn đổi tài khoản đó thành tài khoản thường (2026-10-12), sổ tiết kiệm của vợ sẽ là một tài khoản riêng loại Sổ tiết kiệm.

## Thay đổi spec

### allocation UC-202 (xem trước) — ADDED
- Sheet Chia thử có nút **Tự chia** ở cả ba chỗ dùng sheet này: nhập thu nhập tay, màn Gán (khoản tiền vào là thu nhập), chi tiết khoản thu chưa chia. Bật lên: mỗi ví đang dùng (trừ ví giữ tiền: Thu nhập, Thu cho thuê) một ô số, điền sẵn số của bảng chia theo luật; ví không có trong bảng thì ô 0. **Tích sản đứng đầu** kèm câu "Profit First: để dành trước — nhỏ cũng được". Chân: "Đã chia X / Y" và "còn Z" hoặc "chia vượt Z" (đỏ). Tích sản 0 → câu nhắc "Tháng này chưa để dành Tích sản", vẫn cho ghi. Lệnh chuyển xem trước tính theo nơi ở của ví như chia theo luật (UC-204). Tắt Tự chia → về bảng chia theo luật.
- ADDED AC-6: Given khoản thu 19.000.000 When bật Tự chia, gõ Tích sản 200.000, Nhà ở 7.500.000, Tập luyện 1.500.000, Ăn uống 5.000.000, Điện nước 1.600.000, Trả nợ 2.700.000, Đi lại 500.000, các ví khác 0 Then chân "Đã chia 19.000.000 / 19.000.000"; nút **Chia và ghi sổ** bật; xem trước lệnh chuyển gộp theo tài khoản đích của ví.
- ADDED AC-7: Given Tự chia When tổng ≠ khoản thu Then nút tắt, chân nói còn / vượt bao nhiêu; ô số âm hay lẻ → lỗi ngay dưới ô; Tích sản 0 → câu nhắc, nút vẫn bật nếu tổng khớp.

### allocation UC-203 (ghi lần chia) — ADDED
- `POST /v1/allocate { income_tx_id, amounts: [{ wallet_id, amount }] }`: ghi đúng các số đó (mỗi số > 0 một dòng `fund` từ ví giữ tiền của khoản thu; số 0 bỏ qua), sinh lệnh chuyển như chia theo luật, cùng batch `A<id>`, cùng `allocation_runs` (một khoản thu chỉ chia một lần — 409 như cũ). Không gửi `amounts` → như hiện nay.
- Hợp đồng `amounts`: Σ phải bằng số tiền khoản thu → 400 `amounts_mismatch`; ví không có, đã tắt, ví giữ tiền (`holding`), trùng `wallet_id`, số âm / lẻ / không phải số nguyên → 400 `invalid_amounts`. Số tay **bỏ qua** luật nạp, phần khóa của nguồn thu (ADR-59) và sàn / bù thiếu: `underfunded`, `deficitCovered` trả rỗng. Khoản thu tính thuế mà Thuế nhỏ hơn luật: được, số đã trích thuế là Σ dòng `fund` vào ví Thuế như hiện nay. `POST /v1/allocate/preview` nhận cùng `amounts` (bỏ qua `income_stream_id`) để xem trước lệnh chuyển; cùng lỗi.
- Dùng được khi: khoản thu chưa chia. Lương đã tự chia theo rule (UC-203 0a) thì không tự chia lại được (409); muốn tự chia thì huỷ lần chia theo đường hiện có (UC-206) rồi chia lại.
- ADDED AC-11: Given khoản thu 19.000.000 chưa chia When `POST /v1/allocate` với `amounts` như UC-202 AC-6 Then 201; đúng 7 dòng `fund` có số như gửi; Tích sản +200.000; lệnh chuyển gộp theo tài khoản của ví; luật nạp không được dùng. `amounts` tổng 18.999.000 → 400 `amounts_mismatch`; ví Thu nhập trong `amounts` → 400 `invalid_amounts`; gọi lại → 409 `already_allocated`.
- ADDED AC-12: Given nguồn thu khóa 30% Tích sản When tự chia Tích sản 100.000 Then ghi đúng 100.000 (số tay thắng phần khóa).

## Quyết định
**ADR-108 (nháp) — Tự chia: số tay của người thắng luật nạp và phần khóa cho một lần chia.** Bối cảnh: lõi Profit First là Tích sản trích trước theo % (core rules §4, ADR-59). Chủ nhà chọn cho tự gõ cả Tích sản, nhỏ cũng được, để chia sát cách nhà thật sự chia mỗi tháng; app nhắc khi Tích sản 0 nhưng không chặn. Luật nạp vẫn là số điền sẵn. Loại: ép Tích sản tối thiểu theo % (chủ nhà không chọn); sửa luật nạp mỗi tháng (nặng, sai lịch sử).

## Thiết kế
- `src/domain/allocation.ts` (hoặc file thuần mới): `manualFunds(amounts, income, wallets)` kiểm hợp đồng → `funds` cùng hình dạng engine trả. `src/services/ledger.ts` › `previewAllocation`, `allocateIncome` nhận `amounts?`; `src/routes/v1.ts` đọc `amounts`.
- PWA: `web/src/screens/other-entry-sheet.tsx` › `AllocationPreview` thêm chế độ Tự chia (ô `AmountInput` mỗi ví); hàm thuần `web/src/lib/manual-split.ts` (điền sẵn, tổng, câu chân, payload) + test; ba chỗ gọi truyền `amounts` khi ghi.
- MCP `allocate_income` / `preview_allocation`: ngoài phạm vi lần này.
- Không migration.

## Review kỹ thuật
Reviewer agent (2026-10-12) — approve with changes cho bản đầu (gồm cả "tiền gửi nhờ ở phao"). Phần gửi nhờ đã bỏ khỏi change (chủ nhà đổi tài khoản thành tài khoản thường). Đã sửa cho phần Tự chia: nói rõ dùng được khi nào (chưa chia; lương đã tự chia thì huỷ lần chia theo UC-206), ba chỗ có sheet, hợp đồng `amounts` (0, trùng, ví tắt, ví giữ tiền, phần khóa nguồn thu, thuế, underfunded/deficit, preview bỏ nguồn thu), thêm ADR-108, MCP ngoài phạm vi.

## Việc cần làm
- [x] Review kỹ thuật; commit propose
- [x] Test đỏ → code: UC-202 AC-6, AC-7; UC-203 AC-11, AC-12
- [x] Deploy (2026-10-13 09:03 UTC, version `7a47bb15`; prod: preview với `amounts` trả 7 dòng fund + lệnh chuyển gộp theo tài khoản; tổng sai → 400 `amounts_mismatch`)
- [ ] Chủ nhà tự chia khoản lương tháng 10 trên live (chưa làm — chủ nhà tự làm)
- [x] Hợp nhất specs (+ ADR-108)
- [ ] GitBook (Tự chia)
