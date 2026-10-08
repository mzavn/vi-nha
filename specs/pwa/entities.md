# Entity Model — context `pwa`

Chỉ gồm các thực thể **sống trên máy người dùng** mà PWA sở hữu. Giao dịch, ví, tài khoản, danh mục, log ngân hàng, lệnh chuyển tiền, thành viên, phiên… thuộc context khác; ở đây chỉ nhắc tên.

---

## 1. `QueuedEntry` — Khoản chờ đồng bộ

**Nghĩa:** một khoản nhập tay đã được giữ trên máy nhưng server chưa xác nhận ghi. Là nơi **duy nhất** giữ khoản nhập khi mất mạng (D12). Tạo ra bởi màn Nhập (`meaning = spend`), sheet "Loại khác" (`refund`, `buy_asset`, `lend`, `transfer`), sheet Chuyển ngân sách / Bù (`transfer` chỉ có `from_wallet_id` + `wallet_id`, không `account_id`) và sheet Trả nợ (`spend` danh mục `debt-payment` từ quỹ giữ riêng) — UC-712. Thu nhập (`income`) **không** đi qua hàng đợi (UC-705); dòng sổ người thuê (Người thuê chi, phí một lần, chỉnh, chốt tháng — UC-705, UC-713) cũng không: gửi thẳng `/v1/rental/*`, cần mạng.

| Trường | Nghĩa nghiệp vụ / luật | Nơi thực thi |
|---|---|---|
| `clientId` | = `body.client_id`; khoá của hàng đợi. Sinh ở máy (`crypto.randomUUID()`, trình duyệt cũ thì 16 byte ngẫu nhiên dạng hex). Server chống trùng theo nó nên gửi lại bao nhiêu lần cũng chỉ ghi một lần | `newClientId` (`web/src/ui/fields.tsx`); chống trùng phía server: ledger (`idx_tx_client`) |
| `memberId` | Người đã nhập khoản. Chỉ được gửi khi **đúng người này** đang đăng nhập, vì server ghi "ai chi" (`by_member_id`) theo phiên | `flushOnce` lọc `i.memberId === me` và kiểm lại trước **mỗi** lần gửi (`web/src/offline/queue.ts`, commit `9d32978`) |
| `body` (`EntryBody`) | Thân `POST /v1/transactions`. `body.at` là giờ **lúc nhập** (hoặc 12:00 giờ VN của ngày chọn lùi — `atForDay`), không phải giờ đồng bộ, để khoản offline rơi đúng tuần/tháng | `atForDay` (`web/src/lib/period.ts`); chú thích `EntryBody` (`web/src/lib/types.ts`) |
| `createdAt` | ISO lúc vào hàng đợi; quyết định **thứ tự gửi** (hoà thì theo `clientId`) | `byCreated` (`queue.ts`) |
| `status` | `pending` \| `rejected` (xem vòng đời) | `createSyncer` |
| `attempts` | Số lần đã gửi mà không thành công (tăng ở `rejected` và `retry`; **không** tăng khi 401) | `flushOnce` |
| `error` | `{ code, message }` của lần gửi hỏng gần nhất. `code = "offline"` (không tới server), `"server"` (5xx/408/425/429/2xx lạ), hoặc mã lỗi server (4xx; không có mã thì `http_<status>`) | `classify`, `flushOnce` |

### Vòng đời (state list)

| # | Trạng thái | Vào khi | Ra khi |
|---|---|---|---|
| S0 | *(chưa tồn tại)* | — | Người bấm Lưu → `syncer.enqueue` → `queueStore.put`. IndexedDB lỗi thì ghi `localStorage`; **cả hai lỗi** → ném `StorageUnavailableError`, khoản **không** được tạo, toast báo lỗi, form giữ nguyên số (commit `80875be`) |
| S1 | `pending`, `attempts = 0` | `enqueue` thành công | Một lượt đồng bộ chạm tới nó (chỉ khi `navigator.onLine` và người đang đăng nhập = `memberId`) |
| S2 | **Đã lên sổ** *(xoá khỏi hàng đợi — kết thúc)* | Phản hồi 2xx có `ok: true` (kể cả `duplicate: true`) | — |
| S3 | `pending`, `attempts + 1`, `error.code = "offline"` | Không tới được server (`transport` trả `null`) | Lượt đồng bộ sau; **cả lượt dừng** ngay (`stopped = "offline"`) |
| S4 | `pending`, `attempts + 1`, `error.code = "server"` | 5xx, 408, 425, 429, hoặc 2xx không có `ok: true` | Lượt đồng bộ sau; **không chặn** khoản phía sau trong cùng lượt |
| S5 | `pending`, không đổi | 401 → lượt dừng (`stopped = "auth"`), app về màn đăng nhập | Người đó đăng nhập lại |
| S6 | `pending`/`rejected` của **người khác** | Người đang đăng nhập ≠ `memberId` (hoặc đổi người giữa lượt → `stopped = "no_member"`) | Người đó đăng nhập lại trên máy này. Không bị gửi dưới tên người khác; đăng xuất không xoá |
| S7 | `rejected`, `attempts + 1`, `error = {code, message}` | 4xx khác 401/408/425/429 | Người bấm **Gửi lại** → về `pending` (bỏ `error`, giữ `attempts`) và đồng bộ ngay; hoặc **Bỏ hẳn** → S8. Lượt đồng bộ tự động **không** gửi lại khoản `rejected` |
| S8 | **Đã bỏ** *(xoá — kết thúc)* | Người bấm "Bỏ khoản này" rồi "Bỏ hẳn khoản này" (`syncer.discard`) | — |

Nút "Gửi lại" / "Bỏ khoản này" hiện cho khoản của chính người đang dùng khi `status = rejected` **hoặc** `attempts ≥ 3` kèm `error` (commit `9d32978`: khoản hỏng mãi không bị kẹt vô hạn) — `QueueList` (`web/src/screens/entry.tsx`).

### Bất biến
- **I1. Ghi trước, gửi sau:** mọi khoản đi qua hàng đợi được `put` vào kho trước khi gửi — `saveEntry` (`web/src/state/store.ts`).
- **I2. Không mất lặng lẽ:** khoản chỉ rời hàng đợi khi server trả `ok` (S2) hoặc người dùng chủ động bỏ (S8). Không ghi được vào kho thì báo lỗi, không nuốt — `queueStore`/`lsQueue` (`web/src/offline/idb.ts`), commit `80875be`.
- **I3. Đúng người:** không gửi khoản của người A trong phiên người B — `flushOnce`, commit `9d32978`.
- **I4. Đúng thứ tự:** gửi theo `createdAt`, rồi `clientId` — `byCreated`.
- **I5. Một lượt tại một thời điểm:** gọi đồng bộ chồng nhau (online + visibility + bấm tay) nhập vào lượt đang chạy; khoản thêm giữa lượt được gửi trong chính lượt đó — `flush` (`running`, `again`).
- **I6. Xoá cache không đụng hàng đợi:** `cacheClear()` chỉ xoá store `cache` và khoá `vi-nha:cache:*` — `web/src/offline/idb.ts` (xác nhận trong `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md`).
- **I7. Trừ tạm:** mọi khoản trong hàng đợi (kể cả `rejected` và của người khác) được trừ tạm vào snapshot/bảng ngân sách đang hiển thị, theo công thức của `buildSnapshot` — `applyQueue`, `applyQueueToBudget` (`web/src/lib/pending.ts`). Xem [OPEN] ở UC-704.

**Quan hệ:** trở thành một `Transaction` (ledger) khi S2; server trả kèm `WalletStatus` để toast nói ví còn bao nhiêu.

---

## 2. Lượt đồng bộ (`Syncer.flush` → `FlushReport`)

**Nghĩa:** một lần đi qua các khoản `pending` của người đang đăng nhập.
- `results[clientId]`: `ok` · `rejected` · `auth` · `retry{network}` (`SendResult`).
- `stopped`: `null` (đi hết) · `"offline"` · `"auth"` · `"no_member"`.
- Kích hoạt bởi: vào app (`enter`), sự kiện `online`, app quay lại màn hình (`visibilitychange`), nút "Đồng bộ" (`syncNow`), sau mỗi lần Lưu (`saveEntry`), nút "Gửi lại" (`retryEntry`). Chi tiết ở UC-704.

---

## 3. `Cached<T>` — Bản lưu số liệu theo người

**Nghĩa:** bản đọc gần nhất của `bootstrap`, `snapshot`, `settings` để mở app/xem Cài đặt khi mất mạng.
- Kho: IndexedDB DB `vi-nha` (phiên bản 2 = `DATA_VERSION`), store `cache` (`keyPath: "key"`); lùi về `localStorage` `vi-nha:cache:<key>`, kèm dấu phiên bản `vi-nha:cache-version`.
- `key` = `` `${memberId}:${what}` ``, `what ∈ {bootstrap, snapshot, settings}` — `cacheKey` (`store.ts`). **Luôn gắn người** để hai vợ chồng dùng chung máy không thấy số của nhau (commit `80875be`).
- `at`: ISO lúc lưu. Chỉ lưu bản lấy **từ mạng**; bản do service worker trả từ cache (có header `x-sw-cached-at`) thì không ghi đè — `loadCached`.
- Bị xoá toàn bộ khi: đăng xuất (`logout`) hoặc người vào khác người lần trước / không rõ người lần trước (`forgetOtherMember`, commit `4b6d298`); phiên bản dữ liệu đổi (dạng dữ liệu API đổi, vd tên tiếng Anh `tiers.wealth_building`, `safetyFund` — ADR-92): `onupgradeneeded` xoá rồi tạo lại store `cache` (store `queue` giữ nguyên), bản localStorage bỏ một lần khi dấu phiên bản khác (`lsCacheUpgrade`) — UC-710 AC-11.

## 4. Dấu người dùng lần trước
- `localStorage` `vi-nha:last-member` = `member.id` của lần vào gần nhất (`lastMemberId`). Dùng để: chọn sẵn người ở màn đăng nhập; vào app offline bằng người đó (UC-710); quyết định có xoá cache khi đổi người (UC-701).

## 5. Bộ đệm service worker (`web/sw.js`)
| Cache | Nội dung | Luật |
|---|---|---|
| `vi-nha-shell-<VERSION>` | App shell: `/`, `/manifest.webmanifest`, `/icons/icon-192.png`, `/icons/apple-touch-icon.png` + mọi file bundle (trừ `.map`) | Precache lúc `install`; `VERSION` = 12 ký tự đầu SHA-256 của danh sách file (`vite.config.ts` › `serviceWorker`). `activate` xoá mọi `vi-nha-shell-*` khác phiên bản |
| `vi-nha-api` | Phản hồi `GET /v1/*` status 200, gắn header `x-sw-cached-at` | Network-first; 401 xoá bản lưu của đúng request đó; xoá toàn cache khi đăng xuất / đổi người, và khi bản mới kích hoạt (`activate`, UC-710 AC-11) |
| `vi-nha-fonts` | Google Fonts | Cache-first sau lần tải đầu |

## 6. Trạng thái phiên phía máy (`AppState.phase`)
`boot` → (`GET /v1/session` có member, hoặc offline mà có bootstrap của người lần trước) → `app`; → (không có member / không có cache) → `login`.
`app` → `login` khi: bất kỳ 401 nào từ `/v1/*` ngoài `/v1/session*` (`setUnauthorizedHandler(toLogin)`), lượt đồng bộ gặp 401, `saveEntry` không có member, hoặc đăng xuất. `toLogin()` **không** xoá cache (xem [OPEN] UC-701).

## 7. Tuỳ chọn giao diện
- `localStorage` `vi-nha:theme` ∈ `light` \| `dark`; không có = theo máy. Áp trước khi vẽ (`main.tsx`) qua `data-theme` trên `<html>` — `useTheme` (`web/src/ui/shell.tsx`).

## 8. Máy đã bật thông báo (`vi-nha:push`) — UC-714
- Subscription thuộc **trình duyệt** (`PushManager`, dùng chung mọi người trên máy); server gắn nó với người đăng nhập lúc gửi lên (notify `PushSubscription`, UC-410).
- `localStorage` `vi-nha:push` = `{ memberId, id }` — máy này đã bật cho ai, `id` dòng `push_subscriptions` server trả. Ghi khi bật / đồng bộ (`upload`), xoá khi tắt / đăng xuất / không còn subscription (`writeBound(null)`); giá trị hỏng hoặc `localStorage` bị chặn → coi như không có.
- Dùng để: gắn chip "máy này" trong danh sách máy (`boundSubscriptionId`); phát hiện đổi người lúc vào app (`syncPush`: `memberId` khác người đang vào → gỡ máy).
- Trạng thái thẻ (`PushState`, `web/src/lib/push.ts` › `pushState`): `needs-install` → `unsupported` → `blocked` → `on` | `off`, xét theo thứ tự đó từ `PushCaps { supported, ios, standalone, permission, subscribed }`.
