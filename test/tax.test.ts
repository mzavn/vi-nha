import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { allocateIncome, createEntry, getTax, settleTax } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";

async function setup() {
  const raw = openDb();
  // Bối cảnh: nhà chưa nối bank feed — mọi tài khoản đều ghi tay (tài khoản đã nối feed thì không nhận nhập tay).
  raw.prepare("UPDATE accounts SET sepay_enabled = 0").run();
  const db = asD1(raw);
  const now = new Date("2026-06-01T03:00:00Z");
  // Thu nhập ngoài 20tr chịu thuế → trích 2tr vào ví Thuế
  const { tx } = await createEntry(db, { meaning: "income", amount: 20_000_000, account_id: "vcb-husband", taxable: true, at: "2026-05-10T09:00:00+07:00" }, "husband", now);
  await allocateIncome(db, Number(tx!.id));
  return { raw, db };
}

describe("quyết toán thuế năm", () => {
  it("thừa thì chuyển phần thừa sang Tích sản, sinh lệnh chuyển MB → TCB, chỉ quyết toán một lần", async () => {
    const { raw, db } = await setup();
    await raw
      .prepare(
        `INSERT INTO categories (id, name, default_wallet_id) VALUES ('nop-thue', 'Nộp thuế', 'tax')`,
      )
      .run();
    await createEntry(db, { meaning: "spend", amount: 1_500_000, category_id: "nop-thue", account_id: "mb-husband", at: "2026-12-20T09:00:00+07:00" }, "husband", new Date("2026-12-21T00:00:00Z"));
    expect(await getTax(db, 2026)).toMatchObject({ provisioned: 2_000_000, paid: 1_500_000, difference: 500_000, walletBalance: 500_000 });

    const settled = await settleTax(db, 2026, new Date("2027-01-05T03:00:00Z"));
    expect(settled.surplus).toBe(500_000);
    expect(settled.settlement).toMatchObject({ year: 2026, provisioned: 2_000_000, paid: 1_500_000 });
    expect(settled.settlement?.surplus_tx_id).toEqual(expect.any(Number));
    expect(raw.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = 'tax'").get()).toEqual({ balance: 0 });
    expect(raw.prepare("SELECT from_account_id, to_account_id, amount, memo FROM transfer_orders WHERE batch_id = 'T2026'").all()).toEqual([
      { from_account_id: "mb-husband", to_account_id: "tcb-husband", amount: 500_000, memo: expect.stringMatching(/^PF [A-Z2-9]{6}$/) },
    ]);
    await expect(settleTax(db, 2026, new Date("2027-01-06T03:00:00Z"))).rejects.toMatchObject({ code: "already_settled" });
  });

  it("chưa hết năm thì không cho quyết toán", async () => {
    const { db } = await setup();
    await expect(settleTax(db, 2026, new Date("2026-12-31T03:00:00Z"))).rejects.toMatchObject({ code: "year_not_over" });
  });

  it("REST: năm sai định dạng → 400", async () => {
    const env = { DB: asD1(openDb()), API_TOKEN: "tok" } as Env;
    const res = await app.request("/v1/tax/abc", { headers: { Authorization: "Bearer tok" } }, env);
    expect(res.status).toBe(400);
  });
});
