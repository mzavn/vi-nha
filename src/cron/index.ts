import { inQuietHours } from "../domain/notify-schedule";
import { minuteOfDay } from "../domain/period";
import type { Env } from "../env";
import { cancelStaleTestSeries } from "../services/push";
import { backfill } from "./backfill";
import { notifyPendingLogs } from "./pending-notifier";
import { loadNotifyState, runScheduledDigests } from "./schedule";

/**
 * Lịch trong wrangler.jsonc chạy theo UTC; giờ VN = UTC+7. Hai biểu thức, cùng một lượt (ADR-70):
 * mỗi 15 phút, trừ 01:00–03:59 VN chỉ chạy đúng giờ (đêm gần như không có giao dịch).
 */
export const CRONS = {
  quarterHour: "*/15 0-17,21-23 * * *", // mỗi 15 phút, trừ 18:00–20:59 UTC = 01:00–03:59 VN
  nightHourly: "0 18,19,20 * * *", // 01:00, 02:00, 03:00 VN
} as const;

/** Lượt 02:00 VN (19:00 UTC) chạy thêm rà soát giao dịch qua API SePay (UC-304). */
const BACKFILL_MINUTE = 2 * 60;

export async function runScheduled(cron: string, env: Env, now: Date): Promise<void> {
  switch (cron) {
    case CRONS.quarterHour:
    case CRONS.nightHourly:
      return tick(env, now);
    default:
      console.warn(`cron lạ: ${cron}`);
  }
}

/**
 * Các việc độc lập: một việc lỗi không được chặn việc khác. Lỗi vẫn ném ra để log của lần chạy cron thấy.
 * Lịch thông báo đọc một lần (một câu SELECT) cho cả tin theo giờ lẫn báo giao dịch chưa gán.
 */
async function tick(env: Env, now: Date): Promise<void> {
  const state = loadNotifyState(env.DB);
  const minute = minuteOfDay(now);
  const results = await Promise.allSettled([
    // Tắt, hoặc đang giờ yên lặng: để nguyên log chưa báo — lượt đầu tiên sau giờ yên lặng gom lại báo một tin.
    state.then(({ schedule: s }) => (s.pendingEnabled && !inQuietHours(minute, s.quietStart, s.quietEnd) ? notifyPendingLogs(env, now) : undefined)),
    state.then((s) => runScheduledDigests(env, now, s)),
    cancelStaleTestSeries(env, now),
    ...(minute === BACKFILL_MINUTE ? [backfill(env, now)] : []),
  ]);
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length) throw new AggregateError(failed.map((r) => r.reason), "lượt cron lỗi");
}
