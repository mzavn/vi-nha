# UC-1107: Thử số / Dự phóng — gõ giả định trên nền số thật, không lưu
- Status: implemented
- BR: BR-15
- Decisions: ADR-105 (Thử số tính ở máy, không lưu — hàm thuần ở web, số gõ chỉ trong bộ nhớ màn); ADR-99 (điểm xuất phát là số thật: tài sản đầu tư, nợ từ bảng cân đối); ADR-101 (lợi suất kỳ vọng chỉ để dự phóng — làm mặc định ô lợi suất, không phải thu nhập)
- Actor: người trong hộ (màn Tài sản & tự do › Thử số, [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md))
- Trigger: mở phần Thử số (`#net-worth/projection`); mỗi lần sửa một ô

## History
- v1 (2026-10-08, commit `d4f0ab3`): khởi tạo — Thử số / Dự phóng: điểm xuất phát `GET /v1/freedom` › `projectionStart`, card Giả định, Kết quả (năm đạt F1 / F2 so tuổi mục tiêu), bảng theo năm tính ở máy (`web/src/lib/projection.ts`), Đặt lại về số thật, số gõ giữ trong bộ nhớ trang; không có request ghi, không có tool MCP (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))

## Preconditions
- Đã đăng nhập; đã đọc được `GET /v1/freedom` (điểm xuất phát). Thử số không có bảng, không có API ghi, không có tool MCP (không phải số thật — [UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md)).

## Main Flow
1. Người dùng mở **Thử số**. Trên cùng dải cảnh báo dính khi cuộn: "**Số thử — không lưu, không phải số thật.**" + nút **Đặt lại về số thật**.
2. App lấy **điểm xuất phát** (số thật) từ `GET /v1/freedom` › `projectionStart` ([UC-1103](UC-1103-moc-tu-do.md)):
   - tài sản đầu tư A và nợ L hôm nay (bảng cân đối, [UC-1102](UC-1102-xem-bang-can-doi.md));
   - các dòng thu nhập ròng / tháng: các dòng chia theo người của bản kế hoạch mới nhất năm nay ([UC-1104](UC-1104-ke-hoach-thu-nhap.md)) — dòng có người ghi kèm tên người ("Lương · Chồng") để hai dòng "Lương" không lẫn; bản chỉ có mục tiêu cả nhà → một dòng "Cả nhà"; chưa có kế hoạch → một dòng "Cả nhà" = thu nhập TB 3 tháng đã kết thúc của sổ; không có cả hai → không có dòng;
   - chi phí E, E_must (như Mốc tự do; không có số → 0), lạm phát, SWR, hệ số F2, năm sinh, tuổi mục tiêu F1 / F2;
   - lợi suất kỳ vọng mặc định = bình quân theo giá trị của các mục tài sản đầu tư có lợi suất kỳ vọng ([UC-1101](UC-1101-quan-ly-tai-san-lo-gia.md)); không có thì trống;
   - tỷ lệ để dành mặc định = tỷ lệ để dành 3 tháng đã kết thúc gần nhất ([UC-1106](UC-1106-ket-qua-thu-chi.md)); chưa đủ 3 tháng thì trống.
3. Card **Giả định** (thu gọn / mở được), mọi ô sửa được: Tài sản đầu tư, Nợ; mỗi dòng thu nhập (tên, số / tháng, "+ % / năm" mặc định 0, Xoá) và **Thêm dòng thu nhập** (dòng mới "Thu nhập thêm"); Để dành `Phần còn lại` (thu nhập − chi phí, mặc định) / `Tỷ lệ cố định` (+ ô "Tỷ lệ để dành %"); Chi phí tháng (E); Chi Must tháng; Lợi suất %/năm; Lạm phát %/năm; SWR %; Năm sinh; Tuổi F1; Tuổi F2. Ô tiền dùng ô số có phép tính (`AmountInput`). Hệ số F2 lấy từ thông số, không có ô riêng.
4. Mỗi lần sửa, bảng tính lại ngay ở máy ([Công thức 16](README.md#công-thức)), năm t = 1…40 (năm = năm nay + t), mọi số làm tròn tới đồng từng bước:
   - thu nhập_t = Σ dòng round(thu nhập × (1 + tăng)^t); chi phí_t = round(E × (1 + lạm phát)^t) (chế độ Phần còn lại) — chế độ Tỷ lệ cố định không dùng E;
   - để dành / tháng = thu nhập_t − chi phí_t, hoặc round(thu nhập_t × tỷ lệ);
   - tài sản đầu tư cuối năm A_t = round(A_{t−1} × (1 + lợi suất)) + 12 × để dành; ròng_t = A_t − L (nợ giữ nguyên);
   - F1 hôm nay = ⌈12 × E_must ÷ SWR⌉, F2 hôm nay = ⌈12 × E × hệ số ÷ SWR⌉ (từ các ô đang gõ); F1_t, F2_t = round(F hôm nay × (1 + lạm phát)^t); % = ròng_t ÷ F_t (cắt một chữ số lẻ); đạt khi F_t > 0 và ròng_t ≥ F_t.
5. Card **Kết quả**: "F1 ở 46 tuổi (2036) — trễ 1 năm", "F2 ở 49 tuổi (2039) — sớm 1 năm" ("đúng mục tiêu" khi trùng năm; không có năm sinh: "F1 năm 2036"; không có tuổi mục tiêu: bỏ phần so; không tới trong 40 năm: "Chưa tới F1 trong 40 năm"); dòng phụ "F1 hôm nay X · F2 hôm nay Y; mỗi năm quy theo lạm phát."
6. Card **Theo năm**: mỗi năm một hàng — "2027 · 37 tuổi" (chip "F1" / "F2" ở năm đạt), tài sản đầu tư ròng bên phải; dòng phụ "thu 45.600.000 ₫ · chi 20.700.000 ₫ · để dành 24.900.000 ₫/tháng (54,6%)" (tỷ lệ cố định: "chi phí theo tỷ lệ"); hai thanh mảnh F1 / F2 kèm %. Bảng dài tới năm muộn nhất trong các năm đạt F1, F2 và năm tuổi mục tiêu F1, F2 (tối đa 40 năm); có mốc nào chưa tới trong 40 năm thì đủ 40 năm.
7. **Đặt lại về số thật** đưa mọi ô về điểm xuất phát. Số gõ chỉ nằm trong bộ nhớ của trang: rời phần / màn rồi quay lại vẫn còn; tải lại app thì về số thật. Không gửi server, không ghi DB, không đổi bảng cân đối, sổ, thông số hay kế hoạch thu nhập.

## Alternative Flows
- 3a. Ô lợi suất, lạm phát hay % tăng của dòng thu nhập để trống → tính là 0%.
- 3b. Dòng thu nhập để trống tên → tính với tên "Thu nhập".
- 4a. E_must hoặc E bằng 0 (chưa có chi phí) → F1 / F2 hôm nay 0: không bao giờ "đạt", % "—".

## Exceptions
- E1. Ô sai → báo ngay tại ô, bảng chờ ("Sửa các ô đỏ ở Giả định để tính."): SWR trống ("Nhập tỷ lệ rút an toàn.") hoặc ngoài (0, 20%]; tỷ lệ để dành trống khi chọn Tỷ lệ cố định ("Nhập tỷ lệ để dành.") hoặc ngoài 0–100%; % tăng / lợi suất ngoài −100…100%; lạm phát ngoài 0–50%; năm sinh ngoài 1900…năm nay; tuổi ngoài 1–100 hoặc không nguyên; chữ không phải số.

## Postconditions
- Không có gì được ghi.

## Acceptance Criteria

### AC-1: Bảng mẫu — năm đạt F1 / F2 so tuổi mục tiêu
- Given điểm xuất phát A 806.000.000, L 320.000.000; thu nhập Chồng 30.000.000 +10%/năm, Vợ 12.000.000 +5%/năm; E 20.000.000; để dành = phần còn lại; lợi suất 6%; lạm phát 3,5%; SWR 3,5%; hệ số 110%; E_must 15.000.000; năm sinh 1990; F1 45 tuổi, F2 50 tuổi; năm nay 2026
- When tính
- Then hàng 2027 (37 tuổi): thu nhập 45.600.000, chi phí 20.700.000, để dành 24.900.000/tháng (54,6%), tài sản đầu tư cuối năm 1.153.160.000, ròng 833.160.000, F1 15,6%, F2 10,6%; F1 đạt năm 2036 (46 tuổi — trễ 1 năm), F2 đạt năm 2039 (49 tuổi — sớm 1 năm); bảng tới năm tuổi mục tiêu lớn nhất (2040); điểm xuất phát lấy đúng số thật từ `projectionStart` (A, L, dòng thu nhập theo kế hoạch năm nay, E, lợi suất kỳ vọng bình quân theo giá trị), dòng của một người ghi "Lương · Chồng"; không tới mốc trong 40 năm → "Chưa tới F1 trong 40 năm"; không có năm sinh → không có tuổi, bỏ phần so mục tiêu; ô sai báo tại ô
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1103 Mốc tự do › projectionStart (UC-1107): điểm xuất phát là số thật — A, L, dòng thu nhập theo kế hoạch năm nay, E, lợi suất kỳ vọng bình quân theo giá trị"; [`web/src/lib/projection.test.ts`](../../web/src/lib/projection.test.ts) › "Thử số / Dự phóng (tính ở máy, không lưu) › UC-1107 AC-1: hàng 2027 (37 tuổi) — thu nhập 45.600.000, chi phí 20.700.000, để dành 24.900.000/tháng (54,6%), tài sản cuối năm 1.153.160.000, ròng 833.160.000, F1 15,6%, F2 10,6%" · "… › UC-1107 AC-1: F1 đạt năm 2036 (46 tuổi — trễ 1 năm), F2 đạt năm 2039 (49 tuổi — sớm 1 năm); bảng tới năm tuổi mục tiêu lớn nhất" · "… › không tới mốc trong 40 năm → \"chưa tới F1 trong 40 năm\"; không có năm sinh → không có tuổi, so mục tiêu bỏ"; [`web/src/lib/projection.test.ts`](../../web/src/lib/projection.test.ts) › "Thử số: ô giả định › UC-1107 AC-1: điểm xuất phát là số thật; gõ +10%/năm, +5%/năm → cùng bảng như AC-1" · "… › dòng thu nhập của một người ghi kèm tên người: \"Lương · Chồng\"" · "… › ô sai báo tại ô: SWR trống / 0, tỷ lệ để dành trống khi chọn tỷ lệ cố định, năm sinh tương lai"

### AC-2: Không lưu
- Given đã sửa vài ô
- When rời màn rồi quay lại trong cùng phiên; tải lại app; bấm **Đặt lại về số thật**
- Then quay lại còn số đã gõ; tải lại app về số thật; Đặt lại đưa mọi ô về điểm xuất phát; trong mọi trường hợp không có request ghi nào, `GET /v1/balance-sheet` và `GET /v1/freedom` trả đúng như trước; hàm tính là hàm thuần (cùng đầu vào cùng kết quả, không đổi đầu vào)
- Tests: [`web/src/lib/projection.test.ts`](../../web/src/lib/projection.test.ts) › "Thử số / Dự phóng (tính ở máy, không lưu) › UC-1107 AC-2: hàm thuần — cùng đầu vào cùng kết quả, không đổi đầu vào" · "Thử số: ô giả định › UC-1107 AC-2: Đặt lại về số thật đưa mọi ô về điểm xuất phát; số gõ chỉ giữ trong bộ nhớ trang"; rời màn / tải lại app / không có request ghi: ⚠ Chưa có test (cần e2e trình duyệt; đã thử tay trên `wrangler dev` cục bộ khi làm lát 3 — sang Cân đối rồi quay lại còn số, không có request ghi lên `/v1`)

### AC-3: Để dành theo tỷ lệ cố định
- Given như AC-1 nhưng để dành = tỷ lệ cố định 40%
- When tính
- Then hàng 2027 để dành 18.240.000/tháng (= 40% × 45.600.000), chi phí hiện "chi phí theo tỷ lệ" (không dùng E); A_ròng và % theo số đó
- Tests: [`web/src/lib/projection.test.ts`](../../web/src/lib/projection.test.ts) › "Thử số / Dự phóng (tính ở máy, không lưu) › UC-1107 AC-3: để dành = tỷ lệ cố định 40% → hàng 2027 để dành 18.240.000/tháng, chi phí \"theo tỷ lệ\" (null)"

## Dependencies
- Upstream UC: [UC-1103](UC-1103-moc-tu-do.md) (`projectionStart`), [UC-1102](UC-1102-xem-bang-can-doi.md) (A, L), [UC-1104](UC-1104-ke-hoach-thu-nhap.md) (dòng thu nhập), [UC-1106](UC-1106-ket-qua-thu-chi.md) (tỷ lệ để dành), [UC-1101](UC-1101-quan-ly-tai-san-lo-gia.md) (lợi suất kỳ vọng)
- Downstream UC: [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md) AC-4 (dải "Số thử — không lưu, không phải số thật", nút Đặt lại)

## Divergences & Open Questions
- [DIVERGENCE] Độ dài bảng: proposal ghi "mỗi năm từ năm sau tới năm đạt tuổi mục tiêu lớn nhất (tối đa 40 năm)"; code dài tới năm muộn nhất trong năm đạt F1, F2 và năm tuổi mục tiêu F1, F2 (tối đa 40), và đủ 40 năm khi có mốc chưa tới. Ô lợi suất để trống tính 0% (proposal: "không có thì trống"). Hệ số F2 không có ô (proposal không liệt kê, cũng không nói lấy đâu). → chủ nhà duyệt.

## Traceability
- Code (máy, không có server): `web/src/lib/projection.ts` › `project`, `reachText`, `startToForm`, `formToInput`, `keepDraft`, `keptDraft`, `MAX_YEARS`; `web/src/screens/net-worth-freedom.tsx` › `ProjectionSection`, `Projection`, `YearRow`
- Điểm xuất phát: `src/services/freedom.ts` › `getFreedom` (`projectionStart`); `src/domain/freedom.ts` › `ProjectionStart`, `ProjectionIncomeLine`
- API / sự kiện: chỉ `GET /v1/freedom` (đọc); không có API ghi, không có tool MCP
- Dữ liệu: không có bảng nào
