#!/usr/bin/env node
// Cài Ví nhà lên tài khoản Cloudflare của bạn: `npm run setup`. Chạy lại an toàn (không tạo D1 / KV thứ hai, không đổi
// mật khẩu trừ khi có --reset-password). Chạy được không cần gõ gì (cho agent AI, không có TTY) bằng cờ / biến môi trường;
// có TTY thì hỏi. Mật khẩu tự sinh khi không có TTY không in ra (agent đọc được đầu ra) mà ghi vào ~/.vi-nha/<tên-worker>.txt.
// Kịch bản cho agent AI: docs/cai-bang-ai.md.
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const PASSWORD_MIN = 8;
/** Bỏ ký tự dễ nhầm khi chép tay (0/o, 1/l/i). */
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export const USAGE = `Cài Ví nhà lên Cloudflare: npm run setup [-- <cờ>]

  --account-id <id>     account Cloudflare dùng để cài (hoặc biến CLOUDFLARE_ACCOUNT_ID); cần khi đăng nhập có nhiều account
  --generate-password   tự sinh mật khẩu chung (hoặc đặt sẵn biến APP_PASSWORD): có terminal thì in ra MỘT lần; không có
                        terminal (agent AI chạy) thì không in, ghi vào ~/.vi-nha/<tên-worker>.txt (chỉ in đường dẫn)
  --reset-password      đặt lại mật khẩu chung dù đã có
  --yes                 không hỏi xác nhận (bắt buộc khi không có terminal, ví dụ agent AI chạy)
  --name <tên>          cài dưới tên Worker khác (Worker, D1 cùng tên mới; KV <tên>-oauth-kv) — để chạy thử, ghi vào wrangler.jsonc
  --config <file>       file cấu hình wrangler (mặc định wrangler.jsonc)

Biến môi trường: CLOUDFLARE_API_TOKEN (tuỳ, thay cho npx wrangler login), CLOUDFLARE_ACCOUNT_ID, APP_PASSWORD.
Chưa đăng nhập: tự chạy \`npx wrangler login\` trong terminal (mở trình duyệt), rồi chạy lại.`;

/** Mã thoát — agent AI đọc để biết phải hỏi người dùng gì. */
export const EXIT = { error: 1, usage: 2, notLoggedIn: 3, chooseAccount: 4, noSubdomain: 5, needInput: 6 };

/** Đọc cờ dòng lệnh (`--cờ giá-trị` hoặc `--cờ=giá-trị`); `env` cho CLOUDFLARE_ACCOUNT_ID. Sai cờ → ném lỗi. */
export function parseArgs(argv, env = {}) {
  const opts = {
    accountId: env.CLOUDFLARE_ACCOUNT_ID || null,
    name: null,
    config: "wrangler.jsonc",
    generatePassword: false,
    resetPassword: false,
    yes: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const value = () => {
      const v = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (!v || v.startsWith("-")) throw new Error(`${flag} cần một giá trị.`);
      return v;
    };
    switch (flag) {
      case "--account-id": opts.accountId = value(); break;
      case "--name": opts.name = value(); break;
      case "--config": opts.config = value(); break;
      case "--generate-password": opts.generatePassword = true; break;
      case "--reset-password": opts.resetPassword = true; break;
      case "--yes": case "-y": opts.yes = true; break;
      case "--help": case "-h": opts.help = true; break;
      default: throw new Error(`Không hiểu tham số "${arg}".`);
    }
  }
  if (opts.accountId !== null && !/^[0-9a-f]{32}$/.test(opts.accountId)) throw new Error(`Account id "${opts.accountId}" không đúng dạng (32 ký tự 0-9, a-f).`);
  if (opts.name !== null && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(opts.name)) {
    throw new Error(`Tên "${opts.name}" không dùng được: chỉ chữ thường không dấu, số, gạch nối; tối đa 63 ký tự.`);
  }
  return opts;
}

/** Mật khẩu chung ngẫu nhiên dạng `xxxxx-xxxxx-xxxxx-xxxxx` (~99 bit), dễ chép tay. */
export function generatePassword(random = randomInt) {
  const group = () => Array.from({ length: 5 }, () => PASSWORD_ALPHABET[random(PASSWORD_ALPHABET.length)]).join("");
  return [group(), group(), group(), group()].join("-");
}

/** File giữ mật khẩu tự sinh khi không có terminal: `~/.vi-nha/<tên-worker>.txt`. */
export function passwordFilePath(name, home = homedir()) {
  return join(home, ".vi-nha", `${name}.txt`);
}

/** Ghi (đè) mật khẩu vào file: thư mục 0700, file 0600 — siết lại cả khi đã có sẵn với quyền rộng hơn. */
export function savePasswordFile(path, password) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  chmodSync(dirname(path), 0o700);
  // File có sẵn với quyền rộng: siết về 0600 trước khi ghi mật khẩu mới (mode của writeFileSync chỉ áp khi tạo file).
  if (existsSync(path)) chmodSync(path, 0o600);
  writeFileSync(path, `${password}\n`, { mode: 0o600 });
}

/** Lời báo mật khẩu tự sinh: có terminal thì in một lần; không có (agent AI đọc đầu ra) thì chỉ đường dẫn file. */
export function generatedPasswordMessage({ password, interactive, savedPath }) {
  if (interactive) return `\nMật khẩu chung (chỉ in MỘT lần — ghi lại ngay, không gửi qua chat):\n\n  ${password}\n`;
  return `\nMật khẩu chung đã tự sinh và lưu vào file (không in ra đây):\n\n  ${savedPath}\n
Người dùng tự mở file này và chép mật khẩu vào chỗ an toàn (trình quản lý mật khẩu, sổ tay); chép xong có thể xoá file.
Agent AI: không đọc, không mở file này, không dán mật khẩu vào chat.\n`;
}

const topLevelString = (key) => new RegExp(`^(  "${key}"\\s*:\\s*)"([^"]*)"`, "m");

/** Giá trị chuỗi của khoá cấp ngoài cùng (thụt 2 dấu cách) trong wrangler.jsonc; không có → null. */
export function readConfigString(text, key) {
  return topLevelString(key).exec(text)?.[2] ?? null;
}

/** Đặt khoá chuỗi cấp ngoài cùng trong wrangler.jsonc, giữ nguyên chú thích; chưa có thì thêm ngay sau "name". */
export function setConfigString(text, key, value) {
  const re = topLevelString(key);
  if (re.test(text)) return text.replace(re, (_, head) => `${head}${JSON.stringify(value)}`);
  const nameLine = /^(  "name"\s*:\s*"[^"]*",[^\n]*)\n/m;
  if (!nameLine.test(text)) throw new Error('wrangler.jsonc thiếu dòng "name".');
  return text.replace(nameLine, (line) => `${line}  "${key}": ${JSON.stringify(value)},\n`);
}

/** Đổi `database_name` của D1 (Ví nhà chỉ có một D1). */
export function setDatabaseName(text, value) {
  const re = /("database_name"\s*:\s*)"[^"]*"/;
  if (!re.test(text)) throw new Error('wrangler.jsonc thiếu "database_name".');
  return text.replace(re, (_, head) => `${head}${JSON.stringify(value)}`);
}

// ————————————————————————————————————————————— chạy thật —————————————————————————————————————————————

function fail(code, message) {
  console.error(`\n✋ ${message}`);
  process.exit(code);
}

const step = (text) => console.log(`\n▸ ${text}`);

/** Gọi wrangler của dự án. Không bao giờ nối stdin của terminal: wrangler chạy kiểu không tương tác (tự xác nhận). */
function wrangler(args, { configPath, input, capture = false } = {}) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args, ...(configPath ? ["-c", configPath] : [])], {
    cwd: ROOT,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"],
  });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** JSON đầu tiên trong đầu ra của wrangler (có thể lẫn dòng cảnh báo). */
function parseJsonOutput(out) {
  const start = out.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(out.slice(start));
  } catch {
    return null;
  }
}

/** Subdomain workers.dev của account: `{ subdomain }`, `{ missing: true }` (chưa đăng ký) hoặc `{ unknown }` (không kiểm được). */
async function workersSubdomain(accountId) {
  const auth = parseJsonOutput(wrangler(["auth", "token", "--json"], { capture: true }).stdout);
  if (!auth?.token) return { unknown: "không lấy được token đăng nhập" };
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const body = await res.json();
    if (body.success && body.result?.subdomain) return { subdomain: body.result.subdomain };
    if (body.errors?.some((e) => e.code === 10007)) return { missing: true };
    return { unknown: body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}` };
  } catch (e) {
    return { unknown: e.message };
  }
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

/** Hỏi mà không hiện chữ gõ (mật khẩu). */
async function askHidden(question) {
  process.stdout.write(question);
  const mute = new Writable({ write: (_chunk, _enc, done) => done() });
  const rl = createInterface({ input: process.stdin, output: mute, terminal: true });
  const answer = await rl.question("");
  rl.close();
  process.stdout.write("\n");
  return answer;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2), process.env);
  } catch (e) {
    fail(EXIT.usage, `${e.message}\n\n${USAGE}`);
  }
  if (opts.help) return console.log(USAGE);
  if (Number(process.versions.node.split(".")[0]) < 20) fail(EXIT.error, `Cần Node.js 20 trở lên (máy đang có ${process.version}). Cài Node 22 LTS ở https://nodejs.org rồi chạy lại.`);
  if (!existsSync(WRANGLER)) fail(EXIT.error, "Chưa cài thư viện: chạy `npm install` trước, rồi `npm run setup`.");
  const configPath = resolve(opts.config);
  if (!existsSync(configPath)) fail(EXIT.usage, `Không thấy file cấu hình ${configPath}.`);
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  step("1/7 Kiểm tra đăng nhập Cloudflare");
  const who = parseJsonOutput(wrangler(["whoami", "--json"], { capture: true }).stdout);
  if (!who?.loggedIn) {
    fail(EXIT.notLoggedIn, "Chưa đăng nhập Cloudflare. Tự chạy lệnh sau trong terminal ở thư mục này (trình duyệt mở ra, bấm Allow):\n\n  npx wrangler login\n\nrồi chạy lại: npm run setup");
  }
  console.log(`Đã đăng nhập${who.email ? `: ${who.email}` : " bằng API token"}.`);

  step("2/7 Chọn account Cloudflare");
  const original = readFileSync(configPath, "utf8");
  const accounts = Array.isArray(who.accounts) ? who.accounts : [];
  const listing = accounts.map((a, i) => `  ${i + 1}. ${a.name}  —  ${a.id}`).join("\n");
  let accountId = opts.accountId ?? readConfigString(original, "account_id") ?? (accounts.length === 1 ? accounts[0].id : null);
  if (!accountId && interactive && accounts.length > 1) {
    const pick = Number(await ask(`Đăng nhập này có ${accounts.length} account:\n${listing}\nChọn số: `));
    accountId = accounts[pick - 1]?.id ?? null;
  }
  if (!accountId) {
    fail(EXIT.chooseAccount, `Cần chọn account để cài${listing ? `:\n${listing}` : ""}\n\nChạy lại với: npm run setup -- --account-id <id>`);
  }
  const account = accounts.find((a) => a.id === accountId);
  if (accounts.length && !account) fail(EXIT.chooseAccount, `Đăng nhập này không có account ${accountId}. Các account có:\n${listing}`);
  let config = setConfigString(original, "account_id", accountId);
  if (opts.name) config = setDatabaseName(setConfigString(config, "name", opts.name), opts.name);
  const name = readConfigString(config, "name");
  console.log(`Account: ${account?.name ?? accountId}. Tên Worker: ${name}.`);

  step("3/7 Kiểm tra địa chỉ workers.dev");
  const sub = await workersSubdomain(accountId);
  if (sub.missing) {
    fail(EXIT.noSubdomain, `Account chưa có địa chỉ workers.dev. Mở link sau, đặt một subdomain (miễn phí, làm một lần):\n\n  https://dash.cloudflare.com/${accountId}/workers/onboarding\n\nrồi chạy lại: npm run setup`);
  }
  const url = sub.subdomain ? `https://${name}.${sub.subdomain}.workers.dev` : null;
  console.log(url ? `Địa chỉ sẽ là ${url}` : `Không kiểm được subdomain (${sub.unknown}) — vẫn tiếp tục, wrangler sẽ báo nếu thiếu.`);

  if (!opts.yes) {
    if (!interactive) fail(EXIT.needInput, "Chạy không có terminal: thêm --yes để xác nhận cài.");
    const ok = await ask(`\nCài Ví nhà "${name}" lên account ${account?.name ?? accountId}? (Y/n) `);
    if (/^n/i.test(ok)) fail(EXIT.error, "Đã huỷ, chưa đổi gì.");
  }
  if (config !== original) writeFileSync(configPath, config);

  // Mật khẩu chung: chỉ đặt khi Worker chưa có, hoặc --reset-password. Quyết trước khi deploy để không dừng giữa chừng.
  // Worker chưa tồn tại (lần đầu) thì wrangler báo "not found"; lỗi khác thì dừng, không đoán — đoán sai là ghi đè mật khẩu đang dùng.
  const listed = wrangler(["secret", "list", "--format", "json"], { configPath, capture: true });
  if (!listed.ok && !/not found|10007/i.test(listed.stderr + listed.stdout)) fail(EXIT.error, `Không đọc được secret của Worker "${name}":\n${listed.stderr || listed.stdout}`);
  const secrets = listed.ok ? parseJsonOutput(listed.stdout) : [];
  const hasPassword = Array.isArray(secrets) && secrets.some((s) => s.name === "APP_PASSWORD");
  let password = null;
  let generated = false;
  if (!hasPassword || opts.resetPassword) {
    password = process.env.APP_PASSWORD || null;
    if (!password && !opts.generatePassword && interactive) password = (await askHidden("Mật khẩu chung của cả nhà (bỏ trống = tự sinh): ")) || null;
    if (!password && (opts.generatePassword || interactive)) {
      password = generatePassword();
      generated = true;
    }
    if (!password) fail(EXIT.needInput, "Cần mật khẩu chung: thêm --generate-password (tự sinh) hoặc đặt biến môi trường APP_PASSWORD.");
    if (password.length < PASSWORD_MIN) fail(EXIT.needInput, `Mật khẩu chung cần ít nhất ${PASSWORD_MIN} ký tự.`);
  }

  step("4/7 Build giao diện");
  const build = spawnSync("npm", ["run", "build"], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], shell: process.platform === "win32" });
  if (build.status !== 0) fail(EXIT.error, "Build lỗi (xem log phía trên).");

  step("5/7 Deploy Worker (lần đầu Cloudflare tự tạo D1 và KV)");
  if (!wrangler(["deploy"], { configPath }).ok) fail(EXIT.error, "Deploy lỗi (xem log phía trên). Sửa xong chạy lại npm run setup — chạy lại an toàn.");

  step("6/7 Dựng database (migration)");
  if (!wrangler(["d1", "migrations", "apply", "DB", "--remote"], { configPath }).ok) fail(EXIT.error, "Migration lỗi (xem log phía trên). Chạy lại npm run setup.");

  step("7/7 Mật khẩu chung");
  let savedPath = null;
  if (password) {
    // Không có terminal: ghi file trước khi đặt — ghi lỗi thì dừng khi mật khẩu cũ (nếu có) còn nguyên.
    if (generated && !interactive) {
      savedPath = passwordFilePath(name);
      try {
        savePasswordFile(savedPath, password);
      } catch (e) {
        fail(EXIT.error, `Không ghi được file mật khẩu ${savedPath}: ${e.message}\nChưa đổi mật khẩu chung. Sửa quyền thư mục rồi chạy lại.`);
      }
    }
    const put = wrangler(["secret", "put", "APP_PASSWORD"], { configPath, input: password, capture: true });
    if (!put.ok) fail(EXIT.error, `Đặt mật khẩu lỗi:\n${put.stderr || put.stdout}${savedPath ? `\nMật khẩu trong ${savedPath} CHƯA được đặt — chạy lại chính lệnh này (file sẽ được ghi đè).` : ""}`);
    console.log(hasPassword ? "Đã đặt lại mật khẩu chung." : "Đã đặt mật khẩu chung.");
  } else {
    console.log("Mật khẩu chung đã có từ lần cài trước — giữ nguyên (đổi: npm run setup -- --reset-password).");
  }

  console.log(`\n✅ Xong. Ví nhà: ${url ?? `https://${name}.<subdomain>.workers.dev (xem dòng "Deployed" phía trên)`}`);
  if (generated) console.log(generatedPasswordMessage({ password, interactive, savedPath }));
  console.log(`Bước tiếp: mở địa chỉ trên → màn Thiết lập: nhập mật khẩu chung, thêm người trong nhà, tài khoản, bộ ví.
Địa chỉ workers.dev mới đăng ký có thể cần vài phút mới mở được.
Cập nhật bản mới sau này: git pull && npm run deploy`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
