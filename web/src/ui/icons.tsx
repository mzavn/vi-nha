// Icon nét Lucide qua `lucide-preact` (giấy phép ISC). Một kiểu nét cho cả app, không dùng emoji làm icon.
// Import từng icon theo tên để tree-shake, strokeWidth 1.75, currentColor (DESIGN.md §4.17).

import type { ComponentType } from "preact";
import {
  House,
  CirclePlus,
  Plus,
  Inbox,
  Wallet,
  RefreshCw,
  Copy,
  QrCode,
  X,
  Settings,
  ChevronRight,
  ChevronLeft,
  Search,
  CircleHelp,
  Filter,
  ChevronDown,
  ChevronUp,
  Check,
  Grid2X2,
  CloudOff,
  Eye,
  EyeOff,
  ShoppingBasket,
  Utensils,
  Zap,
  Fuel,
  Car,
  Wrench,
  Laptop,
  Pill,
  Dumbbell,
  Heart,
  Gift,
  Sprout,
  ArrowLeftRight,
  Receipt,
  ShoppingBag,
  Plane,
  Coffee,
  Film,
  Tag,
  Wifi,
  Building2,
  Bus,
  MapPin,
  BookOpen,
  CreditCard,
  MoreHorizontal,
  Percent,
  TrendingUp,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Sun,
  Moon,
  Monitor,
} from "lucide-preact";
import { isIconName, type IconName } from "./icon-names";

const ICONS: Record<IconName, ComponentType<any>> = {
  home: House,
  "plus-circle": CirclePlus,
  plus: Plus,
  inbox: Inbox,
  wallet: Wallet,
  sync: RefreshCw,
  copy: Copy,
  qr: QrCode,
  x: X,
  settings: Settings,
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  search: Search,
  help: CircleHelp,
  filter: Filter,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  check: Check,
  grid: Grid2X2,
  "cloud-off": CloudOff,
  eye: Eye,
  "eye-off": EyeOff,
  basket: ShoppingBasket,
  utensils: Utensils,
  zap: Zap,
  fuel: Fuel,
  car: Car,
  wrench: Wrench,
  laptop: Laptop,
  pill: Pill,
  dumbbell: Dumbbell,
  heart: Heart,
  gift: Gift,
  sprout: Sprout,
  swap: ArrowLeftRight,
  receipt: Receipt,
  bag: ShoppingBag,
  plane: Plane,
  coffee: Coffee,
  film: Film,
  tag: Tag,
  wifi: Wifi,
  building: Building2,
  bus: Bus,
  "map-pin": MapPin,
  book: BookOpen,
  "credit-card": CreditCard,
  more: MoreHorizontal,
  percent: Percent,
  "trending-up": TrendingUp,
  "grip-vertical": GripVertical,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
};

export function Icon({
  name,
  size = 20,
  label,
  class: cls,
}: {
  name: string;
  size?: number;
  label?: string;
  class?: string;
}) {
  const Comp = isIconName(name) ? ICONS[name] : ICONS.tag;
  return (
    <Comp
      size={size}
      strokeWidth={1.75}
      color="currentColor"
      class={cls}
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    />
  );
}

/** Icon danh mục lấy từ `categories.icon`; trống hoặc không phải tên icon có thật thì dùng icon nhãn. */
export function CategoryIcon({ icon, size = 22 }: { icon: string | null; size?: number }) {
  return <Icon name={isIconName(icon) ? icon : "tag"} size={size} />;
}
