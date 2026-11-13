// Một giao dịch ngân hàng không bao giờ vào sổ hai lần — kể cả khi các request chạy chen nhau.
// D1 tuần tự hoá từng batch, nên "chạy chen" ở đây là: hai request cùng đọc trạng thái cũ rồi lần lượt ghi.
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { assignLog, ingestLog, listPendingLogs, pairLogs, unassignTransaction, type ParsedBankLog } from "../src/services/ingest";
import { countAccount, createEntry, replaceTransaction } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { openLegacyDb } from "./helpers/legacy";

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
/** Số dư sổ của tài khoản (không ví từ v2, ADR-123). */
const book = (accountId: string) => (raw.prepare("SELECT book_balance FROM v_account_book WHERE account_id = ?").get(accountId) as { book_balance: number }).book_balance;

describe("webhook và cron vá đêm cùng một giao dịch", () => {
  it("khác id nhưng cùng mã tham chiếu trong cùng tài khoản → một log, một giao dịch", async () => {
    await ingestLog(env.DB, log({ id: "webhook-9", content: "an trua EAN", refCode: "EAN", referenceNumber: "FT26265001" }), "webhook", now());
    const again = await ingestLog(env.DB, log({ id: "api-uuid-9", content: "an trua EAN", refCode: "EAN", referenceNumber: "FT26265001" }), "backfill", now());
    expect(again.created).toBe(false);
    expect(count("SELECT COUNT(*) n FROM bank_logs")).toBe(1);
    expect(count("SELECT COUNT(*) n FROM transactions WHERE meaning = 'spend'")).toBe(1);
    expect(book("vcb-husband")).toBe(-100_000);
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
    await assignLog(env.DB, "P2", [{ meaning: "refund", amount: 5_000_000 }], "husband", now());
    raw.prepare("UPDATE bank_logs SET status = 'pending' WHERE id = 'P2'").run(); // request kia đọc trạng thái cũ
    raw.prepare("UPDATE bank_logs SET status = 'assigned' WHERE id = 'P2'").run(); // …rồi request này ghi xong trước
    await expect(pairLogs(env.DB, "P1", "P2", "husband")).rejects.toMatchObject({ code: "not_pending" });
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
    const res = await unassignTransaction(env.DB, firstTx, "husband");
    expect(res.voided).toHaveLength(2);
    expect(count("SELECT COUNT(*) n FROM transactions WHERE log_id = 'S1' AND status = 'active'")).toBe(0);
    expect(book("vcb-husband")).toBe(0);

    await assignLog(env.DB, "S1", [{ meaning: "spend", amount: 500_000, category_id: "groceries" }], "husband", now());
    expect(book("vcb-husband")).toBe(-500_000);
  });
});

describe("lương giả", () => {
  it("người ngoài chuyển 1.000 ₫ nội dung 'LUONG THANG' → không tự ghi thu nhập, không tự chia; nằm chờ để hỏi", async () => {
    await ingestLog(env.DB, log({ id: "F1", direction: "in", amount: 1_000, content: "LUONG THANG 9" }), "webhook", now());
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'F1'").get()).toEqual({ status: "pending" });
    expect(count("SELECT COUNT(*) n FROM transactions")).toBe(0);
  });

  it("UC-303 AC-10: lương thật (đủ ngưỡng) tự ghi khoản thu là lương, kèm một nhắc ① (ingestLog trả salaryTxId); ngưỡng chỉnh được trong config", async () => {
    const res = await ingestLog(env.DB, log({ id: "S9", direction: "in", amount: 30_000_000, content: "LUONG THANG 9" }), "webhook", now());
    const income = raw.prepare("SELECT id, is_salary FROM transactions WHERE meaning = 'income'").all() as { id: number; is_salary: number }[];
    expect(income).toHaveLength(1);
    expect(res.salaryTxId).toBe(income[0]!.id);
    expect(income[0]!.is_salary).toBe(1);
    expect(count("SELECT COUNT(*) n FROM month_tasks WHERE kind = 'savings' AND status = 'open'")).toBe(1);

    raw.prepare("INSERT INTO config (k, v) VALUES ('salary_min_amount', '50000000')").run();
    await ingestLog(env.DB, log({ id: "S10", direction: "in", amount: 30_000_000, content: "LUONG THANG 10", at: "2026-09-22T05:00:00.000Z" }), "webhook", now());
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'S10'").get()).toEqual({ status: "pending" });
  });

  it("UC-306 AC-7: lương giả lọt qua (đủ ngưỡng) vẫn gỡ được: gỡ gán log thì khoản thu void, nhắc ① của nó void", async () => {
    await ingestLog(env.DB, log({ id: "S11", direction: "in", amount: 5_000_000, content: "LUONG THANG 9" }), "webhook", now());
    const income = raw.prepare("SELECT id FROM transactions WHERE log_id = 'S11' AND meaning = 'income'").get() as { id: number };
    expect(count("SELECT COUNT(*) n FROM month_tasks WHERE status <> 'void'")).toBe(1);
    await unassignTransaction(env.DB, income.id, "husband");
    expect(count("SELECT COUNT(*) n FROM transactions WHERE status = 'active'")).toBe(0);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'S11'").get()).toEqual({ status: "pending" });
    expect(count("SELECT COUNT(*) n FROM month_tasks WHERE status <> 'void'")).toBe(0);
  });
});

describe("ba cách một đồng tiền bị đếm hai lần (red team, số của họ)", () => {
  it("webhook không có mã tham chiếu, rà soát đêm mang lại cùng giao dịch với id khác và có mã → ghi đúng một lần; log thứ hai chờ gán, đánh dấu có thể trùng", async () => {
    await ingestLog(env.DB, log({ id: "wh-77", direction: "in", amount: 40_000_000, content: "LUONG THANG 9", referenceNumber: null }), "webhook", now());
    await ingestLog(
      env.DB,
      log({ id: "api-9f3c", direction: "in", amount: 40_000_000, content: "LUONG THANG 9", referenceNumber: "FT26092212345678", at: "2026-09-22T02:00:40.000Z" }),
      "backfill",
      new Date("2026-09-22T19:00:00.000Z"),
    );
    expect(count("SELECT COUNT(*) n FROM transactions WHERE meaning = 'income' AND status = 'active'")).toBe(1);
    expect(count("SELECT COUNT(*) n FROM month_tasks")).toBe(1);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'api-9f3c'").get()).toEqual({ status: "pending" });
    const pending = await listPendingLogs(env.DB, 50, "husband");
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
    await expect(createEntry(env.DB, { meaning: "refund", amount: 50_000, account_id: "mb-husband" }, "husband", now())).rejects.toMatchObject({ code: "fed_account" });
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

describe("mốc theo dõi SePay: khoản trước mốc nhập tay được (ADR-113)", () => {
  // MB nối SePay sau: mở sổ 1/10, theo dõi từ 22:24 ngày 15/10 giờ VN.
  beforeEach(() => {
    raw.prepare("UPDATE accounts SET sepay_out = 0, opened_at = '2026-10-01', feed_from = '2026-10-15T15:24:00.000Z' WHERE id = 'mb-husband'").run();
  });
  const today = new Date("2026-10-17T03:00:00.000Z");
  const income = (at: string) => createEntry(env.DB, { meaning: "income", amount: 1_500_000, account_id: "mb-husband", at }, "husband", today);

  it("UC-506 AC-26: khoản tiền vào ngày 12/10 (trước mốc 15/10) nhập tay → ghi được; ngày 16/10 → fed_account", async () => {
    const { tx } = await income("2026-10-12T10:00:00+07:00");
    expect(tx).toMatchObject({ meaning: "income", counter_account_id: "mb-husband", source: "manual" });
    await expect(income("2026-10-16T10:00:00+07:00")).rejects.toMatchObject({ code: "fed_account" });
    // Ngay trước mốc một giây vẫn ghi được; đúng mốc thì đã là phần SePay báo về.
    expect((await income("2026-10-15T15:23:59.000Z")).tx).toMatchObject({ counter_account_id: "mb-husband" });
    await expect(income("2026-10-15T15:24:00.000Z")).rejects.toMatchObject({ code: "fed_account" });
  });

  it("UC-506 AC-26: sửa khoản trước mốc mà vẫn trước mốc → được; dời sang sau mốc → fed_account", async () => {
    const { tx } = await income("2026-10-12T10:00:00+07:00");
    const id = Number(tx!.id);
    const moved = await replaceTransaction(env.DB, id, { meaning: "income", amount: 1_400_000, account_id: "mb-husband", at: "2026-10-13T10:00:00+07:00" }, "husband", today);
    expect(moved.tx).toMatchObject({ amount: 1_400_000, counter_account_id: "mb-husband" });
    const movedId = "id" in moved.tx ? Number(moved.tx.id) : NaN;
    await expect(
      replaceTransaction(env.DB, movedId, { meaning: "income", amount: 1_400_000, account_id: "mb-husband", at: "2026-10-16T10:00:00+07:00" }, "husband", today),
    ).rejects.toMatchObject({ code: "fed_account" });
  });

  const webhookIn = (id: string, at: string, amount = 1_500_000) =>
    ingestLog(env.DB, log({ id, at, amount, direction: "in", accountNo: "0888xxxxxxx" }), "webhook", today);

  it("UC-101 AC-26: log trước mốc đang chờ 1.500.000 → nhập tay đúng khoản đó → log nối vào khoản tay, màn Gán trống", async () => {
    await webhookIn("tre", "2026-10-15T15:20:00.000Z");
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'tre'").get()).toEqual({ status: "pending" });
    const r = await income("2026-10-15T22:21:00+07:00");
    expect(r.linkedLogs).toEqual(["tre"]);
    expect(raw.prepare("SELECT log_id, source FROM transactions WHERE id = ?").get(Number(r.tx!.id))).toEqual({ log_id: "tre", source: "manual" });
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'tre'").get()).toEqual({ status: "assigned" });
    expect(await listPendingLogs(env.DB, 50, "husband")).toEqual([]);
  });

  it("UC-101 AC-26: log trước mốc đã gán → nhập tay khoản đó → 409 bank_log_exists, không ghi; gửi lại confirm_duplicate → ghi", async () => {
    await webhookIn("tre", "2026-10-15T15:20:00.000Z");
    await assignLog(env.DB, "tre", [{ meaning: "income", amount: 1_500_000 }], "husband", today);
    const before = count("SELECT COUNT(*) n FROM transactions WHERE status = 'active'");
    await expect(income("2026-10-15T22:20:00+07:00")).rejects.toMatchObject({
      code: "bank_log_exists",
      status: 409,
      message: "SePay đã báo khoản này và có trong sổ, ghi nữa là hai lần.",
    });
    expect(count("SELECT COUNT(*) n FROM transactions WHERE status = 'active'")).toBe(before);
    const again = await createEntry(env.DB, { meaning: "income", amount: 1_500_000, account_id: "mb-husband", at: "2026-10-15T22:20:00+07:00", confirm_duplicate: true }, "husband", today);
    expect(again).toMatchObject({ duplicate: false, linkedLogs: [] });
    expect(count("SELECT COUNT(*) n FROM transactions WHERE status = 'active'")).toBe(before + 1);
  });

  it("UC-101 AC-26: sửa khoản tay trước mốc thành đúng số tiền / ngày của log trước mốc đang chờ → khoản mới nối log", async () => {
    const { tx } = await income("2026-10-12T10:00:00+07:00");
    await webhookIn("tre-13", "2026-10-13T03:00:00.000Z", 1_400_000);
    const moved = await replaceTransaction(env.DB, Number(tx!.id), { meaning: "income", amount: 1_400_000, account_id: "mb-husband", at: "2026-10-13T10:00:00+07:00" }, "husband", today);
    expect(moved.linkedLogs).toEqual(["tre-13"]);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'tre-13'").get()).toEqual({ status: "assigned" });
  });
});

describe("rà lại các bản sửa (reviewer cuối)", () => {
  it("gỡ gán chân đầu trước khi chân sau về → chân sau ghép lại cả hai, không log nào mồ côi", async () => {
    await ingestLog(env.DB, log({ id: "L1", direction: "out", amount: 900_000, content: "chuyen tiet kiem" }), "webhook", now());
    await assignLog(env.DB, "L1", [{ meaning: "transfer", amount: 900_000, other_account_id: "tcb-husband" }], "husband", now());
    const first = (raw.prepare("SELECT id FROM transactions WHERE log_id = 'L1'").get() as { id: number }).id;
    await unassignTransaction(env.DB, first, "husband");
    await ingestLog(env.DB, log({ id: "L2", direction: "in", accountNo: "1903xxxxxxx", amount: 900_000, content: "chuyen tiet kiem", at: "2026-09-22T02:05:00.000Z" }), "webhook", now());
    expect(raw.prepare("SELECT log_id, log_id_2 FROM transactions WHERE status = 'active'").all()).toEqual([{ log_id: "L1", log_id_2: "L2" }]);
    expect(count("SELECT COUNT(*) n FROM bank_logs WHERE status = 'pending'")).toBe(0);
  });

  it("UC-306 AC-7: gỡ log lương cũ đã chia (lô có lệnh đã chuyển, trước 0040) → khoản thu và mọi fund cùng lô void, log về chờ", async () => {
    const db = openLegacyDb((d) =>
      d.exec(`
        UPDATE accounts SET opened_at = NULL;
        INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES ('LS', '2026-10-10T01:00:00.000Z', 10000000, 'in', 'vcb-anh', 'pending');
        INSERT INTO transactions (id, log_id, at, amount, meaning, wallet_id, counter_account_id, week_key, month_key, source)
          VALUES (900, 'LS', '2026-10-10T01:00:00.000Z', 10000000, 'income', 'thu-nhap', 'vcb-anh', '2026-W41', '2026-10', 'sepay');
        UPDATE bank_logs SET status = 'assigned' WHERE id = 'LS';
        INSERT INTO allocation_runs (income_tx_id, batch_id) VALUES (900, 'A900');
        INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, link_id, batch_id, week_key, month_key, source) VALUES
          ('2026-10-10T01:00:00.000Z', 3000000, 'fund', 'tich-san', 'thu-nhap', 900, 'A900', '2026-W41', '2026-10', 'system'),
          ('2026-10-10T01:00:00.000Z', 7000000, 'fund', 'co-thi-tot', 'thu-nhap', 900, 'A900', '2026-W41', '2026-10', 'system');
        INSERT INTO transfer_orders (batch_id, from_account_id, to_account_id, amount, memo, status) VALUES ('A900', 'vcb-anh', 'tcb-anh', 3000000, 'PF AAAAAA', 'done');
      `),
    );
    const res = await unassignTransaction(asD1(db), 900, "husband");
    expect(res).toEqual({ voided: [900], logs: ["LS"] });
    expect(db.prepare("SELECT meaning, status FROM transactions ORDER BY id").all()).toEqual([
      { meaning: "income", status: "void" },
      { meaning: "fund", status: "void" },
      { meaning: "fund", status: "void" },
    ]);
    expect(db.prepare("SELECT status FROM bank_logs WHERE id = 'LS'").get()).toEqual({ status: "pending" });
  });

  it("lương về nhưng ghi nhắc ① lỗi → không im lặng: không ghi gì, log còn chờ, ghi lại để tin sáng báo", async () => {
    raw.exec("CREATE TRIGGER boom BEFORE INSERT ON month_tasks BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const res = await ingestLog(env.DB, log({ id: "W1", direction: "in", amount: 30_000_000, content: "LUONG THANG 9" }), "webhook", now());
    expect(res.created).toBe(true);
    expect(count("SELECT COUNT(*) n FROM transactions")).toBe(0);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'W1'").get()).toEqual({ status: "pending" });
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
