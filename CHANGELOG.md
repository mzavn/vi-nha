# Nhật ký thay đổi

Số phiên bản theo [SemVer](https://semver.org/lang/vi/) `X.Y.Z`: **Z** tăng khi chỉ sửa lỗi; **Y** tăng khi thêm tính năng mà
bản cài cũ vẫn lên được bình thường (kể cả nâng database tự động); **X** tăng khi cập nhật cần bạn tự làm thêm một bước.

Bản nào cần nâng cấp database thì có ghi rõ. Database tự nâng khi bạn cập nhật, không phải làm gì thêm — nhưng nên sao lưu
trước (xem README › Cập nhật bản mới).

## v3.0.1 — 13/11/2026

- Báo cáo › Cân đối trên máy tính: "Vốn chủ sở hữu" không còn bị ép thành chữ dọc.
- Máy tính bật / tắt chế độ gọn ở menu "…" cạnh tên người dùng (thanh bên).
- Phần Tự do và sheet tham số dùng tên mới "Ngưỡng và tỉ lệ" thay "Tham số".

## v3.0.0 — 13/11/2026

- **Hôm nay gọn 4 khối:** Vận hành, Việc tháng này, Cần xem, Gần đây; các thẻ Tích luỹ và Dự phòng dời sang màn Tài khoản, bỏ thẻ Sổ giao dịch. Nút "Trả ›" mở thẳng sheet Trả nợ hoặc điền sẵn khoản phải trả.
- **Màn Tài khoản 4 tab với Ba ngăn:** tab Ba ngăn hiển thị toàn bộ tài khoản theo 3 ngăn Vận hành, Tích luỹ, Dự phòng kèm chấm màu ngăn; khối Tích luỹ có tài sản đang giữ; khối Dự phòng có mục tiêu, phần an tâm và Ví Thưởng. Các tab còn lại: Chi tiêu · Nợ · Cho thuê (bỏ khối tiền/vốn chủ lặp ở tab Nợ).
- **Báo cáo 4 phần gọn gàng:** Cân đối (gồm Tháp tài sản ngay dưới bảng cân đối), Dòng tiền, Thu chi, Tự do (gộp Mốc tự do và Dự tính thử số).
- **Hoàn tác thay hỏi lại:** xoá khoản một chạm có nút Hoàn tác; hoàn tác cho cả Gán lại, Bỏ qua log ngân hàng, và Chia / Để lại Vận hành tháng dư.
- **Thiết lập nhà lần đầu trực quan hơn:** hỏi số dư ban đầu từng tài khoản, câu hỏi thuế mặc định "Không" và có gợi ý giải thích.
- **Nút ⓘ giải thích thuật ngữ:** chạm mở câu giải thích ngắn gọn, dễ hiểu ngay tại chỗ cho các thuật ngữ và số liệu quan trọng.
- **Dấu tự gán:** các khoản do quy tắc ngân hàng tự động gán được gắn chip "tự gán", sheet chi tiết có thông tin mẫu và nút "Sửa mẫu ›".
- **Chế độ gọn (chỉ ghi chi):** bật trong Cài đặt › Máy này để ẩn bớt các phần quản lý, chỉ giữ lại những gì cần thiết cho việc ghi chép hằng ngày.
- **Trạng thái rỗng có hướng dẫn:** mọi danh sách khi chưa có dữ liệu đều hiển thị câu hướng dẫn và gợi ý bước tiếp theo rõ ràng.
- **Trả nợ gốc ở Chi tiêu rõ hơn:** hàng "Trả nợ" ghi "Trả gốc X ₫, không tính vào chi" thay cho số 0 (tiền gốc trả lại không phải tiêu xài nên không cộng vào Đã chi); tháng không trả gốc thì ẩn hàng này.
- **Thứ viết tắt T2…T7, CN:** đầu màn Hôm nay và tiêu đề ngày trong Sổ giao dịch gọn một dòng.
- **Giao diện mới tối giản:** chữ to và rõ hơn, số tiền dùng font số thẳng cột dễ đối soát, bố cục thoáng gọn, không dùng dải màu phân tán sự chú ý.
- **Thanh dưới mới 4 mục:** Hôm nay · Sổ · Gán · Tài khoản; ghi nhanh khoản chi bằng nút "+" nổi (kèm số giao dịch chưa lên sổ khi mất mạng).
- **Đổi tên màn và mục cho trực quan:** Ví & quỹ → Tài khoản, Tài sản & tự do → Báo cáo, Nhìn lại → Chi tiêu, Người thuê → Cho thuê, Gán giao dịch → Chưa gán, Tháp → Tháp tài sản, Lưu chuyển tiền → Dòng tiền, Thử số → Dự tính; các mục Cài đặt dùng tên rõ nghĩa (Ngân hàng và tin nhắn, Trợ lý AI, Ngưỡng và tỉ lệ, Danh mục và hạn mức).
- **Font nằm sẵn trong app:** tải sẵn cùng app shell, không gọi Google Fonts bên ngoài, mở offline đúng chữ ngay lần đầu và bảo vệ quyền riêng tư người dùng.
- **Tin nhắn không còn emoji:** thông báo Telegram, Zalo và web push chuyển sang chữ thuần gọn gàng, tập trung vào số liệu đối soát.
- **Gọn và đều tay hơn ở Ghi khoản, Gán, Cài đặt, Cho thuê và mọi bảng kéo lên:** mỗi hàng chỉ một dòng phụ, thao tác của hàng mở khi chạm cả hàng thay vì nút to trên từng hàng; mọi bảng kéo lên có nút chính dính ở đáy; danh mục ở Ghi khoản không còn khung lồng khung; chạm trên điện thoại không còn để lại hàng trông như đang chọn; ở máy tính nút Ghi khoản và các mục thanh bên cùng cỡ, thẳng hàng.
- Nội dung chuyển khoản trong mã QR không còn chữ "Tich luy" (vốn trùng mẫu tự gán của heo đất MB nên khoản trích bị gán nhầm vào heo đất) — giờ là mã việc, xem dòng "Mã riêng trong nội dung chuyển khoản" bên dưới.

Có nâng cấp database: `0046` (tháng dương lịch thay kỳ lương), `0047` (mã việc trong nội dung chuyển khoản), `0048` (hoàn tác chia dư và đánh dấu khoản tự gán). Database tự nâng khi cập nhật; không xoá dòng nào — lịch sử
kỳ lương cũ được giữ, chỉ đọc.

- **Báo cáo theo tháng:** Nhìn lại, hạn mức nhóm, Tích luỹ, phần an tâm, khoản phải trả, sổ giao dịch, tin sáng và tin tuần
  giờ tính từ ngày 1 tới cuối tháng. "Chi khoảng …/ngày" vẫn tính tới ngày lương.
- **Lương về gọn hơn:** chỉ còn một nhắc "Trích Tích luỹ 10%" (kéo 1 · 10 · 30, có QR, tự tick khi chuyển). Không còn danh
  sách việc ngày lương và công tắc "Mở kỳ lương". Khoản thu từ 5.000.000 không gắn nguồn sẽ được hỏi "Đây là lương?" (đổi
  ngưỡng ở Cài đặt › Tham số).
- **Nhắc trích chỉ tự tick với khoản chuyển từ 100.000 ₫:** tiền lẻ heo đất tự gom (8.000, 1.000…) không còn bị tính là đã
  trích Tích luỹ. Dòng "Tháng này" của thẻ Tích luỹ vẫn cộng mọi tiền vào; trích bằng cách khác thì bấm "Đã chuyển".
- **Mã riêng trong nội dung chuyển khoản:** mỗi nhắc trích và việc chia dư có QR mang một mã như `TL 7K2Q T11` (trích lương),
  `CD 9F3A T11` (chia dư vào Tích luỹ), `VT 2M8X T11` (Ví Thưởng). Chuyển khoản ngân hàng báo về có mã đó thì app gán đúng
  việc, kể cả khoản nhỏ, và không bị mẫu tự gán khác gán nhầm. Mã chỉ được nhận khi có đủ đuôi tháng (`T11`) đúng tháng của
  việc, nên tên cửa hàng tình cờ bắt đầu bằng "VT…" hay "CD…" không bị nhận nhầm.
- **Chia dư cuối tháng:** từ ngày 1, app hỏi "Tháng trước dư bao nhiêu — chia Tích luỹ / Ví Thưởng?". Số dư đã trừ tiền đang
  chờ chuyển, khoản phải trả tháng mới và tiền ăn tiêu tới ngày lương. Lần hỏi đầu tiên là ngày 1/12 cho tháng 11.
- **Mới: tuổi tiền.** Thẻ Vận hành cho biết tiền đang tiêu về cách đây bao nhiêu ngày — bước đầu để sống bằng lương tháng trước.
- **Danh sách Mục tiêu Dự phòng dễ đọc hơn:** tài khoản chung là một khung có số dư to; mỗi mục tiêu tên đậm, số bên phải, chip
  "Đủ" / "Thiếu …" và thanh tiến độ; khoản trả từ tiền chi tiêu tách riêng, ghi "tháng này đặt …" khi có số riêng.
- **Thẻ Vận hành dễ đọc hơn:** "Chi khoảng …/ngày" là số chính, dưới là "còn … · N ngày tới lương"; bữa ăn / đi chợ thành hai ô
  nhỏ; khoản phải trả, nợ ngắn hạn, tuổi tiền thành các hàng nhãn – số (hai hàng đầu chạm được), không còn chữ gạch chân.
- **Thay đổi API / MCP:** `opens_cycle` → `is_salary`; `payCycle` → `month` / `monthClose`; `nearSpend.cyclePayday` →
  `salaryPayday`; Nhìn lại và sổ giao dịch bỏ `cycle`; `cycle_limit` → `monthly_limit`; thêm `config.salary_reminder_min`.
  Gửi trường cũ → lỗi `model_changed`. Thêm `POST /v1/month-close/:month/reopen` (hoàn tác chia dư), `POST /v1/logs/:id/unignore`
  (hoàn tác Bỏ qua), `transactions.rule_id` và `rule` ở `GET /v1/transactions/:id` (khoản tự gán), `accounts[].opening_balance` ở
  `POST /v1/setup`.
- Sửa nhiều lỗi giao diện máy tính và điện thoại: bảng thẳng hàng, phân trang một dòng, thanh dính nền đặc, chân thanh bên gọn,
  điều hướng mục con thống nhất (cột mục lục trái / một hàng tab), danh sách mục tiêu và tài khoản không lồng khung, form cùng cỡ,
  ⓘ mở khối riêng; app không tự phóng to trên iPhone, sheet luôn cuộn được.

## v2.4.1 — 12/11/2026

- Trang cấp quyền khi nối Claude ghi đúng chữ của v2: quyền Xem "Ba ngăn, chi khoảng mỗi ngày, mục tiêu, giao dịch, sổ nợ", quyền Ghi "Ghi giao dịch, gán, cập nhật giá tài sản" (bỏ chữ "ngân sách", "chia tiền").
- README có ảnh minh hoạ của bản 2.x.

## v2.4.0 — 12/11/2026

Có nâng cấp database: `0045` (số kỳ này và danh mục của khoản phải trả). Database tự nâng khi cập nhật; chỉ thêm bảng, không
đổi số dư, mục tiêu hay giao dịch nào.
**Mới**

- **Số kỳ này cho khoản phải trả.** Trong sheet **Khoản phải trả kỳ này** (thẻ Vận hành) chạm một khoản để đặt số cho riêng
  kỳ lương này — 0 cũng được (kỳ này không phải trả), kèm lý do ngắn nếu muốn. "Chi khoảng …/ngày" tính theo số đó; kỳ sau tự
  về số mỗi tháng. Dòng "đã trả đủ ✓" cũng mở được sheet.
- **Chi theo danh mục tự tính là đã trả.** Sheet mục tiêu "Trả thẳng từ tiền chi tiêu" có hàng **Danh mục tự tính là đã trả**
  (vd Điện nước mạng cho khoản Điện nước): khoản chi từ tiền chi tiêu thuộc danh mục đó mà không chọn khoản phải trả nào vẫn
  tính là đã trả. Mỗi danh mục thuộc một khoản; khoản chi đã chọn khoản phải trả thì chỉ tính cho khoản đó.
- API: `PUT /v1/pay-cycle/goal-amounts/:goalId { amount, note }`; `category_ids` ở mục tiêu; `operating.goals[]` có
  `cycleAmount`, `note`, `categoryIds`.

**Thay đổi**

- **Nhắc "cần chuyển thêm vào tiền chi tiêu" chỉ khi thiếu tiền cho các khoản chắc chắn** — việc ngày lương chưa làm và các
  khoản phải trả còn lại kỳ này (theo số kỳ này). Không còn cộng phần ăn tiêu ước tính từ chi tiêu trung bình, nên thẻ Vận
  hành không còn vừa ghi "chi khoảng …/ngày" vừa nhắc chuyển thêm một số lớn. Áp dụng cho thẻ Vận hành, tin sáng và Claude.

## v2.3.1 — 12/11/2026

**Sửa**

- Nhắc "cần chuyển thêm vào tiền chi tiêu" (thẻ Vận hành, tin sáng, Claude) không còn gợi ý lấy tiền từ tài khoản riêng tư
  của người khác, cũng không hiện tên hay số dư của tài khoản đó; chỉ chủ tài khoản thấy nó trong lời gợi ý. Mã QR cũng
  không chuyển vào tài khoản riêng tư của người khác: không còn tài khoản chi tiêu nào khác thì chỉ ghi "Chuyển vào tiền chi
  tiêu", không có QR.
- Sheet **Trích Tích luỹ**: trên điện thoại thanh kéo nằm dưới nhãn, rộng hết sheet (không còn bị đẩy sang phải); gõ số 0 thì
  nhãn ghi "0% khoản lương" và không vạch nào sáng.
- Màn chuyển đổi bước 2 trên điện thoại: ô chọn tài khoản chỉ ghi tên, không còn cắt "…"; số đã có và "dùng chung với …"
  hiện đủ ở dòng dưới, như sheet mục tiêu ở Cài đặt.
- Ví Thưởng làm tài khoản mẹ được: ô **Thuộc tài khoản** có Ví Thưởng, sheet Ví Thưởng có nút **+ Thêm khoản gửi kỳ hạn**.

## v2.3.0 — 12/11/2026

Có nâng cấp database: `0044` (tài khoản con cho khoản gửi kỳ hạn, mục tiêu trả thẳng từ tiền chi tiêu). Database tự nâng khi
cập nhật; chỉ thêm cột, không đổi số dư, mục tiêu hay giao dịch nào.

- **Khoản gửi kỳ hạn là tài khoản con.** Trong sheet tài khoản chọn **Thuộc tài khoản** (vd khoản gửi 6 tháng mở từ tài
  khoản tiết kiệm): khoản gửi theo ngăn, riêng tư, chủ của tài khoản mẹ; mục tiêu gắn tài khoản mẹ thấy cả tiền trong khoản
  gửi. Danh sách tài khoản lồng khoản gửi dưới tài khoản mẹ. Tài khoản tiền gửi riêng đang có đổi thành tài khoản con được.
- **Tiền lãi không tính vào mục tiêu.** Khoản thu ghi **Đây là tiền lãi** (bật sẵn khi tiền về khoản gửi) thành tiền lãi của
  nhóm tài khoản; thẻ Dự phòng hiện "Tiền lãi … (không tính vào mục tiêu)". Muốn tiêu tiền lãi thì chọn **Từ tiền lãi** khi
  chi / chuyển ra. Lãi máy đã tự ghi từ trước vào tài khoản có mục tiêu thành tiền lãi ngay sau khi cập nhật, nên tiền của
  mục tiêu có thể giảm một lần.
- **Mục tiêu trả thẳng từ tiền chi tiêu.** Khoản trả mỗi tháng (điện nước, thuốc, về quê…) chọn **Trả thẳng từ tiền chi
  tiêu**: không phải chuyển tiền, app chừa phần còn phải trả khỏi "Chi khoảng …/ngày" ("Đã chừa … cho … khoản phải trả kỳ
  này"). Khi chi chọn **Cho khoản phải trả**. Tháng nào không dùng hết thì phần đó vào dư kỳ trước như mọi tháng.
- **Nhắc chuyển thêm vào tiền chi tiêu.** Tiền chi tiêu không đủ cho khoản phải trả và ăn tiêu tới ngày lương thì thẻ Vận hành
  và tin sáng nhắc "cần chuyển thêm …", gợi ý lấy từ Ví Thưởng trước rồi tới tiền an tâm, kèm mã QR.
- **Thang Tích luỹ 1 · 10 · 30%.** Chạm số tiền việc trích Tích luỹ để kéo thanh có vạch tối thiểu · thường · hướng tới; thẻ
  Tích luỹ và Nhìn lại cho biết kỳ này đạt mức nào. Không trích kỳ này vẫn được, chỉ cần ghi lý do.
- Phần an tâm không còn tính khoản gửi của tài khoản có mục tiêu hay của Ví Thưởng.
- Màn chuyển đổi bước 2 đổi tên "Chọn nơi để tiền cho từng khoản", ô chọn không còn cắt chữ.
- API: `parent_account_id`, `pays_from`, `is_interest`, `from_interest`; snapshot có `topUp`, `operating.goals`,
  `nearSpend.goalRemaining`; `GET /v1/goals` có cả mục tiêu trả từ tiền chi tiêu.
- Màn bản tính người thuê: trên máy tính chân trang (tổng + **Chốt & gửi**) nằm sát đáy, không còn che ô **Tài khoản nhận**; trên điện thoại nút **＋** không còn che dòng tổng và nút **Chốt & gửi**.
- Cài đặt trên điện thoại: hàng nhảy mục tô đúng phần đang xem (vd **Cho thuê**).

## v2.2.0 — 11/11/2026

Có nâng cấp database: `0043` (bản tính tháng cho người thuê).
Database tự nâng khi cập nhật; số dư từng người thuê, bảng
cân đối, tài sản ròng không đổi. Mỗi tháng đã chốt thành bản tính tháng đó **đã gửi**; người thuê đang ở có phí cố định được
sẵn một bản **nháp** của tháng chưa chốt gần nhất (gồm các phí cố định). Phí cố định, số người chia và danh mục chi chung bỏ.

- **Người thuê làm lại: bản tính tháng.** Mỗi người thuê mỗi tháng một bản tính, khoản chia hai nhóm "Chi phí cứng" (tiền
  nhà, gửi xe, mạng) và "Chi phí" (ăn, điện, nước). Lập bản tính tháng mới là chép tháng trước, chỉ sửa vài con số; mỗi khoản
  hiện số tháng trước, khoản "Chi phí" vừa chép nhắc "kiểm lại số". Ghi được số âm (người thuê đi chợ hộ, trừ tiền cọc…).
- **Chốt & gửi kèm mã QR.** Tin gửi người thuê có từng khoản, tổng tháng, so với tháng trước; nợ hoặc trả dư các tháng trước
  là một dòng riêng, mã QR chỉ lấy tiền của tháng đó. Chọn tài khoản nhận ngay trên bản tính. "Gửi cho …" chia sẻ tin kèm ảnh
  QR (hoặc chép tin).
- **Sửa được sau khi gửi.** Bấm Sửa, "Lưu & gửi lại": số dư người thuê tự đúng, nhật ký ghi tổng cũ → mới, bản tính hiện
  "Đã sửa — gửi lại" tới khi bạn gửi lại.
- Tiền chuyển về có nội dung đúng mã QR của bản tính được gợi ý "Thu từ <tên>" (vẫn chỉ gợi ý, bạn bấm gán).
- **Tiền thuê không ghi vào tài khoản riêng tư** (ghi tay, sửa khoản, gán, Claude) — chọn tài khoản chung.
- Ngày 1, tin sáng nhắc "Lập bản tính tháng … cho <tên>" thay cho "Chốt tháng với …".
- Bỏ: phí cố định, chia chi chung theo số người, ghi tay chi hộ / phí một lần / chỉnh, "Người thuê chi" ở Loại khác. Dòng
  cũ vẫn nằm trong sổ, vẫn tính số dư.
- Claude (MCP): thêm `get_tenant_bill` (xem bản tính) và `set_tenant_bill_item` (sửa khoản trong bản nháp — tool ghi, kết
  nối Claude cần duyệt lại quyền tool); gỡ `add_tenant_shared_expense`; `list_tenants` trả bản tính tháng trước thay cho
  phí cố định. Còn 16 tool.
- API: thêm `POST /v1/rental/tenants/:id/bills`, `GET /v1/rental/tenants/:id/bills/:month`, `PUT /v1/rental/bills/:id`,
  `POST /v1/rental/bills/:id/issue`, `DELETE /v1/rental/bills/:id`; `/fees`, `/lines`, `/settle`, `/month` trả 410
  `model_changed`; `PATCH /v1/rental/config` chỉ còn `income_stream_id`; lỗi mới `tenant_private_account`, `bill_changed`,
  `bill_issued`, `duplicate_item`, `invalid_category`.

## v2.1.0 — 11/11/2026

Có nâng cấp database: `0042` (nhiều mục tiêu Dự phòng dùng chung một tài khoản; khoản chi ghi được "cho mục tiêu nào").
Database tự nâng khi cập nhật; số dư, báo cáo, thuế không đổi. Thứ tự mục tiêu ở Cài đặt được xếp lại theo hạn (giống Hôm nay).

- **Nhiều mục tiêu Dự phòng chung một tài khoản.** "Đã có" của từng mục tiêu chia từ số dư tài khoản theo thứ tự ưu tiên
  (mặc định hạn gần trước; đổi thứ tự ở Cài đặt › Ba ngăn › Mục tiêu Dự phòng › Đổi thứ tự). Mục tiêu cuối nhận phần còn
  lại. Thẻ Dự phòng ở Hôm nay nhóm theo tài khoản: "thiếu", "đủ" hoặc "dư" cho cả nhóm.
- **Thuế giữ tài khoản riêng.** Tài khoản của mục tiêu Thuế không gắn được mục tiêu khác.
- **"Cho mục tiêu"** khi chi hay chuyển tiền ra từ tài khoản có từ hai mục tiêu (nhập nhanh, Loại khác, Gán, sửa khoản,
  MCP): khoản chi cho mục tiêu nào thì không làm hụt các mục tiêu đứng trước nó; thẻ hiện "đã chi … kỳ này". Tài khoản một
  mục tiêu tự gắn, không hỏi.
- **Việc ngày lương**: các việc nạp cùng một tài khoản có một mã QR gộp.
- API: thêm `PUT /v1/settings/goals/order`; `goal_id` ở ghi / sửa / gán giao dịch; `snapshot.pockets.accounts[].goalId` đổi
  thành `goalIds`, thêm `reserve.groups`; lỗi tài khoản Ví Thưởng đổi mã thành `account_is_reward`; lỗi mới
  `tax_account_shared`, `invalid_order`, `invalid_goal`.
- Sửa: chữ còn sót của mô hình ví ("Chi thiết yếu tháng", "Đếm số dư", ghi chú Phải thu); nhật ký thay đổi có nhãn cho mọi
  việc; bước 2 màn chuyển đổi không cắt tên tài khoản dài; "Số mỗi tháng" ở Thiết lập có dấu chấm nghìn; thẻ Tích luỹ hiện
  đúng % đã cài; tab Tích luỹ đọc đủ mọi khoản mua tài sản.

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
