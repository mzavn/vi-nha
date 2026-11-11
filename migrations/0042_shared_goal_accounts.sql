-- 0042 — Nhiều mục tiêu Dự phòng dùng chung một tài khoản (change 261112-muc-tieu-chung-tai-khoan, pocket UC-1209, ADR nháp
-- A/B/C). Schema 1.42. "Đã có" của từng mục tiêu chia từ số dư tài khoản theo thứ tự ưu tiên (`reserve_goals.sort`), tính ở
-- src/domain/pockets.ts › fillGoals, không lưu. Khoản chi / chuyển ra mang `goal_id` tuỳ chọn. Giữ nguyên account_id mọi
-- mục tiêu, không đụng dữ liệu tiền.

-- Bước 1: bỏ luật "mỗi tài khoản tối đa một mục tiêu đang dùng".
DROP INDEX idx_reserve_goals_account;

-- Bước 2: sort thành thứ tự ưu tiên — đang dùng trước, hạn gần trước, chưa có hạn xuống cuối. Cùng hạn thì cùng số; code
-- (goalOrder) tách bằng tên theo tiếng Việt nên thứ tự Hôm nay giữ đúng như trước.
UPDATE reserve_goals SET sort = (
  SELECT 10 * rk FROM (
    SELECT id, DENSE_RANK() OVER (ORDER BY active DESC, due_date IS NULL, due_date) AS rk FROM reserve_goals
  ) r WHERE r.id = reserve_goals.id
);

-- Bước 3: mục tiêu theo % (Thuế) giữ tài khoản riêng — tài khoản của nó không có mục tiêu đang dùng nào khác (QĐ1-A).
CREATE TRIGGER trg_reserve_goals_tax_own_insert BEFORE INSERT ON reserve_goals
WHEN NEW.active = 1 AND NEW.account_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = NEW.account_id AND g.active = 1 AND g.id <> NEW.id)
  AND (NEW.target_pct IS NOT NULL
    OR EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = NEW.account_id AND g.active = 1 AND g.id <> NEW.id AND g.target_pct IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'tax_account_shared');
END;
CREATE TRIGGER trg_reserve_goals_tax_own BEFORE UPDATE OF account_id, active, target_pct ON reserve_goals
WHEN NEW.active = 1 AND NEW.account_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = NEW.account_id AND g.active = 1 AND g.id <> NEW.id)
  AND (NEW.target_pct IS NOT NULL
    OR EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = NEW.account_id AND g.active = 1 AND g.id <> NEW.id AND g.target_pct IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'tax_account_shared');
END;

-- Bước 4: khoản chi / chuyển ra cho mục tiêu nào (QĐ3). Khoản cũ NULL, không điền lại. Mục tiêu phải đang dùng và gắn đúng
-- tài khoản tiền ra lúc ghi.
ALTER TABLE transactions ADD COLUMN goal_id TEXT REFERENCES reserve_goals(id);
CREATE INDEX idx_tx_goal ON transactions(goal_id, at) WHERE goal_id IS NOT NULL;
CREATE TRIGGER trg_tx_goal_insert BEFORE INSERT ON transactions
WHEN NEW.goal_id IS NOT NULL
  AND (NEW.meaning NOT IN ('spend', 'transfer')
    OR NOT EXISTS (SELECT 1 FROM reserve_goals g WHERE g.id = NEW.goal_id AND g.active = 1 AND g.account_id = NEW.account_id))
BEGIN
  SELECT RAISE(ABORT, 'invalid_goal');
END;
CREATE TRIGGER trg_tx_goal BEFORE UPDATE OF goal_id, account_id, meaning ON transactions
WHEN NEW.goal_id IS NOT NULL
  AND (NEW.meaning NOT IN ('spend', 'transfer')
    OR NOT EXISTS (SELECT 1 FROM reserve_goals g WHERE g.id = NEW.goal_id AND g.active = 1 AND g.account_id = NEW.account_id))
BEGIN
  SELECT RAISE(ABORT, 'invalid_goal');
END;

-- Bước 5.
UPDATE config SET v = '1.42' WHERE k = 'schema_version';
