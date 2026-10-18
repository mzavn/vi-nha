// Tin sáng, gửi vào giờ cả nhà chọn ở Cài đặt (mặc định 07:00 VN, src/cron/schedule.ts). Gộp luôn: mời chốt tháng ngày 1,
// nhắc đếm ví Chủ nhật, nhắc income chưa chia ngày 10 & 25 — xem plans/260921-2228-profit-first-pwa/phase-07-cron-telegram.md.

import { previousMonth } from "../domain/close";
import { dayKey, isoWeekday, monthKey } from "../domain/period";
import type { Env } from "../env";
import { dailyMessage, type DailyMessageInput } from "../notify/format";
import { notifyMembers } from "../notify/telegram";
import { getSnapshot, loadRefs, previewMonthClose, reconcile } from "../services/ledger";
import { unsettledTenants } from "../services/rental";

type ReconcileRow = {
  accountId: string;
  name: string;
  bookDrift: number | null;
  lastCountAt: string | null;
};

/**
 * Ngày 1 (lịch VN): mời chốt tháng trước (UC-207, ADR-111) — cron không ghi gì vào sổ, người bấm chốt trên app.
 * null nếu không phải ngày 1, tháng trước đã chốt, hay không có phong bì chung nào dương (không gì để dư hay để bù).
 */
export async function monthCloseInvite(db: D1Database, now: Date): Promise<DailyMessageInput["monthClose"]> {
  if (dayKey(now).slice(8, 10) !== "01") return null;
  const view = await previewMonthClose(db, now);
  if (view.closed || view.positiveTotal === 0) return null;
  return { month: view.month, profit: view.profit, covered: view.covered };
}

export async function daily(env: Env, now: Date): Promise<void> {
  const db = env.DB;
  const today = dayKey(now);
  const dayOfMonth = Number(today.slice(8, 10));

  // Ngày 1: mời chốt tháng trước nếu còn dư hoặc có chi lố được bù.
  const monthClose = await monthCloseInvite(db, now);

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

  // Hôm qua máy tự ghi lãi tiền gửi (change 261018-lai-tien-gui). Dấu hiệu tất định của Ghi lãi: khoản thu từ log, không người
  // ghi, Thu nhập thụ động, đợt chia có đúng một fund bằng trọn số tiền và không lệnh chuyển nào (lương tự chia luôn qua dòng
  // thác, nên lương bị xếp lại Thu nhập thụ động không lọt vào). Theo thời điểm giao dịch (`at`) như dòng tự ghép.
  const interestRows = await db
    .prepare(
      `SELECT t.id, t.at, t.amount, MIN(w.name) AS wallet, MIN(w.sort) AS sort FROM transactions t
       JOIN transaction_report_classes rc ON rc.transaction_id = t.id AND rc.report_class = 'passive_income'
       JOIN allocation_runs ar ON ar.income_tx_id = t.id
       JOIN transactions f ON f.batch_id = ar.batch_id AND f.meaning = 'fund' AND f.status = 'active' AND f.amount = t.amount
       JOIN wallets w ON w.id = f.wallet_id
       WHERE t.status = 'active' AND t.meaning = 'income' AND t.log_id IS NOT NULL AND t.by_member_id IS NULL AND t.at >= ?
         AND (SELECT COUNT(*) FROM transactions x WHERE x.batch_id = ar.batch_id AND x.meaning = 'fund' AND x.status = 'active') = 1
         AND NOT EXISTS (SELECT 1 FROM transfer_orders o WHERE o.batch_id = ar.batch_id)
       GROUP BY t.id`,
    )
    .bind(new Date(now.getTime() - 2 * 86_400_000).toISOString())
    .all<{ at: string; amount: number; wallet: string; sort: number }>();
  const interest = (interestRows.results ?? []).filter((r) => dayKey(r.at) === yesterdayKey);
  const interestYesterday = {
    total: interest.reduce((s, r) => s + Number(r.amount), 0),
    count: interest.length,
    wallets: [...new Set(interest.sort((a, b) => a.sort - b.sort).map((r) => r.wallet))],
  };

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
    interestYesterday,
  });

  await notifyMembers(env, "daily", today, message);
}
