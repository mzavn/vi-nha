# UC-207: Chốt tháng — bù ví chi lố, chia phần dư sang Tích sản / Ví Thưởng
- Status: implemented
- BR: BR-02, BR-07
- Decisions: ADR-111 (chốt tháng là quyết định của người: bù ví chi lố trước, phần dư chia Tích sản / Ví Thưởng theo tỷ lệ chọn mỗi tháng — thay quét 100% tự động và 5b cũ); D3 (chỉ phong bì chung tham gia — phần "ví âm không bị đụng" thay bởi ADR-111); `docs/core_design_rules.md` §5 (nhịp "Cuối tháng"); commits `b92fc0f`, `13e89cc`; ADR-92 (giá trị phe tiếng Anh `wealth_building`)
- Actor: người trong hộ (PWA: thẻ **Chốt tháng** ở Hôm nay → sheet xem trước → nút **Chốt tháng**); hệ thống chỉ mời (tin sáng ngày 1, notify UC-403)
- Trigger: `GET /v1/month-close?wealth_pct=` (xem trước), `POST /v1/month-close { month, wealth_pct }` (chốt). Không có tool MCP.

## History
- v1 (2026-09-22, commit `b92fc0f`): `monthSweep` + `closeMonth`: quét số dư dương của phong bì chung sang Tích sản đúng một lần (khoá theo `batch_id`), sinh lệnh chuyển tiền nếu khác tài khoản.
- v2 (2026-09-22, commit `13e89cc`): nối vào cron hằng ngày (ngày 1) và tin sáng "🧹 Đã quét …" kèm lệnh chuyển.
- v3 (2026-09-22, commit `8ef7a99`): memo lệnh chuyển của đợt quét là mã ngẫu nhiên riêng từng lệnh (UC-204).
- v4 (2026-10-07, commit `7424f26`): ví Tích sản được tìm theo phe `wealth_building` (thay `tichsan`, ADR-92, migration 0028); cách quét không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v5 (2026-10-16, commit `0528219`): **chốt tháng là quyết định của người** (ADR-111) — cron ngày 1 không ghi gì, tin sáng mời chốt (📌); `GET` / `POST /v1/month-close` chỉ cho tháng liền trước; bước 1 bù ví chi lố từ ví dư (trừ phần lương tháng sau đã bù), bước 2 chia Lợi nhuận thêm theo % Tích sản / Ví Thưởng (mặc định `config.month_close_wealth_pct` = 50; chưa có Ví Thưởng → 100%); bảng `month_closes` (migration 0034, schema v1.34) chặn chốt hai lần, điền sẵn tháng đã có lô `S…` cũ. Thay 5b (ví âm chờ lần chia sau) và quét 100% tự động. Đóng [OPEN] "chốt hai lần" (khoá chính `month_closes`), [OPEN] "dấu đã chốt đếm cả dòng void" và [OPEN] "tháng không có gì để quét không để dấu" (nay `POST` luôn ghi `month_closes`). AC-1…AC-5 viết lại, thêm AC-6…AC-11 (change [261015-chot-thang-va-keo-tich-san](../changes/archive/261015-chot-thang-va-keo-tich-san/proposal.md))

## Preconditions
- Có đúng một ví phe `wealth_building` active (seed; settings không cho tạo ví Tích sản thứ hai — access UC-506).
- Tháng chốt là **tháng liền trước** tháng hiện tại (giờ VN) và chưa có dòng `month_closes`.
- Cần mạng (không đi qua hàng đợi offline).

## Main Flow
1. Ngày 1, tin sáng (notify UC-403) có câu mời "📌 Tháng N: dư X sau khi bù chi lố — mở app để chốt" (hoặc "chi lố được bù Y, không còn dư"); cron **không ghi gì**. Hôm nay (PWA, pwa UC-702) hiện thẻ **Chốt tháng N** khi `GET` trả `closed: false` và có ví dư (`positiveTotal > 0`).
2. Mở sheet → `GET /v1/month-close?wealth_pct=` (`previewMonthClose`): tháng = tháng liền trước; đã có `month_closes` → `{ month, closed: true, closedAt, byMemberId, wealthPct }`.
3. **Ví tham gia**: ví đang dùng, `kind='envelope'`, `scope='shared'`, phe `must` (cả nhóm Có thì tốt) hoặc `nice` (`isMonthCloseParticipant`); Ví Thưởng không bao giờ tham gia. Số dư cuối tháng = cộng dồn `v_wallet_flow` tới hết tháng M.
4. **Bước 1 — bù ví chi lố**: hố của ví âm = |số dư| − phần lương tháng M+1 đã rót vào ví đó (Σ `fund` active vào ví, `month_key` = M+1; tối đa bằng |số dư|) — lương sau đã bù thì chốt không bù lại. P = Σ số dư dương, N = Σ hố, C = min(P, N). Ví dương i góp `floor(C·bᵢ/P)`, đồng lẻ vào ví dương đứng đầu. Ghép cặp kiểu đổ thác: ví âm xếp theo hố giảm dần, ví dương theo số dư giảm dần, hoà thì theo `wallets.sort` rồi `id`; mỗi cặp một bút toán `transfer` ví → ví. P ≤ N → bù tới đâu hay tới đó, ví âm còn lại chờ lần chia sau (sheet: "Còn chi lố, chờ lần chia sau"); L = 0.
5. **Bước 2 — Lợi nhuận thêm** L = P − C (khi > 0). Phần còn lại rᵢ của từng ví dương: `wealthᵢ = floor(rᵢ·X/100)` vào Tích sản, `rewardᵢ = rᵢ − wealthᵢ` vào **Ví Thưởng**. X: số nguyên 0–100, mặc định `config.month_close_wealth_pct` (chưa đặt → 50, access UC-507); PWA kéo bước 5 (bước 1 nếu mặc định không chia hết cho 5). Chưa đặt Ví Thưởng (hoặc ví đó đã tắt / không còn hợp lệ) → X = 100, gửi X < 100 → 400 `invalid_input`.
6. Xem trước trả `{ month, closed: false, participants (số dư cuối tháng, số dư hiện tại sau chốt), covers, profit, positiveTotal, covered, wealthPct, toWealth, toReward, sweeps, transferOrders, rewardWalletId, warnings }`. PWA không tự tính — mọi số từ server.
7. Bấm **Chốt tháng** → `POST /v1/month-close { month, wealth_pct }` (`closeMonth`) tính lại từ sổ và ghi trong **một** `db.batch`: INSERT `month_closes(month, closed_at, by_member_id, wealth_pct)` **đầu batch** (trùng khoá → 409 `already_closed`), bút toán bù (`note` "Chốt tháng YYYY-MM: bù chi lố cho {ví}"), bút toán quét ("… sang Tích sản" / "… sang Ví Thưởng"), lệnh chuyển tiền (UC-204 3b: gộp theo cặp tài khoản nguồn → đích của mọi move). Bút toán: `meaning='transfer'`, `batch_id = "S" + YYYYMM`, `source='system'`, `at` = 23:59:59 ngày cuối tháng M giờ VN, `month_key` = M — kể cả khi chốt muộn. Không có gì để ghi vẫn lưu dòng `month_closes` (thẻ Hôm nay biến mất).
8. Nhật ký `month.close` (target `month:YYYY-MM`, detail `wealth_pct`, `reward_wallet_id`, `to_wealth`, `to_reward`, `covered`). Trả 201 kết quả; PWA toast, thẻ biến mất.

## Alternative Flows
- 1a. Tắt tin sáng → ngày 1 không chạy gì (không câu mời, không chốt); người vẫn chốt từ Hôm nay.
- 1b. Tháng bị bỏ qua (không chốt) không mất: số dư là cộng dồn nên lần chốt tháng sau gộp luôn.
- 3a. Ví cá nhân (vd hai ví Chơi), ví `accrual` (Du lịch, Về quê, Nhà ở), `bill` (Điện nước, Lãi vay) → đứng ngoài.
- 6a. **Ví thành âm sau khi chốt muộn**: phần dư của M nằm trong "còn để chi" tới khi chốt; đã tiêu sang M+1 thì sau chốt ví đó âm — `warnings` liệt kê, sheet hiện "Sau khi chốt, {ví} còn −X (đã chi tháng M+1 bằng tiền dư tháng M) — sẽ bù ở lần chốt tháng M+1". Đó là chi lố của M+1.
- 7a. Hai `POST` cùng lúc → một 201, một 409 `already_closed`; chỉ một bộ bút toán `S…`. PWA báo "Tháng này vừa được chốt ở máy khác" và tải lại.

## Exceptions
- E1. Không có ví Tích sản → `DomainError("config", "Chưa có ví Tích sản.")` (400).
- E2. `month` khác tháng liền trước → 400 `month_not_closable` "Chỉ chốt được tháng liền trước (YYYY-MM)."; `month` sai dạng → 400 `invalid_input`.
- E3. `wealth_pct` không phải số nguyên 0–100, hoặc < 100 khi chưa có Ví Thưởng → 400 `invalid_input`.
- E4. Tháng đã chốt → 409 `already_closed` "Tháng YYYY-MM đã chốt.".

## Acceptance Criteria
### AC-1: Bù chi lố trước, phần dư vào Tích sản; chốt hai lần bị chặn (MODIFIED v5)
- Given seed: Ăn uống −500.000, Đi lại +1.200.000, Có thì tốt +3.440.000; chưa có Ví Thưởng
- When `POST /v1/month-close`; rồi `POST` lại
- Then bù Ăn uống 500.000: Có thì tốt góp 370.690, Đi lại 129.310; L = 4.140.000 → Tích sản +4.140.000; `month_closes` có dòng; lần hai 409 `already_closed`
- Tests: [`test/month-close.test.ts`](../../test/month-close.test.ts) › "planMonthClose › UC-207 AC-1: Ăn uống −500.000, Đi lại +1.200.000, Có thì tốt +3.440.000 → Có thì tốt góp 370.690, Đi lại 129.310; L = 4.140.000 vào hết Tích sản (chưa có Ví Thưởng)"; [`test/month-close.test.ts`](../../test/month-close.test.ts) › "chốt tháng qua API › UC-207 AC-1: seed (Ăn uống −500.000, Đi lại +1.200.000, Có thì tốt +3.440.000), chưa có Ví Thưởng → POST /v1/month-close ghi bù 370.690 + 129.310 và quét 4.140.000 sang Tích sản, month_closes có dòng; POST lại → 409 already_closed"; [`web/src/lib/month-close.test.ts`](../../web/src/lib/month-close.test.ts) › "chốt tháng ở PWA (change 261015-chot-thang-va-keo-tich-san) › UC-207 AC-1: thẻ \"Chốt tháng 9\" kèm số dư sau khi bù; closed → không có thẻ; không có gì để chốt → không có thẻ"

### AC-2: Ngày 1 chỉ mời chốt, không ghi; tắt tin sáng thì không chạy gì (MODIFIED v5)
- Given dữ liệu AC-1
- When cron ngày 1/10; tháng chỉ có bù; tin sáng tắt; tháng đã chốt trước giờ tin sáng
- Then không có giao dịch `S…`; tin có "📌 Tháng 9: dư 4.140.000 ₫ sau khi bù chi lố — mở app để chốt"; chỉ có bù → "Tháng 9: chi lố được bù …, không còn dư — mở app để chốt"; tắt tin sáng → không chạy gì, không ghi mốc `daily_run`; đã chốt → không mời
- Tests: [`test/cron-daily.test.ts`](../../test/cron-daily.test.ts) › "ngày 1: chốt tháng trước › UC-207 AC-2: ngày 1 cron không tạo giao dịch S…; tin sáng có câu mời \"Tháng 9: dư 4.140.000 ₫ sau khi bù chi lố — mở app để chốt\"" · "… › UC-207 AC-2: chỉ có bù, không còn dư → \"Tháng 9: chi lố được bù …, không còn dư — mở app để chốt\"" · "… › UC-207: tháng đã chốt trước giờ tin sáng → không mời"; [`test/cron-schedule.test.ts`](../../test/cron-schedule.test.ts) › "giờ nhắc: tin sáng theo giờ ở Cài đặt › UC-207 AC-2: tắt tin sáng → ngày 1 không chạy gì, không ghi mốc daily_run, không có giao dịch S…"; [`test/format.test.ts`](../../test/format.test.ts) › "dailyMessage › UC-207 AC-2: dòng 📌 mời chốt khi còn dư; câu riêng khi chỉ có bù; profit 0 và covered 0 → không có dòng"

### AC-3: Không có gì để chốt vẫn đánh dấu đã chốt (MODIFIED v5)
- Given không ví dương, không ví âm
- When tin sáng ngày 1; `GET`; `POST`
- Then không có dòng mời; `GET` trả `profit 0`, không move; `POST` vẫn lưu `month_closes`, `GET` sau đó `closed: true`
- Tests: [`test/cron-daily.test.ts`](../../test/cron-daily.test.ts) › "ngày 1: chốt tháng trước › UC-207 AC-3: không ví dương, không ví âm → không có dòng mời chốt"; [`test/month-close.test.ts`](../../test/month-close.test.ts) › "chốt tháng qua API › UC-207 AC-3: không ví dương, không ví âm → GET profit 0, không move; POST vẫn lưu month_closes, GET sau đó closed: true"

### AC-4: Bút toán thuộc về chính tháng được chốt, kể cả chốt muộn
- Given chốt tháng `2026-10` ngày 15/11
- When ghi bút toán
- Then `at` = 23:59:59 ngày 31/10 giờ VN (`2026-10-31T16:59:59Z`), `month_key = '2026-10'`
- Tests: [`test/month-close.test.ts`](../../test/month-close.test.ts) › "chốt tháng qua API › UC-207 AC-4: chốt muộn ngày 15/11 vẫn ghi bút toán lúc 23:59:59 ngày 31/10 giờ VN, month_key 2026-10"

### AC-5: Lệnh chuyển gộp theo cặp tài khoản nguồn → đích (MODIFIED v5)
- Given phong bì ở nhiều tài khoản; Tích sản và Ví Thưởng ở hai tài khoản khác nhau
- When chốt
- Then lệnh chuyển gộp theo cặp (nguồn, đích) → Tích sản và Ví Thưởng là hai lệnh; bù giữa hai ví cùng tài khoản không sinh lệnh
- Tests: [`test/month-close.test.ts`](../../test/month-close.test.ts) › "chốt tháng qua API › UC-207 AC-5: phong bì ở nhiều tài khoản → lệnh chuyển gộp theo cặp tài khoản nguồn → đích; Tích sản và Ví Thưởng ở hai tài khoản khác nhau → hai lệnh; bù giữa hai ví cùng tài khoản không sinh lệnh"

### AC-6: Bù ví âm trước theo đổ thác, phần dư chia 50/50
- Given bốn phong bì chung: Ăn uống +2.000.000, Đi lại +400.000, Khác −1.500.000, Mua sắm −600.000; Ví Thưởng đã đặt; X = 50
- When chốt
- Then bù Khác 1.500.000 rồi Mua sắm 600.000; Ăn uống góp 1.750.000, Đi lại 350.000; L = 300.000: Tích sản +150.000, Ví Thưởng +150.000; mọi ví tham gia về 0
- Tests: [`test/month-close.test.ts`](../../test/month-close.test.ts) › "planMonthClose › UC-207 AC-6: Ăn uống +2.000.000, Đi lại +400.000, Khác −1.500.000, Mua sắm −600.000, X = 50 → bù Khác 1.500.000 rồi Mua sắm 600.000 (đổ thác); Ăn uống góp 1.750.000, Đi lại 350.000; Tích sản 150.000, Ví Thưởng 150.000; mọi ví về 0" · "chốt tháng qua API › UC-207 AC-6: bốn phong bì chung, Ví Thưởng đã đặt, wealth_pct 50 → Tích sản +150.000, Ví Thưởng +150.000, bốn ví về 0"; [`web/src/lib/month-close.test.ts`](../../web/src/lib/month-close.test.ts) › "chốt tháng ở PWA (change 261015-chot-thang-va-keo-tich-san) › UC-207 AC-6: bảng bù, L, Tích sản / Ví Thưởng lấy đúng số server trả, không tự tính"

### AC-7: Dư không đủ bù
- Given Ăn uống +500.000, Khác −1.500.000
- When chốt
- Then Khác còn −1.000.000 (chờ lần chia sau), Ăn uống 0, L = 0; sheet nói "Chi lố được bù …, không còn dư" và số còn chi lố
- Tests: [`test/month-close.test.ts`](../../test/month-close.test.ts) › "planMonthClose › UC-207 AC-7: Ăn uống +500.000, Khác −1.500.000 → Khác còn −1.000.000, Ăn uống 0, L = 0"; [`web/src/lib/month-close.test.ts`](../../web/src/lib/month-close.test.ts) › "chốt tháng ở PWA (change 261015-chot-thang-va-keo-tich-san) › UC-207 AC-7: L = 0 nhưng có bù → câu \"Chi lố được bù …, không còn dư\"; ví âm chưa bù hết hiện số còn lại chờ lần chia sau"

### AC-8: Tỷ lệ phần dư vào Tích sản
- Given L = 1.000.000
- When `wealth_pct = 100`; 101 / −1 / 2,5; chưa đặt Ví Thưởng mà gửi 50
- Then Tích sản +1.000.000, Ví Thưởng không đổi; 400 `invalid_input`; 400 `invalid_input`. PWA: chưa có Ví Thưởng → thanh khoá 100% kèm câu chỉ tới Cài đặt › Tham số; có → thanh bước 5
- Tests: [`test/month-close.test.ts`](../../test/month-close.test.ts) › "planMonthClose › UC-207 AC-8: L = 1.000.000, X = 100 → Tích sản 1.000.000, không có move reward; X < 100 không có Ví Thưởng → lỗi bất biến" · "chốt tháng qua API › UC-207 AC-8: L = 1.000.000, wealth_pct 100 → Tích sản +1.000.000, Ví Thưởng không đổi; 101 / −1 / 2,5 → 400 invalid_input; chưa đặt Ví Thưởng mà gửi 50 → 400 invalid_input" · "chốt tháng qua API › UC-207: Ví Thưởng đã tắt → coi như chưa đặt (wealthPct 100, rewardWalletId null)"; [`web/src/lib/month-close.test.ts`](../../web/src/lib/month-close.test.ts) › "chốt tháng ở PWA (change 261015-chot-thang-va-keo-tich-san) › UC-207 AC-8: chưa có Ví Thưởng → thanh khoá ở 100%, kèm câu chỉ tới Cài đặt › Tham số; có Ví Thưởng → thanh bước 5"

### AC-9: Lương tháng sau đã bù thì chốt không bù lại
- Given Khác −1.500.000 cuối tháng 10; lương 3/11 rót 1.500.000 vào Khác; Ăn uống +2.000.000
- When chốt tháng 10
- Then không bù Khác; L = 2.000.000
- Tests: [`test/month-close.test.ts`](../../test/month-close.test.ts) › "planMonthClose › UC-207 AC-9: Khác −1.500.000 cuối tháng, lương tháng sau đã rót 1.500.000 vào Khác → không bù; L = 2.000.000" · "chốt tháng qua API › UC-207 AC-9: Khác −1.500.000 cuối tháng 10, lương 3/11 rót 1.500.000 vào Khác, Ăn uống +2.000.000 → GET không có dòng bù Khác, profit 2.000.000"

### AC-10: Chỉ chốt tháng liền trước
- Given hôm nay 15/11
- When `POST { month: "2026-09" }`
- Then 400 `month_not_closable`; `GET` trả tháng 2026-10
- Tests: [`test/month-close.test.ts`](../../test/month-close.test.ts) › "chốt tháng qua API › UC-207 AC-10: hôm nay 15/11 → POST { month: \"2026-09\" } → 400 month_not_closable; GET trả tháng 2026-10"

### AC-11: Ví tham gia, thứ tự khi hoà, cảnh báo ví âm sau chốt muộn, chốt cùng lúc, migration
- Given ví cá nhân / tích dồn / hoá đơn / Ví Thưởng; số dư hoà; chốt muộn sau khi đã tiêu tiền dư tháng 10 sang tháng 11; hai `POST` cùng lúc; DB cũ có lô `S…`
- When xem trước / chốt / chạy migration 0034
- Then chỉ phong bì chung must / nice tham gia, hoà thì theo `sort` rồi `id`; `warnings` liệt kê ví thành âm kèm số sau chốt và câu cảnh báo đúng tháng; một 201 một 409, một bộ bút toán; tháng có lô `S…` cũ được điền sẵn `month_closes` (100%, người chốt NULL)
- Tests: [`test/month-close.test.ts`](../../test/month-close.test.ts) › "planMonthClose › UC-207: chỉ phong bì chung must / nice tham gia; ví cá nhân, tích dồn, hoá đơn và Ví Thưởng đứng ngoài; hoà số dư thì xếp theo sort rồi id" · "chốt tháng qua API › UC-207: chốt muộn sau khi đã tiêu tiền dư tháng 10 sang tháng 11 → warnings liệt kê ví thành âm kèm số sau chốt" · "chốt tháng qua API › UC-207: hai POST cùng lúc → một 201, một 409 already_closed; chỉ một bộ bút toán S…"; [`web/src/lib/month-close.test.ts`](../../web/src/lib/month-close.test.ts) › "chốt tháng ở PWA (change 261015-chot-thang-va-keo-tich-san) › UC-207: cảnh báo ví âm sau chốt đúng câu chữ, tháng sau tính đúng khi chốt tháng 12"; test migration ở repo gốc; sheet và thẻ trên màn: ⚠ Chưa có test (giao diện — xem tay 390px / 1280px cục bộ)

## Traceability
- Code: `src/domain/close.ts` › `planMonthClose`, `isMonthCloseParticipant`, `isRewardWalletCandidate`, `DEFAULT_MONTH_CLOSE_WEALTH_PCT`, `previousMonth`, `nextMonth`, `endOfMonthIso`; `src/domain/transfer-orders.ts` › `monthCloseOrders`, `newTransferMemo`; `src/services/ledger.ts` › `previewMonthClose`, `closeMonth`, `insertTx`; `src/routes/v1.ts` › `GET` / `POST /month-close` (nhật ký `month.close`); `src/cron/daily.ts` › `monthCloseInvite`; `src/cron/schedule.ts`; `src/notify/format.ts` › `dailyMessage` (`monthClose`, 📌)
- PWA: `web/src/screens/month-close.tsx` (thẻ, sheet); `web/src/lib/month-close.ts`; `web/src/screens/today.tsx`, `today-desktop.tsx`
- Migrations/DB: `migrations/0034_month_closes.sql` (`month_closes`, điền sẵn từ lô `S…`; schema v1.34); `v_wallet_flow` (`migrations/0001_schema.sql`); config `month_close_wealth_pct`, `month_close_reward_wallet` (access UC-507)

## Divergences & Open Questions
- [DIVERGENCE] `plans/260921-2228-profit-first-pwa/phase-02-allocation-core.md` (Chốt kỳ) và `phase-07-cron-telegram.md` ghi `batch_id = sweep-<month_key>`; code dùng `S<YYYYMM>`.
- [OPEN] Xem trước và chốt cách nhau một khoảng (TOCTOU): `POST` chỉ gửi `{ month, wealth_pct }`, server tính lại từ sổ hiện tại — người kia ghi / huỷ giao dịch tháng M giữa lúc xem và lúc bấm thì bút toán khác bản đã duyệt (toast hiện số thật nên phát hiện được). Chưa có kiểm `expected` → 409 `plan_changed`.
- [OPEN] Chưa có tool MCP cho chốt tháng; chốt cần mạng.
- [OPEN] Chỉ ví **active** tham gia; phong bì chung đã tắt mà còn dư không bao giờ được chốt.
- [OPEN] Mọi lỗi `UNIQUE` / `PRIMARY KEY` trong batch chốt đều thành 409 `already_closed` (thực tế chỉ `month_closes` có khoá trùng được).
