// Bảng cân đối, lô tài sản, lãi vay hằng tháng — lát 1 của change 261008-bang-can-doi.
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { interestPart } from "../src/domain/interest";
import type { BalanceSheet, HistoryPoint } from "../src/services/balance";
import type { ItemView } from "../src/domain/balance";
import type { Debt } from "../src/services/debts";
import type { AllocationPlan, Budget, NetWorth, Receivable, SettingsConfig, SettingsData, Snapshot } from "../web/src/lib/types";
import { asD1, openDb, readSql } from "./helpers/d1-sqlite";

type EntryResult = { tx: Record<string, unknown> };

let raw: DatabaseSync;
let env: Env;

/** DB mới chỉ có schema (không hộ mẫu) — số trong AC ghim đúng từng đồng. */
function emptyDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(readSql("docs/schema.sql"));
  return db;
}
function useDb(db: DatabaseSync) {
  raw = db;
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
}
const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-15T05:00:00.000Z");
  useDb(emptyDb());
});
afterEach(() => vi.useRealTimers());

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string; field?: string } };
async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}
const sheet = async (date?: string) => (await call<BalanceSheet>("GET", `/v1/balance-sheet${date ? `?date=${date}` : ""}`)).json.data;
const history = async (months: number) => (await call<{ points: HistoryPoint[] }>("GET", `/v1/balance-sheet/history?months=${months}`)).json.data.points;
const item = async (b: Record<string, unknown>) => {
  const r = await call<ItemView>("POST", "/v1/balance-items", b);
  expect(r.status, JSON.stringify(r.json.error)).toBe(201);
  return r.json.data;
};
const row = (s: BalanceSheet, key: string) => s.assets.flatMap((x) => x.rows).find((r) => r.key === key);
const count = (sql: string) => Number((raw.prepare(sql).get() as { n: number }).n);

/** Vàng như UC-1101 AC-2: hai lô, giá 5.000.000 ngày 1/10 rồi 5.250.000 ngày 1/11. */
async function gold(extra: Record<string, unknown> = {}) {
  await item({ name: "Vàng", section: "A1", pyramid: "protective", measure: "units", unit: "chỉ", ...extra });
  await call("POST", "/v1/balance-items/vang/lots", { bought_on: "2026-03-10", quantity: 20, unit_cost: 5_000_000 });
  await call("POST", "/v1/balance-items/vang/lots", { bought_on: "2026-09-01", quantity: 4, unit_cost: 6_000_000 });
  await call("POST", "/v1/balance-items/vang/values", { as_of: "2026-10-01", unit_price: 5_000_000 });
  return (await call<ItemView>("POST", "/v1/balance-items/vang/values", { as_of: "2026-11-01", unit_price: 5_250_000 })).json.data;
}

/** Bảng mẫu UC-1102 AC-1: tiền 30.000.000, Vàng, Chứng khoán, Đất nền, phải thu 5.000.000, hai khoản nợ. */
async function sampleSheet() {
  raw.exec("INSERT INTO accounts (id, name, kind, opening_balance, opened_at) VALUES ('vcb', 'VCB', 'bank', 30000000, '2026-09-01')");
  await gold();
  await item({ name: "Chứng khoán", section: "A2", pyramid: "income", measure: "value", value: 50_000_000, as_of: "2026-09-30", cashflow: 3_000_000, cashflow_period: "year", expected_return: 12 });
  await item({ name: "Đất nền", section: "B3", pyramid: "growth", measure: "value", value: 600_000_000, as_of: "2026-10-01" });
  expect((await call("POST", "/v1/receivables", { name: "Anh Ba", amount: 5_000_000, at: "2026-09-01T03:00:00.000Z" })).status).toBe(201);
  expect((await call("POST", "/v1/debts", { name: "Vay người nhà", amount: 300_000_000, at: "2026-09-01T03:00:00.000Z", term: "long" })).status).toBe(201);
  expect((await call("POST", "/v1/debts", { name: "Vay tiêu dùng", amount: 20_000_000, at: "2026-09-01T03:00:00.000Z", interest_rate: 18, term: "short" })).status).toBe(201);
}

describe("UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ", () => {
  it("UC-1101 AC-1: thêm Đất nền B3 theo giá trị → id dat-nen, tiền lỏng tắt, tài sản đầu tư bật, một dòng định giá, có ở B3", async () => {
    const d = await item({ name: "Đất nền", section: "B3", pyramid: "growth", measure: "value", value: 600_000_000, as_of: "2026-10-01" });
    expect(d).toMatchObject({ id: "dat-nen", liquid: false, investable: true, present: true, value: 600_000_000 });
    expect(d.values).toHaveLength(1);
    const s = await sheet();
    expect(s.assets.find((x) => x.section === "B3")!.rows).toMatchObject([{ key: "item:dat-nen", name: "Đất nền", value: 600_000_000 }]);
  });

  it("UC-1101 AC-2 (lô): Vàng 24 chỉ × 5.250.000 = 126.000.000; lô 1 +5.000.000 (+5,0%), lô 2 −3.000.000 (−12,5%); vốn 124.000.000, lãi chưa chốt +2.000.000 (+1,6%)", async () => {
    const v = await gold();
    expect(v).toMatchObject({ id: "vang", liquid: true, value: 126_000_000, unitPrice: 5_250_000, heldQuantityMilli: 24_000, cost: 124_000_000, unrealized: 2_000_000, unrealizedPct: 1.6 });
    expect(v.lots.map((l) => [l.position!.pnl, l.position!.pnlPct])).toEqual([[5_000_000, 5], [-3_000_000, -12.5]]);
  });

  it("UC-1101 AC-3 (giá theo ngày): ghi giá ngày cũ hơn không thắng; huỷ dòng mới nhất → giá trước đó; chưa có giá → lô theo giá mua", async () => {
    await gold();
    expect((await call<ItemView>("POST", "/v1/balance-items/vang/values", { as_of: "2026-10-20", unit_price: 5_200_000 })).json.data.unitPrice).toBe(5_250_000);
    const latest = (await sheet()).items.find((i) => i.id === "vang")!.values.find((v) => v.asOf === "2026-11-01")!;
    const after = (await call<ItemView>("POST", `/v1/balance-values/${latest.id}/void`)).json.data;
    expect(after).toMatchObject({ unitPrice: 5_200_000, value: 124_800_000 });
    await item({ name: "Vàng nhẫn", section: "A1", pyramid: "protective", measure: "units", unit: "chỉ" });
    const ring = (await call<ItemView>("POST", "/v1/balance-items/vang-nhan/lots", { bought_on: "2026-10-01", quantity: 2, unit_cost: 5_000_000 })).json.data;
    expect(ring).toMatchObject({ unitPrice: null, value: 10_000_000 });
  });

  it("UC-1101 AC-4 (bán lô): bán lô 2 → còn 105.000.000, lãi lỗ đã chốt −2.800.000; điểm 31/10 vẫn tính hai lô; bán lần nữa → invalid_sale; không có giao dịch", async () => {
    await sampleSheet();
    const lot2 = (await sheet()).items.find((i) => i.id === "vang")!.lots[1]!;
    const sold = (await call<ItemView>("POST", `/v1/balance-lots/${lot2.id}/sell`, { sold_on: "2026-11-10", sold_unit_price: 5_300_000 })).json.data;
    expect(sold.value).toBe(105_000_000);
    expect(sold.lots.find((l) => l.id === lot2.id)).toMatchObject({ held: false, realized: -2_800_000, position: null });
    expect((await history(2))[0]).toMatchObject({ month: "2026-10", totalAssets: 805_000_000 });
    expect((await call("POST", `/v1/balance-lots/${lot2.id}/sell`, { sold_on: "2026-11-11", sold_unit_price: 1 })).json.error?.code).toBe("invalid_sale");
    expect(count("SELECT COUNT(*) AS n FROM transactions")).toBe(0);
  });

  it("UC-1101 AC-5: dòng tiền 3.000.000 kỳ Năm → 250.000/tháng, kỳ vọng 12%/năm; dòng tiền không kèm kỳ → missing_period", async () => {
    const ck = await item({ name: "Chứng khoán", section: "A2", pyramid: "income", measure: "value", value: 50_000_000, cashflow: 3_000_000, cashflow_period: "year", expected_return: 12 });
    expect(ck).toMatchObject({ cashflow: 3_000_000, cashflowPeriod: "year", cashflowMonthly: 250_000, expectedReturnBps: 1200 });
    expect(row(await sheet(), "item:chung-khoan")).toMatchObject({ cashflowMonthly: 250_000, expectedReturnBps: 1200 });
    const bad = await call("POST", "/v1/balance-items/chung-khoan/values", { value: 50_000_000, cashflow: 3_000_000 });
    expect([bad.status, bad.json.error?.code]).toEqual([400, "missing_period"]);
  });

  it("UC-1101 AC-6: mọi thao tác ở màn tài sản không đổi giao dịch, ví, số dư, còn để chi, Tích sản; mỗi thao tác một dòng nhật ký", async () => {
    useDb(openDb());
    const snapBefore = (await call("GET", "/v1/snapshot")).json.data;
    const txBefore = count("SELECT COUNT(*) AS n FROM transactions");
    const auditBefore = count("SELECT COUNT(*) AS n FROM audit_log");
    const v = await gold();
    await call("PATCH", `/v1/balance-lots/${v.lots[0]!.id}`, { take_profit_price: 5_500_000, stop_loss_price: 4_800_000 });
    await call("POST", `/v1/balance-lots/${v.lots[1]!.id}/sell`, { sold_on: "2026-11-10", sold_unit_price: 5_300_000 });
    await call("POST", `/v1/balance-lots/${v.lots[0]!.id}/void`);
    await item({ name: "Đất nền", section: "B3", pyramid: "growth", measure: "value", value: 600_000_000 });
    await call("PATCH", "/v1/balance-items/dat-nen", { take_profit_value: 800_000_000 });
    await item({ name: "Nháp", section: "B6", pyramid: "fixed", measure: "value" });
    expect((await call("DELETE", "/v1/balance-items/nhap")).status).toBe(200);
    expect((await call("GET", "/v1/snapshot")).json.data).toEqual(snapBefore);
    expect(count("SELECT COUNT(*) AS n FROM transactions")).toBe(txBefore);
    // gold(): thêm mục + 2 lô + 2 giá = 5; đặt giá, bán, huỷ lô = 3; Đất nền thêm + sửa = 2; Nháp thêm + xoá = 2.
    expect(count("SELECT COUNT(*) AS n FROM audit_log") - auditBefore).toBe(12);
    expect((raw.prepare("SELECT DISTINCT action FROM audit_log WHERE action LIKE 'balance.%' ORDER BY action").all() as { action: string }[]).map((r) => r.action)).toEqual([
      "balance.item.create", "balance.item.delete", "balance.item.update", "balance.lot.add", "balance.lot.sell", "balance.lot.targets", "balance.lot.void", "balance.value.add",
    ]);
  });

  it("UC-1101 AC-7: mục A3 → use_receivable_book; ngày sau hôm nay → future_date; xoá Vàng đã có lô → 409 item_has_values; mục mới chưa có dòng xoá được", async () => {
    await gold();
    const a3 = await call("POST", "/v1/balance-items", { name: "Cho mượn", section: "A3", pyramid: "protective", measure: "value" });
    expect([a3.status, a3.json.error?.code]).toEqual([400, "use_receivable_book"]);
    const future = await call("POST", "/v1/balance-items/vang/values", { as_of: "2026-12-01", unit_price: 5_000_000 });
    expect([future.status, future.json.error?.code]).toEqual([400, "future_date"]);
    const del = await call("DELETE", "/v1/balance-items/vang");
    expect([del.status, del.json.error?.code]).toEqual([409, "item_has_values"]);
    expect(count("SELECT COUNT(*) AS n FROM balance_values")).toBe(2);
    await item({ name: "Mới", section: "A5", pyramid: "speculative", measure: "value" });
    expect((await call("DELETE", "/v1/balance-items/moi")).status).toBe(200);
  });

  it("UC-1101 AC-8 (chốt lời / cắt lỗ theo lô): lô 1 còn cách chốt lời 4,7%, cắt lỗ 8,5%, Đang giữ; lô 2 Đã chạm cắt lỗ (−2,8%); cắt lỗ ≥ chốt lời → invalid_target", async () => {
    const v = await gold();
    const [l1, l2] = v.lots;
    await call("PATCH", `/v1/balance-lots/${l1!.id}`, { take_profit_price: 5_500_000, stop_loss_price: 4_800_000 });
    const after = (await call<ItemView>("PATCH", `/v1/balance-lots/${l2!.id}`, { stop_loss_price: 5_400_000 })).json.data;
    expect(after.lots[0]!.position).toMatchObject({ pnl: 5_000_000, pnlPct: 5, toTakeProfitPct: 4.7, toStopLossPct: 8.5, status: "holding", cagrPct: null, heldDays: 250 });
    expect(after.lots[1]!.position).toMatchObject({ pnl: -3_000_000, pnlPct: -12.5, toTakeProfitPct: null, toStopLossPct: -2.8, status: "stop_loss" });
    expect(after).toMatchObject({ hitStopLoss: 1, hitTakeProfit: 0 });
    const bad = await call("PATCH", `/v1/balance-lots/${l1!.id}`, { stop_loss_price: 5_600_000 });
    expect([bad.status, bad.json.error?.code]).toEqual([400, "invalid_target"]);
    expect(count("SELECT COUNT(*) AS n FROM transactions")).toBe(0);
  });

  it("UC-1101 AC-9 (mục theo giá trị, CAGR): +200.000.000 (+50,0%), còn cách chốt lời 33,3%, CAGR 14,4%/năm, cao hơn kỳ vọng 2,4 điểm; bỏ chốt lời; giá mua 0 → —", async () => {
    await item({ name: "Đất nền", section: "B3", pyramid: "growth", measure: "value", value: 600_000_000, as_of: "2026-10-01", expected_return: 12 });
    const d = (await call<ItemView>("PATCH", "/v1/balance-items/dat-nen", { cost_basis: 400_000_000, acquired_on: "2023-11-15", take_profit_value: 800_000_000 })).json.data;
    expect(d.position).toEqual({ pnl: 200_000_000, pnlPct: 50, toTakeProfitPct: 33.3, toStopLossPct: null, status: "holding", heldDays: 1096, cagrPct: 14.4, cagrVsExpected: 2.4 });
    const noTp = (await call<ItemView>("PATCH", "/v1/balance-items/dat-nen", { take_profit_value: null })).json.data;
    expect(noTp.position).toMatchObject({ toTakeProfitPct: null, status: "holding" });
    const zero = (await call<ItemView>("PATCH", "/v1/balance-items/dat-nen", { cost_basis: 0 })).json.data;
    expect(zero.position).toMatchObject({ pnlPct: null, cagrPct: null });
  });
});

describe("UC-1102 bảng cân đối, tháp, lịch sử", () => {
  it("UC-1102 AC-1 (bảng mẫu): tài sản 811.000.000, nợ 320.000.000, vốn chủ 491.000.000; Vàng 15,5% / 25,6%; Vay tiêu dùng ngắn hạn lãi cao 3.600.000/năm, tháng này 300.000", async () => {
    await sampleSheet();
    const s = await sheet();
    expect([s.totalAssets, s.totalLiabilities, s.equity]).toEqual([811_000_000, 320_000_000, 491_000_000]);
    expect(row(s, "item:vang")).toMatchObject({ value: 126_000_000, pctOfTotal: 15.5, pctOfEquity: 25.6 });
    expect(s.liabilities.find((g) => g.term === "short" && g.group === "high")!.rows).toMatchObject([
      { key: "debt:vay-tieu-dung", value: 20_000_000, interestRateBps: 1800, interestPerYear: 3_600_000, interestThisMonth: 300_000 },
    ]);
    expect(s.liabilities.find((g) => g.term === "long" && g.group === "none")!.rows).toMatchObject([{ key: "debt:vay-nguoi-nha", interestPerYear: 0 }]);
    expect(s.interestPerYear).toBe(3_600_000);
  });

  it("UC-1102 AC-2 (tháp): phòng vệ 161.000.000 (19,8%), tạo thu nhập 50.000.000 (6,1%), tăng trưởng 600.000.000 (73,9%); dòng tiền 250.000, sau lạm phát 104.166", async () => {
    await sampleSheet();
    const s = await sheet();
    expect(s.pyramid).toEqual([
      { tier: "speculative", total: 0, pct: 0 },
      { tier: "growth", total: 600_000_000, pct: 73.9 },
      { tier: "income", total: 50_000_000, pct: 6.1 },
      { tier: "protective", total: 161_000_000, pct: 19.8 },
      { tier: "fixed", total: 0, pct: 0 },
    ]);
    expect(s.pyramid.reduce((a, p) => a + p.total, 0)).toBe(s.totalAssets);
    expect([s.cashflowMonthly, s.netCashflowMonthly]).toEqual([250_000, 104_166]);
  });

  it("UC-1102 AC-3 (lịch sử): months=2 → 31/10 tài sản 805.000.000 vốn chủ 485.000.000; hôm nay 811.000.000 / 491.000.000, chênh +6.000.000; mục chưa định giá không vào điểm trước", async () => {
    await sampleSheet();
    expect(await history(2)).toMatchObject([
      { month: "2026-10", date: "2026-10-31", totalAssets: 805_000_000, equity: 485_000_000, change: null },
      { month: "2026-11", date: "2026-11-15", totalAssets: 811_000_000, equity: 491_000_000, change: 6_000_000 },
    ]);
    // 30/9: Đất nền chưa có định giá → vắng; vàng chưa có giá → lô theo giá mua (124.000.000).
    expect((await history(3))[0]).toMatchObject({ month: "2026-09", totalAssets: 30_000_000 + 124_000_000 + 50_000_000 + 5_000_000 });
  });

  it("UC-1102 AC-4 (tài sản mua qua app — ADR nháp A): Vàng có mục gắn gold → không còn dòng giá mua; Chứng chỉ quỹ chưa gắn → dòng từ sổ ở A2", async () => {
    raw.exec(`INSERT INTO transactions (at, amount, meaning, asset_kind, week_key, month_key, source) VALUES
      ('2026-10-05T03:00:00.000Z', 2000000, 'buy_asset', 'gold', '2026-W41', '2026-10', 'manual'),
      ('2026-10-05T03:00:00.000Z', 1000000, 'buy_asset', 'fund', '2026-W41', '2026-10', 'manual')`);
    await gold({ asset_kind: "gold" });
    const s = await sheet();
    expect(row(s, "app:gold")).toBeUndefined();
    expect(row(s, "app:fund")).toMatchObject({ source: "ledger", name: "Chứng chỉ quỹ mua qua app (giá mua)", value: 1_000_000, section: "A2" });
  });

  it("UC-1102 AC-5 (khớp tab Nợ): không mục nhập tay, không thẻ tín dụng → vốn chủ = netWorth, Tiền trong app = cash", async () => {
    useDb(openDb());
    raw.exec("UPDATE accounts SET opening_balance = 7000000 WHERE id = 'vcb-husband'; UPDATE accounts SET opening_balance = 1500000 WHERE id = 'cash-wife'");
    await call("POST", "/v1/debts", { name: "Cô Lan", amount: 2_000_000 });
    await call("POST", "/v1/receivables", { name: "Anh Ba", amount: 500_000 });
    const nw = (await call<NetWorth>("GET", "/v1/networth")).json.data;
    const s = await sheet();
    expect(s.equity).toBe(nw.netWorth);
    expect(row(s, "cash")!.value).toBe(nw.cash);
  });

  it("UC-1102 AC-6: vốn chủ ≤ 0 → % trên vốn chủ là —", async () => {
    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance) VALUES ('vcb', 'VCB', 'bank', 1000000)");
    await call("POST", "/v1/debts", { name: "Vay", amount: 10_000_000 });
    const s = await sheet();
    expect(s.equity).toBe(-9_000_000);
    expect([...s.assets.flatMap((x) => x.rows), ...s.liabilities.flatMap((g) => g.rows)].every((r) => r.pctOfEquity === null)).toBe(true);
  });

  it("UC-1102 AC-7 (thẻ tín dụng — ADR nháp I): thẻ âm 3.000.000 sang Nợ ngắn hạn không lãi; tài sản 814.000.000, nợ 323.000.000, vốn chủ 491.000.000; thẻ dương ở A1", async () => {
    await sampleSheet();
    raw.exec(`UPDATE accounts SET opening_balance = 33000000 WHERE id = 'vcb';
      INSERT INTO accounts (id, name, kind, opening_balance, opened_at) VALUES ('the-vcb', 'Thẻ VCB', 'credit', -3000000, '2026-09-01')`);
    const s = await sheet();
    expect(row(s, "cash")!.value).toBe(33_000_000);
    expect(s.liabilities.find((g) => g.term === "short" && g.group === "none")!.rows).toMatchObject([{ key: "card:the-vcb", kind: "credit_card", name: "Thẻ VCB", value: 3_000_000 }]);
    expect([s.totalAssets, s.totalLiabilities, s.equity]).toEqual([814_000_000, 323_000_000, 491_000_000]);
    raw.exec("UPDATE accounts SET opening_balance = 500000 WHERE id = 'the-vcb'");
    const plus = await sheet();
    expect(row(plus, "cash")!.value).toBe(33_500_000);
    expect(plus.liabilities.flatMap((g) => g.rows).some((r) => r.kind === "credit_card")).toBe(false);
  });

  it("UC-1102 AC-8 (tài khoản không có ngày mở sổ): có trong Tiền trong app của cả hai điểm; hôm nay = Σ v_account_book", async () => {
    await sampleSheet();
    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance, opened_at) VALUES ('vi-cu', 'Ví cũ', 'cash', 5000000, NULL)");
    const points = await history(2);
    expect(points.map((p) => p.totalAssets)).toEqual([810_000_000, 816_000_000]);
    expect(row(await sheet(), "cash")!.value).toBe(count("SELECT SUM(book_balance) AS n FROM v_account_book"));
  });

  it("UC-1102 AC-9 (số câu SQL — Workers Free): lịch sử 24 tháng một câu mỗi nguồn, không câu nào lặp; mỗi điểm bằng bảng của đúng ngày đó", async () => {
    at("2026-11-15T05:00:00.000Z");
    raw.exec(`INSERT INTO accounts (id, name, kind, opening_balance, opened_at) VALUES ('a1', 'A1', 'bank', 10000000, '2024-12-01'), ('a2', 'A2', 'cash', 0, '2024-12-01'), ('a3', 'A3', 'credit', 0, '2024-12-01')`);
    const tx = raw.prepare(`INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, week_key, month_key, source) VALUES (?, ?, ?, ?, ?, 'x', ?, 'manual')`);
    for (let m = 0; m < 24; m++) {
      const d = new Date(Date.UTC(2024, 11 + m, 1));
      const month = d.toISOString().slice(0, 7);
      for (let i = 0; i < 300; i++) {
        const iso = `${month}-${String(1 + (i % 28)).padStart(2, "0")}T03:00:00.000Z`;
        if (i % 3 === 0) tx.run(iso, 100_000 + i, "income", null, "a1", month);
        else if (i % 3 === 1) tx.run(iso, 50_000 + i, "transfer", "a1", "a2", month);
        else tx.run(iso, 20_000 + i, "adjust", i % 2 ? "a2" : "a3", null, month);
      }
    }
    for (let k = 0; k < 10; k++) {
      raw.prepare("INSERT INTO balance_items (id, name, section, pyramid, measure, unit) VALUES (?, ?, 'A2', 'growth', ?, ?)").run(`m${k}`, `Mục ${k}`, k < 5 ? "units" : "value", k < 5 ? "cp" : null);
      for (let v = 0; v < 30; v++) {
        const day = new Date(Date.UTC(2024, 11, 1 + v * 23)).toISOString().slice(0, 10);
        raw.prepare(`INSERT INTO balance_values (item_id, as_of, ${k < 5 ? "unit_price" : "value"}) VALUES (?, ?, ?)`).run(`m${k}`, day, 1_000 * (v + 1));
      }
      if (k < 5) for (let l = 0; l < 10; l++) raw.prepare("INSERT INTO balance_lots (item_id, bought_on, quantity_milli, unit_cost) VALUES (?, ?, 1000, 900)").run(`m${k}`, new Date(Date.UTC(2025, l * 2, 3)).toISOString().slice(0, 10));
    }
    for (let k = 0; k < 5; k++) {
      await call("POST", "/v1/debts", { name: `Nợ ${k}`, amount: 1_000_000 * (k + 1), at: "2025-01-05T03:00:00.000Z", interest_rate: k * 5 });
      await call("POST", "/v1/receivables", { name: `Phải thu ${k}`, amount: 500_000 * (k + 1), at: "2025-02-05T03:00:00.000Z" });
    }
    // D1 bọc: đếm mọi câu được prepare trong lần đọc lịch sử.
    const seen: string[] = [];
    const base = asD1(raw);
    env = { DB: { ...base, prepare: (sql: string) => (seen.push(sql), base.prepare(sql)), batch: base.batch.bind(base) } as D1Database, API_TOKEN: "tok" } as Env;
    const started = performance.now();
    const points = await history(24);
    const ms = performance.now() - started;
    console.info(`[UC-1102 AC-9] history?months=24: ${seen.length} câu SQL, ${ms.toFixed(1)} ms (Node, không phải CPU Workers)`);
    expect(points).toHaveLength(24);
    expect(new Set(seen).size).toBe(seen.length);
    // Tài khoản, giao dịch × tháng, nợ, phải thu, người thuê, buy_asset, mục, định giá, lô, tham số + một câu của lớp xác thực.
    expect(seen.length).toBeLessThanOrEqual(11);
    env = { DB: base, API_TOKEN: "tok" } as Env;
    for (const p of points) {
      const s = await sheet(p.date);
      expect([p.totalAssets, p.totalLiabilities, p.equity], p.date).toEqual([s.totalAssets, s.totalLiabilities, s.equity]);
    }
  });

  it("UC-1102 AC-10 (tắt — theo trạng thái tại từng tháng): MB cũ và Vay cũ có ở 31/10, vắng từ ngày tắt; tắt trước v1.31 vắng mọi tháng; bật lại có mặt như chưa tắt", async () => {
    await sampleSheet();
    raw.exec(`INSERT INTO accounts (id, name, kind, opening_balance, opened_at) VALUES ('mb-cu', 'MB cũ', 'bank', 4000000, '2026-10-01');
      INSERT INTO accounts (id, name, kind, opening_balance, active) VALUES ('tat-cu', 'Tắt từ lâu', 'bank', 7000000, 0);
      INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, week_key, month_key, source)
        VALUES ('2026-11-09T03:00:00.000Z', 4000000, 'transfer', 'mb-cu', 'vcb', '2026-W45', '2026-11', 'manual');`);
    await call("POST", "/v1/debts", { name: "Vay cũ", amount: 10_000_000, at: "2026-09-01T03:00:00.000Z" });
    at("2026-11-10T05:00:00.000Z");
    expect((await call("PATCH", "/v1/settings/accounts/mb-cu", { active: false })).status).toBe(200);
    expect((await call("PATCH", "/v1/debts/vay-cu", { active: false })).status).toBe(200);
    at("2026-11-15T05:00:00.000Z");
    expect(await history(2)).toMatchObject([
      { month: "2026-10", totalAssets: 809_000_000, totalLiabilities: 330_000_000, equity: 479_000_000 },
      { month: "2026-11", totalAssets: 815_000_000, totalLiabilities: 320_000_000, equity: 495_000_000 },
    ]);
    await call("PATCH", "/v1/debts/vay-cu", { active: true });
    expect((await history(2)).map((p) => p.totalLiabilities)).toEqual([330_000_000, 330_000_000]);
  });
});

describe("receivable, access: kỳ hạn và ngày tắt", () => {
  it("UC-1001 AC-10: phải thu đổi sang dài hạn → B1 Phải thu dài hạn, không còn ở A3", async () => {
    await call("POST", "/v1/receivables", { name: "Anh Ba", amount: 5_000_000 });
    expect(row(await sheet(), "receivables:short")).toMatchObject({ section: "A3", value: 5_000_000 });
    const r = await call<Receivable>("PATCH", "/v1/receivables/anh-ba", { term: "long" });
    expect(r.json.data.term).toBe("long");
    const s = await sheet();
    expect(row(s, "receivables:short")).toBeUndefined();
    expect(row(s, "receivables:long")).toMatchObject({ section: "B1", name: "Phải thu dài hạn", value: 5_000_000 });
    expect((await call("PATCH", "/v1/receivables/anh-ba", { term: "mid" })).json.error?.code).toBe("invalid_term");
  });

  it("UC-1001 AC-11: tắt khoản phải thu ngày 10/11 → deactivated_at 2026-11-10, bật lại → null", async () => {
    await call("POST", "/v1/receivables", { name: "Anh Ba", amount: 5_000_000 });
    at("2026-11-10T05:00:00.000Z");
    expect((await call<Receivable>("PATCH", "/v1/receivables/anh-ba", { active: false })).json.data.deactivatedAt).toBe("2026-11-10");
    expect((await call<Receivable>("PATCH", "/v1/receivables/anh-ba", { active: true })).json.data.deactivatedAt).toBeNull();
  });

  it("UC-506 AC-23: tắt tài khoản MB cũ ngày 10/11 → deactivated_at 2026-11-10; bật lại → null; không số dư nào đổi", async () => {
    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance) VALUES ('mb-cu', 'MB cũ', 'bank', 4000000)");
    at("2026-11-10T05:00:00.000Z");
    expect((await call("PATCH", "/v1/settings/accounts/mb-cu", { active: false })).json.data).toMatchObject({ active: false, deactivated_at: "2026-11-10" });
    expect((await call("PATCH", "/v1/settings/accounts/mb-cu", { active: true })).json.data).toMatchObject({ active: true, deactivated_at: null, opening_balance: 4_000_000 });
    expect(count("SELECT COUNT(*) AS n FROM transactions")).toBe(0);
  });

  it("UC-507 AC-16: fi_swr_bps 1200 và tuổi mục tiêu bằng tuổi hiện tại → 400 invalid_input kèm tên ô, giữ số cũ; fi_swr_bps 300 → lưu", async () => {
    expect((await call("PUT", "/v1/settings/config", { fi_birth_year: 1990 })).status).toBe(200);
    const swr = await call("PUT", "/v1/settings/config", { fi_swr_bps: 1200 });
    expect([swr.status, swr.json.error?.code, swr.json.error?.field]).toEqual([400, "invalid_input", "fi_swr_bps"]);
    const age = await call("PUT", "/v1/settings/config", { fi_target_age_f1: 36 });
    expect([age.status, age.json.error?.field]).toEqual([400, "fi_target_age_f1"]);
    expect((await call<SettingsData>("GET", "/v1/settings")).json.data.config).toMatchObject({ fi_swr_bps: 350, fi_target_age_f1: null, fi_birth_year: 1990 });
    expect((await call<SettingsConfig>("PUT", "/v1/settings/config", { fi_swr_bps: 300 })).json.data).toMatchObject({ fi_swr_bps: 300 });
    expect((await call<SettingsConfig>("PUT", "/v1/settings/config", { fi_birth_year: null })).json.data.fi_birth_year).toBeNull();
    expect(raw.prepare("SELECT action FROM audit_log WHERE action = 'config.update'").all().length).toBe(3);
  });

  it("UC-1005 AC-7: thêm Vàng 126.000.000 (không gắn loại) → balanceItems 126.000.000, netWorth tăng đúng chừng đó; tiền, tài sản mua qua app, Tích sản, còn để chi không đổi", async () => {
    useDb(openDb());
    const before = (await call<NetWorth>("GET", "/v1/networth")).json.data;
    await item({ name: "Vàng", section: "A1", pyramid: "protective", measure: "value", value: 126_000_000 });
    const after = (await call<NetWorth>("GET", "/v1/networth")).json.data;
    expect(after.balanceItems).toBe(126_000_000);
    expect(after.netWorth - before.netWorth).toBe(126_000_000);
    for (const k of ["cash", "assets", "wealthBuildingCash", "spendableThisWeek"] as const) expect(after[k], k).toBe(before[k]);
  });

  it("UC-1005 AC-8: buy_asset vàng 2.000.000 rồi mục Vàng gắn gold 126.000.000 → assets về 0, netWorth tăng 124.000.000; Tích sản vẫn tài sản 2.000.000", async () => {
    useDb(openDb());
    raw.exec(`INSERT INTO transactions (at, amount, meaning, wallet_id, asset_kind, week_key, month_key, source)
      VALUES ('2026-11-01T03:00:00.000Z', 2000000, 'buy_asset', 'wealth-building', 'gold', '2026-W44', '2026-11', 'manual')`);
    const before = (await call<NetWorth>("GET", "/v1/networth")).json.data;
    expect(before.assets).toBe(2_000_000);
    await item({ name: "Vàng", section: "A1", pyramid: "protective", measure: "value", value: 126_000_000, asset_kind: "gold" });
    const after = (await call<NetWorth>("GET", "/v1/networth")).json.data;
    expect([after.assets, after.balanceItems, after.netWorth - before.netWorth]).toEqual([0, 126_000_000, 124_000_000]);
    expect(after.netWorth).toBe(after.cash + after.assets + after.balanceItems + after.receivables + after.tenants - after.debts - after.tenantsPrepaid);
    expect((await call<Snapshot>("GET", "/v1/snapshot")).json.data.tiers.wealth_building.assets).toBe(2_000_000);
  });
});

describe("debt, ledger, allocation: lãi vay hằng tháng (ADR nháp H)", () => {
  beforeEach(() => useDb(openDb()));
  const debt = async (id: string) => (await call<{ debts: Debt[] }>("GET", "/v1/debts")).json.data.debts.find((d) => d.id === id)!;
  async function loans() {
    await call("POST", "/v1/debts", { name: "Vay tiêu dùng", amount: 20_000_000, at: "2026-10-01T03:00:00.000Z", interest_rate: 18, term: "short", monthly_payment: 2_300_000, due_day: 5 });
    await call("POST", "/v1/debts", { name: "Vay người nhà", amount: 300_000_000, at: "2026-10-01T03:00:00.000Z", term: "long" });
  }
  const payInterest = (amount: number, extra: Record<string, unknown> = {}) =>
    call<EntryResult>("POST", "/v1/transactions", { meaning: "spend", amount, interest_debt_id: "vay-tieu-dung", at: "2026-11-05T03:00:00.000Z", ...extra });
  const payPrincipal = (amount: number, extra: Record<string, unknown> = {}) =>
    call<EntryResult>("POST", "/v1/transactions", { meaning: "spend", amount, debt_id: "vay-tieu-dung", at: "2026-11-05T03:00:00.000Z", ...extra });

  it("UC-901 AC-9: PATCH lãi 18%, ngắn hạn, trả 2.300.000 ngày 5 → interestPerYear 3.600.000, tháng này 300.000, đã trả 0; số còn nợ không đổi; lỗi invalid_rate / invalid_term / invalid_input", async () => {
    await call("POST", "/v1/debts", { name: "Vay tiêu dùng", amount: 20_000_000, at: "2026-10-01T03:00:00.000Z" });
    const r = await call<Debt>("PATCH", "/v1/debts/vay-tieu-dung", { interest_rate: 18, term: "short", monthly_payment: 2_300_000, due_day: 5 });
    expect(r.json.data).toMatchObject({ interestRate: 18, term: "short", monthlyPayment: 2_300_000, dueDay: 5, interestPerYear: 3_600_000, interestThisMonth: 300_000, interestPaidThisMonth: 0, balance: 20_000_000 });
    for (const [b, code] of [
      [{ interest_rate: -1 }, "invalid_rate"],
      [{ interest_rate: 101 }, "invalid_rate"],
      [{ term: "mid" }, "invalid_term"],
      [{ due_day: 29 }, "invalid_input"],
      [{ monthly_payment: 0 }, "invalid_input"],
    ] as const) {
      const bad = await call("PATCH", "/v1/debts/vay-tieu-dung", b);
      expect([bad.status, bad.json.error?.code], JSON.stringify(b)).toEqual([400, code]);
    }
  });

  it("UC-901 AC-10: khoản 0% → interestThisMonth 0, không có dòng lãi ở ngân sách", async () => {
    await loans();
    expect((await debt("vay-nguoi-nha")).interestThisMonth).toBe(0);
    const budget = (await call<Budget>("GET", "/v1/budget?period=2026-11")).json.data;
    expect(budget.interestLines!.map((l) => l.debtId)).toEqual(["vay-tieu-dung"]);
  });

  it("UC-901 AC-11: tắt Vay cũ ngày 10/11 → deactivated_at 2026-11-10; bật lại → null", async () => {
    await call("POST", "/v1/debts", { name: "Vay cũ", amount: 10_000_000 });
    at("2026-11-10T05:00:00.000Z");
    expect((await call<Debt>("PATCH", "/v1/debts/vay-cu", { active: false })).json.data.deactivatedAt).toBe("2026-11-10");
    expect((await call<Debt>("PATCH", "/v1/debts/vay-cu", { active: true })).json.data.deactivatedAt).toBeNull();
  });

  it("UC-101 AC-25: spend trả lãi không danh mục → loan-interest, ví Lãi vay, còn nợ không đổi; income kèm lãi → interest_spend_only; cả debt_id → debt_and_interest; khoản không có / đã tắt", async () => {
    await loans();
    const ok = await payInterest(300_000);
    expect(ok.status).toBe(201);
    expect(ok.json.data.tx).toMatchObject({ category_id: "loan-interest", counter_wallet_id: "loan-interest", interest_debt_id: "vay-tieu-dung", debt_id: null });
    expect((await debt("vay-tieu-dung")).balance).toBe(20_000_000);
    expect((await call("POST", "/v1/transactions", { meaning: "income", amount: 1_000, account_id: "cash-husband", interest_debt_id: "vay-tieu-dung" })).json.error?.code).toBe("interest_spend_only");
    expect((await payInterest(1_000, { debt_id: "vay-tieu-dung" })).json.error?.code).toBe("debt_and_interest");
    expect((await payInterest(1_000, { interest_debt_id: "khong-co" })).json.error?.code).toBe("unknown_debt");
    await call("PATCH", "/v1/debts/vay-nguoi-nha", { active: false });
    expect((await payInterest(1_000, { interest_debt_id: "vay-nguoi-nha" })).json.error?.code).toBe("inactive_debt");
  });

  it("UC-104 AC-8: ví Lãi vay dự kiến 300.000 và interestLines từng khoản; trả xong còn lại 0; tháng 12 dự kiến 270.000; luật nạp tay thắng", async () => {
    await loans();
    const line = (b: Budget) => b.lines.find((l) => l.walletId === "loan-interest")!;
    const nov = (await call<Budget>("GET", "/v1/budget?period=2026-11")).json.data;
    expect(line(nov)).toMatchObject({ tier: "must", mustGroup: "must", target: 300_000, spent: 0, remaining: 300_000 });
    expect(nov.interestLines).toEqual([{ debtId: "vay-tieu-dung", name: "Vay tiêu dùng", expected: 300_000, paid: 0, dueDay: 5 }]);
    await payInterest(300_000);
    await payPrincipal(2_000_000);
    const paid = (await call<Budget>("GET", "/v1/budget?period=2026-11")).json.data;
    expect(line(paid)).toMatchObject({ spent: 300_000, remaining: 0 });
    expect(paid.interestLines![0]!.paid).toBe(300_000);
    expect(line((await call<Budget>("GET", "/v1/budget?period=2026-12")).json.data).target).toBe(270_000);
    raw.exec("INSERT INTO allocations (wallet_id, mode, period, amount, priority) VALUES ('loan-interest', 'flat', 'month', 500000, 45)");
    expect(line((await call<Budget>("GET", "/v1/budget?period=2026-11")).json.data).target).toBe(500_000);
  });

  it("UC-201 AC-21: chia thử 30.000.000 → ví Lãi vay nhận 300.000 ở bước sàn Must; khoản 0% không thêm gì; thiếu tiền thì bóp Have / Hưởng thụ trước; có luật tay thì theo luật tay", async () => {
    await loans();
    const preview = async (amount: number) => (await call<AllocationPlan>("POST", "/v1/allocate/preview", { amount, at: "2026-11-15T03:00:00.000Z" })).json.data;
    const fund = (p: AllocationPlan, id: string) => p.funds.find((f) => f.walletId === id)?.amount ?? 0;
    expect(fund(await preview(30_000_000), "loan-interest")).toBe(300_000);
    const short = await preview(5_000_000);
    const niceOrHave = ["fun-husband", "fun-wife", "travel", "nice-to-have"].reduce((s, id) => s + fund(short, id), 0);
    if (fund(short, "loan-interest") < 300_000) {
      expect(short.underfunded).toContain("loan-interest");
      expect(niceOrHave).toBe(0);
    }
    raw.exec("INSERT INTO allocations (wallet_id, mode, period, amount, priority) VALUES ('loan-interest', 'flat', 'month', 500000, 45)");
    expect(fund(await preview(30_000_000), "loan-interest")).toBe(500_000);
  });

  it("UC-902 AC-10: trả 2.300.000 tách lãi 300.000 / gốc 2.000.000 → hai khoản chi; còn nợ 18.000.000; lãi còn phải trả tháng 11 về 0; tháng 12 dự kiến 270.000", async () => {
    await loans();
    const d = await debt("vay-tieu-dung");
    const interest = interestPart(d.monthlyPayment!, d.interestThisMonth, d.interestPaidThisMonth);
    expect([interest, d.monthlyPayment! - interest]).toEqual([300_000, 2_000_000]);
    expect((await payInterest(interest)).json.data.tx).toMatchObject({ category_id: "loan-interest", counter_wallet_id: "loan-interest", interest_debt_id: "vay-tieu-dung" });
    expect((await payPrincipal(2_000_000)).json.data.tx).toMatchObject({ category_id: "debt-payment", debt_id: "vay-tieu-dung" });
    const after = await debt("vay-tieu-dung");
    expect(after.balance).toBe(18_000_000);
    expect(interestPart(2_300_000, after.interestThisMonth, after.interestPaidThisMonth)).toBe(0);
    at("2026-12-02T05:00:00.000Z");
    expect((await debt("vay-tieu-dung")).interestThisMonth).toBe(270_000);
  });

  it("UC-902 AC-11: hàng đợi gửi lại hai khoản (cùng client_id) → đúng hai khoản được ghi một lần", async () => {
    await loans();
    for (let i = 0; i < 2; i++) {
      await payInterest(300_000, { client_id: "lai-0000001" });
      await payPrincipal(2_000_000, { client_id: "goc-0000001" });
    }
    expect(count("SELECT COUNT(*) AS n FROM transactions WHERE debt_id = 'vay-tieu-dung' OR interest_debt_id = 'vay-tieu-dung'")).toBe(2);
  });

  it("UC-903 AC-4: Gán log tiền ra 2.300.000 thành hai dòng — lãi 300.000 (interest_debt_id) và gốc 2.000.000 (debt_id)", async () => {
    await loans();
    raw.exec(`INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES ('L-tra-no', '2026-11-05T03:00:00.000Z', 2300000, 'out', 'vcb-husband', 'TRA NO', 'pending')`);
    const r = await call<{ transactions: { amount: number }[] }>("POST", "/v1/logs/L-tra-no/assign", {
      splits: [
        { meaning: "spend", amount: 300_000, interest_debt_id: "vay-tieu-dung" },
        { meaning: "spend", amount: 2_000_000, debt_id: "vay-tieu-dung" },
      ],
    });
    expect(r.status, JSON.stringify(r.json.error)).toBe(201);
    expect([...r.json.data.transactions].sort((a, b) => a.amount - b.amount)).toMatchObject([
      { amount: 300_000, category_id: "loan-interest", interest_debt_id: "vay-tieu-dung", debt_id: null },
      { amount: 2_000_000, category_id: "debt-payment", debt_id: "vay-tieu-dung", interest_debt_id: null },
    ]);
    expect((await debt("vay-tieu-dung")).balance).toBe(18_000_000);
  });
});
