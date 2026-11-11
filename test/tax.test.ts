// Quyết toán thuế năm (ledger UC-110, ADR-125, ADR-131): khoản cũ (id ≤ legacy_max_tx_id) chỉ đọc legacy_class = 'tax'; khoản
// mới theo tài khoản của mục tiêu Thuế. Quyết toán không ghi dòng nào vào sổ.
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { getTax, settleTax } from "../src/services/ledger";
import { asD1, migratedDb, openDb } from "./helpers/d1-sqlite";
import { householdE } from "./helpers/household-e";
import { householdShared, sharedTx } from "./helpers/household-shared";
import { openLegacyDb } from "./helpers/legacy";

/** Khoản mới (sau 0040) ghi thẳng vào sổ: chuyển khoản / khoản chi. */
function newTx(db: DatabaseSync, at: string, amount: number, meaning: "transfer" | "spend", from: string, to: string | null) {
  db.prepare(
    `INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, category_id, week_key, month_key, source)
     VALUES (?, ?, ?, ?, ?, ?, '2026-W01', ?, 'manual')`,
  ).run(at, amount, meaning, from, to, meaning === "spend" ? "qua-bieu" : null, at.slice(0, 7));
}

/** Năm 2026: `fund` 1.000.000 vào ví Thuế trước v2; sau v2 tài khoản thuế (gắn mục tiêu Thuế, số dư đầu 1.500.000) nhận 500.000, chi nộp thuế 1.200.000 → số dư 800.000. */
function household() {
  const raw = openLegacyDb((db) => {
    db.exec(`
      INSERT INTO transactions (id, at, amount, meaning, wallet_id, counter_account_id, week_key, month_key, source)
        VALUES (900, '2026-03-10T01:00:00.000Z', 10000000, 'income', 'thu-nhap', 'vcb-anh', '2026-W11', '2026-03', 'manual');
      INSERT INTO allocation_runs (income_tx_id, batch_id) VALUES (900, 'A900');
      INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, link_id, batch_id, week_key, month_key, source)
        VALUES ('2026-03-10T01:00:00.000Z', 1000000, 'fund', 'thue', 'thu-nhap', 900, 'A900', '2026-W11', '2026-03', 'system');
      UPDATE accounts SET pocket = 'reserve', opening_balance = 1500000 WHERE id = 'mb-anh';
    `);
  });
  raw.exec("UPDATE reserve_goals SET account_id = 'mb-anh' WHERE id = 'thue'");
  newTx(raw, "2026-06-01T03:00:00.000Z", 500_000, "transfer", "vcb-anh", "mb-anh");
  newTx(raw, "2026-12-20T03:00:00.000Z", 1_200_000, "spend", "mb-anh", null);
  return raw;
}

const count = (raw: DatabaseSync, sql: string) => (raw.prepare(sql).get() as { n: number }).n;

describe("quyết toán thuế năm (UC-110)", () => {
  it("UC-110 AC-5: tài khoản thuế nhận 500.000, chi nộp thuế 1.200.000, số dư 800.000 + fund cũ 1.000.000 → đã trích 1.500.000, đã nộp 1.200.000, đang giữ 800.000; quyết toán → move 300.000 sang Tích luỹ, không giao dịch mới; lần hai already_settled", async () => {
    const raw = household();
    const db = asD1(raw);
    expect(await getTax(db, 2026)).toMatchObject({ provisioned: 1_500_000, paid: 1_200_000, difference: 300_000, held: 800_000 });
    const txBefore = count(raw, "SELECT COUNT(*) AS n FROM transactions");
    const settled = await settleTax(db, 2026, new Date("2027-01-05T03:00:00Z"));
    expect(settled).toMatchObject({ surplus: 300_000, move: { amount: 300_000, toPocket: "savings" }, held: 800_000 });
    expect(settled.settlement).toMatchObject({ year: 2026, provisioned: 1_500_000, paid: 1_200_000, surplus_tx_id: null });
    expect(count(raw, "SELECT COUNT(*) AS n FROM transactions")).toBe(txBefore);
    await expect(settleTax(db, 2026, new Date("2027-01-06T03:00:00Z"))).rejects.toMatchObject({ code: "already_settled" });
  });

  it("UC-110 AC-4: không còn phần thừa thì quyết toán không ghi dòng nào vào sổ", async () => {
    const raw = household();
    newTx(raw, "2026-12-21T03:00:00.000Z", 500_000, "spend", "mb-anh", null);
    const txBefore = count(raw, "SELECT COUNT(*) AS n FROM transactions");
    const settled = await settleTax(asD1(raw), 2026, new Date("2027-01-05T03:00:00Z"));
    expect(settled.surplus).toBe(0);
    expect(settled.settlement).toMatchObject({ surplus_tx_id: null });
    expect(count(raw, "SELECT COUNT(*) AS n FROM transactions")).toBe(txBefore);
  });

  it("UC-110 AC-6: không mục tiêu Thuế gắn tài khoản, không khoản cũ loại Thuế → 400 config", async () => {
    const raw = migratedDb();
    await expect(getTax(asD1(raw), 2026)).rejects.toMatchObject({ code: "config", message: "Chưa có mục tiêu Thuế." });
  });

  it("UC-110 AC-7: hộ mẫu E sau 0040, không mục tiêu Thuế gắn tài khoản → đã trích 1.000.000, đã nộp 1.000.000 (đọc legacy_class), đang giữ 0", async () => {
    expect(await getTax(asD1(householdE()), 2026)).toMatchObject({ provisioned: 1_000_000, paid: 1_000_000, held: 0 });
  });

  it("UC-110 AC-8: ví Thuế cũ ở X rồi gắn mục tiêu Thuế vào X — khoản cũ chỉ theo legacy_class, khoản mới theo tài khoản; không cộng hai lần", async () => {
    const raw = openLegacyDb((db) => {
      db.exec(`
        UPDATE accounts SET pocket = 'reserve' WHERE id = 'mb-anh';
        INSERT INTO transactions (id, at, amount, meaning, wallet_id, counter_account_id, week_key, month_key, source)
          VALUES (900, '2026-03-10T01:00:00.000Z', 10000000, 'income', 'thu-nhap', 'vcb-anh', '2026-W11', '2026-03', 'manual');
        INSERT INTO allocation_runs (income_tx_id, batch_id) VALUES (900, 'A900');
        INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, link_id, batch_id, week_key, month_key, source)
          VALUES ('2026-03-10T01:00:00.000Z', 1000000, 'fund', 'thue', 'thu-nhap', 900, 'A900', '2026-W11', '2026-03', 'system');
        INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, week_key, month_key, source)
          VALUES ('2026-03-11T01:00:00.000Z', 1000000, 'transfer', 'vcb-anh', 'mb-anh', '2026-W11', '2026-03', 'manual');
        INSERT INTO transactions (at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key, source) VALUES
          ('2026-04-10T01:00:00.000Z', 400000, 'spend', 'thue', 'mb-anh', 'qua-bieu', '2026-W15', '2026-04', 'manual'),
          ('2026-04-11T01:00:00.000Z', 100000, 'spend', 'an', 'mb-anh', 'cho-nau', '2026-W15', '2026-04', 'manual');
      `);
    });
    raw.exec("UPDATE reserve_goals SET account_id = 'mb-anh' WHERE id = 'thue'");
    newTx(raw, "2026-12-02T03:00:00.000Z", 300_000, "transfer", "vcb-anh", "mb-anh");
    newTx(raw, "2026-12-03T03:00:00.000Z", 200_000, "spend", "mb-anh", null);
    expect(await getTax(asD1(raw), 2026)).toMatchObject({ provisioned: 1_300_000, paid: 600_000 });
  });

  it("chưa hết năm thì không cho quyết toán", async () => {
    await expect(settleTax(asD1(household()), 2026, new Date("2026-12-31T03:00:00Z"))).rejects.toMatchObject({ code: "year_not_over" });
  });

  it("REST: năm sai định dạng → 400", async () => {
    const env = { DB: asD1(openDb()), API_TOKEN: "tok" } as Env;
    const res = await app.request("/v1/tax/abc", { headers: { Authorization: "Bearer tok" } }, env);
    expect(res.status).toBe(400);
  });
});

describe("Thuế giữ tài khoản riêng (UC-110 AC-9)", () => {
  it("UC-110 AC-9: TK thuế nhận 500.000, chi nộp thuế 200.000; tài khoản chung chi học phí 6.000.000; gắn Hiếu hỉ vào TK thuế → 409 tax_account_shared; GET /v1/tax/2026 provisioned 500.000, paid 200.000, held 300.000 — khoản học phí không ở đã nộp", async () => {
    const raw = householdShared();
    raw.exec("UPDATE accounts SET opening_balance = 0 WHERE id = 'tk-thue'");
    raw.exec("UPDATE reserve_goals SET account_id = NULL WHERE id = 'hieu-hi'");
    sharedTx(raw, { at: "2026-06-01 10:00", meaning: "transfer", amount: 500_000, from: "vcb-husband", to: "tk-thue" });
    sharedTx(raw, { at: "2026-07-01 10:00", meaning: "spend", amount: 200_000, from: "tk-thue", goal: "thue" });
    sharedTx(raw, { at: "2026-11-12 09:00", meaning: "spend", amount: 6_000_000, from: "tk-tiet-kiem", goal: "hoc-tap" });
    const env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
    const req = (method: string, path: string, body?: unknown) =>
      app.request(path, { method, headers: { Authorization: "Bearer tok", "X-Member-Id": "husband", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const linked = await req("PATCH", "/v1/settings/goals/hieu-hi", { account_id: "tk-thue" });
    expect([linked.status, ((await linked.json()) as { error: { code: string } }).error.code]).toEqual([409, "tax_account_shared"]);
    const tax = ((await (await req("GET", "/v1/tax/2026")).json()) as { data: { provisioned: number; paid: number; held: number } }).data;
    expect([tax.provisioned, tax.paid, tax.held]).toEqual([500_000, 200_000, 300_000]);
  });
});
