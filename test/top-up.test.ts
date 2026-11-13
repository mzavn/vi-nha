// Nhắc chuyển thêm vào tiền chi tiêu (ledger UC-103 bước 7b, ADR-141, QĐ3: Ví Thưởng trước) — hàm thuần `topUpView`.
import { describe, expect, it } from "vitest";
import type { MonthView } from "../src/domain/month-tasks";
import { pocketsView, type PocketAccount, type PocketGoalInput } from "../src/domain/pockets";
import { topUpView } from "../src/domain/snapshot";

const acct = (id: string, pocket: PocketAccount["pocket"], balance: number, parentId: string | null = null): PocketAccount => ({ id, name: id, pocket, balance, confirmed: true, parentId });
const monthly = (id: string, amount: number, sort: number): PocketGoalInput => ({
  id, name: id, accountId: null, target: amount, targetPct: null, monthly: amount, repeatMonths: 1, dueDate: null, debtId: null, sort, spent: 0, paysFrom: "operating",
});
/** Bốn khoản trả từ tiền chi tiêu cộng 4.500.000, đã trả Điện nước 1.000.000 → R 3.500.000; chi vận hành tháng 10 13.500.000 / 31 ngày. */
const pockets = (operating: PocketAccount[], spendMonths = [{ start: "2026-10-01", amount: 13_500_000, days: 31 }]) =>
  pocketsView({
    accounts: [...operating, acct("tk-bidv", "reserve", 2_000_000), acct("phao", "reserve", 4_000_000), acct("gui-3-thang", "reserve", 20_000_000, "phao"), acct("tich-luy", "savings", 50_000_000)],
    goals: [{ ...monthly("dien-nuoc", 2_000_000, 10), spent: 1_000_000 }, monthly("thuoc", 500_000, 20), monthly("thien-phuoc", 1_000_000, 30), monthly("ve-que", 1_000_000, 40)],
    rewardAccountId: "tk-bidv",
    debts: [],
    savingsPct: 10,
    history: { since: "2026-11-01", prevSince: "2026-10-01", accounts: [] },
    operatingSpend: { months: spendMonths, dataStart: spendMonths.length ? "2026-10-01" : null },
    peaceTarget: 6,
  });
/** Việc chia dư → Ví Thưởng 600.000 đang mở. */
const month = { tasks: [{ kind: "surplus", status: "open", toAccountId: "tk-bidv", missing: 600_000 }] } as unknown as Pick<MonthView, "tasks">;
const target = { accountId: "tk-chi-tieu-chong", name: "MB chi tiêu chồng", bank: "MB", accountNo: "0123456789", subAccount: null };

describe("nhắc chuyển thêm (topUpView)", () => {
  it("UC-103 AC-25: Vận hành 1.000.000, R 3.500.000 → thiếu 2.500.000 — nguồn tk-bidv 2.000.000 rồi phao 500.000, đích tài khoản chi tiêu; việc chia dư → Ví Thưởng không vào need; không ăn tiêu ước tính (có hay không chi trung bình cùng kết quả); không gợi ý khoản gửi, tích luỹ; Vận hành đủ R → null; chỉ tiền mặt → không đích", () => {
    const p = pockets([acct("tk-chi-tieu-chong", "operating", 1_000_000)]);
    expect(p.operating.remaining).toBe(3_500_000);
    const base = { amount: 1_000_000, pendingTasks: 600_000, month, goalRemaining: 3_500_000, pockets: p, target };
    expect(topUpView(base)).toEqual({
      amount: 2_500_000,
      sources: [
        { accountId: "tk-bidv", name: "tk-bidv", amount: 2_000_000 },
        { accountId: "phao", name: "phao", amount: 500_000 },
      ],
      toAccountId: "tk-chi-tieu-chong",
      target,
    });
    const after = pockets([acct("tk-chi-tieu-chong", "operating", 3_500_000)]);
    expect(topUpView({ ...base, amount: 3_500_000, pockets: after })).toBeNull();
    const noData = pockets([acct("tk-chi-tieu-chong", "operating", 1_000_000)], []);
    expect(topUpView({ ...base, pockets: noData })).toEqual(topUpView(base));
    expect(topUpView({ ...base, target: null })).toMatchObject({ toAccountId: null, target: null });
  });

  it("UC-103 AC-25: làm tròn lên 100.000; nguồn không đủ → tổng nguồn nhỏ hơn số cần (phần còn lại chưa có nguồn)", () => {
    const p = pockets([acct("tk-chi-tieu-chong", "operating", 4_000_000)]);
    const t = topUpView({ amount: 1_950_000, pendingTasks: 5_000_000, month: null, goalRemaining: 3_500_000, pockets: p, target });
    expect(t?.amount).toBe(6_600_000);
    expect(t?.sources).toEqual([
      { accountId: "tk-bidv", name: "tk-bidv", amount: 2_000_000 },
      { accountId: "phao", name: "phao", amount: 4_000_000 },
    ]);
  });
});
