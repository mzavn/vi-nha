import { describe, expect, it } from "vitest";
import { connectedDate, connectionRows, revokePath, scopeLabel } from "./ai-connections";
import type { McpConnection } from "./types";

const conn = (over: Partial<McpConnection> = {}): McpConnection => ({
  grantId: "g1",
  memberId: "husband",
  memberName: "Chồng",
  clientName: "Claude",
  clientDomain: "claude.ai",
  redirectHost: "claude.ai",
  scopes: ["mcp:read", "mcp:write"],
  createdAt: "2026-10-08T02:30:00.000Z",
  ...over,
});
const NOW = new Date("2026-10-08T10:00:00Z");

describe("UC-508: quyền của kết nối Claude", () => {
  it("chỉ mcp:read là Xem, có thêm mcp:write là Xem + Ghi, không phụ thuộc thứ tự", () => {
    expect(scopeLabel(["mcp:read"])).toBe("Xem");
    expect(scopeLabel(["mcp:read", "mcp:write"])).toBe("Xem + Ghi");
    expect(scopeLabel(["mcp:write", "mcp:read"])).toBe("Xem + Ghi");
  });

  it("quyền lạ bị bỏ qua, không có quyền nào thì nói rõ", () => {
    expect(scopeLabel(["mcp:read", "offline_access"])).toBe("Xem");
    expect(scopeLabel([])).toBe("Không có quyền nào");
  });
});

describe("UC-508: ngày nối", () => {
  it("cùng năm chỉ hiện ngày/tháng theo giờ VN", () => {
    expect(connectedDate("2026-10-08T02:30:00.000Z", NOW)).toBe("nối ngày 8/10");
    // 23:30 UTC ngày 7 là 06:30 sáng 8/10 ở VN.
    expect(connectedDate("2026-10-07T23:30:00.000Z", NOW)).toBe("nối ngày 8/10");
  });

  it("khác năm thì kèm năm", () => {
    expect(connectedDate("2025-12-31T01:00:00.000Z", NOW)).toBe("nối ngày 31/12/2025");
  });
});

describe("UC-508: danh sách kết nối", () => {
  it("mỗi kết nối: tên ứng dụng, tên miền đã xác minh, của ai, quyền, ngày nối", () => {
    expect(connectionRows([conn({ scopes: ["mcp:read"] })], NOW)).toEqual([
      {
        key: "husband/g1",
        title: "Claude",
        domain: "claude.ai",
        sub: "của Chồng · Xem",
        sub2: "nối ngày 8/10",
        revokePath: "/v1/settings/mcp/husband/g1",
      },
    ]);
  });

  it("mới nối đứng trước", () => {
    const rows = connectionRows(
      [conn({ grantId: "old", createdAt: "2026-09-01T00:00:00.000Z" }), conn({ grantId: "new", memberId: "wife", memberName: "Vợ", clientName: "ChatGPT", clientDomain: "chatgpt.com", redirectHost: "chatgpt.com" })],
      NOW,
    );
    expect(rows.map((r) => r.key)).toEqual(["wife/new", "husband/old"]);
    expect(rows[0]).toMatchObject({ title: "ChatGPT", domain: "chatgpt.com", sub: "của Vợ · Xem + Ghi" });
  });

  it("không có tên miền xác minh thì hiện nơi chuyển về; tên ứng dụng trùng tên miền thì không lặp", () => {
    expect(connectionRows([conn({ clientDomain: null, redirectHost: "localhost" })], NOW)[0]!.domain).toBe("chuyển về localhost");
    expect(connectionRows([conn({ clientDomain: null, redirectHost: null })], NOW)[0]!.domain).toBeNull();
    expect(connectionRows([conn({ clientName: "claude.ai" })], NOW)[0]!.domain).toBeNull();
  });

  it("đường gỡ mã hoá mã người và mã grant", () => {
    expect(revokePath(conn({ memberId: "a b", grantId: "x/y" }))).toBe("/v1/settings/mcp/a%20b/x%2Fy");
  });
});
