import { Hono, type Context } from "hono";
import { suggestRulePattern } from "../domain/rules";
import { DomainError } from "../domain/types";
import type { AppEnv } from "../env";
import { recordChange } from "../services/audit";
import * as ingest from "../services/ingest";
import type { Split, SplitMeaning } from "../services/ingest";

// /v1/logs…, /v1/rules — phase 04. Mount sau requireAuth.
export const logs = new Hono<AppEnv>();

const ok = <T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) => c.json({ ok: true, data }, status);
const bad = (message: string, code = "invalid_input"): never => {
  throw new DomainError(code, message);
};

async function body(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) bad("Nội dung gửi lên phải là một object JSON.");
  return data as Record<string, unknown>;
}

const SPLIT_MEANINGS: readonly SplitMeaning[] = ["spend", "transfer", "income", "refund", "lend", "collect", "buy_asset"];

function parseSplit(raw: unknown, index: number): Split {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad(`splits[${index}] phải là object.`);
  const s = raw as Record<string, unknown>;
  if (typeof s.meaning !== "string" || !SPLIT_MEANINGS.includes(s.meaning as SplitMeaning)) {
    bad(`splits[${index}].meaning phải là một trong: ${SPLIT_MEANINGS.join(", ")}.`);
  }
  if (typeof s.amount !== "number" || !Number.isInteger(s.amount) || s.amount <= 0) {
    bad(`splits[${index}].amount phải là số nguyên dương.`);
  }
  if (s.link_id !== undefined && s.link_id !== null && (typeof s.link_id !== "number" || !Number.isInteger(s.link_id) || s.link_id <= 0)) {
    bad(`splits[${index}].link_id phải là số nguyên dương.`);
  }
  return {
    meaning: s.meaning as SplitMeaning,
    amount: s.amount as number,
    wallet_id: typeof s.wallet_id === "string" ? s.wallet_id : null,
    category_id: typeof s.category_id === "string" ? s.category_id : null,
    other_account_id: typeof s.other_account_id === "string" ? s.other_account_id : null,
    from_wallet_id: typeof s.from_wallet_id === "string" ? s.from_wallet_id : null,
    income_stream_id: typeof s.income_stream_id === "string" ? s.income_stream_id : null,
    tenant_id: typeof s.tenant_id === "string" ? s.tenant_id : null,
    debt_id: typeof s.debt_id === "string" ? s.debt_id : null,
    receivable_id: typeof s.receivable_id === "string" ? s.receivable_id : null,
    link_id: typeof s.link_id === "number" ? s.link_id : null,
    taxable: s.taxable === true,
    asset_kind: typeof s.asset_kind === "string" ? s.asset_kind : null,
    note: typeof s.note === "string" ? s.note : null,
  };
}

// ── Log chưa gán ────────────────────────────────────────────────────
logs.get("/logs", async (c) => {
  const status = c.req.query("status") ?? "pending";
  if (status !== "pending") bad("Chỉ hỗ trợ status=pending.", "invalid_status");
  const limit = Number(c.req.query("limit") ?? 50);
  if (!Number.isInteger(limit)) bad("limit phải là số nguyên.");
  return ok(c, await ingest.listPendingLogs(c.env.DB, limit));
});

logs.post("/logs/:id/assign", async (c) => {
  const b = await body(c);
  if (!Array.isArray(b.splits) || b.splits.length === 0) bad("Cần mảng splits với ít nhất một dòng.");
  const splits = (b.splits as unknown[]).map((s, i) => parseSplit(s, i));

  // create_rule: bỏ trống / false = không tạo; true = tự rút mẫu từ nội dung log; object = mẫu do người gọi chỉ định.
  // Mọi điều kiện kiểm tra TRƯỚC khi ghi sổ: không được để request báo lỗi sau khi giao dịch đã vào sổ.
  const wantRule = b.create_rule !== undefined && b.create_rule !== null && b.create_rule !== false;
  let explicit: { matchType: string; pattern: string } | null = null;
  if (wantRule && b.create_rule !== true) {
    if (typeof b.create_rule !== "object") bad("create_rule phải là true/false hoặc object {match_type, pattern}.");
    const { match_type: matchType, pattern } = b.create_rule as Record<string, unknown>;
    if (typeof matchType !== "string" || typeof pattern !== "string" || !pattern.trim()) bad("create_rule cần match_type và pattern dạng chuỗi.");
    explicit = { matchType: matchType as string, pattern: (pattern as string).trim() };
  }
  const ruleBlocker = !wantRule
    ? null
    : splits.length !== 1
      ? "Chỉ tạo rule khi gán đúng một dòng."
      : splits[0]!.meaning !== "spend" && splits[0]!.meaning !== "transfer"
        ? "Máy chỉ được tự gán khoản chi và chuyển nội bộ; tiền vào luôn phải hỏi."
        : null;
  if (explicit && ruleBlocker) bad(ruleBlocker, "rule_not_allowed");

  const result = await ingest.assignLog(c.env.DB, c.req.param("id"), splits, c.get("memberId"), new Date());

  let rule: Record<string, unknown> | null = null;
  let ruleSkipped: string | null = wantRule ? ruleBlocker : null;
  if (wantRule && !ruleBlocker) {
    const auto = explicit ?? suggestRulePattern((result.log as { content?: string | null }).content);
    if (!auto) ruleSkipped = "Nội dung chuyển khoản không có đoạn chữ nào đủ đặc trưng để làm rule.";
    else {
      try {
        rule = await ingest.createRuleFromSplit(c.env.DB, splits[0]!, auto.matchType, auto.pattern, c.get("memberId"));
      } catch (err) {
        ruleSkipped = err instanceof Error ? err.message : "Không tạo được rule.";
      }
    }
  }
  return ok(c, { ...result, rule, ruleSkipped }, 201);
});

logs.post("/logs/:id/ignore", async (c) => ok(c, await ingest.ignoreLog(c.env.DB, c.req.param("id"))));

logs.post("/logs/pair", async (c) => {
  const b = await body(c);
  const logA = b.log_a;
  const logB = b.log_b;
  if (typeof logA !== "string" || !logA || typeof logB !== "string" || !logB) bad("Cần log_a và log_b.");
  return ok(c, await ingest.pairLogs(c.env.DB, logA as string, logB as string), 201);
});

// Gỡ cặp/gỡ gán sai: huỷ giao dịch sinh từ log ngân hàng, trả (các) log về 'pending'.
logs.post("/logs/transactions/:txId/void", async (c) => {
  const txId = Number(c.req.param("txId"));
  if (!Number.isInteger(txId) || txId <= 0) bad("txId không hợp lệ.");
  const result = await ingest.unassignTransaction(c.env.DB, txId);
  await recordChange(c, "tx.unassign", `tx:${txId}`, { voided: result.voided, logs: result.logs });
  return ok(c, result);
});

// ── Rules ───────────────────────────────────────────────────────────
logs.get("/rules", async (c) => ok(c, await ingest.listRules(c.env.DB)));
/** Chỉ nhận đúng các trường của rule, đúng kiểu — không đẩy nguyên body xuống tầng dịch vụ. */
logs.post("/rules", async (c) => {
  const b = await body(c);
  const text = (v: unknown, name: string, required = false): string | null => {
    if (v === undefined || v === null || v === "") return required ? bad(`Thiếu ${name}.`) : null;
    return typeof v === "string" ? v : bad(`${name} phải là chuỗi.`);
  };
  if (b.priority !== undefined && !Number.isInteger(b.priority)) bad("priority phải là số nguyên.");
  const input: ingest.RuleInput = {
    priority: b.priority as number | undefined,
    match_type: text(b.match_type, "match_type", true)!,
    pattern: text(b.pattern, "pattern", true)!,
    meaning: text(b.meaning, "meaning", true)!,
    is_salary: b.is_salary === true,
    wallet_id: text(b.wallet_id, "wallet_id"),
    category_id: text(b.category_id, "category_id"),
    by_member_id: text(b.by_member_id, "by_member_id") ?? c.get("memberId"),
    tenant_id: text(b.tenant_id, "tenant_id"),
    income_stream_id: text(b.income_stream_id, "income_stream_id"),
  };
  return ok(c, await ingest.createRule(c.env.DB, input), 201);
});
