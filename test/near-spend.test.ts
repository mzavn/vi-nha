// Tiền vận hành (ledger UC-103, ADR-122): tổng ngăn Vận hành, đếm ngược tới ngày lương, dịch ra mỗi ngày / mỗi bữa / mỗi lần
// đi chợ. Không trừ nợ; không còn lệnh chuyển, không còn trường theo ví / vai trò tài khoản (Đợt E).
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nearSpend, nearSpendView, nextPayday, type NearSpend } from "../src/domain/snapshot";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { getSnapshot } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { B_NOW, householdB } from "./helpers/household-b";
import { AT, client, householdC } from "./helpers/household-c";

let env: Env;
let raw: DatabaseSync;

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string; field?: string } };
async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(
    `https://app.example.com${path}`,
    { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}

/** 11/11/2026 giờ VN. */
const NOW = new Date("2026-11-11T03:00:00Z");
const near = async (now = NOW): Promise<NearSpend> => (await getSnapshot(env.DB, null, now)).nearSpend;

const line = (id: string, balance: number) => ({ id, name: id, balance, goalIds: [], parentId: null });

describe("tiền vận hành — công thức (hàm thuần)", () => {
  it("UC-103 AC-20: tiền vận hành = tổng ngăn Vận hành 4.100.000 → kỳ lương 10/12, còn 29 ngày, 141.000/ngày, 70.000/bữa, 140.000/lần đi chợ; excluded chỉ có ngăn (heo đất ở pocket savings); không leaving, không misplaced", () => {
    const operating = { total: 4_100_000, accounts: [line("main", 3_000_000), line("spend", 1_400_000), line("card", -300_000)], goals: [], remaining: 0 };
    const accounts = [
      { id: "main", name: "main", pocket: "operating" as const },
      { id: "wealth", name: "wealth", pocket: "savings" as const },
      { id: "piggy", name: "piggy", pocket: "savings" as const },
      { id: "momo", name: "momo", pocket: null },
    ];
    const r = nearSpend(operating, accounts, "2026-11-11", 10, { salaryPayday: null, pendingTasks: 0 });
    expect(r).toMatchObject({ amount: 4_100_000, paydayDay: 10, payday: "2026-12-10", daysLeft: 29, perDay: 141_000, perMeal: 70_000, perMarket: 140_000, pendingTasks: 0, salaryPayday: null });
    expect(r.accounts).toEqual([
      { accountId: "main", name: "main", balance: 3_000_000 },
      { accountId: "spend", name: "spend", balance: 1_400_000 },
      { accountId: "card", name: "card", balance: -300_000 },
    ]);
    expect(r.excluded).toEqual([
      { accountId: "wealth", name: "wealth", pocket: "savings" },
      { accountId: "piggy", name: "piggy", pocket: "savings" },
      { accountId: "momo", name: "momo", pocket: null },
    ]);
    expect(r).not.toHaveProperty("leaving");
    expect(r).not.toHaveProperty("misplaced");
  });

  it("UC-103 AC-18: ngày lương là ngày đầu kỳ — 10/12 → kỳ 10/1 còn 31 ngày; 9/12 → còn 1 ngày; ngày lương 31 ở tháng 2 → ngày cuối tháng", () => {
    expect(nearSpendView(4_100_000, "2026-12-10", 10)).toMatchObject({ payday: "2027-01-10", daysLeft: 31 });
    expect(nearSpendView(4_100_000, "2026-12-09", 10)).toMatchObject({ payday: "2026-12-10", daysLeft: 1 });
    expect(nextPayday("2027-02-10", 31)).toBe("2027-02-28");
    expect(nextPayday("2028-02-10", 31)).toBe("2028-02-29");
    expect(nextPayday("2027-02-28", 31)).toBe("2027-03-31");
    expect(nextPayday("2026-12-31", 31)).toBe("2027-01-31");
    expect(nextPayday("2026-11-30", 1)).toBe("2026-12-01");
  });

  it("UC-103 AC-18: tiền vận hành −500.000 hay 0 → cả ba số null; còn tiền mà mỗi ngày dưới 1.000 / mỗi bữa dưới 5.000 / đi chợ dưới 10.000 thì số đó null; làm tròn xuống từ số mỗi ngày đã tròn", () => {
    expect(nearSpendView(-500_000, "2026-11-11", 10)).toMatchObject({ daysLeft: 29, perDay: null, perMeal: null, perMarket: null });
    expect(nearSpendView(0, "2026-11-11", 10)).toMatchObject({ perDay: null, perMeal: null, perMarket: null });
    expect(nearSpendView(20_000, "2026-11-11", 10)).toMatchObject({ perDay: null, perMeal: null, perMarket: null });
    expect(nearSpendView(290_000, "2026-11-11", 10)).toMatchObject({ perDay: 10_000, perMeal: 5_000, perMarket: 10_000 });
    expect(nearSpendView(260_000, "2026-11-11", 10)).toMatchObject({ perDay: 8_000, perMeal: null, perMarket: null });
    expect(nearSpendView(4_142_459, "2026-11-11", 10)).toMatchObject({ perDay: 142_000, perMeal: 70_000, perMarket: 140_000 });
  });
});

describe("tiền vận hành — snapshot theo ngăn (hộ mẫu B)", () => {
  let b: DatabaseSync;
  const nearB = async (): Promise<NearSpend> => (await getSnapshot(asD1(b), null, B_NOW)).nearSpend;
  beforeEach(() => {
    b = householdB();
  });

  it("UC-103 AC-20: nearSpend.amount 4.100.000 = pockets.operating.total; tài khoản ngăn Vận hành; excluded có ngăn, không vai trò; không misplaced / leaving", async () => {
    const snap = await getSnapshot(asD1(b), null, B_NOW);
    expect(snap.nearSpend).toMatchObject({ amount: 4_100_000, payday: "2026-12-10", daysLeft: 29, perDay: 141_000, perMeal: 70_000, perMarket: 140_000 });
    expect(snap.nearSpend).not.toHaveProperty("misplaced");
    expect(snap.nearSpend).not.toHaveProperty("leaving");
    expect(snap.nearSpend.amount).toBe(snap.pockets.operating.total);
    expect(snap.nearSpend.accounts.map((a) => a.name).sort()).toEqual(["thẻ tín dụng", "tài khoản chi tiêu", "tài khoản chính"].sort());
    expect(snap.nearSpend.excluded).toEqual(
      expect.arrayContaining([
        { accountId: "tcb-husband", name: "tài khoản tích luỹ", pocket: "savings" },
        { accountId: "piggy", name: "heo đất", pocket: "savings" },
        { accountId: "mb-husband", name: "tài khoản tiết kiệm", pocket: "reserve" },
        { accountId: "b-tuition-acc", name: "tài khoản học phí", pocket: "reserve" },
        { accountId: "momo", name: "ví điện tử", pocket: null },
      ]),
    );
    expect(snap.nearSpend.excluded).toHaveLength(8);
  });

  it("UC-103 AC-21: không còn lệnh chuyển — không khoá leaving / attention cũ; −500.000 → ba số null", async () => {
    const snap = await getSnapshot(asD1(b), null, B_NOW);
    expect(snap.nearSpend).toMatchObject({ amount: 4_100_000 });
    expect(snap.nearSpend).not.toHaveProperty("leaving");
    for (const k of ["unallocatedIncome", "transferOrdersPending", "transferOrdersOverdue"]) expect(snap.attention).not.toHaveProperty(k);
    b.exec("UPDATE accounts SET opening_balance = opening_balance - 4600000 WHERE id = 'vcb-husband'");
    expect(await nearB()).toMatchObject({ amount: -500_000, perDay: null, perMeal: null, perMarket: null });
  });
});

describe("ngày lương (tham số payday_day)", () => {
  it("UC-507 AC-19: PUT /v1/settings/config payday_day 31 → lưu, GET /v1/settings trả config.payday_day; 0 / 32 / 1,5 → 400 invalid_input, không đổi; chưa đặt → 10", async () => {
    expect((await call<{ config: { payday_day: number } }>("GET", "/v1/settings")).json.data.config.payday_day).toBe(10);
    const ok = await call<{ payday_day: number }>("PUT", "/v1/settings/config", { payday_day: 31 });
    expect(ok.status).toBe(200);
    expect(ok.json.data.payday_day).toBe(31);
    for (const bad of [0, 32, 1.5]) {
      const res = await call("PUT", "/v1/settings/config", { payday_day: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(res.json.error).toMatchObject({ code: "invalid_input" });
    }
    expect((await call<{ config: { payday_day: number } }>("GET", "/v1/settings")).json.data.config.payday_day).toBe(31);
  });

  it("UC-709 AC-34: đặt ngày lương 5 → snapshot tính tới ngày 5 (11/11 → 5/12, còn 24 ngày)", async () => {
    expect((await call("PUT", "/v1/settings/config", { payday_day: 5 })).status).toBe(200);
    expect(await near()).toMatchObject({ paydayDay: 5, payday: "2026-12-05", daysLeft: 24 });
  });
});

describe("số mỗi ngày theo payday_day, lương về sớm (UC-103 AC-26)", () => {
  const vn = (s: string) => new Date(`${s}+07:00`);
  let c: DatabaseSync;
  let callC: ReturnType<typeof client>;
  const salary = (amount: number, at: string, o: Record<string, unknown> = {}) =>
    callC("POST", "/v1/transactions", { meaning: "income", amount, account_id: "main", income_stream_id: "salary", at: AT(at), ...o });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(vn("2026-12-10T09:00:00"));
    c = householdC();
    callC = client(c);
    // Khoản phải trả còn 3.500.000 tháng 12 (mục tiêu trả từ tiền chi tiêu).
    c.exec("INSERT INTO reserve_goals (id, name, account_id, target_amount, monthly_amount, repeat_months, pays_from, sort) VALUES ('rent', 'Tiền nhà', NULL, 3500000, 3500000, 1, 'operating', 9)");
  });
  afterEach(() => vi.useRealTimers());

  it("UC-103 AC-26: 12/12, Vận hành 21.200.000, ① 2.000.000 mở, phải trả 3.500.000 → 29 ngày, 541.000/ngày; lương về sớm 5/1 → salaryPayday 10/1, 36 ngày; khoản thứ hai không đổi; payday_day 5 → không lương sớm; không khoá kỳ", async () => {
    expect((await salary(20_000_000, "2026-12-10T08:00:00")).status).toBe(201);
    const s = await getSnapshot(asD1(c), "husband", vn("2026-12-12T09:00:00"));
    expect(s.nearSpend).toMatchObject({ amount: 21_200_000, daysLeft: 29, pendingTasks: 2_000_000, goalRemaining: 3_500_000, perDay: 541_000, perMeal: 270_000, perMarket: 540_000, salaryPayday: null });
    for (const k of ["cyclePayday", "payCycle", "paySetup"]) {
      expect(s.nearSpend).not.toHaveProperty(k);
      expect(s).not.toHaveProperty(k);
    }

    vi.setSystemTime(vn("2027-01-05T09:00:00"));
    await salary(20_000_000, "2027-01-05T08:00:00");
    const early = await getSnapshot(asD1(c), "husband", vn("2027-01-05T09:00:00"));
    expect(early.nearSpend).toMatchObject({ salaryPayday: "2027-01-10", payday: "2027-02-10", daysLeft: 36 });
    // PWA tính lại bằng đúng luật (hàm dùng chung).
    expect(nearSpendView(early.nearSpend.amount, "2027-01-05", 10, { salaryPayday: early.nearSpend.salaryPayday, pendingTasks: 0 }).daysLeft).toBe(36);
    vi.setSystemTime(vn("2027-01-07T09:00:00"));
    await salary(15_000_000, "2027-01-07T08:00:00", { income_stream_id: null, is_salary: true });
    expect((await getSnapshot(asD1(c), "husband", vn("2027-01-07T09:00:00"))).nearSpend).toMatchObject({ salaryPayday: "2027-01-10", daysLeft: 34 });

    c.exec("UPDATE config SET v = '5' WHERE k = 'payday_day'");
    vi.setSystemTime(vn("2027-01-01T09:00:00"));
    c.exec("UPDATE transactions SET status = 'void' WHERE at >= '2027-01-01'");
    await salary(20_000_000, "2027-01-01T08:00:00");
    expect((await getSnapshot(asD1(c), "husband", vn("2027-01-01T09:00:00"))).nearSpend).toMatchObject({ salaryPayday: null, daysLeft: 4 });
  });

  it("UC-103 AC-26: lương vợ về 5/1 là khoản lương đầu tiên trong cửa sổ → tính là lương sớm", async () => {
    vi.setSystemTime(vn("2027-01-05T09:00:00"));
    await salary(15_000_000, "2027-01-05T08:00:00", { income_stream_id: null, is_salary: true });
    expect((await getSnapshot(asD1(c), "husband", vn("2027-01-05T09:00:00"))).nearSpend).toMatchObject({ salaryPayday: "2027-01-10", daysLeft: 36 });
  });
});

describe("tuổi tiền ngăn Vận hành (UC-103 AC-27, chỉ đo)", () => {
  let m: DatabaseSync;
  const at = (day: string, hh = "09") => new Date(`${day}T${hh}:00:00+07:00`).toISOString();
  const tx = (day: string, amount: number, meaning: string, from: string | null, to: string | null, hh = "09") =>
    m
      .prepare("INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, category_id, week_key, month_key, source) VALUES (?, ?, ?, ?, ?, ?, '2026-W45', ?, 'manual')")
      .run(at(day, hh), amount, meaning, from, to, meaning === "spend" ? "groceries" : null, day.slice(0, 7));
  const age = async (day = "2026-11-20") => (await getSnapshot(asD1(m), null, new Date(at(day, "21")))).moneyAge;
  beforeEach(() => {
    m = openDb();
    m.exec(`
      UPDATE reserve_goals SET active = 0;
      UPDATE accounts SET active = 0;
      INSERT INTO accounts (id, name, kind, opening_balance, pocket, pocket_confirmed) VALUES
        ('op', 'Chi tiêu', 'bank', 0, 'operating', 1), ('op2', 'Chi tiêu vợ', 'bank', 0, 'operating', 1), ('sv', 'Tích luỹ', 'bank', 0, 'savings', 1);
    `);
    // Lô đầu cửa sổ 10.000.000 ngày 1/11; lương 20.000.000 ngày 10/11; chi 1.000.000 mỗi ngày 2/11 → 20/11.
    tx("2026-11-01", 10_000_000, "income", null, "op", "07");
    tx("2026-11-10", 20_000_000, "income", null, "op", "07");
    for (let d = 2; d <= 20; d++) tx(`2026-11-${String(d).padStart(2, "0")}`, 1_000_000, "spend", "op", null);
  });

  it("UC-103 AC-27: 10 khoản gần nhất tuổi 10, 2, 3, …, 10 → { days: 6, sample: 10, buffered: false }; chuyển giữa hai tài khoản Vận hành bỏ qua; số mỗi ngày không đổi", async () => {
    expect(await age()).toEqual({ days: 6, sample: 10, buffered: false });
    const before = (await getSnapshot(asD1(m), null, new Date(at("2026-11-20", "21")))).nearSpend;
    tx("2026-11-15", 3_000_000, "transfer", "op", "op2");
    expect(await age()).toEqual({ days: 6, sample: 10, buffered: false });
    const after = (await getSnapshot(asD1(m), null, new Date(at("2026-11-20", "21")))).nearSpend;
    expect([after.daysLeft, after.perDay]).toEqual([before.daysLeft, before.perDay]);
  });

  it("UC-103 AC-27: chuyển sang Tích luỹ tiêu lô nhưng không vào mẫu; hoàn tiền là lô vào mới; chưa đủ 10 khoản chi → null; từ 30 ngày → buffered", async () => {
    // Chuyển 5.000.000 sang Tích luỹ ngày 1/11 (trước mọi khoản chi): tiêu nửa lô đầu, khoản chi 7/11 trở đi sang lương sớm hơn.
    tx("2026-11-01", 5_000_000, "transfer", "op", "sv", "08");
    const shifted = await age();
    expect(shifted?.sample).toBe(10);
    expect(shifted!.days).toBeLessThan(6);
    m.exec("DELETE FROM transactions WHERE meaning = 'spend' AND at >= '2026-11-11'");
    expect(await age()).toBeNull();

    m.exec("DELETE FROM transactions");
    tx("2026-09-01", 30_000_000, "income", null, "op", "07");
    for (let d = 1; d <= 10; d++) tx(`2026-10-${String(d).padStart(2, "0")}`, 100_000, "spend", "op", null);
    tx("2026-10-09", 200_000, "refund", null, "op", "07");
    expect(await age("2026-10-10")).toEqual({ days: 34, sample: 10, buffered: true });
  });
});
