import { describe, expect, it } from "vitest";
import { accountsTotal } from "./accounts-total";

const row = (accountId: string, bookBalance: number, kind: "bank" | "cash" | "ewallet" | "credit" = "bank") => ({ accountId, kind, bookBalance });

describe("tổng tiền ở tab Tài khoản", () => {
  it("UC-707 AC-31: cộng số trong sổ của mọi tài khoản; thẻ tín dụng đang nợ cộng như số âm và được báo, thẻ dư nợ 0 không báo", () => {
    const rows = [row("mb", 2_041_394), row("bidv", 0), row("mb-chi-tieu", 2_301_065)];
    expect(accountsTotal(rows)).toEqual({ total: 4_342_459, hasCredit: false });
    expect(accountsTotal([...rows, row("the", -500_000, "credit")])).toEqual({ total: 3_842_459, hasCredit: true });
    expect(accountsTotal([...rows, row("the", 0, "credit")])).toEqual({ total: 4_342_459, hasCredit: false });
    expect(accountsTotal([])).toEqual({ total: 0, hasCredit: false });
  });
});
