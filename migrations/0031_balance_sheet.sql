-- v1.30 -> v1.31 (bảng cân đối, lô tài sản, lãi vay hằng tháng — change 261008-bang-can-doi, lát 1):
--  * balance_items: tài sản nhà theo dõi ngoài sổ thu chi (vàng, chứng khoán, đất…) — không bao giờ sinh giao dịch.
--  * balance_lots: lô của mục theo lô (số lượng phần nghìn đơn vị); số mua không sửa, bán ghi một lần, giá chốt lời /
--    cắt lỗ sửa tự do. balance_values: định giá theo ngày, chỉ ghi thêm (sai thì huỷ dòng).
--  * debts: lãi suất (phần vạn/năm), kỳ hạn, số trả mỗi tháng, ngày trả; debts / receivables / accounts: deactivated_at
--    (ngày tắt giờ VN — dòng tắt từ trước migration này để NULL, không biết ngày tắt). receivables: kỳ hạn.
--  * transactions.interest_debt_id: khoản chi trả lãi cho khoản nợ (không giảm nợ, v_debt_balance không đổi).
--  * Dữ liệu hệ thống: ví + danh mục 'loan-interest' "Lãi vay"; sáu khoá fi_* mặc định. INSERT OR IGNORE.

CREATE TABLE balance_items (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  section           TEXT NOT NULL CHECK (section IN ('A1','A2','A4','A5','B1','B2','B3','B4','B5','B6')),
  pyramid           TEXT NOT NULL CHECK (pyramid IN ('speculative','growth','income','protective','fixed')),
  measure           TEXT NOT NULL CHECK (measure IN ('value','units')),
  unit              TEXT,
  liquid            INTEGER NOT NULL DEFAULT 0 CHECK (liquid IN (0,1)),
  investable        INTEGER NOT NULL DEFAULT 1 CHECK (investable IN (0,1)),
  asset_kind        TEXT CHECK (asset_kind IS NULL OR asset_kind IN ('gold','stock','fund','re')),
  cost_basis        INTEGER CHECK (cost_basis IS NULL OR cost_basis >= 0),
  acquired_on       TEXT,
  take_profit_value INTEGER CHECK (take_profit_value IS NULL OR take_profit_value > 0),
  stop_loss_value   INTEGER CHECK (stop_loss_value IS NULL OR stop_loss_value > 0),
  note              TEXT,
  sort              INTEGER NOT NULL DEFAULT 100,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (measure <> 'units' OR unit IS NOT NULL),
  CHECK (take_profit_value IS NULL OR stop_loss_value IS NULL OR stop_loss_value < take_profit_value)
);

CREATE TABLE balance_lots (
  id                INTEGER PRIMARY KEY,
  item_id           TEXT NOT NULL REFERENCES balance_items(id),
  bought_on         TEXT NOT NULL,
  quantity_milli    INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_cost         INTEGER NOT NULL CHECK (unit_cost >= 0),
  sold_on           TEXT,
  sold_unit_price   INTEGER CHECK (sold_unit_price IS NULL OR sold_unit_price >= 0),
  take_profit_price INTEGER CHECK (take_profit_price IS NULL OR take_profit_price > 0),
  stop_loss_price   INTEGER CHECK (stop_loss_price IS NULL OR stop_loss_price > 0),
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  by_member_id      TEXT REFERENCES members(id),
  CHECK ((sold_on IS NULL) = (sold_unit_price IS NULL)),
  CHECK (sold_on IS NULL OR sold_on >= bought_on),
  CHECK (take_profit_price IS NULL OR stop_loss_price IS NULL OR stop_loss_price < take_profit_price)
);
CREATE INDEX idx_balance_lots ON balance_lots(item_id) WHERE status='active';

CREATE TABLE balance_values (
  id                  INTEGER PRIMARY KEY,
  item_id             TEXT NOT NULL REFERENCES balance_items(id),
  as_of               TEXT NOT NULL,
  value               INTEGER CHECK (value IS NULL OR value >= 0),
  unit_price          INTEGER CHECK (unit_price IS NULL OR unit_price >= 0),
  cashflow            INTEGER NOT NULL DEFAULT 0 CHECK (cashflow >= 0),
  cashflow_period     TEXT CHECK (cashflow_period IS NULL OR cashflow_period IN ('month','year')),
  expected_return_bps INTEGER CHECK (expected_return_bps IS NULL OR expected_return_bps BETWEEN -10000 AND 100000),
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  by_member_id        TEXT REFERENCES members(id),
  CHECK ((value IS NULL) <> (unit_price IS NULL)),
  CHECK (cashflow = 0 OR cashflow_period IS NOT NULL)
);
CREATE INDEX idx_balance_values ON balance_values(item_id, as_of) WHERE status='active';

-- Lô: số mua không sửa; bán chỉ từ chưa bán sang đã bán; huỷ chỉ active -> void; giá chốt lời / cắt lỗ sửa tự do.
CREATE TRIGGER trg_balance_lots_guard BEFORE UPDATE ON balance_lots
WHEN NEW.id IS NOT OLD.id OR NEW.item_id IS NOT OLD.item_id OR NEW.bought_on IS NOT OLD.bought_on
  OR NEW.quantity_milli IS NOT OLD.quantity_milli OR NEW.unit_cost IS NOT OLD.unit_cost OR NEW.note IS NOT OLD.note
  OR NEW.created_at IS NOT OLD.created_at OR NEW.by_member_id IS NOT OLD.by_member_id
  OR (OLD.sold_on IS NOT NULL AND (NEW.sold_on IS NOT OLD.sold_on OR NEW.sold_unit_price IS NOT OLD.sold_unit_price))
  OR OLD.status = 'void'
BEGIN
  SELECT RAISE(ABORT, 'balance_lot_append_only');
END;
CREATE TRIGGER trg_balance_lots_no_delete BEFORE DELETE ON balance_lots
BEGIN
  SELECT RAISE(ABORT, 'balance_lot_append_only');
END;

-- Định giá chỉ được đổi status active -> void; không sửa, không xoá.
CREATE TRIGGER trg_balance_values_append_only BEFORE UPDATE ON balance_values
WHEN NEW.id IS NOT OLD.id OR NEW.item_id IS NOT OLD.item_id OR NEW.as_of IS NOT OLD.as_of OR NEW.value IS NOT OLD.value
  OR NEW.unit_price IS NOT OLD.unit_price OR NEW.cashflow IS NOT OLD.cashflow OR NEW.cashflow_period IS NOT OLD.cashflow_period
  OR NEW.expected_return_bps IS NOT OLD.expected_return_bps OR NEW.created_at IS NOT OLD.created_at
  OR NEW.by_member_id IS NOT OLD.by_member_id
  OR NOT (OLD.status = 'active' AND NEW.status = 'void')
BEGIN
  SELECT RAISE(ABORT, 'balance_value_append_only');
END;
CREATE TRIGGER trg_balance_values_no_delete BEFORE DELETE ON balance_values
BEGIN
  SELECT RAISE(ABORT, 'balance_value_append_only');
END;

ALTER TABLE debts ADD COLUMN interest_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (interest_rate_bps BETWEEN 0 AND 10000);
ALTER TABLE debts ADD COLUMN term TEXT NOT NULL DEFAULT 'short' CHECK (term IN ('short','long'));
ALTER TABLE debts ADD COLUMN monthly_payment INTEGER CHECK (monthly_payment IS NULL OR monthly_payment > 0);
ALTER TABLE debts ADD COLUMN due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 28);
ALTER TABLE debts ADD COLUMN deactivated_at TEXT;
ALTER TABLE receivables ADD COLUMN term TEXT NOT NULL DEFAULT 'short' CHECK (term IN ('short','long'));
ALTER TABLE receivables ADD COLUMN deactivated_at TEXT;
ALTER TABLE accounts ADD COLUMN deactivated_at TEXT;
ALTER TABLE transactions ADD COLUMN interest_debt_id TEXT REFERENCES debts(id);
CREATE INDEX idx_tx_interest_debt ON transactions(interest_debt_id, month_key) WHERE interest_debt_id IS NOT NULL AND status='active';

INSERT OR IGNORE INTO wallets (id, name, tier, must_group, kind, sort) VALUES ('loan-interest', 'Lãi vay', 'must', 'must', 'bill', 49);
UPDATE wallets SET account_id = (SELECT w.account_id FROM wallets w WHERE w.tier = 'must' AND w.account_id IS NOT NULL ORDER BY w.sort LIMIT 1)
WHERE id = 'loan-interest' AND account_id IS NULL;
INSERT OR IGNORE INTO categories (id, name, default_wallet_id, icon, sort) VALUES ('loan-interest', 'Lãi vay', 'loan-interest', 'percent', 100);

INSERT OR IGNORE INTO config (k, v) VALUES
  ('fi_swr_bps', '350'), ('fi_inflation_bps', '350'), ('fi_fat_bps', '11000'),
  ('fi_legacy_rate_bps', '300'), ('fi_high_interest_bps', '1500'), ('fi_safety_months', '6,12,24');

UPDATE config SET v = '1.31' WHERE k = 'schema_version';
