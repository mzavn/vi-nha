// 16 tool MCP cho Claude: mỗi tool chỉ gọi lại đúng hàm domain/service dùng chung với REST
// (src/services/ledger.ts, src/services/ingest.ts, src/services/rental.ts, src/services/debts.ts, src/services/receivables.ts)
// — không viết SQL nghiệp vụ ở tầng này.
// Mỗi kết nối Claude mang người đã uỷ quyền (OAuth, UC-601): tool đọc nhìn số liệu như người đó trên app (ví private của
// người khác bị ẩn — UC-504); tool ghi lấy người đó làm người ghi / người gán và ghi nhật ký `via = mcp` (ADR-90).

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MANUAL_MEANINGS, type EntryInput } from "../domain/entry";
import { monthKey } from "../domain/period";
import { DomainError } from "../domain/types";
import * as debts from "../services/debts";
import * as ingest from "../services/ingest";
import * as ledger from "../services/ledger";
import * as receivables from "../services/receivables";
import * as rental from "../services/rental";
import { audit, type Actor } from "../services/audit";

/** Tool ghi: cần quyền `mcp:write` — routes/mcp.ts kiểm ở tầng HTTP trước khi tới đây (UC-601 AC-11). */
export const WRITE_TOOLS: readonly string[] = ["add_transaction", "assign_log", "allocate_income", "add_tenant_shared_expense"];

type Row = Record<string, unknown>;
const rows = <T = Row>(r: D1Result) => (r.results ?? []) as T[];
const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ₫`;

/** Kết quả tool thành công: JSON gọn kèm một dòng tóm tắt tiếng Việt (khi có ích cho việc trả lời). */
function ok(data: unknown, summary?: string): CallToolResult {
  const text = JSON.stringify(data);
  return { content: summary ? [{ type: "text", text: summary }, { type: "text", text }] : [{ type: "text", text }] };
}

/** DomainError → thông điệp tiếng Việt sẵn có; lỗi lạ → thông điệp chung, không lộ chi tiết hệ thống. */
function fail(err: unknown): CallToolResult {
  if (err instanceof DomainError) return { content: [{ type: "text", text: err.message }], isError: true };
  console.error("[mcp] lỗi khi chạy tool:", err instanceof Error ? err.message : err);
  return { content: [{ type: "text", text: "Lỗi hệ thống. Thử lại sau." }], isError: true };
}

/** Đăng ký cả 16 tool lên một McpServer mới dựng riêng cho request hiện tại; `memberId` = người đã uỷ quyền kết nối. */
export async function registerTools(server: McpServer, db: D1Database, memberId: string, now: () => Date): Promise<void> {
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
        "Numbers behind the 'Today' screen: what is left to spend this week per wallet, balances per tier " +
        "(wealth_building, tax, nice, must, have), the safety fund (safetyFund: months covered vs target), goal progress, " +
        "and items needing attention (unassigned bank logs, reconciliation drift, pending transfer orders). " +
        "No parameters. All amounts are integer VND.",
    },
    async () => {
      try {
        const snap = await ledger.getSnapshot(db, memberId, now());
        return ok(snap, `Còn để chi tuần này: ${vnd(snap.spendableThisWeek)}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_budget",
    {
      description:
        "Budget table per wallet for one period: planned, actual and remaining. period is a month '2026-09' or an ISO week " +
        "'2026-W39'; omit it for the current month. Amounts are integer VND.",
      inputSchema: { period: z.string().optional() },
    },
    async (args) => {
      try {
        return ok(await ledger.getBudget(db, args.period ?? monthKey(now()), memberId));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_goals",
    {
      description:
        "Progress of goals with a deadline (percent reached, amount missing, days left), the safety fund (safetyFund: months " +
        "covered, percent of target) and the wealth-building total (wealthBuilding: cash + assets). No parameters.",
    },
    async () => {
      try {
        return ok(await ledger.goals(db));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_pending_logs",
    {
      description:
        "Bank logs (from SePay) not yet assigned to any transaction, newest first. limit defaults to 20 (max 200).",
      inputSchema: { limit: z.number().int().positive().max(200).optional() },
    },
    async (args) => {
      try {
        return ok(await ingest.listPendingLogs(db, args.limit ?? 20));
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
        "the split amounts must add up to exactly the log amount.",
      inputSchema: {
        log_id: z.string().min(1),
        splits: z
          .array(
            z.object({
              meaning: z.enum(["spend", "transfer", "income", "refund", "lend", "collect", "buy_asset"]),
              amount: z.number().int().positive(),
              wallet_id: z.string().optional(),
              category_id: z.string().optional(),
              other_account_id: z.string().optional(),
              from_wallet_id: z.string().optional(),
              income_stream_id: z.string().optional(),
              tenant_id: z.string().optional(),
              debt_id: z.string().optional(),
              receivable_id: z.string().optional(),
              link_id: z.number().int().positive().optional(),
              taxable: z.boolean().optional(),
              asset_kind: z.string().optional(),
              note: z.string().optional(),
            }),
          )
          .min(1),
      },
    },
    async (args) => {
      try {
        const splits: ingest.Split[] = args.splits.map((s) => ({
          meaning: s.meaning,
          amount: s.amount,
          wallet_id: s.wallet_id ?? null,
          category_id: s.category_id ?? null,
          other_account_id: s.other_account_id ?? null,
          from_wallet_id: s.from_wallet_id ?? null,
          income_stream_id: s.income_stream_id ?? null,
          tenant_id: s.tenant_id ?? null,
          debt_id: s.debt_id ?? null,
          receivable_id: s.receivable_id ?? null,
          link_id: s.link_id ?? null,
          taxable: s.taxable,
          asset_kind: s.asset_kind ?? null,
          note: s.note ?? null,
        }));
        const result = await ingest.assignLog(db, args.log_id, splits, memberId, now());
        await audit(db, actor, "log.assign", `log:${args.log_id}`, { splits: splits.length });
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
        "meaning is one of: spend, income, refund, transfer (between accounts or out of a wallet), buy_asset (buy an asset with wealth-building money), " +
        "lend (lend or pay on someone's behalf: money leaves, no wallet is charged), collect (money lent comes back: money arrives, it is NOT income, " +
        "no wallet is credited and nothing is allocated — do not use refund for repaid loans). " +
        "amount is a positive integer VND. by_member_id (who is recording this) is optional and defaults to the member who authorized this connection — valid ids: " +
        `${memberHint}. Missing wallet_id/account_id are inferred from category_id (the category's default wallet) and the recorder's cash account, ` +
        "exactly as the REST API does. transfer needs account_id (source) + to_account_id (destination), plus wallet_id/from_wallet_id to move wallets too; " +
        "transfer WITHOUT accounts but with from_wallet_id + wallet_id moves budget between two wallets (the money stays in its account). " +
        "income: income_stream_id = income stream (allocated by the stream's locked shares), tenant_id = rent paid by a tenant (id from list_tenants; " +
        "without a stream the rental stream is used). " +
        "spend: debt_id = a debt repayment (id from get_debts; without category_id the debt-repayment category is used). " +
        "lend / collect: receivable_id = the receivable (id from get_receivables); account_id = account money leaves (lend) / arrives in (collect). " +
        "buy_asset needs asset_kind (stock|gold|re|fund). Get category_id/wallet_id/account_id from list_categories or get_snapshot.",
      inputSchema: {
        meaning: z.enum(MANUAL_MEANINGS),
        amount: z.number().int().positive(),
        by_member_id: z.string().min(1).optional(),
        category_id: z.string().optional(),
        wallet_id: z.string().optional(),
        from_wallet_id: z.string().optional(),
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
        receivable_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const by = args.by_member_id ?? memberId;
        if (!memberIds.has(by)) {
          throw new DomainError("unknown_member", `Không có thành viên đang hoạt động với id "${by}".`, 404);
        }
        const input: EntryInput = {
          meaning: args.meaning,
          amount: args.amount,
          at: args.at,
          category_id: args.category_id ?? null,
          wallet_id: args.wallet_id ?? null,
          from_wallet_id: args.from_wallet_id ?? null,
          account_id: args.account_id ?? null,
          to_account_id: args.to_account_id ?? null,
          note: args.note ?? null,
          taxable: args.taxable ?? false,
          link_id: args.link_id ?? null,
          asset_kind: args.asset_kind ?? null,
          income_stream_id: args.income_stream_id ?? null,
          tenant_id: args.tenant_id ?? null,
          debt_id: args.debt_id ?? null,
          receivable_id: args.receivable_id ?? null,
        };
        const result = await ledger.createEntry(db, input, by, now());
        // Không trùng thì tx là dòng vừa ghi.
        if (!result.duplicate) await audit(db, actor, "tx.create", `tx:${result.tx!.id}`, { meaning: args.meaning, by_member_id: by });
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
        "Active spending categories with their default wallet (default_wallet_id) — use them to map a spoken phrase (e.g. 'xăng xe', fuel) " +
        "to category_id/wallet_id for add_transaction.",
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
        "Spending per category for one month, compared with the previous month. period is a month '2026-09'; omit it for the current month.",
      inputSchema: { period: z.string().optional() },
    },
    async (args) => {
      try {
        return ok(await ledger.spendByCategory(db, args.period ?? monthKey(now())));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_transfer_orders",
    {
      description:
        "Pending transfer orders between bank accounts (created after allocating income or closing a month).",
    },
    async () => {
      try {
        return ok(await ledger.listTransferOrders(db, "pending"));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "preview_allocation",
    {
      description:
        "Preview how an income amount would be allocated with Profit First — nothing is recorded. " +
        "amount: positive integer VND. taxable: whether this income is subject to personal income tax.",
      inputSchema: { amount: z.number().int().positive(), taxable: z.boolean() },
    },
    async (args) => {
      try {
        return ok(await ledger.previewAllocation(db, { amount: args.amount, taxable: args.taxable, at: now().toISOString(), accountId: null }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "allocate_income",
    {
      description:
        "Allocate a recorded income (income_tx_id from add_transaction with meaning=income) into wallets with Profit First; " +
        "creates transfer orders when a target wallet lives in a different account from the receiving one. Each income can be allocated only once.",
      inputSchema: { income_tx_id: z.number().int().positive() },
    },
    async (args) => {
      try {
        const result = await ledger.allocateIncome(db, args.income_tx_id);
        await audit(db, actor, "income.allocate", `tx:${args.income_tx_id}`, null);
        return ok(result);
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
        "Tenant ledger: tenants with their balance (positive = tenant still owes, negative = overpaid, deducted next month) " +
        "and fixed monthly fees; the headcount sharing common expenses, the shared-expense categories and the rental income stream. No parameters.",
    },
    async () => {
      try {
        return ok(await rental.getRental(db));
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
        "the debt lines and the payments; totalBalance = total still owed. No parameters.",
    },
    async () => {
      try {
        const data = await debts.getDebts(db);
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
        const data = await receivables.getReceivables(db);
        return ok(data, `Người khác còn nợ: ${vnd(data.totalBalance)}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "add_tenant_shared_expense",
    {
      description:
        "Record a shared household expense paid by a tenant out of their own pocket (e.g. 'the tenant bought groceries for 300k') — " +
        "lowers the tenant's balance and adds to the month's shared expenses. " +
        "tenant_id from list_tenants; amount is a positive integer VND; category_id must be a shared-expense category (sharedCategoryIds from list_tenants).",
      inputSchema: {
        tenant_id: z.string().min(1),
        amount: z.number().int().positive(),
        category_id: z.string().min(1),
        note: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { line, duplicate } = await rental.addLine(db, args.tenant_id, { kind: "paid_for_us", amount: args.amount, category_id: args.category_id, name: args.note }, now());
        if (!duplicate) await audit(db, actor, "tenant.paid_for_us", `tenant:${args.tenant_id}`, { category_id: args.category_id });
        return ok(line, `Đã ghi người thuê chi hộ ${vnd(args.amount)}.`);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
