# UC-202: Xem trước phương án chia
- Status: implemented
- BR: BR-02, BR-05
- Decisions: D2, D3 ("giao diện phải ghi rõ đã bù X", `docs/core_design_rules.md` §4); commit `b92fc0f`; dry-run theo `phase-02-allocation-core.md` (Todo "dry-run"); ADR-59 (phần khóa theo nguồn thu); ADR-108 (Tự chia: số tay thắng luật nạp và phần khóa); ADR-112 (Có / Không Tích sản khi chia; Tích sản 0 cần lý do — thay một phần ADR-108)
- Actor: thành viên hộ (PWA, màn nhập thu nhập / màn Gán); Claude qua MCP tool `preview_allocation` (UC-605 "Chia thu nhập qua MCP")
- Trigger: `POST /v1/allocate/preview` (tuỳ `amounts` — Tự chia); MCP `preview_allocation`; nút **Tự chia** ở sheet Chia thử trước khi ghi (PWA)

## History
- v1 (2026-09-22, commit `b92fc0f`): route preview + `previewAllocation` (cùng đường tính với lần chia thật, không ghi).
- v2 (2026-10-01, commit `034b7ff`): nhận `income_stream_id` — chia theo phần khóa của nguồn; nguồn không có → `unknown_income_stream` (change `261001-cho-thue-lai`).
- v3 (2026-10-12, commit `a8b43f7`): **Tự chia** (ADR-108) — chủ nhà: "tôi muốn tự chia được không? k cần template". `POST /v1/allocate/preview` nhận `amounts` (bỏ qua luật nạp, phần khóa nguồn thu, sàn / bù thiếu); sheet Chia thử có nút Tự chia ở ba chỗ, Tích sản đứng đầu, điền sẵn theo luật, chân Đã chia / còn / vượt, nhắc khi Tích sản 0. Lệch đề bài: lệnh chuyển xem trước của Tự chia tính ở máy; màn Gán nhiều dòng thu nhập thì Tự chia chỉ áp dòng đầu. Thêm 3a, 5b, AC-6, AC-7 (change [261012-tu-chia](../changes/archive/261012-tu-chia/proposal.md))
- v4 (2026-10-16, commit `0528219`): **Có / Không Tích sản** (ADR-112): `/allocate/preview` nhận `wealth_amount`, trả `wealth { walletId, amount, adjustable }`; sheet Chia thử có hai nút Có (thanh 1–100%, mặc định 10%) / Không (ô Lý do bắt buộc); Tự chia không còn câu nhắc Tích sản 0. AC-7 sửa, thêm 3b, 5c, AC-8 (change [261015-chot-thang-va-keo-tich-san](../changes/archive/261015-chot-thang-va-keo-tich-san/proposal.md))

## Preconditions
- Người gọi đã xác thực (`/v1/*` qua `requireAuth` — access UC-502/UC-503).
- Có cấu hình luật nạp hợp lệ (UC-201 E2/E3).

## Main Flow
1. Route đọc body JSON: `amount` (bắt buộc, số nguyên), `taxable` (chỉ `true` mới tính là chịu thuế), `at` (tuỳ chọn; rỗng → thời điểm hiện tại, qua `normalizeAt`), `account_id` (tuỳ chọn; tài khoản nhận tiền), `income_stream_id` (tuỳ chọn; nguồn thu), `amounts` (tuỳ chọn; Tự chia — bước 3a), `wealth_amount` (tuỳ chọn; Tích sản người chọn — bước 3b).
2. `previewAllocation` nạp luật nạp active và mọi nguồn thu kèm phần khóa (`loadRefs`), và ngữ cảnh tháng của `at` (`allocationContext`):
   - `fundedThisMonth`: `SUM(amount)` các `transactions` `status='active'`, `meaning='fund'`, `month_key = monthKey(at)`, theo `wallet_id`.
   - `balances`: `v_wallet_balance` hiện tại.
   - `openingBalances`: `SUM(delta)` của `v_wallet_flow` với `month_key < monthKey(at)`.
3. Có `income_stream_id` → tìm nguồn trong `refs.incomeStreams` (gồm cả nguồn đã tắt); không thấy → E6. Gọi engine `allocate` (UC-201) với `stream` = nguồn đó (`null` nếu không gửi).
3a. **Tự chia** — có `amounts: [{ wallet_id, amount }]` → bỏ qua luật nạp, phần khóa của nguồn thu (`income_stream_id` bị bỏ qua) và sàn / bù thiếu: `funds` = đúng các số > 0 đã gửi (`manualFunds`, hợp đồng và lỗi như UC-203 E6, E7), `underfunded = []`, `deficitCovered = {}`.
3b. **Tích sản người chọn** (`wealth_amount`, ADR-112): số nguyên ≥ 0, ≤ khoản thu (sai → 400 `invalid_amounts`); không nguồn thu → thay khoản cắt % của Tích sản (Thuế vẫn cắt); có nguồn thu → thay phần khóa Tích sản của nguồn (nguồn không khóa Tích sản → thêm khoản cắt Tích sản); nguồn khóa 100% → 400 `invalid_amounts`; Tích sản + Thuế + phần khóa khác > khoản thu → 400 `invalid_amounts` (không 500); gửi cùng `amounts` → 400 `invalid_amounts`. Phương án trả thêm `wealth: { walletId, amount, adjustable }` (`adjustable` false khi nguồn khóa 100%; `null` khi nhà chưa có ví Tích sản). Preview **không bao giờ** trả `wealth_note_required`.
4. Sinh bản nháp lệnh chuyển tiền `transferOrders(funds, wallet→account, account_id)` (UC-204; không có memo).
5. Trả `200 { ok: true, data: { funds, underfunded, deficitCovered, transferOrders } }`. **Không ghi gì vào DB.**

## Alternative Flows
- 1a. Không có `account_id` → không sinh lệnh chuyển tiền (`transferOrders` trả `[]`).
- 1b. MCP `preview_allocation`: input `{ amount: int > 0, taxable: boolean }` (zod), `at` = thời điểm gọi, `accountId = null` → luôn không có lệnh chuyển tiền; không nhận nguồn thu → luôn chia theo luật % chung.
- 1c. PWA (nhập thu nhập tay, màn Gán) gửi nguồn đang chọn; chọn người thuê mà không chọn nguồn thì gửi nguồn cho thuê ở cấu hình (`incomeStreamId` của `/v1/rental`), cho khớp với nguồn server sẽ gắn khi ghi (ledger UC-101 4f). Route **không** tự suy nguồn từ `tenant_id`.
- 5b. **Tự chia ở PWA** (ADR-108): sheet **Chia thử trước khi ghi** có `Seg` Theo luật / **Tự chia** ở cả ba chỗ dùng sheet — nhập thu nhập tay (pwa UC-705), màn Gán khi có dòng thu nhập (pwa UC-706), chi tiết khoản thu chưa chia (pwa UC-715). Bật lên: mỗi ví đang dùng trừ ví giữ tiền (Thu nhập, Thu cho thuê) một ô số (`AmountInput`, có phép tính), điền sẵn số của bảng chia theo luật, ví không có trong bảng thì 0; **Tích sản đứng đầu** kèm câu "Profit First: để dành trước — nhỏ cũng được". Chân: "Đã chia X / Y" và "còn Z" hoặc "chia vượt Z" (đỏ); nút ghi tắt khi tổng lệch hay có ô sai (âm, không ra số — lỗi dưới ô). Ô Tích sản theo lựa chọn Có / Không Tích sản (5c); Không Tích sản cần lý do (ADR-112 — thay câu nhắc "Tháng này chưa để dành Tích sản" của ADR-108). Lệnh chuyển xem trước của Tự chia **tính ở máy** (`splitOrders`, cùng cách gộp theo tài khoản đích của ví như UC-204), không gọi lại `/v1/allocate/preview`. Tắt Tự chia → về bảng chia theo luật. Màn Gán có nhiều dòng thu nhập: bảng chia thử và Tự chia chỉ áp cho **dòng thu nhập đầu tiên**; các dòng sau chia theo luật.
- 5c. **Có / Không Tích sản ở PWA** (ADR-112): đầu sheet Chia thử (ba chỗ như 5b) có hai nút **Có Tích sản** (mặc định) · **Không Tích sản** — chủ nhà: "để 2 lựa chọn khi tiền vào … mặc định chọn có tích sản thì là để kéo từ 1% trở lên, thanh luôn để mặc định 10%, còn không thì hiển thị nút lý do". Có → thanh kéo 1–100%, vạch 1% · 10% · 30%, **mặc định luôn 10%** (không theo % luật nạp); kéo → số tiền làm tròn tới nghìn (khoản thu dưới 100.000 thì tới đồng, tối thiểu 1 đồng), gõ số → thanh nhảy theo (một chữ số lẻ; dưới 1% hay vượt khoản thu chỉ kẹp khi rời ô). PWA luôn gửi `wealth_amount`; Theo luật thì phần còn lại xem trước lại qua server (lần xem trước đầu không gửi `wealth_amount`; server trả `adjustable` thì đặt 10% và xem lại; kéo thì giữ bảng cũ trong lúc chờ); Tự chia thì ô Tích sản đồng bộ với thanh, không gọi lại server. Không → ẩn thanh, ô **Lý do** bắt buộc ("Vì sao lần này không trả cho mình?"), thiếu thì nút ghi tắt; gửi `wealth_amount: 0` + `wealth_note`. Nguồn khóa 100% (tiền người thuê) → không có lựa chọn này (lưới Tự chia vẫn có hàng Tích sản). Đổi nguồn thu → dò `adjustable` lại; đổi số tiền → giữ %. Toast sau khi chia (nhập thu nhập tay, chi tiết khoản thu) thêm "(Tích sản X ₫)" hoặc "(không Tích sản lần này)".
- 5a. PWA hiển thị từng fund kèm "đã bù X cho tháng trước" khi `deficitCovered[wallet]` > 0 và banner "Chưa tới sàn: …" khi `underfunded` không rỗng (`web/src/screens/other-entry-sheet.tsx`) — chi tiết UI thuộc `specs/pwa/`.

## Exceptions
- E1. Body không phải object JSON → 400 `invalid_input` "Nội dung gửi lên phải là một object JSON.".
- E2. `amount` không phải số nguyên → 400 `invalid_input` "amount phải là số nguyên.".
- E3. `at` không parse được → 400 `invalid_at` "Ngày giờ không hợp lệ.".
- E4. `at`/`account_id` không phải chuỗi → 400 `invalid_input` "<tên> phải là chuỗi.".
- E5. Engine ném `AllocationConfigError` (thu nhập ≤ 0, cấu hình remainder/phần trăm sai) → vì không phải `DomainError`, `app.onError` trả **500** `internal` "Lỗi hệ thống. Thử lại sau." (MCP: `isError` với cùng thông điệp chung).
- E6. `income_stream_id` không phải chuỗi → 400 `invalid_input`; không có nguồn này → 400 `unknown_income_stream` "Không có nguồn thu "<id>".".

## Acceptance Criteria
### AC-1: Preview không ghi gì và cho đúng số như lần chia thật
- Given DB seed, chưa có fund nào
- When `POST /v1/allocate/preview { amount: 40000000, at: "2026-09-10T09:00:00+07:00", account_id: "vcb-husband" }`
- Then `data.funds` chứa `{ walletId: "wealth-building", amount: 12000000 }` và bảng `transactions` vẫn không có dòng `meaning='fund'`
- Tests: `test/api.test.ts` › "chia lương end-to-end › preview không ghi gì; allocate ghi đúng các fund và lệnh chuyển tiền"

### AC-2: Ngữ cảnh tháng tính theo `month_key` của `at`
- Given đã có fund trong tháng 9 và ví Ăn âm từ tháng 8
- When preview với `at` trong tháng 9
- Then engine nhận `fundedThisMonth` chỉ gồm fund `active` của tháng 9 và `openingBalances` gồm mọi dòng chảy có `month_key` < `2026-09`
- Tests: ⚠ Chưa có test ở tầng service (engine phủ bởi UC-201 AC-5, AC-7 với input dựng tay)

### AC-3: Cấu hình hỏng không trả số bừa
- Given không có luật `remainder` active
- When preview
- Then không có phương án nào được trả; HTTP 500 `internal`
- Tests: ⚠ Chưa có test cho route (engine: UC-201 AC-13)

### AC-4: Xem trước theo nguồn thu
- Given nguồn `salary-wife` khóa 45% Tích sản
- When `POST /v1/allocate/preview { amount: 11000000, at: "2026-09-10T09:00:00+07:00", income_stream_id: "salary-wife" }`
- Then `data.funds` chứa `{ walletId: "wealth-building", amount: 4950000 }`; chia thật cùng khoản (nguồn `salary-wife`) cho đúng Tích sản 4.950.000
- Tests: `test/api.test.ts` › "nguồn thu, ví giữ riêng, chuyển ngân sách › nguồn thu chọn tay quyết định phần khóa; gắn nguồn cho khoản không phải thu nhập bị từ chối"

### AC-5: Nguồn thu không có bị từ chối
- Given không có nguồn `khong-co`
- When preview với `income_stream_id: "khong-co"`
- Then 400 `unknown_income_stream`, không có phương án
- Tests: ⚠ Chưa có test

### AC-6: Tự chia đủ số thì ghi được
- Given khoản thu 19.000.000, sheet Chia thử
- When bật Tự chia (mỗi ví một ô, Tích sản đứng đầu, điền sẵn số của bảng chia theo luật), gõ Tích sản 200.000, Nhà ở 7.500.000, Tập luyện 1.500.000, Ăn uống 5.000.000, Điện nước 1.600.000, Trả nợ 2.700.000, Đi lại 500.000, các ví khác 0
- Then chân "Đã chia 19.000.000 / 19.000.000"; nút **Chia và ghi sổ** bật; gửi đúng các số > 0; xem trước lệnh chuyển gộp theo tài khoản đích của ví
- Tests: [`web/src/lib/manual-split.test.ts`](../../web/src/lib/manual-split.test.ts) › "tự chia một khoản thu (change 261012-tu-chia) › UC-202 AC-6: mỗi ví đang dùng một ô (trừ ví giữ tiền), Tích sản đứng đầu, điền sẵn số của bảng chia theo luật, ví không có trong bảng thì 0" · "… › UC-202 AC-6: gõ đủ 19.000.000 → chân \"Đã chia 19.000.000 / 19.000.000\", được ghi; gửi đúng các số > 0; lệnh chuyển gộp theo tài khoản đích của ví"; [`test/api.test.ts`](../../test/api.test.ts) › "tự chia một khoản thu (change 261012-tu-chia) › UC-203 AC-11: hợp đồng amounts — trùng ví, ví không có, ví đã tắt, số âm / lẻ / chuỗi → invalid_amounts; preview nhận amounts và bỏ qua nguồn thu"; vẽ sheet ở ba chỗ: ⚠ Chưa có test (giao diện)

### AC-7: Tổng lệch hay ô sai thì không ghi được; Tích sản 0 cần lý do (MODIFIED — ADR-112 thay câu nhắc của ADR-108)
- Given Tự chia
- When tổng ≠ khoản thu; một ô có phép tính sai (âm, không ra số); chọn **Không Tích sản** (ô Tích sản 0)
- Then nút tắt, chân nói "còn Z" / "chia vượt Z"; ô sai báo lỗi dưới ô, sửa lại thì hết; Không Tích sản → ô **Lý do** bắt buộc, có lý do thì ghi được (gửi `wealth_note`); không còn câu nhắc "Tháng này chưa để dành Tích sản"; Có Tích sản → ô Tích sản theo thanh
- Tests: [`web/src/lib/manual-split.test.ts`](../../web/src/lib/manual-split.test.ts) › "tự chia một khoản thu (change 261012-tu-chia) › UC-202 AC-7: tổng khác khoản thu → không ghi được, chân nói còn / vượt bao nhiêu" · "… › UC-202 AC-7: ô có phép tính sai (âm, không ra số) → không ghi được dù tổng khớp; sửa lại ô thì hết lỗi" · "… › UC-202 AC-7: Tích sản 0 → không còn câu nhắc; checkSplit chỉ xét tổng — lý do do lựa chọn Không Tích sản bắt"; [`web/src/lib/wealth-slider.test.ts`](../../web/src/lib/wealth-slider.test.ts) › "Có / Không Tích sản khi chia (change 261015-chot-thang-va-keo-tich-san) › UC-202 AC-7: Tự chia — ô Tích sản theo thanh; Không Tích sản → ô Tích sản 0, gửi wealth_note"

### AC-8: Có / Không Tích sản — thanh 1–100%, mặc định 10%
- Given khoản thu 24.000.000, luật Tích sản 30%
- When mở Chia thử; kéo 30%; gõ 3.600.000; gõ 100.000; chọn **Không Tích sản**; khoản thu dưới 100.000 / lẻ nghìn ở 100% / gõ quá khoản thu
- Then mặc định **Có Tích sản**, thanh 10%, ô 2.400.000 (không theo % luật nạp); 30% → 7.200.000; 3.600.000 → 15%; 100.000 → kẹp 1% (240.000); Không → thanh ẩn, ô Lý do hiện, nút ghi tắt tới khi có lý do, gửi `wealth_amount: 0` + `wealth_note`; dưới 100.000 làm tròn tới đồng (tối thiểu 1 đồng), 100% không vượt khoản thu, gõ quá → 100%
- Tests: [`web/src/lib/wealth-slider.test.ts`](../../web/src/lib/wealth-slider.test.ts) › "Có / Không Tích sản khi chia (change 261015-chot-thang-va-keo-tich-san) › UC-202 AC-8: khoản thu 24.000.000, luật Tích sản 30% → mặc định Có Tích sản, 10%, 2.400.000" · "… › UC-202 AC-8: kéo 30% → 7.200.000; gõ 3.600.000 → 15%; gõ 100.000 → kẹp 1% (240.000)" · "… › UC-202 AC-8: chọn Không Tích sản → cần lý do, nút ghi tắt tới khi có lý do; body là wealth_amount 0 + wealth_note" · "… › UC-202: khoản thu dưới 100.000 làm tròn tới đồng, tối thiểu 1 đồng; khoản thu lẻ nghìn ở 100% không vượt khoản thu; gõ quá khoản thu → 100%"; [`test/api.test.ts`](../../test/api.test.ts) › "Tích sản người chọn khi chia và lý do Tích sản 0 › UC-203: hợp đồng wealth_amount — âm / lẻ / chuỗi / vượt khoản thu / gửi cùng amounts / nguồn khóa 100% → 400 invalid_amounts ở cả preview lẫn allocate; preview trả wealth.adjustable false cho nguồn khóa 100%"; thanh, ô và hai nút trên màn: ⚠ Chưa có test (giao diện — xem tay 390px / 1280px cục bộ)

## Traceability
- Code: `src/routes/v1.ts` › `v1.post("/allocate/preview")`, `body`, `int`, `str`; `src/domain/entry.ts` › `normalizeAt`; `src/domain/allocation.ts` › `parseManualAmounts`, `manualFunds`, `wealthOverride`, `isFullLock`; `src/services/ledger.ts` › `previewAllocation` (`amounts`), `allocationContext`, `walletAccounts`, `AllocationPlan`, `loadRefs` (`incomeStreams`); `src/mcp/tools.ts` › tool `preview_allocation`; `src/index.ts` › `app.onError`
- PWA (Tự chia): `web/src/screens/other-entry-sheet.tsx` › `AllocationPreview` (`split`, `onSplit`); `web/src/lib/wealth-slider.ts` › `DEFAULT_WEALTH_PCT`, `WEALTH_TICKS`, `wealthAmountFor`, `wealthFromAmount`, `initialWealth`, `withIncome`, `wealthBlocked`, `wealthBody`, `wealthSplitNote`, `syncSplitWealth`; `web/src/screens/other-entry-sheet.tsx` › `useAllocationPreview` (Có / Không Tích sản); `web/src/lib/manual-split.ts` › `splitWallets`, `prefillSplit`, `setSplitAmount`, `checkSplit`, `splitPayload`, `splitOrders`; nơi gọi `web/src/screens/assign.tsx` (dòng thu nhập đầu tiên), `web/src/screens/tx-sheet.tsx`, `other-entry-sheet.tsx` › `IncomeForm`
- Migrations/DB: views `v_wallet_balance`, `v_wallet_flow` (`migrations/0001_schema.sql`); `income_streams`, `income_stream_locks` (`migrations/0007_income_streams_rental.sql`)

## Divergences & Open Questions
- [OPEN] Lỗi cấu hình chia (`AllocationConfigError`) ra 500 "Lỗi hệ thống" thay vì một mã 4xx có thông điệp tiếng Việt của engine (`src/index.ts:27-35`); người dùng không biết phải sửa gì. Chưa rõ đây là quyết định hay sót.
- [OPEN] Route không chặn `amount ≤ 0` (chỉ kiểm số nguyên) nên 0/âm rơi vào E5 (500), trong khi MCP chặn bằng zod `.positive()`.
- [OPEN] Nguồn thu đã tắt vẫn xem trước được (`loadRefs` nạp cả nguồn `active=0`), trong khi ghi khoản thu với nguồn đó bị từ chối `inactive_income_stream` (ledger UC-101) — preview có thể cho phương án mà không ghi được.
- [OPEN] MCP `preview_allocation` / `allocate_income` không nhận `amounts` (Tự chia chỉ có ở REST / PWA — ngoài phạm vi change 261012-tu-chia).
- [OPEN] MCP `preview_allocation` không nhận nguồn thu, nên Claude xem trước tiền người thuê / lương vợ sẽ ra phương án theo luật % chung, khác với lần chia thật (UC-203 dùng nguồn trên khoản thu).
