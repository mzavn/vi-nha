import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { notifyMembers } from "../src/notify/telegram";
import { testSepay, testTelegram } from "../src/services/settings";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.unstubAllGlobals());

type Json = { ok: boolean; data: any; error?: { code: string; message: string } };
async function call(method: string, path: string, body?: unknown, auth = true) {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: { ...(auth ? { Authorization: "Bearer tok" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

describe("đọc cài đặt", () => {
  it("cần đăng nhập", async () => {
    expect((await call("GET", "/v1/settings", undefined, false)).status).toBe(401);
  });

  it("trả đủ các phần, kèm URL webhook để dán vào SePay", async () => {
    const { json } = await call("GET", "/v1/settings");
    expect(Object.keys(json.data).sort()).toEqual(["accounts", "categories", "config", "incomeStreams", "integrations", "members", "notifySchedule", "rules", "wallets"]);
    expect(json.data.integrations.webhook_url).toBe("https://app.example.com/webhooks/sepay");
    expect(json.data.config).toEqual({ salary_min_amount: 1_000_000, safety_fund_months: 6 });
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
    const have = json.data.wallets.find((w: any) => w.id === "nice-to-have");
    expect(have.allocation.mode).toBe("remainder");
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

  it("sửa số tài khoản mẫu thành số thật; không tắt được tài khoản còn ví trú ở đó", async () => {
    const res = await call("PATCH", "/v1/settings/accounts/vcb-husband", { account_no: "1234567890", name: "MB (chồng)" });
    expect(res.json.data).toMatchObject({ account_no: "1234567890", name: "MB (chồng)" });
    expect((await call("PATCH", "/v1/settings/accounts/vcb-husband", { active: false })).json.error?.code).toBe("in_use");
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

describe("ví & số tiền nạp", () => {
  it("sửa số tiền phong bì Ăn uống", async () => {
    const res = await call("PATCH", "/v1/settings/wallets/food", { allocation: { amount: 700_000, floor_amount: 550_000 } });
    expect(res.json.data.allocation).toMatchObject({ mode: "flat", period: "week", amount: 700_000, floor_amount: 550_000 });
  });

  it("tổng % Tích sản + Thuế vượt 100% thì từ chối — và không ghi gì", async () => {
    const res = await call("PATCH", "/v1/settings/wallets/wealth-building", { allocation: { percent: 0.95 } });
    expect(res.json.error?.code).toBe("invalid_allocation");
    expect(raw.prepare("SELECT percent FROM allocations WHERE wallet_id = 'wealth-building'").get()).toEqual({ percent: 0.3 });
  });

  it("ví nhận phần còn lại không đổi cách nạp được; không tắt được", async () => {
    expect((await call("PATCH", "/v1/settings/wallets/nice-to-have", { allocation: { mode: "flat", amount: 1 } })).json.error?.code).toBe("remainder_fixed");
    expect((await call("PATCH", "/v1/settings/wallets/nice-to-have", { active: false })).json.error?.code).toBe("required_wallet");
  });

  it("thêm ví tích dồn Bảo hiểm (quyết định D10) có mục tiêu; không tạo được ví Tích sản thứ hai", async () => {
    const res = await call("POST", "/v1/settings/wallets", {
      name: "Bảo hiểm",
      tier: "must",
      must_group: "must",
      kind: "accrual",
      account_id: "vcb-husband",
      allocation: { mode: "goal", target_amount: 12_000_000, target_date: "2027-06-30", priority: 45 },
    });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ id: "bao-hiem", allocation: { mode: "goal", target_amount: 12_000_000 } });
    const goalMissingDate = await call("POST", "/v1/settings/wallets", { name: "X", tier: "nice", kind: "accrual", allocation: { mode: "goal", target_amount: 1 } });
    expect(goalMissingDate.json.error?.code).toBe("invalid_allocation");
    expect((await call("POST", "/v1/settings/wallets", { name: "Tích sản 2", tier: "wealth_building", kind: "accrual" })).status).toBe(409);
  });
});

describe("thành viên, mã chuyển khoản, tham số", () => {
  it("chat_id Telegram phải là dãy số", async () => {
    expect((await call("PATCH", "/v1/settings/members/wife", { tg_chat_id: "@vo" })).status).toBe(400);
    expect((await call("PATCH", "/v1/settings/members/wife", { tg_chat_id: "987654321" })).json.data.tg_chat_id).toBe("987654321");
  });

  it("sửa mã chuyển khoản; mã tự gán thu nhập phải là mẫu lương (luật 6)", async () => {
    const rule = raw.prepare("SELECT id FROM rules WHERE pattern = 'EAN'").get() as { id: number };
    const res = await call("PATCH", `/v1/settings/rules/${rule.id}`, { pattern: "ean", priority: 5 });
    expect(res.json.data).toMatchObject({ pattern: "EAN", priority: 5 });
    expect((await call("PATCH", `/v1/settings/rules/${rule.id}`, { meaning: "income" })).json.error?.code).toBe("income_needs_salary");
  });

  it("ngưỡng lương và số tháng phao", async () => {
    const res = await call("PUT", "/v1/settings/config", { salary_min_amount: 0, safety_fund_months: 3 });
    expect(res.json.data).toEqual({ salary_min_amount: 0, safety_fund_months: 3 });
    expect((await call("PUT", "/v1/settings/config", { safety_fund_months: 0 })).status).toBe(400);
    // Khoá cũ emergency_months bị bỏ qua như trường lạ (0028 đổi tên).
    expect((await call("PUT", "/v1/settings/config", { emergency_months: 12 })).json.data).toEqual({ salary_min_amount: 0, safety_fund_months: 3 });
    expect((await call("GET", "/v1/settings")).json.data.config).toEqual({ salary_min_amount: 0, safety_fund_months: 3 });
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

describe("nguồn thu và chia phong bì theo tuần", () => {
  it("đọc hồ sơ nguồn thu seed; thêm/sửa nguồn; tổng khóa vượt 100% hay khóa vào ví Thu nhập bị từ chối", async () => {
    const { json } = await call("GET", "/v1/settings");
    expect(json.data.incomeStreams.find((s: { id: string }) => s.id === "salary-wife")).toEqual({ id: "salary-wife", name: "Lương vợ", sort: 20, active: true, locks: [{ walletId: "wealth-building", percent: 0.45 }] });

    const over = await call("POST", "/v1/settings/income-streams", { name: "Thưởng", locks: [{ wallet_id: "wealth-building", percent: 0.6 }, { wallet_id: "travel", percent: 0.5 }] });
    expect(over.json.error?.code).toBe("invalid_lock");
    const created = await call("POST", "/v1/settings/income-streams", { name: "Thưởng", locks: [{ wallet_id: "wealth-building", percent: 0.5 }] });
    expect(created.status).toBe(201);
    expect(created.json.data).toMatchObject({ id: "thuong", active: true, locks: [{ walletId: "wealth-building", percent: 0.5 }] });

    expect((await call("PATCH", "/v1/settings/income-streams/thuong", { locks: [{ wallet_id: "income", percent: 0.1 }] })).json.error?.code).toBe("invalid_lock");
    const patched = await call("PATCH", "/v1/settings/income-streams/thuong", { name: "Thưởng Tết", locks: [{ wallet_id: "rental-income", percent: 1 }], active: false });
    expect(patched.json.data).toEqual({ id: "thuong", name: "Thưởng Tết", sort: 100, active: false, locks: [{ walletId: "rental-income", percent: 1 }] });
    expect((await call("PATCH", "/v1/settings/income-streams/khong-co", { name: "X" })).status).toBe(404);
  });

  it("mẫu lương gắn nguồn thu; mã chi thì không gắn được", async () => {
    const salary = raw.prepare("SELECT id FROM rules WHERE pattern = 'LUONG THANG'").get() as { id: number };
    const res = await call("PATCH", `/v1/settings/rules/${salary.id}`, { income_stream_id: "salary-husband" });
    expect(res.json.data.incomeStreamId).toBe("salary-husband");
    expect((await call("PATCH", `/v1/settings/rules/${salary.id}`, { income_stream_id: null })).json.data.incomeStreamId).toBeNull();
    const spend = raw.prepare("SELECT id FROM rules WHERE pattern = 'EAN'").get() as { id: number };
    expect((await call("PATCH", `/v1/settings/rules/${spend.id}`, { income_stream_id: "salary-husband" })).status).toBe(400);
  });

  it("phong bì tháng bật chia theo tuần; ví tích dồn hay phong bì tuần thì không", async () => {
    const res = await call("PATCH", "/v1/settings/wallets/food", { allocation: { period: "month", amount: 2_800_000, split_weekly: true } });
    expect(res.json.data.allocation).toMatchObject({ mode: "flat", period: "month", amount: 2_800_000, splitWeekly: true });
    expect((await call("PATCH", "/v1/settings/wallets/transport", { allocation: { split_weekly: true } })).json.error?.code).toBe("invalid_allocation");
    expect((await call("PATCH", "/v1/settings/wallets/hometown", { allocation: { split_weekly: true } })).json.error?.code).toBe("invalid_allocation");
    // Đổi về phong bì tuần thì tự tắt chia tuần.
    const back = await call("PATCH", "/v1/settings/wallets/food", { allocation: { period: "week", amount: 625_000 } });
    expect(back.json.data.allocation.splitWeekly).toBe(false);
  });
});
