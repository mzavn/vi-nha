// UC-507: thêm / tắt / bật lại thành viên, mật khẩu riêng; UC-505 has_password; UC-504 ví private của người đã tắt.
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { hashPassword } from "../src/services/passwords";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { MemoryKV } from "./helpers/oauth";

let raw: DatabaseSync;
let env: Env;
let telegram: { chat_id: string; text: string }[];
const IP = "203.0.113.7";
const TG_TOKEN = "123456:telegram-token-xyz";

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), OAUTH_KV: new MemoryKV() as unknown as KVNamespace, API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
  telegram = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (/api\.telegram\.org\/bot[^/]+\/sendMessage/.test(String(url))) telegram.push(JSON.parse(String(init.body)) as { chat_id: string; text: string });
      return Response.json({ ok: true });
    }),
  );
  // Cả nhà có Telegram: Chồng chat 1001, Vợ chat 2002 — để thấy cảnh báo "báo cả nhà".
  raw.prepare("INSERT INTO config (k, v) VALUES ('secret:telegram_bot_token', ?)").run(TG_TOKEN);
  raw.prepare("UPDATE members SET tg_chat_id = CASE id WHEN 'husband' THEN '1001' ELSE '2002' END").run();
});
afterEach(() => vi.unstubAllGlobals());

type Json = { ok: boolean; data: unknown; error?: { code: string; message: string; field?: string } };
type Call = { status: number; json: Json; setCookie: string | null };

/** Gọi bằng token (mặc định, người làm là chủ hộ) hoặc bằng cookie khi truyền `cookie`. */
async function call(method: string, path: string, body?: unknown, cookie?: string): Promise<Call> {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: {
        "CF-Connecting-IP": IP,
        ...(cookie ? { Cookie: cookie } : { Authorization: "Bearer tok" }),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json, setCookie: res.headers.get("Set-Cookie") };
}
const login = async (member_id: string, password: string) => {
  const res = await call("POST", "/v1/session", { member_id, password }, "none=1");
  return { ...res, cookie: res.setCookie?.split(";")[0] ?? "" };
};
const cookieOf = async (member_id: string, password = "mat-khau-chung") => (await login(member_id, password)).cookie;
const status = async (cookie: string) => (await call("GET", "/v1/snapshot", undefined, cookie)).status;
const member = (id: string) => raw.prepare("SELECT id, name, role, active, password_hash, session_gen FROM members WHERE id = ?").get(id);
const auditActions = () => raw.prepare("SELECT member_id, via, action, target FROM audit_log ORDER BY id").all();
const failures = () => raw.prepare("SELECT failures FROM auth_failures WHERE scope = 'login' AND ip = ?").get(IP)?.failures ?? 0;
const addMembers = (n: number) => {
  for (let i = 1; i <= n; i++) raw.prepare("INSERT INTO members (id, name, role) VALUES (?, ?, 'adult')").run(`extra-${i}`, `Người thêm ${i}`);
};

describe("UC-507 AC-11: thêm người", () => {
  it("POST /v1/settings/members → 201 người lớn, đang hoạt động, mã sinh từ tên; nhật ký member.create, báo cả nhà", async () => {
    const res = await call("POST", "/v1/settings/members", { name: "Bà Nội" });
    expect(res.status).toBe(201);
    expect(res.json.data).toEqual({ id: "ba-noi", name: "Bà Nội", role: "adult", tg_chat_id: null, zalo_chat_id: null, active: true, has_password: false });
    expect(auditActions()).toEqual([{ member_id: "husband", via: "token", action: "member.create", target: "member:ba-noi" }]);
    expect(telegram.map((t) => t.chat_id).sort()).toEqual(["1001", "2002"]);
    expect(telegram[0]!.text).toContain("Bà Nội");
    expect((await login("ba-noi", "mat-khau-chung")).status).toBe(200);
  });

  it("trùng tên (không phân biệt hoa thường) hoặc trùng mã với bất kỳ ai, kể cả người đã tắt → 409 duplicate", async () => {
    expect((await call("POST", "/v1/settings/members", { name: " vợ " })).json.error?.code).toBe("duplicate");
    expect((await call("POST", "/v1/settings/members", { name: "Wife" })).json.error?.code).toBe("duplicate");
    raw.prepare("INSERT INTO members (id, name, role, active) VALUES ('ong', 'Ông', 'adult', 0)").run();
    const res = await call("POST", "/v1/settings/members", { name: "Ong" });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe("duplicate");
    expect(auditActions()).toEqual([]);
  });

  it("đã có 6 người đang hoạt động → 409 too_many_members; người đã tắt không tính", async () => {
    addMembers(3);
    raw.prepare("INSERT INTO members (id, name, role, active) VALUES ('off', 'Đã tắt', 'adult', 0)").run();
    expect((await call("POST", "/v1/settings/members", { name: "Thứ sáu" })).status).toBe(201);
    const res = await call("POST", "/v1/settings/members", { name: "Thứ bảy" });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe("too_many_members");
    expect(member("thu-bay")).toBeUndefined();
  });

  it("có mật khẩu riêng (≥ 8 ký tự) → người mới vào bằng mật khẩu riêng ngay, không qua mật khẩu chung; ngắn hơn → 400", async () => {
    expect((await call("POST", "/v1/settings/members", { name: "Con", password: "1234567" })).json.error).toMatchObject({ code: "invalid_input", field: "password" });
    const res = await call("POST", "/v1/settings/members", { name: "Con", password: "mat-khau-cua-con" });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ id: "con", has_password: true });
    expect((await login("con", "mat-khau-chung")).status).toBe(401);
    expect((await login("con", "mat-khau-cua-con")).status).toBe(200);
  });
});

describe("UC-507 AC-12: tắt / bật lại người", () => {
  it("tắt → biến khỏi màn đăng nhập, mọi phiên hết hiệu lực ngay, session_gen tăng, ví / tài khoản / giao dịch giữ nguyên; nhật ký, báo cả nhà", async () => {
    const wife = await cookieOf("wife");
    expect(await status(wife)).toBe(200);
    const kept = () => [
      raw.prepare("SELECT COUNT(*) n FROM wallets WHERE member_id = 'wife' AND active = 1").get(),
      raw.prepare("SELECT COUNT(*) n FROM accounts WHERE owner_member_id = 'wife' AND active = 1").get(),
    ];
    const before = kept();
    const res = await call("PATCH", "/v1/settings/members/wife", { active: false });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ id: "wife", active: false });
    expect(member("wife")).toMatchObject({ active: 0, session_gen: 1 });
    expect(await status(wife)).toBe(401);
    expect((await call("GET", "/v1/session/members", undefined, "none=1")).json.data).toEqual([{ id: "husband", name: "Chồng" }]);
    expect((await login("wife", "mat-khau-chung")).status).toBe(400);
    expect(kept()).toEqual(before);
    expect(auditActions()).toEqual([{ member_id: "husband", via: "token", action: "member.deactivate", target: "member:wife" }]);
    // Người vừa tắt không còn nhận tin; cả nhà còn lại được báo.
    expect(telegram.map((t) => t.chat_id)).toEqual(["1001"]);
  });

  it("tắt chủ hộ → 409 owner_required, kể cả qua token không kèm X-Member-Id", async () => {
    const res = await call("PATCH", "/v1/settings/members/husband", { active: false });
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe("owner_required");
    expect(member("husband")).toMatchObject({ active: 1, session_gen: 0 });
  });

  it("tự tắt mình qua cookie → được, phản hồi xoá cookie", async () => {
    const wife = await cookieOf("wife");
    const res = await call("PATCH", "/v1/settings/members/wife", { active: false }, wife);
    expect(res.status).toBe(200);
    expect(res.setCookie).toMatch(/pf_session=;/);
    expect(await status(wife)).toBe(401);
  });

  it("bật lại → đăng nhập lại được (cookie cũ vẫn hết hiệu lực); tính vào giới hạn 6 người; nhật ký member.activate", async () => {
    const old = await cookieOf("wife");
    await call("PATCH", "/v1/settings/members/wife", { active: false });
    addMembers(5); // chồng + 5 người = 6 đang hoạt động
    const full = await call("PATCH", "/v1/settings/members/wife", { active: true });
    expect(full.status).toBe(409);
    expect(full.json.error?.code).toBe("too_many_members");
    raw.prepare("UPDATE members SET active = 0 WHERE id = 'extra-5'").run();
    const res = await call("PATCH", "/v1/settings/members/wife", { active: true });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ active: true });
    expect(await status(old)).toBe(401);
    expect(await status(await cookieOf("wife"))).toBe(200);
    expect(auditActions().map((a) => a.action)).toEqual(["member.deactivate", "member.activate"]);
  });
});

describe("UC-507 AC-13: đặt / đổi / gỡ mật khẩu riêng", () => {
  const put = (id: string, body: Record<string, unknown>, cookie?: string) => call("PUT", `/v1/settings/members/${id}/password`, body, cookie);

  it("tự đặt bằng mật khẩu hiện tại (chung): lưu băm, phiên cũ hết hiệu lực, phản hồi cấp cookie riêng mới; nhật ký không ghi mật khẩu, không báo cả nhà", async () => {
    const wife = await cookieOf("wife");
    const res = await put("wife", { current: "mat-khau-chung", password: "mat-khau-rieng-vo" }, wife);
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ id: "wife", has_password: true });
    expect(member("wife")).toMatchObject({ session_gen: 1 });
    expect(String(member("wife")?.password_hash)).toMatch(/^pbkdf2-sha256\$20000\$/);
    expect(await status(wife)).toBe(401);
    const fresh = res.setCookie!.split(";")[0]!;
    expect(fresh).toMatch(/^pf_session=wife\.p\.1\./);
    expect(await status(fresh)).toBe(200);
    const log = raw.prepare("SELECT action, detail FROM audit_log").all();
    expect(log).toEqual([{ action: "member.password", detail: JSON.stringify({ set: true }) }]);
    expect(telegram).toEqual([]);
    expect((await login("wife", "mat-khau-chung")).status).toBe(401);
    expect((await login("wife", "mat-khau-rieng-vo")).status).toBe(200);
  });

  it("tự đổi: `current` phải là mật khẩu riêng đang dùng; tự gỡ (null) → quay về mật khẩu chung, cookie mới là cookie chung", async () => {
    raw.prepare("UPDATE members SET password_hash = ? WHERE id = 'wife'").run(await hashPassword("mat-khau-rieng-vo"));
    const wife = await cookieOf("wife", "mat-khau-rieng-vo");
    expect((await put("wife", { current: "mat-khau-chung", password: "mat-khau-moi-cua-vo" }, wife)).status).toBe(401);
    const removed = await put("wife", { current: "mat-khau-rieng-vo", password: null }, wife);
    expect(removed.status).toBe(200);
    expect(removed.json.data).toMatchObject({ has_password: false });
    const fresh = removed.setCookie!.split(";")[0]!;
    expect(fresh).toMatch(/^pf_session=wife\.h\.1\./);
    expect(await status(fresh)).toBe(200);
    expect(await status(wife)).toBe(401);
    expect((await login("wife", "mat-khau-chung")).status).toBe(200);
  });

  it("mật khẩu chung đúng → đổi / gỡ được cho bất kỳ ai, kể cả chủ hộ quên mật khẩu; đổi cho người khác thì báo cả nhà", async () => {
    raw.prepare("UPDATE members SET password_hash = ? WHERE id = 'husband'").run(await hashPassword("da-quen-mat-roi"));
    const wife = await cookieOf("wife");
    const res = await put("husband", { household_password: "mat-khau-chung", password: null }, wife);
    expect(res.status).toBe(200);
    expect(res.setCookie).toBeNull();
    expect(member("husband")).toMatchObject({ password_hash: null, session_gen: 1 });
    expect(telegram.map((t) => t.chat_id).sort()).toEqual(["1001", "2002"]);
    expect(telegram[0]!.text).toContain("gỡ mật khẩu riêng của Chồng");
    expect((await login("husband", "mat-khau-chung")).status).toBe(200);
  });

  it("gửi cả hai thì household_password được xét trước", async () => {
    const wife = await cookieOf("wife");
    const res = await put("wife", { household_password: "mat-khau-chung", current: "sai-bet", password: "mat-khau-rieng-vo" }, wife);
    expect(res.status).toBe(200);
  });

  it("token REST luôn phải có household_password; `current` không dùng được cho người khác", async () => {
    expect((await put("wife", { current: "mat-khau-chung", password: "mat-khau-rieng-vo" })).json.error).toMatchObject({ code: "invalid_input", field: "household_password" });
    const husband = await cookieOf("husband");
    expect((await put("wife", { current: "mat-khau-chung", password: "mat-khau-rieng-vo" }, husband)).status).toBe(400);
    expect((await put("wife", { household_password: "mat-khau-chung", password: "mat-khau-rieng-vo" })).status).toBe(200);
    expect(member("wife")).toMatchObject({ session_gen: 1 });
  });

  it("sai current / household_password → 401 wrong_password, tính vào bộ chặn dò; đang bị chặn → 429 trước khi so", async () => {
    const wife = await cookieOf("wife");
    const wrongCurrent = await put("wife", { current: "sai", password: "mat-khau-rieng-vo" }, wife);
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.json.error?.code).toBe("wrong_password");
    expect((await put("husband", { household_password: "sai", password: "mat-khau-rieng-vo" })).status).toBe(401);
    expect(failures()).toBe(2);
    raw.prepare("UPDATE auth_failures SET failures = 10 WHERE ip = ?").run(IP);
    const blocked = await put("wife", { household_password: "mat-khau-chung", password: "mat-khau-rieng-vo" });
    expect(blocked.status).toBe(429);
    expect(member("wife")).toMatchObject({ password_hash: null, session_gen: 0 });
  });

  it("null khi người đó chưa có mật khẩu riêng → 200, không đổi gì, không tăng session_gen; mật khẩu ngắn → 400", async () => {
    const res = await put("wife", { household_password: "mat-khau-chung", password: null });
    expect(res.status).toBe(200);
    expect(member("wife")).toMatchObject({ password_hash: null, session_gen: 0 });
    expect(auditActions()).toEqual([]);
    expect((await put("wife", { household_password: "mat-khau-chung", password: "ngan" })).json.error).toMatchObject({ code: "invalid_input", field: "password" });
    expect((await put("wife", { household_password: "mat-khau-chung" })).json.error).toMatchObject({ code: "invalid_input", field: "password" });
  });
});

describe("UC-507 AC-14: GET /v1/settings trả has_password", () => {
  it("mỗi thành viên có has_password: boolean, không bao giờ có băm, muối hay số vòng", async () => {
    raw.prepare("UPDATE members SET password_hash = ? WHERE id = 'wife'").run(await hashPassword("mat-khau-rieng-vo"));
    const res = await app.request("/v1/settings", { headers: { Authorization: "Bearer tok" } }, env);
    const text = await res.text();
    expect(text).not.toContain("pbkdf2");
    expect(text).not.toContain("password_hash");
    const { data } = JSON.parse(text) as { data: { members: { id: string; has_password: boolean }[] } };
    expect(data.members.map((m) => [m.id, m.has_password])).toEqual([
      ["husband", false],
      ["wife", true],
    ]);
  });
});

describe("UC-504: ví private của người đã tắt không còn bị ẩn", () => {
  it("tắt X → người khác thấy số ví private của X ở /v1/snapshot, /v1/budget, /v1/bootstrap; bật lại → ẩn như cũ", async () => {
    raw.prepare("UPDATE wallets SET private = 1 WHERE id = 'fun-wife'").run();
    raw.prepare(
      "INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, week_key, month_key, source) VALUES (date('now'), 700000, 'fund', 'fun-wife', 'income', '2026-W40', strftime('%Y-%m', 'now'), 'system')",
    ).run();
    const husband = await cookieOf("husband");
    const seen = async () => {
      const snapshot = (await call("GET", "/v1/snapshot", undefined, husband)).json.data as { wallets: { id: string; balance: number | null }[] };
      const budget = (await call("GET", "/v1/budget", undefined, husband)).json.data as { lines: { walletId: string; balance: number | null }[] };
      const bootstrap = (await call("GET", "/v1/bootstrap", undefined, husband)).json.data as { wallets: { id: string; hidden: boolean }[] };
      return {
        snapshot: snapshot.wallets.find((w) => w.id === "fun-wife")?.balance,
        budget: budget.lines.find((l) => l.walletId === "fun-wife")?.balance,
        hidden: bootstrap.wallets.find((w) => w.id === "fun-wife")?.hidden,
      };
    };
    expect(await seen()).toEqual({ snapshot: null, budget: null, hidden: true });
    await call("PATCH", "/v1/settings/members/wife", { active: false });
    expect(await seen()).toEqual({ snapshot: 700_000, budget: 700_000, hidden: false });
    await call("PATCH", "/v1/settings/members/wife", { active: true });
    expect(await seen()).toEqual({ snapshot: null, budget: null, hidden: true });
  });
});
