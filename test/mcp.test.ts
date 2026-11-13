import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { notifySalary } from "../src/notify/salary";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { householdE } from "./helpers/household-e";
import { B_NOW, householdB } from "./helpers/household-b";
import { AT, client, householdC } from "./helpers/household-c";
import { D_NOW, householdD } from "./helpers/household-d";
import { householdP, P_NOW } from "./helpers/household-p";
import { householdShared, SHARED_NOW, vnAt } from "./helpers/household-shared";
import { householdParent, householdTopUp, PARENT_NOW } from "./helpers/household-parent";
import { connectClaude, MemoryKV, mcpPost, stubClientMetadata, toolCall as call, type JsonRpc } from "./helpers/oauth";

vi.mock("../src/notify/salary", () => ({ notifySalary: vi.fn(async () => {}) }));

let env: Env;
let raw: ReturnType<typeof openDb>;
/** Token OAuth của chủ hộ, đủ quyền Xem + Ghi (nối như ngoài đời: đăng nhập → đồng ý → PKCE). */
let token: string;

beforeEach(async () => {
  vi.mocked(notifySalary).mockClear();
  raw = openDb();
  // Bối cảnh: nhà chưa nối bank feed — mọi tài khoản đều ghi tay (tài khoản đã nối feed thì không nhận nhập tay).
  raw.prepare("UPDATE accounts SET sepay_enabled = 0").run();
  env = { DB: asD1(raw), OAUTH_KV: new MemoryKV() as unknown as KVNamespace, API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
  stubClientMetadata();
  token = (await connectClaude(env, { memberId: "husband", password: "mat-khau-chung" })).access;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type JsonRpcResult = { jsonrpc: string; id: number; result?: any; error?: { code: number; message: string } };

async function mcp(body: JsonRpc) {
  const res = await mcpPost(env, token, body);
  const text = await res.text();
  return { status: res.status, res, json: text ? (JSON.parse(text) as JsonRpcResult) : null };
}

/** Nội dung text đầu tiên của kết quả tool — nếu tool trả kèm dòng tóm tắt thì lấy khối JSON (khối cuối). */
function toolData(json: JsonRpcResult) {
  const blocks = json.result.content as { type: string; text: string }[];
  return JSON.parse(blocks[blocks.length - 1]!.text);
}

describe("transport MCP", () => {
  it("request lỗi (Content-Type sai) → transport trả lỗi JSON-RPC 415, không văng lên app.onError", async () => {
    const res = await mcpPost(env, token, {}, { "Content-Type": "text/plain" });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error?: unknown };
    expect(body.error).toBeTruthy();
  });
});

describe("giao thức MCP", () => {
  it("bắt tay initialize", async () => {
    const { status, json } = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1.0.0" } },
    });
    expect(status).toBe(200);
    expect(json?.result.serverInfo).toMatchObject({ name: "vi-nha" });
    expect(json?.result.protocolVersion).toBeTruthy();
  });

  it("UC-601 AC-6: tools/list trả đúng 16 tên, không còn get_budget / allocate_income / preview_allocation / list_transfer_orders / add_tenant_shared_expense (không cần gọi initialize trước — server không giữ phiên)", async () => {
    const { status, json } = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(status).toBe(200);
    const names = (json?.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_transaction",
        "assign_log",
        "get_balance_sheet",
        "get_debts",
        "get_goals",
        "get_receivables",
        "get_reconciliation",
        "get_reports",
        "get_snapshot",
        "get_spending_by_category",
        "get_tenant_bill",
        "list_categories",
        "list_pending_logs",
        "list_tenants",
        "record_asset_value",
        "set_tenant_bill_item",
      ].sort(),
    );
  });

  it("UC-602 AC-5: mô tả 16 tool không còn 'chưa triển khai' / 'phase 04', không nhắc tên tool cũ, tên cũ của Tích sản hay chữ khẩn cấp", async () => {
    const { json } = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = json?.result.tools as { name: string; description: string }[];
    expect(tools).toHaveLength(16);
    for (const t of tools) {
      expect(t.description, t.name).not.toMatch(/chưa triển khai|chưa làm|phase 04/i);
      expect(t.description, t.name).not.toMatch(/\b(reconcile|spend_by_category|allocate|get_tenants|add_tenant_paid_for_us|add_tenant_shared_expense)\b/);
      expect(t.description, t.name).not.toMatch(/headcount|shared-expense|fixed monthly fees/i);
      expect(t.description, t.name).not.toMatch(/budget between two wallets|wealth-building money|locked shares|transfer orders?/i);
      expect(t.description, t.name).not.toMatch(/tichsan|phao khẩn cấp/i);
      // change 261113-giao-dien-m1-va-ten-moi: tên màn mới (Báo cáo, Tài khoản, Chi tiêu).
      expect(t.description, t.name).not.toMatch(/Tài sản & tự do|Ví & quỹ|Nhìn lại/);
    }
  });

  it("UC-602: mô tả get_spending_by_category / get_goals / get_reports theo tháng (ADR-144); get_goals không nhắc ví, quỹ an tâm, Tích sản, kỳ lương", async () => {
    const tools = (await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json!.result.tools as { name: string; description: string }[];
    const description = (name: string) => tools.find((t) => t.name === name)!.description;
    expect(description("get_spending_by_category")).toContain(
      "Look back over a calendar month (VN, 1st to month end): spending by category group vs the monthly soft limit (never negative, no top-up), vs the previous month, loan interest expected vs paid",
    );
    expect(description("get_spending_by_category")).toContain("sending cycle is an error (model_changed)");
    expect(description("get_goals")).toContain(
      "Savings pocket total and change per calendar month, savings % and saved this month (savingsDone), reserve goals vs target (several goals can share one account; held = what the goal has after splitting the account balance by priority, counting spent this month; null = no account yet)",
    );
    for (const t of tools) expect(t.description, t.name).not.toMatch(/payCycle|opens_cycle overrides|(this|current|previous) pay cycle/);
    expect(description("get_goals")).not.toMatch(/wallet|safety fund|wealth building/i);
    expect(description("get_reports")).toContain(
      "expenses by essential / flexible category groups (loan interest under essential), tax paid from the tax goal, spent from the savings pocket, other",
    );
    expect(description("get_reports")).not.toMatch(/wallet tier|wealth building/i);
  });
});

describe("tool đọc số liệu", () => {
  it("get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB", async () => {
    // Ghi lương + chi một khoản để snapshot có số khác 0.
    await app.request(
      "/v1/transactions",
      { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ meaning: "income", amount: 40_000_000, account_id: "vcb-husband" }) },
      env,
    );
    await app.request(
      "/v1/transactions",
      { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ meaning: "spend", amount: 125_000, category_id: "groceries" }) },
      env,
    );

    // REST: Bearer token không kèm X-Member-Id → viewer mặc định là chủ hộ (xem routes/auth.ts).
    const rest = await app.request("/v1/snapshot", { headers: { Authorization: "Bearer tok" } }, env);
    const restSnap = (await rest.json() as any).data;

    const { status, json } = await mcp(call("get_snapshot"));
    expect(status).toBe(200);
    const mcpSnap = toolData(json!);

    // "at" là dấu thời gian tại thời điểm gọi — hai lời gọi cách nhau vài ms nên bỏ qua khi so.
    delete restSnap.at;
    delete mcpSnap.at;
    expect(mcpSnap).toEqual(restSnap);
  });

  it("UC-602 AC-11: get_snapshot trả pockets bằng đúng GET /v1/snapshot; mô tả tool nói về ngăn", async () => {
    const rest = await app.request("/v1/snapshot", { headers: { Authorization: "Bearer tok" } }, env);
    const restPockets = ((await rest.json()) as { data: { pockets: unknown } }).data.pockets;
    const mcpSnap = toolData((await mcp(call("get_snapshot"))).json!);
    expect(restPockets).toMatchObject({ savings: expect.any(Object), reserve: expect.any(Object), shortDebt: expect.any(Object) });
    expect(mcpSnap.pockets).toEqual(restPockets);
    const list = (await mcp({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} })).json!.result.tools as { name: string; description: string }[];
    expect(list.find((t) => t.name === "get_snapshot")!.description).toContain("pockets: real money per pocket");
  });

  it("UC-602: get_snapshot tóm tắt bằng tiền vận hành (ADR-118) và trả nearSpend", async () => {
    const { json } = await mcp(call("get_snapshot"));
    const blocks = json!.result.content as { type: string; text: string }[];
    expect(blocks[0]!.text).toMatch(/^(Vận hành .+ · chi khoảng .+\/ngày tới ngày lương \d+\/\d+ \(còn \d+ ngày\)|Tiền vận hành đã hết \(.+\)[,—] còn \d+ ngày|Vận hành còn .+ tới ngày lương \d+\/\d+ \(còn \d+ ngày\))$/);
    expect(blocks[0]!.text).not.toContain("tuần này");
    expect(toolData(json!).nearSpend).toMatchObject({ paydayDay: 10 });
    expect(toolData(json!).nearSpend).not.toHaveProperty("misplaced");
  });

  it("UC-602 AC-12: hộ mẫu B → tóm tắt có cả tổng và mỗi ngày; savings.change, reserve.peaceMonths, shortDebt bằng đúng GET /v1/snapshot; mô tả tool theo ba thẻ", async () => {
    raw = householdB();
    env.DB = asD1(raw);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(B_NOW);
    try {
      const { json } = await mcp(call("get_snapshot"));
      const blocks = json!.result.content as { type: string; text: string }[];
      expect(blocks[0]!.text).toBe("Vận hành 4.100.000 ₫ · chi khoảng 141.000 ₫/ngày tới ngày lương 10/12 (còn 29 ngày)");
      const rest = ((await (await app.request("/v1/snapshot", { headers: { Authorization: "Bearer tok" } }, env)).json()) as { data: Record<string, any> }).data;
      const snap = toolData(json!);
      expect(snap.pockets.savings.change).toEqual(rest.pockets.savings.change);
      expect(snap.pockets.savings.change).toEqual({ since: "2026-11-01", amount: 800_000, prevSince: "2026-10-01", prevAmount: 700_000 });
      expect(snap.pockets.reserve.peaceMonths).toEqual(rest.pockets.reserve.peaceMonths);
      expect(snap.pockets.shortDebt).toEqual(rest.pockets.shortDebt);
      expect(snap.nearSpend).not.toHaveProperty("misplaced");
    } finally {
      vi.useRealTimers();
    }
    const list = (await mcp({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} })).json!.result.tools as { name: string; description: string }[];
    const description = list.find((t) => t.name === "get_snapshot")!.description;
    expect(description).toContain("pockets");
    expect(description).not.toContain("safety fund (safetyFund: months covered vs target)");
  });

  it("UC-602 AC-17: hộ mẫu E sau 0040 → mô tả get_snapshot không nhắc tiers / wallet / safety fund / wealth building / earmark / hold, có conversion; kết quả bằng GET /v1/snapshot", async () => {
    raw = householdE();
    env.DB = asD1(raw);
    token = (await connectClaude(env, { memberId: "anh", password: "mat-khau-chung" })).access;
    const list = (await mcp({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} })).json!.result.tools as { name: string; description: string }[];
    const description = list.find((t) => t.name === "get_snapshot")!.description;
    expect(description).not.toMatch(/tiers|wallet|safety fund|wealth building|earmark|hold/i);
    expect(description).toContain("conversion");
    const rest = ((await (await app.request("/v1/snapshot", { headers: { Authorization: "Bearer tok" } }, env)).json()) as { data: Record<string, unknown> }).data;
    const snap = toolData((await mcp(call("get_snapshot"))).json!);
    delete rest.at;
    delete snap.at;
    expect(snap).toEqual(rest);
    expect(snap.conversion).toEqual({ done: 0, total: 5, next: "pockets" });
  });

  it("UC-602 AC-2: list_categories trả danh mục để map lời nói, không còn ví mặc định", async () => {
    const { json } = await mcp(call("list_categories"));
    const cats = toolData(json!) as Record<string, unknown>[];
    expect(cats.find((c) => c.id === "fuel-parking")).toMatchObject({ id: "fuel-parking", name: expect.any(String) });
    for (const c of cats) expect(c).not.toHaveProperty("defaultWalletId");
    const list = (await mcp({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} })).json!.result.tools as { name: string; description: string }[];
    expect(list.find((t) => t.name === "list_categories")!.description).not.toMatch(/wallet/i);
  });

  it("list_pending_logs trả các log chưa gán", async () => {
    raw
      .prepare(
        `INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status)
         VALUES ('L1', '2026-09-21T09:00:00.000Z', 10000, 'in', 'vcb-husband', 'NGUOI LA CHUYEN', 'pending')`,
      )
      .run();
    const { status, json } = await mcp(call("list_pending_logs"));
    expect(status).toBe(200);
    expect(json?.result.isError).toBeFalsy();
    expect(json?.result.content[0].text).toContain("L1");
  });

  it("assign_log sai (tổng tách không khớp số tiền log) trả lỗi tool, không phải HTTP 500", async () => {
    raw
      .prepare(
        `INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status)
         VALUES ('L2', '2026-09-21T09:00:00.000Z', 50000, 'out', 'vcb-husband', 'CHI', 'pending')`,
      )
      .run();
    const { status, json } = await mcp(call("assign_log", { log_id: "L2", splits: [{ meaning: "spend", amount: 10_000, category_id: "groceries" }] }));
    expect(status).toBe(200);
    expect(json?.result.isError).toBe(true);
  });

  it("UC-602 AC-3: get_goals, get_spending_by_category, get_reconciliation trùng REST tương ứng", async () => {
    const rest = async (path: string) => ((await (await app.request(path, { headers: { Authorization: "Bearer tok" } }, env)).json()) as { data: unknown }).data;
    expect(toolData((await mcp(call("get_goals"))).json!)).toEqual(await rest("/v1/goals"));
    expect(toolData((await mcp(call("get_spending_by_category"))).json!)).toEqual(await rest("/v1/spend-by-category"));
    expect(toolData((await mcp(call("get_reconciliation"))).json!)).toEqual(await rest("/v1/accounts"));
  });

  it("UC-602 AC-4: get_spending_by_category { cycle: \"2026-11-10\" } → tool error model_changed (JSON-RPC 200), không HTTP 500; REST ?cycle= → 400 model_changed", async () => {
    const { status, json } = await mcp(call("get_spending_by_category", { cycle: "2026-11-10" }));
    expect(status).toBe(200);
    expect(json?.result.isError).toBe(true);
    expect(json?.result.content[0].text).toMatch(/^model_changed: /);
    const rest = await app.request("/v1/spend-by-category?cycle=2026-11-10", { headers: { Authorization: "Bearer tok" } }, env);
    expect(rest.status).toBe(400);
    expect(((await rest.json()) as { error: { code: string; fields: string[] } }).error).toMatchObject({ code: "model_changed", fields: ["cycle"] });
  });
});

describe("add_transaction", () => {
  it("thiếu by_member_id → người ghi là người đã uỷ quyền kết nối (UC-603)", async () => {
    const { json } = await mcp(call("add_transaction", { meaning: "spend", amount: 200_000, category_id: "fuel-parking" }));
    expect(json?.result.isError).toBeFalsy();
    expect(toolData(json!).tx).toMatchObject({ by_member_id: "husband", account_id: "cash-husband" });
  });

  it("by_member_id không có thật → tool error", async () => {
    const { json } = await mcp(call("add_transaction", { meaning: "spend", amount: 200_000, category_id: "fuel-parking", by_member_id: "ai-do" }));
    expect(json?.result.isError).toBe(true);
    expect(json?.result.content[0].text).toMatch(/không có thành viên/i);
  });

  it(`UC-603 AC-3: "chi 200k xăng tiền mặt" → ghi đúng danh mục và tài khoản tiền mặt của người ghi, không ví`, async () => {
    const { status, json } = await mcp(call("add_transaction", { meaning: "spend", amount: 200_000, category_id: "fuel-parking", by_member_id: "wife" }));
    expect(status).toBe(200);
    expect(json?.result.isError).toBeFalsy();
    const data = toolData(json!);
    expect(data.tx).toMatchObject({ legacy_class: null, account_id: "cash-wife", category_id: "fuel-parking", by_member_id: "wife", source: "manual" });
    expect(data.tx).not.toHaveProperty("wallet_id");
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE category_id = 'fuel-parking'").get()).toEqual({ n: 1 });
  });

  it("UC-101 AC-26: khoản trước mốc mà SePay đã báo và đã gán → tool lỗi bank_log_exists; gửi kèm confirm_duplicate thì ghi", async () => {
    raw.prepare("UPDATE accounts SET sepay_enabled = 1, opened_at = '2026-10-01', feed_from = '2026-10-15T15:24:00.000Z' WHERE id = 'vcb-husband'").run();
    raw.prepare(
      `INSERT INTO bank_logs (id, at, amount, direction, account_id, source, status) VALUES ('tre', '2026-10-15T15:20:00.000Z', 500000, 'in', 'vcb-husband', 'webhook', 'assigned')`,
    ).run();
    const args = { meaning: "income", amount: 500_000, account_id: "vcb-husband", at: "2026-10-15T15:20:00.000Z", by_member_id: "husband" };
    const first = await mcp(call("add_transaction", args));
    expect(first.json?.result.isError).toBe(true);
    expect(first.json?.result.content[0].text).toContain("SePay đã báo khoản này");
    const again = await mcp(call("add_transaction", { ...args, confirm_duplicate: true }));
    expect(again.json?.result.isError).toBeFalsy();
    expect(toolData(again.json!).tx).toMatchObject({ amount: 500_000, counter_account_id: "vcb-husband", source: "manual" });
  });

  it("income kèm tenant_id → gắn người thuê, tự lấy nguồn thu cho thuê", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
    const { json } = await mcp(call("add_transaction", { meaning: "income", amount: 5_191_667, account_id: "vcb-husband", tenant_id: "tenant-binh", by_member_id: "husband" }));
    expect(json?.result.isError).toBeFalsy();
    expect(toolData(json!).tx).toMatchObject({ tenant_id: "tenant-binh", income_stream_id: "rental" });
  });
});

describe("bản tính người thuê qua MCP (rental UC-806, UC-807)", () => {
  const bill = (month: string) => `(SELECT id FROM tenant_bills WHERE tenant_id = 'an' AND month_key = '${month}')`;
  /** An: mở sổ 50.000; bản tính tháng 9 đã gửi 2/10 (4 khoản, 4.180.000) và đã trả đủ 5/10 — như rental UC-806 AC-1. */
  const seedSeptember = () =>
    raw.exec(`
      INSERT INTO tenants (id, name) VALUES ('an', 'An');
      INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount) VALUES ('an', '2026-09', '2026-09-01T03:00:00.000Z', 'opening', 'Số dư mở sổ', 50000);
      INSERT INTO tenant_bills (tenant_id, month_key, status, total, revision, issued_at, receive_account_id)
        VALUES ('an', '2026-09', 'issued', 4180000, 1, '2026-10-02T03:00:00.000Z', 'vcb-husband');
      INSERT INTO tenant_bill_items (bill_id, sort, name, category, amount) VALUES
        (${bill("2026-09")}, 1, 'Tiền nhà', 'fixed', 2500000), (${bill("2026-09")}, 2, 'Gửi xe', 'fixed', 100000),
        (${bill("2026-09")}, 3, 'Tiền ăn', 'variable', 1200000), (${bill("2026-09")}, 4, 'Tiền điện', 'variable', 380000);
      INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount, bill_id)
        VALUES ('an', '2026-09', '2026-10-02T03:00:00.000Z', 'bill', 'Bản tính tháng 9/2026', 4180000, ${bill("2026-09")});
      INSERT INTO transactions (id, at, amount, meaning, counter_account_id, income_stream_id, tenant_id, by_member_id, week_key, month_key, source)
        VALUES (500, '2026-10-05T03:00:00.000Z', 4180000, 'income', 'vcb-husband', 'rental', 'an', 'husband', '2026-W41', '2026-10', 'manual');
    `);
  /** Bản tính tháng 10 đã gửi 2/11, tổng 4.220.000 (rental UC-806 AC-4, UC-807 AC-1). */
  const seedOctober = () =>
    raw.exec(`
      INSERT INTO tenant_bills (tenant_id, month_key, status, copied_from_id, total, revision, issued_at, receive_account_id)
        VALUES ('an', '2026-10', 'issued', ${bill("2026-09")}, 4220000, 4, '2026-11-02T03:00:00.000Z', 'vcb-husband');
      INSERT INTO tenant_bill_items (bill_id, sort, name, category, amount) VALUES
        (${bill("2026-10")}, 1, 'Tiền nhà', 'fixed', 2500000), (${bill("2026-10")}, 2, 'Gửi xe', 'fixed', 100000),
        (${bill("2026-10")}, 3, 'Tiền ăn', 'variable', 1350000), (${bill("2026-10")}, 4, 'Tiền điện', 'variable', 420000),
        (${bill("2026-10")}, 5, 'Trừ: An đi chợ', 'variable', -150000);
      INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount, bill_id)
        VALUES ('an', '2026-10', '2026-11-02T03:00:00.000Z', 'bill', 'Bản tính tháng 10/2026', 4220000, ${bill("2026-10")});
    `);
  const balance = () => raw.prepare("SELECT balance FROM v_tenant_balance WHERE tenant_id = 'an'").get();
  const errorText = (json: JsonRpcResult) => (json.result.content as { text: string }[]).map((b) => b.text).join("\n");

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T09:00:00+07:00"));
    token = (await connectClaude(env, { memberId: "husband", password: "mat-khau-chung" })).access;
    seedSeptember();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("UC-806 AC-15: set_tenant_bill_item 'tiền điện' tháng 10 → lập nháp chép tháng 9, đổi Tiền điện thành 420.000, revision tăng; 'Tiền nước' → thêm khoản Chi phí; tháng 9 đã gửi → lỗi bill_issued, không ghi gì; mỗi lần ghi nhật ký tenant.bill_item via mcp; số dư An không đổi", async () => {
    const before = balance();
    const args = { tenant_id: "an", month: "2026-10", name: "tiền điện", amount: 420_000 };

    const first = await mcp(call("set_tenant_bill_item", args));
    expect(first.json?.result.isError).toBeFalsy();
    const one = toolData(first.json!);
    expect(one).toMatchObject({ month: "2026-10", status: "draft", bill: { status: "draft", copiedFromMonth: "2026-09", receiveAccountId: "vcb-husband" } });
    expect(one.bill.items.map(({ name, category, amount }: { name: string; category: string; amount: number }) => [name, category, amount])).toEqual([
      ["Tiền nhà", "fixed", 2_500_000],
      ["Gửi xe", "fixed", 100_000],
      ["Tiền ăn", "variable", 1_200_000],
      ["Tiền điện", "variable", 420_000],
    ]);
    expect(one.bill.revision).toBeGreaterThan(0);
    expect(one.total).toBe(4_220_000);

    const second = toolData((await mcp(call("set_tenant_bill_item", { ...args, name: "Tiền nước", amount: 90_000 }))).json!);
    expect(second.bill.items.at(-1)).toEqual({ name: "Tiền nước", category: "variable", amount: 90_000, previous: null });
    expect(second.bill.items).toHaveLength(5);
    expect(second.bill.revision).toBe(one.bill.revision + 1);
    expect(second.total).toBe(4_310_000);

    const septemberItems = () => raw.prepare(`SELECT name, amount FROM tenant_bill_items WHERE bill_id = ${bill("2026-09")} ORDER BY sort`).all();
    const septBefore = septemberItems();
    const auditBefore = raw.prepare("SELECT COUNT(*) AS n FROM audit_log").get();
    const third = await mcp(call("set_tenant_bill_item", { ...args, month: "2026-09" }));
    expect(third.json?.result.isError).toBe(true);
    expect(errorText(third.json!)).toBe("Bản tính đã gửi: sửa trên app.");
    expect(septemberItems()).toEqual(septBefore);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM audit_log").get()).toEqual(auditBefore);

    expect(raw.prepare("SELECT member_id, via, target FROM audit_log WHERE action = 'tenant.bill_item' ORDER BY id").all()).toEqual([
      { member_id: "husband", via: "mcp", target: "tenant:an" },
      { member_id: "husband", via: "mcp", target: "tenant:an" },
    ]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM tenant_bills WHERE tenant_id = 'an' AND month_key = '2026-10'").get()).toEqual({ n: 1 });
    expect(balance()).toEqual(before);
  });

  it("UC-807 AC-7: get_tenant_bill tháng 10 trả cùng khoản, status, total, text, qrAmount 4.220.000, previousBalance 50.000 như GET /v1/rental/tenants/an/bills/2026-10; nhìn như người uỷ quyền (khoản trả vào tài khoản riêng tư của vợ không có); không ghi gì", async () => {
    seedOctober();
    raw.exec(`
      UPDATE accounts SET private = 1 WHERE id = 'vcb-wife';
      INSERT INTO transactions (id, at, amount, meaning, counter_account_id, income_stream_id, tenant_id, by_member_id, week_key, month_key, source) VALUES
        (501, '2026-11-03T03:00:00.000Z', 4000000, 'income', 'vcb-husband', 'rental', 'an', 'husband', '2026-W45', '2026-11', 'manual'),
        (502, '2026-11-03T04:00:00.000Z', 100000, 'income', 'vcb-wife', 'rental', 'an', 'wife', '2026-W45', '2026-11', 'manual');
    `);
    const writes = () => raw.prepare("SELECT (SELECT COUNT(*) FROM audit_log) AS audit, (SELECT COUNT(*) FROM tenant_bills) AS bills, (SELECT COUNT(*) FROM tenant_lines) AS lines").get();
    const before = writes();
    const res = await mcp(call("get_tenant_bill", { tenant_id: "an", month: "2026-10" }));
    expect(res.json?.result.isError).toBeFalsy();
    const tool = toolData(res.json!);
    const rest = await client(raw)("GET", "/v1/rental/tenants/an/bills/2026-10");
    expect(rest.status).toBe(200);
    expect(tool).toEqual(rest.json.data);
    expect(tool).toMatchObject({ month: "2026-10", status: "issued", total: 4_220_000, qrAmount: 4_220_000, previousBalance: 50_000 });
    expect(tool.text).toContain("Tổng tháng 10: 4.220.000 ₫ (tháng 9: 4.180.000 ₫, nhiều hơn 40.000 ₫)");
    expect(tool.text).toContain("Các tháng trước còn nợ 50.000 ₫ (chưa tính ở trên)");
    expect(tool.payments.map((p: { transactionId: number }) => p.transactionId)).toEqual([501]);
    expect(tool.balance).toBe(50_000 + 4_220_000 - 4_000_000 - 100_000);
    expect(writes()).toEqual(before);
  });

  it("list_tenants trả đúng GET /v1/rental: nguồn thu, người thuê kèm số dư và bản tính tháng trước; không còn headcount / phí cố định", async () => {
    seedOctober();
    const data = toolData((await mcp(call("list_tenants"))).json!);
    expect(data).toEqual((await client(raw)("GET", "/v1/rental")).json.data);
    expect(data.incomeStreamId).toBe("rental");
    expect(data.tenants).toMatchObject([{ id: "an", name: "An", active: true, balance: 4_270_000, bill: { month: "2026-10", status: "issued", total: 4_220_000, edited: false } }]);
    expect(data).not.toHaveProperty("headcount");
    expect(data.tenants[0]).not.toHaveProperty("fees");
  });

  it("UC-602 AC-16: add_tenant_shared_expense đã gỡ → lỗi không có tool, không ghi gì", async () => {
    const res = await mcp(call("add_tenant_shared_expense", { tenant_id: "an", amount: 300_000, category_id: "groceries" }));
    expect(res.json?.error ?? res.json?.result.isError).toBeTruthy();
    expect(res.json?.error?.message ?? res.json?.result.content[0].text).toMatch(/not found/i);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM tenant_lines").get()).toEqual({ n: 2 });
  });
});

describe("sổ nợ", () => {
  it("get_debts trả các khoản nợ và tổng còn nợ", async () => {
    raw.prepare("INSERT INTO debts (id, name) VALUES ('co-lan', 'Cô Lan')").run();
    raw.prepare("INSERT INTO debt_lines (debt_id, at, kind, amount) VALUES ('co-lan', '2026-10-01T03:00:00.000Z', 'opening', 15379000)").run();
    const { json } = await mcp(call("get_debts"));
    expect(json?.result.isError).toBeFalsy();
    const data = toolData(json!);
    expect(data.totalBalance).toBe(15_379_000);
    expect(data.debts).toMatchObject([{ id: "co-lan", name: "Cô Lan", owed: 15_379_000, paid: 0, balance: 15_379_000, done: false, payments: [] }]);
  });

  it("UC-603 AC-8: add_transaction nhận debt_id, không loại chi cũ; gửi earmark_id → lỗi model_changed, không ghi gì", async () => {
    raw.prepare("INSERT INTO debts (id, name) VALUES ('co-lan', 'Cô Lan')").run();
    raw.prepare("INSERT INTO debt_lines (debt_id, at, kind, amount) VALUES ('co-lan', '2026-10-01T03:00:00.000Z', 'opening', 1000000)").run();
    const old = await mcp(call("add_transaction", { meaning: "spend", amount: 400_000, debt_id: "co-lan", by_member_id: "husband", earmark_id: "tuition" }));
    expect(old.json?.result.isError).toBe(true);
    expect(old.json?.result.content[0].text).toMatch(/^model_changed: .*earmark_id/);
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
    const { json } = await mcp(call("add_transaction", { meaning: "spend", amount: 400_000, debt_id: "co-lan", by_member_id: "husband" }));
    expect(json?.result.isError).toBeFalsy();
    expect(toolData(json!).tx).toMatchObject({ debt_id: "co-lan", category_id: "debt-payment", legacy_class: null });
    expect(toolData((await mcp(call("get_debts"))).json!).totalBalance).toBe(600_000);
  });
});

describe("sổ phải thu", () => {
  const seed = () => {
    raw.prepare("INSERT INTO receivables (id, name) VALUES ('em-hai', 'Em Hai')").run();
    raw.prepare("INSERT INTO receivable_lines (receivable_id, at, kind, amount) VALUES ('em-hai', '2026-10-01T03:00:00.000Z', 'opening', 2000000)").run();
  };

  it("get_receivables trả các khoản phải thu và tổng còn phải thu", async () => {
    seed();
    const { json } = await mcp(call("get_receivables"));
    expect(json?.result.isError).toBeFalsy();
    const data = toolData(json!);
    expect(data.totalBalance).toBe(2_000_000);
    expect(data.receivables).toMatchObject([{ id: "em-hai", name: "Em Hai", lent: 2_000_000, collected: 0, balance: 2_000_000, done: false, movements: [] }]);
  });

  it("add_transaction nhận collect + receivable_id; assign_log nhận split collect", async () => {
    seed();
    const { json } = await mcp(call("add_transaction", { meaning: "collect", amount: 500_000, receivable_id: "em-hai", by_member_id: "husband" }));
    expect(json?.result.isError).toBeFalsy();
    expect(toolData(json!).tx).toMatchObject({ meaning: "collect", receivable_id: "em-hai", counter_account_id: "cash-husband", legacy_class: null });
    raw
      .prepare(
        `INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status)
         VALUES ('R1', '2026-10-01T09:00:00.000Z', 300000, 'in', 'vcb-husband', 'EM HAI TRA', 'pending')`,
      )
      .run();
    const assigned = await mcp(call("assign_log", { log_id: "R1", splits: [{ meaning: "collect", amount: 300_000, receivable_id: "em-hai" }] }));
    expect(assigned.json?.result.isError).toBeFalsy();
    expect(toolData((await mcp(call("get_receivables"))).json!).totalBalance).toBe(1_200_000);
  });

  it("assign_log nhận link_id trên split như REST: nhận lại nối về khoản cho vay, lấy người của nó; khoản gốc sai → lỗi tool, log vẫn chờ (change 261005-lien-ket-khoan-goc)", async () => {
    seed();
    const lent = await mcp(call("add_transaction", { meaning: "lend", amount: 1_000_000, receivable_id: "em-hai", by_member_id: "husband" }));
    const lendId = toolData(lent.json!).tx.id as number;
    raw
      .prepare(
        `INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES
         ('R2', '2026-10-01T09:00:00.000Z', 400000, 'in', 'vcb-husband', 'EM HAI TRA', 'pending'),
         ('R3', '2026-10-01T10:00:00.000Z', 100000, 'in', 'vcb-husband', 'EM HAI TRA', 'pending')`,
      )
      .run();
    const assigned = await mcp(call("assign_log", { log_id: "R2", splits: [{ meaning: "collect", amount: 400_000, link_id: lendId }] }));
    expect(assigned.json?.result.isError).toBeFalsy();
    expect(toolData(assigned.json!).transactions).toMatchObject([{ meaning: "collect", link_id: lendId, receivable_id: "em-hai" }]);
    const wrong = await mcp(call("assign_log", { log_id: "R3", splits: [{ meaning: "collect", amount: 100_000, link_id: 9_999 }] }));
    expect(wrong.json?.result.isError).toBe(true);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'R3'").get()).toEqual({ status: "pending" });
  });
});

describe("chi phí CPU ước lượng", () => {
  it("một lần tools/call (dựng McpServer + zod mới mỗi request) chạy trong thời gian hợp lý", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      // eslint-disable-next-line no-await-in-loop
      await mcp(call("get_snapshot", {}, i));
      durations.push(performance.now() - start);
    }
    const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
    // Đây là thời gian tường (wall time) trên máy dev chạy Node, KHÔNG phải CPU time thật của
    // Cloudflare Workers isolate — chỉ để có con số tương đối, xem báo cáo để biết cách đọc.
    console.log(`[mcp cpu] get_snapshot: trung bình ${avg.toFixed(2)}ms qua ${durations.length} lần (wall time, Node, không phải Workers CPU time)`);
    expect(avg).toBeLessThan(1000);
  });
});

describe("assign_log nhận dòng lãi tiền gửi (261018-lai-tien-gui)", () => {
  it("UC-604 AC-8: assign_log split { meaning: income, amount: 50, interest: true } → khoản thu 50 không ví, không fund, Thu nhập thụ động; kèm wallet_id → model_changed", async () => {
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES ('I1', '2026-10-01T00:07:00.000Z', 50, 'in', 'vcb-wife', 'BankAPINotify', 'pending')").run();
    const old = await mcp(call("assign_log", { log_id: "I1", splits: [{ meaning: "income", amount: 50, interest: true, wallet_id: "fun-wife" }] }));
    expect(old.json?.result.isError).toBe(true);
    expect(old.json?.result.content[0].text).toMatch(/^model_changed: .*wallet_id/);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'I1'").get()).toEqual({ status: "pending" });
    const res = await mcp(call("assign_log", { log_id: "I1", splits: [{ meaning: "income", amount: 50, interest: true }] }));
    expect(res.json?.result.isError).toBeFalsy();
    const id = toolData(res.json!).transactions[0].id as number;
    expect(raw.prepare("SELECT amount, legacy_class, counter_account_id FROM transactions WHERE id = ?").get(id)).toEqual({ amount: 50, legacy_class: null, counter_account_id: "vcb-wife" });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning = 'fund'").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT report_class FROM transaction_report_classes WHERE transaction_id = ?").get(id)).toEqual({ report_class: "passive_income" });
  });
});

describe("Đợt C: bỏ ví khỏi đường ghi; bỏ kỳ lương (261112-ba-ngan-duong-ghi, 261112-thang-thay-ky-luong)", () => {
  const errorText = (json: JsonRpcResult) => (json.result.content as { text: string }[]).map((b) => b.text).join("\n");

  it("UC-603 AC-31: add_transaction kèm wallet_id / wealth_move → lỗi model_changed kèm tên trường, không ghi gì; bỏ trường → ghi được", async () => {
    const spend = await mcp(call("add_transaction", { meaning: "spend", amount: 200_000, category_id: "groceries", wallet_id: "food" }));
    expect(spend.json?.result.isError).toBe(true);
    expect(errorText(spend.json!)).toMatch(/model_changed.*wallet_id/);
    const move = await mcp(call("add_transaction", { meaning: "transfer", amount: 1_000_000, account_id: "vcb-husband", to_account_id: "tcb-husband", wealth_move: "fund" }));
    expect(move.json?.result.isError).toBe(true);
    expect(errorText(move.json!)).toMatch(/model_changed.*wealth_move/);
    const budget = await mcp(call("add_transaction", { meaning: "transfer", amount: 100_000, from_wallet_id: "fun-wife", wallet_id: "food" }));
    expect(errorText(budget.json!)).toMatch(/model_changed.*from_wallet_id/);
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });

    const ok1 = await mcp(call("add_transaction", { meaning: "spend", amount: 200_000, category_id: "groceries" }));
    expect(ok1.json?.result.isError).toBeFalsy();
    const ok2 = await mcp(call("add_transaction", { meaning: "transfer", amount: 1_000_000, account_id: "vcb-husband", to_account_id: "tcb-husband" }));
    expect(toolData(ok2.json!).tx).toMatchObject({ legacy_class: null, account_id: "vcb-husband", counter_account_id: "tcb-husband" });
  });

  it("UC-604 AC-13: assign_log kèm transfer_order_id hoặc split có wallet_id → lỗi model_changed, log vẫn chờ; allocate_income → không có tool", async () => {
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES ('M1', '2026-10-02T02:00:00.000Z', 2000000, 'out', 'vcb-husband', 'chuyen', 'pending')").run();
    const split = { meaning: "transfer", amount: 2_000_000, other_account_id: "tcb-husband" };
    const order = await mcp(call("assign_log", { log_id: "M1", transfer_order_id: 41, splits: [split] }));
    expect(order.json?.result.isError).toBe(true);
    expect(errorText(order.json!)).toMatch(/model_changed.*transfer_order_id/);
    const wallet = await mcp(call("assign_log", { log_id: "M1", splits: [{ ...split, wallet_id: "wealth-building", wealth_move: "relocate" }] }));
    expect(wallet.json?.result.isError).toBe(true);
    expect(errorText(wallet.json!)).toMatch(/model_changed.*wallet_id/);
    const earmark = await mcp(call("assign_log", { log_id: "M1", splits: [{ ...split, earmark_id: "tuition" }] }));
    expect(earmark.json?.result.isError).toBe(true);
    expect(errorText(earmark.json!)).toMatch(/model_changed.*earmark_id/);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'M1'").get()).toEqual({ status: "pending" });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });

    for (const name of ["allocate_income", "preview_allocation", "list_transfer_orders"]) {
      const { json } = await mcp(call(name, name === "list_transfer_orders" ? {} : { income_tx_id: 1, amount: 1, taxable: false }));
      const text = json?.error?.message ?? errorText(json!);
      expect(json?.error ?? json?.result.isError, name).toBeTruthy();
      expect(text, name).toMatch(/not found/i);
    }
  });

  it("UC-604 AC-4: assign_log tiền người thuê → giống REST: gắn người thuê, nguồn cho thuê, không ví, người gán là người uỷ quyền", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES ('T1', '2026-10-05T02:00:00.000Z', 5000000, 'in', 'vcb-husband', 'BINH TRA TIEN NHA', 'pending')").run();
    const res = await mcp(call("assign_log", { log_id: "T1", splits: [{ meaning: "income", amount: 5_000_000, tenant_id: "tenant-binh" }] }));
    expect(res.json?.result.isError).toBeFalsy();
    expect(toolData(res.json!).transactions).toMatchObject([
      { meaning: "income", tenant_id: "tenant-binh", income_stream_id: "rental", counter_account_id: "vcb-husband", legacy_class: null, by_member_id: "husband" },
    ]);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'T1'").get()).toEqual({ status: "assigned" });
    expect(raw.prepare("SELECT COUNT(*) n FROM month_tasks").get()).toEqual({ n: 0 });
    expect(toolData(res.json!).transactions[0]).toMatchObject({ is_salary: 0 });
  });

  it("UC-1205 AC-7 (MCP): add_transaction / assign_log gửi opens_cycle (kể cả false) → lỗi model_changed kèm tên trường, không ghi gì; is_salary ở khoản chi → invalid_input", async () => {
    for (const opens of [true, false]) {
      const add = await mcp(call("add_transaction", { meaning: "income", amount: 20_000_000, account_id: "vcb-husband", opens_cycle: opens }));
      expect(add.json?.result.isError).toBe(true);
      expect(errorText(add.json!)).toMatch(/model_changed.*opens_cycle/);
    }
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES ('O1', '2026-10-05T02:00:00.000Z', 20000000, 'in', 'vcb-husband', 'CK', 'pending')").run();
    const assign = await mcp(call("assign_log", { log_id: "O1", splits: [{ meaning: "income", amount: 20_000_000, opens_cycle: true }] }));
    expect(assign.json?.result.isError).toBe(true);
    expect(errorText(assign.json!)).toMatch(/model_changed.*opens_cycle/);
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
    const spend = await mcp(call("add_transaction", { meaning: "spend", amount: 100_000, category_id: "groceries", is_salary: true }));
    expect(spend.json?.result.isError).toBe(true);
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
  });

  it("UC-504 AC-7 (MCP): người uỷ quyền không thấy log chờ của tài khoản riêng tư người khác, gán → lỗi private_account; chủ tài khoản thấy", async () => {
    raw.prepare("UPDATE accounts SET private = 1 WHERE id = 'vcb-wife'").run();
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES ('P1', '2026-10-05T02:00:00.000Z', 300000, 'out', 'vcb-wife', 'MUA SAM', 'pending')").run();
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES ('C1', '2026-10-05T03:00:00.000Z', 100000, 'out', 'vcb-husband', 'CHI', 'pending')").run();
    const husband = toolData((await mcp(call("list_pending_logs"))).json!) as { id: string }[];
    expect(husband.map((l) => l.id)).toEqual(["C1"]);
    const assign = await mcp(call("assign_log", { log_id: "P1", splits: [{ meaning: "spend", amount: 300_000, category_id: "groceries" }] }));
    expect(assign.json?.result.isError).toBe(true);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'P1'").get()).toEqual({ status: "pending" });

    const wifeToken = (await connectClaude(env, { memberId: "wife", password: "mat-khau-chung" })).access;
    const wife = JSON.parse((await (await mcpPost(env, wifeToken, call("list_pending_logs"))).json() as JsonRpcResult).result.content.at(-1).text) as { id: string }[];
    expect(wife.map((l) => l.id).sort()).toEqual(["C1", "P1"]);
    raw.prepare("UPDATE members SET active = 0 WHERE id = 'wife'").run();
    expect((toolData((await mcp(call("list_pending_logs"))).json!) as { id: string }[]).map((l) => l.id).sort()).toEqual(["C1", "P1"]);
  });

  describe("hộ mẫu C", () => {
    beforeEach(() => {
      raw = householdC();
      env.DB = asD1(raw);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(AT("2026-11-10T09:00:00")));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("UC-603 AC-32: add_transaction lương 20.000.000 → effects.savings { 2.000.000, 10 }, một nhắc ①, không nhật ký pay_cycle.open; chuyển 2.000.000 sang tài khoản tích luỹ → ① tự xong", async () => {
      const income = await mcp(call("add_transaction", { meaning: "income", amount: 20_000_000, income_stream_id: "salary", account_id: "main", at: AT("2026-11-10T08:00:00") }));
      expect(income.json?.result.isError).toBeFalsy();
      const data = toolData(income.json!);
      expect(data.tx).toMatchObject({ meaning: "income", legacy_class: null, counter_account_id: "main", is_salary: 1 });
      expect(data.effects.savings).toEqual({ amount: 2_000_000, pct: 10 });
      expect(data.effects).not.toHaveProperty("cycle");
      expect(raw.prepare("SELECT month_key, amount, status FROM month_tasks WHERE income_tx_id = ?").all(data.tx.id)).toEqual([{ month_key: "2026-11", amount: 2_000_000, status: "open" }]);
      expect(raw.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'pay_cycle%'").get()).toEqual({ n: 0 });

      const move = await mcp(call("add_transaction", { meaning: "transfer", amount: 2_000_000, account_id: "main", to_account_id: "savings", at: AT("2026-11-10T08:30:00") }));
      expect(move.json?.result.isError).toBeFalsy();
      expect(toolData(move.json!).effects.tasksDone).toEqual([expect.objectContaining({ kind: "savings" })]);
      const snap = toolData((await mcp(call("get_snapshot"))).json!);
      expect(snap.month.tasks.find((t: { kind: string }) => t.kind === "savings")).toMatchObject({ status: "done", auto: true });
    });

    it("UC-602 AC-13: get_snapshot trả month, monthClose, moneyAge, nearSpend.salaryPayday bằng đúng GET /v1/snapshot, không payCycle / paySetup; mô tả tool có month tasks", async () => {
      const api = client(raw);
      const created = await api("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, income_stream_id: "salary", account_id: "main", at: AT("2026-11-10T08:00:00") });
      expect(created.status).toBe(201);
      const rest = (await api("GET", "/v1/snapshot")).json.data;
      const snap = toolData((await mcp(call("get_snapshot"))).json!);
      expect(rest.month).toMatchObject({ key: "2026-11", openCount: 1 });
      for (const k of ["month", "monthClose", "moneyAge", "nearSpend"] as const) expect(snap[k]).toEqual(rest[k]);
      expect(snap.nearSpend).toHaveProperty("salaryPayday");
      expect(snap).not.toHaveProperty("payCycle");
      expect(snap).not.toHaveProperty("paySetup");
      const list = (await mcp({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} })).json!.result.tools as { name: string; description: string }[];
      const description = list.find((t) => t.name === "get_snapshot")!.description;
      expect(description).toContain("month: month tasks — the savings reminder of each salary");
      for (const word of ["monthClose", "moneyAge", "nearSpend.salaryPayday"]) expect(description).toContain(word);
      expect(description).not.toMatch(/payCycle|pay cycle/);
    });
    it("UC-603 AC-5: sau lương, add_transaction chi 200.000 từ Vận hành → nearSpend.amount giảm đúng như khi ghi qua REST", async () => {
      const api = client(raw);
      expect((await api("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, income_stream_id: "salary", account_id: "main", at: AT("2026-11-10T08:00:00") })).status).toBe(201);
      const nearSpend = async () => toolData((await mcp(call("get_snapshot"))).json!).nearSpend.amount as number;
      const before = await nearSpend();
      const viaMcp = await mcp(call("add_transaction", { meaning: "spend", amount: 200_000, category_id: "groceries", account_id: "main" }));
      expect(viaMcp.json?.result.isError).toBeFalsy();
      const afterMcp = await nearSpend();
      expect((await api("POST", "/v1/transactions", { meaning: "spend", amount: 200_000, category_id: "groceries", account_id: "main" })).status).toBe(201);
      const afterRest = await nearSpend();
      expect(before - afterMcp).toBe(200_000);
      expect(afterMcp - afterRest).toBe(before - afterMcp);
    });

    it("UC-412: add_transaction khoản lương có nhắc ① → onSalary → notifySalary(env, id khoản thu) sau khi trả lời; khoản chi hay khoản thu không phải lương → không báo", async () => {
      const spend = await mcp(call("add_transaction", { meaning: "spend", amount: 100_000, category_id: "groceries", account_id: "main", at: AT("2026-11-10T07:00:00") }));
      expect(spend.json?.result.isError).toBeFalsy();
      expect(notifySalary).not.toHaveBeenCalled();

      const income = await mcp(call("add_transaction", { meaning: "income", amount: 20_000_000, income_stream_id: "salary", account_id: "main", at: AT("2026-11-10T08:00:00") }));
      const tx = toolData(income.json!).tx;
      expect(notifySalary).toHaveBeenCalledTimes(1);
      expect(notifySalary).toHaveBeenCalledWith(expect.objectContaining({ DB: env.DB }), tx.id);

      await mcp(call("add_transaction", { meaning: "income", amount: 5_000_000, income_stream_id: "side", account_id: "main", at: AT("2026-11-10T08:30:00") }));
      expect(notifySalary).toHaveBeenCalledTimes(1);
    });

    it("UC-412: assign_log log lương → notifySalary(env, id khoản thu) một lần", async () => {
      raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES ('S11', ?, 20000000, 'in', 'main', 'LUONG', 'pending')").run(AT("2026-11-10T08:00:00"));
      const assigned = await mcp(call("assign_log", { log_id: "S11", splits: [{ meaning: "income", amount: 20_000_000, income_stream_id: "salary" }] }));
      expect(assigned.json?.result.isError).toBeFalsy();
      const data = toolData(assigned.json!);
      expect(data.effects.savings).toEqual({ amount: 2_000_000, pct: 10 });
      expect(notifySalary).toHaveBeenCalledTimes(1);
      expect(notifySalary).toHaveBeenCalledWith(expect.objectContaining({ DB: env.DB }), data.transactions[0].id);
    });
  });
});

describe("Đợt D: Nhìn lại theo tháng, mục tiêu theo ngăn (261112-ba-ngan-nhin-lai, 261112-thang-thay-ky-luong)", () => {
  describe("hộ mẫu D", () => {
    beforeEach(async () => {
      raw = householdD();
      env.DB = asD1(raw);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(D_NOW);
      // Token cấp ở đồng hồ thật đã hết hạn tại D_NOW — nối lại ở giờ giả lập.
      token = (await connectClaude(env, { memberId: "husband", password: "mat-khau-chung" })).access;
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("UC-602 AC-14: get_spending_by_category {} và { period: \"2026-10\" } bằng đúng GET /v1/spend-by-category cùng tham số; mặc định tháng hiện tại; cycle → model_changed như REST", async () => {
      const api = client(raw);
      const current = toolData((await mcp(call("get_spending_by_category", {}))).json!);
      expect(current).toEqual((await api("GET", "/v1/spend-by-category")).json.data);
      expect(current).toMatchObject({ kind: "month", month: "2026-11" });
      const previous = toolData((await mcp(call("get_spending_by_category", { period: "2026-10" }))).json!);
      expect(previous).toEqual((await api("GET", "/v1/spend-by-category?period=2026-10")).json.data);
      const old = await mcp(call("get_spending_by_category", { cycle: "2026-11-10" }));
      expect(old.json?.result.isError).toBe(true);
      const rest = await api("GET", "/v1/spend-by-category?cycle=2026-11-10");
      expect(rest.json.error).toMatchObject({ code: "model_changed", fields: ["cycle"] });
      expect(old.json?.result.content[0].text).toBe(`model_changed: ${rest.json.error?.message}`);
    });

    it("UC-602 AC-15: get_goals bằng đúng GET /v1/goals; mô tả tool không có wallet / safety fund / wealth building", async () => {
      const api = client(raw);
      const goals = toolData((await mcp(call("get_goals"))).json!);
      expect(goals).toEqual((await api("GET", "/v1/goals")).json.data);
      expect(goals).not.toHaveProperty("wealthBuilding");
      expect(goals).not.toHaveProperty("safetyFund");
      const list = (await mcp({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} })).json!.result.tools as { name: string; description: string }[];
      expect(list.find((t) => t.name === "get_goals")!.description).not.toMatch(/wallet|safety fund|wealth building/i);
    });
  });
});

describe("tài khoản riêng tư ở MCP (UC-504, ADR-133) — hộ mẫu P", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(P_NOW);
    raw = householdP();
    env.DB = asD1(raw);
    token = (await connectClaude(env, { memberId: "husband", password: "mat-khau-chung" })).access;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const txCount = () => (raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n;
  const errorText = (json: JsonRpcResult) => (json.result.content as { text: string }[]).map((b) => b.text).join("\n");

  it("UC-504 AC-14: add_transaction của chồng chi 50.000 từ cash-wife (kể cả by_member_id: wife) → lỗi private_account như REST, không ghi; mô tả tool có câu về tài khoản riêng tư", async () => {
    const spend = { meaning: "spend", amount: 50_000, account_id: "cash-wife", category_id: "groceries" };
    const rest = await client(raw)("POST", "/v1/transactions", spend);
    expect([rest.status, rest.json.error?.code]).toEqual([403, "private_account"]);
    const before = txCount();
    for (const args of [spend, { ...spend, by_member_id: "wife" }]) {
      const res = await mcp(call("add_transaction", args));
      expect(res.json?.result.isError).toBe(true);
      expect(errorText(res.json!)).toBe(rest.json.error?.message);
    }
    expect(txCount()).toBe(before);
    const list = (await mcp({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} })).json!.result.tools as { name: string; description: string }[];
    expect(list.find((t) => t.name === "add_transaction")!.description).toContain("Accounts marked private by another member cannot be written to (error private_account).");
  });

  it("UC-805 AC-10: add_transaction thu kèm tenant_id vào vcb-wife — vợ uỷ quyền → lỗi tenant_private_account, chồng → lỗi private_account như REST; không ghi gì, số dư An không đổi", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('an', 'An')").run();
    const rent = { meaning: "income", amount: 1_000_000, account_id: "vcb-wife", tenant_id: "an" };
    const before = { tx: txCount(), balance: raw.prepare("SELECT balance FROM v_tenant_balance WHERE tenant_id = 'an'").get() };
    const husband = await mcp(call("add_transaction", rent));
    expect(husband.json?.result.isError).toBe(true);
    expect(errorText(husband.json!)).toBe((await client(raw)("POST", "/v1/transactions", rent)).json.error?.message);
    expect(errorText(husband.json!)).toBe("Tài khoản riêng tư của người khác, chỉ chủ tài khoản mới ghi được vào đây.");
    token = (await connectClaude(env, { memberId: "wife", password: "mat-khau-chung" })).access;
    const wife = await mcp(call("add_transaction", rent));
    expect(wife.json?.result.isError).toBe(true);
    expect(errorText(wife.json!)).toBe("Tiền thuê không ghi vào Tài khoản riêng tư. Chọn tài khoản khác.");
    expect({ tx: txCount(), balance: raw.prepare("SELECT balance FROM v_tenant_balance WHERE tenant_id = 'an'").get() }).toEqual(before);
  });

  it("UC-504 AC-15: get_debts / get_receivables của chồng không có #108, #109; paid / lent / balance vẫn cộng; bằng đúng REST của chồng", async () => {
    const debts = toolData((await mcp(call("get_debts"))).json!);
    expect(debts.debts.find((d: { id: string }) => d.id === "vay-anh-ba")).toMatchObject({ paid: 400_000, balance: 1_600_000, payments: [] });
    const receivables = toolData((await mcp(call("get_receivables"))).json!);
    expect(receivables.receivables.find((r: { id: string }) => r.id === "em-hai")).toMatchObject({ lent: 300_000, balance: 300_000, movements: [] });
    const api = client(raw);
    expect(debts).toEqual((await api("GET", "/v1/debts")).json.data);
    expect(receivables).toEqual((await api("GET", "/v1/receivables")).json.data);
    expect((await api("GET", "/v1/debts", undefined, "wife")).json.data.debts.find((d: { id: string }) => d.id === "vay-anh-ba").payments).toHaveLength(1);
  });

  it("UC-504 AC-16: add_transaction hoàn tiền link_id 101 (bị giấu) → cùng lỗi, cùng chữ như link_id 99999; không ghi", async () => {
    const refund = (link_id: number) => mcp(call("add_transaction", { meaning: "refund", amount: 30_000, account_id: "cash-husband", link_id }));
    const before = txCount();
    const hidden = await refund(101);
    const missing = await refund(99999);
    expect([hidden.json?.result.isError, missing.json?.result.isError]).toEqual([true, true]);
    expect(errorText(hidden.json!)).toBe(errorText(missing.json!));
    expect(txCount()).toBe(before);
  });

  it("UC-504 AC-17: assign_log L2 thành chuyển khoản sang vcb-wife → lỗi private_account như REST; L2 vẫn chờ", async () => {
    const args = { log_id: "L2", splits: [{ meaning: "transfer", amount: 3_000_000, other_account_id: "vcb-wife" }] };
    const res = await mcp(call("assign_log", args));
    expect(res.json?.result.isError).toBe(true);
    const rest = await client(raw)("POST", "/v1/logs/L2/assign", { splits: args.splits });
    expect([rest.status, rest.json.error?.code]).toEqual([403, "private_account"]);
    expect(errorText(res.json!)).toBe(rest.json.error?.message);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'L2'").get()).toEqual({ status: "pending" });
  });

  it("UC-504 AC-18: lương về vcb-wife (nhắc ①) → get_snapshot của chồng có source { hidden: true }, bằng đúng GET /v1/snapshot của chồng", async () => {
    raw.exec("UPDATE accounts SET sepay_enabled = 0 WHERE id = 'vcb-wife'; UPDATE config SET v = '10' WHERE k = 'savings_pct';");
    const api = client(raw);
    const income = await api("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "vcb-wife", income_stream_id: "salary-husband", at: "2026-11-12T01:00:00.000Z" }, "wife");
    expect(income.status).toBe(201);
    const snap = toolData((await mcp(call("get_snapshot"))).json!);
    const sources = (snap.month.tasks as { source: unknown }[]).map((t) => t.source).filter((s) => s !== null);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(s).toEqual({ hidden: true });
    expect(snap.month).toEqual((await api("GET", "/v1/snapshot")).json.data.month);
  });

  it("UC-504 AC-19: BIDV (Ví Thưởng) và hai tài khoản chi tiêu riêng tư của vợ → get_snapshot của chồng có topUp chỉ gợi ý Phao, không đích (toAccountId / target null), bằng đúng GET /v1/snapshot của chồng", async () => {
    vi.setSystemTime(PARENT_NOW);
    raw = householdTopUp({ history: true });
    raw.exec("UPDATE accounts SET owner_member_id = 'wife', private = 1 WHERE id IN ('tk-bidv', 'tk-chi-tieu-chong', 'tk-chi-tieu-vo')");
    env.DB = asD1(raw);
    token = (await connectClaude(env, { memberId: "husband", password: "mat-khau-chung" })).access;
    const snap = toolData((await mcp(call("get_snapshot"))).json!);
    expect(snap.topUp).toMatchObject({ sources: [{ accountId: "phao", name: "Phao", amount: 2_500_000 }], toAccountId: null, target: null });
    expect(snap.topUp).toEqual((await client(raw)("GET", "/v1/snapshot")).json.data.topUp);
  });
});

describe("mục tiêu chung một tài khoản qua MCP (UC-602 AC-18, UC-603 AC-33, UC-604 AC-14)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SHARED_NOW);
    raw = householdShared();
    raw.prepare("UPDATE accounts SET sepay_enabled = 0").run();
    env = { DB: asD1(raw), OAUTH_KV: new MemoryKV() as unknown as KVNamespace, API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
    token = (await connectClaude(env, { memberId: "husband", password: "mat-khau-chung" })).access;
  });
  afterEach(() => vi.useRealTimers());

  const rest = async (path: string) =>
    ((await (await app.request(`https://app.example.com${path}`, { headers: { Authorization: "Bearer tok", "X-Member-Id": "husband" } }, env)).json()) as { data: any }).data;

  it("UC-602 AC-18: get_snapshot, get_goals và GET /v1/snapshot, GET /v1/goals cùng reserve.groups, cùng held từng mục tiêu; mô tả tool nói nhiều mục tiêu chung một tài khoản", async () => {
    const snap = toolData((await mcp(call("get_snapshot", {}))).json!);
    const goals = toolData((await mcp(call("get_goals", {}))).json!);
    const restSnap = await rest("/v1/snapshot");
    const restGoals = await rest("/v1/goals");
    const held = (list: { id: string; held: number | null }[]) => Object.fromEntries(list.map((g) => [g.id, g.held]));
    expect(snap.pockets.reserve.groups).toEqual(restSnap.pockets.reserve.groups);
    expect(goals.reserve.groups).toEqual(restSnap.pockets.reserve.groups);
    expect(restGoals.reserve.groups).toEqual(restSnap.pockets.reserve.groups);
    expect(held(goals.reserve.goals)).toEqual(held(restSnap.pockets.reserve.goals));
    expect(held(snap.pockets.reserve.goals)).toEqual({ "hoa-don": 2_000_000, "nha-o": 7_500_000, "hoc-tap": 4_500_000, "bao-duong-xe": 4_800_000, "hieu-hi": 2_200_000, thue: 1_500_000 });
    const tools = (await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json!.result.tools as { name: string; description: string }[];
    for (const name of ["get_snapshot", "get_goals"]) expect(tools.find((t) => t.name === name)!.description).toContain("share one account");
    expect(tools).toHaveLength(16);
  });

  it("UC-603 AC-33: add_transaction chi 7.500.000 từ MB tiết kiệm goal_id nha-o → ghi, Nhà ở spent 7.500.000, nhật ký via mcp có goal_id; goal_id bao-duong-xe → lỗi invalid_goal, không ghi gì", async () => {
    const r = await mcp(call("add_transaction", { meaning: "spend", amount: 7_500_000, category_id: "housing", account_id: "tk-tiet-kiem", goal_id: "nha-o" }));
    expect(r.json!.result.isError).toBeFalsy();
    expect(toolData(r.json!).tx.goal_id).toBe("nha-o");
    const goals = toolData((await mcp(call("get_goals", {}))).json!);
    expect(goals.reserve.goals.find((g: { id: string }) => g.id === "nha-o")).toMatchObject({ held: 0, spent: 7_500_000 });
    const logRow = raw.prepare("SELECT via, detail FROM audit_log WHERE action = 'tx.create'").get() as { via: string; detail: string };
    expect(logRow.via).toBe("mcp");
    expect(JSON.parse(logRow.detail)).toMatchObject({ goal_id: "nha-o" });
    const before = raw.prepare("SELECT COUNT(*) AS n FROM transactions").get();
    const bad = await mcp(call("add_transaction", { meaning: "spend", amount: 7_500_000, category_id: "housing", account_id: "tk-tiet-kiem", goal_id: "bao-duong-xe" }));
    expect(bad.json!.result.isError).toBe(true);
    expect(bad.json!.result.content[0].text).toBe("Mục tiêu này không thuộc tài khoản chi.");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM transactions").get()).toEqual(before);
  });

  it("UC-604 AC-14: assign_log log ra của MB tiết kiệm với goal_id hoc-tap → khoản có goal_id hoc-tap", async () => {
    raw.exec(`INSERT INTO bank_logs (id, at, amount, direction, account_id, content, source, status) VALUES ('m1', '${vnAt("2026-11-12 09:00")}', 6000000, 'out', 'tk-tiet-kiem', 'HOC PHI', 'webhook', 'pending')`);
    const r = await mcp(call("assign_log", { log_id: "m1", splits: [{ meaning: "spend", amount: 6_000_000, category_id: "work-gear", goal_id: "hoc-tap" }] }));
    expect(r.json!.result.isError).toBeFalsy();
    expect(raw.prepare("SELECT goal_id FROM transactions WHERE log_id = 'm1'").get()).toEqual({ goal_id: "hoc-tap" });
  });
});

describe("tài khoản con, tiền lãi, mục tiêu trả từ tiền chi tiêu qua MCP (UC-602 AC-19, UC-603 AC-34, UC-604 AC-15)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PARENT_NOW);
    raw = householdParent({ operatingGoals: true });
    env = { DB: asD1(raw), OAUTH_KV: new MemoryKV() as unknown as KVNamespace, API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
    token = (await connectClaude(env, { memberId: "husband", password: "mat-khau-chung" })).access;
  });
  afterEach(() => vi.useRealTimers());

  const rest = async (path: string) =>
    ((await (await app.request(`https://app.example.com${path}`, { headers: { Authorization: "Bearer tok", "X-Member-Id": "husband" } }, env)).json()) as { data: any }).data;

  it("UC-602 AC-19: get_snapshot bằng đúng GET /v1/snapshot ở operating.goals, nearSpend.goalRemaining, topUp, accounts[].parentId, groups[].interest; get_goals bằng đúng GET /v1/goals, có mục tiêu trả từ tiền chi tiêu; mô tả tool nói các trường mới", async () => {
    const snap = toolData((await mcp(call("get_snapshot", {}))).json!);
    const restSnap = await rest("/v1/snapshot");
    expect(snap).toEqual(restSnap);
    expect(snap.pockets.operating.goals.map((g: { id: string }) => g.id)).toEqual(["dien-nuoc", "thuoc", "thien-phuoc", "ve-que"]);
    expect(snap.nearSpend.goalRemaining).toBe(4_500_000);
    expect(snap).toHaveProperty("topUp");
    expect(snap.pockets.reserve.accounts.find((a: { id: string }) => a.id === "gui-6-thang").parentId).toBe("tk-tiet-kiem");
    expect(snap.pockets.reserve.groups[0]).toMatchObject({ accountId: "tk-tiet-kiem", interest: 0, childIds: ["gui-6-thang"] });
    const goals = toolData((await mcp(call("get_goals", {}))).json!);
    expect(goals).toEqual(await rest("/v1/goals"));
    expect(goals.operating.goals.map((g: { id: string; remaining: number }) => [g.id, g.remaining])).toEqual([
      ["dien-nuoc", 2_000_000],
      ["thuoc", 500_000],
      ["thien-phuoc", 1_000_000],
      ["ve-que", 1_000_000],
    ]);
    const tools = (await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json!.result.tools as { name: string; description: string; inputSchema: { properties: Record<string, unknown> } }[];
    const description = (name: string) => tools.find((t) => t.name === name)!.description;
    for (const word of ["operating.goals", "goalRemaining", "topUp", "parentId", "interest"]) expect(description("get_snapshot")).toContain(word);
    for (const word of ["operating.goals", "interest"]) expect(description("get_goals")).toContain(word);
    for (const name of ["add_transaction", "assign_log"]) expect(description(name)).toMatch(/is_interest/);
    expect(Object.keys(tools.find((t) => t.name === "add_transaction")!.inputSchema.properties)).toEqual(expect.arrayContaining(["goal_id", "is_interest", "from_interest"]));
  });

  it("UC-603 AC-34: add_transaction chi 1.000.000 từ tk-chi-tieu-vo goal_id dien-nuoc → ghi, goalRemaining giảm 1.000.000; from_interest vượt tiền lãi → lỗi invalid_interest", async () => {
    const remaining = async () => toolData((await mcp(call("get_snapshot", {}))).json!).nearSpend.goalRemaining as number;
    expect(await remaining()).toBe(4_500_000);
    const r = await mcp(call("add_transaction", { meaning: "spend", amount: 1_000_000, category_id: "housing", account_id: "tk-chi-tieu-vo", goal_id: "dien-nuoc" }));
    expect(r.json!.result.isError).toBeFalsy();
    expect(toolData(r.json!).tx.goal_id).toBe("dien-nuoc");
    expect(await remaining()).toBe(3_500_000);
    const over = await mcp(call("add_transaction", { meaning: "transfer", amount: 100_000, account_id: "tk-tiet-kiem", to_account_id: "tk-chi-tieu-chong", from_interest: true }));
    expect(over.json!.result.isError).toBe(true);
    expect(over.json!.result.content[0].text).toMatch(/^Tiền lãi của MB tiết kiệm chỉ còn 0 ₫/);
  });

  it("UC-604 AC-15: assign_log log in 3.000.000 của khoản gửi với is_interest: true → khoản có phân loại passive_income, tiền lãi của nhóm +3.000.000", async () => {
    raw.exec(`INSERT INTO bank_logs (id, at, amount, direction, account_id, content, source, status) VALUES ('m1', '${vnAt("2026-11-20 09:00")}', 3000000, 'in', 'gui-6-thang', 'TAT TOAN LAI', 'webhook', 'pending')`);
    const r = await mcp(call("assign_log", { log_id: "m1", splits: [{ meaning: "income", amount: 3_000_000, is_interest: true }] }));
    expect(r.json!.result.isError).toBeFalsy();
    const id = toolData(r.json!).transactions[0].id as number;
    expect(raw.prepare("SELECT report_class FROM transaction_report_classes WHERE transaction_id = ?").get(id)).toEqual({ report_class: "passive_income" });
    expect((await rest("/v1/snapshot")).pockets.reserve.groups[0]).toMatchObject({ accountId: "tk-tiet-kiem", interest: 3_000_000 });
  });
});
