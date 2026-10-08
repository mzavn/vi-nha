# UC-901: Thêm và xem khoản nợ
- Status: implemented
- BR: BR-12, BR-05
- Decisions: ADR-71 (sổ nợ ngoài sổ cái; trả nợ = khoản chi có `debt_id`), ADR-58 (khuôn sổ phải thu ngoài sổ cái của rental), ADR-72 (cùng khuôn sổ đối ứng với sổ phải thu — luật chung S1, S4, S5 ở [receivable/README.md](../receivable/README.md)), ADR-94 (danh mục trả nợ là mã hệ thống `debt-payment`)
- Actor: người trong hộ (PWA tab **Nợ** ở Ví & quỹ — [UC-707](../pwa/UC-707-xem-vi-va-quy.md)); Claude qua MCP `get_debts`; PWA lúc khởi động (`bootstrap`)
- Trigger: `POST /v1/debts { id?, name, amount, note?, at? }`; `GET /v1/debts`; `PATCH /v1/debts/:id { name?, note?, active? }`; `GET /v1/bootstrap` (`debts`)

## History
- v1 (2026-10-01, commit `25db5b9`): thêm khoản nợ (dòng `opening`), danh sách khoản nợ với đã vay / đã trả / còn nợ / đã trả xong, sửa tên-ghi chú, bật/tắt; `bootstrap.debts`; tool MCP `get_debts` (ADR-71, schema v1.13).
- v2 (2026-10-01, commit `2438ac0`): không đổi hành vi — thêm / xem / sửa-tắt chạy trên service sổ đối ứng dùng chung `src/services/memo-books.ts` (cùng sổ phải thu, ADR-72), route chuyển sang `src/routes/books.ts`; luật chung viết một lần ở [receivable/README.md](../receivable/README.md) (S1 thêm kèm dòng mở sổ, S4 đã xong / tổng / thứ tự, S5 sửa-tắt). Card trên tab Nợ đổi tên "Mình nợ" (pwa UC-707).
- v3 (2026-10-08, commit `21b9db0`): không đổi hành vi — migration 0029 (schema v1.29, ADR-94) đổi danh mục trả nợ `tra-no` → `debt-payment` ở mọi giao dịch / rule / dòng sổ người thuê; còn nợ không đổi. Thêm AC-8 (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Đã đăng nhập (access UC-501/UC-502). Cần mạng: sổ nợ không đi qua hàng đợi offline (chỉ khoản trả nợ mới đi qua — [UC-902](UC-902-tra-no.md)).

## Main Flow — thêm khoản nợ
1. Người nhập **tên** (bắt buộc), **số tiền còn nợ** lúc bắt đầu theo dõi (> 0), ghi chú (tuỳ chọn). PWA chặn trước: thiếu tên → "Nhập tên khoản nợ."; số tiền ≤ 0 → "Nhập số tiền còn nợ." (`debtPayload`).
2. `POST /v1/debts`: tên bắt buộc (`invalid_input`); kiểm `amount` nguyên dương (`invalid_amount`); `id` không gửi thì sinh từ tên (bỏ dấu, `đ`→`d`, gạch nối, tối đa 40 ký tự), phải khớp `[a-z0-9-]{1,40}` (`invalid_id`); trùng → 409 `duplicate_id`. `at` chuẩn hoá bằng `normalizeAt`.
3. Ghi một dòng `debts` + một dòng `debt_lines` `kind = 'opening'`, `amount` = số tiền, `at` = `at` gửi lên hoặc bây giờ → 201 `Debt` với `owed = paid + balance`, `balance` = số tiền, `done = false`.

## Main Flow — xem
4. `GET /v1/debts` → `{ totalBalance, debts }`: mỗi khoản có đã vay (`owed`), đã trả (`paid`), còn nợ (`balance`), `done` (`balance ≤ 0`), các dòng nợ `active` và các khoản trả (`payments`), mới nhất trước. Xếp: đang bật trước, chưa xong trước, còn nợ giảm dần, tên. `totalBalance` = Σ `max(balance, 0)` các khoản đang bật.
5. PWA tab **Nợ** (UC-707): tổng còn nợ; nhóm **đang mở** (còn nợ nhiều lên trước) và nhóm **Đã trả xong** (theo tên); khoản đã tắt không hiện (`groupDebts`). Mỗi khoản: tên, còn nợ, thanh "đã trả / đã vay" (`paidPct`), các dòng và khoản trả.
6. `GET /v1/bootstrap` trả `debts: [{ id, name, balance }]` — khoản đang bật, còn nợ giảm dần rồi tên — để sheet Trả nợ và màn Gán chọn khoản nợ khi offline (UC-902, UC-903).

## Alternative Flows
- 4a. **MCP** `get_debts` gọi đúng `getDebts` — cùng payload với `GET /v1/debts`; Claude trả lời "còn nợ bao nhiêu" bằng `totalBalance`.
- 7. **Sửa / tắt**: `PATCH /v1/debts/:id { name?, note?, active? }` → `Debt`. Tắt khi đã trả xong hoặc không theo dõi nữa; khoản tắt không nhận khoản trả, không nhận dòng mới (`inactive_debt`), không vào tổng còn nợ, `bootstrap`, tin sáng. Bật lại được. Không có xoá.

## Exceptions
- E1. `amount` không nguyên / ≤ 0 → 400 `invalid_amount`; thiếu tên → 400 `invalid_input`; mã sai dạng → 400 `invalid_id`.
- E2. `id` (gửi tay hoặc sinh từ tên) đã có → 409 `duplicate_id`.
- E3. `PATCH` khoản không có → 404 `not_found`.
- E4. MCP: lỗi nghiệp vụ trả `isError: true`, không ghi gì.

## Acceptance Criteria

### AC-1: Thêm khoản nợ ghi dòng mở sổ; còn nợ bằng số tiền
- Given chưa có khoản nợ nào
- When `POST /v1/debts { name: "Cô Mai", amount: 15379000, note: "Mượn sửa nhà" }`
- Then 201; mã `co-mai` sinh từ tên; khoản có một dòng `opening` 15.379.000; `owed = 15.379.000`, `paid = 0`, `balance = 15.379.000`, `done = false`; `totalBalance = 15.379.000`
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › tạo khoản nợ ghi dòng opening, số còn nợ bằng số tiền"

### AC-2: Số tiền phải lớn hơn 0; trùng mã báo `duplicate_id`
- Given khoản `co-mai` "Cô Mai" đã có
- When thêm khoản với `amount` 0, −5, 1,5; thêm khoản thiếu tên; thêm "Cô  Ba" (cùng mã sinh từ tên)
- Then 400 `invalid_amount`; 400 `invalid_input`; 409 `duplicate_id`; bảng `debts` vẫn một dòng
- And PWA chặn trước khi gửi: thiếu tên, số tiền ≤ 0
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › thêm khoản nợ: số tiền phải lớn hơn 0, trùng mã báo duplicate_id"; [`web/src/lib/debts.test.ts`](../../web/src/lib/debts.test.ts) › "sổ nợ › kiểm tra khoản nợ mới và dòng nợ: thiếu tên, số tiền"

### AC-3: Trả hết thì khoản nợ được đánh dấu `done`
- Given Cô Mai còn 1.000.000, Chú Tư còn 500.000
- When trả Cô Mai 1.000.000 (UC-902)
- Then Cô Mai `balance = 0`, `done = true`, vẫn trong danh sách nhưng xếp sau Chú Tư; `totalBalance = 500.000`
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › trả hết thì khoản nợ được đánh dấu done"

### AC-4: Tab Nợ xếp khoản còn nợ nhiều lên trước, trả xong tách riêng
- Given các khoản còn nợ 2.000.000 (Bình), 9.379.000 (Cường), 2.000.000 (Dũng), 0 (An), −50.000 (Em), một khoản đã tắt
- When xếp danh sách
- Then đang mở: Cường, Bình, Dũng; đã trả xong: An, Em; khoản đã tắt không hiện
- Tests: [`web/src/lib/debts.test.ts`](../../web/src/lib/debts.test.ts) › "sổ nợ › sắp xếp khoản nợ: còn nợ nhiều lên trước, trả xong tách riêng"

### AC-5: `bootstrap` trả các khoản nợ đang mở kèm số còn nợ
- Given Cô Mai còn 750.000 (sau khi trả 250.000), Chú Tư còn 3.000.000, một khoản đã tắt
- When `GET /v1/bootstrap`
- Then `debts = [{ id: "chu-tu", name: "Chú Tư", balance: 3000000 }, { id: "co-mai", name: "Cô Mai", balance: 750000 }]` — không có khoản đã tắt
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › bootstrap trả các khoản nợ đang mở kèm số còn nợ"

### AC-6: MCP `get_debts` trả cùng dữ liệu như REST
- Given Cô Mai mở sổ 15.379.000
- When Claude gọi `get_debts`
- Then không lỗi; khối JSON `{ totalBalance: 15379000, debts: [{ id: "co-mai", owed: 15379000, paid: 0, balance: 15379000, done: false, … }] }` — cùng `getDebts` với `GET /v1/debts`
- Tests: [`test/mcp.test.ts`](../../test/mcp.test.ts) › "sổ nợ › get_debts trả các khoản nợ và tổng còn nợ"

### AC-7: Tắt khoản nợ thì không trả, không vay thêm được và ra khỏi tổng
- Given Cô Mai đang còn nợ
- When `PATCH /v1/debts/co-mai { active: false, name: "Cô Mai (cũ)" }` rồi ghi khoản trả hoặc vay thêm
- Then `PATCH` trả khoản đã đổi tên, `active: false`; khoản trả và vay thêm đều 400 `inactive_debt`; `totalBalance = 0`; khoản không còn trong `bootstrap.debts`
- Tests: [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › debt_id không có hoặc đã tắt: unknown_debt, inactive_debt"; [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › bootstrap trả các khoản nợ đang mở kèm số còn nợ"

### AC-8: Đổi mã danh mục trả nợ không làm đổi còn nợ
- Given DB như prod có khoản trả nợ danh mục `tra-no` gắn `debt_id`
- When chạy migration 0029
- Then khoản trả mang danh mục `debt-payment`, số dư sổ nợ (đã vay, đã trả, còn nợ) đúng như trước; khoản trả nợ ghi mới không chọn danh mục vào `debt-payment`
- Tests: test migration ở repo gốc; [`test/debts.test.ts`](../../test/debts.test.ts) › "sổ nợ › trả nợ không chọn danh mục thì lấy danh mục debt-payment"

## Traceability
- Code: `src/routes/books.ts` › `bookRoutes`, `mount("debts", …)` (`POST /debts`, `GET /debts`, `PATCH /debts/:id`); `src/services/debts.ts` › `createDebt`, `getDebts`, `updateDebt`; `src/services/memo-books.ts` › `createBook`, `listBooks`, `updateBook`; `src/routes/v1.ts` › `GET /bootstrap` (`debts`); `src/services/ledger.ts` › `loadRefs` (`debts`); `src/mcp/tools.ts` › tool `get_debts`
- PWA: `web/src/lib/debts.ts` › `groupDebts`, `paidPct`, `debtPayload`; tab Nợ ở Ví & quỹ ([UC-707](../pwa/UC-707-xem-vi-va-quy.md))
- Migrations/DB: `debts`, `debt_lines`, view `v_debt_balance` (`migrations/0013_debts.sql`)

## Divergences & Open Questions
- [OPEN] Số tiền mở sổ là số còn nợ **lúc bắt đầu theo dõi**; các lần trả trước đó (chi danh mục `debt-payment` không có `debt_id`) không được gắn lại vào khoản nợ — nếu nhập số gốc thay vì số còn lại thì còn nợ sẽ cao hơn thật, phải chỉnh tay (UC-904).
