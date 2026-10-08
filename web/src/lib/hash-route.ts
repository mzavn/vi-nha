// Địa chỉ màn trong hash: "#wallets/wealth-building" — tab chính rồi (chỉ với Ví & quỹ) tab con. Tải lại trang (F5), nút quay lại và
// lối tắt đều mở đúng chỗ đang xem. Hash lạ → Hôm nay; tab con lạ hay thiếu → giữ tab con đang có.

export type Tab = "today" | "entry" | "assign" | "wallets" | "settings" | "ledger" | "guide";
export const TABS: Tab[] = ["today", "entry", "assign", "wallets", "settings", "ledger", "guide"];
export type WalletsTab = "budget" | "wealth-building" | "accounts" | "analysis" | "transfers" | "tenants" | "debts";
export const WALLETS_TABS: WalletsTab[] = ["budget", "wealth-building", "accounts", "analysis", "transfers", "tenants", "debts"];

const isTab = (s: string): s is Tab => (TABS as string[]).includes(s);
const isWalletsTab = (s: string): s is WalletsTab => (WALLETS_TABS as string[]).includes(s);

export function parseHash(hash: string): { tab: Tab; walletsTab: WalletsTab | null } {
  const [head = "", sub = ""] = hash.replace(/^#/, "").split("/");
  const tab = isTab(head) ? head : "today";
  return { tab, walletsTab: tab === "wallets" && isWalletsTab(sub) ? sub : null };
}

/** Hash của một màn: Ví & quỹ kèm tab con, màn khác chỉ có tên tab. */
export const hashFor = (tab: Tab, walletsTab: WalletsTab): string => (tab === "wallets" ? `#wallets/${walletsTab}` : `#${tab}`);
