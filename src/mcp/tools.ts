// 16 tool MCP cho Claude (12 đọc, 4 ghi): mỗi tool chỉ gọi lại đúng hàm domain/service dùng chung với REST
// (src/services/ledger.ts, src/services/ingest.ts, src/services/rental.ts, src/services/debts.ts, src/services/receivables.ts)
// — không viết SQL nghiệp vụ ở tầng này.
// Mỗi kết nối Claude mang người đã uỷ quyền (OAuth, UC-601): tool đọc nhìn số liệu như người đó trên app (ví private cũ và
// tài khoản riêng tư của người khác bị ẩn — UC-504); tool ghi lấy người đó làm người ghi / người gán và ghi nhật ký `via = mcp` (ADR-90).

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MANUAL_MEANINGS, OLD_ENTRY_FIELDS, rejectOldFields, type EntryInput } from "../domain/entry";
import { DomainError } from "../domain/types";
import * as balance from "../services/balance";
import * as debts from "../services/debts";
import { getFreedom } from "../services/freedom";
import * as ingest from "../services/ingest";
import * as ledger from "../services/ledger";
import * as receivables from "../services/receivables";
import * as reports from "../services/reports";
import * as rental from "../services/rental";
import { audit, type Actor } from "../services/audit";
import { nearSpendLine } from "../notify/format";

/** Tool ghi: cần quyền `mcp:write` — routes/mcp.ts kiểm ở tầng HTTP trước khi tới đây (UC-601 AC-11). */
export const WRITE_TOOLS: readonly string[] = ["add_transaction", "assign_log", "set_tenant_bill_item", "record_asset_value"];

/** Trường của mô hình cũ mà tool ghi từ chối (mcp UC-603 AC-31, UC-604 AC-13) — schema lỏng để zod không bỏ lặng lẽ. */
const OLD_SPLIT_FIELDS = ["wallet_id", "counter_wallet_id", "from_wallet_id", "wealth_move", "allocate", "earmark_id"] as const;

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ₫`;
/** Mô tả tham số `goal_id` của add_transaction / assign_log (mcp UC-603, UC-604; pocket UC-1209 bước 11). */
const GOAL_ID_HINT =
  "the goal this spend / outgoing transfer uses money for. Account goals (goal ids per account: get_snapshot pockets accounts[].goalIds): " +
  "money leaves the goal's account or one of its term deposits (child accounts, parentId) — only needed when that account has two or more " +
  "goals, which share one account; leave it out = for no goal (an account with one goal is filled in automatically). Goals paid from " +
  "spending money (pockets.operating.goals): money leaves any operating account; never filled in automatically — send goal_id to count it. " +
  "Any other goal is an error (invalid_goal).";
/** Mô tả `is_interest` / `from_interest` (mcp UC-603, UC-604; pocket UC-1209 bước 9, ADR-140). */
const INTEREST_HINT =
  "is_interest (income only) = this income is deposit interest into an account with goals or its term deposit: it is recorded as passive " +
  "income and kept out of the goals (reserve.groups[].interest); otherwise invalid_input. from_interest (spend / outgoing transfer leaving " +
  "such an account group, never with goal_id) = paid from that interest; more than the group's current interest, a transfer between the " +
  "account and its own term deposit, or any other account is an error (invalid_interest).";

/** Kết quả tool thành công: JSON gọn kèm một dòng tóm tắt tiếng Việt (khi có ích cho việc trả lời). */
function ok(data: unknown, summary?: string): CallToolResult {
  const text = JSON.stringify(data);
  return { content: summary ? [{ type: "text", text: summary }, { type: "text", text }] : [{ type: "text", text }] };
}

/** DomainError → thông điệp tiếng Việt sẵn có (`model_changed` kèm mã để Claude biết bỏ trường); lỗi lạ → thông điệp chung. */
function fail(err: unknown): CallToolResult {
  if (err instanceof DomainError) {
    const text = err.code === "model_changed" ? `model_changed: ${err.message}` : err.message;
    return { content: [{ type: "text", text }], isError: true };
  }
  console.error("[mcp] lỗi khi chạy tool:", err instanceof Error ? err.message : err);
  return { content: [{ type: "text", text: "Lỗi hệ thống. Thử lại sau." }], isError: true };
}

/**
 * Đăng ký cả 16 tool lên một McpServer mới dựng riêng cho request hiện tại; `memberId` = người đã uỷ quyền kết nối.
 * `onSalary(txId)`: tool ghi vừa ghi một khoản lương có nhắc ① trích Tích luỹ — người gọi báo lương về sau khi trả lời (notify
 * UC-412), không chặn kết quả tool.
 */
export async function registerTools(
  server: McpServer,
  db: D1Database,
  memberId: string,
  now: () => Date,
  onSalary: (txId: number) => void,
): Promise<void> {
  const members = rows<{ id: string; name: string; role: string }>(
    await db.prepare("SELECT id, name, role FROM members WHERE active = 1 ORDER BY role = 'owner' DESC, name").all(),
  );
  const memberIds = new Set(members.map((m) => m.id));
  const memberHint = members.length ? members.map((m) => `${m.id} (${m.name})`).join(", ") : "no active members yet";
  const actor: Actor = { memberId, via: "mcp" };

  server.registerTool(
    "get_snapshot",
    {
      description:
        "Numbers behind the 'Today' screen, three cards. pockets: real money per pocket (each pocket is a group of real accounts: " +
        "savings / reserve / operating / outside), savings change this / previous calendar month (savings.change, since = 1st of the month), reserve goals (each goal sits in " +
        "a real reserve account and several goals can share one account; held = what the goal has after splitting the account balance by " +
        "priority order, counting spent = what was spent for the goal this calendar month; null = no account yet; target or % of taxable income; " +
        "sorted by priority), reserve.groups = per account with goals: balance (the account plus its term deposits), interest (deposit interest " +
        "kept out of the goals; the goals split balance − interest), childIds, need, spent, short / extra; accounts[].goalIds = goals of each " +
        "account; accounts[].parentId = the parent account of a term deposit (child account, same pocket); peace-of-mind amount " +
        "(reserve accounts without a goal) and months of operating spend it covers (reserve.peace, reserve.peaceMonths), reward account " +
        "(reserve.reward), short-term debts (shortDebt, reminder only — not subtracted). operating.goals = goals paid straight from spending " +
        "money each month ({ id, name, monthly, monthAmount (own amount for this month, null = monthly), note, categoryIds (spending in these categories counts as paid), spent, remaining }), operating.remaining = what is still to pay for them this month. " +
        "nearSpend: the operating pocket counted until the next payday, per day / per meal / per market trip, minus month tasks not done yet " +
        "(pendingTasks) and minus what goals paid from spending money still need this month (goalRemaining); nearSpend.salaryPayday = the upcoming payday when salary already arrived early (then days count to the payday after), else null. topUp: spending money will not " +
        "last until payday — { amount, sources: [{ accountId, name, amount }] (reward account first, then peace-of-mind accounts), toAccountId, " +
        "target (QR destination; null = cash only) }; null = enough. " +
        "month: month tasks — the savings reminder of each salary (transfer savings % to the savings pocket) and the month-end surplus split tasks — " +
        "{ key, tasks, openCount, savings (saved this month: amount, base, pct, level), goalHint (one optional reserve goal still short) }. " +
        "monthClose: surplus of the month just ended ({ month, operatingEnd, pendingAtEnd, earlySalary, heldPayables, heldToPayday, surplus, savingsAmount, rewardAmount, status: ask | split | skipped }); null = none. " +
        "moneyAge: how many days ago the money now being spent from the operating pocket came in ({ days, sample, buffered }; null = fewer than 10 spends). " +
        "Also items needing attention (unassigned bank logs, reconciliation drift). " +
        "conversion: one-time switch to pockets still pending ({ done, total: 5, next }; null when done). " +
        "No parameters. All amounts are integer VND.",
    },
    async () => {
      try {
        const snap = await ledger.getSnapshot(db, memberId, now());
        return ok(snap, nearSpendLine(snap.nearSpend));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_goals",
    {
      description:
        "Savings pocket total and change per calendar month, savings % and saved this month (savingsDone), reserve goals vs target (several goals can share one " +
        "account; held = what the goal has after splitting the account balance by priority, counting spent this month; null = no account yet), " +
        "groups per account (balance incl. term deposits, interest kept out of the goals, childIds, need, spent, short / extra), peace-of-mind " +
        "amount (reserve accounts without a goal) and months, short-term debts, and operating.goals = goals paid straight from spending money " +
        "each month ({ id, name, monthly, monthAmount (own amount for this month, null = monthly), note, categoryIds (spending in these categories counts as paid), spent, remaining }) with operating.remaining. Same numbers as get_snapshot pockets. No parameters.",
    },
    async () => {
      try {
        return ok(await ledger.goals(db, memberId, now()));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_pending_logs",
    {
      description:
        "Bank logs (from SePay) not yet assigned to any transaction, newest first. limit defaults to 20 (max 200). " +
        "Logs of another member's private account are not listed (attention.hiddenPendingLogs in get_snapshot counts them).",
      inputSchema: { limit: z.number().int().positive().max(200).optional() },
    },
    async (args) => {
      try {
        return ok(await ingest.listPendingLogs(db, args.limit ?? 20, memberId));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "assign_log",
    {
      description:
        "Assign one pending bank log (log_id from list_pending_logs) to 1..N transactions (splits); " +
        "the split amounts must add up to exactly the log amount. A payment on an interest-bearing debt is two splits: " +
        "interest (spend, interest_debt_id) and principal (spend, debt_id). " +
        "Bank deposit interest (suggestion.interest from list_pending_logs) is ONE split { meaning: income, interest: true } (is_interest: true " +
        "is the same): it records the income in the receiving account, reported as passive income, and for an account with goals or its term " +
        "deposit it is kept out of the goals. " +
        "income: is_salary = 'this is salary' (default: the income stream is a salary stream, or no stream and at least the salary reminder threshold); salary gets one savings reminder, result effects.savings = { amount, pct } (null = none); interest and rent are never salary (cannot_be_salary). " +
        `spend / outgoing transfer: goal_id = ${GOAL_ID_HINT} from_interest: see add_transaction. ` +
        "There are no wallets or pay cycles: sending wallet_id, from_wallet_id, wealth_move, earmark_id, transfer_order_id or opens_cycle is an error (model_changed).",
      inputSchema: z.looseObject({
        log_id: z.string().min(1),
        splits: z
          .array(
            z.looseObject({
              meaning: z.enum(["spend", "transfer", "income", "refund", "lend", "collect", "buy_asset"]),
              amount: z.number().int().positive(),
              category_id: z.string().optional(),
              other_account_id: z.string().optional(),
              income_stream_id: z.string().optional(),
              tenant_id: z.string().optional(),
              debt_id: z.string().optional(),
              interest_debt_id: z.string().optional(),
              receivable_id: z.string().optional(),
              link_id: z.number().int().positive().optional(),
              taxable: z.boolean().optional(),
              asset_kind: z.string().optional(),
              interest: z.boolean().optional(),
              is_interest: z.boolean().optional(),
              from_interest: z.boolean().optional(),
              note: z.string().optional(),
              is_salary: z.boolean().optional(),
              goal_id: z.string().optional(),
            }),
          )
          .min(1),
      }),
    },
    async (args) => {
      try {
        rejectOldFields(args, ["transfer_order_id"]);
        for (const s of args.splits) rejectOldFields(s, OLD_SPLIT_FIELDS);
        const splits: ingest.Split[] = args.splits.map((s) => ({
          meaning: s.meaning,
          amount: s.amount,
          category_id: s.category_id ?? null,
          other_account_id: s.other_account_id ?? null,
          income_stream_id: s.income_stream_id ?? null,
          tenant_id: s.tenant_id ?? null,
          debt_id: s.debt_id ?? null,
          interest_debt_id: s.interest_debt_id ?? null,
          receivable_id: s.receivable_id ?? null,
          link_id: s.link_id ?? null,
          taxable: s.taxable,
          asset_kind: s.asset_kind ?? null,
          interest: s.interest === true || s.is_interest === true,
          note: s.note ?? null,
          is_salary: s.is_salary,
          goal_id: s.goal_id ?? null,
          from_interest: s.from_interest === true,
        }));
        const result = await ingest.assignLog(db, args.log_id, splits, memberId, now());
        await audit(db, actor, "log.assign", `log:${args.log_id}`, { splits: splits.length });
        if (result.effects.savings) {
          for (const t of result.transactions) if (t.meaning === "income" && Number(t.is_salary) === 1) onSalary(Number(t.id));
        }
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "add_transaction",
    {
      description:
        `Record a manually entered transaction (source='manual'); e.g. "spent 200k on fuel in cash" → meaning=spend, amount=200000, category_id=fuel-parking. ` +
        "meaning is one of: spend, income, refund, transfer (between two accounts), buy_asset (buy an asset), " +
        "lend (lend or pay on someone's behalf: money leaves), collect (money lent comes back: money arrives, it is NOT income " +
        "— do not use refund for repaid loans). " +
        "amount is a positive integer VND. by_member_id (who is recording this) is optional and defaults to the member who authorized this connection — valid ids: " +
        `${memberHint}. A missing account_id is the recorder's cash account, exactly as the REST API does. ` +
        "transfer needs account_id (source) + to_account_id (destination); a transfer into the savings account counts toward the open savings reminder. " +
        "There are no wallets or pay cycles: sending wallet_id, from_wallet_id, wealth_move, earmark_id or opens_cycle is an error (model_changed). " +
        "Accounts marked private by another member cannot be written to (error private_account). " +
        "income: income_stream_id = income stream, tenant_id = rent paid by a tenant (id from list_tenants; " +
        "without a stream the rental stream is used); is_salary = 'this is salary' (default: the stream is a salary stream, or no stream and at least " +
        "the salary reminder threshold) — salary gets one 'transfer savings %' reminder, the result's effects.savings = { amount, pct } (null = none); interest and rent are never salary (cannot_be_salary). " +
        "spend: money paid from a reserve goal's account lowers what the goals of that account hold; " +
        `goal_id (spend / outgoing transfer) = ${GOAL_ID_HINT} ${INTEREST_HINT} ` +
        "debt_id = a debt repayment of PRINCIPAL (id from get_debts; without category_id the debt-repayment category is used); " +
        "interest_debt_id = INTEREST paid on that debt (spend only, never together with debt_id; without category_id the 'loan-interest' category). " +
        "When paying a debt with interestRate > 0, record TWO transactions: interest = min(amount, interestThisMonth − interestPaidThisMonth from get_debts) " +
        "with interest_debt_id, and the rest as principal with debt_id. " +
        "lend / collect: receivable_id = the receivable (id from get_receivables); account_id = account money leaves (lend) / arrives in (collect). " +
        "buy_asset needs asset_kind (stock|gold|re|fund) and account_id. Get category_id/account_id from list_categories or get_snapshot. " +
        "If the error code is bank_log_exists, the bank already reported this exact transaction and it is already in the books: do NOT retry " +
        "unless the user confirms these are two separate real transactions — then send confirm_duplicate=true.",
      inputSchema: z.looseObject({
        meaning: z.enum(MANUAL_MEANINGS),
        amount: z.number().int().positive(),
        by_member_id: z.string().min(1).optional(),
        category_id: z.string().optional(),
        account_id: z.string().optional(),
        to_account_id: z.string().optional(),
        note: z.string().optional(),
        at: z.string().optional(),
        taxable: z.boolean().optional(),
        link_id: z.number().int().positive().optional(),
        asset_kind: z.string().optional(),
        income_stream_id: z.string().optional(),
        tenant_id: z.string().optional(),
        debt_id: z.string().optional(),
        interest_debt_id: z.string().optional(),
        receivable_id: z.string().optional(),
        confirm_duplicate: z.boolean().optional(),
        is_salary: z.boolean().optional(),
        goal_id: z.string().optional(),
        is_interest: z.boolean().optional(),
        from_interest: z.boolean().optional(),
      }),
    },
    async (args) => {
      try {
        rejectOldFields(args, OLD_ENTRY_FIELDS);
        const by = args.by_member_id ?? memberId;
        if (!memberIds.has(by)) {
          throw new DomainError("unknown_member", `Không có thành viên đang hoạt động với id "${by}".`, 404);
        }
        const input: EntryInput = {
          meaning: args.meaning,
          amount: args.amount,
          at: args.at,
          category_id: args.category_id ?? null,
          account_id: args.account_id ?? null,
          to_account_id: args.to_account_id ?? null,
          note: args.note ?? null,
          taxable: args.taxable ?? false,
          link_id: args.link_id ?? null,
          asset_kind: args.asset_kind ?? null,
          income_stream_id: args.income_stream_id ?? null,
          tenant_id: args.tenant_id ?? null,
          debt_id: args.debt_id ?? null,
          interest_debt_id: args.interest_debt_id ?? null,
          receivable_id: args.receivable_id ?? null,
          confirm_duplicate: args.confirm_duplicate === true,
          is_salary: args.is_salary,
          goal_id: args.goal_id ?? null,
          is_interest: args.is_interest === true,
          from_interest: args.from_interest === true,
        };
        // Người ghi có thể là `by_member_id`; luật tài khoản riêng tư nhìn theo người đã uỷ quyền (access UC-504 AC-14).
        const result = await ledger.createEntry(db, input, by, now(), memberId);
        // Không trùng thì tx là dòng vừa ghi.
        if (!result.duplicate) {
          const id = result.tx!.id;
          const goalId = result.tx!.goal_id ?? null;
          await audit(db, actor, "tx.create", `tx:${id}`, { meaning: args.meaning, by_member_id: by, ...(goalId ? { goal_id: goalId } : {}) });
          if (result.effects.savings) onSalary(Number(id));
        }
        return ok(result, result.duplicate ? "Giao dịch này đã được ghi trước đó (trùng client_id)." : "Đã ghi giao dịch.");
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_categories",
    {
      description:
        "Active spending categories (id, name, icon, group) — use them to map a spoken phrase (e.g. 'xăng xe', fuel) " +
        "to category_id for add_transaction.",
    },
    async () => {
      try {
        return ok((await ledger.loadRefs(db)).categories);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_spending_by_category",
    {
      description:
        "Look back over a calendar month (VN, 1st to month end): spending by category group vs the monthly soft limit (never negative, no top-up), " +
        "vs the previous month, loan interest expected vs paid, days / daysElapsed of the month and savings done that month (from the salary " +
        "savings reminders; null = no salary). period=YYYY-MM; omit for the current month. There are no pay cycles: sending cycle is an error " +
        "(model_changed). Amounts are integer VND.",
      inputSchema: z.looseObject({ period: z.string().optional() }),
    },
    async (args) => {
      try {
        ledger.rejectCycleParam(args.cycle);
        return ok(await ledger.spendByCategory(db, { period: args.period ?? null }, now()));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_reconciliation",
    {
      description:
        "Reconciliation per account: drift between the book and assigned bank transactions (bookDrift), the number and net amount of " +
        "unassigned bank logs (pending), and the last time a real balance was entered (lastCountAt). Read-only; there is no bank-reported balance.",
    },
    async () => {
      try {
        return ok(await ledger.reconcile(db));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_tenants",
    {
      description:
        "Tenant ledger: the rental income stream and tenants with their balance (positive = tenant still owes, negative = overpaid) " +
        "and the monthly bill of the previous month (bill: id, month, status draft|issued, total, revision, edited = changed after it was sent; " +
        "null = not made yet). Read get_tenant_bill for the bill items and the message to send. No parameters.",
    },
    async () => {
      try {
        return ok(await rental.getRental(db, now()));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_tenant_bill",
    {
      description:
        "One tenant's monthly bill (month = the month lived in / electricity used, 'YYYY-MM', default the previous month): status none|draft|issued, " +
        "items (name, category fixed = 'Chi phí cứng' | variable = 'Chi phí', amount, previous = same item last bill), totals per category, " +
        "previousBalance (earlier months: > 0 still owed, < 0 overpaid — a separate line, not in the QR), text (the message to send the tenant), " +
        "qrAmount (the transfer amount = this bill's total), payments received since it was sent, and balance (everything still owed now). " +
        "Seen as the member who authorised this connection. tenant_id from list_tenants. Read-only.",
      inputSchema: { tenant_id: z.string().min(1), month: z.string().optional() },
    },
    async (args) => {
      try {
        return ok(await rental.getBill(db, args.tenant_id, args.month, memberId, now()));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_debts",
    {
      description:
        "Debts the household owes others: owed, paid, balance (≤ 0 = fully paid, done=true), " +
        "the debt lines and the payments; totalBalance = total still owed. Interest: interestRate (%/year), term (short|long), " +
        "monthlyPayment, dueDay, interestPerYear, interestThisMonth (expected interest this month on the balance at the start of the month), " +
        "interestPaidThisMonth. No parameters.",
    },
    async () => {
      try {
        const data = await debts.getDebts(db, memberId, now());
        return ok(data, `Còn nợ: ${vnd(data.totalBalance)}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_receivables",
    {
      description:
        "Receivables — money others owe the household (loans, payments on their behalf): lent, collected, " +
        "balance (≤ 0 = fully repaid, done=true), the ledger lines and the money movements out (lend) / back (collect); " +
        "totalBalance = total still receivable. This is a memo of who owes whom, not money on hand. No parameters.",
    },
    async () => {
      try {
        const data = await receivables.getReceivables(db, memberId);
        return ok(data, `Người khác còn nợ: ${vnd(data.totalBalance)}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "set_tenant_bill_item",
    {
      description:
        "Set one item on a tenant's DRAFT monthly bill (month 'YYYY-MM', default the previous month). The item is matched by name " +
        "(trimmed, case-insensitive): found → its amount (and category, if given) is replaced; not found → it is added (category defaults to " +
        "variable). No bill for that month yet → a draft is made by copying the latest earlier bill first. A bill already sent (issued) cannot be " +
        "changed here (error bill_issued) — it is edited in the app. Does not change the tenant balance; sending the bill is done in the app. " +
        "category: fixed = 'Chi phí cứng' (rent, parking, internet) | variable = 'Chi phí' (food, electricity, water). amount: non-zero integer VND " +
        "(negative = a deduction). Returns the bill as get_tenant_bill.",
      inputSchema: {
        tenant_id: z.string().min(1),
        month: z.string().optional(),
        name: z.string().min(1),
        category: z.enum(["fixed", "variable"]).optional(),
        amount: z.number().int(),
      },
    },
    async (args) => {
      try {
        const bill = await rental.setBillItem(db, args, actor, now());
        return ok(bill, `Đã ghi khoản "${args.name.trim()}" ${vnd(args.amount)} vào bản tính tháng ${bill.month} của ${bill.tenant.name} — tổng ${vnd(bill.total)}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_balance_sheet",
    {
      description:
        "Household balance sheet (same numbers as the app's 'Báo cáo' screen): A short-term / B long-term assets by section, " +
        "C liabilities by term (short|long) × interest group (none|normal|high, with interestPerYear and interestThisMonth), equity = assets − liabilities, " +
        "% of total and % of equity per row, the asset pyramid, real cash flow per month (cashflowMonthly) and after inflation (netCashflowMonthly), " +
        "and every manually tracked item with its lots, profit/loss, take-profit / stop-loss distance, status and CAGR. " +
        "Cash, receivables and debts always come from the books. date 'YYYY-MM-DD' optional (default today). Amounts are integer VND; pct fields have one decimal. " +
        "freedom (always as of today): safety milestones A1–A3 (liquid assets vs 6/12/24 months of expenses), income milestones M2/M2p/M3, " +
        "financial-freedom milestones F1–F3 on investable assets minus debts (with target age, year and inflation-adjusted amount), " +
        "the parameters used (expenses manual or from the books, SWR, inflation) and this year's income plan vs actual.",
      inputSchema: { date: z.string().optional() },
    },
    async (args) => {
      try {
        const [sheet, freedom] = await Promise.all([balance.getBalanceSheet(db, args.date, now()), getFreedom(db, now())]);
        return ok({ ...sheet, freedom }, `Vốn chủ: ${vnd(sheet.equity)} (tài sản ${vnd(sheet.totalAssets)}, nợ ${vnd(sheet.totalLiabilities)})`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_reports",
    {
      description:
        "Household financial reports for a month 'YYYY-MM' or a year 'YYYY' (same numbers as the app). kind=cash_flow: opening cash, " +
        "accounts opened / closed in the period, operating / investing / financing groups with lines (signed VND), closing cash = " +
        "sum of account books, card debt included; year adds a per-month list. kind=income_statement: income (salary and other, " +
        "rental, passive), expenses by essential / flexible category groups (loan interest under essential), tax paid from the tax goal, " +
        "spent from the savings pocket, other; savings and savings rate (%), plus amounts left out (principal repaid, assets bought, reclassified, " +
        "count adjustments). Reports never change balances. Projections are not available here (not real numbers).",
      inputSchema: { kind: z.enum(["cash_flow", "income_statement"]), period: z.string() },
    },
    async (args) => {
      try {
        if (args.kind === "cash_flow") {
          const cf = await reports.getCashFlow(db, args.period, now());
          return ok(cf, `Tiền đầu kỳ ${vnd(cf.opening)} → cuối kỳ ${vnd(cf.closing)}.`);
        }
        const is = await reports.getIncomeStatement(db, args.period, now());
        return ok(is, `Thu nhập ${vnd(is.income.total)}, chi tiêu ${vnd(is.expense.total)}, để dành ${vnd(is.savings)}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );
  server.registerTool(
    "record_asset_value",
    {
      description:
        "Record today's (or as_of 'YYYY-MM-DD') price of a manually tracked asset (item_id from get_balance_sheet items, e.g. 'vang'). " +
        "Items measured by value take value (whole item, VND); items measured in units (gold in chỉ, shares) take unit_price (VND per unit — " +
        "for gold: the shop's buying price). Optional cashflow (real after-tax income from the asset, VND) with cashflow_period month|year, " +
        "and expected_return (%/year, e.g. 12). Append-only; never creates a transaction. Cannot create / delete items or lots.",
      inputSchema: {
        item_id: z.string().min(1),
        value: z.number().int().nonnegative().optional(),
        unit_price: z.number().int().nonnegative().optional(),
        as_of: z.string().optional(),
        cashflow: z.number().int().nonnegative().optional(),
        cashflow_period: z.enum(["month", "year"]).optional(),
        expected_return: z.number().optional(),
      },
    },
    async (args) => {
      try {
        const { item_id, ...b } = args;
        const item = await balance.addValue(db, item_id, b, memberId, now());
        await audit(db, actor, "balance.value.add", `balance_item:${item.id}`, null);
        const price = item.measure === "units" ? `${vnd(item.unitPrice ?? 0)}/${item.unit}` : vnd(item.value ?? 0);
        return ok(item, `Đã cập nhật giá ${item.name}: ${price}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
