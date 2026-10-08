# UC-1005: Xem bức tranh tiền thật
- Status: implemented
- BR: BR-13, BR-01, BR-07
- Decisions: ADR-72 (báo cáo tiền thật trước, ghi nhớ sau — `docs/profit_first_phuong_phap.md` §8); `docs/DESIGN.md` §4 (số hero là số ra quyết định, không bao giờ là tổng tài sản), §5 (tiền); ADR-58, ADR-71 (sổ người thuê, sổ nợ — số của chúng đứng sau tiền thật); ADR-04 (Tích sản một ví hai trạng thái tiền); ADR-77 (heo đất là tiền thật đã khóa — nằm trong `cash`, tách tổng và từng người); ADR-82 (heo đất là Tích sản — `wealthBuildingCash` gồm tiền heo, `wealthBuildingAccounts` là chỗ nó đang nằm); ADR-92 (tên trường và giá trị `role` tiếng Anh)
- Actor: người trong hộ (PWA tab **Nợ** — khối trên cùng, [UC-707](../pwa/UC-707-xem-vi-va-quy.md))
- Trigger: `GET /v1/networth`

## History
- v1 (2026-10-01, commit `2438ac0`): `GET /v1/networth` và khối "Tiền thật đang có" ở đầu tab Nợ (ADR-72).
- v2 (2026-10-03, commit `f74bc70`): thêm `locked` — tài khoản đã khóa (`accounts.locked = 1`, heo đất MB, ADR-77) nằm **trong** `cash` và được tách thành tổng + từng tài khoản kèm chủ; dòng phụ của Tiền thật đang có thêm "Heo đất X đã khóa (Chồng … · Vợ …)" sau phần Tích sản.
- v3 (2026-10-03, commit `e00814c`): **heo đất là Tích sản** (ADR-82) — bỏ heo chuyển ví Có thì tốt → Tích sản nên `tichsanCash` nay gồm tiền đã bỏ heo qua app; `locked` là phần của nó đang nằm ở heo, không cộng thêm. Hình dạng `GET /v1/networth` không đổi. Dòng phụ: heo ≤ Tích sản → "trong đó Tích sản X đã khóa (gồm heo đất H: Chồng … · Vợ …)"; heo > Tích sản (tiền heo có từ trước khi dùng app) → kể riêng như v2.
- v4 (2026-10-06, commit `9c265ee`): change [`261006-tai-khoan-phao`](../changes/archive/261006-tai-khoan-phao/proposal.md), ADR-88 — `locked` đổi thành **`tichsanAccounts`** `{ total, accounts: [{ accountId, name, role, memberId, memberName, balance }] }`: mọi tài khoản Tích sản đang dùng (heo đất, phao dự phòng, sổ tiết kiệm — `accounts.role`), xếp theo `role` rồi `id`. Dòng phụ: "trong đó Tích sản X đã khóa (gồm Y ở tài khoản Tích sản: Heo đất chồng A · Phao dự phòng · MB tiết kiệm (vợ) C)"; nhiều hơn Tích sản → "Tài khoản Tích sản Y (…)". Chủ nhà: "tài khoản phao dự phòng của nhà tôi …". AC-1, AC-5, AC-6 sửa.
- v5 (2026-10-07, commit `7424f26`): đổi tên tiếng Anh (ADR-92, migration 0028): `tichsanCash` → `wealthBuildingCash`, `tichsanAccounts` → `wealthBuildingAccounts`, nguồn snapshot `tiers.tichsan` → `tiers.wealth_building`; `role` của tài khoản Tích sản là `piggy_bank` / `buffer` / `term_deposit` (thứ tự hiển thị cố định heo đất → phao → sổ, rồi `id`); nhãn `wealthBuildingAccountLabel` (`web/src/lib/wealth-building-accounts.ts`). Giá trị không đổi. AC-1, AC-2 (sửa luôn `locked` cũ thành `wealthBuildingAccounts` theo test), AC-5, AC-6 sửa; [OPEN] tool MCP gọi đúng tên `get_reconciliation` (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))

## Preconditions
- Đã đăng nhập. Người xem = người đăng nhập (ẩn số ví `private` của người khác như snapshot — access UC-504).

## Main Flow
1. `GET /v1/networth` → `ledger.netWorth(db, memberId, now)`; chỉ cộng lại các view đã có, không có SQL nghiệp vụ mới:
   - **`cash` — Tiền thật đang có** = Σ `v_account_book.book_balance` mọi tài khoản đang dùng (tiền mặt + tài khoản ngân hàng / ví điện tử + tài khoản đã khóa). Phạm vi "Tiền" của VAS 24 §04 ("tiền tại quỹ, tiền đang chuyển và các khoản tiền gửi không kỳ hạn"), cộng thêm heo đất (sổ tích lũy có kỳ hạn — xem [OPEN]). Chuyển nội bộ giữa hai tài khoản không làm đổi số này (VAS 24 §04: luồng tiền không gồm chuyển dịch nội bộ; ADR-03) — kể cả bỏ heo / rút heo về.
   - `wealthBuildingCash` = snapshot `tiers.wealth_building.cash` (phần tiền thật đã khóa ở Tích sản — **đã nằm trong** `cash`; gồm cả tiền đã bỏ heo qua app vì bỏ heo chuyển ví Có thì tốt → Tích sản, ADR-82); `spendableThisWeek` = snapshot `spendableThisWeek` (UC-103, cũng nằm trong `cash`).
   - `wealthBuildingAccounts` = `{ total, accounts: [{ accountId, name, role, memberId, memberName, balance }] }` — mỗi tài khoản đang dùng có `accounts.role` (`piggy_bank` heo đất, `buffer` phao dự phòng, `term_deposit` sổ tiết kiệm — ADR-77, ADR-88) với `balance` = `v_account_book.book_balance`, chủ (`owner_member_id`) và tên chủ (`members.name`, NULL khi tài khoản chung), xếp heo đất → phao → sổ (`CASE role`) rồi `id`; `total` = Σ `balance`. Là chỗ tiền Tích sản tiền mặt đang nằm (ADR-82, ADR-88) — **đã nằm trong** `cash` và (với tiền chuyển vào qua app) trong `wealthBuildingCash`, không cộng thêm; không theo người xem (tài khoản không ẩn).
   - `assets` = snapshot `tiers.wealth_building.assets` (vàng, CK, CCQ, BĐS). Không phải tiền và **không phải tương đương tiền** theo VAS 24 §04 (tương đương tiền là đầu tư ≤ 3 tháng, dễ đổi thành một lượng tiền xác định, ít rủi ro — giá vàng/CK thì không xác định), nên đứng một dòng riêng, không cộng vào `cash`.
   - `receivables` = Σ `max(balance, 0)` khoản phải thu đang bật; `tenants` = Σ `max(balance, 0)` người thuê đang ở; `tenantsPrepaid` = Σ `max(−balance, 0)` người thuê đang ở; `debts` = Σ `max(balance, 0)` khoản nợ đang bật — bốn số **ghi nhớ** của sổ đối ứng (luật chung S4, S6, [README](README.md)).
   - `netWorth` = `cash + assets + receivables + tenants − debts − tenantsPrepaid`.
2. PWA, đầu tab **Nợ**, trên mọi card (`netWorthLines`), theo đúng thứ tự:
   1. **Tiền thật đang có** — số to nhất (số ra quyết định, `docs/DESIGN.md` §4), gợi ý "tiền mặt và tiền trong tài khoản", dòng phụ theo phần khóa (ADR-82, ADR-88; mỗi tài khoản Tích sản một nhãn `wealthBuildingAccountLabel` — heo "Heo đất {chủ}", phao "Phao dự phòng · {tên}", sổ "Sổ tiết kiệm · {tên}" — rồi số dư; cách nhau " · "):
      - `0 < wealthBuildingAccounts.total ≤ wealthBuildingCash` → "trong đó Tích sản X đã khóa (gồm Y ở tài khoản Tích sản: Heo đất chồng A · Heo đất vợ B · Phao dự phòng · MB tiết kiệm (vợ) C) · còn để chi tuần này Z" — một phần của Tích sản, không kể thêm lần nữa;
      - ngược lại (nhiều hơn Tích sản, vd tiền có từ trước khi dùng app, không nằm trong ví nào) → "trong đó Tích sản X đã khóa, Tài khoản Tích sản Y (…) · còn để chi tuần này Z" — phần Tích sản chỉ khi `wealthBuildingCash > 0`, phần tài khoản Tích sản chỉ khi `wealthBuildingAccounts.total > 0`;
      - không phần khóa nào thì bỏ cả "trong đó …".
   2. **Tài sản (vàng, chứng khoán…)** — "không phải tiền mặt — bán mới thành tiền" (ẩn khi 0).
   3. **Người khác nợ mình** = `receivables + tenants` — "chưa phải tiền"; chi tiết **Cho vay / trả hộ** và **Người thuê còn nợ** (mỗi dòng ẩn khi 0).
   4. **Mình nợ** = −(`debts + tenantsPrepaid`); chỉ khi có người thuê trả trước mới tách chi tiết **Sổ nợ** và **Người thuê trả trước**.
   5. **Tài sản ròng** — nhỏ hơn số hero, đứng cuối, kèm "Cộng hết lại rồi trừ nợ. Con số quan trọng hằng ngày vẫn là tiền thật đang có ở trên."
3. Dưới khối là các card sổ đối ứng ("Người khác nợ mình", "Mình nợ") và câu ghi nhớ của chủ nhà (luật 3, [README](README.md)).

## Alternative Flows
- 1a. Không có khoản phải thu, người thuê hay nợ nào → ba dòng giữa ẩn; còn tiền thật và tài sản ròng (bằng `cash + assets`).
- 1b. Ví `private` của người khác: `cash` vẫn là tổng tài khoản (tài khoản không ẩn), chỉ `spendableThisWeek`/`wealthBuildingCash` theo người xem như snapshot.

## Exceptions
- E1. Không có mạng và chưa có bản lưu → trạng thái lỗi của tab (UC-707 E1); bản cache của service worker → "Số lúc HH:mm".

## Acceptance Criteria

### AC-1: Hộ chưa có gì thì mọi số bằng 0
- Given DB seed, chưa có giao dịch, sổ đối ứng trống
- When `GET /v1/networth`
- Then `{ cash: 0, wealthBuildingCash: 0, wealthBuildingAccounts: { total: 0, accounts: [] }, spendableThisWeek: 0, assets: 0, receivables: 0, tenants: 0, tenantsPrepaid: 0, debts: 0, netWorth: 0 }`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "GET /v1/networth — tiền thật trước, ghi nhớ ai nợ ai sau › chưa có gì: mọi số bằng 0"

### AC-2: Tiền thật = tổng sổ tài khoản đang dùng; ghi nhớ không bao giờ vào tiền thật
- Given tài khoản đã tắt có số dư mở sổ 7.000.000; lương 20.000.000 về VCB đã chia (Tích sản 6.000.000); mua vàng 1.000.000 từ TCB
- When xem `networth`; rồi thêm khoản phải thu 2.000.000, một khoản phải thu đã tắt 9.000.000, khoản nợ 4.000.000, người thuê An còn nợ 3.000.000, Bình trả trước 200.000; rồi `lend` 500.000 từ tiền mặt và `collect` 300.000 về VCB
- Then lúc đầu `cash = 19.000.000`, `wealthBuildingCash = 5.000.000`, `assets = 1.000.000`; sau các dòng ghi nhớ `cash` vẫn 19.000.000; sau tiền đi/về `cash = 18.800.000` (= Σ `v_account_book.book_balance`), `wealthBuildingAccounts = { total: 0, accounts: [] }` (seed không có tài khoản Tích sản), `receivables = 2.200.000` (khoản tắt không tính), `tenants = 3.000.000`, `tenantsPrepaid = 200.000`, `debts = 4.000.000`, `spendableThisWeek` không đổi, `netWorth = 18.800.000 + 1.000.000 + 2.200.000 + 3.000.000 − 4.000.000 − 200.000`
- Tests: [`test/receivables.test.ts`](../../test/receivables.test.ts) › "GET /v1/networth — tiền thật trước, ghi nhớ ai nợ ai sau › tiền thật = Σ số dư sổ tài khoản đang dùng; sổ phải thu / nợ / người thuê không bao giờ vào tiền thật"

### AC-3: Khối tiền thật xếp đúng thứ tự, tiền thật là số hero, tài sản ròng đứng cuối
- Given `networth` đủ mọi nhóm (tiền 50tr, Tích sản khóa 30tr, còn để chi 1,2tr, tài sản 20tr, phải thu 5tr, người thuê nợ 3tr, trả trước 1tr, nợ 15tr)
- When dựng các dòng của khối
- Then thứ tự Tiền thật đang có (hero, duy nhất) → Tài sản → Người khác nợ mình (8tr, "chưa phải tiền") → Cho vay / trả hộ → Người thuê còn nợ → Mình nợ (−16tr) → Sổ nợ → Người thuê trả trước → Tài sản ròng; dòng phụ hero "trong đó Tích sản 30.000.000 ₫ đã khóa · còn để chi tuần này 1.200.000 ₫"
- Tests: [`web/src/lib/networth.test.ts`](../../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › đủ mọi nhóm: tiền thật đầu tiên và là số hero, tài sản ròng cuối cùng và nhỏ hơn, nợ mang dấu âm"; hiển thị: ⚠ Chưa có test

### AC-4: Dòng bằng 0 ẩn, tiền thật và tài sản ròng luôn còn
- Given chỉ có tiền 10tr và nợ 4tr; hoặc mọi số 0; hoặc chỉ người thuê còn nợ
- When dựng các dòng
- Then lần lượt `cash, weOwe, netWorth` (không tách Sổ nợ khi không có người thuê trả trước; dòng phụ chỉ "còn để chi tuần này …"); `cash, netWorth`; `cash, owedToUs, tenants, netWorth`
- Tests: [`web/src/lib/networth.test.ts`](../../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › ẩn dòng bằng 0: không tài sản, không ai nợ, không người thuê trả trước — vẫn giữ tiền thật và tài sản ròng"; [`web/src/lib/networth.test.ts`](../../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › chỉ người thuê còn nợ: nhóm Người khác nợ mình kèm đúng một dòng chi tiết"

### AC-5: Heo đất là tiền Tích sản đã khóa — nằm trong tiền thật và trong Tích sản, tách tổng và từng người, không đếm hai lần (ADR-77, ADR-82)
- Given nhà như prod sau migration 0017 + 0019 + 0020; `mb-main-husband`, `mb-spending-wife` báo cả tiền ra
- When log làm tròn 7.000 ở `mb-main-husband` và 5.000 ở `mb-spending-wife` tự gán sang heo (ingest UC-303, ví Có thì tốt → Tích sản); `netWorth` trước và sau
- Then `wealthBuildingAccounts = { total: 12.000, accounts: [piggy-husband (role piggy_bank, chồng) 7.000, piggy-wife (role piggy_bank, vợ) 5.000, mb-savings-wife (role buffer — phao từ migration 0024, vợ) 0] }`; `wealthBuildingCash` +12.000; `cash` và `netWorth` không đổi so với trước
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "GET /v1/networth: heo đất là tiền Tích sản đã khóa › nằm trong tiền thật và trong Tích sản, tách tổng và từng người — không đếm hai lần"

### AC-6: Dòng phụ của tiền thật nói heo đất là một phần của Tích sản (tổng kèm từng người), không kể thêm lần nữa (ADR-82)
- Given `cash` 3.012.000, `wealthBuildingCash` 1.500.000, `wealthBuildingAccounts` 1.012.000 (heo chồng 7.000, heo vợ 5.000, phao "MB tiết kiệm (vợ)" 1.000.000), còn để chi 100.000; rồi `wealthBuildingCash` 10.000 (< 1.012.000); rồi không có Tích sản khóa; rồi mọi số dư 0
- When dựng các dòng của khối
- Then dòng `cash` giá trị 3.012.000 (không cộng thêm), dòng phụ "trong đó Tích sản 1.500.000 ₫ đã khóa (gồm 1.012.000 ₫ ở tài khoản Tích sản: Heo đất chồng 7.000 ₫ · Heo đất vợ 5.000 ₫ · Phao dự phòng · MB tiết kiệm (vợ) 1.000.000 ₫) · còn để chi tuần này 100.000 ₫"; Tích sản 10.000 → "trong đó Tích sản 10.000 ₫ đã khóa, Tài khoản Tích sản 1.012.000 ₫ (…) · còn để chi tuần này 0 ₫"; không Tích sản → "trong đó Tài khoản Tích sản 1.012.000 ₫ (…) · còn để chi tuần này 0 ₫"; `total = 0` → chỉ "còn để chi tuần này 0 ₫"
- Tests: [`web/src/lib/networth.test.ts`](../../web/src/lib/networth.test.ts) › "khối tiền thật trước (tab Nợ) › heo, phao, sổ tiết kiệm là chỗ tiền Tích sản đang nằm: nói là một phần của Tích sản (tổng kèm từng tài khoản), không kể thêm lần nữa (ADR-82, ADR-88)"; [`test/buffer.test.ts`](../../test/buffer.test.ts) › "chuyển nội bộ vào tài khoản Tích sản (ADR-88) › DB mới: chuyển 1.000.000 vào phao → Tích sản +1.000.000, Tiền chi được −1.000.000 một lần; gửi 800.000 phao → sổ không đổi gì; tất toán 820.000 (20.000 lãi là Thu nhập) → Tích sản về phao" (server `wealthBuildingAccounts`); hiển thị: ⚠ Chưa có test

## Traceability
- Code: `src/routes/v1.ts` › `v1.get("/networth")`; `src/services/ledger.ts` › `netWorth`, `getSnapshot`; `src/domain/snapshot.ts` › `buildSnapshot` (`tiers.wealth_building`, `spendableThisWeek`); `web/src/lib/wealth-building-accounts.ts` › `wealthBuildingAccountLabel`, `ROLE_LABEL`
- PWA: `web/src/lib/networth.ts` › `netWorthLines`, `NetWorthLine`; `web/src/lib/types.ts` › `NetWorth`; `web/src/screens/debts.tsx` › `DebtsTab`, `CashFirst`; tab Nợ ([UC-707](../pwa/UC-707-xem-vi-va-quy.md))
- Migrations/DB: views `v_account_book` (`migrations/0001_schema.sql`), `v_tenant_balance` (`migrations/0007_income_streams_rental.sql`), `v_debt_balance` (`migrations/0013_debts.sql`), `v_receivable_balance` (`migrations/0014_receivables.sql`); `accounts.locked` (`migrations/0017_heo_dat.sql`); `accounts.role` (`migrations/0024_accounts_role.sql`; giá trị `piggy_bank | buffer | term_deposit` từ `migrations/0028_english_names.sql`)

## Divergences & Open Questions
- [OPEN] `cash` gồm `accounts.opening_balance` và mọi tài khoản đang dùng, kể cả tài khoản nối SePay còn log chưa gán: tiền đã về/đi ở ngân hàng mà chưa gán thì chưa có trong `cash` (ledger UC-106 `pending_net`). Khối không nhắc phần chưa gán.
- [OPEN] Không có tool MCP cho bức tranh này: Claude trả lời "nhà có bao nhiêu tiền" phải tự cộng tool `get_reconciliation` (`bookBalance`) — dễ cộng nhầm sổ ghi nhớ vào.
- [OPEN] Heo đất là tiền gửi có kỳ hạn (sổ tích lũy); VAS 24 §04 chỉ coi là tương đương tiền khi kỳ hạn ≤ 3 tháng. App vẫn để nó trong `cash` theo cách nhìn của chủ nhà (gốc chắc chắn, của nhà) và chỉ gắn nhãn "đã khóa" (ADR-77); từ ADR-82 nó còn là Tích sản tiền mặt (`wealthBuildingCash`, phao). Lãi chưa về tài khoản thì không có trong `cash`.
