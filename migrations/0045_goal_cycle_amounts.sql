-- 0045 — Số kỳ này và danh mục của khoản phải trả (change 261112-khoan-phai-tra-ky-nay, pocket UC-1209 bước 12, ADR-143).
-- Schema 1.45. Thêm hai bảng; không điền, không sửa dữ liệu nào. Đã trả / còn phải trả tính ra ở src/services/pockets.ts.

-- Số riêng cho một kỳ lương của mục tiêu trả từ tiền chi tiêu (0 = kỳ này không trả). `cycle_key` = `pay_cycles.id` (chữ) khi
-- có kỳ lưu, không thì ngày lương danh nghĩa đầu kỳ 'YYYY-MM-DD'. Kỳ sau không có dòng → về số mỗi tháng; dòng kỳ cũ giữ lại.
CREATE TABLE goal_cycle_amounts (
  goal_id    TEXT NOT NULL REFERENCES reserve_goals(id),
  cycle_key  TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount BETWEEN 0 AND 1000000000000),
  note       TEXT CHECK (note IS NULL OR length(note) <= 80),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (goal_id, cycle_key)
);

-- Danh mục của khoản phải trả: khoản chi từ Vận hành không gắn mục tiêu, thuộc danh mục này, tính là đã trả cho mục tiêu.
-- Mỗi danh mục thuộc tối đa một mục tiêu — không đếm hai lần.
CREATE TABLE reserve_goal_categories (
  category_id TEXT PRIMARY KEY REFERENCES categories(id),
  goal_id     TEXT NOT NULL REFERENCES reserve_goals(id)
);
CREATE INDEX idx_reserve_goal_categories_goal ON reserve_goal_categories(goal_id);

UPDATE config SET v = '1.45' WHERE k = 'schema_version';
