# 261006-bo-luy-ke-sepay: Bỏ hẳn số lũy kế (`accumulated`) SePay gửi kèm
- Status: archived
- BR: BR-04, BR-06
- Đụng tới: UC-106, UC-103 (ledger); UC-301, UC-302, UC-304, UC-308 (ingest); UC-402 (notify); UC-602 (mcp — mô tả tool `reconcile`); UC-702, UC-707 (pwa)
- Đóng: [OPEN] số lũy kế dương nhưng lệch gốc (ledger UC-106); [OPEN] `v_account_bank` chọn log mới nhất thiếu `accumulated`, [OPEN] `accumulated` không đáng tin, [DIVERGENCE] `reconcile_drift` ghi mà không ai đọc, [DIVERGENCE] `checkReconcileDrift` chỉ xét lớp 1 (ingest UC-308); [OPEN] TK chỉ báo tiền vào làm `feed_drift` lệch dần (ADR-66)
- Người duyệt nghiệp vụ: chủ nhà (đã quyết, xem "Vì sao") · Người duyệt kỹ thuật: —

## Vì sao
Chủ nhà, 2026-10-06: "tôi nghĩ là bạn bỏ phần lấy lũy kế của sepay đi, nó không đúng đâu à, bỏ hẳn cái data mà sepay trả về đó, đừng quan tâm lũy kế của nó nữa nè".

Tài khoản `mb-spending-wife`: SePay gửi `accumulated` = 1.400.000 trong khi số dư thật (chủ nhà xem app MB) là 2.000.000 và sổ khớp đúng số thật (số minh hoạ, không phải số thật của nhà). App vẫn báo "Lệch đối soát" 600.000 ₫ giả ở Hôm nay, card Tiền chi được, Ví & quỹ › Tài khoản và tin sáng. ADR-83 (3/10) đã bỏ số **âm**; số dương lệch gốc là đúng ca [OPEN] ADR-83 để lại — máy không phân biệt được với webhook sót thật.

## Thay đổi spec

### Luật mới (ADR-87)
- App **không đọc, không lưu** `accumulated` của SePay (webhook lẫn API lịch sử). Bản thô `bank_logs.raw` giữ nguyên (bản lưu đối chiếu), không ai đọc trường này từ đó.
- Đối soát còn: (1) **sổ ↔ giao dịch ngân hàng đã gán** (`book_drift`), (2) **giao dịch chưa gán** (`pending_net` / `pending_count`, không phải lệch), (3) **số dư người nhà tự nhập** (Nhập số dư / Đếm — UC-105, `cash_counts`) — nguồn "số dư thật" duy nhất, cho mọi tài khoản kể cả tài khoản SePay.
- Lệch đối soát (mọi màn, snapshot, tin sáng) chỉ còn `bookDrift ≠ 0`.

### UC-106 (ledger — đối soát)
- Đổi tên "Đối soát tài khoản" (bỏ "hai lớp").
- Main Flow: bỏ `bankBalance`, `feedDrift`; giữ `feedBalance` (mở sổ + Σ số tiền log — tính từ số tiền, không từ lũy kế), `bookDrift`, `pendingNet`, `pendingCount`, `lastAt` (= `MAX(at)` log của tài khoản), `lastCountAt`.
- MODIFIED AC-1: Given log `in` 500.000 `pending` → `book_drift = 0`, `pending_net = 500.000`, `pending_count = 1` (bỏ `feed_drift`).
- MODIFIED AC-2: bỏ "`accumulated` = 0" và `feed_drift = null`.
- DEPRECATED AC-3 (v6: ADR-87 — không còn so với số SePay báo).
- MODIFIED AC-4: `book_drift = null` (bỏ `feed_drift`).
- MODIFIED AC-5: Given log đã gán mà sổ diễn giải thiếu 50.000 ở `vcb-em` When cron 07:00 Then dòng đối soát "lệch 50.000 ₫ ở VCB (vợ)" lấy từ `ledger.reconcile()`.
- DEPRECATED AC-5b (v6: ADR-87 — `v_account_bank` không còn).
- ADDED AC-7: Given webhook SePay cho `vcb-anh` mang `accumulated` 1.400.000 khác hẳn sổ (log tự gán theo rule) When đọc `GET /v1/accounts` và `GET /v1/snapshot` Then dòng `vcb-anh` không có `bankBalance` / `feedDrift`, `bookDrift = 0`; `attention.drift` rỗng; `bank_logs` không có cột `accumulated`, `raw` vẫn giữ nguyên payload.

### UC-308 (ingest)
- Đổi tên "Ghi sự cố ingest" — bỏ phần "Lệch feed (lớp 1)" (bước 1–4, alt 4a): `checkReconcileDrift` và `notifications(kind='reconcile_drift')` bỏ.
- DEPRECATED AC-1, AC-2, AC-3 (v5: ADR-87). ADDED AC-6: webhook mang `accumulated` lệch (999.999.999) → log ghi bình thường, không có dòng `reconcile_drift`, `raw` giữ `accumulated`.

### UC-301 / UC-304 (ingest)
- Bước chuẩn hoá payload / dòng API: không đọc `accumulated` nữa (`ParsedBankLog` bỏ trường).

### UC-302 (ingest)
- AC-ADR-76 (log trước ngày mở sổ): Given bỏ "`accumulated` lệch" và Then bỏ "không có `reconcile_drift`".

### UC-103 (ledger — snapshot)
- Bước 7: `attention.drift` = tài khoản có `bookDrift ≠ 0` (phần tử `{accountId, name, bookDrift}`).
- MODIFIED AC-6: Given một tài khoản `bookDrift = 0`, một `bookDrift = null`, một `bookDrift = 50.000` Then `attention.drift` chỉ chứa tài khoản thứ ba. Test mới.

### UC-402 (notify — tin sáng)
- 🏦 Đối soát: tài khoản lệch khi `bookDrift ≠ 0`, số = |`bookDrift`|.
- MODIFIED AC-8: Given log `out` 300.000 của `vcb-em` đã gán mà giao dịch sinh từ log chỉ 250.000 Then tin có "🏦 Đối soát: ❌ lệch 50.000 ₫ ở VCB (vợ)".

### UC-602 (mcp)
- Tool `reconcile` mô tả "lệch giữa sổ và giao dịch ngân hàng đã gán (bookDrift)"; dòng trả không còn `bankBalance`, `feedDrift`.

### UC-702 (pwa — Hôm nay)
- Banner lệch: "**Lệch đối soát ở {tài khoản}.** Sổ khác giao dịch ngân hàng đã gán: ±X ₫." (một luật `driftOf`, `web/src/lib/drift.ts`); màn rộng cùng chữ.
- Card Tiền chi được: dòng phụ tài khoản lệch "sổ lệch — xem Đối soát" (thay "số ngân hàng khác sổ — xem Đối soát").
- MODIFIED AC-9: lệch chỉ từ `bookDrift`; snapshot cũ còn lưu trên máy có `feedDrift` không làm hiện banner.
- MODIFIED AC-12 (card): dòng phụ đổi chữ.

### UC-707 (pwa — Ví & quỹ › Tài khoản)
- Điện thoại: bỏ dòng "Ngân hàng báo X · khớp"; lệch một dòng "Sổ khác giao dịch ngân hàng đã gán ±X"; **mọi tài khoản** (kể cả SePay) có dòng "lần nhập gần nhất d/m" / "chưa nhập số dư lần nào" + nút **Nhập số dư** — số dư thật chỉ đến từ người nhập (server vẫn từ chối khi tài khoản SePay còn giao dịch chưa gán, UC-105 E3).
- Màn rộng: bỏ cột **Ngân hàng**; cột Lệch: số có dấu + chữ, "khớp" khi `bookDrift = 0`, "—" khi `bookDrift` null; nút **Nhập số dư thật** cho mọi tài khoản.
- Lời dặn card: bỏ "Lệch = sổ khác ngân hàng".
- MODIFIED AC-16: lệch chỉ từ `bookDrift`.

### Entity
- `bank_logs.accumulated`: **bỏ** (migration 0023 `DROP COLUMN`). Schema v1.23.
- View `v_account_bank`: **bỏ**. `v_reconcile`: bỏ cột `bank_balance`, `feed_drift`; `last_at` = `MAX(bank_logs.at)` của tài khoản (như trước).
- `notifications.kind = 'reconcile_drift'`: không còn ghi (dòng cũ giữ nguyên).

## Quyết định
**ADR-87: Bỏ hẳn số lũy kế SePay; đối soát = sổ ↔ giao dịch đã gán + số dư người nhà tự nhập.**
- Bối cảnh: như "Vì sao". `accumulated` sai ở cả hai dấu (âm ngày 3/10, ADR-83; ngày 6/10 dương mà vẫn lệch số thật — số minh hoạ ở "Vì sao"); MB không có quan sát thật nào khớp (ADR-57 còn treo).
- Lựa chọn: không đọc, không lưu, không so; migration bỏ cột và view; đối soát còn `book_drift`, "chưa gán", Nhập số dư.
- Phương án bị loại:
  - **Giữ cột, chỉ ngừng so** (view trả NULL): dữ liệu sai vẫn nằm trong bảng, lời mời dùng lại; chủ nhà nói "bỏ hẳn".
  - **Mở rộng ADR-83: bỏ thêm số lệch "quá xa"** (ngưỡng): không có ngưỡng đúng — webhook sót thật cũng là chênh lớn; vẫn báo giả khi sai ít.
  - **Công tắc "so số dư SePay" mỗi tài khoản**: thêm cấu hình người nhà không hiểu cho một số đã chứng minh sai ở tài khoản chính.
  - **Xoá luôn `raw`**: mất bản lưu đối chiếu; `raw` không được đọc để tính gì.
- Hệ quả: app không còn tự phát hiện webhook sót bằng số dư — việc đó do rà soát 02:00 (ADR-23, ADR-78) và người nhà Nhập số dư khi xem app ngân hàng. Tài khoản SePay được Nhập số dư như tài khoản ghi tay (server đã cho phép khi không còn log chưa gán).
- ADR thay / chỉnh: ADR-83 **superseded by ADR-87**; ADR-25 phần S4/S5 lớp 1 `feed_drift` thay bởi ADR-87; ADR-66 đóng [OPEN] TK một chiều làm `feed_drift` lệch dần; ADR-85 phương án bị loại "Dùng số ngân hàng" — chữ nhắc trên card đổi.
- Đã soát, **không** dựa vào `accumulated`: ADR-75 (nhiều kết nối — log khớp theo số tài khoản của kết nối), ADR-76 (log trước `opened_at` — theo ngày giao dịch), ADR-81 (chân thứ hai — cùng số tiền, cặp tài khoản, ≤ 10 phút), ADR-40/ADR-49 + `findPossibleTwin` (chống trùng — `id`, `(account_id, reference_number)`, số tiền + chiều + ≤ 3 phút), gợi ý số dư đầu (không có — `opening_balance` người nhà tự nhập ở Cài đặt). Không cần đổi.

## Thiết kế
- `migrations/0023_drop_bank_accumulated.sql`: `DROP VIEW v_reconcile; DROP VIEW v_account_bank; ALTER TABLE bank_logs DROP COLUMN accumulated;` dựng lại `v_reconcile` (không `bank_balance`/`feed_drift`, `last_at` bằng subquery `MAX(at)`), `schema_version` 1.23. SQLite chặn `DROP COLUMN` khi view còn nhắc cột → bỏ view trước. Sao lưu D1 production trước khi chạy.
- `docs/schema.sql` v1.23 · `test/schema.test.ts` (migration 0023 trên dữ liệu có cột cũ; đối soát).
- `src/services/ingest.ts` › `ParsedBankLog`, `parseWebhookPayload`, `parseHistoryRow`, `ingestLog` (INSERT bỏ cột; bỏ `checkReconcileDrift`).
- `src/services/ledger.ts` › `reconcile`, `getSnapshot` (truy vấn drift) · `src/domain/snapshot.ts` › `SnapshotData.drift`, `attention.drift` · `src/cron/daily.ts` · `src/notify/format.ts` (chú thích) · `src/mcp/tools.ts` (mô tả `reconcile`).
- `web/src/lib/drift.ts` › `driftOf`, `DRIFT_LABEL` (thay `driftLayers`) · `web/src/lib/types.ts` › `AccountRow` · `web/src/lib/spendable-cash.ts` · `web/src/screens/{today,today-desktop,wallets}.tsx`.
- Docs: `docs/core_design_rules.md` §7, §10; `README.md` (Đối soát).
- Rủi ro: snapshot cũ trong cache máy còn `feedDrift` → `driftOf` chỉ đọc `bookDrift`. Prod: `reconcile_drift` cũ nằm lại trong `notifications`, vô hại.

## Việc cần làm
- [x] Test cho từng AC mới/sửa
- [x] Code
- [x] Cập nhật UC chính + `## History`
- [ ] Sinh lại `traceability.md`, `open-issues.md` (người tích hợp)
