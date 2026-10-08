import { describe, expect, it } from "vitest";
import { debtLinePayload, debtPayload, defaultDebtId, groupDebts, paymentToast } from "./debts";
import type { Debt } from "./types";

const NBSP = "\u00a0";

const debt = (id: string, balance: number, extra: Partial<Debt> = {}): Debt => ({
  id,
  name: id,
  note: null,
  active: true,
  owed: Math.max(balance, 0) + 1_000_000,
  paid: 1_000_000,
  balance,
  done: balance <= 0,
  createdAt: "2026-09-01T00:00:00Z",
  lines: [],
  payments: [],
  ...extra,
});

describe("sổ nợ", () => {
  it("sắp xếp khoản nợ: còn nợ nhiều lên trước, trả xong tách riêng", () => {
    const g = groupDebts([debt("Bình", 2_000_000), debt("An", 0), debt("Cường", 9_379_000), debt("Dũng", 2_000_000), debt("Em", -50_000), debt("Tắt", 4_000_000, { active: false })]);
    expect(g.open.map((d) => d.id)).toEqual(["Cường", "Bình", "Dũng"]);
    expect(g.paid.map((d) => d.id)).toEqual(["An", "Em"]);
  });

  it("trả nợ mặc định chọn khoản còn nợ nhiều nhất", () => {
    const refs = [
      { id: "aunt-lan", name: "Cô Lan", balance: 6_000_000 },
      { id: "anh-tu", name: "Anh Tú", balance: 9_379_000 },
      { id: "xong", name: "Đã xong", balance: 0 },
    ];
    expect(defaultDebtId(refs)).toBe("anh-tu");
    expect(defaultDebtId(refs, "aunt-lan")).toBe("aunt-lan");
    // Mở từ khoản đã trả xong thì không chọn nó: khoản chi không được gắn vào khoản hết nợ.
    expect(defaultDebtId(refs, "xong")).toBe("anh-tu");
    expect(defaultDebtId(undefined)).toBeNull();
  });

  it("toast sau khi trả nợ: Đã trả X cho tên. Còn nợ Y.", () => {
    expect(paymentToast(2_000_000, { name: "Cô Lan", balance: 15_379_000 })).toBe(`Đã trả 2.000.000${NBSP}₫ cho Cô Lan. Còn nợ 13.379.000${NBSP}₫.`);
    expect(paymentToast(500_000, { name: "Cô Lan", balance: 500_000 })).toBe(`Đã trả 500.000${NBSP}₫ cho Cô Lan. Hết nợ.`);
    expect(paymentToast(800_000, { name: "Cô Lan", balance: 500_000 })).toBe(`Đã trả 800.000${NBSP}₫ cho Cô Lan. Hết nợ.`);
  });

  it("kiểm tra khoản nợ mới và dòng nợ: thiếu tên, số tiền", () => {
    expect(debtPayload({ name: " Cô Lan ", amount: 15_379_000, note: " vay sửa nhà " })).toEqual({ ok: true, value: { name: "Cô Lan", amount: 15_379_000, note: "vay sửa nhà" } });
    expect(debtPayload({ name: "Cô Lan", amount: 1, note: " " })).toEqual({ ok: true, value: { name: "Cô Lan", amount: 1 } });
    expect(debtPayload({ name: " ", amount: 1, note: "" }).ok).toBe(false);
    expect(debtPayload({ name: "Cô Lan", amount: 0, note: "" }).ok).toBe(false);

    expect(debtLinePayload({ kind: "borrow", amount: 3_000_000, sign: -1, note: "" })).toEqual({ ok: true, value: { kind: "borrow", amount: 3_000_000 } });
    expect(debtLinePayload({ kind: "adjust", amount: 79_000, sign: -1, note: "bớt lãi" })).toEqual({ ok: true, value: { kind: "adjust", amount: -79_000, note: "bớt lãi" } });
    expect(debtLinePayload({ kind: "adjust", amount: 0, sign: 1, note: "" }).ok).toBe(false);
    expect(debtLinePayload({ kind: "borrow", amount: 0, sign: 1, note: "" }).ok).toBe(false);
  });
});
