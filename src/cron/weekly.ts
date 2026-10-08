// Tổng kết tuần, gửi vào ngày giờ cả nhà chọn ở Cài đặt (mặc định 08:00 thứ Hai, src/cron/schedule.ts).
// Không có bước reset — counter tuần là view theo week_key, tự về 0 (docs/core_design_rules.md §5).

import { dayKey, isoWeekday, weekKey } from "../domain/period";
import type { Env } from "../env";
import { formatWeekLabel, weeklyMessage } from "../notify/format";
import { notifyMembers } from "../notify/telegram";
import { getBudget } from "../services/ledger";

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

  const budget = await getBudget(db, weekKeyPrev, null);
  const envelopes = budget.lines
    .filter((l): l is typeof l & { target: number } => l.target !== null)
    .map((l) => ({ name: l.name, spent: l.spent ?? 0, target: l.target }));

  // Chi theo danh mục trong tuần: cùng công thức spend − refund của v_spend_by_category, chỉ đổi khoá lọc từ
  // month_key sang week_key (view gốc không có bản theo tuần). Tổng mọi danh mục là tổng chi tuần; top 5 chỉ lấy danh mục > 0.
  const catRows = await db
    .prepare(
      `SELECT t.category_id AS categoryId, c.name AS name,
              SUM(CASE t.meaning WHEN 'spend' THEN t.amount ELSE -t.amount END) AS spent
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.status = 'active' AND t.meaning IN ('spend', 'refund') AND t.week_key = ?
       GROUP BY t.category_id
       ORDER BY spent DESC`,
    )
    .bind(weekKeyPrev)
    .all<{ categoryId: string; name: string | null; spent: number }>();
  const rows = catRows.results ?? [];
  const topCategories = rows
    .filter((r) => r.spent > 0)
    .slice(0, 5)
    .map((r) => ({ name: r.name ?? r.categoryId, spent: r.spent }));
  const totalSpent = rows.reduce((sum, r) => sum + r.spent, 0);

  await notifyMembers(env, "weekly", weekKeyPrev, weeklyMessage({ weekLabel, envelopes, topCategories, totalSpent }));
}
