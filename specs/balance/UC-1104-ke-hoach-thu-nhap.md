# UC-1104: Kế hoạch thu nhập theo năm so với thực tế
- Status: implemented
- BR: BR-15, BR-02
- Decisions: ADR-100 (mỗi lần lưu là một dòng chỉ ghi thêm; mục tiêu hiện tại / đầu năm và % đạt đều tính ra, không lưu; ít câu SQL, không lặp theo năm hay tháng); ADR-104 (thực tế = thu nhập của Kết quả thu chi — khoản xếp lại Đầu tư / Tài chính không là thu nhập); ADR-90 (nhật ký thay đổi)
- Actor: người trong hộ (màn Tài sản & tự do › Mốc tự do › card Kế hoạch thu nhập, [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md))
- Trigger: bấm **Đặt kế hoạch** / **Sửa kế hoạch** (`PUT /v1/income-plans/:year`), mở card hoặc **Các năm ›** (`GET /v1/income-plans/:year`, `GET /v1/income-plans`)

## History
- v1 (2026-10-08, commit `d4f0ab3`): khởi tạo — kế hoạch thu nhập theo năm: mục tiêu cả nhà bắt buộc, chia theo người tuỳ chọn, mỗi lần lưu một bản mới (`income_plans`, `income_plan_lines`, migration 0033, schema v1.33 — cả hai bảng chỉ ghi thêm), so với thu nhập thật các tháng đã kết thúc, danh sách các năm; nhật ký `income_plan.version` (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))

## Preconditions
- Đã đăng nhập. Ghi cần mạng.

## Main Flow
1. **Đặt / sửa kế hoạch** một năm — sheet **Kế hoạch thu nhập {năm}**:
   - **Mục tiêu cả nhà / tháng** — thu nhập ròng mỗi tháng, bắt buộc, > 0;
   - **Chia theo người (tuỳ chọn)** — thêm / xoá dòng; mỗi dòng: tên, người (một thành viên hoặc **Chung**), số ròng mỗi tháng. Σ dòng không bắt buộc bằng mục tiêu cả nhà; sheet nhắc "Chưa chia X ₫" / "Chia vượt X ₫";
   - form điền sẵn bản hiện tại; câu "Lưu là một bản mới — mục tiêu đầu năm vẫn giữ."; nút **Lưu kế hoạch**.
   - Mỗi lần lưu là **một bản mới** (chỉ ghi thêm, không sửa đè): bản đầu tiên của năm là **mục tiêu đầu năm**, bản mới nhất là **hiện tại**. Năm nào từ 2000 tới năm sau cũng đặt / sửa được.
   - Kỹ thuật: `PUT /v1/income-plans/:year { household_monthly, lines?: [{ name, member_id, monthly_amount }] }` → trả năm vừa lưu; nhật ký `income_plan.version`.
2. **Xem năm** (card năm nay ở Mốc tự do; sheet một năm từ **Các năm ›**):
   - dòng đầu "Cả nhà 43.500.000 / 45.000.000 ₫ mỗi tháng · 96,6%" + thanh;
   - dòng phụ "Đầu năm 50.000.000 ₫ (87,0%) · cả năm 8,0% · tính trên 1 tháng đã kết thúc" (đầu năm chỉ hiện khi đã sửa);
   - "sửa N lần, lần cuối d/m" khi có hơn một bản;
   - khi có chia theo người: mỗi người một hàng "Lương · Chồng" — "28.000.000 / 30.000.000 ₫ · 93,3%"; người có thu nhập thật mà không có dòng kế hoạch vẫn có hàng (kế hoạch 0, % "—").
3. **Thực tế** ([Công thức 9](README.md#công-thức)) = thu nhập của Kết quả thu chi ([UC-1106](UC-1106-ket-qua-thu-chi.md) — mọi khoản thu còn hiệu lực, trừ khoản phân loại lại Đầu tư / Tài chính) trong các tháng **đã kết thúc** của năm, tính từ tháng có giao dịch đầu tiên của sổ:
   - TB tháng = Σ ÷ số tháng đó (làm tròn tới đồng); % tháng = TB ÷ mục tiêu hiện tại (kèm % so mục tiêu đầu năm); % cả năm = Σ ÷ (mục tiêu hiện tại × 12); phần trăm cắt về một chữ số lẻ;
   - theo người: thu nhập quy về **chủ tài khoản nhận tiền**; tài khoản chung / không chủ, hoặc tiền người thuê trả → **Chung**.
4. **Các năm ›** — sheet "Kế hoạch các năm": mỗi năm có kế hoạch một hàng, năm mới trước: "{năm} · 45.000.000 ₫/tháng", dòng phụ "đầu năm 50.000.000 ₫ · thực tế 43.500.000 ₫/tháng · 96,6% · cả năm 8,0%" (đầu năm chỉ khi khác hiện tại); năm chưa có tháng nào kết thúc trong sổ → "thực tế chưa có số". Chạm một năm → sheet năm đó, có nút **Sửa kế hoạch {năm}**.
5. Bản mới nhất năm nay là I "theo kế hoạch" của Mốc tự do khi sổ chưa đủ 3 tháng ([UC-1103](UC-1103-moc-tu-do.md) AC-4) và là các dòng thu nhập xuất phát của Thử số ([UC-1107](UC-1107-thu-so-du-phong.md)).

## Alternative Flows
- 1a. Chỉ đặt mục tiêu cả nhà → bản không có dòng chia; màn chỉ hiện dòng cả nhà.
- 2a. Năm chưa có kế hoạch → card "Chưa có kế hoạch năm nay." + **Đặt kế hoạch**; `GET /v1/income-plans/:year` vẫn trả 200 với `current: null`; sheet năm "Năm này chưa có kế hoạch.".
- 3a. Chưa có tháng nào đã kết thúc trong sổ của năm đó → dòng đầu "Cả nhà chưa có số / 45.000.000 ₫ mỗi tháng", dòng phụ "chưa có tháng nào kết thúc trong sổ", từng người "chưa có số / 30.000.000 ₫" (không hiện 0 và "—"); `monthlyAverage`, các % là null.

## Exceptions
- E1. Mục tiêu cả nhà thiếu, không phải số nguyên hoặc ≤ 0 → 400 `invalid_plan` ("Cần mục tiêu cả nhà (thu nhập ròng mỗi tháng, lớn hơn 0)."); sheet báo "Cần mục tiêu cả nhà" trước khi gửi.
- E2. Dòng chia: thiếu tên, người không tồn tại, số âm / không nguyên, hoặc quá 30 dòng → 400 `invalid_plan` (câu nói dòng nào). Sheet còn chặn dòng số 0 trước khi gửi (server nhận 0).
- E3. Năm ngoài 2000…năm nay + 1 (cả khi đọc lẫn ghi) → 400 `invalid_year`.
- E4. Mất mạng → nút Lưu kế hoạch / Sửa kế hoạch bị khoá, chú cần mạng.
- Mọi lỗi: không ghi bản nào, các năm khác không đổi.

## Postconditions
- Mỗi lần lưu thêm một dòng `income_plans` (+ các dòng `income_plan_lines` của bản đó) và một dòng nhật ký; không bản cũ nào bị sửa hay xoá.

## Acceptance Criteria

### AC-1: Sửa giữa năm, % đạt cả nhà và theo người
- Given năm 2026 bản 1 (ngày 2026-01-02) mục tiêu cả nhà 50.000.000, không chia; bản 2 (ngày 2026-07-01) mục tiêu cả nhà 45.000.000, chia "Lương" (Chồng) 30.000.000, "Lương" (Vợ) 12.000.000, "Cho thuê" (Chung) 3.000.000; sổ bắt đầu tháng 10; tháng 10 đã kết thúc: thu vào tài khoản của chồng 28.000.000, của vợ 12.500.000, người thuê trả 3.000.000; hôm nay 2026-11-15
- When `GET /v1/income-plans/2026`
- Then mục tiêu hiện tại 45.000.000, đầu năm 50.000.000 ("sửa 1 lần, lần cuối 1/7"); thực tế TB tháng 43.500.000 — 96,6% mục tiêu hiện tại, 87,0% mục tiêu đầu năm; cả năm 43.500.000 / 540.000.000 = 8,0% ("tính trên 1 tháng đã kết thúc"); theo người: Chồng 28.000.000 / 30.000.000 (93,3%), Vợ 12.500.000 / 12.000.000 (104,1%), Chung 3.000.000 / 3.000.000 (100,0%); thu nhập tháng 11 chưa tính; hai bản còn nguyên; màn: "Cả nhà 43.500.000 / 45.000.000 ₫ mỗi tháng · 96,6%", "Đầu năm 50.000.000 ₫ (87,0%) · cả năm 8,0% · tính trên 1 tháng đã kết thúc", "Lương · Chồng" "28.000.000 / 30.000.000 ₫ · 93,3%"
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1104 kế hoạch thu nhập theo năm › UC-1104 AC-1 (sửa giữa năm, % đạt): hiện tại 45.000.000, đầu năm 50.000.000; TB 43.500.000 — 96,6% / 87,0%; cả năm 8,0% trên 1 tháng; Chồng 93,3%, Vợ 104,1%, Chung 100,0%; tháng 11 chưa tính"; [`web/src/lib/income-plan.test.ts`](../../web/src/lib/income-plan.test.ts) › "Kế hoạch thu nhập theo năm › UC-1104 AC-1: \"Cả nhà 43.500.000 / 45.000.000 ₫ mỗi tháng · 96,6%\"; \"Đầu năm 50.000.000 ₫ (87,0%) · cả năm 8,0% · tính trên 1 tháng đã kết thúc\"; \"sửa 1 lần, lần cuối 1/7\"" · "… › UC-1104 AC-1: theo người — \"Lương · Chồng\" \"28.000.000 / 30.000.000 ₫ · 93,3%\", Vợ 104,1%, Chung 100,0%"

### AC-2: Chỉ mục tiêu cả nhà; lỗi không ghi gì
- Given chưa có kế hoạch 2027 (hôm nay năm 2026), năm 2026 như AC-1
- When `PUT /v1/income-plans/2027 { household_monthly: 60000000 }`; gửi không có mục tiêu cả nhà hoặc 0; dòng người không tồn tại; năm ngoài 2000…2027
- Then một bản 2027, không chia theo người, màn chỉ hiện dòng cả nhà; thiếu / 0 mục tiêu → 400 `invalid_plan`; người không tồn tại → 400 `invalid_plan`; năm ngoài khoảng → 400 `invalid_year`; năm 2026 không đổi; sheet: thiếu / 0 mục tiêu cả nhà → "Cần mục tiêu cả nhà", dòng không tên hay số 0 bị chặn, chia lệch → "Chưa chia 3.000.000 ₫" / "Chia vượt 1.000.000 ₫", form điền sẵn bản hiện tại
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1104 kế hoạch thu nhập theo năm › UC-1104 AC-2 (chỉ cả nhà; lỗi): 2027 một bản không chia; thiếu / 0 mục tiêu → invalid_plan; người không tồn tại → invalid_plan; năm ngoài khoảng → invalid_year; 2026 không đổi"; [`web/src/lib/income-plan.test.ts`](../../web/src/lib/income-plan.test.ts) › "Kế hoạch thu nhập theo năm › UC-1104 AC-2: chỉ mục tiêu cả nhà → một bản không chia; thiếu / 0 mục tiêu cả nhà → lỗi \"Cần mục tiêu cả nhà\"; dòng không tên hay số 0 bị chặn" · "… › chia theo người không bắt buộc bằng mục tiêu cả nhà: \"chưa chia 3.000.000 ₫\" / \"chia vượt 1.000.000 ₫\"; form sửa điền sẵn bản hiện tại"

### AC-3: Các năm
- Given kế hoạch 2025 mục tiêu 40.000.000 (sổ chưa có giao dịch năm 2025) và năm 2026 như AC-1
- When `GET /v1/income-plans`
- Then hai hàng: 2026 (45.000.000, đầu năm 50.000.000, 96,6%, cả năm 8,0%), 2025 (40.000.000, thực tế "chưa có số"); màn: 2026 "45.000.000 ₫ · đầu năm 50.000.000 ₫ · 96,6% · cả năm 8,0%", 2025 "thực tế chưa có số"
- Tests: [`test/freedom.test.ts`](../../test/freedom.test.ts) › "UC-1104 kế hoạch thu nhập theo năm › UC-1104 AC-3 (các năm): 2026 (45.000.000, đầu năm 50.000.000, 96,6%, cả năm 8,0%), 2025 (40.000.000, chưa có số)"; [`web/src/lib/income-plan.test.ts`](../../web/src/lib/income-plan.test.ts) › "Kế hoạch thu nhập theo năm › UC-1104 AC-3: các năm — 2026 \"45.000.000 ₫ · đầu năm 50.000.000 ₫ · 96,6% · cả năm 8,0%\"; 2025 thực tế \"chưa có số\""

## Dependencies
- Upstream UC: [UC-1106](UC-1106-ket-qua-thu-chi.md) (thu nhập thật), [UC-1105](UC-1105-luu-chuyen-tien.md) (phân loại lại), access [UC-507](../access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md) (thành viên)
- Downstream UC: [UC-1103](UC-1103-moc-tu-do.md) (I theo kế hoạch, card Kế hoạch), [UC-1107](UC-1107-thu-so-du-phong.md) (dòng thu nhập xuất phát), [UC-602](../mcp/UC-602-doc-so-lieu-qua-mcp.md) AC-9 (kế hoạch năm nay trong khối `freedom`)

## Divergences & Open Questions
- Không có mục mở. Ghi lại để biết: khi chưa có tháng nào kết thúc, màn hiện "chưa có số / mục tiêu" thay cho số 0 và "(—)" mà proposal không nói (báo cáo lát 3); thực tế theo người quy theo chủ tài khoản nhận tiền là cách v1 chủ nhà đã chốt (quyết định 5 của change) — lương về tài khoản chung tính vào Chung.

## Traceability
- Code: `src/routes/freedom.ts` › `freedomRoutes` (`/income-plans`, `/income-plans/:year`); `src/services/income-plans.ts` › `saveYear`, `getYear`, `listYears`, `loadYears`, `validYear`; `src/domain/freedom.ts` › `IncomePlanYear`, `IncomePlanVersion`, `IncomePlanActual`, `IncomePlanMember`, `IncomePlanSummary`
- PWA: `web/src/screens/net-worth-freedom.tsx` › `PlanCard`, `PlanBody`, `PlanSheet`, `YearsSheet`, `YearSheet`; `web/src/lib/income-plan.ts` › `planHeadline`, `planSub`, `editedText`, `memberPlanText`, `planYearRow`, `planFormFrom`, `planSplitHint`, `planPayload`
- API / sự kiện: `GET /v1/income-plans` · `GET /v1/income-plans/:year` (lỗi `invalid_year`) · `PUT /v1/income-plans/:year` (lỗi `invalid_plan`, `invalid_year`, `invalid_input` khi thân không phải object JSON); nhật ký `income_plan.version`
- Dữ liệu: migration `migrations/0033_income_plans.sql` (schema v1.33), bảng `income_plans` (trigger chỉ ghi thêm, index `(year, id)`), `income_plan_lines` (trigger chỉ ghi thêm); đọc `transactions` (`meaning = 'income'`, `tenant_id`, `month_key`), `accounts.owner_member_id`, `transaction_report_classes`, `members`
