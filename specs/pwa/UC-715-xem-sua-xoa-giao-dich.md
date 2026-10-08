# UC-715: Xem, sửa, xoá một giao dịch
- Status: implemented
- BR: BR-03, BR-04, BR-01
- Decisions: [ADR-73](../decisions.md) (sửa = huỷ + ghi mới trong một batch; giao dịch ngân hàng chỉ gỡ gán); ADR-02 luật 1; D12 (sửa / xoá cần mạng); DESIGN.md §4 (Toast nói kết quả kèm hệ quả, ≥ 44px); ADR-92 (tên trong mã nguồn, dữ liệu, địa chỉ màn bằng tiếng Anh)
- Actor: thành viên đã đăng nhập (vợ hoặc chồng) vừa nhập nhầm
- Trigger: chạm một dòng giao dịch ở: "Giao dịch gần đây" (Hôm nay máy tính, màn Nhập — điện thoại và máy tính), Sổ giao dịch (UC-716), Ví & quỹ › Tích sản › Tài sản đang giữ, Ví & quỹ › Nợ › chi tiết một khoản (lần trả / cho vay / nhận lại), Người thuê › tháng › Đã chuyển

## History
- v1 (2026-10-01, commit `49f8bce`): sheet chi tiết giao dịch dùng chung (`openTx`), Sửa / Xoá cho khoản ghi tay, Gán lại cho giao dịch ngân hàng, chỉ xem cho bút toán hệ thống; danh sách "Giao dịch gần đây" trên màn Nhập điện thoại có Xem thêm. Lý do: chủ nhà — "vợ chồng nhập → lưu nhưng nhầm, phải cho sửa / xoá; đồng bộ SePay thì không cho xoá, ghi tay thì có".
- v2 (2026-10-01, commit `2cfeb0a`): danh sách "Giao dịch gần đây" ẩn khoản đã xoá; nút **Hiện khoản đã xoá / Ẩn khoản đã xoá** ở đầu card để xem lại khi cần đối chiếu (ledger UC-111 v6).
- v3 (2026-10-03, commit `a18730c`): theo audit 261003: sửa / xoá xong thì dòng "vừa ghi" ở màn Nhập (UC-703 bước 7) đổi theo câu toast của việc đó, không còn số "còn X" cũ; hàng **Điều chỉnh sau đếm ví** trong "Giao dịch gần đây" có dấu theo chiều tiền (`+` khi tiền thật nhiều hơn sổ — `counter_account_id`, `−` khi ít hơn), trước đó hiện số trần không biết đếm ra thừa hay thiếu.
- v4 (2026-10-03, commit `c67420e`): "Giao dịch gần đây" bỏ nút **Xem thêm**, chia trang: **Mỗi trang** 5 / 10 / 20 / 50 / 100 (mặc định 10, nhớ theo máy), **Trang trước** / **Trang sau** (pwa [UC-703](UC-703-nhap-nhanh-khoan-chi.md) AC-13). Dòng vẫn chạm được để mở sheet chi tiết.
- v5 (2026-10-04, commit `04c415b`): change [`261004-gan-chua-chia`](../changes/archive/261004-gan-chua-chia/proposal.md) — khoản `income` còn hiệu lực chưa chia (`allocated = 0`; ghi bằng "Gán, để chia sau" / "Ghi, để chia sau", hay chia hỏng) có nút **Chia**: bảng chia thử (`AllocationPreview`, như UC-705) rồi **Thôi** / **Chia và ghi sổ** → `/v1/allocate` cho đúng khoản đó. Cần mạng. Banner "khoản thu chưa chia" ở Hôm nay (UC-702) mở sheet này cho khoản cũ nhất.
- v6 (2026-10-05, commit `d7992d1`): change [`261005-lien-ket-khoan-goc`](../changes/archive/261005-lien-ket-khoan-goc/proposal.md) — xem liên kết hai chiều (bước 2b): khoản hoàn tiền / nhận lại có khoản gốc có dòng **Trả cho** ("khoản chi d/m · X ₫" / "khoản cho vay d/m · X ₫", chạm mở khoản gốc; khoản gốc đã xoá thì thêm " · khoản gốc đã xoá"); khoản chi / cho vay đã được trả về có mục **Đã nhận lại** (tổng · "trả dư Z" / "còn thiếu Z" / "đủ", rồi từng khoản "d/m · {loại}  Y ₫" chạm mở). Dữ liệu đi kèm `GET /v1/transactions/:id` (`link`, `linked_from` — ledger UC-111 bước 3), không thêm request. Sửa khoản gốc thì khoản trả về theo sang khoản mới (ledger UC-102 bước 6). Chủ nhà: "kiểu bill này nhận về, thế bill chi đi là bill nào?"
- v7 (2026-10-06, commit `43e4699`): change [`261006-so-giao-dich`](../changes/archive/261006-so-giao-dich/proposal.md) — sheet này cũng mở từ màn **Sổ giao dịch** (pwa [UC-716](UC-716-so-giao-dich.md)); không đổi gì trong sheet. Sửa khoản chi từ sổ về lại sổ với bộ lọc cũ (`editTx.back = "so"`); xoá / sửa thì danh sách và tổng của sổ tải lại, vị trí cuộn giữ khi sheet đóng.
- v8 (2026-10-07, commit `7424f26`): định danh `WealthBuildingTab` (thay `TichsanTab`) — ADR-92 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Đã có `bootstrap`. Xem được khi mất mạng nếu dòng đã có trong danh sách; Sửa / Xoá / Gán lại / Chia cần mạng.
- Khoản chưa lên sổ (còn trong hàng đợi) không có ở đây — sửa ở card "Chưa lên sổ" bằng Gửi lại / Bỏ hẳn (UC-704).

## Main Flow
1. Chạm một dòng (cả hàng bấm được; ô tên là một nút cho bàn phím) → `openTx(id, dòng?)` → sheet chi tiết vẽ ở khung app, đọc lại `GET /v1/transactions/:id` khi có mạng (ledger UC-111).
2. Sheet hiện bằng tiếng Việt: Loại, Số tiền, Lúc, Danh mục, Trừ ví, Cộng vào ví, Tiền ra từ, Tiền vào, Loại tài sản, Trả nợ cho, Cho ai vay / Ai trả, Người thuê trả, Lần chia (khoản thu: "đã chia vào các ví" / "chưa chia"), Người ghi, Ghi chú, Nguồn ("Ghi tay" / "Từ ngân hàng (SePay)" / "Hệ thống"); dòng đã xoá có chip "đã xoá".
   - 2b. **Liên kết hai chiều** (chỉ khi đọc được từ server — dòng mở từ danh sách khi mất mạng không có):
     - Dòng có `link` (khoản `refund` / `collect` có khoản gốc): hàng **Trả cho** "khoản chi d/m · X ₫" / "khoản cho vay d/m · X ₫" (`linkOriginText`) có mũi tên, chạm → `openTx(khoản gốc)` (sheet đổi sang khoản gốc). Khoản gốc đã bị xoá (`link.status ≠ 'active'` — xoá không gỡ liên kết, ledger UC-102) thì hàng nói thêm " · khoản gốc đã xoá"; chạm vẫn mở, khoản gốc có chip "đã xoá". Nhãn "Trả cho" không bị ép hẹp khi chữ bên phải dài (chữ bên phải xuống dòng).
     - Dòng `spend` / `lend` có `linked_from` không rỗng: hàng **Đã nhận lại** "{tổng} ₫ · trả dư Z ₫" / "· còn thiếu Z ₫" / "· đủ" (chênh = tổng nhận − khoản gốc; `returnedText`), rồi mỗi khoản một hàng "d/m · {Hoàn tiền / Nhận lại tiền cho vay}" — "Y ₫" có mũi tên, chạm → `openTx(khoản đó)`. Chỉ tính khoản còn hiệu lực; gỡ gán / xoá khoản trả về thì nó biến khỏi mục này.
3. Việc làm được theo nguồn (`txActions`):
   - **Ghi tay** (meaning nhập tay): **Sửa** và **Xoá**.
   - **Ghi tay `adjust`** (đếm ví): chỉ **Xoá**, kèm "Khoản điều chỉnh sau đếm ví không sửa được: xoá rồi đếm lại ví."
   - **Từ ngân hàng** (`source='sepay'` hoặc có `log_id`): chỉ **Gán lại**, kèm "Giao dịch ngân hàng không xoá được, chỉ gán lại cho đúng."
   - **Hệ thống**: chỉ xem, kèm lý do (nạp ví của lần chia → "muốn gỡ thì xoá khoản thu đó"; chốt tháng / quyết toán → không sửa, không xoá lẻ).
   - Đã xoá: không còn nút.
   - **Khoản thu chưa chia** (`meaning = 'income'`, còn hiệu lực, `allocated` = 0 — ghi tay hay từ ngân hàng): thêm **Chia** (nút chính, cả bề ngang, trên các nút kia).
4. **Xoá**: bấm Xoá → câu hỏi "Xoá hẳn khoản này?" (khoản thu đã chia: thêm "Lần chia của khoản này cũng được gỡ: các ví trả lại số đã nạp.") với **Thôi** / **Xoá hẳn** → `POST /v1/transactions/:id/void` → tải lại số → toast "Đã xoá 45.000 ₫ Đi chợ. Ăn uống còn 300.000 ₫ tuần này." (khoản thu đã chia: "… Đã gỡ lần chia."); sheet đóng.
5. **Sửa** mở đúng form đã dùng để nhập, điền sẵn từ dòng sổ (`draftFromTx`), lưu bằng `POST /v1/transactions/:id/replace` (ledger UC-102):
   - khoản chi → màn **Nhập** ở chế độ sửa: tiêu đề "Sửa khoản chi", nút **Thôi sửa**, dòng "Đang sửa khoản X ngày d/m", hiện ô ghi chú và ngày, khoản trả nợ hiện "Trả nợ cho {tên}" (giữ `debt_id`), nút "Lưu thay đổi · X ₫"; không hiện hàng đợi / đếm ví / sổ; lưu xong về màn đã mở khoản đó;
   - Sửa một khoản chi / cho vay đang có khoản hoàn tiền / nhận lại trỏ về: server kéo các khoản đó sang khoản mới (ledger UC-102 bước 6), nên khoản mới vẫn có mục **Đã nhận lại**; đổi sang loại khác (vd khoản chi → chuyển nội bộ) hay khoản cho vay sang người khác → server từ chối "Khoản này đang có khoản trả lại trỏ về — gỡ liên kết trước." (câu lỗi hiện như 4a), không lưu.
   - chuyển chỉ giữa hai ví → sheet **Chuyển ngân sách** ("Sửa chuyển ngân sách", giữ giờ ghi);
   - còn lại → sheet **Loại khác** đúng loại, không đổi loại được ("Sửa: thu nhập"…); khoản thu: "Sửa và chia lại" — thay khoản cũ (gỡ lần chia cũ) rồi chia khoản mới như khi ghi (UC-705); chia hỏng thì "Đã sửa khoản thu nhưng chưa chia." và nút "Chia lại".
   - Ô chọn luôn có lựa chọn đang gắn của khoản đó (ví người kia, khoản phải thu / người thuê / nguồn thu đã tắt, khoản chi đang nối của hoàn tiền) — `withChosen`.
   - Không đổi ngày → giữ đúng giờ cũ; đổi ngày → 12:00 ngày đó (hôm nay: giờ thật) — `editedAt`.
   - Toast "Đã sửa thành 120.000 ₫ Xăng xe. Đi lại còn 830.000 ₫ tuần này." (khoản thu: "Đã sửa thành X và chia lại.").
6. **Gán lại**: `POST /v1/logs/transactions/:txId/void` (ingest UC-306) → toast "Đã gỡ gán X. Chọn lại cách gán cho giao dịch này." → màn Gán với log đó chọn sẵn (điện thoại: mở thẳng sheet gán — UC-706 3b).
7. **Chia** (khoản thu chưa chia): `POST /v1/allocate/preview { amount, taxable, at, account_id: counter_account_id, income_stream_id? }` lấy từ chính khoản đó (đúng các trường server dùng khi chia — allocation UC-203) → bảng **Chia thử trước khi ghi** (`AllocationPreview`, như UC-705 bước 4) và hai nút **Thôi** (đóng bảng) / **Chia và ghi sổ** → `POST /v1/allocate { income_tx_id }` (`already_allocated` không coi là lỗi) → tải lại số → toast "Đã chia X." + " Còn N lệnh chuyển tiền cần làm." (`ordersLeft`, như UC-705 bước 6); sheet đóng.

## Alternative Flows
- 1a. Mở từ chi tiết một khoản ở tab Nợ: sheet giao dịch nằm trên sheet chi tiết khoản; sửa khoản chi thì chuyển sang màn Nhập.
- 3a. Không có mạng: nút mờ, "Sửa, xoá giao dịch cần mạng. Khoản chi nhập tay vẫn ghi được khi không có mạng." (khoản thu chưa chia: "Chia, sửa, xoá giao dịch cần mạng. …").
- 4a. Server từ chối (`allocation_settled`, `bank_tx`, `already_void`…) → câu lỗi của server hiện đỏ ngay trong sheet; sổ không đổi.
- 5a. Rời màn Nhập khi đang sửa → bỏ việc sửa; mở lại Nhập là nhập mới.

## Exceptions
- E1. Không tải được dòng (không có mạng, chưa có sẵn) → sheet "Không có mạng." / câu lỗi.

## Acceptance Criteria
### AC-1: Việc làm được theo nguồn
- Given khoản ghi tay mỗi meaning nhập tay, khoản từ ngân hàng, bút toán hệ thống, `adjust`, khoản đã xoá
- When tính việc làm được
- Then ghi tay: Sửa + Xoá; ngân hàng (kể cả chỉ có `log_id`): chỉ Gán lại kèm lý do; hệ thống: chỉ xem kèm lý do; `adjust`: chỉ Xoá; đã xoá: không gì
- Tests: `web/src/lib/transactions.test.ts` › "việc làm được với một giao dịch › ghi tay: sửa và xoá được"; "việc làm được với một giao dịch › từ ngân hàng: không sửa không xoá, chỉ gán lại — kể cả khi chỉ có log_id"; "việc làm được với một giao dịch › hệ thống (chốt tháng, nạp ví của lần chia): chỉ xem, nói vì sao"; "việc làm được với một giao dịch › điều chỉnh sau đếm ví: chỉ xoá; khoản đã xoá: không làm gì nữa"

### AC-2: Sửa mở đúng form đã dùng để nhập
- Given khoản chi, chuyển chỉ giữa hai ví, chuyển nội bộ có tài khoản, cho vay
- When bấm Sửa
- Then lần lượt màn Nhập, Chuyển ngân sách, Loại khác › Chuyển nội bộ, Loại khác › Cho vay
- Tests: `web/src/lib/transactions.test.ts` › "việc làm được với một giao dịch › form sửa: khoản chi ở màn Nhập, chuyển chỉ giữa hai ví ở Chuyển ngân sách, còn lại đúng loại của nó"

### AC-3: Form sửa điền đúng từ dòng sổ
- Given dòng sổ mỗi loại (theo quy ước dấu)
- When điền sẵn form sửa
- Then khoản chi: ví bị trừ, tài khoản tiền ra, khoản nợ, ngày theo giờ VN; thu nhập: tài khoản tiền vào, thuế, nguồn thu, người thuê; hoàn tiền: ví được cộng, tài khoản tiền về, khoản chi gốc; chuyển: nguồn = ví bị trừ, đích = ví được cộng; cho vay / nhận lại: tài khoản theo chiều tiền, khoản phải thu; mua tài sản: loại tài sản
- Tests: `web/src/lib/transactions.test.ts` › "điền sẵn form sửa từ dòng sổ (quy ước dấu) › khoản chi: ví bị trừ thành ví chọn, tài khoản tiền ra, giữ khoản nợ; ngày theo giờ VN"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › thu nhập: tài khoản tiền vào, thuế, nguồn thu, người thuê"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › hoàn tiền: ví được cộng, tài khoản tiền về, nối về khoản chi gốc"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › chuyển nội bộ kèm ví và chuyển ngân sách: nguồn là ví bị trừ, đích là ví được cộng"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › cho vay / nhận lại: tài khoản theo chiều tiền, giữ khoản phải thu; mua tài sản giữ loại tài sản"

### AC-4: Sửa không đổi ngày thì giữ giờ cũ; ô chọn giữ lựa chọn đang gắn
- Given khoản ghi 01:30 giờ VN ngày 21/9
- When lưu sửa không đổi ngày / đổi sang 25/9 / đổi sang hôm nay; và ô chọn ví không có ví đang gắn
- Then giữ đúng giờ cũ / 12:00 ngày 25/9 / giờ thật; ô chọn thêm đúng mục đang gắn (không thêm khi đã có hoặc không dựng được)
- Tests: `web/src/lib/transactions.test.ts` › "điền sẵn form sửa từ dòng sổ (quy ước dấu) › giờ ghi khi sửa: không đổi ngày thì giữ đúng giờ cũ, đổi ngày thì 12:00 ngày đó"; "điền sẵn form sửa từ dòng sổ (quy ước dấu) › danh sách chọn giữ lựa chọn đang gắn dù nó không nằm trong danh sách mặc định"

### AC-5: Câu xác nhận và toast nói hệ quả
- Given xoá khoản chi 45.000 Đi chợ (Ăn uống còn 300.000 tuần này); xoá khoản thu đã chia; sửa thành 120.000 Xăng xe
- When hỏi lại / toast
- Then "Đã xoá 45.000 ₫ Đi chợ. Ăn uống còn 300.000 ₫ tuần này."; khoản thu đã chia: hỏi lại có "Lần chia của khoản này cũng được gỡ", toast "… Đã gỡ lần chia."; "Đã sửa thành 120.000 ₫ Xăng xe. Đi lại còn 830.000 ₫ tuần này."; chuyển chỉ giữa hai ví gọi là "Chuyển ngân sách"
- Tests: `web/src/lib/transactions.test.ts` › "câu xác nhận và toast sau khi sửa / xoá › xoá: nói số tiền, khoản gì, và ví còn bao nhiêu"; "câu xác nhận và toast sau khi sửa / xoá › xoá khoản thu đã chia: hỏi lại có nói lần chia cũng được gỡ, toast nói đã gỡ"; "câu xác nhận và toast sau khi sửa / xoá › sửa: nói số mới và ví còn bao nhiêu; chuyển chỉ giữa hai ví gọi là chuyển ngân sách"

### AC-6: Luồng chạm trên giao diện
- Given màn Nhập trên điện thoại có "Giao dịch gần đây"
- When chạm một khoản chi → Sửa → đổi số và danh mục → Lưu thay đổi; chạm giao dịch SePay → Gán lại
- Then sổ có khoản cũ `void`, khoản mới đúng số, giữ giờ cũ; Gán lại mở sheet gán đúng log
- Tests: ⚠ Chưa có test (đã chạy tay trên `wrangler dev` cục bộ 2026-10-02)

### AC-7: Chia sau một khoản thu chưa chia
- Given khoản thu 250.000 đã gán bằng "Gán, để chia sau" (ví Thu nhập 250.000, "Lần chia: chưa chia")
- When mở chi tiết khoản đó, bấm Chia → bảng chia thử hiện → Chia và ghi sổ
- Then có lần chia của khoản đó; ví Thu nhập giảm đúng 250.000 (về 0); các ví nhận đúng như bảng chia thử; toast "Đã chia 250.000 ₫. Còn N lệnh chuyển tiền cần làm."; banner "khoản thu chưa chia" ở Hôm nay biến mất
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "gán thu nhập, để chia sau (pwa UC-706, ledger UC-103) › gán mà không gọi /v1/allocate: khoản thu nằm ở ví Thu nhập, chưa chia, còn để chi không đổi; chia sau vẫn được" (server: bảng chia thử theo các trường của khoản = lần chia); nút, bảng, toast: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ)

### AC-8: Xem hai chiều: khoản gốc thấy đã nhận lại bao nhiêu, khoản trả về thấy trả cho khoản nào
- Given khoản chi 244.000 Y tế ngày 4/10 có hoàn tiền 250.000 ngày 5/10 nối về nó; cho vay 1.000.000 Chị Lan ngày 15/9 có nhận lại 600.000 ngày 5/10 (gán từ ngân hàng) nối về nó
- When mở chi tiết khoản chi, chạm hàng "5/10 · Hoàn tiền"; mở chi tiết khoản nhận lại, chạm hàng Trả cho
- Then khoản chi: "Đã nhận lại 250.000 ₫ · trả dư 6.000 ₫" và hàng "5/10 · Hoàn tiền 250.000 ₫"; chạm → chi tiết khoản hoàn: "Trả cho khoản chi 4/10 · 244.000 ₫"; khoản nhận lại: "Trả cho khoản cho vay 15/9 · 1.000.000 ₫"; chạm → chi tiết khoản cho vay: "Đã nhận lại 600.000 ₫ · còn thiếu 400.000 ₫"; nhận đủ hai lần 600.000 + 400.000 → "1.000.000 ₫ · đủ"
- Tests: [`web/src/lib/refunds.test.ts`](../../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › chi tiết giao dịch: dòng Trả cho nói loại gốc, ngày, số tiền; Đã nhận lại nói tổng và chênh (trả dư / còn thiếu / đủ)"; [`test/logs.test.ts`](../../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › GET /v1/transactions/:id: khoản gốc kèm các khoản còn hiệu lực đã trả về nó (linked_from), khoản trả về kèm tóm tắt khoản gốc (link)" (server); hàng chạm được trong sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ)

### AC-9: Khoản gốc đã xoá: khoản trả về vẫn nói trả cho khoản nào
- Given cho vay 200.000 Em Hai ngày 25/9 có nhận lại 200.000 trỏ về; khoản cho vay bị xoá
- When mở chi tiết khoản nhận lại, chạm hàng Trả cho
- Then hàng "Trả cho · khoản cho vay 25/9 · 200.000 ₫ · khoản gốc đã xoá" (nhãn "Trả cho" nằm một dòng, chữ bên phải xuống dòng); chạm mở khoản cho vay có chip "đã xoá"; sửa (không xoá) một khoản gốc thì khoản trả về trỏ sang khoản mới, mục Đã nhận lại vẫn hiện ở khoản mới
- Tests: [`web/src/lib/refunds.test.ts`](../../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › khoản gốc đã xoá: liên kết giữ, dòng Trả cho nói khoản gốc đã xoá"; [`test/receivables.test.ts`](../../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › sửa khoản gốc: khoản trả về trỏ sang khoản mới; đổi loại hay đổi người của khoản gốc thì invalid_link, không đổi gì; xoá khoản gốc thì liên kết giữ, khoản gốc hiện đã xoá" (server); hàng trong sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ)

## Traceability
- Code: `web/src/screens/tx-sheet.tsx` › `TxSheet`, `TxSheetBody` (`canAllocate`, `preview`, `allocate`, `linkedFrom`, hàng Trả cho / Đã nhận lại); `web/src/lib/refunds.ts` › `linkOriginText`, `returnedText`; `web/src/lib/types.ts` › `TxRow` (`linked_from`, `link`), `TxLink`, `TxLinkedFrom`; `web/src/lib/transactions.ts` › `txActions`, `txOrigin`, `txLabel`, `editForm`, `draftFromTx`, `editedAt`, `withChosen`, `voidConfirm`, `voidToast`, `editToast`, `txWalletId`; `web/src/lib/pending.ts` › `walletRemain`, `ordersLeft`; `web/src/state/store.ts` › `openTx`, `voidEntry`, `replaceEntry`, `txOpen`, `editTx`; `web/src/screens/entry.tsx` › `Entry`, `EntryForm` (chế độ sửa); `web/src/screens/other-entry-sheet.tsx` › `OtherEntrySheet`, `IncomeForm`, `QueuedForm` (`edit`), `AllocationPreview`; `web/src/screens/budget-sheets.tsx` › `MoveBudgetSheet` (`edit`); `web/src/screens/today-desktop.tsx` › `RecentTransactions`, `TxLine`; `web/src/screens/memo-book.tsx` › `BookDetailSheet` (lần tiền đi / về bấm được); `web/src/screens/wallets.tsx` › `WealthBuildingTab`; `web/src/screens/tenants.tsx` (Đã chuyển); `web/src/screens/assign.tsx` › `Assign`; `web/src/app.tsx`; `web/src/styles.css` › `.tx-row`, `.tx-open`.
- Backend: ledger [UC-102](../ledger/UC-102-huy-giao-dich.md) (`/void`, `/replace`), [UC-111](../ledger/UC-111-so-giao-dich-va-du-lieu-nen.md) (`GET /v1/transactions`, `GET /v1/transactions/:id` kèm `link`, `linked_from`), ingest [UC-306](../ingest/UC-306-ghep-cap-tay-va-go-gan.md) (gỡ gán), allocation [UC-202](../allocation/UC-202-xem-truoc-phuong-an-chia.md), [UC-203](../allocation/UC-203-chia-mot-khoan-thu-nhap.md) (`/v1/allocate/preview`, `/v1/allocate`).

## Divergences & Open Questions
- [OPEN] Không có "Hoàn tác" trên toast sau khi lưu (toast chỉ là chữ); xoá nhầm thì nhập lại.
- [OPEN] Sửa khoản chi ở màn Nhập chọn danh mục mới thì ví tự điền theo người đang sửa (như khi nhập), còn server đổi ví cá nhân theo người ghi khoản cũ — vợ sửa khoản của chồng mà chọn danh mục trỏ ví cá nhân sẽ thấy ví của mình trên form nhưng sổ ghi ví của chồng.
