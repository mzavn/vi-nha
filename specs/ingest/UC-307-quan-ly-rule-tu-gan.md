# UC-307: Quản lý rule tự gán
- Status: implemented
- BR: BR-08, BR-02, BR-04
- Decisions: luật 6 (`docs/core_design_rules.md` §1 — máy chỉ đoán `spend`/`transfer`, `income` chỉ cho mẫu lương); `phase-04-ingest-sepay.md` §"Học từ hệ đang chạy" (giữ bộ mã `[QE]xx` + từ khoá của `MzaSepaySheetLib`), §"Rules — thứ tự khớp"; commit `c3ab508` (gộp khoảng trắng), `4b6d298` (route rule chỉ nhận đúng trường), `8c319c1` (rule rút từ lần gán); ADR-59 (mẫu lương gắn nguồn thu); ADR-60 (rule người thuê chỉ gợi ý); ADR-77 (rule gắn tài khoản, rule chuyển nội bộ tới tài khoản đầu kia kèm chuyển ví — chỉ migration tạo); ADR-82 (rule heo chuyển ví vào Tích sản — migration 0020)
- Actor: thành viên trong hộ (PWA/REST); tạo rule từ lần gán ở UC-305; sửa/tắt rule ở màn Cài đặt (access UC-507)
- Trigger: `GET /v1/rules`; `POST /v1/rules`; nội bộ `createRuleFromSplit`

## History
- v1 (2026-09-22, commit `c1a25c1`): engine thuần `matchRule` (`code` → `content` → `account`), `normalizeContent` (bỏ dấu, viết hoa), `extractCode`; seed `EXE`, `EMS`, `XANG`, `SHOPEE`, `LAZADA`, `TIKI` (migration 0004), không seed `QTT`.
- v2 (2026-09-22, commit `8c319c1`): `suggestRulePattern` cho rule sinh từ một lần gán.
- v3 (2026-09-22, commit `c3ab508`): `normalizeContent` gộp mọi chuỗi khoảng trắng/tab thành một dấu cách.
- v4 (2026-09-22, commit `4b6d298`): `POST /v1/rules` chỉ nhận và kiểm kiểu đúng các trường của rule.
- v5 (2026-10-01, commit `034b7ff`): `POST /v1/rules` nhận `tenant_id` (rule người thuê: chỉ `income`, lưu `is_salary=1`, không bao giờ tự gán — chỉ gợi ý ở màn Gán) và `income_stream_id` (nguồn thu gắn vào khoản thu tự ghi của mẫu lương) (change `261001-cho-thue-lai`).
- v6 (2026-10-03, commit `f74bc70`): bảng `rules` thêm `account_id` (rule chỉ áp cho log của tài khoản đó; NULL = mọi tài khoản), `counter_account_id` + `from_wallet_id` (rule `transfer` tới tài khoản đầu kia kèm chuyển ví) — schema v1.17, ADR-77. Migration 0017 seed rule heo đất (`CHUYEN TIEN LE LAM TRON` priority 10, `TIET KIEM TIEN LE` priority 11) cho mọi tài khoản MBBank `bank` đang dùng, không khóa, của người có tài khoản heo. `POST /v1/rules` và `create_rule` ở màn Gán **chưa** nhận ba cột này; `GET /v1/rules` trả chúng (`SELECT *`).
- v7 (2026-10-03, commit `c67420e`): migration 0019 (schema v1.19) seed thêm rule `content` `TICH LUY` (priority 12, `transfer`, cùng tài khoản đầu kia / ví như hai rule heo của 0017) cho mọi tài khoản MBBank `bank` đang dùng, không khóa, của người có heo — bắt nội dung MB tất toán sổ tích lũy về tài khoản ("Tat toan truoc han tien gui sotich luy …": gợi ý heo trả về, UC-305) và tự gửi thêm vào sổ tích lũy (tiền ra: bỏ heo, UC-303). Chỉ seed khi đã có heo; DB seed mẫu chỉ đổi `schema_version`.
- v8 (2026-10-03, commit `e00814c`): migration 0020 (schema v1.20, chỉ dữ liệu — ADR-82 "heo đất là Tích sản") đổi `wallet_id` của mọi rule đang trỏ `heo-dat` sang ví Tích sản đang dùng (`tier='tichsan'`, prod `tich-san`; prod: 9 rule heo), rồi tắt ví `heo-dat`; `from_wallet_id` giữ `co-thi-tot`. Không có ví Tích sản đang dùng → không đổi rule; DB seed mẫu chỉ đổi `schema_version`.
- v9 (2026-10-06, commit `9c265ee`): change [`261006-tai-khoan-phao`](../changes/archive/261006-tai-khoan-phao/proposal.md), ADR-88 — migration 0024 (schema v1.24): rule `transfer` mà cả tài khoản nguồn lẫn tài khoản đầu kia là tài khoản Tích sản (prod: ba rule heo của `mb-savings-wife`, nay là phao) bỏ `from_wallet_id` / `wallet_id` — tiền giữa hai tài khoản Tích sản đã là Tích sản, chỉ đổi chỗ. Rule `transfer` không mang ví sang tài khoản Tích sản thì tự gán vẫn chuyển ví Có thì tốt → Tích sản (UC-303 AC-22).

## Preconditions
- Đã đăng nhập.

## Main Flow
1. `GET /v1/rules` → mọi rule, sắp theo `priority`.
2. `POST /v1/rules` body `{match_type, pattern, meaning, priority?, is_salary?, wallet_id?, category_id?, by_member_id?, tenant_id?, income_stream_id?}`: chuỗi bắt buộc `match_type`, `pattern`, `meaning`; `priority` nếu có phải là số nguyên; `is_salary` chỉ `true` mới tính; `by_member_id` mặc định người đang đăng nhập; `tenant_id`, `income_stream_id` nếu có phải là chuỗi.
3. `createRule`: `match_type ∈ {code, content, account}`; `pattern` sau `trim` không rỗng; `meaning ∈ {spend, transfer, income}`; `income` bắt buộc `is_salary = true` **hoặc** có `tenant_id`; `priority` mặc định 100 → INSERT → trả 201 rule vừa tạo.
   - 3.1 Rule người thuê (`tenant_id`): `meaning` phải là `income`; người thuê phải có trong `tenants` (không xét `active`); lưu `is_salary = 1` (DB đòi mọi rule `income` có cờ này) nhưng **không bao giờ tự gán** — UC-303 lọc bỏ rule có `tenant_id` trước khi khớp; chỉ dùng để gợi ý "Thu từ <tên>" cho log `in` ở màn Gán (UC-305, ADR-60).
   - 3.2 `income_stream_id`: nguồn thu phải có trong `income_streams` (không xét `active`) và chỉ cho rule `income`. Mẫu lương mang nguồn → khoản thu tự ghi gắn nguồn đó và chia theo phần khóa của nguồn (UC-303, ADR-59). Sửa nguồn của rule có sẵn ở Cài đặt (access UC-507).
4. Rule có hiệu lực ngay cho log đến sau (UC-303 nạp rule `active` ở mỗi lần khớp); **không** áp ngược cho log đang chờ.

**Luật khớp (`matchRule`, dùng ở UC-303 và gợi ý UC-305)**
- Nội dung chuẩn hoá: NFD bỏ dấu, `đ`→`D`, viết hoa, gộp khoảng trắng, `trim`.
- Chỉ xét rule đủ điều kiện: `income` ⇔ log `in` và `is_salary`; `spend`/`transfer` ⇔ log `out`. Khi tự khớp (UC-303) rule mang `tenant_id` bị loại trước; khi gợi ý tiền vào (UC-305) xét rule mang `tenant_id`, rồi rule `transfer` có `counter_account_id` (coi như khớp tiền vào để gợi ý heo trả về). Ở cả hai nơi, rule có `account_id` chỉ được xét cho log của đúng tài khoản đó (ADR-77).
- Nhóm `code`: `ref_code` của log (viết hoa) **bằng** `pattern` (viết hoa) → thắng. Rồi nhóm `content`: nội dung chuẩn hoá **chứa** `pattern` viết hoa. Rồi nhóm `account`: cùng phép chứa. Trong mỗi nhóm, `priority` nhỏ trước; rule đầu tiên thắng.

## Alternative Flows
- 2a. Rule từ lần gán (UC-305 bước 8): `createRuleFromSplit` chỉ cho `spend`/`transfer` (`rule_meaning_restricted`), lấy `wallet_id`/`category_id` của split, `by_member_id` người gán, `priority` 100.

## Exceptions
- E1. Thiếu/sai kiểu trường → 400 `invalid_input`.
- E2. `match_type` lạ → 400 `invalid_match_type`; `pattern` rỗng → 400 `missing_pattern`; `meaning` lạ → 400 `invalid_meaning`; `income` không `is_salary` (và không `tenant_id`) → 400 `income_needs_salary` (DB còn `CHECK (meaning <> 'income' OR is_salary = 1)`).
- E3. Rule người thuê mà `meaning` ≠ `income` → 400 `tenant_rule_income_only`; người thuê không có → 400 `unknown_tenant`.
- E4. `income_stream_id` không có → 400 `unknown_income_stream`; gắn nguồn cho rule không phải `income` → 400 `income_only`.

## Acceptance Criteria
### AC-1: Rule seed có đủ bộ mã đang chạy
- Then `GET /v1/rules` chứa `EAN`, `EXE`, `EMS`, `LUONG THANG`
- Tests: `test/logs.test.ts` › "GET/POST /v1/rules › liệt kê rule đã seed (bao gồm EAN, EXE, EMS, LUONG THANG)"

### AC-2: Tạo rule chi
- Tests: `test/logs.test.ts` › "GET/POST /v1/rules › tạo rule mới cho spend"

### AC-3: Máy không bao giờ được đoán thu nhập ngoài mẫu lương
- Given rule `income` không `is_salary` → 400 `income_needs_salary`; rule `income` không `is_salary` (nếu có) không khớp log nào; rule lương không khớp log `out`
- Tests: `test/logs.test.ts` › "GET/POST /v1/rules › tạo rule income mà không is_salary → từ chối (luật 6)"; `test/rules.test.ts` › "matchRule › rule income chỉ khớp khi hướng là 'in' và is_salary=1"

### AC-4: `match_type` không hợp lệ bị từ chối
- Tests: `test/logs.test.ts` › "GET/POST /v1/rules › match_type không hợp lệ → từ chối"

### AC-5: Chuẩn hoá nội dung như hệ cũ
- Tests: `test/rules.test.ts` › "normalizeContent › bỏ dấu tiếng Việt và viết hoa, như MzaSepaySheetLib đang làm"; "extractCode › bắt mã 3 chữ cái [QE]xx không phân biệt hoa thường"; "matchRule › dò từ khoá trên nội dung đã bỏ dấu khi không có mã"; "matchRule › không khớp gì thì trả null"

### AC-6: Rule spend/transfer không khớp tiền vào
- Tests: `test/rules.test.ts` › "matchRule › rule spend/transfer không bao giờ khớp khi hướng là 'in'"

### AC-7: Rule tự rút khớp lại được lần chuyển sau
- Tests: `test/logs.test.ts` › "POST /v1/logs/:id/assign › create_rule dạng true/false như PWA gửi: false không tạo rule, true tự rút mẫu từ nội dung"

### AC-8: Rule người thuê chỉ dùng cho tiền vào
- Given người thuê `an`
- When `createRule {match_type:"content", pattern:"AN", meaning:"spend", tenant_id:"an"}`
- Then lỗi `tenant_rule_income_only`
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ dùng cho tiền vào"

### AC-9: Rule người thuê tạo được không cần `is_salary`, nhưng chỉ gợi ý
- Given người thuê `an`
- When `createRule {match_type:"content", pattern:"AN CK", meaning:"income", tenant_id:"an"}` rồi log `in` khớp về
- Then rule được tạo; log vẫn `pending`, chỉ có gợi ý "Thu từ An"
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán"

### AC-10: Mẫu lương mang nguồn thu
- Given rule lương có `income_stream_id = 'salary-wife'`
- Then khoản thu tự ghi gắn `salary-wife`, chia theo phần khóa của nguồn
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule lương mang income_stream_id → khoản thu tự ghi gắn nguồn, chia theo phần khóa của nguồn"
- ⚠ Chưa có test cho `POST /v1/rules` với `income_stream_id` (test đặt cột bằng SQL); lỗi `unknown_tenant`, `unknown_income_stream`, `income_only` chưa có test.

### AC-11: Migration 0017 + 0019 + 0020 seed rule heo đất cho mọi tài khoản MB của đúng chủ, chuyển ví vào Tích sản; DB không có hai thành viên thật của prod thì không seed gì (ADR-77, ADR-82)
- Given nhà như prod (chồng: `mb-main-husband`, `bidv-husband`; vợ: `mb-spending-wife`, `mb-savings-wife`, `tcb-wife` — mã thay thế cho mã thật) chạy migration 0001…0016 rồi 0017 trở đi; và DB seed mẫu (`anh`/`em`)
- When đọc `rules WHERE counter_account_id IS NOT NULL`
- Then nhà như prod: đúng 9 rule `content` `transfer` — `mb-main-husband` → `piggy-husband`, `mb-spending-wife` và `mb-savings-wife` → `piggy-wife`, mỗi tài khoản ba mẫu `CHUYEN TIEN LE LAM TRON` (10), `TIET KIEM TIEN LE` (11), `TICH LUY` (12, migration 0019); rule của `mb-main-husband`, `mb-spending-wife` `from_wallet_id = co-thi-tot`, `wallet_id = tich-san` (0020 đổi từ `heo-dat`), rule của `mb-savings-wife` không ví (phao từ 0024, ADR-88); không rule nào cho `bidv-husband`, `tcb-wife`; ví `heo-dat` `active = 0`. Chạy 0020 trên dữ liệu như prod (rule cũ đã đưa 9.000 vào `heo-dat`): không rule nào còn `wallet_id`/`from_wallet_id` = `heo-dat`. DB seed mẫu: 0 rule
- Tests: test migration ở repo gốc; test migration ở repo gốc; test migration ở repo gốc

### AC-12: Mẫu `TICH LUY` — tiền ra là bỏ heo (ADR-77, ADR-82)
- Given nhà như prod sau 0017 + 0019 + 0020; `mb-main-husband` SePay báo cả tiền ra; `mb-spending-wife` nối SePay "chỉ tiền vào"
- When log `out` "GUI TIEN TICH LUY AC 1234567890123" 100.000 ở `mb-main-husband`; cùng nội dung 20.000 ở `mb-spending-wife`
- Then `mb-main-husband`: tự gán `transfer` `mb-main-husband` → `piggy-husband`, ví `nice-to-have` → `wealth-building`; `mb-spending-wife`: log `pending`, gợi ý `{meaning:"transfer", other_account_id:"piggy-wife", from_wallet_id:"nice-to-have", wallet_id:"wealth-building"}`
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "rút heo về tài khoản › tiền ra khớp 'TICH LUY' (tự gửi thêm vào sổ tích lũy): tài khoản báo cả tiền ra tự gán bỏ heo; 'chỉ tiền vào' thì gợi ý"

## Traceability
- Code: `src/routes/logs.ts` › `logs.get("/rules")`, `logs.post("/rules")`; `src/services/ingest.ts` › `listRules`, `createRule`, `RuleInput`, `createRuleFromSplit`, `MATCH_TYPES`, `RULE_MEANINGS`, `loadRuleRows`, `LoadedRule`, `suggestFor`; `src/domain/rules.ts` › `matchRule`, `normalizeContent`, `extractCode`, `suggestRulePattern`, `CODE_RE`; `src/services/settings.ts` › `updateRule` (access UC-507)
- Migrations/DB: `rules` (`migrations/0001_schema.sql` §8, CHECK), seed `migrations/0002_seed.sql`, `migrations/0004_sepay_rules.sql`; `rules.tenant_id`, `rules.income_stream_id` (`migrations/0007_income_streams_rental.sql`); `rules.account_id`, `rules.counter_account_id`, `rules.from_wallet_id`, rule heo đất (`migrations/0017_heo_dat.sql`, mẫu `TICH LUY` ở `migrations/0019_heo_settlement_rule.sql`, `wallet_id` `heo-dat` → Tích sản ở `migrations/0020_heo_tich_san.sql`)

## Divergences & Open Questions
- [DIVERGENCE] `phase-04-ingest-sepay.md` §Rules: loại `account` = "tài khoản / tên thụ hưởng"; code so `account` giống hệt `content` (chuỗi con trong nội dung chuẩn hoá, `src/domain/rules.ts` › `matchRule`) vì payload không có trường tài khoản đối ứng.
- [DIVERGENCE] `phase-04-ingest-sepay.md` §"Học từ hệ đang chạy": từ khoá `TIET KIEM TIEN LE`/`DANG GOM`/`LAM TRON` → `QTT`; migration 0004 cố ý không seed (ví đích chưa rõ — `fullstack-developer-260922-0020-sepay-ingest.md` câu hỏi mở 1). Migration 0017 trả lời bằng rule `content` gắn từng tài khoản MBBank của người có heo (chuyển nội bộ sang heo — ADR-77; ví Có thì tốt → Tích sản từ migration 0020 — ADR-82), không phải mã `QTT` dùng chung; tài khoản khác (hay nhà không có `husband`/`wife`) thì log mang nội dung này vẫn rơi về `pending`.
- [OPEN] `createRule` (REST) không viết hoa `pattern` và không kiểm ví/danh mục tồn tại; `updateRule` (Cài đặt) thì có. Khớp vẫn đúng vì `matchRule` viết hoa khi so; ràng buộc tồn tại dựa vào FK của D1 — chưa kiểm chứng.
- [OPEN] Rule `code` khớp mọi `[QE]xx` trong nội dung, kể cả từ thông dụng (EMS bưu điện, QUA) — `redteam-260922-0100-offline-ingest-robustness.md` Phát hiện 1, CÒN MỞ.
- [OPEN] `by_member_id` của rule mã dùng chung được seed là `'husband'` (`fullstack-developer-260922-0020-sepay-ingest.md` câu hỏi mở 2).
- [OPEN] Mẫu `TICH LUY` (ADR-77) bắt mọi nội dung có "tích lũy" ở tài khoản MB của người có heo — nếu nhà mở thêm sản phẩm tiết kiệm tích lũy khác của MB ngoài "Tiết kiệm tiền lẻ", log của nó cũng bị coi là heo (tiền ra tự gán bỏ heo khi SePay báo cả tiền ra; tiền vào chỉ gợi ý). Chưa kiểm prod có sản phẩm như vậy không; có thì tắt rule ở Cài đặt › Luật hoặc thu hẹp mẫu.
- [OPEN] Không có endpoint xoá rule; tắt bằng `active=false` qua Cài đặt.
- [OPEN] Rule người thuê chỉ tạo được qua `POST /v1/rules`: không tạo từ lần gán (UC-305 `create_rule` chỉ cho `spend`/`transfer`), Cài đặt không sửa được `tenant_id` (`updateRule` không nhận trường này), PWA không có chỗ tạo.
- [OPEN] `createRule` không chặn rule người thuê trỏ tới người thuê đã ra (`active = 0`); gợi ý vẫn hiện nhưng gán sẽ lỗi `inactive_tenant`.
- [OPEN] `account_id`, `counter_account_id`, `from_wallet_id` chỉ đặt được bằng migration: `POST /v1/rules`, `create_rule` ở màn Gán và `updateRule` ở Cài đặt không nhận ba trường này (ADR-77 Consequences). Thêm tài khoản MB mới cho người có heo thì phải thêm rule bằng SQL.
