# UC-712: Chuyển ngân sách & Bù ví âm
- Status: implemented
- BR: BR-01, BR-02, BR-04, BR-12
- Decisions: D3 (ví âm được bù lần chia sau — "Bù" là đường tay bù ngay), D12 (đi qua hàng đợi, ghi được khi offline), ADR-01 (Tích sản chỉ nhận, không rút ngược); ADR-63 (quỹ giữ riêng "Thu cho thuê": trả nợ hay sang Tích sản do vợ chồng quyết từng lần); DESIGN.md §4 (Sheet), mục "Ví âm"; ADR-67 (audit 261001 F01, F07, F15); ADR-71 (trả nợ gắn khoản nợ — `debt_id`); ADR-82 (heo đất là Tích sản — không còn card quỹ "Heo đất", bỏ nhánh card quỹ trú ở tài khoản khóa)
- Actor: thành viên đã đăng nhập
- Trigger: Ví & quỹ › Ngân sách (UC-707): nút **Bù** trên dòng "Số dư thật −X — vượt từ trước, chưa bù" của ví âm; nút **Chuyển ngân sách** dưới bảng; card quỹ giữ riêng (vd "Thu cho thuê"): nút **Trả nợ**, **Chuyển sang Tích sản**; Ví & quỹ › Nợ (UC-707): nút **Trả nợ** của tab và của sheet chi tiết khoản nợ

## History
- v1 (2026-10-01, commit `034b7ff`): dòng **Tổng chi tiêu** của bảng ngân sách; chip "Âm X" + **Bù**; nút **Chuyển ngân sách** (giao dịch `transfer` chỉ có hai ví, không tài khoản, đi qua hàng đợi); card quỹ giữ riêng với **Trả nợ** và **Chuyển sang Tích sản** (change `261001-cho-thue-lai`).
- v2 (2026-10-01, commit `11c52a0`): chip "Âm X" + link **Bù** (vùng chạm 16×36) thay bằng dòng riêng "Số dư thật −X — vượt từ trước, chưa bù" + nút **Bù** ≥ 44px, tách khỏi "còn lại" của kỳ (F15, F07); trên điện thoại dòng **Tổng chi tiêu** là một hàng tầng "còn lại" to + "đã chi X / Y" (F01) — audit 261001, ADR-67.
- v3 (2026-10-01, commit `25db5b9`): sheet Trả nợ có ô **Trả cho khoản nợ** (khoản còn nợ từ `bootstrap.debts`, chọn sẵn khoản còn nợ nhiều nhất hoặc khoản được mở từ), gửi `debt_id`; toast "Đã trả X cho {tên}. Còn nợ Y." / "… Hết nợ."; mở được từ tab Nợ (ví = ví mặc định của danh mục Trả nợ) — debt [UC-902](../debt/UC-902-tra-no.md), ADR-71.
- v4 (2026-10-03, commit `a8703fd`): ô **Số tiền** của sheet Chuyển ngân sách / Bù / Trả nợ gõ được phép tính; sai thì số tiền = 0 nên nút dừng ở "Nhập số tiền" — `AmountInput` chung, pwa [UC-703](UC-703-nhap-nhanh-khoan-chi.md) v10, AC-10, AC-11.
- v5 (2026-10-03, commit `3bc597c`): theo audit 261003 (M12, chủ nhà duyệt): card quỹ giữ riêng của heo đất (ví trú ở tài khoản `locked`) không còn **Trả nợ** / **Chuyển sang Tích sản** — tiền còn khóa trong sổ tiết kiệm; ghi chú nói cách ghi khi rút về. "Thu cho thuê" giữ nguyên (pwa UC-707 v12).
- v6 (2026-10-03, commit `e00814c`): theo ADR-82 (heo đất là Tích sản): ví `heo-dat` tắt (migration 0020) nên không còn card quỹ giữ riêng "Heo đất"; bỏ nhánh card quỹ trú ở tài khoản `locked` của v5 — mọi card quỹ giữ riêng lại có **Trả nợ** / **Chuyển sang Tích sản** và cùng ghi chú "Không vào ví chi tiêu. Trả nợ hay chuyển sang Tích sản là việc cả nhà quyết từng lần." (pwa UC-707 v13). Thêm [OPEN] tiền heo rút về không ra được khỏi Tích sản.
- v7 (2026-10-08, commit `1ed22e1`): không đổi hành vi — ghi chú card quỹ giữ riêng "hai vợ chồng quyết" → "cả nhà quyết" (nhà có 1–6 người, ADR-96) (change [261007-thiet-lap-lan-dau](../changes/archive/261007-thiet-lap-lan-dau/proposal.md))

## Preconditions
- Có `bootstrap` (danh sách ví) và snapshot (số dư ví, `reserves`). Bảng ngân sách đọc `/v1/budget` như UC-707 (offline thì bản cache của service worker nếu có).
- Ghi không cần mạng: mọi khoản ở đây đi qua hàng đợi (UC-704).
- Backend: ledger UC-101 Nhập tay một khoản tiền (`transfer` không `account_id`/`to_account_id`, có `from_wallet_id` + `wallet_id` = chuyển ngân sách; `spend` từ quỹ giữ riêng được phép), ledger UC-104 Ngân sách theo kỳ (dòng có `balance`; ví âm vẫn có dòng dù không có dự kiến, không chi), ledger UC-103 (snapshot `reserves`).

## Main Flow
1. Bảng Ngân sách (UC-707 bước 2), sau các nhóm: dòng **Tổng chi tiêu** — cộng Dự kiến và Thực tế của ví chi tiêu (`tier` `nice`/`must`: Hưởng thụ, Must, Có thì tốt), bỏ Tích sản và Thuế; ô ẩn số tính 0; Còn lại = Dự kiến − Thực tế (`budgetTotals`). Không có ví chi tiêu nào trong bảng → không có dòng Tổng. Điện thoại: hàng tầng "Tổng chi tiêu" với **còn lại** to bên phải và dòng phụ "đã chi X / Y". Màn rộng: lớp `dk-total`, ba cột so kỳ để trống.
2. Ví có `balance < 0` (số dư hiện tại, không theo kỳ, đã cộng trừ tạm hàng đợi) → dưới ví một dòng đỏ riêng "Số dư thật −X — vượt từ trước, chưa bù" + nút **Bù** (vùng chạm ≥ 44px) — tách khỏi số "còn lại" của kỳ để hai nghĩa "còn" không nằm chung một ô (`NegativeLine`, cả điện thoại lẫn màn rộng). Ví ẩn số (`balance = null`) không có dòng này. Ghi chú card: "… Ví âm thì bấm Bù để chuyển ngân sách từ ví khác sang."
3. Bấm **Bù** → sheet "Bù {tên ví}" điền sẵn (`coverPrefill`, số dư lấy từ snapshot đã trừ tạm): **Sang ví** = ví âm; **Số tiền** = phần âm; **Từ ví** = ví Có thì tốt còn dư nhiều nhất → không có thì ví chi tiêu (Must/Hưởng thụ) còn dư nhiều nhất → không ví nào dư thì ví Có thì tốt đầu tiên. Không bao giờ đề xuất quỹ giữ riêng, Tích sản, Thuế hay Thu nhập.
4. Hoặc bấm **Chuyển ngân sách** (dưới bảng) → sheet "Chuyển ngân sách" trống.
5. Sheet `MoveBudgetSheet`: **Số tiền**; **Từ ví** (`moveWallets(…, "from")`: bỏ ví Thu nhập, Tích sản, ví cá nhân của người kia — quỹ giữ riêng và Thuế vẫn có); dòng gợi ý "Ví này còn X." hoặc "Ví này còn X — chuyển xong sẽ âm." (khi biết số dư); **Sang ví** (`moveWallets(…, "to")`: như trên nhưng có Tích sản); **Ghi chú** (không bắt buộc); ghi chú cuối "Chỉ đổi số giữa hai ví trong app, tiền không rời tài khoản nào. Ví nằm ở hai tài khoản khác nhau thì chuyển tiền thật bằng "Chuyển nội bộ"."
6. Nút chính nói bước còn thiếu (`moveProblem`): "Nhập số tiền" · "Chọn hai ví" · "Hai ví phải khác nhau"; đủ thì "Chuyển X".
7. Bấm → `saveEntry({ meaning: "transfer", amount, at: bây giờ, client_id, from_wallet_id, wallet_id, note? })` — **không** có `account_id` → vào hàng đợi (UC-704) → toast "Đã ghi chuyển ngân sách[, chờ đồng bộ]." (`doneText`) → đóng sheet.
8. Trong lúc khoản còn trong hàng đợi: số dư hai ví đổi ngay (ví nhận +, ví bớt −) ở snapshot (`applyQueue`) và bảng ngân sách (`applyQueueToBudget`); Thực tế và Còn lại **không** đổi (chuyển ngân sách không phải chi tiêu). Ví vừa được bù hết dòng "Số dư thật … chưa bù", nhưng số Còn lại vẫn đỏ nếu kỳ này đã tiêu quá dự kiến.
9. **Quỹ giữ riêng**: dưới card Ngân sách, mỗi ví trong `snapshot.reserves` (tier `holding`, kind ≠ `holding`, vd "Thu cho thuê") một card: tên, chip "giữ riêng", **Số dư** (đã trừ tạm hàng đợi; ẩn số → "—"), ghi chú "Không vào ví chi tiêu. Trả nợ hay chuyển sang Tích sản là việc cả nhà quyết từng lần."; hai nút **Trả nợ**, **Chuyển sang Tích sản** — mọi card như nhau (không còn card "Heo đất": ví `heo-dat` đã tắt, ADR-82). Đang lọc một phe → không hiện card quỹ.
10. **Chuyển sang Tích sản** → `MoveBudgetSheet` tiêu đề "Chuyển sang {tên ví Tích sản}", điền sẵn Từ = quỹ giữ riêng, Sang = Tích sản, Số tiền = số dư quỹ (âm hoặc ẩn → 0) → bước 5–8. Chỉ đổi số giữa hai ví, không chuyển tiền giữa tài khoản. Hộ không có ví Tích sản → nút tắt.
11. **Trả nợ** → sheet `DebtSheet` "Trả nợ từ {tên quỹ}" (mở từ tab Nợ: quỹ = ví mặc định của danh mục `debt-payment`): nếu `bootstrap.debts` có khoản còn nợ (`payableDebts`) thì ô đầu là **Trả cho khoản nợ** — chọn sẵn khoản được mở từ (nếu còn nợ), không thì khoản còn nợ nhiều nhất (`defaultDebtId`), kèm gợi ý "{tên} còn nợ X."; **Số tiền**; gợi ý "{tên quỹ} còn X." (khi biết số dư); **Tiền ra từ** (chỉ tài khoản nhập tay được chiều ra — D14/ADR-66; mặc định tài khoản của người đang nhập); **Ghi chú** (không có khoản nợ nào thì ô này là **Trả cho** "khoản nợ nào"); **Ngày** (≤ hôm nay); ghi chú "Trả từ tài khoản SePay báo cả tiền ra thì đợi giao dịch về màn Gán, chọn Chi tiêu rồi chọn khoản ở ô Trả nợ cho." Nút chính: "Chưa có danh mục Trả nợ" · "Chưa có ví giữ riêng" · "Chọn khoản nợ" · "Nhập số tiền" · "Chọn tài khoản" · "Ghi trả nợ X" → `saveEntry({ meaning: "spend", amount, at, client_id, category_id: "debt-payment", wallet_id: <quỹ>, account_id, debt_id?, note? })` → hàng đợi (ghi được khi offline); toast có khoản nợ: "Đã trả X cho {tên}. Còn nợ Y." (`paymentToast`, trả đủ/dư: "… Hết nợ."); không khoản nợ: phản hồi ngân sách như khoản chi (UC-703).

## Alternative Flows
- 5a. Số tiền lớn hơn số dư ví nguồn → vẫn cho chuyển, chỉ báo "— chuyển xong sẽ âm.".
- 7a. `saveEntry` trả `false` (không ghi được vào máy) → sheet ở lại, nút bấm lại được.
- 11a. Trả nợ từ tài khoản nối feed báo tiền ra: không làm ở sheet này; gán log tiền ra ở màn Gán (UC-706) thành Chi tiêu · danh mục Trả nợ · ví quỹ giữ riêng (`spendableWallets` nay có quỹ giữ riêng), chọn khoản nợ ở ô **Trả nợ cho** (debt [UC-903](../debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md)).
- 11b. Tiền vào quỹ cần chuyển thật sang tài khoản Tích sản: gán log tiền ra ở UC-706 thành Chuyển nội bộ kèm **Từ ví** = quỹ, **Đến ví** = Tích sản (khi đó **không** bấm thêm "Chuyển sang Tích sản", nếu không ngân sách bị chuyển hai lần).
- 11c. Hộ chưa ghi khoản nợ nào (hoặc mọi khoản đã trả xong / `bootstrap` cũ chưa có `debts`): sheet như trước v3 — không ô chọn khoản nợ, không gửi `debt_id`, khoản chi không làm đổi sổ nợ.

## Exceptions
- E1. Server từ chối khi đồng bộ (`missing_wallet`, `unknown_wallet`, `same_wallet`, `locked_wallet` — ví nguồn là Tích sản hay ví Thu nhập, ví đích là ví Thu nhập) → khoản nằm lại `rejected` (UC-704). Danh sách ví của sheet đã loại các trường hợp này.
- E2. Hộ chưa có danh mục `debt-payment` → nút của sheet Trả nợ kẹt ở "Chưa có danh mục Trả nợ"; có khoản còn nợ mà ô khoản nợ trống → "Chọn khoản nợ".
- E2a. Đồng bộ bị từ chối vì khoản nợ vừa bị tắt (`inactive_debt`) → khoản nằm lại `rejected` (UC-704).
- E3. Không còn tài khoản nhập tay → ô Tiền ra từ thay bằng "Mọi tài khoản đã nối ngân hàng: khoản này sẽ tự về, gán nó ở màn Gán." (`AccountSelect`).

## Acceptance Criteria
### AC-1: Dòng Tổng chỉ cộng ví chi tiêu
- Given bảng có Tích sản (dự kiến 4.950.000), Ăn (7.000.000 / chi 7.300.000), Mua sắm (500.000 / chi 120.000) và một ví ẩn số
- When tính dòng Tổng chi tiêu
- Then Dự kiến 7.500.000, Thực tế 7.420.000, Còn lại 80.000; bảng chỉ có Tích sản → không có dòng Tổng
- Tests: `web/src/lib/budget.test.ts` › "dòng Tổng của bảng ngân sách › chỉ cộng ví chi tiêu, bỏ Tích sản / Thuế và ô ẩn số"; `web/src/lib/budget.test.ts` › "dòng Tổng của bảng ngân sách › không có ví chi tiêu thì không có dòng Tổng"

### AC-2: Bù điền sẵn đúng số và nguồn
- Given ví Ăn âm 300.000; Có thì tốt còn 225.000, Mua sắm còn 900.000
- When bấm Bù ở dòng Ăn
- Then Số tiền 300.000, Từ = Có thì tốt, Sang = Ăn; Có thì tốt hết tiền thì Từ = Mua sắm (không bao giờ quỹ giữ riêng dù quỹ dư nhiều hơn); không ví nào dư thì vẫn đề xuất Có thì tốt
- Tests: `web/src/lib/budget.test.ts` › "chuyển ngân sách › Bù ví âm: số = phần âm, nguồn ưu tiên Có thì tốt còn dư"; `web/src/lib/budget.test.ts` › "chuyển ngân sách › Có thì tốt hết tiền thì lấy ví chi tiêu còn dư nhiều nhất, không đụng ví giữ riêng"; `web/src/lib/budget.test.ts` › "chuyển ngân sách › không ví nào dư thì vẫn đề xuất Có thì tốt"

### AC-3: Không bao giờ rút ví Thu nhập hay Tích sản
- Given hộ có ví Thu nhập, Thu cho thuê, Tích sản, các ví chi tiêu và ví cá nhân của người kia
- When mở danh sách Từ ví / Sang ví
- Then Từ ví không có Thu nhập, Tích sản, ví cá nhân của người kia; Sang ví có thêm Tích sản; Thu nhập không ở danh sách nào
- Tests: `web/src/lib/budget.test.ts` › "chuyển ngân sách › không bao giờ dùng ví Thu nhập; Tích sản chỉ nhận; ví riêng người kia bị ẩn"

### AC-4: Nút chính nói bước còn thiếu
- Given số tiền 0 / thiếu một ví / hai ví trùng / đủ
- When xem nút chính
- Then lần lượt "Nhập số tiền" · "Chọn hai ví" · "Hai ví phải khác nhau" (nút tắt) · "Chuyển X" (bật)
- Tests: `web/src/lib/budget.test.ts` › "chuyển ngân sách › lý do chưa chuyển được"

### AC-5: Chuyển ngân sách chỉ đổi số dư ví, tài khoản không đổi
- Given chuyển 500.000 từ Có thì tốt sang Ăn (không tài khoản)
- When server ghi khoản
- Then Ăn +500.000, Có thì tốt −500.000, số dư sổ của tài khoản không đổi, phản hồi báo trạng thái ví Ăn; rút từ Tích sản hay ví Thu nhập, chuyển vào ví Thu nhập (`locked_wallet`), hai ví trùng (`same_wallet`), thiếu ví nguồn (`missing_wallet`) đều bị từ chối 400
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › chuyển ngân sách giữa hai ví: chỉ đổi số dư ví, tài khoản không đổi; báo ví nhận"; `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › chuyển ngân sách sai: %j → %s"

### AC-6: Chuyển chưa đồng bộ vẫn hiện ngay, không tính là chi
- Given bảng tháng: Ăn số dư −300.000 (chi 7.300.000), Có thì tốt số dư 225.000; hàng đợi có chuyển ngân sách 300.000 Có thì tốt → Ăn
- When tính bảng hiển thị
- Then Ăn số dư 0 (hết dòng "Số dư thật … chưa bù"), Thực tế vẫn 7.300.000 và Còn lại vẫn −300.000; Có thì tốt số dư −75.000, Thực tế 0
- Tests: `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › chuyển ngân sách chưa đồng bộ: số dư hai ví đổi ngay, thực tế chi không đổi"

### AC-7: Chuyển ngân sách ghi được khi offline
- Given máy offline
- When chuyển ngân sách 100.000
- Then khoản vào hàng đợi, toast "Đã ghi chuyển ngân sách, chờ đồng bộ.", sheet đóng
- Tests: ⚠ Chưa có test

### AC-8: Trả nợ chi thẳng từ quỹ giữ riêng
- Given quỹ "Thu cho thuê" có 5.191.667 (tiền người thuê chia trọn vào quỹ), hộ có danh mục `debt-payment`
- When ghi Trả nợ 3.000.000 từ quỹ
- Then khoản `spend` danh mục Trả nợ, ví = quỹ được ghi (không bị chặn `locked_wallet`), quỹ còn 2.191.667 và hiện trong `snapshot.reserves`, không có dòng trong `/v1/budget`; quỹ giữ riêng cũng có trong danh sách ví chi được của màn Nhập/Gán
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"; `web/src/lib/categories.test.ts` › "tự điền ví và tài khoản › danh sách ví chi được: bỏ Thu nhập, Tích sản, ví cá nhân người kia; ví giữ riêng chi được (trả nợ)"; sheet Trả nợ: ⚠ Chưa có test

### AC-9: Chuyển sang Tích sản điền sẵn số dư quỹ
- Given quỹ "Thu cho thuê" số dư 5.191.667
- When bấm "Chuyển sang Tích sản"
- Then sheet "Chuyển sang Tích sản" có Từ = Thu cho thuê, Sang = Tích sản, Số tiền 5.191.667; số dư âm thì Số tiền 0
- Tests: ⚠ Chưa có test

### AC-10: Dòng "Số dư thật … chưa bù" chỉ cho ví âm thấy được số
- Given ví A số dư −50.000 (kỳ này còn lại 500.000), ví B số dư 0, ví C ẩn số
- When xem Ngân sách
- Then chỉ ví A có dòng "Số dư thật −50.000 ₫ — vượt từ trước, chưa bù" và nút Bù (≥ 44px); "còn lại 500.000" của A vẫn là số riêng của kỳ
- Tests: ⚠ Chưa có test

### AC-11: Sheet Trả nợ chọn sẵn khoản còn nợ nhiều nhất, không gắn vào khoản hết nợ
- Given Cô Lan còn 6.000.000, Anh Tú còn 9.379.000, một khoản đã trả xong
- When mở Trả nợ từ card "Thu cho thuê"; từ khoản Cô Lan ở tab Nợ; từ khoản đã xong
- Then ô Trả cho khoản nợ chọn sẵn lần lượt Anh Tú, Cô Lan, Anh Tú; khoản đã xong không có trong ô; ghi xong khoản gửi đi mang `debt_id` của khoản đã chọn
- Tests: [`web/src/lib/debts.test.ts`](../../web/src/lib/debts.test.ts) › "sổ nợ › trả nợ mặc định chọn khoản còn nợ nhiều nhất"; sheet: ⚠ Chưa có test

### AC-12: Toast sau khi trả nợ nói còn nợ bao nhiêu
- Given Cô Lan còn 15.379.000
- When ghi trả 2.000.000; hoặc trả 500.000 khi còn 500.000; hoặc trả 800.000 khi còn 500.000
- Then "Đã trả 2.000.000 ₫ cho Cô Lan. Còn nợ 13.379.000 ₫."; hai trường hợp sau "Đã trả … cho Cô Lan. Hết nợ."
- Tests: [`web/src/lib/debts.test.ts`](../../web/src/lib/debts.test.ts) › "sổ nợ › toast sau khi trả nợ: Đã trả X cho tên. Còn nợ Y."

## Traceability
- Code: `web/src/screens/wallets.tsx` › `BudgetTab` (dòng Tổng, `cover`, card quỹ giữ riêng), `BudgetItem` / `BudgetRow` (`onCover`), `NegativeLine`; `web/src/screens/budget-sheets.tsx` › `MoveBudgetSheet`, `DebtSheet`; `web/src/screens/debts.tsx` › `DebtsTab` (mở `DebtSheet` từ tab Nợ); `web/src/lib/budget.ts` › `budgetTotals`, `moveWallets`, `coverPrefill`, `moveProblem`, `isIncomeHolding`; `web/src/lib/debts.ts` › `payableDebts`, `defaultDebtId`, `paymentToast`, `owedText`; `web/src/lib/pending.ts` › `effectsOf`, `applyQueue`, `applyQueueToBudget`; `web/src/lib/categories.ts` › `spendableWallets`, `manualAccounts`, `defaultAccountFor`, `defaultWalletFor`; `web/src/state/store.ts` › `saveEntry`, `doneText`, `viewSnapshot`; `web/src/lib/types.ts` › `BudgetLine.balance`, `Reserve`, `DebtRef`.
- Backend: ledger UC-101 Nhập tay một khoản tiền (chuyển ngân sách, chi từ quỹ giữ riêng, `debt_id`; `createEntry` báo ví nhận), UC-103 Xem "còn bao nhiêu để chi" (`reserves`), UC-104 Ngân sách theo kỳ (`balance`, giữ dòng ví âm), UC-111 (`bootstrap.debts`); debt UC-902 Trả nợ; `src/domain/types.ts` › `isIncomeHolding`, `isReserve`.

## Divergences & Open Questions
- [DIVERGENCE] Proposal `261001-cho-thue-lai` (v5) không có dòng Tổng chi tiêu, dòng ví âm + **Bù**, nút **Chuyển ngân sách** hay card quỹ giữ riêng; nó chỉ nói "Dùng tiền trong Thu cho thuê … không cần code mới": Trả nợ = `spend` từ `rental-income` danh mục `debt-payment`; sang Tích sản = `transfer` MB → BIDV kèm ví `rental-income` → `wealth-building`. Code thêm các nút trên; riêng "Chuyển sang Tích sản" ở card chỉ đổi số giữa hai ví, **không** chuyển tiền giữa tài khoản (`BudgetTab`, `web/src/screens/wallets.tsx`).
- [OPEN] Không có gì chặn ngân sách bị chuyển hai lần khi người vừa bấm "Chuyển sang Tích sản" ở card, vừa gán log chuyển khoản thật với **Từ ví**/**Đến ví** (UC-706) cho cùng một khoản tiền.
- [OPEN] (ADR-82) Tiền heo rút về tài khoản vẫn thuộc Tích sản "cho tới khi anh tự chuyển ví", nhưng sheet Chuyển ngân sách bỏ Tích sản khỏi **Từ ví** (`moveWallets(…, "from")`) và server từ chối ví nguồn Tích sản (`locked_wallet`, E1) — app chưa có đường đưa tiền đó ra khỏi Tích sản; chủ nhà chưa quyết.
- [DIVERGENCE] Proposal ghi ví `rental-income` có `kind = holding`; migration 0007 seed `kind = 'accrual'`. PWA phân biệt quỹ giữ riêng với ví Thu nhập đúng bằng `kind` (`isIncomeHolding` = tier `holding` **và** kind `holding`), nên code nhất quán; proposal sai.
- [OPEN] Server trả trạng thái **ví nhận** cho chuyển ngân sách (`createEntry`), nhưng toast chỉ "Đã ghi chuyển ngân sách." (`doneText` chỉ dùng trạng thái ví cho `spend`/`refund`) — không nói ví vừa bù còn bao nhiêu, khác luật "toast nói kết quả kèm hệ quả" (`docs/DESIGN.md` §4).
- [OPEN] "Bù" tay không để lại dấu "đã bù X" trong bảng ngân sách (xem [DIVERGENCE] ở UC-707); sau khi bù, số Còn lại vẫn đỏ vì đo chi so với dự kiến kỳ, chỉ dòng "Số dư thật … chưa bù" biến mất.
- [OPEN] Dòng Tổng tính ô ẩn số (ví riêng tư của người kia) là 0 ở cả Dự kiến và Thực tế, không có dấu hiệu nào cho biết tổng đang thiếu phần đó (`budgetTotals`).
