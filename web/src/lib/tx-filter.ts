// Bộ lọc màn Sổ giao dịch (pwa UC-716): bộ lọc ↔ query string của GET /v1/transactions(/summary) (ledger UC-111),
// bộ lọc → chip bỏ được, đi tháng, ngày mặc định khi ghi thêm, nhóm dòng theo ngày, bộ lọc ↔ địa chỉ `#ledger?…`. Thuần, không đụng DOM.

import { isDayKey } from "./hash-route";
import { formatVnd } from "./money";
import { dayHeading, dayKey, monthKey, nextMonth, previousMonth } from "./period";
import type { Bootstrap, TxRow, TxSummary } from "./types";

/** Mỗi lần tải thêm 50 dòng (đọc thừa một dòng để biết còn nữa không). */
export const BOOK_PAGE = 50;

/** Loại lọc được, theo thứ tự trong sheet Lọc — mọi loại của sổ trừ bút toán nạp ví. */
export const BOOK_MEANINGS: { value: string; label: string }[] = [
  { value: "spend", label: "Chi tiêu" },
  { value: "income", label: "Thu nhập" },
  { value: "refund", label: "Hoàn tiền" },
  { value: "transfer", label: "Chuyển nội bộ" },
  { value: "lend", label: "Cho vay" },
  { value: "collect", label: "Nhận lại" },
  { value: "buy_asset", label: "Mua tài sản" },
  { value: "adjust", label: "Điều chỉnh" },
];

export interface BookFilter {
  /** `YYYY-MM`; null = cả sổ, hoặc xem theo khoảng ngày. */
  month: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  meanings: string[];
  categoryId: string | null;
  accountId: string | null;
  memberId: string | null;
  source: "manual" | "bank" | null;
  /** Chữ đang tìm (gõ sao giữ vậy); chỉ gửi khi đủ 2 ký tự. */
  q: string;
  showVoid: boolean;
}

export function defaultFilter(now: Date): BookFilter {
  return { month: monthKey(now), fromDate: null, toDate: null, meanings: [], categoryId: null, accountId: null, memberId: null, source: null, q: "", showVoid: false };
}

/** Chạm một danh mục ở Nhìn lại (pwa UC-707 AC-40, UC-716 AC-9): sổ lọc danh mục đó trong đúng tháng, Chi bằng số của Nhìn lại. */
export function monthFilter(month: string, categoryId: string | null, now: Date): BookFilter {
  return { ...defaultFilter(now), month, categoryId };
}

/** Dòng đầu khi lọc theo tài khoản riêng tư của người khác (UC-716 AC-22): chỉ thấy chuyển khoản vào / ra, không thấy từng khoản chi. */
export function privateAccountLine(f: Pick<BookFilter, "accountId">, boot: Pick<Bootstrap, "accounts"> | null): string | null {
  const a = f.accountId ? boot?.accounts.find((x) => x.id === f.accountId) : undefined;
  return a?.hiddenFromMe ? "Tài khoản riêng tư: chỉ chủ tài khoản thấy từng khoản" : null;
}

/** `2026-09-01` + `2026-09-15` → `1/9 – 15/9/2026`, hoặc `Từ 1/9/2026`, `Đến 15/9/2026`. */
export function dateRangeLabel(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from && !to) return null;
  if (from && to) {
    if (from > to) return null;
    const [y1, m1, d1] = from.split("-").map(Number);
    const [y2, m2, d2] = to.split("-").map(Number);
    return y1 === y2 ? `${d1}/${m1} – ${d2}/${m2}/${y2}` : `${d1}/${m1}/${y1} – ${d2}/${m2}/${y2}`;
  }
  if (from) {
    const [y, m, d] = from.split("-").map(Number);
    return `Từ ${d}/${m}/${y}`;
  }
  const [y, m, d] = to!.split("-").map(Number);
  return `Đến ${d}/${m}/${y}`;
}

/** Chữ tìm gửi lên server: cắt khoảng trắng; dưới 2 ký tự thì chưa tìm (server sẽ báo sai). */
export const searchText = (q: string): string | null => (q.trim().length >= 2 ? q.trim() : null);

/** Phần bộ lọc của query string, dùng chung cho danh sách và tổng. Không còn lọc theo ví (Đợt C): bộ lọc cũ có `walletId` bị bỏ qua. */
export function filterQuery(f: BookFilter): string {
  const p = new URLSearchParams();
  const hasRange = Boolean(f.fromDate || f.toDate);
  const validRange = !f.fromDate || !f.toDate || f.fromDate <= f.toDate;
  if (hasRange && validRange) {
    if (f.fromDate) p.set("from_date", f.fromDate);
    if (f.toDate) p.set("to_date", f.toDate);
  } else if (f.month) {
    p.set("month", f.month);
  }
  if (f.meanings.length) p.set("meaning", f.meanings.join(","));
  if (f.categoryId) p.set("category_id", f.categoryId);
  if (f.accountId) p.set("account_id", f.accountId);
  if (f.memberId) p.set("member_id", f.memberId);
  if (f.source) p.set("source", f.source);
  const q = searchText(f.q);
  if (q) p.set("q", q);
  return p.toString();
}

/** Một lượt tải danh sách: `size + 1` dòng sau con trỏ `before`; khoản đã xoá chỉ khi bật. */
export function bookPath(f: BookFilter, before?: number, size = BOOK_PAGE): string {
  const q = filterQuery(f);
  return `/v1/transactions?${q ? `${q}&` : ""}limit=${size + 1}${before === undefined ? "" : `&before=${before}`}${f.showVoid ? "&include_void=1" : ""}`;
}

/** Tổng theo cùng bộ lọc (khoản đã xoá không bao giờ cộng vào tổng). */
export function summaryPath(f: BookFilter): string {
  const q = filterQuery(f);
  return `/v1/transactions/summary${q ? `?${q}` : ""}`;
}

export type ChipKey = "dateRange" | "meaning" | "categoryId" | "accountId" | "memberId" | "source" | "showVoid";
export interface Chip {
  key: ChipKey;
  /** Loại cụ thể khi `key = "meaning"` (mỗi loại một chip). */
  value?: string;
  label: string;
}

/** Bộ lọc đang bật thành chip (tháng và chữ tìm có chỗ riêng ở đầu màn, không thành chip). */
export function filterChips(f: BookFilter, boot: Bootstrap | null): Chip[] {
  const chips: Chip[] = [];
  const range = dateRangeLabel(f.fromDate, f.toDate);
  if (range) chips.push({ key: "dateRange", label: range });
  const name = <T extends { id: string; name: string }>(list: T[] | undefined, id: string) => list?.find((x) => x.id === id)?.name ?? id;
  chips.push(...f.meanings.map((m) => ({ key: "meaning" as const, value: m, label: BOOK_MEANINGS.find((x) => x.value === m)?.label ?? m })));
  if (f.categoryId) chips.push({ key: "categoryId", label: name(boot?.categories, f.categoryId) });
  if (f.accountId) chips.push({ key: "accountId", label: name(boot?.accounts, f.accountId) });
  if (f.memberId) chips.push({ key: "memberId", label: `${name(boot?.members, f.memberId)} ghi` });
  if (f.source) chips.push({ key: "source", label: f.source === "bank" ? "Từ ngân hàng" : "Ghi tay" });
  if (f.showVoid) chips.push({ key: "showVoid", label: "Có khoản đã xoá" });
  return chips;
}

/** Chạm × trên một chip: bỏ đúng bộ lọc đó; bỏ khoảng ngày thì về tháng hiện tại. */
export function removeChip(f: BookFilter, chip: Chip, now = new Date()): BookFilter {
  if (chip.key === "dateRange") return { ...f, fromDate: null, toDate: null, month: monthKey(now) };
  if (chip.key === "meaning") return { ...f, meanings: f.meanings.filter((m) => m !== chip.value) };
  if (chip.key === "showVoid") return { ...f, showVoid: false };
  return { ...f, [chip.key]: null };
}

/** Bật / tắt một loại trong sheet Lọc, giữ thứ tự của danh sách loại. */
export function toggleMeaning(f: BookFilter, meaning: string): BookFilter {
  const on = f.meanings.includes(meaning) ? f.meanings.filter((m) => m !== meaning) : [...f.meanings, meaning];
  return { ...f, meanings: BOOK_MEANINGS.map((x) => x.value).filter((m) => on.includes(m)) };
}

/** Bỏ mọi bộ lọc trong sheet Lọc, giữ tháng (hoặc về tháng này nếu đang lọc khoảng ngày) và chữ tìm. */
export function clearFilters(f: BookFilter, now = new Date()): BookFilter {
  const hadRange = Boolean(f.fromDate || f.toDate);
  return { ...f, month: hadRange ? monthKey(now) : f.month, fromDate: null, toDate: null, meanings: [], categoryId: null, accountId: null, memberId: null, source: null, showVoid: false };
}

/**
 * Đi tháng: ‹ lùi một tháng, › tới một tháng nhưng không quá tháng hiện tại. Đang xem cả sổ thì ‹ về tháng hiện tại.
 * Trả null khi không đi được (nút mờ).
 */
export function stepMonth(month: string | null, delta: -1 | 1, now: Date): string | null {
  const current = monthKey(now);
  if (month === null) return delta === -1 ? current : null;
  if (delta === -1) return previousMonth(month);
  return month < current ? nextMonth(month) : null;
}

/**
 * Ngày điền sẵn khi ghi thêm từ sổ: đang xem một tháng đã qua → ngày cuối tháng đó (đổi được); khoảng ngày đã qua → ngày cuối;
 * tháng hiện tại hay cả sổ → hôm nay. Giờ ghi tính bằng `atForDay` như mọi lần chọn ngày lùi lại.
 */
export function entryDay(monthOrFilter: BookFilter | string | null, now: Date): string {
  const today = dayKey(now);
  if (typeof monthOrFilter === "object" && monthOrFilter !== null) {
    const last = monthOrFilter.fromDate || monthOrFilter.toDate ? (monthOrFilter.toDate ?? null) : undefined;
    if (last !== undefined) return last && last < today ? last : today;
    return entryDay(monthOrFilter.month, now);
  }
  const month = monthOrFilter;
  if (!month || month >= monthKey(now)) return today;
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

/**
 * Bộ lọc → query trên địa chỉ `#ledger?…` (UC-716 AC-23: F5 giữ bộ lọc). Chỉ ghi ô khác mặc định; đọc lại bằng `bookFromHashQuery`
 * ra đúng bộ lọc. Tháng đứng đầu, ghi khi không lọc khoảng ngày mà tháng khác tháng này hoặc có bộ lọc khác (`month=2026-11&category=…`,
 * UC-716 AC-25): `month=all` là cả sổ.
 */
export function bookHashQuery(f: BookFilter, now: Date): string {
  const p = new URLSearchParams();
  if (f.fromDate) p.set("from_date", f.fromDate);
  if (f.toDate) p.set("to_date", f.toDate);
  if (f.meanings.length) p.set("meaning", f.meanings.join(","));
  if (f.categoryId) p.set("category", f.categoryId);
  if (f.accountId) p.set("account_id", f.accountId);
  if (f.memberId) p.set("member_id", f.memberId);
  if (f.source) p.set("source", f.source);
  if (f.q) p.set("q", f.q);
  if (f.showVoid) p.set("include_void", "1");
  const rest = p.toString();
  if (f.fromDate || f.toDate || (f.month === monthKey(now) && rest === "")) return rest;
  const month = new URLSearchParams({ month: f.month ?? "all" }).toString();
  return rest ? `${month}&${rest}` : month;
}

/**
 * Địa chỉ `#ledger?…` → bộ lọc. Ô sai dạng (tháng, ngày, nguồn, loại lạ) bị bỏ qua như không có. Địa chỉ cũ theo kỳ lương
 * (`cycle=2026-11-10`, UC-716 AC-25) → tháng của ngày đó; `category_id` cũ đọc như `category`.
 */
export function bookFromHashQuery(query: string, now: Date): BookFilter {
  const p = new URLSearchParams(query);
  const day = (k: string) => {
    const v = p.get(k);
    return v && isDayKey(v) ? v : null;
  };
  const f = defaultFilter(now);
  const fromDate = day("from_date");
  const toDate = day("to_date");
  if (fromDate || toDate) return { ...f, ...rest(), month: null, fromDate, toDate };
  const month = p.get("month") ?? day("cycle")?.slice(0, 7) ?? null;
  return { ...f, ...rest(), month: month === "all" ? null : month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : f.month };

  function rest(): Pick<BookFilter, "meanings" | "categoryId" | "accountId" | "memberId" | "source" | "q" | "showVoid"> {
    const known = BOOK_MEANINGS.map((m) => m.value);
    const picked = (p.get("meaning") ?? "").split(",");
    const source = p.get("source");
    return {
      meanings: known.filter((m) => picked.includes(m)),
      categoryId: p.get("category") || p.get("category_id") || null,
      accountId: p.get("account_id") || null,
      memberId: p.get("member_id") || null,
      source: source === "manual" || source === "bank" ? source : null,
      q: p.get("q") ?? "",
      showVoid: p.get("include_void") === "1",
    };
  }
}

/** Chi thật của một nhóm dòng: chi tiêu − hoàn tiền, chỉ khoản còn hiệu lực. */
export function netSpend(rows: TxRow[]): number {
  return rows.reduce((s, r) => (r.status !== "active" ? s : r.meaning === "spend" ? s + r.amount : r.meaning === "refund" ? s - r.amount : s), 0);
}

export interface DayGroup {
  day: string;
  /** "T2 5/10 · chi 312.000 ₫" — không có khoản chi thì chỉ có ngày. */
  heading: string;
  rows: TxRow[];
}

/** Nhóm các dòng (đã sắp mới nhất trước) theo ngày giờ VN. */
export function groupByDay(rows: TxRow[]): DayGroup[] {
  const groups: { day: string; rows: TxRow[] }[] = [];
  for (const r of rows) {
    const day = dayKey(r.at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  return groups.map((g) => {
    const spend = netSpend(g.rows);
    return { ...g, heading: spend > 0 ? `${dayHeading(g.day)} · chi ${formatVnd(spend)}` : dayHeading(g.day) };
  });
}

/** Các số của dòng tổng theo đúng nghĩa tiền thật: chi = chi tiêu − hoàn tiền; chuyển nội bộ không cộng vào thu chi. */
export function summaryParts(s: TxSummary): { label: string; amount: number }[] {
  const parts = [
    { label: "Chi", amount: s.spend - s.refund, always: true },
    { label: "Thu", amount: s.income, always: true },
    { label: "Cho vay", amount: s.lend, always: false },
    { label: "Nhận lại", amount: s.collect, always: false },
    { label: "Chuyển nội bộ", amount: s.transfer, always: false },
    { label: "Mua tài sản", amount: s.buy_asset, always: false },
    { label: "Điều chỉnh", amount: s.adjust_in - s.adjust_out, always: false },
  ];
  return parts.filter((p) => p.always || p.amount !== 0).map(({ label, amount }) => ({ label, amount }));
}
