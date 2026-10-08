# UC-1004: Chỉnh / huỷ dòng phải thu
- Status: implemented
- BR: BR-13, BR-04
- Decisions: ADR-72 (sổ phải thu chỉ ghi thêm, ngoài sổ cái), ADR-71 (cùng service sổ đối ứng với sổ nợ), ADR-02 luật 1 (sai thì huỷ rồi ghi lại, không sửa đè)
- Actor: người trong hộ (PWA tab **Nợ** — sheet chi tiết khoản phải thu, [UC-707](../pwa/UC-707-xem-vi-va-quy.md))
- Trigger: `POST /v1/receivables/:id/lines { kind: "adjust", amount, note?, at? }`; huỷ: `POST /v1/receivable-lines/:id/void`

## History
- v1 (2026-10-01, commit `2438ac0`): dòng `adjust` (± ≠ 0), huỷ dòng `active → void`; trigger chỉ ghi thêm `receivable_line_append_only` (ADR-72, schema v1.14).
- v2 (2026-10-05, commit `6f5e77a`): không đổi hành vi — test của AC-5 đổi tên (cùng test kiểm khoản phải thu mới, nay nhận số 0 — UC-1001 v3).

## Preconditions
- Khoản phải thu tồn tại; ghi dòng mới cần khoản đang bật. Cần mạng (luật chung S7, [README](README.md)).

## Main Flow — chỉnh tay
1. Ở một khoản phải thu, người chọn **Chỉnh**; nhập số tiền dương và chiều (người ta nợ thêm / bớt — vd xoá nợ một phần, sai số lúc mở sổ); ghi chú tuỳ chọn. PWA gửi số mang dấu theo chiều; số tiền ≤ 0 bị chặn.
2. Server: luật chung S2 ([README](README.md)) với loại cho phép duy nhất `adjust` (`invalid_kind` cho mọi loại khác, kể cả `opening` và `lend`); `amount` nguyên ≠ 0 (`invalid_amount`); khoản phải đang bật (`inactive_receivable`).
3. Ghi một dòng `receivable_lines` → 201 `ReceivableLine`. Còn phải thu đổi đúng `amount`. Không ví, không tài khoản nào bị đụng (luật chung S6).

## Main Flow — huỷ dòng
4. `POST /v1/receivable-lines/:id/void` → `status = 'void'`, còn phải thu đổi ngược lại. Áp cho mọi `kind`, kể cả `opening` (luật chung S2).

## Alternative Flows
- 1a. Cho vay thêm **không** phải dòng chỉnh: tiền thật ra khỏi tài khoản thì ghi `lend` ([UC-1002](UC-1002-cho-vay-tra-ho.md)); người ta trả lại thì ghi `collect` ([UC-1003](UC-1003-nhan-lai-tien.md)). Dòng chỉnh chỉ dùng khi số ghi nhớ sai mà không có tiền thật đi/về.
- 4a. Sửa một dòng sai = huỷ dòng đó rồi ghi dòng mới.

## Exceptions
- E1. `kind` khác `adjust` → 400 `invalid_kind`.
- E2. `amount` không nguyên / quá 1e12 / = 0 → 400 `invalid_amount`.
- E3. Khoản đã tắt → 400 `inactive_receivable`.
- E4. Khoản / dòng không có → 404 `not_found`; huỷ dòng đã huỷ → 409 `already_void`.
- E5. Ở tầng DB: UPDATE cột khác `status`, đổi `void → active`, hoặc DELETE → ABORT `receivable_line_append_only`; `opening` ≤ 0 → lỗi CHECK.

## Acceptance Criteria

### AC-1: Chỉnh tay cộng hoặc trừ còn phải thu; chỉ nhận `adjust`
- Given Em Hai còn 2.000.000
- When thêm `adjust` −200.000 "Bớt cho em", rồi `adjust` +50.000; rồi `adjust` 0; rồi `kind` `opening`, `lend`, `borrow`; rồi khoản `khong-co`
- Then 201 `{ receivableId: "em-hai", kind: "adjust", amount: -200000, note: "Bớt cho em", status: "active" }`, còn phải thu 1.800.000 rồi 1.850.000; `adjust` 0 → 400 `invalid_amount`; ba loại kia → 400 `invalid_kind`; khoản không có → 404
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › chỉnh tay cộng hoặc trừ số phải thu; chỉ ghi tay được dòng adjust"

### AC-2: Huỷ dòng đổi lại còn phải thu; huỷ lần hai báo lỗi
- Given Em Hai còn 2.000.000, thêm dòng `adjust` +300.000
- When huỷ dòng đó; huỷ lần hai; huỷ dòng `999`
- Then 200 `status: "void"`, còn phải thu về 2.000.000, `lines` chỉ còn `opening`; lần hai 409 `already_void`; dòng không có 404
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › huỷ dòng phải thu thì số phải thu đổi lại, huỷ lần hai báo already_void"

### AC-3: Sổ phải thu chỉ ghi thêm ở tầng DB
- Given một dòng `receivable_lines`
- When UPDATE `amount` hoặc `note`, DELETE, đổi `void → active`; chèn `opening` âm hay `kind` lạ
- Then DB ABORT `receivable_line_append_only` (CHECK cho `opening` âm và `kind` lạ); chỉ `active → void` được; `v_receivable_balance` = Σ dòng `active` + Σ `lend` − Σ `collect` `active`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › dòng phải thu chỉ ghi thêm: chỉ đổi active sang void, không xoá"; [`test/schema.test.ts`](../../test/schema.test.ts) › "chốt chặn toàn vẹn ở tầng DB › receivable_lines chỉ ghi thêm; v_receivable_balance cộng tiền cho vay, trừ tiền nhận lại; ví không đổi"

### AC-4: Khoản đã tắt không nhận dòng mới
- Given Em Hai đã tắt
- When thêm `adjust` 1
- Then 400 `inactive_receivable`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › receivable_id không có hoặc đã tắt: unknown_receivable, inactive_receivable"

### AC-5: Form chỉnh ở PWA gửi đúng dấu
- Given sheet "Chỉnh số phải thu · {tên}" chọn Giảm số phải thu 200.000 "bớt cho"; Tăng 200.000 không ghi chú; số tiền 0
- When dựng thân request
- Then `{ kind: "adjust", amount: -200000, note: "bớt cho" }`; `{ kind: "adjust", amount: 200000 }`; số tiền 0 bị chặn
- Tests: [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › kiểm tra khoản phải thu mới và dòng chỉnh: thiếu tên, số tiền âm hay lẻ; số 0 được (thêm người chưa nợ gì); chỉnh mang dấu"

## Traceability
- Code: `src/routes/books.ts` › `mount("receivables", "receivable-lines", …)` (`POST /receivables/:id/lines`, `POST /receivable-lines/:id/void`); `src/services/receivables.ts` › `addReceivableLine`, `voidReceivableLine`; `src/services/memo-books.ts` › `addLine`, `voidLine`
- PWA: `web/src/lib/receivables.ts` › `receivableLinePayload`; `web/src/lib/memo-books.ts` › `bookLinePayload`, `mergeHistory`; `web/src/screens/memo-book.tsx` › `BookDetailSheet`, `BookLineSheet`; tab Nợ ([UC-707](../pwa/UC-707-xem-vi-va-quy.md))
- Migrations/DB: `receivable_lines` (CHECK `amount <> 0`, CHECK `kind = 'adjust' OR amount > 0`), trigger `trg_receivable_lines_append_only`, `trg_receivable_lines_no_delete` (`migrations/0014_receivables.sql`)

## Divergences & Open Questions
- [OPEN] Như sổ nợ (debt UC-904): "Huỷ dòng" áp cả dòng `opening`; huỷ nhầm làm còn phải thu âm bằng tổng đã nhận — cách sửa là ghi dòng `adjust`.
