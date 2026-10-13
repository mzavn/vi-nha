import { describe, expect, it } from "vitest";
import { checkSplit, prefillSplit, setSplitAmount, splitOrders, splitPayload, splitWallets } from "./manual-split";
import type { AllocationPlan, Wallet } from "./types";

const w = (id: string, name: string, tier: Wallet["tier"], accountId: string, sort: number): Wallet => ({
  id,
  name,
  tier,
  mustGroup: tier === "must" ? "must" : null,
  kind: tier === "holding" ? "holding" : "envelope",
  scope: "shared",
  memberId: null,
  accountId,
  private: false,
  sort,
  hidden: false,
});

// Số mẫu: thứ tự như danh sách ví (theo sort) — Thu nhập đứng đầu, Tích sản sau Thuế để thấy Tích sản được đưa lên đầu.
const WALLETS: Wallet[] = [
  w("income", "Thu nhập", "holding", "vcb-a", 0),
  w("rental-income", "Thu cho thuê", "holding", "vcb-a", 5),
  w("tax", "Thuế", "tax", "mb-a", 8),
  w("wealth-building", "Tích sản", "wealth_building", "tcb-a", 10),
  w("housing", "Nhà ở", "must", "vcb-a", 40),
  w("gym", "Tập luyện", "must", "vcb-a", 41),
  w("food", "Ăn uống", "must", "vcb-a", 42),
  w("utilities", "Điện nước", "must", "vcb-a", 43),
  w("debt", "Trả nợ", "must", "tcb-a", 44),
  w("transport", "Đi lại", "must", "vcb-b", 45),
  w("travel", "Du lịch", "nice", "vcb-a", 50),
];

const PLAN: AllocationPlan = {
  funds: [
    { walletId: "wealth-building", amount: 5_700_000 },
    { walletId: "housing", amount: 8_000_000 },
    { walletId: "food", amount: 5_300_000 },
  ],
  underfunded: [],
  deficitCovered: {},
  transferOrders: [],
};

const AC6: Record<string, number> = {
  "wealth-building": 200_000,
  housing: 7_500_000,
  gym: 1_500_000,
  food: 5_000_000,
  utilities: 1_600_000,
  debt: 2_700_000,
  transport: 500_000,
};

function typed(values: Record<string, number>) {
  let split = prefillSplit(PLAN, WALLETS);
  for (const id of Object.keys(split.amounts)) split = setSplitAmount(split, id, values[id] ?? 0, true);
  return split;
}

describe("tự chia một khoản thu (change 261012-tu-chia)", () => {
  it("UC-202 AC-6: mỗi ví đang dùng một ô (trừ ví giữ tiền), Tích sản đứng đầu, điền sẵn số của bảng chia theo luật, ví không có trong bảng thì 0", () => {
    expect(splitWallets(WALLETS).map((x) => x.id)).toEqual(["wealth-building", "tax", "housing", "gym", "food", "utilities", "debt", "transport", "travel"]);
    expect(prefillSplit(PLAN, WALLETS)).toEqual({
      amounts: { "wealth-building": 5_700_000, tax: 0, housing: 8_000_000, gym: 0, food: 5_300_000, utilities: 0, debt: 0, transport: 0, travel: 0 },
      invalid: [],
    });
  });

  it("UC-202 AC-6: gõ đủ 19.000.000 → chân \"Đã chia 19.000.000 / 19.000.000\", được ghi; gửi đúng các số > 0; lệnh chuyển gộp theo tài khoản đích của ví", () => {
    const split = typed(AC6);
    expect(checkSplit(split, WALLETS, 19_000_000)).toEqual({ done: "Đã chia 19.000.000 / 19.000.000", rest: null, over: false, ok: true, reminder: null });
    expect(splitPayload(split)).toEqual(Object.entries(AC6).map(([wallet_id, amount]) => ({ wallet_id, amount })));
    expect(splitOrders(split, WALLETS, "vcb-a")).toEqual([
      { fromAccountId: "vcb-a", toAccountId: "tcb-a", amount: 2_900_000, walletIds: ["wealth-building", "debt"] },
      { fromAccountId: "vcb-a", toAccountId: "vcb-b", amount: 500_000, walletIds: ["transport"] },
    ]);
  });

  it("UC-202 AC-7: tổng khác khoản thu → không ghi được, chân nói còn / vượt bao nhiêu", () => {
    const less = checkSplit(typed({ ...AC6, transport: 499_000 }), WALLETS, 19_000_000);
    expect(less).toMatchObject({ done: "Đã chia 18.999.000 / 19.000.000", rest: "còn 1.000", over: false, ok: false });
    const more = checkSplit(typed({ ...AC6, transport: 600_000 }), WALLETS, 19_000_000);
    expect(more).toMatchObject({ done: "Đã chia 19.100.000 / 19.000.000", rest: "chia vượt 100.000", over: true, ok: false });
  });

  it("UC-202 AC-7: ô có phép tính sai (âm, không ra số) → không ghi được dù tổng khớp; sửa lại ô thì hết lỗi", () => {
    const wrong = setSplitAmount(typed(AC6), "transport", 0, false);
    expect(wrong.invalid).toEqual(["transport"]);
    expect(checkSplit(setSplitAmount(wrong, "food", 5_500_000, true), WALLETS, 19_000_000).ok).toBe(false);
    expect(checkSplit(setSplitAmount(wrong, "transport", 500_000, true), WALLETS, 19_000_000)).toMatchObject({ ok: true, rest: null });
  });

  it("UC-202 AC-7: Tích sản 0 → câu nhắc, vẫn ghi được nếu tổng khớp", () => {
    const check = checkSplit(typed({ ...AC6, "wealth-building": 0, food: 5_200_000 }), WALLETS, 19_000_000);
    expect(check).toMatchObject({ ok: true, reminder: "Tháng này chưa để dành Tích sản" });
  });
});
