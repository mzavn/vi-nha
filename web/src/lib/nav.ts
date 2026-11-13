// Một nguồn cho khung điều hướng và tên màn (pwa UC-711 AC-3, AC-30…AC-32; change 261113-giao-dien-m1-va-ten-moi).
// Hash giữ tiếng Anh (ADR-92); chữ người dùng thấy theo bộ tên mới (`plans/reports/design-261112/ten-moi.md`).

import type { NetWorthSection, Tab, WalletsTab } from "./hash-route";

export interface NavItem {
  tab: Tab;
  label: string;
  icon: string;
}

/** Nút "+" (điện thoại), nút chính thanh bên, tiêu đề màn `#entry`, lối tắt manifest. */
export const ENTRY_LABEL = "Ghi khoản";

/** Thanh dưới điện thoại: đúng 4 mục; ghi khoản bằng nút "+" (AC-30). */
export const BOTTOM_NAV: NavItem[] = [
  { tab: "today", label: "Hôm nay", icon: "home" },
  { tab: "ledger", label: "Sổ", icon: "book" },
  { tab: "assign", label: "Gán", icon: "inbox" },
  { tab: "wallets", label: "Tài khoản", icon: "wallet" },
];

/** Thanh bên máy tính, sau nút Ghi khoản; Hướng dẫn (link tab mới, AC-26) đứng sau Cài đặt (AC-31). */
export const SIDEBAR_NAV: NavItem[] = [
  { tab: "today", label: "Hôm nay", icon: "home" },
  { tab: "ledger", label: "Sổ giao dịch", icon: "book" },
  { tab: "assign", label: "Gán", icon: "inbox" },
  { tab: "wallets", label: "Tài khoản", icon: "wallet" },
  { tab: "net-worth", label: "Báo cáo", icon: "trending-up" },
  { tab: "settings", label: "Cài đặt", icon: "settings" },
];

/** Màn có nút "+" trên điện thoại (AC-3). Sổ giao dịch có nút "+ Ghi khoản" riêng. */
const FAB_TABS: Tab[] = ["today", "assign", "wallets"];
export const hasFab = (tab: Tab): boolean => FAB_TABS.includes(tab);

/** Chế độ gọn (UC-711 AC-36): chỉ ghi chi — thanh dưới Hôm nay · Sổ (+ nút "+"), thanh bên thêm Cài đặt. Chỉ ẩn, không phân quyền. */
const COMPACT_TABS: Tab[] = ["today", "ledger", "settings"];
export const bottomNav = (compact: boolean): NavItem[] => (compact ? BOTTOM_NAV.filter((n) => COMPACT_TABS.includes(n.tab)) : BOTTOM_NAV);
export const sidebarNav = (compact: boolean): NavItem[] => (compact ? SIDEBAR_NAV.filter((n) => COMPACT_TABS.includes(n.tab)) : SIDEBAR_NAV);

/** Màn chuyển đổi một lần ẩn cả thanh dưới (AC-28). */
export const showsBottomNav = (tab: Tab): boolean => tab !== "convert";

export const SCREEN_TITLES: Record<Tab, string> = {
  today: "Hôm nay",
  entry: ENTRY_LABEL,
  assign: "Chưa gán",
  wallets: "Tài khoản",
  settings: "Cài đặt",
  ledger: "Sổ giao dịch",
  "net-worth": "Báo cáo",
  convert: "Chuyển sang ba ngăn",
};

/** Tab con của màn Tài khoản, theo thứ tự hiện (UC-707 AC-41). */
export const WALLETS_TAB_LABELS: Record<WalletsTab, string> = {
  accounts: "Ba ngăn",
  analysis: "Chi tiêu",
  debts: "Nợ",
  tenants: "Cho thuê",
};

/** Phần của màn Báo cáo, theo thứ tự hiện (UC-717 AC-7). Tháp tài sản nằm trong Cân đối, Dự tính trong Tự do. */
export const NET_WORTH_SECTION_LABELS: Record<NetWorthSection, string> = {
  sheet: "Cân đối",
  "cash-flow": "Dòng tiền",
  income: "Thu chi",
  freedom: "Tự do",
};

/** Mục Cài đặt theo thứ tự hiện; `advanced` = nhóm Nâng cao. */
export const SETTINGS_SECTIONS = [
  { id: "pockets", label: "Ba ngăn", advanced: false },
  { id: "accounts", label: "Tài khoản", advanced: false },
  { id: "rental", label: "Cho thuê", advanced: false },
  { id: "income-streams", label: "Nguồn thu", advanced: false },
  { id: "transfer-codes", label: "Mã chuyển khoản", advanced: false },
  { id: "notifications", label: "Thông báo", advanced: false },
  { id: "members", label: "Thành viên", advanced: false },
  { id: "connections", label: "Ngân hàng và tin nhắn", advanced: true },
  { id: "ai-connections", label: "Trợ lý AI", advanced: true },
  { id: "parameters", label: "Ngưỡng và tỉ lệ", advanced: true },
  { id: "audit-log", label: "Nhật ký thay đổi", advanced: true },
  { id: "app-update", label: "Cập nhật Ví nhà", advanced: true },
] as const;

export const SETTINGS_SECTION_LABELS = Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s.id, s.label])) as Record<(typeof SETTINGS_SECTIONS)[number]["id"], string>;

/** Mục Cài đặt được hiện: chế độ gọn chỉ còn Máy này (không nằm trong danh sách này) — UC-709 AC-56. */
export const settingsSections = (compact: boolean) => (compact ? [] : SETTINGS_SECTIONS);
