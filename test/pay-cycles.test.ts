// Kỳ lương, danh sách việc ngày lương, dư kỳ trước — qua REST trên hộ mẫu C (change 261112-ba-ngan-duong-ghi; mục tiêu là
// tài khoản thật từ Đợt E, ADR-132): pocket UC-1205, UC-1206, UC-1207, UC-1203 AC-8; ledger UC-101 AC-28, 29, UC-103 AC-21, 22.
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { ingestLog } from "../src/services/ingest";
import { afterWrite, linkTaskStatement, payCycleView } from "../src/services/pay-cycles";
import { asD1 } from "./helpers/d1-sqlite";
import { AT, client, householdC } from "./helpers/household-c";
import { householdShared } from "./helpers/household-shared";

let db: DatabaseSync;
let call: ReturnType<typeof client>;
const at = (vn: string) => vi.setSystemTime(new Date(`${vn}+07:00`));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T08:30:00");
  db = householdC();
  call = client(db);
});
afterEach(() => vi.useRealTimers());

const one = <T = Record<string, unknown>>(sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) as T;
const all = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as Record<string, unknown>[];
/** Số dư sổ của tài khoản (= A của mục tiêu gắn tài khoản đó). */
const bal = (id: string) => one<{ b: number }>("SELECT book_balance AS b FROM v_account_book WHERE account_id = ?", id).b;
const salary = (amount: number, vn: string, o: Record<string, unknown> = {}) =>
  call("POST", "/v1/transactions", { meaning: "income", amount, account_id: "main", income_stream_id: "salary", at: AT(vn), ...o });
const transfer = (amount: number, from: string, to: string, vn: string) =>
  call("POST", "/v1/transactions", { meaning: "transfer", amount, account_id: from, to_account_id: to, at: AT(vn) });
const snap = async () => (await call("GET", "/v1/snapshot")).json.data;
type Task = { id: number; kind: string; amount: number; status: string; goal: { id: string; name: string } | null; toAccountId: string | null; toPocket: string | null; missing: number };
/** [loại, tên mục tiêu / tài khoản đích (④ → Ví Thưởng) / ngăn đích, số, trạng thái]. */
const brief = (s: { payCycle: { tasks: Task[] } }) => s.payCycle.tasks.map((t) => [t.kind, t.goal?.name ?? t.toAccountId ?? t.toPocket, t.amount, t.status]);
const taskId = async (kind: string, key: string) => {
  const s = await snap();
  return (s.payCycle.tasks as Task[]).find((t) => t.kind === kind && (t.goal?.id ?? t.toAccountId ?? t.toPocket) === key)!.id;
};

describe("kỳ lương: lương về mở kỳ (UC-1205)", () => {
  it("UC-1205 AC-1: lương 20.000.000 lúc 10/11 08:00 → một khoản thu không ví, một kỳ mới (ngày lương 10/11, mở lúc 08:00) cùng batch với việc; kỳ 10/10 thôi là kỳ hiện tại; khoản chi 07:55 thuộc kỳ trước; gửi lại cùng client_id vẫn một khoản, một kỳ; nhật ký pay_cycle.open", async () => {
    const r = await salary(20_000_000, "2026-11-10T08:00:00", { client_id: "salary-1110-abc" });
    expect(r.status).toBe(201);
    expect(r.json.data.effects.cycle).toEqual({ opened: true, startedAt: AT("2026-11-10T08:00:00"), payday: "2026-11-10", tasks: 5 });
    const tx = one<{ id: number }>("SELECT id FROM transactions WHERE client_id = 'salary-1110-abc'");
    expect(r.json.data.tx).not.toHaveProperty("wallet_id");
    expect(all("SELECT payday, started_at, income_tx_id, status FROM pay_cycles ORDER BY payday")).toEqual([
      { payday: "2026-10-10", started_at: "2026-10-10T01:00:00.000Z", income_tx_id: 1, status: "active" },
      { payday: "2026-11-10", started_at: AT("2026-11-10T08:00:00"), income_tx_id: tx.id, status: "active" },
    ]);
    expect(all("SELECT COUNT(*) AS n FROM allocation_runs")).toEqual([{ n: 0 }]);
    const s = await snap();
    expect(s.payCycle).toMatchObject({ payday: "2026-11-10", startedAt: AT("2026-11-10T08:00:00"), nextPayday: "2026-12-10", lateDays: 0, prevOperating: 1_200_000, openCount: 5 });
    expect(AT("2026-11-10T07:55:00") < s.payCycle.startedAt).toBe(true);
    const again = await salary(20_000_000, "2026-11-10T08:00:00", { client_id: "salary-1110-abc" });
    expect(again.json.data.duplicate).toBe(true);
    expect(one("SELECT COUNT(*) AS n FROM transactions WHERE meaning = 'income' AND status = 'active'")).toEqual({ n: 2 });
    expect(one("SELECT COUNT(*) AS n FROM pay_cycles")).toEqual({ n: 2 });
    expect(one("SELECT action, detail FROM audit_log WHERE action = 'pay_cycle.open'")).toEqual({ action: "pay_cycle.open", detail: JSON.stringify({ income_tx_id: tx.id, payday: "2026-11-10" }) });
  });

  it("UC-1205 AC-1: hai khoản lương cùng ngày lương danh nghĩa ghi đồng thời → đúng một kỳ, khoản kia nhập vào kỳ đó với việc ① của nó", async () => {
    const [a, b] = await Promise.all([salary(20_000_000, "2026-11-10T08:00:00"), salary(8_000_000, "2026-11-10T08:01:00", { income_stream_id: "side", opens_cycle: true })]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(one("SELECT COUNT(*) AS n FROM pay_cycles WHERE payday = '2026-11-10'")).toEqual({ n: 1 });
    const s = await snap();
    expect(s.payCycle.tasks.filter((t: { kind: string }) => t.kind === "savings").map((t: { amount: number }) => t.amount).sort()).toEqual([2_000_000, 800_000]);
  });

  it("UC-1205 AC-1: batch lỗi ở bước chèn việc → không có khoản thu, không kỳ", async () => {
    const d1 = asD1(db);
    const failing = {
      ...d1,
      prepare: d1.prepare.bind(d1),
      batch: async (stmts: { sql: string }[]) => {
        if (stmts.some((s) => /INSERT INTO pay_cycle_tasks/.test(s.sql))) {
          db.exec("BEGIN");
          db.exec("ROLLBACK");
          throw new Error("D1_ERROR: giả lập lỗi khi chèn việc");
        }
        return d1.batch(stmts as unknown as D1PreparedStatement[]);
      },
    } as unknown as D1Database;
    const env = { DB: failing, API_TOKEN: "tok", APP_PASSWORD: "x" } as Env;
    const res = await app.request(
      "/v1/transactions",
      { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ meaning: "income", amount: 20_000_000, account_id: "main", income_stream_id: "salary", at: AT("2026-11-10T08:00:00") }) },
      env,
    );
    expect(res.status).toBe(500);
    expect(one("SELECT COUNT(*) AS n FROM transactions WHERE amount = 20000000")).toEqual({ n: 0 });
    expect(one("SELECT COUNT(*) AS n FROM pay_cycles")).toEqual({ n: 1 });
  });

  it("UC-1205 AC-2: lương sớm 4/12 mở kỳ 10/12; 2/12 nhập vào kỳ 10/11; lương thứ hai 13/11 nhập vào; 12/12 chưa lương → trễ 2 ngày; lương 12/12 → kỳ 10/12, hết trễ", async () => {
    await salary(20_000_000, "2026-11-10T08:00:00");
    at("2026-11-13T09:00:00");
    await salary(5_000_000, "2026-11-13T09:00:00");
    expect(one("SELECT COUNT(*) AS n FROM pay_cycles")).toEqual({ n: 2 });
    at("2026-12-02T09:00:00");
    const joined = await salary(5_000_000, "2026-12-02T09:00:00");
    expect(joined.json.data.effects.cycle).toMatchObject({ opened: false, payday: "2026-11-10" });
    at("2026-12-12T07:00:00");
    expect((await snap()).payCycle).toMatchObject({ payday: "2026-11-10", lateDays: 2 });
    await salary(20_000_000, "2026-12-12T09:00:00");
    expect((await snap()).payCycle).toMatchObject({ payday: "2026-12-10", lateDays: 0 });

    db = householdC();
    call = client(db);
    await salary(20_000_000, "2026-11-10T08:00:00");
    at("2026-12-04T08:00:00");
    expect((await salary(20_000_000, "2026-12-04T08:00:00")).json.data.effects.cycle).toMatchObject({ opened: true, payday: "2026-12-10" });
  });

  it("UC-1205 AC-2: đổi payday_day 10 → 25 ngày 15/11: kỳ 10/11 giữ ngày lương; lương 25/11 mở kỳ 25/11", async () => {
    await salary(20_000_000, "2026-11-10T08:00:00");
    db.exec("UPDATE config SET v = '25' WHERE k = 'payday_day'");
    at("2026-11-15T09:00:00");
    expect((await snap()).payCycle.payday).toBe("2026-11-10");
    at("2026-11-25T09:00:00");
    await salary(20_000_000, "2026-11-25T09:00:00");
    expect((await snap()).payCycle.payday).toBe("2026-11-25");
  });

  it("UC-1205 AC-3: tiền thuê, Việc phụ, Lương với opens_cycle false không mở kỳ; thu không nguồn opens_cycle true mở kỳ 10/12; tiền thuê opens_cycle true → 400 cannot_open_cycle; opens_cycle true với khoản chi → 400 invalid_input", async () => {
    await salary(20_000_000, "2026-11-10T08:00:00");
    at("2026-12-08T09:00:00");
    const cycles = () => one<{ n: number }>("SELECT COUNT(*) AS n FROM pay_cycles").n;
    await call("POST", "/v1/transactions", { meaning: "income", amount: 4_000_000, account_id: "savings", income_stream_id: "rental", at: AT("2026-12-08T08:00:00") });
    await call("POST", "/v1/transactions", { meaning: "income", amount: 3_000_000, account_id: "main", income_stream_id: "side", at: AT("2026-12-08T08:10:00") });
    await salary(9_000_000, "2026-12-08T08:20:00", { opens_cycle: false });
    expect(cycles()).toBe(2);
    const bad = await call("POST", "/v1/transactions", { meaning: "income", amount: 4_000_000, account_id: "savings", income_stream_id: "rental", opens_cycle: true });
    expect([bad.status, bad.json.error?.code]).toEqual([400, "cannot_open_cycle"]);
    const spend = await call("POST", "/v1/transactions", { meaning: "spend", amount: 1000, account_id: "main", category_id: "groceries", opens_cycle: true });
    expect([spend.status, spend.json.error?.code]).toEqual([400, "invalid_input"]);
    const odd = await call("POST", "/v1/transactions", { meaning: "income", amount: 1000, account_id: "main", opens_cycle: "yes" });
    expect([odd.status, odd.json.error?.code]).toEqual([400, "invalid_input"]);
    await call("POST", "/v1/transactions", { meaning: "income", amount: 9_000_000, account_id: "main", opens_cycle: true, at: AT("2026-12-08T09:00:00") });
    expect((await snap()).payCycle.payday).toBe("2026-12-10");
  });

  it("UC-1205 AC-4: huỷ khoản lương mở kỳ (sau khi tick tay ①) → kỳ và mọi việc void, kỳ 10/10 lại là kỳ hiện tại, số dư không đổi; nhật ký pay_cycle.void; lương ghi lùi 5/10 → không kỳ; lương cùng ngày lương 07:30 ghi sau → nhập vào, thêm ① 600.000, mở lúc vẫn 08:00", async () => {
    const r = await salary(20_000_000, "2026-11-10T08:00:00");
    const id = r.json.data.tx.id;
    const done = await call("POST", `/v1/pay-cycle-tasks/${await taskId("savings", "savings")}/done`);
    expect(done.status).toBe(200);
    const pockets0 = (await snap()).pockets;
    expect((await call("POST", `/v1/transactions/${id}/void`)).status).toBe(200);
    expect(all("SELECT status FROM pay_cycle_tasks WHERE cycle_id = (SELECT id FROM pay_cycles WHERE income_tx_id = ?)", id).every((t) => t.status === "void")).toBe(true);
    const after = await snap();
    expect(after.payCycle.payday).toBe("2026-10-10");
    expect(after.pockets.savings.total).toBe(pockets0.savings.total);
    expect(after.pockets.reserve.total).toBe(pockets0.reserve.total);
    expect(one<{ action: string }>("SELECT action FROM audit_log WHERE action = 'pay_cycle.void'").action).toBe("pay_cycle.void");

    await salary(20_000_000, "2026-11-10T08:00:00");
    const tasks = () => one<{ n: number }>("SELECT COUNT(*) AS n FROM pay_cycle_tasks WHERE status <> 'void'").n;
    const before = tasks();
    await salary(15_000_000, "2026-10-05T08:00:00");
    expect(one("SELECT COUNT(*) AS n FROM pay_cycles WHERE status = 'active'")).toEqual({ n: 2 });
    expect(tasks()).toBe(before);

    at("2026-11-11T02:00:00");
    await salary(6_000_000, "2026-11-10T07:30:00");
    const s = await snap();
    expect(s.payCycle.startedAt).toBe(AT("2026-11-10T08:00:00"));
    expect(s.payCycle.tasks.filter((t: { kind: string }) => t.kind === "savings").map((t: { amount: number }) => t.amount)).toEqual([2_000_000, 600_000]);
  });
});

describe("danh sách việc ngày lương (UC-1206)", () => {
  it("UC-1206 AC-1, UC-1207 AC-1, UC-103 AC-21: việc đúng thứ tự và số; dư kỳ trước 1.200.000 chia 600.000 / 600.000; snapshot 21.200.000, chưa làm 5.960.000, 30 ngày, 508.000/ngày; chi 500.000 sau khi mở kỳ không đổi dư kỳ trước", async () => {
    await salary(20_000_000, "2026-11-10T08:00:00");
    const s = await snap();
    expect(brief(s)).toEqual([
      ["savings", "savings", 2_000_000, "open"],
      ["goal", "Học phí", 2_000_000, "open"],
      ["goal", "Bảo dưỡng xe", 760_000, "open"],
      ["surplus", "savings", 600_000, "open"],
      ["surplus", "bonus", 600_000, "open"],
    ]);
    expect(s.payCycle.tasks[0]).toMatchObject({ pct: 10, source: { amount: 20_000_000, streamName: "Lương" }, toAccountId: null });
    expect(s.payCycle.tasks[1]).toMatchObject({ goal: { id: "school", held: 4_000_000, target: 6_000_000, accountId: "reserve" }, toAccountId: "reserve" });
    expect(s.payCycle.tasks[4]).toMatchObject({ goal: null, toAccountId: "bonus", toPocket: null });
    expect(one("SELECT goal_id, to_account_id, to_pocket FROM pay_cycle_tasks WHERE id = ?", s.payCycle.tasks[4].id)).toEqual({ goal_id: null, to_account_id: "bonus", to_pocket: null });
    expect(s.nearSpend).toMatchObject({ amount: 21_200_000, pendingTasks: 5_960_000, payday: "2026-12-10", daysLeft: 30, perDay: 508_000 });
    expect(s.paySetup).toEqual({ hasCycleStream: true });
    await call("POST", "/v1/transactions", { meaning: "spend", amount: 500_000, account_id: "main", category_id: "groceries" });
    expect((await snap()).payCycle.prevOperating).toBe(1_200_000);
  });

  it("UC-1207 AC-1: tài khoản chính −300.000 trước lương → không việc ④, dư âm lưu lại; lương về tài khoản tích luỹ → dư kỳ trước vẫn 1.200.000, không ①; bỏ chọn Ví Thưởng → một việc → Tích luỹ; tài khoản Ví Thưởng đã tắt / không còn ngăn Dự phòng → chỉ việc → Tích luỹ", async () => {
    db.exec("UPDATE accounts SET opening_balance = -300000 WHERE id = 'main'");
    await salary(20_000_000, "2026-11-10T08:00:00");
    const s = await snap();
    expect(s.payCycle.prevOperating).toBe(-300_000);
    expect(s.payCycle.tasks.some((t: { kind: string }) => t.kind === "surplus")).toBe(false);

    db = householdC();
    call = client(db);
    db.exec("DELETE FROM config WHERE k = 'surplus_reward_account'");
    await salary(20_000_000, "2026-11-10T08:00:00", { account_id: "savings" });
    const t = await snap();
    expect(t.payCycle.prevOperating).toBe(1_200_000);
    expect(brief(t).filter(([k]) => k !== "goal")).toEqual([["surplus", "savings", 600_000, "open"]]);
    // Lương về tài khoản ngăn Tích luỹ: ② không trừ vào số mỗi ngày.
    expect(t.nearSpend.pendingTasks).toBe(600_000);

    for (const off of ["UPDATE accounts SET active = 0 WHERE id = 'bonus'", "UPDATE accounts SET pocket = 'operating' WHERE id = 'bonus'"]) {
      db = householdC();
      call = client(db);
      db.exec(off);
      await salary(20_000_000, "2026-11-10T08:00:00");
      expect(brief(await snap()).filter(([k]) => k === "surplus"), off).toEqual([["surplus", "savings", 600_000, "open"]]);
    }
  });

  it("UC-1206 AC-2: lương thứ hai thêm ① 500.000; Việc phụ chịu thuế thêm Thuế 300.000; tiền thuê về tài khoản tích luỹ không việc, nguồn Cho thuê đặt Dự phòng → ③ 4.000.000; nguồn Lương đặt Tích luỹ → ③ 20.000.000 không ①; đặt Vận hành → ① không ③", async () => {
    await salary(20_000_000, "2026-11-10T08:00:00");
    at("2026-11-15T09:00:00");
    await salary(5_000_000, "2026-11-13T09:00:00");
    await call("POST", "/v1/transactions", { meaning: "income", amount: 3_000_000, account_id: "main", income_stream_id: "side", taxable: true, at: AT("2026-11-15T08:00:00") });
    await call("POST", "/v1/transactions", { meaning: "income", amount: 4_000_000, account_id: "savings", income_stream_id: "rental", at: AT("2026-11-15T08:10:00") });
    db.exec("UPDATE income_streams SET pocket = 'reserve' WHERE id = 'rental'");
    await call("POST", "/v1/transactions", { meaning: "income", amount: 4_000_000, account_id: "savings", income_stream_id: "rental", at: AT("2026-11-15T08:20:00") });
    expect(brief(await snap()).slice(5)).toEqual([
      ["savings", "savings", 500_000, "open"],
      ["goal", "Thuế", 300_000, "open"],
      ["move", "reserve", 4_000_000, "open"],
    ]);

    for (const [pocket, expected] of [["savings", [["move", "savings", 20_000_000, "open"]]], ["operating", [["savings", "savings", 2_000_000, "open"]]]] as const) {
      db = householdC();
      call = client(db);
      db.exec(`UPDATE income_streams SET pocket = '${pocket}' WHERE id = 'salary'`);
      await salary(20_000_000, "2026-11-10T08:00:00");
      expect(brief(await snap()).filter(([k]) => k === "savings" || k === "move")).toEqual(expected);
    }
  });

  it("UC-1206 AC-3, UC-103 AC-21: chuyển 2.600.000 sang tích luỹ → ① và ④-Tích luỹ xong, đã trích 10%; chuyển 3.000.000 tài khoản chính → tài khoản tiết kiệm chỉ khớp Học phí (tài khoản của mục tiêu), A Học phí 7.000.000 theo số dư, Bảo dưỡng xe và Ví Thưởng (tài khoản khác) còn mở; không dòng fund; huỷ chuyển khoản 3.000.000 → Học phí mở lại, A về 4.000.000", async () => {
    await salary(20_000_000, "2026-11-10T08:00:00");
    at("2026-11-10T10:00:00");
    const t1 = await transfer(2_600_000, "main", "savings", "2026-11-10T10:00:00");
    expect(t1.json.data.effects.tasksDone.map((t: { kind: string }) => t.kind)).toEqual(["savings", "surplus"]);
    let s = await snap();
    expect(s.payCycle.savingsDone).toEqual({ amount: 2_000_000, base: 20_000_000, pct: 10, level: "10to30" });
    expect(s.payCycle.tasks[0]).toMatchObject({ status: "done", auto: true, linked: 2_000_000, lastTxAt: AT("2026-11-10T10:00:00") });
    at("2026-11-10T10:05:00");
    const t2 = await transfer(3_000_000, "main", "reserve", "2026-11-10T10:05:00");
    expect(t2.json.data.effects.tasksDone.map((t: { kind: string }) => t.kind)).toEqual(["goal"]);
    s = await snap();
    expect(brief(s).map(([, , , st]) => st)).toEqual(["done", "done", "open", "done", "open"]);
    expect(s.payCycle.tasks[1]).toMatchObject({ linked: 2_000_000, goal: { held: 7_000_000 } });
    expect(s.payCycle.tasks[2]).toMatchObject({ linked: 0, missing: 760_000 });
    expect(s.payCycle.tasks[4]).toMatchObject({ linked: 0, missing: 600_000 });
    expect(s.payCycle.openCount).toBe(2);
    expect([bal("reserve"), bal("car-acc"), bal("bonus")]).toEqual([7_000_000, 1_000_000, 0]);
    expect(all("SELECT amount FROM pay_cycle_task_tx WHERE tx_id = ?", t2.json.data.tx.id)).toEqual([{ amount: 2_000_000 }]);
    expect(one("SELECT COUNT(*) AS n FROM transactions WHERE meaning = 'fund'")).toEqual({ n: 0 });
    expect(s.nearSpend).toMatchObject({ amount: 15_600_000, pendingTasks: 1_360_000 });
    expect((await call("POST", `/v1/transactions/${t2.json.data.tx.id}/void`)).status).toBe(200);
    expect(bal("reserve")).toBe(4_000_000);
    expect(brief(await snap()).map(([, , , st]) => st)).toEqual(["done", "open", "open", "done", "open"]);
  });

  it("UC-1206 AC-3: cùng ngăn không ghép; chuyển trước lúc mở kỳ không ghép; tiền lẻ sang heo đất và từ ví điện tử (ngoài ngăn) vào tích luỹ đều tính; 1.500.000 rồi 500.000 → xong ở lần hai", async () => {
    await transfer(2_000_000, "main", "savings", "2026-11-10T07:00:00");
    await salary(20_000_000, "2026-11-10T08:00:00");
    await transfer(1_000_000, "main", "card", "2026-11-10T08:10:00");
    expect((await snap()).payCycle.tasks[0]).toMatchObject({ status: "open", linked: 0 });
    await transfer(1_500_000, "ewallet", "savings", "2026-11-10T08:20:00");
    expect((await snap()).payCycle.tasks[0]).toMatchObject({ status: "open", linked: 1_500_000, missing: 500_000 });
    await transfer(500_000, "main", "piggy", "2026-11-10T08:25:00");
    const s = await snap();
    expect(s.payCycle.tasks[0]).toMatchObject({ status: "done", linked: 2_000_000 });
    expect(s.payCycle.savingsDone.amount).toBe(2_000_000);
  });

  it("UC-1206 AC-5: bỏ qua ① không lý do → 400 reason_required; có lý do → bỏ qua, nhật ký có lý do; sửa ① về 0 không lý do → 400; sửa 3.000.000 sau khi ghép 2.000.000 → còn thiếu 1.000.000; bỏ qua ④ không lý do được; số âm → 400", async () => {
    await salary(20_000_000, "2026-11-10T08:00:00");
    const savingsTask = await taskId("savings", "savings");
    const noReason = await call("POST", `/v1/pay-cycle-tasks/${savingsTask}/skip`, {});
    expect([noReason.status, noReason.json.error?.code]).toEqual([400, "reason_required"]);
    const zero = await call("PATCH", `/v1/pay-cycle-tasks/${savingsTask}`, { amount: 0 });
    expect([zero.status, zero.json.error?.code]).toEqual([400, "reason_required"]);
    expect((await call("PATCH", `/v1/pay-cycle-tasks/${savingsTask}`, { amount: -1 })).status).toBe(400);
    await transfer(2_000_000, "main", "savings", "2026-11-10T08:10:00");
    const more = await call("PATCH", `/v1/pay-cycle-tasks/${savingsTask}`, { amount: 3_000_000 });
    expect(more.json.data.tasks[0]).toMatchObject({ amount: 3_000_000, suggested: 2_000_000, linked: 2_000_000, missing: 1_000_000, status: "open" });
    const skipped = await call("POST", `/v1/pay-cycle-tasks/${savingsTask}/skip`, { reason: "Tháng này trả viện phí" });
    expect(skipped.json.data.tasks[0]).toMatchObject({ status: "skipped", reason: "Tháng này trả viện phí" });
    expect(one<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'pay_cycle_task.skip'").detail).toContain("Tháng này trả viện phí");
    expect((await call("POST", `/v1/pay-cycle-tasks/${await taskId("surplus", "bonus")}/skip`, {})).status).toBe(200);
    expect(one<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'pay_cycle_task.amount'").detail).toBe(JSON.stringify({ from: 2_000_000, to: 3_000_000, reason: null }));
  });

  it("UC-1206 AC-6: QR của ① tới tài khoản tích luỹ (heo đất không số tài khoản thì không), số còn thiếu sau khi ghép 1.500.000; ② tới tài khoản của mục tiêu; Ví Thưởng tới tài khoản Ví Thưởng; ngăn Tích luỹ chỉ có heo đất → không QR, tên tài khoản để nói \"Chuyển sang\"", async () => {
    await salary(20_000_000, "2026-11-10T08:00:00");
    await transfer(1_500_000, "main", "savings", "2026-11-10T08:10:00");
    const s = await snap();
    expect(s.payCycle.tasks[0]).toMatchObject({ missing: 500_000, targets: [{ accountId: "savings", name: "Tài khoản tích luỹ", bank: "TCB", accountNo: "2220002", subAccount: null }] });
    const ids = (t: { targets: { accountId: string }[] }) => t.targets.map((x) => x.accountId);
    expect([ids(s.payCycle.tasks[1]), ids(s.payCycle.tasks[2])]).toEqual([["reserve"], ["car-acc"]]);
    expect(s.payCycle.tasks[4]).toMatchObject({ targets: [{ accountId: "bonus", accountNo: "3330007" }], targetName: "Ví Thưởng" });
    db.exec("UPDATE accounts SET pocket = 'reserve' WHERE id = 'savings'");
    expect((await snap()).payCycle.tasks[0]).toMatchObject({ targets: [], targetName: "Heo đất" });
  });

  it("UC-1206 AC-7: huỷ rồi ghi lại khoản lương sau hai chuyển khoản → kỳ mới 10/11; ① và ④-Tích luỹ tự xong lại (liên kết của việc void đã nhả); không có Học phí (số dư tài khoản 7.000.000 ≥ B); Bảo dưỡng xe 760.000 không ghép chuyển khoản 10:05 sang tài khoản tiết kiệm; A là số dư, không cộng hai lần", async () => {
    const r = await salary(20_000_000, "2026-11-10T08:00:00");
    at("2026-11-10T10:10:00");
    await transfer(2_600_000, "main", "savings", "2026-11-10T10:00:00");
    await transfer(3_000_000, "main", "reserve", "2026-11-10T10:05:00");
    await call("POST", `/v1/transactions/${r.json.data.tx.id}/void`);
    await salary(20_000_000, "2026-11-10T08:00:00");
    const s = await snap();
    expect(s.payCycle.payday).toBe("2026-11-10");
    expect(brief(s)).toEqual([
      ["savings", "savings", 2_000_000, "done"],
      ["goal", "Bảo dưỡng xe", 760_000, "open"],
      ["surplus", "savings", 600_000, "done"],
      ["surplus", "bonus", 600_000, "open"],
    ]);
    expect([bal("reserve"), bal("car-acc"), bal("bonus")]).toEqual([7_000_000, 1_000_000, 0]);
  });

  /** Hộ mẫu E sau màn chuyển đổi (dựng trên C): Học phí ↔ tài khoản tiết kiệm 10.000.000; Hoá đơn ↔ tài khoản hoá đơn 0 (1.300.000 mỗi kỳ); Thuế để sau; Bảo dưỡng xe tắt. */
  const householdE = () =>
    db.exec(`
      UPDATE accounts SET opening_balance = 10000000 WHERE id = 'reserve';
      UPDATE reserve_goals SET active = 0 WHERE id = 'car';
      UPDATE reserve_goals SET account_id = NULL WHERE id = 'tax';
      INSERT INTO accounts (id, name, kind, bank, account_no, owner_member_id, opening_balance, pocket, pocket_confirmed)
        VALUES ('bills', 'Tài khoản hoá đơn', 'bank', 'MB', '3330008', 'husband', 0, 'reserve', 1);
      INSERT INTO reserve_goals (id, name, account_id, target_amount, monthly_amount, repeat_months, sort) VALUES ('bills-goal', 'Hoá đơn', 'bills', 1300000, 1300000, 1, 4);
    `);

  it("UC-1206 AC-8: mục tiêu để sau không sinh việc; bỏ gắn tài khoản rồi tick tay → 409 goal_no_account; gửi earmark_id → 400 model_changed", async () => {
    householdE();
    await salary(20_000_000, "2026-11-10T08:00:00", { taxable: true });
    const s = await snap();
    expect(brief(s).filter(([k]) => k === "goal")).toEqual([["goal", "Hoá đơn", 1_300_000, "open"]]);
    expect(s.payCycle.tasks.find((t: Task) => t.goal?.id === "bills-goal")).toMatchObject({ toAccountId: "bills", targets: [{ accountId: "bills" }] });
    expect(s.pockets.reserve.goals.find((g: { id: string }) => g.id === "tax")).toMatchObject({ accountId: null, held: null });

    const bills = await taskId("goal", "bills-goal");
    db.exec("UPDATE reserve_goals SET account_id = NULL WHERE id = 'bills-goal'");
    expect((await snap()).payCycle.tasks.find((t: Task) => t.id === bills)).toMatchObject({ status: "open", toAccountId: null, targets: [], goal: { accountId: null, held: null } });
    const noAccount = await call("POST", `/v1/pay-cycle-tasks/${bills}/done`);
    expect([noAccount.status, noAccount.json.error?.code]).toEqual([409, "goal_no_account"]);
    // Không còn đích: chuyển vào tài khoản hoá đơn không ghép.
    await transfer(1_300_000, "buffer", "bills", "2026-11-10T08:10:00");
    expect((await snap()).payCycle.tasks.find((t: Task) => t.id === bills)).toMatchObject({ status: "open", missing: 1_300_000 });

    const savingsTask = await taskId("savings", "savings");
    const old = await call("POST", `/v1/pay-cycle-tasks/${savingsTask}/done`, { earmark_id: "keep" });
    expect([old.status, old.json.error?.code, old.json.error?.fields]).toEqual([400, "model_changed", ["earmark_id"]]);
    expect(one("SELECT status FROM pay_cycle_tasks WHERE id = ?", savingsTask)).toEqual({ status: "open" });

    // ④ → Ví Thưởng mà tài khoản Ví Thưởng đã tắt → 409 goal_no_account.
    db.exec("UPDATE accounts SET active = 0 WHERE id = 'bonus'");
    const reward = await call("POST", `/v1/pay-cycle-tasks/${await taskId("surplus", "bonus")}/done`);
    expect([reward.status, reward.json.error?.code]).toEqual([409, "goal_no_account"]);
  });

  it("UC-1206 AC-9: ② và ④-Ví Thưởng khớp theo tài khoản đích, không xét ngăn — phao → tài khoản tiết kiệm không khớp Hoá đơn; phao → tài khoản hoá đơn xong Hoá đơn; tài khoản tiết kiệm → tài khoản Ví Thưởng xong ④; tích luỹ → heo đất (cùng ngăn Tích luỹ) không khớp ①", async () => {
    householdE();
    await salary(20_000_000, "2026-11-10T08:00:00");
    const bills = await taskId("goal", "bills-goal");
    const reward = await taskId("surplus", "bonus");
    const state = async (id: number) => (await snap()).payCycle.tasks.find((t: Task) => t.id === id);
    await transfer(1_300_000, "buffer", "reserve", "2026-11-10T08:05:00");
    expect(await state(bills)).toMatchObject({ status: "open", linked: 0 });
    const t = await transfer(1_300_000, "buffer", "bills", "2026-11-10T08:10:00");
    expect(t.json.data.effects.tasksDone).toEqual([{ id: bills, kind: "goal" }]);
    expect(await state(bills)).toMatchObject({ status: "done", auto: true, linked: 1_300_000, goal: { held: 1_300_000 } });
    await transfer(600_000, "reserve", "bonus", "2026-11-10T08:15:00");
    expect(await state(reward)).toMatchObject({ status: "done", auto: true, linked: 600_000 });
    await transfer(500_000, "savings", "piggy", "2026-11-10T08:20:00");
    expect((await snap()).payCycle.tasks[0]).toMatchObject({ kind: "savings", status: "open", linked: 0 });
  });

  it("UC-1206 AC-10: nhà một tài khoản (tài khoản chính 12.000.000, không tài khoản Tích luỹ, không Ví Thưởng) → đúng 2 việc: ① 2.000.000 và ④ 6.000.000 → Tích luỹ, không QR, không ④ → Ví Thưởng; tick tay ① → xong, đã trích 0, chưa làm giảm 2.000.000; tick tay ④ → xong; tick lần hai → 409 task_done; reopen chỉ mở lại; kỳ đã huỷ → 409 cycle_closed; việc không có → 404", async () => {
    db.exec(`
      UPDATE reserve_goals SET active = 0;
      DELETE FROM config WHERE k = 'surplus_reward_account';
      UPDATE accounts SET active = 0 WHERE id <> 'main';
      UPDATE accounts SET opening_balance = 12000000 WHERE id = 'main';
    `);
    const r = await salary(20_000_000, "2026-11-10T08:00:00");
    let s = await snap();
    expect(brief(s)).toEqual([
      ["savings", "savings", 2_000_000, "open"],
      ["surplus", "savings", 6_000_000, "open"],
    ]);
    expect(s.payCycle.tasks[0]).toMatchObject({ kind: "savings", amount: 2_000_000, pct: 10, targets: [], targetName: null });
    expect(s.payCycle.tasks[1]).toMatchObject({ kind: "surplus", amount: 6_000_000, toPocket: "savings", toAccountId: null, targets: [], targetName: null });
    expect(s.pockets.savings.total).toBe(0);
    const pending = s.nearSpend.pendingTasks;
    const savingsTask = await taskId("savings", "savings");
    const surplusTask = await taskId("surplus", "savings");
    const res = await call("POST", `/v1/pay-cycle-tasks/${savingsTask}/done`);
    expect(res.status).toBe(200);
    expect(res.json.data.tasks[0]).toMatchObject({ status: "done", auto: false });
    expect(res.json.data.savingsDone).toEqual({ amount: 0, base: 20_000_000, pct: 0, level: "below1" });
    s = await snap();
    expect(s.nearSpend.pendingTasks).toBe(pending - 2_000_000);
    expect(s.pockets.savings.total).toBe(0);
    expect(one("SELECT action, detail FROM audit_log WHERE action = 'pay_cycle_task.done'")).toEqual({ action: "pay_cycle_task.done", detail: JSON.stringify({ mode: "manual", amount: 2_000_000 }) });
    const surplusDone = await call("POST", `/v1/pay-cycle-tasks/${surplusTask}/done`);
    expect(surplusDone.status).toBe(200);
    expect(surplusDone.json.data.tasks[1]).toMatchObject({ status: "done", auto: false });
    expect(surplusDone.json.data.savingsDone).toEqual({ amount: 0, base: 20_000_000, pct: 0, level: "below1" });
    expect((await call("POST", `/v1/pay-cycle-tasks/${savingsTask}/done`)).json.error?.code).toBe("task_done");
    expect((await call("POST", `/v1/pay-cycle-tasks/${savingsTask}/reopen`)).json.data.tasks[0]).toMatchObject({ status: "open", missing: 2_000_000 });
    await call("POST", `/v1/transactions/${r.json.data.tx.id}/void`);
    const closed = await call("POST", `/v1/pay-cycle-tasks/${savingsTask}/done`);
    expect([closed.status, closed.json.error?.code]).toEqual([409, "cycle_closed"]);
    expect((await call("POST", "/v1/pay-cycle-tasks/99999/done")).status).toBe(404);
  });

  /** Kỳ 10/11 chỉ có ① 2.000.000 cần ghép (dư kỳ trước 0 → không ④); T1, T2 2.000.000 sang tài khoản tích luỹ ghi thẳng vào sổ, chưa lượt ghép nào chạy. */
  const raceSetup = async () => {
    db.exec("UPDATE accounts SET opening_balance = 0 WHERE id = 'main'");
    await salary(20_000_000, "2026-11-10T08:00:00");
    at("2026-11-10T09:00:00");
    const insert = db.prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, week_key, month_key, source)
       VALUES (?, 2000000, 'transfer', 'main', 'savings', '2026-W46', '2026-11', 'manual')`,
    );
    const t1 = Number(insert.run(AT("2026-11-10T08:10:00")).lastInsertRowid);
    const t2 = Number(insert.run(AT("2026-11-10T08:20:00")).lastInsertRowid);
    const task = await taskId("savings", "savings");
    return { t1, t2, task };
  };
  const links = (task: number) => all("SELECT tx_id, amount FROM pay_cycle_task_tx WHERE task_id = ? ORDER BY tx_id", task);

  it("UC-1206 AC-11: lượt B tính từ trạng thái trước lượt A → câu ghi ① ← T2 không ghi dòng nào; T2 còn trọn; huỷ T1 → ① mở lại và lần ghép sau đó nhận T2", async () => {
    const { t1, t2, task } = await raceSetup();
    await afterWrite(asD1(db)); // lượt A: ① ← T1
    const b = await linkTaskStatement(asD1(db), task, t2, 2_000_000).run(); // lượt B: đã đọc ① còn thiếu 2.000.000 trước A
    expect(b.meta.changes).toBe(0);
    expect(links(task)).toEqual([{ tx_id: t1, amount: 2_000_000 }]);
    expect((await snap()).payCycle.tasks[0]).toMatchObject({ status: "done", auto: true, linked: 2_000_000 });
    expect(all("SELECT tx_id FROM pay_cycle_task_tx WHERE tx_id = ?", t2)).toEqual([]);

    expect((await call("POST", `/v1/transactions/${t1}/void`)).status).toBe(200);
    expect((await snap()).payCycle.tasks[0]).toMatchObject({ status: "open", linked: 0, missing: 2_000_000 });
    await afterWrite(asD1(db)); // lần ghép sau lần huỷ
    expect(links(task)).toEqual([
      { tx_id: t1, amount: 2_000_000 },
      { tx_id: t2, amount: 2_000_000 },
    ]);
    expect((await snap()).payCycle.tasks[0]).toMatchObject({ status: "done", auto: true, linked: 2_000_000 });
  });

  it("UC-1206 AC-11: T2 đã dùng cho việc khác → huỷ T1 làm ① mở lại, thiếu 2.000.000; T3 tự ghép vào ①, ① xong — liên kết cũ của T1 (đã huỷ) không chặn", async () => {
    const { t1, t2, task } = await raceSetup();
    await afterWrite(asD1(db));
    const other = await taskId("goal", "school");
    db.prepare("INSERT INTO pay_cycle_task_tx (task_id, tx_id, amount) VALUES (?, ?, 2000000)").run(other, t2);
    expect((await call("POST", `/v1/transactions/${t1}/void`)).status).toBe(200);
    expect((await snap()).payCycle.tasks[0]).toMatchObject({ status: "open", linked: 0, missing: 2_000_000 });
    const t3 = await transfer(2_000_000, "main", "savings", "2026-11-10T09:00:00");
    expect(t3.json.data.effects.tasksDone).toEqual([{ id: task, kind: "savings" }]);
    expect(links(task)).toEqual([
      { tx_id: t1, amount: 2_000_000 },
      { tx_id: t3.json.data.tx.id, amount: 2_000_000 },
    ]);
    expect((await snap()).payCycle.tasks[0]).toMatchObject({ status: "done", auto: true, linked: 2_000_000 });
  });

  it("UC-504 AC-18: lương về VCB (vợ) riêng tư của vợ → với chồng và cron (null) việc mang khoản lương có source { hidden: true }, số của việc giữ; vợ thấy đủ; vợ đã tắt → chồng thấy đủ", async () => {
    db.exec("UPDATE accounts SET active = 1, private = 1, owner_member_id = 'wife', pocket = 'operating', pocket_confirmed = 1, opening_balance = 0, sepay_enabled = 0, opened_at = '2026-01-01' WHERE id = 'vcb-wife'");
    const r = await call("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "vcb-wife", income_stream_id: "salary", at: AT("2026-11-10T08:00:00") }, "wife");
    expect(r.status).toBe(201);
    const txId = r.json.data.tx.id;
    const savingsOf = async (viewer: string | null) => (await payCycleView(asD1(db), "2026-11-10", viewer)).view!.tasks.find((t) => t.kind === "savings")!;
    for (const viewer of ["husband", null]) {
      const t = await savingsOf(viewer);
      expect(t.source).toEqual({ hidden: true });
      expect(t).toMatchObject({ status: "open", amount: 2_000_000 });
    }
    expect((await savingsOf("wife")).source).toEqual({ txId, amount: 20_000_000, at: AT("2026-11-10T08:00:00"), streamName: "Lương" });
    // Việc không mang khoản thu nào (② theo mục tiêu) vẫn source null.
    expect((await payCycleView(asD1(db), "2026-11-10", "husband")).view!.tasks.find((t) => t.kind === "goal")!.source).toBeNull();
    db.exec("UPDATE members SET active = 0 WHERE id = 'wife'");
    expect((await savingsOf("husband")).source).toMatchObject({ txId, amount: 20_000_000 });
  });
});

describe("dư kỳ trước theo sổ, mốc kỳ, số mỗi ngày khi lương sớm", () => {
  it("UC-1207 AC-3: log lương về muộn (ghi lúc 02:00 hôm sau, thời điểm 08:00) sau chuyển 2.600.000 lúc 10:00 và chi 300.000 lúc 12:00 → mở lúc 08:00, dư kỳ trước 1.200.000, ④ 600.000 / 600.000; ① và ④-Tích luỹ tự xong", async () => {
    at("2026-11-10T12:30:00");
    await transfer(2_600_000, "main", "savings", "2026-11-10T10:00:00");
    await call("POST", "/v1/transactions", { meaning: "spend", amount: 300_000, account_id: "main", category_id: "groceries", at: AT("2026-11-10T12:00:00") });
    at("2026-11-11T02:00:00");
    await salary(20_000_000, "2026-11-10T08:00:00");
    const s = await snap();
    expect(s.payCycle).toMatchObject({ startedAt: AT("2026-11-10T08:00:00"), prevOperating: 1_200_000 });
    expect(brief(s).filter(([k]) => k !== "goal")).toEqual([
      ["savings", "savings", 2_000_000, "done"],
      ["surplus", "savings", 600_000, "done"],
      ["surplus", "bonus", 600_000, "open"],
    ]);
  });

  it("UC-1203 AC-8: kỳ 10/11 mở 08:00, lương sớm mở kỳ 10/12 lúc 4/12 08:00, hôm nay 5/12 → since 4/12 08:00, prevSince 10/11 08:00; chưa có kỳ (kỳ 10/10 huỷ) → since theo payday_day", async () => {
    await salary(20_000_000, "2026-11-10T08:00:00");
    at("2026-12-04T08:00:00");
    await salary(20_000_000, "2026-12-04T08:00:00");
    at("2026-12-05T09:00:00");
    expect((await snap()).pockets.savings.change).toMatchObject({ since: AT("2026-12-04T08:00:00"), prevSince: AT("2026-11-10T08:00:00") });
    db = householdC();
    call = client(db);
    db.exec("UPDATE pay_cycles SET status = 'void'");
    expect((await snap()).pockets.savings.change).toMatchObject({ since: "2026-11-10", prevSince: "2026-10-10" });
  });

  it("UC-103 AC-22: lương về sớm 4/12 → ngày lương 10/1, 37 ngày; ① 2.000.000, Học phí 2.000.000, Bảo dưỡng xe 950.000, ④ 600.000 + 600.000 → chưa làm 6.150.000, 406.000/ngày; ngày 10/12 vẫn đếm tới 10/1 (31 ngày)", async () => {
    db.exec(`
      INSERT INTO transactions (id, at, amount, meaning, counter_account_id, income_stream_id, week_key, month_key, source)
        VALUES (50, '2026-11-10T01:00:00.000Z', 15000000, 'income', 'main', 'salary', '2026-W46', '2026-11', 'manual');
      INSERT INTO transactions (at, amount, meaning, account_id, category_id, week_key, month_key, source)
        VALUES ('2026-11-20T03:00:00.000Z', 15000000, 'spend', 'main', 'groceries', '2026-W47', '2026-11', 'manual');
      INSERT INTO pay_cycles (income_tx_id, started_at, payday, prev_operating) VALUES (50, '2026-11-10T01:00:00.000Z', '2026-11-10', 0);
    `);
    at("2026-12-04T08:00:00");
    await salary(20_000_000, "2026-12-04T08:00:00");
    const s = await snap();
    expect(s.payCycle.payday).toBe("2026-12-10");
    expect(brief(s).map(([, , a]) => a)).toEqual([2_000_000, 2_000_000, 950_000, 600_000, 600_000]);
    expect(s.nearSpend).toMatchObject({ amount: 21_200_000, payday: "2027-01-10", daysLeft: 37, pendingTasks: 6_150_000, perDay: 406_000 });
    at("2026-12-10T09:00:00");
    expect((await snap()).nearSpend).toMatchObject({ payday: "2027-01-10", daysLeft: 31 });
  });

  it("UC-1205 AC-3: không còn nguồn nào bật Mở kỳ lương → paySetup.hasCycleStream false; chưa có kỳ → payCycle null, chưa làm 0", async () => {
    db.exec("UPDATE income_streams SET opens_cycle = 0; UPDATE pay_cycles SET status = 'void'");
    const s = await snap();
    expect(s.paySetup).toEqual({ hasCycleStream: false });
    expect(s.payCycle).toBeNull();
    expect(s.nearSpend.pendingTasks).toBe(0);
  });
});

describe("nhập tay không ví (ledger UC-101)", () => {
  it("UC-101 AC-28: khoản chi có wallet_id, chuyển có wealth_move, chuyển chỉ giữa hai ví, thu nhập có allocate → 400 model_changed kèm tên trường, không ghi gì; bỏ các trường đó → ghi được, cột ví NULL", async () => {
    const count = () => one<{ n: number }>("SELECT COUNT(*) AS n FROM transactions").n;
    const n0 = count();
    const cases: [Record<string, unknown>, string[]][] = [
      [{ meaning: "spend", amount: 200_000, account_id: "main", category_id: "groceries", wallet_id: "food" }, ["wallet_id"]],
      [{ meaning: "transfer", amount: 1_000_000, account_id: "main", to_account_id: "savings", wealth_move: "fund" }, ["wealth_move"]],
      [{ meaning: "transfer", amount: 500_000, from_wallet_id: "food", wallet_id: "travel" }, ["wallet_id", "from_wallet_id"]],
      [{ meaning: "income", amount: 3_000_000, account_id: "main", allocate: true }, ["allocate"]],
    ];
    for (const [body, fields] of cases) {
      const r = await call("POST", "/v1/transactions", body);
      expect([r.status, r.json.error?.code, r.json.error?.fields]).toEqual([400, "model_changed", fields]);
    }
    expect(count()).toBe(n0);
    const ok = await call("POST", "/v1/transactions", { meaning: "spend", amount: 200_000, account_id: "main", category_id: "groceries", wallet_id: null });
    expect(ok.status).toBe(201);
    expect(ok.json.data.tx).not.toHaveProperty("wallet_id");
    expect(ok.json.data.tx).not.toHaveProperty("counter_wallet_id");
  });

  it("UC-101 AC-29: chi 200.000, thu Việc phụ 3.000.000, chuyển 1.000.000 sang tích luỹ, mua tài sản 2.000.000 từ tích luỹ → không fund, không lần chia, không lệnh chuyển; khoản chi trả nearSpend = tổng Vận hành sau khi ghi; Tích luỹ −2.000.000; danh mục chưa có ví mặc định ghi được", async () => {
    const r = await call("POST", "/v1/transactions", { meaning: "spend", amount: 200_000, account_id: "main", category_id: "groceries" });
    expect(r.json.data.nearSpend.amount).toBe(1_000_000);
    expect(r.json.data).not.toHaveProperty("wallet");
    await call("POST", "/v1/transactions", { meaning: "income", amount: 3_000_000, account_id: "main", income_stream_id: "side" });
    await transfer(1_000_000, "main", "savings", "2026-11-10T08:20:00");
    const before = (await snap()).pockets.savings.total;
    const asset = await call("POST", "/v1/transactions", { meaning: "buy_asset", amount: 2_000_000, account_id: "savings", asset_kind: "gold" });
    expect(asset.status).toBe(201);
    expect((await snap()).pockets.savings.total).toBe(before - 2_000_000);
    expect(one("SELECT COUNT(*) AS n FROM transactions WHERE meaning = 'fund'")).toEqual({ n: 0 });
    db.exec("INSERT INTO categories (id, name) VALUES ('new-cat', 'Mới')");
    expect((await call("POST", "/v1/transactions", { meaning: "spend", amount: 10_000, account_id: "main", category_id: "new-cat" })).status).toBe(201);
  });
});

describe("việc ② khi nhiều mục tiêu chung một tài khoản (UC-1206 AC-12, AC-14)", () => {
  const tkTasks = (s: { payCycle: { tasks: Task[] } }) =>
    s.payCycle.tasks.filter((t) => t.kind === "goal" && t.toAccountId === "tk-tiet-kiem").map((t) => [t.goal?.name, t.amount, t.status, t.missing]);

  it("UC-1206 AC-12: hai việc ② cùng tài khoản đích — Nhà ở 1.500.000 rồi Học tập 2.000.000; một chuyển khoản lấp theo thứ tự việc; huỷ chuyển khoản 2.500.000 → Nhà ở mở lại, Học tập giữ phần đã ghép", async () => {
    db = householdShared({ cycle: false });
    db.exec("UPDATE accounts SET opening_balance = 6000000 WHERE id = 'tk-tiet-kiem'");
    call = client(db);
    expect((await call("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "cash-husband", income_stream_id: "salary-husband", at: AT("2026-11-10T08:00:00") })).status).toBe(201);
    expect(tkTasks(await snap())).toEqual([
      ["Nhà ở", 1_500_000, "open", 1_500_000],
      ["Học tập", 2_000_000, "open", 2_000_000],
    ]);
    const first = await transfer(2_500_000, "cash-husband", "tk-tiet-kiem", "2026-11-10T09:00:00");
    expect(tkTasks(await snap())).toEqual([
      ["Nhà ở", 1_500_000, "done", 0],
      ["Học tập", 2_000_000, "open", 1_000_000],
    ]);
    await transfer(1_000_000, "cash-husband", "tk-tiet-kiem", "2026-11-10T09:30:00");
    expect(tkTasks(await snap()).map((t) => t[2])).toEqual(["done", "done"]);
    expect((await call("POST", `/v1/transactions/${first.json.data.tx.id}/void`)).status).toBe(200);
    expect(tkTasks(await snap())).toEqual([
      ["Nhà ở", 1_500_000, "open", 1_500_000],
      ["Học tập", 2_000_000, "open", 1_000_000],
    ]);
  });

  it("UC-1206 AC-14: lương gán muộn — khoản chi 7.500.000 gắn Nhà ở lúc 08:30 trước khi gán log lương 08:00 → không có việc Nhà ở, Học tập 500.000; snapshot cùng số", async () => {
    db = householdShared({ cycle: false });
    call = client(db);
    at("2026-11-10T08:30:00");
    await ingestLog(asD1(db), { id: "luong", at: AT("2026-11-10T08:00:00"), amount: 20_000_000, direction: "in", accountNo: "0011xxxxxxx", content: "CK 1110", refCode: null, referenceNumber: null, raw: {} }, "webhook", new Date());
    expect((await call("POST", "/v1/transactions", { meaning: "spend", amount: 7_500_000, account_id: "tk-tiet-kiem", category_id: "housing", goal_id: "nha-o", at: AT("2026-11-10T08:30:00") })).status).toBe(201);
    at("2026-11-10T09:00:00");
    const assigned = await call("POST", "/v1/logs/luong/assign", { splits: [{ meaning: "income", amount: 20_000_000, income_stream_id: "salary-husband" }] });
    expect(assigned.status).toBe(201);
    const s = await snap();
    expect(s.payCycle.startedAt).toBe(AT("2026-11-10T08:00:00"));
    expect(tkTasks(s)).toEqual([["Học tập", 500_000, "open", 500_000]]);
    const goals = s.pockets.reserve.goals as { id: string; held: number; spent: number; short: number }[];
    expect(goals.find((g) => g.id === "nha-o")).toMatchObject({ held: 0, spent: 7_500_000, short: 0 });
    expect(goals.find((g) => g.id === "hoc-tap")).toMatchObject({ held: 4_500_000, short: 1_500_000 });
  });
});

describe("tài khoản con và thang Tích luỹ (UC-1206 AC-15, AC-16)", () => {
  it("UC-1206 AC-15: ② Học tập 2.000.000 đích tk-tiet-kiem — chuyển 5.000.000 từ tk-tiet-kiem sang con không ghép (chuyển nội bộ); chuyển 2.000.000 từ tài khoản chính sang con → ghép, Học tập xong", async () => {
    db = householdShared({ cycle: false });
    db.exec(`
      UPDATE accounts SET opening_balance = 7000000 WHERE id = 'tk-tiet-kiem';
      UPDATE reserve_goals SET active = 0 WHERE id = 'nha-o';
      UPDATE reserve_goals SET target_amount = 13000000 WHERE id = 'hoc-tap';
      INSERT INTO accounts (id, name, kind, bank, opening_balance, pocket, pocket_confirmed, parent_account_id) VALUES ('gui-6-thang', 'Gửi 6 tháng', 'bank', 'MBBank', 0, 'reserve', 1, 'tk-tiet-kiem');
    `);
    call = client(db);
    expect((await call("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "cash-husband", income_stream_id: "salary-husband", at: AT("2026-11-10T08:00:00") })).status).toBe(201);
    const hocTap = async () => ((await snap()).payCycle.tasks as Task[]).filter((t) => t.goal?.id === "hoc-tap").map((t) => [t.toAccountId, t.amount, t.status, t.missing]);
    expect(await hocTap()).toEqual([["tk-tiet-kiem", 2_000_000, "open", 2_000_000]]);
    await transfer(5_000_000, "tk-tiet-kiem", "gui-6-thang", "2026-11-10T09:00:00");
    expect(await hocTap()).toEqual([["tk-tiet-kiem", 2_000_000, "open", 2_000_000]]);
    expect(one("SELECT COUNT(*) AS n FROM pay_cycle_task_tx")).toEqual({ n: 0 });
    await transfer(2_000_000, "cash-husband", "gui-6-thang", "2026-11-10T09:30:00");
    expect(await hocTap()).toEqual([["tk-tiet-kiem", 2_000_000, "done", 0]]);
  });

  it("UC-1206 AC-16: ① của lương 30.000.000 (10%, 3.000.000) — sửa 9.000.000 → pct 30; 200.000 → pct 0; 0 không lý do và bỏ qua không lý do → 400 reason_required; 0 có lý do → lưu, nhật ký có lý do; 40.000.000 → lưu, pct 100", async () => {
    await salary(30_000_000, "2026-11-10T08:00:00");
    const id = await taskId("savings", "savings");
    const row = () => one<{ amount: number; pct: number; reason: string | null }>("SELECT amount, pct, reason FROM pay_cycle_tasks WHERE id = ?", id);
    expect(row()).toMatchObject({ amount: 3_000_000, pct: 10 });
    expect((await call("PATCH", `/v1/pay-cycle-tasks/${id}`, { amount: 9_000_000 })).status).toBe(200);
    expect(row()).toMatchObject({ amount: 9_000_000, pct: 30 });
    expect((await call("PATCH", `/v1/pay-cycle-tasks/${id}`, { amount: 200_000 })).status).toBe(200);
    expect(row()).toMatchObject({ amount: 200_000, pct: 0 });
    const zero = await call("PATCH", `/v1/pay-cycle-tasks/${id}`, { amount: 0 });
    expect([zero.status, zero.json.error?.code]).toEqual([400, "reason_required"]);
    const skip = await call("POST", `/v1/pay-cycle-tasks/${id}/skip`, {});
    expect([skip.status, skip.json.error?.code]).toEqual([400, "reason_required"]);
    expect((await call("PATCH", `/v1/pay-cycle-tasks/${id}`, { amount: 0, reason: "Tháng này trả viện phí" })).status).toBe(200);
    expect(row()).toEqual({ amount: 0, pct: 0, reason: "Tháng này trả viện phí" });
    expect(all("SELECT detail FROM audit_log WHERE action = 'pay_cycle_task.amount'").at(-1)).toEqual({ detail: JSON.stringify({ from: 200_000, to: 0, reason: "Tháng này trả viện phí" }) });
    const big = await call("PATCH", `/v1/pay-cycle-tasks/${id}`, { amount: 40_000_000 });
    expect(big.status).toBe(200);
    expect(row()).toMatchObject({ amount: 40_000_000, pct: 100 });
  });
});
