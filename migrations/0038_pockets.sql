-- v1.37 -> v1.38 (Ba ngăn Tích luỹ · Dự phòng · Vận hành, Đợt A: nền dữ liệu — change 261112-ba-ngan-nen-du-lieu,
-- ADR-119, ADR-120, ADR-121; sửa trước khi phát hành ở Đợt E — ADR-132). CHỈ THÊM: không DROP, không dựng lại bảng, không
-- đụng transactions / ví / luật nạp / lệnh chuyển.
--  * accounts.pocket ('savings' Tích luỹ | 'reserve' Dự phòng | 'operating' Vận hành | NULL ngoài ngăn) + pocket_confirmed:
--    điền sẵn ĐỀ XUẤT theo luật chung (dừng ở luật đầu tiên khớp), mọi dòng "chưa xác nhận" (pocket UC-1201).
--  * income_streams.pocket: ngăn của tiền về (NULL = theo tài khoản nhận); nguồn khoá 100% vào ví Tích sản → 'savings'.
--  * reserve_goals: mục tiêu Dự phòng, mỗi mục tiêu gắn tối đa một tài khoản thật ngăn Dự phòng, A = số dư tài khoản đó
--    (pocket UC-1209, ADR-132). Điền sẵn từ ví chi tiêu cũ, KHÔNG gắn tài khoản nào: chỉ lưu tài khoản đề xuất.
--  * category_groups + categories.group_id: nhóm danh mục, cờ Thiết yếu, hạn mức mềm mỗi kỳ lương (UC-1204).
--  * config savings_pct: % Tích luỹ mỗi kỳ lương (UC-507), từ luật tỷ lệ Tích sản đang dùng, không có → '10'.
--  Ví chi tiêu = phe Must / Hưởng thụ (tier must, nice). Mỗi ví lấy MỘT luật nạp đang dùng: mã nhỏ nhất. Không lấy ví
--  "Lãi vay" (mã hệ thống loan-interest) và Ví Thưởng của chốt tháng (config month_close_reward_wallet).

ALTER TABLE accounts ADD COLUMN pocket TEXT CHECK (pocket IS NULL OR pocket IN ('savings','reserve','operating'));
ALTER TABLE accounts ADD COLUMN pocket_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (pocket_confirmed IN (0,1));
ALTER TABLE income_streams ADD COLUMN pocket TEXT CHECK (pocket IS NULL OR pocket IN ('savings','reserve','operating'));

CREATE TABLE category_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  essential   INTEGER NOT NULL DEFAULT 0 CHECK (essential IN (0,1)),
  cycle_limit INTEGER CHECK (cycle_limit IS NULL OR cycle_limit > 0),
  sort        INTEGER NOT NULL DEFAULT 100,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);
ALTER TABLE categories ADD COLUMN group_id TEXT REFERENCES category_groups(id);

-- Mục tiêu Dự phòng (pocket UC-1209): tài khoản gắn (account_id) phải đang dùng và ở ngăn Dự phòng, mỗi tài khoản tối đa
-- một mục tiêu đang dùng; suggested_account_id chỉ là gợi ý của bản cập nhật, không ràng buộc gì.
CREATE TABLE reserve_goals (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  account_id           TEXT REFERENCES accounts(id),
  suggested_account_id TEXT REFERENCES accounts(id),
  target_amount        INTEGER CHECK (target_amount IS NULL OR target_amount > 0),
  target_pct           INTEGER CHECK (target_pct IS NULL OR target_pct BETWEEN 1 AND 100),
  monthly_amount       INTEGER CHECK (monthly_amount IS NULL OR monthly_amount > 0),
  repeat_months        INTEGER CHECK (repeat_months IS NULL OR repeat_months BETWEEN 1 AND 12),
  due_date             TEXT,
  debt_id              TEXT REFERENCES debts(id),
  sort                 INTEGER NOT NULL DEFAULT 100,
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((target_amount IS NULL) <> (target_pct IS NULL)),
  CHECK ((monthly_amount IS NULL) = (repeat_months IS NULL)),
  CHECK (monthly_amount IS NULL OR target_amount = monthly_amount * repeat_months),
  CHECK (target_pct IS NULL OR repeat_months IS NULL)
);
CREATE UNIQUE INDEX idx_reserve_goals_account ON reserve_goals(account_id) WHERE active = 1 AND account_id IS NOT NULL;
CREATE UNIQUE INDEX idx_reserve_goals_debt ON reserve_goals(debt_id) WHERE active = 1 AND debt_id IS NOT NULL;

CREATE TRIGGER trg_reserve_goals_account_insert BEFORE INSERT ON reserve_goals
WHEN NEW.active = 1 AND NEW.account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.active = 1 AND a.pocket = 'reserve')
BEGIN
  SELECT RAISE(ABORT, 'account_not_reserve');
END;
CREATE TRIGGER trg_reserve_goals_account BEFORE UPDATE OF account_id, active ON reserve_goals
WHEN NEW.active = 1 AND NEW.account_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.active = 1 AND a.pocket = 'reserve')
BEGIN
  SELECT RAISE(ABORT, 'account_not_reserve');
END;
-- Tài khoản đang gắn mục tiêu đang dùng không rời ngăn Dự phòng, không tắt được (UC-1209 bước 3).
CREATE TRIGGER trg_accounts_keep_goal BEFORE UPDATE OF pocket, active ON accounts
WHEN (NEW.pocket IS NOT 'reserve' OR NEW.active = 0)
  AND EXISTS (SELECT 1 FROM reserve_goals g WHERE g.account_id = NEW.id AND g.active = 1)
BEGIN
  SELECT RAISE(ABORT, 'account_has_goal');
END;

-- Ngăn đề xuất (UC-1201 bước 2, ADR-120): thẻ tín dụng đứng TRƯỚC luật chỗ ở ví Tích sản; luật đó chỉ áp khi tài khoản
-- đang tắt "Tính vào tiền vận hành".
UPDATE accounts SET pocket = CASE
  WHEN role = 'piggy_bank' THEN 'savings'
  WHEN role IN ('term_deposit','buffer') THEN 'reserve'
  WHEN kind = 'credit' THEN 'operating'
  WHEN role IS NULL AND spendable = 0
       AND EXISTS (SELECT 1 FROM wallets w WHERE w.tier = 'wealth_building' AND w.active = 1 AND w.account_id = accounts.id) THEN 'savings'
  WHEN spendable = 1 AND locked = 0 THEN 'operating'
  ELSE NULL
END;

UPDATE income_streams SET pocket = 'savings'
WHERE (SELECT COUNT(*) FROM income_stream_locks l WHERE l.stream_id = income_streams.id) = 1
  AND EXISTS (SELECT 1 FROM income_stream_locks l JOIN wallets w ON w.id = l.wallet_id
              WHERE l.stream_id = income_streams.id AND l.percent = 1 AND w.tier = 'wealth_building');

-- Nhóm danh mục: mỗi ví chi tiêu đang dùng là ví mặc định của ít nhất một danh mục đang dùng. Hạn mức từ luật số cố định
-- (flat / lump) của ví phong bì: theo tháng giữ số, theo tuần × 52 ÷ 12 làm tròn lên 1.000.
INSERT INTO category_groups (id, name, essential, cycle_limit, sort)
SELECT w.id, w.name,
       CASE WHEN w.tier = 'must' AND w.must_group = 'must' THEN 1 ELSE 0 END,
       CASE WHEN w.kind = 'envelope' AND a.mode IN ('flat','lump') THEN
         CASE WHEN a.mode = 'flat' AND a.period = 'week' THEN CAST((a.amount * 52 + 11999) / 12000 AS INTEGER) * 1000
              ELSE COALESCE(a.amount, a.target_amount) END
       END,
       w.sort
FROM wallets w
LEFT JOIN allocations a ON a.id = (SELECT MIN(x.id) FROM allocations x WHERE x.wallet_id = w.id AND x.active = 1)
WHERE w.active = 1 AND w.tier IN ('must','nice')
  AND w.id <> 'loan-interest'
  AND w.id IS NOT (SELECT v FROM config WHERE k = 'month_close_reward_wallet')
  AND EXISTS (SELECT 1 FROM categories c WHERE c.default_wallet_id = w.id AND c.active = 1);

UPDATE categories SET group_id = default_wallet_id
WHERE active = 1 AND default_wallet_id IN (SELECT id FROM category_groups);

-- Mục tiêu Dự phòng điền sẵn (mã = mã ví): ví chi tiêu tích dồn / hoá đơn có luật số cố định → lặp hằng tháng; có luật
-- "mục tiêu" → một lần, hạn = ngày mục tiêu; ví Thuế có luật tỷ lệ → % thu chịu thuế. Không gắn tài khoản nào (A chưa có).
-- Tài khoản đề xuất = chỗ ở của ví khi tài khoản đó (đang dùng) được đề xuất Dự phòng VÀ chỉ là chỗ ở của đúng một ví đang
-- dùng (chính ví này) — tài khoản còn chứa ví khác thì số dư không phải tiền của riêng mục tiêu (ADR-132 (1)).
INSERT INTO reserve_goals (id, name, suggested_account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date, sort)
SELECT id, name, suggested,
       CASE WHEN target_pct IS NULL THEN COALESCE(monthly, target) END,
       target_pct, monthly, CASE WHEN monthly IS NULL THEN NULL ELSE 1 END, due_date, sort
FROM (
  SELECT w.id, w.name, w.sort,
         (SELECT acc.id FROM accounts acc WHERE acc.id = w.account_id AND acc.active = 1 AND acc.pocket = 'reserve'
            AND (SELECT COUNT(*) FROM wallets o WHERE o.active = 1 AND o.account_id = acc.id) = 1) AS suggested,
         CASE WHEN w.tier IN ('must','nice') AND a.mode IN ('flat','lump') THEN
           CASE WHEN a.mode = 'flat' AND a.period = 'week' THEN CAST((a.amount * 52 + 11999) / 12000 AS INTEGER) * 1000
                ELSE COALESCE(a.amount, a.target_amount) END
         END AS monthly,
         CASE WHEN w.tier IN ('must','nice') AND a.mode = 'goal' THEN a.target_amount END AS target,
         CASE WHEN w.tier IN ('must','nice') AND a.mode = 'goal' THEN a.target_date END AS due_date,
         CASE WHEN w.tier = 'tax' AND a.mode = 'percent' THEN MIN(100, CAST(ROUND(a.percent * 100) AS INTEGER)) END AS target_pct
  FROM wallets w
  JOIN allocations a ON a.id = (SELECT MIN(x.id) FROM allocations x WHERE x.wallet_id = w.id AND x.active = 1)
  WHERE w.active = 1
    AND ((w.tier IN ('must','nice') AND w.kind IN ('accrual','bill')) OR w.tier = 'tax')
    AND w.id <> 'loan-interest'
    AND w.id IS NOT (SELECT v FROM config WHERE k = 'month_close_reward_wallet')
)
WHERE (monthly IS NOT NULL AND monthly > 0) OR (target IS NOT NULL AND target > 0) OR (target_pct IS NOT NULL AND target_pct >= 1);

-- % Tích luỹ: Σ tỷ lệ luật tỷ lệ đang dùng của ví Tích sản đang dùng × 100, làm tròn, số nguyên; dưới 1 → '10'.
INSERT INTO config (k, v) VALUES ('savings_pct', COALESCE((
  SELECT CASE WHEN p >= 1 THEN CAST(MIN(100, p) AS TEXT) END
  FROM (SELECT CAST(ROUND(SUM(a.percent) * 100) AS INTEGER) AS p
        FROM wallets w
        JOIN allocations a ON a.id = (SELECT MIN(x.id) FROM allocations x WHERE x.wallet_id = w.id AND x.active = 1)
        WHERE w.active = 1 AND w.tier = 'wealth_building' AND a.mode = 'percent')
), '10'));

UPDATE config SET v = '1.38' WHERE k = 'schema_version';
