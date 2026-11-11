-- v1.38 -> v1.39 (Ba ngăn, Đợt C: đường ghi ba ngăn — change 261112-ba-ngan-duong-ghi, ADR-123, ADR-124, ADR-126).
--  * transactions dựng lại theo mẫu 0028 (bảng tạm → DROP → CREATE cùng tên → chép đủ 28 cột, giữ id) để bỏ hai CHECK ví
--    (spend → counter_wallet_id, refund → wallet_id). Cột ví giữ làm lịch sử "cách tính cũ"; trigger chặn dòng mới mang
--    ví / fund và chặn sửa cột ví. Bỏ trg_fund_void_needs_unsettled_batch (không còn lệnh chuyển).
--  * Index tạm _m0039_tx_link: khi đang có vi phạm khoá ngoại hoãn, mỗi dòng cha chèn lại làm SQLite tìm dòng con theo
--    link_id — không index thì O(N²).
--  * Lệnh chuyển còn chờ → skipped; transfer_orders, allocation_runs, month_closes chặn mọi ghi (model_changed).
--  * Kỳ lương (pay_cycles), việc ngày lương (pay_cycle_tasks) + liên kết chuyển khoản (pay_cycle_task_tx). Không tạo kỳ nào.
--  * income_streams.opens_cycle (bật cho nguồn của mẫu lương đang dùng, trừ nguồn cho thuê); accounts.private (không bật cái nào).
--  * Ví Thưởng của chốt tháng → surplus_reward_account = chỗ ở của ví khi tài khoản đó đang dùng và ở ngăn Dự phòng
--    (ADR-132); surplus_savings_pct '50'; bỏ month_close_*, split_days.
--  D1 tự bọc migration trong một transaction: defer_foreign_keys có tác dụng tới COMMIT.
PRAGMA defer_foreign_keys = true;

UPDATE transfer_orders SET status = 'skipped' WHERE status = 'pending';

DROP VIEW v_reconcile;
DROP VIEW v_account_tx_from_logs;
DROP VIEW v_account_logs;
DROP VIEW v_account_book;
DROP VIEW v_safety_fund;
DROP VIEW v_must_monthly_avg;
DROP VIEW v_wealth_building;
DROP VIEW v_goal_progress;
DROP VIEW v_wallet_balance;
DROP VIEW v_wallet_flow;
DROP VIEW v_spent_month;
DROP VIEW v_spent_week;
DROP VIEW v_spent_raw;
DROP VIEW v_spend_by_category;
DROP VIEW v_tenant_balance;
DROP VIEW v_debt_balance;
DROP VIEW v_receivable_balance;

CREATE TABLE _m0039_transactions AS SELECT * FROM transactions;
DROP TABLE transactions;

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
  interest_debt_id TEXT REFERENCES debts(id),         -- spend: trả LÃI cho khoản nợ (chi phí, không giảm nợ)
  CHECK (meaning <> 'spend'  OR category_id IS NOT NULL),
  CHECK (meaning <> 'fund'   OR (wallet_id IS NOT NULL AND counter_wallet_id IS NOT NULL))
);
CREATE INDEX _m0039_tx_link ON transactions(link_id);
INSERT INTO transactions (id, log_id, log_id_2, at, amount, meaning, wallet_id, counter_wallet_id, account_id, counter_account_id, category_id, by_member_id, link_id, batch_id, asset_kind, taxable, week_key, month_key, source, status, note, created_at, client_id, income_stream_id, tenant_id, debt_id, receivable_id, interest_debt_id)
  SELECT id, log_id, log_id_2, at, amount, meaning, wallet_id, counter_wallet_id, account_id, counter_account_id, category_id, by_member_id, link_id, batch_id, asset_kind, taxable, week_key, month_key, source, status, note, created_at, client_id, income_stream_id, tenant_id, debt_id, receivable_id, interest_debt_id
  FROM _m0039_transactions ORDER BY id;
DROP INDEX _m0039_tx_link;
DROP TABLE _m0039_transactions;

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
CREATE INDEX idx_tx_interest_debt ON transactions(interest_debt_id, month_key) WHERE interest_debt_id IS NOT NULL AND status='active';

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

CREATE TRIGGER trg_tx_log_id_needs_pending_log BEFORE UPDATE OF log_id ON transactions
WHEN NEW.log_id IS NOT NULL AND NEW.log_id IS NOT OLD.log_id
  AND (SELECT status FROM bank_logs WHERE id = NEW.log_id) IS NOT 'pending'
BEGIN
  SELECT RAISE(ABORT, 'log_not_pending');
END;

-- Đường ghi không còn ví (v1.39, ADR-123): dòng mới không mang ví, không có bút toán nạp ví; cột ví của dòng cũ không sửa.
CREATE TRIGGER trg_tx_no_wallet BEFORE INSERT ON transactions
WHEN NEW.wallet_id IS NOT NULL OR NEW.counter_wallet_id IS NOT NULL OR NEW.meaning = 'fund'
BEGIN
  SELECT RAISE(ABORT, 'model_changed');
END;
CREATE TRIGGER trg_tx_wallet_frozen BEFORE UPDATE ON transactions
WHEN NEW.wallet_id IS NOT OLD.wallet_id OR NEW.counter_wallet_id IS NOT OLD.counter_wallet_id OR NEW.meaning IS NOT OLD.meaning
BEGIN
  SELECT RAISE(ABORT, 'model_changed');
END;

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

CREATE VIEW v_goal_progress AS
  SELECT w.id AS wallet_id, w.name, a.target_amount, a.target_date,
         COALESCE(b.balance,0) AS balance,
         a.target_amount - COALESCE(b.balance,0) AS missing,
         ROUND(100.0*COALESCE(b.balance,0)/a.target_amount, 1) AS pct,
         MAX(CAST(julianday(a.target_date) - julianday('now') AS INTEGER), 0) AS days_left
  FROM wallets w
  JOIN allocations a ON a.wallet_id=w.id AND a.active=1 AND a.mode='goal'
  LEFT JOIN v_wallet_balance b ON b.wallet_id=w.id;

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

CREATE VIEW v_must_monthly_avg AS
  SELECT AVG(m.total) AS avg_must, COUNT(*) AS months
  FROM (SELECT s.month_key, SUM(s.spent) AS total
        FROM v_spent_month s JOIN wallets w ON w.id=s.wallet_id
        WHERE w.tier='must' AND w.must_group='must'
          AND s.month_key < strftime('%Y-%m','now','+7 hours')
        GROUP BY s.month_key
        ORDER BY s.month_key DESC LIMIT 3) m;

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

CREATE VIEW v_spend_by_category AS
  SELECT t.category_id, c.name, t.month_key,
         SUM(CASE t.meaning WHEN 'spend' THEN t.amount ELSE -t.amount END) AS spent
  FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
  WHERE t.status='active' AND t.meaning IN ('spend','refund')
  GROUP BY t.category_id, t.month_key;

CREATE VIEW v_account_book AS
  SELECT a.id AS account_id, a.name, a.kind,
         a.opening_balance + COALESCE((
           SELECT SUM(CASE WHEN t.account_id=a.id THEN -t.amount ELSE t.amount END)
           FROM transactions t
           WHERE t.status='active' AND (t.account_id=a.id OR t.counter_account_id=a.id)
         ),0) AS book_balance
  FROM accounts a WHERE a.active=1;

CREATE VIEW v_account_logs AS
  SELECT a.id AS account_id,
         a.opening_balance
         + CASE WHEN a.feed_from IS NULL THEN 0 ELSE COALESCE((
             SELECT SUM(CASE WHEN t.account_id=a.id THEN -t.amount ELSE t.amount END)
             FROM transactions t
             WHERE t.status='active' AND (t.account_id=a.id OR t.counter_account_id=a.id)
               AND julianday(t.at) < julianday(a.feed_from)
               AND NOT EXISTS (
                 SELECT 1 FROM bank_logs o
                 WHERE o.id IN (t.log_id, t.log_id_2) AND o.account_id=a.id
                   AND (a.opened_at IS NULL OR date(o.at, '+7 hours') >= a.opened_at)
                   AND (julianday(o.at) >= julianday(a.feed_from) OR o.source='webhook')
               )
           ),0) END
         + COALESCE(SUM(CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END),0) AS feed_balance,
         COALESCE(SUM(CASE WHEN l.status='assigned'
                           THEN CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END END),0) AS assigned_net,
         COALESCE(SUM(CASE WHEN l.status='pending'
                           THEN CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END END),0) AS pending_net,
         COUNT(CASE WHEN l.status='pending' THEN 1 END) AS pending_count
  FROM accounts a JOIN bank_logs l ON l.account_id=a.id
   AND (a.opened_at IS NULL OR date(l.at, '+7 hours') >= a.opened_at)
   AND (a.feed_from IS NULL OR julianday(l.at) >= julianday(a.feed_from) OR l.source='webhook')
  GROUP BY a.id;

CREATE VIEW v_account_tx_from_logs AS
  SELECT a.id AS account_id,
         COALESCE(SUM(CASE WHEN t.account_id=a.id THEN -t.amount ELSE t.amount END),0) AS tx_net
  FROM accounts a JOIN transactions t
    ON t.status='active' AND (t.account_id=a.id OR t.counter_account_id=a.id)
   AND EXISTS (
     SELECT 1 FROM bank_logs l
     WHERE l.id IN (t.log_id, t.log_id_2) AND l.account_id=a.id
       AND (a.opened_at IS NULL OR date(l.at, '+7 hours') >= a.opened_at)
       AND (a.feed_from IS NULL OR julianday(l.at) >= julianday(a.feed_from) OR l.source='webhook')
   )
  GROUP BY a.id;

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

CREATE VIEW v_tenant_balance AS
  SELECT t.id AS tenant_id, t.name, t.active,
         COALESCE((SELECT SUM(l.amount) FROM tenant_lines l WHERE l.tenant_id = t.id AND l.status = 'active'), 0)
       - COALESCE((SELECT SUM(x.amount) FROM transactions x
                   WHERE x.tenant_id = t.id AND x.meaning = 'income' AND x.status = 'active'), 0) AS balance
  FROM tenants t;

CREATE VIEW v_debt_balance AS
  SELECT debt_id, name, active, owed, paid, owed - paid AS balance
  FROM (
    SELECT d.id AS debt_id, d.name, d.active,
           COALESCE((SELECT SUM(l.amount) FROM debt_lines l WHERE l.debt_id = d.id AND l.status = 'active'), 0) AS owed,
           COALESCE((SELECT SUM(x.amount) FROM transactions x
                     WHERE x.debt_id = d.id AND x.meaning = 'spend' AND x.status = 'active'), 0) AS paid
    FROM debts d
  );

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

ALTER TABLE income_streams ADD COLUMN opens_cycle INTEGER NOT NULL DEFAULT 0 CHECK (opens_cycle IN (0,1));
UPDATE income_streams SET opens_cycle = 1
WHERE id IS NOT (SELECT v FROM config WHERE k = 'rental_income_stream_id')
  AND EXISTS (SELECT 1 FROM rules r WHERE r.active = 1 AND r.is_salary = 1 AND r.tenant_id IS NULL AND r.income_stream_id = income_streams.id);
ALTER TABLE accounts ADD COLUMN private INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0,1));

CREATE TABLE pay_cycles (
  id             INTEGER PRIMARY KEY,
  income_tx_id   INTEGER NOT NULL UNIQUE REFERENCES transactions(id),  -- khoản lương mở kỳ
  started_at     TEXT NOT NULL,                                        -- = thời điểm khoản lương đó (ISO UTC), không dời
  payday         TEXT NOT NULL CHECK (payday GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),  -- ngày lương danh nghĩa
  prev_operating INTEGER NOT NULL,                                     -- dư kỳ trước: ngăn Vận hành theo sổ tại started_at
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_pay_cycles_payday ON pay_cycles(payday) WHERE status = 'active';
CREATE INDEX idx_pay_cycles_status ON pay_cycles(status, started_at);
CREATE TRIGGER trg_pay_cycles_one_way BEFORE UPDATE ON pay_cycles
WHEN NEW.id IS NOT OLD.id OR NEW.income_tx_id IS NOT OLD.income_tx_id OR NEW.started_at IS NOT OLD.started_at
  OR NEW.payday IS NOT OLD.payday OR NEW.prev_operating IS NOT OLD.prev_operating OR NEW.created_at IS NOT OLD.created_at
  OR NOT (OLD.status = 'active' AND NEW.status = 'void')
BEGIN
  SELECT RAISE(ABORT, 'pay_cycle_append_only');
END;
CREATE TRIGGER trg_pay_cycles_no_delete BEFORE DELETE ON pay_cycles
BEGIN
  SELECT RAISE(ABORT, 'pay_cycle_append_only');
END;

-- Việc ngày lương: ① savings trích Tích luỹ · ② goal nạp mục tiêu Dự phòng · ③ move chuyển theo ngăn của nguồn ·
--  ④ surplus dư kỳ trước (→ Tích luỹ hoặc → tài khoản Ví Thưởng). status 'done' chỉ là tick tay; tự tick tính từ
--  pay_cycle_task_tx. ② đích là tài khoản của mục tiêu (đọc lúc ghép), ④ → Ví Thưởng đích là to_account_id ghi lúc sinh việc.
CREATE TABLE pay_cycle_tasks (
  id              INTEGER PRIMARY KEY,
  cycle_id        INTEGER NOT NULL REFERENCES pay_cycles(id),
  kind            TEXT NOT NULL CHECK (kind IN ('savings','goal','move','surplus')),
  source_tx_id    INTEGER REFERENCES transactions(id),   -- khoản thu sinh việc; NULL cho ② cố định và ④
  goal_id         TEXT REFERENCES reserve_goals(id),     -- ②
  to_account_id   TEXT REFERENCES accounts(id),          -- ④ → Ví Thưởng
  to_pocket       TEXT CHECK (to_pocket IS NULL OR to_pocket IN ('savings','reserve','operating')),  -- ①, ③, ④ → Tích luỹ
  pct             INTEGER CHECK (pct IS NULL OR pct BETWEEN 0 AND 100),  -- ① % đã áp; ② theo % thu chịu thuế
  suggested       INTEGER NOT NULL CHECK (suggested >= 0),
  amount          INTEGER NOT NULL CHECK (amount >= 0),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped','void')),
  reason          TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  done_at         TEXT,
  by_member_id    TEXT REFERENCES members(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (kind <> 'goal' OR goal_id IS NOT NULL),
  CHECK (kind <> 'savings' OR to_pocket IS 'savings'),
  CHECK (kind <> 'move' OR to_pocket IS NOT NULL),
  CHECK (kind <> 'surplus' OR ((to_pocket IS 'savings') <> (to_account_id IS NOT NULL))),
  CHECK (kind <> 'savings' OR reason IS NOT NULL OR (status <> 'skipped' AND amount > 0))
);
CREATE INDEX idx_pay_cycle_tasks ON pay_cycle_tasks(cycle_id, status);
CREATE INDEX idx_pay_cycle_tasks_source ON pay_cycle_tasks(source_tx_id) WHERE source_tx_id IS NOT NULL;
CREATE TRIGGER trg_pay_cycle_tasks_no_delete BEFORE DELETE ON pay_cycle_tasks
BEGIN
  SELECT RAISE(ABORT, 'pay_cycle_append_only');
END;

-- Liên kết việc ↔ chuyển khoản đã ghép (tự tick). Phần đã dùng của một chuyển khoản = Σ liên kết của việc chưa void.
CREATE TABLE pay_cycle_task_tx (
  task_id         INTEGER NOT NULL REFERENCES pay_cycle_tasks(id),
  tx_id           INTEGER NOT NULL REFERENCES transactions(id),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, tx_id)
);
CREATE INDEX idx_pay_cycle_task_tx ON pay_cycle_task_tx(tx_id);

CREATE TRIGGER trg_transfer_orders_no_insert BEFORE INSERT ON transfer_orders BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_transfer_orders_no_update BEFORE UPDATE ON transfer_orders BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_transfer_orders_no_delete BEFORE DELETE ON transfer_orders BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_allocation_runs_no_insert BEFORE INSERT ON allocation_runs BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_allocation_runs_no_update BEFORE UPDATE ON allocation_runs BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_allocation_runs_no_delete BEFORE DELETE ON allocation_runs BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_month_closes_no_insert BEFORE INSERT ON month_closes BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_month_closes_no_update BEFORE UPDATE ON month_closes BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_month_closes_no_delete BEFORE DELETE ON month_closes BEGIN SELECT RAISE(ABORT, 'model_changed'); END;

-- Ví Thưởng (UC-1207 bước 5): tài khoản Ví Thưởng = chỗ ở của ví khi tài khoản đó đang dùng và được đề xuất Dự phòng
-- (0038 không gắn mục tiêu nào nên không trùng tài khoản của mục tiêu); khác đi thì chưa chọn.
INSERT INTO config (k, v)
SELECT 'surplus_reward_account', w.account_id FROM wallets w JOIN accounts a ON a.id = w.account_id
WHERE w.id = (SELECT v FROM config WHERE k = 'month_close_reward_wallet') AND a.active = 1 AND a.pocket = 'reserve';
INSERT OR REPLACE INTO config (k, v) VALUES ('surplus_savings_pct', '50');
DELETE FROM config WHERE k IN ('month_close_wealth_pct', 'month_close_reward_wallet', 'split_days');

UPDATE config SET v = '1.39' WHERE k = 'schema_version';
