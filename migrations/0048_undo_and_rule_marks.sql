-- 0048 — Hoàn tác chia dư và dấu tự gán (change 261113-gop-man-va-trai-nghiem, pocket UC-1207 AC-7, ingest UC-307 AC-25).
-- Schema 1.48. Không xoá, không sửa dòng nào.

-- Mẫu đã tự gán khoản này (chỉ khoản do mẫu ghi; khoản trước bản này để NULL — không đoán ngược).
ALTER TABLE transactions ADD COLUMN rule_id INTEGER REFERENCES rules(id);

-- Mở lại tháng đã chia / để lại Vận hành (`POST /v1/month-close/:month/reopen`): service void mọi việc chia dư của tháng rồi xoá
-- dòng trong cùng một batch. Còn việc chia dư chưa void thì vẫn không xoá được; UPDATE vẫn bị chặn như cũ.
DROP TRIGGER trg_month_surplus_no_delete;
CREATE TRIGGER trg_month_surplus_no_delete BEFORE DELETE ON month_surplus
WHEN EXISTS (SELECT 1 FROM month_tasks WHERE kind = 'surplus' AND month_key = OLD.month_key AND status <> 'void')
BEGIN
  SELECT RAISE(ABORT, 'month_closed');
END;

UPDATE config SET v = '1.48' WHERE k = 'schema_version';
