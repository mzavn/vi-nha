// Mốc tự do, kế hoạch thu nhập năm — lát 3 của change 261008-bang-can-doi; E / E_must theo nhóm Thiết yếu, phần trích trước
// theo % Tích luỹ + mục tiêu Thuế (261112-ba-ngan-nhin-lai, ADR-128).
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import type { Freedom, IncomePlanSummary, IncomePlanYear, SettingsConfig } from "../web/src/lib/types";
import { asD1 } from "./helpers/d1-sqlite";
import { legacyEmptyDb, openLegacyDb, upgradingD1 } from "./helpers/legacy";

let raw: DatabaseSync;
let env: Env;
const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-15T05:00:00.000Z");
  // Lịch sử trước v2 (giao dịch trừ ví): nạp vào DB 1.38, app lên 1.39 ở câu đầu tiên (ADR-123).
  raw = legacyEmptyDb();
  raw.exec(`
    INSERT INTO members (id, name, role) VALUES ('chong', 'Chồng', 'owner'), ('vo', 'Vợ', 'adult');
    INSERT INTO accounts (id, name, kind, opening_balance, opened_at, owner_member_id) VALUES
      ('vcb', 'VCB (chồng)', 'bank', 30000000, '2026-08-01', 'chong'),
      ('vcb-vo', 'VCB (vợ)', 'bank', 0, '2026-08-01', 'vo');
    INSERT INTO wallets (id, name, tier, must_group, kind, account_id, sort) VALUES
      ('income', 'Thu nhập', 'holding', NULL, 'holding', 'vcb', 0),
      ('wb', 'Tích sản', 'wealth_building', NULL, 'accrual', 'vcb', 10),
      ('tax', 'Thuế', 'tax', NULL, 'accrual', 'vcb', 20),
      ('fun', 'Hưởng thụ', 'nice', NULL, 'envelope', 'vcb', 30),
      ('food', 'Ăn uống', 'must', 'must', 'envelope', 'vcb', 40),
      ('have', 'Có thì tốt', 'must', 'have', 'envelope', 'vcb', 50);
    UPDATE wallets SET account_id = 'vcb' WHERE id = 'loan-interest';
    INSERT INTO category_groups (id, name, essential, sort) VALUES ('g-an', 'Ăn uống', 1, 1), ('g-mua', 'Mua sắm', 0, 2);
    INSERT INTO categories (id, name, default_wallet_id, group_id) VALUES
      ('an', 'Ăn', 'food', 'g-an'), ('mua', 'Mua đồ', 'fun', 'g-mua'), ('bo-me', 'Phụ giúp bố mẹ', 'have', 'g-mua');
    INSERT INTO tenants (id, name) VALUES ('t1', 'Người thuê');`);
  env = { DB: upgradingD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.useRealTimers());

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string; field?: string } };
async function call<T>(method: string, path: string, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}
const freedom = async () => (await call<Freedom>("GET", "/v1/freedom")).json.data;
const config = (b: Record<string, unknown>) => call<SettingsConfig>("PUT", "/v1/settings/config", b);
const byKey = <T extends { key: string }>(list: T[], key: string) => list.find((m) => m.key === key)!;

type Tx = Partial<Record<"at" | "amount" | "meaning" | "wallet_id" | "counter_wallet_id" | "account_id" | "counter_account_id" | "category_id" | "tenant_id" | "debt_id" | "interest_debt_id", string | number>>;
/** Chỉ ghi các cột được truyền — cột ví chỉ có trước khi app lên 1.40 (khoản cũ). */
function tx(t: Tx) {
  const month = new Date(Date.parse(String(t.at)) + 7 * 3600_000).toISOString().slice(0, 7);
  const cols = Object.keys(t) as (keyof Tx)[];
  raw
    .prepare(`INSERT INTO transactions (${cols.join(", ")}, week_key, month_key, source) VALUES (${cols.map(() => "?").join(", ")}, 'x', ?, 'manual')`)
    .run(...cols.map((c) => t[c] ?? null), month);
}
const income = (month: string, amount: number, account = "vcb", extra: Record<string, string> = {}) =>
  tx({ at: `${month}-10T03:00:00.000Z`, amount, meaning: "income", counter_account_id: account, ...extra });
const spend = (month: string, amount: number, wallet: string, extra: Record<string, string> = {}) =>
  tx({ at: `${month}-12T03:00:00.000Z`, amount, meaning: "spend", counter_wallet_id: wallet, account_id: "vcb", category_id: "an", ...extra });

/** Bảng như UC-1102 AC-1: tiền 30.000.000, Vàng 126.000.000 (A1, tiền lỏng), Chứng khoán 50.000.000, Đất nền 600.000.000, phải thu 5.000.000, nợ 320.000.000. */
async function sampleSheet() {
  const ok = async (method: string, path: string, body: unknown) => expect((await call(method, path, body)).status, path).toBeLessThan(300);
  await ok("POST", "/v1/balance-items", { name: "Vàng", section: "A1", pyramid: "protective", measure: "units", unit: "chỉ" });
  await ok("POST", "/v1/balance-items/vang/lots", { bought_on: "2026-03-10", quantity: 20, unit_cost: 5_000_000 });
  await ok("POST", "/v1/balance-items/vang/lots", { bought_on: "2026-09-01", quantity: 4, unit_cost: 6_000_000 });
  await ok("POST", "/v1/balance-items/vang/values", { as_of: "2026-11-01", unit_price: 5_250_000 });
  await ok("POST", "/v1/balance-items", { name: "Chứng khoán", section: "A2", pyramid: "income", measure: "value", value: 50_000_000, cashflow: 3_000_000, cashflow_period: "year", expected_return: 12 });
  await ok("POST", "/v1/balance-items", { name: "Đất nền", section: "B3", pyramid: "growth", measure: "value", value: 600_000_000, expected_return: 6 });
  await ok("POST", "/v1/receivables", { name: "Anh Ba", amount: 5_000_000 });
  await ok("POST", "/v1/debts", { name: "Vay người nhà", amount: 300_000_000, term: "long" });
  await ok("POST", "/v1/debts", { name: "Vay tiêu dùng", amount: 20_000_000, interest_rate: 18 });
}

/**
 * Sổ của UC-1103 AC-8 (ghi trước câu API đầu tiên — cột ví chỉ có trước khi app lên 1.40): giao dịch đầu ngày 3/10/2026; Thiết yếu /
 * Mong muốn tháng 10 10.000.000 (gồm Lãi vay 200.000) / 4.200.000, tháng 11 11.000.000 / 4.800.000, tháng 12 9.000.000 / 6.000.000,
 * tháng 1/2027 12.000.000 / 3.000.000; thu nhập 30.000.000 mỗi tháng; không kế hoạch thu nhập.
 */
function ledgerAC8() {
  raw.exec("INSERT INTO debts (id, name, interest_rate_bps) VALUES ('vay', 'Vay tiêu dùng', 1800)");
  tx({ at: "2026-10-03T03:00:00.000Z", amount: 9_800_000, meaning: "spend", counter_wallet_id: "food", account_id: "vcb", category_id: "an" });
  spend("2026-10", 200_000, "loan-interest", { interest_debt_id: "vay" });
  spend("2026-10", 4_200_000, "fun", { category_id: "mua" });
  const months: [string, number, number][] = [["2026-11", 11_000_000, 4_800_000], ["2026-12", 9_000_000, 6_000_000], ["2027-01", 12_000_000, 3_000_000]];
  for (const [m, must, flex] of months) {
    spend(m, must, "food");
    spend(m, flex, "fun", { category_id: "mua" });
  }
  for (const m of ["2026-10", "2026-11", "2026-12", "2027-01"]) income(m, 30_000_000);
}

/** Ngăn của UC-1103 AC-9: Tích luỹ = tài khoản tích luỹ 6.900.000 + Heo đất 510.000; Vàng 30.000.000 cờ Tiền lỏng; Dự phòng không gắn mục tiêu 5.000.000. */
async function householdAC9() {
  expect((await call("POST", "/v1/balance-items", { name: "Vàng", section: "A1", pyramid: "protective", measure: "value", value: 30_000_000, liquid: true })).status).toBeLessThan(300);
  raw.exec(`
    UPDATE accounts SET pocket = 'operating', pocket_confirmed = 1 WHERE id = 'vcb';
    INSERT INTO accounts (id, name, kind, opening_balance, pocket, pocket_confirmed) VALUES
      ('tich-luy', 'Tài khoản tích luỹ', 'bank', 6900000, 'savings', 1),
      ('heo', 'Heo đất', 'cash', 510000, 'savings', 1),
      ('du-phong', 'Dự phòng', 'bank', 5000000, 'reserve', 1);`);
}

/**
 * Bảng UC-1102 AC-1 (A 806.000.000, L 320.000.000) với Tiền trong app 30.000.000 chia ngăn: Vận hành 4.000.000, Dự phòng tài khoản mục
 * tiêu Học phí 8.000.000 và Ví Thưởng 2.000.000, Tích luỹ 16.000.000; E 20.000.000, E_must 15.000.000 nhập tay.
 */
async function householdAC10() {
  await sampleSheet();
  raw.exec(`
    UPDATE accounts SET opening_balance = 4000000, pocket = 'operating', pocket_confirmed = 1 WHERE id = 'vcb';
    INSERT INTO accounts (id, name, kind, opening_balance, pocket, pocket_confirmed) VALUES
      ('hoc-phi', 'Tài khoản học phí', 'bank', 8000000, 'reserve', 1),
      ('thuong', 'Ví Thưởng', 'bank', 2000000, 'reserve', 1),
      ('tich-luy', 'Tài khoản tích luỹ', 'bank', 16000000, 'savings', 1);
    INSERT INTO reserve_goals (id, name, account_id, target_amount) VALUES ('hoc-phi', 'Học phí', 'hoc-phi', 20000000);
    INSERT OR REPLACE INTO config (k, v) VALUES ('surplus_reward_account', 'thuong');`);
  await config({ fi_expense_monthly: 20_000_000, fi_expense_must_monthly: 15_000_000 });
}

describe("UC-1103 Mốc tự do", () => {
  it("UC-1103 AC-1 (mốc Tự do): F1 5.142.857.143, F2 7.542.857.143, F3 8.800.000.000; A 806.000.000, tài sản cho FIRE 486.000.000 (tài khoản ở ngoài ngăn nên không trừ gì); F1 9,4%, F2 6,4%; dòng tiền ròng 104.166 / 15.000.000 chưa đạt", async () => {
    await sampleSheet();
    await config({ fi_expense_monthly: 20_000_000, fi_expense_must_monthly: 15_000_000 });
    const f = await freedom();
    expect([f.investable, f.liabilities, f.fireAssets.net, f.netCashflowMonthly]).toEqual([806_000_000, 320_000_000, 486_000_000, 104_166]);
    expect(f.params).toMatchObject({ expenseMonthly: 20_000_000, expenseSource: "manual", expenseMustMonthly: 15_000_000, expenseMustSource: "manual", expenseLedgerMonths: null });
    expect(f.freedom.map(({ key, need, have, pct, cashflowNeed, reached }) => ({ key, need, have, pct, cashflowNeed, reached }))).toEqual([
      { key: "F1", need: 5_142_857_143, have: 486_000_000, pct: 9.4, cashflowNeed: 15_000_000, reached: false },
      { key: "F2", need: 7_542_857_143, have: 486_000_000, pct: 6.4, cashflowNeed: 22_000_000, reached: false },
      { key: "F3", need: 8_800_000_000, have: 486_000_000, pct: 5.5, cashflowNeed: 22_000_000, reached: false },
    ]);
    for (const gone of ["liquid", "monthsCovered", "safety", "investableNet"]) expect(f).not.toHaveProperty(gone);
  });

  it("UC-1103 AC-2 (tuổi, lạm phát): năm sinh 1990, F1 45 tuổi → năm 2035, còn 9 năm, ≈ 7,01 tỷ; F2 50 tuổi → 2040, còn 14 năm, ≈ 12,21 tỷ; SWR 3% → F1 6.000.000.000", async () => {
    await sampleSheet();
    await config({ fi_expense_monthly: 20_000_000, fi_expense_must_monthly: 15_000_000, fi_birth_year: 1990, fi_target_age_f1: 45, fi_target_age_f2: 50 });
    const f = await freedom();
    const f1 = byKey(f.freedom, "F1").target!;
    const f2 = byKey(f.freedom, "F2").target!;
    expect([f1.age, f1.year, f1.yearsLeft, Math.round(f1.needAtTargetYear / 1e7) / 100]).toEqual([45, 2035, 9, 7.01]);
    expect([f2.age, f2.year, f2.yearsLeft, Math.round(f2.needAtTargetYear / 1e7) / 100]).toEqual([50, 2040, 14, 12.21]);
    expect(byKey(f.freedom, "F3").target).toBeNull();
    await config({ fi_swr_bps: 300 });
    expect(byKey((await freedom()).freedom, "F1").need).toBe(6_000_000_000);
  });

  it("UC-1103 AC-4 (mốc thu nhập): thu nhập TB 3 tháng trọn 45.000.000, E 20.000.000, % Tích luỹ 30 + mục tiêu Thuế 10% → phần trích trước 40%; M2, M2′ (33.333.334), M3 đạt; chưa đủ 3 tháng → theo kế hoạch; không có cả hai → chưa có số", async () => {
    await config({ fi_expense_monthly: 20_000_000, savings_pct: 30 });
    // Mục tiêu Thuế chưa gắn tài khoản vẫn vào phần trích trước (ADR-128 (5): p là kế hoạch, không phải tiền đã có).
    raw.exec("INSERT INTO reserve_goals (id, name, target_pct) VALUES ('thue', 'Thuế', 10)");
    // Chưa có sổ, chưa có kế hoạch: chưa có số.
    let f = await freedom();
    expect([f.params.incomeMonthly, f.params.incomeSource]).toEqual([null, null]);
    expect(f.income.map((m) => m.reached)).toEqual([null, null, null]);
    // Sổ mới một tháng + kế hoạch năm nay → theo kế hoạch.
    income("2026-10", 45_000_000);
    await call("PUT", "/v1/income-plans/2026", { household_monthly: 38_000_000 });
    f = await freedom();
    expect([f.params.incomeMonthly, f.params.incomeSource]).toEqual([38_000_000, "plan"]);
    // Đủ 3 tháng trọn (8, 9, 10) → theo sổ.
    income("2026-08", 45_000_000);
    income("2026-09", 45_000_000);
    f = await freedom();
    expect([f.params.incomeMonthly, f.params.incomeSource, f.params.lockedBps]).toEqual([45_000_000, "ledger", 4000]);
    expect(f.income).toEqual([
      { key: "M2", need: 20_000_000, have: 45_000_000, reached: true },
      { key: "M2p", need: 33_333_334, have: 45_000_000, reached: true },
      { key: "M3", need: 40_000_000, have: 45_000_000, reached: true },
    ]);
    // Mục tiêu Thuế tắt thì không còn trong phần trích trước; tổng chặn ở 99%.
    raw.exec("UPDATE reserve_goals SET active = 0 WHERE id = 'thue'");
    expect((await freedom()).params.lockedBps).toBe(3000);
    raw.exec("INSERT INTO reserve_goals (id, name, target_pct) VALUES ('thue-2', 'Thuế khác', 80)");
    expect((await freedom()).params.lockedBps).toBe(9900);
  });

  it("UC-1103 AC-5 (chi phí từ sổ, gồm lãi vay): chưa hết tháng nào của sổ → E, E_must không có; mốc theo E cần chi phí", async () => {
    raw.exec("INSERT INTO debts (id, name, interest_rate_bps) VALUES ('vay', 'Vay tiêu dùng', 1800)");
    spend("2026-11", 1_000, "food");
    const f = await freedom();
    expect([f.params.expenseMonthly, f.params.expenseSource, f.params.expenseMustMonthly, f.params.expenseLedgerMonths]).toEqual([null, null, null, null]);
    expect(byKey(f.cushion.steps, "start").need).toBeNull();
    expect(byKey(f.freedom, "F1").need).toBeNull();
  });

  it("UC-1103 AC-5 (chi phí từ sổ, gồm lãi vay): đủ 3 tháng trọn → E 20.000.000, E_must = Thiết yếu 15.000.000 (gồm lãi vay 300.000), Mong muốn 5.000.000 (gồm phụ giúp bố mẹ 1.000.000) chỉ vào E, trả gốc không vào", async () => {
    raw.exec("INSERT INTO debts (id, name, interest_rate_bps) VALUES ('vay', 'Vay tiêu dùng', 1800)");
    for (const m of ["2026-08", "2026-09", "2026-10"]) {
      spend(m, 14_700_000, "food");
      spend(m, 300_000, "loan-interest", { interest_debt_id: "vay" });
      spend(m, 4_000_000, "fun", { category_id: "mua" });
      // Ví Must / Có thì tốt cũ không kéo khoản về Thiết yếu: danh mục nhóm Mong muốn quyết.
      spend(m, 1_000_000, "have", { category_id: "bo-me" });
      spend(m, 2_000_000, "food", { debt_id: "vay" });
    }
    const f = await freedom();
    expect(f.params).toMatchObject({ expenseMonthly: 20_000_000, expenseSource: "ledger", expenseMustMonthly: 15_000_000, expenseMustSource: "ledger", expenseLedgerMonths: 3 });
  });

  it("UC-1103 AC-6 (mặc định): DB mới → SWR 3,5%, lạm phát 3,5%, hệ số 110%, lãi thực F3 3%, lãi cao 15%, mốc đệm 6 / 12 / 24; chi phí tay, năm sinh, tuổi mục tiêu trống", async () => {
    const f = await freedom();
    expect(f.params).toMatchObject({
      swrBps: 350, inflationBps: 350, fatBps: 11000, legacyRateBps: 300, highInterestBps: 1500, safetyMonths: [6, 12, 24],
      expenseMonthly: null, expenseMustMonthly: null, birthYear: null, targetAges: { f1: null, f2: null, f3: null },
    });
  });

  it("UC-1103 AC-7 (E không tụt sau v2): tháng 8 chỉ khoản cũ trừ ví, tháng 9, 10 chỉ khoản mới không ví, cùng danh mục, cùng số → E 20.000.000, E_must 15.000.000 theo sổ 3 tháng gần nhất; không mục tiêu Thuế, % Tích luỹ 10 → phần trích trước 10%", async () => {
    const cols = "at, amount, meaning, account_id, category_id, week_key, month_key, source";
    const legacy = openLegacyDb((db) => {
      const old = db.prepare(`INSERT INTO transactions (${cols}, counter_wallet_id) VALUES (?, ?, 'spend', 'vcb-anh', ?, 'x', '2026-08', 'manual', ?)`);
      old.run("2026-08-12T03:00:00.000Z", 15_000_000, "cho-nau", "an"); // ví Must, nhóm Thiết yếu "Ăn uống" (0038)
      old.run("2026-08-13T03:00:00.000Z", 5_000_000, "xe-co", "co-thi-tot"); // ví Có thì tốt, nhóm Mong muốn "Có thì tốt" (0038)
    });
    legacy.exec("UPDATE reserve_goals SET active = 0 WHERE target_pct IS NOT NULL; INSERT OR REPLACE INTO config (k, v) VALUES ('savings_pct', '10')");
    const fresh = legacy.prepare(`INSERT INTO transactions (${cols}) VALUES (?, ?, 'spend', 'vcb-anh', ?, 'x', ?, 'manual')`);
    for (const m of ["2026-09", "2026-10"]) {
      fresh.run(`${m}-12T03:00:00.000Z`, 15_000_000, "cho-nau", m);
      fresh.run(`${m}-13T03:00:00.000Z`, 5_000_000, "xe-co", m);
    }
    env = { DB: asD1(legacy), API_TOKEN: "tok" } as Env;
    const f = await freedom();
    expect(f.params).toMatchObject({ expenseMonthly: 20_000_000, expenseSource: "ledger", expenseMustMonthly: 15_000_000, expenseMustSource: "ledger", lockedBps: 1000 });
  });

  it("UC-1103 AC-8 (E cửa sổ trượt 1–3 tháng): 20/10 chưa có; 17/11 E 14.200.000, E_must 10.000.000, 1 tháng; 5/12 15.000.000 / 10.500.000, 2 tháng; 3/2/2027 15.266.667 / 10.666.667, 3 tháng; nhập tay E 20.000.000 thắng, E_must theo sổ; I chỉ có khi đủ 3 tháng trọn", async () => {
    ledgerAC8();
    const on = async (iso: string) => {
      at(iso);
      const { params } = await freedom();
      return [params.expenseMonthly, params.expenseSource, params.expenseMustMonthly, params.expenseMustSource, params.expenseLedgerMonths, params.incomeMonthly, params.incomeSource];
    };
    expect(await on("2026-10-20T05:00:00.000Z")).toEqual([null, null, null, null, null, null, null]);
    expect(await on("2026-11-17T05:00:00.000Z")).toEqual([14_200_000, "ledger", 10_000_000, "ledger", 1, null, null]);
    expect(await on("2026-12-05T05:00:00.000Z")).toEqual([15_000_000, "ledger", 10_500_000, "ledger", 2, null, null]);
    expect(await on("2027-02-03T05:00:00.000Z")).toEqual([15_266_667, "ledger", 10_666_667, "ledger", 3, 30_000_000, "ledger"]);
    await config({ fi_expense_monthly: 20_000_000 });
    expect(await on("2026-11-17T05:00:00.000Z")).toEqual([20_000_000, "manual", 10_000_000, "ledger", 1, null, null]);
  });

  it("UC-1103 AC-9 (bậc đệm đếm bằng ngăn Tích luỹ): đệm 7.410.000 = 0,5 tháng, Khởi đầu 52,1%, An tâm 8,6%, An toàn 4,3%, Vững vàng 2,1%, next start; vàng và Dự phòng không vào; rút Heo đất → 5.410.000, 0,3 tháng; 90.000.000 → 6,3 tháng, next safe; mốc 3,6,12 → next solid", async () => {
    ledgerAC8();
    at("2026-11-17T05:00:00.000Z");
    await householdAC9();
    const f = await freedom();
    expect(f.params.expenseMonthly).toBe(14_200_000);
    expect(f.cushion).toEqual({
      amount: 7_410_000,
      monthsCovered: 0.5,
      steps: [
        { key: "start", months: 1, need: 14_200_000, have: 7_410_000, pct: 52.1, reached: false },
        { key: "calm", months: 6, need: 85_200_000, have: 7_410_000, pct: 8.6, reached: false },
        { key: "safe", months: 12, need: 170_400_000, have: 7_410_000, pct: 4.3, reached: false },
        { key: "solid", months: 24, need: 340_800_000, have: 7_410_000, pct: 2.1, reached: false },
      ],
      next: "start",
    });
    tx({ at: "2026-11-17T04:00:00.000Z", amount: 2_000_000, meaning: "transfer", account_id: "heo", counter_account_id: "vcb" });
    let c = (await freedom()).cushion;
    expect([c.amount, c.monthsCovered]).toEqual([5_410_000, 0.3]);
    raw.exec("UPDATE accounts SET opening_balance = 91490000 WHERE id = 'tich-luy'");
    c = (await freedom()).cushion;
    expect([c.amount, c.monthsCovered, c.steps.map((s) => s.reached), c.next]).toEqual([90_000_000, 6.3, [true, true, false, false], "safe"]);
    await config({ fi_safety_months: "3,6,12" });
    c = (await freedom()).cushion;
    expect(c.steps.map((s) => [s.key, s.months, s.need, s.reached])).toEqual([
      ["start", 1, 14_200_000, true],
      ["calm", 3, 42_600_000, true],
      ["safe", 6, 85_200_000, true],
      ["solid", 12, 170_400_000, false],
    ]);
    expect(c.next).toBe("solid");
  });

  it("UC-1103 AC-10 (tài sản cho FIRE không đếm trùng): trừ Vận hành 4.000.000, mục tiêu Dự phòng 8.000.000, Ví Thưởng 2.000.000, đệm 16.000.000 → 456.000.000; F1 8,8%, F2 6,0%, F3 5,1%; thẻ âm vào nợ không vào Vận hành; đệm vượt 24E vào tài sản; không có E → trừ cả đệm", async () => {
    await householdAC10();
    let f = await freedom();
    expect(f.fireAssets).toEqual({ investable: 806_000_000, liabilities: 320_000_000, operating: 4_000_000, reserveGoals: 8_000_000, reward: 2_000_000, cushionKept: 16_000_000, net: 456_000_000 });
    expect(f.freedom.map((m) => [m.key, m.have, m.pct])).toEqual([["F1", 456_000_000, 8.8], ["F2", 456_000_000, 6], ["F3", 456_000_000, 5.1]]);
    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance, pocket, pocket_confirmed) VALUES ('the', 'Thẻ tín dụng', 'credit', -800000, 'operating', 1)");
    f = await freedom();
    expect([f.fireAssets.liabilities, f.fireAssets.operating, f.fireAssets.net]).toEqual([320_800_000, 4_000_000, 455_200_000]);
    raw.exec("UPDATE accounts SET active = 0 WHERE id = 'the'; UPDATE accounts SET opening_balance = 500000000 WHERE id = 'tich-luy'");
    f = await freedom();
    expect([f.fireAssets.investable, f.fireAssets.cushionKept, f.fireAssets.net]).toEqual([1_290_000_000, 480_000_000, 476_000_000]);
    await config({ fi_expense_monthly: null, fi_expense_must_monthly: null });
    f = await freedom();
    expect([f.params.expenseMonthly, f.fireAssets.cushionKept, f.fireAssets.net]).toEqual([null, 500_000_000, 456_000_000]);
    expect(f.freedom.map((m) => m.need)).toEqual([null, null, null]);
  });

  it("UC-1103 AC-11 (Nửa đường): cần 2.571.428.572 (17,7%) hoặc dòng tiền 10.000.000 / có 104.166 — chưa đạt; P_ròng 10.000.000 → đạt; E_must trống → cần tài sản null, đạt theo dòng tiền; cả hai không có → null", async () => {
    await householdAC10();
    let f = await freedom();
    expect(f.halfway).toEqual({ need: 2_571_428_572, have: 456_000_000, pct: 17.7, cashflowNeed: 10_000_000, cashflowHave: 104_166, reached: false });
    // P_ròng trừ phần lạm phát của giá trị mục: ⌈1.000.000 × 3,5% ÷ 12⌉ = 2.917.
    await call("POST", "/v1/balance-items", { name: "Nhà cho thuê", section: "B3", pyramid: "income", measure: "value", value: 1_000_000, cashflow: 9_898_751, cashflow_period: "month" });
    f = await freedom();
    expect([f.halfway.cashflowHave, f.halfway.pct, f.halfway.reached]).toEqual([10_000_000, 17.7, true]);
    await config({ fi_expense_must_monthly: null });
    f = await freedom();
    expect([f.params.expenseMustMonthly, f.halfway.need, f.halfway.pct, f.halfway.cashflowNeed, f.halfway.reached]).toEqual([null, null, null, 10_000_000, true]);
    await config({ fi_expense_monthly: null });
    f = await freedom();
    expect([f.halfway.need, f.halfway.cashflowNeed, f.halfway.reached]).toEqual([null, null, null]);
  });

  it("UC-1103 AC-11: E = 0 theo sổ (tháng trọn chỉ có thu) hoặc E = 0 nhập tay → coi như chưa có E: bậc đệm, M2 / M2′ / M3, Nửa đường, F1–F3 không có số cần, reached null", async () => {
    income("2026-10", 30_000_000);
    const noE = (f: Freedom) => {
      expect(f.cushion.steps.map((s) => [s.need, s.reached])).toEqual([[null, null], [null, null], [null, null], [null, null]]);
      expect([f.cushion.monthsCovered, f.cushion.next]).toEqual([null, null]);
      expect(f.income.map((m) => [m.need, m.reached])).toEqual([[null, null], [null, null], [null, null]]);
      expect([f.halfway.need, f.halfway.cashflowNeed, f.halfway.reached]).toEqual([null, null, null]);
      expect(f.freedom.map((m) => [m.need, m.cashflowNeed, m.reached])).toEqual([[null, null, null], [null, null, null], [null, null, null]]);
    };
    let f = await freedom();
    expect([f.params.expenseMonthly, f.params.expenseSource, f.params.expenseMustMonthly, f.params.expenseLedgerMonths]).toEqual([0, "ledger", 0, 1]);
    noE(f);
    await config({ fi_expense_monthly: 0, fi_expense_must_monthly: 0 });
    f = await freedom();
    expect([f.params.expenseMonthly, f.params.expenseSource, f.params.expenseMustMonthly, f.params.expenseMustSource]).toEqual([0, "manual", 0, "manual"]);
    noE(f);
  });

  it("UC-1103 AC-8: tháng theo giờ VN — khoản chi 31/10 17:30Z (0:30 ngày 1/11 giờ VN) thuộc tháng 11: ngày 15/11 E chỉ tính tháng 10; ngày 5/12 E = TB tháng 10 và 11", async () => {
    const add = async (at: string, amount: number) =>
      expect((await call("POST", "/v1/transactions", { meaning: "spend", amount, account_id: "vcb", category_id: "an", at })).status).toBeLessThan(300);
    await add("2026-10-15T03:00:00.000Z", 10_000_000);
    await add("2026-10-31T17:30:00.000Z", 5_000_000);
    expect(raw.prepare("SELECT month_key AS m FROM transactions WHERE amount = 5000000").get()).toEqual({ m: "2026-11" });
    expect((await freedom()).params).toMatchObject({ expenseMonthly: 10_000_000, expenseLedgerMonths: 1 });
    at("2026-12-05T05:00:00.000Z");
    expect((await freedom()).params).toMatchObject({ expenseMonthly: 7_500_000, expenseLedgerMonths: 2 });
  });

  it("UC-1103 AC-10: khoản gửi con của tài khoản mục tiêu vào reserveGoals, khoản gửi con của Ví Thưởng vào reward — tài sản cho FIRE không đổi (456.000.000)", async () => {
    await householdAC10();
    raw.exec(`INSERT INTO accounts (id, name, kind, opening_balance, pocket, pocket_confirmed, parent_account_id) VALUES
      ('hoc-phi-gui', 'Gửi kỳ hạn học phí', 'bank', 5000000, 'reserve', 1, 'hoc-phi'),
      ('thuong-gui', 'Gửi kỳ hạn Ví Thưởng', 'bank', 3000000, 'reserve', 1, 'thuong');`);
    const f = await freedom();
    expect(f.fireAssets).toEqual({ investable: 814_000_000, liabilities: 320_000_000, operating: 4_000_000, reserveGoals: 13_000_000, reward: 5_000_000, cushionKept: 16_000_000, net: 456_000_000 });
  });

  it("projectionStart (UC-1107): điểm xuất phát là số thật — A, L, dòng thu nhập theo kế hoạch năm nay, E, lợi suất kỳ vọng bình quân theo giá trị", async () => {
    await sampleSheet();
    await config({ fi_expense_monthly: 20_000_000, fi_expense_must_monthly: 15_000_000, fi_birth_year: 1990, fi_target_age_f1: 45, fi_target_age_f2: 50 });
    await call("PUT", "/v1/income-plans/2026", {
      household_monthly: 42_000_000,
      lines: [{ name: "Lương", member_id: "chong", monthly_amount: 30_000_000 }, { name: "Lương", member_id: "vo", monthly_amount: 12_000_000 }],
    });
    const p = (await freedom()).projectionStart;
    expect(p).toMatchObject({
      investable: 806_000_000, liabilities: 320_000_000, expenseMonthly: 20_000_000, expenseMustMonthly: 15_000_000, inflationBps: 350, swrBps: 350, fatBps: 11000,
      birthYear: 1990, targetAgeF1: 45, targetAgeF2: 50, incomeSource: "plan",
      incomeLines: [{ name: "Lương", memberId: "chong", monthly: 30_000_000 }, { name: "Lương", memberId: "vo", monthly: 12_000_000 }],
    });
    // (50.000.000 × 12% + 600.000.000 × 6%) ÷ 650.000.000 = 6,46% → 646 phần vạn.
    expect(p.expectedReturnBps).toBe(646);
  });

  it("UC-1107 AC-4 (A_0 theo tài sản cho FIRE): hộ UC-1103 AC-10 → projectionStart.investable 776.000.000, liabilities 320.000.000, ròng 456.000.000 = fireAssets.net", async () => {
    await householdAC10();
    const f = await freedom();
    expect([f.projectionStart.investable, f.projectionStart.liabilities]).toEqual([776_000_000, 320_000_000]);
    expect(f.projectionStart.investable - f.projectionStart.liabilities).toBe(f.fireAssets.net);
  });

  it("UC-1107 AC-4 (E theo sổ 1 tháng): hộ UC-1103 AC-8 ngày 17/11/2026, không chi phí tay → expenseMonthly 14.200.000, expenseMustMonthly 10.000.000", async () => {
    ledgerAC8();
    at("2026-11-17T05:00:00.000Z");
    const p = (await freedom()).projectionStart;
    expect([p.expenseMonthly, p.expenseMustMonthly]).toEqual([14_200_000, 10_000_000]);
  });
});

describe("UC-1104 kế hoạch thu nhập theo năm", () => {
  async function planAC1() {
    at("2026-01-02T03:00:00.000Z");
    expect((await call("PUT", "/v1/income-plans/2026", { household_monthly: 50_000_000 })).status).toBe(200);
    at("2026-07-01T03:00:00.000Z");
    await call("PUT", "/v1/income-plans/2026", {
      household_monthly: 45_000_000,
      lines: [
        { name: "Lương", member_id: "chong", monthly_amount: 30_000_000 },
        { name: "Lương", member_id: "vo", monthly_amount: 12_000_000 },
        { name: "Cho thuê", member_id: null, monthly_amount: 3_000_000 },
      ],
    });
    at("2026-11-15T05:00:00.000Z");
    income("2026-10", 28_000_000, "vcb");
    income("2026-10", 12_500_000, "vcb-vo");
    income("2026-10", 3_000_000, "vcb", { tenant_id: "t1" });
    income("2026-11", 40_000_000, "vcb");
  }

  it("UC-1104 AC-1 (sửa giữa năm, % đạt): hiện tại 45.000.000, đầu năm 50.000.000; TB 43.500.000 — 96,6% / 87,0%; cả năm 8,0% trên 1 tháng; Chồng 93,3%, Vợ 104,1%, Chung 100,0%; tháng 11 chưa tính", async () => {
    await planAC1();
    const y = (await call<IncomePlanYear>("GET", "/v1/income-plans/2026")).json.data;
    expect([y.current!.householdMonthly, y.first!.householdMonthly, y.versions.length, y.current!.createdAt.slice(0, 10)]).toEqual([45_000_000, 50_000_000, 2, "2026-07-01"]);
    expect(y.actual).toEqual({ monthsCounted: 1, total: 43_500_000, monthlyAverage: 43_500_000, pctOfCurrent: 96.6, pctOfFirst: 87, pctOfYear: 8 });
    expect(y.byMember).toEqual([
      { memberId: "chong", memberName: "Chồng", planned: 30_000_000, actual: 28_000_000, pct: 93.3 },
      { memberId: "vo", memberName: "Vợ", planned: 12_000_000, actual: 12_500_000, pct: 104.1 },
      { memberId: null, memberName: "Chung", planned: 3_000_000, actual: 3_000_000, pct: 100 },
    ]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM income_plans WHERE year = 2026").get()).toEqual({ n: 2 });
    expect(() => raw.prepare("UPDATE income_plans SET household_monthly = 1").run()).toThrow(/income_plan_append_only/);
    expect(() => raw.prepare("DELETE FROM income_plans").run()).toThrow(/income_plan_append_only/);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'income_plan.version'").get()).toEqual({ n: 2 });
  });

  it("UC-1104 AC-2 (chỉ cả nhà; lỗi): 2027 một bản không chia; thiếu / 0 mục tiêu → invalid_plan; người không tồn tại → invalid_plan; năm ngoài khoảng → invalid_year; 2026 không đổi", async () => {
    await planAC1();
    const y = (await call<IncomePlanYear>("PUT", "/v1/income-plans/2027", { household_monthly: 60_000_000 })).json.data;
    expect([y.versions.length, y.current!.lines, y.byMember]).toEqual([1, [], null]);
    for (const body of [{}, { household_monthly: 0 }, { household_monthly: 1, lines: [{ name: "X", member_id: "khong-co", monthly_amount: 1 }] }, { household_monthly: 1, lines: [{ name: "X", member_id: null, monthly_amount: -1 }] }]) {
      const r = await call("PUT", "/v1/income-plans/2027", body);
      expect([r.status, r.json.error?.code], JSON.stringify(body)).toEqual([400, "invalid_plan"]);
    }
    for (const year of ["1999", "2028"]) expect((await call("PUT", `/v1/income-plans/${year}`, { household_monthly: 1 })).json.error?.code).toBe("invalid_year");
    expect((await call<IncomePlanYear>("GET", "/v1/income-plans/2026")).json.data.versions).toHaveLength(2);
  });

  it("UC-1104 AC-3 (các năm): 2026 (45.000.000, đầu năm 50.000.000, 96,6%, cả năm 8,0%), 2025 (40.000.000, chưa có số)", async () => {
    await planAC1();
    await call("PUT", "/v1/income-plans/2025", { household_monthly: 40_000_000 });
    const list = (await call<{ years: IncomePlanSummary[] }>("GET", "/v1/income-plans")).json.data.years;
    expect(list).toEqual([
      { year: 2026, currentMonthly: 45_000_000, firstMonthly: 50_000_000, versions: 2, monthsCounted: 1, monthlyAverage: 43_500_000, pctOfCurrent: 96.6, pctOfFirst: 87, pctOfYear: 8 },
      { year: 2025, currentMonthly: 40_000_000, firstMonthly: 40_000_000, versions: 1, monthsCounted: 0, monthlyAverage: null, pctOfCurrent: null, pctOfFirst: null, pctOfYear: null },
    ]);
    expect((await call<Freedom>("GET", "/v1/freedom")).json.data.incomePlan).toMatchObject({ year: 2026, current: { householdMonthly: 45_000_000 } });
  });
});
