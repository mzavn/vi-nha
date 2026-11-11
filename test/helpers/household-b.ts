// Hộ mẫu B của proposal 261112-ba-ngan-ba-the (Đợt B), mục tiêu là tài khoản thật (Đợt E, ADR-132): dựng trên DB seed. Hôm
// nay 11/11/2026 giờ VN, ngày lương 10. Vận hành 4.100.000 · Tích luỹ 6.500.000 (đầu kỳ 5.700.000, đầu kỳ trước 5.000.000) ·
// Dự phòng 38.000.000 (tài khoản tiết kiệm 31.500.000 = phần an tâm; bốn tài khoản mục tiêu Học phí 4.000.000, Bảo dưỡng
// xe 1.000.000, Thuế 500.000, Trả nợ 1.000.000) · ngoài ngăn 200.000 · chi vận hành ba kỳ trọn 9.000.000 / 10.500.000 /
// 10.500.000 · nợ ngắn hạn 8.000.000.
import type { DatabaseSync } from "node:sqlite";
import { monthKey, weekKey } from "../../src/domain/period";
import { openDb } from "./d1-sqlite";

/** 11/11/2026 10:00 giờ VN. */
export const B_NOW = new Date("2026-11-11T03:00:00Z");

/** Thời điểm giờ VN "YYYY-MM-DD HH:mm" → ISO UTC như cột `at`. */
export const vnAt = (s: string) => new Date(`${s.replace(" ", "T")}:00+07:00`).toISOString();

/** Ghi thẳng một giao dịch (quy ước dấu: `from` = tiền ra, `to` = tiền vào). */
export function tx(raw: DatabaseSync, t: { at: string; meaning: "spend" | "refund" | "transfer"; amount: number; from?: string; to?: string }): number {
  const at = vnAt(t.at);
  const r = raw
    .prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, category_id, week_key, month_key, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
    )
    .run(
      at,
      t.amount,
      t.meaning,
      t.from ?? null,
      t.to ?? null,
      t.meaning === "spend" ? "groceries" : null,
      weekKey(at),
      monthKey(at),
    );
  return Number(r.lastInsertRowid);
}

export function householdB(): DatabaseSync {
  const raw = openDb();
  raw.exec(`
    UPDATE reserve_goals SET active = 0;
    DELETE FROM config WHERE k = 'surplus_reward_account';
    UPDATE config SET v = '10' WHERE k = 'savings_pct';
    UPDATE accounts SET active = 0 WHERE id IN ('cash-husband', 'cash-wife', 'mb-tuition', 'mb-reward');
    UPDATE accounts SET name = 'tài khoản chính', pocket = 'operating', opening_balance = 33100000 WHERE id = 'vcb-husband';
    UPDATE accounts SET name = 'tài khoản chi tiêu', pocket = 'operating', opening_balance = 1400000 WHERE id = 'vcb-wife';
    UPDATE accounts SET name = 'tài khoản tích luỹ', pocket = 'savings', opening_balance = 4500000 WHERE id = 'tcb-husband';
    UPDATE accounts SET name = 'tài khoản tiết kiệm', pocket = 'reserve', opening_balance = 31500000 WHERE id = 'mb-husband';
    INSERT INTO accounts (id, name, kind, opening_balance, pocket, pocket_confirmed) VALUES
      ('card', 'thẻ tín dụng', 'credit', 1200000, 'operating', 1),
      ('piggy', 'heo đất', 'bank', 500000, 'savings', 1),
      ('momo', 'ví điện tử', 'ewallet', 200000, NULL, 1),
      ('b-tuition-acc', 'tài khoản học phí', 'bank', 4000000, 'reserve', 1),
      ('b-car-acc', 'tài khoản bảo dưỡng xe', 'bank', 1000000, 'reserve', 1),
      ('b-tax-acc', 'tài khoản thuế', 'bank', 500000, 'reserve', 1),
      ('b-repay-acc', 'tài khoản Trả nợ', 'bank', 1000000, 'reserve', 1);
    INSERT INTO debts (id, name, term, monthly_payment, due_day) VALUES
      ('family', 'Vay người thân', 'short', 1000000, 15), ('installment', 'Mua trả góp', 'short', NULL, NULL), ('mortgage', 'Vay mua nhà', 'long', NULL, NULL);
    INSERT INTO debt_lines (debt_id, at, kind, amount) VALUES
      ('family', '2026-07-01', 'opening', 5000000), ('installment', '2026-07-01', 'opening', 3000000), ('mortgage', '2026-07-01', 'opening', 50000000);
    INSERT INTO reserve_goals (id, name, account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date, debt_id, sort) VALUES
      ('b-tuition', 'Học phí', 'b-tuition-acc', 6000000, NULL, 2000000, 3, '2027-01-15', NULL, 10),
      ('b-car', 'Bảo dưỡng xe', 'b-car-acc', 4800000, NULL, NULL, NULL, '2027-03-31', NULL, 20),
      ('b-tax', 'Thuế', 'b-tax-acc', NULL, 10, NULL, NULL, NULL, NULL, 30),
      ('repay-family', 'Trả nợ Vay người thân', 'b-repay-acc', 1000000, NULL, 1000000, 1, '2026-11-15', 'family', 40);
  `);
  tx(raw, { at: "2026-07-01 09:00", meaning: "spend", amount: 100_000, from: "vcb-husband" }); // giao dịch sớm nhất
  tx(raw, { at: "2026-08-20 12:00", meaning: "spend", amount: 9_000_000, from: "vcb-husband" }); // kỳ 10/8–9/9
  tx(raw, { at: "2026-09-20 12:00", meaning: "spend", amount: 9_000_000, from: "vcb-husband" }); // kỳ 10/9–9/10
  tx(raw, { at: "2026-09-25 12:00", meaning: "spend", amount: 1_500_000, from: "card" });
  tx(raw, { at: "2026-10-20 12:00", meaning: "spend", amount: 10_500_000, from: "vcb-husband" }); // kỳ 10/10–9/11
  tx(raw, { at: "2026-10-15 12:00", meaning: "transfer", amount: 700_000, from: "vcb-husband", to: "tcb-husband" });
  tx(raw, { at: "2026-11-10 12:00", meaning: "transfer", amount: 800_000, from: "vcb-husband", to: "tcb-husband" });
  return raw;
}
