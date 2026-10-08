# Context `pwa` — Ứng dụng web cài được lên điện thoại (Ví nhà)

Giao diện người dùng duy nhất của hộ: một PWA viết bằng Preact, **mobile-first (D13)**, build từ `web/` ra `public/` và được Worker phục vụ như static assets.
Nó trả lời "còn bao nhiêu để chi tuần này", cho nhập khoản chi trong 3 chạm **kể cả khi mất mạng (D12)**, gán giao dịch ngân hàng, xem ví/quỹ/tài khoản/sổ nợ/sổ phải thu và sửa cấu hình.
PWA không tự tính luật tiền: mọi con số lấy từ `/v1/*`. Ngoại lệ duy nhất là *trừ tạm* các khoản còn trong hàng đợi, theo đúng công thức của `buildSnapshot` phía server.
Luật giao diện lấy từ `docs/DESIGN.md` (thắng `pf-wireframe.html`), gồm cả luật màn rộng ≥ 1024px (§7b, commit `a68c9d6`).

## Ngôn ngữ chung (ubiquitous language)

| Thuật ngữ | Nghĩa trong context này | Ghi chú khác context |
|---|---|---|
| **Hàng đợi** (`queue`) | Kho trên máy (IndexedDB store `queue`, lùi về `localStorage` `vi-nha:queue`) giữ mọi khoản nhập tay đi qua hàng đợi, **trước** khi gửi server | Ở ledger không có khái niệm này; server chỉ thấy `POST /v1/transactions` có `client_id` |
| **Khoản chờ đồng bộ** (`QueuedEntry`, status `pending`) | Khoản đã nằm trong hàng đợi, chưa được server xác nhận ghi | Không phải `transactions` — chưa có `tx.id` |
| **Sửa / Xoá** một giao dịch | Chỉ cho khoản **đã lên sổ**, ghi tay: Xoá = huỷ (`void`), Sửa = thay khoản cũ bằng khoản mới trong một lần (`/replace`); cần mạng, không qua hàng đợi. Giao dịch ngân hàng chỉ **Gán lại** (UC-715) | Ledger gọi là huỷ / sửa (UC-102, ADR-73); khác **Bỏ hẳn** một khoản chưa lên sổ (UC-704) |
| **Bị từ chối** (status `rejected`) | Server trả 4xx có mã lỗi; khoản nằm lại chờ người bấm "Gửi lại" hoặc "Bỏ hẳn" | Khác "voided" của ledger: chưa từng vào sổ |
| **Chưa lên sổ** | Tất cả khoản trong hàng đợi (cả `pending` lẫn `rejected`) — nhãn card và badge tab Nhập | |
| **Đồng bộ** (flush) | Một lượt gửi các khoản `pending` của người đang đăng nhập, theo thứ tự nhập | |
| **Trừ tạm** | Cộng tác động của hàng đợi vào snapshot/bảng ngân sách đang hiển thị (`applyQueue`, `applyQueueToBudget`) | Server không biết; chỉ là số hiển thị |
| **Số cũ** (`stale`) | Đang hiện số lấy từ cache (service worker hoặc IndexedDB) vì không lấy được số mới | |
| **client_id** | UUID sinh ở máy cho mỗi khoản nhập; server chống trùng theo nó | Cùng trường với ledger (`transactions.client_id`), ở đây là **nơi sinh** |
| **Người đang dùng** (`member`) | Thành viên đã chọn ở màn đăng nhập (D6); quyết định ví/tài khoản mặc định và khoản nào của hàng đợi được gửi | Định danh do access sở hữu (entity `Member`, `Session`) |
| **Sheet** | Hộp thoại trượt từ đáy (≥ 1024px: hộp thoại giữa màn); "nơi mọi edge case được giải" (DESIGN.md §4) | |
| **Màn rộng** / `wide` | Khung nhìn `(min-width: 1024px)` (`WIDE` trong `web/src/ui/shell.tsx`) | |
| **Còn để chi tuần này** | `snapshot.spendableThisWeek` sau khi trừ tạm hàng đợi | Định nghĩa gốc thuộc ledger (snapshot) |
| **Tab** | Một trong `today` · `entry` · `assign` · `wallets` (+ hai màn phụ không có tab: `settings`, `ledger`), lưu trong `location.hash` | |
| **Sổ giao dịch** | Màn phụ `#ledger` (UC-716): toàn bộ sổ theo tháng, lọc / tìm, dòng tổng theo nghĩa tiền thật, chạm dòng mở sheet chi tiết (UC-715), **+ Ghi khoản** với ngày trong tháng đang xem | Khác card **Giao dịch gần đây** (liếc nhanh, chia trang theo thời gian). Server: sổ giao dịch ledger UC-111 |
| **Chuyển ngân sách** | Khoản `transfer` chỉ có hai ví (`from_wallet_id` → `wallet_id`), không tài khoản: đổi số giữa hai ví trong app, tiền không rời tài khoản nào; đi qua hàng đợi như khoản chi (UC-712) | Ledger gọi cùng tên (UC-101 alt 4e); khác **Chuyển nội bộ** (tiền đi thật giữa hai tài khoản, có thể kèm chuyển ví) |
| **Bù** | Nút ở dòng ví đang âm trong bảng Ngân sách: mở Chuyển ngân sách điền sẵn phần âm, nguồn ưu tiên Có thì tốt còn dư (UC-712) | Khác **"đã bù X"** (bù hố tháng trước, allocation tự làm khi chia — D3) |
| **Quỹ giữ riêng** | Ví tier `holding` mà kind ≠ `holding` (vd "Thu cho thuê"): không vào "còn để chi", không nằm trong bảng Ngân sách, hiện thành card riêng với Trả nợ / Chuyển sang Tích sản | Khác **ví Thu nhập** (tier `holding`, kind `holding`) — `isIncomeHolding`/`isReserve` (`src/domain/types.ts`) |
| **Nguồn thu** | Ô chọn ở Thu nhập / Gán / mã lương quyết định phần khóa của khoản thu; trống = luật % chung như cũ | Định nghĩa gốc ở allocation (`IncomeStream`, ADR-59) |
| **Người thuê** | Người ở ghép, không đăng nhập; sổ của họ xem/ghi ở tab Người thuê (UC-713), mọi việc ghi cần mạng (không có hàng đợi) | Định nghĩa gốc ở rental (`Tenant`, sổ người thuê) |
| **Khoản nợ** / **Trả nợ** | Món hộ đang nợ (sổ nợ, tab **Nợ** ở Ví & quỹ — UC-707); trả nợ là khoản chi danh mục Trả nợ có chọn khoản nợ (`debt_id`), đi qua hàng đợi như khoản chi (UC-712, màn Gán UC-706). Thêm khoản, vay thêm, chỉnh, huỷ dòng cần mạng | Định nghĩa gốc ở debt (`Debt`, `DebtLine`, còn nợ = đã vay − đã trả — ADR-71) |
| **Khoản phải thu** / **Nhận lại tiền** | Món người khác nợ hộ (sổ phải thu, card **Người khác nợ mình** ở tab Nợ — UC-707); cho vay là `lend`, nhận lại là `collect` có chọn khoản phải thu (`receivable_id`), đi qua hàng đợi như khoản chi (Loại khác UC-705, màn Gán UC-706). Nhận lại tiền **không phải thu nhập**: không chia, không đụng ví | Định nghĩa gốc ở receivable (`Receivable`, `ReceivableLine`, còn phải thu = đã cho vay − đã nhận lại — ADR-72) |
| **Tiền thật đang có** | Số to nhất ở đầu tab Nợ: Σ số dư sổ các tài khoản (`GET /v1/networth`); phải thu, người thuê, nợ đứng sau và ghi "chưa phải tiền" (UC-707) | Khác **Còn để chi tuần này** (số hero của Hôm nay). Định nghĩa gốc ở receivable UC-1005 |
| **Máy này** / **Bật thông báo** | Trình duyệt/PWA đang dùng đã cho phép thông báo và gửi subscription lên server, gắn với người đang dùng; trạng thái `needs-install` · `unsupported` · `blocked` · `off` · `on` (UC-714). Đổi người hay đăng xuất thì máy tự tắt | Server gọi là **máy đã bật** (`PushSubscription`, notify UC-410) |

## Use case

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-701](UC-701-dang-nhap-dang-xuat-doi-nguoi.md) | Đăng nhập, đăng xuất, đổi người trên máy dùng chung | implemented | BR-09, BR-03 |
| [UC-702](UC-702-xem-hom-nay.md) | Xem Hôm nay (điện thoại và bảng điều khiển máy tính) | implemented | BR-01, BR-07, BR-04 |
| [UC-703](UC-703-nhap-nhanh-khoan-chi.md) | Nhập nhanh khoản chi (3 chạm) | implemented | BR-03, BR-01 |
| [UC-704](UC-704-hang-doi-nhap-offline.md) | Hàng đợi nhập offline và đồng bộ | implemented | BR-03, BR-04, BR-01 |
| [UC-705](UC-705-nhap-loai-khac.md) | Nhập loại khác: thu nhập, hoàn tiền, mua tài sản, cho vay, chuyển nội bộ | implemented | BR-02, BR-03, BR-07 |
| [UC-706](UC-706-gan-giao-dich-ngan-hang.md) | Gán giao dịch ngân hàng (màn Gán) | implemented | BR-03, BR-04, BR-02 |
| [UC-707](UC-707-xem-vi-va-quy.md) | Xem Ví & Quỹ và làm chuyển tiền cần làm | partial | BR-01, BR-07, BR-04, BR-02, BR-12, BR-13 |
| [UC-708](UC-708-dem-vi-nhap-so-du-that.md) | Đếm ví / nhập số dư thật | implemented | BR-04 |
| [UC-709](UC-709-sua-cau-hinh-man-cai-dat.md) | Sửa cấu hình ở màn Cài đặt | implemented | BR-08, BR-09 |
| [UC-710](UC-710-mo-app-khi-mat-mang.md) | Mở app khi mất mạng (service worker, số cũ theo người) | implemented | BR-03, BR-09, BR-10 |
| [UC-711](UC-711-khung-dieu-huong-va-luat-hien-thi.md) | Khung điều hướng và luật hiển thị (DESIGN.md) | implemented | BR-01 |
| [UC-712](UC-712-chuyen-ngan-sach-va-bu.md) | Chuyển ngân sách & Bù ví âm | implemented | BR-01, BR-02, BR-04, BR-12 |
| [UC-713](UC-713-man-nguoi-thue.md) | Màn Người thuê | implemented | BR-11, BR-03 |
| [UC-714](UC-714-bat-thong-bao-tren-may-nay.md) | Bật thông báo trên máy này | implemented | BR-06, BR-09 |
| [UC-715](UC-715-xem-sua-xoa-giao-dich.md) | Xem, sửa, xoá một giao dịch | implemented | BR-03, BR-04, BR-01 |
| [UC-716](UC-716-so-giao-dich.md) | Sổ giao dịch | implemented | BR-01, BR-03, BR-05 |

Entity model: [entities.md](entities.md).

## Code thuộc context này
- `web/src/**` — `app.tsx`, `main.tsx`, `screens/*`, `state/{store,resource,push}.ts`, `offline/{queue,idb}.ts`, `lib/*` (kể cả `*.test.ts`), `ui/*`, `styles.css`.
- `web/sw.js` — **nguồn** của service worker. `public/sw.js` là bản sinh ra lúc build (plugin `vi-nha-sw` trong `web/vite.config.ts` thay `__PRECACHE__`, `__VERSION__`); `/public/` nằm trong `.gitignore` (commit `a756f68`), không sửa tay.
- `web/vite.config.ts`, `web/index.html`, `web/public/manifest.webmanifest`, `web/public/icons/*`, `web/scripts/make-icons.sh`.
- `wrangler.jsonc` › `assets` (chỉ phần phục vụ PWA: `directory: ./public`, `not_found_handling: single-page-application`, `run_worker_first: ["/v1/*", "/webhooks/*", "/mcp", "/mcp/*", "/oauth/*", "/.well-known/*"]`). Service worker cũng không đụng tới các đường của Worker (`bypassWorker` trong `web/src/lib/sw-fresh.ts`: `/mcp`, `/mcp/*`, `/webhooks/*`, `/oauth/*`, `/oauth.css`, `/.well-known/*`) — trang uỷ quyền Claude mở trên máy đã cài app vẫn là trang của Worker (UC-710, ADR-97).

## Phụ thuộc sang context khác (chỉ tham chiếu)
- **access**: UC-501 Đăng nhập bằng mật khẩu chung + chọn người · UC-504 Ẩn lịch sự số dư ví `private` · UC-505 Xem toàn bộ cấu hình (màn Cài đặt) · UC-506 Cấu hình tài khoản, ví & luật nạp · UC-507 Cấu hình thành viên, mã chuyển khoản, tham số, giờ nhắc · UC-508 Quản lý kết nối SePay, khoá Telegram, Zalo & gửi thử (cả mục Claude và ứng dụng AI: `GET /v1/settings/mcp`, `DELETE /v1/settings/mcp/:memberId/:grantId`).
- **ledger**: UC-101 Nhập tay một khoản tiền (`POST /v1/transactions`, chống trùng `client_id`, cấm tài khoản có feed — D14) · UC-103 Xem "còn bao nhiêu để chi" (snapshot) · UC-104 Ngân sách theo kỳ · UC-105 Đếm số dư tài khoản → bút toán điều chỉnh · UC-106 Đối soát tài khoản hai lớp · UC-107 Theo dõi tích lũy · UC-108 Chi theo danh mục · UC-111 Xem sổ giao dịch & tải dữ liệu nền (bootstrap, `/v1/transactions`, `/v1/transactions/:id`) · UC-102 Huỷ / sửa giao dịch ghi tay (`/v1/transactions/:id/void`, `/replace`).
- **allocation**: UC-202 Xem trước phương án chia · UC-203 Chia một khoản thu nhập (ghi sổ) · UC-205 Theo dõi & đánh dấu lệnh chuyển tiền.
- **ingest**: UC-305 Gán log chưa gán (danh sách, gán, bỏ qua, `create_rule`) · UC-302 Ghi log ngân hàng chống trùng (cờ nghi trùng webhook/rà soát).
- **rental**: UC-801 Thiết lập người thuê, phí cố định & chi chung · UC-802 Ghi người thuê chi hộ & dòng sổ tay · UC-803 Xem tạm tính tháng & bảng kê · UC-804 Chốt tháng với người thuê · UC-805 Nhận tiền người thuê trả & dùng tiền "Thu cho thuê" (`/v1/rental/*`).
- **debt**: UC-901 Thêm và xem khoản nợ · UC-902 Trả nợ (sheet Trả nợ, `bootstrap.debts`) · UC-903 Gán giao dịch ngân hàng là trả nợ · UC-904 Vay thêm, chỉnh tay, huỷ dòng nợ (`/v1/debts`, `/v1/debt-lines/:id/void`).
- **receivable**: UC-1001 Thêm và xem khoản phải thu · UC-1002 Cho vay / trả hộ · UC-1003 Nhận lại tiền (`collect`, `bootstrap.receivables`) · UC-1004 Chỉnh / huỷ dòng phải thu (`/v1/receivables`, `/v1/receivable-lines/:id/void`) · UC-1005 Xem bức tranh tiền thật (`/v1/networth`).
- **notify**: UC-410 Gửi thông báo đẩy tới máy đã bật (`/v1/push`, khoá công khai VAPID, danh sách máy, gửi thử) · UC-408 Gửi tin Telegram chống gửi trùng (cửa gửi chung `notifyMembers`) · UC-411 Gửi tin qua Zalo Bot (nối bằng mã — mã nối, webhook `/webhooks/zalo`).
