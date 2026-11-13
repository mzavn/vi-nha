// Việc theo tháng qua REST trên hộ mẫu C (change 261112-thang-thay-ky-luong, ADR-144): lương về sinh đúng một nhắc ① trích
// Tích luỹ (pocket UC-1205 AC-5…7), tự tick theo mốc của việc và luật "đã dùng" (UC-1206 AC-17, AC-18 và AC-3, 5, 6, 10, 11, 16
// sửa theo tháng), chia dư cuối tháng (UC-1207 AC-4…6); nhập tay không ví (ledger UC-101 AC-28, 29).
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { taskCode, taskMemo } from "../src/domain/month-tasks";
import { ingestLog } from "../src/services/ingest";
import { afterWrite, linkTaskStatement, monthCloseView, reopenMonth, splitMonth } from "../src/services/month-tasks";
import { asD1, migratedDb } from "./helpers/d1-sqlite";
import { AT, client, householdC } from "./helpers/household-c";

let db: DatabaseSync;
let call: ReturnType<typeof client>;
const at = (vn: string) => vi.setSystemTime(new Date(`${vn}+07:00`));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-12-10T09:00:00");
  db = householdC();
  call = client(db);
});
afterEach(() => vi.useRealTimers());

const one = <T = Record<string, unknown>>(sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) as T;
const all = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as Record<string, unknown>[];
const salary = (amount: number, vn: string, o: Record<string, unknown> = {}) =>
  call("POST", "/v1/transactions", { meaning: "income", amount, account_id: "main", income_stream_id: "salary", at: AT(vn), ...o });
const transfer = (amount: number, from: string, to: string, vn: string) =>
  call("POST", "/v1/transactions", { meaning: "transfer", amount, account_id: from, to_account_id: to, at: AT(vn) });
const snap = async () => (await call("GET", "/v1/snapshot")).json.data;
type Task = { id: number; kind: string; month: string; amount: number; status: string; auto: boolean; linked: number; missing: number; pct: number | null; toPocket: string | null; toAccountId: string | null; targets: { accountId: string }[]; targetName: string | null; source: unknown };
const tasks = async (): Promise<Task[]> => (await snap()).month.tasks;
const reminders = () => all("SELECT income_tx_id AS tx, month_key AS month, amount, pct, status FROM month_tasks WHERE kind = 'savings' ORDER BY id");
/** Bank log tiền vào tài khoản chính đang chờ gán. */
const pendingLog = (id: string, amount: number, vn: string) =>
  db.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES (?, ?, ?, 'in', 'main', 'CK', 'pending')").run(id, AT(vn), amount);
const assign = (id: string, split: Record<string, unknown>) => call("POST", `/v1/logs/${id}/assign`, { splits: [{ meaning: "income", ...split }] });

describe("lương về: đúng một nhắc trích Tích luỹ (UC-1205)", () => {
  it("UC-1205 AC-5: lương 20.000.000 về tài khoản chính 10/12 08:00 → một khoản thu, một nhắc 2.000.000 tháng 2026-12, pct 10, effects.savings; gửi lại cùng client_id vẫn một; không dòng kỳ mới; lương thứ hai 5.000.000 → thêm 500.000; về tài khoản tích luỹ → không nhắc; huỷ khoản lương → nhắc void", async () => {
    const cycles = one("SELECT (SELECT COUNT(*) FROM pay_cycles) + (SELECT COUNT(*) FROM pay_cycle_tasks) AS n");
    const r = await salary(20_000_000, "2026-12-10T08:00:00", { client_id: "salary-1210-abc" });
    expect(r.status).toBe(201);
    expect(r.json.data.effects).toEqual({ savings: { amount: 2_000_000, pct: 10 }, tasksDone: [] });
    expect(r.json.data.tx).toMatchObject({ is_salary: 1 });
    const id = r.json.data.tx.id;
    expect(reminders()).toEqual([{ tx: id, month: "2026-12", amount: 2_000_000, pct: 10, status: "open" }]);
    expect((await salary(20_000_000, "2026-12-10T08:00:00", { client_id: "salary-1210-abc" })).json.data.duplicate).toBe(true);
    expect(one("SELECT COUNT(*) AS n FROM transactions WHERE amount = 20000000 AND meaning = 'income'")).toEqual({ n: 1 });
    expect(reminders()).toHaveLength(1);
    expect(one("SELECT (SELECT COUNT(*) FROM pay_cycles) + (SELECT COUNT(*) FROM pay_cycle_tasks) AS n")).toEqual(cycles);

    const second = await salary(5_000_000, "2026-12-10T08:30:00");
    expect(second.json.data.effects.savings).toEqual({ amount: 500_000, pct: 10 });
    const toSavings = await salary(8_000_000, "2026-12-10T08:40:00", { account_id: "savings" });
    expect(toSavings.json.data.effects.savings).toBeNull();
    expect(reminders().map((t) => t.amount)).toEqual([2_000_000, 500_000]);

    expect((await call("POST", `/v1/transactions/${id}/void`)).status).toBe(200);
    expect(reminders().map((t) => t.status)).toEqual(["void", "open"]);
    expect(one("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'pay_cycle%'")).toEqual({ n: 0 });
  });

  it("UC-1205 AC-5: batch lỗi ở bước chèn nhắc → không có khoản thu, không nhắc", async () => {
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON month_tasks BEGIN SELECT RAISE(ABORT, 'boom'); END");
    expect((await salary(20_000_000, "2026-12-10T08:00:00")).status).toBe(500);
    expect(one("SELECT COUNT(*) AS n FROM transactions WHERE amount = 20000000")).toEqual({ n: 0 });
  });

  it("UC-1205 AC-6: Q1-B — gán 20.000.000 không nguồn mặc định → nhắc 2.000.000; 1.200.000 → không; 20.000.000 is_salary false → không, is_salary 0; lãi tiền gửi → không; tiền người thuê 4.000.000 → không; Việc phụ 3.000.000 is_salary true → 300.000", async () => {
    db.exec("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')");
    const cases: [string, number, Record<string, unknown>, number | null][] = [
      ["a", 20_000_000, {}, 2_000_000],
      ["b", 1_200_000, {}, null],
      ["c", 20_000_000, { is_salary: false }, null],
      ["d", 37_000, { interest: true }, null],
      ["e", 4_000_000, { tenant_id: "tenant-binh" }, null],
      ["f", 3_000_000, { income_stream_id: "side", is_salary: true }, 300_000],
    ];
    for (const [id, amount, extra, reminder] of cases) {
      pendingLog(id, amount, "2026-12-10T08:00:00");
      const r = await assign(id, { amount, ...extra });
      expect([id, r.status]).toEqual([id, 201]);
      expect([id, r.json.data.effects.savings?.amount ?? null]).toEqual([id, reminder]);
      expect([id, r.json.data.transactions[0].is_salary]).toEqual([id, reminder === null ? 0 : 1]);
    }
    expect(reminders().map((t) => t.amount)).toEqual([2_000_000, 300_000]);
  });

  it("UC-1205 AC-6: is_salary true kèm tenant_id / is_interest → 400 cannot_be_salary; POST /v1/transactions/:id/salary false cho khoản từ SePay → is_salary 0, nhắc void, nhật ký tx.salary; true → nhắc mới (nhắc cũ vẫn void); gửi lại cùng giá trị → không ghi; khoản chi → 400 invalid_input", async () => {
    db.exec("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')");
    const rent = await call("POST", "/v1/transactions", { meaning: "income", amount: 4_000_000, account_id: "main", tenant_id: "tenant-binh", is_salary: true });
    expect([rent.status, rent.json.error?.code]).toEqual([400, "cannot_be_salary"]);
    const interest = await call("POST", "/v1/transactions", { meaning: "income", amount: 37_000, account_id: "reserve", is_interest: true, is_salary: true });
    expect([interest.status, interest.json.error?.code]).toEqual([400, "cannot_be_salary"]);
    expect(one("SELECT COUNT(*) AS n FROM transactions WHERE amount IN (4000000, 37000)")).toEqual({ n: 0 });

    pendingLog("a", 20_000_000, "2026-12-10T08:00:00");
    const tx = (await assign("a", { amount: 20_000_000 })).json.data.transactions[0];
    expect((await call("POST", `/v1/transactions/${tx.id}/replace`, { meaning: "income", amount: 20_000_000, account_id: "main" })).json.error?.code).toBe("bank_tx");

    const off = await call("POST", `/v1/transactions/${tx.id}/salary`, { is_salary: false });
    expect(off.status).toBe(200);
    expect(off.json.data).toMatchObject({ tx: { id: tx.id, is_salary: 0 }, savings: null });
    expect(reminders()).toEqual([{ tx: tx.id, month: "2026-12", amount: 2_000_000, pct: 10, status: "void" }]);
    expect(one("SELECT action, target, detail FROM audit_log WHERE action = 'tx.salary'")).toEqual({ action: "tx.salary", target: `tx:${tx.id}`, detail: JSON.stringify({ from: true, to: false }) });
    expect((await call("POST", `/v1/transactions/${tx.id}/salary`, { is_salary: false })).status).toBe(200);
    expect(one("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'tx.salary'")).toEqual({ n: 1 });

    const on = await call("POST", `/v1/transactions/${tx.id}/salary`, { is_salary: true });
    expect(on.json.data).toMatchObject({ tx: { is_salary: 1 }, savings: { amount: 2_000_000, pct: 10 } });
    expect(reminders().map((t) => [t.amount, t.status])).toEqual([
      [2_000_000, "void"],
      [2_000_000, "open"],
    ]);

    const spend = await call("POST", "/v1/transactions", { meaning: "spend", amount: 100_000, account_id: "main", category_id: "groceries" });
    const bad = await call("POST", `/v1/transactions/${spend.json.data.tx.id}/salary`, { is_salary: true });
    expect([bad.status, bad.json.error?.code]).toEqual([400, "invalid_input"]);
  });

  it("UC-1205 AC-7: POST /v1/transactions hay /replace gửi opens_cycle (true hay false) → 400 model_changed kèm tên trường, không ghi gì; is_salary ở khoản chi → 400 invalid_input", async () => {
    const n0 = one<{ n: number }>("SELECT COUNT(*) AS n FROM transactions").n;
    for (const opens of [true, false]) {
      const r = await salary(20_000_000, "2026-12-10T08:00:00", { opens_cycle: opens });
      expect([r.status, r.json.error?.code, r.json.error?.fields]).toEqual([400, "model_changed", ["opens_cycle"]]);
    }
    const spend = await call("POST", "/v1/transactions", { meaning: "spend", amount: 100_000, account_id: "main", category_id: "groceries" });
    const replace = await call("POST", `/v1/transactions/${spend.json.data.tx.id}/replace`, { meaning: "spend", amount: 90_000, account_id: "main", category_id: "groceries", opens_cycle: false });
    expect([replace.status, replace.json.error?.code]).toEqual([400, "model_changed"]);
    const salaryOnSpend = await call("POST", "/v1/transactions", { meaning: "spend", amount: 100_000, account_id: "main", category_id: "groceries", is_salary: true });
    expect([salaryOnSpend.status, salaryOnSpend.json.error?.code]).toEqual([400, "invalid_input"]);
    expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM transactions").n).toBe(n0 + 1);
  });
});

describe("nhắc ① tự tick, sửa số, QR (UC-1206)", () => {
  it("UC-1206 AC-19: chuyển dưới 100.000 vào Tích luỹ (heo đất tự gom 8.000) không tự nhận vào ①, từ 100.000 thì nhận; liên kết cũ dưới ngưỡng không còn tính (đã trích, còn thiếu, dư cuối tháng); tick tay như cũ; việc chia dư → Ví Thưởng không có ngưỡng", async () => {
    await salary(20_000_000, "2026-12-10T08:00:00");
    await transfer(8_000, "main", "piggy", "2026-12-10T09:00:00");
    await transfer(99_999, "main", "savings", "2026-12-10T09:10:00");
    let [t] = await tasks();
    expect(t).toMatchObject({ status: "open", linked: 0, missing: 2_000_000 });
    await transfer(100_000, "main", "savings", "2026-12-10T09:20:00");
    [t] = await tasks();
    expect(t).toMatchObject({ status: "open", linked: 100_000, missing: 1_900_000 });
    // Liên kết 1.000 ghi từ trước khi có ngưỡng: lúc đọc không tính.
    const tiny = one<{ id: number }>("SELECT id FROM transactions WHERE amount = 8000");
    db.prepare("INSERT INTO month_task_tx (task_id, tx_id, amount) VALUES (?, ?, 8000)").run(t!.id, tiny.id);
    [t] = await tasks();
    expect(t).toMatchObject({ linked: 100_000, missing: 1_900_000 });
    expect((await snap()).month.savings).toMatchObject({ amount: 100_000, base: 20_000_000 });
    at("2027-01-01T09:00:00");
    expect(await monthCloseView(asD1(db), new Date())).toMatchObject({ month: "2026-12", pendingAtEnd: 1_900_000 });
    at("2026-12-10T10:00:00");
    expect((await call("POST", `/v1/month-tasks/${t!.id}/done`, {})).status).toBe(200);
    expect((await tasks()).find((x) => x.id === t!.id)).toMatchObject({ status: "done", auto: false });
  });

  it("UC-1206 AC-17: chuyển 07:00 (trước lương) không ghép; 10:00 2.600.000 → ① 20tr xong (ghép 2.000.000); lương vợ 25/12 nhắc 1.500.000 xong ngày 2/1; chia tháng 12 ngày 1/1 — phần dư 600.000 không ghép vào việc chia dư; Tích luỹ tháng 12 { 3.500.000, 35.000.000, 10, 10to30 }, tháng 1 base 0, level null", async () => {
    await transfer(1_000_000, "main", "savings", "2026-12-10T07:00:00");
    await salary(20_000_000, "2026-12-10T08:00:00");
    at("2026-12-10T10:00:00");
    const t = await transfer(2_600_000, "main", "savings", "2026-12-10T10:00:00");
    expect(t.json.data.effects.tasksDone).toEqual([expect.objectContaining({ kind: "savings" })]);
    expect(all("SELECT tx_id, amount FROM month_task_tx")).toEqual([{ tx_id: t.json.data.tx.id, amount: 2_000_000 }]);

    at("2026-12-25T09:00:00");
    const wife = await salary(15_000_000, "2026-12-25T08:00:00", { income_stream_id: null });
    expect(wife.json.data.effects.savings).toEqual({ amount: 1_500_000, pct: 10 });

    at("2027-01-01T09:00:00");
    const split = await call("POST", "/v1/month-close", { month: "2026-12" });
    expect(split.status).toBe(201);
    const surplusTask = (await tasks()).find((x) => x.kind === "surplus" && x.toPocket === "savings")!;
    expect(surplusTask).toMatchObject({ linked: 0, status: "open" });

    at("2027-01-02T09:00:00");
    await transfer(1_500_000, "main", "savings", "2027-01-02T09:00:00");
    const after = await tasks();
    expect(after.find((x) => x.kind === "savings" && x.month === "2026-12" && x.amount === 1_500_000)).toMatchObject({ status: "done", auto: true });
    expect(after.find((x) => x.id === surplusTask.id)).toMatchObject({ linked: 0, status: "open" });
    expect((await call("GET", "/v1/spend-by-category?period=2026-12")).json.data.savings).toEqual({ amount: 3_500_000, base: 35_000_000, pct: 10, level: "10to30", reason: null });
    expect((await snap()).month.savings).toMatchObject({ amount: 0, base: 0, level: null });
  });

  it("UC-1206 AC-18: dưới nhắc ① đúng một gợi ý — mục tiêu tài khoản đầu tiên (thứ tự ưu tiên) còn thiếu; mọi mục tiêu đủ → null; pendingTasks chỉ là phần còn thiếu của ①", async () => {
    await salary(20_000_000, "2026-12-10T08:00:00");
    const s = await snap();
    const first = (s.pockets.reserve.goals as { id: string; name: string; short: number }[]).find((g) => g.short > 0)!;
    expect(first).toBeTruthy();
    expect(s.month.goalHint).toEqual({ goalId: first.id, name: first.name, short: first.short });
    expect(s.nearSpend.pendingTasks).toBe(2_000_000);
    db.exec("UPDATE reserve_goals SET active = 0");
    expect((await snap()).month.goalHint).toBeNull();
  });

  it("UC-1206 AC-3: chuyển 2.000.000 sang tích luỹ → ① xong, đã trích 10%; cùng ngăn không ghép; chuyển trước lương không ghép; ví điện tử (ngoài ngăn) vào tích luỹ và tiền lẻ sang heo đất đều tính; 1.500.000 rồi 500.000 → xong ở lần hai", async () => {
    await transfer(2_000_000, "main", "savings", "2026-12-10T07:00:00");
    await salary(20_000_000, "2026-12-10T08:00:00");
    await transfer(1_000_000, "main", "card", "2026-12-10T08:10:00");
    expect((await tasks())[0]).toMatchObject({ status: "open", linked: 0 });
    await transfer(1_500_000, "ewallet", "savings", "2026-12-10T08:20:00");
    expect((await tasks())[0]).toMatchObject({ status: "open", linked: 1_500_000, missing: 500_000 });
    await transfer(500_000, "main", "piggy", "2026-12-10T08:25:00");
    const s = await snap();
    expect(s.month.tasks[0]).toMatchObject({ status: "done", auto: true, linked: 2_000_000 });
    expect(s.month.savings).toEqual({ amount: 2_000_000, base: 20_000_000, pct: 10, level: "10to30" });
  });

  it("UC-1206 AC-5: bỏ qua ① không lý do → 400 reason_required; sửa về 0 không lý do → 400; số âm → 400; sửa 3.000.000 sau khi ghép 2.000.000 → còn thiếu 1.000.000; bỏ qua có lý do → nhật ký month_task.skip có lý do", async () => {
    await salary(20_000_000, "2026-12-10T08:00:00");
    const id = (await tasks())[0]!.id;
    const noReason = await call("POST", `/v1/month-tasks/${id}/skip`, {});
    expect([noReason.status, noReason.json.error?.code]).toEqual([400, "reason_required"]);
    const zero = await call("PATCH", `/v1/month-tasks/${id}`, { amount: 0 });
    expect([zero.status, zero.json.error?.code]).toEqual([400, "reason_required"]);
    expect((await call("PATCH", `/v1/month-tasks/${id}`, { amount: -1 })).status).toBe(400);
    await transfer(1_000_000, "main", "savings", "2026-12-10T08:10:00");
    const more = await call("PATCH", `/v1/month-tasks/${id}`, { amount: 3_000_000 });
    expect(more.json.data.tasks[0]).toMatchObject({ amount: 3_000_000, linked: 1_000_000, missing: 2_000_000, status: "open" });
    expect(one<{ target: string; detail: string }>("SELECT target, detail FROM audit_log WHERE action = 'month_task.amount'")).toEqual({ target: `month_task:${id}`, detail: JSON.stringify({ from: 2_000_000, to: 3_000_000, reason: null }) });
    const skipped = await call("POST", `/v1/month-tasks/${id}/skip`, { reason: "Tháng này trả viện phí" });
    expect(skipped.json.data.tasks[0]).toMatchObject({ status: "skipped", reason: "Tháng này trả viện phí" });
    expect(one<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'month_task.skip'").detail).toContain("Tháng này trả viện phí");
  });

  it("UC-1206 AC-6: QR của ① tới tài khoản tích luỹ (heo đất không số tài khoản thì không), số còn thiếu sau khi ghép 1.500.000; ngăn Tích luỹ chỉ còn heo đất → không QR, tên tài khoản để nói \"Chuyển sang\"", async () => {
    await salary(20_000_000, "2026-12-10T08:00:00");
    await transfer(1_500_000, "main", "savings", "2026-12-10T08:10:00");
    expect((await tasks())[0]).toMatchObject({ missing: 500_000, targets: [{ accountId: "savings", name: "Tài khoản tích luỹ", bank: "TCB", accountNo: "2220002", subAccount: null }] });
    db.exec("UPDATE accounts SET pocket = 'reserve' WHERE id = 'savings'");
    expect((await tasks())[0]).toMatchObject({ targets: [], targetName: "Heo đất" });
  });

  it("UC-1206 AC-10: nhà một tài khoản (không tài khoản Tích luỹ) → đúng một việc ① 2.000.000, không QR; tick tay → xong, đã trích 0, chưa làm giảm 2.000.000; tick lần hai → 409 task_done; reopen chỉ mở lại; khoản lương đã huỷ → 409 task_void; việc không có → 404", async () => {
    db.exec(`
      UPDATE reserve_goals SET active = 0;
      DELETE FROM config WHERE k = 'surplus_reward_account';
      UPDATE accounts SET active = 0 WHERE id <> 'main';
    `);
    const r = await salary(20_000_000, "2026-12-10T08:00:00");
    let s = await snap();
    expect(s.month.tasks).toHaveLength(1);
    expect(s.month.tasks[0]).toMatchObject({ kind: "savings", amount: 2_000_000, pct: 10, toPocket: "savings", targets: [], targetName: null });
    const pending = s.nearSpend.pendingTasks;
    const id = s.month.tasks[0].id;
    const done = await call("POST", `/v1/month-tasks/${id}/done`);
    expect(done.status).toBe(200);
    expect(done.json.data.tasks[0]).toMatchObject({ status: "done", auto: false });
    expect(done.json.data.savings).toMatchObject({ amount: 0, base: 20_000_000 });
    s = await snap();
    expect(s.nearSpend.pendingTasks).toBe(pending - 2_000_000);
    expect(one("SELECT detail FROM audit_log WHERE action = 'month_task.done'")).toEqual({ detail: JSON.stringify({ mode: "manual", amount: 2_000_000 }) });
    expect((await call("POST", `/v1/month-tasks/${id}/done`)).json.error?.code).toBe("task_done");
    expect((await call("POST", `/v1/month-tasks/${id}/reopen`)).json.data.tasks[0]).toMatchObject({ status: "open", missing: 2_000_000 });
    await call("POST", `/v1/transactions/${r.json.data.tx.id}/void`);
    const voided = await call("POST", `/v1/month-tasks/${id}/done`);
    expect([voided.status, voided.json.error?.code]).toEqual([409, "task_void"]);
    expect((await call("POST", "/v1/month-tasks/99999/done")).status).toBe(404);
  });

  /** ① 2.000.000 cần ghép; T1, T2 2.000.000 sang tài khoản tích luỹ ghi thẳng vào sổ, chưa lượt ghép nào chạy. */
  const raceSetup = async () => {
    await salary(20_000_000, "2026-12-10T08:00:00");
    const insert = db.prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, week_key, month_key, source)
       VALUES (?, 2000000, 'transfer', 'main', 'savings', '2026-W50', '2026-12', 'manual')`,
    );
    const t1 = Number(insert.run(AT("2026-12-10T08:10:00")).lastInsertRowid);
    const t2 = Number(insert.run(AT("2026-12-10T08:20:00")).lastInsertRowid);
    return { t1, t2, task: (await tasks())[0]!.id };
  };
  const links = (task: number) => all("SELECT tx_id, amount FROM month_task_tx WHERE task_id = ? ORDER BY tx_id", task);

  it("UC-1206 AC-11: lượt B tính từ trạng thái trước lượt A → câu ghi ① ← T2 không ghi dòng nào; T2 còn trọn; huỷ T1 → ① mở lại và lần ghép sau đó nhận T2", async () => {
    const { t1, t2, task } = await raceSetup();
    await afterWrite(asD1(db)); // lượt A: ① ← T1
    const b = await linkTaskStatement(asD1(db), task, t2, 2_000_000).run(); // lượt B: đã đọc ① còn thiếu 2.000.000 trước A
    expect(b.meta.changes).toBe(0);
    expect(links(task)).toEqual([{ tx_id: t1, amount: 2_000_000 }]);
    expect((await call("POST", `/v1/transactions/${t1}/void`)).status).toBe(200);
    expect((await tasks())[0]).toMatchObject({ status: "open", linked: 0, missing: 2_000_000 });
    await afterWrite(asD1(db));
    expect(links(task)).toEqual([
      { tx_id: t1, amount: 2_000_000 },
      { tx_id: t2, amount: 2_000_000 },
    ]);
    expect((await tasks())[0]).toMatchObject({ status: "done", auto: true, linked: 2_000_000 });
  });

  it("UC-1206 AC-11: T2 đã dùng cho việc khác → huỷ T1 làm ① mở lại; T3 tự ghép vào ① — liên kết cũ của T1 (đã huỷ) không chặn", async () => {
    const { t1, t2, task } = await raceSetup();
    await afterWrite(asD1(db));
    const other = await salary(10_000_000, "2026-12-10T08:30:00", { income_stream_id: null, is_salary: true });
    const otherTask = Number(one<{ id: number }>("SELECT id FROM month_tasks WHERE income_tx_id = ?", other.json.data.tx.id).id);
    db.prepare("INSERT INTO month_task_tx (task_id, tx_id, amount) VALUES (?, ?, 2000000)").run(otherTask, t2);
    expect((await call("POST", `/v1/transactions/${t1}/void`)).status).toBe(200);
    expect((await tasks()).find((t) => t.id === task)).toMatchObject({ status: "open", linked: 0 });
    const t3 = await transfer(2_000_000, "main", "savings", "2026-12-10T08:40:00");
    expect(t3.json.data.effects.tasksDone).toEqual([{ id: task, kind: "savings" }]);
    expect(links(task)).toEqual([
      { tx_id: t1, amount: 2_000_000 },
      { tx_id: t3.json.data.tx.id, amount: 2_000_000 },
    ]);
  });

  it("UC-1206 AC-16: ① của lương 30.000.000 (10%, 3.000.000) — sửa 9.000.000 → pct 30; 200.000 → pct 0; 0 không lý do và bỏ qua không lý do → 400 reason_required; 0 có lý do → lưu, nhật ký có lý do; 40.000.000 → lưu, pct 100", async () => {
    await salary(30_000_000, "2026-12-10T08:00:00");
    const id = (await tasks())[0]!.id;
    const row = () => one<{ amount: number; pct: number; reason: string | null }>("SELECT amount, pct, reason FROM month_tasks WHERE id = ?", id);
    expect(row()).toMatchObject({ amount: 3_000_000, pct: 10 });
    expect((await call("PATCH", `/v1/month-tasks/${id}`, { amount: 9_000_000 })).status).toBe(200);
    expect(row()).toMatchObject({ amount: 9_000_000, pct: 30 });
    expect((await call("PATCH", `/v1/month-tasks/${id}`, { amount: 200_000 })).status).toBe(200);
    expect(row()).toMatchObject({ amount: 200_000, pct: 0 });
    expect((await call("PATCH", `/v1/month-tasks/${id}`, { amount: 0 })).json.error?.code).toBe("reason_required");
    expect((await call("POST", `/v1/month-tasks/${id}/skip`, {})).json.error?.code).toBe("reason_required");
    expect((await call("PATCH", `/v1/month-tasks/${id}`, { amount: 0, reason: "Tháng này trả viện phí" })).status).toBe(200);
    expect(row()).toEqual({ amount: 0, pct: 0, reason: "Tháng này trả viện phí" });
    expect(all("SELECT detail FROM audit_log WHERE action = 'month_task.amount'").at(-1)).toEqual({ detail: JSON.stringify({ from: 200_000, to: 0, reason: "Tháng này trả viện phí" }) });
    expect((await call("PATCH", `/v1/month-tasks/${id}`, { amount: 40_000_000 })).status).toBe(200);
    expect(row()).toMatchObject({ amount: 40_000_000, pct: 100 });
  });
});

describe("chia dư cuối tháng (UC-1207)", () => {
  /**
   * Hộ C, payday 10, ngày 2026-12-01: tháng 11 thu 24.300.000 (không phải lương), chi từ Vận hành 13.500.000 = 4.500.000 khoản
   * phải trả (gắn mục tiêu `operating` "Tiền nhà") + 9.000.000 ăn tiêu → Vận hành tại 00:00 1/12 = 12.000.000; phải trả tháng 12
   * 4.500.000; Ví Thưởng `bonus`, 50%.
   */
  const november = () => {
    at("2026-12-01T09:00:00");
    const ins = db.prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, counter_account_id, category_id, goal_id, week_key, month_key, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'W', ?, 'manual')`,
    );
    db.exec("INSERT INTO reserve_goals (id, name, account_id, target_amount, monthly_amount, repeat_months, pays_from, sort) VALUES ('rent', 'Tiền nhà', NULL, 4500000, 4500000, 1, 'operating', 9)");
    ins.run(AT("2026-11-02T09:00:00"), 9_300_000, "income", null, "main", null, null, "2026-11");
    ins.run(AT("2026-11-25T08:00:00"), 15_000_000, "income", null, "main", null, null, "2026-11");
    ins.run(AT("2026-11-05T09:00:00"), 4_500_000, "spend", "main", null, "housing", "rent", "2026-11");
    ins.run(AT("2026-11-15T12:00:00"), 9_000_000, "spend", "main", null, "groceries", null, "2026-11");
  };
  const close = async () => (await snap()).monthClose;

  it("UC-1207 AC-4: 1/12 → monthClose tháng 11 { E 12.000.000, W 0, L 0, P 4.500.000, D 2.700.000, dư 4.800.000 → 2.400.000 / 2.400.000, ask }; log ăn tiêu 300.000 lúc 30/11 23:00 rà soát ghi 02:00 → E 11.700.000, D 2.790.000, dư 4.410.000; Ví Thưởng chưa chọn → rewardAmount 0", async () => {
    november();
    expect(await close()).toMatchObject({ month: "2026-11", operatingEnd: 12_000_000, pendingAtEnd: 0, earlySalary: 0, heldPayables: 4_500_000, heldToPayday: 2_700_000, surplus: 4_800_000, savingsAmount: 2_400_000, rewardAmount: 2_400_000, status: "ask" });
    db.prepare("INSERT INTO transactions (at, amount, meaning, account_id, category_id, week_key, month_key, source) VALUES (?, 300000, 'spend', 'main', 'groceries', 'W', '2026-11', 'sepay')").run(AT("2026-11-30T23:00:00"));
    expect(await close()).toMatchObject({ operatingEnd: 11_700_000, heldToPayday: 2_790_000, surplus: 4_410_000, savingsAmount: 2_205_000, rewardAmount: 2_205_000 });
    db.exec("DELETE FROM config WHERE k = 'surplus_reward_account'");
    expect(await close()).toMatchObject({ savingsAmount: 2_205_000, rewardAmount: 0 });
  });

  it("UC-1207 AC-4: nhắc ① của lương 25/11 còn thiếu 1.500.000 lúc 00:00 1/12 → pendingAtEnd 1.500.000, dư 3.300.000; chuyển 1.500.000 ngày 2/12 không làm số đổi", async () => {
    november();
    at("2026-11-26T09:00:00");
    const income = one<{ id: number }>("SELECT id FROM transactions WHERE amount = 15000000 AND month_key = '2026-11'").id;
    expect((await call("POST", `/v1/transactions/${income}/salary`, { is_salary: true })).json.data.savings).toEqual({ amount: 1_500_000, pct: 10 });
    at("2026-12-01T09:00:00");
    expect(await close()).toMatchObject({ pendingAtEnd: 1_500_000, surplus: 3_300_000 });
    at("2026-12-02T09:00:00");
    await transfer(1_500_000, "main", "savings", "2026-12-02T08:00:00");
    expect(await close()).toMatchObject({ operatingEnd: 12_000_000, pendingAtEnd: 1_500_000, surplus: 3_300_000 });
  });

  it("UC-1207 AC-4: payday_day 1, lương 20.000.000 là lương về 30/11 → earlySalary 20.000.000, heldToPayday 0, không bị chia như tiền dư", async () => {
    november();
    db.exec("UPDATE config SET v = '1' WHERE k = 'payday_day'");
    at("2026-11-30T09:00:00");
    await salary(20_000_000, "2026-11-30T08:00:00");
    at("2026-12-01T09:00:00");
    const c = await close();
    expect(c).toMatchObject({ earlySalary: 20_000_000, heldToPayday: 0 });
    expect(c.surplus).toBe(c.operatingEnd - c.pendingAtEnd - 20_000_000 - c.heldPayables);
  });

  it("UC-1207 AC-5: POST /v1/month-close { 2026-11, 60 } → 201, hai việc 2.880.000 → Tích luỹ / 1.920.000 → Ví Thưởng, status split, nhật ký month_close.split; gửi lại → 409 month_closed; tháng 10 → 400 invalid_month; chuyển 2.880.000 sang tích luỹ → việc Tích luỹ tự xong", async () => {
    november();
    const r = await call("POST", "/v1/month-close", { month: "2026-11", savings_pct: 60 });
    expect(r.status).toBe(201);
    expect(r.json.data.monthClose).toMatchObject({ month: "2026-11", surplus: 4_800_000, savingsAmount: 2_880_000, rewardAmount: 1_920_000, status: "split" });
    expect(all("SELECT to_pocket, to_account_id, amount, pct, status FROM month_tasks WHERE kind = 'surplus' ORDER BY id")).toEqual([
      { to_pocket: "savings", to_account_id: null, amount: 2_880_000, pct: 60, status: "open" },
      { to_pocket: null, to_account_id: "bonus", amount: 1_920_000, pct: null, status: "open" },
    ]);
    expect(one("SELECT target FROM audit_log WHERE action = 'month_close.split'")).toEqual({ target: "month:2026-11" });
    expect((await close()).status).toBe("split");
    const again = await call("POST", "/v1/month-close", { month: "2026-11" });
    expect([again.status, again.json.error?.code]).toEqual([409, "month_closed"]);
    const oct = await call("POST", "/v1/month-close", { month: "2026-10" });
    expect([oct.status, oct.json.error?.code]).toEqual([400, "invalid_month"]);
    const t = await transfer(2_880_000, "main", "savings", "2026-12-01T09:00:00");
    expect(t.json.data.effects.tasksDone).toEqual([expect.objectContaining({ kind: "surplus" })]);
  });

  it("UC-1207 AC-5: hai yêu cầu Chia cùng lúc → đúng một month_surplus, đúng hai việc, lượt kia 409 month_closed; ca khác: …/2026-11/skip → skipped, không việc", async () => {
    november();
    const results = await Promise.all([call("POST", "/v1/month-close", { month: "2026-11" }), call("POST", "/v1/month-close", { month: "2026-11" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.json.error?.code).toBe("month_closed");
    expect(one("SELECT COUNT(*) AS n FROM month_surplus WHERE month_key = '2026-11'")).toEqual({ n: 1 });
    expect(one("SELECT COUNT(*) AS n FROM month_tasks WHERE kind = 'surplus'")).toEqual({ n: 2 });

    db = householdC();
    call = client(db);
    november();
    const skip = await call("POST", "/v1/month-close/2026-11/skip");
    expect(skip.status).toBe(200);
    expect(skip.json.data.monthClose).toMatchObject({ month: "2026-11", status: "skipped" });
    expect(one("SELECT COUNT(*) AS n FROM month_tasks WHERE kind = 'surplus'")).toEqual({ n: 0 });
    expect(one("SELECT target FROM audit_log WHERE action = 'month_close.skip'")).toEqual({ target: "month:2026-11" });
  });

  it("UC-1207 AC-6: Vận hành cuối tháng 6.000.000 → dư −1.200.000, POST → 409 nothing_to_split; sang 2027-01-01 chưa bấm → chỉ còn monthClose tháng 12, tháng 11 không lưu dòng nào", async () => {
    november();
    db.exec("UPDATE accounts SET opening_balance = opening_balance - 6000000 WHERE id = 'main'");
    expect(await close()).toMatchObject({ month: "2026-11", operatingEnd: 6_000_000, surplus: -1_200_000, savingsAmount: 0, rewardAmount: 0, status: "ask" });
    const r = await call("POST", "/v1/month-close", { month: "2026-11" });
    expect([r.status, r.json.error?.code]).toEqual([409, "nothing_to_split"]);
    at("2027-01-01T09:00:00");
    expect((await close()).month).toBe("2026-12");
    expect(one("SELECT COUNT(*) AS n FROM month_surplus WHERE month_key = '2026-11'")).toEqual({ n: 0 });
  });

  it("UC-1207 AC-6: ngày triển khai 2026-11-12 sau migration (DB dựng từ chuỗi migration) → monthClose tháng 10 skipped; chia tháng 10 → 409 month_closed", async () => {
    const migrated = asD1(migratedDb());
    const now = new Date(AT("2026-11-12T09:00:00"));
    expect(await monthCloseView(migrated, now)).toMatchObject({ month: "2026-10", status: "skipped" });
    await expect(splitMonth(migrated, { month: "2026-10" }, null, now)).rejects.toMatchObject({ code: "month_closed", status: 409 });
    // Hoàn tác (UC-1207 AC-7) không mở lại dòng migration ghi sẵn (không người bấm).
    await expect(reopenMonth(migrated, "2026-10", now)).rejects.toMatchObject({ code: "month_closed", status: 409 });
  });

  it("UC-1207 AC-7: Chia rồi POST …/2026-11/reopen → 200 status ask, hai việc chia dư void, không còn dòng month_surplus, nhật ký month_close.reopen; chia lại → 201; Để lại rồi reopen → ask; chưa bấm → 409 month_open; tháng 10 → 400 invalid_month", async () => {
    november();
    expect((await call("POST", "/v1/month-close", { month: "2026-11", savings_pct: 60 })).status).toBe(201);
    const r = await call("POST", "/v1/month-close/2026-11/reopen");
    expect(r.status).toBe(200);
    expect(r.json.data.monthClose).toMatchObject({ month: "2026-11", surplus: 4_800_000, status: "ask" });
    expect(all("SELECT status FROM month_tasks WHERE kind = 'surplus' ORDER BY id")).toEqual([{ status: "void" }, { status: "void" }]);
    expect(one("SELECT COUNT(*) AS n FROM month_surplus WHERE month_key = '2026-11'")).toEqual({ n: 0 });
    expect(one("SELECT target FROM audit_log WHERE action = 'month_close.reopen'")).toEqual({ target: "month:2026-11" });
    expect((await call("POST", "/v1/month-close", { month: "2026-11" })).status).toBe(201);
    expect(one("SELECT COUNT(*) AS n FROM month_tasks WHERE kind = 'surplus' AND status = 'open'")).toEqual({ n: 2 });
    expect((await call("POST", "/v1/month-close/2026-11/reopen")).status).toBe(200);
    const open = await call("POST", "/v1/month-close/2026-11/reopen");
    expect([open.status, open.json.error?.code]).toEqual([409, "month_open"]);
    expect((await call("POST", "/v1/month-close/2026-11/skip")).status).toBe(200);
    const skipped = await call("POST", "/v1/month-close/2026-11/reopen");
    expect([skipped.status, skipped.json.data?.monthClose?.status]).toEqual([200, "ask"]);
    const oct = await call("POST", "/v1/month-close/2026-10/reopen");
    expect([oct.status, oct.json.error?.code]).toEqual([400, "invalid_month"]);
  });

  it("UC-1207 AC-7: việc chia dư đã ghép chuyển khoản (tự tick) → reopen 409 month_task_started, không đổi gì; việc đã Đã chuyển tay cũng vậy", async () => {
    november();
    expect((await call("POST", "/v1/month-close", { month: "2026-11", savings_pct: 60 })).status).toBe(201);
    await transfer(1_000_000, "main", "savings", "2026-12-01T09:00:00");
    const r = await call("POST", "/v1/month-close/2026-11/reopen");
    expect([r.status, r.json.error?.code]).toEqual([409, "month_task_started"]);
    expect(one("SELECT status FROM month_surplus WHERE month_key = '2026-11'")).toEqual({ status: "split" });
    expect(one("SELECT COUNT(*) AS n FROM month_tasks WHERE kind = 'surplus' AND status = 'open'")).toEqual({ n: 2 });

    db = householdC();
    call = client(db);
    november();
    expect((await call("POST", "/v1/month-close", { month: "2026-11" })).status).toBe(201);
    const reward = one("SELECT id FROM month_tasks WHERE kind = 'surplus' AND to_account_id IS NOT NULL") as { id: number };
    expect((await call("POST", `/v1/month-tasks/${reward.id}/done`)).status).toBe(200);
    const done = await call("POST", "/v1/month-close/2026-11/reopen");
    expect([done.status, done.json.error?.code]).toEqual([409, "month_task_started"]);
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

  it("UC-101 AC-29: chi 200.000, thu Việc phụ 3.000.000, chuyển 1.000.000 sang tích luỹ, mua tài sản 2.000.000 từ tích luỹ → không fund, không lần chia; khoản chi trả nearSpend = tổng Vận hành sau khi ghi; Tích luỹ −2.000.000", async () => {
    const r = await call("POST", "/v1/transactions", { meaning: "spend", amount: 200_000, account_id: "main", category_id: "groceries" });
    expect(r.json.data.nearSpend.amount).toBe(1_000_000);
    expect(r.json.data).not.toHaveProperty("wallet");
    await call("POST", "/v1/transactions", { meaning: "income", amount: 3_000_000, account_id: "main", income_stream_id: "side" });
    await transfer(1_000_000, "main", "savings", "2026-12-10T08:20:00");
    const before = (await snap()).pockets.savings.total;
    expect((await call("POST", "/v1/transactions", { meaning: "buy_asset", amount: 2_000_000, account_id: "savings", asset_kind: "gold" })).status).toBe(201);
    expect((await snap()).pockets.savings.total).toBe(before - 2_000_000);
    expect(one("SELECT COUNT(*) AS n FROM transactions WHERE meaning = 'fund'")).toEqual({ n: 0 });
  });
});

describe("mã việc trong nội dung chuyển khoản (UC-1206 AC-20, ingest UC-303 AC-33)", () => {
  /** Log tiền ra từ tài khoản chính, đang nối SePay và báo cả tiền ra lúc log về (nhập tay ở test thì tắt lại). */
  const outLog = async (id: string, amount: number, vn: string, content: string) => {
    db.exec("UPDATE accounts SET sepay_enabled = 1, sepay_out = 1 WHERE id = 'main'");
    await ingestLog(asD1(db), { id, at: AT(vn), amount, direction: "out", accountNo: "1110001", content, refCode: null, referenceNumber: null, raw: {} }, "webhook", new Date());
    db.exec("UPDATE accounts SET sepay_enabled = 0, sepay_out = 0 WHERE id = 'main'");
  };
  beforeEach(() => {
    // Mẫu tự gán khớp mọi chuyển khoản ra có chữ MBVCB thành chi tiêu — mã việc phải thắng.
    db.exec("INSERT INTO rules (priority, match_type, pattern, meaning, is_salary, category_id) VALUES (1, 'content', 'MBVCB', 'spend', 0, 'groceries')");
  });

  it("UC-1206 AC-20: mỗi việc có mã riêng (snapshot `code`, cột sinh từ id, khớp hàm của domain); nội dung QR của ① là 'TL {mã} T12'", async () => {
    await salary(20_000_000, "2026-12-10T08:00:00");
    const [t] = await tasks();
    const row = one<{ id: number; code: string }>("SELECT id, code FROM month_tasks WHERE kind = 'savings'");
    expect(row.code).toBe(taskCode(row.id));
    expect(t).toMatchObject({ code: row.code });
    expect(taskMemo({ kind: "savings", toAccountId: t!.toAccountId, month: t!.month, code: row.code })).toBe(`TL ${row.code} T12`);
  });

  it("UC-303 AC-33: log ra có 'TL {mã} T{tháng}' khớp nhắc đang mở → thắng mẫu tự gán, thành chuyển khoản tới tài khoản tích luỹ có số tài khoản (đích QR), ghép thẳng kể cả dưới 100.000; mã chia dư → Ví Thưởng ghép vào tài khoản Ví Thưởng; mã không khớp việc nào hoặc sai tháng → luồng thường; đường cũ (≥ 100.000 tới ngăn Tích luỹ) vẫn tự tick", async () => {
    await salary(20_000_000, "2026-12-10T08:00:00");
    const savingsTask = one<{ id: number; code: string }>("SELECT id, code FROM month_tasks WHERE kind = 'savings'");
    await outLog("L1", 50_000, "2026-12-10T09:00:00", `MBVCB.1234.tl${savingsTask.code.toLowerCase()}t12.CT tu 1110001`);
    expect(one("SELECT meaning, account_id AS fromId, counter_account_id AS toId, amount FROM transactions WHERE log_id = 'L1'")).toEqual({ meaning: "transfer", fromId: "main", toId: "savings", amount: 50_000 });
    expect(one("SELECT status FROM bank_logs WHERE id = 'L1'")).toEqual({ status: "assigned" });
    let [t] = await tasks();
    expect(t).toMatchObject({ id: savingsTask.id, linked: 50_000, missing: 1_950_000 });

    // Mã sai (không việc nào mở có mã đó) → luồng thường: mẫu MBVCB ghi chi tiêu.
    await outLog("L2", 70_000, "2026-12-10T09:10:00", "MBVCB.1235.TL ZZZZ T12");
    expect(one("SELECT meaning, category_id AS categoryId FROM transactions WHERE log_id = 'L2'")).toEqual({ meaning: "spend", categoryId: "groceries" });

    // Đúng mã nhưng sai tháng (việc của tháng 12, nội dung ghi T11) → luồng thường.
    await outLog("L2b", 80_000, "2026-12-10T09:15:00", `MBVCB.1237.TL ${savingsTask.code} T11`);
    expect(one("SELECT meaning FROM transactions WHERE log_id = 'L2b'")).toEqual({ meaning: "spend" });

    // Việc chia dư → Ví Thưởng (tài khoản bonus) nhận theo mã VT.
    db.exec("INSERT INTO month_tasks (kind, month_key, to_account_id, amount, created_at, updated_at) VALUES ('surplus', '2026-11', 'bonus', 600000, '2026-12-01T02:00:00.000Z', '2026-12-01T02:00:00.000Z')");
    const reward = one<{ id: number; code: string }>("SELECT id, code FROM month_tasks WHERE to_account_id = 'bonus'");
    await outLog("L3", 600_000, "2026-12-10T09:20:00", `MBVCB.1236.VT ${reward.code} T11`);
    expect(one("SELECT counter_account_id AS toId FROM transactions WHERE log_id = 'L3'")).toEqual({ toId: "bonus" });
    expect((await tasks()).find((x) => x.id === reward.id)).toMatchObject({ status: "done", auto: true });

    // Đường dự phòng: chuyển tay 1.950.000 tới tài khoản tích luỹ (≥ 100.000) vẫn tự tick ①.
    await transfer(1_950_000, "main", "savings", "2026-12-10T10:00:00");
    [t] = (await tasks()).filter((x) => x.id === savingsTask.id);
    expect(t).toMatchObject({ status: "done", auto: true, linked: 2_000_000 });
  });
});
