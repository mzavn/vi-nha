-- 0044 — Tài khoản con (tiền gửi kỳ hạn) và mục tiêu trả thẳng từ tiền chi tiêu (change 261112-tai-khoan-me-va-quy-chi-chung,
-- access UC-506, pocket UC-1209, ADR-140, ADR-141). Schema 1.44. Thêm cột và trigger; không điền, không sửa dữ liệu nào.
-- Số dư gộp mẹ + con, tiền lãi của nhóm, phần còn phải trả của mục tiêu trả từ tiền chi tiêu tính ra ở src/domain/pockets.ts.

-- Bước 1: tài khoản con — một tầng, mẹ và con đều là ngân hàng, mẹ đang dùng và không ở Vận hành, con không SePay, không là
-- Ví Thưởng, không có con, không gắn mục tiêu đang dùng. Con luôn cùng ngăn / xác nhận / riêng tư / chủ với mẹ.
ALTER TABLE accounts ADD COLUMN parent_account_id TEXT REFERENCES accounts(id);
CREATE INDEX idx_accounts_parent ON accounts(parent_account_id) WHERE parent_account_id IS NOT NULL;
CREATE TRIGGER trg_accounts_parent_insert BEFORE INSERT ON accounts
WHEN NEW.parent_account_id IS NOT NULL AND (
  NEW.parent_account_id = NEW.id OR NEW.kind <> 'bank' OR NEW.sepay_enabled <> 0
  OR NEW.id = (SELECT v FROM config WHERE k = 'surplus_reward_account')
  OR (NEW.active = 1 AND NOT EXISTS (SELECT 1 FROM accounts p WHERE p.id = NEW.parent_account_id AND p.active = 1
    AND p.parent_account_id IS NULL AND p.kind = 'bank' AND p.pocket IS NOT 'operating')))
BEGIN
  SELECT RAISE(ABORT, 'invalid_parent');
END;
CREATE TRIGGER trg_accounts_parent BEFORE UPDATE OF parent_account_id, kind, active, sepay_enabled ON accounts
WHEN NEW.parent_account_id IS NOT NULL AND (
  NEW.parent_account_id = NEW.id OR NEW.kind <> 'bank' OR NEW.sepay_enabled <> 0
  OR NEW.id = (SELECT v FROM config WHERE k = 'surplus_reward_account')
  OR EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = NEW.id)
  OR (NEW.active = 1 AND NOT EXISTS (SELECT 1 FROM accounts p WHERE p.id = NEW.parent_account_id AND p.active = 1
    AND p.parent_account_id IS NULL AND p.kind = 'bank' AND p.pocket IS NOT 'operating')))
BEGIN
  SELECT RAISE(ABORT, 'invalid_parent');
END;
CREATE TRIGGER trg_accounts_parent_goal BEFORE UPDATE OF parent_account_id ON accounts
WHEN NEW.parent_account_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = NEW.id AND g.active = 1)
BEGIN
  SELECT RAISE(ABORT, 'goal_on_child');
END;
CREATE TRIGGER trg_accounts_parent_follow_insert BEFORE INSERT ON accounts
WHEN NEW.parent_account_id IS NOT NULL AND EXISTS (SELECT 1 FROM accounts p WHERE p.id = NEW.parent_account_id
  AND (p.pocket IS NOT NEW.pocket OR p.pocket_confirmed IS NOT NEW.pocket_confirmed OR p.private IS NOT NEW.private
    OR p.owner_member_id IS NOT NEW.owner_member_id))
BEGIN
  SELECT RAISE(ABORT, 'pocket_follows_parent');
END;
CREATE TRIGGER trg_accounts_parent_follow BEFORE UPDATE OF parent_account_id, pocket, pocket_confirmed, private, owner_member_id ON accounts
WHEN NEW.parent_account_id IS NOT NULL AND EXISTS (SELECT 1 FROM accounts p WHERE p.id = NEW.parent_account_id
  AND (p.pocket IS NOT NEW.pocket OR p.pocket_confirmed IS NOT NEW.pocket_confirmed OR p.private IS NOT NEW.private
    OR p.owner_member_id IS NOT NEW.owner_member_id))
BEGIN
  SELECT RAISE(ABORT, 'pocket_follows_parent');
END;
-- Sửa mẹ: con theo trong cùng câu ghi.
CREATE TRIGGER trg_accounts_children_follow AFTER UPDATE OF pocket, pocket_confirmed, private, owner_member_id ON accounts
WHEN EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = NEW.id)
BEGIN
  UPDATE accounts SET pocket = NEW.pocket, pocket_confirmed = NEW.pocket_confirmed, private = NEW.private, owner_member_id = NEW.owner_member_id
  WHERE parent_account_id = NEW.id;
END;
-- Mẹ có con đang dùng: không tắt, không sang Vận hành, không đổi loại.
CREATE TRIGGER trg_accounts_keep_children BEFORE UPDATE OF active, pocket, kind ON accounts
WHEN (NEW.active = 0 OR NEW.pocket IS 'operating' OR NEW.kind <> 'bank')
  AND EXISTS (SELECT 1 FROM accounts c WHERE c.parent_account_id = NEW.id AND c.active = 1)
BEGIN
  SELECT RAISE(ABORT, 'account_has_children');
END;

-- Bước 2: Ví Thưởng không là tài khoản con (INSERT … ON CONFLICT DO UPDATE chạy trigger UPDATE).
CREATE TRIGGER trg_config_reward_child_insert BEFORE INSERT ON config
WHEN NEW.k = 'surplus_reward_account'
  AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.v AND a.parent_account_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'reward_is_child');
END;
CREATE TRIGGER trg_config_reward_child BEFORE UPDATE OF v ON config
WHEN NEW.k = 'surplus_reward_account'
  AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.v AND a.parent_account_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'reward_is_child');
END;

-- Bước 3: mục tiêu trả thẳng từ tiền chi tiêu (ngăn Vận hành) — chỉ mục tiêu lặp mỗi tháng, không tài khoản, không theo %.
-- Mục tiêu gắn tài khoản mẹ, không gắn tài khoản con.
ALTER TABLE reserve_goals ADD COLUMN pays_from TEXT NOT NULL DEFAULT 'account' CHECK (pays_from IN ('account','operating'));
CREATE TRIGGER trg_reserve_goals_operating_insert BEFORE INSERT ON reserve_goals
WHEN NEW.pays_from = 'operating'
  AND (NEW.account_id IS NOT NULL OR NEW.repeat_months IS NOT 1 OR NEW.monthly_amount IS NULL OR NEW.target_pct IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'operating_goal_monthly');
END;
CREATE TRIGGER trg_reserve_goals_operating BEFORE UPDATE OF pays_from, account_id, repeat_months, monthly_amount, target_pct ON reserve_goals
WHEN NEW.pays_from = 'operating'
  AND (NEW.account_id IS NOT NULL OR NEW.repeat_months IS NOT 1 OR NEW.monthly_amount IS NULL OR NEW.target_pct IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'operating_goal_monthly');
END;
CREATE TRIGGER trg_reserve_goals_not_child_insert BEFORE INSERT ON reserve_goals
WHEN NEW.active = 1 AND NEW.account_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.parent_account_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'goal_on_child');
END;
CREATE TRIGGER trg_reserve_goals_not_child BEFORE UPDATE OF account_id, active ON reserve_goals
WHEN NEW.active = 1 AND NEW.account_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.parent_account_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'goal_on_child');
END;

-- Bước 4: khoản chi / chuyển ra cho mục tiêu — mục tiêu tài khoản: tiền ra từ tài khoản của nó hoặc con của nó; mục tiêu trả
-- từ tiền chi tiêu: tiền ra từ một tài khoản ngăn Vận hành.
DROP TRIGGER trg_tx_goal_insert;
DROP TRIGGER trg_tx_goal;
CREATE TRIGGER trg_tx_goal_insert BEFORE INSERT ON transactions
WHEN NEW.goal_id IS NOT NULL
  AND (NEW.meaning NOT IN ('spend', 'transfer')
    OR NOT EXISTS (SELECT 1 FROM reserve_goals g JOIN accounts a ON a.id = NEW.account_id WHERE g.id = NEW.goal_id AND g.active = 1
      AND ((g.pays_from = 'account' AND g.account_id = COALESCE(a.parent_account_id, a.id))
        OR (g.pays_from = 'operating' AND a.pocket = 'operating'))))
BEGIN
  SELECT RAISE(ABORT, 'invalid_goal');
END;
CREATE TRIGGER trg_tx_goal BEFORE UPDATE OF goal_id, account_id, meaning ON transactions
WHEN NEW.goal_id IS NOT NULL
  AND (NEW.meaning NOT IN ('spend', 'transfer')
    OR NOT EXISTS (SELECT 1 FROM reserve_goals g JOIN accounts a ON a.id = NEW.account_id WHERE g.id = NEW.goal_id AND g.active = 1
      AND ((g.pays_from = 'account' AND g.account_id = COALESCE(a.parent_account_id, a.id))
        OR (g.pays_from = 'operating' AND a.pocket = 'operating'))))
BEGIN
  SELECT RAISE(ABORT, 'invalid_goal');
END;

-- Bước 5: rút từ tiền lãi — chi / chuyển ra khỏi nhóm mẹ có mục tiêu + con, không kèm mục tiêu. Trần "không vượt tiền lãi
-- đang có" kiểm ở code (tiền lãi tính cộng dồn).
ALTER TABLE transactions ADD COLUMN from_interest INTEGER NOT NULL DEFAULT 0 CHECK (from_interest IN (0,1));
CREATE TRIGGER trg_tx_interest_insert BEFORE INSERT ON transactions
WHEN NEW.from_interest = 1 AND (
  NEW.meaning NOT IN ('spend', 'transfer') OR NEW.goal_id IS NOT NULL
  OR NOT EXISTS (SELECT 1 FROM accounts a JOIN reserve_goals g ON g.account_id = COALESCE(a.parent_account_id, a.id) AND g.active = 1
    WHERE a.id = NEW.account_id)
  OR EXISTS (SELECT 1 FROM accounts a JOIN accounts c ON c.id = NEW.counter_account_id
    WHERE a.id = NEW.account_id AND COALESCE(c.parent_account_id, c.id) = COALESCE(a.parent_account_id, a.id)))
BEGIN
  SELECT RAISE(ABORT, 'invalid_interest');
END;
CREATE TRIGGER trg_tx_interest BEFORE UPDATE OF from_interest, meaning, goal_id, account_id, counter_account_id ON transactions
WHEN NEW.from_interest = 1 AND (
  NEW.meaning NOT IN ('spend', 'transfer') OR NEW.goal_id IS NOT NULL
  OR NOT EXISTS (SELECT 1 FROM accounts a JOIN reserve_goals g ON g.account_id = COALESCE(a.parent_account_id, a.id) AND g.active = 1
    WHERE a.id = NEW.account_id)
  OR EXISTS (SELECT 1 FROM accounts a JOIN accounts c ON c.id = NEW.counter_account_id
    WHERE a.id = NEW.account_id AND COALESCE(c.parent_account_id, c.id) = COALESCE(a.parent_account_id, a.id)))
BEGIN
  SELECT RAISE(ABORT, 'invalid_interest');
END;

-- Bước 6.
UPDATE config SET v = '1.44' WHERE k = 'schema_version';
