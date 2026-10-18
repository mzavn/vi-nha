# UC-1105: Báo cáo lưu chuyển tiền theo tháng / năm
- Status: implemented
- BR: BR-15, BR-04, BR-12
- Decisions: ADR-104 (suy nhóm từ dữ liệu có sẵn, phần không suy được thì phân loại lại từng giao dịch trong bảng riêng — chỉ đổi báo cáo); ADR-100 (tính theo trạng thái tại từng ngày bằng ít câu SQL gộp theo tháng, `deactivated_at` cho tài khoản đã tắt); ADR-107 (thẻ tín dụng: lưu chuyển tiền vẫn theo Σ sổ, gồm số âm của thẻ); ADR-106 (trả lãi là chi phí Sinh hoạt, trả gốc là Tài chính); ADR-73 (sửa giao dịch = huỷ + ghi mới — phân loại lại đi theo); ADR-90 (nhật ký thay đổi); ADR-12, ADR-54 (trần CPU Workers Free)
- Actor: người trong hộ (màn Tài sản & tự do › Lưu chuyển tiền, [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md)); Claude (MCP `get_reports`, [UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md))
- Trigger: mở phần Lưu chuyển tiền (`#net-worth/cash-flow`) hoặc đổi kỳ; `GET /v1/reports/cash-flow?period=YYYY-MM|YYYY`

## History
- v1 (2026-10-08, commit `31e3505`): khởi tạo — báo cáo lưu chuyển tiền tháng / năm (Sinh hoạt · Đầu tư · Tài chính), bảng phân loại mặc định chạy trong SQL, phân loại lại từng giao dịch (`transaction_report_classes`, migration 0032, schema v1.32), dòng "Tài khoản mở / tắt trong kỳ", chú thẻ tín dụng, ghi chú lô, danh sách giao dịch của một dòng; MCP `get_reports` (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))
- v2 (2026-10-18, commit `6afc8c8`): không đổi code báo cáo — khoản thu **lãi tiền gửi** (ADR-114) mang report class `passive_income` do máy ghi lúc chia lãi, nên nằm ở dòng Thu nhập thụ động (Sinh hoạt) cả với tài khoản thường; gỡ gán khoản đó thì phân loại nằm lại với dòng đã huỷ như luật hiện có (change [261018-lai-tien-gui](../changes/archive/261018-lai-tien-gui/proposal.md))

## Preconditions
- Đã đăng nhập. Báo cáo chỉ đọc sổ (tài khoản, giao dịch, phân loại lại, lô tài sản); không ghi gì.
- Kỳ là tháng `month_key` của giao dịch (= tháng giờ VN của `at`, như Ngân sách); năm = các tháng của năm đó. Kỳ đang chạy thì tới hôm nay.

## Main Flow
1. Người dùng mở **Lưu chuyển tiền**; hàng chọn kỳ (dùng chung với phần Thu chi — [UC-1106](UC-1106-ket-qua-thu-chi.md)) có `Tháng` / `Năm` và "‹ Tháng 10/2026 ›"; không có `›` khi đang ở kỳ hiện tại; đổi Năm → Tháng: năm nay về tháng hiện tại, năm trước về tháng 12 ([UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md) AC-3).
2. **Tiền đầu kỳ** = Σ sổ (số dư đầu + giao dịch, luật dấu `v_account_book`, **gồm** số âm của thẻ tín dụng) của các tài khoản **có mặt** tại cuối ngày trước kỳ ([Công thức 3](README.md#công-thức)): đang dùng, hoặc đã tắt sau ngày đó; và chưa có ngày mở sổ hoặc ngày mở sổ ≤ ngày đó. Tài khoản tắt từ trước v1.31 (không biết ngày tắt) không có mặt ở tháng nào.
3. Mỗi giao dịch còn hiệu lực trong kỳ có **đúng một** phía tài khoản (tiền vào hoặc ra khỏi một tài khoản của hộ) được xếp vào một dòng của một nhóm theo **bảng phân loại mặc định** (xét từ trên xuống, dòng khớp đầu tiên thắng), trừ khi đã **phân loại lại**. Giao dịch có hai phía tài khoản là chuyển nội bộ — không vào báo cáo; giao dịch không có phía tài khoản nào (chia tiền, chuyển ví) không phải tiền vào ra.

   | Giao dịch | Nhóm | Dòng |
   |---|---|---|
   | Khoản thu (`income`) có người thuê | Sinh hoạt | Thu cho thuê lại |
   | Khoản thu vào tài khoản phao / sổ tiết kiệm (`buffer`, `term_deposit`) | Đầu tư | Lãi, cổ tức, tiền thuê thu về |
   | Khoản thu khác | Sinh hoạt | Lương và thu khác |
   | Hoàn tiền (`refund`) | Sinh hoạt | Hoàn tiền |
   | Khoản chi mang khoản nợ (`debt_id`) | Tài chính | Trả nợ gốc |
   | Khoản chi trả lãi (`interest_debt_id`) | Sinh hoạt | Lãi vay |
   | Khoản chi khác | Sinh hoạt | Chi Must · Chi Có thì tốt · Chi Hưởng thụ · Thuế đã nộp · Chi từ Tích sản · Chi khác — theo phe của ví bị trừ |
   | Mua tài sản qua app (`buy_asset`) | Đầu tư | Mua tài sản qua app |
   | Cho vay / trả hộ (`lend`) | Tài chính | Cho vay / trả hộ |
   | Thu hồi cho vay (`collect`) | Tài chính | Thu hồi cho vay |
   | Điều chỉnh khi đếm số dư (`adjust`) | Sinh hoạt | Điều chỉnh khi đếm số dư |
   | Còn lại (vd chuyển chỉ một phía tài khoản) | Sinh hoạt | Khác |

   - Kỹ thuật: `CASE` trong SQL (`DEFAULT_LINE`, `SPEND_LINE`) `LEFT JOIN transaction_report_classes`, `GROUP BY` tháng × dòng; JS chỉ áp phân loại lại lên các hàng đã gộp (`finalLine`).
4. **Phân loại lại** (Xếp vào nhóm…): Sinh hoạt · Thu nhập thụ động (chỉ cho khoản thu) · Đầu tư · Tài chính. Chỉ đổi báo cáo — ví, số dư tài khoản, lần chia tiền, snapshot giữ nguyên. Dòng đích:
   - cùng nhóm với mặc định → giữ dòng mặc định;
   - Thu nhập thụ động → Đầu tư "Lãi, cổ tức, tiền thuê thu về";
   - Đầu tư → tiền vào "Bán tài sản, thu hồi đầu tư", tiền ra "Mua tài sản";
   - Tài chính → tiền vào "Vay, nhận tiền", tiền ra "Chi tài chính khác";
   - Sinh hoạt → dòng chi theo phe ví (khoản chi), "Lương và thu khác" (khoản thu) hoặc "Khác".

   Những khoản dữ liệu không nói được, ghi như hiện nay rồi phân loại lại: tiền vay về / bố mẹ chuyển cho vay (thường ghi khoản thu) → Tài chính; tiền bán vàng / đất / chứng khoán về tài khoản → Đầu tư; cổ tức, tiền thuê nhà mình về tài khoản thường → Thu nhập thụ động; chi đặt cọc / mua đất ghi khoản chi → Đầu tư.
   - Kỹ thuật: `PUT /v1/transactions/:id/report-class { class }` (nhật ký `report_class.set`), `DELETE /v1/transactions/:id/report-class` — **Về mặc định** (nhật ký `report_class.clear`). Sửa giao dịch (huỷ + ghi mới, ADR-73) chép phân loại lại sang dòng mới ([UC-102](../ledger/UC-102-huy-giao-dich.md) AC-19); huỷ hẳn thì phân loại nằm lại với dòng đã huỷ và báo cáo bỏ qua.
5. **Tài khoản mở trong kỳ** = Σ số dư đầu của tài khoản có ngày mở sổ trong kỳ — dòng riêng, ngoài ba nhóm; tài khoản không có ngày mở sổ không bao giờ vào dòng này (số dư đầu đã nằm trong tiền đầu kỳ). **Tài khoản tắt trong kỳ** = − Σ số dư sổ lúc tắt của tài khoản có ngày tắt trong kỳ — dòng riêng. Cả hai chỉ hiện khi khác 0.
6. **Tiền cuối kỳ** = đầu kỳ + mở trong kỳ + tắt trong kỳ + Sinh hoạt + Đầu tư + Tài chính, và bằng Σ sổ các tài khoản có mặt tại cuối kỳ (bất biến, [Công thức 14](README.md#công-thức)). Dưới số cuối kỳ: chú "= Σ sổ tài khoản ngày 31/10/2026" (kỳ đang chạy: hôm nay); có thẻ tín dụng âm thì thêm "Gồm −X ₫ thẻ tín dụng — ở bảng cân đối nằm ở Nợ ngắn hạn" (ADR-107).
7. Dưới nhóm Đầu tư: **ghi chú** lô mua / bán ghi ở màn tài sản trong kỳ ([UC-1101](UC-1101-quan-ly-tai-san-lo-gia.md)) — "Lô mua 10.200.000 ₫, lô bán Y ghi ở màn tài sản — không cộng vào tổng" (phần nào bằng 0 thì bỏ). Lô không phải giao dịch của tài khoản nên không đổi ba nhóm hay tiền cuối kỳ.
8. Màn: card tóm tắt (Tiền đầu kỳ · mở / tắt trong kỳ khi có · Sinh hoạt ± · Đầu tư ± · Tài chính ± · **Tiền cuối kỳ** đậm); ba card nhóm, mỗi dòng: tên, số có dấu, dòng phụ "N giao dịch" (", K đã xếp lại" khi có) và chip "đã xếp lại".
9. Chạm một dòng → sheet danh sách giao dịch của dòng (sau phân loại lại, mới nhất trước; mỗi giao dịch: tên danh mục hoặc loại, "15/10 · VCB · ví Ăn uống · ghi chú", chip "đã xếp lại · Tài chính" khi có) và nút **Xếp vào nhóm…** → sheet chọn nhóm + **Về mặc định**. Lưu xong toast "Đã xếp khoản 50.000.000 ₫ vào Tài chính — chỉ đổi báo cáo, ví và số dư giữ nguyên." (về mặc định: "Đã đưa khoản … về nhóm mặc định."), danh sách và báo cáo đọc lại.
   - Kỹ thuật: `GET /v1/reports/transactions?period=…&line=<mã dòng>`.
10. Kỳ năm: thêm card **Từng tháng** — từ tháng đầu tiên trong năm có dữ liệu (tài khoản mở sổ hoặc giao dịch) tới tháng cuối của kỳ; mỗi tháng: cuối kỳ bên phải, dòng phụ "sinh hoạt ± · đầu tư ± · tài chính ±" (+ mở / tắt tài khoản khi có).

## Alternative Flows
- 1a. Claude gọi `get_reports { kind: "cash_flow", period }` → cùng số với `GET /v1/reports/cash-flow` (UC-602 AC-8).
- 1b. Tải lại trang (F5) → phần Lưu chuyển tiền mở lại đúng (`#net-worth/cash-flow`) nhưng kỳ về tháng hiện tại (kỳ không ghi vào hash).
- 9a. Mất mạng → sheet giao dịch của dòng không có nút Xếp vào nhóm…, kèm chú cần mạng (ghi cần mạng).

## Exceptions
- E1. Kỳ sai dạng, trước 2000 hoặc sau tháng / năm hiện tại → 400 `invalid_period` ("Kỳ phải có dạng 2026-10 (tháng) hoặc 2026 (năm), không sau kỳ hiện tại.").
- E2. `line` không phải mã dòng của báo cáo → 400 `invalid_input`.
- E3. Phân loại lại: `class` khác bốn nhóm, hoặc Thu nhập thụ động cho khoản không phải khoản thu → 400 `invalid_class`; giao dịch chuyển nội bộ (hai phía tài khoản) hoặc không có phía tài khoản → 400 `not_cash_flow`; giao dịch đã huỷ → 409 `already_void`; không có giao dịch → 404 `not_found`. Không ghi gì.

## Postconditions
- Xem báo cáo không ghi gì. Phân loại lại chỉ ghi / xoá một dòng `transaction_report_classes` và một dòng nhật ký.

## Acceptance Criteria

### AC-1: Tháng mẫu — ba nhóm, đầu kỳ + ba nhóm = cuối kỳ = Σ sổ
- Given tài khoản VCB (chồng) mở 2026-09-01 số dư đầu 12.000.000 và phao (`buffer`) mở 2026-09-01 số dư 0, không có giao dịch tháng 9; tháng 10: lương 30.000.000 vào VCB; người thuê trả 3.000.000; lãi 200.000 vào phao; chi ví Must 12.000.000, hoàn 500.000 về Must; chi Có thì tốt 3.000.000; chi Hưởng thụ 2.000.000; trả nợ gốc 5.000.000 (khoản chi mang khoản nợ 0%); mua vàng qua app 6.000.000; cho vay 1.000.000, thu hồi 400.000; bố mẹ chuyển 50.000.000 ghi khoản thu rồi phân loại lại Tài chính; chuyển VCB → phao 4.000.000; đếm số dư lệch −100.000
- When `GET /v1/reports/cash-flow?period=2026-10`
- Then tiền đầu kỳ 12.000.000; Sinh hoạt +16.400.000 (Lương và thu khác +30.000.000, Thu cho thuê lại +3.000.000, Chi Must −12.000.000, Hoàn tiền +500.000, Chi Có thì tốt −3.000.000, Chi Hưởng thụ −2.000.000, Điều chỉnh −100.000); Đầu tư −5.800.000 (Lãi, cổ tức, tiền thuê +200.000, Mua tài sản qua app −6.000.000); Tài chính +44.400.000 (Vay, nhận tiền +50.000.000, Trả nợ gốc −5.000.000, Cho vay −1.000.000, Thu hồi +400.000); tiền cuối kỳ 67.000.000 = Σ sổ tài khoản cuối 31/10; chuyển VCB → phao không có dòng nào; màn: "Tiền cuối kỳ 67.000.000" đậm, chú "= Σ sổ tài khoản ngày 31/10/2026"
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1105 lưu chuyển tiền › UC-1105 AC-1 (tháng mẫu): đầu kỳ 12.000.000; Sinh hoạt +16.400.000, Đầu tư −5.800.000, Tài chính +44.400.000; cuối kỳ 67.000.000 = Σ sổ; chuyển VCB → phao không có dòng"; [`web/src/lib/reports.test.ts`](../../web/src/lib/reports.test.ts) › "lưu chuyển tiền: card tóm tắt và chú › UC-1105 AC-1: tiền đầu kỳ 12.000.000 · Sinh hoạt +16.400.000 · Đầu tư −5.800.000 · Tài chính +44.400.000 · Tiền cuối kỳ 67.000.000 (đậm) = Σ sổ ngày 31/10"

### AC-2: Phân loại lại chỉ đổi báo cáo
- Given khoản thu 50.000.000 của AC-1 chưa phân loại lại (nằm ở Sinh hoạt "Lương và thu khác", +80.000.000 cả dòng)
- When `PUT /v1/transactions/:id/report-class { class: "financing" }`; rồi `DELETE`; rồi `{ class: "passive_income" }` cho một khoản chi
- Then sau `PUT`: Sinh hoạt −50.000.000, Tài chính +50.000.000 ("Vay, nhận tiền"), tiền cuối kỳ không đổi; số dư ví, số dư tài khoản, lần chia tiền của khoản đó, snapshot không đổi; nhật ký có dòng `report_class.set`; sau `DELETE` về mặc định; lần ba 400 `invalid_class`; màn: toast nói chỉ đổi báo cáo, "Thu nhập thụ động" chỉ có ở khoản thu, dòng có khoản đã xếp lại ghi rõ
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1105 lưu chuyển tiền › UC-1105 AC-2 (phân loại lại chỉ đổi báo cáo): Sinh hoạt −50.000.000, Tài chính +50.000.000, cuối kỳ không đổi; ví, sổ không đổi; nhật ký; DELETE về mặc định; passive_income cho khoản chi → invalid_class"; [`web/src/lib/reports.test.ts`](../../web/src/lib/reports.test.ts) › "phân loại lại một giao dịch › UC-1105 AC-2: xếp khoản thu 50.000.000 vào Tài chính / về mặc định — toast nói chỉ đổi báo cáo; \"Thu nhập thụ động\" chỉ có ở khoản thu; dòng có khoản đã xếp lại ghi rõ"

### AC-3: Kỳ năm, tài khoản mở trong kỳ, tài khoản không có ngày mở sổ
- Given như AC-1, thêm tài khoản tiền mặt mở 2026-10-05 số dư đầu 2.000.000, và tài khoản "Ví cũ" không có ngày mở sổ, số dư đầu 1.000.000, không có giao dịch; hôm nay 2026-11-15, tháng 11 chưa có giao dịch
- When `GET /v1/reports/cash-flow?period=2026`
- Then tiền đầu kỳ (cuối 31/12/2025) 1.000.000 (Ví cũ); "Tài khoản mở trong kỳ" +14.000.000; ba nhóm như AC-1; tiền cuối kỳ 70.000.000 = Σ sổ hôm nay = `cash` của [UC-1005](../receivable/UC-1005-xem-buc-tranh-tien-that.md); danh sách tháng: 2026-09 đầu 1.000.000, mở +12.000.000, cuối 13.000.000; 2026-10 đầu 13.000.000, mở +2.000.000, cuối 70.000.000; 2026-11 không đổi; màn: dòng mở / tắt trong kỳ chỉ hiện khi khác 0, card Từng tháng có dòng phụ ba nhóm
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1105 lưu chuyển tiền › UC-1105 AC-3 (kỳ năm, tài khoản mở trong kỳ, không ngày mở): đầu kỳ 1.000.000; mở trong kỳ +14.000.000; cuối kỳ 70.000.000 = Σ sổ hôm nay; danh sách tháng 9, 10, 11"; [`web/src/lib/reports.test.ts`](../../web/src/lib/reports.test.ts) › "lưu chuyển tiền: card tóm tắt và chú › UC-1105 AC-3, AC-8: dòng \"Tài khoản mở trong kỳ\" +14.000.000 và \"Tài khoản tắt trong kỳ\" −3.000.000 chỉ hiện khi khác 0, ngoài ba nhóm" · "… › UC-1105 AC-3: kỳ năm có card Từng tháng — dòng phụ ba nhóm có dấu, mở / tắt tài khoản khi có"

### AC-4: Lô tài sản chỉ là ghi chú
- Given trong tháng 10 thêm lô vàng 2 chỉ × 5.100.000 ngày 2026-10-15 ở màn tài sản
- When xem tháng 10
- Then dưới Đầu tư có ghi chú "Lô mua 10.200.000 ₫ ghi ở màn tài sản — không cộng vào tổng"; ba nhóm và tiền cuối kỳ không đổi
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1105 lưu chuyển tiền › UC-1105 AC-4 (lô chỉ là ghi chú): lô vàng 2 chỉ × 5.100.000 ngày 15/10 → ghi chú 10.200.000; ba nhóm và cuối kỳ không đổi"; [`web/src/lib/reports.test.ts`](../../web/src/lib/reports.test.ts) › "lưu chuyển tiền: card tóm tắt và chú › UC-1105 AC-4: lô mua ở màn tài sản chỉ là ghi chú dưới Đầu tư, không cộng vào tổng"

### AC-5: Trả lãi là Sinh hoạt, trả gốc là Tài chính
- Given tháng 11 trả "Vay tiêu dùng" 2.300.000 đã tách lãi 300.000 / gốc 2.000.000 ([UC-902](../debt/UC-902-tra-no.md) AC-10)
- When xem tháng 11
- Then Sinh hoạt "Lãi vay" −300.000, Tài chính "Trả nợ gốc" −2.000.000
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1105 lưu chuyển tiền › UC-1105 AC-5 (lãi / gốc): trả Vay tiêu dùng tách lãi 300.000 / gốc 2.000.000 → Sinh hoạt Lãi vay −300.000, Tài chính Trả nợ gốc −2.000.000"

### AC-6: Thẻ tín dụng nằm trong Σ sổ
- Given tháng 11 chi 3.000.000 bằng thẻ tín dụng (sổ thẻ từ 0 xuống −3.000.000), không có giao dịch khác
- When xem tháng 11
- Then Sinh hoạt −3.000.000; tiền cuối kỳ = tiền đầu kỳ − 3.000.000 = Σ sổ (gồm thẻ); `creditCardDebt` 3.000.000; chú "Gồm −3.000.000 ₫ thẻ tín dụng — ở bảng cân đối nằm ở Nợ ngắn hạn"
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1105 lưu chuyển tiền › UC-1105 AC-6 (thẻ tín dụng): chi 3.000.000 bằng thẻ → Sinh hoạt −3.000.000; cuối kỳ = đầu kỳ − 3.000.000 = Σ sổ (gồm thẻ); creditCardDebt 3.000.000"; [`web/src/lib/reports.test.ts`](../../web/src/lib/reports.test.ts) › "lưu chuyển tiền: card tóm tắt và chú › UC-1105 AC-6: thẻ tín dụng âm → chú \"Gồm −3.000.000 ₫ thẻ tín dụng — ở bảng cân đối nằm ở Nợ ngắn hạn\""

### AC-7: Số câu SQL (Workers Free)
- Given DB mẫu 24 tháng × 300 giao dịch (như [UC-1102](UC-1102-xem-bang-can-doi.md) AC-9)
- When `GET /v1/reports/cash-flow?period=2026`
- Then đúng 4 câu SQL (tài khoản; số dư theo tài khoản × tháng; giao dịch đã phân loại gộp theo tháng × dòng; lô), không câu nào lặp theo tháng; trả vài trăm hàng
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1105 lưu chuyển tiền › UC-1105 AC-7 (số câu SQL): báo cáo năm trên DB 24 tháng × 300 giao dịch — 4 câu SQL, không câu nào lặp; vài trăm hàng"

### AC-8: Tài khoản tắt trong kỳ — theo trạng thái tại từng ngày
- Given tài khoản "MB cũ" có 4.000.000 đầu tháng 11; ngày 5/11 chi 1.000.000 từ đó; ngày 10/11 tắt khi còn 3.000.000; không có giao dịch khác
- When `GET /v1/reports/cash-flow?period=2026-11`
- Then Sinh hoạt −1.000.000 (lúc chi tài khoản còn có mặt); "Tài khoản tắt trong kỳ" −3.000.000; tiền cuối kỳ = tiền đầu kỳ − 4.000.000 = Σ sổ hôm nay; tháng 10 không đổi (vẫn tính "MB cũ")
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1105 lưu chuyển tiền › UC-1105 AC-8 (tài khoản tắt trong kỳ): MB cũ chi 1.000.000 rồi tắt khi còn 3.000.000 → Sinh hoạt −1.000.000, tắt trong kỳ −3.000.000; cuối kỳ = đầu kỳ − 4.000.000 = Σ sổ; tháng 10 vẫn tính MB cũ"; [`web/src/lib/reports.test.ts`](../../web/src/lib/reports.test.ts) › "lưu chuyển tiền: card tóm tắt và chú › UC-1105 AC-3, AC-8: dòng \"Tài khoản mở trong kỳ\" +14.000.000 và \"Tài khoản tắt trong kỳ\" −3.000.000 chỉ hiện khi khác 0, ngoài ba nhóm"

### AC-9: Kỳ sai bị chặn; danh sách giao dịch của một dòng theo phân loại lại
- Given dữ liệu AC-1 (hôm nay 2026-11-15), khoản thu 50.000.000 của bố mẹ đã xếp Tài chính
- When `GET /v1/reports/cash-flow?period=` lần lượt `2026-12`, `2027` (sau kỳ hiện tại), `10-2026`, rỗng; `GET /v1/reports/transactions?period=2026-10&line=borrow` và `line=salary_other`
- Then cả bốn kỳ 400 `invalid_period`; dòng "Vay, nhận tiền" có đúng khoản 50.000.000 (`reportClass: "financing"`, dòng mặc định "Lương và thu khác", tài khoản VCB (chồng)); dòng "Lương và thu khác" chỉ còn khoản lương
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1105 lưu chuyển tiền › kỳ sai dạng hoặc sau kỳ hiện tại → 400 invalid_period; dòng giao dịch trả đúng các khoản của dòng (sau phân loại lại)"

## Dependencies
- Upstream UC: [UC-1101](UC-1101-quan-ly-tai-san-lo-gia.md) (lô — ghi chú), [UC-1102](UC-1102-xem-bang-can-doi.md) (Σ sổ tại ngày, `deactivated_at`), [UC-506](../access/UC-506-cau-hinh-tai-khoan-vi-luat-nap.md) AC-24 (không đổi ngày mở sổ về sau giao dịch — giữ bất biến), [UC-902](../debt/UC-902-tra-no.md) (tách lãi / gốc)
- Downstream UC: [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md) (màn), [UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md) AC-8 (`get_reports`), [UC-102](../ledger/UC-102-huy-giao-dich.md) AC-19 (sửa giao dịch giữ phân loại lại)

## Divergences & Open Questions
- [OPEN] CPU của báo cáo năm chưa đo trên Workers: AC-7 mới đếm câu SQL (4 câu) và đo 12,1 ms chạy trên Node với DB mẫu 24 tháng × 300 giao dịch; lát 2 lên prod (2026-10-08 17:02) chỉ ghi hai báo cáo trả 200 và bất biến đúng trên số thật tháng 10. Trần Workers Free 10 ms (ADR-12; lịch sử bảng cân đối lát 1 đo trên prod P50 11,0 ms, max 14,8 ms) — cần đo `wrangler dev` / prod rồi quyết theo ADR-54.
- [OPEN] Kỳ đang xem không giữ khi tải lại (F5 về tháng hiện tại; chỉ phần `#net-worth/cash-flow` được giữ). Có cần ghi kỳ vào hash không — chủ nhà.
- [OPEN] Phân loại `passive_income` do máy ghi cho lãi tiền gửi (ADR-114) hiện như phân loại tay ("đã xếp lại") và không có dòng nhật ký `report_class.set`; bấm "Về mặc định" thì lãi ở tài khoản thường về "Lương và thu khác". Có cần tách phân loại máy với phân loại tay không — chủ nhà.

## Traceability
- Code: `src/routes/reports.ts` › `reportRoutes`; `src/services/reports.ts` › `getCashFlow`, `reportTransactions`, `setReportClass`, `clearReportClass`, `cashTx`, `DEFAULT_LINE`, `SPEND_LINE`, `cashFrom`; `src/domain/reports.ts` › `parsePeriod`, `monthRange`, `finalLine`, `buildCashFlow`, `LINE_LABEL`, `LINE_GROUP`, `REPORT_CLASSES`; `src/services/ledger.ts` › `replaceTransaction` (chép phân loại lại); `src/mcp/tools.ts` › `get_reports`
- PWA: `web/src/screens/net-worth-reports.tsx` › `PeriodBar`, `CashFlowSection`, `LineSheet`, `ClassSheet`; `web/src/lib/reports.ts` › `shiftPeriod`, `canGoNext`, `switchKind`, `periodLabel`, `periodEnd`, `cashFlowSummary`, `closingNotes`, `lotNoteText`, `lineSub`, `cashFlowMonthSub`, `classOptions`, `reportTxTitle`, `reportTxSub`, `reclassToast`
- API / sự kiện: `GET /v1/reports/cash-flow?period=` (lỗi `invalid_period`) · `GET /v1/reports/transactions?period=&line=` (lỗi `invalid_period`, `invalid_input`) · `PUT` / `DELETE /v1/transactions/:id/report-class` (lỗi `invalid_class`, `not_cash_flow`, `already_void`, `not_found`); nhật ký `report_class.set`, `report_class.clear`
- Dữ liệu: migration `migrations/0032_report_classes.sql` (schema v1.32), bảng `transaction_report_classes`; đọc `transactions`, `accounts` (`opening_balance`, `opened_at`, `deactivated_at`, `role`, `kind`), `wallets` (`tier`, `must_group`), `balance_lots`
