# Luật lõi cho app quản lý tiền (v0.6)

> 📖 **Đọc trước:** `profit_first_phuong_phap.md` — luật gốc số 0, bốn phe, cash→assets, ba trục.
> File này là **luật thi hành**: *cái gì là đúng*, kèm ví dụ đời thường.
> v0.5 = v0.4 (7/2026) + sổ tay 9/2026 (thuế 10%, Must/Have, danh mục, tiền mặt, đa tài khoản).
> v0.6 (21/9/2026) = v0.5 + 11 quyết định khi validate plan: thứ tự ưu tiên của engine, nhịp chia, quét cuối tháng và bù ví âm,
> tuần → tháng, Quỹ an tâm theo mức tối thiểu, đối soát hai lớp, rà soát 02:00, đăng nhập. Xem §9.

---

## 1. Sáu luật không được vi phạm

1. **Sổ chỉ ghi thêm.** Không sửa đè, không xoá. Sai thì `status='void'` rồi ghi bút toán mới.
2. **Hai lớp tách hẳn.** `bank_logs` (ngân hàng bắn về, bất biến) ≠ `transactions` (đã diễn giải, gán lại thoải mái).
3. **`meaning` quyết định, không phải hướng tiền.** Tiền vào chưa chắc là thu nhập; tiền ra chưa chắc là chi tiêu.
4. **Một quy ước dấu, không ngoại lệ:** `wallet_id` = ví **được cộng**, `counter_wallet_id` = ví **bị trừ**.
   Nên `spend` ghi ví vào `counter_wallet_id`. `spend` **bắt buộc có `category_id`** (CHECK ở DB).
5. **Số tổng hợp thì tính ra, không lưu.** Số dư, đã tiêu, tiến độ, cash/assets — đều là view.
6. **Máy chỉ được đoán `spend` và `transfer`.** Tiền vào **luôn phải hỏi**, trừ khoản khớp mẫu lương.
   *Để rule tự gán tiền vào thành thu nhập = thu nhập ảo + chia lương hai lần.*

---

## 2. Chín ý nghĩa giao dịch

| `meaning` | Nghĩa | Tác động ví |
|---|---|---|
| `spend` | tiêu | − ví (ghi ở `counter_wallet_id`) |
| `income` | thu nhập thật về | + ví Thu nhập, rồi đem đi chia |
| `refund` | hoàn về ví | + ví (`wallet_id`), − đã tiêu; KHÔNG chia lại |
| `transfer` | chuyển nội bộ (gồm rút ATM) | + ví đích, − ví nguồn; **loại khỏi sổ thu/chi** |
| `fund` | nạp ví khi chia lương | + ví đích, − Thu nhập |
| `buy_asset` | cash → assets trong CÙNG ví Tích sản | **không đổi số dư**, chỉ đổi trạng thái |
| `lend` | cho mượn / trả hộ | **không đụng ví**; tiền rời tài khoản, cộng vào sổ phải thu |
| `collect` | tiền cho vay quay về (ADR-72) | **không đụng ví**, không phải thu nhập, không chia; tiền vào tài khoản, trừ sổ phải thu |
| `adjust` | bút toán điều chỉnh (đếm ví lệch) | + hoặc − tuỳ đặt ở `wallet_id` hay `counter_wallet_id` |

---

## 3. Bốn loại ví

| Loại (`kind`) | Cách hoạt động | Reset mỗi kỳ? | Ví dụ |
|---|---|---|---|
| `envelope` | tiêu theo kỳ | ✅ | Ăn, Đi lại, Chơi, Có-thì-tốt |
| `accrual` | tiền chỉ tích lại | ❌ | Tích sản, Du lịch, Về quê |
| `bill` | tự trừ hoá đơn hằng tháng | ❌ | Điện nước mạng |
| `holding` | trạm trung chuyển | ❌ | Thu nhập |

Mỗi ví thuộc **một phe** và **trú ở một tài khoản** (`account_id`). Nhiều ví có thể chung một tài khoản.

### Ví thật của nhà (sửa số trong `seed.sql`)

| Ví | Phe | Nhóm | Loại | Chế độ nạp | Con số |
|---|---|---|---|---|---|
| Thu nhập | holding | — | holding | — | nhận lương / thu ngoài |
| **Tích sản** | wealth_building | — | accrual | percent | **30%** — cash→assets, Quỹ an tâm = N tháng chi Must (động) |
| Thuế | tax | — | accrual | percent | **10% chỉ trên thu nhập chưa khấu trừ** |
| Chơi – mỗi người | nice | — | envelope | flat | 820k/tuần |
| Du lịch | nice | — | accrual | **goal** | đích 15tr, có hạn |
| Nhà ở | must | must | accrual | lump | ghi trọn vào tháng trả |
| Ăn uống | must | must | envelope | flat + sàn | 625k/tuần, sàn 500k |
| Đi lại | must | must | envelope | flat + sàn | 300k/tuần, sàn 200k |
| Điện nước mạng | must | must | bill | flat | 300k/tháng |
| Về quê | must | must | accrual | flat (dồn) | 1tr/tháng |
| **Có thì tốt** | must | **have** | envelope | **remainder** | nhận phần còn lại |

---

## 4. Chia tiền — nghi thức trung tâm

Chạy **ngay khi một khoản `income` được xác nhận** (lương khớp rule thì tự chạy). Ngày 10 và 25 chỉ là **lời nhắc**
nếu còn income chưa chia — không phải nhịp chia.

Thứ tự "rót" Tích sản → Thuế → Hưởng thụ → Vận hành là **thứ tự trình bày**. Thứ tự engine **thực thi** là thứ tự ưu tiên
dưới đây — khi đủ tiền hai thứ tự cho cùng kết quả, khi thiếu thì thứ tự này quyết định (và nó chính là thứ tự bóp đọc ngược):

```
pool = số tiền thu nhập
1. wealth_building : income × 30%                     (ví Tích sản — MỘT ví; luôn trích)
2. tax      : nếu taxable thì income × 10%     (lương đã khấu trừ → bỏ qua)
3. sàn must : mỗi ví Must nhận tới floor_amount còn thiếu, theo priority
4. must đủ  : nâng ví Must từ sàn lên dự kiến tháng còn thiếu, theo priority
5. nice     : ví goal (số cần/kỳ, không vượt phần còn thiếu) → ví nice flat/percent, theo priority
6. have     : ví remainder nhận phần còn lại — có thể 0, KHÔNG âm
```

- **Còn thiếu = nhu cầu tháng + hố âm mang sang − đã nạp trong tháng.** Khoản thu thứ hai trong tháng chỉ nạp phần thiếu; dư chảy vào Have.
- **Ví tiêu lố tháng trước được bù:** số âm đầu tháng cộng vào cả sàn lẫn dự kiến của ví đó, nên tháng này ví vẫn đủ ngân sách.
  Phần bù tự nhiên lấy từ Có-thì-tốt. *Chi tiêu là để thấy mình tốt dần lên — trung đạo, không tuyệt đối.* Giao diện phải ghi rõ "đã bù X".
- Phong bì tuần: **nhu cầu tháng = số tiền tuần × số ngày thứ Hai rơi vào tháng đó** (4 hoặc 5).
- Cùng `priority` → chia theo tỷ lệ nhu cầu (hai ví Chơi của vợ và chồng).
- Bất biến: tổng các `fund` của một lần chia **bằng đúng** số tiền income.

Thiếu tiền thì Have về 0 → nice bị bóp → must tụt từ dự kiến về sàn → **Tích sản không suy chuyển**.
Must dưới sàn → cờ `underfunded`, **vẫn ghi để lộ sự thật**, tuyệt đối không tự ý vay phần đã khóa.

**Phân bổ trong app là ảo cho tới khi tiền đi thật.** Vì Tích sản và Thuế ở ngân hàng khác,
mỗi lần chia sinh **lệnh chuyển tiền** (`transfer_orders`) với nội dung `PF` + mã ngẫu nhiên riêng từng lệnh;
log về tự khớp memo → `done`. Quá 3 ngày chưa chuyển → nhắc.

### Ba ràng buộc kỹ thuật (đừng quên)
- `remainder` **không tính được bằng SQL** (phụ thuộc thứ tự rót) → app tính rồi ghi ra `fund`.
- `week_key` **tính ở tầng app theo ISO week** — `strftime('%Y-W%W')` của SQLite không chuẩn ISO.
- Mọi kỳ tính theo **Asia/Ho_Chi_Minh**, không theo UTC của Worker.

---

## 5. Kỳ và chốt sổ — hai nhịp khác nhau

| Nhịp | Việc | Lưu ý |
|---|---|---|
| **Hằng tuần** | counter phong bì tuần **về 0** | tự nhiên vì counter là view theo `week_key`; tiền dư **không mất, không chuyển đi đâu** |
| **Cuối tháng** | số dư **dương** của **phong bì chung** quét sang Tích sản | ghi `transfer`; ví cá nhân, `accrual`, `bill` giữ nguyên; **ví âm không bị đụng — được bù ở lần chia kế tiếp** |
| **Ngày 10 & 25** | **lời nhắc** | nhắc nếu còn income chưa chia — không tự chia |
| **Chủ nhật** | **đếm ví tiền mặt** + nhập số dư các TK ghi tay | lệch → bút toán `adjust` |
| **02:00 mỗi đêm** | **rà soát** giao dịch ngày hôm trước qua API SePay | giao dịch webhook bỏ sót → tạo thêm log; chạy lại không sinh trùng |
| **Cuối năm** | quyết toán thuế | thừa → chuyển sang Tích sản |

---

## 6. Ba đường tiền vào sổ

| Đường | Ai khởi động | Ghi chú |
|---|---|---|
| `POST /webhooks/sepay` | ngân hàng | mọi TK đã đăng ký, của cả hai vợ chồng |
| `POST /v1/transactions` | người nhập tay | tiền mặt, TK không có SePay, tiền ra của TK mà SePay chỉ báo tiền vào — **bắt buộc có danh mục khi chi** |
| Cron | đồng hồ | chốt kỳ, nhắc, digest |

### Luật khớp cặp chuyển nội bộ (chống đếm hai lần)
Chuyển giữa 2 TK của mình sinh **2 log**. Thứ tự thử khớp:
1. nội dung chứa mã lệnh `PF XXXXXX` → khớp `transfer_orders`
2. tài khoản đối ứng thuộc `accounts` của hộ → `transfer`
3. có log ngược hướng, **cùng số tiền**, lệch ≤ 10 phút → ghép thành **1** `transfer`
4. không khớp mà là tiền vào → **pending, luôn hỏi**

Rút ATM: log `out` không có chân `in` đối ứng → gợi ý sẵn "Rút tiền mặt" → `transfer` bank → cash.

---

## 7. Đối soát — bằng chứng "tiền là thật"

- **Số dư SePay báo kèm (`accumulated`) không dùng** (ADR-87): số lũy kế đó sai ở tài khoản thật (âm, hoặc dương mà lệch gốc), nên app không lưu, không so.
- **Sổ ↔ giao dịch ngân hàng:** sổ `transactions` so với sổ `bank_logs`; tổng các `transactions` tách ra từ một log phải **bằng đúng** `log.amount`.
  Log còn `pending` hiện riêng là **"chưa gán"** — không tính là lệch.
- **Số dư thật:** chỉ đến từ người nhà — xem app ngân hàng hoặc đếm ví rồi **Nhập số dư**, chênh lệch ghi `adjust` (tài khoản SePay: gán hết giao dịch chờ trước).
- **Tiền mặt:** không có feed → đếm ví, như trên.
- **Rà soát 02:00:** mỗi đêm đối chiếu sổ với lịch sử giao dịch của SePay cho các TK đã nối; thiếu thì tạo thêm log (`source='backfill'`), tin 07:00 báo đã vá bao nhiêu.
- Lệch ≠ 0 → badge đỏ ở màn Hôm nay + nhắc Telegram sáng hôm sau.

---

## 8. Thông báo (Telegram, Zalo, máy)

| Khi nào | Nội dung |
|---|---|
| Có log chưa gán | "5 giao dịch chưa gán" — cron mỗi 15 phút (đêm 01:00–04:00 mỗi giờ) gom log đã chờ ≥ 60 giây (để chân thứ hai của chuyển nội bộ kịp về); tắt được, không báo trong giờ yên lặng (mặc định 22:00–06:30), hết giờ yên lặng thì gom lại báo một tin |
| Lương về & đã chia | bảng chia + lệnh chuyển tiền cần làm |
| Vượt ngân sách | chỉ hiện mục ≥ 80% |
| 7:00 sáng (mặc định) | còn để chi tuần này · mục sắp vỡ · quỹ đạt % · đối soát |
| 8:00 thứ 2 (mặc định) | tổng kết tuần + top 5 danh mục tiêu nhiều nhất |
| Chủ nhật | nhắc đếm ví tiền mặt |

Giờ tin sáng, ngày giờ tổng kết tuần, giờ yên lặng và bật/tắt từng loại chỉnh ở Cài đặt › Thông báo › **Giờ nhắc**, dùng chung cả nhà (ADR-68); giờ là bội số 15 phút (ADR-70).

Mỗi tin gửi tới Telegram và Zalo (bản đầy đủ; Zalo nhận chữ thường, tối đa 2.000 ký tự) và mọi máy đã bật thông báo (bản ngắn) — ADR-79, ADR-80. Zalo nối bằng mã 6 số nhắn cho bot, không nhập chat_id tay.

Ghi `notifications` trước khi gửi (UNIQUE kind+day_key+chat_id) → cron chạy lại không gửi trùng.

---

## 9. Các quyết định — ĐÃ CHỐT

| Quyết định | Chốt |
|---|---|
| Thứ tự **rót** (trình bày) | Tích sản → Thuế → Hưởng thụ → Vận hành (**phần còn lại**) |
| Thứ tự **ưu tiên** (engine) | Tích sản → Thuế → sàn Must → Must đủ → Hưởng thụ → Have |
| Nhịp chia | **chia ngay từng income**; ngày 10/25 chỉ nhắc |
| Thứ tự **bóp** | Have → nice → must tới sàn → **không chạm Tích sản** |
| Tích sản | **1 ví**, hai trạng thái tiền: cash (Quỹ an tâm đếm phần này) → assets |
| Quỹ an tâm | **không hardcode**: `safety_fund_months × chi Must TB 3 tháng`, đổi số tháng ở `config`. "Chi Must" = **chỉ nhóm Must**, không gồm Có-thì-tốt (mức sống tối thiểu) |
| Quy ước dấu | `wallet_id` cộng · `counter_wallet_id` trừ · **không ngoại lệ**; `spend` bắt buộc có danh mục |
| Thuế | 10% **chỉ trên thu nhập chưa khấu trừ**; thừa cuối năm → Tích sản |
| Tiền nhà trả cục | ghi **cả cục** vào tháng trả, không rải, không rút Tích sản để trả |
| Hoàn tiền lệch kỳ | tính vào **kỳ hiện tại**, vẫn `link_id` về khoản chi gốc |
| Tuần dư | counter về 0; **cuối tháng** mới quét sang Tích sản — chỉ phong bì chung dương |
| Ví tiêu lố | **được bù ở lần chia kế tiếp**, phần bù lấy từ Có-thì-tốt; giao diện ghi rõ "đã bù X" |
| Webhook sót | cron **02:00** rà lại giao dịch ngày hôm trước, thiếu thì tạo thêm |
| Ngân hàng | cả nhà dùng **MB** nối SePay; một số TK ghi tay (`sepay_enabled=0`) |
| Mẫu lương | chỉ tự ghi thu nhập và tự chia khi số tiền ≥ `config('salary_min_amount')` (mặc định 1.000.000 ₫). Nội dung chuyển khoản ai cũng gõ được — khoản nhỏ hơn thì hỏi như mọi tiền vào khác |
| Huỷ khoản thu đã chia | gỡ luôn lần chia (huỷ bút toán nạp ví, bỏ lệnh chuyển chưa làm); tiền đã chuyển thật theo lần chia đó thì phải gỡ lệnh chuyển trước — chốt cả ở DB (trigger), không chỉ ở code |
| Mã lệnh chuyển tiền | `PF` + 6 ký tự ngẫu nhiên, riêng từng lệnh — không đoán được |
| Tài khoản có bank feed | **chiều tiền SePay báo về chỉ nhận giao dịch từ ngân hàng** (ADR-66): tiền vào TK nối SePay không nhập tay (đếm hai lần); tiền ra cũng vậy nếu TK bật "SePay báo cả tiền ra" (`sepay_out`, mặc định theo tài liệu SePay — MB chỉ báo tiền vào nên khoản chi MB nhập tay), log tiền ra của TK "chỉ tiền vào" không tự gán theo rule mà chờ người xem. Không đếm số dư khi còn log chưa gán. Webhook và rà soát đêm báo hai log cùng tài khoản, số tiền, chiều, lệch ≤ 3 phút mà một bên thiếu mã tham chiếu → **không đoán**: log sau vẫn được ghi nhưng không tự khớp, chờ người gán với ghi chú "có thể trùng" (bỏ lặng lẽ là mất tiền, tự khớp là có thể chia lương hai lần) |
| Tuần → tháng | nhu cầu tháng của phong bì tuần = số tiền tuần × số thứ Hai của tháng |
| Đăng nhập | một mật khẩu chung + chọn người; `private` là ẩn lịch sự, không phải bảo mật |
| Nợ nội bộ vợ chồng | **không theo dõi** |
| "Ai nợ mình" | sổ phải thu ngoài sổ cái: `lend` đi, `collect` về (không dùng `refund` — `refund` cộng ví) |
| Danh mục | tách khỏi ví; chọn danh mục thì ví tự điền |
| Tiền mặt | là một `account` kind='cash'; rút ATM = `transfer` |
| Kiến trúc | **Cloudflare Worker + D1** độc lập, core thuần qua port `Store/Notifier/Config` |
| Thông báo | Telegram bot · Zalo Bot (ADR-80) · thông báo đẩy trên PWA |

---

## 10. Cấu trúc dữ liệu

**Schema chạy được: `schema.sql` (v1.3) + `seed.sql`** — 13 bảng + 15 view, đã test bằng sqlite3.

| Bảng | Việc |
|---|---|
| `members` · `accounts` · `wallets` | ai · tiền nằm đâu · ngân sách |
| `allocations` | luật nạp + số dự kiến / mục tiêu quỹ (target, floor, priority) |
| `categories` | danh mục chi + ví mặc định |
| `bank_logs` → `transactions` | hai lớp: thô bất biến → đã diễn giải |
| `rules` | quy tắc tự gán |
| `cash_counts` · `transfer_orders` · `tax_settlements` · `notifications` · `config` | phụ trợ |

**Tính ra, không lưu:** `v_wallet_balance` · `v_spent_week/month` · `v_goal_progress` · `v_wealth_building` ·
**`v_safety_fund`** · `v_spend_by_category` · `v_account_logs` · `v_reconcile` (`book_drift`, "chưa gán").
Ngân sách theo kỳ (dự kiến / thực tế / còn lại) là **query có tham số** trong `src/db/queries.ts`, không phải view.
