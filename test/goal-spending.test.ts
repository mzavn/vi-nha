// Khoản chi / chuyển ra cho mục tiêu (pocket UC-1209 bước 11, QĐ3, ADR nháp C): `transactions.goal_id` tuỳ chọn; phần đã chi
// cho G trong kỳ lương hiện tại là G đã dùng phần của mình, không làm hụt mục tiêu đứng trước. Dữ liệu giả: hộ mẫu chung tài
// khoản (test/helpers/household-shared.ts).
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { assignLog, ingestLog, type ParsedBankLog } from "../src/services/ingest";
import { asD1 } from "./helpers/d1-sqlite";
import { householdShared, SHARED_NOW, sharedTx, vnAt } from "./helpers/household-shared";

let raw: DatabaseSync;
let env: Env;

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Goal = { id: string; held: number | null; need: number | null; spent: number; short: number | null };
type Group = { accountId: string; balance: number; need: number | null; spent: number; short: number | null; extra: number | null; goalIds: string[] };
type Tx = { id: number; goal_id: string | null; account_id: string | null; status: string };

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: { Authorization: "Bearer tok", "X-Member-Id": "husband", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}
const err = (r: { status: number; json: Json<unknown> }) => [r.status, r.json.error?.code];
const reserve = async () => (await call<{ pockets: { reserve: { goals: Goal[]; groups: Group[] } } }>("GET", "/v1/snapshot")).json.data.pockets.reserve;
const goalIn = (r: { goals: Goal[] }, id: string) => r.goals.find((g) => g.id === id)!;
const savingGroup = (r: { groups: Group[] }) => r.groups.find((g) => g.accountId === "tk-tiet-kiem")!;
const spend = (account: string, amount: number, extra: Record<string, unknown> = {}) =>
  call<{ tx: Tx }>("POST", "/v1/transactions", { meaning: "spend", amount, category_id: "housing", account_id: account, ...extra });
const txCount = () => Number((raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SHARED_NOW);
  raw = householdShared();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.useRealTimers());

describe("chi cho mục tiêu (UC-1209 AC-13)", () => {
  it("UC-1209 AC-13: chi 7.500.000 gắn Nhà ở không làm hụt Học tập; huỷ → về như cũ; không gắn → mục tiêu cuối thiếu trước; chi 6.000.000 gắn Học tập khi Nhà ở giữ phần → Học tập âm; Σ held luôn = số dư", async () => {
    const paid = await spend("tk-tiet-kiem", 7_500_000, { goal_id: "nha-o", at: vnAt("2026-11-12 09:00") });
    expect(paid.status).toBe(201);
    let r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ held: 0, spent: 7_500_000, short: 0 });
    expect(goalIn(r, "hoc-tap")).toMatchObject({ held: 4_500_000, short: 1_500_000 });
    expect(savingGroup(r)).toMatchObject({ balance: 4_500_000, spent: 7_500_000, short: 1_500_000 });

    expect((await call("POST", `/v1/transactions/${paid.json.data.tx.id}/void`)).status).toBe(200);
    r = await reserve();
    expect([goalIn(r, "nha-o").held, goalIn(r, "hoc-tap").held]).toEqual([7_500_000, 4_500_000]);

    const plain = await spend("tk-tiet-kiem", 7_500_000, { at: vnAt("2026-11-12 09:00") });
    expect(plain.json.data.tx.goal_id).toBeNull();
    r = await reserve();
    expect([goalIn(r, "nha-o").held, goalIn(r, "hoc-tap").held, savingGroup(r).short]).toEqual([4_500_000, 0, 9_000_000]);
    expect((await call("POST", `/v1/transactions/${plain.json.data.tx.id}/void`)).status).toBe(200);

    expect((await spend("tk-tiet-kiem", 6_000_000, { goal_id: "hoc-tap", category_id: "work-gear", at: vnAt("2026-11-12 09:30") })).status).toBe(201);
    r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ held: 7_500_000, short: 0 });
    expect(goalIn(r, "hoc-tap")).toMatchObject({ held: -1_500_000, spent: 6_000_000, short: 1_500_000 });
    expect(goalIn(r, "nha-o").held! + goalIn(r, "hoc-tap").held!).toBe(savingGroup(r).balance);
  });
});

describe("ghi goal_id đúng luật (UC-1209 AC-14, UC-101 AC-30)", () => {
  it("UC-1209 AC-14: goal_id sai tài khoản / sai loại / mục tiêu đã tắt → 400 invalid_goal, không ghi gì; chuyển ra gắn Học tập; tài khoản một mục tiêu tự gắn; tài khoản chung bỏ trống → null; hoàn tiền trừ spent; INSERT thẳng bị trigger huỷ", async () => {
    const big = await spend("tk-tiet-kiem", 7_500_000, { goal_id: "nha-o", at: vnAt("2026-11-12 09:00") });
    raw.exec("UPDATE reserve_goals SET active = 0 WHERE id = 'hieu-hi'");
    const before = txCount();
    const bad = [
      await spend("phao", 500_000, { goal_id: "nha-o" }),
      await call("POST", "/v1/transactions", { meaning: "income", amount: 100_000, account_id: "tk-tiet-kiem", goal_id: "nha-o" }),
      await spend("tk-tiet-kiem", 100_000, { goal_id: "bao-duong-xe" }),
      await spend("tk-chung", 100_000, { goal_id: "hieu-hi" }),
    ];
    for (const r of bad) {
      expect(err(r)).toEqual([400, "invalid_goal"]);
      expect(r.json.error?.message).toBe("Mục tiêu này không thuộc tài khoản chi.");
    }
    expect(txCount()).toBe(before);

    const move = await call<{ tx: Tx }>("POST", "/v1/transactions", { meaning: "transfer", amount: 2_000_000, account_id: "tk-tiet-kiem", to_account_id: "cash-husband", goal_id: "hoc-tap" });
    expect(move.json.data.tx.goal_id).toBe("hoc-tap");
    expect(goalIn(await reserve(), "hoc-tap").spent).toBe(2_000_000);
    expect((await spend("tk-thue", 300_000)).json.data.tx.goal_id).toBe("thue");
    expect((await spend("tk-tiet-kiem", 100_000)).json.data.tx.goal_id).toBeNull();
    const refund = await call<{ tx: Tx }>("POST", "/v1/transactions", { meaning: "refund", amount: 200_000, account_id: "tk-tiet-kiem", link_id: big.json.data.tx.id });
    expect(refund.status).toBe(201);
    expect(goalIn(await reserve(), "nha-o").spent).toBe(7_300_000);

    expect(() =>
      raw
        .prepare(
          `INSERT INTO transactions (at, amount, meaning, account_id, category_id, week_key, month_key, source, goal_id)
           VALUES (?, 100000, 'spend', 'phao', 'groceries', '2026-W46', '2026-11', 'manual', 'nha-o')`,
        )
        .run(vnAt("2026-11-12 09:00")),
    ).toThrow(/invalid_goal/);
  });

  it("UC-101 AC-30: POST /v1/transactions nhận goal_id — 400 invalid_goal khi sai, tự gắn thue ở tài khoản một mục tiêu, null khi bỏ trống ở tài khoản chung; GET /v1/transactions/:id trả goal_id", async () => {
    expect(err(await spend("phao", 500_000, { goal_id: "nha-o" }))).toEqual([400, "invalid_goal"]);
    const tax = await spend("tk-thue", 300_000);
    expect(tax.json.data.tx.goal_id).toBe("thue");
    const shared = await spend("tk-tiet-kiem", 100_000);
    const view = await call<{ tx: Tx } & Tx>("GET", `/v1/transactions/${shared.json.data.tx.id}`);
    const body = view.json.data as Record<string, unknown>;
    expect("tx" in body ? (body.tx as Tx).goal_id : body.goal_id).toBeNull();
    const taxView = (await call("GET", `/v1/transactions/${tax.json.data.tx.id}`)).json.data as Record<string, unknown>;
    expect("tx" in taxView ? (taxView.tx as Tx).goal_id : taxView.goal_id).toBe("thue");
  });
});

describe("sửa khoản có goal_id (UC-102 AC-28)", () => {
  it("UC-102 AC-28: sửa số giữ goal_id → spent theo số mới; sang phao mà vẫn gửi goal_id → 400, khoản cũ giữ; sang phao không goal_id → null, spent 0; huỷ → spent 0", async () => {
    const first = await spend("tk-tiet-kiem", 7_500_000, { goal_id: "nha-o", at: vnAt("2026-11-12 09:00") });
    const edited = await call<{ tx: Tx }>("POST", `/v1/transactions/${first.json.data.tx.id}/replace`, {
      meaning: "spend", amount: 7_000_000, category_id: "housing", account_id: "tk-tiet-kiem", goal_id: "nha-o", at: vnAt("2026-11-12 09:00"),
    });
    expect(edited.status).toBe(201);
    expect(goalIn(await reserve(), "nha-o").spent).toBe(7_000_000);
    const id = edited.json.data.tx.id;
    const wrong = await call("POST", `/v1/transactions/${id}/replace`, { meaning: "spend", amount: 7_000_000, category_id: "housing", account_id: "phao", goal_id: "nha-o" });
    expect(err(wrong)).toEqual([400, "invalid_goal"]);
    expect(raw.prepare("SELECT status, goal_id FROM transactions WHERE id = ?").get(id)).toEqual({ status: "active", goal_id: "nha-o" });
    const moved = await call<{ tx: Tx }>("POST", `/v1/transactions/${id}/replace`, { meaning: "spend", amount: 7_000_000, category_id: "housing", account_id: "phao" });
    expect(moved.json.data.tx.goal_id).toBeNull();
    expect(goalIn(await reserve(), "nha-o").spent).toBe(0);
    expect((await call("POST", `/v1/transactions/${moved.json.data.tx.id}/void`)).status).toBe(200);
    expect(goalIn(await reserve(), "nha-o").spent).toBe(0);
  });
});

describe("cửa sổ là kỳ lương hiện tại (UC-1209 AC-15)", () => {
  it("UC-1209 AC-15: khoản chi kỳ trước không tính; khoản trong kỳ tính; sang kỳ mới spent về 0 và việc ② theo đã có; chưa có kỳ lưu → đầu kỳ = ngày lương danh nghĩa gần nhất", async () => {
    sharedTx(raw, { at: "2026-11-09 12:00", meaning: "spend", amount: 7_500_000, from: "tk-tiet-kiem", goal: "nha-o" });
    let r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ held: 4_500_000, spent: 0 });
    expect(goalIn(r, "hoc-tap").held).toBe(0);

    raw = householdShared();
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
    sharedTx(raw, { at: "2026-11-12 09:00", meaning: "spend", amount: 7_500_000, from: "tk-tiet-kiem", goal: "nha-o" });
    r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ held: 0, spent: 7_500_000, short: 0 });
    expect(goalIn(r, "hoc-tap").held).toBe(4_500_000);

    // Lương 20.000.000 về 10/12 mở kỳ mới (nguồn Lương chồng mở kỳ).
    vi.setSystemTime(new Date(vnAt("2026-12-10 09:00")));
    const salary = await call("POST", "/v1/transactions", { meaning: "income", amount: 20_000_000, account_id: "cash-husband", income_stream_id: "salary-husband", at: vnAt("2026-12-10 08:00") });
    expect(salary.status).toBe(201);
    r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ held: 4_500_000, spent: 0 });
    expect(goalIn(r, "hoc-tap").held).toBe(0);
    const tasks = (await call<{ payCycle: { tasks: { kind: string; goal: { id: string } | null; amount: number }[] } }>("GET", "/v1/snapshot")).json.data.payCycle.tasks.filter((t) => t.kind === "goal");
    expect(tasks.map((t) => [t.goal?.id, t.amount]).filter(([id]) => id === "nha-o" || id === "hoc-tap")).toEqual([
      ["nha-o", 3_000_000],
      ["hoc-tap", 3_000_000],
    ]);

    // Chưa có kỳ lưu: đầu kỳ = ngày lương danh nghĩa gần nhất ≤ hôm nay (10/11).
    vi.setSystemTime(SHARED_NOW);
    raw = householdShared({ cycle: false });
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
    sharedTx(raw, { at: "2026-11-09 12:00", meaning: "spend", amount: 1_000_000, from: "tk-tiet-kiem", goal: "nha-o" });
    sharedTx(raw, { at: "2026-11-10 06:00", meaning: "spend", amount: 2_000_000, from: "tk-tiet-kiem", goal: "nha-o" });
    expect(goalIn(await reserve(), "nha-o").spent).toBe(2_000_000);
  });
});

describe("gán log có goal_id (UC-305 AC-36)", () => {
  const bankLog = (over: Partial<ParsedBankLog>): ParsedBankLog => ({
    id: "1", at: vnAt("2026-11-12 09:00"), amount: 6_000_000, direction: "out", accountNo: "09990000001", content: null, refCode: null, referenceNumber: null, raw: {}, ...over,
  });
  it("UC-305 AC-36: gán log ra của tài khoản chung với goal_id Học tập; log của TK thuế không goal_id → tự gắn thue; rule tự gán log của tài khoản chung → null", async () => {
    raw.exec("UPDATE accounts SET sepay_enabled = 1, sepay_out = 1, sepay_connection_id = 'default' WHERE id IN ('tk-tiet-kiem', 'tk-thue')");
    await ingestLog(env.DB, bankLog({ id: "l1" }), "webhook", SHARED_NOW);
    await ingestLog(env.DB, bankLog({ id: "l2", accountNo: "09990000003", amount: 300_000 }), "webhook", SHARED_NOW);
    const assigned = await call<{ txs?: Tx[] }>("POST", "/v1/logs/l1/assign", { splits: [{ meaning: "spend", amount: 6_000_000, category_id: "work-gear", goal_id: "hoc-tap" }] });
    expect(assigned.status).toBe(201);
    expect(raw.prepare("SELECT goal_id FROM transactions WHERE log_id = 'l1'").get()).toEqual({ goal_id: "hoc-tap" });
    expect(goalIn(await reserve(), "hoc-tap").spent).toBe(6_000_000);
    await assignLog(env.DB, "l2", [{ meaning: "spend", amount: 300_000, category_id: "groceries" }], "husband", SHARED_NOW);
    expect(raw.prepare("SELECT goal_id FROM transactions WHERE log_id = 'l2'").get()).toEqual({ goal_id: "thue" });

    raw.exec("INSERT INTO rules (match_type, pattern, meaning, category_id, account_id) VALUES ('content', 'TIEN NHA', 'spend', 'housing', 'tk-tiet-kiem')");
    await ingestLog(env.DB, bankLog({ id: "l3", amount: 1_000_000, content: "TIEN NHA THANG 11" }), "webhook", SHARED_NOW);
    expect(raw.prepare("SELECT goal_id FROM transactions WHERE log_id = 'l3'").get()).toEqual({ goal_id: null });
  });
});
