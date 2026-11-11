// Báo kỳ lương mới (notify UC-412): khi lương mở kỳ qua webhook SePay, Nhập, Gán hoặc MCP — sau khi batch ghi và bước ghép
// chuyển khoản đã chạy — gửi "Lương về · N việc" cho cả nhà. Rà soát đêm / "Đồng bộ lịch sử SePay" không gọi tới đây (tin sáng
// có dòng ☑️). Chống trùng theo (pay_cycle, ngày lương danh nghĩa, kênh): huỷ rồi mở lại kỳ cùng ngày lương không báo lại.

import { dayKey } from "../domain/period";
import type { Env } from "../env";
import { payCycleView } from "../services/pay-cycles";
import { hiddenAccountIds } from "../services/privacy";
import { payCycleMessage, type NotifyMessage } from "./format";
import { notifyMembers } from "./telegram";

/**
 * Tin của kỳ hiện tại có ngày lương `payday`; null khi kỳ đó không còn là kỳ hiện tại (đã huỷ, hoặc đã có kỳ sau). Tin gửi cả
 * nhà không có người xem: lương về tài khoản riêng tư có chủ còn hoạt động → tin không số nào (notify UC-412 AC-4).
 */
export async function payCycleNotice(db: D1Database, payday: string, now: Date): Promise<NotifyMessage | null> {
  const { view } = await payCycleView(db, dayKey(now), null);
  if (!view || view.payday !== payday) return null;
  const [income, hidden] = await Promise.all([
    db
      .prepare("SELECT t.amount, t.counter_account_id AS accountId FROM pay_cycles c JOIN transactions t ON t.id = c.income_tx_id WHERE c.id = ?")
      .bind(view.id)
      .first<{ amount: number; accountId: string | null }>(),
    hiddenAccountIds(db, null),
  ]);
  const hideAmounts = income?.accountId != null && hidden.includes(income.accountId);
  return payCycleMessage({ income: Number(income?.amount ?? 0), startedAt: view.startedAt, prevOperating: view.prevOperating, tasks: view.tasks }, { hideAmounts });
}

/** Gửi tin kỳ lương mới; lỗi dựng / gửi chỉ ghi log (không gửi bù, không làm hỏng khoản đã ghi — như UC-408 / UC-410). */
export async function notifyPayCycle(env: Env, payday: string): Promise<void> {
  try {
    const message = await payCycleNotice(env.DB, payday, new Date());
    if (message) await notifyMembers(env, "pay_cycle", payday, message);
  } catch (err) {
    console.error(`[pay_cycle] ${payday}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
