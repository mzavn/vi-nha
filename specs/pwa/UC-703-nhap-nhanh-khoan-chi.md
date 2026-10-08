# UC-703: Nhập nhanh khoản chi (3 chạm)
- Status: implemented
- BR: BR-03, BR-01
- Decisions: D12, D13, D14, D6; DESIGN.md §1, §4 (Toast); commit `032d089`, `b8e8f0c`, `80875be`; ADR-66 (D14 theo chiều tiền); ADR-67 (audit 261001 F08: lưu xong về đầu màn, lưới danh mục đứng yên); ADR-92 (tên trong mã nguồn, dữ liệu, địa chỉ màn bằng tiếng Anh)
- Actor: thành viên đã đăng nhập, thường đang đứng ngoài đường, một tay
- Trigger: tab "Nhập" (`#entry`), FAB "+" (điện thoại), nút "Nhập khoản chi" hoặc phím **N** (màn rộng), shortcut manifest `/#entry`

## History
- v1 (2026-09-22, commit `a756f68`): bàn phím số tự vẽ, chip +50k/+100k/+200k, lưới 6 danh mục hay dùng, tự điền ví/tài khoản, lưu qua hàng đợi, toast phản hồi ngân sách.
- v2 (2026-09-22, commit `80875be`): lưu không được vào máy thì báo lỗi và giữ nguyên số đã gõ.
- v3 (2026-09-22, commit `b8e8f0c`): chỉ cho chọn tài khoản **không** nối bank feed (D14).
- v4 (2026-09-22, commit `032d089`): bỏ bàn phím tự vẽ, dùng ô nhập gốc `inputmode="numeric"` có nhóm chấm khi gõ; cả vùng số là một `<label>`; thêm **+000** và **Xoá**; Enter lưu khi đủ thông tin.
- v5 (2026-09-22, commit `0ee6969`): màn rộng hai cột, cột phải có hàng đợi, Đếm ví và 10 giao dịch gần đây.
- v6 (2026-10-01, commit `39751b8`): ô "Trả bằng" lọc theo **chiều tiền ra** (ADR-66) — tài khoản nối SePay mà SePay không báo tiền ra (`sepayOut = false`, vd MB) chọn được; chỉ ẩn tài khoản bật "SePay báo cả tiền ra".
- v7 (2026-10-01, commit `11c52a0`): lưu xong cuộn về đầu màn và đặt con trỏ lại ô số tiền (`preventScroll`); thứ tự lưới 6 danh mục tính **một lần khi mở màn**, lưu một khoản không làm các ô nhảy chỗ (audit 261001 F08, ADR-67).
- v8 (2026-10-01, commit `ff2ee5b`): mỗi danh mục thật của nhà có icon riêng thay cho icon nhãn chung — Mạng (wifi), Dịch vụ (toà nhà), Sửa xe / gửi xe (cờ lê), Xe khách về quê (xe buýt), Chi tiêu khi về quê (ghim bản đồ), Thuốc thang (viên thuốc), Học tập (sách), Thiện phước (trái tim), Khác (ba chấm), Trả nợ (thẻ) — bảng `CATEGORY_ICON` trong `web/src/ui/icons.tsx` (bộ nét Lucide, không emoji, DESIGN.md §8). Danh mục mới chưa có trong bảng vẫn dùng `categories.icon` hoặc icon nhãn.
- v9 (2026-10-01, commit `49f8bce`): điện thoại hiện card **Giao dịch gần đây** (20 dòng, nút **Xem thêm** tải trang sau theo `before`) dưới card Đếm ví; máy tính giữ 10 dòng cạnh form, cũng có Xem thêm. Chạm một dòng mở chi tiết để sửa / xoá (pwa [UC-715](UC-715-xem-sua-xoa-giao-dich.md)); **Sửa** một khoản chi mở chính màn này ở chế độ sửa ("Sửa khoản chi", **Thôi sửa**, "Lưu thay đổi", cần mạng, lưu thay khoản cũ — ADR-73).
- v10 (2026-10-03, commit `a8703fd`): ô số tiền **tính được**: gõ `24+55` thì ô giữ phép tính, dòng dưới chip hiện "= 79 ₫", nút Lưu dùng kết quả; rời ô / Enter thì ô thành kết quả. Cộng `+`, trừ `-`/`−`, nhân `×`/`*` (nhân trước); đơn vị là **đồng như ô đang hiện** (`24+55` = 79 ₫, chạm **+000** sau đó ra 79.000 ₫). Hàng chip thêm nút **+** (icon Lucide `plus`) — bàn phím số iOS (`inputmode="numeric"`) không có dấu cộng; giữ `numeric` vì đổi sang `text` mất bàn phím số. Không thêm nút **−**: bảy chip ở màn 375px còn dưới 44px, sáu chip mỗi nút 49px. Phép tính sai (kết quả ≤ 0, vượt 1.000 tỷ, ký tự lạ) → dòng đỏ "Sai: kết quả phải trên 0, tối đa 1.000 tỷ", nút chính "Phép tính chưa đúng" (tắt). Cùng logic cho mọi ô số tiền trong sheet (`AmountInput` dùng chung `useAmountField`; dòng kết quả nằm dưới ô; ô sheet giờ cũng giữ số trước khi gõ vượt trần, như ô Nhập).
- v11 (2026-10-03, commit `a18730c`): theo audit 261003: sửa / xoá một khoản (UC-715) thay dòng "vừa ghi" bằng câu toast của việc đó — trước đó dòng vẫn nói "Đã ghi 35.000 ₫. Ăn uống còn 290.000 ₫" của lần ghi trước, số "còn" đã sai sau khi sửa. Chưa có bootstrap mà lần tải đầu hỏng → "Chưa tải được số." / "Không có mạng." kèm **Tải lại** thay skeleton (pwa UC-702 E1).
- v12 (2026-10-03, commit `3bc597c`): theo audit 261003 (M14, M27, chủ nhà duyệt): ô số tiền đang là phép tính thì **mỗi số nhóm chấm khi gõ** (`24000+55000` → `24.000+55.000`, `groupExpr`), con trỏ giữ đúng chỗ khi dấu chấm thêm/bớt; con trỏ ở cuối thì ô cuộn cho thấy **phần cuối** phép tính dài (phần đầu khuất bên trái) — cả ô màn Nhập lẫn ô sheet (`useAmountField`). Dòng "vừa ghi" đang nói "…, chờ đồng bộ…" của một khoản mà sau đó server từ chối thì **xoá** (chip "N bị từ chối" + thẻ Chưa lên sổ đã nói) — trước đó dòng nằm lại tới lần nhập sau.
- v13 (2026-10-03, commit `3bc597c`): dòng "vừa ghi" "Đã ghi X, chờ đồng bộ. …" của khoản lên sổ ở lượt gửi sau đổi thành câu đã ghi ("Đã ghi 40.000 ₫. Ăn uống còn 585.000 ₫ tuần này." — số còn lại tính lúc lưu, đã trừ tạm khoản đó); bỏ hẳn khoản đó thì dòng bị xoá (UC-704 v10).
- v14 (2026-10-03, commit `c67420e`): "Giao dịch gần đây" chia trang thay cho **Xem thêm** — chủ nhà: "UI chỗ này để xem dạng 5/10/20/50/100 và mặc định là 10 dòng 1 trang". Cuối card: ô **Mỗi trang** (5 / 10 / 20 / 50 / 100 dòng, mặc định 10, nhớ theo máy ở `localStorage` `vi-nha:tx-page-size`), "Trang N", nút **Trang trước** / **Trang sau**; điện thoại hai hàng (nút ≥ 44px, rộng nửa card), máy tính một hàng gọn. Cùng cỡ trang cho điện thoại và máy tính (trước: điện thoại 20 dòng, máy tính 10).
- v15 (2026-10-06, commit `43e4699`): change [`261006-so-giao-dich`](../changes/archive/261006-so-giao-dich/proposal.md) — đầu card "Giao dịch gần đây" thêm link **Xem tất cả ›** mở Sổ giao dịch (pwa [UC-716](UC-716-so-giao-dich.md)); **+ Ghi khoản** ở Sổ giao dịch mở màn này với ngày điền sẵn (7b): dòng phụ "Ghi vào ngày 30/9 — ghi xong quay về Sổ giao dịch", lưu xong về sổ.
- v16 (2026-10-06, commit `a0d0ccc`): card Giao dịch gần đây có nút rộng **Mở Sổ giao dịch — xem theo tháng, lọc, tìm** dưới phần chia trang (pwa UC-716).
- v17 (2026-10-07, commit `7424f26`): địa chỉ màn Nhập `#entry`, shortcut manifest `/#entry` (thay `#nhap`) — ADR-92 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Đã có `bootstrap` (từ mạng hoặc bản lưu của đúng người — UC-710); chưa có thì hiện skeleton, hoặc — lần tải đầu đã hỏng — "Chưa tải được số." / "Không có mạng." kèm **Tải lại** (pwa UC-702 E1).
- Không cần mạng.

## Main Flow
1. Mở màn: con trỏ tự vào ô số tiền (máy tính gõ ngay; iOS có thể cần một chạm vào vùng số để bật bàn phím).
2. **Chạm 1** — số tiền: gõ số (tự nhóm chấm `1.250.000`) hoặc chạm **+50k / +100k / +200k** (cộng dồn); **+000** nhân 1000; **+** thêm dấu cộng vào cuối ô (thay dấu phép tính đang treo, con trỏ ở lại trong ô); **Xoá** về 0. Ô có dấu phép tính sau một chữ số (`isAmountExpr`) thì giữ chữ đã gõ nhưng mỗi số nhóm chấm (`groupExpr`: `50000+35000` → `50.000+35.000`, con trỏ giữ chỗ; con trỏ ở cuối thì ô cuộn cho thấy phần cuối), số tiền = `evalAmount` (dòng dưới chip "= X ₫"); chip +50k/+000/Xoá tính trên kết quả và bỏ phép tính.
3. **Chạm 2** — danh mục: lưới 6 danh mục dùng nhiều nhất 30 ngày (`boot.categoryUsage`; hoà thì theo `sort`, rồi tên), thứ tự tính một lần lúc mở màn và giữ nguyên trong suốt lượt dùng màn (ghi liên tiếp theo trí nhớ tay). Chọn → ví tự điền theo danh mục, đã đổi sang ví cá nhân của người đang nhập nếu danh mục trỏ vào ví người kia; tài khoản mặc định là **tiền mặt của người đang nhập** (không có thì tài khoản nhập tay đầu tiên). Dòng dưới ô Ví: "còn X tuần này" / "còn X tháng này" / "còn X" (+ " (số cũ)" khi đang hiện số cũ), tính từ snapshot đã trừ tạm.
4. Thanh Lưu (dính đáy): dòng tóm tắt "{ví} · còn X tuần này" + tên tài khoản (chạm để cuộn tới ô Ví), và nút chính luôn nói bước kế tiếp: "Nhập số tiền" → "Chọn danh mục" → "Chọn ví" → "Chọn tài khoản" → **Lưu {số} ₫**.
5. **Chạm 3** — Lưu: `saveEntry({ meaning: "spend", amount, at, client_id, category_id, wallet_id, account_id, note? })` → hàng đợi trước, rồi gửi (UC-704). Nút ghi "Đang ghi…" trong lúc chờ.
6. Chờ server tối đa **2,5 giây**:
   - server ghi xong → toast dùng `wallet` server trả: "Đã ghi 250.000 ₫. Đi lại còn 950.000 ₫ tuần này." (không có mức tuần thì "… tháng này.", không có mức thì "… còn X.", ví ẩn số thì chỉ "Đã ghi X ₫.");
   - quá 2,5 giây / mất mạng / lỗi 5xx → toast số tính tại máy: "Đã ghi 250.000 ₫, chờ đồng bộ. Đi lại còn 50.000 ₫ tuần này.";
   - server từ chối → toast "Chưa ghi được: {lý do} Khoản này nằm trong hàng đợi để sửa."
7. Máy rung 12 ms (nếu hỗ trợ); câu toast được giữ lại thành dòng "vừa ghi" dưới ô số tới lần nhập sau (sửa / xoá một khoản ở UC-715 cũng thay dòng này bằng câu toast của việc đó; dòng "…, chờ đồng bộ…" của khoản mà sau đó server từ chối thì bị xoá, lên sổ thì thành câu đã ghi — UC-704). Form về trạng thái đầu: số 0, bỏ danh mục/ví/ghi chú, ngày = hôm nay, tài khoản = mặc định; màn cuộn về đầu và con trỏ về ô số tiền (không cuộn thêm) để nhập khoản kế tiếp.

## Alternative Flows
- 2a. Enter trong ô số: đủ thông tin thì lưu; chưa đủ thì đóng bàn phím.
- 2b. Ô đang là phép tính: Enter / rời ô (kể cả chạm chip, chạm Lưu) → ô thành kết quả đã nhóm chấm. Dấu phép tính treo ở cuối (`24+`) không báo sai: kết quả là phần trước nó. Phép tính sai thì ô giữ nguyên để sửa, số tiền = 0.
- 3a. **Tất cả** mở sheet đủ danh mục theo `sort`. Danh mục chọn từ đó mà không nằm trong top 6 thì được đưa lên đầu lưới (lưới vẫn 6 ô).
- 3b. Đổi ví: danh sách ví chi được bỏ ví Thu nhập (`holding`), Tích sản và ví cá nhân của người kia. Đổi tài khoản: `manualAccounts(accounts, "out")` — tài khoản không nối SePay, hoặc nối nhưng SePay không báo tiền ra (`!sepayEnabled || !sepayOut`, ADR-66); không có tài khoản nào như vậy → "Mọi tài khoản đã nối ngân hàng: khoản này sẽ tự về, gán nó ở màn Gán." (nút Lưu kẹt ở "Chọn tài khoản").
- 3c. "Thêm ghi chú, đổi ngày": ghi chú ≤ 500 ký tự; ngày tối đa hôm nay (đồng hồ máy). Ngày lùi → `at` = 12:00 giờ VN của ngày đó; hôm nay → giờ thật.
- 3d. Sau khi tải lại bootstrap mà tài khoản đang chọn không còn trong danh sách nhập tay → tài khoản về mặc định.
- 5a. Offline: phụ đề đổi thành "Không có mạng — khoản chi vẫn ghi, tự gửi khi có mạng"; luồng giữ nguyên.
- Header có nút **Loại khác** (UC-705); cuối màn có card "Đếm ví / nhập số dư thật" (UC-708), danh sách "Chưa lên sổ" (UC-704) và "Giao dịch gần đây" (chia trang — AC-13; chạm dòng → UC-715; link **Xem tất cả ›** ở đầu card → Sổ giao dịch, UC-716).
- 7a. Chế độ sửa (mở từ **Sửa** ở UC-715): form điền sẵn khoản chi cũ, ô ghi chú và ngày mở sẵn, khoản trả nợ hiện "Trả nợ cho {tên}"; Lưu gọi `/v1/transactions/:id/replace` (không qua hàng đợi, cần mạng), xong về màn đã mở; **Thôi sửa** hoặc rời màn thì bỏ sửa.
- 7b. Mở từ **+ Ghi khoản** ở Sổ giao dịch (UC-716, `entryPreset`): ngày điền sẵn là ngày cuối tháng đang xem ở sổ nếu tháng đó đã qua (không thì hôm nay) — hàng ngày hiện "30/9", đổi được; dòng phụ "Ghi vào ngày {d/m} — ghi xong quay về Sổ giao dịch" (mất mạng: dòng phụ offline như 5a). Lưu (kể cả khi vào hàng đợi) → về Sổ giao dịch; rời màn mà không lưu thì bỏ ngày điền sẵn. Loại khác vẫn dùng ngày riêng của sheet.

## Exceptions
- E1. Không ghi được vào máy (IndexedDB và localStorage đều chặn/đầy) → toast "Không lưu được vào máy: bộ nhớ trình duyệt đang bị chặn hoặc đã đầy. Khoản này chưa được ghi."; lỗi khác khi đưa vào hàng đợi → "Không lưu được khoản này. Thử lại."; form **giữ nguyên** số đã nhập.
- E2. Không còn người đăng nhập → về màn đăng nhập, không lưu.
- E3. Số vượt trần 1.000.000.000.000 → ô giữ số trước đó; chip nhanh kẹp ở trần; +000 vượt trần thì không đổi. Phép tính ra ≤ 0 hoặc vượt trần (kể cả một tích giữa chừng) → `evalAmount` null: dòng đỏ, nút chính "Phép tính chưa đúng".

## Acceptance Criteria
### AC-1: Ba chạm để ghi một khoản tiền mặt
- Given Vợ đăng nhập, danh mục "Tụ tập / cà phê" trỏ về ví Chơi (chồng)
- When chạm +200k → "Tụ tập / cà phê"
- Then ví tự điền là Chơi (vợ), tài khoản là Tiền mặt (vợ), nút chính ghi "Lưu 200.000 ₫"; chạm nó là lưu
- Tests: `web/src/lib/categories.test.ts` › "tự điền ví và tài khoản › vợ chọn Tụ tập / cà phê → ví Chơi (vợ), tài khoản Tiền mặt (vợ)"; luồng chạm: ⚠ Chưa có test

### AC-2: Lưới 6 danh mục theo tần suất
- Given `categoryUsage` 30 ngày
- When mở màn Nhập
- Then lưới có đúng 6 danh mục dùng nhiều nhất; chưa có dữ liệu thì theo thứ tự cấu hình; hoà thì theo `sort`
- Tests: `web/src/lib/categories.test.ts` › "6 danh mục hay dùng nhất › tần suất 30 ngày lên đầu, lấy đúng 6"; "6 danh mục hay dùng nhất › chưa có dữ liệu thì theo thứ tự cấu hình"; "6 danh mục hay dùng nhất › hoà tần suất thì theo sort"

### AC-3: Không bao giờ mặc định vào tài khoản mà chiều tiền đó tự về
- Given tài khoản MB nối SePay chỉ báo tiền vào, Sacombank nối SePay báo cả tiền ra, BIDV ghi tay
- When lấy danh sách tài khoản cho khoản chi (chiều ra) và cho khoản thu (chiều vào)
- Then chiều ra có MB và BIDV, chiều vào chỉ có BIDV; tài khoản mặc định (khi không có tiền mặt) không bao giờ là tài khoản bị ẩn
- Tests: `web/src/lib/categories.test.ts` › "tài khoản nhập tay được › chiều tiền SePay báo về thì ẩn: tiền vào ẩn mọi tài khoản đã nối; tiền ra chỉ ẩn tài khoản SePay báo cả tiền ra"

### AC-4: Toast nói kết quả kèm hệ quả
- Given ví Đi lại còn 950.000 ₫ tuần này sau khi ghi
- When lưu 250.000 ₫ và server trả trong 2,5 giây
- Then toast "Đã ghi 250.000 ₫. Đi lại còn 950.000 ₫ tuần này."; vượt mức thì hiện số âm "Ăn uống còn −40.000 ₫ tuần này."
- Tests: `web/src/lib/pending.test.ts` › "toast phản hồi ngân sách › đúng câu của DESIGN.md khi có mức tuần"; "toast phản hồi ngân sách › vượt mức thì nói số âm, không làm dịu"; "toast phản hồi ngân sách › ví tháng, ví ẩn số, snapshot của tuần trước"

### AC-5: Offline vẫn có phản hồi ngân sách
- Given máy mất mạng
- When lưu 250.000 ₫ vào Đi lại
- Then toast "Đã ghi 250.000 ₫, chờ đồng bộ. Đi lại còn 50.000 ₫ tuần này." tính từ snapshot đã trừ tạm; khoản nằm trong hàng đợi `pending`
- Tests: `web/src/lib/pending.test.ts` › "toast phản hồi ngân sách › offline: vẫn báo ví còn bao nhiêu, kèm chờ đồng bộ"

### AC-6: Không lưu được vào máy thì không mất số
- Given IndexedDB bị chặn và localStorage đầy
- When bấm Lưu
- Then kho ném `StorageUnavailableError`, toast báo "Không lưu được vào máy: …", số tiền/danh mục đã chọn vẫn còn trên màn
- Tests: `web/src/offline/idb.test.ts` › "hàng đợi khi không có IndexedDB › localStorage đầy hoặc bị chặn → báo lỗi, không nuốt"; phần giữ form: ⚠ Chưa có test

### AC-7: Ô số tiền gõ tự nhiên và chặn trần
- Given ô số tiền
- When gõ "1250000", xoá lùi qua dấu chấm, dán "50k", hoặc gõ quá 1.000 tỷ
- Then ô hiện "1.250.000", ra 125.000 khi xoá lùi, "50k" thành 50, số vượt trần giữ số trước đó; +000 nhân 1000 trừ khi vượt trần
- Tests: `web/src/lib/money.test.ts` › "nhập số › ô nhập gốc: gõ số hiện nhóm chấm, xoá hết thì trống"; "nhập số › chặn vượt trần: giữ số trước đó"; "nhập số › nút nhanh và +000"

### AC-8: Ngày chọn lùi rơi đúng ngày
- Given chọn ngày hôm qua
- When lưu
- Then `at` = 12:00 giờ VN của ngày đó; chọn hôm nay thì giữ giờ thật
- Tests: `web/src/lib/period.test.ts` › "nhãn kỳ › ngày chọn lùi lấy 12:00 giờ VN, hôm nay giữ giờ thật"

### AC-9: Lưu xong sẵn sàng cho khoản kế tiếp
- Given đang nhập liên tiếp, màn đã cuộn xuống
- When lưu một khoản
- Then màn về đầu, con trỏ ở ô số tiền; lưới 6 danh mục giữ đúng thứ tự như lúc mở màn
- Tests: ⚠ Chưa có test

### AC-10: Gõ phép tính trong ô số tiền
- Given ô số tiền màn Nhập (hoặc ô số tiền của một sheet)
- When gõ "24", chạm **+**, gõ "55"; rồi chạm **+000**; hoặc gõ "24.000 + 55.000", "3×20.000+5", "24+" (đang gõ dở)
- Then ô hiện "24+55", dòng dưới "= 79 ₫", rời ô ra "79", **+000** ra "79.000"; "24.000 + 55.000" = 79.000 ₫; nhân trước cộng sau (60.005 ₫); "24+" hiện "= 24 ₫", không báo sai; số thường và dán "-50.000" vẫn như cũ (50.000)
- Tests: `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › cộng trừ nhân cùng đơn vị đồng như ô hiện, nhân trước cộng sau"; "phép tính trong ô số tiền › dấu phép tính ở cuối khi đang gõ: hiện kết quả trước đó, không báo sai"; "phép tính trong ô số tiền › số thường không thành phép tính: gõ, dán số có dấu chấm hay dấu trừ đứng đầu vẫn như cũ"; ô + chip + rời ô: ⚠ Chưa có test

### AC-11: Phép tính sai thì không lưu được
- Given ô số tiền
- When gõ "50-80", "50-50", "1000000000000+1", "2000000×2000000" hoặc "24+-5"
- Then dòng đỏ "Sai: kết quả phải trên 0, tối đa 1.000 tỷ", số tiền = 0, nút chính "Phép tính chưa đúng" và tắt; sửa thành "50-8" thì "= 42 ₫" và nút đi tiếp
- Tests: `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › không ra số tiền hợp lệ thì null: kết quả ≤ 0, vượt trần, hai dấu liền nhau, ký tự lạ"; nút tắt: ⚠ Chưa có test

### AC-12: Phép tính dài vẫn đọc được: số nhóm chấm, thấy phần cuối
- Given ô số tiền màn Nhập 390px
- When gõ "50000", chạm **+**, gõ "35000", chạm **+**, gõ "1250000"; rồi đặt con trỏ sau "50" và gõ "1"
- Then ô hiện "50.000+35.000+1.250.000" (dòng dưới "= 1.335.000 ₫"), phần cuối "…1.250.000" nằm trong ô, phần đầu khuất bên trái; gõ "1" ra "501.000+…" với con trỏ ngay sau "501"; rời ô ra "1.335.000" như cũ
- Tests: `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › mỗi số trong phép tính nhóm chấm khi gõ, kết quả không đổi"; "phép tính trong ô số tiền › con trỏ giữ đúng chỗ khi dấu chấm thêm vào hay bớt đi"; cuộn tới phần cuối: ⚠ Chưa có test

### AC-13: Giao dịch gần đây chia trang, cỡ trang chọn được
- Given sổ có 62 khoản chi, máy chưa chọn cỡ trang
- When mở màn Nhập; bấm **Trang sau** hai lần, **Trang trước** một lần; chọn **Mỗi trang** 50; bật **Hiện khoản đã xoá**; mất mạng
- Then trang 1 có 10 dòng mới nhất (`GET /v1/transactions?limit=11` — đọc thừa một dòng để biết còn trang sau), Trang trước mờ; trang 2, 3 đọc `before=<id dòng cuối trang đang xem>`, Trang trước quay đúng trang 2 (ngăn xếp con trỏ trong máy); chọn 50 → về Trang 1, 50 dòng, nhớ 50 cho lần mở sau, trang 2 còn 12 dòng và Trang sau mờ; bật khoản đã xoá hoặc sổ được đọc lại (ghi / sửa / xoá, có mạng lại) → về Trang 1; mất mạng → ô chọn và hai nút mờ, dòng "Đổi trang cần mạng."; trang sau tải hỏng → "Chưa tải được giao dịch." + **Tải lại**, vẫn còn Trang trước. Cỡ trang lưu hỏng / lạ → 10
- Tests: `web/src/lib/tx-paging.test.ts` › "phân trang Giao dịch gần đây › cỡ trang đã lưu chỉ nhận 5/10/20/50/100, còn lại về mặc định 10"; "phân trang Giao dịch gần đây › đọc thừa một dòng; trang sau theo con trỏ before; khoản đã xoá chỉ khi bật"; "phân trang Giao dịch gần đây › dòng thừa báo còn trang sau và không hiện; đủ hoặc thiếu thì là trang cuối"; luồng bấm trên giao diện: ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-03, 390×844 và 1280×900, sáng/tối)

## Traceability
- Code: `web/src/screens/entry.tsx` › `Entry`, `EntryForm` (`plus`, `preset`), `amountWidth`, `QUICK`; `web/src/state/store.ts` › `saveEntry`, `doneText`, `entryPreset`; `web/src/lib/pending.ts` › `localWalletStatus`, `entryToast`; `web/src/lib/categories.ts` › `topCategories`, `defaultWalletFor`, `defaultAccountFor`, `manualAccounts`, `spendableWallets`; `web/src/lib/money.ts` › `nextAmount`, `amountText`, `addAmount`, `timesThousand`, `MAX_AMOUNT`, `isAmountExpr`, `evalAmount`, `groupExpr`; `web/src/lib/period.ts` › `atForDay`; `web/src/ui/fields.tsx` › `useAmountField`, `amountExprHint`, `AmountInput`, `newClientId`, `WalletSelect`, `AccountSelect`; `web/src/screens/today-desktop.tsx` › `RecentTransactions` (chia trang, link Xem tất cả); `web/src/lib/tx-paging.ts` › `PAGE_SIZES`, `parsePageSize`, `loadPageSize`, `savePageSize`, `txPagePath`, `splitPage`.
- Backend: ledger UC-101 Nhập tay một khoản tiền (`POST /v1/transactions`; luật đổi ví cá nhân `walletFor`/`cashAccountOf` import thẳng từ `src/domain/entry.ts`; cấm chiều tiền SePay báo về — D14 theo chiều, ADR-66); ledger UC-111 (bootstrap: danh mục, `categoryUsage`, ví, tài khoản kèm `sepayEnabled`/`sepayOut`).

## Divergences & Open Questions
- [DIVERGENCE] `docs/wireframe.md` §2 và `plans/.../phase-05-pwa.md` "2. Nhập": "bàn phím số bật SẴN khi mở (autofocus)"; code chỉ đặt focus vào ô nhập gốc, và ghi rõ iOS có thể cần một chạm mới bật bàn phím (`web/src/screens/entry.tsx` dòng 1–3, commit `032d089`). Bàn phím tự vẽ (bản `a756f68`) đã bị bỏ.
- [DIVERGENCE] `docs/DESIGN.md` §4 Toast lấy ví dụ "Đi lại còn 950.000 ₫ **tháng** này"; code ưu tiên mức tuần ("… **tuần** này") khi ví có mức tuần (`entryToast`, `web/src/lib/pending.ts:117`), khớp với `phase-05-pwa.md` và test "đúng câu của DESIGN.md khi có mức tuần".
- [OPEN] Toast khi bị từ chối nói "nằm trong hàng đợi để sửa", nhưng PWA không có chỗ sửa khoản trong hàng đợi — chỉ "Gửi lại" hoặc "Bỏ" (UC-704); sửa chỉ có cho khoản **đã lên sổ** (UC-715).
- [OPEN] Đồng hồ máy nhanh > 1 ngày làm mọi khoản bị server từ chối `future_at`; ô ngày lấy `max` theo đồng hồ máy. Server đã nói rõ khả năng đồng hồ sai (commit `11b12b3`), PWA chỉ hiện nguyên văn; không có phát hiện lệch giờ phía máy (`plans/reports/redteam-260922-0100-offline-ingest-robustness.md` §3).
- [OPEN] Mục tiêu "dưới 5 giây" (DESIGN.md §1) chưa có phép đo tự động.
- [OPEN] Chú thích trong `EntryForm` nói "Danh mục / tài khoản bị xoá khỏi cấu hình… bỏ chọn", nhưng effect chỉ đặt lại tài khoản; danh mục đang chọn không bị bỏ. [INFERENCE] Khoản gửi đi với danh mục không còn sẽ bị server từ chối (`unknown_category`, theo `redteam-260922-0100-offline-ingest-robustness.md`) và nằm lại hàng đợi ở trạng thái `rejected`.
- [OPEN] Ô số tiền trong sheet không có nút **+**: trên iPhone (bàn phím số không có dấu cộng) chỉ màn Nhập gõ phép tính được; Android/máy tính gõ hoặc dán được. Thêm nút vào từng hàng ô sheet sẽ chật hàng (nhãn · ô 64%).
- [OPEN] Ô sheet mà 0 là số hợp lệ — Số dư đầu, Ngưỡng tự chia lương, Sàn cứng, Số dư mở sổ người thuê (pwa UC-709, UC-713) — phép tính sai thì ô đỏ nhưng nút Lưu vẫn bật và số gửi đi là 0; chỉ Đếm ví (UC-708) chặn hẳn (`onChange(n, valid)` → `counted = null`).
