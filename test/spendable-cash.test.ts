// Tiền chi được (ADR-85): tiền thật ở tài khoản đang tính − Tích sản đang giữ − Thuế đang giữ; tài khoản Tích sản (heo đất,
// phao, sổ tiết kiệm — ADR-88) không tính và phần Tích sản nằm ở đó không trừ lại. Công tắc mỗi tài khoản ở Cài đặt (`accounts.spendable`).
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { spendableCash, type SpendableCash } from "../src/domain/snapshot";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: DatabaseSync;

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(
    `https://app.example.com${path}`,
    { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}
const cash = async () => (await call<{ spendableCash: SpendableCash }>("GET", "/v1/snapshot")).json.data.spendableCash;
type Acct = Parameters<typeof spendableCash>[0][number];
const acct = (id: string, balance: number, over: Partial<Acct> = {}): Acct => ({ id, name: id, role: null, locked: false, spendable: true, balance, ...over });
const piggyBank = (id: string, balance: number) => acct(id, balance, { role: "piggy_bank", locked: true, spendable: false });

describe("tiền chi được — công thức (hàm thuần)", () => {
  it("cộng tài khoản đang tính, trừ Tích sản ngoài heo và Thuế; heo và tài khoản tắt nằm ở danh sách không tính", () => {
    const r = spendableCash(
      [acct("mb-spending-husband", 3_200_000), acct("mb-spending-wife", 230_000), acct("cash", 500_000), acct("credit-card", -1_500_000, { spendable: false }), piggyBank("piggy-bank-husband", 5_000), piggyBank("piggy-bank-wife", 71_300)],
      2_076_300,
      600_000,
    );
    expect(r).toEqual({
      amount: 3_930_000 - 2_000_000 - 600_000,
      accounts: [
        { accountId: "mb-spending-husband", name: "mb-spending-husband", balance: 3_200_000 },
        { accountId: "mb-spending-wife", name: "mb-spending-wife", balance: 230_000 },
        { accountId: "cash", name: "cash", balance: 500_000 },
      ],
      wealthBuildingHeld: 2_000_000,
      wealthBuildingOutside: 76_300,
      taxHeld: 600_000,
      excluded: [
        { accountId: "credit-card", name: "credit-card", role: null },
        { accountId: "piggy-bank-husband", name: "piggy-bank-husband", role: "piggy_bank" },
        { accountId: "piggy-bank-wife", name: "piggy-bank-wife", role: "piggy_bank" },
      ],
    });
  });

  it("heo nhiều hơn Tích sản: không trừ Tích sản; tài khoản khóa không bao giờ tính dù cột bật; Tích sản / Thuế âm không cộng ngược", () => {
    const r = spendableCash([acct("vcb", 1_000_000), acct("piggy_bank", 50_000, { role: "piggy_bank", locked: true, spendable: true })], 20_000, -300);
    expect(r).toMatchObject({ amount: 1_000_000, wealthBuildingHeld: 0, wealthBuildingOutside: 20_000, taxHeld: 0 });
    expect(r.accounts.map((a) => a.accountId)).toEqual(["vcb"]);
    expect(spendableCash([acct("vcb", 0)], -5_000, 0)).toMatchObject({ amount: 0, wealthBuildingHeld: 0 });
  });

  it("phao và sổ tiết kiệm không tính giữ Tích sản như heo (ADR-88); tài khoản thường tắt công tắc hay thẻ tín dụng thì không — sổ không biết tiền trong đó là gì", () => {
    const accounts = [
      acct("mb-spending-husband", 2_000_000),
      acct("buffer", 200_000, { role: "buffer", spendable: false }),
      acct("term-deposit", 800_000, { role: "term_deposit", locked: true, spendable: false }),
      acct("private-savings", 5_000_000, { spendable: false }),
      acct("credit-card", -300_000, { spendable: false }),
    ];
    expect(spendableCash(accounts, 1_500_000, 0)).toMatchObject({ amount: 2_000_000 - 500_000, wealthBuildingHeld: 500_000, wealthBuildingOutside: 1_000_000 });
    // Phao bật "Tính vào tiền chi được": nó là tài khoản đang tính, phần Tích sản trong đó bị trừ như mọi tài khoản đang tính.
    accounts[1] = acct("buffer", 200_000, { role: "buffer" });
    expect(spendableCash(accounts, 1_500_000, 0)).toMatchObject({ amount: 2_200_000 - 700_000, wealthBuildingHeld: 700_000, wealthBuildingOutside: 800_000 });
  });

  it("không có tài khoản nào đang tính: âm đúng bằng phần phải giữ", () => {
    expect(spendableCash([acct("vcb", 9_000_000, { spendable: false })], 3_000_000, 1_000_000).amount).toBe(-4_000_000);
  });
});

describe("tiền chi được — snapshot và công tắc tài khoản", () => {
  beforeEach(async () => {
    raw.prepare("UPDATE accounts SET opening_balance = 500000 WHERE id = 'cash-husband'").run();
    // Tài khoản ngân hàng của seed đã nối SePay (không nhập tay được): thu vào tiền mặt của vợ.
    const income = await call<{ tx: { id: number } }>("POST", "/v1/transactions", { meaning: "income", amount: 10_000_000, account_id: "cash-wife", taxable: true, at: new Date().toISOString() });
    expect((await call("POST", "/v1/allocate", { income_tx_id: income.json.data.tx.id })).status).toBe(201);
  });

  it("GET /v1/snapshot: Σ số dư sổ tài khoản đang tính − Tích sản đang giữ − Thuế đang giữ", async () => {
    const sc = await cash();
    expect(sc).toMatchObject({ amount: 10_500_000 - 3_000_000 - 1_000_000, wealthBuildingHeld: 3_000_000, wealthBuildingOutside: 0, taxHeld: 1_000_000, excluded: [] });
    expect(sc.accounts).toContainEqual({ accountId: "cash-wife", name: "Tiền mặt (vợ)", balance: 10_000_000 });
    expect(sc.accounts).toContainEqual({ accountId: "cash-husband", name: "Tiền mặt (chồng)", balance: 500_000 });
  });

  it("tắt Tính vào tiền chi được của một tài khoản: số giảm đúng số dư của nó, tài khoản sang danh sách không tính; bật lại như cũ", async () => {
    const before = (await cash()).amount;
    const off = await call("PATCH", "/v1/settings/accounts/cash-husband", { spendable: false });
    expect(off.json.data).toMatchObject({ spendable: false, locked: false });
    const sc = await cash();
    expect(sc.amount).toBe(before - 500_000);
    expect(sc.accounts.map((a) => a.accountId)).not.toContain("cash-husband");
    expect(sc.excluded).toEqual([{ accountId: "cash-husband", name: "Tiền mặt (chồng)", role: null }]);
    await call("PATCH", "/v1/settings/accounts/cash-husband", { spendable: true });
    expect((await cash()).amount).toBe(before);
  });

  it("thêm tài khoản: mặc định tính, thẻ tín dụng mặc định không tính (số dư thẻ là nợ), gửi tay thì theo người gửi", async () => {
    expect((await call("POST", "/v1/settings/accounts", { name: "MoMo", kind: "ewallet", bank: "MoMo" })).json.data).toMatchObject({ spendable: true });
    expect((await call("POST", "/v1/settings/accounts", { name: "Thẻ VCB", kind: "credit" })).json.data).toMatchObject({ spendable: false });
    expect((await call("POST", "/v1/settings/accounts", { name: "Thẻ TCB", kind: "credit", spendable: true })).json.data).toMatchObject({ spendable: true });
    expect((await call("POST", "/v1/settings/accounts", { name: "Tiết kiệm", kind: "bank", spendable: false })).json.data).toMatchObject({ spendable: false });
  });

  it("heo đất (tài khoản khóa) không bật được Tính vào tiền chi được; vẫn sửa được tên", async () => {
    raw.prepare("INSERT INTO accounts (id, name, kind, bank, locked, spendable, role) VALUES ('piggy-bank-husband', 'Heo đất MB (Chồng)', 'bank', 'MBBank', 1, 0, 'piggy_bank')").run();
    const res = await call("PATCH", "/v1/settings/accounts/piggy-bank-husband", { spendable: true });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatchObject({ code: "locked_account", message: "Tài khoản đã khóa (heo đất, sổ tiết kiệm) không tính vào tiền chi được." });
    expect(raw.prepare("SELECT spendable FROM accounts WHERE id = 'piggy-bank-husband'").get()).toEqual({ spendable: 0 });
    expect((await call("PATCH", "/v1/settings/accounts/piggy-bank-husband", { name: "Heo (Chồng)" })).json.data).toMatchObject({ name: "Heo (Chồng)", locked: true, spendable: false });
    expect((await cash()).excluded).toEqual([{ accountId: "piggy-bank-husband", name: "Heo (Chồng)", role: "piggy_bank" }]);
  });
});
