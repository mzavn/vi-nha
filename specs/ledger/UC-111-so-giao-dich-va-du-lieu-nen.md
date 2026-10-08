# UC-111: Xem sổ giao dịch & tải dữ liệu nền
- Status: implemented
- BR: BR-03, BR-01, BR-09
- Decisions: D12 (dữ liệu nền được PWA cache để nhập offline), D6 (`private` ẩn lịch sự)
- Actor: thành viên (PWA: màn Hôm nay, Nhập — cả điện thoại, Sổ giao dịch, Tích sản, sheet chi tiết giao dịch; khởi động app)
- Trigger: `GET /v1/transactions?limit=&before=&include_void=&month=&meaning=&category_id=&wallet_id=&account_id=&member_id=&source=&q=`, `GET /v1/transactions/summary?<cùng bộ lọc>`, `GET /v1/transactions/:id`, `GET /v1/transactions/link-candidates?meaning=&days=`, `GET /v1/bootstrap`

## History
- v1 (2026-09-22, commit `b92fc0f`): `listTransactions`, `/v1/bootstrap` (ví, danh mục, tài khoản kèm `sepayEnabled`, thành viên, tần suất danh mục 30 ngày).
- v2 (2026-09-22, commit `b8e8f0c`): API không đổi; PWA bắt đầu dùng `sepayEnabled` để chỉ đưa tài khoản ghi tay vào ô chọn khi nhập (D14, `web/src/lib/categories.ts`).
- v3 (2026-10-01, commit `25db5b9`): `/v1/bootstrap` thêm `debts: [{ id, name, balance }]` — khoản nợ đang bật, còn nợ giảm dần rồi tên — để PWA chọn khoản nợ khi trả nợ, kể cả offline (debt [UC-901](../debt/UC-901-them-va-xem-khoan-no.md) AC-5, ADR-71).
- v4 (2026-10-01, commit `2438ac0`): `/v1/bootstrap` thêm `receivables: [{ id, name, balance }]` — khoản phải thu đang bật, còn phải thu giảm dần rồi tên — để Loại khác và màn Gán chọn khoản khi cho vay / nhận lại tiền, kể cả offline (receivable [UC-1001](../receivable/UC-1001-them-va-xem-khoan-phai-thu.md) AC-4, ADR-72).
- v5 (2026-10-01, commit `49f8bce`): con trỏ `before` phân trang theo cặp (`at`, `id`) — đúng thứ tự sắp, khoản nhập lùi ngày không còn bị bỏ sót / lặp giữa các trang; mỗi dòng thêm `debt_name`, `receivable_name`, `tenant_name`, `allocated`; thêm `GET /v1/transactions/:id` trả đúng một dòng cùng dạng — để sheet chi tiết giao dịch mở được từ mọi danh sách (pwa [UC-715](../pwa/UC-715-xem-sua-xoa-giao-dich.md), ADR-73). Màn Nhập trên điện thoại hiện "Giao dịch gần đây" có nút Xem thêm (pwa UC-703).
- v6 (2026-10-01, commit `2cfeb0a`): `GET /v1/transactions` **ẩn khoản đã xoá** (`status='void'`) theo mặc định; `include_void=1` để xem lại. Khoản đã xoá vẫn nằm trong sổ (luật ghi thêm, ADR-02) và vẫn mở được bằng `GET /v1/transactions/:id`. Chủ nhà hỏi xoá cứng — không làm, xem ADR-73 Consequences.
- v7 (2026-10-03, commit `c67420e`): API không đổi. PWA "Giao dịch gần đây" thôi Xem thêm, chia trang thật: đọc `limit = cỡ trang + 1` (5–100, dòng thừa chỉ để biết còn trang sau — dưới trần 200), trang sau `before=<id dòng cuối trang đang xem>`, trang trước dùng lại con trỏ đã giữ trong máy (pwa [UC-703](../pwa/UC-703-nhap-nhanh-khoan-chi.md) AC-13).
- v8 (2026-10-04, commit `c9c6acb`): change [`261004-gan-tham-chieu`](../changes/archive/261004-gan-tham-chieu/proposal.md) — `GET /v1/transactions/refund-candidates?days=N` (bước 4): khoản chi còn hiệu lực N ngày gần nhất kèm nội dung ngân hàng, cho ô "Trả lại cho khoản chi" (pwa UC-705, UC-706). Một endpoint riêng thay vì lọc `GET /v1/transactions` phía máy: sổ chỉ trả tối đa 200 dòng mọi loại mỗi trang (30 ngày có thể cần nhiều trang) và không có nội dung ngân hàng của log.
- v9 (2026-10-05, commit `d7992d1`): change [`261005-lien-ket-khoan-goc`](../changes/archive/261005-lien-ket-khoan-goc/proposal.md) — `GET /v1/transactions/refund-candidates` thay bằng **`GET /v1/transactions/link-candidates?meaning=spend|lend&days=N`** (bước 4; `days` 1..366; mỗi dòng thêm `receivable_id`, `receivable_name`) — PWA chuyển hẳn, route cũ bỏ. `GET /v1/transactions/:id` thêm **`linked_from`** (các khoản hoàn tiền / nhận lại còn hiệu lực trỏ về khoản này) và **`link`** (tóm tắt khoản gốc của khoản hoàn tiền / nhận lại có `link_id`) — cùng một batch, PWA không gọi thêm (pwa UC-715 bước 2b).
- v10 (2026-10-06, commit `43e4699`): change [`261006-so-giao-dich`](../changes/archive/261006-so-giao-dich/proposal.md) — `GET /v1/transactions` nhận bộ lọc tuỳ chọn `month`, `meaning` (nhiều, phẩy), `category_id`, `wallet_id` (ví được cộng hoặc bị trừ), `account_id` (tiền ra hoặc vào), `member_id`, `source=manual|bank`, `q` (≥ 2 ký tự; khớp cả dạng bỏ dấu của chữ tìm — "thuốc" ra nội dung ngân hàng "THUOC"); thêm **`GET /v1/transactions/summary`** cùng bộ lọc → tổng theo loại, một truy vấn GROUP BY, chỉ khoản còn hiệu lực. Một hàm dựng WHERE (`txWhere`) cho cả hai. `limit`, `before`, `include_void` giữ nguyên. Cho màn Sổ giao dịch (pwa [UC-716](../pwa/UC-716-so-giao-dich.md)). Không thêm index: đo `EXPLAIN QUERY PLAN` trên 6.000 khoản, lọc tháng đi qua `idx_tx_cat (category_id, month_key) WHERE status='active'` (dò bỏ cột đầu), danh sách / tổng một tháng < 1 ms, cả sổ ~1–3 ms.

## Preconditions
- Đã xác thực; `memberId` của request.

## Main Flow — sổ giao dịch
1. Route kiểm `limit` (mặc định 50) và `before` (tuỳ chọn) là số nguyên; sai → `invalid_input`. Bộ lọc (`txFilter`, dùng chung cho danh sách và tổng; tham số rỗng coi như không có):
   - `month` dạng `YYYY-MM` (tháng 01–12), so với `month_key`;
   - `meaning` một hoặc nhiều loại cách nhau bằng phẩy, trong `spend, income, refund, transfer, lend, collect, buy_asset, adjust` (`BOOK_MEANINGS` — không có `fund`);
   - `category_id`, `wallet_id` (khớp `wallet_id` **hoặc** `counter_wallet_id`), `account_id` (khớp `account_id` **hoặc** `counter_account_id`), `member_id` (`by_member_id`): mã 1–64 ký tự chữ, số, `_ . -`;
   - `source`: `bank` = `source='sepay'` hoặc có `log_id`; `manual` = `source='manual'` và không có `log_id` (bút toán hệ thống không thuộc nguồn nào);
   - `q`: cắt khoảng trắng, 2–100 ký tự; khớp `LIKE '%q%'` **hoặc** `LIKE` dạng bỏ dấu, viết hoa của `q` (`normalizeContent`, `src/domain/rules.ts` — cùng hàm chuẩn hoá nội dung ngân hàng khi so mẫu tự gán), trên ghi chú, tên danh mục, tên khoản nợ, tên khoản phải thu, tên người thuê, nội dung log ngân hàng (`log_id` hoặc `log_id_2`). `LIKE` của SQLite không phân biệt hoa thường chỉ với chữ không dấu, nên "thuốc" khớp "Thuốc ho" (chữ đã lưu) và "chuyen tien THUOC" (dạng bỏ dấu); "THUỐC" chỉ khớp qua dạng bỏ dấu; "thuoc" không khớp chữ có dấu đã lưu. `%`, `_`, `\` người gõ là chữ thường;
   - `include_void=1` để thấy cả khoản đã xoá.
2. Trả tối đa `limit` giao dịch (kẹp 1..200) khớp bộ lọc, **trừ** `meaning='fund'`, mặc định chỉ `active`, sắp `at` giảm dần rồi `id` giảm dần; có `before` thì chỉ các dòng đứng **sau** dòng `before` theo đúng thứ tự đó (`(at, id) < (at, id)` của dòng `before`). Mỗi dòng (`TX_VIEW`) là mọi cột của `transactions` kèm `category_name`, `wallet_name` (tên ví được cộng, không có thì ví bị trừ), `debt_name`, `receivable_name`, `tenant_name` và `allocated` (1 nếu khoản thu đã có lần chia, 0 nếu không).
   - **Tổng**: `GET /v1/transactions/summary` (route đăng ký trước `/transactions/:id`; cùng bộ lọc, không `limit` / `before`; `include_void` không có tác dụng — khoản đã xoá không tính vào số nào) → `{ count, spend, refund, income, lend, collect, transfer, buy_asset, adjust_in, adjust_out }` (`transactionSummary`): một truy vấn `GROUP BY` loại, `adjust` tách theo chiều (`counter_account_id` có → `adjust_in`, tiền thật nhiều hơn sổ; không → `adjust_out`); loại không có dòng → 0. Ví riêng tư của người kia không ẩn gì (như danh sách — [OPEN] dưới).
3. `GET /v1/transactions/:id` trả đúng một dòng cùng dạng (kể cả `fund`, kể cả dòng đã huỷ); không có → `not_found` 404. Dòng kèm liên kết hai chiều (`transactionView`, một `db.batch` ba câu):
   - `linked_from: [{ id, at, amount, meaning }]` — các khoản `active`, `meaning ∈ {refund, collect}` có `link_id` = id này, cũ trước (`at`, rồi `id`); rỗng nếu không có. Bút toán `fund` của lần chia cũng mang `link_id` về khoản thu nhưng không phải khoản trả về nên không có ở đây.
   - `link: { id, at, amount, meaning, status, category_name, receivable_name } | null` — khoản gốc của dòng này khi dòng là `refund` / `collect` có `link_id` (kể cả khi khoản gốc đã huỷ — `status`); dòng khác → `null`.
4. `GET /v1/transactions/link-candidates?meaning=spend|lend&days=N` (`meaning` bắt buộc, sai → `invalid_input` 400 "meaning phải là spend hoặc lend."; `days` nguyên 1..366, mặc định 30, sai → `invalid_input` 400 "days phải là số nguyên 1–366."; route đăng ký trước `/transactions/:id`): khoản `meaning` đó, `active`, có `at` ≥ lúc gọi − N ngày, mới nhất trước (`at`, rồi `id`), tối đa 500 dòng; mỗi dòng `{ id, at, amount, category_id, category_name, wallet_id (= counter_wallet_id — ví khoản chi đã trừ; khoản cho vay: null), wallet_name, receivable_id, receivable_name (người vay; khoản chi: null), note, bank_content (nội dung log ngân hàng nếu khoản gốc đến từ gán log, không thì null) }` (`linkCandidates`). Không xếp theo số tiền: PWA tự xếp theo số đang gõ và người đang chọn (pwa UC-706 bước 5d, 5e), một lần tải. PWA hỏi `spend` 30 ngày, `lend` 180 ngày.

## Main Flow — dữ liệu nền
1. Trả `member` (người đang dùng hoặc `null`), `members` (active, owner trước), `wallets` (active, theo `sort`, mỗi ví thêm `hidden = private && member_id ≠ người xem`), `categories` (active), `accounts` (active, có `kind`, `ownerMemberId`, `sepayEnabled`), `debts` (khoản nợ đang bật `{ id, name, balance }` từ `v_debt_balance`, còn nợ giảm dần rồi tên — có thể gồm khoản đã trả xong), `receivables` (khoản phải thu đang bật `{ id, name, balance }` từ `v_receivable_balance`, cùng thứ tự — có thể gồm khoản đã trả đủ), `categoryUsage` (số khoản `spend` active theo danh mục trong 30 ngày tính tới lúc gọi).
2. PWA cache dữ liệu này để nhập được khi mất mạng (pwa context).

## Alternative Flows
- 2a. `before` là id của dòng cuối trang trước; id không tồn tại → trang rỗng.

## Exceptions
- E1. `limit`/`before` không phải số nguyên → `invalid_input` 400 "limit / before phải là số nguyên."
- E2. Bộ lọc sai (cả danh sách lẫn tổng) → `invalid_input` 400: "month phải có dạng YYYY-MM."; "meaning phải là một hoặc nhiều trong: spend, income, refund, transfer, lend, collect, buy_asset, adjust."; "source phải là manual hoặc bank."; "{category_id|wallet_id|account_id|member_id} không hợp lệ."; "Từ tìm phải có ít nhất 2 ký tự."; "Từ tìm dài quá 100 ký tự."

## Acceptance Criteria
### AC-1: Sổ không lộ bút toán nạp ví; khoản đã xoá ẩn mặc định, xem lại được
- Given một `spend` còn hiệu lực và một `spend` đã xoá
- When `GET /v1/transactions?limit=10`, rồi `?limit=10&include_void=1`, rồi `GET /v1/transactions/<id đã xoá>`
- Then lần 1 chỉ có khoản còn hiệu lực; lần 2 có cả hai; lần 3 trả khoản đã xoá với `status: "void"`. Không bao giờ có dòng `fund`.
- Tests: `test/api.test.ts` › "sổ giao dịch (UC-111) › khoản đã xoá ẩn khỏi sổ mặc định, vẫn còn trong sổ và xem lại được bằng include_void=1"

### AC-2: Giới hạn số dòng
- Given > 200 giao dịch
- When `GET /v1/transactions?limit=1000`
- Then trả đúng 200 dòng
- Tests: ⚠ Chưa có test

### AC-3: Bootstrap đánh dấu ví riêng tư của người khác
- Given ví `private` của `husband`
- When `wife` gọi `/v1/bootstrap`
- Then ví đó có `hidden: true`; với `husband` là `false`
- Tests: ⚠ Chưa có test

### AC-4: Bootstrap cho biết tài khoản nào có feed
- Given `vcb-husband` `sepay_enabled=1`, `cash-husband` `0`
- When gọi `/v1/bootstrap`
- Then `accounts` có `sepayEnabled` tương ứng `true`/`false`
- Tests: ⚠ Chưa có test

### AC-5: Trang sau theo đúng thứ tự sắp — khoản nhập lùi ngày không bị bỏ sót hay lặp
- Given bốn khoản chi ngày 20/9, 22/9, 21/9 (nhập sau khoản 22/9), 19/9
- When `GET /v1/transactions?limit=2`, rồi `?limit=2&before=<id dòng cuối trang 1>`
- Then trang 1 là 22/9, 21/9; trang 2 là 20/9, 19/9
- Tests: `test/api.test.ts` › "sổ giao dịch (UC-111) › trang sau theo (ngày, id): khoản nhập lùi ngày không bị bỏ sót hay lặp"

### AC-6: Mở một giao dịch theo id
- Given một `income` đã chia và một khoản trả nợ gắn `co-mai`
- When `GET /v1/transactions/:id` cho từng khoản, và cho một id không có
- Then khoản thu có `allocated: 1`; khoản trả nợ có `allocated: 0`, `debt_name: "Cô Mai"`, `category_name: "Trả nợ"`, `source: "manual"`; id không có → 404
- Tests: `test/api.test.ts` › "sổ giao dịch (UC-111) › mở một giao dịch theo id: cùng hình dạng dòng sổ, kèm cờ đã chia và tên sổ đối ứng"

### AC-7: Khoản chi để nối hoàn tiền: còn hiệu lực, trong N ngày, kèm nội dung ngân hàng
- Given lúc gọi 2026-10-04; khoản chi y tế 100.000 ngày 1/9, 244.000 ngày 3/10 (gán từ log "NHA THUOC LONG CHAU"), 80.000 ngày 2/10 đã xoá; khoản thu 500.000 ngày 3/10
- When `GET /v1/transactions/link-candidates?meaning=spend&days=30`; rồi `days=0`
- Then đúng một dòng: khoản 244.000 với `category_name`, `wallet_id = nice-to-have`, `receivable_id = null`, `bank_content = "NHA THUOC LONG CHAU"` (khoản quá 30 ngày, khoản đã xoá, khoản thu không có); `days=0` → 400 `invalid_input`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu) › GET /v1/transactions/link-candidates?meaning=spend: khoản chi còn hiệu lực 30 ngày gần nhất, mới nhất trước, kèm danh mục, ví đã trừ, nội dung ngân hàng"

### AC-8: Khoản cho vay để nối khoản nhận lại: còn hiệu lực, trong N ngày, kèm người vay
- Given lúc gọi 2026-10-05; Chị Lan; cho vay 300.000 ngày 1/3 và 1.000.000 ngày 1/6 (ghi chú "mượn sửa xe", log "CK CHI LAN") gắn Chị Lan; cho vay 50.000 ngày 1/10 đã huỷ; một khoản chi ngày 4/10
- When `GET /v1/transactions/link-candidates?meaning=lend&days=180`; rồi không gửi `meaning`, `meaning=income`, `days=400`
- Then đúng một dòng: khoản 1.000.000 với `receivable_id`/`receivable_name = "Chị Lan"`, `category_id = lending`, `wallet_id = null`, `note`, `bank_content = "CK CHI LAN"`; ba lần sau 400 `invalid_input`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › GET /v1/transactions/link-candidates?meaning=lend: khoản cho vay còn hiệu lực trong số ngày hỏi, mới nhất trước, kèm người vay; meaning hay days sai → invalid_input"

### AC-9: Mở một giao dịch thấy liên kết hai chiều
- Given khoản chi 244.000 ngày 4/10 có hoàn 250.000 ngày 5/10 nối về nó; cho vay 1.000.000 Chị Lan có nhận lại 600.000 nối về nó; một khoản thu đã chia
- When `GET /v1/transactions/:id` cho từng khoản; rồi gỡ gán khoản nhận lại và mở lại khoản cho vay
- Then khoản chi có `linked_from = [{ id: hoàn, amount: 250000, meaning: "refund" }]`, `link = null`; khoản hoàn có `link = { id: khoản chi, amount: 244000, meaning: "spend", status: "active", category_name: "Y tế (khám, thuốc, TPCN)", receivable_name: null }`, `linked_from = []`; khoản cho vay có `linked_from` là khoản nhận lại 600.000 (`collect`), khoản nhận lại có `link` về khoản cho vay với `receivable_name: "Chị Lan"`; khoản thu có `linked_from = []` (không lẫn bút toán nạp ví); sau gỡ gán, khoản cho vay có `linked_from = []`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › GET /v1/transactions/:id: khoản gốc kèm các khoản còn hiệu lực đã trả về nó (linked_from), khoản trả về kèm tóm tắt khoản gốc (link)"

### AC-10: Lọc theo tháng, loại, danh mục, ví, tài khoản, người, nguồn; tổng cùng bộ lọc
- Given khoản chi y tế 120.000 (5/9, tiền mặt chồng), 80.000 (20/9, tiền mặt vợ, vợ ghi), 50.000 (30/8); chi đi chợ 300.000 (10/9); hoàn tiền y tế 20.000 về Có thì tốt (21/9); chi y tế 999.000 (15/9) đã xoá; chi Mua sắm 450.000 từ ngân hàng (12/9)
- When `?month=2026-09&meaning=spend&category_id=health`, thêm `refund`, thêm `include_void=1`; `wallet_id`, `account_id`, `member_id`, `source`; trang sau với `before`; cùng bộ lọc ở `/summary`
- Then đúng [80.000, 120.000], `summary` `count: 2, spend: 200000`; thêm hoàn tiền: 3 dòng, `refund: 20000`; `include_void=1` có khoản đã xoá trong danh sách nhưng `summary.spend` vẫn 200.000; `wallet_id=nice-to-have` gồm cả khoản hoàn (ví được cộng) lẫn khoản chi (ví bị trừ); `source=bank` chỉ khoản ngân hàng, `manual` mọi khoản ghi tay; `before` giữ bộ lọc
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › lọc tháng 9 + Chi tiêu + một danh mục: đúng các khoản, tổng chi đúng; các bộ lọc khác khớp đúng cột"

### AC-11: Tìm chữ trên ghi chú, nội dung ngân hàng, tên danh mục, tên người
- Given khoản chi ghi chú "áo Shopee cho bé"; khoản chi từ log "SHOPEEPAY 12345"; khoản chi đi chợ; cho vay Chị Lan
- When `q=shopee`, `q=nấu ăn`, `q=Lan`, `q=50%`, `/summary?q=shopee`, `q=a`
- Then hai khoản Shopee (log trước, mới hơn); khoản danh mục "Đi chợ / nấu ăn"; khoản cho vay; rỗng; `count: 2, spend: 249000`; 400 "Từ tìm phải có ít nhất 2 ký tự."
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tìm chữ: ghi chú, nội dung ngân hàng, tên danh mục, tên người; ít hơn 2 ký tự thì báo sai"

### AC-12: Tổng theo loại, điều chỉnh tách hai chiều, không có nạp ví
- Given tháng 9: chi 500.000, hoàn 50.000, thu 3.000.000 đã chia (có bút toán `fund`), cho vay 400.000, nhận lại 100.000, chuyển nội bộ 700.000, mua tài sản 500.000, điều chỉnh +30.000 và −12.000
- When `/summary?month=2026-09`, `/v1/transactions?month=2026-09`, `/summary?month=2026-08`
- Then `{ count: 9, spend: 500000, refund: 50000, income: 3000000, lend: 400000, collect: 100000, transfer: 700000, buy_asset: 500000, adjust_in: 30000, adjust_out: 12000 }`; danh sách 9 dòng (không `fund`); tháng 8 mọi số 0
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tổng theo nghĩa tiền thật: chi, hoàn, thu, cho vay / nhận lại, chuyển nội bộ, mua tài sản, điều chỉnh hai chiều"

### AC-13: Tham số sai → invalid_input nói rõ tham số nào
- Given bất kỳ
- When `month=2026-9`, `/summary?month=2026-13`, `meaning=spend,fund`, `source=sepay`, `wallet_id=a b`, `q="  x "`, `q` 101 ký tự, `limit=abc`
- Then 400 `invalid_input` với đúng câu ở E1/E2
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tham số sai định dạng → invalid_input, nói rõ tham số nào"

### AC-14: Tìm có dấu khớp cả nội dung ngân hàng không dấu
- Given khoản chi từ log "chuyen tien thuoc cho me"; khoản chi ghi chú "Thuốc ho cho bé"
- When `q=thuốc`, `q=THUỐC`, `q=thuoc`
- Then cả hai khoản; chỉ khoản ngân hàng (qua dạng bỏ dấu); chỉ khoản ngân hàng (ghi chú có dấu cần cột chuẩn hoá — [OPEN])
- Tests: [`test/api.test.ts`](../../test/api.test.ts) › "sổ giao dịch (UC-111) › lọc và tổng (change 261006-so-giao-dich) › tìm có dấu cũng khớp nội dung ngân hàng không dấu; tìm không dấu chưa khớp chữ có dấu đã lưu"

## Traceability
- Code: `src/routes/v1.ts` › `txFilter`, `GET /transactions`, `GET /transactions/summary`, `GET /transactions/link-candidates`, `GET /transactions/:id`, `GET /bootstrap`; `src/services/ledger.ts` › `TX_FROM`, `TX_VIEW`, `BOOK_MEANINGS`, `TxFilter`, `txWhere`, `listTransactions`, `TxSummary`, `transactionSummary`, `linkCandidates`, `transactionView`, `loadRefs` (`debts`, `receivables`), `categoryUsage`
- Migrations/DB: `idx_tx_at` (`migrations/0001_schema.sql`); lọc tháng dùng `idx_tx_cat` (cùng file) — không có index riêng cho `month_key` (đo ở v10)
- PWA: `web/src/screens/today-desktop.tsx` › `RecentTransactions` (Hôm nay, màn Nhập; chia trang theo `before`, `limit` = cỡ trang + 1 — `web/src/lib/tx-paging.ts`), `web/src/screens/ledger-book.tsx` › `LedgerBook` (Sổ giao dịch: bộ lọc, `/summary`, tải thêm theo `before` — `web/src/lib/tx-filter.ts`), `web/src/screens/tx-sheet.tsx` (`GET /v1/transactions/:id`, `linked_from`, `link`), `web/src/screens/ref-pickers.tsx` › `LinkSourcePicker` (`GET /v1/transactions/link-candidates`, `web/src/lib/refunds.ts` › `linkCandidatesPath`), `web/src/state/store.ts` (cache bootstrap).

## Divergences & Open Questions
- [OPEN] Sổ giao dịch (cả danh sách lẫn `/summary`) không ẩn gì theo `private`: `wallet_name`, số tiền của giao dịch trên ví riêng tư người khác vẫn trả về đầy đủ (D6 coi `private` chỉ là ẩn lịch sự).
- [OPEN] `q` khớp chữ đã lưu và dạng bỏ dấu của **chữ tìm**, chưa có dạng bỏ dấu của **chữ đã lưu**: "thuoc" không ra ghi chú / tên danh mục "Thuốc …", "THUỐC" không ra "Thuốc" (LIKE không bỏ qua hoa thường với chữ có dấu). Chiều này cần cột chuẩn hoá (migration) — chưa ai cần.
- [OPEN] Sổ gồm cả `transfer` hệ thống (chốt tháng `S…`, quyết toán `T…`) và `adjust` — chỉ `fund` bị lọc.
