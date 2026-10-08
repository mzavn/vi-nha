// Mọi kỳ tính theo giờ Việt Nam (UTC+7, không có giờ mùa hè) — không theo UTC của Worker,
// và không dùng strftime('%W') của SQLite vì nó không phải tuần ISO.

const VN_OFFSET_MS = 7 * 3600_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Ngày theo lịch VN, biểu diễn bằng một Date mà các getter UTC trả đúng ngày giờ VN. */
function vn(at: string | Date): Date {
  const t = typeof at === "string" ? Date.parse(at) : at.getTime();
  if (Number.isNaN(t)) throw new Error(`Thời điểm không hợp lệ: ${String(at)}`);
  return new Date(t + VN_OFFSET_MS);
}

export function dayKey(at: string | Date): string {
  const d = vn(at);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function monthKey(at: string | Date): string {
  return dayKey(at).slice(0, 7);
}

/** Tuần ISO 8601: tuần bắt đầu thứ Hai, tuần 1 là tuần chứa ngày thứ Năm đầu tiên của năm. */
export function weekKey(at: string | Date): string {
  const d = vn(at);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = day.getUTCDay() || 7; // CN = 7
  day.setUTCDate(day.getUTCDate() + 4 - dow); // nhảy tới thứ Năm của tuần này: năm của nó là năm ISO
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${pad(week)}`;
}

/** 1 = thứ Hai .. 7 = Chủ nhật (ISO), theo lịch VN. */
export function isoWeekday(at: string | Date): number {
  return vn(at).getUTCDay() || 7;
}

/** Phút trong ngày theo giờ VN: 0 (00:00) .. 1439 (23:59). */
export function minuteOfDay(at: string | Date): number {
  const d = vn(at);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function mondaysBetween(year: number, month1: number, fromDay: number): number {
  let n = 0;
  for (let day = fromDay; day <= daysInMonth(year, month1); day++) {
    if (new Date(Date.UTC(year, month1 - 1, day)).getUTCDay() === 1) n++;
  }
  return n;
}

/** Số ngày thứ Hai rơi vào tháng (4 hoặc 5) — hệ số đổi phong bì tuần sang nhu cầu tháng. */
export function mondaysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error(`month_key không hợp lệ: ${month}`);
  return mondaysBetween(y, m, 1);
}

/** Số tuần còn lại trong tháng, tính cả tuần đang chạy. */
export function weeksLeftInMonth(at: string | Date): number {
  const d = vn(at);
  return 1 + mondaysBetween(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() + 1);
}

/** Ngày thứ Hai (`YYYY-MM-DD`) của tuần ISO `2026-W39`. */
export function weekStart(week: string): string {
  const [y, w] = week.split("-W").map(Number);
  if (!y || !w || w < 1 || w > 53) throw new Error(`week_key không hợp lệ: ${week}`);
  const jan4 = new Date(Date.UTC(y, 0, 4)); // ngày 4/1 luôn thuộc tuần 1
  const monday = Date.UTC(y, 0, 4 - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  return new Date(monday).toISOString().slice(0, 10);
}

/** Số tháng còn để nạp cho một mục tiêu, tính cả tháng hiện tại; tối thiểu 1 (kể cả khi đã quá hạn). */
export function monthsLeft(at: string | Date, targetDate: string): number {
  const now = vn(at);
  const [ty, tm] = targetDate.slice(0, 7).split("-").map(Number);
  if (!ty || !tm) throw new Error(`target_date không hợp lệ: ${targetDate}`);
  return Math.max(1, (ty - now.getUTCFullYear()) * 12 + (tm - (now.getUTCMonth() + 1)));
}
