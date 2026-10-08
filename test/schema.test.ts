import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { isIconName } from "../web/src/ui/icon-names";
import { migratedDb, openDb, schemaShape } from "./helpers/d1-sqlite";

const monthKey = (offset: number) => {
  // tháng theo giờ VN, lệch `offset` tháng so với hiện tại
  const now = new Date(Date.now() + 7 * 3600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 15));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const spend = (db: ReturnType<typeof openDb>, wallet: string, category: string, amount: number, month: string) =>
  db.prepare(
    `INSERT INTO transactions (at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key, source)
     VALUES (?, ?, 'spend', ?, 'cash-husband', ?, ?, ?, 'manual')`,
  ).run(`${month}-15`, amount, wallet, category, `${month.slice(0, 4)}-W01`, month);

describe("migrations", () => {
  it("chạy hết chuỗi migration ra đúng schema mô tả ở docs/ (docs là nguồn sự thật)", () => {
    const fromDocs = openDb();
    const migrated = migratedDb();
    expect(schemaShape(migrated)).toEqual(schemaShape(fromDocs));
    expect(migrated.prepare("SELECT v FROM config WHERE k='schema_version'").get()).toEqual(
      fromDocs.prepare("SELECT v FROM config WHERE k='schema_version'").get(),
    );
  });

  it("dựng được DB và mọi view chạy sạch", () => {
    const db = openDb();
    const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all() as { name: string }[];
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) db.prepare(`SELECT * FROM ${v.name} LIMIT 1`).all();
    expect(db.prepare("SELECT v FROM config WHERE k='schema_version'").get()).toEqual({ v: "1.30" });
  });

  it("đã bỏ hai view ngân sách mù kỳ", () => {
    const db = openDb();
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all() as { name: string }[]).map((r) => r.name);
    expect(names).not.toContain("v_envelope_week");
    expect(names).not.toContain("v_budget_month");
  });

  it("bank_logs nhận log vá từ API lịch sử", () => {
    const db = openDb();
    db.prepare(
      `INSERT INTO bank_logs (id, at, amount, direction, account_id, reference_number, source)
       VALUES ('api:1', '2026-09-21T09:00:00+07:00', 1000, 'in', 'vcb-husband', 'FT123', 'backfill')`,
    ).run();
    expect(() =>
      db.prepare(`INSERT INTO bank_logs (id, at, amount, direction, source) VALUES ('x', '2026-09-21', 1, 'in', 'email')`).run(),
    ).toThrow();
  });

  it("0025 thêm auth_failures: mỗi phạm vi + IP một dòng, phạm vi lạ và số lần ≤ 0 bị chặn (ADR-89)", () => {
    const db = openDb();
    db.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('login', '1.2.3.4', '2026-10-06T00:00:00.000Z', 1)").run();
    expect(() => db.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('login', '1.2.3.4', '2026-10-06T00:00:00.000Z', 1)").run()).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('mcp', '1.2.3.4', '2026-10-06T00:00:00.000Z', 1)").run()).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES ('webhook', '1.2.3.4', '2026-10-06T00:00:00.000Z', 0)").run()).toThrow(/CHECK/);
    expect(db.prepare("SELECT v FROM config WHERE k='session_epoch'").get()).toBeUndefined();
  });

  it("0026 thêm audit_log chỉ thêm: không sửa, không xoá được; via lạ và detail không phải JSON bị chặn (ADR-90)", () => {
    const db = openDb();
    db.prepare("INSERT INTO audit_log (member_id, via, action, target, detail) VALUES ('husband', 'session', 'tx.void', 'tx:1', NULL)").run();
    expect(() => db.prepare("UPDATE audit_log SET action = 'x'").run()).toThrow(/chỉ thêm/);
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/chỉ thêm/);
    expect(() => db.prepare("INSERT INTO audit_log (via, action) VALUES ('webhook', 'x')").run()).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO audit_log (via, action, detail) VALUES ('token', 'x', 'không phải json')").run()).toThrow(/CHECK/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()).toEqual({ n: 1 });
  });

  it("0028 DB mới: CHECK tier là holding | wealth_building | tax | nice | must, role là piggy_bank | buffer | term_deposit theo locked; giá trị cũ bị từ chối", () => {
    const db = openDb();
    expect(db.prepare("SELECT v FROM config WHERE k = 'safety_fund_months'").get()).toEqual({ v: "6" });
    expect(db.prepare("SELECT v FROM config WHERE k = 'emergency_months'").get()).toBeUndefined();
    const wallet = db.prepare("INSERT INTO wallets (id, name, tier, kind) VALUES (?, ?, ?, 'accrual')");
    expect(() => wallet.run("old-tier", "Tích sản cũ", "tichsan")).toThrow(/CHECK/);
    for (const tier of ["holding", "tax", "nice"]) wallet.run(`w-${tier}`, tier, tier);
    expect(db.prepare("SELECT COUNT(*) AS n FROM wallets WHERE tier = 'wealth_building'").get()).toEqual({ n: 1 });
    const account = db.prepare("INSERT INTO accounts (id, name, kind, locked, spendable, role) VALUES (?, ?, 'bank', ?, 0, ?)");
    expect(() => account.run("old-piggy", "Heo cũ", 1, "heo")).toThrow(/CHECK/);
    expect(() => account.run("old-buffer", "Phao cũ", 0, "phao")).toThrow(/CHECK/);
    expect(() => account.run("old-term", "Sổ cũ", 1, "so-tiet-kiem")).toThrow(/CHECK/);
    account.run("piggy-bank", "Heo đất", 1, "piggy_bank");
    account.run("term-deposit", "Sổ tiết kiệm", 1, "term_deposit");
    account.run("buffer", "Phao dự phòng", 0, "buffer");
    // Giữ luật cũ: piggy_bank / term_deposit chỉ khi khóa, buffer chỉ khi không khóa.
    expect(() => account.run("piggy-unlocked", "Heo không khóa", 0, "piggy_bank")).toThrow(/CHECK/);
    expect(() => account.run("term-unlocked", "Sổ không khóa", 0, "term_deposit")).toThrow(/CHECK/);
    expect(() => account.run("buffer-locked", "Phao khóa", 1, "buffer")).toThrow(/CHECK/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('v_tichsan', 'v_emergency_fund') OR name LIKE '_m0028%'").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("seed", () => {
  const db = openDb();
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

  it("có đúng một ví remainder (nhóm Have), một ví Tích sản, một ví Thu nhập", () => {
    expect(
      db.prepare(
        `SELECT w.tier, w.must_group FROM allocations a JOIN wallets w ON w.id=a.wallet_id WHERE a.mode='remainder' AND a.active=1`,
      ).all(),
    ).toEqual([{ tier: "must", must_group: "have" }]);
    expect(count("SELECT COUNT(*) n FROM wallets WHERE tier='wealth_building'")).toBe(1);
    expect(count("SELECT COUNT(*) n FROM wallets WHERE tier='holding' AND kind='holding'")).toBe(1);
    expect(count("SELECT COUNT(*) n FROM wallets")).toBeGreaterThanOrEqual(10);
  });

  it("mọi danh mục trỏ về ví có thật; mọi ví trú ở một tài khoản có thật", () => {
    expect(count("SELECT COUNT(*) n FROM categories c LEFT JOIN wallets w ON w.id=c.default_wallet_id WHERE w.id IS NULL")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM wallets w LEFT JOIN accounts a ON a.id=w.account_id WHERE a.id IS NULL")).toBe(0);
  });

  it("hai ví Chơi cùng priority để lúc thiếu tiền không ai nhận 0", () => {
    const rows = db.prepare("SELECT DISTINCT priority FROM allocations WHERE wallet_id IN ('fun-husband','fun-wife')").all();
    expect(rows).toHaveLength(1);
  });

  it("không còn danh mục học phí trỏ về ví Nhà ở; thuế suất chỉ nằm ở allocations", () => {
    expect(count("SELECT COUNT(*) n FROM categories WHERE id='hoc-phi'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM config WHERE k='tax_rate'")).toBe(0);
    expect(db.prepare("SELECT percent FROM allocations WHERE wallet_id='tax'").get()).toEqual({ percent: 0.1 });
  });

  it("DB mẫu (docs/schema.sql + docs/seed.sql): khoá ngoại sạch, mọi view chạy không lỗi", () => {
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const views = db.prepare("SELECT name FROM sqlite_master WHERE type='view'").all() as { name: string }[];
    for (const v of views) db.prepare(`SELECT * FROM ${v.name}`).all();
  });

  it("có đủ dữ liệu hệ thống: kết nối SePay 'default' cho mọi tài khoản bật SePay, danh mục trả nợ / cho vay, nguồn thu cho thuê, config rental_* và notify_*", () => {
    expect(db.prepare("SELECT id FROM sepay_connections").all()).toEqual([{ id: "default" }]);
    expect(count("SELECT COUNT(*) n FROM accounts WHERE sepay_enabled = 1 AND sepay_connection_id IS NOT 'default'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM accounts WHERE sepay_enabled = 1")).toBeGreaterThan(0);
    expect(count("SELECT COUNT(*) n FROM categories WHERE id IN ('debt-payment', 'lending')")).toBe(2);
    // node:sqlite trả bản ghi không kiểu; bảng config chỉ có hai cột chữ k, v.
    const configRows = db.prepare("SELECT k, v FROM config").all() as { k: string; v: string }[];
    const config = Object.fromEntries(configRows.map((r) => [r.k, r.v]));
    expect(config).toMatchObject({ rental_income_stream_id: "rental", tz: "Asia/Ho_Chi_Minh", split_days: "10,25", safety_fund_months: "6", currency: "VND" });
    expect(count(`SELECT COUNT(*) n FROM income_streams WHERE id = '${config.rental_income_stream_id}'`)).toBe(1);
    for (const id of config.rental_shared_categories!.split(",")) expect(count(`SELECT COUNT(*) n FROM categories WHERE id = '${id}'`), id).toBe(1);
    expect(Object.keys(config).filter((k) => k.startsWith("notify_")).sort()).toEqual([
      "notify_daily_enabled", "notify_daily_time", "notify_pending_enabled", "notify_quiet_end", "notify_quiet_start",
      "notify_weekly_day", "notify_weekly_enabled", "notify_weekly_time",
    ]);
  });

  it("mọi danh mục có icon là tên icon có thật; mọi mã trong hộ mẫu là tiếng Anh (chữ thường, số, gạch nối)", () => {
    const categories = db.prepare("SELECT id, icon FROM categories").all() as { id: string; icon: string | null }[];
    expect(categories.filter((c) => !isIconName(c.icon))).toEqual([]);
    const ids = ["members", "accounts", "wallets", "categories", "income_streams", "sepay_connections"].flatMap((t) => {
      const rows = db.prepare(`SELECT id FROM ${t}`).all() as { id: string }[]; // cột id là TEXT PRIMARY KEY
      return rows.map((r) => r.id);
    });
    expect(ids.filter((id) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toEqual([]);
  });
});

describe("phao khẩn cấp", () => {
  it("không báo đầy khi mới có vài khoản chi của tháng đang chạy", () => {
    const db = openDb();
    spend(db, "transport", "fuel-parking", 250_000, monthKey(0));
    expect(db.prepare("SELECT months_of_data, target, pct FROM v_safety_fund").get()).toEqual({
      months_of_data: 0,
      target: null,
      pct: null,
    });
  });

  it("đủ 3 tháng trọn thì target = số tháng × chi Must trung bình, không tính nhóm Have", () => {
    const db = openDb();
    for (const offset of [-1, -2, -3]) {
      spend(db, "food", "groceries", 2_000_000, monthKey(offset));
      spend(db, "nice-to-have", "health", 9_000_000, monthKey(offset)); // Have: không được tính vào
    }
    expect(db.prepare("SELECT months_of_data, target FROM v_safety_fund").get()).toEqual({
      months_of_data: 3,
      target: 12_000_000, // 6 tháng × 2tr
    });
  });
});

describe("chốt chặn toàn vẹn ở tầng DB", () => {
  const seedLog = (db: ReturnType<typeof openDb>, id: string, status: string, ref: string | null = null) =>
    db.prepare(
      `INSERT INTO bank_logs (id, at, amount, direction, account_id, reference_number, status)
       VALUES (?, '2026-09-21T09:00:00+07:00', 100000, 'out', 'vcb-husband', ?, ?)`,
    ).run(id, ref, status);
  const spendFor = (db: ReturnType<typeof openDb>, logId: string, logId2: string | null = null) =>
    db.prepare(
      `INSERT INTO transactions (log_id, log_id_2, at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key)
       VALUES (?, ?, '2026-09-21', 100000, 'spend', 'food', 'vcb-husband', 'groceries', '2026-W39', '2026-09')`,
    ).run(logId, logId2);

  it("không ghi được giao dịch cho log đã gán hoặc đã bỏ qua", () => {
    const db = openDb();
    seedLog(db, "g1", "assigned");
    seedLog(db, "g2", "ignored");
    expect(() => spendFor(db, "g1")).toThrow(/log_not_pending/);
    expect(() => spendFor(db, "g2")).toThrow(/log_not_pending/);
  });

  it("chân thứ hai của cặp cũng phải đang chờ", () => {
    const db = openDb();
    seedLog(db, "g3", "pending");
    seedLog(db, "g4", "assigned");
    expect(() => spendFor(db, "g3", "g4")).toThrow(/log_not_pending/);
    spendFor(db, "g3");
    expect(() => db.prepare("UPDATE transactions SET log_id_2 = 'g4' WHERE log_id = 'g3'").run()).toThrow(/log_not_pending/);
  });

  it("một mã tham chiếu chỉ có một log trong mỗi tài khoản; mã rỗng thì không tính", () => {
    const db = openDb();
    seedLog(db, "r1", "pending", "FT26265001");
    expect(() => seedLog(db, "r2", "pending", "FT26265001")).toThrow(/UNIQUE/);
    seedLog(db, "r3", "pending", "");
    seedLog(db, "r4", "pending", "");
  });

  it("lệnh chuyển tiền chỉ hoàn tất một lần, nhưng trả về chờ được", () => {
    const db = openDb();
    db.prepare("INSERT INTO transfer_orders (id, batch_id, from_account_id, to_account_id, amount, memo) VALUES (1, 'A1', 'vcb-husband', 'tcb-husband', 5, 'PF A1')").run();
    db.prepare("UPDATE transfer_orders SET status = 'done' WHERE id = 1").run();
    expect(() => db.prepare("UPDATE transfer_orders SET status = 'done' WHERE id = 1").run()).toThrow(/order_not_pending/);
    expect(() => db.prepare("UPDATE transfer_orders SET status = 'skipped' WHERE id = 1").run()).toThrow(/order_not_pending/);
    db.prepare("UPDATE transfer_orders SET status = 'pending' WHERE id = 1").run();
  });

  it("debt_lines chỉ ghi thêm và v_debt_balance trừ khoản trả nợ", () => {
    const db = openDb();
    db.prepare("INSERT INTO debts (id, name) VALUES ('aunt-lan', 'Cô Lan')").run();
    db.prepare("INSERT INTO debt_lines (id, debt_id, at, kind, amount) VALUES (1, 'aunt-lan', '2026-10-01', 'opening', 1000000)").run();
    expect(() => db.prepare("INSERT INTO debt_lines (debt_id, at, kind, amount) VALUES ('aunt-lan', '2026-10-01', 'borrow', -5)").run()).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE debt_lines SET amount = 1 WHERE id = 1").run()).toThrow(/debt_line_append_only/);
    expect(() => db.prepare("DELETE FROM debt_lines WHERE id = 1").run()).toThrow(/debt_line_append_only/);
    db.prepare(
      `INSERT INTO transactions (at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key, debt_id)
       VALUES ('2026-10-02', 300000, 'spend', 'rental-income', 'cash-husband', 'debt-payment', '2026-W40', '2026-10', 'aunt-lan')`,
    ).run();
    expect(db.prepare("SELECT owed, paid, balance FROM v_debt_balance WHERE debt_id = 'aunt-lan'").get()).toEqual({ owed: 1_000_000, paid: 300_000, balance: 700_000 });
    db.prepare("UPDATE debt_lines SET status = 'void' WHERE id = 1").run();
    expect(() => db.prepare("UPDATE debt_lines SET status = 'active' WHERE id = 1").run()).toThrow(/debt_line_append_only/);
    expect(db.prepare("SELECT balance FROM v_debt_balance WHERE debt_id = 'aunt-lan'").get()).toEqual({ balance: -300_000 });
  });

  it("receivable_lines chỉ ghi thêm; v_receivable_balance cộng tiền cho vay, trừ tiền nhận lại; ví không đổi", () => {
    const db = openDb();
    const wallets = () => db.prepare("SELECT wallet_id, balance FROM v_wallet_balance ORDER BY wallet_id").all();
    const start = wallets();
    db.prepare("INSERT INTO receivables (id, name) VALUES ('cousin-hai', 'Em Hai')").run();
    db.prepare("INSERT INTO receivable_lines (id, receivable_id, at, kind, amount) VALUES (1, 'cousin-hai', '2026-10-01', 'opening', 1000000)").run();
    expect(() => db.prepare("INSERT INTO receivable_lines (receivable_id, at, kind, amount) VALUES ('cousin-hai', '2026-10-01', 'opening', -5)").run()).toThrow(/CHECK/);
    expect(() => db.prepare("INSERT INTO receivable_lines (receivable_id, at, kind, amount) VALUES ('cousin-hai', '2026-10-01', 'lend', 5)").run()).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE receivable_lines SET amount = 1 WHERE id = 1").run()).toThrow(/receivable_line_append_only/);
    expect(() => db.prepare("DELETE FROM receivable_lines WHERE id = 1").run()).toThrow(/receivable_line_append_only/);
    const tx = db.prepare(
      `INSERT INTO transactions (at, amount, meaning, wallet_id, account_id, counter_account_id, week_key, month_key, receivable_id)
       VALUES ('2026-10-02', ?, ?, ?, ?, ?, '2026-W40', '2026-10', 'cousin-hai')`,
    );
    // Kể cả dòng lend/collect lỡ mang ví (dữ liệu cũ, nhập sai) thì view ví vẫn bỏ qua.
    tx.run(500_000, "lend", "food", "cash-husband", null);
    tx.run(300_000, "collect", "food", null, "vcb-husband");
    expect(db.prepare("SELECT lent, collected, balance FROM v_receivable_balance WHERE receivable_id = 'cousin-hai'").get()).toEqual({
      lent: 1_500_000,
      collected: 300_000,
      balance: 1_200_000,
    });
    expect(wallets()).toEqual(start);
    db.prepare("UPDATE receivable_lines SET status = 'void' WHERE id = 1").run();
    expect(() => db.prepare("UPDATE receivable_lines SET status = 'active' WHERE id = 1").run()).toThrow(/receivable_line_append_only/);
    expect(db.prepare("SELECT balance FROM v_receivable_balance WHERE receivable_id = 'cousin-hai'").get()).toEqual({ balance: 200_000 });
  });
});

describe("đối soát", () => {
  const log = (db: DatabaseSync, id: string, direction: string, amount: number, status: string) =>
    db.prepare(
      `INSERT INTO bank_logs (id, at, amount, direction, account_id, status)
       VALUES (?, '2026-09-21T09:00:00+07:00', ?, ?, 'vcb-husband', ?)`,
    ).run(id, amount, direction, status);
  const row = (db: DatabaseSync) =>
    db.prepare("SELECT book_drift, pending_net, pending_count FROM v_reconcile WHERE account_id='vcb-husband'").get();

  it("log chưa gán hiện là 'chưa gán', không phải lệch", () => {
    const db = openDb();
    log(db, "L1", "in", 500_000, "pending");
    expect(row(db)).toEqual({ book_drift: 0, pending_net: 500_000, pending_count: 1 });
  });

  it("log đã gán mà sổ diễn giải thiếu tiền thì book_drift lộ ra", () => {
    const db = openDb();
    log(db, "L2", "out", 300_000, "pending");
    db.prepare(
      `INSERT INTO transactions (log_id, at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key)
       VALUES ('L2', '2026-09-21', 250000, 'spend', 'food', 'vcb-husband', 'groceries', '2026-W39', '2026-09')`,
    ).run();
    db.prepare("UPDATE bank_logs SET status = 'assigned' WHERE id = 'L2'").run();
    expect(row(db)).toMatchObject({ book_drift: 50_000 });
  });

  it("tài khoản không có feed (tiền mặt) không bị tính book_drift", () => {
    const db = openDb();
    expect(db.prepare("SELECT book_drift FROM v_reconcile WHERE account_id='cash-husband'").get()).toEqual({ book_drift: null });
  });
});
