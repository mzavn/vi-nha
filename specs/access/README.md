# Context: access — Truy cập, phiên, cấu hình & bí mật

Ai được vào hệ thống và bằng cửa nào: người trong hộ đăng nhập PWA bằng **một mật khẩu chung + chọn người** (D6), ai muốn thì có **mật khẩu riêng** (ADR-95); nhà mới tạo bằng **thiết lập lần đầu** (UC-510), script/n8n dùng **Bearer `API_TOKEN`**, SePay dùng **API key webhook**, bot Zalo dùng **khoá webhook Zalo** (header `X-Bot-Api-Secret-Token`), Claude và ứng dụng AI dùng **token OAuth** do một người trong nhà uỷ quyền (đăng nhập + đồng ý ở trang uỷ quyền, ADR-97 — mcp UC-601). Context này cũng sở hữu màn **Cài đặt** phía server (`/v1/settings`): cấu hình tài khoản, ví + luật nạp, mã chuyển khoản, thành viên (kể cả mã nối Zalo), tham số, khoá kết nối và danh sách kết nối Claude (gỡ từng cái — UC-508) — tất cả không cần sửa code (BR-08). Bí mật không bao giờ trả nguyên văn ra ngoài, không bao giờ ghi vào log (BR-09).

## Ngôn ngữ chung (ubiquitous language)

| Thuật ngữ | Nghĩa trong context này | Ghi chú khác context |
|---|---|---|
| Thành viên (`member`) | Một người trong hộ — **danh tính đăng nhập** và người nhận Telegram / Zalo | Ở ledger, member chỉ là *nhãn* (`by_member_id`, `owner_member_id`, `wallets.member_id`), không phải chủ sở hữu tiền |
| Chủ hộ (`role='owner'`) | Thành viên đứng đầu danh sách; là **người xem mặc định** khi gọi bằng token không kèm `X-Member-Id` (qua Claude thì người xem là người đã uỷ quyền kết nối — ADR-97) | `role` không cấp quyền gì (phân quyền là non-goal V1, `plans/…/context.md` Non-goals) |
| Phiên (`session`) | Cookie `pf_session` đã ký, mang `member_id`, cách vào (chung / riêng), `session_gen` + hạn | Không có bảng sessions; server giữ khoá ký (`secret:session_key`), thế hệ phiên và `members.session_gen` |
| Người xem (`viewerId`) | Thành viên đang gọi, quyết định ví `private` nào bị ẩn số | Truyền vào `ledger.getSnapshot`/`getBudget`/`walletStatus` |
| `private` | Cờ ẩn **số** của ví cá nhân với người khác — **ẩn lịch sự, không phải bảo mật** (D6) | pwa dùng trường `hidden` tính sẵn ở `/v1/bootstrap` |
| `via` | Cửa đã qua: `"session"` (cookie; cả trang uỷ quyền Claude) hoặc `"token"` (Bearer `API_TOKEN`) — đặt trong `requireAuth`; `"mcp"` — việc ghi qua Claude (tool MCP) | Ghi vào nhật ký thay đổi (`audit_log.via`) |
| Khoá kết nối (`secret`) | `telegram_bot_token`, `zalo_bot_token`, `zalo_webhook_secret` (`config`, dự phòng `wrangler secret`, ADR-80); khoá SePay nằm ở **kết nối SePay** (`sepay_connections`, mỗi kết nối một token API + một khoá webhook, ADR-75) | ingest/notify chỉ **đọc** qua `getSecret` / `loadSepayConnections` |
| Mã nối Zalo | Mã 6 số, hạn 15 phút, một mã đang chờ mỗi người (`zalo_link_codes`); người đó nhắn mã cho bot Zalo, webhook ghi `members.zalo_chat_id` (UC-507, notify UC-411) | `zalo_chat_id` không bao giờ nhập tay |
| Mật khẩu chung / mật khẩu riêng | Mật khẩu chung `APP_PASSWORD` của cả nhà; mật khẩu riêng tuỳ chọn từng người (`members.password_hash`, ADR-95) — người đã có mật khẩu riêng chỉ vào bằng nó; ai biết mật khẩu chung đổi / gỡ được mật khẩu riêng của bất kỳ ai (UC-507) | Thiết lập nhà lần đầu cũng cần mật khẩu chung (UC-510) |
| Thiết lập nhà (`setup_done`) | Lần tạo nhà đầu tiên trên DB mới: thành viên, tài khoản, bộ ví mẫu (UC-510); có `config.setup_done` = đã thiết lập | Chưa thiết lập thì không đăng nhập được (409 `setup_required`) |
| Nguồn khoá (`source`) | `"app"` = lưu trong `config` (xoá được từ app); `"server"` = chỉ có `wrangler secret`; `null` = chưa đặt | |
| Bí mật hạ tầng | `API_TOKEN`, `APP_PASSWORD` — chỉ đặt bằng `wrangler secret put`; `APP_PASSWORD` (mật khẩu chung) là ô bắt buộc duy nhất lúc deploy (`README.md` dòng 106). `MCP_SECRET` đã bỏ (ADR-97) | Không đặt được từ app |
| Kết nối Claude (grant OAuth) | Một lần người trong nhà uỷ quyền một ứng dụng AI (Claude, …) vào sổ: gắn người đó, quyền **Xem** (`mcp:read`) và/hoặc **Ghi** (`mcp:write`); lưu trong KV `OAUTH_KV`; gỡ ở Cài đặt (UC-508) hoặc tự gỡ khi đổi mật khẩu, tắt người, Đăng xuất mọi máy (ADR-98) | Định nghĩa gốc ở mcp (UC-601) |
| Chỉ migration đặt | Cấu hình Cài đặt không tạo / không đổi được: ví phe `holding` (Thu nhập, "Thu cho thuê"; "Heo đất" `heo-dat` do migration 0017 tạo, migration 0020 tắt — ADR-82), `accounts.locked` (tài khoản heo đất đã khóa), `rules.account_id` / `counter_account_id` / `from_wallet_id` (rule gắn tài khoản, rule chuyển nội bộ tới đầu kia — ADR-77; rule heo chuyển ví Có thì tốt → Tích sản từ migration 0020, ADR-82) | Cài đặt vẫn sửa được các trường khác của chúng (UC-506, UC-507) |

## Ma trận xác thực (route → cơ chế → bằng chứng)

Thứ tự mount trong `src/index.ts` quyết định: các route `/v1/health`, `/v1/session`, `/v1/setup`, `/webhooks`, `/oauth`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/mcp` mount **trước** `app.use("/v1/*", requireAuth)` nên handler của chúng trả response trước khi middleware chạy (UC-503).

| Tiền tố / route | Cơ chế | Không đạt → | Bằng chứng |
|---|---|---|---|
| `GET /v1/health` | Không cần xác thực; chỉ trả phiên bản schema | — | `src/index.ts` (mount trước `requireAuth`); `test/app.test.ts` › "GET /v1/health › trả phiên bản schema, không cần token" |
| `GET /v1/session/members`, `GET /v1/session`, `DELETE /v1/session` | Không cần xác thực (màn đăng nhập) — chỉ trả `id`,`name` | — | `src/routes/session.ts`; `test/api.test.ts` › "đăng nhập: mật khẩu chung + chọn người › danh sách người cho màn đăng nhập không cần đăng nhập" |
| `POST /v1/session` | Đang bị chặn dò → 429; chưa thiết lập → 409 `setup_required`; người có mật khẩu riêng → so băm, còn lại `APP_PASSWORD` so bằng `safeEqual` (kèm băm giả); `member_id` phải là thành viên `active` → phát cookie `pf_session` (UC-501) | 401 `wrong_password` (trễ 400 ms) / 400 `unknown_member` | `src/routes/session.ts`; `test/api.test.ts` › "… › sai mật khẩu → 401, đúng → cookie dùng được cho /v1" |
| `GET /v1/setup`, `POST /v1/setup` | Không cần xác thực (chưa có ai để đăng nhập). `POST`: đang bị chặn dò → 429; đã thiết lập → 409 `already_setup`; mật khẩu chung `APP_PASSWORD` so `safeEqual` (rỗng → luôn sai) | 401 `wrong_password` (đếm vào bộ chặn dò); 400 `invalid_input` + `field` | `src/routes/setup.ts`; `test/setup.test.ts` (UC-510) |
| `/v1/*` còn lại (`v1.ts`, `logs.ts`, `/v1/settings/*`) — có header `Authorization` | `Bearer <API_TOKEN>` (so `safeEqual`); `X-Member-Id` tuỳ chọn chọn người, thiếu → chủ hộ | 401 `unauthorized`; `X-Member-Id` sai → 400 `unknown_member` | `src/routes/auth.ts` › `requireAuth`; `test/app.test.ts` › "/v1/* cần Bearer token › …" |
| `/v1/*` còn lại — không có header `Authorization` | Cookie `pf_session` hợp lệ + thành viên còn `active`; request ghi (khác GET/HEAD) phải `Content-Type: application/json` | 401 `unauthorized`; 415 `json_required` | `src/routes/auth.ts` › `requireAuth`, `readSession`; `test/api.test.ts` › "… › ghi bằng cookie mà không phải JSON thì bị chặn (chống form giả mạo)" |
| `/v1/push`, `/v1/push/subscriptions`, `/v1/push/subscriptions/remove`, `/v1/push/test` | Như hai dòng `/v1/*` trên (mount sau `requireAuth`). Máy được gắn với `memberId` của cửa đã qua: người trong cookie; với token là `X-Member-Id` hoặc chủ hộ. Service worker gọi lại bằng cookie (`credentials: "same-origin"`, `Content-Type: application/json`) khi subscription đổi | 401 / 415 như trên; `memberId` null → 400 `no_member` (đăng ký, gửi thử) | `src/index.ts` › `app.route("/v1/push", pushRoutes)`; `src/routes/push.ts`; `test/push.test.ts` (gọi bằng Bearer + `X-Member-Id`); xem notify UC-410 |
| `POST /v1/push/test-series`, `POST /v1/push/test-series/cancel` | Như dòng `/v1/push` trên (mount sau `requireAuth`, cookie phải `Content-Type: application/json`). Chỉ bắt đầu/huỷ lượt gửi thử **của chính `memberId`** đã qua cửa; `GET /v1/push` chỉ trả `series` của người đó. Việc gửi chạy nền trong chính request bắt đầu (`waitUntil`) | 401 / 415 như trên; `memberId` null → 400 `no_member` | `src/routes/push.ts`; `src/services/push.ts` › `createTestSeries`, `cancelTestSeries`; `test/push.test.ts` › "thử khi tắt app (lượt gửi thử) › huỷ giữa chừng thì dừng trước tin kế tiếp; huỷ chỉ đụng lượt của mình"; xem notify UC-410 |
| `POST /webhooks/sepay` | `Authorization: Apikey <khoá>`; khoá khớp khoá webhook của **bất kỳ kết nối SePay đang bật** (`loadSepayConnections`, so `safeEqual` từng khoá; kết nối `default` dự phòng `SEPAY_API_KEY`); log chỉ khớp vào tài khoản của kết nối đó (ingest UC-301) | 401 `{success:false}`; D1 lỗi khi đọc khoá → 503 | `src/routes/webhooks.ts`; `test/settings.test.ts` › "khoá kết nối SePay / Telegram › webhook dùng đúng khoá đặt ở màn Cài đặt; xoá khoá thì webhook khoá lại"; `test/webhooks.test.ts` › "nhiều kết nối SePay — cùng một địa chỉ webhook, mỗi kết nối một khoá (ADR-75) › khoá của mỗi kết nối đang bật đều vào được; khoá lạ hay khoá của kết nối đã tắt bị từ chối" |
| `POST /webhooks/zalo` | Header `X-Bot-Api-Secret-Token` so `safeEqual` với `zalo_webhook_secret` (config, dự phòng `ZALO_WEBHOOK_SECRET`); chưa đặt khoá → khoá hẳn. Sau xác thực luôn 200 `{ok:true}` (notify UC-411) | 401 `{ok:false}`; D1 lỗi khi đọc khoá → 503 | `src/routes/webhooks.ts`; `test/zalo.test.ts` › "webhook Zalo › thiếu hoặc sai khoá X-Bot-Api-Secret-Token → 401; chưa đặt khoá webhook → khoá hẳn" |
| `ALL /mcp` (đúng đường này) | `Authorization: Bearer <token OAuth>` do resource server kiểm (KV `OAUTH_KV`); grant còn hợp lệ: người còn `active`, `session_gen` khớp, uỷ quyền bằng mật khẩu chung thì dấu `APP_PASSWORD` khớp (ADR-98). Cần `mcp:read`; tool ghi cần thêm `mcp:write`. Tool nhìn / ghi như người đã uỷ quyền | 401 + `WWW-Authenticate: Bearer resource_metadata=…` (grant lệch thì bị thu hồi); thiếu quyền → 403 `insufficient_scope` | `src/oauth/server.ts`, `src/routes/mcp.ts`; `test/mcp-oauth.test.ts`; xem `specs/mcp/` UC-601 |
| `/mcp/<bất kỳ>` (đường dẫn chứa khoá cũ) | Không có route | 404 JSON như đường không có | `src/index.ts` › `app.notFound`; `test/mcp-oauth.test.ts` › "UC-601 AC-8: endpoint /mcp, metadata, chỉ CIMD › đường dẫn chứa khoá cũ /mcp/<bất kỳ> → 404 như đường không có; /oauth/, /.well-known/ lạ cũng là 404 JSON" |
| `GET/POST /oauth/authorize` | Công khai; form đăng nhập dùng luật UC-501 (`checkLogin`: chặn dò scope `login`, mật khẩu riêng / chung) hoặc cookie `pf_session` sẵn có; chỉ sau khi đăng nhập mới ghi KV; form đồng ý gắn cookie trình duyệt | 401 / 429 / 409 (chưa thiết lập) dạng trang HTML; yêu cầu sai → trang lỗi, không chuyển hướng | `src/oauth/routes.ts`; `test/mcp-oauth.test.ts` (UC-601 AC-9) |
| `POST /oauth/token`, `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource/mcp` | Công khai (chuẩn OAuth 2.1 / MCP): đổi mã lấy token cần PKCE; metadata theo origin; chỉ đăng ký client bằng Client ID Metadata Document, không có `/oauth/register` | Lỗi OAuth chuẩn (400 / 401) | `src/oauth/server.ts`, `src/oauth/routes.ts`; `test/mcp-oauth.test.ts` (UC-601 AC-8) |
| Mọi đường dẫn khác (`/`, màn PWA, file tĩnh, `/oauth.css`) | Không xác thực — Static Assets, SPA fallback | — | `wrangler.jsonc` `assets.run_worker_first: ["/v1/*", "/webhooks/*", "/mcp", "/mcp/*", "/oauth/*", "/.well-known/*"]`; `app.notFound` trong `src/index.ts` |
| Cron (`scheduled`) | Không qua HTTP; Cloudflare gọi theo `triggers.crons` | — | `src/index.ts` `export default.scheduled`; `wrangler.jsonc` |

Bất biến chung: API_TOKEN / APP_PASSWORD / khoá webhook rỗng ⇒ cửa tương ứng **đóng**, không bao giờ "mở cho chuỗi rỗng" (`requireAuth`, `readSession`, `checkLogin`, `webhooks.post`; `APP_PASSWORD` rỗng thì kết nối Claude uỷ quyền bằng mật khẩu chung cũng không qua). `/mcp` không có token OAuth hợp lệ ⇒ 401, không bao giờ trả dữ liệu.

## Use case

| ID | Tên | Status | BR |
|---|---|---|---|
| [UC-501](UC-501-dang-nhap-mat-khau-chung.md) | Đăng nhập bằng mật khẩu chung (hoặc mật khẩu riêng) + chọn người | implemented | BR-09 |
| [UC-502](UC-502-goi-api-bang-token.md) | Gọi API bằng Bearer `API_TOKEN` | implemented | BR-09, BR-05 |
| [UC-503](UC-503-phan-quyen-theo-duong-dan.md) | Phân quyền theo đường dẫn & không lộ bí mật qua lỗi | implemented | BR-09, BR-10 |
| [UC-504](UC-504-an-lich-su-vi-private.md) | Ẩn lịch sự số dư ví `private` | implemented | BR-01, BR-09 |
| [UC-505](UC-505-xem-cau-hinh.md) | Xem toàn bộ cấu hình (màn Cài đặt) | implemented | BR-08, BR-09 |
| [UC-506](UC-506-cau-hinh-tai-khoan-vi-luat-nap.md) | Cấu hình tài khoản, ví & luật nạp | implemented | BR-08, BR-02, BR-04 |
| [UC-507](UC-507-cau-hinh-thanh-vien-ma-tham-so.md) | Cấu hình thành viên, mã chuyển khoản, tham số, giờ nhắc | implemented | BR-08, BR-02, BR-06 |
| [UC-508](UC-508-quan-ly-khoa-ket-noi.md) | Quản lý kết nối SePay, khoá Telegram, Zalo & gửi thử | implemented | BR-08, BR-09, BR-03, BR-06 |
| [UC-509](UC-509-kiem-tra-song.md) | Kiểm tra sống (health) | implemented | BR-10 |
| [UC-510](UC-510-thiet-lap-nha-lan-dau.md) | Thiết lập nhà lần đầu | implemented | BR-08, BR-09 |

Entity model: [entities.md](entities.md).

## Code sở hữu
- `src/index.ts` (mount, `onError`, `notFound`), `src/env.d.ts`
- `src/routes/auth.ts`, `src/routes/session.ts`, `src/routes/setup.ts`, `src/routes/settings.ts` (kể cả `/v1/settings/mcp`), `src/routes/health.ts`
- `src/services/settings.ts`, `src/services/secrets.ts`, `src/services/setup.ts`, `src/services/passwords.ts`, `src/services/member-login.ts` (luật đăng nhập dùng chung cho màn đăng nhập và trang uỷ quyền Claude)
- `wrangler.jsonc` (routes, assets, bindings), `.dev.vars.example`
- Test: `test/app.test.ts`, `test/settings.test.ts`, phần "đăng nhập" của `test/api.test.ts`, phần "mã nối Zalo" và "cài đặt Zalo" của `test/zalo.test.ts`, `test/setup.test.ts`, `test/login.test.ts`, `test/members.test.ts`, `test/migrations/setup-and-passwords.test.ts`, phần "UC-508: Cài đặt › Claude và ứng dụng AI" và "UC-503: header bảo mật trên đường OAuth / MCP" của `test/mcp-oauth.test.ts`
