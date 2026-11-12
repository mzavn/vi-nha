import { describe, expect, it } from "vitest";
import { accountsTotal, nestAccounts } from "./accounts-total";
import { setAmountsHidden } from "./money";

const NBSP = "\u00a0";

const row = (accountId: string, bookBalance: number, kind: "bank" | "cash" | "ewallet" | "credit" = "bank") => ({ accountId, kind, bookBalance });

describe("tổng tiền ở tab Tài khoản", () => {
  it("UC-707 AC-31: cộng số trong sổ của mọi tài khoản; thẻ tín dụng đang nợ cộng như số âm và được báo, thẻ dư nợ 0 không báo", () => {
    const rows = [row("mb", 2_041_394), row("bidv", 0), row("mb-chi-tieu", 2_301_065)];
    expect(accountsTotal(rows)).toEqual({ total: 4_342_459, hasCredit: false });
    expect(accountsTotal([...rows, row("the", -500_000, "credit")])).toEqual({ total: 3_842_459, hasCredit: true });
    expect(accountsTotal([...rows, row("the", 0, "credit")])).toEqual({ total: 4_342_459, hasCredit: false });
    expect(accountsTotal([])).toEqual({ total: 0, hasCredit: false });
  });

  it("UC-707 AC-39: khoản gửi kỳ hạn lồng ngay dưới mẹ '↳ Gửi 6 tháng · 100.000.000 ₫', mẹ có dòng 'gồm 1 khoản gửi · tổng 105.000.000 ₫'; 'Tiền thật đang có' không đổi; con mà mẹ không có trong danh sách thì đứng riêng", () => {
    const rows = [row("chinh", 3_000_000), row("tk-tiet-kiem", 5_000_000), row("tich-luy", 50_000_000), row("gui-6-thang", 100_000_000), row("mo-coi", 1_000_000)];
    const parent: Record<string, string> = { "gui-6-thang": "tk-tiet-kiem", "mo-coi": "da-tat" };
    const named = rows.map((r) => ({ ...r, name: { "gui-6-thang": "Gửi 6 tháng" }[r.accountId] ?? r.accountId }));
    const nested = nestAccounts(named, (r) => ({ id: r.accountId, name: r.name, balance: r.bookBalance, parentId: parent[r.accountId] ?? null }));
    expect(nested.map((n) => [n.row.accountId, n.child, n.line, n.sub])).toEqual([
      ["chinh", false, null, null],
      ["tk-tiet-kiem", false, null, `gồm 1 khoản gửi · tổng 105.000.000${NBSP}₫`],
      ["gui-6-thang", true, `↳ Gửi 6 tháng · 100.000.000${NBSP}₫`, null],
      ["tich-luy", false, null, null],
      ["mo-coi", false, null, null],
    ]);
    expect(accountsTotal(nested.map((n) => n.row)).total).toBe(accountsTotal(rows).total);
    setAmountsHidden(true);
    try {
      expect(nestAccounts(named, (r) => ({ id: r.accountId, name: r.name, balance: r.bookBalance, parentId: parent[r.accountId] ?? null }))[2]!.line).toBe(`↳ Gửi 6 tháng · ••••${NBSP}₫`);
    } finally {
      setAmountsHidden(false);
    }
  });
});
