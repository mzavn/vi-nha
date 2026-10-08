# Divergences & Open Questions — toàn bộ

> Sinh tự động từ các dòng `[DIVERGENCE]` / `[OPEN]` trong `specs/`. Nguồn sự thật là file UC/ADR được link; sửa ở đó rồi sinh lại.
> `[DIVERGENCE]` = tài liệu/plan nói một đằng, code làm một nẻo — **chưa quyết bên nào đúng**. `[OPEN]` = câu hỏi chưa có câu trả lời trong repo.
> Danh sách đã lọc theo mức ảnh hưởng nằm ở `README.md` § "Hàng đợi quyết định".

## Sổ cái (ledger) — 13 divergence, 44 open

### [ledger/README.md](ledger/README.md)
- [DIVERGENCE] `migrations/0001_schema.sql` dòng 270, `docs/core_design_rules.md` §10, `plans/.../phase-01-worker-d1.md` dòng 27, `phase-03-api.md` dòng 47: SQL tập trung ở `src/db/queries.ts` — thư mục `src/db/` **rỗng**; SQL nằm trong `src/services/ledger.ts` (và một phần ở `src/cron/weekly.ts`).
- [DIVERGENCE] `plans/.../context.md` "Constraints" và `docs/core_design_rules.md` §9 "Kiến trúc": core thuần qua port `Store/Notifier/Config` — không có interface port nào trong `src/`; `src/domain/*` là hàm thuần nhận dữ liệu, `src/services/ledger.ts` gọi thẳng `D1Database`.
- [DIVERGENCE] `docs/core_design_rules.md` §10: "`schema.sql` (v1.3) … 13 bảng + 15 view" — schema hiện là v1.30 (`migrations/0030_setup_and_member_passwords.sql`), 31 bảng trong `docs/schema.sql` (thêm `allocation_runs`, rồi `income_streams`, `income_stream_locks`, `tenants`, `tenant_fixed_fees`, `tenant_lines`, `tenant_settlements`, rồi `push_subscriptions`, rồi `push_test_series`, rồi `debts`, `debt_lines`, rồi `receivables`, `receivable_lines`, rồi `sepay_connections`, rồi `zalo_link_codes`) và thêm hai trigger trên `tenant_lines`, hai trên `debt_lines`, hai trên `receivable_lines`; v1.17 chỉ thêm cột (`accounts.locked`, `rules.account_id`, `rules.counter_account_id`, `rules.from_wallet_id`), không thêm bảng; v1.18 thêm `members.zalo_chat_id` và bảng `zalo_link_codes` (ADR-80); v1.19 chỉ seed rule (mẫu heo đất `TICH LUY`, ADR-77); v1.20 chỉ đổi dữ liệu (rule heo → Tích sản, ví `heo-dat` tắt, ADR-82), không thêm bảng; v1.22 thêm cột `accounts.spendable` (ADR-85); v1.23 bỏ cột `bank_logs.accumulated` và view `v_account_bank` (ADR-87); v1.24 thêm cột `accounts.role` (tài khoản Tích sản, ADR-88), không thêm bảng; v1.25 thêm `auth_failures` (ADR-89), v1.26 thêm `audit_log` (ADR-90); v1.27 chỉ ghi bút toán `O:0027` (ADR-91); v1.28 dựng lại `wallets` / `accounts` với giá trị tiếng Anh (`wealth_building`, `piggy_bank` / `buffer` / `term_deposit`), đổi khoá `safety_fund_months`, view `v_wealth_building`, `v_safety_fund` (ADR-92), không thêm bảng; v1.29 đổi mã hệ thống `default`, `debt-payment`, `lending`, `rental` và chép icon vào `categories.icon` (ADR-94), không thêm bảng; v1.30 thêm cột `members.password_hash`, `members.session_gen` và khoá `config.setup_done` (ADR-95), không thêm bảng; dòng tiêu đề `docs/schema.sql` ghi đúng phiên bản (đúng từ ADR-75; trước đó vẫn ghi `v1.3`). Test giữ `docs/` và migrations cùng hình dạng: `test/schema.test.ts` › "migrations › chạy hết chuỗi migration ra đúng schema mô tả ở docs/ (docs là nguồn sự thật)".
- [OPEN] `accounts.opening_balance` vào số dư sổ tài khoản nhưng không vào ví nào; không có luồng nào đưa số dư mở sổ vào ngân sách, nên tổng số dư ví ≠ tổng số dư tài khoản ngay từ đầu (cộng thêm `buy_asset`, `lend`, `collect` là các loại chỉ đổi tài khoản).
- [OPEN] Append-only chỉ giữ bằng code (chỉ `UPDATE status` và `log_id_2`); DB không có trigger cấm `UPDATE`/`DELETE` trên `transactions`.
- [OPEN] `transactions.source` mặc định DB là `'sepay'`, và giá trị `'import'` được CHECK cho phép nhưng không có code nào ghi.

### [ledger/UC-101-nhap-tay-khoan-tien.md](ledger/UC-101-nhap-tay-khoan-tien.md)
- [DIVERGENCE] `plans/.../phase-03-api.md` dòng 21: "Gọi bằng bearer token thì truyền `by_member_id` trong body" — REST không đọc `by_member_id`; người ghi lấy từ `X-Member-Id` hoặc owner mặc định (`src/routes/auth.ts`). Chỉ MCP nhận `by_member_id`.
- [OPEN] D14 ghi "đề xuất sau red team 22/9, **chờ chủ nhà xác nhận**" (`plans/.../context.md` D14) nhưng code đã áp dụng.
- [OPEN] `refund` không bị chặn vào ví `holding`/`wealth_building`, và không bị giới hạn bởi số tiền khoản gốc (`buildEntry` nhánh `refund`).
- [OPEN] Gửi lại `client_id` của một dòng đã `void` vẫn trả dòng void với `duplicate: true` (tra theo `client_id`, không lọc `status`).
- [OPEN] Chuyển ngân sách dùng đúng ví được gửi, không lọc theo người nhập: qua REST/MCP một thành viên chuyển được tiền ra khỏi ví cá nhân (kể cả `private`) của người kia; chỉ PWA ẩn các ví này (`moveWallets`, pwa [UC-712](pwa/UC-712-chuyen-ngan-sach-va-bu.md)).
- [OPEN] Chặn ví Thu nhập (`locked_wallet`) chỉ áp cho chuyển ngân sách; `transfer` có tài khoản kèm ví vẫn lấy từ / chuyển vào ví Thu nhập được (nhánh có tài khoản chỉ chặn nguồn `wealth_building`).
- [OPEN] `income` có `tenant_id` mà config `rental_income_stream_id` trống/thiếu → khoản thu không có nguồn và sẽ chia theo luật % chung như lương (tiền người thuê vào ví chi tiêu, trái BR-11). Server không cho đặt config này về `null` (rental [UC-801](rental/UC-801-thiet-lap-nguoi-thue.md)) nhưng không chặn khi key bị thiếu.
- [OPEN] `taxable: true` kèm nguồn thu thì không trích Thuế (allocation UC-201 bước 2b) mà nhập tay không báo gì.

### [ledger/UC-102-huy-giao-dich.md](ledger/UC-102-huy-giao-dich.md)
- [OPEN] Huỷ một `adjust` không đụng dòng `cash_counts` trỏ về nó.
- [OPEN] Sửa không ghi ai sửa **trong sổ**: khoản mới mang người ghi của khoản cũ, không có cột "người sửa", và liên hệ cũ → mới chỉ có trong phản hồi (`replaced`), không lưu trong sổ. Từ v6 ai sửa / huỷ, lúc nào, qua đâu nằm ở `audit_log` (`tx.replace`, `tx.void` — ADR-90), không gắn vào dòng giao dịch.

### [ledger/UC-103-xem-con-bao-nhieu-de-chi.md](ledger/UC-103-xem-con-bao-nhieu-de-chi.md)
- [DIVERGENCE] `phase-03-api.md` dòng 49: "`GET /snapshot` dùng ≤ 3 query D1" — `getSnapshot` gọi `loadRefs` (một batch 9 truy vấn, từ change `261001-cho-thue-lai` thêm nguồn thu, phần khóa, người thuê, config cho thuê) + một batch 12 truy vấn (từ change `261004-gan-chua-chia` thêm khoản thu chưa chia, change `261006-tien-chi-duoc` thêm số dư sổ từng tài khoản).
- [OPEN] Cron gọi với `viewerId = null` nên mọi ví `private` bị ẩn khỏi tin Telegram; nếu một phong bì Must được đặt `private`, con số Telegram khác con số của chủ ví trên app (BR-01 "cùng một con số"). Seed hiện không có ví `private`.
- [OPEN] Quỹ an tâm ước lượng dùng tổng `monthTarget` của các dòng **không bị ẩn**; ví Must `private` của người khác không được tính.
- [OPEN] `transferOrdersOverdue` so `created_at` (UTC `datetime('now')`) với `datetime('now','-3 days')` — là khoảng thời gian, không theo ngày VN.
- [OPEN] Dự kiến tuần chia đều là `floor(tháng ÷ số thứ Hai)` nên tổng các tuần hụt tối đa (số thứ Hai − 1) đồng so với dự kiến tháng; tuần vắt qua hai tháng lấy dự kiến của tháng chứa thứ Hai, trong khi tiền nạp và dự kiến tháng tính theo tháng dương lịch.
- [OPEN] `reserves` lặp lại thông tin: ví giữ riêng (và ví Thu nhập) vẫn có dòng trong `wallets`.
- [OPEN] Tiền chi được (ADR-85): tắt một tài khoản **thường** đang giữ tiền Tích sản / Thuế (vd TCB Tích sản, MB Thuế của seed) làm phần đó bị trừ hai lần — số thấp hơn thật; sheet tài khoản dặn để bật. Từ ADR-88, tài khoản để dành tiền Tích sản nên đánh dấu Phao dự phòng (phần Tích sản ở đó không trừ lại); phần Thuế vẫn theo luật này. Chủ nhà chọn giữ luật hay coi số dư tài khoản trú của ví Tích sản / Thuế là tiền của ví khi tài khoản đó tắt.
- [OPEN] Tiền chi được vẫn gồm khoản thu chưa chia (ví Thu nhập) và ví giữ riêng (Thu cho thuê) — một phần sẽ thành Tích sản / Thuế khi chia.

### [ledger/UC-104-ngan-sach-theo-ky.md](ledger/UC-104-ngan-sach-theo-ky.md)
- [DIVERGENCE] `migrations/0001_schema.sql` dòng 268–270 và `docs/core_design_rules.md` §10: query ngân sách "nằm ở `src/db/queries.ts`" — thư mục `src/db/` rỗng; query nằm trong `src/services/ledger.ts` › `getBudget`.
- [DIVERGENCE] `phase-03-api.md` dòng 29 liệt kê `GET /wallets`, `/wallets/:id` (số dư, mục tiêu, đã chi, còn lại theo ví) — không có route này; thông tin theo ví lấy từ `/v1/snapshot` và `/v1/budget`.
- [OPEN] Kỳ tuần chỉ kiểm dạng `YYYY-Www`. Từ change `261001-cho-thue-lai`, `weekStart` ném `Error` thường với `W00` hay `W54`…`W99` → **500** `internal` thay vì `invalid_period`; `W53` của năm chỉ có 52 tuần được nhận và trả thứ Hai của tuần 1 năm sau.
- [OPEN] Ví luật `goal`/`percent` (Du lịch, Tích sản, Thuế) có dự kiến `null` ở bảng tháng nên chỉ hiện khi có chi tiêu (hoặc số dư âm).
- [OPEN] `balance` là số dư **hiện tại**, kể cả khi hỏi một kỳ đã qua; một ví đang âm hiện ở bảng của mọi kỳ.
- [OPEN] Bảng vẫn không có "đã bù X" (`deficitCovered` không lưu ở đâu) — pwa UC-707 vẫn thiếu phần này.

### [ledger/UC-105-dem-so-du-dieu-chinh.md](ledger/UC-105-dem-so-du-dieu-chinh.md)
- [DIVERGENCE] `docs/core_design_rules.md` §2: `adjust` "+ hoặc − tuỳ đặt ở `wallet_id` hay `counter_wallet_id`" (ví bất kỳ) — code luôn dùng **ví nhận phần còn lại** (Có thì tốt); không chọn được ví khác.
- [DIVERGENCE] `plans/reports/redteam-260922-0100-money-correctness.md` câu hỏi mở 2 đề xuất hai hướng (chặn hẳn, hoặc trừ phần `pending` trước khi tính lệch); code chọn chặn khi còn `pending` nhưng **vẫn cho** đếm TK có feed khi không còn log chờ — trong khi `phase-03-api.md` dòng 33 mô tả đếm cho "tiền mặt **hoặc** TK ngân hàng không có số dư feed".
- [OPEN] Bút toán `adjust` có `source='manual'` nên huỷ được qua UC-102; huỷ nó không đụng dòng `cash_counts`.
- [OPEN] Hai lần đếm song song cùng tài khoản đọc cùng `book`, cả hai đều ghi `adjust` → chênh lệch bị ghi hai lần (không có khoá; `[INFERENCE]` từ `countAccount` đọc-rồi-ghi ngoài batch).

### [ledger/UC-106-doi-soat-tai-khoan.md](ledger/UC-106-doi-soat-tai-khoan.md)
- [DIVERGENCE] `docs/core_design_rules.md` §7: "tổng các `transactions` tách ra từ một log phải **bằng đúng** `log.amount`" — `v_reconcile` so theo **tổng tài khoản**, không theo từng log; mọi giao dịch không sinh từ log (nhập tay, `adjust`, `buy_asset`, hệ thống có `account_id`) nằm ngoài phép so `book_drift` (red-team #3, `plans/reports/redteam-260922-0100-money-correctness.md`). D14 chặn nhập tay trên TK có feed.
- [DIVERGENCE] `phase-03-api.md` dòng 32: `GET/POST /accounts` "thêm TK" — `/v1/accounts` chỉ có GET; thêm TK ở Cài đặt (access UC-506).
- [OPEN] TK chưa có log nào có `book_drift = NULL`, snapshot coi NULL như 0 (`src/domain/snapshot.ts` › `attention.drift`) — red-team #4 chỉ ra TK bị trừ oan không có log thì không lộ ra.

### [ledger/UC-107-theo-doi-tich-luy.md](ledger/UC-107-theo-doi-tich-luy.md)
- [OPEN] Hai nguồn số Quỹ an tâm khác nhau khi < 3 tháng dữ liệu: `/v1/goals` và MCP `get_goals` trả `safetyFund.target = null`, còn snapshot (màn app, Telegram) trả số ước lượng — lệch với BR-05 "đúng số như app".
- [DIVERGENCE] "Mọi kỳ tính theo Asia/Ho_Chi_Minh" (`docs/core_design_rules.md` §4) — `v_goal_progress.days_left` dùng `julianday('now')` UTC, không cộng +7 giờ như `v_must_monthly_avg`.
- [OPEN] `v_goal_progress` và `v_wealth_building` không lọc `wallets.active`; `v_safety_fund` không trả dòng nào nếu thiếu `config.safety_fund_months` (JOIN chéo).
- [OPEN] `v_goal_progress.pct` không chặn 100; snapshot thì chặn (`Math.min(100, …)`).
- [OPEN] `pendingCount` của heo so mẫu rule bằng `UPPER`/`INSTR` trong SQL, không bỏ dấu như `matchRule` (`normalizeContent`): mẫu heo hiện là chữ không dấu nên khớp; mẫu có dấu sẽ không đếm log chờ (ADR-86).

### [ledger/UC-108-chi-theo-danh-muc.md](ledger/UC-108-chi-theo-danh-muc.md)
- [OPEN] `refund` không có danh mục (không gửi `category_id`, không `link_id`) được gộp vào nhóm `category_id = NULL` với giá trị âm; code trả `categoryId: null`, `name: null`.
- [OPEN] Danh mục đã tắt (`active = 0`) vẫn hiện nếu có chi — view không lọc `categories.active`.
- [DIVERGENCE] `src/services/ledger.ts` dòng 2: "REST, MCP và cron đều đi qua đây — không route nào tự viết SQL nghiệp vụ" — `src/cron/weekly.ts` tự viết lại công thức `spend − refund` theo `week_key` cho top 5 danh mục thay vì đi qua ledger.

### [ledger/UC-109-quan-ly-danh-muc.md](ledger/UC-109-quan-ly-danh-muc.md)
- [OPEN] Mọi lỗi khi `INSERT` (không chỉ trùng khoá) đều trả `duplicate` 409 (`saveCategory`, `catch {}`).
- [OPEN] Sửa danh mục không kiểm lại dạng `id`; đổi mã danh mục không làm được (chỉ có `PATCH` theo mã cũ).
- [OPEN] Kiểm `default_wallet_id` chỉ khi giá trị khác rỗng; ví đã tắt sau đó không làm danh mục mất ví mặc định — khi nhập, `walletFor` báo `unknown_wallet`.
- [OPEN] BR-08 (cấu hình không cần sửa code): PWA không gọi `POST/PATCH /v1/categories` (không có trong `web/src`), và `GET /v1/settings` chỉ trả danh sách danh mục — tạo/sửa danh mục hiện chỉ làm được bằng gọi API trực tiếp.

### [ledger/UC-110-quyet-toan-thue-nam.md](ledger/UC-110-quyet-toan-thue-nam.md)
- [OPEN] Không có màn PWA, tool MCP hay cron nào gọi quyết toán (không có `/v1/tax` trong `web/src`, không có tool thuế trong `src/mcp/tools.ts`); `docs/core_design_rules.md` §5 coi quyết toán là một nhịp "Cuối năm".
- [OPEN] "Đã nộp" = mọi `spend` trừ ví Thuế, bất kể danh mục; seed không có danh mục nộp thuế (test tự tạo `nop-thue`).
- [OPEN] `walletBalance` là số dư ví Thuế **hiện tại** (mọi năm), không phải cuối năm được quyết toán; thuế trích năm sau đã nằm trong ví sẽ được tính vào giới hạn chuyển.
- [OPEN] Hai request quyết toán song song: khoá chính `tax_settlements.year` làm batch thứ hai huỷ cả (không có `transfer` thứ hai), nhưng lỗi DB không được đổi sang `already_settled` (`[INFERENCE]` từ `settleTax` không bắt lỗi batch).
- [OPEN] Bút toán `T<năm>` là `source='system'` nên không huỷ được qua UC-102; không có đường gỡ một lần quyết toán.

### [ledger/UC-111-so-giao-dich-va-du-lieu-nen.md](ledger/UC-111-so-giao-dich-va-du-lieu-nen.md)
- [OPEN] Sổ giao dịch (cả danh sách lẫn `/summary`) không ẩn gì theo `private`: `wallet_name`, số tiền của giao dịch trên ví riêng tư người khác vẫn trả về đầy đủ (D6 coi `private` chỉ là ẩn lịch sự).
- [OPEN] `q` khớp chữ đã lưu và dạng bỏ dấu của **chữ tìm**, chưa có dạng bỏ dấu của **chữ đã lưu**: "thuoc" không ra ghi chú / tên danh mục "Thuốc …", "THUỐC" không ra "Thuốc" (LIKE không bỏ qua hoa thường với chữ có dấu). Chiều này cần cột chuẩn hoá (migration) — chưa ai cần.
- [OPEN] Sổ gồm cả `transfer` hệ thống (chốt tháng `S…`, quyết toán `T…`) và `adjust` — chỉ `fund` bị lọc.

## Chia tiền (allocation) — 8 divergence, 26 open

### [allocation/UC-201-tinh-phuong-an-chia.md](allocation/UC-201-tinh-phuong-an-chia.md)
- [DIVERGENCE] `docs/core_design_rules.md` §4 bước 5 và `phase-02-allocation-core.md` bước 5: "ví goal → ví nice flat/percent, theo priority", nhưng code rót phe `nice` **chỉ theo `priority`** (`src/domain/allocation.ts:157`), không phân biệt `mode`. Hành vi hiện tại khớp docs chỉ vì seed đặt Du lịch priority 30 < Chơi 31.
- [DIVERGENCE] Chú thích cột `floor_amount` "SÀN CỨNG — không bóp xuống dưới" (`migrations/0001_schema.sql:87`) nhưng engine vẫn rót dưới sàn khi thiếu và chỉ gắn `underfunded` (`src/domain/allocation.ts:163-165`); §4 docs mô tả đúng như code.
- [DIVERGENCE] Docs §4 bước 6 chỉ nói "have: ví remainder"; code có thêm bước rót cho ví nhóm Have **không** phải remainder (`src/domain/allocation.ts:158`) — không có trong docs/plan.
- [OPEN] Luật không rơi vào bước nào thì ví nhận 0 mà không báo: ví phe `must` nhóm `must` có `mode='percent'` (bị loại khỏi tập Must ở dòng 134, không thuộc bước 5–6), ví phe `wealth_building`/`tax` có `mode ≠ 'percent'`. Settings cho phép lưu các cấu hình này (`MODES` trong `src/services/settings.ts` không ràng theo phe).
- [OPEN] "Ví đứng đầu nhóm" nhận đồng lẻ = ví đứng trước trong `rules`, mà câu SQL nạp luật (`loadRefs`) không có `ORDER BY` → phụ thuộc thứ tự dòng của SQLite.
- [OPEN] Phần trăm là `REAL`; `floor(amount × percent)` dùng số thực JS nên một số tỷ lệ có thể hụt 1 ₫ (ví dụ `100 × 0.29 = 28.999…` → 28). Seed 0.3/0.1 được phủ bởi AC-9/AC-10; tỷ lệ khác chưa kiểm.
- [OPEN] Ví `remainder` là phong bì; nếu đầu tháng nó âm, engine không ưu tiên bù (nó chỉ nhận phần dư), nhưng `deficitCovered` vẫn báo phần phần dư đã lấp (vòng lặp dòng 169-174 duyệt mọi luật).
- [OPEN] Ví `goal` dùng số dư **hiện tại** (`v_wallet_balance`) trừ phần nạp trong tháng của khoản thu; chia một khoản thu của tháng cũ sau khoản của tháng mới có thể làm nhu cầu hiển thị lệch — red team đo lệch tối đa 1 ₫ do `Math.ceil` (`plans/reports/redteam-260922-0100-money-correctness.md`, mục "Thuộc tính đã kiểm chứng"), xếp mức thông tin.
- [DIVERGENCE] Proposal `261001-cho-thue-lai` mô tả nguồn `default` = bộ luật `percent` hiện tại; code không có dòng `default` nào — "không có nguồn" (`stream` `null`/`undefined`) mới là hành vi cũ. Seed `salary-husband` khóa rỗng nên lương gắn nguồn này **không** cắt Tích sản 30% như lương không gắn nguồn.
- [OPEN] Có nguồn thu thì bỏ hẳn bước Thuế: khoản `taxable=true` gắn nguồn không trích Thuế trừ khi nguồn tự khóa ví Thuế; không có cảnh báo nào.
- [OPEN] Lock trỏ tới ví đã tắt sau khi lưu nguồn: Cài đặt chỉ kiểm ví active lúc lưu phần khóa, tắt ví không kiểm phần khóa, và engine/`loadRefs` không lọc → vẫn nạp fund vào ví đã tắt (và không sinh lệnh chuyển tiền vì `walletAccounts` chỉ có ví active).
- [OPEN] Khóa 100% dừng sớm nên ví phong bì đang âm không được bù và không được báo `underfunded` trong lần chia đó — đúng ý ADR-63 nhưng người dùng không thấy cảnh báo nào.

### [allocation/UC-202-xem-truoc-phuong-an-chia.md](allocation/UC-202-xem-truoc-phuong-an-chia.md)
- [OPEN] Lỗi cấu hình chia (`AllocationConfigError`) ra 500 "Lỗi hệ thống" thay vì một mã 4xx có thông điệp tiếng Việt của engine (`src/index.ts:27-35`); người dùng không biết phải sửa gì. Chưa rõ đây là quyết định hay sót.
- [OPEN] Route không chặn `amount ≤ 0` (chỉ kiểm số nguyên) nên 0/âm rơi vào E5 (500), trong khi MCP chặn bằng zod `.positive()`.
- [OPEN] Nguồn thu đã tắt vẫn xem trước được (`loadRefs` nạp cả nguồn `active=0`), trong khi ghi khoản thu với nguồn đó bị từ chối `inactive_income_stream` (ledger UC-101) — preview có thể cho phương án mà không ghi được.
- [OPEN] MCP `preview_allocation` không nhận nguồn thu, nên Claude xem trước tiền người thuê / lương vợ sẽ ra phương án theo luật % chung, khác với lần chia thật (UC-203 dùng nguồn trên khoản thu).

### [allocation/UC-203-chia-mot-khoan-thu-nhap.md](allocation/UC-203-chia-mot-khoan-thu-nhap.md)
- [DIVERGENCE] `docs/core_design_rules.md` §4: "Chạy ngay khi một khoản income được xác nhận". Với nhập tay qua REST/MCP, server **không** tự chia sau `POST /v1/transactions` — việc chia ngay là do client gọi tiếp `/v1/allocate` (PWA làm; MCP cần Claude gọi tool `allocate_income` riêng). Chỉ nhánh lương của ingest tự chia ở server (`src/services/ingest.ts:374`).
- [OPEN] Kiểm "đã chia" (bước 3) là đọc-rồi-ghi; tính đúng khi đua dựa hoàn toàn vào PRIMARY KEY và việc nhận diện lỗi bằng regex `/UNIQUE|PRIMARY KEY/i` trên thông điệp lỗi D1 (`src/services/ledger.ts:300`). Một vi phạm UNIQUE khác trong batch (vd `allocation_runs.batch_id`) cũng sẽ được báo là `already_allocated`.
- [OPEN] Lần chia dùng nguồn của khoản thu kể cả khi nguồn đã tắt (`loadRefs` nạp cả nguồn `active=0`), và nhánh tự ghi lương gắn nguồn của rule mà không kiểm nguồn còn bật — chỉ nhập tay/gán mới chặn `inactive_income_stream`. Sửa phần khóa của nguồn sau khi ghi khoản thu mà trước khi chia cũng đổi kết quả chia.
- [DIVERGENCE] Proposal `261001-cho-thue-lai` (UC-805) ghi thêm một `TenantLine(payment)` sau khi chia; code không có `payment` — tiền người thuê trả chính là khoản `income` gắn `tenant_id`, và `v_tenant_balance` trừ thẳng các khoản đó (huỷ khoản thu thì số dư tự trở lại).

### [allocation/UC-204-sinh-lenh-chuyen-tien.md](allocation/UC-204-sinh-lenh-chuyen-tien.md)
- [DIVERGENCE] Chú thích cột `memo` trong `migrations/0001_schema.sql:203` vẫn ghi `'PF <batch_id>'`; code và `docs/schema.sql` đã là `'PF XXXXXX' ngẫu nhiên, riêng từng lệnh` (`src/domain/transfer-orders.ts:37-40`). Migration là lịch sử nên không sửa; ghi lại để khỏi nhầm.
- [OPEN] Không có ràng buộc UNIQUE cho `transfer_orders.memo` và code không kiểm trùng khi sinh; không gian mã 32^6 (~1,07 tỷ). Ingest tra lệnh bằng `memo + amount + (from|to account)` và lấy dòng đầu — hai lệnh trùng memo, trùng số tiền và tài khoản sẽ mơ hồ.

### [allocation/UC-205-theo-doi-lenh-chuyen-tien.md](allocation/UC-205-theo-doi-lenh-chuyen-tien.md)
- [OPEN] Không có đường nào đưa lệnh đã `done` **bằng tay** về `pending` (API chỉ đi từ `pending`; ingest chỉ trả về `pending` các lệnh có `matched_log_id` của log bị gỡ). Hệ quả với UC-206: bấm nhầm "Đã chuyển" thì khoản thu của đợt đó không bao giờ huỷ được, dù thông điệp lỗi bảo "gỡ lệnh chuyển tiền trước".
- [OPEN] "Quá 3 ngày" so `created_at` (UTC, `datetime('now')`) với `datetime('now','-3 days')` — tính theo 72 giờ tuyệt đối, không theo ngày lịch VN.
- [OPEN] Danh sách giới hạn cứng 200 dòng, không phân trang.
- [OPEN] `wallet_names` lấy ví theo **tài khoản hiện tại** của ví (`wallets.account_id`), không theo tài khoản lúc chia: đổi tài khoản chứa ví sau khi chia thì lệnh cũ có thể hiện sai ví hoặc `null`. Lệnh của nhiều lần chia cùng hai tài khoản vẫn tách đúng vì lọc theo `batch_id`.

### [allocation/UC-206-go-lan-chia-khi-huy-khoan-thu.md](allocation/UC-206-go-lan-chia-khi-huy-khoan-thu.md)
- [OPEN] Thông điệp E3/E4 bảo "gỡ lệnh chuyển tiền trước", nhưng không có API nào đưa lệnh `done` về `pending` (chỉ ingest làm khi gỡ gán log đã khớp) — xem UC-205 [OPEN]. Lệnh đánh dấu `done` bằng tay làm khoản thu của đợt không huỷ được vĩnh viễn.
- [OPEN] Gỡ một lần chia sau khi tháng đó đã chốt (UC-207): các bút toán quét dựa trên số dư có tính fund của đợt vẫn giữ nguyên, nên phong bì liên quan sẽ âm và được bù ở lần chia kế tiếp (suy ra từ code, chưa có test).
- [OPEN] Trigger 0006 chặn theo `batch_id` cho **mọi** fund `active → void`; ngoài lần chia không có nơi nào khác sinh fund nên hiện không ảnh hưởng luồng khác.

### [allocation/UC-207-chot-thang-quet-du.md](allocation/UC-207-chot-thang-quet-du.md)
- [DIVERGENCE] `plans/260921-2228-profit-first-pwa/phase-02-allocation-core.md` (Chốt kỳ) và `phase-07-cron-telegram.md` ghi `batch_id = sweep-<month_key>`; code dùng `S<YYYYMM>` (`src/services/ledger.ts:309`).
- [OPEN] Tính "đúng một lần" là kiểm-rồi-ghi ở app, không có ràng buộc DB (`idx_tx_batch` không unique). Hai lần `closeMonth` cùng tháng chạy song song có thể cùng thấy "chưa chốt" và quét hai lần (suy ra từ code; cron hiện chạy một lần/ngày).
- [OPEN] Tháng không có gì để quét thì không để lại dấu `S<YYYYMM>`; nếu sau đó có giao dịch ghi lùi ngày vào tháng đã qua và cron ngày 1 của tháng sau chỉ chốt tháng liền trước, tháng đó không bao giờ được chốt lại (chỉ có thể gọi `closeMonth` trực tiếp).
- [OPEN] Chỉ quét ví **active**; phong bì chung đã tắt mà còn dư dương thì không bao giờ được quét.
- [OPEN] Dấu "đã chốt" đếm cả dòng `void` (câu kiểm không lọc `status`).

## Bank feed (ingest) — 11 divergence, 38 open

### [ingest/UC-301-nhan-webhook-sepay.md](ingest/UC-301-nhan-webhook-sepay.md)
- [DIVERGENCE] `phase-04-ingest-sepay.md` §"Hợp đồng webhook" nói `transactionDate` đổi sang ISO `+07:00`; code lưu ISO UTC `…Z` (`src/services/ingest.ts` › `vnDateTimeToIso`). Cùng một thời điểm, khác biểu diễn.
- [DIVERGENCE] Báo cáo `fullstack-developer-260922-0020-sepay-ingest.md` §1 mô tả "lỗi xử lý … luôn trả `{"success": true}`"; hiện tại (sau `a954744`) lỗi tạm thời trả 503.
- [OPEN] Xác thực HMAC-SHA256 SePay (an toàn hơn Apikey) chưa làm — phase-04 ghi "để sau V1".
- [OPEN] Phase 00 (bắt payload thật MB) chưa được điền bảng kết quả (`phase-00-sepay-spike.md`); D5 (chủ nhà: MB có tiền ra) trái với bảng hỗ trợ SePay (researcher A.3: MB "Tiền ra: Không"). Toàn bộ test dùng payload tự dựng.
- [OPEN] `accounts.sub_account` không có unique index; nếu hai TK cùng `sub_account`, `SELECT … WHERE sub_account = ?` lấy dòng bất kỳ.
- [OPEN] Tra tài khoản không lọc `active`: log của TK ngưng dùng vẫn được gắn vào TK đó. (Từ v5, TK tắt SePay không còn thuộc kết nối nào nên webhook không gắn log vào nó — `ingestLog` gọi không kèm kết nối, chỉ có ở test, vẫn tra mọi TK.)
- [OPEN] Log mang số TK của kết nối khác (AC-10) nằm chờ gán như log tài khoản lạ, không có cảnh báo riêng "khoá SePay này gửi giao dịch của tài khoản không thuộc nó" — thường là cấu hình nhầm (tài khoản chưa chọn đúng kết nối ở Cài đặt).

### [ingest/UC-302-ghi-log-chong-trung.md](ingest/UC-302-ghi-log-chong-trung.md)
- [DIVERGENCE] `phase-04-ingest-sepay.md` §"Rà soát 02:00" bước 2–3: trùng (TK, số tiền, hướng, thời điểm) → "Đã có → bỏ qua"; code (`43baea1`) vẫn ghi log và chỉ đánh dấu "có thể trùng". `docs/core_design_rules.md` §9 đã cập nhật theo code.
- [OPEN] Log `account_id NULL`: bước 3 vẫn chống trùng tuần tự (so bằng `IS`), nhưng unique index coi các `NULL` là khác nhau nên hai request chạy chen cho TK lạ cùng mã FT không bị DB chặn. Không có test.
- [OPEN] `findPossibleTwin` không lọc trạng thái log kia (log `ignored` cũng được tính) và so `at` bằng `BETWEEN` chuỗi — đúng khi mọi `at` cùng khuôn ISO `…Z` như `vnDateTimeToIso` sinh.
- [OPEN] Log song sinh ở `pending` vẫn là ứng viên ghép cặp nội bộ cho log đến sau (câu truy vấn ứng viên ở UC-303 chỉ lọc `status='pending'`) — [INFERENCE] từ code, không có test.
- [OPEN] Id webhook và id API lịch sử có trùng nhau không, và webhook MB có luôn mang `referenceCode` không — chưa quan sát thật (`phase-00-sepay-spike.md` bước 5; `redteam-260922-0100-money-correctness.md` câu hỏi 1).

### [ingest/UC-303-tu-khop-log-vao-so.md](ingest/UC-303-tu-khop-log-vao-so.md)
- [DIVERGENCE] `docs/core_design_rules.md` §6 và `phase-04-ingest-sepay.md` §Luồng tách bước 2 "tài khoản đối ứng thuộc `accounts` của hộ" khỏi bước 3 "log ngược hướng, cùng tiền, ≤10 phút"; code gộp làm một (`src/domain/rules.ts` › `canPair` doc-comment) vì payload SePay không có trường TK đối ứng (`fullstack-developer-260922-0020-sepay-ingest.md` §2, câu hỏi mở 4).
- [DIVERGENCE] `migrations/0001_schema.sql` chú thích `transfer_orders.memo` là `'PF <batch_id>'`; code/`docs/core_design_rules.md` §4 dùng `PF` + mã ngẫu nhiên riêng từng lệnh (`8ef7a99`).
- [DIVERGENCE] `phase-04-ingest-sepay.md` bước 4 cho phép rule khớp → `spend | transfer` "kèm category"; seed 0002/0004 không có rule `transfer`; migration 0017 chỉ seed rule `transfer` có tài khoản đầu kia (heo đất, ADR-77). Rule `transfer` không có tài khoản đầu kia vẫn chỉ đi tới TK tiền mặt của thành viên — không phải mọi `transfer` nội bộ.
- [OPEN] Khi nhiều log ứng viên cùng thoả `canPair`, câu truy vấn không có `ORDER BY` → không xác định log nào được chọn.
- [OPEN] Red team `redteam-260922-0100-offline-ingest-robustness.md` Phát hiện 1 (CÒN MỞ): mã `[QE]xx` bắt ở bất kỳ đâu trong nội dung (ví dụ "EMS" bưu điện, "QUA") → tự gán sai danh mục, không vào hàng chờ. `extractCode` chỉ lấy mã **đầu tiên** khớp regex, nên một từ `QUA` đứng trước `EAN` sẽ che mã thật.
- [OPEN] Tin sáng liệt kê "đã tự ghép N cặp" dựa vào `log_id_2 IS NOT NULL` (notify UC-402); giao dịch PF mới có một chân (`log_id_2` NULL) không được đếm là cặp.
- [OPEN] Nhánh 3.1 ghi thẳng bằng `logTxStmt`, không qua `buildEntry`, nên không kiểm nguồn thu của rule còn `active`: nguồn đã tắt vẫn được gắn vào khoản thu tự ghi và `allocateIncome` vẫn chia theo phần khóa của nó (`loadRefs` nạp cả nguồn đã tắt). Nhập tay/gán tay thì bị chặn `inactive_income_stream`. Không có test.
- [OPEN] Tài khoản để "chỉ tiền vào" mà SePay thật ra có báo tiền ra: khoản chi đã nhập tay và log `out` cùng khoản đều tồn tại; app chỉ nhắc ở màn Gán (UC-305), không chặn người gán tiếp — gán thì đếm hai lần, `book_drift` không thấy (nó không so bút toán nhập tay). Chủ nhà cần bật "SePay báo cả tiền ra" ngay khi thấy lời nhắc này (ADR-66).
- [OPEN] Nhánh 3.3 có tài khoản đầu kia ghi thẳng bằng `logTxStmt`, không qua `buildEntry`: không kiểm tài khoản đầu kia hay hai ví của rule còn `active` (`loadRuleRows` nối `accounts` không lọc `active`), không áp chặn `locked_wallet`. Rule loại này hiện chỉ tạo được bằng migration (ADR-77). Không có test.

### [ingest/UC-304-ra-soat-0200-backfill.md](ingest/UC-304-ra-soat-0200-backfill.md)
- [DIVERGENCE] `phase-04-ingest-sepay.md` bước 4: "Có tạo thêm log nào → ghi `notifications(kind='backfill')`"; code luôn ghi (kể cả `added=0`) mỗi lần chạy có ít nhất một kết nối có token và tài khoản.
- [OPEN] Dòng lỗi tạm thời (6a) chỉ ra `console.error`, không có `ingest_error`: từ ADR-78 nó được rà lại muộn nhất ở lượt thứ Hai kế tiếp, nhưng trong khoảng đó tin sáng không biết có dòng bị bỏ. (Khe hở cũ "đêm sau thử lại" mà cửa sổ đêm sau không chứa dòng đó — đã đóng bằng lượt tuần/tháng.)
- [OPEN] Rà soát đêm lỗi (ví dụ token sai 401) có trong kết quả `errors` nhưng cron chỉ ra `console.error`; tin sáng vẫn nhận `added=0` như một đêm bình thường — không có tín hiệu "rà soát thất bại". Đồng bộ lại tay thì người bấm thấy lỗi ngay.
- [OPEN] Mỗi dòng mới vẫn tốn nhiều truy vấn D1 (`ingestLog` + bước khớp); đồng bộ lại một khoảng dài có nhiều giao dịch **chưa có** có thể chạm giới hạn truy vấn mỗi request của gói Workers Free (ADR-54). Dòng đã có không tốn truy vấn nào (bước 5).
- [OPEN] Webhook SePay mang `id` số nguyên, API v2 mang `id` UUID: hai nguồn không còn trùng `id` bao giờ. Chống trùng giữa webhook và rà soát giờ **chỉ** dựa vào `(account_id, reference_number)` (UC-302); giao dịch ngân hàng không có mã tham chiếu sẽ hiện ở màn Gán với nhãn "có thể trùng" (ADR-49) thay vì tự nhận ra. Với API v1, `id` hai nguồn giống nhau nên trùng `id` cũng chặn được.
- [OPEN] Tài khoản ảo: v2 trả trường `va` (số VA); app so `va` với `accounts.sub_account`. Chưa kiểm bằng dữ liệu thật.
- [OPEN] `phase-04-ingest-sepay.md` §"Chạy song song với hệ Google Sheet" (một tháng song song rồi mới tắt Apps Script) — quy trình vận hành, không có trong code.

### [ingest/UC-305-gan-log-chua-gan.md](ingest/UC-305-gan-log-chua-gan.md)
- [DIVERGENCE] `phase-04-ingest-sepay.md` §Endpoints: body assign chỉ có `splits`; code thêm `create_rule` và `other_account_id`, `taxable`, `asset_kind`.
- [OPEN] `assignLog` không đối chiếu `meaning` với `direction` (ví dụ gán `spend` cho log `in`, `income` cho log `out` đều qua kiểm). Không có test.
- [OPEN] Log `account_id NULL` (TK lạ): `splitToEntryInput` truyền `account_id` rỗng nên `buildEntry` rơi về TK tiền mặt của người gán cho `spend`/`refund`/`lend`/`collect` — [INFERENCE] từ `src/domain/entry.ts` › `defaultAccount`; tiền ngân hàng có thể bị ghi vào TK tiền mặt. Không có test.
- [OPEN] `not_found` của assign trả 400 trong khi ignore trả 404 (`fail()` mặc định 400).
- [OPEN] Mô tả tool MCP `list_pending_logs`/`assign_log` vẫn ghi "hiện chưa triển khai" (`src/mcp/tools.ts`) dù đã chạy (thuộc mcp UC-604).
- [DIVERGENCE] Proposal `261001-cho-thue-lai` UC-805: xác nhận tiền người thuê → ghi `income` rồi ghi thêm `TenantLine(payment)`. Code không có loại dòng `payment`: chính giao dịch `income` mang `tenant_id` làm giảm số dư (view `v_tenant_balance`), nên huỷ khoản thu là số dư tự trở lại.
- [OPEN] `create_rule` vẫn chỉ cho `spend`/`transfer`, nên không tạo được rule người thuê từ một lần gán; rule người thuê chỉ tạo được qua `POST /v1/rules` (UC-307) — PWA không có chỗ tạo.
- [OPEN] Lời nhắc rút heo về nói "tới khi anh tự chuyển ví" nhưng Tích sản khóa chiều ra: gán kèm `from_wallet_id` = Tích sản bị `locked_wallet` (bước 6.1). App chưa có đường đưa tiền heo đã rút về ra khỏi Tích sản (ADR-82).
- [OPEN] Heo trả về nhiều hơn sổ heo (lãi, hoặc tiền heo có từ trước khi dùng app vì heo mở sổ `opening_balance = 0`): gán cả số tiền là Chuyển nội bộ thì sổ heo âm đúng phần đó; không còn lời nhắc tách lãi — người gán tự tách dòng Thu nhập, hoặc nhập số dư đầu thật / đếm số dư heo (ledger UC-105) (ADR-82).

### [ingest/UC-306-ghep-cap-tay-va-go-gan.md](ingest/UC-306-ghep-cap-tay-va-go-gan.md)
- [OPEN] Ghép tay không giới hạn khoảng cách thời gian và không kiểm memo `PF`; `at` của transfer lấy theo chân ra.
- [OPEN] Gỡ gán một giao dịch PF chỉ một chân: lệnh về `pending`, log về `pending`; nếu chân kia về sau, UC-303 bước 1.1 ghép lại cả hai (AC-5 của UC-303). Nếu chân kia **không** bao giờ về, log chân đầu nằm chờ không gợi ý gì (nội dung `PF …` không phải rút tiền — UC-305 v15; trước đó bị gợi ý "Rút tiền mặt") — người gán phải tự nhận ra đây là chuyển nội bộ.

### [ingest/UC-307-quan-ly-rule-tu-gan.md](ingest/UC-307-quan-ly-rule-tu-gan.md)
- [DIVERGENCE] `phase-04-ingest-sepay.md` §Rules: loại `account` = "tài khoản / tên thụ hưởng"; code so `account` giống hệt `content` (chuỗi con trong nội dung chuẩn hoá, `src/domain/rules.ts` › `matchRule`) vì payload không có trường tài khoản đối ứng.
- [DIVERGENCE] `phase-04-ingest-sepay.md` §"Học từ hệ đang chạy": từ khoá `TIET KIEM TIEN LE`/`DANG GOM`/`LAM TRON` → `QTT`; migration 0004 cố ý không seed (ví đích chưa rõ — `fullstack-developer-260922-0020-sepay-ingest.md` câu hỏi mở 1). Migration 0017 trả lời bằng rule `content` gắn từng tài khoản MBBank của người có heo (chuyển nội bộ sang heo — ADR-77; ví Có thì tốt → Tích sản từ migration 0020 — ADR-82), không phải mã `QTT` dùng chung; tài khoản khác (hay nhà không có `husband`/`wife`) thì log mang nội dung này vẫn rơi về `pending`.
- [OPEN] `createRule` (REST) không viết hoa `pattern` và không kiểm ví/danh mục tồn tại; `updateRule` (Cài đặt) thì có. Khớp vẫn đúng vì `matchRule` viết hoa khi so; ràng buộc tồn tại dựa vào FK của D1 — chưa kiểm chứng.
- [OPEN] Rule `code` khớp mọi `[QE]xx` trong nội dung, kể cả từ thông dụng (EMS bưu điện, QUA) — `redteam-260922-0100-offline-ingest-robustness.md` Phát hiện 1, CÒN MỞ.
- [OPEN] `by_member_id` của rule mã dùng chung được seed là `'husband'` (`fullstack-developer-260922-0020-sepay-ingest.md` câu hỏi mở 2).
- [OPEN] Mẫu `TICH LUY` (ADR-77) bắt mọi nội dung có "tích lũy" ở tài khoản MB của người có heo — nếu nhà mở thêm sản phẩm tiết kiệm tích lũy khác của MB ngoài "Tiết kiệm tiền lẻ", log của nó cũng bị coi là heo (tiền ra tự gán bỏ heo khi SePay báo cả tiền ra; tiền vào chỉ gợi ý). Chưa kiểm prod có sản phẩm như vậy không; có thì tắt rule ở Cài đặt › Luật hoặc thu hẹp mẫu.
- [OPEN] Không có endpoint xoá rule; tắt bằng `active=false` qua Cài đặt.
- [OPEN] Rule người thuê chỉ tạo được qua `POST /v1/rules`: không tạo từ lần gán (UC-305 `create_rule` chỉ cho `spend`/`transfer`), Cài đặt không sửa được `tenant_id` (`updateRule` không nhận trường này), PWA không có chỗ tạo.
- [OPEN] `createRule` không chặn rule người thuê trỏ tới người thuê đã ra (`active = 0`); gợi ý vẫn hiện nhưng gán sẽ lỗi `inactive_tenant`.
- [OPEN] `account_id`, `counter_account_id`, `from_wallet_id` chỉ đặt được bằng migration: `POST /v1/rules`, `create_rule` ở màn Gán và `updateRule` ở Cài đặt không nhận ba trường này (ADR-77 Consequences). Thêm tài khoản MB mới cho người có heo thì phải thêm rule bằng SQL.

## Nhắc & Telegram (notify) — 8 divergence, 31 open

### [notify/UC-401-lich-cron-va-dieu-phoi.md](notify/UC-401-lich-cron-va-dieu-phoi.md)
- [OPEN] Lịch khai hai nơi (`wrangler.jsonc` và `CRONS`) không có kiểm tra tự động giữ đồng bộ; lệch nhau thì job im lặng không chạy (chỉ `console.warn`).
- [OPEN] Phase-07 Todo "test local: `wrangler dev --test-scheduled` + `curl "/__scheduled?cron=0+0+*+*+*"`" — không có dấu vết đã làm trong repo (không kiểm chứng được).

### [notify/UC-402-tin-sang-0700.md](notify/UC-402-tin-sang-0700.md)
- [DIVERGENCE] Mẫu tin phase-07 xếp `⚠️ Sắp vỡ: Ăn uống 92% · Đi lại 105%` (`plans/260921-2228-profit-first-pwa/phase-07-cron-telegram.md` § Hằng ngày) nhưng code sắp % giảm dần → `Đi lại 105% · Ăn uống 92%` (`src/cron/daily.ts` › `.sort((a, b) => b.pct - a.pct)`; test AC-4 chốt thứ tự code).
- [DIVERGENCE] Phase-07: "không có gì cảnh báo thì tin ngắn 2 dòng"; code luôn hiện 🎯 khi có ví mục tiêu hoặc Quỹ an tâm tính được (kể cả 0%) nên với dữ liệu thật tin tối thiểu là 3 dòng (AC-3). Lý do ghi ở `plans/reports/fullstack-developer-260922-0020-cron-telegram.md` "Giả định cần xác nhận" #4 — chưa được xác nhận.
- [DIVERGENCE] Phase-07 Todo "gửi lỗi: ghi ok=0, **hiện badge trong PWA**": không có code nào trong `src/routes` hay `web/src` đọc `notifications.ok`.
- [OPEN] Dòng 🏦 bỏ dấu của số lệch (`Math.abs`): người đọc không biết ngân hàng cao hay thấp hơn sổ.
- [OPEN] "Quá 3 ngày" và "24 giờ qua" (❗) tính theo đồng hồ DB (`datetime('now', …)`), không theo `now` của lần chạy; chỉ khác khi chạy tay với `now` giả.
- [OPEN] Câu chữ dòng 🧮 và việc dùng lại icon 🔁 cho lệnh chuyển tiền của chốt tháng là do agent tự soạn, chưa được duyệt (báo cáo phase-07, "Giả định cần xác nhận" #2, #3).
- [DIVERGENCE] Proposal `261001-cho-thue-lai` §Thiết kế: "tin sáng ngày 1 nhắc chốt tháng với từng người thuê đang `active`"; code chỉ nhắc người `active` **chưa** chốt tháng trước (`src/services/rental.ts` › `unsettledTenants`), và kèm số dư hiện tại.

### [notify/UC-403-kich-hoat-chot-thang-ngay-1.md](notify/UC-403-kich-hoat-chot-thang-ngay-1.md)
- [DIVERGENCE] Phase-07 ghi "Idempotent nhờ `batch_id = sweep-<month_key>`" (`plans/260921-2228-profit-first-pwa/phase-07-cron-telegram.md` § Hằng ngày) nhưng code dùng `batch_id = 'S' + yyyymm` (`src/services/ledger.ts` › `closeMonth`: `` `S${month.replace("-", "")}` ``; test khẳng định `'S202609'`).
- [OPEN] `closeMonth` chỉ được gọi từ lượt cron ngày 1 (không có route/MCP tool nào gọi nó — grep `closeMonth` trong `src/`). Lượt lỗi hay lỡ được lượt 5 phút sau làm bù trong ngày 1 (UC-401), nhưng nếu Worker không chạy suốt ngày 1 thì tháng trước không bao giờ được chốt tự động và không có đường chốt tay.
- [OPEN] Nếu lần chạy đầu đã chốt xong nhưng hỏng trước khi gửi, lần chạy lại cùng ngày gửi tin **không có** dòng 🧹 (vì `closeMonth` trả `already`) — người nhà không được báo đã quét.
- [OPEN] Chưa có bot token vẫn chốt tháng (tác dụng phụ xảy ra dù không ai được báo).

### [notify/UC-404-nhac-dem-vi-chu-nhat.md](notify/UC-404-nhac-dem-vi-chu-nhat.md)
- [OPEN] Câu chữ dòng 🧮 do agent phase-07 tự soạn, chưa được duyệt (`plans/reports/fullstack-developer-260922-0020-cron-telegram.md` "Giả định cần xác nhận" #2).
- [OPEN] Mốc "7 ngày" tính theo giờ tuyệt đối (`now − 7×86.400.000 ms`), không theo ngày lịch VN: một lần đếm lúc 08:00 Chủ nhật tuần trước sẽ vẫn được coi là "trong 7 ngày" ở lần nhắc 07:00 Chủ nhật này.

### [notify/UC-405-nhac-khoan-thu-chua-chia-ngay-10-25.md](notify/UC-405-nhac-khoan-thu-chua-chia-ngay-10-25.md)
- [OPEN] Đếm mọi khoản thu chưa chia từ trước tới nay, kể cả khoản người nhà cố ý không chia — không có cách đánh dấu "không cần chia" nên lời nhắc lặp lại ở mọi ngày 10/25 cho tới khi khoản đó được chia hoặc huỷ.
- [OPEN] Khoản thu bị tự chia ngay khi về (lương qua bank feed, UC-203/UC-303) không bao giờ được báo qua Telegram — xem UC-409 và `plans/reports/redteam-260922-0100-auth-exposure.md` (sửa tối thiểu (c)).

### [notify/UC-406-tong-ket-tuan-thu-hai.md](notify/UC-406-tong-ket-tuan-thu-hai.md)
- [OPEN] Top 5 danh mục và tổng chi tuần ở tiêu đề bản ngắn cộng cả chi tiêu từ ví `private` (câu SQL không lọc theo ví), trong khi phong bì `private` bị ẩn — tổng theo danh mục có thể để lộ phần chi tiêu "ẩn lịch sự" (D6) trong tin gửi cả hai người.
- [OPEN] Tin chỉ liệt kê phong bì **tuần**; phong bì tháng và các ví khác không có trong tổng kết (`docs/core_design_rules.md` §8 chỉ ghi "tổng kết tuần + top 5 danh mục", không nói rõ phạm vi).

### [notify/UC-407-bao-giao-dich-chua-gan-moi-phut.md](notify/UC-407-bao-giao-dich-chua-gan-moi-phut.md)
- [DIVERGENCE] `docs/core_design_rules.md` §8 mô tả tin là "5 giao dịch chưa gán"; code gửi `⚠️ 5 giao dịch chưa gán:` kèm từng dòng số tiền/tài khoản (`src/notify/format.ts` › `pendingMessage`). Khác về hình thức, cùng ý.
- [OPEN] Số tiền trong tin này định dạng bằng `toLocaleString("vi-VN")` + `" ₫"` tại chỗ (`pendingMessage`), không qua `formatMoney` — hai chỗ định dạng tiền song song trong `src/notify/format.ts`.
- [OPEN] Khi mọi kênh hỏng kéo dài, mỗi lượt cron (ngoài giờ yên lặng) sinh thêm một dòng `pending_batch` cho mỗi người nhận Telegram và mỗi máy đã bật (khoá là timestamp), không có dọn dẹp.
- [OPEN] Khoản thu bị tự ghi sổ + tự chia (không qua `pending`) không bao giờ được báo ở đây (`plans/reports/redteam-260922-0100-auth-exposure.md`, `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md`) — xem UC-409.

### [notify/UC-408-gui-telegram-chong-gui-trung.md](notify/UC-408-gui-telegram-chong-gui-trung.md)
- [DIVERGENCE] Phase-07 Todo "gửi lỗi: ghi ok=0, **hiện badge trong PWA**" — code có ghi `ok=0` và thử 3 lượt, nhưng không có API/màn nào đọc `notifications.ok` (không có trong `src/routes`, `web/src`). Người nhà không biết tin sáng bị hỏng.
- [OPEN] `ok = 0` vừa nghĩa "đang gửi" vừa nghĩa "hỏng" — không phân biệt được, và không có thử lại cho `daily`/`weekly` (E1, E2).
- [OPEN] Lượt thử cuối cùng vẫn nghỉ `500 ms × 3` trước khi trả kết quả (vòng lặp nghỉ sau mỗi lượt hỏng không phải 4xx) — kéo dài thời gian cron vô ích.

### [notify/UC-409-bao-luong-ve-da-chia.md](notify/UC-409-bao-luong-ve-da-chia.md)
- [DIVERGENCE] `docs/core_design_rules.md` §8 hứa tin "Lương về & đã chia", nhưng code không gửi tin nào khi chia (`src/services/ledger.ts` › `allocateIncome`; không có lời gọi `notifyMembers` ngoài `src/cron/`). Lương tự chia qua bank feed không xuất hiện ở tin chưa gán (UC-407, không còn `pending`) lẫn nhắc 10/25 (UC-405, đã chia) — người nhà chỉ thấy khi mở app.
- [OPEN] Khoá chống trùng dự kiến (ví dụ `kind` + id khoản thu) và nội dung "bảng chia" chưa được quyết.

### [notify/UC-410-gui-thong-bao-day-web-push.md](notify/UC-410-gui-thong-bao-day-web-push.md)
- [OPEN] `vapid_subject` là origin của request đầu tiên sinh khoá và không bao giờ đổi; không có cách xoay khoá hay đổi `sub` từ app. Nếu lần đầu đi qua `http://localhost` (dev trỏ D1 thật) thì `sub` không phải `https:`/`mailto:` — báo cáo nghiên cứu §4 ghi Apple từ chối JWT có `sub` sai.
- [OPEN] Push hỏng không phải 404/410 (vd 403 khi VAPID sai) chỉ ghi `ok = 0` và log; máy vẫn hiện "Đang bật" ở PWA, không ai biết — cùng gốc với [DIVERGENCE] badge ở UC-408.
- [OPEN] Máy của thành viên `active = 0` và máy không bao giờ nhận được (lỗi khác 404/410) không bị dọn; `notifications` thêm một dòng mỗi máy mỗi tin, không có thời hạn lưu.
- [OPEN] `push_subscriptions.id` là `INTEGER PRIMARY KEY` không `AUTOINCREMENT`: xoá máy có `id` lớn nhất (404/410 hoặc Tắt) rồi một máy khác đăng ký thì SQLite có thể cấp lại đúng `id` đó — claim cũ `push:<id>` cùng `(kind, day_key)` sẽ chặn máy mới nhận tin đó.
- [OPEN] Lượt gửi thử chạy trong `waitUntil` của request: mỗi tin tới mỗi máy là một lần ECDH + ECDSA (Web Crypto) và một `fetch`. Gói Workers Free giới hạn CPU mỗi request 10 ms — 2 tin × vài máy có thể chạm giới hạn; thời gian ngủ không tính CPU. `waitUntil` chỉ được hứa ≈ 30 giây sau khi trả lời; lượt dài nhất ≈ 20 giây cộng thời gian gửi. Chưa đo trên Cloudflare thật.
- [OPEN] Cột `push_test_series` vẫn mang CHECK của bản đầu (`count` 1–5, `interval_s` 10–60, trạng thái `pending`) — code chỉ ghi `count` 1–2, `interval_s` = 10, `running`; giữ để không phải sửa migration 0009 đã chạy production. Bảng không có dọn dẹp.

### [notify/UC-411-gui-tin-zalo-bot.md](notify/UC-411-gui-tin-zalo-bot.md)
- [OPEN] Hết hạn mức 3.000 tin/tháng (429) không có cảnh báo ở đâu ngoài log và dòng `ok = 0` — cùng gốc với [DIVERGENCE] badge ở UC-408.
- [OPEN] Zalo cắt tin ở 2000 ký tự: tin sáng dài (nhiều ví sắp vỡ, nhiều tài khoản lệch) mất các dòng cuối ở Zalo — thường là phần thông tin, việc cần làm đứng trước (ADR-79).
- [OPEN] Dòng `zalo_help` được ghi `ok = 1` ngay lúc claim, kể cả khi câu hướng dẫn gửi hỏng — hôm đó chat đó không được hướng dẫn lại.
- [OPEN] Không có thời hạn lưu / dọn dòng `zalo_help` và dòng `zalo:<id>` của `notifications` (như UC-410).
- [OPEN] Chưa thử với bot Zalo thật (đặt webhook, nhận `result.verification`, nhắn mã, nhận tin) — test dùng `fetch` giả theo tài liệu Zalo.

## Truy cập & cấu hình (access) — 4 divergence, 29 open

### [access/UC-501-dang-nhap-mat-khau-chung.md](access/UC-501-dang-nhap-mat-khau-chung.md)
- [OPEN] Trần chung 30 lần sai (AC-9) là cái giá chấp nhận (ADR-89): kẻ dò từ nhiều IP chặn được cả nhà đăng nhập **mới** trong 15 phút; phiên đang có vẫn dùng bình thường. Chưa có cảnh báo cho người nhà khi trần chung bị chạm.
- [OPEN] Không thu hồi được một phiên / một máy riêng lẻ — Đăng xuất mọi máy (8b) đăng xuất cả nhà. Máy mất vẫn nhận thông báo đẩy tới khi gỡ ở Cài đặt › Thông báo (notify UC-410).

### [access/UC-502-goi-api-bang-token.md](access/UC-502-goi-api-bang-token.md)
- [DIVERGENCE] `plans/260921-2228-profit-first-pwa/phase-03-api.md` §"Danh tính người dùng (D6)" nói "Gọi bằng bearer token thì truyền `by_member_id` trong body", nhưng code chọn người bằng header `X-Member-Id` và mặc định chủ hộ (`src/routes/auth.ts` › `requireAuth`); `POST /v1/transactions` không đọc `by_member_id` từ body (`src/routes/v1.ts`).
- [OPEN] Biến `via` được đặt nhưng không thấy route nào đọc `c.get("via")` trong `src/`.

### [access/UC-503-phan-quyen-theo-duong-dan.md](access/UC-503-phan-quyen-theo-duong-dan.md)
- [OPEN] Nhánh token không bắt JSON cho request ghi — hợp lý vì token không tự đính kèm theo trình duyệt, nhưng chưa được ghi thành quyết định ở đâu.

### [access/UC-504-an-lich-su-vi-private.md](access/UC-504-an-lich-su-vi-private.md)
- [OPEN] Các đường sau **không** ẩn số ví `private`: `GET /v1/goals` / MCP `get_goals` (`ledger.goals` đọc `v_goal_progress` không có người xem), `snapshot.goals` (lấy từ `v_goal_progress`), `GET /v1/transactions` (`ledger.listTransactions` không nhận người xem), `GET /v1/settings` (trả cờ `private` nhưng không có số dư). Phù hợp với D6 "không phải bảo mật", nhưng chưa có quyết định nói rõ phạm vi ẩn.
- [OPEN] Vì ví bị ẩn tính `0` vào `tiers.*`, tổng tầng giữa hai người xem khác nhau — chưa rõ là chủ ý hay hệ quả phụ.

### [access/UC-505-xem-cau-hinh.md](access/UC-505-xem-cau-hinh.md)
- [OPEN] `config.salary_min_amount` ở màn Cài đặt dùng `configNumber` (mọi số nguyên, mặc định 1.000.000), còn ingest dùng `ledger.salaryMinAmount` (chỉ số nguyên ≥ 0, mặc định 1.000.000). Hai hàm đọc cùng khoá với luật hơi khác; API ghi chỉ cho 0..1e12 nên hiện chưa lệch được qua app.

### [access/UC-506-cau-hinh-tai-khoan-vi-luat-nap.md](access/UC-506-cau-hinh-tai-khoan-vi-luat-nap.md)
- [OPEN] `updateWallet` ghi các cột của ví (`patchRow(db, "wallets", …)`) **trước** khi kiểm tra `allocation`; nếu cùng request sửa `name` và gửi luật nạp sai, tên đã được lưu nhưng request trả lỗi (`src/services/settings.ts` › `updateWallet`). `createWallet` thì nguyên tử (`db.batch`). Chưa có test cho trường hợp trộn.
- [OPEN] Server nhận `private: true` cho ví `shared` (`member_id = null`); với luật ẩn `private && member_id !== viewerId`, ví đó bị ẩn số với **mọi** người. PWA chỉ gửi `private` khi `scope = personal` (`web/src/lib/settings.ts` › `walletPayload`), nhưng API không chặn.
- [OPEN] Không có API xoá tài khoản/ví — chỉ tắt (`active: false`).
- [OPEN] Tắt nguồn thu không bị chặn khi nguồn đang là nguồn cho thuê (`rental_income_stream_id`) hay đang gắn vào mẫu lương: tiền người thuê gán/nhập sau đó lỗi `inactive_income_stream`, còn mẫu lương vẫn chia theo nguồn đã tắt (ingest UC-303). Không có test.
- [OPEN] Tắt một ví đang nằm trong phần khóa của nguồn thu không bị chặn; `loadRefs` vẫn nạp phần khóa đó nên lần chia sau có thể nạp vào ví đã tắt — [INFERENCE] từ `src/services/ledger.ts` › `loadRefs` (truy vấn `income_stream_locks` không lọc ví `active`). Không có test.
- [OPEN] Danh mục ngân hàng chép tay từ tài liệu SePay (đọc 2026-10-01); SePay thêm/bớt ngân hàng hay đổi chiều hỗ trợ thì phải sửa `src/domain/banks.ts` — không có kiểm tra tự động với `/v2/bank-accounts`.
- [OPEN] `GET /v1/settings` trả `accounts.locked` từ v9 (sheet tài khoản khóa ô "Tính vào tiền chi được" cho heo đất), nhưng bật SePay hay tắt tài khoản heo vẫn không bị chặn. Thêm heo cho người thứ ba phải viết migration (ADR-77).

### [access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md](access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md)
- [DIVERGENCE] Số tháng Quỹ an tâm: PWA chỉ cho 1–24 (`web/src/lib/settings.ts` › `configPayload`, test `web/src/lib/settings.test.ts` › "thành viên, tham số › số tháng phao 1–24, ngưỡng lương không âm"), server cho 1–36 (`src/services/settings.ts` › `updateConfig`).
- [DIVERGENCE] `tg_chat_id`: PWA đòi 5–20 chữ số (`web/src/lib/settings.ts` › `memberPayload`, regex `^-?\d{5,20}$`), server chấp nhận 3–20 (`updateMember`, regex `^-?\d{3,20}$`).
- [OPEN] Khoá `tz`, `split_days`, `currency` được seed trong `config` (`migrations/0002_seed.sql`) nhưng không có mã nào trong `src/` hay `web/src` đọc chúng; múi giờ đang hard-code UTC+7 (`src/domain/period.ts` › `VN_OFFSET_MS`) và ngày nhắc chia hard-code `dayOfMonth === 10 || dayOfMonth === 25` (`src/cron/daily.ts`). Không sửa được từ Cài đặt.
- [OPEN] Không có API đổi `role` (vai `teen` / `child` / `guest` có trong schema nhưng chưa có luật — ADR-96). Thêm / tắt người đã có ở 1a / 1b.
- [OPEN] Đổi tên thành viên qua `PATCH /members/:id` chưa kiểm trùng tên / trùng mã với người khác (chỉ lúc thêm người mới kiểm — AC-11).
- [OPEN] Đổi `meaning` của rule từ `income` sang `spend`/`transfer` không xoá `income_stream_id` cũ ở server (`updateRule` chỉ chặn khi request gửi nguồn khác `null`); PWA luôn gửi `null` cho rule không phải lương nên qua app không xảy ra. `updateRule` cũng không sửa được `tenant_id` (rule người thuê, ingest UC-307).

### [access/UC-508-quan-ly-khoa-ket-noi.md](access/UC-508-quan-ly-khoa-ket-noi.md)
- [OPEN] Khoá lưu **nguyên văn** trong D1 (`config`, `sepay_connections`), không mã hoá. Bản sao lưu `wrangler d1 export …` (hướng dẫn trong `README.md`) sẽ chứa khoá. Red-team SC-02 (6/10): ghi nhận là rủi ro chấp nhận ở ADR-90, backlog mã hoá bằng khoá trong `wrangler secret`.
- [OPEN] Server vẫn chấp nhận `null` cho khoá có `source = "server"` (không lỗi, không đổi gì vì cột/dòng app đã trống); việc "chỉ cho xoá khoá app" chỉ được thực thi ở PWA.
- [OPEN] Không xoá được kết nối SePay, chỉ tạm tắt (tài khoản và log cũ vẫn trỏ về nó).
- [OPEN] PWA chặn khoá có khoảng trắng ở giữa (`secretPayload`, test `web/src/lib/settings.test.ts` › "bí mật chỉ ghi › đặt khoá mới: bỏ khoảng trắng hai đầu, chặn rỗng và khoảng trắng giữa"); server không chặn.
- [OPEN] Đổi khoá webhook Zalo trong app không tự gọi lại `setWebhook` — Zalo vẫn gửi khoá cũ và webhook trả 401 cho tới khi bấm **Đặt webhook** lại; app không nhắc việc này ngoài trạng thái nút.
- [OPEN] `PUT /integrations` kiểm và ghi từng khoá lần lượt: một khoá sau sai dạng (vd `zalo_webhook_secret`) thì khoá trước trong cùng request (vd `zalo_bot_token`) đã được ghi dù request trả 400 — và lần ghi dở đó **không** có nhật ký hay cảnh báo (ADR-90 chỉ ghi khi request thành công).
- [OPEN] Kết nối mới hiện trong `GET /v1/settings/mcp` chậm (bản liệt kê của KV cập nhật sau bản ghi — thử trên prod 2026-10-08: hơn 70 giây), và yêu cầu đã cấp mã mà ứng dụng chưa đổi lấy token cũng hiện như kết nối tới 10 phút (alt 9a). Chưa có cách hiện "đang chờ" hay tự tải lại; người nhà nối xong không thấy ngay có thể tưởng chưa được.

### [access/UC-509-kiem-tra-song.md](access/UC-509-kiem-tra-song.md)
- [DIVERGENCE] `phase-01-worker-d1.md` ghi `{ok:true, db:"v1.3"}` — là giá trị lúc lập plan; code đọc động, hiện là `v1.30` (`migrations/0030_setup_and_member_passwords.sql`). Không phải lỗi, chỉ là plan cũ.
- [OPEN] Phản hồi health không theo khuôn `{ ok, data }` như các route `/v1` khác (trả `db` ở cấp trên cùng).
- [OPEN] Lỗi D1 khi đọc (không phải thiếu dòng) không được bắt riêng → rơi vào `app.onError` → 500 `internal`.

### [access/UC-510-thiet-lap-nha-lan-dau.md](access/UC-510-thiet-lap-nha-lan-dau.md)
- [OPEN] Ví Must lúc thiết lập chưa có số nạp; người dùng phải tự vào Cài đặt › Ví & số tiền nạp đặt số (access UC-506). Chưa quyết có cần nhắc ở Hôm nay sau khi thiết lập không.
- [OPEN] Tài khoản tạo lúc thiết lập không nhận số dư đầu (`opening_balance` = 0, `opened_at` = hôm nay); màn Thiết lập dặn "Số dư, số tài khoản, nối SePay thêm sau ở Cài đặt" (access UC-506).

## MCP cho Claude — 3 divergence, 8 open

### [mcp/UC-601-noi-claude-bang-oauth.md](mcp/UC-601-noi-claude-bang-oauth.md)
- [OPEN] phase-06 Todo "đo CPU time … so với ngưỡng 10 ms của gói Free": chỉ có số đo wall time trên Node (báo cáo MCP ghi trung bình 1.62 ms); CPU time thật trên Workers chưa đo.
- [OPEN] Cài đặt › Claude và ứng dụng AI (`GET /v1/settings/mcp`) đọc danh sách grant bằng KV `list`, vốn trễ: trên prod 2026-10-08 một kết nối vừa tạo phải sau hơn 70 giây mới hiện; còn grant đã cấp mã mà ứng dụng chưa đổi mã vẫn hiện trong danh sách tới 10 phút (hạn của mã). Chưa quyết có cần hiện "đang nối…" hay lọc grant chưa đổi mã.
- [OPEN] Kiểm thật trên prod mới chạy với Claude Code; Claude web / Desktop / mobile, ChatGPT, Cursor chưa thử thật (cùng chuẩn CIMD + PKCE).

### [mcp/UC-602-doc-so-lieu-qua-mcp.md](mcp/UC-602-doc-so-lieu-qua-mcp.md)
- [DIVERGENCE] phase-06 bảng Tools: `get_goals` trả "% đạt, cần nạp mỗi kỳ, phao"; `ledger.goals` trả `target`, `targetDate`, `balance`, `missing`, `pct`, `daysLeft` (view `v_goal_progress`) — không có trường "cần nạp mỗi kỳ".
- [OPEN] `get_budget` mặc định tháng; REST `GET /v1/budget` có thêm `kind=week` để mặc định tuần hiện tại (`src/routes/v1.ts`). Claude muốn xem tuần phải tự truyền `2026-Wxx`.

### [mcp/UC-603-ghi-giao-dich-qua-mcp.md](mcp/UC-603-ghi-giao-dich-qua-mcp.md)
- [DIVERGENCE] phase-06 bảng Tools liệt kê input `meaning, amount, category_id?, wallet_id?, account_id?, by_member_id, note?, at?, taxable?`; code nhận thêm `from_wallet_id`, `to_account_id`, `link_id`, `asset_kind` (`src/mcp/tools.ts`) — báo cáo MCP quyết định 2 giải thích là để `transfer`/`buy_asset`/`refund` dùng được.
- [DIVERGENCE] Proposal `261001-cho-thue-lai` không nhắc `add_transaction`; code nhận thêm `income_stream_id`, `tenant_id` để Claude ghi được tiền người thuê trả bằng tiền mặt/nhập tay, và mô tả tool thêm cách "chuyển ngân sách".
- [OPEN] Tool không nhận `client_id` nên không chống trùng: nếu Claude gọi lại (retry, người dùng nhắc lại), khoản tiền được ghi hai lần. Nhánh tóm tắt "trùng client_id" trong code không bao giờ chạy qua MCP. REST có `client_id` (D12) cho PWA offline.

### [mcp/UC-604-gan-log-qua-mcp.md](mcp/UC-604-gan-log-qua-mcp.md)
- [OPEN] Mặc định `limit` khác REST: MCP 20, `GET /v1/logs` 50 (`src/routes/logs.ts`).

### [mcp/UC-605-chia-thu-nhap-qua-mcp.md](mcp/UC-605-chia-thu-nhap-qua-mcp.md)
- [OPEN] `preview_allocation` không nhận `account_id` hay `at` như REST `POST /v1/allocate/preview` (`src/routes/v1.ts`), nên Claude không xem trước được lệnh chuyển tiền và luôn tính theo thời điểm hiện tại (ảnh hưởng phần "đã nạp trong tháng" của D2).
- [OPEN] MCP không có tool huỷ giao dịch: `allocate_income` chạy ngay không có bước xác nhận (phụ thuộc Claude hỏi người dùng), còn gỡ một lần chia (huỷ khoản thu → `ledger.voidTransaction` gỡ các `fund` nếu chưa có lệnh chuyển nào `done`) chỉ làm được qua REST `POST /v1/transactions/:id/void` / PWA. Red-team `plans/reports/redteam-260922-0100-auth-exposure.md` #1 từng ghi "không có cách nào hoàn tác qua API" — code hiện tại đã có đường gỡ (`undoAllocationStatements`, migration `0006_allocation_undo_guard.sql`).

## PWA — 15 divergence, 50 open

### [pwa/UC-701-dang-nhap-dang-xuat-doi-nguoi.md](pwa/UC-701-dang-nhap-dang-xuat-doi-nguoi.md)
- [OPEN] `toLogin()` (store.ts:238) không xoá cache số liệu/cache API khi phiên bị vô hiệu ngoài luồng đăng xuất (báo cáo `redteam-260922-0100-auth-exposure.md` §3, viết trên HEAD cũ). Hiện `enter()` → `forgetOtherMember` xoá cache khi người vào khác `vi-nha:last-member` (commit `80875be`, `4b6d298`), nên số của người trước không được nạp cho người sau; nhưng dữ liệu vẫn nằm trên máy trong lúc ở màn đăng nhập. Chưa có quyết định chốt là đã đóng mục §3 hay chưa.

### [pwa/UC-702-xem-hom-nay.md](pwa/UC-702-xem-hom-nay.md)
- [DIVERGENCE] `plans/.../phase-05-pwa.md` §4 màn "1. Hôm nay": hero là "đúng con số của `domain/snapshot.ts` … không tính lại ở client"; code tính lại phần "còn để chi" của các ví bị hàng đợi ảnh hưởng (`applyQueue`, `web/src/lib/pending.ts:51`), theo mục PWA của cùng file (D12: "đã được trừ tạm"). Hai câu trong cùng phase-05 cần đọc cùng nhau.
- [OPEN] Chip "quá 3 ngày" ở Hôm nay dùng `snapshot.attention.transferOrdersOverdue` (server), còn tab Chuyển tiền tự tính `Date.now() − created_at > 3 ngày` ở máy (UC-707) — hai nguồn có thể lệch nếu đồng hồ máy sai.
- [OPEN] Card Tiền chi được dùng số sổ server; khoản đang chờ đồng bộ chưa trừ vào card (hero thì trừ tạm, D12) — hai số có thể lệch nhau tới khi đồng bộ.

### [pwa/UC-703-nhap-nhanh-khoan-chi.md](pwa/UC-703-nhap-nhanh-khoan-chi.md)
- [DIVERGENCE] `docs/wireframe.md` §2 và `plans/.../phase-05-pwa.md` "2. Nhập": "bàn phím số bật SẴN khi mở (autofocus)"; code chỉ đặt focus vào ô nhập gốc, và ghi rõ iOS có thể cần một chạm mới bật bàn phím (`web/src/screens/entry.tsx` dòng 1–3, commit `032d089`). Bàn phím tự vẽ (bản `a756f68`) đã bị bỏ.
- [DIVERGENCE] `docs/DESIGN.md` §4 Toast lấy ví dụ "Đi lại còn 950.000 ₫ **tháng** này"; code ưu tiên mức tuần ("… **tuần** này") khi ví có mức tuần (`entryToast`, `web/src/lib/pending.ts:117`), khớp với `phase-05-pwa.md` và test "đúng câu của DESIGN.md khi có mức tuần".
- [OPEN] Toast khi bị từ chối nói "nằm trong hàng đợi để sửa", nhưng PWA không có chỗ sửa khoản trong hàng đợi — chỉ "Gửi lại" hoặc "Bỏ" (UC-704); sửa chỉ có cho khoản **đã lên sổ** (UC-715).
- [OPEN] Đồng hồ máy nhanh > 1 ngày làm mọi khoản bị server từ chối `future_at`; ô ngày lấy `max` theo đồng hồ máy. Server đã nói rõ khả năng đồng hồ sai (commit `11b12b3`), PWA chỉ hiện nguyên văn; không có phát hiện lệch giờ phía máy (`plans/reports/redteam-260922-0100-offline-ingest-robustness.md` §3).
- [OPEN] Mục tiêu "dưới 5 giây" (DESIGN.md §1) chưa có phép đo tự động.
- [OPEN] Chú thích trong `EntryForm` nói "Danh mục / tài khoản bị xoá khỏi cấu hình… bỏ chọn", nhưng effect chỉ đặt lại tài khoản; danh mục đang chọn không bị bỏ. [INFERENCE] Khoản gửi đi với danh mục không còn sẽ bị server từ chối (`unknown_category`, theo `redteam-260922-0100-offline-ingest-robustness.md`) và nằm lại hàng đợi ở trạng thái `rejected`.
- [OPEN] Ô số tiền trong sheet không có nút **+**: trên iPhone (bàn phím số không có dấu cộng) chỉ màn Nhập gõ phép tính được; Android/máy tính gõ hoặc dán được. Thêm nút vào từng hàng ô sheet sẽ chật hàng (nhãn · ô 64%).
- [OPEN] Ô sheet mà 0 là số hợp lệ — Số dư đầu, Ngưỡng tự chia lương, Sàn cứng, Số dư mở sổ người thuê (pwa UC-709, UC-713) — phép tính sai thì ô đỏ nhưng nút Lưu vẫn bật và số gửi đi là 0; chỉ Đếm ví (UC-708) chặn hẳn (`onChange(n, valid)` → `counted = null`).

### [pwa/UC-704-hang-doi-nhap-offline.md](pwa/UC-704-hang-doi-nhap-offline.md)
- [OPEN] Khoản `rejected` và khoản **của người khác** vẫn được trừ tạm vào số của người đang xem (`viewSnapshot` dùng toàn bộ `queue`, `web/src/state/store.ts:82`; `BudgetTab` dùng `app.queue`). Báo cáo `ui-ux-designer-260922-0020-pwa-mobile-offline.md` nêu lý do "tiền thật đã ra khỏi túi" cho khoản bị từ chối và để ngỏ câu hỏi; chưa có quyết định cho khoản của người khác.
- [OPEN] Tiêu đề card "Chưa lên sổ (N)" đếm cả khoản của người khác, còn badge tab Nhập chỉ đếm khoản của người đang dùng.
- [OPEN] Không có nhịp thử lại tự động theo thời gian: khoản `pending` chỉ được gửi lại khi có một trong các trigger nêu trên.

### [pwa/UC-705-nhap-loai-khac.md](pwa/UC-705-nhap-loai-khac.md)
- [OPEN] Thu nhập nhập tay dùng `POST /v1/transactions` trực tiếp, không qua hàng đợi — đúng D12 ("chia tiền vẫn cần mạng"), nhưng nghĩa là khoản thu không thể ghi trước khi offline rồi chia sau.
- [OPEN] Toast của mua tài sản / chuyển nội bộ / cho vay hay nhận lại **không** gắn khoản phải thu không nói hệ quả (chỉ "Đã ghi …"), khác luật "toast luôn nói kết quả kèm hệ quả" (`docs/DESIGN.md` §4) — `doneText` (`web/src/state/store.ts`). Có khoản phải thu thì toast đã nói còn bao nhiêu chưa trả (AC-16).
- [DIVERGENCE] Proposal `261001-cho-thue-lai` UC-802: "Loại khác" có nút mang tên người thuê ("An chi"); code là một loại chung **Người thuê chi** với ô "Ai chi" (`KINDS`, `TenantPaidForm`).
- [OPEN] Ô **Thuế** vẫn hiện và vẫn gửi `taxable` khi đã chọn Nguồn thu hay người thuê, nhưng chia theo nguồn **không bao giờ** trích thuế (`src/domain/allocation.ts`) — chọn "Chưa — để riêng thuế" lúc đó không có tác dụng gì, giao diện không nói.
- [OPEN] Ô Nguồn thu liệt kê nguồn đang dùng, còn chọn người thuê thì nguồn rỗng nghĩa là "Theo cấu hình cho thuê" — nếu nguồn cho thuê trong cấu hình đã bị tắt, server từ chối `inactive_income_stream` sau khi người đã thấy bảng chia thử (chia thử vẫn tìm thấy nguồn tắt).

### [pwa/UC-706-gan-giao-dich-ngan-hang.md](pwa/UC-706-gan-giao-dich-ngan-hang.md)
- [DIVERGENCE] `docs/wireframe.md` §3 thứ tự sheet "meaning → ví → danh mục → tài khoản"; code đặt danh mục trước ví (chọn danh mục thì tự điền ví) — `AssignSheet`.
- [OPEN] Ô ví dùng `spendableWallets` (bỏ ví cá nhân của người kia) cho cả dòng hoàn tiền; chưa rõ có trường hợp cần hoàn về ví cá nhân của người kia. Chọn khoản chi gốc ở ví cá nhân người kia thì ô ví điền ví cùng phe của người đang nhập — đúng ví server ghi (`walletFor`), không phải ví khoản gốc đã trừ.
- [OPEN] Ô "Tiền sang/Tiền từ" liệt kê mọi tài khoản (kể cả tài khoản nối feed) trừ tài khoản của log; phía máy không kiểm cặp chuyển nội bộ giữa hai tài khoản có feed. Chân còn lại của chuyển nội bộ **đã ghi** thì server tự gắn (ADR-81); chân kia chưa về thì gán vẫn ghi một chân, chân kia về sau sẽ được gắn vào (ingest UC-303 bước 2b).
- [DIVERGENCE] PWA có chip "khớp mẫu lương" và nhánh banner theo `suggestion.is_salary`, nhưng server không bao giờ trả `is_salary` trong gợi ý: log `in` chỉ có gợi ý người thuê `{meaning: "income", tenant_id, label}`, gợi ý heo trả về `{meaning: "transfer", other_account_id, label, note}` (ADR-82), gợi ý khớp chuyển nội bộ đã ghi `{meaning: "transfer", other_account_id, attach_to_tx, label}` (ADR-81) hoặc `null` (`src/services/ingest.ts` › `listPendingLogs`, `suggestFor`) — chip này hiện không thể xuất hiện. Change `261001-cho-thue-lai` thêm điều kiện `!tenant_id` cho chip (gợi ý người thuê không bao giờ thành "khớp mẫu lương"), không đổi kết luận.
- [DIVERGENCE] Khi `create_rule: true` mà rule không tạo được, server vẫn gán và trả `ruleSkipped` kèm lý do (ingest UC-305 alt 4a); PWA bỏ qua trường này, toast chỉ nói kết quả gán (bước 10), không nhắc rule.
- [OPEN] Gợi ý người thuê cần một rule mang `tenant_id`, nhưng rule đó chỉ tạo được qua REST `POST /v1/rules` (`src/routes/logs.ts`): Cài đặt › Mã chuyển khoản không có ô người thuê, ô "Lần sau tự gán giao dịch có nội dung giống thế này" chỉ tạo rule chi/chuyển (`createRuleFromSplit`), MCP không có tool tạo rule.
- [OPEN] Dòng Thu nhập thường có cả ô Nguồn thu và ô Thuế; chọn nguồn thì chia theo nguồn **không** trích thuế, nên "Chưa — để riêng thuế" mất tác dụng mà giao diện không nói (cùng [OPEN] ở UC-705).

### [pwa/UC-707-xem-vi-va-quy.md](pwa/UC-707-xem-vi-va-quy.md)
- [DIVERGENCE] `plans/.../phase-05-pwa.md` "4. Ví & Quỹ": "Ví vừa được bù hố tháng trước hiện dòng phụ 'đã bù 150.000 cho tháng trước'" trong bảng ngân sách; code chỉ hiện "đã bù X" ở bảng **chia thử** (`AllocationPreview`, `web/src/screens/other-entry-sheet.tsx:75-80`), bảng ngân sách không có vì `/v1/budget` không trả `deficitCovered` (báo cáo `ui-ux-designer-260922-0020-pwa-mobile-offline.md`, mục "Chưa làm"). Lý do Status = partial. BR-02 ("giao diện ghi rõ 'đã bù X'") hiện chỉ được thoả ở lúc chia. Vẫn đúng sau change `261001-cho-thue-lai` và commit `11c52a0`: `/v1/budget` có thêm `balance` nhưng không có `deficitCovered`; dòng "Số dư thật … — vượt từ trước, chưa bù" + **Bù** (UC-712) là chuyển ngân sách tay, không phải dòng "đã bù X".
- [OPEN] "Tài sản đang giữ" chỉ lọc trong 200 giao dịch gần nhất (`/v1/transactions?limit=200`) nên sẽ sót khi lịch sử dài hơn (cùng báo cáo trên).
- [OPEN] Tab Nợ không có chỗ sửa tên/ghi chú hay tắt một khoản nợ hay khoản phải thu: `PATCH /v1/debts/:id`, `PATCH /v1/receivables/:id` (debt UC-901, receivable UC-1001) chỉ gọi được qua API; khoản đã tắt không hiện ở tab nên cũng không bật lại được từ app.

### [pwa/UC-708-dem-vi-nhap-so-du-that.md](pwa/UC-708-dem-vi-nhap-so-du-that.md)
- [OPEN] Sheet cho chọn cả tài khoản có feed (dùng `boot.accounts`, không lọc `manualAccounts`), trong khi tab Tài khoản chỉ đưa nút "Nhập số dư thật" cho tài khoản không feed. Việc chặn đếm tài khoản có feed còn log chưa gán nằm hoàn toàn ở server (D14).
- [OPEN] Ghi chú trong sheet khẳng định phần dư/thiếu vào "ví nhận phần còn lại" — luật này thuộc ledger; PWA chỉ hiển thị câu, không kiểm.

### [pwa/UC-709-sua-cau-hinh-man-cai-dat.md](pwa/UC-709-sua-cau-hinh-man-cai-dat.md)
- [OPEN] Bản cài đặt lưu trên máy (IndexedDB `{member}:settings` và cache `vi-nha-api` của `/v1/settings`) chứa địa chỉ webhook và gợi ý 4 ký tự cuối của khoá; được xoá khi đăng xuất/đổi người (UC-701), nhưng không khi phiên hết hạn (`toLogin`).
- [OPEN] Báo cáo `ui-ux-designer-260922-1150-settings-screen.md` để ngỏ: nghĩa của Q/E trong quy ước mã; số dư đầu âm cho thẻ tín dụng (ô hiện chỉ nhận số không âm); có nên hiện nhóm ví `holding`.
- [OPEN] Ô Nguồn thu của mã lương chỉ có khi **sửa**; thêm mã lương mới không chọn được nguồn (phải lưu rồi mở lại) — `RuleSheet` (`!isNew`), `rulePayload`.
- [OPEN] Không có chỗ nào ở Cài đặt gắn mã chuyển khoản với người thuê (`rules.tenant_id`), nên gợi ý "Thu từ {tên}" ở màn Gán (UC-706) không cài được từ app.

### [pwa/UC-710-mo-app-khi-mat-mang.md](pwa/UC-710-mo-app-khi-mat-mang.md)
- [OPEN] `GET /v1/session` cũng được service worker lưu và trả khi offline; app coi bản lưu đó như phiên hợp lệ (không đọc `cachedAt` ở `api.get`). Hệ quả: vào app offline bằng người trong bản lưu, dù cookie có thể đã hết hạn; lần gửi đầu khi có mạng gặp 401 → về màn đăng nhập (hàng đợi giữ nguyên — UC-704).
- [OPEN] Precache không gồm `/icons/icon-512.png` và `/icons/icon.svg` (chỉ `icon-192`, `apple-touch-icon` và file bundle — `vite.config.ts`).
- [OPEN] Chưa thử "Thêm vào màn hình chính" trên iPhone thật và chưa chạy Lighthouse PWA (`phase-05-pwa.md` Todo; báo cáo `ui-ux-designer-260922-0020-pwa-mobile-offline.md` mục "Chưa làm").
- [OPEN] Sau khi clone phải chạy `npm run build` trước `npm run dev` vì Worker cần thư mục `public/` (cùng báo cáo, câu hỏi mở 1).

### [pwa/UC-711-khung-dieu-huong-va-luat-hien-thi.md](pwa/UC-711-khung-dieu-huong-va-luat-hien-thi.md)
- [DIVERGENCE] `docs/wireframe.md` §2: "Nút `+` nổi ở mọi màn"; code ẩn FAB ở Nhập, Cài đặt, Sổ giao dịch và Hướng dẫn (`web/src/app.tsx` › `App`), khớp `docs/DESIGN.md` §4 ("ẩn ở màn Nhập, Cài đặt và Sổ giao dịch" — chưa nhắc Hướng dẫn) — DESIGN.md thắng wireframe theo `context.md`.
- [DIVERGENCE] `docs/DESIGN.md` §9 hướng dẫn ánh xạ token qua `tailwind.config`; code dùng Tailwind v4 với `@theme inline` trong `web/src/styles.css` (báo cáo `ui-ux-designer-260922-0020-pwa-mobile-offline.md`). Cùng token, khác cơ chế.
- [OPEN] Sheet có thanh nắm nhưng không vuốt xuống để đóng được; chạm nền đóng ngay kể cả khi form đã sửa (vd Chốt tháng) — audit 261001 F18, bỏ qua ở commit `11c52a0` vì công lớn (M). Chưa có quyết định làm.
- [OPEN] App mở vào Hôm nay hay Nhập (cùng báo cáo, câu hỏi mở 4); hiện mặc định Hôm nay.

### [pwa/UC-712-chuyen-ngan-sach-va-bu.md](pwa/UC-712-chuyen-ngan-sach-va-bu.md)
- [DIVERGENCE] Proposal `261001-cho-thue-lai` (v5) không có dòng Tổng chi tiêu, dòng ví âm + **Bù**, nút **Chuyển ngân sách** hay card quỹ giữ riêng; nó chỉ nói "Dùng tiền trong Thu cho thuê … không cần code mới": Trả nợ = `spend` từ `rental-income` danh mục `debt-payment`; sang Tích sản = `transfer` MB → BIDV kèm ví `rental-income` → `wealth-building`. Code thêm các nút trên; riêng "Chuyển sang Tích sản" ở card chỉ đổi số giữa hai ví, **không** chuyển tiền giữa tài khoản (`BudgetTab`, `web/src/screens/wallets.tsx`).
- [OPEN] Không có gì chặn ngân sách bị chuyển hai lần khi người vừa bấm "Chuyển sang Tích sản" ở card, vừa gán log chuyển khoản thật với **Từ ví**/**Đến ví** (UC-706) cho cùng một khoản tiền.
- [OPEN] (ADR-82) Tiền heo rút về tài khoản vẫn thuộc Tích sản "cho tới khi anh tự chuyển ví", nhưng sheet Chuyển ngân sách bỏ Tích sản khỏi **Từ ví** (`moveWallets(…, "from")`) và server từ chối ví nguồn Tích sản (`locked_wallet`, E1) — app chưa có đường đưa tiền đó ra khỏi Tích sản; chủ nhà chưa quyết.
- [DIVERGENCE] Proposal ghi ví `rental-income` có `kind = holding`; migration 0007 seed `kind = 'accrual'`. PWA phân biệt quỹ giữ riêng với ví Thu nhập đúng bằng `kind` (`isIncomeHolding` = tier `holding` **và** kind `holding`), nên code nhất quán; proposal sai.
- [OPEN] Server trả trạng thái **ví nhận** cho chuyển ngân sách (`createEntry`), nhưng toast chỉ "Đã ghi chuyển ngân sách." (`doneText` chỉ dùng trạng thái ví cho `spend`/`refund`) — không nói ví vừa bù còn bao nhiêu, khác luật "toast nói kết quả kèm hệ quả" (`docs/DESIGN.md` §4).
- [OPEN] "Bù" tay không để lại dấu "đã bù X" trong bảng ngân sách (xem [DIVERGENCE] ở UC-707); sau khi bù, số Còn lại vẫn đỏ vì đo chi so với dự kiến kỳ, chỉ dòng "Số dư thật … chưa bù" biến mất.
- [OPEN] Dòng Tổng tính ô ẩn số (ví riêng tư của người kia) là 0 ở cả Dự kiến và Thực tế, không có dấu hiệu nào cho biết tổng đang thiếu phần đó (`budgetTotals`).

### [pwa/UC-713-man-nguoi-thue.md](pwa/UC-713-man-nguoi-thue.md)
- [DIVERGENCE] Proposal `261001-cho-thue-lai` UC-804: bảng kê có dòng "đề xuất chuyển tháng sau = phí cố định + phần chi chung theo ngân sách"; bảng kê server dựng (`statementText`, `src/domain/rental.ts`) không có dòng này — PWA chỉ chép nguyên `text`.
- [DIVERGENCE] Proposal UC-805 ghi `TenantLine(payment)` khi nhận tiền; code không có loại `payment`: tiền trả là khoản `income` mang `tenant_id`, màn này đọc nó vào nhóm "Đã chuyển" (`payments`), huỷ khoản thu thì số dư tự trở lại.
- [OPEN] Nút Chốt hiện cả ở **tháng hiện tại** (server chỉ chặn tháng chưa tới): chốt giữa tháng thì tổng chi chung bị lưu ở mức lúc chốt (`tenant_settlements.shared_total`), khoản chi chung sau đó trong tháng không còn vào phần người thuê. Proposal chỉ nói chốt ngày 1 cho tháng trước.
- [OPEN] "Huỷ dòng" có ở mọi dòng sổ, kể cả dòng `opening` và các dòng đã chốt; huỷ dòng chốt không gỡ `tenant_settlements`, nên tháng vẫn "Đã chốt" và không chốt lại được — cách sửa duy nhất là ghi Chỉnh (đúng câu hướng dẫn trên màn, nhưng chưa có quyết định cho việc huỷ nhầm cả bộ dòng chốt).

### [pwa/UC-714-bat-thong-bao-tren-may-nay.md](pwa/UC-714-bat-thong-bao-tren-may-nay.md)
- [OPEN] Hai bộ đoán nhãn máy khác nhau: dòng trạng thái dùng `web/src/lib/push.ts` › `deviceLabel` (biết iPadOS qua điểm chạm, Opera, ChromeOS, không rõ → "Máy không rõ"), còn danh sách dùng nhãn server (`src/services/push.ts` › `deviceLabel`, chỉ có User-Agent) — cùng một iPad hiện "iPad · Safari" ở trên nhưng "Mac · Safari" trong danh sách.
- [OPEN] `localStorage` bị chặn (E3) và người trước không Đăng xuất (phiên hết hạn rồi người khác đăng nhập): bước 11 không biết máy đang gắn ai, nên gửi lại subscription và **chuyển máy sang người vừa vào** mà người đó không bấm Bật — người mới nhận tin trên máy người trước đã bật.
- [OPEN] Trạng thái `on` chỉ dựa vào quyền + subscription ở máy, không hỏi server: máy bị server xoá (404/410) vẫn hiện "Đang bật" tới lần vào app sau (bước 11 tạo lại dòng).
- [OPEN] Chưa thử trên iPhone thật (thêm vào MH chính, bật, nhận, bấm mở màn) — cùng mục [OPEN] ở UC-710.

### [pwa/UC-715-xem-sua-xoa-giao-dich.md](pwa/UC-715-xem-sua-xoa-giao-dich.md)
- [OPEN] Không có "Hoàn tác" trên toast sau khi lưu (toast chỉ là chữ); xoá nhầm thì nhập lại.
- [OPEN] Sửa khoản chi ở màn Nhập chọn danh mục mới thì ví tự điền theo người đang sửa (như khi nhập), còn server đổi ví cá nhân theo người ghi khoản cũ — vợ sửa khoản của chồng mà chọn danh mục trỏ ví cá nhân sẽ thấy ví của mình trên form nhưng sổ ghi ví của chồng.

### [pwa/UC-716-so-giao-dich.md](pwa/UC-716-so-giao-dich.md)
- [DIVERGENCE] Proposal nói "+ Ghi khoản" mở "sheet Nhập (máy tính)"; máy tính không có sheet Nhập — nút mở màn Nhập như phím N, ngày điền sẵn và quay về sổ như điện thoại.
- [OPEN] Tìm khớp chữ đã lưu (`LIKE`) và dạng bỏ dấu của **chữ tìm**, nên "thuốc" ra cả "Thuốc ho" lẫn nội dung ngân hàng "THUOC"; chiều ngược chưa có: "thuoc" không ra ghi chú / tên danh mục "Thuốc …", "THUỐC" không ra "Thuốc" (LIKE chỉ bỏ qua hoa thường với chữ không dấu). Cần cột chuẩn hoá chữ đã lưu (migration) — chưa ai cần.
- [OPEN] Tiêu đề ngày cộng chi của **các dòng đã tải**: ngày nằm vắt qua cuối một lượt tải thì số chi của ngày đó thiếu cho tới khi tải thêm (tự tải khi cuộn tới).
- [OPEN] Mất mạng: danh sách và tổng có thể là bản service worker lưu của đúng đường dẫn đó (dòng tổng nói "số lúc HH:mm"); tải thêm hay bộ lọc chưa từng xem thì báo "Không có mạng." — không có sổ offline đầy đủ.

## Cho thuê lại (rental) — 2 divergence, 18 open

### [rental/UC-801-thiet-lap-nguoi-thue.md](rental/UC-801-thiet-lap-nguoi-thue.md)
- [OPEN] Cho người thuê ra không kiểm tháng cuối đã chốt hay số dư = 0; chỉ là quy trình. Người đã ra vẫn chốt tháng được (`settleMonth` không kiểm `active`) và vẫn ghi được `one_off`/`adjust` (chỉ `paid_for_us` bị chặn).
- [OPEN] Sửa/tắt phí cố định đổi bản nháp của **mọi** tháng chưa chốt, kể cả tháng đã qua (nháp luôn dùng danh sách phí hiện tại).
- [OPEN] Ví "Thu cho thuê" chỉ tạo được bằng migration: Cài đặt không tạo được ví tier `holding` (`TIERS` trong `src/services/settings.ts`) và không tắt được ví tier `holding` (`required_wallet`). Thêm ví giữ riêng thứ hai cần SQL.
- [OPEN] `sort` của phí nhận mọi số nguyên (kể cả âm); `name` cắt im lặng ở 120 ký tự.

### [rental/UC-802-ghi-nguoi-thue-chi-ho.md](rental/UC-802-ghi-nguoi-thue-chi-ho.md)
- [OPEN] Gửi lại `client_id` của một dòng đã `void` vẫn trả dòng void với 200 (tra theo `client_id`, không lọc `status`) — giống [OPEN] tương tự ở ledger UC-101.
- [OPEN] Danh mục chi chung được kiểm **lúc ghi**; bỏ danh mục khỏi cấu hình sau đó thì chi hộ cũ vẫn cộng vào tổng chi chung (câu `sharedTotal` cộng mọi `paid_for_us` của tháng, không lọc theo danh mục hiện tại), trong khi phần chi của hộ ở danh mục đó thì không còn được cộng.
- [OPEN] Chi hộ của **mọi** người thuê cộng vào một tổng chung rồi chia đều; một người thuê chi hộ nhiều thì các người thuê khác cũng chịu phần đó — đúng công thức proposal, nhưng chưa được nói rõ khi có hơn một người thuê.
- [OPEN] Dòng ghi tay không giới hạn tháng: ghi lùi ngày vào tháng đã chốt được (dòng vào tháng đó, số dư đổi), nhưng tổng chi chung đã lưu lúc chốt không đổi theo.

### [rental/UC-803-xem-tam-tinh.md](rental/UC-803-xem-tam-tinh.md)
- [DIVERGENCE] Proposal v5 (UC-804) muốn bảng kê có dòng "đề xuất chuyển tháng sau = phí cố định + phần chi chung theo ngân sách"; `statementText` không có dòng này — chỉ có số dư cuối và "Còn phải trả"/"Trả dư".
- [OPEN] Tổng chi chung gồm mọi `spend`/`refund` của hộ trong danh mục chi chung, kể cả chi từ ví `private` hay ví cá nhân; người xem không ảnh hưởng (không ẩn theo D6).
- [OPEN] Tháng đã qua chưa chốt dùng phí và số người **hiện tại**, không phải của tháng đó.
- [OPEN] `month_key` của tiền đã chuyển theo ngày tiền về (giờ VN); tiền tháng 10 chuyển ngày 2/11 nằm ở tháng 11 — đúng ý "chênh lệch tự mang sang", nhưng bảng kê tháng 10 sẽ báo "Còn phải trả".

### [rental/UC-804-chot-thang-voi-nguoi-thue.md](rental/UC-804-chot-thang-voi-nguoi-thue.md)
- [OPEN] Chốt được cả **tháng hiện tại** khi chưa hết tháng (`parseMonth` chỉ chặn tháng sau). Chi chung phát sinh sau lúc chốt không vào `shared_total` đã lưu và không vào dòng `shared` đã ghi — phải ghi `adjust` tay.
- [OPEN] Server không đối chiếu dòng `shared` gửi lên với `floor(shared_total / headcount)`; số người và số tiền dòng là do người nhập, `shared_total` lưu là số server tính.
- [OPEN] Không có đường "mở lại" một tháng đã chốt; huỷ hết dòng chốt vẫn để lại `tenant_settlements` nên tháng đó không bao giờ có lại bản nháp.
- [OPEN] Nhắc ngày 1 chỉ cho **tháng liền trước**; tháng cũ hơn chưa chốt không được nhắc. Nếu cron ngày 1 không chạy, không có nhắc bù.

### [rental/UC-805-nhan-tien-nguoi-thue-tra.md](rental/UC-805-nhan-tien-nguoi-thue-tra.md)
- [DIVERGENCE] Proposal v5 (allocation, "Dùng tiền trong Thu cho thuê"): sang Tích sản = `transfer` MB → BIDV kèm ví. PWA có thêm nút "Chuyển sang Tích sản" trên thẻ "Thu cho thuê" nhưng nút này mở **Chuyển ngân sách** (chỉ đổi ví, không đổi tài khoản — `web/src/screens/wallets.tsx`), nên khi Tích sản ở BIDV còn tiền nằm ở MB: số dư ví và số dư tài khoản lệch nơi ở, không có lệnh chuyển tiền nào được sinh. Cần quyết: nút này nên sinh lệnh chuyển tiền / mở "Chuyển nội bộ", hay giữ như ghi chú trong sheet ("ví nằm ở hai tài khoản khác nhau thì chuyển tiền thật bằng Chuyển nội bộ").
- [OPEN] Nguồn thu cho thuê khóa 100% nên khoản thu `taxable = true` của người thuê **không** bị trích Thuế (có nguồn thì engine không chạy luật thuế chung — UC-201).
- [OPEN] Người thuê trả bằng tiền mặt vào tài khoản tiền mặt của một thành viên: fund vào "Thu cho thuê" (trú ở MB) sinh lệnh chuyển tiền mặt → MB; chưa có quyết định đây có phải điều chủ nhà muốn.
- [OPEN] `suggestFor` chỉ trả gợi ý người thuê khi rule khớp; log `in` của người thuê không khớp rule nào không có gợi ý gì — người phải nhớ chọn "Thu từ người thuê", nếu không khoản đó vào luật % chung như lương.

## Sổ nợ (debt) — 1 divergence, 5 open

### [debt/UC-901-them-va-xem-khoan-no.md](debt/UC-901-them-va-xem-khoan-no.md)
- [OPEN] Số tiền mở sổ là số còn nợ **lúc bắt đầu theo dõi**; các lần trả trước đó (chi danh mục `debt-payment` không có `debt_id`) không được gắn lại vào khoản nợ — nếu nhập số gốc thay vì số còn lại thì còn nợ sẽ cao hơn thật, phải chỉnh tay (UC-904).

### [debt/UC-902-tra-no.md](debt/UC-902-tra-no.md)
- [OPEN] Toast tính còn nợ từ `bootstrap.debts` trên máy, không từ phản hồi server: offline hoặc khi người kia vừa trả cùng khoản thì "Còn nợ Y" có thể lệch với số thật cho tới lần tải lại.
- [OPEN] Không chặn trả quá số còn nợ: còn nợ âm (trả dư) chỉ hiện "Hết nợ."/nhóm "Đã trả xong", không có cảnh báo hay đường hoàn lại.
- [DIVERGENCE] [VAS 24](https://docs.kreston.vn/vbpl/ke-toan/chuan-muc-ke-toan/vas-24) §11(c)(d) xếp "Tiền thu từ các khoản đi vay" và "Tiền chi trả các khoản nợ gốc đã vay" vào **hoạt động tài chính** — không phải chi phí; app ghi trả nợ gốc là `spend` danh mục `debt-payment`: trừ ví, vào "đã tiêu" (`v_spent_*`), chi theo danh mục và trung bình chi nếu ví thuộc nhóm Must, trong khi tiền cho vay quay về đã thôi là "thu" (`collect`, ADR-72, VAS 24 §10(d)). Đề xuất (chưa làm, chủ nhà chưa quyết): thêm meaning `repay` đối xứng với `collect` — tiền **ra** khỏi tài khoản, gắn `debt_id`, không là "đã tiêu", không vào chi theo danh mục; còn việc ngân sách nào chịu khoản trả (hiện là ví giữ riêng "Thu cho thuê", ADR-63) thì đi kèm một bút toán chuyển ngân sách rõ ràng thay vì ẩn trong một khoản chi. Cho tới khi quyết, giữ `spend`: số còn nợ vẫn đúng (`v_debt_balance` chỉ đọc `amount`), chỉ có "đã tiêu" của ví trả nợ là tính cả tiền gốc.

### [debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md](debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md)
- [OPEN] `create_rule` vẫn chỉ lưu ví/danh mục (bảng `rules` không có `debt_id`): rule rút từ một lần gán trả nợ không mang khoản nợ, nên log cùng nội dung lần sau tự gán thành chi `debt-payment` **không** giảm còn nợ — người phải tránh tạo rule cho khoản trả nợ.

### [debt/UC-904-vay-them-chinh-huy-dong-no.md](debt/UC-904-vay-them-chinh-huy-dong-no.md)
- [OPEN] "Huỷ dòng" áp cả dòng `opening`: huỷ nhầm làm còn nợ âm bằng tổng đã trả và khoản rơi vào "Đã trả xong" — cách sửa là ghi dòng `adjust` (không có "mở lại" dòng đã huỷ).

## Sổ phải thu (receivable) — 0 divergence, 6 open

### [receivable/UC-1001-them-va-xem-khoan-phai-thu.md](receivable/UC-1001-them-va-xem-khoan-phai-thu.md)
- [OPEN] Số mở sổ là số người ta đang nợ **lúc bắt đầu theo dõi**; các khoản `lend` cũ (không có `receivable_id`) không được gắn lại, và tiền cho vay đã về trước đây mà ghi là `refund` vẫn nằm trong ví nó đã cộng (migration 0014 không sửa dữ liệu cũ). Chưa có quyết định có cần một bút toán chuyển ngân sách để kéo ví về đúng hay không.

### [receivable/UC-1002-cho-vay-tra-ho.md](receivable/UC-1002-cho-vay-tra-ho.md)
- [OPEN] Ô **cho ai** không bắt buộc: `lend` không gắn khoản phải thu vẫn ghi được (giữ hành vi cũ), nên tiền cho vay có thể "biến mất" khỏi sổ phải thu nếu người quên chọn — tài khoản vẫn đúng, chỉ sổ ghi nhớ thiếu.

### [receivable/UC-1004-chinh-huy-dong-phai-thu.md](receivable/UC-1004-chinh-huy-dong-phai-thu.md)
- [OPEN] Như sổ nợ (debt UC-904): "Huỷ dòng" áp cả dòng `opening`; huỷ nhầm làm còn phải thu âm bằng tổng đã nhận — cách sửa là ghi dòng `adjust`.

### [receivable/UC-1005-xem-buc-tranh-tien-that.md](receivable/UC-1005-xem-buc-tranh-tien-that.md)
- [OPEN] `cash` gồm `accounts.opening_balance` và mọi tài khoản đang dùng, kể cả tài khoản nối SePay còn log chưa gán: tiền đã về/đi ở ngân hàng mà chưa gán thì chưa có trong `cash` (ledger UC-106 `pending_net`). Khối không nhắc phần chưa gán.
- [OPEN] Không có tool MCP cho bức tranh này: Claude trả lời "nhà có bao nhiêu tiền" phải tự cộng tool `get_reconciliation` (`bookBalance`) — dễ cộng nhầm sổ ghi nhớ vào.
- [OPEN] Heo đất là tiền gửi có kỳ hạn (sổ tích lũy); VAS 24 §04 chỉ coi là tương đương tiền khi kỳ hạn ≤ 3 tháng. App vẫn để nó trong `cash` theo cách nhìn của chủ nhà (gốc chắc chắn, của nhà) và chỉ gắn nhãn "đã khóa" (ADR-77); từ ADR-82 nó còn là Tích sản tiền mặt (`wealthBuildingCash`, phao). Lãi chưa về tài khoản thì không có trong `cash`.

## Quyết định (ADR) — 9 divergence, 21 open

### [decisions.md](decisions.md)
- [DIVERGENCE] Luật 1 "không sửa đè": `src/services/ingest.ts` › `matchLog` gắn chân thứ hai bằng `UPDATE transactions SET log_id_2 = ? WHERE id = ? AND log_id_2 IS NULL` — sửa một cột không phải `status` trên dòng đã ghi. Chưa có quyết định nào nói đây là ngoại lệ được phép.
- [DIVERGENCE] Tài liệu nói I/O đi qua port `Store` · `Notifier` · `Config` (`docs/core_design_rules.md` §9, `README.md`), và SQL tập trung ở `src/db/queries.ts` (§10, `phase-01`). Code không có interface port nào: `src/domain/*` là hàm thuần nhận dữ liệu, còn `src/services/*.ts` gọi D1 trực tiếp; thư mục `src/db/` rỗng; không có `domain/reconcile.ts` (đối soát là view + `ledger.reconcile`).
- [DIVERGENCE] `docs/core_design_rules.md` §8 có tin "Lương về & đã chia: bảng chia + lệnh chuyển tiền cần làm"; không tìm thấy nơi nào trong `src/` gửi tin này khi `matchLog` tự chia lương (spec notify ghi là UC-409 spec-only).
- [DIVERGENCE] `docs/core_design_rules.md` §10 vẫn ghi "schema.sql (v1.3) … 13 bảng + 15 view" và `src/db/queries.ts`; `docs/schema.sql` thực tế là v1.14 với 26 bảng (thêm `allocation_runs` ở v1.4, sáu bảng nguồn thu/người thuê ở v1.7, `push_subscriptions` ở v1.8, `push_test_series` ở v1.9, cột `accounts.sepay_out` ở v1.10, khoá giờ nhắc trong `config` ở v1.11, làm tròn giờ nhắc ở v1.12, `debts`/`debt_lines` ở v1.13, `receivables`/`receivable_lines` và meaning `collect` ở v1.14), 18 view và 10 trigger.
- [OPEN] Schema vẫn cho `accounts.kind='credit'` và `transactions.source='import'` dù thẻ tín dụng và import là non-goal; chưa có quyết định giữ hay bỏ.
- [DIVERGENCE] `phase-02-allocation-core.md` "Chốt kỳ" ghi `batch_id = sweep-<month_key>`; code dùng `S<YYYYMM>` (`src/services/ledger.ts:309`).
- [OPEN] `plans/reports/ui-ux-designer-260922-0020-pwa-mobile-offline.md` ghi dòng "đã bù …" chưa hiện được ở bảng Ví & Quỹ vì `/v1/budget` không trả `deficitCovered` (chỉ có ở bảng chia thử).
- [DIVERGENCE] `migrations/0002_seed.sql` vẫn là tài khoản mẫu VCB/TCB/MB (`vcb-anh`, `tcb-anh`, `mb-anh`, `vcb-em`), tất cả `sepay_enabled=1`; chủ nhà được hướng dẫn sửa ở màn Cài đặt (`plans/reports/summary-260922-0130-overnight-build.md` "Để dùng thật").
- [OPEN] Red team money-correctness #2/#3: `book_drift` chỉ so giao dịch sinh từ log với chính log đó, không thấy bút toán nhập tay/`adjust` cùng tài khoản. Lỗ đếm-hai-lần được chặn bằng D14 (ADR-48) chứ không bằng đổi công thức `v_reconcile`.
- [DIVERGENCE] `docs/core_design_rules.md` §6 có bước 2 riêng "tài khoản đối ứng thuộc `accounts` của hộ → `transfer`"; code gộp bước 2 vào bước 3 vì payload SePay không có trường tài khoản đối ứng (giả định chưa kiểm bằng payload thật).
- [OPEN] Resource `pf://rules` không làm (`plans/reports/fullstack-developer-260922-0020-mcp-server.md` "Việc chưa làm"). Phần "đường xác thực bằng header chưa làm" đóng bởi ADR-97 (OAuth Bearer token).
- [OPEN] Chủ nhà chưa trả lời: giữ hay đổi mã `EMS`; mã `QTT` nạp vào ví nào (`summary-260922-0130-overnight-build.md` câu 2, 3). Code không có lớp an toàn cho mã trùng từ thông dụng.
- [OPEN] Chủ nhà chưa xác nhận mức 1.000.000 ₫ (`summary-260922-0130-overnight-build.md` câu 5).
- [DIVERGENCE] `safety_fund_months` (trước v1.28: `emergency_months`, ADR-92): server nhận 1–36 (`src/services/settings.ts` › `updateConfig`, `max: 36`), client chỉ cho 1–24 (`web/src/lib/settings.ts` › `configPayload`).
- [OPEN] Change 261001 chỉ chốt nơi đặt Tích sản; nơi đặt ví **Thuế** vẫn chưa ai nói.
- [DIVERGENCE] ADR-17 (D5): chủ nhà xác nhận MB có đủ tiền vào lẫn tiền ra; tài liệu SePay (21/9 và đọc lại 1/10/2026) ghi MBBank "Tiền ra: Không". Chưa có quan sát thật (ADR-57 còn treo). Giải bằng cờ theo từng tài khoản: mặc định theo tài liệu (`sepay_out=0` cho MB), chủ nhà bật sau khi thử — không chọn một bên cho cả hệ thống.
- [OPEN] TK "chỉ tiền vào" mà SePay thật ra có báo tiền ra: khoản đã nhập tay và log `out` cùng tồn tại; app chỉ nhắc, không chặn người gán tiếp — gán là đếm hai lần, `book_drift` không thấy (chỉ so log với giao dịch sinh từ log).
- [OPEN] Rà soát đêm lỗi ở một kết nối chỉ ra `console.error` + `errors` trong kết quả; tin sáng không báo "rà soát SePay của vợ thất bại" (như ingest UC-304 [OPEN]).
- [OPEN] Sổ log không phân biệt `ignored` vì trước mốc với `ignored` do người bấm Bỏ qua — chỉ suy ra được bằng cách so ngày log với `opened_at`.
- [OPEN] `opened_at` mặc định `date('now')` là ngày UTC: tài khoản thêm trước 07:00 sáng giờ VN nhận mốc là hôm qua, nên giao dịch của hôm qua lọt vào sổ dù số dư đầu có thể đã gồm chúng.
- [OPEN] Theo tài liệu SePay, MB không báo tiền ra (`sepay: { in: true, out: false }`): nếu SePay thật sự không gửi log làm tròn của `mb-main-husband`, khoản bỏ heo không bao giờ tới màn Gán — phải ghi tay (Nhập › Chuyển nội bộ kèm chuyển ví Có thì tốt → Tích sản, ADR-82). Đếm số dư tài khoản heo (UC-105) thay cho ghi tay thì phần chênh vào ví Có thì tốt (ví nhận phần còn lại), không vào Tích sản — phải chuyển ngân sách Có thì tốt → Tích sản thêm một lần (UC-712).
- [OPEN] VAS 24 §04 xếp tiền gửi **không kỳ hạn** vào "Tiền"; sổ tích lũy là tiền gửi có kỳ hạn — đúng chuẩn mực thì chỉ là tương đương tiền khi kỳ hạn ≤ 3 tháng. App vẫn để heo trong "Tiền thật đang có" theo cách nhìn của chủ nhà (gốc chắc chắn, của nhà) và gắn nhãn "đã khóa".
- [OPEN] Lãi chỉ vào sổ khi về tài khoản; trong lúc sổ còn chạy, số dư heo trên app MB có thể lớn hơn sổ app (lãi dồn tích) — đếm số dư heo theo app MB sẽ ghi phần chênh là `adjust` vào Có thì tốt, không phải thu nhập.
- [OPEN] Lời nhắc "tới khi anh tự chuyển ví" nhưng Tích sản khóa chiều ra: chuyển ngân sách hay chuyển khoản kèm ví **từ** Tích sản đều bị `locked_wallet` (ledger UC-101, pwa UC-712). App chưa có đường đưa tiền heo đã rút về ra khỏi Tích sản; chủ nhà chưa quyết.
- [OPEN] Heo trả về nhiều hơn sổ heo (lãi, hoặc tiền heo có từ trước khi dùng app vì heo mở sổ với `opening_balance = 0`): gán cả số tiền là Chuyển nội bộ thì sổ heo âm đúng phần đó; không còn lời nhắc tách lãi. Người gán tự tách dòng Thu nhập, hoặc nhập số dư đầu thật / đếm số dư heo (UC-105).
- [OPEN] Trả **thiếu** (mua hộ 244.000, người ta trả 240.000): phần thiếu 4.000 treo ở sổ phải thu (còn nợ 4.000). Xoá bằng **Chỉnh** ở sổ phải thu (receivable UC-1004) chỉ sửa sổ nhớ — chưa có cách ghi phần thiếu thành một khoản chi của nhà (trừ ví, vào danh mục). Cần thiết kế riêng; chủ nhà chưa quyết.
- [OPEN] Tắt một tài khoản đang giữ tiền Tích sản / Thuế (vd TCB Tích sản, MB Thuế của seed) → số thấp hơn thật đúng phần đó. Chủ nhà chọn giữ luật (lời dặn) hay app tự coi số dư tài khoản trú của ví là tiền của ví khi tài khoản đó tắt.
- [OPEN] Khoản thu chưa chia (ví Thu nhập) và ví giữ riêng (Thu cho thuê) vẫn nằm trong tiền chi được.
- [OPEN] So mẫu rule heo trong SQL bằng `UPPER`/`INSTR`, không bỏ dấu như `matchRule`: mẫu có dấu sẽ không đếm log chờ (ledger UC-107).
- [OPEN] Tài khoản thường tắt công tắc mà giữ tiền Tích sản / Thuế vẫn bị trừ hai lần (ADR-85) — đánh dấu Phao dự phòng nếu là tiền để dành Tích sản.
