// Bỏ qua khoản chưa khớp mục tiêu (change 261117-bo-qua-khop-muc-tieu — pocket UC-1209 AC-32, AC-33).
// Dữ liệu giả (ví dụ chung của proposal, hôm nay 17/11/2026): tài khoản chung T (tk-t, số dư 2.340.000) có hai mục tiêu chưa chốt theo
// ưu tiên Tập luyện 1.500.000 (hằng tháng, cửa sổ từ 01/11) · Sửa xe 1.000.000 (một lần, tạo 20/10). Khoản từ T chưa gắn mục tiêu:
// 28/10 ăn sáng 35.000 (#101), 29/10 cà phê 45.000 (#102), 30/10 đổ xăng 80.000 (#103), 12/11 thay nhớt 600.000 (#104).
// TK con (tk-con) là con của T; V = VCB (chính) ở Vận hành; ví riêng tư của vợ ở Vận hành.
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { sharedTx, vnAt } from "./helpers/household-shared";

let raw: DatabaseSync;
let env: Env;
let tx: Record<101 | 102 | 103 | 104, number>;

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Goal = { id: string; held: number | null; spent: number };
type Group = { accountId: string; balance: number; unmatched: number; unmatchedGoalId: string | null };
type Reserve = { goals: Goal[]; groups: Group[] };
type Change = { tx_id: number; from_goal_id: string | null; to_goal_id: string | null; from_skipped?: true };
type SkipResult = { changes: Change[]; skipped: number[]; unskipped: number[] };
type Candidate = { tx_id: number; skipped: boolean };

const NOW = new Date(vnAt("2026-11-17 10:00"));
const SKIP_AT = NOW.toISOString();

function household(): DatabaseSync {
  const db = openDb();
  db.exec(`
    UPDATE reserve_goals SET active = 0;
    UPDATE accounts SET sepay_enabled = 0;
    UPDATE accounts SET opening_balance = 10000000, pocket = 'operating', pocket_confirmed = 1 WHERE id = 'vcb-husband';
    INSERT INTO accounts (id, name, kind, bank, account_no, opening_balance, pocket, pocket_confirmed) VALUES
      ('tk-t', 'T', 'bank', 'MBBank', '09990000011', 3100000, 'reserve', 1);
    INSERT INTO accounts (id, name, kind, bank, opening_balance, pocket, pocket_confirmed, parent_account_id) VALUES
      ('tk-con', 'Gửi 3 tháng', 'bank', 'MBBank', 0, 'reserve', 1, 'tk-t');
    INSERT INTO accounts (id, name, kind, owner_member_id, opening_balance, pocket, pocket_confirmed, private) VALUES
      ('vi-vo', 'Ví riêng vợ', 'cash', 'wife', 2000000, 'operating', 1, 1);
    INSERT INTO reserve_goals (id, name, account_id, target_amount, monthly_amount, repeat_months, sort, created_at) VALUES
      ('tap-luyen', 'Tập luyện', 'tk-t', 1500000, 1500000, 1, 10, '2026-10-19 17:00:00'),
      ('sua-xe', 'Sửa xe', 'tk-t', 1000000, NULL, NULL, 20, '2026-10-19 17:00:00');
  `);
  return db;
}

async function call<T = unknown>(method: string, path: string, body?: unknown, member = "husband") {
  const res = await app.request(
    `https://app.example.com${path}`,
    {
      method,
      headers: { Authorization: "Bearer tok", "X-Member-Id": member, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json<T> };
}
const err = (r: { status: number; json: Json<unknown> }) => [r.status, r.json.error?.code];
const put = (goal: string, body: { add?: number[]; remove?: number[]; skip?: number[]; unskip?: number[] }) => call<SkipResult>("PUT", `/v1/goals/${goal}/transactions`, body);
const reserve = async () => (await call<{ pockets: { reserve: Reserve } }>("GET", "/v1/snapshot")).json.data.pockets.reserve;
const groupT = (r: Reserve) => r.groups.find((g) => g.accountId === "tk-t")!;
const candidates = async (query = "") => (await call<{ items: Candidate[] }>("GET", `/v1/goals/sua-xe/candidates${query}`)).json.data.items;
const state = (...ids: number[]) =>
  raw.prepare(`SELECT id, goal_id, goal_skipped_at FROM transactions WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`).all(...ids);
const skippedAt = (id: number) => (raw.prepare("SELECT goal_skipped_at FROM transactions WHERE id = ?").get(id) as { goal_skipped_at: string | null }).goal_skipped_at;
const out = (amount: number, vn: string, from = "tk-t") => sharedTx(raw, { at: vn, meaning: "spend", amount, from });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  raw = household();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  tx = { 101: out(35_000, "2026-10-28 07:00"), 102: out(45_000, "2026-10-29 08:00"), 103: out(80_000, "2026-10-30 09:00"), 104: out(600_000, "2026-11-12 10:00") };
});
afterEach(() => vi.useRealTimers());

/** D1 thật từ chối câu có quá 100 tham số: bọc DB để test thấy ngay. */
function withD1ParamLimit(db: D1Database): D1Database {
  const wrap = (st: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(st, {
      get(target, key) {
        if (key === "bind")
          return (...args: unknown[]) => {
            if (args.length > 100) throw new Error(`too many SQL variables (${args.length})`);
            return wrap(target.bind(...args));
          };
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  return new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql: string) => wrap(target.prepare(sql));
      const v = Reflect.get(target, key);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

describe("bỏ qua qua PUT (UC-1209 AC-32)", () => {
  it("UC-1209 AC-32: bỏ qua #101–#103 rồi bỏ bỏ-qua #102; gọi lại chỉ liệt kê khoản thật sự đổi; remove + skip cùng id (Hoàn tác lần khớp); nhật ký goal.skip / goal.unskip", async () => {
    const first = await put("sua-xe", { skip: [tx[101], tx[102], tx[103]] });
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ skipped: [tx[101], tx[102], tx[103]], unskipped: [], changes: [] });
    expect(state(tx[101], tx[102], tx[103])).toEqual([tx[101], tx[102], tx[103]].map((id) => ({ id, goal_id: null, goal_skipped_at: SKIP_AT })));

    const again = await put("sua-xe", { skip: [tx[101], tx[102], tx[103]] });
    expect(again.json.data).toMatchObject({ skipped: [], unskipped: [] });

    const un = await put("sua-xe", { unskip: [tx[102]] });
    expect(un.json.data).toMatchObject({ skipped: [], unskipped: [tx[102]] });
    expect(skippedAt(tx[102])).toBeNull();
    expect((await put("sua-xe", { unskip: [tx[102]] })).json.data).toMatchObject({ skipped: [], unskipped: [] });

    expect((await put("sua-xe", { add: [tx[104]] })).status).toBe(200);
    const undo = await put("sua-xe", { remove: [tx[104]], skip: [tx[104]] });
    expect(undo.status).toBe(200);
    expect(undo.json.data).toMatchObject({ changes: [{ tx_id: tx[104], from_goal_id: "sua-xe", to_goal_id: null }], skipped: [tx[104]], unskipped: [] });
    expect(state(tx[104])).toEqual([{ id: tx[104], goal_id: null, goal_skipped_at: SKIP_AT }]);

    const audits = raw.prepare("SELECT action, target, detail FROM audit_log WHERE action IN ('goal.skip', 'goal.unskip') ORDER BY id").all() as { action: string; target: string; detail: string }[];
    expect(audits.map((a) => [a.action, a.target, JSON.parse(a.detail)])).toEqual([
      ["goal.skip", "goal:sua-xe", { tx_ids: [tx[101], tx[102], tx[103]] }],
      ["goal.unskip", "goal:sua-xe", { tx_ids: [tx[102]] }],
      ["goal.skip", "goal:sua-xe", { tx_ids: [tx[104]] }],
    ]);
  });

  it("UC-1209 AC-32: lỗi của skip — đang gắn mục tiêu, khoản thu / mua tài sản / đã huỷ / rút từ lãi, ngoài nhóm, chuyển trong nhóm → invalid_goal; ngoài cửa sổ → outside_window; mục tiêu đã chốt → goal_closed; bị giấu / không có → 404 ở cả bốn danh sách; trùng cặp hoặc > 200 id → invalid_input; có lỗi thì không khoản nào đổi", async () => {
    const inGoal = sharedTx(raw, { at: "2026-11-13 09:00", meaning: "spend", amount: 10_000, from: "tk-t", goal: "tap-luyen" });
    const income = sharedTx(raw, { at: "2026-11-13 09:10", meaning: "income", amount: 10_000, to: "tk-t" });
    const asset = (await call<{ tx: { id: number } }>("POST", "/v1/transactions", { meaning: "buy_asset", amount: 70_000, account_id: "tk-t", asset_kind: "gold" })).json.data.tx.id;
    const voided = out(20_000, "2026-11-13 09:20");
    raw.prepare("UPDATE transactions SET status = 'void' WHERE id = ?").run(voided);
    const interest = out(30_000, "2026-11-13 09:30");
    raw.prepare("UPDATE transactions SET from_interest = 1 WHERE id = ?").run(interest);
    const outside = out(40_000, "2026-11-13 09:40", "vcb-husband");
    const inGroup = sharedTx(raw, { at: "2026-11-13 09:50", meaning: "transfer", amount: 50_000, from: "tk-t", to: "tk-con" });
    for (const id of [inGoal, income, asset, voided, interest, outside, inGroup]) expect(err(await put("sua-xe", { skip: [id] }))).toEqual([400, "invalid_goal"]);
    const early = out(60_000, "2026-10-15 09:00");
    expect(err(await put("sua-xe", { skip: [early] }))).toEqual([400, "outside_window"]);
    expect(err(await put("tap-luyen", { skip: [tx[101]] }))).toEqual([400, "outside_window"]);
    const hidden = out(70_000, "2026-11-13 10:00", "vi-vo");
    for (const k of ["add", "remove", "skip", "unskip"]) {
      expect(err(await put("sua-xe", { [k]: [hidden] }))).toEqual([404, "not_found"]);
      expect(err(await put("sua-xe", { [k]: [999_999] }))).toEqual([404, "not_found"]);
    }
    expect(err(await put("sua-xe", { skip: [tx[101]], add: [tx[101]] }))).toEqual([400, "invalid_input"]);
    expect(err(await put("sua-xe", { skip: [tx[101]], unskip: [tx[101]] }))).toEqual([400, "invalid_input"]);
    expect(err(await put("sua-xe", { remove: [tx[101]], unskip: [tx[101]] }))).toEqual([400, "invalid_input"]);
    const many = Array.from({ length: 201 }, (_, i) => i + 1);
    for (const k of ["add", "remove", "skip", "unskip"]) expect(err(await put("sua-xe", { [k]: many }))).toEqual([400, "invalid_input"]);

    expect(err(await put("sua-xe", { add: [tx[104]], skip: [tx[101], income] }))).toEqual([400, "invalid_goal"]);
    expect(state(tx[101], tx[104])).toEqual([
      { id: tx[101], goal_id: null, goal_skipped_at: null },
      { id: tx[104], goal_id: null, goal_skipped_at: null },
    ]);

    expect((await put("sua-xe", { skip: [tx[102]] })).status).toBe(200);
    expect((await call("POST", "/v1/goals/sua-xe/close")).status).toBe(200);
    expect(err(await put("sua-xe", { skip: [tx[101]] }))).toEqual([409, "goal_closed"]);
    const reopenedLater = await put("sua-xe", { unskip: [tx[102]] });
    expect(reopenedLater.json.data).toMatchObject({ unskipped: [tx[102]] });
    expect((await put("tap-luyen", { skip: [tx[104]] })).status).toBe(200);
    vi.setSystemTime(new Date(vnAt("2026-12-02 10:00")));
    expect((await put("tap-luyen", { unskip: [tx[104]] })).json.data).toMatchObject({ unskipped: [tx[104]] });
  });

  it("UC-1209 AC-32: 200 id cho skip / add / remove → 200, cả 200 khoản đổi, không vượt giới hạn 100 tham số của D1", async () => {
    env = { DB: withD1ParamLimit(asD1(raw)), API_TOKEN: "tok" } as Env;
    const ids = Array.from({ length: 200 }, (_, i) => out(1_000 + i, `2026-11-${String(1 + (i % 15)).padStart(2, "0")} 09:${String(i % 60).padStart(2, "0")}`));
    const skipped = await put("sua-xe", { skip: ids });
    expect(skipped.status).toBe(200);
    expect(skipped.json.data.skipped).toHaveLength(200);
    const added = await put("sua-xe", { add: ids });
    expect(added.status).toBe(200);
    expect(added.json.data.changes).toHaveLength(200);
    expect(added.json.data.changes.every((c) => c.from_skipped === true)).toBe(true);
    const removed = await put("sua-xe", { remove: ids });
    expect(removed.status).toBe(200);
    expect(removed.json.data.changes).toHaveLength(200);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM transactions WHERE goal_id IS NULL AND goal_skipped_at IS NULL AND amount < 2000").get()).toEqual({ n: 200 });
  });
});

describe("khoản đã bỏ qua thôi nhắc (UC-1209 AC-33)", () => {
  it("UC-1209 AC-33: unmatched 4 → 1, unmatchedGoalId = mục tiêu cửa sổ sớm nhất; danh sách mặc định chỉ #104, tìm 35.000 ra #101 skipped; số dư, held, spent, báo cáo không đổi; nhóm < 2 mục tiêu chưa chốt → 0 và null", async () => {
    let r = await reserve();
    expect(groupT(r)).toMatchObject({ balance: 2_340_000, unmatched: 4, unmatchedGoalId: "sua-xe" });
    const reports = async () =>
      Promise.all(["/v1/reports/income-statement", "/v1/reports/cash-flow", "/v1/balance-sheet", "/v1/spend-by-category"].map(async (p) => (await call("GET", p)).json.data));
    const before = { reports: await reports(), goals: r.goals.map((g) => [g.id, g.held, g.spent]) };

    expect((await put("sua-xe", { skip: [tx[101], tx[102], tx[103]] })).status).toBe(200);
    r = await reserve();
    expect(groupT(r)).toMatchObject({ balance: 2_340_000, unmatched: 1, unmatchedGoalId: "sua-xe" });
    expect(r.goals.map((g) => [g.id, g.held, g.spent])).toEqual(before.goals);
    expect(await reports()).toEqual(before.reports);
    const settings = (await call<{ goal_groups: { account_id: string; unmatched: number; unmatched_goal_id: string | null }[] }>("GET", "/v1/settings")).json.data.goal_groups;
    expect(settings.find((g) => g.account_id === "tk-t")).toMatchObject({ unmatched: 1, unmatched_goal_id: "sua-xe" });

    expect((await candidates()).map((c) => [c.tx_id, c.skipped])).toEqual([[tx[104], false]]);
    expect((await candidates("?amount=35000")).map((c) => [c.tx_id, c.skipped])).toEqual([[tx[101], true]]);

    expect((await call("POST", "/v1/goals/tap-luyen/close")).status).toBe(200);
    expect(groupT(await reserve())).toMatchObject({ unmatched: 0, unmatchedGoalId: null });
  });

  it("UC-1209 AC-33: cửa sổ sớm nhất bằng nhau → unmatchedGoalId là mục tiêu đứng trước theo thứ tự ưu tiên", async () => {
    raw.exec("UPDATE reserve_goals SET monthly_amount = NULL, repeat_months = NULL WHERE id = 'tap-luyen'");
    expect(groupT(await reserve())).toMatchObject({ unmatched: 4, unmatchedGoalId: "tap-luyen" });
    raw.exec("UPDATE reserve_goals SET sort = 30 WHERE id = 'tap-luyen'");
    expect(groupT(await reserve()).unmatchedGoalId).toBe("sua-xe");
  });

  it("UC-1209 AC-33: khớp xoá bỏ qua (PUT, sửa goal_id), changes có from_skipped; Hoàn tác { remove, skip } trả về chưa gắn và đã bỏ qua; sửa tay chép cờ khi không gửi goal_id; mục tiêu đã chốt sau lần khớp → Hoàn tác 409", async () => {
    await put("sua-xe", { skip: [tx[101], tx[102], tx[103]] });
    const added = await put("sua-xe", { add: [tx[101]] });
    expect(added.json.data.changes).toEqual([{ tx_id: tx[101], from_goal_id: null, to_goal_id: "sua-xe", from_skipped: true }]);
    expect(state(tx[101])).toEqual([{ id: tx[101], goal_id: "sua-xe", goal_skipped_at: null }]);
    const undo = await put("sua-xe", { remove: [tx[101]], skip: [tx[101]] });
    expect(undo.status).toBe(200);
    expect(state(tx[101])).toEqual([{ id: tx[101], goal_id: null, goal_skipped_at: SKIP_AT }]);

    raw.prepare("UPDATE transactions SET goal_id = 'sua-xe' WHERE id = ?").run(tx[103]);
    expect(skippedAt(tx[103])).toBeNull();

    const edited = await call<{ tx: { id: number } }>("POST", `/v1/transactions/${tx[102]}/replace`, {
      meaning: "spend", amount: 45_000, category_id: "groceries", account_id: "tk-t", note: "cà phê sáng", at: vnAt("2026-10-29 08:00"),
    });
    expect(edited.status).toBe(201);
    expect(skippedAt(edited.json.data.tx.id)).toBe(SKIP_AT);
    const toGoal = await call<{ tx: { id: number } }>("POST", `/v1/transactions/${edited.json.data.tx.id}/replace`, {
      meaning: "spend", amount: 45_000, category_id: "groceries", account_id: "tk-t", note: "cà phê sáng", goal_id: "sua-xe", at: vnAt("2026-10-29 08:00"),
    });
    expect(toGoal.status).toBe(201);
    expect(state(toGoal.json.data.tx.id)).toEqual([{ id: toGoal.json.data.tx.id, goal_id: "sua-xe", goal_skipped_at: null }]);
    const plain = await call<{ tx: { id: number } }>("POST", `/v1/transactions/${tx[104]}/replace`, {
      meaning: "spend", amount: 600_000, category_id: "groceries", account_id: "tk-t", note: "thay nhớt", at: vnAt("2026-11-12 10:00"),
    });
    expect(skippedAt(plain.json.data.tx.id)).toBeNull();

    await put("sua-xe", { add: [tx[101]] });
    expect((await call("POST", "/v1/goals/sua-xe/close")).status).toBe(200);
    expect(err(await put("sua-xe", { remove: [tx[101]], skip: [tx[101]] }))).toEqual([409, "goal_closed"]);
    expect(state(tx[101])).toEqual([{ id: tx[101], goal_id: "sua-xe", goal_skipped_at: null }]);
  });
});
