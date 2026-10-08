# UC-207: Chốt tháng — quét dư phong bì chung sang Tích sản
- Status: implemented
- BR: BR-02, BR-07
- Decisions: D3 (chỉ quét số dư **dương** của phong bì chung; ví âm không bị đụng, được bù ở lần chia kế tiếp); `docs/core_design_rules.md` §5 (nhịp "Cuối tháng"); commits `b92fc0f`, `13e89cc`; ADR-92 (giá trị phe tiếng Anh `wealth_building`)
- Actor: hệ thống — cron 07:00 giờ VN ngày 1 hằng tháng, qua notify UC-403 "Kích hoạt chốt tháng ngày 1"
- Trigger: `daily(env, now)` khi ngày VN = 1 → `closeMonth(db, previousMonth(monthKey(now)))`. Không có route REST hay tool MCP.

## History
- v1 (2026-09-22, commit `b92fc0f`): `monthSweep` + `closeMonth`: quét số dư dương của phong bì chung sang Tích sản đúng một lần (khoá theo `batch_id`), sinh lệnh chuyển tiền nếu khác tài khoản.
- v2 (2026-09-22, commit `13e89cc`): nối vào cron hằng ngày (ngày 1) và tin sáng "🧹 Đã quét …" kèm lệnh chuyển.
- v3 (2026-09-22, commit `8ef7a99`): memo lệnh chuyển của đợt quét là mã ngẫu nhiên riêng từng lệnh (UC-204).
- v4 (2026-10-07, commit `7424f26`): ví Tích sản được tìm theo phe `wealth_building` (thay `tichsan`, ADR-92, migration 0028); cách quét không đổi (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Có đúng một ví phe `wealth_building` active (seed; settings không cho tạo ví Tích sản thứ hai — access UC-506).
- Tháng cần chốt là tháng liền trước (theo lịch VN) của ngày cron chạy.

## Main Flow
1. `batchId = "S" + YYYYMM` (vd `S202609`).
2. Nếu đã có **bất kỳ** dòng `transactions` với `batch_id = batchId` (không lọc `status`) → trả `{ batchId, already: true, sweeps: [], transferOrders: [] }`, không ghi gì.
3. Nạp ví active (`loadRefs`); tìm ví Tích sản (phe `wealth_building`).
4. Số dư cuối tháng mỗi ví = `SUM(delta)` của `v_wallet_flow` với `month_key ≤ tháng chốt` (bỏ qua giao dịch của các tháng sau).
5. `monthSweep`: chọn ví `kind='envelope'` **và** `scope='shared'` **và** phe `must` hoặc `nice` (gồm cả nhóm Have); lấy số dư; chỉ giữ số dư > 0.
6. Không có gì để quét → trả `{ already: false, sweeps: [] }`, không ghi gì.
7. Với mỗi ví bị quét, ghi một `transactions` `meaning='transfer'`: `wallet_id` = Tích sản, `counter_wallet_id` = ví bị quét, `amount` = số dư, `at = endOfMonthIso(tháng)` (23:59:59 ngày cuối tháng giờ VN), `month_key` = tháng chốt, `week_key = weekKey(at)`, `batch_id`, `source='system'`, `note = "Chốt tháng <YYYY-MM>: quét dư sang Tích sản"`.
8. Lệnh chuyển tiền: gộp tổng quét theo **tài khoản trú của ví bị quét**; với mỗi TK nguồn gọi UC-204 với một khoản về ví Tích sản → lệnh `from = TK nguồn`, `to = TK của Tích sản` (không sinh nếu trùng TK hoặc TK nguồn rỗng).
9. Bước 7 + 8 ghi trong **một** `db.batch`. Trả `{ batchId, already: false, sweeps, transferOrders }`.
10. Notify dùng kết quả: tổng quét > 0 → tin sáng thêm dòng "🧹 Đã quét <số> dư tháng <m> sang Tích sản" và mỗi lệnh "🔁 Chuyển <số> từ <TK> sang <TK>" (UC-402/UC-403).

## Alternative Flows
- 5a. Ví cá nhân (vd hai ví Chơi), ví `accrual` (Du lịch, Về quê, Nhà ở), `bill` (Điện nước) → giữ nguyên.
- 5b. Phong bì chung **âm** (tiêu lố) → không bị đụng; hố được bù ở lần chia kế tiếp (UC-201 AC-7).
- 2a. Cron chạy lại cùng ngày → bước 2 dừng; không quét thêm (notify cũng không gửi lại tin).

## Exceptions
- E1. Không có ví Tích sản → `DomainError("config", "Chưa có ví Tích sản.")` (400).

## Acceptance Criteria
### AC-1: Quét dư dương của phong bì chung đúng một lần; ví cá nhân và ví âm không bị đụng
- Given tháng 9/2026: chia 40.000.000 ngày 10; chi 3.000.000 "Đi chợ / nấu ăn" ngày 12 (ví Ăn còn −500.000)
- When `closeMonth("2026-09")`
- Then `sweeps` = `{ transport: 1.200.000, nice-to-have: 3.440.000 }`; gọi lần hai → `already: true`; Ăn vẫn −500.000; Chơi (chồng) vẫn 3.280.000; Tích sản = 12.000.000 + 1.200.000 + 3.440.000
- Tests: `test/api.test.ts` › "chia lương end-to-end › chốt tháng: quét dư dương của phong bì chung sang Tích sản đúng một lần; ví cá nhân và ví âm không bị đụng"

### AC-2: Cron ngày 1 chốt tháng trước, chạy lại không quét thêm, tin sáng báo đúng số và lệnh chuyển
- Given cùng dữ liệu AC-1
- When cron chạy 2026-10-01 07:00 VN, hai lần
- Then đúng 2 dòng `batch_id='S202609'`; tin có "🧹 Đã quét 4.640.000 ₫ dư tháng 9 sang Tích sản" và "🔁 Chuyển 4.640.000 ₫ từ VCB (chính) sang TCB (Tích sản)"; lần hai không ghi, không gửi thêm
- Tests: `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › quét đúng một lần dù chạy cron hai lần; ví cá nhân không bị đụng"

### AC-3: Không có gì để quét thì không có dòng chốt tháng
- Given không có phong bì chung nào dương
- When cron ngày 1
- Then tin không chứa "🧹"
- Tests: `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › không có gì để quét thì không có dòng chốt tháng"; `test/format.test.ts` › "dailyMessage › chốt tháng quét được 0 đồng thì không thêm dòng nào"; "dailyMessage › ngày 1: dòng chốt tháng kèm lệnh chuyển tiền, chỉ hiện khi số quét > 0"

### AC-4: Bút toán quét thuộc về chính tháng được chốt
- Given chốt tháng `2026-09`
- When ghi bút toán quét
- Then `at` = `2026-09-30T16:59:59.000Z` (23:59:59 VN 30/9), `month_key = '2026-09'`; giao dịch có `month_key` từ `2026-10` không tính vào số dư quét
- Tests: ⚠ Chưa có test kiểm `at`/`month_key` của bút toán quét

### AC-5: Phong bì chung ở nhiều tài khoản → mỗi tài khoản nguồn một lệnh chuyển
- Given hai phong bì chung dương trú ở hai TK khác nhau, Tích sản ở TK thứ ba
- When chốt tháng
- Then hai lệnh cùng đích, khác nguồn, mỗi lệnh memo riêng
- Tests: ⚠ Chưa có test (seed chỉ có phong bì chung ở `vcb-anh`)

## Traceability
- Code: `src/domain/close.ts` › `monthSweep`, `previousMonth`, `endOfMonthIso`, `Sweep`; `src/services/ledger.ts` › `closeMonth`, `insertTx`, `walletAccounts`; `src/domain/transfer-orders.ts` › `transferOrders`, `newTransferMemo`; `src/cron/daily.ts` › `daily` (nhánh `dayOfMonth === 1`); `src/notify/format.ts` › `dailyMessage` (`monthClose`)
- Migrations/DB: `v_wallet_flow` (`migrations/0001_schema.sql`), `idx_tx_batch` (0003, không unique)

## Divergences & Open Questions
- [DIVERGENCE] `plans/260921-2228-profit-first-pwa/phase-02-allocation-core.md` (Chốt kỳ) và `phase-07-cron-telegram.md` ghi `batch_id = sweep-<month_key>`; code dùng `S<YYYYMM>` (`src/services/ledger.ts:309`).
- [OPEN] Tính "đúng một lần" là kiểm-rồi-ghi ở app, không có ràng buộc DB (`idx_tx_batch` không unique). Hai lần `closeMonth` cùng tháng chạy song song có thể cùng thấy "chưa chốt" và quét hai lần (suy ra từ code; cron hiện chạy một lần/ngày).
- [OPEN] Tháng không có gì để quét thì không để lại dấu `S<YYYYMM>`; nếu sau đó có giao dịch ghi lùi ngày vào tháng đã qua và cron ngày 1 của tháng sau chỉ chốt tháng liền trước, tháng đó không bao giờ được chốt lại (chỉ có thể gọi `closeMonth` trực tiếp).
- [OPEN] Chỉ quét ví **active**; phong bì chung đã tắt mà còn dư dương thì không bao giờ được quét.
- [OPEN] Dấu "đã chốt" đếm cả dòng `void` (câu kiểm không lọc `status`).
