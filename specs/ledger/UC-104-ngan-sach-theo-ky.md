# UC-104: Ngân sách theo kỳ (dự kiến / thực tế / còn lại)
- Status: implemented
- BR: BR-01, BR-05
- Decisions: D7 (nhu cầu tháng = tiền tuần × số thứ Hai); `plans/260921-2228-profit-first-pwa/phase-01-worker-d1.md` S1, S2 (bỏ view ngân sách mù kỳ)
- Actor: thành viên (màn Ví), Claude (MCP `get_budget`), cron thứ Hai (notify UC-406)
- Trigger: `GET /v1/budget?period=YYYY-MM|YYYY-Www` (hoặc `?kind=week` = tuần hiện tại; không gửi = tháng hiện tại)

## History
- v1 (2026-09-22, commit `a773716`): schema v1.3 bỏ `v_envelope_week`, `v_budget_month`; ngân sách là query có tham số kỳ.
- v2 (2026-09-22, commit `b92fc0f`): `getBudget` trong `src/services/ledger.ts`.
- v3 (2026-10-01, commit `034b7ff`): mỗi dòng có thêm `balance` (số dư hiện tại); ví đang âm luôn hiện để còn bù; mục tiêu kỳ tuần qua `weekTarget` (gồm phong bì tháng chia theo tuần, tháng = tháng chứa thứ Hai đầu tuần); ví giữ riêng (`tier='holding'`) không vào bảng (change `261001-cho-thue-lai`).
- v4 (2026-10-01, commit `e5bae84`): đổi tên "Ngân sách theo kỳ (dự kiến / thực tế / còn lại)" — `target` của mỗi dòng gọi là **dự kiến** (số định chi của ví), không gọi "mục tiêu" (ADR-74); mô tả MCP `get_budget` đổi theo ("Bảng dự kiến / thực tế / còn lại…"). Không đổi trường hay cách tính.

## Preconditions
- `period` đúng dạng `^\d{4}-(0[1-9]|1[0-2])$` (tháng) hoặc `^\d{4}-W\d{2}$` (tuần).

## Main Flow
1. Xác định kỳ: route dùng `period` nếu có; không thì `kind=week` → `weekKey(now)`, còn lại → `monthKey(now)` (giờ VN).
2. Đọc "đã tiêu ròng" (`spend − refund`) theo ví của **đúng kỳ đó** (`v_spent_week` hoặc `v_spent_month`), tổng `fund` active theo ví của tháng đó, và số dư hiện tại mọi ví (`v_wallet_balance`).
3. Với mọi ví active **trừ** phe `holding` (ví Thu nhập **và** ví giữ riêng như "Thu cho thuê"), tính dự kiến:
   - Kỳ tuần: `weekTarget(luật, tháng chứa thứ Hai của tuần)` (`weekStart`, UC-103 "Dự kiến tuần"): `amount` nếu luật `flat` + `period='week'`; `floor(monthTarget ÷ mondaysInMonth)` nếu phong bì `flat`/`lump` bật `split_weekly`; ngược lại `null`.
   - Kỳ tháng, ví luật `remainder` (Có thì tốt): dự kiến = **phần đã được chia vào ví trong tháng** (Σ `fund`).
   - Kỳ tháng, ví khác: `monthTarget` (UC-103): `flat` tuần × `mondaysInMonth`, `flat` tháng, `lump`; `percent`/`goal` → `null`.
4. Bỏ các ví có dự kiến `null` **và** đã tiêu = 0 **và** số dư ≥ 0 — ví đang âm luôn được giữ để còn bù từ ví khác (pwa [UC-712](../pwa/UC-712-chuyen-ngan-sach-va-bu.md)).
5. Mỗi dòng: `target` (dự kiến), `spent`, `remaining = target − spent` (`null` nếu dự kiến `null`), `balance` = số dư hiện tại của ví (không phụ thuộc kỳ); ví `private` của người khác → cả bốn `null`. Không có trường "đã bù" (`deficitCovered`) trong bảng.
6. Trả `{period, kind: "week"|"month", weeks: 1 | mondaysInMonth(tháng), lines}`.

## Alternative Flows
- 1a. MCP `get_budget` không truyền kỳ → tháng hiện tại.

## Exceptions
- E1. Kỳ sai dạng (ví dụ `2026-13`) → `invalid_period` 400 "Kỳ phải có dạng 2026-09 hoặc 2026-W39."

## Acceptance Criteria
### AC-1: Phong bì tuần tính theo số thứ Hai thật của tháng
- Given ví `food` luật `flat` 625.000/tuần; tháng 11/2026 có 5 thứ Hai
- When `GET /v1/budget?period=2026-11`
- Then `weeks = 5`; dòng `food` có `target = 3.125.000`; `period=2026-13` → 400
- Tests: `test/api.test.ts` › "chia lương end-to-end › ngân sách tháng: phong bì tuần tính theo số thứ Hai thật"; `test/period.test.ts` › "tuần → tháng › đếm số thứ Hai thật của tháng"

### AC-2: Ngân sách tuần chỉ tính khoản của đúng tuần đó, trừ hoàn tiền
- Given chi ở tuần W39 và tuần khác, có hoàn tiền
- When hỏi ngân sách tuần W39
- Then mỗi phong bì tuần có `spent` = chi − hoàn của W39, `target` = dự kiến tuần
- Tests: gián tiếp — `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › đã tiêu/dự kiến từng ví phong bì tuần + top 5 danh mục (spend trừ refund), loại tuần khác"

### AC-3: Dự kiến tháng của Có thì tốt = phần đã được chia trong tháng
- Given tháng có hai lần chia nạp tổng X vào ví `remainder`
- When hỏi ngân sách tháng đó
- Then dòng Có thì tốt có `target = X`
- Tests: ⚠ Chưa có test

### AC-4: Không trả bảng rỗng đầu tuần
- Given đầu tuần chưa có khoản chi nào
- When hỏi ngân sách tuần hiện tại
- Then vẫn có đủ các phong bì tuần với `spent = 0` (lỗi S1 của view cũ không tái diễn)
- Tests: `test/schema.test.ts` › "migrations › đã bỏ hai view ngân sách mù kỳ"; gián tiếp — `test/cron-weekly.test.ts` › "cron 08:00 thứ Hai: tổng kết tuần vừa qua › tuần không có chi tiêu: vẫn hiện các ví phong bì (0 đồng), không có mục top 5"

### AC-5: Kỳ tuần của phong bì tháng chia theo tuần
- Given ví `food` đổi sang `flat` 2.800.000/tháng, `split_weekly = 1`; tuần `2026-W45` bắt đầu thứ Hai 2/11/2026, tháng 11/2026 có 5 thứ Hai
- When `GET /v1/budget?period=2026-W45`
- Then dòng `food` = `{target: 560.000, spent: 0, remaining: 560.000}`; bảng tháng hiện tại có `balance` của `food` = số dư `v_wallet_balance`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › phong bì tháng chia theo tuần: dự kiến tuần = tháng ÷ số thứ Hai, còn để chi dùng dự kiến tuần"; `test/period.test.ts` › "tuần ISO › thứ Hai của %s là %s"

### AC-6: Ví giữ riêng không nằm trong bảng ngân sách
- Given "Thu cho thuê" có số dư 2.191.667
- When `GET /v1/budget?period=2026-09`
- Then không có dòng `rental-income`
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › tiền người thuê: tự gắn nguồn cho thuê, chia trọn vào Thu cho thuê; trả nợ chi thẳng từ ví đó"

### AC-7: Ví âm vẫn có dòng dù không có dự kiến, không có chi
- Given một ví không có dự kiến kỳ, không chi trong kỳ, số dư −300.000
- When hỏi ngân sách kỳ
- Then có dòng của ví đó với `target = null`, `spent = 0`, `balance = −300.000`
- Tests: ⚠ Chưa có test

## Traceability
- Code: `src/routes/v1.ts` › `GET /budget`; `src/services/ledger.ts` › `getBudget`; `src/domain/snapshot.ts` › `monthTarget`, `weekTarget`; `src/domain/period.ts` › `mondaysInMonth`, `weekKey`, `monthKey`, `weekStart`
- Migrations/DB: `v_spent_week`, `v_spent_month`, `v_wallet_balance` (`migrations/0001_schema.sql`); `allocations.split_weekly` (`migrations/0007_income_streams_rental.sql`)

## Divergences & Open Questions
- [DIVERGENCE] `migrations/0001_schema.sql` dòng 268–270 và `docs/core_design_rules.md` §10: query ngân sách "nằm ở `src/db/queries.ts`" — thư mục `src/db/` rỗng; query nằm trong `src/services/ledger.ts` › `getBudget`.
- [DIVERGENCE] `phase-03-api.md` dòng 29 liệt kê `GET /wallets`, `/wallets/:id` (số dư, mục tiêu, đã chi, còn lại theo ví) — không có route này; thông tin theo ví lấy từ `/v1/snapshot` và `/v1/budget`.
- [OPEN] Kỳ tuần chỉ kiểm dạng `YYYY-Www`. Từ change `261001-cho-thue-lai`, `weekStart` ném `Error` thường với `W00` hay `W54`…`W99` → **500** `internal` thay vì `invalid_period`; `W53` của năm chỉ có 52 tuần được nhận và trả thứ Hai của tuần 1 năm sau.
- [OPEN] Ví luật `goal`/`percent` (Du lịch, Tích sản, Thuế) có dự kiến `null` ở bảng tháng nên chỉ hiện khi có chi tiêu (hoặc số dư âm).
- [OPEN] `balance` là số dư **hiện tại**, kể cả khi hỏi một kỳ đã qua; một ví đang âm hiện ở bảng của mọi kỳ.
- [OPEN] Bảng vẫn không có "đã bù X" (`deficitCovered` không lưu ở đâu) — pwa UC-707 vẫn thiếu phần này.
