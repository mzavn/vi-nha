// Hộ mẫu C của change 261112-ba-ngan-duong-ghi (Đợt C), mục tiêu là tài khoản thật (Đợt E, ADR-132): dựng trên
// docs/schema.sql + docs/seed.sql, tắt tài khoản / mục tiêu của seed rồi đặt đúng số của proposal. payday_day 10,
// savings_pct 10, surplus 50, salary_min_amount 1.000.000.
//  Vận hành: tài khoản chính `main` 1.200.000 (trước lương 10/11), thẻ tín dụng `card` 0.
//  Tích luỹ: tài khoản tích luỹ `savings` 6.000.000 (có số tài khoản), heo đất `piggy` 0 (không số tài khoản).
//  Dự phòng: tài khoản tiết kiệm `reserve` 4.000.000 = tài khoản của Học phí `school`; tài khoản bảo dưỡng xe `car-acc`
//            1.000.000 = Bảo dưỡng xe `car`; tài khoản thuế `tax-acc` 0 = Thuế `tax` (10%); phao `buffer` 5.000.000
//            (phần an tâm); tài khoản Ví Thưởng `bonus` 0 = surplus_reward_account.
//  Ngoài ngăn: ví điện tử `ewallet` 200.000.
//  Nguồn: Lương `salary` (mở kỳ lương), Cho thuê `rental` (config), Việc phụ `side`. Kỳ đang có: ngày lương 2026-10-10.
import type { DatabaseSync } from "node:sqlite";
import type { Env } from "../../src/env";
import { app } from "../../src/index";
import { asD1, openDb } from "./d1-sqlite";

export const AT = (vn: string) => new Date(`${vn}+07:00`).toISOString();

export function householdC(): DatabaseSync {
  const db = openDb();
  db.exec(`
    UPDATE reserve_goals SET active = 0;
    DELETE FROM config WHERE k = 'surplus_reward_account';
    UPDATE accounts SET active = 0, sepay_enabled = 0;
    UPDATE income_streams SET opens_cycle = 0;
    UPDATE config SET v = '10' WHERE k = 'savings_pct';
    INSERT INTO config (k, v) VALUES ('payday_day', '10'), ('surplus_reward_account', 'bonus');
    INSERT INTO accounts (id, name, kind, bank, account_no, owner_member_id, opening_balance, pocket, pocket_confirmed) VALUES
      ('main', 'Tài khoản chính', 'bank', 'VCB', '1110001', 'husband', 1200000, 'operating', 1),
      ('card', 'Thẻ tín dụng', 'credit', 'VCB', NULL, 'husband', 0, 'operating', 1),
      ('savings', 'Tài khoản tích luỹ', 'bank', 'TCB', '2220002', 'husband', 6000000, 'savings', 1),
      ('piggy', 'Heo đất', 'bank', 'MB', NULL, 'husband', 0, 'savings', 1),
      ('reserve', 'Tài khoản tiết kiệm', 'bank', 'MB', '3330003', 'husband', 4000000, 'reserve', 1),
      ('car-acc', 'Tài khoản bảo dưỡng xe', 'bank', 'MB', '3330004', 'husband', 1000000, 'reserve', 1),
      ('tax-acc', 'Tài khoản thuế', 'bank', 'MB', '3330005', 'husband', 0, 'reserve', 1),
      ('buffer', 'Phao', 'bank', 'MB', '3330006', 'husband', 5000000, 'reserve', 1),
      ('bonus', 'Ví Thưởng', 'bank', 'MB', '3330007', 'wife', 0, 'reserve', 1),
      ('ewallet', 'Ví điện tử', 'ewallet', NULL, NULL, 'wife', 200000, NULL, 1);
    INSERT INTO income_streams (id, name, sort, opens_cycle) VALUES ('salary', 'Lương', 1, 1), ('side', 'Việc phụ', 2, 0);
    UPDATE income_streams SET name = 'Cho thuê' WHERE id = 'rental';
    INSERT INTO reserve_goals (id, name, account_id, target_amount, target_pct, monthly_amount, repeat_months, due_date, sort) VALUES
      ('school', 'Học phí', 'reserve', 6000000, NULL, 2000000, 3, '2027-01-15', 1),
      ('car', 'Bảo dưỡng xe', 'car-acc', 4800000, NULL, NULL, NULL, '2027-03-31', 2),
      ('tax', 'Thuế', 'tax-acc', NULL, 10, NULL, NULL, NULL, 3);
    INSERT INTO transactions (id, at, amount, meaning, counter_account_id, income_stream_id, week_key, month_key, source)
      VALUES (1, '2026-10-10T01:00:00.000Z', 15000000, 'income', 'main', 'salary', '2026-W41', '2026-10', 'manual');
    INSERT INTO transactions (at, amount, meaning, account_id, category_id, week_key, month_key, source)
      VALUES ('2026-10-20T03:00:00.000Z', 15000000, 'spend', 'main', 'groceries', '2026-W43', '2026-10', 'manual');
    INSERT INTO pay_cycles (income_tx_id, started_at, payday, prev_operating) VALUES (1, '2026-10-10T01:00:00.000Z', '2026-10-10', 0);
  `);
  return db;
}

export type Json = { ok: boolean; data: any; error?: { code: string; message: string; fields?: string[] } };

/** Gọi API như PWA (token + X-Member-Id), đồng hồ giả lập do test ghim bằng vi.setSystemTime. */
export function client(db: DatabaseSync, member = "husband") {
  const env = { DB: asD1(db), API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
  return async (method: string, path: string, body?: unknown, as = member) => {
    const res = await app.request(
      path,
      {
        method,
        headers: { Authorization: "Bearer tok", "X-Member-Id": as, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    return { status: res.status, json: (await res.json()) as Json };
  };
}
