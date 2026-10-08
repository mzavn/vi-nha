// Test tầng dịch vụ (services/ingest.ts) với thời điểm điều khiển được — dùng cho các kịch bản cần chính xác
// về thời gian (ghép cặp 10 phút, đối soát, chống trùng) mà test HTTP (webhooks.test.ts) không tiện kiểm.
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { assignLog, createRule, ignoreLog, ingestLog, listPendingLogs, pairLogs, unassignTransaction, type ParsedBankLog } from "../src/services/ingest";
import { allocateIncome } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  raw = openDb();
  // Bối cảnh: các tài khoản nối feed trong seed báo cả tiền ra (ADR-66) — log `out` tự gán theo rule như trước.
  raw.prepare("UPDATE accounts SET sepay_out = 1 WHERE sepay_enabled = 1").run();
  env = { DB: asD1(raw) } as Env;
});

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

const now = () => new Date("2026-09-22T02:00:05.000Z");

const bankLog = (id: string) => raw.prepare("SELECT * FROM bank_logs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
const txOf = (logId: string) => raw.prepare("SELECT * FROM transactions WHERE log_id = ?").all(logId) as Record<string, unknown>[];

describe("ingestLog: chống trùng", () => {
  it("gửi lại cùng id chỉ tạo một log", async () => {
    const first = await ingestLog(env.DB, log({ id: "111" }), "webhook", now());
    const second = await ingestLog(env.DB, log({ id: "111" }), "webhook", now());
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs").get()).toEqual({ n: 1 });
  });

  it("id khác nhau nhưng cùng (account_id, reference_number) vẫn coi là một log", async () => {
    await ingestLog(env.DB, log({ id: "111", referenceNumber: "FT001" }), "webhook", now());
    const second = await ingestLog(env.DB, log({ id: "222", referenceNumber: "FT001" }), "backfill", now());
    expect(second.created).toBe(false);
    expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs").get()).toEqual({ n: 1 });
  });

  it("tài khoản lạ vẫn lưu log, account_id NULL, trạng thái pending", async () => {
    await ingestLog(env.DB, log({ id: "999", accountNo: "khong-ton-tai" }), "webhook", now());
    expect(bankLog("999")).toMatchObject({ account_id: null, status: "pending" });
  });
});

describe("ingestLog: rule mã / từ khoá", () => {
  it("mã EAN → spend vào ví food, danh mục groceries", async () => {
    await ingestLog(env.DB, log({ id: "1", refCode: "EAN", content: "CT DEN 1234 EAN AN TRUA" }), "webhook", now());
    const tx = txOf("1");
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ meaning: "spend", counter_wallet_id: "food", category_id: "groceries", account_id: "vcb-husband" });
    expect(bankLog("1")).toMatchObject({ status: "assigned" });
  });

  it("từ khoá trên nội dung có dấu (đổ xăng) → nhận diện như mã EXE", async () => {
    await ingestLog(env.DB, log({ id: "2", content: "chuyen tien đổ xăng buổi sáng" }), "webhook", now());
    const tx = txOf("2");
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ meaning: "spend", counter_wallet_id: "transport", category_id: "fuel-parking" });
  });

  it("khớp mã nhưng SePay đã đưa sẵn code khác vẫn ưu tiên ref_code đã lưu, không suy luận lại", async () => {
    await ingestLog(env.DB, log({ id: "3", refCode: "EMS", content: "SHOPEE don hang", accountNo: "0011xxxxxxx" }), "webhook", now());
    const tx = txOf("3");
    expect(tx[0]).toMatchObject({ counter_wallet_id: "fun-husband", category_id: "shopping" });
  });
});

describe("ingestLog: rule lương — chia đúng một lần dù webhook gửi lại", () => {
  const salary = (id: string) => log({ id, direction: "in", amount: 40_000_000, content: "LUONG THANG 9", accountNo: "0011xxxxxxx" });

  it("tạo income taxable=0 rồi chia ngay; gửi lại cùng id không chia lần hai", async () => {
    await ingestLog(env.DB, salary("500"), "webhook", now());
    const income = txOf("500");
    expect(income).toHaveLength(1);
    expect(income[0]).toMatchObject({ meaning: "income", taxable: 0, wallet_id: "income", counter_account_id: "vcb-husband" });
    expect(raw.prepare("SELECT COUNT(*) n FROM allocation_runs").get()).toEqual({ n: 1 });
    expect(raw.prepare("SELECT SUM(amount) s FROM transactions WHERE meaning = 'fund'").get()).toEqual({ s: 40_000_000 });

    await ingestLog(env.DB, salary("500"), "webhook", now()); // SePay gửi lại (retry Fibonacci)
    expect(raw.prepare("SELECT COUNT(*) n FROM allocation_runs").get()).toEqual({ n: 1 });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning = 'income'").get()).toEqual({ n: 1 });
  });
});

describe("tài khoản SePay chỉ báo tiền vào (sepay_out = 0, ADR-66)", () => {
  const NOTE = "SePay vừa báo tiền ra cho tài khoản đang để 'chỉ tiền vào'. Nếu khoản này đã nhập tay thì Bỏ qua; rồi bật 'SePay báo cả tiền ra' ở Cài đặt.";
  const mb = (over: Partial<ParsedBankLog>) => log({ accountNo: "0888xxxxxxx", ...over }); // mb-husband
  beforeEach(() => {
    raw.prepare("UPDATE accounts SET sepay_out = 0 WHERE id = 'mb-husband'").run();
  });

  it("log tiền ra khớp rule chi → không tự gán, giữ pending; màn Gán gợi ý theo rule kèm lời nhắc có thể đã nhập tay", async () => {
    await ingestLog(env.DB, mb({ id: "g1", refCode: "EAN", content: "CT DEN 1234 EAN AN TRUA" }), "webhook", now());
    expect(txOf("g1")).toHaveLength(0);
    expect(bankLog("g1")).toMatchObject({ status: "pending" });
    const pending = await listPendingLogs(env.DB, 50);
    expect(pending.find((l) => l.id === "g1")?.suggestion).toEqual({ meaning: "spend", wallet_id: "food", category_id: "groceries", note: NOTE });
  });

  it("log tiền ra không khớp gì → không gợi ý loại, chỉ còn lời nhắc; nội dung rút ATM thì gợi ý Rút tiền mặt kèm lời nhắc", async () => {
    await ingestLog(env.DB, mb({ id: "g2", content: "khong khop" }), "webhook", now());
    await ingestLog(env.DB, mb({ id: "g2-atm", amount: 500_000, content: "RUT TIEN TAI ATM MB" }), "webhook", now());
    const pending = await listPendingLogs(env.DB, 50);
    expect(pending.find((l) => l.id === "g2")?.suggestion).toEqual({ note: NOTE });
    expect(pending.find((l) => l.id === "g2-atm")?.suggestion).toEqual({ meaning: "transfer", other_account_id: "cash-husband", label: "Rút tiền mặt", note: NOTE });
  });

  it("log tiền vào vẫn tự khớp rule lương như trước", async () => {
    await ingestLog(env.DB, mb({ id: "g3", direction: "in", amount: 40_000_000, content: "LUONG THANG 9" }), "webhook", now());
    expect(txOf("g3")[0]).toMatchObject({ meaning: "income", counter_account_id: "mb-husband" });
    expect(bankLog("g3")).toMatchObject({ status: "assigned" });
  });

  it("chuyển nội bộ từ tài khoản chỉ-tiền-vào vẫn ghép cặp với chân tiền vào", async () => {
    await ingestLog(env.DB, mb({ id: "g4", amount: 2_000_000, at: "2026-09-22T02:00:00.000Z" }), "webhook", now());
    await ingestLog(env.DB, log({ id: "g5", direction: "in", amount: 2_000_000, accountNo: "0011xxxxxxx", at: "2026-09-22T02:04:00.000Z" }), "webhook", now());
    expect(txOf("g4")[0]).toMatchObject({ meaning: "transfer", account_id: "mb-husband", counter_account_id: "vcb-husband", log_id_2: "g5" });
    expect(bankLog("g4")).toMatchObject({ status: "assigned" });
  });
});

describe("ingestLog: khớp lệnh chuyển tiền qua nội dung 'PF <mã lệnh>'", () => {
  beforeEach(() => {
    raw
      .prepare("INSERT INTO transfer_orders (batch_id, from_account_id, to_account_id, amount, memo, status) VALUES ('A999','vcb-husband','tcb-husband',1200000,'PF K7Q3F2','pending')")
      .run();
  });

  it("chân đầu tiên về khớp ngay: lệnh chuyển thành done, sinh transfer đúng account", async () => {
    await ingestLog(env.DB, log({ id: "L1", direction: "out", amount: 1_200_000, content: "PF K7Q3F2 chia luong", accountNo: "0011xxxxxxx" }), "webhook", now());
    expect(raw.prepare("SELECT status, matched_log_id FROM transfer_orders WHERE batch_id = 'A999'").get()).toEqual({ status: "done", matched_log_id: "L1" });
    const tx = txOf("L1");
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ meaning: "transfer", account_id: "vcb-husband", counter_account_id: "tcb-husband", batch_id: "A999", log_id_2: null });
  });

  it("chân thứ hai về sau: gắn log_id_2 vào ĐÚNG giao dịch đã tạo, không sinh giao dịch mới", async () => {
    await ingestLog(env.DB, log({ id: "L1", direction: "out", amount: 1_200_000, content: "PF K7Q3F2", accountNo: "0011xxxxxxx" }), "webhook", now());
    await ingestLog(env.DB, log({ id: "L2", direction: "in", amount: 1_200_000, content: "PF K7Q3F2", accountNo: "1903xxxxxxx" }), "webhook", now());
    const all = raw.prepare("SELECT * FROM transactions WHERE batch_id = 'A999'").all() as Record<string, unknown>[];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ log_id: "L1", log_id_2: "L2" });
    expect(bankLog("L2")).toMatchObject({ status: "assigned" });
  });
});

describe("ingestLog: ghép cặp chuyển khoản nội bộ (4 tình huống)", () => {
  it("chuyển giữa 2 TK của cùng một người → 1 transfer, không sinh thu nhập", async () => {
    await ingestLog(env.DB, log({ id: "a", direction: "out", amount: 2_000_000, accountNo: "0011xxxxxxx", at: "2026-09-22T02:00:00.000Z" }), "webhook", now());
    await ingestLog(env.DB, log({ id: "b", direction: "in", amount: 2_000_000, accountNo: "1903xxxxxxx", at: "2026-09-22T02:05:00.000Z" }), "webhook", now());
    const tx = raw.prepare("SELECT * FROM transactions").all() as Record<string, unknown>[];
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ meaning: "transfer", account_id: "vcb-husband", counter_account_id: "tcb-husband" });
    expect(bankLog("a")).toMatchObject({ status: "assigned" });
    expect(bankLog("b")).toMatchObject({ status: "assigned" });
  });

  it("vợ chuyển cho chồng → ghép thành transfer giữa 2 TK của hộ", async () => {
    await ingestLog(env.DB, log({ id: "a", direction: "out", amount: 500_000, accountNo: "0011yyyyyyy", at: "2026-09-22T02:00:00.000Z" }), "webhook", now());
    await ingestLog(env.DB, log({ id: "b", direction: "in", amount: 500_000, accountNo: "0011xxxxxxx", at: "2026-09-22T02:03:00.000Z" }), "webhook", now());
    const tx = raw.prepare("SELECT * FROM transactions").all() as Record<string, unknown>[];
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ meaning: "transfer", account_id: "vcb-wife", counter_account_id: "vcb-husband" });
  });

  it("khách chuyển tiền thật (không có chân ra đối ứng) → vẫn pending, không tự đoán thu nhập", async () => {
    await ingestLog(env.DB, log({ id: "c", direction: "in", amount: 777_000, accountNo: "0011xxxxxxx", content: "khach thanh toan don hang" }), "webhook", now());
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
    expect(bankLog("c")).toMatchObject({ status: "pending" });
  });

  it("trùng số tiền ngẫu nhiên giữa hai người không liên quan → vẫn bị ghép nhầm (rủi ro đã biết), gỡ được bằng huỷ", async () => {
    // Chồng trả quán 300k đúng lúc vợ nhận 300k từ khách — thuật toán ghép theo account+amount+thời gian nên
    // không phân biệt được với một chuyển khoản nội bộ thật. Giảm thiểu: tin sáng liệt kê + gỡ cặp tay (void).
    await ingestLog(env.DB, log({ id: "x", direction: "out", amount: 300_000, accountNo: "0011xxxxxxx", content: "tra quan an", at: "2026-09-22T02:00:00.000Z" }), "webhook", now());
    await ingestLog(env.DB, log({ id: "y", direction: "in", amount: 300_000, accountNo: "0011yyyyyyy", content: "khach tra tien hang", at: "2026-09-22T02:02:00.000Z" }), "webhook", now());
    const tx = raw.prepare("SELECT * FROM transactions").all() as Record<string, unknown>[];
    expect(tx).toHaveLength(1);
    expect(bankLog("x")).toMatchObject({ status: "assigned" });
    expect(bankLog("y")).toMatchObject({ status: "assigned" });

    const txId = tx[0]!.id as number;
    await unassignTransaction(env.DB, txId);
    expect(raw.prepare("SELECT status FROM transactions WHERE id = ?").get(txId)).toEqual({ status: "void" });
    expect(bankLog("x")).toMatchObject({ status: "pending" });
    expect(bankLog("y")).toMatchObject({ status: "pending" });
  });
});

describe("gợi ý Rút tiền mặt chỉ cho log `out` trông như rút tiền", () => {
  it("listPendingLogs gợi ý transfer sang ví tiền mặt của đúng chủ tài khoản", async () => {
    await ingestLog(env.DB, log({ id: "atm", direction: "out", amount: 2_000_000, accountNo: "0011xxxxxxx", content: "RUT TIEN TAI ATM MB" }), "webhook", now());
    const pending = await listPendingLogs(env.DB, 10);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.suggestion).toEqual({ meaning: "transfer", other_account_id: "cash-husband", label: "Rút tiền mặt" });
  });

  it("nhà chỉ có một ví tiền mặt chung (không gắn chủ) thì gợi ý rút tiền về ví chung đó", async () => {
    raw.prepare("UPDATE accounts SET owner_member_id = NULL WHERE id = 'cash-wife'").run();
    raw.prepare("UPDATE accounts SET active = 0 WHERE id = 'cash-husband'").run();
    await ingestLog(env.DB, log({ id: "atm2", direction: "out", amount: 500_000, accountNo: "0011xxxxxxx", content: "RUT TIEN TAI ATM MB" }), "webhook", now());
    const pending = await listPendingLogs(env.DB, 10);
    expect(pending[0]!.suggestion).toEqual({ meaning: "transfer", other_account_id: "cash-wife", label: "Rút tiền mặt" });
  });

  it("trả QR, hoá đơn, chuyển khoản không khớp rule → không gợi ý Rút tiền mặt (màn Gán mặc định Chi tiêu)", async () => {
    const contents = ["MBVCB.1234567.THANH TOAN QR.CT tu 0011xxxxxxx", "THANH TOAN HOA DON DIEN EVN", "CHUYEN TIEN CHO ANH BA", "khong khop gi ca"];
    for (const [i, content] of contents.entries()) {
      await ingestLog(env.DB, log({ id: `qr${i}`, direction: "out", amount: 85_000 + i, accountNo: "0011xxxxxxx", content }), "webhook", now());
    }
    const pending = await listPendingLogs(env.DB, 10);
    expect(pending.map((l) => l.suggestion)).toEqual([null, null, null, null]);
  });

  it("log tiền vào không khớp gì thì không gợi ý (luôn phải hỏi)", async () => {
    await ingestLog(env.DB, log({ id: "in1", direction: "in", amount: 10_000, accountNo: "0011xxxxxxx", content: "nguoi la chuyen tien" }), "webhook", now());
    const pending = await listPendingLogs(env.DB, 10);
    expect(pending[0]!.suggestion).toBeNull();
  });
});

describe("nguồn thu & người thuê (change 261001)", () => {
  const tenant = () => raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
  const walletBalance = (id: string) => (raw.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = ?").get(id) as { balance: number }).balance;

  it("rule lương mang income_stream_id → khoản thu tự ghi gắn nguồn, chia theo phần khóa của nguồn", async () => {
    raw.prepare("UPDATE rules SET income_stream_id = 'salary-wife' WHERE is_salary = 1").run();
    await ingestLog(env.DB, log({ id: "sal", direction: "in", amount: 11_000_000, content: "LUONG THANG 9" }), "webhook", now());
    expect(txOf("sal")[0]).toMatchObject({ meaning: "income", income_stream_id: "salary-wife" });
    expect(raw.prepare("SELECT amount FROM transactions WHERE meaning = 'fund' AND wallet_id = 'wealth-building'").get()).toEqual({ amount: 4_950_000 });
  });

  it("rule người thuê chỉ gợi ý 'Thu từ <tên>', không tự gán", async () => {
    tenant();
    await createRule(env.DB, { match_type: "content", pattern: "BINH CK", meaning: "income", tenant_id: "tenant-binh" });
    await ingestLog(env.DB, log({ id: "rent", direction: "in", amount: 5_191_667, content: "BINH CK TIEN NHA T10" }), "webhook", now());
    expect(bankLog("rent")?.status).toBe("pending");
    expect(txOf("rent")).toHaveLength(0);
    const [pending] = await listPendingLogs(env.DB, 10);
    expect(pending!.suggestion).toEqual({ meaning: "income", tenant_id: "tenant-binh", label: "Thu từ Anh Bình" });
  });

  it("rule người thuê chỉ dùng cho tiền vào", async () => {
    tenant();
    await expect(createRule(env.DB, { match_type: "content", pattern: "BINH", meaning: "spend", tenant_id: "tenant-binh" })).rejects.toMatchObject({
      code: "tenant_rule_income_only",
    });
  });

  it("gán log tiền vào cho người thuê → nguồn cho thuê mặc định, chia 100% vào Thu cho thuê, số dư người thuê giảm", async () => {
    tenant();
    await ingestLog(env.DB, log({ id: "rent", direction: "in", amount: 5_191_667, content: "CK" }), "webhook", now());
    const { transactions } = await assignLog(env.DB, "rent", [{ meaning: "income", amount: 5_191_667, tenant_id: "tenant-binh" }], null, now());
    expect(transactions[0]).toMatchObject({ meaning: "income", tenant_id: "tenant-binh", income_stream_id: "rental" });

    await allocateIncome(env.DB, Number(transactions[0]!.id));
    const funds = raw.prepare("SELECT wallet_id, amount FROM transactions WHERE meaning = 'fund'").all();
    expect(funds).toEqual([{ wallet_id: "rental-income", amount: 5_191_667 }]);
    expect(raw.prepare("SELECT balance FROM v_tenant_balance WHERE tenant_id = 'tenant-binh'").get()).toEqual({ balance: -5_191_667 });
  });

  it("gán log tiền ra thành chuyển khoản kèm chuyển ví Thu cho thuê → Tích sản", async () => {
    await ingestLog(env.DB, log({ id: "mv", direction: "out", amount: 3_000_000, content: "chuyen BIDV" }), "webhook", now());
    const { transactions } = await assignLog(
      env.DB,
      "mv",
      [{ meaning: "transfer", amount: 3_000_000, other_account_id: "tcb-husband", from_wallet_id: "rental-income", wallet_id: "wealth-building" }],
      null,
      now(),
    );
    expect(transactions[0]).toMatchObject({ account_id: "vcb-husband", counter_account_id: "tcb-husband", counter_wallet_id: "rental-income", wallet_id: "wealth-building" });
    expect(walletBalance("rental-income")).toBe(-3_000_000);
    expect(walletBalance("wealth-building")).toBe(3_000_000);
  });
});

describe("số lũy kế SePay gửi kèm không được lưu hay so (ADR-87)", () => {
  it("webhook mang accumulated lệch hẳn sổ → log ghi bình thường, không cờ reconcile_drift, raw giữ nguyên payload", async () => {
    const payload = { id: "d1", accumulated: 999_999_999, transferAmount: 500_000 };
    await ingestLog(env.DB, log({ id: "d1", direction: "in", amount: 500_000, accountNo: "0011xxxxxxx", raw: payload }), "webhook", now());
    expect(bankLog("d1")).toMatchObject({ status: "pending", account_id: "vcb-husband" });
    expect(bankLog("d1")).not.toHaveProperty("accumulated");
    expect(JSON.parse(String(bankLog("d1")!.raw))).toEqual(payload);
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'reconcile_drift'").get()).toEqual({ n: 0 });
  });
});

describe("assign / ignore", () => {
  it("gán với tổng splits không khớp số tiền log → lỗi split_mismatch", async () => {
    await ingestLog(env.DB, log({ id: "s1", direction: "out", amount: 100_000, accountNo: "0011xxxxxxx", content: "linh tinh" }), "webhook", now());
    await expect(assignLog(env.DB, "s1", [{ meaning: "spend", amount: 40_000, category_id: "groceries" }], "husband", now())).rejects.toMatchObject({ code: "split_mismatch" });
  });

  it("gán đúng tổng tiền thì tạo transaction, log chuyển 'assigned'", async () => {
    await ingestLog(env.DB, log({ id: "s2", direction: "out", amount: 100_000, accountNo: "0011xxxxxxx", content: "linh tinh" }), "webhook", now());
    const result = await assignLog(env.DB, "s2", [{ meaning: "spend", amount: 100_000, category_id: "groceries" }], "husband", now());
    expect(result.transactions).toHaveLength(1);
    expect(result.log.status).toBe("assigned");
  });

  it("ignore log pending → 'ignored'; ignore lần hai báo lỗi not_pending", async () => {
    await ingestLog(env.DB, log({ id: "s3", direction: "out", amount: 1_000, accountNo: "0011xxxxxxx", content: "linh tinh" }), "webhook", now());
    await ignoreLog(env.DB, "s3");
    expect(bankLog("s3")).toMatchObject({ status: "ignored" });
    await expect(ignoreLog(env.DB, "s3")).rejects.toMatchObject({ code: "not_pending" });
  });
});

describe("số dư đầu là mốc: log trước ngày mở sổ không vào sổ (ADR-76)", () => {
  // vcb-husband mở sổ ngày 22/9 (giờ VN) với 1.000.000: mọi khoản trước ngày đó đã nằm trong số này.
  beforeEach(() => {
    raw.prepare("UPDATE accounts SET opened_at = '2026-09-22', opening_balance = 1000000 WHERE id = 'vcb-husband'").run();
  });
  const feed = (id: string) => raw.prepare("SELECT feed_balance, pending_count FROM v_account_logs WHERE account_id = ?").get(id);
  const BEFORE = "2026-09-21T16:59:00.000Z"; // 23:59 ngày 21/9 giờ VN
  const OPENING_DAY = "2026-09-21T17:00:00.000Z"; // 00:00 ngày 22/9 giờ VN

  it("log trước mốc lưu 'ignored': không khớp rule, không ghép cặp, không báo chờ gán, không làm lệch đối soát; số dư theo log giữ nguyên", async () => {
    await ingestLog(env.DB, log({ id: "mo-1", at: OPENING_DAY, direction: "in", amount: 200_000, content: "linh tinh" }), "webhook", now());
    expect(feed("vcb-husband")).toEqual({ feed_balance: 1_200_000, pending_count: 1 });

    // Khớp mã EAN (sẽ tự ghi khoản chi) và một chân tiền vào đối ứng ở tcb-husband vài phút sau.
    const r = await ingestLog(env.DB, log({ id: "truoc-1", at: BEFORE, refCode: "EAN", content: "EAN AN TRUA" }), "backfill", now());
    expect(r).toEqual({ created: true, logId: "truoc-1", beforeOpening: true });
    await ingestLog(env.DB, log({ id: "tcb-in", at: "2026-09-21T17:02:00.000Z", direction: "in", accountNo: "1903xxxxxxx" }), "webhook", now());

    expect(bankLog("truoc-1")).toMatchObject({ status: "ignored", account_id: "vcb-husband", amount: 100_000 });
    expect(txOf("truoc-1")).toEqual([]);
    expect(bankLog("tcb-in")).toMatchObject({ status: "pending" });
    expect(feed("vcb-husband")).toEqual({ feed_balance: 1_200_000, pending_count: 1 });
    expect((await listPendingLogs(env.DB, 50)).map((l) => l.id).sort()).toEqual(["mo-1", "tcb-in"]);
    // Gửi lại: vẫn là một log, không đổi trạng thái.
    expect(await ingestLog(env.DB, log({ id: "truoc-1", at: BEFORE }), "webhook", now())).toEqual({ created: false, logId: "truoc-1" });
  });

  it("log đúng ngày mở sổ đi luồng thường: khớp rule, vào sổ, vào số dư theo log", async () => {
    await ingestLog(env.DB, log({ id: "mo-2", at: OPENING_DAY, refCode: "EAN", content: "EAN AN TRUA" }), "webhook", now());
    expect(bankLog("mo-2")).toMatchObject({ status: "assigned" });
    expect(txOf("mo-2")).toHaveLength(1);
    expect(feed("vcb-husband")).toEqual({ feed_balance: 900_000, pending_count: 0 });
  });

  it("tài khoản không có ngày mở sổ: log cũ bao lâu vẫn chờ gán và vào số dư theo log như trước", async () => {
    raw.prepare("UPDATE accounts SET opening_balance = 300000 WHERE id = 'tcb-husband'").run();
    await ingestLog(env.DB, log({ id: "cu-1", at: "2020-01-01T03:00:00.000Z", direction: "in", accountNo: "1903xxxxxxx" }), "webhook", now());
    expect(bankLog("cu-1")).toMatchObject({ status: "pending" });
    expect(feed("tcb-husband")).toEqual({ feed_balance: 400_000, pending_count: 1 });
  });

  it("log trước mốc lỡ còn 'pending' (nhận trước khi có luật): gán và ghép cặp tay đều bị chặn before_opening, log vẫn chờ", async () => {
    raw.prepare(
      `INSERT INTO bank_logs (id, at, amount, direction, account_id, account_no, source, status, received_at)
       VALUES ('cu-cho', ?, 100000, 'out', 'vcb-husband', '0011xxxxxxx', 'webhook', 'pending', '2026-09-21 16:59:00')`,
    ).run(BEFORE);
    await expect(assignLog(env.DB, "cu-cho", [{ meaning: "spend", amount: 100_000, category_id: "groceries" }], "husband", now())).rejects.toMatchObject({
      code: "before_opening",
      message: "Ngày này trước ngày mở sổ của tài khoản VCB (chính) (22/9/2026) — số dư đầu đã tính khoản này.",
    });
    await ingestLog(env.DB, log({ id: "tcb-in", at: "2026-09-21T17:02:00.000Z", direction: "in", accountNo: "1903xxxxxxx" }), "webhook", now());
    await expect(pairLogs(env.DB, "cu-cho", "tcb-in")).rejects.toMatchObject({ code: "before_opening" });
    expect(bankLog("cu-cho")).toMatchObject({ status: "pending" });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
  });
});

describe("chân thứ hai đến sau gắn vào chuyển nội bộ đã ghi (ADR-81)", () => {
  // Như prod 3/10/2026: hai tài khoản thuộc hai kết nối SePay khác nhau (ADR-75). Một chân đã thành chuyển nội bộ
  // (gán tay) thì chân kia về sau không còn log 'pending' nào để ghép cặp — trước đây gán nó là ghi lần hai.
  const CONTENT = "QAESPQ8378 APPMB1 1 NGUYEN VAN AN thanh toan";
  const AT = "2026-10-03T11:20:00.000Z";
  const now = () => new Date("2026-10-03T11:40:00.000Z");
  beforeEach(() => {
    raw.prepare("INSERT INTO sepay_connections (id, name, api_token) VALUES ('sepay-wife', 'SePay của vợ', 'wife-token-0002')").run();
    raw.prepare("UPDATE accounts SET sepay_connection_id = 'sepay-wife' WHERE id = 'vcb-wife'").run();
  });
  const outLeg = (over: Partial<ParsedBankLog> = {}) => log({ id: "86671567", direction: "out", amount: 250_000, accountNo: "0011xxxxxxx", content: CONTENT, at: AT, ...over });
  const inLeg = (over: Partial<ParsedBankLog> = {}) => log({ id: "86671569", direction: "in", amount: 250_000, accountNo: "0011yyyyyyy", content: CONTENT, at: AT, ...over });
  const book = (id: string) => (raw.prepare("SELECT book_balance FROM v_account_book WHERE account_id = ?").get(id) as { book_balance: number }).book_balance;
  const drift = (id: string) => (raw.prepare("SELECT book_drift FROM v_reconcile WHERE account_id = ?").get(id) as { book_drift: number }).book_drift;
  const active = () => raw.prepare("SELECT account_id, counter_account_id, amount, log_id, log_id_2 FROM transactions WHERE status = 'active'").all();
  const transfer = (other: string, amount = 250_000) => [{ meaning: "transfer" as const, amount, other_account_id: other }];
  /** Chân ra về qua kết nối 'default', không khớp rule nào → chờ; người gán tay thành chuyển nội bộ sang vcb-wife. */
  async function outLegAssigned() {
    await ingestLog(env.DB, outLeg(), "webhook", now(), "default");
    return (await assignLog(env.DB, "86671567", transfer("vcb-wife"), "husband", now())).transactions[0]!.id as number;
  }

  it("chân ra đã gán tay, chân vào về sau qua kết nối khác → gắn vào đúng giao dịch đó; mỗi tài khoản đúng 250.000", async () => {
    await outLegAssigned();
    await ingestLog(env.DB, inLeg(), "webhook", now(), "sepay-wife");
    expect(active()).toEqual([{ account_id: "vcb-husband", counter_account_id: "vcb-wife", amount: 250_000, log_id: "86671567", log_id_2: "86671569" }]);
    expect(bankLog("86671569")).toMatchObject({ status: "assigned" });
    expect([book("vcb-husband"), book("vcb-wife")]).toEqual([-250_000, 250_000]);
    expect([drift("vcb-husband"), drift("vcb-wife")]).toEqual([0, 0]);
  });

  it("chân vào đã gán tay trước, chân ra về sau → cũng gắn, không ghi thêm", async () => {
    await ingestLog(env.DB, inLeg(), "webhook", now(), "sepay-wife");
    await assignLog(env.DB, "86671569", transfer("vcb-husband"), "wife", now());
    await ingestLog(env.DB, outLeg({ at: "2026-10-03T11:29:00.000Z" }), "webhook", now(), "default");
    expect(active()).toEqual([{ account_id: "vcb-husband", counter_account_id: "vcb-wife", amount: 250_000, log_id: "86671569", log_id_2: "86671567" }]);
    expect(bankLog("86671567")).toMatchObject({ status: "assigned" });
    expect([book("vcb-husband"), book("vcb-wife")]).toEqual([-250_000, 250_000]);
  });

  it("chân thứ hai đang chờ (như prod sau khi gỡ giao dịch ghi lần hai): gợi ý khớp; gán tay thì gắn vào giao dịch đã ghi", async () => {
    const first = await outLegAssigned();
    // Trạng thái prod: chân vào về khi chưa có luật này và bị gán tay thành giao dịch thứ hai.
    raw.prepare(
      `INSERT INTO bank_logs (id, at, amount, direction, account_id, account_no, content, source, status, received_at)
       VALUES ('86671569', ?, 250000, 'in', 'vcb-wife', '0011yyyyyyy', ?, 'webhook', 'pending', '2026-10-03 11:20:05')`,
    ).run(AT, CONTENT);
    raw.prepare(
      `INSERT INTO transactions (log_id, at, amount, meaning, account_id, counter_account_id, week_key, month_key, source)
       VALUES ('86671569', ?, 250000, 'transfer', 'vcb-husband', 'vcb-wife', '2026-W40', '2026-10', 'sepay')`,
    ).run(AT);
    raw.prepare("UPDATE bank_logs SET status = 'assigned' WHERE id = '86671569'").run();
    expect([book("vcb-husband"), book("vcb-wife")]).toEqual([-500_000, 500_000]);

    const second = (raw.prepare("SELECT id FROM transactions WHERE log_id = '86671569'").get() as { id: number }).id;
    await unassignTransaction(env.DB, second);
    const pending = (await listPendingLogs(env.DB, 10)).find((l) => l.id === "86671569")!;
    expect(pending.suggestion).toEqual({ meaning: "transfer", other_account_id: "vcb-husband", attach_to_tx: first, label: "Khớp chuyển nội bộ đã ghi lúc 18:20" });

    const res = await assignLog(env.DB, "86671569", transfer("vcb-husband"), "wife", now());
    expect(res).toMatchObject({ attached: true, log: { status: "assigned" }, transactions: [{ id: first, log_id: "86671567", log_id_2: "86671569" }] });
    expect(active()).toEqual([{ account_id: "vcb-husband", counter_account_id: "vcb-wife", amount: 250_000, log_id: "86671567", log_id_2: "86671569" }]);
    expect([book("vcb-husband"), book("vcb-wife")]).toEqual([-250_000, 250_000]);
  });

  it("lệch số tiền, lệch quá 10 phút, hay đầu kia khác tài khoản → không gắn: chờ gán, gán thì ghi giao dịch riêng", async () => {
    await outLegAssigned();
    await ingestLog(env.DB, inLeg({ id: "tien-khac", amount: 240_000 }), "webhook", now(), "sepay-wife");
    await ingestLog(env.DB, inLeg({ id: "qua-gio", at: "2026-10-03T11:30:01.000Z" }), "webhook", now(), "sepay-wife");
    await ingestLog(env.DB, inLeg({ id: "other-account", accountNo: "1903xxxxxxx" }), "webhook", now(), "default");
    for (const id of ["tien-khac", "qua-gio", "other-account"]) expect(bankLog(id)).toMatchObject({ status: "pending" });
    const suggestions = (await listPendingLogs(env.DB, 10)).map((l) => (l.suggestion as { attach_to_tx?: number } | null)?.attach_to_tx);
    expect(suggestions).toEqual([undefined, undefined, undefined]);

    const res = await assignLog(env.DB, "qua-gio", transfer("vcb-husband"), "wife", now());
    expect(res.attached).toBe(false);
    expect(active()).toHaveLength(2);
  });

  it("giao dịch đã đủ hai chân thì không gắn thêm chân nào", async () => {
    await ingestLog(env.DB, outLeg(), "webhook", now(), "default");
    await ingestLog(env.DB, inLeg(), "webhook", now(), "sepay-wife");
    expect(active()).toEqual([{ account_id: "vcb-husband", counter_account_id: "vcb-wife", amount: 250_000, log_id: "86671567", log_id_2: "86671569" }]);
    await ingestLog(env.DB, inLeg({ id: "lan-hai", at: "2026-10-03T11:25:00.000Z" }), "webhook", now(), "sepay-wife");
    expect(bankLog("lan-hai")).toMatchObject({ status: "pending" });
    expect(active()).toHaveLength(1);
  });

  it("gỡ gán giao dịch đã gắn chân thứ hai → huỷ giao dịch, cả hai log về chờ", async () => {
    const first = await outLegAssigned();
    await ingestLog(env.DB, inLeg(), "webhook", now(), "sepay-wife");
    expect(await unassignTransaction(env.DB, first)).toEqual({ voided: [first], logs: ["86671567", "86671569"] });
    expect(bankLog("86671567")).toMatchObject({ status: "pending" });
    expect(bankLog("86671569")).toMatchObject({ status: "pending" });
    expect(active()).toEqual([]);
  });
});
