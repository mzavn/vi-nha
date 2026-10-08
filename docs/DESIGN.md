# DESIGN.md — Ví nhà

Hệ thống thiết kế cho app Profit First hộ gia đình. Đây là **nguồn sự thật về giao diện**:
`pf-wireframe.html` là bản dựng tham chiếu, file này là luật. Khi hai cái lệch nhau, sửa file HTML theo đây.

> Đọc kèm: `profit_first_phuong_phap.md` (nguyên lý) · `core_design_rules.md` (luật nghiệp vụ) · `wireframe.md` (4 màn).

---

## 1. Thiết kế phục vụ điều gì

App này không phải dashboard tài chính. Nó là **một cái phanh đặt đúng chỗ**: giữa lúc muốn tiêu và lúc tiêu thật.

Ba việc giao diện phải làm, xếp theo độ quan trọng:

1. **Trả lời một câu hỏi trong một giây** — "còn bao nhiêu để chi?". Mọi thứ khác là phụ.
2. **Ghi một khoản chi nhanh hơn là lười ghi** — dưới 5 giây, ba chạm, một tay.
3. **Nói thật khi thiếu tiền.** Luật gốc yêu cầu *sự eo hẹp phải nhìn thấy được*. Giao diện không được làm dịu con số xấu: vượt ngân sách thì hiện số âm màu đỏ, không đổi thành "đã dùng 104%" cho dễ nhìn.

Hệ quả thiết kế: **không có biểu đồ tròn, không gradient, không hoạt ảnh ăn mừng.** Tiền là chuyện nghiêm túc và lặp lại hằng ngày — giao diện phải chịu được việc mở 6 lần một ngày trong ba năm.

---

## 2. Ngôn ngữ thị giác

**Token của shadcn đặt trong cấu trúc của Shopify Polaris.**

- Từ **shadcn**: bảng màu neutral, viền mảnh một pixel, bo góc vừa (10px), **không đổ bóng**, chữ Inter, tương phản đến từ sắc độ chứ không từ màu.
- Từ **Polaris**: nền xám nhạt tách card trắng nổi lên, page header có một hành động chính, card có header riêng, banner trạng thái có màu ngữ nghĩa, bảng dữ liệu phẳng không viền dọc.

Vì sao ghép: shadcn cho sự điềm tĩnh, Polaris cho *cấu trúc quản trị* — và Polaris vốn sinh ra cho người bán hàng nhìn số tiền mỗi ngày, đúng bài toán ở đây.

---

## 3. Token

### Màu

| Token | Light | Dark | Dùng cho |
|---|---|---|---|
| `--bg` | `#f1f2f4` | `#0d0d0e` | nền trang |
| `--surface` | `#ffffff` | `#161718` | card, sheet, nav |
| `--surface-2` | `#fafafa` | `#1c1d1f` | header bảng |
| `--surface-3` | `#f6f6f7` | `#202123` | hover, thanh nền, trạng thái chọn |
| `--border` | `#e1e3e5` | `#2b2d30` | mọi đường phân cách |
| `--border-strong` | `#c9cccf` | `#3a3d41` | viền nút phụ |
| `--fg` | `#1a1c1d` | `#f2f2f3` | chữ chính, số tiền |
| `--fg-2` | `#5c5f62` | `#a7abaf` | nhãn, chữ phụ |
| `--fg-3` | `#6b6f73` | `#868a8e` | chú thích, đơn vị — đạt ≥ 4,5:1 trên nền (audit 261001 F06; trước là `#8c9196`, chỉ 3,2:1) |
| `--primary` | `#18181b` | `#f2f2f3` | nút chính (đảo màu ở dark) |
| `--ok` / `--ok-bg` | `#0f7b52` / `#e7f5ee` | `#5fd0a0` / `#12281f` | tiến độ quỹ, tiền vào |
| `--warn` / `--warn-bg` | `#8a6116` / `#fdf3dc` | `#e5b95c` / `#2a2214` | sắp vỡ ngân sách, đến hẹn |
| `--bad` / `--bad-bg` | `#b32318` / `#fdecea` | `#f08b80` / `#2c1817` | vượt chi, lệch đối soát |
| `--lock` / `--lock-bg` | `#3d3a6e` / `#eceaf6` | `#a9a3e8` / `#1d1b2e` | **phần tiền đã khóa** |

**Luật màu — quan trọng hơn bảng trên:**
- Màu chỉ mang **ý nghĩa trạng thái**, không bao giờ để trang trí. Không có card màu, không có nút màu vì cho đẹp.
- `--lock` (tím chàm) dành riêng cho Tích sản và Thuế. Đây là màu duy nhất trong app mang nghĩa *"không được chạm"* — thấy tím là biết tiền đã ra khỏi tầm với. Đừng dùng nó ở đâu khác.
- `--ok` **không dùng cho "đã tiêu ít"**. Tiêu ít không phải thành tích. Xanh chỉ dành cho *tiến độ quỹ* và *tiền vào*.
- Đỏ chỉ xuất hiện khi có việc phải làm: vượt chi, sổ lệch. Nếu màn hình đầy đỏ thì đó là sự thật, không phải lỗi thiết kế.

### Chữ

| Vai trò | Font | Cỡ | Weight | Tracking |
|---|---|---|---|---|
| Số hero ("còn để chi") | Inter | 40px | 600 | −0.035em |
| Số tiền lớn (nhập, sheet) | Inter | 38px | 600 | −0.03em |
| Tiêu đề trang | Inter | 19px | 650 | −0.018em |
| Tiêu đề card | Inter | 14px | 600 | −0.01em |
| Thân | Inter | 14px | 400 | 0 |
| Nhãn, phụ | Inter | 12.5px | 400 | 0 |
| Chú thích | Inter | 11.5px | 400 | 0 |
| **Mọi con số trong bảng** | IBM Plex Mono | kế thừa | 450/600 | 0 |

- **Số tiền luôn `tabular-nums`.** Trong bảng dùng `.num` (IBM Plex Mono) để cột tiền thẳng hàng tuyệt đối — mắt phải so được độ dài số mà không cần đọc.
- **Không dùng chữ IN HOA** cho nhãn. Không có "eyebrow" phía trên tiêu đề.
- Một họ chữ cho toàn bộ giao diện, mono chỉ cho số. Không thêm họ thứ ba.

### Khoảng cách, bo góc, viền

- Nhịp 4px. Padding card `14px`, giữa các card `12px`, trong hàng `11px`.
- Bo góc: card `10px`, nút và ô nhập `7px`, chip `99px`, sheet `16px` (chỉ hai góc trên).
- **Không bóng đổ ở đâu cả**, trừ FAB (`0 6px 18px rgba(0,0,0,.22)`) vì nó nổi trên nội dung.
- Phân cách bằng viền 1px `--border`, không bằng khoảng trắng lớn. Màn hình này đặc dữ liệu, cần lưới rõ.

---

## 4. Component

### Page header
Dính trên cùng, có tiêu đề + phụ đề + **một** hành động chính. Chỉ thêm viền dưới khi cuộn (`.stuck`).
Mỗi màn đúng một primary action. Không có màn nào hai nút chính.

### Card
`header` (tiêu đề + gợi ý/chip bên phải) + `body`. Body dùng `.flush` khi chứa bảng hoặc danh sách hàng, để hàng chạm mép viền.
Cuối card có thể có `.note` — một câu giải thích *vì sao* con số trong card lại thế. Đây là chỗ dạy nguyên lý Profit First ngay tại nơi nó tác động, thay vì nhét vào màn hướng dẫn mà không ai đọc.

### Hero
Chỉ có ở màn Hôm nay, chỉ một cái. Nhãn nhỏ → số rất to → dòng ngữ cảnh → **các phong bì cộng thành số đó** (ví âm lên trước, đỏ) → ba số phụ ngăn bởi viền trên.
Số hero luôn là **số dùng để ra quyết định**, không bao giờ là tổng tài sản. Tổng tài sản không giúp ai quyết định có nên gọi ly cà phê thứ hai không.
Hero là tổng của nhiều phong bì nên phải kê từng phong bì ngay dưới: không để ví còn dư che mất ví đã âm.

### Banner
Đặt ngay dưới hero, trên mọi card. Có icon tròn nhỏ, câu ngắn in đậm phần quan trọng, và một liên kết hành động ở cuối.
Chỉ hiện banner khi **có việc phải làm**. Không có banner "mọi thứ ổn".

### Hàng tầng (tier row)
Bốn phần: tên + chip trạng thái · số · dòng phụ hai đầu · thanh tiến độ.
Chấm màu trước tên cho biết tầng thuộc nhóm nào (khóa / bị bóp trước / nhận phần dư). Chú giải đặt cuối card, chỉ một lần.

### Bảng
Header nền `--surface-2`, chữ 11.5px `--fg-3`. Cột đầu trái, mọi cột còn lại phải. Không viền dọc, không sọc ngựa vằn.
Dòng phụ dưới tên (11.5px `--fg-3`) để chứa ngữ cảnh: "SePay tự cập nhật", "nhập tay".
**Dưới 1024px không dùng bảng quá 2 cột số**: chuyển thành hàng tầng (tên · số quan trọng nhất to bên phải · dòng phụ). Bảng nhiều cột chỉ cho màn rộng.

### Chip
Nhãn trạng thái tròn, 11px. Bốn kiểu: trung tính, `lock`, `ok`, `bad`. Không dùng chip làm nút.

### Sheet
Trượt từ dưới, có thanh nắm, header dính, nút Đóng bên phải. Đóng được bằng scrim, nút Đóng, phím Esc.
Trong sheet: `seg` (nhóm nút chọn loại) → các `field` → banner cảnh báo nếu có → nút chính full-width ở cuối.
Sheet mở thẳng một việc (vd "Chia tiền" ở Hôm nay) thì tiêu đề nói đúng việc đó và **không** hiện `seg` chọn loại.
Danh sách dòng có thể sửa (vd Chốt tháng): mỗi dòng một hàng `tên · số · ×`, tổng dính ngay trên nút chính.
**Sheet là nơi mọi edge case được giải.** Không đẩy edge case ra màn riêng.

### Bottom nav + FAB
Bốn tab cố định. FAB `+` nổi góc phải, ẩn ở màn Nhập, Cài đặt và Sổ giao dịch (màn phụ có nút **+ Ghi khoản** riêng). Cả hai đều tôn trọng `env(safe-area-inset-bottom)`.
Khi FAB hiện, nội dung chừa thêm đáy bằng chiều cao FAB để FAB không che nút hay `.note` cuối trang.
Tab phụ trong một màn (vd Ví & quỹ) phải thấy hết trên 390px: cho xuống dòng, không cuộn ngang.
Chỉ dùng dưới 1024px — màn rộng hơn dùng thanh bên (xem "Màn hình rộng").

### Toast
Viên thuốc đen ở đáy, tự tắt sau 2,2s — câu dài ở lâu hơn (~60 ms mỗi ký tự, tối đa 8s) để kịp đọc. **Toast luôn nói kết quả kèm hệ quả**, không chỉ "Đã lưu":
> Đã ghi 250.000 ₫. Đi lại còn 950.000 ₫ tháng này.

Đây là chi tiết quan trọng nhất trong toàn bộ app: phản hồi ngân sách xuất hiện **ngay tại thời điểm chi**, chứ không đợi đến cuối tháng. Không có nó thì app chỉ là sổ ghi chép.

---

## 5. Pattern

### Tiền
- Định dạng `vi-VN`, dấu chấm phân nhóm, `₫` sau số: `1.250.000 ₫`.
- Trong bảng dày đặc có thể bỏ `₫` ở từng ô, ghi một lần ở header.
- Số âm: dấu `−` (U+2212, không phải gạch nối) + màu `--bad` + weight 550.
- Rút gọn chỉ dùng ở chỗ chật: `4,0tr`. Không bao giờ rút gọn số hero.
- **Không làm tròn** khi hiển thị số dư và số còn lại. Làm tròn là nói dối ở quy mô nhỏ.

### Kỳ
Tuần hiển thị `T38 (14–20/9)` — số tuần một mình vô nghĩa với người dùng. Tháng: `tháng 9/2026`.

### Ba trục
Ví · tài khoản · danh mục là ba thứ khác nhau (xem `profit_first_phuong_phap.md` §6), giao diện phải giữ chúng tách bạch:
- Ví luôn hiện kèm **còn lại**.
- Tài khoản luôn hiện kèm **lệch đối soát**.
- Danh mục luôn hiện kèm **so sánh kỳ trước**.
Đừng trộn ba thứ vào một bảng.

### Trạng thái rỗng
Màn Gán rỗng là **thành tựu**, không phải lỗi: "Không còn gì chưa gán. Sổ khớp ngân hàng."
Màn Nhập rỗng thì không tồn tại — nó luôn sẵn sàng nhận số.

### Trạng thái lỗi
Nói cái gì hỏng và làm gì tiếp theo, giọng của hệ thống, không xin lỗi:
> Sổ lệch 120.000 ₫ ở VCB. Có giao dịch chưa vào sổ. → Đối soát

Không viết "Rất tiếc, đã có lỗi xảy ra".

### Riêng tư
Ví `private` của người kia: hiện tên, ẩn số. Không hiện ô mờ hay biểu tượng khóa — chỉ đơn giản không có số ở đó.

### Ví âm
Ví có số dư âm (vượt từ kỳ trước, chưa bù) hiện **số dư thật** bằng một dòng riêng đỏ kèm nút **Bù**, tách khỏi "còn lại" của kỳ — hai nghĩa "còn" không nằm chung một ô.

### Cài đặt
Sắp mục theo tần suất dùng: Ví & số tiền nạp → Tài khoản → Cho thuê → Nguồn thu → Mã chuyển khoản → Thông báo → Thành viên; **Nâng cao** (Kết nối, Claude và ứng dụng AI, Tham số, Nhật ký thay đổi) gập sẵn; cuối trang (điện thoại) là **Máy này**. Thanh nhảy mục dính dưới header.
Trang uỷ quyền OAuth (`/oauth/authorize`) là trang HTML do Worker vẽ, không thuộc PWA: dùng cùng token màu / chữ qua `/oauth.css`, không script, chạm ≥ 44px.
Giao diện sáng/tối và Đăng xuất nằm ở mục **Máy này**, không ở màn Hôm nay.

---

## 6. Giọng chữ

- Xưng hô: không xưng hô. App nói về tiền, không nói về "bạn".
- Câu thường, không viết hoa đầu mỗi từ. Không dấu chấm than.
- Động từ chủ động, nút nói đúng việc sẽ xảy ra: **Chia và ghi sổ**, không phải "Xác nhận". Nút nói "Chia" thì toast nói "Đã chia".
- Tên gọi trong app dùng **từ nghiệp vụ tiếng Việt**, không dùng từ kỹ thuật:

| Đừng viết | Viết |
|---|---|
| Transaction, entry | giao dịch, khoản chi |
| Allocation, waterfall | chia tiền, dòng thác |
| Reconcile, drift | đối soát, lệch |
| Wallet balance | còn lại |
| Pending log | chưa gán |
| Transfer order | chuyển tiền cần làm |
| Target, mục tiêu (số định chi của ví) | dự kiến — "mục tiêu" chỉ dùng cho quỹ để dành có đích (Du lịch, phao) (ADR-74) |

- Ba từ giữ nguyên xuyên suốt vì chúng là khái niệm gốc: **ví**, **tài khoản**, **danh mục**. Không bao giờ dùng lẫn.

---

## 7. Sàn chất lượng

- Mobile-first, chạm tối thiểu 44px, thao tác chính nằm trong tầm ngón cái.
- Sáng/tối theo hệ thống, `data-theme` ghi đè được. Mọi màu qua token, không hardcode hex trong component.
- `prefers-reduced-motion` tắt mọi chuyển động. Hoạt ảnh duy nhất được phép là **phản hồi hành động** (sheet mở, toast hiện) — không có hiệu ứng trang khi cuộn.
- Focus nhìn thấy được: viền 2px `--fg`, offset 2px. Sheet đóng bằng Esc.
- Tương phản chữ/nền tối thiểu 4.5:1; màu không bao giờ là *kênh duy nhất* mang thông tin — vượt chi vừa đỏ, vừa có dấu `−`, vừa có chip "104%".
- Safe area: `env(safe-area-inset-*)` ở `:root`, nav, FAB, sheet.

---

## 7b. Màn hình rộng (≥ 1024px)

Mobile là bản gốc; màn rộng **chỉ thêm**, không đổi gì dưới 1024px (một mốc duy nhất; từ 1280px được thêm cột phụ).
- **Thanh bên** thay bottom nav + FAB: bốn mục + Sổ giao dịch + Cài đặt kèm số đếm, nút "Nhập khoản chi", trạng thái mạng/đồng bộ, người đang dùng. Phím **N** mở Nhập ở mọi màn (trừ khi đang gõ hoặc đang mở sheet).
- **Nhiều thông tin hơn, không trang trí hơn:** màn rộng dùng chỗ trống để hiện *thêm cột và thêm danh sách* (dự kiến / thực tế / còn lại / % / kỳ trước), không để phóng to hay thêm màu.
- **Banner thành danh sách việc cần làm** bấm được; Gán thành **master-detail** (danh sách trái, form phải) thay cho sheet.
- Sheet còn lại mở thành **hộp thoại giữa màn**.
- Mọi luật ở trên (token, giọng chữ, "không làm") áp nguyên cho màn rộng.

## 8. Không làm

- Biểu đồ tròn chia ngân sách. Nó đẹp và vô dụng: không đọc được "còn bao nhiêu".
- Huy hiệu, chuỗi ngày liên tiếp, ăn mừng khi tiết kiệm được. Đây không phải app habit.
- Ẩn con số xấu sau một cú chạm.
- Màn hướng dẫn nhiều bước lúc mở app lần đầu. Dạy bằng `.note` ngay tại chỗ.
- Cho phép sửa đè giao dịch cũ. Sai thì huỷ và ghi lại — giao diện phải phản ánh luật "sổ chỉ ghi thêm".
- Thêm họ chữ thứ ba, thêm màu ngữ nghĩa thứ năm, thêm bán kính bo góc thứ tư.

---

## 9. Ráp vào code (phase 05)

Lấy nguyên khối `:root` của `pf-wireframe.html` làm nguồn token, ánh xạ sang Tailwind:

```js
// tailwind.config — chỉ ánh xạ, không định nghĩa màu mới
theme: { extend: {
  colors: {
    bg:'var(--bg)', surface:'var(--surface)', border:'var(--border)',
    fg:'var(--fg)', 'fg-2':'var(--fg-2)', 'fg-3':'var(--fg-3)',
    ok:'var(--ok)', warn:'var(--warn)', bad:'var(--bad)', lock:'var(--lock)',
  },
  borderRadius: { card:'10px', ctl:'7px' },
  fontFamily: { sans:['Inter','system-ui','sans-serif'], num:['"IBM Plex Mono"','monospace'] },
}}
```

Component dựng theo thứ tự: `Card` → `Money` → `Banner` → `TierRow` → `DataTable` → `Sheet` → `Nav`.
`Money` là component, không phải hàm format — nó gánh cả tabular-nums, dấu `−`, màu âm, và quy tắc không làm tròn.
