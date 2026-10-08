import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import type { Receivable, ReceivableLine } from "../src/services/receivables";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: DatabaseSync;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T05:00:00.000Z"));
  raw = openDb();
  // Bối cảnh: nhà chưa nối bank feed — tài khoản ngân hàng nhận nhập tay.
  raw.prepare("UPDATE accounts SET sepay_enabled = 0").run();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.useRealTimers());

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type ReceivablesData = { totalBalance: number; receivables: Receivable[] };
type EntryData = { tx: Record<string, unknown> & { id: number } };

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}

const receivables = async () => (await call<ReceivablesData>("GET", "/v1/receivables")).json.data;
const receivable = async (id = "em-hai") => (await receivables()).receivables.find((r) => r.id === id)!;
const tx = (meaning: "lend" | "collect", amount: number, extra: Record<string, unknown> = {}) =>
  call<EntryData>("POST", "/v1/transactions", { meaning, amount, receivable_id: "em-hai", ...extra });
const wallets = () => raw.prepare("SELECT wallet_id, balance FROM v_wallet_balance ORDER BY wallet_id").all();
const books = () => Object.fromEntries((raw.prepare("SELECT account_id, book_balance FROM v_account_book").all() as { account_id: string; book_balance: number }[]).map((r) => [r.account_id, r.book_balance]));

async function seedReceivable(amount = 2_000_000) {
  const res = await call<Receivable>("POST", "/v1/receivables", { name: "Em Hai", amount, note: "Mượn mua xe" });
  expect(res.status).toBe(201);
  return res.json.data;
}

/** Lương 20tr vào VCB rồi chia: các ví có tiền, "còn để chi tuần này" > 0. */
async function salary() {
  const income = await call<EntryData>("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "vcb-husband", at: "2026-10-01T02:00:00.000Z" });
  expect((await call("POST", "/v1/allocate", { income_tx_id: income.json.data.tx.id })).status).toBe(201);
}

describe("sổ phải thu", () => {
  it("thêm khoản phải thu chỉ ghi nhớ: dòng opening, không tài khoản nào, không ví nào đổi", async () => {
    const [walletsBefore, booksBefore] = [wallets(), books()];
    const created = await seedReceivable(15_000_000);
    expect(created).toMatchObject({ id: "em-hai", name: "Em Hai", note: "Mượn mua xe", active: true, lent: 15_000_000, collected: 0, balance: 15_000_000, done: false, movements: [] });
    expect(created.lines).toMatchObject([{ receivableId: "em-hai", kind: "opening", amount: 15_000_000, status: "active" }]);
    expect((await receivables()).totalBalance).toBe(15_000_000);
    expect(wallets()).toEqual(walletsBefore);
    expect(books()).toEqual(booksBefore);
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
  });

  it("thêm khoản phải thu: số tiền âm hoặc lẻ bị từ chối, trùng mã báo duplicate_id", async () => {
    for (const amount of [-5, 1.5]) {
      const res = await call("POST", "/v1/receivables", { name: "Chú Tư", amount });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("invalid_amount");
    }
    expect((await call("POST", "/v1/receivables", { amount: 100 })).json.error?.code).toBe("invalid_input");
    await seedReceivable();
    const dup = await call("POST", "/v1/receivables", { name: "Em  Hai", amount: 100 });
    expect(dup.status).toBe(409);
    expect(dup.json.error?.code).toBe("duplicate_id");
    expect(raw.prepare("SELECT COUNT(*) n FROM receivables").get()).toEqual({ n: 1 });
  });

  it("thêm người với số 0 (+ Người mới… ở màn Gán): không dòng opening, còn phải thu 0; nhận lại thì thành trả dư", async () => {
    const [walletsBefore, booksBefore] = [wallets(), books()];
    const created = await seedReceivable(0);
    expect(created).toMatchObject({ id: "em-hai", name: "Em Hai", lent: 0, collected: 0, balance: 0, done: true, lines: [], movements: [] });
    expect(raw.prepare("SELECT COUNT(*) n FROM receivable_lines").get()).toEqual({ n: 0 });
    expect(wallets()).toEqual(walletsBefore);
    expect(books()).toEqual(booksBefore);
    const boot = (await call<{ receivables: unknown[] }>("GET", "/v1/bootstrap")).json.data;
    expect(boot.receivables).toEqual([{ id: "em-hai", name: "Em Hai", balance: 0 }]);

    expect((await tx("collect", 250_000, { account_id: "vcb-husband" })).status).toBe(201);
    expect(await receivable()).toMatchObject({ lent: 0, collected: 250_000, balance: -250_000, done: true });
    expect((await receivables()).totalBalance).toBe(0);
  });

  it("collect nâng số dư sổ của tài khoản nhận, không đụng ví nào, trừ số phải thu", async () => {
    await seedReceivable();
    const [walletsBefore, booksBefore] = [wallets(), books()];
    const res = await tx("collect", 700_000, { account_id: "vcb-husband" });
    expect(res.status).toBe(201);
    expect(res.json.data.tx).toMatchObject({ meaning: "collect", receivable_id: "em-hai", counter_account_id: "vcb-husband", account_id: null, wallet_id: null, counter_wallet_id: null, category_id: null });
    expect(books()).toEqual({ ...booksBefore, "vcb-husband": booksBefore["vcb-husband"]! + 700_000 });
    expect(wallets()).toEqual(walletsBefore);
    const r = await receivable();
    expect(r).toMatchObject({ lent: 2_000_000, collected: 700_000, balance: 1_300_000, done: false });
    expect(r.movements).toMatchObject([{ transactionId: res.json.data.tx.id, kind: "collect", amount: 700_000, accountId: "vcb-husband", source: "manual" }]);
  });

  it("collect không có tài khoản thì vào tiền mặt của người ghi", async () => {
    await seedReceivable();
    expect((await tx("collect", 100_000)).json.data.tx).toMatchObject({ counter_account_id: "cash-husband" });
  });

  it("cho vay thêm (lend gắn khoản phải thu) tăng số phải thu, trừ tài khoản, không trừ ví, danh mục mặc định Cho vay", async () => {
    await seedReceivable();
    const [walletsBefore, booksBefore] = [wallets(), books()];
    const res = await tx("lend", 500_000, { account_id: "vcb-husband" });
    expect(res.status).toBe(201);
    expect(res.json.data.tx).toMatchObject({ meaning: "lend", receivable_id: "em-hai", account_id: "vcb-husband", category_id: "lending", wallet_id: null, counter_wallet_id: null });
    expect(books()).toEqual({ ...booksBefore, "vcb-husband": booksBefore["vcb-husband"]! - 500_000 });
    expect(wallets()).toEqual(walletsBefore);
    expect(await receivable()).toMatchObject({ lent: 2_500_000, collected: 0, balance: 2_500_000 });
    expect((await receivable()).movements).toMatchObject([{ kind: "lend", amount: 500_000, accountId: "vcb-husband" }]);
  });

  it("huỷ khoản cho vay hoặc khoản nhận lại thì số phải thu trở lại", async () => {
    await seedReceivable();
    const lend = (await tx("lend", 500_000)).json.data.tx.id;
    const collect = (await tx("collect", 800_000)).json.data.tx.id;
    expect((await receivable()).balance).toBe(1_700_000);
    expect((await call("POST", `/v1/transactions/${collect}/void`)).status).toBe(200);
    expect(await receivable()).toMatchObject({ collected: 0, balance: 2_500_000 });
    expect((await call("POST", `/v1/transactions/${lend}/void`)).status).toBe(200);
    expect(await receivable()).toMatchObject({ lent: 2_000_000, balance: 2_000_000, movements: [] });
  });

  it("chỉnh tay cộng hoặc trừ số phải thu; chỉ ghi tay được dòng adjust", async () => {
    await seedReceivable();
    const res = await call<ReceivableLine>("POST", "/v1/receivables/em-hai/lines", { kind: "adjust", amount: -200_000, note: "Bớt cho em" });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ receivableId: "em-hai", kind: "adjust", amount: -200_000, note: "Bớt cho em", status: "active" });
    expect((await receivable()).balance).toBe(1_800_000);
    expect((await call("POST", "/v1/receivables/em-hai/lines", { kind: "adjust", amount: 50_000 })).status).toBe(201);
    expect((await receivable()).balance).toBe(1_850_000);
    expect((await call("POST", "/v1/receivables/em-hai/lines", { kind: "adjust", amount: 0 })).json.error?.code).toBe("invalid_amount");
    for (const kind of ["opening", "lend", "borrow"]) {
      expect((await call("POST", "/v1/receivables/em-hai/lines", { kind, amount: 1 })).json.error?.code).toBe("invalid_kind");
    }
    expect((await call("POST", "/v1/receivables/khong-co/lines", { kind: "adjust", amount: 1 })).status).toBe(404);
  });

  it("huỷ dòng phải thu thì số phải thu đổi lại, huỷ lần hai báo already_void", async () => {
    await seedReceivable();
    const line = (await call<ReceivableLine>("POST", "/v1/receivables/em-hai/lines", { kind: "adjust", amount: 300_000 })).json.data;
    const voided = await call("POST", `/v1/receivable-lines/${line.id}/void`);
    expect(voided.status).toBe(200);
    expect(voided.json.data).toMatchObject({ id: line.id, status: "void" });
    const r = await receivable();
    expect(r.balance).toBe(2_000_000);
    expect(r.lines.map((l) => l.kind)).toEqual(["opening"]);
    const again = await call("POST", `/v1/receivable-lines/${line.id}/void`);
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("already_void");
    expect((await call("POST", "/v1/receivable-lines/999/void")).status).toBe(404);
  });

  it("trả đủ thì khoản phải thu done, xuống cuối danh sách, không còn trong tổng", async () => {
    await seedReceivable(1_000_000);
    expect((await call("POST", "/v1/receivables", { id: "chu-tu", name: "Chú Tư", amount: 500_000 })).status).toBe(201);
    await tx("collect", 1_000_000);
    const data = await receivables();
    expect(data.totalBalance).toBe(500_000);
    expect(data.receivables.map((r) => [r.id, r.balance, r.done])).toEqual([
      ["chu-tu", 500_000, false],
      ["em-hai", 0, true],
    ]);
  });

  it("receivable_id chỉ gắn với lend / collect: receivable_only, kể cả refund", async () => {
    await seedReceivable();
    for (const body of [
      { meaning: "refund", amount: 100, category_id: "lending", wallet_id: "nice-to-have" },
      { meaning: "spend", amount: 100, category_id: "eating-out" },
      { meaning: "income", amount: 100, account_id: "vcb-husband" },
      { meaning: "transfer", amount: 100, account_id: "vcb-husband", to_account_id: "cash-husband" },
    ]) {
      const res = await call("POST", "/v1/transactions", { ...body, receivable_id: "em-hai" });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("receivable_only");
    }
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
  });

  it("receivable_id không có hoặc đã tắt: unknown_receivable, inactive_receivable", async () => {
    await seedReceivable();
    expect((await tx("collect", 100, { receivable_id: "khong-co" })).json.error?.code).toBe("unknown_receivable");
    const off = await call<Receivable>("PATCH", "/v1/receivables/em-hai", { active: false, name: "Em Hai (cũ)" });
    expect(off.json.data).toMatchObject({ active: false, name: "Em Hai (cũ)" });
    expect((await tx("lend", 100)).json.error?.code).toBe("inactive_receivable");
    expect((await tx("collect", 100)).json.error?.code).toBe("inactive_receivable");
    expect((await call("POST", "/v1/receivables/em-hai/lines", { kind: "adjust", amount: 1 })).json.error?.code).toBe("inactive_receivable");
    expect((await receivables()).totalBalance).toBe(0);
  });

  it("bootstrap trả các khoản phải thu đang mở kèm số còn phải thu", async () => {
    await seedReceivable(1_000_000);
    await call("POST", "/v1/receivables", { id: "chu-tu", name: "Chú Tư", amount: 3_000_000 });
    await call("POST", "/v1/receivables", { id: "cu", name: "Khoản cũ", amount: 1 });
    await call("PATCH", "/v1/receivables/cu", { active: false });
    await tx("collect", 250_000);
    expect((await call<{ receivables: unknown }>("GET", "/v1/bootstrap")).json.data.receivables).toEqual([
      { id: "chu-tu", name: "Chú Tư", balance: 3_000_000 },
      { id: "em-hai", name: "Em Hai", balance: 750_000 },
    ]);
  });

  it("dòng phải thu chỉ ghi thêm: chỉ đổi active sang void, không xoá", async () => {
    await seedReceivable();
    const id = Number((raw.prepare("SELECT id FROM receivable_lines").get() as { id: number }).id);
    expect(() => raw.prepare("UPDATE receivable_lines SET amount = 1 WHERE id = ?").run(id)).toThrow(/receivable_line_append_only/);
    expect(() => raw.prepare("UPDATE receivable_lines SET note = 'sửa' WHERE id = ?").run(id)).toThrow(/receivable_line_append_only/);
    expect(() => raw.prepare("DELETE FROM receivable_lines WHERE id = ?").run(id)).toThrow(/receivable_line_append_only/);
    raw.prepare("UPDATE receivable_lines SET status = 'void' WHERE id = ?").run(id);
    expect(() => raw.prepare("UPDATE receivable_lines SET status = 'active' WHERE id = ?").run(id)).toThrow(/receivable_line_append_only/);
  });
});

describe("tiền cho vay về không phải thu nhập (ADR-72)", () => {
  it("lỗi cũ: cho vay 300.000 rồi nhận lại 300.000 — không ví nào đổi, tài khoản về như cũ, còn phải thu 0", async () => {
    await call("POST", "/v1/receivables", { name: "Em Hai", amount: 1, at: "2026-10-01T00:00:00.000Z" });
    await call("POST", "/v1/receivables/em-hai/lines", { kind: "adjust", amount: -1 });
    const [walletsBefore, booksBefore] = [wallets(), books()];
    expect((await tx("lend", 300_000, { account_id: "vcb-husband" })).status).toBe(201);
    expect((await receivable()).balance).toBe(300_000);
    expect((await tx("collect", 300_000, { account_id: "vcb-husband" })).status).toBe(201);
    expect(wallets()).toEqual(walletsBefore);
    expect(books()).toEqual(booksBefore);
    expect(await receivable()).toMatchObject({ lent: 300_000, collected: 300_000, balance: 0, done: true });
  });

  it("collect không đổi 'còn để chi tuần này', không vào đã tiêu, không chia được như thu nhập — chỉ tiền chi được tăng (tiền thật về tài khoản)", async () => {
    await salary();
    await seedReceivable();
    const snapshot = async () => (await call<{ spendableThisWeek: number; spendableCash: { amount: number } }>("GET", "/v1/snapshot")).json.data;
    const spent = () => raw.prepare("SELECT wallet_id, week_key, spent FROM v_spent_week ORDER BY wallet_id").all();
    const { spendableCash: cashBefore, ...before } = await snapshot();
    const spentBefore = spent();
    expect(before.spendableThisWeek).toBeGreaterThan(0);
    const collect = (await tx("collect", 1_500_000, { account_id: "vcb-husband" })).json.data.tx;
    const { spendableCash: cashAfter, ...after } = await snapshot();
    expect(after).toEqual(before);
    expect(cashAfter.amount - cashBefore.amount).toBe(1_500_000);
    expect(spent()).toEqual(spentBefore);
    const allocate = await call("POST", "/v1/allocate", { income_tx_id: collect.id });
    expect(allocate.status).toBe(404);
    expect(allocate.json.error?.code).toBe("not_income");
  });
});

describe("GET /v1/networth — tiền thật trước, ghi nhớ ai nợ ai sau", () => {
  type NetWorth = {
    cash: number;
    wealthBuildingCash: number;
    wealthBuildingAccounts: { total: number; accounts: unknown[] };
    spendableThisWeek: number;
    assets: number;
    receivables: number;
    tenants: number;
    tenantsPrepaid: number;
    debts: number;
    netWorth: number;
  };
  const netWorth = async () => (await call<NetWorth>("GET", "/v1/networth")).json.data;

  it("chưa có gì: mọi số bằng 0", async () => {
    expect(await netWorth()).toEqual({ cash: 0, wealthBuildingCash: 0, wealthBuildingAccounts: { total: 0, accounts: [] }, spendableThisWeek: 0, assets: 0, receivables: 0, tenants: 0, tenantsPrepaid: 0, debts: 0, netWorth: 0 });
  });

  it("tiền thật = Σ số dư sổ tài khoản đang dùng; sổ phải thu / nợ / người thuê không bao giờ vào tiền thật", async () => {
    raw.prepare("INSERT INTO accounts (id, name, kind, opening_balance, active) VALUES ('old-account', 'TK cũ', 'bank', 7000000, 0)").run();
    await salary(); // +20tr vào VCB, Tích sản được chia 6tr
    expect((await call("POST", "/v1/transactions", { meaning: "buy_asset", amount: 1_000_000, asset_kind: "gold", account_id: "tcb-husband" })).status).toBe(201);
    const afterCash = await netWorth();
    expect(afterCash).toMatchObject({ cash: 19_000_000, wealthBuildingCash: 5_000_000, assets: 1_000_000 });

    // Chỉ ghi nhớ: không đổi tiền thật.
    await seedReceivable(2_000_000);
    await call("POST", "/v1/receivables", { id: "cu", name: "Đã tắt", amount: 9_000_000 });
    await call("PATCH", "/v1/receivables/cu", { active: false });
    await call("POST", "/v1/debts", { name: "Cô Lan", amount: 4_000_000 });
    raw.exec(`
      INSERT INTO tenants (id, name) VALUES ('food', 'An'), ('binh', 'Bình');
      INSERT INTO tenant_lines (tenant_id, month_key, at, kind, amount) VALUES ('food', '2026-10', '2026-10-01', 'opening', 3000000), ('binh', '2026-10', '2026-10-01', 'opening', -200000);
    `);
    expect((await netWorth()).cash).toBe(19_000_000);

    // Tiền thật đi / về mới đổi tiền thật, đúng bằng số tiền.
    await tx("lend", 500_000, { account_id: "cash-husband" });
    await tx("collect", 300_000, { account_id: "vcb-husband" });
    const n = await netWorth();
    expect(n).toEqual({
      cash: 18_800_000,
      wealthBuildingCash: 5_000_000,
      wealthBuildingAccounts: { total: 0, accounts: [] },
      spendableThisWeek: afterCash.spendableThisWeek,
      assets: 1_000_000,
      receivables: 2_200_000,
      tenants: 3_000_000,
      tenantsPrepaid: 200_000,
      debts: 4_000_000,
      netWorth: 18_800_000 + 1_000_000 + 2_200_000 + 3_000_000 - 4_000_000 - 200_000,
    });
    expect(n.cash).toBe(((raw.prepare("SELECT SUM(book_balance) s FROM v_account_book").get()) as { s: number }).s);
  });
});

describe("trả cho khoản cho vay khi nhập tay (change 261005-lien-ket-khoan-goc)", () => {
  it("nhận lại có link_id về khoản cho vay: không chọn người thì lấy người của khoản cho vay; khác người, trỏ khoản chi hay khoản đã huỷ → invalid_link; sửa giữ liên kết", async () => {
    await seedReceivable(0);
    expect((await call("POST", "/v1/receivables", { name: "Chị Lan", amount: 0 })).status).toBe(201);
    const lend = (await tx("lend", 1_000_000, { account_id: "vcb-husband" })).json.data.tx.id;
    const res = await call<EntryData>("POST", "/v1/transactions", { meaning: "collect", amount: 600_000, account_id: "vcb-husband", link_id: lend });
    expect(res.status).toBe(201);
    expect(res.json.data.tx).toMatchObject({ meaning: "collect", link_id: lend, receivable_id: "em-hai", wallet_id: null, category_id: null });
    expect((await receivable()).balance).toBe(400_000);

    const spend = (await call<EntryData>("POST", "/v1/transactions", { meaning: "spend", amount: 50_000, category_id: "groceries", account_id: "vcb-husband" })).json.data.tx.id;
    const voided = (await tx("lend", 200_000, { account_id: "vcb-husband" })).json.data.tx.id;
    expect((await call("POST", `/v1/transactions/${voided}/void`)).status).toBe(200);
    const count = () => raw.prepare("SELECT COUNT(*) n FROM transactions").get();
    const before = count();
    for (const body of [
      { link_id: lend, receivable_id: "chi-lan" },
      { link_id: spend },
      { link_id: voided },
    ]) {
      const bad = await call("POST", "/v1/transactions", { meaning: "collect", amount: 1_000, account_id: "vcb-husband", ...body });
      expect(bad.status).toBe(400);
      expect(bad.json.error?.code).toBe("invalid_link");
    }
    expect(count()).toEqual(before);

    const edited = await call<EntryData>("POST", `/v1/transactions/${res.json.data.tx.id}/replace`, { meaning: "collect", amount: 700_000, account_id: "vcb-husband", link_id: lend });
    expect(edited.status).toBe(201);
    expect(edited.json.data.tx).toMatchObject({ link_id: lend, receivable_id: "em-hai", amount: 700_000 });
    expect((await receivable()).balance).toBe(300_000);
  });

  it("cho vay và nhận lại khác tài khoản (tiền mặt ↔ ngân hàng) vẫn nối được; số phải thu và số dư từng tài khoản đúng", async () => {
    await seedReceivable(0);
    const book = (id: string): number => {
      const row = raw.prepare("SELECT book_balance b FROM v_account_book WHERE account_id = ?").get(id);
      if (!row || typeof row.b !== "number") throw new Error(`không có số dư sổ của ${id}`);
      return row.b;
    };
    const cash0 = book("cash-husband"), bank0 = book("vcb-husband");
    const lend = (await tx("lend", 500_000, { account_id: "cash-husband" })).json.data.tx.id; // đưa tiền mặt
    const back = await call<EntryData>("POST", "/v1/transactions", { meaning: "collect", amount: 500_000, account_id: "vcb-husband", link_id: lend }); // trả qua số tài khoản
    expect(back.status).toBe(201);
    expect(back.json.data.tx).toMatchObject({ link_id: lend, receivable_id: "em-hai" });
    expect((await receivable()).balance).toBe(0);
    expect([book("cash-husband") - cash0, book("vcb-husband") - bank0]).toEqual([-500_000, 500_000]);
  });

  it("sửa khoản gốc: khoản trả về trỏ sang khoản mới; đổi loại hay đổi người của khoản gốc thì invalid_link, không đổi gì; xoá khoản gốc thì liên kết giữ, khoản gốc hiện đã xoá", async () => {
    await seedReceivable(0);
    expect((await call("POST", "/v1/receivables", { name: "Chị Lan", amount: 0 })).status).toBe(201);
    const lend = (await tx("lend", 1_000_000, { account_id: "vcb-husband" })).json.data.tx.id;
    const collect = (await call<EntryData>("POST", "/v1/transactions", { meaning: "collect", amount: 600_000, account_id: "vcb-husband", link_id: lend })).json.data.tx.id;
    const linkOf = (id: number) => raw.prepare("SELECT link_id FROM transactions WHERE id = ?").get(id);

    const edited = await call<EntryData>("POST", `/v1/transactions/${lend}/replace`, { meaning: "lend", amount: 1_200_000, account_id: "vcb-husband", receivable_id: "em-hai" });
    expect(edited.status).toBe(201);
    const lend2 = edited.json.data.tx.id;
    expect(linkOf(collect)).toEqual({ link_id: lend2 });
    expect(edited.json.data.tx).toMatchObject({ linked_from: [{ id: collect, amount: 600_000, meaning: "collect" }] });
    expect((await receivable()).balance).toBe(600_000);

    const before = raw.prepare("SELECT COUNT(*) n FROM transactions").get();
    for (const body of [
      { meaning: "spend", amount: 1_200_000, category_id: "groceries", account_id: "vcb-husband" },
      { meaning: "lend", amount: 1_200_000, account_id: "vcb-husband", receivable_id: "chi-lan" },
    ]) {
      const bad = await call("POST", `/v1/transactions/${lend2}/replace`, body);
      expect(bad.status).toBe(400);
      expect(bad.json.error).toMatchObject({ code: "invalid_link", message: "Khoản này đang có khoản trả lại trỏ về — gỡ liên kết trước." });
    }
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual(before);
    expect(raw.prepare("SELECT status FROM transactions WHERE id = ?").get(lend2)).toEqual({ status: "active" });

    const spend = (await call<EntryData>("POST", "/v1/transactions", { meaning: "spend", amount: 244_000, category_id: "groceries", account_id: "vcb-husband" })).json.data.tx.id;
    expect((await call("POST", "/v1/transactions", { meaning: "refund", amount: 250_000, category_id: "groceries", account_id: "vcb-husband", link_id: spend })).status).toBe(201);
    const transfer = await call("POST", `/v1/transactions/${spend}/replace`, { meaning: "transfer", amount: 244_000, account_id: "vcb-husband", to_account_id: "cash-husband" });
    expect(transfer.json.error?.code).toBe("invalid_link");

    expect((await call("POST", `/v1/transactions/${lend2}/void`)).status).toBe(200);
    expect(linkOf(collect)).toEqual({ link_id: lend2 });
    const view = (await call<Record<string, unknown>>("GET", `/v1/transactions/${collect}`)).json.data;
    expect(view.link).toMatchObject({ id: lend2, status: "void" });
  });
});
