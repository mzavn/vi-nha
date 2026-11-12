import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { notifyMembers } from "../src/notify/telegram";
import { testSepay, testTelegram, updateAccount } from "../src/services/settings";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { client, householdP } from "./helpers/household-p";
import { householdShared, SHARED_NOW, sharedTx } from "./helpers/household-shared";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.unstubAllGlobals());

type Json = { ok: boolean; data: any; error?: { code: string; message: string; field?: string } };
async function call(method: string, path: string, body?: unknown, auth = true, headers: Record<string, string> = {}) {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: { ...(auth ? { Authorization: "Bearer tok" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json };
}
const as = (member: string) => ({ "X-Member-Id": member });

describe("đọc cài đặt", () => {
  it("cần đăng nhập", async () => {
    expect((await call("GET", "/v1/settings", undefined, false)).status).toBe(401);
  });

  it("UC-505 AC-1: trả đúng mười một phần, kèm URL webhook để dán vào SePay", async () => {
    const { json } = await call("GET", "/v1/settings");
    expect(Object.keys(json.data).sort()).toEqual(["accounts", "categories", "categoryGroups", "config", "goal_groups", "goals", "incomeStreams", "integrations", "members", "notifySchedule", "rules"]);
    expect(json.data.integrations.webhook_url).toBe("https://app.example.com/webhooks/sepay");
    expect(json.data.config).toMatchObject({ salary_min_amount: 1_000_000, safety_fund_months: 6, fi_swr_bps: 350, fi_safety_months: "6,12,24", fi_birth_year: null });
    expect(json.data.notifySchedule).toEqual({
      dailyTime: "07:00",
      weeklyDay: 1,
      weeklyTime: "08:00",
      quietStart: "22:00",
      quietEnd: "06:30",
      dailyEnabled: true,
      weeklyEnabled: true,
      pendingEnabled: true,
    });
  });

  it("UC-505 AC-16: hộ mẫu sau 0040 → có opens_cycle, private, surplus_* (gồm surplus_reward_account); không có wallets, allocations, locks, month_close_*", async () => {
    const { data } = (await call("GET", "/v1/settings")).json;
    expect(data).not.toHaveProperty("wallets");
    expect(data).not.toHaveProperty("allocations");
    expect(data.incomeStreams.map((s: any) => [s.id, s.opens_cycle, "locks" in s])).toEqual([
      ["salary-husband", true, false],
      ["salary-wife", false, false],
      ["rental", false, false],
    ]);
    expect(data.accounts.every((a: any) => a.private === false)).toBe(true);
    expect(data.config).toMatchObject({ surplus_savings_pct: 50, surplus_reward_account: "mb-reward" });
    expect(data.config).not.toHaveProperty("surplus_reward_earmark");
    expect(Object.keys(data.config).filter((k) => k.startsWith("month_close_"))).toEqual([]);
    expect(data.categories.every((c: any) => !("defaultWalletId" in c) && !("default_wallet_id" in c))).toBe(true);
  });

  it("UC-505 AC-17: hộ mẫu sau 0040 → không wallets / allocations / earmarks; nguồn thu không locks; tài khoản không spendable / locked / role, có pocket, pocket_confirmed, private; có goals[] và config.surplus_reward_account", async () => {
    const { data } = (await call("GET", "/v1/settings")).json;
    for (const k of ["wallets", "allocations", "earmarks"]) expect(data).not.toHaveProperty(k);
    expect(data.incomeStreams.length).toBeGreaterThan(0);
    expect(data.incomeStreams.every((s: any) => !("locks" in s))).toBe(true);
    for (const a of data.accounts) {
      for (const k of ["spendable", "locked", "role"]) expect(a, a.id).not.toHaveProperty(k);
      for (const k of ["pocket", "pocket_confirmed", "private"]) expect(a, a.id).toHaveProperty(k);
    }
    expect(data.goals.map((g: any) => g.id)).toEqual(["tuition", "car-service", "income-tax"]);
    expect(data.config.surplus_reward_account).toBe("mb-reward");
  });
});

describe("khoá kết nối SePay / Telegram", () => {
  const KEY = "sepay-webhook-key-0000ab12";
  type Settings = { integrations: { sepay_connections: { id: string; webhook_key: unknown }[] } };
  const chinh = (data: Settings) => data.integrations.sepay_connections.find((c) => c.id === "default");

  it("đặt từ màn Cài đặt: chỉ trả lại 2 ký tự cuối, không bao giờ trả nguyên khoá", async () => {
    const patched = await call("PATCH", "/v1/settings/sepay/connections/default", { webhook_key: KEY });
    expect(patched.json.data.webhook_key).toEqual({ set: true, hint: "12", source: "app" });
    await call("PUT", "/v1/settings/integrations", { telegram_bot_token: "123456:telegram-token-zz99" });
    const get = await call("GET", "/v1/settings");
    expect(JSON.stringify(get.json)).not.toContain(KEY);
    expect(get.json.data.integrations.telegram_bot_token).toEqual({ set: true, hint: "99", source: "app" });
    expect(chinh(get.json.data)).toEqual({
      id: "default",
      name: "SePay chính",
      active: true,
      api_token: { set: false, hint: null, source: null },
      webhook_key: { set: true, hint: "12", source: "app" },
      accounts: ["mb-husband", "tcb-husband", "vcb-husband", "vcb-wife"],
    });
  });

  it("webhook dùng đúng khoá đặt ở màn Cài đặt; xoá khoá thì webhook khoá lại", async () => {
    await call("PATCH", "/v1/settings/sepay/connections/default", { webhook_key: KEY });
    const post = (key: string) =>
      app.request("/webhooks/sepay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Apikey ${key}` }, body: "{}" }, env);
    expect((await post(KEY)).status).toBe(200);
    expect((await post("sai-khoa-hoan-toan")).status).toBe(401);
    await call("PATCH", "/v1/settings/sepay/connections/default", { webhook_key: null });
    expect((await post(KEY)).status).toBe(401);
  });

  it("khoá đặt bằng wrangler secret vẫn dùng được khi màn Cài đặt để trống", async () => {
    env = { ...env, SEPAY_API_KEY: "tu-wrangler-secret-9876" } as Env;
    const { json } = await call("GET", "/v1/settings");
    expect(chinh(json.data)?.webhook_key).toEqual({ set: true, hint: "76", source: "server" });
  });

  it("thêm kết nối SePay thứ hai với token và khoá riêng, không bao giờ trả nguyên khoá; đổi tên, tạm tắt được; khoá webhook trùng kết nối khác bị chặn", async () => {
    const created = await call("POST", "/v1/settings/sepay/connections", { id: "sepay-wife", name: "SePay của vợ", api_token: "wife-api-token-7777", webhook_key: "wife-webhook-key-0000-8888" });
    expect(created.status).toBe(201);
    expect(created.json.data).toEqual({
      id: "sepay-wife",
      name: "SePay của vợ",
      active: true,
      api_token: { set: true, hint: "77", source: "app" },
      webhook_key: { set: true, hint: "88", source: "app" },
      accounts: [],
    });
    expect((await call("POST", "/v1/settings/sepay/connections", { id: "sepay-wife", name: "SePay của vợ" })).status).toBe(409);
    const clash = await call("PATCH", "/v1/settings/sepay/connections/default", { webhook_key: "wife-webhook-key-0000-8888" });
    expect(clash.status).toBe(409);
    expect(clash.json.error?.code).toBe("duplicate_key");
    expect((await call("PATCH", "/v1/settings/sepay/connections/sepay-wife", { webhook_key: "ngan" })).status).toBe(400);
    const renamed = await call("PATCH", "/v1/settings/sepay/connections/sepay-wife", { name: "SePay vợ", active: false, api_token: null });
    expect(renamed.json.data).toMatchObject({ name: "SePay vợ", active: false, api_token: { set: false, hint: null, source: null } });
    const get = await call("GET", "/v1/settings");
    expect(JSON.stringify(get.json)).not.toContain("wife-webhook-key-0000-8888");
    expect((get.json.data as Settings).integrations.sepay_connections.map((c) => c.id)).toEqual(["default", "sepay-wife"]);
    expect((await call("PATCH", "/v1/settings/sepay/connections/khong-co", { name: "x" })).status).toBe(404);
  });

  it("khoá quá ngắn bị từ chối", async () => {
    expect((await call("PUT", "/v1/settings/integrations", { telegram_bot_token: "abc" })).status).toBe(400);
  });

  it("khoá webhook SePay mới cần ít nhất 24 ký tự; khoá ngắn đã lưu từ trước vẫn nhận webhook (ADR-89)", async () => {
    const short = await call("PATCH", "/v1/settings/sepay/connections/default", { webhook_key: "k".repeat(23) });
    expect(short.status).toBe(400);
    expect(short.json.error?.message).toContain("ít nhất 24 ký tự");
    expect((await call("POST", "/v1/settings/sepay/connections", { id: "sepay-wife", name: "SePay của vợ", webhook_key: "wife-khoa-ngan-1234" })).status).toBe(400);
    expect((await call("PATCH", "/v1/settings/sepay/connections/default", { webhook_key: "k".repeat(24) })).status).toBe(200);
    raw.prepare("UPDATE sepay_connections SET webhook_key = 'khoa-cu-5678' WHERE id = 'default'").run();
    const res = await app.request("/webhooks/sepay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Apikey khoa-cu-5678" }, body: "{}" }, env);
    expect(res.status).toBe(200);
  });

  it("tin Telegram dùng bot token đặt ở màn Cài đặt", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    raw.prepare("UPDATE members SET tg_chat_id = '111' WHERE id = 'husband'").run();
    await call("PUT", "/v1/settings/integrations", { telegram_bot_token: "123456:telegram-token-zz99" });
    await notifyMembers(env, "daily", "2026-09-22", { full: "xin chào", push: { title: "Xin chào", body: "xin chào" } });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/bot123456:telegram-token-zz99/sendMessage");
  });

  it("gửi thử Telegram: báo rõ khi thiếu chat_id, thiếu token, hoặc gửi được", async () => {
    const okFetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await testTelegram(env, "husband", okFetch)).toEqual({ sent: false, error: "Chưa có chat_id Telegram của người này." });
    raw.prepare("UPDATE members SET tg_chat_id = '111' WHERE id = 'husband'").run();
    expect((await testTelegram(env, "husband", okFetch)).error).toMatch(/bot token/);
    await call("PUT", "/v1/settings/integrations", { telegram_bot_token: "123456:telegram-token-zz99" });
    expect(await testTelegram(env, "husband", okFetch)).toEqual({ sent: true });
  });

  it("kiểm tra một kết nối SePay (API v2): liệt kê tài khoản SePay đang nối; tài khoản có trong SePay thì đếm giao dịch 7 ngày; chưa nối thì báo; token sai thì báo", async () => {
    await call("PATCH", "/v1/settings/sepay/connections/default", { api_token: "sepay-api-token-1234" });
    const urls: string[] = [];
    const okFetch = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      urls.push(u.pathname);
      const data =
        u.pathname === "/v2/bank-accounts"
          ? [{ id: "b-1", account_number: "0011xxxxxxx", bank_short_name: "MBBank", label: "Chồng" }]
          : [{ id: "t-1", account_number: "0011xxxxxxx" }, { id: "t-2", account_number: "0011xxxxxxx" }, { id: "t-3", account_number: "other" }];
      return new Response(JSON.stringify({ status: "success", data, meta: { pagination: { has_more: false } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await testSepay(env, "default", new Date("2026-09-22T03:00:00Z"), okFetch);
    expect(urls).toEqual(["/v2/bank-accounts", "/v2/transactions"]);
    expect(result.linked).toEqual([{ account_number: "0011xxxxxxx", bank: "MBBank", label: "Chồng" }]);
    expect(result.accounts.find((a) => a.id === "vcb-husband")).toEqual({ id: "vcb-husband", name: "VCB (chính)", transactions: 2 });
    expect(result.accounts.find((a) => a.id === "tcb-husband")).toMatchObject({ error: "SePay chưa nối số tài khoản này." });
    expect(result.ok).toBe(false);
    const badFetch = vi.fn(async () => new Response(JSON.stringify({ status: "error", error_code: "unauthorized" }), { status: 401 })) as unknown as typeof fetch;
    const bad = await testSepay(env, "default", new Date("2026-09-22T03:00:00Z"), badFetch);
    expect(bad.ok).toBe(false);
    expect(bad.accounts[0]!.error).toBe("Token không hợp lệ.");
  });
});

describe("tài khoản", () => {
  it("thêm tài khoản MB có SePay; bật SePay mà thiếu số tài khoản thì từ chối; trùng số tài khoản thì từ chối", async () => {
    const created = await call("POST", "/v1/settings/accounts", { name: "MB (vợ)", kind: "bank", bank: "MBBank", account_no: "0987654321", sepay_enabled: true, owner_member_id: "wife" });
    expect(created.status).toBe(201);
    expect(created.json.data).toMatchObject({ id: "mb-vo", bank: "MBBank", sepay_enabled: true, sepay_out: false, active: true });
    expect((await call("POST", "/v1/settings/accounts", { name: "BIDV", kind: "bank", sepay_enabled: true })).json.error?.code).toBe("missing_account_no");
    expect((await call("POST", "/v1/settings/accounts", { name: "Trùng", account_no: "0987654321" })).status).toBe(409);
  });

  it("sửa số tài khoản mẫu thành số thật", async () => {
    const res = await call("PATCH", "/v1/settings/accounts/vcb-husband", { account_no: "1234567890", name: "MB (chồng)" });
    expect(res.json.data).toMatchObject({ account_no: "1234567890", name: "MB (chồng)" });
  });

  it("UC-506 AC-31: tài khoản gắn Học phí — spendable / role trong thân sửa, role khi thêm → 400 model_changed, không đổi gì; đổi tên → lưu; đổi sang Tích luỹ → 409 account_has_goal", async () => {
    const before = raw.prepare("SELECT * FROM accounts ORDER BY id").all();
    for (const [method, path, body, field] of [
      ["PATCH", "/v1/settings/accounts/mb-tuition", { spendable: true }, "spendable"],
      ["PATCH", "/v1/settings/accounts/mb-tuition", { role: null }, "role"],
      ["PATCH", "/v1/settings/accounts/mb-tuition", { name: "Sổ", locked: false }, "locked"],
      ["POST", "/v1/settings/accounts", { name: "Sổ 6 tháng", role: "term_deposit" }, "role"],
    ] as const) {
      const res = await call(method, path, body);
      expect([res.status, res.json.error?.code, (res.json.error as { fields?: string[] } | undefined)?.fields], JSON.stringify(body)).toEqual([400, "model_changed", [field]]);
      expect(res.json.error?.message).toBe(`Ví nhà v2 xếp tài khoản theo ngăn: bỏ trường ${field}.`);
    }
    expect(raw.prepare("SELECT * FROM accounts ORDER BY id").all()).toEqual(before);
    expect((await call("PATCH", "/v1/settings/accounts/mb-tuition", { name: "Sổ học phí" })).json.data).toMatchObject({ name: "Sổ học phí", pocket: "reserve" });
    const moved = await call("PATCH", "/v1/settings/accounts/mb-tuition", { pocket: "savings" });
    expect([moved.status, moved.json.error?.code]).toEqual([409, "account_has_goal"]);
    expect(raw.prepare("SELECT pocket FROM accounts WHERE id = 'mb-tuition'").get()).toEqual({ pocket: "reserve" });
  });

  it("UC-504 AC-8: chủ tài khoản bật / tắt riêng tư → lưu, nhật ký account.update changes.private; người khác → 403 not_owner; tài khoản không chủ → 400 private_needs_owner; tài khoản mới mặc định tắt", async () => {
    const on = await call("PATCH", "/v1/settings/accounts/vcb-wife", { private: true }, true, as("wife"));
    expect([on.status, on.json.data?.private]).toEqual([200, true]);
    const audit = raw.prepare("SELECT member_id, detail FROM audit_log WHERE action = 'account.update' ORDER BY id DESC LIMIT 1").get() as { member_id: string; detail: string };
    expect(audit.member_id).toBe("wife");
    expect(JSON.parse(audit.detail)).toEqual({ fields: ["private"], changes: { private: { from: false, to: true } } });
    const husband = await call("PATCH", "/v1/settings/accounts/vcb-wife", { private: false }, true, as("husband"));
    expect([husband.status, husband.json.error?.code]).toEqual([403, "not_owner"]);
    // Gửi lại đúng giá trị đang có (lưu sheet) thì không phải đổi: người khác vẫn sửa được tên.
    expect((await call("PATCH", "/v1/settings/accounts/vcb-wife", { private: true, name: "VCB vợ" }, true, as("husband"))).status).toBe(200);
    expect(raw.prepare("SELECT private FROM accounts WHERE id = 'vcb-wife'").get()).toEqual({ private: 1 });
    const off = await call("PATCH", "/v1/settings/accounts/vcb-wife", { private: false }, true, as("wife"));
    expect([off.status, off.json.data?.private]).toEqual([200, false]);
    raw.prepare("UPDATE accounts SET owner_member_id = NULL WHERE id = 'cash-wife'").run();
    const shared = await call("PATCH", "/v1/settings/accounts/cash-wife", { private: true }, true, as("wife"));
    expect([shared.status, shared.json.error?.code]).toEqual([400, "private_needs_owner"]);
    expect((await call("PATCH", "/v1/settings/accounts/vcb-wife", { private: "yes" }, true, as("wife"))).json.error?.code).toBe("invalid_input");
    const created = await call("POST", "/v1/settings/accounts", { name: "MoMo vợ", kind: "ewallet", bank: "MoMo", owner_member_id: "wife", private: true });
    expect(created.json.data).toMatchObject({ private: false });
  });

  it("UC-504 AC-10: chỉ chủ đổi chủ tài khoản riêng tư — chồng → 403 not_owner, không nhật ký; vợ đổi được, nhật ký changes.owner_member_id; tài khoản công khai ghi cũ → mới; chủ đã tắt thì người khác đổi được", async () => {
    const db = householdP();
    const api = client(db);
    const ownerOf = (id: string) => (db.prepare("SELECT owner_member_id AS o FROM accounts WHERE id = ?").get(id) as { o: string }).o;
    const updates = () =>
      (db.prepare("SELECT member_id, target, detail FROM audit_log WHERE action = 'account.update' ORDER BY id").all() as { member_id: string; target: string; detail: string }[]).map((r) => ({
        ...r,
        detail: JSON.parse(r.detail),
      }));
    for (const body of [{ owner_member_id: "husband" }, { owner_member_id: "husband", private: false }]) {
      const r = await api("PATCH", "/v1/settings/accounts/vcb-wife", body, "husband");
      expect([r.status, r.json.error?.code], JSON.stringify(body)).toEqual([403, "not_owner"]);
    }
    expect(ownerOf("vcb-wife")).toBe("wife");
    expect(db.prepare("SELECT private FROM accounts WHERE id = 'vcb-wife'").get()).toEqual({ private: 1 });
    expect(updates()).toEqual([]);

    const moved = await api("PATCH", "/v1/settings/accounts/vcb-wife", { owner_member_id: "husband" }, "wife");
    expect([moved.status, moved.json.data?.owner_member_id, moved.json.data?.private]).toEqual([200, "husband", true]);
    const pub = await api("PATCH", "/v1/settings/accounts/cash-husband", { owner_member_id: "wife" }, "wife");
    expect([pub.status, pub.json.data?.owner_member_id]).toEqual([200, "wife"]);
    expect(updates()).toEqual([
      { member_id: "wife", target: "account:vcb-wife", detail: { fields: ["owner_member_id"], changes: { owner_member_id: { from: "wife", to: "husband" } } } },
      { member_id: "wife", target: "account:cash-husband", detail: { fields: ["owner_member_id"], changes: { owner_member_id: { from: "husband", to: "wife" } } } },
    ]);

    // Chủ đã tắt (ADR-96): tài khoản không còn bị giấu, người khác đổi được chủ.
    db.exec("UPDATE members SET active = 0 WHERE id = 'husband'");
    const back = await api("PATCH", "/v1/settings/accounts/vcb-wife", { owner_member_id: "wife" }, "wife");
    expect([back.status, back.json.data?.owner_member_id]).toEqual([200, "wife"]);
    expect(updates().at(-1)).toEqual({
      member_id: "wife",
      target: "account:vcb-wife",
      detail: { fields: ["owner_member_id"], changes: { owner_member_id: { from: "husband", to: "wife" } } },
    });
  });

  it("ngân hàng phải chọn trong danh mục; SePay chỉ bật được cho ngân hàng SePay hỗ trợ", async () => {
    const unknown = await call("POST", "/v1/settings/accounts", { name: "Lạ", kind: "bank", bank: "MB" });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error?.code).toBe("invalid_bank");
    const vcb = await call("POST", "/v1/settings/accounts", { name: "VCB mới", kind: "bank", bank: "Vietcombank", account_no: "999", sepay_enabled: true });
    expect(vcb.status).toBe(400);
    expect(vcb.json.error).toMatchObject({ code: "bank_not_supported", message: "SePay chưa hỗ trợ ngân hàng này." });
    // ví điện tử vẫn ghi tên nhà cung cấp tự do
    expect((await call("POST", "/v1/settings/accounts", { name: "MoMo", kind: "ewallet", bank: "MoMo" })).status).toBe(201);
    // đổi sang ngân hàng không có SePay trong khi đang nối SePay cũng bị chặn
    await call("POST", "/v1/settings/accounts", { name: "Sacom", kind: "bank", bank: "Sacombank", account_no: "555", sepay_enabled: true });
    expect((await call("PATCH", "/v1/settings/accounts/sacom", { bank: "Techcombank" })).json.error?.code).toBe("bank_not_supported");
  });

  it("SePay báo cả tiền ra: mặc định theo tài liệu SePay (MB chỉ tiền vào, Sacombank cả ra), chủ nhà bật tay được, tắt SePay thì về tắt", async () => {
    const mb = await call("POST", "/v1/settings/accounts", { name: "MB", kind: "bank", bank: "MBBank", account_no: "111", sepay_enabled: true });
    expect(mb.json.data).toMatchObject({ sepay_enabled: true, sepay_out: false });
    const sacom = await call("POST", "/v1/settings/accounts", { name: "Sacom", kind: "bank", bank: "Sacombank", account_no: "222", sepay_enabled: true });
    expect(sacom.json.data).toMatchObject({ sepay_enabled: true, sepay_out: true });
    // chủ nhà đã thử thấy tiền ra của MB về app → bật tay dù tài liệu nói không
    expect((await call("PATCH", "/v1/settings/accounts/mb", { sepay_out: true })).json.data).toMatchObject({ sepay_out: true });
    expect((await call("PATCH", "/v1/settings/accounts/mb", { name: "MB (chồng)" })).json.data).toMatchObject({ sepay_out: true });
    expect((await call("PATCH", "/v1/settings/accounts/mb", { sepay_enabled: false, sepay_out: true })).json.data).toMatchObject({ sepay_enabled: false, sepay_out: false });
    // bật lại SePay → lấy lại mặc định theo tài liệu
    expect((await call("PATCH", "/v1/settings/accounts/mb", { sepay_enabled: true })).json.data).toMatchObject({ sepay_enabled: true, sepay_out: false });
    const refs = await call("GET", "/v1/bootstrap");
    expect(refs.json.data.accounts.find((a: { id: string }) => a.id === "sacom")).toMatchObject({ sepayEnabled: true, sepayOut: true });
  });

  it("tài khoản bật SePay thuộc một kết nối: không chọn thì về kết nối mặc định, chọn được kết nối khác; kết nối lạ hay đang tắt bị từ chối; tắt SePay thì bỏ", async () => {
    await call("POST", "/v1/settings/sepay/connections", { id: "sepay-wife", name: "SePay của vợ" });
    const mb = await call("POST", "/v1/settings/accounts", { id: "mb-wife", name: "MB vợ", kind: "bank", bank: "MBBank", account_no: "0123", sepay_enabled: true });
    expect(mb.json.data).toMatchObject({ sepay_connection_id: "default" });
    expect((await call("PATCH", "/v1/settings/accounts/mb-wife", { sepay_connection_id: "sepay-wife" })).json.data).toMatchObject({ sepay_connection_id: "sepay-wife" });
    expect((await call("PATCH", "/v1/settings/accounts/mb-wife", { sepay_connection_id: "khong-co" })).json.error?.code).toBe("unknown_connection");
    await call("PATCH", "/v1/settings/sepay/connections/default", { active: false });
    expect((await call("PATCH", "/v1/settings/accounts/mb-wife", { sepay_connection_id: "default" })).json.error?.code).toBe("unknown_connection");
    // tài khoản cũ của kết nối đang tắt vẫn sửa được tên
    expect((await call("PATCH", "/v1/settings/accounts/vcb-husband", { name: "VCB" })).json.data).toMatchObject({ name: "VCB", sepay_connection_id: "default" });
    expect((await call("PATCH", "/v1/settings/accounts/mb-wife", { sepay_enabled: false })).json.data).toMatchObject({ sepay_enabled: false, sepay_connection_id: null });
    expect((await call("POST", "/v1/settings/accounts", { name: "Tiền mặt 2", kind: "cash" })).json.data).toMatchObject({ sepay_connection_id: null });
  });

  it("tài khoản chung của nhà (bỏ chủ, vd ví tiền mặt chung) lưu được; chủ không có thật thì từ chối", async () => {
    const res = await call("PATCH", "/v1/settings/accounts/cash-wife", { owner_member_id: null, name: "Tiền mặt" });
    expect(res.json.data).toMatchObject({ owner_member_id: null, name: "Tiền mặt" });
    expect((await call("PATCH", "/v1/settings/accounts/cash-wife", { owner_member_id: "khong-co" })).json.error?.code).toBe("unknown_member");
  });

  it("ngày mở sổ phải là ngày có thật dạng YYYY-MM-DD (là mốc so ngày giao dịch, ADR-76); bỏ trống thì không có mốc", async () => {
    for (const bad of ["1/10/2026", "2026-02-30"]) {
      expect((await call("PATCH", "/v1/settings/accounts/vcb-husband", { opened_at: bad })).json.error?.code).toBe("invalid_input");
    }
    expect((await call("PATCH", "/v1/settings/accounts/vcb-husband", { opened_at: "2026-10-01" })).json.data.opened_at).toBe("2026-10-01");
    expect((await call("PATCH", "/v1/settings/accounts/vcb-husband", { opened_at: null })).json.data.opened_at).toBeNull();
  });
});

describe("ví & luật nạp đã bỏ (ADR-123)", () => {
  it("UC-506 AC-29: POST / PATCH /v1/settings/wallets → 410 model_changed, không ghi gì", async () => {
    for (const [method, path, body] of [
      ["POST", "/v1/settings/wallets", { name: "Bảo hiểm", tier: "must", kind: "accrual" }],
      ["PATCH", "/v1/settings/wallets/food", { allocation: { amount: 700_000 } }],
    ] as const) {
      const res = await call(method, path, body);
      expect([res.status, res.json.ok, res.json.error?.code], path).toEqual([410, false, "model_changed"]);
    }
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name IN ('wallets', 'allocations')").all()).toEqual([]);
  });
});

describe("thành viên, mã chuyển khoản, tham số", () => {
  it("chat_id Telegram phải là dãy số", async () => {
    expect((await call("PATCH", "/v1/settings/members/wife", { tg_chat_id: "@vo" })).status).toBe(400);
    expect((await call("PATCH", "/v1/settings/members/wife", { tg_chat_id: "987654321" })).json.data.tg_chat_id).toBe("987654321");
  });

  it("sửa mã chuyển khoản; mã tự gán thu nhập phải là mẫu lương (luật 6); ví mặc định → 400 model_changed", async () => {
    const rule = raw.prepare("SELECT id FROM rules WHERE pattern = 'EAN'").get() as { id: number };
    const res = await call("PATCH", `/v1/settings/rules/${rule.id}`, { pattern: "ean", priority: 5 });
    expect(res.json.data).toMatchObject({ pattern: "EAN", priority: 5 });
    expect((await call("PATCH", `/v1/settings/rules/${rule.id}`, { meaning: "income" })).json.error?.code).toBe("income_needs_salary");
    const wallet = await call("PATCH", `/v1/settings/rules/${rule.id}`, { wallet_id: "food", priority: 7 });
    expect([wallet.status, wallet.json.error?.code]).toEqual([400, "model_changed"]);
    expect(raw.prepare("SELECT priority FROM rules WHERE id = ?").get(rule.id)).toEqual({ priority: 5 });
  });

  it("ngưỡng lương và số tháng phao", async () => {
    const res = await call("PUT", "/v1/settings/config", { salary_min_amount: 0, safety_fund_months: 3 });
    expect(res.json.data).toMatchObject({ salary_min_amount: 0, safety_fund_months: 3 });
    expect((await call("PUT", "/v1/settings/config", { safety_fund_months: 0 })).status).toBe(400);
    // Khoá cũ emergency_months bị bỏ qua như trường lạ (0028 đổi tên).
    expect((await call("PUT", "/v1/settings/config", { emergency_months: 12 })).json.data).toMatchObject({ salary_min_amount: 0, safety_fund_months: 3 });
    expect((await call("GET", "/v1/settings")).json.data.config).toMatchObject({ salary_min_amount: 0, safety_fund_months: 3 });
  });

  it("UC-507 AC-22: surplus_savings_pct 0–100 nguyên; surplus_reward_account theo UC-1209 AC-4; surplus_reward_earmark / month_close_* → 400 model_changed; nhật ký ghi giá trị", async () => {
    for (const v of [101, -1, 2.5, "50", null]) {
      const res = await call("PUT", "/v1/settings/config", { surplus_savings_pct: v });
      expect([res.status, res.json.error?.code, res.json.error?.field], String(v)).toEqual([400, "invalid_input", "surplus_savings_pct"]);
    }
    expect((await call("PUT", "/v1/settings/config", { surplus_savings_pct: 0 })).json.data).toMatchObject({ surplus_savings_pct: 0 });
    expect((await call("PUT", "/v1/settings/config", { surplus_savings_pct: 100 })).json.data).toMatchObject({ surplus_savings_pct: 100 });

    // Tài khoản Dự phòng không gắn mục tiêu, đang dùng → được; gắn mục tiêu / Vận hành / đã tắt → 400 invalid_account.
    raw.exec("INSERT INTO accounts (id, name, kind, pocket, pocket_confirmed) VALUES ('phao', 'Phao', 'bank', 'reserve', 1), ('cu', 'Cũ', 'bank', 'reserve', 1)");
    raw.exec("UPDATE accounts SET active = 0 WHERE id = 'cu'");
    const saved = await call("PUT", "/v1/settings/config", { surplus_reward_account: "phao" });
    expect([saved.status, saved.json.data?.surplus_reward_account]).toEqual([200, "phao"]);
    for (const id of ["mb-tuition", "vcb-husband", "cu", "khong-co", 5]) {
      const res = await call("PUT", "/v1/settings/config", { surplus_reward_account: id });
      expect([res.status, res.json.error?.code, res.json.error?.field], String(id)).toEqual([400, "invalid_account", "surplus_reward_account"]);
    }
    expect((await call("GET", "/v1/settings")).json.data.config).toMatchObject({ surplus_savings_pct: 100, surplus_reward_account: "phao" });
    expect((await call("PUT", "/v1/settings/config", { surplus_reward_account: null })).json.data).toMatchObject({ surplus_reward_account: null });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM config WHERE k = 'surplus_reward_account'").get()).toEqual({ n: 0 });

    await call("PUT", "/v1/settings/config", { surplus_reward_account: "mb-reward", surplus_savings_pct: 40 });
    const row = raw.prepare("SELECT detail FROM audit_log WHERE action = 'config.update' ORDER BY id DESC LIMIT 1").get();
    expect(JSON.parse(String(row?.detail))).toEqual({ fields: ["surplus_reward_account", "surplus_savings_pct"], surplus_reward_account: "mb-reward", surplus_savings_pct: 40 });

    for (const body of [{ surplus_reward_earmark: "tuition" }, { surplus_reward_earmark: null, salary_min_amount: 5 }, { month_close_wealth_pct: 50 }, { month_close_reward_wallet: "travel" }, { month_close_reward_wallet: null, salary_min_amount: 5 }]) {
      const res = await call("PUT", "/v1/settings/config", body);
      expect([res.status, res.json.error?.code], JSON.stringify(body)).toEqual([400, "model_changed"]);
    }
    expect(raw.prepare("SELECT COUNT(*) AS n FROM config WHERE k LIKE 'month_close_%' OR k = 'surplus_reward_earmark'").get()).toEqual({ n: 0 });
    expect((await call("GET", "/v1/settings")).json.data.config).toMatchObject({ salary_min_amount: 1_000_000, surplus_savings_pct: 40, surplus_reward_account: "mb-reward" });
  });
});

describe("giờ nhắc (cả nhà)", () => {
  it("PATCH chỉ đổi trường có gửi, GET sau đó thấy giá trị mới", async () => {
    const res = await call("PATCH", "/v1/settings/notify-schedule", { daily_time: "06:30", weekly_day: 7, pending_enabled: false });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ dailyTime: "06:30", weeklyDay: 7, weeklyTime: "08:00", pendingEnabled: false, dailyEnabled: true });
    expect((await call("GET", "/v1/settings")).json.data.notifySchedule).toEqual(res.json.data);
  });

  it("từ chối giờ sai dạng, phút không chia hết cho 15, thứ ngoài 1–7, bật/tắt không phải boolean — không ghi gì", async () => {
    const bad = [
      [{ daily_time: "7:00" }, "daily_time"],
      [{ weekly_time: "24:00" }, "weekly_time"],
      [{ quiet_start: "22:03" }, "quiet_start"],
      [{ daily_time: "07:05" }, "Giờ phải chia hết cho 15 phút."],
      [{ quiet_end: 630 }, "quiet_end"],
      [{ weekly_day: 0 }, "weekly_day"],
      [{ weekly_day: 8 }, "weekly_day"],
      [{ weekly_day: "1" }, "weekly_day"],
      [{ daily_enabled: "1" }, "daily_enabled"],
      [{ daily_time: "06:00", weekly_enabled: 0 }, "weekly_enabled"],
    ] as const;
    for (const [body, field] of bad) {
      const res = await call("PATCH", "/v1/settings/notify-schedule", body);
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("invalid_input");
      expect(res.json.error?.message).toContain(field);
    }
    expect((await call("GET", "/v1/settings")).json.data.notifySchedule.dailyTime).toBe("07:00");
  });

  it("giờ bội số 15 phút được nhận, kể cả trong 01:00–04:00", async () => {
    const res = await call("PATCH", "/v1/settings/notify-schedule", { daily_time: "01:45", weekly_time: "23:45", quiet_start: "00:15", quiet_end: "05:00" });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ dailyTime: "01:45", weeklyTime: "23:45", quietStart: "00:15", quietEnd: "05:00" });
  });
});

describe("nguồn thu", () => {
  it("thêm / sửa nguồn; không có thì 404", async () => {
    const created = await call("POST", "/v1/settings/income-streams", { name: "Thưởng" });
    expect(created.status).toBe(201);
    expect(created.json.data).toEqual({ id: "thuong", name: "Thưởng", sort: 100, active: true, pocket: null, opens_cycle: false });
    const patched = await call("PATCH", "/v1/settings/income-streams/thuong", { name: "Thưởng Tết", active: false });
    expect(patched.json.data).toEqual({ id: "thuong", name: "Thưởng Tết", sort: 100, active: false, pocket: null, opens_cycle: false });
    expect((await call("PATCH", "/v1/settings/income-streams/khong-co", { name: "X" })).status).toBe(404);
  });

  it("UC-506 AC-29: PATCH nguồn Lương { opens_cycle: false } → lưu; locks trong thân → 400 model_changed, không ghi gì; opens_cycle không phải boolean → 400 invalid_input", async () => {
    const off = await call("PATCH", "/v1/settings/income-streams/salary-husband", { opens_cycle: false });
    expect([off.status, off.json.data?.opens_cycle]).toEqual([200, false]);
    expect(raw.prepare("SELECT opens_cycle FROM income_streams WHERE id = 'salary-husband'").get()).toEqual({ opens_cycle: 0 });
    const locks = await call("PATCH", "/v1/settings/income-streams/salary-husband", { name: "Lương", locks: [{ wallet_id: "wealth-building", percent: 0.3 }] });
    expect([locks.status, locks.json.error?.code]).toEqual([400, "model_changed"]);
    expect(raw.prepare("SELECT name FROM income_streams WHERE id = 'salary-husband'").get()).toEqual({ name: "Lương chồng" });
    const createLocks = await call("POST", "/v1/settings/income-streams", { name: "Thưởng", locks: [{ wallet_id: "wealth-building", percent: 0.5 }] });
    expect([createLocks.status, createLocks.json.error?.code]).toEqual([400, "model_changed"]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM income_streams WHERE id = 'thuong'").get()).toEqual({ n: 0 });
    const bad = await call("PATCH", "/v1/settings/income-streams/salary-husband", { opens_cycle: "true" });
    expect([bad.status, bad.json.error?.code, bad.json.error?.field]).toEqual([400, "invalid_input", "opens_cycle"]);
    const on = await call("POST", "/v1/settings/income-streams", { name: "Lương vợ mới", opens_cycle: true });
    expect(on.json.data).toMatchObject({ id: "luong-vo-moi", opens_cycle: true });
  });

  it("UC-1205 AC-3: tắt Mở kỳ lương của nguồn duy nhất → paySetup.hasCycleStream false; nguồn cho thuê bật opens_cycle → 400 cannot_open_cycle", async () => {
    expect((await call("GET", "/v1/snapshot")).json.data.paySetup).toEqual({ hasCycleStream: true });
    await call("PATCH", "/v1/settings/income-streams/salary-husband", { opens_cycle: false });
    expect((await call("GET", "/v1/snapshot")).json.data.paySetup).toEqual({ hasCycleStream: false });
    const rental = await call("PATCH", "/v1/settings/income-streams/rental", { opens_cycle: true });
    expect([rental.status, rental.json.error?.code]).toEqual([400, "cannot_open_cycle"]);
    expect(raw.prepare("SELECT opens_cycle FROM income_streams WHERE id = 'rental'").get()).toEqual({ opens_cycle: 0 });
    // Tắt thì luôn được.
    expect((await call("PATCH", "/v1/settings/income-streams/rental", { opens_cycle: false })).status).toBe(200);
  });

  it("mẫu lương gắn nguồn thu; mã chi thì không gắn được", async () => {
    const salary = raw.prepare("SELECT id FROM rules WHERE pattern = 'LUONG THANG'").get() as { id: number };
    const res = await call("PATCH", `/v1/settings/rules/${salary.id}`, { income_stream_id: "salary-husband" });
    expect(res.json.data.incomeStreamId).toBe("salary-husband");
    expect((await call("PATCH", `/v1/settings/rules/${salary.id}`, { income_stream_id: null })).json.data.incomeStreamId).toBeNull();
    const spend = raw.prepare("SELECT id FROM rules WHERE pattern = 'EAN'").get() as { id: number };
    expect((await call("PATCH", `/v1/settings/rules/${spend.id}`, { income_stream_id: "salary-husband" })).status).toBe(400);
  });
});

describe("mốc theo dõi SePay của tài khoản đã dùng (ADR-113)", () => {
  const ON_AT = new Date("2026-10-15T15:24:00.000Z"); // 22:24 ngày 15/10 giờ VN
  // MB (Thuế) chưa nối SePay, mở sổ 1/10.
  beforeEach(() => {
    raw.prepare("UPDATE accounts SET sepay_enabled = 0, sepay_out = 0, sepay_connection_id = NULL, opened_at = '2026-10-01' WHERE id = 'mb-husband'").run();
  });
  const spend = (at: string, status = "active") =>
    raw.prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, category_id, week_key, month_key, status)
       VALUES (?, 50000, 'spend', 'mb-husband', 'groceries', '2026-W41', '2026-10', ?)`,
    ).run(at, status);
  const stored = () => raw.prepare("SELECT sepay_enabled, feed_from, sepay_out_from FROM accounts WHERE id = 'mb-husband'").get();
  const bankLog = (id: string, at: string, source: string, status = "assigned") =>
    raw.prepare(
      `INSERT INTO bank_logs (id, at, amount, direction, account_id, source, status, received_at)
       VALUES (?, ?, 100000, 'in', 'mb-husband', ?, ?, '2026-10-10 03:00:00')`,
    ).run(id, at, source, status);

  it("UC-506 AC-25: dời mốc qua log đã nhận (chờ gán / đã gán) của tài khoản → 409 feed_from_after_logs; mốc đúng bằng `at` của log, dời sớm hơn thì được", async () => {
    raw.prepare("UPDATE accounts SET sepay_enabled = 1, sepay_connection_id = 'default' WHERE id = 'mb-husband'").run();
    bankLog("ls-10-10", "2026-10-10T03:00:00.000Z", "backfill");
    bankLog("wh-10-11", "2026-10-11T03:00:00.000Z", "webhook");
    const later = new Date("2026-10-17T03:00:00.000Z");
    await expect(updateAccount(env.DB, "mb-husband", { feed_from: "2026-10-12T00:00:00.000Z" }, later)).rejects.toMatchObject({
      code: "feed_from_after_logs",
      status: 409,
      field: "feed_from",
      message: "Đã có giao dịch ngân hàng của tài khoản này trước mốc này — chọn mốc sớm hơn.",
    });
    expect(stored()).toMatchObject({ feed_from: null });
    expect(await updateAccount(env.DB, "mb-husband", { feed_from: "2026-10-10T03:00:00.000Z" }, later)).toMatchObject({ feed_from: "2026-10-10T03:00:00.000Z" });
    expect(await updateAccount(env.DB, "mb-husband", { feed_from: "2026-10-05T00:00:00.000Z" }, later)).toMatchObject({ feed_from: "2026-10-05T00:00:00.000Z" });
    // Log webhook (thời gian thực) luôn trong phạm vi dù trước mốc, nên không chặn; log đã bỏ qua cũng không.
    raw.prepare("UPDATE bank_logs SET status = 'ignored' WHERE id = 'ls-10-10'").run();
    expect(await updateAccount(env.DB, "mb-husband", { feed_from: "2026-10-12T00:00:00.000Z" }, later)).toMatchObject({ feed_from: "2026-10-12T00:00:00.000Z" });
  });

  it("UC-506 AC-25: bật lại SePay mà lịch sử SePay gửi lại đã gán từ lần nối trước → mốc tự đặt bị từ chối 409 feed_from_after_logs; chọn mốc sớm hơn thì bật được", async () => {
    spend("2026-10-05T03:00:00.000Z");
    bankLog("ls-10-10", "2026-10-10T03:00:00.000Z", "backfill");
    await expect(updateAccount(env.DB, "mb-husband", { sepay_enabled: true }, ON_AT)).rejects.toMatchObject({ code: "feed_from_after_logs" });
    expect(stored()).toMatchObject({ sepay_enabled: 0, feed_from: null });
    expect(await updateAccount(env.DB, "mb-husband", { sepay_enabled: true, feed_from: "2026-10-10T03:00:00.000Z" }, ON_AT)).toMatchObject({ sepay_enabled: true, feed_from: "2026-10-10T03:00:00.000Z" });
  });

  it("UC-506 AC-25: tài khoản đã có giao dịch tháng 10, bật SePay lúc 22:24 15/10 → feed_from đúng lúc đó (dạng toISOString)", async () => {
    spend("2026-10-05T03:00:00.000Z");
    const a = await updateAccount(env.DB, "mb-husband", { sepay_enabled: true }, ON_AT);
    expect(a).toMatchObject({ sepay_enabled: true, feed_from: "2026-10-15T15:24:00.000Z", sepay_out_from: null });
  });

  it("UC-506 AC-25: tài khoản chưa có giao dịch nào (chỉ khoản đã huỷ, khoản trước ngày mở sổ) bật SePay → feed_from NULL, Đồng bộ lại vẫn lấy được lịch sử", async () => {
    spend("2026-10-05T03:00:00.000Z", "void");
    spend("2026-09-30T10:00:00.000Z"); // 17:00 ngày 30/9 giờ VN — trước ngày mở sổ
    const a = await updateAccount(env.DB, "mb-husband", { sepay_enabled: true }, ON_AT);
    expect(a).toMatchObject({ sepay_enabled: true, feed_from: null });
  });

  it("UC-506 AC-25: đã có lần Nhập số dư (chưa có giao dịch) → bật SePay cũng đặt mốc lúc bật", async () => {
    raw.prepare("INSERT INTO cash_counts (at, account_id, counted, book) VALUES ('2026-10-10 03:00:00', 'mb-husband', 500000, 500000)").run();
    const a = await updateAccount(env.DB, "mb-husband", { sepay_enabled: true }, ON_AT);
    expect(a).toMatchObject({ feed_from: "2026-10-15T15:24:00.000Z" });
  });

  it("UC-506 AC-25: bật SePay kèm feed_from gửi lên thì lấy giá trị đó (null = từ ngày số dư đầu); sửa tên không đổi mốc", async () => {
    spend("2026-10-05T03:00:00.000Z");
    expect(await updateAccount(env.DB, "mb-husband", { sepay_enabled: true, feed_from: null }, ON_AT)).toMatchObject({ feed_from: null });
    const later = new Date("2026-10-16T03:00:00.000Z");
    await updateAccount(env.DB, "mb-husband", { feed_from: "2026-10-15T22:25:00+07:00" }, later);
    expect(await updateAccount(env.DB, "mb-husband", { name: "MB" }, later)).toMatchObject({ name: "MB", feed_from: "2026-10-15T15:25:00.000Z" });
  });

  it("UC-506 AC-25: PATCH feed_from tương lai / trước 00:00 giờ VN ngày mở sổ / sai dạng → 400 invalid_input; hợp lệ lưu dạng toISOString; null bỏ mốc", async () => {
    const patch = (feed_from: unknown) => call("PATCH", "/v1/settings/accounts/mb-husband", { feed_from });
    for (const bad of [new Date(Date.now() + 3_600_000).toISOString(), "2026-09-30T16:59:59.999Z", "2026-10-15", "15/10/2026 22:24", "khong-phai-ngay", 1760541840000, true]) {
      const res = await patch(bad);
      expect(res.status).toBe(400);
      expect(res.json.error).toMatchObject({ code: "invalid_input" });
    }
    expect(stored()).toMatchObject({ feed_from: null });
    // Đúng 00:00 ngày mở sổ (giờ VN) là biên dưới, vẫn hợp lệ.
    expect((await patch("2026-09-30T17:00:00Z")).json.data).toMatchObject({ feed_from: "2026-09-30T17:00:00.000Z" });
    expect((await patch("2026-10-15T22:25:00+07:00")).json.data).toMatchObject({ feed_from: "2026-10-15T15:25:00.000Z" });
    expect((await patch(null)).json.data).toMatchObject({ feed_from: null });
  });

  it("UC-506 AC-25: bật SePay khi tài khoản còn log pending → 409 pending_logs, tài khoản giữ nguyên", async () => {
    spend("2026-10-05T03:00:00.000Z");
    raw.prepare(
      `INSERT INTO bank_logs (id, at, amount, direction, account_id, source, status, received_at)
       VALUES ('cho-1', '2026-10-03T02:00:00.000Z', 100000, 'in', 'mb-husband', 'webhook', 'pending', '2026-10-03 02:00:00')`,
    ).run();
    await expect(updateAccount(env.DB, "mb-husband", { sepay_enabled: true }, ON_AT)).rejects.toMatchObject({ code: "pending_logs", status: 409 });
    expect(stored()).toEqual({ sepay_enabled: 0, feed_from: null, sepay_out_from: null });
  });

  it("UC-506 AC-27: bật sepay_out trên tài khoản đã có SePay → sepay_out_from = lúc bật; tắt rồi bật SePay kèm tiền ra cùng lúc thì không đặt mốc tiền ra", async () => {
    spend("2026-10-05T03:00:00.000Z");
    await updateAccount(env.DB, "mb-husband", { sepay_enabled: true }, ON_AT);
    const out = await updateAccount(env.DB, "mb-husband", { sepay_out: true }, new Date("2026-10-20T03:00:00.000Z"));
    expect(out).toMatchObject({ sepay_out: true, sepay_out_from: "2026-10-20T03:00:00.000Z", feed_from: "2026-10-15T15:24:00.000Z" });
    // Lưu lại sheet (sepay_out vẫn bật) không dời mốc.
    expect(await updateAccount(env.DB, "mb-husband", { sepay_out: true }, new Date("2026-10-21T03:00:00.000Z"))).toMatchObject({ sepay_out_from: "2026-10-20T03:00:00.000Z" });
    await updateAccount(env.DB, "mb-husband", { sepay_enabled: false }, new Date("2026-10-22T03:00:00.000Z"));
    const again = await updateAccount(env.DB, "mb-husband", { sepay_enabled: true, sepay_out: true }, new Date("2026-10-23T03:00:00.000Z"));
    expect(again).toMatchObject({ sepay_out: true, sepay_out_from: null, feed_from: "2026-10-23T03:00:00.000Z" });
  });
});

describe("tham số lãi tiền gửi (261018-lai-tien-gui)", () => {
  it("UC-507: mặc định 10.000; { interest_max_amount: 0 } lưu được; 10000001 → 400, không ghi khoá nào; giá trị hỏng trong DB → 10.000", async () => {
    expect((await call("GET", "/v1/settings")).json.data.config).toMatchObject({ interest_max_amount: 10_000 });
    const saved = await call("PUT", "/v1/settings/config", { interest_max_amount: 0 });
    expect(saved.status).toBe(200);
    expect(saved.json.data).toMatchObject({ interest_max_amount: 0 });
    const tooBig = await call("PUT", "/v1/settings/config", { salary_min_amount: 5, interest_max_amount: 10_000_001 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.json.error?.code).toBe("invalid_input");
    expect((await call("GET", "/v1/settings")).json.data.config).toMatchObject({ interest_max_amount: 0, salary_min_amount: 1_000_000 });
    expect((await call("PUT", "/v1/settings/config", { interest_max_amount: 10_000_000 })).json.data).toMatchObject({ interest_max_amount: 10_000_000 });
    raw.prepare("UPDATE config SET v = 'abc' WHERE k = 'interest_max_amount'").run();
    expect((await call("GET", "/v1/settings")).json.data.config).toMatchObject({ interest_max_amount: 10_000 });
  });
});

describe("ba ngăn: cấu hình (261112-ba-ngan-nen-du-lieu)", () => {
  const auditOf = (action: string) =>
    (raw.prepare("SELECT target, detail FROM audit_log WHERE action = ? ORDER BY id").all(action) as { target: string; detail: string }[]).map((r) => ({
      target: r.target,
      detail: JSON.parse(r.detail),
    }));

  it("UC-505 AC-15: GET /v1/settings trên hộ mẫu có ngăn tài khoản, ngăn nguồn thu, goals[] theo thứ tự ưu tiên (held = đã có — một mục tiêu một tài khoản thì = số dư sổ tài khoản gắn, chưa gắn → null), nhóm danh mục, % Tích luỹ", async () => {
    raw.exec("UPDATE accounts SET opening_balance = 2500000 WHERE id = 'mb-tuition'");
    const { data } = (await call("GET", "/v1/settings")).json;
    expect(data.accounts.find((a: any) => a.id === "vcb-husband")).toMatchObject({ pocket: "operating", pocket_confirmed: true });
    expect(data.accounts.find((a: any) => a.id === "mb-tuition")).toMatchObject({ pocket: "reserve", book_balance: 2_500_000 });
    expect(data.incomeStreams.every((s: any) => "pocket" in s)).toBe(true);
    expect(data.config.savings_pct).toBe(30);
    for (const g of data.goals) {
      expect(Object.keys(g).sort()).toEqual(
        ["account_id", "active", "category_ids", "debt_id", "due_date", "held", "id", "monthly_amount", "name", "need", "pays_from", "remaining", "repeat_months", "short", "sort", "spent", "suggested_account_id", "target_amount", "target_pct"].sort(),
      );
    }
    expect(data.goals).toEqual([
      { id: "tuition", name: "Học phí", account_id: "mb-tuition", suggested_account_id: null, held: 2_500_000, need: 6_000_000, spent: 0, short: 3_500_000, target_amount: 6_000_000, target_pct: null, monthly_amount: 2_000_000, repeat_months: 3, due_date: "2027-01-15", debt_id: null, sort: 10, active: true, pays_from: "account", remaining: null, category_ids: [] },
      { id: "car-service", name: "Bảo dưỡng xe", account_id: null, suggested_account_id: null, held: null, need: null, spent: 0, short: null, target_amount: 4_800_000, target_pct: null, monthly_amount: null, repeat_months: null, due_date: "2027-03-31", debt_id: null, sort: 20, active: true, pays_from: "account", remaining: null, category_ids: [] },
      { id: "income-tax", name: "Thuế thu nhập", account_id: null, suggested_account_id: null, held: null, need: null, spent: 0, short: null, target_amount: null, target_pct: 10, monthly_amount: null, repeat_months: null, due_date: null, debt_id: null, sort: 30, active: true, pays_from: "account", remaining: null, category_ids: [] },
    ]);
    expect(data.goal_groups).toEqual([{ account_id: "mb-tuition", balance: 2_500_000, need: 6_000_000, spent: 0, short: 3_500_000, extra: 0, goal_ids: ["tuition"], child_ids: [], interest: 0 }]);
    // Mục tiêu đã tắt vẫn có trong danh sách.
    raw.exec("UPDATE reserve_goals SET active = 0 WHERE id = 'car-service'");
    expect((await call("GET", "/v1/settings")).json.data.goals.find((g: any) => g.id === "car-service")).toMatchObject({ active: false });
    expect(data.categoryGroups.find((g: any) => g.id === "food")).toEqual({ id: "food", name: "Ăn uống", essential: true, cycle_limit: 2_709_000, sort: 41, active: true });
    expect(data.categories.find((c: any) => c.id === "groceries").groupId).toBe("food");
  });

  it("UC-505 AC-18: nhóm tài khoản chung — goals[] theo sort, held như snapshot, spent 0; sau khoản chi 7.500.000 gắn Nhà ở → Nhà ở held 0, spent 7.500.000, short 0; goal_groups cùng số với snapshot.pockets.reserve.groups", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SHARED_NOW);
    try {
      raw = householdShared();
      env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
      let data = (await call("GET", "/v1/settings")).json.data;
      expect(data.goals.filter((g: any) => g.active).map((g: any) => g.id)).toEqual(["hoa-don", "nha-o", "hoc-tap", "bao-duong-xe", "hieu-hi", "thue"]);
      const heldOf = (goals: any[]) => Object.fromEntries(goals.filter((g) => g.active !== false).map((g) => [g.id, g.held]));
      expect(heldOf(data.goals)).toEqual({ "hoa-don": 2_000_000, "nha-o": 7_500_000, "hoc-tap": 4_500_000, "bao-duong-xe": 4_800_000, "hieu-hi": 2_200_000, thue: 1_500_000 });
      expect(data.goals.every((g: any) => g.spent === 0)).toBe(true);
      sharedTx(raw, { at: "2026-11-12 09:00", meaning: "spend", amount: 7_500_000, from: "tk-tiet-kiem", goal: "nha-o" });
      data = (await call("GET", "/v1/settings")).json.data;
      expect(data.goals.find((g: any) => g.id === "nha-o")).toMatchObject({ held: 0, spent: 7_500_000, short: 0 });
      const snap = (await call("GET", "/v1/snapshot", undefined, true, as("husband"))).json.data.pockets.reserve;
      expect(data.goal_groups).toEqual(
        snap.groups.map((g: any) => ({ account_id: g.accountId, balance: g.balance, need: g.need, spent: g.spent, short: g.short, extra: g.extra, goal_ids: g.goalIds, child_ids: g.childIds, interest: g.interest })),
      );
      expect(heldOf(data.goals)).toEqual(heldOf(snap.goals));
    } finally {
      vi.useRealTimers();
    }
  });

  it("UC-1204 AC-2: nhóm danh mục — tạo, trùng, bỏ hạn mức, hạn mức 0, tắt khi còn danh mục", async () => {
    const created = await call("POST", "/v1/settings/category-groups", { name: "Đi lại xa", cycle_limit: 800_000 });
    expect(created.status).toBe(201);
    expect(created.json.data).toEqual({ id: "di-lai-xa", name: "Đi lại xa", essential: false, cycle_limit: 800_000, sort: 100, active: true });
    expect((await call("GET", "/v1/settings")).json.data.categoryGroups.some((g: any) => g.id === "di-lai-xa")).toBe(true);
    expect(auditOf("category_group.create")).toEqual([{ target: "category_group:di-lai-xa", detail: { fields: ["cycle_limit", "name"] } }]);
    expect((await call("POST", "/v1/settings/category-groups", { name: "Đi lại xa" })).json.error?.code).toBe("duplicate");
    expect((await call("PATCH", "/v1/settings/category-groups/di-lai-xa", { cycle_limit: null })).json.data.cycle_limit).toBeNull();
    expect((await call("PATCH", "/v1/settings/category-groups/di-lai-xa", { cycle_limit: 0 })).json.error?.code).toBe("invalid_input");
    expect((await call("PATCH", "/v1/categories/ride-hailing", { group_id: "di-lai-xa" })).status).toBe(200);
    const inUse = await call("PATCH", "/v1/settings/category-groups/di-lai-xa", { active: false });
    expect([inUse.status, inUse.json.error?.code]).toEqual([409, "group_in_use"]);
    await call("PATCH", "/v1/categories/ride-hailing", { group_id: "transport" });
    expect((await call("PATCH", "/v1/settings/category-groups/di-lai-xa", { active: false })).json.data.active).toBe(false);
    expect(auditOf("category_group.update").map((r) => r.detail)).toEqual([{ fields: ["cycle_limit"] }, { fields: ["active"] }]);
  });

  it("UC-109 AC-8: danh mục nhận group_id — nhóm đang dùng thì lưu; nhóm lạ / đã tắt 400 unknown_group; null bỏ nhóm; GET /v1/categories và /v1/bootstrap trả groupId", async () => {
    expect((await call("PATCH", "/v1/categories/shopping", { group_id: "nice-to-have" })).json.data).toMatchObject({ group_id: "nice-to-have" });
    expect((await call("GET", "/v1/categories")).json.data.find((c: any) => c.id === "shopping").groupId).toBe("nice-to-have");
    expect((await call("PATCH", "/v1/categories/shopping", { group_id: "khong-co" })).json.error?.code).toBe("unknown_group");
    raw.exec("INSERT INTO category_groups (id, name, active) VALUES ('cu', 'Nhóm cũ', 0)");
    expect((await call("PATCH", "/v1/categories/shopping", { group_id: "cu" })).json.error?.code).toBe("unknown_group");
    expect((await call("PATCH", "/v1/categories/shopping", { group_id: null })).json.data.group_id).toBeNull();
    expect((await call("GET", "/v1/bootstrap")).json.data.categories.find((c: any) => c.id === "groceries").groupId).toBe("food");
  });

  it("UC-109 AC-9: PATCH danh mục kèm default_wallet_id → 400 model_changed, không đổi gì; GET /v1/categories không có ví mặc định; danh mục mới không ví → khoản chi danh mục đó ghi được", async () => {
    const old = await call("PATCH", "/v1/categories/eating-out", { name: "Ăn hàng", default_wallet_id: "food" });
    expect([old.status, old.json.error?.code, (old.json.error as { fields?: string[] } | undefined)?.fields]).toEqual([400, "model_changed", ["default_wallet_id"]]);
    expect(raw.prepare("SELECT name FROM categories WHERE id = 'eating-out'").get()).toEqual({ name: "Ăn ngoài" });
    const list = (await call("GET", "/v1/categories")).json.data as Record<string, unknown>[];
    expect(list.every((c) => !("default_wallet_id" in c) && !("defaultWalletId" in c))).toBe(true);
    expect((await call("POST", "/v1/categories", { id: "pets", name: "Thú cưng", default_wallet_id: "food" })).json.error?.code).toBe("model_changed");
    expect((await call("POST", "/v1/categories", { id: "pets", name: "Thú cưng" })).status).toBe(201);
    const spend = await call("POST", "/v1/transactions", { meaning: "spend", amount: 150_000, category_id: "pets", account_id: "cash-husband" });
    expect([spend.status, spend.json.data.tx.category_id]).toEqual([201, "pets"]);
    expect(spend.json.data.tx).not.toHaveProperty("wallet_id");
  });

  it("UC-111 AC-16: bootstrap sau 0040 — không wallets; categories[] không ví mặc định; accounts[] có private, hiddenFromMe, không locked / role", async () => {
    const boot = (await call("GET", "/v1/bootstrap")).json.data as { categories: object[]; accounts: object[] };
    expect(boot).not.toHaveProperty("wallets");
    expect(boot.categories.every((c) => !("defaultWalletId" in c) && !("default_wallet_id" in c))).toBe(true);
    expect(boot.accounts.every((a) => "private" in a && "hiddenFromMe" in a && !("locked" in a) && !("role" in a))).toBe(true);
  });

  it("UC-506 AC-28: nguồn thu lưu ngăn của tiền về; ngăn lạ 400; null = theo tài khoản nhận", async () => {
    expect((await call("PATCH", "/v1/settings/income-streams/salary-husband", { pocket: "savings" })).json.data.pocket).toBe("savings");
    expect((await call("GET", "/v1/settings")).json.data.incomeStreams.find((s: any) => s.id === "salary-husband").pocket).toBe("savings");
    expect((await call("PATCH", "/v1/settings/income-streams/salary-husband", { pocket: "spend" })).json.error?.code).toBe("invalid_input");
    expect((await call("PATCH", "/v1/settings/income-streams/salary-husband", { pocket: null })).json.data.pocket).toBeNull();
  });

  it("UC-507 AC-20: % Tích luỹ là số nguyên 1–100", async () => {
    expect((await call("PUT", "/v1/settings/config", { savings_pct: 15 })).json.data.savings_pct).toBe(15);
    expect((await call("GET", "/v1/settings")).json.data.config.savings_pct).toBe(15);
    expect(auditOf("config.update").at(-1)!.detail).toEqual({ fields: ["savings_pct"], savings_pct: 15 });
    for (const v of [0, 101, 12.5, "10"]) {
      const r = await call("PUT", "/v1/settings/config", { savings_pct: v });
      expect([r.status, r.json.error?.code]).toEqual([400, "invalid_input"]);
    }
  });
});

describe("tài khoản con — khoản gửi kỳ hạn (261112-tai-khoan-me-va-quy-chi-chung)", () => {
  const auditOf = (action: string) =>
    (raw.prepare("SELECT target, detail FROM audit_log WHERE action = ? ORDER BY id").all(action) as { target: string; detail: string }[]).map((r) => ({
      target: r.target,
      detail: JSON.parse(r.detail),
    }));
  const accountRow = (id: string) =>
    raw.prepare("SELECT parent_account_id, pocket, pocket_confirmed, private, owner_member_id, active FROM accounts WHERE id = ?").get(id) as Record<string, unknown>;
  const settingsAccounts = async () => (await call("GET", "/v1/settings")).json.data.accounts as any[];
  /** Số dư gộp: tài khoản + con đang dùng của nó, theo sổ (GET /v1/settings). */
  const combined = (accounts: any[], id: string) =>
    accounts.filter((a) => a.id === id || (a.parent_account_id === id && a.active)).reduce((s, a) => s + Number(a.book_balance ?? 0), 0);
  const reserveTotal = (accounts: any[]) => accounts.filter((a) => a.active && a.pocket === "reserve").reduce((s, a) => s + Number(a.book_balance ?? 0), 0);
  const err = (r: { status: number; json: Json }) => [r.status, r.json.error?.code];

  beforeEach(() => {
    raw.exec(`
      INSERT INTO accounts (id, name, kind, bank, account_no, owner_member_id, opening_balance, opened_at, pocket, pocket_confirmed) VALUES
        ('tk-tiet-kiem', 'MB tiết kiệm', 'bank', 'MBBank', '0999000001', 'husband', 20000000, date('now', '-10 days'), 'reserve', 1),
        ('tk-chi-tieu-chong', 'VCB chi tiêu chồng', 'bank', 'Vietcombank', '0999000002', 'husband', 0, date('now', '-10 days'), 'operating', 1),
        ('gui-ky-han', 'Tiền gửi kỳ hạn MB', 'bank', 'MBBank', NULL, 'husband', 22000000, date('now', '-10 days'), 'savings', 1),
        ('tk-hoc-phi', 'TK học phí', 'bank', 'MBBank', NULL, 'husband', 0, date('now', '-10 days'), 'reserve', 1),
        ('tk-bidv', 'BIDV', 'bank', 'BIDV', NULL, 'wife', 0, date('now', '-10 days'), 'reserve', 1);
      INSERT INTO reserve_goals (id, name, account_id, target_amount, sort) VALUES ('hoc-phi', 'Học phí', 'tk-hoc-phi', 5000000, 40);
      UPDATE config SET v = 'tk-bidv' WHERE k = 'surplus_reward_account';
    `);
  });

  it("UC-506 AC-33: tạo khoản gửi là tài khoản con — con theo ngăn / xác nhận / riêng tư / chủ của mẹ; chuyển sang con không đổi tổng Dự phòng; con của con, con của tài khoản Vận hành 400 invalid_parent; gửi pocket 400 pocket_follows_parent; bật SePay cho con E14", async () => {
    const created = await call("POST", "/v1/settings/accounts", { name: "Gửi 6 tháng", kind: "bank", parent_account_id: "tk-tiet-kiem", opening_balance: 0 });
    expect(created.status).toBe(201);
    expect(created.json.data).toMatchObject({ id: "gui-6-thang", parent_account_id: "tk-tiet-kiem", pocket: "reserve", pocket_confirmed: true, private: false, owner_member_id: "husband" });
    expect((await settingsAccounts()).find((a) => a.id === "gui-6-thang").parent_account_id).toBe("tk-tiet-kiem");
    expect((await settingsAccounts()).find((a) => a.id === "tk-tiet-kiem").parent_account_id).toBeNull();

    const before = reserveTotal(await settingsAccounts());
    const moved = await call("POST", "/v1/transactions", { meaning: "transfer", amount: 15_000_000, account_id: "tk-tiet-kiem", to_account_id: "gui-6-thang" });
    expect(moved.status).toBe(201);
    const after = await settingsAccounts();
    expect(reserveTotal(after)).toBe(before);
    expect(combined(after, "tk-tiet-kiem")).toBe(20_000_000);

    const count = () => (raw.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
    const n = count();
    expect(err(await call("POST", "/v1/settings/accounts", { name: "Gửi con của con", kind: "bank", parent_account_id: "gui-6-thang" }))).toEqual([400, "invalid_parent"]);
    expect(err(await call("POST", "/v1/settings/accounts", { name: "Gửi từ chi tiêu", kind: "bank", parent_account_id: "tk-chi-tieu-chong" }))).toEqual([400, "invalid_parent"]);
    expect(err(await call("POST", "/v1/settings/accounts", { name: "Gửi 12 tháng", kind: "bank", parent_account_id: "tk-tiet-kiem", pocket: "savings" }))).toEqual([400, "pocket_follows_parent"]);
    expect(count()).toBe(n);
    const sepay = await call("PATCH", "/v1/settings/accounts/gui-6-thang", { sepay_enabled: true, account_no: "0999000099" });
    expect(err(sepay)).toEqual([400, "bank_not_supported"]);
    expect(sepay.json.error?.message).toMatch(/khoản gửi/i);
    expect(raw.prepare("SELECT sepay_enabled, account_no FROM accounts WHERE id = 'gui-6-thang'").get()).toEqual({ sepay_enabled: 0, account_no: null });
    // Mẹ không tồn tại / chính nó cũng là mẹ không hợp lệ.
    expect(err(await call("POST", "/v1/settings/accounts", { name: "Gửi lạc", kind: "bank", parent_account_id: "khong-co" }))).toEqual([400, "invalid_parent"]);
    expect(err(await call("POST", "/v1/settings/accounts", { name: "Gửi tiền mặt", kind: "cash", parent_account_id: "tk-tiet-kiem" }))).toEqual([400, "invalid_parent"]);
    expect(count()).toBe(n);
  });

  it("UC-506 AC-34: sửa mẹ kéo con theo cùng câu ghi (nhật ký mẹ có changes.children); mẹ có con không sang Vận hành, không đổi kind, không tắt (409 account_has_children); tắt con, tắt mẹ được; bật lại con khi mẹ tắt 400 invalid_parent", async () => {
    expect((await call("POST", "/v1/settings/accounts", { name: "Gửi 6 tháng", kind: "bank", parent_account_id: "tk-tiet-kiem", opening_balance: 0 })).status).toBe(201);
    expect((await call("PATCH", "/v1/settings/accounts/tk-tiet-kiem", { pocket: "savings" })).status).toBe(200);
    expect(accountRow("gui-6-thang")).toMatchObject({ pocket: "savings", pocket_confirmed: 1 });
    expect((await call("PATCH", "/v1/settings/accounts/tk-tiet-kiem", { private: true }, true, as("husband"))).status).toBe(200);
    expect(accountRow("gui-6-thang")).toMatchObject({ pocket: "savings", private: 1, owner_member_id: "husband" });
    const parentAudit = auditOf("account.update").filter((r) => r.target === "account:tk-tiet-kiem");
    expect(parentAudit.map((r) => r.detail.changes)).toEqual([
      { pocket: { from: "reserve", to: "savings" }, children: ["gui-6-thang"] },
      { private: { from: false, to: true }, children: ["gui-6-thang"] },
    ]);

    const snapshot = () => [accountRow("tk-tiet-kiem"), accountRow("gui-6-thang"), (raw.prepare("SELECT kind FROM accounts WHERE id = 'tk-tiet-kiem'").get() as any).kind];
    const kept = snapshot();
    for (const b of [{ pocket: "operating" }, { kind: "cash", bank: null }, { active: false }]) {
      const r = await call("PATCH", "/v1/settings/accounts/tk-tiet-kiem", b, true, as("husband"));
      expect(err(r)).toEqual([409, "account_has_children"]);
      expect(r.json.error?.message).toBe("Tất toán / tắt các khoản gửi của MB tiết kiệm trước.");
    }
    expect(snapshot()).toEqual(kept);

    expect((await call("PATCH", "/v1/settings/accounts/gui-6-thang", { active: false }, true, as("husband"))).status).toBe(200);
    expect((await call("PATCH", "/v1/settings/accounts/tk-tiet-kiem", { active: false }, true, as("husband"))).status).toBe(200);
    expect(err(await call("PATCH", "/v1/settings/accounts/gui-6-thang", { active: true }, true, as("husband")))).toEqual([400, "invalid_parent"]);
    expect(accountRow("gui-6-thang").active).toBe(0);
  });

  it("UC-506 AC-35: PATCH biến tài khoản có sẵn thành con — sang ngăn của mẹ, nhật ký parent_account_id và pocket; tài khoản gắn mục tiêu 409 goal_on_child; Ví Thưởng, tài khoản bật SePay 400 invalid_parent; đặt Ví Thưởng là con 400 invalid_account; bỏ mẹ giữ ngăn", async () => {
    const before = combined(await settingsAccounts(), "tk-tiet-kiem");
    const r = await call("PATCH", "/v1/settings/accounts/gui-ky-han", { parent_account_id: "tk-tiet-kiem" });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ parent_account_id: "tk-tiet-kiem", pocket: "reserve", pocket_confirmed: true, private: false, owner_member_id: "husband" });
    expect(auditOf("account.update").at(-1)).toEqual({
      target: "account:gui-ky-han",
      detail: { fields: ["parent_account_id"], changes: { parent_account_id: { from: null, to: "tk-tiet-kiem" }, pocket: { from: "savings", to: "reserve" } } },
    });
    expect(combined(await settingsAccounts(), "tk-tiet-kiem") - before).toBe(22_000_000);

    const goal = await call("PATCH", "/v1/settings/accounts/tk-hoc-phi", { parent_account_id: "tk-tiet-kiem" });
    expect(err(goal)).toEqual([409, "goal_on_child"]);
    expect(err(await call("PATCH", "/v1/settings/accounts/tk-bidv", { parent_account_id: "tk-tiet-kiem" }))).toEqual([400, "invalid_parent"]);
    expect(err(await call("PATCH", "/v1/settings/accounts/tk-tiet-kiem", { parent_account_id: "tk-chi-tieu-chong" }))).toEqual([400, "invalid_parent"]);
    raw.exec("UPDATE accounts SET pocket = 'reserve' WHERE id = 'vcb-wife'");
    expect(err(await call("PATCH", "/v1/settings/accounts/vcb-wife", { parent_account_id: "tk-tiet-kiem" }, true, as("wife")))).toEqual([400, "invalid_parent"]);
    expect([accountRow("tk-hoc-phi").parent_account_id, accountRow("tk-bidv").parent_account_id, accountRow("vcb-wife").parent_account_id]).toEqual([null, null, null]);

    const reward = await call("PUT", "/v1/settings/config", { surplus_reward_account: "gui-ky-han" });
    expect(err(reward)).toEqual([400, "invalid_account"]);
    expect((raw.prepare("SELECT v FROM config WHERE k = 'surplus_reward_account'").get() as { v: string }).v).toBe("tk-bidv");

    const detached = await call("PATCH", "/v1/settings/accounts/gui-ky-han", { parent_account_id: null });
    expect(detached.status).toBe(200);
    expect(detached.json.data).toMatchObject({ parent_account_id: null, pocket: "reserve" });
    expect(auditOf("account.update").at(-1)!.detail.changes).toEqual({ parent_account_id: { from: "tk-tiet-kiem", to: null } });
  });

  it("UC-507 AC-23: D1 mới không có khoá savings_pct → GET /v1/settings savings_pct 10; kỳ mở với lương 20.000.000 → ① 2.000.000", async () => {
    raw.exec("DELETE FROM config WHERE k = 'savings_pct'");
    expect((await call("GET", "/v1/settings")).json.data.config.savings_pct).toBe(10);
    const salary = await call("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "cash-husband", income_stream_id: "salary-husband" });
    expect(salary.status).toBe(201);
    expect(raw.prepare("SELECT amount FROM pay_cycle_tasks WHERE kind = 'savings'").all()).toEqual([{ amount: 2_000_000 }]);
  });
});
