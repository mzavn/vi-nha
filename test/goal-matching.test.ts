// Khớp khoản chi vào mục tiêu Dự phòng (change 261117-khop-chi-muc-tieu — pocket UC-1209 AC-24…AC-31, ingest UC-303 AC-34).
// Dữ liệu giả: tài khoản chung "TK chung" (tk-t, 3.550.000) có bốn mục tiêu theo thứ tự ưu tiên Đám cưới 1.000.000 (một lần) ·
// Tập luyện 1.500.000 (mỗi tháng) · Học tập 1.000.000 (mỗi tháng) · Sửa xe 1.000.000 (một lần), tạo 01/11/2026; "TK nhà" (tk-nha,
// 22.500.000) có Nhà ở 7.500.000 × 3 tháng, hạn 10/02/2027, tạo 10/11/2026; V = VCB (chính) ở Vận hành; TK tích luỹ ở Tích luỹ;
// ví riêng tư của vợ ở Vận hành.
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { ingestLog } from "../src/services/ingest";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { sharedTx, vnAt } from "./helpers/household-shared";

let raw: DatabaseSync;
let env: Env;

type Json<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Goal = {
  id: string;
  held: number | null;
  need: number | null;
  spent: number;
  short: number | null;
  dueDate: string | null;
  closed: boolean;
  closedAt: string | null;
  leftover: number;
  over: number;
  suggestClose: boolean;
  shortBecause: { goalId: string; amount: number }[];
  advance: number;
  advanceFrom: string[];
  pendingRefund: number;
  periodId: number | null;
};
type Group = { accountId: string; balance: number; interest: number; pending: number; free: number; unmatched: number; goalIds: string[] };
type Refund = { id: number; goalId: string; status: string; amount: number; linked: number; missing: number; code: string; memo: string; reason: string | null };
type Reserve = { goals: Goal[]; groups: Group[]; refunds: Refund[] };
type Tx = { id: number; goal_id: string | null; account_id: string | null; status: string };
type MatchResult = {
  goal: { id: string };
  changes: { tx_id: number; from_goal_id: string | null; to_goal_id: string | null }[];
  refunds_created: { id: number; amount: number; from_account_id: string; to_account_id: string }[];
  refunds_voided: number[];
};

const NOW = new Date(vnAt("2026-11-17 10:00"));
const at = (vn: string) => vi.setSystemTime(new Date(vnAt(vn)));

function household(): DatabaseSync {
  const db = openDb();
  db.exec(`
    UPDATE reserve_goals SET active = 0;
    UPDATE accounts SET sepay_enabled = 0;
    UPDATE accounts SET opening_balance = 10000000, pocket = 'operating', pocket_confirmed = 1 WHERE id = 'vcb-husband';
    INSERT INTO accounts (id, name, kind, bank, account_no, opening_balance, pocket, pocket_confirmed) VALUES
      ('tk-t', 'TK chung', 'bank', 'MBBank', '09990000011', 3550000, 'reserve', 1),
      ('tk-nha', 'TK nhà', 'bank', 'MBBank', '09990000012', 22500000, 'reserve', 1),
      ('tk-tich-luy', 'TK tích luỹ', 'bank', 'MBBank', '09990000013', 5000000, 'savings', 1);
    INSERT INTO accounts (id, name, kind, owner_member_id, opening_balance, pocket, pocket_confirmed, private) VALUES
      ('vi-vo', 'Ví riêng vợ', 'cash', 'wife', 2000000, 'operating', 1, 1);
    INSERT INTO reserve_goals (id, name, account_id, target_amount, monthly_amount, repeat_months, due_date, sort, created_at) VALUES
      ('dam-cuoi', 'Đám cưới', 'tk-t', 1000000, NULL, NULL, NULL, 10, '2026-10-31 17:00:00'),
      ('tap-luyen', 'Tập luyện', 'tk-t', 1500000, 1500000, 1, NULL, 20, '2026-10-31 17:00:00'),
      ('hoc-tap', 'Học tập', 'tk-t', 1000000, 1000000, 1, NULL, 30, '2026-10-31 17:00:00'),
      ('sua-xe', 'Sửa xe', 'tk-t', 1000000, NULL, NULL, NULL, 40, '2026-10-31 17:00:00'),
      ('nha-o', 'Nhà ở', 'tk-nha', 22500000, 7500000, 3, '2027-02-10', 50, '2026-11-09 17:00:00');
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
const reserve = async () => (await call<{ pockets: { reserve: Reserve } }>("GET", "/v1/snapshot")).json.data.pockets.reserve;
const goalIn = (r: Reserve, id: string) => r.goals.find((g) => g.id === id)!;
const groupT = (r: Reserve) => r.groups.find((g) => g.accountId === "tk-t")!;
const spend = (account: string, amount: number, vn: string, extra: Record<string, unknown> = {}) =>
  call<{ tx: Tx }>("POST", "/v1/transactions", { meaning: "spend", amount, category_id: "groceries", account_id: account, at: vnAt(vn), ...extra });
const transfer = (from: string, to: string, amount: number, vn: string, extra: Record<string, unknown> = {}) =>
  call<{ tx: Tx }>("POST", "/v1/transactions", { meaning: "transfer", amount, account_id: from, to_account_id: to, at: vnAt(vn), ...extra });
const match = (goal: string, body: { add?: number[]; remove?: number[] }) => call<MatchResult>("PUT", `/v1/goals/${goal}/transactions`, body);
const one = <T = Record<string, unknown>>(sql: string, ...args: (string | number)[]) => raw.prepare(sql).get(...args) as T;
const auditActions = () => (raw.prepare("SELECT action FROM audit_log WHERE action LIKE 'goal%' ORDER BY id").all() as { action: string }[]).map((r) => r.action);
/** Bất biến AC-25: Σ đã có + free + pending = số dư − tiền lãi của nhóm. */
const invariant = (r: Reserve, g: Group) =>
  expect(g.goalIds.reduce((s, id) => s + goalIn(r, id).held!, 0) + g.free + g.pending).toBe(g.balance - g.interest);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  raw = household();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.useRealTimers());

/** Ví dụ Q1: 10/02 nạp 7.500.000 vào TK nhà (30.000.000), 15/02 09:00 trả 22.500.000 cho Nhà ở. */
function q1() {
  sharedTx(raw, { at: "2027-02-10 08:00", meaning: "income", amount: 7_500_000, to: "tk-nha" });
  sharedTx(raw, { at: "2027-02-15 09:00", meaning: "spend", amount: 22_500_000, from: "tk-nha", goal: "nha-o" });
}

describe("cửa sổ đã chi (UC-1209 AC-24)", () => {
  it("UC-1209 AC-24: một lần cộng từ ngày tạo qua tháng; mỗi tháng về 0; lặp 3 tháng: quá hạn chưa chốt vẫn đợt hạn 10/02, trả 15/02 tính đúng đợt và gợi ý chốt", async () => {
    sharedTx(raw, { at: "2026-11-20 09:00", meaning: "spend", amount: 500_000, from: "tk-t", goal: "sua-xe" });
    sharedTx(raw, { at: "2026-12-05 09:00", meaning: "spend", amount: 400_000, from: "tk-t", goal: "sua-xe" });
    sharedTx(raw, { at: "2026-11-20 10:00", meaning: "spend", amount: 1_500_000, from: "tk-t", goal: "tap-luyen" });
    at("2026-12-06 10:00");
    let r = await reserve();
    expect(goalIn(r, "sua-xe").spent).toBe(900_000);
    expect(goalIn(r, "tap-luyen").spent).toBe(0);

    sharedTx(raw, { at: "2027-02-10 08:00", meaning: "income", amount: 7_500_000, to: "tk-nha" });
    at("2027-02-11 10:00");
    r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ dueDate: "2027-02-10", held: 30_000_000, spent: 0, short: 0, closed: false, suggestClose: false });

    sharedTx(raw, { at: "2027-02-15 09:00", meaning: "spend", amount: 22_500_000, from: "tk-nha", goal: "nha-o" });
    at("2027-02-15 10:00");
    r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ dueDate: "2027-02-10", held: 7_500_000, spent: 22_500_000, short: 0, suggestClose: true });
  });
});

describe("chốt xong và mở lại (UC-1209 AC-25)", () => {
  it("UC-1209 AC-25: Sửa xe đứng thứ hai đã chi 950.000 → chốt: phần cố định 1.000.000, dư 50.000; phần còn lại vào mục tiêu chưa chốt cuối; gọi lại vẫn 200; mở lại; mọi mục tiêu đã chốt → free; mục tiêu mỗi tháng chỉ chốt trong tháng đó; nhật ký", async () => {
    raw.exec("UPDATE reserve_goals SET sort = 15 WHERE id = 'sua-xe'");
    expect((await spend("tk-t", 950_000, "2026-11-16 09:00", { goal_id: "sua-xe" })).status).toBe(201);
    let r = await reserve();
    expect(goalIn(r, "sua-xe")).toMatchObject({ held: 50_000, spent: 950_000, closed: false, leftover: 0, suggestClose: false });
    const balance = groupT(r).balance;

    const closed = await call<{ goal: { id: string; closed: boolean } }>("POST", "/v1/goals/sua-xe/close");
    expect(closed.status).toBe(200);
    expect(closed.json.data.goal).toMatchObject({ id: "sua-xe", closed: true });
    r = await reserve();
    expect(goalIn(r, "sua-xe")).toMatchObject({ closed: true, closedAt: NOW.toISOString(), held: 50_000, leftover: 50_000, over: 0 });
    expect(goalIn(r, "hoc-tap").held).toBe(50_000);
    expect(groupT(r)).toMatchObject({ balance, free: 0, pending: 0 });
    invariant(r, groupT(r));
    expect((await call("POST", "/v1/goals/sua-xe/close")).status).toBe(200);
    expect(auditActions()).toEqual(["goal.close"]);

    expect((await call("POST", "/v1/goals/sua-xe/reopen")).status).toBe(200);
    expect((await call("POST", "/v1/goals/sua-xe/reopen")).status).toBe(200);
    expect(goalIn(await reserve(), "sua-xe")).toMatchObject({ closed: false, closedAt: null, leftover: 0 });
    expect(auditActions()).toEqual(["goal.close", "goal.reopen"]);

    sharedTx(raw, { at: "2026-11-16 10:00", meaning: "income", amount: 2_000_000, to: "tk-t" });
    for (const id of ["dam-cuoi", "sua-xe", "tap-luyen", "hoc-tap"]) expect((await call("POST", `/v1/goals/${id}/close`)).status).toBe(200);
    r = await reserve();
    expect(r.goals.filter((g) => g.id !== "nha-o").map((g) => [g.id, g.held, g.closed])).toEqual([
      ["dam-cuoi", 1_000_000, true],
      ["sua-xe", 50_000, true],
      ["tap-luyen", 1_500_000, true],
      ["hoc-tap", 1_000_000, true],
    ]);
    expect(groupT(r)).toMatchObject({ balance: 4_600_000, free: 1_050_000 });
    invariant(r, groupT(r));

    at("2026-12-02 10:00");
    r = await reserve();
    expect(r.goals.filter((g) => g.id !== "nha-o").map((g) => [g.id, g.closed])).toEqual([
      ["dam-cuoi", true],
      ["sua-xe", true],
      ["tap-luyen", false],
      ["hoc-tap", false],
    ]);
  });

  it("UC-1209 AC-25: mục tiêu lặp 3 tháng (Q1) — chốt mở đợt mới hạn 10/05, tiền còn lại thành đã có 7.500.000 / 22.500.000; mở lại về đợt cũ hạn 10/02; period_id của đợt đã qua → 200 không đổi gì (bấm hai lần); thiếu period_id → 400", async () => {
    q1();
    at("2027-02-15 10:00");
    let r = await reserve();
    expect(goalIn(r, "nha-o").periodId).toBeNull();
    expect(goalIn(r, "dam-cuoi").periodId).toBeNull();
    expect(err(await call("POST", "/v1/goals/nha-o/close", {}))).toEqual([400, "invalid_input"]);
    expect((await call("POST", "/v1/goals/nha-o/close", { period_id: null })).status).toBe(200);
    r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ dueDate: "2027-05-10", held: 7_500_000, spent: 0, need: 22_500_000, short: 15_000_000, closed: false, suggestClose: false });
    expect(one("SELECT due_date FROM reserve_goals WHERE id = 'nha-o'")).toEqual({ due_date: "2027-05-10" });
    const period = goalIn(r, "nha-o").periodId;
    expect(period).toEqual(expect.any(Number));

    const again = await call<{ goal: { period_id: number; due_date: string } }>("POST", "/v1/goals/nha-o/close", { period_id: null });
    expect([again.status, again.json.data.goal.period_id, again.json.data.goal.due_date]).toEqual([200, period, "2027-05-10"]);
    expect(auditActions()).toEqual(["goal.close"]);

    expect((await call("POST", "/v1/goals/nha-o/reopen", { period_id: period! + 1 })).status).toBe(200);
    expect(goalIn(await reserve(), "nha-o").dueDate).toBe("2027-05-10");
    expect((await call("POST", "/v1/goals/nha-o/reopen", { period_id: period })).status).toBe(200);
    r = await reserve();
    expect(goalIn(r, "nha-o")).toMatchObject({ dueDate: "2027-02-10", spent: 22_500_000, suggestClose: true });
    expect((await call("POST", "/v1/goals/nha-o/reopen", { period_id: period })).status).toBe(200);
    expect(goalIn(await reserve(), "nha-o").dueDate).toBe("2027-02-10");
    expect(auditActions()).toEqual(["goal.close", "goal.reopen"]);
  });
});

describe("gợi ý chốt và chi vượt (UC-1209 AC-26)", () => {
  it("UC-1209 AC-26: Đám cưới chi 1.200.000 từ T → gợi ý chốt; Học tập thiếu 150.000; Sửa xe thiếu 1.000.000 vì Đám cưới chi vượt 200.000; nhóm còn dư → không shortBecause", async () => {
    expect((await spend("tk-t", 1_200_000, "2026-11-05 09:00", { goal_id: "dam-cuoi" })).status).toBe(201);
    let r = await reserve();
    expect(groupT(r).balance).toBe(2_350_000);
    expect(goalIn(r, "dam-cuoi")).toMatchObject({ held: 0, spent: 1_200_000, over: 200_000, suggestClose: true, shortBecause: [] });
    expect(goalIn(r, "tap-luyen")).toMatchObject({ short: 0, suggestClose: false, shortBecause: [] });
    expect(goalIn(r, "hoc-tap")).toMatchObject({ short: 150_000, shortBecause: [] });
    expect(goalIn(r, "sua-xe")).toMatchObject({ short: 1_000_000, shortBecause: [{ goalId: "dam-cuoi", amount: 200_000 }] });

    sharedTx(raw, { at: "2026-11-06 09:00", meaning: "income", amount: 5_000_000, to: "tk-t" });
    r = await reserve();
    expect(r.goals.flatMap((g) => g.shortBecause)).toEqual([]);
  });
});

describe("khớp nhiều khoản (UC-1209 AC-27)", () => {
  const bankOut = async (id: string, amount: number, vn: string) => {
    raw.exec("UPDATE accounts SET sepay_enabled = 1, sepay_out = 1, sepay_connection_id = 'default' WHERE id = 'tk-t'");
    await ingestLog(env.DB, { id, at: vnAt(vn), amount, direction: "out", accountNo: "09990000011", content: `CHI ${id}`, refCode: null, referenceNumber: null, raw: {} }, "webhook", NOW);
    const assigned = await call("POST", `/v1/logs/${id}/assign`, { splits: [{ meaning: "spend", amount, category_id: "groceries" }] });
    expect(assigned.status).toBe(201);
    raw.exec("UPDATE accounts SET sepay_enabled = 0, sepay_out = 0 WHERE id = 'tk-t'");
    return one<{ id: number }>("SELECT id FROM transactions WHERE log_id = ? AND status = 'active'", id).id;
  };

  it("UC-1209 AC-27: hai khoản ngân hàng + một khoản tay chưa khớp → PUT add ghi goal_id tại chỗ, changes để hoàn tác; remove; khoản ở mục tiêu khác chuyển sang; lỗi goal_closed / invalid_goal / outside_window / not_found; nhật ký", async () => {
    const b1 = await bankOut("L1", 400_000, "2026-11-14 09:00");
    const b2 = await bankOut("L2", 300_000, "2026-11-15 09:00");
    const manual = (await spend("tk-t", 200_000, "2026-11-16 09:00")).json.data.tx.id;
    expect(raw.prepare("SELECT goal_id FROM transactions WHERE id IN (?, ?, ?)").all(b1, b2, manual)).toEqual([{ goal_id: null }, { goal_id: null }, { goal_id: null }]);

    const candidates = await call<{ items: { tx_id: number; amount: number; own: boolean; goal_id: string | null }[] }>("GET", "/v1/goals/sua-xe/candidates");
    expect(candidates.json.data.items.map((i) => [i.tx_id, i.own, i.goal_id])).toEqual([
      [manual, true, null],
      [b2, true, null],
      [b1, true, null],
    ]);

    const added = await match("sua-xe", { add: [b1, b2, manual] });
    expect(added.status).toBe(200);
    expect(added.json.data.changes).toEqual([b1, b2, manual].map((tx_id) => ({ tx_id, from_goal_id: null, to_goal_id: "sua-xe" })));
    expect(added.json.data.refunds_created).toEqual([]);
    expect(raw.prepare("SELECT id, status, goal_id FROM transactions WHERE id IN (?, ?, ?) ORDER BY id").all(b1, b2, manual)).toEqual(
      [b1, b2, manual].map((id) => ({ id, status: "active", goal_id: "sua-xe" })),
    );
    expect(goalIn(await reserve(), "sua-xe").spent).toBe(900_000);
    const listed = await call<{ items: { tx_id: number; kind: string; refund_id: number | null }[] }>("GET", "/v1/goals/sua-xe/transactions");
    expect(listed.json.data.items.map((i) => [i.tx_id, i.kind, i.refund_id])).toEqual([
      [manual, "own", null],
      [b2, "own", null],
      [b1, "own", null],
    ]);

    const removed = await match("sua-xe", { remove: [manual] });
    expect(removed.json.data.changes).toEqual([{ tx_id: manual, from_goal_id: "sua-xe", to_goal_id: null }]);
    expect(goalIn(await reserve(), "sua-xe").spent).toBe(700_000);

    const other = (await spend("tk-t", 100_000, "2026-11-16 10:00", { goal_id: "hoc-tap" })).json.data.tx.id;
    expect((await match("sua-xe", { add: [other] })).json.data.changes).toEqual([{ tx_id: other, from_goal_id: "hoc-tap", to_goal_id: "sua-xe" }]);

    expect((await call("POST", "/v1/goals/dam-cuoi/close")).status).toBe(200);
    expect(err(await match("dam-cuoi", { add: [manual] }))).toEqual([409, "goal_closed"]);
    const income = sharedTx(raw, { at: "2026-11-16 11:00", meaning: "income", amount: 50_000, to: "tk-t" });
    const voided = (await spend("tk-t", 60_000, "2026-11-16 11:30")).json.data.tx.id;
    expect((await call("POST", `/v1/transactions/${voided}/void`)).status).toBe(200);
    const asset = (await call<{ tx: Tx }>("POST", "/v1/transactions", { meaning: "buy_asset", amount: 70_000, account_id: "tk-t", asset_kind: "gold" })).json.data.tx.id;
    for (const id of [income, voided, asset]) expect(err(await match("sua-xe", { add: [id] }))).toEqual([400, "invalid_goal"]);
    const early = sharedTx(raw, { at: "2026-10-20 09:00", meaning: "spend", amount: 80_000, from: "tk-t" });
    expect(err(await match("sua-xe", { add: [early] }))).toEqual([400, "outside_window"]);
    const hidden = sharedTx(raw, { at: "2026-11-16 12:00", meaning: "spend", amount: 90_000, from: "vi-vo" });
    expect(err(await match("sua-xe", { add: [hidden] }))).toEqual([404, "not_found"]);
    expect(one("SELECT goal_id FROM transactions WHERE id = ?", manual)).toEqual({ goal_id: null });
    expect(auditActions()).toEqual(["goal.match", "goal.unmatch", "goal.match", "goal.close"]);
  });

  it("UC-1209 AC-27: unmatched — tài khoản từ hai mục tiêu chưa chốt đếm khoản chi chưa khớp trong cửa sổ sớm nhất (bỏ khoản bị giấu); khớp xong về 0; nhóm còn một mục tiêu chưa chốt → 0", async () => {
    await spend("tk-t", 400_000, "2026-11-14 09:00");
    const b = (await spend("tk-t", 300_000, "2026-11-15 09:00")).json.data.tx.id;
    sharedTx(raw, { at: "2026-10-20 09:00", meaning: "spend", amount: 80_000, from: "tk-t" });
    sharedTx(raw, { at: "2026-11-15 09:30", meaning: "transfer", amount: 50_000, from: "tk-t", to: "vcb-husband" });
    expect(groupT(await reserve()).unmatched).toBe(3);
    const a = one<{ id: number }>("SELECT id FROM transactions WHERE amount = 400000").id;
    const t = one<{ id: number }>("SELECT id FROM transactions WHERE amount = 50000").id;
    await match("sua-xe", { add: [a, b, t] });
    expect(groupT(await reserve()).unmatched).toBe(0);
    await spend("tk-t", 20_000, "2026-11-16 09:00");
    for (const id of ["dam-cuoi", "tap-luyen", "hoc-tap"]) await call("POST", `/v1/goals/${id}/close`);
    expect(groupT(await reserve()).unmatched).toBe(0);
  });
});

describe("khoản từ tài khoản khác tạo việc chuyển về (UC-1209 AC-28)", () => {
  it("UC-1209 AC-28: khoản 1.200.000 từ V khớp Đám cưới → việc chuyển về T → V 1.000.000; đã chi 1.000.000, pending trừ trước khi chia, mục tiêu khác không đổi; khớp lại không tạo việc thứ hai; ghi tay 950.000 có goal_id → việc 950.000", async () => {
    const before = await reserve();
    const id = (await spend("vcb-husband", 1_200_000, "2026-11-02 09:00")).json.data.tx.id;
    const added = await match("dam-cuoi", { add: [id] });
    expect(added.status).toBe(200);
    expect(added.json.data.changes).toEqual([{ tx_id: id, from_goal_id: null, to_goal_id: "dam-cuoi" }]);
    expect(added.json.data.refunds_created).toEqual([{ id: expect.any(Number), amount: 1_000_000, from_account_id: "tk-t", to_account_id: "vcb-husband" }]);
    const refundId = added.json.data.refunds_created[0]!.id;

    const r = await reserve();
    expect(goalIn(r, "dam-cuoi")).toMatchObject({ held: 0, spent: 1_000_000, over: 0, advance: 1_200_000, advanceFrom: ["VCB (chính)"], pendingRefund: 1_000_000, suggestClose: true });
    expect(groupT(r)).toMatchObject({ balance: 3_550_000, pending: 1_000_000 });
    for (const g of ["tap-luyen", "hoc-tap", "sua-xe"]) expect(goalIn(r, g).held).toBe(goalIn(before, g).held);
    invariant(r, groupT(r));
    const refund = r.refunds.find((x) => x.id === refundId)!;
    expect(refund).toMatchObject({ goalId: "dam-cuoi", status: "open", amount: 1_000_000, linked: 0, missing: 1_000_000, reason: null });
    expect(refund.memo).toBe(`CV ${refund.code} T11`);
    expect(refund.code).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);

    expect((await match("dam-cuoi", { add: [id] })).json.data).toMatchObject({ changes: [], refunds_created: [] });
    expect(one("SELECT COUNT(*) AS n FROM goal_refunds WHERE spend_tx_id = ? AND status <> 'void'", id)).toEqual({ n: 1 });
    const listed = await call<{ items: { tx_id: number; kind: string; refund_id: number | null; account_name: string }[] }>("GET", "/v1/goals/dam-cuoi/transactions");
    expect(listed.json.data.items).toEqual([expect.objectContaining({ tx_id: id, kind: "other", refund_id: refundId, account_name: "VCB (chính)" })]);

    const direct = await spend("vcb-husband", 950_000, "2026-11-03 09:00", { goal_id: "sua-xe" });
    expect(direct.status).toBe(201);
    expect(one("SELECT goal_id, from_account_id, to_account_id, amount, status FROM goal_refunds WHERE spend_tx_id = ?", direct.json.data.tx.id)).toEqual({
      goal_id: "sua-xe", from_account_id: "tk-t", to_account_id: "vcb-husband", amount: 950_000, status: "open",
    });
    expect((await call("POST", `/v1/transactions/${direct.json.data.tx.id}/void`)).status).toBe(200);
    expect(one("SELECT status FROM goal_refunds WHERE spend_tx_id = ?", direct.json.data.tx.id)).toEqual({ status: "void" });
    expect(err(await transfer("vcb-husband", "cash-husband", 100_000, "2026-11-03 10:00", { goal_id: "sua-xe" }))).toEqual([400, "invalid_goal"]);
  });
});

describe("việc chuyển về tự xong, đã chuyển, bỏ qua, gỡ (UC-1209 AC-29)", () => {
  it("UC-1209 AC-29: chuyển 600.000 rồi 400.000 từ T sang đúng tài khoản đã trả → cộng dồn tới đủ, ghép trước nhắc ①, phần đã ghép không tính vào đã chi; Đã chuyển; Bỏ qua cần lý do; mở lại; gỡ khớp huỷ việc, khớp lại có việc mới", async () => {
    const income = sharedTx(raw, { at: "2026-11-01 08:00", meaning: "income", amount: 20_000_000, to: "vcb-husband" });
    raw.prepare("INSERT INTO month_tasks (kind, month_key, income_tx_id, to_pocket, amount, created_at, updated_at) VALUES ('savings', '2026-11', ?, 'savings', 2000000, ?, ?)").run(income, vnAt("2026-11-01 08:00"), vnAt("2026-11-01 08:00"));
    const taskLinked = () => one<{ n: number }>("SELECT COALESCE(SUM(amount), 0) AS n FROM month_task_tx").n;

    const s1 = (await spend("tk-tich-luy", 1_000_000, "2026-11-03 09:00")).json.data.tx.id;
    const r1 = (await match("dam-cuoi", { add: [s1] })).json.data.refunds_created[0]!;
    expect(r1).toMatchObject({ amount: 1_000_000, from_account_id: "tk-t", to_account_id: "tk-tich-luy" });

    expect((await transfer("tk-t", "tk-tich-luy", 600_000, "2026-11-10 09:00")).status).toBe(201);
    let r = await reserve();
    expect(r.refunds.find((x) => x.id === r1.id)).toMatchObject({ status: "open", linked: 600_000, missing: 400_000 });
    expect(goalIn(r, "dam-cuoi").pendingRefund).toBe(400_000);
    expect(taskLinked()).toBe(0);

    expect((await transfer("tk-t", "tk-tich-luy", 400_000, "2026-11-11 09:00", { goal_id: "dam-cuoi" })).status).toBe(201);
    r = await reserve();
    expect(r.refunds.find((x) => x.id === r1.id)).toMatchObject({ status: "done", linked: 1_000_000, missing: 0 });
    expect(goalIn(r, "dam-cuoi")).toMatchObject({ spent: 1_000_000, pendingRefund: 0 });
    expect(groupT(r).pending).toBe(0);
    expect(taskLinked()).toBe(0);
    invariant(r, groupT(r));

    const s2 = (await spend("vcb-husband", 500_000, "2026-11-12 09:00")).json.data.tx.id;
    const r2 = (await match("sua-xe", { add: [s2] })).json.data.refunds_created[0]!;
    const done = await call<{ refund: { id: number; status: string } }>("POST", `/v1/goal-refunds/${r2.id}/done`);
    expect([done.status, done.json.data.refund.status]).toEqual([200, "done"]);
    expect(goalIn(await reserve(), "sua-xe").pendingRefund).toBe(0);
    await transfer("tk-t", "vcb-husband", 500_000, "2026-11-13 09:00");
    expect((await reserve()).refunds.find((x) => x.id === r2.id)).toMatchObject({ status: "done", linked: 500_000 });

    const s3 = (await spend("vcb-husband", 300_000, "2026-11-14 09:00")).json.data.tx.id;
    const r3 = (await match("hoc-tap", { add: [s3] })).json.data.refunds_created[0]!;
    expect(err(await call("POST", `/v1/goal-refunds/${r3.id}/skip`, {}))).toEqual([400, "reason_required"]);
    const skipped = await call<{ refund: { status: string; reason: string } }>("POST", `/v1/goal-refunds/${r3.id}/skip`, { reason: "Trả hộ, không đòi" });
    expect(skipped.json.data.refund).toMatchObject({ status: "skipped", reason: "Trả hộ, không đòi" });
    r = await reserve();
    expect(goalIn(r, "hoc-tap")).toMatchObject({ spent: 300_000, pendingRefund: 0 });
    expect(groupT(r).pending).toBe(0);
    expect((await call<{ refund: { status: string } }>("POST", `/v1/goal-refunds/${r3.id}/reopen`)).json.data.refund.status).toBe("open");
    expect(goalIn(await reserve(), "hoc-tap").pendingRefund).toBe(300_000);

    const unmatched = await match("hoc-tap", { remove: [s3] });
    expect(unmatched.json.data.refunds_voided).toEqual([r3.id]);
    expect(one("SELECT status FROM goal_refunds WHERE id = ?", r3.id)).toEqual({ status: "void" });
    r = await reserve();
    expect(r.refunds.map((x) => x.id)).not.toContain(r3.id);
    expect(goalIn(r, "hoc-tap")).toMatchObject({ spent: 0, pendingRefund: 0 });
    const again = await match("hoc-tap", { add: [s3] });
    expect(again.json.data.refunds_created).toEqual([expect.objectContaining({ amount: 300_000 })]);
    expect(auditActions()).toEqual([
      "goal.match", "goal.match", "goal_refund.done", "goal.match", "goal_refund.skip", "goal_refund.reopen", "goal.unmatch", "goal.match",
    ]);
  });
});

describe("mục tiêu đã chốt không nhận khoản mới (UC-1209 AC-30)", () => {
  it("UC-1209 AC-30: T còn một mục tiêu chưa chốt → khoản không goal_id tự gắn Học tập; gửi Sửa xe đã chốt → 409 goal_closed ở nhập tay, sửa, Gán, kiểu B; INSERT thẳng bị trigger huỷ", async () => {
    for (const id of ["dam-cuoi", "tap-luyen", "sua-xe"]) expect((await call("POST", `/v1/goals/${id}/close`)).status).toBe(200);
    const auto = await spend("tk-t", 100_000, "2026-11-16 09:00");
    expect(auto.json.data.tx.goal_id).toBe("hoc-tap");
    expect(err(await spend("tk-t", 100_000, "2026-11-16 09:10", { goal_id: "sua-xe" }))).toEqual([409, "goal_closed"]);
    expect(err(await spend("vcb-husband", 100_000, "2026-11-16 09:20", { goal_id: "sua-xe" }))).toEqual([409, "goal_closed"]);
    const replaced = await call("POST", `/v1/transactions/${auto.json.data.tx.id}/replace`, {
      meaning: "spend", amount: 100_000, category_id: "groceries", account_id: "tk-t", goal_id: "sua-xe", at: vnAt("2026-11-16 09:00"),
    });
    expect(err(replaced)).toEqual([409, "goal_closed"]);

    raw.exec("UPDATE accounts SET sepay_enabled = 1, sepay_out = 1, sepay_connection_id = 'default' WHERE id = 'tk-t'");
    await ingestLog(env.DB, { id: "L9", at: vnAt("2026-11-16 10:00"), amount: 200_000, direction: "out", accountNo: "09990000011", content: "SUA XE", refCode: null, referenceNumber: null, raw: {} }, "webhook", NOW);
    const assigned = await call("POST", "/v1/logs/L9/assign", { splits: [{ meaning: "spend", amount: 200_000, category_id: "groceries", goal_id: "sua-xe" }] });
    expect(err(assigned)).toEqual([409, "goal_closed"]);

    expect(() => sharedTx(raw, { at: "2026-11-16 11:00", meaning: "spend", amount: 10_000, from: "tk-t", goal: "sua-xe" })).toThrow(/goal_closed/);
  });
});

describe("báo cáo không đổi (UC-1209 AC-31)", () => {
  it("UC-1209 AC-31: khớp kiểu A và kiểu B không đổi Thu chi, Dòng tiền, Cân đối, Chi tiêu theo danh mục", async () => {
    const a = (await spend("tk-t", 300_000, "2026-11-10 09:00")).json.data.tx.id;
    const b = (await spend("vcb-husband", 1_200_000, "2026-11-02 09:00")).json.data.tx.id;
    const reports = async () =>
      Promise.all(["/v1/reports/income-statement", "/v1/reports/cash-flow", "/v1/balance-sheet", "/v1/spend-by-category"].map(async (p) => (await call("GET", p)).json.data));
    const before = await reports();
    expect((await match("sua-xe", { add: [a] })).status).toBe(200);
    expect((await match("dam-cuoi", { add: [b] })).json.data.refunds_created).toHaveLength(1);
    expect(await reports()).toEqual(before);
  });
});

describe("mã CV trong nội dung chuyển khoản (UC-303 AC-34)", () => {
  it("UC-303 AC-34: log ra của T có 'CV {mã} T11' khớp việc chuyển về đang mở → chuyển khoản T → V ghép theo mã, việc xong; sai tháng → luồng thường (log chờ)", async () => {
    const s = (await spend("vcb-husband", 1_000_000, "2026-11-02 09:00")).json.data.tx.id;
    const refund = (await match("dam-cuoi", { add: [s] })).json.data.refunds_created[0]!;
    const code = one<{ code: string }>("SELECT code FROM goal_refunds WHERE id = ?", refund.id).code;
    raw.exec("UPDATE accounts SET sepay_enabled = 1, sepay_out = 1, sepay_connection_id = 'default' WHERE id = 'tk-t'");
    const log = (id: string, content: string) =>
      ingestLog(env.DB, { id, at: vnAt("2026-11-16 09:00"), amount: 1_000_000, direction: "out", accountNo: "09990000011", content, refCode: null, referenceNumber: null, raw: {} }, "webhook", NOW);

    await log("C0", `MBVCB.99.CV ${code} T10.CT`);
    expect(one("SELECT status FROM bank_logs WHERE id = 'C0'")).toEqual({ status: "pending" });

    await log("C1", `MBVCB.100.cv${code.toLowerCase()}t11.CT tu 09990000011`);
    const tx = one<{ id: number; meaning: string; fromId: string; toId: string }>("SELECT id, meaning, account_id AS fromId, counter_account_id AS toId FROM transactions WHERE log_id = 'C1'");
    expect(tx).toMatchObject({ meaning: "transfer", fromId: "tk-t", toId: "vcb-husband" });
    expect(one("SELECT tx_id, amount, by_code FROM goal_refund_tx WHERE refund_id = ?", refund.id)).toEqual({ tx_id: tx.id, amount: 1_000_000, by_code: 1 });
    expect((await reserve()).refunds.find((x) => x.id === refund.id)).toMatchObject({ status: "done", linked: 1_000_000 });
  });
});
