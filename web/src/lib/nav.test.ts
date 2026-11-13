import { describe, expect, it } from "vitest";
import { TABS } from "./hash-route";
import { BOTTOM_NAV, bottomNav, ENTRY_LABEL, NET_WORTH_SECTION_LABELS, SCREEN_TITLES, SETTINGS_SECTION_LABELS, settingsSections, SIDEBAR_NAV, sidebarNav, WALLETS_TAB_LABELS, hasFab, showsBottomNav } from "./nav";

describe("khung điều hướng (pwa UC-711, change 261113-giao-dien-m1-va-ten-moi)", () => {
  it("UC-711 AC-30: thanh dưới đúng 4 mục Hôm nay · Sổ · Gán · Tài khoản, không còn mục Nhập; nút \"+\" là Ghi khoản", () => {
    expect(BOTTOM_NAV.map((n) => [n.tab, n.label])).toEqual([
      ["today", "Hôm nay"],
      ["ledger", "Sổ"],
      ["assign", "Gán"],
      ["wallets", "Tài khoản"],
    ]);
    expect(BOTTOM_NAV.some((n) => n.tab === "entry")).toBe(false);
    expect(ENTRY_LABEL).toBe("Ghi khoản");
    for (const t of TABS) expect(showsBottomNav(t), t).toBe(t !== "convert");
  });

  it("UC-711 AC-3: nút \"+\" chỉ ở Hôm nay, Gán, Tài khoản; ẩn ở Ghi khoản, Sổ giao dịch, Cài đặt, Báo cáo, Chuyển sang ba ngăn", () => {
    expect(TABS.filter(hasFab)).toEqual(["today", "assign", "wallets"]);
  });

  it("UC-711 AC-31: thanh bên Hôm nay · Sổ giao dịch · Gán · Tài khoản · Báo cáo, rồi Cài đặt", () => {
    expect(SIDEBAR_NAV.map((n) => [n.tab, n.label])).toEqual([
      ["today", "Hôm nay"],
      ["ledger", "Sổ giao dịch"],
      ["assign", "Gán"],
      ["wallets", "Tài khoản"],
      ["net-worth", "Báo cáo"],
      ["settings", "Cài đặt"],
    ]);
  });

  it("UC-711 AC-32: bộ tên mới cho tiêu đề màn, tab con Tài khoản, phần Báo cáo và mục Cài đặt", () => {
    expect(SCREEN_TITLES).toEqual({
      today: "Hôm nay",
      entry: "Ghi khoản",
      assign: "Chưa gán",
      wallets: "Tài khoản",
      settings: "Cài đặt",
      ledger: "Sổ giao dịch",
      "net-worth": "Báo cáo",
      convert: "Chuyển sang ba ngăn",
    });
    expect(Object.entries(WALLETS_TAB_LABELS)).toEqual([
      ["accounts", "Ba ngăn"],
      ["analysis", "Chi tiêu"],
      ["debts", "Nợ"],
      ["tenants", "Cho thuê"],
    ]);
    expect(Object.entries(NET_WORTH_SECTION_LABELS)).toEqual([
      ["sheet", "Cân đối"],
      ["cash-flow", "Dòng tiền"],
      ["income", "Thu chi"],
      ["freedom", "Tự do"],
    ]);
    expect(SETTINGS_SECTION_LABELS).toMatchObject({ connections: "Ngân hàng và tin nhắn", "ai-connections": "Trợ lý AI", parameters: "Ngưỡng và tỉ lệ" });
    const all = [...Object.values(SCREEN_TITLES), ...Object.values(WALLETS_TAB_LABELS), ...Object.values(NET_WORTH_SECTION_LABELS), ...Object.values(SETTINGS_SECTION_LABELS), ...BOTTOM_NAV.map((n) => n.label), ...SIDEBAR_NAV.map((n) => n.label)];
    for (const old of ["Ví & quỹ", "Tài sản & tự do", "Nhập khoản chi", "Gán giao dịch", "Nhìn lại", "Người thuê", "Lưu chuyển tiền", "Thử số", "Claude và ứng dụng AI"]) expect(all).not.toContain(old);
  });

  it("UC-711 AC-36, UC-709 AC-56: chế độ gọn — thanh dưới Hôm nay · Sổ (nút \"+\" giữ), thanh bên Hôm nay · Sổ giao dịch · Cài đặt, Cài đặt không còn mục nào ngoài Máy này; tắt → như thường", () => {
    expect(bottomNav(true).map((n) => n.tab)).toEqual(["today", "ledger"]);
    expect(sidebarNav(true).map((n) => n.tab)).toEqual(["today", "ledger", "settings"]);
    expect(settingsSections(true)).toEqual([]);
    expect(bottomNav(false)).toEqual(BOTTOM_NAV);
    expect(sidebarNav(false)).toEqual(SIDEBAR_NAV);
    expect(settingsSections(false).map((s) => s.id)).toEqual(Object.keys(SETTINGS_SECTION_LABELS));
    expect(hasFab("today")).toBe(true);
  });
});
