import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { notifyMembers } from "../src/notify/telegram";
import { ZALO_TEXT_MAX, zaloText } from "../src/notify/zalo";
import { createZaloLinkCode, handleZaloUpdate, setZaloWebhook, testZalo, ZALO_CODE_MAX_FAILURES, ZALO_CODE_TTL_MS } from "../src/services/zalo";
import type { Actor } from "../src/services/audit";
import { asD1, openDb } from "./helpers/d1-sqlite";

const TOKEN = "12345689:abc-xyz-token-9f3e";
const SECRET = "zalo_secret-ab12";

let env: Env;
let raw: DatabaseSync;
let sent: { url: string; body: Record<string, unknown> }[];

/** Zalo giả: ghi mọi lời gọi, trả lời theo `reply` (mặc định ok). */
function fakeZalo(reply: () => Response = () => Response.json({ ok: true, result: { message_id: "m1", date: 1 } })): typeof fetch {
  const mock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return reply();
  });
  // vi.fn thiếu các thuộc tính phụ của fetch (preconnect) — code chỉ gọi nó như một hàm.
  const asFetch = mock as unknown as typeof fetch;
  return asFetch;
}

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  sent = [];
  vi.stubGlobal("fetch", fakeZalo());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setSecrets = (token: string | null = TOKEN, secret: string | null = SECRET) => {
  if (token) raw.prepare("INSERT OR REPLACE INTO config (k, v) VALUES ('secret:zalo_bot_token', ?)").run(token);
  if (secret) raw.prepare("INSERT OR REPLACE INTO config (k, v) VALUES ('secret:zalo_webhook_secret', ?)").run(secret);
};
const zaloChat = (id: string) => (raw.prepare("SELECT zalo_chat_id AS z FROM members WHERE id = ?").get(id) as { z: string | null }).z;
const pendingCodes = () => raw.prepare("SELECT member_id, code FROM zalo_link_codes ORDER BY member_id").all() as { member_id: string; code: string }[];
const ANH: Actor = { memberId: "husband", via: "session" };
const auditRows = () => raw.prepare("SELECT member_id, via, action, target, detail FROM audit_log ORDER BY id").all();
/** Thân trả về của /v1: chỉ khai báo những trường test đọc. */
interface Json {
  ok: boolean;
  data: Record<string, unknown> & { members: { id: string; zalo_chat_id: string | null }[]; integrations: Record<string, unknown> };
  error?: { code: string; message: string };
}
async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

/** Sự kiện tin văn bản như Zalo gửi (bọc trong { ok, result } như tài liệu). */
const event = (chatId: string, text: string, chatType = "PRIVATE") => ({
  ok: true,
  result: {
    event_name: "message.text.received",
    message: { from: { id: chatId, display_name: "Ai đó", is_bot: false }, chat: { id: chatId, chat_type: chatType }, text, message_id: "x1", date: 1 },
  },
});

const hook = (body: unknown, secret: string | null = SECRET) =>
  app.request(
    "https://app.example.com/webhooks/zalo",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(secret !== null ? { "X-Bot-Api-Secret-Token": secret } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );

describe("webhook Zalo", () => {
  it("thiếu hoặc sai khoá X-Bot-Api-Secret-Token → 401; chưa đặt khoá webhook → khoá hẳn", async () => {
    expect((await hook(event("c1", "xin chào"))).status).toBe(401); // chưa đặt khoá: không khoá nào đúng
    setSecrets();
    expect((await hook(event("c1", "xin chào"), null)).status).toBe(401);
    expect((await hook(event("c1", "xin chào"), "zalo_secret-ab13")).status).toBe(401);
    expect((await hook(event("c1", "xin chào"), "")).status).toBe(401);
    expect((await hook(event("c1", "xin chào"))).status).toBe(200);
  });

  it("nhắn đúng mã còn hạn trong chat riêng → nối zalo_chat_id cho đúng người, mã dùng một lần, bot trả lời đã nối", async () => {
    setSecrets();
    const { status, json } = await call("POST", "/v1/settings/members/wife/zalo-code");
    expect(status).toBe(201);
    const code = String(json.data.code);

    const res = await hook(event("chat-wife-2", `Mã của em: ${code}`));
    expect(res.status).toBe(200);
    expect(zaloChat("wife")).toBe("chat-wife-2");
    expect(zaloChat("husband")).toBeNull();
    expect(pendingCodes()).toEqual([]);
    expect(sent[0]).toEqual({ url: `https://bot-api.zaloplatforms.com/bot${TOKEN}/sendMessage`, body: { chat_id: "chat-wife-2", text: "Đã nối Zalo cho Vợ. Ví nhà sẽ báo tin ở đây." } });
    // Kênh mới → cảnh báo mọi kênh của cả nhà (ở đây chỉ có chính Zalo vừa nối), nói rõ ai tạo mã.
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toEqual({ chat_id: "chat-wife-2", text: "⚠️ Chồng (qua API token) vừa nối Zalo nhận tin cho Vợ — nếu không phải người nhà làm, vào Cài đặt gỡ ngay." });
    expect(auditRows()).toEqual([
      { member_id: "husband", via: "token", action: "member.zalo_code", target: "member:wife", detail: null },
      { member_id: "husband", via: "token", action: "member.zalo_link", target: "member:wife", detail: null },
    ]);

    // Mã đã dùng: người khác nhắn lại mã đó không chiếm được chỗ của Vợ.
    await hook(event("chat-la", code));
    expect(zaloChat("wife")).toBe("chat-wife-2");
    expect(sent[2]!.body.chat_id).toBe("chat-la");
    expect(String(sent[2]!.body.text)).toMatch(/Nối Zalo/);
  });

  it("mã sai hoặc hết hạn → trả lời hướng dẫn, tối đa một lần mỗi chat mỗi ngày, không nối ai", async () => {
    setSecrets();
    const { code } = await createZaloLinkCode(env, "husband", new Date(Date.now() - ZALO_CODE_TTL_MS - 1000), ANH);

    expect((await hook(event("c1", code))).status).toBe(200);
    expect(zaloChat("husband")).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.chat_id).toBe("c1");
    expect(String(sent[0]!.body.text)).toMatch(/Cài đặt › Thành viên/);

    await hook(event("c1", "xin chào"));
    await hook(event("c1", "123 456"));
    expect(sent).toHaveLength(1); // cùng chat, cùng ngày: không trả lời nữa
    await hook(event("c2", "?"));
    expect(sent).toHaveLength(2); // chat khác vẫn được hướng dẫn
  });

  it("tin trong nhóm bị bỏ qua: không nối, không trả lời", async () => {
    setSecrets();
    const { code } = await createZaloLinkCode(env, "husband", new Date(), ANH);
    expect((await hook(event("group-1", code, "GROUP"))).status).toBe(200);
    expect(zaloChat("husband")).toBeNull();
    expect(pendingCodes()).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("payload hỏng vẫn trả 200, không ném lỗi", async () => {
    setSecrets();
    for (const body of ["không phải json", "[1,2]", "{}", { message: "x" }, { result: null }, { message: { chat: { id: {}, chat_type: "PRIVATE" }, text: "1" } }]) {
      const res = await hook(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(sent).toEqual([]);
  });
});

describe("mã nối Zalo", () => {
  it("tạo mã 6 số hạn 15 phút, tạo lại thì mã cũ hết dùng; chưa đặt token và khoá webhook thì báo chưa sẵn sàng", async () => {
    const notReady = await call("POST", "/v1/settings/members/husband/zalo-code");
    expect(notReady.status).toBe(409);
    expect(notReady.json.error!.code).toBe("zalo_not_ready");
    setSecrets(TOKEN, null);
    expect((await call("POST", "/v1/settings/members/husband/zalo-code")).status).toBe(409);
    setSecrets();

    const now = new Date("2026-10-03T03:00:00Z");
    const first = await createZaloLinkCode(env, "husband", now, ANH);
    expect(first.code).toMatch(/^\d{6}$/);
    expect(first.expires_at).toBe("2026-10-03T03:15:00.000Z");
    const second = await createZaloLinkCode(env, "husband", now, ANH);
    expect(pendingCodes()).toEqual([{ member_id: "husband", code: second.code }]);

    expect((await call("POST", "/v1/settings/members/khong-co/zalo-code")).status).toBe(404);
  });

  it("bỏ nối Zalo bằng zalo_chat_id null — chat cũ và cả nhà được cảnh báo, có nhật ký; không nhập chat_id Zalo bằng tay", async () => {
    setSecrets();
    raw.prepare("UPDATE members SET zalo_chat_id = 'chat-husband' WHERE id = 'husband'").run();
    raw.prepare("UPDATE members SET zalo_chat_id = 'chat-wife' WHERE id = 'wife'").run();
    expect((await call("GET", "/v1/settings")).json.data.members.find((m) => m.id === "husband")!.zalo_chat_id).toBe("chat-husband");
    expect((await call("PATCH", "/v1/settings/members/husband", { zalo_chat_id: "chat-khac" })).status).toBe(400);
    expect(zaloChat("husband")).toBe("chat-husband");
    const res = await call("PATCH", "/v1/settings/members/husband", { zalo_chat_id: null });
    expect(res.status).toBe(200);
    expect(res.json.data.zalo_chat_id).toBeNull();
    expect(zaloChat("husband")).toBeNull();
    const text = "⚠️ Chồng (qua API token) vừa bỏ nối Zalo của Chồng — nếu không phải người nhà làm, vào Cài đặt gỡ ngay.";
    expect(sent.map((s) => s.body).sort((a, b) => String(a.chat_id).localeCompare(String(b.chat_id)))).toEqual([
      { chat_id: "chat-husband", text },
      { chat_id: "chat-wife", text },
    ]);
    expect(auditRows()).toEqual([{ member_id: "husband", via: "token", action: "member.update", target: "member:husband", detail: '{"fields":["zalo_chat_id"]}' }]);
  });

  it("người đã nối Zalo thì không tạo được mã — phải bỏ nối trước; mã tạo trước khi người đó nối chat khác không đè chat đó", async () => {
    setSecrets();
    raw.prepare("UPDATE members SET zalo_chat_id = 'chat-husband' WHERE id = 'husband'").run();
    const res = await call("POST", "/v1/settings/members/husband/zalo-code");
    expect(res.status).toBe(409);
    expect(res.json.error!.code).toBe("zalo_linked");
    expect(pendingCodes()).toEqual([]);

    const { code } = await createZaloLinkCode(env, "wife", new Date(), ANH);
    raw.prepare("UPDATE members SET zalo_chat_id = 'chat-wife' WHERE id = 'wife'").run(); // nối xong bằng đường khác trong lúc mã còn hạn
    expect(await handleZaloUpdate(env, event("chat-la", code), new Date())).toBe("taken");
    expect(zaloChat("wife")).toBe("chat-wife");
    expect(pendingCodes()).toEqual([]);
    expect(sent.map((s) => s.body.chat_id)).toEqual(["chat-la"]);
    expect(String(sent[0]!.body.text)).toMatch(/bỏ nối Zalo cũ trước/);
  });

  it("một chat nhắn sai mã 5 lần trong 1 giờ thì mã đúng cũng không được nhận; hết giờ thì nối được", async () => {
    setSecrets();
    const now = new Date();
    const { code } = await createZaloLinkCode(env, "wife", now, ANH);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < ZALO_CODE_MAX_FAILURES; i++) expect(await handleZaloUpdate(env, event("stranger", wrong), now)).toBe("help");
    expect(await handleZaloUpdate(env, event("stranger", code), now)).toBe("limited");
    expect(await handleZaloUpdate(env, event("stranger", code), now)).toBe("limited");
    expect(zaloChat("wife")).toBeNull();
    // Trả lời hướng dẫn một lần, báo bị chặn một lần trong ngày.
    expect(sent.map((s) => String(s.body.text).slice(0, 20))).toEqual(["Đây là bot báo tin c", "Đã nhắn sai mã quá n"]);

    const later = new Date(now.getTime() + 60 * 60_000 + 1000);
    const again = await createZaloLinkCode(env, "wife", later, ANH);
    expect(await handleZaloUpdate(env, event("stranger", again.code), later)).toBe("linked");
    expect(zaloChat("wife")).toBe("stranger");
  });
});

describe("gửi tin qua Zalo", () => {
  const message = { full: "⚠️ 1 giao dịch chưa gán:\n+50.000 ₫ — A &amp; B &lt;x&gt;", push: { title: "1 chưa gán", body: "+50.000 ₫ A & B <x>" } };

  it("notifyMembers gửi bản đầy đủ dạng chữ thường cho người đã nối Zalo, chống gửi trùng, đếm vào số đã gửi", async () => {
    setSecrets();
    raw.prepare("UPDATE members SET zalo_chat_id = 'z-husband' WHERE id = 'husband'").run();
    raw.prepare("UPDATE members SET zalo_chat_id = 'z-wife' WHERE id = 'wife'").run();

    expect(await notifyMembers(env, "pending_batch", "2026-10-03T03:00:00.000Z", message)).toBe(2);
    expect(sent.map((s) => s.url)).toEqual([`https://bot-api.zaloplatforms.com/bot${TOKEN}/sendMessage`, `https://bot-api.zaloplatforms.com/bot${TOKEN}/sendMessage`]);
    expect(sent.map((s) => s.body).sort((a, b) => String(a.chat_id).localeCompare(String(b.chat_id)))).toEqual([
      { chat_id: "z-husband", text: "⚠️ 1 giao dịch chưa gán:\n+50.000 ₫ — A & B <x>" },
      { chat_id: "z-wife", text: "⚠️ 1 giao dịch chưa gán:\n+50.000 ₫ — A & B <x>" },
    ]);
    expect(raw.prepare("SELECT chat_id, ok FROM notifications WHERE kind = 'pending_batch' ORDER BY chat_id").all()).toEqual([
      { chat_id: "zalo:z-husband", ok: 1 },
      { chat_id: "zalo:z-wife", ok: 1 },
    ]);

    // Chạy lại cùng (kind, dayKey): không gửi thêm.
    expect(await notifyMembers(env, "pending_batch", "2026-10-03T03:00:00.000Z", message)).toBe(0);
    expect(sent).toHaveLength(2);

    // Hai người nối cùng một chat Zalo: chat đó nhận một tin.
    raw.prepare("UPDATE members SET zalo_chat_id = 'z-husband' WHERE id = 'wife'").run();
    expect(await notifyMembers(env, "weekly", "2026-W40", message)).toBe(1);

    // Chưa đặt bot token: kênh Zalo bỏ qua.
    raw.prepare("DELETE FROM config WHERE k = 'secret:zalo_bot_token'").run();
    expect(await notifyMembers(env, "daily", "2026-10-04", message)).toBe(0);
    expect(sent).toHaveLength(3);
  });

  it("zaloText bỏ thẻ, trả ký tự đã escape, cắt ở 2000 ký tự kèm …", () => {
    expect(zaloText("<b>Đậm</b> Ăn &amp; uống &lt;3 &quot;ok&quot;")).toBe('Đậm Ăn & uống <3 "ok"');
    expect(zaloText("&amp;lt;")).toBe("&lt;");
    expect(zaloText("a".repeat(ZALO_TEXT_MAX))).toBe("a".repeat(ZALO_TEXT_MAX));
    const cut = zaloText("a".repeat(2500));
    expect(cut).toHaveLength(ZALO_TEXT_MAX);
    expect(cut.endsWith("a…")).toBe(true);
    const emoji = zaloText("💰".repeat(1500)); // 3000 đơn vị UTF-16
    expect(emoji.length).toBeLessThanOrEqual(ZALO_TEXT_MAX);
    expect([...emoji].every((ch) => ch === "💰" || ch === "…")).toBe(true); // không cắt đôi emoji
    expect(emoji.endsWith("…")).toBe(true);
  });

  it("Zalo trả 429 thì ghi lỗi, không thử lại", async () => {
    setSecrets();
    raw.prepare("UPDATE members SET zalo_chat_id = 'z-husband' WHERE id = 'husband'").run();
    vi.stubGlobal("fetch", fakeZalo(() => Response.json({ ok: false, error_code: 429, description: "Quota exceeded" }, { status: 429 })));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await notifyMembers(env, "daily", "2026-10-03", message)).toBe(0);
    expect(sent).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith("[zalo] daily 2026-10-03: 429 Quota exceeded");
    expect(raw.prepare("SELECT ok FROM notifications WHERE kind = 'daily' AND chat_id = 'zalo:z-husband'").get()).toEqual({ ok: 0 });
  });
});

describe("cài đặt Zalo", () => {
  it("khoá Zalo không bao giờ trả nguyên văn, chỉ 2 ký tự cuối; khoá webhook chỉ gồm chữ, số, - và _", async () => {
    const put = await call("PUT", "/v1/settings/integrations", { zalo_bot_token: TOKEN, zalo_webhook_secret: SECRET });
    expect(put.status).toBe(200);
    expect(put.json.data.zalo_bot_token).toEqual({ set: true, hint: "3e", source: "app" });
    const { json } = await call("GET", "/v1/settings");
    expect(json.data.integrations.zalo_bot_token).toEqual({ set: true, hint: "3e", source: "app" });
    expect(json.data.integrations.zalo_webhook_secret).toEqual({ set: true, hint: "12", source: "app" });
    expect(json.data.integrations.zalo_webhook_url).toBe("https://app.example.com/webhooks/zalo");
    expect(JSON.stringify(json)).not.toContain(TOKEN);
    expect(JSON.stringify(json)).not.toContain(SECRET);
    // Nhật ký chỉ ghi tên khoá đã đặt/xoá, không bao giờ ghi giá trị.
    expect(auditRows()).toEqual([
      { member_id: "husband", via: "token", action: "integrations.update", target: null, detail: '{"set":["zalo_bot_token","zalo_webhook_secret"],"cleared":[]}' },
    ]);

    expect((await call("PUT", "/v1/settings/integrations", { zalo_webhook_secret: "có dấu cách" })).status).toBe(400);
    expect((await call("PUT", "/v1/settings/integrations", { zalo_webhook_secret: "khoá-có-dấu" })).status).toBe(400);
    expect((await call("PUT", "/v1/settings/integrations", { zalo_webhook_secret: "a".repeat(257) })).status).toBe(400);
    expect((await call("PUT", "/v1/settings/integrations", { zalo_webhook_secret: null })).json.data.zalo_webhook_secret).toEqual({ set: false, hint: null, source: null });

    env = { ...env, ZALO_BOT_TOKEN: "server-zalo-token-7777" };
    await call("PUT", "/v1/settings/integrations", { zalo_bot_token: null });
    expect((await call("GET", "/v1/settings")).json.data.integrations.zalo_bot_token).toEqual({ set: true, hint: "77", source: "server" });
  });

  it("Đặt webhook gọi setWebhook với địa chỉ /webhooks/zalo và khoá webhook; báo lỗi Zalo dễ hiểu", async () => {
    expect((await call("POST", "/v1/settings/zalo/webhook")).json.data).toEqual({ ok: false, url: "https://app.example.com/webhooks/zalo", verified: null, error: "Chưa đặt bot token Zalo." });
    setSecrets();
    vi.stubGlobal(
      "fetch",
      fakeZalo(() => Response.json({ ok: true, result: { url: "https://app.example.com/webhooks/zalo", verification: { ok: true, outcome: "webhook.ok" } } })),
    );
    const { status, json } = await call("POST", "/v1/settings/zalo/webhook");
    expect(status).toBe(200);
    expect(json.data).toEqual({ ok: true, url: "https://app.example.com/webhooks/zalo", verified: true });
    expect(sent).toEqual([{ url: `https://bot-api.zaloplatforms.com/bot${TOKEN}/setWebhook`, body: { url: "https://app.example.com/webhooks/zalo", secret_token: SECRET } }]);

    const limited = fakeZalo(() => Response.json({ ok: false, errorCode: 426, description: "Too many setWebhook calls" }));
    expect((await setZaloWebhook(env, "https://app.example.com", limited)).error).toMatch(/quá số lần/);
    const badToken = fakeZalo(() => Response.json({ ok: false, error_code: 401, description: "Unauthorized" }, { status: 401 }));
    expect((await setZaloWebhook(env, "https://app.example.com", badToken)).error).toMatch(/token Zalo sai/);
    const unverified = fakeZalo(() => Response.json({ ok: true, result: { verification: { ok: false, outcome: "webhook.err.unreachable" } } }));
    expect(await setZaloWebhook(env, "https://app.example.com", unverified)).toMatchObject({ ok: true, verified: false, error: expect.stringMatching(/webhook\.err\.unreachable/) });
  });

  it("gửi thử Zalo: báo khi chưa nối, chưa có token, hoặc gửi được", async () => {
    const okFetch = fakeZalo();
    expect(await testZalo(env, "husband", okFetch)).toEqual({ sent: false, error: "Người này chưa nối Zalo." });
    raw.prepare("UPDATE members SET zalo_chat_id = 'z-husband' WHERE id = 'husband'").run();
    expect((await testZalo(env, "husband", okFetch)).error).toMatch(/bot token/);
    setSecrets();
    expect(await testZalo(env, "husband", okFetch)).toEqual({ sent: true });
    expect(sent.at(-1)!.body).toEqual({ chat_id: "z-husband", text: "✅ Ví nhà đã nối Zalo cho Chồng." });
    const res = await call("POST", "/v1/settings/test/zalo", { member_id: "husband" });
    expect(res.json.data).toEqual({ sent: true });
  });
});
