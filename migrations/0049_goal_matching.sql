-- 0049 — Khớp khoản chi vào mục tiêu Dự phòng (change 261117-khop-chi-muc-tieu, pocket UC-1209 AC-24…AC-31, ingest UC-303 AC-34).
-- Schema 1.49. Không xoá, không sửa dòng nào.

-- Chốt xong (người bấm): mục tiêu một lần / hằng tháng. NULL = chưa chốt; mở lại → NULL. Mục tiêu hằng tháng chỉ tính là đã chốt
-- trong tháng VN chứa lúc chốt; mục tiêu lặp N tháng (N > 1) không dùng cột này mà khép đợt ở goal_periods.
ALTER TABLE reserve_goals ADD COLUMN closed_at TEXT;

-- Đợt của mục tiêu lặp N tháng (Q1): đợt hiện tại = dòng mới nhất chưa khép; chưa có dòng nào = đợt đầu, bắt đầu ngày tạo mục tiêu.
-- Chốt → khép dòng hiện tại + thêm dòng mới (bắt đầu lúc chốt, hạn + N tháng); mở lại → xoá dòng mới, mở lại dòng cũ.
CREATE TABLE goal_periods (
  id         INTEGER PRIMARY KEY,
  goal_id    TEXT NOT NULL REFERENCES reserve_goals(id),
  started_at TEXT NOT NULL,              -- ISO; đã chi của đợt tính từ đây
  due_date   TEXT,                       -- 'YYYY-MM-DD' hạn của đợt
  closed_at  TEXT,                       -- NULL = đợt đang mở
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_goal_periods_goal ON goal_periods(goal_id, id);

-- Việc chuyển về (kiểu B): khoản chi từ tài khoản ngoài nhóm của mục tiêu đã khớp vào mục tiêu → chuyển `amount` từ tài khoản mục
-- tiêu về tài khoản đã trả. Số chốt lúc tạo; mỗi khoản chi một việc chưa huỷ; mã như month_tasks.code (QR "CV {mã} T{tháng}").
CREATE TABLE goal_refunds (
  id              INTEGER PRIMARY KEY,
  goal_id         TEXT NOT NULL REFERENCES reserve_goals(id),
  spend_tx_id     INTEGER NOT NULL REFERENCES transactions(id),
  from_account_id TEXT NOT NULL REFERENCES accounts(id),   -- tài khoản mục tiêu (mẹ)
  to_account_id   TEXT NOT NULL REFERENCES accounts(id),   -- tài khoản đã trả
  amount          INTEGER NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped','void')),
  reason          TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  by_member_id    TEXT REFERENCES members(id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  code            TEXT GENERATED ALWAYS AS (
    substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (((id * 742297) % 1048576) >> 15 & 31) + 1, 1) ||
    substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (((id * 742297) % 1048576) >> 10 & 31) + 1, 1) ||
    substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (((id * 742297) % 1048576) >> 5 & 31) + 1, 1) ||
    substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (((id * 742297) % 1048576) & 31) + 1, 1)
  ) VIRTUAL
);
CREATE UNIQUE INDEX idx_goal_refunds_spend ON goal_refunds(spend_tx_id) WHERE status <> 'void';
CREATE INDEX idx_goal_refunds_status ON goal_refunds(status, goal_id);
CREATE INDEX idx_goal_refunds_code ON goal_refunds(code);
CREATE TRIGGER trg_goal_refunds_reason_insert BEFORE INSERT ON goal_refunds
WHEN NEW.status = 'skipped' AND NEW.reason IS NULL
BEGIN
  SELECT RAISE(ABORT, 'reason_required');
END;
CREATE TRIGGER trg_goal_refunds_reason BEFORE UPDATE OF status, reason ON goal_refunds
WHEN NEW.status = 'skipped' AND NEW.reason IS NULL
BEGIN
  SELECT RAISE(ABORT, 'reason_required');
END;

-- Chuyển khoản đã ghép vào việc chuyển về (tự tick hoặc theo mã CV). Ghép trước việc tháng (TL / CD / VT).
CREATE TABLE goal_refund_tx (
  refund_id  INTEGER NOT NULL REFERENCES goal_refunds(id),
  tx_id      INTEGER NOT NULL REFERENCES transactions(id),
  amount     INTEGER NOT NULL CHECK (amount > 0),
  by_code    INTEGER NOT NULL DEFAULT 0 CHECK (by_code IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (refund_id, tx_id)
);
CREATE INDEX idx_goal_refund_tx ON goal_refund_tx(tx_id);

-- goal_id: như 0044, thêm khoản chi (spend) từ tài khoản ngoài nhóm cho mục tiêu tài khoản đang dùng đã gắn tài khoản (kiểu B).
DROP TRIGGER trg_tx_goal_insert;
DROP TRIGGER trg_tx_goal;
CREATE TRIGGER trg_tx_goal_insert BEFORE INSERT ON transactions
WHEN NEW.goal_id IS NOT NULL
  AND (NEW.meaning NOT IN ('spend', 'transfer')
    OR NOT EXISTS (SELECT 1 FROM reserve_goals g JOIN accounts a ON a.id = NEW.account_id WHERE g.id = NEW.goal_id AND g.active = 1
      AND ((g.pays_from = 'account' AND g.account_id = COALESCE(a.parent_account_id, a.id))
        OR (g.pays_from = 'account' AND g.account_id IS NOT NULL AND NEW.meaning = 'spend')
        OR (g.pays_from = 'operating' AND a.pocket = 'operating'))))
BEGIN
  SELECT RAISE(ABORT, 'invalid_goal');
END;
CREATE TRIGGER trg_tx_goal BEFORE UPDATE OF goal_id, account_id, meaning ON transactions
WHEN NEW.goal_id IS NOT NULL
  AND (NEW.meaning NOT IN ('spend', 'transfer')
    OR NOT EXISTS (SELECT 1 FROM reserve_goals g JOIN accounts a ON a.id = NEW.account_id WHERE g.id = NEW.goal_id AND g.active = 1
      AND ((g.pays_from = 'account' AND g.account_id = COALESCE(a.parent_account_id, a.id))
        OR (g.pays_from = 'account' AND g.account_id IS NOT NULL AND NEW.meaning = 'spend')
        OR (g.pays_from = 'operating' AND a.pocket = 'operating'))))
BEGIN
  SELECT RAISE(ABORT, 'invalid_goal');
END;

-- Mục tiêu đã chốt (trong kỳ chứa lúc chốt — `goalClosedSql` ở src/domain/pockets.ts) không nhận khoản mới: một lần = có closed_at;
-- hằng tháng = closed_at trong tháng VN hiện tại.
CREATE TRIGGER trg_tx_goal_closed_insert BEFORE INSERT ON transactions
WHEN NEW.goal_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM reserve_goals g WHERE g.id = NEW.goal_id AND g.closed_at IS NOT NULL
    AND (g.repeat_months IS NULL OR (g.repeat_months = 1 AND strftime('%Y-%m', g.closed_at, '+7 hours') = strftime('%Y-%m', 'now', '+7 hours'))))
BEGIN
  SELECT RAISE(ABORT, 'goal_closed');
END;
CREATE TRIGGER trg_tx_goal_closed BEFORE UPDATE OF goal_id ON transactions
WHEN NEW.goal_id IS NOT NULL AND NEW.goal_id IS NOT OLD.goal_id
  AND EXISTS (SELECT 1 FROM reserve_goals g WHERE g.id = NEW.goal_id AND g.closed_at IS NOT NULL
    AND (g.repeat_months IS NULL OR (g.repeat_months = 1 AND strftime('%Y-%m', g.closed_at, '+7 hours') = strftime('%Y-%m', 'now', '+7 hours'))))
BEGIN
  SELECT RAISE(ABORT, 'goal_closed');
END;

UPDATE config SET v = '1.49' WHERE k = 'schema_version';
