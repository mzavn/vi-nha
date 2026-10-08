// Tiết kiệm tiền lẻ MB = heo đất (ADR-77): mỗi người một tài khoản heo. Heo là Tích sản (ADR-82): bỏ heo chuyển ví
// Có thì tốt → Tích sản; heo trả về chỉ đổi chỗ tiền. DB hộ mẫu (husband/wife) thêm tài khoản MB chi tiêu của từng người,
// phao của vợ, heo của mỗi người và rule heo — đúng hình dạng migration heo đất để lại trên DB có heo.
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { assignLog, ingestLog, listPendingLogs, type ParsedBankLog } from "../src/services/ingest";
import { allocateIncome, createEntry, getSnapshot, netWorth, wealthBuildingBreakdown } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";

const ROUND_UP = "CHUYEN TIEN LE LAM TRON SAU GIAO DICH CHUYEN KHOAN VAO TAI KHOAN DANG GOM (TIET KIEM TIEN LE)";
// Dạng nội dung MB gửi khi tất toán sổ tích lũy của heo về tài khoản (số sổ, tên chủ là mẫu).
const SETTLE = "Tat toan truoc han tien gui sotich luy AC - 1234567890123 ngay20261003 cua NGUYEN VAN AN";

/** Tài khoản MB chi tiêu của từng người, phao của vợ, heo của mỗi người; rule heo cho mọi tài khoản MB của chủ có heo. */
function addPiggyBanks(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO accounts (id, name, kind, bank, account_no, sepay_enabled, sepay_out, owner_member_id, sepay_connection_id, opened_at, locked, spendable, role) VALUES
      ('mb-spending-husband', 'MB chi tiêu (chồng)', 'bank', 'MBBank', '0901', 1, 0, 'husband', 'default', NULL, 0, 1, NULL),
      ('mb-spending-wife', 'MB chi tiêu (vợ)', 'bank', 'MBBank', '0902', 0, 0, 'wife', NULL, NULL, 0, 1, NULL),
      ('buffer-wife', 'MB tiết kiệm (vợ)', 'bank', 'MBBank', '0903', 0, 0, 'wife', NULL, NULL, 0, 0, 'buffer'),
      ('piggy-bank-husband', 'Heo đất MB (Chồng)', 'bank', 'MBBank', NULL, 0, 0, 'husband', NULL, '2026-10-01', 1, 0, 'piggy_bank'),
      ('piggy-bank-wife', 'Heo đất MB (Vợ)', 'bank', 'MBBank', NULL, 0, 0, 'wife', NULL, '2026-10-01', 1, 0, 'piggy_bank');
    INSERT INTO rules (priority, match_type, pattern, meaning, is_salary, wallet_id, by_member_id, account_id, counter_account_id, from_wallet_id)
      SELECT p.priority, 'content', p.pattern, 'transfer', 0, a.wallet_id, a.owner, a.id, a.piggy, a.from_wallet_id
      FROM (SELECT 'mb-spending-husband' AS id, 'husband' AS owner, 'piggy-bank-husband' AS piggy, 'nice-to-have' AS from_wallet_id, 'wealth-building' AS wallet_id
            UNION ALL SELECT 'mb-spending-wife', 'wife', 'piggy-bank-wife', 'nice-to-have', 'wealth-building'
            -- Phao → heo là giữa hai tài khoản Tích sản: chỉ đổi chỗ, không chuyển ví.
            UNION ALL SELECT 'buffer-wife', 'wife', 'piggy-bank-wife', NULL, NULL) a
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
const walletBalance = (id: string) => raw.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = ?").get(id);
const bookBalance = (id: string) => raw.prepare("SELECT book_balance AS balance FROM v_account_book WHERE account_id = ?").get(id);
const feedOut = (id: string) => raw.prepare("UPDATE accounts SET sepay_out = 1 WHERE id = ?").run(id);
const wifeOnSepay = (sepayOut: 0 | 1) =>
  raw.prepare("UPDATE accounts SET sepay_enabled = 1, sepay_out = ?, sepay_connection_id = 'default' WHERE id = 'mb-spending-wife'").run(sepayOut);

describe("bỏ heo: log làm tròn tiền lẻ của MB", () => {
  it("tài khoản SePay báo cả tiền ra: tự gán chuyển nội bộ sang heo của chính chủ, ví Có thì tốt → Tích sản — không phải chi tiêu", async () => {
    feedOut("mb-spending-husband");
    const before = await getSnapshot(db, "husband", now);
    await ingestLog(db, log({}), "webhook", now);

    expect(txOf("L1")).toMatchObject([
      {
        meaning: "transfer",
        amount: 5_600,
        account_id: "mb-spending-husband",
        counter_account_id: "piggy-bank-husband",
        counter_wallet_id: "nice-to-have",
        wallet_id: "wealth-building",
        category_id: null,
      },
    ]);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'L1'").get()).toEqual({ status: "assigned" });
    // Không phải khoản chi: không có dòng đã tiêu nào ở bất kỳ ví nào, tuần hay tháng.
    expect(raw.prepare("SELECT COUNT(*) n FROM v_spent_raw").get()).toEqual({ n: 0 });

    const after = await getSnapshot(db, "husband", now);
    expect(walletBalance("nice-to-have")).toEqual({ balance: -5_600 });
    expect(after.tiers.wealth_building.cash).toBe(before.tiers.wealth_building.cash + 5_600);
    // Còn để chi chỉ đổi đúng ở phong bì Có thì tốt (bị rút 5.600 sang heo); ví khác giữ nguyên.
    const changed = after.spendableByWallet.filter((w) => w.amount !== before.spendableByWallet.find((b) => b.walletId === w.walletId)!.amount);
    expect(changed.map((w) => w.walletId)).toEqual(["nice-to-have"]);
    // Heo là Tích sản: Quỹ an tâm đếm cả tiền heo.
    expect(after.safetyFund.cash).toBe(before.safetyFund.cash + 5_600);
  });

  it("MB chỉ báo tiền vào (sepay_out = 0 như prod): giữ chờ, gợi ý điền sẵn đúng chuyển nội bộ + chuyển ví; gán theo gợi ý ra cùng kết quả", async () => {
    await ingestLog(db, log({}), "webhook", now);
    expect(txOf("L1")).toEqual([]);
    const [pending] = await listPendingLogs(db, 10);
    expect(pending!.suggestion).toMatchObject({
      meaning: "transfer",
      other_account_id: "piggy-bank-husband",
      from_wallet_id: "nice-to-have",
      wallet_id: "wealth-building",
      label: "Chuyển sang Heo đất MB (Chồng)",
    });
    // Gán đúng như màn Gán điền sẵn từ gợi ý.
    await assignLog(
      db,
      "L1",
      [{ meaning: "transfer", amount: 5_600, other_account_id: "piggy-bank-husband", from_wallet_id: "nice-to-have", wallet_id: "wealth-building" }],
      "husband",
      now,
    );
    expect(txOf("L1")).toMatchObject([{ account_id: "mb-spending-husband", counter_account_id: "piggy-bank-husband", counter_wallet_id: "nice-to-have", wallet_id: "wealth-building" }]);
  });

  it("mỗi người một con heo: log của tài khoản MB của vợ vào heo của vợ; rule của chồng không áp sang", async () => {
    wifeOnSepay(1);
    await ingestLog(db, log({ id: "T1", accountNo: "0902", amount: 3_000 }), "webhook", now);
    expect(txOf("T1")).toMatchObject([{ account_id: "mb-spending-wife", counter_account_id: "piggy-bank-wife", wallet_id: "wealth-building", by_member_id: "wife" }]);
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
  const pendingR1 = async () => (await listPendingLogs(db, 10)).find((l) => l.id === "R1")!.suggestion as Record<string, unknown>;
  const RETURN = {
    meaning: "transfer",
    other_account_id: "piggy-bank-husband",
    label: "Rút heo về MB chi tiêu (chồng)",
    note: "Chỉ đổi chỗ tiền; tiền vẫn thuộc Tích sản cho tới khi anh tự chuyển ví.",
  };

  it("tiền vào khớp mẫu heo: không tự gán, gợi ý chỉ chuyển tài khoản heo → tài khoản này; tiền vẫn thuộc Tích sản", async () => {
    feedOut("mb-spending-husband");
    await ingestLog(db, log({ id: "L1", amount: 50_000 }), "webhook", now);
    await ingestLog(db, log({ id: "L2", amount: 5_600 }), "webhook", now);
    const wealthBuilding = walletBalance("wealth-building");
    await ingestLog(db, returnLog(51_200), "webhook", now);
    expect(txOf("R1")).toEqual([]);
    const suggestion = await pendingR1();
    expect(suggestion).toEqual(RETURN);

    // Gán đúng như màn Gán điền sẵn: chỉ đổi chỗ tiền, không ví nào bị động tới.
    await assignLog(db, "R1", [{ meaning: "transfer", amount: 51_200, other_account_id: "piggy-bank-husband" }], "husband", now);
    expect(txOf("R1")).toMatchObject([{ meaning: "transfer", account_id: "piggy-bank-husband", counter_account_id: "mb-spending-husband", wallet_id: null, counter_wallet_id: null }]);
    expect(bookBalance("piggy-bank-husband")).toEqual({ balance: 4_400 });
    expect(walletBalance("wealth-building")).toEqual(wealthBuilding);
    expect(walletBalance("nice-to-have")).toEqual({ balance: -55_600 });
  });

  it("MB tất toán sổ tích lũy (nội dung thật): cùng gợi ý rút heo của chính chủ về tài khoản", async () => {
    await ingestLog(db, returnLog(400_000, SETTLE), "webhook", now);
    expect(txOf("R1")).toEqual([]);
    expect(await pendingR1()).toEqual(RETURN);
  });

  it("tiền ra khớp 'TICH LUY' (tự gửi thêm vào sổ tích lũy): tài khoản báo cả tiền ra tự gán bỏ heo; 'chỉ tiền vào' thì gợi ý", async () => {
    const deposit = "GUI TIEN TICH LUY AC 1234567890123";
    feedOut("mb-spending-husband");
    await ingestLog(db, log({ id: "D1", amount: 100_000, content: deposit }), "webhook", now);
    expect(txOf("D1")).toMatchObject([{ meaning: "transfer", account_id: "mb-spending-husband", counter_account_id: "piggy-bank-husband", counter_wallet_id: "nice-to-have", wallet_id: "wealth-building" }]);

    // Tài khoản MB của vợ nối SePay nhưng để "chỉ tiền vào": tiền ra không tự gán, chỉ gợi ý.
    wifeOnSepay(0);
    await ingestLog(db, log({ id: "D2", accountNo: "0902", amount: 20_000, content: deposit }), "webhook", now);
    expect(txOf("D2")).toEqual([]);
    const pending = (await listPendingLogs(db, 10)).find((l) => l.id === "D2")!;
    expect(pending.suggestion).toMatchObject({ meaning: "transfer", other_account_id: "piggy-bank-wife", from_wallet_id: "nice-to-have", wallet_id: "wealth-building" });
  });
});

describe("GET /v1/networth: heo đất là tiền Tích sản đã khóa", () => {
  it("nằm trong tiền thật và trong Tích sản, tách tổng và từng người — không đếm hai lần", async () => {
    feedOut("mb-spending-husband");
    wifeOnSepay(1);
    const before = await netWorth(db, "husband", now);
    await ingestLog(db, log({ id: "M1", amount: 7_000 }), "webhook", now);
    await ingestLog(db, log({ id: "T1", accountNo: "0902", amount: 5_000 }), "webhook", now);
    const nw = await netWorth(db, "husband", now);
    expect(nw.wealthBuildingAccounts).toEqual({
      total: 12_000,
      accounts: [
        { accountId: "piggy-bank-husband", name: "Heo đất MB (Chồng)", role: "piggy_bank", memberId: "husband", memberName: "Chồng", balance: 7_000 },
        { accountId: "piggy-bank-wife", name: "Heo đất MB (Vợ)", role: "piggy_bank", memberId: "wife", memberName: "Vợ", balance: 5_000 },
        { accountId: "buffer-wife", name: "MB tiết kiệm (vợ)", role: "buffer", memberId: "wife", memberName: "Vợ", balance: 0 },
      ],
    });
    // Tiền heo đã nằm trong Tích sản (ví), không phải khoản thêm.
    expect(nw.wealthBuildingCash).toBe(before.wealthBuildingCash + 12_000);
    // Chuyển giữa các tài khoản của nhà: tiền thật và tài sản ròng không đổi.
    expect(nw.cash).toBe(before.cash);
    expect(nw.netWorth).toBe(before.netWorth);
  });
});

describe("tiền chi được: heo đất không tính, phần Tích sản ở heo không trừ lại (ADR-85)", () => {
  it("bỏ heo 12.000: tiền chi được giảm đúng 12.000 (tiền rời tài khoản chi tiêu), không phải 24.000; heo ở danh sách không tính", async () => {
    feedOut("mb-spending-husband");
    wifeOnSepay(1);
    const before = (await getSnapshot(db, "husband", now)).spendableCash;
    await ingestLog(db, log({ id: "M1", amount: 7_000 }), "webhook", now);
    await ingestLog(db, log({ id: "T1", accountNo: "0902", amount: 5_000 }), "webhook", now);
    const after = (await getSnapshot(db, "husband", now)).spendableCash;
    expect(after.amount).toBe(before.amount - 12_000);
    expect(after.wealthBuildingOutside).toBe(before.wealthBuildingOutside + 12_000);
    expect(after.wealthBuildingHeld).toBe(before.wealthBuildingHeld);
    expect(after.accounts.map((a) => a.accountId)).not.toContain("piggy-bank-husband");
    expect(after.excluded.filter((a) => a.role === "piggy_bank").map((a) => a.accountId)).toEqual(["piggy-bank-husband", "piggy-bank-wife"]);
  });
});

describe("GET /v1/wealth-building: Tích sản theo loại, chỗ nằm, nguồn (ADR-86)", () => {
  const sumFlows = (flows: { direction: string; kind: string; amount: number }[], pick: (f: { direction: string; kind: string }) => boolean) =>
    flows.filter(pick).reduce((s, f) => s + f.amount, 0);

  it("bỏ heo theo từng heo, chia từ thu nhập, mua vàng: cùng số với snapshot; vào − ra = tiền", async () => {
    feedOut("mb-spending-husband");
    wifeOnSepay(1);
    await ingestLog(db, log({ id: "T1", accountNo: "0902", amount: 5_000 }), "webhook", now);
    await ingestLog(db, log({ id: "T2", accountNo: "0902", amount: 4_000 }), "webhook", now);
    await ingestLog(db, log({ id: "M1", amount: 7_000 }), "webhook", now);
    const income = await createEntry(db, { meaning: "income", amount: 10_000_000, account_id: "cash-husband" }, "husband", now);
    await allocateIncome(db, Number(income.tx!.id));
    const funded = raw.prepare("SELECT amount FROM transactions WHERE meaning = 'fund' AND wallet_id = 'wealth-building'").get() as { amount: number };
    expect(funded.amount).toBeGreaterThan(0);
    await createEntry(db, { meaning: "buy_asset", amount: 3_000, asset_kind: "gold" }, "husband", now);

    const b = await wealthBuildingBreakdown(db);
    const snap = await getSnapshot(db, "husband", now);
    expect({ cash: b.cash, assets: b.assets }).toEqual({ cash: snap.tiers.wealth_building.cash, assets: snap.tiers.wealth_building.assets });
    expect(b.assets).toBe(3_000);
    expect(b.accounts).toEqual([
      { accountId: "piggy-bank-husband", name: "Heo đất MB (Chồng)", role: "piggy_bank", memberId: "husband", memberName: "Chồng", balance: 7_000, pendingCount: 0, pendingNet: 0 },
      { accountId: "piggy-bank-wife", name: "Heo đất MB (Vợ)", role: "piggy_bank", memberId: "wife", memberName: "Vợ", balance: 9_000, pendingCount: 0, pendingNet: 0 },
      { accountId: "buffer-wife", name: "MB tiết kiệm (vợ)", role: "buffer", memberId: "wife", memberName: "Vợ", balance: 0, pendingCount: 0, pendingNet: 0 },
    ]);
    expect(b.flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "piggy_bank", direction: "in", accountId: "piggy-bank-wife", memberName: "Vợ", count: 2, amount: 9_000 }),
        expect.objectContaining({ kind: "piggy_bank", direction: "in", accountId: "piggy-bank-husband", memberName: "Chồng", count: 1, amount: 7_000 }),
        expect.objectContaining({ kind: "fund", direction: "in", count: 1, amount: funded.amount }),
        expect.objectContaining({ kind: "buy_asset", direction: "out", assetKind: "gold", count: 1, amount: 3_000 }),
      ]),
    );
    expect(b.flows).toHaveLength(4);
    // Bất biến: vào − ra (trừ mua tài sản) = số dư ví; trừ thêm mua tài sản = tiền.
    const wallet = sumFlows(b.flows, (f) => f.direction === "in") - sumFlows(b.flows, (f) => f.direction === "out" && f.kind !== "buy_asset");
    expect(walletBalance("wealth-building")).toEqual({ balance: wallet });
    expect(wallet - sumFlows(b.flows, (f) => f.kind === "buy_asset")).toBe(b.cash);
  });

  it("log heo còn chờ gán: đếm vào đúng heo của chủ tài khoản, số theo phía heo (rút heo âm)", async () => {
    await ingestLog(db, log({ id: "R1", direction: "in", amount: 400_000, content: SETTLE, at: "2026-10-03T03:00:00.000Z" }), "webhook", now);
    const b = await wealthBuildingBreakdown(db);
    expect(b.accounts.map(({ accountId, pendingCount, pendingNet }) => ({ accountId, pendingCount, pendingNet }))).toEqual([
      { accountId: "piggy-bank-husband", pendingCount: 1, pendingNet: -400_000 },
      { accountId: "piggy-bank-wife", pendingCount: 0, pendingNet: 0 },
      { accountId: "buffer-wife", pendingCount: 0, pendingNet: 0 },
    ]);
  });
});
