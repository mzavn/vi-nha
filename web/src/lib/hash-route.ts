// Địa chỉ màn trong hash: "#wallets/wealth-building", "#net-worth/pyramid" — tab chính rồi (chỉ với Ví & quỹ và Tài sản & tự do) phần con.
// Nhìn lại kỳ đã qua thêm ngày lương: "#wallets/analysis/2026-10-10"; Sổ giao dịch mang bộ lọc: "#ledger?cycle=2026-11-10&category_id=…".
// Màn chuyển đổi một lần "#convert" (pwa UC-711 AC-28) là màn phụ như "#settings", "#ledger".
// Tải lại trang (F5), nút quay lại và lối tắt đều mở đúng chỗ đang xem. Hash lạ → Hôm nay; phần con lạ hay thiếu → giữ phần đang có.

export type Tab = "today" | "entry" | "assign" | "wallets" | "settings" | "ledger" | "net-worth" | "convert";
export const TABS: Tab[] = ["today", "entry", "assign", "wallets", "settings", "ledger", "net-worth", "convert"];
/** Năm tab con của Ví & quỹ (pwa UC-707, UC-711): Nhìn lại · Tích luỹ · Tài khoản · Người thuê · Nợ. */
export type WalletsTab = "analysis" | "wealth-building" | "accounts" | "tenants" | "debts";
export const WALLETS_TABS: WalletsTab[] = ["analysis", "wealth-building", "accounts", "tenants", "debts"];
/** Mở Ví & quỹ lần đầu (hay link `#wallets`): Nhìn lại. */
export const DEFAULT_WALLETS_TAB: WalletsTab = "analysis";
/** Sáu phần của màn Tài sản & tự do (pwa UC-717): Cân đối · Tháp · Lưu chuyển tiền · Thu chi · Mốc tự do · Thử số. */
export type NetWorthSection = "sheet" | "pyramid" | "cash-flow" | "income" | "milestones" | "projection";
export const NET_WORTH_SECTIONS: NetWorthSection[] = ["sheet", "pyramid", "cash-flow", "income", "milestones", "projection"];

const isTab = (s: string): s is Tab => (TABS as string[]).includes(s);
const isWalletsTab = (s: string): s is WalletsTab => (WALLETS_TABS as string[]).includes(s);
const isNetWorthSection = (s: string): s is NetWorthSection => (NET_WORTH_SECTIONS as string[]).includes(s);

/** `YYYY-MM-DD` là một ngày có thật (2026-13-40, 2026-02-30 → không). */
export function isDayKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export interface Route {
  tab: Tab;
  walletsTab: WalletsTab | null;
  netWorthSection: NetWorthSection | null;
  /** Ngày lương của kỳ đang xem ở Nhìn lại; null = kỳ hiện tại. Ngày đúng dạng mà không phải kỳ nào thì màn tự về kỳ hiện tại. */
  cycle: string | null;
  /** Bộ lọc Sổ giao dịch trên địa chỉ (query sau `#ledger?`); null = địa chỉ không mang bộ lọc. */
  ledger: string | null;
}

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const [head = "", sub = "", part = ""] = path.split("/");
  // Tab Chuyển tiền đã bỏ (UC-711 AC-25): địa chỉ cũ về Hôm nay, không giữ song song.
  const tab = head === "wallets" && sub === "transfers" ? "today" : isTab(head) ? head : "today";
  // Tab Ngân sách đã bỏ (UC-707 AC-36): địa chỉ cũ mở Nhìn lại kỳ hiện tại.
  const walletsTab = tab !== "wallets" ? null : sub === "budget" ? "analysis" : isWalletsTab(sub) ? sub : null;
  return {
    tab,
    walletsTab,
    netWorthSection: tab === "net-worth" && isNetWorthSection(sub) ? sub : null,
    cycle: walletsTab === "analysis" && sub === "analysis" && isDayKey(part) ? part : null,
    ledger: tab === "ledger" && query ? query : null,
  };
}

/** Hash của một màn: Ví & quỹ và Tài sản & tự do kèm phần con (Nhìn lại kèm kỳ đã chọn), Sổ giao dịch kèm bộ lọc, màn khác chỉ có tên tab. */
export function hashFor(tab: Tab, walletsTab: WalletsTab, netWorthSection: NetWorthSection = "sheet", cycle: string | null = null, ledger = ""): string {
  if (tab === "wallets") return walletsTab === "analysis" && cycle ? `#wallets/analysis/${cycle}` : `#wallets/${walletsTab}`;
  if (tab === "net-worth") return `#net-worth/${netWorthSection}`;
  if (tab === "ledger" && ledger) return `#ledger?${ledger}`;
  return `#${tab}`;
}
