# specs/ — Đặc tả hệ thống Ví nhà (Spec-Driven Development)

> Bản công khai: hash commit trong History, Status và các dòng "Cập nhật / Hợp nhất" là của repo gốc (private) nơi phát triển — repo này nhận từng bản phát hành qua script, nên không có các commit đó. Link tới `plans/` và test migration cũ của repo gốc đã thành chữ thường.

> Dựng lại ngày 2026-10-01 từ code, test, `docs/`, `plans/`, báo cáo và `git log` (tới commit `a68c9d6`).
> Hợp nhất change [`261008-bang-can-doi`](changes/archive/261008-bang-can-doi/proposal.md) ngày 2026-10-08 (code commit `8cd48b8`, `31e3505`, `d4f0ab3` — ba lát, migration 0031…0033): **bảng cân đối, tháp tài sản, lãi vay hằng tháng, lưu chuyển tiền, kết quả thu chi, Mốc tự do, kế hoạch thu nhập, Thử số** — context mới [balance](balance/README.md) UC-1101…UC-1107, BR-15, ADR-99…ADR-107; màn `#net-worth` Tài sản & tự do (pwa UC-717 mới; UC-707, UC-711, UC-712); lãi vay tách lãi / gốc, ví hệ thống "Lãi vay" (debt UC-901…UC-903, ledger UC-101, UC-103, UC-104, allocation UC-201); phân loại lại báo cáo (ledger UC-102); `deactivated_at`, chặn lùi ngày mở sổ, khoá `fi_*` (access UC-506, UC-507); kỳ hạn phải thu, `balanceItems` (receivable UC-1001, UC-1005 — đóng [OPEN] thiếu tool MCP); MCP `get_balance_sheet`, `get_reports`, `record_asset_value` (mcp UC-601, UC-602, UC-603, UC-606 mới).
> Hợp nhất change [`261012-tu-chia`](changes/archive/261012-tu-chia/proposal.md) ngày 2026-10-13 (code commit `a8b43f7`): **Tự chia một khoản thu** (ADR-108) — `POST /v1/allocate` và `/allocate/preview` nhận `amounts` (số tay từng ví, bỏ luật nạp và phần khóa; tổng lệch → `amounts_mismatch`, ví sai → `invalid_amounts`) (allocation UC-203 AC-11, AC-12); sheet Chia thử có nút Tự chia ở nhập thu nhập, màn Gán (chỉ dòng thu nhập đầu), chi tiết khoản thu; Tích sản đứng đầu, Tích sản 0 chỉ nhắc (allocation UC-202 AC-6, AC-7; pwa UC-705, UC-706, UC-715). Không migration.
> Hợp nhất change [`261013-cap-nhat-tu-app`](changes/archive/261013-cap-nhat-tu-app/proposal.md) ngày 2026-10-13 (code commit `ae0f0b5`): **Cập nhật Ví nhà từ trong app** (ADR-109) — Cài đặt › Nâng cao › Cập nhật Ví nhà hỏi GitHub bản mới khi bấm, chỉ cách cập nhật theo cách cài (pwa UC-709 AC-30, AC-31); CSP `connect-src` thêm `https://api.github.com` (access UC-503); bản công khai có workflow `update.yml` + `scripts/update-from-upstream.mjs` (chép đè bản phát hành mới nhất, giữ cấu hình Cloudflare của nhà), phát hành tạo GitHub Release. Không migration.
> Hợp nhất change [`261013-an-so-va-ma-pin`](changes/archive/261013-an-so-va-ma-pin/proposal.md) ngày 2026-10-13 (code commit `f7cf796`): **che số tiền trên máy này và khóa app bằng mã PIN** (ADR-110) — nút con mắt ở thanh tiêu đề / thanh bên, số tiền thành "•••• ₫", số đang gõ và phần trăm giữ nguyên, lưu theo từng máy (pwa UC-718 mới); mã PIN 6 số cục bộ trên máy, hỏi khi mở app hoặc quay lại sau ≥ 60 giây, sai 5 lần / Quên PIN thì đăng xuất máy này cả khi offline (pwa UC-719 mới); hàng Mã PIN ở Cài đặt › Máy này (UC-709), nút con mắt và màn khóa ở khung (UC-711). Không đổi server, không migration.
> Hợp nhất change [`261015-chot-thang-va-keo-tich-san`](changes/archive/261015-chot-thang-va-keo-tich-san/proposal.md) ngày 2026-10-16 (code commit `0528219`, migration 0034, schema v1.34): **chốt tháng là quyết định của người** (ADR-111) — cron ngày 1 chỉ mời (📌), thẻ Chốt tháng ở Hôm nay; bù ví chi lố trước, phần dư chia Tích sản / Ví Thưởng theo % chọn mỗi tháng; bảng `month_closes` chặn chốt hai lần — và **Có / Không Tích sản khi chia** (ADR-112): thanh 1–100% mặc định 10%, Tích sản 0 cần lý do. Đụng allocation UC-202, UC-203, UC-204, UC-207 · notify UC-401, UC-402, UC-403 · access UC-507, UC-509 · pwa UC-702, UC-705, UC-706, UC-707, UC-709, UC-715.
> Từ nay **spec đứng trước code**: mọi thay đổi hành vi bắt đầu bằng sửa spec, rồi test, rồi code.

## 1. Spec là gì ở repo này

`specs/` mô tả **hệ thống đang phải hành xử thế nào — hôm nay**. Mỗi câu trong spec đã được đối chiếu với code; chỗ nào tài liệu cũ nói khác code thì được đánh dấu `[DIVERGENCE]` thay vì chọn im lặng một bên.

| Thư mục | Vai trò | Khi mâu thuẫn |
|---|---|---|
| `specs/` | **Hành vi đã chốt** — BR, Use Case, Entity, Acceptance Criteria, quyết định (ADR) | Là chuẩn để review PR và viết test |
| `specs/changes/` | Đề xuất thay đổi đang bàn (chưa phải sự thật) | Không có hiệu lực cho tới khi merge vào spec chính |
| `docs/` | Nguyên lý Profit First, lý do thiết kế, hệ thống thiết kế giao diện, wireframe | Nguồn **ý định**; nếu lệch spec → mở `[DIVERGENCE]`, chủ nhà quyết, rồi sửa bên sai |
| `plans/` | Lộ trình thi công và báo cáo lịch sử | Chỉ là lịch sử; không sửa để khớp spec |

Code lệch spec = bug **hoặc** spec chưa cập nhật — không có trường hợp thứ ba. Trả lời câu "rule này đến từ spec nào?" trước khi merge.

## 2. Bốn tầng yêu cầu

| Tầng | Trả lời | Ở đâu |
|---|---|---|
| Business Requirement | Vì sao làm? | [business-requirements.md](business-requirements.md) — BR-01…BR-15 |
| Use Case | Ai làm gì với hệ thống? | `specs/<context>/UC-XXX-*.md` |
| Entity Model | Hệ thống nói về những danh từ nào? | `specs/<context>/entities.md` |
| Acceptance Criteria | Làm sao biết đúng? | Mục `## Acceptance Criteria` trong từng UC, mỗi AC trỏ tới test |

Quyết định (vì sao chọn cách này, không chọn cách kia): [decisions.md](decisions.md) — ADR-01…ADR-112, theo thứ tự thời gian.

## 3. Bounded context và dải ID

Cùng một từ có thể mang nghĩa khác ở context khác (ví dụ "gán" ở ingest là diễn giải một log ngân hàng; "hoàn tác" ở allocation là gỡ một lần chia). Mỗi context có bảng từ vựng riêng trong `README.md` của nó.

| Context | Thư mục | UC | Code chính |
|---|---|---|---|
| Sổ cái | [ledger/](ledger/README.md) | UC-101… | `src/domain/{types,entry,snapshot,period}.ts`, `src/services/ledger.ts`, `src/routes/v1.ts`, `migrations/` |
| Chia tiền | [allocation/](allocation/README.md) | UC-201… | `src/domain/{allocation,close,transfer-orders}.ts`, phần chia trong `src/services/ledger.ts`, nguồn thu trong `src/services/settings.ts` |
| Bank feed | [ingest/](ingest/README.md) | UC-301… | `src/services/ingest.ts`, `src/domain/rules.ts`, `src/routes/{webhooks,logs}.ts`, `src/cron/backfill.ts` |
| Nhắc & Telegram | [notify/](notify/README.md) | UC-401… | `src/cron/*`, `src/notify/*`, `src/services/push.ts`, `src/routes/push.ts`, `src/services/zalo.ts`, `wrangler.jsonc` |
| Truy cập & cấu hình | [access/](access/README.md) | UC-501… | `src/index.ts`, `src/routes/{auth,session,settings,health}.ts`, `src/services/{settings,secrets}.ts` |
| MCP cho Claude | [mcp/](mcp/README.md) | UC-601… | `src/routes/mcp.ts`, `src/mcp/tools.ts`, `src/oauth/*` |
| PWA | [pwa/](pwa/README.md) | UC-701… | `web/src/**`, `web/sw.js` |
| Cho thuê lại | [rental/](rental/README.md) | UC-801… | `src/domain/rental.ts`, `src/services/rental.ts`, `src/routes/rental.ts`, `migrations/0007_income_streams_rental.sql` |
| Sổ nợ | [debt/](debt/README.md) | UC-901… | `src/services/debts.ts` (trên `src/services/memo-books.ts`), `src/routes/books.ts`, `migrations/0013_debts.sql`; `debt_id` trong `src/domain/entry.ts` |
| Sổ phải thu | [receivable/](receivable/README.md) | UC-1001… | `src/services/receivables.ts` (trên `src/services/memo-books.ts`), `src/routes/books.ts`, `migrations/0014_receivables.sql`; `collect`, `receivable_id` trong `src/domain/entry.ts`; `src/services/ledger.ts` › `netWorth` |
| Bảng cân đối, mốc tự do & báo cáo | [balance/](balance/README.md) | UC-1101… | `src/domain/{balance,reports,interest,freedom}.ts`, `src/services/{balance,reports,freedom,income-plans}.ts`, `src/routes/{balance,reports,freedom}.ts`, `migrations/0031_balance_sheet.sql`…`0033_income_plans.sql`; `web/src/screens/net-worth*.tsx`, `web/src/lib/{net-worth,reports,interest,freedom,income-plan,projection}.ts` |

ID là vĩnh viễn: không đánh số lại, không dùng lại ID đã xoá. AC bỏ đi thì đánh dấu `(deprecated vN: lý do)` thay vì xoá.

## 4. Chỉ mục Use Case

93 UC · 1010 AC · 801 AC có test · **209 AC chưa có test** (chi tiết: [traceability.md](traceability.md)).
Chỉ số: AC Coverage 79,3% · Spec Coverage 97,8% (90/92 UC) · Trace Ratio 87,5% (56/64 commit từ 2026-10-07) — định nghĩa ở `.claude/skills/mk-specs/references/traceability.md` §4.

### [Sổ cái (ledger)](ledger/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-101](ledger/UC-101-nhap-tay-khoan-tien.md) | Nhập tay một khoản tiền | implemented | BR-03, BR-04, BR-01 |
| [UC-102](ledger/UC-102-huy-giao-dich.md) | Huỷ / sửa giao dịch ghi tay | implemented | BR-04, BR-02, BR-03 |
| [UC-103](ledger/UC-103-xem-con-bao-nhieu-de-chi.md) | Xem "còn bao nhiêu để chi" (snapshot) | implemented | BR-01, BR-05, BR-07, BR-04 |
| [UC-104](ledger/UC-104-ngan-sach-theo-ky.md) | Ngân sách theo kỳ (dự kiến / thực tế / còn lại) | implemented | BR-01, BR-05 |
| [UC-105](ledger/UC-105-dem-so-du-dieu-chinh.md) | Đếm số dư tài khoản → bút toán điều chỉnh | implemented | BR-04, BR-07 |
| [UC-106](ledger/UC-106-doi-soat-tai-khoan.md) | Đối soát tài khoản | implemented | BR-04, BR-01, BR-05 |
| [UC-107](ledger/UC-107-theo-doi-tich-luy.md) | Theo dõi tích lũy — Tích sản cash/assets, Quỹ an tâm, quỹ mục tiêu | implemented | BR-07, BR-01, BR-05 |
| [UC-108](ledger/UC-108-chi-theo-danh-muc.md) | Chi theo danh mục (so với tháng trước) | implemented | BR-01, BR-05 |
| [UC-109](ledger/UC-109-quan-ly-danh-muc.md) | Quản lý danh mục chi | implemented | BR-08, BR-03 |
| [UC-110](ledger/UC-110-quyet-toan-thue-nam.md) | Quyết toán thuế năm | implemented | BR-07, BR-02 |
| [UC-111](ledger/UC-111-so-giao-dich-va-du-lieu-nen.md) | Xem sổ giao dịch & tải dữ liệu nền | implemented | BR-03, BR-01, BR-09 |

### [Chia tiền (allocation)](allocation/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-201](allocation/UC-201-tinh-phuong-an-chia.md) | Tính phương án chia một khoản thu (engine) | implemented | BR-02, BR-07, BR-10 |
| [UC-202](allocation/UC-202-xem-truoc-phuong-an-chia.md) | Xem trước phương án chia | implemented | BR-02, BR-05 |
| [UC-203](allocation/UC-203-chia-mot-khoan-thu-nhap.md) | Chia một khoản thu nhập (ghi sổ) | implemented | BR-02, BR-04 |
| [UC-204](allocation/UC-204-sinh-lenh-chuyen-tien.md) | Sinh lệnh chuyển tiền | implemented | BR-02, BR-04, BR-09 |
| [UC-205](allocation/UC-205-theo-doi-lenh-chuyen-tien.md) | Theo dõi & đánh dấu lệnh chuyển tiền | implemented | BR-04, BR-06 |
| [UC-206](allocation/UC-206-go-lan-chia-khi-huy-khoan-thu.md) | Gỡ lần chia khi huỷ khoản thu | implemented | BR-04, BR-09 |
| [UC-207](allocation/UC-207-chot-thang-quet-du.md) | Chốt tháng — bù ví chi lố, chia phần dư sang Tích sản / Ví Thưởng | implemented | BR-02, BR-07 |

### [Bank feed (ingest)](ingest/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-301](ingest/UC-301-nhan-webhook-sepay.md) | Nhận webhook SePay | implemented | BR-03, BR-04, BR-09 |
| [UC-302](ingest/UC-302-ghi-log-chong-trung.md) | Ghi log ngân hàng chống trùng | implemented | BR-04, BR-03 |
| [UC-303](ingest/UC-303-tu-khop-log-vao-so.md) | Tự khớp log vào sổ | implemented | BR-04, BR-02, BR-03 |
| [UC-304](ingest/UC-304-ra-soat-0200-backfill.md) | Rà soát 02:00 & đồng bộ lại theo khoảng ngày qua API SePay | implemented | BR-03, BR-04 |
| [UC-305](ingest/UC-305-gan-log-chua-gan.md) | Gán log chưa gán | implemented | BR-03, BR-04, BR-02 |
| [UC-306](ingest/UC-306-ghep-cap-tay-va-go-gan.md) | Ghép cặp tay & gỡ gán | implemented | BR-04 |
| [UC-307](ingest/UC-307-quan-ly-rule-tu-gan.md) | Quản lý rule tự gán | implemented | BR-08, BR-02, BR-04 |
| [UC-308](ingest/UC-308-doi-soat-feed-va-su-co-ingest.md) | Ghi sự cố ingest | implemented | BR-04, BR-06 |

### [Nhắc & Telegram (notify)](notify/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-401](notify/UC-401-lich-cron-va-dieu-phoi.md) | Lịch cron & điều phối | implemented | BR-06, BR-10 |
| [UC-402](notify/UC-402-tin-sang-0700.md) | Tin sáng (giờ nhắc, mặc định 07:00) | implemented | BR-01, BR-04, BR-06, BR-07 |
| [UC-403](notify/UC-403-kich-hoat-chot-thang-ngay-1.md) | Mời chốt tháng ngày 1 | implemented | BR-02, BR-06, BR-07 |
| [UC-404](notify/UC-404-nhac-dem-vi-chu-nhat.md) | Nhắc đếm ví / nhập số dư Chủ nhật | implemented | BR-04, BR-06 |
| [UC-405](notify/UC-405-nhac-khoan-thu-chua-chia-ngay-10-25.md) | Nhắc khoản thu chưa chia ngày 10 & 25 | implemented | BR-02, BR-06 |
| [UC-406](notify/UC-406-tong-ket-tuan-thu-hai.md) | Tổng kết tuần (giờ nhắc, mặc định 08:00 thứ Hai) | implemented | BR-01, BR-06 |
| [UC-407](notify/UC-407-bao-giao-dich-chua-gan-moi-phut.md) | Báo giao dịch chưa gán (mỗi 15 phút, có giờ yên lặng) | implemented | BR-03, BR-04, BR-06 |
| [UC-408](notify/UC-408-gui-telegram-chong-gui-trung.md) | Gửi tin Telegram chống gửi trùng | implemented | BR-06, BR-08, BR-09 |
| [UC-409](notify/UC-409-bao-luong-ve-da-chia.md) | Báo lương về & đã chia | spec-only | BR-02, BR-06 |
| [UC-410](notify/UC-410-gui-thong-bao-day-web-push.md) | Gửi thông báo đẩy tới máy đã bật (Web Push) | implemented | BR-06, BR-09 |
| [UC-411](notify/UC-411-gui-tin-zalo-bot.md) | Gửi tin qua Zalo Bot (nối bằng mã) | implemented | BR-06, BR-08, BR-09 |

### [Truy cập & cấu hình (access)](access/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-501](access/UC-501-dang-nhap-mat-khau-chung.md) | Đăng nhập bằng mật khẩu chung (hoặc mật khẩu riêng) + chọn người | implemented | BR-09 |
| [UC-502](access/UC-502-goi-api-bang-token.md) | Gọi API bằng Bearer `API_TOKEN` | implemented | BR-09, BR-05 |
| [UC-503](access/UC-503-phan-quyen-theo-duong-dan.md) | Phân quyền theo đường dẫn & không lộ bí mật qua lỗi | implemented | BR-09, BR-10 |
| [UC-504](access/UC-504-an-lich-su-vi-private.md) | Ẩn lịch sự số dư ví `private` | implemented | BR-01, BR-09 |
| [UC-505](access/UC-505-xem-cau-hinh.md) | Xem toàn bộ cấu hình (màn Cài đặt) | implemented | BR-08, BR-09 |
| [UC-506](access/UC-506-cau-hinh-tai-khoan-vi-luat-nap.md) | Cấu hình tài khoản, ví & luật nạp | implemented | BR-08, BR-02, BR-04 |
| [UC-507](access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md) | Cấu hình thành viên, mã chuyển khoản, tham số, giờ nhắc | implemented | BR-08, BR-02, BR-06 |
| [UC-508](access/UC-508-quan-ly-khoa-ket-noi.md) | Quản lý kết nối SePay, khoá Telegram, Zalo & gửi thử | implemented | BR-08, BR-09, BR-03, BR-06 |
| [UC-509](access/UC-509-kiem-tra-song.md) | Kiểm tra sống (health) | implemented | BR-10 |
| [UC-510](access/UC-510-thiet-lap-nha-lan-dau.md) | Thiết lập nhà lần đầu | implemented | BR-08, BR-09 |

### [MCP cho Claude](mcp/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-601](mcp/UC-601-noi-claude-bang-oauth.md) | Nối Claude (và ứng dụng AI) bằng OAuth | implemented | BR-05, BR-09, BR-10 |
| [UC-602](mcp/UC-602-doc-so-lieu-qua-mcp.md) | Đọc số liệu qua MCP (`get_snapshot` = màn Hôm nay) | implemented | BR-05, BR-01, BR-07, BR-04 |
| [UC-603](mcp/UC-603-ghi-giao-dich-qua-mcp.md) | Ghi giao dịch nhập tay qua MCP | implemented | BR-05, BR-03 |
| [UC-604](mcp/UC-604-gan-log-qua-mcp.md) | Gán log ngân hàng qua MCP | implemented | BR-05, BR-04 |
| [UC-605](mcp/UC-605-chia-thu-nhap-qua-mcp.md) | Xem trước & chia thu nhập qua MCP | implemented | BR-05, BR-02 |
| [UC-606](mcp/UC-606-cap-nhat-gia-tai-san-qua-mcp.md) | Cập nhật giá tài sản qua MCP | implemented | BR-05, BR-15 |

### [PWA](pwa/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-701](pwa/UC-701-dang-nhap-dang-xuat-doi-nguoi.md) | Đăng nhập, đăng xuất, đổi người trên máy dùng chung | implemented | BR-09, BR-03 |
| [UC-702](pwa/UC-702-xem-hom-nay.md) | Xem Hôm nay (điện thoại và bảng điều khiển máy tính) | implemented | BR-01, BR-07, BR-04 |
| [UC-703](pwa/UC-703-nhap-nhanh-khoan-chi.md) | Nhập nhanh khoản chi (3 chạm) | implemented | BR-03, BR-01 |
| [UC-704](pwa/UC-704-hang-doi-nhap-offline.md) | Hàng đợi nhập offline và đồng bộ | implemented | BR-03, BR-04, BR-01 |
| [UC-705](pwa/UC-705-nhap-loai-khac.md) | Nhập loại khác — thu nhập, hoàn tiền, mua tài sản, cho vay, chuyển nội bộ | implemented | BR-02, BR-03, BR-07 |
| [UC-706](pwa/UC-706-gan-giao-dich-ngan-hang.md) | Gán giao dịch ngân hàng (màn Gán) | implemented | BR-03, BR-04, BR-02 |
| [UC-707](pwa/UC-707-xem-vi-va-quy.md) | Xem Ví & Quỹ và làm chuyển tiền cần làm | partial | BR-01, BR-07, BR-04, BR-02, BR-12, BR-13 |
| [UC-708](pwa/UC-708-dem-vi-nhap-so-du-that.md) | Đếm ví / nhập số dư thật | implemented | BR-04 |
| [UC-709](pwa/UC-709-sua-cau-hinh-man-cai-dat.md) | Sửa cấu hình ở màn Cài đặt | implemented | BR-08, BR-09 |
| [UC-710](pwa/UC-710-mo-app-khi-mat-mang.md) | Mở app khi mất mạng (service worker, số cũ theo người) | implemented | BR-03, BR-09, BR-10 |
| [UC-711](pwa/UC-711-khung-dieu-huong-va-luat-hien-thi.md) | Khung điều hướng và luật hiển thị (DESIGN.md) | implemented | BR-01 |
| [UC-712](pwa/UC-712-chuyen-ngan-sach-va-bu.md) | Chuyển ngân sách & Bù ví âm | implemented | BR-01, BR-02, BR-04, BR-12 |
| [UC-713](pwa/UC-713-man-nguoi-thue.md) | Màn Người thuê | implemented | BR-11, BR-03 |
| [UC-714](pwa/UC-714-bat-thong-bao-tren-may-nay.md) | Bật thông báo trên máy này | implemented | BR-06, BR-09 |
| [UC-715](pwa/UC-715-xem-sua-xoa-giao-dich.md) | Xem, sửa, xoá một giao dịch | implemented | BR-03, BR-04, BR-01 |
| [UC-716](pwa/UC-716-so-giao-dich.md) | Sổ giao dịch | implemented | BR-01, BR-03, BR-05 |
| [UC-717](pwa/UC-717-man-tai-san-va-tu-do.md) | Màn Tài sản & tự do | implemented | BR-15, BR-12, BR-13, BR-07 |
| [UC-718](pwa/UC-718-che-so-tien-tren-may-nay.md) | Che số tiền trên máy này | implemented | BR-09, BR-01 |
| [UC-719](pwa/UC-719-khoa-app-bang-ma-pin.md) | Khóa app bằng mã PIN | implemented | BR-09 |

### [Cho thuê lại (rental)](rental/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-801](rental/UC-801-thiet-lap-nguoi-thue.md) | Thiết lập người thuê, phí cố định & chi chung | implemented | BR-11, BR-08 |
| [UC-802](rental/UC-802-ghi-nguoi-thue-chi-ho.md) | Ghi người thuê chi hộ & dòng sổ tay | implemented | BR-11, BR-03 |
| [UC-803](rental/UC-803-xem-tam-tinh.md) | Xem tạm tính tháng & bảng kê | implemented | BR-11 |
| [UC-804](rental/UC-804-chot-thang-voi-nguoi-thue.md) | Chốt tháng với người thuê | implemented | BR-11, BR-06 |
| [UC-805](rental/UC-805-nhan-tien-nguoi-thue-tra.md) | Nhận tiền người thuê trả & dùng tiền "Thu cho thuê" | implemented | BR-11, BR-02, BR-04 |

### [Sổ nợ (debt)](debt/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-901](debt/UC-901-them-va-xem-khoan-no.md) | Thêm và xem khoản nợ | implemented | BR-12, BR-05 |
| [UC-902](debt/UC-902-tra-no.md) | Trả nợ: ghi tay, offline, từ ví giữ riêng | implemented | BR-12, BR-03, BR-04 |
| [UC-903](debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md) | Gán giao dịch ngân hàng là trả nợ | implemented | BR-12, BR-04 |
| [UC-904](debt/UC-904-vay-them-chinh-huy-dong-no.md) | Vay thêm, chỉnh tay, huỷ dòng nợ | implemented | BR-12, BR-04 |

### [Sổ phải thu (receivable)](receivable/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-1001](receivable/UC-1001-them-va-xem-khoan-phai-thu.md) | Thêm và xem khoản phải thu | implemented | BR-13, BR-05 |
| [UC-1002](receivable/UC-1002-cho-vay-tra-ho.md) | Cho vay / trả hộ | implemented | BR-13, BR-03, BR-04 |
| [UC-1003](receivable/UC-1003-nhan-lai-tien.md) | Nhận lại tiền | implemented | BR-13, BR-04, BR-01 |
| [UC-1004](receivable/UC-1004-chinh-huy-dong-phai-thu.md) | Chỉnh / huỷ dòng phải thu | implemented | BR-13, BR-04 |
| [UC-1005](receivable/UC-1005-xem-buc-tranh-tien-that.md) | Xem bức tranh tiền thật | implemented | BR-13, BR-01, BR-07 |

### [Bảng cân đối, mốc tự do & báo cáo (balance)](balance/README.md)

| UC | Tên | Status | BR |
|---|---|---|---|
| [UC-1101](balance/UC-1101-quan-ly-tai-san-lo-gia.md) | Thêm mục tài sản, lô, cập nhật giá theo ngày, theo dõi chốt lời / cắt lỗ | implemented | BR-15, BR-05 |
| [UC-1102](balance/UC-1102-xem-bang-can-doi.md) | Xem bảng cân đối, tháp tài sản và lịch sử theo tháng | implemented | BR-15, BR-12, BR-13, BR-05 |
| [UC-1103](balance/UC-1103-moc-tu-do.md) | Mốc tự do — Mốc an tâm, thu nhập, Tự do | implemented | BR-15, BR-07, BR-08 |
| [UC-1104](balance/UC-1104-ke-hoach-thu-nhap.md) | Kế hoạch thu nhập theo năm so với thực tế | implemented | BR-15, BR-02 |
| [UC-1105](balance/UC-1105-luu-chuyen-tien.md) | Báo cáo lưu chuyển tiền theo tháng / năm | implemented | BR-15, BR-04, BR-12 |
| [UC-1106](balance/UC-1106-ket-qua-thu-chi.md) | Báo cáo kết quả thu chi theo tháng / năm | implemented | BR-15, BR-02, BR-12 |
| [UC-1107](balance/UC-1107-thu-so-du-phong.md) | Thử số / Dự phóng — gõ giả định trên nền số thật, không lưu | implemented | BR-15 |

## 5. Mã quyết định trong plan → ADR

Spec context trích `D#` theo `plans/260921-2228-profit-first-pwa/context.md`; bản đầy đủ ở [decisions.md](decisions.md).

| D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | D9 | D10 | D11 | D12 | D13 | D14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ADR-13 | ADR-14 | ADR-15 | ADR-16 | ADR-17 | ADR-18 | ADR-19 | ADR-20 | ADR-21 | ADR-22 | ADR-23 | ADR-31 | ADR-32 | ADR-48 |

## 6. Hàng đợi quyết định cho chủ nhà

Toàn bộ 79 divergence và 284 câu hỏi mở nằm ở [open-issues.md](open-issues.md). Dưới đây là những mục **ảnh hưởng tới tiền, tới lời hứa trong BR, hoặc tới bảo mật** — cần chủ nhà chọn bên đúng rồi sửa spec/code theo quy trình ở §7.

**Tiền và sổ**
1. **Nhập tay khoản thu không tự chia ở server** — `docs` §4 nói "chạy ngay khi income được xác nhận"; REST/MCP chỉ ghi, PWA tự gọi `/v1/allocate` tiếp theo, còn Claude phải tự gọi. → [UC-203](allocation/UC-203-chia-mot-khoan-thu-nhap.md), [UC-605](mcp/UC-605-chia-thu-nhap-qua-mcp.md)
2. **`adjust` khi đếm ví luôn ghi vào ví Có-thì-tốt**, không chọn được ví khác như `docs` §2. → [UC-105](ledger/UC-105-dem-so-du-dieu-chinh.md)
3. **Đối soát lớp 2 so theo tổng tài khoản, không theo từng log** như `docs` §7. → [UC-106](ledger/UC-106-doi-soat-tai-khoan.md)
4. **`matchLog` UPDATE `log_id_2` trên dòng đã ghi** — lệch luật 1 "sổ chỉ ghi thêm". → [decisions.md ADR-02](decisions.md)
5. **"Chuyển sang Tích sản" trên thẻ "Thu cho thuê" chỉ đổi ví, không chuyển tiền thật** (proposal: chuyển MB → BIDV kèm ví); khi Tích sản ở BIDV, tiền vẫn nằm ở MB và không có lệnh chuyển nào. Heo đất nay vào thẳng Tích sản lúc bỏ heo (ADR-82) — tiền Tích sản nằm ở tài khoản heo khóa, cùng kiểu "ví một nơi, tiền một nơi". → [UC-805](rental/UC-805-nhan-tien-nguoi-thue-tra.md), [UC-712](pwa/UC-712-chuyen-ngan-sach-va-bu.md), [UC-707](pwa/UC-707-xem-vi-va-quy.md)
6. **Khoản thu gắn nguồn không bị trích Thuế** dù `taxable` (engine bỏ luật thuế chung khi có nguồn). → [UC-201](allocation/UC-201-tinh-phuong-an-chia.md)
7. **Trả nợ gốc đang là khoản chi** ("đã tiêu" của ví trả nợ), trong khi VAS 24 §11(d) xếp nó vào hoạt động tài chính và tiền cho vay về đã thôi là "thu" (`collect`, ADR-72). Đề xuất meaning `repay` đối xứng — chủ nhà chưa quyết. Từ ADR-104 / ADR-106 (2026-10-08): báo cáo Lưu chuyển tiền và Kết quả thu chi xếp gốc vào Tài chính, bỏ khỏi Chi tiêu / E; phần lãi tách thành chi phí — còn ví / ngân sách của phần gốc giữ nguyên, nên mục này vẫn mở. → [debt UC-902](debt/UC-902-tra-no.md)

**Lời hứa trong BR/plan chưa giữ**
8. **"đã bù X" không hiện ở bảng Ví & Quỹ** (chỉ ở bảng chia thử); `/v1/budget` không trả `deficitCovered` (nay có `balance` + nút "Bù" tay, nhưng vẫn không phải "đã bù X"). Đây là một mục "Định nghĩa xong" của plan. → [UC-707](pwa/UC-707-xem-vi-va-quy.md) (partial)
9. **Tin "Lương về & đã chia" không được gửi.** → [UC-409](notify/UC-409-bao-luong-ve-da-chia.md) (spec-only)
10. **Tin gửi hỏng (`ok=0`) được ghi nhưng không nơi nào đọc** — không có badge; push hỏng không phải 404/410 cũng vậy, máy vẫn hiện "Đang bật"; bot Zalo hết hạn mức 3.000 tin/tháng (429) cũng chỉ có log. (`reconcile_drift` không còn ghi từ ADR-87.) → [UC-408](notify/UC-408-gui-telegram-chong-gui-trung.md), [UC-410](notify/UC-410-gui-thong-bao-day-web-push.md), [UC-411](notify/UC-411-gui-tin-zalo-bot.md)
11. **MCP xem số như chủ hộ, màn Hôm nay xem như người đăng nhập** — khác nhau khi có ví `private`, trái BR-05 "đúng số như app". → [UC-602](mcp/UC-602-doc-so-lieu-qua-mcp.md)
12. **Chip "khớp mẫu lương" ở màn Gán không bao giờ hiện** — server không trả `is_salary` trong gợi ý (phần gợi ý "Rút tiền mặt" đã khớp từ ADR-77: dòng mặc định điền sẵn tài khoản đầu kia). → [UC-706](pwa/UC-706-gan-giao-dich-ngan-hang.md)

**Bảo mật và cấu hình**
13. **Webhook SePay không giới hạn tần suất** (phase-04 yêu cầu 60 req/phút). → [UC-301](ingest/UC-301-nhan-webhook-sepay.md)
14. **Đăng nhập không giới hạn số lần thử**, không thu hồi được một phiên đơn lẻ. → [UC-501](access/UC-501-dang-nhap-mat-khau-chung.md)
15. **Kiểm tra dữ liệu lệch giữa PWA và server**: `safety_fund_months` 1–24 vs 1–36; `tg_chat_id` 5–20 vs 3–20 chữ số. → [UC-507](access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md)
16. **Máy dùng chung khi `localStorage` bị chặn**: người trước không Đăng xuất (phiên hết hạn) rồi người sau đăng nhập — app không biết máy đang gắn ai nên **chuyển thông báo đẩy của máy sang người vừa vào** mà người đó không bấm Bật. → [UC-714](pwa/UC-714-bat-thong-bao-tren-may-nay.md)

**Việc chủ nhà đang nợ** (ADR `proposed`): D14 chặn nhập tay trên TK có feed — đã chạy nhưng chưa xác nhận ([ADR-48](decisions.md)); ngưỡng lương 1.000.000 ₫ ([ADR-43](decisions.md)); nơi đặt ví Thuế (Tích sản đã chốt BIDV — [ADR-55](decisions.md)); lên Workers Paid ([ADR-54](decisions.md)); quota cron ([ADR-56](decisions.md)); phase-00 SePay ([ADR-57](decisions.md)) — nay quyết định luôn có bật "SePay báo cả tiền ra" cho TK MB hay không, vì tài liệu SePay nói MB chỉ báo tiền vào ([ADR-66](decisions.md)); việc này quyết định luôn khoản bỏ heo đất của MB tự gán hay nằm chờ gợi ý ([ADR-77](decisions.md)); khoản offline bị từ chối có trừ vào "còn lại" không ([ADR-38](decisions.md)); mã `EMS` ([ADR-33](decisions.md)) — `QTT` (tiết kiệm tiền lẻ) đã có câu trả lời cho tài khoản MB của người có heo ([ADR-77](decisions.md)).

**Tài liệu cũ cần sửa theo code** (không phải quyết định, chỉ là `docs/` lỗi thời): port `Store/Notifier/Config` và `src/db/queries.ts` không tồn tại (ADR-06); schema đã là v1.20 với 28 bảng, không còn v1.3/13 bảng; `batch_id` chốt tháng là `S<YYYYMM>`, không phải `sweep-<month_key>`; memo lệnh chuyển là mã ngẫu nhiên, không phải `PF <batch_id>`.

## 7. Quy trình thay đổi

Theo skill `mk-specs` (`.claude/skills/mk-specs`, chi tiết ở `references/workflow-change.md`), cấu hình [`mk-specs.yml`](mk-specs.yml); luật riêng của repo ở `AGENTS.md` §5.

1. **Đề xuất** — `specs/changes/<yyMMdd>-<slug>/proposal.md` theo mẫu của skill ([changes/README.md](changes/README.md)): lý do (trích lời chủ nhà), BR, UC/AC thêm/sửa/bỏ, ADR mới nếu có quyết định.
2. **Duyệt hai phía** — chủ nhà duyệt nghiệp vụ (có thiếu rule "đương nhiên" không?); một reviewer khác tác giả (người hoặc reviewer agent) duyệt kỹ thuật; ghi cả hai vào proposal. Rule về tiền, quyền truy cập, bảo mật: **người quyết, AI chỉ đề xuất**. Commit `docs(UC-xxx): propose <slug>`.
3. **Test theo AC, rồi code** — mỗi AC mới/sửa có ít nhất một test (đỏ trước), tên test nêu hành vi, ghi vào dòng `- Tests:`. Commit `feat|fix|refactor(UC-xxx): …`.
4. **Hợp nhất** — chép thay đổi vào UC chính, dòng `## History` mang hash commit code, ADR vào `decisions.md`, chuyển change sang `specs/changes/archive/`, sinh lại + kiểm (§8). Commit `docs(UC-xxx): merge <slug>`.

Mọi commit subject mang ID có thật: `<type>(UC-xxx[,UC-yyy]): …`, `(BR-xx)` hoặc `(ADR-xx)`; việc chung cả repo dùng scope `(specs)` hoặc `(deps)`.

Sửa lỗi nhỏ không đổi AC (typo, refactor giữ nguyên AC, bug không đổi AC): không cần change folder, nhưng vẫn cập nhật History / AC / `[OPEN]` của UC bị đụng trong cùng thay đổi; commit code rồi commit spec.

**Definition of Done**: `AGENTS.md` §5.

## 8. File sinh tự động

`traceability.md`, `open-issues.md`, dòng đếm và dòng chỉ số ở §4, số divergence/open ở §6, dải BR/ADR ở §2 do script của skill sinh; banner đầu file chỉ giữ 5 dòng "Cập nhật"/"Hợp nhất" mới nhất (lịch sử đầy đủ ở History từng UC/ADR và `git log -- specs/`). Sửa ở UC/ADR, không sửa tay.

- Sinh lại: `npm run specs:gen` — in số đếm UC · AC · có test · divergence · open và AC Coverage · Spec Coverage · Trace Ratio.
- Kiểm: `npm run specs:check` — mọi tên test được trích phải có thật (so với `vitest list`), mọi link tương đối phải mở được; phải ra 0 unresolved trước khi commit.
- Rà soát: `python3 .claude/skills/mk-specs/scripts/audit.py` — UC thiếu mục, chữ kỹ thuật trong Main Flow/AC (chuyển sang `## Traceability` khi chạm tới), commit thiếu ID.
