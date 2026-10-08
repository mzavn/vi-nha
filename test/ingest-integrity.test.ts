// Một giao dịch ngân hàng không bao giờ vào sổ hai lần — kể cả khi các request chạy chen nhau.
// D1 tuần tự hoá từng batch, nên "chạy chen" ở đây là: hai request cùng đọc trạng thái cũ rồi lần lượt ghi.
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { assignLog, ingestLog, listPendingLogs, pairLogs, unassignTransaction, type ParsedBankLog } from "../src/services/ingest";
import { countAccount, createEntry, setTransferOrderStatus, voidTransaction } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  raw = openDb();
  // Bối cảnh: các tài khoản nối feed trong seed báo cả tiền ra (ADR-66) — log `out` tự gán theo rule như trước.
  raw.prepare("UPDATE accounts SET sepay_out = 1 WHERE sepay_enabled = 1").run();
  env = { DB: asD1(raw) } as Env;
});

const now = () => new Date("2026-09-22T02:00:05.000Z");
const log = (over: Partial<ParsedBankLog>): ParsedBankLog => ({
  id: "1",
  at: "2026-09-22T02:00:00.000Z",
  amount: 100_000,
  direction: "out",
  accountNo: "0011xxxxxxx", // vcb-husband
  content: null,
  refCode: null,
  referenceNumber: null,
  raw: {},
  ...over,
});
const count = (sql: string, ...args: (string | number)[]) => (raw.prepare(sql).get(...args) as { n: number }).n;
const balance = (walletId: string) => (raw.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = ?").get(walletId) as { balance: number }).balance;

describe("webhook và cron vá đêm cùng một giao dịch", () => {
  it("khác id nhưng cùng mã tham chiếu trong cùng tài khoản → một log, một giao dịch", async () => {
    await ingestLog(env.DB, log({ id: "webhook-9", content: "an trua EAN", refCode: "EAN", referenceNumber: "FT26265001" }), "webhook", now());
    const again = await ingestLog(env.DB, log({ id: "api-uuid-9", content: "an trua EAN", refCode: "EAN", referenceNumber: "FT26265001" }), "backfill", now());
    expect(again.created).toBe(false);
    expect(count("SELECT COUNT(*) n FROM bank_logs")).toBe(1);
    expect(count("SELECT COUNT(*) n FROM transactions WHERE meaning = 'spend'")).toBe(1);
    expect(balance("food")).toBe(-100_000);
  });

  it("chạy chen: log đã có mà request thứ hai vẫn tới được bước ghi → unique index chặn", async () => {
    raw.prepare(
      `INSERT INTO bank_logs (id, at, amount, direction, account_id, reference_number, status)
       VALUES ('w1', '2026-09-22T02:00:00.000Z', 100000, 'out', 'vcb-husband', 'FT1', 'pending')`,
    ).run();
    // Mô phỏng request thua race: bỏ qua bước SELECT kiểm tra trước, đi thẳng vào INSERT OR IGNORE.
    const res = raw
      .prepare(
        `INSERT OR IGNORE INTO bank_logs (id, at, amount, direction, account_id, reference_number, status)
         VALUES ('b1', '2026-09-22T02:00:00.000Z', 100000, 'out', 'vcb-husband', 'FT1', 'pending')`,
      )
      .run();
    expect(Number(res.changes)).toBe(0);
  });
});

describe("gán hai lần cùng lúc", () => {
  it("lần gán thứ hai bị từ chối 409, sổ chỉ có một bộ giao dịch", async () => {
    await ingestLog(env.DB, log({ id: "L1", amount: 300_000, content: "khong khop" }), "webhook", now());
    const splits = [{ meaning: "spend" as const, amount: 300_000, category_id: "groceries" }];
    await assignLog(env.DB, "L1", splits, "husband", now());
    // Gán lại sau khi đã gán: bị chặn ngay ở bước đọc. Trường hợp hai request cùng đọc thấy 'pending' rồi mới ghi
    // được chặn bởi trigger trg_tx_needs_pending_log (test trực tiếp ở schema.test.ts).
    await expect(assignLog(env.DB, "L1", splits, "husband", now())).rejects.toMatchObject({ code: "not_pending" });
    expect(count("SELECT COUNT(*) n FROM transactions WHERE log_id = 'L1'")).toBe(1);
  });

  it("ghép cặp tay khi một chân vừa được gán ở nơi khác → 409, không sinh giao dịch", async () => {
    await ingestLog(env.DB, log({ id: "P1", direction: "out", amount: 5_000_000, content: "x" }), "webhook", now());
    await ingestLog(env.DB, log({ id: "P2", direction: "in", accountNo: "1903xxxxxxx", amount: 5_000_000, at: "2026-09-22T04:00:00.000Z", content: "y" }), "webhook", now());
    await assignLog(env.DB, "P2", [{ meaning: "refund", amount: 5_000_000, wallet_id: "nice-to-have" }], "husband", now());
    raw.prepare("UPDATE bank_logs SET status = 'pending' WHERE id = 'P2'").run(); // request kia đọc trạng thái cũ
    raw.prepare("UPDATE bank_logs SET status = 'assigned' WHERE id = 'P2'").run(); // …rồi request này ghi xong trước
    await expect(pairLogs(env.DB, "P1", "P2")).rejects.toMatchObject({ code: "not_pending" });
    expect(count("SELECT COUNT(*) n FROM transactions WHERE meaning = 'transfer'")).toBe(0);
  });
});

describe("gỡ gán một log đã tách nhiều dòng", () => {
  it("huỷ mọi dòng của log rồi mới trả log về chờ; gán lại không đếm hai lần", async () => {
    await ingestLog(env.DB, log({ id: "S1", amount: 500_000, content: "sieu thi" }), "webhook", now());
    await assignLog(
      env.DB,
      "S1",
      [
        { meaning: "spend", amount: 300_000, category_id: "groceries" },
        { meaning: "spend", amount: 200_000, category_id: "health" },
      ],
      "husband",
      now(),
    );
    const firstTx = (raw.prepare("SELECT id FROM transactions WHERE log_id = 'S1' ORDER BY id LIMIT 1").get() as { id: number }).id;
    const res = await unassignTransaction(env.DB, firstTx);
    expect(res.voided).toHaveLength(2);
    expect(count("SELECT COUNT(*) n FROM transactions WHERE log_id = 'S1' AND status = 'active'")).toBe(0);
    expect(balance("food")).toBe(0);
    expect(balance("nice-to-have")).toBe(0);

    await assignLog(env.DB, "S1", [{ meaning: "spend", amount: 500_000, category_id: "groceries" }], "husband", now());
    expect(balance("food")).toBe(-500_000);
    expect(balance("nice-to-have")).toBe(0);
  });

  it("gỡ giao dịch khớp lệnh chuyển tiền thì lệnh đó quay lại chờ", async () => {
    raw.prepare("INSERT INTO transfer_orders (id, batch_id, from_account_id, to_account_id, amount, memo) VALUES (7, 'A99', 'vcb-husband', 'tcb-husband', 9000000, 'PF A9B8C7')").run();
    await ingestLog(env.DB, log({ id: "O1", amount: 9_000_000, content: "PF A9B8C7" }), "webhook", now());
    expect(raw.prepare("SELECT status, matched_log_id FROM transfer_orders WHERE id = 7").get()).toEqual({ status: "done", matched_log_id: "O1" });
    const tx = (raw.prepare("SELECT id FROM transactions WHERE log_id = 'O1'").get() as { id: number }).id;
    await unassignTransaction(env.DB, tx);
    expect(raw.prepare("SELECT status, matched_log_id FROM transfer_orders WHERE id = 7").get()).toEqual({ status: "pending", matched_log_id: null });
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'O1'").get()).toEqual({ status: "pending" });
  });
});

describe("lệnh chuyển tiền", () => {
  it("người ngoài chuyển tiền vào với mã kiểu cũ đoán được không làm lệnh thành 'đã chuyển'", async () => {
    raw.prepare("INSERT INTO transfer_orders (id, batch_id, from_account_id, to_account_id, amount, memo) VALUES (8, 'A12', 'vcb-husband', 'tcb-husband', 9000000, 'PF H4K8M2')").run();
    await ingestLog(env.DB, log({ id: "G1", direction: "in", accountNo: "1903xxxxxxx", amount: 9_000_000, content: "PF A12" }), "webhook", now());
    expect(raw.prepare("SELECT status FROM transfer_orders WHERE id = 8").get()).toEqual({ status: "pending" });
  });

  it("một lần chia có hai lệnh: chân thứ hai gắn đúng giao dịch của lệnh mình", async () => {
    raw.prepare("INSERT INTO transfer_orders (id, batch_id, from_account_id, to_account_id, amount, memo) VALUES (21, 'A5', 'vcb-husband', 'tcb-husband', 900000, 'PF AAAA22')").run();
    raw.prepare("INSERT INTO transfer_orders (id, batch_id, from_account_id, to_account_id, amount, memo) VALUES (22, 'A5', 'vcb-husband', 'mb-husband', 300000, 'PF BBBB33')").run();
    await ingestLog(env.DB, log({ id: "T1", direction: "out", amount: 900_000, content: "PF AAAA22" }), "webhook", now());
    await ingestLog(env.DB, log({ id: "T2", direction: "out", amount: 300_000, content: "PF BBBB33", at: "2026-09-22T02:30:00.000Z" }), "webhook", now());
    await ingestLog(env.DB, log({ id: "T3", direction: "in", accountNo: "0888xxxxxxx", amount: 300_000, content: "PF BBBB33", at: "2026-09-22T02:31:00.000Z" }), "webhook", now());
    expect(raw.prepare("SELECT log_id, log_id_2 FROM transactions WHERE meaning = 'transfer' ORDER BY id").all()).toEqual([
      { log_id: "T1", log_id_2: null },
      { log_id: "T2", log_id_2: "T3" },
    ]);
  });
});

describe("lương giả", () => {
  it("người ngoài chuyển 1.000 ₫ nội dung 'LUONG THANG' → không tự ghi thu nhập, không tự chia; nằm chờ để hỏi", async () => {
    await ingestLog(env.DB, log({ id: "F1", direction: "in", amount: 1_000, content: "LUONG THANG 9" }), "webhook", now());
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'F1'").get()).toEqual({ status: "pending" });
    expect(count("SELECT COUNT(*) n FROM transactions")).toBe(0);
  });

  it("lương thật (đủ ngưỡng) vẫn tự chia ngay; ngưỡng chỉnh được trong config", async () => {
    await ingestLog(env.DB, log({ id: "S9", direction: "in", amount: 30_000_000, content: "LUONG THANG 9" }), "webhook", now());
    expect(count("SELECT COUNT(*) n FROM transactions WHERE meaning = 'fund'")).toBeGreaterThan(0);

    raw.prepare("INSERT INTO config (k, v) VALUES ('salary_min_amount', '50000000')").run();
    await ingestLog(env.DB, log({ id: "S10", direction: "in", amount: 30_000_000, content: "LUONG THANG 10", at: "2026-09-22T05:00:00.000Z" }), "webhook", now());
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'S10'").get()).toEqual({ status: "pending" });
  });

  it("lương giả lọt qua (đủ ngưỡng) vẫn gỡ được: gỡ gán log thì gỡ luôn lần chia", async () => {
    await ingestLog(env.DB, log({ id: "S11", direction: "in", amount: 5_000_000, content: "LUONG THANG 9" }), "webhook", now());
    const income = raw.prepare("SELECT id FROM transactions WHERE log_id = 'S11' AND meaning = 'income'").get() as { id: number };
    await unassignTransaction(env.DB, income.id);
    expect(count("SELECT COUNT(*) n FROM transactions WHERE status = 'active'")).toBe(0);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'S11'").get()).toEqual({ status: "pending" });
    expect(count("SELECT COUNT(*) n FROM v_wallet_balance WHERE balance <> 0")).toBe(0);
  });
});

describe("ba cách một đồng tiền bị đếm hai lần (red team, số của họ)", () => {
  it("webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → chia đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng", async () => {
    await ingestLog(env.DB, log({ id: "wh-77", direction: "in", amount: 40_000_000, content: "LUONG THANG 9", referenceNumber: null }), "webhook", now());
    await ingestLog(
      env.DB,
      log({ id: "api-9f3c", direction: "in", amount: 40_000_000, content: "LUONG THANG 9", referenceNumber: "FT26092212345678", at: "2026-09-22T02:00:40.000Z" }),
      "backfill",
      new Date("2026-09-22T19:00:00.000Z"),
    );
    expect(count("SELECT COUNT(*) n FROM allocation_runs")).toBe(1);
    expect(count("SELECT SUM(amount) n FROM transactions WHERE meaning = 'fund' AND status = 'active'")).toBe(40_000_000);
    expect(balance("wealth-building")).toBe(12_000_000);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'api-9f3c'").get()).toEqual({ status: "pending" });
    const pending = await listPendingLogs(env.DB, 50);
    expect(pending.find((l) => l.id === "api-9f3c")?.suggestion).toMatchObject({ possible_duplicate_of: "wh-77" });
  });

  it("một giao dịch THẬT khác, cùng số tiền, trong 3 phút, chỉ có ở rà soát đêm → không bị mất", async () => {
    await ingestLog(env.DB, log({ id: "wh-X", amount: 500_000, content: "khong khop", referenceNumber: null }), "webhook", now());
    const y = await ingestLog(
      env.DB,
      log({ id: "api-Y", amount: 500_000, content: "khoan khac", referenceNumber: "FT999999", at: "2026-09-22T02:02:00.000Z" }),
      "backfill",
      new Date("2026-09-22T19:00:00.000Z"),
    );
    expect(y.created).toBe(true);
    expect(count("SELECT COUNT(*) n FROM bank_logs")).toBe(2);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'api-Y'").get()).toEqual({ status: "pending" });
  });

  it("hai webhook khác id, giống hệt nhau, đều không có mã → vẫn là hai giao dịch thật", async () => {
    await ingestLog(env.DB, log({ id: "c1", amount: 35_000, content: "CA PHE" }), "webhook", now());
    await ingestLog(env.DB, log({ id: "c2", amount: 35_000, content: "CA PHE", at: "2026-09-22T02:01:00.000Z" }), "webhook", now());
    expect(count("SELECT COUNT(*) n FROM bank_logs")).toBe(2);
  });

  it("đếm số dư tài khoản có bank feed khi còn log chưa gán → từ chối (không sinh bút toán điều chỉnh)", async () => {
    await ingestLog(env.DB, log({ id: "q1", amount: 300_000, content: "khong khop" }), "webhook", now());
    await expect(countAccount(env.DB, "vcb-husband", 700_000, "husband", now())).rejects.toMatchObject({ code: "pending_logs" });
    expect(count("SELECT COUNT(*) n FROM transactions WHERE meaning = 'adjust'")).toBe(0);
  });

  it("nhập tay khoản chi bằng tài khoản đã nối feed → từ chối, hướng sang màn Gán", async () => {
    await expect(
      createEntry(env.DB, { meaning: "spend", amount: 150_000, category_id: "eating-out", account_id: "vcb-husband" }, "husband", now()),
    ).rejects.toMatchObject({ code: "fed_account" });
    // tiền mặt vẫn nhập tay bình thường
    const cash = await createEntry(env.DB, { meaning: "spend", amount: 150_000, category_id: "eating-out" }, "husband", now());
    expect(cash.tx).toMatchObject({ account_id: "cash-husband" });
  });
});

describe("D14 theo chiều tiền (ADR-66): MB nối SePay, chỉ báo tiền vào", () => {
  beforeEach(() => {
    raw.prepare("UPDATE accounts SET sepay_out = 0 WHERE id = 'mb-husband'").run();
  });

  it("nhập tay khoản chi trả bằng MB được — SePay không báo tiền ra nên không đếm hai lần", async () => {
    const { tx } = await createEntry(env.DB, { meaning: "spend", amount: 150_000, category_id: "eating-out", account_id: "mb-husband" }, "husband", now());
    expect(tx).toMatchObject({ meaning: "spend", account_id: "mb-husband", source: "manual" });
  });

  it("nhập tay tiền vào MB (thu nhập, hoàn tiền, chuyển vào) → từ chối fed_account", async () => {
    await expect(createEntry(env.DB, { meaning: "income", amount: 1_000_000, account_id: "mb-husband" }, "husband", now())).rejects.toMatchObject({ code: "fed_account" });
    await expect(createEntry(env.DB, { meaning: "refund", amount: 50_000, wallet_id: "food", account_id: "mb-husband" }, "husband", now())).rejects.toMatchObject({ code: "fed_account" });
    await expect(
      createEntry(env.DB, { meaning: "transfer", amount: 50_000, account_id: "cash-husband", to_account_id: "mb-husband" }, "husband", now()),
    ).rejects.toMatchObject({ code: "fed_account" });
  });

  it("chủ nhà bật 'SePay báo cả tiền ra' (sepay_out = 1) → khoản chi trả bằng MB bị từ chối fed_account", async () => {
    raw.prepare("UPDATE accounts SET sepay_out = 1 WHERE id = 'mb-husband'").run();
    await expect(
      createEntry(env.DB, { meaning: "spend", amount: 150_000, category_id: "eating-out", account_id: "mb-husband" }, "husband", now()),
    ).rejects.toMatchObject({ code: "fed_account" });
  });
});

describe("rà lại các bản sửa (reviewer cuối)", () => {
  it("gỡ gán chân đầu của lệnh chuyển trước khi chân sau về → chân sau ghép lại cả hai, không log nào mồ côi", async () => {
    raw.prepare("INSERT INTO transfer_orders (id, batch_id, from_account_id, to_account_id, amount, memo) VALUES (31, 'A7', 'vcb-husband', 'tcb-husband', 900000, 'PF ZZ0001')").run();
    await ingestLog(env.DB, log({ id: "L1", direction: "out", amount: 900_000, content: "PF ZZ0001" }), "webhook", now());
    const first = (raw.prepare("SELECT id FROM transactions WHERE log_id = 'L1'").get() as { id: number }).id;
    await unassignTransaction(env.DB, first);
    await ingestLog(env.DB, log({ id: "L2", direction: "in", accountNo: "1903xxxxxxx", amount: 900_000, content: "PF ZZ0001", at: "2026-09-22T02:05:00.000Z" }), "webhook", now());
    expect(raw.prepare("SELECT log_id, log_id_2 FROM transactions WHERE status = 'active'").all()).toEqual([{ log_id: "L1", log_id_2: "L2" }]);
    expect(count("SELECT COUNT(*) n FROM bank_logs WHERE status = 'pending'")).toBe(0);
  });

  it("người kia bấm 'Đã chuyển' đúng lúc đang gỡ lần chia → huỷ bị từ chối, sổ giữ nguyên", async () => {
    raw.prepare("UPDATE accounts SET sepay_enabled = 0 WHERE id = 'vcb-wife'").run();
    const { tx } = await createEntry(env.DB, { meaning: "income", amount: 10_000_000, account_id: "vcb-wife", at: "2026-09-10T09:00:00+07:00" }, "wife", now());
    const incomeId = Number(tx!.id);
    const { allocateIncome, undoAllocationStatements } = await import("../src/services/ledger");
    await allocateIncome(env.DB, incomeId);
    // Bước đọc của lần gỡ thấy chưa có lệnh nào 'done'…
    const undo = await undoAllocationStatements(env.DB, incomeId);
    expect(undo.length).toBeGreaterThan(0);
    // …thì request khác đánh dấu một lệnh đã chuyển, trước khi lần gỡ kịp ghi.
    const order = raw.prepare("SELECT id FROM transfer_orders LIMIT 1").get() as { id: number };
    await setTransferOrderStatus(env.DB, order.id, "done");
    const { runUndo } = await import("../src/services/ledger");
    await expect(runUndo(env.DB, undo)).rejects.toMatchObject({ code: "allocation_settled" });
    expect(count("SELECT SUM(amount) n FROM transactions WHERE meaning = 'fund' AND status = 'active'")).toBe(10_000_000);
    await expect(voidTransaction(env.DB, incomeId)).rejects.toMatchObject({ code: "allocation_settled" });
  });

  it("lương đã ghi nhưng bước chia lỗi → không im lặng: ghi lại để tin sáng báo, webhook không bị gửi lại vô ích", async () => {
    raw.prepare("UPDATE allocations SET active = 0 WHERE mode = 'remainder'").run(); // cấu hình hỏng: chia sẽ lỗi
    const res = await ingestLog(env.DB, log({ id: "W1", direction: "in", amount: 30_000_000, content: "LUONG THANG 9" }), "webhook", now());
    expect(res.created).toBe(true);
    expect(count("SELECT COUNT(*) n FROM transactions WHERE meaning = 'income'")).toBe(1);
    expect(count("SELECT COUNT(*) n FROM allocation_runs")).toBe(0);
    const rec = raw.prepare("SELECT payload FROM notifications WHERE kind = 'ingest_error'").get() as { payload: string };
    expect(JSON.parse(rec.payload).message).toMatch(/xử lý tiếp bị lỗi/);
  });

  it("salary_min_amount = 0 thì bỏ ngưỡng", async () => {
    const { salaryMinAmount } = await import("../src/services/ledger");
    raw.prepare("INSERT INTO config (k, v) VALUES ('salary_min_amount', '0')").run();
    expect(await salaryMinAmount(env.DB)).toBe(0);
  });
});

describe("nội dung nhiều khoảng trắng", () => {
  it("rule từ khoá vẫn khớp khi ngân hàng chèn nhiều khoảng trắng / tab", async () => {
    // Rule nhiều từ (một khoảng trắng giữa các từ); nội dung thật có hai khoảng trắng và một tab.
    raw.prepare("UPDATE rules SET pattern = 'THANH TOAN DO XANG' WHERE match_type = 'content' AND pattern = 'XANG'").run();
    expect(raw.prepare("SELECT COUNT(*) n FROM rules WHERE pattern = 'THANH TOAN DO XANG'").get()).toEqual({ n: 1 });
    await ingestLog(env.DB, log({ id: "X1", amount: 60_000, content: "thanh  toan do\txang Petrolimex" }), "webhook", now());
    expect(raw.prepare("SELECT category_id FROM transactions WHERE log_id = 'X1'").get()).toEqual({ category_id: "fuel-parking" });
  });
});
