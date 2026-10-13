// Mốc tự do, kế hoạch thu nhập năm — lát 3 của change 261008-bang-can-doi.
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import type { Freedom, IncomePlanSummary, IncomePlanYear, SettingsConfig, Snapshot } from "../web/src/lib/types";
import { asD1, readSql } from "./helpers/d1-sqlite";

let raw: DatabaseSync;
let env: Env;
const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-15T05:00:00.000Z");
  raw = new DatabaseSync(":memory:");
  raw.exec(readSql("docs/schema.sql"));
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
    INSERT INTO allocations (wallet_id, mode, period, percent, priority) VALUES ('wb', 'percent', 'month', 0.3, 10), ('tax', 'percent', 'month', 0.1, 20);
    INSERT INTO allocations (wallet_id, mode, period, priority) VALUES ('have', 'remainder', 'month', 99);
    INSERT INTO categories (id, name, default_wallet_id) VALUES ('an', 'Ăn', 'food');
    INSERT INTO tenants (id, name) VALUES ('t1', 'Người thuê');`);
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
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

const COLS = ["at", "amount", "meaning", "wallet_id", "counter_wallet_id", "account_id", "counter_account_id", "category_id", "tenant_id", "debt_id", "interest_debt_id"] as const;
function tx(t: Partial<Record<(typeof COLS)[number], string | number>>) {
  const month = new Date(Date.parse(String(t.at)) + 7 * 3600_000).toISOString().slice(0, 7);
  raw
    .prepare(`INSERT INTO transactions (${COLS.join(", ")}, week_key, month_key, source) VALUES (${COLS.map(() => "?").join(", ")}, 'x', ?, 'manual')`)
    .run(...COLS.map((c) => t[c] ?? null), month);
}
const income = (month: string, amount: number, account = "vcb", extra: Record<string, string> = {}) =>
  tx({ at: `${month}-10T03:00:00.000Z`, amount, meaning: "income", wallet_id: "income", counter_account_id: account, ...extra });
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

describe("UC-1103 Mốc tự do", () => {
  it("UC-1103 AC-1 (mốc Tự do): F1 5.142.857.143, F2 7.542.857.143, F3 8.800.000.000; A 806.000.000, A_ròng 486.000.000; F1 9,4%, F2 6,4%; dòng tiền ròng 104.166 / 15.000.000 chưa đạt", async () => {
    await sampleSheet();
    await config({ fi_expense_monthly: 20_000_000, fi_expense_must_monthly: 15_000_000 });
    const f = await freedom();
    expect([f.investable, f.liabilities, f.investableNet, f.netCashflowMonthly]).toEqual([806_000_000, 320_000_000, 486_000_000, 104_166]);
    expect(f.params).toMatchObject({ expenseMonthly: 20_000_000, expenseSource: "manual", expenseMustMonthly: 15_000_000, expenseMustSource: "manual" });
    expect(f.freedom.map(({ key, need, pct, cashflowNeed, reached }) => ({ key, need, pct, cashflowNeed, reached }))).toEqual([
      { key: "F1", need: 5_142_857_143, pct: 9.4, cashflowNeed: 15_000_000, reached: false },
      { key: "F2", need: 7_542_857_143, pct: 6.4, cashflowNeed: 22_000_000, reached: false },
      { key: "F3", need: 8_800_000_000, pct: 5.5, cashflowNeed: 22_000_000, reached: false },
    ]);
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

  it("UC-1103 AC-3 (Mốc an tâm — vàng là tiền lỏng): Q_lỏng 156.000.000 = 7,8 tháng; A1 120.000.000 đạt, A2 65,0%, A3 32,5%; Tiền chi được, Quỹ an tâm không đổi; tắt cờ Vàng → 30.000.000 = 1,5 tháng, A1 25,0%", async () => {
    await sampleSheet();
    await config({ fi_expense_monthly: 20_000_000, fi_expense_must_monthly: 15_000_000 });
    const snapBefore = (await call<Snapshot>("GET", "/v1/snapshot")).json.data;
    const f = await freedom();
    expect([f.liquid, f.monthsCovered]).toEqual([156_000_000, 7.8]);
    expect(f.safety).toEqual([
      { key: "A1", months: 6, need: 120_000_000, have: 156_000_000, pct: 130, reached: true },
      { key: "A2", months: 12, need: 240_000_000, have: 156_000_000, pct: 65, reached: false },
      { key: "A3", months: 24, need: 480_000_000, have: 156_000_000, pct: 32.5, reached: false },
    ]);
    const snapAfter = (await call<Snapshot>("GET", "/v1/snapshot")).json.data;
    expect([snapAfter.spendableCash, snapAfter.safetyFund, snapAfter.spendableThisWeek]).toEqual([snapBefore.spendableCash, snapBefore.safetyFund, snapBefore.spendableThisWeek]);
    await call("PATCH", "/v1/balance-items/vang", { liquid: false });
    const off = await freedom();
    expect([off.liquid, off.monthsCovered, byKey(off.safety, "A1").pct]).toEqual([30_000_000, 1.5, 25]);
  });

  it("UC-1103 AC-4 (mốc thu nhập): thu nhập TB 3 tháng trọn 45.000.000, E 20.000.000, khoá 40% → M2, M2′ (33.333.334), M3 đạt; chưa đủ 3 tháng → theo kế hoạch; không có cả hai → chưa có số", async () => {
    await config({ fi_expense_monthly: 20_000_000 });
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
  });

  it("UC-1103 AC-5 (chi phí từ sổ, gồm lãi vay): E 20.000.000, E_must 15.000.000 theo sổ 3 tháng (lãi vay vào cả hai, Có thì tốt chỉ E, trả gốc không vào); chưa đủ 3 tháng → mốc theo E cần chi phí", async () => {
    raw.exec("INSERT INTO debts (id, name, interest_rate_bps) VALUES ('vay', 'Vay tiêu dùng', 1800)");
    spend("2026-10", 1_000, "food");
    let f = await freedom();
    expect([f.params.expenseMonthly, f.params.expenseSource, f.params.expenseMustMonthly]).toEqual([null, null, null]);
    expect(byKey(f.safety, "A1").need).toBeNull();
    expect(byKey(f.freedom, "F1").need).toBeNull();
    raw.exec("DELETE FROM transactions");
    for (const m of ["2026-08", "2026-09", "2026-10"]) {
      spend(m, 14_700_000, "food");
      spend(m, 300_000, "loan-interest", { interest_debt_id: "vay" });
      spend(m, 3_000_000, "have");
      spend(m, 2_000_000, "fun");
      spend(m, 2_000_000, "food", { debt_id: "vay" });
    }
    f = await freedom();
    expect(f.params).toMatchObject({ expenseMonthly: 20_000_000, expenseSource: "ledger", expenseMustMonthly: 15_000_000, expenseMustSource: "ledger" });
  });

  it("UC-1103 AC-6 (mặc định): DB mới → SWR 3,5%, lạm phát 3,5%, hệ số 110%, lãi thực F3 3%, lãi cao 15%, Mốc an tâm 6 / 12 / 24; chi phí tay, năm sinh, tuổi mục tiêu trống", async () => {
    const f = await freedom();
    expect(f.params).toMatchObject({
      swrBps: 350, inflationBps: 350, fatBps: 11000, legacyRateBps: 300, highInterestBps: 1500, safetyMonths: [6, 12, 24],
      expenseMonthly: null, expenseMustMonthly: null, birthYear: null, targetAges: { f1: null, f2: null, f3: null },
    });
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
