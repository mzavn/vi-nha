// Workflow "Cập nhật Ví nhà" (scripts/update-from-upstream.mjs): gộp wrangler.jsonc và áp một bản phát hành vào repo của nhà.
// Repo thật bằng git trong thư mục tạm; "upstream" là repo cục bộ (--from), không gọi mạng.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyRelease, compareVersions, mergeWranglerConfig, parseJsonc } from "../scripts/update-from-upstream.mjs";

const UPSTREAM_WRANGLER = `{
  "name": "vi-nha",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01", // ngày tương thích
  /* tự tạo khi deploy lần đầu */
  "workers_dev": true,
  "d1_databases": [{ "binding": "DB", "database_name": "vi-nha", "migrations_dir": "migrations" }],
  "kv_namespaces": [{ "binding": "OAUTH_KV" }],
  "triggers": { "crons": ["*/15 * * * *",] },
}
`;
/** Bản Cloudflare ghi vào repo nhà lúc bấm nút Deploy: tên, id D1 / KV. */
const HOME_WRANGLER = `{
  "name": "vi-nha-an",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "account_id": "acc-an",
  "workers_dev": false,
  "routes": [{ "pattern": "tien.an.vn", "custom_domain": true }],
  "d1_databases": [{ "binding": "DB", "database_name": "vi-nha-an", "database_id": "d1-an", "migrations_dir": "migrations" }],
  "kv_namespaces": [{ "binding": "OAUTH_KV", "id": "kv-an" }],
  "triggers": { "crons": ["*/15 * * * *"] }
}
`;

describe("cập nhật: đọc wrangler.jsonc", () => {
  it("nhận chú thích // và /* */, dấu phẩy thừa; chữ // trong chuỗi giữ nguyên", () => {
    const parsed = parseJsonc(UPSTREAM_WRANGLER);
    expect(parsed.compatibility_date).toBe("2026-09-01");
    expect(parsed.triggers).toEqual({ crons: ["*/15 * * * *"] });
    expect(parseJsonc('{ "url": "https://a.b/*x*/", "s": "a\\"//b" }')).toEqual({ url: "https://a.b/*x*/", s: 'a"//b' });
  });

  it("cú pháp hỏng thì báo lỗi, không đoán", () => {
    expect(() => parseJsonc('{ "name": "vi-nha" ')).toThrow();
    expect(() => parseJsonc("")).toThrow();
  });
});

describe("cập nhật: gộp wrangler.jsonc (AC-U2)", () => {
  it("lấy bản mới, giữ tên, account, tên miền riêng, id D1 / KV của nhà", () => {
    const upstream = parseJsonc(UPSTREAM_WRANGLER.replace("2026-09-01", "2026-10-01"));
    const merged = mergeWranglerConfig(parseJsonc(HOME_WRANGLER), upstream);
    expect(merged).toEqual({
      name: "vi-nha-an",
      main: "src/index.ts",
      compatibility_date: "2026-10-01",
      account_id: "acc-an",
      workers_dev: false,
      routes: [{ pattern: "tien.an.vn", custom_domain: true }],
      d1_databases: [{ binding: "DB", database_name: "vi-nha-an", database_id: "d1-an", migrations_dir: "migrations" }],
      kv_namespaces: [{ binding: "OAUTH_KV", id: "kv-an" }],
      triggers: { crons: ["*/15 * * * *"] },
    });
  });

  it("khoá nhà không có thì theo bản mới; khoá khác của nhà (ngày tương thích, cron) không giữ", () => {
    const home = { name: "vi-nha", compatibility_date: "2025-01-01", triggers: { crons: [] }, d1_databases: [{ binding: "DB", database_name: "vi-nha" }] };
    const merged = mergeWranglerConfig(home, parseJsonc(UPSTREAM_WRANGLER));
    expect(merged).toEqual(parseJsonc(UPSTREAM_WRANGLER));
  });
});

describe("cập nhật: so phiên bản", () => {
  it("so theo số, bỏ chữ v; không phải X.Y.Z thì null", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.1.0", "1.1.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.1.0")).toBeLessThan(0);
    expect(compareVersions("main", "1.0.0")).toBeNull();
  });
});

describe("cập nhật: áp bản phát hành vào repo nhà (AC-U1, AC-U2)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const write = (root: string, files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
  };
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "vi-nha-update-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "Thử");
    git(dir, "config", "user.email", "thu@example.com");
    return dir;
  };
  const commit = (dir: string, message: string) => {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", message);
  };
  const pkg = (version: string) => `${JSON.stringify({ name: "vi-nha", version }, null, 2)}\n`;

  /** mzavn/vi-nha giả: v1.0.1 rồi v1.1.0 (xoá src/old.ts, thêm src/new.ts, đổi ngày tương thích, thêm workflow mới). */
  function upstream() {
    const dir = repo();
    write(dir, { "package.json": pkg("1.0.1"), "wrangler.jsonc": UPSTREAM_WRANGLER, "src/index.ts": "v1\n", "src/old.ts": "cũ\n", ".github/workflows/update.yml": "cũ\n" });
    commit(dir, "release v1.0.1");
    git(dir, "tag", "v1.0.1");
    rmSync(join(dir, "src/old.ts"));
    write(dir, {
      "package.json": pkg("1.1.0"),
      "wrangler.jsonc": UPSTREAM_WRANGLER.replace("2026-09-01", "2026-10-01"),
      "src/index.ts": "v2\n",
      "src/new.ts": "mới\n",
      ".github/workflows/update.yml": "mới\n",
      ".github/workflows/khac.yml": "mới\n",
    });
    commit(dir, "release v1.1.0");
    git(dir, "tag", "v1.1.0");
    return dir;
  }

  /** Repo nhà do nút Deploy chép từ v1.0.1: lịch sử riêng, wrangler.jsonc mang id của nhà. */
  function home() {
    const dir = repo();
    write(dir, { "package.json": pkg("1.0.1"), "wrangler.jsonc": HOME_WRANGLER, "src/index.ts": "v1\n", "src/old.ts": "cũ\n", ".github/workflows/update.yml": "cũ\n" });
    commit(dir, "Initial commit");
    return dir;
  }

  it("không nêu tag: lấy tag vX.Y.Z cao nhất; file giống hệt tag, file bỏ thì xoá, .github để nguyên, giữ cấu hình Cloudflare, một commit", () => {
    const from = upstream();
    const cwd = home();
    const result = applyRelease({ cwd, from });
    expect(result).toMatchObject({ status: "updated", message: "Đã cập nhật Ví nhà 1.0.1 → 1.1.0." });
    expect(git(cwd, "log", "-1", "--format=%s|%an")).toBe("chore: cập nhật Ví nhà lên v1.1.0|github-actions[bot]");
    expect(git(cwd, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(cwd, "src/index.ts"), "utf8")).toBe("v2\n");
    expect(readFileSync(join(cwd, "src/new.ts"), "utf8")).toBe("mới\n");
    expect(existsSync(join(cwd, "src/old.ts"))).toBe(false);
    expect(readFileSync(join(cwd, ".github/workflows/update.yml"), "utf8")).toBe("cũ\n");
    expect(existsSync(join(cwd, ".github/workflows/khac.yml"))).toBe(false);
    const config = parseJsonc(readFileSync(join(cwd, "wrangler.jsonc"), "utf8"));
    expect(config).toMatchObject({ name: "vi-nha-an", compatibility_date: "2026-10-01", account_id: "acc-an" });
    expect(config.d1_databases).toEqual([{ binding: "DB", database_name: "vi-nha-an", database_id: "d1-an", migrations_dir: "migrations" }]);
    expect(config.kv_namespaces).toEqual([{ binding: "OAUTH_KV", id: "kv-an" }]);
  });

  it("chạy lại cùng bản: đã là bản mới nhất, không commit; bản cũ hơn: không cập nhật", () => {
    const from = upstream();
    const cwd = home();
    applyRelease({ cwd, from, tag: "v1.1.0" });
    const head = git(cwd, "rev-parse", "HEAD");
    expect(applyRelease({ cwd, from, tag: "v1.1.0" })).toMatchObject({ status: "latest", message: "Đã là bản mới nhất (1.1.0)." });
    expect(applyRelease({ cwd, from, tag: "v1.0.1" })).toMatchObject({
      status: "older",
      message: "Bản trên GitHub (1.0.1) cũ hơn bản đang có (1.1.0) — không cập nhật.",
    });
    expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(cwd, "status", "--porcelain")).toBe("");
  });

  it("wrangler.jsonc của nhà thiếu hay hỏng: dừng, không đổi file nào, không commit", () => {
    const from = upstream();
    for (const broken of [null, '{ "name": "vi-nha-an", ']) {
      const cwd = home();
      if (broken === null) rmSync(join(cwd, "wrangler.jsonc"));
      else writeFileSync(join(cwd, "wrangler.jsonc"), broken);
      commit(cwd, "sửa tay");
      const head = git(cwd, "rev-parse", "HEAD");
      expect(() => applyRelease({ cwd, from, tag: "v1.1.0" })).toThrow("Không đọc được wrangler.jsonc của repo — chưa cập nhật.");
      expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
      expect(git(cwd, "status", "--porcelain")).toBe("");
      expect(readFileSync(join(cwd, "src/index.ts"), "utf8")).toBe("v1\n");
    }
  });
});
