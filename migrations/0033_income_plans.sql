-- v1.32 -> v1.33 (Mốc tự do, kế hoạch thu nhập năm — change 261008-bang-can-doi, lát 3):
--  * income_plans: mỗi lần lưu kế hoạch một năm là một bản mới (chỉ ghi thêm): mục tiêu cả nhà / tháng. Bản id nhỏ nhất của
--    năm là mục tiêu đầu năm, id lớn nhất là hiện tại.
--  * income_plan_lines: chia theo người (member_id NULL = Chung) của một bản; không có dòng = không chia. Một bản đã lưu
--    không đổi, nên dòng của nó cũng chỉ ghi thêm.
--  * Tham số Mốc tự do (fi_*) đã có từ 0031; Thử số không có bảng nào.

CREATE TABLE income_plans (
  id                INTEGER PRIMARY KEY,
  year              INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  household_monthly INTEGER NOT NULL CHECK (household_monthly > 0),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  by_member_id      TEXT REFERENCES members(id)
);
CREATE INDEX idx_income_plans_year ON income_plans(year, id);

CREATE TABLE income_plan_lines (
  id             INTEGER PRIMARY KEY,
  plan_id        INTEGER NOT NULL REFERENCES income_plans(id),
  member_id      TEXT REFERENCES members(id),
  name           TEXT NOT NULL,
  monthly_amount INTEGER NOT NULL CHECK (monthly_amount >= 0),
  sort           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_income_plan_lines ON income_plan_lines(plan_id);

CREATE TRIGGER trg_income_plans_no_update BEFORE UPDATE ON income_plans
BEGIN
  SELECT RAISE(ABORT, 'income_plan_append_only');
END;
CREATE TRIGGER trg_income_plans_no_delete BEFORE DELETE ON income_plans
BEGIN
  SELECT RAISE(ABORT, 'income_plan_append_only');
END;
CREATE TRIGGER trg_income_plan_lines_no_update BEFORE UPDATE ON income_plan_lines
BEGIN
  SELECT RAISE(ABORT, 'income_plan_append_only');
END;
CREATE TRIGGER trg_income_plan_lines_no_delete BEFORE DELETE ON income_plan_lines
BEGIN
  SELECT RAISE(ABORT, 'income_plan_append_only');
END;

UPDATE config SET v = '1.33' WHERE k = 'schema_version';
