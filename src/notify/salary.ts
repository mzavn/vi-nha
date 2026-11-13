// Báo lương về (notify UC-412): khi một khoản lương ghi qua webhook SePay, Nhập, Gán hoặc MCP sinh nhắc ① trích Tích luỹ —
// sau khi batch ghi và bước ghép chuyển khoản đã chạy — gửi "Lương về · trích X" cho cả nhà. Rà soát đêm / "Đồng bộ lịch sử
// SePay" không gọi tới đây (tin sáng có dòng Chưa trích Tích luỹ): chỉ người gọi quyết. Chống trùng theo (salary, id khoản thu, kênh): mỗi
// khoản lương báo đúng một lần.

import type { Env } from "../env";
import { getSnapshot } from "../services/ledger";
import { hiddenAccountIds } from "../services/privacy";
import { salaryMessage, type NotifyMessage } from "./format";
import { notifyMembers } from "./telegram";

/**
 * Tin của khoản lương `txId`; null khi khoản đó không còn nhắc ① hiệu lực (đã huỷ, không phải lương, lương về ngăn Tích luỹ).
 * Tin gửi cả nhà không có người xem: lương về tài khoản riêng tư có chủ còn hoạt động → tin không số nào (ADR-133).
 */
export async function salaryNotice(db: D1Database, txId: number, now: Date): Promise<NotifyMessage | null> {
  const task = await db
    .prepare(
      `SELECT t.amount AS income, t.counter_account_id AS accountId, k.amount, k.pct FROM month_tasks k JOIN transactions t ON t.id = k.income_tx_id
       WHERE k.income_tx_id = ? AND k.kind = 'savings' AND k.status <> 'void' AND t.status = 'active'`,
    )
    .bind(txId)
    .first<{ income: number; accountId: string | null; amount: number; pct: number | null }>();
  if (!task) return null;
  const [hidden, snapshot] = await Promise.all([hiddenAccountIds(db, null), getSnapshot(db, null, now)]);
  const hideAmounts = task.accountId !== null && hidden.includes(task.accountId);
  return salaryMessage({ income: Number(task.income), amount: Number(task.amount), pct: Number(task.pct ?? 0), goalHint: snapshot.month.goalHint }, { hideAmounts });
}

/** Gửi tin lương về; lỗi dựng / gửi chỉ ghi log (không gửi bù, không làm hỏng khoản đã ghi — như UC-408 / UC-410). */
export async function notifySalary(env: Env, txId: number): Promise<void> {
  try {
    const message = await salaryNotice(env.DB, txId, new Date());
    if (message) await notifyMembers(env, "salary", String(txId), message);
  } catch (err) {
    console.error(`[salary] ${txId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
