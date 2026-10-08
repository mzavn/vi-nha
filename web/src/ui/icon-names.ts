// Tên mọi icon có thật (bộ nét trong icons.tsx). Tách khỏi icons.tsx để test và migration kiểm được `categories.icon`
// mà không cần JSX. icons.tsx khai báo đúng từng tên này — thiếu hay thừa một tên là lỗi kiểu.

export const ICON_NAMES = [
  "home", "plus-circle", "plus", "inbox", "wallet", "sync", "copy", "x", "settings", "chevron-right", "chevron-left", "search",
  "help", "filter", "chevron-down", "chevron-up", "check", "grid", "cloud-off", "eye", "eye-off", "basket", "utensils", "zap",
  "fuel", "car", "wrench", "laptop", "pill", "dumbbell", "heart", "gift", "sprout", "swap", "receipt", "bag", "plane", "coffee",
  "film", "tag", "wifi", "building", "bus", "map-pin", "book", "credit-card", "more",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export const isIconName = (name: string | null | undefined): name is IconName => (ICON_NAMES as readonly string[]).includes(name ?? "");
