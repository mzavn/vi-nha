-- v1.36 -> v1.37 (Webhook trước mốc nối vào khoản đã nhập tay — change 261017-webhook-truoc-moc, mở rộng ADR-113):
--  * Nối một log vào giao dịch có sẵn (khoản nhập tay) là UPDATE log_id. Như chân thứ hai (log_id_2), log mới gắn vào
--    phải còn 'pending' — hai request cùng nối / gán một log thì request sau bị huỷ cả batch, không vào sổ hai lần.
--  Không đổi dữ liệu.

CREATE TRIGGER trg_tx_log_id_needs_pending_log BEFORE UPDATE OF log_id ON transactions
WHEN NEW.log_id IS NOT NULL AND NEW.log_id IS NOT OLD.log_id
  AND (SELECT status FROM bank_logs WHERE id = NEW.log_id) IS NOT 'pending'
BEGIN
  SELECT RAISE(ABORT, 'log_not_pending');
END;

UPDATE config SET v = '1.37' WHERE k = 'schema_version';
