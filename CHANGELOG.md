# Nhật ký thay đổi

Số phiên bản theo [SemVer](https://semver.org/lang/vi/) `X.Y.Z`: **Z** tăng khi chỉ sửa lỗi; **Y** tăng khi thêm tính năng mà
bản cài cũ vẫn lên được bình thường (kể cả nâng database tự động); **X** tăng khi cập nhật cần bạn tự làm thêm một bước.

Bản nào cần nâng cấp database thì có ghi rõ. Database tự nâng khi bạn cập nhật, không phải làm gì thêm — nhưng nên sao lưu
trước (xem README › Cập nhật bản mới).

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
