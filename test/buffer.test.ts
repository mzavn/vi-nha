// Tài khoản Tích sản (ADR-88): phao dự phòng và sổ tiết kiệm như heo đất — chuyển vào từ tài khoản thường là bỏ tiền vào
// Tích sản (ví Có thì tốt → Tích sản); rút ra, gửi phao → sổ, tất toán sổ → phao chỉ đổi chỗ. DB hộ mẫu (husband/wife).
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { DomainError } from "../src/domain/types";
import { ingestLog, type ParsedBankLog } from "../src/services/ingest";
import { createEntry, getSnapshot, netWorth, wealthBuildingBreakdown } from "../src/services/ledger";
import { createAccount, updateAccount } from "../src/services/settings";
import { asD1, openDb } from "./helpers/d1-sqlite";

let raw: DatabaseSync;
let db: D1Database;
const now = new Date();
const at = now.toISOString();

beforeEach(async () => {
  raw = openDb();
  db = asD1(raw);
  raw.prepare("UPDATE accounts SET opening_balance = 5000000 WHERE id = 'cash-wife'").run();
  await createAccount(db, { id: "buffer-wife", name: "MB tiết kiệm (vợ)", bank: "MBBank", owner_member_id: "wife", role: "buffer" });
  await createAccount(db, { id: "term-deposit-6m", name: "Sổ 6 tháng", bank: "MBBank", owner_member_id: "wife", role: "term_deposit" });
});

const transfer = (from: string, to: string, amount: number, extra: Record<string, string> = {}) =>
  createEntry(db, { meaning: "transfer", amount, account_id: from, to_account_id: to, at, ...extra }, "wife", now);
const lastTx = () => raw.prepare("SELECT wallet_id, counter_wallet_id, account_id, counter_account_id FROM transactions ORDER BY id DESC LIMIT 1").get();
const wallet = (id: string) => Number(raw.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = ?").get(id)?.balance);
const book = (id: string) => Number(raw.prepare("SELECT book_balance AS b FROM v_account_book WHERE account_id = ?").get(id)?.b);
const snap = () => getSnapshot(db, "wife", now);
const rejects = async (p: Promise<unknown>, code: string) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect(err).toMatchObject({ code });
};

describe("chuyển nội bộ vào tài khoản Tích sản (ADR-88)", () => {
  it("từ tài khoản thường vào phao, không chọn ví: ví Có thì tốt → Tích sản; rút ra, phao → sổ, sổ → tài khoản thường: chỉ đổi chỗ; chọn ví thì theo ví đã chọn", async () => {
    await transfer("cash-wife", "buffer-wife", 1_000_000);
    expect(lastTx()).toEqual({ wallet_id: "wealth-building", counter_wallet_id: "nice-to-have", account_id: "cash-wife", counter_account_id: "buffer-wife" });
    await transfer("buffer-wife", "term-deposit-6m", 300_000);
    expect(lastTx()).toMatchObject({ wallet_id: null, counter_wallet_id: null });
    await transfer("term-deposit-6m", "cash-wife", 100_000);
    expect(lastTx()).toMatchObject({ wallet_id: null, counter_wallet_id: null });
    await transfer("buffer-wife", "cash-husband", 50_000);
    expect(lastTx()).toMatchObject({ wallet_id: null, counter_wallet_id: null });
    await transfer("cash-wife", "cash-husband", 10_000);
    expect(lastTx()).toMatchObject({ wallet_id: null, counter_wallet_id: null });
    await transfer("cash-wife", "buffer-wife", 20_000, { from_wallet_id: "food", wallet_id: "wealth-building" });
    expect(lastTx()).toMatchObject({ wallet_id: "wealth-building", counter_wallet_id: "food" });
  });

  it("DB mới: chuyển 1.000.000 vào phao → Tích sản +1.000.000, Tiền chi được −1.000.000 một lần; gửi 800.000 phao → sổ không đổi gì; tất toán 820.000 (20.000 lãi là Thu nhập) → Tích sản về phao", async () => {
    const s0 = await snap();
    const coThiTot0 = wallet("nice-to-have");

    await transfer("cash-wife", "buffer-wife", 1_000_000);
    const s1 = await snap();
    expect(s1.tiers.wealth_building.cash).toBe(s0.tiers.wealth_building.cash + 1_000_000);
    expect(s1.spendableCash.amount).toBe(s0.spendableCash.amount - 1_000_000);
    expect(s1.spendableCash.wealthBuildingOutside).toBe(1_000_000);
    expect(s1.spendableCash.excluded.map((a) => [a.accountId, a.role])).toEqual(expect.arrayContaining([["buffer-wife", "buffer"], ["term-deposit-6m", "term_deposit"]]));
    expect(wallet("nice-to-have")).toBe(coThiTot0 - 1_000_000);
    // Quỹ an tâm đếm tiền mặt Tích sản — gồm tiền ở phao.
    expect(s1.safetyFund.cash).toBe(s0.safetyFund.cash + 1_000_000);

    await transfer("buffer-wife", "term-deposit-6m", 800_000);
    const s2 = await snap();
    expect(s2.tiers.wealth_building.cash).toBe(s1.tiers.wealth_building.cash);
    expect(s2.spendableCash.amount).toBe(s1.spendableCash.amount);
    expect(s2.safetyFund.cash).toBe(s1.safetyFund.cash);
    const places = await wealthBuildingBreakdown(db);
    expect(places.accounts.map((a) => [a.accountId, a.role, a.balance])).toEqual([
      ["buffer-wife", "buffer", 200_000],
      ["term-deposit-6m", "term_deposit", 800_000],
    ]);
    expect(places.flows).toEqual([expect.objectContaining({ kind: "buffer", direction: "in", accountId: "buffer-wife", accountName: "MB tiết kiệm (vợ)", count: 1, amount: 1_000_000 })]);

    // Tất toán 820.000 về phao: 800.000 chuyển sổ → phao, 20.000 lãi ghi Thu nhập vào phao.
    await transfer("term-deposit-6m", "buffer-wife", 800_000);
    await createEntry(db, { meaning: "income", amount: 20_000, account_id: "buffer-wife", at }, "wife", now);
    const s3 = await snap();
    expect(book("buffer-wife")).toBe(1_020_000);
    expect(book("term-deposit-6m")).toBe(0);
    expect(s3.tiers.wealth_building.cash).toBe(s1.tiers.wealth_building.cash);
    expect(s3.attention.unallocatedIncome.amount).toBe(20_000);
    expect(s3.spendableCash.amount).toBe(s1.spendableCash.amount);
    // Sổ đã tất toán thì tắt Đang dùng.
    expect(await updateAccount(db, "term-deposit-6m", { active: false })).toMatchObject({ active: false, role: "term_deposit", locked: true });
    expect((await wealthBuildingBreakdown(db)).accounts.map((a) => a.accountId)).toEqual(["buffer-wife"]);
    expect((await netWorth(db, "wife", now)).wealthBuildingAccounts).toMatchObject({ total: 1_020_000, accounts: [{ accountId: "buffer-wife", role: "buffer", balance: 1_020_000 }] });
  });
});

describe("tự khớp vào tài khoản Tích sản (ADR-88)", () => {
  const log = (over: Partial<ParsedBankLog>): ParsedBankLog => ({ id: "L1", at, amount: 500_000, direction: "out", accountNo: "0011xxxxxxx", content: "chuyen tien", refCode: null, referenceNumber: null, raw: {}, ...over });
  beforeEach(() => {
    raw.prepare("UPDATE accounts SET sepay_enabled = 1, account_no = '0999', sepay_connection_id = 'default' WHERE id = 'buffer-wife'").run();
  });

  it("ghép cặp hai log VCB → phao: chuyển nội bộ mang ví Có thì tốt → Tích sản; phao → VCB chỉ đổi chỗ", async () => {
    await ingestLog(db, log({ id: "OUT1" }), "webhook", now);
    await ingestLog(db, log({ id: "IN1", direction: "in", accountNo: "0999" }), "webhook", now);
    expect(lastTx()).toEqual({ wallet_id: "wealth-building", counter_wallet_id: "nice-to-have", account_id: "vcb-husband", counter_account_id: "buffer-wife" });
    await ingestLog(db, log({ id: "OUT2", accountNo: "0999", amount: 200_000 }), "webhook", now);
    await ingestLog(db, log({ id: "IN2", direction: "in", amount: 200_000 }), "webhook", now);
    expect(lastTx()).toEqual({ wallet_id: null, counter_wallet_id: null, account_id: "buffer-wife", counter_account_id: "vcb-husband" });
  });

  it("rule chuyển nội bộ sang phao không mang ví: tự gán cũng chuyển ví Có thì tốt → Tích sản", async () => {
    raw.prepare("UPDATE accounts SET sepay_out = 1 WHERE id = 'vcb-husband'").run();
    raw.prepare("INSERT INTO rules (priority, match_type, pattern, meaning, account_id, counter_account_id) VALUES (5, 'content', 'GUI PHAO', 'transfer', 'vcb-husband', 'buffer-wife')").run();
    await ingestLog(db, log({ id: "R1", content: "GUI PHAO THANG 10" }), "webhook", now);
    expect(lastTx()).toEqual({ wallet_id: "wealth-building", counter_wallet_id: "nice-to-have", account_id: "vcb-husband", counter_account_id: "buffer-wife" });
  });
});

describe("cấu hình tài khoản Tích sản (ADR-88)", () => {
  it("thêm phao: không khóa, mặc định không tính vào tiền chi được; sổ tiết kiệm: khóa; heo không thêm tay được; sổ không bật tính được", async () => {
    expect(raw.prepare("SELECT id, role, locked, spendable FROM accounts WHERE role IS NOT NULL ORDER BY id").all()).toEqual([
      { id: "buffer-wife", role: "buffer", locked: 0, spendable: 0 },
      { id: "term-deposit-6m", role: "term_deposit", locked: 1, spendable: 0 },
    ]);
    await rejects(createAccount(db, { name: "Heo mới", role: "piggy_bank" }), "invalid_role");
    await rejects(createAccount(db, { name: "Sổ 3 tháng", role: "term_deposit", spendable: true }), "locked_account");
    await rejects(createAccount(db, { name: "Lạ", role: "quy" }), "invalid_input");
    // Giá trị vai cũ (trước 0028) không còn nhận.
    for (const role of ["heo", "phao", "so-tiet-kiem"]) await rejects(createAccount(db, { name: "Cũ", role: role as never }), "invalid_input");
    await rejects(updateAccount(db, "cash-husband", { role: "phao" as never }), "invalid_input");
  });

  it("đổi qua lại tài khoản thường ↔ phao (sang phao thì tắt tính vào tiền chi được); heo / sổ giữ vai trò", async () => {
    expect(await updateAccount(db, "cash-husband", { role: "buffer" })).toMatchObject({ role: "buffer", spendable: false, locked: false });
    expect(await updateAccount(db, "cash-husband", { role: null, spendable: true })).toMatchObject({ role: null, spendable: true });
    await rejects(updateAccount(db, "term-deposit-6m", { role: null }), "invalid_role");
    await rejects(updateAccount(db, "cash-husband", { role: "term_deposit" }), "invalid_role");
    await rejects(updateAccount(db, "cash-husband", { role: "piggy_bank" }), "invalid_role");
    expect(await updateAccount(db, "term-deposit-6m", { name: "Sổ 6 tháng (MB)" })).toMatchObject({ name: "Sổ 6 tháng (MB)", role: "term_deposit" });
  });
});

describe("số dư có sẵn của tài khoản Tích sản vào Tích sản (ADR-91)", () => {
  const openings = () => raw.prepare("SELECT amount, wallet_id, counter_wallet_id, account_id, counter_account_id, source, batch_id, note FROM transactions WHERE batch_id LIKE 'O:%' ORDER BY id").all();
  const wealthBuildingCash = async () => (await snap()).tiers.wealth_building.cash;

  it("thêm phao có số dư đầu 500.000: Tích sản +500.000 bằng một bút toán hệ thống không ví nguồn; Có thì tốt, sổ tài khoản, Tiền chi được không đổi; không số dư hay tài khoản thường thì không ghi", async () => {
    const before = await snap();
    await createAccount(db, { id: "buffer-2", name: "Phao VCB", bank: "MBBank", owner_member_id: "husband", role: "buffer", opening_balance: 500_000 });
    expect(openings()).toEqual([
      { amount: 500_000, wallet_id: "wealth-building", counter_wallet_id: null, account_id: null, counter_account_id: null, source: "system", batch_id: expect.stringMatching(/^O:buffer-2:/), note: "Số dư có sẵn khi mở Phao VCB → Tích sản" },
    ]);
    const after = await snap();
    expect(after.tiers.wealth_building.cash).toBe(before.tiers.wealth_building.cash + 500_000);
    expect(after.tiers.have.balance).toBe(before.tiers.have.balance);
    expect(after.spendableCash.amount).toBe(before.spendableCash.amount);
    expect(book("buffer-2")).toBe(500_000);
    expect((await wealthBuildingBreakdown(db)).flows).toEqual([expect.objectContaining({ kind: "opening", direction: "in", count: 1, amount: 500_000 })]);

    await createAccount(db, { id: "buffer-3", name: "Phao rỗng", role: "buffer", opening_balance: 0 });
    await createAccount(db, { id: "vcb-2", name: "VCB thường", bank: "MBBank", opening_balance: 300_000 });
    expect(openings()).toHaveLength(1);
  });

  it("Tích sản 300.000 đang ở tài khoản thường: thêm sổ 1.000.000 chỉ ghi 700.000 — Tiền chi được như khi thêm sổ mà không ghi gì", async () => {
    await createEntry(db, { meaning: "transfer", amount: 300_000, wallet_id: "wealth-building", from_wallet_id: "nice-to-have" }, "wife", now);
    await createAccount(db, { id: "term-deposit-12m", name: "Sổ 12 tháng", role: "term_deposit", opening_balance: 1_000_000 });
    expect(openings()).toMatchObject([{ amount: 700_000 }]);
    const s = await snap();
    expect(s.tiers.wealth_building.cash).toBe(1_000_000);
    // ADR-88 đã coi 300.000 Tích sản là nằm ở sổ; bút toán chỉ thêm phần còn lại nên không còn Tích sản phải trừ.
    expect(s.spendableCash.wealthBuildingHeld).toBe(0);
    expect(s.spendableCash.wealthBuildingOutside).toBe(1_000_000);
  });

  it("đổi tài khoản thường có 200.000 sang phao: ghi 200.000; về thường không gỡ; sang phao lần nữa không ghi thêm; sang phao mà vẫn tính vào tiền chi được thì không ghi", async () => {
    raw.prepare("UPDATE accounts SET opening_balance = 200000 WHERE id = 'cash-husband'").run();
    const spendable = (await snap()).spendableCash.amount;
    await updateAccount(db, "cash-husband", { role: "buffer" });
    expect(openings()).toMatchObject([{ amount: 200_000, batch_id: expect.stringMatching(/^O:cash-husband:/) }]);
    expect(await wealthBuildingCash()).toBe(200_000);
    // Tài khoản rời "đang tính" (200.000 không tiêu được nữa); bút toán không làm tiền chi được giảm thêm.
    expect((await snap()).spendableCash.amount).toBe(spendable - 200_000);

    await updateAccount(db, "cash-husband", { role: null, spendable: true });
    expect(await wealthBuildingCash()).toBe(200_000);
    await updateAccount(db, "cash-husband", { role: "buffer" });
    expect(openings()).toHaveLength(1);

    expect(await updateAccount(db, "cash-wife", { role: "buffer", spendable: true })).toMatchObject({ role: "buffer", spendable: true });
    expect(openings()).toHaveLength(1);
  });
});
