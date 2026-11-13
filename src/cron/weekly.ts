// Tổng kết tuần theo nhịp Vận hành, gửi vào ngày giờ cả nhà chọn ở Cài đặt (mặc định 08:00 thứ Hai, src/cron/schedule.ts) —
// specs/notify/UC-406. Số đọc qua ledger: chi tuần (`spendInWeek`), nhóm có hạn mức của tháng hiện tại (`spendByCategory`),
// tiền vận hành lúc gửi (snapshot `nearSpend`, cùng dòng Vận hành với tin sáng).

import { dayKey, isoWeekday, weekKey } from "../domain/period";
import type { Env } from "../env";
import { formatWeekLabel, weeklyMessage } from "../notify/format";
import { notifyMembers } from "../notify/telegram";
import { getSnapshot, spendByCategory, spendInWeek } from "../services/ledger";

/**
 * Ngày Chủ nhật (lịch VN) của tuần được tổng kết khi gửi lúc `now`: thứ Hai..thứ Bảy là tuần ISO vừa kết thúc,
 * Chủ nhật là tuần kết thúc hôm nay (tính tới lúc gửi).
 */
export function summarisedSunday(now: Date): Date {
  return new Date(now.getTime() - (isoWeekday(now) % 7) * 86_400_000);
}

export async function weekly(env: Env, now: Date): Promise<void> {
  const db = env.DB;

  const lastSunday = summarisedSunday(now);
  const weekKeyPrev = weekKey(lastSunday);
  const lastMonday = new Date(lastSunday.getTime() - 6 * 86_400_000);
  const weekLabel = formatWeekLabel(weekKeyPrev, dayKey(lastMonday), dayKey(lastSunday));

  const [week, lookBack, snapshot] = await Promise.all([spendInWeek(db, weekKeyPrev), spendByCategory(db, {}, now), getSnapshot(db, null, now)]);
  const topCategories = week.categories
    .filter((c) => c.spent > 0)
    .slice(0, 5)
    .map((c) => ({ name: c.name, spent: c.spent }));
  const limits = lookBack.groups.flatMap((g) => (g.limit === null ? [] : [{ name: g.name, spent: g.spent, limit: g.limit, over: g.over ?? 0 }]));

  await notifyMembers(
    env,
    "weekly",
    weekKeyPrev,
    weeklyMessage({ weekLabel, nearSpend: snapshot.nearSpend, totalSpent: week.totalSpent, operatingSpent: week.operatingSpent, topCategories, limits, month: lookBack.month }),
  );
}
