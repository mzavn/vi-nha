# UC-716: Sổ giao dịch
- Status: implemented
- BR: BR-01, BR-03, BR-05
- Decisions: không ADR mới — dùng lại sổ giao dịch (ledger [UC-111](../ledger/UC-111-so-giao-dich-va-du-lieu-nen.md)), sheet chi tiết ([UC-715](UC-715-xem-sua-xoa-giao-dich.md)), luật sửa = huỷ + ghi mới ([ADR-73](../decisions.md)); D12 (sổ cần mạng); DESIGN.md §4, §7, §7b (≥ 44px, bảng dưới 1024px tối đa 2 cột số, màn rộng thêm cột); ADR-92 (tên trong mã nguồn, dữ liệu, địa chỉ màn bằng tiếng Anh)
- Actor: thành viên đã đăng nhập (vợ hoặc chồng) muốn xem lại các khoản của một tháng, sửa / thay, ghi thêm
- Trigger: link **Xem tất cả ›** ở đầu card "Giao dịch gần đây" (Hôm nay máy tính, màn Nhập — điện thoại và máy tính); Ví & quỹ › Ngân sách › chạm tên một ví; Ví & quỹ › Tích sản › **Xem các khoản Tích sản**; mục **Sổ giao dịch** ở thanh bên (máy tính); mở thẳng `#ledger`

## History
- v1 (2026-10-06, commit `43e4699`): change [`261006-so-giao-dich`](../changes/archive/261006-so-giao-dich/proposal.md) — màn mới. Chủ nhà, chỉ vào card "Giao dịch gần đây": "hình như bạn làm thiếu của tôi một màn chi tiết các record đã ghi đúng không? … Mục tiêu là tôi xem lại lịch sử các khoản chi của các tháng, có thể chỉnh sửa / thay thế, ghi chép thêm ở đó nếu cần." Trước đó card chỉ có trang trước / sau theo thời gian, không chọn tháng, không lọc, không có tổng.
- v2 (2026-10-06, commit `a0d0ccc`): chủ nhà: "không xem được trên mobile cái chi tiết các bản ghi à? tôi tìm không thấy" — lối vào cũ chỉ là link nhỏ "Xem tất cả ›" ở đầu card Giao dịch gần đây, cuối màn Nhập. Thêm hai lối vào: hàng **Sổ giao dịch · Mở ›** ("Xem lại theo tháng, lọc, tìm, sửa các khoản đã ghi") ngay dưới hero ở Hôm nay điện thoại, và nút rộng **Mở Sổ giao dịch — xem theo tháng, lọc, tìm** cuối card Giao dịch gần đây (điện thoại lẫn máy tính).
- v3 (2026-10-06, commit `b2018f0`): tiêu đề ngày to, đậm, có đơn vị ₫ và bấm để thu gọn / mở từng ngày — chủ nhà: "cho to đậm cái thứ này lên, có nút collapse/expand từng ngày, đơn vị tiền có đ".
- v4 (2026-10-06, commit `18569ce`): change [`261006-tich-san-ro-rang`](../changes/archive/261006-tich-san-ro-rang/proposal.md) — lối vào mới từ Ví & quỹ › Tích sản: nút **Xem các khoản Tích sản** mở sổ lọc ví Tích sản, **mọi tháng** (alt 1b; pwa [UC-707](UC-707-xem-vi-va-quy.md) AC-20). Chủ nhà: "nếu là tích sản thì phải rõ là tiền nào, loại nào chứ? … phải đoán nó là tiền gì, đang ở đâu".
- v5 (2026-10-06, commit `18569ce`): bảng máy tính đưa Số tiền lên ngay sau Giờ — chủ nhà: "Giờ | số tiền | Khoản + ghi chú | Danh mục | tài khoản | người — tiền phải để lên đầu cho dễ quan sát".
- v6 (2026-10-07, commit `7424f26`): địa chỉ màn Sổ giao dịch `#ledger` (thay `#so`), tab `ledger` — ADR-92 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Đã có `bootstrap` (tên danh mục, ví, tài khoản, người cho bộ lọc và chip). Cần mạng: danh sách và tổng đọc `GET /v1/transactions` / `GET /v1/transactions/summary` (ledger UC-111); mất mạng thì chỉ có bản service worker đã lưu của đúng bộ lọc đó (nếu có) — dòng tổng nói "số lúc HH:mm".

## Main Flow
1. Mở màn (`#ledger`, màn phụ như Cài đặt — không chiếm tab thứ năm, không có FAB): tiêu đề **Sổ giao dịch**, dòng phụ là tháng đang xem ("tháng 10/2026" / "Cả sổ, mọi tháng"), nút chính **+ Ghi khoản**. Bộ lọc mặc định: tháng hiện tại, không lọc gì (`defaultFilter`). Bộ lọc giữ trong trạng thái app (`book`) khi rời màn rồi quay lại trong phiên (kể cả sau khi sửa khoản chi ở màn Nhập); **Xem tất cả ›** mở với bộ lọc mặc định; đăng xuất / đổi người thì bỏ.
2. Đầu màn dính dưới thanh tiêu đề khi cuộn:
   - **Tháng**: ‹ tháng trước · "tháng 9/2026" · tháng sau › (không quá tháng hiện tại) · **Mọi tháng** (bỏ lọc tháng; bấm lại "Theo tháng" về tháng hiện tại; đang xem mọi tháng thì ‹ về tháng hiện tại) — `stepMonth`.
   - Ô **Tìm** (ghi chú, nội dung ngân hàng, tên danh mục / người; gõ có dấu cũng khớp nội dung ngân hàng không dấu — "thuốc" ra "CHUYEN TIEN THUOC", ledger UC-111): gõ xong 0,3 giây mới tìm; dưới 2 chữ thì chưa tìm, hiện "Gõ ít nhất 2 chữ để tìm."
   - Nút **Lọc** ("Lọc (N)" khi đang bật N bộ lọc) mở sheet **Lọc sổ giao dịch**: **Loại** (chọn nhiều: Chi tiêu, Thu nhập, Hoàn tiền, Chuyển nội bộ, Cho vay, Nhận lại, Mua tài sản, Điều chỉnh), **Danh mục**, **Ví**, **Tài khoản**, **Người ghi** (chỉ khi nhà có hơn một người) — mỗi ô có "Tất cả"; **Nguồn** Tất cả / Ghi tay / Ngân hàng; **Hiện khoản đã xoá**; ghi chú "Khoản đã xoá vẫn nằm trong sổ để xem lại, không tính vào tổng nào."; **Bỏ hết bộ lọc** / **Xong**. Đổi đâu áp ngay (danh sách và tổng tải lại phía sau).
   - Bộ lọc đang bật hiện thành hàng nút viên ("Chi tiêu ×", "Thuốc thang ×", "Ví Ăn uống ×", "Vợ ghi ×", "Từ ngân hàng ×", "Có khoản đã xoá ×"); chạm → bỏ đúng bộ lọc đó (`filterChips`, `removeChip`). Tháng và chữ tìm không thành chip (đã có chỗ riêng).
3. **Dòng tổng** theo đúng bộ lọc (`GET /v1/transactions/summary`, không bao giờ kèm `include_void`): **Chi** = chi tiêu − hoàn tiền, **Thu** luôn hiện; **Cho vay**, **Nhận lại**, **Chuyển nội bộ**, **Mua tài sản**, **Điều chỉnh** (vào − ra) chỉ hiện khi khác 0 (`summaryParts`); dòng dưới: "N giao dịch" · "chi đã trừ X ₫ hoàn tiền" (khi có) · "chuyển nội bộ không tính vào thu chi" (khi có).
4. **Danh sách** nhóm theo ngày giờ VN, mới nhất trước; tiêu đề nhóm "Thứ Hai 5/10 · chi 312.000 ₫" (chữ đậm, to hơn dòng; chi thật của các dòng đã tải trong ngày: chi tiêu − hoàn tiền, bỏ khoản đã xoá; ngày không có khoản chi chỉ có thứ và ngày — `groupByDay`). Cả tiêu đề là nút (≥44px, mũi tên ⌄ / ›, `aria-expanded`) **thu gọn / mở** các khoản của ngày đó; ngày đang thu hiện "N khoản" bên phải. Mặc định mở hết; ngày đã thu giữ nguyên khi tải thêm hay sổ đọc lại, rời màn thì mở lại hết.
   - Điện thoại (< 1024px): bảng hai cột — tên khoản (`txLabel`), chip "đã xoá" nếu có, dòng phụ "giờ · ghi chú · ví · tài khoản (ra → vào) · người ghi"; số tiền có dấu theo chiều tiền (`txSign`: vào `+` xanh, ra `−`, chuyển không dấu; đã xoá gạch ngang).
   - Máy tính (≥ 1024px): bảng **Giờ · Số tiền ₫ · Khoản** (loại, ghi chú) **· Danh mục / Ví · Tài khoản · Người** — số tiền đứng ngay sau giờ cho dễ nhìn.
   - Cả hàng chạm được; ô tên là nút cho bàn phím. Chạm → `openTx` → sheet chi tiết dùng chung (UC-715: Sửa / Xoá / Gán lại / Chia, liên kết hai chiều) — không có sheet riêng.
5. **Tải thêm**: mỗi lượt 50 dòng (đọc 51 để biết còn nữa, con trỏ `before` = id dòng cuối như UC-111); cuộn tới gần cuối thì tự tải, nút **Tải thêm 50 khoản** vẫn có; hết thì "Đã hết các khoản khớp bộ lọc."
6. Đóng sheet chi tiết: bộ lọc, các dòng đã tải và vị trí cuộn giữ nguyên. Sổ đổi ở bất cứ đâu (ghi / sửa / xoá — `version` tăng): danh sách đọc lại đúng số dòng đang hiện (tối đa 199, một lượt) và tổng đọc lại; khoản cũ của một lần sửa thành "đã xoá" nên ẩn trừ khi bật Hiện khoản đã xoá.
7. **+ Ghi khoản** → màn **Nhập** (điện thoại và máy tính — máy tính không có "sheet Nhập", phím N cũng mở màn này) với ngày điền sẵn `entryDay`: đang xem một tháng đã qua → ngày cuối tháng đó; tháng hiện tại hay mọi tháng → hôm nay. Dòng phụ màn Nhập: "Ghi vào ngày 30/9 — ghi xong quay về Sổ giao dịch"; hàng ngày hiện "30/9", đổi được qua "Thêm ghi chú, đổi ngày". Giờ ghi tính bằng `atForDay` (ngày lùi → 12:00 giờ VN). Lưu xong (kể cả khi vào hàng đợi) → về Sổ giao dịch, danh sách và tổng tải lại.

## Alternative Flows
- 1a. Ví & quỹ › Ngân sách (điện thoại: tên ví ở hàng tầng; máy tính: cột Ví) — tên ví là nút gạch chân "{ví}: xem các khoản tháng này" → Sổ giao dịch lọc **ví đó, tháng hiện tại** (kể cả khi bảng đang xem theo tuần). Ví khớp cả ví được cộng lẫn ví bị trừ, nên thấy cả hoàn tiền về ví và chuyển ngân sách.
- 1b. Ví & quỹ › Tích sản › **Xem các khoản Tích sản** → Sổ giao dịch lọc **ví Tích sản, mọi tháng** (`month: null`) — bỏ heo, chuyển ngân sách vào, mua tài sản. Bút toán nạp ví của lần chia (`fund`) không hiện trong sổ (ledger UC-111), nên tab Tích sản ghi thêm "Phần chia từ thu nhập không hiện thành dòng riêng trong sổ — sổ chỉ có khoản thu gốc; tổng ở trên đã gồm phần đó."
- 4a. Không khớp gì: "Không có giao dịch nào khớp bộ lọc." kèm **Bỏ lọc và tìm** (khi đang lọc / tìm); không lọc gì: "Không có giao dịch nào trong thời gian này."
- 6a. Sửa một **khoản chi** từ sổ: sheet → Sửa → màn Nhập chế độ sửa (UC-715 bước 5) → Lưu thay đổi → về Sổ giao dịch với đúng bộ lọc cũ (màn dựng lại nên về đầu danh sách).
- 7a. Ghi từ sổ mà bấm **Loại khác** ở màn Nhập: sheet Loại khác dùng ngày của chính nó (hôm nay, đổi được) — ngày điền sẵn chỉ áp cho khoản chi.
- 7b. Rời màn Nhập mà không lưu → bỏ ngày điền sẵn; lần sau mở Nhập là nhập mới hôm nay.

## Exceptions
- E1. Không tải được (mất mạng, lỗi server) khi chưa có dòng nào: "Không có mạng. Sổ giao dịch cần mạng." / câu lỗi của server, nút **Tải lại**. Tải thêm hỏng: dòng cuối nói lỗi, nút **Thử lại**; các dòng đã tải giữ nguyên.

## Acceptance Criteria
### AC-1: Bộ lọc thành đúng query cho danh sách và tổng
- Given mặc định; rồi tháng 9 + Chi tiêu + Thuốc thang (+ Hiện khoản đã xoá, + con trỏ)
- When dựng đường dẫn danh sách / tổng
- Then `/v1/transactions?month=2026-10&limit=51`; `…?month=2026-09&meaning=spend&category_id=thuoc-thang&limit=51(&before=…&include_void=1)`; tổng cùng bộ lọc nhưng không bao giờ có `include_void`; mọi tháng → `/v1/transactions/summary` không tham số
- Tests: `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › mặc định là tháng hiện tại, không lọc gì; tháng 9 + Chi tiêu + Thuốc thang thành đúng query cho danh sách và tổng"

### AC-2: Lọc tháng 9 + Chi tiêu + một danh mục ra đúng các khoản, tổng chi đúng
- Given khoản chi y tế 120.000 (5/9) và 80.000 (20/9), 50.000 (30/8), khoản chi đi chợ 300.000 (10/9), hoàn tiền y tế 20.000 (21/9), khoản chi y tế 999.000 (15/9) đã xoá, một khoản chi từ ngân hàng
- When lọc tháng 9 + Chi tiêu + Y tế; thêm Hoàn tiền; bật xem khoản đã xoá
- Then đúng hai khoản 80.000, 120.000, tổng `spend` 200.000; thêm Hoàn tiền thì có cả khoản hoàn và `refund` 20.000 (Chi = 180.000); khoản đã xoá chỉ hiện khi bật và không cộng vào tổng; lọc ví / tài khoản / người ghi / nguồn khớp đúng cột, phân trang giữ bộ lọc
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › lọc tháng 9 + Chi tiêu + một danh mục: đúng các khoản, tổng chi đúng; các bộ lọc khác khớp đúng cột"; màn hình: ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-06, ~185 giao dịch tháng 8–10: tháng 9 + Chi tiêu + Thuốc thang ra 13 khoản, Chi 1.340.000 ₫ khớp API)

### AC-3: Tìm "shopee" ra khoản có ghi chú hoặc nội dung ngân hàng chứa chữ đó
- Given khoản chi ghi chú "áo Shopee cho bé", khoản chi từ ngân hàng nội dung "SHOPEEPAY 12345", khoản chi đi chợ, khoản cho vay Chị Lan
- When tìm "shopee", "nấu ăn", "Lan", "50%"; tìm "a"; gõ "  shopee " / "s" ở ô Tìm; thêm khoản chi từ log "chuyen tien thuoc cho me" và khoản ghi chú "Thuốc ho cho bé", tìm "thuốc"
- Then hai khoản Shopee (không phân biệt hoa thường với chữ không dấu); "nấu ăn" ra khoản danh mục "Đi chợ / nấu ăn"; "Lan" ra khoản cho vay; "%" là chữ thường; "a" → 400 "Từ tìm phải có ít nhất 2 ký tự."; ô Tìm gửi `q=shopee`, một chữ thì chưa gửi; "thuốc" ra cả khoản ngân hàng không dấu lẫn khoản ghi chú có dấu
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tìm chữ: ghi chú, nội dung ngân hàng, tên danh mục, tên người; ít hơn 2 ký tự thì báo sai"; "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tìm có dấu cũng khớp nội dung ngân hàng không dấu; tìm không dấu chưa khớp chữ có dấu đã lưu"; `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › chữ tìm: gửi khi đủ 2 ký tự (đã cắt khoảng trắng, mã hoá URL), ngắn hơn thì chưa tìm"

### AC-4: Chip bộ lọc đọc được, chạm × bỏ đúng bộ lọc đó
- Given bật Chi tiêu, Hoàn tiền, Thuốc thang, ví Có thì tốt, Tiền mặt (vợ), Vợ ghi, Từ ngân hàng, Hiện khoản đã xoá
- When vẽ chip; chạm × từng chip
- Then "Chi tiêu", "Hoàn tiền", "Thuốc thang", "Ví Có thì tốt", "Tiền mặt (vợ)", "Vợ ghi", "Từ ngân hàng", "Có khoản đã xoá" (loại theo thứ tự danh sách); bỏ chip nào thì chỉ bộ lọc đó mất
- Tests: `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › bộ lọc đang bật thành chip có tên dễ đọc; chạm × bỏ đúng bộ lọc đó; loại giữ thứ tự của danh sách"

### AC-5: Đi tháng không quá tháng hiện tại
- Given hôm nay 6/10/2026
- When ‹ / › từ tháng 10, tháng 1, tháng 9; từ "Mọi tháng"
- Then 9/2026; 12/2025; 10/2026; › ở tháng 10 mờ; từ mọi tháng ‹ về tháng 10, › mờ
- Tests: `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › đi tháng: lùi tự do, tới không quá tháng hiện tại; đang xem cả sổ thì ‹ về tháng này"

### AC-6: Dòng tổng theo nghĩa tiền thật; tiêu đề ngày nói chi thật của ngày
- Given tháng có chi 500.000, hoàn 50.000, thu 3.000.000, cho vay 400.000, nhận lại 100.000, chuyển nội bộ 700.000; một ngày có chi 300.000 + 20.000, hoàn 8.000, một khoản chi đã xoá, một khoản thu lúc 01:00 giờ VN
- When vẽ dòng tổng và nhóm ngày
- Then "Chi 450.000 · Thu 3.000.000 · Cho vay 400.000 · Nhận lại 100.000 · Chuyển nội bộ 700.000" (loại bằng 0 không hiện, Chi và Thu luôn hiện); nhóm "Thứ Hai 5/10 · chi 312.000 ₫" gồm cả khoản thu 01:00 giờ VN, ngày chỉ có thu là "Thứ Bảy 3/10"
- Tests: `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › dòng tổng theo nghĩa tiền thật: Chi = chi tiêu − hoàn tiền, Thu luôn có; loại khác chỉ hiện khi có số"; "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › nhóm theo ngày giờ VN, tiêu đề ngày nói chi thật của ngày (trừ hoàn tiền, bỏ khoản đã xoá)"; [`test/api.test.ts`](../../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tổng theo nghĩa tiền thật: chi, hoàn, thu, cho vay / nhận lại, chuyển nội bộ, mua tài sản, điều chỉnh hai chiều" (server)

### AC-7: Sửa / xoá từ sổ: danh sách và tổng cập nhật, khoản cũ thành "đã xoá" (ẩn mặc định)
- Given đang xem tháng 9, đã cuộn xuống dòng thứ 61
- When chạm một khoản chi → Xoá → Xoá hẳn; rồi chạm một khoản chi 35.000 → Sửa → đổi thành 77.000 → Lưu thay đổi
- Then sau xoá: sheet đóng, vị trí cuộn giữ nguyên, danh sách bớt một dòng, Chi giảm đúng số đã xoá; sau sửa: về Sổ giao dịch tháng 9, dòng mới 77.000 thay chỗ khoản cũ, Chi tăng 42.000, khoản cũ chỉ hiện khi bật Hiện khoản đã xoá (gạch ngang, chip "đã xoá")
- Tests: ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-06, 390px: Chi 10.454.000 → 10.004.000 sau xoá 450.000, scrollY giữ 4461; 10.004.000 → 10.046.000 sau sửa 35.000 → 77.000)

### AC-8: Ghi thêm khi đang xem tháng 9 → ngày mặc định 30/9
- Given hôm nay 6/10/2026, Sổ giao dịch đang xem tháng 9
- When bấm + Ghi khoản; hay đang xem tháng 10 / mọi tháng; tháng 2/2028
- Then màn Nhập "Ghi vào ngày 30/9 — ghi xong quay về Sổ giao dịch", hàng ngày "30/9"; lưu → về sổ, nhóm "Thứ Tư 30/9 · chi 99.000 ₫" có khoản mới; tháng 10 / mọi tháng → hôm nay; tháng 2/2028 → 29/2
- Tests: `web/src/lib/tx-filter.test.ts` › "Sổ giao dịch: bộ lọc (change 261006-so-giao-dich) › ghi thêm khi đang xem tháng 9 → ngày mặc định 30/9; tháng này hay cả sổ → hôm nay"; màn hình: ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-06, 390px và 1280px)

### AC-9: Mở từ Giao dịch gần đây và từ Ngân sách
- Given card Giao dịch gần đây (màn Nhập điện thoại, Hôm nay máy tính); bảng Ngân sách tháng 10 có ví Ăn uống "đã chi 390.000"
- When chạm **Xem tất cả ›**; chạm tên ví Ăn uống
- Then Sổ giao dịch tháng hiện tại không lọc; Sổ giao dịch tháng 10 với chip "Ví Ăn uống", Chi 390.000 ₫
- Tests: ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-06, 390px và 1280px, sáng / tối)

## Traceability
- Code: `web/src/screens/ledger-book.tsx` › `LedgerBook`, `useBookRows`, `Summary`, `BookList`, `PhoneRow`, `WideRow`, `FilterSheet`; `web/src/lib/tx-filter.ts` › `BOOK_PAGE`, `BOOK_MEANINGS`, `BookFilter`, `defaultFilter`, `searchText`, `filterQuery`, `bookPath`, `summaryPath`, `filterChips`, `removeChip`, `toggleMeaning`, `clearFilters`, `stepMonth`, `entryDay`, `netSpend`, `groupByDay`, `summaryParts`; `web/src/lib/transactions.ts` › `txSign`, `txLabel`, `MEANING_LABEL`; `web/src/lib/types.ts` › `TxSummary`; `web/src/state/store.ts` › `Tab` (`ledger`), `book`, `entryPreset`; `web/src/screens/entry.tsx` › `Entry`, `EntryForm` (`preset`); `web/src/screens/today-desktop.tsx` › `RecentTransactions` (**Xem tất cả**); `web/src/screens/wallets.tsx` › `BudgetTab` (`openBook`), `WalletLink`; `web/src/app.tsx` (`#ledger`, không FAB); `web/src/ui/shell.tsx` › `Sidebar`; `web/src/ui/icons.tsx` (`search`, `filter`, `chevron-left`); `web/src/styles.css` (`.book-*`, `.recent-links`, `.wallet-link`).
- Backend: ledger [UC-111](../ledger/UC-111-so-giao-dich-va-du-lieu-nen.md) (`GET /v1/transactions` lọc, `GET /v1/transactions/summary`), [UC-102](../ledger/UC-102-huy-giao-dich.md) qua sheet UC-715.

## Divergences & Open Questions
- [DIVERGENCE] Proposal nói "+ Ghi khoản" mở "sheet Nhập (máy tính)"; máy tính không có sheet Nhập — nút mở màn Nhập như phím N, ngày điền sẵn và quay về sổ như điện thoại.
- [OPEN] Tìm khớp chữ đã lưu (`LIKE`) và dạng bỏ dấu của **chữ tìm**, nên "thuốc" ra cả "Thuốc ho" lẫn nội dung ngân hàng "THUOC"; chiều ngược chưa có: "thuoc" không ra ghi chú / tên danh mục "Thuốc …", "THUỐC" không ra "Thuốc" (LIKE chỉ bỏ qua hoa thường với chữ không dấu). Cần cột chuẩn hoá chữ đã lưu (migration) — chưa ai cần.
- [OPEN] Tiêu đề ngày cộng chi của **các dòng đã tải**: ngày nằm vắt qua cuối một lượt tải thì số chi của ngày đó thiếu cho tới khi tải thêm (tự tải khi cuộn tới).
- [OPEN] Mất mạng: danh sách và tổng có thể là bản service worker lưu của đúng đường dẫn đó (dòng tổng nói "số lúc HH:mm"); tải thêm hay bộ lọc chưa từng xem thì báo "Không có mạng." — không có sổ offline đầy đủ.
