-- 0047 — Mã việc trong nội dung chuyển khoản (change 261112-ma-viec-chuyen-khoan, pocket UC-1206 AC-20, ingest UC-303 AC-33).
-- Schema 1.47. Không xoá, không sửa dòng nào.

-- Mã 4 ký tự (chữ hoa / số, bỏ 0 O 1 I) là cột sinh từ id: (id × 742297) mod 2^20 là song ánh nên mọi việc có mã khác nhau,
-- việc đang mở trên D1 có mã ngay khi áp migration, việc mới có mã cùng lúc INSERT — không sinh ngẫu nhiên, không đua giữa
-- hai máy. Cùng công thức với `taskCode` ở src/domain/month-tasks.ts.
ALTER TABLE month_tasks ADD COLUMN code TEXT GENERATED ALWAYS AS (
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (((id * 742297) % 1048576) >> 15 & 31) + 1, 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (((id * 742297) % 1048576) >> 10 & 31) + 1, 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (((id * 742297) % 1048576) >> 5 & 31) + 1, 1) ||
  substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (((id * 742297) % 1048576) & 31) + 1, 1)
) VIRTUAL;
CREATE INDEX idx_month_tasks_code ON month_tasks(code);

-- Liên kết ghép theo mã: tính cả khi chuyển khoản dưới ngưỡng tự nhận 100.000 (`AUTO_MATCH_MIN`).
ALTER TABLE month_task_tx ADD COLUMN by_code INTEGER NOT NULL DEFAULT 0 CHECK (by_code IN (0,1));

UPDATE config SET v = '1.47' WHERE k = 'schema_version';
