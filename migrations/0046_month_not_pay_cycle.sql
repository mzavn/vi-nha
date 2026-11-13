-- 0046 — Tháng dương lịch thay kỳ lương; lương về chỉ nhắc trích Tích luỹ; chia dư cuối tháng (change
-- 261112-thang-thay-ky-luong, pocket UC-1205, UC-1206, UC-1207, UC-1209, ADR-144). Schema 1.46.
-- Không xoá dòng nào: bảng kỳ cũ ở lại làm lịch sử chỉ đọc. Chạy trên DB của mọi nhà (D1 trống cũng chạy được).

-- 1. Đổi tên theo mô hình tháng, khoá ngưỡng nhắc trích mới (không đụng salary_min_amount — ngưỡng tự ghi của mẫu lương).
ALTER TABLE income_streams RENAME COLUMN opens_cycle TO is_salary;
ALTER TABLE category_groups RENAME COLUMN cycle_limit TO monthly_limit;
INSERT OR IGNORE INTO config (k, v) VALUES ('salary_reminder_min', '5000000');

-- 2. Lựa chọn "lương / không phải lương" của từng khoản thu (Q1-B). Điền 1 cho khoản đã mở kỳ hoặc có việc ① chưa void.
--    UPDATE chỉ đụng cột is_salary: trong các trigger UPDATE của transactions chỉ trg_tx_legacy_frozen chạy, và nó chỉ chặn
--    khi đổi meaning / legacy_class — không trigger nào chặn.
ALTER TABLE transactions ADD COLUMN is_salary INTEGER NOT NULL DEFAULT 0 CHECK (is_salary IN (0,1));
UPDATE transactions SET is_salary = 1
WHERE meaning = 'income' AND (
  id IN (SELECT income_tx_id FROM pay_cycles WHERE status = 'active')
  OR id IN (SELECT source_tx_id FROM pay_cycle_tasks WHERE kind = 'savings' AND status <> 'void' AND source_tx_id IS NOT NULL)
);
-- Chỉ khoản thu mới là lương được. Lãi tiền gửi / tiền người thuê kiểm ở service (dòng passive_income chèn sau khoản thu).
CREATE TRIGGER trg_tx_salary_income_only BEFORE INSERT ON transactions
WHEN NEW.is_salary = 1 AND NEW.meaning <> 'income'
BEGIN
  SELECT RAISE(ABORT, 'cannot_be_salary');
END;
CREATE TRIGGER trg_tx_salary_income_only_update BEFORE UPDATE OF is_salary, meaning ON transactions
WHEN NEW.is_salary = 1 AND NEW.meaning <> 'income'
BEGIN
  SELECT RAISE(ABORT, 'cannot_be_salary');
END;

-- 3. Việc theo tháng: nhắc ① trích Tích luỹ của một khoản lương (savings) và hai việc chia dư cuối tháng (surplus).
--    month_key: tháng VN của khoản lương (①) / tháng được chia (surplus). Mỗi khoản lương tối đa một nhắc còn hiệu lực.
CREATE TABLE month_tasks (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('savings','surplus')),
  month_key     TEXT NOT NULL CHECK (month_key GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  income_tx_id  INTEGER REFERENCES transactions(id),
  to_pocket     TEXT CHECK (to_pocket IS NULL OR to_pocket = 'savings'),
  to_account_id TEXT REFERENCES accounts(id),
  amount        INTEGER NOT NULL CHECK (amount >= 0),
  pct           INTEGER CHECK (pct IS NULL OR pct BETWEEN 0 AND 100),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped','void')),
  reason        TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
  by_member_id  TEXT REFERENCES members(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind <> 'savings' OR (income_tx_id IS NOT NULL AND to_pocket IS 'savings' AND to_account_id IS NULL)),
  CHECK (kind <> 'surplus' OR (income_tx_id IS NULL AND ((to_pocket IS 'savings') <> (to_account_id IS NOT NULL))))
);
CREATE UNIQUE INDEX idx_month_tasks_income ON month_tasks(income_tx_id) WHERE kind = 'savings' AND status <> 'void';
CREATE INDEX idx_month_tasks_status ON month_tasks(status, month_key);
CREATE TRIGGER trg_month_tasks_reason BEFORE INSERT ON month_tasks
WHEN NEW.kind = 'savings' AND NEW.status <> 'void' AND NEW.reason IS NULL AND (NEW.status = 'skipped' OR NEW.amount = 0)
BEGIN
  SELECT RAISE(ABORT, 'reason_required');
END;
CREATE TRIGGER trg_month_tasks_reason_update BEFORE UPDATE OF status, amount, reason ON month_tasks
WHEN NEW.kind = 'savings' AND NEW.status <> 'void' AND NEW.reason IS NULL AND (NEW.status = 'skipped' OR NEW.amount = 0)
BEGIN
  SELECT RAISE(ABORT, 'reason_required');
END;
CREATE TRIGGER trg_month_tasks_no_delete BEFORE DELETE ON month_tasks
BEGIN
  SELECT RAISE(ABORT, 'month_task_append_only');
END;

-- Liên kết việc ↔ chuyển khoản đã ghép (tự tick). Phần đã dùng của một chuyển khoản: xem src/services/month-tasks.ts.
CREATE TABLE month_task_tx (
  task_id    INTEGER NOT NULL REFERENCES month_tasks(id),
  tx_id      INTEGER NOT NULL REFERENCES transactions(id),
  amount     INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (task_id, tx_id)
);
CREATE INDEX idx_month_task_tx ON month_task_tx(tx_id);

-- Chia dư cuối tháng (UC-1207): một dòng mỗi tháng đã chia / để lại Vận hành; khoá chính chặn hai máy bấm đua. Chỉ ghi thêm.
CREATE TABLE month_surplus (
  month_key      TEXT PRIMARY KEY CHECK (month_key GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  operating_end  INTEGER NOT NULL,
  pending_at_end INTEGER NOT NULL CHECK (pending_at_end >= 0),
  early_salary   INTEGER NOT NULL CHECK (early_salary >= 0),
  held_payables  INTEGER NOT NULL CHECK (held_payables >= 0),
  held_to_payday INTEGER NOT NULL CHECK (held_to_payday >= 0),
  surplus        INTEGER NOT NULL,
  savings_pct    INTEGER NOT NULL CHECK (savings_pct BETWEEN 0 AND 100),
  status         TEXT NOT NULL CHECK (status IN ('split','skipped')),
  note           TEXT CHECK (note IS NULL OR length(note) <= 200),
  by_member_id   TEXT REFERENCES members(id),
  at             TEXT NOT NULL
);
CREATE TRIGGER trg_month_surplus_no_update BEFORE UPDATE ON month_surplus
BEGIN
  SELECT RAISE(ABORT, 'month_closed');
END;
CREATE TRIGGER trg_month_surplus_no_delete BEFORE DELETE ON month_surplus
BEGIN
  SELECT RAISE(ABORT, 'month_closed');
END;

-- Số riêng của một tháng cho mục tiêu trả từ tiền chi tiêu (0 = tháng này không trả); tháng không có dòng → số mỗi tháng.
CREATE TABLE goal_month_amounts (
  goal_id    TEXT NOT NULL REFERENCES reserve_goals(id),
  month_key  TEXT NOT NULL CHECK (month_key GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  amount     INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  note       TEXT CHECK (note IS NULL OR length(note) <= 80),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (goal_id, month_key)
);

-- 4. Kỳ đang mở (kỳ active có payday lớn nhất): chép ① chưa void sang month_tasks, giữ id để chép liên kết. ② / ③ / ④ ở lại
--    làm lịch sử; liên kết của chúng vẫn tính là đã dùng. Kỳ không bị void.
INSERT INTO month_tasks (id, kind, month_key, income_tx_id, to_pocket, to_account_id, amount, pct, status, reason, by_member_id, created_at, updated_at)
SELECT k.id, 'savings', strftime('%Y-%m', t.at, '+7 hours'), k.source_tx_id, 'savings', NULL, k.amount, k.pct, k.status, k.reason, k.by_member_id,
       strftime('%Y-%m-%dT%H:%M:%fZ', k.created_at), COALESCE(k.done_at, strftime('%Y-%m-%dT%H:%M:%fZ', k.created_at))
FROM pay_cycle_tasks k JOIN transactions t ON t.id = k.source_tx_id
WHERE k.kind = 'savings' AND k.status <> 'void'
  AND k.cycle_id = (SELECT id FROM pay_cycles WHERE status = 'active' ORDER BY payday DESC LIMIT 1);
INSERT INTO month_task_tx (task_id, tx_id, amount, created_at)
SELECT x.task_id, x.tx_id, x.amount, strftime('%Y-%m-%dT%H:%M:%fZ', x.created_at) FROM pay_cycle_task_tx x WHERE x.task_id IN (SELECT id FROM month_tasks);

-- 5. Tháng 10 đã xử lý bằng việc ④ của kỳ lương 1: tháng đầu tiên được chia là 2026-11.
INSERT INTO month_surplus (month_key, operating_end, pending_at_end, early_salary, held_payables, held_to_payday, surplus, savings_pct, status, note, by_member_id, at)
VALUES ('2026-10', 0, 0, 0, 0, 0, 0, 0, 'skipped', 'Tháng 10 đã xử lý ở kỳ lương 1 (việc ④)', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- 6. Số riêng của kỳ hiện tại → tháng của ngày lương kỳ đó (kỳ lưu: khoá = id; chưa có kỳ lưu: khoá ngày lương danh nghĩa mới nhất).
INSERT OR IGNORE INTO goal_month_amounts (goal_id, month_key, amount, note, updated_at)
SELECT g.goal_id, substr(c.payday, 1, 7), g.amount, g.note, g.updated_at
FROM goal_cycle_amounts g JOIN pay_cycles c ON CAST(c.id AS TEXT) = g.cycle_key
WHERE c.id = (SELECT id FROM pay_cycles WHERE status = 'active' ORDER BY payday DESC LIMIT 1);
INSERT OR IGNORE INTO goal_month_amounts (goal_id, month_key, amount, note, updated_at)
SELECT goal_id, substr(cycle_key, 1, 7), amount, note, updated_at FROM goal_cycle_amounts
WHERE cycle_key GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'
  AND cycle_key = (SELECT MAX(cycle_key) FROM goal_cycle_amounts WHERE cycle_key GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]')
  AND cycle_key > COALESCE((SELECT MAX(payday) FROM pay_cycles WHERE status = 'active'), '');

-- 7. Bảng kỳ cũ: lịch sử chỉ đọc.
CREATE TRIGGER trg_pay_cycles_no_insert BEFORE INSERT ON pay_cycles BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_pay_cycles_no_update BEFORE UPDATE ON pay_cycles BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_pay_cycle_tasks_no_insert BEFORE INSERT ON pay_cycle_tasks BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_pay_cycle_tasks_no_update BEFORE UPDATE ON pay_cycle_tasks BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_pay_cycle_task_tx_no_insert BEFORE INSERT ON pay_cycle_task_tx BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_pay_cycle_task_tx_no_update BEFORE UPDATE ON pay_cycle_task_tx BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_goal_cycle_amounts_no_insert BEFORE INSERT ON goal_cycle_amounts BEGIN SELECT RAISE(ABORT, 'model_changed'); END;
CREATE TRIGGER trg_goal_cycle_amounts_no_update BEFORE UPDATE ON goal_cycle_amounts BEGIN SELECT RAISE(ABORT, 'model_changed'); END;

-- 8. Màn chuyển đổi: bước 4 'pay_cycle' → 'salary' (dựng lại bảng để đổi CHECK, chép claim).
CREATE TABLE conversion_claims_new (
  step         TEXT PRIMARY KEY CHECK (step IN ('pockets','goals','savings_gap','salary','savings_pct')),
  at           TEXT NOT NULL,
  by_member_id TEXT REFERENCES members(id)
);
INSERT INTO conversion_claims_new (step, at, by_member_id)
SELECT CASE step WHEN 'pay_cycle' THEN 'salary' ELSE step END, at, by_member_id FROM conversion_claims;
DROP TABLE conversion_claims;
ALTER TABLE conversion_claims_new RENAME TO conversion_claims;
CREATE TRIGGER trg_conversion_claims_no_update BEFORE UPDATE ON conversion_claims
BEGIN
  SELECT RAISE(ABORT, 'conversion_append_only');
END;
CREATE TRIGGER trg_conversion_claims_no_delete BEFORE DELETE ON conversion_claims
BEGIN
  SELECT RAISE(ABORT, 'conversion_append_only');
END;

UPDATE config SET v = '1.46' WHERE k = 'schema_version';
