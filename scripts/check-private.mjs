#!/usr/bin/env node
// Quét tìm tên thật / dữ liệu riêng của nhà trước khi lên repo public.
//   node scripts/check-private.mjs                       — repo private: chỉ những gì sẽ chép sang public (PUBLIC_PATHS)
//   node scripts/check-private.mjs <thư-mục> [--list f]  — quét TOÀN CÂY thư mục đó (repo public dựng bằng publish-public.mjs)
// Danh sách cấm nằm ở `.private-names` của repo private (KHÔNG commit, xem .gitignore), đổi bằng `--list <file>`:
// mỗi dòng một chuỗi hoặc /regex/cờ; dòng trống, # là chú thích. Dòng bắt đầu bằng `!` là ngoại lệ được phép
// (ví dụ `!Asia/Ho_Chi_Minh`) — bỏ đi trước khi so.
// Thoát 0 = sạch, 1 = còn chỗ lộ, 2 = thiếu file danh sách.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Những gì của repo private sẽ chép nguyên văn sang repo public (khớp danh sách cho phép của scripts/publish-public.mjs).
 * `package.json`, `package-lock.json` được viết lại (đổi tên) nên chỉ quét ở bản đích; README / AGENTS / wrangler bản public nằm trong `publish/`.
 */
const PUBLIC_PATHS = ["src", "web", "test", "specs", "docs", "scripts", "publish", ".claude/skills/mk-specs", ".gitignore", "CLAUDE.md", "tsconfig.json", "vitest.config.ts"];
/** Bên trong PUBLIC_PATHS nhưng chỉ ở repo private: test của migration cũ (ghim mã thật của nhà). */
const PRIVATE_ONLY = ["test/migrations/"];
/** Không bao giờ quét khi đi cả cây. */
const SKIP_DIRS = new Set([".git", "node_modules"]);
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|pdf|zip|gz)$/i;

const privateRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const listAt = argv.indexOf("--list");
const list = listAt >= 0 ? resolve(argv[listAt + 1] ?? "") : join(privateRoot, ".private-names");
const target = argv.filter((_, i) => listAt < 0 || (i !== listAt && i !== listAt + 1))[0];

if (!existsSync(list)) {
  console.error(`Thiếu ${list}: tạo file này (không commit), mỗi dòng một tên / chuỗi cần chặn.`);
  process.exit(2);
}

const toRegex = (line) => {
  const m = /^\/(.+)\/([a-z]*)$/.exec(line);
  return m ? new RegExp(m[1], m[2].includes("g") ? m[2] : `${m[2]}g`) : new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
};
const lines = readFileSync(list, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const allowed = lines.filter((l) => l.startsWith("!")).map((l) => toRegex(l.slice(1)));
const banned = lines.filter((l) => !l.startsWith("!")).map((l) => ({ text: l, re: toRegex(l) }));

/** Mọi file dưới `dir` (trừ SKIP_DIRS), đường dẫn tương đối. */
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) ? [] : walk(join(dir, e.name), base);
    return e.isFile() ? [relative(base, join(dir, e.name))] : [];
  });
}

const isGitRepo = (dir) => {
  try {
    return realpathSync(execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) === realpathSync(dir);
  } catch {
    return false;
  }
};
const gitFiles = (dir, paths) =>
  execFileSync("git", ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard", "--", ...paths], { encoding: "utf8" }).split("\n").filter(Boolean);

let root;
let files;
if (target) {
  // Toàn cây: repo git thì lấy đúng những file sẽ commit; chưa phải repo thì đi hết thư mục.
  root = resolve(target);
  files = isGitRepo(root) ? gitFiles(root, []) : walk(root);
} else {
  root = privateRoot;
  files = gitFiles(root, PUBLIC_PATHS).filter((f) => !PRIVATE_ONLY.some((p) => f.startsWith(p)));
}
files = files.filter((f) => !BINARY.test(f) && !f.split("/").some((part) => SKIP_DIRS.has(part)));

let hits = 0;
for (const file of files) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  readFileSync(path, "utf8").split("\n").forEach((raw, i) => {
    const line = allowed.reduce((s, re) => s.replace(re, ""), raw);
    for (const { text, re } of banned) {
      re.lastIndex = 0;
      if (re.test(line)) {
        hits++;
        console.log(`${file}:${i + 1}: [${text}] ${raw.trim().slice(0, 140)}`);
      }
    }
  });
}
console.log(hits ? `\n${hits} chỗ còn dữ liệu riêng trong ${files.length} file.` : `Sạch: ${files.length} file.`);
process.exit(hits ? 1 : 0);
