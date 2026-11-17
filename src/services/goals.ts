// Khớp khoản chi vào mục tiêu Dự phòng (pocket UC-1209 AC-24…AC-31, ingest UC-303 AC-34): chốt xong / mở lại, khoản đã khớp, khoản
// gợi ý, khớp / gỡ khớp (UPDATE `goal_id` tại chỗ — cả khoản ngân hàng), việc chuyển về kiểu B (đối soát sau mỗi lần ghi, tự tick
// chuyển khoản, mã CV, Đã chuyển / Bỏ qua / Mở lại). Không ghi dòng sổ nào: báo cáo không đổi (AC-31).

import type { AuditAction } from "../domain/audit-actions";
import { GOAL_CLOSED, INVALID_GOAL } from "../domain/entry";
import { addDays, codesIn, vnMidnight } from "../domain/month-tasks";
import { dayKey } from "../domain/period";
import { addMonthsToDay, type GoalRefundView } from "../domain/pockets";
import { DomainError } from "../domain/types";
import { rethrowEntryTrigger } from "./ledger";
import { afterWrite, USED_SQL } from "./month-tasks";
import {
  advanceSql,
  goalGroupSql,
  goalSpentMap,
  goalSpentStatement,
  goalWindowSql,
  inWindowSql,
  QR_ACCOUNTS_SQL,
  readGoal,
  refundLinkedOfTxSql,
  refundLinkedSql,
  refundRowsSql,
  refundView,
  returnedSql,
  type GoalView,
  type QrAccount,
  type RefundRow,
} from "./pockets";
import { assertTxChangeable, assertTxReadable, hiddenAccountIds, hiddenTxSql, txNotFound } from "./privacy";

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const fail = (code: string, message: string, status = 400, field?: string): never => {
  throw new DomainError(code, message, status, field);
};
type Audit = { action: AuditAction; detail: Record<string, unknown> };

// ── Mục tiêu và cửa sổ ──────────────────────────────────────────────

interface GoalRow {
  id: string;
  name: string;
  accountId: string | null;
  paysFrom: "account" | "operating";
  repeatMonths: number | null;
  dueDate: string | null;
  closedAt: string | null;
  since: string;
  closed: number;
}

/** Mục tiêu đang dùng kèm cửa sổ (`goalWindowSql`); không có / đã tắt → 404. */
async function liveGoal(db: D1Database, id: string, now: Date): Promise<GoalRow> {
  const g = await db
    .prepare(
      `WITH w AS (${goalWindowSql(now)})
       SELECT g.id, g.name, g.account_id AS accountId, g.pays_from AS paysFrom, g.repeat_months AS repeatMonths, g.due_date AS dueDate,
              g.closed_at AS closedAt, w.since, w.closed
       FROM reserve_goals g JOIN w ON w.id = g.id WHERE g.id = ? AND g.active = 1`,
    )
    .bind(id)
    .first<GoalRow>();
  return g ?? fail("not_found", "Không có mục tiêu này.", 404);
}

/** Chỉ mục tiêu để ở một tài khoản mới chốt được (mục tiêu trả từ tiền chi tiêu tính theo tháng, không có "xong"). */
const assertAccountGoal = (g: GoalRow) => {
  if (g.paysFrom !== "account" || g.accountId === null) fail("invalid_goal", "Chỉ mục tiêu để ở một tài khoản mới chốt xong được.");
};

/** Mục tiêu lặp N tháng (N > 1): đợt chốt / mở lại theo `goal_periods`. */
const repeats = (g: GoalRow) => g.repeatMonths !== null && g.repeatMonths > 1;

/** `period_id` của mục tiêu lặp N tháng (bắt buộc gửi; null = đợt đầu chưa có dòng). */
function periodIdOf(b: Record<string, unknown>): number | null {
  const v = b.period_id;
  if (!("period_id" in b) || (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v <= 0))) {
    fail("invalid_input", "Mục tiêu lặp cần mã đợt đang xem (period_id, null khi chưa có).", 400, "period_id");
  }
  return v as number | null;
}

/**
 * `POST /v1/goals/:id/close { period_id? }` (UC-1209 AC-25): một lần / hằng tháng → `closed_at` = lúc chốt (đã chốt trong kỳ → không
 * đổi, vẫn 200); lặp N tháng (Q1) → chỉ khi `period_id` là đợt đang mở (khác → 200, không đổi — bấm hai lần không lùi hạn hai lần):
 * khép đợt đó (chưa có dòng → ghi đợt đầu từ ngày tạo), mở ngay đợt mới bắt đầu lúc chốt, hạn + N tháng. Không đổi số dư, báo cáo.
 */
export async function closeGoal(db: D1Database, id: string, b: Record<string, unknown>, viewerId: string | null, now: Date): Promise<{ goal: GoalView; audit: Audit | null }> {
  const g = await liveGoal(db, id, now);
  assertAccountGoal(g);
  const at = now.toISOString();
  let audit: Audit | null = null;
  if (repeats(g)) {
    const seen = periodIdOf(b);
    const open = await db.prepare("SELECT id FROM goal_periods WHERE goal_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1").bind(id).first<{ id: number }>();
    if (seen === (open ? Number(open.id) : null)) {
      const due = g.dueDate === null ? null : addMonthsToDay(g.dueDate, g.repeatMonths!);
      await db.batch([
        open
          ? db.prepare("UPDATE goal_periods SET closed_at = ? WHERE id = ? AND closed_at IS NULL").bind(at, open.id)
          : db.prepare("INSERT INTO goal_periods (goal_id, started_at, due_date, closed_at) VALUES (?, ?, ?, ?)").bind(id, g.since, g.dueDate, at),
        db.prepare("INSERT INTO goal_periods (goal_id, started_at, due_date) VALUES (?, ?, ?)").bind(id, at, due),
        db.prepare("UPDATE reserve_goals SET due_date = ? WHERE id = ?").bind(due, id),
      ]);
      audit = { action: "goal.close", detail: { due_date: { from: g.dueDate, to: due } } };
    }
  } else if (Number(g.closed) !== 1) {
    await db.prepare("UPDATE reserve_goals SET closed_at = ? WHERE id = ?").bind(at, id).run();
    audit = { action: "goal.close", detail: {} };
  }
  return { goal: await readGoal(db, id, now, viewerId), audit };
}

/**
 * `POST /v1/goals/:id/reopen { period_id? }` (UC-1209 AC-25): một lần / hằng tháng → `closed_at` NULL; lặp N tháng → chỉ khi `period_id`
 * là đợt mới nhất và đợt đó sinh từ một lần chốt (có đợt đã khép trước nó): xoá đợt đó, mở lại đợt vừa khép, hạn cũ. Còn lại → 200,
 * không đổi.
 */
export async function reopenGoal(db: D1Database, id: string, b: Record<string, unknown>, viewerId: string | null, now: Date): Promise<{ goal: GoalView; audit: Audit | null }> {
  const g = await liveGoal(db, id, now);
  assertAccountGoal(g);
  let audit: Audit | null = null;
  if (repeats(g)) {
    const seen = periodIdOf(b);
    const [last, prev] = rows<{ id: number; dueDate: string | null; closedAt: string | null }>(
      await db.prepare("SELECT id, due_date AS dueDate, closed_at AS closedAt FROM goal_periods WHERE goal_id = ? ORDER BY id DESC LIMIT 2").bind(id).all(),
    );
    if (last && last.closedAt === null && prev && seen === Number(last.id)) {
      await db.batch([
        db.prepare("DELETE FROM goal_periods WHERE id = ?").bind(last.id),
        db.prepare("UPDATE goal_periods SET closed_at = NULL WHERE id = ?").bind(prev.id),
        db.prepare("UPDATE reserve_goals SET due_date = ? WHERE id = ?").bind(prev.dueDate, id),
      ]);
      audit = { action: "goal.reopen", detail: { due_date: { from: g.dueDate, to: prev.dueDate } } };
    }
  } else if (g.closedAt !== null) {
    await db.prepare("UPDATE reserve_goals SET closed_at = NULL WHERE id = ?").bind(id).run();
    if (Number(g.closed) === 1) audit = { action: "goal.reopen", detail: {} };
  }
  return { goal: await readGoal(db, id, now, viewerId), audit };
}

/** Tiền ra của khoản bí danh `t` thuộc mục tiêu bí danh `g` (`own`): tài khoản trong nhóm (mục tiêu tài khoản) / ngăn Vận hành (trả từ tiền chi tiêu). */
const ownSql = (t: string, g: string) =>
  `(CASE WHEN ${g}.pays_from = 'operating' THEN ${t}.account_id IN (SELECT id FROM accounts WHERE pocket = 'operating')
    ELSE ${t}.account_id IN (${goalGroupSql(g)}) AND (${t}.counter_account_id IS NULL OR ${t}.counter_account_id NOT IN (${goalGroupSql(g)})) END)`;

/** Chuyển khoản chạm tài khoản riêng tư bị giấu ở một phía: ghi chú ẩn (như sổ giao dịch). */
const noteFor = (r: { note: unknown; account_id: unknown; counter_account_id: unknown }, hidden: string[]) =>
  hidden.includes(String(r.account_id)) || hidden.includes(String(r.counter_account_id)) ? null : r.note;

/**
 * `GET /v1/goals/:id/transactions` (UC-707 AC-45): khoản đã khớp của mục tiêu trong kỳ hiện tại (kể cả kiểu B), mới trước; khoản bị
 * giấu với người xem không có.
 */
export async function goalTransactions(db: D1Database, id: string, viewerId: string | null, now: Date) {
  await liveGoal(db, id, now);
  const hidden = await hiddenAccountIds(db, viewerId);
  const hiddenTx = hiddenTxSql("t", hidden);
  const list = rows<{ tx_id: number; at: string; note: string | null; amount: number; account_id: string; account_name: string | null; counter_account_id: string | null; own: number; refund_id: number | null }>(
    await db
      .prepare(
        `WITH w AS (${goalWindowSql(now)})
         SELECT t.id AS tx_id, t.at, t.note, t.amount, t.account_id, a.name AS account_name, t.counter_account_id, ${ownSql("t", "g")} AS own,
                (SELECT f.id FROM goal_refunds f WHERE f.spend_tx_id = t.id AND f.status <> 'void') AS refund_id
         FROM transactions t JOIN reserve_goals g ON g.id = t.goal_id JOIN w ON w.id = g.id LEFT JOIN accounts a ON a.id = t.account_id
         WHERE g.id = ? AND t.status = 'active' AND ${inWindowSql("t")} AND NOT ${hiddenTx.sql}
         ORDER BY t.at DESC, t.id DESC`,
      )
      .bind(id, ...hiddenTx.binds)
      .all(),
  );
  return {
    items: list.map((r) => ({
      tx_id: Number(r.tx_id),
      at: r.at,
      note: noteFor(r, hidden),
      amount: Number(r.amount),
      account_id: r.account_id,
      account_name: r.account_name,
      counter_account_id: r.counter_account_id,
      kind: Number(r.own) === 1 ? ("own" as const) : ("other" as const),
      refund_id: r.refund_id === null ? null : Number(r.refund_id),
    })),
  };
}

const CANDIDATE_LIMIT = 200;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * `GET /v1/goals/:id/candidates?q=&amount=&from=&to=` (UC-707 AC-46, UC-1209 AC-33, Q2, Q3, Q4): mặc định khoản chi / chuyển ra khỏi
 * nhóm từ tài khoản của mục tiêu, chưa gắn mục tiêu, chưa bỏ qua, trong kỳ, mới trước; có `q` (ghi chú / tên tài khoản), `amount` (đúng
 * số), `from`–`to` (ngày VN) thì mở rộng sang khoản chi từ tài khoản khác (kiểu B, chỉ mục tiêu để ở tài khoản), khoản đang ở mục tiêu
 * khác và khoản đã bỏ qua (`skipped`) — vẫn trong kỳ. Không rút từ lãi, không bị giấu với người xem.
 */
export async function goalCandidates(db: D1Database, id: string, q: { q?: string; amount?: string; from?: string; to?: string }, viewerId: string | null, now: Date) {
  await liveGoal(db, id, now);
  const hidden = await hiddenAccountIds(db, viewerId);
  const hiddenTx = hiddenTxSql("t", hidden);
  const text = q.q?.trim() || null;
  const amount = q.amount === undefined || q.amount === "" ? null : Number(q.amount);
  if (amount !== null && (!Number.isInteger(amount) || amount <= 0)) fail("invalid_input", "Số tiền là số nguyên lớn hơn 0.", 400, "amount");
  for (const k of ["from", "to"] as const) if (q[k] && !isDay(q[k]!)) fail("invalid_input", "Ngày có dạng 2026-11-17.", 400, k);
  const widened = text !== null || amount !== null || Boolean(q.from) || Boolean(q.to);
  const own = `(t.meaning IN ('spend', 'transfer') AND ${ownSql("t", "g")})`;
  const other = `(g.pays_from = 'account' AND t.meaning = 'spend' AND t.account_id NOT IN (${goalGroupSql("g")}))`;
  const filters: string[] = [];
  const binds: unknown[] = [id];
  if (widened) {
    filters.push(`(${own} OR ${other})`, "(t.goal_id IS NULL OR t.goal_id <> g.id)");
    if (text !== null) {
      filters.push("(t.note LIKE ? OR a.name LIKE ?)");
      binds.push(`%${text}%`, `%${text}%`);
    }
    if (amount !== null) {
      filters.push("t.amount = ?");
      binds.push(amount);
    }
    if (q.from) {
      filters.push("t.at >= ?");
      binds.push(vnMidnight(q.from));
    }
    if (q.to) {
      filters.push("t.at < ?");
      binds.push(vnMidnight(addDays(q.to, 1)));
    }
  } else filters.push(own, "t.goal_id IS NULL", "t.goal_skipped_at IS NULL");
  // Chuyển khoản đã ghép đủ vào việc chuyển về là tiền trả lại, không phải khoản cần khớp (UC-1209 AC-29).
  filters.push(`${refundLinkedOfTxSql("t")} < t.amount`);
  const list = rows<{ tx_id: number; at: string; note: string | null; amount: number; account_id: string; account_name: string | null; counter_account_id: string | null; goal_id: string | null; goal_name: string | null; own: number; skipped: number }>(
    await db
      .prepare(
        `WITH w AS (${goalWindowSql(now)})
         SELECT t.id AS tx_id, t.at, t.note, t.amount, t.account_id, a.name AS account_name, t.counter_account_id, t.goal_id, o.name AS goal_name, ${ownSql("t", "g")} AS own,
                t.goal_skipped_at IS NOT NULL AS skipped
         FROM reserve_goals g JOIN w ON w.id = g.id JOIN transactions t LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN reserve_goals o ON o.id = t.goal_id
         WHERE g.id = ? AND t.status = 'active' AND t.from_interest = 0 AND ${inWindowSql("t")} AND ${filters.join(" AND ")} AND NOT ${hiddenTx.sql}
         ORDER BY t.at DESC, t.id DESC LIMIT ${CANDIDATE_LIMIT}`,
      )
      .bind(...binds, ...hiddenTx.binds)
      .all(),
  );
  return {
    items: list.map((r) => ({
      tx_id: Number(r.tx_id),
      at: r.at,
      note: noteFor(r, hidden),
      amount: Number(r.amount),
      account_id: r.account_id,
      account_name: r.account_name,
      counter_account_id: r.counter_account_id,
      goal_id: r.goal_id,
      goal_name: r.goal_name,
      own: Number(r.own) === 1,
      skipped: Number(r.skipped) === 1,
    })),
  };
}

// ── Khớp / gỡ khớp / bỏ qua (UC-1209 AC-27, AC-28, AC-32) ───────────

const MATCH_LIMIT = 200;

const idList = (v: unknown, field: string): number[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "number" || !Number.isInteger(x) || x <= 0)) fail("invalid_input", "Danh sách mã giao dịch là các số nguyên dương.", 400, field);
  const ids = [...new Set(v as number[])];
  if (ids.length > MATCH_LIMIT) fail("invalid_input", `Tối đa ${MATCH_LIMIT} khoản một lần.`, 400, field);
  return ids;
};

export interface MatchResult {
  goal: GoalView;
  changes: { tx_id: number; from_goal_id: string | null; to_goal_id: string | null; from_skipped?: true }[];
  skipped: number[];
  unskipped: number[];
  refunds_created: { id: number; amount: number; from_account_id: string; to_account_id: string }[];
  refunds_voided: number[];
  audits: Audit[];
}

/**
 * `PUT /v1/goals/:id/transactions { add?, remove?, skip?, unskip? }` (UC-1209 AC-27, AC-28, AC-32, Q2, Q4): khớp thêm / gỡ khớp nhiều
 * khoản một lần — UPDATE `goal_id` tại chỗ (khoản ngân hàng không qua gỡ gán), khoản đang ở mục tiêu khác thì chuyển sang; `changes`
 * để Hoàn tác (`from_skipped` khi khoản đã bỏ qua trước lúc khớp). Rồi bỏ qua (`skip`: khoản chi / chuyển ra khỏi nhóm từ tài khoản của
 * mục tiêu, sau `remove` không gắn mục tiêu nào, trong kỳ) / bỏ bỏ-qua (`unskip`: chỉ cần khoản có và không bị giấu); `skipped` /
 * `unskipped` = khoản thật sự đổi. Mỗi danh sách ≤ 200 id, truyền một tham số JSON (`json_each`, giới hạn 100 tham số của D1); trùng
 * `skip`–`add`, `skip`–`unskip`, `remove`–`unskip` → 400 `invalid_input`. Mục tiêu đã chốt mà có `add` / `skip` → 409 `goal_closed`;
 * khoản bị giấu / không có → 404; khoản thu / mua tài sản / đã huỷ / rút từ lãi / không hợp mục tiêu → 400 `invalid_goal`; ngoài kỳ →
 * 400 `outside_window`. Kiểm hết rồi mới ghi, một batch. Sau đó đối soát việc chuyển về (`afterWrite`).
 */
export async function matchGoalTransactions(db: D1Database, id: string, b: Record<string, unknown>, viewerId: string | null, now: Date): Promise<MatchResult> {
  const g = await liveGoal(db, id, now);
  const add = idList(b.add, "add");
  const asked = idList(b.remove, "remove");
  const remove = asked.filter((x) => !add.includes(x));
  const skip = idList(b.skip, "skip");
  const unskip = idList(b.unskip, "unskip");
  const overlap = (x: number[], y: number[]) => x.some((v) => y.includes(v));
  if (overlap(skip, add) || overlap(skip, unskip) || overlap(asked, unskip)) fail("invalid_input", "Một khoản không vừa bỏ qua vừa khớp, hay vừa bỏ qua vừa hoàn tác.", 400, "skip");
  if ((add.length > 0 || skip.length > 0) && Number(g.closed) === 1) fail("goal_closed", GOAL_CLOSED, 409);
  const hidden = await hiddenAccountIds(db, viewerId);
  const changing = [...new Set([...add, ...remove, ...skip])];
  const ids = [...new Set([...changing, ...unskip])];
  type TxCheck = {
    id: number;
    status: string;
    meaning: string;
    account_id: string | null;
    counter_account_id: string | null;
    goal_id: string | null;
    goal_skipped_at: string | null;
    from_interest: number;
    own: number;
    other: number;
    inWin: number;
  };
  const found = ids.length
    ? rows<TxCheck>(
        await db
          .prepare(
            `WITH w AS (${goalWindowSql(now)})
             SELECT t.id, t.status, t.meaning, t.account_id, t.counter_account_id, t.goal_id, t.goal_skipped_at, t.from_interest, ${ownSql("t", "g")} AS own,
                    (g.pays_from = 'account' AND t.account_id NOT IN (${goalGroupSql("g")})) AS other, (${inWindowSql("t")}) AS inWin
             FROM reserve_goals g JOIN w ON w.id = g.id JOIN transactions t WHERE g.id = ? AND t.id IN (SELECT value FROM json_each(?))`,
          )
          .bind(id, JSON.stringify(ids))
          .all(),
      )
    : [];
  const byId = new Map(found.map((t) => [Number(t.id), t]));
  for (const txId of ids) {
    const t = byId.get(txId);
    if (!t) throw txNotFound();
    if (changing.includes(txId)) assertTxChangeable(t, hidden);
    else assertTxReadable(t, hidden);
  }
  const changes: MatchResult["changes"] = [];
  for (const txId of add) {
    const t = byId.get(txId)!;
    const fits = Number(t.own) === 1 ? t.meaning === "spend" || t.meaning === "transfer" : Number(t.other) === 1 && t.meaning === "spend";
    if (t.status !== "active" || !fits || Number(t.from_interest) === 1) fail("invalid_goal", INVALID_GOAL);
    if (Number(t.inWin) !== 1) fail("outside_window", "Khoản này ngoài kỳ của mục tiêu.");
    if (t.goal_id !== id) changes.push({ tx_id: txId, from_goal_id: t.goal_id, to_goal_id: id, ...(t.goal_skipped_at !== null ? { from_skipped: true as const } : {}) });
  }
  for (const txId of remove) if (byId.get(txId)!.goal_id === id) changes.push({ tx_id: txId, from_goal_id: id, to_goal_id: null });
  for (const txId of skip) {
    const t = byId.get(txId)!;
    const goalAfter = remove.includes(txId) && t.goal_id === id ? null : t.goal_id;
    const fits = Number(t.own) === 1 && (t.meaning === "spend" || t.meaning === "transfer");
    if (t.status !== "active" || !fits || goalAfter !== null || Number(t.from_interest) === 1) fail("invalid_goal", INVALID_GOAL);
    if (Number(t.inWin) !== 1) fail("outside_window", "Khoản này ngoài kỳ của mục tiêu.");
  }
  const skipped = skip.filter((txId) => byId.get(txId)!.goal_skipped_at === null);
  const unskipped = unskip.filter((txId) => byId.get(txId)!.goal_skipped_at !== null);
  const matched = changes.filter((c) => c.to_goal_id === id);
  const unmatched = changes.filter((c) => c.to_goal_id === null);
  const setGoal = (goalId: string | null, list: MatchResult["changes"]) =>
    db.prepare("UPDATE transactions SET goal_id = ? WHERE status = 'active' AND id IN (SELECT value FROM json_each(?))").bind(goalId, JSON.stringify(list.map((c) => c.tx_id)));
  const writes = [
    ...(matched.length ? [setGoal(id, matched)] : []),
    ...(unmatched.length ? [setGoal(null, unmatched)] : []),
    ...(skipped.length
      ? [
          db
            .prepare("UPDATE transactions SET goal_skipped_at = ? WHERE status = 'active' AND goal_id IS NULL AND goal_skipped_at IS NULL AND id IN (SELECT value FROM json_each(?))")
            .bind(now.toISOString(), JSON.stringify(skipped)),
        ]
      : []),
    ...(unskipped.length
      ? [db.prepare("UPDATE transactions SET goal_skipped_at = NULL WHERE goal_skipped_at IS NOT NULL AND id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(unskipped))]
      : []),
  ];
  if (writes.length > 0) {
    try {
      await db.batch(writes);
    } catch (err) {
      rethrowEntryTrigger(err);
      throw err;
    }
  }
  const { refundsCreated, refundsVoided } = await afterWrite(db, now);
  const audits: Audit[] = [
    ...(matched.length ? [{ action: "goal.match" as const, detail: { changes: matched } }] : []),
    ...(unmatched.length ? [{ action: "goal.unmatch" as const, detail: { changes: unmatched } }] : []),
    ...(skipped.length ? [{ action: "goal.skip" as const, detail: { tx_ids: skipped } }] : []),
    ...(unskipped.length ? [{ action: "goal.unskip" as const, detail: { tx_ids: unskipped } }] : []),
  ];
  return { goal: await readGoal(db, id, now, viewerId), changes, skipped, unskipped, refunds_created: refundsCreated, refunds_voided: refundsVoided, audits };
}

// ── Việc chuyển về kiểu B (UC-1209 AC-28, AC-29) ─────────────────────

/**
 * Câu ghi một liên kết việc chuyển về ← chuyển khoản: chỉ thành khi, TẠI LÚC GHI, chuyển khoản còn đủ phần chưa dùng (việc chuyển
 * về + việc tháng) và việc chưa huỷ / bỏ qua, chưa nhận đủ.
 */
export function linkRefundStatement(db: D1Database, refundId: number, txId: number, amount: number, now: Date, byCode = false): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO goal_refund_tx (refund_id, tx_id, amount, by_code, created_at) SELECT ?1, ?2, ?3, ?5, ?4
       WHERE EXISTS (SELECT 1 FROM goal_refunds WHERE id = ?1 AND status IN ('open', 'done'))
         AND (SELECT amount FROM transactions WHERE id = ?2 AND status = 'active') >= ${USED_SQL("?2")} + ?3
         AND ${refundLinkedSql("?1")} + ?3 <= (SELECT amount FROM goal_refunds WHERE id = ?1)`,
    )
    .bind(refundId, txId, amount, now.toISOString(), byCode ? 1 : 0);
}

/** Phần đã dùng của chuyển khoản bí danh `tx` ở việc chuyển về chưa huỷ — `USED_SQL` của việc tháng cộng phần này (ghép trước TL / CD / VT). */
export const REFUND_USED_SQL = (tx: string) =>
  `COALESCE((SELECT SUM(x.amount) FROM goal_refund_tx x JOIN goal_refunds f ON f.id = x.refund_id WHERE x.tx_id = ${tx} AND f.status <> 'void'), 0)`;

export interface RefundEffects {
  created: MatchResult["refunds_created"];
  voided: number[];
}

/**
 * Đối soát việc chuyển về sau mỗi lần ghi (mọi đường ghi, trước tự tick việc tháng): (1) khoản chi không còn là kiểu B của mục tiêu
 * (huỷ, gỡ khớp, đổi mục tiêu / tài khoản) → việc `void`; (2) khoản chi kiểu B còn hiệu lực trong cửa sổ chưa có việc → tạo việc,
 * số = min(khoản chi − hoàn, max(0, cần − đã chi của mục tiêu)) — đã chi gồm số các việc khác; 0 → không tạo; (3) ghép chuyển khoản
 * từ nhóm tài khoản mục tiêu sang nhóm tài khoản đã trả, từ ngày khoản chi, cộng dồn tới đủ.
 */
export async function reconcileRefunds(db: D1Database, now: Date): Promise<RefundEffects> {
  const at = now.toISOString();
  const voided = rows<{ id: number }>(
    await db
      .prepare(
        `UPDATE goal_refunds SET status = 'void', updated_at = ? WHERE status <> 'void' AND NOT EXISTS (
           SELECT 1 FROM transactions s JOIN reserve_goals g ON g.id = s.goal_id
           WHERE s.id = goal_refunds.spend_tx_id AND g.id = goal_refunds.goal_id AND ${advanceSql("s", "g")}) RETURNING id`,
      )
      .bind(at)
      .all(),
  ).map((r) => Number(r.id));

  const [candidateRes, spentRes] = await db.batch([
    db.prepare(
      `WITH w AS (${goalWindowSql(now)})
       SELECT s.id, s.goal_id AS goalId, s.account_id AS toId, g.account_id AS fromId, s.amount - ${returnedSql("s")} AS net, g.target_amount AS need
       FROM transactions s JOIN reserve_goals g ON g.id = s.goal_id JOIN w ON w.id = g.id
       WHERE ${advanceSql("s", "g")} AND ${inWindowSql("s")} AND g.target_pct IS NULL
         AND NOT EXISTS (SELECT 1 FROM goal_refunds f WHERE f.spend_tx_id = s.id AND f.status <> 'void')
       ORDER BY s.at, s.id`,
    ),
    goalSpentStatement(db, now),
  ]);
  const spent = goalSpentMap(spentRes!);
  const created: RefundEffects["created"] = [];
  for (const c of rows<{ id: number; goalId: string; toId: string; fromId: string; net: number; need: number }>(candidateRes!)) {
    const amount = Math.min(Number(c.net), Math.max(0, Number(c.need) - (spent.get(c.goalId) ?? 0)));
    if (amount <= 0) continue;
    const res = await db
      .prepare(
        `INSERT INTO goal_refunds (goal_id, spend_tx_id, from_account_id, to_account_id, amount, created_at, updated_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6
         WHERE NOT EXISTS (SELECT 1 FROM goal_refunds WHERE spend_tx_id = ?2 AND status <> 'void')`,
      )
      .bind(c.goalId, c.id, c.fromId, c.toId, amount, at)
      .run()
      .catch((err: unknown) => {
        // Hai lần đối soát song song: lần thua gặp index duy nhất — việc đã có.
        if (/UNIQUE/i.test(String(err))) return null;
        throw err;
      });
    if (!res?.meta.changes) continue;
    spent.set(c.goalId, (spent.get(c.goalId) ?? 0) + amount);
    created.push({ id: Number(res.meta.last_row_id), amount, from_account_id: c.fromId, to_account_id: c.toId });
  }
  await autoTickRefunds(db, now);
  return { created, voided };
}

/** Ghép chuyển khoản nhóm tài khoản mục tiêu → nhóm tài khoản đã trả vào việc chuyển về chưa đủ (mở hoặc đã bấm Đã chuyển), theo thời gian rồi theo việc. */
async function autoTickRefunds(db: D1Database, now: Date): Promise<void> {
  const open = rows<{ id: number; amount: number; linked: number; fromId: string; toRoot: string; spendAt: string }>(
    await db
      .prepare(
        `SELECT f.id, f.amount, ${refundLinkedSql("f.id")} AS linked, f.from_account_id AS fromId, COALESCE(ta.parent_account_id, ta.id) AS toRoot, s.at AS spendAt
         FROM goal_refunds f JOIN accounts ta ON ta.id = f.to_account_id JOIN transactions s ON s.id = f.spend_tx_id
         WHERE f.status IN ('open', 'done') ORDER BY f.id`,
      )
      .all(),
  )
    .map((r) => ({ ...r, missing: Number(r.amount) - Number(r.linked), since: vnMidnight(dayKey(r.spendAt)) }))
    .filter((r) => r.missing > 0);
  if (open.length === 0) return;
  const from = open.reduce((m, r) => (r.since < m ? r.since : m), open[0]!.since);
  const transfers = rows<{ id: number; at: string; amount: number; used: number; fromRoot: string; toRoot: string }>(
    await db
      .prepare(
        `SELECT t.id, t.at, t.amount, ${USED_SQL("t.id")} AS used, COALESCE(fa.parent_account_id, fa.id) AS fromRoot, COALESCE(ta.parent_account_id, ta.id) AS toRoot
         FROM transactions t JOIN accounts fa ON fa.id = t.account_id JOIN accounts ta ON ta.id = t.counter_account_id
         WHERE t.status = 'active' AND t.meaning = 'transfer' AND t.at >= ? ORDER BY t.at, t.id`,
      )
      .bind(from)
      .all(),
  );
  const statements: D1PreparedStatement[] = [];
  for (const tr of transfers) {
    let left = Number(tr.amount) - Number(tr.used);
    for (const r of open) {
      if (left <= 0) break;
      if (r.missing <= 0 || tr.at < r.since || tr.fromRoot !== r.fromId || tr.toRoot !== r.toRoot || tr.fromRoot === tr.toRoot) continue;
      const take = Math.min(left, r.missing);
      statements.push(linkRefundStatement(db, r.id, tr.id, take, now));
      r.missing -= take;
      left -= take;
    }
  }
  if (statements.length) await db.batch(statements);
}

/** Việc chuyển về đang mở (chưa nhận đủ) có mã CV + tháng (VN, của lúc tạo) khớp một bộ trong nội dung; không có → null. */
export async function codedRefund(db: D1Database, content: string | null): Promise<{ id: number; amount: number; linked: number; toId: string; toRoot: string } | null> {
  for (const { prefix, code, month } of codesIn(content)) {
    if (prefix !== "CV") continue;
    const r = await db
      .prepare(
        `SELECT f.id, f.amount, ${refundLinkedSql("f.id")} AS linked, f.to_account_id AS toId, COALESCE(ta.parent_account_id, ta.id) AS toRoot
         FROM goal_refunds f JOIN accounts ta ON ta.id = f.to_account_id
         WHERE f.code = ? AND f.status IN ('open', 'done') AND CAST(strftime('%m', f.created_at, '+7 hours') AS INTEGER) = ?`,
      )
      .bind(code, month)
      .first<{ id: number; amount: number; linked: number; toId: string; toRoot: string }>();
    if (r && Number(r.linked) < Number(r.amount)) return r;
  }
  return null;
}

/** Việc chuyển về còn hiệu lực theo id (kèm số đã ghép); không có → 404, đã huỷ → 409 `refund_void`. */
async function liveRefund(db: D1Database, id: number, now: Date): Promise<RefundRow> {
  const r = await db.prepare(refundRowsSql(now, "f.id = ?")).bind(id).first<RefundRow>();
  if (!r) return fail("not_found", "Không có việc chuyển về này.", 404);
  if (r.status === "void") fail("refund_void", "Việc này đã huỷ vì khoản chi đã gỡ khớp.", 409);
  return r;
}

async function refundAfter(db: D1Database, id: number, viewerId: string | null, now: Date): Promise<GoalRefundView> {
  const [r, accounts, hidden] = await Promise.all([liveRefund(db, id, now), db.prepare(QR_ACCOUNTS_SQL).all<QrAccount>(), hiddenAccountIds(db, viewerId)]);
  return refundView(r, rows<QrAccount>(accounts), hidden);
}

const reasonOf = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return fail("invalid_input", "Lý do là chữ.", 400, "reason");
  const r = v.trim();
  if (r.length > 500) fail("invalid_input", "Lý do từ 1 đến 500 ký tự.", 400, "reason");
  return r || null;
};

export interface RefundActionResult {
  refund: GoalRefundView;
  audit: Audit;
}

/** `POST /v1/goal-refunds/:id/done` (AC-29): Đã chuyển — xong; chuyển khoản tới sau vẫn ghép vào việc này. Không mở → 409 `refund_done`. */
export async function markRefundDone(db: D1Database, id: number, memberId: string | null, now: Date): Promise<RefundActionResult> {
  const r = await liveRefund(db, id, now);
  if (refundView(r, [], []).status !== "open") fail("refund_done", "Việc này đã xong hoặc đã bỏ qua.", 409);
  await db.prepare("UPDATE goal_refunds SET status = 'done', updated_at = ?, by_member_id = ? WHERE id = ? AND status = 'open'").bind(now.toISOString(), memberId, id).run();
  return { refund: await refundAfter(db, id, memberId, now), audit: { action: "goal_refund.done", detail: { amount: Number(r.amount) - Number(r.linked) } } };
}

/** `POST /v1/goal-refunds/:id/skip { reason }` (AC-29, B4): bỏ qua bắt buộc lý do (400 `reason_required`); phần chờ về 0, tiền về phần chia thường. */
export async function skipRefund(db: D1Database, id: number, b: Record<string, unknown>, memberId: string | null, now: Date): Promise<RefundActionResult> {
  const r = await liveRefund(db, id, now);
  const reason = reasonOf(b.reason);
  if (!reason) fail("reason_required", "Bỏ qua việc chuyển về cần ghi lý do.", 400, "reason");
  if (refundView(r, [], []).status !== "open") fail("refund_done", "Việc này đã xong hoặc đã bỏ qua.", 409);
  await db.prepare("UPDATE goal_refunds SET status = 'skipped', reason = ?, updated_at = ?, by_member_id = ? WHERE id = ? AND status = 'open'").bind(reason, now.toISOString(), memberId, id).run();
  return { refund: await refundAfter(db, id, memberId, now), audit: { action: "goal_refund.skip", detail: { reason } } };
}

/** `POST /v1/goal-refunds/:id/reopen` (AC-29): gỡ Đã chuyển / Bỏ qua — mở lại. Đang mở → 409 `refund_open`. */
export async function reopenRefund(db: D1Database, id: number, memberId: string | null, now: Date): Promise<RefundActionResult> {
  const r = await liveRefund(db, id, now);
  if (r.status === "open") fail("refund_open", "Việc này đang mở.", 409);
  await db.prepare("UPDATE goal_refunds SET status = 'open', reason = NULL, updated_at = ?, by_member_id = ? WHERE id = ?").bind(now.toISOString(), memberId, id).run();
  return { refund: await refundAfter(db, id, memberId, now), audit: { action: "goal_refund.reopen", detail: {} } };
}
