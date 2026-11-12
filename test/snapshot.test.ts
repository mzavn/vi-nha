// Snapshot có khối `pockets` (ledger UC-103 AC-19, pocket UC-1203): số ba ngăn đúng, mọi trường khác trừ `nearSpend` không đổi vì
// ngăn; không còn trường theo ví; Tích luỹ theo kỳ, phần an tâm theo tháng vận hành, thứ tự mục tiêu trên hộ mẫu B (Đợt B, E).
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "../src/domain/snapshot";
import { getSnapshot } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { B_NOW, householdB, tx, vnAt } from "./helpers/household-b";
import { householdParent, householdTopUp, PARENT_NOW, parentTx } from "./helpers/household-parent";

const NOW = new Date("2026-11-12T03:00:00Z");
const withoutPockets = ({ pockets: _, nearSpend: __, ...rest }: Snapshot) => rest;

/** Hộ mẫu với số dư như UC-1203 AC-1 và một khoản nợ ngắn hạn — phần ảnh hưởng tới các số cũ. */
function household(): DatabaseSync {
  const raw = openDb();
  raw.exec(`
    UPDATE accounts SET opening_balance = 3000000 WHERE id = 'vcb-husband';
    UPDATE accounts SET opening_balance = 10000000 WHERE id = 'mb-husband';
    UPDATE accounts SET opening_balance = 6000000 WHERE id = 'tcb-husband';
    INSERT INTO accounts (id, name, kind, opening_balance) VALUES
      ('card', 'Thẻ tín dụng', 'credit', -800000), ('piggy', 'Heo đất', 'bank', 500000), ('momo', 'Ví điện tử', 'ewallet', 200000);
    INSERT INTO debts (id, name, term, monthly_payment, due_day) VALUES ('family', 'Vay người thân', 'short', 1000000, 15);
    INSERT INTO debt_lines (debt_id, at, kind, amount) VALUES ('family', '2026-10-01', 'opening', 5000000);
  `);
  return raw;
}

describe("snapshot.pockets", () => {
  it("UC-103 AC-19: GET /v1/snapshot có pockets đúng số UC-1203 AC-1 (gồm shortDebt) và không có trường nào theo ví; mọi trường khác trừ nearSpend bằng đúng khi chưa xếp ngăn", async () => {
    const raw = household();
    const db = asD1(raw);
    const before = await getSnapshot(db, "husband", NOW);

    raw.exec(`
      UPDATE accounts SET pocket = 'reserve' WHERE id = 'mb-husband';
      UPDATE accounts SET pocket = 'savings' WHERE id IN ('tcb-husband', 'piggy');
      UPDATE accounts SET pocket = 'operating' WHERE id = 'card';
    `);
    const after = await getSnapshot(db, "husband", NOW);

    expect(withoutPockets(after)).toEqual(withoutPockets(before));
    for (const k of ["tiers", "wallets", "spendableThisWeek", "spendableByWallet", "reserves", "safetyFund", "goals", "wealthBuilding"]) expect(after).not.toHaveProperty(k);
    const p = after.pockets;
    expect([p.savings.total, p.reserve.total, p.reserve.peace, p.operating.total, p.outside.total]).toEqual([6_500_000, 10_000_000, 10_000_000, 2_200_000, 200_000]);
    const book = raw.prepare("SELECT SUM(book_balance) AS s FROM v_account_book").get() as { s: number };
    expect(p.savings.total + p.reserve.total + p.operating.total + p.outside.total).toBe(book.s);
    expect(book.s).toBe(18_900_000);
    expect(p.reserve.accounts.find((a) => a.id === "mb-husband")).toEqual({ id: "mb-husband", name: "MB (Thuế)", balance: 10_000_000, goalIds: [], parentId: null });
    expect(p.reserve.accounts.find((a) => a.id === "mb-tuition")).toEqual({ id: "mb-tuition", name: "MB (học phí)", balance: 0, goalIds: ["tuition"], parentId: null });
    expect(p.reserve.reward).toEqual({ accountId: "mb-reward", balance: 0 });
    expect(p.operating.accounts.find((a) => a.id === "card")).toEqual({ id: "card", name: "Thẻ tín dụng", balance: -800_000, goalIds: [], parentId: null });
    expect(p.outside.accounts.map((a) => a.id)).toEqual(["momo"]);
    expect(p.reserve.goals.map((g) => [g.id, g.accountId, g.held, g.target, g.targetPct])).toEqual([
      ["tuition", "mb-tuition", 0, 6_000_000, null],
      ["car-service", null, null, 4_800_000, null],
      ["income-tax", null, null, null, 10],
    ]);
    expect(p.savings).not.toHaveProperty("holds");
    expect(p.savingsPct).toBe(30);
    expect(p.unconfirmed).toBe(3);
    expect(p.shortDebt).toEqual({
      total: 5_000_000,
      count: 1,
      items: [{ id: "family", name: "Vay người thân", balance: 5_000_000, monthlyPayment: 1_000_000, dueDay: 15, goalId: null, heldFor: 0 }],
    });
  });

  const pocketsAt = async (raw: DatabaseSync, now = B_NOW) => (await getSnapshot(asD1(raw), null, now)).pockets;

  it("UC-1203 AC-5: hộ mẫu B → savings.change { since 10/11, +800.000, prevSince 10/10, +700.000 }; thêm tài khoản có số dư đầu, đổi ngăn tài khoản không có giao dịch → change không đổi", async () => {
    const raw = householdB();
    expect((await pocketsAt(raw)).savings).toMatchObject({ total: 6_500_000, change: { since: "2026-11-10", amount: 800_000, prevSince: "2026-10-10", prevAmount: 700_000 } });

    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance, pocket, pocket_confirmed) VALUES ('new-saving', 'tài khoản mới', 'bank', 1000000, 'savings', 1)");
    expect((await pocketsAt(raw)).savings).toMatchObject({ total: 7_500_000, change: { amount: 800_000, prevAmount: 700_000 } });

    raw.exec("UPDATE accounts SET pocket = 'savings' WHERE id = 'vcb-wife'");
    expect((await pocketsAt(raw)).savings).toMatchObject({ total: 8_900_000, change: { amount: 800_000, prevAmount: 700_000 } });
  });

  it("UC-1203 AC-5: tài khoản Tích luỹ có 1.000.000 lúc đầu kỳ, hôm nay chuyển hết rồi tắt → −1.000.000; kỳ trước không đổi", async () => {
    const raw = householdB();
    raw.exec("INSERT INTO accounts (id, name, kind, opening_balance, pocket, pocket_confirmed) VALUES ('old-saving', 'tài khoản tích luỹ cũ', 'bank', 1000000, 'savings', 1)");
    tx(raw, { at: "2026-11-11 08:00", meaning: "transfer", amount: 1_000_000, from: "old-saving", to: "vcb-husband" });
    raw.exec("UPDATE accounts SET active = 0, deactivated_at = '2026-11-11' WHERE id = 'old-saving'");
    expect((await pocketsAt(raw)).savings).toMatchObject({ total: 6_500_000, change: { amount: -200_000, prevAmount: 700_000 } });
  });

  it("UC-1203 AC-5: hôm nay đúng ngày lương 10/12, trong ngày chưa có gì → since 10/12, amount 0, prevSince 10/11", async () => {
    const raw = householdB();
    expect((await pocketsAt(raw, new Date("2026-12-10T03:00:00Z"))).savings.change).toEqual({ since: "2026-12-10", amount: 0, prevSince: "2026-11-10", prevAmount: 800_000 });
  });

  it("UC-1203 AC-6: hộ mẫu B → phần an tâm 31.500.000, { covered 3,2, target 6, monthly 9.782.608, cycles 3 } (92 ngày); chi từ tài khoản Dự phòng và chi kỳ đang chạy không tính; hoàn vào tài khoản chính (counter_account_id) trừ đi; dữ liệu từ 15/8 → bỏ kỳ 10/8", async () => {
    const raw = householdB();
    expect((await pocketsAt(raw)).reserve).toMatchObject({ total: 38_000_000, peace: 31_500_000, peaceMonths: { covered: 3.2, target: 6, monthly: 9_782_608, cycles: 3 } });

    tx(raw, { at: "2026-10-25 09:00", meaning: "spend", amount: 2_000_000, from: "mb-husband" });
    tx(raw, { at: "2026-11-10 09:00", meaning: "spend", amount: 3_000_000, from: "vcb-husband" });
    expect((await pocketsAt(raw)).reserve.peaceMonths.monthly).toBe(9_782_608);

    tx(raw, { at: "2026-09-28 09:00", meaning: "refund", amount: 500_000, to: "vcb-husband" });
    expect((await pocketsAt(raw)).reserve.peaceMonths).toMatchObject({ monthly: Math.floor(((9_000_000 + 10_000_000 + 10_500_000) * 30) / 92), cycles: 3 });

    raw.prepare("UPDATE transactions SET status = 'void' WHERE meaning = 'refund'").run();
    raw.prepare("UPDATE transactions SET at = ? WHERE at = ?").run(vnAt("2026-08-15 09:00"), vnAt("2026-07-01 09:00"));
    expect((await pocketsAt(raw)).reserve.peaceMonths).toEqual({ covered: 2.8, target: 6, monthly: Math.floor((21_000_000 * 30) / 61), cycles: 2 });
  });

  it("UC-1203 AC-9: tháng vận hành theo kỳ lưu, chuẩn hoá theo ngày — 9.782.608; khoản 07:00 ngày lương thuộc kỳ danh nghĩa trước; tháng không lương giữ kỳ trọn cũ; kỳ lưu ngắn 24 ngày", async () => {
    const raw = householdB();
    // Kỳ lưu 2026-10-10 mở 08:00 (lương tx), kỳ 2026-11-10 mở 08:00; khoản 500.000 lúc 2026-10-10 07:00 (kỳ danh nghĩa 10/9).
    raw.exec("UPDATE transactions SET status = 'void' WHERE meaning = 'spend'");
    tx(raw, { at: "2026-08-20 12:00", meaning: "spend", amount: 11_000_000, from: "vcb-husband" });
    tx(raw, { at: "2026-09-20 12:00", meaning: "spend", amount: 8_500_000, from: "vcb-husband" });
    tx(raw, { at: "2026-10-10 07:00", meaning: "spend", amount: 500_000, from: "vcb-husband" });
    tx(raw, { at: "2026-10-20 12:00", meaning: "spend", amount: 10_000_000, from: "vcb-husband" });
    tx(raw, { at: "2026-07-25 09:00", meaning: "transfer", amount: 1, from: "vcb-husband", to: "tcb-husband" }); // dữ liệu Vận hành có từ trước 10/8
    const salary = (id: number, at: string, payday: string) => {
      raw
        .prepare("INSERT INTO transactions (id, at, amount, meaning, counter_account_id, week_key, month_key, source) VALUES (?, ?, 20000000, 'income', 'vcb-husband', 'W', 'M', 'manual')")
        .run(id, vnAt(at));
      raw.prepare("INSERT INTO pay_cycles (income_tx_id, started_at, payday, prev_operating) VALUES (?, ?, ?, 0)").run(id, vnAt(at), payday);
    };
    salary(900, "2026-10-10 08:00", "2026-10-10");
    salary(901, "2026-11-10 08:00", "2026-11-10");
    expect((await pocketsAt(raw, new Date(vnAt("2026-11-25 10:00")))).reserve.peaceMonths).toMatchObject({ cycles: 3, monthly: 9_782_608 });
    // Tháng 12 không có lương, hôm nay 2027-01-05: kỳ 2026-11-10 vẫn đang chạy → ba kỳ trọn như cũ.
    expect((await pocketsAt(raw, new Date(vnAt("2027-01-05 10:00")))).reserve.peaceMonths).toMatchObject({ cycles: 3, monthly: 9_782_608 });
    // Kỳ lưu ngắn: kỳ kế mở sớm 2026-11-03 08:00 (24 ngày, chi 8.000.000).
    raw.exec("UPDATE transactions SET amount = 8000000 WHERE status = 'active' AND meaning = 'spend' AND amount = 10000000");
    raw.exec("UPDATE pay_cycles SET status = 'void' WHERE payday = '2026-11-10'");
    salary(902, "2026-11-03 08:00", "2026-11-10");
    expect((await pocketsAt(raw, new Date(vnAt("2026-11-25 10:00")))).reserve.peaceMonths).toMatchObject({ cycles: 3, monthly: 9_882_352 });
  });

  it("UC-1203 AC-7: hộ mẫu B → reserve.goals theo hạn: Trả nợ Vay người thân, Học phí, Bảo dưỡng xe, Thuế", async () => {
    expect((await pocketsAt(householdB())).reserve.goals.map((g) => g.name)).toEqual(["Trả nợ Vay người thân", "Học phí", "Bảo dưỡng xe", "Thuế"]);
  });
});

// Mục tiêu trả thẳng từ tiền chi tiêu (ADR-141): chừa phần còn phải trả khỏi "Chi khoảng X/ngày", nhắc chuyển thêm khi thiếu.
describe("snapshot: phần còn phải trả và nhắc chuyển thêm (ledger UC-103 bước 7b)", () => {
  const snap = async (raw: DatabaseSync) => getSnapshot(asD1(raw), null, PARENT_NOW);

  it("UC-103 AC-24: Vận hành 15.000.000, 20 ngày, R 3.500.000 → goalRemaining 3.500.000, perDay 575.000 (không phải 750.000); chi đủ 3.500.000 gắn mục tiêu → amount 11.500.000, goalRemaining 0, perDay vẫn 575.000; Vận hành 3.000.000 với R 3.500.000 → perDay null", async () => {
    const raw = householdParent({ operating: 16_000_000, operatingGoals: true });
    parentTx(raw, { at: "2026-11-15 09:00", meaning: "spend", amount: 1_000_000, from: "tk-chi-tieu-vo", goal: "dien-nuoc" });
    let s = await snap(raw);
    expect(s.nearSpend).toMatchObject({ amount: 15_000_000, daysLeft: 20, goalRemaining: 3_500_000, perDay: 575_000, pendingTasks: 0 });

    for (const [goal, amount] of [["dien-nuoc", 1_000_000], ["thuoc", 500_000], ["thien-phuoc", 1_000_000], ["ve-que", 1_000_000]] as const) {
      parentTx(raw, { at: "2026-11-20 09:00", meaning: "spend", amount, from: "cash-husband", goal });
    }
    s = await snap(raw);
    expect(s.nearSpend).toMatchObject({ amount: 11_500_000, goalRemaining: 0, perDay: 575_000 });

    const low = householdParent({ operating: 4_000_000, operatingGoals: true });
    parentTx(low, { at: "2026-11-15 09:00", meaning: "spend", amount: 1_000_000, from: "tk-chi-tieu-vo", goal: "dien-nuoc" });
    expect((await snap(low)).nearSpend).toMatchObject({ amount: 3_000_000, goalRemaining: 3_500_000, perDay: null });
  });

  it("UC-103 AC-25: Vận hành 1.000.000, R 3.500.000, ④ → Ví Thưởng 600.000 đang mở → topUp 2.500.000 từ BIDV 2.000.000 rồi Phao 500.000, đích Chi tiêu chồng (không Gửi 3 tháng, không Tích luỹ); chuyển đủ → null; không có chi trung bình → cùng kết quả (không ăn tiêu ước tính); chỉ tiền mặt → không đích", async () => {
    const raw = householdTopUp({ history: true });
    let s = await snap(raw);
    expect(s.pockets.reserve.peaceMonths.monthly).toBe(13_500_000);
    expect(s.nearSpend).toMatchObject({ amount: 1_000_000, goalRemaining: 3_500_000 });
    expect(s.topUp).toEqual({
      amount: 2_500_000,
      sources: [
        { accountId: "tk-bidv", name: "BIDV", amount: 2_000_000 },
        { accountId: "phao", name: "Phao", amount: 500_000 },
      ],
      toAccountId: "tk-chi-tieu-chong",
      target: { accountId: "tk-chi-tieu-chong", name: "Chi tiêu chồng", bank: "Vietcombank", accountNo: "01010000001", subAccount: null },
    });

    parentTx(raw, { at: "2026-11-20 09:00", meaning: "transfer", amount: 2_000_000, from: "tk-bidv", to: "tk-chi-tieu-chong" });
    parentTx(raw, { at: "2026-11-20 09:05", meaning: "transfer", amount: 500_000, from: "phao", to: "tk-chi-tieu-chong" });
    expect((await snap(raw)).topUp).toBeNull();

    expect((await snap(householdTopUp({ history: false }))).topUp).toEqual(s.topUp);

    const cashOnly = householdTopUp({ history: true });
    cashOnly.exec("UPDATE accounts SET account_no = NULL WHERE id IN ('tk-chi-tieu-chong', 'tk-chi-tieu-vo')");
    expect((await snap(cashOnly)).topUp).toMatchObject({ amount: 2_500_000, toAccountId: null, target: null });
  });
});
