import { describe, expect, it } from "vitest";
import { pocketsView, type PocketGoalInput, type PocketsView } from "../../../src/domain/pockets";
import { nearSpend, type SnapshotData } from "../../../src/domain/snapshot";
import type { QueuedEntry } from "../offline/queue";
import { pocketsShared } from "./household-b.fixture";
import { FROM_INTEREST, goalChoices, goalField, goalValueOf, incomeInterest, NO_GOAL, NO_OPERATING_LABEL, OPERATING_CHOICE_LABEL } from "./goal-choices";
import { applyQueue, entryToast, localNearSpend } from "./pending";
import { draftFromTx } from "./transactions";
import type { EntryBody, Snapshot, TxRow } from "./types";

const NBSP = "\u00a0";

describe("ô Cho mục tiêu (pocket UC-1209 bước 11)", () => {
  const p = pocketsShared();
  const names = (accountId: string, v: PocketsView = p) => goalChoices(accountId, v)?.choices ?? [];

  it("UC-703 AC-17: chi từ MB tiết kiệm (chung Nhà ở, Học tập) → chip 'Nhà ở · Học tập' theo thứ tự ưu tiên; chọn Học tập → gửi goal_id 'hoc-tap'; đổi sang TK thuế (một mục tiêu) → không có hàng, không gửi; về lại không chọn → không gửi", () => {
    const saving = goalChoices("tk-tiet-kiem", p);
    expect(saving).toMatchObject({ kind: "account", fromInterest: false });
    expect(saving!.choices).toEqual([
      { id: "nha-o", name: "Nhà ở" },
      { id: "hoc-tap", name: "Học tập" },
    ]);
    expect(goalField("hoc-tap", saving)).toEqual({ goal_id: "hoc-tap" });
    const tax = goalChoices("tk-thue", p);
    expect(tax).toBeNull();
    expect(goalField("hoc-tap", tax)).toEqual({});
    expect(goalField(null, saving)).toEqual({});
    expect(goalField(NO_GOAL, saving)).toEqual({});
    expect(goalChoices("phao", p)).toBeNull();
    expect(names("tk-chung").map((g) => g.name)).toEqual(["Hoá đơn", "Bảo dưỡng xe", "Hiếu hỉ"]);
    // Offline chưa có snapshot đã lưu: không có hàng.
    expect(goalChoices("tk-tiet-kiem", undefined)).toBeNull();
  });

  it("UC-715 AC-17: sửa khoản chi gắn Nhà ở → form mang goal_id 'nha-o' (chip đang chọn); đổi tài khoản sang phao → hàng chip mất, gửi không goal_id", () => {
    const tx: TxRow = { id: 9, at: "2026-11-12T02:00:00.000Z", amount: 7_500_000, meaning: "spend", status: "active", account_id: "tk-tiet-kiem", counter_account_id: null, category_id: "rent", asset_kind: null, note: null, goal_id: "nha-o" };
    const d = draftFromTx(tx);
    expect(d.goal_id).toBe("nha-o");
    expect(goalValueOf(d)).toBe("nha-o");
    expect(goalField(goalValueOf(d), goalChoices(d.account_id, p))).toEqual({ goal_id: "nha-o" });
    expect(goalChoices("phao", p)).toBeNull();
    expect(goalField(d.goal_id, goalChoices("phao", p))).toEqual({});
    expect(draftFromTx({ ...tx, goal_id: undefined }).goal_id).toBeNull();
  });
});

// Hộ có khoản gửi kỳ hạn dưới MB tiết kiệm và bốn khoản trả từ tiền chi tiêu (proposal 261112, mục Quyết định nghiệp vụ).
const goal = (id: string, name: string, accountId: string | null, o: Partial<PocketGoalInput> = {}): PocketGoalInput => ({
  id, name, accountId, target: null, targetPct: null, monthly: null, repeatMonths: null, dueDate: null, debtId: null, sort: 100, spent: 0, ...o,
});
const ACCOUNTS: SnapshotData["accounts"] = [
  { id: "tk-chi-tieu-chong", name: "MB chi tiêu chồng", pocket: "operating" },
  { id: "tk-chi-tieu-vo", name: "MB chi tiêu vợ", pocket: "operating" },
  { id: "tien-mat", name: "Tiền mặt", pocket: "operating" },
  { id: "tk-tiet-kiem", name: "MB tiết kiệm", pocket: "reserve" },
  { id: "gui-6t", name: "Gửi 6 tháng", pocket: "reserve" },
  { id: "phao", name: "Phao", pocket: "reserve" },
];
const BALANCE: Record<string, number> = { "tk-chi-tieu-chong": 7_000_000, "tk-chi-tieu-vo": 6_000_000, "tien-mat": 2_000_000, "tk-tiet-kiem": 5_000_000, "gui-6t": 100_000_000, phao: 4_000_000 };
const PARENT: Record<string, string> = { "gui-6t": "tk-tiet-kiem" };
function household({ interest = 0, operating = true }: { interest?: number; operating?: boolean } = {}): PocketsView {
  return pocketsView({
    accounts: ACCOUNTS.map((a) => ({ id: a.id, name: a.name, pocket: a.pocket, confirmed: true, balance: BALANCE[a.id]!, parentId: PARENT[a.id] ?? null })),
    goals: [
      goal("nha-o", "Nhà ở", "tk-tiet-kiem", { target: 60_000_000, sort: 10 }),
      goal("hoc-tap", "Học tập", "tk-tiet-kiem", { target: 30_000_000, sort: 20 }),
      goal("tap-luyen", "Tập luyện", "tk-tiet-kiem", { target: 10_000_000, sort: 30 }),
      ...(operating
        ? [
            goal("dien-nuoc", "Điện nước", null, { monthly: 2_000_000, repeatMonths: 1, paysFrom: "operating", spent: 1_000_000, sort: 40 }),
            goal("thuoc", "Thuốc", null, { monthly: 500_000, repeatMonths: 1, paysFrom: "operating", sort: 50 }),
            goal("thien-phuoc", "Thiện phước", null, { monthly: 1_000_000, repeatMonths: 1, paysFrom: "operating", sort: 60 }),
            goal("ve-que", "Về quê", null, { monthly: 1_000_000, repeatMonths: 1, paysFrom: "operating", sort: 70 }),
          ]
        : []),
    ],
    rewardAccountId: null,
    debts: [],
    savingsPct: 10,
    history: { since: "2026-11-10", prevSince: "2026-10-10", accounts: [] },
    operatingSpend: { cycles: [], dataStart: null },
    peaceTarget: 6,
    interest: interest ? { "tk-tiet-kiem": interest } : {},
  });
}

describe("ô Cho khoản phải trả (ADR-141) và tài khoản con (ADR-140)", () => {
  it("UC-703 AC-18: chi từ tiền mặt (Vận hành) → hàng 'Cho khoản phải trả' bốn khoản theo thứ tự + 'Không cho khoản nào', không chọn sẵn; chọn Điện nước → gửi goal_id 'dien-nuoc'; khoản chợ không mở → không gửi goal_id (không tự gắn); toast 'Chi khoảng …/ngày' tính lại bằng nearSpendView có goalRemaining", () => {
    const p = household();
    const row = goalChoices("tien-mat", p);
    expect(row).toMatchObject({ kind: "operating", label: OPERATING_CHOICE_LABEL, noneLabel: NO_OPERATING_LABEL, fromInterest: false });
    expect(row!.choices.map((c) => c.name)).toEqual(["Điện nước", "Thuốc", "Thiện phước", "Về quê"]);
    expect(goalField("dien-nuoc", row)).toEqual({ goal_id: "dien-nuoc" });
    expect(goalField(null, row)).toEqual({});
    expect(goalField(NO_GOAL, row)).toEqual({});
    // Mục tiêu để ở tài khoản không lẫn vào hàng của tài khoản Vận hành; tài khoản Vận hành không có khoản phải trả → không hàng.
    expect(goalField("nha-o", row)).toEqual({});
    expect(goalChoices("tien-mat", household({ operating: false }))).toBeNull();
    // Mục tiêu tài khoản: chi từ mẹ hoặc con của nó đều chọn được; khoản phải trả không có ở đó.
    expect(goalChoices("tk-tiet-kiem", p)!.choices.map((c) => c.id)).toEqual(["nha-o", "hoc-tap", "tap-luyen"]);
    expect(goalChoices("gui-6t", p)!.choices.map((c) => c.id)).toEqual(["nha-o", "hoc-tap", "tap-luyen"]);
    expect(goalField("dien-nuoc", goalChoices("tk-tiet-kiem", p))).toEqual({});

    // Toast offline: Vận hành 15.000.000, còn 20 ngày, R 3.500.000 → 575.000/ngày; trả Điện nước 1.000.000 không đổi số mỗi
    // ngày; khoản chợ 200.000 không gắn thì trừ vào số mỗi ngày.
    const day = "2026-11-20";
    const ns = nearSpend(p.operating, ACCOUNTS, day, 10, { cyclePayday: "2026-11-10", pendingTasks: 0, goalRemaining: p.operating.remaining });
    expect(ns).toMatchObject({ amount: 15_000_000, daysLeft: 20, goalRemaining: 3_500_000, perDay: 575_000 });
    const snap = { day, pockets: p, nearSpend: ns, payCycle: null } as unknown as Snapshot;
    const queued = (body: Pick<EntryBody, "meaning" | "amount"> & Partial<EntryBody>): QueuedEntry => ({
      clientId: `c-${body.amount}`,
      memberId: "husband",
      createdAt: `${day}T03:00:00.000Z`,
      status: "pending",
      attempts: 0,
      body: { at: `${day}T03:00:00.000Z`, client_id: `c-${body.amount}`, ...body },
    });
    const paid = applyQueue(snap, [queued({ meaning: "spend", amount: 1_000_000, category_id: "bills", account_id: "tien-mat", ...goalField("dien-nuoc", row) })]);
    expect(entryToast(localNearSpend(paid), true)).toBe(`Đã ghi, chờ đồng bộ · Vận hành còn 14.000.000${NBSP}₫ ≈ 575.000/ngày`);
    const market = applyQueue(snap, [queued({ meaning: "spend", amount: 200_000, category_id: "groceries", account_id: "tien-mat", ...goalField(null, row) })]);
    expect(entryToast(localNearSpend(market), true)).toBe(`Đã ghi, chờ đồng bộ · Vận hành còn 14.800.000${NBSP}₫ ≈ 565.000/ngày`);
  });

  it("UC-705 AC-38: thu vào khoản gửi (con) → ô 'Đây là tiền lãi' bật sẵn; thu vào mẹ → có ô, tắt sẵn; tài khoản không thuộc nhóm có mục tiêu → không ô; chuyển ra khỏi nhóm khi có tiền lãi → chip 'Từ tiền lãi' gửi from_interest, không goal_id; chuyển sang con → không chip", () => {
    const p = household({ interest: 3_000_000 });
    expect(incomeInterest("gui-6t", p)).toEqual({ preset: true });
    expect(incomeInterest("tk-tiet-kiem", p)).toEqual({ preset: false });
    expect(incomeInterest("phao", p)).toBeNull();
    expect(incomeInterest("tk-chi-tieu-chong", p)).toBeNull();
    expect(incomeInterest("gui-6t", undefined)).toBeNull();

    const out = goalChoices("tk-tiet-kiem", p, { toAccountId: "tk-chi-tieu-chong" });
    expect(out).toMatchObject({ kind: "account", fromInterest: true });
    expect(goalField(FROM_INTEREST, out)).toEqual({ from_interest: true });
    expect(goalField(FROM_INTEREST, goalChoices("gui-6t", p, { toAccountId: "phao" }))).toEqual({ from_interest: true });
    // Chuyển nội bộ mẹ ↔ con: không chip; chọn cũ không gửi.
    const inner = goalChoices("tk-tiet-kiem", p, { toAccountId: "gui-6t" });
    expect(inner!.fromInterest).toBe(false);
    expect(goalField(FROM_INTEREST, inner)).toEqual({});
    expect(goalChoices("gui-6t", p, { toAccountId: "tk-tiet-kiem" })!.fromInterest).toBe(false);
    // Tiền lãi 0 → không chip; Vận hành không bao giờ có chip.
    expect(goalChoices("tk-tiet-kiem", household(), { toAccountId: "tk-chi-tieu-chong" })!.fromInterest).toBe(false);
    expect(goalField(FROM_INTEREST, goalChoices("tien-mat", p))).toEqual({});
  });

  it("UC-705 AC-38 · UC-715 Sửa khoản: khoản cũ 'Từ tiền lãi' mở lại với chip đang chọn dù tiền lãi trong snapshot đã về 0; khoản thu cũ là tiền lãi giữ cờ", () => {
    const tx: TxRow = { id: 12, at: "2026-11-15T02:00:00.000Z", amount: 3_000_000, meaning: "transfer", status: "active", account_id: "tk-tiet-kiem", counter_account_id: "tk-chi-tieu-chong", category_id: null, asset_kind: null, note: null, goal_id: null, from_interest: true };
    const d = draftFromTx(tx);
    expect(d).toMatchObject({ from_interest: true, is_interest: false, goal_id: null });
    expect(goalValueOf(d)).toBe(FROM_INTEREST);
    const row = goalChoices(d.account_id, household(), { toAccountId: d.to_account_id, keepInterest: d.from_interest });
    expect(goalField(goalValueOf(d), row)).toEqual({ from_interest: true });
    const income = draftFromTx({ ...tx, meaning: "income", account_id: null, counter_account_id: "gui-6t", from_interest: undefined, is_interest: true });
    expect(income).toMatchObject({ is_interest: true, from_interest: false, account_id: "gui-6t" });
  });
});
