import { describe, expect, it } from "vitest";
import { compareVersions, releaseTag, updateView } from "./app-update";

describe("UC-709 AC-30: so phiên bản, đọc bản phát hành", () => {
  it("so theo số, có hay không có v đều được; không phải X.Y.Z thì không so", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.1", "1.0.1")).toBe(0);
    expect(compareVersions("1.0.1", "v1.1.0")).toBeLessThan(0);
    expect(compareVersions("nightly", "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBeNull();
  });

  it("tag của bản phát hành mới nhất phải là X.Y.Z", () => {
    expect(releaseTag({ tag_name: "v1.1.0", html_url: "https://evil.example" })).toBe("1.1.0");
    expect(releaseTag({ tag_name: "nightly" })).toBeNull();
    expect(releaseTag({})).toBeNull();
    expect(releaseTag(null)).toBeNull();
  });
});

describe("UC-709 AC-30: chỉ đúng cách cập nhật theo cách đã cài", () => {
  const deployButton = { builtBy: "cloudflare", repo: "an/vi-nha" } as const;

  it("có bản mới, cài bằng nút Deploy: nút Cập nhật mở trang workflow của repo nhà", () => {
    expect(updateView("1.0.1", "1.1.0", deployButton)).toEqual({
      state: "newer",
      text: "Có bản mới 1.1.0.",
      notesUrl: "https://github.com/mzavn/vi-nha/releases/tag/v1.1.0",
      action: { kind: "workflow", url: "https://github.com/an/vi-nha/actions/workflows/update.yml" },
    });
  });

  it("Cloudflare build nhưng không biết repo: chỉ đường Actions; build trên máy: lệnh cập nhật", () => {
    expect(updateView("1.0.1", "1.1.0", { builtBy: "cloudflare", repo: "" })).toMatchObject({ action: { kind: "actions-hint" } });
    expect(updateView("1.0.1", "1.1.0", { builtBy: "local", repo: "" })).toMatchObject({
      action: { kind: "command", command: "git pull --autostash && npm ci && npm run deploy" },
    });
  });

  it("bản trên GitHub bằng hoặc cũ hơn: đang dùng bản mới nhất", () => {
    expect(updateView("1.1.0", "1.1.0", deployButton)).toEqual({ state: "latest", text: "Đang dùng bản mới nhất (1.1.0)." });
    expect(updateView("1.2.0", "1.1.0", deployButton)).toEqual({ state: "latest", text: "Đang dùng bản mới nhất (1.2.0)." });
  });
});
