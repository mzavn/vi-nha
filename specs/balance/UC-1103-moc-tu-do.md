# UC-1103: Mốc tự do — Mốc an tâm, thu nhập, Tự do
- Status: implemented
- BR: BR-15, BR-07, BR-08
- Decisions: ADR-99 (số thật: tiền, phải thu, nợ từ sổ — mốc Tự do so tài sản đầu tư đã trừ nợ); ADR-100 (mọi số tính ra, không lưu); ADR-101 (chỉ dòng tiền thật vào mốc Tự do theo dòng tiền, lợi suất kỳ vọng không phải thu nhập); ADR-106 (lãi vay ở ví Must vào cả E và E_must); ADR-102 (màn phụ riêng, không lên Hôm nay)
- Actor: người trong hộ (màn Tài sản & tự do › Mốc tự do, [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md)); Claude (khối `freedom` của MCP `get_balance_sheet`, [UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md) AC-9)
- Trigger: mở phần Mốc tự do (`#net-worth/milestones`); `GET /v1/freedom`

## History
- v1 (2026-10-08, commit `d4f0ab3`): khởi tạo — `GET /v1/freedom`: Mốc an tâm A1–A3, mốc thu nhập M2 / M2′ / M3, Tự do F1–F3 trên tài sản đầu tư đã trừ nợ, tuổi mục tiêu quy theo lạm phát; thông số `fi_*` (đặt từ lát 1, migration 0031) sửa tại chỗ; kèm `projectionStart` (UC-1107) và kế hoạch thu nhập năm nay (UC-1104); MCP `get_balance_sheet` › `freedom` (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))

## Preconditions
- Đã đăng nhập. Mọi số tính tại hôm nay (giờ VN) từ bảng cân đối ([UC-1102](UC-1102-xem-bang-can-doi.md)), Kết quả thu chi ([UC-1106](UC-1106-ket-qua-thu-chi.md)), kế hoạch thu nhập năm nay ([UC-1104](UC-1104-ke-hoach-thu-nhap.md)) và tham số `fi_*` trong `config` ([UC-507](../access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md)); không số nào cứng trong code.

## Main Flow
1. Người dùng mở **Mốc tự do**. App đọc `GET /v1/freedom`.
2. **Thông số** ([Công thức 8, 9](README.md#công-thức)):
   - **Chi phí tháng E** và **chi Must tháng E_must**: số nhập tay (`fi_expense_monthly`, `fi_expense_must_monthly`) nếu có — mỗi số độc lập; để trống thì **theo sổ**: trung bình 3 tháng đã kết thúc gần nhất của Kết quả thu chi, làm tròn tới đồng — E = Must + Có thì tốt + Hưởng thụ (gồm lãi vay ở Must, phụ giúp bố mẹ ở Có thì tốt; không gồm trả nợ gốc, Thuế, Tích sản, Khác), E_must = dòng Must (gồm lãi vay). "Đủ 3 tháng" = sổ có giao dịch từ tháng sớm nhất trong ba tháng đó trở về trước; chưa đủ → không có số.
   - **Thu nhập nhà I**: trung bình 3 tháng đã kết thúc của Thu nhập (khi đủ 3 tháng); chưa đủ → mục tiêu cả nhà của bản kế hoạch mới nhất năm nay ("theo kế hoạch"); không có cả hai → không có số.
   - **Phần khóa p** = Σ phần trăm các luật nạp `percent` đang bật của ví Tích sản và ví Thuế đang dùng.
   - SWR, lạm phát, hệ số dự phòng F2, lãi thực F3, ngưỡng lãi cao, ba số tháng Mốc an tâm, năm sinh, tuổi mục tiêu F1 / F2 / F3 — đọc từ `config` (mặc định ở migration 0031: 3,5% · 3,5% · 110% · 3% · 15% · 6 / 12 / 24; năm sinh, tuổi trống).
   - Card **Thông số** một dòng: "Chi 20.000.000 ₫/tháng (tự nhập) · Must 15.000.000 · SWR 3,5% · lạm phát 3,5%" (theo sổ: "(theo sổ, 3 tháng gần nhất)"; chưa có E: "Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng"). Nút **Sửa** mở ngay tại màn sheet Tham số › Tài sản & tự do (cùng sheet với Cài đặt › Tham số, [UC-507](../access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md) AC-16); lưu xong toast, Mốc tự do đọc lại.
3. **Mốc an tâm** A1–A3 ([Công thức 10](README.md#công-thức)): tiền lỏng Q_lỏng = Σ dòng bảng cân đối có cờ Tiền lỏng (gồm vàng ở A1 — không liên quan Tiền chi được) so với n × E, n = ba số tháng. Mỗi hàng "6 tháng chi phí": chip đạt / chưa đạt, %, thanh, "Có 156.000.000 ₫ · cần 120.000.000 ₫ · 6 tháng"; dưới card "Tiền lỏng X đủ 7,8 tháng chi phí." (số tháng cắt về một chữ số lẻ). Câu chú: "Mất thu nhập thì cả nhà sống bình thường được bao lâu — gồm vàng và tài sản có cờ Tiền lỏng, không phải tiền chi tiêu. Khác Quỹ an tâm ở tab Tích sản." Quỹ an tâm ([UC-107](../ledger/UC-107-theo-doi-tich-luy.md)) giữ nguyên tên, công thức và chỗ hiện.
4. **Thu nhập** ([Công thức 11](README.md#công-thức)): **M2 · Thu nhập đủ chi** (I ≥ E), **M2′ · Đủ chi sau phần khóa** (I ≥ ⌈E × 100 ÷ (100 − p)⌉), **M3 · Thu nhập gấp đôi chi** (I ≥ 2E). Mỗi hàng "Thu nhập 45.000.000 ₫ · cần 33.333.334 ₫ — đạt" hoặc "— còn thiếu X"; chú card "Thu nhập nhà theo kế hoạch." / "theo sổ, 3 tháng gần nhất.". M1 để sau (cần chi phí từng người).
5. **Tự do** ([Công thức 12, 13](README.md#công-thức)): A = Σ dòng bảng cân đối có cờ Tài sản đầu tư (Tiền trong app, tài sản mua qua app chưa gắn mục, mục nhập tay có cờ; phải thu và người thuê còn nợ không có cờ này); **A_ròng = A − tổng nợ** (bảng cân đối, gồm thẻ tín dụng còn nợ). **F1 · Tự do cơ bản** = ⌈12 × E_must ÷ SWR⌉; **F2 · Tự do hoàn toàn** = ⌈12 × E × hệ số ÷ SWR⌉; **F3** = ⌈12 × E × hệ số ÷ lãi thực⌉. Đạt khi A_ròng ≥ mốc **hoặc** dòng tiền ròng sau bù lạm phát (P_ròng, [UC-1102](UC-1102-xem-bang-can-doi.md)) ≥ E_must (F1) / ⌈E × hệ số⌉ (F2, F3). Mỗi hàng: chip, %, thanh, "Tài sản đầu tư trừ nợ 486.000.000 ₫ / cần 5.142.857.143 ₫", "hoặc dòng tiền ròng 104.166 ₫ / cần 15.000.000 ₫"; có năm sinh và tuổi mục tiêu thì thêm hàng tuổi "45 tuổi · năm 2035 · còn 9 năm · ≈ 7,01 tỷ ₫ theo giá 2035" (số cần × (1 + lạm phát)^số năm còn lại, làm tròn tới đồng; hiện hai chữ số lẻ tỷ — ước lượng; đúng năm: "năm nay"; đã qua: "đã qua N năm", không có số quy đổi).
6. Phần trăm của mọi mốc = cắt về một chữ số lẻ, không chặn ở 100% (vd A1 có thể hiện 130%); mẫu số 0 / không có số → "—".
7. Card **Kế hoạch thu nhập {năm nay}** ([UC-1104](UC-1104-ke-hoach-thu-nhap.md)): dòng cả nhà, đầu năm, cả năm, từng người; nút **Sửa kế hoạch** (hoặc **Đặt kế hoạch** khi chưa có) và **Các năm ›**.
8. `GET /v1/freedom` trả thêm `projectionStart` — điểm xuất phát số thật của Thử số ([UC-1107](UC-1107-thu-so-du-phong.md)) — và `incomePlan` (năm nay; chưa có kế hoạch → null).
   - Kỹ thuật: `getFreedom` chạy song song bảng cân đối hôm nay, `readFiConfig`, kế hoạch năm nay, `statementRows` cho 3 tháng, và một batch (tháng đầu của sổ, Σ phần khóa); `milestones` là hàm thuần.

## Alternative Flows
- 1a. Claude gọi `get_balance_sheet` → khối `freedom` = `GET /v1/freedom`, luôn tính theo hôm nay kể cả khi truyền `date` ([UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md) AC-9).
- 2a. Chưa có E (không nhập tay, sổ chưa đủ 3 tháng) → mốc theo E (A1–A3, M2–M3, F2, F3) không có số cần, không có chip; hàng hiện "Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng"; Mốc an tâm vẫn hiện "Có X".
- 2b. Chưa có E_must → F1 không có số cần như 2a.
- 4a. Không có I → mốc thu nhập "chưa có số".
- 5a. Không có năm sinh hoặc tuổi mục tiêu của mốc → không có hàng tuổi.

## Exceptions
- E1. Mất mạng → nút **Sửa** (thông số) và **Sửa kế hoạch** / **Đặt kế hoạch** bị khoá; việc xem khi mất mạng theo khung chung của màn ([UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md)).
- E2. Thông số sai khi sửa → 400 `invalid_input` kèm tên ô, giá trị cũ giữ nguyên ([UC-507](../access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md) AC-16).

## Acceptance Criteria

### AC-1: Mốc Tự do trên tài sản đầu tư đã trừ nợ
- Given bảng như [UC-1102](UC-1102-xem-bang-can-doi.md) AC-1; E = 20.000.000, E_must = 15.000.000 (nhập tay); SWR 3,5%, hệ số 110%, lãi thực F3 3%
- When `GET /v1/freedom`
- Then F1 cần 5.142.857.143 ₫, F2 7.542.857.143 ₫, F3 8.800.000.000 ₫ (làm tròn lên tới đồng); A = 806.000.000 (không gồm phải thu), A_ròng = 806.000.000 − 320.000.000 = 486.000.000; F1 9,4%, F2 6,4%; dòng tiền ròng 104.166 / 15.000.000 — chưa đạt; màn: card Thông số "Chi 20.000.000 ₫/tháng (tự nhập) · Must 15.000.000 · SWR 3,5% · lạm phát 3,5%"; F1 "Tài sản đầu tư trừ nợ 486.000.000 ₫ / cần 5.142.857.143 ₫", "hoặc dòng tiền ròng 104.166 ₫ / cần 15.000.000 ₫"
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1103 Mốc tự do › UC-1103 AC-1 (mốc Tự do): F1 5.142.857.143, F2 7.542.857.143, F3 8.800.000.000; A 806.000.000, A_ròng 486.000.000; F1 9,4%, F2 6,4%; dòng tiền ròng 104.166 / 15.000.000 chưa đạt"; [`web/src/lib/freedom.test.ts`](../../web/src/lib/freedom.test.ts) › "Mốc tự do: câu chữ › UC-1103 AC-1: card Thông số một dòng — \"Chi 20.000.000 ₫/tháng (tự nhập) · Must 15.000.000 · SWR 3,5% · lạm phát 3,5%\"; chi phí theo sổ ghi rõ" · "… › UC-1103 AC-1: F1 \"Tài sản đầu tư trừ nợ 486.000.000 ₫ / cần 5.142.857.143 ₫\", \"hoặc dòng tiền ròng 104.166 ₫ / cần 15.000.000 ₫\""

### AC-2: Tuổi mục tiêu, quy theo lạm phát; thông số đổi không sửa code
- Given như AC-1, năm sinh 1990, F1 ở 45 tuổi, F2 ở 50 tuổi, lạm phát 3,5%, năm nay 2026
- When xem; rồi `PUT /v1/settings/config { fi_swr_bps: 300 }` và xem lại
- Then F1 "45 tuổi · năm 2035 · còn 9 năm · ≈ 7,01 tỷ ₫ theo giá 2035"; F2 "50 tuổi · năm 2040 · còn 14 năm · ≈ 12,21 tỷ ₫ theo giá 2040"; sau khi đổi SWR sang 3% → F1 cần 6.000.000.000 ₫ ngay lần đọc sau
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1103 Mốc tự do › UC-1103 AC-2 (tuổi, lạm phát): năm sinh 1990, F1 45 tuổi → năm 2035, còn 9 năm, ≈ 7,01 tỷ; F2 50 tuổi → 2040, còn 14 năm, ≈ 12,21 tỷ; SWR 3% → F1 6.000.000.000"; [`web/src/lib/freedom.test.ts`](../../web/src/lib/freedom.test.ts) › "Mốc tự do: câu chữ › UC-1103 AC-2: F1 \"45 tuổi · năm 2035 · còn 9 năm · ≈ 7,01 tỷ ₫ theo giá 2035\"; F2 \"≈ 12,21 tỷ ₫ theo giá 2040\""

### AC-3: Mốc an tâm — vàng là tiền lỏng, không phải tiền chi tiêu
- Given như AC-1 (Vàng ở A1, cờ Tiền lỏng mặc định bật); số tháng 6 / 12 / 24
- When xem; rồi tắt cờ Tiền lỏng của Vàng
- Then Q_lỏng 156.000.000 (tiền trong app 30.000.000 + vàng 126.000.000) = 7,8 tháng E; A1 cần 120.000.000 — đạt; A2 240.000.000 (65,0%); A3 480.000.000 (32,5%); Tiền chi được, còn để chi và Quỹ an tâm ([UC-107](../ledger/UC-107-theo-doi-tich-luy.md)) không đổi; sau khi tắt cờ: Q_lỏng 30.000.000 = 1,5 tháng, A1 25,0%; màn: "Có 156.000.000 ₫ · cần 120.000.000 ₫ · 6 tháng"; chưa có E thì chỉ "Có …" và câu cần chi phí
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1103 Mốc tự do › UC-1103 AC-3 (Mốc an tâm — vàng là tiền lỏng): Q_lỏng 156.000.000 = 7,8 tháng; A1 120.000.000 đạt, A2 65,0%, A3 32,5%; Tiền chi được, Quỹ an tâm không đổi; tắt cờ Vàng → 30.000.000 = 1,5 tháng, A1 25,0%"; [`web/src/lib/freedom.test.ts`](../../web/src/lib/freedom.test.ts) › "Mốc tự do: câu chữ › UC-1103 AC-3: Mốc an tâm — \"Có 156.000.000 ₫ · cần 120.000.000 ₫ · 6 tháng\"; chưa có E thì chỉ \"Có …\" và câu cần chi phí"

### AC-4: Mốc thu nhập
- Given E = 20.000.000; luật `percent` đang bật: Tích sản 30%, Thuế 10%; thu nhập TB 3 tháng trọn (Kết quả thu chi) 45.000.000
- When xem; rồi với sổ chưa đủ 3 tháng trọn; rồi không có cả sổ lẫn kế hoạch
- Then M2 đạt (≥ 20.000.000), M2′ đạt (≥ 33.333.334), M3 đạt (≥ 40.000.000); chưa đủ 3 tháng → I lấy mục tiêu cả nhà của bản kế hoạch mới nhất năm nay ([UC-1104](UC-1104-ke-hoach-thu-nhap.md)) kèm chữ "theo kế hoạch"; không có cả hai → mốc thu nhập "chưa có số"
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1103 Mốc tự do › UC-1103 AC-4 (mốc thu nhập): thu nhập TB 3 tháng trọn 45.000.000, E 20.000.000, khoá 40% → M2, M2′ (33.333.334), M3 đạt; chưa đủ 3 tháng → theo kế hoạch; không có cả hai → chưa có số"; [`web/src/lib/freedom.test.ts`](../../web/src/lib/freedom.test.ts) › "Mốc tự do: câu chữ › UC-1103 AC-4: mốc thu nhập — đạt / còn thiếu; thu nhập theo kế hoạch ghi \"theo kế hoạch\"; không có số → \"chưa có số\""

### AC-5: Chi phí theo sổ, gồm lãi vay
- Given E, E_must để trống; sổ có 3 tháng trọn, chi TB (Kết quả thu chi) Must 15.000.000 (gồm Lãi vay 300.000), Có thì tốt 3.000.000 (gồm danh mục phụ giúp bố mẹ 1.000.000), Hưởng thụ 2.000.000; trả nợ gốc 2.000.000/tháng
- When xem; rồi với sổ chưa đủ 3 tháng
- Then E 20.000.000, E_must 15.000.000 (lãi vay vào cả E và E_must; phụ giúp bố mẹ vào E, không vào E_must; trả gốc không vào E), kèm chữ "theo sổ, 3 tháng gần nhất"; chưa đủ 3 tháng → các mốc theo E hiện "Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng"
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1103 Mốc tự do › UC-1103 AC-5 (chi phí từ sổ, gồm lãi vay): E 20.000.000, E_must 15.000.000 theo sổ 3 tháng (lãi vay vào cả hai, Có thì tốt chỉ E, trả gốc không vào); chưa đủ 3 tháng → mốc theo E cần chi phí"; [`web/src/lib/freedom.test.ts`](../../web/src/lib/freedom.test.ts) › "Mốc tự do: câu chữ › UC-1103 AC-5: chưa có chi phí tháng → \"Cần chi phí tháng — nhập ở Tham số hoặc chờ đủ 3 tháng\""

### AC-6: Thông số mặc định
- Given DB mới sau migration 0031
- When `GET /v1/freedom`
- Then SWR 3,5%, lạm phát 3,5%, hệ số 110%, lãi thực F3 3%, lãi cao 15%, Mốc an tâm 6 / 12 / 24 tháng; chi phí tay, năm sinh, tuổi mục tiêu trống
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1103 Mốc tự do › UC-1103 AC-6 (mặc định): DB mới → SWR 3,5%, lạm phát 3,5%, hệ số 110%, lãi thực F3 3%, lãi cao 15%, Mốc an tâm 6 / 12 / 24; chi phí tay, năm sinh, tuổi mục tiêu trống"

## Dependencies
- Upstream UC: [UC-1102](UC-1102-xem-bang-can-doi.md) (tiền lỏng, tài sản đầu tư, nợ, dòng tiền ròng), [UC-1106](UC-1106-ket-qua-thu-chi.md) (E, E_must, I theo sổ), [UC-1104](UC-1104-ke-hoach-thu-nhap.md) (I theo kế hoạch), [UC-507](../access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md) (tham số `fi_*`), ledger [UC-109](../ledger/UC-109-quan-ly-danh-muc.md) (danh mục phụ giúp bố mẹ do nhà tự tạo)
- Downstream UC: [UC-1107](UC-1107-thu-so-du-phong.md) (`projectionStart`), [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md) AC-4, [UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md) AC-9

## Divergences & Open Questions
- [DIVERGENCE] Mốc F3: báo cáo frontend lát 3 nói màn hiện "F3" kèm câu "sống bằng lãi thực, không đụng vốn"; code chỉ hiện "F3" — câu đó nằm trong `MILESTONE_LABEL[…].hint` nhưng `FreedomRow` không dùng `hint` (cả M2 / M2′ / M3, F1, F2 cũng không hiện câu gợi ý). Tên M2 / M2′ / M3 do frontend đặt (proposal chỉ đặt tên F1, F2). → chủ nhà chọn: hiện câu gợi ý hay bỏ khỏi code.

## Traceability
- Code: `src/routes/freedom.ts` › `freedomRoutes`; `src/services/freedom.ts` › `getFreedom`; `src/domain/freedom.ts` › `milestones`, `FreedomParams`, `FreedomMilestones`, `ProjectionStart`, `Freedom`; `src/services/settings.ts` › `readFiConfig`; `src/services/reports.ts` › `statementRows`; `src/domain/reports.ts` › `buildIncomeStatement`; `src/services/balance.ts` › `getBalanceSheet`; `src/services/income-plans.ts` › `getYear`; `src/mcp/tools.ts` › `get_balance_sheet` (khối `freedom`)
- PWA: `web/src/screens/net-worth-freedom.tsx` › `MilestonesSection`, `Milestones`, `FreedomRow`, `ParamsSheet`, `PlanCard`; `web/src/lib/freedom.ts` › `paramsSummary`, `safetyText`, `incomeMilestoneText`, `incomeSourceText`, `freedomHaveText`, `freedomCashflowText`, `freedomTargetText`, `billionText`, `MILESTONE_LABEL`, `expenseNeededText`
- API / sự kiện: `GET /v1/freedom`; thông số qua `PUT /v1/settings/config` (lỗi `invalid_input`, nhật ký `config.update`)
- Dữ liệu: `config` khoá `fi_swr_bps`, `fi_inflation_bps`, `fi_fat_bps`, `fi_legacy_rate_bps`, `fi_high_interest_bps`, `fi_safety_months` (mặc định ở `migrations/0031_balance_sheet.sql`), `fi_expense_monthly`, `fi_expense_must_monthly`, `fi_birth_year`, `fi_target_age_f1|f2|f3` (không ghi sẵn); đọc `allocations` (`mode = 'percent'`) × `wallets.tier`
