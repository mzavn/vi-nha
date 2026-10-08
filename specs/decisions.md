# Nhật ký quyết định (ADR) — Ví nhà

File này ghi lại **mọi quyết định đã chốt** từ lúc bắt đầu dự án (20/9/2026) tới nay, theo thứ tự thời gian, dựng lại từ `docs/core_design_rules.md` (§1, §9), `docs/profit_first_phuong_phap.md`, `plans/260921-2228-profit-first-pwa/{plan,context}.md` (D1–D14, bảy lỗi cũ, non-goals), các báo cáo trong `plans/reports/` và thông điệp commit trong `git log`.
Mỗi ADR có dòng **Verified in code** trỏ tới symbol thật đang thi hành nó; chỗ code lệch tài liệu được ghi `[DIVERGENCE]`, chỗ chưa kiểm được ghi `[OPEN]` hoặc `⚠ not verified`.
Mã `D#` là mã quyết định trong `context.md`; các quyết định khác trích nguồn tại chỗ (commit, báo cáo). Ngày là **ngày chốt quyết định** (theo tài liệu/commit); commit có thể mang ngày giờ lệch vài giờ do múi giờ.
Status: `accepted` (đang có hiệu lực) · `superseded by ADR-xx` · `proposed (awaiting owner)` (đã đề xuất/đã code nhưng chủ nhà chưa xác nhận, hoặc việc chủ nhà phải làm) · `rejected`.

## Mục lục

| ID | Ngày | Quyết định | Status | Context |
|---|---|---|---|---|
| ADR-01 | 2026-09-20 | Luật gốc Profit First: tiền thật, phân bổ trước, không mượn ngược | accepted | allocation |
| ADR-02 | 2026-09-20 | Sáu luật không được vi phạm | accepted | ledger |
| ADR-03 | 2026-09-20 | Ba trục độc lập và ranh giới hộ gia đình | accepted | ledger |
| ADR-04 | 2026-09-20 | Tích sản một ví hai trạng thái; phao là ngưỡng tính động | accepted | allocation |
| ADR-05 | 2026-09-20 | Thuế 10% chỉ trên thu nhập chưa khấu trừ; thừa cuối năm sang Tích sản | accepted | allocation |
| ADR-06 | 2026-09-20 | Một Cloudflare Worker (Hono) + D1, core nghiệp vụ thuần | accepted | platform |
| ADR-07 | 2026-09-20 | Tiền INTEGER VND, kỳ theo `Asia/Ho_Chi_Minh`, `week_key` ISO tính ở app | accepted | platform |
| ADR-08 | 2026-09-20 | Phân bổ ảo, tiền đi thật: lệnh chuyển tiền memo `PF <batch_id>` | superseded by ADR-42 | allocation |
| ADR-09 | 2026-09-20 | Thông báo qua Telegram, một chiều, ghi `notifications` chống gửi trùng | accepted | notify |
| ADR-10 | 2026-09-21 | `docs/` là cái đúng, `plans/` là cách làm; `DESIGN.md` thắng wireframe | accepted | platform |
| ADR-11 | 2026-09-21 | Non-goals V1 | accepted | platform |
| ADR-12 | 2026-09-21 | Chi phí vận hành và giới hạn gói (SePay trả phí, Workers Free, 4 cron trigger) | accepted | platform |
| ADR-13 | 2026-09-21 | D1 — Thứ tự ưu tiên thực của engine chia tiền | accepted | allocation |
| ADR-14 | 2026-09-21 | D2 — Chia ngay từng khoản thu; ngày 10/25 chỉ là lời nhắc | accepted | allocation |
| ADR-15 | 2026-09-21 | D3 — Quét dư cuối tháng chỉ phong bì chung dương; ví âm được bù lần chia sau | accepted | allocation |
| ADR-16 | 2026-09-21 | D4 — Bố trí tài khoản thật: mỗi người TK riêng, cả nhà MB | accepted | ingest |
| ADR-17 | 2026-09-21 | D5 — SePay với MB: webhook hai chiều, phase 00 chỉ là bước xác nhận | accepted | ingest |
| ADR-18 | 2026-09-21 | D6 — Mật khẩu chung + chọn người; ví cá nhân theo người đang nhập | accepted | access |
| ADR-19 | 2026-09-21 | D7 — Phong bì tuần × số thứ Hai thật của tháng | accepted | allocation |
| ADR-20 | 2026-09-21 | D8 — Chuyển plan sang `plans/` và sửa cho nhất quán | accepted | platform |
| ADR-21 | 2026-09-21 | D9 — Phao tính theo mức sống tối thiểu (chỉ nhóm Must) | accepted | allocation |
| ADR-22 | 2026-09-21 | D10 — Bỏ danh mục Học phí / bảo hiểm khỏi seed | accepted | ledger |
| ADR-23 | 2026-09-21 | D11 — Rà soát 02:00 mỗi đêm qua API lịch sử SePay | accepted | ingest |
| ADR-24 | 2026-09-21 | Bảy lỗi của các bản plan cũ — không lặp lại | accepted | platform |
| ADR-25 | 2026-09-21 | Schema v1.3 (S1–S9): ngân sách theo kỳ là query, đối soát hai lớp, … (lớp 1 `feed_drift` thay bởi ADR-87) | accepted | ledger |
| ADR-26 | 2026-09-21 | "Còn để chi tuần này" = một hàm thuần duy nhất | accepted | ledger |
| ADR-27 | 2026-09-21 | Báo log chưa gán bằng cron mỗi phút, chỉ log đã chờ ≥ 60 giây | accepted | notify |
| ADR-28 | 2026-09-21 | Hợp đồng webhook SePay: `Apikey`, `{"success": true}`, idempotent theo `id` | accepted | ingest |
| ADR-29 | 2026-09-21 | Ghép cặp chuyển nội bộ chỉ giữa hai TK của hộ, gỡ được | accepted | ingest |
| ADR-30 | 2026-09-21 | MCP stateless bằng `@hono/mcp`, secret trong path, không log path | superseded by ADR-97 | mcp |
| ADR-31 | 2026-09-21 | D12 — Nhập offline, có mạng tự sync, chống trùng theo `client_id` | accepted | pwa |
| ADR-32 | 2026-09-21 | D13 — Mobile-first, PWA dựng từ đầu theo `DESIGN.md` | accepted | pwa |
| ADR-33 | 2026-09-22 | Giữ hành vi của hệ Apps Script `MzaSepaySheetLib` | accepted | ingest |
| ADR-34 | 2026-09-22 | Chia tiền nguyên tử, tối đa một lần cho mỗi khoản thu (`allocation_runs`) | accepted | allocation |
| ADR-35 | 2026-09-22 | Phiên đăng nhập ký HMAC theo người + Bearer token cho script | accepted | access |
| ADR-36 | 2026-09-22 | PWA: build từ `web/` ra `public/` không commit; SW network-first cho `GET /v1/*` | accepted | pwa |
| ADR-37 | 2026-09-22 | Bàn phím số vẽ trong app thay bàn phím hệ thống | superseded by ADR-51 | pwa |
| ADR-38 | 2026-09-22 | Khoản offline bị server từ chối vẫn trừ tạm vào "còn lại" | proposed (awaiting owner) | pwa |
| ADR-39 | 2026-09-22 | Gán log: `create_rule` boolean; mọi kiểm tra trước khi ghi sổ | accepted | ingest |
| ADR-40 | 2026-09-22 | Một giao dịch ngân hàng vào sổ tối đa một lần (batch + trigger DB) | accepted | ingest |
| ADR-41 | 2026-09-22 | Hàng đợi offline không mất lặng lẽ, không ghi nhầm người, cache theo người | accepted | pwa |
| ADR-42 | 2026-09-22 | Mã lệnh chuyển tiền ngẫu nhiên riêng từng lệnh; khớp theo memo | accepted | ingest |
| ADR-43 | 2026-09-22 | Ngưỡng tự nhận lương `salary_min_amount` | accepted | ingest |
| ADR-44 | 2026-09-22 | Huỷ khoản thu đã chia = gỡ lần chia; cấm khi tiền đã chuyển thật | accepted | allocation |
| ADR-45 | 2026-09-22 | Cảnh báo log chưa gán chỉ đánh dấu "đã báo" khi gửi được | accepted | notify |
| ADR-46 | 2026-09-22 | Không bỏ lặng lẽ giao dịch ngân hàng; từ chối ngày giờ vô lý | accepted | ingest |
| ADR-47 | 2026-09-22 | Log webhook/backfill "song sinh" thiếu mã tham chiếu coi là một và bỏ | superseded by ADR-49 | ingest |
| ADR-48 | 2026-09-22 | D14 — Tài khoản có bank feed không nhận nhập tay, không đếm số dư khi còn log chưa gán | proposed (awaiting owner) | ledger |
| ADR-49 | 2026-09-22 | Log có thể trùng: vẫn ghi, không tự khớp, gắn nhãn "có thể trùng" | accepted | ingest |
| ADR-50 | 2026-09-22 | Định danh tài khoản: khớp `subAccount` (VA) trước số tài khoản | accepted | ingest |
| ADR-51 | 2026-09-22 | Ô số tiền dùng bàn phím số của máy | accepted | pwa |
| ADR-52 | 2026-09-22 | Cấu hình qua màn Cài đặt; khoá kết nối lưu D1, dự phòng `wrangler secret`, chỉ lộ 4 ký tự cuối | accepted | access |
| ADR-53 | 2026-09-22 | Màn hình rộng ≥ 1024px chỉ thêm, không đổi giao diện điện thoại | accepted | pwa |
| ADR-54 | 2026-09-22 | Lên Workers Paid theo số đo CPU thật | proposed (awaiting owner) | platform |
| ADR-55 | 2026-09-21 | Nơi đặt tài khoản Tích sản và Thuế | accepted | allocation |
| ADR-56 | 2026-09-21 | Quota cron trigger trên cả tài khoản Cloudflare | proposed (awaiting owner) | platform |
| ADR-57 | 2026-09-21 | Phase 00: xác nhận SePay với MB bằng quan sát thật | proposed (awaiting owner) | ingest |
| ADR-58 | 2026-10-01 | Cho thuê lại là nguồn thu riêng; ghi thu theo tiền thật; sổ người thuê là sổ phải thu ngoài sổ cái | accepted | rental |
| ADR-59 | 2026-10-01 | Phần khóa theo từng nguồn thu (`IncomeStream`); không chọn nguồn giữ hành vi cũ | accepted | allocation |
| ADR-60 | 2026-10-01 | Tiền vào từ người thuê chỉ được gợi ý, không tự gán | accepted | ingest |
| ADR-61 | 2026-10-01 | Tính với người thuê = phí cố định + chi chung chia đều theo số người; chốt tay mỗi tháng, chênh lệch mang sang bằng số dư | accepted | rental |
| ADR-62 | 2026-10-01 | Mua vàng không cần đợi phao đầy; phao chỉ tính tiền mặt | accepted | ledger |
| ADR-63 | 2026-10-01 | Tiền cho thuê vào ví giữ riêng "Thu cho thuê"; trả nợ hay sang Tích sản do vợ chồng quyết từng lần | accepted | rental |
| ADR-64 | 2026-10-01 | Kênh thông báo thứ hai: Web Push chuẩn trên PWA | accepted | notify |
| ADR-65 | 2026-10-01 | Rà soát đêm và "Kiểm tra SePay" dùng SePay API v2 thay API cũ `userapi/` | accepted | ingest |
| ADR-66 | 2026-10-01 | Danh mục ngân hàng theo tài liệu SePay; D14 tinh chỉnh theo chiều tiền (`sepay_out`) | accepted | ledger (+ access, ingest, pwa) |
| ADR-67 | 2026-10-01 | Tối ưu giao diện theo audit 261001 | accepted | pwa (+ allocation) |
| ADR-68 | 2026-10-01 | Giờ nhắc chỉnh trong app (nhịp 5 phút — phần nhịp thay bởi ADR-70) | accepted | notify (+ access, pwa) |
| ADR-69 | 2026-10-01 | Giảm request: cache ngắn hạn ở service worker | accepted | pwa |
| ADR-70 | 2026-10-01 | Nhịp cron 15 phút, đêm 01:00–04:00 mỗi giờ | accepted | notify (+ ingest) |
| ADR-71 | 2026-10-01 | Sổ nợ là sổ riêng ngoài sổ cái; trả nợ = khoản chi có `debt_id` | accepted | debt (+ ledger, ingest, mcp, notify, pwa) |
| ADR-72 | 2026-10-01 | Nhận lại tiền cho vay là meaning `collect`, không dùng `refund`; sổ phải thu ngoài sổ cái; báo cáo tiền thật trước | accepted | receivable (+ ledger, ingest, mcp, notify, pwa) |
| ADR-73 | 2026-10-01 | Sửa giao dịch ghi tay = huỷ + ghi mới trong một batch; giao dịch ngân hàng chỉ gỡ gán | accepted | ledger (+ ingest, pwa) |
| ADR-74 | 2026-10-01 | Chi tiêu dùng chữ "dự kiến"; "mục tiêu" chỉ cho quỹ tiết kiệm có đích | accepted | ledger (+ allocation, notify, mcp, pwa) |
| ADR-75 | 2026-10-03 | Nhiều kết nối SePay — mỗi kết nối một token và một khoá webhook; đồng bộ lại theo khoảng ngày | accepted | ingest (+ access, pwa) |
| ADR-76 | 2026-10-03 | Số dư đầu là mốc: giao dịch trước `opened_at` không vào sổ | accepted | ingest (+ ledger, access, pwa) |
| ADR-77 | 2026-10-03 | Tiết kiệm tiền lẻ MB = heo đất: tài khoản riêng mỗi người + một ví giữ riêng chung (phần ví thay bởi ADR-82) | accepted | ledger (+ ingest, receivable, access, pwa) |
| ADR-78 | 2026-10-03 | Rà soát SePay ba lớp: ngày, tuần, tháng | accepted | ingest (+ notify) |
| ADR-79 | 2026-10-03 | Thông báo hai bản: bản ngắn cho thông báo đẩy, bản đầy đủ cho Telegram | accepted | notify (+ pwa) |
| ADR-80 | 2026-10-03 | Thêm Zalo Bot làm kênh thông báo thứ ba | accepted | notify (+ access, pwa) |
| ADR-81 | 2026-10-03 | Chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi | accepted | ingest (+ pwa) |
| ADR-82 | 2026-10-03 | Heo đất là Tích sản: vào khoá vào Tích sản, ra chỉ đổi chỗ | accepted | ingest (+ ledger, receivable, access, pwa) |
| ADR-83 | 2026-10-03 | Số lũy kế âm từ SePay không phải số dư ngân hàng | superseded by ADR-87 | ledger (+ ingest) |
| ADR-84 | 2026-10-05 | Mua hộ người khác là phải thu; chia bill có phần mình là chi tiêu | accepted | receivable (+ pwa) |
| ADR-85 | 2026-10-06 | "Tiền chi được" = tiền thật ở tài khoản đang tính − Tích sản và Thuế còn giữ; heo đất không trừ hai lần (chữ nhắc lệch trên card theo ADR-87) | accepted | ledger (+ access, pwa) |
| ADR-86 | 2026-10-06 | Tích sản nói rõ tiền đang ở đâu và đến từ đâu: heo tách được, phần còn lại "trong các tài khoản thường" | accepted | pwa (+ ledger) |
| ADR-87 | 2026-10-06 | Bỏ hẳn số lũy kế SePay; đối soát = sổ ↔ giao dịch đã gán + số dư người nhà tự nhập | accepted | ledger (+ ingest, notify, mcp, pwa) |
| ADR-88 | 2026-10-06 | Tài khoản Tích sản (heo, phao dự phòng, sổ tiết kiệm): chuyển vào từ tài khoản thường là vào Tích sản; Tiền chi được không trừ lại phần ở đó | accepted | ledger (+ ingest, access, pwa, receivable) |
| ADR-89 | 2026-10-06 | Chặn dò mật khẩu và khoá webhook bằng bộ đếm lần sai theo IP ở D1; Đăng xuất mọi máy bằng thế hệ phiên; header bảo mật (CSP…) cho app và API | accepted | access (+ ingest, notify, pwa) |
| ADR-90 | 2026-10-06 | Kênh báo tin chỉ thêm được qua đường kiểm soát và luôn báo cả nhà; nhật ký thay đổi chỉ thêm; gợi ý khoá ≤ 25% | accepted | access (+ notify, ingest, ledger, pwa) |
| ADR-91 | 2026-10-07 | Số dư có sẵn của tài khoản Tích sản vào Tích sản một lần, không lấy từ ví nào; phần đã là Tích sản không tính lại | accepted | ledger (+ access, pwa) |
| ADR-92 | 2026-10-07 | Ngôn ngữ trong mã nguồn: giao diện, tin nhắn, chú thích, test, specs tiếng Việt; tên trong code, giá trị lưu DB, API, địa chỉ màn, tool MCP tiếng Anh | accepted | platform (+ ledger, access, mcp, pwa, receivable) |
| ADR-93 | 2026-10-07 | "Quỹ an tâm" thay "Phao khẩn cấp" | accepted | ledger (+ notify, pwa, access) |
| ADR-94 | 2026-10-07 | Mã dữ liệu code đọc thẳng là mã hệ thống tiếng Anh (`default`, `debt-payment`, `lending`, `rental`); mã người dùng tạo là dữ liệu; icon danh mục là dữ liệu | accepted | platform (+ access, ledger, rental, debt, receivable, pwa) |
| ADR-95 | 2026-10-08 | Đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn; khoá ký phiên trong D1; thiết lập nhà lần đầu bằng mật khẩu chung | accepted | access (+ pwa) |
| ADR-96 | 2026-10-08 | Tối đa 6 người ngang quyền; tắt người không xoá dữ liệu | accepted | access (+ pwa) |
| ADR-97 | 2026-10-08 | MCP dùng OAuth 2.1 của chuẩn MCP, bỏ đường dẫn chứa khoá; tool nhìn và ghi như người đã uỷ quyền | accepted | mcp (+ access, pwa) |
| ADR-98 | 2026-10-08 | Quyền mặc định: Xem + Ghi, Ghi bỏ tick được; Đăng xuất mọi máy và đổi mật khẩu chung gỡ cả kết nối AI | accepted | mcp (+ access) |

---

## ADR-01: Luật gốc Profit First — tiền thật, phân bổ trước, không mượn ngược
- Date: 2026-09-20 · Status: accepted
- Plan ID: — · Context: allocation
- Source: `docs/profit_first_phuong_phap.md` §0–§2 (v0.5, hợp nhất 20/9/2026; snapshot commit `e2cdbd7`); `README.md` "Vấn đề"
### Context
Công thức truyền thống `Thu nhập − Chi phí = Tiết kiệm` để tiết kiệm là phần dư, gần như luôn bằng 0. Hộ gia đình cần một hệ làm việc thay ý chí.
### Decision
- Hai luật gốc: **Tiền là thật, chi là chi thật** (chỉ ghi và chỉ chia tiền đã thật sự về tài khoản) và **Phân bổ trước rồi mới chi** (`DT − LN = CP`).
- Bốn phe trong dòng chia: `tichsan` · `tax` · `nice` · `must` (+ `holding` là trạm trung chuyển). Phe `must` chia hai nhóm `must_group`: **Must** (sàn cứng) và **Have** (ví `remainder`, nhận phần còn lại).
- Không mượn ngược từ phần đã khóa (Tích sản, Thuế); sự eo hẹp phải nhìn thấy được.
### Consequences
Mọi thứ tự chia/bóp (ADR-13), ví `remainder`, cờ `underfunded` và số âm hiện đỏ trên UI đều suy ra từ đây.
### Verified in code
`src/domain/allocation.ts` › `allocate` (bước 1–2 cắt phần trăm trước, bước 6 `remainder` nhận phần dư, không bao giờ âm; ném lỗi nếu Σfund ≠ thu nhập) · `migrations/0001_schema.sql` bảng `wallets` CHECK `tier IN ('holding','tichsan','tax','nice','must')`, `must_group IN ('must','have')`.

## ADR-02: Sáu luật không được vi phạm
- Date: 2026-09-20 · Status: accepted
- Plan ID: — · Context: ledger
- Source: `docs/core_design_rules.md` §1; `plans/.../plan.md` "Nguyên lý bất biến"
### Context
Sổ tiền phải đối soát được với tiền thật; sai một quy ước là đếm hai lần hoặc sinh thu nhập ảo.
### Decision
1. Sổ chỉ ghi thêm: không sửa đè, không xoá; sai thì `status='void'` rồi ghi bút toán mới.
2. Hai lớp tách hẳn: `bank_logs` (thô, bất biến) ≠ `transactions` (đã diễn giải).
3. `meaning` quyết định, không phải hướng tiền.
4. Một quy ước dấu: `wallet_id` = ví được cộng, `counter_wallet_id` = ví bị trừ; `spend` ghi ví ở `counter_wallet_id` và bắt buộc `category_id`.
5. Số tổng hợp tính ra (view/hàm), không lưu.
6. Máy chỉ được đoán `spend` và `transfer`; tiền vào luôn phải hỏi, trừ khoản khớp mẫu lương.
### Consequences
Huỷ/gỡ đều là `UPDATE ... SET status='void'`; số dư ví/tài khoản là view (`v_wallet_balance`, `v_account_book`); rule `income` chỉ tồn tại khi `is_salary=1`.
### Verified in code
`migrations/0001_schema.sql`: `transactions` CHECK `meaning <> 'spend' OR counter_wallet_id IS NOT NULL`, `meaning <> 'spend' OR category_id IS NOT NULL`, `status IN ('active','void')`; `rules` CHECK `meaning <> 'income' OR is_salary = 1`; view `v_wallet_balance`, `v_account_book` · `src/services/ledger.ts` › `voidTransaction` · `src/domain/rules.ts` › `matchRule` (rule `income` chỉ khớp khi `direction='in'` và `isSalary`) · `src/services/ingest.ts` › `createRuleFromSplit` (chỉ `spend`/`transfer`).
- [DIVERGENCE] Luật 1 "không sửa đè": `src/services/ingest.ts` › `matchLog` gắn chân thứ hai bằng `UPDATE transactions SET log_id_2 = ? WHERE id = ? AND log_id_2 IS NULL` — sửa một cột không phải `status` trên dòng đã ghi. Chưa có quyết định nào nói đây là ngoại lệ được phép.

## ADR-03: Ba trục độc lập và ranh giới hộ gia đình
- Date: 2026-09-20 · Status: accepted · Tinh chỉnh bởi ADR-72 ("ai nợ mình": tiền về là `collect`, không còn là `refund`)
- Plan ID: — · Context: ledger
- Source: `docs/profit_first_phuong_phap.md` §4, §6; `docs/core_design_rules.md` §2, §9 (các dòng "Nợ nội bộ", "Ai nợ mình", "Danh mục", "Tiền mặt", "Tiền nhà trả cục", "Hoàn tiền lệch kỳ")
### Context
Nếu mỗi danh mục là một ví thì có 20+ phong bì; nếu nhầm chuyển nội bộ là thu/chi thì sổ báo tiêu gấp đôi.
### Decision
- **Ví** (ngân sách) ≠ **Tài khoản** (tiền nằm đâu) ≠ **Danh mục** (nhãn phân tích). Chọn danh mục thì ví tự điền (`categories.default_wallet_id`).
- Tiền mặt là một `account` `kind='cash'`; rút ATM = `transfer` bank → cash.
- Đơn vị kinh tế là **hộ**: chuyển giữa các TK của hộ là `transfer`, không bao giờ là thu nhập; không theo dõi nợ nội bộ vợ chồng; `by_member_id` chỉ là nhãn "ai chi".
- "Ai nợ mình" xử lý phản ứng-sau bằng `refund`; `lend` là chế độ nâng cao, không đụng ví. Hoàn tiền lệch kỳ tính vào kỳ hiện tại, vẫn `link_id` về khoản chi gốc. Tiền nhà trả cục ghi trọn vào tháng trả.
### Consequences
Tám `meaning` (§2) là từ vựng chung; ghép cặp chuyển nội bộ (ADR-29) và gợi ý "Rút tiền mặt" ở màn Gán là hệ quả trực tiếp — gợi ý này chỉ dành cho log `out` trông như rút tiền mặt (nội dung có `ATM`, `RUT TIEN`, `RUT TM`, `CASH WITHDRAWAL`; sửa lỗi 2026-10-03, ingest UC-305 v15), không phải cho mọi log `out` không khớp rule.
### Verified in code
`src/domain/entry.ts` › `MANUAL_MEANINGS`, `buildEntry`, `cashAccountOf` · `src/services/ledger.ts` › `createEntry` (kiểm `link_id` phải trỏ về `spend` còn hiệu lực, kế thừa `category_id`) · `src/services/ingest.ts` › `listPendingLogs` → `suggestFor` (gợi ý "Rút tiền mặt" cho log `out` có nội dung rút tiền — `src/domain/rules.ts` › `looksLikeCashWithdrawal`) · `migrations/0001_schema.sql` `accounts.kind IN ('bank','cash','ewallet','credit')`, `categories.default_wallet_id`.

## ADR-04: Tích sản một ví hai trạng thái; phao là ngưỡng tính động
- Date: 2026-09-20 · Status: accepted
- Plan ID: — · Context: allocation
- Source: `docs/profit_first_phuong_phap.md` §5; `docs/core_design_rules.md` §9 ("Tích sản", "Phao khẩn cấp")
### Context
Các bản cũ có ví "Quỹ khẩn cấp", ví "Đầu tư" và phao cứng 35tr (xem ADR-24).
### Decision
Tích sản là **một ví** (`tier='tichsan'`), tiền ở hai trạng thái cash → assets; `buy_asset` không đổi số dư, chỉ đổi trạng thái. Phao = `emergency_months × chi Must trung bình 3 tháng`, số tháng đổi ở `config`; không hardcode.
### Consequences
Nút "Mua tài sản" chỉ mở khi phao đầy (phase 05) — **phần này thay bởi ADR-62** (2026-10-01: mua bất cứ lúc nào còn cash; phao chỉ đếm cash); `buy_asset` bị chặn khi tiền mặt Tích sản không đủ.
### Verified in code
`migrations/0001_schema.sql` view `v_tichsan` (`assets` = Σ`buy_asset`, `cash` = số dư − assets), `v_emergency_fund` (đọc `config('emergency_months')`) · `migrations/0002_seed.sql` `('emergency_months','6')` · `src/services/ledger.ts` › `createEntry` (`insufficient_cash`) · `src/domain/snapshot.ts` › `buildSnapshot` (phao ước tính khi chưa đủ dữ liệu).

## ADR-05: Thuế 10% chỉ trên thu nhập chưa khấu trừ; thừa cuối năm sang Tích sản
- Date: 2026-09-20 · Status: accepted
- Plan ID: — · Context: allocation
- Source: `docs/profit_first_phuong_phap.md` §3; `docs/core_design_rules.md` §9 "Thuế"; commit `58306aa` (22/9)
### Context
Lương người làm công đã khấu trừ tại nguồn; thu ngoài chưa.
### Decision
Trích Thuế `income × percent` chỉ khi `taxable`; Thuế đứng sau Tích sản và cũng là phần đã khóa. Cuối năm quyết toán: thiếu nộp thêm từ ví Thuế, thừa chuyển sang Tích sản (kèm lệnh chuyển tiền). Mỗi năm quyết toán một lần, chỉ sau khi năm đã kết thúc (`58306aa`); chỉ chuyển phần thừa còn thật trong ví Thuế.
### Consequences
Thuế suất chỉ nằm ở `allocations` (S6, ADR-25).
### Verified in code
`src/domain/allocation.ts` › `allocate` (`if (r.tier === "tax" && !income.taxable) continue`) · `src/services/ledger.ts` › `settleTax` (`year_not_over`, `already_settled`, `surplus = max(0, min(provisioned − paid, walletBalance))`) · bảng `tax_settlements`.

## ADR-06: Một Cloudflare Worker (Hono) + D1, core nghiệp vụ thuần
- Date: 2026-09-20 · Status: accepted
- Plan ID: — · Context: platform
- Source: `docs/core_design_rules.md` §9 "Kiến trúc"; `context.md` "Constraints"; `plan.md` "Kiến trúc"; commit `a773716`
### Context
Hộ gia đình, chi phí thấp, một người vận hành; logic chia tiền phải test được không cần hạ tầng.
### Decision
Một Worker Hono phục vụ PWA (Static Assets) + `/v1/*` + `/webhooks/*` + `/mcp/*` + `scheduled()`; dữ liệu D1; không VPS, tách project chỉ khi thấy đau. Core nghiệp vụ thuần, không import SDK, test bằng `vitest` không cần D1. Cấu hình bằng `wrangler.jsonc`.
### Consequences
`run_worker_first` bảo đảm API/webhook/MCP không bị SPA fallback nuốt.
### Verified in code
`src/index.ts` › `app`, default export `{ fetch, scheduled }` · `wrangler.jsonc` (`assets.run_worker_first: ["/v1/*","/webhooks/*","/mcp/*"]`, binding `DB`) · `src/domain/*` chỉ import lẫn nhau (không SDK).
- [DIVERGENCE] Tài liệu nói I/O đi qua port `Store` · `Notifier` · `Config` (`docs/core_design_rules.md` §9, `README.md`), và SQL tập trung ở `src/db/queries.ts` (§10, `phase-01`). Code không có interface port nào: `src/domain/*` là hàm thuần nhận dữ liệu, còn `src/services/*.ts` gọi D1 trực tiếp; thư mục `src/db/` rỗng; không có `domain/reconcile.ts` (đối soát là view + `ledger.reconcile`).

## ADR-07: Tiền INTEGER VND, kỳ theo `Asia/Ho_Chi_Minh`, `week_key` ISO tính ở app
- Date: 2026-09-20 · Status: accepted
- Plan ID: — · Context: platform
- Source: `docs/core_design_rules.md` §4 "Ba ràng buộc kỹ thuật"; `context.md` "Constraints"
### Context
Worker chạy UTC; `strftime('%Y-W%W')` của SQLite không phải ISO week; float làm lệch đồng.
### Decision
Tiền là số nguyên VND. `day_key`/`week_key`/`month_key` tính ở tầng app theo giờ VN; `week_key` theo ISO 8601. `remainder` không tính bằng SQL.
### Consequences
Cron 02:00 VN = 19:00 UTC hôm trước; "hôm qua" phải tính theo giờ VN (validate report).
### Verified in code
`src/domain/period.ts` › `dayKey`, `weekKey`, `monthKey`, `weeksLeftInMonth` · `src/domain/entry.ts` › `buildEntry` (`invalid_amount` khi không phải số nguyên dương, trần `MAX_AMOUNT = 1_000_000_000_000`) · `migrations/0001_schema.sql` `amount INTEGER NOT NULL CHECK (amount > 0)`.

## ADR-08: Phân bổ ảo, tiền đi thật — lệnh chuyển tiền memo `PF <batch_id>`
- Date: 2026-09-20 · Status: superseded by ADR-42
- Plan ID: — · Context: allocation
- Source: `prd/docs/core_design_rules.md` (commit `e2cdbd7`) "mỗi lần chia sinh lệnh chuyển tiền với nội dung `PF <batch_id>`"; commit `b92fc0f`
### Context
Tích sản/Thuế nằm ở ngân hàng khác; phân bổ trong app chỉ là ảo cho tới khi tiền đi thật.
### Decision
Mỗi lần chia (và chốt tháng, quyết toán thuế) sinh `transfer_orders` gộp theo cặp tài khoản (ví trú ở TK khác TK nhận thu nhập); memo `PF <batch_id>` (`A<income_tx_id>`, `S<YYYYMM>`); log về tự khớp memo → `done`; quá 3 ngày chưa chuyển → nhắc.
### Consequences
Red team chứng minh memo đoán được (`plans/reports/redteam-260922-0100-auth-exposure.md` #2) và khớp `(batch_id, amount)` nhầm lệnh (`redteam-260922-0100-money-correctness.md` #4) → thay bằng ADR-42. Phần "gộp theo cặp TK" và "quá 3 ngày → nhắc" vẫn giữ.
### Verified in code
Còn hiệu lực: `src/domain/transfer-orders.ts` › `transferOrders` (không sinh lệnh khi cùng TK); `src/services/ledger.ts` › `getSnapshot` (`overdue` = lệnh `pending` tạo quá 3 ngày) · `src/notify/format.ts` › `dailyMessage` ("chuyển tiền cần làm (quá 3 ngày)"). Phần memo đã thay: `src/domain/transfer-orders.ts` › `newTransferMemo`.

## ADR-09: Thông báo qua Telegram, một chiều, ghi `notifications` chống gửi trùng
- Date: 2026-09-20 · Status: accepted
- Plan ID: — · Context: notify
- Source: `docs/core_design_rules.md` §8, §9 "Thông báo"; `phase-07-cron-telegram.md`
### Context
Cần nhắc chủ động mà cron có thể chạy lại.
### Decision
Bot Telegram gửi cho mọi `members.active=1` có `tg_chat_id`; tin 07:00 (còn để chi tuần, mục ≥ 80%, chưa gán, quỹ %, đối soát, lệnh chuyển quá hạn, cặp tự ghép, số giao dịch vá đêm, nhắc 10/25, nhắc Chủ nhật), tin 08:00 thứ Hai (tổng kết tuần + top 5 danh mục). Ghi `notifications` với `UNIQUE (kind, day_key, chat_id)` để cron chạy lại không gửi trùng; gửi lỗi thử lại tối đa 3 lần trong một lần chạy.
### Consequences
Nội dung động (tên ví/TK) phải escape HTML; nội dung chuyển khoản do người ngoài gõ không bao giờ đưa vào tin (auth red team "Đã kiểm tra và thấy ổn").
### Verified in code
`src/notify/telegram.ts` › `notifyMembers`, `sendTelegram` (vòng `attempt <= 3`), `escapeHtml` · `src/notify/format.ts` › `dailyMessage`, `weeklyMessage` · `src/cron/daily.ts` › `daily` · `src/cron/weekly.ts` › `weekly` · `migrations/0001_schema.sql` `notifications UNIQUE (kind, day_key, chat_id)`.
- [DIVERGENCE] `docs/core_design_rules.md` §8 có tin "Lương về & đã chia: bảng chia + lệnh chuyển tiền cần làm"; không tìm thấy nơi nào trong `src/` gửi tin này khi `matchLog` tự chia lương (spec notify ghi là UC-409 spec-only).

## ADR-10: `docs/` là cái đúng, `plans/` là cách làm; `DESIGN.md` thắng wireframe
- Date: 2026-09-21 · Status: accepted
- Plan ID: — · Context: platform
- Source: `README.md` "Quy ước"; `context.md` "Constraints"; `plan.md` "Overview"
### Context
Bản plan cũ chứa nội dung chính nó đã bác bỏ (validate report §4).
### Decision
Mâu thuẫn giữa `docs/` và `plans/` thì `docs/` thắng; riêng giao diện, `pf-wireframe.html` lệch `docs/DESIGN.md` thì `DESIGN.md` thắng. Sửa schema thì sửa `docs/schema.sql` trước rồi sinh migration mới (`phase-01`).
### Consequences
PWA dùng chấm màu trung tính thay màu tím hardcode của wireframe, bỏ nút 28px (`plans/reports/ui-ux-designer-260922-0020-pwa-mobile-offline.md` "Lệch so với wireframe").
### Verified in code
⚠ not verified — quyết định quy trình, không có symbol. Quan sát: `docs/schema.sql` đã lên v1.14 cùng migration 0003–0014 (có `schema_version` `1.14`), nhưng dòng tiêu đề vẫn ghi `v1.3`.
- [DIVERGENCE] `docs/core_design_rules.md` §10 vẫn ghi "schema.sql (v1.3) … 13 bảng + 15 view" và `src/db/queries.ts`; `docs/schema.sql` thực tế là v1.14 với 26 bảng (thêm `allocation_runs` ở v1.4, sáu bảng nguồn thu/người thuê ở v1.7, `push_subscriptions` ở v1.8, `push_test_series` ở v1.9, cột `accounts.sepay_out` ở v1.10, khoá giờ nhắc trong `config` ở v1.11, làm tròn giờ nhắc ở v1.12, `debts`/`debt_lines` ở v1.13, `receivables`/`receivable_lines` và meaning `collect` ở v1.14), 18 view và 10 trigger.

## ADR-11: Non-goals V1
- Date: 2026-09-21 · Status: accepted
- Plan ID: — · Context: platform
- Source: `context.md` "Non-goals (V1)"; `phase-07` "V1 chỉ chiều ra"
### Context
Giữ phạm vi nhỏ để "hết phase 03 là dùng thật được".
### Decision
Ngoài phạm vi V1: Telegram chiều vào (lệnh, inline button) · multi-household và phân quyền (role để sẵn trong schema, chưa có UI) · đọc sao kê CSV · thẻ tín dụng (nợ + kỳ sao kê) · OCR hoá đơn · theo dõi nợ nội bộ vợ chồng · mật khẩu riêng từng người. (Nhập offline từng là non-goal, bị D12 lật lại — ADR-31.)
### Consequences
Không có route nhận update Telegram; một `APP_PASSWORD` chung.
### Verified in code
`src/index.ts` › `app` chỉ mount `/v1/health`, `/v1/session`, `/webhooks`, `/mcp`, `/v1`, `/v1/settings` (không có route Telegram inbound, không có route import) · `src/routes/auth.ts` › `readSession` (một `APP_PASSWORD`) · `migrations/0001_schema.sql` `members.role CHECK (role IN ('owner','adult','teen','child','guest'))`.
- [OPEN] Schema vẫn cho `accounts.kind='credit'` và `transactions.source='import'` dù thẻ tín dụng và import là non-goal; chưa có quyết định giữ hay bỏ.

## ADR-12: Chi phí vận hành và giới hạn gói (SePay trả phí, Workers Free, 4 cron trigger)
- Date: 2026-09-21 · Status: accepted · Tinh chỉnh bởi ADR-68 (tin sáng, tổng kết tuần theo giờ trong `config`) và ADR-70 (2 cron trigger: nhịp 15 phút và nhịp đêm mỗi giờ)
- Plan ID: — · Context: platform
- Source: `context.md` "Constraints"; `plan.md` "Dependencies"; `plans/reports/researcher-260921-2228-third-party-assumptions.md` A.4, C; validate report "Hệ quả kỹ thuật của cron 02:00"
### Context
SePay Free chỉ 50 giao dịch/tháng; Workers Free giới hạn 10 ms CPU/request và 5 cron trigger trên cả tài khoản.
### Decision
Chấp nhận SePay gói trả phí (từ 120.000 ₫/tháng). Bắt đầu Workers Free, lên Workers Paid (5 USD/tháng) nếu đo thấy vượt 10 ms CPU. Dùng đúng 4 cron trigger (07:00, thứ Hai 08:00, 02:00, mỗi phút); nhắc ngày 10 & 25 gộp vào cron 07:00 thay vì tốn trigger riêng. Không dùng Workers Rate Limiting cho webhook nếu binding không dùng được (API key đã chặn nguồn lạ).
### Consequences
Kết quả đo CPU → ADR-54; quota trigger trên cả tài khoản → ADR-56.
### Verified in code
`wrangler.jsonc` `triggers.crons` = `*/15 0-17,21-23 * * *`, `0 18,19,20 * * *` (từ ADR-70; ADR-68 là `0 19 * * *` + `*/5 * * * *`; trước đó `0 0 * * *`, `0 1 * * 1`, `0 19 * * *`, `* * * * *`) · `src/cron/index.ts` › `CRONS`, `runScheduled` · `src/cron/daily.ts` › `daily` (nhánh `dayOfMonth === 10 || dayOfMonth === 25`) · không có binding rate limit trong `wrangler.jsonc` (bỏ theo `plans/reports/fullstack-developer-260922-0020-sepay-ingest.md` §4).

## ADR-13: D1 — Thứ tự ưu tiên thực của engine chia tiền
- Date: 2026-09-21 · Status: accepted
- Plan ID: D1 · Context: allocation
- Source: `context.md` D1; `docs/core_design_rules.md` §4, §9; validate report "Phát hiện 2"; commit `323e159`
### Context
Docs vừa nói rót Hưởng thụ trước Vận hành, vừa nói bóp Hưởng thụ trước khi Must tụt về sàn — không thể cùng đúng khi thiếu tiền.
### Decision
Engine thực thi: Tích sản % → Thuế % → **sàn Must** → **Must đủ mục tiêu** → Hưởng thụ → Have (phần dư). Tích sản/Thuế tính trên chính `income.amount`. Thứ tự "rót" Tích sản → Thuế → Hưởng thụ → Vận hành chỉ là **thứ tự trình bày**. Must dưới sàn → cờ `underfunded`, vẫn ghi. Cùng `priority` → chia theo tỷ lệ nhu cầu, đồng lẻ dồn ví đầu nhóm. Bất biến Σ`fund` = thu nhập.
### Consequences
Tiêu chí cũ "lương 30tr → nice đủ" không đạt được với seed; bảng test 7 case (A–G) và bất biến "B + E = A" thay thế (`phase-02`).
### Verified in code
`src/domain/allocation.ts` › `allocate` (các bước 1–6 theo đúng thứ tự, `underfunded`), `pour` (cùng priority chia tỷ lệ).

## ADR-14: D2 — Chia ngay từng khoản thu; ngày 10/25 chỉ là lời nhắc
- Date: 2026-09-21 · Status: accepted
- Plan ID: D2 · Context: allocation
- Source: `context.md` D2; `docs/core_design_rules.md` §4, §5
### Context
Có hai cách: chia khi có income hay theo nhịp 10/25.
### Decision
Chia ngay mỗi income đã xác nhận (lương khớp rule thì tự chia). Engine nhận "đã nạp bao nhiêu trong tháng" nên khoản thu thứ hai chỉ nạp phần còn thiếu, dư chảy vào Have. Ngày 10/25 chỉ nhắc nếu còn income chưa chia, không tự chia.
### Consequences
Chia phải idempotent theo khoản thu vì log vá đêm cũng có thể là lương (ADR-34).
### Verified in code
`src/domain/allocation.ts` › `allocate` (`stillNeeded` trừ `fundedThisMonth`) · `src/services/ingest.ts` › `matchLog` (rule lương → `allocateIncome` ngay) · `src/cron/daily.ts` › `daily` (`incomeReminder` ngày 10/25: income active chưa có `allocation_runs`).

## ADR-15: D3 — Quét dư cuối tháng chỉ phong bì chung dương; ví âm được bù lần chia sau
- Date: 2026-09-21 · Status: accepted
- Plan ID: D3 · Context: allocation
- Source: `context.md` D3; `docs/core_design_rules.md` §4, §5, §9; validate report "Bổ sung sau vòng trả lời thứ ba" (thay quyết định tự chọn "không bù")
### Context
Chủ nhà: "chi tiêu là để thấy mình tốt dần lên, trung đạo, không tuyệt đối được".
### Decision
Ngày 1, chỉ số dư **dương** của ví `kind='envelope'`, `scope='shared'` quét sang Tích sản bằng `transfer` (kèm lệnh chuyển nếu khác TK); ví cá nhân, `accrual`, `bill` giữ nguyên; tuần dư không quét. Ví phong bì âm đầu tháng: hố `max(0, −openingBalance)` cộng vào cả sàn lẫn mục tiêu ở lần chia kế tiếp; phần bù tự nhiên lấy từ Have. UI ghi "đã bù X". Chốt tháng idempotent.
### Consequences
Chỉ bù phong bì; ví tích dồn âm coi là lỗi dữ liệu, không tự bù.
### Verified in code
`src/domain/close.ts` › `monthSweep` (envelope + shared + tier `must|nice`, `amount > 0`) · `src/services/ledger.ts` › `closeMonth` (batch `S<YYYYMM>`, đã có batch thì trả `already`) · `src/domain/allocation.ts` › `allocate` (`deficit` chỉ cho `kind === "envelope"`, `deficitCovered`) · `src/cron/daily.ts` › `daily` (ngày 1 gọi `closeMonth(previousMonth)`).
- [DIVERGENCE] `phase-02-allocation-core.md` "Chốt kỳ" ghi `batch_id = sweep-<month_key>`; code dùng `S<YYYYMM>` (`src/services/ledger.ts:309`).
- [OPEN] `plans/reports/ui-ux-designer-260922-0020-pwa-mobile-offline.md` ghi dòng "đã bù …" chưa hiện được ở bảng Ví & Quỹ vì `/v1/budget` không trả `deficitCovered` (chỉ có ở bảng chia thử).

## ADR-16: D4 — Bố trí tài khoản thật: mỗi người TK riêng, cả nhà MB
- Date: 2026-09-21 · Status: accepted
- Plan ID: D4 · Context: ingest
- Source: `context.md` D4; `docs/core_design_rules.md` §9 "Ngân hàng"
### Context
Lệnh chuyển tiền phải xuất phát đúng nơi lương về.
### Decision
Hai người, mỗi người TK riêng; cả nhà dùng MB nối SePay; một số TK ghi tay (`sepay_enabled=0`). Lương về TK nào thì lệnh chuyển tiền xuất phát từ TK đó.
### Consequences
Lương vợ về TK vợ trong khi ví chung ở TK chồng → sinh lệnh TK vợ → TK chồng.
### Verified in code
`src/domain/transfer-orders.ts` › `transferOrders` (`fromAccountId` = TK nhận khoản thu) · `src/services/ledger.ts` › `allocateIncome` (`accountId: income.counter_account_id`).
- [DIVERGENCE] `migrations/0002_seed.sql` vẫn là tài khoản mẫu VCB/TCB/MB (`vcb-anh`, `tcb-anh`, `mb-anh`, `vcb-em`), tất cả `sepay_enabled=1`; chủ nhà được hướng dẫn sửa ở màn Cài đặt (`plans/reports/summary-260922-0130-overnight-build.md` "Để dùng thật").

## ADR-17: D5 — SePay với MB: webhook hai chiều, phase 00 chỉ là bước xác nhận
- Date: 2026-09-21 · Status: accepted
- Plan ID: D5 · Context: ingest
- Source: `context.md` D5; validate report "Một điểm lệch vẫn cần nhìn thấy"; researcher report "Assumptions that break" #3
### Context
Chủ nhà xác nhận MB có đủ tiền vào lẫn ra; bảng hỗ trợ SePay (21/9) ghi MB "Tiền ra: Không".
### Decision
Phase 04 thiết kế theo webhook hai chiều. Phase 00 thu lại thành bước xác nhận 10 phút, không chặn phase nào; có phương án dự phòng B/C/D nếu quan sát khác.
### Consequences
Việc xác nhận còn treo → ADR-57. Tài liệu SePay đọc lại 1/10/2026 vẫn ghi MB "Tiền ra: Không" → ADR-66 cho từng tài khoản cờ `sepay_out` (mặc định theo tài liệu, chủ nhà bật tay sau khi thử).
### Verified in code
`src/services/ingest.ts` › `parseWebhookPayload`, `parseHistoryRow` (nhận cả `in`/`out`), `matchLog` (rule chi tiêu cho log `out`).

## ADR-18: D6 — Mật khẩu chung + chọn người; ví cá nhân theo người đang nhập
- Date: 2026-09-21 · Status: accepted
- Plan ID: D6 · Context: access
- Source: `context.md` D6; `phase-03-api.md` "Danh tính người dùng"; `phase-05-pwa.md` "Đăng nhập"; validate report §5 "Ví cá nhân theo người nhập"
### Context
Một `APP_PASSWORD` nhưng app cần biết ai đang dùng; danh mục "Tụ tập" trỏ cứng về `choi-anh` nên vợ nhập sẽ trừ nhầm ví chồng.
### Decision
Mật khẩu chung của hộ + chọn "Chồng"/"Vợ" một lần; `member_id` lưu trong cookie 30 ngày. Danh tính quyết định TK tiền mặt mặc định, `by_member_id`, ví cá nhân được tự điền (ví `personal` của người khác đổi sang ví cùng phe của người đang nhập). Ví `private` của người khác: hiện tên, ẩn số — là **ẩn lịch sự, không phải bảo mật**.
### Consequences
Cache PWA phải theo người (ADR-41), nếu không ẩn lịch sự cũng bị phá.
### Verified in code
`src/routes/session.ts` › `session` (`unknown_member`) · `src/routes/auth.ts` › `issueSession` (`SESSION_DAYS = 30`) · `src/domain/entry.ts` › `walletFor`, `cashAccountOf` · `src/domain/snapshot.ts` › `buildSnapshot` (`hidden`) · `src/routes/v1.ts` (bootstrap `hidden: w.private && w.memberId !== memberId`) · `src/services/ledger.ts` › `walletStatus`, `getBudget`.

## ADR-19: D7 — Phong bì tuần × số thứ Hai thật của tháng
- Date: 2026-09-21 · Status: accepted
- Plan ID: D7 · Context: allocation
- Source: `context.md` D7; `docs/core_design_rules.md` §4, §9; validate S2
### Context
View cũ hardcode `× 4`.
### Decision
Nhu cầu tháng của phong bì tuần = số tiền tuần × số ngày thứ Hai rơi vào tháng (4 hoặc 5); app tính, không view.
### Consequences
Case F (tháng 5 thứ Hai) trong bảng test phase 02.
### Verified in code
`src/domain/period.ts` › `mondaysInMonth` · `src/domain/allocation.ts` › `allocate` (`perMonth`) · `src/domain/snapshot.ts` › `monthTarget`.

## ADR-20: D8 — Chuyển plan sang `plans/` và sửa cho nhất quán
- Date: 2026-09-21 · Status: accepted
- Plan ID: D8 · Context: platform
- Source: `context.md` D8; commit `5ad880f`; bản gốc commit `e2cdbd7`
### Context
Plan cũ (`prd/`) chứa 6 tier, ví Khẩn cấp/Đầu tư, tên endpoint lệch nhau.
### Decision
Chuyển `prd/docs/` → `docs/`, plan → `plans/260921-2228-profit-first-pwa/`, viết lại cho nhất quán; ba file context cũ gộp thành `context.md`; bản gốc giữ trong git. Tên endpoint thống nhất: `POST /webhooks/sepay`, `POST /v1/transactions`, `POST /v1/accounts/:id/count` dùng cho cả tiền mặt lẫn TK ngân hàng.
### Consequences
Các phase file tham chiếu `docs/` thay vì chép lại.
### Verified in code
`src/routes/webhooks.ts` › `webhooks.post("/sepay")` · `src/index.ts` › `app.route("/webhooks", webhooks)` · `src/routes/v1.ts` › `v1` (`/transactions`, `/accounts/:id/count`).

## ADR-21: D9 — Phao tính theo mức sống tối thiểu (chỉ nhóm Must)
- Date: 2026-09-21 · Status: accepted
- Plan ID: D9 · Context: allocation
- Source: `context.md` D9; `docs/core_design_rules.md` §9 "Phao khẩn cấp"; validate S3
### Context
View cũ tính cả nhóm Have và cả tháng đang chạy → phao báo 100% sau một khoản chi 250.000 ₫.
### Decision
"Chi Must" = chỉ ví `must_group='must'`, không gồm Có-thì-tốt; chỉ tính tháng đã kết thúc; chưa đủ 3 tháng trọn thì ước bằng tổng mục tiêu tháng của các ví Must.
### Consequences
Snapshot ghi phao là "ước tính" khi thiếu dữ liệu.
### Verified in code
`migrations/0001_schema.sql` view `v_must_monthly_avg` (`w.must_group='must'`, `month_key <` tháng hiện tại giờ VN, `LIMIT 3`), `v_emergency_fund` (NULL khi `months < 3`) · `src/domain/snapshot.ts` › `buildSnapshot` (`mustNeed * data.emergencyMonths`).

## ADR-22: D10 — Bỏ danh mục Học phí / bảo hiểm khỏi seed
- Date: 2026-09-21 · Status: accepted
- Plan ID: D10 · Context: ledger
- Source: `context.md` D10; `phase-01` S8
### Context
`hoc-phi` trỏ về ví Nhà ở (nạp 8tr, tiền nhà 8tr) → thêm một khoản là âm ngay.
### Decision
Nhà chưa có khoản này → bỏ khỏi seed. Khi có thì tạo ví tích dồn riêng, không ghép vào ví sẵn có.
### Consequences
Tạo ví mới làm được từ màn Cài đặt (ADR-52).
### Verified in code
`migrations/0002_seed.sql` không có `hoc-phi` · `src/services/settings.ts` › `createWallet`.

## ADR-23: D11 — Rà soát 02:00 mỗi đêm qua API lịch sử SePay
- Date: 2026-09-21 · Status: accepted · Mở rộng bởi ADR-75 (rà từng kết nối SePay bằng token riêng; cùng đường cho đồng bộ lại theo khoảng ngày) và ADR-78 (khoảng rà ba lớp: thứ Hai soát cả tuần trước, ngày 1 soát cả tháng trước)
- Plan ID: D11 · Context: ingest
- Source: `context.md` D11; `phase-04` "Rà soát 02:00"; validate report "Hệ quả kỹ thuật của cron 02:00"; commit `c1a25c1`; `plans/reports/fullstack-developer-260922-0020-sepay-ingest.md` §5.3
### Context
Webhook có thể sót; SePay chỉ gửi lại 8 lần trong ~33 phút.
### Decision
Cron `0 19 * * *` (02:00 VN), với từng TK `sepay_enabled=1`, gọi API lịch sử từ 00:00 hôm qua (giờ VN) tới hiện tại; dòng nào sổ chưa có thì tạo `bank_logs` `source='backfill'` và cho chạy qua đúng luồng khớp của webhook; ghi một dòng `notifications(kind='backfill')` để tin 07:00 báo "đêm qua vá N". Chạy lại không sinh trùng. Chọn endpoint `GET my.sepay.vn/userapi/transactions/list` (không phân trang, tối đa 5.000 dòng) thay vì `userapi.sepay.vn/v2/transactions`. Chưa có `SEPAY_API_TOKEN` thì bỏ qua lặng lẽ; TK ghi tay không bị gọi API.
### Consequences
Khoá chống trùng giữa webhook và rà soát là `(account_id, reference_number)` (S9) — sau này bổ sung ADR-40, ADR-49.
### Verified in code
`src/cron/backfill.ts` › `runBackfill`, `syncSepay`, `backfill` (`backfillWindow` từ ADR-78; trước đó `yesterdayMidnightVn`) · `src/services/ingest.ts` › `ingestLog(…, "backfill", …)` · `src/cron/daily.ts` › `daily` (đọc `kind='backfill'` với `day_key` hôm nay).
- Đã đóng bởi ADR-78: câu hỏi mở cũ "lỗi khi ghi một dòng trong `runBackfill` chỉ `console.error` với ghi chú thử lại sau, nhưng cửa sổ đêm sau bắt đầu 00:00 hôm đó nên giao dịch trước nửa đêm không được thử lại" — nay lượt thứ Hai kế tiếp soát lại cả tuần trước, lượt ngày 1 soát lại cả tháng trước.

## ADR-24: Bảy lỗi của các bản plan cũ — không lặp lại
- Date: 2026-09-21 · Status: accepted
- Plan ID: — · Context: platform
- Source: `context.md` "Những chỗ bản cũ từng đi lệch — đừng lặp lại"; validate report §4
### Context
Các bản plan trước đã mắc những lỗi này; agent đọc nhầm sẽ dựng sai từ gốc.
### Decision
1. Không có 6 tier — chỉ 4 phe `tichsan · tax · nice · must` (+ `holding`); Must/Have là nhóm trong `must`.
2. Tích sản là MỘT ví (không ví Quỹ khẩn cấp, không ví Đầu tư).
3. Phao không phải con số cứng (không 35tr).
4. Tích sản đứng trước Thuế; cả hai là phần đã khóa.
5. Tuần dư không quét đi đâu; chỉ cuối tháng quét (D3).
6. Logic chia tiền làm trước ingest — hết phase 03 là dùng thật được bằng nhập tay.
7. Không có schema v1.1 trong repo; không có migration "delta từ v1.1".
### Consequences
Là checklist review cho mọi thay đổi về chia tiền/schema.
### Verified in code
`migrations/0001_schema.sql` CHECK `tier IN ('holding','tichsan','tax','nice','must')` · `src/domain/allocation.ts` › `allocate` (Tích sản trước Thuế trong vòng `percent`) · `src/domain/close.ts` › `monthSweep` (không có quét tuần) · `migrations/0001_schema.sql` là schema đầy đủ, không có migration delta · thứ tự commit: `323e159` (engine) và `b92fc0f` (nhập tay) trước `c1a25c1` (ingest).

## ADR-25: Schema v1.3 (S1–S9)
- Date: 2026-09-21 · Status: accepted · Phần S4/S5 lớp 1 (`feed_drift` so `accumulated`, `reconcile_drift` sau mỗi log) **thay bởi ADR-87**; lớp 2 `book_drift`, "chưa gán", nhập số dư thật còn hiệu lực
- Plan ID: — · Context: ledger
- Source: `phase-01-worker-d1.md` "Sửa schema v1.2 → v1.3"; validate report §3; commit `a773716`
### Context
S1, S3, S4 tái hiện được bằng sqlite3; các lỗi còn lại thấy khi đọc SQL/seed/tài liệu SePay.
### Decision
- S1/S2: bỏ `v_envelope_week`, `v_budget_month`; ngân sách theo kỳ là query có tham số kỳ.
- S3: phao chỉ nhóm Must, chỉ tháng đã kết thúc (ADR-21).
- S4/S5: đối soát hai lớp — `feed_drift` (`opening + Σ bank_logs` so `accumulated`, chỉ khi `accumulated > 0`) và `book_drift` (sổ `transactions` so sổ `bank_logs`); log `pending` hiện riêng là "chưa gán", không tính là lệch; TK không có số dư feed thì nhập số dư thật (dùng `cash_counts`).
- S6: thuế suất chỉ ở `allocations`, bỏ `config.tax_rate`.
- S7: hai ví Chơi cùng priority.
- S8: bỏ `hoc-phi` (D10). S9: thêm `bank_logs.reference_number` và `source IN ('webhook','backfill')`.
### Consequences
Ghi `reconcile_drift` khi `feed_drift ≠ 0` sau mỗi log.
### Verified in code
`src/services/ledger.ts` › `getBudget` (kỳ `2026-09` hoặc `2026-W39`), `reconcile`, `countAccount` · `migrations/0001_schema.sql` view `v_reconcile`, `bank_logs.source` CHECK · `migrations/0002_seed.sql` (`choi-anh`, `choi-em` cùng priority 31; không có `tax_rate`) · `src/services/ingest.ts` › `checkReconcileDrift`.
- [OPEN] Red team money-correctness #2/#3: `book_drift` chỉ so giao dịch sinh từ log với chính log đó, không thấy bút toán nhập tay/`adjust` cùng tài khoản. Lỗ đếm-hai-lần được chặn bằng D14 (ADR-48) chứ không bằng đổi công thức `v_reconcile`.

## ADR-26: "Còn để chi tuần này" = một hàm thuần duy nhất
- Date: 2026-09-21 · Status: accepted
- Plan ID: — · Context: ledger
- Source: validate report §5; `phase-03-api.md` "Định nghĩa còn để chi tuần này"
### Context
Con số hero, dòng đầu tin Telegram và câu trả lời MCP phải giống hệt nhau, nhưng chưa từng được định nghĩa.
### Decision
Chỉ phong bì của phe `must` (Must + Có-thì-tốt): phong bì tuần = `min(mục tiêu tuần − đã chi tuần, số dư)`; phong bì khác = `số dư ÷ số tuần còn lại` (số dư ≤ 0 thì giữ nguyên số âm). Ví chi lố được phép kéo tổng xuống. `bill`, `accrual` không tham gia. REST, Telegram và MCP gọi cùng hàm; PWA trừ tạm hàng đợi theo đúng công thức đó.
### Consequences
MCP dùng người xem mặc định là chủ hộ (giống Bearer không kèm `X-Member-Id`) nên ví riêng tư của người kia không vào tổng.
### Verified in code
`src/domain/snapshot.ts` › `buildSnapshot` (`spendable`, `perWallet`) · `src/services/ledger.ts` › `getSnapshot` · `src/mcp/tools.ts` › `registerTools` (`get_snapshot`) · `src/cron/daily.ts` › `daily` · `web/src/lib/pending.ts` › `spendableAmount`, `applyQueue`.

## ADR-27: Báo log chưa gán bằng cron mỗi phút, chỉ log đã chờ ≥ 60 giây
- Date: 2026-09-21 · Status: accepted · Tinh chỉnh bởi ADR-68 (tắt được và có giờ yên lặng) và ADR-70 (mỗi 15 phút, đêm 01:00–04:00 mỗi giờ)
- Plan ID: — · Context: notify
- Source: validate report §5, "Những chỗ tôi tự quyết" #3; `phase-04` "Báo log pending bằng cron mỗi phút"
### Context
Worker không có timer nên không "gộp 5 phút" trong một request được; báo ngay thì chân thứ nhất của chuyển nội bộ bị báo nhầm là tiền lạ.
### Decision
Cron `* * * * *` gom log `pending` đã nhận ≥ 60 giây và chưa báo → một tin gộp; không báo trong webhook.
### Consequences
Độ trễ thực tế 1–2 phút. Cách đánh dấu "đã báo" được sửa ở ADR-45.
### Verified in code
`src/cron/pending-notifier.ts` › `notifyPendingLogs` (`DELAY_MS = 60_000`) · `wrangler.jsonc` cron `*/15 0-17,21-23 * * *` + `0 18,19,20 * * *` (từ ADR-70; ADR-68 là `*/5 * * * *`; trước đó `* * * * *`) · `src/cron/index.ts` › `tick`.

## ADR-28: Hợp đồng webhook SePay — `Apikey`, `{"success": true}`, idempotent theo `id`
- Date: 2026-09-21 · Status: accepted · Mở rộng bởi ADR-75 (một địa chỉ, nhận khoá của mọi kết nối SePay đang bật)
- Plan ID: — · Context: ingest
- Source: researcher report A.1–A.2; `phase-04` "Hợp đồng webhook SePay"; commit `c1a25c1`
### Context
SePay gửi lại tới 8 lần trong ~33 phút nếu không nhận đúng `{"success": true}` trong 30 giây.
### Decision
Xác thực `Authorization: Apikey <key>` (so sánh thời gian hằng); sai/thiếu → 401. Ghi log idempotent theo `id` rồi trả `{"success": true}`. `transactionDate` là giờ VN → ISO. HMAC-SHA256 để sau V1. Không log payload/số tài khoản ra console.
### Consequences
Cách xử lý lỗi sau khi ghi được sửa ở ADR-46.
### Verified in code
`src/routes/webhooks.ts` › `webhooks.post("/sepay")` · `src/routes/auth.ts` › `safeEqual` · `src/services/ingest.ts` › `ingestLog` (`SELECT id FROM bank_logs WHERE id = ?` rồi `INSERT OR IGNORE`), `vnDateTimeToIso` · `src/services/secrets.ts` › `loadSepayConnections` (trước ADR-75: `getSecret("sepay_webhook_key")`).

## ADR-29: Ghép cặp chuyển nội bộ chỉ giữa hai TK của hộ, gỡ được
- Date: 2026-09-21 · Status: accepted · Chân thứ hai về khi chân kia đã được gán (không còn `pending` để ghép): gắn vào giao dịch đã ghi — ADR-81
- Plan ID: — · Context: ingest
- Source: `docs/core_design_rules.md` §6 "Luật khớp cặp"; validate report §5; `phase-04` "Rủi ro ghép cặp sai"; `plans/reports/fullstack-developer-260922-0020-sepay-ingest.md` §2
### Context
Chuyển giữa hai TK của mình sinh hai log; ghép theo số tiền + thời gian có thể nuốt một khoản thu thật.
### Decision
Thứ tự khớp: mã lệnh `PF` → ghép cặp nội bộ → rule → còn lại `pending`. Ghép chỉ khi hai log thuộc hai TK khác nhau của hộ, ngược chiều, cùng số tiền, lệch ≤ 10 phút, đều còn `pending`. Tin sáng liệt kê số cặp tự ghép hôm qua; gỡ cặp = void giao dịch, hai log về `pending`. Log `out` không có chân đối ứng → gợi ý "Rút tiền mặt".
### Consequences
Rủi ro ghép nhầm khi hai người trùng số tiền ngẫu nhiên được chấp nhận có chủ đích (có test tái hiện). Gợi ý "Rút tiền mặt" cho log `out` không có chân đối ứng chỉ khi nội dung trông như rút tiền mặt (ATM, RUT TIEN…) — trả QR, hoá đơn, chân mồ côi của lệnh `PF` không còn bị gợi ý nhầm là rút tiền (sửa lỗi 2026-10-03, ingest UC-305 v15).
### Verified in code
`src/domain/rules.ts` › `canPair` · `src/services/ingest.ts` › `matchLog` (bước "2+3"), `unassignTransaction`, `pairLogs` · `src/routes/logs.ts` › `logs` (`POST /logs/transactions/:txId/void`, `POST /logs/pair`) · `src/cron/daily.ts` › `daily` (`pairedTransfersYesterday`).
- [DIVERGENCE] `docs/core_design_rules.md` §6 có bước 2 riêng "tài khoản đối ứng thuộc `accounts` của hộ → `transfer`"; code gộp bước 2 vào bước 3 vì payload SePay không có trường tài khoản đối ứng (giả định chưa kiểm bằng payload thật).

## ADR-30: MCP stateless bằng `@hono/mcp`, secret trong path, không log path
- Date: 2026-09-21 · Status: superseded by ADR-97 (2026-10-08 — đường dẫn chứa khoá, `@hono/mcp` và người xem mặc định là chủ hộ đã bỏ; vẫn stateless, dựng server mới mỗi request)
- Plan ID: — · Context: mcp
- Source: researcher report B.1, B.2; `phase-06-mcp.md`; commits `bc0d2a2`, `a5baefb`
### Context
`McpAgent` (Durable Object) đã bị Cloudflare khai tử cho server mới; Claude hỗ trợ connector authless; secret trong URL có thể lọt log.
### Decision
Route `ALL /mcp/:secret`, tạo `McpServer` + `StreamableHTTPTransport` mới cho mỗi request (không Durable Object, `sessionIdGenerator: undefined`, JSON response). Sai/thiếu secret → 404 như route không tồn tại; `MCP_SECRET` rỗng → luôn 404. Không bao giờ log path chứa secret (`a5baefb`). 12 tool chỉ gọi hàm dùng chung với REST; `add_transaction` bắt buộc `by_member_id` là thành viên đang hoạt động. Khi tài khoản Claude có "Request headers" thì chuyển secret sang header.
### Consequences
MCP không có phiên người dùng → tool đọc dùng người xem mặc định là chủ hộ.
### Verified in code
`src/routes/mcp.ts` › `mcp` (`safeEqual`, `c.notFound()`, bắt `HTTPException`) · `src/index.ts` › `app.onError` (thay path `/mcp/...` bằng `/mcp/[redacted]`) · `src/mcp/tools.ts` › `registerTools` (`unknown_member`).
- [OPEN] Resource `pf://rules` không làm (`plans/reports/fullstack-developer-260922-0020-mcp-server.md` "Việc chưa làm"). Phần "đường xác thực bằng header chưa làm" đóng bởi ADR-97 (OAuth Bearer token).

## ADR-31: D12 — Nhập offline, có mạng tự sync, chống trùng theo `client_id`
- Date: 2026-09-21 · Status: accepted
- Plan ID: D12 · Context: pwa
- Source: `context.md` D12 (chủ nhà đổi ý so với non-goal cũ); commit `e9ef25c`; commit `b92fc0f` (schema v1.4); `phase-05` "Nhập offline"
### Context
Nhập liệu chủ yếu trên điện thoại, ngoài đường.
### Decision
Mỗi khoản nhập tay mang `client_id` sinh ở máy; server chống trùng theo `client_id` nên gửi lại bao nhiêu lần cũng ghi một lần. Chỉ nhập tay được làm offline; gán log, chia tiền, đếm ví cần mạng. Khoản chưa sync được trừ tạm vào số "còn lại".
### Consequences
Hàng đợi IndexedDB (lùi về localStorage); các sửa lỗi an toàn ở ADR-41.
### Verified in code
`migrations/0003_offline_entry_and_allocation_runs.sql` (`idx_tx_client` UNIQUE) · `src/services/ledger.ts` › `createEntry` (đọc trước, bắt trùng khoá rồi đọc lại) · `web/src/offline/queue.ts` › `createSyncer`, `classify` · `web/src/lib/pending.ts` › `applyQueue`.

## ADR-32: D13 — Mobile-first, PWA dựng từ đầu theo `DESIGN.md`
- Date: 2026-09-21 · Status: accepted
- Plan ID: D13 · Context: pwa
- Source: `context.md` D13; commit `e9ef25c`; `phase-05-pwa.md`; commit `a756f68`
### Context
Điện thoại là màn hình chính, một tay.
### Decision
Mobile-first là ưu tiên số một; PWA dựng từ đầu (Vite + Preact + Tailwind, không router lib, 4 tab cố định Hôm nay · Nhập · Gán · Ví & Quỹ) trong khuôn khổ `docs/DESIGN.md`; mục tiêu nhập 3 chạm dưới 5 giây.
### Consequences
Màn rộng về sau chỉ được thêm, không đổi giao diện điện thoại (ADR-53).
### Verified in code
`web/src/app.tsx` (`NAV` 4 tab) · `web/src/screens/entry.tsx` · `web/src/screens/today.tsx`, `assign.tsx`, `wallets.tsx`.

## ADR-33: Giữ hành vi của hệ Apps Script `MzaSepaySheetLib`
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: ingest
- Source: commit `b95b218`; `phase-04` "Học từ hệ đang chạy", "Chạy song song"; `plans/reports/fullstack-developer-260922-0020-sepay-ingest.md` §1, §5
### Context
Chủ nhà đang chạy thật SePay → Google Sheet; không bắt người dùng học mã mới.
### Decision
Mã 3 chữ cái `[QE]xx` bắt bằng `\b[QE][A-Z]{2}\b` trên nội dung đã bỏ dấu, viết hoa; không có mã thì dò từ khoá. Thứ tự khớp rule: `code` chính xác → `content` (substring) → `account`. Seed `EAN`, `EPL`, `EXE`, `EMS` + từ khoá `XANG`, `SHOPEE`, `LAZADA`, `TIKI`; cố ý **không** seed `QTT`. Mã lệnh chuyển tiền dùng tiền tố `PF` để không đụng khuôn `[QE]xx`. Chạy song song với Sheet khoảng một tháng rồi mới tắt Apps Script.
### Consequences
Red team offline-ingest #1 (HIGH, còn mở): `EMS` khớp cả "cước gửi EMS" → tự gán sai danh mục, im lặng.
### Verified in code
`src/domain/rules.ts` › `normalizeContent`, `extractCode`, `matchRule`, `suggestRulePattern` · `migrations/0002_seed.sql`, `migrations/0004_sepay_rules.sql`.
- [OPEN] Chủ nhà chưa trả lời: giữ hay đổi mã `EMS`; mã `QTT` nạp vào ví nào (`summary-260922-0130-overnight-build.md` câu 2, 3). Code không có lớp an toàn cho mã trùng từ thông dụng.

## ADR-34: Chia tiền nguyên tử, tối đa một lần cho mỗi khoản thu
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: allocation
- Source: commit `b92fc0f`; `phase-03` "POST /allocate … trong một `db.batch()`"; `phase-04` "chia tiền idempotent theo `log_id`"
### Context
Lương có thể tới từ webhook lẫn rà soát đêm, người dùng có thể bấm hai lần.
### Decision
Ghi `allocation_runs(income_tx_id PRIMARY KEY, batch_id UNIQUE)` cùng mọi `fund` và `transfer_orders` trong một batch; trùng khoá → cả batch huỷ, trả `already_allocated`. Khoản thu đã huỷ không bao giờ được chia lại (`allocation_runs` giữ nguyên).
### Consequences
Red team money-correctness xác nhận hai request `Promise.all` chỉ chia một lần.
### Verified in code
`migrations/0003_offline_entry_and_allocation_runs.sql` bảng `allocation_runs` · `src/services/ledger.ts` › `allocateIncome`, `undoAllocationStatements` (không xoá `allocation_runs`).

## ADR-35: Phiên đăng nhập ký HMAC theo người + Bearer token cho script
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: access
- Source: commit `b92fc0f`; `phase-01` bước 6; commit `4b6d298`; `plans/reports/redteam-260922-0100-auth-exposure.md` "Đã kiểm tra và thấy ổn", #4, #5
### Context
PWA cần phiên theo người; script/n8n cần gọi API.
### Decision
`/v1/*` nhận cookie `pf_session` = `member_id.exp.sig` (HMAC phụ thuộc cả `API_TOKEN` lẫn `APP_PASSWORD`, `SameSite=Lax`) **hoặc** `Authorization: Bearer <API_TOKEN>` kèm `X-Member-Id` tuỳ chọn (không kèm → chủ hộ; sai → 400 `unknown_member`). Thiếu cấu hình → khoá hẳn. So sánh thời gian hằng. Hardening `4b6d298`: tách cookie từ cuối để `member_id` có dấu chấm vẫn đúng; route danh mục/rule chọn và kiểm từng trường thay vì ép kiểu `as never`.
### Consequences
Đổi `APP_PASSWORD` làm mọi phiên cũ vô hiệu.
### Verified in code
`src/routes/auth.ts` › `issueSession`, `readSession`, `requireAuth`, `safeEqual`, `SESSION_COOKIE` · `src/index.ts` › `app.use("/v1/*", requireAuth)`.

## ADR-36: PWA build từ `web/` ra `public/` không commit; SW network-first cho `GET /v1/*`
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: pwa
- Source: commit `a756f68`; `plans/reports/ui-ux-designer-260922-0020-pwa-mobile-offline.md` "Quyết định cần anh chị biết", §6
### Context
`public/` sinh hoàn toàn khi build.
### Decision
`/public/` vào `.gitignore`, nguồn tĩnh ở `web/public/`, `npm run deploy` luôn build trước. Service worker viết tay: precache app shell; `GET /v1/*` network-first, mất mạng trả bản cache kèm `x-sw-cached-at` ("số lúc HH:mm"); không cache `/v1` khác GET, không đụng `/webhooks/*`, `/mcp/*`; xoá cache khi 401 hoặc đăng xuất.
### Consequences
Sau khi clone phải `npm run build` trước `npm run dev` (đã ghi trong `README.md`).
### Verified in code
`.gitignore` (`/public/`) · `web/sw.js` › `apiGet` (gắn `x-sw-cached-at`; từ ADR-69 trả bản lưu còn tươi trước khi hỏi mạng; không đụng `/webhooks/`, `/mcp/`) · `web/src/state/store.ts` › `logout` (`caches.delete("vi-nha-api")`).

## ADR-37: Bàn phím số vẽ trong app thay bàn phím hệ thống
- Date: 2026-09-22 · Status: superseded by ADR-51
- Plan ID: — · Context: pwa
- Source: commit `a756f68`; `plans/reports/ui-ux-designer-260922-0020-pwa-mobile-offline.md` "Bàn phím trong app thay cho autofocus"
### Context
iOS không mở bàn phím khi focus bằng code ở chế độ standalone; bàn phím hệ thống che lưới danh mục và nút Lưu.
### Decision
Bàn phím số trong app luôn mở, có phím `000`, nằm trong tầm ngón cái.
### Consequences
Bị thay bằng ô nhập số gốc ở `032d089`.
### Verified in code
⚠ not implemented (đã gỡ ở `032d089`: `appendDigits`, `dropDigit`, CSS `.keys`, `.keypanel` không còn).

## ADR-38: Khoản offline bị server từ chối vẫn trừ tạm vào "còn lại"
- Date: 2026-09-22 · Status: proposed (awaiting owner)
- Plan ID: — · Context: pwa
- Source: `plans/reports/ui-ux-designer-260922-0020-pwa-mobile-offline.md` "Quyết định cần anh chị biết" và câu hỏi 3; `summary-260922-0130-overnight-build.md` câu hỏi 6
### Context
Khoản bị từ chối (ví dụ danh mục đã xoá) vẫn là tiền đã ra khỏi túi.
### Decision
Đề xuất (đang chạy): cả khoản `pending` lẫn `rejected` trong hàng đợi đều được trừ tạm vào snapshot hiển thị. Chủ nhà chưa xác nhận.
### Consequences
Đổi ý chỉ cần lọc `status === "pending"` trước khi `applyQueue`.
### Verified in code
`web/src/state/store.ts` › `viewSnapshot` (`applyQueue(s.snap, s.queue)` không lọc trạng thái) · `web/src/lib/pending.ts` › `effectsOf`.

## ADR-39: Gán log — `create_rule` boolean; mọi kiểm tra trước khi ghi sổ
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: ingest
- Source: commit `8c319c1`
### Context
PWA luôn gửi `create_rule: true/false` nhưng endpoint từ chối → mọi lần gán từ điện thoại trả 400; một lỗi sau khi đã ghi sổ mời client gửi lại.
### Decision
`create_rule`: trống/`false` = không tạo; `true` = tự rút mẫu từ nội dung log (mã `[QE]xx`, không có thì chuỗi từ dài nhất không chứa số); object = mẫu chỉ định. Điều kiện tạo rule kiểm **trước** khi ghi; rule không tạo được thì báo kèm lần gán thành công, không biến thành lỗi.
### Consequences
Nguyên tắc "không báo lỗi sau khi giao dịch đã vào sổ" được áp tiếp cho ingest ở ADR-46.
### Verified in code
`src/routes/logs.ts` › `logs` (khối `wantRule`, `ruleBlocker`) · `src/domain/rules.ts` › `suggestRulePattern` · `src/services/ingest.ts` › `createRuleFromSplit`.

## ADR-40: Một giao dịch ngân hàng vào sổ tối đa một lần
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: ingest
- Source: commit `c3ab508`; `plans/reports/redteam-260922-0100-money-correctness.md` #1 (PoC 1b); `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md`
### Context
Mỗi đường khớp ghi giao dịch và đổi log sang `assigned` bằng hai lệnh D1 riêng → webhook gửi lại, rà soát đêm, bấm hai lần có thể ghi cùng khoản tiền hai lần.
### Decision
Mỗi đường khớp là **một batch**; chốt ở DB (migration 0005, schema v1.5): giao dịch chỉ sinh được từ log còn `pending` (cả `log_id` lẫn `log_id_2`), lệnh chuyển tiền chỉ hoàn tất một lần, `(account_id, reference_number)` là UNIQUE khi có mã. Trigger huỷ batch → coi là request khác đã xử lý, không ghi lần hai. Gỡ gán một log void **mọi** dòng tách từ log đó và mở lại lệnh chuyển nó đã hoàn tất. Nội dung ngân hàng được chuẩn hoá khoảng trắng trước khi dò từ khoá.
### Consequences
Chưa chặn được trường hợp một bên thiếu mã tham chiếu → ADR-47/ADR-49.
### Verified in code
`migrations/0005_ingest_integrity_guards.sql` (`idx_logs_ref` UNIQUE, `trg_tx_needs_pending_log`, `trg_tx_second_leg_needs_pending_log`, `trg_transfer_order_settles_once`) · `src/services/ingest.ts` › `commit` (bắt `log_not_pending|order_not_pending`), `matchLog`, `unassignTransaction`, `ingestLog`.

## ADR-41: Hàng đợi offline không mất lặng lẽ, không ghi nhầm người, cache theo người
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: pwa
- Source: commits `80875be`, `9d32978`, `4b6d298`, `11b12b3`; `plans/reports/redteam-260922-0100-auth-exposure.md` #3; `redteam-260922-0100-offline-ingest-robustness.md` #3, #4 và mục "đã xác nhận VÁ"
### Context
Red team: khi cả IndexedDB lẫn localStorage bị chặn, khoản nhập bị nuốt mà màn hình báo đã lưu; server ghi "ai chi" theo phiên nên đổi người giữa lúc flush làm khoản của vợ ghi tên chồng; cache bootstrap/snapshot không theo người nên máy dùng chung lộ số của người trước; `refresh()` chạy song song flush làm "còn để chi" trừ trùng trong chốc lát; đồng hồ máy chạy nhanh làm khoản bị từ chối mà không rõ vì sao.
### Decision
- Không lưu được vào máy → báo lỗi (`StorageUnavailableError`), giữ số đã gõ (`80875be`).
- Flush kiểm lại người đang đăng nhập **trước mỗi lần gửi**, đổi người thì dừng; khoản thất bại ≥ 3 lần được phép bỏ (`9d32978`).
- Khoá cache có `member_id`; vào app với người khác người trước — **kể cả khi không biết người trước** — thì xoá cache app và cache API của SW (`80875be`, `4b6d298`).
- Quay lại app: gửi hàng đợi **xong** rồi mới tải số (`11b12b3`).
- Lỗi `future_at` giải thích đồng hồ điện thoại có thể đang chạy nhanh (`11b12b3`).
### Consequences
`toLogin()` (phiên hết hạn) vẫn không xoá cache, nhưng cache đã theo người nên không lộ số của người kia.
### Verified in code
`web/src/offline/idb.ts` › `StorageUnavailableError`, `cacheClear` · `web/src/state/store.ts` › `cacheKey`, `forgetOtherMember`, `enter`, listener `visibilitychange` · `web/src/offline/queue.ts` › `createSyncer` (`flushOnce` kiểm `deps.memberId() !== me`) · `web/src/screens/entry.tsx` (nút "Gửi lại"/"Bỏ" khi `attempts >= 3`) · `src/domain/entry.ts` › `normalizeAt` (`future_at`).

## ADR-42: Mã lệnh chuyển tiền ngẫu nhiên riêng từng lệnh; khớp theo memo
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: ingest
- Source: commits `8ef7a99`, `2334bc6`, `eb7846e`; `docs/core_design_rules.md` §4, §9 "Mã lệnh chuyển tiền"; `redteam-260922-0100-auth-exposure.md` #2; `redteam-260922-0100-money-correctness.md` #4; `code-reviewer-260922-0330-redteam-fixes-review.md` #1
### Context
`PF <batch_id>` suy ra từ id tăng dần/lịch → ai chuyển đúng số tiền với memo đoán được sẽ đánh dấu một lệnh thật là "đã chuyển"; khớp `(batch_id, amount)` chọn nhầm lệnh khi một đợt có nhiều lệnh; gỡ gán chân một trước khi chân hai về làm log mồ côi và bị gợi ý "Rút tiền mặt".
### Decision
Mỗi lệnh có memo `PF` + 6 ký tự ngẫu nhiên riêng; khớp theo `memo` + số tiền + tài khoản + chiều. Chân hai gắn vào giao dịch của **log đã hoàn tất lệnh đó** (không theo batch). Khi lệnh còn `pending` mà chân kia đang `pending` với cùng memo → ghép cả hai vào một giao dịch (`eb7846e`). Thay thế ADR-08.
### Consequences
Chủ nhà chép memo từ màn "Chuyển tiền cần làm".
### Verified in code
`src/domain/transfer-orders.ts` › `newTransferMemo` · `src/domain/rules.ts` › `extractTransferMemo` · `src/services/ingest.ts` › `matchLog` (nhánh memo, `otherLeg`) · `src/services/ledger.ts` › `allocateIncome`, `closeMonth` (`newTransferMemo()`).

## ADR-43: Ngưỡng tự nhận lương `salary_min_amount`
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: ingest
- Source: commit `099e54f`, `eb7846e`; `docs/core_design_rules.md` §9 "Mẫu lương"; `redteam-260922-0100-auth-exposure.md` #1; `code-reviewer-260922-0330-redteam-fixes-review.md` #4
### Context
Rule lương khớp theo nội dung ai cũng gõ được: chuyển 1.000 ₫ nội dung "LUONG THANG" là app tự ghi thu nhập và chia ngay.
### Decision
Chỉ tự ghi thu nhập + tự chia khi khoản khớp mẫu lương có số tiền ≥ `config('salary_min_amount')`, mặc định 1.000.000 ₫; nhỏ hơn thì để `pending`, hỏi như mọi tiền vào khác. Đặt `0` là bỏ ngưỡng (`eb7846e`); giá trị không hợp lệ rơi về mặc định.
### Consequences
Khoản dưới ngưỡng hiện ở màn Gán với loại mặc định "Thu nhập"; gán xong PWA gọi `/v1/allocate`.
### Verified in code
`src/services/ledger.ts` › `salaryMinAmount` (`n >= 0 ? n : 1_000_000`) · `src/services/ingest.ts` › `matchLog` (`log.amount >= await salaryMinAmount(db)`) · `src/services/settings.ts` › `updateConfig` (`salary_min_amount` 0…1e12).
- [OPEN] Chủ nhà chưa xác nhận mức 1.000.000 ₫ (`summary-260922-0130-overnight-build.md` câu 5).

## ADR-44: Huỷ khoản thu đã chia = gỡ lần chia; cấm khi tiền đã chuyển thật
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: allocation
- Source: commits `099e54f`, `eb7846e` (migration 0006); `docs/core_design_rules.md` §9 "Huỷ khoản thu đã chia"; `code-reviewer-260922-0330-redteam-fixes-review.md` #2
### Context
Trước `099e54f` khoản thu đã chia không huỷ được (`allocated`); kiểm "đã chuyển chưa" ở app là đọc-rồi-ghi, đua được với nút "Đã chuyển".
### Decision
Huỷ một income (hoặc gỡ log sinh ra nó) void mọi `fund` của lần chia và `skipped` các lệnh chuyển còn `pending`. Nếu có lệnh của lần chia đã `done` → từ chối `allocation_settled` (409), phải gỡ lệnh chuyển trước. Chốt cả ở DB bằng trigger. Không huỷ lẻ bút toán hệ thống (`fund`, `source='system'`).
### Consequences
Khoản thu đã huỷ không được chia lại (ADR-34).
### Verified in code
`src/services/ledger.ts` › `undoAllocationStatements`, `voidTransaction` (`system_tx`), `runUndo` · `src/services/ingest.ts` › `unassignTransaction` · `migrations/0006_allocation_undo_guard.sql` (`trg_fund_void_needs_unsettled_batch`).

## ADR-45: Cảnh báo log chưa gán chỉ đánh dấu "đã báo" khi gửi được
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: notify
- Source: commit `b468f54`; `redteam-260922-0100-offline-ingest-robustness.md` mục "đã xác nhận VÁ"
### Context
Log bị đánh dấu đã báo trước khi gửi → Telegram lỗi một lần là khoản tiền lạ không bao giờ được báo.
### Decision
Chỉ ghi `notifications(kind='pending_log', ok=1)` sau khi gửi được cho ít nhất một người; không ai nhận được thì lần chạy sau thử lại, trong 24 giờ. Tên tài khoản escape HTML; tin tối đa 20 dòng ("… và N khoản khác").
### Consequences
Sau 24 giờ thôi thử lại; tin sáng vẫn báo số chưa gán.
### Verified in code
`src/cron/pending-notifier.ts` › `notifyPendingLogs` (`RETRY_WINDOW_MS`, `MAX_LINES = 20`, `if (sent === 0) return`).

## ADR-46: Không bỏ lặng lẽ giao dịch ngân hàng; từ chối ngày giờ vô lý
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: ingest
- Source: commits `a954744`, `eb7846e`; `redteam-260922-0100-offline-ingest-robustness.md` "đã xác nhận VÁ"; `code-reviewer-260922-0330-redteam-fixes-review.md` #3
### Context
Payload không đọc được bị `console.error` rồi nuốt, luôn trả success → mất giao dịch vĩnh viễn; `Date.parse` đẩy 30/2 sang tháng 3; lỗi sau khi log đã lưu trả 503 nhưng SePay gửi lại thì `ingestLog` dừng sớm nên không bao giờ chạy lại bước lỗi.
### Decision
- Payload hỏng → ghi `notifications(kind='ingest_error')` (không kèm số tài khoản/nội dung), trả success; tin 07:00 báo số giao dịch không đọc được trong 24 giờ.
- Lỗi tạm thời **trước khi** lưu log (ví dụ D1) → 503 để SePay gửi lại.
- Lỗi **sau khi** log đã lưu (ví dụ lương ghi rồi nhưng chia lỗi) → ghi `ingest_error`, không 503 (`eb7846e`).
- Ngày không có thật bị từ chối; chấp nhận giờ không có giây; số tiền phải là số nguyên an toàn ≤ 1.000 tỷ VND.
### Consequences
Lương kẹt "đã ghi, chưa chia" lộ ra ở tin sáng thay vì im lặng.
### Verified in code
`src/routes/webhooks.ts` › `webhooks.post("/sepay")` · `src/services/ingest.ts` › `recordIngestError`, `vnDateTimeToIso`, `ingestLog` (khối `catch` sau `matchLog`), `parseWebhookPayload`, `parseHistoryRow` · `src/cron/daily.ts` › `daily` (`unreadableBankTransactions`) · `src/cron/backfill.ts` › `runBackfill`.

## ADR-47: Log webhook/backfill "song sinh" thiếu mã tham chiếu coi là một và bỏ
- Date: 2026-09-22 · Status: superseded by ADR-49
- Plan ID: — · Context: ingest
- Source: commit `b8e8f0c`; `redteam-260922-0100-money-correctness.md` #1 (PoC 1a: lương 40tr chia thành 80tr)
### Context
Webhook không có `referenceCode`, rà soát đêm báo cùng giao dịch với `id` khác và có mã → hai log, lương chia hai lần; unique index của 0005 không bắt được khi một bên NULL.
### Decision
Hai log khác nguồn, cùng tài khoản, số tiền, chiều, lệch ≤ 3 phút, một bên thiếu mã → coi là một (log sau bị bỏ). Hai webhook giống hệt nhau khác `id` vẫn là hai.
### Consequences
Reviewer chỉ ra một khoản thật khác cùng số tiền có thể biến mất không dấu vết → thay bằng ADR-49 trong cùng đêm.
### Verified in code
⚠ not implemented (đã thay ở `43baea1`; điều kiện so khớp còn nguyên trong `src/services/ingest.ts` › `findPossibleTwin` nhưng không còn bỏ log).

## ADR-48: D14 — Tài khoản có bank feed không nhận nhập tay, không đếm số dư khi còn log chưa gán
- Date: 2026-09-22 · Status: proposed (awaiting owner)
- Plan ID: D14 · Context: ledger
- Source: `context.md` D14; commit `b8e8f0c`; `docs/core_design_rules.md` §9 "Tài khoản có bank feed"; `redteam-260922-0100-money-correctness.md` #2, #3; `summary-260922-0130-overnight-build.md` "Một quy tắc mới cần bạn xác nhận"
### Context
Nhập tay 150k rồi MB báo về đúng khoản đó, người kia gán tiếp → ví bị trừ 300k mà `book_drift` không thấy; đếm số dư TK có feed khi còn log `pending` sinh `adjust` rồi gán log là trừ lần hai.
### Decision
Đề xuất sau red team 22/9, **chờ chủ nhà xác nhận**, nhưng đã có hiệu lực trong code: mọi biến động của TK có feed chỉ về từ ngân hàng. Nhập tay chạm TK `sepay_enabled=1` bị từ chối `fed_account` (hướng sang màn Gán); nhập tay chỉ cho tiền mặt và TK ghi tay. Đếm số dư TK có feed bị từ chối `pending_logs` (409) khi còn log chưa gán. PWA chỉ đưa TK ghi tay vào các ô chọn tài khoản khi nhập.
### Consequences
Áp cho cả MCP `add_transaction`; khoản cũ trong hàng đợi offline chạm TK có feed sẽ bị `rejected` và bỏ được.
Tinh chỉnh bởi ADR-66 (2026-10-01): chỉ chặn **chiều tiền SePay báo về** — tiền vào TK đã nối SePay luôn bị chặn; tiền ra chỉ bị chặn khi TK bật `sepay_out`; PWA lọc ô tài khoản theo chiều (`manualAccounts(accounts, "in" | "out")`).
### Verified in code
`src/services/ledger.ts` › `createEntry` (`fed_account`), `countAccount` (`pending_logs`) · `web/src/lib/categories.ts` › `manualAccounts`, `defaultAccountFor` · `web/src/screens/entry.tsx`, `other-entry-sheet.tsx` (`manualAccounts(boot.accounts)`).

## ADR-49: Log có thể trùng — vẫn ghi, không tự khớp, gắn nhãn "có thể trùng"
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: ingest
- Source: commit `43baea1`; `docs/core_design_rules.md` §9 "Tài khoản có bank feed"; `summary-260922-0130-overnight-build.md`
### Context
Bỏ log sau (ADR-47) là mất tiền lặng lẽ; tự khớp log sau là có thể chia lương hai lần.
### Decision
**Không đoán**: log từ nguồn khác cùng tài khoản, số tiền, chiều, lệch ≤ 3 phút mà một bên thiếu mã tham chiếu vẫn được ghi nhưng **không tự khớp**; nó ở `pending`, nhận cảnh báo như thường, màn Gán gắn nhãn "có thể trùng" và gợi ý Bỏ qua. Lương báo hai lần kiểu này vẫn chỉ được chia một lần.
### Consequences
Người trong nhà quyết định cuối; test tái hiện số liệu PoC.
### Verified in code
`src/services/ingest.ts` › `findPossibleTwin`, `ingestLog` (`if (accountId && !twin)`), `listPendingLogs` (`possible_duplicate_of`) · `web/src/screens/assign.tsx` (banner "Có thể trùng").

## ADR-50: Định danh tài khoản — khớp `subAccount` (VA) trước số tài khoản
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: ingest
- Source: commit `11b12b3`; `phase-04` "Định danh TK bằng `accountNumber` (+ `subAccount`)"; `redteam-260922-0100-offline-ingest-robustness.md` #2
### Context
`subAccount` bị bỏ qua dù schema có `accounts.sub_account` → mọi tài khoản ảo dưới cùng số chính gộp về một tài khoản.
### Decision
Webhook và dòng API lịch sử có `subAccount` được khớp với TK của hộ có `sub_account` đó trước, rồi mới rơi về `account_no`. Không khớp được thì vẫn lưu log với `account_id NULL`, không chạy khớp.
### Consequences
Log TK lạ vẫn hiện trong cảnh báo ("TK lạ").
### Verified in code
`src/services/ingest.ts` › `ingestLog` (tra `sub_account` rồi `account_no`), `ParsedBankLog.subAccount` · `src/cron/pending-notifier.ts` › `notifyPendingLogs` (`"TK lạ"`).

## ADR-51: Ô số tiền dùng bàn phím số của máy
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: pwa
- Source: commit `032d089`; `plans/reports/ui-ux-designer-260922-1150-settings-screen.md` "Bàn phím số được thay thế thế nào"
### Context
Thay ADR-37 (yêu cầu của chủ nhà trong lượt làm màn Cài đặt).
### Decision
Ô `inputmode="numeric"` nhóm chấm khi gõ; cả vùng số tiền là `<label>` nên chạm đâu cũng focus; giữ chip +50k/+100k/+200k, thêm +000 và Xoá; chặn số vượt 1.000 tỷ; Enter lưu khi đủ thông tin. iOS có thể cần một chạm để bật bàn phím.
### Consequences
Luồng 3 chạm giữ nguyên: số tiền → danh mục → Lưu.
### Verified in code
`web/src/screens/entry.tsx` (chú thích đầu file, `amountRef`) · `web/src/lib/money.ts` › `nextAmount`, `amountText`, `addAmount`, `timesThousand`.

## ADR-52: Cấu hình qua màn Cài đặt; khoá kết nối lưu D1, dự phòng `wrangler secret`, chỉ lộ 4 ký tự cuối
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: access
- Source: commits `c80ae89`, `032d089`, `6fcbdf8`, `35c9a8f`; `plans/reports/ui-ux-designer-260922-1150-settings-screen.md` câu hỏi 3
### Context
Trước đó mọi bước "để dùng thật" phải chạy `wrangler` và sửa SQL.
### Decision
`/v1/settings` (sau `requireAuth`) cho sửa tài khoản (số TK, bật SePay), ví và luật nạp, mã chuyển khoản, `tg_chat_id` thành viên, `salary_min_amount`, `emergency_months`; có nút gửi thử Telegram và kiểm tra API SePay. Khoá SePay webhook, token API SePay, bot token Telegram đặt được từ app, lưu ở `config`, **không bao giờ trả nguyên** (chỉ `set`, 4 ký tự cuối, và `source` `app|server`); không đặt ở app thì dùng `wrangler secret`. Chỉ khoá đặt từ app mới có nút xoá (`6fcbdf8`). Không tắt được ví Thu nhập, Tích sản, ví nhận phần còn lại. Cài đặt chỉ xem khi offline.
### Consequences
`API_TOKEN`, `APP_PASSWORD`, `MCP_SECRET` vẫn chỉ là `wrangler secret`.
### Verified in code
`src/routes/settings.ts` › `settingsRoutes` · `src/services/settings.ts` › `getSettings`, `updateAccount`, `updateWallet` (`required_wallet`), `updateRule`, `updateMember`, `updateConfig`, `updateIntegrations`, `testTelegram`, `testSepay` · `src/services/secrets.ts` › `SECRET_NAMES`, `getSecret`, `describeSecret`, `setSecret` · `web/src/screens/settings-sheets.tsx` (nút xoá khi `secret.source !== "server"`).
- [DIVERGENCE] `safety_fund_months` (trước v1.28: `emergency_months`, ADR-92): server nhận 1–36 (`src/services/settings.ts` › `updateConfig`, `max: 36`), client chỉ cho 1–24 (`web/src/lib/settings.ts` › `configPayload`).

## ADR-53: Màn hình rộng ≥ 1024px chỉ thêm, không đổi giao diện điện thoại
- Date: 2026-09-22 · Status: accepted
- Plan ID: — · Context: pwa
- Source: commits `0ee6969`, `a68c9d6` (`docs/DESIGN.md` §7b); `plans/reports/ui-ux-designer-260922-1210-desktop-redesign.md`
### Context
D13 chỉ yêu cầu desktop "không vỡ"; dùng trên máy tính cần nhiều thông tin hơn.
### Decision
Một mốc duy nhất `(min-width: 1024px)` (thêm cột phụ từ 1280px). Trên mốc: thanh bên thay bottom nav + FAB, phím **N** mở Nhập, Hôm nay thành bảng điều khiển, banner thành danh sách việc cần làm, Gán là master-detail, sheet thành hộp thoại giữa màn, bảng thêm cột kỳ trước. Dưới mốc giữ nguyên từng DOM node. Màn rộng dùng chỗ trống để thêm cột/danh sách, không để trang trí. FAB ẩn ở Nhập và Cài đặt.
### Consequences
Không đổi backend; số trên màn rộng lấy từ endpoint `/v1` sẵn có.
### Verified in code
`web/src/ui/shell.tsx` › `WIDE`, `useWide`, `Sidebar`, `useQuickEntryKey` · `web/src/app.tsx` · `web/src/screens/today-desktop.tsx` › `RecentTransactions`.

## ADR-54: Lên Workers Paid theo số đo CPU thật
- Date: 2026-09-22 · Status: proposed (awaiting owner)
- Plan ID: — · Context: platform
- Source: commit `daccf9b`; `plan.md` Validation Summary "Đo CPU thật"; `summary-260922-0130-overnight-build.md` "Để dùng thật" bước 7; `plans/reports/fullstack-developer-260922-0020-mcp-server.md` "Đo CPU"
### Context
ADR-12: vượt 10 ms CPU thì lên Paid. Đo `wrangler tail` trên `vi-nha.example` (22/9, 11 request): `/v1/snapshot` 4–16 ms, `/v1/allocate/preview` 9–19 ms, `/v1/bootstrap` 3–21 ms, trung vị ≈ 10 ms; chưa request nào bị chặn. MCP chỉ đo wall time trên Node (1,62 ms), không phải CPU Workers.
### Decision
Khuyến nghị lên Workers Paid (5 USD/tháng) trước khi dùng thật, hoặc xác nhận tài khoản MZA đã ở gói Paid. Chủ nhà chưa xác nhận.
### Consequences
Nếu ở lại Free, request vượt 10 ms có thể bị chặn.
### Verified in code
⚠ not verified — quyết định gói tài khoản, không có trong code (`wrangler.jsonc` không khai báo gói).

## ADR-55: Nơi đặt tài khoản Tích sản và Thuế
- Date: 2026-09-21 · Status: accepted (chốt 2026-10-01 trong change `261001-cho-thue-lai`)
- Plan ID: — · Context: allocation
- Source: `plan.md` "Còn mở" #1; validate report "Câu hỏi còn mở" #1; `summary-260922-0130-overnight-build.md` câu 4
### Context
Profit First cần hai khoản này ở chỗ khó rút; cả nhà chỉ dùng MB.
### Decision
Hai ứng viên: TK riêng của vợ hoặc TK BIDV của chồng. Khuyến nghị BIDV (khác ngân hàng, có ma sát thật), không cần nối SePay — tiền ra từ MB được nhận ra nhờ mã lệnh `PF XXXXXX`, mỗi tháng nhập số dư BIDV một lần.
**Chốt (2026-10-01):** Tích sản đặt ở **BIDV của chồng, ghi tay** (bảng "Cấu hình không cần code" của `specs/changes/archive/261001-cho-thue-lai/proposal.md`). Không cần code: đổi `account_id` của ví Tích sản ở Cài đặt.
### Consequences
Quyết định này quyết định `wallets.account_id` của Tích sản/Thuế, tức là lệnh chuyển nào được sinh.
### Verified in code
⚠ cấu hình, không phải code — `migrations/0002_seed.sql` vẫn đặt Tích sản/Thuế ở TK mẫu (`tcb-anh`, `mb-anh`); chủ nhà đổi qua Cài đặt (`src/services/settings.ts` › `updateWallet`). Dữ liệu production chưa kiểm được từ repo.
- [OPEN] Change 261001 chỉ chốt nơi đặt Tích sản; nơi đặt ví **Thuế** vẫn chưa ai nói.

## ADR-56: Quota cron trigger trên cả tài khoản Cloudflare
- Date: 2026-09-21 · Status: proposed (awaiting owner)
- Plan ID: — · Context: platform
- Source: `plan.md` "Dependencies" và "Còn mở" #2; validate report "Câu hỏi còn mở" #2; researcher report C
### Context
Gói Free cho 5 cron trigger trên **cả tài khoản** (tính chung mọi Worker); app dùng 4 (từ ADR-68 còn 2, ADR-70 vẫn 2).
### Decision
Cần chủ nhà kiểm tra các Worker khác trên cùng tài khoản đang dùng mấy trigger. Chưa có câu trả lời.
### Consequences
Nếu tổng vượt 5 trên gói Free, một cron có thể không đăng ký được; lên gói Paid (ADR-54) cho 250 trigger.
### Verified in code
`wrangler.jsonc` `triggers.crons` (2 mục từ ADR-68, vẫn 2 ở ADR-70) · `src/cron/index.ts` › `CRONS`. Quota tài khoản: ⚠ not verified.

## ADR-57: Phase 00 — xác nhận SePay với MB bằng quan sát thật
- Date: 2026-09-21 · Status: proposed (awaiting owner)
- Plan ID: — · Context: ingest
- Source: `phase-00-sepay-spike.md`; `plan.md` Action Items; `redteam-260922-0100-money-correctness.md` "Câu hỏi còn mở" #1; `summary-260922-0130-overnight-build.md` "Để dùng thật" bước 3
### Context
Lời chủ nhà (MB có tiền ra) và bảng SePay ("Tiền ra: Không") lệch nhau; `id` webhook có trùng `id` API lịch sử hay không chưa ai quan sát.
### Decision
Chủ tài khoản chuyển thử 10.000 ₫ vào/ra/giữa hai TK, xem log về, `accumulated`, nội dung có giữ nguyên, `id` webhook vs API; điền bảng kết quả, chọn nhánh A/B/C/D, lưu 2–3 payload thật làm fixture. Chưa làm — bảng kết quả trong `phase-00` còn trống.
### Consequences
Rule engine, ghép cặp (ADR-29 gộp bước 2) và chống trùng (ADR-40, ADR-49) đang dựa trên payload tự dựng theo tài liệu.
### Verified in code
⚠ not verified — việc chủ nhà làm ngoài code; code hiện đi theo nhánh A (`src/routes/webhooks.ts`, `src/cron/backfill.ts` › `runBackfill`).

## ADR-58: Cho thuê lại là nguồn thu riêng; ghi thu theo tiền thật; sổ người thuê là sổ phải thu ngoài sổ cái
- Date: 2026-10-01 · Status: accepted
- Plan ID: — · Context: rental
- Source: `specs/changes/archive/261001-cho-thue-lai/proposal.md` (v4–v5, "Vì sao" ý 1–3, 6; "Nguyên lý")
### Context
Nhà thuê nguyên căn 22.500.000 ₫/quý, có một người ở ghép (An), sau này có thể thêm/bớt. Ngân sách hộ là ngân sách gộp (có người thuê hay không thì tiền nhà, điện nước, ăn uống vẫn phải chi). Engine cũ chia mọi khoản thu bằng một bộ phần trăm: tiền An gán `income` sẽ bị chia như lương (~70% vào ví chi tiêu), gán `refund` thì vào thẳng ví chi tiêu.
### Decision
Cho thuê lại là một mảng riêng. Tiền người thuê trả là `income` thật của sổ cái, ghi khi tiền về, mang `transactions.tenant_id`. Người thuê nợ bao nhiêu nằm ở **sổ phải thu** `tenant_lines` ngoài sổ cái — không đụng ví, không đụng tài khoản. Người thuê không phải `member`, không đăng nhập; tiền họ chuyển không phải chuyển nội bộ. Phương án bị loại: coi người thuê là `member`; ngân sách ròng (trừ phần người thuê khỏi ngân sách hộ); gán `refund` vào ví.
### Consequences
Có context mới `rental` (UC-801…805) và BR-11. Huỷ một khoản thu của người thuê là số dư phải thu tự đúng lại (không có dòng `payment` riêng — khác bản proposal, xem UC-805).
### Verified in code
`migrations/0007_income_streams_rental.sql` (`tenants`, `tenant_lines`, `transactions.tenant_id`, view `v_tenant_balance`) · `src/domain/entry.ts` › `buildEntry` (nhánh `income`, `tenant_id`) · `src/services/rental.ts`.

## ADR-59: Phần khóa theo từng nguồn thu (`IncomeStream`); không chọn nguồn giữ hành vi cũ
- Date: 2026-10-01 · Status: accepted
- Plan ID: — · Context: allocation
- Source: `specs/changes/archive/261001-cho-thue-lai/proposal.md` ("allocation — UC-201/UC-203: chia theo nguồn thu"; "Vì sao" ý 4)
### Context
Lương chồng (≈ 19.100.000, đã trừ thuế) chi hết; lương vợ (10–12tr) khóa 45% vào Tích sản; tiền cho thuê không được vào ví chi tiêu. Một bộ phần trăm Tích sản/Thuế chung (ADR-13) không diễn tả được.
### Decision
Mỗi nguồn thu có danh sách phần khóa `{ví, %}` riêng, cắt trên chính khoản thu trước dòng thác. Khoản thu có nguồn: chỉ cắt theo nguồn, **không** chạy luật `percent` chung của Tích sản/Thuế (kể cả thuế); khóa trọn 100% thì không chạy dòng thác (đồng lẻ về ví khóa đầu tiên); không khóa gì thì cả khoản vào dòng thác. Khoản thu **không** có nguồn chia y như cũ. Nguồn gắn khi nhập tay/gán log, hoặc theo rule lương; tiền người thuê không chọn nguồn thì lấy `config.rental_income_stream_id`.
### Consequences
Seed `luong-chong` (không khóa), `luong-vo` (Tích sản 45%), `cho-thue` (Thu cho thuê 100%). Sửa nguồn ở Cài đặt (tổng ≤ 100%, không khóa vào ví Thu nhập). Khoản thu chịu thuế mà gắn nguồn thì không bị trích Thuế — xem [OPEN] ở allocation UC-201.
### Verified in code
`src/domain/allocation.ts` › `allocate` (`input.stream`) · `src/services/ledger.ts` › `loadRefs` (`incomeStreams`), `previewAllocation`, `allocateIncome` · `src/services/settings.ts` › `createIncomeStream`, `updateIncomeStream`, `lockStatements` · `migrations/0007_income_streams_rental.sql` (`income_streams`, `income_stream_locks`, `transactions.income_stream_id`, `rules.income_stream_id`) · test `test/allocation.test.ts` › "chia theo nguồn thu › stream null y hệt không khai báo nguồn".

## ADR-60: Tiền vào từ người thuê chỉ được gợi ý, không tự gán
- Date: 2026-10-01 · Status: accepted
- Plan ID: — · Context: ingest
- Source: `specs/changes/archive/261001-cho-thue-lai/proposal.md` (UC-805, "ingest — UC-305")
### Context
Luật 6 (ADR-02): tiền vào phải hỏi, trừ lương khớp mẫu và đủ ngưỡng. Nội dung chuyển khoản của người thuê ai cũng gõ được.
### Decision
Rule được phép mang `tenant_id` (chỉ cho `meaning = income`) nhưng chỉ để **gợi ý** "Thu từ <tên>" ở màn Gán; bước tự khớp bỏ qua mọi rule có `tenant_id`; người vẫn bấm xác nhận.
### Consequences
Rule người thuê lưu `is_salary = 1` (DB đòi mọi rule income có cờ này) nhưng không bao giờ tự ghi thu nhập.
### Verified in code
`src/services/ingest.ts` › `matchLog` (lọc `!r.tenantId`), `suggestFor`, `createRule` (`tenant_rule_income_only`) · test `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán".

## ADR-61: Tính với người thuê = phí cố định + chi chung chia đều theo số người; chốt tay mỗi tháng, chênh lệch mang sang bằng số dư
- Date: 2026-10-01 · Status: accepted
- Plan ID: — · Context: rental
- Source: `specs/changes/archive/261001-cho-thue-lai/proposal.md` (History v1–v4, "Vì sao" ý 3, 5, 6; "Câu hỏi 4 cũ")
### Context
Nhà thật làm thế này: mỗi tuần ngồi với người thuê một lần, cuối tháng chốt một lần. Bản v1–v3 của proposal (đợt ở, tính theo ngày ở, bốn `mode` tính phí, cọc, ngân sách tự tăng theo người) bị chủ nhà đánh giá là quá phức tạp.
### Decision
Mỗi tháng người thuê nợ: các phí cố định + `floor(tổng chi chung / số người)` (phần lẻ hộ chịu). Tổng chi chung = hộ chi (chi − hoàn) trong danh mục chi chung + mọi khoản người thuê tự chi hộ. App điền sẵn bản nháp; người sửa được (số người, từng dòng, dòng chỉnh) rồi lưu **một lần** mỗi (người thuê, tháng). Chi vượt thì người thuê trả thêm, chi không vượt thì số dư âm tự trừ tháng sau. Người vào/ra giữa tháng: sửa tay lúc chốt, không có công thức theo ngày. Không đặt cọc; thẻ xe là phí một lần. Phương án bị loại (v1–v3): tính theo ngày ở, bốn `mode`, ngân sách tự tăng theo người, cọc.
### Consequences
Không có khái niệm "tạm thu" hay "quyết toán chênh lệch". Tháng đã chốt muốn sửa: huỷ dòng rồi ghi `adjust`. Nhà có thêm người (con, bố mẹ) thì tăng số người chia, phần người thuê giảm.
### Verified in code
`src/domain/rental.ts` › `sharePerHead`, `monthDraft` · `src/services/rental.ts` › `sharedTotal`, `tenantMonth`, `settleMonth` · `migrations/0007_income_streams_rental.sql` (`tenant_settlements` PRIMARY KEY) · test `test/rental.test.ts` › "/v1/rental › ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau".

## ADR-62: Mua vàng không cần đợi phao đầy; phao chỉ tính tiền mặt
- Date: 2026-10-01 · Status: accepted
- Plan ID: — · Context: ledger
- Source: `specs/changes/archive/261001-cho-thue-lai/proposal.md` ("Vì sao" ý 7; "ledger — UC-101"); thay `docs/profit_first_phuong_phap.md` §5 "phao đầy rồi mới sang assets" (đã sửa)
### Context
`docs/profit_first_phuong_phap.md` §5 cũ: tiền Tích sản chỉ rẽ sang assets khi phao đầy; code chưa bao giờ kiểm phao khi `buy_asset` ([DIVERGENCE] cũ ở ledger UC-101).
### Decision
Mua vàng (tài sản) khi giá xuống, **bất cứ lúc nào** Tích sản còn tiền mặt — không đợi phao đầy. Phao khẩn cấp so với **tiền mặt** Tích sản, không tính vàng; vàng là tài sản dài hạn. Code đúng, sửa `docs/`.
### Consequences
Mua tài sản làm phao đầy chậm hơn — chấp nhận. Một phần Consequences của ADR-04 ("Nút Mua tài sản chỉ mở khi phao đầy") bị thay bởi ADR này.
### Verified in code
`src/services/ledger.ts` › `createEntry` (`buy_asset` chỉ kiểm `insufficient_cash`) · `migrations/0001_schema.sql` view `v_tichsan` (`cash` = số dư − Σ `buy_asset`), `v_emergency_fund` (dùng `v_tichsan.cash`) · `web/src/screens/wallets.tsx` › `TichsanTab` (nút "Mua tài sản" luôn bật; phao < 100% chỉ hiện gợi ý "Phao chưa đầy. Phao chỉ tính tiền mặt — tài sản mua lúc nào cũng được.").

## ADR-63: Tiền cho thuê vào ví giữ riêng "Thu cho thuê"; trả nợ hay sang Tích sản do vợ chồng quyết từng lần
- Date: 2026-10-01 · Status: accepted
- Plan ID: — · Context: rental
- Source: `specs/changes/archive/261001-cho-thue-lai/proposal.md` (History v5; "Vì sao" ý 2, 8; "allocation — Dùng tiền trong Thu cho thuê")
### Context
Tiền người thuê ưu tiên trả nợ (15.379.000), sau đó mới Tích sản; số tiền mỗi lần tuỳ khoản nợ nào nên trả bao nhiêu.
### Decision
Nguồn cho thuê khóa 100% vào ví giữ riêng "Thu cho thuê" (`thu-cho-thue`, tier `holding`, kind `accrual` — khác ví Thu nhập là tier `holding` **và** kind `holding`). Ví giữ riêng không vào "còn để chi", không vào bảng ngân sách, không vào trung bình chi Must của phao; hiện riêng ở `snapshot.reserves`. Trả nợ = chi danh mục `tra-no` từ ví này (ví giữ riêng chi được); sang Tích sản = chuyển kèm ví. App không chia sẵn tỷ lệ. Phương án bị loại: tỷ lệ cố định Trả nợ/Tích sản — chủ nhà muốn quyết theo từng khoản nợ.
### Consequences
Ví giữ riêng chỉ tạo được bằng migration (Cài đặt không tạo/không tắt được ví tier `holding`). Phân biệt ví Thu nhập phải dùng `isIncomeHolding` (tier **và** kind), không chỉ tier.
### Verified in code
`src/domain/types.ts` › `isIncomeHolding`, `isReserve` · `src/domain/snapshot.ts` › `buildSnapshot` (`reserves`) · `src/domain/entry.ts` › `buildEntry` (`spend` chỉ chặn ví Thu nhập và Tích sản) · `src/services/ledger.ts` › `getBudget` (lọc tier `holding`) · `migrations/0007_income_streams_rental.sql` (ví `thu-cho-thue`, danh mục `tra-no`, nguồn `cho-thue`).

## ADR-64: Kênh thông báo thứ hai: Web Push chuẩn trên PWA
- Date: 2026-10-01 · Status: accepted · Nội dung kênh push tinh chỉnh bởi ADR-79 (bản ngắn riêng thay cho tin Telegram bỏ thẻ) · Kênh thứ ba Zalo Bot thêm ở ADR-80
- Plan ID: — · Context: notify (+ pwa, access)
- Source: `specs/changes/archive/261001-pwa-web-push/proposal.md`; `plans/reports/researcher-261001-pwa-web-push.md` (Executive Summary, §2–§4, Unresolved Questions)
### Context
Mọi lời nhắc chỉ đi qua Telegram (ADR-09), nhưng vợ ít dùng Telegram nên BR-06 chỉ đúng với một người. PWA đã cài trên điện thoại cả hai người. Ràng buộc: Worker không có `crypto` của Node (thư viện `web-push` không chạy); iPhone chỉ nhận Web Push khi app đã "Thêm vào MH chính" (iOS ≥ 16.4) và mọi push phải hiện thông báo; không muốn bắt chủ nhà chạy lệnh tạo khoá hay trả phí thêm.
### Decision
- Thêm kênh **Web Push chuẩn** (Push API + VAPID, RFC 8030/8291/8292) bên cạnh Telegram, dùng service worker viết tay sẵn có. Mã hoá `aes128gcm` và ký JWT ES256 bằng thư viện `@block65/webcrypto-web-push` (chỉ dùng Web Crypto, chạy trên Workers).
- Khoá VAPID **tự sinh** (ECDSA P-256) ở lần đầu có request tới `/v1/push`, lưu trong `config` (`secret:vapid_private_jwk`, `vapid_public`, `vapid_subject` = origin của app); khoá riêng không bao giờ ra API, không ghi log.
- Mỗi máy đã bật là một dòng `push_subscriptions` gắn người đang đăng nhập; `notifyMembers` gửi tới **mọi kênh đang bật** của mọi thành viên (Telegram nếu có `tg_chat_id`, push tới từng máy), chống trùng bằng cùng bảng `notifications` (`chat_id = 'push:<id>'`), giữ luật claim-trước-gửi của ADR-09.
- Push service trả **404/410** → xoá máy ngay, không thử lại; 429/5xx thử lại như Telegram.
- Muốn tắt kênh nào thì tắt ở chính kênh đó (nút Tắt trên máy; bỏ `tg_chat_id` cho Telegram).

Phương án bị loại: **dịch vụ push trả phí** (SaaS bên thứ ba) — thêm chi phí và bên thứ ba cho một hộ hai người, trong khi Web Push chuẩn miễn phí ("Không cần dịch vụ push trả phí" — báo cáo nghiên cứu); **chỉ Declarative Web Push** (Safari 18.4+) — chỉ Apple, app đã có service worker nên đường chuẩn chạy cho mọi trình duyệt; **tự viết phần mã hoá** (HKDF + AES-GCM + ES256) — khả thi nhưng tự gánh crypto, không đáng; **cho mỗi người chọn kênh** (chỉ Telegram / chỉ PWA) — thêm cấu hình mà bật/tắt ở chính kênh đã đủ (câu hỏi mở của báo cáo nghiên cứu).
### Consequences
Tin có thể tới một người hai lần (Telegram và push) — chấp nhận. `notifyMembers` không còn trả 0 khi thiếu bot token; "đã báo" của UC-407 tính cả push. Schema lên v1.8. Cron không sinh khoá: chưa ai mở thẻ Thông báo thì kênh push im lặng. iPhone/iPad phải thêm app vào màn hình chính trước khi bật (UC-714). Thêm một phụ thuộc runtime (`@block65/webcrypto-web-push`).
### Verified in code
`src/services/push.ts` › `ensureVapid`, `loadVapid`, `sendPush` (404/410 → `DELETE`), `pushToMembers` · `src/notify/telegram.ts` › `notifyMembers` · `src/routes/push.ts` · `migrations/0008_push_subscriptions.sql` · `web/sw.js` (handler `push`, `notificationclick`, `pushsubscriptionchange`) · `web/src/state/push.ts` › `enablePush` · `package.json` › `@block65/webcrypto-web-push` · test `test/push.test.ts` › "khoá VAPID › sinh một lần ở lần GET đầu, giữ nguyên về sau; khoá riêng không bao giờ ra API"; `test/push.test.ts` › "notifyMembers qua push › push service trả 410 thì xoá máy đó, claim giữ ok=0; máy khác vẫn nhận".

## ADR-65: Rà soát đêm và "Kiểm tra SePay" dùng SePay API v2 thay API cũ `userapi/`
- Date: 2026-10-01 · Status: accepted · Supersedes phần chọn endpoint của ADR-23
- Plan ID: — · Context: ingest (+ access)
- Source: yêu cầu chủ nhà ("SePay đã có API mới, dưới v1 thì nâng lên"); [Upgrade from v1](https://developer.sepay.vn/en/sepay-api/v2/nang-cap-tu-v1), [List Transactions v2](https://developer.sepay.vn/en/sepay-api/v2/giao-dich/danh-sach), [List Bank Accounts v2](https://developer.sepay.vn/en/sepay-api/v2/tai-khoan-ngan-hang/danh-sach), [Auth & rate limit v2](https://developer.sepay.vn/en/sepay-api/v2/xac-thuc)
### Context
App gọi API cũ `https://my.sepay.vn/userapi/transactions/list` (lọc theo `account_number`, trả HTTP 200 cả khi lỗi, tiền là chuỗi thập phân). SePay đã ra API v2 tại `https://userapi.sepay.vn/v2`: trả đúng mã HTTP (401/422/429), luôn bọc `data`, tiền là số nguyên, id UUID, phân trang `page`/`per_page` (tối đa 100), lọc ngày `transaction_date_from`/`_to`, giới hạn 3 request/giây. API cũ vẫn chạy song song nhưng là bản legacy. Webhook SePay không có phiên bản mới — payload giữ nguyên (`id` số nguyên, `transactionDate`, `transferType`, `transferAmount`…), xác thực `Authorization: Apikey` vẫn được hỗ trợ.
### Decision
- Thêm `src/services/sepay-api.ts` (client v2): `listTransactions` (đi hết trang, tối đa 50 trang), `listBankAccounts`; 429 → chờ `Retry-After` (≤ 5 giây) rồi thử lại một lần; lỗi → `SepayApiError(status, code)`.
- Rà soát 02:00 (UC-304): một lượt gọi cho cả công ty theo cửa sổ ngày, lọc ở app theo `account_number`/`va` của TK bật SePay (v2 không lọc theo số tài khoản; lọc theo UUID thì phải tra thêm `/v2/bank-accounts`). `parseHistoryRow` đọc trường v2 (`transfer_type`, `va`, tiền số nguyên).
- "Kiểm tra SePay" (UC-508): `/v2/bank-accounts` + `/v2/transactions`, báo riêng tài khoản ở app mà SePay chưa nối.
- Webhook: giữ nguyên (không có bản mới). Không đổi sang HMAC-SHA256 lúc này — chủ nhà không yêu cầu; API Key vẫn được SePay hỗ trợ.
Phương án bị loại: **giữ API cũ** — chủ nhà yêu cầu nâng; **gọi riêng từng tài khoản theo `bank_account_id`** — thêm một lời gọi tra UUID và nhiều request hơn trong khi giới hạn 3 request/giây.
### Consequences
`id` của log từ rà soát giờ là UUID, không còn trùng `id` số của webhook: chống trùng webhook ↔ rà soát chỉ còn dựa vào `(account_id, reference_number)` (ADR-40); giao dịch không có mã tham chiếu sẽ hiện "có thể trùng" ở màn Gán (ADR-49) thay vì tự nhận ra. Token API dùng chung (Bearer, lấy ở Company Settings › API Keys) — không cần token mới.
### Verified in code
`src/services/sepay-api.ts` › `SEPAY_API`, `listTransactions`, `listBankAccounts`, `SepayApiError` · `src/cron/backfill.ts` › `runBackfill` (từ ADR-75: `syncSepay`) · `src/services/ingest.ts` › `parseHistoryRow` · `src/services/settings.ts` › `testSepay` · test `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › đi hết các trang; bỏ giao dịch của tài khoản không bật SePay ở app; tiền ra đọc theo transfer_type"; `test/settings.test.ts` › "khoá kết nối SePay / Telegram › kiểm tra một kết nối SePay (API v2): liệt kê tài khoản SePay đang nối; tài khoản có trong SePay thì đếm giao dịch 7 ngày; chưa nối thì báo; token sai thì báo". Gọi thật `https://userapi.sepay.vn/v2/transactions` không token → HTTP 401 `{"error_code":"unauthorized"}` (2026-10-01), khớp tài liệu.

## ADR-66: Danh mục ngân hàng theo tài liệu SePay; D14 tinh chỉnh theo chiều tiền
- Date: 2026-10-01 · Status: accepted · Tinh chỉnh ADR-48 (D14); [DIVERGENCE] với ADR-17 (D5)
- Plan ID: — · Context: ledger (+ access, ingest, pwa)
- Source: yêu cầu chủ nhà (ô "Ngân hàng" ở Cài đặt › Tài khoản phải là danh sách chọn, để xử lý tiền vào/tiền ra theo từng ngân hàng như tài liệu SePay); [SePay — Tài khoản ngân hàng hỗ trợ](https://developer.sepay.vn/en/sepay-webhooks/tai-khoan-ngan-hang) (đọc 2026-10-01)
### Context
Ô ngân hàng là chữ gõ tự do (`MB`, `TCB`…), nên app không biết SePay làm được gì với tài khoản đó. Theo tài liệu SePay, chỉ 10 ngân hàng có webhook, và phần lớn **chỉ báo tiền vào**: ACB, BIDV (bắt buộc VA), MBBank, MSB (bắt buộc VA), KienlongBank (bắt buộc VA), OCB (bắt buộc VA), VPBank — tiền vào có, tiền ra không; Sacombank, TPBank, VietinBank báo cả hai chiều. Ngân hàng ngoài bảng thì không có webhook. Trong khi đó D14 (ADR-48) chặn **mọi** nhập tay trên TK `sepay_enabled=1`: nếu MB chỉ báo tiền vào, khoản chi trả bằng MB không bao giờ vào sổ được — không nhập tay được, cũng không có log để gán.
### Decision
- **Danh mục dùng chung** `src/domain/banks.ts` › `BANKS` (`code`, `name`, `sepay: { in, out, vaRequired? } | null`): 10 ngân hàng SePay theo đúng bảng trên, các ngân hàng phổ biến không có SePay (Vietcombank, Techcombank, Agribank, VIB, HDBank, SHB, SeABank, Eximbank, LPBank, Nam A Bank, SCB, PVcomBank, Cake, Timo) và `Khac`. `accounts.bank` của TK ngân hàng/thẻ là `code` (`invalid_bank`); ví điện tử giữ tên tự do. Migration 0010 đổi tên gõ tay cũ sang mã.
- **SePay theo ngân hàng**: chỉ bật được cho ngân hàng có `sepay` (`bank_not_supported`).
- **Cột mới `accounts.sepay_out`** ("SePay báo cả tiền ra"): mặc định theo tài liệu lúc bật SePay (migration đặt 1 cho TK đang nối SePay của VietinBank/TPBank/Sacombank, 0 cho còn lại); chủ nhà **được bật tay** dù tài liệu nói không — sau khi chuyển thử và thấy tiền ra về app (phase-00, ADR-57); tắt SePay → 0.
- **D14 theo chiều tiền**: nhập tay **tiền vào** TK đã nối SePay luôn bị `fed_account` (SePay luôn báo tiền vào); nhập tay **tiền ra** chỉ bị `fed_account` khi `sepay_out=1`. PWA lọc ô tài khoản theo chiều (`manualAccounts(accounts, "in" | "out")`).
- **Chốt ở ingest**: log `out` của TK `sepay_out=0` (SePay vẫn gửi tiền ra dù app tưởng không) **không bao giờ bị bỏ**, không tự gán theo rule (giữ `pending`), gợi ý ở màn Gán kèm lời nhắc "Nếu khoản này đã nhập tay thì Bỏ qua; rồi bật 'SePay báo cả tiền ra' ở Cài đặt."; memo PF và ghép cặp chuyển nội bộ vẫn chạy.
Phương án bị loại: **giữ D14 chặn mọi chiều** — khoản chi MB mất khỏi sổ nếu tài liệu đúng; **tin lời chủ nhà (MB có tiền ra) cho mọi TK MB** — nếu tài liệu đúng thì như trên; **danh mục lấy động từ `/v2/bank-accounts`** — API không trả khả năng tiền vào/ra, vẫn phải có bảng tay.
### Consequences
- [DIVERGENCE] ADR-17 (D5): chủ nhà xác nhận MB có đủ tiền vào lẫn tiền ra; tài liệu SePay (21/9 và đọc lại 1/10/2026) ghi MBBank "Tiền ra: Không". Chưa có quan sát thật (ADR-57 còn treo). Giải bằng cờ theo từng tài khoản: mặc định theo tài liệu (`sepay_out=0` cho MB), chủ nhà bật sau khi thử — không chọn một bên cho cả hệ thống.
- Sau khi deploy, TK MB đang nối SePay chuyển sang "chỉ tiền vào": khoản chi MB nhập tay được, log `out` MB (nếu SePay vẫn gửi) nằm chờ ở màn Gán thay vì tự gán theo rule.
- [OPEN] TK "chỉ tiền vào" mà SePay thật ra có báo tiền ra: khoản đã nhập tay và log `out` cùng tồn tại; app chỉ nhắc, không chặn người gán tiếp — gán là đếm hai lần, `book_drift` không thấy (chỉ so log với giao dịch sinh từ log).
- Đã đóng 2026-10-06 bởi ADR-87: [OPEN] cũ "TK chỉ báo tiền vào: `feed_drift` (so `accumulated` của ngân hàng) sẽ lệch dần, `reconcile_drift` được ghi mỗi ngày có log" — app không còn đọc `accumulated`, không còn `feed_drift` hay `reconcile_drift`.
- Danh mục chép tay: SePay đổi bảng hỗ trợ thì phải sửa `BANKS` (access UC-506).
- `docs/core_design_rules.md` (bảng "Đường ghi" và dòng "Tài khoản có bank feed" ở §9) sửa theo ADR-66; `docs/schema.sql` lên v1.10.
### Verified in code
`src/domain/banks.ts` › `BANKS`, `bankByCode` · `migrations/0010_bank_catalog.sql` · `src/services/settings.ts` › `sepayFields`, `createAccount`, `updateAccount` · `src/services/ledger.ts` › `loadRefs` (`sepayOut`), `createEntry` (D14 theo chiều) · `src/services/ingest.ts` › `matchLog`, `outNotFed`, `suggestFor` · `web/src/lib/categories.ts` › `manualAccounts`, `defaultAccountFor` · `web/src/lib/settings.ts` › `bankHint`, `sepayOutHint`, `sepayOutDefault`, `accountPayload` · `web/src/screens/settings-sheets.tsx` › `AccountSheet` · test `test/settings.test.ts` › "tài khoản › SePay báo cả tiền ra: mặc định theo tài liệu SePay (MB chỉ tiền vào, Sacombank cả ra), chủ nhà bật tay được, tắt SePay thì về tắt"; `test/ingest-integrity.test.ts` › "D14 theo chiều tiền (ADR-66): MB nối SePay, chỉ báo tiền vào › nhập tay khoản chi trả bằng MB được — SePay không báo tiền ra nên không đếm hai lần"; `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền ra khớp rule chi → không tự gán, giữ pending; màn Gán gợi ý theo rule kèm lời nhắc có thể đã nhập tay"; `test/migrations/milestones.test.ts` › "migrations › 0010 đổi tên ngân hàng gõ tay sang mã danh mục; chỉ ngân hàng SePay báo tiền ra mới giữ sepay_out = 1".

## ADR-67: Tối ưu giao diện theo audit 261001
- Date: 2026-10-01 · Status: accepted
- Plan ID: — · Context: pwa (+ allocation: `wallet_names` của lệnh chuyển tiền)
- Source: `plans/reports/ui-ux-audit-261001-pwa.md` (phát hiện F01–F23, cột Status); `docs/DESIGN.md` (sửa cùng commit `11c52a0`)
### Context
Audit UI/UX 01/10/2026 trên dữ liệu thật (390×844 và 1280×800) thấy vấn đề lớn nhất ở điện thoại: bảng Ngân sách cắt mất cột "Còn lại"; hero "Còn để chi tuần này" cộng nhiều phong bì nên ví dư che ví đã âm; FAB che nút cuối trang; sáu tab Ví & quỹ và chín mục Cài đặt phần lớn nằm ngoài màn. Sau đó là chữ phụ `--fg-3` chỉ 3,18:1, vùng chạm < 44px, từ kỹ thuật/tiếng Anh lọt ra giao diện ("gợi ý: transfer", "ròng", "rule", "feed", ba cách viết "Must"), màu đỏ cho việc bình thường.
### Decision
- **Không đổi công thức, chỉ đổi cách hiện**: hero vẫn là `spendableThisWeek`, nhưng kê từng phong bì ngay dưới, ví âm lên đầu (`orderSpendable`) — câu hỏi mở 2 của audit (đổi công thức hero) để nguyên.
- **Dưới 1024px không dùng bảng quá 2 cột số**: Ngân sách và Tài khoản thành hàng tầng (tên · số quan trọng nhất to bên phải · dòng phụ); số ngân hàng/lệch chỉ hiện ở tài khoản SePay. Màn rộng giữ bảng (bỏ cột Mục tiêu tháng ở bảng phong bì Hôm nay).
- **Ví âm**: số dư thật âm là một dòng riêng "Số dư thật −X — vượt từ trước, chưa bù" + nút **Bù**, tách khỏi "còn lại" của kỳ.
- **Điều hướng**: tab con Ví & quỹ xuống dòng, không cuộn ngang ("Chuyển tiền cần làm" → "Chuyển tiền"); Cài đặt sắp theo tần suất (Ví & số tiền nạp → Tài khoản → Cho thuê → Nguồn thu → Mã chuyển khoản → Thông báo → Thành viên), **Nâng cao** (Kết nối, Tham số) gập sẵn, hàng chip dính; Giao diện + Đăng xuất chuyển từ Hôm nay sang Cài đặt › **Máy này**.
- **Luật chung**: FAB hiện thì nội dung chừa đáy; `--fg-3` ≥ 4,5:1; vùng chạm ≥ 44px; ô số dùng Inter + `tabular-nums`; sheet mở thẳng một việc không hiện `seg` chọn loại; danh sách dòng sửa được mỗi dòng một hàng, tổng dính trên nút chính; đỏ chỉ cho vượt chi/sổ lệch ("tiền vào — phải hỏi" thành vàng).
- **Chữ**: một lượt theo bảng từ — "Lần sau tự gán giao dịch có nội dung giống thế này", "Bỏ qua giao dịch này", "SePay tự cập nhật" / "nhập tay", "vào trừ ra", nhóm "Must" một cách viết, "Nếu chốt hôm nay" cho tạm tính người thuê.
- **Lệnh chuyển tiền nói cho ví nào**: `GET /v1/transfer-orders` trả thêm `wallet_names` (allocation UC-205); PWA ghi "cho {ví}".

Phương án bị loại: **F18 vuốt xuống để đóng sheet + hỏi lại khi form đã sửa** — công M, để sau (ghi [OPEN] ở pwa UC-711); **cuộn tab con vào giữa + mép mờ** (đề xuất F04) — chọn xuống dòng vì đơn giản hơn và tab đang chọn không bao giờ khuất; **đổi công thức hero** (chỉ cộng phong bì dương) — là quyết định nghiệp vụ, audit chỉ đề xuất hiện chi tiết.
### Consequences
DESIGN.md thêm các luật trên (token `--fg-3`, hero, bảng dưới 1024px, sheet, FAB, tab phụ, Ví âm, Cài đặt). Đăng xuất trên điện thoại nằm sâu hơn một bước (Cài đặt › Máy này). Câu hỏi mở 1, 3, 4 của audit (tháng mặc định khi chốt ngày 1; vợ chồng đã quen từ "Tích sản/Must/phao" chưa; ai dùng Cài đặt) chưa có câu trả lời — F11 chỉ thống nhất cách viết, Kết nối đã vào "Nâng cao".
### Verified in code
`web/src/lib/budget.ts` › `orderSpendable` · `web/src/screens/today.tsx` › `TodayBody` (hero kê phong bì, không còn `Footer`) · `web/src/screens/wallets.tsx` › `BudgetItem`, `NegativeLine`, `AccountsTab`, `TABS` · `web/src/screens/settings.tsx` › `SECTIONS` (`advanced`), `JumpBar`, `DeviceCard` · `web/src/screens/other-entry-sheet.tsx` › `OtherEntrySheet` (`title`) · `web/src/screens/assign.tsx` · `web/src/screens/tenants.tsx` › `SettleSheet` · `web/src/app.tsx` (`has-fab`) · `web/src/styles.css` (`--fg-3`, `.tabs.wrap`, `.tabs.sticky`) · `src/services/ledger.ts` › `listTransferOrders` (`wallet_names`) · test `web/src/lib/budget.test.ts` › "các phong bì dưới số còn để chi tuần này › ví âm lên đầu, âm nhiều nhất trước; ví còn dư giữ thứ tự server (kể cả ví bằng 0)"; `test/api.test.ts` › "chia lương end-to-end › lệnh chuyển tiền nói tiền đi cho ví nào: danh sách kèm tên các ví nhận trong lô ở tài khoản đích".

## ADR-68: Giờ nhắc chỉnh trong app qua cron mỗi 5 phút
- Date: 2026-10-01 · Status: accepted · Phần nhịp 5 phút **thay bởi ADR-70** (mỗi 15 phút, đêm mỗi giờ) · Tinh chỉnh ADR-12 (còn 2 cron trigger), ADR-27, ADR-56 (2 trigger)
- Plan ID: — · Context: notify (+ access: API cài đặt; pwa: thẻ Giờ nhắc)
- Source: yêu cầu chủ nhà — đổi giờ tin sáng / tổng kết tuần / giờ yên lặng ngay trong app (Cài đặt › Thông báo › Giờ nhắc), dùng chung cả nhà, không tốn thêm tiền Cloudflare; rồi giảm lượt cron (1440 → 288 lượt/ngày)
### Context
Giờ tin sáng (07:00) và tổng kết tuần (08:00 thứ Hai) nằm cứng trong `wrangler.jsonc`; đổi giờ là phải sửa file và deploy lại. Báo giao dịch chưa gán chạy mỗi phút cả đêm, kể cả lúc cả nhà đang ngủ. Cron mỗi phút là ~1440 lượt gọi Worker mỗi ngày — phần lớn số lần gọi Worker (ADR-69).
### Decision
- Bỏ hai cron cố định `0 0 * * *` và `0 1 * * 1`; chỉ còn `0 19 * * *` (rà soát 02:00, không gửi tin) và `*/5 * * * *` (288 lượt/ngày thay 1440).
- Giờ nằm trong bảng `config` (giờ VN, `HH:MM`, phút chia hết cho 5): `notify_daily_time` 07:00 · `notify_weekly_day` 1 (ISO, thứ Hai) · `notify_weekly_time` 08:00 · `notify_quiet_start` 22:00 · `notify_quiet_end` 06:30 · `notify_daily_enabled` / `notify_weekly_enabled` / `notify_pending_enabled` '1'. Một bộ cho cả nhà.
- Mỗi lượt 5 phút đọc lịch + mốc đã chạy bằng **một** câu `SELECT`; chưa tới giờ hay đã chạy thì về ngay, không đọc thêm gì. Tới giờ (hoặc đã qua mà hôm nay chưa chạy) thì giành mốc `INSERT OR IGNORE` vào `notifications` (`daily_run` theo ngày VN, `weekly_run` theo tuần được tổng kết, `chat_id = 'system'`); chỉ lượt giành được mới chạy. Việc ném lỗi thì nhả mốc để lượt sau làm lại.
- Tắt tin sáng không tắt chốt tháng ngày 1 (việc của sổ): vẫn chạy vào giờ tin sáng, chỉ không gửi.
- Giờ yên lặng chỉ chặn báo giao dịch chưa gán: log chờ lại, lượt đầu tiên sau giờ yên lặng gom thành một tin. Bắt đầu = kết thúc là không đặt.

Phương án bị loại: **app gọi API Cloudflare để sửa cron** — cần API token có quyền sửa Worker nằm trong Worker, mỗi lần đổi là một lần deploy cấu hình, và vẫn bị giới hạn số trigger (ADR-56); **lịch riêng từng người** — tin sáng là một tin chung của hộ, mốc chống trùng theo ngày; tách người là thêm bảng, thêm mốc theo người mà chưa ai cần; **giữ cron mỗi phút** — chủ nhà chọn bớt lượt gọi Worker, đổi lại độ trễ báo giao dịch chưa gán tới 5 phút.
### Consequences
Tin theo giờ đến trễ tối đa 5 phút nếu giờ chọn không trúng lượt cron (giờ luôn là bội số 5 nên bình thường trúng); Worker lỡ một lượt thì lượt sau gửi bù, không bao giờ hai lần một ngày. Báo giao dịch chưa gán chậm hơn: log chờ ≥ 60 giây, báo ở lượt 5 phút kế tiếp (thường 1–5 phút, trước là 1–2 phút). Đổi giờ sau khi hôm nay đã gửi thì mai mới áp dụng. Thêm một câu đọc D1 mỗi lượt (288 câu/ngày) thay cho 1152 lượt gọi Worker bớt đi. `[OPEN]` ở UC-401 (lịch khai hai nơi) vẫn còn, nay chỉ hai dòng.
`docs/core_design_rules.md` §8 sửa theo ADR-68 (cron mỗi 5 phút, giờ là mặc định, giờ yên lặng); `docs/schema.sql` lên v1.11 (chú thích khoá `notify_*` và mốc `daily_run`/`weekly_run`).
### Verified in code
`src/cron/schedule.ts` › `loadNotifyState`, `runScheduledDigests` · `src/domain/notify-schedule.ts` › `parseNotifySchedule`, `inQuietHours` · `src/cron/daily.ts` › `closePreviousMonthOnDayOne` · `src/cron/weekly.ts` › `summarisedSunday` · `migrations/0011_notify_schedule.sql` · `src/services/settings.ts` › `updateNotifySchedule` · `web/src/screens/settings-sheets.tsx` › `NotifyScheduleSheet` · test `test/cron-schedule.test.ts`. Nhịp cron hiện hành (`CRONS`, `tick`): xem ADR-70.

## ADR-69: Giảm request: cache ngắn hạn ở service worker
- Date: 2026-10-01 · Status: accepted · Tinh chỉnh ADR-36 (`GET /v1/*` không còn luôn mạng trước)
- Plan ID: — · Context: pwa
- Source: yêu cầu chủ nhà (giảm số request vào Cloudflare Worker); số đo 24 giờ: 1841 lần gọi Worker, ~1440 từ cron mỗi phút (phần cron xử lý riêng), ~400 từ app
### Context
Static assets đã không gọi Worker (`run_worker_first` chỉ cho `/v1`, `/webhooks`, `/mcp`), nên mọi request app còn lại là `GET /v1/*`. Service worker đi mạng trước cho **mọi** lần đọc: mở app, quay lại app sau 30 giây, mỗi lần `refresh()` tăng `version` làm mọi màn đang mở đọc lại đường của mình, vài màn cùng đọc một đường (`/v1/rental`, `/v1/settings`, `/v1/logs?status=pending`) — cùng một số liệu bị hỏi lại nhiều lần trong vài giây.
### Decision
- **Cache tươi trước ở service worker**: `GET /v1/*` có bản lưu trẻ hơn hạn tươi thì trả luôn, không hỏi mạng; hết hạn thì mạng trước như cũ (mất mạng vẫn trả bản lưu kèm `x-sw-cached-at`). Bản trả khi còn tươi bỏ header `x-sw-cached-at` — app coi là số mới, không hiện "số lúc HH:mm". Hạn tươi (`freshFor`): `/v1/bootstrap`, `/v1/settings`, `/v1/categories`, `/v1/rental` 5 phút; `/v1/health`, `/v1/session*` 0 (luôn mạng trước); còn lại (snapshot, budget, accounts, goals, spend-by-category, transfer-orders, transactions, logs, push, `/v1/rental/tenants/*/month`, đường lạ) 30 giây.
- **Ghi là xoá**: mọi yêu cầu không phải GET tới `/v1/*` đi qua service worker xoá sạch cache `vi-nha-api` trước **và** sau khi gửi; GET bắt đầu trước một lần xoá không được ghi kết quả vào cache (đếm `generation`). 401 cũng xoá sạch. Đăng xuất / đổi người vẫn xoá như cũ (UC-701).
- **Người bấm thì hỏi thẳng server**: nút **Đồng bộ** và nút **Tải lại** / đọc lại sau khi ghi của từng màn gửi header `x-no-cache: 1`, service worker bỏ qua bản lưu tươi. Thẻ Thông báo luôn gửi header này (đọc lại 5 giây một lần khi đang gửi thử).
- **Gộp GET trùng ở app**: `request` gộp các GET cùng đường đang chạy thành một lượt (`inflight`); yêu cầu ghi xoá bảng này để GET sau khi ghi không nhận kết quả của GET trước khi ghi. Quay lại app vẫn chỉ tải số khi lần tải trước đã quá 30 giây (UC-704 1b, có từ trước).
- Một nguồn cho hạn tươi: `web/src/lib/sw-fresh.ts` (có test), plugin `vi-nha-sw` dịch sang JS và chèn vào `sw.js` lúc build.

Phương án bị loại: **cache ở edge trong Worker (`caches.default`)** — request vẫn phải gọi Worker mới đọc được cache, không giảm số lần gọi; **hạn dài (vài phút cho số tiền)** — số dư/"còn để chi" cũ sau khi người kia nhập trên máy khác hay log ngân hàng về, sai lời hứa "số đúng" của BR-01; **ETag/304** — vẫn gọi Worker mỗi lần.
### Consequences
Số người kia nhập trên máy khác, log ngân hàng mới, lệnh chuyển tiền tự khớp hiện chậm tối đa 30 giây (cấu hình, danh mục, người thuê: 5 phút) trừ khi bấm Đồng bộ / Tải lại; thay đổi ghi từ chính máy này hiện ngay. [INFERENCE] Phần request từ app (~400/ngày) giảm mạnh nhất ở các cụm đọc lại trong vài giây (mở app, mỗi lần `refresh()` làm mọi màn đọc lại, nhiều màn cùng một đường); chưa đo lại sau khi triển khai.
### Verified in code
`web/sw.js` › `apiGet`, `apiWrite`, `invalidateApi`, `generation`, handler `fetch` · `web/src/lib/sw-fresh.ts` › `freshFor` · `web/vite.config.ts` › `serviceWorker` (chèn `freshFor` vào chỗ `/* __FRESH_FOR__ */`) · `web/src/lib/api.ts` › `inflight`, `request`, `NO_CACHE`, `httpTransport` · `web/src/state/store.ts` › `syncNow` (`refresh(true)`), `loadCached` · `web/src/state/resource.ts` › `useResource` (`reload` bỏ qua cache) · `web/src/state/push.ts` › `loadPushInfo` · test `web/src/lib/sw-fresh.test.ts`, `web/src/lib/api.test.ts`.

## ADR-70: Nhịp cron 15 phút, đêm 01:00–04:00 mỗi giờ
- Date: 2026-10-01 · Status: accepted · Thay phần nhịp 5 phút của ADR-68; gộp luôn cron rà soát `0 19 * * *` vào lượt chung
- Plan ID: — · Context: notify (+ ingest: rà soát 02:00; access/pwa: bước giờ 15 phút)
- Source: yêu cầu chủ nhà — "ngày vào 1–2 lần là cùng, thường tối 20–22h; đêm 1–4h gần như không có giao dịch"
### Context
Sau ADR-68 còn `*/5 * * * *` (288 lượt/ngày) + `0 19 * * *`. Hai vợ chồng chỉ mở app một hai lần mỗi ngày, chủ yếu buổi tối, nên báo giao dịch chưa gán trong 5 phút là nhanh hơn mức cần. Khung 01:00–04:00 VN gần như không có giao dịch.
### Decision
- Hai biểu thức, cùng vào một lượt `tick`: `*/15 0-17,21-23 * * *` (mỗi 15 phút, trừ 01:00–03:59 VN — 84 lượt) và `0 18,19,20 * * *` (01:00, 02:00, 03:00 VN — 3 lượt). Tổng **87 lượt/ngày** (trước 289).
- Bỏ cron riêng cho rà soát: rà soát SePay (ingest UC-304) chạy trong lượt có giờ VN đúng 02:00, cô lập bằng `Promise.allSettled` nên lỗi rà soát không chặn các việc khác.
- Giờ nhắc phải là **bội số 15 phút** (server trả `invalid_input`; PWA dùng `step="900"`). Migration `0012` làm tròn xuống giá trị đã lưu.
- Giờ nhắc rơi vào 01:00–03:59 chỉ có lượt mỗi giờ nên chạy ở lượt giờ kế tiếp — thẻ Giờ nhắc nói rõ.
Phương án bị loại: **giữ 5 phút** — chủ nhà thấy không cần; **tắt hẳn ban đêm** — vẫn cần lượt 02:00 cho rà soát và lượt bù cho tin sáng sớm.
### Consequences
Báo giao dịch chưa gán chậm hơn: log chờ ≥ 60 giây rồi báo ở lượt kế tiếp, thường trong 15 phút (đêm 01:00–04:00 có thể tới 1 giờ). Tin sáng, tổng kết tuần vẫn đúng giờ vì giờ là bội số 15. Số lượt gọi Worker từ cron còn ~87/ngày, tức dưới 0,1% hạn mức gói Free.
### Verified in code
`wrangler.jsonc` `triggers.crons` · `src/cron/index.ts` › `CRONS`, `runScheduled`, `tick`, `BACKFILL_MINUTE` · `migrations/0012_notify_schedule_15min.sql` · `src/services/settings.ts` › `updateNotifySchedule` (bước 15 phút) · `web/src/lib/settings.ts` › `notifyPayload`, `scheduleRows` · `web/src/screens/settings-sheets.tsx` › `NotifyScheduleSheet` (`step={900}`) · test `test/cron-schedule.test.ts` › "lượt cron: hai biểu thức, rà soát 02:00 › rà soát giao dịch qua API SePay › chỉ chạy ở lượt 02:00 VN, không ở 01:00, 03:00 hay các lượt 15 phút"; `test/migrations/milestones.test.ts` › "migrations › 0012 làm tròn xuống giờ nhắc đã lưu về bội số 15 phút; giá trị sai dạng và khoá khác để nguyên".

## ADR-71: Sổ nợ là sổ riêng ngoài sổ cái; trả nợ = khoản chi có `debt_id`
- Date: 2026-10-01 · Status: accepted · Mở rộng ADR-63 (trả nợ từ "Thu cho thuê" nay gắn được vào một khoản nợ)
- Plan ID: — · Context: debt (+ ledger: `transactions.debt_id`; ingest: split gán log; mcp: `get_debts`; notify: dòng 💳; pwa: tab Nợ, sheet Trả nợ)
- Source: yêu cầu chủ nhà — hộ nợ 15.379.000 ₫ (có thể nhiều chủ nợ), danh mục `tra-no` chỉ cho biết đã trả, không cho biết còn nợ bao nhiêu
### Context
Từ change `261001-cho-thue-lai`, trả nợ là khoản `spend` danh mục `tra-no` (ví mặc định "Thu cho thuê", ADR-63). Không nơi nào giữ số nợ gốc, vay thêm hay chủ nợ, nên "còn nợ bao nhiêu" phải tính tay. Mô hình phải giữ được luật 1 (chỉ ghi thêm), luật "tiền là thật" (khoản trả là tiền ra thật) và không làm sai ngân sách, đối soát.
### Decision
- **Sổ nợ là sổ riêng ngoài sổ cái**, cùng khuôn với sổ người thuê (ADR-58): bảng `debts` (khoản nợ) và `debt_lines` (dòng nợ `opening`/`borrow` > 0, `adjust` ±) chỉ ghi thêm — trigger chỉ cho `status` `active → void`, cấm DELETE (`debt_line_append_only`). Dòng nợ không đụng ví, không đụng tài khoản.
- **Trả nợ = khoản `spend` của sổ cái mang `transactions.debt_id`** — ghi tay (REST/MCP/PWA, kể cả offline qua hàng đợi) hoặc gán log ngân hàng. Không có dòng nợ loại "trả". Còn nợ là view: `v_debt_balance.balance = Σ dòng nợ active − Σ spend active có debt_id`, nên **huỷ giao dịch (UC-102) hay gỡ gán (UC-306) là số còn nợ tự đúng lại**, không có hai bản ghi phải giữ khớp.
- `debt_id` chỉ gắn với `spend` (`debt_spend_only`); khoản nợ phải có và đang bật (`unknown_debt`, `inactive_debt`); không chọn danh mục thì lấy `tra-no`. Ví/danh mục/tài khoản vẫn theo luật chung của khoản chi (D14/ADR-66 giữ nguyên).
- Không seed khoản nợ nào: chủ nhà tự thêm từng chủ nợ với số còn nợ lúc bắt đầu theo dõi.

Phương án bị loại:
- **Nợ là một ví âm** (ví "Nợ" số dư −15.379.000, trả nợ = chuyển ngân sách vào ví đó): ví là ngân sách, không phải món nợ — ví âm đã có nghĩa "tiêu lố, cần Bù" (UC-712) và bị kéo vào bảng ngân sách, "còn để chi", nút Bù, trung bình chi Must của phao; một ví không chia được theo nhiều chủ nợ; và chuyển ngân sách không phải tiền ra thật, nên khoản trả qua ngân hàng vẫn phải ghi một khoản chi riêng — một đồng được ghi hai lần.
- **Nợ là một tài khoản `kind = 'credit'`** (schema đã cho phép, ADR-11 [OPEN]): tài khoản là nơi tiền nằm và được đối soát với số dư ngân hàng (UC-106) — một khoản vay người quen không có sao kê để đối soát, `book_drift`/`feed_drift` sẽ vô nghĩa hoặc báo lệch giả; trả nợ thành `transfer` giữa hai tài khoản nên không còn là khoản chi (mất khỏi chi theo danh mục, ví "Thu cho thuê" không giảm); và thẻ tín dụng/tài khoản nợ là non-goal V1 (ADR-11), D14 và tin sáng phải học thêm một loại tài khoản không có feed.
### Consequences
Context mới `debt` (UC-901…UC-904) và BR-12; schema v1.13 (`migrations/0013_debts.sql`). `POST /v1/transactions`, split gán log và MCP `add_transaction`/`assign_log` nhận `debt_id`; `GET /v1/bootstrap` thêm `debts` để sheet Trả nợ chọn khoản khi offline; MCP thêm `get_debts` (15 tool); tin sáng thêm dòng `💳 Còn nợ X (N khoản)` khi tổng còn nợ > 0. Chi `tra-no` không gắn `debt_id` (cũ, hay do rule tự gán — rule không mang `debt_id`) không làm giảm còn nợ. Trả dư làm còn nợ âm, khoản hiện "Đã trả xong".
### Verified in code
`migrations/0013_debts.sql` (`debts`, `debt_lines`, `transactions.debt_id`, `trg_debt_lines_append_only`, `trg_debt_lines_no_delete`, view `v_debt_balance`) · `src/domain/entry.ts` › `buildEntry` (`debt_spend_only`, `unknown_debt`, `inactive_debt`, `DEBT_CATEGORY_ID`) · `src/services/debts.ts` › `getDebts`, `createDebt`, `updateDebt`, `addDebtLine`, `voidDebtLine` · `src/services/ingest.ts` › `assignLog` (`Split.debt_id`) · `src/mcp/tools.ts` › `get_debts` · `src/cron/daily.ts` + `src/notify/format.ts` › `dailyMessage` (`debts`) · test `test/debts.test.ts` › "sổ nợ › huỷ khoản trả nợ thì số còn nợ trở lại"; `test/schema.test.ts` › "chốt chặn toàn vẹn ở tầng DB › debt_lines chỉ ghi thêm và v_debt_balance trừ khoản trả nợ".

## ADR-72: Nhận lại tiền cho vay là meaning `collect`, không dùng `refund`; sổ phải thu ngoài sổ cái; báo cáo tiền thật trước
- Date: 2026-10-01 · Status: accepted · Tinh chỉnh ADR-03 ("ai nợ mình" xử lý bằng `refund`); đóng [OPEN] vòng `lend` → `refund` ở ledger UC-101
- Plan ID: — · Context: receivable (+ ledger: meaning `collect`, `transactions.receivable_id`; ingest: split gán log; mcp: `get_receivables`; notify: dòng 🤝; pwa: Loại khác, Gán, tab Nợ)
- Source: yêu cầu chủ nhà — "có nợ rồi, còn khoản phải thu thì sao?"; "Kế toán dễ lãi giả lỗ thật, Profit First cho thấy tiền tươi thóc thật."; [VAS 24 — Báo cáo lưu chuyển tiền tệ](https://docs.kreston.vn/vbpl/ke-toan/chuan-muc-ke-toan/vas-24) (QĐ 165/2002/QĐ-BTC, hiệu lực 01/01/2003) §04, §05, §10(c)(d), §11(c)(d); VAS 01 / TT 200 (cơ sở dồn tích)
### Context
Hộ cho người khác vay hoặc trả hộ. ADR-03 chọn "ai nợ mình" xử lý phản ứng-sau bằng `refund`, `lend` là chế độ nâng cao không đụng ví. Ghép hai thứ đó thành một vòng thì sai: `lend` không trừ ví nhưng `refund` luôn cộng một ví (CHECK `wallet_id NOT NULL`), nên tiền cho vay trả về làm ví **phồng lên** so với trước khi cho vay — tiền "từ trên trời" vào ngân sách chi tiêu ([OPEN] cũ ở ledger UC-101). Không nơi nào biết ai còn nợ bao nhiêu.
Tiền lệ ở chính repo: sổ người thuê là sổ phải thu ngoài sổ cái, tiền thật ghi khi tiền về (ADR-58); sổ nợ cùng khuôn (ADR-71). Nguyên lý: `docs/profit_first_phuong_phap.md` §8 — "Luật 'tiền thật, chi thật' + loại transfer nội bộ chính là thứ chặn **lãi giả lỗ thật**" (xuất hàng ghi doanh thu ngay → sổ báo lãi, khách trả sau, tiền mặt đã bay → túi rỗng).
Chuẩn mực kế toán Việt Nam cho cùng câu trả lời ở phía dòng tiền: VAS 24 §04 định nghĩa **Tiền** = "tiền tại quỹ, tiền đang chuyển và các khoản tiền gửi không kỳ hạn", **tương đương tiền** = đầu tư ngắn hạn ≤ 3 tháng, dễ đổi thành một lượng tiền xác định, ít rủi ro, và luồng tiền "không bao gồm chuyển dịch nội bộ giữa các khoản tiền"; §05 chia luồng tiền ba nhóm (kinh doanh / đầu tư / tài chính); §10(c)(d) "Tiền chi cho vay đối với bên khác" / "Tiền thu hồi cho vay đối với bên khác" là hoạt động **đầu tư** — không phải doanh thu hay chi phí; §11(c)(d) "Tiền thu từ các khoản đi vay" / "Tiền chi trả các khoản nợ gốc đã vay" là hoạt động **tài chính**.
### Decision
- **Meaning mới `collect`** = tiền cho vay quay về: `counter_account_id` = tài khoản tiền vào, **không ví, không danh mục**; không vào `v_wallet_flow`, `v_spent_*`, không phải `income`, không chia được (`allocateIncome` → `not_income`). `lend` giữ nguyên (tiền ra, không trừ ví), mặc định danh mục `cho-vay`. Cặp `lend`/`collect` chỉ đổi **tài khoản** — đúng VAS 24 §10(c)(d): cho vay và thu hồi là luồng đầu tư, không phải chi tiêu hay thu nhập.
- **Sổ phải thu ngoài sổ cái**, cùng khuôn sổ đối ứng với sổ nợ: `receivables` + `receivable_lines` (`opening` > 0, `adjust` ±, chỉ ghi thêm — `receivable_line_append_only`); `transactions.receivable_id` chỉ trên `lend`/`collect` (`receivable_only`, kể cả `refund`); `v_receivable_balance.balance = Σ dòng active + Σ lend active − Σ collect active`. Thêm một khoản phải thu không đổi ví hay tài khoản nào.
- **Không ghi nhận doanh thu dồn tích** — chỗ cố ý khác kế toán doanh nghiệp (VAS 01 / TT 200 là cơ sở dồn tích): một khoản phải thu không bao giờ là thu nhập lúc phát sinh, tiền về là **trả gốc**, không phải thu nhập. Sổ đối ứng (phải thu, nợ, người thuê) là ghi nhớ "ai nợ ai", nằm ngoài sổ cái tiền thật.
- **Báo cáo tiền thật trước** (`GET /v1/networth`, khối đầu tab Nợ): số ra quyết định = **tiền thật đang có** = Σ số dư sổ các tài khoản (đúng phạm vi "Tiền" VAS 24 §04); tài sản (vàng, CK) một dòng riêng vì không phải tương đương tiền; phải thu / người thuê / nợ đứng sau, ghi "chưa phải tiền"; tài sản ròng nhỏ, cuối cùng (`docs/DESIGN.md` §4).

Phương án bị loại:
- **`refund` + `receivable_id`**: vẫn là `refund` nên vẫn cộng một ví (CHECK `wallet_id NOT NULL`) và trừ "đã tiêu" của ví đó — sửa được sổ ghi nhớ nhưng giữ nguyên lỗi ví phồng, và trộn "hoàn tiền một khoản chi" với "tiền gốc cho vay quay về".
- **Coi khoản phải thu là một ví âm / ví riêng**: ví là ngân sách, không phải món nợ; số dư ví sẽ kéo vào "còn để chi", bảng ngân sách, nút Bù và dòng thác; không chia được theo từng người nợ; và tiền cho vay (chưa về) sẽ hiện như tiền tiêu được — đúng kiểu "lãi giả" §8 cảnh báo.
### Consequences
Context mới `receivable` (UC-1001…UC-1005) và BR-13; schema v1.14 (`migrations/0014_receivables.sql`). SQLite không sửa được CHECK cột `meaning` nên migration **dựng lại bảng `transactions`** (chép ra, cất tạm `allocation_runs`/`cash_counts`/`tax_settlements`, xoá, tạo lại kèm `receivable_id`, chép về, dựng lại index và ba trigger). `v_wallet_flow` loại `('buy_asset','lend','collect')`. Sổ nợ và sổ phải thu dùng **chung một service sổ đối ứng** `src/services/memo-books.ts` và một bộ route `src/routes/books.ts` (sổ người thuê giữ code riêng vì có kỳ tháng, chốt tháng). `POST /v1/transactions`, split gán log và MCP `add_transaction`/`assign_log` nhận `collect` + `receivable_id`; `bootstrap` thêm `receivables`; MCP thêm `get_receivables` (16 tool); tin sáng thêm `🤝 Người khác nợ mình X (N khoản)` ngay sau dòng 💳. App nay có **báo cáo tiền thật trước, ghi nhớ sau** theo §8. Dữ liệu cũ không đổi: tiền cho vay đã về và ghi là `refund` vẫn nằm trong ví nó đã cộng. Trả nợ gốc vẫn là `spend` (`tra-no`) — lệch với VAS 24 §11(d), để ngỏ ở debt [UC-902](debt/UC-902-tra-no.md) [DIVERGENCE] (chủ nhà chưa quyết).
### Verified in code
`migrations/0014_receivables.sql` (`receivables`, `receivable_lines`, dựng lại `transactions`, `idx_tx_receivable`, `v_wallet_flow`, `v_receivable_balance`, `trg_receivable_lines_append_only`, `trg_receivable_lines_no_delete`) · `src/domain/entry.ts` › `MANUAL_MEANINGS`, `buildEntry` (nhánh `lend`/`collect`, `receivable_only`, `LEND_CATEGORY_ID`) · `src/services/memo-books.ts` › `listBooks`, `createBook`, `addLine`, `voidLine` · `src/services/receivables.ts` › `getReceivables` · `src/services/ledger.ts` › `netWorth` · `src/mcp/tools.ts` › `get_receivables` · test `test/receivables.test.ts` › "tiền cho vay về không phải thu nhập (ADR-72) › lỗi cũ: cho vay 300.000 rồi nhận lại 300.000 — không ví nào đổi, tài khoản về như cũ, còn phải thu 0"; `test/migrations/milestones.test.ts` › "migrations › 0014 dựng lại transactions để nhận meaning collect mà giữ nguyên dữ liệu, bảng con, index và trigger".

## ADR-73: Sửa giao dịch ghi tay = huỷ + ghi mới trong một batch; giao dịch ngân hàng chỉ gỡ gán
- Date: 2026-10-01 · Status: accepted · Giữ ADR-02 luật 1 (sổ chỉ ghi thêm); đóng [OPEN] "giữa hai request sổ thiếu khoản đó" và "PWA không gọi huỷ" ở ledger UC-102, đóng [DIVERGENCE] hai đường huỷ ở ingest UC-306
- Plan ID: — · Context: ledger (+ ingest: gỡ gán là đường duy nhất cho giao dịch ngân hàng; pwa: sheet chi tiết giao dịch UC-715)
- Source: yêu cầu chủ nhà — "vợ chồng nhập → lưu nhưng nhầm, phải cho sửa / xoá bản ghi; đồng bộ SePay thì không cho xoá, ghi tay thì có"
### Context
Nhập nhầm (sai số, sai danh mục, sai ví) là chuyện hằng ngày. Sổ chỉ có `POST /v1/transactions/:id/void` và PWA không gọi nó: khoản đã lên sổ không có đường sửa nào trong app. "Sửa" theo ADR-02 luật 1 là huỷ rồi ghi bút toán mới — làm bằng hai request thì giữa hai lần gọi sổ thiếu khoản đó, và request thứ hai hỏng là mất hẳn. Cùng lúc, route huỷ của sổ cái cho huỷ cả giao dịch sinh từ log ngân hàng mà không trả log về chờ gán: log `assigned` mồ côi, chỉ lộ ở `book_drift`; đường đúng (gỡ gán, ingest UC-306) đã có sẵn.
### Decision
- **Theo nguồn**: `source='manual'` → huỷ (xoá) và sửa được; giao dịch ngân hàng (`source='sepay'` hoặc có `log_id`) → `voidTransaction` và `replaceTransaction` từ chối `bank_tx` 409 "Giao dịch từ ngân hàng không xoá được — gỡ gán để gán lại."; đường duy nhất là gỡ gán rồi gán lại (ingest UC-306, UC-305). Bút toán hệ thống (`source='system'`, `fund`) vẫn `system_tx`.
- **Sửa = `POST /v1/transactions/:id/replace`**, thân giống hệt `POST /v1/transactions`: kiểm khoản mới đầy đủ bằng `buildEntry` và các luật của nhập tay (D14 `fed_account`, `insufficient_cash`, `invalid_link`) **trước khi ghi gì**; rồi **một** `db.batch`: gỡ lần chia nếu khoản cũ là khoản thu đã chia (`undoAllocationStatements`, cùng đường `runUndo`, trigger 0006) → ghi khoản mới (chỉ khi khoản cũ còn `active` ngay trong batch) → huỷ khoản cũ. Không có cột mới; liên hệ cũ–mới chỉ trả về trong phản hồi (`replaced`). Chống trùng theo `client_id` như nhập tay.
- Khoản thu mới sau khi sửa **không tự chia** (như nhập tay — allocation UC-203); PWA chia lại ngay sau đó như khi ghi khoản thu.
- Sửa chỉ cho các meaning nhập tay (`MANUAL_MEANINGS`); `adjust` (đếm ví) chỉ xoá được. Người ghi giữ là người ghi khoản cũ. Chỗ gắn sổ nợ / sổ phải thu / người thuê của khoản cũ giữ được kể cả khi khoản đó đã tắt.
- PWA: mọi dòng giao dịch mở được sheet chi tiết; ghi tay có Sửa (mở đúng form đã dùng để nhập, điền sẵn) và Xoá (hai bước); ngân hàng chỉ có Gán lại; sửa / xoá cần mạng, không qua hàng đợi (pwa UC-715).

Phương án bị loại:
- **`UPDATE` tại chỗ** (sửa số tiền / danh mục trên dòng cũ): trái ADR-02 luật 1; mất dấu vết "trước đây ghi gì"; các view và lần chia đã tính trên dòng cũ đổi âm thầm; khoản thu đã chia sẽ lệch với fund của nó.
- **Cho xoá giao dịch SePay ở sổ cái**: tiền đó đã đi thật và log ngân hàng còn đó — xoá ở sổ để lại log `assigned` không có giao dịch (đúng lỗi cũ), hoặc phải tự mở lại log, tức là làm lại gỡ gán ở chỗ thứ hai. Gán sai thì gỡ gán rồi gán lại.
- **Xoá cứng (`DELETE`) khoản đã xoá** — chủ nhà hỏi 2026-10-01 khi thấy dòng "đã xoá" lẫn trong danh sách. Không làm: trigger chặn xoá đã có trên các sổ phụ (`*_append_only`); `link_id`, `allocation_runs.income_tx_id` và cặp gỡ gán ↔ log ngân hàng trỏ về id cũ; mất dấu vết khi hai người cùng nhập rồi một người xoá. Thay bằng: danh sách **ẩn khoản đã xoá mặc định**, nút "Hiện khoản đã xoá" để đối chiếu (ledger UC-111 v6). Khoản đã xoá không tính vào số nào, chỉ tốn vài trăm byte.
### Consequences
`voidTransaction` và `replaceTransaction` dùng chung một bước kiểm (`manualTxOrThrow`); `runUndo` trả kết quả batch để lấy id khoản mới. `GET /v1/transactions` và `GET /v1/transactions/:id` trả cùng một dạng dòng sổ (kèm `debt_name`, `receivable_name`, `tenant_name`, `allocated`); con trỏ `before` phân trang theo (`at`, `id`). MCP không có công cụ huỷ / sửa (không đổi). Một `refund` trỏ về khoản chi đã sửa vẫn trỏ dòng cũ (đã huỷ) — như khi huỷ (ledger UC-102 [OPEN]).
### Verified in code
`src/services/ledger.ts` › `manualTxOrThrow`, `voidTransaction`, `replaceTransaction`, `runUndo`, `listTransactions`, `transactionView` · `src/routes/v1.ts` › `entryInput`, `POST /transactions/:id/replace`, `GET /transactions/:id` · `web/src/screens/tx-sheet.tsx` › `TxSheet` · `web/src/lib/transactions.ts` › `txActions` · test `test/api.test.ts` › "sửa / xoá giao dịch (UC-102) › sửa khoản chi: đổi số tiền, danh mục, ví trong một lần — khoản cũ void, khoản mới active, số dư ví đúng"; "sửa / xoá giao dịch (UC-102) › giao dịch từ ngân hàng không xoá được ở sổ cái (bank_tx), log vẫn đã gán; gỡ gán thì được".

## ADR-74: Chi tiêu dùng chữ "dự kiến"; "mục tiêu" chỉ cho quỹ tiết kiệm có đích
- Date: 2026-10-01 · Status: accepted · Chỉ đổi chữ, không đổi quyết định nào khác; ADR-13, ADR-15, ADR-21, ADR-26, ADR-67 giữ nguyên lời văn lúc chốt — "mục tiêu" ở đó (mục tiêu tháng/tuần, Must đủ mục tiêu, cột Mục tiêu tháng) đọc là "dự kiến"
- Plan ID: — · Context: ledger (bảng từ vựng: Dự kiến tháng, Dự kiến kỳ; UC-103, UC-104) (+ allocation: bước "Must đủ dự kiến"; notify: tin tổng kết tuần "đã tiêu / dự kiến"; mcp: mô tả `get_budget`; pwa: Hôm nay, Ví & quỹ › Ngân sách, Cài đặt › Giờ nhắc)
- Source: yêu cầu chủ nhà — "chữ 'mục tiêu' nên là 'dự kiến' — ai lại đặt mục tiêu chi tiêu bao giờ? Xem lại các ngữ cảnh đang xài từ này, thay đổi cho phù hợp."
### Context
App gọi số định chi của một ví trong kỳ (`monthTarget`, `weekTarget`, budget `target`) là "mục tiêu": bảng Ngân sách "Mục tiêu / Thực tế / Còn lại", "còn lại / mục tiêu tháng" ở Dòng thác, "đã tiêu / mục tiêu" ở tổng kết tuần. "Mục tiêu" ngầm ý là thứ phải với tới — tiêu càng sát càng tốt — ngược tinh thần Profit First: chi ít hơn số đã chia là tốt, phần dư chảy về Có thì tốt hoặc Tích sản. Cùng chữ đó lại đang dùng đúng nghĩa cho quỹ để dành có đích (Du lịch, phao khẩn cấp), nên một chữ mang hai nghĩa ngược nhau.
### Decision
- **"Dự kiến"** = số định chi của ví: phần đã định cho phong bì / hoá đơn / tích dồn theo luật `flat` / `lump` (dự kiến tuần, dự kiến tháng — `weekTarget`, `monthTarget`), budget `target` (cột **Dự kiến** của bảng Ngân sách; riêng Có thì tốt = số đã được chia trong tháng), "đã chi / dự kiến", "sắp vỡ ≥ 80% dự kiến", bước engine **Must đủ dự kiến** (nâng ví Must từ sàn lên dự kiến tháng), phao ước bằng tổng dự kiến tháng của nhóm Must.
- **"Mục tiêu" giữ** chỉ ở chỗ là đích để dành thật: cách nạp `goal` "Mục tiêu có hạn" (số tiền mục tiêu + hạn), card **Quỹ mục tiêu** và tiến độ quỹ (`v_goal_progress`, `get_goals`, Du lịch), mức phao khẩn cấp.
- Áp cho mọi chữ tiếng Việt: giao diện, toast, tin Telegram/đẩy, mô tả tool MCP, chú thích code, tên test, `docs/`, `specs/`.

Phương án bị loại:
- **"Dự phóng"**: từ chuyên môn tài chính, người nhà khó hiểu — trái luật "từ nghiệp vụ tiếng Việt, không dùng từ kỹ thuật" (`docs/DESIGN.md` §6).
- **"Ngân sách"**: đã là tên tab Ví & quỹ › Ngân sách và nghĩa của ví; cột "Ngân sách" trong bảng Ngân sách thì trùng.
- **Giữ "mục tiêu"**: ngầm ý tiêu càng sát càng tốt — ngược tinh thần Profit First chi ít hơn là tốt; và lẫn với quỹ để dành có đích.
### Consequences
Identifier không đổi: `target`, `monthTarget`, `weekTarget`, `target_amount`, cột DB, trường API giữ nguyên — chỉ đổi chữ tiếng Việt. Migration là lịch sử nên chú thích trong `migrations/0001_schema.sql` giữ chữ cũ; `docs/schema.sql` đổi theo. `plans/` và báo cáo cũ giữ nguyên (ghi lại lúc đó). Tên test đổi theo (`test/allocation.test.ts`, `test/api.test.ts`, `test/cron-daily.test.ts`, `test/cron-weekly.test.ts`, `test/format.test.ts`) và mọi dòng `- Tests:` trích tên đó.
### Verified in code
`web/src/screens/wallets.tsx` › `BudgetTab` (cột "Dự kiến", "Không có ví nào có số dự kiến trong kỳ này."), `BudgetItem`, `BudgetRow`, `NegativeLine` · `web/src/screens/today.tsx` › `GroupRow` ("còn lại / dự kiến tháng"); `GoalsCard` giữ tên "Quỹ mục tiêu" · `web/src/screens/today-desktop.tsx` › `SpendWallets` (cột "Dự kiến", ghi chú "Còn tuần = dự kiến tuần trừ đã chi tuần…") · `web/src/lib/settings.ts` › `scheduleRows` ("Đã tiêu so với dự kiến từng phong bì, top 5 danh mục"); `MODE_LABEL.goal` "Mục tiêu có hạn" giữ · `src/mcp/tools.ts` › `get_budget` ("Bảng dự kiến / thực tế / còn lại…"), `get_goals` giữ "mục tiêu có hạn" · `src/services/ledger.ts` › `getBudget` · `src/domain/allocation.ts` › `allocate` (bước 4 "Must đủ dự kiến") · `src/domain/snapshot.ts` › `weekTarget`, `buildSnapshot` · `src/notify/format.ts` › `DailyMessageInput.atRisk`, `WeeklyMessageInput.envelopes` · `docs/DESIGN.md` §6 (bảng "Đừng viết / Viết") · test `test/format.test.ts` › "weeklyMessage › tổng kết tuần: đã tiêu/dự kiến từng ví + top 5 danh mục"; `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › ví sắp vỡ ≥80% dự kiến tuần".

## ADR-75: Nhiều kết nối SePay — mỗi kết nối một token và một khoá webhook
- Date: 2026-10-03 · Status: accepted · Mở rộng ADR-23 (rà soát 02:00) và ADR-28 (hợp đồng webhook); không đổi khoá chống trùng (ADR-40, ADR-49)
- Plan ID: — · Context: ingest (+ access: bảng `sepay_connections`, tài khoản chọn kết nối, UC-505/UC-506/UC-508; pwa: Cài đặt › Kết nối, thẻ Đồng bộ lại SePay, UC-709)
- Source: yêu cầu chủ nhà — "Vợ tôi dùng 1 tài khoản SePay khác tôi — 1 API key SePay riêng của vợ" (SePay của vợ nối nhiều tài khoản ngân hàng của cô: `mb-spending-wife`, `mb-savings-wife`, `tcb-wife`); "Thiếu sync từ ngày x đến ngày y của SePay"
### Context
App chỉ có **một** token API SePay và **một** khoá webhook (`config` `secret:sepay_api_token`, `secret:sepay_webhook_key`, dự phòng `wrangler secret`). Token API SePay v2 thuộc một *công ty* SePay và chỉ thấy tài khoản ngân hàng nối vào công ty đó; Vợ có công ty SePay riêng nên các tài khoản của cô không rà soát được, còn webhook của cô — dù dùng cùng địa chỉ — không có khoá nào để qua cửa. Đồng thời, khi webhook sót cả ngày (SePay chỉ gửi lại ~33 phút) mà quá cửa sổ 00:00 hôm qua → 02:00 hôm nay của rà soát đêm, không có cách nào lấy lại giao dịch của một khoảng ngày cũ.
### Decision
- **Kết nối SePay** = một dòng `sepay_connections` cho mỗi công ty SePay của nhà: `name`, `api_token`, `webhook_key`, `active`. Migration 0015 tạo kết nối mặc định `chinh` ("SePay chính") mang khoá cũ trong `config` (xoá khỏi `config`); `SEPAY_API_TOKEN` / `SEPAY_API_KEY` còn là dự phòng của **riêng** kết nối này. Khoá không bao giờ trả ra, chỉ `{ set, hint, source }` như IntegrationSecret.
- **Tài khoản thuộc kết nối**: `accounts.sepay_connection_id` — bật SePay thì thuộc đúng một kết nối (không chọn → giữ kết nối cũ, chưa có → `chinh`), tắt SePay thì `NULL`. Migration gán `chinh` cho mọi tài khoản đang bật SePay.
- **Webhook một địa chỉ** `/webhooks/sepay`: nhận khoá của **bất kỳ** kết nối đang bật (so `safeEqual` với từng khoá, so hết). Kết nối khớp khoá được truyền vào `ingestLog`, và tra tài khoản (`sub_account` rồi `account_no`) **chỉ trong tài khoản của kết nối đó** — khoá SePay của vợ không ghi được vào tài khoản của chồng; log mang số tài khoản không thuộc kết nối ghi như tài khoản lạ (`account_id NULL`, chờ gán). Hai kết nối không được trùng khoá webhook (`409 duplicate_key`).
- **Rà soát và đồng bộ lại dùng chung `syncSepay(env, range, …)`**: lần lượt từng kết nối đang bật có tài khoản, bằng token riêng, chỉ giữ giao dịch của tài khoản thuộc kết nối; một kết nối lỗi không chặn kết nối khác, lỗi trả theo tên kết nối. Cron 02:00 giữ cửa sổ cũ và dòng `notifications(kind='backfill')` `{"added":N}` (tin sáng không đổi chữ). **Đồng bộ lại** `POST /v1/settings/sepay/sync { connection_id?, from, to }` — ngày VN tính cả hai đầu, `from ≤ to ≤ hôm nay`, tối đa 31 ngày — trả `{ added, duplicates, perConnection, errors }`; PWA báo "Đã lấy thêm N giao dịch, M đã có sẵn.".
- **Ít request Cloudflare**: giao dịch đã có (trùng `id`, hoặc trùng (tài khoản, mã tham chiếu)) được nhận ra bằng **một** câu SELECT cho cả khoảng ngày, không gọi `ingestLog` — chạy lại một khoảng chỉ tốn lời gọi SePay (đi trang 100 dòng, tôn trọng 429 như cũ). Kết nối không có tài khoản nào thì không gọi SePay.

Phương án bị loại:
- **Token riêng trên từng tài khoản** (cột `accounts.sepay_api_token`): token SePay thuộc công ty, không thuộc tài khoản ngân hàng — ba tài khoản của vợ sẽ mang ba bản sao cùng token, đổi token phải sửa ba chỗ; API v2 không lọc theo số tài khoản nên rà soát gọi cùng một công ty ba lần; khoá webhook vẫn không có chỗ đặt.
- **Địa chỉ webhook thứ hai** (`/webhooks/sepay/:connection`): phải sửa cấu hình phía SePay cho từng người và giữ hai đường song song; khoá vẫn phải theo kết nối, nên đường dẫn không thêm an toàn gì — khoá đã cho biết kết nối.
- **Cho khoá nào cũng ghi vào mọi tài khoản** (chỉ thêm khoá thứ hai): khoá lộ của một công ty SePay ghi được giao dịch giả vào tài khoản của người kia.
- **Đồng bộ lại không giới hạn khoảng ngày**: một lần gọi có thể chạm giới hạn truy vấn D1 / thời gian chạy của Worker (ADR-54) với giao dịch chưa có; 31 ngày đủ cho lỗ hổng một tháng, khoảng dài hơn thì chạy nhiều lần.
### Consequences
`SECRET_NAMES` chỉ còn `telegram_bot_token`; `PUT /v1/settings/integrations` chỉ nhận khoá Telegram; `POST /v1/settings/test/sepay` thay bằng `POST /v1/settings/sepay/connections/:id/test` (thêm `linked` — tài khoản ngân hàng SePay đang nối với token đó). `GET /v1/settings` › `integrations.sepay_connections`; tài khoản có `sepay_connection_id`. Schema v1.15. Tài khoản đang tắt SePay không còn nhận log qua webhook (trước đây vẫn được gắn) — đúng ý "tắt SePay = ghi tay" (ADR-66). Không xoá được kết nối, chỉ tắt. Production: sau migration, đặt khoá webhook cho kết nối `chinh` và thêm "SePay của vợ" (token + khoá riêng), rồi bật SePay cho ba tài khoản của vợ và chọn **Nối qua** "SePay của vợ"; trong SePay của vợ dán cùng địa chỉ webhook với khoá của cô.
### Verified in code
`migrations/0015_sepay_connections.sql` · `src/services/secrets.ts` › `DEFAULT_SEPAY_CONNECTION`, `loadSepayConnections`, `describeValue` · `src/routes/webhooks.ts` › `webhooks.post("/sepay")` · `src/services/ingest.ts` › `ingestLog` (`connectionId`) · `src/cron/backfill.ts` › `syncSepay`, `existingLogs`, `runBackfill` · `src/services/settings.ts` › `sepayConnectionId`, `createSepayConnection`, `updateSepayConnection`, `webhookKeyFree`, `testSepay`, `syncSepayRange` · `src/routes/settings.ts` (`/sepay/connections`, `/sepay/connections/:id/test`, `/sepay/sync`) · `web/src/screens/settings.tsx` › `Connections`, `SepaySync`; `web/src/screens/settings-sheets.tsx` › `SepayConnectionSheet`, `AccountSheet` · test `test/webhooks.test.ts` › "nhiều kết nối SePay — cùng một địa chỉ webhook, mỗi kết nối một khoá (ADR-75) › khoá của SePay của vợ không ghi được vào tài khoản của chồng: log không gắn tài khoản nào, không tự sinh giao dịch"; `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › một kết nối lỗi (token sai) không chặn kết nối kia; lỗi ghi theo tên kết nối, dòng rà soát vẫn có".
- [OPEN] Rà soát đêm lỗi ở một kết nối chỉ ra `console.error` + `errors` trong kết quả; tin sáng không báo "rà soát SePay của vợ thất bại" (như ingest UC-304 [OPEN]).

## ADR-76: Số dư đầu là mốc: giao dịch trước `opened_at` không vào sổ
- Date: 2026-10-03 · Status: accepted · Cho `accounts.opened_at` (có từ schema v1.3, ô "Ngày mở sổ" ở Cài đặt, nhưng chưa nơi nào dùng) một nghĩa và một chỗ thi hành; bổ sung ADR-75 (đồng bộ lại theo khoảng ngày)
- Plan ID: — · Context: ingest (+ ledger: chặn ghi sổ trước mốc, `v_account_logs`, UC-101, UC-106; access: nghĩa `opened_at`, UC-506; pwa: Cài đặt, UC-709)
- Source: yêu cầu chủ nhà — "một số khoản SePay tôi chi ở tháng 9, đừng cộng vào tháng 10; TK tôi giờ còn 35.906đ nhưng app cộng thêm tiền"
### Context
Production mở sổ mọi tài khoản ngày `2026-10-01`: `opening_balance` là số dư đọc từ ngân hàng lúc đó (tài khoản của chủ nhà: 35.906 ₫). Đồng bộ lại SePay theo khoảng ngày (ADR-75) chạy từ 28/9 nên mang về các giao dịch 28–30/9 như log `pending`; hai khoản trong đó được gán (vào 50.000 ₫, ra 24.400 ₫) → sổ ghi 35.906 + 50.000 − 24.400 = **61.506 ₫** trong khi ngân hàng báo 35.906 ₫: tiền tháng 9 bị đếm lần thứ hai, vì số dư đầu đã gồm chúng. Không có gì chặn: ingest không đọc `opened_at`, sổ cái nhận mọi ngày quá khứ, và `v_account_logs.feed_balance` cộng **mọi** log của tài khoản bất kể ngày lẫn trạng thái — nên chỉ đánh dấu log là `ignored` cũng không đủ cho đối soát lớp 1.
### Decision
- **Nghĩa**: `opening_balance` = số dư lúc **bắt đầu** ngày `opened_at` (ngày `YYYY-MM-DD` theo giờ VN) — mọi giao dịch trước ngày đó đã nằm trong nó; giao dịch từ đúng ngày đó trở đi vào sổ như thường. `opened_at` NULL = không có mốc, hành vi như trước.
- **Ingest** (`ingestLog` — chung cho webhook, rà soát 02:00, đồng bộ lại): log khớp được tài khoản mà ngày VN của nó (`dayKey(at)`) < `opened_at` → ghi ngay `status='ignored'`, giữ để đối chiếu; không xét song sinh, không khớp lệnh chuyển `PF …`, không ghép cặp, không rule, không báo chờ gán, không kiểm lệch feed; trả `beforeOpening: true`. Chống trùng (id, (tài khoản, mã tham chiếu)) chạy trước như cũ. Rà soát / đồng bộ lại đếm riêng `beforeOpening` (không vào `added`, kể cả payload `{"added":N}` của dòng `backfill`); PWA nói thêm "N giao dịch trước ngày mở sổ — đã có trong số dư đầu, không ghi lại.". Ghép cặp tự động không nhận log `pending` trước mốc của tài khoản nó (log nhận trước luật này) làm chân kia.
- **Sổ cái**: giao dịch dựng qua `buildEntry` — nhập tay, sửa (`/replace`), gán log từng dòng, MCP `add_transaction` — chạm tài khoản (`account_id` hoặc `counter_account_id`) có `opened_at` mà ngày VN của `at` trước mốc → 400 `before_opening` "Ngày này trước ngày mở sổ của tài khoản {tên} ({d/m/yyyy}) — số dư đầu đã tính khoản này." Ghép cặp tay hai log cũng vậy (ngày sớm hơn của hai log, so với cả hai tài khoản). Chuyển ngân sách (không tài khoản) không bị chặn; đếm ví ghi `adjust` theo giờ hiện tại nên không có ngày để chặn.
- **Đối soát lớp 1**: `v_account_logs` chỉ cộng log có `date(at, '+7 hours') >= opened_at` (hoặc tài khoản không có mốc) — `feed_balance`, `assigned_net`, `pending_net`, `pending_count` cùng phạm vi (migration 0016, schema v1.16).
- **Cài đặt**: `opened_at` phải là ngày có thật dạng `YYYY-MM-DD` (`invalid_input`), bỏ trống = không có mốc; ô đổi tên "Số dư đầu tính tới ngày" kèm lời dặn "Giao dịch ngân hàng trước ngày này đã nằm trong số dư đầu, app bỏ qua.".

Phương án bị loại:
- **Tự dời số dư đầu** (cộng/trừ khoản trước mốc vào `opening_balance`, hay lùi `opened_at` về ngày sớm nhất có log): số dư đầu là con số chủ nhà đọc từ ngân hàng ở một ngày cụ thể — đổi ngầm làm sai một con số đang đúng, và mỗi lần đồng bộ lại một khoảng cũ sẽ đổi nó thêm lần nữa.
- **Xoá / không ghi log trước mốc**: mất dấu vết "app đã thấy giao dịch này chưa"; không còn id để nhận ra trùng nên mỗi lần đồng bộ lại cùng khoảng lại xử lý từ đầu; log ngân hàng là bất biến (ADR-02).
- **Chỉ chặn ở PWA** (ô Từ ngày của đồng bộ lại không sớm hơn mốc): webhook đến muộn và rà soát 02:00 vẫn mang log cũ về; chặn ở `ingestLog` là một chỗ cho mọi đường.
- **Chỉ đánh dấu `ignored`, giữ view**: `feed_balance` vẫn cộng log trước mốc — lớp 1 vẫn đếm hai lần.
### Consequences
Log trước mốc nằm `ignored` vĩnh viễn (`ignored` là trạng thái cuối). Đổi `opened_at` về sau không đổi trạng thái log đã ghi, chỉ đổi phạm vi của `v_account_logs`: lùi mốc thì log `ignored` cũ vào lại `feed_balance` (không vào sổ); tiến mốc thì log đã gán trước mốc mới ra khỏi `assigned_net` mà giao dịch vẫn trong sổ (lộ ở `book_drift`). Dữ liệu production đã lỡ (log 28–30/9 đang `pending`/`assigned`) không có migration nào sửa — chủ nhà tự dọn (gỡ gán rồi Bỏ qua): luật mới chặn gán lại chúng (`before_opening`). Tài khoản seed và tài khoản mới thêm ở Cài đặt mặc định `opened_at = date('now')` (ngày UTC). DB dựng cho test bỏ mốc của tài khoản seed (`test/helpers/d1-sqlite.ts` › `openDb`) vì `date('now')` chạy theo đồng hồ thật còn test ghim ngày; test cần mốc tự đặt. Schema v1.16.
### Verified in code
`migrations/0016_opening_date_cutoff.sql` (`v_account_logs`) · `src/domain/entry.ts` › `assertOpened`, `buildEntry` · `src/domain/types.ts` › `AccountRef.openedAt` · `src/services/ledger.ts` › `loadRefs` (`openedAt`) · `src/services/ingest.ts` › `ingestLog` (`beforeOpening`), `matchLog` (ứng viên ghép cặp), `pairLogs` · `src/cron/backfill.ts` › `syncSepay` (`beforeOpening`) · `src/services/settings.ts` › `accountFields` · `web/src/screens/settings.tsx` › `SepaySync`; `web/src/screens/settings-sheets.tsx` › `AccountSheet` · test `test/ingest.test.ts` › "số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76) › log trước mốc lưu 'ignored': không khớp rule, không ghép cặp, không báo chờ gán, không làm lệch đối soát; số dư theo log giữ nguyên"; `test/cron-sepay.test.ts` › "nhiều kết nối SePay — mỗi kết nối một token (ADR-75) › đồng bộ lại theo khoảng ngày (POST /v1/settings/sepay/sync) › khoảng ngày vắt qua ngày mở sổ: giao dịch trước mốc lưu 'ignored', đếm riêng beforeOpening, không vào sổ, không làm lệch số dư theo log (ADR-76)"; `test/api.test.ts` › "số dư đầu là mốc: không ghi giao dịch trước ngày mở sổ (ADR-76) › nhập tay ngày trước mốc (theo giờ VN) → 400 before_opening, sổ không đổi; đúng ngày mở sổ thì ghi được".
- [OPEN] Sổ log không phân biệt `ignored` vì trước mốc với `ignored` do người bấm Bỏ qua — chỉ suy ra được bằng cách so ngày log với `opened_at`.
- [OPEN] `opened_at` mặc định `date('now')` là ngày UTC: tài khoản thêm trước 07:00 sáng giờ VN nhận mốc là hôm qua, nên giao dịch của hôm qua lọt vào sổ dù số dư đầu có thể đã gồm chúng.

## ADR-77: Tiết kiệm tiền lẻ MB = heo đất: tài khoản riêng mỗi người + một ví giữ riêng chung
- Date: 2026-10-03 · Status: accepted · Phần ví (ví giữ riêng chung `heo-dat`, bỏ heo Có thì tốt → Heo đất, heo trả về kèm chuyển ví Heo đất → Có thì tốt, lời nhắc tiền trước app / lãi) **thay bởi ADR-82**; phần tài khoản (heo mỗi người `locked`, rule gắn tài khoản, `TICH LUY`, `locked` ở networth) còn hiệu lực · Dùng lại ví giữ riêng của ADR-63 (`tier='holding'`, `kind<>'holding'`) và lời nhắc tiền ra của ADR-66; tôn trọng mốc mở sổ ADR-76
- Plan ID: — · Context: ledger (`accounts.locked`, ví `heo-dat`, UC-103) + ingest (rule gắn tài khoản, chuyển nội bộ kèm chuyển ví, gợi ý heo trả về — UC-303, UC-305, UC-307) + receivable (bức tranh tiền thật, UC-1005) + access (cột chỉ migration đặt, health v1.17 — UC-505, UC-506, UC-507, UC-509) + pwa (UC-706, UC-707)
- Source: yêu cầu chủ nhà — "vợ chồng mỗi người một con heo, nhưng có cộng tổng hai con heo lại"; "khi rút về thì con heo nó trả về tk thôi". Cơ chế MB: [Tiết kiệm tiền lẻ — MB](https://www.mbbank.com.vn/77/2621/2622/Chi-tiet/tiet-kiem-tien-le-2026-2-13-8-43-35) và hướng dẫn trong app MBBank
### Context
MB "Tiết kiệm tiền lẻ": mỗi lần chuyển khoản / quét QR từ tài khoản nguồn, MB làm tròn lên và chuyển phần lẻ (quét QR 24.400 → làm tròn 30.000, chuyển 5.600) sang **tài khoản đang gom**; đủ 50.000 thì gửi vào **sổ tiết kiệm số tích lũy** có lãi; hết kỳ chủ sổ nhận gốc + lãi về tài khoản. Log ngân hàng của khoản làm tròn ở tài khoản nguồn là tiền **ra**, nội dung "CHUYEN TIEN LE LAM TRON SAU GIAO DICH CHUYEN KHOAN VAO TAI KHOAN DANG GOM (TIET KIEM TIEN LE)". Tiền không bị tiêu mà bị "bỏ lợn": vẫn của nhà, chưa rút ngay được. Chồng và vợ mỗi người bật trên MB của mình, nên mỗi người có tài khoản đang gom và sổ riêng.

Trước quyết định này app không có chỗ đúng cho khoản đó: gán Chi tiêu thì làm thiếu tiền thật và tài sản ròng; gán Chuyển nội bộ thì không có tài khoản đích, và nếu không đổi ví thì "Có thì tốt" vẫn đếm 5.600 như tiền còn tiêu được. Seed 0004 cố ý không seed mã `QTT` (tiết kiệm tiền lẻ) vì chưa biết rót vào ví nào.
### Decision
- **Mỗi người một con heo**: tài khoản `piggy-husband` "Heo đất MB (chồng)" và `piggy-wife` "Heo đất MB (vợ)" — `kind='bank'`, `bank='MBBank'`, chủ là người đó, ghi tay (`sepay_enabled=0`), `opening_balance=0`, `opened_at='2026-10-01'` (cùng ngày mở sổ của nhà, ADR-76). Tài khoản đang gom và sổ tích lũy gộp làm **một** tài khoản: app chỉ cần biết tiền đó là của ai và có rút ngay được không.
- **`accounts.locked = 1`** (schema v1.17): tiền thật nhưng chưa rút ngay được. Hai tài khoản heo mang cờ này; Cài đặt không đổi được cờ (chỉ migration).
- **Cộng hai con heo ở một ví giữ riêng chung** `heo-dat` "Heo đất" — `tier='holding'`, `kind='accrual'`, `shared`, như "Thu cho thuê" (ADR-63): không có luật nạp (không nhận tiền lúc chia lương), không vào "còn để chi" (UC-103 chỉ đếm phong bì `must`), không vào ngân sách theo kỳ, không vào phao (phao chỉ đếm Tích sản tiền mặt — ADR-04); hiện ở `snapshot.reserves` (Ví & Quỹ › ví giữ riêng). `account_id` = `piggy-husband`: cột cho phép NULL, nhưng mọi ví trong nhà đều trú ở một tài khoản có thật (test seed) và cột này chỉ dùng cho lệnh chuyển tiền lúc chia lương — ví không có luật nạp nên không bao giờ sinh lệnh; chọn heo của chủ nhà, chỉ chặn tắt tài khoản đó khi ví còn bật.
- **Bỏ heo = Chuyển nội bộ kèm chuyển ví**: tài khoản MB → heo của **chính chủ tài khoản đó**, ví **Có thì tốt → Heo đất**. Không phải chi tiêu: không dòng đã tiêu nào, ngân sách không đổi; tiền thật và tài sản ròng không đổi (chuyển giữa hai tài khoản của nhà); "còn để chi" chỉ giảm theo số dư phong bì Có thì tốt (bị rút đúng số tiền đó), không ví nào khác đổi.
- **Rule gắn tài khoản** (schema v1.17): `rules.account_id` (rule chỉ áp cho log của tài khoản đó; NULL = mọi tài khoản như cũ), `rules.counter_account_id` + `rules.from_wallet_id` (rule `transfer` đi tới tài khoản này, kèm chuyển ví `from_wallet_id → wallet_id`; không có `counter_account_id` thì vẫn là rút tiền mặt như cũ). Migration 0017 seed cho **mọi tài khoản MBBank đang dùng** của người có heo (prod: `mb-main-husband` → `piggy-husband`; `mb-spending-wife`, `mb-savings-wife` → `piggy-wife`) hai rule `content`: `CHUYEN TIEN LE LAM TRON` (priority 10, nội dung đã thấy) và `TIET KIEM TIEN LE` (priority 11, bắt cả khi đầu nội dung bị cắt, và là mẫu gợi ý cho heo trả về). Mọi seed có điều kiện (`INSERT … SELECT … WHERE EXISTS`): DB seed mẫu (`anh`/`em`) chỉ thêm cột.
- **Tự gán hay gợi ý** (dùng đúng luồng có sẵn): tài khoản SePay báo cả tiền ra → tự gán (UC-303 3.3); tài khoản "chỉ tiền vào" (`sepay_out=0` — MB theo tài liệu SePay, ADR-66) → giữ `pending`, màn Gán điền sẵn Chuyển nội bộ → heo của người đó, Từ ví Có thì tốt → Đến ví Heo đất, kèm lời nhắc ADR-66 (UC-305). Log trước ngày mở sổ của heo không tự gán (ADR-76).
- **Heo trả về tài khoản** = Chuyển nội bộ ngược lại: heo của người đó → tài khoản MB của họ, ví **Heo đất → Có thì tốt** (tiền về đúng phong bì nó đã rời; ở màn Gán người gán đổi được ví đích). Phần nhiều hơn gốc (lãi) là một dòng **Thu nhập** riêng, chia theo luật mặc định (không nguồn thu riêng). Log tiền vào khớp rule heo của tài khoản đó → **chỉ gợi ý** (tiền vào luôn phải hỏi, luật 6), kèm lời nhắc tách phần lãi. Không có luồng hay màn hình riêng. Bổ sung 2026-10-03 (chủ nhà, log tất toán thật "Tat toan truoc han tien gui sotich luy AC - … cua NGUYEN VAN A" 400.000 ₫ ở `mb-main-husband`): MB tất toán sổ tích lũy là heo trả về — migration 0019 (schema v1.19) seed thêm mẫu `TICH LUY` (priority 12) cho mọi tài khoản MB của người có heo; và gợi ý chỉ kèm chuyển ví Heo đất → Có thì tốt khi ví `heo-dat` giữ **đủ** số tiền về, không thì chỉ chuyển tài khoản (xem Consequences).
- **Bức tranh tiền thật** (`GET /v1/networth`): heo **nằm trong** `cash` (gốc không rủi ro, số tiền xác định, của nhà) và được tách thành `locked: { total, accounts: [{ accountId, name, memberId, memberName, balance }] }`; khối tab Nợ ghi "trong đó …, Heo đất 12.000 ₫ đã khóa (Chồng 7.000 ₫ · Vợ 5.000 ₫)". Không bao giờ vào "còn để chi".

Phương án bị loại:
- **Gộp vào Tích sản**: phao khẩn cấp đếm Tích sản tiền mặt (ADR-04) — sẽ đếm cả tiền đang khóa trong sổ tích lũy, không rút ngay được lúc khẩn cấp; Tích sản còn được rót theo % lúc chia lương, trộn vào thì không còn biết bao nhiêu là heo.
- **Coi như chi tiêu**: tiền thật và tài sản ròng thiếu đúng số tiền đã bỏ heo; ngân sách / chi theo danh mục bị đội lên dù không ai tiêu; lúc heo trả về lại phải ghi như "thu nhập" cả phần gốc — chia lương hai lần cho cùng một khoản.
- **Một tài khoản heo chung**: MB mở mỗi người một sổ trên tài khoản của chính họ; một tài khoản chung không đối chiếu được với app MB của từng người, và không nói được heo của ai bao nhiêu — chủ nhà muốn "mỗi người một con heo". Tổng chung đã có ở ví `heo-dat` và ở `locked.total`.
- **Không đổi ví** (chỉ chuyển tài khoản): Có thì tốt vẫn đếm tiền đã vào heo, "còn để chi" cao hơn số tiêu được thật.
- **Ví heo riêng mỗi người**: chủ nhà muốn cộng chung; tách theo người đã có ở tài khoản, hai ví chỉ nhân đôi chỗ phải chọn lúc gán.
### Consequences
Schema v1.17 (migration 0017). Rule gắn tài khoản và rule chuyển nội bộ có tài khoản đầu kia chỉ tạo được bằng migration — `POST /v1/rules` và "Luôn coi …" ở màn Gán chưa nhận ba cột mới; Cài đặt › Luật hiện và sửa được ưu tiên / bật tắt như rule khác. Tài khoản heo hiện ở Ví & Quỹ › Tài khoản như mọi tài khoản ghi tay (đếm / nhập số dư được). `tichsanCash` và `locked` đều là phần **trong** `cash`, không cộng thêm. Gợi ý ở màn Gán của mọi chuyển nội bộ (kể cả "Rút tiền mặt" có từ trước) giờ điền sẵn tài khoản đầu kia, và chip gợi ý ưu tiên `label` của gợi ý.
**Tiền heo có từ trước khi dùng app không nằm trong ví nào**: ví `heo-dat` chỉ giữ phần đã bỏ heo qua app (từ `opened_at` của heo); phần heo có từ trước chưa từng được rút khỏi phong bì nào. Vì vậy gợi ý heo trả về chỉ kèm chuyển ví Heo đất → Có thì tốt khi ví giữ ≥ số tiền về; ví ≤ 0 → chỉ chuyển tài khoản ("Tiền heo có từ trước khi dùng app nên không nằm trong ví nào — chỉ chuyển tài khoản."); 0 < ví < số tiền về → chỉ chuyển tài khoản, lời nhắc nói ví đang giữ bao nhiêu (người gán tự tách dòng nếu muốn chuyển đúng phần đó). Chuyển ví cả số tiền khi ví không giữ đủ sẽ đẩy Heo đất âm và thổi phồng "còn để chi" ở Có thì tốt bằng tiền chưa từng nằm trong ngân sách.
### Verified in code
`migrations/0017_heo_dat.sql` · `migrations/0019_heo_settlement_rule.sql` · `src/services/ingest.ts` › `LoadedRule`, `loadRuleRows`, `matchLog` (nhánh rule `transfer`), `suggestFor` (rule có tài khoản đầu kia; phần heo trả về nay theo ADR-82) · `src/services/ledger.ts` › `netWorth` (`locked`) · `src/domain/snapshot.ts` › `buildSnapshot` (`reserves`, `spendableByWallet` — không đổi) · `web/src/lib/networth.ts` › `netWorthLines` · `web/src/screens/assign.tsx` › `initialRows`, `LogRow` · `web/src/lib/types.ts` › `NetWorth.locked`, `BankLog.suggestion` · test `test/heo-dat.test.ts` (migration 0017 + 0019 + 0020, bỏ heo, rút heo về, tiền ra `TICH LUY`, networth); `web/src/lib/networth.test.ts` › "khối tiền thật trước (tab Nợ) › heo đất là tiền Tích sản ở tài khoản khóa: nói là một phần của Tích sản (tổng kèm từng người), không kể thêm lần nữa".
- [OPEN] Theo tài liệu SePay, MB không báo tiền ra (`sepay: { in: true, out: false }`): nếu SePay thật sự không gửi log làm tròn của `mb-main-husband`, khoản bỏ heo không bao giờ tới màn Gán — phải ghi tay (Nhập › Chuyển nội bộ kèm chuyển ví Có thì tốt → Tích sản, ADR-82). Đếm số dư tài khoản heo (UC-105) thay cho ghi tay thì phần chênh vào ví Có thì tốt (ví nhận phần còn lại), không vào Tích sản — phải chuyển ngân sách Có thì tốt → Tích sản thêm một lần (UC-712).
- Đã đóng 2026-10-03: câu hỏi mở cũ "nội dung log lúc sổ tích lũy trả về tài khoản chưa thấy tận mắt" — log thật là "Tat toan truoc han tien gui sotich luy AC - <số sổ> ngay<ngày> cua <tên>", không chứa `TIET KIEM TIEN LE`; mẫu `TICH LUY` (migration 0019) bắt nó.
- Đã chuyển sang ADR-82 (2026-10-03): heo trả về nhiều hơn sổ heo (tiền heo có từ trước khi dùng app, `opening_balance = 0`, hoặc lãi) — lời nhắc lãi / tiền trước app đã bỏ; câu hỏi mở nằm ở ADR-82.
- [OPEN] VAS 24 §04 xếp tiền gửi **không kỳ hạn** vào "Tiền"; sổ tích lũy là tiền gửi có kỳ hạn — đúng chuẩn mực thì chỉ là tương đương tiền khi kỳ hạn ≤ 3 tháng. App vẫn để heo trong "Tiền thật đang có" theo cách nhìn của chủ nhà (gốc chắc chắn, của nhà) và gắn nhãn "đã khóa".
- [OPEN] Lãi chỉ vào sổ khi về tài khoản; trong lúc sổ còn chạy, số dư heo trên app MB có thể lớn hơn sổ app (lãi dồn tích) — đếm số dư heo theo app MB sẽ ghi phần chênh là `adjust` vào Có thì tốt, không phải thu nhập.

## ADR-78: Rà soát SePay ba lớp: ngày, tuần, tháng
- Date: 2026-10-03 · Status: accepted · Mở rộng ADR-23 (khoảng rà của lượt 02:00); giữ một lượt gọi SePay mỗi kết nối (ADR-65, ADR-75), chống trùng ADR-40/ADR-49, mốc mở sổ ADR-76; không thêm cron (ADR-56, ADR-70)
- Plan ID: — · Context: ingest (khoảng rà, payload dòng `backfill` — UC-304) + notify (dòng 🩹 của tin sáng — UC-402; lượt 02:00 không đổi — UC-401)
- Source: yêu cầu chủ nhà — "API SePay kéo theo ngày, xong 1 tuần thì kéo 1 lần theo tuần, cuối tháng kéo 1 lần theo tháng cho an toàn; kéo xa quá cũng không lợi ích gì — tuần là check lần 2 của ngày, tháng là check của cả tuần và ngày"
### Context
Lượt 02:00 chỉ rà từ 00:00 hôm qua tới lúc chạy (ADR-23). Mỗi giao dịch vì thế chỉ được rà **một** lần (hai lần nếu rơi vào 00:00–02:00): dòng lỗi tạm thời bị bỏ (UC-304 6a) không bao giờ được thử lại dù chú thích code hứa "lần sau thử lại" (ADR-23 [OPEN] cũ, UC-304 [DIVERGENCE] cũ); một đêm rà hỏng cả lượt (token sai, SePay hay mạng lỗi) làm mất hẳn lưới an toàn cho ngày hôm trước — chỉ còn cách người nhà tự nhớ bấm Đồng bộ lại (ADR-75).
### Decision
- **Ba lớp chồng nhau, chọn theo ngày VN của lượt 02:00** (`backfillWindow(now)`): ngày thường → từ 00:00 hôm qua (`day`); **thứ Hai** → từ 00:00 thứ Hai tuần trước, tức cả tuần trước — lần soát thứ hai của bảy lượt ngày (`week`); **ngày 1** → từ 00:00 ngày 1 tháng trước, tức cả tháng trước — soát lại cả lượt tuần lẫn lượt ngày (`month`). Ngày 1 rơi vào thứ Hai thì lấy tháng (rộng hơn tuần). Đầu kia luôn là lúc chạy (02:00).
- **Vẫn một lượt gọi SePay mỗi kết nối mỗi đêm**, cho lớp rộng nhất, qua cùng `syncSepay`: giao dịch đã có nhận ra bằng một câu SELECT và đếm vào `duplicates` (ADR-75), chống trùng như cũ (ADR-40, ADR-49), log trước ngày mở sổ ghi `ignored` (ADR-76).
- **Không rà xa hơn ngày 1 tháng trước.** Lỗ hổng cũ hơn dùng Đồng bộ lại theo khoảng ngày (≤ 31 ngày, ADR-75) — không đổi.
- **Dòng `notifications(kind='backfill')`** mang payload `{"added":N,"scope":"day"|"week"|"month"}`; tin sáng (khi `added > 0`) thêm " (soát lại cả tuần trước)" hay " (soát lại cả tháng trước)" sau "🩹 Đêm qua vá N giao dịch webhook bỏ sót"; lượt ngày giữ nguyên chữ.

Phương án bị loại:
- **Kéo xa hơn tháng trước** (mỗi đêm 31 ngày, hay soát theo quý): không có lợi — số dư từng tài khoản đã đối soát hằng ngày (UC-106, dòng 🏦 của tin sáng), lệch cũ đã lộ từ trước; mỗi lượt tốn thêm trang API (100 dòng/trang, SePay giới hạn 3 request/giây — ADR-65) và câu SELECT rộng hơn chỉ để đếm `duplicates`.
- **Ba lần gọi riêng cho ba lớp**: thừa — khoảng của lớp rộng đã chứa lớp hẹp; gọi ba lần nhân số request SePay mà chỉ thêm dòng trùng.
- **Cron riêng cho tuần và tháng**: tốn trigger trong quota 5 trigger trên cả tài khoản Cloudflare gói Free (ADR-56); lượt 02:00 sẵn có đã biết hôm nay là thứ Hai hay ngày 1 — vẫn hai biểu thức cron (ADR-70).
### Consequences
Thứ Hai và ngày 1, lượt rà đi nhiều trang SePay hơn (lớp tuần 7 ngày 2 giờ, lớp tháng 28–31 ngày 2 giờ) và câu SELECT giao dịch đã có rộng theo; giao dịch thật sự mới vẫn tốn truy vấn D1 như cũ (UC-304 [OPEN], ADR-54). Trần 50 trang × 100 dòng mỗi kết nối (ADR-65) vẫn áp cho cả khoảng tháng. Dòng lỗi tạm thời hay một đêm rà hỏng được vá muộn nhất ở lượt thứ Hai kế tiếp, lần chót ở lượt ngày 1 kế tiếp. Lớp tuần/tháng vắt qua ngày mở sổ thì giao dịch trước mốc vào `beforeOpening` (lần đầu) hoặc `duplicates`, không vào sổ (ADR-76). Dòng `backfill` ghi trước quyết định này không có `scope` — đọc như lượt ngày. `yesterdayMidnightVn` bị thay bằng `backfillWindow` (export để test). Cron trigger vẫn là 2. ingest UC-304 (AC-2, AC-6, AC-8 sửa; AC-12 mới); notify UC-402 (AC-11), UC-401 (lịch không đổi).
### Verified in code
`src/cron/backfill.ts` › `backfillWindow`, `runBackfill` (payload `{ added, scope }`) · `src/cron/daily.ts` › `daily` (`backfillScope`) · `src/notify/format.ts` › `dailyMessage`, `DailyMessageInput.backfillScope` · test `test/cron-sepay.test.ts` › "cron/backfill — rà soát 02:00 sáng (SePay API v2) › khoảng rà 02:00 ba lớp: ngày thường soát hôm qua, thứ Hai soát cả tuần trước, ngày 1 soát cả tháng trước (thắng cả thứ Hai)"; `test/cron-daily.test.ts` › "các dòng lấy đúng số từ DB › đêm qua backfill vá bao nhiêu lấy từ notifications(kind='backfill', day_key=hôm nay); lượt soát tuần ghi rõ".

## ADR-79: Thông báo hai bản: bản ngắn cho thông báo đẩy, bản đầy đủ cho Telegram
- Date: 2026-10-03 · Status: accepted · Tinh chỉnh ADR-64 (nội dung kênh push); giữ ADR-09 (claim `notifications` trước khi gửi)
- Plan ID: — · Context: notify (dựng tin — UC-402, UC-406, UC-407; cửa gửi — UC-408, UC-410) + pwa (ghi chú thẻ "Thông báo trên máy này" — UC-714)
- Source: yêu cầu chủ nhà — "chia cho tôi thành 2 kiểu: 1 kiểu là thông báo qua app PWA (push), 1 kiểu full (Telegram)"; giới hạn hiển thị: Telegram `sendMessage` 1–4096 ký tự sau khi parse entity ([Bot API](https://core.telegram.org/bots/api#sendmessage)); thông báo đẩy — tiêu đề hiện chừng 25–50 ký tự trên iOS, nội dung chừng 150–178 ký tự trên màn khoá iOS, Android thu gọn một dòng / mở rộng chừng 240 ký tự ([CleverTap](https://clevertap.com/blog/what-are-push-notification-character-limits/), [Reteno](https://reteno.com/blog/push-notification-character-limits-tips-to-be-visible)); push service không được từ chối payload ≤ 4096 byte ([RFC 8030 §7.2](https://www.rfc-editor.org/rfc/rfc8030#section-7.2))
### Context
Từ ADR-64, `notifyMembers` gửi **một** văn bản: Telegram nhận nguyên văn, máy nhận chính văn bản đó bỏ thẻ HTML, cắt 1000 ký tự, tiêu đề cố định theo loại tin ("Tin sáng", "Tổng kết tuần", "Giao dịch chưa gán"). Trên điện thoại chỉ thấy tiêu đề và chừng 150 ký tự đầu: tin sáng mở bằng dòng 💰 rồi các dòng thông tin, nên việc cần làm (chưa gán, cần xem tay, chuyển tiền quá hạn…) nằm sau phần bị cắt; tiêu đề cố định không nói gì.
### Decision
- **Mỗi tin dựng hai bản cùng lúc** từ cùng số liệu, trong hàm thuần của `src/notify/format.ts`: `{ full, push: { title, body } }` (`dailyMessage`, `weeklyMessage`, `pendingMessage`). `notifyMembers(env, kind, dayKey, { full, push })`: Telegram nhận `full`, mỗi máy nhận `push`; `url`/`tag` theo loại tin như cũ. Bỏ đường bỏ thẻ/cắt 1000 ký tự; gửi thử giữ tiêu đề "Gửi thử", nội dung như cũ.
- **Bản ngắn**: tiêu đề ≤ 25 ký tự mang con số quan trọng nhất (tin sáng "Còn X tuần này", không vừa thì "Còn X"; tổng kết tuần "Tuần T40: chi X", không vừa thì "T40: chi X", rồi "Tổng kết T40"; chưa gán "N giao dịch chưa gán"); nội dung ≤ 150 ký tự, chữ thường không HTML, việc cần làm trước, thông tin sau, nối bằng " · "; hết chỗ thì bỏ mục từ cuối lên và kết thúc bằng "…" (tin chưa gán: "… và N khoản"); không emoji (gửi thử giữ ✅).
- **Bản đầy đủ** giữ câu chữ cũ (< 4096 ký tự), riêng tin sáng xếp lại: 💰, rồi **việc cần làm** (📥 chưa gán · ❗ cần xem tay · 🔁 chuyển tiền quá hạn · ⚠️ sắp vỡ · 📅 ngày 10/25 chưa chia · 🧮 Chủ nhật đếm ví · 🏠 ngày 1 chốt người thuê · 🧹/🔁 quét tháng), rồi **thông tin** (🎯 mục tiêu/phao · 💳 nợ · 🤝 phải thu · 🏦 đối soát · 🔗 tự ghép · 🩹 vá đêm); dòng ❗ rút còn "❗ N giao dịch ngân hàng cần xem tay".

Phương án bị loại:
- **Một văn bản, cắt còn 150 ký tự**: mất đúng phần việc cần làm nằm cuối tin sáng; tiêu đề vẫn không mang số.
- **Chỉ Telegram** (bỏ push): người không dùng Telegram mất kênh nhận tin (lý do của ADR-64).
- **Rút gọn bằng AI**: thêm phụ thuộc, tốn tiền và độ trễ mỗi tin, câu chữ không xác định trước để test; hàm thuần đủ làm việc này.
### Consequences
Hai bản luôn đi cùng nhau; formatter nào thêm dòng mới phải quyết luôn mục ngắn của nó. Tin dài (nhiều ví sắp vỡ tên dài) thì bản ngắn mất các việc cuối — mở app hoặc Telegram để xem đủ. Dòng `notifications` của `push:<id>` nay lưu đúng bản đã gửi (`title` + xuống dòng + `body`) thay cho văn bản HTML của Telegram. Tổng kết tuần cần thêm tổng chi cả tuần (`totalSpent`, mọi danh mục, spend − refund) — `weekly` bỏ `LIMIT 5`/`HAVING` trong câu SQL, lọc top 5 ở code. Thẻ "Thông báo trên máy này" ghi rõ máy nhận bản ngắn, Telegram nhận bản đầy đủ. notify UC-402 (thứ tự, AC-4/AC-17 sửa, thêm AC bản ngắn), UC-403, UC-406, UC-407, UC-408, UC-410; pwa UC-714.
### Verified in code
`src/notify/format.ts` › `NotifyMessage`, `PUSH_TITLE_MAX`, `PUSH_BODY_MAX`, `fitJoin`, `firstFit`, `dailyMessage`, `weeklyMessage`, `pendingMessage` · `src/notify/telegram.ts` › `notifyMembers` · `src/services/push.ts` › `PushText`, `pushPayload`, `pushToMembers`, `sendTest` · `src/cron/daily.ts` › `daily` · `src/cron/weekly.ts` › `weekly` (`totalSpent`) · `src/cron/pending-notifier.ts` › `notifyPendingLogs` · `web/src/screens/settings.tsx` › `PushNotifications` (ghi chú thẻ) · test `test/format.test.ts` › "dailyMessage — bản ngắn cho thông báo đẩy › tin dài nhất: tiêu đề ≤ 25, nội dung ≤ 150; cắt từ cuối, giữ việc đứng đầu, kết thúc bằng …"; `test/push.test.ts` › "notifyMembers qua push › tin sáng: Telegram nhận bản đầy đủ, máy nhận bản ngắn mở màn Hôm nay; notifications lưu đúng bản đã gửi".

## ADR-80: Thêm Zalo Bot làm kênh thông báo thứ ba
- Date: 2026-10-03 · Status: accepted · Mở rộng ADR-64 (cửa gửi `notifyMembers` gửi tới mọi kênh đang bật); giữ ADR-09 (claim `notifications` trước khi gửi) và ADR-79 (kênh chat nhận bản đầy đủ); khoá đặt từ app như bot Telegram (commit `c80ae89`)
- Plan ID: — · Context: notify (kênh Zalo, nối bằng mã — UC-411; cửa gửi — UC-408, UC-407) + access (khoá bot, khoá webhook, Đặt webhook — UC-508; `zalo_chat_id`, mã nối — UC-507; UC-505, UC-509) + pwa (Cài đặt › Kết nối, Thành viên — UC-709; ghi chú thẻ máy này — UC-714)
- Source: yêu cầu chủ nhà — "thêm kênh thông báo" (Zalo Bot, cạnh Telegram và thông báo đẩy); tài liệu Zalo Bot Platform: [docs.zaloplatforms.com/docs/BOT](https://docs.zaloplatforms.com/docs/BOT), bản đầy đủ [llms-full.txt](https://docs.zaloplatforms.com/BOT/llms-full.txt); gói và giới hạn: [bot.zaloplatforms.com](https://bot.zaloplatforms.com/)
### Context
Cả nhà dùng Zalo hằng ngày; Telegram chỉ một người dùng (lý do của ADR-64), còn thông báo đẩy phụ thuộc máy đã bật và iOS chỉ nhận khi app nằm ngoài màn hình chính. Zalo Bot Platform cho mỗi tài khoản Zalo tạo bot ngay trong app Zalo (OA "Zalo Bot Manager" → "Zalo Bot Creator"); bot có **Bot Token** dạng `12345689:abc-xyz`, không hết hạn tới khi tự đặt lại. Gửi tin: `POST https://bot-api.zaloplatforms.com/bot<TOKEN>/sendMessage` `{ chat_id, text }`, `text` 1–2000 ký tự, chữ thường (không HTML); trả `{ ok, result }` hoặc `{ ok: false, error_code, description }`, lỗi 400/401/403/404/408/429 (429 = hết hạn mức). Khác Telegram: **chỉ biết `chat_id` khi người dùng nhắn bot trước** — qua webhook (`setWebhook { url, secret_token }`, khoá 8–256 ký tự; Zalo gửi kèm header `X-Bot-Api-Secret-Token`; payload `message.chat.id`, `chat.chat_type` `PRIVATE`|`GROUP`, `from.display_name`, `message.text`; phải trả 2xx nhanh; số lần gọi `setWebhook` mỗi ngày có hạn → lỗi 426; Zalo tự gọi thử địa chỉ và trả `result.verification`) hoặc `getUpdates` (chỉ cho dev, loại trừ webhook). Gói Basic miễn phí: 3 bot, ≤ 50 người dùng mỗi bot, ≤ 3.000 tin/tháng, nhóm còn beta.
### Decision
- **Kênh thứ ba của `notifyMembers`** (`zaloToMembers`, `src/notify/zalo.ts`): có bot token thì mọi thành viên `active` có `members.zalo_chat_id` nhận **bản đầy đủ** đổi sang chữ thường (`zaloText`: bỏ thẻ, trả `&lt;` `&gt;` `&quot;` `&#39;` `&amp;` về ký tự, quá 2000 đơn vị UTF-16 thì cắt và kết thúc bằng "…"; không `parse_mode`). Chống trùng bằng claim `notifications` `chat_id = 'zalo:<chat_id>'` (một chat nối cho hai người chỉ nhận một tin). `sendZalo` tối đa 3 lượt, chỉ thử lại khi lỗi mạng / HTTP ≥ 500 / 408; 429 (hết hạn mức) và lỗi khác dừng ngay, log `[zalo] <kind> <dayKey>: <lỗi>`. Tin gửi được cộng vào số trả về ("đã báo" của UC-407 tính mọi kênh); giờ nhắc, giờ yên lặng áp như các kênh khác.
- **Nối bằng mã, không nhập tay**: Cài đặt › Thành viên › **Nối Zalo** tạo mã 6 số (`POST /v1/settings/members/:id/zalo-code`, hạn 15 phút, một mã đang chờ mỗi người, dùng một lần; chưa đặt token hoặc khoá webhook → 409 `zalo_not_ready`). Người đó nhắn mã cho bot trong chat riêng; `POST /webhooks/zalo` (ngoài `/v1`, so `X-Bot-Api-Secret-Token` thời gian hằng với khoá webhook; chưa đặt khoá hoặc sai → 401) đọc nhóm 6 số đầu của tin, khớp mã còn hạn → ghi `zalo_chat_id`, xoá mã, trả lời "Đã nối Zalo cho {tên}. …". Tin khác trong chat riêng → câu hướng dẫn **tối đa một lần mỗi chat mỗi ngày VN** (claim `notifications` kind `zalo_help`); tin trong nhóm bỏ qua. Sau xác thực luôn trả 200, không ghi nội dung tin ra log. `PATCH /members/:id` chỉ nhận `zalo_chat_id: null` (bỏ nối).
- **Khoá trong `config`** như bot Telegram: `secret:zalo_bot_token`, `secret:zalo_webhook_secret` (dự phòng `wrangler secret` `ZALO_BOT_TOKEN` / `ZALO_WEBHOOK_SECRET`), chỉ trả `{ set, hint, source }`; khoá webhook 8–256 ký tự chỉ gồm `A–Z a–z 0–9 _ -` (đi trong header HTTP). Nút **Đặt webhook** (`POST /v1/settings/zalo/webhook`) gọi `setWebhook` với `<origin>/webhooks/zalo` và khoá webhook, báo lỗi Zalo bằng câu dễ hiểu (426 = đặt quá nhiều lần hôm nay; 401 = token sai). **Gửi thử** Zalo (`POST /v1/settings/test/zalo`) như gửi thử Telegram.

Phương án bị loại:
- **Zalo Official Account (OA)**: gửi tin chủ động tới người quan tâm OA tốn phí theo gói / theo tin và bị giới hạn số tin, loại tin — quá nặng cho một hộ hai người, trong khi bot gói Basic miễn phí và đủ hạn mức.
- **Nhập `chat_id` Zalo tay** (như `tg_chat_id`): người dùng Zalo không thấy `chat_id` ở đâu trong app; chỉ webhook (hay `getUpdates`) biết được id khi họ nhắn bot, nên mã nối là đường duy nhất người nhà tự làm được.
- **Polling `getUpdates` bằng cron**: Zalo ghi `getUpdates` chỉ dành cho phát triển và không dùng được khi đã đặt webhook; cron 15 phút làm người dùng chờ lâu sau khi nhắn mã, tốn lượt chạy mà vẫn cần lưu trạng thái đã đọc.
- **Gửi bản ngắn cho Zalo**: Zalo là khung chat như Telegram, đọc được tin dài; bản ngắn (≤ 150 ký tự) chỉ hợp với thông báo màn khoá (ADR-79).
### Consequences
Gói Basic giới hạn **3.000 tin/tháng** và **≤ 50 người** mỗi bot: hai người × (tin sáng + tổng kết tuần + tin chưa gán) dư hạn mức, nhưng hết hạn mức thì Zalo trả 429 — tin đó mất với kênh Zalo (không thử lại, dòng `ok = 0`), Telegram và máy vẫn nhận. Câu hướng dẫn trả lời tin lạ chỉ một lần mỗi chat mỗi ngày để người lạ nhắn bot không đốt hạn mức. `setWebhook` bị giới hạn số lần mỗi ngày — chỉ gọi khi bấm "Đặt webhook", không gọi tự động. Mã 6 số sống 15 phút: **ai nhắn đúng mã trong 15 phút sẽ được nối và nhận tin của nhà** — rủi ro nhỏ (10⁶ tổ hợp, mã chỉ hiện trên màn của người vừa bấm Nối Zalo, dùng một lần, tạo mã mới thì mã cũ hết dùng); chủ nhà thấy trạng thái "Đã nối Zalo" ở Thành viên và Bỏ nối được. Bot nhận tin vào nhưng chỉ để nối — không có lệnh (BR-06 Out of scope giữ nguyên với lệnh). Tin dài hơn 2000 ký tự (tin sáng nhiều dòng) bị cắt ở Zalo, đầy đủ vẫn ở Telegram và app. Schema v1.18 (migration 0018: `members.zalo_chat_id`, `zalo_link_codes`). notify UC-411 mới, UC-407, UC-408, entities; access UC-505, UC-507, UC-508, UC-509, entities; pwa UC-709, UC-714.
Hạ tầng (2026-10-03): Cloudflare Browser Integrity Check chặn máy chủ Zalo (`Java/1.8.0_192`, AS38244 VNG) bằng 403 ngay ở biên; luật Skip trong WAF Custom rules không gỡ được, phải dùng **Configuration Rule** tắt BIC cho `vi-nha.example/webhooks/*`. Cùng luật áp cho `/webhooks/sepay`. Hai webhook vẫn tự xác thực bằng khoá riêng nên mở BIC ở đó không hở thêm gì.
### Verified in code
`migrations/0018_zalo.sql` · `src/notify/zalo.ts` › `ZALO_TEXT_MAX`, `ZaloReply`, `callZalo`, `sendZalo`, `zaloText`, `zaloToMembers` · `src/notify/telegram.ts` › `notifyMembers` (Telegram → Zalo → push) · `src/services/zalo.ts` › `ZALO_CODE_TTL_MS`, `zaloErrorText`, `createZaloLinkCode`, `handleZaloUpdate`, `setZaloWebhook`, `testZalo` · `src/routes/webhooks.ts` (`POST /webhooks/zalo`) · `src/routes/settings.ts` (`/members/:id/zalo-code`, `/zalo/webhook`, `/test/zalo`) · `src/services/settings.ts` › `getSettings`, `updateMember`, `secretValue` · `src/services/secrets.ts` › `SECRET_NAMES` · `web/src/screens/settings.tsx` › `Connections`, `Members`; `web/src/screens/settings-sheets.tsx` › `MemberSheet`, `ZaloLink` · test `test/zalo.test.ts` › "webhook Zalo › nhắn đúng mã còn hạn trong chat riêng → nối zalo_chat_id cho đúng người, mã dùng một lần, bot trả lời đã nối"; `test/zalo.test.ts` › "gửi tin qua Zalo › notifyMembers gửi bản đầy đủ dạng chữ thường cho người đã nối Zalo, chống gửi trùng, đếm vào số đã gửi".

## ADR-81: Chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi
- Date: 2026-10-03 · Status: accepted · Mở rộng ADR-29 (ghép cặp chỉ giữa hai log `pending`); dùng cùng điều kiện `canPair` (khác tài khoản, ngược chiều, cùng số tiền, lệch ≤ 10 phút); giữ chốt chặn ở DB của migration 0005 (chân thứ hai phải đang `pending`)
- Plan ID: — · Context: ingest (tự khớp — UC-303 bước 2b; gợi ý + gán — UC-305 bước 2, 5b; gỡ gán — UC-306) + pwa (màn Gán — UC-706)
- Source: sự cố prod 2026-10-03 — một chuyển nội bộ 250.000 ₫ nằm trong sổ hai lần (đối chiếu `transactions`/`bank_logs` trên D1 prod)
### Context
Một lần chuyển nội bộ thật 250.000 ₫ từ MB chính (chồng, `mb-main-husband`, kết nối SePay `chinh`) sang MB chi tiêu (vợ, `mb-spending-wife`, kết nối `sepay-wife` — ADR-75), nội dung "QAESPQ8378 APPMB1 1 NGUYEN VAN A thanh toan", hai chân cùng lúc 11:20Z, nằm trong sổ **hai lần**: giao dịch 16 (`transfer` `mb-main-husband` → `mb-spending-wife`, `log_id` = chân ra `86671567`) và giao dịch 20 (cùng chiều, cùng số, `log_id` = chân vào `86671569`), cả hai `log_id_2` NULL. `mb-main-husband` hiện −500.000, `mb-spending-wife` +500.000 thay vì 250.000 mỗi bên. Giao dịch 20 mang dấu của **gán tay** (`assignLog`: log tiền vào gán Chuyển nội bộ "Tiền từ" `mb-main-husband` cho ra `account_id = mb-main-husband`; không nhánh tự khớp nào ghi log `in` thành `transfer` chiều đó). Ghép cặp tự động (ADR-29) chỉ ghép **hai log `pending`**: khi một chân đã thành chuyển nội bộ (gán tay, hay rule) trước lúc chân kia về / được xét, chân kia không còn ứng viên nào, nằm chờ, và người gán nó Chuyển nội bộ thì `assignLog` ghi thêm một giao dịch mới. Hai tài khoản nằm ở hai kết nối SePay khác nhau nên hai chân về theo hai đường, lệch nhau là bình thường. Đối soát (UC-106) thấy được hậu quả — `book_drift` mỗi bên lệch 250.000 vì sổ theo giao dịch gấp đôi sổ theo log — nhưng không có gì chặn nó lúc gán.
### Decision
- **Chân thứ hai gắn vào giao dịch đã ghi**: log có thể là chân còn lại của một `transfer` `active` có `log_id_2 IS NULL`, cùng số tiền, mà log `log_id` của nó trọn số tiền đó (không tách dòng), ngược chiều, nằm ở tài khoản đầu kia của giao dịch, còn log đang xét nằm đúng ở đầu còn lại theo chiều tiền (tiền vào → `counter_account_id`, tiền ra → `account_id`), lệch ≤ 10 phút (`canPair`) — thì log được **gắn** làm `log_id_2` của giao dịch đó (một batch: `log_id_2` + log `assigned`, log chỉ đổi trạng thái khi giao dịch thật sự nhận nó), không ghi giao dịch mới. Nhiều giao dịch hợp lệ → chân gần giờ nhất. Ví, ghi chú, người ghi của giao dịch đã ghi giữ nguyên.
- **Tự khớp** (`matchLog`, bước 2b): sau ghép cặp hai log `pending`, trước rule và trước luật "chỉ tiền vào" (ADR-66) — gắn không thêm tiền nào vào sổ nên không có rủi ro đếm hai lần mà ADR-66 tránh.
- **Gán tay** (`POST /v1/logs/:id/assign`, cả MCP `assign_log`): đúng một dòng `transfer` trọn số tiền có `other_account_id` = tài khoản của chân đã ghi → gắn, trả `attached: true` và giao dịch đã gắn; mọi cách gán khác (tách dòng, loại khác, tài khoản khác) giữ nguyên như cũ (`attached: false`).
- **Gợi ý ở màn Gán**: `{meaning: "transfer", other_account_id, attach_to_tx, label: "Khớp chuyển nội bộ đã ghi lúc HH:mm"}` (giờ VN của chân đã ghi), đứng sau "có thể trùng", trước mọi gợi ý theo rule; PWA hiện chip, banner xanh, dòng mặc định Chuyển nội bộ đúng tài khoản, toast "Đã khớp vào chuyển nội bộ đã ghi X ₫ — không ghi thêm.".
- **Gỡ gán** không đổi: giao dịch có chân gắn sau là giao dịch hai chân — gỡ trả cả hai log về `pending` (UC-306).

Phương án bị loại:
- **Chặn gán tay chân thứ hai** (báo lỗi khi đã có chuyển nội bộ một chân khớp): người vẫn cần ghi log đó cho xong hàng chờ, và chặn không cho biết phải làm gì — log nằm chờ mãi hoặc bị Bỏ qua (khi ấy đối soát theo log lệch, ADR-76/UC-106).
- **Chỉ cảnh báo "có thể trùng"** như song sinh (UC-302): người bấm Gán vẫn ghi giao dịch thứ hai — vẫn đếm hai lần; đúng loại lỗi vừa xảy ra trên prod.
- **Huỷ giao dịch một chân rồi ghép cặp lại hai log**: mất ví/ghi chú/người ghi của lần gán đầu, đổi id giao dịch người đã thấy, và phải gỡ lần chia hay lệnh chuyển gắn theo — nhiều bước hơn mà kết quả tiền như gắn.
### Consequences
Cùng rủi ro đã chấp nhận của ADR-29: một khoản thật trùng số tiền, ngược chiều, trong 10 phút ở đúng tài khoản đầu kia của một chuyển nội bộ một chân sẽ bị gắn nhầm (không vào sổ riêng); gỡ gán giao dịch đó trả cả hai log về chờ. Giao dịch có chân gắn sau được tin sáng đếm là "cặp tự ghép" (`log_id_2 IS NOT NULL`, notify UC-402) như cặp ghép tay. Dữ liệu cũ không tự sửa: prod gỡ gán giao dịch 20 (log `86671569` về `pending`), màn Gán gợi ý khớp vào giao dịch 16, gán thì gắn — `mb-main-husband` −250.000, `mb-spending-wife` +250.000. Không đổi schema.
### Verified in code
`src/services/ingest.ts` › `findSingleLegTransfer`, `attachSecondLeg`, `matchLog` (bước "2b"), `listPendingLogs`, `assignLog` (`attached`) · `src/domain/rules.ts` › `canPair` · `web/src/screens/assign.tsx` › `AssignSheet` (banner, `submit`), `LogRow` · `web/src/lib/types.ts` › `BankLog` (`attach_to_tx`) · test `test/ingest.test.ts` › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81)".

## ADR-82: Heo đất là Tích sản: vào khoá vào Tích sản, ra chỉ đổi chỗ
- Date: 2026-10-03 · Status: accepted · Thay phần ví của ADR-77 (ví giữ riêng `heo-dat`, chuyển ví khi heo trả về, lời nhắc tiền trước app / lãi); giữ phần tài khoản của ADR-77 (mỗi người một tài khoản heo `locked`, rule gắn tài khoản, mẫu `TICH LUY`, `locked` ở networth); phao đếm Tích sản tiền mặt như ADR-04; bút toán chỉ đổi ví như chốt tháng (allocation UC-207)
- Plan ID: — · Context: ingest (bỏ heo vào Tích sản, gợi ý rút heo — UC-303, UC-305, UC-307) + ledger (ví `heo-dat` tắt, phao — README, UC-103, entities) + receivable (khối tiền thật trước — UC-1005) + access (health v1.20 — UC-506, UC-509) + pwa (UC-706, UC-707, UC-712)
- Source: quyết định chủ nhà 2026-10-03 — "vào thì là dạng tích sản (tiết kiệm tiền lẻ); ra thì chưa biết nên trả về đâu"; trước đó: "vào: từ tk chi tiêu của tôi và vợ → sync về bên đó; ra: từ đó về → thực hiện rút; sau đó tiền đó đi đâu là việc của tôi"
### Context
ADR-77 cộng hai con heo ở ví giữ riêng `heo-dat` (holding, không vào phao) và loại "gộp vào Tích sản" vì phao sẽ đếm cả tiền đang khóa. Hai chỗ không khớp ý chủ nhà: (1) tiền lẻ bỏ heo là **tiết kiệm có lãi** — tích sản, không phải quỹ chờ quyết; (2) heo trả về được gợi ý chuyển ví Heo đất → Có thì tốt, tức tiền tiết kiệm tự quay lại "còn để chi", và phải thêm nhánh ví đủ / ví thiếu / ví trống cùng lời nhắc tiền trước app và lãi (UC-305 v12). Chủ nhà muốn app chỉ ghi đúng chỗ tiền nằm; tiền rút về đi đâu do anh tự làm. Prod lúc quyết: ví `heo-dat` 9.000 (bỏ heo của vợ, Có thì tốt → Heo đất), `piggy-wife` 9.000, `piggy-husband` 0 (đã tất toán, chỉ chuyển tài khoản).
### Decision
- **Vào (bỏ heo)**: giữ nguyên phần tài khoản của ADR-77 — tài khoản MB → heo của chính chủ, mẫu `CHUYEN TIEN LE LAM TRON` / `TIET KIEM TIEN LE` / `TICH LUY`, tự gán khi tài khoản báo cả tiền ra, gợi ý khi "chỉ tiền vào" — nhưng ví **Có thì tốt → Tích sản**. Tiền bỏ heo là Tích sản tiền mặt đang nằm ở tài khoản khóa.
- **Ra (heo trả về)**: log `in` khớp mẫu heo của tài khoản đó → **chỉ gợi ý** (tiền vào luôn hỏi, luật 6) `{meaning: "transfer", other_account_id: <heo>, label: "Rút heo về <tên tài khoản nhận>", note: "Chỉ đổi chỗ tiền; tiền vẫn thuộc Tích sản cho tới khi anh tự chuyển ví."}` — không chuyển ví, không lời nhắc lãi / tiền trước app, không đọc số dư ví. Tiền vẫn thuộc Tích sản; người gán vẫn tách dòng được (vd phần lãi là Thu nhập).
- **Bỏ ví `heo-dat`** (migration 0020, schema v1.20, chỉ dữ liệu): rule heo `wallet_id` → ví Tích sản đang dùng (`tier='tichsan'`, prod `tich-san`); số dư dương của `heo-dat` sang Tích sản bằng **một** `transfer` chỉ đổi ví (không tài khoản, `source='system'`, `note` "Heo đất là Tích sản: chuyển số dư ví Heo đất sang Tích sản", `at`/`week_key`/`month_key` chép từ dòng `active` gần nhất đụng ví heo — kỳ do app tính, không tính lại trong SQL) như bút toán chốt tháng; rồi `wallets.active = 0`. Sổ chỉ ghi thêm: dòng cũ mang `heo-dat` giữ nguyên; Σ số dư các ví và tiền thật không đổi. Không có ví Tích sản đang dùng → không đụng gì ngoài version; DB seed mẫu (không có heo) chỉ đổi version. Tài khoản heo giữ nguyên (`locked = 1`, tiền thật).
- **Bức tranh tiền thật** (`GET /v1/networth`, hình dạng không đổi): `tichsanCash` nay gồm tiền đã bỏ heo qua app; `locked` là phần của nó đang nằm ở heo — không cộng thêm lần nữa. Khối tab Nợ: `locked.total ≤ tichsanCash` → "trong đó Tích sản X đã khóa (gồm heo đất Y: Chồng … · Vợ …)"; heo nhiều hơn Tích sản (tiền heo có từ trước khi dùng app, không nằm trong ví nào) → kể riêng như ADR-77 "Tích sản X đã khóa, Heo đất Y đã khóa (…)"; heo rỗng không nhắc.
- **Ví & quỹ**: không còn card "Heo đất" (ví tắt nên không ở `snapshot.reserves`); bỏ nhánh "quỹ giữ riêng trú ở tài khoản khóa" của audit M12 — mọi card quỹ giữ riêng lại có Trả nợ / Chuyển sang Tích sản. Tài khoản heo vẫn hiện ở Ví & quỹ › Tài khoản.

Phương án bị loại:
- **Giữ ví `heo-dat`, heo trả về chuyển ví Heo đất → Có thì tốt** (ADR-77): tiền tiết kiệm tự quay lại "còn để chi"; app quyết thay chủ nhà tiền rút về đi đâu; ba nhánh ví đủ / thiếu / trống.
- **Heo trả về chuyển ví Tích sản → Có thì tốt**: Tích sản khóa chiều ra (`locked_wallet`); vẫn là app quyết thay chủ nhà.
- **Giữ ví `heo-dat` chỉ để đếm tổng heo**: hai chỗ cho cùng một khoản tiết kiệm; tổng heo theo người đã có ở `locked` (sổ tài khoản heo).
- **Migration xoá / sửa dòng cũ của ví heo cho gọn**: phạm luật sổ chỉ ghi thêm (ADR-02).
### Consequences
**Phao khẩn cấp đếm tiền heo** (phao = Tích sản tiền mặt, ADR-04): chủ nhà chấp nhận heo là Tích sản — đảo đúng lý do ADR-77 đã loại "gộp vào Tích sản"; tiền trong sổ tích lũy rút trước hạn được (MB "tất toán trước hạn") nên vẫn dùng được lúc khẩn cấp. Prod sau 0020: Tích sản +9.000, phao +9.000; 9 rule heo trỏ `tich-san`; ví `heo-dat` 0 và tắt; `piggy-wife` 9.000, `piggy-husband` 0, tiền thật không đổi. Ví Tích sản không còn tách được "bao nhiêu là heo" — số đó ở `locked`. Bỏ heo vẫn rút Có thì tốt như ADR-77; heo trả về không còn trả lại Có thì tốt, nên tiêu tiền rút về phải qua một quyết định riêng. `GET /v1/health` → `v1.20`.
### Verified in code
`migrations/0020_heo_tich_san.sql` · `src/services/ingest.ts` › `suggestFor` (`HEO_RETURN_NOTE`), `listPendingLogs`, `matchLog` (nhánh rule `transfer` — ví lấy từ rule, không đổi) · `src/services/ledger.ts` › `netWorth` · `web/src/lib/networth.ts` › `netWorthLines` · `web/src/screens/wallets.tsx` › `BudgetTab` · test `test/heo-dat.test.ts` (migration 0020 trên dữ liệu như prod, bỏ heo vào Tích sản, rút heo về, networth); `web/src/lib/networth.test.ts` › "khối tiền thật trước (tab Nợ) › heo đất là tiền Tích sản ở tài khoản khóa: nói là một phần của Tích sản (tổng kèm từng người), không kể thêm lần nữa".
- [OPEN] Lời nhắc "tới khi anh tự chuyển ví" nhưng Tích sản khóa chiều ra: chuyển ngân sách hay chuyển khoản kèm ví **từ** Tích sản đều bị `locked_wallet` (ledger UC-101, pwa UC-712). App chưa có đường đưa tiền heo đã rút về ra khỏi Tích sản; chủ nhà chưa quyết.
- [OPEN] Heo trả về nhiều hơn sổ heo (lãi, hoặc tiền heo có từ trước khi dùng app vì heo mở sổ với `opening_balance = 0`): gán cả số tiền là Chuyển nội bộ thì sổ heo âm đúng phần đó; không còn lời nhắc tách lãi. Người gán tự tách dòng Thu nhập, hoặc nhập số dư đầu thật / đếm số dư heo (UC-105).

## ADR-83: Số lũy kế âm từ SePay không phải số dư ngân hàng
- Date: 2026-10-03 · Status: superseded by ADR-87 (bỏ hẳn số lũy kế — số dương cũng lệch gốc)
- Plan ID: — · Context: ledger (đối soát — UC-106) + ingest (lớp 1 feed — UC-308)
- Source: chủ nhà 2026-10-03 — "sao chỗ này lại lệch như này? Xử lí đi chứ" (ảnh "Lệch 840.000 ₫" ở MB chi tiêu (vợ))
### Context
Chủ nhà thấy "Lệch đối soát · MB chi tiêu (vợ) · Lệch 840.000 ₫ · Có giao dịch chưa vào sổ" ("sao chỗ này lại lệch như này?"). Đọc DB thật: 4 log SePay của vợ mang `accumulated` −540.000 → −560.000 → −581.000 → −590.000. Chênh giữa các log khớp đúng từng số tiền (−20.000, −21.000, −9.000), nhưng giá trị tuyệt đối âm, trong khi số dư thật khoảng 250.000 (sổ 250.000, `book_drift` 0, không log nào chờ gán). Tức là SePay gửi một số **lũy kế lệch gốc**, không phải số dư; `feed_drift` = −590.000 − 250.000 = −840.000 là lệch giả.
### Decision
`v_account_bank.bank_balance` coi `accumulated` **âm** ở tài khoản không phải thẻ tín dụng (`kind <> 'credit'`) là "ngân hàng không báo số dư", như `accumulated = 0` — `feed_drift` thành NULL, không cảnh báo. Thẻ tín dụng giữ số âm (dư nợ). Migration 0021 dựng lại view; schema v1.21.
**Phương án bị loại:**
- **Bắt chủ nhà tắt "so số dư ngân hàng" cho từng tài khoản**: thêm một công tắc người nhà không hiểu; số âm ở tài khoản thanh toán thì chắc chắn sai, máy tự nhận ra được.
- **Tự hiệu chỉnh độ lệch gốc** (lấy log đầu tiên làm mốc): đoán gốc từ dữ liệu sẽ che cả webhook sót thật trước log đầu tiên.
- **Ghi điều chỉnh sổ cho khớp số SePay**: sổ đang đúng (đối chiếu với giao dịch thật); sửa sổ theo số sai là làm hỏng sổ.
### Consequences
Tài khoản đó mất lớp đối soát với số dư ngân hàng (lớp 1) tới khi SePay gửi số dương; lớp 2 (`book_drift`) và cảnh báo "chưa gán" vẫn chạy. Số lũy kế dương nhưng lệch gốc vẫn báo lệch giả — xem [OPEN] ở ledger UC-106. Đếm số dư tài khoản (UC-105) vẫn là cách xác nhận số thật.
### Verified in code
`migrations/0021_bank_balance_negative_guard.sql` (view `v_account_bank`) · `docs/schema.sql` v1.21 · test `test/schema.test.ts` › "đối soát hai lớp › số lũy kế âm ở tài khoản ngân hàng không phải số dư: không so, không báo lệch giả (ADR-83)".

## ADR-84: Mua hộ người khác là phải thu; chia bill có phần mình là chi tiêu
- Date: 2026-10-05 · Status: accepted
- Plan ID: — · Context: receivable (Cho vay / Nhận lại — UC-1003) + pwa (chữ nhắc màn Gán — UC-706 bước 5b, 5c; Loại khác — UC-705)
- Source: chủ nhà 2026-10-05 — "nó là 2 nghiệp vụ khác nhau mà? 'đổi loại sang Chi tiêu › Thuốc thang' tức là tôi mua cho tôi; đây là tôi mua hộ cho bà Hoa, sau đó bà chị trả lại tiền cho tôi."
### Context
Sáng cùng ngày chủ nhà hỏi "cái mua hộ người khác là cho vay à? nếu nhóm bạn đi ăn mà chia bill thì sao?" và chữ nhắc màn Gán đã được sửa theo một luật gộp (pwa UC-706 v23, commit `a974043`): mua hộ hay trả cả bill đều ghi **Chi tiêu** đủ số, phần người khác trả lại ghi **Hoàn tiền**; nhận lại vượt số còn nợ thì gợi ý "Nếu đây là mua hộ đã ghi là Chi tiêu, chọn Hoàn tiền thay vì Nhận lại tiền cho vay." (change `261004-gan-tham-chieu`). Luật gộp đó ngược với chính receivable UC-1002 bước 1b (trả hộ = `lend`, không phải chi tiêu của hộ). Áp vào ca thật (mua thuốc hộ người nhà 244.000, người ta chuyển lại 250.000) thì chủ nhà chỉ ra đó là hai nghiệp vụ khác nhau: Chi tiêu › Thuốc thang nghĩa là nhà mình mua cho nhà mình; mua hộ là ứng tiền cho người khác rồi người ta trả — trong kế toán là một khoản phải thu, không phải chi phí của nhà.
### Decision
Phân theo câu hỏi **nhà mình có phần trong khoản chi không**:
- **Mua hộ / trả hộ người khác, nhà mình không có phần** → lúc chi: **Cho vay** (`lend`, sổ phải thu, gắn người); lúc người ta trả: **Nhận lại tiền cho vay** (`collect`), chọn đúng lần cho vay (`link_id`). Trả **dư** (244.000 → 250.000): tách dòng — Nhận lại 244.000 + **Thu nhập** 6.000 (phần dư là tiền mới của nhà, được chia). Trả **thiếu** (240.000): Nhận lại 240.000; 4.000 còn treo ở sổ phải thu.
- **Chia bill mà nhà mình có phần** (đi ăn nhóm, mình trả cả bill) → **Chi tiêu** cả bill; phần người khác chuyển lại → **Hoàn tiền** chỉ khoản bill (`refund` + `link_id`). Danh mục còn đúng phần nhà mình.
- **Shop / dịch vụ hoàn tiền** cho khoản nhà mình mua → **Hoàn tiền**.
- **Cho mượn tiền thật** → Cho vay / Nhận lại, như cũ (ADR-72).
PWA nói luật này ở chữ nhắc dưới chip "Gán thành" (`ASSIGN_CHOICES`) và ở dòng gợi ý khi nhận lại vượt số còn nợ (`overpaidHint`: "Trả dư X? Bấm Tách thêm dòng: Nhận lại đúng số còn nợ, phần dư ghi Thu nhập." — Loại khác: ghi riêng một khoản Thu nhập; Hoàn tiền chỉ còn được gợi ý cho chia bill nhà mình có phần). Server không đổi: tách log thành `collect` + `income` đã được nhận.
**Phương án bị loại:**
- **Mua hộ ghi Chi tiêu, phần trả lại ghi Hoàn tiền** (luật gộp của UC-706 v23): lẫn tiền của người khác vào chi tiêu nhà mình — danh mục sai (Thuốc thang có khoản không phải của nhà), báo cáo chi phồng lên lúc mua rồi xẹp xuống lúc người ta trả (có khi sang tuần / tháng khác), ví của danh mục bị trừ tạm bằng tiền nhà không tiêu; trả dư thì phần dư thành "chi âm" trong danh mục thay vì thu nhập.
- **Mọi khoản trả lại đều ghi Nhận lại tiền cho vay, kể cả chia bill**: bill có phần nhà mình thì cả bill không phải phải thu — phần nhà mình là chi tiêu thật, phải vào danh mục.
### Consequences
Người ghi phải tự trả lời "nhà mình có phần không" lúc chi; mua hộ cần chọn người ở ô Cho ai vay. Phần dư khi trả dư thành Thu nhập và được chia như mọi khoản thu. Khoản mua hộ lỡ gán Chi tiêu từ giao dịch ngân hàng thì **Gán lại** (pwa UC-715, ADR-73) thành Cho vay rồi gán khoản trả là Nhận lại.
- [OPEN] Trả **thiếu** (mua hộ 244.000, người ta trả 240.000): phần thiếu 4.000 treo ở sổ phải thu (còn nợ 4.000). Xoá bằng **Chỉnh** ở sổ phải thu (receivable UC-1004) chỉ sửa sổ nhớ — chưa có cách ghi phần thiếu thành một khoản chi của nhà (trừ ví, vào danh mục). Cần thiết kế riêng; chủ nhà chưa quyết.
### Verified in code
`web/src/lib/splits.ts` › `ASSIGN_CHOICES` · `web/src/lib/receivables.ts` › `overpaidHint`, `receivableEffect` · `web/src/screens/ref-pickers.tsx` › `ReceivablePicker` (`split`) · test `test/logs.test.ts` › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › mua hộ là cho vay (ADR-84): trả dư thì tách Nhận lại đúng số còn nợ + Thu nhập phần dư — hết nợ, phần dư chia được, chi tiêu không đổi"; `web/src/lib/splits.test.ts`, `web/src/lib/receivables.test.ts`.

## ADR-85: "Tiền chi được" = tiền thật ở tài khoản đang tính − Tích sản và Thuế còn giữ; heo đất không trừ hai lần
- Date: 2026-10-06 · Status: accepted
- Plan ID: — · Context: ledger (`snapshot.spendableCash` — UC-103 bước 7b) + access (`accounts.spendable` — UC-506 3f) + pwa (card Hôm nay — UC-702 5b; ô ở sheet tài khoản — UC-709 6a)
- Source: chủ nhà 2026-10-06 — "tôi muốn nhìn ngay ở trang chủ vào là tôi còn lại thực tế là bao nhiêu tiền có thể chi tiêu (dựa trên tiền thật của các tài khoản của tôi nhé), không nói dựa trên tổng tài sản"; trả lời ba câu hỏi: tài khoản nào → **chọn từng tài khoản**; phần phải giữ → **trừ Tích sản + Thuế còn giữ**; chỗ đặt → **tách thành 1 section báo cáo** (change [`261006-tien-chi-duoc`](changes/archive/261006-tien-chi-duoc/proposal.md))
### Context
Hôm nay chỉ có "Còn để chi tuần này" (tổng phong bì — số ngân sách) và các số ví. "Tiền thật đang có" (`netWorth.cash`, tab Nợ) là tổng mọi tài khoản, gồm heo đất, tiền Tích sản, Thuế, tài khoản tiết kiệm không định tiêu. Không chỗ nào trả lời "trong tài khoản có bao nhiêu tiền tiêu được thật". Heo đất là tài khoản khóa và tiền heo là tiền Tích sản (ADR-82) — trừ đủ Tích sản trong khi heo đã không tính là đếm hai lần.
### Decision
```
Tiền chi được = Σ số dư sổ tài khoản đang tính − Tích sản đang giữ − Thuế đang giữ
  tài khoản đang tính = active, locked = 0, spendable = 1
  heo                 = max(0, Σ số dư sổ tài khoản locked = 1)
  Tích sản đang giữ   = max(0, tichsanCash) − min(heo, max(0, tichsanCash))
  Thuế đang giữ       = max(0, Σ số dư ví phe tax mà người xem thấy)
```
Số dư là **số dư sổ** (`v_account_book`), không phải số ngân hàng báo; âm được phép (app nói "thiếu X ₫"). Tính ở server trong `snapshot` (`spendableCash`) — Hôm nay đã tải snapshot mỗi lần mở và có bản lưu offline; MCP `get_snapshot` cùng số. Cờ `accounts.spendable` ("Tính vào tiền chi được"): mặc định bật; thẻ tín dụng mặc định tắt (số dư thẻ là nợ phải trả); tài khoản khóa không bao giờ tính (server chặn bật — `locked_account`; hàm tính bỏ qua dù cột là gì). Card Hôm nay kê từng tài khoản đang tính, dòng trừ Tích sản / Thuế (chỉ khi ≠ 0), và "Không tính: …, heo đất (giữ X ₫ Tích sản)".
Ví dụ: MB chồng 3.200.000 + MB chi tiêu vợ 230.000 + Tiền mặt 500.000 (thẻ tín dụng −1.500.000 tắt; heo 55.000 khóa); Tích sản 2.055.000; Thuế 600.000 → 3.930.000 − (2.055.000 − 55.000) − 600.000 = **1.330.000 ₫**.
**Phương án bị loại:**
- **Thêm vào `GET /v1/networth`**: Hôm nay không tải networth — thêm một request mỗi lần mở app, không có bản lưu offline.
- **Trừ đủ Tích sản (hoặc tính heo vào tài khoản rồi trừ Tích sản)**: heo là Tích sản (ADR-82) — đếm hai lần.
- **Coi số dư tài khoản trú của ví Tích sản / Thuế (`wallets.account_id`) là tiền của ví khi tài khoản đó tắt**: ví một nơi, tiền một nơi ("Chuyển sang Tích sản" chỉ đổi ví — README §6 mục 5); tài khoản trú có thể có tiền ngoài ví (số dư đầu) → số chi được bị thổi lên. Sai về phía thấp an toàn hơn.
- **Trừ thêm ví giữ riêng, khoản thu chưa chia, nợ**: chủ nhà chỉ chọn Tích sản + Thuế.
- **Dùng số ngân hàng (SePay)**: không phải tài khoản nào cũng có; sổ là nguồn sự thật, lệch thì card nhắc "sổ lệch — xem Đối soát" (chữ theo ADR-87; trước đó "số ngân hàng khác sổ — xem Đối soát").
### Consequences
Tài khoản đang giữ tiền Tích sản / Thuế nên để **bật** (lời dặn ở sheet tài khoản) — tắt thì phần đó bị trừ hai lần. Card dùng số sổ server: khoản chờ đồng bộ chưa trừ (hero thì trừ tạm, D12). Schema v1.22 (migration 0022).
- [OPEN] Tắt một tài khoản đang giữ tiền Tích sản / Thuế (vd TCB Tích sản, MB Thuế của seed) → số thấp hơn thật đúng phần đó. Chủ nhà chọn giữ luật (lời dặn) hay app tự coi số dư tài khoản trú của ví là tiền của ví khi tài khoản đó tắt.
- [OPEN] Khoản thu chưa chia (ví Thu nhập) và ví giữ riêng (Thu cho thuê) vẫn nằm trong tiền chi được.
### Verified in code
`src/domain/snapshot.ts` › `spendableCash`, `SpendableCash`, `buildSnapshot` · `src/services/ledger.ts` › `getSnapshot` · `src/services/settings.ts` › `accountFields`, `createAccount`, `updateAccount` (`locked_account`) · `migrations/0022_accounts_spendable.sql` · `web/src/lib/spendable-cash.ts` › `spendableCashView` · `web/src/screens/today.tsx` › `SpendableCashCard` · `web/src/screens/settings-sheets.tsx` › `AccountSheet` · test `test/spendable-cash.test.ts`; `test/heo-dat.test.ts` › "tiền chi được: heo đất không tính, phần Tích sản ở heo không trừ lại (ADR-85)"; `web/src/lib/spendable-cash.test.ts`; `web/src/lib/settings.test.ts` › "tài khoản › Tính vào tiền chi được: thêm mới thì bật, thẻ tín dụng mặc định tắt; heo đất không bao giờ gửi bật (ADR-85)".

## ADR-86: Tích sản nói rõ tiền đang ở đâu và đến từ đâu: heo tách được, phần còn lại "trong các tài khoản thường"
- Date: 2026-10-06 · Status: accepted · Phần "tài khoản Tích sản dư hơn Tích sản = tiền trước khi dùng app, chưa thuộc ví nào" sửa bởi ADR-91 (số dư có sẵn vào Tích sản một lần)
- Plan ID: — · Context: pwa (tab Ví & quỹ › Tích sản — UC-707, UC-716 alt 1b, UC-711 v11) + ledger (`GET /v1/tichsan` — UC-107)
- Source: chủ nhà 2026-10-06, nhìn card Tích sản chỉ có "tiền 55k", phao và Mua tài sản: "tích sản sao đã có 55.000 vậy? tôi chưa đưa vào mà??" và "nếu là tích sản thì phải rõ là tiền nào, loại nào chứ? để ntn thì rất khó hiểu và phải đoán nó là tiền gì, đang ở đâu" (change [`261006-tich-san-ro-rang`](changes/archive/261006-tich-san-ro-rang/proposal.md))
### Context
Số 55.000 ₫ đúng sổ: 9.000 chuyển từ ví Heo đất cũ (bút toán hệ thống của migration 0020, ADR-82) + 11 lần bỏ heo của vợ (41.000) + 1 lần của chồng (5.000), tự gán theo rule heo (bỏ heo là Có thì tốt → Tích sản). Card không nói nguồn, không nói chỗ nằm; chip "một ví, hai trạng thái tiền" không giải thích gì. Ví là phần ngân sách, tài khoản giữ tiền thật: sổ biết chắc tiền ở tài khoản heo (khóa) là Tích sản (ADR-82), nhưng không theo dõi phần còn lại nằm ở tài khoản thường nào — ví Tích sản có tài khoản nhà (ADR-55) mà lệnh chuyển có thể chưa làm, "Chuyển sang Tích sản" chỉ đổi ví (README §6 mục 5).
### Decision
- **Chỗ nằm**: mỗi tài khoản heo một dòng với số dư sổ thật; phần ở heo = tổng heo dương, tối đa bằng tiền Tích sản; phần còn lại nói "Trong các tài khoản thường" (không nêu tên tài khoản). Heo dương nhiều hơn tiền Tích sản → nói phần dư "chưa thuộc ví nào" (tiền heo trước khi dùng app / lãi). Heo âm → hiện đúng số âm kèm lý do, không trừ vào Tích sản. Log bỏ / rút heo còn chờ gán (của chính heo hoặc của tài khoản có rule heo trỏ vào nó) → "còn N khoản … đang chờ gán (±X)".
- **Nguồn**: phân loại từ chính dòng sổ, không thêm cột — bỏ heo (chuyển vào, tài khoản nhận khóa), chia từ thu nhập (`fund`), quét dư cuối tháng (`system`, lô `S…`), thuế dư (lô `T…`), chuyển từ ví khác (ví đã tắt = "số dư ví … cũ"), khác; ra: mua tài sản theo loại, chuyển sang ví khác. Tổng tính một `GROUP BY` ở server (`GET /v1/tichsan`), số lần đếm theo lô.
- **Loại**: Tiền và Tài sản (kèm từng loại) với số đủ ₫; bỏ chữ rút gọn trên thanh và chip "một ví, hai trạng thái tiền" (thay bằng một câu nói Tích sản là gì).
**Phương án bị loại:**
- **Nói "ở {tài khoản nhà của ví}" (vd BIDV / TCB)**: sai khi lệnh chuyển chưa làm hoặc chỉ chuyển ngân sách.
- **Theo dõi số dư ví theo từng tài khoản**: đổi mô hình sổ (ví × tài khoản), chưa ai cần.
- **Ẩn heo âm / phần heo dư cho gọn**: chủ nhà muốn "rõ là tiền nào" — giấu là phải đoán.
- **Tính nguồn ở máy khách bằng cách tải giao dịch**: phải phân trang cả sổ; "Tài sản đang giữ" đã sót vì chỉ đọc 200 dòng gần nhất.
### Consequences
Phần "trong các tài khoản thường" là con số suy ra (tiền Tích sản − phần ở heo), không phải số dư của tài khoản nào. Bút toán nạp ví của lần chia (`fund`) không hiện trong Sổ giao dịch (ledger UC-111), nên "Xem các khoản Tích sản" thiếu phần chia — tab nói rõ điều đó. Nguồn mới sau này (meaning / lô mới chạm Tích sản) rơi vào "Khác" cho tới khi được đặt tên.
- [OPEN] So mẫu rule heo trong SQL bằng `UPPER`/`INSTR`, không bỏ dấu như `matchRule`: mẫu có dấu sẽ không đếm log chờ (ledger UC-107).
### Verified in code
`src/services/ledger.ts` › `tichsanBreakdown` · `src/routes/v1.ts` › `GET /tichsan` · `web/src/lib/tichsan.ts` › `tichsanKinds`, `tichsanPlaces`, `tichsanSources` · `web/src/screens/wallets.tsx` › `TichsanTab`, `TichsanList` · test `test/heo-dat.test.ts` › "GET /v1/tichsan: Tích sản theo loại, chỗ nằm, nguồn (ADR-86)"; `web/src/lib/tichsan.test.ts` › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86)".

## ADR-87: Bỏ hẳn số lũy kế SePay; đối soát = sổ ↔ giao dịch đã gán + số dư người nhà tự nhập
- Date: 2026-10-06 · Status: accepted · Thay ADR-83; thay phần lớp 1 của ADR-25 (S4/S5); đóng [OPEN] TK một chiều của ADR-66; đổi chữ nhắc lệch ở card của ADR-85
- Plan ID: — · Context: ledger (đối soát — UC-106, snapshot UC-103) + ingest (UC-301, UC-302, UC-304, UC-308) + notify (tin sáng — UC-402) + mcp (`reconcile`) + pwa (Hôm nay — UC-702, Ví & quỹ › Tài khoản — UC-707)
- Source: chủ nhà 2026-10-06 — "tôi nghĩ là bạn bỏ phần lấy lũy kế của sepay đi, nó không đúng đâu à, bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè" (change [`261006-bo-luy-ke-sepay`](changes/archive/261006-bo-luy-ke-sepay/proposal.md))
### Context
Tài khoản `mb-spending-wife`: SePay gửi `accumulated` 1.400.000 trong khi số dư thật (chủ nhà xem app MB) là 2.000.000 và sổ khớp đúng số thật; app báo "Lệch đối soát" 600.000 ₫ giả ở Hôm nay, card Tiền chi được, Ví & quỹ › Tài khoản và tin sáng. Ba ngày trước cũng tài khoản đó gửi số **âm** (−590.000, ADR-83). Số lũy kế SePay sai ở cả hai dấu; số dương lệch gốc đúng là [OPEN] ADR-83 để lại — máy không phân biệt được với webhook sót thật. MB chưa có quan sát nào cho thấy số này đúng (ADR-57 còn treo).
### Decision
- App **không đọc, không lưu, không so** `accumulated` (webhook lẫn API lịch sử): `ParsedBankLog` bỏ trường; migration 0023 bỏ cột `bank_logs.accumulated` và view `v_account_bank`, dựng lại `v_reconcile` không còn `bank_balance` / `feed_drift`; schema v1.23. `bank_logs.raw` giữ nguyên payload gốc (bản lưu đối chiếu, không ai đọc để tính).
- Đối soát còn ba thứ: **sổ ↔ giao dịch ngân hàng đã gán** (`book_drift`), **chưa gán** (`pending_net` / `pending_count`, không phải lệch), **số dư người nhà tự nhập** (Nhập số dư / Đếm — UC-105, `cash_counts`) — nguồn "số dư thật" duy nhất, cho mọi tài khoản kể cả tài khoản SePay (tab Tài khoản có nút Nhập số dư ở mọi hàng; server vẫn từ chối khi tài khoản SePay còn giao dịch chưa gán).
- Lệch đối soát ở mọi nơi (snapshot `attention.drift`, tin sáng 🏦, banner / hàng Hôm nay, card Tiền chi được, tab Tài khoản) = `bookDrift ≠ 0`, một chữ "Sổ khác giao dịch ngân hàng đã gán" (`web/src/lib/drift.ts`). Ingest bỏ `checkReconcileDrift` — không ghi `notifications(kind='reconcile_drift')` nữa.
**Phương án bị loại:**
- **Giữ cột, chỉ ngừng so** (view trả NULL): dữ liệu sai vẫn nằm trong bảng, chờ ai đó dùng lại; chủ nhà nói "bỏ hẳn".
- **Mở rộng ADR-83: bỏ thêm số lệch quá xa** (ngưỡng): không có ngưỡng đúng — webhook sót thật cũng là chênh lớn; vẫn báo giả khi sai ít.
- **Công tắc "so số dư SePay" mỗi tài khoản**: thêm cấu hình người nhà không hiểu cho một con số đã sai ở tài khoản chính (đã loại ở ADR-83).
- **Xoá luôn `raw`**: mất bản lưu đối chiếu; `raw` không được đọc để tính gì.
### Consequences
App không còn tự phát hiện webhook sót bằng số dư — việc đó do rà soát 02:00 (ADR-23, ADR-78) và người nhà Nhập số dư khi đối chiếu app ngân hàng. `reconcile_drift` cũ nằm lại trong `notifications`, vô hại. Đã soát, **không** quyết định nào khác dựa vào `accumulated`: ADR-75 (log khớp theo số tài khoản của kết nối), ADR-76 (log trước `opened_at` theo ngày giao dịch), ADR-81 (chân thứ hai: cùng số tiền, cặp tài khoản, ≤ 10 phút), ADR-40/ADR-49 và `findPossibleTwin` (chống trùng theo `id`, `(account_id, reference_number)`, số tiền + chiều + ≤ 3 phút); số dư đầu do người nhà nhập ở Cài đặt, không có gợi ý từ SePay.
### Verified in code
`migrations/0023_drop_bank_accumulated.sql` · `docs/schema.sql` v1.23 · `src/services/ingest.ts` › `ParsedBankLog`, `parseWebhookPayload`, `parseHistoryRow`, `ingestLog` · `src/services/ledger.ts` › `reconcile`, `getSnapshot` · `src/domain/snapshot.ts` › `buildSnapshot` (`attention.drift`) · `src/cron/daily.ts` · `web/src/lib/drift.ts` › `driftOf`, `DRIFT_LABEL` · `web/src/screens/wallets.tsx` › `AccountsTab`, `AccountsWide` · test `test/migrations/milestones.test.ts` › "migrations › 0023 bỏ số lũy kế SePay trên DB đang có log: log và bản thô giữ nguyên, view đối soát chạy lại (ADR-87)"; `test/webhooks.test.ts` › "nối trọn: webhook → rule mã → transaction › số lũy kế SePay gửi kèm sai hẳn số dư thật → không lưu, không báo lệch đối soát ở đâu cả (ADR-87)"; `test/ingest.test.ts` › "số lũy kế SePay gửi kèm không được lưu hay so (ADR-87) › webhook mang accumulated lệch hẳn sổ → log ghi bình thường, không cờ reconcile_drift, raw giữ nguyên payload"; `test/logs.test.ts` › "lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán (ledger UC-103, UC-106 — ADR-87) › snapshot và /v1/accounts: lệch khi bookDrift ≠ 0; log chưa gán (bookDrift 0) và tài khoản không có log (null) không lệch; không còn số ngân hàng báo"; `web/src/lib/drift.test.ts`.

## ADR-88: Tài khoản Tích sản (heo, phao dự phòng, sổ tiết kiệm): chuyển vào từ tài khoản thường là vào Tích sản; Tiền chi được không trừ lại phần ở đó
- Date: 2026-10-06 · Status: accepted · Tổng quát ADR-82 (luật heo từ rule thành luật của tài khoản); sửa ADR-85 (`tichsanInLocked` → `tichsanOutside`); mở rộng ADR-86 (chỗ nằm / nguồn) · Phần "số dư phao / sổ có trước khi dùng app không phải Tích sản" (Consequences) sửa bởi ADR-91
- Plan ID: — · Context: ledger (nhập tay UC-101 AC-24; Tiền chi được UC-103 7b, AC-16/17; `GET /v1/tichsan` UC-107 AC-9) + ingest (ghép cặp, rule UC-303 AC-22; rule phao → heo UC-307) + access (`accounts.role` UC-506 3g, AC-17…19) + pwa (UC-702 AC-12, UC-707 AC-21, UC-709, UC-705, UC-706) + receivable (UC-1005 `tichsanAccounts`)
- Source: chủ nhà 2026-10-06 về `mb-savings-wife` — "tài khoản phao dự phòng của nhà tôi: thường là tôi sẽ chuyển khoản tích lũy cho vợ, đến 1 ngưỡng vợ tôi sẽ gửi tiết kiệm, nếu vàng hay tài sản được giá tôi sẽ rút tiết kiệm đó ra đi mua, hoặc có sự cố gì đó thì tất toán khoản gửi tiết kiệm đó"; hai quyết định: "Tiền vào phao tự vào Tích sản (như heo đất)", "Gửi tiết kiệm có kỳ hạn = tài khoản khóa 'Sổ tiết kiệm'" (change [`261006-tai-khoan-phao`](changes/archive/261006-tai-khoan-phao/proposal.md))
### Context
Chỉ heo đất (`locked = 1`) được coi là chỗ giữ Tích sản, và chỉ rule heo mang chuyển ví Có thì tốt → Tích sản. Chuyển vào phao chỉ đổi chỗ tiền (Có thì tốt vẫn giữ số đó, Tích sản không tăng); gửi tiết kiệm có kỳ hạn không có chỗ ghi; phao để ngoài "tài khoản đang tính" thì phần Tích sản ở đó bị Tiền chi được trừ hai lần.
### Decision
- **`accounts.role`** ∈ `heo | phao | so-tiet-kiem` (NULL = tài khoản thường; schema v1.24, migration 0024); giữ `locked` = "chưa rút ngay được" với CHECK khớp hai cột (heo / sổ khóa, phao không). Heo có sẵn → `heo`; `mb-savings-wife` (prod) → phao, không tính vào tiền chi được; rule phao → heo bỏ ví. Thêm tài khoản ở Cài đặt chọn "Giữ tiền Tích sản": Không / Phao dự phòng / Sổ tiết kiệm (chỉ khi thêm; khóa; ngày gửi = `opened_at`); sửa chỉ đổi thường ↔ phao; sổ tất toán thì tắt Đang dùng.
- **Chuyển ví là luật của tài khoản**: `transfer` hai tài khoản không gửi ví, đích có `role`, nguồn không → ví `remainder` (Có thì tốt) → Tích sản (`isTichsanDeposit`, `tichsanMove` ở `src/domain/entry.ts`) — dùng cho nhập tay, gán log (`buildEntry`), ghép cặp tự động / tay, rule `transfer` không mang ví. Rút ra hay chuyển giữa hai tài khoản Tích sản (gửi phao → sổ, tất toán sổ → phao) chỉ đổi chỗ; lãi tất toán là Thu nhập (tách dòng khi gán, hoặc ghi riêng). Lệnh `PF` không đổi. PWA nhắc "Tiền vào {tên} là Tích sản: ghi xong, ví Có thì tốt chuyển sang Tích sản (như bỏ heo đất)." ở Gán và Loại khác › Chuyển nội bộ.
- **Tiền chi được** (sửa ADR-85): `tichsanOutside = min(max(0, Σ số dư sổ tài khoản có role không tính), max(0, Tích sản tiền mặt))`, `tichsanHeld = Tích sản − tichsanOutside`. Tài khoản thường tắt công tắc **không** được coi là chỗ giữ Tích sản.
- **Tích sản nói rõ** (mở rộng ADR-86): `GET /v1/tichsan` › `accounts[]` (mọi tài khoản có role, kèm `role`), nguồn `phao` / `so-tiet-kiem`; `GET /v1/networth` › `tichsanAccounts` thay `locked`. Phao khẩn cấp vẫn đếm Tích sản tiền mặt (gồm phao, sổ).

Phương án bị loại:
- **Cờ boolean "tài khoản Tích sản"**: không phân biệt heo / phao / sổ để gọi tên chỗ tiền nằm.
- **Bỏ `locked`, suy ra từ `role`**: viết lại mọi SQL / rule seed dùng `locked`; CHECK đủ giữ hai cột khớp.
- **Phao bằng rule như heo**: chuyển khoản cho vợ không có mẫu nội dung cố định; nhập tay / gán tay không đi qua rule.
- **Cột kỳ hạn / ngày đáo hạn cho sổ; màn Gửi tiết kiệm / Tất toán riêng**: chủ nhà rút khi vàng được giá hay có sự cố, không theo đáo hạn; gửi và tất toán là chuyển nội bộ sẵn có.
- **Coi mọi tiền ở tài khoản không tính (kể cả tài khoản thường tắt công tắc) là Tích sản trước**: phá AC-13 của ADR-85 (tắt tài khoản không làm tiền chi được giảm) và sai về phía cao.
### Consequences
Chuyển vào phao làm Có thì tốt giảm (có thể âm, như bỏ heo). Số dư phao / sổ có trước khi dùng app (phao prod 2.000 ₫) không phải Tích sản (như số dư đầu của heo) nhưng vẫn được tính là chỗ giữ Tích sản trong `tichsanOutside` và "Tiền đang ở đâu" — lệch tối đa đúng số đó. Không cho chọn "không chuyển ví" khi chuyển vào tài khoản Tích sản không gửi ví (muốn khác thì chọn ví tay). Khoản Loại khác chờ đồng bộ chuyển vào phao không trừ tạm Có thì tốt (server chuyển ví lúc ghi). Schema v1.24.
- [OPEN] Tài khoản thường tắt công tắc mà giữ tiền Tích sản / Thuế vẫn bị trừ hai lần (ADR-85) — đánh dấu Phao dự phòng nếu là tiền để dành Tích sản.
### Verified in code
`migrations/0024_accounts_role.sql` · `docs/schema.sql` v1.24 · `src/domain/types.ts` › `AccountRole`, `AccountRef.role` · `src/domain/entry.ts` › `isTichsanDeposit`, `tichsanMove`, `buildEntry` · `src/domain/snapshot.ts` › `spendableCash`, `SpendableCash` · `src/services/ingest.ts` › `matchLog`, `pairLogs` · `src/services/ledger.ts` › `loadRefs`, `getSnapshot`, `netWorth`, `tichsanBreakdown`, `TichsanFlowKind` · `src/services/settings.ts` › `ACCOUNT_ROLES`, `createAccount`, `updateAccount` · `web/src/lib/tichsan-accounts.ts` › `tichsanAccountLabel`, `tichsanMoveHint` · `web/src/lib/spendable-cash.ts`, `tichsan.ts`, `networth.ts`, `settings.ts`, `categories.ts` · `web/src/screens/settings-sheets.tsx` › `AccountSheet` · `web/src/screens/assign.tsx` › `TichsanMoveHint` · `web/src/screens/other-entry-sheet.tsx` · test `test/phao.test.ts`; `test/spendable-cash.test.ts` › "tiền chi được — công thức (hàm thuần) › phao và sổ tiết kiệm không tính giữ Tích sản như heo (ADR-88); tài khoản thường tắt công tắc hay thẻ tín dụng thì không — sổ không biết tiền trong đó là gì"; `test/migrations/milestones.test.ts` › "migrations › 0024 thêm accounts.role: heo đất có sẵn là 'heo'; MB tiết kiệm của vợ là phao, không tính; rule phao → heo thôi chuyển ví; CHECK giữ role khớp locked (ADR-88)"; `web/src/lib/tichsan-accounts.test.ts`; `web/src/lib/tichsan.test.ts`; `web/src/lib/spendable-cash.test.ts`; `web/src/lib/networth.test.ts`; `web/src/lib/settings.test.ts`.

## ADR-89: Chặn dò mật khẩu và khoá webhook bằng bộ đếm lần sai theo IP ở D1; Đăng xuất mọi máy bằng thế hệ phiên; header bảo mật (CSP…) cho app và API
- Date: 2026-10-06 · Status: accepted · Bổ sung ADR-18 (D6 — mật khẩu chung: thêm giới hạn lần thử và cách thu hồi phiên); bổ sung ADR-75 (khoá webhook mới ≥ 24 ký tự)
- Plan ID: — · Context: access (đăng nhập, phiên — UC-501; header — UC-503; khoá SePay — UC-508) + ingest (webhook SePay — UC-301) + notify (webhook Zalo — UC-411) + pwa (Đăng xuất mọi máy — UC-701)
- Source: chủ nhà 2026-10-06 — "kêu đội red-team vào xử lí bảo mật"; red-team 4 vai 6/10: ADV-001 (dò mật khẩu không giới hạn), INFRA-01 (webhook không giới hạn, khoá 8 ký tự, BIC tắt ở `/webhooks/*`), INSIDER-03 / ADV-002 (cookie 30 ngày không thu hồi được), SC-01 / ADV-003 (không có header bảo mật nào) (change [`261006-bao-mat-dang-nhap`](changes/archive/261006-bao-mat-dang-nhap/proposal.md))
### Context
Mật khẩu chung là cửa duy nhất vào toàn bộ số tiền của nhà; `POST /v1/session` chỉ chờ 400 ms mỗi lần sai — Worker chạy song song nên kẻ dò gửi được hàng nghìn lần mỗi phút, không ai thấy (không log). `/webhooks/sepay` và `/webhooks/zalo` mở cho mọi người (Browser Integrity Check tắt cho Zalo, ADR-80), mỗi request đọc khoá từ D1 trước khi từ chối, khoá SePay chỉ cần 8 ký tự — đoán trúng là ghi được giao dịch giả. Cookie phiên ký bằng HMAC không lưu server: đăng xuất chỉ xoá cookie ở trình duyệt, bản sao trên máy mất vẫn dùng 30 ngày; cách thu hồi duy nhất là `wrangler secret put` từ máy tính. App shell và API không có CSP, HSTS hay chặn nhúng khung, trong khi app hiện nội dung chuyển khoản do người lạ đặt.
### Decision
- **Bộ đếm lần sai** `auth_failures (scope, ip, first_at, failures)` ở D1 (migration 0025, schema v1.25; `src/services/auth-throttle.ts`): IP = `CF-Connecting-IP`; cửa sổ cố định 15 phút từ lần sai đầu; chạm ngưỡng thì chặn tới hết cửa sổ, kiểm **trước** mọi so mật khẩu / đọc khoá. `login`: 10 lần mỗi IP và trần chung 30 lần mọi IP (dò từ nhiều IP) → `429 too_many_attempts` "Sai mật khẩu quá nhiều lần, thử lại sau N phút." + `Retry-After`; giữ chờ 400 ms ở lần sai; đăng nhập đúng xoá đếm của IP đó. `webhook` (SePay + Zalo chung): 20 lần mỗi IP, **không** có trần chung (kẻ lạ không được chặn webhook thật) → 429 trước khi đọc `sepay_connections` / `config`. Mỗi lần sai log `[auth] <scope> sai: ip <ip>, lần <n> trong 15 phút` — không bao giờ mật khẩu hay khoá. Dòng quá hạn xoá ở lần sai kế tiếp.
- **Khoá webhook SePay đặt mới ≥ 24 ký tự** (`secretValue`); khoá đã lưu, kể cả `SEPAY_API_KEY`, vẫn nhận webhook.
- **Thế hệ phiên** `config` `session_epoch` (thiếu = 0): khác 0 thì trộn vào khoá ký cookie (`session:<API_TOKEN>:<APP_PASSWORD>:<thế hệ>`); thế hệ 0 giữ đúng khoá cũ nên cookie đang có vẫn dùng được tới lần thu hồi đầu tiên. `POST /v1/session/revoke-all` (cần phiên hoặc API token) tăng thế hệ → mọi cookie đã phát, mọi người, mọi máy, kể cả máy đang bấm, hết hiệu lực; ghi nhật ký và báo cả nhà (ADR-90). `API_TOKEN` (Bearer) không phụ thuộc thế hệ phiên. PWA: **Đăng xuất mọi máy** ở Cài đặt › Máy này (điện thoại) và chân thanh bên (màn rộng), luôn hỏi lại một lần.
- **Header bảo mật** một nguồn `SECURITY_HEADERS` (`src/security-headers.ts`): `Content-Security-Policy` `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `X-Frame-Options: DENY`. Worker gắn cho mọi phản hồi (middleware đầu tiên); app shell, `sw.js`, `/assets/*` do Static Assets phục vụ thẳng đọc bản chép `web/public/_headers` (test giữ hai nơi giống hệt). `connect-src` có hai origin Google Fonts vì service worker tự `fetch` font để lưu offline; không cần `'unsafe-inline'` (`style={{}}` của Preact đi qua CSSOM — đã kiểm trên Chromium, không có vi phạm).
- **Rủi ro chấp nhận**: `GET /v1/session/members` vẫn công khai (màn đăng nhập cần danh sách tên; chỉ id + tên, không số liệu).

Phương án bị loại:
- **Workers Rate Limiting binding**: đếm theo từng điểm Cloudflare, gần đúng, chu kỳ chỉ 10 / 60 giây, không chạy được trong test (`app.request` + D1 giả) — phải giả binding, test không chứng minh gì. D1 đếm đúng, test được, đủ rẻ với lượng request của nhà.
- **Chỉ dùng luật Rate Limiting / WAF của Cloudflare**: không code, nhưng cấu hình nằm ngoài repo, không test được, gói Free chỉ một luật; vẫn có thể thêm làm lớp ngoài (việc của chủ nhà).
- **Khoá theo thành viên** (sai N lần thì khoá `member_id`): id thành viên công khai — người lạ khoá được cả nhà mà không cần IP nào.
- **Đếm mọi request webhook** (60 req/phút như phase-04): SePay gửi dồn khi có nhiều giao dịch hay khi gửi lại — có thể chặn webhook thật; chỉ đếm lần **sai** thì webhook thật không bao giờ bị đếm.
- **Bảng phiên / thu hồi từng máy**: thêm bảng và một lần đọc mỗi request cho một nhà hai người; "mọi máy" đủ cho ca mất điện thoại. Thế hệ phiên **mỗi thành viên**: nút phải hỏi thêm "của ai", không giúp ca lộ mật khẩu chung.
- **Giữ máy đang bấm đăng nhập** khi thu hồi: phải phát cookie mới ngay trong request thu hồi; nút ghi "mọi máy" thì máy này cũng ra là đúng nghĩa, ít bất ngờ.
- **`hono/secure-headers`**: thêm nhiều header mặc định không cần (COOP, CORP, X-XSS-Protection…) và tách khỏi `_headers` tĩnh; một hằng số tường minh dễ so với `_headers`.
- **`'unsafe-inline'` cho style**: không cần (kiểm trên trình duyệt thật); tự lưu font trên máy chủ để bỏ Google khỏi CSP là việc riêng (red-team SC-03).
### Consequences
- Mỗi request `/v1/*` bằng cookie đọc thêm một dòng `config` (thế hệ phiên); lần sai mật khẩu ghi 3 câu (xoá dòng quá hạn, đếm IP, đếm chung), lần sai khoá webhook ghi 2 câu; IP đã bị chặn chỉ tốn một lần đọc `auth_failures`.
- Trần chung 30 lần là cái giá chấp nhận: kẻ dò nhiều IP chặn được cả nhà đăng nhập **mới** trong 15 phút; phiên đang có vẫn dùng bình thường ([OPEN] UC-501: chưa có cảnh báo khi chạm trần). Cả nhà dùng chung một IP (wifi nhà) thì 10 lần gõ sai của một người làm người kia chờ tới hết 15 phút.
- Đăng xuất mọi máy không đổi `APP_PASSWORD` / `API_TOKEN`: lộ mật khẩu thì vẫn phải đổi `APP_PASSWORD` bằng `wrangler secret put` (đổi là mọi phiên cũ cũng hết, như trước). Máy mất vẫn nhận thông báo đẩy tới khi gỡ máy đó ở Cài đặt › Thông báo (ADR-90).
- Khoá webhook SePay cũ ngắn hơn 24 ký tự vẫn chạy — nên đặt lại khoá dài trong SePay rồi dán vào app (việc của chủ nhà). Trình duyệt chỉ áp HSTS qua HTTPS (`vi-nha.example`), `includeSubDomains` chỉ phủ tên miền con của `vi-nha.example`.
- Log Workers có IP người sai mật khẩu / khoá (Cloudflare vốn đã ghi IP mỗi request); không có mật khẩu hay khoá.
- Thêm nguồn bên ngoài vào app (ảnh, font, script, API khác) phải sửa cả `SECURITY_HEADERS` lẫn `web/public/_headers` (test báo nếu lệch). Bản app shell trong cache service worker cũ chưa có CSP tới lần cập nhật service worker đầu tiên (mỗi bản build đổi phiên bản).
### Verified in code
`migrations/0025_auth_failures.sql` · `docs/schema.sql` v1.25 · `src/services/auth-throttle.ts` › `THROTTLE_LIMITS`, `THROTTLE_WINDOW_S`, `clientIp`, `blockedFor`, `recordFailure`, `clearFailures` · `src/routes/session.ts` › `session.post("/")`, `session.post("/revoke-all")` · `src/routes/auth.ts` › `sessionEpoch`, `sign`, `issueSession`, `revokeAllSessions`, `readSession` · `src/routes/webhooks.ts` › `webhooks.post("/sepay")`, `webhooks.post("/zalo")` · `src/services/settings.ts` › `secretValue` · `src/security-headers.ts` › `SECURITY_HEADERS`, `securityHeaders` · `src/index.ts` (`app.use("*", securityHeaders)`, `app.notFound`) · `web/public/_headers` · `web/src/state/store.ts` › `logout` · `web/src/ui/shell.tsx` › `useLogout`, `signOutEverywhereNote`, `Sidebar` · `web/src/screens/settings.tsx` › `DeviceCard` · `web/src/screens/settings-sheets.tsx` › `SECRET_INFO`, `SepayConnectionSheet` · test `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › chặn dò mật khẩu (ADR-89) › sai tới lần thứ 10 trong 15 phút từ một IP → 429 kể cả khi đúng mật khẩu; IP khác vẫn vào được; log đếm, không có mật khẩu", "… › hết 15 phút thì được thử lại; đăng nhập đúng xoá đếm của IP đó", "… › trần chung: 30 lần sai từ nhiều IP trong 15 phút thì mọi IP tạm không đăng nhập được"; `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › đăng xuất mọi máy (ADR-89) › mọi cookie đã phát (mọi người, cả máy đang bấm) hết hiệu lực; đăng nhập lại được; API token không bị ảnh hưởng", "… › cần đăng nhập: không cookie, cookie giả hay gửi form thường đều bị chặn, phiên không đổi"; `test/webhooks.test.ts` › "chặn dò khoá webhook theo IP (ADR-89) › sai khoá lần thứ 20 trong 15 phút → mọi webhook từ IP đó 429 trước khi đọc khoá, kể cả khoá đúng; IP khác vẫn vào", "… › khoá Zalo sai cũng được đếm; hết 15 phút thì IP đó gửi lại được"; `test/app.test.ts` › "header bảo mật (ADR-89) › API, webhook và app shell qua Worker đều mang CSP, HSTS, nosniff, chặn nhúng khung — kể cả phản hồi lỗi", "… › web/public/_headers (app shell do Static Assets phục vụ thẳng) giống hệt header Worker gắn"; `test/settings.test.ts` › "khoá kết nối SePay / Telegram › khoá webhook SePay mới cần ít nhất 24 ký tự; khoá ngắn đã lưu từ trước vẫn nhận webhook (ADR-89)"; `test/schema.test.ts` › "migrations › 0025 thêm auth_failures: mỗi phạm vi + IP một dòng, phạm vi lạ và số lần ≤ 0 bị chặn (ADR-89)".

## ADR-90: Kênh báo tin chỉ thêm được qua đường kiểm soát và luôn báo cả nhà; nhật ký thay đổi chỉ thêm; gợi ý khoá ≤ 25%
- Date: 2026-10-06 · Status: accepted · Bổ sung ADR-64 (Web Push: host được phép, gỡ theo id, tối đa 10 máy), ADR-80 (Zalo: phải bỏ nối trước, giới hạn mã sai), ADR-75 (đổi khoá / tắt kết nối SePay thì báo); sửa ADR-52 (gợi ý khoá 2 ký tự cuối thay 4)
- Plan ID: — · Context: access (thành viên UC-507, khoá UC-508, xem cấu hình UC-505, tài khoản UC-506, `audit_log`) + notify (UC-408, UC-410, UC-411) + ingest (gỡ gán UC-306) + ledger (huỷ/sửa UC-102) + pwa (UC-709, UC-714)
- Source: chủ nhà 2026-10-06 — "kêu đội red-team vào xử lí bảo mật"; red-team 4 vai 6/10: INSIDER-01 (kênh báo tin cài lén sống qua lần đổi mật khẩu), INSIDER-02 (đổi khoá / tắt kết nối SePay không ai biết), INSIDER-04 (không có nhật ký), INSIDER-05 (mã Zalo thử không giới hạn), INSIDER-06 (gợi ý lộ 4/8 ký tự), INFRA-05 (push host bất kỳ, không giới hạn máy, `fetch` không thời hạn) (change [`261006-bao-mat-kenh-bao-tin`](changes/archive/261006-bao-mat-kenh-bao-tin/proposal.md))
### Context
Mọi tin của app (số dư, còn để chi, giao dịch chưa gán có số tiền) đi tới mọi kênh của cả nhà mỗi lượt cron. Ai giữ được cookie hay `API_TOKEN` trong vài phút cài được kênh của mình — máy push với endpoint và khoá tự chọn, nối lại Zalo đè chat thật, sửa `tg_chat_id`, thay bot token — và kênh đó **không gắn với phiên**: đổi `APP_PASSWORD` / Đăng xuất mọi máy (ADR-89) không gỡ nó. Danh sách máy ở Cài đặt hiện nhãn do chính kẻ gian khai và không có nút gỡ. Đổi khoá webhook SePay cho phép gửi giao dịch giả từ bất kỳ đâu; tắt kết nối làm giao dịch thật bị từ chối và rơi mất. Không có dấu vết ai huỷ / sửa giao dịch hay đổi cài đặt.
### Decision
- **Push chỉ tới push service thật** (`PUSH_HOSTS` trong `src/services/push.ts`, một hằng số có test): https, cổng mặc định, không user/password, host là `fcm.googleapis.com` (Chrome, Edge Android, Samsung, Opera), `updates.push.services.mozilla.com` (Firefox), đuôi `.push.apple.com` (Safari macOS / iOS 16.4+ — Apple: "allow `https://*.push.apple.com`"), đuôi `.notify.windows.com` (Edge trên Windows, WNS). Nhãn máy rút từ header `User-Agent` của chính request đăng ký (body `user_agent` bỏ qua). Mỗi người **tối đa 10 máy** → `409 too_many_devices` (máy chuyển từ người khác cũng tính; đăng ký lại máy đã có của mình vẫn được). **Gỡ theo id** `DELETE /v1/push/subscriptions/:id`, của ai cũng được; Cài đặt có nút **Gỡ** cho mọi máy.
- **Zalo không đè**: người đã nối Zalo không tạo được mã (`409 zalo_linked`) — phải **Bỏ nối** trước (bỏ nối thì báo cả nhà và chat cũ); mã còn hạn mà người đó đã nối chat khác thì không đè. Mã sai đếm theo chat (`zalo_code_failures`): quá **5 lần / 1 giờ** thì chat đó không được thử mã tới hết giờ. Mã vẫn 6 số, hạn 15 phút.
- **Cảnh báo cả nhà** (`alertMembers` trong `src/services/audit.ts`): thêm máy push mới (hay chuyển máy sang người khác), nối Zalo, bỏ nối Zalo, đặt/đổi/bỏ `tg_chat_id`, đổi/xoá bot token Telegram / Zalo / khoá webhook Zalo, thêm kết nối SePay có khoá, đặt/đổi/xoá khoá webhook hay token SePay, tắt kết nối SePay, Đăng xuất mọi máy (ADR-89) → một tin "⚠️ <người>[ (qua API token)] vừa <việc> — nếu không phải người nhà làm, vào Cài đặt gỡ ngay." tới **mọi** kênh hiện có của mọi thành viên (Telegram, Zalo, mọi máy push; `notifyMembers` kind `security`, `day_key = audit:<id>` nên mỗi kênh đúng một lần) và tới **kênh cũ** vừa bị thay/gỡ (chat Telegram, chat Zalo). Gửi trong `waitUntil` sau khi trả lời; lỗi gửi chỉ ghi log. Đổi bot token: cảnh báo đi bằng token mới.
- **Nhật ký thay đổi** `audit_log (id, at, member_id, via, action, target, detail)` (migration 0026, schema v1.26): `via` = `session` (PWA) | `token` (`API_TOKEN`, người do `X-Member-Id` chọn) | `mcp` (dành sẵn — MCP chưa có việc nào trong danh sách); `detail` là JSON chỉ có **tên trường** và giá trị không bí mật (không bao giờ khoá/token); trigger chặn UPDATE/DELETE. Ghi cho: `tx.void`, `tx.replace`, `tx.unassign`, `account.create|update`, `member.update`, `member.zalo_code`, `member.zalo_link` (ghi người tạo mã — `zalo_link_codes.created_by/created_via`), `integrations.update { set, cleared }`, `sepay.create|update { fields, active }`, `push.add|remove { member_id, device }`, `session.revoke_all`. Ghi **sau** khi việc chính thành công; việc lỗi không ghi. `GET /v1/settings/audit` → 50 dòng mới nhất; Cài đặt › Nâng cao › **Nhật ký thay đổi**.
- **Gợi ý khoá 2 ký tự cuối** (khoá ≥ 8 ký tự; ngắn hơn thì "••") — không bao giờ quá 25% khoá.
- **Mọi `fetch` gửi tin có thời hạn 10 giây** (`SEND_TIMEOUT_MS`): push, Telegram (`sendTelegram`), Zalo (`callZalo`); hết giờ tính như lỗi mạng (luật thử lại giữ nguyên).
- **Rủi ro chấp nhận (không làm lần này)**:
  - SC-02 — khoá Telegram/Zalo/SePay và khoá VAPID lưu thẳng trong D1, bản `wrangler d1 export` mang theo: mã hoá cần một khoá ngoài D1 (`wrangler secret`) và đổi mọi chỗ đọc khoá; nhà hai người, bản sao lưu chỉ nằm trên máy chủ nhà. Backlog: mã hoá AES-GCM bằng khoá trong `wrangler secret`, hoặc sao lưu bỏ bảng khoá.
  - SC-03 — Google Fonts tải từ máy chủ Google (lộ IP/UA, CSS bên ngoài): đã bị CSP (ADR-89) giới hạn chỉ CSS/font; tự lưu font là việc giao diện riêng. Backlog.
  - INSIDER-07 — `MCP_SECRET` nằm trong đường dẫn `/mcp/<secret>`, Workers Logs của Cloudflare ghi URL: chỉ người có quyền vào tài khoản Cloudflare đọc được (người đó vốn đã đọc được D1); đổi sang header phải cấu hình lại connector Claude. Backlog: nhận `Authorization: Bearer` cho MCP, xoay `MCP_SECRET` định kỳ.
  - `X-Member-Id` / `by_member_id` vẫn do người giữ token chọn — nhật ký ghi `via: token` để phân biệt với PWA.

Phương án bị loại:
- **Nhập lại mật khẩu khi đổi khoá / kênh (step-up)**: mật khẩu là của chung cả nhà; người đã lộ mật khẩu qua được ngay, còn người nhà phải gõ lại mỗi lần — chỉ thêm phiền, không thêm an toàn. Báo cả nhà thì người bị chiếm quyền **biết**.
- **Quá 10 máy thì gỡ máy cũ nhất**: kẻ gian đăng ký 10 máy là đẩy máy thật của nạn nhân ra mà không ai thấy; từ chối thì không mất gì của ai.
- **Nối Zalo lại thì báo chat cũ rồi đè**: nạn nhân vẫn mất kênh, chỉ biết sau; bắt bỏ nối trước thì có hai lần báo và bỏ nối cũng báo chat cũ.
- **Ghi nhật ký trong cùng `db.batch` với việc chính**: phải sửa chữ ký mọi hàm dịch vụ (ledger, ingest, settings) để trả câu lệnh thay vì chạy; mất một dòng nhật ký khi Worker chết đúng giữa hai câu là rủi ro nhỏ hơn nhiều so với thay đổi đó.
- **Ghi cả giá trị cũ/mới vào nhật ký**: dễ lọt khoá (body có khoá) và tên người thuê/ghi chú; tên trường đủ để biết đổi gì, giá trị xem ở Cài đặt.
- **Mã Zalo 8 ký tự chữ + số**: người lớn tuổi gõ lại trong Zalo khó hơn; 5 lần sai mỗi chat mỗi giờ đã đưa việc dò về hàng chục nghìn tài khoản Zalo.
### Consequences
- Máy push của trình duyệt khác (push service lạ, tự dựng) không đăng ký được nữa — bốn họ trình duyệt chính đều nằm trong danh sách; trình duyệt mới phải thêm host vào `PUSH_HOSTS` (test liệt kê).
- Mỗi thay đổi kênh/khoá tốn thêm một tin trên mỗi kênh (Zalo gói miễn phí 3.000 tin/tháng); chưa ai có kênh nào thì cảnh báo không tới ai. Người làm thay đổi cũng nhận cảnh báo của chính mình.
- Nối Zalo cho người đã nối giờ là hai bước (Bỏ nối Zalo → Nối Zalo). Chat nhắn sai mã 5 lần phải chờ 1 giờ, kể cả người nhà gõ nhầm.
- Nhật ký lớn dần không dọn (vài dòng mỗi ngày); không sửa/xoá được kể cả bằng migration thường — muốn dọn phải bỏ trigger trong migration riêng.
- Gợi ý khoá cũ "••••ab12" thành "••••12" — khó nhận ra khoá nào hơn, đổi lại không lộ khoá.
### Verified in code
`migrations/0026_audit_log.sql` · `docs/schema.sql` v1.26 · `src/services/audit.ts` › `audit`, `listAudit`, `alertMembers`, `recordChange`, `afterResponse`, `actorOf`, `fieldNames` · `src/services/push.ts` › `PUSH_HOSTS`, `isPushEndpoint`, `MAX_DEVICES_PER_MEMBER`, `SEND_TIMEOUT_MS`, `subscribe`, `unsubscribe`, `removeSubscription`, `sendPush` · `src/routes/push.ts` › `pushRoutes.post("/subscriptions")`, `.post("/subscriptions/remove")`, `.delete("/subscriptions/:id")` · `src/services/zalo.ts` › `createZaloLinkCode`, `handleZaloUpdate`, `ZALO_CODE_MAX_FAILURES` · `src/notify/telegram.ts` › `sendTelegram` · `src/notify/zalo.ts` › `callZalo` · `src/services/secrets.ts` › `describeValue` · `src/routes/settings.ts` › `.get("/audit")`, `.patch("/members/:id")`, `.post("/members/:id/zalo-code")`, `.put("/integrations")`, `sepayAlert`, `.post("/sepay/connections")`, `.patch("/sepay/connections/:id")`, `.post("/accounts")`, `.patch("/accounts/:id")` · `src/routes/v1.ts` › `/transactions/:id/void`, `/transactions/:id/replace` · `src/routes/logs.ts` › `/logs/transactions/:txId/void` · `web/src/screens/settings.tsx` › `PushNotifications`, `AuditLog` · `web/src/lib/settings.ts` › `secretLabel`, `auditView` · `web/src/state/push.ts` › `upload` · tests: `test/audit.test.ts`, `test/push.test.ts` › "đăng ký máy", `test/zalo.test.ts` › "mã nối Zalo", `test/schema.test.ts` › "0026 …"

## ADR-91: Số dư có sẵn của tài khoản Tích sản vào Tích sản một lần, không lấy từ ví nào; phần đã là Tích sản không tính lại
- Date: 2026-10-07 · Status: accepted · Sửa phần "số dư có trước khi dùng app không phải Tích sản" của ADR-86 (chỗ nằm) và ADR-88 (Consequences); giữ cơ chế bút toán hệ thống chỉ đổi ví của ADR-82
- Plan ID: — · Context: ledger (migration 0027, nguồn `opening` của `GET /v1/tichsan` — UC-107) + access (thêm / sửa tài khoản — UC-506 3g') + pwa (tab Tích sản — UC-707; sheet tài khoản — UC-709)
- Source: chủ nhà 2026-10-07, sau khi nhìn tab Tích sản ("sai gì đó nè"), chọn trong ba phương án: "Chuyển phần còn trong heo/phao vào Tích sản (một lần)" — "Sau này mở phao/sổ mới có sẵn tiền cũng làm vậy." (change [`261006-so-du-co-san-vao-tich-san`](changes/archive/261006-so-du-co-san-vao-tich-san/proposal.md))
### Context
Sau khi nhập số dư đầu thật của hai heo (Chồng 425.000, vợ 235.000 tính tới 1/10; 3–4/10 đã rút 400.000 + 190.000 về tài khoản thường), các tài khoản Tích sản có 135.000 ₫ (heo 30.000 + 95.000, phao 10.000) mà Tích sản chỉ 55.000 ₫ (đều là bỏ heo qua app). Lý do: theo ADR-86 / ADR-88, số dư có trước khi dùng app không thuộc ví nào. Tab Tích sản phải giải thích hai con số bằng một câu riêng. ADR-82 đã làm việc tương tự cho ví Heo đất cũ, nhưng lúc đó có ví nguồn; tiền trước khi dùng app thì không nằm trong ví nào.
### Decision
- **Bút toán**: `transfer`, `source = 'system'`, chỉ có `wallet_id` = ví Tích sản (dòng đầu `v_tichsan`, như snapshot). Không ví nguồn nên Có thì tốt không đổi. Không tài khoản nên số dư sổ không đổi. `batch_id` bắt đầu bằng `O` (`GET /v1/tichsan` gọi là nguồn `opening`, "Số dư có sẵn khi mở tài khoản").
- **Số tiền**: chỉ phần làm tài khoản Tích sản không tính nhiều hơn Tích sản tiền mặt. Phần Tích sản đang nằm ở tài khoản thường coi như đã chuyển vào đây — cùng giả định với `tichsanOutside` (ADR-88). Nhờ đó phần ghi thêm luôn nằm gọn trong `tichsanOutside` và **Tiền chi được không đổi** vì bút toán.
  - Một lần cho dữ liệu đang có (migration 0027, schema v1.27): **một** dòng tổng `max(0, max(0, R) − max(0, C))`, `batch_id = 'O:0027'`, R = Σ số dư sổ tài khoản Tích sản không tính, C = Tích sản tiền mặt. `at` = lúc chạy, kỳ theo giờ VN. Không ghi lại nếu đã có `O:0027`.
  - Về sau (Cài đặt): tài khoản **thành** tài khoản Tích sản không tính (thêm phao / sổ, sửa thường → phao) với số dư sổ B > 0 → `min(B, max(0, max(0, R + B) − max(0, C)))` (`openingTichsanCredit`), ghi cùng `db.batch` với thay đổi tài khoản. `batch_id = 'O:<tài khoản>:<at>'`.
- **Đổi phao về thường không gỡ bút toán**: tiền đã là tiền để dành. Rút ra cũng chỉ đổi chỗ, như ADR-82. Đổi lại sang phao thì R + B ≤ C nên không ghi thêm.

Phương án bị loại:
- **Giữ luật (số dư có sẵn không phải Tích sản)**: chủ nhà không chọn; tab Tích sản phải mang hai con số.
- **Coi cả số dư đầu là Tích sản (670.000)**: 590.000 đã rút về tài khoản thường sẽ thành "Tích sản trong tài khoản thường", Tiền chi được giảm 590.000, trong khi chủ nhà đã định tiêu số đó.
- **Lấy từ Có thì tốt**: ví âm thêm như đã tiêu, dù không ai tiêu.
- **Migration một dòng cho từng tài khoản**: sổ không biết phần nào của từng tài khoản đã là Tích sản; chia ra là bịa. Tab Tích sản đã kê số dư từng tài khoản.
- **Ghi `counter_account_id` để biết tài khoản**: làm sai số dư sổ của tài khoản đó (`v_account_book` cộng mọi dòng chạm tài khoản).
- **Ghi đủ B dù Tích sản đang ở tài khoản thường**: Tiền chi được giảm đúng phần đó (tiền tiêu được bị coi là Tích sản lần hai).
- **Gỡ bút toán khi đổi phao về thường**: biến tiền để dành thành tiền tiêu chỉ bằng một công tắc cấu hình.
### Consequences
Prod sau 0027 (theo số lúc quyết): một dòng 80.000, Tích sản 55.000 → 135.000 = heo + phao. Phao khẩn cấp đếm 135.000 (vẫn "dưới 0,1" tháng). Có thì tốt, Tiền chi được, số dư từng tài khoản không đổi. Câu phần dư ở "Tiền đang ở đâu" không hiện nữa; nó vẫn hiện khi còn chênh, vd lãi chưa tách. Số thật lúc chạy theo số dư lúc đó. Phao bật "Tính vào tiền chi được" không được ghi (ghi sẽ làm Tiền chi được giảm). Tài khoản Tích sản số dư âm làm R nhỏ đi, nên số ghi ít hơn — về phía an toàn. Settings trước đây không ghi sổ; nay ghi đúng một loại bút toán này. `GET /v1/settings` › `accounts[].book_balance` cho sheet tài khoản nhắc trước số tiền.
### Verified in code
`migrations/0027_so_du_co_san_tich_san.sql` · `docs/schema.sql` v1.27 · `src/domain/snapshot.ts` › `openingTichsanCredit` · `src/services/ledger.ts` › `tichsanOpeningEntry`, `tichsanBreakdown` (`opening`), `TichsanFlowKind` · `src/services/settings.ts` › `createAccount`, `updateAccount`, `patchStatement`, `ACCOUNT_SQL` · `web/src/lib/tichsan.ts` › `tichsanSources` · `web/src/lib/tichsan-accounts.ts` › `openingCreditHint` · `web/src/screens/settings-sheets.tsx` › `AccountSheet` · test `test/heo-dat.test.ts` › "migration 0027: số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91)"; `test/phao.test.ts` › "số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91)"; `web/src/lib/tichsan.test.ts` › "tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86) › như prod sau migration 0027 (ADR-91): số dư có sẵn là một nguồn vào; Tích sản bằng heo + phao thì không còn câu phần dư"; `web/src/lib/tichsan-accounts.test.ts` › "số dư có sẵn khi thành tài khoản Tích sản (ADR-91)".

## ADR-92: Ngôn ngữ trong mã nguồn — người đọc tiếng Việt, mã tiếng Anh
- Date: 2026-10-07 · Status: accepted · Không sửa nội dung ADR cũ: tên cũ (`tichsan`, `heo`, `phao`, `so-tiet-kiem`, `emergency_months`, `GET /v1/tichsan`, `#vi`…) trong các ADR trước là đúng tại thời điểm đó
- Plan ID: — · Context: platform (+ ledger UC-103, UC-107; access UC-505, UC-506; mcp UC-601, UC-602; pwa UC-710, UC-711; receivable UC-1005)
- Source: chủ nhà 2026-10-07 — "tôi muốn dùng thì tiếng việt, nhưng code thì chuẩn hóa tiếng Anh hết nè ? comment trong app tiếng việt được, var const các thứ, tên hàm thì eng"; "đường dẫn của API/ route cũng dùng tiếng anh nhé, chuẩn hóa thế giới đi, vì sau này AI đọc dễ support users mà"; xác nhận `buffer`, bảng địa chỉ màn, tên tool, mô tả tiếng Anh (change [`261007-doi-ten-tieng-anh`](changes/archive/261007-doi-ten-tieng-anh/proposal.md); bối cảnh mở mã nguồn: `plans/reports/researcher-261007-mo-ma-nguon.md`)
### Context
Bước đầu của việc mở mã nguồn. Giá trị lưu DB trộn hai thứ tiếng (`wallets.tier ∈ holding | tichsan | tax | nice | must`, `accounts.role ∈ heo | phao | so-tiet-kiem`, khoá `config.emergency_months`); API `GET /v1/tichsan`, snapshot `tiers.tichsan`, `emergency`; địa chỉ màn PWA tiếng Việt (`#homnay`, `#vi/tichsan`…); tên tool MCP chưa đều (`reconcile` chỉ đọc mà nghe như hành động, `allocate` không rõ chia gì), mô tả tool tiếng Việt và hai tool còn ghi sai "chưa triển khai"; khoảng 35 tên hàm / biến / kiểu và 4 file tên tiếng Việt. Chỉ có một DB thật (nhà mình), chưa ai khác dùng: đổi giá trị lưu trữ lúc này là rẻ nhất.
### Decision
- **Tiếng Việt**: chữ trên giao diện, tin nhắn, thông báo lỗi trả cho người, chú thích, tên test, specs.
- **Tiếng Anh**: tên biến / hằng / hàm / kiểu / file, giá trị lưu DB, tên trường API, đường dẫn API, địa chỉ màn PWA, tên và mô tả tool MCP. Giá trị lưu DB / API dùng `snake_case`; trường JSON và tên TypeScript dùng `camelCase` / `PascalCase` của cùng chữ.
- **Bảng tên** (chủ nhà chốt): Tích sản `wealth_building`; Heo đất `piggy_bank`; Phao dự phòng `buffer`; Sổ tiết kiệm `term_deposit`; Quỹ an tâm `safetyFund` / `safety_fund_months` (ADR-93). Địa chỉ màn `#today`, `#entry`, `#assign`, `#wallets/<budget | wealth-building | accounts | analysis | transfers | tenants | debts>`, `#ledger`, `#settings`. Tool MCP `get_reconciliation`, `get_spending_by_category`, `allocate_income`, `list_tenants`, `add_tenant_shared_expense` (16 tool).
- **Đổi một lần, không giữ tên cũ song song**: migration 0028 (schema v1.28) dựng lại `wallets` / `accounts` với CHECK mới, đổi khoá config và tên view; `GET /v1/tichsan` → 404; địa chỉ màn cũ về Hôm nay như mọi địa chỉ lạ; bản lưu offline của phiên bản trước bị bỏ.
- **Không đổi**: cách tính tiền, số liệu, mã ví / mã tài khoản / mã người do người dùng đặt (`tich-san`, `co-thi-tot`…), chữ tiếng Việt trên giao diện (trừ "Phao khẩn cấp", ADR-93), nội dung các migration đã chạy, bản ghi lịch sử (`audit_log`, `notifications.payload`).
- `docs/glossary.md` là bảng tra Việt ↔ Anh; `AGENTS.md` §5 ghi luật này.

Phương án bị loại:
- **Giữ giá trị cũ, chỉ code mới tiếng Anh + bảng tra**: chủ nhà muốn chuẩn hoá hết.
- **Chỉ đổi tên TypeScript, giữ giá trị DB / API**: một thứ có hai tên.
- **`profit` cho Tích sản**: tiếng Anh hiểu là lợi nhuận, sai nghĩa.
- **`reserve` cho phao** (bảng chủ nhà duyệt lúc đầu): trùng "ví quỹ giữ riêng" (`isReserve`, snapshot `reserves`); dùng `buffer` — phương án dự phòng chủ nhà đã nêu, chủ nhà xác nhận 2026-10-07.
### Consequences
Một migration dựng lại hai bảng trên dữ liệu thật (diễn tập trên bản export prod trước, sao lưu D1, Time Travel 30 ngày); khoảng hở vài giây giữa migrate và deploy, Worker cũ lỗi trong lúc đó — chấp nhận. Kết nối Claude phải duyệt lại quyền tool sau khi đổi tên. Bookmark địa chỉ cũ rơi về Hôm nay. Harness test chạy mỗi migration trong một transaction như D1 (`applyMigrations`). Specs giữ tên cũ trong `## History` và ADR cũ.
### Verified in code
`migrations/0028_english_names.sql` · `docs/schema.sql` v1.28 · `docs/glossary.md` · `AGENTS.md` §5 (Ngôn ngữ) · `src/domain/types.ts` · `src/services/ledger.ts` › `wealthBuildingBreakdown` · `src/routes/v1.ts` › `GET /wealth-building` · `src/services/settings.ts` (`safety_fund_months`, `one_wealth_building`) · `src/mcp/tools.ts` · `src/services/push.ts` (URL `/#today`, `/#wallets`, `/#assign`, `/#settings`) · `web/src/lib/hash-route.ts` › `TABS`, `WALLETS_TABS`, `parseHash`, `hashFor` · `web/public/manifest.webmanifest` (`/#entry`, `/#assign`) · `web/src/offline/idb.ts` › `DATA_VERSION` · `web/sw.js` (`activate` xoá `vi-nha-api`) · `test/helpers/d1-sqlite.ts` › `applyMigrations` · test `test/migrations/piggy-bank.test.ts` › "migration 0028: tên tiếng Anh trong dữ liệu"; `test/schema.test.ts` › "migrations › 0028 DB mới: CHECK tier là holding | wealth_building | tax | nice | must, role là piggy_bank | buffer | term_deposit theo locked; giá trị cũ bị từ chối"; `test/mcp.test.ts` › "giao thức MCP"; `web/src/lib/hash-route.test.ts` › "màn trong hash"; `web/src/offline/idb.test.ts` › "bản lưu của phiên bản dữ liệu trước (pwa UC-710 AC-11)" (commit `7424f26`).

## ADR-93: "Quỹ an tâm" thay "Phao khẩn cấp"
- Date: 2026-10-07 · Status: accepted · Đổi tên gọi của ngưỡng trong ADR-04 ("phao là ngưỡng tính động"); cách tính không đổi
- Plan ID: — · Context: ledger (UC-103, UC-107) + notify (UC-402) + pwa (UC-702, UC-707, UC-709) + access (UC-505, UC-507)
- Source: chủ nhà 2026-10-07 — "nên để là Quỹ an tâm thay cho Quỹ khẩn cấp nhé, ngôn từ khẩn cấp nó mang tính tai họa" (change [`261007-doi-ten-tieng-anh`](changes/archive/261007-doi-ten-tieng-anh/proposal.md))
### Context
Ngưỡng `số tháng × chi Must trung bình` hiện là "Phao khẩn cấp" ở 13 chỗ trên giao diện, trong tin Telegram ("Phao x/y tháng") và mô tả tool MCP. Chữ "phao" còn trùng với tài khoản **phao dự phòng** (ADR-88).
### Decision
Ngưỡng này gọi là **Quỹ an tâm** trên giao diện và tin nhắn; trong code `safetyFund` (snapshot `safetyFund`, config `safety_fund_months`, view `v_safety_fund` — ADR-92). Tin sáng: "Quỹ an tâm x/y tháng"; Cài đặt: "Quỹ an tâm (số tháng)". "Phao dự phòng" (vai tài khoản) giữ nguyên chữ.

Phương án bị loại: **"Quỹ khẩn cấp"** — vẫn mang nghĩa tai hoạ.
### Consequences
Hết trùng chữ "phao" giữa ngưỡng và tài khoản. Tin cũ đã gửi (`notifications.payload`) giữ chữ cũ. Hướng dẫn người dùng (GitBook) đổi chữ theo.
### Verified in code
`src/notify/format.ts` › `dailyMessage` (chip "Quỹ an tâm x/y tháng") · `src/domain/snapshot.ts` (`safetyFund`) · `web/src/screens/today.tsx`, `web/src/screens/wallets.tsx`, `web/src/screens/settings.tsx`, `web/src/screens/settings-sheets.tsx` (ô "Quỹ an tâm (số tháng)") · `web/src/lib/wealth-building.ts` · test `test/migrations/piggy-bank.test.ts` › "migration 0028: tên tiếng Anh trong dữ liệu"; `test/mcp.test.ts` › "giao thức MCP › mô tả tool không còn 'chưa triển khai' / 'phase 04', không nhắc tên tool cũ, tên cũ của Tích sản hay chữ khẩn cấp" (commit `7424f26`).

## ADR-94: Mã dữ liệu code đọc thẳng là mã hệ thống tiếng Anh; mã người dùng tạo là dữ liệu
- Date: 2026-10-07 · Status: accepted · Mở rộng ADR-92 (ngôn ngữ trong mã nguồn) sang mã dữ liệu; thay mã `chinh` của ADR-75, `tra-no` của ADR-63 / ADR-71, `cho-vay` của ADR-72, `cho-thue` của ADR-59 / ADR-63 (nội dung các ADR đó giữ nguyên)
- Plan ID: — · Context: platform (+ access UC-508, UC-509; ledger UC-101, UC-109; rental UC-801; debt UC-901, UC-902; receivable UC-1002; pwa UC-709)
- Source: chủ nhà 2026-10-07 — "phần anh/ em hay gì cũng phải đổi nhé, không dùng tên tiếng việt trong code nhé ?"; "viết lại 1 số phần UC dạng không nhắc đến tên ai cả, đích danh ai nè"; giao việc "làm tiếp đi" (change [`261007-ma-tieng-anh-an-danh`](changes/archive/261007-ma-tieng-anh-an-danh/proposal.md); lộ trình mở mã nguồn: `plans/reports/researcher-261007-mo-ma-nguon.md` §6–§7)
### Context
Bước 1 của việc mở mã nguồn, sau ADR-92. Code còn đọc thẳng vài mã dữ liệu tiếng Việt: kết nối SePay mặc định `chinh`, danh mục `tra-no` (khoản trả nợ không chọn danh mục), `cho-vay` (cho vay không chọn danh mục); nguồn cho thuê `cho-thue` nằm trong `config.rental_income_stream_id`. Bảng icon danh mục trong code (`web/src/ui/icons.tsx`) khoá theo mã danh mục của hộ mẫu **và của nhà mình**, trong khi bảng `categories` đã có cột `icon` (đang trống). Hộ mẫu "anh/em" của `migrations/0002_seed.sql` (mã tiếng Việt) là nền của 22 file test; `docs/seed.sql` chép theo nó.
### Decision
- **Mã hệ thống** — chỉ những mã này code được nhắc tới, đều tiếng Anh: kết nối SePay `default`, danh mục `debt-payment`, `lending` (hằng `DEFAULT_SEPAY_CONNECTION_ID`, `DEBT_CATEGORY_ID`, `LEND_CATEGORY_ID` ở `src/domain/system-ids.ts`, server và PWA dùng chung), nguồn cho thuê `rental` (không có hằng — code đọc `config.rental_income_stream_id`).
- **Mã người dùng tạo là dữ liệu**: ví, tài khoản, danh mục, thành viên, người thuê… của từng nhà sinh từ tên người dùng gõ; code không khoá theo chúng. Mã của nhà mình không đổi.
- **Icon là dữ liệu**: `categories.icon`; PWA vẽ icon có tên đó, tên lạ hoặc trống thì icon nhãn. Bỏ bảng icon theo mã trong code.
- Migration `0029_system_ids.sql` (schema v1.29) đổi ba mã khoá chính và mọi bảng con / giá trị config (`rental_income_stream_id`, `rental_shared_categories`), dựng lại trigger chỉ ghi thêm của `tenant_lines` y nguyên, chép icon của bảng cũ (29 dòng) vào danh mục còn trống. Không viết lại lịch sử (`audit_log` `sepay:chinh`, `notifications.payload`).
- **Hộ mẫu** `docs/seed.sql` mã tiếng Anh, tên hiển thị tiếng Việt, gồm cả dữ liệu hệ thống mà migration cũ sinh ra; test dựng DB bằng `docs/schema.sql` + `docs/seed.sql`. Test kiểm chính các migration cũ ở `test/migrations/` (ở lại repo private).
- Mã mục màn Cài đặt (định danh code) đổi sang tiếng Anh theo ADR-92 — không phải dữ liệu, không cần migration.

Phương án bị loại:
- **Giữ bảng icon theo mã trong code**: khoá code vào dữ liệu của một nhà.
- **Đổi mã mọi ví / danh mục / tài khoản của nhà mình sang tiếng Anh**: không cần — là dữ liệu riêng — và tốn migration trên mọi bảng con.
- **Giữ hộ mẫu "anh/em"**: trái luật ngôn ngữ (ADR-92).
### Consequences
Diễn tập trên bản export prod (2026-10-08, engine D1 local): chi theo danh mục, sổ nợ, sổ người thuê, sổ phải thu, số dư ví, sổ tài khoản, số dòng mọi bảng khớp trước / sau; `foreign_key_check` sạch; 17/17 danh mục có icon. Khoảng hở vài giây giữa migrate và deploy: Worker cũ không thấy `chinh`, khoản trả nợ xếp hàng offline mang `tra-no` có thể lỗi — xả hàng đợi trước khi migrate. Nhà mới có danh mục tự tạo không có icon thì thấy icon nhãn cho tới khi đặt `icon`.
### Verified in code
`migrations/0029_system_ids.sql` · `docs/schema.sql` v1.29 · `docs/seed.sql` · `src/domain/system-ids.ts` › `DEFAULT_SEPAY_CONNECTION_ID`, `DEBT_CATEGORY_ID`, `LEND_CATEGORY_ID` · `src/domain/entry.ts` › `buildEntry` (`defaultCategoryId`) · `src/services/secrets.ts` › `loadSepayConnections` · `src/services/settings.ts` · `web/src/ui/icons.tsx` › `CategoryIcon` · `web/src/ui/icon-names.ts` › `ICON_NAMES`, `isIconName` · `web/src/screens/settings.tsx` › `SECTIONS` · `test/helpers/d1-sqlite.ts` › `openDb`, `migratedDb`, `applyMigrations` · test `test/migrations/system-ids.test.ts` › "migration 0029: mã hệ thống tiếng Anh"; `test/schema.test.ts` › "seed" (commit `21b9db0`).

## ADR-95: Đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn; khoá ký phiên trong D1
- Date: 2026-10-08 · Status: accepted · Mở rộng D6 / ADR-18 (một mật khẩu chung + chọn người); giữ chặn dò và Đăng xuất mọi máy của ADR-89; thay phần "khoá ký phiên lấy từ `API_TOKEN` + `APP_PASSWORD`" (Session, access `entities.md`)
- Plan ID: — · Context: access (UC-501, UC-503, UC-505, UC-507, UC-509, UC-510 mới) + pwa (UC-701, UC-709)
- Source: chủ nhà 2026-10-07 / 08 — "mục tiêu là tôi muốn opensource con này … làm sao cho dân nontech deploy nhanh + dễ dùng"; "kiểu 2 vợ chồng tôi vẫn dùng chung mật khẩu giống nhau dc, k cần phải đổi, còn 1 số nhà thì thích riêng tư nên đổi ( chủ yếu là role con cái sau này )"; chốt 20.000 vòng băm (change [`261007-thiet-lap-lan-dau`](changes/archive/261007-thiet-lap-lan-dau/proposal.md); lộ trình mở mã nguồn: `plans/reports/researcher-261007-mo-ma-nguon.md` §3.1, §5, §7)
### Context
Bước 2 của việc mở mã nguồn. DB dựng từ `docs/schema.sql` không có thành viên nào → không đăng nhập được, không có đường nào tạo nhà ngoài sửa SQL. Đăng nhập cần hai khoá đặt tay: khoá ký phiên lấy từ `API_TOKEN` + `APP_PASSWORD`; thiếu `API_TOKEN` thì đăng nhập "thành công" nhưng phiên không bao giờ hợp lệ ([OPEN] cũ ở UC-501). Một mật khẩu chung cho mọi người — nhà khác (con cái sau này) muốn riêng tư.
### Decision
- **Mật khẩu chung** `APP_PASSWORD` là ô bắt buộc duy nhất lúc deploy; **mật khẩu riêng tuỳ chọn** cho từng người (`members.password_hash`). Người đã có mật khẩu riêng chỉ vào bằng nó; người chưa có vào bằng mật khẩu chung. Nhà đang dùng không phải đổi gì.
- Băm mật khẩu riêng: PBKDF2-SHA256, **20.000 vòng**, muối 16 byte, chuỗi `pbkdf2-sha256$<vòng>$<muối>$<băm>` — số vòng nằm trong chuỗi nên tăng sau không cần migration. Người không có mật khẩu riêng vẫn chạy một phép băm giả cùng số vòng để thời gian trả lời không lộ ai có mật khẩu riêng; câu lỗi giống nhau.
- **Thứ tự kiểm khi đăng nhập**: chặn dò → 429; chưa thiết lập → 409 `setup_required`; so mật khẩu (riêng nếu có, không thì chung) → sai 401 (đếm vào bộ chặn dò); người lạ → 400.
- **Khoá ký phiên** `config.secret:session_key` (32 byte ngẫu nhiên, app tự sinh lần đầu bằng `INSERT OR IGNORE` rồi đọc lại; không API nào trả ra). Phiên chung trộn thêm `APP_PASSWORD` vào khoá (đổi mật khẩu chung → phiên chung hết hiệu lực), phiên riêng thì không; `session_epoch` (ADR-89) luôn trộn. Cookie mang cờ chung / riêng và `members.session_gen` — **không bao giờ** mang băm. `session_gen` tăng khi đổi / gỡ mật khẩu riêng hay bị tắt → mọi phiên của người đó hết hiệu lực. `API_TOKEN` chỉ còn cho REST bằng token.
- **Đổi mật khẩu riêng**: ai biết mật khẩu chung đổi / gỡ được cho bất kỳ ai ("ai biết mật khẩu chung là người lớn của nhà"), kể cả chủ hộ quên mật khẩu; tự đổi của mình thì dùng mật khẩu đang dùng. Sai tính vào bộ chặn dò (scope `login`).
- **Thiết lập nhà lần đầu** (`/v1/setup`, UC-510) mở trước đăng nhập nhưng cần mật khẩu chung — ai mở link trước không chiếm được nhà; `APP_PASSWORD` rỗng → luôn 401.

Phương án bị loại:
- **Email** (gửi mail từ Worker cần Workers Paid, Beta, domain riêng — [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)).
- **Google OAuth**: người dùng phải tự tạo OAuth client.
- **Bắt mọi người đặt mật khẩu riêng**: nhà mình muốn giữ mật khẩu chung.
- **Người đầu tiên mở link tự đặt mật khẩu**: ai mở trước là chiếm được nhà — vì vậy thiết lập phải có mật khẩu chung từ lúc deploy.
### Consequences
PBKDF2 20.000 vòng thấp hơn khuyến nghị OWASP (600.000); bù bằng chặn dò (ADR-89), băm chỉ nằm trong D1 riêng của nhà; đo trên Cloudflare Free 2026-10-08: 20.000 vòng ≈ 5 ms CPU (50.000 ≈ 10,4 ms, 100.000 ≈ 20,5 ms) — mỗi lần đăng nhập tốn thêm ~5 ms kể cả người không có mật khẩu riêng. Deploy 2026-10-08 đổi khoá ký → mọi máy đăng nhập lại một lần. Đóng [OPEN] "`API_TOKEN` rỗng thì phiên không bao giờ hợp lệ" của UC-501. Vai `teen` giới hạn quyền làm ở change sau, dựa trên mật khẩu riêng.
### Verified in code
`migrations/0030_setup_and_member_passwords.sql` · `docs/schema.sql` v1.30 · `docs/seed.sql` (`setup_done`) · `src/services/passwords.ts` › `PASSWORD_ITERATIONS`, `hashPassword`, `verifyPassword`, `householdPasswordOk`, `memberPasswordOk`, `safeEqual` · `src/routes/auth.ts` › `SESSION_KEY`, `SIGNING_SQL`, `sign`, `issueSession`, `readSession`, `loginBlocked`, `wrongPassword` · `src/routes/session.ts` › `session.post("/")` · `src/routes/setup.ts` › `setupRoutes` · `src/services/setup.ts` › `parseSetup`, `createHousehold` · `src/routes/settings.ts` › `.put("/members/:id/password")` · `src/services/settings.ts` › `setMemberPassword` · `web/src/screens/setup.tsx` › `Setup` · `web/src/screens/settings-sheets.tsx` › `MemberPasswordSheet` · test `test/login.test.ts` › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn"; `test/setup.test.ts` › "UC-510 thiết lập nhà lần đầu"; `test/members.test.ts` › "UC-507 AC-13: đặt / đổi / gỡ mật khẩu riêng"; `test/migrations/setup-and-passwords.test.ts` (commit `1ed22e1`).

## ADR-96: Tối đa 6 người ngang quyền; tắt người không xoá dữ liệu
- Date: 2026-10-08 · Status: accepted · `role` vẫn không cấp quyền gì (như access README); bổ sung D6 (ví `private` chỉ ẩn khi chủ ví còn hoạt động)
- Plan ID: — · Context: access (UC-504, UC-507, UC-510) + pwa (UC-709)
- Source: chủ nhà 2026-10-07 / 08 — chốt "6 người", "cho tắt người còn tiền"; về ví riêng của người đã tắt: "tiền vẫn nằm trong ví, chủ hộ thấy" (change [`261007-thiet-lap-lan-dau`](changes/archive/261007-thiet-lap-lan-dau/proposal.md))
### Context
Không thêm / tắt được thành viên (chỉ có `PATCH /v1/settings/members/:id`, không sửa được `active`): nhà 1 người hay 3–4 người phải sửa SQL — trái BR-08.
### Decision
- Nhà có **tối đa 6 người đang hoạt động**, ngang quyền: người đầu lúc thiết lập là chủ hộ (`owner`), mọi người sau là `adult`. Giới hạn kiểm ngay trong câu ghi (thêm người, bật lại) nên hai yêu cầu cùng lúc không vượt được. Vai `teen` / `child` / `guest` có trong schema nhưng chưa có luật — để change sau.
- **Thêm người**: mã sinh từ tên; trùng tên hoặc trùng mã với bất kỳ ai, kể cả người đã tắt → 409. Nhật ký + báo cả nhà (như đổi kênh, ADR-90).
- **Tắt người không xoá dữ liệu**: ví, tài khoản, giao dịch giữ nguyên; mọi phiên của người đó hết hiệu lực ngay; cho tắt người còn tiền trong ví cá nhân; **ví `private` của người đã tắt không còn bị ẩn** — chủ hộ thấy và chuyển tiền ra được. Không tắt được chủ hộ. Tự tắt mình thì đăng xuất luôn. Bật lại tính vào giới hạn 6.

Phương án bị loại: **xoá thành viên** — mất dấu người ghi các giao dịch cũ (`by_member_id`) và tiền trong ví cá nhân; **chặn tắt người còn tiền** — chủ nhà chọn cho tắt, tiền vẫn thấy được.
### Consequences
Không đổi được vai và không chuyển được chủ hộ (còn [OPEN] ở UC-507). Đổi tên người qua `PATCH` chưa kiểm trùng. Tổng tầng / ví ẩn giữa các người xem đổi khi tắt / bật một người (UC-504).
### Verified in code
`src/services/settings.ts` › `MAX_ACTIVE_MEMBERS`, `createMember`, `updateMember` (`owner_required`, `session_gen`), `memberName`, `nameKey` · `src/routes/settings.ts` › `.post("/members")`, `.patch("/members/:id")` (`member.deactivate` / `member.activate`, xoá cookie khi tự tắt) · `src/services/ledger.ts` › `loadRefs` (`private` = cờ ví và chủ ví còn hoạt động) · `web/src/screens/settings.tsx` (nút Thêm người, chip "đủ 6 người") · `web/src/screens/settings-sheets.tsx` › `MemberNewSheet`, `MemberActive` · `web/src/lib/members.ts` › `MAX_MEMBERS`, `canAddMember` · test `test/members.test.ts` › "UC-507 AC-11: thêm người", "UC-507 AC-12: tắt / bật lại người", "UC-504: ví private của người đã tắt không còn bị ẩn" (commit `1ed22e1`).

## ADR-97: MCP dùng OAuth 2.1 của chuẩn MCP, bỏ đường dẫn chứa khoá
- Date: 2026-10-08 · Status: accepted · Thay ADR-30 (đường dẫn `/mcp/<MCP_SECRET>`, `@hono/mcp`, người xem mặc định là chủ hộ); giữ phần stateless của ADR-30; dùng lại chặn dò (ADR-89), nhật ký và báo cả nhà (ADR-90), luật đăng nhập (ADR-95)
- Plan ID: — · Context: mcp (UC-601…UC-605) + access (UC-501, UC-503, UC-504, UC-505, UC-507, UC-508) + pwa (UC-709, UC-710)
- Source: chủ nhà chọn phương án B ngày 2026-10-07 — "tôi nghĩ làm B đi ?"; "oke, làm luôn nhé" (2026-10-08) (change [`261008-mcp-oauth`](changes/archive/261008-mcp-oauth/proposal.md)); lộ trình mở mã nguồn: `plans/reports/researcher-261007-mo-ma-nguon.md` §5b, §5c, §7
### Context
Bước 3 của việc mở mã nguồn. Claude nối bằng `https://<host>/mcp/<MCP_SECRET>` (chế độ "No sign-in"): ai có đường dẫn là đọc hết sổ và ghi được mà không cần mật khẩu; đường dẫn dễ lộ qua ảnh chụp, chat chia sẻ. Không biết ai làm (tool đọc luôn nhìn như chủ hộ, `assign_log` ghi người làm rỗng, `via = mcp` có trong nhật ký nhưng không chỗ nào ghi); không gỡ riêng từng kết nối, không có chế độ chỉ đọc; `MCP_SECRET` do người dùng tự gõ, người không biết code không đặt được. Gói Free đủ cho OAuth: KV 1.000 lượt ghi / 100.000 lượt đọc mỗi ngày.
### Decision
- Endpoint MCP là `https://<host>/mcp` (Streamable HTTP, không giữ phiên), bảo vệ bằng **OAuth 2.1 theo chuẩn MCP authorization**: thư viện `@cloudflare/workers-oauth-provider` 1.x, lưu trong KV `OAUTH_KV`; issuer và resource lấy theo origin của chính bản cài. Metadata RFC 9728 (`/.well-known/oauth-protected-resource/mcp`) và RFC 8414 (`/.well-known/oauth-authorization-server`); không token → 401 kèm `WWW-Authenticate: Bearer resource_metadata=…`.
- Client đăng ký **chỉ bằng Client ID Metadata Document** (Claude, ChatGPT, Cursor dùng cách này); **không mở** Dynamic Client Registration — endpoint công khai ghi KV sẽ bị spam làm cạn hạn mức ghi của gói Free. PKCE bắt buộc.
- Đăng nhập ở trang uỷ quyền `/oauth/authorize` dùng **chính mật khẩu của app** (luật UC-501, bộ chặn dò scope `login`); không thêm nhà cung cấp danh tính ngoài. Chỉ sau khi đăng nhập mới ghi KV. Trang đồng ý hiện nổi bật tên miền đã xác minh của ứng dụng.
- Token mang người đã uỷ quyền: tool đọc nhìn số như người đó trên app (ví `private` của người khác bị ẩn), tool ghi ghi người đó làm người ghi / người gán, nhật ký `via = mcp`. Quyền `mcp:read` / `mcp:write` kiểm ở tầng HTTP trước transport (thiếu `mcp:write` khi gọi tool ghi → 403 `insufficient_scope`).
- Lớp phòng hậu mỗi lần gọi `/mcp`: người còn hoạt động, `session_gen` khớp, cách vào đúng, dấu mật khẩu chung (HMAC khoá `APP_PASSWORD`) còn khớp; lệch → 401 và thu hồi grant để refresh không hồi sinh.
- Cài đặt › **Claude và ứng dụng AI**: địa chỉ MCP, danh sách kết nối của cả nhà, Gỡ từng kết nối (ai đăng nhập cũng gỡ được — ADR-96). Nối / gỡ → nhật ký `mcp.connect` / `mcp.revoke` và báo cả nhà.

Phương án bị loại:
- **(A) Giữ khoá trong URL, quản lý trong app**: ai có URL vẫn vào được.
- **(C) Tắt MCP ở bản public**: mất tính năng nổi bật.
- **Giữ song song đường dẫn cũ một thời gian**: đúng là chỗ lộ cần bịt; nhà mình chỉ cần thêm lại connector một lần.
- **Mở Dynamic Client Registration**: endpoint công khai ghi KV, bị spam là cạn 1.000 lượt ghi / ngày.
### Consequences
Kết nối Claude hiện có của nhà đứt khi deploy (2026-10-08) — chủ nhà thêm lại connector với địa chỉ mới, đăng nhập, chọn quyền. `MCP_SECRET` bỏ khỏi danh sách secret; mỗi nhà cần một KV namespace (prod `vi-nha-oauth`). Access token 1 giờ, refresh trượt 60 ngày không dùng — ~2 lượt ghi KV / giờ / kết nối khi đang dùng. KV lan truyền tối đa 60 giây nên "gỡ" / "hết hiệu lực" nghĩa là trong vòng 60 giây; danh sách kết nối ở Cài đặt có thể chậm hơn (thấy > 70 giây trên prod). App cài trên iPhone có kho cookie riêng nên trang uỷ quyền mở ở trình duyệt thường vẫn phải đăng nhập. Service worker bỏ qua `/mcp`, `/oauth/*`, `/.well-known/*` để máy đã cài PWA thấy trang uỷ quyền chứ không phải app. Đóng phần "đường xác thực bằng header chưa làm" của ADR-30. Kiểm prod 2026-10-08 với client CIMD của Claude Code: đăng nhập + đồng ý → mã → token `mcp:read mcp:write` → `tools/list` 16 tool, `get_snapshot` chạy; gỡ 200.
### Verified in code
`src/oauth/server.ts` › `oauthServers`, `GrantProps`, `GrantMetadata`, `sharedStamp`, `listMemberGrants`, `revokeMemberGrants`, `revokeAllGrants`, `SCOPE_READ`, `SCOPE_WRITE` · `src/oauth/routes.ts` › `oauthRoutes` (`/authorize`, `/token`), `authorizationServerMetadata`, `mcpResource` · `src/routes/mcp.ts` › `mcpHandler` (`callsWriteTool`, `insufficientScope`) · `src/mcp/tools.ts` › `registerTools`, `WRITE_TOOLS` · `src/services/member-login.ts` › `checkLogin` · `src/routes/settings.ts` › `GET /mcp`, `DELETE /mcp/:memberId/:grantId` · `src/index.ts` (mount trước `requireAuth`, `notFound`) · `src/security-headers.ts` (`form-action`) · `src/env.d.ts` (`OAUTH_KV`, không còn `MCP_SECRET`) · `wrangler.jsonc` (`run_worker_first`, `kv_namespaces`, `global_fetch_strictly_public`) · `web/src/screens/settings.tsx` › `AiConnections` · `web/src/lib/sw-fresh.ts` › `bypassWorker` · test `test/mcp-oauth.test.ts` › "UC-601 AC-8: endpoint /mcp, metadata, chỉ CIMD", "UC-601 AC-9: trang uỷ quyền", "UC-601 AC-6, AC-11: quyền xem / ghi", "UC-602, UC-603: tool nhìn và ghi như người đã uỷ quyền", "UC-508: Cài đặt › Claude và ứng dụng AI" (commit `e5ecf41`).

## ADR-98: Quyền mặc định: Xem + Ghi, Ghi bỏ tick được; Đăng xuất mọi máy và đổi mật khẩu chung gỡ cả kết nối AI
- Date: 2026-10-08 · Status: accepted · Mở rộng ADR-89 (Đăng xuất mọi máy) và ADR-95 (`session_gen`, phiên chung) sang kết nối AI
- Plan ID: — · Context: mcp (UC-601) + access (UC-501, UC-507)
- Source: chủ nhà duyệt hai ADR nháp của change 261008-mcp-oauth (2026-10-08, "oke, làm luôn nhé"); phần gỡ kết nối khi Đăng xuất mọi máy / đổi mật khẩu chung là phương án chặt hơn do AI chọn, ghi trong proposal để chủ nhà xem lại (change [`261008-mcp-oauth`](changes/archive/261008-mcp-oauth/proposal.md))
### Context
Nhà mình dùng Claude chủ yếu để ghi khoản chi bằng lời; người muốn an toàn chỉ cần hỏi số liệu. Kết nối AI là một cửa vào sổ như phiên đăng nhập — phải tắt được cùng lúc với các nút khẩn cấp.
### Decision
- Trang đồng ý: **Xem số liệu** (`mcp:read`) bắt buộc; **Ghi giao dịch, gán, chia tiền** (`mcp:write`) tick sẵn, bỏ tick được. Thiếu quyền Ghi mà gọi tool ghi → 403 `insufficient_scope` ghi đủ hai quyền (Claude xin thêm được).
- Gỡ hết kết nối AI **của người đó**: đổi / gỡ mật khẩu riêng, tắt người (UC-507). **Đăng xuất mọi máy** gỡ kết nối của **cả nhà** (UC-501). Đổi `APP_PASSWORD` → kết nối uỷ quyền bằng mật khẩu chung hết hiệu lực (dấu lệch → 401 + thu hồi); kết nối uỷ quyền bằng mật khẩu riêng vẫn chạy.

Phương án bị loại: **mặc định chỉ Xem** — thêm một bước cho cách dùng chính; **Đăng xuất mọi máy chỉ đăng xuất phiên app** — kẻ cầm máy vẫn giữ kết nối Claude đã nối.
### Consequences
Bấm Đăng xuất mọi máy thì mọi người phải thêm / đăng nhập lại connector Claude. Người bỏ tick Ghi mà muốn ghi thì Claude xin thêm quyền, phải đồng ý lại.
### Verified in code
`src/oauth/routes.ts` (`consentPage` — ô `mcp:write` tick sẵn; `decide`) · `src/routes/mcp.ts` › `mcpHandler` · `src/routes/session.ts` › `session.post("/revoke-all")` (`revokeAllGrants`) · `src/routes/settings.ts` (`revokeMemberGrants` khi đổi / gỡ mật khẩu riêng, tắt người) · `src/oauth/server.ts` › `grantStillValid` (dấu mật khẩu chung) · test `test/mcp-oauth.test.ts` › "UC-601 AC-10: gỡ kết nối khi quyền vào đổi"; "UC-601 AC-6, AC-11: quyền xem / ghi" (commit `e5ecf41`).
