import { afterEach, describe, expect, it } from "vitest";
import {
  candidateQuery,
  candidateTag,
  closeBody,
  closeToast,
  goalNameOf,
  goalPickerGroups,
  matchFooter,
  matchedRowSub,
  matchToast,
  needReviewGoalRows,
  NO_GOAL_PICK,
  refundQr,
  refundToast,
  reopenToast,
  undoRequests,
  unmatchToast,
} from "./goal-match";
import { setAmountsHidden } from "./money";
import type { GoalCandidate, GoalMatchResult, Snapshot } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => `${s}${NBSP}₫`;

afterEach(() => setAmountsHidden(false));

type Pockets = Snapshot["pockets"];
type Goal = Pockets["reserve"]["goals"][number];
type Refund = Pockets["reserve"]["refunds"][number];

/**
 * Ví dụ của proposal: tài khoản chung T (VCB chung) — Đám cưới 1.000.000 (một lần) · Tập luyện 1.500.000 (mỗi tháng) · Học tập
 * 1.000.000 (mỗi tháng) · Sửa xe 1.000.000 (một lần); MB tiết kiệm riêng Nhà ở; tài khoản chi tiêu V ở Vận hành.
 */
const goal = (id: string, name: string, accountId: string, over: Partial<Goal> = {}): Goal =>
  ({
    id, name, accountId, held: 0, need: 1_000_000, spent: 0, short: 0, target: 1_000_000, targetPct: null, monthly: null, repeatMonths: null, dueDate: null, debtId: null,
    closed: false, closedAt: null, leftover: 0, over: 0, suggestClose: false, shortBecause: [], advance: 0, advanceFrom: [], pendingRefund: 0,
    ...over,
  }) as Goal;

const refund = (over: Partial<Refund> = {}): Refund =>
  ({
    id: 7, goalId: "dam-cuoi", goalName: "Đám cưới", spendTxId: 501, fromAccountId: "t", toAccountId: "v", amount: 1_000_000, linked: 0, missing: 1_000_000,
    status: "open", reason: null, code: "7K2Q", memo: "CV 7K2Q T11",
    qr: { accountId: "v", name: "V chi tiêu", bank: "Vietcombank", accountNo: "0011004455667", subAccount: null }, hidden: false, createdAt: "2026-11-02T03:00:00Z",
    ...over,
  }) as Refund;

function pockets(o: { goals?: Goal[]; refunds?: Refund[]; unmatched?: number } = {}): Pockets {
  const goals = o.goals ?? [
    goal("dam-cuoi", "Đám cưới", "t"),
    goal("tap-luyen", "Tập luyện", "t", { need: 1_500_000, target: 1_500_000, monthly: 1_500_000, repeatMonths: 1 }),
    goal("hoc-tap", "Học tập", "t", { monthly: 1_000_000, repeatMonths: 1 }),
    goal("sua-xe", "Sửa xe", "t"),
    goal("nha-o", "Nhà ở", "mb", { need: 22_500_000, target: 22_500_000, monthly: 7_500_000, repeatMonths: 3, dueDate: "2027-02-10" }),
  ];
  const line = (id: string, name: string, goalIds: string[] = []) => ({ id, name, balance: 0, goalIds, parentId: null });
  return {
    reserve: {
      total: 0,
      accounts: [line("t", "VCB chung", ["dam-cuoi", "tap-luyen", "hoc-tap", "sua-xe"]), line("mb", "MB tiết kiệm", ["nha-o"]), line("phao", "Phao")],
      goals,
      groups: [
        { accountId: "t", name: "VCB chung", balance: 3_550_000, need: 4_500_000, spent: 0, short: 950_000, extra: 0, goalIds: ["dam-cuoi", "tap-luyen", "hoc-tap", "sua-xe"], childIds: [], interest: 0, pending: 0, free: 0, unmatched: o.unmatched ?? 2 },
        { accountId: "mb", name: "MB tiết kiệm", balance: 22_500_000, need: 22_500_000, spent: 0, short: 0, extra: 0, goalIds: ["nha-o"], childIds: [], interest: 0, pending: 0, free: 0, unmatched: 0 },
      ],
      refunds: o.refunds ?? [],
      peace: 0,
      reward: null,
    },
    operating: { total: 0, accounts: [line("v", "V chi tiêu")], goals: [], remaining: 0 },
    savings: { total: 0, accounts: [line("tl", "Tích luỹ")], change: { since: "2026-11-01", amount: 0, prevSince: "2026-10-01", prevAmount: 0 } },
    outside: { total: 0, accounts: [] },
    unconfirmed: 0,
    savingsPct: 10,
    shortDebt: { total: 0, count: 0, items: [] },
  } as unknown as Pockets;
}

const names = (id: string) => ({ t: "VCB chung", v: "V chi tiêu", mb: "MB tiết kiệm" })[id] ?? id;

describe("bộ chọn 'Cho mục tiêu' (pwa UC-715 AC-21, ingest UC-305 AC-39)", () => {
  it("UC-715 AC-21: khoản từ V → mục tiêu gom theo tài khoản theo thứ tự nhóm; khoản từ MB → nhóm MB lên đầu; mục tiêu đã chốt không có", () => {
    const p = pockets({ goals: [...pockets().reserve.goals.map((g) => (g.id === "sua-xe" ? { ...g, closed: true } : g))] });
    expect(goalPickerGroups(p, "v", "")).toEqual([
      { accountId: "t", name: "VCB chung", own: false, goals: [{ id: "dam-cuoi", name: "Đám cưới" }, { id: "tap-luyen", name: "Tập luyện" }, { id: "hoc-tap", name: "Học tập" }] },
      { accountId: "mb", name: "MB tiết kiệm", own: false, goals: [{ id: "nha-o", name: "Nhà ở" }] },
    ]);
    expect(goalPickerGroups(p, "mb", "").map((g) => [g.accountId, g.own])).toEqual([["mb", true], ["t", false]]);
    expect(NO_GOAL_PICK).toBe("Không cho mục tiêu nào");
  });

  it("UC-715 AC-21: ô tìm không dấu, theo tên mục tiêu hoặc tên tài khoản; không khớp gì → rỗng", () => {
    const p = pockets();
    expect(goalPickerGroups(p, "v", "dam cuoi")).toEqual([{ accountId: "t", name: "VCB chung", own: false, goals: [{ id: "dam-cuoi", name: "Đám cưới" }] }]);
    expect(goalPickerGroups(p, "v", "mb").map((g) => g.goals.map((x) => x.id))).toEqual([["nha-o"]]);
    expect(goalPickerGroups(p, "v", "xyz")).toEqual([]);
  });

  it("UC-715 AC-21: tên mục tiêu đang gắn (cả mục tiêu đã chốt); không gắn → null", () => {
    const p = pockets({ goals: pockets().reserve.goals.map((g) => (g.id === "sua-xe" ? { ...g, closed: true } : g)) });
    expect(goalNameOf(p, "sua-xe")).toBe("Sửa xe");
    expect(goalNameOf(p, null)).toBeNull();
  });

  it("UC-715 AC-21: toast 'Đã khớp vào {mục tiêu}' (+ '· chờ chuyển về X' khi tạo việc chuyển về), gỡ → 'Đã gỡ khỏi {mục tiêu}'; che số 5 chấm", () => {
    const plain: GoalMatchResult = { goal: {}, changes: [{ tx_id: 501, from_goal_id: null, to_goal_id: "dam-cuoi" }], refunds_created: [], refunds_voided: [] };
    expect(matchToast("Đám cưới", plain)).toBe("Đã khớp vào Đám cưới");
    const b = { ...plain, refunds_created: [{ id: 7, amount: 1_000_000, from_account_id: "t", to_account_id: "v" }] };
    expect(matchToast("Đám cưới", b)).toBe(`Đã khớp vào Đám cưới · chờ chuyển về ${vnd("1.000.000")}`);
    expect(matchToast("Sửa xe", { ...plain, changes: [plain.changes[0]!, { tx_id: 502, from_goal_id: null, to_goal_id: "sua-xe" }] })).toBe("Đã khớp 2 khoản vào Sửa xe");
    expect(unmatchToast("Sửa xe", 1)).toBe("Đã gỡ khỏi Sửa xe");
    expect(unmatchToast("Sửa xe", 2)).toBe("Đã gỡ 2 khoản khỏi Sửa xe");
    setAmountsHidden(true);
    expect(matchToast("Đám cưới", b)).toBe(`Đã khớp vào Đám cưới · chờ chuyển về ${vnd("•••••")}`);
  });

  it("UC-715 AC-21: Hoàn tác trả từng khoản về mục tiêu cũ — chưa gắn → gỡ khỏi mục tiêu mới; đang ở mục tiêu khác → khớp lại vào đó; gom theo mục tiêu", () => {
    expect(
      undoRequests([
        { tx_id: 501, from_goal_id: null, to_goal_id: "sua-xe" },
        { tx_id: 502, from_goal_id: null, to_goal_id: "sua-xe" },
        { tx_id: 503, from_goal_id: "hoc-tap", to_goal_id: "sua-xe" },
        { tx_id: 504, from_goal_id: "sua-xe", to_goal_id: null },
      ]),
    ).toEqual([
      { path: "/v1/goals/sua-xe/transactions", body: { remove: [501, 502] } },
      { path: "/v1/goals/hoc-tap/transactions", body: { add: [503] } },
      { path: "/v1/goals/sua-xe/transactions", body: { add: [504] } },
    ]);
  });
});

describe("Hôm nay › Cần xem (pwa UC-702 AC-45)", () => {
  it("UC-702 AC-45: T có 2 khoản chưa khớp, một việc chuyển về đang chờ → hai hàng; MB (một mục tiêu) không có hàng", () => {
    const rows = needReviewGoalRows(pockets({ refunds: [refund()] }), names);
    expect(rows).toEqual([
      { kind: "unmatched", key: "unmatched-t", accountId: "t", goalIds: ["dam-cuoi", "tap-luyen", "hoc-tap", "sua-xe"], title: "2 khoản ở VCB chung chưa khớp mục tiêu" },
      { kind: "refund", key: "refund-7", refundId: 7, title: `Chuyển ${vnd("1.000.000")} từ VCB chung về V chi tiêu`, sub: "cho Đám cưới" },
    ]);
  });

  it("UC-702 AC-45: đã nhận một phần → số còn thiếu; việc xong / bỏ qua không có hàng; không có gì → không hàng; mục tiêu đã chốt không chọn được để khớp", () => {
    const p = pockets({ unmatched: 0, refunds: [refund({ linked: 600_000, missing: 400_000 }), refund({ id: 8, status: "done" }), refund({ id: 9, status: "skipped", reason: "trả hộ" })] });
    expect(needReviewGoalRows(p, names).map((r) => r.title)).toEqual([`Chuyển ${vnd("400.000")} từ VCB chung về V chi tiêu`]);
    expect(needReviewGoalRows(pockets({ unmatched: 0 }), names)).toEqual([]);
    const closed = pockets({ goals: pockets().reserve.goals.map((g) => (g.id === "dam-cuoi" ? { ...g, closed: true } : g)) });
    expect(needReviewGoalRows(closed, names)[0]).toMatchObject({ goalIds: ["tap-luyen", "hoc-tap", "sua-xe"] });
  });

  it("UC-702 AC-45: QR nội dung 'CV {mã} T{tháng}' tới tài khoản đã trả, số = phần còn thiếu; một đầu là tài khoản riêng tư của người khác → không số tài khoản, không QR", () => {
    const qr = refundQr(refund({ linked: 600_000, missing: 400_000 }));
    expect(qr).toMatchObject({ amount: 400_000, memo: "CV 7K2Q T11", label: expect.stringContaining("V chi tiêu") });
    expect("payload" in qr && qr.payload).toBeTruthy();
    expect(refundQr(refund({ hidden: true, qr: null }))).toEqual({ amount: 1_000_000, memo: "CV 7K2Q T11", hint: "Một đầu là tài khoản riêng tư của người khác: chuyển theo nội dung CV 7K2Q T11, không có mã QR." });
  });

  it("UC-702 AC-45: toast Đã chuyển / Bỏ qua nói đúng việc; che số", () => {
    expect(refundToast("done", refund(), names)).toBe(`Đã chuyển ${vnd("1.000.000")} về V chi tiêu`);
    expect(refundToast("skip", refund(), names)).toBe("Đã bỏ qua việc chuyển về V chi tiêu");
    setAmountsHidden(true);
    expect(refundToast("done", refund(), names)).toBe(`Đã chuyển ${vnd("•••••")} về V chi tiêu`);
  });
});

describe("sheet Khớp giao dịch (pwa UC-707 AC-46)", () => {
  const c = (o: Partial<GoalCandidate>): GoalCandidate => ({ tx_id: 1, at: "2026-11-20T03:00:00Z", note: "SUA XE", amount: 500_000, account_id: "t", account_name: "VCB chung", goal_id: null, goal_name: null, own: true, ...o });

  it("UC-707 AC-46: khoản từ tài khoản mục tiêu không nhãn; từ tài khoản khác 'từ {tài khoản} · sẽ chờ chuyển về'; đang ở mục tiêu khác 'đang ở {mục tiêu}'", () => {
    expect(candidateTag(c({}), "sua-xe")).toBeNull();
    expect(candidateTag(c({ own: false, account_id: "v", account_name: "V chi tiêu" }), "sua-xe")).toBe("từ V chi tiêu · sẽ chờ chuyển về");
    expect(candidateTag(c({ goal_id: "hoc-tap", goal_name: "Học tập" }), "sua-xe")).toBe("đang ở Học tập");
    expect(candidateTag(c({ own: false, account_name: "V chi tiêu", goal_id: "hoc-tap", goal_name: "Học tập" }), "sua-xe")).toBe("từ V chi tiêu · sẽ chờ chuyển về · đang ở Học tập");
  });

  it("UC-707 AC-46: chân sheet 'Khớp N khoản · Y'; chưa chọn → null; che số", () => {
    expect(matchFooter([c({ amount: 500_000 }), c({ tx_id: 2, amount: 400_000 })])).toBe(`Khớp 2 khoản · ${vnd("900.000")}`);
    expect(matchFooter([])).toBeNull();
    setAmountsHidden(true);
    expect(matchFooter([c({})])).toBe(`Khớp 1 khoản · ${vnd("•••••")}`);
  });

  it("UC-707 AC-46: ô tìm theo ngày / số tiền — '20/11' → from=to=2026-11-20; '1.200.000' hay '1200000' → amount; chữ → q; rỗng → mặc định", () => {
    expect(candidateQuery("", "2026-11-25")).toBe("");
    expect(candidateQuery("20/11", "2026-11-25")).toBe("from=2026-11-20&to=2026-11-20");
    expect(candidateQuery("5/1/2026", "2026-11-25")).toBe("from=2026-01-05&to=2026-01-05");
    expect(candidateQuery("1.200.000", "2026-11-25")).toBe("amount=1200000");
    expect(candidateQuery(" 1200000 ", "2026-11-25")).toBe("amount=1200000");
    expect(candidateQuery("mừng cưới", "2026-11-25")).toBe("q=m%E1%BB%ABng+c%C6%B0%E1%BB%9Bi");
  });

  it("UC-707 AC-45: hàng khoản đã khớp — 'ngày · tài khoản', kiểu B 'ngày · trả từ {tài khoản}'", () => {
    expect(matchedRowSub({ tx_id: 1, at: "2026-11-20T03:00:00Z", note: null, amount: 1, account_id: "t", account_name: "VCB chung", kind: "own", refund_id: null })).toBe("20/11 · VCB chung");
    expect(matchedRowSub({ tx_id: 2, at: "2026-11-02T03:00:00Z", note: null, amount: 1, account_id: "v", account_name: "V chi tiêu", kind: "other", refund_id: 7 })).toBe("2/11 · trả từ V chi tiêu");
  });

  it("UC-707 AC-45: chốt / mở lại mục tiêu lặp N tháng gửi đợt đang thấy (`period_id`, kể cả null); mục tiêu một lần / hằng tháng không gửi gì", () => {
    expect(closeBody({ repeatMonths: 3, periodId: 12 })).toEqual({ period_id: 12 });
    expect(closeBody({ repeatMonths: 3, periodId: null })).toEqual({ period_id: null });
    expect(closeBody({ repeatMonths: 1, periodId: null })).toEqual({});
    expect(closeBody({ repeatMonths: null, periodId: null })).toEqual({});
  });
  it("UC-707 AC-45: toast Chốt xong / Mở lại", () => {
    expect(closeToast("Sửa xe")).toBe("Đã chốt xong Sửa xe");
    expect(reopenToast("Sửa xe")).toBe("Đã mở lại Sửa xe");
  });
});
