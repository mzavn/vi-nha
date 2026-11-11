-- v1.39 -> v1.40 (Ba ngăn, Đợt E: xoá sạch mô hình ví — change 261112-ba-ngan-chuyen-doi, ADR-130, ADR-131).
--  * Đóng băng số ví Tích sản cũ (tiền / tài sản đã mua) và mốc khoản cũ legacy_max_tx_id vào config, đặt
--    conversion_state 'pending' — CHỈ nhà đã có tài khoản (câu ngoài không có FROM: D1 trống không nhận dòng nào).
--  * conversion_claims: mỗi bước của màn chuyển đổi một dòng, khoá chính step (pocket UC-1208); không sửa / xoá.
--  * transactions dựng lại theo mẫu 0039 (bảng tạm → DROP → CREATE cùng tên → chép theo id): bỏ wallet_id /
--    counter_wallet_id, thêm legacy_class = "loại chi" chép từ phe của ví cũ (ví bị trừ khi chi, còn lại ví được cộng);
--    dòng mới không có fund / legacy_class (trg_tx_no_legacy), dòng cũ không sửa loại chi (trg_tx_legacy_frozen).
--  * Xoá wallets, allocations, income_stream_locks, transfer_orders, month_closes và 9 view ví; dựng lại categories, rules
--    bỏ cột ví; accounts bỏ role, locked, spendable. allocation_runs giữ (chỉ trỏ transactions, lý do lần chia cũ).
--  D1 tự bọc migration trong một transaction: defer_foreign_keys có tác dụng tới COMMIT.
PRAGMA defer_foreign_keys = true;

INSERT INTO config (k, v)
SELECT 'legacy_savings_cash', CAST(COALESCE((SELECT SUM(cash) FROM v_wealth_building), 0) AS TEXT)
WHERE EXISTS (SELECT 1 FROM accounts);
INSERT INTO config (k, v)
SELECT 'legacy_savings_assets', CAST(COALESCE((SELECT SUM(assets) FROM v_wealth_building), 0) AS TEXT)
WHERE EXISTS (SELECT 1 FROM accounts);
INSERT INTO config (k, v)
SELECT 'legacy_max_tx_id', CAST(COALESCE((SELECT MAX(id) FROM transactions), 0) AS TEXT)
WHERE EXISTS (SELECT 1 FROM accounts);
INSERT INTO config (k, v)
SELECT 'conversion_state', 'pending'
WHERE EXISTS (SELECT 1 FROM accounts);

CREATE TABLE conversion_claims (
  step         TEXT PRIMARY KEY CHECK (step IN ('pockets','goals','savings_gap','pay_cycle','savings_pct')),
  at           TEXT NOT NULL,
  by_member_id TEXT REFERENCES members(id)
);
CREATE TRIGGER trg_conversion_claims_no_update BEFORE UPDATE ON conversion_claims
BEGIN
  SELECT RAISE(ABORT, 'conversion_append_only');
END;
CREATE TRIGGER trg_conversion_claims_no_delete BEFORE DELETE ON conversion_claims
BEGIN
  SELECT RAISE(ABORT, 'conversion_append_only');
END;

DROP TABLE transfer_orders;
DROP TABLE month_closes;

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

DROP TABLE income_stream_locks;
DROP TABLE allocations;

-- Loại chi (cách tính cũ) theo phe của ví xét (ADR-131): Must thiết yếu → essential; Có thì tốt / Hưởng thụ → flex;
-- Thuế → tax; Tích sản → savings; ví giữ (Thu nhập, Thu cho thuê) → holding; không ví → NULL.
CREATE TABLE _m0040_transactions AS
SELECT t.*,
       CASE
         WHEN w.id IS NULL THEN NULL
         WHEN w.tier = 'must' AND w.must_group = 'must' THEN 'essential'
         WHEN w.must_group = 'have' OR w.tier = 'nice' THEN 'flex'
         WHEN w.tier = 'tax' THEN 'tax'
         WHEN w.tier = 'wealth_building' THEN 'savings'
         WHEN w.tier = 'holding' THEN 'holding'
       END AS legacy_class
FROM transactions t
LEFT JOIN wallets w ON w.id = CASE WHEN t.meaning = 'spend' THEN t.counter_wallet_id ELSE t.wallet_id END;
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
  account_id         TEXT REFERENCES accounts(id),
  counter_account_id TEXT REFERENCES accounts(id),
  category_id  TEXT REFERENCES categories(id),   -- BẮT BUỘC khi meaning='spend' (enforce ở BE)
  by_member_id TEXT REFERENCES members(id),
  link_id      INTEGER REFERENCES transactions(id),  -- refund -> spend gốc; collect -> lend gốc; fund (cũ) -> income của lần chia
  batch_id     TEXT,                                 -- lần chia lương (cũ)
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
  income_stream_id TEXT REFERENCES income_streams(id), -- income: nguồn thu (mở kỳ lương, ngăn của tiền về)
  tenant_id    TEXT REFERENCES tenants(id),           -- income: tiền người thuê trả (trừ vào sổ người thuê)
  debt_id      TEXT REFERENCES debts(id),             -- spend: khoản trả nợ (trừ vào sổ nợ)
  receivable_id TEXT REFERENCES receivables(id),      -- lend: cho vay thêm · collect: nhận lại (sổ phải thu)
  interest_debt_id TEXT REFERENCES debts(id),         -- spend: trả LÃI cho khoản nợ (chi phí, không giảm nợ)
  legacy_class TEXT CHECK (legacy_class IS NULL OR legacy_class IN ('essential','flex','tax','savings','holding')),  -- loại chi cũ (ADR-131)
  CHECK (meaning <> 'spend'  OR category_id IS NOT NULL)
);
CREATE INDEX _m0040_tx_link ON transactions(link_id);
INSERT INTO transactions (id, log_id, log_id_2, at, amount, meaning, account_id, counter_account_id, category_id, by_member_id, link_id, batch_id, asset_kind, taxable, week_key, month_key, source, status, note, created_at, client_id, income_stream_id, tenant_id, debt_id, receivable_id, interest_debt_id, legacy_class)
  SELECT id, log_id, log_id_2, at, amount, meaning, account_id, counter_account_id, category_id, by_member_id, link_id, batch_id, asset_kind, taxable, week_key, month_key, source, status, note, created_at, client_id, income_stream_id, tenant_id, debt_id, receivable_id, interest_debt_id, legacy_class
  FROM _m0040_transactions ORDER BY id;
DROP INDEX _m0040_tx_link;
DROP TABLE _m0040_transactions;

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

-- Không còn ví (v1.40, ADR-131): dòng mới không có bút toán nạp ví, không có loại chi cũ; loại chi của dòng cũ không sửa.
CREATE TRIGGER trg_tx_no_legacy BEFORE INSERT ON transactions
WHEN NEW.meaning = 'fund' OR NEW.legacy_class IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'model_changed');
END;
CREATE TRIGGER trg_tx_legacy_frozen BEFORE UPDATE ON transactions
WHEN NEW.meaning IS NOT OLD.meaning OR NEW.legacy_class IS NOT OLD.legacy_class
BEGIN
  SELECT RAISE(ABORT, 'model_changed');
END;

-- categories / rules: SQLite không DROP COLUMN cột khoá ngoại → dựng lại. Index tạm (category_id): mỗi danh mục chèn lại
-- dò dòng con khi đang có vi phạm khoá ngoại hoãn; idx_tx_cat là index một phần nên không dùng được.
CREATE INDEX _m0040_tx_cat ON transactions(category_id);
CREATE TABLE _m0040_categories AS SELECT * FROM categories;
DROP TABLE categories;
CREATE TABLE categories (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  icon      TEXT,                    -- tên icon trong web/src/ui/icons.tsx; NULL / tên lạ = icon nhãn
  sort      INTEGER NOT NULL DEFAULT 100,
  active    INTEGER NOT NULL DEFAULT 1,
  group_id  TEXT REFERENCES category_groups(id)  -- nhóm danh mục (pocket UC-1204); NULL = chưa xếp nhóm
);
INSERT INTO categories (id, name, icon, sort, active, group_id)
  SELECT id, name, icon, sort, active, group_id FROM _m0040_categories;
DROP TABLE _m0040_categories;
DROP INDEX _m0040_tx_cat;

CREATE TABLE _m0040_rules AS SELECT * FROM rules;
DROP TABLE rules;
CREATE TABLE rules (
  id          INTEGER PRIMARY KEY,
  priority    INTEGER NOT NULL DEFAULT 100,
  match_type  TEXT NOT NULL CHECK (match_type IN ('code','content','account')),
  pattern     TEXT NOT NULL,
  meaning     TEXT NOT NULL CHECK (meaning IN ('spend','transfer','income')),
  is_salary   INTEGER NOT NULL DEFAULT 0,   -- chỉ rule lương mới được gán income
  category_id TEXT REFERENCES categories(id),
  by_member_id TEXT REFERENCES members(id),
  active      INTEGER NOT NULL DEFAULT 1,
  income_stream_id TEXT REFERENCES income_streams(id),  -- rule lương: nguồn thu của khoản khớp
  tenant_id   TEXT REFERENCES tenants(id),              -- chỉ để GỢI Ý "thu từ người thuê", không tự gán
  account_id  TEXT REFERENCES accounts(id),             -- chỉ áp cho log của tài khoản này; NULL = mọi tài khoản
  counter_account_id TEXT REFERENCES accounts(id),      -- transfer: tài khoản đầu kia (NULL = rút tiền mặt như cũ)
  CHECK (meaning <> 'income' OR is_salary = 1)
);
INSERT INTO rules (id, priority, match_type, pattern, meaning, is_salary, category_id, by_member_id, active, income_stream_id, tenant_id, account_id, counter_account_id)
  SELECT id, priority, match_type, pattern, meaning, is_salary, category_id, by_member_id, active, income_stream_id, tenant_id, account_id, counter_account_id
  FROM _m0040_rules ORDER BY id;
DROP TABLE _m0040_rules;

DROP TABLE wallets;

ALTER TABLE accounts DROP COLUMN role;
ALTER TABLE accounts DROP COLUMN locked;
ALTER TABLE accounts DROP COLUMN spendable;

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

UPDATE config SET v = '1.40' WHERE k = 'schema_version';
