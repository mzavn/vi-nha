-- ============================================================
--  PROFIT FIRST — HỘ GIA ĐÌNH · SCHEMA (D1 / SQLite)  v1.29
--  v1.2 (20/9/2026): danh mục · tiền mặt · đa TK · thuế taxable ·
--  lệnh chuyển tiền · thông báo
--  v1.3 (21/9/2026): ngân sách theo kỳ chuyển sang query có tham số ·
--  phao chỉ tính nhóm Must và tháng đã kết thúc · đối soát hai lớp ·
--  bank_logs nhận cả log vá từ API lịch sử
--  v1.4 (22/9/2026): client_id cho nhập offline · allocation_runs chống chia hai lần
--  v1.5 (22/9/2026): chốt chặn một giao dịch ngân hàng không vào sổ hai lần (unique ref + trigger)
--  v1.6 (22/9/2026): không gỡ được lần chia mà tiền đã chuyển thật
--  v1.7 (1/10/2026): nguồn thu có phần khóa riêng · ví quỹ giữ riêng (holding không phải Thu nhập) ·
--                    phong bì tháng chia tuần · sổ người thuê (change 261001-cho-thue-lai)
--  v1.8 (1/10/2026): thông báo đẩy trên PWA — push_subscriptions, khoá VAPID trong config (change 261001-pwa-web-push)
--  v1.9 (1/10/2026): thử thông báo khi app đã tắt — push_test_series (request gửi nền 1–2 tin, cron mỗi phút dọn lượt kẹt)
--  v1.10 (1/10/2026): danh mục ngân hàng theo tài liệu SePay — accounts.bank là mã danh mục, accounts.sepay_out (ADR-66)
--  v1.11 (1/10/2026): giờ nhắc chỉnh trong app — khoá notify_* trong config, mốc daily_run/weekly_run trong notifications,
--                     cron còn 02:00 và mỗi 5 phút (ADR-68)
--  v1.12 (1/10/2026): cron mỗi 15 phút (01:00–03:59 VN mỗi giờ), giờ nhắc làm tròn xuống bội số 15 phút (ADR-70)
--  v1.13 (1/10/2026): sổ nợ — debts · debt_lines (chỉ ghi thêm) · transactions.debt_id · v_debt_balance (ADR-71)
--  v1.14 (2/10/2026): sổ phải thu — receivables · receivable_lines (chỉ ghi thêm) · transactions.receivable_id ·
--                     meaning 'collect' (nhận lại tiền cho vay, không cộng ví) · v_receivable_balance (ADR-72)
--  v1.15 (3/10/2026): nhiều kết nối SePay — sepay_connections (mỗi kết nối một token API + một khoá webhook) ·
--                     accounts.sepay_connection_id; khoá SePay cũ trong config chuyển sang kết nối 'chinh' (ADR-75)
--  v1.16 (3/10/2026): số dư đầu là mốc — v_account_logs chỉ cộng log từ ngày accounts.opened_at (giờ VN) trở đi;
--                     log trước ngày đó ingest lưu 'ignored' vì đã nằm trong opening_balance (ADR-76)
--  v1.17 (3/10/2026): Tiết kiệm tiền lẻ MB = heo đất — accounts.locked (tiền thật chưa rút ngay) · rules.account_id
--                     (rule chỉ áp cho một tài khoản) · rules.counter_account_id + from_wallet_id (rule chuyển nội bộ
--                     tới tài khoản đó kèm chuyển ví); seed heo đất mỗi người + ví giữ riêng 'heo-dat' (ADR-77)
--  v1.18 (3/10/2026): Zalo Bot là kênh thông báo thứ ba — members.zalo_chat_id (nối bằng mã 6 số nhắn cho bot) ·
--                     zalo_link_codes (mã đang chờ, hạn 15 phút, dùng một lần) (ADR-80)
--  v1.19 (3/10/2026): heo đất trả về tài khoản — seed thêm rule mẫu 'TICH LUY' (MB tất toán sổ tích lũy) cho mọi
--                     tài khoản MBBank của người có heo, như rule heo của v1.17; không đổi cấu trúc bảng (ADR-77)
--  v1.20 (3/10/2026): heo đất là Tích sản — rule heo chuyển ví Có thì tốt → Tích sản; số dư ví 'heo-dat' sang Tích
--                     sản bằng một transfer hệ thống chỉ đổi ví, rồi tắt ví; không đổi cấu trúc bảng (ADR-82)
--  v1.21 (3/10/2026): v_account_bank bỏ accumulated âm ở tài khoản không phải thẻ tín dụng — SePay báo số "lũy kế"
--                     âm cho một tài khoản MB chi tiêu (−600.000 khi số dư thật ~200.000) nên không phải số dư ngân hàng (ADR-83)
--  v1.22 (6/10/2026): "Tiền chi được" ở Hôm nay — accounts.spendable (số dư sổ có tính vào tiền chi được không;
--                     thẻ tín dụng và heo đất mặc định tắt, heo đất không bao giờ tính) (ADR-85)
--  v1.23 (6/10/2026): bỏ hẳn số lũy kế SePay — bank_logs.accumulated và view v_account_bank bỏ; v_reconcile
--                     không còn bank_balance / feed_drift (số SePay báo sai cả hai dấu, ADR-87)
--  v1.24 (6/10/2026): tài khoản Tích sản — accounts.role ('heo' | 'phao' | 'so-tiet-kiem'): tiền chuyển vào từ
--                     tài khoản thường là Tích sản (Có thì tốt → Tích sản); phao không khóa, heo / sổ khóa (ADR-88)
--  v1.25 (6/10/2026): chặn dò mật khẩu / khoá webhook — auth_failures đếm lần sai theo IP trong 15 phút;
--                     config 'session_epoch' (thế hệ phiên, "Đăng xuất mọi máy") (ADR-89)
--  v1.26 (6/10/2026): nhật ký thay đổi audit_log (chỉ thêm); zalo_link_codes nhớ ai tạo mã; zalo_code_failures
--                     đếm mã Zalo nhắn sai theo chat (5 lần / giờ) (ADR-90)
--  v1.27 (7/10/2026): chỉ dữ liệu — số dư có sẵn của tài khoản Tích sản (heo / phao / sổ) vào Tích sản bằng một bút
--                     toán hệ thống chỉ ghi có ví Tích sản, transactions.batch_id 'O:…' (ADR-91)
--  v1.28 (7/10/2026): tên tiếng Anh trong dữ liệu — wallets.tier 'wealth_building' (cũ 'tichsan'), accounts.role
--                     'piggy_bank' | 'buffer' | 'term_deposit' (cũ heo / phao / so-tiet-kiem); config 'safety_fund_months'
--                     (Quỹ an tâm, cũ emergency_months); view v_wealth_building, v_safety_fund
--  v1.29 (7/10/2026): mã hệ thống tiếng Anh — kết nối SePay 'default' (cũ 'chinh'), danh mục 'debt-payment' /
--                     'lending' (cũ tra-no / cho-vay), nguồn thu 'rental' (cũ cho-thue, cả config rental_*);
--                     icon danh mục nằm ở categories.icon (cũ: bảng trong code); không đổi cấu trúc bảng
--  v1.30 (8/10/2026): thiết lập nhà lần đầu + mật khẩu riêng tuỳ chọn — members.password_hash (NULL = mật khẩu
--                     chung), members.session_gen; config 'setup_done', 'secret:session_key' (UC-510, UC-501)
-- ============================================================
--  NGUYÊN TẮC ENCODE:
--   1. Hai lớp: bank_logs (thô, BẤT BIẾN) vs transactions (đã diễn giải)
--   2. Sổ CHỈ GHI THÊM — không xoá; huỷ = status='void'
--   3. Hướng tiền ≠ ý nghĩa → `meaning` quyết định, không phải `direction`
--   4. Chỉ lưu SỰ THẬT THÔ. Số dư / đã tiêu / tiến độ = TÍNH RA bằng VIEW
--   5. Đơn vị là HỘ GIA ĐÌNH; `by_member_id` chỉ là nhãn "ai chi"
--   6. BA TRỤC ĐỘC LẬP: ví (ngân sách) · tài khoản (tiền nằm đâu) · danh mục (loại chi)
--
--  QUY ƯỚC DẤU — MỘT LUẬT, KHÔNG NGOẠI LỆ (v1.2 dọn lại từ v1.1):
--   wallet_id          = ví ĐƯỢC CỘNG  (+)
--   counter_wallet_id  = ví BỊ TRỪ     (-)
--   => spend: counter_wallet_id = ví bị trừ, wallet_id = NULL
--      refund: wallet_id = ví được hoàn, counter_wallet_id = NULL
--      lend / collect: KHÔNG ví nào; lend: account_id = tiền ra · collect: counter_account_id = tiền về
--   account_id         = tài khoản tiền RA
--   counter_account_id = tài khoản tiền VÀO
--  Tiền: INTEGER VND, không dùng float.
-- ============================================================

PRAGMA foreign_keys = ON;

-- 1. THÀNH VIÊN — nhãn, KHÔNG phải chủ sở hữu tiền ------------
CREATE TABLE members (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'adult'
             CHECK (role IN ('owner','adult','teen','child','guest')),
  tg_chat_id TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  zalo_chat_id TEXT,                       -- chat riêng với bot Zalo; chỉ webhook ghi (nhắn mã nối), NULL = chưa nối
  password_hash TEXT,                      -- mật khẩu riêng: 'pbkdf2-sha256$<vòng>$<muối>$<băm>' (base64url); NULL = dùng mật khẩu chung
  session_gen  INTEGER NOT NULL DEFAULT 0  -- tăng khi đặt / đổi / gỡ mật khẩu riêng hay tắt người → cookie cũ của người đó hết hiệu lực
);

-- 1a. MÃ NỐI ZALO — mỗi người tối đa một mã đang chờ (6 số, hạn 15 phút, dùng xong thì xoá) ---------
--  Người đó nhắn mã cho bot; webhook /webhooks/zalo đọc chat.id của tin và ghi vào members.zalo_chat_id.
--  Chỉ tạo được mã cho người CHƯA nối Zalo (nối lại phải bỏ nối trước). created_by / created_via: ai tạo mã, để
--  dòng nhật ký lúc mã được dùng ghi đúng người (ADR-90).
CREATE TABLE zalo_link_codes (
  member_id   TEXT PRIMARY KEY REFERENCES members(id),
  code        TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,              -- ISO UTC
  created_by  TEXT REFERENCES members(id),
  created_via TEXT CHECK (created_via IS NULL OR created_via IN ('session','token','mcp'))
);

-- 1a'. MÃ ZALO NHẮN SAI — mỗi lần một chat nhắn mã 6 số không khớp một dòng (ADR-90) ---------
--  Quá 5 dòng trong 1 giờ thì chat đó không được thử mã tới khi hết giờ; dòng cũ hơn 1 giờ dọn ở lần sai sau.
CREATE TABLE zalo_code_failures (
  id      INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  at      TEXT NOT NULL                -- ISO UTC
);
CREATE INDEX idx_zalo_code_failures_chat ON zalo_code_failures(chat_id, at);

-- 1b. KẾT NỐI SEPAY — mỗi tài khoản công ty SePay một dòng (chồng, vợ) ---------
--  Khoá không bao giờ trả ra ngoài (chỉ đã đặt / 2 ký tự cuối). Kết nối 'default' (mặc định) còn dùng được
--  `wrangler secret` SEPAY_API_TOKEN / SEPAY_API_KEY khi cột để trống. Webhook nhận khoá của mọi kết nối đang bật;
--  log chỉ khớp vào tài khoản thuộc đúng kết nối có khoá đó.
CREATE TABLE sepay_connections (
  id          TEXT PRIMARY KEY,               -- 'default', 'sepay-wife'
  name        TEXT NOT NULL,
  api_token   TEXT,                           -- rà soát 02:00 và đồng bộ lại theo khoảng ngày
  webhook_key TEXT,                           -- SePay gửi kèm: Authorization: Apikey <khoá>
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO sepay_connections (id, name) VALUES ('default', 'SePay chính');

-- 2. TÀI KHOẢN — nơi tiền thật NẰM ----------------------------
CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,           -- 'vcb-husband','cash-husband'
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'bank'
                  CHECK (kind IN ('bank','cash','ewallet','credit')),
  bank            TEXT,                       -- mã trong src/domain/banks.ts (bank/credit); ví điện tử: tên tự do
  account_no      TEXT,                       -- khớp webhook SePay
  sub_account     TEXT,
  sepay_enabled   INTEGER NOT NULL DEFAULT 0, -- 0 -> chỉ nhập tay; 1 -> SePay báo tiền vào
  sepay_out       INTEGER NOT NULL DEFAULT 0  -- 1 -> SePay báo cả tiền ra (chặn nhập tay chiều ra)
                  CHECK (sepay_out IN (0,1)),
  owner_member_id TEXT REFERENCES members(id),
  sepay_connection_id TEXT REFERENCES sepay_connections(id), -- bật SePay thì thuộc đúng một kết nối
  opening_balance INTEGER NOT NULL DEFAULT 0, -- số dư lúc bắt đầu ngày opened_at: gồm mọi khoản trước ngày đó
  opened_at       TEXT,                       -- 'YYYY-MM-DD' giờ VN; log/giao dịch trước ngày này không vào sổ (ADR-76)
  active          INTEGER NOT NULL DEFAULT 1,
  locked          INTEGER NOT NULL DEFAULT 0      -- 1 -> tiền thật nhưng chưa rút ngay được (heo đất, ADR-77)
                  CHECK (locked IN (0,1)),
  spendable       INTEGER NOT NULL DEFAULT 1      -- 1 -> số dư sổ tính vào "Tiền chi được"; locked = 1 thì không bao giờ (ADR-85)
                  CHECK (spendable IN (0,1)),
  role            TEXT                            -- tài khoản Tích sản (ADR-88): NULL thường · piggy_bank (heo đất) · buffer (phao dự phòng) · term_deposit (sổ tiết kiệm)
                  CHECK (role IS NULL OR (role IN ('piggy_bank','term_deposit') AND locked = 1) OR (role = 'buffer' AND locked = 0))
);
CREATE UNIQUE INDEX idx_acct_no ON accounts(account_no) WHERE account_no IS NOT NULL;

-- 3. VÍ — ĐƠN VỊ NGÂN SÁCH ------------------------------------
--    tier = PHE, thứ tự RÓT: wealth_building -> tax -> nice -> must
--    (holding = trạm trung chuyển, không thuộc dòng rót)
CREATE TABLE wallets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  tier       TEXT NOT NULL
             CHECK (tier IN ('holding','wealth_building','tax','nice','must')),
  must_group TEXT CHECK (must_group IN ('must','have')),  -- chỉ dùng khi tier='must'
  kind       TEXT NOT NULL
             CHECK (kind IN ('envelope','accrual','bill','holding')),
  scope      TEXT NOT NULL DEFAULT 'shared' CHECK (scope IN ('shared','personal')),
  member_id  TEXT REFERENCES members(id),     -- khi scope='personal'
  account_id TEXT REFERENCES accounts(id),    -- ví này TRÚ ở tài khoản nào
  private    INTEGER NOT NULL DEFAULT 0,      -- ẩn số dư với người khác
  sort       INTEGER NOT NULL DEFAULT 100,
  active     INTEGER NOT NULL DEFAULT 1,
  CHECK (scope <> 'personal' OR member_id IS NOT NULL),
  CHECK (tier  <> 'must'     OR must_group IS NOT NULL)
);

-- 4. LUẬT NẠP + MỤC TIÊU — target nằm ở LUẬT NẠP, không ở ví ---
CREATE TABLE allocations (
  id            INTEGER PRIMARY KEY,
  wallet_id     TEXT NOT NULL REFERENCES wallets(id),
  mode          TEXT NOT NULL CHECK (mode IN ('flat','percent','goal','lump','remainder')),
  period        TEXT CHECK (period IN ('week','month')),
  amount        INTEGER,        -- flat
  percent       REAL,           -- percent (0.30)
  target_amount INTEGER,        -- goal / lump
  target_date   TEXT,
  floor_amount  INTEGER,        -- SÀN CỨNG — không bóp xuống dưới
  priority      INTEGER NOT NULL DEFAULT 100,
  start_date    TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  split_weekly  INTEGER NOT NULL DEFAULT 0 CHECK (split_weekly IN (0,1)),  -- phong bì tháng: dự kiến tuần = tháng ÷ số thứ Hai
  CHECK (mode <> 'flat'    OR amount  IS NOT NULL),
  CHECK (mode <> 'percent' OR percent IS NOT NULL),
  CHECK (mode <> 'goal'    OR (target_amount IS NOT NULL AND target_date IS NOT NULL))
);
CREATE INDEX idx_alloc_wallet ON allocations(wallet_id, active);

-- 5. DANH MỤC CHI — nhãn phân tích, KHÔNG có ngân sách riêng ---
CREATE TABLE categories (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  default_wallet_id TEXT REFERENCES wallets(id),
  icon              TEXT,                    -- tên icon trong web/src/ui/icons.tsx; NULL / tên lạ = icon nhãn
  sort              INTEGER NOT NULL DEFAULT 100,
  active            INTEGER NOT NULL DEFAULT 1
);

-- 6. LOG NGÂN HÀNG (LỚP 1) — BẤT BIẾN -------------------------
CREATE TABLE bank_logs (
  id          TEXT PRIMARY KEY,              -- id SePay -> chống trùng
  at          TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  account_id  TEXT REFERENCES accounts(id),
  account_no  TEXT,
  content     TEXT,
  ref_code    TEXT,
  reference_number TEXT,                     -- mã tham chiếu ngân hàng: có ở cả webhook lẫn API lịch sử
  raw         TEXT,
  source      TEXT NOT NULL DEFAULT 'webhook'
              CHECK (source IN ('webhook','backfill')),  -- backfill = cron 02:00 vá giao dịch webhook bỏ sót
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','assigned','ignored')),
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_logs_status ON bank_logs(status, at DESC);
CREATE INDEX idx_logs_acct   ON bank_logs(account_id, at DESC);
CREATE INDEX idx_logs_pair   ON bank_logs(amount, direction, at);
CREATE UNIQUE INDEX idx_logs_ref ON bank_logs(account_id, reference_number)
  WHERE reference_number IS NOT NULL AND reference_number <> '';  -- webhook + API lịch sử cùng một giao dịch → một log

-- 7. GIAO DỊCH ĐÃ DIỄN GIẢI (LỚP 2) — append-only -------------
CREATE TABLE transactions (
  id          INTEGER PRIMARY KEY,
  log_id      TEXT REFERENCES bank_logs(id),
  log_id_2    TEXT REFERENCES bank_logs(id),  -- chân thứ 2 khi ghép cặp transfer nội bộ
  at          TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  meaning     TEXT NOT NULL CHECK (meaning IN (
                'spend','income','refund','transfer','fund',
                'buy_asset','lend','collect','adjust')),
  wallet_id          TEXT REFERENCES wallets(id),
  counter_wallet_id  TEXT REFERENCES wallets(id),
  account_id         TEXT REFERENCES accounts(id),
  counter_account_id TEXT REFERENCES accounts(id),
  category_id  TEXT REFERENCES categories(id),   -- BẮT BUỘC khi meaning='spend' (enforce ở BE)
  by_member_id TEXT REFERENCES members(id),
  link_id      INTEGER REFERENCES transactions(id),  -- refund -> spend gốc; collect -> lend gốc; fund -> income của lần chia
  batch_id     TEXT,                                 -- lần chia lương
  asset_kind   TEXT,                                 -- buy_asset: 'stock','gold','re','fund'
  taxable      INTEGER NOT NULL DEFAULT 0,           -- income có phải trích thuế không
  week_key     TEXT NOT NULL,                        -- '2026-W38' — TÍNH Ở APP (ISO)
  month_key    TEXT NOT NULL,                        -- '2026-09'
  source       TEXT NOT NULL DEFAULT 'sepay'
               CHECK (source IN ('sepay','manual','import','system')),
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  client_id    TEXT,                                 -- UUID sinh ở máy khi nhập offline -> gửi lại không ghi trùng
  income_stream_id TEXT REFERENCES income_streams(id), -- income: nguồn thu quyết phần khóa; NULL = luật percent toàn cục
  tenant_id    TEXT REFERENCES tenants(id),           -- income: tiền người thuê trả (trừ vào sổ người thuê)
  debt_id      TEXT REFERENCES debts(id),             -- spend: khoản trả nợ (trừ vào sổ nợ)
  receivable_id TEXT REFERENCES receivables(id),      -- lend: cho vay thêm · collect: nhận lại (sổ phải thu)
  CHECK (meaning <> 'refund' OR wallet_id IS NOT NULL),
  CHECK (meaning <> 'spend'  OR counter_wallet_id IS NOT NULL),
  CHECK (meaning <> 'spend'  OR category_id IS NOT NULL),
  CHECK (meaning <> 'fund'   OR (wallet_id IS NOT NULL AND counter_wallet_id IS NOT NULL))
);
CREATE INDEX idx_tx_wallet_week  ON transactions(wallet_id, week_key)  WHERE status='active';
CREATE INDEX idx_tx_wallet_month ON transactions(wallet_id, month_key) WHERE status='active';
CREATE INDEX idx_tx_cw_week      ON transactions(counter_wallet_id, week_key)  WHERE status='active';
CREATE INDEX idx_tx_cw_month     ON transactions(counter_wallet_id, month_key) WHERE status='active';
CREATE INDEX idx_tx_cat          ON transactions(category_id, month_key) WHERE status='active';
CREATE INDEX idx_tx_log          ON transactions(log_id);
CREATE INDEX idx_tx_at           ON transactions(at DESC);
CREATE UNIQUE INDEX idx_tx_client ON transactions(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_tx_batch        ON transactions(batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX idx_tx_tenant       ON transactions(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_tx_debt         ON transactions(debt_id) WHERE debt_id IS NOT NULL;
CREATE INDEX idx_tx_receivable   ON transactions(receivable_id) WHERE receivable_id IS NOT NULL;

-- 7b. MỖI KHOẢN THU CHỈ ĐƯỢC CHIA MỘT LẦN — ghi cùng batch với các fund,
--     trùng khoá chính thì cả batch huỷ (webhook gửi lại, cron vá, bấm hai lần...)
CREATE TABLE allocation_runs (
  income_tx_id INTEGER PRIMARY KEY REFERENCES transactions(id),
  batch_id     TEXT NOT NULL UNIQUE,
  at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 8. QUY TẮC TỰ GÁN — chỉ được đoán spend/transfer -------------
CREATE TABLE rules (
  id          INTEGER PRIMARY KEY,
  priority    INTEGER NOT NULL DEFAULT 100,
  match_type  TEXT NOT NULL CHECK (match_type IN ('code','content','account')),
  pattern     TEXT NOT NULL,
  meaning     TEXT NOT NULL CHECK (meaning IN ('spend','transfer','income')),
  is_salary   INTEGER NOT NULL DEFAULT 0,   -- chỉ rule lương mới được gán income
  wallet_id   TEXT REFERENCES wallets(id),
  category_id TEXT REFERENCES categories(id),
  by_member_id TEXT REFERENCES members(id),
  active      INTEGER NOT NULL DEFAULT 1,
  income_stream_id TEXT REFERENCES income_streams(id),  -- rule lương: nguồn thu của khoản khớp
  tenant_id   TEXT REFERENCES tenants(id),              -- chỉ để GỢI Ý "thu từ người thuê", không tự gán
  account_id  TEXT REFERENCES accounts(id),             -- chỉ áp cho log của tài khoản này; NULL = mọi tài khoản
  counter_account_id TEXT REFERENCES accounts(id),      -- transfer: tài khoản đầu kia (NULL = rút tiền mặt như cũ)
  from_wallet_id TEXT REFERENCES wallets(id),           -- transfer: chuyển ví from_wallet_id -> wallet_id (ADR-77)
  CHECK (meaning <> 'income' OR is_salary = 1)
);

-- 9. ĐẾM VÍ TIỀN MẶT ------------------------------------------
CREATE TABLE cash_counts (
  id           INTEGER PRIMARY KEY,
  at           TEXT NOT NULL DEFAULT (datetime('now')),
  account_id   TEXT NOT NULL REFERENCES accounts(id),
  counted      INTEGER NOT NULL,
  book         INTEGER NOT NULL,
  adjust_tx_id INTEGER REFERENCES transactions(id)
);

-- 10. LỆNH CHUYỂN TIỀN THẬT (phân bổ ảo -> tiền phải đi thật) --
CREATE TABLE transfer_orders (
  id              INTEGER PRIMARY KEY,
  batch_id        TEXT NOT NULL,
  from_account_id TEXT NOT NULL REFERENCES accounts(id),
  to_account_id   TEXT NOT NULL REFERENCES accounts(id),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  memo            TEXT NOT NULL,            -- 'PF XXXXXX' ngẫu nhiên, riêng từng lệnh -> khớp log về
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','done','skipped')),
  matched_log_id  TEXT REFERENCES bank_logs(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 11. QUYẾT TOÁN THUẾ NĂM --------------------------------------
CREATE TABLE tax_settlements (
  year          INTEGER PRIMARY KEY,
  provisioned   INTEGER NOT NULL,
  paid          INTEGER NOT NULL DEFAULT 0,
  surplus_tx_id INTEGER REFERENCES transactions(id),
  settled_at    TEXT
);

-- 12. THÔNG BÁO — idempotent cho cron --------------------------
--  Mốc chạy tin theo giờ nhắc: kind 'daily_run' (day_key = ngày VN) · 'weekly_run' (day_key = tuần ISO được tổng kết),
--  chat_id = 'system'. Lượt cron giành được mốc (INSERT OR IGNORE) mới gửi.
--  Mỗi tin một dòng mỗi nơi nhận: chat_id Telegram · 'push:<id>' (máy) · 'zalo:<chat_id>' (Zalo). Bot Zalo trả lời
--  hướng dẫn tối đa một lần mỗi chat mỗi ngày: kind 'zalo_help', day_key = ngày VN, chat_id = 'zalo:<chat_id>'.
CREATE TABLE notifications (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  kind    TEXT NOT NULL,
  day_key TEXT,
  chat_id TEXT,
  payload TEXT,
  ok      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, day_key, chat_id)
);

-- 13. CẤU HÌNH -------------------------------------------------
--  Giờ nhắc của cả nhà (migration 0011 chèn mặc định; thiếu khoá thì code dùng mặc định):
--  notify_daily_time '07:00' · notify_weekly_day '1' (ISO, 1 = thứ Hai) · notify_weekly_time '08:00' ·
--  notify_quiet_start '22:00' · notify_quiet_end '06:30' · notify_daily_enabled / notify_weekly_enabled /
--  notify_pending_enabled '1'|'0'. Giờ là "HH:MM" giờ VN, phút chia hết cho 15 (migration 0012 làm tròn xuống).
--  session_epoch: thế hệ phiên đăng nhập (thiếu = '0'); "Đăng xuất mọi máy" tăng 1 → mọi cookie cũ hết hiệu lực (ADR-89).
--  setup_done: giờ UTC thiết lập nhà xong (UC-510); thiếu = chưa thiết lập, đăng nhập trả 409 setup_required.
--  secret:session_key: khoá ký phiên ngẫu nhiên app tự sinh lần đầu cần (UC-501); không API nào trả ra.
CREATE TABLE config (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- 14. NGUỒN THU — phần khóa riêng từng nguồn (không có dòng lock = khóa 0%) ---
CREATE TABLE income_streams (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  sort   INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE income_stream_locks (
  stream_id TEXT NOT NULL REFERENCES income_streams(id),
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  percent   REAL NOT NULL CHECK (percent > 0 AND percent <= 1),
  sort      INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (stream_id, wallet_id)
);

-- 15. SỔ NGƯỜI THUÊ — phải thu, ngoài sổ cái, chỉ ghi thêm ------------
CREATE TABLE tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE tenant_fixed_fees (
  id        INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name      TEXT NOT NULL,
  amount    INTEGER NOT NULL CHECK (amount > 0),
  sort      INTEGER NOT NULL DEFAULT 100,
  active    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE tenant_lines (
  id          INTEGER PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  month_key   TEXT NOT NULL,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('opening','fixed','shared','one_off','paid_for_us','adjust')),
  name        TEXT,
  amount      INTEGER NOT NULL CHECK (amount <> 0),  -- > 0 người thuê nợ thêm; < 0 giảm nợ
  category_id TEXT REFERENCES categories(id),
  client_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (kind <> 'paid_for_us' OR (amount < 0 AND category_id IS NOT NULL))
);
CREATE INDEX idx_tenant_lines ON tenant_lines(tenant_id, month_key) WHERE status='active';
CREATE UNIQUE INDEX idx_tenant_lines_client ON tenant_lines(client_id) WHERE client_id IS NOT NULL;
CREATE TABLE tenant_settlements (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  month_key    TEXT NOT NULL,
  headcount    INTEGER NOT NULL CHECK (headcount > 0),
  shared_total INTEGER NOT NULL,
  at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, month_key)
);

-- 16. THÔNG BÁO ĐẨY TRÊN PWA — mỗi máy đã bật một dòng, gắn người đang đăng nhập ------
--  Khoá VAPID tự sinh lần đầu cần, nằm trong config: secret:vapid_private_jwk · vapid_public · vapid_subject.
--  Chống gửi trùng dùng notifications (chat_id = 'push:<id>'). Push service trả 404/410 thì xoá dòng.
CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_ok_at TEXT
);
CREATE INDEX idx_push_member ON push_subscriptions(member_id);

-- 17. LƯỢT GỬI THỬ THÔNG BÁO KHI APP ĐÃ TẮT — bấm nút ghi dòng 'running', request gửi nền (waitUntil) 1–2 tin ------
--  'running' -> 'done' | 'cancelled' (bấm Huỷ). Còn 'pending'/'running' quá 10 phút (Worker bị dừng) -> cron đổi 'cancelled'.
--  'pending' và CHECK count 1–5 / interval_s 10–60 là của bản đầu (cron gửi); code hiện chỉ ghi count 1–2, interval_s = 10.
CREATE TABLE push_test_series (
  id         INTEGER PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id),
  count      INTEGER NOT NULL CHECK (count BETWEEN 1 AND 5),
  interval_s INTEGER NOT NULL CHECK (interval_s BETWEEN 10 AND 60),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','cancelled')),
  sent       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 18. SỔ NỢ — hộ nợ người khác, ngoài sổ cái, chỉ ghi thêm ------------
--  Tiền trả nợ KHÔNG là dòng sổ: là spend có transactions.debt_id (huỷ giao dịch là số còn nợ tự đúng lại).
CREATE TABLE debts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE debt_lines (
  id         INTEGER PRIMARY KEY,
  debt_id    TEXT NOT NULL REFERENCES debts(id),
  at         TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('opening','borrow','adjust')),
  amount     INTEGER NOT NULL CHECK (amount <> 0),  -- opening/borrow > 0 nợ thêm; adjust ± chỉnh tay
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (kind = 'adjust' OR amount > 0)
);
CREATE INDEX idx_debt_lines ON debt_lines(debt_id) WHERE status='active';

-- 19. SỔ PHẢI THU — người khác nợ hộ (cho vay, trả hộ), ngoài sổ cái, chỉ ghi thêm ------------
--  Dòng sổ chỉ là ghi nhớ: không đổi ví, không đổi tài khoản. Tiền đi/về là giao dịch thật mang transactions.receivable_id:
--  lend (tiền ra) cộng số phải thu, collect (tiền về, không phải thu nhập) trừ số phải thu.
CREATE TABLE receivables (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE receivable_lines (
  id            INTEGER PRIMARY KEY,
  receivable_id TEXT NOT NULL REFERENCES receivables(id),
  at            TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('opening','adjust')),
  amount        INTEGER NOT NULL CHECK (amount <> 0),  -- opening > 0 số đang được nợ lúc mở sổ; adjust ± chỉnh tay
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (kind = 'adjust' OR amount > 0)
);
CREATE INDEX idx_receivable_lines ON receivable_lines(receivable_id) WHERE status='active';

-- 20. LẦN SAI MẬT KHẨU / KHOÁ WEBHOOK — đếm để chặn dò (ADR-89) ------------
--  Theo phạm vi ('login' | 'webhook') và IP (CF-Connecting-IP); ip = '*' là trần chung mọi IP của đăng nhập.
--  Cửa sổ cố định 15 phút từ first_at; dòng quá hạn bị xoá ở lần sai kế tiếp. Không lưu mật khẩu hay khoá đã thử.
CREATE TABLE auth_failures (
  scope    TEXT NOT NULL CHECK (scope IN ('login','webhook')),
  ip       TEXT NOT NULL,
  first_at TEXT NOT NULL,
  failures INTEGER NOT NULL CHECK (failures > 0),
  PRIMARY KEY (scope, ip)
);

-- 21. NHẬT KÝ THAY ĐỔI — ai làm gì, qua đâu, lúc nào; CHỈ THÊM (ADR-90) ------------
--  Ghi cho: huỷ / sửa / gỡ gán giao dịch; sửa tài khoản, thành viên, khoá Telegram/Zalo, kết nối SePay; thêm/gỡ máy
--  nhận thông báo; tạo mã / nối Zalo; đăng xuất mọi máy. via: 'session' (PWA) | 'token' (API_TOKEN) | 'mcp'.
--  detail là JSON KHÔNG chứa khoá/token (chỉ tên trường và giá trị không bí mật). Trigger chặn UPDATE/DELETE.
CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  member_id TEXT REFERENCES members(id),
  via       TEXT NOT NULL CHECK (via IN ('session','token','mcp')),
  action    TEXT NOT NULL,
  target    TEXT,
  detail    TEXT CHECK (detail IS NULL OR json_valid(detail))
);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log chỉ thêm, không sửa'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log chỉ thêm, không xoá'); END;

-- ============================================================
--  VIEW — MỌI CON SỐ TỔNG HỢP ĐỀU TÍNH RA, KHÔNG LƯU
-- ============================================================

-- Dòng tiền vào/ra từng ví (buy_asset, lend & collect KHÔNG đổi số dư ví)
CREATE VIEW v_wallet_flow AS
  SELECT wallet_id AS wallet_id, week_key, month_key, at, meaning, category_id, amount AS delta
  FROM transactions
  WHERE status='active' AND wallet_id IS NOT NULL AND meaning NOT IN ('buy_asset','lend','collect')
  UNION ALL
  SELECT counter_wallet_id, week_key, month_key, at, meaning, category_id, -amount
  FROM transactions
  WHERE status='active' AND counter_wallet_id IS NOT NULL AND meaning NOT IN ('buy_asset','lend','collect');

CREATE VIEW v_wallet_balance AS
  SELECT w.id AS wallet_id, w.name, w.tier, w.must_group,
         COALESCE(SUM(f.delta), 0) AS balance
  FROM wallets w LEFT JOIN v_wallet_flow f ON f.wallet_id = w.id
  GROUP BY w.id;

-- Đã tiêu ròng (chi trừ hoàn về) theo kỳ
CREATE VIEW v_spent_raw AS
  SELECT counter_wallet_id AS wallet_id, week_key, month_key, amount AS spent
  FROM transactions WHERE status='active' AND meaning='spend'
  UNION ALL
  SELECT wallet_id, week_key, month_key, -amount
  FROM transactions WHERE status='active' AND meaning='refund';

CREATE VIEW v_spent_week AS
  SELECT wallet_id, week_key, SUM(spent) AS spent FROM v_spent_raw GROUP BY wallet_id, week_key;

CREATE VIEW v_spent_month AS
  SELECT wallet_id, month_key, SUM(spent) AS spent FROM v_spent_raw GROUP BY wallet_id, month_key;

-- Ngân sách theo kỳ (dự kiến / thực tế / còn lại) KHÔNG phải view: nó cần tham số kỳ,
-- và dự kiến tháng của phong bì tuần = số tiền tuần × số thứ Hai của tháng (app tính).
-- Query nằm ở src/db/queries.ts, JOIN v_spent_week / v_spent_month theo đúng kỳ được hỏi.

-- Tiến độ mục tiêu + cần để dành mỗi kỳ để kịp hạn
CREATE VIEW v_goal_progress AS
  SELECT w.id AS wallet_id, w.name, a.target_amount, a.target_date,
         COALESCE(b.balance,0) AS balance,
         a.target_amount - COALESCE(b.balance,0) AS missing,
         ROUND(100.0*COALESCE(b.balance,0)/a.target_amount, 1) AS pct,
         MAX(CAST(julianday(a.target_date) - julianday('now') AS INTEGER), 0) AS days_left
  FROM wallets w
  JOIN allocations a ON a.wallet_id=w.id AND a.active=1 AND a.mode='goal'
  LEFT JOIN v_wallet_balance b ON b.wallet_id=w.id;

-- TÍCH SẢN: một ví, hai trạng thái tiền (cash -> assets)
CREATE VIEW v_wealth_building AS
  SELECT w.id AS wallet_id, w.name,
         COALESCE(b.balance,0) AS total,
         COALESCE((SELECT SUM(t.amount) FROM transactions t
                   WHERE t.status='active' AND t.meaning='buy_asset' AND t.wallet_id=w.id),0) AS assets,
         COALESCE(b.balance,0)
           - COALESCE((SELECT SUM(t.amount) FROM transactions t
                       WHERE t.status='active' AND t.meaning='buy_asset' AND t.wallet_id=w.id),0) AS cash
  FROM wallets w LEFT JOIN v_wallet_balance b ON b.wallet_id=w.id
  WHERE w.tier='wealth_building';

-- QUỸ AN TÂM — target TÍNH ĐỘNG: N tháng × chi Must trung bình 3 tháng gần nhất
--   N lấy từ config('safety_fund_months'). Không hardcode con số nào.
--   "Chi Must" = CHỈ nhóm Must (mức sống tối thiểu), không gồm Có-thì-tốt.
--   Chỉ tính THÁNG ĐÃ KẾT THÚC (giờ VN): tháng đang chạy mới có vài khoản chi, tính vào là Quỹ an tâm "đầy" giả.
CREATE VIEW v_must_monthly_avg AS
  SELECT AVG(m.total) AS avg_must, COUNT(*) AS months
  FROM (SELECT s.month_key, SUM(s.spent) AS total
        FROM v_spent_month s JOIN wallets w ON w.id=s.wallet_id
        WHERE w.tier='must' AND w.must_group='must'
          AND s.month_key < strftime('%Y-%m','now','+7 hours')
        GROUP BY s.month_key
        ORDER BY s.month_key DESC LIMIT 3) m;

-- Chưa đủ 3 tháng trọn -> target/months_covered/pct = NULL; app thay bằng tổng dự kiến tháng của các ví Must.
CREATE VIEW v_safety_fund AS
  SELECT t.wallet_id, t.cash, a.months AS months_of_data,
         CASE WHEN a.months < 3 THEN NULL
              ELSE CAST(a.avg_must * n.months AS INTEGER) END AS target,
         CASE WHEN a.months < 3 OR a.avg_must <= 0 THEN NULL
              ELSE ROUND(t.cash / a.avg_must, 1) END AS months_covered,
         CASE WHEN a.months < 3 OR a.avg_must <= 0 THEN NULL
              ELSE MIN(ROUND(100.0 * t.cash / (a.avg_must * n.months), 1), 100.0) END AS pct
  FROM v_wealth_building t, v_must_monthly_avg a,
       (SELECT CAST(v AS INTEGER) AS months FROM config WHERE k='safety_fund_months') n;

-- Chi theo DANH MỤC × tháng
CREATE VIEW v_spend_by_category AS
  SELECT t.category_id, c.name, t.month_key,
         SUM(CASE t.meaning WHEN 'spend' THEN t.amount ELSE -t.amount END) AS spent
  FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
  WHERE t.status='active' AND t.meaning IN ('spend','refund')
  GROUP BY t.category_id, t.month_key;

-- Số dư TỪNG TÀI KHOẢN theo SỔ (lớp 2) — gồm cả giao dịch nhập tay
CREATE VIEW v_account_book AS
  SELECT a.id AS account_id, a.name, a.kind,
         a.opening_balance + COALESCE((
           SELECT SUM(CASE WHEN t.account_id=a.id THEN -t.amount ELSE t.amount END)
           FROM transactions t
           WHERE t.status='active' AND (t.account_id=a.id OR t.counter_account_id=a.id)
         ),0) AS book_balance
  FROM accounts a WHERE a.active=1;

-- Số dư theo NGÂN HÀNG (số lũy kế SePay gửi kèm) không dùng: sai cả hai dấu ở tài khoản thật (ADR-87).

-- Sổ theo LOG (lớp 1): mở sổ + mọi log đã nhận TỪ NGÀY MỞ SỔ (giờ VN) trở đi — log trước đó đã nằm trong
-- opening_balance (ADR-76); tách riêng phần log chưa gán
CREATE VIEW v_account_logs AS
  SELECT a.id AS account_id,
         a.opening_balance + COALESCE(SUM(CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END),0) AS feed_balance,
         COALESCE(SUM(CASE WHEN l.status='assigned'
                           THEN CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END END),0) AS assigned_net,
         COALESCE(SUM(CASE WHEN l.status='pending'
                           THEN CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END END),0) AS pending_net,
         COUNT(CASE WHEN l.status='pending' THEN 1 END) AS pending_count
  FROM accounts a JOIN bank_logs l ON l.account_id=a.id
   AND (a.opened_at IS NULL OR date(l.at, '+7 hours') >= a.opened_at)
  GROUP BY a.id;

-- Phần của sổ transactions sinh ra TỪ LOG, theo từng tài khoản
CREATE VIEW v_account_tx_from_logs AS
  SELECT a.id AS account_id,
         COALESCE(SUM(CASE WHEN t.account_id=a.id THEN -t.amount ELSE t.amount END),0) AS tx_net
  FROM accounts a JOIN transactions t
    ON t.status='active' AND t.log_id IS NOT NULL AND (t.account_id=a.id OR t.counter_account_id=a.id)
  GROUP BY a.id;

-- ĐỐI SOÁT — bằng chứng "tiền là thật"
--   book_drift : log đã gán cộng lại ra Y, sổ diễn giải ra Z -> diễn giải lệch (chỉ tính cho TK có feed)
--   Log còn pending KHÔNG phải lệch: nó hiện riêng ở pending_net / pending_count ("chưa gán").
--   Số dư thật chỉ đến từ người nhà nhập (cash_counts — Nhập số dư / Đếm).
CREATE VIEW v_reconcile AS
  SELECT b.account_id, b.name, b.kind, b.book_balance,
         g.feed_balance,
         CASE WHEN g.account_id IS NULL THEN NULL
              ELSE COALESCE(x.tx_net,0) - g.assigned_net END AS book_drift,
         COALESCE(g.pending_net,0)   AS pending_net,
         COALESCE(g.pending_count,0) AS pending_count,
         (SELECT MAX(l.at) FROM bank_logs l WHERE l.account_id=b.account_id) AS last_at
  FROM v_account_book b
  LEFT JOIN v_account_logs g         ON g.account_id=b.account_id
  LEFT JOIN v_account_tx_from_logs x ON x.account_id=b.account_id;

-- ============================================================
--  CHỐT CHẶN TOÀN VẸN — một giao dịch ngân hàng không bao giờ vào sổ hai lần
-- ============================================================
-- Chỉ log còn 'pending' mới được sinh giao dịch. Việc ghi giao dịch và đổi log sang 'assigned' nằm chung một batch,
-- nên request đến sau (khi log đã 'assigned') bị huỷ cả batch thay vì ghi thêm một lần nữa.
CREATE TRIGGER trg_tx_needs_pending_log BEFORE INSERT ON transactions
WHEN NEW.log_id IS NOT NULL AND (
  (SELECT status FROM bank_logs WHERE id = NEW.log_id) IS NOT 'pending'
  OR (NEW.log_id_2 IS NOT NULL AND (SELECT status FROM bank_logs WHERE id = NEW.log_id_2) IS NOT 'pending')
)
BEGIN
  SELECT RAISE(ABORT, 'log_not_pending');
END;

CREATE TRIGGER trg_tx_second_leg_needs_pending_log BEFORE UPDATE OF log_id_2 ON transactions
WHEN NEW.log_id_2 IS NOT NULL AND NEW.log_id_2 IS NOT OLD.log_id_2
  AND (SELECT status FROM bank_logs WHERE id = NEW.log_id_2) IS NOT 'pending'
BEGIN
  SELECT RAISE(ABORT, 'log_not_pending');
END;

-- Một lệnh chuyển tiền chỉ được hoàn tất một lần (trả về 'pending' khi gỡ gán thì vẫn được).
CREATE TRIGGER trg_transfer_order_settles_once BEFORE UPDATE OF status ON transfer_orders
WHEN NEW.status <> 'pending' AND OLD.status <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'order_not_pending');
END;

-- Không gỡ được một lần chia khi tiền của nó đã chuyển thật (có lệnh chuyển 'done' cùng batch).
CREATE TRIGGER trg_fund_void_needs_unsettled_batch BEFORE UPDATE OF status ON transactions
WHEN NEW.status = 'void' AND OLD.status = 'active' AND OLD.meaning = 'fund' AND OLD.batch_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM transfer_orders o WHERE o.batch_id = OLD.batch_id AND o.status = 'done')
BEGIN
  SELECT RAISE(ABORT, 'allocation_settled');
END;

-- Sổ người thuê chỉ được đổi status active -> void; không sửa, không xoá.
CREATE TRIGGER trg_tenant_lines_append_only BEFORE UPDATE ON tenant_lines
WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.month_key IS NOT OLD.month_key
  OR NEW.at IS NOT OLD.at OR NEW.kind IS NOT OLD.kind OR NEW.name IS NOT OLD.name OR NEW.amount IS NOT OLD.amount
  OR NEW.category_id IS NOT OLD.category_id OR NEW.client_id IS NOT OLD.client_id
  OR NOT (OLD.status = 'active' AND NEW.status = 'void')
BEGIN
  SELECT RAISE(ABORT, 'tenant_line_append_only');
END;
CREATE TRIGGER trg_tenant_lines_no_delete BEFORE DELETE ON tenant_lines
BEGIN
  SELECT RAISE(ABORT, 'tenant_line_append_only');
END;

-- Số dư phải thu = Σ dòng sổ − Σ tiền người thuê đã trả (income gắn tenant_id). Dương = còn nợ.
CREATE VIEW v_tenant_balance AS
  SELECT t.id AS tenant_id, t.name, t.active,
         COALESCE((SELECT SUM(l.amount) FROM tenant_lines l WHERE l.tenant_id = t.id AND l.status = 'active'), 0)
       - COALESCE((SELECT SUM(x.amount) FROM transactions x
                   WHERE x.tenant_id = t.id AND x.meaning = 'income' AND x.status = 'active'), 0) AS balance
  FROM tenants t;

-- Sổ nợ chỉ được đổi status active -> void; không sửa, không xoá.
CREATE TRIGGER trg_debt_lines_append_only BEFORE UPDATE ON debt_lines
WHEN NEW.id IS NOT OLD.id OR NEW.debt_id IS NOT OLD.debt_id OR NEW.at IS NOT OLD.at OR NEW.kind IS NOT OLD.kind
  OR NEW.amount IS NOT OLD.amount OR NEW.note IS NOT OLD.note
  OR NOT (OLD.status = 'active' AND NEW.status = 'void')
BEGIN
  SELECT RAISE(ABORT, 'debt_line_append_only');
END;
CREATE TRIGGER trg_debt_lines_no_delete BEFORE DELETE ON debt_lines
BEGIN
  SELECT RAISE(ABORT, 'debt_line_append_only');
END;

-- Còn nợ = Σ dòng sổ nợ − Σ khoản chi trả nợ (spend gắn debt_id). ≤ 0 = đã trả xong.
CREATE VIEW v_debt_balance AS
  SELECT debt_id, name, active, owed, paid, owed - paid AS balance
  FROM (
    SELECT d.id AS debt_id, d.name, d.active,
           COALESCE((SELECT SUM(l.amount) FROM debt_lines l WHERE l.debt_id = d.id AND l.status = 'active'), 0) AS owed,
           COALESCE((SELECT SUM(x.amount) FROM transactions x
                     WHERE x.debt_id = d.id AND x.meaning = 'spend' AND x.status = 'active'), 0) AS paid
    FROM debts d
  );

-- Sổ phải thu chỉ được đổi status active -> void; không sửa, không xoá.
CREATE TRIGGER trg_receivable_lines_append_only BEFORE UPDATE ON receivable_lines
WHEN NEW.id IS NOT OLD.id OR NEW.receivable_id IS NOT OLD.receivable_id OR NEW.at IS NOT OLD.at OR NEW.kind IS NOT OLD.kind
  OR NEW.amount IS NOT OLD.amount OR NEW.note IS NOT OLD.note
  OR NOT (OLD.status = 'active' AND NEW.status = 'void')
BEGIN
  SELECT RAISE(ABORT, 'receivable_line_append_only');
END;
CREATE TRIGGER trg_receivable_lines_no_delete BEFORE DELETE ON receivable_lines
BEGIN
  SELECT RAISE(ABORT, 'receivable_line_append_only');
END;

-- Còn phải thu = (Σ dòng sổ + Σ tiền cho vay đi) − Σ tiền nhận lại. ≤ 0 = người ta đã trả đủ.
CREATE VIEW v_receivable_balance AS
  SELECT receivable_id, name, active, lent, collected, lent - collected AS balance
  FROM (
    SELECT r.id AS receivable_id, r.name, r.active,
           COALESCE((SELECT SUM(l.amount) FROM receivable_lines l WHERE l.receivable_id = r.id AND l.status = 'active'), 0)
         + COALESCE((SELECT SUM(x.amount) FROM transactions x
                     WHERE x.receivable_id = r.id AND x.meaning = 'lend' AND x.status = 'active'), 0) AS lent,
           COALESCE((SELECT SUM(x.amount) FROM transactions x
                     WHERE x.receivable_id = r.id AND x.meaning = 'collect' AND x.status = 'active'), 0) AS collected
    FROM receivables r
  );

-- Phiên bản schema — /v1/health đọc từ đây
INSERT INTO config (k,v) VALUES ('schema_version','1.30');
