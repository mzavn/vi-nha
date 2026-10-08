# UC-708: Đếm ví / nhập số dư thật
- Status: implemented
- BR: BR-04
- Decisions: D14 (tài khoản có feed chỉ đếm được khi không còn log chưa gán — server thực thi); DESIGN.md §8 ("Không cho phép sửa đè giao dịch cũ"); `docs/wireframe.md` §2 "Đếm ví (chủ nhật)"
- Actor: thành viên đã đăng nhập
- Trigger: card "Đếm ví / nhập số dư thật" (gợi ý "chủ nhật") → **Đếm và ghi chênh lệch** ở màn Nhập; nút **Nhập số dư thật** ở Ví & quỹ › Tài khoản (tài khoản không có feed)

## History
- v1 (2026-09-22, commit `a756f68`): sheet đếm: sổ đang ghi → số thật → chênh lệch có dấu → ghi; toast nói số sổ mới.
- v2 (2026-10-03, commit `a8703fd`): ô **Số tiền thật** gõ được phép tính (`500.000+200.000`, pwa [UC-703](UC-703-nhap-nhanh-khoan-chi.md) AC-10); phép tính sai thì coi như chưa gõ số thật: Chênh lệch "—", nút tắt — không ghi một lần đếm 0 ₫ ngoài ý.

## Preconditions
- Có mạng (cần số sổ hiện tại và ghi lên server).
- Backend: ledger UC-106 Đối soát tài khoản (`GET /v1/accounts`, số sổ), ledger UC-105 Đếm số dư tài khoản → bút toán điều chỉnh (`POST /v1/accounts/:id/count`).

## Main Flow
1. Mở sheet "Đếm ví / nhập số dư thật". **Tài khoản** mặc định: tài khoản được truyền vào (từ tab Tài khoản) hoặc tiền mặt của người đang nhập. Danh sách chọn gồm **mọi** tài khoản trong bootstrap.
2. **Sổ đang ghi**: `bookBalance` của tài khoản đó từ `GET /v1/accounts` ("đang tải…" / "—").
3. **Số tiền thật**: ô số (tự focus, nhóm chấm khi gõ; gõ được phép tính như UC-703, dòng "= X ₫" dưới ô).
4. **Chênh lệch** = thật − sổ, có dấu `+`/`−` ("—" khi chưa đủ số).
5. Ghi chú: "Thật nhiều hơn sổ thì phần dư cộng vào ví nhận phần còn lại; ít hơn thì trừ ví đó. Sai thì ghi lại lần đếm mới, không sửa đè."
6. Nút chính: **Ghi chênh lệch**, hoặc **Ghi lần đếm — khớp sổ** khi chênh = 0; bật khi có mạng, đã gõ số thật và đã có số sổ → `POST /v1/accounts/:id/count { counted }`.
7. Toast: khớp → "Đã ghi lần đếm. {tài khoản} khớp sổ."; lệch → "Đã ghi chênh lệch {±X} ₫. Sổ {tài khoản} giờ là {Y}."; tải lại số; đóng sheet.

## Alternative Flows
- 2a. Offline: không tải `/v1/accounts`; ô Sổ ghi "cần mạng"; nút tắt kèm "Đếm ví cần mạng. Khoản chi nhập tay vẫn ghi được khi không có mạng."

## Exceptions
- E1. Server từ chối (ví dụ tài khoản có feed còn log chưa gán — D14) → câu lỗi server hiện trong sheet (`role="alert"`), nút bấm lại được.

## Acceptance Criteria
### AC-1: Hiện chênh lệch trước khi ghi
- Given sổ Tiền mặt (vợ) −715.000 ₫
- When gõ số thật 1.000.000 ₫
- Then Chênh lệch hiện "+1.715.000 ₫" và nút "Ghi chênh lệch"
- Tests: `web/src/lib/money.test.ts` › "định dạng tiền › chênh lệch có dấu +"; sheet: ⚠ Chưa có test

### AC-2: Khớp sổ vẫn ghi một lần đếm
- Given số thật = sổ
- When bấm "Ghi lần đếm — khớp sổ"
- Then server nhận lần đếm, toast "Đã ghi lần đếm. {tài khoản} khớp sổ."
- Tests: ⚠ Chưa có test

### AC-3: Đếm ví cần mạng
- Given offline
- When mở sheet
- Then "Sổ đang ghi" = "cần mạng", nút tắt, kèm câu "Đếm ví cần mạng…"
- Tests: ⚠ Chưa có test

### AC-4: Phép tính sai không thành lần đếm 0 ₫
- Given sheet Đếm ví, đã có số sổ
- When gõ "500.000-800.000" vào Số tiền thật
- Then dòng đỏ "Sai: kết quả phải trên 0, tối đa 1.000 tỷ", Chênh lệch "—", nút ghi tắt; sửa thành "800.000-500.000" thì "= 300.000 ₫" và nút bật
- Tests: `web/src/lib/money.test.ts` › "phép tính trong ô số tiền › không ra số tiền hợp lệ thì null: kết quả ≤ 0, vượt trần, hai dấu liền nhau, ký tự lạ"; sheet: ⚠ Chưa có test

## Traceability
- Code: `web/src/screens/count-sheet.tsx` › `CountSheet`; `web/src/screens/entry.tsx` › `EntryForm` (card Đếm ví); `web/src/screens/wallets.tsx` › `AccountsTab`, `AccountsWide`; `web/src/lib/categories.ts` › `defaultAccountFor`; `web/src/lib/money.ts` › `formatSigned`, `evalAmount`; `web/src/ui/fields.tsx` › `AmountInput`.
- Backend: ledger UC-105 Đếm số dư tài khoản → bút toán điều chỉnh, UC-106 Đối soát tài khoản.

## Divergences & Open Questions
- [OPEN] Sheet cho chọn cả tài khoản có feed (dùng `boot.accounts`, không lọc `manualAccounts`), trong khi tab Tài khoản chỉ đưa nút "Nhập số dư thật" cho tài khoản không feed. Việc chặn đếm tài khoản có feed còn log chưa gán nằm hoàn toàn ở server (D14).
- [OPEN] Ghi chú trong sheet khẳng định phần dư/thiếu vào "ví nhận phần còn lại" — luật này thuộc ledger; PWA chỉ hiển thị câu, không kiểm.
