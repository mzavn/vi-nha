// Địa chỉ màn trong hash: "#wallets/wealth-building", "#net-worth/pyramid" — tab chính rồi (chỉ với Ví & quỹ và Tài sản & tự do) phần con.
// Tải lại trang (F5), nút quay lại và lối tắt đều mở đúng chỗ đang xem. Hash lạ → Hôm nay; phần con lạ hay thiếu → giữ phần đang có.

export type Tab = "today" | "entry" | "assign" | "wallets" | "settings" | "ledger" | "guide" | "net-worth";
export const TABS: Tab[] = ["today", "entry", "assign", "wallets", "settings", "ledger", "guide", "net-worth"];
export type WalletsTab = "budget" | "wealth-building" | "accounts" | "analysis" | "transfers" | "tenants" | "debts";
export const WALLETS_TABS: WalletsTab[] = ["budget", "wealth-building", "accounts", "analysis", "transfers", "tenants", "debts"];
/** Sáu phần của màn Tài sản & tự do (pwa UC-717): Cân đối · Tháp · Lưu chuyển tiền · Thu chi · Mốc tự do · Thử số. */
export type NetWorthSection = "sheet" | "pyramid" | "cash-flow" | "income" | "milestones" | "projection";
export const NET_WORTH_SECTIONS: NetWorthSection[] = ["sheet", "pyramid", "cash-flow", "income", "milestones", "projection"];

const isTab = (s: string): s is Tab => (TABS as string[]).includes(s);
const isWalletsTab = (s: string): s is WalletsTab => (WALLETS_TABS as string[]).includes(s);
const isNetWorthSection = (s: string): s is NetWorthSection => (NET_WORTH_SECTIONS as string[]).includes(s);

export function parseHash(hash: string): { tab: Tab; walletsTab: WalletsTab | null; netWorthSection: NetWorthSection | null } {
  const [head = "", sub = ""] = hash.replace(/^#/, "").split("/");
  const tab = isTab(head) ? head : "today";
  return {
    tab,
    walletsTab: tab === "wallets" && isWalletsTab(sub) ? sub : null,
    netWorthSection: tab === "net-worth" && isNetWorthSection(sub) ? sub : null,
  };
}

/** Hash của một màn: Ví & quỹ và Tài sản & tự do kèm phần con, màn khác chỉ có tên tab. */
export const hashFor = (tab: Tab, walletsTab: WalletsTab, netWorthSection: NetWorthSection = "sheet"): string =>
  tab === "wallets" ? `#wallets/${walletsTab}` : tab === "net-worth" ? `#net-worth/${netWorthSection}` : `#${tab}`;
