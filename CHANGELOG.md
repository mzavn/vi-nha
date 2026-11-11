# Nhật ký thay đổi

Số phiên bản theo [SemVer](https://semver.org/lang/vi/) `X.Y.Z`: **Z** tăng khi chỉ sửa lỗi; **Y** tăng khi thêm tính năng mà
bản cài cũ vẫn lên được bình thường (kể cả nâng database tự động); **X** tăng khi cập nhật cần bạn tự làm thêm một bước.

Bản nào cần nâng cấp database thì có ghi rõ. Database tự nâng khi bạn cập nhật, không phải làm gì thêm — nhưng nên sao lưu
trước (xem README › Cập nhật bản mới).

## v2.0.0 — 11/11/2026

Có nâng cấp database: `0038` (ngăn cho tài khoản, mục tiêu Dự phòng, nhóm danh mục), `0039` (kỳ lương và danh sách việc
ngày lương; lệnh chuyển đang chờ thành "bỏ qua"), `0040` (xoá ví, luật nạp, phần khoá, lệnh chuyển, chốt tháng; giao dịch cũ
giữ nguyên, có nhãn "cách tính cũ"), `0041` (một tài khoản không thể vừa là Ví Thưởng vừa là tài khoản của mục tiêu; nhà
nào đang trùng thì bỏ chọn Ví Thưởng, mục tiêu giữ tài khoản).

**Bản đổi lớn, nâng cấp database lớn — đọc hết mục này và sao lưu trước khi cập nhật.** Database tự nâng khi cập nhật và
**không lùi lại được bằng nút Cập nhật**.

**Trước khi cập nhật: sao lưu**

- Chọn lúc cả nhà không ghi chép (~15 phút).
- Cài bằng lệnh (`npm run setup` / nhờ AI): trong thư mục `vi-nha` chạy

  ```bash
  mkdir -p .wrangler/backups
  npx wrangler d1 export vi-nha --remote --output .wrangler/backups/vi-nha-truoc-2.0.sql
  ```

  Mở được file (có hàng nghìn dòng `INSERT`) thì mới cập nhật. File chứa mọi giao dịch và khoá kết nối: không commit, không
  gửi ai. Nếu máy có nhiều tài khoản Cloudflare: đặt `CLOUDFLARE_ACCOUNT_ID` trước.
- Cài bằng nút Deploy: D1 tự giữ lịch sử 7 ngày (Time Travel). **Ghi lại giờ bạn bấm cập nhật.** Muốn chắc hơn: cài Node,
  đăng nhập `npx wrangler login` và chạy lệnh export ở trên với tên database của bạn.

**Nếu bước nâng database lỗi**: bấm **Retry** ở build Cloudflare, hoặc chạy lại `npm run deploy` (bước nâng sẽ tiếp từ chỗ
dừng). **Không** đưa code về bản 1.8 khi database chưa được khôi phục.

**Có gì thay đổi**

- **Ba ngăn thay cho ví**: Tích luỹ (trích trước, không đụng), Dự phòng (các khoản đã biết sẽ phải trả, phần còn lại là phần
  an tâm), Vận hành (tiền sống tới kỳ lương). Mỗi tài khoản thuộc một ngăn; tiền về tài khoản nào là tiền của ngăn đó. Mọi
  số là tiền thật trong tài khoản.
- **Mỗi mục tiêu Dự phòng là một tài khoản thật** (tài khoản phụ, sổ tiết kiệm…): số "đã có" là số dư của tài khoản đó.
  Không còn ví hay số "để riêng" trên giấy.
- **Hôm nay**: thẻ Vận hành (còn bao nhiêu, chi khoảng bao nhiêu mỗi ngày tới kỳ lương), thẻ Tích luỹ (kỳ này đã trích bao
  nhiêu %), thẻ Dự phòng (mục tiêu và phần an tâm). Bỏ Dòng thác, Quỹ an tâm.
- **Lương về → danh sách việc ngày lương** thay chia ví và lệnh chuyển: trích Tích luỹ, nạp mục tiêu (chuyển tới tài khoản
  của mục tiêu), dư kỳ trước. Mỗi việc có mã QR; tiền tới đúng tài khoản thì việc tự đánh dấu xong. Không còn mã PF, không
  còn chốt tháng.
- **Nhìn lại theo kỳ lương** thay Ngân sách: chi theo nhóm danh mục so hạn mức mềm (không âm, không bù), so kỳ trước, lãi
  vay dự kiến / đã trả.
- **Tài khoản riêng tư** thay ví riêng tư: người khác thấy tổng, không thấy từng khoản. Mặc định tắt. Người khác cũng không
  huỷ, sửa, gán, bỏ qua hay ghi khoản vào tài khoản riêng tư của bạn; chỉ chủ đổi được chủ tài khoản. Tin nhắn và thông báo
  gửi cả nhà gộp khoản của tài khoản riêng tư thành "N khoản của tài khoản riêng tư", không số tiền, không tên tài khoản;
  lương về tài khoản riêng tư thì tin "Lương về" không ghi số.
- Nhật ký ở Cài đặt ghi thêm: thêm / sửa nguồn thu, bỏ qua giao dịch ngân hàng, thêm / sửa danh mục, đổi chủ tài khoản.
- Nhập / Gán / Loại khác không còn ô ví. Tài khoản không còn vai trò heo đất / phao / sổ tiết kiệm hay công tắc "Tính vào
  tiền vận hành": chỉ có ngăn.
- Tin sáng mở đầu bằng hai số Vận hành; tin tuần theo nhịp Vận hành; có tin "Lương về · N việc". Báo cáo và Mốc tự do chia
  chi tiêu thành Thiết yếu / Mong muốn.

**Sau khi cập nhật: làm màn "Chuyển sang ba ngăn"** (5 bước, khoảng 10 phút; app tự mở lần đầu, bấm Để sau thì Hôm nay có
banner):

1. Xem lại ngăn của từng tài khoản → Xác nhận.
2. Gắn mỗi mục tiêu Dự phòng (app tạo sẵn từ ví cũ) với **một tài khoản thật** ở ngăn Dự phòng: chọn tài khoản có sẵn, thêm
   tài khoản mới, tắt mục tiêu, hoặc **để sau** (mục tiêu chưa có tài khoản thì chưa có việc nạp, Hôm nay nhắc mở tài
   khoản). Chọn tài khoản Ví Thưởng nếu dùng.
3. Đọc đối chiếu Tích luỹ: số ví Tích sản cũ khác tiền thật ở Tích luỹ thế nào. Chưa có tài khoản Tích luỹ thì nên mở một
   tài khoản thật cho nó.
4. Bật "Mở kỳ lương" cho nguồn lương chính.
5. Xem lại % trích Tích luỹ mỗi kỳ lương.

**Giao dịch cũ**: vẫn trong Sổ, nhãn "cách tính cũ", có loại chi (Thiết yếu / Mong muốn / Thuế / Tích luỹ) và lần chia (chỉ
xem); không còn tên ví.

**Lùi về bản cũ** (chỉ khi thật cần): khôi phục database về trước giờ cập nhật bằng `npx wrangler d1 time-travel restore`
(hoặc nạp lại file sao lưu) rồi deploy lại bản 1.8.0. Mọi thứ ghi sau giờ đó mất.

**Cho người tự cài, gọi API hoặc nối Claude — thay đổi phá vỡ**

- Bỏ đường (410 `model_changed`): `/v1/allocate*`, `/v1/month-close*`, `/v1/transfer-orders*`, `/v1/settings/wallets*`,
  `/v1/budget`, `/v1/wealth-building`.
- Tham số cũ bị từ chối (400 `model_changed`, kèm `fields`): `wallet_id`, `counter_wallet_id`, `from_wallet_id`,
  `wealth_move`, `allocate`, `wealth_amount`, `wealth_note`, `amounts`, `transfer_order_id`, `locks`, `default_wallet_id`,
  `month_close_wealth_pct`, `month_close_reward_wallet`, `spendable`, `locked`, `role`.
- Bỏ trường:
  - snapshot: `tiers`, `wallets`, `spendableThisWeek`, `spendableByWallet`, `reserves`, `safetyFund`, `goals`,
    `wealthBuilding`, `attention.unallocatedIncome`, `attention.transferOrdersPending`, `attention.transferOrdersOverdue`,
    `nearSpend.leaving`, `nearSpend.misplaced`, `nearSpend.excluded[].role`;
  - settings: `wallets`, `allocations`, `income_streams[].locks`, `accounts[].spendable|locked|role`;
  - bootstrap: `wallets`, `categories[].default_wallet_id`, `accounts[].locked`;
  - giao dịch: `wallet_id`, `counter_wallet_id`, `wallet_name`; nợ: `walletId` của dòng trả nợ;
  - networth: `wealthBuildingCash`, `wealthBuildingAccounts`, `spendableThisWeek`; `/v1/goals` dạng mới.
- Thêm:
  - snapshot `pockets`, `payCycle`, `paySetup`, `conversion`, `nearSpend.pendingTasks`;
  - giao dịch `legacy`, `legacy_class`;
  - settings `goals[]`, `config.surplus_reward_account`, `accounts[].private`;
  - `/v1/pay-cycle-tasks/:id/*`, `/v1/settings/goals`, `/v1/settings/goals/:id/account` (tạo tài khoản và gắn mục tiêu
    trong một lần, gửi lại không tạo thêm), `/v1/spend-by-category?cycle=`, `/v1/conversion`; `opens_cycle` khi ghi thu
    nhập.
- MCP: bỏ `allocate_income`, `preview_allocation`, `list_transfer_orders`, `get_budget`; `add_transaction` / `assign_log`
  không nhận trường ví; `get_snapshot`, `get_goals`, `get_spending_by_category` đọc ngăn và kỳ lương.
- Tài khoản riêng tư của người khác: giao dịch chỉ dính tài khoản đó → 404 ở mọi đường theo id; ghi / sửa / gán / bỏ qua
  chạm tài khoản đó → 403 `private_account` (MCP: lỗi `private_account`); `link` trỏ tới khoản bị giấu → `null`;
  `payCycle.tasks[].source` của khoản thu bị giấu → `{ hidden: true }`. Người cầm `API_TOKEN` vẫn đóng vai được bất kỳ ai.
- CSP bỏ `frame-src` (app không nhúng trang nào).

## v1.8.0 — 10/11/2026

Không nâng cấp database.

**Mới**

- **Mã QR cho lệnh chuyển tiền:** ở Ví & quỹ › Chuyển tiền, mỗi lệnh có nút **Mã QR** (máy tính: cạnh Chép nội dung; điện
  thoại: nút dài dưới các nút). Mã theo chuẩn VietQR, gói sẵn ngân hàng, số tài khoản nhận, số tiền và nội dung chuyển khoản
  (mã PF) — quét bằng app ngân hàng là xong, không phải gõ. Mã tạo ngay trên máy, không gửi số tài khoản đi đâu, mất mạng
  vẫn dùng được.
  - Trên máy tính: mở app ngân hàng trên điện thoại › Quét QR, quét màn hình.
  - Trên điện thoại: nhấn giữ mã để lưu ảnh (hoặc chụp màn hình), rồi trong app ngân hàng chọn Quét QR › chọn ảnh.
  - Trước khi chuyển, xem đúng tên người nhận và nội dung có mã PF — app dựa vào mã này để tự đánh dấu lệnh đã chuyển.
  - Tài khoản nhận là BIDV, MSB, OCB hay KienlongBank đã nối SePay qua tài khoản ảo (VA): mã dùng số VA để SePay báo được
    khoản đến.
  - Không thấy nút Mã QR? Tài khoản nhận cần có **Ngân hàng** và **Số tài khoản** trong Cài đặt › Tài khoản (app ghi rõ
    thiếu gì ngay dưới lệnh). Tiền mặt, ví điện tử, thẻ tín dụng và "Ngân hàng khác" không có mã QR.
  - Chế độ che số tiền không che mã QR (mã chỉ hiện khi bạn bấm).
- **Số lệnh chuyển tiền đang chờ** hiện thành huy hiệu nổi bật trên tab Chuyển tiền, thay cho số trong ngoặc; hết lệnh thì
  huy hiệu tự ẩn.
- **Sổ giao dịch dễ thấy hơn:** ở Hôm nay trên điện thoại, hàng Sổ giao dịch thành card đảo màu kèm biểu tượng sổ (nền sáng:
  card đen chữ trắng; nền tối: card trắng chữ đen).

**Cho người tự cài**

- API `GET /v1/transfer-orders` (và tool MCP `list_transfer_orders`) trả thêm thông tin tài khoản nhận: `to_kind`, `to_bank`,
  `to_account_no`, `to_sub_account`, `to_sepay_enabled`.

## v1.7.0 — 20/10/2026

**Mới**

- **Lọc sổ giao dịch theo khoảng ngày (từ ngày – đến ngày):** trong sheet Lọc sổ giao dịch (bấm nút Lọc cạnh ô tìm kiếm), bạn có thể chọn "Từ ngày" và "Đến ngày" để xem chi tiêu theo một kỳ lương hay một khoảng thời gian cụ thể (kể cả vắt qua nhiều tháng). Ngoài màn hình hiện chip ngày (ví dụ `1/9 – 15/9/2026 ×`) để bấm bỏ nhanh. Hai nút chuyển tháng `‹ ›` tự mờ đi khi lọc ngày; bấm nút "Theo tháng" hoặc chạm `×` trên chip ngày sẽ quay về tháng hiện tại. Nút "+ Ghi khoản" khi xem khoảng ngày trong quá khứ sẽ điền sẵn ngày cuối của khoảng đó.

## v1.6.0 — 18/10/2026

**Mới**

- **Lãi tiền gửi tự vào sổ:** ngân hàng trả lãi không kỳ hạn vài chục đồng (nội dung trống, chỉ "BankAPINotify" hay có "lãi
  tiền gửi") thì app tự ghi, không còn nằm ở màn Gán. Lãi cộng thẳng vào ví của chính tài khoản nhận: tài khoản phao / sổ
  tiết kiệm / heo đất → Tích sản; tài khoản chỉ có một ví → ví đó; còn lại → Có thì tốt. Không chia lương, không sinh lệnh
  chuyển tiền; báo cáo Thu chi xếp vào **Thu nhập thụ động**. Tin sáng có một dòng tổng lãi đã tự ghi hôm qua.
- Mức "tự ghi khoản dưới" đặt ở Cài đặt › Nâng cao › Tham số › **Lãi tiền gửi: tự ghi khoản dưới** (mặc định 10.000 ₫, tối
  đa 10.000.000 ₫, để 0 là tắt).
- Màn Gán có loại **Lãi tiền gửi** cho tiền vào: chọn ví nhận lãi rồi Gán — không chia, không lệnh chuyển tiền. Khoản lãi
  còn chờ gán (về trước bản này) được gợi ý sẵn "Lãi tiền gửi" kèm ví. Ghi nhầm thì gỡ gán khoản đó như mọi giao dịch ngân
  hàng.

## v1.5.0 — 17/10/2026

Có nâng cấp database: `0037` (chốt chặn thêm để một giao dịch ngân hàng không gắn vào hai khoản — không đổi số liệu).

**Sửa**

- Tài khoản vừa nối SePay: giao dịch SePay báo trễ mang giờ trước lúc nối mà bạn đã nhập tay trước đó thì app tự nối vào
  khoản đã nhập, không ghi lần hai. Nhập tay một khoản mà SePay vừa báo thì app nối luôn; SePay đã báo và khoản đã có trong
  sổ thì app hỏi lại trước khi ghi thêm (**Vẫn ghi** ở mục Chưa lên sổ nếu đúng là hai khoản).
- Màn Gán có mục **Đã nhập tay?**: khoản nhập tay cùng số tiền, cùng chiều, cách không quá 1 ngày hiện ra kèm nút **Nối** —
  gắn giao dịch ngân hàng vào khoản đó thay vì ghi thêm. Gỡ gán một khoản nhập tay đã nối chỉ gỡ giao dịch ngân hàng ra,
  khoản nhập tay vẫn giữ.

## v1.4.0 — 17/10/2026

Có nâng cấp database: `0035` (chỉ sửa cách tính đối soát — không đổi số liệu), `0036` (thêm mốc theo dõi SePay cho từng tài
khoản — tài khoản có sẵn để trống, số liệu không đổi).

**Sửa**

- Tài khoản mới nối SePay không còn báo lệch giả "Sổ khác giao dịch ngân hàng đã gán" bằng các khoản chuyển vào từ trước
  khi nối.
- **Nối SePay cho tài khoản đã dùng:** bật SePay cho tài khoản đã có giao dịch trong sổ thì app ghi mốc "SePay theo dõi từ"
  lúc bật. Giao dịch SePay trước mốc (rà soát đêm, Đồng bộ lại gửi lại lịch sử) không còn về màn Gán lần nữa, nên không bị
  ghi hai lần; khoản trước mốc vẫn nhập tay được. Cột "theo ngân hàng" ở tab Tài khoản khớp sổ cho tài khoản nối sau.
- Bật "SePay báo cả tiền ra" sau này: khoản chi trước lúc bật SePay gửi lại không tự gán theo mã chuyển khoản (đã nhập tay).
- **Tài khoản đã nối SePay từ trước bản này:** vào Cài đặt › Tài khoản › mở tài khoản. Nếu app gợi ý "Giao dịch SePay sớm
  nhất … sau ngày số dư đầu" và các khoản trước đó đã có trong sổ, bấm **Đặt mốc lúc đó** rồi Lưu. Làm trước lượt rà soát
  tuần (02:00 thứ Hai) hay rà soát tháng (02:00 ngày 1).

## v1.3.0 — 16/10/2026

Có nâng cấp database: `0034` (ghi lại tháng đã chốt và lý do khi không trả cho mình — không đổi số liệu cũ).

**Mới**

- **Chốt tháng có xem trước:** ví nào chi lố được bù trước bằng phần dư của ví khác. Phần còn lại chia giữa Tích sản và
  **Ví Thưởng** (mặc định 50/50, kéo được; tháng không cần thưởng thì để 100% Tích sản). Chọn Ví Thưởng ở Cài đặt › Tham số.
- **Có Tích sản / Không Tích sản khi chia một khoản thu:** chọn Có thì kéo thanh từ 1% đến 100% (mặc định 10%) hoặc gõ số
  tiền. Chọn Không thì phải ghi lý do, xem lại được ở tab Tích sản.

**Sửa**

- Nút ghi tiền vào dễ tìm hơn: màn Nhập và Hôm nay giờ có nút **Tiền vào** (trước là "Loại khác" và "Chia tiền").

**Thay đổi**

- Ngày 1 app **không tự quét** phần dư tháng trước sang Tích sản nữa: tin sáng nhắc, bạn mở app để chốt. Chưa chốt thì
  phần dư vẫn nằm trong số còn để chi.

## v1.2.0 — 13/10/2026

Không cần nâng cấp database.

**Mới**

- **Che số tiền:** bấm nút con mắt là mọi số tiền thành ••••, chỉ còn phần trăm, ngày, số lượng. Ô đang gõ vẫn hiện số. Mỗi máy
  nhớ riêng.
- **Mã PIN:** Cài đặt › Máy này › Mã PIN. App hỏi PIN khi mở, hoặc khi quay lại sau 1 phút. Quên PIN hay sai 5 lần thì máy đó
  đăng xuất, đăng nhập lại bằng mật khẩu rồi đặt PIN mới; khoản chưa gửi vẫn giữ.

## v1.1.0 — 13/10/2026

Có nâng cấp database: `0031`, `0032`, `0033` (thêm bảng mới cho tài sản, báo cáo, kế hoạch thu nhập — không đổi số liệu cũ).

**Mới**

- **Cập nhật từ trong app:** **Cài đặt › Nâng cao › Cập nhật Ví nhà › Kiểm tra bản mới**. Cài bằng nút Deploy thì bấm
  **Cập nhật** rồi **Run workflow** trên GitHub — workflow kéo bản mới vào repo của bạn, Cloudflare tự cài. Repo cài từ bản
  cũ (lần này): thêm `.github/workflows/update.yml` một lần — xem README › Cập nhật bản mới.
- **Tài sản & tự do** (màn mới): bảng cân đối của nhà, thêm vàng / chứng khoán / đất theo lô, giá chốt lời và cắt lỗ, tháp
  tài sản; lưu chuyển tiền, thu chi theo tháng; mốc tự do, kế hoạch thu nhập năm, thử số.
- **Khoản vay có lãi:** sổ nợ tính lãi hằng tháng; mỗi lần trả tự tách khoản lãi và khoản gốc.
- **Tự chia** một khoản thu: gõ tay số vào từng ví thay cho cách chia theo luật nạp.

**Sửa**

- Báo cáo giữ đúng kỳ đang xem khi tải lại trang (F5).

**Thay đổi**

- Cài bằng lệnh: lệnh cập nhật đổi thành `git pull --autostash && npm ci && npm run deploy` (`git pull` trần bị chặn vì
  `npm run setup` đã ghi `account_id` vào `wrangler.jsonc`).
- Mọi link SePay dùng link giới thiệu của Ví nhà.

## v1.0.1 — 08/10/2026

Không cần nâng cấp database.

**Mới**

- Đọc hướng dẫn ngay trong app: bấm **Hướng dẫn** là mở, không phải ra trình duyệt.
- Cài đặt › Máy này cho biết đang chạy phiên bản nào, kèm link tới mã nguồn.
- Chưa có SePay? Cài đặt › Kết nối có nút đăng ký.

**An toàn hơn**

- Nhờ AI cài thì AI không còn thấy mật khẩu chung: mật khẩu được lưu vào một file trên máy bạn, bạn tự mở xem.
- Cập nhật bản vá bảo mật cho thư viện nối Claude.
- File sao lưu database không còn dễ bị đẩy nhầm lên GitHub.

Cho người sửa code: CI chỉ có quyền đọc, Dependabot, cách báo lỗ hổng ở `SECURITY.md`.

## v1.0.0 — 08/10/2026

Bản công khai đầu tiên.

Ví nhà là sổ tiền của cả nhà theo Profit First: lương về là chia ngay vào các ví, phần cần giữ thì khoá lại, phần còn
lại là tiền được tiêu.

- Ghi khoản chi trong vài giây, biết ngay tuần này còn bao nhiêu.
- Chia thu nhập theo Profit First; ví, quỹ, sổ nợ, cho thuê.
- Nối SePay để giao dịch ngân hàng tự về.
- Nhắc việc qua thông báo trên máy, Telegram, Zalo.
- Hỏi số liệu nhà mình qua Claude.

Cài bằng nút Deploy to Cloudflare, `npm run setup` hoặc nhờ AI — xem README. Chạy được trên gói Cloudflare miễn phí.

Ghi chú: database dựng từ một file `migrations/0030_baseline.sql`; các bản sau đánh số từ `0031`.
