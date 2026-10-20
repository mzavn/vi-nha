import { Hono, type Context } from "hono";
import { parseManualAmounts } from "../domain/allocation";
import { MANUAL_MEANINGS, normalizeAt, type EntryInput } from "../domain/entry";
import { dayKey, monthKey, weekKey } from "../domain/period";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import { recordChange } from "../services/audit";
import { debtInterest } from "../services/debts";
import * as ledger from "../services/ledger";

export const v1 = new Hono<AppEnv>();

const ok = <T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) => c.json({ ok: true, data }, status);
const bad = (message: string, code = "invalid_input"): never => {
  throw new DomainError(code, message);
};

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) bad("Nội dung gửi lên phải là một object JSON.");
  return data as Record<string, unknown>;
}

const str = (v: unknown, name: string): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") bad(`${name} phải là chuỗi.`);
  return v as string;
};
const int = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v)) bad(`${name} phải là số nguyên.`);
  return v as number;
};
const idParam = (c: Context<AppEnv>) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) bad("id không hợp lệ.");
  return id;
};
const now = () => new Date();

// ── Dữ liệu nền cho PWA: cache lại để nhập được khi mất mạng ─────────
v1.get("/bootstrap", async (c) => {
  const refs = await ledger.loadRefs(c.env.DB);
  const interest = new Map((await debtInterest(c.env.DB, monthKey(now()))).map((d) => [d.debtId, d]));
  const memberId = c.get("memberId");
  return ok(c, {
    member: refs.members.find((m) => m.id === memberId) ?? null,
    members: refs.members,
    wallets: refs.wallets.map((w) => ({ ...w, hidden: w.private && w.memberId !== memberId })),
    categories: refs.categories,
    accounts: refs.accounts,
    // Đủ để sheet Trả nợ tách lãi / gốc khi mất mạng (debt UC-902): lãi suất, số trả tháng, lãi dự kiến và đã trả tháng này.
    debts: refs.debts
      .filter((d) => d.active)
      .map(({ id, name, balance }) => {
        const i = interest.get(id);
        return {
          id,
          name,
          balance,
          interestRate: (i?.rateBps ?? 0) / 100,
          monthlyPayment: i?.monthlyPayment ?? null,
          dueDay: i?.dueDay ?? null,
          interestThisMonth: i?.expected ?? 0,
          interestPaidThisMonth: i?.paid ?? 0,
        };
      }),
    receivables: refs.receivables.filter((r) => r.active).map(({ id, name, balance }) => ({ id, name, balance })),
    categoryUsage: await ledger.categoryUsage(c.env.DB, now()),
  });
});

v1.get("/snapshot", async (c) => ok(c, await ledger.getSnapshot(c.env.DB, c.get("memberId"), now())));
v1.get("/networth", async (c) => ok(c, await ledger.netWorth(c.env.DB, c.get("memberId"), now())));

v1.get("/budget", async (c) => {
  const t = now();
  const period = c.req.query("period") ?? (c.req.query("kind") === "week" ? weekKey(t) : monthKey(t));
  return ok(c, await ledger.getBudget(c.env.DB, period, c.get("memberId")));
});

v1.get("/goals", async (c) => ok(c, await ledger.goals(c.env.DB)));
v1.get("/wealth-building", async (c) => ok(c, await ledger.wealthBuildingBreakdown(c.env.DB)));
v1.get("/accounts", async (c) => ok(c, await ledger.reconcile(c.env.DB)));
v1.get("/spend-by-category", async (c) => ok(c, await ledger.spendByCategory(c.env.DB, c.req.query("period") ?? monthKey(now()))));

v1.post("/accounts/:id/count", async (c) => {
  const b = await body(c);
  return ok(c, await ledger.countAccount(c.env.DB, c.req.param("id"), int(b.counted, "counted"), c.get("memberId"), now()), 201);
});

// ── Giao dịch nhập tay ──────────────────────────────────────────────
const REF_ID = /^[\w.-]{1,64}$/;
const DAY_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
function filterDay(v: string | undefined, name: string, today: string): string | undefined {
  if (v === undefined) return undefined;
  if (!DAY_REGEX.test(v)) bad(`${name} phải có dạng YYYY-MM-DD.`);
  const d = new Date(`${v}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime()) || dayKey(d) !== v) bad(`${name} phải có dạng YYYY-MM-DD.`);
  if (v > today) bad("Ngày lọc không được sau hôm nay.");
  return v;
}
/** Bộ lọc sổ giao dịch dùng chung cho danh sách và tổng (ledger UC-111, pwa UC-716); tham số sai → `invalid_input`. */
function txFilter(c: Context<AppEnv>): ledger.TxFilter {
  const q = (name: string) => c.req.query(name) || undefined;
  const ref = (name: string) => {
    const v = q(name);
    if (v !== undefined && !REF_ID.test(v)) bad(`${name} không hợp lệ.`);
    return v;
  };
  const today = dayKey(new Date());
  const fromDate = filterDay(q("from_date"), "from_date", today);
  const toDate = filterDay(q("to_date"), "to_date", today);
  if (fromDate && toDate && fromDate > toDate) bad("from_date không được sau to_date.");
  const month = q("month");
  if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) bad("month phải có dạng YYYY-MM.");
  const meanings = q("meaning")?.split(",");
  if (meanings?.some((m) => !(ledger.BOOK_MEANINGS as readonly string[]).includes(m))) bad(`meaning phải là một hoặc nhiều trong: ${ledger.BOOK_MEANINGS.join(", ")}.`);
  const source = q("source");
  if (source !== undefined && source !== "manual" && source !== "bank") bad("source phải là manual hoặc bank.");
  const text = c.req.query("q")?.trim();
  if (text !== undefined && text.length < 2) bad("Từ tìm phải có ít nhất 2 ký tự.");
  if (text !== undefined && text.length > 100) bad("Từ tìm dài quá 100 ký tự.");
  return {
    month,
    fromDate,
    toDate,
    meanings,
    categoryId: ref("category_id"),
    walletId: ref("wallet_id"),
    accountId: ref("account_id"),
    memberId: ref("member_id"),
    source: source as ledger.TxFilter["source"],
    q: text,
    includeVoid: c.req.query("include_void") === "1",
  };
}

v1.get("/transactions", async (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  const before = c.req.query("before") ? Number(c.req.query("before")) : undefined;
  if (!Number.isInteger(limit) || (before !== undefined && !Number.isInteger(before))) bad("limit / before phải là số nguyên.");
  return ok(c, await ledger.listTransactions(c.env.DB, txFilter(c), limit, before));
});
// Trước `/transactions/:id`: "summary", "link-candidates" không phải id.
v1.get("/transactions/summary", async (c) => ok(c, await ledger.transactionSummary(c.env.DB, txFilter(c))));
v1.get("/transactions/link-candidates", async (c) => {
  const meaning = c.req.query("meaning");
  if (meaning !== "spend" && meaning !== "lend") bad("meaning phải là spend hoặc lend.");
  const days = Number(c.req.query("days") ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 366) bad("days phải là số nguyên 1–366.");
  return ok(c, await ledger.linkCandidates(c.env.DB, meaning as "spend" | "lend", now(), days));
});
v1.get("/transactions/:id", async (c) => ok(c, await ledger.transactionView(c.env.DB, idParam(c))));

/** Thân của một khoản nhập tay — dùng chung cho ghi mới và sửa (thay khoản cũ). */
function entryInput(b: Record<string, unknown>): EntryInput {
  const meaning = str(b.meaning, "meaning");
  if (!meaning || !(MANUAL_MEANINGS as readonly string[]).includes(meaning)) bad(`meaning phải là một trong: ${MANUAL_MEANINGS.join(", ")}.`);
  const input: EntryInput = {
    meaning: meaning as EntryInput["meaning"],
    amount: int(b.amount, "amount"),
    at: str(b.at, "at"),
    category_id: str(b.category_id, "category_id"),
    wallet_id: str(b.wallet_id, "wallet_id"),
    from_wallet_id: str(b.from_wallet_id, "from_wallet_id"),
    account_id: str(b.account_id, "account_id"),
    to_account_id: str(b.to_account_id, "to_account_id"),
    note: str(b.note, "note"),
    taxable: b.taxable === true,
    link_id: b.link_id === undefined || b.link_id === null ? null : int(b.link_id, "link_id"),
    asset_kind: str(b.asset_kind, "asset_kind"),
    client_id: str(b.client_id, "client_id"),
    income_stream_id: str(b.income_stream_id, "income_stream_id"),
    tenant_id: str(b.tenant_id, "tenant_id"),
    debt_id: str(b.debt_id, "debt_id"),
    receivable_id: str(b.receivable_id, "receivable_id"),
    interest_debt_id: str(b.interest_debt_id, "interest_debt_id"),
    confirm_duplicate: b.confirm_duplicate === true,
  };
  if (input.client_id && !/^[A-Za-z0-9_-]{8,64}$/.test(input.client_id)) bad("client_id phải là chuỗi 8–64 ký tự chữ, số, gạch.");
  return input;
}

v1.post("/transactions", async (c) => {
  const result = await ledger.createEntry(c.env.DB, entryInput(await body(c)), c.get("memberId"), now());
  return ok(c, result, result.duplicate ? 200 : 201);
});

v1.post("/transactions/:id/void", async (c) => {
  const id = idParam(c);
  const tx = await ledger.voidTransaction(c.env.DB, id);
  await recordChange(c, "tx.void", `tx:${id}`, null);
  return ok(c, tx);
});

// Sửa = huỷ khoản cũ + ghi khoản mới trong một batch (ADR-73). Chỉ khoản ghi tay.
v1.post("/transactions/:id/replace", async (c) => {
  const id = idParam(c);
  const result = await ledger.replaceTransaction(c.env.DB, id, entryInput(await body(c)), c.get("memberId"), now());
  if (!result.duplicate) await recordChange(c, "tx.replace", `tx:${id}`, null);
  return ok(c, result, result.duplicate ? 200 : 201);
});

// ── Chia tiền ───────────────────────────────────────────────────────
// `amounts`: Tự chia (UC-203) — số tay cho từng ví thay cho luật nạp. `wealth_amount`: Tích sản người chọn (ADR-112).
const wealthAmount = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) bad("Số Tích sản không hợp lệ: wealth_amount phải là số nguyên không âm.", "invalid_amounts");
  return v as number;
};

v1.post("/allocate/preview", async (c) => {
  const b = await body(c);
  return ok(
    c,
    await ledger.previewAllocation(
      c.env.DB,
      {
        amount: int(b.amount, "amount"),
        taxable: b.taxable === true,
        at: normalizeAt(str(b.at, "at"), now()),
        accountId: str(b.account_id, "account_id") ?? null,
        incomeStreamId: str(b.income_stream_id, "income_stream_id") ?? null,
      },
      { amounts: b.amounts === undefined ? undefined : parseManualAmounts(b.amounts), wealthAmount: wealthAmount(b.wealth_amount) },
    ),
  );
});

v1.post("/allocate", async (c) => {
  const b = await body(c);
  // Lý do Tích sản 0: cắt khoảng trắng hai đầu, tối đa 500 ký tự; rỗng = không có.
  const note = str(b.wealth_note, "wealth_note")?.trim();
  if (note && note.length > 500) bad("wealth_note dài quá 500 ký tự.");
  // Ký tự điều khiển (trừ xuống dòng) không phải chữ người gõ — chặn để lý do hiển thị / xuất ra không bị phá.
  if (note && /[\u0000-\u0009\u000B-\u001F\u007F]/.test(note)) bad("wealth_note có ký tự không hợp lệ.");
  const opts = {
    amounts: b.amounts === undefined ? undefined : parseManualAmounts(b.amounts),
    wealthAmount: wealthAmount(b.wealth_amount),
    wealthNote: note || null,
  };
  const id = int(b.income_tx_id, "income_tx_id");
  const result = await ledger.allocateIncome(c.env.DB, id, opts);
  await recordChange(c, "income.allocate", `tx:${id}`, {
    wealth_amount: opts.wealthAmount ?? null,
    manual: opts.amounts !== undefined,
    no_wealth: result.wealth?.amount === 0,
  });
  return ok(c, result, 201);
});

// ── Chốt tháng (allocation UC-207) ──────────────────────────────────
// Tháng luôn là tháng liền trước theo giờ VN. `wealth_pct`: % phần dư vào Tích sản; không gửi = mặc định.
v1.get("/month-close", async (c) => {
  const q = c.req.query("wealth_pct");
  if (q && !/^\d{1,3}$/.test(q)) bad("wealth_pct phải là số nguyên từ 0 đến 100.");
  return ok(c, await ledger.previewMonthClose(c.env.DB, now(), { wealthPct: q ? Number(q) : undefined }));
});

v1.post("/month-close", async (c) => {
  const b = await body(c);
  const month = typeof b.month === "string" ? b.month : "";
  const wealthPct = b.wealth_pct === undefined || b.wealth_pct === null ? undefined : int(b.wealth_pct, "wealth_pct");
  const result = await ledger.closeMonth(c.env.DB, month, { wealthPct, memberId: c.get("memberId") }, now());
  await recordChange(c, "month.close", `month:${result.month}`, {
    wealth_pct: result.wealthPct,
    reward_wallet_id: result.rewardWalletId,
    to_wealth: result.toWealth,
    to_reward: result.toReward,
    covered: result.covered,
  });
  return ok(c, result, 201);
});

// ── Lệnh chuyển tiền ────────────────────────────────────────────────
v1.get("/transfer-orders", async (c) => ok(c, await ledger.listTransferOrders(c.env.DB, c.req.query("status") ?? "pending")));
v1.post("/transfer-orders/:id/done", async (c) => ok(c, await ledger.setTransferOrderStatus(c.env.DB, idParam(c), "done")));
v1.post("/transfer-orders/:id/skip", async (c) => ok(c, await ledger.setTransferOrderStatus(c.env.DB, idParam(c), "skipped")));

// ── Danh mục ────────────────────────────────────────────────────────
v1.get("/categories", async (c) => ok(c, (await ledger.loadRefs(c.env.DB)).categories));
/** Chỉ nhận đúng các trường của danh mục, đúng kiểu — không đẩy nguyên body xuống tầng dịch vụ. */
async function categoryInput(c: Context<AppEnv>): Promise<Parameters<typeof ledger.saveCategory>[1]> {
  const b = await body(c);
  const nullable = (v: unknown, name: string) => (v === null ? null : str(v, name));
  return {
    id: str(b.id, "id"),
    name: str(b.name, "name"),
    default_wallet_id: b.default_wallet_id === undefined ? undefined : nullable(b.default_wallet_id, "default_wallet_id"),
    icon: b.icon === undefined ? undefined : nullable(b.icon, "icon"),
    sort: b.sort === undefined ? undefined : int(b.sort, "sort"),
    active: b.active === undefined ? undefined : b.active === true,
  };
}
v1.post("/categories", async (c) => ok(c, await ledger.saveCategory(c.env.DB, await categoryInput(c)), 201));
v1.patch("/categories/:id", async (c) => ok(c, await ledger.saveCategory(c.env.DB, await categoryInput(c), c.req.param("id"))));

// ── Quyết toán thuế ─────────────────────────────────────────────────
v1.get("/tax/:year", async (c) => ok(c, await ledger.getTax(c.env.DB, Number(c.req.param("year")))));
v1.post("/tax/:year/settle", async (c) => ok(c, await ledger.settleTax(c.env.DB, Number(c.req.param("year")), now()), 201));
