// Tiết kiệm tiền lẻ MB = heo đất (ADR-77): mỗi người một tài khoản heo (ngăn Tích luỹ). Từ v2 (ADR-123, ADR-131) bỏ heo /
// heo trả về chỉ là chuyển tài khoản → tài khoản, không ví, không vai trò tài khoản. DB hộ mẫu (husband/wife) thêm tài khoản
// MB chi tiêu của từng người, tài khoản tiết kiệm của vợ (Dự phòng), heo của mỗi người (Tích luỹ) và rule heo.
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { assignLog, ingestLog, listPendingLogs, type ParsedBankLog } from "../src/services/ingest";
import { getSnapshot, netWorth } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";

const ROUND_UP = "CHUYEN TIEN LE LAM TRON SAU GIAO DICH CHUYEN KHOAN VAO TAI KHOAN DANG GOM (TIET KIEM TIEN LE)";
// Dạng nội dung MB gửi khi tất toán sổ tích lũy của heo về tài khoản (số sổ, tên chủ là mẫu).
const SETTLE = "Tat toan truoc han tien gui sotich luy AC - 1234567890123 ngay20261003 cua NGUYEN VAN AN";

/** Tài khoản MB chi tiêu của từng người (Vận hành), tiết kiệm của vợ (Dự phòng), heo của mỗi người (Tích luỹ); rule heo cho mọi tài khoản MB của chủ có heo. */
function addPiggyBanks(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO accounts (id, name, kind, bank, account_no, sepay_enabled, sepay_out, owner_member_id, sepay_connection_id, opened_at, pocket, pocket_confirmed) VALUES
      ('mb-spending-husband', 'MB chi tiêu (chồng)', 'bank', 'MBBank', '0901', 1, 0, 'husband', 'default', NULL, 'operating', 1),
      ('mb-spending-wife', 'MB chi tiêu (vợ)', 'bank', 'MBBank', '0902', 0, 0, 'wife', NULL, NULL, 'operating', 1),
      ('buffer-wife', 'MB tiết kiệm (vợ)', 'bank', 'MBBank', '0903', 0, 0, 'wife', NULL, NULL, 'reserve', 1),
      ('piggy-bank-husband', 'Heo đất MB (Chồng)', 'bank', 'MBBank', NULL, 0, 0, 'husband', NULL, '2026-10-01', 'savings', 1),
      ('piggy-bank-wife', 'Heo đất MB (Vợ)', 'bank', 'MBBank', NULL, 0, 0, 'wife', NULL, '2026-10-01', 'savings', 1);
    INSERT INTO rules (priority, match_type, pattern, meaning, is_salary, by_member_id, account_id, counter_account_id)
      SELECT p.priority, 'content', p.pattern, 'transfer', 0, a.owner, a.id, a.piggy
      FROM (SELECT 'mb-spending-husband' AS id, 'husband' AS owner, 'piggy-bank-husband' AS piggy
            UNION ALL SELECT 'mb-spending-wife', 'wife', 'piggy-bank-wife'
            UNION ALL SELECT 'buffer-wife', 'wife', 'piggy-bank-wife') a
      CROSS JOIN (SELECT 10 AS priority, 'CHUYEN TIEN LE LAM TRON' AS pattern UNION ALL SELECT 11, 'TIET KIEM TIEN LE' UNION ALL SELECT 12, 'TICH LUY') p
      ORDER BY a.id, p.priority;
  `);
}

let raw: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  raw = openDb();
  addPiggyBanks(raw);
  db = asD1(raw);
});

const log = (over: Partial<ParsedBankLog>): ParsedBankLog => ({
  id: "L1",
  at: "2026-10-02T03:00:00.000Z",
  amount: 5_600,
  direction: "out",
  accountNo: "0901", // mb-spending-husband
  content: ROUND_UP,
  refCode: null,
  referenceNumber: null,
  raw: {},
  ...over,
});
const now = new Date("2026-10-02T03:00:05.000Z");
const txOf = (logId: string) => raw.prepare("SELECT * FROM transactions WHERE log_id = ? ORDER BY id").all(logId) as Record<string, unknown>[];
const bookBalance = (id: string) => raw.prepare("SELECT book_balance AS balance FROM v_account_book WHERE account_id = ?").get(id);
const feedOut = (id: string) => raw.prepare("UPDATE accounts SET sepay_out = 1 WHERE id = ?").run(id);
const wifeOnSepay = (sepayOut: 0 | 1) =>
  raw.prepare("UPDATE accounts SET sepay_enabled = 1, sepay_out = ?, sepay_connection_id = 'default' WHERE id = 'mb-spending-wife'").run(sepayOut);

describe("bỏ heo: log làm tròn tiền lẻ của MB", () => {
  it("UC-303 AC-18: tài khoản SePay báo cả tiền ra: tự gán chuyển nội bộ sang heo của chính chủ, không ví — không phải chi tiêu", async () => {
    feedOut("mb-spending-husband");
    await ingestLog(db, log({}), "webhook", now);

    expect(txOf("L1")).toMatchObject([
      {
        meaning: "transfer",
        amount: 5_600,
        account_id: "mb-spending-husband",
        counter_account_id: "piggy-bank-husband",
        category_id: null,
      },
    ]);
    expect(txOf("L1")[0]).not.toHaveProperty("wallet_id");
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'L1'").get()).toEqual({ status: "assigned" });
    // Không phải khoản chi.
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning = 'spend'").get()).toEqual({ n: 0 });
    expect(bookBalance("piggy-bank-husband")).toEqual({ balance: 5_600 });
  });

  it("UC-305 AC-19: MB chỉ báo tiền vào (sepay_out = 0 như prod): giữ chờ, gợi ý điền sẵn đúng chuyển nội bộ, không trường ví; gán theo gợi ý ra cùng kết quả", async () => {
    await ingestLog(db, log({}), "webhook", now);
    expect(txOf("L1")).toEqual([]);
    const [pending] = await listPendingLogs(db, 10, "husband");
    expect(pending!.suggestion).toEqual({
      meaning: "transfer",
      other_account_id: "piggy-bank-husband",
      label: "Chuyển sang Heo đất MB (Chồng)",
      note: expect.stringContaining("Bỏ qua"),
    });
    // Gán đúng như màn Gán điền sẵn từ gợi ý.
    await assignLog(db, "L1", [{ meaning: "transfer", amount: 5_600, other_account_id: "piggy-bank-husband" }], "husband", now);
    expect(txOf("L1")).toMatchObject([{ account_id: "mb-spending-husband", counter_account_id: "piggy-bank-husband" }]);
  });

  it("UC-303 AC-18: mỗi người một con heo: log của tài khoản MB của vợ vào heo của vợ; rule của chồng không áp sang", async () => {
    wifeOnSepay(1);
    await ingestLog(db, log({ id: "T1", accountNo: "0902", amount: 3_000 }), "webhook", now);
    expect(txOf("T1")).toMatchObject([{ account_id: "mb-spending-wife", counter_account_id: "piggy-bank-wife", by_member_id: "wife" }]);
  });

  it("log trước ngày mở sổ của heo không tự gán (số dư đầu đã gồm nó)", async () => {
    feedOut("mb-spending-husband");
    await ingestLog(db, log({ at: "2026-09-30T03:00:00.000Z" }), "webhook", now);
    expect(txOf("L1")).toEqual([]);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'L1'").get()).toEqual({ status: "pending" });
  });
});

describe("rút heo về tài khoản", () => {
  const returnLog = (amount: number, content = "TAT TOAN TIET KIEM TIEN LE") =>
    log({ id: "R1", direction: "in", amount, content, at: "2026-10-03T03:00:00.000Z" });
  const pendingR1 = async () => (await listPendingLogs(db, 10, "husband")).find((l) => l.id === "R1")!.suggestion as Record<string, unknown>;
  const RETURN = { meaning: "transfer", other_account_id: "piggy-bank-husband", label: "Rút heo về MB chi tiêu (chồng)" };

  it("UC-305 AC-22: tiền vào khớp mẫu heo: không tự gán, gợi ý chỉ chuyển tài khoản heo → tài khoản này, không ví", async () => {
    feedOut("mb-spending-husband");
    await ingestLog(db, log({ id: "L1", amount: 50_000 }), "webhook", now);
    await ingestLog(db, log({ id: "L2", amount: 5_600 }), "webhook", now);
    await ingestLog(db, returnLog(51_200), "webhook", now);
    expect(txOf("R1")).toEqual([]);
    expect(await pendingR1()).toEqual(RETURN);

    // Gán đúng như màn Gán điền sẵn: chỉ đổi chỗ tiền.
    await assignLog(db, "R1", [{ meaning: "transfer", amount: 51_200, other_account_id: "piggy-bank-husband" }], "husband", now);
    expect(txOf("R1")).toMatchObject([{ meaning: "transfer", account_id: "piggy-bank-husband", counter_account_id: "mb-spending-husband" }]);
    expect(bookBalance("piggy-bank-husband")).toEqual({ balance: 4_400 });
  });

  it("UC-305 AC-22: MB tất toán sổ tích lũy (nội dung thật): cùng gợi ý rút heo của chính chủ về tài khoản", async () => {
    await ingestLog(db, returnLog(400_000, SETTLE), "webhook", now);
    expect(txOf("R1")).toEqual([]);
    expect(await pendingR1()).toEqual(RETURN);
  });

  it("UC-303 AC-18: tiền ra khớp 'TICH LUY' (tự gửi thêm vào sổ tích lũy): tài khoản báo cả tiền ra tự gán bỏ heo; 'chỉ tiền vào' thì gợi ý", async () => {
    const deposit = "GUI TIEN TICH LUY AC 1234567890123";
    feedOut("mb-spending-husband");
    await ingestLog(db, log({ id: "D1", amount: 100_000, content: deposit }), "webhook", now);
    expect(txOf("D1")).toMatchObject([{ meaning: "transfer", account_id: "mb-spending-husband", counter_account_id: "piggy-bank-husband" }]);

    // Tài khoản MB của vợ nối SePay nhưng để "chỉ tiền vào": tiền ra không tự gán, chỉ gợi ý.
    wifeOnSepay(0);
    await ingestLog(db, log({ id: "D2", accountNo: "0902", amount: 20_000, content: deposit }), "webhook", now);
    expect(txOf("D2")).toEqual([]);
    const pending = (await listPendingLogs(db, 10, "wife")).find((l) => l.id === "D2")!;
    expect(pending.suggestion).toMatchObject({ meaning: "transfer", other_account_id: "piggy-bank-wife" });
    expect(pending.suggestion).not.toHaveProperty("wallet_id");
  });
});

describe("GET /v1/networth: heo đất là tài khoản ngăn Tích luỹ", () => {
  it("nằm trong tiền thật, tách tổng và từng người — chuyển giữa các tài khoản của nhà không đổi tiền thật", async () => {
    feedOut("mb-spending-husband");
    wifeOnSepay(1);
    const before = await netWorth(db, "husband", now);
    await ingestLog(db, log({ id: "M1", amount: 7_000 }), "webhook", now);
    await ingestLog(db, log({ id: "T1", accountNo: "0902", amount: 5_000 }), "webhook", now);
    const nw = await netWorth(db, "husband", now);
    // Heo đất là tài khoản ngăn Tích luỹ (receivable UC-1005 AC-5): tổng ngăn +12.000, kể từng heo.
    expect(nw.pockets.savings - before.pockets.savings).toBe(12_000);
    expect(nw.savings.accounts.filter((a) => a.id.startsWith("piggy-bank-"))).toEqual([
      { id: "piggy-bank-husband", name: "Heo đất MB (Chồng)", balance: 7_000 },
      { id: "piggy-bank-wife", name: "Heo đất MB (Vợ)", balance: 5_000 },
    ]);
    expect(nw).not.toHaveProperty("wealthBuildingCash");
    expect(nw.cash).toBe(before.cash);
    expect(nw.netWorth).toBe(before.netWorth);
  });
});

describe("tiền chi được: heo đất (ngăn Tích luỹ) không tính", () => {
  it("bỏ heo 12.000: tiền chi được giảm đúng 12.000 (tiền rời tài khoản chi tiêu), không phải 24.000; heo ở danh sách không tính", async () => {
    feedOut("mb-spending-husband");
    wifeOnSepay(1);
    const before = (await getSnapshot(db, "husband", now)).nearSpend;
    await ingestLog(db, log({ id: "M1", amount: 7_000 }), "webhook", now);
    await ingestLog(db, log({ id: "T1", accountNo: "0902", amount: 5_000 }), "webhook", now);
    const after = (await getSnapshot(db, "husband", now)).nearSpend;
    expect(after.amount).toBe(before.amount - 12_000);
    expect(after.accounts.map((a) => a.accountId)).not.toContain("piggy-bank-husband");
    expect(after.excluded.filter((a) => a.accountId.startsWith("piggy-bank-")).map((a) => [a.accountId, a.pocket])).toEqual([
      ["piggy-bank-husband", "savings"],
      ["piggy-bank-wife", "savings"],
    ]);
  });
});
