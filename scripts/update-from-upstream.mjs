#!/usr/bin/env node
// Workflow "Cập nhật Ví nhà" (.github/workflows/update.yml ở repo của mỗi nhà) chạy file này, lấy từ nhánh main của
// mzavn/vi-nha: áp bản phát hành mới nhất vào repo của nhà rồi commit; workflow tự push, Cloudflare tự build và deploy.
//   node update-from-upstream.mjs [vX.Y.Z] [--from <repo>]     (tham số chỉ để thử; mặc định: tag mới nhất của mzavn/vi-nha)
//
// HỢP ĐỒNG CỐ ĐỊNH — repo nhà giữ mãi bản update.yml đầu tiên, mọi bản sau của file này phải chạy được với nó:
// update.yml gọi `node "$RUNNER_TEMP/update.mjs"` (không tham số) trong thư mục repo nhà, không có token; file này một file,
// chỉ dùng node:*; thoát 0 = xong (có hoặc không có commit mới), khác 0 = lỗi, không commit. Workflow push khi HEAD đổi.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const UPSTREAM = "https://github.com/mzavn/vi-nha.git";
const WRANGLER = "wrangler.jsonc";
const WRANGLER_ERROR = "Không đọc được wrangler.jsonc của repo — chưa cập nhật.";
/** Khoá cấp ngoài cùng của wrangler.jsonc thuộc về nhà (Cloudflare / setup ghi lúc cài, hay nhà tự thêm tên miền riêng). */
const HOME_KEYS = ["name", "account_id", "routes", "route", "workers_dev"];

/** JSON có chú thích `//`, `/* *\/` và dấu phẩy thừa (như wrangler nhận). Sai cú pháp → ném lỗi. */
export function parseJsonc(text) {
  let bare = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      bare += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      bare += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) throw new SyntaxError("Chú thích /* chưa đóng");
      i = end + 1;
      bare += " ";
    } else {
      bare += c;
    }
  }
  let json = "";
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i];
    if (c === '"') {
      const start = i;
      for (i++; i < bare.length && bare[i] !== '"'; i++) if (bare[i] === "\\") i++;
      json += bare.slice(start, i + 1);
    } else if (c === "," && /^\s*[}\]]/.test(bare.slice(i + 1))) {
      // dấu phẩy thừa trước } hoặc ]
    } else {
      json += c;
    }
  }
  return JSON.parse(json);
}

/** Giữ `keys` của mục cùng `binding` ở bản nhà; danh sách vẫn theo bản mới. */
function keepByBinding(upstream, home, keys) {
  return upstream.map((entry) => {
    const mine = Array.isArray(home) ? home.find((h) => h?.binding === entry.binding) : undefined;
    const kept = { ...entry };
    for (const k of keys) if (mine && k in mine) kept[k] = mine[k];
    return kept;
  });
}

/** wrangler.jsonc sau cập nhật: bản mới + tên, account, tên miền riêng, `workers_dev`, tên / id D1 và id KV của nhà. */
export function mergeWranglerConfig(home, upstream) {
  const merged = structuredClone(upstream);
  for (const k of HOME_KEYS) if (k in home) merged[k] = home[k];
  if (Array.isArray(upstream.d1_databases)) merged.d1_databases = keepByBinding(upstream.d1_databases, home.d1_databases, ["database_name", "database_id"]);
  if (Array.isArray(upstream.kv_namespaces)) merged.kv_namespaces = keepByBinding(upstream.kv_namespaces, home.kv_namespaces, ["id"]);
  return merged;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** So hai phiên bản `X.Y.Z` (có hay không có `v`): > 0 nếu a mới hơn; không phải `X.Y.Z` → null. */
export function compareVersions(a, b) {
  const x = SEMVER.exec(a);
  const y = SEMVER.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Áp tag `tag` (mặc định: tag `vX.Y.Z` cao nhất) của repo `from` vào repo `cwd`: mọi file trừ `.github/` (token của Actions
 * không được sửa workflow) và wrangler.jsonc giống hệt tag, file tag không còn thì xoá; wrangler.jsonc gộp với bản nhà; một commit.
 */
export function applyRelease({ cwd, from = UPSTREAM, tag }) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let home;
  try {
    home = parseJsonc(readFileSync(join(cwd, WRANGLER), "utf8"));
  } catch {
    // Lùi về bản của tag thì mất id D1: deploy có thể gắn một database trống vào Worker của nhà.
    throw new Error(WRANGLER_ERROR);
  }
  const current = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version;
  const wanted = tag ?? latestTag(git, from);
  const target = wanted.replace(/^v/, "");
  const diff = compareVersions(target, String(current));
  if (diff === null) throw new Error(`Không so được phiên bản: đang có "${current}", trên GitHub "${wanted}".`);
  if (diff === 0) return { status: "latest", message: `Đã là bản mới nhất (${current}).` };
  if (diff < 0) return { status: "older", message: `Bản trên GitHub (${target}) cũ hơn bản đang có (${current}) — không cập nhật.` };

  git("fetch", "-q", "--depth=1", "--no-tags", from, `refs/tags/v${target}`);
  const merged = mergeWranglerConfig(home, parseJsonc(git("show", `FETCH_HEAD:${WRANGLER}`)));
  // no-overlay (mặc định của restore): file đang theo dõi mà tag không có thì bị xoá.
  git("restore", "--source=FETCH_HEAD", "--staged", "--worktree", "--", ".", ":(exclude).github", `:(exclude)${WRANGLER}`);
  writeFileSync(join(cwd, WRANGLER), `${JSON.stringify(merged, null, 2)}\n`);
  git("add", WRANGLER);
  git(
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit",
    "-q",
    "-m",
    `chore: cập nhật Ví nhà lên v${target}`,
  );
  return { status: "updated", message: `Đã cập nhật Ví nhà ${current} → ${target}.` };
}

/** Tag `vX.Y.Z` cao nhất của repo `from` — chỉ có ở bản đã phát hành (scripts/publish-public.mjs gắn tag lúc phát hành). */
function latestTag(git, from) {
  const tags = git("ls-remote", "--tags", "--refs", from)
    .split("\n")
    .map((line) => line.split("refs/tags/")[1])
    .filter((t) => t && SEMVER.test(t) && t.startsWith("v"));
  if (tags.length === 0) throw new Error(`Không thấy bản phát hành nào ở ${from}.`);
  return tags.reduce((best, t) => (compareVersions(t, best) > 0 ? t : best));
}

// Chạy trực tiếp (không phải test import). So đường thật: thư mục tạm có thể đi qua symlink (macOS /var → /private/var).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const fromAt = args.indexOf("--from");
  const from = fromAt >= 0 ? args[fromAt + 1] : UPSTREAM;
  const tag = args.find((a, i) => !a.startsWith("--") && (fromAt < 0 || i !== fromAt + 1));
  try {
    console.log(applyRelease({ cwd: process.cwd(), from, tag }).message);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
