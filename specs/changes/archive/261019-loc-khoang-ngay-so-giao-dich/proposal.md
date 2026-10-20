# 261019-loc-khoang-ngay-so-giao-dich: Lọc sổ giao dịch theo khoảng ngày (Từ ngày X đến ngày Y)
- Status: archived (hợp nhất 2026-10-18)
- BR: BR-03 (xem lại các khoản đã ghi, tìm, lọc)
- Đụng tới: ledger UC-111 (sổ giao dịch & tải dữ liệu nền) · pwa UC-716 (sổ giao dịch) · decisions ADR-115
- Đóng: —
- Người duyệt nghiệp vụ: mza, 2026-10-18, chat ("xong thì làm đi nhé / specs , review, cook, fix, deploy, cập nhật doc và release bản mới" — giao việc trực tiếp; 3 lựa chọn chốt qua chat) · Người duyệt kỹ thuật: reviewer agent, 2026-10-20, APPROVE_WITH_CHANGES → đã sửa xong
- Commit: propose `1c1858b` · code `a746780` · merge `—`

## Vì sao
> "sổ giao dịch thiếu cái lọc từ ngày x đến ngày Y , mới có tháng thôi nè" (mza, chat 2026-10-18 kèm ảnh màn Sổ giao dịch)

Hiện tại màn Sổ giao dịch (UC-716) chỉ cho phép xem theo từng tháng (bộ lùi/tiến `< tháng MM/YYYY >`) hoặc xem cả sổ ("Mọi tháng"). Khi cần đối soát hoặc xem lại chi tiêu cho một khoảng thời gian cụ thể (ví dụ 10 ngày đầu tháng, một chuyến đi, hay một đợt chi tiêu vắt qua 2 tháng), người dùng không có cách nào lọc theo khoảng ngày mà buộc phải duyệt qua từng tháng hoặc duyệt cả sổ.

Chủ nhà đã chốt phương án qua chat (2026-10-18):
1. **Vị trí thao tác:** Đặt 2 ô "Từ ngày" và "Đến ngày" trong sheet **Lọc sổ giao dịch** (`FilterSheet`). Khi có lọc ngày, ngoài màn hình hiện chip ví dụ `1/10 – 15/10/2026 ×` để bỏ nhanh.
2. **Quan hệ Tháng vs Khoảng ngày:** Khoảng ngày ghi đè tháng (xem đúng các giao dịch trong khoảng ngày được chọn). Khi đang có khoảng ngày, nút lùi/tiến tháng `< >` mờ đi; bấm nút **Theo tháng** hoặc chạm `×` trên chip khoảng ngày sẽ xoá lọc ngày và quay về xem tháng hiện tại.
3. **Giới hạn:** Ngày lọc tối đa là hôm nay (giờ VN), không chọn ngày tương lai; `from_date` không được sau `to_date`.

## Thay đổi spec

### ledger UC-111 — MODIFIED
- `GET /v1/transactions` và `GET /v1/transactions/summary` nhận thêm hai query parameter tuỳ chọn:
  - `from_date`: dạng `YYYY-MM-DD` (ngày theo giờ VN).
  - `to_date`: dạng `YYYY-MM-DD` (ngày theo giờ VN).
- Kiểm tra hợp lệ (`txFilter`):
  - Định dạng sai khác `YYYY-MM-DD` hoặc ngày không tồn tại trên lịch (như 2026-02-30) → 400 `invalid_input` ("from_date phải có dạng YYYY-MM-DD." hoặc "to_date phải có dạng YYYY-MM-DD.").
  - `from_date` sau `to_date` (khi gửi cả hai) → 400 `invalid_input` ("from_date không được sau to_date.").
  - `from_date` hoặc `to_date` sau ngày hôm nay giờ VN → 400 `invalid_input` ("Ngày lọc không được sau hôm nay.").
- Tương tác với `month`: khi có `from_date` hoặc `to_date`, tham số `month` bị bỏ qua trong điều kiện truy vấn.
- Điều kiện SQL (`txWhere`):
  - Có `from_date`: mốc đầu ngày giờ VN `${from_date}T00:00:00+07:00` đổi sang UTC ISO `fromAt`, thêm điều kiện `t.at >= ?`.
  - Có `to_date`: mốc đầu ngày kế tiếp giờ VN tính an toàn bằng `new Date(Date.parse(`${to_date}T00:00:00+07:00`) + 86_400_000).toISOString()` thành `toAt`, thêm điều kiện `t.at < ?`.
  - Tận dụng 100% index có sẵn `idx_tx_at ON transactions(at DESC)`, phân trang `before` giữ nguyên tính đúng đắn.
- ADDED UC-111 AC-15:
  - Given các giao dịch ngày 28/8, 01/9 10:00, 15/9 23:30, 20/9, 05/10;
  - When `?from_date=2026-09-01&to_date=2026-09-15` (cả list và summary); rồi trang sau với con trỏ `before`; rồi chỉ `from_date=2026-09-20`; rồi chỉ `to_date=2026-09-01`; rồi gửi kèm cả `month=2026-10`; rồi `from_date=2026-10-10&to_date=2026-10-01`; rồi `from_date=2026-02-30`; rồi `from_date` ở tương lai;
  - Then lần 1: đúng 2 khoản (01/9, 15/9), summary trả đúng `count: 2`, tổng chi/thu khớp; trang sau với `before` giữ nguyên bộ lọc khoảng ngày; lần 3: các khoản từ 20/9 đến nay; lần 4: các khoản đến hết 01/9; lần 5: khoảng ngày ghi đè month; lần 6: 400 "from_date không được sau to_date."; lần 7: 400 "from_date phải có dạng YYYY-MM-DD."; lần 8: 400 "Ngày lọc không được sau hôm nay."

### pwa UC-716 — MODIFIED
- `BookFilter` thêm hai trường tuỳ chọn: `fromDate: string | null`, `toDate: string | null`.
- `filterQuery(f)`: nếu có `f.fromDate` hoặc `f.toDate` (và `fromDate <= toDate` khi có cả hai), thêm `from_date`, `to_date` vào query và bỏ `month`.
- Helper `dateRangeLabel(from, to, now)`: trả chuỗi nhãn hiển thị khoảng ngày thống nhất cho thanh bar, chip và phụ đề tiêu đề màn hình (`d/m – d/m/yyyy`, `Từ d/m/yyyy`, `Đến d/m/yyyy`).
- Sheet **Lọc sổ giao dịch** (`FilterSheet`): thêm nhóm trường **Thời gian**:
  - Hàng "Từ ngày" (`input type="date"` max là `filter.toDate || today`) và "Đến ngày" (`input type="date"` min là `filter.fromDate || undefined` và max là `today`).
  - Có nút "Xoá khoảng ngày" khi đang có ngày được chọn.
  - Khi người dùng chọn từ/đến ngày: `month` được đặt về `null`.
- Hàng nút viên (chip): khi có khoảng ngày, hiện một chip:
  - Nhãn từ `dateRangeLabel`.
  - Chạm `×` trên chip (`removeChip`): xoá khoảng ngày (`fromDate = null, toDate = null`), quay về lọc theo tháng hiện tại (`month = monthKey(now)`).
- Thanh bar đầu màn hình khi đang lọc theo khoảng ngày (`hasDateRange = Boolean(filter.fromDate || filter.toDate)`):
  - Hai nút chuyển tháng `<` và `>` bị mờ (`disabled={hasDateRange || ...}`).
  - Chữ hiển thị ở giữa: nhãn khoảng ngày (ví dụ `01/09 – 15/09/2026`).
  - Nút bên cạnh chuyển thành **Theo tháng**: chạm vào sẽ bỏ khoảng ngày và quay về tháng hiện tại.
  - Dòng phụ tiêu đề màn hình: "01/09 – 15/09/2026".
- Thao tác **+ Ghi khoản** khi đang xem khoảng ngày (`entryDay(f, now)`):
  - Nếu `toDate` trước hôm nay: ngày mặc định ở màn Nhập là `toDate`.
  - Nếu khoảng ngày chứa hôm nay (hoặc không có `toDate`): ngày mặc định là hôm nay.
- `clearFilters(f, now)`: chỉ reset `month = monthKey(now)` nếu trước đó đang có khoảng ngày; nếu đang xem theo tháng trong quá khứ thì giữ nguyên tháng đó.
- ADDED UC-716 AC-10:
  - Given hôm nay 06/10/2026, các giao dịch trải dài từ tháng 8 đến tháng 10;
  - When mở sheet Lọc chọn Từ 01/9 Đến 15/9; chạm `×` trên chip; bấm `Theo tháng` khi đang lọc ngày; bấm `+ Ghi khoản` khi đang lọc 01/9 – 15/9;
  - Then sổ chỉ hiện các khoản từ 01/9 đến 15/9, tổng chi đúng; chip khoảng ngày hiển thị; chạm `×` quay về tháng 10/2026; bấm `Theo tháng` quay về tháng 10/2026; màn Nhập mở với ngày điền sẵn 15/9.

## Quyết định
ADR nháp (ADR-115) — **Lọc sổ giao dịch theo khoảng ngày: chọn trong Sheet Lọc sổ giao dịch, khoảng ngày ghi đè tháng; SQL lọc `t.at >= ? AND t.at < ?` theo mốc UTC ISO.**
- **Phương án bị loại:**
  - (a) Đặt cụm date range ngay trên thanh bar đầu màn hình: thanh bar trên mobile 390px đã quá chật (gồm `< tháng >`, nút `Mọi tháng`, ô Tìm, nút `Lọc`), thêm 2 ô date picker sẽ vỡ giao diện hoặc phải cuộn ngang phức tạp.
  - (b) Buộc khoảng ngày phải nằm trong tháng đang chọn: không đáp ứng được nhu cầu xem các đợt chi tiêu vắt qua ranh giới tháng.
  - (c) Dùng hàm SQLite `date(t.at, '+7 hours') BETWEEN ? AND ?`: không dùng được index `idx_tx_at ON transactions(at DESC)`. Dùng mốc UTC ISO `${from_date}T00:00:00+07:00` $\to$ ISO và `${to_date}T00:00:00+07:00 + 86.400.000ms` $\to$ ISO tận dụng được 100% index `idx_tx_at`.
- **Hệ quả:**
  - Backend API `/v1/transactions` và `/v1/transactions/summary` hỗ trợ linh hoạt cả xem theo tháng lẫn khoảng ngày bất kỳ.
  - Người dùng có thể dễ dàng kiểm tra chi tiêu theo từng kỳ lương (ví dụ 15 hàng tháng đến 14 tháng sau) hoặc các chuyến đi/dự án ngắn hạn.

## Thiết kế
- `src/services/ledger.ts`:
  - `TxFilter`: thêm `fromDate?: string`, `toDate?: string`.
  - `txWhere`: tính `fromAt`, `toAt` an toàn qua Date ISO (`+ 86_400_000 ms`), thêm điều kiện `t.at >= ?` và `t.at < ?`. Bỏ qua `f.month` khi có `fromDate` hoặc `toDate`.
- `src/routes/v1.ts`:
  - `txFilter`: đọc `from_date`, `to_date`, kiểm tra định dạng regex kết hợp tính hợp lệ lịch (`dayKey(new Date(`${v}T00:00:00+07:00`)) === v`), kiểm tra `from_date <= to_date`, kiểm tra không vượt quá `dayKey(now)`.
- `web/src/lib/tx-filter.ts`:
  - `BookFilter`: thêm `fromDate: string | null`, `toDate: string | null`.
  - `dateRangeLabel(from, to, now)`: helper định dạng nhãn hiển thị ngày.
  - `filterQuery`: serialize `from_date`, `to_date`, bỏ qua `month` nếu có khoảng ngày hợp lệ.
  - `filterChips`: thêm chip `dateRange` khi có `fromDate` hoặc `toDate`.
  - `removeChip`: xoá `fromDate`, `toDate`, đặt lại `month = monthKey(now)`.
  - `clearFilters`: reset `fromDate = null`, `toDate = null`; reset `month = monthKey(now)` nếu trước đó có khoảng ngày.
  - `entryDay`: hỗ trợ tính ngày mặc định khi có khoảng ngày.
- `web/src/screens/ledger-book.tsx`:
  - `FilterSheet`: thêm 2 trường "Từ ngày" và "Đến ngày" (`input type="date"`), thuộc tính `min`/`max` hợp lý, nút "Xoá khoảng ngày".
  - Thanh tháng: hiển thị `dateRangeLabel` khi có khoảng ngày, disable nút `< >` khi `hasDateRange`, nút `Mọi tháng` chuyển thành `Theo tháng` và khi bấm thì reset về tháng hiện tại.
- Rủi ro: Không có migration, không đổi cấu trúc DB. Chỉ thêm bộ lọc trên API và PWA.

## Tự soát
- Ngày: 2026-10-20 · audit.py: 0 thiếu mục bắt buộc · verify.py: 0 unresolved.
- Đã tự sửa sau review: validate ngày hợp lệ lịch chống lỗi 500; tính toAt bằng Date + 86_400_000ms; disable nút lùi tháng khi có date range; clearFilters giữ tháng cũ nếu không lọc ngày; cập nhật chữ ký entryDay; thêm dateRangeLabel; bổ sung summary và before vào AC-15.
- Đã hỏi (3 điểm): vị trí giao diện (Sheet Lọc), quan hệ Tháng vs Khoảng ngày (ghi đè), giới hạn ngày (không quá hôm nay) — chủ nhà đã chốt.
- Còn mở: —

## Review kỹ thuật
- 2026-10-20: APPROVE_WITH_CHANGES (reviewer agent).
- Báo cáo tại `plans/reports/review-261019-loc-khoang-ngay-so-giao-dich.md`.
- Đã xử lý toàn bộ 5 phát hiện P2 và 4 phát hiện P3 vào proposal.

## Việc cần làm
- [x] Commit propose `docs(UC-111,UC-716): propose loc-khoang-ngay-so-giao-dich` (`1c1858b`)
- [x] Test đỏ: API test (`test/api.test.ts`), PWA filter test (`web/src/lib/tx-filter.test.ts`)
- [x] Code backend: `src/services/ledger.ts`, `src/routes/v1.ts`
- [x] Code frontend: `web/src/lib/tx-filter.ts`, `web/src/screens/ledger-book.tsx`
- [x] Kiểm tra: `npm test`, `npm run typecheck`, `npm run build`, chạy thử 390px qua `tools/chup-lai.sh so-giao-dich`
- [x] Review code (`code-review-261019-loc-khoang-ngay-so-giao-dich.md`) & commit code `feat(UC-111,UC-716): lọc sổ giao dịch theo khoảng ngày` (`a746780`)
- [x] Hợp nhất UC-111, UC-716, ADR-115, archive proposal, gen & check specs
- [ ] Cập nhật CHANGELOG, GitBook vi-nha-doc
- [ ] Phát hành v1.7.0 lên vi-nha & deploy production
