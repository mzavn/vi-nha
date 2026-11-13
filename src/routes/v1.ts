import { Hono, type Context } from "hono";
import { MANUAL_MEANINGS, rejectOldFields, type EntryInput } from "../domain/entry";
import { dayKey, monthKey, weekKey } from "../domain/period";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import { afterResponse, fieldNames, recordChange } from "../services/audit";
import { notifySalary } from "../notify/salary";
import { hiddenAccountIds } from "../services/privacy";
import { debtInterest } from "../services/debts";
import * as conversion from "../services/conversion";
import * as ledger from "../services/ledger";
import * as monthTasks from "../services/month-tasks";
import { setGoalMonthAmount } from "../services/pockets";

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
  const hidden = await hiddenAccountIds(c.env.DB, memberId);
  return ok(c, {
    member: refs.members.find((m) => m.id === memberId) ?? null,
    members: refs.members,
    categories: refs.categories,
    accounts: refs.accounts.map((a) => ({ ...a, hiddenFromMe: hidden.includes(a.id) })),
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

// Ngân sách theo ví đã bỏ (ledger UC-104 deprecated, ADR-127): app 1.x còn mở thấy lỗi rõ thay vì số đứng yên.
v1.get("/budget", () => {
  throw new DomainError("model_changed", "Ví nhà v2 đã bỏ ngân sách theo ví: xem `GET /v1/spend-by-category` (Chi tiêu theo tháng).", 410);
});

v1.get("/goals", async (c) => ok(c, await ledger.goals(c.env.DB, c.get("memberId"), now())));
// Ví Tích sản đã xoá ở 0040 (ledger UC-107, ADR-131): app 1.x còn mở thấy lỗi rõ.
v1.get("/wealth-building", () => {
  throw new DomainError("model_changed", "Ví nhà v2 đã bỏ ví Tích sản: xem Tích luỹ ở `GET /v1/snapshot` (`pockets.savings`).", 410);
});
v1.get("/accounts", async (c) => ok(c, await ledger.reconcile(c.env.DB)));
v1.get("/spend-by-category", async (c) => {
  ledger.rejectCycleParam(c.req.query("cycle"));
  return ok(c, await ledger.spendByCategory(c.env.DB, { period: c.req.query("period") }, now()));
});

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
/**
 * Bộ lọc sổ giao dịch dùng chung cho danh sách và tổng (ledger UC-111, pwa UC-716); tham số sai → `invalid_input`. Lọc theo
 * tháng bằng `month`; `cycle` của client cũ → 400 `model_changed` (ADR-144).
 */
function txFilter(c: Context<AppEnv>): ledger.TxFilter {
  ledger.rejectCycleParam(c.req.query("cycle"));
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
  return ok(c, await ledger.listTransactions(c.env.DB, txFilter(c), limit, before, c.get("memberId")));
});
// Trước `/transactions/:id`: "summary", "link-candidates" không phải id.
v1.get("/transactions/summary", async (c) => ok(c, await ledger.transactionSummary(c.env.DB, txFilter(c), c.get("memberId"))));
v1.get("/transactions/link-candidates", async (c) => {
  const meaning = c.req.query("meaning");
  if (meaning !== "spend" && meaning !== "lend") bad("meaning phải là spend hoặc lend.");
  const days = Number(c.req.query("days") ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 366) bad("days phải là số nguyên 1–366.");
  return ok(c, await ledger.linkCandidates(c.env.DB, meaning as "spend" | "lend", now(), days, c.get("memberId")));
});
v1.get("/transactions/:id", async (c) => ok(c, await ledger.transactionView(c.env.DB, idParam(c), c.get("memberId"))));

/** Thân của một khoản nhập tay — dùng chung cho ghi mới và sửa (thay khoản cũ). Trường ví cũ / `opens_cycle` → 400 `model_changed`. */
function entryInput(b: Record<string, unknown>): EntryInput {
  rejectOldFields(b);
  const meaning = str(b.meaning, "meaning");
  if (!meaning || !(MANUAL_MEANINGS as readonly string[]).includes(meaning)) bad(`meaning phải là một trong: ${MANUAL_MEANINGS.join(", ")}.`);
  const input: EntryInput = {
    meaning: meaning as EntryInput["meaning"],
    amount: int(b.amount, "amount"),
    at: str(b.at, "at"),
    category_id: str(b.category_id, "category_id"),
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
    // Kiểu kiểm ở resolveIsSalary (invalid_input), giá trị không hợp lệ cũng báo ở đó.
    is_salary: b.is_salary as boolean | undefined,
    goal_id: str(b.goal_id, "goal_id"),
    // `is_interest: false` khi sửa = bỏ "Đây là tiền lãi" (không chép phân loại lãi của khoản cũ); không gửi = giữ như cũ.
    is_interest: b.is_interest === undefined || b.is_interest === null ? undefined : b.is_interest === true,
    from_interest: b.from_interest === true,
  };
  if (input.client_id && !/^[A-Za-z0-9_-]{8,64}$/.test(input.client_id)) bad("client_id phải là chuỗi 8–64 ký tự chữ, số, gạch.");
  return input;
}

/** Khoản lương vừa có nhắc ① (`effects.savings`): báo lương về sau khi trả lời (notify UC-412; chống trùng theo id khoản thu). */
async function announceSalary(c: Context<AppEnv>, txId: unknown, effects: ledger.WriteEffects) {
  if (effects.savings) await afterResponse(c, notifySalary(c.env, Number(txId)));
}

v1.post("/transactions", async (c) => {
  const result = await ledger.createEntry(c.env.DB, entryInput(await body(c)), c.get("memberId"), now());
  if (!result.duplicate) await announceSalary(c, result.tx?.id, result.effects);
  return ok(c, result, result.duplicate ? 200 : 201);
});

v1.post("/transactions/:id/void", async (c) => {
  const id = idParam(c);
  const tx = await ledger.voidTransaction(c.env.DB, id, c.get("memberId"), now());
  await recordChange(c, "tx.void", `tx:${id}`, null);
  return ok(c, tx);
});

// Sửa = huỷ khoản cũ + ghi khoản mới trong một batch (ADR-73). Chỉ khoản ghi tay.
v1.post("/transactions/:id/replace", async (c) => {
  const id = idParam(c);
  const result = await ledger.replaceTransaction(c.env.DB, id, entryInput(await body(c)), c.get("memberId"), now());
  if (!result.duplicate) {
    await recordChange(c, "tx.replace", `tx:${id}`, null);
    await announceSalary(c, (result.tx as Record<string, unknown>).id, result.effects);
  }
  return ok(c, result, result.duplicate ? 200 : 201);
});

// "Đây là lương" của một khoản thu đã ghi, kể cả khoản từ SePay (pocket UC-1205 AC-6). Nhật ký `tx.salary` chỉ khi thật sự đổi.
v1.post("/transactions/:id/salary", async (c) => {
  const id = idParam(c);
  const result = await monthTasks.setSalary(c.env.DB, id, await body(c), c.get("memberId"), now());
  if (result.changed) await recordChange(c, "tx.salary", `tx:${id}`, { from: result.from, to: result.to });
  return ok(c, { tx: await ledger.transactionView(c.env.DB, id, c.get("memberId")), savings: result.savings });
});

// ── Việc tháng (pocket UC-1206): nhắc ① trích Tích luỹ, việc chia dư ──
// Trả `snapshot.month` sau khi đổi (chưa có `goalHint`) để PWA vá bản snapshot đang giữ.
const taskRoute = (action: (db: D1Database, id: number, b: Record<string, unknown>, memberId: string | null, at: Date) => Promise<monthTasks.TaskActionResult>) =>
  async (c: Context<AppEnv>) => {
    const id = idParam(c);
    const b = c.req.header("content-length") === "0" ? {} : await c.req.json().catch(() => ({}));
    const result = await action(c.env.DB, id, b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}, c.get("memberId"), now());
    await recordChange(c, result.audit.action, `month_task:${id}`, result.audit.detail);
    return ok(c, result.view);
  };
v1.post("/month-tasks/:id/done", taskRoute(monthTasks.markTaskDone));
v1.post("/month-tasks/:id/skip", taskRoute(monthTasks.skipTask));
v1.post("/month-tasks/:id/reopen", taskRoute((db, id, _b, memberId, at) => monthTasks.reopenTask(db, id, memberId, at)));
v1.patch("/month-tasks/:id", taskRoute(monthTasks.setTaskAmount));

// ── Chia dư cuối tháng (pocket UC-1207): chỉ tháng vừa hết ──────────
v1.post("/month-close", async (c) => {
  const { monthClose, audit } = await monthTasks.splitMonth(c.env.DB, await body(c), c.get("memberId"), now());
  await recordChange(c, audit.action, `month:${monthClose.month}`, audit.detail);
  return ok(c, { monthClose }, 201);
});
v1.post("/month-close/:month/skip", async (c) => {
  const { monthClose, audit } = await monthTasks.skipMonth(c.env.DB, c.req.param("month"), c.get("memberId"), now());
  await recordChange(c, audit.action, `month:${monthClose.month}`, audit.detail);
  return ok(c, { monthClose });
});
// Hoàn tác Chia / Để lại Vận hành (UC-1207 AC-7): void việc chia dư + xoá dòng tháng trong một batch.
v1.post("/month-close/:month/reopen", async (c) => {
  const { monthClose, audit } = await monthTasks.reopenMonth(c.env.DB, c.req.param("month"), now());
  await recordChange(c, audit.action, `month:${monthClose.month}`, audit.detail);
  return ok(c, { monthClose });
});

// Số tháng này của khoản trả thẳng từ tiền chi tiêu (pocket UC-1209 bước 12, ADR-143, ADR-144): chỉ tháng VN hiện tại.
v1.put("/goal-month-amounts/:goalId", async (c) => {
  const { goal, month, amount } = await setGoalMonthAmount(c.env.DB, c.req.param("goalId"), await body(c), now());
  await recordChange(c, "goal.month_amount", `goal:${goal.id}`, { month, amount });
  return ok(c, { goal });
});

// ── Đường của mô hình ví cũ (ADR-123): chia tiền, chốt tháng, lệnh chuyển đã bỏ → 410 ─────────
const gone = (c: Context<AppEnv>) =>
  c.json({ ok: false, error: { code: "model_changed", message: "Ví nhà v2 đã bỏ chia tiền và lệnh chuyển: lương về có nhắc trích Tích luỹ, cuối tháng chia dư." } }, 410);
for (const path of ["/allocate", "/allocate/*", "/transfer-orders", "/transfer-orders/*"]) v1.all(path, gone);

// ── Chuyển sang ba ngăn một lần (pocket UC-1208) ────────────────────
v1.get("/conversion", async (c) => ok(c, await conversion.getConversion(c.env.DB)));
// Mọi 409 kèm `steps` / `next` để app vẽ lại đúng bước (gửi lại sau khi mất phản hồi không phải lỗi). Không ghi gì khi lỗi.
v1.post("/conversion/steps/:step", async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as unknown;
  const input = b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  try {
    const r = await conversion.claimStep(c.env.DB, c.req.param("step"), input, c.get("memberId"), now());
    await recordChange(c, "conversion.step", `conversion:${r.detail.step}`, r.detail);
    if (r.done) await recordChange(c, "conversion.done", "conversion", null);
    return ok(c, r.view);
  } catch (err) {
    if (!(err instanceof DomainError) || err.status !== 409) throw err;
    const { steps, next } = await conversion.getConversion(c.env.DB);
    return c.json({ ok: false, error: { code: err.code, message: err.message }, steps, next }, 409);
  }
});

// ── Danh mục ────────────────────────────────────────────────────────
v1.get("/categories", async (c) => ok(c, (await ledger.loadRefs(c.env.DB)).categories));
/** Chỉ nhận đúng các trường của danh mục, đúng kiểu — không đẩy nguyên body xuống tầng dịch vụ. */
function categoryInput(b: Record<string, unknown>): Parameters<typeof ledger.saveCategory>[1] {
  rejectOldFields(b, ["default_wallet_id"]);
  const nullable = (v: unknown, name: string) => (v === null ? null : str(v, name));
  return {
    id: str(b.id, "id"),
    name: str(b.name, "name"),
    icon: b.icon === undefined ? undefined : nullable(b.icon, "icon"),
    sort: b.sort === undefined ? undefined : int(b.sort, "sort"),
    active: b.active === undefined ? undefined : b.active === true,
    group_id: b.group_id === undefined ? undefined : nullable(b.group_id, "group_id"),
  };
}
// Nhật ký `category.create` / `category.update` (tên trường đã gửi) chỉ khi ghi được (ledger UC-109 AC-10).
v1.post("/categories", async (c) => {
  const b = await body(c);
  const category = await ledger.saveCategory(c.env.DB, categoryInput(b));
  await recordChange(c, "category.create", `category:${category!.id}`, { fields: fieldNames(b) });
  return ok(c, category, 201);
});
v1.patch("/categories/:id", async (c) => {
  const b = await body(c);
  const category = await ledger.saveCategory(c.env.DB, categoryInput(b), c.req.param("id"));
  await recordChange(c, "category.update", `category:${category!.id}`, { fields: fieldNames(b) });
  return ok(c, category);
});

// ── Quyết toán thuế ─────────────────────────────────────────────────
v1.get("/tax/:year", async (c) => ok(c, await ledger.getTax(c.env.DB, Number(c.req.param("year")))));
v1.post("/tax/:year/settle", async (c) => ok(c, await ledger.settleTax(c.env.DB, Number(c.req.param("year")), now()), 201));
