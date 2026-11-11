// Tài khoản riêng tư: người khác chỉ thấy tổng (access UC-504, ADR-126) — đường REST của sổ / snapshot / bootstrap / đối soát.
// Gán và MCP có test riêng ở ingest / mcp.
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1 } from "./helpers/d1-sqlite";
import { AT, client, householdC } from "./helpers/household-c";
import { householdP, P_NOW } from "./helpers/household-p";
import { openLegacyDb } from "./helpers/legacy";

let db: DatabaseSync;
let call: ReturnType<typeof client>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T09:00:00+07:00"));
  db = householdC();
  call = client(db);
  db.exec(`
    INSERT INTO accounts (id, name, kind, bank, owner_member_id, opening_balance, pocket, pocket_confirmed, private) VALUES
      ('wife-acc', 'Tài khoản của vợ', 'bank', 'VCB', 'wife', 0, 'operating', 1, 1);
  `);
});
afterEach(() => vi.useRealTimers());

async function seedWife() {
  // Chồng không ghi tay được khoản chạm tài khoản riêng tư của vợ (UC-504 AC-14): vợ ghi khoản chuyển từ tài khoản chính.
  await call("POST", "/v1/transactions", { meaning: "transfer", amount: 2_600_000, account_id: "main", to_account_id: "wife-acc", note: "Gửi vợ", at: AT("2026-11-11T08:00:00") }, "wife");
  for (const [i, amount] of [200_000, 150_000, 250_000].entries()) {
    await call("POST", "/v1/transactions", { meaning: "spend", amount, account_id: "wife-acc", category_id: "shopping", note: `Riêng ${i}`, at: AT(`2026-11-11T1${i}:00:00`) }, "wife");
  }
}

describe("tài khoản riêng tư (UC-504)", () => {
  it("UC-504 AC-7: người chồng thấy tài khoản của vợ với số dư 2.000.000 và tổng ngăn cộng đủ; Sổ không có 3 khoản chi, có chuyển khoản từ tài khoản chính (không ghi chú); mở khoản chi → 404; người vợ thấy hết; tắt người vợ → người chồng thấy hết", async () => {
    await seedWife();
    const husband = (await call("GET", "/v1/snapshot", undefined, "husband")).json.data;
    const wife = (await call("GET", "/v1/snapshot", undefined, "wife")).json.data;
    expect(husband.pockets.operating.accounts.find((a: { id: string }) => a.id === "wife-acc")).toMatchObject({ balance: 2_000_000 });
    expect(husband.pockets.operating.total).toBe(wife.pockets.operating.total);
    const list = (who: string, q = "") => call("GET", `/v1/transactions?limit=50${q}`, undefined, who);
    const seen = (await list("husband")).json.data as { id: number; meaning: string; note: string | null; account_id: string | null }[];
    expect(seen.filter((t) => t.account_id === "wife-acc")).toEqual([]);
    expect(seen.find((t) => t.meaning === "transfer")).toMatchObject({ note: null });
    expect((await list("husband", "&account_id=wife-acc")).json.data.map((t: { meaning: string }) => t.meaning)).toEqual(["transfer"]);
    expect((await call("GET", "/v1/transactions/summary?account_id=wife-acc", undefined, "husband")).json.data.spend).toBe(0);
    const spendId = (await list("wife", "&account_id=wife-acc")).json.data.find((t: { meaning: string }) => t.meaning === "spend").id;
    expect((await call("GET", `/v1/transactions/${spendId}`, undefined, "husband")).status).toBe(404);
    expect((await call("GET", `/v1/transactions/${spendId}`, undefined, "wife")).status).toBe(200);
    expect((await list("wife", "&account_id=wife-acc")).json.data).toHaveLength(4);
    expect((await list("wife")).json.data.find((t: { meaning: string }) => t.meaning === "transfer").note).toBe("Gửi vợ");
    db.exec("UPDATE members SET active = 0 WHERE id = 'wife'");
    expect((await list("husband", "&account_id=wife-acc")).json.data).toHaveLength(4);
  });

  it("UC-504 AC-7: bootstrap đánh dấu tài khoản riêng tư của người khác (hiddenFromMe); log chờ của tài khoản đó chỉ là một con số ở snapshot; người chồng đối soát → 403 private_account", async () => {
    db.exec("INSERT INTO bank_logs (id, at, amount, direction, account_id, content) VALUES ('w1', '2026-11-12T01:00:00.000Z', 50000, 'out', 'wife-acc', 'QR')");
    const boot = (who: string) => call("GET", "/v1/bootstrap", undefined, who);
    expect((await boot("husband")).json.data.accounts.find((a: { id: string }) => a.id === "wife-acc")).toMatchObject({ private: true, hiddenFromMe: true });
    expect((await boot("wife")).json.data.accounts.find((a: { id: string }) => a.id === "wife-acc")).toMatchObject({ private: true, hiddenFromMe: false });
    expect((await call("GET", "/v1/snapshot", undefined, "husband")).json.data.attention.hiddenPendingLogs).toBe(1);
    expect((await call("GET", "/v1/snapshot", undefined, "wife")).json.data.attention.hiddenPendingLogs).toBe(0);
    const count = await call("POST", "/v1/accounts/wife-acc/count", { counted: 0 }, "husband");
    expect([count.status, count.json.error?.code]).toEqual([403, "private_account"]);
  });
});

describe("ví riêng tư cũ sau 0040 (UC-504)", () => {
  /** Trước 0040: ví "Chơi (vợ)" private trú ở tài khoản của vợ, có khoản chi cũ trừ ví đó. */
  function legacyPrivate() {
    return openLegacyDb((d) =>
      d.exec(`
        UPDATE accounts SET sepay_enabled = 0, opened_at = NULL;
        UPDATE wallets SET private = 1 WHERE id = 'choi-em';
        INSERT INTO transactions (id, at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key, source, by_member_id)
          VALUES (960, '2026-11-05T03:00:00.000Z', 250000, 'spend', 'choi-em', 'vcb-em', 'qua-bieu', '2026-W45', '2026-11', 'manual', 'em');
      `),
    );
  }
  const asHusband = async (raw: DatabaseSync, path: string) => {
    const env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
    const res = await app.request(path, { headers: { Authorization: "Bearer tok", "X-Member-Id": "anh" } }, env);
    return (await res.json()) as { data: any };
  };

  it("UC-504 AC-6: bản cập nhật không bật tài khoản riêng tư nào (mọi tài khoản private = 0); Sổ của người chồng vẫn thấy mọi khoản của tài khoản của vợ", async () => {
    const raw = legacyPrivate();
    expect(raw.prepare("SELECT COUNT(*) AS n FROM accounts WHERE private <> 0").get()).toEqual({ n: 0 });
    const list = (await asHusband(raw, "/v1/transactions?account_id=vcb-em&month=2026-11")).data as { id: number }[];
    expect(list.map((t) => t.id)).toEqual([960]);
  });

  it("UC-504 AC-9: ví private của người vợ trước 0040 → Sổ của người chồng hiện khoản chi cũ với nhãn cách tính cũ, không tên ví; snapshot không có số ví; tài khoản của vợ private 0", async () => {
    vi.setSystemTime(new Date("2026-12-01T09:00:00+07:00"));
    const raw = legacyPrivate();
    const tx = (await asHusband(raw, "/v1/transactions/960")).data;
    expect(tx).toMatchObject({ id: 960, legacy: true, legacy_class: "flex", amount: 250_000 });
    for (const k of ["wallet_id", "counter_wallet_id", "wallet_name"]) expect(tx).not.toHaveProperty(k);
    const snap = (await asHusband(raw, "/v1/snapshot")).data;
    expect(snap).not.toHaveProperty("wallets");
    expect(JSON.stringify(snap)).not.toMatch(/choi-em|Chơi \(vợ\)/);
    expect(raw.prepare("SELECT private FROM accounts WHERE id = 'vcb-em'").get()).toEqual({ private: 0 });
  });
});

describe("luật giấu ở mọi đường (UC-504, ADR-133) — hộ mẫu P", () => {
  beforeEach(() => {
    vi.setSystemTime(P_NOW);
    db = householdP();
    call = client(db);
  });

  const txCount = () => (db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n;
  const auditCount = () => (db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
  const status = (id: number) => (db.prepare("SELECT status FROM transactions WHERE id = ?").get(id) as { status: string }).status;
  const err = (r: { status: number; json: { error?: { code: string; message: string } } }) => [r.status, r.json.error?.code, r.json.error?.message];

  it("UC-504 AC-11: chồng huỷ / sửa (kể cả trùng client_id) / phân loại lại #101, gỡ gán #103 → 404 giống hệt GET; #102 → 403 private_account; không đổi gì, không nhật ký; vợ làm được", async () => {
    db.exec("UPDATE transactions SET client_id = 'client-101' WHERE id = 101");
    const before = { tx: txCount(), audit: auditCount() };
    const notFound = await call("GET", "/v1/transactions/101");
    expect(err(notFound)).toEqual([404, "not_found", "Không có giao dịch này."]);
    const body = { meaning: "spend", amount: 10_000, account_id: "cash-husband", category_id: "gifts", client_id: "client-101" };
    const attempts = [
      await call("POST", "/v1/transactions/101/void"),
      await call("POST", "/v1/transactions/101/replace", body),
      await call("POST", "/v1/transactions/101/replace", { ...body, client_id: "client-moi-1" }),
      await call("POST", "/v1/transactions/107/replace", body),
      await call("POST", "/v1/transactions", body),
      await call("PUT", "/v1/transactions/101/report-class", { class: "investing" }),
      await call("DELETE", "/v1/transactions/101/report-class"),
      await call("POST", "/v1/logs/transactions/103/void"),
    ];
    for (const r of attempts) {
      expect(r.json).toEqual(notFound.json);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.json)).not.toMatch(/200000|quà sinh nhật|Tiền mặt \(vợ\)|cash-wife/);
    }
    for (const r of [await call("POST", "/v1/transactions/102/void"), await call("POST", "/v1/transactions/102/replace", { ...body, client_id: "client-moi-2" })]) {
      expect([r.status, r.json.error?.code]).toEqual([403, "private_account"]);
    }
    expect([txCount(), auditCount()]).toEqual([before.tx, before.audit]);
    for (const id of [101, 102, 103, 107]) expect(status(id)).toBe("active");
    expect(db.prepare("SELECT status FROM bank_logs WHERE id = 'L3'").get()).toEqual({ status: "assigned" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM transaction_report_classes").get()).toEqual({ n: 0 });

    const wife = (m: string, p: string, b?: unknown) => call(m, p, b, "wife");
    expect((await wife("PUT", "/v1/transactions/101/report-class", { class: "investing" })).status).toBe(200);
    expect((await wife("DELETE", "/v1/transactions/101/report-class")).status).toBe(200);
    expect((await wife("POST", "/v1/transactions/101/replace", { meaning: "spend", amount: 210_000, account_id: "cash-wife", category_id: "gifts" })).status).toBe(201);
    expect((await wife("POST", "/v1/transactions/102/void")).status).toBe(200);
    expect((await wife("POST", "/v1/logs/transactions/103/void")).status).toBe(200);
    for (const id of [101, 102, 103]) expect(status(id)).toBe("void");
  });

  it("UC-504 AC-12: chồng xem #104 → link null (giữ link_id 101), #105 → linked_from rỗng; vợ thấy link 101 và #106", async () => {
    const view = async (id: number, who: string) => (await call("GET", `/v1/transactions/${id}`, undefined, who)).json.data;
    expect(await view(104, "husband")).toMatchObject({ link_id: 101, link: null });
    expect((await view(105, "husband")).linked_from).toEqual([]);
    expect((await view(104, "wife")).link).toMatchObject({ id: 101 });
    expect((await view(105, "wife")).linked_from.map((t: { id: number }) => t.id)).toEqual([106]);
  });

  it("UC-504 AC-14: chồng ghi chi / chuyển vào / thu vào tài khoản riêng tư của vợ, sửa #107 sang đó → 403 private_account, không ghi gì; vợ → 201; vợ đã tắt → chồng 201", async () => {
    const spend = { meaning: "spend", amount: 50_000, account_id: "cash-wife", category_id: "groceries" };
    const before = txCount();
    const attempts = [
      await call("POST", "/v1/transactions", spend),
      await call("POST", "/v1/transactions", { meaning: "transfer", amount: 500_000, account_id: "cash-husband", to_account_id: "cash-wife" }),
      await call("POST", "/v1/transactions", { meaning: "income", amount: 1_000_000, account_id: "cash-wife" }),
      await call("POST", "/v1/transactions/107/replace", { meaning: "spend", amount: 80_000, account_id: "cash-wife", category_id: "eating-out" }),
    ];
    for (const r of attempts) expect([r.status, r.json.error?.code]).toEqual([403, "private_account"]);
    expect(txCount()).toBe(before);
    expect(status(107)).toBe("active");
    expect((await call("POST", "/v1/transactions", spend, "wife")).status).toBe(201);
    db.exec("UPDATE members SET active = 0 WHERE id = 'wife'");
    expect((await call("POST", "/v1/transactions", spend)).status).toBe(201);
  });

  it("UC-504 AC-15: danh sách giao dịch của dòng spend_flex, payments của sổ nợ, movements của sổ phải thu không có #101, #108, #109 với chồng; tổng vẫn cộng; vợ thấy", async () => {
    const ids = (list: { id: number }[]) => list.map((t) => t.id);
    const flex = async (who: string) => ids((await call("GET", "/v1/reports/transactions?period=2026-11&line=spend_flex", undefined, who)).json.data.transactions);
    expect(await flex("husband")).not.toContain(101);
    expect(await flex("wife")).toContain(101);
    const flexTotal = async (who: string) =>
      (await call("GET", "/v1/reports/cash-flow?period=2026-11", undefined, who)).json.data.groups
        .flatMap((g: { lines: { line: string; total: number }[] }) => g.lines)
        .find((l: { line: string }) => l.line === "spend_flex").total;
    expect(await flexTotal("husband")).toBe(await flexTotal("wife"));
    expect(await flexTotal("husband")).toBeLessThanOrEqual(-200_000);

    const debt = async (who: string) => (await call("GET", "/v1/debts", undefined, who)).json.data.debts.find((d: { id: string }) => d.id === "vay-anh-ba");
    expect(await debt("husband")).toMatchObject({ paid: 400_000, balance: 1_600_000, payments: [] });
    const txIds = (list: { transactionId: number }[]) => list.map((t) => t.transactionId);
    expect(txIds((await debt("wife")).payments)).toEqual([108]);
    const recv = async (who: string) => (await call("GET", "/v1/receivables", undefined, who)).json.data.receivables.find((r: { id: string }) => r.id === "em-hai");
    expect(await recv("husband")).toMatchObject({ lent: 300_000, balance: 300_000, movements: [] });
    expect(txIds((await recv("wife")).movements)).toEqual([109]);
    const husbandText = JSON.stringify([(await call("GET", "/v1/debts")).json, (await call("GET", "/v1/receivables")).json]);
    expect(husbandText).not.toMatch(/"transactionId":10[189]\b/);
  });

  it("UC-504 AC-16: link_id tới #101 (bị giấu) như id không có — ghi, gán L4, sửa #107; sửa #104 giữ link 101 → 201; vợ → 201", async () => {
    const refund = (link_id: number) => ({ meaning: "refund", amount: 30_000, account_id: "cash-husband", link_id });
    const before = txCount();
    const missing = await call("POST", "/v1/transactions", refund(99999));
    expect([missing.status, missing.json.error?.code]).toEqual([400, "invalid_link"]);
    expect(err(await call("POST", "/v1/transactions", refund(101)))).toEqual(err(missing));
    const assign = (link_id: number) => call("POST", "/v1/logs/L4/assign", { splits: [{ meaning: "refund", amount: 50_000, link_id }] });
    expect(err(await assign(101))).toEqual(err(await assign(99999)));
    expect(db.prepare("SELECT status FROM bank_logs WHERE id = 'L4'").get()).toEqual({ status: "pending" });
    const replace107 = (link_id: number) => call("POST", "/v1/transactions/107/replace", { meaning: "refund", amount: 80_000, account_id: "cash-husband", link_id });
    expect(err(await replace107(101))).toEqual(err(await replace107(99999)));
    expect(err(await replace107(101))).toEqual(err(missing));
    expect(status(107)).toBe("active");
    expect(txCount()).toBe(before);

    const kept = await call("POST", "/v1/transactions/104/replace", { meaning: "refund", amount: 40_000, account_id: "cash-husband", link_id: 101 });
    expect(kept.status).toBe(201);
    expect(kept.json.data.tx).toMatchObject({ amount: 40_000, link_id: 101, category_id: "gifts", link: null });
    expect((await call("POST", "/v1/transactions", { ...refund(101), account_id: "cash-wife" }, "wife")).status).toBe(201);
  });

  it("UC-504 AC-18: lương 20.000.000 về vcb-wife mở kỳ → snapshot của chồng mọi việc có source { hidden: true }; vợ thấy đủ; vợ đã tắt → chồng thấy đủ", async () => {
    db.exec(`
      UPDATE accounts SET sepay_enabled = 0 WHERE id = 'vcb-wife';
      UPDATE config SET v = '10' WHERE k = 'savings_pct';
    `);
    const income = await call("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "vcb-wife", income_stream_id: "salary-husband", at: "2026-11-12T01:00:00.000Z" }, "wife");
    expect(income.status).toBe(201);
    expect(income.json.data.effects.cycle).toMatchObject({ opened: true });
    const txId = income.json.data.tx.id;
    const tasks = async (who: string) => (await call("GET", "/v1/snapshot", undefined, who)).json.data.payCycle.tasks as { kind: string; amount: number; status: string; source: unknown }[];
    const husband = await tasks("husband");
    const wife = await tasks("wife");
    expect(husband.find((t) => t.kind === "savings")).toMatchObject({ amount: 2_000_000, status: "open" });
    const sourced = wife.filter((t) => t.source !== null);
    expect(sourced.length).toBeGreaterThan(0);
    for (const t of sourced) expect(t.source).toMatchObject({ txId, amount: 20_000_000 });
    expect(husband.map((t) => ({ ...t, source: t.source === null ? null : { hidden: true } }))).toEqual(husband);
    expect(husband.filter((t) => t.source !== null)).toHaveLength(sourced.length);
    expect(husband.map(({ source: _s, ...t }) => t)).toEqual(wife.map(({ source: _s, ...t }) => t));
    expect(JSON.stringify(husband)).not.toMatch(/20000000|streamName/);
    db.exec("UPDATE members SET active = 0 WHERE id = 'wife'");
    expect((await tasks("husband")).filter((t) => t.source !== null).every((t) => (t.source as { txId: number }).txId === txId)).toBe(true);
  });
});
