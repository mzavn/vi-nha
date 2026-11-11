// Màn chuyển đổi một lần sang ba ngăn (pocket UC-1208, ADR-130): trạng thái ở server (config.conversion_state + mỗi bước một
// dòng conversion_claims), thứ tự 5 bước, điều kiện từng bước, mọi 409 kèm steps / next, hai máy cùng lúc chỉ một bên thắng.
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { E_ACCOUNTS, householdE } from "./helpers/household-e";
import { legacyEmptyDb, openLegacyDb, upgradingD1 } from "./helpers/legacy";

type Json = { ok: boolean; data: any; error?: { code: string; message: string; field?: string }; steps?: string[]; next?: string | null };

function client(d1: D1Database) {
  const env = { DB: d1, API_TOKEN: "tok" } as Env;
  return async (method: string, path: string, body?: unknown) => {
    const res = await app.request(
      path,
      { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
      env,
    );
    return { status: res.status, json: (await res.json()) as Json };
  };
}

const config = (db: DatabaseSync, k: string) => (db.prepare("SELECT v FROM config WHERE k = ?").get(k) as { v: string } | undefined)?.v;
const audits = (db: DatabaseSync, action: string) => db.prepare("SELECT target, detail FROM audit_log WHERE action = ? ORDER BY id").all(action) as { target: string; detail: string | null }[];

let db: DatabaseSync;
let call: ReturnType<typeof client>;
const step = (name: string, body?: unknown) => call("POST", `/v1/conversion/steps/${name}`, body);

/** Bước 1 bằng dữ liệu (xác nhận mọi tài khoản) rồi POST. */
async function doPockets() {
  db.exec("UPDATE accounts SET pocket_confirmed = 1");
  expect((await step("pockets")).status).toBe(200);
}
async function doGoals() {
  db.exec(`UPDATE reserve_goals SET account_id = '${E_ACCOUNTS.deposit}' WHERE id = 'hoc-phi'`);
  expect((await step("goals")).status).toBe(200);
}
async function throughPayCycle() {
  await doPockets();
  await doGoals();
  expect((await step("savings_gap")).status).toBe(200);
  expect((await step("pay_cycle")).status).toBe(200);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T09:00:00+07:00"));
  db = householdE();
  call = client(asD1(db));
});
afterEach(() => vi.useRealTimers());

describe("chuyển sang ba ngăn (UC-1208)", () => {
  it("UC-1208 AC-1: 0040 đặt pending, đóng băng 7.000.000 / 2.000.000; GET /v1/conversion đủ số; snapshot conversion { 0, 5, pockets }; D1 trống và nhà thiết lập bằng v2 → không khoá, state null, snapshot null", async () => {
    expect([config(db, "conversion_state"), config(db, "legacy_savings_cash"), config(db, "legacy_savings_assets")]).toEqual(["pending", "7000000", "2000000"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM conversion_claims").get()).toEqual({ n: 0 });
    expect((await call("GET", "/v1/conversion")).json.data).toEqual({
      state: "pending",
      steps: [],
      next: "pockets",
      savingsGap: { legacyCash: 7_000_000, legacyAssets: 2_000_000, realSavings: 6_000_000, diff: -1_000_000, hasSavingsAccount: true },
    });
    expect((await call("GET", "/v1/snapshot")).json.data.conversion).toEqual({ done: 0, total: 5, next: "pockets" });

    const empty = legacyEmptyDb();
    const emptyCall = client(upgradingD1(empty));
    expect((await emptyCall("GET", "/v1/conversion")).json.data).toEqual({ state: null, steps: [], next: "pockets", savingsGap: null });
    expect((await emptyCall("GET", "/v1/snapshot")).json.data.conversion).toBeNull();
    expect(empty.prepare("SELECT k FROM config WHERE k LIKE 'conversion%' OR k LIKE 'legacy%'").all()).toEqual([]);

    const fresh = openDb();
    const freshCall = client(asD1(fresh));
    expect((await freshCall("GET", "/v1/conversion")).json.data).toMatchObject({ state: null, savingsGap: null });
    expect((await freshCall("GET", "/v1/snapshot")).json.data.conversion).toBeNull();
    expect(fresh.prepare("SELECT k FROM config WHERE k LIKE 'conversion%' OR k LIKE 'legacy%'").all()).toEqual([]);
  });

  it("UC-1208 AC-2: goals trước → 409 step_order (next pockets); pockets khi còn 6 tài khoản chưa xác nhận → 409 step_incomplete; xác nhận (kể cả đổi tài khoản tiết kiệm sang Tích luỹ) → 200; gửi lại → 409 step_order, next goals; bước lạ → 404", async () => {
    const early = await step("goals");
    expect(early.status).toBe(409);
    expect(early.json).toMatchObject({ ok: false, error: { code: "step_order" }, steps: [], next: "pockets" });
    const incomplete = await step("pockets");
    expect(incomplete.status).toBe(409);
    expect(incomplete.json).toMatchObject({ error: { code: "step_incomplete", message: "Còn 6 tài khoản chưa xác nhận ngăn" }, steps: [], next: "pockets" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM conversion_claims").get()).toEqual({ n: 0 });

    // Học phí chỉ đề xuất tài khoản tiết kiệm, chưa gắn → đổi ngăn được.
    db.exec(`UPDATE accounts SET pocket = 'savings' WHERE id = '${E_ACCOUNTS.deposit}'; UPDATE accounts SET pocket_confirmed = 1`);
    const ok = await step("pockets");
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({ state: "pending", steps: ["pockets"], next: "goals" });
    const again = await step("pockets");
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ error: { code: "step_order" }, steps: ["pockets"], next: "goals" });
    expect(audits(db, "conversion.step")).toEqual([{ target: "conversion:pockets", detail: JSON.stringify({ step: "pockets" }) }]);
    expect((await step("khong-co")).status).toBe(404);
  });

  it("UC-1208 AC-3: gắn Học phí, Hoá đơn vào tài khoản mới số dư 0, Thuế để sau → POST goals 200 (server không đòi gắn); phần an tâm 5.000.000; Thuế chưa có tài khoản", async () => {
    await doPockets();
    db.exec(`
      INSERT INTO accounts (id, name, kind, owner_member_id, opening_balance, pocket, pocket_confirmed) VALUES ('tk-hoa-don', 'Tài khoản hoá đơn', 'bank', 'anh', 0, 'reserve', 1);
      UPDATE reserve_goals SET account_id = '${E_ACCOUNTS.deposit}' WHERE id = 'hoc-phi';
      UPDATE reserve_goals SET account_id = 'tk-hoa-don' WHERE id = 'hoa-don';
    `);
    const res = await step("goals");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ steps: ["pockets", "goals"], next: "savings_gap" });
    const reserve = (await call("GET", "/v1/snapshot")).json.data.pockets.reserve;
    expect(reserve.peace).toBe(5_000_000);
    expect(reserve.goals.find((g: { id: string }) => g.id === "hoc-phi")).toMatchObject({ held: 10_000_000 });
    expect(reserve.goals.find((g: { id: string }) => g.id === "hoa-don")).toMatchObject({ held: 0 });
    expect(reserve.goals.find((g: { id: string }) => g.id === "thue")).toMatchObject({ accountId: null, held: null });
    expect(db.prepare("SELECT active, account_id FROM reserve_goals WHERE id = 'thue'").get()).toEqual({ active: 1, account_id: null });
  });

  it("UC-1208 AC-4: bước 3 chỉ đọc — 7.000.000 / 2.000.000 / 6.000.000 / −1.000.000, POST savings_gap 200; nhà một tài khoản → 3.000.000 / 0 / −3.000.000, không tài khoản Tích luỹ, mọi mục tiêu để sau vẫn qua bước 2", async () => {
    await doPockets();
    await doGoals();
    const before = (await call("GET", "/v1/conversion")).json.data;
    expect(before.savingsGap).toEqual({ legacyCash: 7_000_000, legacyAssets: 2_000_000, realSavings: 6_000_000, diff: -1_000_000, hasSavingsAccount: true });
    expect((await step("savings_gap")).json.data).toMatchObject({ steps: ["pockets", "goals", "savings_gap"], next: "pay_cycle" });

    const single = openLegacyDb((d) =>
      d.exec(`
        UPDATE accounts SET sepay_enabled = 0, opened_at = NULL;
        UPDATE accounts SET active = 0 WHERE id <> 'vcb-anh';
        UPDATE accounts SET name = 'Tài khoản chính', opening_balance = 9000000, pocket = 'operating' WHERE id = 'vcb-anh';
        INSERT INTO transactions (id, at, amount, meaning, wallet_id, counter_account_id, week_key, month_key, source)
          VALUES (900, '2026-11-10T01:00:00.000Z', 3000000, 'income', 'thu-nhap', 'vcb-anh', '2026-W46', '2026-11', 'manual');
        INSERT INTO allocation_runs (income_tx_id, batch_id) VALUES (900, 'A900');
        INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, link_id, batch_id, week_key, month_key, source)
          VALUES ('2026-11-10T01:00:00.000Z', 3000000, 'fund', 'tich-san', 'thu-nhap', 900, 'A900', '2026-W46', '2026-11', 'system');
      `),
    );
    const s = client(asD1(single));
    expect((await s("GET", "/v1/conversion")).json.data.savingsGap).toEqual({ legacyCash: 3_000_000, legacyAssets: 0, realSavings: 0, diff: -3_000_000, hasSavingsAccount: false });
    single.exec("UPDATE accounts SET pocket_confirmed = 1");
    expect((await s("POST", "/v1/conversion/steps/pockets")).status).toBe(200);
    expect((await s("POST", "/v1/conversion/steps/goals")).status).toBe(200);
    const snap = (await s("GET", "/v1/snapshot")).json.data.pockets;
    expect([snap.savings.total, snap.reserve.total, snap.operating.total]).toEqual([0, 0, 12_000_000]);
  });

  it("UC-1208 AC-5: tắt Lương, POST pay_cycle không thân → 409 step_incomplete; { no_salary: true } → 200, nhật ký có no_salary, paySetup.hasCycleStream false; nhánh khác: bật hai nguồn → 200", async () => {
    await doPockets();
    await doGoals();
    await step("savings_gap");
    db.exec("UPDATE income_streams SET opens_cycle = 0");
    const none = await step("pay_cycle");
    expect(none.status).toBe(409);
    expect(none.json).toMatchObject({ error: { code: "step_incomplete" }, next: "pay_cycle" });
    const ok = await step("pay_cycle", { no_salary: true });
    expect(ok.status).toBe(200);
    expect(ok.json.data.next).toBe("savings_pct");
    expect(audits(db, "conversion.step").at(-1)).toEqual({ target: "conversion:pay_cycle", detail: JSON.stringify({ step: "pay_cycle", no_salary: true }) });
    expect((await call("GET", "/v1/snapshot")).json.data.paySetup).toEqual({ hasCycleStream: false });

    db = householdE();
    call = client(asD1(db));
    await doPockets();
    await doGoals();
    await step("savings_gap");
    db.exec("UPDATE income_streams SET opens_cycle = 1 WHERE id IN ('luong-chong', 'luong-vo')");
    const two = await step("pay_cycle");
    expect(two.status).toBe(200);
    expect(audits(db, "conversion.step").at(-1)).toEqual({ target: "conversion:pay_cycle", detail: JSON.stringify({ step: "pay_cycle" }) });
  });

  it("UC-1208 AC-6: savings_pct 0 → 400 chưa kết thúc; 15 → savings_pct '15', done, conversion_done_at, nhật ký conversion.done; snapshot conversion null; GET state done còn savingsGap; POST bất kỳ → 409 conversion_not_pending", async () => {
    await throughPayCycle();
    const zero = await step("savings_pct", { savings_pct: 0 });
    expect([zero.status, zero.json.error?.code, zero.json.error?.field]).toEqual([400, "invalid_input", "savings_pct"]);
    expect(config(db, "conversion_state")).toBe("pending");
    expect(config(db, "savings_pct")).toBe("10");

    const done = await step("savings_pct", { savings_pct: 15 });
    expect(done.status).toBe(200);
    expect(done.json.data).toMatchObject({ state: "done", steps: ["pockets", "goals", "savings_gap", "pay_cycle", "savings_pct"], next: null });
    expect([config(db, "savings_pct"), config(db, "conversion_state"), config(db, "conversion_done_at")]).toEqual(["15", "done", "2026-12-01T02:00:00.000Z"]);
    expect(audits(db, "conversion.done")).toHaveLength(1);
    expect((await call("GET", "/v1/snapshot")).json.data.conversion).toBeNull();
    expect((await call("GET", "/v1/conversion")).json.data).toMatchObject({
      state: "done",
      savingsGap: { legacyCash: 7_000_000, legacyAssets: 2_000_000, realSavings: 6_000_000, diff: -1_000_000, hasSavingsAccount: true },
    });
    const after = await step("pockets");
    expect(after.status).toBe(409);
    expect(after.json).toMatchObject({ error: { code: "conversion_not_pending" }, next: null });
    expect(after.json.steps).toHaveLength(5);
  });

  it("UC-1208 AC-8: hai máy cùng gửi savings_pct 15 và 20 → đúng một 200, một 409; savings_pct theo bên thắng; một conversion.done, một conversion.step savings_pct. Cùng phép thử cho goals → một conversion.step", async () => {
    await doPockets();
    db.exec(`UPDATE reserve_goals SET account_id = '${E_ACCOUNTS.deposit}' WHERE id = 'hoc-phi'`);
    const goals = await Promise.all([step("goals"), step("goals")]);
    expect(goals.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(goals.find((r) => r.status === 409)!.json).toMatchObject({ error: { code: "step_order" }, next: "savings_gap" });
    expect(audits(db, "conversion.step").filter((a) => a.target === "conversion:goals")).toHaveLength(1);

    expect((await step("savings_gap")).status).toBe(200);
    expect((await step("pay_cycle")).status).toBe(200);
    const [a, b] = await Promise.all([step("savings_pct", { savings_pct: 15 }), step("savings_pct", { savings_pct: 20 })]);
    expect([a!.status, b!.status].sort()).toEqual([200, 409]);
    const loser = a!.status === 409 ? a! : b!;
    expect(["step_order", "conversion_not_pending"]).toContain(loser.json.error?.code);
    expect(config(db, "savings_pct")).toBe(a!.status === 200 ? "15" : "20");
    expect(audits(db, "conversion.done")).toHaveLength(1);
    expect(audits(db, "conversion.step").filter((x) => x.target === "conversion:savings_pct")).toHaveLength(1);
    expect(config(db, "conversion_state")).toBe("done");
  });

  it("UC-1208 AC-10: batch bước 5 lỗi vì trigger khác → 500 Lỗi hệ thống (không phải step_order), không claim, vẫn pending, không nhật ký; gỡ trigger rồi gửi lại → 200; lần ba → 409 conversion_not_pending", async () => {
    await throughPayCycle();
    db.exec(`
      CREATE TRIGGER trg_test_done_insert BEFORE INSERT ON config WHEN NEW.k = 'conversion_done_at' BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: test'); END;
      CREATE TRIGGER trg_test_done_update BEFORE UPDATE ON config WHEN NEW.k = 'conversion_done_at' BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: test'); END;
    `);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await step("savings_pct", { savings_pct: 10 });
    error.mockRestore();
    expect([failed.status, failed.json.error?.code, failed.json.error?.message]).toEqual([500, "internal", "Lỗi hệ thống. Thử lại sau."]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM conversion_claims WHERE step = 'savings_pct'").get()).toEqual({ n: 0 });
    expect(config(db, "conversion_state")).toBe("pending");
    expect([audits(db, "conversion.done"), audits(db, "conversion.step").filter((a) => a.target === "conversion:savings_pct")]).toEqual([[], []]);

    db.exec("DROP TRIGGER trg_test_done_insert; DROP TRIGGER trg_test_done_update;");
    expect((await step("savings_pct", { savings_pct: 10 })).status).toBe(200);
    expect(config(db, "conversion_state")).toBe("done");
    const third = await step("savings_pct", { savings_pct: 10 });
    expect([third.status, third.json.error?.code]).toEqual([409, "conversion_not_pending"]);
  });
});

describe("bước 2 cho chung tài khoản (UC-1208 AC-11)", () => {
  it("UC-1208 AC-11: Nhà ở và Học tập cùng chọn MB tiết kiệm → hai PATCH 200, chia theo thứ tự hạn; Thuế vào tài khoản đó → 409 tax_account_shared; POST …/steps/goals 200", async () => {
    await doPockets();
    db.exec(`
      UPDATE accounts SET name = 'MB tiết kiệm', opening_balance = 12000000 WHERE id = '${E_ACCOUNTS.deposit}';
      UPDATE reserve_goals SET active = 0 WHERE id IN ('hoc-phi', 'hoa-don');
      INSERT INTO reserve_goals (id, name, target_amount, monthly_amount, repeat_months, due_date, sort) VALUES
        ('nha-o', 'Nhà ở', 7500000, 7500000, 1, '2026-12-05', 10), ('hoc-tap', 'Học tập', 6000000, NULL, NULL, '2027-01-15', 20);
    `);
    for (const id of ["nha-o", "hoc-tap"]) expect((await call("PATCH", `/v1/settings/goals/${id}`, { account_id: E_ACCOUNTS.deposit })).status).toBe(200);
    const tax = await call("PATCH", "/v1/settings/goals/thue", { account_id: E_ACCOUNTS.deposit });
    expect([tax.status, tax.json.error?.code]).toEqual([409, "tax_account_shared"]);
    const group = (await call("GET", "/v1/snapshot")).json.data.pockets.reserve.groups.find((g: { accountId: string }) => g.accountId === E_ACCOUNTS.deposit);
    expect(group).toMatchObject({ balance: 12_000_000, need: 13_500_000, short: 1_500_000, goalIds: ["nha-o", "hoc-tap"] });
    expect((await step("goals")).status).toBe(200);
  });
});
