# 261001-cho-thue-lai: Sổ người thuê + chia theo nguồn thu + ngân sách thật
- Status: implemented (2026-10-01, code + test xanh, commit `034b7ff`; hợp nhất vào `specs/` cùng ngày) — approved 2026-10-01, chủ nhà trả lời hết câu hỏi
- BR: BR-02, BR-04, BR-07 (+ BR-11 bên dưới)
- Đụng tới: allocation UC-201/UC-203 · ingest UC-305 · pwa UC-706/UC-707 · context mới `rental` (UC-801…805)
- Đóng: [OPEN] ADR-55 (nơi đặt Tích sản); [DIVERGENCE] UC-101 `buy_asset` không kiểm phao (chốt: code đúng, sửa `docs/`)
- Người duyệt nghiệp vụ: chủ nhà, vợ · Người duyệt kỹ thuật: …

## History
- v1–v3 (2026-10-01): thử mô hình đợt ở, tính theo ngày ở, bốn `mode` tính phí, cọc, ngân sách tự tăng theo người. **Bỏ ở v4**: chủ nhà đánh giá là quá phức tạp so với cách nhà đang làm thật.
- v4 (2026-10-01): theo cách làm thật — **mỗi tuần ngồi với người thuê một lần để cập nhật, cuối tháng chốt một lần**. Phí cố định + chi chung chia đều theo số người; chênh lệch tự chuyển sang tháng sau.
- v5 (2026-10-01): phao khẩn cấp **chỉ tính tiền mặt** (vàng là tài sản dài hạn). Tiền người thuê **không chia theo tỷ lệ cố định**: vào ví giữ riêng "Thu cho thuê", vợ chồng tự quyết mỗi lần trả nợ hay chuyển sang Tích sản.
- Thi công (2026-10-01, commit `034b7ff`): làm đủ phần trên, **khác proposal ở chỗ**: không có `TenantLine(payment)` — tiền người thuê trả là `income` mang `transactions.tenant_id`, `v_tenant_balance` trừ thẳng (huỷ khoản thu là số dư tự đúng); "một lần mỗi tháng" giữ bằng bảng `tenant_settlements` (PRIMARY KEY người thuê + tháng) thay cho mã `R<yyyymm>-<tenant_id>`; ví "Thu cho thuê" là tier `holding` kind `accrual` (ví Thu nhập là kind `holding`); tool MCP tên `get_tenants` (thay `get_tenant_balance`); không có nguồn `default` — khoản thu không chọn nguồn chia như cũ; bảng kê chưa có dòng "đề xuất chuyển tháng sau". Làm thêm theo yêu cầu chủ nhà: phong bì tháng chia đều theo tuần (`allocations.split_weekly`), bảng ngân sách có `balance` + nút "Bù" ví âm, "Chuyển ngân sách" chỉ đổi ví (`transfer` không tài khoản), `snapshot.reserves`.

## Vì sao

Nhà thuê nguyên căn (22.500.000 ₫/quý), có một người ở ghép (An); sau này có thể thêm hoặc bớt người. Chủ nhà chốt:

1. **Ngân sách hộ là ngân sách gộp**: có người thuê hay không, tiền nhà, điện nước, ăn uống vẫn là tiền phải chi. Ăn uống khi có An là 7.000.000/tháng.
2. **Cho thuê lại là một mảng riêng**: tiền người thuê trả không vào ví chi tiêu. Ưu tiên **trả nợ** (15.379.000), sau đó mới Tích sản; số tiền mỗi lần do vợ chồng quyết (ý 8).
3. **Cách tính với người thuê**:
   - Phí cố định mỗi tháng: nhà, gửi xe, mạng, dịch vụ.
   - Chi chung (ăn uống, điện nước): cộng tổng cả tháng, **chia đều theo số người**.
   - Chi vượt thì người thuê trả thêm; chi không vượt thì trừ vào tiền thu tháng sau.
4. Lương chồng (≈ 19.100.000, đã trừ thuế) chi hết; lương vợ (10–12tr, đã trừ thuế) khóa 45% vào Tích sản.
5. An không đặt cọc. Thẻ xe 100.000 là phí một lần.
6. Nhà có thêm người (con, bố mẹ) thì số người chia tăng, phần của người thuê giảm — đúng ý chủ nhà.
7. Mua vàng khi giá xuống, **không đợi phao đầy**. Phao khẩn cấp là tiền mặt, **không tính vàng**.
8. Tiền người thuê trả vào trả nợ hay Tích sản: **vợ chồng quyết từng lần**, căn cứ khoản nợ nào nên trả bao nhiêu. App không chia sẵn tỷ lệ.

Hiện engine **không làm được ý 2**: mọi khoản thu dùng chung một bộ phần trăm Tích sản/Thuế (`src/domain/allocation.ts` dòng 125–131), phần dư rơi vào ví `remainder`. Tiền An gán `income` sẽ bị chia như lương (~70% vào ví chi tiêu); gán `refund` thì vào thẳng ví chi tiêu.

## Nguyên lý
- **Tiền là thật:** mảng cho thuê ghi thu khi tiền về. Sổ người thuê chỉ là **sổ phải thu**, nằm ngoài sổ cái, không đụng ví nào.
- **Phân bổ trước:** mỗi nguồn thu có phần khóa riêng; nguồn cho thuê khóa 100% vào ví giữ riêng "Thu cho thuê" — tiền đã tách khỏi chi tiêu ngay khi về, việc dùng vào trả nợ hay Tích sản là quyết định của người.
- **Ranh giới hộ:** người thuê không phải `member`; tiền họ chuyển không phải chuyển nội bộ.
- **Đơn giản trước:** app tính sẵn, người quyết khi chốt. Không tự động hoá những gì một buổi ngồi với nhau 5 phút đã giải quyết được.

## Thay đổi spec

### BR mới
- **BR-11: Tiền người thuê không bị tiêu lẫn, và biết họ còn nợ bao nhiêu.**
  - Tiền người thuê trả vào thẳng ví đích của mảng cho thuê, không bao giờ vào ví chi tiêu.
  - Xem được bất cứ lúc nào: người thuê còn nợ / đang được trừ bao nhiêu.
  - Thêm, bớt người thuê là thao tác ở Cài đặt, không phải sửa code.

### Context mới `rental` (UC-801…805)

**Entity**

| Entity | Ý nghĩa | Trường mang nghĩa nghiệp vụ |
|---|---|---|
| **Tenant** (người thuê) | Người ngoài hộ ở cùng nhà. Không đăng nhập, không phải `member` | `name`, `active` |
| **FixedFee** (phí cố định) | Một khoản cố định mỗi tháng của một người thuê | `tenant_id`, `name`, `amount` |
| **SharedSetup** (cấu hình chi chung) | Danh mục nào là chi chung, chia cho mấy người | `category_ids` (ăn uống: `cho-nau`, `an-ngoai`; điện nước: `dien-nuoc`), `headcount` (hiện 3; sửa được lúc chốt) |
| **TenantLine** (dòng sổ người thuê) | Mọi biến động của sổ một người thuê. Chỉ ghi thêm, sai thì `void` | `tenant_id`, `month_key`, `kind`, `amount` (dương = người thuê nợ thêm, âm = giảm nợ), `note`, `transaction_id?`, `status` |

`TenantLine.kind`:

| `kind` | Khi nào | Dấu |
|---|---|---|
| `opening` | Số dư mở sổ (An: 7.075.000) | + |
| `fixed` | Chốt tháng: mỗi FixedFee một dòng | + |
| `shared` | Chốt tháng: `floor(tổng chi chung / headcount)` | + |
| `one_off` | Phí một lần, nhập tay (thẻ xe 100.000) | + |
| `paid_for_us` | Người thuê tự trả bằng tiền của mình một khoản chi chung (đi chợ…) | − |
| `payment` | Người thuê trả tiền, gắn giao dịch `income` | − |
| `adjust` | Chỉnh tay khi chốt (ví dụ ra giữa tháng, giảm tiền nhà) | ± |

**Số dư** = Σ `amount` các dòng `active` (view, không lưu). Dương = người thuê còn nợ; âm = đã trả dư, tự trừ vào tháng sau.

**Tổng chi chung tháng `m`** = Σ (spend − refund) của hộ trong `SharedSetup.category_ids` tháng `m` + Σ `paid_for_us` của mọi người thuê trong tháng `m`.
Phần mỗi người = `floor(tổng / headcount)`. Phần lẻ hộ chịu.

Ví dụ một tháng của An:

| Dòng | Số tiền |
|---|---|
| Nhà | 2.500.000 |
| Gửi xe | 50.000 |
| Mạng | 75.000 |
| Dịch vụ | 66.667 |
| Chi chung: hộ chi ăn 7.300.000 + điện nước 560.000 + An đi chợ 300.000 = 8.160.000 ÷ 3 | 2.720.000 |
| An đã đi chợ | −300.000 |
| **Phải trả tháng này** | **5.111.667** |
| An đã chuyển trong tháng | −5.191.667 |
| **Số dư** | **−80.000** → trừ vào tháng sau |

Không cần khái niệm "tạm thu" hay "quyết toán chênh lệch": số dư mang sang tự làm việc đó.

**UC**
- **UC-801 Thiết lập người thuê.**
  - Thêm/tắt người thuê; danh sách phí cố định; phí một lần; số dư mở sổ.
  - Cấu hình chi chung (danh mục, số người chia).
  - Người thuê ra: tắt `active` sau khi chốt tháng cuối. Số dư ≠ 0 thì vẫn hiện tới khi về 0.
- **UC-802 Ghi người thuê chi hộ.** PWA "Loại khác" → "An chi" (chọn người, danh mục chi chung, số tiền). Tool MCP tương ứng.
- **UC-803 Xem tạm tính (buổi ngồi hằng tuần).**
  - Màn "Người thuê": tổng chi chung từ đầu tháng, phần mỗi người tạm tính, người thuê đã chi hộ bao nhiêu, đã chuyển bao nhiêu, số dư tạm.
  - Chỉ đọc, không ghi gì.
- **UC-804 Chốt tháng với người thuê.**
  - Ngày 1, tin sáng nhắc "Chốt tháng với An". Người bấm "Chốt tháng" trên PWA.
  - App điền sẵn: các dòng `fixed`, dòng `shared`, số người chia. **Người sửa được trước khi lưu** (ví dụ An ra ngày 15 → sửa tiền nhà, hoặc thêm dòng `adjust`).
  - Lưu → ghi các `TenantLine` một lần (idempotent theo `R<yyyymm>-<tenant_id>`). Tháng đã chốt muốn sửa thì `void` dòng và ghi `adjust`.
  - Có nút copy bảng kê để gửi người thuê (dòng phí, đã trả, số dư, đề xuất chuyển tháng sau = phí cố định + phần chi chung theo ngân sách).
- **UC-805 Nhận tiền người thuê trả.**
  - Log `in` ở màn Gán có lựa chọn "Thu từ người thuê" (chọn người). Rule chỉ **gợi ý**, người vẫn bấm xác nhận (giữ luật 6, ADR-02).
  - Xác nhận → ghi `income` với `income_stream_id = cho-thue` → chia theo hồ sơ nguồn → ghi `TenantLine(payment)`.
  - Tiền mặt thì nhập tay vào tài khoản tiền mặt (D14).

**Câu hỏi 4 cũ (người vào/ra giữa tháng)** được trả lời bằng UC-804: app điền sẵn đủ tháng, người sửa tay lúc chốt. Không có công thức tính theo ngày.

### allocation — UC-201/UC-203: chia theo nguồn thu
- **ADDED Entity `IncomeStream`**: `id`, `name`, `locked` = danh sách `{wallet_id, percent}`.
  - Phần khóa lấy theo `locked` của nguồn; phần còn lại chạy dòng thác như cũ. Tổng `locked` = 100% → không chạy dòng thác.
  - Nguồn `default` = bộ luật `percent` hiện tại. **Không khai báo nguồn thì hành vi y như cũ.**
- **ADDED ví `thu-cho-thue`** "Thu cho thuê": `tier = holding`, `kind = holding` (tạo bằng migration vì Cài đặt không tạo được `holding`). Đã kiểm: ví `holding` không vào "còn để chi" (`src/domain/snapshot.ts` dòng 82 chỉ lấy `must`/`envelope`) và không vào trung bình chi Must của phao (`migrations/0001_schema.sql` dòng 303).
- **Dùng tiền trong "Thu cho thuê"** (vợ chồng quyết từng lần, không cần code mới cho phần quyết định):
  - Trả nợ: `spend` từ ví `thu-cho-thue`, danh mục mới `tra-no` "Trả nợ".
  - Sang Tích sản: `transfer` MB → BIDV kèm ví `thu-cho-thue` → `tich-san`.
  - **Khoảng trống cần sửa:** gán log ở màn Gán chưa nhận `from_wallet_id` cho split `transfer` (ingest UC-305 bước 3), nên chưa ghi được chuyển ví khi log ra từ tài khoản có SePay. Thêm `from_wallet_id` vào split; nhập tay đã hỗ trợ (ledger UC-101).
- **ADDED** cột `transactions.income_stream_id` (chỉ có nghĩa với `income`); `rules.income_stream_id`. Nhập tay hoặc gán thì chọn nguồn.
- **MODIFIED UC-201 bước 2:** phần khóa lấy từ `stream.locked` thay vì mọi luật `percent` của `tichsan`/`tax`.
- **MODIFIED UC-201:** fund vào ví đích của nguồn khóa 100% **không** tính vào `fundedThisMonth` của ví chi tiêu, không `underfunded`, không `deficitCovered`.
- **ADDED AC:**
  - Nguồn `cho-thue` = `{thu-cho-thue: 100%}`, khoản 5.191.667 → đúng một fund 5.191.667 vào "Thu cho thuê". Ví chi tiêu, `fundedThisMonth` của ví chi tiêu, "còn để chi" không đổi.
  - Gán log ra 3.000.000 từ MB, split `transfer` sang BIDV với `from_wallet_id = thu-cho-thue`, `wallet_id = tich-san` → số dư "Thu cho thuê" −3.000.000, Tích sản (cash) +3.000.000.
  - Nguồn `luong-chong` (`locked` rỗng) 19.100.000 → toàn bộ vào dòng thác.
  - Nguồn `luong-vo` (`{tich-san: 45%}`) 11.000.000 → Tích sản 4.950.000 trước, 6.050.000 lấp chỗ thiếu.
  - Không có nguồn → trùng từng đồng với bảy case hiện tại (`test/allocation.test.ts`).

### ingest — UC-305
- **MODIFIED:** gán log `in` có thêm `income_stream_id` và `tenant_id`. Rule được phép mang `tenant_id`, nhưng **chỉ để gợi ý**, không tự gán.

### ledger — UC-101
- **MODIFIED:** `buy_asset` (vàng…) được phép bất cứ lúc nào Tích sản còn tiền mặt, **không** cần phao đầy. Code đã làm vậy; sửa `docs/profit_first_phuong_phap.md` §5 cho khớp.
- **Giữ nguyên:** phao khẩn cấp so với **tiền mặt** Tích sản, không tính vàng. Code đã làm vậy: `v_emergency_fund` dùng `v_tichsan.cash` = số dư − Σ `buy_asset` (`migrations/0001_schema.sql` dòng 309–310).

## Quyết định (ADR mới khi hợp nhất)
- **ADR-58** Cho thuê lại là nguồn thu riêng; ghi thu theo tiền thật; sổ người thuê là sổ phải thu nằm ngoài sổ cái. Loại: coi người thuê là `member`; ngân sách ròng; gán `refund` vào ví.
- **ADR-59** Phần khóa theo từng nguồn thu (`IncomeStream`); nguồn `default` giữ hành vi cũ.
- **ADR-60** Tiền vào từ người thuê chỉ được gợi ý, không tự gán.
- **ADR-61** Tính với người thuê = phí cố định + chi chung chia đều theo số người; chốt tay một lần mỗi tháng, chênh lệch mang sang bằng số dư. Loại (v1–v3): tính theo ngày ở, bốn `mode`, ngân sách tự tăng theo người, cọc — quá phức tạp so với cách làm thật.
- **ADR-62** Mua vàng không cần đợi phao đầy; phao chỉ tính tiền mặt, vàng là tài sản dài hạn (thay `docs/profit_first_phuong_phap.md` §5 "phao đầy rồi mới sang assets").
- **ADR-63** Tiền cho thuê vào ví giữ riêng "Thu cho thuê" (`holding`); trả nợ hay chuyển Tích sản do vợ chồng quyết từng lần. Loại: tỷ lệ cố định Trả nợ/Tích sản — chủ nhà muốn quyết theo từng khoản nợ.

## Thiết kế
- Migration `0007`: bảng `tenants`, `tenant_fixed_fees`, `tenant_lines`, `income_streams`; config `rental_shared_categories`, `rental_headcount`; cột `transactions.income_stream_id`, `rules.income_stream_id`, `rules.tenant_id`. View `v_tenant_balance`. Trigger: `tenant_lines` chỉ được đổi `status`. Sao lưu D1 production trước khi chạy.
- `src/domain/rental.ts` (thuần): `monthDraft(fees, sharedTotal, headcount, paidForUs) → TenantLine[]`.
- `src/domain/allocation.ts`: thêm `stream` vào `AllocationInput`.
- `src/services/rental.ts`, route `/v1/rental/*`, tool MCP `get_tenant_balance`, `add_tenant_paid_for_us`.
- PWA: màn "Người thuê" (tạm tính + nút Chốt tháng + copy bảng kê), "An chi" ở "Loại khác", "Thu từ người thuê" ở màn Gán, mục "Cho thuê" và "Nguồn thu" ở Cài đặt.
- Tin sáng ngày 1: thêm dòng nhắc chốt tháng với từng người thuê đang `active`.

## Cấu hình không cần code (làm ngay được ở Cài đặt)

| Ví | Phe/nhóm | Nạp | Ghi chú |
|---|---|---|---|
| Nhà ở | must/must, accrual | flat 7.500.000/tháng, sàn 7.500.000 | thay `lump` 8tr (lump đòi trọn số mỗi tháng, sai với tiền nhà trả theo quý) |
| Ăn uống | must/must, envelope | 7.000.000/tháng | về 5.000.000 khi không còn người thuê (sửa ở Cài đặt) |
| Điện nước · mạng · dịch vụ | must/must, bill | 925.000/tháng | |
| Đi lại (sửa xe, xăng) | must/must, envelope | 500.000/tháng | |
| Về quê (xe khách + chi tiêu) | must/must, accrual | 1.500.000/tháng | |
| Thuốc thang | must/must, accrual | 1.000.000/tháng | |
| Thu cho thuê | holding | nhận 100% tiền người thuê | tạo bằng migration 0007; đặt ở MB chính |
| Học tập | must/have, accrual | 2.000.000 | |
| Tập luyện | must/have, envelope | 3.000.000 | |
| Thiện phước | must/have, accrual | 500.000 | |
| Mua sắm | nice, envelope | 500.000 | thay hai ví Chơi mẫu (820k/tuần) nếu không dùng |
| Khác | Có thì tốt (remainder) | phần dư | |

Tài khoản: MB chính (chồng, SePay, giữ Thu nhập và ví chi), MB chi tiêu (vợ, SePay), MB tiết kiệm (vợ, SePay), **BIDV (chồng, ghi tay) → giữ Tích sản**, Techcombank (vợ, ghi tay), tiền mặt.

## Bảng tiền một tháng (ước tính)

| | Số tiền |
|---|---|
| Lương chồng + lương vợ | 19.100.000 + ~11.000.000 = **30.100.000** |
| Ngân sách chi gộp | **24.925.000** |
| Khóa Tích sản 45% lương vợ | 4.950.000 |
| Còn lại cho chi tiêu | 25.150.000 → dư ~225.000 vào Khác |
| An (ước) | **≈ 5.190.000** → "Thu cho thuê" |
| Hết nợ 15.379.000 nếu dồn hết tiền cho thuê | ≈ 2 tháng (7.075.000 đang nợ + ~2 tháng phí) |
| Sau khi hết nợ, nếu chuyển hết sang Tích sản | ≈ 4,95tr + 5,19tr ≈ **10,1tr/tháng** (~29% tổng tiền vào) |

## Việc cần làm
- [x] Chủ nhà trả lời câu hỏi → Status `approved`
- [x] Test `src/domain/rental.ts` (ví dụ bảng trên; số dư âm mang sang; headcount 4)
- [x] Test allocation theo nguồn thu (không có nguồn thì trùng bảy case cũ)
- [x] Migration 0007 + domain + service + route + MCP + PWA + dòng nhắc tin sáng
- [x] Hợp nhất vào `specs/` (allocation, ingest, ledger, pwa, notify, context `rental`), thêm ADR-58…63; sửa `docs/profit_first_phuong_phap.md` §5
- [x] Gán log: thêm `from_wallet_id` cho split `transfer`; danh mục `tra-no`
- [x] Sinh lại `traceability.md`, `open-issues.md`

