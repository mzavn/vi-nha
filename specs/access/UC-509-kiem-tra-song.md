# UC-509: Kiểm tra sống (health)
- Status: implemented
- BR: BR-10
- Decisions: `plans/260921-2228-profit-first-pwa/phase-01-worker-d1.md` (Mục tiêu, Todo "`/v1/health` đọc phiên bản từ đó", Success criteria); ADR-92 (migration 0028, schema `1.28`); ADR-94 (migration 0029, schema `1.29`); ADR-95 (migration 0030, schema `1.30`)
- Actor: Người vận hành / công cụ giám sát / script deploy
- Trigger: `GET /v1/health`

## History
- v1 (2026-09-22, commit `a773716`): route health đọc `config.schema_version`.
- v2 (2026-10-01, commit `034b7ff`): migration 0007 đưa `schema_version` lên `1.7` — health trả `v1.7` (change `261001-cho-thue-lai`).
- v3 (2026-10-01, commit `5dc53be`): migration 0008 đưa `schema_version` lên `1.8` — health trả `v1.8` (change `261001-pwa-web-push`).
- v4 (2026-10-01, commit `7b71600`): migration 0009 đưa `schema_version` lên `1.9` — health trả `v1.9` (lượt "Thử khi tắt app", notify UC-410).
- v5 (2026-10-01, commit `39751b8`): migration 0010 đưa `schema_version` lên `1.10` — health trả `v1.10` (danh mục ngân hàng, ADR-66).
- v6 (2026-10-01, commit `a301077`): migration 0011 đưa `schema_version` lên `1.11` — health trả `v1.11` (giờ nhắc, ADR-68).
- v7 (2026-10-01, commit `e72b5de`): migration 0012 đưa `schema_version` lên `1.12` — health trả `v1.12` (nhịp cron 15 phút, ADR-70).
- v8 (2026-10-01, commit `25db5b9`): migration 0013 đưa `schema_version` lên `1.13` — health trả `v1.13` (sổ nợ, ADR-71).
- v9 (2026-10-01, commit `2438ac0`): migration 0014 đưa `schema_version` lên `1.14` — health trả `v1.14` (sổ phải thu, meaning `collect`, ADR-72).
- v10 (2026-10-03, commit `a8703fd`): migration 0015 đưa `schema_version` lên `1.15` — health trả `v1.15` (nhiều kết nối SePay, ADR-75).
- v11 (2026-10-03, commit `f74bc70`): migration 0016 đưa `schema_version` lên `1.16` — health trả `v1.16` (`v_account_logs` theo ngày mở sổ, ADR-76).
- v12 (2026-10-03, commit `f74bc70`): migration 0017 đưa `schema_version` lên `1.17` — health trả `v1.17` (heo đất: `accounts.locked`, rule gắn tài khoản, ADR-77).
- v13 (2026-10-03, commit `5bd3117`): migration 0018 đưa `schema_version` lên `1.18` — health trả `v1.18` (Zalo Bot: `members.zalo_chat_id`, `zalo_link_codes`, ADR-80).
- v14 (2026-10-03, commit `c67420e`): migration 0019 đưa `schema_version` lên `1.19` — health trả `v1.19` (rule heo đất mẫu `TICH LUY` cho MB tất toán sổ tích lũy, ADR-77; không đổi cấu trúc bảng).
- v15 (2026-10-03, commit `e00814c`): migration 0020 đưa `schema_version` lên `1.20` — health trả `v1.20` (heo đất là Tích sản: rule heo → ví Tích sản, số dư ví `heo-dat` sang Tích sản, tắt ví `heo-dat`, ADR-82; chỉ đổi dữ liệu, không đổi cấu trúc bảng).
- v16 (2026-10-03, commit `85e6558`): migration 0021 (ADR-83) đưa `schema_version` lên `1.21` — health trả `v1.21`.
- v17 (2026-10-06, commit `9c265ee`): migration 0023 (ADR-87 — bỏ `bank_logs.accumulated`, view `v_account_bank`) đưa `schema_version` lên `1.23` — health trả `v1.23` (0022, ADR-85, đã đưa lên `1.22`).
- v18 (2026-10-06, commit `9c265ee`): migration 0024 (ADR-88 — `accounts.role`, tài khoản Tích sản) đưa `schema_version` lên `1.24` — health trả `v1.24`.
- v19 (2026-10-07, commit `7424f26`): migration 0028 (ADR-92 — giá trị lưu tiếng Anh: `wallets.tier`, `accounts.role`, `config.safety_fund_months`, view `v_wealth_building`, `v_safety_fund`) đưa `schema_version` lên `1.28` — health trả `v1.28` (0025, 0026, 0027 đã đưa lên `1.25`, `1.26`, `1.27`). AC-1 sửa theo test (change [261007-doi-ten-tieng-anh](../changes/archive/261007-doi-ten-tieng-anh/proposal.md))
- v20 (2026-10-08, commit `21b9db0`): migration 0029 (ADR-94 — mã hệ thống tiếng Anh: kết nối SePay `default`, danh mục `debt-payment` / `lending`, nguồn `rental`, icon danh mục) đưa `schema_version` lên `1.29` — health trả `v1.29` (change [261007-ma-tieng-anh-an-danh](../changes/archive/261007-ma-tieng-anh-an-danh/proposal.md))
- v21 (2026-10-08, commit `1ed22e1`): migration 0030 (ADR-95 — `members.password_hash`, `members.session_gen`, `config.setup_done`) đưa `schema_version` lên `1.30` — health trả `v1.30` (change [261007-thiet-lap-lan-dau](../changes/archive/261007-thiet-lap-lan-dau/proposal.md))

## Preconditions
- Không cần xác thực (mount trước `requireAuth`, UC-503).

## Main Flow
1. Đọc `config` khoá `schema_version`.
2. Có → `200 { ok: true, db: "v<schema_version>" }` (hiện `v1.30`). Không trả thông tin nào khác.

## Alternative Flows
- Không có.

## Exceptions
- E1. Không có dòng `schema_version` (D1 chưa chạy migration) → `503 { ok: false, error: { code: "db_not_migrated", message: "Chưa chạy migration D1." } }`.

## Acceptance Criteria
### AC-1: Trả phiên bản schema, không cần token
- Given D1 đã chạy đủ migration
- When `GET /v1/health` không header
- Then `200 { ok: true, db: "v1.30" }`
- Tests: `test/app.test.ts` › "GET /v1/health › trả phiên bản schema, không cần token"

### AC-2: D1 chưa migrate → 503
- Given bảng `config` rỗng
- When `GET /v1/health`
- Then 503
- Tests: `test/app.test.ts` › "GET /v1/health › báo 503 khi D1 chưa chạy migration"

## Traceability
- Code: `src/routes/health.ts` › `health.get("/")`; `src/index.ts` › `app.route("/v1/health", health)`
- Migrations/DB: `config('schema_version')` — `migrations/0001_schema.sql` (`1.3`), cập nhật ở `0003` (`1.4`), `0005` (`1.5`), `0006` (`1.6`), `0007` (`1.7`), `0008` (`1.8`), `0009` (`1.9`), `0010` (`1.10`), `0011` (`1.11`), `0012` (`1.12`), `0013` (`1.13`), `0014` (`1.14`), `0015` (`1.15`), `0016` (`1.16`), `0017` (`1.17`), `0018` (`1.18`), `0019` (`1.19`), `0020` (`1.20`), `0021` (`1.21`), `0022` (`1.22`), `0023` (`1.23`), `0024` (`1.24`), `0025` (`1.25`), `0026` (`1.26`), `0027` (`1.27`), `0028` (`1.28`), `0029` (`1.29`), `0030` (`1.30`)

## Divergences & Open Questions
- [DIVERGENCE] `phase-01-worker-d1.md` ghi `{ok:true, db:"v1.3"}` — là giá trị lúc lập plan; code đọc động, hiện là `v1.30` (`migrations/0030_setup_and_member_passwords.sql`). Không phải lỗi, chỉ là plan cũ.
- [OPEN] Phản hồi health không theo khuôn `{ ok, data }` như các route `/v1` khác (trả `db` ở cấp trên cùng).
- [OPEN] Lỗi D1 khi đọc (không phải thiếu dòng) không được bắt riêng → rơi vào `app.onError` → 500 `internal`.
