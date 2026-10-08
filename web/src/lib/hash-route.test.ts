import { describe, expect, it } from "vitest";
import { hashFor, parseHash, TABS, WALLETS_TABS } from "./hash-route";

describe("màn trong hash", () => {
  it("F5 ở Ví & quỹ › Tích sản mở lại đúng Tích sản: hash ghi cả tab con và đọc lại ra đúng chỗ", () => {
    expect(hashFor("wallets", "wealth-building")).toBe("#wallets/wealth-building");
    expect(parseHash(hashFor("wallets", "wealth-building"))).toEqual({ tab: "wallets", walletsTab: "wealth-building" });
    expect(hashFor("ledger", "wealth-building")).toBe("#ledger");
  });

  it("link cũ \"#wallets\" hay tab con lạ → Ví & quỹ, giữ tab con đang có; hash lạ → Hôm nay; tab con chỉ thuộc Ví & quỹ", () => {
    expect(parseHash("#wallets")).toEqual({ tab: "wallets", walletsTab: null });
    expect(parseHash("#wallets/khong-co")).toEqual({ tab: "wallets", walletsTab: null });
    expect(parseHash("#la")).toEqual({ tab: "today", walletsTab: null });
    expect(parseHash("")).toEqual({ tab: "today", walletsTab: null });
    expect(parseHash("#assign/wealth-building")).toEqual({ tab: "assign", walletsTab: null });
  });

  it("bảng địa chỉ màn tiếng Anh: đủ 7 màn (có Hướng dẫn) và 7 tab con, mỗi địa chỉ đọc lại ra đúng chỗ", () => {
    expect(TABS).toEqual(["today", "entry", "assign", "wallets", "settings", "ledger", "guide"]);
    expect(WALLETS_TABS).toEqual(["budget", "wealth-building", "accounts", "analysis", "transfers", "tenants", "debts"]);
    for (const tab of TABS) expect(parseHash(`#${tab}`)).toEqual({ tab, walletsTab: null });
    for (const sub of WALLETS_TABS) expect(parseHash(`#wallets/${sub}`)).toEqual({ tab: "wallets", walletsTab: sub });
  });

  it("địa chỉ tiếng Việt cũ (bookmark trước khi đổi tên) → Hôm nay như mọi hash lạ, không giữ song song", () => {
    for (const old of ["#homnay", "#nhap", "#gan", "#vi", "#so", "#cai-dat", "#vi/tichsan", "#vi/ngansach", "#vi/no"]) {
      expect(parseHash(old)).toEqual({ tab: "today", walletsTab: null });
    }
  });
});
