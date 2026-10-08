# UC-501: Đăng nhập bằng mật khẩu chung (hoặc mật khẩu riêng) + chọn người
- Status: implemented
- BR: BR-09
- Decisions: D6; ADR-89 (chặn dò mật khẩu, đăng xuất mọi máy); commit `4b6d298` (đọc cookie từ cuối); `plans/reports/redteam-260922-0100-auth-exposure.md` (mục "Đã kiểm tra và thấy ổn", LOW #5); ADR-95 (mật khẩu chung + mật khẩu riêng tuỳ chọn; khoá ký phiên trong D1); ADR-97 (Claude nối bằng OAuth — trang uỷ quyền đăng nhập bằng chính luật này); ADR-98 (Đăng xuất mọi máy và đổi mật khẩu chung gỡ cả kết nối AI)
- Actor: Thành viên trong hộ (qua PWA)
- Trigger: `GET /v1/session/members`, `POST /v1/session`, `GET /v1/session`, `DELETE /v1/session`, `POST /v1/session/revoke-all` (màn đăng nhập / khởi động PWA / nút Đăng xuất / nút Đăng xuất mọi máy); form đăng nhập của trang uỷ quyền Claude `/oauth/authorize` dùng chung luật (mcp UC-601 AC-9)

## History
- v1 (2026-09-22, commit `b92fc0f`): mật khẩu chung + cookie ký theo từng thành viên.
- v2 (2026-09-22, commit `4b6d298`): tách cookie từ cuối để `member_id` có dấu `.` vẫn đọc được (red-team LOW #5 báo `split(".")` đòi đúng 3 phần).
- v3 (2026-10-06, commit `d059eaa`): red-team 6/10 (ADV-001, INSIDER-03; change [`261006-bao-mat-dang-nhap`](../changes/archive/261006-bao-mat-dang-nhap/proposal.md), ADR-89) — **chặn dò mật khẩu**: sai 10 lần trong 15 phút từ một IP (`CF-Connecting-IP`) hoặc 30 lần chung mọi IP → `429 too_many_attempts` tới hết cửa sổ, kiểm **trước** khi so mật khẩu; mỗi lần sai ghi log số lần (không có mật khẩu). **Đăng xuất mọi máy** `POST /v1/session/revoke-all` (cần đăng nhập): tăng thế hệ phiên (`config` `session_epoch`) trộn vào khoá ký → mọi cookie đã phát hết hiệu lực; cookie phát trước ADR-89 vẫn dùng được tới lần bấm đầu tiên; API token không bị ảnh hưởng. Đóng hai [OPEN] (không giới hạn số lần thử; không thu hồi được phiên). `GET /v1/session/members` vẫn công khai (rủi ro chấp nhận, ADR-89).
- v4 (2026-10-08, commit `1ed22e1`): **mật khẩu chung + mật khẩu riêng tuỳ chọn; khoá ký phiên trong D1** (ADR-95; migration 0030, schema v1.30). Thứ tự kiểm khi đăng nhập: chặn dò → 429; chưa thiết lập → 409 `setup_required` (UC-510); người có mật khẩu riêng → chỉ so băm (PBKDF2-SHA256 20.000 vòng), còn lại so mật khẩu chung kèm băm giả; đúng thì xoá đếm, sai thì đếm. Khoá ký là `secret:session_key` (32 byte ngẫu nhiên, tự sinh lần đầu) — không cần `API_TOKEN` nữa; cookie mang cờ chung / riêng và `session_gen`, không mang băm; phiên chung trộn `APP_PASSWORD` vào khoá. Preconditions bỏ `API_TOKEN`; E4 "đổi `API_TOKEN`" DEPRECATED; thêm E8, AC-12…AC-15; đóng [OPEN] "`API_TOKEN` rỗng thì `readSession` luôn trả `null`". Hệ quả một lần: deploy 2026-10-08 làm mọi máy đăng nhập lại (change [261007-thiet-lap-lan-dau](../changes/archive/261007-thiet-lap-lan-dau/proposal.md))
- v5 (2026-10-08, commit `e5ecf41`): **Claude nối bằng OAuth** (ADR-97, ADR-98) — luật đăng nhập (bước 2b–4) tách thành `checkLogin` dùng chung cho `POST /v1/session` và form đăng nhập ở trang uỷ quyền Claude (cùng bộ chặn dò scope `login`, cùng luật mật khẩu riêng / chung); **Đăng xuất mọi máy** (8b) gỡ thêm mọi kết nối Claude / ứng dụng AI của cả nhà, câu báo cả nhà đổi thành "… vừa đăng xuất mọi máy và gỡ mọi kết nối Claude …"; đổi `APP_PASSWORD` làm hết hiệu lực cả kết nối AI đã uỷ quyền bằng mật khẩu chung. Thêm bước 4a, E4a, AC-16…AC-18 (change [261008-mcp-oauth](../changes/archive/261008-mcp-oauth/proposal.md))

## Preconditions
- `APP_PASSWORD` (mật khẩu chung của nhà) đã đặt (`wrangler secret` — ô bắt buộc duy nhất lúc deploy); nhà đã thiết lập (UC-510, `config.setup_done`); có ít nhất một thành viên `active`. `API_TOKEN` **không** cần cho đăng nhập (chỉ cho REST bằng token — UC-502).

## Main Flow
1. PWA gọi `GET /v1/session/members` (không cần đăng nhập) → nhận `[{id, name}]` của thành viên `active`, chủ hộ trước rồi theo `name`. Không trả số liệu nào.
2. Người dùng chọn tên, nhập mật khẩu — mật khẩu chung của nhà, hoặc mật khẩu riêng nếu người đó đã đặt (ADR-95; màn đăng nhập không nói người đó dùng loại nào) → `POST /v1/session` `{ password, member_id }`.
2b. Server lấy IP người gọi (`CF-Connecting-IP`) và kiểm bộ đếm lần sai (`blockedFor`, entity AuthFailure): IP này đã sai ≥ 10 lần, hoặc cả nhà đã nhận ≥ 30 lần sai, trong cửa sổ 15 phút → E6. Kiểm **trước** khi đọc mật khẩu: bị chặn thì đúng hay sai đều cùng câu trả lời.
2c. Nhà chưa thiết lập (không có `config.setup_done`) → E8 (`409 setup_required`).
3. Server tìm thành viên `active` theo `member_id`: có mật khẩu riêng (`password_hash`) → **chỉ** so với băm (PBKDF2, `verifyPassword`); không có người hoặc người không có mật khẩu riêng → so với `APP_PASSWORD` bằng `safeEqual` (không rò thời gian) và vẫn chạy một phép băm giả cùng số vòng, để thời gian trả lời không lộ ai có mật khẩu riêng. Sai → E1 (so mật khẩu luôn chạy trước khi xét người lạ).
4. Mật khẩu đúng thì xoá đếm lần sai của IP này (trần chung giữ nguyên); `member_id` không phải thành viên `active` → E2.
4a. Luật 2b–4 (chặn dò → chưa thiết lập → so mật khẩu riêng / chung → xoá / ghi đếm sai → người lạ) nằm ở một hàm dùng chung (`checkLogin`), áp y hệt cho form đăng nhập của trang uỷ quyền Claude (mcp UC-601 AC-9): sai ở đó cũng tính vào bộ chặn dò, bị chặn cũng 429; mỗi nơi tự dựng câu trả lời (JSON hay trang HTML). Đăng nhập đúng ở trang uỷ quyền cũng phát cookie `pf_session` như bước 5.
5. Server phát cookie `pf_session` mang cờ cách vào (chung `h` / riêng `p`) và `session_gen` của người đó, không bao giờ mang băm hay mật khẩu (định dạng, hạn 30 ngày, khoá ký `secret:session_key` tự sinh trong D1 + thế hệ phiên; phiên chung trộn thêm `APP_PASSWORD`; thuộc tính: xem `entities.md` › Session) và trả `200 { ok: true, data: { member: {id, name} } }`.
6. Các request `/v1/*` sau đó mang cookie; `requireAuth` đọc phiên và đặt `memberId`, `via="session"` (UC-503).
7. Khởi động lại PWA: `GET /v1/session` → `{ member }` nếu phiên hợp lệ và thành viên còn `active`, ngược lại `{ member: null }` (luôn 200).

## Alternative Flows
- 8a. Đăng xuất: `DELETE /v1/session` xoá cookie (`Path=/`), trả `{ ok: true, data: null }`. Không cần phiên hợp lệ. Chỉ xoá cookie ở trình duyệt — bản sao cookie ở nơi khác vẫn dùng được tới hạn (dùng 8b).
- 8b. Đăng xuất mọi máy: `POST /v1/session/revoke-all` (qua `requireAuth`: phiên cookie + thân JSON, hoặc `Authorization: Bearer <API_TOKEN>`) → tăng `config` `session_epoch` (thiếu = 0 → 1, rồi 2, …), **gỡ mọi kết nối Claude / ứng dụng AI của cả nhà** (thu hồi mọi grant OAuth của mọi thành viên, refresh token chết theo; token đang cầm hết hiệu lực trong vòng 60 giây — KV, ADR-98), ghi nhật ký `session.revoke_all` và báo cả nhà "⚠️ <người> vừa đăng xuất mọi máy và gỡ mọi kết nối Claude — nếu không phải người nhà làm, vào Cài đặt gỡ ngay." (ADR-90), xoá cookie của máy đang bấm, trả `{ ok: true, data: null }`. Từ request kế tiếp mọi cookie đã phát (mọi người, mọi máy, kể cả máy vừa bấm) → 401; đăng nhập lại phát cookie theo thế hệ mới; muốn dùng lại Claude thì nối lại (đăng nhập + đồng ý ở trang uỷ quyền). `API_TOKEN` không đổi, vẫn dùng được.

## Exceptions
- E1. `APP_PASSWORD` chưa đặt hoặc sai mật khẩu → ghi một lần sai cho IP này và cho dòng chung (`recordFailure`, log `[auth] login sai: ip <ip>, lần <n> trong 15 phút` — không có mật khẩu), chờ 400 ms rồi `401 { code: "wrong_password", message: "Sai mật khẩu." }`.
- E2. Đúng mật khẩu nhưng `member_id` không phải thành viên `active` → `400 { code: "unknown_member", message: "Chọn người dùng." }`. Kiểm tra mật khẩu luôn chạy **trước**.
- E3. Body không phải JSON → coi như rỗng → rơi vào E1.
- E4. Cookie bị sửa (đổi `member_id`, cờ, `session_gen`, hạn, chữ ký), hết hạn, đã bấm Đăng xuất mọi máy sau khi cookie được phát, `session_gen` của người đó đã tăng (đổi / gỡ mật khẩu riêng, bị tắt), phiên **chung** mà `APP_PASSWORD` đã đổi, hoặc cookie chung của người nay đã có mật khẩu riêng → phiên không hợp lệ → `/v1/*` trả `401 unauthorized`. *(DEPRECATED từ v4: "`API_TOKEN` đã đổi" — `API_TOKEN` không còn là một phần khoá ký phiên; đổi nó không đụng phiên.)*
- E4a. Đổi `APP_PASSWORD` → ngoài phiên chung (E4), mọi kết nối Claude đã uỷ quyền bằng **mật khẩu chung** hết hiệu lực ở lần gọi `/mcp` kế tiếp (401 kèm Bearer challenge, grant bị thu hồi để refresh không hồi sinh — ADR-98); kết nối uỷ quyền bằng mật khẩu riêng vẫn chạy (mcp UC-601 AC-10).
- E5. Thành viên bị tắt (`active=0`) sau khi đăng nhập → mọi request bằng phiên đó trả 401.
- E6. IP đang bị chặn (2b) → `429 { code: "too_many_attempts", message: "Sai mật khẩu quá nhiều lần, thử lại sau N phút." }`, header `Retry-After` (giây còn lại; N = số phút làm tròn lên), không có `Set-Cookie`, không đếm thêm.
- E8. Nhà chưa thiết lập → `409 { code: "setup_required", message: "Nhà chưa thiết lập — mở app để thiết lập lần đầu." }`, kiểm sau E6 (đang bị chặn vẫn 429 trước), trước khi so mật khẩu.
- E7. `POST /v1/session/revoke-all` không có phiên/token hợp lệ → 401; phiên cookie mà thân không phải JSON → 415 (UC-503 AC-1); thế hệ phiên không đổi.

## Acceptance Criteria
### AC-1: Danh sách người không cần đăng nhập, chủ hộ đứng đầu
- Given seed có `husband` (owner) và `wife`
- When gọi `GET /v1/session/members` không kèm cookie/token
- Then nhận id theo thứ tự `["husband", "wife"]`
- Tests: `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › danh sách người cho màn đăng nhập không cần đăng nhập"

### AC-2: Sai mật khẩu bị từ chối, đúng mật khẩu nhận cookie dùng được
- Given `APP_PASSWORD = "mat-khau-chung"`
- When đăng nhập bằng `"sai"` / bằng `"mat-khau-chung"` + `wife`
- Then lần 1 → 401; lần 2 → 200, `Set-Cookie` có `pf_session=…HttpOnly`, và cookie đó gọi được `GET /v1/snapshot` (200)
- Tests: `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › sai mật khẩu → 401, đúng → cookie dùng được cho /v1"

### AC-3: Cookie giả mạo và đổi mật khẩu làm phiên vô hiệu
- Given cookie hợp lệ của `wife`
- When đổi phần `member_id` thành `husband`; hoặc đổi `APP_PASSWORD`
- Then `GET /v1/snapshot` trả 401 trong cả hai trường hợp
- Tests: `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › cookie bị sửa thì không qua; đổi mật khẩu thì phiên cũ hết hiệu lực"

### AC-4: `member_id` chứa dấu chấm vẫn đăng nhập được
- Given thành viên `active` có id chứa `.`
- When đăng nhập và gọi `/v1/*` bằng cookie đó
- Then phiên hợp lệ, `memberId` đúng id đầy đủ
- Tests: ⚠ Chưa có test

### AC-5: Đúng mật khẩu, chọn người không tồn tại
- Given mật khẩu đúng
- When `member_id` không phải thành viên `active`
- Then 400 `unknown_member`, không có `Set-Cookie`
- Tests: ⚠ Chưa có test

### AC-6: Thành viên bị tắt mất quyền ngay
- Given phiên hợp lệ của thành viên X
- When X chuyển `active=0`
- Then request `/v1/*` bằng phiên đó → 401; `GET /v1/session` → `{ member: null }`
- Tests: ⚠ Chưa có test

### AC-7: Sai mật khẩu tới ngưỡng thì IP đó bị chặn, IP khác không
- Given IP `203.0.113.7` đã sai 8 lần trong 15 phút
- When sai thêm 2 lần; rồi đúng mật khẩu từ IP đó; rồi đúng mật khẩu từ IP `198.51.100.9`
- Then hai lần sai → 401 (lần 10 vẫn là 401); đúng mật khẩu từ IP bị chặn → `429 too_many_attempts` "Sai mật khẩu quá nhiều lần, thử lại sau 15 phút.", `Retry-After` > 14 phút, không có `Set-Cookie`; IP khác → 200; log có "lần 10", không có mật khẩu đã thử
- Tests: `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › chặn dò mật khẩu (ADR-89) › sai tới lần thứ 10 trong 15 phút từ một IP → 429 kể cả khi đúng mật khẩu; IP khác vẫn vào được; log đếm, không có mật khẩu"

### AC-8: Hết cửa sổ 15 phút thì thử lại được; đăng nhập đúng xoá đếm của IP
- Given IP `203.0.113.7` có 10 lần sai bắt đầu 16 phút trước
- When đăng nhập đúng; rồi sai một lần
- Then 200 và `auth_failures` rỗng; sau lần sai có đúng hai dòng: `('login', '*', 1)`, `('login', '203.0.113.7', 1)`
- Tests: `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › chặn dò mật khẩu (ADR-89) › hết 15 phút thì được thử lại; đăng nhập đúng xoá đếm của IP đó"

### AC-9: Trần chung 30 lần sai mọi IP
- Given cả nhà đã nhận 29 lần sai trong 15 phút (dòng `*`)
- When IP A đăng nhập đúng; IP B sai một lần; IP A đăng nhập đúng lần nữa
- Then 200; 401; 429
- Tests: `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › chặn dò mật khẩu (ADR-89) › trần chung: 30 lần sai từ nhiều IP trong 15 phút thì mọi IP tạm không đăng nhập được"

### AC-10: Đăng xuất mọi máy làm mọi cookie đã phát hết hiệu lực
- Given cookie của `wife` và của `husband` (thế hệ phiên 0)
- When `wife` gọi `POST /v1/session/revoke-all`; rồi đăng nhập lại; rồi gọi lần nữa bằng API token
- Then 200 kèm `Set-Cookie` xoá `pf_session`; cả hai cookie cũ → `/v1/snapshot` 401 và `GET /v1/session` → `{ member: null }`; cookie mới → 200; API token vẫn 200; lần thu hồi thứ hai làm cookie phát sau lần đầu cũng 401
- Tests: `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › đăng xuất mọi máy (ADR-89) › mọi cookie đã phát (mọi người, cả máy đang bấm) hết hiệu lực; đăng nhập lại được; API token không bị ảnh hưởng"

### AC-11: Đăng xuất mọi máy cần đăng nhập
- Given cookie hợp lệ của `wife`
- When `POST /v1/session/revoke-all` không kèm gì; kèm cookie giả (`wife` → `husband`); kèm cookie thật nhưng `Content-Type` form
- Then 401; 401; 415; cookie của `wife` vẫn dùng được
- Tests: `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › đăng xuất mọi máy (ADR-89) › cần đăng nhập: không cookie, cookie giả hay gửi form thường đều bị chặn, phiên không đổi"

### AC-12: Người chưa có mật khẩu riêng đăng nhập bằng mật khẩu chung như trước
- Given `wife` chưa có mật khẩu riêng
- When `POST /v1/session { member_id: "wife", password: <mật khẩu chung> }`
- Then 200, cookie dùng được
- Tests: [`test/login.test.ts`](../../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-12: người chưa có mật khẩu riêng đăng nhập bằng mật khẩu chung như hiện nay"

### AC-13: Người đã có mật khẩu riêng chỉ vào bằng mật khẩu riêng; lỗi không lộ ai có mật khẩu riêng
- Given `husband` có mật khẩu riêng
- When đăng nhập `husband` bằng mật khẩu chung; bằng mật khẩu riêng; người lạ với mật khẩu sai / với mật khẩu chung đúng
- Then 401 `wrong_password` (cùng câu với sai mật khẩu thường, tính vào bộ chặn dò); 200; người lạ: 401 trước, đúng mật khẩu chung thì 400 `unknown_member`
- Tests: [`test/login.test.ts`](../../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-13: người đã có mật khẩu riêng — mật khẩu chung bị 401, mật khẩu riêng vào được; sai lần nào cũng tính; lỗi không lộ ai có mật khẩu riêng" · "… › AC-13: người lạ — sai mật khẩu thì 401 trước; đúng mật khẩu chung thì 400 unknown_member (giữ E2/AC-5)"

### AC-14: Không cần `API_TOKEN` để đăng nhập; khoá ký phiên tự sinh trong D1
- Given chưa đặt `API_TOKEN`; DB chưa có `secret:session_key`
- When đăng nhập đúng (kể cả hai lần đăng nhập đầu cùng lúc); gọi REST bằng token
- Then phiên dùng được; khoá 32 byte ngẫu nhiên sinh một lần (hai lần đầu dùng cùng khoá), không API nào trả ra; REST bằng token vẫn bị khoá (UC-502 không đổi)
- Tests: [`test/login.test.ts`](../../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-14: khoá ký phiên tự sinh trong D1 › chưa đặt API_TOKEN: đăng nhập đúng thì phiên dùng được; REST bằng token vẫn bị khoá" · "… › khoá 32 byte ngẫu nhiên sinh một lần (hai lần đăng nhập đầu cùng lúc dùng cùng khoá), không API nào trả ra"

### AC-15: Phiên chung / phiên riêng; đổi mật khẩu chung chỉ làm hết phiên chung
- Given `wife` vào bằng mật khẩu chung, `husband` vào bằng mật khẩu riêng
- When đổi `APP_PASSWORD`; xem nội dung cookie; dùng cookie chung (cũ) của người nay đã có mật khẩu riêng, hay sửa cờ / `session_gen` trong cookie; Đăng xuất mọi máy
- Then phiên của `wife` → 401, phiên của `husband` vẫn 200; cookie chỉ gồm `member_id`, cờ chung / riêng, `session_gen`, hạn, chữ ký — không có băm hay mật khẩu; cookie sửa hay cookie chung của người có mật khẩu riêng → 401; Đăng xuất mọi máy làm cả phiên riêng hết hiệu lực
- Tests: [`test/login.test.ts`](../../test/login.test.ts) › "UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn › AC-15: phiên chung / phiên riêng › đổi APP_PASSWORD: phiên vào bằng mật khẩu chung hết hiệu lực, phiên vào bằng mật khẩu riêng vẫn dùng được" · "… › cookie chỉ mang member_id, cờ chung / riêng, session_gen, hạn và chữ ký — không mang băm hay mật khẩu" · "… › cookie chung của người đã có mật khẩu riêng bị từ chối; đổi cờ hay session_gen trong cookie cũng không qua" · "… › đăng xuất mọi máy vẫn đăng xuất cả phiên vào bằng mật khẩu riêng"; chưa thiết lập → 409: [`test/setup.test.ts`](../../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-7: chưa thiết lập › POST /v1/session → 409 setup_required; /v1/* cần đăng nhập → 401 như hiện nay" · "… › đăng nhập khi đang bị chặn dò vẫn 429 trước, rồi mới tới 409 setup_required"

### AC-16: Đăng xuất mọi máy gỡ cả kết nối Claude của cả nhà (ADR-98)
- Given `wife` và `husband` mỗi người đã nối Claude (token + refresh token)
- When một người bấm Đăng xuất mọi máy (`POST /v1/session/revoke-all`)
- Then mọi grant bị thu hồi (KV không còn grant nào): `/mcp` bằng token cũ của cả hai → 401, refresh token không đổi được token mới
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-10: gỡ kết nối khi quyền vào đổi › Đăng xuất mọi máy → kết nối Claude của cả nhà bị gỡ"

### AC-17: Đổi mật khẩu chung làm hết hiệu lực kết nối uỷ quyền bằng mật khẩu chung (ADR-98)
- Given `wife` nối Claude bằng mật khẩu riêng, `husband` nối bằng mật khẩu chung
- When đổi `APP_PASSWORD`; rồi gọi `/mcp` bằng token của từng người
- Then token của `husband` → 401 kèm Bearer challenge, grant bị thu hồi (refresh không đổi được); token của `wife` vẫn chạy
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-10: gỡ kết nối khi quyền vào đổi › đổi APP_PASSWORD → kết nối uỷ quyền bằng mật khẩu chung hết hiệu lực (401 + grant bị thu hồi); mật khẩu riêng vẫn chạy"

### AC-18: Trang uỷ quyền Claude dùng đúng luật đăng nhập này
- Given trang `/oauth/authorize` của một yêu cầu uỷ quyền hợp lệ; `wife` có mật khẩu riêng
- When đăng nhập sai mật khẩu; sai tới ngưỡng chặn dò; `wife` vào bằng mật khẩu chung / mật khẩu riêng
- Then 401, tính vào bộ chặn dò scope `login`, chưa ghi gì vào KV; bị chặn → 429; `wife` bằng mật khẩu chung → 401, bằng mật khẩu riêng → 200
- Tests: [`test/mcp-oauth.test.ts`](../../test/mcp-oauth.test.ts) › "UC-601 AC-9: trang uỷ quyền › sai mật khẩu → 401, tính vào bộ chặn dò scope login, KV vẫn trống; bị chặn → 429" · "… › người có mật khẩu riêng: mật khẩu chung bị từ chối, mật khẩu riêng vào được (luật UC-501)"

## Traceability
- Code: `src/routes/session.ts` › `session.get("/members")`, `session.get("/")`, `session.post("/")`, `session.delete("/")`, `session.post("/revoke-all")` (gọi `revokeAllGrants`); `src/services/member-login.ts` › `checkLogin`, `recordWrongPassword`, `tooManyAttemptsMessage`; `src/oauth/server.ts` › `revokeAllGrants`, `sharedStamp` (dấu mật khẩu chung của kết nối AI); `src/routes/auth.ts` › `SESSION_COOKIE`, `SessionMode`, `SESSION_KEY`, `SIGNING_SQL`, `sign`, `issueSession`, `revokeAllSessions`, `clearSession`, `readSession`, `loginBlocked`, `wrongPassword`, `passwordAccepted`, `requireAuth`; `src/services/passwords.ts` › `safeEqual`, `PASSWORD_ITERATIONS`, `hashPassword`, `verifyPassword`, `memberPasswordOk`; `src/services/setup.ts` › `isSetUp`; `src/services/auth-throttle.ts` › `THROTTLE_LIMITS`, `clientIp`, `blockedFor`, `recordFailure`, `clearFailures`
- Migrations/DB: `members` (`migrations/0001_schema.sql`), seed `migrations/0002_seed.sql`; `auth_failures` (`migrations/0025_auth_failures.sql`); `config` `session_epoch`, `secret:session_key`, `setup_done`; `members.password_hash`, `members.session_gen` (`migrations/0030_setup_and_member_passwords.sql`)
- Phía PWA (màn đăng nhập, xoá cache khi đổi người): xem `specs/pwa/`

## Divergences & Open Questions
- [OPEN] Trần chung 30 lần sai (AC-9) là cái giá chấp nhận (ADR-89): kẻ dò từ nhiều IP chặn được cả nhà đăng nhập **mới** trong 15 phút; phiên đang có vẫn dùng bình thường. Chưa có cảnh báo cho người nhà khi trần chung bị chạm.
- [OPEN] Không thu hồi được một phiên / một máy riêng lẻ — Đăng xuất mọi máy (8b) đăng xuất cả nhà. Máy mất vẫn nhận thông báo đẩy tới khi gỡ ở Cài đặt › Thông báo (notify UC-410).
