# Bounded context: debt — Sổ nợ

Hộ đang nợ 15.379.000 ₫, có thể của nhiều chủ nợ. Trước đây chỉ có danh mục `debt-payment` "Trả nợ" ghi **đã trả**; không nơi nào biết **còn nợ bao nhiêu**.
Context này giữ **sổ nợ**: sổ phải trả nằm **ngoài sổ cái** — một **sổ đối ứng ngoài sổ cái**, cùng khuôn với sổ người thuê (rental, ADR-58) và sổ phải thu (receivable, ADR-72). Mỗi khoản nợ có các dòng nợ chỉ ghi thêm (mở sổ, vay thêm,
chỉnh tay); tiền trả nợ là một khoản `spend` thật của sổ cái mang `debt_id`, nên huỷ khoản chi đó là số còn nợ tự đúng lại (ADR-71). Context mới, schema v1.13.

**Khuôn chung:** luật thêm đối tác kèm dòng mở sổ, dòng chỉ ghi thêm / huỷ dòng, số dư là view, đã xong / tổng / thứ tự, sửa-tắt, "ghi nhớ không phải tiền" được viết **một lần** ở [receivable/README.md](../receivable/README.md) mục "Sổ đối ứng ngoài sổ cái — luật chung" (S1–S7) và áp nguyên cho sổ nợ; từ v1.14 hai sổ chạy chung service `src/services/memo-books.ts`. Số còn nợ trả lời "ai nợ ai", không phải "mình có bao nhiêu tiền" — tiền thật xem ở [receivable/UC-1005](../receivable/UC-1005-xem-buc-tranh-tien-that.md) (BR-13).

## Ngôn ngữ chung

| Thuật ngữ | Nghĩa trong context này |
|---|---|
| Khoản nợ (`Debt`) | Một món hộ đang nợ một người/nơi (vd "Cô Lan"). Có tên, ghi chú, bật/tắt. Không đăng nhập, không phải `member`, không phải tài khoản hay ví |
| Sổ nợ | Các dòng `debt_lines` của một khoản nợ + các khoản `spend` mang `debt_id`. Chỉ ghi thêm; sai thì huỷ dòng (`void`) hoặc huỷ giao dịch |
| Dòng nợ (`DebtLine`) | Một dòng của sổ nợ, `kind` là một trong ba loại dưới. Không có dòng "trả" |
| Mở sổ (`opening`) | Dòng đầu tiên, ghi khi thêm khoản nợ: số còn nợ lúc bắt đầu theo dõi. Luôn > 0 |
| Vay thêm (`borrow`) | Nợ thêm cùng người đó. Luôn > 0 |
| Chỉnh tay (`adjust`) | Sửa số còn nợ (bớt lãi, cộng lãi, sai số lúc mở sổ). ≠ 0, có dấu: dương = nợ thêm, âm = bớt nợ |
| Trả nợ | Một khoản chi (`spend`) của sổ cái có `transactions.debt_id`; tiền ra thật từ một tài khoản và một ví (thường danh mục `debt-payment`, ví giữ riêng "Thu cho thuê"). Ghi tay ([UC-902](UC-902-tra-no.md)) hoặc gán giao dịch ngân hàng ([UC-903](UC-903-gan-giao-dich-ngan-hang-la-tra-no.md)) |
| Đã vay (`owed`) | Σ dòng nợ `active` |
| Đã trả (`paid`) | Σ khoản `spend` `active` mang `debt_id` của khoản nợ |
| Còn nợ (`balance`) | `owed − paid` (view `v_debt_balance`). Tổng còn nợ của hộ = Σ `max(balance, 0)` các khoản đang bật |
| Đã trả xong (`done`) | `balance ≤ 0`. Âm = trả dư; khoản vẫn còn trong danh sách (nhóm "Đã trả xong") cho tới khi tắt |
| Tắt khoản nợ (`active = false`) | Không trả, không vay thêm được nữa (`inactive_debt`); không vào tổng còn nợ, tin sáng, `bootstrap`. Không có xoá |

## Use cases

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-901](UC-901-them-va-xem-khoan-no.md) | Thêm và xem khoản nợ | implemented | BR-12, BR-05 |
| [UC-902](UC-902-tra-no.md) | Trả nợ: ghi tay, offline, từ ví giữ riêng | implemented | BR-12, BR-03, BR-04 |
| [UC-903](UC-903-gan-giao-dich-ngan-hang-la-tra-no.md) | Gán giao dịch ngân hàng là trả nợ | implemented | BR-12, BR-04 |
| [UC-904](UC-904-vay-them-chinh-huy-dong-no.md) | Vay thêm, chỉnh tay, huỷ dòng nợ | implemented | BR-12, BR-04 |

Entity model: [entities.md](entities.md). Màn PWA: tab **Nợ** ở Ví & quỹ ([pwa/UC-707](../pwa/UC-707-xem-vi-va-quy.md)), sheet **Trả nợ** ([pwa/UC-712](../pwa/UC-712-chuyen-ngan-sach-va-bu.md)). Tin sáng: dòng 💳 ([notify/UC-402](../notify/UC-402-tin-sang-0700.md)).

## Code thuộc context này
- `src/services/debts.ts`: `getDebts`, `createDebt`, `updateDebt`, `addDebtLine`, `voidDebtLine` — mỏng, gọi service sổ đối ứng dùng chung `src/services/memo-books.ts` (spec `DEBTS`; dùng chung với sổ phải thu)
- `src/routes/books.ts` › `bookRoutes` (`mount("debts", "debt-lines", …)` — mount `/v1`: `/debts`, `/debts/:id`, `/debts/:id/lines`, `/debt-lines/:id/void`; cùng một `mount` với sổ phải thu)
- `migrations/0013_debts.sql`: bảng `debts`, `debt_lines`; cột `transactions.debt_id`; view `v_debt_balance`; trigger `trg_debt_lines_append_only`, `trg_debt_lines_no_delete`; `schema_version` `1.13`
- MCP: `get_debts`; `debt_id` ở `add_transaction` và split của `assign_log` (`src/mcp/tools.ts`); tin sáng: `src/cron/daily.ts` + `src/notify/format.ts` › `dailyMessage` (`debts`)
- PWA: `web/src/lib/debts.ts` (bọc `web/src/lib/memo-books.ts` dùng chung với sổ phải thu); tab Nợ `web/src/screens/debts.tsx` (`DebtsTab` — card "Mình nợ", vẽ bằng `BookCard`/`BookDetailSheet`/`BookAddSheet`/`BookLineSheet` của `web/src/screens/memo-book.tsx`; mount ở `web/src/screens/wallets.tsx`); sheet Trả nợ `web/src/screens/budget-sheets.tsx` › `DebtSheet`; ô "Trả nợ cho" ở `web/src/screens/assign.tsx`
- Test: `test/debts.test.ts`, `web/src/lib/debts.test.ts`; khối sổ nợ trong `test/{logs,mcp,format,schema}.test.ts`

Dùng chung, không sở hữu: `Transaction(spend)` + `buildEntry` (ledger, [UC-101](../ledger/UC-101-nhap-tay-khoan-tien.md)), danh mục `debt-payment` và ví giữ riêng "Thu cho thuê" (ledger/rental, ADR-63), gán log (ingest, [UC-305](../ingest/UC-305-gan-log-chua-gan.md)), hàng đợi offline (pwa, UC-704), tin sáng (notify, UC-402).
