import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/env";
import { SECURITY_HEADERS } from "../src/security-headers";
import { asD1, openDb, readSql } from "./helpers/d1-sqlite";

const env = (over: Partial<Env> = {}) => ({ DB: asD1(openDb()), API_TOKEN: "test-token", ...over }) as Env;

describe("GET /v1/health", () => {
  it("trả phiên bản schema, không cần token", async () => {
    const res = await app.request("/v1/health", {}, env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: "v1.30" });
  });

  it("báo 503 khi D1 chưa chạy migration", async () => {
    const empty = new DatabaseSync(":memory:");
    empty.exec("CREATE TABLE config (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    const res = await app.request("/v1/health", {}, env({ DB: asD1(empty) }));
    expect(res.status).toBe(503);
  });
});

describe("/v1/* cần Bearer token", () => {
  const call = (headers: Record<string, string>, e = env()) => app.request("/v1/wallets", { headers }, e);

  it("thiếu hoặc sai token → 401", async () => {
    expect((await call({})).status).toBe(401);
    expect((await call({ Authorization: "Bearer sai" })).status).toBe(401);
    expect((await call({ Authorization: "test-token" })).status).toBe(401);
  });

  it("đúng token → qua cửa (route chưa có nên 404 dạng JSON)", async () => {
    const res = await call({ Authorization: "Bearer test-token" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("API_TOKEN chưa cấu hình thì khoá hẳn, kể cả với token rỗng", async () => {
    const e = env({ API_TOKEN: "" });
    expect((await call({ Authorization: "Bearer " }, e)).status).toBe(401);
    expect((await call({}, e)).status).toBe(401);
  });
});

describe("header bảo mật (ADR-89)", () => {
  const expectSecure = (res: Response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name), name).toBe(value);
  };

  it("API, webhook và app shell qua Worker đều mang CSP, HSTS, nosniff, chặn nhúng khung — kể cả phản hồi lỗi", async () => {
    const shell = { fetch: async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }) } as unknown as Fetcher;
    const e = env({ ASSETS: shell });
    expectSecure(await app.request("/v1/health", {}, e));
    expectSecure(await app.request("/v1/wallets", {}, e)); // 401
    expectSecure(await app.request("/v1/khong-co", { headers: { Authorization: "Bearer test-token" } }, e)); // 404
    expectSecure(await app.request("/webhooks/sepay", { method: "POST", body: "{}" }, e)); // 401
    const page = await app.request("/", {}, e);
    expect(await page.text()).toBe("<!doctype html>");
    expectSecure(page);
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("script-src 'self';");
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    // Màn Hướng dẫn nhúng GitBook (UC-711 AC-13): chỉ đúng origin của GUIDE_URL được làm khung.
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("frame-src https://mzavn.gitbook.io;");
  });

  it("web/public/_headers (app shell do Static Assets phục vụ thẳng) giống hệt header Worker gắn", () => {
    const [path, ...rules] = readSql("web/public/_headers").trimEnd().split("\n");
    expect(path).toBe("/*");
    const parsed = rules.map((l) => /^ {2}([^:]+): (.+)$/.exec(l)?.slice(1));
    expect(Object.fromEntries(parsed.map((p) => p ?? []))).toEqual(SECURITY_HEADERS);
  });
});
