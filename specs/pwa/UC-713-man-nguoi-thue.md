# UC-713: Màn Người thuê
- Status: implemented
- BR: BR-11, BR-03
- Decisions: ADR-58 (sổ người thuê là sổ phải thu nằm ngoài sổ cái), ADR-61 (phí cố định + chi chung chia đều; chốt tay mỗi tháng, chênh lệch mang sang bằng số dư); D12 (sổ người thuê không có hàng đợi — mọi việc ghi cần mạng); DESIGN.md §4 (Sheet; danh sách dòng sửa được mỗi dòng một hàng); ADR-67 (audit 261001 F07, F13, F14); ADR-92 (tên trong mã nguồn, dữ liệu, địa chỉ màn bằng tiếng Anh)
- Actor: thành viên đã đăng nhập, mỗi tuần ngồi với người thuê; cuối tháng chốt
- Trigger: Ví & quỹ › tab con **Người thuê** (`walletsTab = "tenants"`, UC-707); tin sáng ngày 1 "🏠 Chốt tháng với {tên} (số dư …)" (notify) nhắc mở màn này

## History
- v1 (2026-10-01, commit `034b7ff`): tab Người thuê — danh sách người thuê và số dư, bảng tháng (số dư đầu tháng, tạm tính hoặc đã chốt, dòng đã ghi, đã chuyển, cuối tháng), ‹ › đổi tháng, ghi chi hộ / phí một lần / chỉnh, huỷ dòng hai bước, chép bảng kê, sheet Chốt tháng (change `261001-cho-thue-lai`).
- v2 (2026-10-01, commit `11c52a0`): theo audit 261001 (ADR-67) — gọi tên hai con số: danh sách là số **đã ghi sổ** (ghi chú mới), dòng tổng tháng chưa chốt là **"Nếu chốt hôm nay"** thay "Cuối tháng (tạm tính)"; "Số dư đầu tháng" có câu số dư bằng chữ (F13); sheet Chốt tháng mỗi dòng một hàng tên · số · × và tổng "Phải trả tháng này" dính trên nút Chốt (F14); nút ‹ › và × vùng chạm ≥ 44px (F07).
- v3 (2026-10-03, commit `a8703fd`): ô số tiền của sheet ghi dòng và mỗi dòng sheet Chốt tháng gõ được phép tính (dòng "= X ₫" dưới ô; hàng chốt vẫn tên · số · ×) — `AmountInput` chung, pwa [UC-703](UC-703-nhap-nhanh-khoan-chi.md) v10, AC-10, AC-11.
- v4 (2026-10-07, commit `7424f26`): tab con Người thuê là `walletsTab = "tenants"` (thay `nguoithue`) — ADR-92 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Có mạng cho lần đọc đầu (offline thì bản cache của service worker nếu có, UC-710) và cho mọi việc ghi.
- Backend: rental [UC-801](../rental/UC-801-thiet-lap-nguoi-thue.md) (`GET /v1/rental`), [UC-802](../rental/UC-802-ghi-nguoi-thue-chi-ho.md) (`POST /v1/rental/tenants/:id/lines`, `POST /v1/rental/lines/:id/void`), [UC-803](../rental/UC-803-xem-tam-tinh.md) (`GET /v1/rental/tenants/:id/month`), [UC-804](../rental/UC-804-chot-thang-voi-nguoi-thue.md) (`POST /v1/rental/tenants/:id/settle`), [UC-805](../rental/UC-805-nhan-tien-nguoi-thue-tra.md) (tiền người thuê trả = `income` mang `tenant_id`).
- Người thuê, phí cố định, danh mục chi chung, số người chia, nguồn thu cho thuê được đặt ở Cài đặt › Cho thuê (UC-709).

## Main Flow
1. Tải `GET /v1/rental`. Hiện người thuê **đang ở hoặc số dư ≠ 0** (người đã ra kèm chip "đã ra"). Card "Người thuê", ghi chú "Số đã ghi sổ, chưa gồm tạm tính của tháng chưa chốt. Còn nợ là người thuê phải trả thêm; trả dư thì tự trừ vào tháng sau."; mỗi hàng: tên, câu số dư (`balanceText`: "còn nợ X" · "trả dư X, trừ tháng sau" · "đã hết nợ"), số dư. Chọn sẵn người đầu tiên; chạm hàng để đổi người (`aria-current`).
2. Card "{tên} · {Tháng M/YYYY}" (mặc định tháng hiện tại) với nút ‹ (tháng trước) và › (tháng sau — tắt ở tháng hiện tại, không xem được tháng chưa tới) → `GET /v1/rental/tenants/:id/month?month=YYYY-MM`.
3. Bảng Khoản · Số tiền ₫:
   - **Số dư đầu tháng** (≠ 0 thì kèm câu số dư bằng chữ bên dưới, vd "trả dư 2.700.000 ₫, trừ tháng sau");
   - nhóm **"Tạm tính — chưa chốt"**: mỗi dòng nháp (một dòng cho mỗi phí cố định đang thu, dòng "Chi chung" kèm "chi chung X ÷ N người"); hoặc nhóm **"Đã chốt tháng này"** kèm "Chi chung X ÷ N người = Y. Muốn sửa thì huỷ dòng rồi ghi Chỉnh.";
   - nhóm **"Đã ghi trong tháng"** (khi có): mỗi dòng sổ — tên hoặc nhãn loại (Số dư mở sổ · Phí cố định · Chi chung · Phí một lần · Đã chi hộ · Chỉnh), dòng phụ loại · ngày, số có dấu;
   - nhóm **"Đã chuyển"** (khi có): mỗi khoản thu mang `tenant_id` trong tháng — "Ngày d/m", số âm;
   - dòng tổng **"Nếu chốt hôm nay"** (tháng chưa chốt — số dư nếu chốt bản nháp ngay bây giờ, khác số đã ghi sổ ở danh sách) / **"Cuối tháng"** (đã chốt) + câu số dư;
   - tháng đã qua: thêm **"Số dư hôm nay"**.
4. Nút: **Ghi {tên} chi** · **Phí một lần** · **Chỉnh** · **Chép bảng kê** · **Chốt {Tháng M/YYYY}** (chỉ khi tháng chưa chốt).
5. Ghi dòng tay (`LineSheet`, rental UC-802):
   - **{tên} chi hộ** (`paid_for_us`): Số tiền, **Chi cho** (chỉ danh mục chi chung), Ghi chú; giải thích "Người thuê tự trả bằng tiền của mình một khoản chi chung: cộng vào tổng chi chung tháng này và trừ vào nợ của họ.";
   - **Phí một lần** (`one_off`): Số tiền, **Tên khoản** (bắt buộc);
   - **Chỉnh số dư** (`adjust`): Tăng nợ / Giảm nợ, Số tiền, **Lý do** (bắt buộc).
   Kiểm ở máy (`linePayload`) → `POST /v1/rental/tenants/:id/lines { kind, amount, name?, category_id?, at, client_id }` — chi hộ gửi số **dương**, chỉnh giảm gửi số **âm**; `at` = bây giờ nếu đang xem tháng này, không thì 12:00 ngày cuối tháng đang xem (`atForMonth`); một `client_id` cho cả vòng đời sheet. Toast "Đã ghi {tên} chi X." / "Đã ghi phí X cho {tên}." / "Đã chỉnh tăng|giảm X."; tải lại tháng và danh sách.
6. Huỷ dòng (khi online): link **Huỷ dòng** dưới mỗi dòng sổ → bấm lần hai **Huỷ hẳn dòng này** → `POST /v1/rental/lines/:id/void` → toast "Đã huỷ dòng {tên}."; tải lại.
7. **Chép bảng kê** → chép `text` của tháng (bảng kê do server dựng, rental UC-803) → toast "Đã chép bảng kê." (cùng cơ chế chép của UC-707 alt 6a, `copyText`). Dùng được cả khi offline nếu bảng đã tải.
8. **Chốt tháng** (`SettleSheet`, rental UC-804) "Chốt {tháng} · {tên}": **Số người chia** (mặc định số của tháng; đổi → dòng Chi chung tính lại `floor(tổng / số người)`, phí cố định giữ nguyên — `withHeadcount`); gợi ý "Tổng chi chung X; đổi số người thì phần chi chung tính lại, phần lẻ hộ chịu."; tiêu đề cột Khoản · Số tiền; **mỗi dòng nháp một hàng**: ô tên (placeholder = nhãn loại), ô số tiền, nút × "Bỏ dòng" (≥ 44px) — dòng chỉnh có thêm hàng Tăng nợ / Giảm nợ; **Thêm dòng chỉnh**; chân sheet dính ngay trên nút Chốt: "Phải trả tháng này X" + "Sau khi chốt: {câu số dư mới}." Kiểm `settlePayload` → `POST /v1/rental/tenants/:id/settle { month, headcount, lines }` → toast "Đã chốt {tháng} với {tên}: X.", tải lại số, đóng sheet.
9. Tiền người thuê trả **không** ghi ở màn này: gán log ở màn Gán, lựa chọn "Thu từ người thuê" (UC-706), hoặc nhập tay loại Thu nhập với "Người thuê trả" (UC-705). Khoản đó hiện ở nhóm "Đã chuyển".

## Alternative Flows
- 1a. Không có người thuê nào để hiện → "Chưa có người thuê." + "Thêm người thuê, phí cố định và danh mục chi chung ở Cài đặt › Cho thuê." + nút **Mở Cài đặt** (UC-709).
- 3a. Tháng đã chốt: không có bản nháp, không có nút Chốt; dòng chốt (`fixed`/`shared`/`adjust`) nằm trong "Đã ghi trong tháng". Muốn sửa: huỷ dòng rồi ghi Chỉnh.
- 5a. Lỗi server khi ghi dòng (ví dụ `not_shared_category`, `tenant_inactive`) → câu lỗi trong sheet, nút bấm lại được; gửi lại cùng `client_id` không ghi hai lần.
- 8a. Server trả `already_settled` (409) → "{Tháng} đã chốt rồi. Muốn sửa thì huỷ dòng rồi ghi Chỉnh."; lỗi khác → câu lỗi server.
- 8b. Ô số người không phải số nguyên 1–50 → "Số người chia là số nguyên từ 1."; dòng thiếu tên / số 0 → "Dòng n cần tên." / "Dòng n cần số tiền."; phí hay chi chung âm → "Dòng n không được âm; giảm thì thêm dòng chỉnh.".

## Exceptions
- E1. Offline: nút Ghi chi / Phí một lần / Chỉnh / Chốt tắt, link Huỷ dòng ẩn, kèm "Ghi sổ người thuê cần mạng. Khoản chi nhập tay vẫn ghi được khi không có mạng." (trong sheet chốt: "Chốt tháng cần mạng. …").
- E2. Đọc lỗi: như UC-707 E1/E2 (`Loadable`: "Không có mạng." / "Chưa tải được." + **Tải lại**; bản cache → "Số lúc HH:mm — đang không có mạng.").

## Acceptance Criteria
### AC-1: Dấu số dư nói đúng ai nợ ai
- Given số dư 500.000 / −80.000 / 0
- When hiện danh sách người thuê
- Then lần lượt "còn nợ 500.000 ₫" · "trả dư 80.000 ₫, trừ tháng sau" · "đã hết nợ"
- Tests: `web/src/lib/rental.test.ts` › "số dư người thuê › dương là còn nợ, âm là trả dư mang sang tháng sau"

### AC-2: Tạm tính = phí cố định đang thu + phần chi chung
- Given tháng chưa chốt, hai phí đang thu và một phí đã tắt, tổng chi chung chia 3 người
- When xem tháng
- Then bản nháp có một dòng mỗi phí đang thu (phí tắt không vào) và dòng Chi chung = floor(tổng / 3); "Phải trả" ở sheet chốt bằng tổng các dòng
- Tests: `test/rental.test.ts` › "domain rental › phần chi chung = floor(tổng / số người), phí tắt không vào nháp"; `web/src/lib/rental.test.ts` › "chốt tháng › bản nháp cộng đúng phần phải trả"; bảng: ⚠ Chưa có test

### AC-3: Đổi số người lúc chốt
- Given sheet chốt, số người 3
- When đổi thành 4
- Then dòng Chi chung tính lại floor(tổng / 4), phần lẻ hộ chịu; dòng phí cố định giữ nguyên; server ghi phần chi chung nhỏ hơn
- Tests: `web/src/lib/rental.test.ts` › "chốt tháng › đổi số người: chi chung tính lại, phần lẻ hộ chịu; phí cố định giữ nguyên"; `test/rental.test.ts` › "/v1/rental › đổi số người chia (4) → phần chi chung giảm"

### AC-4: Form chốt chặn số sai
- Given dòng chỉnh âm / dòng phí âm / số người 0
- When bấm Chốt
- Then dòng chỉnh âm được gửi; dòng phí âm và số người 0 bị chặn ở máy
- Tests: `web/src/lib/rental.test.ts` › "chốt tháng › thân yêu cầu: dòng chỉnh được âm, phí không được âm, số người ≥ 1"

### AC-5: Mỗi tháng chốt một lần
- Given tháng 9 đã chốt với An
- When gửi chốt tháng 9 lần nữa
- Then 409 `already_settled`, không thêm dòng nào; sheet hiện "Tháng 9/2026 đã chốt rồi. Muốn sửa thì huỷ dòng rồi ghi Chỉnh."
- Tests: `test/rental.test.ts` › "/v1/rental › chốt lần hai cùng tháng → 409 already_settled, không ghi thêm dòng"; câu trong sheet: ⚠ Chưa có test

### AC-6: Không đi tới tháng chưa tới
- Given đang xem tháng hiện tại
- When xem nút ›
- Then nút tắt; server cũng không cho chốt tháng chưa tới
- Tests: `test/rental.test.ts` › "/v1/rental › không chốt được tháng chưa tới"; nút: ⚠ Chưa có test

### AC-7: Dòng ghi tay gửi đúng dấu và đúng danh mục
- Given ghi chi hộ 200.000 danh mục Chợ nấu / chỉnh giảm 50.000 / phí một lần không tên
- When bấm Ghi
- Then chi hộ gửi `amount: 200000` (dương) và chỉ nhận danh mục chi chung; chỉnh giảm gửi `-50000`; phí một lần không tên bị chặn; gửi lại cùng `client_id` không ghi hai lần
- Tests: `web/src/lib/rental.test.ts` › "dòng ghi tay › người thuê chi hộ: gửi số dương, phải thuộc danh mục chi chung"; `web/src/lib/rental.test.ts` › "dòng ghi tay › chỉnh giảm nợ gửi số âm; phí một lần cần tên"; `test/rental.test.ts` › "/v1/rental › dòng ghi tay idempotent theo client_id; chi hộ chỉ nhận danh mục chi chung"

### AC-8: Huỷ dòng hai bước, số dư theo
- Given một dòng phí một lần 100.000
- When bấm "Huỷ dòng" rồi "Huỷ hẳn dòng này"
- Then lần bấm đầu chưa gọi server; lần hai huỷ dòng, số dư giảm 100.000; huỷ khoản thu tiền trả (ở sổ cái) thì số dư trở lại
- Tests: `test/rental.test.ts` › "/v1/rental › huỷ dòng sổ đổi số dư; huỷ giao dịch tiền trả thì số dư trở lại"; hai bước: ⚠ Chưa có test

### AC-9: Trọn một tháng: tạm tính, chốt, nhận tiền, mang sang
- Given ví dụ của proposal (phí cố định + chi chung, An chuyển 5.191.667)
- When chốt tháng rồi nhận tiền
- Then Cuối tháng −80.000 ("trả dư 80.000 ₫, trừ tháng sau") và tháng sau thấy nó ở Số dư đầu tháng; số dư mở sổ hiện là dòng "Số dư mở sổ"
- Tests: `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau"; `test/rental.test.ts` › "/v1/rental › số dư mở sổ là dòng opening; tháng sau thấy nó ở số dư đầu kỳ"

### AC-10: Ghi sổ người thuê cần mạng
- Given offline, bảng tháng đã có bản cache
- When xem màn
- Then nút Ghi chi / Phí một lần / Chỉnh / Chốt tắt, không có link Huỷ dòng, kèm "Ghi sổ người thuê cần mạng. …"; Chép bảng kê vẫn bấm được
- Tests: ⚠ Chưa có test

### AC-11: Người đã ra còn hiện tới khi hết nợ
- Given người thuê đã tắt "Đang ở", số dư 300.000
- When mở màn Người thuê
- Then vẫn hiện, kèm chip "đã ra"; số dư về 0 thì không hiện nữa
- Tests: ⚠ Chưa có test

### AC-12: Hai con số được gọi đúng tên
- Given An đã ghi sổ còn nợ 4.375.000; tháng hiện tại chưa chốt, bản nháp làm số dư thành 7.498.333
- When mở màn Người thuê
- Then danh sách hiện "còn nợ 4.375.000 ₫" dưới ghi chú "Số đã ghi sổ, chưa gồm tạm tính…"; bảng tháng có dòng "Nếu chốt hôm nay" 7.498.333 (không còn chữ "Cuối tháng (tạm tính)")
- Tests: ⚠ Chưa có test

### AC-13: Sheet chốt gọn một màn
- Given năm phí cố định và dòng chi chung
- When mở sheet Chốt tháng trên điện thoại
- Then mỗi dòng một hàng tên · số · ×; tổng "Phải trả tháng này" luôn thấy ngay trên nút Chốt khi cuộn
- Tests: ⚠ Chưa có test

## Traceability
- Code: `web/src/screens/tenants.tsx` › `TenantsTab`, `TenantMonthCard`, `LineSheet`, `SettleSheet`, `atForMonth`, `KIND_LABEL`, `LINE_TITLE`; `web/src/lib/rental.ts` › `balanceText`, `draftLines`, `withHeadcount`, `settleTotal`, `settlePayload`, `linePayload`; `web/src/ui/clipboard.ts` › `copyText`; `web/src/ui/parts.tsx` › `Loadable`, `NeedsNetwork`; `web/src/screens/wallets.tsx` › `Wallets`, `TABS`; `web/src/state/store.ts` › `WalletsTab`; `web/src/lib/period.ts` › `nextMonth`, `previousMonth`, `monthLabel`; `web/src/lib/types.ts` › `Rental`, `Tenant`, `TenantLine`, `TenantMonth`.
- Backend: rental [UC-801](../rental/UC-801-thiet-lap-nguoi-thue.md), [UC-802](../rental/UC-802-ghi-nguoi-thue-chi-ho.md), [UC-803](../rental/UC-803-xem-tam-tinh.md), [UC-804](../rental/UC-804-chot-thang-voi-nguoi-thue.md), [UC-805](../rental/UC-805-nhan-tien-nguoi-thue-tra.md) (`src/routes/rental.ts`, `src/services/rental.ts`, `src/domain/rental.ts`).

## Divergences & Open Questions
- [DIVERGENCE] Proposal `261001-cho-thue-lai` UC-804: bảng kê có dòng "đề xuất chuyển tháng sau = phí cố định + phần chi chung theo ngân sách"; bảng kê server dựng (`statementText`, `src/domain/rental.ts`) không có dòng này — PWA chỉ chép nguyên `text`.
- [DIVERGENCE] Proposal UC-805 ghi `TenantLine(payment)` khi nhận tiền; code không có loại `payment`: tiền trả là khoản `income` mang `tenant_id`, màn này đọc nó vào nhóm "Đã chuyển" (`payments`), huỷ khoản thu thì số dư tự trở lại.
- [OPEN] Nút Chốt hiện cả ở **tháng hiện tại** (server chỉ chặn tháng chưa tới): chốt giữa tháng thì tổng chi chung bị lưu ở mức lúc chốt (`tenant_settlements.shared_total`), khoản chi chung sau đó trong tháng không còn vào phần người thuê. Proposal chỉ nói chốt ngày 1 cho tháng trước.
- [OPEN] "Huỷ dòng" có ở mọi dòng sổ, kể cả dòng `opening` và các dòng đã chốt; huỷ dòng chốt không gỡ `tenant_settlements`, nên tháng vẫn "Đã chốt" và không chốt lại được — cách sửa duy nhất là ghi Chỉnh (đúng câu hướng dẫn trên màn, nhưng chưa có quyết định cho việc huỷ nhầm cả bộ dòng chốt).
