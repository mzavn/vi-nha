// `npm run setup` (scripts/setup.mjs): phần thuần — đọc cờ, sinh mật khẩu, sửa wrangler.jsonc. Phần gọi Cloudflare thử thật.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generatedPasswordMessage,
  generatePassword,
  parseArgs,
  passwordFilePath,
  readConfigString,
  savePasswordFile,
  setConfigString,
  setDatabaseName,
} from "../scripts/setup.mjs";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
/** wrangler.jsonc của bản public: repo gốc giữ ở publish/, repo public ở thư mục gốc. */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(root, existsSync(join(root, "publish/wrangler.jsonc")) ? "publish/wrangler.jsonc" : "wrangler.jsonc"), "utf8");
const parseJsonc = (text: string) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ [^"\n]*$/gm, ""));

describe("setup: đọc cờ", () => {
  it("mặc định: không account, wrangler.jsonc, không tự sinh mật khẩu, hỏi xác nhận", () => {
    expect(parseArgs([])).toEqual({
      accountId: null,
      name: null,
      config: "wrangler.jsonc",
      generatePassword: false,
      resetPassword: false,
      yes: false,
      help: false,
    });
  });

  it("đọc đủ cờ, dạng `--cờ giá-trị` lẫn `--cờ=giá-trị`; account lấy từ CLOUDFLARE_ACCOUNT_ID khi không có cờ", () => {
    expect(parseArgs(["--account-id", ACCOUNT, "--name=vi-nha-thu", "--config", "w.jsonc", "--generate-password", "--reset-password", "--yes"])).toEqual({
      accountId: ACCOUNT,
      name: "vi-nha-thu",
      config: "w.jsonc",
      generatePassword: true,
      resetPassword: true,
      yes: true,
      help: false,
    });
    expect(parseArgs(["-y"], { CLOUDFLARE_ACCOUNT_ID: ACCOUNT })).toMatchObject({ accountId: ACCOUNT, yes: true });
    expect(parseArgs(["--account-id", ACCOUNT], { CLOUDFLARE_ACCOUNT_ID: "f".repeat(32) }).accountId).toBe(ACCOUNT);
  });

  it("cờ lạ, thiếu giá trị, account id sai dạng, tên Worker sai luật → lỗi", () => {
    expect(() => parseArgs(["--force"])).toThrow(/Không hiểu/);
    expect(() => parseArgs(["--account-id"])).toThrow(/cần một giá trị/);
    expect(() => parseArgs(["--name", "--yes"])).toThrow(/cần một giá trị/);
    expect(() => parseArgs(["--account-id", "abc"])).toThrow(/không đúng dạng/);
    expect(() => parseArgs(["--name", "Vi_Nha"])).toThrow(/không dùng được/);
    expect(() => parseArgs(["--name", "-vi-nha"])).toThrow(/cần một giá trị/);
    expect(() => parseArgs(["--name", "a".repeat(64)])).toThrow(/không dùng được/);
  });
});

describe("setup: mật khẩu chung tự sinh", () => {
  it("bốn nhóm năm ký tự, không có ký tự dễ nhầm (0, o, 1, l, i), mỗi lần một khác", () => {
    const passwords = Array.from({ length: 50 }, () => generatePassword());
    for (const p of passwords) expect(p).toMatch(/^[a-hjkmnp-z2-9]{5}(-[a-hjkmnp-z2-9]{5}){3}$/);
    expect(new Set(passwords).size).toBe(50);
  });

  it("lấy ký tự theo nguồn ngẫu nhiên được truyền vào", () => {
    expect(generatePassword(() => 0)).toBe("aaaaa-aaaaa-aaaaa-aaaaa");
    expect(generatePassword((max) => max - 1)).toBe("99999-99999-99999-99999");
  });
});

describe("setup: sửa wrangler.jsonc", () => {
  it("bản public chưa có account_id; thêm vào ngay sau name, giữ chú thích; đặt lại thì thay, không thêm dòng", () => {
    expect(readConfigString(config, "account_id")).toBeNull();
    const once = setConfigString(config, "account_id", ACCOUNT);
    expect(readConfigString(once, "account_id")).toBe(ACCOUNT);
    expect(once).toContain(`  "name": "vi-nha",\n  "account_id": "${ACCOUNT}",\n`);
    expect(once.split("//").length).toBe(config.split("//").length);
    const twice = setConfigString(once, "account_id", "f".repeat(32));
    expect(twice.split("\n").length).toBe(once.split("\n").length);
    expect(parseJsonc(twice).account_id).toBe("f".repeat(32));
  });

  it("--name đổi tên Worker và tên D1, không đụng binding hay khoá lồng bên trong", () => {
    const renamed = setDatabaseName(setConfigString(config, "name", "vi-nha-thu"), "vi-nha-thu");
    const parsed = parseJsonc(renamed);
    expect(parsed.name).toBe("vi-nha-thu");
    expect(parsed.d1_databases).toEqual([{ binding: "DB", database_name: "vi-nha-thu", migrations_dir: "migrations" }]);
    expect(parsed.kv_namespaces).toEqual([{ binding: "OAUTH_KV" }]);
    expect(parsed.assets.binding).toBe("ASSETS");
  });

  it("thiếu name / database_name → lỗi rõ ràng", () => {
    expect(() => setConfigString("{\n}\n", "account_id", ACCOUNT)).toThrow(/thiếu dòng "name"/);
    expect(() => setDatabaseName("{\n}\n", "x")).toThrow(/database_name/);
  });
});

describe("setup: mật khẩu tự sinh khi không có terminal", () => {
  it("file mật khẩu nằm ở ~/.vi-nha/<tên-worker>.txt", () => {
    expect(passwordFilePath("vi-nha", "/home/an")).toBe(join("/home/an", ".vi-nha", "vi-nha.txt"));
    expect(passwordFilePath("vi-nha-thu", "/home/an")).toBe(join("/home/an", ".vi-nha", "vi-nha-thu.txt"));
  });

  it("ghi file quyền 0600 trong thư mục 0700, chạy lại thì ghi đè", () => {
    const home = mkdtempSync(join(tmpdir(), "vi-nha-home-"));
    try {
      const file = passwordFilePath("vi-nha", home);
      savePasswordFile(file, "aaaaa-bbbbb-ccccc-ddddd");
      expect(readFileSync(file, "utf8")).toBe("aaaaa-bbbbb-ccccc-ddddd\n");
      if (process.platform !== "win32") {
        expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
      // Thư mục / file có sẵn với quyền rộng hơn (vd tạo tay) thì siết lại; --reset-password ghi đè mật khẩu cũ.
      chmodSync(dirname(file), 0o755);
      chmodSync(file, 0o644);
      savePasswordFile(file, "eeeee-fffff-ggggg-hhhhh");
      expect(readFileSync(file, "utf8")).toBe("eeeee-fffff-ggggg-hhhhh\n");
      if (process.platform !== "win32") {
        expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
        expect(statSync(file).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("không có terminal: chỉ in đường dẫn, không in mật khẩu; có terminal: in một lần", () => {
    const password = "aaaaa-bbbbb-ccccc-ddddd";
    const savedPath = "/home/an/.vi-nha/vi-nha.txt";
    const agent = generatedPasswordMessage({ password, interactive: false, savedPath });
    expect(agent).toContain(savedPath);
    expect(agent).not.toContain(password);
    expect(agent).toMatch(/tự mở/);
    const human = generatedPasswordMessage({ password, interactive: true, savedPath: null });
    expect(human).toContain(password);
    expect(human.split(password).length).toBe(2);
  });
});
