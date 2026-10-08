import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";

// Nhật ký thay đổi và cảnh báo cả nhà khi kênh báo tin / khoá đổi (ADR-90).

let env: Env;
let raw: DatabaseSync;
let telegram: { token: string; chat_id: string; text: string }[];

const TG_TOKEN = "123456:telegram-token-xyz";

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  telegram = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const m = /api\.telegram\.org\/bot([^/]+)\/sendMessage/.exec(String(url));
      if (m) {
        const body = JSON.parse(String(init.body)) as { chat_id: string; text: string };
        telegram.push({ token: m[1]!, chat_id: body.chat_id, text: body.text });
      }
      return Response.json({ ok: true });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Created = { tx: { id: number } };
async function call<T = unknown>(method: string, path: string, body?: unknown, member = "husband") {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: { Authorization: "Bearer tok", "X-Member-Id": member, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}

const auditRows = () => raw.prepare("SELECT member_id, via, action, target, detail FROM audit_log ORDER BY id").all();
/** Cả nhà có Telegram: Chồng chat 1001, Vợ chat 2002. */
const telegramReady = () => {
  raw.prepare("INSERT INTO config (k, v) VALUES ('secret:telegram_bot_token', ?)").run(TG_TOKEN);
  raw.prepare("UPDATE members SET tg_chat_id = CASE id WHEN 'husband' THEN '1001' ELSE '2002' END").run();
};
const chats = () => telegram.map((t) => t.chat_id).sort();

describe("nhật ký thay đổi", () => {
  it("huỷ, sửa, gỡ gán giao dịch đều ghi một dòng: ai, qua đâu, giao dịch nào", async () => {
    const created = await call<Created>("POST", "/v1/transactions", { meaning: "spend", amount: 50_000, category_id: "groceries" }, "wife");
    const id = created.json.data.tx.id;
    const replaced = await call<Created>("POST", `/v1/transactions/${id}/replace`, { meaning: "spend", amount: 60_000, category_id: "groceries" }, "wife");
    expect(replaced.status).toBe(201);
    const newId = replaced.json.data.tx.id;
    expect((await call("POST", `/v1/transactions/${newId}/void`, {})).status).toBe(200);
    // Gọi huỷ lỗi (đã huỷ rồi) thì không ghi gì.
    expect((await call("POST", `/v1/transactions/${newId}/void`, {})).status).toBe(409);

    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES ('va', '2026-09-22T02:00:00.000Z', 300000, 'out', 'vcb-husband', 'pending'), ('vb', '2026-09-22T02:00:00.000Z', 300000, 'in', 'tcb-husband', 'pending')").run();
    const paired = await call<{ transactionId: number }>("POST", "/v1/logs/pair", { log_a: "va", log_b: "vb" });
    const pairId = paired.json.data.transactionId;
    expect((await call("POST", `/v1/logs/transactions/${pairId}/void`, {})).status).toBe(200);

    expect(auditRows()).toEqual([
      { member_id: "wife", via: "token", action: "tx.replace", target: `tx:${id}`, detail: null },
      { member_id: "husband", via: "token", action: "tx.void", target: `tx:${newId}`, detail: null },
      { member_id: "husband", via: "token", action: "tx.unassign", target: `tx:${pairId}`, detail: JSON.stringify({ voided: [pairId], logs: ["va", "vb"] }) },
    ]);
  });

  it("sửa tài khoản, thành viên, khoá, kết nối SePay chỉ ghi tên trường — không bao giờ ghi khoá; nhật ký không sửa, không xoá được", async () => {
    const webhookKey = "sepay-webhook-key-rat-dai-0001";
    const apiToken = "sepay-api-token-bi-mat-0002";
    expect((await call("POST", "/v1/settings/accounts", { name: "Ví Momo", kind: "ewallet", opening_balance: 0 })).status).toBe(201);
    expect((await call("PATCH", "/v1/settings/accounts/vcb-husband", { name: "VCB của Chồng" })).status).toBe(200);
    expect((await call("PATCH", "/v1/settings/members/wife", { name: "Vợ yêu" })).status).toBe(200);
    expect((await call("PUT", "/v1/settings/integrations", { telegram_bot_token: TG_TOKEN })).status).toBe(200);
    expect((await call("POST", "/v1/settings/sepay/connections", { id: "sepay-wife", name: "SePay của vợ", api_token: apiToken, webhook_key: webhookKey })).status).toBe(201);
    expect((await call("PATCH", "/v1/settings/sepay/connections/default", { webhook_key: `${webhookKey}-moi`, active: false })).status).toBe(200);

    expect(auditRows()).toEqual([
      { member_id: "husband", via: "token", action: "account.create", target: "account:vi-momo", detail: '{"fields":["kind","name","opening_balance"]}' },
      { member_id: "husband", via: "token", action: "account.update", target: "account:vcb-husband", detail: '{"fields":["name"]}' },
      { member_id: "husband", via: "token", action: "member.update", target: "member:wife", detail: '{"fields":["name"]}' },
      { member_id: "husband", via: "token", action: "integrations.update", target: null, detail: '{"set":["telegram_bot_token"],"cleared":[]}' },
      { member_id: "husband", via: "token", action: "sepay.create", target: "sepay:sepay-wife", detail: '{"fields":["api_token","id","name","webhook_key"]}' },
      { member_id: "husband", via: "token", action: "sepay.update", target: "sepay:default", detail: '{"fields":["active","webhook_key"],"active":false}' },
    ]);
    const dump = JSON.stringify(raw.prepare("SELECT * FROM audit_log").all());
    for (const secret of [webhookKey, apiToken, TG_TOKEN]) expect(dump).not.toContain(secret);
    expect(() => raw.prepare("DELETE FROM audit_log").run()).toThrow(/chỉ thêm/);
  });

  it("GET /v1/settings/audit trả 50 dòng mới nhất, mới trước, kèm tên người", async () => {
    const insert = raw.prepare("INSERT INTO audit_log (member_id, via, action, target) VALUES (?, 'session', 'tx.void', ?)");
    for (let i = 1; i <= 60; i++) insert.run(i % 2 ? "husband" : "wife", `tx:${i}`);
    const { status, json } = await call<{ id: number }[]>("GET", "/v1/settings/audit");
    expect(status).toBe(200);
    expect(json.data).toHaveLength(50);
    expect(json.data[0]).toEqual({ id: 60, at: expect.any(String), memberId: "wife", memberName: "Vợ", via: "session", action: "tx.void", target: "tx:60", detail: null });
    expect(json.data[49]!.id).toBe(11);
  });
});

describe("cảnh báo cả nhà khi kênh báo tin hay khoá đổi", () => {
  it("đặt/đổi khoá webhook, token SePay hay tắt kết nối → mọi kênh được báo; chỉ đổi tên thì không", async () => {
    telegramReady();
    await call("PATCH", "/v1/settings/sepay/connections/default", { webhook_key: "sepay-webhook-key-cua-ke-gian" }, "wife");
    const text = "⚠️ Vợ (qua API token) vừa đặt khoá webhook kết nối SePay “SePay chính” — nếu không phải người nhà làm, vào Cài đặt gỡ ngay.";
    expect(telegram).toEqual([
      { token: TG_TOKEN, chat_id: "1001", text },
      { token: TG_TOKEN, chat_id: "2002", text },
    ]);

    telegram = [];
    await call("PATCH", "/v1/settings/sepay/connections/default", { name: "SePay nhà" });
    expect(telegram).toEqual([]);

    await call("PATCH", "/v1/settings/sepay/connections/default", { active: false, api_token: null });
    expect(chats()).toEqual(["1001", "2002"]);
    expect(telegram[0]!.text).toContain("vừa xoá token API, tắt kết nối SePay “SePay nhà”");

    telegram = [];
    await call("POST", "/v1/settings/sepay/connections", { name: "SePay lạ", webhook_key: "khoa-webhook-cua-ke-gian-0002" });
    expect(chats()).toEqual(["1001", "2002"]);
    expect(telegram[0]!.text).toContain("vừa đặt khoá webhook kết nối SePay “SePay lạ”");
  });

  it("đổi bot token Telegram / Zalo thì báo cả nhà (qua token mới tới các chat đang có)", async () => {
    telegramReady();
    const newToken = "999999:telegram-token-moi";
    await call("PUT", "/v1/settings/integrations", { telegram_bot_token: newToken, zalo_webhook_secret: "zalo_secret_moi_01" });
    expect(telegram.map((t) => [t.token, t.chat_id])).toEqual([
      [newToken, "1001"],
      [newToken, "2002"],
    ]);
    expect(telegram[0]!.text).toContain("vừa đổi bot token Telegram, khoá webhook Zalo");
  });

  it("đổi chat Telegram của một người → chat cũ, chat mới và cả nhà đều được báo; mỗi kênh một lần", async () => {
    telegramReady();
    const res = await call("PATCH", "/v1/settings/members/wife", { tg_chat_id: "9999" });
    expect(res.status).toBe(200);
    expect(chats()).toEqual(["1001", "2002", "9999"]);
    expect(new Set(telegram.map((t) => t.text))).toEqual(new Set(["⚠️ Chồng (qua API token) vừa đổi chat Telegram nhận tin của Vợ — nếu không phải người nhà làm, vào Cài đặt gỡ ngay."]));

    telegram = [];
    await call("PATCH", "/v1/settings/members/wife", { tg_chat_id: "9999", name: "Vợ" });
    expect(telegram).toEqual([]); // chat không đổi: không báo
  });
});
