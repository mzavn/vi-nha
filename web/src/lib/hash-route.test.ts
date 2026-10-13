import { describe, expect, it } from "vitest";
import { hashFor, NET_WORTH_SECTIONS, parseHash, TABS, WALLETS_TABS } from "./hash-route";

const at = (tab: string, walletsTab: string | null = null, netWorthSection: string | null = null) => ({ tab, walletsTab, netWorthSection });

describe("màn trong hash", () => {
  it("F5 ở Ví & quỹ › Tích sản mở lại đúng Tích sản: hash ghi cả tab con và đọc lại ra đúng chỗ", () => {
    expect(hashFor("wallets", "wealth-building")).toBe("#wallets/wealth-building");
    expect(parseHash(hashFor("wallets", "wealth-building"))).toEqual(at("wallets", "wealth-building"));
    expect(hashFor("ledger", "wealth-building")).toBe("#ledger");
  });

  it("link cũ \"#wallets\" hay tab con lạ → Ví & quỹ, giữ tab con đang có; hash lạ → Hôm nay; tab con chỉ thuộc Ví & quỹ", () => {
    expect(parseHash("#wallets")).toEqual(at("wallets"));
    expect(parseHash("#wallets/khong-co")).toEqual(at("wallets"));
    expect(parseHash("#la")).toEqual(at("today"));
    expect(parseHash("")).toEqual(at("today"));
    expect(parseHash("#assign/wealth-building")).toEqual(at("assign"));
    expect(parseHash("#wallets/pyramid")).toEqual(at("wallets"));
  });

  it("UC-711 AC-10: bảng địa chỉ màn tiếng Anh — đủ 8 màn (có Hướng dẫn, Tài sản & tự do), 7 tab con Ví & quỹ và 6 phần Tài sản & tự do, mỗi địa chỉ đọc lại ra đúng chỗ", () => {
    expect(TABS).toEqual(["today", "entry", "assign", "wallets", "settings", "ledger", "guide", "net-worth"]);
    expect(WALLETS_TABS).toEqual(["budget", "wealth-building", "accounts", "analysis", "transfers", "tenants", "debts"]);
    expect(NET_WORTH_SECTIONS).toEqual(["sheet", "pyramid", "cash-flow", "income", "milestones", "projection"]);
    for (const tab of TABS) expect(parseHash(`#${tab}`)).toEqual(at(tab));
    for (const sub of WALLETS_TABS) expect(parseHash(`#wallets/${sub}`)).toEqual(at("wallets", sub));
    for (const sub of NET_WORTH_SECTIONS) expect(parseHash(`#net-worth/${sub}`)).toEqual(at("net-worth", null, sub));
  });

  it("UC-717, UC-707 AC-24: \"Xem bảng cân đối ›\" mở #net-worth/sheet; F5 ở Tài sản & tự do › Tháp mở lại đúng Tháp; phần lạ → giữ phần đang có", () => {
    expect(hashFor("net-worth", "budget", "pyramid")).toBe("#net-worth/pyramid");
    expect(hashFor("net-worth", "budget")).toBe("#net-worth/sheet");
    expect(parseHash("#net-worth/pyramid")).toEqual(at("net-worth", null, "pyramid"));
    expect(parseHash("#net-worth/khong-co")).toEqual(at("net-worth"));
    expect(parseHash("#net-worth/budget")).toEqual(at("net-worth"));
  });

  it("địa chỉ tiếng Việt cũ (bookmark trước khi đổi tên) → Hôm nay như mọi hash lạ, không giữ song song", () => {
    for (const old of ["#homnay", "#nhap", "#gan", "#vi", "#so", "#cai-dat", "#vi/tichsan", "#vi/ngansach", "#vi/no"]) {
      expect(parseHash(old)).toEqual(at("today"));
    }
  });
});
