// Lưu chuyển tiền, Kết quả thu chi, phân loại lại — lát 2 của change 261008-bang-can-doi; dòng chi theo nhóm Thiết yếu và
// ngăn (261112-ba-ngan-nhin-lai, ADR-128).
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CashFlow, IncomeStatement } from "../src/domain/reports";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { assignLog } from "../src/services/ingest";
import { getCashFlow } from "../src/services/reports";
import type { ReportTransactions, Snapshot } from "../web/src/lib/types";
import { asD1 } from "./helpers/d1-sqlite";
import { client } from "./helpers/household-c";
import { D_NOW, householdD } from "./helpers/household-d";
import { householdShared, SHARED_NOW } from "./helpers/household-shared";
import { legacyEmptyDb, upgradingD1 } from "./helpers/legacy";

let raw: DatabaseSync;
let env: Env;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T05:00:00.000Z"));
  // Lịch sử trước v2 (giao dịch trừ ví): nạp vào DB 1.38, app lên 1.40 ở câu đầu tiên (0039 + 0040, ADR-123, ADR-131).
  raw = legacyEmptyDb();
  raw.exec(`
    INSERT INTO accounts (id, name, kind, opening_balance, opened_at, role, pocket, pocket_confirmed) VALUES
      ('vcb', 'VCB (chồng)', 'bank', 12000000, '2026-09-01', NULL, 'operating', 1),
      ('phao', 'Phao', 'bank', 0, '2026-09-01', 'buffer', 'reserve', 1);
    INSERT INTO wallets (id, name, tier, must_group, kind, account_id, sort) VALUES
      ('income', 'Thu nhập', 'holding', NULL, 'holding', 'vcb', 0),
      ('wb', 'Tích sản', 'wealth_building', NULL, 'accrual', 'vcb', 10),
      ('tax', 'Thuế', 'tax', NULL, 'accrual', 'vcb', 20),
      ('fun', 'Hưởng thụ', 'nice', NULL, 'envelope', 'vcb', 30),
      ('food', 'Ăn uống', 'must', 'must', 'envelope', 'vcb', 40),
      ('have', 'Có thì tốt', 'must', 'have', 'envelope', 'vcb', 50);
    UPDATE wallets SET account_id = 'vcb' WHERE id = 'loan-interest';
    INSERT INTO category_groups (id, name, essential, sort) VALUES ('g-an', 'Ăn uống', 1, 1), ('g-mua', 'Mua sắm', 0, 2);
    INSERT INTO categories (id, name, default_wallet_id, group_id) VALUES ('an', 'Ăn', 'food', 'g-an'), ('mua', 'Mua đồ', 'have', 'g-mua');
    INSERT INTO tenants (id, name) VALUES ('t1', 'Người thuê');
    INSERT INTO debts (id, name) VALUES ('nha', 'Vay người nhà');
    INSERT INTO debts (id, name, interest_rate_bps) VALUES ('vay-tieu-dung', 'Vay tiêu dùng', 1800);
    INSERT INTO receivables (id, name) VALUES ('em', 'Em');`);
  env = { DB: upgradingD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.useRealTimers());

type Tx = Partial<Record<
  "at" | "amount" | "meaning" | "wallet_id" | "counter_wallet_id" | "account_id" | "counter_account_id" | "category_id" | "tenant_id" | "debt_id" | "interest_debt_id" | "receivable_id" | "asset_kind" | "link_id" | "income_stream_id",
  string | number
>>;
/**
 * Ghi thẳng một giao dịch ghi tay; month_key theo giờ VN của `at`. Chỉ ghi các cột được truyền — cột ví chỉ có trước khi app
 * lên 1.40 (khoản cũ), sau đó khoản mới không ví.
 */
function tx(t: Tx): number {
  const at = String(t.at);
  const month = new Date(Date.parse(at) + 7 * 3600_000).toISOString().slice(0, 7);
  const cols = Object.keys(t) as (keyof Tx)[];
  const r = raw
    .prepare(`INSERT INTO transactions (${cols.join(", ")}, week_key, month_key, source) VALUES (${cols.map(() => "?").join(", ")}, 'x', ?, 'manual')`)
    .run(...cols.map((c) => t[c] ?? null), month);
  return Number(r.lastInsertRowid);
}

/** Tháng 10 của UC-1105 AC-1 (lịch sử trước v2, giao dịch trừ ví); trả id khoản bố mẹ chuyển 50.000.000. */
function october(): number {
  const d = (day: number) => `2026-10-${String(day).padStart(2, "0")}T03:00:00.000Z`;
  tx({ at: d(1), amount: 30_000_000, meaning: "income", wallet_id: "income", counter_account_id: "vcb" });
  tx({ at: d(2), amount: 3_000_000, meaning: "income", wallet_id: "income", counter_account_id: "vcb", tenant_id: "t1" });
  tx({ at: d(3), amount: 200_000, meaning: "income", wallet_id: "income", counter_account_id: "phao" });
  const food = tx({ at: d(4), amount: 12_000_000, meaning: "spend", counter_wallet_id: "food", account_id: "vcb", category_id: "an" });
  tx({ at: d(5), amount: 500_000, meaning: "refund", wallet_id: "food", counter_account_id: "vcb", link_id: food });
  // Phe ví (Có thì tốt, Hưởng thụ) không còn được đọc: danh mục nhóm Mong muốn quyết dòng.
  tx({ at: d(6), amount: 3_000_000, meaning: "spend", counter_wallet_id: "have", account_id: "vcb", category_id: "mua" });
  tx({ at: d(7), amount: 2_000_000, meaning: "spend", counter_wallet_id: "fun", account_id: "vcb", category_id: "mua" });
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
const snapshot = async () => (await call<Snapshot>("GET", "/v1/snapshot")).json.data;

describe("UC-1105 lưu chuyển tiền", () => {
  it("UC-1105 AC-1 (tháng mẫu): đầu kỳ 12.000.000; Sinh hoạt +16.400.000 (Chi thiết yếu −12.000.000, Hoàn tiền +500.000, Chi mong muốn −5.000.000), Đầu tư −5.800.000, Tài chính +44.400.000; cuối kỳ 67.000.000 = Σ sổ; chuyển VCB → phao không có dòng", async () => {
    const parents = october();
    expect((await reclassify(parents, "financing")).status).toBe(200);
    const cf = await cashFlow("2026-10");
    expect([cf.opening, cf.openedAccounts, cf.closedAccounts, cf.closing]).toEqual([12_000_000, 0, 0, 67_000_000]);
    expect(groupTotals(cf)).toEqual({ operating: 16_400_000, investing: -5_800_000, financing: 44_400_000 });
    expect(lines(cf)).toEqual({
      salary_other: 30_000_000, rental_income: 3_000_000, refund: 500_000, spend_essential: -12_000_000, spend_flex: -5_000_000, adjust: -100_000,
      passive_income: 200_000, buy_asset: -6_000_000,
      borrow: 50_000_000, debt_principal: -5_000_000, lend: -1_000_000, collect: 400_000,
    });
    expect(cf.groups.flatMap((g) => g.lines).reduce((s, l) => s + l.count, 0)).toBe(13);
    expect(cf.closing).toBe(books());
    expect(cf.creditCardDebt).toBe(0);
  });

  it("UC-1105 AC-2 (phân loại lại chỉ đổi báo cáo): Sinh hoạt −50.000.000, Tài chính +50.000.000, cuối kỳ không đổi; số dư tài khoản, ngăn, snapshot không đổi; nhật ký; DELETE về mặc định; passive_income cho khoản chi → invalid_class", async () => {
    const parents = october();
    const before = await cashFlow("2026-10");
    expect(lines(before).salary_other).toBe(80_000_000);
    const [snapBefore, booksBefore] = [await snapshot(), books()];
    await reclassify(parents, "financing");
    const after = await cashFlow("2026-10");
    expect(after.groups[0]!.total - before.groups[0]!.total).toBe(-50_000_000);
    expect(after.groups[2]!.total - before.groups[2]!.total).toBe(50_000_000);
    expect(after.closing).toBe(before.closing);
    const snapAfter = await snapshot();
    expect([snapAfter.pockets, snapAfter, books()]).toEqual([snapBefore.pockets, snapBefore, booksBefore]);
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
    await cashFlow("2026"); // app lên 1.40 trước khi đếm câu SQL
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
    tx({ at: "2026-11-05T03:00:00.000Z", amount: 1_000_000, meaning: "spend", account_id: "mb-cu", category_id: "an" });
    raw.exec("UPDATE accounts SET active = 0, deactivated_at = '2026-11-10' WHERE id = 'mb-cu'");
    const nov = await cashFlow("2026-11");
    expect([groupTotals(nov).operating, nov.closedAccounts]).toEqual([-1_000_000, -3_000_000]);
    expect(nov.closing).toBe(nov.opening - 4_000_000);
    expect(nov.closing).toBe(books());
    const oct = await cashFlow("2026-10");
    expect([oct.openedAccounts, oct.closing]).toEqual([4_000_000, octBefore.closing]);
  });

  it("UC-1105 AC-10 (một luật cho khoản cũ và mới): Chi thiết yếu −9.700.000 (khoản cũ trả từ tài khoản nay thuộc Tích luỹ vẫn ở Thiết yếu), Thuế đã nộp −2.000.000, Chi từ Tích luỹ −600.000 (hoàn 200.000 cộng ngược, không vào Mong muốn); thu 37 không nguồn vào Dự phòng là thu nhập thụ động; lương có nguồn vào Dự phòng ở Lương và thu khác", async () => {
    const nov = (day: number) => `2026-11-${String(day).padStart(2, "0")}T03:00:00.000Z`;
    raw.exec(`
      INSERT INTO accounts (id, name, kind, opening_balance, opened_at, pocket, pocket_confirmed) VALUES
        ('tich-luy', 'Tài khoản tích luỹ', 'bank', 5000000, '2026-09-01', 'savings', 1),
        ('tiet-kiem', 'Tài khoản tiết kiệm', 'bank', 20000000, '2026-09-01', 'reserve', 1),
        ('tk-thue', 'Tài khoản thuế', 'bank', 2000000, '2026-09-01', 'reserve', 1);
      INSERT INTO categories (id, name, group_id) VALUES ('hoc-phi', 'Học phí', 'g-an'), ('thue', 'Nộp thuế', NULL);
      INSERT INTO income_streams (id, name, sort) VALUES ('luong', 'Lương', 1);`);
    // Khoản cũ (trừ ví, trước v2) → legacy_class ở 0040. Khoản chi không danh mục không còn tồn tại từ 1.39 (CHECK của 0039
    // bắt danh mục cho mọi khoản chi, kể cả lịch sử) — vế "Chi khác −100.000" của AC không dựng được trên dữ liệu thật.
    tx({ at: nov(1), amount: 1_000_000, meaning: "spend", counter_wallet_id: "food", account_id: "vcb", category_id: "an" });
    tx({ at: nov(2), amount: 500_000, meaning: "spend", counter_wallet_id: "tax", account_id: "vcb", category_id: "an" });
    tx({ at: nov(3), amount: 700_000, meaning: "spend", counter_wallet_id: "food", account_id: "tich-luy", category_id: "an" });
    await cashFlow("2026-11"); // app lên 1.40
    expect(raw.prepare("SELECT legacy_class FROM transactions ORDER BY id").all()).toEqual([{ legacy_class: "essential" }, { legacy_class: "tax" }, { legacy_class: "essential" }]);
    // Khoản mới (không ví): mục tiêu Dự phòng là tài khoản thật.
    raw.exec(`INSERT INTO reserve_goals (id, name, account_id, target_amount, target_pct) VALUES
      ('hoc-phi', 'Học phí', 'tiet-kiem', 6000000, NULL), ('thue', 'Thuế', 'tk-thue', NULL, 10);`);
    tx({ at: nov(4), amount: 2_000_000, meaning: "spend", account_id: "vcb", category_id: "an" });
    tx({ at: nov(5), amount: 6_000_000, meaning: "spend", account_id: "tiet-kiem", category_id: "hoc-phi" });
    tx({ at: nov(5), amount: 1_500_000, meaning: "spend", account_id: "tk-thue", category_id: "thue" });
    const bought = tx({ at: nov(6), amount: 800_000, meaning: "spend", account_id: "tich-luy", category_id: "mua" });
    tx({ at: nov(7), amount: 200_000, meaning: "refund", counter_account_id: "tich-luy", category_id: "mua", link_id: bought });
    tx({ at: nov(9), amount: 37, meaning: "income", counter_account_id: "tiet-kiem" });
    tx({ at: nov(10), amount: 20_000_000, meaning: "income", counter_account_id: "tiet-kiem", income_stream_id: "luong" });
    const l = lines(await cashFlow("2026-11"));
    expect(l).toMatchObject({ spend_essential: -9_700_000, spend_tax: -2_000_000, spend_savings: -600_000, passive_income: 37, salary_other: 20_000_000 });
    expect([l.spend_flex, l.refund, l.spend_other]).toEqual([undefined, undefined, undefined]);
  });

  it("UC-110 AC-8 (vế báo cáo): ví Thuế cũ ở X rồi gắn mục tiêu Thuế vào X — khoản cũ chỉ theo legacy_class, khoản chi Ăn uống cũ từ X ở Thiết yếu, không ở Thuế đã nộp", async () => {
    const nov = (day: number) => `2026-11-${String(day).padStart(2, "0")}T03:00:00.000Z`;
    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance, opened_at, pocket, pocket_confirmed) VALUES ('x', 'Tài khoản X', 'bank', 2000000, '2026-09-01', 'reserve', 1)");
    tx({ at: nov(1), amount: 1_000_000, meaning: "transfer", account_id: "vcb", counter_account_id: "x" });
    tx({ at: nov(2), amount: 400_000, meaning: "spend", counter_wallet_id: "tax", account_id: "x", category_id: "an" });
    tx({ at: nov(3), amount: 100_000, meaning: "spend", counter_wallet_id: "food", account_id: "x", category_id: "an" });
    await cashFlow("2026-11"); // app lên 1.40
    raw.exec("INSERT INTO reserve_goals (id, name, account_id, target_pct) VALUES ('thue', 'Thuế', 'x', 10)");
    tx({ at: nov(5), amount: 300_000, meaning: "transfer", account_id: "vcb", counter_account_id: "x" });
    tx({ at: nov(6), amount: 200_000, meaning: "spend", account_id: "x", category_id: "an" });
    expect(lines(await cashFlow("2026-11"))).toEqual({ spend_tax: -600_000, spend_essential: -100_000 });
    const s = await statement("2026-11");
    expect(s.expense.lines.map((l) => [l.line, l.total])).toEqual([
      ["essential", 100_000],
      ["flex", 0],
      ["tax", 600_000],
      ["savings", 0],
      ["other", 0],
    ]);
  });

  it("kỳ sai dạng hoặc sau kỳ hiện tại → 400 invalid_period; dòng giao dịch trả đúng các khoản của dòng (sau phân loại lại)", async () => {
    const parents = october();
    for (const period of ["2026-12", "2027", "10-2026", ""]) {
      const r = await call("GET", `/v1/reports/cash-flow?period=${period}`);
      expect([r.status, r.json.error?.code], period).toEqual([400, "invalid_period"]);
    }
    await reclassify(parents, "financing");
    const list = (await call<ReportTransactions>("GET", "/v1/reports/transactions?period=2026-10&line=borrow")).json.data;
    expect(list.transactions).toMatchObject([{ id: parents, amount: 50_000_000, reportClass: "financing", defaultLine: "salary_other", accountName: "VCB (chồng)", groupName: null }]);
    expect((await call<ReportTransactions>("GET", "/v1/reports/transactions?period=2026-10&line=salary_other")).json.data.transactions).toHaveLength(1);
    // Khoản chi kể nhóm danh mục (không còn tên ví).
    const flex = (await call<ReportTransactions>("GET", "/v1/reports/transactions?period=2026-10&line=spend_flex")).json.data.transactions;
    expect(flex.map((t) => [t.amount, t.groupName])).toEqual([[-2_000_000, "Mua sắm"], [-3_000_000, "Mua sắm"]]);
    expect(flex[0]).not.toHaveProperty("walletName");
  });
});

describe("UC-1106 kết quả thu chi", () => {
  it("UC-1106 AC-1: Thu nhập 33.200.000, Chi tiêu 16.500.000 (Thiết yếu 11.500.000 sau hoàn, Mong muốn 5.000.000), Để dành 16.700.000, tỷ lệ 50,3%; chân: gốc 5.000.000, mua tài sản 6.000.000, xếp lại Tài chính 50.000.000, điều chỉnh −100.000", async () => {
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
    expect(s.expense.lines.map((l) => [l.line, l.label, l.total])).toEqual([
      ["essential", "Thiết yếu", 11_500_000],
      ["flex", "Mong muốn", 5_000_000],
      ["tax", "Thuế đã nộp", 0],
      ["savings", "Chi từ Tích luỹ", 0],
      ["other", "Khác", 0],
    ]);
    expect(s.expense.lines[0]!.children).toEqual([
      { line: "group:g-an", label: "Ăn uống", total: 11_500_000 },
      { line: "loan_interest", label: "Lãi vay", total: 0 },
    ]);
    expect(s.expense.lines[1]!.children).toEqual([{ line: "group:g-mua", label: "Mua sắm", total: 5_000_000 }]);
    expect([s.savings, s.savingsRate]).toEqual([16_700_000, 50.3]);
    expect(s.excluded).toEqual({ debtPrincipal: 5_000_000, buyAsset: 6_000_000, reclassifiedInvesting: 0, reclassifiedFinancing: 50_000_000, adjust: -100_000 });
  });

  it("UC-1106 AC-2: chi 1.000.000 từ tài khoản của mục tiêu Thuế → dòng Thuế đã nộp 1.000.000, Chi tiêu 17.500.000, Để dành 15.700.000", async () => {
    const parents = october();
    await reclassify(parents, "financing"); // app lên 1.40
    raw.exec("INSERT INTO reserve_goals (id, name, account_id, target_pct) VALUES ('thue', 'Thuế', 'phao', 10)");
    tx({ at: "2026-10-20T03:00:00.000Z", amount: 1_000_000, meaning: "spend", account_id: "phao", category_id: "an" });
    const s = await statement("2026-10");
    expect(s.expense.lines.find((l) => l.line === "tax")!.total).toBe(1_000_000);
    expect([s.expense.total, s.savings]).toEqual([17_500_000, 15_700_000]);
  });

  it("UC-1106 AC-3 (lãi vay là chi phí): tháng 11 Thiết yếu có dòng con Lãi vay 300.000; 2.000.000 gốc chỉ ở chân", async () => {
    tx({ at: "2026-11-05T03:00:00.000Z", amount: 300_000, meaning: "spend", counter_wallet_id: "loan-interest", account_id: "vcb", category_id: "loan-interest", interest_debt_id: "vay-tieu-dung" });
    tx({ at: "2026-11-05T03:00:00.000Z", amount: 2_000_000, meaning: "spend", counter_wallet_id: "food", account_id: "vcb", category_id: "an", debt_id: "vay-tieu-dung" });
    const s = await statement("2026-11");
    expect(s.expense.lines[0]).toEqual({ line: "essential", label: "Thiết yếu", total: 300_000, children: [{ line: "loan_interest", label: "Lãi vay", total: 300_000 }] });
    expect([s.expense.total, s.excluded.debtPrincipal, s.savingsRate]).toEqual([300_000, 2_000_000, null]);
  });

  it("UC-1106 AC-5 (hộ mẫu D, tháng 11): Thiết yếu 9.250.000 — Ăn uống 2.500.000, Đi lại 450.000, Học phí 6.000.000, Lãi vay 300.000; Mong muốn 1.700.000 — Mua sắm 1.200.000, Chưa xếp nhóm 500.000; trả gốc 2.000.000 chỉ ở chân", async () => {
    vi.setSystemTime(D_NOW);
    const s = (await client(householdD())("GET", "/v1/reports/income-statement?period=2026-11")).json.data as IncomeStatement;
    const [essential, flex] = s.expense.lines;
    expect(essential).toEqual({
      line: "essential",
      label: "Thiết yếu",
      total: 9_250_000,
      children: [
        { line: "group:d-food", label: "Ăn uống", total: 2_500_000 },
        { line: "group:d-transport", label: "Đi lại", total: 450_000 },
        { line: "group:d-school", label: "Học phí", total: 6_000_000 },
        { line: "loan_interest", label: "Lãi vay", total: 300_000 },
      ],
    });
    expect(flex).toEqual({
      line: "flex",
      label: "Mong muốn",
      total: 1_700_000,
      children: [
        { line: "group:d-shopping", label: "Mua sắm", total: 1_200_000 },
        { line: "ungrouped", label: "Chưa xếp nhóm", total: 500_000 },
      ],
    });
    expect([s.expense.total, s.excluded.debtPrincipal]).toEqual([10_950_000, 2_000_000]);
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
      "Tài khoản đã có giao dịch từ 15/9/2026: huỷ hoặc sửa giao dịch trước 1/10/2026, hoặc chọn ngày mở sổ từ 15/9/2026 trở về trước.",
    ]);
    expect((raw.prepare("SELECT opened_at FROM accounts WHERE id = 'vcb'").get() as { opened_at: string }).opened_at).toBe("2026-09-01");
    for (const d of ["2026-09-15", "2026-08-01", null]) expect((await patch(d)).json.data.opened_at, String(d)).toBe(d);
    raw.prepare("UPDATE transactions SET status = 'void' WHERE id = ?").run(early);
    expect((await patch("2026-10-01")).json.data.opened_at).toBe("2026-10-01");
  });
});

describe("lãi tiền gửi ở Kết quả thu chi (261018-lai-tien-gui)", () => {
  it("UC-1106: tháng có lương 30.000.000 và ba khoản lãi 68 + 50 + 37 (tài khoản thường) → Lương và thu khác 30.000.000, Thu nhập thụ động 155", async () => {
    tx({ at: "2026-10-01T03:00:00.000Z", amount: 30_000_000, meaning: "income", wallet_id: "income", counter_account_id: "vcb" });
    for (const [id, amount] of [["l1", 68], ["l2", 50], ["l3", 37]] as const) {
      raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES (?, '2026-10-17T17:07:00.000Z', ?, 'in', 'vcb', 'BankAPINotify', 'pending')").run(id, amount);
      await assignLog(env.DB, id, [{ meaning: "income", amount, interest: true }], null, new Date());
    }
    const s = await statement("2026-10");
    expect(s.income).toEqual({
      total: 30_000_155,
      lines: [
        { line: "salary_other", label: "Lương và thu khác", total: 30_000_000 },
        { line: "rental_income", label: "Cho thuê lại", total: 0 },
        { line: "passive_income", label: "Thu nhập thụ động", total: 155 },
      ],
    });
  });
});

describe("đổi phân loại khoản lương sang thu nhập thụ động (pocket UC-1205)", () => {
  it("UC-1205 AC-6: khoản lương 20.000.000 có nhắc trích 2.000.000 → PUT report-class passive_income → nhắc void, is_salary 0; xếp lại financing không đụng nhắc", async () => {
    vi.setSystemTime(SHARED_NOW);
    raw = householdShared({ cycle: false });
    raw.exec("INSERT INTO config (k, v) VALUES ('savings_pct', '10') ON CONFLICT (k) DO UPDATE SET v = excluded.v");
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
    const add = async () => {
      const r = await call<{ tx: { id: number } }>("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "cash-husband", income_stream_id: "salary-husband" });
      expect(r.status).toBe(201);
      return r.json.data.tx.id;
    };
    const state = (id: number) => [
      raw.prepare("SELECT is_salary FROM transactions WHERE id = ?").get(id),
      raw.prepare("SELECT amount, status FROM month_tasks WHERE kind = 'savings' AND income_tx_id = ?").all(id),
    ];

    const salary = await add();
    expect(state(salary)).toEqual([{ is_salary: 1 }, [{ amount: 2_000_000, status: "open" }]]);
    expect((await reclassify(salary, "passive_income")).status).toBe(200);
    expect(state(salary)).toEqual([{ is_salary: 0 }, [{ amount: 2_000_000, status: "void" }]]);
    expect(raw.prepare("SELECT report_class FROM transaction_report_classes WHERE transaction_id = ?").get(salary)).toEqual({ report_class: "passive_income" });

    const other = await add();
    expect((await reclassify(other, "financing")).status).toBe(200);
    expect(state(other)).toEqual([{ is_salary: 1 }, [{ amount: 2_000_000, status: "open" }]]);
  });
});
