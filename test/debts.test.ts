import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import type { Debt, DebtLine } from "../src/services/debts";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: DatabaseSync;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T05:00:00.000Z"));
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.useRealTimers());

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type DebtsData = { totalBalance: number; debts: Debt[] };
type EntryData = { tx: Record<string, unknown> & { id: number } };

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}

const debts = async () => (await call<DebtsData>("GET", "/v1/debts")).json.data;
const debt = async (id = "co-lan") => (await debts()).debts.find((d) => d.id === id)!;
const pay = (amount: number, extra: Record<string, unknown> = {}) => call<EntryData>("POST", "/v1/transactions", { meaning: "spend", amount, debt_id: "co-lan", ...extra });

async function seedDebt(amount = 10_000_000) {
  const res = await call<Debt>("POST", "/v1/debts", { name: "Cô Lan", amount, note: "Mượn sửa nhà" });
  expect(res.status).toBe(201);
  return res.json.data;
}

describe("sổ nợ", () => {
  it("tạo khoản nợ ghi dòng opening, số còn nợ bằng số tiền", async () => {
    const created = await seedDebt(15_379_000);
    expect(created).toMatchObject({ id: "co-lan", name: "Cô Lan", note: "Mượn sửa nhà", active: true, owed: 15_379_000, paid: 0, balance: 15_379_000, done: false, payments: [] });
    expect(created.lines).toMatchObject([{ kind: "opening", amount: 15_379_000, status: "active" }]);
    expect((await debts()).totalBalance).toBe(15_379_000);
  });

  it("thêm khoản nợ: số tiền phải lớn hơn 0, trùng mã báo duplicate_id", async () => {
    for (const amount of [0, -5, 1.5]) {
      const res = await call("POST", "/v1/debts", { name: "Chú Tư", amount });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("invalid_amount");
    }
    expect((await call("POST", "/v1/debts", { amount: 100 })).json.error?.code).toBe("invalid_input");
    await seedDebt();
    const dup = await call("POST", "/v1/debts", { name: "Cô  Lan", amount: 100 });
    expect(dup.status).toBe(409);
    expect(dup.json.error?.code).toBe("duplicate_id");
    expect(raw.prepare("SELECT COUNT(*) n FROM debts").get()).toEqual({ n: 1 });
  });

  it("khoản chi có debt_id làm giảm số còn nợ", async () => {
    await seedDebt();
    const res = await pay(4_000_000, { category_id: "debt-payment", wallet_id: "rental-income" });
    expect(res.status).toBe(201);
    expect(res.json.data.tx).toMatchObject({ debt_id: "co-lan", meaning: "spend", counter_wallet_id: "rental-income" });
    const d = await debt();
    expect(d).toMatchObject({ owed: 10_000_000, paid: 4_000_000, balance: 6_000_000, done: false });
    expect(d.payments).toMatchObject([{ transactionId: res.json.data.tx.id, amount: 4_000_000, walletId: "rental-income", source: "manual" }]);
  });

  it("huỷ khoản trả nợ thì số còn nợ trở lại", async () => {
    await seedDebt();
    const id = (await pay(4_000_000)).json.data.tx.id;
    expect((await call("POST", `/v1/transactions/${id}/void`)).status).toBe(200);
    expect(await debt()).toMatchObject({ paid: 0, balance: 10_000_000, payments: [] });
  });

  it("vay thêm làm tăng số còn nợ", async () => {
    await seedDebt();
    const res = await call<DebtLine>("POST", "/v1/debts/co-lan/lines", { kind: "borrow", amount: 2_000_000, note: "Mượn thêm" });
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ debtId: "co-lan", kind: "borrow", amount: 2_000_000, note: "Mượn thêm", status: "active" });
    expect(await debt()).toMatchObject({ owed: 12_000_000, balance: 12_000_000 });
    expect((await call("POST", "/v1/debts/co-lan/lines", { kind: "borrow", amount: -1 })).json.error?.code).toBe("invalid_amount");
    expect((await call("POST", "/v1/debts/co-lan/lines", { kind: "opening", amount: 1 })).json.error?.code).toBe("invalid_kind");
    expect((await call("POST", "/v1/debts/khong-co/lines", { kind: "borrow", amount: 1 })).status).toBe(404);
  });

  it("chỉnh tay cộng hoặc trừ số còn nợ", async () => {
    await seedDebt();
    expect((await call("POST", "/v1/debts/co-lan/lines", { kind: "adjust", amount: -379_000, note: "Cô bớt lẻ" })).status).toBe(201);
    expect((await debt()).balance).toBe(9_621_000);
    expect((await call("POST", "/v1/debts/co-lan/lines", { kind: "adjust", amount: 50_000 })).status).toBe(201);
    expect((await debt()).balance).toBe(9_671_000);
    expect((await call("POST", "/v1/debts/co-lan/lines", { kind: "adjust", amount: 0 })).json.error?.code).toBe("invalid_amount");
  });

  it("huỷ dòng nợ thì số còn nợ đổi lại, huỷ lần hai báo already_void", async () => {
    await seedDebt();
    const line = (await call<DebtLine>("POST", "/v1/debts/co-lan/lines", { kind: "borrow", amount: 2_000_000 })).json.data;
    const voided = await call("POST", `/v1/debt-lines/${line.id}/void`);
    expect(voided.status).toBe(200);
    expect(voided.json.data).toMatchObject({ id: line.id, status: "void" });
    const d = await debt();
    expect(d.balance).toBe(10_000_000);
    expect(d.lines.map((l) => l.kind)).toEqual(["opening"]);
    const again = await call("POST", `/v1/debt-lines/${line.id}/void`);
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("already_void");
    expect((await call("POST", "/v1/debt-lines/999/void")).status).toBe(404);
  });

  it("trả hết thì khoản nợ được đánh dấu done", async () => {
    await seedDebt(1_000_000);
    expect((await call("POST", "/v1/debts", { id: "chu-tu", name: "Chú Tư", amount: 500_000 })).status).toBe(201);
    await pay(1_000_000);
    const data = await debts();
    expect(data.totalBalance).toBe(500_000);
    // Còn nợ lên trước, đã trả xong xuống cuối nhưng vẫn có trong danh sách.
    expect(data.debts.map((d) => [d.id, d.balance, d.done])).toEqual([
      ["chu-tu", 500_000, false],
      ["co-lan", 0, true],
    ]);
  });

  it("debt_id chỉ gắn với khoản chi: debt_spend_only", async () => {
    await seedDebt();
    for (const body of [
      { meaning: "income", amount: 100, account_id: "vcb-husband" },
      { meaning: "refund", amount: 100, category_id: "debt-payment" },
      { meaning: "lend", amount: 100 },
    ]) {
      const res = await call("POST", "/v1/transactions", { ...body, debt_id: "co-lan" });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("debt_spend_only");
    }
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
  });

  it("debt_id không có hoặc đã tắt: unknown_debt, inactive_debt", async () => {
    await seedDebt();
    expect((await call("POST", "/v1/transactions", { meaning: "spend", amount: 100, debt_id: "khong-co" })).json.error?.code).toBe("unknown_debt");
    const off = await call<Debt>("PATCH", "/v1/debts/co-lan", { active: false, name: "Cô Lan (cũ)" });
    expect(off.json.data).toMatchObject({ active: false, name: "Cô Lan (cũ)" });
    expect((await pay(100)).json.error?.code).toBe("inactive_debt");
    expect((await call("POST", "/v1/debts/co-lan/lines", { kind: "borrow", amount: 1 })).json.error?.code).toBe("inactive_debt");
    // Khoản đã tắt không còn trong tổng còn nợ.
    expect((await debts()).totalBalance).toBe(0);
  });

  it("trả nợ không chọn danh mục thì lấy danh mục debt-payment", async () => {
    await seedDebt();
    const res = await pay(300_000);
    expect(res.status).toBe(201);
    // Danh mục Trả nợ trỏ về ví Thu cho thuê; tài khoản mặc định là tiền mặt của người ghi.
    expect(res.json.data.tx).toMatchObject({ category_id: "debt-payment", counter_wallet_id: "rental-income", account_id: "cash-husband", debt_id: "co-lan" });
    // Chọn danh mục khác thì giữ nguyên lựa chọn.
    expect((await pay(100_000, { category_id: "eating-out" })).json.data.tx).toMatchObject({ category_id: "eating-out", debt_id: "co-lan" });
  });

  it("bootstrap trả các khoản nợ đang mở kèm số còn nợ", async () => {
    await seedDebt(1_000_000);
    await call("POST", "/v1/debts", { id: "chu-tu", name: "Chú Tư", amount: 3_000_000 });
    await call("POST", "/v1/debts", { id: "cu", name: "Nợ cũ", amount: 1 });
    await call("PATCH", "/v1/debts/cu", { active: false });
    await pay(250_000);
    expect((await call<{ debts: unknown }>("GET", "/v1/bootstrap")).json.data.debts).toEqual([
      { id: "chu-tu", name: "Chú Tư", balance: 3_000_000 },
      { id: "co-lan", name: "Cô Lan", balance: 750_000 },
    ]);
  });

  it("dòng nợ chỉ ghi thêm: chỉ đổi active sang void, không xoá", async () => {
    await seedDebt();
    const id = Number((raw.prepare("SELECT id FROM debt_lines").get() as { id: number }).id);
    expect(() => raw.prepare("UPDATE debt_lines SET amount = 1 WHERE id = ?").run(id)).toThrow(/debt_line_append_only/);
    expect(() => raw.prepare("UPDATE debt_lines SET note = 'sửa' WHERE id = ?").run(id)).toThrow(/debt_line_append_only/);
    expect(() => raw.prepare("DELETE FROM debt_lines WHERE id = ?").run(id)).toThrow(/debt_line_append_only/);
    raw.prepare("UPDATE debt_lines SET status = 'void' WHERE id = ?").run(id);
    expect(() => raw.prepare("UPDATE debt_lines SET status = 'active' WHERE id = ?").run(id)).toThrow(/debt_line_append_only/);
  });
});
