// Tin sáng, gửi vào giờ cả nhà chọn ở Cài đặt (mặc định 07:00 VN, src/cron/schedule.ts). Gộp luôn: dòng 🔎 nhìn lại kỳ này,
// việc ngày lương còn mở, nhắc đếm tiền mặt Chủ nhật, nhắc lập bản tính tháng trước cho người thuê ngày 1 — xem specs/notify/UC-402.

import { limitNudges } from "../domain/look-back";
import { dayKey, isoWeekday, monthKey, previousMonth } from "../domain/period";
import type { Env } from "../env";
import { dailyMessage } from "../notify/format";
import { notifyMembers } from "../notify/telegram";
import { getSnapshot, loadRefs, reconcile, spendByCategory } from "../services/ledger";
import { hiddenAccountIds } from "../services/privacy";
import { billReminder } from "../services/rental";

type ReconcileRow = {
  accountId: string;
  name: string;
  bookDrift: number | null;
  lastCountAt: string | null;
};

export async function daily(env: Env, now: Date): Promise<void> {
  const db = env.DB;
  const today = dayKey(now);
  const dayOfMonth = Number(today.slice(8, 10));

  // Ngày 1: nhắc lập bản tính tháng trước cho từng người thuê đang ở chưa gửi (chỉ nhắc — người lập trên PWA, rental UC-806 AC-12).
  const billMonth = previousMonth(monthKey(now));
  const rentalBillReminder = dayOfMonth === 1 ? { month: billMonth, tenants: await billReminder(db, billMonth) } : undefined;

  const snapshot = await getSnapshot(db, null, now);

  // 🔎 Nhìn lại kỳ này (UC-402 bước 4): nhóm có hạn mức của kỳ lương hiện tại, mọi tài khoản (tài khoản riêng tư cộng vào tổng).
  const lookBack = await spendByCategory(db, {}, now);
  const nudges = lookBack.kind === "cycle" ? limitNudges(lookBack.groups, lookBack.cycle) : [];

  const recon = (await reconcile(db)) as unknown as ReconcileRow[];
  const driftAccounts = recon
    .filter((r) => (r.bookDrift ?? 0) !== 0)
    .map((r) => ({ name: r.name, amount: r.bookDrift! }));

  // Chủ nhật: nhắc đếm tiền mặt + nhập số dư TK ghi tay nếu chưa có cash_counts trong 7 ngày.
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
  // ghi, Thu nhập thụ động do máy đặt (người phân loại NULL) — lương bị người xếp lại Thu nhập thụ động không lọt vào. Theo
  // thời điểm giao dịch (`at`) như dòng tự ghép; "vào" là tài khoản nhận. Lãi vào tài khoản riêng tư có chủ còn hoạt động chỉ
  // được đếm, không số, không tên (notify UC-402 AC-40).
  const interestRows = await db
    .prepare(
      `SELECT t.at, t.amount, t.counter_account_id AS accountId, a.name AS account FROM transactions t
       JOIN transaction_report_classes rc ON rc.transaction_id = t.id AND rc.report_class = 'passive_income' AND rc.by_member_id IS NULL
       JOIN accounts a ON a.id = t.counter_account_id
       WHERE t.status = 'active' AND t.meaning = 'income' AND t.log_id IS NOT NULL AND t.by_member_id IS NULL AND t.at >= ?
       ORDER BY t.at, t.id`,
    )
    .bind(new Date(now.getTime() - 2 * 86_400_000).toISOString())
    .all<{ at: string; amount: number; accountId: string; account: string }>();
  const hidden = await hiddenAccountIds(db, null);
  const interestAll = (interestRows.results ?? []).filter((r) => dayKey(r.at) === yesterdayKey);
  const interest = interestAll.filter((r) => !hidden.includes(r.accountId));
  const interestYesterday = {
    total: interest.reduce((s, r) => s + Number(r.amount), 0),
    count: interest.length,
    accounts: [...new Set(interest.map((r) => r.account))],
    privateCount: interestAll.length - interest.length,
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
    nearSpend: snapshot.nearSpend,
    topUp: snapshot.topUp,
    limitNudges: nudges,
    unassignedCount: snapshot.attention.pendingLogs,
    reserveGoals: snapshot.pockets.reserve.goals,
    peace: snapshot.pockets.reserve.peace,
    peaceMonths: snapshot.pockets.reserve.peaceMonths,
    shortDebt: snapshot.pockets.shortDebt,
    day: today,
    driftAccounts,
    payTasksOpen: snapshot.payCycle?.openCount ?? 0,
    pairedTransfersYesterday,
    backfillAddedLastNight,
    backfillScope,
    unreadableBankTransactions,
    cashCountReminder,
    rentalBillReminder,
    debts,
    receivables,
    interestYesterday,
  });

  await notifyMembers(env, "daily", today, message);
}
