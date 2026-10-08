# 261006-tai-khoan-phao: Tài khoản Tích sản — phao dự phòng và sổ tiết kiệm như heo đất
- Status: archived
- BR: BR-07, BR-04, BR-01
- Đụng tới: UC-101, UC-103, UC-107 (ledger) · UC-303 (ingest) · UC-506 (access) · UC-702, UC-705, UC-706, UC-707, UC-709 (pwa) · UC-1005 (receivable)
- Đóng: — (ADR-85 [OPEN] "tắt tài khoản thường giữ Tích sản / Thuế bị trừ hai lần" giữ nguyên; tài khoản để dành Tích sản nay đánh dấu Phao dự phòng)
- Người duyệt nghiệp vụ: chủ nhà (đã quyết hai điểm, xem "Vì sao") · Người duyệt kỹ thuật: —

## Vì sao
Chủ nhà, 2026-10-06, về tài khoản `mb-savings-wife` ("MB tiết kiệm (vợ)", chưa nối SePay, số dư 2.000 ₫): "tài khoản phao dự phòng của nhà tôi: thường là tôi sẽ chuyển khoản tích lũy cho vợ, đến 1 ngưỡng vợ tôi sẽ gửi tiết kiệm, nếu vàng hay tài sản được giá tôi sẽ rút tiết kiệm đó ra đi mua, hoặc có sự cố gì đó thì tất toán khoản gửi tiết kiệm đó".

Hôm nay app chỉ biết một loại tài khoản giữ tiền Tích sản: heo đất (`locked = 1`, ADR-77/82), và chỉ rule heo mang chuyển ví Có thì tốt → Tích sản. Chuyển vào phao chỉ là đổi chỗ tiền — ví Có thì tốt vẫn giữ số đó, "còn để chi" không giảm, Tích sản không tăng. Gửi tiết kiệm có kỳ hạn không có chỗ ghi. Và công thức Tiền chi được (ADR-85) chỉ không trừ lại phần Tích sản nằm ở heo: để phao ngoài "tài khoản đang tính" thì phần Tích sản ở phao bị trừ hai lần.

Hai quyết định của chủ nhà:
1. **Tiền vào phao tự vào Tích sản (như heo đất)**: chuyển từ tài khoản chi tiêu của nhà vào phao = ví Có thì tốt → Tích sản; rút từ phao về tài khoản thường = chỉ đổi chỗ (vẫn là tiền Tích sản). Mua vàng / chi từ đó dùng luồng Mua tài sản / chi tiêu có sẵn.
2. **Gửi tiết kiệm có kỳ hạn = tài khoản khóa "Sổ tiết kiệm"** (như heo): gửi = chuyển phao → sổ (chỉ đổi chỗ, vẫn Tích sản, phao khẩn cấp vẫn đếm); tất toán = chuyển sổ → phao (hoặc tài khoản khác), phần lãi là Thu nhập (tách dòng khi gán). Thêm sổ dễ ở Cài đặt › Tài khoản › Thêm; sổ đã tất toán thì tắt "Đang dùng".

## Thay đổi spec

### Entity
- `accounts.role` TEXT NULL CHECK: `NULL` = tài khoản thường; `'heo'` (heo đất, `locked = 1`), `'phao'` (phao dự phòng, `locked = 0`), `'so-tiet-kiem'` (sổ tiết kiệm, `locked = 1`) — **tài khoản Tích sản**: tiền chuyển vào từ tài khoản thường là Tích sản. CHECK ở cột giữ `role` khớp `locked`. Migration 0024 (schema v1.24): `role = 'heo'` cho mọi `locked = 1`; `mb-savings-wife` (nếu có, chưa khóa) → `role = 'phao'`, `spendable = 0`.
- `accounts.locked` giữ nghĩa cũ "tiền thật chưa rút ngay được" (heo, sổ tiết kiệm).

### UC-506 (access — tài khoản)
- Main Flow 3g (mới): `role` ∈ `phao | so-tiet-kiem | null` khi thêm; `heo` chỉ do migration. `so-tiet-kiem` → `locked = 1`, `spendable = 0`. `phao` → `locked = 0`, `spendable` mặc định 0 (gửi thì theo ô). Sửa: chỉ đổi qua lại `null ↔ phao` (sang phao không gửi `spendable` thì tắt); đổi `role` của heo / sổ, hay sang `heo` / `so-tiet-kiem` → 400 `invalid_role`. `locked_account` nói "Tài khoản đã khóa (heo đất, sổ tiết kiệm) không tính vào tiền chi được.".
- ADDED AC-17: Given thêm tài khoản `role: "phao"` (không gửi `spendable`) và `role: "so-tiet-kiem"` Then phao `locked: false, spendable: false`; sổ `locked: true, spendable: false`; `role: "heo"` → 400 `invalid_role`; sổ gửi `spendable: true` → 400 `locked_account`.
- ADDED AC-18: Given tài khoản thường When `PATCH { role: "phao" }` Then `role: "phao"`, `spendable: false`; `PATCH { role: null }` về thường; heo `PATCH { role: null }` và tài khoản thường `PATCH { role: "so-tiet-kiem" }` → 400 `invalid_role`.
- ADDED AC-19: migration 0024 trên DB như prod: heo → `role = 'heo'`; `mb-savings-wife` → phao, `spendable = 0`; DB seed mẫu không có tài khoản Tích sản nào.

### UC-101 (ledger — nhập tay)
- Main Flow `transfer` có hai tài khoản, không gửi ví: tài khoản **đích** là tài khoản Tích sản và tài khoản **nguồn** không phải → server tự chuyển ví **Có thì tốt (ví `remainder`) → Tích sản** (ADR-88). Nguồn là tài khoản Tích sản (rút phao / heo, gửi phao → sổ, tất toán sổ → phao) → chỉ đổi chỗ. Gửi ví thì theo ví đã gửi.
- ADDED AC-24: Given tiền mặt → phao 1.000.000 không ví When ghi Then `wallet_id = tich-san`, `counter_wallet_id = co-thi-tot`; phao → sổ và sổ → tiền mặt không ví Then không ví; gửi ví khác Then theo ví đã gửi.

### UC-303 (ingest — tự khớp)
- Main Flow: ghép cặp nội bộ (bước 2+3, cả ghép tay UC-306) và rule `transfer` không mang ví mà tài khoản đích là tài khoản Tích sản, nguồn thì không → cùng chuyển ví Có thì tốt → Tích sản như nhập tay. Lệnh chuyển tiền của app (mã `PF`) không đổi — ví đã nạp lúc chia.
- ADDED AC-22: Given phao nối SePay, hai log ngược chiều cùng số giữa MB chồng và phao When tự ghép cặp Then giao dịch mang `wallet_id = tich-san`, `counter_wallet_id = co-thi-tot`; rule chuyển nội bộ sang phao không có ví Then tự gán cũng mang chuyển ví đó.

### UC-103 (ledger — snapshot, Tiền chi được)
- MODIFIED bước 7b: `tichsanInLocked` → **`tichsanOutside`** = `min(max(0, Σ số dư sổ tài khoản có role không tính), max(0, tichsanCash))` — tiền Tích sản đã nằm ở heo, phao, sổ tiết kiệm không trừ lại; tài khoản thường tắt công tắc **không** được coi là chỗ giữ Tích sản (giữ AC-13 của ADR-85). `excluded[]`: `{ accountId, name, role }` (thay `locked`).
- MODIFIED AC-14: "bỏ heo đất không trừ hai lần" → "chuyển vào tài khoản Tích sản không trừ hai lần" (heo giữ nguyên test).
- ADDED AC-16: Given DB mới, tài khoản phao When chuyển 1.000.000 từ tài khoản chi tiêu vào phao Then Tích sản +1.000.000, Tiền chi được −1.000.000 (một lần); gửi 800.000 phao → sổ Then Tích sản, Tiền chi được không đổi; tất toán 820.000 sổ → phao (800.000 chuyển + 20.000 Thu nhập) Then Tích sản không đổi, phao +820.000, Thu nhập chưa chia 20.000.
- ADDED AC-17 (hàm thuần): chỉ tài khoản có role không tính là chỗ giữ Tích sản; tài khoản thường tắt công tắc và thẻ tín dụng thì không; phao bật tính thì là tài khoản đang tính.

### UC-107 (ledger — `GET /v1/tichsan`)
- MODIFIED bước 3: `locked[]` → **`accounts[]`**: mỗi tài khoản Tích sản đang dùng (`role IS NOT NULL`) kèm `role`, số dư sổ, log chờ gán. `flows[].kind` thêm `phao`, `so-tiet-kiem` (chuyển vào ví Tích sản mà tài khoản nhận có `role` đó; `heo` như cũ theo `role = 'heo'`).
- ADDED AC-9: Given chuyển vào phao 1.000.000 rồi gửi sổ 800.000 When `GET /v1/tichsan` Then `accounts` có phao 200.000 và sổ 800.000; `flows` có `{kind: "phao", direction: "in", count: 1, amount: 1.000.000}`; gửi sổ không thêm nguồn.

### UC-707 (pwa — tab Tích sản)
- Card "Tiền đang ở đâu": mỗi tài khoản Tích sản một dòng — heo "Heo đất {người}", phao "Phao dự phòng · {tên}", sổ "Sổ tiết kiệm · {tên}" — rồi "Trong các tài khoản thường"; phần dư "Heo, phao, sổ tiết kiệm có hơn Tích sản X …". Nguồn: "Chuyển vào phao {tên} (N lần)", "Gửi sổ tiết kiệm {tên} (N lần)".
- ADDED AC-21: `tichsanPlaces` / `tichsanSources` kê phao và từng sổ tiết kiệm cạnh heo; phần ở tài khoản Tích sản tối đa bằng tiền Tích sản.

### UC-702 (pwa — Hôm nay, card Tiền chi được)
- MODIFIED AC-12: dòng trừ Tích sản khi có phần nằm ngoài tài khoản đang tính đổi nhãn "Trừ Tích sản đang giữ (phần chưa nằm ở heo / phao / sổ tiết kiệm)"; chân card kê tài khoản không tính theo tên (heo gộp "heo đất") và "— trong đó X ₫ Tích sản, không trừ lại".

### UC-709 (pwa — Cài đặt › Tài khoản)
- Sheet tài khoản có ô **Giữ tiền Tích sản** (`Seg`): "Không" · "Phao dự phòng" · "Sổ tiết kiệm" (sổ chỉ khi thêm). Heo đất: chỉ hiện chữ "Heo đất", không đổi. Sổ tiết kiệm: không có SePay, ô ngày đổi tên "Ngày gửi", không có ô Tính vào tiền chi được; lời dặn "Để số dư đầu 0, rồi ghi Chuyển nội bộ từ phao sang sổ đúng số gửi — tiền gửi là Tích sản. Tất toán: chuyển sổ về tài khoản nhận, phần lãi ghi Thu nhập; xong thì tắt Đang dùng." Chọn phao thì ô Tính vào tiền chi được tự tắt.
- ADDED AC-26: `accountPayload` gửi `role`; thêm phao mặc định tắt tính vào tiền chi được; sổ tiết kiệm gửi `locked`-an toàn (`spendable: false`, `sepay_enabled: false`); sửa heo / sổ không gửi `role`.

### UC-706 / UC-705 (pwa — Gán, Loại khác › Chuyển nội bộ)
- Dòng Chuyển nội bộ vào tài khoản Tích sản từ tài khoản thường mà chưa chọn ví: dòng nhắc "Tiền vào {tên} là Tích sản: ví Có thì tốt chuyển sang Tích sản." (`tichsanMoveHint`). Loại khác gửi luôn hai ví đó (để khoản chờ đồng bộ trừ tạm đúng ví).
- ADDED UC-706 AC-29, UC-705 AC-22: hàm thuần `tichsanMoveHint` — có nhắc khi đích là tài khoản Tích sản và nguồn không; không nhắc khi rút / gửi giữa tài khoản Tích sản hay đã chọn ví.

### UC-1005 (receivable — tiền thật)
- MODIFIED: `locked` → **`tichsanAccounts`** `{ total, accounts: [{ accountId, name, role, memberId, memberName, balance }] }` — mọi tài khoản Tích sản đang dùng. Dòng phụ: "trong đó Tích sản X đã khóa (gồm Y ở heo, phao, sổ tiết kiệm: Heo chồng … · MB tiết kiệm (vợ) …)"; nhiều hơn Tích sản thì kể riêng "Heo, phao, sổ tiết kiệm Y (…)". AC-5, AC-6 đổi theo.

## Quyết định
**ADR-88: Tài khoản Tích sản — heo đất, phao dự phòng, sổ tiết kiệm; chuyển vào từ tài khoản thường là vào Tích sản.**
- Lựa chọn: một cột `accounts.role` (`heo | phao | so-tiet-kiem`), giữ `locked` cho nghĩa "chưa rút ngay được" (CHECK khớp hai cột). Chuyển ví Có thì tốt → Tích sản là **luật của tài khoản**, không của rule: một hàm thuần `tichsanMove` (`src/domain/entry.ts`) dùng cho nhập tay, gán, ghép cặp, rule không ví. Tiền chi được (sửa ADR-85): phần Tích sản không trừ lại = min(max(0, Σ số dư sổ tài khoản có `role` không tính); Tích sản tiền mặt) — tài khoản thường tắt công tắc không được coi là chỗ giữ Tích sản.
- Phương án bị loại:
  - **Cờ boolean `tichsan_account`**: không phân biệt heo / phao / sổ để nói "tiền đang ở đâu" và để chặn bật tính vào tiền chi được cho tài khoản khóa.
  - **Bỏ hẳn `locked`, suy ra từ `role`**: phải viết lại mọi câu SQL / rule seed dùng `locked` (0017, 0019) và đụng view mà một thay đổi khác đang dựng lại; CHECK ở cột đủ giữ hai cột khớp nhau.
  - **Phao bằng rule như heo** (mẫu nội dung → chuyển ví): chuyển khoản cho vợ không có mẫu nội dung cố định, nhập tay / gán tay không đi qua rule.
  - **Sổ tiết kiệm có cột kỳ hạn / ngày đáo hạn**: chủ nhà rút khi vàng được giá hay có sự cố, không theo đáo hạn; tên sổ ghi được kỳ hạn. Ngày gửi = `opened_at`.
  - **Màn "Gửi tiết kiệm" / "Tất toán" riêng**: gửi và tất toán là chuyển nội bộ có sẵn (lãi tách dòng Thu nhập khi gán, hoặc ghi một khoản Thu nhập).
  - **Coi mọi tiền ở tài khoản không tính (kể cả tài khoản thường tắt công tắc) là Tích sản trước**: phá AC-13 của ADR-85 (tắt một tài khoản không làm tiền chi được giảm khi Tích sản lớn) và sai về phía cao; đã trao đổi, chọn chỉ tài khoản có role.
- Hệ quả: chuyển vào phao làm Có thì tốt giảm (có thể âm nếu không đủ, như bỏ heo). Số dư phao / sổ có trước khi dùng app (phao hiện 2.000 ₫) **không** là Tích sản (như số dư đầu của heo) nhưng vẫn được coi là chỗ giữ Tích sản trong công thức tiền chi được và ở "Tiền đang ở đâu" — lệch tối đa đúng số đó. Tài khoản thường tắt công tắc mà giữ tiền Tích sản / Thuế vẫn bị trừ hai lần như ADR-85 ([OPEN] giữ) — tiền để dành Tích sản thì đánh dấu Phao dự phòng.

## Thiết kế
- `migrations/0024_accounts_role.sql` · `docs/schema.sql` (v1.24) · `test/schema.test.ts`. Sao lưu D1 prod trước khi chạy.
- `src/domain/types.ts` › `AccountRole`, `AccountRef.role` · `src/domain/entry.ts` › `tichsanMove`, `buildEntry` · `src/domain/snapshot.ts` › `spendableCash` · `src/services/ledger.ts` › `loadRefs`, `getSnapshot`, `netWorth`, `tichsanBreakdown` · `src/services/ingest.ts` › `matchLog`, `pairLogs` · `src/services/settings.ts` › `accountFields`, `createAccount`, `updateAccount`.
- `web/src/lib/tichsan-accounts.ts` › `tichsanAccountLabel`, `tichsanMoveHint` · `web/src/lib/spendable-cash.ts` · `web/src/lib/tichsan.ts` · `web/src/lib/networth.ts` · `web/src/lib/settings.ts` › `AccountForm.role`, `accountPayload` · `web/src/lib/categories.ts` (mặc định không lấy tài khoản Tích sản) · `web/src/screens/settings-sheets.tsx` › `AccountSheet` · `web/src/screens/assign.tsx` · `web/src/screens/other-entry-sheet.tsx`.
- Rủi ro: Có thì tốt âm khi chuyển phao lớn hơn số còn lại — đúng ý "tiền vào phao là để dành", banner ví âm có sẵn nhắc bù.

## Việc cần làm
- [x] Test cho từng AC mới/sửa
- [x] Code
- [x] Cập nhật UC chính + `## History`
- [ ] Sinh lại `traceability.md`, `open-issues.md` (người tích hợp)
