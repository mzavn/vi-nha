// Tin sáng, gửi vào giờ cả nhà chọn ở Cài đặt (mặc định 07:00 VN, src/cron/schedule.ts). Gộp luôn: chốt tháng ngày 1,
// nhắc đếm ví Chủ nhật, nhắc income chưa chia ngày 10 & 25 — xem plans/260921-2228-profit-first-pwa/phase-07-cron-telegram.md.

import { previousMonth } from "../domain/close";
import { dayKey, isoWeekday, monthKey } from "../domain/period";
import type { Env } from "../env";
import { dailyMessage, type DailyMessageInput } from "../notify/format";
import { notifyMembers } from "../notify/telegram";
import { closeMonth, getSnapshot, loadRefs, reconcile } from "../services/ledger";
import { unsettledTenants } from "../services/rental";

type ReconcileRow = {
  accountId: string;
  name: string;
  bookDrift: number | null;
  lastCountAt: string | null;
};

/**
 * Ngày 1 (lịch VN): chốt tháng trước (idempotent qua batch_id). Đây là việc của sổ, không phải thông báo —
 * tắt tin sáng thì lịch vẫn gọi riêng hàm này. Trả dòng "đã quét" cho tin sáng, null nếu không phải ngày 1 hay không có gì quét.
 */
export async function closePreviousMonthOnDayOne(db: D1Database, now: Date): Promise<DailyMessageInput["monthClose"]> {
  if (dayKey(now).slice(8, 10) !== "01") return null;
  const month = previousMonth(monthKey(now));
  const closed = await closeMonth(db, month);
  const sweptAmount = closed.sweeps.reduce((sum, s) => sum + s.amount, 0);
  if (sweptAmount === 0) return null;
  const { accounts } = await loadRefs(db);
  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  return {
    month,
    amount: sweptAmount,
    transfers: closed.transferOrders.map((o) => ({ fromName: nameOf(o.fromAccountId), toName: nameOf(o.toAccountId), amount: o.amount })),
  };
}

export async function daily(env: Env, now: Date): Promise<void> {
  const db = env.DB;
  const today = dayKey(now);
  const dayOfMonth = Number(today.slice(8, 10));

  // Ngày 1: chốt tháng trước trước tiên rồi mới build tin.
  const monthClose = await closePreviousMonthOnDayOne(db, now);

  // Ngày 1: nhắc chốt tháng trước với từng người thuê đang ở (chỉ nhắc — người chốt trên PWA, UC-804).
  const rentalSettleReminder = dayOfMonth === 1 ? await unsettledTenants(db, previousMonth(monthKey(now))) : [];

  const snapshot = await getSnapshot(db, null, now);

  const atRisk = snapshot.wallets
    .filter((w) => w.kind === "envelope" && (w.tier === "must" || w.tier === "nice"))
    .map((w) => {
      if (w.weekTarget !== null && w.weekTarget > 0) return { name: w.name, pct: ((w.spentWeek ?? 0) / w.weekTarget) * 100 };
      if (w.monthTarget !== null && w.monthTarget > 0) return { name: w.name, pct: ((w.spentMonth ?? 0) / w.monthTarget) * 100 };
      return null;
    })
    .filter((w): w is { name: string; pct: number } => w !== null && w.pct >= 80)
    .sort((a, b) => b.pct - a.pct);

  const goals = snapshot.goals.filter((g) => g.pct !== null).map((g) => ({ name: g.name, pct: g.pct! }));

  const recon = (await reconcile(db)) as unknown as ReconcileRow[];
  const driftAccounts = recon
    .filter((r) => (r.bookDrift ?? 0) !== 0)
    .map((r) => ({ name: r.name, amount: r.bookDrift! }));

  // Chủ nhật: nhắc đếm ví tiền mặt + nhập số dư TK ghi tay nếu chưa có cash_counts trong 7 ngày.
  let cashCountReminder: string[] = [];
  if (isoWeekday(now) === 7) {
    const { accounts } = await loadRefs(db);
    const cutoff = now.getTime() - 7 * 86_400_000;
    cashCountReminder = accounts
      .filter((a) => a.kind === "cash" || ((a.kind === "bank" || a.kind === "ewallet") && !a.sepayEnabled))
      .filter((a) => {
        const lastCountAt = recon.find((r) => r.accountId === a.id)?.lastCountAt ?? null;
        return !lastCountAt || Date.parse(lastCountAt) < cutoff;
      })
      .map((a) => a.name);
  }

  // Hôm qua (ngày VN liền trước hôm nay): cặp transfer tự ghép, theo thời điểm giao dịch (`at`), không phải lúc ghi sổ.
  const yesterdayKey = dayKey(new Date(now.getTime() - 86_400_000));
  const pairedRows = await db
    .prepare("SELECT at FROM transactions WHERE status = 'active' AND meaning = 'transfer' AND log_id_2 IS NOT NULL AND at >= ?")
    .bind(new Date(now.getTime() - 2 * 86_400_000).toISOString())
    .all<{ at: string }>();
  const pairedTransfersYesterday = (pairedRows.results ?? []).filter((r) => dayKey(r.at) === yesterdayKey).length;

  // Đêm qua (cron 02:00 VN cùng ngày hôm nay — xem báo cáo phase cho quy ước day_key giữa hai cron).
  const backfillRow = await db.prepare("SELECT payload FROM notifications WHERE kind = 'backfill' AND day_key = ?").bind(today).first<{ payload: string }>();
  const backfillPayload = backfillRow ? (JSON.parse(backfillRow.payload) as { added?: number; scope?: "day" | "week" | "month" }) : null;
  const backfillAddedLastNight = backfillPayload?.added ?? 0;
  const backfillScope = backfillPayload?.scope;

  // Payload ngân hàng hỏng trong 24 giờ qua (webhook hoặc rà soát đêm) — không vào sổ được, phải báo.
  const unreadable = await db
    .prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'ingest_error' AND at >= datetime('now', '-1 day')")
    .first<{ n: number }>();
  const unreadableBankTransactions = Number(unreadable?.n ?? 0);

  // Ngày 10 & 25: chỉ nhắc, không tự chia. Cùng định nghĩa "chưa chia" với banner Hôm nay (snapshot).
  let incomeReminder: DailyMessageInput["incomeReminder"] = null;
  const unallocatedCount = snapshot.attention.unallocatedIncome.count;
  if ((dayOfMonth === 10 || dayOfMonth === 25) && unallocatedCount > 0) incomeReminder = { day: dayOfMonth, unallocatedCount };

  // Sổ nợ, sổ phải thu: chỉ cộng khoản đang theo dõi còn số dư > 0 (dư ở một khoản không bù sang khoản khác).
  const [debtRow, receivableRow] = await db.batch<{ balance: number; count: number }>([
    db.prepare("SELECT COALESCE(SUM(balance), 0) AS balance, COUNT(*) AS count FROM v_debt_balance WHERE active = 1 AND balance > 0"),
    db.prepare("SELECT COALESCE(SUM(balance), 0) AS balance, COUNT(*) AS count FROM v_receivable_balance WHERE active = 1 AND balance > 0"),
  ]);
  const total = (r: D1Result<{ balance: number; count: number }>) => ({
    balance: Number(r.results?.[0]?.balance ?? 0),
    count: Number(r.results?.[0]?.count ?? 0),
  });
  const debts = total(debtRow!);
  const receivables = total(receivableRow!);

  const message = dailyMessage({
    spendableThisWeek: snapshot.spendableThisWeek,
    daysLeftInWeek: 8 - isoWeekday(now),
    atRisk,
    unassignedCount: snapshot.attention.pendingLogs,
    goals,
    safetyFundMonthsCovered: snapshot.safetyFund.monthsCovered,
    safetyFundMonthsTarget: snapshot.safetyFund.months,
    driftAccounts,
    transferOrdersOverdue: snapshot.attention.transferOrdersOverdue,
    pairedTransfersYesterday,
    backfillAddedLastNight,
    backfillScope,
    unreadableBankTransactions,
    monthClose,
    incomeReminder,
    cashCountReminder,
    rentalSettleReminder,
    debts,
    receivables,
  });

  await notifyMembers(env, "daily", today, message);
}
