# 261015-chot-thang-va-keo-tich-san: Chốt tháng bù ví chi lố trước, chia phần dư Tích sản / Ví Thưởng; kéo % Tích sản khi chia
- Status: archived
- BR: BR-02 (chia thu nhập Profit First), BR-03 (Tích sản không bị chạm)
- Đụng tới: allocation UC-207 (chốt tháng), UC-204 (lệnh chuyển), UC-202 (xem trước chia), UC-203 (ghi lần chia) · notify UC-403 (tin sáng ngày 1) · access UC-507 (tham số / config) · pwa UC-702 (Hôm nay), UC-709 (Cài đặt › Tham số), UC-715 (chi tiết khoản thu), UC-707 (tab Tích sản)
- Đóng: [OPEN] "chốt hai lần" của UC-207 (bảng `month_closes`)
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-15, chat (quyết định trích dưới; giao làm trọn tới phát hành) · Người duyệt kỹ thuật: reviewer agent, 2026-10-15, approve with changes — đã sửa
- Commit: propose `811759b` (+ `ad8bdf4`) · code `0528219` · merge `—`

## Vì sao

Hai vợ chồng chủ nhà chốt cách quản lý tiền (2026-10-15, bản ghi riêng ở repo gốc): **trả cho mình trước** (1% tối thiểu, 10% mặc định, 30% hướng tới) → **chi trong phần còn lại** → **phần dư (Lợi nhuận thêm) chia 50/50**: một nửa tiếp tục trả cho mình (Tích sản), một nửa vào **Ví Thưởng** dồn nhiều tháng cho trải nghiệm. Chủ nhà chốt hai việc cho app:

> "Chốt tháng: bù ví âm trước → còn dư thì xem trước, chia 50/50 Tích sản / Ví Thưởng"
> "thang tích sản thì để dạng KÉO % khi chia, tức là có kiểu KÉO thì ra số tiền hoặc nhập số tiền thì thang tự nhảy, mặc định số nhỏ nhất là 1%, to nhất là 100%, có 1 số khoản vào vẫn 0% được nhưng mà cần ghi chú nếu chọn là 0% để xem lý do là gì sau này tra lại"

Hiện trạng (kiểm 2026-10-15):
- Chốt tháng tự chạy ngày 1 (`src/cron/daily.ts:23-35`, `src/cron/schedule.ts:64-65` kể cả khi tắt tin sáng): số dư **dương** của phong bì chung quét **100%** sang Tích sản (`src/domain/close.ts:11-16`); phong bì **âm** chờ lần chia sau (UC-207 5b). Tháng chi lố vẫn "thưởng" phần dư; lương sau gánh phần âm. Không có ví Thưởng, không chọn được tỷ lệ; "đã chốt" chỉ kiểm bằng batch (UC-207 [OPEN]).
- Tích sản theo % luật nạp hoặc gõ tay ở Tự chia (ADR-108). Không kéo nhanh được; Tích sản 0 chỉ nhắc (UC-202 AC-7), không lưu lý do.

## Thay đổi spec

### allocation UC-207 — Chốt tháng (MODIFIED)
- **Người chốt, không phải cron.** Ngày 1 cron không ghi gì; tin sáng có câu mời chốt (dưới). Chỉ chốt được **tháng liền trước** tháng hiện tại (giờ VN); tháng khác → 400 `month_not_closable`. Tháng bị bỏ qua không mất: số dư là cộng dồn nên lần chốt sau gộp luôn. Chốt muộn vẫn ghi bút toán ở 23:59:59 ngày cuối tháng được chốt (như AC-4).
- **Ví tham gia** như hiện nay: ví đang dùng, `kind='envelope'`, `scope='shared'`, phe `must` (cả nhóm Có thì tốt) hoặc `nice`; ví Thưởng không bao giờ tham gia. Số dư = cộng dồn `v_wallet_flow` tới hết tháng M.
- **Bước 1 — bù ví chi lố.** Hố của ví âm = |số dư| − phần lương tháng M+1 đã rót vào ví đó (Σ `fund` active vào ví, `month_key` = M+1; tối đa bằng |số dư|) — lương sau đã bù thì chốt không bù lại. P = Σ số dư dương, N = Σ hố, C = min(P, N). Ví dương i góp `floor(C·bᵢ/P)`, đồng lẻ vào ví dương đứng đầu. Ghép cặp kiểu đổ thác: ví âm xếp theo hố giảm dần, ví dương theo số dư giảm dần, hoà thì theo `wallets.sort` rồi `id`; mỗi cặp một bút toán `transfer` ví → ví. P ≤ N → bù tới đâu hay tới đó, ví âm còn lại chờ lần chia sau; L = 0.
- **Bước 2 — Lợi nhuận thêm** L = P − C (khi > 0). Phần còn lại rᵢ của từng ví dương: `wealthᵢ = floor(rᵢ·X/100)` vào Tích sản, `rewardᵢ = rᵢ − wealthᵢ` vào Ví Thưởng. X: số nguyên 0–100, mặc định `config.month_close_wealth_pct` (đọc mặc định 50 trong code), PWA kéo bước 5. Chưa đặt Ví Thưởng (hoặc ví đó đã tắt) → X = 100, gửi X < 100 → 400 `invalid_input`.
- **Ghi:** một `db.batch`: INSERT `month_closes(month, closed_at, by_member_id, wealth_pct)` đầu batch (trùng khoá → 409 `already_closed`) + bút toán bù + quét + lệnh chuyển tiền (UC-204: gộp theo cặp tài khoản nguồn → đích của mọi move). Không có gì để ghi vẫn lưu dòng `month_closes` (thẻ Hôm nay biến mất).
- **Ví Thưởng:** `PUT /v1/settings/config { month_close_reward_wallet }` — ví đang dùng, phe `must` / `nice`, không phải phong bì chung đang tham gia chốt (nên là ví tích luỹ); sai → 400 `invalid_input`. `null` → bỏ.
- **API:** `GET /v1/month-close?wealth_pct=` (tháng = tháng liền trước): `{ month, closed, participants (số dư cuối tháng, số dư hiện tại sau chốt), covers, profit, wealthPct, toWealth, toReward, sweeps, transferOrders, rewardWalletId, warnings }`; `POST /v1/month-close { month, wealth_pct }`. PWA không tự tính — mọi số từ server.
- **Ví thành âm sau khi chốt muộn:** phần dư của M nằm trong "còn để chi" tới khi chốt; nếu đã tiêu sang tháng M+1 thì sau chốt ví đó âm — `warnings` liệt kê, sheet hiện "Sau khi chốt, Ăn uống còn −X (đã chi tháng 11 bằng tiền dư tháng 10) — sẽ bù ở lần chốt tháng 11". Đó là chi lố của M+1.
- **Tin sáng ngày 1 (notify UC-403):** có ví dương hoặc ví âm được bù → "Tháng 10: dư X sau khi bù chi lố — mở app để chốt"; L = 0 nhưng có bù → "Tháng 10: chi lố được bù Y, không còn dư — mở app để chốt"; không có gì → không dòng. Bỏ nhánh chốt khi tắt tin sáng.
- AC-1 (MODIFIED, seed): Ăn uống −500.000, Đi lại +1.200.000, Có thì tốt +3.440.000 When chốt (chưa có Ví Thưởng) Then bù Ăn uống 500.000: Có thì tốt góp 370.690, Đi lại 129.310; L = 4.140.000 → Tích sản +4.140.000; chốt lại → 409 `already_closed`.
- AC-2 (MODIFIED): ngày 1 cron không tạo giao dịch `S…`; tin sáng có câu mời chốt; tắt tin sáng thì không có gì chạy.
- AC-3 (MODIFIED): không có ví dương, không ví âm → không dòng tin sáng; `GET` trả `profit 0`, `POST` vẫn lưu `month_closes`.
- AC-5 (MODIFIED): phong bì ở nhiều tài khoản → lệnh chuyển gộp theo cặp tài khoản nguồn → đích (Tích sản và Ví Thưởng ở hai tài khoản khác nhau → hai lệnh).
- ADDED AC-6 (bù âm trước, X = 50): Ăn uống +2.000.000, Đi lại +400.000, Khác −1.500.000, Mua sắm −600.000 (fixture: bốn phong bì chung) Then bù Khác 1.500.000 rồi Mua sắm 600.000; Ăn uống góp 1.750.000, Đi lại 350.000; L = 300.000: Tích sản +150.000, Ví Thưởng +150.000; mọi ví tham gia về 0.
- ADDED AC-7 (dư không đủ): Ăn uống +500.000, Khác −1.500.000 → Khác còn −1.000.000, Ăn uống 0, L = 0.
- ADDED AC-8 (tỷ lệ): L = 1.000.000, `wealth_pct = 100` → Tích sản +1.000.000, Ví Thưởng không đổi; 101 / −1 / 2,5 → 400 `invalid_input`; chưa đặt Ví Thưởng và 50 → 400.
- ADDED AC-9 (lương sau đã bù): Khác −1.500.000 cuối tháng 10; lương 3/11 rót 1.500.000 vào Khác; Ăn uống +2.000.000 → chốt tháng 10 không bù Khác; L = 2.000.000.
- ADDED AC-10 (chỉ tháng liền trước): hôm nay 15/11 → `POST { month: "2026-09" }` → 400 `month_not_closable`.

### allocation UC-204 — Lệnh chuyển (MODIFIED bước 3b)
Chốt tháng sinh nhiều move mỗi tài khoản nguồn (bù ví khác tài khoản, Tích sản, Ví Thưởng): gộp theo cặp (nguồn, đích); bù giữa hai ví cùng tài khoản không sinh lệnh.

### allocation UC-202 / UC-203 — Kéo % Tích sản khi chia
- Sheet Chia thử (nhập thu nhập tay, màn Gán, chi tiết khoản thu) có lựa chọn hai nút ở đầu: **Có Tích sản** (mặc định) · **Không Tích sản** (chủ nhà, 2026-10-15: "để 2 lựa chọn khi tiền vào … mặc định chọn có tích sản thì là để kéo từ 1% trở lên, thanh luôn để mặc định 10%, còn không thì hiển thị nút lý do").
  - **Có Tích sản:** thanh kéo **1–100%**, vạch 1% · 10% · 30%, **mặc định luôn 10%** (không theo % luật nạp). Kéo → số tiền = làm tròn (% × khoản thu) tới nghìn (khoản thu dưới 100.000 thì tới đồng; tối thiểu 1 đồng); gõ số → thanh nhảy theo (một chữ số lẻ; gõ số dưới 1% thì kẹp lên 1%). PWA **luôn gửi** `wealth_amount`. Theo luật: phần còn lại chia theo luật nạp, xem trước lại qua server. Tự chia: ô Tích sản đồng bộ với thanh.
  - **Không Tích sản:** ẩn thanh, hiện ô **Lý do** bắt buộc ("Vì sao lần này không trả cho mình?"); thiếu thì nút ghi tắt; gửi `wealth_amount: 0` + `wealth_note`.
  - Nguồn thu khóa 100% (vd tiền người thuê) → không hiện lựa chọn này.
  - Lý do lưu ở `allocation_runs.wealth_note` (chỉ khi Tích sản 0); xem lại ở chi tiết khoản thu và tab Tích sản (danh sách "Lần chia không trả cho mình": ngày, khoản thu, lý do — chỉ khoản thu còn hiệu lực).
- **Hợp đồng `wealth_amount`** (`POST /v1/allocate`, `/allocate/preview`): số nguyên ≥ 0, ≤ khoản thu. Không nguồn thu → thay khoản cắt % của Tích sản; Thuế vẫn cắt. Có nguồn thu → thay phần khóa Tích sản của nguồn (nguồn không khóa Tích sản → thêm khoản cắt Tích sản); nguồn khóa 100% → 400 `invalid_amounts`. Tích sản + Thuế + phần khóa khác > khoản thu → 400 `invalid_amounts` (không 500). Gửi cùng `amounts` → 400 `invalid_amounts`.
- **Lý do 0%:** `POST /v1/allocate` với Tích sản 0 (qua `wealth_amount` hoặc `amounts` không có / bằng 0 Tích sản) thiếu `wealth_note` → 400 `wealth_note_required`. Thứ tự kiểm: `invalid_amounts` → `amounts_mismatch` → `wealth_note_required`. `/allocate/preview` không bao giờ trả `wealth_note_required`. Chia tự động (lương khớp rule ở ingest) và MCP không áp mức 1%, không bắt lý do.
- MODIFIED UC-202 AC-7 (thay một phần ADR-108): Tích sản 0 → ô Lý do bắt buộc; có lý do thì ghi được.
- ADDED AC-8 (UC-202): khoản thu 24.000.000, luật Tích sản 30% → mặc định **Có Tích sản**, thanh 10%, ô 2.400.000; kéo 30% → 7.200.000; gõ 3.600.000 → 15%; gõ 100.000 → kẹp 1% (240.000); chọn **Không Tích sản** → thanh ẩn, ô Lý do hiện, nút ghi tắt tới khi có lý do.
- ADDED AC-13 (UC-203): `wealth_amount: 3600000` → Tích sản +3.600.000, phần còn lại 20.400.000 theo luật; `0` không note → 400 `wealth_note_required`, có note → ghi, `wealth_note` lưu, tab Tích sản liệt kê; khoản thu 10.000.000 tính thuế 10%, `wealth_amount: 9500000` → 400 `invalid_amounts`.
- ADDED AC-14 (UC-203): Tự chia `amounts` không có Tích sản → cần `wealth_note`; preview cùng body → 200.

## Quyết định
**ADR-111 — Chốt tháng là một quyết định của người: bù ví chi lố trước, phần dư chia Tích sản / Ví Thưởng theo tỷ lệ chọn mỗi tháng.** Thay UC-207 5b và quét 100% tự động. Lý do: công thức của nhà "Doanh thu được chi − chi phí = Lợi nhuận thêm" — chi lố trừ trước; phần dư thưởng có kiểm soát để không "kẹt tiền". Hệ quả: tháng chưa chốt thì phần dư vẫn hiện trong còn để chi; chỉ chốt tháng liền trước; `month_closes` chặn chốt hai lần. Loại: tự chốt 50/50 không hỏi (chủ nhà chọn xem trước).

**ADR-112 — Khi chia: Có Tích sản (kéo 1–100%, mặc định 10%) hoặc Không Tích sản (bắt buộc lý do).** Thay một phần ADR-108 (Tích sản 0 ở Tự chia nay cần lý do). Mặc định 10% bất kể luật nạp (thang của nhà: 1% tối thiểu, 10% mặc định, 30% hướng tới); người kéo / gõ thắng. Lý do lưu để tra lại — giữ kỷ luật "trả cho mình trước" mà không cứng nhắc.

## Thiết kế
- `src/domain/close.ts`: `planMonthClose({ balances, wallets, coveredByNextIncome, wealthPct, rewardWalletId })` thuần, theo đúng thuật toán trên. `src/services/ledger.ts`: `previewMonthClose`, `closeMonth(db, month, { wealthPct, memberId })`. `src/cron/daily.ts`, `src/cron/schedule.ts`, `src/notify/format.ts`: câu mời chốt.
- `src/domain/allocation.ts`: `wealthOverride` thay bước Tích sản / phần khóa; lỗi cấu hình do override → `DomainError invalid_amounts`.
- `src/routes/v1.ts`: `wealth_amount`, `wealth_note`, `/month-close`. `src/services/settings.ts`: hai khoá config.
- Migration 0034 (schema v1.34): `allocation_runs.wealth_note`; bảng `month_closes`, điền sẵn tháng đã có batch `S%`; `docs/schema.sql`, `test/schema.test.ts`, `test/app.test.ts`, access `entities.md`.
- PWA: thẻ "Chốt tháng" ở Hôm nay (điện thoại + máy tính) khi `GET` trả `closed: false` → sheet xem trước (bảng bù, L, thanh X bước 5, Tích sản / Ví Thưởng, lệnh chuyển, cảnh báo, nút **Chốt tháng**); Cài đặt › Tham số: chọn Ví Thưởng, X mặc định; thanh kéo trong `AllocationPreview`; tab Tích sản danh sách lần chia 0%. Hàm thuần `web/src/lib/month-close.ts`, `web/src/lib/wealth-slider.ts` + test.
- [OPEN]: chưa có MCP cho chốt tháng; chốt cần mạng.

## Review kỹ thuật
Reviewer agent (2026-10-15) — approve with changes. Đã sửa: không bù hai lần khi lương tháng sau đã rót vào ví âm; bảng `month_closes` chặn chốt hai lần; chỉ chốt tháng liền trước; hợp đồng `wealth_amount` (nguồn thu, thuế, lỗi 400 không 500); ghi rõ thay đổi Tự chia (ADR-112 thay một phần ADR-108; preview không bắt lý do); viết lại AC UC-207; thuật toán bù và chia xác định; cảnh báo ví âm khi chốt muộn; kiểm Ví Thưởng; bỏ chốt khi tắt tin sáng, câu mời chốt; xem trước từ server; UC-204 3b; mặc định thanh từ bản xem trước, luôn gửi `wealth_amount`; migration 0034 đầy đủ; danh sách 0% chỉ khoản thu còn hiệu lực; khoản thu nhỏ làm tròn tới đồng.

## Việc cần làm
- [x] Review kỹ thuật; commit propose
- [x] Test đỏ → code (AC ở trên); rà bảo mật (security-reviewer: 0 critical/high, 1 medium + 2 low đã sửa — Ví Thưởng chỉ ví chung, lọc ký tự điều khiển, nhật ký lần chia)
- [x] Sao lưu D1 (`before-0034`, diễn tập migration 0034 trên bản sao); deploy prod 2026-10-16 ~00:02 giờ VN, version `9325ae00`; xem 390px / 1280px
- [x] Hợp nhất specs (+ ADR-111, ADR-112)
- [ ] GitBook; CHANGELOG; phát hành
