-- 0050 — Bỏ qua khoản chưa khớp mục tiêu (change 261117-bo-qua-khop-muc-tieu, pocket UC-1209 AC-32, AC-33).
-- Schema 1.50. Không xoá, không sửa dòng nào.

-- Người xác nhận khoản chi / chuyển ra khỏi nhóm này không cho mục tiêu nào (BR-07): thôi đếm vào `unmatched`, không có trong danh
-- sách gợi ý mặc định. NULL = chưa bỏ qua. Chỉ có nghĩa khi goal_id IS NULL; không vào phép chia, báo cáo, số dư.
ALTER TABLE transactions ADD COLUMN goal_skipped_at TEXT;

-- Đặt goal_id (mọi đường ghi: khớp, sửa, Gán, MCP) thì xoá cờ bỏ qua. Không đệ quy: recursive_triggers tắt và điều kiện đã sai sau lần một.
CREATE TRIGGER trg_tx_goal_skip_clear AFTER UPDATE OF goal_id ON transactions
WHEN NEW.goal_id IS NOT NULL AND NEW.goal_skipped_at IS NOT NULL
BEGIN
  UPDATE transactions SET goal_skipped_at = NULL WHERE id = NEW.id;
END;

UPDATE config SET v = '1.50' WHERE k = 'schema_version';
