-- v1.35 -> v1.36 (Mốc theo dõi SePay cho tài khoản đã dùng — change 261017-noi-sepay-sau, ADR-113):
--  * accounts.feed_from: lúc bắt đầu theo dõi SePay (ISO toISOString, NULL = từ ngày mở sổ như cũ). Log LỊCH SỬ (rà soát,
--    Đồng bộ lại — source 'backfill') có at < feed_from coi như log trước ngày mở sổ: không vào sổ, không vào đối soát.
--    Log webhook (thời gian thực) không bao giờ bị bỏ vì mốc — webhook về trễ vẫn là giao dịch SePay mới báo.
--    Tự đặt khi bật SePay cho tài khoản đã có dữ liệu.
--  * accounts.sepay_out_from: lúc bật "SePay báo cả tiền ra" trên tài khoản đã nối; log ra trước mốc này xử lý như tài
--    khoản "chỉ tiền vào" (giữ pending, rule không tự gán).
--  * Phạm vi log của đối soát: ngày VN ≥ opened_at và (feed_from NULL hoặc at ≥ feed_from hoặc log webhook), so theo julianday (đúng cả
--    khi chuỗi giờ khác dạng). feed_balance = opening_balance + giao dịch active trước feed_from không mang log của chính
--    tài khoản trong phạm vi + log trong phạm vi — tính động, huỷ / sửa / ghi bù khoản trước mốc vẫn khớp sổ.
--  Không điền mốc cho tài khoản có sẵn: feed_from NULL cho ra đúng các số như v1.35.

ALTER TABLE accounts ADD COLUMN feed_from TEXT;
ALTER TABLE accounts ADD COLUMN sepay_out_from TEXT;

DROP VIEW v_reconcile;
DROP VIEW v_account_tx_from_logs;
DROP VIEW v_account_logs;

CREATE VIEW v_account_logs AS
  SELECT a.id AS account_id,
         a.opening_balance
         + CASE WHEN a.feed_from IS NULL THEN 0 ELSE COALESCE((
             SELECT SUM(CASE WHEN t.account_id=a.id THEN -t.amount ELSE t.amount END)
             FROM transactions t
             WHERE t.status='active' AND (t.account_id=a.id OR t.counter_account_id=a.id)
               AND julianday(t.at) < julianday(a.feed_from)
               AND NOT EXISTS (
                 SELECT 1 FROM bank_logs o
                 WHERE o.id IN (t.log_id, t.log_id_2) AND o.account_id=a.id
                   AND (a.opened_at IS NULL OR date(o.at, '+7 hours') >= a.opened_at)
                   AND (julianday(o.at) >= julianday(a.feed_from) OR o.source='webhook')
               )
           ),0) END
         + COALESCE(SUM(CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END),0) AS feed_balance,
         COALESCE(SUM(CASE WHEN l.status='assigned'
                           THEN CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END END),0) AS assigned_net,
         COALESCE(SUM(CASE WHEN l.status='pending'
                           THEN CASE l.direction WHEN 'in' THEN l.amount ELSE -l.amount END END),0) AS pending_net,
         COUNT(CASE WHEN l.status='pending' THEN 1 END) AS pending_count
  FROM accounts a JOIN bank_logs l ON l.account_id=a.id
   AND (a.opened_at IS NULL OR date(l.at, '+7 hours') >= a.opened_at)
   AND (a.feed_from IS NULL OR julianday(l.at) >= julianday(a.feed_from) OR l.source='webhook')
  GROUP BY a.id;

CREATE VIEW v_account_tx_from_logs AS
  SELECT a.id AS account_id,
         COALESCE(SUM(CASE WHEN t.account_id=a.id THEN -t.amount ELSE t.amount END),0) AS tx_net
  FROM accounts a JOIN transactions t
    ON t.status='active' AND (t.account_id=a.id OR t.counter_account_id=a.id)
   AND EXISTS (
     SELECT 1 FROM bank_logs l
     WHERE l.id IN (t.log_id, t.log_id_2) AND l.account_id=a.id
       AND (a.opened_at IS NULL OR date(l.at, '+7 hours') >= a.opened_at)
       AND (a.feed_from IS NULL OR julianday(l.at) >= julianday(a.feed_from) OR l.source='webhook')
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

UPDATE config SET v = '1.36' WHERE k = 'schema_version';
