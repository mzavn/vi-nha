-- 0041 — Ví Thưởng ↔ tài khoản mục tiêu giữ ở tầng dữ liệu (change 261112-bao-mat-v2, pocket UC-1209, ADR-134). Schema 1.41.
-- "Tài khoản của mục tiêu đang dùng không phải Ví Thưởng" và "Ví Thưởng không gắn mục tiêu đang dùng" trước chỉ kiểm ở code:
-- hai máy ghi cùng lúc làm một tài khoản vừa là Ví Thưởng vừa là tài khoản mục tiêu. Trigger huỷ câu ghi sau. Không đổi cột,
-- không đụng dữ liệu tiền.

-- Bước 1: dọn dữ liệu đã trùng — bỏ chọn Ví Thưởng, giữ mục tiêu gắn tài khoản (kỳ lương vốn đã coi Ví Thưởng là chưa chọn).
DELETE FROM config WHERE k = 'surplus_reward_account'
  AND v IN (SELECT account_id FROM reserve_goals WHERE active = 1 AND account_id IS NOT NULL);

-- Bước 2: tài khoản của mục tiêu đang dùng không phải tài khoản Ví Thưởng.
CREATE TRIGGER trg_reserve_goals_not_reward_insert BEFORE INSERT ON reserve_goals
WHEN NEW.active = 1 AND NEW.account_id = (SELECT v FROM config WHERE k = 'surplus_reward_account')
BEGIN
  SELECT RAISE(ABORT, 'account_is_reward');
END;
CREATE TRIGGER trg_reserve_goals_not_reward BEFORE UPDATE OF account_id, active ON reserve_goals
WHEN NEW.active = 1 AND NEW.account_id = (SELECT v FROM config WHERE k = 'surplus_reward_account')
BEGIN
  SELECT RAISE(ABORT, 'account_is_reward');
END;
-- Ví Thưởng không gắn mục tiêu đang dùng (INSERT … ON CONFLICT DO UPDATE chạy trigger UPDATE).
CREATE TRIGGER trg_config_reward_insert BEFORE INSERT ON config
WHEN NEW.k = 'surplus_reward_account'
  AND EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = NEW.v AND g.active = 1)
BEGIN
  SELECT RAISE(ABORT, 'reward_has_goal');
END;
CREATE TRIGGER trg_config_reward BEFORE UPDATE OF v ON config
WHEN NEW.k = 'surplus_reward_account'
  AND EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = NEW.v AND g.active = 1)
BEGIN
  SELECT RAISE(ABORT, 'reward_has_goal');
END;

-- Bước 3.
UPDATE config SET v = '1.41' WHERE k = 'schema_version';
