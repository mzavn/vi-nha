// Hộ mẫu của change 261112-muc-tieu-chung-tai-khoan (dữ liệu giả): nhiều mục tiêu Dự phòng dùng chung một tài khoản.
// Dựng trên DB seed (docs/schema.sql + docs/seed.sql), tắt ba mục tiêu mẫu của seed. Ngăn Dự phòng:
//   tk-chung "VCB chung" 9.000.000 — Hoá đơn (lặp 2.000.000 × 1, hạn 20/11/2026), Bảo dưỡng xe (B 4.800.000, hạn 31/03/2027),
//                                    Hiếu hỉ (B 3.000.000, không hạn)
//   tk-tiet-kiem "MB tiết kiệm" 12.000.000 — Nhà ở (lặp 7.500.000 × 1, hạn 05/12/2026), Học tập (B 6.000.000, hạn 15/01/2027)
//   tk-thue "TK thuế" 1.500.000 — Thuế 10% · phao 5.000.000 không mục tiêu · tk-moi 0 chưa có mục tiêu · MB (Ví Thưởng) 0.
// Thứ tự ưu tiên: Hoá đơn 10, Nhà ở 20, Học tập 30, Bảo dưỡng xe 40, Hiếu hỉ 50, Thuế 60. Kỳ lương lưu mở 10/11/2026 08:00
// (lương 20.000.000 vào tài khoản chính). `linked: false` → Học tập chưa gắn tài khoản (UC-1209 AC-8 trước khi gắn).
import type { DatabaseSync } from "node:sqlite";
import { monthKey, weekKey } from "../../src/domain/period";
import { openDb } from "./d1-sqlite";

/** 12/11/2026 10:00 giờ VN. */
export const SHARED_NOW = new Date("2026-11-12T03:00:00Z");

/** Thời điểm giờ VN "YYYY-MM-DD HH:mm" → ISO UTC như cột `at`. */
export const vnAt = (s: string) => new Date(`${s.replace(" ", "T")}:00+07:00`).toISOString();

/** Ghi thẳng một giao dịch (quy ước dấu: `from` = tiền ra, `to` = tiền vào). */
export function sharedTx(
  raw: DatabaseSync,
  t: { at: string; meaning: "spend" | "refund" | "transfer" | "income"; amount: number; from?: string; to?: string; goal?: string; link?: number; category?: string },
): number {
  const at = vnAt(t.at);
  const r = raw
    .prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, category_id, week_key, month_key, source, goal_id, link_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    )
    .run(at, t.amount, t.meaning, t.from ?? null, t.to ?? null, t.meaning === "spend" ? (t.category ?? "groceries") : null, weekKey(at), monthKey(at), t.goal ?? null, t.link ?? null);
  return Number(r.lastInsertRowid);
}

export function householdShared({ linked = true, cycle = true }: { linked?: boolean; cycle?: boolean } = {}): DatabaseSync {
  const raw = openDb();
  raw.exec(`
    UPDATE reserve_goals SET active = 0;
    UPDATE accounts SET opening_balance = 3000000, pocket = 'operating' WHERE id = 'vcb-husband';
    INSERT INTO accounts (id, name, kind, bank, account_no, opening_balance, pocket, pocket_confirmed) VALUES
      ('tk-tiet-kiem', 'MB tiết kiệm', 'bank', 'MBBank', '09990000001', 12000000, 'reserve', 1),
      ('tk-chung', 'VCB chung', 'bank', 'Vietcombank', '09990000002', 9000000, 'reserve', 1),
      ('tk-thue', 'TK thuế', 'bank', 'MBBank', '09990000003', 1500000, 'reserve', 1),
      ('tk-moi', 'TK mới', 'bank', 'MBBank', '09990000004', 0, 'reserve', 1),
      ('phao', 'Phao', 'bank', 'MBBank', '09990000005', 5000000, 'reserve', 1);
    INSERT INTO reserve_goals (id, name, account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date, sort) VALUES
      ('hoa-don', 'Hoá đơn', 'tk-chung', 2000000, NULL, 2000000, 1, '2026-11-20', 10),
      ('nha-o', 'Nhà ở', 'tk-tiet-kiem', 7500000, NULL, 7500000, 1, '2026-12-05', 20),
      ('hoc-tap', 'Học tập', ${linked ? "'tk-tiet-kiem'" : "NULL"}, 6000000, NULL, NULL, NULL, '2027-01-15', 30),
      ('bao-duong-xe', 'Bảo dưỡng xe', 'tk-chung', 4800000, NULL, NULL, NULL, '2027-03-31', 40),
      ('hieu-hi', 'Hiếu hỉ', 'tk-chung', 3000000, NULL, NULL, NULL, NULL, 50),
      ('thue', 'Thuế', 'tk-thue', NULL, 10, NULL, NULL, NULL, 60);
  `);
  if (cycle) {
    const income = sharedTx(raw, { at: "2026-11-10 08:00", meaning: "income", amount: 20_000_000, to: "vcb-husband" });
    raw.prepare("UPDATE transactions SET is_salary = 1 WHERE id = ?").run(income);
  }
  return raw;
}
