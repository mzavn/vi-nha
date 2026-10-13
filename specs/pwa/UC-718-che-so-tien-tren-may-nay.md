# UC-718: Che số tiền trên máy này
- Status: implemented
- BR: BR-09, BR-01
- Decisions: ADR-110 (che số ở chỗ định dạng tiền, theo từng máy; PIN cục bộ); D6 / access UC-504 là chuyện khác ("ví riêng tư" ẩn số với người khác ở server — đây chỉ che mắt trên một máy)
- Actor: người đang dùng app trên một máy (điện thoại hoặc máy tính)
- Trigger: bấm nút **con mắt** ở thanh tiêu đề mọi màn (điện thoại) hoặc chân thanh bên (máy tính); mở app (đọc lựa chọn đã lưu)

## History
- v1 (2026-10-13, commit `f7cf796`): khởi tạo — chủ nhà: "ẩn số ****, chỉ hiện %"; chọn nút con mắt theo từng máy, ô nhập vẫn hiện số. Lệch đề bài: ghi chú giao dịch có "X ₫" (vd ghi chú đối soát server tự ghi) cũng bị che; "≈ … tỷ ₫" khi che bỏ cả chữ "tỷ"; ô Dự phóng điền sẵn từ số thật vẫn hiện số (là ô nhập) (change [261013-an-so-va-ma-pin](../changes/archive/261013-an-so-va-ma-pin/proposal.md))

## Preconditions
- Đã vào app (`phase = app`). Không cần mạng.

## Main Flow
1. Bấm con mắt (nhãn đọc màn hình "Che số tiền") → bật che: lưu `localStorage` `vi-nha:hide-amounts` của máy này, xoá các câu đang hiện có số (toast, dòng "vừa ghi"), vẽ lại cả app.
2. Đang che, mọi **số tiền hiển thị** ra `••••` — giữ "₫", giữ dấu −/+ và màu đỏ / xanh: số dư, tổng, hero Hôm nay, dòng giao dịch, gợi ý từ sổ trong sheet ("Ví này còn X", "còn nợ X"), câu chữ có số tiền ("≈ 7,01 tỷ ₫" → "≈ •••• ₫", bỏ cả chữ "tỷ" để không lộ cỡ số), "Đã chia X / Y" của Tự chia, và các cụm "số ₫" trong **ghi chú giao dịch** (vd "Đối soát số dư: sổ X ₫, thật Y ₫" do server ghi) ở Sổ giao dịch, bảng Hôm nay máy tính, sheet chi tiết, tab Tích sản. Số đang che đọc màn hình là "đã che số tiền".
3. **Không che**: phần trăm, số ngày / tháng / năm, số đếm ("12 giao dịch"), số lượng (chỉ, cổ phiếu), độ dài thanh tiến độ, số không kèm ₫ trong ghi chú, và **số người đang gõ** — ô nhập, dòng "= X ₫" dưới ô, nút "Lưu / Ghi / Chuyển X ₫", nút cộng nhanh; cả các ô điền sẵn từ số thật (vd ô Giả định của Thử số — pwa UC-717).
4. Bấm lại con mắt ("Hiện số tiền") → tắt che, lưu, về số thật.
5. Mở app / tải lại: đọc `vi-nha:hide-amounts` lúc khởi động (như giao diện sáng / tối) trước khi vẽ số.

## Alternative Flows
- 2a. Toast sau khi lưu lúc đang che: câu không có số tiền thật ("Đã ghi •••• ₫. Ăn uống còn •••• ₫ tuần này.").
- 5a. Máy khác không bị ảnh hưởng: lựa chọn không gửi server.

## Exceptions
- E1. `localStorage` không dùng được → che chỉ có hiệu lực trong lần mở này, không nhớ.

## Postconditions
- Không đổi dữ liệu nào ở server; không ảnh hưởng thông báo đẩy, Telegram / Zalo, câu lỗi do server trả, MCP (ngoài phạm vi — che số là che mắt, không phải bảo mật).

## Acceptance Criteria

### AC-1: Bật che thì số tiền thành ••••, số khác giữ nguyên
- Given chưa che
- When bật che; rồi tắt
- Then `formatVnd(1500000)`, `formatSigned`, số tiền không ₫, `Money` ra `•••• ₫` (giữ dấu, giữ ₫); `groupDigits`, số đếm, số lượng, phần trăm, chữ trong ô nhập không đổi; "≈ 7,01 tỷ ₫", "Đã chia / còn" bị che; ghi chú có "X ₫" bị che, số không kèm ₫ giữ; tắt → số thật
- Tests: [`web/src/lib/money.test.ts`](../../web/src/lib/money.test.ts) › "che số tiền trên máy này (pwa UC-718) › UC-718 AC-1: bật che → formatVnd, formatSigned, số tiền không ₫ ra •••• (giữ dấu, giữ ₫); tắt che → về số thật" · "… › UC-718 AC-1: đang che — groupDigits, số đếm, số lượng, phần trăm, chữ trong ô nhập không đổi" · "… › UC-718 AC-1: chỗ tự ghép số tiền cũng bị che — \"≈ 7,01 tỷ ₫\", đã chia / còn" · "… › UC-718 AC-1: ghi chú của dòng giao dịch có số tiền (server ghi \"Đối soát số dư: sổ X ₫, thật Y ₫\") cũng bị che; số không kèm ₫ giữ nguyên"; vẽ trên màn: ⚠ Chưa có test (giao diện — xem tay 390px / 1280px trên `wrangler dev` cục bộ: bật che thì 0 số tiền lộ ở Hôm nay, Ví & quỹ, Sổ giao dịch, Tài sản & tự do; prod 2026-10-13 390px: Hôm nay từ 23 số tiền xuống 0, tải lại vẫn che)

### AC-2: Đang che vẫn thấy số mình đang gõ
- Given đang che
- When mở Nhập, gõ 50.000, lưu
- Then ô nhập "50.000" và nút "Lưu 50.000 ₫" vẫn hiện số; toast sau khi lưu không có số tiền
- Tests: [`web/src/lib/money.test.ts`](../../web/src/lib/money.test.ts) › "che số tiền trên máy này (pwa UC-718) › UC-718 AC-2: đang che, gõ 50.000 → ô nhập và nút \"Lưu 50.000 ₫\" vẫn hiện số; toast sau khi lưu không có số tiền"

### AC-3: Lựa chọn theo từng máy
- Given máy A che, máy B không
- When máy B mở app; máy A tải lại
- Then máy B hiện số; máy A vẫn che
- Tests: [`web/src/lib/money.test.ts`](../../web/src/lib/money.test.ts) › "che số tiền trên máy này (pwa UC-718) › UC-718 AC-3: lựa chọn lưu theo từng máy — máy A che, máy B không; máy A tải lại vẫn che"

## Dependencies
- Upstream UC: UC-711 (khung, định dạng tiền)
- Downstream UC: mọi màn có số tiền (UC-702, UC-707, UC-716, UC-717…)

## Divergences & Open Questions
- [OPEN] Cách đếm "0 số lộ" khi xem tay chỉ bắt số có dấu chấm nghìn hoặc kèm ₫; số tiền nhỏ hơn 1.000 không kèm ₫ (nếu có chỗ nào ghép tay) không bắt được.
- [OPEN] Ô Giả định của Thử số (pwa UC-717) điền sẵn từ số thật nên vẫn hiện số khi che — đúng luật "ô nhập vẫn hiện số" nhưng chủ nhà nên biết.

## Traceability
- Code: `web/src/lib/money.ts` › `HIDDEN_DIGITS`, `HIDE_AMOUNTS_KEY`, `setAmountsHidden`, `amountsHidden`, `loadAmountsHidden`, `saveAmountsHidden`, `formatVnd`, `formatSigned`, `moneyDigits`, `maskAmounts` (che), `formatTypedVnd`, `groupDigits` (không che); `web/src/ui/money.tsx` › `Money` (`aria-label`); `web/src/ui/parts.tsx` › `PageHeader` (nút con mắt); `web/src/ui/shell.tsx` › `Sidebar` (con mắt ở chân); `web/src/state/store.ts` › `hideAmounts`, `setHideAmounts`, `start`; chỗ chuyển sang hàm tiền: `web/src/lib/{freedom,income-plan,manual-split,net-worth}.ts`, `web/src/screens/{assign,ledger-book,memo-book,today-desktop,wallets}.tsx`; số đang gõ: `web/src/ui/fields.tsx`, `entry.tsx`, `budget-sheets.tsx`, `debts.tsx`, `memo-book.tsx`, `net-worth.tsx`, `other-entry-sheet.tsx`, `tenants.tsx` (`formatTypedVnd`)
- Dữ liệu: `localStorage` `vi-nha:hide-amounts` (pwa `entities.md`); không đổi server
