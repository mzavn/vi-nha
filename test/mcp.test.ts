import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { connectClaude, MemoryKV, mcpPost, stubClientMetadata, toolCall as call, type JsonRpc } from "./helpers/oauth";

let env: Env;
let raw: ReturnType<typeof openDb>;
/** Token OAuth của chủ hộ, đủ quyền Xem + Ghi (nối như ngoài đời: đăng nhập → đồng ý → PKCE). */
let token: string;

beforeEach(async () => {
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

  it("tools/list trả đúng 16 tool (không cần gọi initialize trước — server không giữ phiên)", async () => {
    const { status, json } = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(status).toBe(200);
    const names = (json?.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "add_tenant_shared_expense",
        "add_transaction",
        "allocate_income",
        "assign_log",
        "get_budget",
        "get_debts",
        "get_goals",
        "get_receivables",
        "get_reconciliation",
        "get_snapshot",
        "get_spending_by_category",
        "list_categories",
        "list_pending_logs",
        "list_tenants",
        "list_transfer_orders",
        "preview_allocation",
      ].sort(),
    );
  });

  it("mô tả tool không còn 'chưa triển khai' / 'phase 04', không nhắc tên tool cũ, tên cũ của Tích sản hay chữ khẩn cấp", async () => {
    const { json } = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools = json?.result.tools as { name: string; description: string }[];
    expect(tools).toHaveLength(16);
    for (const t of tools) {
      expect(t.description, t.name).not.toMatch(/chưa triển khai|chưa làm|phase 04/i);
      expect(t.description, t.name).not.toMatch(/\b(reconcile|spend_by_category|allocate|get_tenants|add_tenant_paid_for_us)\b/);
      expect(t.description, t.name).not.toMatch(/tichsan|phao khẩn cấp/i);
    }
  });
});

describe("tool đọc số liệu", () => {
  it("get_snapshot trả đúng dữ liệu như GET /v1/snapshot cho cùng một DB", async () => {
    // Chia lương + chi một khoản để snapshot có số khác 0.
    const income = await app.request(
      "/v1/transactions",
      { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ meaning: "income", amount: 40_000_000, account_id: "vcb-husband" }) },
      env,
    );
    const incomeId = ((await income.json()) as any).data.tx.id;
    await app.request("/v1/allocate", { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify({ income_tx_id: incomeId }) }, env);
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

  it("list_categories trả danh mục kèm ví mặc định", async () => {
    const { json } = await mcp(call("list_categories"));
    const cats = toolData(json!) as { id: string; defaultWalletId: string }[];
    expect(cats.find((c) => c.id === "fuel-parking")).toMatchObject({ defaultWalletId: "transport" });
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

  it(`"chi 200k xăng tiền mặt" → ghi vào ví đi-lai, tài khoản tiền mặt của người ghi`, async () => {
    const { status, json } = await mcp(call("add_transaction", { meaning: "spend", amount: 200_000, category_id: "fuel-parking", by_member_id: "wife" }));
    expect(status).toBe(200);
    expect(json?.result.isError).toBeFalsy();
    const data = toolData(json!);
    expect(data.tx).toMatchObject({ counter_wallet_id: "transport", account_id: "cash-wife", category_id: "fuel-parking", by_member_id: "wife", source: "manual" });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE counter_wallet_id = 'transport'").get()).toEqual({ n: 1 });
  });

  it("income kèm tenant_id → gắn người thuê, tự lấy nguồn thu cho thuê", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
    const { json } = await mcp(call("add_transaction", { meaning: "income", amount: 5_191_667, account_id: "vcb-husband", tenant_id: "tenant-binh", by_member_id: "husband" }));
    expect(json?.result.isError).toBeFalsy();
    expect(toolData(json!).tx).toMatchObject({ tenant_id: "tenant-binh", income_stream_id: "rental" });
  });
});

describe("sổ người thuê", () => {
  it("add_tenant_shared_expense ghi dòng âm; list_tenants thấy số dư giảm", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
    const added = await mcp(call("add_tenant_shared_expense", { tenant_id: "tenant-binh", amount: 300_000, category_id: "groceries", note: "Đi chợ" }));
    expect(added.json?.result.isError).toBeFalsy();
    expect(toolData(added.json!)).toMatchObject({ kind: "paid_for_us", amount: -300_000, categoryId: "groceries", name: "Đi chợ" });

    const { json } = await mcp(call("list_tenants"));
    const data = toolData(json!);
    expect(data.headcount).toBe(3);
    expect(data.tenants).toEqual([{ id: "tenant-binh", name: "Anh Bình", active: true, balance: -300_000, fees: [] }]);
  });

  it("add_tenant_shared_expense với danh mục không phải chi chung → tool error", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
    const { json } = await mcp(call("add_tenant_shared_expense", { tenant_id: "tenant-binh", amount: 50_000, category_id: "fuel-parking" }));
    expect(json?.result.isError).toBe(true);
    expect(raw.prepare("SELECT COUNT(*) n FROM tenant_lines").get()).toEqual({ n: 0 });
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

  it("add_transaction nhận debt_id", async () => {
    raw.prepare("INSERT INTO debts (id, name) VALUES ('co-lan', 'Cô Lan')").run();
    raw.prepare("INSERT INTO debt_lines (debt_id, at, kind, amount) VALUES ('co-lan', '2026-10-01T03:00:00.000Z', 'opening', 1000000)").run();
    const { json } = await mcp(call("add_transaction", { meaning: "spend", amount: 400_000, debt_id: "co-lan", by_member_id: "husband" }));
    expect(json?.result.isError).toBeFalsy();
    expect(toolData(json!).tx).toMatchObject({ debt_id: "co-lan", category_id: "debt-payment", counter_wallet_id: "rental-income" });
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
    expect(toolData(json!).tx).toMatchObject({ meaning: "collect", receivable_id: "em-hai", counter_account_id: "cash-husband", wallet_id: null });
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
