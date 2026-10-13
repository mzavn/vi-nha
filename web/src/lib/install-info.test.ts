import { describe, expect, it } from "vitest";
import { githubRepo, installInfo } from "./install-info";

describe("UC-709 AC-31: tên repo lấy lúc build", () => {
  it("chỉ lấy chủ/tên của GitHub, bỏ khoá trong địa chỉ, bỏ đuôi .git", () => {
    expect(githubRepo("https://x-access-token:abc@github.com/an/vi-nha.git")).toBe("an/vi-nha");
    expect(githubRepo("git@github.com:an/vi-nha.git")).toBe("an/vi-nha");
    expect(githubRepo("ssh://git@github.com/an/vi-nha")).toBe("an/vi-nha");
    expect(githubRepo("https://github.com/an/vi-nha")).toBe("an/vi-nha");
    expect(githubRepo("https://github.com/An-Nguyen/vi.nha_2/")).toBe("An-Nguyen/vi.nha_2");
  });

  it("không phải GitHub, đường lạ hay chữ lạ thì không có repo", () => {
    expect(githubRepo("https://gitlab.com/an/vi-nha.git")).toBe("");
    expect(githubRepo("https://github.com/an/vi-nha/../x")).toBe("");
    expect(githubRepo("https://github.com/an/vi nha")).toBe("");
    expect(githubRepo("https://evil.com/github.com/an/vi-nha")).toBe("");
    expect(githubRepo("")).toBe("");
  });

  it("build trên Cloudflare mới đọc remote; build trên máy luôn là build trên máy", () => {
    let reads = 0;
    const remote = () => {
      reads += 1;
      return "https://x-access-token:abc@github.com/an/vi-nha.git";
    };
    expect(installInfo("1", remote)).toEqual({ builtBy: "cloudflare", repo: "an/vi-nha" });
    expect(installInfo("1", () => null)).toEqual({ builtBy: "cloudflare", repo: "" });
    reads = 0;
    expect(installInfo(undefined, remote)).toEqual({ builtBy: "local", repo: "" });
    expect(reads).toBe(0);
  });
});
