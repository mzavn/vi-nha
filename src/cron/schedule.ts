// Tin sáng và tổng kết tuần theo giờ cả nhà chọn ở Cài đặt (ADR-68, ADR-70). Không có cron riêng: mỗi lượt cron
// đọc lịch + mốc đã chạy bằng MỘT câu SELECT, chưa tới giờ hay đã chạy rồi thì về ngay, không đọc gì thêm.
// Tới giờ (hoặc đã qua mà hôm nay chưa chạy — Worker lỡ một lượt) thì giành mốc `daily_run`/`weekly_run`
// trong notifications; chỉ lượt giành được mới gửi, nên không bao giờ gửi hai lần trong một ngày / một tuần.

import { clockMinutes, NOTIFY_CONFIG_KEYS, parseNotifySchedule, type NotifySchedule } from "../domain/notify-schedule";
import { dayKey, isoWeekday, minuteOfDay, weekKey } from "../domain/period";
import type { Env } from "../env";
import { closePreviousMonthOnDayOne, daily } from "./daily";
import { summarisedSunday, weekly } from "./weekly";

export interface NotifyState {
  schedule: NotifySchedule;
  /** day_key lớn nhất của mốc `daily_run` (ngày VN `YYYY-MM-DD`), null nếu chưa chạy lần nào. */
  lastDailyRun: string | null;
  /** day_key lớn nhất của mốc `weekly_run` (tuần ISO `YYYY-Www` được tổng kết). */
  lastWeeklyRun: string | null;
}

const KEYS = Object.values(NOTIFY_CONFIG_KEYS);
// MAX(day_key) đúng thứ tự vì `YYYY-MM-DD` và `YYYY-Www` so sánh chuỗi như so sánh thời gian.
const STATE_SQL = `SELECT k, v FROM config WHERE k IN (${KEYS.map(() => "?").join(", ")})
UNION ALL
SELECT kind, MAX(day_key) FROM notifications WHERE kind IN ('daily_run', 'weekly_run') AND chat_id = 'system' GROUP BY kind`;

/** Câu đọc duy nhất của mỗi lượt cron cho phần thông báo: lịch + mốc đã chạy. */
export async function loadNotifyState(db: D1Database): Promise<NotifyState> {
  const res = await db
    .prepare(STATE_SQL)
    .bind(...KEYS)
    .all<{ k: string; v: string | null }>();
  const map: Record<string, string> = {};
  for (const r of res.results ?? []) if (r.v !== null) map[r.k] = r.v;
  return { schedule: parseNotifySchedule(map), lastDailyRun: map.daily_run ?? null, lastWeeklyRun: map.weekly_run ?? null };
}

/** Giành mốc chạy; true nếu lượt này là lượt duy nhất được chạy. */
async function claimRun(db: D1Database, kind: "daily_run" | "weekly_run", key: string): Promise<boolean> {
  const r = await db.prepare("INSERT OR IGNORE INTO notifications (kind, day_key, chat_id, payload, ok) VALUES (?, ?, 'system', NULL, 1)").bind(kind, key).run();
  return Boolean(r.meta.changes);
}

/**
 * Chạy việc sau khi đã giành mốc. Việc ném lỗi (DB hỏng giữa chừng) thì nhả mốc để lượt cron sau làm lại —
 * an toàn vì chốt tháng idempotent và notifyMembers không gửi lại người đã nhận.
 */
async function runClaimed(db: D1Database, kind: "daily_run" | "weekly_run", key: string, job: () => Promise<unknown>): Promise<void> {
  if (!(await claimRun(db, kind, key))) return;
  try {
    await job();
  } catch (err) {
    await db.prepare("DELETE FROM notifications WHERE kind = ? AND day_key = ? AND chat_id = 'system'").bind(kind, key).run();
    throw err;
  }
}

export async function runScheduledDigests(env: Env, now: Date, state: NotifyState): Promise<void> {
  const { schedule } = state;
  const minute = minuteOfDay(now);
  const today = dayKey(now);
  const jobs: Promise<void>[] = [];

  // Tin sáng. Tắt tin sáng thì ngày 1 vẫn chốt tháng (việc của sổ) vào đúng giờ đó, chỉ không gửi gì.
  if (state.lastDailyRun !== today && minute >= clockMinutes(schedule.dailyTime)! && (schedule.dailyEnabled || today.endsWith("-01"))) {
    jobs.push(runClaimed(env.DB, "daily_run", today, () => (schedule.dailyEnabled ? daily(env, now) : closePreviousMonthOnDayOne(env.DB, now))));
  }

  // Tổng kết tuần: đúng thứ đã chọn, từ giờ đã chọn; mốc theo tuần được tổng kết nên đổi thứ trong tuần không gửi lại.
  if (schedule.weeklyEnabled && isoWeekday(now) === schedule.weeklyDay && minute >= clockMinutes(schedule.weeklyTime)!) {
    const week = weekKey(summarisedSunday(now));
    if (state.lastWeeklyRun !== week) jobs.push(runClaimed(env.DB, "weekly_run", week, () => weekly(env, now)));
  }

  const failed = (await Promise.allSettled(jobs)).filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length) throw new AggregateError(failed.map((r) => r.reason), "gửi tin theo lịch lỗi");
}
