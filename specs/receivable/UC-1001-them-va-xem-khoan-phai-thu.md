# UC-1001: Thêm và xem khoản phải thu
- Status: implemented
- BR: BR-13, BR-05
- Decisions: ADR-72 (sổ phải thu ngoài sổ cái; nhận lại = `collect`), ADR-71 (cùng service sổ đối ứng với sổ nợ), ADR-58 (khuôn sổ phải thu ngoài sổ cái của rental)
- Actor: người trong hộ (PWA tab **Nợ** ở Ví & quỹ — card "Người khác nợ mình", [UC-707](../pwa/UC-707-xem-vi-va-quy.md)); Claude qua MCP `get_receivables`; PWA lúc khởi động (`bootstrap`)
- Trigger: `POST /v1/receivables { id?, name, amount, note?, at? }`; `GET /v1/receivables`; `PATCH /v1/receivables/:id { name?, note?, active? }`; `GET /v1/bootstrap` (`receivables`)

## History
- v1 (2026-10-01, commit `2438ac0`): thêm khoản phải thu (dòng `opening`), danh sách với đã cho vay / đã nhận lại / còn phải thu / đã nhận đủ, sửa tên-ghi chú, bật/tắt; `bootstrap.receivables`; tool MCP `get_receivables` (ADR-72, schema v1.14).
- v2 (2026-10-04, commit `c9c6acb`): change [`261004-gan-tham-chieu`](../changes/archive/261004-gan-tham-chieu/proposal.md) — `POST /v1/receivables` nhận `amount: 0` (thêm người chưa nợ gì: không dòng `opening`, số dư 0) để màn Gán / Loại khác thêm người ngay tại ô **Ai trả** / **Cho ai vay** ("+ Người mới…", pwa UC-705, UC-706). Số âm, số lẻ vẫn `invalid_amount`; sheet **Thêm khoản phải thu** ở tab Nợ vẫn đòi số > 0. AC-2 sửa, AC-8 mới.
- v3 (2026-10-05, commit `6f5e77a`): sheet **Thêm khoản phải thu** ở tab Nợ thêm được người chưa nợ gì: tên có mà Còn nợ mình để 0 thì nút là **Thêm người, chưa nợ gì** → `POST /v1/receivables { name, amount: 0 }` (như "+ Người mới…" ở màn Gán), toast "Đã thêm khoản phải thu {tên}." (không kèm "Đã trả đủ."); số âm, số lẻ vẫn bị chặn; sheet Thêm khoản nợ vẫn đòi số > 0. Lý do: chủ nhà gặp lỗi gán nhận lại cho người chưa có trong sổ (pwa UC-706 v25) — thêm người trước ở tab Nợ trước đây không làm được vì sheet đòi số > 0. AC-2 sửa, AC-9 mới.

## Preconditions
- Đã đăng nhập (access UC-501/UC-502). Cần mạng (luật chung S7, [README](README.md)).

## Main Flow — thêm khoản phải thu
1. Người nhập **tên** người đang nợ (bắt buộc), **số tiền người ta đang nợ** lúc bắt đầu theo dõi (≥ 0; 0 = người chưa nợ gì — AC-8, AC-9), ghi chú (tuỳ chọn). PWA chặn trước khi gửi (thiếu tên, số tiền âm hay lẻ).
2. `POST /v1/receivables` → luật chung S1 ([README](README.md)): kiểm tên, số tiền, mã; một batch ghi `receivables` + một dòng `receivable_lines` `kind = 'opening'` → 201 `Receivable` với `lent` = `balance` = số tiền, `collected = 0`, `done = false`.
3. **Không** ví, không tài khoản nào đổi: số tiền mở sổ là ghi nhớ "người ta nợ mình", không phải tiền ra hôm nay. Tiền cho vay hôm nay thì ghi `lend` ([UC-1002](UC-1002-cho-vay-tra-ho.md)) — không thêm dòng mở sổ cho cùng số tiền đó.

## Main Flow — xem
4. `GET /v1/receivables` → `{ totalBalance, receivables }`: mỗi khoản có `lent`, `collected`, `balance`, `done`, các dòng sổ `active` và các lần tiền đi/về (`movements`: `lend`/`collect`, `accountId`, `source`), mới nhất trước. Thứ tự và tổng theo luật chung S4.
5. PWA tab **Nợ** (UC-707): card **Người khác nợ mình** — hàng **Tổng còn phải thu**, mỗi khoản một hàng (còn phải thu nhiều lên trước), nhóm **Đã trả đủ** thu gọn; khoản đã tắt không hiện (`groupBook`). Sheet **Thêm khoản phải thu**: Ai nợ mình · Còn nợ mình · Ghi chú (`receivablePayload`); câu dưới form "Ghi số người đó còn nợ hôm nay; chưa nợ gì thì để 0. …"; nút "Nhập ai nợ mình" (chưa có tên) / "Thêm khoản phải thu X" (có số) / **Thêm người, chưa nợ gì** (số để 0).
6. `GET /v1/bootstrap` trả `receivables: [{ id, name, balance }]` (luật chung S4) để ô chọn khoản phải thu ở Loại khác và màn Gán dùng được khi offline ([UC-1002](UC-1002-cho-vay-tra-ho.md), [UC-1003](UC-1003-nhan-lai-tien.md)).

## Alternative Flows
- 4a. **MCP** `get_receivables` gọi đúng `getReceivables` — cùng payload với `GET /v1/receivables`; Claude trả lời "ai còn nợ mình bao nhiêu" bằng `totalBalance`, không cộng số này vào "mình có bao nhiêu tiền" (BR-13).
- 7. **Sửa / tắt**: `PATCH /v1/receivables/:id` → `Receivable` (luật chung S5); tắt → `inactive_receivable` khi gắn giao dịch hay thêm dòng.

## Exceptions
- E1. `amount` không nguyên / < 0 → 400 `invalid_amount` (0 được — AC-8); thiếu tên → 400 `invalid_input`; mã sai dạng → 400 `invalid_id`.
- E2. Mã đã có → 409 `duplicate_id`.
- E3. `PATCH` khoản không có → 404 `not_found`.
- E4. MCP: lỗi nghiệp vụ trả `isError: true`, không ghi gì.

## Acceptance Criteria

### AC-1: Thêm khoản phải thu ghi dòng mở sổ, không đổi ví hay tài khoản
- Given chưa có khoản phải thu nào
- When `POST /v1/receivables { name: "Em Hai", amount: 15000000, note: "Mượn mua xe" }`
- Then 201; mã `em-hai`; một dòng `opening` 15.000.000; `lent = balance = 15.000.000`, `collected = 0`, `done = false`, `movements = []`; `totalBalance = 15.000.000`; số dư mọi ví và mọi tài khoản không đổi; bảng `transactions` vẫn trống
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › thêm khoản phải thu chỉ ghi nhớ: dòng opening, không tài khoản nào, không ví nào đổi"

### AC-2: Số tiền không được âm hay lẻ; trùng mã báo `duplicate_id`
- Given khoản `em-hai` "Em Hai" đã có
- When thêm khoản với `amount` −5, 1,5; thiếu tên; thêm "Em  Hai" (cùng mã sinh từ tên)
- Then 400 `invalid_amount`; 400 `invalid_input`; 409 `duplicate_id`; bảng `receivables` vẫn một dòng
- And PWA (sheet Thêm khoản phải thu) chặn trước khi gửi: thiếu tên ("Nhập tên người nợ mình."), số tiền âm hay lẻ ("Nhập số tiền còn phải thu."); số 0 được (AC-9)
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › thêm khoản phải thu: số tiền âm hoặc lẻ bị từ chối, trùng mã báo duplicate_id"; [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › kiểm tra khoản phải thu mới và dòng chỉnh: thiếu tên, số tiền âm hay lẻ; số 0 được (thêm người chưa nợ gì); chỉnh mang dấu"

### AC-3: Nhận đủ thì khoản được đánh dấu `done`, xếp sau khoản còn nợ
- Given Em Hai còn 1.000.000, Chú Tư còn 500.000
- When nhận lại đủ 1.000.000 từ Em Hai ([UC-1003](UC-1003-nhan-lai-tien.md))
- Then danh sách `[chu-tu 500.000 chưa xong, em-hai 0 done]`; `totalBalance = 500.000`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › trả đủ thì khoản phải thu done, xuống cuối danh sách, không còn trong tổng"

### AC-4: `bootstrap` trả các khoản phải thu đang bật kèm số còn phải thu
- Given Em Hai còn 750.000 (sau khi nhận lại 250.000), Chú Tư còn 3.000.000, một khoản đã tắt
- When `GET /v1/bootstrap`
- Then `receivables = [{ id: "chu-tu", name: "Chú Tư", balance: 3000000 }, { id: "em-hai", name: "Em Hai", balance: 750000 }]` — không có khoản đã tắt
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › bootstrap trả các khoản phải thu đang mở kèm số còn phải thu"

### AC-5: MCP `get_receivables` trả cùng dữ liệu như REST
- Given Em Hai mở sổ 2.000.000
- When Claude gọi `get_receivables`
- Then không lỗi; khối JSON `{ totalBalance: 2000000, receivables: [{ id: "em-hai", name: "Em Hai", lent: 2000000, collected: 0, balance: 2000000, done: false, movements: [] }] }`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "sổ phải thu › get_receivables trả các khoản phải thu và tổng còn phải thu"

### AC-6: Tắt khoản phải thu thì không gắn được giao dịch, không nhận dòng, ra khỏi tổng
- Given Em Hai đang còn nợ
- When `PATCH /v1/receivables/em-hai { active: false, name: "Em Hai (cũ)" }` rồi ghi `lend`, `collect`, `adjust` gắn khoản đó; ghi `collect` với `receivable_id: "khong-co"`
- Then `PATCH` trả khoản đã đổi tên, `active: false`; ba lần ghi đều 400 `inactive_receivable`; `totalBalance = 0`; mã không có → 400 `unknown_receivable`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › receivable_id không có hoặc đã tắt: unknown_receivable, inactive_receivable"

### AC-7: Tab Nợ xếp khoản còn phải thu nhiều lên trước, đã trả đủ tách riêng
- Given các khoản còn phải thu khác nhau, khoản 0 và âm, một khoản đã tắt
- When xếp danh sách ở PWA
- Then đang mở xếp còn phải thu giảm dần; nhóm "Đã trả đủ" theo tên; khoản tắt không hiện
- Tests: [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › sắp khoản phải thu: còn nhiều lên trước, đã trả đủ tách riêng theo tên, khoản tắt không hiện"; hiển thị: ⚠ Chưa có test

### AC-8: Thêm người với số 0 — không dòng mở sổ; nhận lại thì thành trả dư
- Given chưa có khoản phải thu nào
- When `POST /v1/receivables { name: "Em Hai", amount: 0 }` (như "+ Người mới…" ở màn Gán); rồi nhận lại 250.000 gắn `em-hai`
- Then 201; `lent = collected = balance = 0`, `done = true`, `lines = []`, không dòng `receivable_lines` nào; ví và tài khoản không đổi; `bootstrap.receivables = [{ id: "em-hai", name: "Em Hai", balance: 0 }]`; sau khi nhận lại `balance = −250.000` (trả dư), `totalBalance = 0`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › thêm người với số 0 (+ Người mới… ở màn Gán): không dòng opening, còn phải thu 0; nhận lại thì thành trả dư"

### AC-9: Tab Nợ thêm được người chưa nợ gì
- Given tab Nợ, có mạng
- When **Thêm khoản phải thu**, Ai nợ mình " Dì Bảy ", Còn nợ mình để 0; rồi mở **Thêm khoản nợ**, Nợ ai "Cô Lan", Còn nợ để 0
- Then sheet phải thu: nút **Thêm người, chưa nợ gì** bật → thân `{ name: "Dì Bảy", amount: 0 }`; 201, `di-bay` số 0, không dòng nào; toast "Đã thêm khoản phải thu Dì Bảy."; Dì Bảy nằm ở nhóm Đã trả đủ và có trong ô Ai trả / Cho ai vay. Sheet nợ: nút "Nhập số tiền" tắt (`debtPayload` vẫn chặn số 0)
- Tests: [`web/src/lib/receivables.test.ts`](../../web/src/lib/receivables.test.ts) › "sổ phải thu › kiểm tra khoản phải thu mới và dòng chỉnh: thiếu tên, số tiền âm hay lẻ; số 0 được (thêm người chưa nợ gì); chỉnh mang dấu"; [`web/src/lib/debts.test.ts`](../../web/src/lib/debts.test.ts) › "sổ nợ › kiểm tra khoản nợ mới và dòng nợ: thiếu tên, số tiền"; [`test/receivables.test.ts`](../../test/receivables.test.ts) › "sổ phải thu › thêm người với số 0 (+ Người mới… ở màn Gán): không dòng opening, còn phải thu 0; nhận lại thì thành trả dư" (server); nút, toast: ⚠ Chưa có test (repo chưa có test giao diện; đã xem tận mắt ở 390px, `wrangler dev` cục bộ)

## Traceability
- Code: `src/routes/books.ts` › `bookRoutes`, `mount("receivables", …)`; `src/services/receivables.ts` › `RECEIVABLES` (`zeroOpening`), `createReceivable`, `getReceivables`, `updateReceivable`; `src/services/memo-books.ts` › `createBook`, `listBooks`, `updateBook`; `src/routes/v1.ts` › `GET /bootstrap` (`receivables`); `src/services/ledger.ts` › `loadRefs` (`receivables`); `src/mcp/tools.ts` › tool `get_receivables`
- PWA: `web/src/lib/receivables.ts` › `receivablePayload`, `defaultReceivableId`, `unpaidText`; `web/src/lib/memo-books.ts` › `groupBook`, `openRefs`, `bookPayload`; `web/src/screens/memo-book.tsx` › `BookCard`, `BookDetailSheet`, `BookAddSheet`; tab Nợ ở Ví & quỹ ([UC-707](../pwa/UC-707-xem-vi-va-quy.md)); `web/src/screens/ref-pickers.tsx` › `ReceivablePicker` ("+ Người mới…", số 0)
- Migrations/DB: `receivables`, `receivable_lines`, view `v_receivable_balance` (`migrations/0014_receivables.sql`)

## Divergences & Open Questions
- [OPEN] Số mở sổ là số người ta đang nợ **lúc bắt đầu theo dõi**; các khoản `lend` cũ (không có `receivable_id`) không được gắn lại, và tiền cho vay đã về trước đây mà ghi là `refund` vẫn nằm trong ví nó đã cộng (migration 0014 không sửa dữ liệu cũ). Chưa có quyết định có cần một bút toán chuyển ngân sách để kéo ví về đúng hay không.
