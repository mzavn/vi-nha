# Business Requirements — Ví nhà

> Tầng 1 của SDD: **vì sao làm**. Mỗi BR ngắn, đo được, chưa nói giải pháp.
> Nguồn: `README.md` (Vấn đề, Định nghĩa xong), `plans/260921-2228-profit-first-pwa/context.md` (hợp đồng: Outcome, Constraints, Non-goals), `docs/profit_first_phuong_phap.md` §0.
> Người chịu hậu quả (stakeholder): hai vợ chồng chủ hộ — vừa là PO vừa là người dùng.

## Bối cảnh chung

Cách quản tiền thường là `Thu nhập − Chi phí = Tiết kiệm`, nên tiết kiệm là phần dư và gần như luôn bằng 0. App đảo lại: `Thu nhập − Tích sản = Chi phí`. Tích sản và Thuế bị cắt ra và **khóa trước**; phần còn lại mới là ngân sách sống.

Hai luật gốc (hiến pháp, `docs/profit_first_phuong_phap.md` §0):
1. **Tiền là thật, chi là chi thật.** Chỉ ghi và chỉ chia tiền đã thật sự về tài khoản.
2. **Phân bổ trước rồi mới chi.** Không mượn ngược phần đã khóa; sự eo hẹp phải nhìn thấy được.

Đơn vị kinh tế là **hộ**, không phải từng người. Chuyển tiền giữa vợ và chồng là chuyển nội bộ, không phải thu nhập.

---

## BR-01: Biết còn bao nhiêu để chi (tuần/tháng) ở mọi kênh
- **Goal:** mở app, đọc tin sáng hoặc hỏi Claude là biết ngay *còn bao nhiêu để chi tuần này*, mục nào sắp vỡ.
- **Success metric:**
  - Màn Hôm nay, tin Telegram 07:00 và tool MCP `get_snapshot` trả **cùng một con số**.
  - Ghi xong một khoản chi thì thấy ngay ví đó còn bao nhiêu.
- **Out of scope:** dự báo chi tiêu, biểu đồ xu hướng dài hạn.
- **Use cases:** xem `specs/ledger/`, `specs/pwa/`, `specs/notify/`, `specs/mcp/`.

## BR-02: Thu nhập tự chia theo Profit First; Tích sản không bao giờ bị bóp
- **Goal:** mỗi khoản thu nhập được chia ngay theo thứ tự ưu tiên, không cần tính tay.
- **Success metric:**
  - Bảy case của phase 02 ra **đúng từng đồng**; tổng các bút toán nạp ví của một lần chia bằng đúng số tiền thu nhập.
  - Thiếu tiền: Có-thì-tốt về 0 → Hưởng thụ bị bóp → Must tụt về sàn, cờ `underfunded` bật; **Tích sản vẫn đúng tỷ lệ**.
  - Khoản thu thứ hai trong tháng chỉ nạp phần còn thiếu.
  - Ví tiêu lố tháng trước được bù ở lần chia kế tiếp, giao diện ghi rõ "đã bù X".
  - Đầu tháng, phong bì chung còn dư được quét sang Tích sản **đúng một lần**.
- **Out of scope:** tự động chuyển tiền thật giữa ngân hàng (app chỉ sinh lệnh chuyển để người làm).
- **Use cases:** `specs/allocation/`.

## BR-03: Mọi khoản tiền vào sổ: tự động qua bank feed, nhập tay nhanh, cả khi offline
- **Goal:** không khoản nào bị bỏ ngoài sổ.
- **Success metric:**
  - Chuyển khoản thật ở tài khoản MB → có trong app ngay; webhook sót thì 02:00 tự vá.
  - Tiền mặt: ghi một khoản 200k trong 3 chạm, dưới 5 giây.
  - Mất mạng vẫn nhập được; có mạng thì tự đồng bộ, gửi lại bao nhiêu lần cũng chỉ ghi **một** lần.
- **Out of scope (V1):** đọc sao kê CSV, OCR hoá đơn, thẻ tín dụng.
- **Use cases:** `specs/ingest/`, `specs/ledger/`, `specs/pwa/`.

## BR-04: Sổ đúng với tiền thật: không mất, không đếm hai lần, đối soát được
- **Goal:** tổng sổ khớp số dư ngân hàng từng tài khoản; mọi sai lệch lộ ra thay vì bị giấu.
- **Success metric:**
  - Chuyển 5tr giữa hai tài khoản của hộ → **một** bút toán chuyển nội bộ, không sinh thu nhập ảo.
  - Một giao dịch ngân hàng vào sổ **nhiều nhất một lần**; giao dịch hỏng bị từ chối và được báo, không bị bỏ lặng lẽ.
  - Tiền vào không rõ nguồn **luôn phải hỏi** (trừ lương khớp mẫu và đủ ngưỡng).
  - Đối soát: log chưa gán hiện là "chưa gán", không bật báo lệch giả; lệch thật → cảnh báo đỏ.
  - Sổ chỉ ghi thêm; sai thì huỷ (`void`) rồi ghi lại, không sửa đè.
- **Use cases:** `specs/ledger/`, `specs/ingest/`.

## BR-05: Claude đọc/ghi được qua MCP, đúng số như app
- **Goal:** hỏi "còn bao nhiêu để chi tuần này", ghi khoản chi bằng lời qua Claude.
- **Success metric:** `get_snapshot` trả đúng con số như màn Hôm nay; tool ghi dùng cùng luật với API.
- **Use cases:** `specs/mcp/`.

## BR-06: Nhắc chủ động qua Telegram
- **Goal:** không cần mở app cũng biết tình hình và việc cần làm.
- **Success metric:**
  - 07:00 mỗi sáng: còn để chi tuần này, mục sắp vỡ, quỹ đạt %, đối soát.
  - Có giao dịch chưa gán → được báo; Telegram lỗi thì báo lại tới khi gửi được.
  - Cron chạy lại **không gửi trùng**.
  - Tin tới cả Telegram lẫn **trên PWA đã bật thông báo** (mỗi máy người đó bật ở Cài đặt) — người không dùng Telegram vẫn nhận được (change `261001-pwa-web-push`, ADR-64).
  - Tin tới cả **Zalo** của người đã nối (nhắn mã 6 số cho bot Zalo của nhà) — kênh thông báo thứ ba theo yêu cầu chủ nhà (ADR-80).
- **Out of scope (V1):** Telegram chiều vào (lệnh, inline button). Bot Zalo chỉ đọc tin nhắn để nối người bằng mã, không nhận lệnh.
- **Use cases:** `specs/notify/` (Zalo: UC-411); bật thông báo trên máy: `specs/pwa/` UC-714; nối Zalo: `specs/access/` UC-507, UC-508, `specs/pwa/` UC-709.

## BR-07: Đo được tích lũy: Tích sản cash/assets, Quỹ an tâm, quỹ mục tiêu, thuế
- **Goal:** trả lời "tích lũy được bao nhiêu, quỹ đạt bao nhiêu %".
- **Success metric:**
  - Tích sản là **một ví** hiển thị hai trạng thái tiền cash → assets.
  - Quỹ an tâm = `safety_fund_months × chi Must trung bình 3 tháng`, không hardcode (trước 2026-10-07 gọi là "phao khẩn cấp", ADR-93).
  - Thuế 10% chỉ trên thu nhập chưa khấu trừ; quyết toán cuối năm, thừa chuyển sang Tích sản.
- **Use cases:** `specs/ledger/`, `specs/allocation/`.

## BR-08: Cấu hình hệ thống không cần sửa code
- **Goal:** chủ nhà tự chỉnh tài khoản, ví, số tiền nạp, mã chuyển khoản, tham số, tích hợp (SePay, Telegram) trong app.
- **Success metric:** các bước "để dùng thật" làm được hết trong màn Cài đặt, không chạy `wrangler`, không sửa SQL.
- **Use cases:** `specs/access/`, `specs/pwa/`.

## BR-09: Chỉ người trong hộ truy cập được; bí mật không lộ
- **Goal:** người ngoài không đọc/ghi được sổ, không giả được giao dịch ngân hàng hay lương.
- **Success metric:**
  - Mọi route dữ liệu cần xác thực; webhook SePay cần API key; MCP cần token OAuth do người trong nhà uỷ quyền (đăng nhập + đồng ý), gỡ được từng kết nối (ADR-97).
  - Secret không xuất hiện trong log lỗi.
  - Cờ `private` chỉ là ẩn lịch sự giữa hai vợ chồng, **không phải** bảo mật.
- **Out of scope (V1):** mật khẩu riêng từng người, multi-household, phân quyền.
- **Use cases:** `specs/access/`, `specs/mcp/`, `specs/ingest/`.

## BR-10: Vận hành rẻ, một Worker, core thuần test được
- **Goal:** chạy hết trên Cloudflare, không VPS; logic tiền test được không cần D1.
- **Success metric:**
  - Một Worker (Hono) + D1 + Cron + Static Assets.
  - Core nghiệp vụ (`src/domain`) không import SDK và test được bằng `vitest` không cần D1 (đã đúng). I/O qua port `Store`/`Notifier`/`Config` là ý định trong docs nhưng **chưa có trong code** — services gọi D1 trực tiếp (xem `specs/decisions.md` ADR-06).
  - CPU mỗi request trong ngân sách gói Cloudflare đang dùng (đo 22/9: trung vị ≈ 10 ms — xem `specs/decisions.md`).
  - Chi phí bên thứ ba: SePay gói trả phí từ 120.000 ₫/tháng; Workers Paid 5 USD/tháng nếu cần.
- **Use cases:** xuyên suốt; quyết định kiến trúc ở `specs/decisions.md`.

## BR-11: Tiền người thuê không bị tiêu lẫn, và biết họ còn nợ bao nhiêu
- **Goal:** cho thuê lại một phần nhà mà tiền người thuê trả không lẫn vào chi tiêu của hộ; lúc nào cũng trả lời được "người thuê còn nợ hay đang được trừ bao nhiêu".
- **Success metric:**
  - Tiền người thuê trả vào thẳng ví đích của mảng cho thuê ("Thu cho thuê"), không bao giờ vào ví chi tiêu; "còn để chi" không đổi khi người thuê trả tiền.
  - Xem được bất cứ lúc nào: người thuê còn nợ / đang được trừ bao nhiêu, và tạm tính tháng này (phí cố định + phần chi chung chia đều theo số người).
  - Thêm, bớt người thuê là thao tác ở Cài đặt, không phải sửa code.
- **Out of scope:** tính theo ngày ở, đặt cọc, app tự chia tiền cho thuê giữa trả nợ và Tích sản (vợ chồng quyết từng lần — ADR-63), người thuê đăng nhập app.
- **Use cases:** `specs/rental/`; liên quan `specs/allocation/` (nguồn thu), `specs/ingest/` (gán log), `specs/pwa/` (màn Người thuê).
- **Nguồn:** change `261001-cho-thue-lai` (`specs/changes/archive/261001-cho-thue-lai/proposal.md`), duyệt 2026-10-01.

## BR-12: Biết còn nợ bao nhiêu, trả tới đâu
- **Goal:** hộ đang nợ 15.379.000 ₫ (có thể nhiều chủ nợ); lúc nào cũng trả lời được "còn nợ ai bao nhiêu, đã trả bao nhiêu" mà không cộng tay các khoản chi "Trả nợ".
- **Success metric:**
  - Mỗi khoản nợ có số còn nợ = đã vay − đã trả; trả một khoản (ghi tay, offline, hay gán giao dịch ngân hàng) thì số còn nợ giảm đúng số đó, huỷ khoản trả thì số tự trở lại.
  - Màn Nợ trên PWA, tool MCP `get_debts` và tin sáng (`💳 Còn nợ X (N khoản)`) cho **cùng một con số** tổng còn nợ.
  - Trả xong thì khoản nợ được đánh dấu đã trả xong; hết nợ thì tin sáng không còn dòng nợ.
  - Sổ nợ chỉ ghi thêm (vay thêm, chỉnh tay, huỷ dòng), không sửa đè.
- **Out of scope:** lãi suất tự tính, lịch trả góp, nhắc hạn trả, cho vay (tiền người khác nợ hộ — sổ phải thu, BR-13), thẻ tín dụng (non-goal V1).
- **Use cases:** `specs/debt/` — [UC-901](debt/UC-901-them-va-xem-khoan-no.md), [UC-902](debt/UC-902-tra-no.md), [UC-903](debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md), [UC-904](debt/UC-904-vay-them-chinh-huy-dong-no.md); liên quan `specs/ledger/` UC-101 (`debt_id` trên khoản chi), `specs/ingest/` UC-305 (gán log), `specs/pwa/` UC-707/UC-712 (tab Nợ, sheet Trả nợ), `specs/notify/` UC-402 (tin sáng), `specs/mcp/` UC-603 (`get_debts`, `add_transaction`).
- **Nguồn:** yêu cầu chủ nhà 2026-10-01 (sổ nợ; trước đó chỉ có danh mục `debt-payment` ghi phần đã trả — ADR-63, ADR-71).

## BR-13: Biết ai đang nợ mình bao nhiêu — mà không nhầm là tiền đang có
- **Goal:** hộ cho người khác vay hoặc trả hộ ai đó; lúc nào cũng trả lời được "ai còn nợ mình bao nhiêu, đã trả lại bao nhiêu", và lúc nào cũng thấy **tiền thật đang có** tách khỏi các số ghi nhớ. Số phải thu, số nợ (BR-12) và số người thuê còn nợ (BR-11) trả lời **"ai nợ ai"**, không bao giờ trả lời **"mình có bao nhiêu tiền"**.
- **Success metric:**
  - Mỗi khoản phải thu có số còn phải thu = đã cho vay − đã nhận lại; cho vay thêm hay nhận lại một khoản (ghi tay, offline, gán giao dịch ngân hàng) thì số đổi đúng số đó, huỷ thì số tự trở lại.
  - Cho vay rồi nhận lại đủ thì **mọi ví về đúng số trước khi cho vay** (không còn vòng `lend` → `refund` làm ví phồng); tiền nhận lại không bao giờ là thu nhập, không được chia, không đổi "còn để chi tuần này".
  - Thêm một khoản phải thu (số người ta đang nợ) không đổi số dư ví hay tài khoản nào.
  - Tab Nợ trên PWA mở ra là thấy **Tiền thật đang có** trước tiên (số to nhất), rồi mới tới tài sản, người khác nợ mình, mình nợ và tài sản ròng; tab Nợ, tool MCP `get_receivables` và tin sáng (`🤝 Người khác nợ mình X (N khoản)`) cho **cùng một con số** tổng còn phải thu.
  - Sổ phải thu chỉ ghi thêm (chỉnh tay, huỷ dòng), không sửa đè.
- **Out of scope:** tính lãi cho vay, lịch thu nợ, nhắc người nợ, ghi nhận doanh thu dồn tích (một khoản phải thu không bao giờ là thu nhập — ADR-72), tool MCP cho bức tranh tiền thật.
- **Use cases:** `specs/receivable/` — [UC-1001](receivable/UC-1001-them-va-xem-khoan-phai-thu.md), [UC-1002](receivable/UC-1002-cho-vay-tra-ho.md), [UC-1003](receivable/UC-1003-nhan-lai-tien.md), [UC-1004](receivable/UC-1004-chinh-huy-dong-phai-thu.md), [UC-1005](receivable/UC-1005-xem-buc-tranh-tien-that.md); liên quan `specs/ledger/` UC-101 (`collect`, `receivable_id`), `specs/ingest/` UC-305 (gán log), `specs/pwa/` UC-705/UC-706/UC-707 (Loại khác, Gán, tab Nợ), `specs/notify/` UC-402 (tin sáng), `specs/mcp/` UC-603/UC-604 (`get_receivables`, `add_transaction`, `assign_log`).
- **Nguồn:** yêu cầu chủ nhà 2026-10-01 ("có nợ rồi, còn khoản phải thu thì sao?"; "Kế toán dễ lãi giả lỗ thật, Profit First cho thấy tiền tươi thóc thật." — `docs/profit_first_phuong_phap.md` §8, ADR-72).
