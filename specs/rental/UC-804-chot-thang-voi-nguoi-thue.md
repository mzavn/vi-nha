# UC-804: Chốt tháng với người thuê
- Status: implemented
- BR: BR-11, BR-06
- Decisions: ADR-61 (chốt tay một lần mỗi tháng, chênh lệch mang sang bằng số dư; không tính theo ngày ở), ADR-58; change `261001-cho-thue-lai`
- Actor: người trong hộ (PWA màn Người thuê › "Chốt <tháng>" — [UC-713](../pwa/UC-713-man-nguoi-thue.md)); hệ thống (cron sáng ngày 1 nhắc — [notify UC-402](../notify/UC-402-tin-sang-0700.md))
- Trigger: `POST /v1/rental/tenants/:id/settle { month, headcount?, lines: [{ kind, name, amount }] }`

## History
- v1 (2026-10-01, commit `034b7ff`): chốt một lần mỗi (người thuê, tháng) bằng `tenant_settlements` (PRIMARY KEY), người sửa bản nháp (dòng, số người) trước khi lưu; tin sáng ngày 1 nhắc từng người thuê chưa chốt tháng trước; chép bảng kê (change `261001-cho-thue-lai`).

## Preconditions
- Người thuê tồn tại; tháng ≤ tháng hiện tại; tháng đó chưa chốt với người này.
- PWA: có mạng.

## Main Flow
1. Ngày 1, tin sáng 07:00 có một dòng `🏠 Chốt tháng với <tên> (số dư <tiền>)` cho mỗi người thuê **đang ở** chưa chốt tháng trước (`unsettledTenants(previousMonth)`). Chỉ nhắc — không tự chốt.
2. Người mở màn Người thuê, chọn tháng, bấm "Chốt <tháng>". Sheet điền sẵn bản nháp của UC-803 (mỗi phí một dòng `fixed`, một dòng `shared`) và số người hiện tại.
3. Người sửa trước khi lưu: đổi tên/số tiền từng dòng, đổi số người (dòng `shared` tự tính lại `floor(tổng / số người)` — `withHeadcount`), thêm dòng `adjust` (ví dụ người thuê ra ngày 15 → giảm tiền nhà), bỏ dòng.
4. PWA kiểm (`settlePayload`): số người nguyên 1–50; mỗi dòng có tên và số ≠ 0; `fixed`/`shared` không âm (giảm thì thêm dòng chỉnh).
5. Server: kiểm `month` (bắt buộc, `YYYY-MM`, không tương lai), `headcount` (không gửi → cấu hình; nguyên 1–50), `lines` là mảng, mỗi dòng `kind ∈ {fixed, shared, adjust}`, `amount` nguyên, `fixed`/`shared` > 0, `adjust` ≠ 0.
6. Đã có `tenant_settlements(tenant_id, month)` → 409 `already_settled`.
7. Tính lại **tổng chi chung** tháng ở server, rồi ghi trong **một batch**: một dòng `tenant_settlements { headcount, shared_total, at }` + mỗi dòng gửi lên một `tenant_lines` (cùng `month_key`, `at` = lúc chốt).
8. Trả 201 tạm tính tháng đã chốt (UC-803): `settled = true`, nháp rỗng, số dư đã cộng các dòng chốt.
9. Người bấm "Chép bảng kê" để gửi người thuê.

## Alternative Flows
- 3a. Lưu với danh sách dòng rỗng được (chốt mà không ghi gì — ví dụ tháng không có phí).
- 6a. Hai lần chốt chạy song song: PRIMARY KEY làm batch thứ hai huỷ cả; server nhận ra và trả 409 `already_settled`.
- 8a. **Sửa tháng đã chốt**: không mở lại được; huỷ dòng sai (UC-802 bước 7) rồi ghi dòng `adjust`. Thông điệp 409 nói đúng cách này.
- 1a. Ngày khác ngày 1 không nhắc; người thuê đã ra hoặc đã chốt không được nhắc.

## Exceptions
- E1. Thiếu `month` → 400 `invalid_input`; sai dạng → 400 `invalid_month`; tháng sau tháng hiện tại → 400 `future_month`.
- E2. `headcount` ngoài 1–50 → 400 `invalid_input`; `lines` không phải mảng / phần tử không phải object → 400 `invalid_input`; `kind` sai → 400 `invalid_kind`; số tiền sai → 400 `invalid_amount`.
- E3. Tháng đã chốt → 409 `already_settled` ("… Muốn sửa thì huỷ dòng rồi ghi điều chỉnh.").
- E4. Người thuê không có → 404 `not_found`.

## Acceptance Criteria

### AC-1: Chốt ghi các dòng một lần, số dư cộng đủ
- Given tạm tính tháng 10 của An = 5.111.667, số dư trước chốt −300.000
- When chốt với đúng các dòng nháp
- Then 201, `settled = true`, số dư = 5.111.667; An chuyển 5.191.667 → số dư −80.000 mang sang tháng sau
- Tests: `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau"

### AC-2: Chốt lần hai cùng tháng bị từ chối, không ghi thêm
- Given tháng 10 đã chốt với dòng Nhà 2.500.000 (số dư 2.200.000)
- When chốt lại tháng 10
- Then 409 `already_settled`; số dư vẫn 2.200.000
- Tests: `test/rental.test.ts` › "/v1/rental › chốt lần hai cùng tháng → 409 already_settled, không ghi thêm dòng"

### AC-3: Không chốt được tháng chưa tới
- Given hôm nay tháng 10
- When chốt tháng 11
- Then 400 `future_month`
- Tests: `test/rental.test.ts` › "/v1/rental › không chốt được tháng chưa tới"

### AC-4: Sửa bản nháp trước khi lưu — đổi số người
- Given tổng chi chung 8.160.000, nháp 3 người
- When đổi sang 4 người
- Then dòng chi chung = 2.040.000, phần lẻ hộ chịu; phí cố định giữ nguyên; tổng phải trả tính lại
- Tests: `web/src/lib/rental.test.ts` › "chốt tháng › đổi số người: chi chung tính lại, phần lẻ hộ chịu; phí cố định giữ nguyên"; `web/src/lib/rental.test.ts` › "chốt tháng › bản nháp cộng đúng phần phải trả"

### AC-5: Thân yêu cầu chốt: dòng chỉnh được âm, phí không được âm
- Given form chốt
- When một dòng `fixed` âm, hoặc số người 0, hoặc một dòng `adjust` −500.000
- Then hai trường hợp đầu bị chặn ở máy; dòng chỉnh âm được gửi đi
- Tests: `web/src/lib/rental.test.ts` › "chốt tháng › thân yêu cầu: dòng chỉnh được âm, phí không được âm, số người ≥ 1"; kiểm tương ứng ở server (E2): ⚠ Chưa có test

### AC-6: Tin sáng ngày 1 nhắc chốt với từng người thuê chưa chốt tháng trước
- Given ngày 1/11, An đang ở chưa chốt tháng 10; người B đã chốt; người C đã ra
- When cron sáng
- Then đúng một dòng `🏠 Chốt tháng với An (số dư …)`; ngày thường không có dòng nào
- Tests: `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › nhắc chốt tháng với người thuê đang ở chưa chốt tháng trước; đã chốt hoặc đã ngừng thì không nhắc"; `test/cron-daily.test.ts` › "ngày 1: chốt tháng trước › ngày thường không nhắc chốt tháng người thuê"; `test/format.test.ts` › "dailyMessage › ngày 1: mỗi người thuê chưa chốt tháng trước một dòng nhắc kèm số dư"

### AC-7: Sau khi chốt, tạm tính dùng số người và tổng chi chung đã lưu
- Given tháng 10 đã chốt với 3 người, tổng 8.160.000
- When sau đó đổi cấu hình sang 4 người, hoặc hộ chi thêm vào danh mục chung với ngày trong tháng 10
- Then tạm tính tháng 10 vẫn `headcount = 3`, `sharedTotal = 8.160.000`, không có bản nháp
- Tests: ⚠ Chưa có test

### AC-8: Sửa tháng đã chốt bằng huỷ dòng + chỉnh
- Given tháng đã chốt có dòng sai
- When huỷ dòng đó và ghi `adjust`
- Then số dư đúng; `tenant_settlements` không đổi
- Tests: `test/rental.test.ts` › "/v1/rental › huỷ dòng sổ đổi số dư; huỷ giao dịch tiền trả thì số dư trở lại" (phần huỷ dòng); trọn luồng trên dòng chốt: ⚠ Chưa có test

## Traceability
- Code: `src/routes/rental.ts` (`POST /tenants/:id/settle`); `src/services/rental.ts` › `settleMonth`, `sharedTotal`, `tenantMonth`, `unsettledTenants`; `src/cron/daily.ts` › `daily` (`rentalSettleReminder`); `src/notify/format.ts` › `dailyMessage`
- PWA: `web/src/screens/tenants.tsx` › `SettleSheet`, nút "Chốt <tháng>", "Chép bảng kê"; `web/src/lib/rental.ts` › `draftLines`, `withHeadcount`, `settleTotal`, `settlePayload`; `web/src/ui/clipboard.ts` › `copyText`
- Migrations/DB: `tenant_settlements` (PRIMARY KEY `(tenant_id, month_key)`), `tenant_lines` (`migrations/0007_income_streams_rental.sql`)

## Divergences & Open Questions
- Ghi chú khác proposal (không phải lệch hành vi): proposal viết "idempotent theo `R<yyyymm>-<tenant_id>`"; code giữ "một lần" bằng PRIMARY KEY `tenant_settlements(tenant_id, month_key)` và trả 409, không có mã `R…`.
- [OPEN] Chốt được cả **tháng hiện tại** khi chưa hết tháng (`parseMonth` chỉ chặn tháng sau). Chi chung phát sinh sau lúc chốt không vào `shared_total` đã lưu và không vào dòng `shared` đã ghi — phải ghi `adjust` tay.
- [OPEN] Server không đối chiếu dòng `shared` gửi lên với `floor(shared_total / headcount)`; số người và số tiền dòng là do người nhập, `shared_total` lưu là số server tính.
- [OPEN] Không có đường "mở lại" một tháng đã chốt; huỷ hết dòng chốt vẫn để lại `tenant_settlements` nên tháng đó không bao giờ có lại bản nháp.
- [OPEN] Nhắc ngày 1 chỉ cho **tháng liền trước**; tháng cũ hơn chưa chốt không được nhắc. Nếu cron ngày 1 không chạy, không có nhắc bù.
