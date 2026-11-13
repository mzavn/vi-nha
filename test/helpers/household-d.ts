// Hộ mẫu D của change 261112-ba-ngan-nhin-lai (Đợt D): hộ mẫu C + hai kỳ lưu (10/10, 10/11), bốn nhóm danh mục có / không
// hạn mức, "Quà tặng" chưa xếp nhóm, sổ nợ "Vay tiêu dùng" 18%/năm (dư đầu tháng 11 20.000.000, ngày trả 5) và "Vay người
// nhà" 0%. Hôm nay 2026-11-25 (giờ VN). Chi kỳ 10/11: Ăn uống 2.500.000, Đi lại 450.000 (sau hoàn), Học phí 6.000.000 (chi từ
// tài khoản của mục tiêu Học phí), Mua sắm 1.200.000, Quà tặng 500.000 (ví điện tử), lãi 300.000 + gốc 2.000.000.
// Kỳ 10/10: Ăn uống 2.800.000, Đi lại 700.000, Mua sắm 600.000, lãi 300.000 (12/10).
import type { DatabaseSync } from "node:sqlite";
import { monthKey, weekKey } from "../../src/domain/period";
import { AT, householdC } from "./household-c";

/** 2026-11-25 10:00 giờ VN. */
export const D_NOW = new Date("2026-11-25T03:00:00Z");

type Spend = {
  at: string;
  amount: number;
  category: string | null;
  account?: string;
  meaning?: "spend" | "refund";
  linkId?: number;
  debtId?: string;
  interestDebtId?: string;
};

/** Ghi thẳng một khoản chi / hoàn (giờ VN "YYYY-MM-DDTHH:mm"). Chi trừ `account` (mặc định `main`), hoàn cộng vào `account`. */
export function spend(db: DatabaseSync, s: Spend): number {
  const at = AT(s.at);
  const refund = s.meaning === "refund";
  const r = db
    .prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, category_id, link_id, debt_id, interest_debt_id, week_key, month_key, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
    )
    .run(
      at,
      s.amount,
      refund ? "refund" : "spend",
      refund ? null : (s.account ?? "main"),
      refund ? (s.account ?? "main") : null,
      s.category,
      s.linkId ?? null,
      s.debtId ?? null,
      s.interestDebtId ?? null,
      weekKey(at),
      monthKey(at),
    );
  return Number(r.lastInsertRowid);
}

export function householdD(): DatabaseSync {
  const db = householdC();
  db.exec(`
    UPDATE transactions SET status = 'void' WHERE meaning = 'spend';
    UPDATE categories SET group_id = NULL;
    UPDATE category_groups SET active = 0;
    UPDATE categories SET name = 'Quà tặng' WHERE id = 'gifts';
    INSERT INTO categories (id, name, icon, sort) VALUES ('school-fees', 'Học phí', 'book', 16);
    INSERT INTO category_groups (id, name, essential, monthly_limit, sort) VALUES
      ('d-food', 'Ăn uống', 1, 3000000, 1), ('d-transport', 'Đi lại', 1, 800000, 2),
      ('d-school', 'Học phí', 1, NULL, 3), ('d-shopping', 'Mua sắm', 0, 1000000, 4);
    UPDATE categories SET group_id = 'd-food' WHERE id IN ('groceries', 'eating-out');
    UPDATE categories SET group_id = 'd-transport' WHERE id IN ('fuel-parking', 'ride-hailing');
    UPDATE categories SET group_id = 'd-school' WHERE id = 'school-fees';
    UPDATE categories SET group_id = 'd-shopping' WHERE id = 'shopping';
    INSERT INTO debts (id, name, interest_rate_bps, term, due_day) VALUES
      ('vay-tieu-dung', 'Vay tiêu dùng', 1800, 'short', 5), ('vay-nguoi-nha', 'Vay người nhà', 0, 'short', NULL);
    INSERT INTO debt_lines (debt_id, at, kind, amount) VALUES
      ('vay-tieu-dung', '2026-09-01', 'opening', 20000000), ('vay-nguoi-nha', '2026-09-01', 'opening', 5000000);
    INSERT INTO transactions (id, at, amount, meaning, counter_account_id, income_stream_id, week_key, month_key, source)
      VALUES (20, '2026-11-10T01:00:00.000Z', 20000000, 'income', 'main', 'salary', '2026-W46', '2026-11', 'manual');
    UPDATE transactions SET is_salary = 1 WHERE id = 20;
  `);
  // Kỳ 2026-10-10.
  spend(db, { at: "2026-10-15T12:00", amount: 2_800_000, category: "groceries" });
  spend(db, { at: "2026-10-16T12:00", amount: 700_000, category: "fuel-parking" });
  spend(db, { at: "2026-10-18T12:00", amount: 600_000, category: "shopping" });
  spend(db, { at: "2026-10-12T09:00", amount: 300_000, category: "loan-interest", interestDebtId: "vay-tieu-dung" });
  // Kỳ 2026-11-10.
  spend(db, { at: "2026-11-11T09:00", amount: 1_800_000, category: "groceries" });
  spend(db, { at: "2026-11-13T19:00", amount: 700_000, category: "eating-out" });
  spend(db, { at: "2026-11-14T08:00", amount: 300_000, category: "fuel-parking" });
  const grab = spend(db, { at: "2026-11-15T21:00", amount: 200_000, category: "ride-hailing" });
  spend(db, { at: "2026-11-16T10:00", amount: 50_000, category: "ride-hailing", meaning: "refund", linkId: grab });
  spend(db, { at: "2026-11-17T09:00", amount: 6_000_000, category: "school-fees", account: "reserve" });
  spend(db, { at: "2026-11-18T20:00", amount: 1_200_000, category: "shopping" });
  spend(db, { at: "2026-11-19T12:00", amount: 500_000, category: "gifts", account: "ewallet" });
  spend(db, { at: "2026-11-12T09:00", amount: 300_000, category: "loan-interest", interestDebtId: "vay-tieu-dung" });
  spend(db, { at: "2026-11-12T09:00", amount: 2_000_000, category: "debt-payment", debtId: "vay-tieu-dung" });
  return db;
}
