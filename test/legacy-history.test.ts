// Giao dịch "cách tính cũ" sau v2 (ledger UC-102, ADR-123, ADR-131): dữ liệu trước 0039 (ví, lần chia, lệnh chuyển) đã lên 1.40
// vẫn huỷ / sửa được theo luật mới — huỷ khoản thu cũ đã chia huỷ luôn fund cùng lô; khoản mới không có loại chi cũ.
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1 } from "./helpers/d1-sqlite";
import { openLegacyDb } from "./helpers/legacy";

/** Hộ v1.38: khoản thu 10.000.000 đã chia (lô A900: 3.000.000 Tích sản + 7.000.000 Có thì tốt), lệnh 'done'; khoản chi cũ trừ ví. */
function legacy(): DatabaseSync {
  return openLegacyDb((db) =>
    db.exec(`
      UPDATE accounts SET sepay_enabled = 0, opened_at = NULL;
      INSERT INTO transactions (id, at, amount, meaning, wallet_id, counter_account_id, week_key, month_key, source)
        VALUES (900, '2026-10-10T01:00:00.000Z', 10000000, 'income', 'thu-nhap', 'vcb-anh', '2026-W41', '2026-10', 'manual');
      INSERT INTO allocation_runs (income_tx_id, batch_id) VALUES (900, 'A900');
      INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, link_id, batch_id, week_key, month_key, source) VALUES
        ('2026-10-10T01:00:00.000Z', 3000000, 'fund', 'tich-san', 'thu-nhap', 900, 'A900', '2026-W41', '2026-10', 'system'),
        ('2026-10-10T01:00:00.000Z', 7000000, 'fund', 'co-thi-tot', 'thu-nhap', 900, 'A900', '2026-W41', '2026-10', 'system');
      INSERT INTO transfer_orders (batch_id, from_account_id, to_account_id, amount, memo, status) VALUES ('A900', 'vcb-anh', 'tcb-anh', 3000000, 'PF AAAAAA', 'done');
      INSERT INTO transactions (id, at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key, source)
        VALUES (950, '2026-10-12T03:00:00.000Z', 300000, 'spend', 'an', 'tien-mat-anh', 'cho-nau', '2026-W42', '2026-10', 'manual');
    `),
  );
}

const call = (db: DatabaseSync) => {
  const env = { DB: asD1(db), API_TOKEN: "tok" } as Env;
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(
      path,
      { method, headers: { Authorization: "Bearer tok", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined },
      env,
    );
    return { status: res.status, json: (await res.json()) as { ok: boolean; data: Record<string, unknown>; error?: { code: string } } };
  };
};
const rows = (db: DatabaseSync, sql: string) => db.prepare(sql).all();

describe("giao dịch cách tính cũ sau v2 (UC-102)", () => {
  it("UC-102 AC-27, AC-2: huỷ khoản thu cũ đã chia (lô có lệnh done) → khoản thu và mọi fund cùng lô void, không lỗi; bút toán fund không huỷ lẻ được", async () => {
    const db = legacy();
    const api = call(db);
    const fund = (db.prepare("SELECT id FROM transactions WHERE meaning = 'fund' LIMIT 1").get() as { id: number }).id;
    expect((await api("POST", `/v1/transactions/${fund}/void`)).json.error?.code).toBe("system_tx");
    const res = await api("POST", "/v1/transactions/900/void");
    expect(res.status).toBe(200);
    expect(rows(db, "SELECT DISTINCT status FROM transactions WHERE id = 900 OR batch_id = 'A900'")).toEqual([{ status: "void" }]);
    expect(rows(db, "SELECT COUNT(*) AS n FROM pay_cycles")).toEqual([{ n: 0 }]);
  });

  it("UC-102 AC-27, AC-11: sửa khoản chi cũ → dòng mới không loại chi cũ (legacy false), dòng cũ void giữ legacy_class; sửa khoản thu cũ đã chia → fund cùng lô void, khoản mới không chia", async () => {
    const db = legacy();
    const api = call(db);
    const spend = await api("POST", "/v1/transactions/950/replace", { meaning: "spend", amount: 350_000, category_id: "cho-nau", account_id: "tien-mat-anh" });
    expect(spend.json.error ?? null).toBeNull();
    expect(spend.status).toBe(201);
    expect(spend.json.data.tx).toMatchObject({ legacy_class: null, legacy: false, amount: 350_000 });
    expect(db.prepare("SELECT status, legacy_class FROM transactions WHERE id = 950").get()).toEqual({ status: "void", legacy_class: "essential" });
    const income = await api("POST", "/v1/transactions/900/replace", { meaning: "income", amount: 12_000_000, account_id: "vcb-anh", at: "2026-10-10T08:00:00+07:00" });
    expect(income.status).toBe(201);
    expect(rows(db, "SELECT COUNT(*) AS n FROM transactions WHERE meaning = 'fund' AND status = 'active'")).toEqual([{ n: 0 }]);
    expect(income.json.data.tx).toMatchObject({ legacy_class: null, allocated: 0 });
  });
});
