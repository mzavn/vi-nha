import { describe, expect, it } from "vitest";
import { DEFAULT_WALLETS_TAB, hashFor, legacyRedirect, NET_WORTH_SECTIONS, parseHash, TABS, WALLETS_TABS } from "./hash-route";

const at = (tab: string, walletsTab: string | null = null, netWorthSection: string | null = null, month: string | null = null, ledger: string | null = null) => ({
  tab,
  walletsTab,
  netWorthSection,
  month,
  ledger,
});

describe("màn trong hash", () => {
  it("UC-711 AC-11: F5 ở Tài khoản › Nợ mở lại đúng Nợ: hash ghi cả tab con và đọc lại ra đúng chỗ", () => {
    expect(hashFor("wallets", "debts")).toBe("#wallets/debts");
    expect(parseHash(hashFor("wallets", "debts"))).toEqual(at("wallets", "debts"));
    expect(hashFor("ledger", "debts")).toBe("#ledger");
  });

  it("UC-707 AC-41: link \"#wallets\" hay tab con lạ → Tài khoản, giữ tab con đang có (mặc định Ba ngăn); hash lạ → Hôm nay; tab con chỉ thuộc Tài khoản", () => {
    expect(DEFAULT_WALLETS_TAB).toBe("accounts");
    expect(parseHash("#wallets")).toEqual(at("wallets"));
    expect(parseHash("#wallets/khong-co")).toEqual(at("wallets"));
    expect(parseHash("#la")).toEqual(at("today"));
    expect(parseHash("")).toEqual(at("today"));
    expect(parseHash("#assign/debts")).toEqual(at("assign"));
    expect(parseHash("#wallets/pyramid")).toEqual(at("wallets"));
  });

  it("UC-707 AC-41, UC-717 AC-7: địa chỉ cũ #wallets/wealth-building → Ba ngăn; #net-worth/pyramid → Cân đối; /milestones, /projection → Tự do; legacyRedirect trả địa chỉ ghi lại, địa chỉ còn dùng → null", () => {
    expect(parseHash("#wallets/wealth-building")).toEqual(at("wallets", "accounts"));
    expect(parseHash("#net-worth/pyramid")).toEqual(at("net-worth", null, "sheet"));
    for (const old of ["milestones", "projection"]) expect(parseHash(`#net-worth/${old}`)).toEqual(at("net-worth", null, "freedom"));
    expect(legacyRedirect("#wallets/wealth-building")).toBe("#wallets/accounts");
    expect(legacyRedirect("#net-worth/pyramid")).toBe("#net-worth/sheet");
    expect(legacyRedirect("#net-worth/milestones")).toBe("#net-worth/freedom");
    expect(legacyRedirect("#net-worth/projection")).toBe("#net-worth/freedom");
    for (const kept of ["#wallets/accounts", "#net-worth/freedom", "#net-worth/cash-flow/2026-09", "#today", ""]) expect(legacyRedirect(kept), kept).toBeNull();
  });

  it("UC-711 AC-6: bảng địa chỉ màn tiếng Anh — 8 màn (cả #convert), 4 tab con Tài khoản (cộng phần con #wallets/analysis/2026-10) và 4 phần Báo cáo, mỗi địa chỉ đọc lại ra đúng chỗ", () => {
    expect(TABS).toEqual(["today", "entry", "assign", "wallets", "settings", "ledger", "net-worth", "convert"]);
    expect(WALLETS_TABS).toEqual(["accounts", "analysis", "debts", "tenants"]);
    expect(NET_WORTH_SECTIONS).toEqual(["sheet", "cash-flow", "income", "freedom"]);
    for (const tab of TABS) expect(parseHash(`#${tab}`)).toEqual(at(tab));
    for (const sub of WALLETS_TABS) expect(parseHash(`#wallets/${sub}`)).toEqual(at("wallets", sub));
    for (const sub of NET_WORTH_SECTIONS) expect(parseHash(`#net-worth/${sub}`)).toEqual(at("net-worth", null, sub));
    expect(hashFor("wallets", "analysis", "sheet", "2026-10")).toBe("#wallets/analysis/2026-10");
    expect(parseHash("#wallets/analysis/2026-10")).toEqual(at("wallets", "analysis", null, "2026-10"));
  });

  it("UC-711 AC-27, UC-707 AC-36: #wallets/budget → Nhìn lại tháng hiện tại (không còn tab Ngân sách); tháng / ngày sai → tháng hiện tại; tháng đúng → tháng đó", () => {
    expect(WALLETS_TABS).not.toContain("budget");
    expect(parseHash("#wallets/budget")).toEqual(at("wallets", "analysis"));
    expect(parseHash("#wallets/analysis/2026-13")).toEqual(at("wallets", "analysis"));
    expect(parseHash("#wallets/analysis/2026-02-30")).toEqual(at("wallets", "analysis"));
    expect(parseHash("#wallets/analysis/10-2026")).toEqual(at("wallets", "analysis"));
    expect(parseHash("#wallets/analysis/2026-10")).toEqual(at("wallets", "analysis", null, "2026-10"));
    // Tháng chỉ thuộc Nhìn lại; Nhìn lại tháng hiện tại không ghi tháng lên địa chỉ.
    expect(parseHash("#wallets/debts/2026-10")).toEqual(at("wallets", "debts"));
    expect(hashFor("wallets", "debts", "sheet", "2026-10")).toBe("#wallets/debts");
    expect(hashFor("wallets", "analysis", "sheet", null)).toBe("#wallets/analysis");
  });

  it("UC-707 AC-40: địa chỉ cũ theo ngày lương #wallets/analysis/2026-11-10 → mở tháng 11; F5 ở tháng 10 giữ #wallets/analysis/2026-10", () => {
    expect(parseHash("#wallets/analysis/2026-11-10")).toEqual(at("wallets", "analysis", null, "2026-11"));
    expect(parseHash(hashFor("wallets", "analysis", "sheet", "2026-10"))).toEqual(at("wallets", "analysis", null, "2026-10"));
  });

  it("UC-716 AC-23: bộ lọc Sổ giao dịch nằm trên địa chỉ #ledger?… để F5 giữ; #ledger trống → không có bộ lọc trên địa chỉ", () => {
    expect(hashFor("ledger", "analysis", "sheet", null, "month=2026-11&category=eating-out")).toBe("#ledger?month=2026-11&category=eating-out");
    expect(hashFor("ledger", "analysis", "sheet", null, "")).toBe("#ledger");
    expect(parseHash("#ledger?month=2026-11&category=eating-out")).toEqual(at("ledger", null, null, null, "month=2026-11&category=eating-out"));
    expect(parseHash("#ledger")).toEqual(at("ledger"));
    expect(parseHash("#today?month=2026-11")).toEqual(at("today"));
  });

  it("UC-717 AC-7: hàng \"Báo cáo ›\" mở #net-worth/sheet; F5 ở Báo cáo › Tự do mở lại đúng Tự do; phần lạ → giữ phần đang có", () => {
    expect(hashFor("net-worth", "analysis", "freedom")).toBe("#net-worth/freedom");
    expect(hashFor("net-worth", "analysis")).toBe("#net-worth/sheet");
    expect(parseHash("#net-worth/freedom")).toEqual(at("net-worth", null, "freedom"));
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
    expect(parseHash(hashFor("convert", "debts", "freedom", "2026-10", "month=2026-11"))).toEqual(at("convert"));
    expect(parseHash("#convert/la?x=1")).toEqual(at("convert"));
    expect(parseHash("#wallets/debts")).toEqual(at("wallets", "debts"));
    expect(parseHash("#ledger?cycle=2026-11-10")).toEqual(at("ledger", null, null, null, "cycle=2026-11-10"));
  });
});
