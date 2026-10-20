# 261018-lai-tien-gui: Lãi tiền gửi — máy tự ghi vào ví của chính tài khoản nhận, không chia lương, Thu nhập thụ động
- Status: archived
- BR: BR-01 (mọi giao dịch ngân hàng vào sổ đúng một lần, đúng nghĩa)
- Đụng tới: ingest UC-303 (tự gán), UC-305 (Gán log), UC-306 (gỡ gán) · pwa UC-706 (màn Gán) · allocation UC-203 (chia một khoản thu) · balance UC-1105, UC-1106 (Thu nhập thụ động) · access UC-507 (tham số) · notify UC-402 (tin sáng) · mcp UC-604 (gán log qua Claude) · luật 6 (`docs/core_design_rules.md`, ADR-02), ADR-43, ADR-108, ADR-112
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-18, chat ("ngưỡng tối đa để 10tr đi, còn lại oke rồi, xong thì làm đi nhé") · Người duyệt kỹ thuật: reviewer `InterestReview`, 2026-10-18, hai lượt APPROVE_WITH_CHANGES → đã sửa
- Commit: propose `8b16e1b` · code `6afc8c8`, `eebb011`, `2d63892` · merge `—`

## Vì sao
Màn Gán sáng 18/10 có ba khoản +68 ₫ (MB chính · chồng), +50 ₫ (MB chi tiêu · vợ), +37 ₫ (MB tiết kiệm · vợ), nội dung chỉ `BankAPINotify`, về lúc 00:07–00:58 — lãi không kỳ hạn ngân hàng trả hằng tháng. Theo luật 6 chúng nằm `pending`, chip "tiền vào — phải hỏi". Gán "Thu nhập" thì PWA chạy luôn lần chia (dòng thác, lệnh chuyển tiền) cho vài chục đồng; "Gán, để chia sau" thì nằm mãi ở ví Thu nhập; báo cáo chỉ xếp Thu nhập thụ động khi tài khoản là phao / sổ. Không có đường nào đúng cho tiền lãi.

> "tiền vào kiểu lãi tk thì cho vào đâu nhỉ ? chưa có case này thì phải" → "lãi vào đó thì chỉ để tiêu thôi, vì nó quá nhỏ, lãi của tk nào thì cộng vào tk đó, tuỳ mục đích là tích sản, chi tiêu,..." → "vấn đề là k cần đẻ tk nhận lãi nữa, mà nó về đúng tk đó rồi nè" (chủ nhà, chat 2026-10-18)

Chốt 2026-10-18 (chủ nhà chọn): máy **tự ghi**, không cần đặt gì thêm cho tài khoản · nhận diện = dưới ngưỡng + nội dung rỗng / chỉ `BankAPINotify` / có cụm "LAI TIEN GUI", "LAI KHONG KY HAN", "TRA LAI TIEN GUI" · lãi **có** tính vào "đã rót tháng này" của ví nhận · ngưỡng đặt ở Cài đặt › Tham số, mặc định 10.000 ₫ · tài khoản chứa nhiều ví → ví **Có thì tốt** (ví nhận phần dư).

Điều chỉnh 2026-10-18 (chủ nhà, qua Main, sau review code): "ví khóa của nguồn thu" ở bước 2 Ví nhận lãi là **mọi ví trong phần khóa của một nguồn thu đang bật khóa trọn 100%** (tổng phần khóa của nguồn = 1, vd Thu cho thuê, hay hai ví 70/30); nguồn khóa một phần (tổng < 1, vd Tích sản 45% của lương vợ) **không** loại ví nào — tài khoản chỉ chứa Tích sản thì lãi vào Tích sản ("tuỳ mục đích tích sản, chi tiêu"). Tin sáng nhận lãi tự ghi bằng dấu hiệu đợt chia (không người ghi, một fund trọn số, không lệnh chuyển, Thu nhập thụ động).

## Thay đổi spec
**Log lãi** = log `in` của tài khoản A, `0 < amount < interest_max_amount` (Config, mặc định 10.000; `0` = tắt), nội dung chuẩn hoá (bỏ dấu, viết HOA, gộp khoảng trắng, cắt hai đầu) **rỗng**, **đúng** `BANKAPINOTIFY`, hoặc **chứa** một trong `LAI TIEN GUI`, `LAI KHONG KY HAN` (`TRA LAI TIEN GUI` đã chứa cụm đầu). Không khớp chữ `LAI`/`TRA LAI` đơn ("trả lại", "cho thuê lại").

**Ví nhận lãi** của A, theo thứ tự:
1. A có `role` (`buffer`, `term_deposit`, `piggy_bank`) → ví Tích sản.
2. Đúng một ví đang bật có `account_id = A`, trừ ví Thu nhập, mọi ví `tier = 'holding'` (quỹ) và mọi ví của một nguồn thu đang bật khóa trọn 100% (tổng phần khóa = 1, vd "Thu cho thuê"; khóa một phần không loại) → ví đó.
3. Còn lại (không ví nào, hoặc nhiều ví) → ví Có thì tốt (ví có luật nạp `remainder`).
4. Không có ví Có thì tốt → không tự ghi; log `pending`, màn Gán gợi ý Lãi tiền gửi, người chọn ví.

**Ghi lãi** = khoản thu `income` (ví Thu nhập, `counter_account_id = A`, `taxable = 0`, gắn log) rồi **chia lãi**: đợt chia (`allocation_runs`, `batch_id` như UC-203) chỉ một `fund` = toàn bộ số tiền vào ví nhận lãi, **không** lệnh chuyển tiền (tiền đã ở A), report class `passive_income`. Chia lãi đi qua `allocateIncome` với `amounts` (ADR-108) cộng cờ `interest` (chỉ dùng nội bộ, không mở ở `/v1/allocate` hay MCP): không qua luật nạp, sàn, bù hố, không đòi Tích sản / lý do Tích sản 0 (ADR-112, không `wealth_note_required`), không sinh `transfer_orders`. Fund tính vào "đã rót tháng này" của ví nhận như mọi fund (không ngoại lệ). Ví nhận lãi được kiểm (đang bật, không phải ví Thu nhập hay ví `holding`) **trước** khi ghi khoản thu.

### ingest UC-303 — MODIFIED (tự gán) + notify UC-402
- Thứ tự xử lý log mới: memo `PF …` → ghép cặp chuyển nội bộ → chân thứ hai → rule (lương, người thuê, heo, chi/chuyển) → **log lãi** (mới, bước cuối của `matchLog`) → `pending`. Log nghi trùng không tới bước này (như hiện nay).
- Log lãi có ví nhận lãi (bước 1–3) → Ghi lãi: income + log `assigned` nguyên tử, rồi chia lãi; chia lỗi → giữ khoản thu ở ví Thu nhập, ghi `ingest_error` cho tin sáng (như lương tự chia, UC-203 alt 0a). Lối sửa: gỡ gán khoản đó rồi gán lại loại Lãi tiền gửi (không dùng nút Chia ở banner — nút đó chạy dòng thác thường).
- Tin sáng 07:00 (notify UC-402) thêm một dòng khi hôm trước có lãi tự ghi: "💰 Lãi tiền gửi: +155 ₫ (3 khoản) — vào Tích sản, Chi tiêu vợ, Có thì tốt". Không gửi tin tức thì.
- Luật 6 đổi thành: "máy chỉ đoán `spend`/`transfer`; tiền vào luôn phải hỏi, trừ khớp mẫu lương **hoặc log lãi** (dưới ngưỡng lãi)."
- ADDED AC: log +37 `BankAPINotify` tài khoản `role = buffer` → 1 `income` 37 + 1 `fund` 37 vào Tích sản, 0 `transfer_orders`, report class `passive_income`, log `assigned`; số dư ví Thu nhập không đổi.
  - Tests: [`test/ingest.test.ts`](../../../../test/ingest.test.ts) › "lãi tiền gửi: máy tự ghi vào ví của chính tài khoản (261018-lai-tien-gui) › UC-303: log +37 BankAPINotify tài khoản phao → 1 khoản thu 37 + 1 fund 37 vào Tích sản, 0 lệnh chuyển, Thu nhập thụ động, log đã gán; ví Thu nhập không đổi" (ingest UC-303 AC-25)
- ADDED AC: log +50 tài khoản thường có đúng một ví "Chi tiêu vợ" → fund vào ví đó; log +68 tài khoản chứa ví Thu nhập, Thu cho thuê, Chơi chồng, Chơi vợ → fund vào Có thì tốt; tài khoản chỉ chứa một ví quỹ `holding` → Có thì tốt.
  - Tests: [`test/ingest.test.ts`](../../../../test/ingest.test.ts) › "lãi tiền gửi: máy tự ghi vào ví của chính tài khoản (261018-lai-tien-gui) › UC-303: +50 tài khoản thường có đúng một ví → fund vào ví đó; +68 tài khoản chứa Thu nhập, Thu cho thuê và nhiều ví → Có thì tốt; tài khoản chỉ có một ví quỹ holding → Có thì tốt"; [`test/interest-deposit.test.ts`](../../../../test/interest-deposit.test.ts) (ingest UC-303 AC-26, AC-27)
- ADDED AC: log +50.000 `BankAPINotify` → `pending`; +5.000 "CHO THUE LAI P2" → `pending`; +5.000 "HOAN TRA LAI TIEN THUA" → `pending`; +5.000 "LAI TIEN GUI THANG 10" → Ghi lãi; `interest_max_amount = 0` → +37 `BankAPINotify` `pending`.
  - Tests: [`test/ingest.test.ts`](../../../../test/ingest.test.ts) › "lãi tiền gửi: máy tự ghi vào ví của chính tài khoản (261018-lai-tien-gui) › UC-303: +50.000 BankAPINotify, +5.000 'CHO THUE LAI P2', +5.000 'HOAN TRA LAI TIEN THUA' → chờ gán; +5.000 'LAI TIEN GUI THANG 10' → ghi lãi; ngưỡng 0 → +37 BankAPINotify chờ gán" (ingest UC-303 AC-28)
- ADDED AC: log +37 khớp memo `PF …` hay ghép được chuyển nội bộ → xử lý như cũ, không thành lãi.
  - Tests: [`test/ingest.test.ts`](../../../../test/ingest.test.ts) › "lãi tiền gửi: máy tự ghi vào ví của chính tài khoản (261018-lai-tien-gui) › UC-303: log +37 khớp memo PF hay ghép được chuyển nội bộ → xử lý như cũ, không thành lãi" (ingest UC-303 AC-29; thêm AC-30 chia lỗi, AC-31 nghi trùng / gửi lại)
- ADDED notify UC-402 AC: hôm qua tự ghi 3 khoản lãi 68 + 50 + 37 → tin sáng có đúng một dòng lãi 155 ₫ (3 khoản) kèm ví; không có lãi → không có dòng.
  - Tests: [`test/cron-daily.test.ts`](../../../../test/cron-daily.test.ts) › "tin sáng: dòng lãi tiền gửi tự ghi hôm qua (261018-lai-tien-gui) › UC-402: hôm qua tự ghi 3 khoản lãi 68 + 50 + 37 → đúng một dòng lãi 155 ₫ (3 khoản) kèm ví; không có lãi → không có dòng" (notify UC-402 AC-30, AC-31)

### ingest UC-305 / pwa UC-706 — MODIFIED (Gán)
- Log `pending` là log lãi (vd về trước bản này, ngưỡng đổi, hay thiếu ví Có thì tốt) → `suggestion { meaning: "income", interest: true, wallet_id (ví nhận lãi | null), label: "Lãi tiền gửi" }`; chip xanh "gợi ý: Lãi tiền gửi", sau "có thể trùng", trước "tiền vào — phải hỏi".
- Sheet: loại **Lãi tiền gửi** chọn được cho mọi log `in` (mặc định khi có gợi ý); ô Ví điền sẵn ví nhận lãi; dòng giải thích "Lãi ngân hàng trả — cộng thẳng vào {ví}, không chia lương, báo cáo xếp Thu nhập thụ động."; không có "Gán, để chia sau"; **một** dòng (không tách). Gán xong toast "Đã ghi lãi 37 ₫ vào Tích sản", không gọi `/v1/allocate`. Không có ô "Lần sau tự gán" cho loại này (máy đã tự ghi).
- `POST /v1/logs/:id/assign` (route `parseSplit`) và MCP `assign_log` nhận split `{ meaning: "income", interest: true, wallet_id }` → Ghi lãi với ví đó. Lỗi, không ghi gì: log không phải `in` → 400 `invalid_input`; nhiều split có `interest` hoặc trộn với split khác → 400 `invalid_input`; `wallet_id` thiếu, không có, đã tắt, là ví Thu nhập → 400 `invalid_wallet`; tài khoản của log đã tắt → như gán thường hiện nay. Không đòi điều kiện log lãi (người đã chọn — trên ngưỡng vẫn ghi được).
- Gỡ gán khoản lãi → như gỡ khoản thu đã chia (UC-206): huỷ `income` và `fund`, log `pending`; report class nằm lại với dòng đã huỷ (UC-1105, không đổi).
- ADDED UC-305 AC: log +37 `BankAPINotify` `pending` của tài khoản buffer → gợi ý `interest`, `wallet_id` Tích sản; gán → như AC Ghi lãi của UC-303. Gán với `wallet_id` ví Thu nhập → 400 `invalid_wallet`, 0 giao dịch.
  - Tests: [`test/ingest.test.ts`](../../../../test/ingest.test.ts) › "lãi tiền gửi: máy tự ghi vào ví của chính tài khoản (261018-lai-tien-gui) › UC-305: log lãi đang chờ (ngưỡng vừa hạ) → gợi ý Lãi tiền gửi kèm ví nhận lãi; gán → như ghi lãi; ví Thu nhập → invalid_wallet, không ghi gì; gỡ gán → huỷ khoản thu và fund, log chờ lại"; [`test/logs.test.ts`](../../../../test/logs.test.ts); [`test/mcp.test.ts`](../../../../test/mcp.test.ts) (ingest UC-305 AC-28, AC-29; UC-306 AC-13; mcp UC-604 AC-8)
- ADDED UC-706 AC: chip, sheet mặc định Lãi tiền gửi + ví điền sẵn, không "Gán, để chia sau", toast; không gọi `/v1/allocate`.
  - Tests: [`web/src/lib/splits.test.ts`](../../../../web/src/lib/splits.test.ts) › "Gán lãi tiền gửi (261018-lai-tien-gui)"; sheet không chia thử / không `/v1/allocate`: xem tay 390px (pwa UC-706 AC-31)

### allocation UC-203 — MODIFIED
- Alt mới **chia lãi**: `allocateIncome(income, { amounts: [{ wallet_id: ví nhận lãi, amount }], interest: true })` → một `fund`, không `transfer_orders`, bỏ luật Tích sản của ADR-112, ghi `transaction_report_classes (income, 'passive_income')` cùng batch. `/v1/allocate` cho khoản đã chia → 409 `already_allocated` (giữ).
  - Tests: [`test/ingest.test.ts`](../../../../test/ingest.test.ts) (UC-303 AC-25), [`test/mcp.test.ts`](../../../../test/mcp.test.ts) (allocation UC-203 AC-15)

### access UC-507 — MODIFIED (tham số)
- `PUT /config` nhận `interest_max_amount` (số nguyên 0..10.000.000; `0` = tắt nhận diện lãi); thiếu / hỏng → 10.000. Cài đặt › Tham số thêm ô "Lãi tiền gửi: tự ghi khoản dưới".
- ADDED AC: `{ interest_max_amount: 0 }` lưu được; `10000001` → 400, không ghi khoá nào.
  - Tests: [`test/settings.test.ts`](../../../../test/settings.test.ts) › "tham số lãi tiền gửi (261018-lai-tien-gui) › UC-507: mặc định 10.000; { interest_max_amount: 0 } lưu được; 10000001 → 400, không ghi khoá nào; giá trị hỏng trong DB → 10.000"; [`web/src/lib/settings.test.ts`](../../../../web/src/lib/settings.test.ts) (access UC-507 AC-18)

### balance UC-1106 — MODIFIED
- Khoản thu Ghi lãi luôn ở **Thu nhập thụ động** (report class), cả tài khoản thường. Phân loại lại tay vẫn thắng.
- ADDED AC: tháng có lương 30.000.000 và ba khoản lãi 68 + 50 + 37 → Lương và thu khác 30.000.000, Thu nhập thụ động 155.
  - Tests: [`test/reports.test.ts`](../../../../test/reports.test.ts) › "lãi tiền gửi ở Kết quả thu chi (261018-lai-tien-gui) › UC-1106: tháng có lương 30.000.000 và ba khoản lãi 68 + 50 + 37 (tài khoản thường) → Lương và thu khác 30.000.000, Thu nhập thụ động 155" (balance UC-1106 AC-4)

## Quyết định
ADR nháp (ADR-114) — **Lãi tiền gửi: máy tự ghi khoản thu + chia một fund vào ví của chính tài khoản (role → Tích sản; một ví → ví đó; còn lại → Có thì tốt), không lệnh chuyển, Thu nhập thụ động; ngoại lệ thứ hai của luật 6, chặn bởi ngưỡng ở Tham số.**
- Phương án bị loại: (a) chỉ gợi ý, bấm tay mỗi tháng — chủ nhà: "k cần … nó về đúng tk đó rồi"; (b) rule lãi trong bảng `rules` — phải dựng lại bảng, đổi CHECK, lẫn với rule lương ở form Cài đặt (reviewer P1); (c) cột "ví nhận lãi" trên tài khoản — thêm việc đặt cho người dùng; (d) nghĩa mới `interest` — mọi báo cáo, view, MCP học thêm nghĩa; (e) ghi `income` thẳng vào ví đích — phá bất biến "income vào ví Thu nhập rồi mới chia"; (f) khớp `LAI`/`TRA LAI` đơn — "trả lại", "cho thuê lại".
- Hệ quả: khoản chuyển nhỏ dưới ngưỡng, nội dung rỗng hoặc có "LAI TIEN GUI" (vd "trả lại tiền gửi nhầm"), của người lạ cũng thành "lãi" (dưới ngưỡng mỗi khoản, mặc định 9.999 ₫, báo ở tin sáng, gỡ gán được) — đổi lấy không phải bấm; lãi không qua Thuế (`taxable = 0`); lãi làm lần chia lương sau rót cho ví nhận ít đi đúng số lãi.

## Thiết kế
- `src/domain/interest-deposit.ts` (mới, thuần): `normalizeContent`, `isInterestLog(log, maxAmount)`, `interestWallet(account, wallets, streams, rules)`.
- `src/services/ingest.ts`: `ingestLog` thêm bước log lãi sau rule; `suggestFor` thêm gợi ý lãi; `assignLog` nhận split `interest`. `src/routes/logs.ts` › `parseSplit`; `src/mcp/tools.ts` › schema `assign_log`.
- `src/services/ledger.ts` › `allocateIncome` / `previewAllocation`: cờ `interest` (không `transferOrders`, bỏ luật Tích sản, ghi report class).
- `src/services/settings.ts`: `interest_max_amount`; `web/src/lib/settings.ts`, màn Tham số.
- `src/cron/daily.ts` (tin sáng): dòng lãi tự ghi hôm trước.
- PWA `web/src/screens/assign.tsx`: chip, loại Lãi tiền gửi, ô ví, dòng giải thích, ẩn "để chia sau", không gọi chia thử cho dòng lãi.
- DB: không migration (chỉ khoá `config` mới, thiếu = mặc định). `docs/core_design_rules.md` luật 6 sửa câu chữ.
- Rủi ro: tự ghi tiền vào là luật tiền — chủ nhà đã chọn (Vì sao). AI làm: code, test; chủ nhà duyệt bản này.

## Tự soát
- Ngày: 2026-10-18 · audit.py: 0 thiếu mục bắt buộc · verify.py: 1437 trích dẫn, 2409 link, 0 unresolved (proposal ngoài phạm vi quét)
- Đã tự sửa theo reviewer: `parseSplit` + MCP nhận `interest`; bỏ rule lãi (hết lẫn rule lương, `match_type`, CHECK, migration); từ khoá chặt, chuẩn hoá gộp khoảng trắng; ghi vị trí trong thứ tự ingest; dùng `allocateIncome` thay batch tự dựng; bỏ AC xoá report class khi gỡ; thêm exception tách dòng / ví tắt / ví Thu nhập; Đụng tới đủ UC, ADR
- Đã hỏi (6 câu, chủ nhà 2026-10-18): lãi vào đâu → ví của chính tài khoản; tự gán → không cần đặt gì, tự ghi; nhận diện → rỗng/BankAPINotify + 3 cụm; tính vào đã rót → có; ngưỡng → Tham số, mặc định 10.000; tài khoản nhiều ví → Có thì tốt
- Luật do proposal đặt (chờ duyệt cùng bản): `taxable = 0`; trần ngưỡng 10.000.000 (chủ nhà chốt); thiếu ví Có thì tốt → để gợi ý
- Còn mở: —

## Review kỹ thuật
`InterestReview` 2026-10-18 (bản nháp 1) — APPROVE_WITH_CHANGES: P1 `parseSplit`/MCP bỏ mất `interest`; P1 rule lãi lẫn rule lương; P1 từ khoá trùng "trả lại"; P2 `match_type`/ngưỡng lương chặn tự gán, "đã rót", batch thiếu id, AC report class trái UC-1105, thiếu exception và UC. Đã sửa hết (Tự soát). Lượt 2 (bản 2) — APPROVE_WITH_CHANGES, 0 P1: N1 ví quỹ `holding` ở bước 2 → loại; N2 kiểm ví trước khi ghi + lối sửa khi chia lãi lỗi → đã ghi; N3 chưa có tin cho log tự gán → thêm dòng tin sáng (notify UC-402); P3 cờ `interest` nội bộ, bỏ `wealth_note_required`, PWA không chia thử, bước cuối `matchLog` → đã ghi. Báo cáo `plans/reports/review-261018-lai-tien-gui.md`.

## Việc cần làm
- [x] Chủ nhà duyệt; commit propose `docs(UC-303,UC-305,UC-706,UC-203,UC-1106,UC-507): propose lai-tien-gui` (`8b16e1b`)
- [x] Test đỏ: `interest-deposit` thuần, ingest (tự ghi, gợi ý, gán, gỡ, thứ tự), allocate `interest`, settings, reports, PWA
- [x] Code (`6afc8c8`, `eebb011`, `2d63892`); `npm test`, `typecheck`, `build`; thử màn Gán 390px (local, 2026-10-18)
- [x] Hợp nhất UC, ADR-114, luật 6, glossary; `specs:gen` + `specs:check`; CHANGELOG `## Chưa phát hành` (feat → Y)
- [x] Phát hành v1.6.0 (`2df16e9`, Release `mzavn/vi-nha` v1.6.0); deploy nhà mình 2026-10-18 (không migration); GitBook `vi-nha-doc` `44bb5c9`; gán 3 khoản lãi còn chờ trên live qua đường Gán (vào Có thì tốt)
