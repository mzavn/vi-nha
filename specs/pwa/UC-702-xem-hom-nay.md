# UC-702: Xem Hôm nay (điện thoại và bảng điều khiển máy tính)
- Status: implemented
- BR: BR-01, BR-07, BR-04
- Decisions: D12, D13, D9; DESIGN.md §4 (Hero, Banner), §7b; commit `0ee6969`; ADR-67 (audit 261001: F02 hero kê phong bì, F09, F11, F15, F16, F22); ADR-85 (card "Tiền chi được"); ADR-92 (tên trong mã nguồn, dữ liệu, địa chỉ màn bằng tiếng Anh); ADR-93 (Quỹ an tâm)
- Actor: thành viên đã đăng nhập
- Trigger: mở app (tab mặc định `#today`), chạm tab "Hôm nay", mục "Hôm nay" ở thanh bên

## History
- v1 (2026-09-22, commit `a756f68`): hero "Còn để chi tuần này", banner chỉ khi có việc, dòng thác 5 hàng, quỹ mục tiêu, chân màn Giao diện/Đăng xuất.
- v2 (2026-09-22, commit `032d089`): nút bánh răng mở Cài đặt cạnh nút chính "Chia tiền".
- v3 (2026-09-22, commit `0ee6969`): ≥ 1024px thành bảng điều khiển (`TodayDesk`): hero kèm "Cộng từ các phong bì", "Việc cần làm", bảng phong bì chi tiêu, 15 giao dịch gần đây. Tách `WaterfallCard`, `GoalsCard` dùng chung; giao diện điện thoại không đổi.
- v4 (2026-10-01, commit `11c52a0`): theo audit 261001 (ADR-67) — hero điện thoại kê từng phong bì cộng thành số "còn để chi" (ví âm lên đầu, `orderSpendable`) thay cho dòng tên ví (F02); bỏ chân màn Giao diện/Đăng xuất, chuyển sang Cài đặt › Máy này (F22); nút **Chia tiền** mở sheet "Ghi thu nhập và chia" không có hàng chọn loại (F09); "ròng" → "vào trừ ra", nhóm "Vận hành — Must" → "Must" (F11); nhóm âm ghi "chưa Bù thì lần chia tiền tới lấp trước" (F15); màn rộng: bảng Phong bì chi tiêu bỏ cột Mục tiêu tháng (F16), lệnh chuyển tiền trong Việc cần làm ghi "cho {ví}" (F20).
- v5 (2026-10-01, commit `a301077`): mở app / quay lại app có thể nhận snapshot service worker lưu ≤ 30 giây (bootstrap ≤ 5 phút) mà không gọi server — coi là số mới, không hiện "số lúc HH:mm"; nút **Đồng bộ** và **Tải lại** của các bảng luôn hỏi thẳng server; ghi gì từ máy này thì cache bị xoá nên số hiện ngay (ADR-69, UC-710).
- v6 (2026-10-01, commit `e5bae84`): số định chi của ví gọi là "dự kiến", không gọi "mục tiêu" (ADR-74) — nhóm ở Dòng thác ghi "còn lại / dự kiến tháng"; màn rộng: bảng Phong bì chi tiêu cột "Dự kiến", ghi chú "Còn tuần = dự kiến tuần trừ đã chi tuần…". Card "Quỹ mục tiêu" giữ tên (quỹ để dành có đích).
- v7 (2026-10-03, commit `a18730c`): theo audit 261003: lần tải số đầu hỏng mà máy chưa có bản lưu → card "Chưa tải được số." / "Không có mạng." kèm nút **Tải lại** (`FirstLoadFailed`, cờ `loadFailed`) thay cho skeleton chạy mãi (trước: chỉ một toast 2,2 giây rồi khung chờ không bao giờ hết). Cả điện thoại lẫn màn rộng.
- v8 (2026-10-03, commit `c67420e`): card **Giao dịch gần đây** của màn rộng chia trang như màn Nhập (pwa [UC-703](UC-703-nhap-nhanh-khoan-chi.md) AC-13): mặc định 10 dòng một trang thay cho 15 dòng cố định; **Mỗi trang** 5 / 10 / 20 / 50 / 100, **Trang trước** / **Trang sau** ở cuối card.
- v9 (2026-10-03, commit `2608b66`): banner / hàng lệch đối soát nói **lớp nào** lệch theo cùng luật với Ví & quỹ › Tài khoản (`driftLayers`, `web/src/lib/drift.ts`, pwa UC-707 v14): "Lệch đối soát ở {tài khoản}." rồi mỗi lớp lệch "{chữ lớp}: ±X ₫." — lớp 1 "Ngân hàng báo khác sổ theo SePay — có thể sót giao dịch", lớp 2 "Sổ diễn giải lệch", cả hai nếu cả hai. Trước đó banner ghi "Sổ lệch X ở {tài khoản}. Có giao dịch chưa vào sổ." với X = `bookDrift || feedDrift` (lệch cả hai lớp thì chỉ thấy lớp 2), còn tab Tài khoản dùng `bookDrift ?? feedDrift` nên báo "khớp" cho tài khoản Hôm nay đang báo lệch.
- v10 (2026-10-03, commit `e91b68f`): số hero viết đủ chữ (chủ nhà: "viết thế này dễ đọc nhầm lắm" về "Còn để chi tuần này −415.300 ₫ · còn 1 ngày trong tuần · 5 tuần nữa hết tháng"). Âm → nhãn **"Tuần này đã chi vượt"**, số dương màu đỏ, kèm dòng "Các phong bì cộng lại đã chi quá dự kiến tuần này — xem từng ví ngay dưới." Dòng phụ (`weekMetaText`): "Tuần này còn N ngày (hết CN d/m)" / "Hôm nay là ngày cuối tuần (CN d/m)" · "tháng M còn K tuần nữa" với K = số tuần **sau** tuần này (`weeksLeftInMonth − 1`; trước đây hiện cả tuần đang chạy nên ra 5 vào CN 4/10) / "đây là tuần cuối của tháng M". Cả điện thoại lẫn màn rộng.
- v11 (2026-10-04, commit `04c415b`): change [`261004-gan-chua-chia`](../changes/archive/261004-gan-chua-chia/proposal.md) — banner vàng (màn rộng: hàng trong **Việc cần làm**, nhóm "Thu chưa chia") khi còn khoản thu chưa chia: "N khoản thu chưa chia (X ₫) — tiền đang nằm ở ví Thu nhập." → **Chia** mở sheet chi tiết (UC-715) của khoản cũ nhất (`attention.unallocatedIncome`, ledger UC-103). Snapshot cũ trong cache máy chưa có trường này thì coi như không có khoản nào.
- v12 (2026-10-06, commit `43e4699`): change [`261006-so-giao-dich`](../changes/archive/261006-so-giao-dich/proposal.md) — đầu card **Giao dịch gần đây** (màn rộng) thêm link **Xem tất cả ›** mở màn Sổ giao dịch tháng hiện tại, không lọc (pwa [UC-716](UC-716-so-giao-dich.md)); tiêu đề card giữ một dòng, hai link xuống dòng bên phải khi chật.
- v13 (2026-10-06, commit `a0d0ccc`): Hôm nay điện thoại có hàng **Sổ giao dịch · Mở ›** dưới hero và các banner, trước Dòng thác (pwa UC-716). chủ nhà: "không xem được trên mobile cái chi tiết các bản ghi à? tôi tìm không thấy" — lối vào cũ chỉ là link nhỏ "Xem tất cả ›" ở đầu card Giao dịch gần đây, cuối màn Nhập.
- v14 (2026-10-06, commit `18569ce`): change [`261006-tien-chi-duoc`](../changes/archive/261006-tien-chi-duoc/proposal.md) — card báo cáo **Tiền chi được** (ADR-85, `snapshot.spendableCash` — ledger UC-103 bước 7b) dưới các banner, trước hàng Sổ giao dịch; màn rộng ở cột phụ dưới Việc cần làm. Không thay hero "Còn để chi tuần này". Chủ nhà: "tôi muốn nhìn ngay ở trang chủ vào là tôi còn lại thực tế là bao nhiêu tiền có thể chi tiêu (dựa trên tiền thật của các tài khoản của tôi nhé), không nói dựa trên tổng tài sản" — chọn "tách thành 1 section báo cáo".
- v15 (2026-10-06, commit `9c265ee`): **bỏ số lũy kế SePay** (ADR-87, change [`261006-bo-luy-ke-sepay`](../changes/archive/261006-bo-luy-ke-sepay/proposal.md)) — chủ nhà: "tôi nghĩ là bạn bỏ phần lấy lũy kế của sepay đi, nó không đúng đâu à, bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè" (Hôm nay báo "Lệch đối soát" 600.000 ₫ giả ở MB chi tiêu (vợ)). Lệch chỉ còn `bookDrift` (`driftOf`, thay `driftLayers`): banner / hàng màn rộng "Sổ khác giao dịch ngân hàng đã gán: ±X ₫"; dòng phụ card Tiền chi được "sổ lệch — xem Đối soát"; snapshot cũ trong cache còn `feedDrift` không làm hiện lệch. AC-9, AC-12 sửa.
- v16 (2026-10-06, commit `9c265ee`): change [`261006-tai-khoan-phao`](../changes/archive/261006-tai-khoan-phao/proposal.md), ADR-88 — card **Tiền chi được**: khi có Tích sản nằm ở tài khoản Tích sản không tính (heo, phao, sổ tiết kiệm — `tichsanOutside > 0`) dòng trừ đổi nhãn "Trừ Tích sản đang giữ (phần chưa nằm ở heo / phao / sổ tiết kiệm)"; chân card kể tài khoản không tính theo tên (heo gộp "heo đất") rồi "— trong đó Z ₫ là Tích sản, không trừ lại". Chủ nhà: "Tiền vào phao tự vào Tích sản (như heo đất)". AC-12 sửa.
- v17 (2026-10-06, commit `d059eaa`): phao khẩn cấp dùng chung hai chữ với tab Tích sản (pwa UC-707 v21, `emergencyMonthsText`, `emergencyCashText`). Chủ nhà nhìn tab Tích sản: "sai gì đó nè" — "0 / 6 tháng" cạnh 55.000 ₫ và "55.000 ₫ trên mức cần 96.000.000 ₫". Dòng thác: "phao a / b tháng", có tiền mà server làm tròn ra 0 tháng thì "phao dưới 0,1 / b tháng" (trước "phao 0/6 tháng"); Quỹ mục tiêu: "dưới 0,1 / b tháng" và "Có X · cần [ước tính ]Y" (trước "X trên mức cần [ước tính ]Y").
- v18 (2026-10-07, commit `7424f26`): tên tiếng Anh (ADR-92) và chữ "Quỹ an tâm" (ADR-93): card Quỹ mục tiêu ghi "Quỹ an tâm" thay "Phao khẩn cấp", Dòng thác ghi "quỹ an tâm a / b tháng" thay "phao a / b tháng"; snapshot `tiers.wealth_building`, `safetyFund` (thay `tiers.tichsan`, `emergency`), `wealthBuildingOutside`; hàm `safetyFundMonthsText`, `safetyFundCashText` ở `web/src/lib/wealth-building.ts`; địa chỉ màn `#today`, `#ledger` (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- `phase = "app"`; snapshot lấy từ ledger (`GET /v1/snapshot`), có thể là số cũ khi mất mạng (UC-710) hoặc bản service worker lưu chưa quá 30 giây (ADR-69).

## Main Flow (điện thoại)
1. Header: "Hôm nay", phụ đề `{Thứ} {d/m} · T{tuần} ({khoảng})`; hành động: nút bánh răng (ghost, "Cài đặt") và nút chính **Chia tiền** (mở sheet tiêu đề "Ghi thu nhập và chia", loại Thu nhập cố định, không có hàng chọn loại — UC-705).
2. Dòng trạng thái (chỉ khi offline, đang hiện số cũ, hoặc có khoản chờ): chip "không có mạng", "số lúc HH:mm[ ngày d/m]" (giờ `snap.at`), chip "N chờ đồng bộ, đã trừ tạm", nút **Đồng bộ** (UC-704).
3. Chưa có snapshot → skeleton; lần tải đầu đã hỏng (`loadFailed`) → xem E1.
4. Hero: nhãn "Còn để chi tuần này" → số `spendableThisWeek` **sau khi trừ tạm hàng đợi** (`viewSnapshot`); **âm thì nhãn "Tuần này đã chi vượt" và số dương màu đỏ**, kèm dòng "Các phong bì cộng lại đã chi quá dự kiến tuần này — xem từng ví ngay dưới." (`heroLabel`) → dòng phụ `weekMetaText`: "Tuần này còn N ngày (hết CN d/m)" hoặc "Hôm nay là ngày cuối tuần (CN d/m)", rồi "tháng M còn K tuần nữa" (K = tuần sau tuần này) hoặc "đây là tuần cuối của tháng M" → danh sách "Cộng từ các phong bì": mỗi phong bì của `spendableByWallet` một dòng tên · số (âm thì đỏ, dấu −), **ví âm lên đầu, âm nhiều nhất trước**, các ví còn lại giữ thứ tự server (`orderSpendable`) — không để ví còn dư che mất ví đã âm (không có phong bì: "Chưa có phong bì chi tiêu") → ba số phụ: **Đã khóa** (= Tích sản + Thuế), **Tài sản** (`tiers.wealth_building.assets`), **Chờ đầu tư** (`tiers.wealth_building.cash`).
5. Banner, chỉ khi có việc, theo thứ tự:
   - khoản nhập bị từ chối (đỏ): "N khoản nhập bị máy chủ từ chối. Nằm trong hàng đợi, chờ sửa hoặc bỏ." → **Xem** mở tab Nhập;
   - mỗi tài khoản lệch (đỏ; tài khoản có trong `attention.drift` với `bookDrift ≠ 0` — `driftOf`, cùng luật với tab Tài khoản, UC-707): "**Lệch đối soát ở {tài khoản}.** Sổ khác giao dịch ngân hàng đã gán: ±X ₫." → **Đối soát** mở Ví & quỹ › Tài khoản. Không có số ngân hàng báo (ADR-87);
   - log chưa gán (vàng): "N giao dịch ngân hàng chưa gán, vào trừ ra X." → **Gán**;
   - khoản thu chưa chia (vàng; `attention.unallocatedIncome.count > 0`): "**N khoản thu chưa chia** (X ₫) — tiền đang nằm ở ví Thu nhập." → **Chia** mở sheet chi tiết giao dịch (UC-715) của khoản cũ nhất (`oldestTxId`), ở đó bấm Chia;
   - lệnh chuyển tiền (vàng): "N lệnh chuyển tiền chưa làm[, M quá 3 ngày]." → **Làm** mở Ví & quỹ › Chuyển tiền.
5b. Card **"Tiền chi được"** (`SpendableCashCard`, ADR-85; dòng do `spendableCashView` dựng từ `snapshot.spendableCash`), phải tiêu đề "theo sổ": số lớn (28px, nhỏ hơn hero) = `amount`; âm → "thiếu X ₫" đỏ (X dương). Câu dưới số: "Tiền thật trong các tài khoản đang tính, trừ phần Tích sản và Thuế phải giữ." / âm: "Tiền trong các tài khoản đang tính chưa đủ giữ Tích sản và Thuế, thiếu X ₫." Rồi danh sách: mỗi tài khoản đang tính một dòng tên · số dư sổ (thứ tự server); tài khoản lệch đối soát (`attention.drift`, `driftOf` khác null) thêm dòng phụ vàng "sổ lệch — xem Đối soát" (banner lệch ngay trên có nút Đối soát); "Trừ Tích sản đang giữ" −X (có Tích sản nằm ở tài khoản Tích sản không tính — `wealthBuildingOutside > 0` — thì "Trừ Tích sản đang giữ (phần chưa nằm ở heo / phao / sổ tiết kiệm)", ADR-88), "Trừ Thuế đang giữ" −Y — chỉ khi ≠ 0. Chân card: "Không tính: {tên tài khoản không tính…}, heo đất — trong đó Z ₫ là Tích sản, không trừ lại" (heo gộp một tên, phao / sổ tiết kiệm / tài khoản tắt theo tên; không có Tích sản ở ngoài thì bỏ phần "— trong đó …"; tính hết thì "Đang tính mọi tài khoản.") + nút **Đổi tài khoản** mở Cài đặt › Tài khoản (UC-709 6a). Số theo sổ server — khoản chờ đồng bộ chưa trừ vào card (hero thì có). Snapshot cũ trong cache chưa có `spendableCash` → không hiện card.
6. Card "Dòng thác {tháng}": Tích sản (chip "khóa", "tiền X → tài sản Y", "quỹ an tâm a / b tháng" — có tiền mà làm tròn ra 0 tháng thì "quỹ an tâm dưới 0,1 / b tháng", chạm → Ví & quỹ › Tích sản) · Thuế (chip "khóa") · Hưởng thụ · Must · Có thì tốt (chip "phần còn lại"); mỗi nhóm hiện "còn lại / dự kiến tháng" và %; chạm → Ví & quỹ › Ngân sách lọc sẵn phe đó (`tierFilter`). Chú giải chấm màu cuối card.
7. Card "Quỹ mục tiêu": Quỹ an tâm "a / b tháng" ("dưới 0,1 / b tháng" khi có tiền mà làm tròn ra 0), dòng phụ "Có X · cần Y" ("cần ước tính Y" khi ước tính) (chip + ghi chú "ước tính" khi `safetyFund.estimated`), rồi mỗi quỹ có đích: số dư / đích, "Hạn d/m", %.
8. Không còn chân màn: Giao diện và Đăng xuất ở Cài đặt › Máy này (UC-701, UC-709). Màn có FAB chừa thêm đáy để FAB không che nội dung cuối trang (UC-711).

## Alternative Flows
- 1a. Màn rộng (≥ 1024px) → `TodayDesk`: không có bánh răng, dòng trạng thái (đã ở thanh bên — UC-711). Hero cùng nhãn và dòng phụ như bước 4 (`heroLabel`, `weekMetaText`), thêm cột **Cộng từ các phong bì** (mỗi phong bì góp bao nhiêu, lý do: "tuần đã chi X / Y", "trong ví X, chia đều cho N tuần còn lại", hoặc "ví đang âm, chưa bù thì không còn để chi").
- 5a. Màn rộng: các banner thành card **Việc cần làm** (tổng "N việc", khoản thu chưa chia đếm mỗi khoản một việc, lệch chỉ đếm tài khoản `driftOf` khác null), mỗi việc là hàng bấm được; nhóm **Lệch đối soát**: mỗi tài khoản một hàng — tên, dòng phụ "Sổ khác giao dịch ngân hàng đã gán: ±X ₫" (như banner điện thoại), chip "lệch"; tối đa 5 log chưa gán (bấm → màn Gán đã chọn sẵn đúng log — `assignFocus`); nhóm **Thu chưa chia**: một hàng "N khoản thu chưa chia (X ₫)" + dòng phụ "Tiền đang nằm ở ví Thu nhập." + "Chia" → sheet chi tiết khoản cũ nhất; và tối đa 5 lệnh chuyển tiền (dòng phụ "cho {các ví nhận}" khi server trả `wallet_names` — allocation UC-205); nhiều hơn thì hàng "Xem cả N…". Không có việc → card không hiện.
- 5b-a. Màn rộng: cùng card ở cột phụ ngay dưới Việc cần làm (≥ 1280px); 1024–1279px một hàng riêng dưới hero và Việc cần làm (vùng `cash`), không có Việc cần làm thì cạnh hero.
- 6a. Màn rộng thêm card **Phong bì chi tiêu** (ví `must`/`nice`, `kind = envelope`): Tuần này (dự kiến / đã chi / còn), **Đã chi tháng** (chip đỏ % khi vượt dự kiến tháng; cột Dự kiến tháng bỏ đi để tên ví không bị ép xuống nhiều dòng — dự kiến tháng xem ở Ví & quỹ › Ngân sách), Trong ví; ghi chú card "Còn tuần = dự kiến tuần trừ đã chi tuần. Trong ví là số thật, gồm cả phần dồn từ tuần trước và phần vượt chưa bù."; và **Giao dịch gần đây** (`GET /v1/transactions?limit={cỡ trang + 1}`, chia trang như pwa UC-703 AC-13 — mặc định 10 dòng; vào `+`, ra `−`, chuyển nội bộ không dấu, đã huỷ có chip "đã huỷ"; link **Xem tất cả ›** ở đầu card → Sổ giao dịch, UC-716).
- 6b. Nhóm âm: dòng phụ "Vượt X — chưa Bù thì lần chia tiền tới lấp trước", chip "âm", thanh đỏ 100%.

## Exceptions
- E1. Không lấy được snapshot lần đầu (không có bản lưu) → toast câu lỗi (`refresh`) và card thay skeleton (`FirstLoadFailed`): có mạng "Chưa tải được số." + "Máy chủ chưa trả lời được. Thử lại sau ít phút."; mất mạng "Không có mạng." + "Máy này chưa có bản lưu nào. Có mạng thì bấm Tải lại."; nút **Tải lại** gọi `refresh(true)` (bỏ qua bản lưu service worker). Tải được thì cờ tắt, hiện số. Màn rộng giống vậy.
- E2. Giao dịch gần đây lỗi → "Không có mạng." / "Chưa tải được giao dịch." kèm nút **Tải lại**.

## Acceptance Criteria
### AC-1: Hero là số ra quyết định và đã trừ tạm hàng đợi
- Given snapshot server có `spendableThisWeek` và hàng đợi có một khoản chi 250.000 ₫ từ ví Đi lại chưa đồng bộ
- When mở Hôm nay
- Then hero hiện đúng số mà server sẽ tính sau khi ghi khoản đó (cùng công thức `buildSnapshot`), và dòng trạng thái có chip "1 chờ đồng bộ, đã trừ tạm"
- Tests: `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › chi 250.000 từ Đi lại: khớp đúng số server sẽ tính sau khi ghi"; phần chip: ⚠ Chưa có test

### AC-2: Hàng đợi rỗng thì số đúng như server
- Given hàng đợi rỗng
- When mở Hôm nay
- Then snapshot hiển thị chính là snapshot server trả (không tính lại)
- Tests: `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › không có gì trong hàng đợi thì giữ nguyên số của server"

### AC-3: Banner chỉ khi có việc
- Given snapshot không có log chưa gán, không khoản thu chưa chia, không lệch, không lệnh chuyển tiền và không khoản bị từ chối
- When mở Hôm nay
- Then không có banner nào (màn rộng: không có card "Việc cần làm")
- Tests: ⚠ Chưa có test

### AC-4: Banner dẫn thẳng tới chỗ làm
- Given có 2 lệnh chuyển tiền, 1 quá 3 ngày
- When bấm "Làm" trên banner
- Then mở Ví & quỹ ở tab "Chuyển tiền" (tab đó luôn nằm trong màn — UC-707); banner ghi "2 lệnh chuyển tiền chưa làm, 1 quá 3 ngày."
- Tests: ⚠ Chưa có test

### AC-5: Chạm một phe mở Ví & quỹ đã lọc
- Given đang ở Hôm nay
- When chạm hàng "Hưởng thụ"
- Then mở Ví & quỹ › Ngân sách chỉ hiện nhóm Hưởng thụ, kèm "Đang xem một phe." và liên kết "Xem tất cả"
- Tests: ⚠ Chưa có test

### AC-6: Ví riêng tư của người kia không bị trừ tạm
- Given hàng đợi có khoản chi vào ví `private` của người kia (snapshot trả `balance = null`)
- When tính số hiển thị
- Then ví đó vẫn không có số và `spendableThisWeek` không đổi
- Tests: `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví riêng tư của người kia không bị đụng (không có số để trừ)"

### AC-7: Màn rộng: log trong Việc cần làm mở đúng log ở màn Gán
- Given ≥ 1024px, có 3 log chưa gán
- When bấm log thứ hai trong "Việc cần làm"
- Then màn Gán mở với log đó được chọn sẵn ở panel bên phải
- Tests: ⚠ Chưa có test

### AC-8: Hero kê từng phong bì, ví âm lên đầu
- Given `spendableByWallet` = Ăn uống −415.000, Đi lại 32.600, Tập luyện 576.000, Khác 0, Mua sắm −650.000
- When mở Hôm nay trên điện thoại
- Then dưới hero là các dòng theo thứ tự Mua sắm, Ăn uống, Đi lại, Tập luyện, Khác (âm nhiều nhất trước, ví còn lại giữ thứ tự server); snapshot gốc không bị đổi thứ tự
- Tests: `web/src/lib/budget.test.ts` › "các phong bì dưới số còn để chi tuần này › ví âm lên đầu, âm nhiều nhất trước; ví còn dư giữ thứ tự server (kể cả ví bằng 0)"

### AC-9: Lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán, cùng luật với tab Tài khoản
- Given `attention.drift` = TCB (Tích sản) `bookDrift` +50.000; snapshot cũ còn lưu trên máy có MB chi tiêu (vợ) `feedDrift` +600.000, `bookDrift` 0
- When mở Hôm nay (điện thoại và màn rộng)
- Then banner "Lệch đối soát ở TCB (Tích sản). Sổ khác giao dịch ngân hàng đã gán: +50.000 ₫."; MB chi tiêu (vợ) không có banner; màn rộng cùng chữ trong nhóm "Lệch đối soát" và "N việc" không đếm MB; tab Tài khoản cũng chỉ báo TCB lệch (pwa UC-707 AC-16)
- Tests: [`web/src/lib/drift.test.ts`](../../web/src/lib/drift.test.ts) › "lệch đối soát: một luật cho Hôm nay và Tài khoản (ADR-87) › chỉ sổ khác giao dịch ngân hàng đã gán mới là lệch, giữ dấu; 0 hay chưa có giao dịch ngân hàng (null) là không lệch"; [`web/src/lib/drift.test.ts`](../../web/src/lib/drift.test.ts) › "lệch đối soát: một luật cho Hôm nay và Tài khoản (ADR-87) › snapshot cũ còn lưu trên máy mang số SePay báo (feedDrift) mà sổ khớp → không báo lệch"; banner, hàng: ⚠ Chưa có test (đã xem tận mắt ở 390px, `wrangler dev` cục bộ, webhook mang `accumulated` 1.400.000)

### AC-10: Số hero âm viết là "đã chi vượt", dòng phụ đếm tuần sau tuần này
- Given còn để chi tuần này = −415.300 ₫, hôm nay Chủ nhật 4/10/2026 (`weeksLeftInMonth` = 5)
- When mở Hôm nay
- Then nhãn "Tuần này đã chi vượt", số 415.300 ₫ màu đỏ; dòng phụ "Hôm nay là ngày cuối tuần (CN 4/10) · tháng 10 còn 4 tuần nữa"
- Tests: `web/src/lib/period.test.ts` › "số hero 'còn để chi tuần này' viết đủ chữ › âm thì đổi nhãn thành 'đã chi vượt' và hiện số dương, không còn '−X' dưới chữ 'còn'"; `web/src/lib/period.test.ts` › "số hero 'còn để chi tuần này' viết đủ chữ › dòng phụ: ngày cuối tuần và số tuần còn lại SAU tuần này (Chủ nhật 4/10/2026: còn 4 tuần, không phải 5)"

### AC-11: Khoản thu chưa chia hiện ở Hôm nay, Chia mở khoản cũ nhất
- Given hai khoản thu chưa chia: 1.200.000 (ghi tay, cũ hơn) và 250.000 (gán từ ngân hàng); một khoản thu đã chia và một khoản đã xoá không tính
- When mở Hôm nay (điện thoại 390px / màn rộng 1280px) rồi bấm Chia
- Then điện thoại: banner vàng "2 khoản thu chưa chia (1.450.000 ₫) — tiền đang nằm ở ví Thu nhập." nút **Chia**; màn rộng: hàng "2 khoản thu chưa chia (1.450.000 ₫)" trong Việc cần làm; bấm → sheet chi tiết của khoản 1.200.000 (cũ nhất) có nút Chia; chia hết thì banner / hàng biến mất
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "gán thu nhập, để chia sau (pwa UC-706, ledger UC-103) › snapshot đếm khoản thu chưa chia: bỏ khoản đã chia và khoản đã huỷ, khoản cũ nhất trước" (server); banner, hàng: ⚠ Chưa có test (đã xem tận mắt ở 390px và 1280px, `wrangler dev` cục bộ)

### AC-12: Card Tiền chi được kê đủ dòng, chỉ dòng trừ ≠ 0, âm nói "thiếu" (ADR-85)
- Given `spendableCash` = MB chồng 3.200.000, MB chi tiêu vợ 230.000, Tiền mặt 500.000; Tích sản đang giữ 2.000.000 (55.000 đã ở heo); Thuế 600.000; không tính Thẻ tín dụng và hai heo; `attention.drift` có một tài khoản đang tính lệch (`bookDrift ≠ 0`)
- When mở Hôm nay
- Then số 1.330.000 ₫; ba dòng tài khoản theo thứ tự server, "Trừ Tích sản đang giữ (phần chưa nằm ở heo / phao / sổ tiết kiệm) −2.000.000" (Tích sản ở ngoài 1.055.000: hai heo + phao "MB tiết kiệm (vợ)"), "Trừ Thuế đang giữ −600.000"; chân "Không tính: Thẻ tín dụng, MB tiết kiệm (vợ), heo đất — trong đó 1.055.000 ₫ là Tích sản, không trừ lại"; không có Tích sản ở ngoài thì nhãn trừ không kèm ngoặc và chân chỉ kể tên; Tích sản / Thuế bằng 0 thì không có dòng; số âm −250.000 → "thiếu 250.000 ₫" kèm câu thiếu; chỉ tài khoản lệch mới có dòng phụ "sổ lệch — xem Đối soát"
- Tests: [`web/src/lib/spendable-cash.test.ts`](../../web/src/lib/spendable-cash.test.ts) › "Tiền chi được ở Hôm nay (ADR-85, ADR-88) › kê từng tài khoản đang tính theo thứ tự server, rồi trừ Tích sản và Thuế đang giữ; câu Không tính gộp heo đất, kể phao theo tên, nói phần Tích sản không trừ lại"; [`web/src/lib/spendable-cash.test.ts`](../../web/src/lib/spendable-cash.test.ts) › "Tiền chi được ở Hôm nay (ADR-85, ADR-88) › dòng trừ bằng 0 thì không hiện; không có Tích sản nằm ngoài thì chỉ kể tên, nhãn trừ Tích sản không kèm ngoặc; tính hết thì không có câu Không tính"; [`web/src/lib/spendable-cash.test.ts`](../../web/src/lib/spendable-cash.test.ts) › "Tiền chi được ở Hôm nay (ADR-85, ADR-88) › âm: số to là phần thiếu (dương), câu nói rõ đang thiếu bao nhiêu"; [`web/src/lib/spendable-cash.test.ts`](../../web/src/lib/spendable-cash.test.ts) › "Tiền chi được ở Hôm nay (ADR-85, ADR-88) › tài khoản lệch đối soát thì có dòng phụ nhắc Đối soát; lệch bằng 0 / null hay tài khoản không tính thì không"; card trên màn: ⚠ Chưa có test (đã xem tận mắt 390px trên `wrangler dev` cục bộ, DB mới có phao)

## Traceability
- Code: `web/src/screens/today.tsx` › `Today`, `FreshnessRow`, `TodayBody`, `WaterfallCard`, `GoalsCard`, `GroupRow`; `web/src/lib/budget.ts` › `orderSpendable`; `web/src/lib/drift.ts` › `driftOf`, `DRIFT_LABEL`; `web/src/screens/today-desktop.tsx` › `TodayDesk`, `Hero`, `Todo`, `SpendWallets`, `RecentTransactions` (link Xem tất cả → `#ledger`), `TxLine`; `web/src/lib/transactions.ts` › `txSign`; `web/src/state/store.ts` › `viewSnapshot`, `refresh`, `go`, `openTx`; `web/src/lib/pending.ts` › `applyQueue`, `spendableAmount`; `web/src/lib/period.ts` › `dayHeading`, `weekLabel`, `daysLeftInWeek`.
- Backend: ledger UC-103 Xem "còn bao nhiêu để chi" (snapshot, `attention.unallocatedIncome`), UC-107 Theo dõi tích lũy, UC-106 Đối soát tài khoản (`attention.drift`), UC-111 Xem sổ giao dịch; ingest UC-305 Gán log chưa gán (danh sách); allocation UC-205 Theo dõi & đánh dấu lệnh chuyển tiền; access UC-504 Ẩn lịch sự số dư ví `private`.
- Code (Tiền chi được, ADR-85): `web/src/screens/today.tsx` › `SpendableCashCard`; `web/src/screens/today-desktop.tsx` › `TodayDesk` (`.dash-cash`); `web/src/lib/spendable-cash.ts` › `spendableCashView`; `web/src/styles.css` › `.cash-big`, `.cash-meta`, `.cash-warn`, `.cash-foot`, vùng `cash` của `.dash`; backend ledger UC-103 (`spendableCash`).
- Code (Quỹ an tâm, dùng chung với tab Tích sản): `web/src/lib/wealth-building.ts` › `safetyFundMonthsText`, `safetyFundCashText` (dùng ở `WaterfallCard`, `GoalsCard`).

## Divergences & Open Questions
- [DIVERGENCE] `plans/.../phase-05-pwa.md` §4 màn "1. Hôm nay": hero là "đúng con số của `domain/snapshot.ts` … không tính lại ở client"; code tính lại phần "còn để chi" của các ví bị hàng đợi ảnh hưởng (`applyQueue`, `web/src/lib/pending.ts:51`), theo mục PWA của cùng file (D12: "đã được trừ tạm"). Hai câu trong cùng phase-05 cần đọc cùng nhau.
- [OPEN] Chip "quá 3 ngày" ở Hôm nay dùng `snapshot.attention.transferOrdersOverdue` (server), còn tab Chuyển tiền tự tính `Date.now() − created_at > 3 ngày` ở máy (UC-707) — hai nguồn có thể lệch nếu đồng hồ máy sai.
- [OPEN] Card Tiền chi được dùng số sổ server; khoản đang chờ đồng bộ chưa trừ vào card (hero thì trừ tạm, D12) — hai số có thể lệch nhau tới khi đồng bộ.
