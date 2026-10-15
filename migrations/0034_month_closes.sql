-- v1.33 -> v1.34 (Chốt tháng bù chi lố trước + Có / Không Tích sản khi chia — change 261015-chot-thang-va-keo-tich-san):
--  * month_closes: mỗi tháng đã chốt một dòng (khoá chính là tháng) — người chốt, lúc nào, % phần dư vào Tích sản.
--    Chặn chốt hai lần (UC-207). Điền sẵn từ các lô chốt cũ do cron ghi (batch_id 'S' + YYYYMM, source 'system'):
--    tháng đó coi như đã chốt, 100% vào Tích sản, không rõ người chốt.
--  * allocation_runs.wealth_note: lý do lần chia không trả cho mình (Tích sản 0, ADR-112); NULL khi có Tích sản.
--  * Không chèn khoá config month_close_*: chưa đặt thì code đọc mặc định (50%, chưa có Ví Thưởng → 100%).

ALTER TABLE allocation_runs ADD COLUMN wealth_note TEXT CHECK (wealth_note IS NULL OR length(wealth_note) BETWEEN 1 AND 500);

CREATE TABLE month_closes (
  month        TEXT PRIMARY KEY CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  closed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  by_member_id TEXT REFERENCES members(id),
  wealth_pct   INTEGER NOT NULL CHECK (wealth_pct BETWEEN 0 AND 100)
);

INSERT INTO month_closes (month, closed_at, by_member_id, wealth_pct)
SELECT substr(batch_id, 2, 4) || '-' || substr(batch_id, 6, 2), MIN(created_at), NULL, 100
FROM transactions
WHERE batch_id GLOB 'S[0-9][0-9][0-9][0-9][0-9][0-9]' AND source = 'system'
GROUP BY batch_id;

UPDATE config SET v = '1.34' WHERE k = 'schema_version';
