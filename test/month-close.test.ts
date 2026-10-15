// Chốt tháng (allocation UC-207, ADR-111): bù ví chi lố trước, phần dư chia Tích sản / Ví Thưởng theo tỷ lệ người chọn.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planMonthClose, type MonthClosePlanInput } from "../src/domain/close";
import { weekKey } from "../src/domain/period";
import type { WalletRef } from "../src/domain/types";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { MemoryKV } from "./helpers/oauth";

const wallet = (id: string, sort: number, over: Partial<WalletRef> = {}): WalletRef => ({
  id,
  name: id,
  tier: "must",
  mustGroup: "must",
  kind: "envelope",
  scope: "shared",
  memberId: null,
  accountId: "vcb",
  private: false,
  sort,
  ...over,
});

const WALLETS: WalletRef[] = [
  wallet("wealth-building", 10, { tier: "wealth_building", mustGroup: null, kind: "accrual" }),
  wallet("fun-husband", 30, { tier: "nice", mustGroup: null, scope: "personal", memberId: "husband" }),
  wallet("travel", 32, { tier: "nice", mustGroup: null, kind: "accrual" }),
  wallet("food", 41),
  wallet("transport", 42),
  wallet("utilities", 43, { kind: "bill" }),
  wallet("other", 45),
  wallet("shopping", 46),
  wallet("nice-to-have", 50, { mustGroup: "have" }),
  wallet("reward", 60, { kind: "accrual" }),
];

const plan = (balances: Record<string, number>, over: Partial<MonthClosePlanInput> = {}) =>
  planMonthClose({ wallets: WALLETS, balances, coveredByNextIncome: {}, wealthPct: 100, wealthWalletId: "wealth-building", rewardWalletId: null, ...over });

describe("planMonthClose", () => {
  it("UC-207 AC-1: Ăn uống −500.000, Đi lại +1.200.000, Có thì tốt +3.440.000 → Có thì tốt góp 370.690, Đi lại 129.310; L = 4.140.000 vào hết Tích sản (chưa có Ví Thưởng)", () => {
    const p = plan({ food: -500_000, transport: 1_200_000, "nice-to-have": 3_440_000 });
    expect(p).toMatchObject({ positiveTotal: 4_640_000, holeTotal: 500_000, covered: 500_000, profit: 4_140_000, toWealth: 4_140_000, toReward: 0 });
    expect(p.covers).toEqual([
      { fromWalletId: "nice-to-have", toWalletId: "food", amount: 370_690 },
      { fromWalletId: "transport", toWalletId: "food", amount: 129_310 },
    ]);
    expect(p.sweeps).toEqual([
      { fromWalletId: "nice-to-have", toWalletId: "wealth-building", kind: "wealth", amount: 3_069_310 },
      { fromWalletId: "transport", toWalletId: "wealth-building", kind: "wealth", amount: 1_070_690 },
    ]);
  });

  it("UC-207 AC-6: Ăn uống +2.000.000, Đi lại +400.000, Khác −1.500.000, Mua sắm −600.000, X = 50 → bù Khác 1.500.000 rồi Mua sắm 600.000 (đổ thác); Ăn uống góp 1.750.000, Đi lại 350.000; Tích sản 150.000, Ví Thưởng 150.000; mọi ví về 0", () => {
    const p = plan({ food: 2_000_000, transport: 400_000, other: -1_500_000, shopping: -600_000 }, { wealthPct: 50, rewardWalletId: "reward" });
    expect(p.covers).toEqual([
      { fromWalletId: "food", toWalletId: "other", amount: 1_500_000 },
      { fromWalletId: "food", toWalletId: "shopping", amount: 250_000 },
      { fromWalletId: "transport", toWalletId: "shopping", amount: 350_000 },
    ]);
    expect(p.sweeps).toEqual([
      { fromWalletId: "food", toWalletId: "wealth-building", kind: "wealth", amount: 125_000 },
      { fromWalletId: "food", toWalletId: "reward", kind: "reward", amount: 125_000 },
      { fromWalletId: "transport", toWalletId: "wealth-building", kind: "wealth", amount: 25_000 },
      { fromWalletId: "transport", toWalletId: "reward", kind: "reward", amount: 25_000 },
    ]);
    expect(p).toMatchObject({ covered: 2_100_000, profit: 300_000, toWealth: 150_000, toReward: 150_000 });
    const after = Object.fromEntries(p.participants.map((x) => [x.walletId, x.monthEndBalance + x.coverReceived - x.contributed - x.toWealth - x.toReward]));
    expect(after).toEqual({ food: 0, transport: 0, other: 0, shopping: 0 });
    expect(p.participants.find((x) => x.walletId === "food")).toMatchObject({ contributed: 1_750_000, toWealth: 125_000, toReward: 125_000 });
    expect(p.participants.find((x) => x.walletId === "transport")).toMatchObject({ contributed: 350_000 });
  });

  it("UC-207 AC-7: Ăn uống +500.000, Khác −1.500.000 → Khác còn −1.000.000, Ăn uống 0, L = 0", () => {
    const p = plan({ food: 500_000, other: -1_500_000 });
    expect(p.covers).toEqual([{ fromWalletId: "food", toWalletId: "other", amount: 500_000 }]);
    expect(p.sweeps).toEqual([]);
    expect(p).toMatchObject({ covered: 500_000, profit: 0, toWealth: 0, toReward: 0 });
    expect(p.participants.find((x) => x.walletId === "other")).toMatchObject({ hole: 1_500_000, coverReceived: 500_000 });
  });

  it("UC-207 AC-8: L = 1.000.000, X = 100 → Tích sản 1.000.000, không có move reward; X < 100 không có Ví Thưởng → lỗi bất biến", () => {
    const p = plan({ food: 1_000_000 }, { rewardWalletId: "reward", wealthPct: 100 });
    expect(p.sweeps).toEqual([{ fromWalletId: "food", toWalletId: "wealth-building", kind: "wealth", amount: 1_000_000 }]);
    expect(() => plan({ food: 1_000_000 }, { wealthPct: 50 })).toThrow();
    // Lẻ đồng: phần Tích sản làm tròn xuống, đồng lẻ vào Ví Thưởng.
    expect(plan({ food: 1_001 }, { rewardWalletId: "reward", wealthPct: 50 }).sweeps.map((s) => s.amount)).toEqual([500, 501]);
  });

  it("UC-207 AC-9: Khác −1.500.000 cuối tháng, lương tháng sau đã rót 1.500.000 vào Khác → không bù; L = 2.000.000", () => {
    const p = plan({ food: 2_000_000, other: -1_500_000 }, { coveredByNextIncome: { other: 1_500_000 } });
    expect(p.covers).toEqual([]);
    expect(p).toMatchObject({ holeTotal: 0, covered: 0, profit: 2_000_000, toWealth: 2_000_000 });
    expect(p.participants.find((x) => x.walletId === "other")).toMatchObject({ hole: 0, coveredByNextIncome: 1_500_000 });
    // Rót nhiều hơn hố thì chỉ tính tới bằng hố.
    expect(plan({ other: -100 }, { coveredByNextIncome: { other: 500 } }).participants).toEqual([
      expect.objectContaining({ walletId: "other", hole: 0, coveredByNextIncome: 100 }),
    ]);
  });

  it("UC-207: chỉ phong bì chung must / nice tham gia; ví cá nhân, tích dồn, hoá đơn và Ví Thưởng đứng ngoài; hoà số dư thì xếp theo sort rồi id", () => {
    const outsiders = { "fun-husband": 900_000, travel: 900_000, utilities: -900_000, reward: 900_000, "wealth-building": 900_000 };
    const p = plan({ ...outsiders, other: 300_000, food: 300_000, shopping: -1_000 }, { rewardWalletId: "reward", wealthPct: 100 });
    expect(p.participants.map((x) => x.walletId)).toEqual(["food", "other", "shopping"]);
    // food (sort 41) đứng trước other (sort 45) khi hoà: nhận đồng lẻ và góp trước.
    expect(p.covers).toEqual([
      { fromWalletId: "food", toWalletId: "shopping", amount: 500 },
      { fromWalletId: "other", toWalletId: "shopping", amount: 500 },
    ]);
    const odd = plan({ food: 300_000, other: 300_000, shopping: -1_001 });
    expect(odd.covers).toEqual([
      { fromWalletId: "food", toWalletId: "shopping", amount: 501 },
      { fromWalletId: "other", toWalletId: "shopping", amount: 500 },
    ]);
    // Phong bì chung phe nice cũng tham gia.
    const nice = planMonthClose({
      wallets: [...WALLETS, wallet("eating-out", 33, { tier: "nice", mustGroup: null })],
      balances: { "eating-out": 10_000 },
      coveredByNextIncome: {},
      wealthPct: 100,
      wealthWalletId: "wealth-building",
      rewardWalletId: null,
    });
    expect(nice.profit).toBe(10_000);
  });
});

// ── API: GET / POST /v1/month-close ─────────────────────────────────

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T03:00:00.000Z")); // 10:00 VN 5/11 → tháng chốt được là 2026-10
  raw = openDb();
  raw.prepare("UPDATE accounts SET sepay_enabled = 0").run();
  raw.prepare("UPDATE allocations SET target_date = '2026-12-31' WHERE wallet_id = 'travel'").run();
  // Fixture AC-6: thêm hai phong bì chung phe must; Ví Thưởng là ví tích luỹ ở tài khoản riêng.
  raw.exec(`INSERT INTO wallets (id, name, tier, must_group, kind, scope, account_id, sort) VALUES
    ('other', 'Khác', 'must', 'must', 'envelope', 'shared', 'vcb-husband', 45),
    ('shopping', 'Mua sắm', 'must', 'must', 'envelope', 'shared', 'vcb-husband', 46),
    ('reward', 'Ví Thưởng', 'nice', NULL, 'accrual', 'shared', 'mb-husband', 60)`);
  env = { DB: asD1(raw), OAUTH_KV: new MemoryKV() as unknown as KVNamespace, API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
});
afterEach(() => vi.useRealTimers());

type Json = { ok: boolean; data: any; error?: { code: string; message: string } };
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(
    path,
    {
      method,
      headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

/** Một bút toán điều chỉnh làm ví tăng (+) hoặc giảm (−) trong tháng `month`. */
function flow(walletId: string, amount: number, month = "2026-10", meaning: "adjust" | "fund" = "adjust") {
  const at = `${month}-15T05:00:00.000Z`;
  raw
    .prepare(`INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, week_key, month_key, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'system')`)
    .run(at, Math.abs(amount), meaning, amount > 0 ? walletId : null, amount > 0 ? (meaning === "fund" ? "income" : null) : walletId, weekKey(at), month);
}
function balances(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of raw.prepare("SELECT wallet_id, balance FROM v_wallet_balance").all()) out[String(row.wallet_id)] = Number(row.balance);
  return out;
}
const closeRows = () => raw.prepare("SELECT month, by_member_id, wealth_pct FROM month_closes ORDER BY month").all();
const sweepTx = (batch: string) =>
  raw.prepare("SELECT counter_wallet_id AS from_w, wallet_id AS to_w, amount, at, month_key, source, meaning, by_member_id, note FROM transactions WHERE batch_id = ? ORDER BY id").all(batch);
const setReward = async (pct?: number) =>
  expect((await call("PUT", "/v1/settings/config", { month_close_reward_wallet: "reward", ...(pct === undefined ? {} : { month_close_wealth_pct: pct }) })).status).toBe(200);
/** AC-6: bốn phong bì chung cuối tháng 10. */
function ac6() {
  flow("food", 2_000_000);
  flow("transport", 400_000);
  flow("other", -1_500_000);
  flow("shopping", -600_000);
}

describe("chốt tháng qua API", () => {
  it("UC-207 AC-1: seed (Ăn uống −500.000, Đi lại +1.200.000, Có thì tốt +3.440.000), chưa có Ví Thưởng → POST /v1/month-close ghi bù 370.690 + 129.310 và quét 4.140.000 sang Tích sản, month_closes có dòng; POST lại → 409 already_closed", async () => {
    vi.setSystemTime(new Date("2026-10-05T03:00:00.000Z"));
    const income = await call("POST", "/v1/transactions", { meaning: "income", amount: 40_000_000, account_id: "vcb-husband", at: "2026-09-10T09:00:00+07:00" });
    await call("POST", "/v1/allocate", { income_tx_id: income.json.data.tx.id });
    await call("POST", "/v1/transactions", { meaning: "spend", amount: 3_000_000, category_id: "groceries", at: "2026-09-12T12:00:00+07:00" });

    const preview = await call("GET", "/v1/month-close");
    expect(preview.status).toBe(200);
    expect(preview.json.data).toMatchObject({
      month: "2026-09",
      closed: false,
      wealthPct: 100,
      defaultWealthPct: 100,
      wealthWalletId: "wealth-building",
      rewardWalletId: null,
      positiveTotal: 4_640_000,
      holeTotal: 500_000,
      covered: 500_000,
      profit: 4_140_000,
      toWealth: 4_140_000,
      toReward: 0,
      warnings: [],
    });
    expect(preview.json.data.covers).toEqual([
      { fromWalletId: "nice-to-have", toWalletId: "food", amount: 370_690 },
      { fromWalletId: "transport", toWalletId: "food", amount: 129_310 },
    ]);
    expect(preview.json.data.participants).toContainEqual(
      expect.objectContaining({ walletId: "food", name: "Ăn uống", monthEndBalance: -500_000, hole: 500_000, coverReceived: 500_000, balanceNow: -500_000, balanceAfter: 0 }),
    );
    expect(closeRows()).toEqual([]);

    const done = await call("POST", "/v1/month-close", { month: "2026-09" }, { "X-Member-Id": "wife" });
    expect(done.status).toBe(201);
    expect(done.json.data).toMatchObject({ month: "2026-09", closed: true, batchId: "S202609", closedAt: "2026-10-05 03:00:00", profit: 4_140_000, toWealth: 4_140_000 });
    expect(closeRows()).toEqual([{ month: "2026-09", by_member_id: "wife", wealth_pct: 100 }]);
    expect(sweepTx("S202609").map((t) => [t.from_w, t.to_w, t.amount])).toEqual([
      ["nice-to-have", "food", 370_690],
      ["transport", "food", 129_310],
      ["nice-to-have", "wealth-building", 3_069_310],
      ["transport", "wealth-building", 1_070_690],
    ]);
    expect(sweepTx("S202609")[0]).toMatchObject({ meaning: "transfer", source: "system", by_member_id: "wife", note: "Chốt tháng 2026-09: bù chi lố cho Ăn uống" });
    expect(sweepTx("S202609")[2]).toMatchObject({ note: "Chốt tháng 2026-09: sang Tích sản" });
    expect(balances()).toMatchObject({ food: 0, transport: 0, "nice-to-have": 0, "wealth-building": 12_000_000 + 4_140_000 });
    expect((await call("GET", "/v1/month-close")).json.data).toEqual({ month: "2026-09", closed: true, closedAt: "2026-10-05 03:00:00", byMemberId: "wife", wealthPct: 100 });

    const again = await call("POST", "/v1/month-close", { month: "2026-09" });
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("already_closed");
    expect(sweepTx("S202609")).toHaveLength(4);
    // Nhật ký thay đổi ghi lần chốt.
    expect(raw.prepare("SELECT action, target, detail FROM audit_log WHERE action = 'month.close'").all()).toEqual([
      {
        action: "month.close",
        target: "month:2026-09",
        detail: JSON.stringify({ wealth_pct: 100, reward_wallet_id: null, to_wealth: 4_140_000, to_reward: 0, covered: 500_000 }),
      },
    ]);
  });

  it("UC-207 AC-3: không ví dương, không ví âm → GET profit 0, không move; POST vẫn lưu month_closes, GET sau đó closed: true", async () => {
    const preview = (await call("GET", "/v1/month-close")).json.data;
    expect(preview).toMatchObject({ month: "2026-10", closed: false, positiveTotal: 0, profit: 0, covers: [], sweeps: [], transferOrders: [], participants: [] });
    const done = await call("POST", "/v1/month-close", { month: "2026-10" });
    expect(done.status).toBe(201);
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE batch_id = 'S202610'").get()).toEqual({ n: 0 });
    expect(closeRows()).toEqual([{ month: "2026-10", by_member_id: "husband", wealth_pct: 100 }]);
    expect((await call("GET", "/v1/month-close")).json.data).toMatchObject({ month: "2026-10", closed: true });
  });

  it("UC-207 AC-4: chốt muộn ngày 15/11 vẫn ghi bút toán lúc 23:59:59 ngày 31/10 giờ VN, month_key 2026-10", async () => {
    vi.setSystemTime(new Date("2026-11-15T03:00:00.000Z"));
    flow("food", 300_000);
    expect((await call("POST", "/v1/month-close", { month: "2026-10" })).status).toBe(201);
    expect(sweepTx("S202610")).toEqual([
      expect.objectContaining({ from_w: "food", to_w: "wealth-building", amount: 300_000, at: "2026-10-31T16:59:59.000Z", month_key: "2026-10" }),
    ]);
  });

  it("UC-207 AC-5: phong bì ở nhiều tài khoản → lệnh chuyển gộp theo cặp tài khoản nguồn → đích; Tích sản và Ví Thưởng ở hai tài khoản khác nhau → hai lệnh; bù giữa hai ví cùng tài khoản không sinh lệnh", async () => {
    raw.prepare("UPDATE wallets SET account_id = 'vcb-wife' WHERE id IN ('transport', 'shopping')").run();
    await setReward(50);
    ac6();
    const preview = (await call("GET", "/v1/month-close")).json.data;
    const orders = [
      { fromAccountId: "vcb-husband", toAccountId: "vcb-wife", amount: 250_000, walletIds: ["shopping"] },
      { fromAccountId: "vcb-husband", toAccountId: "tcb-husband", amount: 125_000, walletIds: ["wealth-building"] },
      { fromAccountId: "vcb-husband", toAccountId: "mb-husband", amount: 125_000, walletIds: ["reward"] },
      { fromAccountId: "vcb-wife", toAccountId: "tcb-husband", amount: 25_000, walletIds: ["wealth-building"] },
      { fromAccountId: "vcb-wife", toAccountId: "mb-husband", amount: 25_000, walletIds: ["reward"] },
    ];
    expect(preview.transferOrders).toEqual(orders);
    await call("POST", "/v1/month-close", { month: "2026-10", wealth_pct: 50 });
    expect(raw.prepare("SELECT from_account_id AS f, to_account_id AS t, amount FROM transfer_orders WHERE batch_id = 'S202610' ORDER BY id").all()).toEqual(
      orders.map((o) => ({ f: o.fromAccountId, t: o.toAccountId, amount: o.amount })),
    );
  });

  it("UC-207 AC-6: bốn phong bì chung, Ví Thưởng đã đặt, wealth_pct 50 → Tích sản +150.000, Ví Thưởng +150.000, bốn ví về 0", async () => {
    await setReward(50);
    ac6();
    const preview = (await call("GET", "/v1/month-close")).json.data;
    expect(preview).toMatchObject({ wealthPct: 50, defaultWealthPct: 50, rewardWalletId: "reward", covered: 2_100_000, profit: 300_000, toWealth: 150_000, toReward: 150_000 });
    expect(preview.sweeps).toEqual([
      { fromWalletId: "food", toWalletId: "wealth-building", kind: "wealth", amount: 125_000 },
      { fromWalletId: "food", toWalletId: "reward", kind: "reward", amount: 125_000 },
      { fromWalletId: "transport", toWalletId: "wealth-building", kind: "wealth", amount: 25_000 },
      { fromWalletId: "transport", toWalletId: "reward", kind: "reward", amount: 25_000 },
    ]);
    const done = await call("POST", "/v1/month-close", { month: "2026-10", wealth_pct: 50 });
    expect(done.status).toBe(201);
    expect(balances()).toMatchObject({ food: 0, transport: 0, other: 0, shopping: 0, "wealth-building": 150_000, reward: 150_000 });
    expect(sweepTx("S202610").find((t) => t.to_w === "reward")).toMatchObject({ note: "Chốt tháng 2026-10: sang Ví Thưởng" });
    expect(closeRows()).toEqual([{ month: "2026-10", by_member_id: "husband", wealth_pct: 50 }]);
  });

  it("UC-207 AC-8: L = 1.000.000, wealth_pct 100 → Tích sản +1.000.000, Ví Thưởng không đổi; 101 / −1 / 2,5 → 400 invalid_input; chưa đặt Ví Thưởng mà gửi 50 → 400 invalid_input", async () => {
    flow("food", 1_000_000);
    for (const q of ["50", "101", "-1", "2.5", "abc"]) {
      const res = await call("GET", `/v1/month-close?wealth_pct=${q}`);
      expect(res.status, q).toBe(400);
      expect(res.json.error?.code, q).toBe("invalid_input");
    }
    const noReward = await call("POST", "/v1/month-close", { month: "2026-10", wealth_pct: 50 });
    expect(noReward.json.error?.code).toBe("invalid_input");
    await setReward();
    // Có Ví Thưởng: mặc định 50% (chưa đặt tỷ lệ); GET theo tỷ lệ gửi lên.
    expect((await call("GET", "/v1/month-close")).json.data).toMatchObject({ wealthPct: 50, defaultWealthPct: 50, toWealth: 500_000, toReward: 500_000 });
    expect((await call("GET", "/v1/month-close?wealth_pct=")).json.data).toMatchObject({ wealthPct: 50 });
    expect((await call("GET", "/v1/month-close?wealth_pct=100")).json.data).toMatchObject({ wealthPct: 100, toWealth: 1_000_000, toReward: 0 });
    for (const wealth_pct of [101, -1, 2.5, "50"]) {
      const res = await call("POST", "/v1/month-close", { month: "2026-10", wealth_pct });
      expect(res.status, String(wealth_pct)).toBe(400);
      expect(res.json.error?.code, String(wealth_pct)).toBe("invalid_input");
    }
    expect(closeRows()).toEqual([]);
    expect((await call("POST", "/v1/month-close", { month: "2026-10", wealth_pct: 100 })).status).toBe(201);
    expect(balances()).toMatchObject({ "wealth-building": 1_000_000, reward: 0, food: 0 });
  });

  it("UC-207 AC-9: Khác −1.500.000 cuối tháng 10, lương 3/11 rót 1.500.000 vào Khác, Ăn uống +2.000.000 → GET không có dòng bù Khác, profit 2.000.000", async () => {
    flow("other", -1_500_000);
    flow("food", 2_000_000);
    flow("other", 1_500_000, "2026-11", "fund");
    const preview = (await call("GET", "/v1/month-close")).json.data;
    expect(preview).toMatchObject({ covers: [], holeTotal: 0, profit: 2_000_000 });
    expect(preview.participants).toContainEqual(expect.objectContaining({ walletId: "other", hole: 0, coveredByNextIncome: 1_500_000, balanceNow: 0, balanceAfter: 0 }));
  });

  it("UC-207 AC-10: hôm nay 15/11 → POST { month: \"2026-09\" } → 400 month_not_closable; GET trả tháng 2026-10", async () => {
    vi.setSystemTime(new Date("2026-11-15T03:00:00.000Z"));
    for (const month of ["2026-09", "2026-11"]) {
      const res = await call("POST", "/v1/month-close", { month });
      expect(res.status, month).toBe(400);
      expect(res.json.error?.code, month).toBe("month_not_closable");
    }
    for (const month of ["2026-1", "10-2026", "", 202610]) {
      const res = await call("POST", "/v1/month-close", { month });
      expect(res.json.error?.code, String(month)).toBe("invalid_input");
    }
    expect((await call("GET", "/v1/month-close")).json.data.month).toBe("2026-10");
    expect(closeRows()).toEqual([]);
  });

  it("UC-207: chốt muộn sau khi đã tiêu tiền dư tháng 10 sang tháng 11 → warnings liệt kê ví thành âm kèm số sau chốt", async () => {
    flow("food", 500_000);
    flow("food", -800_000, "2026-11");
    const preview = (await call("GET", "/v1/month-close")).json.data;
    expect(preview.warnings).toEqual([{ walletId: "food", name: "Ăn uống", balanceAfter: -800_000 }]);
    expect(preview.participants).toEqual([expect.objectContaining({ walletId: "food", monthEndBalance: 500_000, balanceNow: -300_000, toWealth: 500_000, balanceAfter: -800_000 })]);
  });

  it("UC-207: hai POST cùng lúc → một 201, một 409 already_closed; chỉ một bộ bút toán S…", async () => {
    flow("food", 400_000);
    const results = await Promise.all([call("POST", "/v1/month-close", { month: "2026-10" }), call("POST", "/v1/month-close", { month: "2026-10" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.json.error?.code).toBe("already_closed");
    expect(sweepTx("S202610")).toHaveLength(1);
    expect(closeRows()).toHaveLength(1);
  });

  it("UC-207: Ví Thưởng đã tắt → coi như chưa đặt (wealthPct 100, rewardWalletId null)", async () => {
    await setReward(30);
    flow("food", 100_000);
    raw.prepare("UPDATE wallets SET active = 0 WHERE id = 'reward'").run();
    expect((await call("GET", "/v1/month-close")).json.data).toMatchObject({ rewardWalletId: null, wealthPct: 100, defaultWealthPct: 100, toWealth: 100_000, toReward: 0 });
    // Ví Thưởng hết hợp lệ (đổi thành phong bì chung) cũng vậy.
    raw.prepare("UPDATE wallets SET active = 1, kind = 'envelope' WHERE id = 'reward'").run();
    expect((await call("GET", "/v1/month-close")).json.data).toMatchObject({ rewardWalletId: null, wealthPct: 100 });
  });
});
