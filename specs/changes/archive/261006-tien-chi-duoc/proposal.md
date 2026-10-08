# 261006-tien-chi-duoc: Tiền chi được — tiền thật trong các tài khoản đang tính, trừ Tích sản và Thuế còn giữ
- Status: archived
- BR: BR-01, BR-07, BR-04
- Đụng tới: UC-103 (ledger — snapshot), UC-506 (access — cấu hình tài khoản), UC-702 (pwa — Hôm nay), UC-709 (pwa — sheet tài khoản ở Cài đặt)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà (đã chọn hướng: chọn từng tài khoản · trừ Tích sản + Thuế còn giữ · tách thành một section báo cáo) · Người duyệt kỹ thuật: —

## Vì sao
Chủ nhà, 2026-10-06: "tôi muốn nhìn ngay ở trang chủ vào là tôi còn lại thực tế là bao nhiêu tiền có thể chi tiêu (dựa trên tiền thật của các tài khoản của tôi nhé), không nói dựa trên tổng tài sản".

Hôm nay chỉ có hai con số: hero "Còn để chi tuần này" (tổng phong bì — số ngân sách, không phải tiền nằm trong tài khoản) và ba số phụ ví (Đã khóa / Tài sản / Chờ đầu tư). "Tiền thật đang có" (`GET /v1/networth` › `cash`) chỉ có ở tab Nợ và là tổng mọi tài khoản — gồm cả heo đất, Tích sản, Thuế, cả tài khoản tiết kiệm không định tiêu. Không chỗ nào trả lời "trong tài khoản của tôi có bao nhiêu tiền tiêu được thật".

Ba câu trả lời của chủ nhà:
1. Tài khoản nào tính → **chọn từng tài khoản** (công tắc mỗi tài khoản).
2. Phần phải giữ → **trừ Tích sản + Thuế còn giữ**.
3. Chỗ đặt → **tách thành 1 section báo cáo** ở Hôm nay, không thay hero "Còn để chi tuần này".

## Thay đổi spec

### Định nghĩa (ADR-85)

```
Tiền chi được = Σ số dư sổ của tài khoản đang tính
              − Tích sản đang giữ
              − Thuế đang giữ

tài khoản đang tính  = accounts.active = 1 AND locked = 0 AND spendable = 1
Tích sản đang giữ    = max(0, tichsanCash − max(0, heo))      — heo = Σ số dư sổ tài khoản locked = 1
Thuế đang giữ        = max(0, tiers.tax.balance)
```

- Số dư là **số dư sổ** (`v_account_book.book_balance`) — sổ là nguồn sự thật, cùng số với "Tiền thật đang có". Không dùng số ngân hàng báo.
- `tichsanCash` = `v_tichsan.cash` (phần tiền của ví Tích sản, đã trừ phần đã thành tài sản) = `snapshot.tiers.tichsan.cash` = `netWorth.tichsanCash`.
- **Heo đất không bao giờ tính** (tài khoản `locked = 1`, ADR-77) và theo ADR-82 tiền heo **là tiền Tích sản** đã nằm ngoài các tài khoản đang tính → phần Tích sản nằm ở heo không trừ lần nữa. Heo nhiều hơn Tích sản (tiền heo có từ trước khi dùng app) → không trừ gì cho Tích sản, phần dư của heo vẫn không tính. Cùng luật "không đếm hai lần" với khối tiền thật ở tab Nợ (`netWorthLines`).
- Thuế: tổng số dư các ví phe `tax` mà người xem thấy (như hàng Thuế ở Dòng thác).
- Âm được phép: tiền trong các tài khoản đang tính ít hơn phần phải giữ → app nói "thiếu X ₫".

**Ví dụ (số giả định, nhà như prod):**

| Dòng | Số |
|---|---|
| MB chồng (đang tính) | 3.200.000 |
| MB chi tiêu vợ (đang tính) | 230.000 |
| Tiền mặt (đang tính) | 500.000 |
| Thẻ tín dụng (không tính — mặc định tắt) | −1.500.000 |
| Heo đất MB (chồng) + Heo đất MB (vợ) (khóa, không tính) | 5.000 + 50.000 = 55.000 |
| Tích sản (`tichsanCash`) | 55.000 (toàn bộ đang ở heo) + 2.000.000 (lương chia vào) = 2.055.000 |
| Thuế | 600.000 |

Tiền chi được = (3.200.000 + 230.000 + 500.000) − max(0, 2.055.000 − 55.000) − 600.000 = 3.930.000 − 2.000.000 − 600.000 = **1.330.000 ₫**.

Prod hôm nay: Tích sản 55.000 ₫ là 9.000 ₫ chuyển từ ví "Heo đất" cũ (3/10) + 41.000 ₫ heo vợ + 5.000 ₫ heo chồng — toàn bộ là tiền heo. Nếu số dư sổ hai con heo cộng lại ≥ 55.000 thì "Tích sản đang giữ" = 0 và dòng không hiện; tiền chi được = tổng các tài khoản đang tính − Thuế.

### UC-103 (ledger — snapshot)
- Main Flow: batch đọc thêm số dư sổ từng tài khoản đang dùng (`v_account_book` JOIN `accounts`: `locked`, `spendable`); `buildSnapshot` trả thêm
  `spendableCash: { amount, accounts: [{accountId, name, balance}], tichsanHeld, tichsanInLocked, taxHeld, excluded: [{accountId, name, locked}] }` — `accounts` là các tài khoản đang tính (theo `kind`, `name`), `excluded` là tài khoản đang dùng không tính, `tichsanInLocked = min(max(0, heo), max(0, tichsanCash))` (phần Tích sản đang ở heo, không trừ lại). Hàm thuần `spendableCash` ở `src/domain/snapshot.ts`.
- ADDED AC-12: Given đã chia khoản thu 10.000.000 có tính thuế (Tích sản 3.000.000, Thuế 1.000.000) vào `tien-mat-em`, `tien-mat-anh` số dư đầu 500.000 When `GET /v1/snapshot` Then `spendableCash.amount = 10.500.000 − 3.000.000 − 1.000.000 = 6.500.000`, `tichsanHeld = 3.000.000`, `taxHeld = 1.000.000`, `accounts` có `tien-mat-em` 10.000.000 và `tien-mat-anh` 500.000.
- ADDED AC-13: Given như AC-12 When tắt "Tính vào tiền chi được" của `tien-mat-anh` Then `amount` giảm đúng 500.000, `tien-mat-anh` chuyển từ `accounts` sang `excluded`; bật lại thì như cũ.
- ADDED AC-14: Given heo đất (khóa) nhận 12.000 qua bỏ heo (Có thì tốt → Tích sản, ADR-82) When dựng snapshot Then heo nằm ở `excluded` với `locked: true`, `tichsanInLocked` tăng 12.000, `tichsanHeld` **không** tăng; tiền chi được giảm đúng 12.000 (tiền rời tài khoản chi tiêu), không phải 24.000.
- ADDED AC-15 (hàm thuần): heo nhiều hơn Tích sản → `tichsanHeld = 0`; Tích sản / Thuế âm không cộng ngược vào tiền chi được; không có tài khoản nào đang tính → `amount = −(Tích sản + Thuế đang giữ)`.

### UC-506 (access — cấu hình tài khoản)
- Main Flow: tài khoản có thêm `spendable` (0/1) — "Tính vào tiền chi được". `POST /v1/settings/accounts`: không gửi thì mặc định **bật**, trừ thẻ tín dụng (`kind='credit'`) mặc định **tắt** (số dư thẻ là nợ phải trả, không phải tiền để tiêu). `PATCH` đổi được. Danh sách cài đặt trả thêm `locked`, `spendable`.
- Exceptions: bật `spendable` cho tài khoản `locked = 1` (heo đất) → 400 `locked_account` "Heo đất đã khóa, không tính vào tiền chi được.".
- ADDED AC-15: Given tạo tài khoản ngân hàng và thẻ tín dụng không gửi `spendable` Then ngân hàng `spendable: true`, thẻ `spendable: false`; gửi `spendable: true` cho thẻ thì bật được.
- ADDED AC-16: Given heo đất (`locked = 1`) When `PATCH { spendable: true }` Then 400 `locked_account`, cột không đổi; `PATCH { spendable: false }` hoặc sửa tên vẫn được.

### UC-709 (pwa — Cài đặt › Tài khoản)
- Sheet tài khoản có ô **"Tính vào tiền chi được"** kèm lời dặn: "Số dư của tài khoản này cộng vào “Tiền chi được” ở Hôm nay. Tài khoản đang giữ tiền Tích sản / Thuế cứ để bật — app đã trừ phần Tích sản và Thuế. Tắt cho tiền không định tiêu và không thuộc ví nào (tiết kiệm ngoài app, thẻ tín dụng)." Heo đất: ô tắt, không bấm được, lời dặn "Heo đất đã khóa — không bao giờ tính vào tiền chi được." Thêm tài khoản: đổi loại sang Thẻ tín dụng thì ô tự tắt, loại khác thì bật (`spendableDefault`).
- ADDED AC-25: `accountPayload` gửi `spendable` theo ô; heo đất không bao giờ gửi `spendable: true`; thêm tài khoản thẻ tín dụng mặc định tắt.

### UC-702 (pwa — Hôm nay)
- Main Flow bước 5b (mới, sau banner, trước hàng Sổ giao dịch): card **"Tiền chi được"** (phải tiêu đề "theo sổ") — số to `amount` (âm: "thiếu X ₫" đỏ, câu "Tiền trong các tài khoản đang tính chưa đủ giữ Tích sản và Thuế, thiếu X ₫."), câu ngắn "Tiền thật trong các tài khoản đang tính, trừ phần Tích sản và Thuế phải giữ."; rồi mỗi tài khoản đang tính một dòng tên · số dư sổ (tài khoản có lệch đối soát — `attention.drift` có lớp lệch theo `driftLayers` — thêm dòng phụ "số ngân hàng khác sổ — xem Đối soát"; banner lệch ngay trên có nút Đối soát); "Trừ Tích sản đang giữ", "Trừ Thuế đang giữ" — chỉ hiện dòng ≠ 0; chân card "Không tính: {tên…}, heo đất (giữ X ₫ Tích sản)" (tính hết: "Đang tính mọi tài khoản.") + nút **Đổi tài khoản** mở Cài đặt › Tài khoản. Snapshot cũ trong cache chưa có `spendableCash` → không hiện card.
- Màn rộng: cùng card, cột phụ ngay dưới Việc cần làm (≥ 1280px); 1024–1279px một hàng riêng dưới hero (không có Việc cần làm: cạnh hero).
- ADDED AC-12: hàm thuần `spendableCashView` — dòng tài khoản theo thứ tự server, dòng trừ chỉ khi ≠ 0, cảnh báo lệch chỉ cho tài khoản có lớp lệch, câu "Không tính" gộp heo đất, số âm thành "thiếu X ₫".

### Entity
- `accounts.spendable` INTEGER NOT NULL DEFAULT 1 CHECK (0/1): 1 = số dư sổ tính vào "Tiền chi được". Migration 0022 đặt 0 cho `locked = 1` và `kind = 'credit'`. Tài khoản `locked = 1` không bao giờ tính dù cột là gì (server chặn bật; hàm tính bỏ qua). Schema v1.22.

## Quyết định
**ADR-85: "Tiền chi được" = tiền thật ở tài khoản đang tính − Tích sản và Thuế còn giữ (heo đất không trừ hai lần).**
- Bối cảnh: như "Vì sao".
- Lựa chọn: định nghĩa ở trên; tính ở server trong snapshot (màn Hôm nay đã tải snapshot mỗi lần mở — không thêm request; MCP `get_snapshot` cùng số); công tắc mỗi tài khoản, mặc định bật trừ thẻ tín dụng và heo đất.
- Phương án bị loại:
  - **Thêm vào `GET /v1/networth`**: Hôm nay không tải networth → thêm một request mỗi lần mở app, và không có bản lưu offline như snapshot.
  - **Trừ Tích sản đủ số rồi trừ thêm heo** (hay tính heo vào tài khoản rồi trừ Tích sản): heo là Tích sản (ADR-82) — đếm hai lần.
  - **Đoán tiền Tích sản / Thuế nằm ở tài khoản trú của ví** (`wallets.account_id`) để không trừ lại khi tài khoản đó tắt: ví trú một nơi, tiền nằm một nơi ("Chuyển sang Tích sản" chỉ đổi ví — README §6 mục 5); tài khoản trú có thể có tiền ngoài ví (số dư đầu) → số chi được bị thổi lên. Chọn sai về phía thấp an toàn hơn.
  - **Trừ cả ví giữ riêng (Thu cho thuê), khoản thu chưa chia, nợ**: chủ nhà chỉ chọn Tích sản + Thuế.
  - **Dùng số ngân hàng báo (SePay)**: không phải tài khoản nào cũng có; sổ là nguồn sự thật, lệch thì cảnh báo.
- Hệ quả: tài khoản giữ tiền Tích sản / Thuế nên để **bật** (lời dặn ở sheet); tắt nó thì phần đó bị trừ hai lần → số thấp hơn thật.
- [OPEN] Tắt một tài khoản đang giữ tiền Tích sản / Thuế (ví dụ TCB Tích sản, MB Thuế theo seed) làm tiền chi được thấp hơn thật đúng phần đó. Chủ nhà chọn: giữ luật (lời dặn đủ) hay app tự coi số dư tài khoản trú của ví Tích sản / Thuế là tiền của ví khi tài khoản đó tắt.
- [OPEN] Khoản thu chưa chia (ví Thu nhập) và ví giữ riêng (Thu cho thuê) vẫn nằm trong tiền chi được — một phần sẽ thành Tích sản / Thuế khi chia.

## Thiết kế
- `migrations/0022_accounts_spendable.sql` (ALTER TABLE thêm cột, UPDATE locked/credit, `schema_version` 1.22) · `docs/schema.sql` · `test/schema.test.ts`. Sao lưu D1 prod trước khi chạy.
- `src/domain/snapshot.ts` › `SnapshotData.accounts`, `spendableCash`, `buildSnapshot` · `src/services/ledger.ts` › `getSnapshot` (truy vấn thứ 12 trong batch).
- `src/services/settings.ts` › `ACCOUNT_SQL`, `toAccount`, `accountFields`, `createAccount`, `updateAccount`.
- `web/src/lib/spendable-cash.ts` › `spendableCashView` (thuần, có test) · `web/src/screens/today.tsx` › `SpendableCashCard` · `web/src/screens/today-desktop.tsx` · `web/src/styles.css` (vùng `cash` của `.dash`, `.cash-big`) · `web/src/lib/settings.ts` › `AccountForm.spendable`, `accountPayload`, `spendableDefault` · `web/src/screens/settings-sheets.tsx` › `AccountSheet` · `web/src/screens/settings.tsx` (mở thẳng phần Tài khoản) · `web/src/state/store.ts` › `settingsFocus`.
- Rủi ro: snapshot to thêm một mảng tài khoản (vài dòng). Khoản chờ đồng bộ chưa trừ vào card này (hero vẫn trừ tạm) — số theo sổ server; dòng trạng thái đã nói "N chờ đồng bộ".

## Việc cần làm
- [x] Test cho từng AC mới/sửa
- [x] Code
- [x] Cập nhật UC chính + `## History`
- [ ] Sinh lại `traceability.md`, `open-issues.md` (người tích hợp)
