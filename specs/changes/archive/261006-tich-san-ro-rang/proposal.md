# 261006-tich-san-ro-rang: Tích sản nói rõ tiền nào, loại nào, đang ở đâu
- Status: implemented (2026-10-06, code + test xanh, commit `18569ce`; hợp nhất vào `specs/` cùng ngày) — chủ nhà duyệt hướng làm 2026-10-06 qua yêu cầu giao việc
- BR: BR-07 (tích lũy, phao), BR-01 (số nói thật), BR-05 (đúng số như app)
- Đụng tới: ledger UC-107 (endpoint mới `GET /v1/tichsan`, AC-6…AC-8); pwa UC-707 (tab Tích sản, AC-17…AC-20), UC-716 (alt 1b: mở từ tab Tích sản, mọi tháng), UC-711 (bỏ `formatShort` không còn ai dùng)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà · Người duyệt kỹ thuật: —

## Vì sao
Chủ nhà 2026-10-06, nhìn Ví & quỹ › Tích sản (card chỉ có thanh "tiền 76k", "Phao khẩn cấp ước tính 0 / 6 tháng chi Must", "76.300 ₫ trên mức cần 110.550.000 ₫", nút Mua tài sản):

> "tích sản sao đã có 76.300 vậy? tôi chưa đưa vào mà??"
>
> "nếu là tích sản thì phải rõ là tiền nào, loại nào chứ? để ntn thì rất khó hiểu và phải đoán nó là tiền gì, đang ở đâu"

Số 76.300 ₫ là đúng sổ (prod): 9.000 ₫ chuyển từ ví Heo đất cũ ngày 3/10 (bút toán hệ thống của ADR-82) + 11 lần bỏ heo của vợ (62.300 ₫) + 1 lần bỏ heo của chồng (5.000 ₫) — tự gán theo rule heo (ADR-82: bỏ heo là Có thì tốt → Tích sản). Card không nói được điều nào trong đó: không nguồn, không chỗ nằm, chip "một ví, hai trạng thái tiền" không giải thích gì, nhãn "76k" rút gọn.

## Thay đổi spec
### ledger UC-107: thêm `GET /v1/tichsan` — Tích sản theo loại, chỗ nằm, nguồn
- Main Flow thêm bước: `tichsanBreakdown` đọc một batch SQL, trả
  - `walletId`, `name`, `cash`, `assets` (như `v_tichsan`, cùng số với snapshot);
  - `locked[]`: mỗi tài khoản heo (`accounts.locked = 1`) — `accountId`, `name`, `memberId`, `memberName`, `balance` (số dư sổ, có thể âm), `pendingCount` / `pendingNet`: log còn `pending` của chính tài khoản heo hoặc của tài khoản có rule heo trỏ tới nó (rule `content` đang bật, `counter_account_id` = heo, `account_id` = tài khoản của log, nội dung chứa mẫu) — `pendingNet` theo phía heo (bỏ heo +, rút heo −);
  - `flows[]`: các dòng `active` chạm ví Tích sản, gộp theo nguồn bằng một `GROUP BY` — `kind` ∈ `heo` (chuyển vào, tài khoản nhận là heo; tách theo từng tài khoản heo), `fund` (chia từ thu nhập), `sweep` (chốt tháng quét dư, `source='system'`, lô `S…`), `tax` (thuế dư sau quyết toán, lô `T…`), `wallet` (chuyển ví khác vào / ra, tách theo ví kia, kèm `walletName`, `walletActive` — ví đã tắt như `heo-dat` là "số dư ví cũ"), `other`; `buy_asset` (ra khỏi tiền, tách theo `assetKind`); `direction` `in`/`out`, `count` = số lần (lô chia / lô chốt tính một lần), `amount`.
  - Bất biến: Σ vào − Σ ra (trừ `buy_asset`) = số dư ví; − Σ `buy_asset` = `cash`.
- ADDED AC-6: Given nhà như prod có 2 tài khoản heo; Vợ bỏ heo 2 lần, chồng 1 lần (tự gán); một khoản thu được chia (phần Tích sản > 0); mua vàng 3.000 ₫ When `GET /v1/tichsan` Then `cash`/`assets` bằng snapshot; `locked` có chồng, vợ với số dư sổ; `flows` có `heo` theo từng heo (số lần, tổng), `fund` 1 lần với đúng phần Tích sản của lần chia, `buy_asset` out `gold` 3.000; vào − ra (không tính mua) = số dư ví, trừ thêm mua tài sản = `cash`.
- ADDED AC-7: Given chuyển số dư ví Heo đất cũ (bút toán của migration 0020), một lô chốt tháng quét dư `S…`, một lần chuyển ngân sách tay từ ví khác (test: Du lịch) When đọc Then ba nhóm riêng: `wallet` từ ví `heo-dat` (`walletActive = false`), `sweep`, `wallet` từ ví kia (`walletActive = true`).
- ADDED AC-8: Given một log tiền vào "Tat toan … sotich luy" của MB chồng đang chờ gán (rule `TICH LUY` trỏ heo chồng) When đọc Then heo chồng `pendingCount = 1`, `pendingNet = −số tiền`; heo vợ `pendingCount = 0`.

### pwa UC-707: tab Tích sản tự giải thích
- MODIFIED Main Flow bước 3 (card Tích sản), đọc `GET /v1/tichsan` (snapshot vẫn cấp phao):
  1. Bỏ chip "một ví, hai trạng thái tiền"; dưới tiêu đề một câu: "Tiền để dành lâu dài của nhà — gồm tiền (còn dùng được lúc khẩn cấp) và tài sản đã mua bằng tiền đó. Không chi trực tiếp từ đây."
  2. **Loại**: hàng **Tổng Tích sản** số to; **Tiền** X ₫; **Tài sản** Y ₫ kèm từng loại ("Vàng · 1 lần mua"…). Thanh hai phần giữ, **không** chữ rút gọn trên thanh (bỏ "tiền 76k"); mọi số trên card dùng `formatVnd`.
  3. **Tiền đang ở đâu**: mỗi heo một dòng "Heo đất {người}" (số dư sổ), rồi "Trong các tài khoản thường" (phần còn lại, ẩn khi 0) — "app không theo dõi tài khoản nào: ví chỉ là phần ngân sách". Heo dương cộng lại nhiều hơn tiền Tích sản → dòng chú "Heo có hơn Tích sản X ₫ — tiền bỏ heo từ trước khi dùng app hoặc tiền lãi, chưa thuộc ví nào". Heo âm → số đỏ, chú "sổ ghi rút ra nhiều hơn bỏ vào — tiền lãi hoặc tiền heo từ trước khi dùng app chưa tách". Heo có log chờ gán → "còn N khoản bỏ / rút heo đang chờ gán (±X)".
  4. **Tiền đến từ đâu** (card riêng): vào — "Bỏ heo đất {người} (N lần)", "Chia từ thu nhập (N lần chia)", "Chuyển số dư ví {ví} cũ" (ví đã tắt), "Chuyển từ ví {ví}", "Quét dư cuối tháng (N lần)", "Thuế dư sau quyết toán", "Khác"; ra — "Mua tài sản: {loại}", "Chuyển sang ví {ví}", "Khác"; dòng cuối "Còn lại là tiền" = `cash`. Nhóm 0 ẩn; chưa có gì → "Chưa có khoản nào vào Tích sản."
  5. Nút **Xem các khoản Tích sản** → Sổ giao dịch (UC-716) lọc ví Tích sản, **mọi tháng** (`month: null`); câu chú: "Phần chia từ thu nhập không hiện thành dòng riêng trong sổ — sổ chỉ có khoản thu gốc; tổng ở trên đã gồm phần đó." (sheet chi tiết khoản thu không kê phần chia theo ví, nên không hướng người đọc tới đó).
  - Phao khẩn cấp, Mua tài sản, card "Tài sản đang giữ" giữ nguyên.
- 3a (màn rộng): ba card xếp hai cột (`dk-cols`).
- ADDED AC-17: Given Tích sản như prod (tiền 76.300: heo vợ 71.300, heo chồng 5.000; vào: bỏ heo vợ 11 lần 62.300, bỏ heo chồng 1 lần 5.000, chuyển số dư ví Heo đất cũ 9.000) When xem Then thấy "Tiền 76.300 ₫", "Tài sản 0 ₫"; chỗ nằm "Heo đất vợ 71.300 ₫", "Heo đất chồng 5.000 ₫", không có dòng tài khoản thường; nguồn "Bỏ heo đất vợ (11 lần) 62.300 ₫", "Bỏ heo đất chồng (1 lần) 5.000 ₫", "Chuyển số dư ví Heo đất cũ 9.000 ₫"; không chữ "76k" nào.
- ADDED AC-18: Given heo 12.000 nhưng tiền Tích sản 10.000; hoặc heo chồng −4.000 không có log chờ; hoặc heo chồng có log rút 50.000 chờ gán When xem Then lần lượt: "Heo có hơn Tích sản 2.000 ₫ …" và không dòng tài khoản thường; heo chồng "−4.000 ₫" kèm chú "sổ ghi rút ra nhiều hơn bỏ vào …"; "còn 1 khoản bỏ / rút heo đang chờ gán (−50.000 ₫)".
- ADDED AC-19: Given chia lương 2 lần (phần Tích sản 1.000.000), mua vàng 300.000 When xem Then "Chia từ thu nhập (2 lần chia) 1.000.000 ₫", ra "Mua tài sản: Vàng 300.000 ₫", "Còn lại là tiền 700.000 ₫"; loại: "Tài sản 300.000 ₫" kèm "Vàng".
- ADDED AC-20: When bấm **Xem các khoản Tích sản** Then mở Sổ giao dịch lọc ví Tích sản, tháng "Tất cả".

### pwa UC-716
- Alternative Flow: mở từ tab Tích sản (AC-20 của UC-707) — lọc ví Tích sản, mọi tháng.

## Quyết định
ADR-86 — **Tiền Tích sản đang ở đâu: tách được phần ở heo, phần còn lại chỉ nói "trong các tài khoản thường"**
- Bối cảnh: ví là phần ngân sách, tài khoản giữ tiền thật. Sổ biết chắc tiền ở tài khoản heo (khóa) là Tích sản (ADR-82), nhưng không theo dõi phần còn lại nằm ở tài khoản thường nào: ví Tích sản có tài khoản nhà (BIDV, ADR-55) nhưng lệnh chuyển có thể chưa làm, "Chuyển sang Tích sản" chỉ đổi ví (README §6 mục 5).
- Lựa chọn: phần ở heo = tổng heo dương, tối đa bằng tiền Tích sản; phần còn lại "trong các tài khoản thường"; heo dương nhiều hơn → nói phần dư không thuộc ví nào; heo âm → hiện đúng số âm, không trừ vào Tích sản; log chờ gán của heo → nói riêng.
- Phương án bị loại: (1) nói "ở BIDV" theo tài khoản nhà của ví — sai khi lệnh chuyển chưa làm; (2) theo dõi số dư ví theo từng tài khoản — đổi mô hình sổ, chưa ai cần; (3) ẩn heo âm / phần heo dư cho gọn — chủ nhà muốn "rõ là tiền nào", giấu là phải đoán.
- Nguồn tiền phân loại từ chính dòng sổ (meaning, tài khoản heo, lô `S`/`T`, ví kia) — không thêm cột.

## Thiết kế
- Server: `src/services/ledger.ts` › `tichsanBreakdown` (một dòng `v_tichsan` + một `db.batch` hai câu); `src/routes/v1.ts` `GET /v1/tichsan`. Không migration.
- PWA: `web/src/lib/tichsan.ts` (thuần: `tichsanKinds`, `tichsanPlaces`, `tichsanSources`) + `web/src/lib/tichsan.test.ts`; `web/src/lib/types.ts` thêm `TichsanBreakdown`; `web/src/screens/wallets.tsx` › `TichsanTab`, `TichsanList`; `web/src/lib/money.ts` bỏ `formatShort` (chỉ thanh Tích sản dùng).
- Rủi ro: so mẫu rule trong SQL dùng `UPPER`/`INSTR` (không bỏ dấu như `matchRule`) — mẫu heo là chữ không dấu nên khớp; mẫu có dấu sẽ không đếm log chờ.

## Việc cần làm
- [x] Test cho từng AC mới/sửa — `test/heo-dat.test.ts` › "GET /v1/tichsan: Tích sản theo loại, chỗ nằm, nguồn (ADR-86)" (AC-6…AC-8 của UC-107); `web/src/lib/tichsan.test.ts` (AC-17…AC-19 của UC-707); AC-20 chạy tay
- [x] Code — chạy thử trên `wrangler dev` cục bộ (D1 riêng): bỏ heo 3 lần (2 heo), chia một khoản thu 10.000.000, mua vàng 300.000 → 390px và 1280px thấy Loại / Tiền đang ở đâu / Tiền đến từ đâu đủ ₫, nút mở sổ "Cả sổ, mọi tháng" + chip "Ví Tích sản"
- [x] Cập nhật UC chính + `## History` (ledger UC-107 v3; pwa UC-707 v18, UC-716 v4, UC-711 v11), ADR-86
- [ ] Sinh lại `traceability.md`, `open-issues.md` (integrator)
