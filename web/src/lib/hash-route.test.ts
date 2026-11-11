import { describe, expect, it } from "vitest";
import { DEFAULT_WALLETS_TAB, hashFor, NET_WORTH_SECTIONS, parseHash, TABS, WALLETS_TABS } from "./hash-route";

const at = (tab: string, walletsTab: string | null = null, netWorthSection: string | null = null, cycle: string | null = null, ledger: string | null = null) => ({
  tab,
  walletsTab,
  netWorthSection,
  cycle,
  ledger,
});

describe("màn trong hash", () => {
  it("UC-711 AC-11: F5 ở Ví & quỹ › Tích luỹ mở lại đúng Tích luỹ: hash ghi cả tab con và đọc lại ra đúng chỗ", () => {
    expect(hashFor("wallets", "wealth-building")).toBe("#wallets/wealth-building");
    expect(parseHash(hashFor("wallets", "wealth-building"))).toEqual(at("wallets", "wealth-building"));
    expect(hashFor("ledger", "wealth-building")).toBe("#ledger");
  });

  it("UC-711 AC-11: link cũ \"#wallets\" hay tab con lạ → Ví & quỹ, giữ tab con đang có (mặc định Nhìn lại); hash lạ → Hôm nay; tab con chỉ thuộc Ví & quỹ", () => {
    expect(DEFAULT_WALLETS_TAB).toBe("analysis");
    expect(parseHash("#wallets")).toEqual(at("wallets"));
    expect(parseHash("#wallets/khong-co")).toEqual(at("wallets"));
    expect(parseHash("#la")).toEqual(at("today"));
    expect(parseHash("")).toEqual(at("today"));
    expect(parseHash("#assign/wealth-building")).toEqual(at("assign"));
    expect(parseHash("#wallets/pyramid")).toEqual(at("wallets"));
  });

  it("UC-711 AC-6: bảng địa chỉ màn tiếng Anh — 8 màn (cả #convert), 5 tab con Ví & quỹ (cộng phần con #wallets/analysis/2026-10-10) và 6 phần Tài sản & tự do, mỗi địa chỉ đọc lại ra đúng chỗ", () => {
    expect(TABS).toEqual(["today", "entry", "assign", "wallets", "settings", "ledger", "net-worth", "convert"]);
    expect(WALLETS_TABS).toEqual(["analysis", "wealth-building", "accounts", "tenants", "debts"]);
    expect(NET_WORTH_SECTIONS).toEqual(["sheet", "pyramid", "cash-flow", "income", "milestones", "projection"]);
    for (const tab of TABS) expect(parseHash(`#${tab}`)).toEqual(at(tab));
    for (const sub of WALLETS_TABS) expect(parseHash(`#wallets/${sub}`)).toEqual(at("wallets", sub));
    for (const sub of NET_WORTH_SECTIONS) expect(parseHash(`#net-worth/${sub}`)).toEqual(at("net-worth", null, sub));
    expect(hashFor("wallets", "analysis", "sheet", "2026-10-10")).toBe("#wallets/analysis/2026-10-10");
    expect(parseHash("#wallets/analysis/2026-10-10")).toEqual(at("wallets", "analysis", null, "2026-10-10"));
  });

  it("UC-711 AC-27, UC-707 AC-36: #wallets/budget → Nhìn lại kỳ hiện tại (không còn tab Ngân sách); ngày sai → kỳ hiện tại; ngày đúng → kỳ đó", () => {
    expect(WALLETS_TABS).not.toContain("budget");
    expect(parseHash("#wallets/budget")).toEqual(at("wallets", "analysis"));
    expect(parseHash("#wallets/analysis/2026-13-40")).toEqual(at("wallets", "analysis"));
    expect(parseHash("#wallets/analysis/2026-02-30")).toEqual(at("wallets", "analysis"));
    expect(parseHash("#wallets/analysis/10-11-2026")).toEqual(at("wallets", "analysis"));
    expect(parseHash("#wallets/analysis/2026-10-10")).toEqual(at("wallets", "analysis", null, "2026-10-10"));
    // Đúng dạng nhưng không phải ngày lương của kỳ nào: địa chỉ vẫn đọc ra ngày, server trả invalid_cycle thì màn về kỳ hiện tại.
    expect(parseHash("#wallets/analysis/2026-10-11")).toEqual(at("wallets", "analysis", null, "2026-10-11"));
    // Kỳ chỉ thuộc Nhìn lại; Nhìn lại kỳ hiện tại không ghi ngày lên địa chỉ.
    expect(parseHash("#wallets/debts/2026-10-10")).toEqual(at("wallets", "debts"));
    expect(hashFor("wallets", "debts", "sheet", "2026-10-10")).toBe("#wallets/debts");
    expect(hashFor("wallets", "analysis", "sheet", null)).toBe("#wallets/analysis");
  });

  it("UC-716 AC-23: bộ lọc Sổ giao dịch nằm trên địa chỉ #ledger?… để F5 giữ; #ledger trống → không có bộ lọc trên địa chỉ", () => {
    expect(hashFor("ledger", "analysis", "sheet", null, "cycle=2026-11-10&category_id=eating-out")).toBe("#ledger?cycle=2026-11-10&category_id=eating-out");
    expect(hashFor("ledger", "analysis", "sheet", null, "")).toBe("#ledger");
    expect(parseHash("#ledger?cycle=2026-11-10&category_id=eating-out")).toEqual(at("ledger", null, null, null, "cycle=2026-11-10&category_id=eating-out"));
    expect(parseHash("#ledger")).toEqual(at("ledger"));
    expect(parseHash("#today?cycle=2026-11-10")).toEqual(at("today"));
  });

  it("UC-717, UC-707 AC-24: \"Xem bảng cân đối ›\" mở #net-worth/sheet; F5 ở Tài sản & tự do › Tháp mở lại đúng Tháp; phần lạ → giữ phần đang có", () => {
    expect(hashFor("net-worth", "analysis", "pyramid")).toBe("#net-worth/pyramid");
    expect(hashFor("net-worth", "analysis")).toBe("#net-worth/sheet");
    expect(parseHash("#net-worth/pyramid")).toEqual(at("net-worth", null, "pyramid"));
    expect(parseHash("#net-worth/khong-co")).toEqual(at("net-worth"));
    expect(parseHash("#net-worth/analysis")).toEqual(at("net-worth"));
  });

  it("địa chỉ tiếng Việt cũ (bookmark trước khi đổi tên) → Hôm nay như mọi hash lạ, không giữ song song", () => {
    for (const old of ["#homnay", "#nhap", "#gan", "#vi", "#so", "#cai-dat", "#vi/tichsan", "#vi/ngansach", "#vi/no"]) {
      expect(parseHash(old)).toEqual(at("today"));
    }
  });

  it("UC-711 AC-25: #wallets/transfers (tab Chuyển tiền đã bỏ) → Hôm nay; các tab con còn lại vẫn mở lại đúng tab", () => {
    expect(WALLETS_TABS).not.toContain("transfers");
    expect(parseHash("#wallets/transfers")).toEqual(at("today"));
    expect(parseHash("#wallets/debts")).toEqual(at("wallets", "debts"));
  });

  it("UC-711 AC-26: Hướng dẫn mở GitBook ở tab mới, không còn màn #guide — link cũ \"#guide\" → Hôm nay, không giữ song song", () => {
    expect(TABS).not.toContain("guide");
    expect(parseHash("#guide")).toEqual(at("today"));
  });

  it("UC-711 AC-28: parseHash('#convert') ra màn convert, F5 giữ màn; phần con / bộ lọc không bám vào #convert; mọi địa chỉ cũ vẫn đúng", () => {
    expect(parseHash("#convert")).toEqual(at("convert"));
    expect(hashFor("convert", "analysis")).toBe("#convert");
    expect(parseHash(hashFor("convert", "debts", "pyramid", "2026-10-10", "cycle=2026-11-10"))).toEqual(at("convert"));
    expect(parseHash("#convert/la?x=1")).toEqual(at("convert"));
    expect(parseHash("#wallets/debts")).toEqual(at("wallets", "debts"));
    expect(parseHash("#ledger?cycle=2026-11-10")).toEqual(at("ledger", null, null, null, "cycle=2026-11-10"));
  });
});
