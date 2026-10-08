import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { getSnapshot, reconcile } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  raw = openDb();
  // Bối cảnh: các tài khoản nối feed trong seed báo cả tiền ra (ADR-66) — log `out` tự gán theo rule như trước.
  raw.prepare("UPDATE accounts SET sepay_out = 1 WHERE sepay_enabled = 1").run();
  env = { DB: asD1(raw), SEPAY_API_KEY: "sepay-key" } as Env;
});

const payload = (over: Record<string, unknown> = {}) => ({
  id: 1001,
  gateway: "MBBank",
  transactionDate: "2026-09-22 09:00:00",
  accountNumber: "0011xxxxxxx", // vcb-husband
  subAccount: null,
  transferType: "out",
  transferAmount: 50_000,
  accumulated: 0,
  code: "EAN",
  content: "CT DEN 1234 EAN AN TRUA",
  referenceCode: "FT1001",
  description: "CT DEN 1234 EAN AN TRUA",
  ...over,
});

const post = (body: unknown, key = "sepay-key") =>
  app.request(
    "/webhooks/sepay",
    { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Apikey ${key}` } : {}) }, body: JSON.stringify(body) },
    env,
  );

describe("xác thực webhook SePay", () => {
  it("thiếu key → 401", async () => {
    expect((await post(payload(), "")).status).toBe(401);
  });

  it("sai key → 401", async () => {
    expect((await post(payload(), "sai-key")).status).toBe(401);
  });

  it("chưa cấu hình SEPAY_API_KEY → khoá hẳn", async () => {
    env = { DB: asD1(raw) } as Env;
    expect((await post(payload())).status).toBe(401);
  });

  it("đúng key → 200, body đúng chuẩn {\"success\":true}", async () => {
    const res = await post(payload());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});

describe("chặn dò khoá webhook theo IP (ADR-89)", () => {
  /** Ghi lại mọi câu SQL webhook chạy — để chắc bị chặn thì không đọc khoá nào. */
  const watchSql = () => {
    const db = asD1(raw);
    const prepare = db.prepare.bind(db);
    const seen: string[] = [];
    db.prepare = (sql: string) => (seen.push(sql), prepare(sql));
    env = { ...env, DB: db, ZALO_WEBHOOK_SECRET: "zalo-secret-1234" };
    return seen;
  };
  const send = (path: string, headers: Record<string, string>, ip: string) =>
    app.request(path, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, ...headers }, body: JSON.stringify(payload()) }, env);

  it("sai khoá lần thứ 20 trong 15 phút → mọi webhook từ IP đó 429 trước khi đọc khoá, kể cả khoá đúng; IP khác vẫn vào", async () => {
    const seen = watchSql();
    raw.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('webhook', '192.0.2.66', ?, 19)").run(new Date().toISOString());
    expect((await send("/webhooks/sepay", { Authorization: "Apikey sai-key" }, "192.0.2.66")).status).toBe(401);
    expect(raw.prepare("SELECT failures FROM auth_failures WHERE scope = 'webhook' AND ip = '192.0.2.66'").get()).toEqual({ failures: 20 });
    seen.length = 0;
    expect((await send("/webhooks/sepay", { Authorization: "Apikey sepay-key" }, "192.0.2.66")).status).toBe(429);
    expect((await send("/webhooks/zalo", { "X-Bot-Api-Secret-Token": "zalo-secret-1234" }, "192.0.2.66")).status).toBe(429);
    expect(seen.every((sql) => sql.includes("FROM auth_failures"))).toBe(true);
    expect(seen).toHaveLength(2);
    expect((await send("/webhooks/sepay", { Authorization: "Apikey sepay-key" }, "198.51.100.20")).status).toBe(200);
  });

  it("khoá Zalo sai cũng được đếm; hết 15 phút thì IP đó gửi lại được", async () => {
    watchSql();
    expect((await send("/webhooks/zalo", { "X-Bot-Api-Secret-Token": "sai-khoa" }, "192.0.2.66")).status).toBe(401);
    expect(raw.prepare("SELECT failures FROM auth_failures WHERE scope = 'webhook'").all()).toEqual([{ failures: 1 }]);
    raw.prepare("UPDATE auth_failures SET failures = 20, first_at = ?").run(new Date(Date.now() - 16 * 60_000).toISOString());
    expect((await send("/webhooks/sepay", { Authorization: "Apikey sepay-key" }, "192.0.2.66")).status).toBe(200);
  });
});

describe("chống trùng qua HTTP", () => {
  it("gửi lại đúng id (SePay retry) → chỉ có một bank_log, không sinh transaction thứ hai", async () => {
    await post(payload({ id: 2002 }));
    await post(payload({ id: 2002 }));
    await post(payload({ id: 2002 }));
    expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs").get()).toEqual({ n: 1 });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 1 });
  });
});

describe("nối trọn: webhook → rule mã → transaction", () => {
  it("mã EAN qua webhook thật tạo spend đúng ví/danh mục", async () => {
    const res = await post(payload({ id: 3003 }));
    expect(await res.json()).toEqual({ success: true });
    const tx = raw.prepare("SELECT meaning, counter_wallet_id, category_id, account_id FROM transactions WHERE log_id = '3003'").get();
    expect(tx).toEqual({ meaning: "spend", counter_wallet_id: "food", category_id: "groceries", account_id: "vcb-husband" });
  });

  it("payload thiếu trường bắt buộc vẫn trả success (SePay không nên bị coi là lỗi để retry vô ích)", async () => {
    const res = await post({ id: 4004 }); // thiếu transactionDate, transferType...
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs").get()).toEqual({ n: 0 });
  });

  it("số lũy kế SePay gửi kèm sai hẳn số dư thật → không lưu, không báo lệch đối soát ở đâu cả (ADR-87)", async () => {
    // Như MB chi tiêu (vợ) 6/10/2026: SePay báo 1.372.722 khi số dư thật 2.248.978 và sổ khớp số thật.
    await post(payload({ id: 7007, referenceCode: "FT7007", accumulated: 1_372_722 }));
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = '7007'").get()).toEqual({ status: "assigned" });
    const row = (await reconcile(env.DB)).find((r) => r.accountId === "vcb-husband");
    expect(row).toMatchObject({ bookDrift: 0, pendingCount: 0 });
    expect(row).not.toHaveProperty("bankBalance");
    expect(row).not.toHaveProperty("feedDrift");
    expect((await getSnapshot(env.DB, null, new Date("2026-09-22T03:00:00Z"))).attention.drift).toEqual([]);
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'reconcile_drift'").get()).toEqual({ n: 0 });
    const stored = raw.prepare("SELECT raw FROM bank_logs WHERE id = '7007'").get() as { raw: string };
    expect(JSON.parse(stored.raw)).toMatchObject({ accumulated: 1_372_722 }); // bản thô giữ nguyên để đối chiếu
  });
});

describe("payload hỏng và lỗi tạm thời", () => {
  it("ngày không có thật (30/02) bị từ chối thay vì ghi sang tháng 3; được ghi lại để tin sáng báo", async () => {
    const res = await post(payload({ id: 2001, transactionDate: "2026-02-30 09:00:00" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true }); // gửi lại vô ích: không bắt SePay thử lại
    expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs").get()).toEqual({ n: 0 });
    const rec = raw.prepare("SELECT payload FROM notifications WHERE kind = 'ingest_error'").get() as { payload: string };
    expect(JSON.parse(rec.payload)).toMatchObject({ source: "webhook" });
    expect(rec.payload).not.toContain("0011xxxxxxx"); // không ghi số tài khoản
  });

  it("thiếu giây vẫn đọc được; số tiền vô lý (> 1.000 tỷ) bị từ chối", async () => {
    await post(payload({ id: 2002, referenceCode: "FT2002", transactionDate: "2026-09-22 09:00" }));
    expect(raw.prepare("SELECT at FROM bank_logs WHERE id = '2002'").get()).toEqual({ at: "2026-09-22T02:00:00.000Z" });
    await post(payload({ id: 2003, referenceCode: "FT2003", transferAmount: 1e20 }));
    expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs WHERE id = '2003'").get()).toEqual({ n: 0 });
  });

  it("D1 lỗi tạm thời → trả lỗi để SePay gửi lại; lần gửi lại ghi được đúng một log", async () => {
    const realDb = env.DB;
    env = { ...env, DB: new Proxy(realDb, { get: (t, k) => (k === "prepare" ? () => { throw new Error("D1 overloaded"); } : Reflect.get(t, k)) }) };
    const first = await post(payload({ id: 2004, referenceCode: "FT2004" }));
    expect(first.status).toBe(503);
    env = { ...env, DB: realDb };
    const retry = await post(payload({ id: 2004, referenceCode: "FT2004" }));
    expect(await retry.json()).toEqual({ success: true });
    expect(raw.prepare("SELECT COUNT(*) n FROM bank_logs WHERE id = '2004'").get()).toEqual({ n: 1 });
  });
});

describe("tài khoản ảo (subAccount)", () => {
  it("khớp tài khoản theo subAccount trước số tài khoản chính", async () => {
    raw.prepare("UPDATE accounts SET sub_account = 'VA-EM-01' WHERE id = 'vcb-wife'").run();
    await post(payload({ id: 3001, referenceCode: "FT3001", accountNumber: "0011xxxxxxx", subAccount: "VA-EM-01" }));
    expect(raw.prepare("SELECT account_id FROM bank_logs WHERE id = '3001'").get()).toEqual({ account_id: "vcb-wife" });
  });
});

describe("nhiều kết nối SePay — cùng một địa chỉ webhook, mỗi kết nối một khoá (ADR-75)", () => {
  beforeEach(() => {
    raw.prepare("INSERT INTO sepay_connections (id, name, webhook_key) VALUES ('sepay-wife', 'SePay của vợ', 'wife-key-0002')").run();
    raw.prepare("UPDATE accounts SET sepay_connection_id = 'sepay-wife' WHERE id = 'vcb-wife'").run();
  });

  it("khoá của mỗi kết nối đang bật đều vào được; khoá lạ hay khoá của kết nối đã tắt bị từ chối", async () => {
    expect((await post(payload({ id: 5001, referenceCode: "FT5001" }), "sepay-key")).status).toBe(200);
    expect((await post(payload({ id: 5002, referenceCode: "FT5002", accountNumber: "0011yyyyyyy" }), "wife-key-0002")).status).toBe(200);
    expect((await post(payload({ id: 5003 }), "wife-key-0003")).status).toBe(401);
    raw.prepare("UPDATE sepay_connections SET active = 0 WHERE id = 'sepay-wife'").run();
    expect((await post(payload({ id: 5004, accountNumber: "0011yyyyyyy" }), "wife-key-0002")).status).toBe(401);
    expect(raw.prepare("SELECT id, account_id FROM bank_logs ORDER BY id").all()).toEqual([
      { id: "5001", account_id: "vcb-husband" },
      { id: "5002", account_id: "vcb-wife" },
    ]);
  });

  it("khoá của SePay của vợ không ghi được vào tài khoản của chồng: log không gắn tài khoản nào, không tự sinh giao dịch", async () => {
    const res = await post(payload({ id: 6001, referenceCode: "FT6001", accountNumber: "0011xxxxxxx" }), "wife-key-0002");
    expect(res.status).toBe(200);
    expect(raw.prepare("SELECT account_id, status FROM bank_logs WHERE id = '6001'").get()).toEqual({ account_id: null, status: "pending" });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
  });
});
