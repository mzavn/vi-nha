import { describe, expect, it } from "vitest";
import { budgetTotals, coverPrefill, moveProblem, moveWallets, orderSpendable } from "./budget";
import type { BudgetLine, Wallet } from "./types";

const line = (walletId: string, tier: BudgetLine["tier"], target: number | null, spent: number | null): BudgetLine => ({
  walletId,
  name: walletId,
  tier,
  mustGroup: tier === "must" ? "must" : null,
  target,
  spent,
  remaining: target === null || spent === null ? null : target - spent,
});

const wallet = (id: string, patch: Partial<Wallet> = {}): Wallet => ({
  id,
  name: id,
  tier: "must",
  mustGroup: "must",
  kind: "envelope",
  scope: "shared",
  memberId: null,
  accountId: null,
  private: false,
  hidden: false,
  sort: 50,
  ...patch,
});

describe("dòng Tổng của bảng ngân sách", () => {
  it("chỉ cộng ví chi tiêu, bỏ Tích sản / Thuế và ô ẩn số", () => {
    const t = budgetTotals([
      line("wealth-building", "wealth_building", 4_950_000, 0),
      line("food", "must", 7_000_000, 7_300_000),
      line("shopping", "nice", 500_000, 120_000),
      line("fun-wife", "nice", null, null),
    ]);
    expect(t).toEqual({ target: 7_500_000, spent: 7_420_000, remaining: 80_000 });
  });

  it("không có ví chi tiêu thì không có dòng Tổng", () => {
    expect(budgetTotals([line("wealth-building", "wealth_building", 1, 0)])).toBeNull();
  });
});

describe("các phong bì dưới số còn để chi tuần này", () => {
  it("ví âm lên đầu, âm nhiều nhất trước; ví còn dư giữ thứ tự server (kể cả ví bằng 0)", () => {
    const parts = [
      { walletId: "food", amount: -415_000 },
      { walletId: "transport", amount: 32_600 },
      { walletId: "fitness", amount: 576_000 },
      { walletId: "other", amount: 0 },
      { walletId: "shopping", amount: -650_000 },
    ];
    expect(orderSpendable(parts).map((p) => p.walletId)).toEqual(["shopping", "food", "transport", "fitness", "other"]);
    expect(parts[0]!.walletId).toBe("food"); // không sửa mảng gốc của snapshot
  });
});

describe("chuyển ngân sách", () => {
  const wallets = [
    wallet("income", { tier: "holding", kind: "holding", mustGroup: null }),
    wallet("rental-income", { tier: "holding", kind: "accrual", mustGroup: null }),
    wallet("wealth-building", { tier: "wealth_building", kind: "accrual", mustGroup: null }),
    wallet("food"),
    wallet("other", { mustGroup: "have" }),
    wallet("shopping", { tier: "nice", mustGroup: null }),
    wallet("fun-wife", { tier: "nice", mustGroup: null, scope: "personal", memberId: "wife" }),
  ];

  it("không bao giờ dùng ví Thu nhập; Tích sản chỉ nhận; ví riêng người kia bị ẩn", () => {
    expect(moveWallets(wallets, "husband", "from").map((w) => w.id)).toEqual(["rental-income", "food", "other", "shopping"]);
    expect(moveWallets(wallets, "wife", "to").map((w) => w.id)).toEqual(["rental-income", "wealth-building", "food", "other", "shopping", "fun-wife"]);
  });

  it("Bù ví âm: số = phần âm, nguồn ưu tiên Có thì tốt còn dư", () => {
    const d = coverPrefill("food", -300_000, wallets, { food: -300_000, other: 225_000, "shopping": 900_000 }, "husband");
    expect(d).toEqual({ fromWalletId: "other", toWalletId: "food", amount: 300_000 });
  });

  it("Có thì tốt hết tiền thì lấy ví chi tiêu còn dư nhiều nhất, không đụng ví giữ riêng", () => {
    const d = coverPrefill("food", -300_000, wallets, { food: -300_000, other: 0, "shopping": 900_000, "rental-income": 5_000_000 }, "husband");
    expect(d.fromWalletId).toBe("shopping");
  });

  it("không ví nào dư thì vẫn đề xuất Có thì tốt", () => {
    expect(coverPrefill("food", -1, wallets, {}, "husband").fromWalletId).toBe("other");
  });

  it("lý do chưa chuyển được", () => {
    expect(moveProblem({ fromWalletId: "other", toWalletId: "food", amount: 0 })).toBe("Nhập số tiền");
    expect(moveProblem({ fromWalletId: null, toWalletId: "food", amount: 1 })).toBe("Chọn hai ví");
    expect(moveProblem({ fromWalletId: "food", toWalletId: "food", amount: 1 })).toBe("Hai ví phải khác nhau");
    expect(moveProblem({ fromWalletId: "other", toWalletId: "food", amount: 1 })).toBeNull();
  });
});
