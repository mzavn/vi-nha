// Hộ mẫu E (change 261112-ba-ngan-chuyen-doi): nhà đang ở v1.x, có ví, lần chia, khoản cũ trừ ví; lên v2 qua 0039 + 0040.
// Dựng trên hộ mẫu cũ test/helpers/legacy-household.sql (baseline → 0038), đổi tài khoản / mục tiêu cho đúng số của proposal:
//   tài khoản chính 3.000.000 (Vận hành) · thẻ tín dụng −800.000 (Vận hành) · tài khoản tích luỹ 6.000.000 (Tích luỹ) ·
//   tài khoản tiết kiệm 10.000.000 (Dự phòng, đề xuất cho Học phí) · tài khoản dự phòng 4.000.000 (Dự phòng, Ví Thưởng) ·
//   phao 5.000.000 (Dự phòng) · ví điện tử 200.000 (ngoài ngăn, đã xác nhận) → 6 tài khoản chưa xác nhận.
// Mục tiêu: Học phí 2.000.000/tháng (chưa gắn, đề xuất tài khoản tiết kiệm), Hoá đơn 1.300.000/tháng, Thuế 10%.
// Ví Tích sản cũ: 9.000.000, trong đó 2.000.000 đã mua tài sản → tiền 7.000.000.
// Khoản cũ: chi 150.000 Ăn uống (ví Ăn uống, phe Must), chi 400.000 (ví Có thì tốt), chi 1.000.000 nộp thuế (ví Thuế),
// thu 20.000.000 đã chia (Tích sản 2.000.000, Thuế 1.000.000…), lần chia Tích sản 0 lý do "Tháng này trả viện phí".
import type { DatabaseSync } from "node:sqlite";
import { openLegacyDb, openPre0040Db } from "./legacy";

/** Id các khoản cũ để test tra lại. */
export const E_TX = { spendFood: 950, spendFlex: 951, spendTax: 952, income: 900, skippedIncome: 901 } as const;

export const E_ACCOUNTS = {
  main: "vcb-anh",
  credit: "tien-mat-em",
  savings: "tcb-anh",
  deposit: "mb-anh",
  reserve: "vcb-em",
  buffer: "tien-mat-anh",
  ewallet: "vi-dien-tu",
} as const;

function seed(db: DatabaseSync) {
  db.exec(`
    UPDATE accounts SET sepay_enabled = 0, sepay_out = 0, opened_at = NULL, pocket_confirmed = 0;
    UPDATE accounts SET name = 'Tài khoản chính', opening_balance = -33450000, pocket = 'operating' WHERE id = 'vcb-anh';
    UPDATE accounts SET name = 'Thẻ tín dụng', kind = 'credit', opening_balance = -800000, pocket = 'operating' WHERE id = 'tien-mat-em';
    UPDATE accounts SET name = 'Tài khoản tích luỹ', opening_balance = 6000000, pocket = 'savings' WHERE id = 'tcb-anh';
    UPDATE accounts SET name = 'Tài khoản tiết kiệm', opening_balance = 10000000, pocket = 'reserve' WHERE id = 'mb-anh';
    UPDATE accounts SET name = 'Tài khoản dự phòng', opening_balance = 4000000, pocket = 'reserve' WHERE id = 'vcb-em';
    UPDATE accounts SET name = 'Phao', opening_balance = 5000000, pocket = 'reserve' WHERE id = 'tien-mat-anh';
    INSERT INTO accounts (id, name, kind, owner_member_id, opening_balance, pocket, pocket_confirmed)
      VALUES ('vi-dien-tu', 'Ví điện tử', 'ewallet', 'anh', 200000, NULL, 1);

    DELETE FROM reserve_goals;
    INSERT INTO reserve_goals (id, name, suggested_account_id, target_amount, monthly_amount, repeat_months, sort) VALUES
      ('hoc-phi', 'Học phí', 'mb-anh', 2000000, 2000000, 1, 10),
      ('hoa-don', 'Hoá đơn', NULL, 1300000, 1300000, 1, 20);
    INSERT INTO reserve_goals (id, name, target_pct, sort) VALUES ('thue', 'Thuế', 10, 30);

    INSERT INTO transactions (id, at, amount, meaning, wallet_id, counter_account_id, income_stream_id, week_key, month_key, source) VALUES
      (899, '2026-10-10T01:00:00.000Z', 15000000, 'income', 'thu-nhap', 'vcb-anh', 'luong-chong', '2026-W41', '2026-10', 'manual'),
      (900, '2026-11-10T01:00:00.000Z', 20000000, 'income', 'thu-nhap', 'vcb-anh', 'luong-chong', '2026-W46', '2026-11', 'manual'),
      (901, '2026-11-20T01:00:00.000Z', 5000000, 'income', 'thu-nhap', 'vcb-anh', 'luong-vo', '2026-W47', '2026-11', 'manual');
    INSERT INTO allocation_runs (income_tx_id, batch_id, wealth_note) VALUES (899, 'A899', NULL), (900, 'A900', NULL), (901, 'A901', 'Tháng này trả viện phí');
    INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, link_id, batch_id, week_key, month_key, source) VALUES
      ('2026-10-10T01:00:00.000Z', 7000000, 'fund', 'tich-san', 'thu-nhap', 899, 'A899', '2026-W41', '2026-10', 'system'),
      ('2026-11-10T01:00:00.000Z', 2000000, 'fund', 'tich-san', 'thu-nhap', 900, 'A900', '2026-W46', '2026-11', 'system'),
      ('2026-11-10T01:00:00.000Z', 1000000, 'fund', 'thue', 'thu-nhap', 900, 'A900', '2026-W46', '2026-11', 'system'),
      ('2026-11-10T01:00:00.000Z', 3000000, 'fund', 'an', 'thu-nhap', 900, 'A900', '2026-W46', '2026-11', 'system'),
      ('2026-11-10T01:00:00.000Z', 1000000, 'fund', 'co-thi-tot', 'thu-nhap', 900, 'A900', '2026-W46', '2026-11', 'system'),
      ('2026-11-20T01:00:00.000Z', 5000000, 'fund', 'an', 'thu-nhap', 901, 'A901', '2026-W47', '2026-11', 'system');
    INSERT INTO transactions (at, amount, meaning, wallet_id, account_id, asset_kind, week_key, month_key, source)
      VALUES ('2026-11-15T03:00:00.000Z', 2000000, 'buy_asset', 'tich-san', 'vcb-anh', 'gold', '2026-W46', '2026-11', 'manual');
    INSERT INTO transactions (id, at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key, source) VALUES
      (950, '2026-11-12T03:00:00.000Z', 150000, 'spend', 'an', 'vcb-anh', 'cho-nau', '2026-W46', '2026-11', 'manual'),
      (951, '2026-11-13T03:00:00.000Z', 400000, 'spend', 'co-thi-tot', 'vcb-anh', 'thiet-bi', '2026-W46', '2026-11', 'manual'),
      (952, '2026-11-14T03:00:00.000Z', 1000000, 'spend', 'thue', 'vcb-anh', 'qua-bieu', '2026-W46', '2026-11', 'manual');
  `);
}

/** Sau 0039: Ví Thưởng = tài khoản dự phòng, `savings_pct` 10, "Lương chồng" mở kỳ lương. */
function after0039(db: DatabaseSync) {
  db.exec(`
    INSERT INTO config (k, v) VALUES ('surplus_reward_account', 'vcb-em'), ('savings_pct', '10')
      ON CONFLICT (k) DO UPDATE SET v = excluded.v;
    UPDATE income_streams SET opens_cycle = CASE id WHEN 'luong-chong' THEN 1 ELSE 0 END;
  `);
}

/** Hộ mẫu E đã lên 1.40 (0039 + 0040). */
export function householdE(): DatabaseSync {
  const db = openLegacyDb(seed);
  after0039(db);
  return db;
}

/** Hộ mẫu E dừng ở 1.39 (đã áp 0039, chưa 0040). */
export function householdEPre0040(): DatabaseSync {
  const db = openPre0040Db(seed);
  after0039(db);
  return db;
}
