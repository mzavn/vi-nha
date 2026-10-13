// Lưu chuyển tiền, Kết quả thu chi, phân loại lại — lát 2 của change 261008-bang-can-doi.
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CashFlow, IncomeStatement } from "../src/domain/reports";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { getCashFlow } from "../src/services/reports";
import type { ReportTransactions } from "../web/src/lib/types";
import { asD1, readSql } from "./helpers/d1-sqlite";

let raw: DatabaseSync;
let env: Env;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T05:00:00.000Z"));
  raw = new DatabaseSync(":memory:");
  raw.exec(readSql("docs/schema.sql"));
  raw.exec(`
    INSERT INTO accounts (id, name, kind, opening_balance, opened_at, role) VALUES
      ('vcb', 'VCB (chồng)', 'bank', 12000000, '2026-09-01', NULL),
      ('phao', 'Phao', 'bank', 0, '2026-09-01', 'buffer');
    INSERT INTO wallets (id, name, tier, must_group, kind, account_id, sort) VALUES
      ('income', 'Thu nhập', 'holding', NULL, 'holding', 'vcb', 0),
      ('wb', 'Tích sản', 'wealth_building', NULL, 'accrual', 'vcb', 10),
      ('tax', 'Thuế', 'tax', NULL, 'accrual', 'vcb', 20),
      ('fun', 'Hưởng thụ', 'nice', NULL, 'envelope', 'vcb', 30),
      ('food', 'Ăn uống', 'must', 'must', 'envelope', 'vcb', 40),
      ('have', 'Có thì tốt', 'must', 'have', 'envelope', 'vcb', 50);
    UPDATE wallets SET account_id = 'vcb' WHERE id = 'loan-interest';
    INSERT INTO categories (id, name, default_wallet_id) VALUES ('an', 'Ăn', 'food');
    INSERT INTO tenants (id, name) VALUES ('t1', 'Người thuê');
    INSERT INTO debts (id, name) VALUES ('nha', 'Vay người nhà');
    INSERT INTO debts (id, name, interest_rate_bps) VALUES ('vay-tieu-dung', 'Vay tiêu dùng', 1800);
    INSERT INTO receivables (id, name) VALUES ('em', 'Em');`);
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.useRealTimers());

const COLS = ["at", "amount", "meaning", "wallet_id", "counter_wallet_id", "account_id", "counter_account_id", "category_id", "tenant_id", "debt_id", "interest_debt_id", "receivable_id", "asset_kind"] as const;
type Tx = Partial<Record<(typeof COLS)[number], string | number>>;
/** Ghi thẳng một giao dịch ghi tay; month_key theo giờ VN của `at`. */
function tx(t: Tx): number {
  const at = String(t.at);
  const month = new Date(Date.parse(at) + 7 * 3600_000).toISOString().slice(0, 7);
  const r = raw
    .prepare(`INSERT INTO transactions (${COLS.join(", ")}, week_key, month_key, source) VALUES (${COLS.map(() => "?").join(", ")}, 'x', ?, 'manual')`)
    .run(...COLS.map((c) => t[c] ?? null), month);
  return Number(r.lastInsertRowid);
}

/** Tháng 10 của UC-1105 AC-1; trả id khoản bố mẹ chuyển 50.000.000. */
function october(): number {
  const d = (day: number) => `2026-10-${String(day).padStart(2, "0")}T03:00:00.000Z`;
  tx({ at: d(1), amount: 30_000_000, meaning: "income", wallet_id: "income", counter_account_id: "vcb" });
  tx({ at: d(2), amount: 3_000_000, meaning: "income", wallet_id: "income", counter_account_id: "vcb", tenant_id: "t1" });
  tx({ at: d(3), amount: 200_000, meaning: "income", wallet_id: "income", counter_account_id: "phao" });
  tx({ at: d(4), amount: 12_000_000, meaning: "spend", counter_wallet_id: "food", account_id: "vcb", category_id: "an" });
  tx({ at: d(5), amount: 500_000, meaning: "refund", wallet_id: "food", counter_account_id: "vcb" });
  tx({ at: d(6), amount: 3_000_000, meaning: "spend", counter_wallet_id: "have", account_id: "vcb", category_id: "an" });
  tx({ at: d(7), amount: 2_000_000, meaning: "spend", counter_wallet_id: "fun", account_id: "vcb", category_id: "an" });
  tx({ at: d(8), amount: 5_000_000, meaning: "spend", counter_wallet_id: "food", account_id: "vcb", category_id: "an", debt_id: "nha" });
  tx({ at: d(9), amount: 6_000_000, meaning: "buy_asset", wallet_id: "wb", account_id: "vcb", asset_kind: "gold" });
  tx({ at: d(10), amount: 1_000_000, meaning: "lend", account_id: "vcb", receivable_id: "em" });
  tx({ at: d(11), amount: 400_000, meaning: "collect", counter_account_id: "vcb", receivable_id: "em" });
  const parents = tx({ at: d(12), amount: 50_000_000, meaning: "income", wallet_id: "income", counter_account_id: "vcb" });
  tx({ at: d(13), amount: 4_000_000, meaning: "transfer", account_id: "vcb", counter_account_id: "phao" });
  tx({ at: d(14), amount: 100_000, meaning: "adjust", account_id: "vcb" });
  return parents;
}

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string; field?: string } };
async function call<T>(method: string, path: string, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}
const cashFlow = async (period: string) => (await call<CashFlow>("GET", `/v1/reports/cash-flow?period=${period}`)).json.data;
const statement = async (period: string) => (await call<IncomeStatement>("GET", `/v1/reports/income-statement?period=${period}`)).json.data;
const groupTotals = (cf: CashFlow) => Object.fromEntries(cf.groups.map((g) => [g.group, g.total]));
const lines = (cf: CashFlow) => Object.fromEntries(cf.groups.flatMap((g) => g.lines.map((l) => [l.line, l.total])));
const books = () => Number((raw.prepare("SELECT SUM(book_balance) AS n FROM v_account_book").get() as { n: number }).n);
const reclassify = (id: number, cls: string) => call<{ reportClass: string }>("PUT", `/v1/transactions/${id}/report-class`, { class: cls });

describe("UC-1105 lưu chuyển tiền", () => {
  it("UC-1105 AC-1 (tháng mẫu): đầu kỳ 12.000.000; Sinh hoạt +16.400.000, Đầu tư −5.800.000, Tài chính +44.400.000; cuối kỳ 67.000.000 = Σ sổ; chuyển VCB → phao không có dòng", async () => {
    const parents = october();
    expect((await reclassify(parents, "financing")).status).toBe(200);
    const cf = await cashFlow("2026-10");
    expect([cf.opening, cf.openedAccounts, cf.closedAccounts, cf.closing]).toEqual([12_000_000, 0, 0, 67_000_000]);
    expect(groupTotals(cf)).toEqual({ operating: 16_400_000, investing: -5_800_000, financing: 44_400_000 });
    expect(lines(cf)).toEqual({
      salary_other: 30_000_000, rental_income: 3_000_000, refund: 500_000, spend_must: -12_000_000, spend_have: -3_000_000, spend_nice: -2_000_000, adjust: -100_000,
      passive_income: 200_000, buy_asset: -6_000_000,
      borrow: 50_000_000, debt_principal: -5_000_000, lend: -1_000_000, collect: 400_000,
    });
    expect(cf.groups.flatMap((g) => g.lines).reduce((s, l) => s + l.count, 0)).toBe(13);
    expect(cf.closing).toBe(books());
    expect(cf.creditCardDebt).toBe(0);
  });

  it("UC-1105 AC-2 (phân loại lại chỉ đổi báo cáo): Sinh hoạt −50.000.000, Tài chính +50.000.000, cuối kỳ không đổi; ví, sổ không đổi; nhật ký; DELETE về mặc định; passive_income cho khoản chi → invalid_class", async () => {
    const parents = october();
    const before = await cashFlow("2026-10");
    expect(lines(before).salary_other).toBe(80_000_000);
    const wallets = () => raw.prepare("SELECT * FROM v_wallet_balance ORDER BY wallet_id").all();
    const [walletsBefore, booksBefore] = [wallets(), books()];
    await reclassify(parents, "financing");
    const after = await cashFlow("2026-10");
    expect(after.groups[0]!.total - before.groups[0]!.total).toBe(-50_000_000);
    expect(after.groups[2]!.total - before.groups[2]!.total).toBe(50_000_000);
    expect(after.closing).toBe(before.closing);
    expect([wallets(), books()]).toEqual([walletsBefore, booksBefore]);
    expect(raw.prepare("SELECT action, target FROM audit_log WHERE action LIKE 'report_class.%'").all()).toEqual([{ action: "report_class.set", target: `tx:${parents}` }]);
    expect((await call("DELETE", `/v1/transactions/${parents}/report-class`)).status).toBe(200);
    expect(lines(await cashFlow("2026-10")).salary_other).toBe(80_000_000);
    const spend = raw.prepare("SELECT id FROM transactions WHERE meaning = 'spend' LIMIT 1").get() as { id: number };
    const bad = await reclassify(spend.id, "passive_income");
    expect([bad.status, bad.json.error?.code]).toEqual([400, "invalid_class"]);
    const transfer = raw.prepare("SELECT id FROM transactions WHERE meaning = 'transfer'").get() as { id: number };
    expect((await reclassify(transfer.id, "operating")).json.error?.code).toBe("not_cash_flow");
  });

  it("UC-1105 AC-3 (kỳ năm, tài khoản mở trong kỳ, không ngày mở): đầu kỳ 1.000.000; mở trong kỳ +14.000.000; cuối kỳ 70.000.000 = Σ sổ hôm nay; danh sách tháng 9, 10, 11", async () => {
    const parents = october();
    await reclassify(parents, "financing");
    raw.exec(`INSERT INTO accounts (id, name, kind, opening_balance, opened_at) VALUES ('tien-mat', 'Tiền mặt', 'cash', 2000000, '2026-10-05'), ('vi-cu', 'Ví cũ', 'cash', 1000000, NULL)`);
    const cf = await cashFlow("2026");
    expect([cf.opening, cf.openedAccounts, cf.closing]).toEqual([1_000_000, 14_000_000, 70_000_000]);
    expect(groupTotals(cf)).toEqual({ operating: 16_400_000, investing: -5_800_000, financing: 44_400_000 });
    expect(cf.closing).toBe(books());
    expect(cf.months!.map(({ month, opening, openedAccounts, closing }) => ({ month, opening, openedAccounts, closing }))).toEqual([
      { month: "2026-09", opening: 1_000_000, openedAccounts: 12_000_000, closing: 13_000_000 },
      { month: "2026-10", opening: 13_000_000, openedAccounts: 2_000_000, closing: 70_000_000 },
      { month: "2026-11", opening: 70_000_000, openedAccounts: 0, closing: 70_000_000 },
    ]);
  });

  it("UC-1105 AC-4 (lô chỉ là ghi chú): lô vàng 2 chỉ × 5.100.000 ngày 15/10 → ghi chú 10.200.000; ba nhóm và cuối kỳ không đổi", async () => {
    october();
    const before = await cashFlow("2026-10");
    raw.exec(`INSERT INTO balance_items (id, name, section, pyramid, measure, unit) VALUES ('vang', 'Vàng', 'A1', 'protective', 'units', 'chỉ');
      INSERT INTO balance_lots (item_id, bought_on, quantity_milli, unit_cost) VALUES ('vang', '2026-10-15', 2000, 5100000)`);
    const after = await cashFlow("2026-10");
    expect(after.lotNote).toEqual({ bought: 10_200_000, sold: 0 });
    expect([groupTotals(after), after.closing]).toEqual([groupTotals(before), before.closing]);
  });

  it("UC-1105 AC-5 (lãi / gốc): trả Vay tiêu dùng tách lãi 300.000 / gốc 2.000.000 → Sinh hoạt Lãi vay −300.000, Tài chính Trả nợ gốc −2.000.000", async () => {
    tx({ at: "2026-11-05T03:00:00.000Z", amount: 300_000, meaning: "spend", counter_wallet_id: "loan-interest", account_id: "vcb", category_id: "loan-interest", interest_debt_id: "vay-tieu-dung" });
    tx({ at: "2026-11-05T03:00:00.000Z", amount: 2_000_000, meaning: "spend", counter_wallet_id: "food", account_id: "vcb", category_id: "an", debt_id: "vay-tieu-dung" });
    const cf = await cashFlow("2026-11");
    expect(lines(cf)).toEqual({ loan_interest: -300_000, debt_principal: -2_000_000 });
  });

  it("UC-1105 AC-6 (thẻ tín dụng): chi 3.000.000 bằng thẻ → Sinh hoạt −3.000.000; cuối kỳ = đầu kỳ − 3.000.000 = Σ sổ (gồm thẻ); creditCardDebt 3.000.000", async () => {
    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance, opened_at, spendable) VALUES ('the', 'Thẻ VCB', 'credit', 0, '2026-09-01', 0)");
    tx({ at: "2026-11-03T03:00:00.000Z", amount: 3_000_000, meaning: "spend", counter_wallet_id: "food", account_id: "the", category_id: "an" });
    const cf = await cashFlow("2026-11");
    expect(groupTotals(cf).operating).toBe(-3_000_000);
    expect(cf.closing).toBe(cf.opening - 3_000_000);
    expect(cf.closing).toBe(books());
    expect(cf.creditCardDebt).toBe(3_000_000);
  });

  it("UC-1105 AC-7 (số câu SQL): báo cáo năm trên DB 24 tháng × 300 giao dịch — 4 câu SQL, không câu nào lặp; vài trăm hàng", async () => {
    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance, opened_at) VALUES ('a2', 'A2', 'cash', 0, '2024-12-01'), ('a3', 'A3', 'credit', 0, '2024-12-01')");
    raw.exec("UPDATE accounts SET opened_at = '2024-12-01' WHERE id IN ('vcb', 'phao')");
    for (let m = 0; m < 24; m++) {
      const month = new Date(Date.UTC(2024, 11 + m, 1)).toISOString().slice(0, 7);
      for (let i = 0; i < 300; i++) {
        const at = `${month}-${String(1 + (i % 28)).padStart(2, "0")}T03:00:00.000Z`;
        if (i % 4 === 0) tx({ at, amount: 100_000 + i, meaning: "income", wallet_id: "income", counter_account_id: i % 8 ? "vcb" : "phao" });
        else if (i % 4 === 1) tx({ at, amount: 20_000 + i, meaning: "spend", counter_wallet_id: ["food", "have", "fun", "tax"][i % 3]!, account_id: i % 2 ? "a2" : "a3", category_id: "an" });
        else if (i % 4 === 2) tx({ at, amount: 50_000 + i, meaning: "transfer", account_id: "vcb", counter_account_id: "a2" });
        else tx({ at, amount: 1_000 + i, meaning: i % 2 ? "lend" : "adjust", account_id: "vcb", receivable_id: i % 2 ? "em" : undefined });
      }
    }
    const seen: string[] = [];
    const base = asD1(raw);
    const counted = { ...base, prepare: (sql: string) => (seen.push(sql), base.prepare(sql)), batch: base.batch.bind(base) } as D1Database;
    const started = performance.now();
    const cf = await getCashFlow(counted, "2026", new Date());
    const ms = performance.now() - started;
    console.info(`[UC-1105 AC-7] cash-flow?period=2026: ${seen.length} câu SQL, ${ms.toFixed(1)} ms (Node, không phải CPU Workers)`);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(cf.months).toHaveLength(11);
    expect(cf.closing).toBe(books());
    for (const m of cf.months!) expect(m.opening + m.openedAccounts + m.closedAccounts + m.operating + m.investing + m.financing, m.month).toBe(m.closing);
  });

  it("UC-1105 AC-8 (tài khoản tắt trong kỳ): MB cũ chi 1.000.000 rồi tắt khi còn 3.000.000 → Sinh hoạt −1.000.000, tắt trong kỳ −3.000.000; cuối kỳ = đầu kỳ − 4.000.000 = Σ sổ; tháng 10 vẫn tính MB cũ", async () => {
    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance, opened_at) VALUES ('mb-cu', 'MB cũ', 'bank', 4000000, '2026-10-01')");
    const octBefore = await cashFlow("2026-10");
    tx({ at: "2026-11-05T03:00:00.000Z", amount: 1_000_000, meaning: "spend", counter_wallet_id: "food", account_id: "mb-cu", category_id: "an" });
    raw.exec("UPDATE accounts SET active = 0, deactivated_at = '2026-11-10' WHERE id = 'mb-cu'");
    const nov = await cashFlow("2026-11");
    expect([groupTotals(nov).operating, nov.closedAccounts]).toEqual([-1_000_000, -3_000_000]);
    expect(nov.closing).toBe(nov.opening - 4_000_000);
    expect(nov.closing).toBe(books());
    const oct = await cashFlow("2026-10");
    expect([oct.openedAccounts, oct.closing]).toEqual([4_000_000, octBefore.closing]);
  });

  it("kỳ sai dạng hoặc sau kỳ hiện tại → 400 invalid_period; dòng giao dịch trả đúng các khoản của dòng (sau phân loại lại)", async () => {
    for (const period of ["2026-12", "2027", "10-2026", ""]) {
      const r = await call("GET", `/v1/reports/cash-flow?period=${period}`);
      expect([r.status, r.json.error?.code], period).toEqual([400, "invalid_period"]);
    }
    const parents = october();
    await reclassify(parents, "financing");
    const list = (await call<ReportTransactions>("GET", "/v1/reports/transactions?period=2026-10&line=borrow")).json.data;
    expect(list.transactions).toMatchObject([{ id: parents, amount: 50_000_000, reportClass: "financing", defaultLine: "salary_other", accountName: "VCB (chồng)" }]);
    expect((await call<ReportTransactions>("GET", "/v1/reports/transactions?period=2026-10&line=salary_other")).json.data.transactions).toHaveLength(1);
  });
});

describe("UC-1106 kết quả thu chi", () => {
  it("UC-1106 AC-1: Thu nhập 33.200.000, Chi tiêu 16.500.000 (Must 11.500.000 sau hoàn), Để dành 16.700.000, tỷ lệ 50,3%; chân: gốc 5.000.000, mua tài sản 6.000.000, xếp lại Tài chính 50.000.000, điều chỉnh −100.000", async () => {
    await reclassify(october(), "financing");
    const s = await statement("2026-10");
    expect(s.income).toEqual({
      total: 33_200_000,
      lines: [
        { line: "salary_other", label: "Lương và thu khác", total: 30_000_000 },
        { line: "rental_income", label: "Cho thuê lại", total: 3_000_000 },
        { line: "passive_income", label: "Thu nhập thụ động", total: 200_000 },
      ],
    });
    expect(s.expense.total).toBe(16_500_000);
    expect(Object.fromEntries(s.expense.lines.map((l) => [l.line, l.total]))).toEqual({ must: 11_500_000, have: 3_000_000, nice: 2_000_000, tax: 0, wealth_building: 0, other: 0 });
    expect([s.savings, s.savingsRate]).toEqual([16_700_000, 50.3]);
    expect(s.excluded).toEqual({ debtPrincipal: 5_000_000, buyAsset: 6_000_000, reclassifiedInvesting: 0, reclassifiedFinancing: 50_000_000, adjust: -100_000 });
  });

  it("UC-1106 AC-2: chi 1.000.000 từ ví Thuế → dòng Thuế đã nộp 1.000.000, Chi tiêu 17.500.000, Để dành 15.700.000", async () => {
    await reclassify(october(), "financing");
    tx({ at: "2026-10-20T03:00:00.000Z", amount: 1_000_000, meaning: "spend", counter_wallet_id: "tax", account_id: "vcb", category_id: "an" });
    const s = await statement("2026-10");
    expect(s.expense.lines.find((l) => l.line === "tax")!.total).toBe(1_000_000);
    expect([s.expense.total, s.savings]).toEqual([17_500_000, 15_700_000]);
  });

  it("UC-1106 AC-3 (lãi vay là chi phí): tháng 11 Must có dòng con Lãi vay 300.000; 2.000.000 gốc chỉ ở chân", async () => {
    tx({ at: "2026-11-05T03:00:00.000Z", amount: 300_000, meaning: "spend", counter_wallet_id: "loan-interest", account_id: "vcb", category_id: "loan-interest", interest_debt_id: "vay-tieu-dung" });
    tx({ at: "2026-11-05T03:00:00.000Z", amount: 2_000_000, meaning: "spend", counter_wallet_id: "food", account_id: "vcb", category_id: "an", debt_id: "vay-tieu-dung" });
    const s = await statement("2026-11");
    expect(s.expense.lines[0]).toEqual({ line: "must", label: "Must", total: 300_000, children: [{ line: "loan_interest", label: "Lãi vay", total: 300_000 }] });
    expect([s.expense.total, s.excluded.debtPrincipal, s.savingsRate]).toEqual([300_000, 2_000_000, null]);
  });
});

describe("ledger UC-102, access UC-506: phân loại lại theo khoản sửa; ngày mở sổ không lùi qua giao dịch", () => {
  it("UC-102 AC-19: sửa khoản income 50.000.000 đã xếp Tài chính thành 45.000.000 → dòng mới mang phân loại, Tài chính Vay, nhận tiền +45.000.000", async () => {
    const parents = october();
    await reclassify(parents, "financing");
    const r = await call<{ tx: { id: number } }>("POST", `/v1/transactions/${parents}/replace`, { meaning: "income", amount: 45_000_000, account_id: "vcb", at: "2026-10-12T03:00:00.000Z" });
    expect(r.status, JSON.stringify(r.json.error)).toBe(201);
    expect(raw.prepare("SELECT transaction_id, report_class FROM transaction_report_classes ORDER BY transaction_id").all()).toEqual([
      { transaction_id: parents, report_class: "financing" },
      { transaction_id: r.json.data.tx.id, report_class: "financing" },
    ]);
    expect(lines(await cashFlow("2026-10")).borrow).toBe(45_000_000);
  });

  it("UC-506 AC-24: giao dịch sớm nhất 15/9 → đổi ngày mở sổ sang 1/10 bị 409 opening_after_entries; 15/9, 1/8, null lưu được; huỷ giao dịch trước 1/10 rồi đổi lại → lưu", async () => {
    const early = tx({ at: "2026-09-15T03:00:00.000Z", amount: 100_000, meaning: "spend", counter_wallet_id: "food", account_id: "vcb", category_id: "an" });
    const patch = (opened_at: string | null) => call<{ opened_at: string | null }>("PATCH", "/v1/settings/accounts/vcb", { opened_at });
    const bad = await patch("2026-10-01");
    expect([bad.status, bad.json.error?.code, bad.json.error?.message]).toEqual([
      409,
      "opening_after_entries",
      "Tài khoản đã có giao dịch từ 15/9/2026 — huỷ hoặc sửa các giao dịch trước 1/10/2026 trước, hoặc chọn ngày mở sổ từ 15/9/2026 trở về trước.",
    ]);
    expect((raw.prepare("SELECT opened_at FROM accounts WHERE id = 'vcb'").get() as { opened_at: string }).opened_at).toBe("2026-09-01");
    for (const d of ["2026-09-15", "2026-08-01", null]) expect((await patch(d)).json.data.opened_at, String(d)).toBe(d);
    raw.prepare("UPDATE transactions SET status = 'void' WHERE id = ?").run(early);
    expect((await patch("2026-10-01")).json.data.opened_at).toBe("2026-10-01");
  });
});
