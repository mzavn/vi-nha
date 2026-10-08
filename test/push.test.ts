import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { notifyMembers } from "../src/notify/telegram";
import { runScheduled } from "../src/cron";
import { daily } from "../src/cron/daily";
import { weekly } from "../src/cron/weekly";
import { createEntry } from "../src/services/ledger";
import { createTestSeries, isPushEndpoint, loadVapid, MAX_DEVICES_PER_MEMBER, PUSH_HOSTS, pushPayload, runTestSeries } from "../src/services/push";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;
let pushed: { url: string; headers: Record<string, string>; body: unknown }[];
let status: (url: string) => number;

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  pushed = [];
  status = () => 201;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      pushed.push({ url: String(url), headers: init.headers as Record<string, string>, body: init.body });
      return new Response(null, { status: status(String(url)) });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

type Json = { ok: boolean; data: any; error?: { code: string; message: string } };
async function call(method: string, path: string, body?: unknown, member = "husband", ctx?: ExecutionContext, extra: Record<string, string> = {}) {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: { Authorization: "Bearer tok", "X-Member-Id": member, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    ctx,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** Khoá riêng của từng "máy" theo p256dh, để giải mã payload như trình duyệt thật. */
const browserPrivate = new Map<string, CryptoKey>();

/** Khoá thật của một trình duyệt giả: push service chỉ nhận payload mã hoá bằng khoá công khai hợp lệ. */
async function browserKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = b64url((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  browserPrivate.set(p256dh, pair.privateKey);
  return { p256dh, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

/** Giải mã aes128gcm (RFC 8188 + 8291) như trình duyệt nhận push: header salt|rs|idlen|khoá máy chủ, rồi một record. */
async function decrypt(endpoint: string, body: Uint8Array): Promise<Record<string, string>> {
  const { p256dh, auth } = raw.prepare("SELECT p256dh, auth FROM push_subscriptions WHERE endpoint = ?").get(endpoint) as { p256dh: string; auth: string };
  const enc = new TextEncoder();
  const hkdf = async (salt: Uint8Array, ikm: BufferSource, info: Uint8Array, bits: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bits));
  const salt = body.slice(0, 16);
  const serverPublic = body.slice(21, 21 + body[20]!);
  const server = await crypto.subtle.importKey("raw", serverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // Test chạy trên Node (khoá tên `public` theo chuẩn Web Crypto); kiểu workers-types gọi nó là `$public`.
  const ecdh = { name: "ECDH", public: server } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = await crypto.subtle.deriveBits(ecdh, browserPrivate.get(p256dh)!, 256);
  const ikm = await hkdf(fromB64url(auth), shared, new Uint8Array([...enc.encode("WebPush: info\0"), ...fromB64url(p256dh), ...serverPublic]), 256);
  const cek = await crypto.subtle.importKey("raw", await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 128), "AES-GCM", false, ["decrypt"]);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 96);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cek, body.slice(21 + serverPublic.length)));
  return JSON.parse(new TextDecoder().decode(padded.slice(0, padded.lastIndexOf(2))));
}

/** Push service thật (FCM) — endpoint ngoài PUSH_HOSTS bị từ chối. */
const FCM = "https://fcm.googleapis.com/fcm/send";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

/** Nhãn máy lấy từ header User-Agent của chính request, như trình duyệt gửi. */
async function subscribe(member: string, endpoint: string, ua = IPHONE) {
  return call("POST", "/v1/push/subscriptions", { endpoint, keys: await browserKeys() }, member, undefined, { "User-Agent": ua });
}

describe("khoá VAPID", () => {
  it("sinh một lần ở lần GET đầu, giữ nguyên về sau; khoá riêng không bao giờ ra API", async () => {
    const first = await call("GET", "/v1/push");
    const second = await call("GET", "/v1/push");
    expect(first.status).toBe(200);
    const publicKey = first.json.data.publicKey as string;
    expect(second.json.data.publicKey).toBe(publicKey);
    expect(fromB64url(publicKey)).toHaveLength(65);
    expect(fromB64url(publicKey)[0]).toBe(4);

    const jwk = JSON.parse((raw.prepare("SELECT v FROM config WHERE k = 'secret:vapid_private_jwk'").get() as { v: string }).v) as JsonWebKey;
    expect(JSON.stringify(first.json)).not.toContain(jwk.d!);
    expect(JSON.stringify(second.json)).not.toContain(jwk.d!);
    expect(raw.prepare("SELECT v FROM config WHERE k = 'vapid_subject'").get()).toEqual({ v: "https://app.example.com" });
    expect((raw.prepare("SELECT COUNT(*) AS n FROM config WHERE k LIKE '%vapid%'").get() as { n: number }).n).toBe(3);
  });

  it("JWT gửi kèm push ký bằng đúng khoá riêng ứng với khoá công khai đã đưa cho trình duyệt", async () => {
    const { json } = await call("GET", "/v1/push");
    await subscribe("husband", `${FCM}/a`);
    expect((await call("POST", "/v1/push/test", {})).json.data).toEqual({ sent: 1, failed: 0 });
    const auth = pushed[0]!.headers.authorization!;
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
    expect(k).toBe(json.data.publicKey);
    const [h, p, s] = jwt!.split(".");
    const key = await crypto.subtle.importKey("raw", fromB64url(k!), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromB64url(s!), new TextEncoder().encode(`${h}.${p}`))).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(fromB64url(p!)))).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://app.example.com" });
  });
});

describe("đăng ký máy", () => {
  it("cùng endpoint đăng ký lại thì cập nhật (200) và chuyển sang người đang đăng nhập", async () => {
    const created = await subscribe("husband", `${FCM}/may-chung`);
    expect(created.status).toBe(201);
    const again = await subscribe("wife", `${FCM}/may-chung`);
    expect(again.status).toBe(200);
    expect(again.json.data.id).toBe(created.json.data.id);
    expect(raw.prepare("SELECT member_id FROM push_subscriptions").all()).toEqual([{ member_id: "wife" }]);

    const list = (await call("GET", "/v1/push", undefined, "husband")).json.data.subscriptions;
    expect(list).toEqual([
      { id: created.json.data.id, memberId: "wife", memberName: "Vợ", device: "iPhone · Safari", createdAt: expect.any(String), lastOkAt: null, mine: false },
    ]);
  });

  it("từ chối endpoint không phải https và khoá không phải base64url", async () => {
    const keys = await browserKeys();
    expect((await call("POST", "/v1/push/subscriptions", { endpoint: "http://fcm.googleapis.com/fcm/send/a", keys })).status).toBe(400);
    expect((await call("POST", "/v1/push/subscriptions", { endpoint: `${FCM}/${"x".repeat(1000)}`, keys })).status).toBe(400);
    expect((await call("POST", "/v1/push/subscriptions", { endpoint: `${FCM}/a`, keys: { ...keys, auth: "a+b/c" } })).status).toBe(400);
  });

  it("gỡ theo endpoint, của ai cũng được; gỡ lần hai báo 0", async () => {
    await subscribe("wife", `${FCM}/a`);
    expect((await call("POST", "/v1/push/subscriptions/remove", { endpoint: `${FCM}/a` }, "husband")).json.data).toEqual({ removed: 1 });
    expect((await call("POST", "/v1/push/subscriptions/remove", { endpoint: `${FCM}/a` }, "husband")).json.data).toEqual({ removed: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get()).toEqual({ n: 0 });
  });

  it("chỉ nhận endpoint của push service thật (FCM, Mozilla, Apple, Microsoft); URL https khác bị từ chối, không ghi gì", async () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGabc",
      "https://api.push.apple.com/3/device/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) {
      expect(isPushEndpoint(new URL(ok))).toBe(true);
    }
    const bad = [
      "https://attacker.example/p",
      "https://fcm.googleapis.com.attacker.example/p",
      "https://evilpush.apple.com/p",
      "https://push.apple.com.evil/p",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user:pw@fcm.googleapis.com/fcm/send/abc",
    ];
    for (const endpoint of bad) {
      expect(isPushEndpoint(new URL(endpoint))).toBe(false);
      const res = await call("POST", "/v1/push/subscriptions", { endpoint, keys: await browserKeys() });
      expect(res.status).toBe(400);
    }
    expect(raw.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get()).toEqual({ n: 0 });
    expect(PUSH_HOSTS.exact).toContain("fcm.googleapis.com");
  });

  it("nhãn máy lấy từ User-Agent của request, không nhận user_agent trong body", async () => {
    const res = await call(
      "POST",
      "/v1/push/subscriptions",
      { endpoint: `${FCM}/a`, keys: await browserKeys(), user_agent: IPHONE },
      "husband",
      undefined,
      { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36" },
    );
    expect(res.status).toBe(201);
    expect((await call("GET", "/v1/push")).json.data.subscriptions[0].device).toBe("Android · Chrome");
  });

  it("gỡ một máy theo id, của ai cũng được (máy lạ gỡ được từ Cài đặt); gỡ lại báo 404; có nhật ký", async () => {
    const { json } = await subscribe("wife", `${FCM}/may-la`);
    const res = await call("DELETE", `/v1/push/subscriptions/${json.data.id}`, {}, "husband");
    expect(res.status).toBe(200);
    expect(res.json.data).toEqual({ removed: 1 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get()).toEqual({ n: 0 });
    expect((await call("DELETE", `/v1/push/subscriptions/${json.data.id}`, {}, "husband")).status).toBe(404);
    expect((await call("DELETE", "/v1/push/subscriptions/abc", {}, "husband")).status).toBe(400);
    expect(raw.prepare("SELECT member_id, via, action, target, detail FROM audit_log ORDER BY id").all()).toEqual([
      { member_id: "wife", via: "token", action: "push.add", target: `push:${json.data.id}`, detail: '{"member_id":"wife","device":"iPhone · Safari"}' },
      { member_id: "husband", via: "token", action: "push.remove", target: `push:${json.data.id}`, detail: '{"member_id":"wife","device":"iPhone · Safari"}' },
    ]);
  });

  it("mỗi người tối đa 10 máy: máy thứ 11 (kể cả máy chuyển từ người khác) bị từ chối 409; đăng ký lại máy đã có vẫn được", async () => {
    for (let i = 0; i < MAX_DEVICES_PER_MEMBER; i++) expect((await subscribe("husband", `${FCM}/anh-${i}`)).status).toBe(201);
    const eleventh = await subscribe("husband", `${FCM}/anh-moi`);
    expect(eleventh.status).toBe(409);
    expect(eleventh.json.error?.code).toBe("too_many_devices");
    await subscribe("wife", `${FCM}/cua-vo`);
    expect((await subscribe("husband", `${FCM}/cua-vo`)).status).toBe(409);
    expect((await subscribe("husband", `${FCM}/anh-3`)).status).toBe(200);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE member_id = 'husband'").get()).toEqual({ n: 10 });
  });

  it("thêm máy mới (hay chuyển máy sang người khác) thì cảnh báo mọi kênh của cả nhà; đăng ký lại máy của chính mình thì không", async () => {
    raw.prepare("INSERT INTO config (k, v) VALUES ('secret:telegram_bot_token', '123456:telegram-token-xyz')").run();
    raw.prepare("UPDATE members SET tg_chat_id = '1001' WHERE id = 'husband'").run();
    const android = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";
    await subscribe("wife", `${FCM}/vo`, android);
    const telegram = () => pushed.filter((p) => p.url.includes("api.telegram.org")).map((p) => JSON.parse(String(p.body)) as { chat_id: string; text: string });
    expect(telegram()).toEqual([
      expect.objectContaining({ chat_id: "1001", text: "⚠️ Vợ (qua API token) vừa thêm máy nhận thông báo: Android · Chrome — nếu không phải người nhà làm, vào Cài đặt gỡ ngay." }),
    ]);
    await subscribe("wife", `${FCM}/vo`, android);
    expect(telegram()).toHaveLength(1);
    await subscribe("husband", `${FCM}/vo`, android);
    expect(telegram()).toHaveLength(2);
    expect(raw.prepare("SELECT action, member_id FROM audit_log ORDER BY id").all()).toEqual([
      { action: "push.add", member_id: "wife" },
      { action: "push.add", member_id: "husband" },
    ]);
  });
});

describe("gửi thử", () => {
  it("chưa có máy nào của mình thì 409 no_subscription", async () => {
    await subscribe("wife", `${FCM}/cua-vo`);
    const res = await call("POST", "/v1/push/test", {}, "husband");
    expect(res.status).toBe(409);
    expect(res.json.error?.code).toBe("no_subscription");
    expect(pushed).toHaveLength(0);
  });

  it("chỉ gửi tới máy của người đang đăng nhập, ưu tiên cao, ghi last_ok_at", async () => {
    await subscribe("husband", `${FCM}/a`);
    await subscribe("wife", `${FCM}/b`);
    expect((await call("POST", "/v1/push/test", {}, "husband")).json.data).toEqual({ sent: 1, failed: 0 });
    expect(pushed.map((p) => p.url)).toEqual([`${FCM}/a`]);
    expect(pushed[0]!.headers).toMatchObject({ urgency: "high", ttl: "86400", "content-encoding": "aes128gcm" });
    expect(raw.prepare("SELECT endpoint FROM push_subscriptions WHERE last_ok_at IS NOT NULL").all()).toEqual([{ endpoint: `${FCM}/a` }]);
  });
});

describe("notifyMembers qua push", () => {
  const message = { full: "<b>Chào</b> buổi sáng", push: { title: "Còn 3.250.000 ₫ tuần này", body: "Không có việc cần làm · đối soát khớp" } };

  beforeEach(async () => {
    await call("GET", "/v1/push"); // sinh khoá VAPID như khi có người mở Cài đặt
    await subscribe("husband", `${FCM}/a`);
    await subscribe("wife", `${FCM}/b`);
    pushed = [];
  });

  it("không có token Telegram vẫn đẩy tới mọi máy; chạy lại cùng (kind, day_key) không gửi thêm", async () => {
    expect(await notifyMembers(env, "daily", "2026-10-01", message)).toBe(2);
    expect(pushed.map((p) => p.url).sort()).toEqual([`${FCM}/a`, `${FCM}/b`]);
    expect(pushed[0]!.headers).toMatchObject({ urgency: "normal", ttl: "86400" });
    expect(raw.prepare("SELECT chat_id, ok FROM notifications WHERE kind = 'daily' ORDER BY chat_id").all()).toEqual([
      { chat_id: "push:1", ok: 1 },
      { chat_id: "push:2", ok: 1 },
    ]);

    pushed = [];
    expect(await notifyMembers(env, "daily", "2026-10-01", message)).toBe(0);
    expect(pushed).toHaveLength(0);
  });

  it("đếm cả Telegram lẫn push", async () => {
    raw.prepare("UPDATE members SET tg_chat_id = '111' WHERE id = 'husband'").run();
    env.TG_BOT_TOKEN = "123:tok";
    expect(await notifyMembers(env, "weekly", "2026-W40", message)).toBe(3);
    expect(pushed.filter((p) => p.url.startsWith("https://api.telegram.org/"))).toHaveLength(1);
  });

  it("tin sáng: Telegram nhận bản đầy đủ, máy nhận bản ngắn mở màn Hôm nay; notifications lưu đúng bản đã gửi", async () => {
    raw.prepare("UPDATE members SET tg_chat_id = '111' WHERE id = 'husband'").run();
    env.TG_BOT_TOKEN = "123:tok";
    await daily(env, new Date("2026-09-22T00:00:00Z")); // 07:00 VN thứ Ba

    const tg = pushed.filter((p) => p.url.startsWith("https://api.telegram.org/")).map((p) => JSON.parse(p.body as string).text as string);
    expect(tg).toHaveLength(1);
    expect(tg[0]!.split("\n")[0]).toBe("💰 Còn để chi tuần này: 0 ₫ (6 ngày)");
    expect(tg[0]).toContain("🏦 Đối soát");

    const devices = pushed.filter((p) => p.url.startsWith(`${FCM}/`));
    expect(devices).toHaveLength(2);
    const payload = await decrypt(devices[0]!.url, devices[0]!.body as Uint8Array);
    expect(payload).toMatchObject({ title: "Còn 0 ₫ tuần này", url: "/#today", tag: "daily" });
    expect(payload.body).not.toContain("💰");
    expect(Array.from(payload.body!).length).toBeLessThanOrEqual(150);

    const rows = raw.prepare("SELECT chat_id, payload FROM notifications WHERE kind = 'daily' ORDER BY chat_id").all() as { chat_id: string; payload: string }[];
    expect(rows).toEqual([
      { chat_id: "111", payload: tg[0] },
      { chat_id: "push:1", payload: `${payload.title}\n${payload.body}` },
      { chat_id: "push:2", payload: `${payload.title}\n${payload.body}` },
    ]);
  });

  it("tổng kết tuần: máy nhận tiêu đề tổng chi cả tuần (spend trừ refund, mọi danh mục), mở màn Ví", async () => {
    raw.prepare("UPDATE accounts SET sepay_enabled = 0").run(); // tài khoản ghi tay mới nhận nhập tay (D14)
    const entry = (meaning: "spend" | "refund", amount: number, category_id: string, at: string, link_id?: number) =>
      createEntry(env.DB, { meaning, amount, category_id, account_id: "vcb-husband", at, link_id }, null, new Date(at));
    await entry("spend", 400_000, "groceries", "2026-09-23T10:00:00+07:00");
    const grab = await entry("spend", 80_000, "ride-hailing", "2026-09-26T10:00:00+07:00");
    await entry("refund", 20_000, "ride-hailing", "2026-09-26T12:00:00+07:00", Number(grab.tx!.id));
    await entry("spend", 500_000, "groceries", "2026-09-14T10:00:00+07:00"); // tuần trước — không tính

    await weekly(env, new Date("2026-09-28T01:00:00Z")); // 08:00 VN thứ Hai, tổng kết W39

    const payload = await decrypt(pushed[0]!.url, pushed[0]!.body as Uint8Array);
    expect(payload).toMatchObject({ title: "Tuần T39: chi 460.000 ₫", url: "/#wallets", tag: "weekly" });
  });

  it("push service trả 410 thì xoá máy đó, claim giữ ok=0; máy khác vẫn nhận", async () => {
    status = (url) => (url.endsWith("/a") ? 410 : 201);
    expect(await notifyMembers(env, "pending_batch", "2026-10-01T03:00:00Z", message)).toBe(1);
    expect(raw.prepare("SELECT endpoint FROM push_subscriptions").all()).toEqual([{ endpoint: `${FCM}/b` }]);
    expect(raw.prepare("SELECT chat_id, ok FROM notifications WHERE kind = 'pending_batch' ORDER BY chat_id").all()).toEqual([
      { chat_id: "push:1", ok: 0 },
      { chat_id: "push:2", ok: 1 },
    ]);
  });

  it("chưa có khoá VAPID (chưa ai mở app) thì bỏ qua push, không tự sinh", async () => {
    raw.prepare("DELETE FROM config WHERE k LIKE '%vapid%'").run();
    expect(await notifyMembers(env, "daily", "2026-10-02", message)).toBe(0);
    expect(pushed).toHaveLength(0);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM config WHERE k LIKE '%vapid%'").get()).toEqual({ n: 0 });
  });

  it("thành viên đã nghỉ không nhận", async () => {
    raw.prepare("UPDATE members SET active = 0 WHERE id = 'wife'").run();
    expect(await notifyMembers(env, "daily", "2026-10-03", message)).toBe(1);
    expect(pushed.map((p) => p.url)).toEqual([`${FCM}/a`]);
  });
});

describe("thử khi tắt app (lượt gửi thử)", () => {
  const series = () => raw.prepare("SELECT id, member_id, count, interval_s, status, sent FROM push_test_series ORDER BY id").all();
  let sleeps: number[];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  /** ExecutionContext giả: giữ việc chạy nền lại; setTimeout bị làm giả nên giấc ngủ 10 giây của nó không bao giờ chạy. */
  let background: Promise<unknown>[];
  const ctx = { waitUntil: (p: Promise<unknown>) => void background.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;
  const start = (body: unknown = {}, member = "husband") => call("POST", "/v1/push/test-series", body, member, ctx);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    sleeps = [];
    background = [];
    await call("GET", "/v1/push");
    await subscribe("husband", `${FCM}/a`);
    pushed = [];
  });
  afterEach(() => vi.useRealTimers());

  it("bấm nút trả lời ngay (mặc định 2 tin cách 10 giây), việc gửi chạy nền qua waitUntil; tham số ngoài khoảng thì 400", async () => {
    const res = await start();
    expect(res.status).toBe(201);
    expect(res.json.data).toEqual({ id: 1, count: 2, interval_s: 10 });
    expect(background).toHaveLength(1);
    expect(pushed).toHaveLength(0);
    expect(series()).toEqual([{ id: 1, member_id: "husband", count: 2, interval_s: 10, status: "running", sent: 0 }]);

    for (const bad of [{ count: 0 }, { count: 3 }, { count: 1.5 }, { count: "2" }, { interval_s: 5 }, { interval_s: 15 }]) {
      expect((await start(bad)).status).toBe(400);
    }
    expect(background).toHaveLength(1);
  });

  it("chưa có máy của mình thì 409 no_subscription; đang có lượt chạy thì 409 series_running; huỷ xong thì bấm lại được", async () => {
    const none = await start({}, "wife");
    expect(none.status).toBe(409);
    expect(none.json.error?.code).toBe("no_subscription");

    expect((await start()).status).toBe(201);
    const again = await start();
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("series_running");
    expect((await call("POST", "/v1/push/test-series/cancel", {})).json.data).toEqual({ cancelled: 1 });
    expect((await start()).status).toBe(201);
  });

  it("GET /v1/push trả lượt gần nhất của mình (trong 15 phút), không trả của người khác", async () => {
    expect((await call("GET", "/v1/push")).json.data.series).toBeNull();
    await start({ count: 1 });
    expect((await call("GET", "/v1/push")).json.data.series).toEqual({ id: 1, status: "running", sent: 0, count: 1, interval_s: 10, createdAt: expect.any(String) });
    expect((await call("GET", "/v1/push", undefined, "wife")).json.data.series).toBeNull();
    raw.prepare("UPDATE push_test_series SET created_at = datetime('now', '-16 minutes')").run();
    expect((await call("GET", "/v1/push")).json.data.series).toBeNull();
  });

  it("chờ 10 giây rồi gửi tin 1, cách interval_s giây gửi tin 2, tới mọi máy của người hẹn, tag riêng từng tin", async () => {
    await subscribe("husband", `${FCM}/a2`);
    await subscribe("wife", `${FCM}/b`);
    pushed = [];
    await runTestSeries(env, await createTestSeries(env, "husband", {}), (await loadVapid(env))!, sleep);

    expect(sleeps).toEqual([10_000, 10_000]);
    expect(pushed.map((p) => p.url)).toEqual([`${FCM}/a`, `${FCM}/a2`, `${FCM}/a`, `${FCM}/a2`]);
    expect(pushed[0]!.headers).toMatchObject({ urgency: "high", ttl: "300" });
    const payloads = await Promise.all(pushed.map((p) => decrypt(p.url, p.body as Uint8Array)));
    expect(payloads.map((p) => p.tag)).toEqual(["test-series-1-1", "test-series-1-1", "test-series-1-2", "test-series-1-2"]);
    expect(payloads[2]).toEqual({ title: "Thử khi tắt app", body: "Tin 2/2 — thấy tin này khi app đã tắt là thông báo chạy tốt.", url: "/#settings", tag: "test-series-1-2" });
    expect(series()).toEqual([{ id: 1, member_id: "husband", count: 2, interval_s: 10, status: "done", sent: 2 }]);
  });

  it("huỷ giữa chừng thì dừng trước tin kế tiếp; huỷ chỉ đụng lượt của mình", async () => {
    await subscribe("wife", `${FCM}/b`);
    await createTestSeries(env, "wife", {});
    const mine = await createTestSeries(env, "husband", {});
    pushed = [];
    let cancelled: unknown;
    const cancelAfterFirst = async (ms: number) => {
      sleeps.push(ms);
      if (sleeps.length === 2) cancelled = (await call("POST", "/v1/push/test-series/cancel", {})).json.data;
    };
    await runTestSeries(env, mine, (await loadVapid(env))!, cancelAfterFirst);
    expect(cancelled).toEqual({ cancelled: 1 });
    expect(pushed.map((p) => p.url)).toEqual([`${FCM}/a`]);
    expect(series()).toMatchObject([
      { member_id: "wife", status: "running" },
      { member_id: "husband", status: "cancelled", sent: 1 },
    ]);
  });

  it("máy bị gỡ trong lúc chờ thì kết thúc, không gửi", async () => {
    const s = await createTestSeries(env, "husband", {});
    raw.prepare("DELETE FROM push_subscriptions").run();
    await runTestSeries(env, s, (await loadVapid(env))!, sleep);
    expect(pushed).toHaveLength(0);
    expect(sleeps).toEqual([10_000]);
    expect(series()).toMatchObject([{ status: "done", sent: 0 }]);
  });

  /** Đồng hồ thật: tắt tin theo giờ và giờ yên lặng để lượt cron chỉ còn hai việc đang thử, chạy giờ nào cũng như nhau. */
  const onlyHousekeeping = () =>
    raw.exec(`UPDATE config SET v = CASE k WHEN 'notify_quiet_start' THEN '00:00' WHEN 'notify_quiet_end' THEN '00:00' ELSE '0' END
      WHERE k IN ('notify_daily_enabled', 'notify_weekly_enabled', 'notify_quiet_start', 'notify_quiet_end')`);

  it("lượt cron huỷ lượt kẹt quá 10 phút, không đụng lượt đang chạy, không gửi gì", async () => {
    onlyHousekeeping();
    raw.exec(`INSERT INTO push_test_series (member_id, count, interval_s, status, created_at) VALUES
      ('husband', 2, 10, 'running', datetime('now', '-11 minutes')),
      ('wife', 2, 10, 'pending', datetime('now', '-11 minutes')),
      ('husband', 2, 10, 'running', datetime('now'))`);
    await runScheduled("*/15 0-17,21-23 * * *", env, new Date());
    expect(series()).toMatchObject([{ status: "cancelled" }, { status: "cancelled" }, { status: "running" }]);
    expect(pushed).toHaveLength(0);
  });

  it("lượt cron: báo giao dịch chưa gán lỗi vẫn dọn lượt kẹt, rồi báo lỗi ra ngoài", async () => {
    onlyHousekeeping();
    raw.exec("INSERT INTO push_test_series (member_id, count, interval_s, status, created_at) VALUES ('husband', 2, 10, 'running', datetime('now', '-11 minutes'))");
    raw.exec("DROP TABLE bank_logs");
    await expect(runScheduled("*/15 0-17,21-23 * * *", env, new Date())).rejects.toThrow();
    expect(series()).toMatchObject([{ status: "cancelled" }]);
  });
});

describe("nội dung push", () => {
  it("giữ nguyên tiêu đề và nội dung đã dựng; đường mở theo loại tin", () => {
    const push = { title: "2 giao dịch chưa gán", body: "−24.400 ₫ MB · +50.000 ₫ TK lạ" };
    expect(pushPayload("pending_batch", push)).toEqual({ ...push, url: "/#assign", tag: "pending_batch" });
    expect(pushPayload("weekly", push)).toMatchObject({ url: "/#wallets", tag: "weekly" });
    expect(pushPayload("test", push)).toMatchObject({ url: "/#settings" });
    expect(pushPayload("other", push)).toMatchObject({ url: "/", tag: "other" });
  });
});
