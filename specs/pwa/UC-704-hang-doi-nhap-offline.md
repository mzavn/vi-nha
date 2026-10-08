# UC-704: Hàng đợi nhập offline và đồng bộ
- Status: implemented
- BR: BR-03, BR-04, BR-01
- Decisions: D12, D6; commit `80875be` (không mất lặng lẽ), `9d32978` (dừng khi đổi người), `11b12b3` (đồng bộ xong mới tải số); `plans/reports/redteam-260922-0100-offline-ingest-robustness.md`; ADR-92 (tên trong mã nguồn, dữ liệu, địa chỉ màn bằng tiếng Anh); ADR-94 (mã hệ thống tiếng Anh)
- Actor: thành viên đã đăng nhập; hệ thống (sự kiện trình duyệt)
- Trigger: sau mỗi lần Lưu (UC-703, UC-705); vào app (`enter`); sự kiện `online`; app quay lại màn hình (`visibilitychange`); nút **Đồng bộ** (dòng trạng thái Hôm nay/Nhập, card "Chưa lên sổ", thanh bên); nút **Gửi lại**

## History
- v1 (2026-09-22, commit `a756f68`): hàng đợi IndexedDB (lùi `localStorage`), `client_id`, phân loại phản hồi, một lượt tại một thời điểm, chỉ gửi khoản của người đang đăng nhập, trừ tạm vào số hiển thị.
- v2 (2026-09-22, commit `80875be`): kho không ghi được thì ném `StorageUnavailableError`, không nuốt lỗi.
- v3 (2026-09-22, commit `9d32978`): kiểm lại người đăng nhập trước **mỗi** lần gửi, đổi người thì dừng; khoản hỏng ≥ 3 lần được phép bỏ.
- v4 (2026-09-22, commit `11b12b3`): khi app quay lại màn hình, đồng bộ xong rồi mới tải số (tránh trừ hai lần trong chốc lát — red-team offline §4).
- v5 (2026-10-01, commit `a301077`): nút **Đồng bộ** tải số với header `x-no-cache` — hỏi thẳng server, không nhận bản lưu còn tươi của service worker; các lần tải tự động (sau khi gửi, `online`, `visibilitychange`) để service worker trả bản lưu ≤ 30 giây, nhưng mỗi khoản gửi lên đã xoá cache API nên số sau khi gửi luôn mới (ADR-69, pwa UC-710).
- v6 (2026-10-01, commit `2438ac0`): khoản `collect` (nhận lại tiền cho vay, ADR-72) đi qua hàng đợi như `lend`, kèm `receivable_id`; không trừ tạm số ví nào (receivable [UC-1003](../receivable/UC-1003-nhan-lai-tien.md)).
- v7 (2026-10-01, commit `49f8bce`): phân rõ hai nơi sửa: khoản **chưa lên sổ** (trong hàng đợi) chỉ có Gửi lại / Bỏ hẳn như cũ; khoản **đã lên sổ** sửa / xoá ở sheet chi tiết giao dịch (pwa [UC-715](UC-715-xem-sua-xoa-giao-dich.md)) — ghi thẳng lên server, cần mạng, không đi qua hàng đợi.
- v8 (2026-10-03, commit `a18730c`): theo audit 261003: **Gửi lại** nói kết quả bằng toast ("Đã đồng bộ khoản này." · "Vẫn bị từ chối: {lý do}" · "Chưa tới được máy chủ. Khoản này vẫn chờ đồng bộ.") — trước đó bị từ chối lần nữa thì thẻ trông y như cũ, người bấm không biết đã gửi chưa; 401 thì về màn đăng nhập như lượt thường.
- v9 (2026-10-03, commit `3bc597c`): theo audit 261003 (M27, chủ nhà duyệt): khoản mà dòng "vừa ghi" ở màn Nhập đang báo "Đã ghi X, chờ đồng bộ…" bị server từ chối ở lượt gửi sau → dòng đó bị xoá (`lastEntryQueued` trong `syncer.onChange`) — trước đó nó nằm ngay dưới chip "1 bị từ chối" tới lần nhập sau.
- v10 (2026-10-03, commit `3bc597c`): khoản mà dòng "vừa ghi" đang báo chờ đồng bộ lên sổ ở lượt gửi sau → dòng thành câu đã ghi (cùng câu như khi lưu có mạng, số còn lại tính lúc lưu); bỏ hẳn khoản đó → dòng bị xoá (`queuedLineAfter`).
- v11 (2026-10-07, commit `7424f26`): badge tab Nhập theo tên tab `entry` (thay `nhap`) — ADR-92 (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v12 (2026-10-08, commit `21b9db0`): không đổi hành vi — id card hàng đợi ở màn Nhập đổi `hang-doi` → `queue` (định danh code tiếng Anh, ADR-92/ADR-94). (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))

## Preconditions
- Khoản đã vào hàng đợi (trạng thái S1 trong `entities.md` › `QueuedEntry`).
- Backend: ledger UC-101 Nhập tay một khoản tiền — chống trùng theo `client_id` (gửi lại trả `duplicate: true` cùng `tx`).

## Main Flow
1. Một trigger gọi `syncer.flush()`. Đang có lượt chạy → lời gọi nhập vào lượt đó (đánh dấu chạy thêm vòng nữa); không có → mở lượt mới, `syncing = true`.
2. Lượt dừng ngay nếu không có người đăng nhập (`no_member`) hoặc `navigator.onLine = false` (`offline`).
3. Lấy các khoản `pending` **của người đang đăng nhập**, xếp theo `createdAt` rồi `clientId`.
4. Với từng khoản: kiểm lại người đăng nhập (đổi → dừng `no_member`); `POST /v1/transactions` (JSON, timeout 15 giây); phân loại phản hồi (`classify`):
   - 2xx + `ok: true` → xoá khỏi hàng đợi;
   - 4xx có mã (trừ 401/408/425/429) → `rejected` + lý do, đi tiếp khoản sau;
   - 5xx / 408 / 425 / 429 / 2xx lạ → giữ `pending`, `attempts + 1`, đi tiếp;
   - không tới server → giữ `pending`, `attempts + 1`, **dừng cả lượt**;
   - 401 → giữ nguyên, dừng, app về màn đăng nhập.
5. Hết vòng: nếu có lời gọi nhập vào giữa chừng và lượt chưa bị dừng → chạy thêm một vòng (khoản thêm giữa lượt được gửi luôn).
6. Báo hàng đợi mới cho giao diện (`onChange`); nếu có khoản `ok` → `refresh()` tải lại bootstrap + snapshot; `syncing = false`.
7. Trong lúc khoản còn trong hàng đợi, số hiển thị đã **trừ tạm** nó: snapshot (`applyQueue`) và bảng ngân sách (`applyQueueToBudget`), chỉ cho các ví bị ảnh hưởng, theo đúng công thức `buildSnapshot`:
   - `spend`: số dư −, đã chi tuần/tháng + (chỉ khi `at` rơi đúng tuần/tháng đang hiện);
   - `refund`: ngược lại;
   - `transfer` có cả `wallet_id` và `from_wallet_id`: ví nhận +, ví bớt −, không tính vào đã chi;
   - `buy_asset`, `lend`, `collect`: không đổi số ví;
   - ví ẩn số (`balance = null`) không bị đụng.

## Alternative Flows
- 1a. Nút **Đồng bộ** (`syncNow`): offline → toast "Chưa có mạng. N khoản vẫn chờ đồng bộ." (hoặc "Chưa có mạng."); có mạng → đồng bộ, tải số **bỏ qua bản lưu của service worker** (`refresh(true)` → header `x-no-cache`, UC-710), rồi toast đúng một trong: "Đã tải số mới." · "Chưa tới được máy chủ. Đang hiện số cũ." (khi không có khoản chờ) · "Đã đồng bộ N khoản." · "Chưa tới được máy chủ. N khoản vẫn chờ đồng bộ." · "Đã đồng bộ A khoản. B khoản vẫn chờ."
- 1b. `visibilitychange` → đồng bộ **xong** mới tải số, và chỉ tải nếu lần tải trước đã quá 30 giây.
- 1c. Sự kiện `online` → `online = true`, đồng bộ rồi tải số.
- 4a. Khoản `rejected` không được lượt tự động gửi lại. Người bấm **Gửi lại** (`retryEntry`) → về `pending` (bỏ lý do, giữ `attempts`) → đồng bộ ngay → toast theo kết quả của chính khoản đó: "Đã đồng bộ khoản này." · "Vẫn bị từ chối: {lý do}" · "Chưa tới được máy chủ. Khoản này vẫn chờ đồng bộ." (401 → màn đăng nhập) → tải số.
- 4b. **Bỏ khoản này** → nút đổi thành **Bỏ hẳn khoản này** → bấm lần hai mới xoá.
- 4d. Khoản đã lên sổ không nằm ở đây: sửa / xoá nó ở sheet chi tiết giao dịch (UC-715), cần mạng; sửa / xoá không bao giờ vào hàng đợi.
- 4c. Khoản của người khác: không gửi; hiện "của {tên} — gửi khi người này đăng nhập"; không có nút Gửi lại/Bỏ.

## Exceptions
- E1. Kho không ghi được → xem UC-703 E1 (khoản không bao giờ vào trạng thái "đã lưu" giả).
- E2. Server đã ghi nhưng phản hồi mất → khoản ở lại `pending`; lần gửi sau server trả `duplicate: true` và khoản được xoá — chỉ một giao dịch trong sổ.

## Giao diện hàng đợi
- Badge tab **Nhập** (và thanh bên): số khoản của người đang dùng trong hàng đợi, nhãn "N chưa lên sổ".
- Dòng trạng thái đầu màn Nhập (điện thoại), chỉ khi có việc: "không có mạng", "N chờ đồng bộ", "N bị từ chối" + "Xem lý do" (cuộn tới card), nút Đồng bộ ("Đang đồng bộ…" khi chạy).
- Card **Chưa lên sổ (N)** (id `queue`, chỉ khi hàng đợi không rỗng; màn rộng nằm ở cột phải): mỗi dòng "d/m HH:mm · {danh mục hoặc meaning} · {ví hoặc tài khoản}", số tiền, chip "chờ đồng bộ" (+ "Lần gửi trước: {lý do}" khi đã hỏng) hoặc "bị từ chối" + lý do; ghi chú "Các khoản này đã được trừ tạm vào số còn lại. Máy chủ chống trùng nên gửi lại không ghi hai lần."
- Nút Gửi lại / Bỏ hiện khi `status = rejected` hoặc `attempts ≥ 3` kèm lý do, chỉ cho khoản của người đang dùng.
- Dòng "vừa ghi" dưới ô số (UC-703 bước 7) đang nói "…, chờ đồng bộ…" của một khoản: khoản đó chuyển sang `rejected` thì dòng bị xoá — lý do đã nằm ở chip "N bị từ chối" và thẻ Chưa lên sổ; khoản đó lên sổ (rời hàng đợi) thì dòng thành câu đã ghi, như khi lưu có mạng; **Bỏ hẳn** khoản đó thì dòng bị xoá (`queuedLineAfter`, `discardEntry`). Sửa / xoá / nhập khoản khác thì dòng không còn gắn với khoản cũ.

## Acceptance Criteria
### AC-1: Offline 3 khoản → online → đúng 3 giao dịch
- Given không tới được server, nhập 3 khoản
- When có mạng trở lại và đồng bộ; rồi gửi lại cả 3 khoản đó một lần nữa (ví dụ từ tab khác)
- Then server có đúng 3 giao dịch, hàng đợi rỗng; lần gửi lại vẫn chỉ 3
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › tắt mạng nhập 3 khoản → bật mạng → server có đúng 3 giao dịch, gửi lại không sinh trùng"; server: `test/api.test.ts` › "nhập tay › gửi lại cùng client_id (hàng đợi offline) chỉ ghi một lần"

### AC-2: Mất phản hồi sau khi server đã ghi
- Given server ghi xong nhưng phản hồi rơi
- When đồng bộ lần hai
- Then kết quả `ok` với `duplicate: true`, hàng đợi rỗng, server vẫn một giao dịch
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › server ghi rồi mà phản hồi mất: khoản nằm lại, lần sau gửi lại vẫn chỉ một giao dịch"

### AC-3: Phân loại phản hồi
- Given các phản hồi: `null`, 201/200 `ok`, 401, 400/409 có mã, 404 không thân, 500, 503, 429, 200 thân HTML
- When `classify`
- Then lần lượt: retry(network) · ok · auth · rejected (giữ mã) · rejected `http_404` · retry · retry · retry · retry
- Tests: `web/src/offline/queue.test.ts` › "phân loại phản hồi › các trường hợp"

### AC-4: Bị từ chối thì nằm lại kèm lý do, không chặn khoản khác, chỉ gửi lại khi người bấm
- Given 2 khoản, khoản đầu bị 400 `unknown_category`
- When đồng bộ, đồng bộ lần nữa, rồi bấm Gửi lại
- Then khoản đầu `rejected` kèm mã, khoản sau đã lên sổ; lần đồng bộ thứ hai không gửi lại nó; Gửi lại mới gửi và xoá
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › bị từ chối (4xx có mã) thì nằm lại kèm lý do, các khoản khác vẫn đi"

### AC-5: 5xx không chặn khoản sau, mất mạng dừng cả lượt
- Given khoản A gặp 500, khoản B bình thường; sau đó mất mạng
- When đồng bộ
- Then A `pending` `attempts = 1`, B lên sổ; lượt sau dừng `offline` ngay sau khoản đầu
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › lỗi 5xx: giữ lại để thử sau nhưng không chặn khoản phía sau; mất mạng thì dừng cả loạt"

### AC-6: Trình duyệt báo offline thì không gửi gì
- Given `navigator.onLine = false`
- When đồng bộ
- Then không có request nào, `stopped = "offline"`
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › trình duyệt báo offline thì không gửi gì"

### AC-7: Chỉ gửi khoản của người đang đăng nhập; đổi người giữa lượt thì dừng
- Given hàng đợi có khoản của "wife" và "husband", "husband" đang đăng nhập; và một lượt khác mà người đổi sau khoản đầu
- When đồng bộ
- Then chỉ khoản của "husband" được gửi; không có người → `no_member`; đổi người giữa lượt → dừng sau khoản đang gửi, các khoản còn lại của người trước vẫn `pending`
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › chỉ gửi khoản của người đang đăng nhập"; "đổi người giữa lúc đang gửi › dừng ngay, không gửi các khoản còn lại của người trước dưới phiên người sau"

### AC-8: Đồng bộ chồng nhau không gửi trùng; khoản thêm giữa lượt được gửi luôn
- Given ba lời gọi đồng bộ cùng lúc; và một khoản thêm trong lúc lượt đang chạy
- When các lượt kết thúc
- Then mỗi khoản được gửi đúng một lần, ba lời gọi nhận cùng một báo cáo; khoản thêm giữa lượt có kết quả `ok` trong báo cáo đó
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › gọi đồng bộ chồng nhau (online + visibility + bấm tay) không gửi một khoản hai lần"; "hàng đợi nhập offline › khoản thêm vào trong lúc đang đồng bộ được gửi luôn trong lượt đó"

### AC-9: Đúng thứ tự nhập
- Given 4 khoản nhập lần lượt
- When đồng bộ
- Then server nhận đúng thứ tự đó
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › gửi theo đúng thứ tự nhập"

### AC-10: Chỉ mất khi người chủ động bỏ
- Given một khoản trong hàng đợi
- When người bấm Bỏ hẳn
- Then khoản bị xoá; ngoài đường này và đường `ok`, không có đường nào xoá khoản
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › bỏ một khoản chỉ khi người dùng chủ động bỏ"; xác nhận hai bước trên giao diện: ⚠ Chưa có test

### AC-11: Không có IndexedDB vẫn giữ được khoản
- Given IndexedDB bị chặn, localStorage dùng được
- When đưa khoản vào hàng đợi
- Then đọc lại được từ localStorage
- Tests: `web/src/offline/idb.test.ts` › "hàng đợi khi không có IndexedDB › lùi về localStorage và đọc lại được"

### AC-12: Trừ tạm khớp công thức server
- Given hàng đợi có chi tiêu, hoàn tiền, khoản của tuần trước
- When tính số hiển thị
- Then khớp `buildSnapshot` sau khi ghi; khoản tuần trước chỉ trừ số dư, không cộng vào đã chi tuần này; bảng ngân sách tuần/tháng cộng khoản chờ vào thực tế, kỳ khác không đổi
- Tests: `web/src/lib/pending.test.ts` › "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › ví nhận phần dư (không có mức tuần) cũng khớp công thức chia theo tuần còn lại"; "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › khoản của tuần trước chỉ trừ số dư, không cộng vào đã chi tuần này"; "trừ tạm khoản chưa đồng bộ vào số đang hiển thị › bảng ngân sách tuần / tháng cộng khoản chờ vào thực tế"

### AC-13: Giao diện được báo mỗi khi hàng đợi đổi
- Given giao diện nghe hàng đợi
- When đưa một khoản vào rồi đồng bộ thành công
- Then giao diện nhận độ dài 1 rồi 0
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › báo thay đổi hàng đợi cho giao diện"

### AC-14: Quay lại app không trừ hai lần
- Given một khoản đã tới server nhưng còn `pending` ở máy
- When app quay lại màn hình
- Then đồng bộ chạy xong trước khi tải snapshot mới
- Tests: ⚠ Chưa có test (chỉ đọc mã: `start` trong `web/src/state/store.ts:311`)

### AC-15: Toast nút Đồng bộ nói đúng kết quả
- Given 3 khoản chờ, server không tới được
- When bấm Đồng bộ
- Then toast "Chưa tới được máy chủ. 3 khoản vẫn chờ đồng bộ." (không phải "Đã đồng bộ 0 khoản")
- Tests: ⚠ Chưa có test
### AC-16: Dòng "vừa ghi" không còn nói "chờ đồng bộ" khi khoản đó bị từ chối hay đã lên sổ
- Given lưu 40.000 ₫ Ăn ngoài khi không tới được server — dòng dưới ô số "Đã ghi 40.000 ₫, chờ đồng bộ. Ăn uống còn 360.000 ₫ tuần này."
- When có mạng lại, bấm Đồng bộ, server từ chối khoản đó (vd ngày trước mốc mở sổ của tài khoản)
- Then dòng dưới ô số trống; đầu màn có chip "1 bị từ chối" + "Xem lý do", thẻ Chưa lên sổ có lý do và Gửi lại / Bỏ. Nếu server ghi được khoản đó thì dòng thành "Đã ghi 40.000 ₫. Ăn uống còn 360.000 ₫ tuần này."
- Tests: `web/src/lib/pending.test.ts` › "dòng 'vừa ghi' của khoản chờ đồng bộ khi hàng đợi đổi › còn chờ thì giữ; bị từ chối thì xoá; lên sổ (rời hàng đợi) thì thành câu đã ghi"; nối vào `syncer.onChange`: ⚠ Chưa có test

## Traceability
- Code: `web/src/offline/queue.ts` › `createSyncer`, `flushOnce`, `flush`, `classify`, `byCreated`, `memoryStore`; `web/src/offline/idb.ts` › `queueStore`, `lsQueue`, `StorageUnavailableError`; `web/src/state/store.ts` › `syncer`, `flushAndRefresh`, `syncNow`, `retryEntry`, `discardEntry`, `saveEntry` (`lastEntryQueued`), `start`; `web/src/lib/pending.ts` › `queuedLineAfter`; `web/src/lib/api.ts` › `httpTransport`; `web/src/lib/pending.ts` › `effectsOf`, `applyQueue`, `applyQueueToBudget`, `spendableAmount`; `web/src/screens/entry.tsx` › `QueueStatus`, `QueueList`; `web/src/app.tsx` › badge `entry`; `web/src/ui/shell.tsx` › `Sidebar`.
- Backend: ledger UC-101 Nhập tay một khoản tiền (`transactions.client_id`, index `idx_tx_client`).

## Divergences & Open Questions
- [OPEN] Khoản `rejected` và khoản **của người khác** vẫn được trừ tạm vào số của người đang xem (`viewSnapshot` dùng toàn bộ `queue`, `web/src/state/store.ts:82`; `BudgetTab` dùng `app.queue`). Báo cáo `ui-ux-designer-260922-0020-pwa-mobile-offline.md` nêu lý do "tiền thật đã ra khỏi túi" cho khoản bị từ chối và để ngỏ câu hỏi; chưa có quyết định cho khoản của người khác.
- [OPEN] Tiêu đề card "Chưa lên sổ (N)" đếm cả khoản của người khác, còn badge tab Nhập chỉ đếm khoản của người đang dùng.
- [OPEN] Không có nhịp thử lại tự động theo thời gian: khoản `pending` chỉ được gửi lại khi có một trong các trigger nêu trên.
