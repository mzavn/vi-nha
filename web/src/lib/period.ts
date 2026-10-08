// Nhãn kỳ theo DESIGN.md §5: tuần `T38 (14–20/9)`, tháng `tháng 9/2026`. Mọi ngày giờ theo giờ Việt Nam.

export { dayKey, monthKey, weekKey } from "../../../src/domain/period";
import { dayKey, weekKey } from "../../../src/domain/period";

const VN_OFFSET_MS = 7 * 3600_000;
const EN_DASH = "–";
const WEEKDAYS = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

const parts = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return { y: y ?? 0, m: m ?? 0, d: d ?? 0 };
};

/** `2026-W39`, `2026-09-21`, `2026-09-27` → `T39 (21–27/9)`; tuần vắt qua hai tháng → `T40 (28/9–4/10)`. */
export function weekLabel(key: string, start: string, end: string): string {
  const n = Number(key.split("-W")[1]);
  const a = parts(start);
  const b = parts(end);
  const range = a.m === b.m ? `${a.d}${EN_DASH}${b.d}/${b.m}` : `${a.d}/${a.m}${EN_DASH}${b.d}/${b.m}`;
  return `T${n} (${range})`;
}

/** `2026-09` → `tháng 9/2026` */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `tháng ${m}/${y}`;
}

/** Thứ Hai..Chủ nhật của tuần chứa `at`, theo giờ VN. */
export function weekRange(at: Date | string): { key: string; start: string; end: string } {
  const today = dayKey(at);
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  const start = new Date(d.getTime() - (dow - 1) * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { key: weekKey(at), start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** `2026-09-22` → `Thứ Ba 22/9` */
export function dayHeading(day: string): string {
  const { y, m, d } = parts(day);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[dow]} ${d}/${m}`;
}

/** `2026-09-22` → `22/9` */
export function shortDate(dayOrIso: string): string {
  const day = dayOrIso.length > 10 ? dayKey(dayOrIso) : dayOrIso;
  const { m, d } = parts(day);
  return `${d}/${m}`;
}

/** Giờ:phút theo giờ VN, ví dụ `14:05`. */
export function timeHM(iso: string): string {
  const t = new Date(Date.parse(iso) + VN_OFFSET_MS);
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

/** Số ngày còn lại của tuần, tính cả hôm nay. */
export function daysLeftInWeek(today: string, weekEnd: string): number {
  return Math.round((Date.parse(`${weekEnd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * Dòng phụ dưới số hero, viết đủ chữ để không đọc nhầm: "Tuần này còn 3 ngày (hết CN 4/10) · tháng 10 còn 4 tuần nữa".
 * `weeksLeftInMonth` tính cả tuần đang chạy (domain/period), nên số tuần *sau* tuần này là `weeksLeftInMonth − 1`.
 */
export function weekMetaText(today: string, weekEnd: string, weeksLeftInMonth: number): string {
  const days = daysLeftInWeek(today, weekEnd);
  const [, em, ed] = weekEnd.split("-").map(Number);
  const week = days <= 1 ? `Hôm nay là ngày cuối tuần (CN ${ed}/${em})` : `Tuần này còn ${days} ngày (hết CN ${ed}/${em})`;
  const month = Number(today.split("-")[1]);
  const after = weeksLeftInMonth - 1;
  return `${week} · ${after <= 0 ? `đây là tuần cuối của tháng ${month}` : `tháng ${month} còn ${after} tuần nữa`}`;
}

/** Số hero âm không viết "Còn để chi … −X": đổi nhãn thành "đã chi vượt" và hiện số dương (đỏ). */
export function heroLabel(spendable: number): { label: string; amount: number; over: boolean } {
  return spendable < 0
    ? { label: "Tuần này đã chi vượt", amount: -spendable, over: true }
    : { label: "Còn để chi tuần này", amount: spendable, over: false };
}

/** ISO cho một ngày được chọn lùi lại: giữ giờ hiện tại nếu là hôm nay, còn lại lấy 12:00 giờ VN. */
export function atForDay(day: string, now: Date): string {
  if (day === dayKey(now)) return now.toISOString();
  return new Date(`${day}T12:00:00+07:00`).toISOString();
}

/** `2026-09` → `2026-08`; `2026-01` → `2025-12`. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** `2026-09` → `2026-10`; `2026-12` → `2027-01`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Ngày hôm trước theo lịch VN. */
export function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
