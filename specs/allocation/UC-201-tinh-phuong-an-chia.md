# UC-201: Tính phương án chia một khoản thu (engine)
- Status: implemented
- BR: BR-02, BR-07, BR-10
- Decisions: D1 (thứ tự ưu tiên), D2 (khoản thu thứ hai chỉ nạp phần thiếu), D3 (bù ví âm), D7 (tuần × số thứ Hai); commit `323e159`; ADR-59 (phần khóa theo nguồn thu), ADR-63 (nguồn cho thuê khóa 100% vào "Thu cho thuê"); ADR-92 (giá trị phe tiếng Anh `wealth_building`); ADR-94 (mã hệ thống tiếng Anh)
- Actor: hệ thống — hàm thuần `allocate`, được gọi bởi UC-202 và UC-203
- Trigger: lời gọi hàm `allocate(input)`; không có I/O, không đọc DB, không sinh số ngẫu nhiên

## History
- v1 (2026-09-22, commit `323e159`): engine thuần + `period.ts`; thứ tự Tích sản → Thuế → sàn Must → Must đủ → Hưởng thụ → phần dư; phong bì tuần nhân số thứ Hai; ví tiêu lố tháng trước được bù một lần; cùng priority chia theo tỷ lệ; chia một khoản thành hai lần cho cùng kết quả.
- v2 (2026-10-01, commit `034b7ff`): `input.stream` — có nguồn thu thì phần khóa lấy theo `locks` của nguồn (không trích Thuế), khóa trọn 100% thì dừng ngay không chạy dòng thác; không có nguồn giữ nguyên hành vi cũ; `WalletRule.splitWeekly` không đổi nhu cầu tháng (change `261001-cho-thue-lai`).
- v3 (2026-10-07, commit `7424f26`): phe Tích sản trong engine (`Tier`, `WalletRule.tier`) đổi giá trị `tichsan` → `wealth_building` (ADR-92, migration 0028); thứ tự và số chia không đổi. Sửa bước 2, 2b, [OPEN] luật không rơi vào bước nào (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v4 (2026-10-08, commit `21b9db0`): không đổi hành vi — Traceability ghi nguồn cho thuê là mã hệ thống `rental` (migration 0029, ADR-94) và nguồn của hộ mẫu (`salary-husband`, `salary-wife`, `rental`). (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- `input.income = { amount, taxable, at }`; `input.rules` = các `WalletRule` đang active (UC-202 nạp từ `loadRefs`); `input.stream` (tuỳ chọn) = `{ locks: [{walletId, percent}] }` của nguồn thu gắn trên khoản thu (UC-202), `undefined`/`null` = không có nguồn.
- `fundedThisMonth[w]` = tổng fund `active` vào ví `w` có `month_key` = tháng (giờ VN) của `income.at`.
- `balances[w]` = số dư hiện tại; `openingBalances[w]` = số dư trước tháng của `income.at` (UC-202 › `allocationContext`).

## Main Flow
Ký hiệu: `k = mondaysInMonth(monthKey(income.at))` (4 hoặc 5); `perMonth(r, v) = (v ?? 0) × (r.period === 'week' ? k : 1)`;
`funded(w) = fundedThisMonth[w] ?? 0`; `hố(r) = r.kind === 'envelope' ? max(0, −openingBalances[w]) : 0`;
`stillNeeded(r, base) = max(0, base + hố(r) − funded(w))`.

**Nhu cầu tháng `monthlyNeed(r)`** theo `mode`:
- `flat` → `perMonth(r, amount)`.
- `lump` → `amount ?? target_amount ?? 0` (không nhân hệ số kỳ).
- `goal` → `ceil(max(0, target_amount − (balances[w] − funded(w))) / monthsLeft(income.at, target_date))`, với
  `monthsLeft = max(1, (năm hạn − năm)×12 + (tháng hạn − tháng))` theo giờ VN (quá hạn → 1 tháng, dồn hết).
- `percent`, `remainder` → 0.
- `splitWeekly` (phong bì tháng chia đều theo tuần) **không** đổi nhu cầu: luật `period='month'` nên nhu cầu vẫn là số tháng; cờ này chỉ dùng cho dự kiến tuần ở ledger (UC-103 `weekTarget`).

**Sàn** `floorOf(r) = min(perMonth(r, floor_amount), monthlyNeed(r))`.

**Rót** (`pour`): các nhu cầu được xét theo `priority` tăng dần; trong một priority chỉ xét ví có nhu cầu > 0.
Nếu tổng nhu cầu nhóm ≤ pool → mỗi ví nhận đủ, pool giảm tương ứng. Nếu không → ví `i` nhận `floor(pool × need_i / Σneed)`,
đồng lẻ `pool − Σ phần đã chia` cộng cho ví **đứng đầu nhóm**, pool về 0 và các priority sau của bước này nhận 0.

1. Kiểm tra: `income.amount` là số nguyên > 0; có **đúng một** luật `remainder`.
2. Pool = `income.amount`. **Phần khóa** (không có nguồn thu): mỗi luật `mode='percent'` phe `wealth_building`, và phe `tax` **chỉ khi** `taxable`, nhận
   `floor(income.amount × percent)` — tính trên chính khoản thu, không phụ thuộc nhu cầu. Pool trừ các phần này; pool < 0 → lỗi cấu hình. Có nguồn thu → 2b.
3. **Sàn Must:** rót cho các luật phe `must`, nhóm `must`, `mode` ∉ {`remainder`,`percent`}, nhu cầu = `stillNeeded(r, floorOf(r))`.
4. **Must đủ:** rót cho cùng tập ví, nhu cầu = `max(0, stillNeeded(r, monthlyNeed(r)) − phần đã nhận ở bước 3)`.
5. **Hưởng thụ:** rót cho mọi luật phe `nice`; nhu cầu = `floor(income.amount × percent)` nếu `mode='percent'`, ngược lại `stillNeeded(r, monthlyNeed(r))`.
6. **Nhóm Have có dự kiến riêng:** rót tương tự bước 5 cho luật phe `must`, nhóm `have`, `mode ≠ 'remainder'`.
7. **Phần còn lại:** pool > 0 → cộng hết cho ví `remainder` (có thể 0, không âm).
8. `underfunded` = ví trong tập bước 3 có `floorOf > 0` và `funded + nhận lần này < floorOf + hố`.
9. `deficitCovered[w] = min(hố, funded + nhận) − min(hố, funded)` cho mọi luật có hố > 0; chỉ giữ giá trị > 0.
10. `funds` = các ví nhận > 0 (theo thứ tự lần đầu được rót). Kiểm bất biến Σ `funds` = `income.amount`, sai → ném `Error("Bất biến vỡ: …")`.
11. Trả `{ funds, underfunded, deficitCovered }`.

Đọc ngược bước 7 → 3 chính là **thứ tự bóp** khi thiếu tiền: Have về 0 → Hưởng thụ bị bóp → Must tụt từ dự kiến về sàn → dưới sàn thì gắn cờ; phần khóa không bao giờ bị chạm.

## Alternative Flows
- 2a. `taxable = false` → bỏ qua mọi luật phe `tax`.
- 2b. **Có nguồn thu** (`input.stream` khác `null`/`undefined`, ADR-59): **thay** bước 2 — phần khóa chỉ lấy theo `stream.locks`, mỗi lock nhận `floor(income.amount × lock.percent)` vào `lock.walletId` (ví bất kỳ, không cần có luật nạp); các luật `percent` của `wealth_building`/`tax` bị bỏ qua, **không trích Thuế dù `taxable`**. Pool < 0 → E3b.
  - `locks` rỗng (ví dụ `salary-husband`) → không khóa gì, toàn bộ khoản thu vào dòng thác (bước 3–7).
  - Tổng `percent` của các lock = 1 (sai số ±1e-9; ví dụ `rental` = `{rental-income: 100%}`) → đồng lẻ do làm tròn cộng về **ví khóa đầu tiên**, trả ngay `{ funds, underfunded: [], deficitCovered: {} }`: không chạy dòng thác, không cờ thiếu sàn, không bù hố (kể cả khi phong bì đang âm); `fundedThisMonth` của các ví chi tiêu không đổi vì không có fund nào vào chúng.
  - Tổng < 1 → phần còn lại chạy dòng thác như cũ (bước 3–11).
- 3a/4a/5a. Nhóm cùng priority không đủ tiền → chia tỷ lệ như mô tả `pour`; các bước sau nhận 0 (pool = 0).
- 5b. Ví `goal` đã đủ đích (`missing = 0`) → nhu cầu 0, không nhận gì; phần đó chảy xuống Have.
- 9a. Ví `accrual`/`bill`/`holding` có số dư đầu tháng âm → hố = 0, không được bù, không có trong `deficitCovered`.

## Exceptions
- E1. `income.amount` không nguyên hoặc ≤ 0 → `AllocationConfigError("Số tiền thu nhập phải là số nguyên dương (VND).")`.
- E2. Số luật `remainder` ≠ 1 → `AllocationConfigError("Cần đúng một ví nhận phần còn lại, đang có <n>.")`.
- E3. Tổng phần khóa > `income.amount` → `AllocationConfigError("Tổng phần trăm Tích sản + Thuế vượt 100% thu nhập.")`.
- E3b. Có nguồn thu và Σ phần khóa > `income.amount` → `AllocationConfigError("Tổng phần khóa của nguồn thu vượt 100%.")` (Cài đặt đã chặn tổng > 100% khi lưu, access UC-506).
- E4. Σ fund ≠ `income.amount` → `Error("Bất biến vỡ: chia <total> ≠ thu nhập <amount>.")` (lưới an toàn, không kỳ vọng xảy ra).
- `AllocationConfigError` không phải `DomainError` — xem [OPEN] ở UC-202 về mã HTTP.

## Acceptance Criteria
Fixture chung của test: seed thật (`migrations/0002_seed.sql`), tháng 9/2026 (4 thứ Hai), Du lịch đích 15.000.000 hạn 2026-12-10 (→ 5.000.000/tháng), chưa nạp gì.
Must dự kiến 13.000.000 (Nhà 8tr + Ăn 625k×4 + Đi lại 300k×4 + Điện nước 300k + Về quê 1tr), sàn 11.100.000; Hưởng thụ cần 11.560.000.

### AC-1: Đủ tiền — mọi ví đủ dự kiến, Have nhận phần dư (phase-02 case A)
- Given khoản thu 40.000.000, `taxable=false`
- When chia
- Then Tích sản 12.000.000, Thuế 0, Must 13.000.000, Hưởng thụ 11.560.000, Có-thì-tốt 3.440.000, `underfunded = []`
- Tests: `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › A — đủ tiền: mọi ví đủ dự kiến, Có-thì-tốt nhận phần dư"

### AC-2: Thiếu nhẹ — Have về 0 trước, rồi Hưởng thụ bị bóp; Must vẫn đủ (case B)
- Given khoản thu 30.000.000
- When chia
- Then Tích sản 9.000.000, Must 13.000.000, Du lịch 5.000.000 (priority 30 rót trước), hai ví Chơi (cùng priority 31) mỗi ví 1.500.000, Có-thì-tốt không nhận
- Tests: `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › B — thiếu nhẹ: Have về 0, Hưởng thụ bị bóp, hai ví Chơi chia đều, Must vẫn đủ"

### AC-3: Thiếu nặng — Must rót sàn theo priority, dưới sàn bị gắn cờ, phần khóa nguyên vẹn (case C)
- Given khoản thu 12.000.000
- When chia
- Then Tích sản 3.600.000; Nhà 8.000.000 (priority 40, đủ sàn), Ăn 400.000 (phần pool còn lại), Hưởng thụ 0, Có-thì-tốt 0; `underfunded = ["food","transport","utilities"]`; Về quê (không có `floor_amount`) không bị gắn cờ
- Tests: `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › C — thiếu nặng: Must dưới sàn bị gắn cờ, Tích sản vẫn đúng 30%"

### AC-4: Thuế chỉ trích khi khoản thu chịu thuế (case D)
- Given khoản thu 10.000.000, `taxable=true`
- When chia
- Then đúng ba fund `{ wealth-building: 3.000.000, tax: 1.000.000, housing: 6.000.000 }`; `underfunded = ["housing","food","transport","utilities"]`
- And với `taxable=false` (AC-1) ví Thuế không nhận
- Tests: `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › D — thu nhập ngoài chịu thuế: trích 10% vào ví Thuế"

### AC-5: Khoản thu thứ hai trong tháng chỉ nạp phần còn thiếu; B + E = A (case E, D2)
- Given đã chia 30.000.000 (case B) trong tháng, `fundedThisMonth` và `balances` = kết quả B
- When chia thêm 10.000.000
- Then Must nhận 0; Chơi mỗi ví 1.780.000; Có-thì-tốt 3.440.000; và với **mọi ví**, B + E = A đúng từng đồng
- Tests: `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › E — khoản thu thứ hai trong tháng chỉ nạp phần còn thiếu, và B + E = A"

### AC-6: Phong bì tuần cần số tuần = số thứ Hai của tháng (case F, D7)
- Given khoản thu 40.000.000 ngày 2026-11-10 (tháng 11/2026 có 5 thứ Hai)
- When chia
- Then Ăn 3.125.000 (625k×5), Đi lại 1.500.000, mỗi ví Chơi 4.100.000, Must 13.925.000, Có-thì-tốt 875.000
- Tests: `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › F — tháng có 5 thứ Hai: phong bì tuần cần 5 tuần tiền"; hàm đếm: `test/period.test.ts` › "tuần → tháng › đếm số thứ Hai thật của tháng"

### AC-7: Phong bì tiêu lố tháng trước được bù đúng một lần, phần bù lấy từ Have (case G, D3)
- Given ví Ăn (phong bì) có số dư đầu tháng −300.000
- When chia 40.000.000
- Then Ăn nhận 2.800.000 (2.500.000 + 300.000), Có-thì-tốt 3.140.000, `deficitCovered = { food: 300.000 }`
- And khi chia thành 30.000.000 rồi 10.000.000: tổng theo từng ví bằng chia một lần; lần đầu `deficitCovered = { food: 300.000 }`, lần hai `{}`
- Tests: `test/allocation.test.ts` › "bảng chia bắt buộc (seed hiện tại) › G — ví tiêu lố tháng trước được bù, phần bù lấy từ Có-thì-tốt"

### AC-8: Chỉ phong bì mới được bù hố
- Given ví Về quê (`accrual`) có số dư đầu tháng −500.000
- When chia 40.000.000
- Then Về quê nhận đúng 1.000.000 (nhu cầu tháng), `deficitCovered = {}`
- Tests: `test/allocation.test.ts` › "bất biến và ca biên › ví tích dồn bị âm không được tự bù (chỉ phong bì mới tiêu lố)"

### AC-9: Bất biến Σ fund = thu nhập, mọi fund là số nguyên dương
- Given khoản thu 1, 7, 999, 1.234.567, 33.333.333 ₫, mỗi số với `taxable` false và true
- When chia
- Then tổng `funds` = đúng số tiền; mọi `amount` nguyên và > 0
- Tests: `test/allocation.test.ts` › "bất biến và ca biên › tổng các fund luôn bằng đúng thu nhập (%i ₫)"

### AC-10: Tích sản luôn đúng tỷ lệ dù thiếu tới đâu (làm tròn xuống)
- Given khoản thu 1.000.000 / 5.000.000 / 12.000.000 / 80.000.000
- When chia
- Then Tích sản = `Math.floor(amount × 0.3)`
- Tests: `test/allocation.test.ts` › "bất biến và ca biên › Tích sản luôn đúng 30% dù thiếu tới đâu"

### AC-11: Ví mục tiêu — đạt rồi thì thôi, quá hạn thì dồn hết
- Given Du lịch đã có 15.000.000 → When chia 40.000.000 → Then Du lịch không nhận, Có-thì-tốt 8.440.000
- Given hạn Du lịch 2026-01-01 (đã qua), số dư 9.000.000 → When chia 60.000.000 → Then Du lịch nhận 6.000.000 (toàn bộ phần còn thiếu)
- Tests: `test/allocation.test.ts` › "bất biến và ca biên › mục tiêu đã đạt thì không nạp nữa"; "bất biến và ca biên › mục tiêu quá hạn: dồn hết phần còn thiếu vào tháng này"; `test/period.test.ts` › "số tháng còn lại tới hạn mục tiêu › tính cả tháng hiện tại, tối thiểu 1"

### AC-12: Ví không có luật nạp active thì không nhận gì
- Given luật của Về quê bị loại khỏi `rules`
- When chia 40.000.000
- Then Về quê không có trong `funds`
- Tests: `test/allocation.test.ts` › "bất biến và ca biên › ví không có trong luật nạp thì không nhận gì"

### AC-13: Cấu hình sai thì báo lỗi, không chia bừa
- Given không có luật `remainder`; hoặc thu nhập 0; hoặc 1000.5; hoặc Tích sản `percent = 1.2`
- When chia
- Then ném `AllocationConfigError` (E1–E3)
- Tests: `test/allocation.test.ts` › "bất biến và ca biên › cấu hình sai thì báo lỗi rõ ràng thay vì chia bừa"

### AC-14: Cùng priority thiếu tiền — đồng lẻ làm tròn về ví đầu nhóm
- Given hai ví cùng priority có nhu cầu không chia hết cho pool
- When pool không đủ
- Then mỗi ví nhận `floor(pool × need_i / Σneed)`, phần lẻ cộng cho ví đứng đầu nhóm, tổng nhóm = pool
- Tests: ⚠ Chưa có test cho phần lẻ (AC-2 chỉ phủ trường hợp chia hết)

### AC-15: Nhóm Have có luật riêng rót sau Hưởng thụ, trước phần dư
- Given một ví phe `must`, nhóm `have`, `mode ≠ remainder`
- When chia
- Then ví đó chỉ nhận sau khi mọi ví phe `nice` đã đủ, và trước ví `remainder`
- Tests: ⚠ Chưa có test

### AC-16: Nguồn cho thuê khóa 100% — đúng một fund, không dòng thác, không cờ
- Given nguồn `{rental-income: 100%}`, ví Ăn đầu tháng −500.000
- When chia 5.191.667
- Then kết quả đúng `{ funds: [{rental-income: 5.191.667}], underfunded: [], deficitCovered: {} }`
- Tests: `test/allocation.test.ts` › "chia theo nguồn thu › nguồn cho thuê khóa 100% vào Thu cho thuê: đúng một fund, không chạy dòng thác, không cờ thiếu sàn"

### AC-17: Nguồn khóa một phần — khóa trước, phần còn lại lấp chỗ thiếu, không trích Thuế
- Given nguồn `salary-wife` `{wealth-building: 45%}`, `taxable=true`
- When chia 11.000.000
- Then Tích sản 4.950.000; Thuế không nhận; 6.050.000 còn lại vào Must (dưới tổng sàn Must)
- Tests: `test/allocation.test.ts` › "chia theo nguồn thu › lương vợ khóa 45% Tích sản trước, phần còn lại lấp chỗ thiếu; không trích thuế theo luật chung"

### AC-18: Nguồn không khóa gì — toàn bộ vào dòng thác
- Given nguồn có `locks = []`, `taxable=true`
- When chia 19.100.000
- Then Tích sản và Thuế không nhận; Must 13.000.000, Hưởng thụ 6.100.000
- Tests: `test/allocation.test.ts` › "chia theo nguồn thu › nguồn không khóa gì: toàn bộ vào dòng thác, không cắt Tích sản/Thuế"

### AC-19: Không có nguồn thì y như cũ
- Given `stream: null`
- When chia 40.000.000 `taxable=true`
- Then kết quả trùng từng đồng với lần chia không khai báo `stream`
- Tests: `test/allocation.test.ts` › "chia theo nguồn thu › stream null y hệt không khai báo nguồn"

### AC-20: Khóa trọn 100% chia nhiều ví — đồng lẻ về ví khóa đầu tiên
- Given nguồn `{rental-income: 30%, wealth-building: 70%}`
- When chia 7 ₫
- Then `rental-income` 3, `wealth-building` 4
- Tests: `test/allocation.test.ts` › "chia theo nguồn thu › khóa trọn 100% chia nhiều ví: đồng lẻ làm tròn về ví khóa đầu tiên"

## Bảng 7 case phase-02 → test
| Case (`phase-02-allocation-core.md`) | Test | Khớp số trong plan |
|---|---|---|
| A đủ tiền | "A — đủ tiền: …" | ✅ đủ các cột |
| B thiếu nhẹ | "B — thiếu nhẹ: …" | ✅ |
| C thiếu nặng | "C — thiếu nặng: …" | ✅ (test kiểm Nhà + Ăn, không kiểm tổng Must 8.400.000 trực tiếp) |
| D thu ngoài | "D — thu nhập ngoài chịu thuế: …" | ✅ |
| E thu lần hai | "E — khoản thu thứ hai …" | ✅ + bất biến B+E=A |
| F tháng 5 tuần | "F — tháng có 5 thứ Hai: …" | ✅ (test không kiểm tổng Hưởng thụ 13.200.000 trực tiếp) |
| G bù ví âm | "G — ví tiêu lố tháng trước …" | ✅ + chia hai lần |
Các ca "thêm cho đủ ~20" của plan: goal đã đạt ✅, goal quá hạn ✅, income 1 ₫ ✅ (AC-9), Về quê không sàn ✅ (AC-3), không có remainder ✅ (AC-13);
**nhiều goal tranh tiền** ⚠ chưa có test; **ví không active** chỉ phủ gián tiếp (AC-12 loại luật khỏi input, không kiểm lọc `active` ở SQL); **percent làm tròn** chỉ phủ qua AC-9/AC-10.

## Traceability
- Code: `src/domain/allocation.ts` › `allocate`, `pour`, `AllocationConfigError`, `WalletRule` (gồm `splitWeekly`), `AllocationInput` (gồm `stream`), `AllocationResult`; `src/domain/period.ts` › `mondaysInMonth`, `monthKey`, `monthsLeft`
- Migrations/DB: `allocations` (`migrations/0001_schema.sql` mục 4), seed `migrations/0002_seed.sql`; `income_streams`, `income_stream_locks`, `allocations.split_weekly`, nguồn thu (`migrations/0007_income_streams_rental.sql` tạo `luong-chong`/`luong-vo`/`cho-thue`; 0029 đổi nguồn cho thuê thành mã hệ thống `rental`, ADR-94; hộ mẫu `docs/seed.sql`: `salary-husband`/`salary-wife`/`rental`)

## Divergences & Open Questions
- [DIVERGENCE] `docs/core_design_rules.md` §4 bước 5 và `phase-02-allocation-core.md` bước 5: "ví goal → ví nice flat/percent, theo priority", nhưng code rót phe `nice` **chỉ theo `priority`** (`src/domain/allocation.ts:157`), không phân biệt `mode`. Hành vi hiện tại khớp docs chỉ vì seed đặt Du lịch priority 30 < Chơi 31.
- [DIVERGENCE] Chú thích cột `floor_amount` "SÀN CỨNG — không bóp xuống dưới" (`migrations/0001_schema.sql:87`) nhưng engine vẫn rót dưới sàn khi thiếu và chỉ gắn `underfunded` (`src/domain/allocation.ts:163-165`); §4 docs mô tả đúng như code.
- [DIVERGENCE] Docs §4 bước 6 chỉ nói "have: ví remainder"; code có thêm bước rót cho ví nhóm Have **không** phải remainder (`src/domain/allocation.ts:158`) — không có trong docs/plan.
- [OPEN] Luật không rơi vào bước nào thì ví nhận 0 mà không báo: ví phe `must` nhóm `must` có `mode='percent'` (bị loại khỏi tập Must ở dòng 134, không thuộc bước 5–6), ví phe `wealth_building`/`tax` có `mode ≠ 'percent'`. Settings cho phép lưu các cấu hình này (`MODES` trong `src/services/settings.ts` không ràng theo phe).
- [OPEN] "Ví đứng đầu nhóm" nhận đồng lẻ = ví đứng trước trong `rules`, mà câu SQL nạp luật (`loadRefs`) không có `ORDER BY` → phụ thuộc thứ tự dòng của SQLite.
- [OPEN] Phần trăm là `REAL`; `floor(amount × percent)` dùng số thực JS nên một số tỷ lệ có thể hụt 1 ₫ (ví dụ `100 × 0.29 = 28.999…` → 28). Seed 0.3/0.1 được phủ bởi AC-9/AC-10; tỷ lệ khác chưa kiểm.
- [OPEN] Ví `remainder` là phong bì; nếu đầu tháng nó âm, engine không ưu tiên bù (nó chỉ nhận phần dư), nhưng `deficitCovered` vẫn báo phần phần dư đã lấp (vòng lặp dòng 169-174 duyệt mọi luật).
- [OPEN] Ví `goal` dùng số dư **hiện tại** (`v_wallet_balance`) trừ phần nạp trong tháng của khoản thu; chia một khoản thu của tháng cũ sau khoản của tháng mới có thể làm nhu cầu hiển thị lệch — red team đo lệch tối đa 1 ₫ do `Math.ceil` (`plans/reports/redteam-260922-0100-money-correctness.md`, mục "Thuộc tính đã kiểm chứng"), xếp mức thông tin.
- [DIVERGENCE] Proposal `261001-cho-thue-lai` mô tả nguồn `default` = bộ luật `percent` hiện tại; code không có dòng `default` nào — "không có nguồn" (`stream` `null`/`undefined`) mới là hành vi cũ. Seed `salary-husband` khóa rỗng nên lương gắn nguồn này **không** cắt Tích sản 30% như lương không gắn nguồn.
- [OPEN] Có nguồn thu thì bỏ hẳn bước Thuế: khoản `taxable=true` gắn nguồn không trích Thuế trừ khi nguồn tự khóa ví Thuế; không có cảnh báo nào.
- [OPEN] Lock trỏ tới ví đã tắt sau khi lưu nguồn: Cài đặt chỉ kiểm ví active lúc lưu phần khóa, tắt ví không kiểm phần khóa, và engine/`loadRefs` không lọc → vẫn nạp fund vào ví đã tắt (và không sinh lệnh chuyển tiền vì `walletAccounts` chỉ có ví active).
- [OPEN] Khóa 100% dừng sớm nên ví phong bì đang âm không được bù và không được báo `underfunded` trong lần chia đó — đúng ý ADR-63 nhưng người dùng không thấy cảnh báo nào.
