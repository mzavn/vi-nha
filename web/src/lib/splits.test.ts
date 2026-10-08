import { describe, expect, it } from "vitest";
import { ASSIGN_CHOICES, assignToast, deferredIncomeToast, validateSplits, type SplitMeaning } from "./splits";

describe("tách log: tổng phải khớp số tiền log", () => {
  it("khớp đúng thì cho gán", () => {
    const r = validateSplits(250_000, [
      { meaning: "spend", amount: 180_000, category_id: "groceries" },
      { meaning: "spend", amount: 70_000, category_id: "hangouts" },
    ]);
    expect(r).toEqual({ ok: true, sum: 250_000, diff: 0, message: null });
  });

  it("thiếu thì chặn và nói thiếu bao nhiêu", () => {
    const r = validateSplits(250_000, [{ meaning: "spend", amount: 200_000, category_id: "food" }]);
    expect(r.ok).toBe(false);
    expect(r.diff).toBe(50_000);
    expect(r.message).toBe("Còn thiếu 50.000 ₫ so với log.");
  });

  it("thừa thì chặn", () => {
    const r = validateSplits(100_000, [
      { meaning: "spend", amount: 80_000, category_id: "food" },
      { meaning: "spend", amount: 30_000, category_id: "food" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.diff).toBe(-10_000);
    expect(r.message).toContain("Thừa 10.000");
  });

  it("mỗi dòng phải đủ thông tin theo loại", () => {
    expect(validateSplits(10, []).message).toBe("Cần ít nhất một dòng.");
    expect(validateSplits(10, [{ meaning: "spend", amount: 0, category_id: "a" }]).message).toBe("Dòng 1 chưa có số tiền.");
    expect(validateSplits(10, [{ meaning: "spend", amount: 10 }]).message).toContain("cần danh mục");
    expect(validateSplits(10, [{ meaning: "transfer", amount: 10 }]).message).toContain("tài khoản đầu kia");
    expect(validateSplits(10, [{ meaning: "buy_asset", amount: 10 }]).message).toContain("loại tài sản");
    expect(validateSplits(10, [{ meaning: "spend", amount: 2.5, category_id: "a" }]).ok).toBe(false);
  });

  it("rút tiền mặt: một dòng chuyển nội bộ đủ số", () => {
    expect(validateSplits(2_000_000, [{ meaning: "transfer", amount: 2_000_000, other_account_id: "cash-husband" }]).ok).toBe(true);
  });

  it("chuyển kèm ví: đủ cả hai ví khác nhau, hoặc không ví nào", () => {
    const base = { meaning: "transfer" as const, amount: 3_000_000, other_account_id: "bidv" };
    expect(validateSplits(3_000_000, [{ ...base, from_wallet_id: "rental-income", wallet_id: "wealth-building" }]).ok).toBe(true);
    expect(validateSplits(3_000_000, [{ ...base, from_wallet_id: "rental-income" }]).message).toContain("hai ví khác nhau");
    expect(validateSplits(3_000_000, [{ ...base, wallet_id: "wealth-building" }]).ok).toBe(false);
    expect(validateSplits(3_000_000, [{ ...base, from_wallet_id: "wealth-building", wallet_id: "wealth-building" }]).ok).toBe(false);
  });
});

describe("toast sau khi gán: kết quả kèm hệ quả", () => {
  const anUong = { walletId: "food", name: "Ăn uống", balance: 900_000, weekRemaining: 255_000, monthRemaining: null };
  const none = { label: "", status: null, newOrders: 0, pendingOrders: null };

  it("một dòng chi: số tiền, danh mục, ví còn bao nhiêu", () => {
    expect(assignToast([{ meaning: "spend", amount: 45_000, category_id: "eating-out", wallet_id: "food" }], { ...none, label: "Ăn ngoài", status: anUong })).toBe(
      "Đã gán 45.000 ₫ Ăn ngoài. Ăn uống còn 255.000 ₫ tuần này.",
    );
    // chưa tải lại được số thì chỉ nói kết quả, không đoán số còn
    expect(assignToast([{ meaning: "spend", amount: 45_000, category_id: "eating-out" }], { ...none, label: "Ăn ngoài" })).toBe("Đã gán 45.000 ₫ Ăn ngoài.");
  });

  it("chuyển nội bộ và tách nhiều dòng", () => {
    expect(assignToast([{ meaning: "transfer", amount: 2_000_000, other_account_id: "cash" }], none)).toBe("Đã gán chuyển nội bộ 2.000.000 ₫.");
    const two = [
      { meaning: "spend" as const, amount: 180_000, category_id: "cho" },
      { meaning: "spend" as const, amount: 70_000, category_id: "tap" },
    ];
    expect(assignToast(two, { ...none, status: anUong })).toBe("Đã gán 2 dòng.");
  });

  it("thu nhập: 'Còn N lệnh' là tổng lệnh đang chờ, không chỉ lệnh của lần chia này", () => {
    const income = [{ meaning: "income" as const, amount: 30_000_000 }];
    expect(assignToast(income, { ...none, newOrders: 2, pendingOrders: 4 })).toBe("Đã gán và chia 30.000.000 ₫. Còn 4 lệnh chuyển tiền cần làm.");
    expect(assignToast(income, { ...none, newOrders: 0, pendingOrders: 0 })).toBe("Đã gán và chia 30.000.000 ₫.");
    // không tải lại được tổng: nói số lệnh mới, không gọi là "còn"
    expect(assignToast(income, { ...none, newOrders: 2, pendingOrders: null })).toBe("Đã gán và chia 30.000.000 ₫. Có thêm 2 lệnh chuyển tiền cần làm.");
  });
});

describe("gán thu nhập, để chia sau", () => {
  it("toast nói tiền nằm ở ví Thu nhập, chưa chia, và chia ở đâu", () => {
    expect(deferredIncomeToast(250_000)).toBe("Đã ghi 250.000\u00a0₫ vào ví Thu nhập, chưa chia. Chia ở Giao dịch gần đây › khoản này › Chia.");
  });
});

describe("chữ nhắc dưới hàng chip 'Gán thành'", () => {
  it("mỗi loại của mỗi chiều có đúng một dòng giải thích riêng; tiền vào có Thu từ người thuê", () => {
    const meanings: Record<"in" | "out", (SplitMeaning | "tenant")[]> = {
      in: ["income", "tenant", "refund", "collect", "transfer"],
      out: ["spend", "transfer", "lend", "buy_asset"],
    };
    for (const dir of ["in", "out"] as const) {
      const choices = ASSIGN_CHOICES[dir];
      expect(choices.map((c) => c.value)).toEqual(meanings[dir]);
      for (const c of choices) expect(c.hint.trim()).not.toBe("");
      expect(new Set(choices.map((c) => c.hint)).size).toBe(choices.length);
    }
  });

  it("mua hộ người khác (nhà mình không có phần) là Cho vay, chia bill có phần mình là Chi tiêu + Hoàn tiền; trả dư tách Thu nhập (ADR-84)", () => {
    const hint = (dir: "in" | "out", v: SplitMeaning) => ASSIGN_CHOICES[dir].find((c) => c.value === v)!.hint;
    expect(hint("out", "lend")).toMatch(/mua hộ \/ trả hộ người khác \(nhà mình không có phần\)/);
    expect(hint("in", "collect")).toMatch(/mua hộ/);
    expect(hint("in", "collect")).toMatch(/Trả dư thì Tách thêm dòng Thu nhập/);
    for (const [dir, v] of [["out", "spend"], ["in", "refund"]] as const) {
      expect(hint(dir, v)).toMatch(/bill/);
      expect(hint(dir, v)).not.toMatch(/mua hộ/i);
    }
  });
});
