# 261017-noi-sepay-sau: Nối SePay cho tài khoản đã dùng — mốc bắt đầu theo dõi để không đếm hai lần, không lệch giả
- Status: archived
- BR: BR-04 (tiền thật khớp sổ), BR-01 (một giao dịch ngân hàng vào sổ một lần)
- Đụng tới: access UC-506 (sửa tài khoản, bật SePay) · ingest UC-302 (ghi log, log trước mốc), UC-304 (rà soát / đồng bộ lại), UC-306 (ghép cặp tay) · ledger UC-106 (đối soát) · pwa UC-707 (tab Tài khoản), UC-709 (sheet tài khoản)
- Đóng: —
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-17, chat ("fix triệt để vấn đề này, vì nếu ta lỗi thì khách của ta cũng lỗi") — sửa lỗi, không đổi luật tiền · Người duyệt kỹ thuật: reviewer agent, 2026-10-17, request changes → đã sửa
- Commit: propose `50dd910` · code `cb54dd7` · merge `—`

## Vì sao

Change `261016-lech-gia-khi-noi-sepay-sau` sửa lệch giả của đối soát. Rà tiếp cùng nguyên nhân — **bật SePay cho một tài khoản đã có giao dịch** — còn ba lỗi, cũng xảy ra ở mọi nhà cài bản công khai:

1. **Đếm hai lần khi SePay gửi lại lịch sử.** Mốc đối soát / nhận log của tài khoản là `opened_at` (ADR-76). Tài khoản mở sổ 1/10, nối SePay 15/10: rà soát đêm ngày 1/11 lấy **cả tháng 10** (`src/cron/backfill.ts:25-31`), hay người bấm Đồng bộ lại — log tiền vào 1/10–15/10 của tài khoản này về `pending`, dù các khoản đó đã vào sổ từ phía tài khoản gửi (ghi từ log của bên kia, hoặc nhập tay khi chưa nối). Gắn chân thứ hai (ADR-81) chỉ khi giao dịch không tách dòng và lệch ≤ 10 phút; khoản đã tách (vd 9.000.000 = 7.500.000 + 1.500.000) nằm ở màn Gán, gán là tiền vào sổ hai lần — đối soát không thấy (cả giao dịch lẫn log đều của tài khoản đó).
2. **Số "theo ngân hàng" vô nghĩa.** `feed_balance = opening_balance + Σ log từ opened_at` (`v_account_logs`): tài khoản nối sau chỉ có log từ lúc nối, nên tab Tài khoản hiện −97.536 cạnh số sổ 11.502.464 (kiểm live 2026-10-16).
3. **Nhập tay trước khi nối bị bỏ quên.** Chi / thu nhập tay ở tài khoản này trước lúc nối (D14 chỉ chặn sau khi có feed) và log SePay gửi lại cùng khoản — như (1).

## Thay đổi spec

### access UC-506 — MODIFIED (bật SePay, mốc theo dõi)
- Tài khoản có **mốc theo dõi SePay** `feed_from` (ISO `toISOString()`, NULL = từ ngày mở sổ như cũ). Log **lịch sử** (rà soát đêm, Đồng bộ lại — `source='backfill'`) của tài khoản có `at < feed_from` coi như trước ngày mở sổ. Log webhook không bao giờ bị bỏ vì mốc (webhook về trễ mang giờ trước mốc vẫn là SePay báo lúc đó); `opened_at` vẫn áp như cũ.
- **Tự đặt** khi bật SePay (`sepay_enabled` 0 → 1, trong `updateAccount`) **chỉ khi** tài khoản đã có giao dịch active chạm nó với ngày ≥ `opened_at` hoặc đã có lần Nhập số dư: `feed_from` = lúc bật. Tài khoản chưa dùng (vd vừa thiết lập lần đầu) → không đặt mốc, Đồng bộ lại vẫn lấy được lịch sử từ ngày số dư đầu.
- **Sửa tay:** `PATCH /v1/settings/accounts/:id { feed_from }` nhận `null` hoặc ISO hợp lệ, không ở tương lai, không trước 00:00 giờ VN của `opened_at` → sai 400 `invalid_input`; lưu dạng `toISOString()`. Sheet tài khoản (khi bật SePay): "SePay theo dõi từ" — **Lúc bật** (sổ đã đủ) · **Ngày số dư đầu** (lấy lịch sử) · giờ tuỳ chọn; gợi ý đặt mốc khi log sớm nhất của tài khoản sau ngày `opened_at` mà chưa có mốc.
- Bật SePay khi tài khoản còn log `pending` → 409 `pending_logs` (như Nhập số dư).
- **Mốc không vượt log đã nhận:** mốc mới (PATCH hay tự đặt) mà còn log lịch sử `pending` / `assigned` của tài khoản có `at` < mốc → 409 `feed_from_after_logs` ("Đã có giao dịch ngân hàng của tài khoản này trước mốc này — chọn mốc sớm hơn."), không đổi gì. Mốc đúng bằng `at` của log được; dời sớm hơn luôn được (trong giới hạn ngày số dư đầu). `sepay_out_from` không sửa tay.
- **Nhật ký:** `account.update` ghi cũ → mới cho `feed_from`, `sepay_out_from`, `opened_at`, `opening_balance` khi đổi. Đổi `feed_from` thì báo cả nhà (như gỡ kết nối Claude): "{người} vừa đổi mốc theo dõi SePay của {tài khoản}: {cũ} → {mới}".
- **Nhập tay trước mốc được:** chặn `fed_account` không áp với giao dịch có `at < feed_from` (ghi bù khoản trước lúc nối).
- **Tiền ra:** bật `sepay_out` 0 → 1 trên tài khoản đã có SePay ghi `sepay_out_from` = lúc bật; log ra có `at < sepay_out_from` xử lý như tài khoản "chỉ tiền vào" (giữ `pending` kèm lời nhắc, rule không tự gán), vì khoản chi trước đó được nhập tay.
- ADDED AC-25: tài khoản có giao dịch tháng 10, bật SePay 15/10 22:24 → `feed_from` = lúc đó; tài khoản chưa có giao dịch nào bật SePay → `feed_from` NULL; PATCH `feed_from` tương lai / trước ngày mở sổ / sai dạng → 400; còn log `pending` → 409; có log lịch sử đã gán 10/10 → PATCH mốc 12/10 → 409 `feed_from_after_logs`, mốc đúng bằng `at` log → được; đổi mốc → nhật ký cũ → mới và báo cả nhà.
- ADDED AC-26: khoản tiền vào ngày 12/10 (trước mốc 15/10) nhập tay → 201; ngày 16/10 → 400 `fed_account`.
- ADDED AC-27: bật `sepay_out` 20/10; log ra 18/10 về khi rà soát → `pending`, không tự gán theo rule; log ra 21/10 → tự gán như cũ.

### ingest UC-302 / UC-304 / UC-303 — MODIFIED (log trước mốc)
- Log lịch sử (rà soát đêm, Đồng bộ lại) có `at < feed_from` → `ignored` như log trước ngày mở sổ (UC-302 2b): không vào sổ, màn Gán, ghép cặp; ứng viên ghép cặp và tìm tài khoản trong `ingestLog` cùng luật. Webhook không áp mốc. Câu báo sau Đồng bộ lại đếm riêng "trước mốc theo dõi SePay — đã có trong sổ".
- ADDED AC-12 (UC-302): mở sổ 1/10, mốc 15/10 22:24 → rà soát trả log vào 11/10 9.000.000 → `ignored`, không ở màn Gán; log 15/10 22:30 → xử lý bình thường; log có `at` **đúng bằng** mốc → trong phạm vi; webhook tới 22:25 mang `at` 22:20 → `pending`, đối soát khớp sau khi gán; rà soát trả log 22:21 → `ignored`.

### ledger UC-106 — MODIFIED (đối soát, tính động)
- Phạm vi log: ngày VN ≥ `opened_at` và (`feed_from` NULL hoặc `at ≥ feed_from` hoặc log webhook) — cho `assigned_net`, `pending_*`, `tx_net`.
- `feed_balance` = `opening_balance` + Σ giao dịch active chạm tài khoản có `at < feed_from` **không** mang log của chính tài khoản trong phạm vi + Σ log trong phạm vi. Không lưu số dư lúc bật (huỷ / sửa / ghi bù khoản trước mốc, sửa số dư đầu đều tự đúng).
- ADDED AC-10: sổ 11.602.464 lúc bật, rồi log ra 100.000 đã gán → `feed_balance` = `book_balance` = 11.502.464, `book_drift` 0; huỷ một khoản trước mốc → `feed_balance` vẫn bằng sổ; ghi bù khoản trước mốc → vẫn bằng sổ.

### pwa UC-707 / UC-709
- Tab Tài khoản: cột "theo ngân hàng" khớp sổ cho tài khoản nối sau. Sheet tài khoản: hàng "SePay theo dõi từ" như trên.

## Quyết định
**ADR-113 — Mốc theo dõi SePay (theo giờ) cho tài khoản đã dùng; log lịch sử trước mốc như log trước ngày mở sổ (webhook luôn tính); số "theo ngân hàng" tính động.** Mở rộng ADR-76. Mốc chỉ tự đặt khi sổ đã có dữ liệu (không làm mất lịch sử của tài khoản mới); sửa được nhưng không vượt qua log lịch sử đã nhận (chống giấu log khỏi đối soát), mỗi lần đổi ghi nhật ký và báo cả nhà; khoản trước mốc ghi tay được. Tiền ra có mốc riêng khi bật "báo cả tiền ra". Loại: chụp số dư lúc bật (lệch dần khi sửa khoản cũ); dặn đừng đồng bộ lại (không chặn được rà soát tuần / tháng); gắn chân hai rộng hơn (dễ gắn nhầm).

## Thiết kế
- Migration 0036 (schema v1.36): `accounts.feed_from TEXT`, `accounts.sepay_out_from TEXT`; dựng lại `v_account_logs`, `v_account_tx_from_logs`, `v_reconcile`. Không điền mốc cho tài khoản có sẵn. `docs/schema.sql`, `test/schema.test.ts`, `test/app.test.ts`.
- `src/services/settings.ts`: `updateAccount` (mốc tự đặt / PATCH / 409); `ACCOUNT_SQL` trả `feed_from`, `sepay_out_from`.
- `src/services/ledger.ts`: `loadRefs` có `feedFrom`; `createEntry`, `replaceTransaction` bỏ chặn `fed_account` khi `at < feedFrom`.
- `src/services/ingest.ts`: `ingestLog` (tìm tài khoản kèm mốc; `beforeOpening` gồm mốc), ứng viên ghép cặp, rule log ra trước `sepay_out_from`; `src/cron/backfill.ts` / Đồng bộ lại đếm riêng.
- PWA: sheet tài khoản hàng mốc + gợi ý; câu đồng bộ.
- Dữ liệu nhà mình: sau deploy, `PATCH` MB tiết kiệm (vợ) `feed_from` = đúng `at` của log đầu tiên (2026-10-15T15:25:00.000Z). Phải xong **trước thứ Hai 19/10 02:00** (rà soát tuần lấy từ 12/10).
- CHANGELOG: hướng dẫn nhà tự cài đặt mốc cho tài khoản đã nối sau.

## Review kỹ thuật
Reviewer agent (2026-10-17) — bản đầu chưa duyệt; đã sửa: không tự đặt mốc cho tài khoản chưa có dữ liệu (không mất lịch sử), cho sửa mốc; khoản trước mốc nhập tay được; bỏ `feed_opening`, tính động; 409 khi còn log chờ; định dạng `toISOString()` + AC biên; mốc tiền ra `sepay_out_from`; hạn trước rà soát tuần 19/10; đặt mốc trong `updateAccount`; snake_case; câu đồng bộ; đủ chỗ trong ingest / schema.

## Việc cần làm
- [x] Review kỹ thuật; commit propose
- [x] Test đỏ → code; rà bảo mật (1 High, 2 Medium đã sửa: mốc không vượt log đã nhận, nhật ký cũ → mới + báo thành viên, webhook không bị bỏ vì mốc)
- [x] Sao lưu D1 (`before-0036`), diễn tập trên bản sao (view không đổi khi mốc NULL; đặt mốc MB tiết kiệm → theo ngân hàng = sổ 11.502.464, lệch 0), deploy prod 2026-10-17 16:23 giờ VN (version `ef10e7c8`, migration 0036); sửa mốc nhà mình (`PATCH feed_from = 2026-10-15T15:25:00.000Z`); kiểm live: ba tài khoản SePay theo ngân hàng = sổ, lệch 0; Đồng bộ lại 11–15/10 kết nối SePay của MB tiết kiệm → added 0, màn Gán trống
- [x] Hợp nhất specs (+ ADR-113)
- [ ] CHANGELOG; phát hành v1.4.0; GitBook (nối SePay cho tài khoản đang dùng)
