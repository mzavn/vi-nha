import { describe, expect, it } from "vitest";
import { bypassWorker, freshFor } from "./sw-fresh";

describe("freshFor: bao lâu service worker trả bản lưu không hỏi mạng", () => {
  it("cấu hình, danh mục, người thuê: 5 phút", () => {
    for (const p of ["/v1/bootstrap", "/v1/settings", "/v1/categories", "/v1/rental"]) expect(freshFor(p), p).toBe(300_000);
  });

  it("số tiền và danh sách hay đổi: 30 giây", () => {
    for (const p of [
      "/v1/snapshot",
      "/v1/budget",
      "/v1/accounts",
      "/v1/goals",
      "/v1/spend-by-category",
      "/v1/transfer-orders",
      "/v1/transactions",
      "/v1/logs",
      "/v1/push",
      "/v1/rental/tenants/t1/month",
    ])
      expect(freshFor(p), p).toBe(30_000);
  });

  it("đường con của nhóm 5 phút không thừa hưởng 5 phút", () => {
    expect(freshFor("/v1/rental/tenants/t1/month")).toBe(30_000);
    expect(freshFor("/v1/settings/accounts")).toBe(30_000);
  });

  it("health, thiết lập và phiên luôn hỏi mạng", () => {
    for (const p of ["/v1/health", "/v1/setup", "/v1/session", "/v1/session/members"]) expect(freshFor(p), p).toBe(0);
  });

  it("đường lạ: 30 giây", () => {
    expect(freshFor("/v1/tax/2026")).toBe(30_000);
  });
});

describe("UC-503: bypassWorker — đường của Worker service worker không đụng tới", () => {
  it("MCP, trang uỷ quyền OAuth, CSS của nó, metadata và webhook đi thẳng ra mạng", () => {
    for (const p of [
      "/mcp",
      "/oauth/authorize",
      "/oauth/token",
      "/oauth.css",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/mcp",
      "/webhooks/sepay",
    ])
      expect(bypassWorker(p), p).toBe(true);
  });

  it("app shell, API và đường gần giống vẫn qua service worker", () => {
    for (const p of ["/", "/index.html", "/assets/index.js", "/v1/settings/mcp", "/mcpx", "/oauthx", "/oauth.css.map"]) expect(bypassWorker(p), p).toBe(false);
  });
});
