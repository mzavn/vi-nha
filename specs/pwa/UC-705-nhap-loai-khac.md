# UC-705: Nhập loại khác — thu nhập, hoàn tiền, mua tài sản, cho vay, chuyển nội bộ
- Status: implemented
- BR: BR-02, BR-03, BR-07
- Decisions: D2, D3, D12, D14; DESIGN.md §6 ("Chia và ghi sổ" → toast "Đã chia"), §4 (sheet mở thẳng một việc không hiện `seg` chọn loại); commit `80875be`, `b8e8f0c`; ADR-58 (sổ người thuê ngoài sổ cái), ADR-59 (phần khóa theo nguồn thu chọn tay); ADR-67 (audit 261001 F09, F17, F23); ADR-72 (cho vay / nhận lại tiền cho vay gắn khoản phải thu; nhận lại không phải thu nhập); ADR-84 (mua hộ người khác là Cho vay; trả dư thì phần dư là Thu nhập); ADR-92 (tên trong mã nguồn, dữ liệu, địa chỉ màn bằng tiếng Anh)
- Actor: thành viên đã đăng nhập
- Trigger: nút **Loại khác** (header màn Nhập, mang theo số tiền đang gõ — sheet "Loại khác" chọn được bảy loại); nút chính **Chia tiền** (header Hôm nay — sheet "Ghi thu nhập và chia", chỉ loại Thu nhập); nút **Mua tài sản** (Ví & quỹ › Tích sản — sheet "Mua tài sản", chỉ loại đó)

## History
- v1 (2026-09-22, commit `a756f68`): sheet 5 loại; thu nhập cần mạng (xem trước chia → ghi → chia, "Chia lại" khi chia hỏng); 4 loại còn lại đi qua hàng đợi.
- v2 (2026-09-22, commit `80875be`): lưu vào máy thất bại thì sheet không kẹt ở trạng thái bận, người thử lại được.
- v3 (2026-09-22, commit `b8e8f0c`): mọi ô tài khoản chỉ còn tài khoản không nối feed (D14).
- v4 (2026-09-22, commit `0ee6969`): ≥ 1024px sheet mở thành hộp thoại giữa màn.
- v5 (2026-10-01, commit `034b7ff`): loại thứ sáu **Người thuê chi** (ghi dòng chi hộ vào sổ người thuê, cần mạng); Thu nhập thêm ô **Người thuê trả** và **Nguồn thu**, chia thử theo nguồn; nhãn tầng "giữ riêng" (change `261001-cho-thue-lai`).
- v6 (2026-10-01, commit `39751b8`): ô tài khoản lọc theo **chiều tiền** (ADR-66) — chiều vào (Vào tài khoản, Tiền về, chuyển nội bộ "Vào") chỉ tài khoản không nối SePay; chiều ra (Trả từ, Tiền ra từ, chuyển nội bộ "Từ") thêm tài khoản nối SePay mà SePay không báo tiền ra (`sepayOut = false`).
- v7 (2026-10-01, commit `11c52a0`): sheet mở thẳng một việc (Chia tiền, Mua tài sản) có tiêu đề nói đúng việc đó và **không** hiện hàng chọn loại (F09); chuyển nội bộ: "Vào" trùng "Từ" thì tự đổi sang tài khoản nhập tay đầu tiên khác "Từ" (F17); nhãn tầng "must" → "Must"; ô số trong sheet dùng Inter + `tabular-nums` thay mono (F23) — audit 261001, ADR-67.
- v8 (2026-10-01, commit `2438ac0`): loại thứ bảy **Nhận lại tiền cho vay** (`collect` — tiền vào, không ví, không phải thu nhập); **Cho vay** và **Nhận lại tiền cho vay** có ô chọn khoản phải thu ("Cho ai vay" / "Ai trả", từ `bootstrap.receivables`), gửi `receivable_id`; toast nói còn bao nhiêu chưa trả; câu giải thích của Hoàn tiền chỉ sang Nhận lại tiền cho vay (receivable [UC-1002](../receivable/UC-1002-cho-vay-tra-ho.md), [UC-1003](../receivable/UC-1003-nhan-lai-tien.md), ADR-72).
- v9 (2026-10-03, commit `a8703fd`): ô **Số tiền** / **Số tiền nhận** gõ được phép tính (`100.000+50.000`) — cùng `useAmountField` với màn Nhập (pwa [UC-703](UC-703-nhap-nhanh-khoan-chi.md) v10); dòng "= X ₫" dưới ô, rời ô thì ô thành kết quả; phép tính sai thì số tiền = 0 nên nút chính dừng ở "Nhập số tiền" / tắt.
- v10 (2026-10-03, commit `a18730c`): theo audit 261003: tài khoản mặc định (Thu nhập "Vào tài khoản", chuyển nội bộ "Từ"/"Vào", `defaultBankFor` / `defaultAccountFor`) không bao giờ là **heo đất** (`accounts.locked`, ADR-77) khi còn tài khoản khác — trước đó heo đứng đầu danh sách nên thành mặc định. `bootstrap.accounts` có thêm `locked`.
- v11 (2026-10-03, commit `3bc597c`): theo audit 261003 (M24, mở rộng sang Loại khác): toast chia thu nhập nói tổng lệnh chuyển tiền đang chờ sau khi tải lại số ("Đã chia 12.000.000 ₫. Còn 6 lệnh…" khi trước đó đã có 3 lệnh) — trước đó "Còn N" chỉ đếm lệnh của lần chia này. Dùng chung `ordersLeft` (`web/src/lib/pending.ts`) với màn Gán.
- v12 (2026-10-04, commit `04c415b`): change [`261004-gan-chua-chia`](../changes/archive/261004-gan-chua-chia/proposal.md) — Thu nhập có nút phụ **Ghi, để chia sau** dưới **Chia và ghi sổ** (chỉ khi ghi mới, chưa ghi lần nào trong sheet): ghi khoản thu, không gọi `/v1/allocate`; toast chung với màn Gán (`deferredIncomeToast`). Dòng giải thích dưới chip loại của màn Gán (UC-706 bước 5c) **không** dùng ở đây: nhóm nút loại của Loại khác là một bộ khác (trộn tiền vào/ra, có Mua tài sản, Người thuê chi) nên không chia chung bảng `ASSIGN_CHOICES`.
- v13 (2026-10-04, commit `c9c6acb`): change [`261004-gan-tham-chieu`](../changes/archive/261004-gan-tham-chieu/proposal.md) — Hoàn tiền, Cho vay, Nhận lại tiền cho vay dùng chung hai ô với màn Gán (`web/src/screens/ref-pickers.tsx`, UC-706 bước 5b, 5d): ô "Hoàn về khoản chi" (100 giao dịch gần nhất lọc `spend`, theo thời gian) thành **Trả lại cho khoản chi** (khoản chi 30 ngày gần nhất, gần số tiền nhất lên trước, tối đa 20, mục đầu "không chỉ khoản nào", dòng chênh dưới ô); ô **Cho ai vay** / **Ai trả** luôn hiện kèm **+ Người mới…** và dòng còn nợ trước / sau — bỏ câu "Chưa có khoản phải thu — thêm ở Ví & quỹ › Nợ".
- v14 (2026-10-05, commit `d7992d1`): change [`261005-lien-ket-khoan-goc`](../changes/archive/261005-lien-ket-khoan-goc/proposal.md) — Nhận lại tiền cho vay có ô tuỳ chọn **Trả cho khoản cho vay** ngay dưới Ai trả (cùng component với màn Gán, UC-706 bước 5e — `LinkSourcePicker`): chọn thì Ai trả theo người của khoản đó, gửi `link_id`, dưới ô "Cho vay X · trả lại Y · còn Z / trả dư Z"; đổi người ở Ai trả là bỏ khoản đã chọn. Khoản gốc đã chọn gắn với loại lúc chọn: đổi loại trong cùng sheet (Hoàn tiền ↔ Nhận lại) thì loại kia không thấy và không gửi `link_id` đó; quay lại đúng loại thì vẫn còn. Chưa chọn khoản gốc thì dưới ô có gợi ý "Khoản gốc còn chờ gán? Gán nó trước rồi quay lại.".
- v15 (2026-10-05, commit `ef23fc9`): bỏ ô **Danh mục** ở dòng **Cho vay** — chủ nhà: "cho vay có cần Danh mục không?". Không cần: cho vay không trừ ví, không vào báo cáo chi theo danh mục (`v_spend_by_category` chỉ tính `spend`/`refund`); server vẫn tự gắn `cho-vay` (ledger UC-101, `LEND_CATEGORY_ID`). Đổi chip sang Cho vay thì xoá danh mục và ví đã chọn.
- v16 (2026-10-05, commit `6f5e77a`): theo lỗi chủ nhà báo ở màn Gán (UC-706 v25 — ô Ai trả chọn sẵn "nhà bạn · đã trả đủ", tên người mới gõ mà chưa bấm Thêm người thì mất): cùng component, nên ở đây Cho ai vay / Ai trả chỉ chọn sẵn người **còn nợ** (không ai còn nợ thì "không gắn khoản phải thu"); ô **Tên người mới** rời ô là thêm luôn; đang hỏi tên thì nút chính tắt, nói "Bấm Thêm người trước khi ghi". AC-15 sửa, AC-21.
- v17 (2026-10-05, commit `b9702b4`): nhãn và danh sách ô Ai trả / Cho ai vay — chủ nhà: "sao C Hoa đã trả đủ? … nhà bạn là xong hết rồi, không nên xuất hiện ở đây". `bookRefLabel`: còn nợ → "{tên} · còn X", trả dư → "{tên} · trả dư X", 0 → chỉ "{tên}" (người mới chưa nợ gì không thành "đã trả đủ"). `receivableOptions`: Nhận lại tiền chỉ liệt kê người **còn nợ** (> 0) cùng người đang chọn; Cho vay liệt kê mọi người.
- v18 (2026-10-05, commit `ea0d365`): ADR-84 (chủ nhà: "nó là 2 nghiệp vụ khác nhau mà? … đây là tôi mua hộ cho bà Hoa, sau đó bà chị trả lại tiền cho tôi.") — gợi ý khi Nhận lại vượt số còn nợ thôi khuyên Hoàn tiền cho mua hộ: nay "Trả dư X? Ghi Nhận lại đúng số còn nợ, phần dư ghi riêng một khoản Thu nhập. Chia bill nhà mình có phần (đã ghi Chi tiêu cả bill) thì chọn Hoàn tiền." (`overpaidHint(X, false)` — sheet này không tách dòng; màn Gán nói "Bấm Tách thêm dòng", UC-706 v28). AC-19 sửa theo.
- v19 (2026-10-06, commit `9c265ee`): change [`261006-tai-khoan-phao`](../changes/archive/261006-tai-khoan-phao/proposal.md), ADR-88 — **Chuyển nội bộ** từ tài khoản thường vào tài khoản Tích sản (heo, phao dự phòng, sổ tiết kiệm) mà không bật "Chuyển cả tiền giữa hai ví": dòng nhắc cuối sheet thành "Tiền vào {tên} là Tích sản: ghi xong, ví Có thì tốt chuyển sang Tích sản (như bỏ heo đất)." (`tichsanMoveHint`); server tự chuyển ví (ledger UC-101 AC-24) — khoản chờ đồng bộ chưa trừ tạm Có thì tốt. Tài khoản mặc định (`defaultAccountFor`, `defaultBankFor`, ô "Vào" khi trùng "Từ") không lấy tài khoản Tích sản nào (trước chỉ tránh heo). Chủ nhà: "Tiền vào phao tự vào Tích sản (như heo đất)". AC-22.
- v20 (2026-10-07, commit `7424f26`): vai tài khoản phao dự phòng lưu là `buffer` (thay `phao`) ở AC-22 — ADR-92 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Có `bootstrap`. Thu nhập và Người thuê chi cần mạng; năm loại còn lại không cần.

## Main Flow — Thu nhập (cần mạng)
1. Sheet "Loại khác" (mở từ màn Nhập), nhóm nút loại: Thu nhập · Hoàn tiền · Mua tài sản · Cho vay · Nhận lại tiền cho vay · Chuyển nội bộ · Người thuê chi. Mở từ **Chia tiền** ở Hôm nay thì sheet tên "Ghi thu nhập và chia", **không** có nhóm nút loại (chỉ Thu nhập); mở từ **Mua tài sản** thì tên "Mua tài sản", cũng không có nhóm nút loại.
2. Ô: **Số tiền nhận**; **Vào tài khoản** (mặc định ngân hàng của người nhập, không có thì ngân hàng đầu tiên; chiều vào: `manualAccounts(accounts, "in")` — chỉ tài khoản không nối SePay); **Người thuê trả** (chỉ khi có mạng và có người thuê đang ở — `GET /v1/rental`; mặc định "Không phải người thuê"); **Nguồn thu** (chỉ khi có mạng và có nguồn đang dùng — `GET /v1/settings` › `incomeStreams`; mục trống là "Mặc định (luật % chung)", hoặc "Theo cấu hình cho thuê" khi đã chọn người thuê); **Thuế**: "Đã khấu trừ tại nguồn" / "Chưa — để riêng thuế"; ghi chú; ngày (≤ hôm nay).
3. Có số tiền và có mạng → sau 350 ms kể từ lần sửa cuối gọi allocation › xem trước chia (`POST /v1/allocate/preview { amount, taxable, at, account_id, income_stream_id? }`). `income_stream_id` = nguồn đã chọn; chọn người thuê mà để trống nguồn thì dùng nguồn cho thuê của cấu hình (`rental.incomeStreamId`), đúng như server sẽ tự gắn.
4. Bảng **Chia thử trước khi ghi**: mỗi ví nhận (tên, nhãn tầng "khóa"/"giữ riêng"/"hưởng thụ"/"Must"/"phần còn lại"), **"đã bù X cho tháng trước"** khi `deficitCovered[ví] > 0` (D3), số tiền; dòng Tổng. Tổng ≠ số nhận → "Tổng chia khác số tiền nhận X.". Có ví chưa tới sàn → banner "Chưa tới sàn: {ví}. Ghi đúng như vậy, không vay phần đã khóa.". Ghi chú lệnh chuyển: "Không sinh lệnh chuyển tiền: các ví nhận tiền nằm cùng tài khoản." hoặc "Sau khi ghi sẽ sinh N lệnh chuyển tiền: A → B X; … Phân bổ trong app chỉ là ảo cho tới khi tiền đi thật."
5. Nút chính **Chia và ghi sổ** (chỉ bật khi có mạng, có bảng chia thử, có tài khoản) → `POST /v1/transactions { meaning: "income", client_id, …, income_stream_id?, tenant_id? }` (một `client_id` cố định cho cả vòng đời sheet; chỉ gửi trường đã chọn) → `POST /v1/allocate { income_tx_id }`.
   - 5a. Nút phụ **Ghi, để chia sau** (chỉ khi ghi mới — không có khi sửa, không có sau khi đã ghi mà chia hỏng; bật khi có mạng, có số tiền, có tài khoản, **không** cần bảng chia thử) → cùng `POST /v1/transactions` nhưng **không** gọi `/v1/allocate`: khoản thu nằm ở ví Thu nhập, chưa chia. Tải lại số, toast "Đã ghi X ₫ vào ví Thu nhập, chưa chia. Chia ở Giao dịch gần đây › khoản này › Chia." (`deferredIncomeToast`, `web/src/lib/splits.ts`); đóng sheet. Chia sau ở sheet chi tiết giao dịch (UC-715) hoặc banner Hôm nay (UC-702).
6. Tải lại số, rồi toast "Đã chia X." (sửa: "Đã sửa thành X và chia lại.") + " Còn N lệnh chuyển tiền cần làm." với N là **tổng** lệnh đang chờ (`snapshot.attention.transferOrdersPending`, như màn Gán UC-706 bước 10 — `ordersLeft`); tải lại không được thì " Có thêm N lệnh chuyển tiền cần làm." theo lệnh lần chia này vừa sinh; đóng sheet.

## Main Flow — Năm loại qua hàng đợi
1. Ô chung: **Số tiền** (gõ được phép tính như UC-703 bước 2: dòng "= X ₫" dưới ô, sai thì dòng đỏ và số tiền = 0), ghi chú (cho vay không gắn khoản phải thu: gợi ý "cho ai vay"), ngày (≤ hôm nay), câu giải thích cuối sheet theo loại.
2. Theo loại (ô tài khoản theo chiều tiền, ADR-66: **Tiền về**, **Tiền vào** và chuyển nội bộ **Vào** dùng `manualAccounts(accounts, "in")` — không nối SePay; **Trả từ**, **Tiền ra từ**, chuyển nội bộ **Từ** dùng `manualAccounts(accounts, "out")` — không nối SePay hoặc SePay không báo tiền ra; mặc định `defaultAccountFor(boot, người nhập, chiều)`):
   - **Hoàn tiền**: (có mạng) **Trả lại cho khoản chi** — cùng ô với màn Gán (UC-706 bước 5d, `LinkSourcePicker kind="spend"`; số tiền để xếp là ô Số tiền của sheet): chọn thì tự điền danh mục và ví của khoản gốc (`walletOfMember`), gửi `link_id`, dưới ô dòng chênh; chưa chọn thì gợi ý "Khoản gốc còn chờ gán? Gán nó trước rồi quay lại."; sửa khoản đã nối mà khoản gốc không còn trong danh sách thì mục "khoản chi đang nối" giữ `link_id` cũ; danh mục (không bắt buộc, chọn thì tự điền ví theo danh mục); **Ví nhận lại**; **Tiền về** (tài khoản). Câu giải thích kết bằng "Tiền cho vay được trả lại thì chọn Nhận lại tiền cho vay."
   - **Mua tài sản**: loại tài sản (Chứng chỉ quỹ · Cổ phiếu · Vàng · Bất động sản; mặc định Chứng chỉ quỹ); **Trả từ** (được chọn "không qua tài khoản nào").
   - **Cho vay**: **Cho ai vay** — cùng ô với màn Gán (UC-706 bước 5b, `ReceivablePicker`: luôn hiện, mục đầu "không gắn khoản phải thu", mỗi khoản `bookRefLabel` "{tên} · còn X" / "{tên} · trả dư X" / "{tên}" khi 0; ô Ai trả chỉ có người còn nợ cùng người đang chọn (`receivableOptions`), mục cuối **+ Người mới…** cần mạng — rời ô tên đã gõ là thêm luôn, Huỷ thì không; chọn sẵn khoản còn phải thu nhiều nhất, `defaultReceivableId` — không ai còn nợ thì không chọn ai; đã chọn thì dòng "{tên} còn nợ X · sau khoản này còn Y"); **Tiền ra từ** (bắt buộc); không có ô danh mục (server tự gắn `lending`). Giải thích: "Cho vay không trừ ví nào: tiền rời tài khoản nhưng vẫn là tiền của nhà. Gắn vào khoản phải thu để biết người đó còn nợ mình bao nhiêu."
   - **Nhận lại tiền cho vay** (`collect`): **Ai trả** (cùng ô như Cho vay; nhận lại vượt số còn nợ thì thêm gợi ý "Trả dư X? Ghi Nhận lại đúng số còn nợ, phần dư ghi riêng một khoản Thu nhập. Chia bill nhà mình có phần (đã ghi Chi tiêu cả bill) thì chọn Hoàn tiền." — `overpaidHint`, X là phần dư của riêng lần trả này, ADR-84); (có mạng) **Trả cho khoản cho vay** — cùng ô với màn Gán (UC-706 bước 5e, `LinkSourcePicker kind="lend"`): khoản của người đang chọn ở Ai trả lên trước; chọn thì Ai trả theo người của khoản đó, gửi `link_id`, dưới ô "Cho vay X · trả lại Y · còn Z / trả dư Z / trả đủ"; đổi người ở Ai trả là bỏ khoản đã chọn; sửa khoản đã nối mà khoản gốc không còn trong danh sách thì mục "khoản cho vay đang nối" giữ `link_id` cũ; **Tiền vào** (bắt buộc, chiều vào). Không ví, không danh mục. Giải thích: "Tiền cho vay được trả lại, không phải thu nhập: không chia vào ví, không đụng ví nào. Chỉ tài khoản nhận tăng, số phải thu giảm."
   - Khoản gốc đã chọn (`link_id`) gắn với loại lúc chọn: đổi loại trong cùng sheet thì không gửi nữa (Hoàn tiền chỉ gửi khoản chi, Nhận lại chỉ gửi khoản cho vay).
   - **Chuyển nội bộ**: **Từ** / **Vào** (mặc định ngân hàng của người nhập → tiền mặt của người nhập; khi chọn loại này mà **Vào** trùng **Từ** thì **Vào** tự đổi sang tài khoản nhập tay chiều vào đầu tiên khác **Từ** — mở ra không báo sẵn "Hai tài khoản phải khác nhau"); ☐ "Chuyển cả tiền giữa hai ví" → **Ví bớt** / **Ví thêm**.
3. Nút chính nói bước còn thiếu, theo thứ tự: "Nhập số tiền" · "Chọn ví nhận lại" (hoàn tiền không có ví và không nối khoản gốc) · "Chọn hai tài khoản" · "Hai tài khoản phải khác nhau" · "Chọn hai ví khác nhau" · "Chọn tài khoản" (cho vay, nhận lại) · "Bấm Thêm người trước khi ghi" (ô Tên người mới còn mở); đủ thì "Ghi hoàn tiền" / "Ghi mua tài sản" / "Ghi cho vay" / "Ghi nhận lại tiền" / "Ghi chuyển nội bộ".
4. Bấm → `saveEntry` (UC-703 bước 5–7, UC-704; cho vay / nhận lại gửi `receivable_id` khi đã chọn khoản): toast "Đã ghi {hoàn tiền: câu phản hồi ngân sách | khác: "khoản cho vay" / "khoản nhận lại" / "chuyển nội bộ" / "mua tài sản"}[, chờ đồng bộ]." rồi đóng sheet; cho vay / nhận lại có khoản phải thu thì toast thay bằng "Đã ghi cho {tên} vay thêm X. Còn Y chưa trả." (`lendToast`) / "Đã nhận lại X từ {tên}. Còn Y chưa trả." hoặc "… Đã trả đủ." (`collectToast`).

## Main Flow — Người thuê chi (cần mạng)
1. Tải `GET /v1/rental` (rental UC-801). Ô: **Ai chi** (người thuê đang ở, mặc định người đầu tiên); **Số tiền** (mang số đang gõ ở màn Nhập); **Chi cho** (chỉ danh mục chi chung của cấu hình, mặc định danh mục đầu); **Ghi chú** ("đi chợ"); **Ngày** (≤ hôm nay). Giải thích: "Người thuê tự trả bằng tiền của mình một khoản chi chung: không trừ ví nào của nhà, cộng vào tổng chi chung tháng và trừ vào nợ của người thuê."
2. Kiểm ở máy (`linePayload`, kind `paid_for_us`): số tiền nguyên dương ("Nhập số tiền."), danh mục thuộc danh mục chi chung ("Chọn một danh mục chi chung.").
3. Nút chính "Ghi {tên} chi X" (tắt khi offline, đang gửi, chưa có người thuê hoặc chưa có số) → `POST /v1/rental/tenants/:id/lines { kind: "paid_for_us", amount (dương), category_id, name?, at, client_id }` (rental UC-802; một `client_id` cho cả vòng đời sheet) → toast "Đã ghi {tên} chi X. Trừ vào nợ của {tên}." → đóng sheet. Không đi qua hàng đợi, không đụng ví hay tài khoản nào.

## Alternative Flows
- T5a. Ghi khoản thu được nhưng chia lỗi → giữ `tx.id`, lỗi "Đã ghi khoản thu nhưng chưa chia. {lý do}", nút đổi thành **Chia lại**: bấm lại chỉ gọi `/v1/allocate`, **không** ghi thêm khoản thu.
- T5b. `/v1/allocate` trả `already_allocated` → coi như đã chia, báo thành công.
- T3a. Offline: không gọi xem trước, không có ô Người thuê trả / Nguồn thu, nút chính tắt, kèm "Chia tiền cần mạng. Khoản chi nhập tay vẫn ghi được khi không có mạng."
- T3b. Xem trước lỗi → câu lỗi dưới bảng.
- Q2a. Hoàn tiền / Nhận lại khi offline: không có ô "Trả lại cho khoản chi" / "Trả cho khoản cho vay", vẫn ghi được qua hàng đợi. Cho vay / Nhận lại khi offline: mục **+ Người mới…** tắt ("+ Người mới… (cần mạng)"), các khoản đã có vẫn chọn được.
- Q4a. `saveEntry` trả `false` (không ghi được vào máy) → sheet ở lại, nút bấm lại được.
- P1a. Có mạng nhưng chưa có người thuê đang ở → thay form bằng "Chưa có người thuê. Thêm ở Cài đặt › Cho thuê."
- P3a. Offline → nút chính tắt kèm "Ghi sổ người thuê cần mạng. Khoản chi nhập tay vẫn ghi được khi không có mạng."; lỗi server (vd `not_shared_category`, `tenant_inactive`) → câu lỗi trên nút, bấm lại được với cùng `client_id`.

## Exceptions
- E1. Không còn tài khoản nhập tay → ô tài khoản thay bằng "Mọi tài khoản đã nối ngân hàng: khoản này sẽ tự về, gán nó ở màn Gán." (trừ Mua tài sản, vì cho phép "không qua tài khoản nào").
- E2. Server từ chối khoản qua hàng đợi → xem UC-704 (nằm lại `rejected`).

## Acceptance Criteria
### AC-1: Thu nhập chỉ ghi được khi đã xem bảng chia thử
- Given có mạng, nhập 30.000.000 ₫, chưa khấu trừ thuế
- When bảng chia thử hiện
- Then nút "Chia và ghi sổ" mới bật; trước đó và khi offline nút tắt
- Tests: ⚠ Chưa có test

### AC-2: "Đã bù X" hiện ở bảng chia thử
- Given một ví tiêu lố tháng trước, bản xem trước trả `deficitCovered[ví] = 150.000`
- When bảng chia thử hiện
- Then dòng ví đó có "đã bù 150.000 ₫ cho tháng trước"
- Tests: ⚠ Chưa có test

### AC-3: Chia lỗi không ghi khoản thu hai lần
- Given khoản thu đã ghi, `/v1/allocate` lỗi
- When bấm "Chia lại"
- Then chỉ gọi `/v1/allocate` với `income_tx_id` cũ; không có `POST /v1/transactions` thứ hai; nếu server trả `already_allocated` thì báo đã chia
- Tests: ⚠ Chưa có test

### AC-4: Chuyển nội bộ phải là hai tài khoản khác nhau
- Given Từ = Vào
- When xem nút chính
- Then nút ghi "Hai tài khoản phải khác nhau" và bị tắt
- Tests: ⚠ Chưa có test

### AC-5: Hoàn tiền trả lại ví đã trừ
- Given hàng đợi có một khoản hoàn tiền 100.000 ₫ vào ví Ăn uống
- When tính số hiển thị
- Then ví Ăn uống cộng lại số dư và giảm đã chi, khớp `buildSnapshot`
- Tests: `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví nhận phần dư (không có mức tuần) cũng khớp công thức chia theo tuần còn lại"

### AC-6: Bốn loại ghi được khi offline
- Given máy offline
- When ghi một khoản cho vay
- Then khoản vào hàng đợi, toast "Đã ghi khoản cho vay, chờ đồng bộ."
- Tests: ⚠ Chưa có test

### AC-7: Tài khoản thu nhập mặc định là ngân hàng của người nhập
- Given Vợ đăng nhập, hộ có ngân hàng của cả hai
- When mở loại Thu nhập
- Then "Vào tài khoản" mặc định là ngân hàng của Vợ; không rõ người thì ngân hàng đầu tiên
- Tests: `web/src/lib/categories.test.ts` › "tự điền ví và tài khoản › tài khoản nhận thu nhập mặc định là ngân hàng của người đang nhập"

### AC-8: Nguồn thu chọn tay quyết định phần khóa
- Given nguồn "Lương vợ" khóa Tích sản 45%
- When nhập Thu nhập 11.000.000, chọn Nguồn thu = Lương vợ
- Then bảng chia thử và lần chia thật cùng đưa 4.950.000 vào Tích sản trước; không chọn nguồn thì chia theo luật % chung như cũ; nguồn gắn vào khoản không phải thu nhập bị từ chối (`income_only`)
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối"; `test/allocation.test.ts` › "chia theo nguồn thu › stream null y hệt không khai báo nguồn"; ô chọn: ⚠ Chưa có test

### AC-9: Người thuê trả mà không chọn nguồn → nguồn cho thuê
- Given chọn Người thuê trả = An, Nguồn thu để "Theo cấu hình cho thuê", số tiền 5.191.667
- When xem chia thử rồi Chia và ghi sổ
- Then chia thử gửi `income_stream_id = rental` (cấu hình); khoản thu được ghi với `tenant_id = an`, `income_stream_id = rental` và chia trọn 5.191.667 vào "Thu cho thuê"
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; chia thử theo nguồn cấu hình: ⚠ Chưa có test

### AC-10: Người thuê chi gửi số dương, chỉ danh mục chi chung
- Given An chi 200.000 đi chợ
- When bấm "Ghi An chi 200.000 ₫"
- Then gửi `kind: "paid_for_us", amount: 200000` với danh mục chi chung; danh mục ngoài danh sách chi chung bị chặn ở máy và ở server; gửi lại cùng `client_id` không ghi hai lần
- Tests: `web/src/lib/rental.test.ts` › "dòng ghi tay › người thuê chi hộ: gửi số dương, phải thuộc danh mục chi chung"; `test/rental.test.ts` › "/v1/rental › dòng ghi tay idempotent theo client_id; chi hộ chỉ nhận danh mục chi chung"

### AC-11: Người thuê chi cần mạng
- Given máy offline
- When mở loại Người thuê chi
- Then nút chính tắt kèm "Ghi sổ người thuê cần mạng. …"; không có gì vào hàng đợi
- Tests: ⚠ Chưa có test

### AC-12: Ô tài khoản theo chiều tiền (ADR-66)
- Given MB nối SePay chỉ báo tiền vào, Sacombank nối SePay báo cả tiền ra, BIDV ghi tay
- When mở Thu nhập / Hoàn tiền / chuyển nội bộ "Vào" (chiều vào) và Cho vay / Mua tài sản / chuyển nội bộ "Từ" (chiều ra)
- Then chiều vào chỉ có BIDV; chiều ra có MB và BIDV
- Tests: `web/src/lib/categories.test.ts` › "tài khoản nhập tay được › chiều tiền SePay báo về thì ẩn: tiền vào ẩn mọi tài khoản đã nối; tiền ra chỉ ẩn tài khoản SePay báo cả tiền ra" (hàm lọc; màn hình chỉ gọi đúng chiều — không có test UI)

### AC-13: Sheet mở thẳng một việc không hỏi lại loại
- Given đang ở Hôm nay
- When bấm **Chia tiền**
- Then sheet tên "Ghi thu nhập và chia", không có nhóm nút loại, form Thu nhập hiện ngay; mở từ màn Nhập thì vẫn là "Loại khác" với bảy loại
- Tests: ⚠ Chưa có test

### AC-14: Chuyển nội bộ không mặc định hai tài khoản trùng nhau
- Given tài khoản mặc định chiều ra và chiều vào của người nhập là cùng một tài khoản (vd Tiền mặt)
- When chọn loại Chuyển nội bộ
- Then **Vào** là tài khoản nhập tay đầu tiên khác **Từ**; nút chính không báo "Hai tài khoản phải khác nhau"
- Tests: ⚠ Chưa có test

### AC-15: Cho vay / Nhận lại tiền cho vay gắn khoản phải thu, không mang ví
- Given `bootstrap.receivables` có Em Trai còn nợ
- When chọn Nhận lại tiền cho vay 2.000.000, Ai trả = Em Trai, Tiền vào = tiền mặt, ghi chú " trả đợt 1 "; thiếu số tiền / tài khoản
- Then thân `{ meaning: "collect", amount: 2000000, at, client_id, account_id, receivable_id: "em-trai", note: "trả đợt 1" }` — không có `wallet_id`; thiếu thì chặn "Nhập số tiền." / "Chọn tài khoản."; ô chọn chọn sẵn khoản còn phải thu nhiều nhất (hoặc khoản được mở từ); không ai còn nợ (mọi khoản ≤ 0) hay `bootstrap` cũ không có `receivables` thì không chọn gì
- Tests: [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › thân giao dịch cho vay / nhận lại: cần số tiền và tài khoản, gắn khoản phải thu nếu có, không mang ví"; [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › chọn sẵn khoản được mở từ, không thì khoản còn phải thu nhiều nhất; ai cũng đã trả đủ thì không chọn ai; bootstrap cũ không có trường thì null"; sheet: ⚠ Chưa có test

### AC-16: Toast và nhãn ô chọn nói còn bao nhiêu chưa trả
- Given Em Trai còn 2.000.000
- When nhận lại 500.000; nhận đủ hoặc dư; xem nhãn ô chọn của khoản còn nợ và khoản ≤ 0
- Then "Đã nhận lại 500.000 ₫ từ Em Trai. Còn 1.500.000 ₫ chưa trả."; "… Đã trả đủ."; nhãn "{tên} · còn X", "{tên} · trả dư X" và chỉ "{tên}" khi 0
- Tests: [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › toast sau khi nhận lại: còn bao nhiêu chưa trả, hoặc đã trả đủ (trả dư cũng là đủ)"; [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › nhãn ô chọn khoản: còn bao nhiêu; trả dư bao nhiêu; 0 thì chỉ tên (người mới chưa nợ gì không thành 'đã trả đủ')"

### AC-17: Ô số tiền trong sheet gõ được phép tính
- Given sheet Loại khác, loại Thu nhập
- When gõ "100.000+50.000" vào Số tiền nhận rồi rời ô; sau đó gõ thêm "-200000"
- Then dòng dưới ô "= 150.000 ₫", rời ô thì ô hiện "150.000"; "150.000-200000" thì dòng đỏ "Sai: kết quả phải trên 0, tối đa 1.000 tỷ", ô viền đỏ (`aria-invalid`), nút "Chia và ghi sổ" tắt
- Tests: `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › cộng trừ nhân cùng đơn vị đồng như ô hiện, nhân trước cộng sau"; "phép tính trong ô số tiền › không ra số tiền hợp lệ thì null: kết quả ≤ 0, vượt trần, hai dấu liền nhau, ký tự lạ"; sheet: ⚠ Chưa có test

### AC-18: Ghi thu nhập, để chia sau
- Given sheet Loại khác, loại Thu nhập, Số tiền nhận 1.200.000, Vào tài khoản Tiền mặt (chồng)
- When bấm "Ghi, để chia sau"
- Then có giao dịch `income` 1.200.000 ở ví Thu nhập, chưa có lần chia; toast "Đã ghi 1.200.000 ₫ vào ví Thu nhập, chưa chia. Chia ở Giao dịch gần đây › khoản này › Chia."; Hôm nay có banner / hàng "khoản thu chưa chia" (UC-702 AC-11)
- Tests: `web/src/lib/splits.test.ts` › "gán thu nhập, để chia sau › toast nói tiền nằm ở ví Thu nhập, chưa chia, và chia ở đâu"; nút: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ)

### AC-19: Hoàn tiền, Cho vay, Nhận lại dùng chung ô chọn với màn Gán
- Given khoản chi 244.000 Thuốc thang ngày 1/10; sheet Loại khác, có mạng
- When chọn Hoàn tiền, Số tiền 250.000, Trả lại cho khoản chi = khoản 244.000; rồi chọn Nhận lại tiền cho vay, Ai trả = + Người mới… "Anh Tư", Tiền vào = Tiền mặt (vợ), bấm "Ghi nhận lại tiền"
- Then Hoàn tiền: Danh mục Thuốc thang, Ví nhận lại Có thì tốt, dòng "Khoản chi 244.000 ₫ · trả lại 250.000 ₫ · chênh +6.000 ₫ (nằm lại trong danh mục Thuốc thang)"; Nhận lại: khoản phải thu `anh-tu` số 0 được tạo và chọn, dòng "Anh Tư còn nợ 0 ₫ · sau khoản này trả dư 250.000 ₫" kèm "Trả dư 250.000 ₫? Ghi Nhận lại đúng số còn nợ, phần dư ghi riêng một khoản Thu nhập. Chia bill nhà mình có phần (đã ghi Chi tiêu cả bill) thì chọn Hoàn tiền."; sau đồng bộ có `collect` 250.000 `receivable_id = anh-tu`, `counter_account_id = cash-wife`, Anh Tư còn −250.000
- Tests: [`web/src/lib/refunds.test.ts`](../../web/src/lib/refunds.test.ts) › "trả lại cho khoản chi › dòng chênh: trả hơn +, trả kém −, phần chênh nằm lại trong danh mục; trả đúng thì trả đủ"; [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › dòng dưới ô Ai trả / Cho ai vay: còn nợ trước và sau khoản này; nhận lại vượt số còn nợ thì báo phần dư của lần trả này"; [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › trả dư: nhận lại đúng số còn nợ, phần dư là Thu nhập (màn Gán tách dòng, Loại khác ghi riêng); Hoàn tiền chỉ cho chia bill có phần mình (ADR-84)"; sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ)

### AC-20: Nhận lại tiền cho vay chỉ đúng khoản cho vay gốc
- Given Chị Lan còn nợ 400.000 (cho vay 1.000.000 ngày 15/9 "mượn sửa xe", đã nhận lại 600.000); sheet Loại khác, có mạng
- When chọn Nhận lại tiền cho vay; rồi Trả cho khoản cho vay = "15/9 · Chị Lan · mượn sửa xe · 1.000.000 ₫"; rồi đổi sang Hoàn tiền; rồi quay lại Nhận lại tiền cho vay
- Then trước khi chọn: Ai trả = Chị Lan, dưới ô Trả cho khoản cho vay "Khoản gốc còn chờ gán? Gán nó trước rồi quay lại."; chọn rồi: Ai trả giữ Chị Lan, dòng "Cho vay 1.000.000 ₫ · trả lại Y · còn Z"; ghi gửi `link_id` = khoản cho vay; sang Hoàn tiền thì ô Trả lại cho khoản chi ở "không chỉ khoản nào" (khoản cho vay không bị gửi kèm hoàn tiền); quay lại Nhận lại thì ô vẫn là khoản cho vay đã chọn
- Tests: [`web/src/lib/refunds.test.ts`](../../web/src/lib/refunds.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › dòng dưới ô Trả cho khoản cho vay: cho vay X · trả lại Y · còn Z, trả dư Z, hoặc trả đủ"; [`test/receivables.test.ts`](../../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › nhận lại có link_id về khoản cho vay: không chọn người thì lấy người của khoản cho vay; khác người, trỏ khoản chi hay khoản đã huỷ → invalid_link; sửa giữ liên kết" (server); sheet: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ — gồm đổi loại qua lại)

### AC-21: Tên người mới chưa bấm Thêm người không bị mất, không ghi khi chưa có người
- Given mọi khoản phải thu ≤ 0; sheet Loại khác, có mạng
- When chọn Nhận lại tiền cho vay, Số tiền 100.000; Ai trả = + Người mới…, gõ "Chú Tám", chưa bấm Thêm người; rồi chạm nút chính
- Then Ai trả lúc mở là "không gắn khoản phải thu"; khi ô tên còn mở nút chính tắt, ghi "Bấm Thêm người trước khi ghi"; chạm nút làm ô tên mất focus → khoản phải thu `chu-tam` số 0 được tạo và chọn, nút thành "Ghi nhận lại tiền"
- Tests: ⚠ Chưa có test (repo chưa có test giao diện; đã xem tận mắt ở 390px, `wrangler dev` cục bộ)

### AC-22: Chuyển nội bộ vào tài khoản Tích sản nhắc tiền thành Tích sản; tài khoản Tích sản không là mặc định (ADR-88)
- Given phao "MB tiết kiệm (vợ)" (`role: buffer`), sổ "Sổ 6 tháng", heo; Loại khác › Chuyển nội bộ, không bật "Chuyển cả tiền giữa hai ví"
- When Từ "Tiền mặt (vợ)" Vào phao; Từ phao Vào sổ; Từ sổ Vào tiền mặt; Từ tiền mặt Vào tiền mặt người kia; mở sheet với danh sách có heo, phao đứng trước tài khoản thường
- Then lần đầu dòng nhắc "Tiền vào MB tiết kiệm (vợ) là Tích sản: ghi xong, ví Có thì tốt chuyển sang Tích sản (như bỏ heo đất)."; ba lần sau giữ câu "Rút tiền mặt, nạp ví điện tử: tiền chỉ đổi chỗ, ví không bị trừ."; tài khoản mặc định là tài khoản thường đầu tiên, không phải heo / phao
- Tests: [`web/src/lib/wealth-building-accounts.test.ts`](../../web/src/lib/wealth-building-accounts.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › từ tài khoản thường vào phao / sổ / heo: nhắc tiền vào là Tích sản, ví Có thì tốt chuyển sang Tích sản"; [`web/src/lib/wealth-building-accounts.test.ts`](../../web/src/lib/wealth-building-accounts.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › rút ra, gửi phao → sổ, tất toán sổ → phao, chuyển giữa hai tài khoản thường, chưa chọn tài khoản: không nhắc (chỉ đổi chỗ)"; [`web/src/lib/categories.test.ts`](../../web/src/lib/categories.test.ts) › "tài khoản nhập tay được › tài khoản Tích sản (heo đất, phao — ADR-88) không bao giờ là mặc định khi còn tài khoản khác, dù tên đứng trước"; dòng nhắc trên sheet: ⚠ Chưa có test (repo chưa có test giao diện; đã xem tận mắt ở 390px, `wrangler dev` cục bộ)

## Traceability
- Code: `web/src/screens/other-entry-sheet.tsx` › `OtherEntrySheet`, `IncomeForm` (`submit(defer)`), `TenantPaidForm`, `QueuedForm`, `AllocationPreview`, `KINDS`, `ASSET_KINDS`, `tierNote`; `web/src/screens/ref-pickers.tsx` › `LinkSourcePicker`, `ReceivablePicker`; `web/src/lib/refunds.ts` › `rankLinkCandidates`, `linkCandidateLabel`, `refundDiffText`, `lendDiffText`, `LINK_PENDING_HINT`; `web/src/lib/splits.ts` › `deferredIncomeToast`; `web/src/lib/rental.ts` › `linePayload`; `web/src/lib/receivables.ts` › `defaultReceivableId`, `lendToast`, `collectToast`, `receivableEffect`, `overpaidHint`; `web/src/lib/memo-books.ts` › `bookRefLabel`; `web/src/state/store.ts` › `saveEntry`, `doneText`, `refresh`; `web/src/lib/categories.ts` › `defaultBankFor`, `defaultAccountFor`, `manualAccounts`, `spendableWallets`, `defaultWalletFor`, `walletOfMember`; `web/src/ui/parts.tsx` › `NeedsNetwork`; `web/src/ui/fields.tsx` › `AmountInput`, `useAmountField`.
- Backend: allocation UC-202 Xem trước phương án chia (`/v1/allocate/preview`, gồm `deficitCovered`, `underfunded`, `transferOrders`, `income_stream_id`), UC-203 Chia một khoản thu nhập (`/v1/allocate`, lỗi `already_allocated`); ledger UC-101 Nhập tay một khoản tiền (`income_stream_id`, `tenant_id`, `collect`, `receivable_id`, `link_id`), UC-111 (`GET /v1/transactions/link-candidates` — khoản chi / khoản cho vay để nối khoản tiền về); rental [UC-802](../rental/UC-802-ghi-nguoi-thue-chi-ho.md) Ghi người thuê chi hộ, [UC-805](../rental/UC-805-nhan-tien-nguoi-thue-tra.md) Nhận tiền người thuê trả; receivable [UC-1001](../receivable/UC-1001-them-va-xem-khoan-phai-thu.md) (`POST /v1/receivables` số 0), [UC-1002](../receivable/UC-1002-cho-vay-tra-ho.md) Cho vay / trả hộ, [UC-1003](../receivable/UC-1003-nhan-lai-tien.md) Nhận lại tiền (`bootstrap.receivables`).

## Divergences & Open Questions
- [OPEN] Thu nhập nhập tay dùng `POST /v1/transactions` trực tiếp, không qua hàng đợi — đúng D12 ("chia tiền vẫn cần mạng"), nhưng nghĩa là khoản thu không thể ghi trước khi offline rồi chia sau.
- [OPEN] Toast của mua tài sản / chuyển nội bộ / cho vay hay nhận lại **không** gắn khoản phải thu không nói hệ quả (chỉ "Đã ghi …"), khác luật "toast luôn nói kết quả kèm hệ quả" (`docs/DESIGN.md` §4) — `doneText` (`web/src/state/store.ts`). Có khoản phải thu thì toast đã nói còn bao nhiêu chưa trả (AC-16).
- [DIVERGENCE] Proposal `261001-cho-thue-lai` UC-802: "Loại khác" có nút mang tên người thuê ("An chi"); code là một loại chung **Người thuê chi** với ô "Ai chi" (`KINDS`, `TenantPaidForm`).
- [OPEN] Ô **Thuế** vẫn hiện và vẫn gửi `taxable` khi đã chọn Nguồn thu hay người thuê, nhưng chia theo nguồn **không bao giờ** trích thuế (`src/domain/allocation.ts`) — chọn "Chưa — để riêng thuế" lúc đó không có tác dụng gì, giao diện không nói.
- [OPEN] Ô Nguồn thu liệt kê nguồn đang dùng, còn chọn người thuê thì nguồn rỗng nghĩa là "Theo cấu hình cho thuê" — nếu nguồn cho thuê trong cấu hình đã bị tắt, server từ chối `inactive_income_stream` sau khi người đã thấy bảng chia thử (chia thử vẫn tìm thấy nguồn tắt).
