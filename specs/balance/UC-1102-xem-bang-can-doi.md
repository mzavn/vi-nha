# UC-1102: Xem bảng cân đối, tháp tài sản và lịch sử theo tháng
- Status: implemented
- BR: BR-15, BR-12, BR-13, BR-05
- Decisions: ADR-99 (tiền, phải thu, nợ luôn từ sổ; tài sản mua qua app thôi hiện khi có mục cùng loại), ADR-100 (mọi tổng và lịch sử tính theo trạng thái tại từng ngày bằng một câu SQL mỗi nguồn gộp theo tháng; `deactivated_at`), ADR-101 (dòng tiền thật tách lợi suất kỳ vọng), ADR-106 (lãi vay dự kiến tháng của khoản nợ), ADR-107 (thẻ tín dụng còn nợ là nợ ngắn hạn), ADR-12 / ADR-54 (trần CPU Workers Free)
- Actor: người trong hộ (màn **Tài sản & tự do** › Cân đối, Tháp — [pwa/UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md)); Claude qua MCP `get_balance_sheet` ([mcp/UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md))
- Trigger: `GET /v1/balance-sheet?date=YYYY-MM-DD` (tuỳ chọn, mặc định hôm nay); `GET /v1/balance-sheet/history?months=N` (mặc định 12, tối đa 60)

## History
- v1 (2026-10-08, commit `8cd48b8`): khởi tạo — bảng cân đối A / B / C / D tại một ngày từ dòng từ sổ (tiền — thẻ tín dụng âm sang nợ ngắn hạn, phải thu theo kỳ hạn, người thuê, nợ theo kỳ hạn × nhóm lãi, tài sản mua qua app chưa gắn mục) + mục nhập tay; % trên tổng nguồn vốn / vốn chủ, tiền lãi/năm, lãi tháng này; tháp năm tầng; dòng tiền thật và dòng tiền ròng sau bù lạm phát; lịch sử cuối tháng theo trạng thái tại từng tháng (`deactivated_at`); một câu SQL mỗi nguồn (≤ 11 câu cho lịch sử, kể cả câu của lớp xác thực); dòng giá trị 0 không hiện ở A / B; CPU đo trên prod: P50 11,0 ms, max 14,8 ms (schema v1.31) (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))

## Preconditions
- Đã đăng nhập (access UC-501/UC-502) hoặc Claude có quyền Xem. Đọc khi có mạng; mất mạng thì màn hiện bản lưu (pwa UC-717).

## Main Flow
1. Người mở **Tài sản & tự do** › Cân đối. App dựng bảng **tới cuối ngày D** (mặc định hôm nay giờ VN) theo [Công thức 1–7](README.md#công-thức): tiền, phải thu, nợ **luôn** lấy từ sổ; mục nhập tay lấy giá trị mới nhất có ngày ≤ D ([UC-1101](UC-1101-quan-ly-tai-san-lo-gia.md)).
   - Kỹ thuật: `GET /v1/balance-sheet?date=` → `getBalanceSheet` → `loadSources` (một batch, mỗi nguồn một câu gộp theo tháng giờ VN) + `debtInterest` (lãi dự kiến tháng của D) → `sheetAt`.
2. **A. Tài sản ngắn hạn**, **B. Tài sản dài hạn** theo mục `A1`…`B6` (ẩn mục trống; dòng có giá trị 0 không hiện): dòng từ sổ trước, rồi mục nhập tay theo thứ tự. Dòng từ sổ: "Tiền trong app" (`A1`), "Phải thu ngắn hạn" (`A3`) / "Phải thu dài hạn" (`B1`), "Người thuê còn nợ" (`A3`), "Vàng / Chứng khoán / Chứng chỉ quỹ / Bất động sản mua qua app (giá mua)" khi chưa có mục gắn cùng loại. Mỗi dòng có % trên tổng nguồn vốn, % trên vốn chủ, dòng tiền thật/tháng, lợi suất kỳ vọng, ngày định giá; mục theo lô kèm số lượng, lãi / lỗ chưa chốt và số lô đã chạm chốt lời / cắt lỗ.
3. **C. Nợ phải trả** theo Ngắn hạn / Dài hạn × Không lãi / Lãi thường / Lãi cao (ngưỡng `fi_high_interest_bps`): mỗi khoản nợ có lãi suất, tiền lãi/năm, **lãi tháng này** ([Công thức 18](README.md#công-thức)), ngày trả; thẻ tín dụng đang âm ("Thẻ tín dụng · {tên}") và người thuê trả trước ở Ngắn hạn › Không lãi; hàng cuối tổng tiền lãi mỗi năm.
4. **D. Vốn chủ** = Tổng tài sản − Nợ phải trả; % trên vốn chủ "—" khi vốn chủ ≤ 0.
5. **Tháp**: năm tầng (Mạo hiểm · Tăng trưởng · Tạo thu nhập · Phòng vệ · Cố định) với tổng và % trên tổng tài sản; Σ năm tầng = tổng tài sản. Kèm **dòng tiền thật** (P) và **dòng tiền ròng sau bù lạm phát** (P_ròng, `fi_inflation_bps`) mỗi tháng.
6. **Theo tháng**: mỗi cuối tháng một điểm cho N tháng gần nhất (tháng đang chạy là hôm nay), bỏ các tháng trước tháng sớm nhất có dữ liệu (giao dịch, dòng nợ / phải thu / người thuê, `buy_asset`, ngày mở sổ tài khoản, định giá, lô). Mỗi điểm: tổng tài sản, nợ, vốn chủ, chênh vốn chủ so điểm trước, tổng theo tầng — bằng đúng bảng của ngày đó. Khoản tắt tính theo trạng thái tại từng tháng: có mặt ở các ngày trước ngày tắt (`deactivated_at`), vắng từ ngày tắt.
   - Kỹ thuật: `GET /v1/balance-sheet/history?months=N` → `getBalanceHistory`: một lần `loadSources` tới hôm nay, cộng dồn theo tháng ở JS (`sheetAt` cho từng cuối tháng); không câu nào lặp theo tháng hay theo mục. Điểm không kèm lãi tháng này.
7. Bảng là số thật để xem: không đổi ví, số dư, "còn để chi" hay chia tiền. Câu chân: "Vốn chủ = tài sản − nợ. Tiền, nợ, phải thu lấy từ sổ. Số ở đây không đổi ví hay số còn để chi."

## Alternative Flows
- 1a. **Xem tại một ngày trước** (`?date=`): như bước 1–5 với D là ngày đó; tài khoản có `opened_at` sau D, lô mua sau D, định giá sau D không tính.
- 1b. **MCP** `get_balance_sheet { date? }`: cùng số với `GET /v1/balance-sheet`, kèm khối `freedom` (luôn tính theo hôm nay — [UC-1103](UC-1103-moc-tu-do.md), mcp UC-602).
- 2a. Dòng từ sổ chạm → màn nguồn (tab Nợ / Tài khoản), không mở sheet sửa; mục nhập tay chạm → sheet mục ([UC-1101](UC-1101-quan-ly-tai-san-lo-gia.md)).
- 4a. Không có mục nhập tay, không có thẻ tín dụng: vốn chủ = `netWorth`, Tiền trong app = `cash` của tab Nợ (receivable [UC-1005](../receivable/UC-1005-xem-buc-tranh-tien-that.md)).

## Exceptions
- E1. `date` sai dạng → 400 `invalid_input`; `date` sau hôm nay → 400 `future_date`.
- E2. `months` không phải số nguyên 1–60 → 400 `invalid_input`.
- E3. MCP: lỗi nghiệp vụ trả `isError: true`.

## Postconditions
- Không ghi gì (chỉ đọc).

## Acceptance Criteria

### AC-1: Bảng mẫu — tổng, %, nợ theo kỳ hạn và nhóm lãi
- Given hôm nay 2026-11-15; Σ sổ tài khoản đang dùng 30.000.000 (không có thẻ tín dụng); Vàng như UC-1101 AC-2 (126.000.000, `A1` phòng vệ); Chứng khoán `A2` tạo thu nhập 50.000.000 (dòng tiền 3.000.000/năm); Đất nền `B3` tăng trưởng 600.000.000; sổ phải thu 5.000.000; sổ nợ "Vay người nhà" 300.000.000 lãi 0% dài hạn, "Vay tiêu dùng" 20.000.000 lãi 18%/năm ngắn hạn; ngưỡng lãi cao 15%
- When `GET /v1/balance-sheet`
- Then tổng tài sản 811.000.000, nợ 320.000.000, vốn chủ 491.000.000; Vàng 15,5% tổng nguồn vốn, 25,6% vốn chủ; "Vay tiêu dùng" ở Ngắn hạn › Lãi cao, tiền lãi 3.600.000 ₫/năm, lãi tháng này 300.000 ₫; "Vay người nhà" ở Dài hạn › Không lãi, 0 ₫/năm; tổng tiền lãi 3.600.000 ₫/năm
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-1 (bảng mẫu): tài sản 811.000.000, nợ 320.000.000, vốn chủ 491.000.000; Vàng 15,5% / 25,6%; Vay tiêu dùng ngắn hạn lãi cao 3.600.000/năm, tháng này 300.000"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "bảng cân đối: số và chữ › UC-1102 AC-1: dòng Vàng \"15,5% tổng · 25,6% vốn chủ · giá ngày 1/11\"; Vay tiêu dùng \"18%/năm · lãi 3.600.000 ₫/năm · tháng này 300.000 ₫\"; khoản 0% không có phần lãi"

### AC-2: Tháp tài sản và dòng tiền ròng
- Given như AC-1 (tiền trong app, phải thu ở tầng phòng vệ)
- When xem tháp
- Then phòng vệ 161.000.000 (19,8%), tạo thu nhập 50.000.000 (6,1%), tăng trưởng 600.000.000 (73,9%), mạo hiểm 0, cố định 0; Σ tầng = tổng tài sản; dòng tiền thật 250.000 ₫/tháng, dòng tiền ròng sau bù lạm phát (3,5%) 104.166 ₫/tháng
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-2 (tháp): phòng vệ 161.000.000 (19,8%), tạo thu nhập 50.000.000 (6,1%), tăng trưởng 600.000.000 (73,9%); dòng tiền 250.000, sau lạm phát 104.166"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "bảng cân đối: số và chữ › UC-1102 AC-2: chân tháp \"Dòng tiền thật 250.000 ₫/tháng · sau bù lạm phát 104.166 ₫/tháng\"; UC-1102 AC-3: hàng tháng có chênh so tháng trước"

### AC-3: Lịch sử cuối tháng
- Given như AC-1; tài khoản mở 2026-09-01 và không có giao dịch từ 2026-10-01; Chứng khoán định giá 2026-09-30; Đất nền 2026-10-01; khoản nợ và phải thu mở sổ 2026-09-01; giá vàng 5.000.000 ngày 2026-10-01, 5.250.000 ngày 2026-11-01
- When `GET /v1/balance-sheet/history?months=2`
- Then đúng hai điểm: 2026-10 (31/10) tổng tài sản 805.000.000, vốn chủ 485.000.000; 2026-11 (hôm nay) 811.000.000, 491.000.000, chênh +6.000.000; mục chưa có định giá / lô trước một ngày thì không vào điểm đó (30/9: chưa có Đất nền; vàng chưa có giá → lô theo giá mua)
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-3 (lịch sử): months=2 → 31/10 tài sản 805.000.000 vốn chủ 485.000.000; hôm nay 811.000.000 / 491.000.000, chênh +6.000.000; mục chưa định giá không vào điểm trước"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "bảng cân đối: số và chữ › UC-1102 AC-2: chân tháp \"Dòng tiền thật 250.000 ₫/tháng · sau bù lạm phát 104.166 ₫/tháng\"; UC-1102 AC-3: hàng tháng có chênh so tháng trước"

### AC-4: Tài sản mua qua app thôi hiện khi có mục cùng loại (ADR-99)
- Given mua qua app (`buy_asset`) Vàng 2.000.000 và Chứng chỉ quỹ 1.000.000; có mục "Vàng" gắn loại `gold`, không mục nào gắn `fund`
- When xem bảng
- Then không có dòng "Vàng mua qua app"; có dòng từ sổ "Chứng chỉ quỹ mua qua app (giá mua) 1.000.000 ₫" ở `A2`
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-4 (tài sản mua qua app — ADR nháp A): Vàng có mục gắn gold → không còn dòng giá mua; Chứng chỉ quỹ chưa gắn → dòng từ sổ ở A2"

### AC-5: Khớp tab Nợ
- Given không có mục nhập tay, không có thẻ tín dụng
- When so `GET /v1/balance-sheet` với `GET /v1/networth`
- Then vốn chủ = `netWorth` (receivable UC-1005); Tiền trong app = `cash`
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-5 (khớp tab Nợ): không mục nhập tay, không thẻ tín dụng → vốn chủ = netWorth, Tiền trong app = cash"

### AC-6: Vốn chủ ≤ 0 không chia
- Given vốn chủ ≤ 0 (tiền 1.000.000, nợ 10.000.000)
- When xem
- Then % trên vốn chủ của mọi dòng hiện "—", không chia cho 0 hay số âm
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-6: vốn chủ ≤ 0 → % trên vốn chủ là —"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "bảng cân đối: số và chữ › phần trăm cắt một chữ số lẻ, dấu phẩy; mẫu số 0 → \"—\" (balance UC-1102 AC-6)"

### AC-7: Thẻ tín dụng còn nợ là nợ ngắn hạn (ADR-107)
- Given như AC-1 nhưng tài khoản thường Σ sổ 33.000.000 và thẻ tín dụng "Thẻ VCB" (`kind = credit`) sổ −3.000.000 (Σ sổ vẫn 30.000.000 = `cash`)
- When xem
- Then `A1` "Tiền trong app" 33.000.000; C › Ngắn hạn › Không lãi có "Thẻ tín dụng · Thẻ VCB 3.000.000 ₫" (chip "từ sổ"); tổng tài sản 814.000.000, nợ 323.000.000, vốn chủ 491.000.000 (không đổi); thẻ dương (trả dư) 500.000 thì nằm ở `A1`, không ở C
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-7 (thẻ tín dụng — ADR nháp I): thẻ âm 3.000.000 sang Nợ ngắn hạn không lãi; tài sản 814.000.000, nợ 323.000.000, vốn chủ 491.000.000; thẻ dương ở A1"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "bảng cân đối: số và chữ › UC-1102 AC-7: thẻ tín dụng còn nợ ghi \"Thẻ tín dụng · Thẻ VCB\"; dòng từ sổ chạm → màn nguồn (pwa UC-717 AC-1)"

### AC-8: Tài khoản không có ngày mở sổ
- Given thêm tài khoản "Ví cũ" `opened_at = NULL` số dư đầu 5.000.000
- When xem bảng và lịch sử `months=2`
- Then nó có trong Tiền trong app của cả hai điểm; Tiền trong app hôm nay = Σ `v_account_book` = `cash` của UC-1005
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-8 (tài khoản không có ngày mở sổ): có trong Tiền trong app của cả hai điểm; hôm nay = Σ v_account_book"

### AC-9: Số câu SQL của lịch sử (Workers Free)
- Given DB mẫu: 3 tài khoản, 24 tháng × 300 giao dịch, 10 mục (5 theo lô, 5 theo giá trị), 50 lô, 300 dòng định giá, 5 khoản nợ, 5 khoản phải thu
- When `GET /v1/balance-sheet/history?months=24`
- Then 24 điểm; mỗi nguồn đúng một câu SQL trong một batch — tài khoản, giao dịch theo tài khoản × tháng, dòng nợ + trả nợ theo khoản × tháng, phải thu (dòng + cho vay / thu hồi) theo khoản × tháng, người thuê theo tháng, `buy_asset` theo loại × tháng, mục, định giá, lô, tham số — cộng một câu của lớp xác thực: ≤ 11 câu, không câu nào lặp (đếm bằng D1 bọc trong test); mỗi điểm có tổng tài sản, nợ, vốn chủ bằng đúng `GET /v1/balance-sheet?date=` của cuối tháng đó. CPU đo khi apply: Node 15,9 ms wall time cho 24 tháng; prod (7 request đầu của `/v1/balance-sheet`, `/history?months=12`, `/debts`, `/networth`) P50 11,0 ms, max 14,8 ms, 0 lỗi — trần ADR-12 là 10 ms (xem [DIVERGENCE] dưới)
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-9 (số câu SQL — Workers Free): lịch sử 24 tháng một câu mỗi nguồn, không câu nào lặp; mỗi điểm bằng bảng của đúng ngày đó"

### AC-10: Khoản đã tắt — theo trạng thái tại từng tháng
- Given như AC-3, thêm tài khoản "MB cũ" có 4.000.000 ngày 31/10, chuyển hết sang tài khoản khác ngày 9/11 rồi tắt ngày 10/11; khoản nợ "Vay cũ" còn 10.000.000 ngày 31/10, tắt ngày 10/11; một tài khoản đã tắt từ trước migration 0031 (`deactivated_at` NULL)
- When `GET /v1/balance-sheet/history?months=2`
- Then 2026-10: tổng tài sản 809.000.000, nợ 330.000.000, vốn chủ 479.000.000 (có "MB cũ", "Vay cũ"); 2026-11: tổng tài sản 815.000.000, nợ 320.000.000, vốn chủ 495.000.000 (không còn hai khoản đó); tài khoản tắt từ trước migration không có ở tháng nào (như hôm nay); bật lại "Vay cũ" thì nó có mặt ở mọi tháng như chưa từng tắt
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1102 bảng cân đối, tháp, lịch sử › UC-1102 AC-10 (tắt — theo trạng thái tại từng tháng): MB cũ và Vay cũ có ở 31/10, vắng từ ngày tắt; tắt trước v1.31 vắng mọi tháng; bật lại có mặt như chưa tắt"

## Dependencies
- Upstream UC: [UC-1101](UC-1101-quan-ly-tai-san-lo-gia.md) (mục, định giá, lô); ledger [UC-101](../ledger/UC-101-nhap-tay-khoan-tien.md) (giao dịch, `buy_asset`); debt [UC-901](../debt/UC-901-them-va-xem-khoan-no.md) (khoản nợ, lãi suất, kỳ hạn, `deactivated_at`), [UC-902](../debt/UC-902-tra-no.md) (trả nợ, trả lãi); receivable [UC-1001](../receivable/UC-1001-them-va-xem-khoan-phai-thu.md) (phải thu, kỳ hạn, `deactivated_at`); rental (người thuê); access [UC-506](../access/UC-506-cau-hinh-tai-khoan-vi-luat-nap.md) (`opened_at`, `deactivated_at` của tài khoản), [UC-507](../access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md) (`fi_high_interest_bps`, `fi_inflation_bps`).
- Downstream UC: [UC-1103](UC-1103-moc-tu-do.md) (Mốc tự do đọc bảng hôm nay), receivable [UC-1005](../receivable/UC-1005-xem-buc-tranh-tien-that.md) (`balanceItems`, `netWorth` = vốn chủ), pwa [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md), mcp [UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md).
- External Systems: Cloudflare Workers / D1 (trần CPU — ADR-12).

## Divergences & Open Questions
- [DIVERGENCE] ADR-12 đặt trần 10 ms CPU mỗi request (Workers Free) và UC-1102 AC-9 đòi đo CPU khi apply; đo trên prod lát 1 (7 request đầu của `/v1/balance-sheet`, `/v1/balance-sheet/history?months=12`, `/v1/debts`, `/v1/networth`) ra P50 11,0 ms, max 14,8 ms — vượt trần dù số câu SQL đã gom đúng (≤ 11). Request vượt trần có thể bị chặn nếu tài khoản còn ở gói Free; ADR-54 (lên Workers Paid) vẫn chờ chủ nhà. → Chủ nhà: xác nhận gói / lên Workers Paid (ADR-54), hoặc giao việc giảm CPU của bảng cân đối và lịch sử.
- [OPEN] Sổ người thuê không có ngày tắt: bảng và lịch sử chỉ tính người thuê **đang bật** (`tenants.active = 1`), nên tắt một người thuê làm số "Người thuê còn nợ / trả trước" của họ biến mất khỏi mọi tháng trước — khác cách tính theo trạng thái tại từng tháng của tài khoản, khoản nợ, khoản phải thu (quyết định 14 của change chỉ nêu ba loại này). Có cần `deactivated_at` cho người thuê không? → chủ nhà.

## Traceability
- Code: `src/services/balance.ts` › `loadSources`, `getBalanceSheet`, `sheetDate`, `getBalanceHistory`, `itemsTotal`; `src/domain/balance.ts` › `sheetAt`, `itemAt`, `cumulative`, `firstDataMonth`, `monthsBack`, `monthEnd`, `pct`; `src/domain/interest.ts` › `interestGroup`, `yearlyInterest`; `src/services/debts.ts` › `debtInterest` (lãi tháng này); `src/routes/balance.ts`; MCP `get_balance_sheet` ở `src/mcp/tools.ts`
- API / sự kiện: `GET /v1/balance-sheet?date=` → `{ date, today, totalAssets, totalLiabilities, equity, interestPerYear, cashflowMonthly, netCashflowMonthly, assets, liabilities, pyramid, items }`; `GET /v1/balance-sheet/history?months=` → `{ points: [{ month, date, totalAssets, totalLiabilities, equity, change, pyramid }] }` (lỗi `invalid_input`, `future_date`) — hình dạng ở [entities.md](entities.md)
- Dữ liệu: đọc `accounts` (`opening_balance`, `opened_at`, `kind`, `active`, `deactivated_at`), `transactions`, `debts` + `debt_lines`, `receivables` + `receivable_lines`, `tenants` + `tenant_lines`, `balance_items`, `balance_values`, `balance_lots`, `config` (`fi_high_interest_bps`, `fi_inflation_bps`) — migration `migrations/0031_balance_sheet.sql`
- PWA: `web/src/screens/net-worth.tsx` (Cân đối, Tháp, Theo tháng); `web/src/lib/net-worth.ts` (`SECTION_LABEL`, `PYRAMID`, `TERM_LABEL`, `INTEREST_GROUP_LABEL`, chữ dòng phụ)
