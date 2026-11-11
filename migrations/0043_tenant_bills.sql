-- 0043 — Bản tính tháng cho người thuê (change 261112-tien-thue-lam-lai, rental UC-801 AC-9 / AC-11, UC-806, UC-807,
-- ADR nháp A). Schema 1.43. Phí cố định + chi chung chia đầu người + chốt tháng → mỗi (người thuê, tháng ở) một bản tính có
-- khoản theo hai hạng (fixed "Chi phí cứng" / variable "Chi phí"). Chốt & gửi ghi MỘT dòng sổ kind='bill' bằng tổng; sửa sau
-- khi gửi huỷ dòng cũ + ghi dòng mới cùng `at`. Sổ người thuê (tenant_lines + income tenant_id) và v_tenant_balance giữ
-- nguyên làm nguồn số dư: số dư từng người, bảng cân đối, tài sản ròng không đổi. Chỉ luật chung — không có dữ liệu riêng nhà nào.
--  D1 tự bọc migration trong một transaction: defer_foreign_keys có tác dụng tới COMMIT.
PRAGMA defer_foreign_keys = true;

-- Bước 1: bản tính và khoản.
CREATE TABLE tenant_bills (
  id                 INTEGER PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id),
  month_key          TEXT NOT NULL,                                  -- tháng ở / tháng dùng điện (QĐ7)
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued')),
  copied_from_id     INTEGER REFERENCES tenant_bills(id) ON DELETE SET NULL,
  receive_account_id TEXT REFERENCES accounts(id),                   -- tài khoản nhận cho QR; NULL = chưa chọn (QĐ6)
  total              INTEGER NOT NULL DEFAULT 0,                     -- Σ khoản, ghi mỗi lần lưu
  revision           INTEGER NOT NULL DEFAULT 0,                     -- khoá lạc quan: +1 mỗi lần lưu / chốt & gửi
  issued_at          TEXT,                                           -- lần chốt đầu = `at` của mọi dòng bill; mốc "Các tháng trước"
  edited_at          TEXT,                                           -- lần sửa gần nhất sau khi gửi; NULL = chưa sửa
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, month_key),
  CHECK ((status = 'issued') = (issued_at IS NOT NULL))
);
CREATE TABLE tenant_bill_items (
  id       INTEGER PRIMARY KEY,
  bill_id  INTEGER NOT NULL REFERENCES tenant_bills(id) ON DELETE CASCADE,
  sort     INTEGER NOT NULL,
  name     TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),      -- không trùng trong một bản tính (kiểm ở code)
  category TEXT NOT NULL CHECK (category IN ('fixed','variable')),
  amount   INTEGER NOT NULL CHECK (amount <> 0 AND abs(amount) <= 1000000000000)  -- âm = giảm trừ
);
CREATE INDEX idx_tenant_bill_items ON tenant_bill_items(bill_id, sort);
-- Đã gửi thì không về nháp, không đổi lúc gửi đầu, không xoá.
CREATE TRIGGER trg_tenant_bills_issued BEFORE UPDATE ON tenant_bills
WHEN OLD.status = 'issued' AND (NEW.status IS NOT 'issued' OR NEW.issued_at IS NOT OLD.issued_at)
BEGIN
  SELECT RAISE(ABORT, 'bill_issued');
END;
CREATE TRIGGER trg_tenant_bills_no_delete BEFORE DELETE ON tenant_bills
WHEN OLD.status = 'issued'
BEGIN
  SELECT RAISE(ABORT, 'bill_issued');
END;

-- Bước 2: mỗi lần chốt (t, M) → bản tính tháng M đã gửi, issued_at = lúc chốt (chuẩn ISO).
INSERT INTO tenant_bills (tenant_id, month_key, status, total, revision, issued_at, created_at)
SELECT s.tenant_id, s.month_key, 'issued',
       COALESCE((SELECT SUM(l.amount) FROM tenant_lines l
                 WHERE l.tenant_id = s.tenant_id AND l.month_key = s.month_key AND l.at = s.at
                   AND l.kind IN ('fixed','shared','adjust') AND l.status = 'active'), 0),
       1, strftime('%Y-%m-%dT%H:%M:%fZ', s.at), s.at
FROM tenant_settlements s;

-- Bước 3: dựng lại tenant_lines (thêm kind 'bill' + cột bill_id), giữ nguyên id; dòng chốt còn hiệu lực gắn bản tính của nó.
DROP VIEW v_tenant_balance;
DROP TRIGGER trg_tenant_lines_append_only;
DROP TRIGGER trg_tenant_lines_no_delete;
CREATE TABLE _m0043_tenant_lines AS SELECT * FROM tenant_lines;
DROP TABLE tenant_lines;
CREATE TABLE tenant_lines (
  id          INTEGER PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  month_key   TEXT NOT NULL,
  at          TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('opening','fixed','shared','one_off','paid_for_us','adjust','bill')),
  name        TEXT,
  amount      INTEGER NOT NULL CHECK (amount <> 0),  -- > 0 người thuê nợ thêm; < 0 giảm nợ
  category_id TEXT REFERENCES categories(id),
  client_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','void')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  bill_id     INTEGER REFERENCES tenant_bills(id),  -- dòng của một bản tính đã gửi (bill) hoặc dòng chốt cũ đã chép vào bản tính
  CHECK (kind <> 'paid_for_us' OR (amount < 0 AND category_id IS NOT NULL)),
  CHECK (kind <> 'bill' OR bill_id IS NOT NULL)
);
INSERT INTO tenant_lines (id, tenant_id, month_key, at, kind, name, amount, category_id, client_id, status, created_at, bill_id)
SELECT l.id, l.tenant_id, l.month_key, l.at, l.kind, l.name, l.amount, l.category_id, l.client_id, l.status, l.created_at,
       CASE WHEN l.kind IN ('fixed','shared','adjust') AND l.status = 'active'
            THEN (SELECT b.id FROM tenant_settlements s JOIN tenant_bills b ON b.tenant_id = s.tenant_id AND b.month_key = s.month_key
                  WHERE s.tenant_id = l.tenant_id AND s.month_key = l.month_key AND s.at = l.at) END
FROM _m0043_tenant_lines l;
DROP TABLE _m0043_tenant_lines;
CREATE INDEX idx_tenant_lines ON tenant_lines(tenant_id, month_key) WHERE status='active';
CREATE UNIQUE INDEX idx_tenant_lines_client ON tenant_lines(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_tenant_lines_bill ON tenant_lines(bill_id) WHERE bill_id IS NOT NULL;
CREATE UNIQUE INDEX idx_tenant_lines_bill_active ON tenant_lines(bill_id) WHERE kind='bill' AND status='active';
-- Sổ người thuê chỉ được đổi status active -> void; không sửa, không xoá.
CREATE TRIGGER trg_tenant_lines_append_only BEFORE UPDATE ON tenant_lines
WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.month_key IS NOT OLD.month_key
  OR NEW.at IS NOT OLD.at OR NEW.kind IS NOT OLD.kind OR NEW.name IS NOT OLD.name OR NEW.amount IS NOT OLD.amount
  OR NEW.category_id IS NOT OLD.category_id OR NEW.client_id IS NOT OLD.client_id OR NEW.bill_id IS NOT OLD.bill_id
  OR NOT (OLD.status = 'active' AND NEW.status = 'void')
BEGIN
  SELECT RAISE(ABORT, 'tenant_line_append_only');
END;
CREATE TRIGGER trg_tenant_lines_no_delete BEFORE DELETE ON tenant_lines
BEGIN
  SELECT RAISE(ABORT, 'tenant_line_append_only');
END;
-- Số dư phải thu = Σ dòng sổ − Σ tiền người thuê đã trả (income gắn tenant_id). Dương = còn nợ. Công thức như 0040.
CREATE VIEW v_tenant_balance AS
  SELECT t.id AS tenant_id, t.name, t.active,
         COALESCE((SELECT SUM(l.amount) FROM tenant_lines l WHERE l.tenant_id = t.id AND l.status = 'active'), 0)
       - COALESCE((SELECT SUM(x.amount) FROM transactions x
                   WHERE x.tenant_id = t.id AND x.meaning = 'income' AND x.status = 'active'), 0) AS balance
  FROM tenants t;

-- Bước 4: bản nháp của tháng gần nhất chưa chốt cho người thuê đang ở có phí đang thu: tháng liền sau tháng chốt gần nhất;
-- chưa chốt lần nào → tháng trước của tháng chạy migration (giờ VN), không sớm hơn tháng thêm người thuê; sau tháng hiện tại
-- → bỏ qua. Khoản = phí đang thu (Chi phí cứng, theo sort).
CREATE TABLE _m0043_next AS
SELECT t.id AS tenant_id,
       CASE WHEN (SELECT MAX(s.month_key) FROM tenant_settlements s WHERE s.tenant_id = t.id) IS NOT NULL
            THEN strftime('%Y-%m', (SELECT MAX(s.month_key) FROM tenant_settlements s WHERE s.tenant_id = t.id) || '-01', '+1 month')
            ELSE MAX(strftime('%Y-%m', datetime('now', '+7 hours'), 'start of month', '-1 month'),
                     strftime('%Y-%m', datetime(t.created_at, '+7 hours')))
       END AS month_key
FROM tenants t
WHERE t.active = 1 AND EXISTS (SELECT 1 FROM tenant_fixed_fees f WHERE f.tenant_id = t.id AND f.active = 1);
INSERT INTO tenant_bills (tenant_id, month_key, status, total, revision)
SELECT n.tenant_id, n.month_key, 'draft', (SELECT SUM(f.amount) FROM tenant_fixed_fees f WHERE f.tenant_id = n.tenant_id AND f.active = 1), 0
FROM _m0043_next n
WHERE n.month_key <= strftime('%Y-%m', datetime('now', '+7 hours'))
  AND NOT EXISTS (SELECT 1 FROM tenant_bills b WHERE b.tenant_id = n.tenant_id AND b.month_key = n.month_key);
DROP TABLE _m0043_next;

-- Bước 5: khoản của bản tính. Tên rỗng → nhãn theo loại; cắt 60 ký tự; tên trùng trong một bản thêm " (2)", " (3)"… sau khi
-- cắt tên còn 60 − độ dài hậu tố.
CREATE TABLE _m0043_items (bill_id INTEGER, ord INTEGER, name TEXT, category TEXT, amount INTEGER);
INSERT INTO _m0043_items (bill_id, ord, name, category, amount)
SELECT l.bill_id, ROW_NUMBER() OVER (PARTITION BY l.bill_id ORDER BY l.id),
       trim(substr(COALESCE(NULLIF(trim(l.name), ''), CASE l.kind WHEN 'fixed' THEN 'Phí cố định' WHEN 'shared' THEN 'Chi chung' ELSE 'Điều chỉnh' END), 1, 60)),
       CASE l.kind WHEN 'fixed' THEN 'fixed' ELSE 'variable' END, l.amount
FROM tenant_lines l
WHERE l.bill_id IS NOT NULL;
INSERT INTO _m0043_items (bill_id, ord, name, category, amount)
SELECT b.id, ROW_NUMBER() OVER (PARTITION BY b.id ORDER BY f.sort, f.id),
       trim(substr(COALESCE(NULLIF(trim(f.name), ''), 'Phí cố định'), 1, 60)), 'fixed', f.amount
FROM tenant_bills b JOIN tenant_fixed_fees f ON f.tenant_id = b.tenant_id AND f.active = 1
WHERE b.status = 'draft';
INSERT INTO tenant_bill_items (bill_id, sort, name, category, amount)
SELECT bill_id, ord,
       CASE WHEN n = 1 THEN name ELSE rtrim(substr(name, 1, 60 - length(' (' || n || ')'))) || ' (' || n || ')' END,
       category, amount
FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY bill_id, lower(name) ORDER BY ord) AS n FROM _m0043_items)
ORDER BY bill_id, ord;
DROP TABLE _m0043_items;

-- Bước 6: bỏ mô hình cũ.
DROP TABLE tenant_fixed_fees;
DROP TABLE tenant_settlements;
DELETE FROM config WHERE k IN ('rental_headcount', 'rental_shared_categories');
UPDATE config SET v = '1.43' WHERE k = 'schema_version';
