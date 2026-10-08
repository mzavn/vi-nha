# 261007-thiet-lap-lan-dau: Thiết lập nhà lần đầu, thêm / tắt thành viên, mật khẩu riêng tuỳ chọn
- Status: archived
- BR: BR-08, BR-09
- Đụng tới: UC-501, UC-503, UC-504, UC-505, UC-507, UC-510 mới (access), UC-701, UC-709 (pwa)
- Đóng: [OPEN] của UC-501 "nếu `API_TOKEN` rỗng … `readSession` luôn trả `null`"; phần tạo / tắt thành viên của [OPEN] UC-507 "không có API tạo / tắt thành viên" (đổi vai vẫn mở)
- Người duyệt nghiệp vụ: chủ nhà, 2026-10-07 / 08, chat (giao việc trực tiếp "làm đi nhé"; đã chốt mật khẩu chung + riêng, 6 người, 10% / 10%, cho tắt người còn tiền, 20.000 vòng) · Người duyệt kỹ thuật: reviewer agent, 2026-10-08, lần 2 duyệt sau khi sửa (UC-504 MODIFIED, tài khoản trùng mã, ví mặc định danh mục)
- Commit: propose `9ca2b6b` · code `1ed22e1` · merge `—`

## Vì sao

Bước 2 của việc mở mã nguồn (lộ trình: `plans/reports/researcher-261007-mo-ma-nguon.md` §3.1, §5, §7).

> "mục tiêu là tôi muốn opensource con này … làm sao cho dân nontech deploy nhanh + dễ dùng"
> "kiểu 2 vợ chồng tôi vẫn dùng chung mật khẩu giống nhau dc, k cần phải đổi, còn 1 số nhà thì thích riêng tư nên đổi ( chủ yếu là role con cái sau này )"

Hiện trạng (kiểm 2026-10-08):
- DB dựng từ `docs/schema.sql` (bản public sau này) không có thành viên nào → không đăng nhập được, không có đường nào tạo nhà ngoài sửa SQL.
- Không thêm / tắt được thành viên: chỉ có `PATCH /v1/settings/members/:id`, không sửa được `active` (UC-507 bước 1). Nhà 1 người hay 3–4 người phải sửa SQL — trái BR-08.
- Đăng nhập cần hai khoá đặt tay: khoá ký phiên lấy từ `API_TOKEN` + `APP_PASSWORD` (`src/routes/auth.ts:28`); thiếu `API_TOKEN` thì đăng nhập "thành công" nhưng phiên không bao giờ hợp lệ (`auth.ts:57`). Một mật khẩu chung cho mọi người (`src/routes/session.ts:36`).

Quyết định chủ nhà (2026-10-07 / 08): mật khẩu chung + mật khẩu riêng tuỳ chọn, nhà mình không phải đổi gì; tối đa 6 người ngang quyền, vai `teen` để sau; mẫu ví Tích sản 10%, Thuế 10%; cho tắt người còn tiền trong ví cá nhân; băm mật khẩu riêng PBKDF2-SHA256 **20.000 vòng** (đo trên Cloudflare Free 2026-10-08: 20.000 ≈ 5 ms CPU, 50.000 ≈ 10,4 ms, 100.000 ≈ 20,5 ms).

## Thay đổi spec

### UC-510 (mới, access): Thiết lập nhà lần đầu
- AC-1: Given DB chỉ có `docs/schema.sql` (không hộ mẫu), When `GET /v1/setup` (không cần đăng nhập), Then 200 `{ needed: true }`; DB có `config.setup_done` → `{ needed: false }`. Không trả gì khác.
- AC-2: Given chưa thiết lập, When `POST /v1/setup` sai mật khẩu chung, **hoặc `APP_PASSWORD` chưa đặt / rỗng (bất kể body)**, Then 401 `wrong_password`, tính một lần sai vào bộ chặn dò đăng nhập (ADR-89, scope `login`, cùng ngưỡng), không tạo gì; đang bị chặn → 429 kiểm trước khi so, như đăng nhập.
- Body `POST /v1/setup`: `{ password, members: [{ name, password? }], accounts: [{ name, kind: bank|cash|ewallet|credit, bank?, owner: <chỉ số trong members> | null }], template: { taxable: boolean, must: ["food" | "housing" | "transport" | "utilities"] } }`.
- AC-3: Given chưa thiết lập, mật khẩu chung đúng, body hợp lệ, When `POST /v1/setup`, Then trong **một batch**: thành viên theo thứ tự gửi (người đầu `owner`, người sau `adult`; ai có `password` thì lưu băm), tài khoản, bộ ví mẫu (AC-6), `config.setup_done` = giờ UTC, nhật ký `setup.done`; 201 `{ member }` của chủ hộ kèm cookie phiên của chủ hộ (vào bằng mật khẩu riêng nếu chủ hộ có, không thì mật khẩu chung).
- AC-4: Given body lỗi — 0 hoặc hơn 6 thành viên; tên rỗng / dài hơn 40 ký tự / trùng nhau (không phân biệt hoa thường, bỏ dấu cách hai đầu) / hai tên ra cùng mã (mã sinh bằng bỏ dấu, ví dụ "Mẹ" và "Me"); không có tài khoản nào; `owner` ngoài khoảng chỉ số của `members`; tên tài khoản trùng hoặc ra cùng mã; `password` riêng ngắn hơn 8 ký tự — Then 400 `invalid_input` kèm `field` chỉ ô lỗi, không tạo gì.
- AC-5: Given đã thiết lập, When `POST /v1/setup` (kể cả mật khẩu đúng, kể cả hai yêu cầu cùng lúc), Then chỉ một yêu cầu tạo được nhà (phát hiện bằng khoá chính `config.k` của dòng `setup_done` nằm trong cùng batch); yêu cầu còn lại 409 `already_setup`, không đổi gì, không lỗi 500.
- AC-6: Mẫu "Profit First cơ bản": ví Thu nhập (`holding`), Tích sản (`wealth_building`, luật nạp `percent` 10%), Thuế (`tax`, `percent` 10%) chỉ khi `taxable = true`, Có thì tốt (`must`, nhóm `have`, nhận phần dư), và các ví Must người dùng chọn trong {Ăn uống `food`, Nhà ở `housing`, Đi lại `transport`, Điện nước `utilities`} (`must`, nhóm `must`, chưa có số nạp). Mã ví: `income`, `wealth-building`, `tax`, `nice-to-have` và mã như trên. **Danh mục chi mẫu** (mã tiếng Anh, tên tiếng Việt, có `icon`): theo ví Must đã chọn — `food`: Đi chợ / nấu ăn `groceries`, Ăn ngoài `eating-out`; `housing`: Nhà ở `housing`; `transport`: Xăng xe / gửi xe `fuel-parking`, Grab / taxi `ride-hailing`; `utilities`: Điện nước mạng `utilities`; luôn có: Mua sắm `shopping`, Y tế `health`, Trả nợ `debt-payment`, Cho vay / trả hộ `lending` — cả bốn có ví mặc định là Có thì tốt `nice-to-have`. Danh mục theo ví Must có ví mặc định là đúng ví đó. Sau thiết lập ghi được khoản chi ngay (nhập nhanh UC-703). Mọi ví trú ở tài khoản ngân hàng đầu tiên trong danh sách (không có ngân hàng thì tài khoản đầu tiên). Chia thử một khoản thu 10.000.000 ngay sau thiết lập: Tích sản 1.000.000, Thuế 1.000.000 (khi có), Có thì tốt nhận phần còn lại.
- AC-7: Given chưa thiết lập, When `POST /v1/session` hoặc gọi `/v1/*` cần đăng nhập, Then 409 `setup_required` (đăng nhập) / 401 như hiện nay (API khác). Cron, MCP, REST bằng token chạy không lỗi khi chưa có thành viên (kiểm 2026-10-08: các khoá config đều có mặc định).
- Nhật ký `setup.done` ghi người làm là chủ hộ vừa tạo, `via = session`.
- AC-8: Given DB đã có ít nhất một thành viên (prod nhà mình), When chạy migration của change này, Then ghi `setup_done` (INSERT OR IGNORE — chạy lại không lỗi); `GET /v1/setup` → `{ needed: false }`; ngoài `schema_version` và hai cột mới (`password_hash` NULL, `session_gen` 0), không dòng nào đổi.

### UC-501 (access): Đăng nhập
- MODIFIED: một **mật khẩu chung** cho cả nhà (`APP_PASSWORD`, ô bắt buộc duy nhất lúc deploy) + **mật khẩu riêng tuỳ chọn** cho từng người. Preconditions bỏ "`API_TOKEN` đã đặt"; E4 "đổi `API_TOKEN` → phiên không hợp lệ" thành DEPRECATED (đổi `API_TOKEN` không còn đụng phiên).
- MODIFIED Main Flow: thứ tự kiểm khi `POST /v1/session` — (1) đang bị chặn → 429; (2) chưa thiết lập → 409 `setup_required`; (3) tìm người `active` theo `member_id`: có `password_hash` → chỉ so băm; không có người / không có băm → so với mật khẩu chung (giữ E2/AC-5: sai mật khẩu → 401 trước, đúng mật khẩu chung mà người lạ → 400); (4) đúng thì `clearFailures`, sai thì ghi một lần sai. Người không có mật khẩu riêng vẫn chạy một phép băm giả cùng số vòng, để thời gian trả lời không lộ ai có mật khẩu riêng.
- ADDED AC-12: Given người chưa có mật khẩu riêng, When `POST /v1/session { member_id, password = mật khẩu chung }`, Then đăng nhập được như hiện nay.
- ADDED AC-13: Given người đã có mật khẩu riêng, When đăng nhập bằng mật khẩu chung, Then 401 `wrong_password`; bằng đúng mật khẩu riêng → đăng nhập được. Sai lần nào cũng tính vào bộ chặn dò. Thông báo lỗi không cho biết người đó có mật khẩu riêng hay không.
- ADDED AC-14: Given chưa đặt `API_TOKEN`, When đăng nhập đúng, Then phiên dùng được (hôm nay: không). Khoá ký phiên là khoá ngẫu nhiên app tự sinh lần đầu (INSERT OR IGNORE rồi đọc lại — hai lần đăng nhập đầu cùng lúc dùng cùng một khoá), lưu trong D1, không bao giờ trả ra ngoài. `API_TOKEN` không đặt thì REST bằng token vẫn bị khoá (UC-502 không đổi).
- ADDED AC-15: Given phiên vào bằng mật khẩu chung, When đổi `APP_PASSWORD`, Then phiên đó hết hiệu lực; phiên vào bằng mật khẩu riêng vẫn dùng được. Cơ chế: phiên chung ký bằng khoá trộn `session_key` + `APP_PASSWORD` (như hôm nay trộn vào khoá), phiên riêng ký bằng `session_key`; cookie chỉ mang cờ chung / riêng và `session_gen` — **không bao giờ** mang băm của mật khẩu. Cookie chung của người đã có mật khẩu riêng bị từ chối. "Đăng xuất mọi máy" vẫn đăng xuất mọi phiên (AC hiện hành).
- Hệ quả một lần: deploy bản này → mọi máy đăng nhập lại một lần (khoá ký đổi).

### UC-507 (access): Thành viên
- ADDED AC-11: `POST /v1/settings/members { name, password? }` → 201 thành viên `adult`, `active`, mã sinh từ tên như tài khoản / ví; trùng tên **hoặc trùng mã** với bất kỳ thành viên nào (kể cả đã tắt) → 409 `duplicate`; đã có 6 người đang hoạt động → 409 `too_many_members`; nhật ký `member.create`, báo cả nhà (như đổi kênh, ADR-90). Có `password` (≥ 8 ký tự) thì người mới vào bằng mật khẩu riêng ngay, không đi qua mật khẩu chung.
- ADDED AC-12: `PATCH /v1/settings/members/:id { active: false }` → người đó biến khỏi `GET /v1/session/members`, mọi phiên của họ hết hiệu lực ngay (kể cả máy đang mở; `session_gen` tăng), ví / tài khoản / giao dịch của họ giữ nguyên; **ví `private` của người đã tắt không còn bị ẩn** với người khác (chủ hộ thấy và chuyển tiền ra được — chủ nhà: "tiền vẫn nằm trong ví, chủ hộ thấy"). Tắt chủ hộ → 409 `owner_required` (kể cả qua token không kèm `X-Member-Id`); tắt chính mình → được, phản hồi xoá cookie, PWA về màn đăng nhập. `active: true` bật lại (tính vào giới hạn 6). Nhật ký `member.deactivate` / `member.activate`, báo cả nhà.
- ADDED AC-13: Đặt / đổi / gỡ mật khẩu riêng — `PUT /v1/settings/members/:id/password { current?, household_password?, password | null }`:
  - Đang bị chặn dò → 429, kiểm trước khi so.
  - `household_password` đúng (mật khẩu chung) → được đổi / gỡ cho **bất kỳ ai** kể cả chính mình và chủ hộ quên mật khẩu — "ai biết mật khẩu chung là người lớn của nhà". Gọi bằng token REST thì luôn phải có `household_password`.
  - `current` chỉ dùng khi `:id` là chính người của phiên cookie: phải là mật khẩu đang dùng để vào tên đó (riêng nếu có, không thì chung). Gửi cả hai thì `household_password` được xét trước.
  - `password` ≥ 8 ký tự → lưu băm; `null` → gỡ, người đó quay lại dùng mật khẩu chung; `null` khi người đó chưa có mật khẩu riêng → 200, không đổi gì, không tăng `session_gen`.
  - Sai `current` / `household_password` → 401 `wrong_password`, tính vào bộ chặn dò (scope `login`). Xong: `session_gen` của người đó tăng → mọi phiên của họ hết hiệu lực; nếu người đổi là chính họ thì phản hồi cấp cookie mới đúng cách vào mới (riêng khi vừa đặt, chung khi vừa gỡ); nhật ký `member.password` (không ghi mật khẩu); đổi cho người khác thì báo cả nhà.
- ADDED AC-14: `GET /v1/settings` (UC-505) trả mỗi thành viên `has_password: boolean`, **không bao giờ** trả băm, muối hay số vòng.
- MODIFIED bước 1: "Không sửa được `id`, `role`, `active`" → "Không sửa được `id`, `role`; `active` theo AC-12".

### UC-504 (access): Ẩn lịch sự ví `private`
- MODIFIED bước 2: ví bị ẩn với người xem khi `private` **và chủ ví còn hoạt động** và chủ ví ≠ người xem.
- ADDED AC: Given ví `private` của X có số dư, When tắt X rồi người khác gọi `/v1/snapshot`, `/v1/budget`, `/v1/bootstrap`, Then thấy số của ví đó; When bật lại X, Then ví lại bị ẩn với người khác như cũ.

### UC-503 (access): Phân quyền theo đường dẫn
- MODIFIED bước 1: `GET` / `POST /v1/setup` gắn trước `requireAuth`, như `/v1/session`.

### UC-701 (pwa): Đăng nhập
- ADDED AC-8: Given `GET /v1/setup` → `needed: true`, When mở app, Then hiện màn **Thiết lập** thay màn đăng nhập, bốn bước: Mật khẩu chung → Thành viên (1–6, mỗi người tuỳ chọn mật khẩu riêng) → Tài khoản → Ví theo mẫu (có thu nhập phải tự nộp thuế không; chọn ví Must); xong vào thẳng Hôm nay. Lỗi từ server hiện đúng ô (`field`). Không gọi được `GET /v1/setup` (mất mạng) → màn đăng nhập như hiện nay (đăng nhập cũng cần mạng). Mobile 390px, chạm ≥ 44px (`docs/DESIGN.md`).
- ADDED AC-9: Màn đăng nhập không đổi với người dùng: chọn tên, nhập mật khẩu (chung hoặc riêng — app không nói người đó dùng loại nào).

### UC-709 (pwa): Cài đặt › Thành viên
- ADDED: nút **Thêm người**; mỗi người: **Tắt / Bật lại**, **Đặt mật khẩu riêng / Đổi / Gỡ** (hỏi mật khẩu hiện tại khi đổi của mình, hỏi mật khẩu chung khi đổi của người khác); dòng nhỏ "dùng mật khẩu riêng" / "dùng mật khẩu chung". Câu "cả hai người", "hai vợ chồng" → "cả nhà" (`settings-sheets.tsx`, `wallets.tsx`).

### Entity
- `members.password_hash` (mới, NULL được): `pbkdf2-sha256$<vòng>$<muối base64url>$<băm base64url>`; NULL = dùng mật khẩu chung. Vòng mặc định 20.000; số vòng nằm trong chuỗi nên tăng sau không cần migration.
- `members.session_gen` (mới, số nguyên, mặc định 0): tăng khi đổi / gỡ mật khẩu riêng, khi tắt người → mọi cookie cũ của người đó hết hiệu lực.
- `config.setup_done`: thời điểm thiết lập xong (UTC ISO); ghi một lần.
- `config.secret:session_key`: 32 byte ngẫu nhiên, sinh lần đầu cần ký phiên.
- Cookie phiên: `member_id` đứng đầu (như hiện nay), thêm cờ chung / riêng và `session_gen`, các phần mới không chứa dấu chấm; không mang băm mật khẩu (UC-501 AC-15).
- Cập nhật `specs/access/entities.md`: Session (định dạng cookie, khoá ký), InfraCredential (`API_TOKEN` không còn là một phần khoá ký), Config (`setup_done`, `secret:session_key` — không API nào trả ra, như `secret:vapid_private_jwk`), AuditLog action (`setup.done`, `member.create`, `member.deactivate`, `member.activate`, `member.password`), Member (`password_hash`, `session_gen`; bỏ "không có API tạo thành viên").

## Quyết định

**ADR nháp — Đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn; khoá ký phiên trong D1** (chủ nhà chốt 2026-10-07 / 08).
- Loại: email (gửi mail từ Worker cần Workers Paid, Beta, domain riêng — [Cloudflare Email Service](https://developers.cloudflare.com/email-service/)); Google OAuth (người dùng phải tự tạo OAuth client); bắt mọi người đặt mật khẩu riêng (nhà mình muốn giữ mật khẩu chung); người đầu tiên mở link tự đặt mật khẩu (ai mở trước là chiếm được nhà) — vì vậy thiết lập lần đầu phải có mật khẩu chung từ lúc deploy.
- PBKDF2 20.000 vòng thấp hơn khuyến nghị OWASP (600.000); bù bằng chặn dò (ADR-89), băm chỉ nằm trong D1 riêng của nhà; số vòng lưu theo từng mật khẩu để tăng sau.
- Hệ quả: nhà mình không đổi gì ngoài đăng nhập lại một lần; vai `teen` giới hạn quyền làm ở change sau, dựa trên mật khẩu riêng.

**ADR nháp — Tối đa 6 người ngang quyền; tắt người không xoá dữ liệu.** Vai `teen` / `child` / `guest` có trong schema (`docs/schema.sql`) nhưng chưa có luật; để change sau.

## Thiết kế

- Migration `0030_setup_and_member_passwords.sql` (v1.29 → v1.30): `ALTER TABLE members ADD COLUMN password_hash TEXT`, `ADD COLUMN session_gen INTEGER NOT NULL DEFAULT 0`; `INSERT OR IGNORE INTO config (k, v) SELECT 'setup_done', strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE EXISTS (SELECT 1 FROM members)`; `schema_version = '1.30'`. Sao lưu D1 prod trước. `docs/schema.sql` v1.30; `docs/seed.sql` có `setup_done` (hộ mẫu đã thiết lập — không thì mọi test đăng nhập 409). Không cần chuyển config sang `docs/schema.sql`: kiểm 2026-10-08, mọi khoá config code đọc đều có mặc định.
- `src/services/passwords.ts`: băm / kiểm PBKDF2-SHA256 (20.000 vòng, muối 16 byte), so sánh thời gian hằng, băm giả cho người không có mật khẩu riêng.
- `src/routes/setup.ts`, `src/services/setup.ts`: setup tự dựng câu INSERT trong một `db.batch` (không gọi `createAccount` / `createWallet` vì hai hàm tự chạy batch riêng và `createWallet` không tạo được ví `holding` / phần dư). Tách phần kiểm dữ liệu dùng chung ra hàm thuần trong `src/services/settings.ts` (tên, loại, ngân hàng). Dòng `setup_done` INSERT trơn trong cùng batch → lỗi khoá chính `config.k` bắt thành 409. Giữ bất biến một ví Thu nhập / một Tích sản / một ví phần dư.
- `src/routes/auth.ts`: `sessionKey(db)` (INSERT OR IGNORE rồi đọc, đọc cùng `session_epoch` trong một câu), `sign` theo cách vào, `issueSession(c, memberId, mode, gen)`, `readSession` đọc `session_gen` + có `password_hash` cùng câu kiểm `active`. `src/routes/session.ts` theo thứ tự UC-501. `src/services/settings.ts` › `createMember`, `updateMember` (`active`), `setMemberPassword`; `src/routes/settings.ts` routes + nhật ký + báo cả nhà. Ví `private` của người đã tắt không ẩn: `src/domain/snapshot.ts` / `src/routes/v1.ts` điều kiện `hidden` thêm "chủ ví còn hoạt động". Bộ chặn dò dùng lại scope `login` (CHECK của `auth_failures.scope` không đổi).
- PWA: `web/src/screens/setup.tsx`; Cài đặt › Thành viên; câu chữ "cả nhà".
- Rủi ro: khoá ký đổi → cả nhà đăng nhập lại (báo trước); trang đăng nhập tốn thêm ~5 ms CPU mỗi lần (cả người không có mật khẩu riêng, vì băm giả). Test sẽ đổi: `test/app.test.ts` (health `v1.30`), test đăng nhập dựa vào `setup_done` trong seed; test giả cookie bằng cách thay `member_id` ở đầu cookie vẫn chạy nếu giữ `member_id` đứng đầu.

**AI làm / người quyết:** AI làm hết; chủ nhà đã chốt các luật quyền / bảo mật ở trên, duyệt AC.

## Review kỹ thuật
Reviewer agent (subagent `reviewer`, 2026-10-08), kết luận lần 1: chưa duyệt — 3 lỗ P1 + 6 mục P2. Đã sửa:
1. `APP_PASSWORD` rỗng thì `POST /v1/setup` luôn 401 (`safeEqual("", "")` = true) — AC-2.
2. Cookie không mang băm trơn của `APP_PASSWORD`; phiên chung trộn mật khẩu vào khoá ký như hôm nay — UC-501 AC-15.
3. Mẫu không có danh mục → không ghi được khoản chi (CHECK `spend` cần `category_id`) — AC-6 thêm danh mục mẫu + `debt-payment`, `lending`.
4. Cơ chế chống đua cho `setup_done` (khoá chính trong batch) và `session_key` (INSERT OR IGNORE rồi đọc).
5. Thứ tự kiểm khi đăng nhập; băm giả để không lộ ai có mật khẩu riêng.
6. Đổi mật khẩu: nhánh token, 429, `null` khi chưa có, cookie cấp lại đúng cách vào.
7. Mã thành viên trùng do bỏ dấu, trùng với người đã tắt.
8. MODIFIED UC-501 Preconditions / E4, UC-505 `has_password`, `entities.md`.
9. AC-8 với `schema_version`, migration chạy lại được.
Lần 2 (2026-10-08): 9 mục đã xử lý đúng; thêm MODIFIED UC-504 cho luật ví `private` của người đã tắt, tài khoản trùng mã, ví mặc định của danh mục mẫu, đóng một phần [OPEN] UC-507 — đã sửa.
Gợi ý đã nhận: ví `private` của người đã tắt; tự tắt mình xoá cookie; actor của `setup.done`; mất mạng ở màn Thiết lập; bỏ việc chuyển config sang schema; dùng lại scope `login`.

## Việc cần làm
- [x] Chủ nhà chốt % mẫu ví, tắt người còn tiền, số vòng băm (2026-10-07 / 08)
- [x] Review kỹ thuật (2 lần); commit propose
- [x] Test cho từng AC → code → xanh (`1ed22e1`; server viết code trước rồi mới viết test, không theo thứ tự đỏ → xanh); xem màn Thiết lập và Cài đặt › Thành viên ở 390px (server giả)
- [x] Sao lưu D1 → migrate → deploy (2026-10-08 07:03, version `7051978f`; kiểm: health `v1.30`, `GET /v1/setup` → `needed: false`, đăng nhập mật khẩu chung 200, `has_password` false cho cả hai, không lộ băm) → cả nhà đăng nhập lại
- [x] Hợp nhất: UC chính + `## History`, ADR-95, ADR-96 vào `decisions.md`; UC-510 mới; đóng [OPEN] của UC-501 và phần tạo / tắt của [OPEN] UC-507
- [x] `specs:gen`, `specs:check` 0 lỗi; archive
- [x] Cập nhật tài liệu: README (secret bắt buộc duy nhất `APP_PASSWORD`, màn Thiết lập); GitBook: trang Thiết lập lần đầu, Thành viên và mật khẩu, đăng nhập, bảo mật, lỗi thường gặp; chụp lại ảnh đăng nhập + thành viên (docs repo `ae3651a`)
