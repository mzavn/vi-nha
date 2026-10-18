# UC-1106: Báo cáo kết quả thu chi theo tháng / năm
- Status: implemented
- BR: BR-15, BR-02, BR-12
- Decisions: ADR-104 (suy nhóm từ dữ liệu có sẵn — trả nợ gốc, mua tài sản, khoản xếp lại Đầu tư / Tài chính không phải chi tiêu / thu nhập); ADR-106 (lãi vay là chi phí Must, có dòng con Lãi vay); ADR-100 (tính ra từ sổ bằng một câu SQL gộp theo tháng, không lưu); ADR-114 (lãi tiền gửi luôn là Thu nhập thụ động)
- Actor: người trong hộ (màn Tài sản & tự do › Thu chi, [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md)); Claude (MCP `get_reports`, [UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md))
- Trigger: mở phần Thu chi (`#net-worth/income`) hoặc đổi kỳ; `GET /v1/reports/income-statement?period=YYYY-MM|YYYY`

## History
- v1 (2026-10-08, commit `31e3505`): khởi tạo — Kết quả thu chi tháng / năm: Thu nhập (ba dòng) − Chi tiêu (theo phe ví, Must có dòng con Lãi vay) = Để dành, tỷ lệ để dành, chân "Không tính"; kỳ năm có từng tháng; MCP `get_reports` (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))
- v2 (2026-10-08, commit `d4f0ab3`): hàng gộp của báo cáo (`statementRows`) dùng chung cho Mốc tự do — là nguồn E, E_must, I ([UC-1103](UC-1103-moc-tu-do.md)) và tỷ lệ để dành mặc định của Thử số ([UC-1107](UC-1107-thu-so-du-phong.md)); số của báo cáo không đổi (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))
- v3 (2026-10-18, commit `6afc8c8`): khoản thu **lãi tiền gửi** (ADR-114 — máy tự ghi hay gán loại Lãi tiền gửi) mang report class `passive_income` do máy ghi lúc chia lãi, nên luôn ở **Thu nhập thụ động**, cả tài khoản thường; phân loại lại tay vẫn thắng. Sửa 2; thêm AC-4 (change [261018-lai-tien-gui](../changes/archive/261018-lai-tien-gui/proposal.md))

## Preconditions
- Đã đăng nhập. Kỳ theo `month_key` của giao dịch — cùng kỳ với Ngân sách và Lưu chuyển tiền ([UC-1105](UC-1105-luu-chuyen-tien.md)); hàng chọn kỳ dùng chung với phần Lưu chuyển tiền.

## Main Flow
1. Người dùng mở **Thu chi**, chọn kỳ (Tháng / Năm, "‹ kỳ ›" — [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md) AC-3).
2. **Thu nhập** = Σ khoản thu còn hiệu lực trong kỳ, ba dòng: **Lương và thu khác** · **Cho thuê lại** (khoản thu có người thuê) · **Thu nhập thụ động** (khoản thu vào tài khoản phao / sổ tiết kiệm chưa phân loại lại, hoặc đã phân loại lại Thu nhập thụ động — gồm mọi khoản lãi tiền gửi, vì máy ghi sẵn phân loại này khi chia lãi, ADR-114). Khoản thu phân loại lại Đầu tư / Tài chính **không** là thu nhập ([Công thức 15](README.md#công-thức)).
3. **Chi tiêu** = Σ khoản chi − Σ hoàn tiền, theo phe của ví bị trừ (hoàn tiền: ví được hoàn): **Must** (có dòng con **Lãi vay** = khoản chi trả lãi `interest_debt_id`) · **Có thì tốt** · **Hưởng thụ** · **Thuế đã nộp** (ví Thuế) · **Chi từ Tích sản** · **Khác**. **Không** gồm trả nợ gốc (khoản chi mang khoản nợ — Tài chính) và khoản chi phân loại lại Đầu tư / Tài chính.
4. **Để dành** = Thu nhập − Chi tiêu; **tỷ lệ để dành** = Để dành ÷ Thu nhập, cắt về một chữ số lẻ (Thu nhập 0 → "—").
5. **Chân "Không tính"**: trả nợ gốc, mua tài sản qua app, phân loại lại Đầu tư, phân loại lại Tài chính, điều chỉnh khi đếm số dư (có dấu) — mỗi khoản kèm số, ẩn khi 0: "Không tính: trả nợ gốc 5.000.000 ₫, mua tài sản 6.000.000 ₫, phân loại lại Tài chính 50.000.000 ₫, điều chỉnh −100.000 ₫ — xem Lưu chuyển tiền."
6. Màn: card **Thu nhập** luôn đủ ba dòng; card **Chi tiêu** ẩn dòng bằng 0 (kể cả dòng con Lãi vay); card **Để dành** số 28px + "tỷ lệ 50,3%"; chân như bước 5.
7. Kỳ năm: thêm card **Từng tháng** — mỗi tháng có giao dịch trong năm: "thu X · chi Y · tỷ lệ Z".
8. Báo cáo là nguồn của chi phí tháng E, E_must và thu nhập nhà I ([Công thức 8, 9](README.md#công-thức) — [UC-1103](UC-1103-moc-tu-do.md)), của thực tế kế hoạch thu nhập ([UC-1104](UC-1104-ke-hoach-thu-nhap.md)) và tỷ lệ để dành mặc định của Thử số ([UC-1107](UC-1107-thu-so-du-phong.md)).
   - Kỹ thuật: `statementRows` — một câu SQL gộp theo tháng × loại × phe ví × phân loại lại; `buildIncomeStatement` cộng ở JS.

## Alternative Flows
- 1a. Claude gọi `get_reports { kind: "income_statement", period }` → cùng số với `GET /v1/reports/income-statement` (UC-602 AC-8).
- 2a. Khoản thu đã phân loại lại Sinh hoạt → vẫn là thu nhập (Cho thuê lại nếu có người thuê, còn lại Lương và thu khác).

## Exceptions
- E1. Kỳ sai dạng, trước 2000 hoặc sau tháng / năm hiện tại → 400 `invalid_period` (như [UC-1105](UC-1105-luu-chuyen-tien.md) E1).

## Acceptance Criteria

### AC-1: Tháng mẫu — Thu nhập − Chi tiêu = Để dành, chân "Không tính"
- Given dữ liệu [UC-1105](UC-1105-luu-chuyen-tien.md) AC-1
- When `GET /v1/reports/income-statement?period=2026-10`
- Then Thu nhập 33.200.000 (Lương và thu khác 30.000.000, Cho thuê lại 3.000.000, Thu nhập thụ động 200.000); Chi tiêu 16.500.000 (Must 11.500.000 sau hoàn, Có thì tốt 3.000.000, Hưởng thụ 2.000.000); Để dành 16.700.000, tỷ lệ 50,3%; chân: "Không tính: trả nợ gốc 5.000.000 ₫, mua tài sản 6.000.000 ₫, phân loại lại Tài chính 50.000.000 ₫, điều chỉnh −100.000 ₫"
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1106 kết quả thu chi › UC-1106 AC-1: Thu nhập 33.200.000, Chi tiêu 16.500.000 (Must 11.500.000 sau hoàn), Để dành 16.700.000, tỷ lệ 50,3%; chân: gốc 5.000.000, mua tài sản 6.000.000, xếp lại Tài chính 50.000.000, điều chỉnh −100.000"; [`web/src/lib/reports.test.ts`](../../web/src/lib/reports.test.ts) › "kết quả thu chi › UC-1106 AC-1: tỷ lệ để dành 50,3%; chân \"Không tính: trả nợ gốc 5.000.000 ₫, mua tài sản 6.000.000 ₫, phân loại lại Tài chính 50.000.000 ₫, điều chỉnh −100.000 ₫\""

### AC-2: Thuế đã nộp là chi tiêu, không vào E
- Given như AC-1, thêm chi 1.000.000 từ ví Thuế trong tháng 10
- When xem tháng 10
- Then dòng "Thuế đã nộp 1.000.000" trong Chi tiêu (17.500.000), Để dành 15.700.000; dòng 0 bị ẩn, Thuế đã nộp hiện khi có; E theo sổ ([Công thức 8](README.md#công-thức), [UC-1103](UC-1103-moc-tu-do.md) AC-5) không gồm dòng Thuế
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1106 kết quả thu chi › UC-1106 AC-2: chi 1.000.000 từ ví Thuế → dòng Thuế đã nộp 1.000.000, Chi tiêu 17.500.000, Để dành 15.700.000"; [`web/src/lib/reports.test.ts`](../../web/src/lib/reports.test.ts) › "kết quả thu chi › UC-1106 AC-2, AC-3: chi tiêu ẩn dòng 0; Thuế đã nộp hiện khi có; Must có dòng con Lãi vay 300.000 khi có lãi"

### AC-3: Lãi vay là chi phí, gốc chỉ ở chân
- Given tháng 11 như [UC-1105](UC-1105-luu-chuyen-tien.md) AC-5 (trả "Vay tiêu dùng" tách lãi 300.000 / gốc 2.000.000)
- When xem tháng 11
- Then Chi tiêu › Must có dòng con "Lãi vay 300.000"; 2.000.000 gốc chỉ ở chân "không tính trả nợ gốc"
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "UC-1106 kết quả thu chi › UC-1106 AC-3 (lãi vay là chi phí): tháng 11 Must có dòng con Lãi vay 300.000; 2.000.000 gốc chỉ ở chân"; [`web/src/lib/reports.test.ts`](../../web/src/lib/reports.test.ts) › "kết quả thu chi › UC-1106 AC-2, AC-3: chi tiêu ẩn dòng 0; Thuế đã nộp hiện khi có; Must có dòng con Lãi vay 300.000 khi có lãi"

### AC-4: Lãi tiền gửi ở Thu nhập thụ động, cả tài khoản thường
- Given tháng 10 có lương 30.000.000 và ba khoản lãi 68 + 50 + 37 ghi loại Lãi tiền gửi ở tài khoản thường
- When `GET /v1/reports/income-statement?period=2026-10`
- Then Lương và thu khác 30.000.000, Thu nhập thụ động 155, Thu nhập 30.000.155
- Tests: [`test/reports.test.ts`](../../test/reports.test.ts) › "lãi tiền gửi ở Kết quả thu chi (261018-lai-tien-gui) › UC-1106: tháng có lương 30.000.000 và ba khoản lãi 68 + 50 + 37 (tài khoản thường) → Lương và thu khác 30.000.000, Thu nhập thụ động 155"

## Dependencies
- Upstream UC: [UC-1105](UC-1105-luu-chuyen-tien.md) (kỳ, phân loại lại), [UC-902](../debt/UC-902-tra-no.md) (tách lãi / gốc)
- Downstream UC: [UC-1103](UC-1103-moc-tu-do.md) (E, E_must, I), [UC-1104](UC-1104-ke-hoach-thu-nhap.md) (thực tế), [UC-1107](UC-1107-thu-so-du-phong.md) (tỷ lệ để dành mặc định), [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md), [UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md) AC-8

## Divergences & Open Questions
- [OPEN] Phần Thu chi không có lối phân loại lại: muốn đưa một khoản ra khỏi thu nhập / chi tiêu phải sang Lưu chuyển tiền, chạm dòng rồi Xếp vào nhóm… ([UC-1105](UC-1105-luu-chuyen-tien.md)). Có cần chạm dòng ở Thu chi không — chủ nhà.

## Traceability
- Code: `src/routes/reports.ts` › `reportRoutes`; `src/services/reports.ts` › `getIncomeStatement`, `statementRows`; `src/domain/reports.ts` › `parsePeriod`, `buildIncomeStatement`; `src/mcp/tools.ts` › `get_reports`
- PWA: `web/src/screens/net-worth-reports.tsx` › `IncomeSection`, `PeriodBar`; `web/src/lib/reports.ts` › `shownExpenseLines`, `savingsRateText`, `excludedText`, `statementMonthSub`
- API / sự kiện: `GET /v1/reports/income-statement?period=` (lỗi `invalid_period`)
- Dữ liệu: đọc `transactions` (`meaning`, `tenant_id`, `debt_id`, `interest_debt_id`, `month_key`), `accounts.role`, `wallets` (`tier`, `must_group`), `transaction_report_classes` (migration `migrations/0032_report_classes.sql`)
