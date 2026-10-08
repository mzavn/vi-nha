# UC-711: Khung điều hướng và luật hiển thị (DESIGN.md)
- Status: implemented
- BR: BR-01
- Decisions: D13 (mobile-first); `docs/DESIGN.md` §1–§8, §7b (màn rộng, commit `a68c9d6`); commit `0ee6969`, `032d089`; báo cáo `plans/reports/ui-ux-designer-260922-1210-desktop-redesign.md`; ADR-67 (audit 261001 F03, F06, F07, F23 và các luật mới của DESIGN.md); ADR-92 (địa chỉ màn tiếng Anh)
- Actor: mọi thành viên, trên điện thoại (< 1024px) hoặc máy tính (≥ 1024px)
- Trigger: mọi màn sau đăng nhập; đổi tab; phím **N**; đổi giao diện; mở màn phụ (Cài đặt, Sổ giao dịch, Hướng dẫn)

## History
- v1 (2026-09-22, commit `a756f68`): 4 tab cố định trong hash, FAB "+", toast 2,2 giây, `Money`, token màu/chữ của `pf-wireframe.html`, sàn chất lượng §7.
- v2 (2026-09-22, commit `032d089`): thêm màn phụ Cài đặt `#cai-dat` (không phải tab thứ năm); FAB ẩn ở Cài đặt.
- v3 (2026-09-22, commit `0ee6969`): ≥ 1024px: thanh bên thay thanh dưới + FAB, phím N, sheet thành hộp thoại giữa màn; dưới 1024px giao diện giữ nguyên (so ảnh + DOM trong báo cáo desktop-redesign).
- v4 (2026-09-22, commit `a68c9d6`): ghi luật màn rộng vào `docs/DESIGN.md` §7b.
- v5 (2026-10-01, commit `11c52a0`): theo audit 261001 (ADR-67) — màn có FAB chừa thêm đáy bằng chiều cao FAB (`.app.has-fab`) để FAB không che nút/ghi chú cuối trang (F03); `--fg-3` đổi `#6b6f73` (sáng) / `#868a8e` (tối) để chữ phụ đạt ≥ 4,5:1 (F06); vùng chạm ≥ 44px cho tab/`seg`, nút Bù, nút icon (F07); ô số dùng Inter + `tabular-nums`, mono chỉ cho cột số trong bảng (F23); DESIGN.md thêm luật bảng dưới 1024px, sheet mở thẳng một việc, tab phụ xuống dòng, ví âm, thứ tự Cài đặt.
- v6 (2026-10-03, commit `a18730c`): theo audit 261003 — số của hàng tầng (vd "9.810.000 / 13.000.000 ₫" ở Dòng thác, Quỹ mục tiêu) lại nằm một dòng: lớp `.amt` của ô số có phép tính (UC-703 v10) đè lên `.tier .amt` và xếp từng số thành cột; ô số đổi sang `.amt-in`. `.hint` có kiểu chung (12px `--fg-3`) ở mọi chỗ, không chỉ trong header card; dòng nhắc ví/tài khoản trên nút Lưu (`.pick-summary`) có vùng chạm 44px.
- v7 (2026-10-03, commit `a18730c`): theo audit 261003: màn có FAB đặt toast trên nút "+" (cách 12px) — trước đó toast nằm ngang tầm FAB, câu dài kéo viên thuốc qua dưới FAB (tối: viên trắng và FAB trắng dính vào nhau, dấu "+" ló ra cuối câu).
- v8 (2026-10-03, commit `a18730c`): audit 261003 M25 — toast ở lại theo độ dài câu: `min(8 s, max(2,2 s, 60 ms × số ký tự))`; câu ngắn vẫn 2,2 giây.
- v9 (2026-10-06, commit `43e4699`): change [`261006-so-giao-dich`](../changes/archive/261006-so-giao-dich/proposal.md) — thêm màn phụ **Sổ giao dịch** `#so` (pwa [UC-716](UC-716-so-giao-dich.md)): không phải tab thứ năm ở thanh dưới (mở từ "Xem tất cả ›" của Giao dịch gần đây và tên ví ở Ngân sách), không có FAB (màn có nút **+ Ghi khoản** riêng); thanh bên máy tính có mục **Sổ giao dịch** (icon `book`) sau Ví & quỹ. Thêm icon Lucide `search`, `list-filter` (`filter`), `chevron-left`.
- v10 (2026-10-06, commit `38e4ef0`): thanh bên máy tính thêm mục **Hướng dẫn sử dụng** (icon dấu hỏi, dưới Cài đặt) mở `https://mzavn.gitbook.io/vi-nha` ở tab mới (`GUIDE_URL`, `web/src/lib/splits.ts`) — chủ nhà yêu cầu. Điện thoại: nút **Mở hướng dẫn** ở Cài đặt › Máy này (pwa UC-709).
- v11 (2026-10-06, commit `18569ce`): change [`261006-tich-san-ro-rang`](../changes/archive/261006-tich-san-ro-rang/proposal.md) — thanh Tích sản không còn chữ rút gọn ("tiền 55k"; chủ nhà: "để ntn thì rất khó hiểu và phải đoán nó là tiền gì"), nên app không còn chỗ nào dùng số rút gọn: bỏ `formatShort` và test của nó. Luật §5 giữ nguyên (không rút gọn số hero / số dư).
- v12 (2026-10-06, commit `18569ce`): **F5 giữ đúng chỗ** — chủ nhà: "tôi đang ở tab tích sản, F5 nó lại tự nhảy về ngân sách… cho dù F5 thì vẫn giữ đúng chỗ đang mở". Hash ghi cả tab con của Ví & quỹ (`#vi/tichsan`, `web/src/lib/hash-route.ts` › `parseHash`, `hashFor`); đổi tab con bằng `setWalletsTab` (thay hash tại chỗ, không thêm lượt quay lại); `#vi` cũ / tab con lạ → giữ tab con đang có. Thêm AC-11.
- v13 (2026-10-07, commit `7424f26`): địa chỉ màn đổi sang tiếng Anh (ADR-92): `#homnay` → `#today`, `#nhap` → `#entry`, `#gan` → `#assign`, `#vi` → `#wallets`, `#so` → `#ledger`, `#cai-dat` → `#settings`; tab con Ví & quỹ `ngansach` / `tichsan` / `taikhoan` / `phantich` / `chuyentien` / `nguoithue` / `no` → `budget` / `wealth-building` / `accounts` / `analysis` / `transfers` / `tenants` / `debts`; lối tắt manifest `/#entry`, `/#assign`. Địa chỉ cũ về Hôm nay như hash lạ, không giữ song song. Viết lại AC-6 (có test bảng địa chỉ), AC-11; thêm AC-12 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v14 (2026-10-08, commit `934f30f`): **Hướng dẫn ngay trong app** — chủ nhà: "viết ngắn thành Hướng dẫn … nhúng <iframe …> trực tiếp, k cần mở app, để chạy trong PWA cho dễ". Màn phụ thứ ba `#guide` nhúng GitBook (`GUIDE_URL`), khung chiếm hết chiều cao còn lại, nút Mở ở tab mới; thanh bên "Hướng dẫn sử dụng" (mở tab mới) → "Hướng dẫn" đi `#guide`; FAB ẩn ở Hướng dẫn; mất mạng lúc mở → "Hướng dẫn cần mạng". Main Flow 1, 3, 4, Alt 1a, AC-3, AC-6 sửa; thêm bước 7, 7a, AC-13, AC-14 (change [261008-huong-dan-trong-app](../changes/archive/261008-huong-dan-trong-app/proposal.md))
- v15 (2026-10-08, chủ nhà xem bản máy tính: "cho full màn đi"): khung Hướng dẫn tràn hết màn — bỏ bề rộng tối đa và lề hai bên (máy tính: hết phần bên phải thanh bên, sát đáy; điện thoại: sát hai mép, chừa thanh dưới).
- v16 (2026-10-08, chủ nhà: "tối ưu … để tốc độ ban đầu vào là thấy luôn", chọn cách nhẹ): khung Hướng dẫn mở một lần thì giữ tới hết phiên (ẩn khi sang màn khác — quay lại hiện ngay, đúng trang đang đọc); dòng "Đang tải hướng dẫn…" tới khi GitBook tải xong; app kết nối sẵn tới GitBook (preconnect), chưa mở thì không tải gì. Đo: lần đầu chữ hiện ~0,45 s (890 KB), lần sau ~0,2 s (71 KB). Loại: tải ngầm sẵn (tốn data, pin điện thoại).

## Main Flow
1. Điện thoại: thanh dưới 4 tab **Hôm nay · Nhập · Gán · Ví & quỹ**; tab lưu trong `location.hash` — địa chỉ tiếng Anh (ADR-92): `#today` Hôm nay, `#entry` Nhập, `#assign` Gán, `#wallets/<tab con>` Ví & quỹ (tab con `budget` Ngân sách, `wealth-building` Tích sản, `accounts` Tài khoản, `analysis` Phân tích, `transfers` Chuyển tiền, `tenants` Người thuê, `debts` Nợ) và ba màn phụ không có tab: `#settings` Cài đặt, `#ledger` Sổ giao dịch, `#guide` Hướng dẫn — nên F5, nút quay lại và shortcut màn hình chính (`/#entry`, `/#assign` trong `manifest.webmanifest`) mở đúng chỗ; hash lạ → Hôm nay, kể cả địa chỉ tiếng Việt cũ (`#nhap`, `#vi/tichsan`…) — không giữ song song. Đổi tab cuộn về đầu và đưa focus vào tiêu đề trang (trừ màn Nhập — focus vào ô số tiền). Ở màn phụ thì không tab nào sáng.
2. Badge: Gán = số log chưa gán (`snapshot.attention.pendingLogs`), nhãn "N chưa gán"; Nhập = số khoản của người đang dùng trong hàng đợi, nhãn "N chưa lên sổ".
3. FAB "+" ("Nhập khoản chi") ở mọi màn **trừ Nhập, Cài đặt, Sổ giao dịch và Hướng dẫn**. Màn có FAB thêm lớp `has-fab`: đáy nội dung chừa thanh dưới + safe-area + chiều cao FAB, nên FAB không bao giờ che nút hay `.note` cuối trang.
4. Toast: viên ở đáy, tự tắt sau **2,2 giây** với câu ngắn; câu dài ở lâu hơn — `min(8 s, max(2,2 s, 60 ms × số ký tự))` —, không lấy focus, đọc qua vùng `aria-live="polite"`. Màn có FAB (`has-fab`) đặt toast trên FAB; màn không có FAB (Nhập, Cài đặt, Sổ giao dịch, Hướng dẫn) đặt ngay trên thanh dưới.
5. Sheet: `<dialog>` modal, có thanh nắm, header dính với nút **Đóng**; đóng bằng Đóng, bấm scrim, hoặc Esc. Sheet mở thẳng một việc (vd Chia tiền, Mua tài sản) có tiêu đề nói đúng việc đó và không hiện hàng `seg` chọn loại; danh sách dòng sửa được (vd Chốt tháng) mỗi dòng một hàng `tên · số · ×`, tổng dính ngay trên nút chính.
6. Giao diện Sáng/Tối/Theo máy: lưu `vi-nha:theme`, áp trước khi vẽ.
7. **Hướng dẫn** (`#guide`): mở từ thanh bên máy tính hoặc Cài đặt › Máy này (UC-709). Màn có tiêu đề "Hướng dẫn", nút **Mở ở tab mới** (mở `GUIDE_URL` ở tab mới như trước) và khung GitBook (`GUIDE_URL`) chiếm hết chiều cao còn lại — trang không cuộn hai lớp (`main` lớp `app-guide`: cao `100dvh`, cột flex, không cuộn; điện thoại chừa đáy cho thanh dưới, máy tính không). Khung không `sandbox` (GitBook cần script). Thanh dưới (điện thoại) vẫn hiện để quay về; không FAB. F5 ở `#guide` vẫn ở màn đó.

## Alternative Flows
- 1a. **Màn rộng** (`(min-width: 1024px)`, một mốc duy nhất `WIDE` dùng chung cho JS và CSS; từ 1280px chỉ đổi bố cục cột): thanh bên thay thanh dưới và FAB — tên app; nút phụ **Nhập khoản chi** kèm `kbd` N; 4 mục + **Sổ giao dịch** + Cài đặt + **Hướng dẫn** (icon dấu hỏi, đi màn `#guide` trong app — không mở tab mới) kèm badge (Nhập: "chưa lên sổ", Gán: "chưa gán", Ví & quỹ: "lệnh chuyển tiền chưa làm"); chân thanh bên: "Có mạng"/"Không có mạng", "Số lúc HH:mm"/"Số cũ lúc HH:mm", "N chờ đồng bộ, đã trừ tạm", "N bị máy chủ từ chối", nút **Đồng bộ**, chọn giao diện, "Đang dùng: {tên}", **Đăng xuất** (hỏi lại như UC-701).
- 1b. Phím **N** (không kèm Ctrl/⌘/Alt, không đang gõ trong input/textarea/select/contenteditable, không có sheet đang mở): mở màn Nhập; đang ở Nhập thì đưa con trỏ về ô số tiền.
- 5a. Màn rộng: sheet mở thành hộp thoại giữa màn; màn Gán dùng master-detail thay sheet (UC-706).
- 1c. Bấm tab Ví & quỹ từ tab khác thì bỏ lọc phe (`tierFilter = null`).
- 7a. Mở `#guide` lúc đang mất mạng (`app.online` = false lúc mở màn) → không vẽ khung, hiện "Hướng dẫn cần mạng" kèm nút Mở ở tab mới. Khung đã tải mà rớt mạng thì giữ nguyên (GitBook tự xử lý).

## Luật hiển thị đã chốt (DESIGN.md — code tuân theo)
| Luật | Nguồn | Nơi thực thi |
|---|---|---|
| Tiền `1.250.000 ₫` (chấm nhóm, khoảng trắng không ngắt trước ₫), số âm dấu `−` U+2212 + màu đỏ, **không làm tròn** | §5 Tiền | `formatVnd`, `groupDigits`, `MINUS` (`web/src/lib/money.ts`); `Money` (`web/src/ui/money.tsx`) |
| Rút gọn (`4,0tr`, `850k`) chỉ ở chỗ chật, không cho số hero/số dư | §5 Tiền | Không màn nào rút gọn (thanh Tích sản bỏ chữ rút gọn ở v11, `formatShort` đã bỏ) — mọi số qua `Money` / `formatVnd` |
| Bảng dày bỏ ₫ ở ô, ghi một lần ở header; số trong bảng font mono | §3 Chữ, §5 | `Money unit={false} mono` |
| Tuần `T38 (14–20/9)`, tuần vắt hai tháng `T40 (28/9–4/10)`, tháng `tháng 9/2026`, theo giờ VN | §5 Kỳ | `weekLabel`, `monthLabel`, `weekRange` (`web/src/lib/period.ts`) |
| Mỗi màn đúng một nút chính (`btn-primary`) | §4 Page header | từng màn (nút phụ dùng `btn`/`btn-ghost`) |
| Banner chỉ khi có việc; không có banner "mọi thứ ổn" | §4 Banner | `TodayBody`, `Todo` |
| Ví `private` của người kia: hiện tên, không có số | §5 Riêng tư | `Money` với `value = null` vẽ ô trống |
| Chip không phải nút; màu chỉ mang trạng thái; `--lock` chỉ cho Tích sản/Thuế | §3, §4 Chip | `styles.css`, `TierRow` |
| Chạm ≥ 44px (cả `seg`/tab, nút Bù, nút icon), safe-area, `prefers-reduced-motion`, sáng/tối qua `data-theme` | §7 | `web/src/styles.css` (`min-height: 44px`, `min-width: 44px`, `env(safe-area-inset-*)`, `@media (prefers-reduced-motion: reduce)`) |
| Chữ phụ `--fg-3` đạt ≥ 4,5:1 trên nền (sáng `#6b6f73`, tối `#868a8e`) | §2 Token, §7 | `web/src/styles.css` `:root` / `[data-theme="dark"]` |
| Dưới 1024px không dùng bảng quá 2 cột số: chuyển thành hàng tầng (tên · số quan trọng nhất to bên phải · dòng phụ) | §7b | `BudgetItem`, danh sách tài khoản (`AccountsTab`) — UC-707 |
| Tab phụ trong một màn thấy hết trên 390px: xuống dòng, không cuộn ngang | §4 | `.tabs.wrap` (Ví & quỹ — UC-707) |
| Ô nhập số dùng Inter + `tabular-nums`; mono chỉ cho cột số trong bảng | §3 Chữ | `web/src/styles.css` (ô số trong sheet `font-family: var(--font-sans)`) |
| Màn có FAB chừa đáy bằng chiều cao FAB | §4 FAB | `.app.has-fab` (`web/src/app.tsx`, `styles.css`) |
| Màn rộng chỉ **thêm** cột/danh sách, không đổi gì dưới 1024px | §7b | `useWide()` rẽ nhánh; lớp `dk-*`, `side-*`, `dash-*` chỉ ở nhánh rộng |
| Giọng chữ: không xưng hô, không "Rất tiếc", nút nói đúng việc ("Chia và ghi sổ" → toast "Đã chia") | §6 | câu chữ trong `screens/*`; `errorText` (`web/src/lib/api.ts`) trả nguyên câu server |

## Exceptions
- E1. `localStorage` bị chặn → giao diện theo máy; lựa chọn áp cho lần mở này nhưng không nhớ.

## Acceptance Criteria
### AC-1: Định dạng tiền
- Given số 1.250.000, −150.000, 1.234.567, chênh +120.000
- When hiển thị
- Then "1.250.000 ₫" (NBSP trước ₫), "−150.000 ₫" (U+2212, không có "-"), "1.234.567" (không làm tròn), "+120.000"
- Tests: `web/src/lib/money.test.ts` › "định dạng tiền › chấm phân nhóm, ₫ sau số"; "định dạng tiền › số âm dùng dấu trừ U+2212, không phải gạch nối"; "định dạng tiền › không làm tròn"; "định dạng tiền › chênh lệch có dấu +"

### AC-2: Nhãn kỳ
- Given tuần 2026-W39 (21–27/9), tuần vắt tháng, giờ gần nửa đêm UTC
- When hiển thị
- Then "T39 (21–27/9)", tuần vắt ghi đủ hai tháng, tuần tính theo giờ VN; tháng "tháng 9/2026"
- Tests: `web/src/lib/period.test.ts` › "nhãn kỳ › tuần trong một tháng: T39 (21–27/9)"; "nhãn kỳ › tuần vắt qua hai tháng ghi đủ cả hai"; "nhãn kỳ › tuần tính theo giờ VN, không theo UTC"; "nhãn kỳ › tháng"; "nhãn kỳ › ngày và giờ"

### AC-3: FAB ẩn ở Nhập, Cài đặt, Sổ giao dịch và Hướng dẫn
- Given điện thoại
- When ở Hôm nay / Gán / Ví & quỹ → FAB hiện; ở Nhập / Cài đặt / Sổ giao dịch / Hướng dẫn
- Then FAB không có
- Tests: ⚠ Chưa có test

### AC-4: Một mốc 1024px, điện thoại không đổi
- Given khung nhìn 1023px và 1024px
- When vẽ app
- Then 1023px: thanh dưới + FAB, không có lớp `dk-*`/`side-*`; 1024px: thanh bên, không có thanh dưới/FAB
- Tests: ⚠ Chưa có test (so ảnh/DOM bằng tay trong báo cáo `ui-ux-designer-260922-1210-desktop-redesign.md`)

### AC-5: Phím N
- Given màn rộng, đang ở Hôm nay, không gõ trong ô nào, không có sheet mở
- When nhấn N
- Then mở màn Nhập với con trỏ trong ô số tiền; nhấn N khi đang gõ trong ô hoặc khi sheet mở thì không làm gì
- Tests: ⚠ Chưa có test

### AC-6: Điều hướng bằng hash
- Given mở `/#assign` (shortcut manifest)
- When app vào `phase = app`
- Then đang ở tab Gán; nút quay lại của trình duyệt về tab trước; `/#abc` → Hôm nay. Mỗi địa chỉ trong bảng (7 màn `#today`, `#entry`, `#assign`, `#wallets`, `#settings`, `#ledger`, `#guide`; 7 tab con `#wallets/budget`, `/wealth-building`, `/accounts`, `/analysis`, `/transfers`, `/tenants`, `/debts`) đọc lại ra đúng màn / tab con
- Tests: [`web/src/lib/hash-route.test.ts`](../../web/src/lib/hash-route.test.ts) › "màn trong hash › bảng địa chỉ màn tiếng Anh: đủ 7 màn (có Hướng dẫn) và 7 tab con, mỗi địa chỉ đọc lại ra đúng chỗ"; mở từ shortcut và nút quay lại: ⚠ Chưa có test

### AC-11: F5 ở tab con Ví & quỹ mở lại đúng tab con
- Given đang ở Ví & quỹ › Tích sản
- When tải lại trang (F5) hay mở lại link `#wallets/wealth-building`
- Then vẫn ở Ví & quỹ › Tích sản; link `#wallets` hay tab con lạ → Ví & quỹ với tab con đang có (mặc định Ngân sách); hash lạ → Hôm nay
- Tests: [`web/src/lib/hash-route.test.ts`](../../web/src/lib/hash-route.test.ts) › "màn trong hash › F5 ở Ví & quỹ › Tích sản mở lại đúng Tích sản: hash ghi cả tab con và đọc lại ra đúng chỗ"; [`web/src/lib/hash-route.test.ts`](../../web/src/lib/hash-route.test.ts) › "màn trong hash › link cũ \"#wallets\" hay tab con lạ → Ví & quỹ, giữ tab con đang có; hash lạ → Hôm nay; tab con chỉ thuộc Ví & quỹ"

### AC-12: Địa chỉ tiếng Việt cũ về Hôm nay, không giữ song song (ADR-92)
- Given bookmark / link địa chỉ cũ trước khi đổi tên: `#homnay`, `#nhap`, `#gan`, `#vi`, `#so`, `#cai-dat`, `#vi/tichsan`, `#vi/ngansach`, `#vi/no`
- When mở app
- Then về Hôm nay như mọi địa chỉ lạ — app không nhận địa chỉ cũ song song với địa chỉ mới; lối tắt trong manifest là `/#entry` (Nhập khoản chi) và `/#assign` (Gán giao dịch)
- Tests: [`web/src/lib/hash-route.test.ts`](../../web/src/lib/hash-route.test.ts) › "màn trong hash › địa chỉ tiếng Việt cũ (bookmark trước khi đổi tên) → Hôm nay như mọi hash lạ, không giữ song song"; lối tắt manifest: ⚠ Chưa có test (kiểm bằng đọc `web/public/manifest.webmanifest`)

### AC-13: Hướng dẫn mở ngay trong app
- Given đang ở bất kỳ màn nào, có mạng
- When bấm **Hướng dẫn** (thanh bên máy tính; Cài đặt › Máy này trên điện thoại); rồi F5
- Then mở màn `#guide`: tiêu đề "Hướng dẫn", khung GitBook tràn hết màn (hết bề rộng, không lề hai bên; máy tính: hết phần bên phải thanh bên, sát đáy) và chiếm hết chiều cao còn lại, trang không cuộn thêm; lúc GitBook chưa tải xong hiện "Đang tải hướng dẫn…"; sang màn khác rồi quay lại thì khung còn nguyên, không tải lại (tới khi tải lại app); nút **Mở ở tab mới**; thanh dưới (điện thoại) vẫn hiện, không FAB; F5 vẫn ở `#guide`. CSP cho khung đúng origin GitBook (access UC-503 AC-6)
- Tests: [`web/src/lib/hash-route.test.ts`](../../web/src/lib/hash-route.test.ts) › "màn trong hash › bảng địa chỉ màn tiếng Anh: đủ 7 màn (có Hướng dẫn) và 7 tab con, mỗi địa chỉ đọc lại ra đúng chỗ"; vẽ khung, chiều cao, không cuộn hai lớp: ⚠ Chưa có test (giao diện — kiểm tay trên prod 2026-10-08 ở 390px và 1280px: khung cao 719 / 807 px, trang không cuộn thêm, không lỗi CSP)

### AC-14: Hướng dẫn khi mất mạng
- Given mất mạng (`app.online` = false)
- When mở `#guide`
- Then không vẽ khung, hiện "Hướng dẫn cần mạng" và nút Mở ở tab mới; khung đã tải mà rớt mạng thì giữ nguyên
- Tests: ⚠ Chưa có test (giao diện)

### AC-7: Toast tự tắt và đọc được bằng trình đọc màn hình
- Given một toast mới
- When 2,2 giây trôi qua (câu ≤ 36 ký tự; câu dài hơn: 60 ms mỗi ký tự, tối đa 8 giây)
- Then toast biến mất; nội dung nằm trong vùng `role="status"` `aria-live="polite"`
- Tests: ⚠ Chưa có test

### AC-8: Sheet đóng bằng Esc, scrim, nút Đóng
- Given một sheet đang mở
- When nhấn Esc / bấm ra ngoài / bấm Đóng
- Then sheet đóng (Esc không đóng thẳng dialog mà gọi `onClose` của màn)
- Tests: ⚠ Chưa có test

### AC-9: Giao diện người chọn đè theo máy
- Given chọn "Tối"
- When mở lại app
- Then `data-theme="dark"` được áp trước khi vẽ; chọn "Theo máy" thì xoá lựa chọn
- Tests: ⚠ Chưa có test

### AC-10: FAB không che nội dung cuối trang
- Given điện thoại 390px, màn Hôm nay hoặc Ví & quỹ › Chuyển tiền cuộn xuống hết
- When nhìn đáy trang
- Then nút và `.note` cuối cùng nằm trên FAB, bấm được
- Tests: ⚠ Chưa có test

## Traceability
- Code: `web/src/app.tsx` › `App` (lớp `has-fab`, `app-guide`, `#ledger`, `#guide`), `DesktopApp`, `Toast`, `NAV`; `web/src/ui/shell.tsx` › `WIDE`, `useWide`, `useTheme`, `useQuickEntryKey`, `useLogout`, `Sidebar` (mục Hướng dẫn); `web/src/screens/guide.tsx` › `Guide`; `web/src/lib/splits.ts` › `GUIDE_URL`; `web/src/ui/parts.tsx` › `Sheet`, `PageHeader`, `Card`, `Banner`, `TierRow`, `Seg`, `Empty`, `NeedsNetwork`, `Skeleton`, `Bar`; `web/src/ui/icons.tsx`; `web/src/ui/money.tsx` › `Money`; `web/src/state/store.ts` › `go`, `setWalletsTab`, `toast`, `start` (`hashchange`); `web/src/lib/hash-route.ts` › `Tab`, `TABS`, `WalletsTab`, `WALLETS_TABS`, `parseHash`, `hashFor`; `web/public/manifest.webmanifest` › `shortcuts` (`/#entry`, `/#assign`); `web/src/main.tsx`; `web/src/styles.css` (`.app-guide`, `.guide-frame`); `web/src/lib/money.ts`; `web/src/lib/period.ts`.

## Divergences & Open Questions
- [DIVERGENCE] `docs/wireframe.md` §2: "Nút `+` nổi ở mọi màn"; code ẩn FAB ở Nhập, Cài đặt, Sổ giao dịch và Hướng dẫn (`web/src/app.tsx` › `App`), khớp `docs/DESIGN.md` §4 ("ẩn ở màn Nhập, Cài đặt và Sổ giao dịch" — chưa nhắc Hướng dẫn) — DESIGN.md thắng wireframe theo `context.md`.
- [DIVERGENCE] `docs/DESIGN.md` §9 hướng dẫn ánh xạ token qua `tailwind.config`; code dùng Tailwind v4 với `@theme inline` trong `web/src/styles.css` (báo cáo `ui-ux-designer-260922-0020-pwa-mobile-offline.md`). Cùng token, khác cơ chế.
- [OPEN] Sheet có thanh nắm nhưng không vuốt xuống để đóng được; chạm nền đóng ngay kể cả khi form đã sửa (vd Chốt tháng) — audit 261001 F18, bỏ qua ở commit `11c52a0` vì công lớn (M). Chưa có quyết định làm.
- Đã trả lời (2026-10-03, audit M25): toast ở lại theo độ dài câu — tối thiểu 2,2 giây, ~60 ms mỗi ký tự, tối đa 8 giây (`web/src/app.tsx` › `Toast`); dòng "vừa ghi" ở màn Nhập vẫn giữ.
- [OPEN] App mở vào Hôm nay hay Nhập (cùng báo cáo, câu hỏi mở 4); hiện mặc định Hôm nay.
