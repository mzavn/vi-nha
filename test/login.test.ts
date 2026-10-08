// UC-501: đăng nhập bằng mật khẩu chung + mật khẩu riêng tuỳ chọn; khoá ký phiên trong D1.
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { hashPassword } from "../src/services/passwords";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { MemoryKV } from "./helpers/oauth";

let raw: DatabaseSync;
let env: Env;
const IP = "203.0.113.7";
const WIFE_PASSWORD = "mat-khau-rieng-cua-vo";

beforeEach(() => {
  raw = openDb();
  env = { DB: asD1(raw), OAUTH_KV: new MemoryKV() as unknown as KVNamespace, API_TOKEN: "tok", APP_PASSWORD: "mat-khau-chung" } as Env;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const login = async (member_id: string, password: string) => {
  const res = await app.request(
    "/v1/session",
    { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": IP }, body: JSON.stringify({ member_id, password }) },
    env,
  );
  return { status: res.status, body: await res.json(), cookie: res.headers.get("Set-Cookie")?.split(";")[0] ?? "" };
};
const snapshot = async (cookie: string) => (await app.request("/v1/snapshot", { headers: { Cookie: cookie } }, env)).status;
const failures = () => raw.prepare("SELECT failures FROM auth_failures WHERE scope = 'login' AND ip = ?").get(IP)?.failures ?? 0;
const givePassword = async (id: string, password: string) =>
  raw.prepare("UPDATE members SET password_hash = ? WHERE id = ?").run(await hashPassword(password), id);

describe("UC-501 đăng nhập: mật khẩu chung + mật khẩu riêng tuỳ chọn", () => {
  it("AC-12: người chưa có mật khẩu riêng đăng nhập bằng mật khẩu chung như hiện nay", async () => {
    const res = await login("wife", "mat-khau-chung");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { member: { id: "wife", name: "Vợ" } } });
    expect(await snapshot(res.cookie)).toBe(200);
  });

  it("AC-13: người đã có mật khẩu riêng — mật khẩu chung bị 401, mật khẩu riêng vào được; sai lần nào cũng tính; lỗi không lộ ai có mật khẩu riêng", async () => {
    await givePassword("wife", WIFE_PASSWORD);
    const shared = await login("wife", "mat-khau-chung");
    expect(shared.status).toBe(401);
    expect(failures()).toBe(1);
    const wrongForPlain = await login("husband", "sai-mat-khau");
    expect(failures()).toBe(2);
    // Cùng một câu trả lời cho người có và không có mật khẩu riêng.
    expect(shared.body).toEqual(wrongForPlain.body);
    expect(shared.body).toEqual({ ok: false, error: { code: "wrong_password", message: "Sai mật khẩu." } });
    const own = await login("wife", WIFE_PASSWORD);
    expect(own.status).toBe(200);
    expect(await snapshot(own.cookie)).toBe(200);
    // Mật khẩu riêng của người này không mở được người khác.
    expect((await login("husband", WIFE_PASSWORD)).status).toBe(401);
  });

  it("AC-13: người lạ — sai mật khẩu thì 401 trước; đúng mật khẩu chung thì 400 unknown_member (giữ E2/AC-5)", async () => {
    expect((await login("nguoi-la", "sai")).status).toBe(401);
    const res = await login("nguoi-la", "mat-khau-chung");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "unknown_member" } });
  });

  describe("AC-14: khoá ký phiên tự sinh trong D1", () => {
    it("chưa đặt API_TOKEN: đăng nhập đúng thì phiên dùng được; REST bằng token vẫn bị khoá", async () => {
      env = { ...env, API_TOKEN: "" };
      const res = await login("wife", "mat-khau-chung");
      expect(res.status).toBe(200);
      expect(await snapshot(res.cookie)).toBe(200);
      expect((await app.request("/v1/snapshot", { headers: { Authorization: "Bearer " } }, env)).status).toBe(401);
    });

    it("khoá 32 byte ngẫu nhiên sinh một lần (hai lần đăng nhập đầu cùng lúc dùng cùng khoá), không API nào trả ra", async () => {
      expect(raw.prepare("SELECT v FROM config WHERE k = 'secret:session_key'").get()).toBeUndefined();
      const [a, b] = await Promise.all([login("wife", "mat-khau-chung"), login("husband", "mat-khau-chung")]);
      const keys = raw.prepare("SELECT v FROM config WHERE k = 'secret:session_key'").all();
      expect(keys).toHaveLength(1);
      const key = String(keys[0]!.v);
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(await snapshot(a.cookie)).toBe(200);
      expect(await snapshot(b.cookie)).toBe(200);
      const settings = await app.request("/v1/settings", { headers: { Cookie: a.cookie } }, env);
      expect(await settings.text()).not.toContain(key);
      // Đổi API_TOKEN không còn đụng phiên.
      env = { ...env, API_TOKEN: "token-moi" };
      expect(await snapshot(a.cookie)).toBe(200);
    });
  });

  describe("AC-15: phiên chung / phiên riêng", () => {
    it("đổi APP_PASSWORD: phiên vào bằng mật khẩu chung hết hiệu lực, phiên vào bằng mật khẩu riêng vẫn dùng được", async () => {
      await givePassword("wife", WIFE_PASSWORD);
      const husband = (await login("husband", "mat-khau-chung")).cookie;
      const wife = (await login("wife", WIFE_PASSWORD)).cookie;
      env = { ...env, APP_PASSWORD: "mat-khau-chung-moi" };
      expect(await snapshot(husband)).toBe(401);
      expect(await snapshot(wife)).toBe(200);
    });

    it("cookie chỉ mang member_id, cờ chung / riêng, session_gen, hạn và chữ ký — không mang băm hay mật khẩu", async () => {
      await givePassword("wife", WIFE_PASSWORD);
      const hash = String(raw.prepare("SELECT password_hash FROM members WHERE id = 'wife'").get()?.password_hash);
      const husband = (await login("husband", "mat-khau-chung")).cookie;
      const wife = (await login("wife", WIFE_PASSWORD)).cookie;
      expect(husband).toMatch(/^pf_session=husband\.h\.0\.\d+\.[A-Za-z0-9_-]{43}$/);
      expect(wife).toMatch(/^pf_session=wife\.p\.0\.\d+\.[A-Za-z0-9_-]{43}$/);
      for (const part of hash.split("$").slice(2)) expect(wife).not.toContain(part);
      expect(husband).not.toContain("mat-khau-chung");
    });

    it("cookie chung của người đã có mật khẩu riêng bị từ chối; đổi cờ hay session_gen trong cookie cũng không qua", async () => {
      const shared = (await login("wife", "mat-khau-chung")).cookie;
      expect(await snapshot(shared)).toBe(200);
      await givePassword("wife", WIFE_PASSWORD);
      expect(await snapshot(shared)).toBe(401);
      expect(await snapshot(shared.replace("wife.h.", "wife.p."))).toBe(401);
      const own = (await login("wife", WIFE_PASSWORD)).cookie;
      expect(await snapshot(own.replace("wife.p.0.", "wife.p.1."))).toBe(401);
      expect(await snapshot(own.replace("pf_session=wife.", "pf_session=husband."))).toBe(401);
    });

    it("đăng xuất mọi máy vẫn đăng xuất cả phiên vào bằng mật khẩu riêng", async () => {
      await givePassword("wife", WIFE_PASSWORD);
      const wife = (await login("wife", WIFE_PASSWORD)).cookie;
      const res = await app.request("/v1/session/revoke-all", { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: "{}" }, env);
      expect(res.status).toBe(200);
      expect(await snapshot(wife)).toBe(401);
    });
  });
});
