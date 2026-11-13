// Địa chỉ màn trong hash: "#wallets/debts", "#net-worth/freedom" — tab chính rồi (chỉ với Tài khoản và Báo cáo) phần con.
// Nhìn lại tháng khác thêm tháng: "#wallets/analysis/2026-10"; Sổ giao dịch mang bộ lọc: "#ledger?month=2026-11&category=…".
// Màn chuyển đổi một lần "#convert" (pwa UC-711 AC-28) là màn phụ như "#settings", "#ledger".
// Tải lại trang (F5), nút quay lại và lối tắt đều mở đúng chỗ đang xem. Hash lạ → Hôm nay; phần con lạ hay thiếu → giữ phần đang có.

export type Tab = "today" | "entry" | "assign" | "wallets" | "settings" | "ledger" | "net-worth" | "convert";
export const TABS: Tab[] = ["today", "entry", "assign", "wallets", "settings", "ledger", "net-worth", "convert"];
/** Bốn tab con của màn Tài khoản (pwa UC-707 AC-41): Ba ngăn · Chi tiêu · Nợ · Cho thuê. */
export type WalletsTab = "accounts" | "analysis" | "debts" | "tenants";
export const WALLETS_TABS: WalletsTab[] = ["accounts", "analysis", "debts", "tenants"];
/** Mở Tài khoản lần đầu (hay link `#wallets`): Ba ngăn. */
export const DEFAULT_WALLETS_TAB: WalletsTab = "accounts";
/** Bốn phần của màn Báo cáo (pwa UC-717 AC-7): Cân đối (gồm Tháp tài sản) · Dòng tiền · Thu chi · Tự do (Mốc tự do + Dự tính). */
export type NetWorthSection = "sheet" | "cash-flow" | "income" | "freedom";
export const NET_WORTH_SECTIONS: NetWorthSection[] = ["sheet", "cash-flow", "income", "freedom"];
/** Tab / phần đã gộp (luật cắt hẳn): tab Tích luỹ → Ba ngăn; Tháp → Cân đối; Mốc tự do, Dự tính → Tự do. */
const MERGED_WALLETS: Record<string, WalletsTab> = { "wealth-building": "accounts", budget: "analysis" };
const MERGED_NET_WORTH: Record<string, NetWorthSection> = { pyramid: "sheet", milestones: "freedom", projection: "freedom" };

const isTab = (s: string): s is Tab => (TABS as string[]).includes(s);
const isWalletsTab = (s: string): s is WalletsTab => (WALLETS_TABS as string[]).includes(s);
const isNetWorthSection = (s: string): s is NetWorthSection => (NET_WORTH_SECTIONS as string[]).includes(s);

/** `YYYY-MM-DD` là một ngày có thật (2026-13-40, 2026-02-30 → không). */
export function isDayKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** `YYYY-MM` là một tháng hợp lệ. */
export const isMonthKey = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export interface Route {
  tab: Tab;
  walletsTab: WalletsTab | null;
  netWorthSection: NetWorthSection | null;
  /**
   * Tháng đang xem ở Nhìn lại (`YYYY-MM`); null = tháng hiện tại. Địa chỉ cũ theo ngày lương (`#wallets/analysis/2026-11-10`,
   * pwa UC-707 AC-40) → tháng của ngày đó.
   */
  month: string | null;
  /** Bộ lọc Sổ giao dịch trên địa chỉ (query sau `#ledger?`); null = địa chỉ không mang bộ lọc. */
  ledger: string | null;
}

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const [head = "", sub = "", part = ""] = path.split("/");
  // Tab Chuyển tiền đã bỏ (UC-711 AC-25): địa chỉ cũ về Hôm nay, không giữ song song.
  const tab = head === "wallets" && sub === "transfers" ? "today" : isTab(head) ? head : "today";
  // Tab Ngân sách đã bỏ (UC-707 AC-36) → Chi tiêu; tab Tích luỹ gộp vào Ba ngăn (UC-707 AC-41).
  const walletsTab = tab !== "wallets" ? null : (MERGED_WALLETS[sub] ?? (isWalletsTab(sub) ? sub : null));
  return {
    tab,
    walletsTab,
    netWorthSection: tab !== "net-worth" ? null : (MERGED_NET_WORTH[sub] ?? (isNetWorthSection(sub) ? sub : null)),
    month: walletsTab === "analysis" && sub === "analysis" ? (isMonthKey(part) ? part : isDayKey(part) ? part.slice(0, 7) : null) : null,
    ledger: tab === "ledger" && query ? query : null,
  };
}

/** Địa chỉ của tab / phần đã gộp → địa chỉ mới để ghi lại tại chỗ (UC-707 AC-41, UC-717 AC-7); địa chỉ còn dùng → null. */
export function legacyRedirect(hash: string): string | null {
  const [head = "", sub = ""] = hash.replace(/^#/, "").split("?")[0]!.split("/");
  if (head === "wallets" && sub === "wealth-building") return "#wallets/accounts";
  const merged = head === "net-worth" ? MERGED_NET_WORTH[sub] : undefined;
  return merged ? `#net-worth/${merged}` : null;
}

/** Hash của một màn: Tài khoản và Báo cáo kèm phần con (Chi tiêu kèm tháng đã chọn), Sổ giao dịch kèm bộ lọc, màn khác chỉ có tên tab. */
export function hashFor(tab: Tab, walletsTab: WalletsTab, netWorthSection: NetWorthSection = "sheet", month: string | null = null, ledger = ""): string {
  if (tab === "wallets") return walletsTab === "analysis" && month ? `#wallets/analysis/${month}` : `#wallets/${walletsTab}`;
  if (tab === "net-worth") return `#net-worth/${netWorthSection}`;
  if (tab === "ledger" && ledger) return `#ledger?${ledger}`;
  return `#${tab}`;
}
