# UC-102: Huỷ / sửa giao dịch ghi tay
- Status: implemented
- BR: BR-04, BR-02, BR-03
- Decisions: `docs/core_design_rules.md` §1.1 (sổ chỉ ghi thêm), §9 "Huỷ khoản thu đã chia"; [ADR-02](../decisions.md) luật 1; [ADR-73](../decisions.md) (sửa = huỷ + ghi mới trong một batch; giao dịch ngân hàng chỉ gỡ gán); commit `099e54f` (gỡ lần chia khi huỷ khoản thu), `eb7846e` (trigger 0006, `runUndo`)
- Actor: thành viên trong hộ (PWA — pwa [UC-715](../pwa/UC-715-xem-sua-xoa-giao-dich.md)) / script (bearer)
- Trigger: `POST /v1/transactions/:id/void` (huỷ — PWA gọi là "Xoá"); `POST /v1/transactions/:id/replace` (sửa)

## History
- v1 (2026-09-22, commit `b92fc0f`): huỷ = đổi `status` sang `void`, không xoá; chặn bút toán hệ thống.
- v2 (2026-09-22, commit `099e54f`): huỷ một `income` đã chia thì gỡ luôn lần chia (huỷ các `fund`, bỏ lệnh chuyển chưa làm); từ chối nếu tiền của lần chia đã chuyển thật. Lý do: "lương" giả do người ngoài chuyển tiền với nội dung khớp mẫu đã được chia mà không có đường lùi.
- v3 (2026-09-22, commit `eb7846e`): kiểm "đã chuyển thật" ở app là đọc-rồi-ghi → thêm trigger `trg_fund_void_needs_unsettled_batch` (`migrations/0006_allocation_undo_guard.sql`) và `runUndo` đổi lỗi DB thành `allocation_settled`.
- v4 (2026-10-01, commit `49f8bce`): đổi tên "Huỷ / sửa giao dịch ghi tay" (ADR-73). Luật theo nguồn: giao dịch ngân hàng (`source='sepay'` hoặc có `log_id`) bị từ chối `bank_tx` — đường duy nhất là gỡ gán (ingest [UC-306](../ingest/UC-306-ghep-cap-tay-va-go-gan.md)); thêm **sửa** `POST /v1/transactions/:id/replace` = kiểm khoản mới trước, rồi huỷ khoản cũ + ghi khoản mới trong một batch. PWA gọi cả hai từ sheet chi tiết giao dịch (pwa UC-715). Lý do: chủ nhà — "nhập nhầm phải cho sửa / xoá; đồng bộ SePay thì không cho xoá, ghi tay thì có".
- v5 (2026-10-05, commit `d7992d1`): change [`261005-lien-ket-khoan-goc`](../changes/archive/261005-lien-ket-khoan-goc/proposal.md) — sửa một **khoản gốc** (khoản chi / cho vay) đang có khoản hoàn tiền / nhận lại còn hiệu lực trỏ về (`link_id`): trong cùng batch các khoản đó trỏ sang khoản mới (bước 6); khoản mới đổi meaning, hay khoản cho vay đổi sang người khác người của khoản nhận lại → `invalid_link` "Khoản này đang có khoản trả lại trỏ về — gỡ liên kết trước." (bước 4). Huỷ khoản gốc giữ nguyên liên kết (chi tiết khoản trả về hiện "… · khoản gốc đã xoá" — pwa UC-715). Kiểm `link_id` của khoản mới dùng `resolveLink` (refund → spend, collect → lend). Đóng nửa "sửa" của [OPEN] cũ về `refund` trỏ dòng đã huỷ.
- v6 (2026-10-06, commit `d059eaa`): change [`261006-bao-mat-kenh-bao-tin`](../changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md) (ADR-90, red-team INSIDER-04) — huỷ thành công ghi nhật ký `tx.void`, sửa thành công (không trùng `client_id`) ghi `tx.replace` (`target = tx:<id khoản cũ>`, người gọi + `via`); lỗi (409, 400…) không ghi. Thêm AC-18; [OPEN] "sửa không ghi ai sửa" thu hẹp.

## Preconditions
- `:id` là số nguyên dương (route `idParam`, sai → `invalid_input` 400).
- Sửa: thân hợp lệ như `POST /v1/transactions` (ledger [UC-101](UC-101-nhap-tay-khoan-tien.md); route `entryInput` dùng chung).

## Main Flow — huỷ (`voidTransaction`)
1. Đọc giao dịch theo `id` và kiểm (`manualTxOrThrow`): tồn tại; đang `active`; không phải bút toán hệ thống (`source='system'` hoặc `meaning='fund'`); không phải giao dịch ngân hàng (`source='sepay'` hoặc `log_id` khác NULL).
2. Nếu `meaning='income'`: lấy các lệnh gỡ lần chia (allocation UC-206 "Gỡ lần chia khi huỷ khoản thu", `undoAllocationStatements`): huỷ mọi `fund` `active` cùng `batch_id`, đổi lệnh chuyển `pending` cùng `batch_id` sang `skipped`. `allocation_runs` **giữ nguyên** → khoản thu đã huỷ không bao giờ được chia lại.
3. Chạy trong **một batch** (`runUndo`): các lệnh gỡ (nếu có) + `UPDATE transactions SET status='void' WHERE id=? AND status='active'`.
4. Trả dòng giao dịch sau khi huỷ (`status: "void"`), HTTP 200. Dòng vẫn còn trong bảng.

## Main Flow — sửa (`replaceTransaction`)
1. Thân có `client_id` mà đã có dòng mang `client_id` đó → trả ngay dòng đó (dạng dòng sổ, UC-111), `duplicate: true`, HTTP 200 — không kiểm gì thêm.
2. Kiểm khoản cũ như bước 1 của huỷ; thêm: meaning phải là meaning nhập tay (`MANUAL_MEANINGS`) — `adjust` (đếm ví) → `not_editable`.
3. Dựng khoản mới bằng `buildEntry` với **người ghi của khoản cũ** (`by_member_id` giữ nguyên; ví cá nhân đổi theo người đó). Khoản nợ / khoản phải thu / người thuê **đang gắn với khoản cũ** được coi là đang bật khi kiểm, nên sửa vẫn giữ được chỗ gắn dù đối tác đã tắt; gắn mới vào đối tác đã tắt vẫn bị chặn như khi nhập.
4. Áp các luật của nhập tay trước khi ghi: chiều tiền SePay báo về (D14, `fed_account`); `buy_asset` không vượt tiền mặt Tích sản (tính cả số tiền khoản cũ trả lại nếu khoản cũ cũng là `buy_asset`, `insufficient_cash`); `refund` / `collect` có `link_id` phải trỏ về một `spend` / `lend` còn hiệu lực khác chính khoản đang sửa (`resolveLink`, `invalid_link`). Khoản cũ đang có khoản hoàn tiền / nhận lại còn hiệu lực trỏ về: khoản mới phải cùng meaning, và (khoản cho vay) có người thì không khác người của các khoản nhận lại đó — không thì `invalid_link` "Khoản này đang có khoản trả lại trỏ về — gỡ liên kết trước.". Sai ở bất kỳ bước nào → lỗi, **không ghi gì**.
5. Khoản cũ là `income` → lấy lệnh gỡ lần chia như bước 2 của huỷ (có thể ném `allocation_settled`).
6. **Một batch** (`runUndo`): các lệnh gỡ (nếu có) → `INSERT` khoản mới **chỉ khi** khoản cũ còn `active` ngay trong batch → các khoản hoàn tiền / nhận lại còn hiệu lực đang trỏ về khoản cũ đổi `link_id` sang khoản mới (`last_insert_rowid()`, cùng điều kiện khoản cũ còn `active`) → huỷ khoản cũ. Huỷ (không sửa) thì không đổi liên kết.
7. Trả HTTP 201 `{ tx, replaced, duplicate: false, wallet }`: `tx` là khoản mới ở dạng dòng sổ (kèm `category_name`… — UC-111), `replaced` = id khoản cũ, `wallet` = ví còn bao nhiêu như khi nhập (UC-101).

## Alternative Flows
- 2a. `income` chưa từng được chia → không có lệnh gỡ; chỉ huỷ dòng income.
- 3a. Giữa bước đọc (2) và bước ghi (3), một request khác đánh dấu lệnh chuyển của lần chia là `done` → trigger 0006 huỷ cả batch; `runUndo` trả `allocation_settled` 409; sổ giữ nguyên. Sửa khoản thu đi cùng đường này.
- Sửa 5a. Khoản thu mới sau khi sửa **không tự chia** (như nhập tay — allocation UC-203); dòng `allocation_runs` của khoản cũ ở lại nên khoản cũ không chia lại được, khoản mới (id mới) chia được. PWA chia lại ngay sau khi sửa (pwa UC-715).
- Sửa 6a. Khoản cũ vừa bị huỷ ở request khác giữa bước kiểm và batch → `INSERT` không ghi dòng nào → `already_void` 409; không có khoản mới.
- Sửa 6b. Hai lần gửi cùng `client_id` chạy song song → lần thua vấp `idx_tx_client`, batch huỷ, đọc lại và trả dòng đã ghi (`duplicate: true`).

## Exceptions
- E1. Không có giao dịch → `not_found` 404 "Không có giao dịch này."
- E2. Đã `void` → `already_void` 409 "Giao dịch đã huỷ trước đó."
- E3. Bút toán hệ thống (`source='system'`: chốt tháng, quyết toán thuế; hoặc `meaning='fund'`) → `system_tx` 409 "Bút toán do hệ thống sinh ra không huỷ lẻ được."
- E4. `income` có lệnh chuyển cùng lần chia đã `done` → `allocation_settled` 409 "…gỡ lệnh chuyển tiền trước rồi mới huỷ được."
- E5. Giao dịch ngân hàng → `bank_tx` 409 "Giao dịch từ ngân hàng không xoá được — gỡ gán để gán lại." (cả huỷ lẫn sửa).
- E6. Sửa `adjust` → `not_editable` 409 "Khoản điều chỉnh sau đếm ví không sửa được — xoá rồi đếm lại."
- E7. Sửa với khoản mới sai → đúng mã lỗi của nhập tay (UC-101 E…: `invalid_amount`, `unknown_category`, `locked_wallet`, `fed_account`, `insufficient_cash`, `invalid_link`, `inactive_debt`…); khoản cũ còn nguyên.

## Acceptance Criteria
### AC-1: Huỷ là đổi trạng thái, không xoá; huỷ lần hai báo lỗi
- Given một `spend` 10.000 vừa nhập
- When huỷ nó hai lần
- Then lần đầu trả `status: "void"`; lần hai 409; bảng vẫn còn đúng 1 dòng với `id` đó
- Tests: `test/api.test.ts` › "nhập tay › huỷ giao dịch là đổi trạng thái, không xoá; huỷ lần hai báo lỗi"

### AC-2: Huỷ khoản thu đã chia gỡ luôn lần chia
- Given `income` 10.000.000 đã chia
- When huỷ `income`
- Then `status: "void"`; mọi ví về 0; mọi lệnh chuyển thành `skipped`; `POST /v1/allocate` lại cho khoản đó bị từ chối
- Tests: `test/api.test.ts` › "chia lương end-to-end › huỷ khoản thu đã chia thì gỡ luôn lần chia: ví về như cũ, lệnh chuyển chưa làm bị bỏ, không chia lại được"

### AC-3: Tiền của lần chia đã chuyển thật → không huỷ được khoản thu
- Given `income` đã chia và một lệnh chuyển đã đánh dấu `done`
- When huỷ `income`
- Then lỗi `allocation_settled`; `income` vẫn `active`
- Tests: `test/api.test.ts` › "chia lương end-to-end › tiền của lần chia đã chuyển thật thì không huỷ khoản thu được"

### AC-4: Đua với "Đã chuyển" — DB chặn cả batch
- Given bước đọc của lần gỡ chưa thấy lệnh `done`, rồi request khác đánh dấu một lệnh `done`
- When chạy batch gỡ
- Then `allocation_settled`; tổng `fund` active vẫn bằng số tiền thu; huỷ `income` sau đó cũng bị từ chối
- Tests: `test/ingest-integrity.test.ts` › "rà lại các bản sửa (reviewer cuối) › người kia bấm 'Đã chuyển' đúng lúc đang gỡ lần chia → huỷ bị từ chối, sổ giữ nguyên"

### AC-5: Không huỷ / sửa lẻ bút toán hệ thống
- Given một `fund` của lần chia, hoặc `transfer` chốt tháng `S…` / quyết toán thuế `T…`
- When `POST /v1/transactions/:id/void` hoặc `/replace` với id đó
- Then `system_tx` 409, không đổi gì
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › không sửa / xoá lẻ bút toán hệ thống (fund của lần chia) → system_tx" (chốt tháng `S…` / quyết toán `T…` đi cùng nhánh `source='system'`: ⚠ Chưa có test riêng)

### AC-6: Xoá khoản chi ghi tay trả lại tiền cho ví
- Given `spend` 45.000 Đi chợ ghi tay, ví Ăn uống −45.000
- When `POST /v1/transactions/:id/void`
- Then 200 `status: "void"`; ví Ăn uống về 0
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › xoá khoản chi ghi tay: dòng thành void, ví được trả lại tiền"

### AC-7: Giao dịch ngân hàng không huỷ được ở sổ cái — chỉ gỡ gán
- Given log `out` 80.000 trên `vcb-husband` đã gán thành khoản chi (`source='sepay'`)
- When `POST /v1/transactions/:id/void`
- Then 409 `bank_tx`; giao dịch vẫn `active`; log vẫn `assigned`; gỡ gán (`POST /v1/logs/transactions/:txId/void`) thì được và log về `pending`
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › giao dịch từ ngân hàng không xoá được ở sổ cái (bank_tx), log vẫn đã gán; gỡ gán thì được"

### AC-8: Sửa khoản chi trong một lần — số tiền, danh mục, ví
- Given `spend` 45.000 Đi chợ (ví Ăn uống) ngày 20/9 kèm ghi chú
- When `/replace` thành 120.000 Xăng xe ví Đi lại, cùng ngày, ghi chú mới, có `client_id`
- Then 201 `{ replaced: <id cũ>, duplicate: false, wallet: Đi lại }`; khoản mới `active`, `source='manual'`, đúng số/danh mục/ví/ghi chú; khoản cũ `void`; Ăn uống về 0, Đi lại −120.000; chỉ một dòng `active`
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa khoản chi: đổi số tiền, danh mục, ví trong một lần — khoản cũ void, khoản mới active, số dư ví đúng"

### AC-9: Khoản mới sai thì khoản cũ còn nguyên
- Given `spend` 45.000 đang `active`
- When `/replace` với số 0, danh mục không có, ví Tích sản, hoặc mua tài sản vượt tiền mặt Tích sản
- Then lỗi đúng mã (`invalid_amount`, `unknown_category`, `locked_wallet`, `insufficient_cash`); khoản cũ vẫn `active`; bảng vẫn một dòng; số dư ví không đổi
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa bằng dữ liệu mới sai → từ chối, khoản cũ còn nguyên: %j → %s"

### AC-10: Không sửa được giao dịch ngân hàng
- Given giao dịch sinh từ log ngân hàng
- When `/replace`
- Then `bank_tx`; giao dịch vẫn `active`; không có dòng mới
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa giao dịch từ ngân hàng → bank_tx, không ghi gì mới"

### AC-11: Sửa khoản thu đã chia — gỡ lần chia cũ, khoản mới chưa chia
- Given `income` 10.000.000 đã chia (lệnh chuyển `pending`)
- When `/replace` thành 12.000.000
- Then khoản cũ `void`; không còn `fund` active; lệnh chuyển `skipped`; ví Thu nhập giữ 12.000.000; khoản mới chưa có `allocation_runs`; `POST /v1/allocate` cho khoản mới 201 và Thu nhập về 0
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa khoản thu đã chia: gỡ lần chia cũ, khoản thu mới chưa chia và chia lại được"

### AC-12: Sửa khoản thu bị chặn khi tiền của lần chia đã chuyển thật
- Given `income` đã chia, một lệnh chuyển `done`
- When `/replace`
- Then 409 `allocation_settled`; khoản cũ `active`; vẫn một `income`; tổng `fund` active không đổi
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa khoản thu mà tiền của lần chia đã chuyển thật → allocation_settled, sổ giữ nguyên"

### AC-13: Gửi lại cùng `client_id` khi sửa chỉ ghi một lần
- Given `spend` 45.000
- When `/replace` hai lần cùng thân và `client_id`; rồi lần ba với `client_id` khác
- Then lần một 201, lần hai 200 `duplicate: true` cùng `tx.id`; bảng có đúng 2 dòng; ví trừ 50.000 một lần; lần ba `already_void`
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › gửi lại cùng client_id khi sửa chỉ ghi một lần"

### AC-14: Sửa giữ chỗ gắn sổ nợ, sổ phải thu, người thuê — kể cả khi đối tác đã tắt
- Given khoản trả nợ gắn `co-mai`, khoản cho vay gắn `em-hai`, khoản thu gắn người thuê `chi-lan`; rồi cả ba đối tác bị tắt
- When `/replace` từng khoản, gửi kèm đúng chỗ gắn cũ
- Then khoản mới giữ `debt_id` / `receivable_id` / `tenant_id` (khoản thu người thuê vẫn tự lấy nguồn cho thuê); gắn **mới** một khoản khác vào `co-mai` đã tắt → `inactive_debt`
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa giữ chỗ gắn sổ nợ, sổ phải thu, người thuê — kể cả khi khoản đó đã tắt"

### AC-15: Sửa giữ người ghi
- Given vợ ghi `spend` vào ví Chơi (vợ)
- When chồng `/replace` khoản đó, giữ ví Chơi (vợ)
- Then khoản mới `by_member_id = wife`, ví vẫn Chơi (vợ) (không bị đổi sang ví của người sửa)
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa giữ người ghi là người ghi khoản cũ"

### AC-16: Điều chỉnh sau đếm ví chỉ xoá được
- Given một `adjust` sinh từ đếm ví
- When `/replace`, rồi `/void`
- Then `/replace` 409 `not_editable`, khoản vẫn `active`; `/void` được
- Tests: `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › khoản điều chỉnh sau đếm ví chỉ xoá được, không sửa (not_editable)"

### AC-17: Sửa khoản gốc kéo theo khoản trả về; đổi loại hay đổi người thì bị chặn; huỷ thì liên kết giữ
- Given Em Hai và Chị Lan; cho vay 1.000.000 Em Hai (L) có nhận lại 600.000 (C) trỏ về L; khoản chi 244.000 (S) có hoàn 250.000 trỏ về S
- When sửa L thành cho vay 1.200.000 Em Hai; sửa khoản mới thành khoản chi, hay cho vay gắn Chị Lan; sửa S thành chuyển nội bộ; rồi huỷ khoản cho vay mới
- Then lần đầu 201, C trỏ về khoản mới (`linked_from` của khoản mới có C), Em Hai còn 600.000; ba lần sau 400 `invalid_link` "Khoản này đang có khoản trả lại trỏ về — gỡ liên kết trước.", không dòng nào thêm, khoản đang sửa còn `active`; huỷ xong C vẫn trỏ khoản đó, `link.status = "void"`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc) › sửa khoản gốc: khoản trả về trỏ sang khoản mới; đổi loại hay đổi người của khoản gốc thì invalid_link, không đổi gì; xoá khoản gốc thì liên kết giữ, khoản gốc hiện đã xoá"

### AC-18: Huỷ và sửa ghi nhật ký ai làm, qua đâu; lỗi thì không ghi (ADR-90)
- Given "wife" ghi khoản chi X bằng API token
- When "wife" sửa X (201, khoản mới Y); "husband" huỷ Y; "husband" huỷ Y lần nữa (409)
- Then `audit_log` đúng hai dòng: `{ member_id: "wife", via: "token", action: "tx.replace", target: "tx:<X>" }`, `{ member_id: "husband", via: "token", action: "tx.void", target: "tx:<Y>" }`
- Tests: `test/audit.test.ts` › "nhật ký thay đổi › huỷ, sửa, gỡ gán giao dịch đều ghi một dòng: ai, qua đâu, giao dịch nào"

## Traceability
- Code: `src/routes/v1.ts` › `POST /transactions/:id/void`, `POST /transactions/:id/replace`, `entryInput`, `idParam`; `src/services/audit.ts` › `recordChange`; `src/services/ledger.ts` › `manualTxOrThrow`, `voidTransaction`, `replaceTransaction` (`LINKED_RETURNS`, `relink`), `resolveLink`, `transactionView`, `getTransaction`, `walletStatus`, `undoAllocationStatements`, `runUndo` (hai hàm sau thuộc allocation); `src/domain/entry.ts` › `buildEntry`, `MANUAL_MEANINGS`
- Migrations/DB: `status` CHECK (`migrations/0001_schema.sql`); `trg_fund_void_needs_unsettled_batch` (`migrations/0006_allocation_undo_guard.sql`); `allocation_runs` (`migrations/0003_offline_entry_and_allocation_runs.sql`); `idx_tx_client` (0003, dựng lại ở 0014)
- PWA: pwa [UC-715](../pwa/UC-715-xem-sua-xoa-giao-dich.md) (`web/src/screens/tx-sheet.tsx`, `web/src/state/store.ts` › `voidEntry`, `replaceEntry`). MCP không có công cụ huỷ / sửa.

## Divergences & Open Questions
- [OPEN] Huỷ một `adjust` không đụng dòng `cash_counts` trỏ về nó.
- Đã đóng 2026-10-05 (v5): [OPEN] cũ "huỷ hay sửa một `spend` không đụng tới các `refund` trỏ về nó" — sửa nay kéo các khoản trả về sang khoản mới (bước 6); huỷ giữ liên kết về dòng đã huỷ (quyết định khi hợp nhất change `261005-lien-ket-khoan-goc`: khoản trả về vẫn biết nó trả cho khoản nào; chi tiết hiện "khoản gốc đã xoá").
- [OPEN] Sửa không ghi ai sửa **trong sổ**: khoản mới mang người ghi của khoản cũ, không có cột "người sửa", và liên hệ cũ → mới chỉ có trong phản hồi (`replaced`), không lưu trong sổ. Từ v6 ai sửa / huỷ, lúc nào, qua đâu nằm ở `audit_log` (`tx.replace`, `tx.void` — ADR-90), không gắn vào dòng giao dịch.
