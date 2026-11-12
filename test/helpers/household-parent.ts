// Hộ mẫu của change 261112-tai-khoan-me-va-quy-chi-chung (dữ liệu giả): tài khoản mẹ có khoản gửi kỳ hạn là tài khoản con,
// và các mục tiêu trả thẳng từ tiền chi tiêu (ngăn Vận hành). Dựng trên DB seed, tắt mục tiêu mẫu, đưa tài khoản mẫu ra ngoài
// ngăn (trừ "Tiền mặt (chồng)" ở Vận hành). Hôm nay 20/11/2026 10:00 VN — còn 20 ngày tới ngày lương 10/12.
//   Vận hành: tk-chi-tieu-chong "Chi tiêu chồng", tk-chi-tieu-vo "Chi tiêu vợ", cash-husband — tổng `operating` (mặc định 15.000.000)
//   Dự phòng: tk-tiet-kiem "MB tiết kiệm" 5.000.000 + con gui-6-thang "Gửi 6 tháng" 100.000.000 — Nhà ở (B 60.000.000),
//             Học tập (B 30.000.000), Tập luyện (B 10.000.000) theo thứ tự đó; phao "Phao" 5.000.000; tk-bidv "BIDV" 0 (Ví Thưởng)
//   `operatingGoals`: Điện nước 2.000.000, Thuốc 500.000, Thiện phước 1.000.000, Về quê 1.000.000 mỗi tháng, trả từ tiền chi tiêu.
// Kỳ lương lưu mở 10/11/2026 08:00 bằng khoản thu vào tk-chi-tieu-chong.
import type { DatabaseSync } from "node:sqlite";
import { monthKey, weekKey } from "../../src/domain/period";
import { openDb } from "./d1-sqlite";

/** Thời điểm giờ VN "YYYY-MM-DD HH:mm" → ISO UTC như cột `at`. */
export const vnAt = (s: string) => new Date(`${s.replace(" ", "T")}:00+07:00`).toISOString();

/** 20/11/2026 10:00 giờ VN. */
export const PARENT_NOW = new Date(vnAt("2026-11-20 10:00"));

/** Ghi thẳng một giao dịch (quy ước dấu: `from` = tiền ra, `to` = tiền vào); `interest` → dòng phân loại `passive_income`. */
export function parentTx(
  raw: DatabaseSync,
  t: { at: string; meaning: "spend" | "transfer" | "income"; amount: number; from?: string; to?: string; goal?: string; interest?: boolean; fromInterest?: boolean },
): number {
  const at = vnAt(t.at);
  const r = raw
    .prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, category_id, week_key, month_key, source, goal_id, from_interest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    )
    .run(at, t.amount, t.meaning, t.from ?? null, t.to ?? null, t.meaning === "spend" ? "groceries" : null, weekKey(at), monthKey(at), t.goal ?? null, t.fromInterest ? 1 : 0);
  const id = Number(r.lastInsertRowid);
  if (t.interest) raw.prepare("INSERT INTO transaction_report_classes (transaction_id, report_class) VALUES (?, 'passive_income')").run(id);
  return id;
}

export function householdParent({ operating = 15_000_000, operatingGoals = false }: { operating?: number; operatingGoals?: boolean } = {}): DatabaseSync {
  const raw = openDb();
  const salary = Math.min(10_000_000, operating);
  raw.exec(`
    UPDATE reserve_goals SET active = 0;
    UPDATE accounts SET pocket = NULL WHERE id <> 'cash-husband';
    INSERT INTO accounts (id, name, kind, bank, account_no, opening_balance, pocket, pocket_confirmed) VALUES
      ('tk-chi-tieu-chong', 'Chi tiêu chồng', 'bank', 'Vietcombank', '01010000001', 0, 'operating', 1),
      ('tk-chi-tieu-vo', 'Chi tiêu vợ', 'bank', 'Techcombank', '01010000002', ${operating - salary}, 'operating', 1),
      ('tk-tiet-kiem', 'MB tiết kiệm', 'bank', 'MBBank', '01010000003', 5000000, 'reserve', 1),
      ('phao', 'Phao', 'bank', 'MBBank', '01010000004', 5000000, 'reserve', 1),
      ('tk-bidv', 'BIDV', 'bank', 'BIDV', '01010000005', 0, 'reserve', 1);
    INSERT INTO accounts (id, name, kind, bank, opening_balance, pocket, pocket_confirmed, parent_account_id) VALUES
      ('gui-6-thang', 'Gửi 6 tháng', 'bank', 'MBBank', 100000000, 'reserve', 1, 'tk-tiet-kiem');
    UPDATE config SET v = 'tk-bidv' WHERE k = 'surplus_reward_account';
    INSERT INTO reserve_goals (id, name, account_id, target_amount, sort) VALUES
      ('nha-o', 'Nhà ở', 'tk-tiet-kiem', 60000000, 10),
      ('hoc-tap', 'Học tập', 'tk-tiet-kiem', 30000000, 20),
      ('tap-luyen', 'Tập luyện', 'tk-tiet-kiem', 10000000, 30);
  `);
  if (operatingGoals) {
    raw.exec(`
      INSERT INTO reserve_goals (id, name, account_id, target_amount, monthly_amount, repeat_months, pays_from, sort) VALUES
        ('dien-nuoc', 'Điện nước', NULL, 2000000, 2000000, 1, 'operating', 40),
        ('thuoc', 'Thuốc', NULL, 500000, 500000, 1, 'operating', 50),
        ('thien-phuoc', 'Thiện phước', NULL, 1000000, 1000000, 1, 'operating', 60),
        ('ve-que', 'Về quê', NULL, 1000000, 1000000, 1, 'operating', 70);
    `);
  }
  const income = parentTx(raw, { at: "2026-11-10 08:00", meaning: "income", amount: salary, to: "tk-chi-tieu-chong" });
  raw.prepare("INSERT INTO pay_cycles (income_tx_id, started_at, payday, prev_operating) VALUES (?, ?, '2026-11-10', 0)").run(income, vnAt("2026-11-10 08:00"));
  return raw;
}

/**
 * Ca nhắc chuyển thêm (ledger UC-103 AC-25): Vận hành 1.000.000 sau khi chi 1.000.000 cho Điện nước (R 3.500.000); BIDV (Ví
 * Thưởng) 2.000.000; Phao 4.000.000 có con "Gửi 3 tháng" 20.000.000; TCB tích luỹ 50.000.000; ④ → Ví Thưởng 600.000 đang mở.
 * `history`: kỳ trọn 10/10–9/11 (31 ngày) chi Vận hành 13.950.000 → 13.500.000 / tháng (dữ liệu Vận hành có từ 25/9);
 * không có → chưa đủ một kỳ dữ liệu (nhắc chuyển thêm không đọc chi trung bình — hai ca cùng kết quả).
 */
export function householdTopUp({ history }: { history: boolean }): DatabaseSync {
  const raw = householdParent({ operating: 2_000_000, operatingGoals: true });
  raw.exec(`
    UPDATE accounts SET opening_balance = 2000000 WHERE id = 'tk-bidv';
    UPDATE accounts SET opening_balance = 4000000 WHERE id = 'phao';
    INSERT INTO accounts (id, name, kind, bank, opening_balance, pocket, pocket_confirmed, parent_account_id) VALUES
      ('gui-3-thang', 'Gửi 3 tháng', 'bank', 'MBBank', 20000000, 'reserve', 1, 'phao');
    INSERT INTO accounts (id, name, kind, bank, account_no, opening_balance, pocket, pocket_confirmed) VALUES
      ('tk-tich-luy', 'TCB tích luỹ', 'bank', 'Techcombank', '01010000009', 50000000, 'savings', 1);
    INSERT INTO pay_cycle_tasks (cycle_id, kind, to_account_id, suggested, amount) VALUES (1, 'surplus', 'tk-bidv', 600000, 600000);
  `);
  parentTx(raw, { at: "2026-11-15 09:00", meaning: "spend", amount: 1_000_000, from: "tk-chi-tieu-vo", goal: "dien-nuoc" });
  if (history) {
    raw.exec("UPDATE accounts SET opening_balance = opening_balance + 13950000 WHERE id = 'tk-chi-tieu-vo'");
    parentTx(raw, { at: "2026-09-25 09:00", meaning: "transfer", amount: 1, from: "tk-chi-tieu-vo", to: "tk-chi-tieu-chong" });
    parentTx(raw, { at: "2026-10-15 09:00", meaning: "spend", amount: 13_950_000, from: "tk-chi-tieu-vo" });
  }
  return raw;
}
