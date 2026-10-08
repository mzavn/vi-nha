# UC-305: Gán log chưa gán
- Status: implemented
- BR: BR-03, BR-04, BR-02
- Decisions: luật 6 (`docs/core_design_rules.md` §1); §6 "Rút ATM"; §7 lớp 2 (tổng split = `log.amount`); D14; commit `8c319c1` (`create_rule` boolean, kiểm trước khi ghi sổ), `c3ab508` (gán nguyên tử), `43baea1` (gợi ý "có thể trùng"); ADR-58 (tiền người thuê trả ghi là `income` theo tiền thật); ADR-59 (nguồn thu chọn khi gán); ADR-60 (tiền vào từ người thuê chỉ gợi ý); ADR-63 (chuyển ví "Thu cho thuê" → Tích sản kèm chuyển khoản); ADR-71 (trả nợ = khoản chi có `debt_id`); ADR-72 (tiền cho vay về = `collect`, không bao giờ là thu nhập); ADR-76 (số dư đầu là mốc — `before_opening`); ADR-77 (heo đất: gợi ý bỏ heo / heo trả về theo rule gắn tài khoản, chỉ gợi ý cho tiền vào); ADR-81 (chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi); ADR-82 (heo đất là Tích sản: bỏ heo gợi ý chuyển ví Có thì tốt → Tích sản; rút heo về chỉ gợi ý chuyển tài khoản)
- Actor: thành viên trong hộ (PWA màn Gán, qua `requireAuth`); Claude qua MCP (mcp UC-604, chỉ `list`/`assign`, không tạo rule)
- Trigger: `GET /v1/logs?status=pending&limit=`; `POST /v1/logs/:id/assign`; `POST /v1/logs/:id/ignore`

## History
- v1 (2026-09-22, commit `c1a25c1`): danh sách pending kèm gợi ý; assign/ignore; `create_rule` dạng object.
- v2 (2026-09-22, commit `8c319c1`): PWA luôn gửi `create_rule: true|false` nên mọi lần gán từ điện thoại từng trả 400; nay `true` = tự rút mẫu từ nội dung (`suggestRulePattern`), mọi điều kiện rule kiểm **trước** khi ghi sổ, rule không tạo được thì báo kèm kết quả gán thành công (`ruleSkipped`) thay vì lỗi.
- v3 (2026-09-22, commit `c3ab508`): các dòng gán + `markAssigned` trong một batch; trigger chặn gán hai lần; gợi ý không còn một truy vấn mỗi dòng.
- v4 (2026-09-22, commit `43baea1`): log có song sinh được gợi ý "Có thể trùng giao dịch đã ghi" thay cho gợi ý gán.
- v5 (2026-10-01, commit `034b7ff`): split nhận thêm `from_wallet_id` (`transfer`: chuyển cả ngân sách ví cùng chuyển khoản — đóng "khoảng trống cần sửa" của proposal), `income_stream_id`, `tenant_id` (`income`); log `in` khớp rule người thuê được gợi ý "Thu từ <tên>" (change `261001-cho-thue-lai`).
- v6 (2026-10-01, commit `1f472a1`): gợi ý "Rút tiền mặt" khi chủ TK không có ví tiền mặt riêng thì trỏ về ví tiền mặt chung (`cashAccountFor`).
- v7 (2026-10-01, commit `39751b8`): log `out` của tài khoản để "chỉ tiền vào" (`sepay_enabled AND sepay_out` = 0, ADR-66) — không tự gán theo rule (UC-303) — nhận gợi ý theo rule khớp (cả rule `spend` đủ danh mục, rule `transfer` → Rút tiền mặt) kèm `note` nhắc có thể đã nhập tay; PWA hiện `note` thành banner ở màn Gán.
- v8 (2026-10-01, commit `25db5b9`): split `spend` nhận `debt_id` — gán log tiền ra thành khoản trả nợ, số còn nợ giảm (debt [UC-903](../debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md), ADR-71); cùng luật `buildEntry`: `debt_spend_only`, `unknown_debt`, `inactive_debt`, thiếu danh mục → `tra-no`.
- v9 (2026-10-01, commit `2438ac0`): split nhận `meaning: "collect"` (tiền cho vay quay về — log tiền vào, không ví, không phải thu nhập, không chia) và `receivable_id` trên `lend`/`collect` (receivable [UC-1003](../receivable/UC-1003-nhan-lai-tien.md), ADR-72); cùng luật `buildEntry`: `receivable_only`, `unknown_receivable`, `inactive_receivable`.
- v10 (2026-10-03, commit `f74bc70`): dòng gán dựng qua `buildEntry` nên chịu luật **số dư đầu là mốc** (ADR-76, ledger UC-101 bước 4j): log có ngày VN trước `opened_at` của tài khoản (log `pending` nhận trước khi có luật này; log mới như vậy đã `ignored` từ lúc ghi — UC-302 2b) → 400 `before_opening`, không ghi gì.
- v11 (2026-10-03, commit `f74bc70`): rule chỉ áp cho log của đúng tài khoản nó gắn (`rules.account_id`, ADR-77); rule `transfer` có tài khoản đầu kia (`counter_account_id`, bỏ heo đất) gợi ý chuyển sang đúng tài khoản đó kèm chuyển ví (`from_wallet_id` → `wallet_id`) cho log `out` của tài khoản "chỉ tiền vào"; log `in` khớp cùng rule → gợi ý chiều ngược lại (heo trả về), kèm lời nhắc tách phần lãi thành Thu nhập.
- v12 (2026-10-03, commit `c67420e`): gợi ý heo trả về chỉ kèm chuyển ví Heo đất → Có thì tốt khi ví `heo-dat` đang giữ **đủ** số tiền về (`v_wallet_balance` ≥ `log.amount`); ví ≤ 0 (tiền heo có từ trước khi dùng app, chưa từng nằm trong ví nào) hoặc giữ ít hơn → chỉ gợi ý chuyển tài khoản, lời nhắc nói lý do / số ví đang giữ. Nội dung MB tất toán sổ tích lũy ("Tat toan truoc han tien gui sotich luy …") khớp rule mới `TICH LUY` (UC-307, migration 0019) nên có gợi ý.
- v13 (2026-10-03, commit `c67420e`): **chân thứ hai đến sau** (ADR-81) — log là chân còn lại của một `transfer` đã ghi từ một chân ở tài khoản đầu kia được gợi ý `{meaning:"transfer", other_account_id, attach_to_tx, label:"Khớp chuyển nội bộ đã ghi lúc HH:mm"}`; gán đúng một dòng chuyển nội bộ trọn số tiền sang đúng tài khoản đó thì **gắn** log làm `log_id_2` của giao dịch ấy (`attached: true`), không ghi giao dịch thứ hai. Phản hồi gán luôn có `attached`. Prod 3/10: chân vào 250.000 ở `mb-spending-wife` gán tay thành giao dịch thứ hai cho cùng lần chuyển `mb-main-husband` → `mb-spending-wife`.
- v14 (2026-10-03, commit `e00814c`): **heo đất là Tích sản** (ADR-82, migration 0020) — gợi ý bỏ heo cho tài khoản "chỉ tiền vào" điền sẵn chuyển ví Có thì tốt → **Tích sản** (rule heo nay trỏ Tích sản). Gợi ý heo trả về chỉ còn `{meaning:"transfer", other_account_id:<heo>, label:"Rút heo về <tên tài khoản nhận>", note:"Chỉ đổi chỗ tiền; tiền vẫn thuộc Tích sản cho tới khi anh tự chuyển ví."}`: bỏ chuyển ví Heo đất → Có thì tốt, bỏ ba nhánh ví đủ / ví trống / ví giữ ít hơn, bỏ lời nhắc lãi và lời nhắc tiền trước app; `listPendingLogs` không còn đọc số dư ví.
- v15 (2026-10-03, commit `2608b66`): sửa lỗi — gợi ý **Rút tiền mặt** cho log `out` không khớp rule nào chỉ còn khi nội dung ngân hàng trông như rút tiền mặt (`looksLikeCashWithdrawal`, `src/domain/rules.ts`: từ trọn vẹn `ATM`, `RUT TIEN`, `RUT TM`, `CASH WITHDRAWAL` trên nội dung đã bỏ dấu, viết hoa); log `out` không khớp khác (trả QR, hoá đơn, chuyển khoản, chân mồ côi của lệnh `PF`) → không gợi ý (`null`; tài khoản "chỉ tiền vào" chỉ còn `{note}`), màn Gán mặc định Chi tiêu. Trước đó mọi log `out` không khớp đều được gợi ý "Rút tiền mặt" — gợi ý sai cho khoản chi, bấm theo là ghi nhầm chuyển nội bộ. Rule `transfer` không có tài khoản đầu kia khớp ở tài khoản "chỉ tiền vào" vẫn gợi ý Rút tiền mặt (rule đã nói là rút tiền). Đóng [DIVERGENCE] docs §6.
- v16 (2026-10-04, commit `c9c6acb`): change [`261004-gan-tham-chieu`](../changes/archive/261004-gan-tham-chieu/proposal.md) — split nhận `link_id` (số nguyên dương; sai kiểu → `invalid_input`): dòng `refund` nối về khoản chi gốc, cùng kiểm như nhập tay (ledger UC-101 bước 4b, `resolveRefundLink`: khoản gốc phải là `spend` còn hiệu lực, không thì `invalid_link`; không chọn danh mục thì lấy danh mục khoản gốc). Trước đó `parseSplit` bỏ qua `link_id`: khoản hoàn tiền gán từ ngân hàng không nối được về khoản chi.
- v17 (2026-10-05, commit `d7992d1`): change [`261005-lien-ket-khoan-goc`](../changes/archive/261005-lien-ket-khoan-goc/proposal.md) — split `collect` cũng nhận `link_id` (khoản cho vay gốc, bước 6.7): `resolveRefundLink` → `resolveLink` (ledger UC-101 bước 4b) — khoản gốc phải là `lend` còn hiệu lực; không gửi `receivable_id` thì lấy người của khoản cho vay; khác người → `invalid_link`, log vẫn `pending`. MCP `assign_log` nhận `link_id` như REST (mcp [UC-604](../mcp/UC-604-gan-log-qua-mcp.md) AC-6).

## Preconditions
- Đã đăng nhập (access UC-501/UC-502). Log ở `status='pending'`.

## Main Flow
**Xem danh sách**
1. `GET /v1/logs` (`status` chỉ nhận `pending`, `limit` số nguyên, mặc định 50, kẹp 1..200): log `pending` mới nhất trước (`ORDER BY at DESC`), kèm `account_name`.
2. Mỗi log có `suggestion`:
   - có song sinh (UC-302) → `{possible_duplicate_of, label: "Có thể trùng giao dịch đã ghi"}`;
   - log là **chân còn lại của chuyển nội bộ đã ghi một chân** (ADR-81 — cùng điều kiện ingest UC-303 bước 2b, `findSingleLegTransfer`) → `{meaning: "transfer", other_account_id: <TK của chân đã ghi>, attach_to_tx: <id giao dịch>, label: "Khớp chuyển nội bộ đã ghi lúc HH:mm"}` (giờ VN của chân đã ghi); đứng trước mọi gợi ý theo rule bên dưới, kể cả lời nhắc 2b;
   - log `in` khớp rule người thuê (rule mang `tenant_id`, UC-307) → `{meaning: "income", tenant_id, label: "Thu từ <tên người thuê>"}` — chỉ gợi ý, người vẫn phải bấm Gán (ADR-60);
   - log `in` khớp rule `transfer` có tài khoản đầu kia của **chính tài khoản đó** (heo đất, ADR-77, ADR-82) → rút heo về: `{meaning: "transfer", other_account_id: <đầu kia>, label: "Rút heo về <tên tài khoản của log>", note: "Chỉ đổi chỗ tiền; tiền vẫn thuộc Tích sản cho tới khi anh tự chuyển ví."}` — chỉ gợi ý, không bao giờ tự gán; **không** kèm chuyển ví (tiền vẫn thuộc Tích sản), không đọc số dư ví. Người gán vẫn tách dòng được (vd phần lãi là Thu nhập);
   - log `in` khác hoặc TK lạ → `null` (tiền vào luôn hỏi);
   - Chỉ rule không gắn tài khoản hoặc gắn đúng tài khoản của log được xét (`rules.account_id`, ADR-77).
   - log `out` khớp rule `spend` thiếu danh mục → `{meaning: "spend", wallet_id, note: "Khớp mã nhưng thiếu danh mục — chọn danh mục để lưu."}`;
   - log `out` không khớp rule nào, nội dung trông như rút tiền mặt (`looksLikeCashWithdrawal` — từ trọn vẹn `ATM`, `RUT TIEN`, `RUT TM` hay `CASH WITHDRAWAL` trên nội dung đã `normalizeContent`) và tìm được TK tiền mặt (`cashAccountFor`: của chủ TK, không có thì ví tiền mặt chung) → `{meaning: "transfer", other_account_id: <TK tiền mặt>, label: "Rút tiền mặt"}`;
   - log `out` không khớp rule nào mà nội dung không phải rút tiền (trả QR, hoá đơn, chuyển khoản…) → `null` — PWA mặc định Chi tiêu, nút Rút tiền mặt vẫn ở sheet (pwa UC-706);
   - còn lại `null`.
   - 2b. **Log `out` của tài khoản "chỉ tiền vào"** (`sepay_enabled AND sepay_out` = 0, ADR-66 — log này không được tự gán theo rule, UC-303 3.0a): gợi ý thêm cho rule `spend` đủ danh mục → `{meaning: "spend", wallet_id, category_id}`, rule `transfer` có tài khoản đầu kia (bỏ heo đất, ADR-77; ví Có thì tốt → Tích sản, ADR-82) → `{meaning: "transfer", other_account_id: <đầu kia>, from_wallet_id, wallet_id, label: "Chuyển sang <tên đầu kia>"}`, rule `transfer` khác (rút tiền mặt cố định) → gợi ý Rút tiền mặt như trên, không cần nội dung rút tiền; rồi **mọi** gợi ý (kể cả `null` → chỉ còn `{note}`) gộp `note: "SePay vừa báo tiền ra cho tài khoản đang để 'chỉ tiền vào'. Nếu khoản này đã nhập tay thì Bỏ qua; rồi bật 'SePay báo cả tiền ra' ở Cài đặt."` (gợi ý đã có `note` thì nối lời nhắc lên trước). Log có song sinh vẫn chỉ nhận gợi ý "có thể trùng".

**Gán**
3. `POST /v1/logs/:id/assign` body `{splits: [{meaning, amount, wallet_id?, category_id?, other_account_id?, from_wallet_id?, income_stream_id?, tenant_id?, debt_id?, receivable_id?, link_id?, taxable?, asset_kind?, note?}], create_rule?}`; `meaning` ∈ `spend|transfer|income|refund|lend|collect|buy_asset` (`SPLIT_MEANINGS`), `amount` số nguyên dương, `link_id` (nếu gửi) số nguyên dương.
4. Kiểm `create_rule` **trước khi ghi**: bỏ trống/`false` = không tạo; `true` = tự rút mẫu; object `{match_type, pattern}` = mẫu chỉ định. Rule chỉ được khi đúng 1 split và split là `spend`/`transfer`.
5. `assignLog`: log phải tồn tại và `pending`; tổng `amount` các split phải **bằng đúng** `log.amount`.
   - 5b. **Gắn chân thứ hai** (ADR-81): đúng **một** split `meaning: "transfer"` có `other_account_id`, log có tài khoản, và log là chân còn lại của chuyển nội bộ đã ghi một chân mà chân kia nằm ở đúng `other_account_id` (điều kiện ingest UC-303 bước 2b) → một batch (`attachSecondLeg`): `log_id_2 = <log>` + log `assigned`; **không** qua `buildEntry`, không ghi giao dịch mới; ví/ghi chú của split bị bỏ qua (giao dịch đã ghi giữ nguyên ví, người ghi). Trả 201 `{log, transactions: [giao dịch đã gắn], attached: true, rule, ruleSkipped}` (rule xét như bước 8). Không tìm được / không gắn được (giao dịch vừa bị huỷ hay vừa có chân thứ hai) → bước 6 như thường.
6. Mỗi split → `buildEntry` (luật nhập tay của ledger UC-101) với `at` = `log.at`, `account_id` = TK log; `transfer` bắt buộc `other_account_id` — log `out`: TK log → đầu kia; log `in`: đầu kia → TK log. Mọi dòng mang `log_id`, `source='sepay'`, `by_member_id` = người đang đăng nhập (MCP: `null`).
   - 6.1 `transfer` kèm `from_wallet_id` (ví nguồn) + `wallet_id` (ví đích): chuyển khoản giữa hai TK đồng thời chuyển ngân sách giữa hai ví (`counter_wallet_id` = ví nguồn, `wallet_id` = ví đích), ví dụ "Thu cho thuê" → Tích sản khi chuyển MB → BIDV (ADR-63). Có một ví thì phải có cả hai; hai ví trùng nhau → `same_wallet`; ví nguồn là Tích sản → `locked_wallet`.
   - 6.2 `income` kèm `tenant_id`: người thuê phải có (`unknown_tenant`) và còn ở (`inactive_tenant`); dòng ghi mang `tenant_id` nên số dư người thuê giảm đúng số tiền (view `v_tenant_balance`, rental [UC-805](../rental/UC-805-nhan-tien-nguoi-thue-tra.md)). Nguồn thu = `income_stream_id` gửi lên, không có thì lấy nguồn cho thuê cấu hình (`rental_income_stream_id`, mặc định `rental`).
   - 6.3 `income` kèm `income_stream_id`: nguồn phải có (`unknown_income_stream`) và đang bật (`inactive_income_stream`); lần chia sau đó theo phần khóa của nguồn (allocation UC-201, ADR-59).
   - 6.4 `income_stream_id`/`tenant_id` trên dòng không phải `income` → `income_only`.
   - 6.5 `spend` kèm `debt_id` (trả nợ — debt [UC-903](../debt/UC-903-gan-giao-dich-ngan-hang-la-tra-no.md)): khoản nợ phải có (`unknown_debt`) và đang bật (`inactive_debt`); không chọn danh mục thì lấy `debt-payment`; dòng ghi mang `debt_id` nên số còn nợ giảm (view `v_debt_balance`). `debt_id` trên dòng không phải `spend` → `debt_spend_only`.
   - 6.6 `collect` (tiền cho vay quay về — receivable [UC-1003](../receivable/UC-1003-nhan-lai-tien.md)) và `lend` (cho vay — [UC-1002](../receivable/UC-1002-cho-vay-tra-ho.md)) kèm `receivable_id`: khoản phải thu phải có (`unknown_receivable`) và đang bật (`inactive_receivable`); `collect` ghi `counter_account_id` = TK log, **không ví, không danh mục**, không phải `income` nên không bao giờ được chia (PWA chỉ gọi chia cho `income`; `/v1/allocate` → `not_income`); dòng ghi mang `receivable_id` nên còn phải thu đổi (view `v_receivable_balance`). `receivable_id` trên dòng không phải `lend`/`collect` (kể cả `refund`) → `receivable_only`.
   - 6.7 `refund` / `collect` kèm `link_id` (khoản gốc được trả — pwa UC-706 bước 5d, 5e): sau `buildEntry`, mỗi dòng có `link_id` qua `resolveLink` như nhập tay (ledger UC-101 bước 4b): `refund` → khoản gốc phải tồn tại, `active`, `meaning='spend'`, dòng không gửi `category_id` thì lấy danh mục khoản gốc; `collect` → khoản gốc phải tồn tại, `active`, `meaning='lend'`, dòng không gửi `receivable_id` thì lấy người của khoản cho vay, gửi người khác người của khoản cho vay → sai. Sai → `invalid_link`, không ghi gì, log vẫn `pending`. Ví không tự lấy theo khoản gốc (gửi `wallet_id`, hoặc danh mục có ví mặc định). `link_id` trên dòng loại khác bị bỏ qua (`buildEntry` chỉ đặt `link_id` cho `refund` và `collect`).
7. Một batch: chèn mọi dòng + `markAssigned`. Trả 201 `{log, transactions, attached: false, rule, ruleSkipped}`.
8. Nếu muốn rule và không bị chặn: mẫu = object chỉ định, hoặc `suggestRulePattern(log.content)` (mã `[QE]xx` nếu có; không thì đoạn chữ liền nhau dài nhất không chứa chữ số, tối đa 4 từ, ≥ 3 ký tự) → `createRuleFromSplit` (UC-307) với ví/danh mục của split và `by_member_id` người gán.

**Bỏ qua**
9. `POST /v1/logs/:id/ignore`: `UPDATE … SET status='ignored' WHERE status='pending'` → trả log.

## Alternative Flows
- 4a. `create_rule: true` nhưng bị chặn (nhiều split, hoặc split không phải `spend`/`transfer`) → vẫn gán; `rule: null`, `ruleSkipped` = lý do ("Máy chỉ được tự gán khoản chi và chuyển nội bộ; tiền vào luôn phải hỏi." / "Chỉ tạo rule khi gán đúng một dòng.").
- 8a. Nội dung không có mẫu đủ đặc trưng → `ruleSkipped = "Nội dung chuyển khoản không có đoạn chữ nào đủ đặc trưng để làm rule."`.
- 8b. `createRuleFromSplit` ném lỗi (ví dụ `match_type` lạ) → `ruleSkipped` = thông điệp lỗi; giao dịch đã ghi giữ nguyên.
- 6a. Gán split `income` **không** tự chia; PWA tự gọi chia sau khi gán (allocation "Chia thu nhập"; `code-reviewer-260922-0330-redteam-fixes-review.md` mục "Đã kiểm tra").

## Exceptions
- E1. `status` ≠ `pending` → 400 `invalid_status`; `limit` không nguyên → 400 `invalid_input`.
- E2. Body không phải object, `splits` rỗng/không phải mảng, split sai kiểu → 400 `invalid_input`.
- E3. `create_rule` object sai dạng → 400 `invalid_input`; object hợp lệ nhưng bị chặn (điều kiện bước 4) → 400 `rule_not_allowed`, **không ghi sổ gì**.
- E4. Log không tồn tại → 400 `not_found` (assign) / 404 `not_found` (ignore).
- E5. Log không còn `pending` → 409 `not_pending` ("Log này đã được xử lý."); batch bị trigger huỷ vì request khác vừa xử lý → 409 `not_pending` ("Log này vừa được xử lý ở nơi khác.").
- E6. Tổng split ≠ `log.amount` → 400 `split_mismatch`.
- E7. `transfer` thiếu `other_account_id` → 400 `missing_account`; lỗi kiểm của `buildEntry` (thiếu danh mục khi chi, ví khoá, `missing_wallet`/`same_wallet`/`locked_wallet` khi chuyển kèm ví, `income_only`, `unknown_tenant`/`inactive_tenant`, `unknown_income_stream`/`inactive_income_stream`, `debt_spend_only`/`unknown_debt`/`inactive_debt`, `receivable_only`/`unknown_receivable`/`inactive_receivable`, `before_opening` — ngày log trước ngày mở sổ của TK log hoặc TK đầu kia…) hay của `resolveLink` (`invalid_link`) → 400 với mã tương ứng.

## Acceptance Criteria
### AC-1: Danh sách chỉ gồm log chờ gán, kèm gợi ý Rút tiền mặt cho log ra rút ATM không khớp rule
- Given `p1` `out` 2.000.000 nội dung "RUT TIEN TAI ATM VCB" không khớp rule ở `vcb-husband` (chủ: `husband`), `p2` `ignored`
- Then chỉ trả `p1`, gợi ý `{meaning:"transfer", other_account_id:"cash-husband", label:"Rút tiền mặt"}`
- Tests: `test/logs.test.ts` › "GET /v1/logs?status=pending › chỉ liệt kê log pending, kèm gợi ý"; `test/ingest.test.ts` › "gợi ý Rút tiền mặt chỉ cho log `out` trông như rút tiền › listPendingLogs gợi ý transfer sang ví tiền mặt của đúng chủ tài khoản"

### AC-2: Tiền vào không có gợi ý
- Tests: `test/ingest.test.ts` › "gợi ý Rút tiền mặt chỉ cho log `out` trông như rút tiền › log tiền vào không khớp gì thì không gợi ý (luôn phải hỏi)"

### AC-3: Log có thể trùng được gợi ý bỏ qua, không gợi ý gán
- Tests: `test/ingest-integrity.test.ts` › "ba cách một đồng tiền bị đếm hai lần (red team, số của họ) › webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → chia đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng"

### AC-4: Tổng các dòng phải bằng đúng số tiền log
- Given log 150.000 → split 100.000 → 400 `split_mismatch`; split 150.000 → 201, log `assigned`, 1 giao dịch; log 200.000 tách 120.000 + 80.000 → 2 giao dịch
- Tests: `test/logs.test.ts` › "POST /v1/logs/:id/assign › tổng splits khớp số tiền log → 201, tạo transaction, log 'assigned'"; "… › tổng splits không khớp → 400 split_mismatch"; "… › tách một log thành nhiều dòng, tổng vẫn phải đúng"; `test/ingest.test.ts` › "assign / ignore › gán với tổng splits không khớp số tiền log → lỗi split_mismatch"; "assign / ignore › gán đúng tổng tiền thì tạo transaction, log chuyển 'assigned'"

### AC-5: Không gán hai lần
- Given log đã gán (hoặc đã `ignored`)
- When gán lại → 409 `not_pending`, sổ chỉ có một bộ giao dịch
- Tests: `test/ingest-integrity.test.ts` › "gán hai lần cùng lúc › lần gán thứ hai bị từ chối 409, sổ chỉ có một bộ giao dịch"; `test/logs.test.ts` › "POST /v1/logs/:id/assign › log đã xử lý rồi thì không gán lại được"

### AC-6: Rule từ lần gán — chỉ chi/chuyển; từ chối thì không ghi sổ nửa chừng
- Given gán `spend` 77.000 kèm `create_rule {content, "MOMO"}` → 201, rule `content`/`MOMO`/`spend`
- Given gán `income` kèm `create_rule` object → 400 `rule_not_allowed`; log vẫn `pending`, 0 giao dịch
- Tests: `test/logs.test.ts` › "POST /v1/logs/:id/assign › gán kèm create_rule tạo luôn rule cho lần sau; income bị từ chối vì luật 6"

### AC-7: `create_rule` boolean như PWA gửi
- Given `false` → `rule: null, ruleSkipped: null`; `true` với nội dung "CT DEN:987654321 GRAB VIETNAM THANH TOAN 0911" → rule `content` "GRAB VIETNAM THANH TOAN" khớp được lần chuyển sau có số khác; `true` với tiền vào (refund) → vẫn gán, `rule: null`, `ruleSkipped` chứa "tiền vào luôn phải hỏi"
- Tests: `test/logs.test.ts` › "POST /v1/logs/:id/assign › create_rule dạng true/false như PWA gửi: false không tạo rule, true tự rút mẫu từ nội dung"; "… › create_rule: true với tiền vào thì vẫn gán được, chỉ báo không tạo rule"; "… › mẫu rule tự rút: ưu tiên mã [QE]xx; nội dung toàn số thì không có mẫu"

### AC-8: Bỏ qua
- Given log `pending` → `ignored`; bỏ qua lần hai → `not_pending`; log không có → 404
- Tests: `test/ingest.test.ts` › "assign / ignore › ignore log pending → 'ignored'; ignore lần hai báo lỗi not_pending"; `test/logs.test.ts` › "POST /v1/logs/:id/ignore › chuyển log sang ignored"; "POST /v1/logs/:id/ignore › log không tồn tại → 404"

### AC-9: Status khác `pending` bị từ chối
- Tests: `test/logs.test.ts` › "GET /v1/logs?status=pending › status khác 'pending' bị từ chối"

### AC-10: Log tiền vào khớp rule người thuê được gợi ý, không tự gán
- Given người thuê `an` có rule `content "AN CK"`
- When log `in` "AN CK TIEN NHA T10" về
- Then log `pending`, `suggestion = {meaning:"income", tenant_id:"an", label:"Thu từ An"}`
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán"

### AC-11: Gán tiền vào cho người thuê → nguồn cho thuê, chia trọn vào "Thu cho thuê", số dư người thuê giảm
- Given người thuê `an`, log `in` 5.191.667
- When gán `[{meaning:"income", amount:5191667, tenant_id:"an"}]` rồi chia
- Then giao dịch có `tenant_id = 'an'`, `income_stream_id = 'rental'`; đúng một fund 5.191.667 vào `rental-income`; số dư người thuê −5.191.667
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền vào cho người thuê → nguồn cho thuê mặc định, chia 100% vào Thu cho thuê, số dư người thuê giảm"

### AC-12: Gán log tiền ra thành chuyển khoản kèm chuyển ví
- Given log `out` 3.000.000 ở `vcb-husband`
- When gán `[{meaning:"transfer", amount:3000000, other_account_id:"tcb-husband", from_wallet_id:"rental-income", wallet_id:"wealth-building"}]`
- Then `transfer` `vcb-husband` → `tcb-husband`, `counter_wallet_id = 'rental-income'`, `wallet_id = 'wealth-building'`; số dư ví "Thu cho thuê" −3.000.000, Tích sản +3.000.000
- Tests: `test/ingest.test.ts` › "nguồn thu & người thuê (change 261001) › gán log tiền ra thành chuyển khoản kèm chuyển ví Thu cho thuê → Tích sản"

### AC-13: Nguồn thu / người thuê trên dòng không phải thu nhập bị từ chối
- Given log bất kỳ
- When gán dòng `spend` kèm `income_stream_id` hoặc `tenant_id`
- Then 400 `income_only`, không ghi gì
- Tests: ⚠ Chưa có test (luật nằm ở `buildEntry`, được thử qua `POST /v1/transactions` ở ledger UC-101)

### AC-14: Ví tiền mặt chung nhận gợi ý Rút tiền mặt
- Given chủ TK nguồn không có ví tiền mặt riêng, nhà có một ví tiền mặt chung (chủ NULL)
- When log `out` "RUT TIEN TAI ATM MB" không khớp rule
- Then gợi ý `{meaning:"transfer", other_account_id:<ví tiền mặt chung>, label:"Rút tiền mặt"}`
- Tests: `test/ingest.test.ts` › "gợi ý Rút tiền mặt chỉ cho log `out` trông như rút tiền › nhà chỉ có một ví tiền mặt chung (không gắn chủ) thì gợi ý rút tiền về ví chung đó"

### AC-15: Log tiền ra của tài khoản "chỉ tiền vào" — gợi ý kèm lời nhắc có thể đã nhập tay (ADR-66)
- Given `mb-husband` nối SePay, `sepay_out = 0`
- When log `out` ở `mb-husband` mã `EAN` (rule spend đủ danh mục); log `out` "khong khop" không khớp rule; log `out` "RUT TIEN TAI ATM MB" không khớp rule
- Then gợi ý lần lượt `{meaning:"spend", wallet_id:"food", category_id:"groceries", note:<lời nhắc>}`, `{note:<lời nhắc>}` (không gợi ý loại) và `{meaning:"transfer", other_account_id:"cash-husband", label:"Rút tiền mặt", note:<lời nhắc>}`, lời nhắc = "SePay vừa báo tiền ra cho tài khoản đang để 'chỉ tiền vào'. Nếu khoản này đã nhập tay thì Bỏ qua; rồi bật 'SePay báo cả tiền ra' ở Cài đặt."
- Tests: `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền ra khớp rule chi → không tự gán, giữ pending; màn Gán gợi ý theo rule kèm lời nhắc có thể đã nhập tay"; `test/ingest.test.ts` › "tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66) › log tiền ra không khớp gì → không gợi ý loại, chỉ còn lời nhắc; nội dung rút ATM thì gợi ý Rút tiền mặt kèm lời nhắc"

### AC-16: Gán log tiền ra thành khoản trả nợ làm giảm số còn nợ
- Given khoản nợ `co-mai` còn 5.000.000; log `out` 2.000.000 ở `vcb-husband`
- When gán `[{meaning:"spend", amount:2000000, debt_id:"co-mai"}]`; rồi gán một log khác thành `transfer` kèm `debt_id`
- Then 201, giao dịch có `debt_id = 'co-mai'`, `category_id = 'debt-payment'`, `source = 'sepay'`, còn nợ 3.000.000; lần sau 400 `debt_spend_only`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền ra thành khoản trả nợ (debt_id) làm giảm số còn nợ"

### AC-17: Gán log tiền vào là nhận lại tiền cho vay — không thành thu nhập, không chia, ví không đổi
- Given khoản phải thu `em-hai` mở sổ 3.000.000; log `in` 1.000.000 ở `vcb-husband`
- When gán `[{meaning:"collect", amount:1000000, receivable_id:"em-hai"}]`; rồi gán một log khác thành `refund` kèm `receivable_id`
- Then 201, giao dịch `collect` có `counter_account_id = 'vcb-husband'`, không ví, `source = 'sepay'`; số dư ví không đổi; không có `income`/`fund`; chia → 404 `not_income`; còn phải thu 2.000.000; lần sau 400 `receivable_only`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "POST /v1/logs/:id/assign › gán log tiền vào là nhận lại tiền cho vay (collect): trừ khoản phải thu, không thành thu nhập, không chia, ví không đổi"

### AC-18: Log trước ngày mở sổ lỡ còn chờ gán → không gán được (ADR-76)
- Given `vcb-husband` mở sổ `2026-09-22`; log `cu-cho` ra 100.000 lúc 23:59 ngày 21/9 giờ VN còn `pending` (nhận trước khi có luật)
- When gán `[{meaning:"spend", amount:100000, category_id:"groceries"}]`; rồi ghép tay `cu-cho` với log vào 100.000 ở `tcb-husband` (UC-306)
- Then cả hai 400 `before_opening` "Ngày này trước ngày mở sổ của tài khoản VCB (chính) (22/9/2026) — số dư đầu đã tính khoản này."; log vẫn `pending`, không giao dịch nào; log ở `tcb-husband` không bị tự ghép với `cu-cho` (UC-303 bước 2)
- Tests: `test/ingest.test.ts` › "số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76) › log trước mốc lỡ còn 'pending' (nhận trước khi có luật): gán và ghép cặp tay đều bị chặn before_opening, log vẫn chờ"

### AC-19: Log bỏ heo đất của tài khoản "chỉ tiền vào" — gợi ý điền sẵn chuyển nội bộ kèm chuyển ví vào Tích sản (ADR-77, ADR-82)
- Given nhà như prod (`husband`, `mb-main-husband` nối SePay, `sepay_out = 0`) sau migration 0017 + 0019 + 0020; log `out` 5.600 ở `mb-main-husband` nội dung "CHUYEN TIEN LE LAM TRON SAU GIAO DICH CHUYEN KHOAN VAO TAI KHOAN DANG GOM (TIET KIEM TIEN LE)"
- When `GET /v1/logs`; rồi gán đúng gợi ý `[{meaning:"transfer", amount:5600, other_account_id:"piggy-husband", from_wallet_id:"nice-to-have", wallet_id:"wealth-building"}]`
- Then log `pending`, 0 giao dịch; gợi ý `{meaning:"transfer", other_account_id:"piggy-husband", from_wallet_id:"nice-to-have", wallet_id:"wealth-building", label:"Chuyển sang Heo đất MB (chồng)"}` (kèm lời nhắc ADR-66); sau gán 1 `transfer` `mb-main-husband` → `piggy-husband`, ví `nice-to-have` → `wealth-building`
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "bỏ heo: log làm tròn tiền lẻ của MB › MB chỉ báo tiền vào (sepay_out = 0 như prod): giữ chờ, gợi ý điền sẵn đúng chuyển nội bộ + chuyển ví; gán theo gợi ý ra cùng kết quả"

### AC-20: Rút heo về tài khoản — chỉ gợi ý chuyển tài khoản heo → tài khoản này, không chuyển ví; tiền vẫn thuộc Tích sản (ADR-82)
- Given `mb-main-husband` báo cả tiền ra; bỏ heo 50.000 + 5.600 từ `mb-main-husband` (tự gán, ví Có thì tốt → Tích sản; sổ `piggy-husband` = 55.600)
- When log `in` 51.200 ở `mb-main-husband` nội dung "TAT TOAN TIET KIEM TIEN LE"; `GET /v1/logs`; rồi gán `[{meaning:"transfer", amount:51200, other_account_id:"piggy-husband"}]`
- Then trước khi gán: log `pending`, 0 giao dịch, gợi ý **đúng bằng** `{meaning:"transfer", other_account_id:"piggy-husband", label:"Rút heo về MB chồng", note:"Chỉ đổi chỗ tiền; tiền vẫn thuộc Tích sản cho tới khi anh tự chuyển ví."}` (không `from_wallet_id`/`wallet_id`); sau gán: 1 `transfer` `account_id = piggy-husband`, `counter_account_id = mb-main-husband`, không ví; sổ `piggy-husband` = 4.400; ví Tích sản không đổi; ví `nice-to-have` vẫn −55.600
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "rút heo về tài khoản › tiền vào khớp mẫu heo: không tự gán, gợi ý chỉ chuyển tài khoản heo → tài khoản này; tiền vẫn thuộc Tích sản"

### AC-21: MB tất toán sổ tích lũy (nội dung thật) — cùng gợi ý rút heo của chính chủ (ADR-77, ADR-82)
- Given nhà như prod sau migration 0017 + 0019 + 0020
- When log `in` 421.000 ở `mb-main-husband` nội dung "Tat toan truoc han tien gui sotich luy AC - 1234567890123 ngay20261003 cua NGUYEN VAN A" (khớp mẫu `TICH LUY`, migration 0019)
- Then log `pending`, 0 giao dịch; gợi ý đúng bằng gợi ý của AC-20 (`label:"Rút heo về MB chồng"`, cùng `note`, không ví)
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "rút heo về tài khoản › MB tất toán sổ tích lũy (nội dung thật): cùng gợi ý rút heo của chính chủ về tài khoản"

### AC-22: Tiền ra khớp `TICH LUY` ở tài khoản "chỉ tiền vào" — gợi ý bỏ heo vào Tích sản (ADR-77, ADR-82)
- Given `mb-spending-wife` nối SePay, để "chỉ tiền vào"
- When log `out` 20.000 ở `mb-spending-wife` nội dung "GUI TIEN TICH LUY AC 1234567890123"
- Then log `pending`, 0 giao dịch; gợi ý `{meaning:"transfer", other_account_id:"piggy-wife", from_wallet_id:"nice-to-have", wallet_id:"wealth-building"}`
- Tests: [`test/piggy-bank.test.ts`](../../test/piggy-bank.test.ts) › "rút heo về tài khoản › tiền ra khớp 'TICH LUY' (tự gửi thêm vào sổ tích lũy): tài khoản báo cả tiền ra tự gán bỏ heo; 'chỉ tiền vào' thì gợi ý"

### AC-23: Chân thứ hai đang chờ của chuyển nội bộ đã ghi — gợi ý khớp; gán là gắn, không ghi thêm (ADR-81)
- Given `vcb-husband` (kết nối `default`) log `out` 250.000 lúc 11:20Z đã gán tay thành `transfer` `vcb-husband` → `vcb-wife` (giao dịch `T`); log `in` 250.000 cùng lúc ở `vcb-wife` (kết nối `sepay-wife`) từng được gán tay thành giao dịch thứ hai — sổ −500.000 / +500.000 như prod — rồi gỡ gán giao dịch thứ hai (UC-306), log về `pending`
- When `GET /v1/logs`; rồi gán log đó `[{meaning:"transfer", amount:250000, other_account_id:"vcb-husband"}]`
- Then gợi ý `{meaning:"transfer", other_account_id:"vcb-husband", attach_to_tx: T, label:"Khớp chuyển nội bộ đã ghi lúc 18:20"}`; phản hồi `attached: true`, `transactions = [T]` với `log_id` = chân ra, `log_id_2` = chân vào; log `assigned`; đúng 1 giao dịch `active`, `book_balance` `vcb-husband` −250.000, `vcb-wife` +250.000
- And log lệch quá 10 phút (11:30:01Z) không được gợi ý `attach_to_tx`; gán nó → `attached: false`, ghi giao dịch riêng như cũ
- Tests: [`test/ingest.test.ts`](../../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › chân thứ hai đang chờ (như prod sau khi gỡ giao dịch ghi lần hai): gợi ý khớp; gán tay thì gắn vào giao dịch đã ghi"; [`test/ingest.test.ts`](../../test/ingest.test.ts) › "chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81) › lệch số tiền, lệch quá 10 phút, hay đầu kia khác tài khoản → không gắn: chờ gán, gán thì ghi giao dịch riêng"

### AC-24: Log tiền ra không khớp rule mà không phải rút tiền → không gợi ý Rút tiền mặt
- Given `vcb-husband` báo cả tiền ra, chủ có `cash-husband`
- When log `out` không khớp rule với nội dung "MBVCB.1234567.THANH TOAN QR.CT tu 0011xxxxxxx", "THANH TOAN HOA DON DIEN EVN", "CHUYEN TIEN CHO ANH BA", "khong khop gi ca"
- Then mỗi log `suggestion = null`; nội dung chỉ chứa "ATM" giữa một từ khác ("ATMOSPHERE COFFEE QR") hay mã lệnh `PF` cũng không được coi là rút tiền
- Tests: `test/ingest.test.ts` › "gợi ý Rút tiền mặt chỉ cho log `out` trông như rút tiền › trả QR, hoá đơn, chuyển khoản không khớp rule → không gợi ý Rút tiền mặt (màn Gán mặc định Chi tiêu)"; `test/rules.test.ts` › "looksLikeCashWithdrawal › nội dung rút tiền mặt (ATM, RUT TIEN, RUT TM, CASH WITHDRAWAL) — có dấu, thường hay hoa đều nhận"; `test/rules.test.ts` › "looksLikeCashWithdrawal › trả QR, hoá đơn, chuyển khoản, tên quán chứa ATM giữa chữ → không phải rút tiền"

### AC-25: Gán log tiền vào là hoàn tiền nối về khoản chi gốc (`link_id`)
- Given log `out` 244.000 ở `vcb-husband` đã gán thành khoản chi `health` (giao dịch S); log `in` 250.000 ở `vcb-husband`
- When gán `[{meaning:"refund", amount:250000, wallet_id:"nice-to-have", link_id:S}]` (không gửi danh mục); ở log khác gán `refund` với `link_id` = một khoản thu, = 9999, = `"12"` (chuỗi)
- Then 201, giao dịch `refund` có `link_id = S`, `category_id = 'health'` (lấy của khoản gốc), `wallet_id = 'nice-to-have'`, `counter_account_id = 'vcb-husband'`, `source = 'sepay'`; ví `nice-to-have` sau cả hai khoản dư 6.000; ba lần sau lần lượt 400 `invalid_link`, `invalid_link`, `invalid_input`, không giao dịch nào thêm, log vẫn `pending`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu) › gán log tiền vào là hoàn tiền có link_id: nối khoản chi gốc, danh mục theo khoản gốc; phần chênh nằm lại trong ví của danh mục"; [`test/logs.test.ts`](../../test/logs.test.ts) › "trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu) › link_id phải trỏ về khoản chi còn hiệu lực: không thì invalid_link (như nhập tay), log vẫn chờ, không ghi gì"

### AC-26: Gán log tiền vào là nhận lại tiền cho vay nối về khoản cho vay gốc (`link_id`)
- Given Chị Lan và Em Hai (số 0); log `out` 1.000.000 ở `vcb-husband` đã gán thành cho vay gắn Chị Lan (giao dịch L); một khoản chi S; log `in` 600.000 "CHI LAN TRA TIEN"
- When gán `[{meaning:"collect", amount:600000, link_id:L}]` (không gửi người); ở log khác gán `collect` `link_id = L` kèm `receivable_id = em-hai`, `collect` `link_id = S`, `refund` `link_id = L`
- Then 201, giao dịch `collect` có `link_id = L`, `receivable_id` = Chị Lan, không ví, không danh mục; Chị Lan còn 400.000; ba lần sau 400 `invalid_link`, không giao dịch nào thêm, log vẫn `pending`
- Tests: [`test/logs.test.ts`](../../test/logs.test.ts) › "trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc) › gán log tiền vào là nhận lại có link_id về khoản cho vay: lấy người của khoản cho vay; khác người hay trỏ khoản chi → invalid_link, log vẫn chờ"

## Traceability
- Code: `src/routes/logs.ts` › `logs.get("/logs")`, `logs.post("/logs/:id/assign")`, `logs.post("/logs/:id/ignore")`, `parseSplit`, `SPLIT_MEANINGS`; `src/services/ingest.ts` › `Split`, `listPendingLogs`, `suggestFor`, `loadRuleRows`, `findPossibleTwin`, `findSingleLegTransfer`, `attachSecondLeg`, `cashAccountFor`, `assignLog`, `splitToEntryInput`, `ignoreLog`, `createRuleFromSplit`, `commit`; `src/services/ledger.ts` › `resolveLink`; `src/domain/rules.ts` › `suggestRulePattern`, `matchRule`, `looksLikeCashWithdrawal`; `src/domain/entry.ts` › `buildEntry`; `src/mcp/tools.ts` › `list_pending_logs`, `assign_log`
- Migrations/DB: `trg_tx_needs_pending_log` (migration 0005); `transactions.income_stream_id`, `transactions.tenant_id`, `rules.tenant_id`, view `v_tenant_balance` (`migrations/0007_income_streams_rental.sql`); `accounts.sepay_out` (`migrations/0010_bank_catalog.sql`); `transactions.debt_id`, view `v_debt_balance` (`migrations/0013_debts.sql`); meaning `collect`, `transactions.receivable_id`, view `v_receivable_balance` (`migrations/0014_receivables.sql`); `rules.account_id`, `rules.counter_account_id`, `rules.from_wallet_id`, rule heo đất (`migrations/0017_heo_dat.sql`, mẫu `TICH LUY` ở `migrations/0019_heo_settlement_rule.sql`, ví đích Tích sản ở `migrations/0020_heo_tich_san.sql`)

## Divergences & Open Questions
- [DIVERGENCE] `phase-04-ingest-sepay.md` §Endpoints: body assign chỉ có `splits`; code thêm `create_rule` và `other_account_id`, `taxable`, `asset_kind`.
- Đã đóng 2026-10-03 (v15): [DIVERGENCE] cũ "gợi ý Rút tiền mặt theo docs §6 dành cho rút ATM; code gợi ý cho **mọi** log `out` không khớp rule (kể cả trả quán qua QR)" — nay chỉ gợi ý khi nội dung trông như rút tiền mặt (bước 2).
- [OPEN] `assignLog` không đối chiếu `meaning` với `direction` (ví dụ gán `spend` cho log `in`, `income` cho log `out` đều qua kiểm). Không có test.
- [OPEN] Log `account_id NULL` (TK lạ): `splitToEntryInput` truyền `account_id` rỗng nên `buildEntry` rơi về TK tiền mặt của người gán cho `spend`/`refund`/`lend`/`collect` — [INFERENCE] từ `src/domain/entry.ts` › `defaultAccount`; tiền ngân hàng có thể bị ghi vào TK tiền mặt. Không có test.
- [OPEN] `not_found` của assign trả 400 trong khi ignore trả 404 (`fail()` mặc định 400).
- [OPEN] Mô tả tool MCP `list_pending_logs`/`assign_log` vẫn ghi "hiện chưa triển khai" (`src/mcp/tools.ts`) dù đã chạy (thuộc mcp UC-604).
- [DIVERGENCE] Proposal `261001-cho-thue-lai` UC-805: xác nhận tiền người thuê → ghi `income` rồi ghi thêm `TenantLine(payment)`. Code không có loại dòng `payment`: chính giao dịch `income` mang `tenant_id` làm giảm số dư (view `v_tenant_balance`), nên huỷ khoản thu là số dư tự trở lại.
- [OPEN] `create_rule` vẫn chỉ cho `spend`/`transfer`, nên không tạo được rule người thuê từ một lần gán; rule người thuê chỉ tạo được qua `POST /v1/rules` (UC-307) — PWA không có chỗ tạo.
- [OPEN] Lời nhắc rút heo về nói "tới khi anh tự chuyển ví" nhưng Tích sản khóa chiều ra: gán kèm `from_wallet_id` = Tích sản bị `locked_wallet` (bước 6.1). App chưa có đường đưa tiền heo đã rút về ra khỏi Tích sản (ADR-82).
- [OPEN] Heo trả về nhiều hơn sổ heo (lãi, hoặc tiền heo có từ trước khi dùng app vì heo mở sổ `opening_balance = 0`): gán cả số tiền là Chuyển nội bộ thì sổ heo âm đúng phần đó; không còn lời nhắc tách lãi — người gán tự tách dòng Thu nhập, hoặc nhập số dư đầu thật / đếm số dư heo (ledger UC-105) (ADR-82).
