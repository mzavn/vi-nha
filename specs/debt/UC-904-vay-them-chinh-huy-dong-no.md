# UC-904: Vay thêm, chỉnh tay, huỷ dòng nợ
- Status: implemented
- BR: BR-12, BR-04
- Decisions: ADR-71 (sổ nợ chỉ ghi thêm, ngoài sổ cái), ADR-02 luật 1 (sai thì huỷ rồi ghi lại, không sửa đè), ADR-72 (cùng khuôn sổ đối ứng với sổ phải thu — luật chung S2 ở [receivable/README.md](../receivable/README.md))
- Actor: người trong hộ (PWA tab **Nợ** — [UC-707](../pwa/UC-707-xem-vi-va-quy.md))
- Trigger: `POST /v1/debts/:id/lines { kind: "borrow" | "adjust", amount, note?, at? }`; huỷ: `POST /v1/debt-lines/:id/void`

## History
- v1 (2026-10-01, commit `25db5b9`): dòng nợ `borrow` (> 0) và `adjust` (± ≠ 0), huỷ dòng `active → void`; trigger chỉ ghi thêm `debt_line_append_only` (ADR-71, schema v1.13).
- v2 (2026-10-01, commit `2438ac0`): không đổi hành vi — ghi dòng / huỷ dòng chạy trên service sổ đối ứng dùng chung `src/services/memo-books.ts` (`addLine`, `voidLine`; cùng sổ phải thu, ADR-72), route chuyển sang `src/routes/books.ts`; luật chung S2 viết một lần ở [receivable/README.md](../receivable/README.md).

## Preconditions
- Khoản nợ tồn tại; ghi dòng mới cần khoản đang bật. Cần mạng (sổ nợ không đi qua hàng đợi offline).

## Main Flow — vay thêm / chỉnh tay
1. Ở một khoản nợ, người chọn **Vay thêm** hoặc **Chỉnh**; nhập số tiền dương; với Chỉnh chọn chiều (tăng nợ / giảm nợ); ghi chú tuỳ chọn. PWA (`debtLinePayload`): số tiền ≤ 0 → "Nhập số tiền."; vay thêm gửi số dương; chỉnh gửi số mang dấu theo chiều.
2. Server `addDebtLine`: khoản phải có (`not_found`); `kind ∈ {borrow, adjust}` (`invalid_kind` — `opening` chỉ ghi khi thêm khoản nợ); `borrow` nguyên > 0, `adjust` nguyên ≠ 0 (`invalid_amount`); `at` chuẩn hoá (`normalizeAt`); khoản phải đang bật (`inactive_debt`).
3. Ghi một dòng `debt_lines` → 201 `DebtLine`. Còn nợ đổi đúng `amount` (dương tăng, âm giảm). Không ví, không tài khoản nào của hộ bị đụng.

## Main Flow — huỷ dòng
4. `POST /v1/debt-lines/:id/void` → `status = 'void'`, còn nợ đổi ngược lại. Áp cho mọi `kind`, kể cả `opening`.

## Alternative Flows
- 1a. Vay thêm mà tiền vay **về tài khoản của hộ**: dòng `borrow` chỉ ghi số nợ; tiền vào tài khoản là việc riêng của sổ cái (gán log/nhập tay) — sổ nợ không ghi giao dịch nào.
- 4a. Sửa một dòng sai = huỷ dòng đó rồi ghi dòng mới (không có sửa).

## Exceptions
- E1. `kind` khác `borrow`/`adjust` → 400 `invalid_kind`.
- E2. `amount` không nguyên / quá 1e12 / `borrow` ≤ 0 / `adjust` = 0 → 400 `invalid_amount`.
- E3. Khoản nợ đã tắt → 400 `inactive_debt`.
- E4. Khoản nợ / dòng không có → 404 `not_found`; huỷ dòng đã huỷ → 409 `already_void`.
- E5. Ở tầng DB: UPDATE cột khác `status`, đổi `void → active`, hoặc DELETE → ABORT `debt_line_append_only`; `borrow`/`opening` ≤ 0 → lỗi CHECK.

## Acceptance Criteria

### AC-1: Vay thêm làm tăng số còn nợ
- Given Cô Mai còn 10.000.000
- When thêm dòng `borrow` 2.000.000 "Mượn thêm"; rồi `borrow` −1; `kind: "opening"`; khoản `khong-co`
- Then 201 `{ debtId: "co-mai", kind: "borrow", amount: 2000000, note: "Mượn thêm", status: "active" }`, `owed` = còn nợ = 12.000.000; rồi 400 `invalid_amount`, 400 `invalid_kind`, 404
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › vay thêm làm tăng số còn nợ"

### AC-2: Chỉnh tay cộng hoặc trừ số còn nợ
- Given Cô Mai còn 10.000.000
- When thêm `adjust` −379.000 "Cô bớt lẻ" rồi `adjust` +50.000; rồi `adjust` 0
- Then còn nợ lần lượt 9.621.000 và 9.671.000; `adjust` 0 → 400 `invalid_amount`
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › chỉnh tay cộng hoặc trừ số còn nợ"

### AC-3: Huỷ dòng nợ đổi lại số còn nợ; huỷ lần hai báo lỗi
- Given Cô Mai còn 10.000.000, thêm dòng `borrow` 2.000.000
- When huỷ dòng đó; huỷ lần hai; huỷ dòng `999`
- Then 200 với `status: "void"`, còn nợ về 10.000.000, `lines` chỉ còn `opening`; lần hai 409 `already_void`; dòng không có 404
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › huỷ dòng nợ thì số còn nợ đổi lại, huỷ lần hai báo already_void"

### AC-4: Sổ nợ chỉ ghi thêm ở tầng DB
- Given một dòng `debt_lines`
- When UPDATE `amount` hoặc `note`, DELETE, đổi `void → active`; `borrow` âm
- Then DB ABORT `debt_line_append_only` (CHECK cho `borrow` âm); chỉ `active → void` được; `v_debt_balance` = Σ dòng `active` − Σ `spend` `active` mang `debt_id`
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › dòng nợ chỉ ghi thêm: chỉ đổi active sang void, không xoá"; [`test/schema.test.ts`](../../test/schema.test.ts) › "chốt chặn toàn vẹn ở tầng DB › debt_lines chỉ ghi thêm và v_debt_balance trừ khoản trả nợ"

### AC-5: Form dòng nợ ở PWA gửi đúng dấu
- Given form Vay thêm 3.000.000; Chỉnh giảm 79.000 "bớt lãi"; số tiền 0
- When dựng thân request
- Then `{ kind: "borrow", amount: 3000000 }`; `{ kind: "adjust", amount: -79000, note: "bớt lãi" }`; số tiền 0 bị chặn
- Tests: [`web/src/lib/debts.test.ts`](../../web/src/lib/debts.test.ts) › "sổ nợ › kiểm tra khoản nợ mới và dòng nợ: thiếu tên, số tiền"

### AC-6: Khoản nợ đã tắt không nhận dòng mới
- Given Cô Mai đã tắt (`active = false`)
- When thêm `borrow` 1
- Then 400 `inactive_debt`
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › debt_id không có hoặc đã tắt: unknown_debt, inactive_debt"

## Traceability
- Code: `src/routes/books.ts` › `mount("debts", "debt-lines", …)` (`POST /debts/:id/lines`, `POST /debt-lines/:id/void`); `src/services/debts.ts` › `addDebtLine`, `voidDebtLine`; `src/services/memo-books.ts` › `addLine`, `voidLine`
- PWA: `web/src/lib/debts.ts` › `debtLinePayload`; tab Nợ ([UC-707](../pwa/UC-707-xem-vi-va-quy.md))
- Migrations/DB: `debt_lines` (CHECK `amount <> 0`, CHECK `kind = 'adjust' OR amount > 0`), trigger `trg_debt_lines_append_only`, `trg_debt_lines_no_delete` (`migrations/0013_debts.sql`)

## Divergences & Open Questions
- [OPEN] "Huỷ dòng" áp cả dòng `opening`: huỷ nhầm làm còn nợ âm bằng tổng đã trả và khoản rơi vào "Đã trả xong" — cách sửa là ghi dòng `adjust` (không có "mở lại" dòng đã huỷ).
