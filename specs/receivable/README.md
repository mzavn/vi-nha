# Bounded context: receivable — Sổ phải thu (người khác nợ mình)

Câu hỏi của chủ nhà: "có nợ rồi, còn khoản phải thu thì sao?". Hộ cho người khác vay, hoặc trả hộ ai đó một khoản; người ta sẽ trả lại sau.
Trước đây chỉ có meaning `lend` (tiền ra khỏi tài khoản, không trừ ví) và lúc tiền về thì phải ghi `refund` — mà `refund` luôn cộng một ví, nên tiền cho vay quay về làm **ví phồng lên** so với trước khi cho vay (ledger [UC-101](../ledger/UC-101-nhap-tay-khoan-tien.md), [OPEN] cũ). Không nơi nào biết **ai còn nợ mình bao nhiêu**.
Context này giữ **sổ phải thu**: một sổ đối ứng **ngoài sổ cái**, cùng khuôn với sổ người thuê (ADR-58) và sổ nợ (ADR-71). Tiền đi là `lend`, tiền về là meaning mới `collect` (ADR-72) — cả hai chỉ đổi **tài khoản**, không bao giờ đổi ví. Context mới, schema v1.14.

**Tiền thật trước, ghi nhớ sau.** Số ở sổ phải thu trả lời "ai nợ ai", không bao giờ trả lời "mình có bao nhiêu tiền". Con số để ra quyết định là **tiền thật đang có** — tổng số dư các tài khoản ([UC-1005](UC-1005-xem-buc-tranh-tien-that.md)); phải thu, người thuê còn nợ và mình còn nợ đứng sau, ghi rõ "chưa phải tiền".

## Luật của chủ nhà (bất biến của context)

1. **Khoản phải thu không phải thu nhập.** `lend`/`collect` không đụng ví, không vào `v_wallet_flow`, không được chia (dòng thác), không bao giờ là "đã tiêu". Thêm một khoản phải thu (dòng mở sổ) không đổi tài khoản nào, ví nào — đó là ghi nhớ ngoài sổ cái.
2. **`collect` là tiền gốc quay về, không phải thu nhập:** không vào `v_spent_*`, không là `income`, không chia được, không làm đổi "còn để chi tuần này".
3. **Hai sổ.** Sổ cái = tiền thật (ví, tài khoản). Sổ đối ứng = ghi nhớ (phải thu, nợ, người thuê). Câu dưới các card ở tab Nợ: "Số ở đây là ghi nhớ ai nợ ai — chưa phải tiền trong ví. Chỉ khi tiền thật đi hoặc về thì ví và tài khoản mới đổi."
4. **Không ghi nhận doanh thu dồn tích.** Một khoản phải thu không bao giờ là thu nhập lúc phát sinh; tiền về là trả gốc. Đây là chỗ app cố ý khác kế toán doanh nghiệp (`docs/profit_first_phuong_phap.md` §8 — "lãi giả lỗ thật"; ADR-72).
5. **Số phải thu và số nợ trả lời "ai nợ ai", không bao giờ "mình có bao nhiêu tiền".**

## Ngôn ngữ chung

| Thuật ngữ | Nghĩa trong context này | Đối chiếu chuẩn mực kế toán (chỉ để hiểu — UI không dẫn số chuẩn mực) |
|---|---|---|
| **Sổ đối ứng ngoài sổ cái** | Khuôn chung của ba sổ ghi nhớ: một **đối tác** + các **dòng sổ chỉ ghi thêm** + các **giao dịch tiền thật** của sổ cái mang id đối tác + một **view số dư**. Luật chung ở mục dưới | — |
| Khoản phải thu (`Receivable`) | Một người/nơi đang nợ hộ (vd "Anh Tư mượn sửa xe"). Có tên, ghi chú, bật/tắt. Không đăng nhập, không phải `member`, không phải tài khoản hay ví | "Phải thu" — nhưng app **không** ghi doanh thu khi phát sinh phải thu (VAS 01/TT 200 là cơ sở dồn tích; app cố ý theo tiền thật) |
| Sổ phải thu | Các dòng `receivable_lines` của một khoản + các giao dịch `lend`/`collect` mang `receivable_id` | — |
| Dòng phải thu (`ReceivableLine`) | `opening` (ghi khi thêm khoản, > 0; thêm với số 0 thì không có dòng này) hoặc `adjust` (chỉnh tay, ≠ 0, có dấu). Không có dòng "cho vay thêm" hay "đã nhận" — đó là tiền thật | — |
| Cho vay / trả hộ | Giao dịch `lend` mang `receivable_id`: tiền **ra** khỏi một tài khoản, không trừ ví ([UC-1002](UC-1002-cho-vay-tra-ho.md)) | VAS 24 §10(c) "Tiền chi cho vay đối với bên khác" — hoạt động **đầu tư**, không phải chi phí |
| Nhận lại tiền (`collect`) | Giao dịch `collect` (meaning mới, ADR-72) mang `receivable_id`: tiền **vào** một tài khoản, không cộng ví, không phải thu nhập ([UC-1003](UC-1003-nhan-lai-tien.md)) | VAS 24 §10(d) "Tiền thu hồi cho vay đối với bên khác" — hoạt động **đầu tư**, không phải doanh thu |
| Đã cho vay (`lent`) | Σ dòng sổ `active` + Σ `lend` `active` mang `receivable_id` | — |
| Đã nhận lại (`collected`) | Σ `collect` `active` mang `receivable_id` | — |
| Còn phải thu (`balance`) | `lent − collected` (view `v_receivable_balance`). Tổng của hộ = Σ `max(balance, 0)` các khoản đang bật | — |
| Đã trả đủ (`done`) | `balance ≤ 0`; âm = người ta trả dư. PWA: nhóm "Đã trả đủ" | — |
| Tắt khoản (`active = false`) | Không nhận dòng mới, không gắn giao dịch mới (`inactive_receivable`); không vào tổng, tin sáng, `bootstrap`. Không có xoá | — |
| **Tiền thật đang có** (`cash`) | Σ số dư sổ (`v_account_book.book_balance`) mọi tài khoản đang dùng: tiền mặt + tài khoản ngân hàng/ví điện tử ([UC-1005](UC-1005-xem-buc-tranh-tien-that.md)) | VAS 24 §04 **"Tiền"**: "tiền tại quỹ, tiền đang chuyển và các khoản tiền gửi không kỳ hạn" — đúng phạm vi này |
| Tài sản (`assets`) | Vàng, cổ phiếu, chứng chỉ quỹ, BĐS đã mua bằng tiền Tích sản (`buy_asset`) | **Không** phải "tương đương tiền" (VAS 24 §04: đầu tư ngắn hạn ≤ 3 tháng, dễ đổi thành một lượng tiền xác định, ít rủi ro) — giá vàng/CK đổi theo thị trường, nên đứng một dòng riêng, không cộng vào tiền thật |
| Chuyển nội bộ | Tiền đi giữa hai tài khoản của hộ: không thu, không chi (ADR-03) | VAS 24 §04: luồng tiền "không bao gồm chuyển dịch nội bộ giữa các khoản tiền" |
| Phải trả / khoản nợ | Sổ nợ (context [debt](../debt/README.md)) | VAS 24 §11(c)(d) "Tiền thu từ các khoản đi vay" / "Tiền chi trả các khoản nợ gốc đã vay" — hoạt động **tài chính** (xem [DIVERGENCE] ở debt [UC-902](../debt/UC-902-tra-no.md)) |

## Sổ đối ứng ngoài sổ cái — luật chung

Một khuôn, ba bản. Sổ nợ và sổ phải thu dùng **chung một service** `src/services/memo-books.ts` (`MemoBookSpec`, `listBooks`, `getBook`, `createBook`, `updateBook`, `addLine`, `voidLine`) và chung một bộ route (`src/routes/books.ts` › `mount`). Sổ người thuê (rental) cùng khuôn nhưng giữ code riêng vì có kỳ tháng, chốt tháng và phí cố định.

| | Sổ người thuê (rental, ADR-58) | Sổ nợ (debt, ADR-71) | Sổ phải thu (receivable, ADR-72) |
|---|---|---|---|
| Đối tác | `tenants` | `debts` — hộ nợ người ta | `receivables` — người ta nợ hộ |
| Dòng sổ chỉ ghi thêm | `tenant_lines` | `debt_lines`: `opening`, `borrow`, `adjust` | `receivable_lines`: `opening`, `adjust` |
| Tiền thật làm **tăng** số dư | — | — (vay thêm về tài khoản là việc riêng của sổ cái) | `lend` mang `receivable_id` |
| Tiền thật làm **giảm** số dư | `income` mang `tenant_id` | `spend` mang `debt_id` | `collect` mang `receivable_id` |
| View số dư | `v_tenant_balance` | `v_debt_balance` (`owed`, `paid`) | `v_receivable_balance` (`lent`, `collected`) |
| Code | `src/services/rental.ts` | `src/services/debts.ts` → `memo-books.ts` | `src/services/receivables.ts` → `memo-books.ts` |

Luật chung cho sổ nợ và sổ phải thu (các UC của hai context trích "luật chung Sn" thay vì chép lại):

- **S1. Thêm đối tác = một dòng mở sổ.** `POST /v1/<sổ> { id?, name, amount, note?, at? }`: tên bắt buộc (`invalid_input`); `amount` nguyên dương ≤ 10^12 (`invalid_amount`); `id` không gửi thì sinh từ tên (bỏ dấu, `đ`→`d`, gạch nối, tối đa 40 ký tự), phải khớp `[a-z0-9-]{1,40}` (`invalid_id`), trùng → 409 `duplicate_id`; `at` qua `normalizeAt`. Một batch ghi đối tác + dòng `opening` = `amount`. **Không** ví, không tài khoản nào đổi (`createBook`). Riêng sổ phải thu (`zeroOpening`) nhận `amount: 0`: chỉ ghi đối tác, không dòng nào, số dư 0 — "+ Người mới…" ở màn Gán / Loại khác ([UC-1001](UC-1001-them-va-xem-khoan-phai-thu.md) AC-8); sổ nợ vẫn bắt buộc > 0.
- **S2. Dòng sổ chỉ ghi thêm.** Ghi tay dòng mới qua `POST /v1/<sổ>/:id/lines` (loại cho phép tuỳ sổ, sai → `invalid_kind`; `opening` chỉ ghi ở S1); đối tác phải có (404) và đang bật (`inactive_<sổ>`). Sai thì **huỷ dòng** `POST /v1/<dòng>/:id/void` (`active → void`, một chiều; lần hai → 409 `already_void`; không có → 404) rồi ghi lại. DB chặn mọi UPDATE khác và mọi DELETE bằng trigger (`*_append_only`).
- **S3. Tiền thật ở sổ cái, số dư là view.** Tiền đi/về là giao dịch thường của sổ cái mang cột id đối tác (`transactions.debt_id` / `receivable_id`), ghi bằng `buildEntry` như mọi khoản nhập tay hay gán log. Số dư = Σ dòng `active` ± Σ giao dịch `active` — nên **huỷ giao dịch (ledger UC-102) hay gỡ gán (ingest UC-306) là số dư tự đúng lại**; không có hai bản ghi phải giữ khớp.
- **S4. Đã xong, tổng, thứ tự.** `done = balance ≤ 0` (âm = trả/nhận dư, khoản vẫn hiện ở nhóm đã xong cho tới khi tắt). Tổng của hộ = Σ `max(balance, 0)` các đối tác **đang bật** — dư ở khoản này không bù sang khoản khác. Danh sách xếp: đang bật trước, chưa xong trước, `balance` giảm dần, tên (`listBooks`). `bootstrap` trả `[{ id, name, balance }]` các đối tác đang bật, `balance` giảm dần rồi tên.
- **S5. Sửa / tắt.** `PATCH /v1/<sổ>/:id { name?, note?, active? }` (`updateBook`). Tắt thì không nhận dòng mới, không gắn giao dịch mới (`inactive_<sổ>`), ra khỏi tổng, `bootstrap`, tin sáng. Bật lại được. Không có xoá.
- **S6. Ghi nhớ, không phải tiền.** Dòng sổ không đụng ví, không đụng tài khoản, không vào `v_wallet_flow`, `v_account_book`, "còn để chi" hay dòng thác chia. Số của sổ đối ứng chỉ trả lời "ai nợ ai"; "mình có bao nhiêu tiền" là tiền thật ([UC-1005](UC-1005-xem-buc-tranh-tien-that.md)).
- **S7. Mạng.** Thêm đối tác, ghi dòng, huỷ dòng, sửa/tắt cần mạng (không qua hàng đợi offline); chỉ giao dịch tiền thật nhập tay mới đi qua hàng đợi (pwa UC-704).

## Use cases

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-1001](UC-1001-them-va-xem-khoan-phai-thu.md) | Thêm và xem khoản phải thu | implemented | BR-13, BR-05 |
| [UC-1002](UC-1002-cho-vay-tra-ho.md) | Cho vay / trả hộ | implemented | BR-13, BR-03, BR-04 |
| [UC-1003](UC-1003-nhan-lai-tien.md) | Nhận lại tiền | implemented | BR-13, BR-04, BR-01 |
| [UC-1004](UC-1004-chinh-huy-dong-phai-thu.md) | Chỉnh / huỷ dòng phải thu | implemented | BR-13, BR-04 |
| [UC-1005](UC-1005-xem-buc-tranh-tien-that.md) | Xem bức tranh tiền thật | implemented | BR-13, BR-01, BR-07 |

Entity model: [entities.md](entities.md). Màn PWA: tab **Nợ** ở Ví & quỹ ([pwa/UC-707](../pwa/UC-707-xem-vi-va-quy.md)) — khối tiền thật trên cùng, rồi card "Người khác nợ mình" và "Mình nợ"; Loại khác › Cho vay, Nhận lại tiền cho vay ([pwa/UC-705](../pwa/UC-705-nhap-loai-khac.md)); màn Gán ([pwa/UC-706](../pwa/UC-706-gan-giao-dich-ngan-hang.md)). Tin sáng: dòng 🤝 ([notify/UC-402](../notify/UC-402-tin-sang-0700.md)).

## Code thuộc context này
- `src/services/receivables.ts`: `getReceivables`, `createReceivable`, `updateReceivable`, `addReceivableLine`, `voidReceivableLine` (spec `RECEIVABLES` của `src/services/memo-books.ts`)
- `src/routes/books.ts` › `bookRoutes` (`mount("receivables", "receivable-lines", …)` — mount `/v1`: `/receivables`, `/receivables/:id`, `/receivables/:id/lines`, `/receivable-lines/:id/void`)
- `migrations/0014_receivables.sql`: bảng `receivables`, `receivable_lines`; dựng lại `transactions` (CHECK `meaning` thêm `collect`, cột `receivable_id`, `idx_tx_receivable`); `v_wallet_flow` loại `collect`; view `v_receivable_balance`; trigger `trg_receivable_lines_append_only`, `trg_receivable_lines_no_delete`; `schema_version` `1.14`
- `receivable_id`, `collect`, `LEND_CATEGORY_ID` trong `src/domain/entry.ts` › `buildEntry`; `GET /v1/networth` ([UC-1005](UC-1005-xem-buc-tranh-tien-that.md))
- MCP: `get_receivables`; `collect` + `receivable_id` ở `add_transaction` và split của `assign_log` (`src/mcp/tools.ts`); tin sáng: `src/cron/daily.ts` + `src/notify/format.ts` › `dailyMessage` (`receivables`)
- PWA: `web/src/lib/receivables.ts`, `web/src/lib/networth.ts`, `web/src/lib/memo-books.ts` (dùng chung với sổ nợ); tab Nợ `web/src/screens/debts.tsx`
- Test: `test/receivables.test.ts`, `web/src/lib/receivables.test.ts`, `web/src/lib/networth.test.ts`; khối sổ phải thu trong `test/{logs,mcp,format,schema}.test.ts`

Dùng chung, không sở hữu: `Transaction(lend|collect)` + `buildEntry` (ledger, [UC-101](../ledger/UC-101-nhap-tay-khoan-tien.md)), danh mục `lending` "Cho vay / trả hộ" (ledger, seed `migrations/0002_seed.sql`), gán log (ingest, [UC-305](../ingest/UC-305-gan-log-chua-gan.md)), hàng đợi offline (pwa, UC-704), tin sáng (notify, UC-402), sổ người thuê (rental — số trong bức tranh tiền thật).
