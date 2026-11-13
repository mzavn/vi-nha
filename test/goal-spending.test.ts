// Khoản chi / chuyển ra cho mục tiêu (pocket UC-1209 bước 11, QĐ3, ADR nháp C): `transactions.goal_id` tuỳ chọn; phần đã chi
// cho G trong tháng VN hiện tại là G đã dùng phần của mình, không làm hụt mục tiêu đứng trước. Dữ liệu giả: hộ mẫu chung tài
// khoản (test/helpers/household-shared.ts).
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { assignLog, ingestLog, type ParsedBankLog } from "../src/services/ingest";
import { asD1 } from "./helpers/d1-sqlite";
import { householdShared, SHARED_NOW, sharedTx, vnAt } from "./helpers/household-shared";
import { householdParent, PARENT_NOW } from "./helpers/household-parent";

let raw: DatabaseSync;
let env: Env;

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Goal = { id: string; held: number | null; need: number | null; spent: number; short: number | null };
type Group = { accountId: string; balance: number; need: number | null; spent: number; short: number | null; extra: number | null; goalIds: string[]; childIds?: string[]; interest?: number };
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

describe("cửa sổ là tháng hiện tại (UC-1209 AC-15)", () => {
  it("UC-1209 AC-15: khoản chi 7.500.000 gắn Nhà ở lúc 31/10 không tính khi xem 12/11; khoản lúc 1/11 tính; sang 1/12 spent về 0", async () => {
    sharedTx(raw, { at: "2026-10-31 23:30", meaning: "spend", amount: 7_500_000, from: "tk-tiet-kiem", goal: "nha-o" });
    let r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ held: 4_500_000, spent: 0 });
    expect(goalIn(r, "hoc-tap").held).toBe(0);

    raw = householdShared();
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
    sharedTx(raw, { at: "2026-11-01 00:30", meaning: "spend", amount: 7_500_000, from: "tk-tiet-kiem", goal: "nha-o" });
    r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ held: 0, spent: 7_500_000, short: 0 });
    expect(goalIn(r, "hoc-tap").held).toBe(4_500_000);
    const settings = await call<{ goals: { id: string; spent: number }[] }>("GET", "/v1/settings");
    expect(settings.json.data.goals.find((g) => g.id === "nha-o")!.spent).toBe(7_500_000);

    vi.setSystemTime(new Date(vnAt("2026-12-01 09:00")));
    r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ held: 4_500_000, spent: 0 });
    expect(goalIn(r, "hoc-tap").held).toBe(0);
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

// Tài khoản con (khoản gửi kỳ hạn) và tiền lãi của nhóm (QĐ2, ADR-140) — hộ mẫu test/helpers/household-parent.ts.
describe("tài khoản con và tiền lãi (UC-1209 AC-16, AC-19, UC-101 AC-31, UC-102 AC-29)", () => {
  beforeEach(() => {
    vi.setSystemTime(PARENT_NOW);
    raw = householdParent();
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  });
  const held = (r: { goals: Goal[] }) => ["nha-o", "hoc-tap", "tap-luyen"].map((id) => goalIn(r, id).held);
  const post = <T = { tx: Tx }>(body: Record<string, unknown>) => call<T>("POST", "/v1/transactions", body);
  const out = (amount: number, extra: Record<string, unknown> = {}) =>
    post({ meaning: "transfer", amount, account_id: "tk-tiet-kiem", to_account_id: "tk-chi-tieu-chong", ...extra });
  /** Đáo hạn: lãi 3.000.000 vào con (`is_interest`), chuyển 103.000.000 con → mẹ, tắt con. */
  const mature = async () => {
    expect((await post({ meaning: "income", amount: 3_000_000, account_id: "gui-6-thang", is_interest: true })).status).toBe(201);
    expect((await post({ meaning: "transfer", amount: 103_000_000, account_id: "gui-6-thang", to_account_id: "tk-tiet-kiem" })).status).toBe(201);
    raw.exec("UPDATE accounts SET active = 0, deactivated_at = '2026-11-20' WHERE id = 'gui-6-thang'");
  };

  it("UC-1209 AC-16: mẹ + con gộp 105.000.000, lãi 0 → 60/30/15 triệu, childIds [con]; gắn mục tiêu vào con → 409 goal_on_child; đáo hạn (con đã tắt) → gộp 108.000.000, interest 3.000.000, Tập luyện vẫn 15.000.000; rút từ lãi → interest 0, mục tiêu không đổi; rút không chọn → interest 3.000.000, Tập luyện 12.000.000; tiền bố mẹ cho không thành lãi; lãi ở Thu nhập thụ động", async () => {
    let r = await reserve();
    expect(savingGroup(r)).toMatchObject({ balance: 105_000_000, interest: 0, childIds: ["gui-6-thang"] });
    expect(held(r)).toEqual([60_000_000, 30_000_000, 15_000_000]);
    expect(err(await call("PATCH", "/v1/settings/goals/nha-o", { account_id: "gui-6-thang" }))).toEqual([409, "goal_on_child"]);

    await mature();
    r = await reserve();
    expect(savingGroup(r)).toMatchObject({ balance: 108_000_000, interest: 3_000_000 });
    expect(held(r)).toEqual([60_000_000, 30_000_000, 15_000_000]);
    const interestTx = raw.prepare("SELECT r.report_class AS c FROM transactions t JOIN transaction_report_classes r ON r.transaction_id = t.id WHERE t.counter_account_id = 'gui-6-thang' AND t.meaning = 'income'").get();
    expect(interestTx).toEqual({ c: "passive_income" });

    const fromInterest = await out(3_000_000, { from_interest: true });
    expect(fromInterest.status).toBe(201);
    r = await reserve();
    expect(savingGroup(r)).toMatchObject({ balance: 105_000_000, interest: 0 });
    expect(held(r)).toEqual([60_000_000, 30_000_000, 15_000_000]);

    expect((await call("POST", `/v1/transactions/${fromInterest.json.data.tx.id}/void`)).status).toBe(200);
    expect((await out(3_000_000)).status).toBe(201);
    r = await reserve();
    expect(savingGroup(r)).toMatchObject({ balance: 105_000_000, interest: 3_000_000 });
    expect(held(r)).toEqual([60_000_000, 30_000_000, 12_000_000]);

    expect((await post({ meaning: "income", amount: 2_000_000, account_id: "tk-tiet-kiem", note: "bố mẹ cho" })).status).toBe(201);
    r = await reserve();
    expect(savingGroup(r).interest).toBe(3_000_000);
    expect(held(r)).toEqual([60_000_000, 30_000_000, 14_000_000]);
  });

  it("UC-1209 AC-19: từ lãi 500.000 → 2.500.000; 4.000.000 → 400 invalid_interest không ghi; 2.500.000 → 0; lãi mới 1.000.000 → 1.000.000; rút sạch → 0; nạp 2.000.000 → vẫn 0, chia cho mục tiêu; sang con mới từ lãi, từ phao, khoản thu, kèm goal_id → 400 invalid_interest", async () => {
    await mature();
    expect((await spend("tk-tiet-kiem", 500_000, { from_interest: true })).status).toBe(201);
    expect(savingGroup(await reserve()).interest).toBe(2_500_000);
    const before = txCount();
    expect(err(await out(4_000_000, { from_interest: true }))).toEqual([400, "invalid_interest"]);
    expect(txCount()).toBe(before);
    expect((await out(2_500_000, { from_interest: true })).status).toBe(201);
    expect(savingGroup(await reserve()).interest).toBe(0);
    expect((await post({ meaning: "income", amount: 1_000_000, account_id: "tk-tiet-kiem", is_interest: true })).status).toBe(201);
    expect(savingGroup(await reserve()).interest).toBe(1_000_000);

    const all = savingGroup(await reserve()).balance;
    expect(all).toBe(106_000_000);
    expect((await out(all)).status).toBe(201);
    expect(savingGroup(await reserve()).interest).toBe(0);
    expect((await post({ meaning: "transfer", amount: 2_000_000, account_id: "tk-chi-tieu-chong", to_account_id: "tk-tiet-kiem" })).status).toBe(201);
    let r = await reserve();
    expect(savingGroup(r)).toMatchObject({ balance: 2_000_000, interest: 0 });
    expect(held(r)).toEqual([2_000_000, 0, 0]);

    raw.exec("INSERT INTO accounts (id, name, kind, bank, opening_balance, pocket, pocket_confirmed, parent_account_id) VALUES ('gui-moi', 'Gửi 3 tháng', 'bank', 'MBBank', 0, 'reserve', 1, 'tk-tiet-kiem')");
    const n = txCount();
    for (const bad of [
      await post({ meaning: "transfer", amount: 1_000_000, account_id: "tk-tiet-kiem", to_account_id: "gui-moi", from_interest: true }),
      await post({ meaning: "transfer", amount: 100_000, account_id: "phao", to_account_id: "tk-chi-tieu-chong", from_interest: true }),
      await post({ meaning: "income", amount: 100_000, account_id: "tk-tiet-kiem", from_interest: true }),
      await out(100_000, { from_interest: true, goal_id: "hoc-tap" }),
    ]) {
      expect(err(bad)).toEqual([400, "invalid_interest"]);
    }
    expect(txCount()).toBe(n);
  });

  it("UC-101 AC-31: POST /v1/transactions nhận is_interest / from_interest — GET /v1/transactions/:id trả is_interest, from_interest; is_interest ở khoản chi hay vào tài khoản ngoài nhóm có mục tiêu → 400 invalid_input; khoản từ lãi không tự gắn mục tiêu duy nhất của tài khoản", async () => {
    const income = await post({ meaning: "income", amount: 3_000_000, account_id: "gui-6-thang", is_interest: true });
    const view = (await call<Record<string, unknown>>("GET", `/v1/transactions/${income.json.data.tx.id}`)).json.data;
    expect([view.is_interest, view.from_interest]).toEqual([true, false]);
    const moved = await out(1_000_000, { from_interest: true });
    const movedView = (await call<Record<string, unknown>>("GET", `/v1/transactions/${moved.json.data.tx.id}`)).json.data;
    expect([movedView.is_interest, movedView.from_interest]).toEqual([false, true]);
    expect(savingGroup(await reserve()).interest).toBe(2_000_000);
    const n = txCount();
    expect(err(await post({ meaning: "income", amount: 100_000, account_id: "phao", is_interest: true }))).toEqual([400, "invalid_input"]);
    expect(err(await spend("tk-tiet-kiem", 100_000, { is_interest: true }))).toEqual([400, "invalid_input"]);
    expect(txCount()).toBe(n);

    // Tài khoản còn một mục tiêu: khoản thường tự gắn, khoản "từ lãi" không bao giờ tự gắn (trigger chặn goal_id + from_interest).
    raw.exec("UPDATE reserve_goals SET active = 0 WHERE id IN ('hoc-tap', 'tap-luyen')");
    expect((await spend("tk-tiet-kiem", 100_000)).json.data.tx.goal_id).toBe("nha-o");
    const plain = await spend("tk-tiet-kiem", 100_000, { from_interest: true });
    expect(plain.status).toBe(201);
    expect(plain.json.data.tx.goal_id).toBeNull();
  });

  it("UC-102 AC-29: chi 500.000 từ lãi (I 2.500.000) → sửa thành 3.500.000 giữ from_interest → 400 invalid_interest (trần 3.000.000), khoản cũ giữ; sửa thành 2.000.000 → lưu, I 1.000.000", async () => {
    await mature();
    const first = await spend("tk-tiet-kiem", 500_000, { from_interest: true });
    expect(savingGroup(await reserve()).interest).toBe(2_500_000);
    const id = first.json.data.tx.id;
    const body = (amount: number) => ({ meaning: "spend", amount, category_id: "housing", account_id: "tk-tiet-kiem", from_interest: true });
    expect(err(await call("POST", `/v1/transactions/${id}/replace`, body(3_500_000)))).toEqual([400, "invalid_interest"]);
    expect(raw.prepare("SELECT status, from_interest FROM transactions WHERE id = ?").get(id)).toEqual({ status: "active", from_interest: 1 });
    const edited = await call<{ tx: Tx & { from_interest: boolean } }>("POST", `/v1/transactions/${id}/replace`, body(2_000_000));
    expect(edited.status).toBe(201);
    expect(edited.json.data.tx.from_interest).toBe(true);
    expect(savingGroup(await reserve()).interest).toBe(1_000_000);
  });
});

// Mục tiêu trả thẳng từ tiền chi tiêu (ADR-141): goal_id từ mọi tài khoản Vận hành, không tự gắn.
describe("chi gắn mục tiêu trả từ tiền chi tiêu (UC-1209 AC-18)", () => {
  beforeEach(() => {
    vi.setSystemTime(PARENT_NOW);
    raw = householdParent({ operatingGoals: true });
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  });
  const remaining = async () => (await call<{ pockets: { operating: { remaining: number } } }>("GET", "/v1/snapshot")).json.data.pockets.operating.remaining;

  it("UC-1209 AC-18: remaining 4.500.000 → 3.500.000 (Điện nước từ tk-chi-tieu-vo) → 3.200.000 (Thuốc từ tiền mặt); chi không goal_id lưu null, không tự gắn; goal_id từ tk-tiet-kiem → 400 invalid_goal; sang tháng mới → 4.500.000", async () => {
    expect(await remaining()).toBe(4_500_000);
    expect((await spend("tk-chi-tieu-vo", 1_000_000, { goal_id: "dien-nuoc" })).json.data.tx.goal_id).toBe("dien-nuoc");
    expect(await remaining()).toBe(3_500_000);
    expect((await spend("cash-husband", 300_000, { goal_id: "thuoc" })).status).toBe(201);
    expect(await remaining()).toBe(3_200_000);
    expect((await spend("tk-chi-tieu-chong", 200_000)).json.data.tx.goal_id).toBeNull();
    expect(await remaining()).toBe(3_200_000);
    expect(err(await spend("tk-tiet-kiem", 100_000, { goal_id: "thuoc" }))).toEqual([400, "invalid_goal"]);

    vi.setSystemTime(new Date(vnAt("2026-12-01 09:00")));
    expect(await remaining()).toBe(4_500_000);
  });
});

// Số tháng này và danh mục tự tính là đã trả cho khoản phải trả (ADR-143, ADR-144).
describe("số tháng này và danh mục của khoản phải trả (UC-1209 AC-22, AC-23)", () => {
  type OpGoal = { id: string; monthly: number; monthAmount: number | null; spent: number; remaining: number; note: string | null; categoryIds: string[] };
  beforeEach(() => {
    vi.setSystemTime(PARENT_NOW);
    raw = householdParent({ operatingGoals: true });
    env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  });
  const operating = async () => (await call<{ pockets: { operating: { goals: OpGoal[]; remaining: number } } }>("GET", "/v1/snapshot")).json.data.pockets.operating;
  const op = async (id: string) => (await operating()).goals.find((g) => g.id === id)!;
  const setAmount = (id: string, body: unknown) => call<{ goal: OpGoal }>("PUT", `/v1/goal-month-amounts/${id}`, body);
  const monthLogs = () =>
    (raw.prepare("SELECT target, detail FROM audit_log WHERE action = 'goal.month_amount' ORDER BY id").all() as { target: string; detail: string }[]).map((l) => [l.target, JSON.parse(l.detail)]);

  it("UC-1209 AC-23: PUT /v1/goal-month-amounts — Điện nước tháng này 500.000 'Tháng này ít', Về quê 0 → remaining 500.000 / 0, R 2.000.000, nhật ký goal.month_amount { month }; null về 2.000.000; mục tiêu tài khoản 409, số âm 400; tháng mới về số mỗi tháng; đường cũ /v1/pay-cycle/goal-amounts → 404", async () => {
    const saved = await setAmount("dien-nuoc", { amount: 500_000, note: "Tháng này ít" });
    expect(saved.status).toBe(200);
    expect(saved.json.data.goal).toMatchObject({ id: "dien-nuoc", monthly: 2_000_000, monthAmount: 500_000, remaining: 500_000, note: "Tháng này ít" });
    expect((await setAmount("ve-que", { amount: 0 })).status).toBe(200);
    let o = await operating();
    expect(o.goals.find((g) => g.id === "dien-nuoc")).toMatchObject({ monthAmount: 500_000, remaining: 500_000, note: "Tháng này ít" });
    expect(o.goals.find((g) => g.id === "ve-que")).toMatchObject({ monthAmount: 0, remaining: 0, note: null });
    expect(o.remaining).toBe(2_000_000);
    expect(monthLogs()).toEqual([
      ["goal:dien-nuoc", { month: "2026-11", amount: { from: 2_000_000, to: 500_000 } }],
      ["goal:ve-que", { month: "2026-11", amount: { from: 1_000_000, to: 0 } }],
    ]);
    expect(raw.prepare("SELECT goal_id, month_key, amount, note FROM goal_month_amounts ORDER BY goal_id").all()).toEqual([
      { goal_id: "dien-nuoc", month_key: "2026-11", amount: 500_000, note: "Tháng này ít" },
      { goal_id: "ve-que", month_key: "2026-11", amount: 0, note: null },
    ]);

    expect((await setAmount("dien-nuoc", { amount: null })).json.data.goal).toMatchObject({ monthAmount: null, remaining: 2_000_000, note: null });
    expect(err(await setAmount("nha-o", { amount: 0 }))).toEqual([409, "not_operating_goal"]);
    expect(err(await setAmount("dien-nuoc", { amount: -1 }))).toEqual([400, "invalid_input"]);
    expect(err(await setAmount("dien-nuoc", { amount: 1, note: "x".repeat(81) }))).toEqual([400, "invalid_input"]);
    expect(err(await setAmount("khong-co", { amount: 1 }))).toEqual([404, "not_found"]);
    expect((await call("PUT", "/v1/pay-cycle/goal-amounts/dien-nuoc", { amount: 1 })).status).toBe(404);

    await setAmount("dien-nuoc", { amount: 500_000 });
    vi.setSystemTime(new Date(vnAt("2026-12-01 09:00")));
    o = await operating();
    expect(o.goals.find((g) => g.id === "dien-nuoc")).toMatchObject({ monthAmount: null, remaining: 2_000_000 });
    expect(o.goals.find((g) => g.id === "ve-que")).toMatchObject({ monthAmount: null, remaining: 1_000_000 });
    expect(o.remaining).toBe(4_500_000);
  });

  it("UC-1209 AC-23: ngày 5/12, Điện nước 2.000.000/tháng danh mục Tiện ích — chi 800.000 ngày 3/12 và 600.000 ngày 28/11 → spent 800.000; PUT { 500000, 'Tháng này ít' } → monthAmount 500.000, remaining 0, nhật ký { month: '2026-12' }; ngày 1/1 về 2.000.000", async () => {
    vi.setSystemTime(new Date(vnAt("2026-12-05 10:00")));
    expect((await call("PATCH", "/v1/settings/goals/dien-nuoc", { category_ids: ["utilities"] })).status).toBe(200);
    const util = (at: string, amount: number) => spend("tk-chi-tieu-vo", amount, { category_id: "utilities", at: vnAt(at) });
    expect((await util("2026-11-28 09:00", 600_000)).status).toBe(201);
    expect((await util("2026-12-03 09:00", 800_000)).status).toBe(201);
    expect(await op("dien-nuoc")).toMatchObject({ spent: 800_000, monthAmount: null, remaining: 1_200_000 });

    const saved = await setAmount("dien-nuoc", { amount: 500_000, note: "Tháng này ít" });
    expect(saved.status).toBe(200);
    expect(saved.json.data.goal).toMatchObject({ monthAmount: 500_000, spent: 800_000, remaining: 0, note: "Tháng này ít" });
    expect(saved.json.data.goal).not.toHaveProperty("cycleAmount");
    expect(monthLogs()).toEqual([["goal:dien-nuoc", { month: "2026-12", amount: { from: 2_000_000, to: 500_000 } }]]);

    vi.setSystemTime(new Date(vnAt("2027-01-01 09:00")));
    expect(await op("dien-nuoc")).toMatchObject({ spent: 0, monthAmount: null, remaining: 2_000_000 });
  });

  it("UC-1209 AC-22: Điện nước gắn danh mục utilities — chi Vận hành không goal_id 800.000 + gắn Điện nước 500.000 − hoàn 200.000 → spent 1.100.000, remaining 900.000; chi từ Dự phòng và khoản gắn Thuốc không tính; danh mục trùng 409, mục tiêu tài khoản 400, danh mục lạ 400; GET /v1/settings có category_ids", async () => {
    const patched = await call("PATCH", "/v1/settings/goals/dien-nuoc", { category_ids: ["utilities"] });
    expect(patched.status).toBe(200);
    const util = (account: string, amount: number, extra: Record<string, unknown> = {}) => spend(account, amount, { category_id: "utilities", ...extra });
    const big = await util("tk-chi-tieu-vo", 800_000);
    expect(big.json.data.tx.goal_id).toBeNull();
    expect((await util("tk-tiet-kiem", 300_000)).status).toBe(201);
    expect((await util("tk-chi-tieu-chong", 400_000, { goal_id: "thuoc" })).status).toBe(201);
    expect((await util("cash-husband", 500_000, { goal_id: "dien-nuoc" })).status).toBe(201);
    expect((await call("POST", "/v1/transactions", { meaning: "refund", amount: 200_000, account_id: "tk-chi-tieu-vo", link_id: big.json.data.tx.id })).status).toBe(201);
    expect(await op("dien-nuoc")).toMatchObject({ spent: 1_100_000, remaining: 900_000, categoryIds: ["utilities"] });
    expect(await op("thuoc")).toMatchObject({ spent: 400_000, remaining: 100_000, categoryIds: [] });

    expect(err(await call("PATCH", "/v1/settings/goals/thuoc", { category_ids: ["utilities", "health"] }))).toEqual([409, "category_taken"]);
    expect(err(await call("PATCH", "/v1/settings/goals/nha-o", { category_ids: ["health"] }))).toEqual([400, "invalid_input"]);
    expect(err(await call("PATCH", "/v1/settings/goals/thuoc", { category_ids: ["khong-co"] }))).toEqual([400, "unknown_category"]);
    const settings = await call<{ goals: { id: string; category_ids: string[] }[] }>("GET", "/v1/settings");
    const goals = settings.json.data.goals;
    expect(goals.find((g) => g.id === "dien-nuoc")!.category_ids).toEqual(["utilities"]);
    expect(goals.find((g) => g.id === "thuoc")!.category_ids).toEqual([]);
  });
});
