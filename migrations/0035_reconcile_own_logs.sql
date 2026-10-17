-- v1.34 -> v1.35 (Đối soát chỉ tính giao dịch sinh từ log CỦA chính tài khoản — change 261016-lech-gia-khi-noi-sepay-sau):
--  * v_account_tx_from_logs: trước đây cộng mọi giao dịch có log_id chạm tài khoản, kể cả khi log thuộc tài khoản kia
--    (chuyển khoản ghi từ log ra của tài khoản gửi). Tài khoản nhận nối SePay sau đó báo lệch giả bằng đúng các khoản đó.
--    Nay: giao dịch vào phần sổ sinh từ log của A chỉ khi log_id hoặc log_id_2 là log của A, trong cùng phạm vi ngày với
--    v_account_logs (ngày VN của log ≥ opened_at). Mỗi giao dịch đếm một lần cho mỗi tài khoản.

DROP VIEW v_reconcile;
DROP VIEW v_account_tx_from_logs;

CREATE VIEW v_account_tx_from_logs AS
  SELECT a.id AS account_id,
         COALESCE(SUM(CASE WHEN t.account_id=a.id THEN -t.amount ELSE t.amount END),0) AS tx_net
  FROM accounts a JOIN transactions t
    ON t.status='active' AND (t.account_id=a.id OR t.counter_account_id=a.id)
   AND EXISTS (
     SELECT 1 FROM bank_logs l
     WHERE l.id IN (t.log_id, t.log_id_2) AND l.account_id=a.id
       AND (a.opened_at IS NULL OR date(l.at, '+7 hours') >= a.opened_at)
   )
  GROUP BY a.id;

CREATE VIEW v_reconcile AS
  SELECT b.account_id, b.name, b.kind, b.book_balance,
         g.feed_balance,
         CASE WHEN g.account_id IS NULL THEN NULL
              ELSE COALESCE(x.tx_net,0) - g.assigned_net END AS book_drift,
         COALESCE(g.pending_net,0)   AS pending_net,
         COALESCE(g.pending_count,0) AS pending_count,
         (SELECT MAX(l.at) FROM bank_logs l WHERE l.account_id=b.account_id) AS last_at
  FROM v_account_book b
  LEFT JOIN v_account_logs g         ON g.account_id=b.account_id
  LEFT JOIN v_account_tx_from_logs x ON x.account_id=b.account_id;

UPDATE config SET v = '1.35' WHERE k = 'schema_version';
