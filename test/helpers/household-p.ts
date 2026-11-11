// Hộ mẫu P của change 261112-bao-mat-v2 (audit bảo mật v2): docs/schema.sql + docs/seed.sql, thêm
//   `vcb-wife`, `cash-wife` riêng tư của vợ (mọi tài khoản khác công khai);
//   #101 chi 200.000 từ `cash-wife` (Quà biếu, "quà sinh nhật", vợ ghi) · #102 chuyển 1.000.000 `cash-husband` → `cash-wife` ·
//   #103 chi 150.000 sinh từ log L3 (−150.000, `vcb-wife`), vợ đã gán · #104 hoàn 50.000 vào `cash-husband`, link 101 ·
//   #105 chi 300.000 từ `cash-husband`; #106 hoàn 100.000 vào `cash-wife`, link 105 · #107 chi 80.000 từ `cash-husband` (chồng) ·
//   #108 trả nợ 400.000 từ `cash-wife` cho "Vay anh Ba" · #109 cho vay 300.000 từ `cash-wife` cho "Em Hai".
//   Log chờ: L1 +3.000.000 `vcb-wife`; L2 −3.000.000 `vcb-husband` (cùng ngày L1); L4 +50.000 `vcb-husband`; L5 −120.000 `vcb-wife`.
// Đồng hồ test nên ghim sau 2026-11-12 (vd 2026-11-12T09:00+07:00).
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "./d1-sqlite";

export { client } from "./household-c";

export const P_NOW = new Date("2026-11-12T09:00:00+07:00");

export function householdP(): DatabaseSync {
  const db = openDb();
  db.exec(`
    UPDATE accounts SET private = 1 WHERE id IN ('vcb-wife', 'cash-wife');
    INSERT INTO debts (id, name) VALUES ('vay-anh-ba', 'Vay anh Ba');
    INSERT INTO debt_lines (debt_id, at, kind, amount) VALUES ('vay-anh-ba', '2026-11-01T03:00:00.000Z', 'opening', 2000000);
    INSERT INTO receivables (id, name) VALUES ('em-hai', 'Em Hai');
    INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES
      ('L1', '2026-11-11T02:00:00.000Z', 3000000, 'in', 'vcb-wife', 'CK den', 'pending'),
      ('L2', '2026-11-11T02:05:00.000Z', 3000000, 'out', 'vcb-husband', 'CK di', 'pending'),
      ('L3', '2026-11-10T05:00:00.000Z', 150000, 'out', 'vcb-wife', 'SIEU THI', 'pending'),
      ('L4', '2026-11-11T04:00:00.000Z', 50000, 'in', 'vcb-husband', 'HOAN TIEN', 'pending'),
      ('L5', '2026-11-11T06:00:00.000Z', 120000, 'out', 'vcb-wife', 'GRAB', 'pending');
    INSERT INTO transactions (id, log_id, at, amount, meaning, account_id, counter_account_id, category_id, by_member_id, link_id, debt_id, receivable_id, note, week_key, month_key, source) VALUES
      (101, NULL, '2026-11-10T03:00:00.000Z', 200000, 'spend', 'cash-wife', NULL, 'gifts', 'wife', NULL, NULL, NULL, 'quà sinh nhật', '2026-W46', '2026-11', 'manual'),
      (102, NULL, '2026-11-10T04:00:00.000Z', 1000000, 'transfer', 'cash-husband', 'cash-wife', NULL, 'husband', NULL, NULL, NULL, NULL, '2026-W46', '2026-11', 'manual'),
      (103, 'L3', '2026-11-10T05:00:00.000Z', 150000, 'spend', 'vcb-wife', NULL, 'groceries', 'wife', NULL, NULL, NULL, NULL, '2026-W46', '2026-11', 'sepay'),
      (104, NULL, '2026-11-10T06:00:00.000Z', 50000, 'refund', NULL, 'cash-husband', 'gifts', 'husband', 101, NULL, NULL, NULL, '2026-W46', '2026-11', 'manual'),
      (105, NULL, '2026-11-10T07:00:00.000Z', 300000, 'spend', 'cash-husband', NULL, 'shopping', 'husband', NULL, NULL, NULL, NULL, '2026-W46', '2026-11', 'manual'),
      (106, NULL, '2026-11-10T08:00:00.000Z', 100000, 'refund', NULL, 'cash-wife', 'shopping', 'wife', 105, NULL, NULL, NULL, '2026-W46', '2026-11', 'manual'),
      (107, NULL, '2026-11-10T09:00:00.000Z', 80000, 'spend', 'cash-husband', NULL, 'eating-out', 'husband', NULL, NULL, NULL, NULL, '2026-W46', '2026-11', 'manual'),
      (108, NULL, '2026-11-10T10:00:00.000Z', 400000, 'spend', 'cash-wife', NULL, 'debt-payment', 'wife', NULL, 'vay-anh-ba', NULL, NULL, '2026-W46', '2026-11', 'manual'),
      (109, NULL, '2026-11-10T11:00:00.000Z', 300000, 'lend', 'cash-wife', NULL, NULL, 'wife', NULL, NULL, 'em-hai', NULL, '2026-W46', '2026-11', 'manual');
    UPDATE bank_logs SET status = 'assigned' WHERE id = 'L3';
  `);
  return db;
}
