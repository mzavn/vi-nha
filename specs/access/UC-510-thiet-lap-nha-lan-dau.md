# UC-510: Thiết lập nhà lần đầu
- Status: implemented
- BR: BR-08, BR-09
- Decisions: ADR-95 (mật khẩu chung là ô bắt buộc duy nhất lúc deploy, chặn ai mở link trước chiếm nhà; mật khẩu riêng tuỳ chọn); ADR-96 (tối đa 6 người ngang quyền); ADR-89 (bộ chặn dò đăng nhập, scope `login`); ADR-94 (mã hệ thống `debt-payment`, `lending`)
- Actor: người dựng app cho nhà mình (biết mật khẩu chung `APP_PASSWORD` đặt lúc deploy), qua PWA màn **Thiết lập** (pwa [UC-701](../pwa/UC-701-dang-nhap-dang-xuat-doi-nguoi.md) AC-8)
- Trigger: mở app trên DB mới (chỉ có `docs/schema.sql`, chưa có thành viên): PWA gọi `GET /v1/setup`, rồi `POST /v1/setup`

## History
- v1 (2026-10-08, commit `1ed22e1`): khởi tạo — thiết lập nhà lần đầu cho người dựng app không biết SQL (bước 2 của việc mở mã nguồn): mật khẩu chung → thành viên (1–6, mật khẩu riêng tuỳ chọn) → tài khoản → bộ ví mẫu "Profit First cơ bản"; migration 0030 (schema v1.30) đánh dấu nhà đã có thành viên là đã thiết lập (change [261007-thiet-lap-lan-dau](../changes/archive/261007-thiet-lap-lan-dau/proposal.md))

## Preconditions
- `APP_PASSWORD` đã đặt (`wrangler secret`) — ô bắt buộc duy nhất lúc deploy. Không cần `API_TOKEN` (UC-501 AC-14).
- Nhà **chưa** thiết lập: `config` không có dòng `setup_done`.

## Main Flow
1. PWA hỏi nhà đã thiết lập chưa (`GET /v1/setup`, không cần đăng nhập) → `{ needed: true }` thì hiện màn Thiết lập thay màn đăng nhập. Không trả gì khác.
2. Người dựng app nhập **mật khẩu chung**, danh sách **thành viên** (1–6 người; người đầu là chủ hộ; mỗi người tuỳ chọn mật khẩu riêng ≥ 8 ký tự), các **tài khoản** (ngân hàng, tiền mặt, ví điện tử, thẻ tín dụng; của một người hoặc chung) và trả lời câu **có thu nhập phải tự nộp thuế** + chọn các **ví Must** (Ăn uống, Nhà ở, Đi lại, Điện nước).
3. Server kiểm theo thứ tự: đang bị chặn dò đăng nhập → E1; đã thiết lập → E2; sai mật khẩu chung (hoặc `APP_PASSWORD` chưa đặt / rỗng) → E3; dữ liệu lỗi → E4.
4. Server tạo nhà trong **một lần ghi** (một `db.batch`): thành viên theo thứ tự gửi (người đầu `owner`, người sau `adult`; ai có mật khẩu riêng thì lưu băm), tài khoản (`opened_at` = hôm nay; thẻ tín dụng không tính vào tiền chi được), bộ ví mẫu (bước 5), danh mục mẫu, dòng `setup_done` = giờ UTC, nhật ký `setup.done` (người làm = chủ hộ vừa tạo, `via = session`).
5. Bộ ví mẫu "Profit First cơ bản" (mọi ví trú ở tài khoản ngân hàng đầu tiên, không có thì tài khoản đầu tiên):
   - Thu nhập `income` (`holding`); Tích sản `wealth-building` (`wealth_building`, luật nạp `percent` 10%); Thuế `tax` (`tax`, `percent` 10%) chỉ khi có thu nhập tự nộp thuế; Có thì tốt `nice-to-have` (`must`, nhóm `have`, nhận phần dư).
   - Ví Must đã chọn (`must`, nhóm `must`, chưa có số nạp): Ăn uống `food`, Nhà ở `housing`, Đi lại `transport`, Điện nước `utilities`.
   - Danh mục chi mẫu (mã tiếng Anh, tên tiếng Việt, có `icon`), ví mặc định là ví Must tương ứng: `food` → Đi chợ / nấu ăn `groceries`, Ăn ngoài `eating-out`; `housing` → Nhà ở `housing`; `transport` → Xăng xe / gửi xe `fuel-parking`, Grab / taxi `ride-hailing`; `utilities` → Điện nước mạng `utilities`. Luôn có (ví mặc định Có thì tốt): Y tế `health`, Cho vay / trả hộ `lending`, Trả nợ `debt-payment` (hai mã hệ thống — ADR-94), Mua sắm `shopping`.
6. Trả `201 { member }` của chủ hộ kèm cookie phiên của chủ hộ (vào bằng mật khẩu riêng nếu chủ hộ có, không thì mật khẩu chung). PWA vào thẳng Hôm nay.

## Alternative Flows
- 1a. Nhà đã thiết lập (`{ needed: false }`) hoặc không hỏi được (mất mạng, server lỗi) → màn đăng nhập như thường (UC-501).
- 1b. Chưa thiết lập mà ai đó gọi `POST /v1/session` → `409 setup_required` (UC-501 E8); các `/v1/*` cần đăng nhập → 401 như thường. Cron, MCP, REST bằng token chạy không lỗi khi chưa có thành viên (mọi khoá `config` code đọc đều có mặc định).
- 4a. Nhà đã có thành viên trước khi có tính năng này (prod) → migration 0030 ghi sẵn `setup_done` (không ghi đè nếu đã có); không dòng nào khác đổi.

## Exceptions
- E1. Đang bị chặn dò (ADR-89, scope `login`, cùng ngưỡng với đăng nhập) → `429 too_many_attempts`, kiểm **trước** khi so mật khẩu, không tạo gì.
- E2. Đã thiết lập (kể cả do một yêu cầu khác chạy cùng lúc vừa xong — phát hiện bằng khoá chính `config.k` của dòng `setup_done` trong cùng batch) → `409 already_setup` "Nhà đã thiết lập rồi — đăng nhập để dùng.", không đổi gì, không lỗi 500.
- E3. Sai mật khẩu chung, hoặc `APP_PASSWORD` chưa đặt / rỗng (bất kể body) → `401 wrong_password` (`field = password`), tính một lần sai vào bộ chặn dò, không tạo gì.
- E4. Dữ liệu lỗi → `400 invalid_input` kèm `field` chỉ ô lỗi (`members`, `members.N.name`, `members.N.password`, `accounts`, `accounts.N.name|kind|bank|owner`, `template`, `template.taxable`, `template.must`), không tạo gì: 0 hoặc hơn 6 thành viên; tên rỗng / dài hơn 40 ký tự / trùng nhau (không phân biệt hoa thường, bỏ dấu cách hai đầu) / hai tên ra cùng mã (vd "Mẹ" và "Me"); mật khẩu riêng ngắn hơn 8 ký tự; không có tài khoản (tối đa 20); tên tài khoản rỗng / trùng / ra cùng mã; loại tài khoản lạ; ngân hàng ngoài danh mục; `owner` ngoài khoảng chỉ số của `members`; ví Must ngoài danh sách hoặc trùng.

## Postconditions
- Có 1–6 thành viên (một chủ hộ), các tài khoản, bộ ví mẫu với đúng một ví Thu nhập, một Tích sản, một ví nhận phần dư; danh mục đủ để ghi khoản chi ngay; `config.setup_done`; người dựng app đang đăng nhập là chủ hộ.

## Acceptance Criteria

### AC-1: Hỏi đã thiết lập chưa, không cần đăng nhập
- Given DB chỉ có `docs/schema.sql` (không hộ mẫu)
- When `GET /v1/setup` không cookie / token; rồi sau khi có `config.setup_done`
- Then 200 `{ needed: true }`; rồi `{ needed: false }` — không trả gì khác
- Tests: [`test/setup.test.ts`](../../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-1: GET /v1/setup không cần đăng nhập — DB chỉ có schema → needed true; có setup_done → needed false, không trả gì khác"; PWA: [`web/src/lib/setup.test.ts`](../../web/src/lib/setup.test.ts) › "UC-701 AC-8: mở app hỏi GET /v1/setup › needed: true → màn Thiết lập; needed: false → màn đăng nhập"

### AC-2: Sai mật khẩu chung hay chưa đặt mật khẩu chung thì không tạo được nhà
- Given chưa thiết lập
- When `POST /v1/setup` sai mật khẩu chung; khi `APP_PASSWORD` chưa đặt hoặc rỗng (kể cả gửi mật khẩu rỗng); khi IP đang bị chặn dò (kể cả mật khẩu đúng)
- Then 401 `wrong_password`, đếm một lần sai (scope `login`), không tạo gì; 401 bất kể body; 429 kiểm trước khi so, không tạo gì
- Tests: [`test/setup.test.ts`](../../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-2: sai mật khẩu chung › sai mật khẩu chung → 401 wrong_password, tính một lần sai vào bộ chặn dò, không tạo gì" · "… › APP_PASSWORD chưa đặt hoặc rỗng → luôn 401, bất kể body (kể cả mật khẩu rỗng)" · "… › đang bị chặn dò → 429 kiểm trước khi so, kể cả mật khẩu đúng; không tạo gì"

### AC-3: Đúng mật khẩu, dữ liệu hợp lệ → tạo nhà trong một lần ghi, chủ hộ được đăng nhập
- Given chưa thiết lập, mật khẩu chung đúng; hai người (chủ hộ có / không có mật khẩu riêng), tài khoản ngân hàng + tiền mặt
- When `POST /v1/setup`
- Then 201 `{ member }` chủ hộ + cookie của chủ hộ (`p` nếu chủ hộ có mật khẩu riêng, không thì `h`); thành viên theo thứ tự gửi (người đầu `owner`, sau `adult`), mật khẩu riêng lưu băm, tài khoản, `setup_done`, nhật ký `setup.done` người làm là chủ hộ; người sau đăng nhập được bằng mật khẩu chung
- Tests: [`test/setup.test.ts`](../../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-3: đúng mật khẩu, body hợp lệ → 201 chủ hộ + cookie của chủ hộ; thành viên theo thứ tự, mật khẩu riêng lưu băm, tài khoản, setup_done, nhật ký setup.done" · "UC-510 thiết lập nhà lần đầu › AC-3: chủ hộ không có mật khẩu riêng → cookie vào bằng mật khẩu chung; người sau đăng nhập bằng mật khẩu chung"

### AC-4: Dữ liệu lỗi → 400 kèm ô lỗi, không tạo gì
- Given chưa thiết lập, mật khẩu chung đúng
- When gửi từng trường hợp lỗi của E4
- Then 400 `invalid_input` kèm `field` đúng ô; DB không đổi. Phía app kiểm trước từng bước khi bấm Tiếp và chỉ dựng thân khi mọi bước hợp lệ
- Tests: [`test/setup.test.ts`](../../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-4: body lỗi → 400 invalid_input kèm field, không tạo gì › 0 thành viên" · "… › hơn 6 thành viên" · "… › thiếu members" · "… › tên rỗng" · "… › tên dài hơn 40 ký tự" · "… › tên trùng (không phân biệt hoa thường, bỏ dấu cách hai đầu)" · "… › hai tên ra cùng mã (Mẹ / Me)" · "… › mật khẩu riêng ngắn hơn 8 ký tự" · "… › không có tài khoản" · "… › tên tài khoản rỗng" · "… › tên tài khoản trùng" · "… › tên tài khoản ra cùng mã" · "… › loại tài khoản lạ" · "… › ngân hàng ngoài danh mục" · "… › owner ngoài khoảng chỉ số" · "… › owner âm" · "… › ví Must ngoài danh sách" · "… › ví Must trùng"; phía app: [`web/src/lib/setup.test.ts`](../../web/src/lib/setup.test.ts) › "UC-510 AC-4 (phía app): kiểm từng bước trước khi bấm Tiếp › bước 1: phải nhập mật khẩu chung" · "… › bước 2: 1–6 người; tên 1–40 ký tự" · "… › bước 2: tên trùng không phân biệt hoa thường, bỏ dấu cách hai đầu, hoặc ra cùng mã (Mẹ / Me) — báo ở ô sau" · "… › bước 2: mật khẩu riêng để trống được, có thì ít nhất 8 ký tự" · "… › bước 3: ít nhất một tài khoản; tên bắt buộc, không trùng (kể cả cùng mã); người giữ phải là một người ở bước 2" · "… › bước 4: phải trả lời câu thu nhập tự nộp thuế"; [`web/src/lib/setup.test.ts`](../../web/src/lib/setup.test.ts) › "UC-510: thân POST /v1/setup › đúng hình dạng: tên đã cắt khoảng trắng, chỉ gửi mật khẩu riêng khi có, ngân hàng chỉ khi không phải tiền mặt, ví Must theo thứ tự cố định" · "… › còn lỗi ở bất kỳ bước nào thì không dựng thân"

### AC-5: Chỉ thiết lập được một lần, kể cả hai yêu cầu cùng lúc
- Given đã thiết lập; hoặc hai `POST /v1/setup` hợp lệ cùng lúc
- When gửi lại (kể cả mật khẩu đúng)
- Then 409 `already_setup`, không đổi gì; hai yêu cầu cùng lúc: đúng một tạo được nhà, yêu cầu kia 409, không lỗi 500; batch vấp khoá chính của dòng `setup_done` thì cả batch huỷ
- Tests: [`test/setup.test.ts`](../../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-5: đã thiết lập › POST /v1/setup lần nữa (kể cả mật khẩu đúng) → 409 already_setup, không đổi gì" · "… › hai yêu cầu cùng lúc: chỉ một tạo được nhà, yêu cầu kia 409, không lỗi 500" · "… › batch vấp khoá chính của dòng setup_done (yêu cầu kia vừa xong) → 409 already_setup, cả batch huỷ"

### AC-6: Bộ ví mẫu "Profit First cơ bản" dùng được ngay
- Given thiết lập có thuế, chọn đủ bốn ví Must; hoặc không thuế, không ví Must, không tài khoản ngân hàng
- When đọc ví / luật nạp / danh mục; ghi một khoản chi; chia thử 10.000.000
- Then đủ ví theo bước 5, Tích sản và Thuế luật `percent` 10%, Có thì tốt nhận phần dư, danh mục có `icon`, mọi ví trú ở tài khoản ngân hàng đầu tiên; không thuế → không có ví Thuế, chỉ bốn danh mục luôn có, ví trú ở tài khoản đầu tiên; ghi được khoản chi ngay; chia thử: Tích sản 1.000.000, Thuế 1.000.000, Có thì tốt phần còn lại
- Tests: [`test/setup.test.ts`](../../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-6: mẫu Profit First cơ bản › có thuế, chọn đủ bốn ví Must: ví, luật nạp, danh mục có icon; mọi ví trú ở tài khoản ngân hàng đầu tiên" · "… › không có thuế, không chọn ví Must, không có tài khoản ngân hàng: không có ví Thuế, chỉ bốn danh mục luôn có, ví trú ở tài khoản đầu tiên" · "… › sau thiết lập ghi được khoản chi ngay; chia thử 10.000.000: Tích sản 1.000.000, Thuế 1.000.000, Có thì tốt nhận phần còn lại"

### AC-7: Chưa thiết lập thì không đăng nhập được, phần khác vẫn chạy
- Given chưa thiết lập
- When `POST /v1/session`; gọi `/v1/*` cần đăng nhập; đăng nhập khi IP đang bị chặn; REST bằng token, cron
- Then 409 `setup_required`; 401 như thường; 429 trước rồi mới tới 409; token và cron chạy không lỗi khi chưa có thành viên
- Tests: [`test/setup.test.ts`](../../test/setup.test.ts) › "UC-510 thiết lập nhà lần đầu › AC-7: chưa thiết lập › POST /v1/session → 409 setup_required; /v1/* cần đăng nhập → 401 như hiện nay" · "… › đăng nhập khi đang bị chặn dò vẫn 429 trước, rồi mới tới 409 setup_required" · "… › REST bằng token và cron chạy không lỗi khi chưa có thành viên"

### AC-8: Nhà đang dùng (đã có thành viên) không phải thiết lập lại
- Given DB đã có ít nhất một thành viên (prod); hoặc đã có `setup_done`; hoặc DB chưa có thành viên nào
- When chạy migration 0030 (kể cả chạy lại)
- Then ghi `setup_done`, `GET /v1/setup` → `{ needed: false }`; ngoài `schema_version` và hai cột mới (`password_hash` NULL, `session_gen` 0) không dòng nào đổi; đã có `setup_done` thì giữ nguyên, không lỗi; chưa có thành viên thì không ghi (vẫn cần thiết lập)
- Tests: test migration ở repo gốc

## Dependencies
- Upstream UC: —
- Downstream UC: UC-501 (đăng nhập sau khi thiết lập), UC-507 (thêm / tắt người, mật khẩu riêng về sau), UC-506 (sửa tài khoản, ví), pwa UC-701 (màn Thiết lập)
- External Systems: —

## Divergences & Open Questions
- [OPEN] Ví Must lúc thiết lập chưa có số nạp; người dùng phải tự vào Cài đặt › Ví & số tiền nạp đặt số (access UC-506). Chưa quyết có cần nhắc ở Hôm nay sau khi thiết lập không.
- [OPEN] Tài khoản tạo lúc thiết lập không nhận số dư đầu (`opening_balance` = 0, `opened_at` = hôm nay); màn Thiết lập dặn "Số dư, số tài khoản, nối SePay thêm sau ở Cài đặt" (access UC-506).

## Traceability
- Code: `src/routes/setup.ts` › `setupRoutes` (`GET /`, `POST /`); `src/services/setup.ts` › `isSetUp`, `alreadySetup`, `parseSetup`, `createHousehold`, `MUST_WALLETS`, `ALWAYS_CATEGORIES`; `src/services/settings.ts` › `memberName`, `memberPassword`, `nameKey`, `MAX_ACTIVE_MEMBERS`; `src/services/passwords.ts` › `householdPasswordOk`, `hashPassword`; `src/routes/auth.ts` › `loginBlocked`, `wrongPassword`, `passwordAccepted`, `issueSession`; `src/index.ts` (mount `/v1/setup` trước `requireAuth`; `onError` trả `field`)
- PWA: `web/src/screens/setup.tsx` › `Setup`; `web/src/lib/setup.ts` › `SETUP_STEPS`, `MUST_OPTIONS`, `emptySetup`, `setupNeeded`, `stepErrors`, `setupPayload`, `removeMember`, `stepOfField`, `setupServerError`; `web/src/state/store.ts` (phase `setup`, `completeSetup`)
- API: `GET /v1/setup` → `{ needed }`; `POST /v1/setup { password, members: [{ name, password? }], accounts: [{ name, kind: bank|cash|ewallet|credit, bank?, owner: <chỉ số> | null }], template: { taxable, must: [food|housing|transport|utilities] } }` (lỗi `too_many_attempts` 429, `already_setup` 409, `wrong_password` 401, `invalid_input` 400 + `field`)
- Dữ liệu: `migrations/0030_setup_and_member_passwords.sql` (`members.password_hash`, `members.session_gen`, `config.setup_done`, schema v1.30); `docs/schema.sql` v1.30; `docs/seed.sql` (hộ mẫu có `setup_done`)
