# UC-701: Đăng nhập, đăng xuất, đổi người trên máy dùng chung
- Status: implemented
- BR: BR-09, BR-03
- Decisions: D6, D12; commit `80875be`, `9d32978`, `4b6d298`; `plans/reports/redteam-260922-0100-auth-exposure.md` §3; ADR-67 (Đăng xuất chuyển sang Cài đặt › Máy này — audit 261001 F22); ADR-95 (mật khẩu chung + riêng tuỳ chọn; thiết lập lần đầu)
- Actor: Chồng hoặc Vợ (thành viên của hộ) trên điện thoại / máy tính có thể dùng chung
- Trigger: mở app (`start` → `checkSession`); nút "Vào sổ" (màn đăng nhập); nút "Đăng xuất" (Cài đặt › **Máy này** trên điện thoại, chân thanh bên trên màn rộng); mọi phản hồi 401

## History
- v1 (2026-09-22, commit `a756f68`): màn đăng nhập mật khẩu chung + chọn người, nhớ người lần trước, đăng xuất hỏi lại khi còn khoản chưa lên sổ.
- v2 (2026-09-22, commit `80875be`): cache số liệu gắn theo người; người khác vào máy thì xoá cache app và cache API của service worker.
- v3 (2026-09-22, commit `9d32978`): lượt đồng bộ dừng ngay khi người đăng nhập đổi (xem UC-704).
- v4 (2026-09-22, commit `4b6d298`): không biết người lần trước (localStorage bị chặn) cũng coi là người khác và xoá cache.
- v5 (2026-09-22, commit `0ee6969`): màn rộng đưa Giao diện / Đăng xuất xuống chân thanh bên.
- v6 (2026-10-01, commit `5dc53be`): đăng xuất **gỡ thông báo đẩy của máy này trước** khi xoá phiên; vào app thì đồng bộ thông báo của máy và gỡ nếu máy đang gắn người khác — người sau dùng máy không nhận tin của người trước (UC-714, change `261001-pwa-web-push`).
- v7 (2026-10-01, commit `11c52a0`): trên điện thoại, Giao diện + Đăng xuất chuyển từ chân màn Hôm nay sang card **Máy này** cuối Cài đặt (audit 261001 F22, ADR-67); ghi chú màn đăng nhập viết lại theo cấu hình thật, không còn nhắc "ví Chơi" (F19).
- v8 (2026-10-03, commit `a18730c`): theo audit 261003: lỗi tải danh sách người hiện ngay dưới "Ai đang dùng máy này" (chỗ các nút tên), không tô đỏ ô mật khẩu, và tự tắt khi danh sách tải lại được — trước đó có mạng lại thì nút tên đã hiện mà câu "Không có mạng. Đăng nhập lần đầu cần mạng." vẫn đỏ dưới ô mật khẩu.
- v9 (2026-10-03, commit `3bc597c`): theo audit 261003 (M13, chủ nhà duyệt): nút **Đăng xuất** (Cài đặt › Máy này và chân thanh bên) là nút thường, không đỏ — DESIGN.md §3 chỉ dùng đỏ cho vượt chi / sổ lệch; vẫn hỏi lại "Vẫn đăng xuất" khi còn khoản chưa lên sổ (6a).
- v10 (2026-10-06, commit `d059eaa`): **Đăng xuất mọi máy** (red-team 6/10 INSIDER-03, ADR-89, change [`261006-bao-mat-dang-nhap`](../changes/archive/261006-bao-mat-dang-nhap/proposal.md)) — nút thường dưới "Đăng xuất" (điện thoại: Cài đặt › Máy này, hàng "Mất máy, lộ mật khẩu?"; màn rộng: liên kết ở chân thanh bên), luôn hỏi lại một lần; gọi `POST /v1/session/revoke-all` rồi dọn máy như Đăng xuất. Màn đăng nhập hiện nguyên văn câu 429 "Sai mật khẩu quá nhiều lần, thử lại sau N phút." (access UC-501 E6).
- v11 (2026-10-08, commit `1ed22e1`): **màn Thiết lập** cho nhà mới (UC-510): mở app chưa có phiên thì hỏi `GET /v1/setup`; cần thiết lập → bốn bước Mật khẩu chung → Thành viên → Tài khoản → Ví theo mẫu, xong vào thẳng Hôm nay; lỗi `field` hiện đúng ô; mất mạng → màn đăng nhập. Màn đăng nhập ghi "Mật khẩu" (chung hoặc riêng — ADR-95), không nói ai dùng loại nào; 409 `setup_required` chuyển sang Thiết lập; 401 `wrong_password` không đẩy về màn đăng nhập. Thêm 2b, E5, E6, AC-8, AC-9 (change [261007-thiet-lap-lan-dau](../changes/archive/261007-thiet-lap-lan-dau/proposal.md))

## Preconditions
- Backend đăng nhập hoạt động: access › UC-501 Đăng nhập (mật khẩu chung hoặc mật khẩu riêng + chọn người) — `GET /v1/session/members`, `GET/POST/DELETE /v1/session`, `POST /v1/session/revoke-all`; thiết lập lần đầu: access › [UC-510](../access/UC-510-thiet-lap-nha-lan-dau.md) — `GET/POST /v1/setup`.

## Main Flow
1. App khởi động ở `phase = "boot"` (khung skeleton), gọi `GET /v1/session`.
2. Có `member` → `enter(member)`; không có → hỏi `GET /v1/setup` (`setupNeeded`, luôn hỏi mạng): `needed: true` → màn **Thiết lập** (phase `setup`, bước 2b); còn lại (kể cả mất mạng, server lỗi, chỉ có bản service worker lưu) → màn đăng nhập.
2b. **Thiết lập** (nhà mới, UC-510): bốn bước — Mật khẩu chung → Thành viên (1–6 người, người đầu là chủ hộ, mỗi người tuỳ chọn mật khẩu riêng) → Tài khoản (tên, loại, ngân hàng, của ai hay chung) → Ví theo mẫu (có thu nhập phải tự nộp thuế không — bắt buộc trả lời; chọn ví Must, chọn sẵn cả bốn). Quay lại / Tiếp kiểm từng bước trước khi đi tiếp (`stepErrors`); bước cuối **Tạo nhà** → `POST /v1/setup` → server cấp cookie chủ hộ → vào thẳng Hôm nay (`completeSetup`). Lỗi `field` từ server mở lại đúng bước và hiện dưới đúng ô; mất mạng thì khoá nút Tạo nhà.
3. Màn đăng nhập tải `GET /v1/session/members`, hiện mỗi người một nút (chọn sẵn người lần trước nếu còn trong danh sách, không thì người đầu tiên).
4. Người chọn tên, gõ "Mật khẩu" — mật khẩu chung, hoặc mật khẩu riêng nếu người đó đã đặt; màn không nói người đó dùng loại nào (ADR-95) (nút mắt để hiện/ẩn), bấm **Vào sổ** (nút chỉ bật khi có người và mật khẩu; đang gửi thì ghi "Đang vào…").
5. `POST /v1/session { password, member_id }` thành công → `enter(member)`:
   1. `forgetOtherMember`: nếu `vi-nha:last-member` khác người này (hoặc không đọc được) → xoá cache số liệu (`cacheClear`) và cache `vi-nha-api` của service worker; rồi ghi `vi-nha:last-member`.
   2. Nạp bootstrap/snapshot đã lưu của **đúng người này** (nếu có) và hiện ngay với cờ số cũ; nạp hàng đợi.
   3. `refresh()` lấy số mới, rồi đồng bộ hàng đợi (UC-704).
   4. Chạy nền `syncPush(member)` (UC-714 bước 11): máy đã bật thông báo mà đang gắn người khác → gỡ; cùng người → gửi lại subscription.
6. Đăng xuất: bấm **Đăng xuất** (nút thường, không đỏ; điện thoại: Cài đặt › Máy này, cạnh "Đang dùng: {tên}" và ô Giao diện Theo máy/Sáng/Tối; màn rộng: chân thanh bên) → gỡ thông báo đẩy của máy (`unbindPush`, UC-714 — cần phiên nên làm trước) → `DELETE /v1/session` → xoá cache số liệu + cache `vi-nha-api` → về màn đăng nhập, xoá `boot`, `snap`, `lastEntry` khỏi bộ nhớ.
7. Đăng xuất mọi máy (mất điện thoại, nghi lộ mật khẩu): bấm **Đăng xuất mọi máy** (nút thường; điện thoại: Cài đặt › Máy này, hàng "Mất máy, lộ mật khẩu?" dưới hàng Đăng xuất; màn rộng: liên kết dưới hàng "Đang dùng" ở chân thanh bên). Lần bấm đầu **luôn** chỉ đổi nút thành **Vẫn đăng xuất mọi máy** và hiện: "Mọi máy đang đăng nhập, cả máy này, sẽ phải nhập lại mật khẩu. Dùng khi mất điện thoại hoặc nghi lộ mật khẩu." (còn khoản trong hàng đợi thì thêm "Còn N khoản của {tên} chưa lên sổ, nằm lại trên máy này đến khi {tên} đăng nhập lại."). Bấm lần hai → `unbindPush` → `POST /v1/session/revoke-all` → dọn máy như bước 6 → màn đăng nhập. Máy khác bị đẩy về màn đăng nhập ở request `/v1/*` kế tiếp (E4).

## Alternative Flows
- 2a. `GET /v1/session` lỗi (mất mạng…) → vào bằng người lần trước nếu có bootstrap đã lưu của người đó (UC-710); không có thì màn đăng nhập.
- 6a. Người đang dùng còn khoản trong hàng đợi (`pending` hoặc `rejected`): lần bấm đầu chỉ đổi nút thành **Vẫn đăng xuất** và hiện: "Còn N khoản của {tên} chưa lên sổ. Chúng nằm lại trên máy này và chỉ gửi khi {tên} đăng nhập lại." Bấm lần hai mới đăng xuất. Hàng đợi **không** bị xoá.
- 6b. Người khác đăng nhập vào máy có hàng đợi của người trước: khoản của người trước ở lại, hiện "của {tên} — gửi khi người này đăng nhập", không bị gửi (UC-704).
- Đổi người = đăng xuất rồi chọn lại. Ghi chú cuối form đăng nhập: "Chọn người để app biết ai ghi khoản nào và tự điền tài khoản, tiền mặt của người đó. Đổi người thì đăng xuất (Cài đặt › Máy này) rồi chọn lại."

## Exceptions
- E1. Tải danh sách người lỗi vì offline → "Không có mạng. Đăng nhập lần đầu cần mạng."; lỗi khác → câu lỗi server. Câu lỗi nằm dưới "Ai đang dùng máy này" (chỗ các nút tên), ô mật khẩu không bị đánh dấu sai. Danh sách tự tải lại khi trạng thái `online` đổi; tải được thì câu lỗi tắt.
- E2. Bấm Vào sổ khi offline → "Không có mạng. Đăng nhập cần mạng."; sai mật khẩu / bị chặn vì sai quá nhiều lần (429) / lỗi khác → câu lỗi server nguyên văn, ô mật khẩu `aria-invalid`.
- E3. Đăng xuất khi offline → toast "Đăng xuất cần mạng." (máy có bật thông báo thì lỗi đến từ bước gỡ thông báo, trước khi đụng tới phiên); lỗi khác → toast câu lỗi server. Vẫn ở trong app.
- E3b. Đăng xuất mọi máy khi offline → toast "Đăng xuất cần mạng."; phiên các máy không đổi, vẫn ở trong app.
- E4. Bất kỳ `/v1/*` nào (trừ đường dẫn bắt đầu bằng `/v1/session`) trả 401 → về màn đăng nhập (`toLogin`), **không** xoá cache. Riêng 401 có mã `wrong_password` (sai mật khẩu khi thiết lập hay khi đổi mật khẩu riêng — UC-709) **không** đẩy về màn đăng nhập.
- E5. Đăng nhập trả `409 setup_required` (nhà chưa thiết lập) → chuyển sang màn Thiết lập.
- E6. Màn Thiết lập: `401` sai mật khẩu chung → lỗi ở ô mật khẩu bước 1; `400` kèm `field` → mở đúng bước, lỗi dưới đúng ô; `409 already_setup`, `429`, mất mạng → câu chung dưới nút, giữ bước đang đứng.

## Acceptance Criteria
### AC-1: Chọn người và nhớ người lần trước
- Given máy đã từng đăng nhập bằng "Vợ"
- When mở màn đăng nhập có mạng
- Then nút "Vợ" đang được chọn sẵn (`aria-pressed`) và nút Vào sổ chỉ bật khi đã gõ mật khẩu
- Tests: ⚠ Chưa có test

### AC-2: Người khác vào máy thì không thấy số của người trước
- Given "Chồng" đã dùng máy, cache có bootstrap/snapshot `husband:*` và cache `vi-nha-api`
- When "Vợ" đăng nhập thành công
- Then cache số liệu và cache `vi-nha-api` bị xoá trước khi hiện bất kỳ số nào; app chỉ nạp bản lưu có khoá `wife:*`
- Tests: ⚠ Chưa có test

### AC-3: Không rõ người lần trước thì coi là người khác
- Given `localStorage` bị chặn (không đọc được `vi-nha:last-member`)
- When bất kỳ ai đăng nhập
- Then cache số liệu và cache `vi-nha-api` bị xoá
- Tests: ⚠ Chưa có test

### AC-4: Đăng xuất hỏi lại khi còn khoản chưa lên sổ, và không xoá hàng đợi
- Given người đang dùng còn 2 khoản trong hàng đợi
- When bấm Đăng xuất một lần
- Then chưa đăng xuất; nút thành "Vẫn đăng xuất" kèm câu "Còn 2 khoản của … chưa lên sổ…"
- When bấm lần nữa (có mạng)
- Then về màn đăng nhập; cache số liệu bị xoá; 2 khoản vẫn còn trong hàng đợi
- Tests: ⚠ Chưa có test (việc `cacheClear` không đụng hàng đợi chỉ được xác nhận bằng review: `plans/reports/code-reviewer-260922-0330-redteam-fixes-review.md`)

### AC-5: Phiên hết hạn đưa về màn đăng nhập mà không mất hàng đợi
- Given đang trong app, hàng đợi có khoản `pending`
- When một lượt đồng bộ nhận 401
- Then lượt dừng, khoản giữ nguyên `pending` với `attempts` không đổi, app về màn đăng nhập
- Tests: `web/src/offline/queue.test.ts` › "hàng đợi nhập offline › 401: dừng, giữ nguyên hàng đợi để gửi sau khi đăng nhập lại"

### AC-6: Đăng nhập cần mạng
- Given máy offline, ở màn đăng nhập
- When bấm Vào sổ
- Then hiện "Không có mạng. Đăng nhập cần mạng." và nút trở lại bấm được
- Tests: ⚠ Chưa có test

### AC-7: Đăng xuất mọi máy luôn hỏi lại, rồi đưa mọi máy về màn đăng nhập
- Given "Chồng" đăng nhập trên điện thoại (390px) và "Vợ" đăng nhập trên máy khác
- When Chồng bấm Đăng xuất mọi máy ở Cài đặt › Máy này một lần; rồi bấm "Vẫn đăng xuất mọi máy"
- Then lần một: chưa gọi server, hiện câu hỏi lại; lần hai: điện thoại về màn đăng nhập; máy của Vợ gọi `/v1/snapshot` → 401
- Tests: ⚠ Chưa có test tự động phía PWA (hook `useLogout(true)` + `logout(true)` chỉ nối nút với API; luật server có test ở access UC-501 AC-10/AC-11). Đã chạy thử 6/10 trên `wrangler dev` + Chromium 390px: đúng như trên; màn rộng 1280px hiện liên kết ở chân thanh bên.

### AC-8: DB mới → màn Thiết lập bốn bước, xong vào thẳng Hôm nay
- Given `GET /v1/setup` → `needed: true`; rồi `needed: false`; rồi mất mạng / server lỗi / chỉ có bản service worker lưu
- When mở app chưa có phiên; đi qua bốn bước; server trả lỗi `field`
- Then màn Thiết lập thay màn đăng nhập; `needed: false` hay không hỏi được → màn đăng nhập như hiện nay; form bắt đầu với một người, một tài khoản ngân hàng trống, đủ bốn ví Must, chưa trả lời câu thuế; bớt người giữ đúng người giữ tài khoản (tài khoản của người bị bớt thành chung); lỗi `field` (dạng `members.1.name` hay `members[0].name`) mở đúng bước, gắn vào đúng ô; 401 → ô mật khẩu bước 1; 409 / 429 / mất mạng → câu chung; xong vào thẳng Hôm nay. Mobile 390px, chạm ≥ 44px
- Tests: [`web/src/lib/setup.test.ts`](../../web/src/lib/setup.test.ts) › "UC-701 AC-8: mở app hỏi GET /v1/setup › needed: true → màn Thiết lập; needed: false → màn đăng nhập" · "… › mất mạng, server lỗi, hay chỉ có bản service worker lưu từ trước → màn đăng nhập như hiện nay" · "UC-701 AC-8: form Thiết lập — bắt đầu › một người, một tài khoản ngân hàng trống, đủ bốn ví Must, chưa trả lời câu thuế" · "UC-701 AC-8: bớt người ở bước 2 giữ đúng người giữ tài khoản › tài khoản của người bị bớt thành chung; chỉ số người sau lùi một" · "UC-701 AC-8: lỗi server hiện đúng ô › field dấu chấm → đúng bước" · "… › 400 có field: lỗi gắn vào ô đó (cả dạng members[0].name), mở đúng bước" · "… › 401 sai mật khẩu chung → ô mật khẩu ở bước 1" · "… › 409 đã thiết lập, 429, mất mạng → câu chung, giữ bước đang đứng"; [`web/src/lib/api.test.ts`](../../web/src/lib/api.test.ts) › "lỗi server: field và 401 › UC-701 AC-8: 400 kèm field → ApiError.field chỉ ô lỗi"; [`web/src/lib/sw-fresh.test.ts`](../../web/src/lib/sw-fresh.test.ts) › "freshFor: bao lâu service worker trả bản lưu không hỏi mạng › health, thiết lập và phiên luôn hỏi mạng"; vẽ màn, 390px, vào thẳng Hôm nay: ⚠ Chưa có test (giao diện — đã xem tay ở 390px với server giả)

### AC-9: Màn đăng nhập không lộ ai dùng mật khẩu riêng
- Given `husband` có mật khẩu riêng, `wife` không
- When mở màn đăng nhập, chọn từng người
- Then cùng một ô "Mật khẩu" cho mọi người, không chữ nào nói người đó dùng mật khẩu chung hay riêng; sai thì cùng câu "Sai mật khẩu."
- Tests: server: [`test/login.test.ts`](../../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-13: người đã có mật khẩu riêng — mật khẩu chung bị 401, mật khẩu riêng vào được; sai lần nào cũng tính; lỗi không lộ ai có mật khẩu riêng"; màn đăng nhập: ⚠ Chưa có test (giao diện)

## Traceability
- Code: `web/src/screens/login.tsx` › `Login` (409 `setup_required` → màn Thiết lập); `web/src/screens/setup.tsx` › `Setup`; `web/src/lib/setup.ts` › `setupNeeded`, `stepErrors`, `setupPayload`, `removeMember`, `stepOfField`, `setupServerError`; `web/src/state/store.ts` › `checkSession` (phase `setup`), `completeSetup`, `signedOut`, `login`, `enter`, `forgetOtherMember`, `logout` (tham số `everywhere`), `toLogin`, `lastMemberId`, `start`; `web/src/state/push.ts` › `syncPush`, `unbindPush` (UC-714); `web/src/lib/api.ts` › `request` (gọi `onUnauthorized` khi 401), `setUnauthorizedHandler`; `web/src/ui/shell.tsx` › `useLogout` (tham số `everywhere`), `signOutEverywhereNote`, `Sidebar`; `web/src/screens/settings.tsx` › `DeviceCard` (Máy này); `web/src/offline/idb.ts` › `cacheClear`.
- Migrations/DB: không (máy người dùng: IndexedDB `vi-nha`, `localStorage` `vi-nha:last-member`).

## Divergences & Open Questions
- [OPEN] `toLogin()` (store.ts:238) không xoá cache số liệu/cache API khi phiên bị vô hiệu ngoài luồng đăng xuất (báo cáo `redteam-260922-0100-auth-exposure.md` §3, viết trên HEAD cũ). Hiện `enter()` → `forgetOtherMember` xoá cache khi người vào khác `vi-nha:last-member` (commit `80875be`, `4b6d298`), nên số của người trước không được nạp cho người sau; nhưng dữ liệu vẫn nằm trên máy trong lúc ở màn đăng nhập. Chưa có quyết định chốt là đã đóng mục §3 hay chưa.
