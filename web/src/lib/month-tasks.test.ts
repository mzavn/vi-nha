import { afterEach, describe, expect, it } from "vitest";
import { taskCode, taskMemo } from "../../../src/domain/month-tasks";
import type { TopUp } from "../../../src/domain/snapshot";
import { setAmountsHidden } from "./money";
import {
  amountProblem,
  effectsToast,
  goalHintLine,
  monthCloseCard,
  monthReopenPath,
  monthSkipPath,
  monthSplitRequest,
  savingsDoneLine,
  savingsDoneWarn,
  savingsSheetAction,
  savingsSheetDrag,
  savingsSheetOpen,
  savingsSheetType,
  savingsSheetView,
  savingsTaskCard,
  SKIP_REASON_REQUIRED,
  skipProblem,
  taskQr,
  taskRequest,
  topUpQr,
  withMonth,
} from "./month-tasks";
import type { MonthClose, MonthTask, MonthView, QrTarget, Snapshot } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => `${s}${NBSP}₫`;
afterEach(() => setAmountsHidden(false));

const SAVINGS_ACC: QrTarget = { accountId: "wealth", name: "tài khoản tích luỹ", bank: "Vietcombank", accountNo: "0123456789", subAccount: null };
const REWARD_ACC: QrTarget = { accountId: "mb-reward", name: "MB Ví Thưởng", bank: "MBBank", accountNo: "9876543210", subAccount: null };
/** Lương chồng 20.000.000 về 10/12 08:00 VN (pocket UC-1205 AC-5). */
const salary = { txId: 1, amount: 20_000_000, at: "2026-12-10T01:00:00Z", streamName: "Lương" };

const task = (o: Partial<MonthTask> & Pick<MonthTask, "id" | "kind" | "amount">): MonthTask => ({
  month: "2026-12",
  code: taskCode(o.id),
  status: "open",
  auto: false,
  linked: 0,
  missing: o.amount,
  pct: null,
  reason: null,
  toPocket: null,
  toAccountId: null,
  source: null,
  updatedAt: "2026-12-10T01:00:00Z",
  lastTxAt: null,
  targets: [],
  targetName: null,
  ...o,
});

const savingsTask = (o: Partial<MonthTask> = {}) =>
  task({ id: 11, kind: "savings", amount: 2_000_000, pct: 10, toPocket: "savings", source: salary, targets: [SAVINGS_ACC], targetName: "tài khoản tích luỹ", ...o });

function monthOf(tasks: MonthTask[], over: Partial<MonthView> = {}): MonthView {
  return {
    key: "2026-12",
    tasks,
    openCount: tasks.filter((t) => t.status === "open").length,
    savings: { amount: 0, base: 20_000_000, pct: 0, level: null },
    goalHint: { goalId: "car", name: "Bảo dưỡng xe", short: 760_000 },
    ...over,
  };
}

describe("thẻ Trích Tích luỹ (pwa UC-702)", () => {
  it("UC-702 AC-38: lương 20.000.000 về 10/12 → một hàng 'Lương 20.000.000 ₫ về 10/12' / 'Trích Tích luỹ 10% · 2.000.000 ₫' với QR và 'Đã chuyển'; gợi ý 'Mục tiêu còn thiếu: Bảo dưỡng xe 760.000 ₫ ›'; mọi mục tiêu đủ → không dòng; không còn chữ việc ngày lương; che số", () => {
    const v = savingsTaskCard(monthOf([savingsTask()]), true)!;
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0]).toMatchObject({
      state: "open",
      head: `Lương ${vnd("20.000.000")} về 10/12`,
      title: `Trích Tích luỹ 10% · ${vnd("2.000.000")}`,
      sub: null,
      qr: true,
      doneLabel: "Đã chuyển",
      canSkip: true,
      needsReason: true,
      canEdit: true,
    });
    expect(v).toMatchObject({ goalHint: `Mục tiêu còn thiếu: Bảo dưỡng xe ${vnd("760.000")} ›`, collapsed: null, offline: null });
    expect(savingsTaskCard(monthOf([savingsTask()], { goalHint: null }), true)!.goalHint).toBeNull();
    expect(JSON.stringify(v)).not.toMatch(/kỳ|Việc ngày lương|Nạp |còn \d/);
    expect(savingsTaskCard(monthOf([]), true)).toBeNull();
    expect(savingsTaskCard(null, true)).toBeNull();
    setAmountsHidden(true);
    const hidden = savingsTaskCard(monthOf([savingsTask()]), true)!;
    expect(JSON.stringify(hidden)).not.toMatch(/\d\.\d{3}/);
    expect(hidden.rows[0]!.title).toBe(`Trích Tích luỹ 10% · ${vnd("•••••")}`);
  });

  it("UC-702 AC-38: xong hết → thu gọn '✓ Đã trích 3.400.000 ₫ · 10% lương cả nhà tháng 12' (số và % của cả nhà), không gợi ý; bỏ qua cả → 'Đã bỏ qua trích Tích luỹ tháng 12'; mất mạng → 'Cần mạng'", () => {
    const done = savingsTask({ status: "done", auto: true, linked: 2_000_000, missing: 0, lastTxAt: "2026-12-10T03:00:00Z" });
    const v = savingsTaskCard(monthOf([done], { savings: { amount: 3_400_000, base: 34_000_000, pct: 10, level: "10to30" } }), true)!;
    expect(v).toMatchObject({ collapsed: `Đã trích ${vnd("3.400.000")} · 10% lương cả nhà tháng 12`, goalHint: null });
    expect(v.rows[0]).toMatchObject({ state: "done", title: `✓ Trích Tích luỹ 10% · ${vnd("2.000.000")}`, sub: "tự nhận từ chuyển khoản 10/12", canUndo: false, doneLabel: null });
    const skipped = savingsTask({ status: "skipped", reason: "Tháng này trả viện phí" });
    expect(savingsTaskCard(monthOf([skipped]), true)!.collapsed).toBe("Đã bỏ qua trích Tích luỹ tháng 12");
    expect(savingsTaskCard(monthOf([savingsTask()]), false)!.offline).toBe("Cần mạng");
  });

  it("UC-1206 AC-18: gợi ý mục tiêu chỉ một dòng, chỉ khi còn ① đang mở; không phải việc (không hàng, không nút)", () => {
    const m = monthOf([savingsTask()]);
    expect(goalHintLine(m)).toBe(`Mục tiêu còn thiếu: Bảo dưỡng xe ${vnd("760.000")} ›`);
    expect(savingsTaskCard(m, true)!.rows.map((r) => r.id)).toEqual([11]);
    const surplusOnly = monthOf([task({ id: 21, kind: "surplus", month: "2026-11", amount: 2_400_000, toPocket: "savings", targets: [SAVINGS_ACC] })]);
    expect(goalHintLine(surplusOnly)).toBeNull();
  });

  it("UC-702 AC-21: hai khoản lương trong tháng → hai hàng ① theo thứ tự server, mỗi hàng một khoản lương; chưa có tài khoản Tích luỹ → 'Trích Tích luỹ 10% · chưa có tài khoản Tích luỹ — mở tài khoản thật ›', không QR, 'Đã chuyển' vẫn có", () => {
    const wife = savingsTask({ id: 12, amount: 1_500_000, source: { txId: 2, amount: 15_000_000, at: "2026-12-25T02:00:00Z", streamName: "Lương vợ" } });
    const v = savingsTaskCard(monthOf([savingsTask(), wife]), true)!;
    expect(v.rows.map((r) => [r.head, r.title])).toEqual([
      [`Lương ${vnd("20.000.000")} về 10/12`, `Trích Tích luỹ 10% · ${vnd("2.000.000")}`],
      [`Lương ${vnd("15.000.000")} về 25/12`, `Trích Tích luỹ 10% · ${vnd("1.500.000")}`],
    ]);
    const none = savingsTaskCard(monthOf([savingsTask({ targets: [], targetName: null })]), true)!;
    expect(none.rows[0]).toMatchObject({ title: "Trích Tích luỹ 10% · chưa có tài khoản Tích luỹ, mở tài khoản thật ›", noSavingsAccount: true, qr: false, qrHint: null, doneLabel: "Đã chuyển" });
    expect(savingsTaskCard(monthOf([savingsTask({ targets: [], targetName: "heo đất" })]), true)!.rows[0]).toMatchObject({ qr: false, qrHint: "Chuyển sang heo đất" });
  });

  it("UC-702 AC-22: đã ghép 1.500.000 → 'đã 1.500.000 / 2.000.000 ₫'; Bỏ qua ① không lý do → 'Không trích lần này cần ghi lý do'; bỏ qua có lý do → 'Bỏ qua — lý do' + Hoàn tác; tick tay → 'đánh dấu tay' + Hoàn tác", () => {
    const partial = savingsTaskCard(monthOf([savingsTask({ linked: 1_500_000, missing: 500_000 })]), true)!;
    expect(partial.rows[0]).toMatchObject({ state: "partial", sub: `đã 1.500.000 / ${vnd("2.000.000")}` });
    const t = savingsTask();
    expect(skipProblem(t, "  ")).toBe(SKIP_REASON_REQUIRED);
    expect(SKIP_REASON_REQUIRED).toBe("Nhập lý do không trích lần này.");
    expect(skipProblem(t, "Tháng này trả viện phí")).toBeNull();
    expect(skipProblem(t, "x".repeat(501))).toBe("Lý do tối đa 500 ký tự.");
    expect(skipProblem({ kind: "surplus" }, "")).toBeNull();
    const skipped = savingsTaskCard(monthOf([savingsTask({ status: "skipped", reason: "Tháng này trả viện phí" }), savingsTask({ id: 12 })]), true)!;
    expect(skipped.rows[0]).toMatchObject({ state: "skipped", sub: "Bỏ qua: Tháng này trả viện phí", canUndo: true, canSkip: false, canEdit: false });
    const manual = savingsTaskCard(monthOf([savingsTask({ status: "done" }), savingsTask({ id: 12 })]), true)!;
    expect(manual.rows[0]).toMatchObject({ sub: "đánh dấu tay", canUndo: true });
    expect(amountProblem(t, 0, "")).toBe(SKIP_REASON_REQUIRED);
    expect(amountProblem(t, 3_000_000, "")).toBeNull();
    expect(amountProblem(t, -1, "")).toBe("Số tiền không hợp lệ.");
  });

  it("UC-702 AC-22: thân yêu cầu tới /v1/month-tasks — done / skip / reopen / sửa số; server trả month mới → giữ gợi ý mục tiêu", () => {
    expect(taskRequest(11, { kind: "done" })).toEqual({ method: "POST", path: "/v1/month-tasks/11/done", body: {} });
    expect(taskRequest(11, { kind: "skip", reason: " Tháng này trả viện phí " })).toEqual({ method: "POST", path: "/v1/month-tasks/11/skip", body: { reason: "Tháng này trả viện phí" } });
    expect(taskRequest(21, { kind: "skip", reason: "" }).body).toEqual({});
    expect(taskRequest(11, { kind: "reopen" })).toEqual({ method: "POST", path: "/v1/month-tasks/11/reopen", body: {} });
    expect(taskRequest(11, { kind: "amount", amount: 3_000_000, reason: "" })).toEqual({ method: "PATCH", path: "/v1/month-tasks/11", body: { amount: 3_000_000 } });
    const snap = { month: monthOf([savingsTask()]) } as Snapshot;
    const { goalHint: _g, ...view } = monthOf([savingsTask({ status: "done" })], { openCount: 0 });
    const next = withMonth(snap, view);
    expect(next.month).toMatchObject({ openCount: 0, goalHint: { name: "Bảo dưỡng xe" } });
    expect(next.month.tasks[0]!.status).toBe("done");
  });

  it("UC-702 AC-30: sau khi bấm Chia tháng 11 → hai hàng chia dư có QR ('Chia dư tháng 11: 2.400.000 ₫ vào Tích luỹ' / '… vào Ví Thưởng'), cùng thẻ với ① đang mở; QR 'CD {mã} T11' / 'VT {mã} T11'", () => {
    const toSavings = task({ id: 21, kind: "surplus", month: "2026-11", amount: 2_400_000, toPocket: "savings", targets: [SAVINGS_ACC], targetName: "tài khoản tích luỹ" });
    const toReward = task({ id: 22, kind: "surplus", month: "2026-11", amount: 2_400_000, toAccountId: "mb-reward", targets: [REWARD_ACC], targetName: "MB Ví Thưởng" });
    const v = savingsTaskCard(monthOf([savingsTask(), toSavings, toReward]), true)!;
    expect(v.rows.map((r) => [r.head, r.title, r.qr, r.doneLabel])).toEqual([
      [`Lương ${vnd("20.000.000")} về 10/12`, `Trích Tích luỹ 10% · ${vnd("2.000.000")}`, true, "Đã chuyển"],
      [null, `Chia dư tháng 11: ${vnd("2.400.000")} vào Tích luỹ`, true, "Đã chuyển"],
      [null, `Chia dư tháng 11: ${vnd("2.400.000")} vào Ví Thưởng`, true, "Đã chuyển"],
    ]);
    expect(v.rows[1]).toMatchObject({ needsReason: false, canSkip: true });
    expect(taskQr(toSavings)).toMatchObject({ target: SAVINGS_ACC, amount: 2_400_000, memo: `CD ${toSavings.code} T11` });
    expect(taskQr(toReward)).toMatchObject({ target: REWARD_ACC, amount: 2_400_000, memo: `VT ${toReward.code} T11` });
    const done = savingsTaskCard(monthOf([{ ...toSavings, status: "done" }, { ...toReward, status: "done" }], { openCount: 0 }), true)!;
    expect(done.collapsed).toBe("Đã chia dư tháng 11");
    const lacking = savingsTaskCard(monthOf([{ ...toSavings, targets: [], targetName: null }]), true)!;
    expect(lacking.rows[0]!.title).toBe(`Chia dư tháng 11: ${vnd("2.400.000")} vào Tích luỹ · chưa có tài khoản Tích luỹ, mở tài khoản thật ›`);
  });

  it("UC-504 AC-18: lương về tài khoản riêng tư bị giấu (source: { hidden: true }) → dòng trên 'Lương ở tài khoản riêng tư', số và trạng thái của nhắc giữ; chủ xem → 'Lương 20.000.000 ₫ về 10/12'", () => {
    const hidden = savingsTask({ source: { hidden: true } });
    const v = savingsTaskCard(monthOf([hidden]), true)!;
    expect(v.rows[0]).toMatchObject({ state: "open", head: "Lương ở tài khoản riêng tư", title: `Trích Tích luỹ 10% · ${vnd("2.000.000")}`, qr: true });
    expect(JSON.stringify(v)).not.toContain("20.000.000");
    expect(savingsTaskCard(monthOf([savingsTask()]), true)!.rows[0]!.head).toBe(`Lương ${vnd("20.000.000")} về 10/12`);
  });

  it("UC-702 AC-35: sheet 'Trích Tích luỹ' — ① lương 30.000.000, 10% → thanh 10, số 3.000.000; kéo tới 30 → 9.000.000; gõ 150.000 → thanh 1 và 'Dưới mức tối thiểu 1% (300.000 ₫)'; gõ 0 → nhãn '0% khoản lương', thanh ở 0 (không vạch sáng), ô Lý do, Lưu tắt tới khi có lý do; Lưu gửi { amount: 0, reason }", () => {
    const t = savingsTask({ id: 61, amount: 3_000_000, source: { ...salary, amount: 30_000_000 } });
    const s0 = savingsSheetOpen(t);
    expect(s0).toMatchObject({ income: 30_000_000, pct: 10, amount: 3_000_000, reason: "" });
    expect(savingsSheetView(s0)).toEqual({ pctText: "10% khoản lương", warn: null, needsReason: false, problem: null, canSave: true });
    const s30 = savingsSheetDrag(s0, 30);
    expect(s30).toMatchObject({ pct: 30, amount: 9_000_000 });
    const low = savingsSheetType(s30, 150_000);
    expect(low).toMatchObject({ pct: 1, amount: 150_000 });
    expect(savingsSheetView(low)).toMatchObject({ pctText: "1% khoản lương", warn: `Dưới mức tối thiểu 1% (${vnd("300.000")})`, needsReason: false, canSave: true });
    const zero = savingsSheetType(s30, 0);
    expect(zero).toMatchObject({ amount: 0, pct: 0 });
    expect(savingsSheetView(zero)).toEqual({ pctText: "0% khoản lương", warn: null, needsReason: true, problem: SKIP_REASON_REQUIRED, canSave: false });
    const reopened = savingsSheetOpen({ ...t, amount: 0 });
    expect(reopened.pct).toBe(0);
    expect(savingsSheetDrag(reopened, 10)).toMatchObject({ pct: 10, amount: 3_000_000 });
    const reasoned = { ...zero, reason: "Tháng này trả viện phí" };
    expect(savingsSheetView(reasoned)).toMatchObject({ needsReason: true, problem: null, canSave: true });
    expect(taskRequest(t.id, savingsSheetAction(reasoned))).toEqual({ method: "PATCH", path: "/v1/month-tasks/61", body: { amount: 0, reason: "Tháng này trả viện phí" } });
    expect(taskRequest(t.id, savingsSheetAction(savingsSheetType(reasoned, 4_000_000)))).toEqual({ method: "PATCH", path: "/v1/month-tasks/61", body: { amount: 4_000_000 } });
    expect(savingsSheetView(savingsSheetType(s0, null)).canSave).toBe(false);
    const hidden = savingsSheetOpen({ ...t, source: { hidden: true } });
    expect(hidden).toMatchObject({ income: null, amount: 3_000_000, pct: 10 });
    expect(savingsSheetDrag(hidden, 30)).toBe(hidden);
    expect(savingsSheetView(savingsSheetType(hidden, 150_000)).warn).toBeNull();
  });
});

describe("dòng Tích luỹ tháng ở thẻ Tích luỹ (pwa UC-702, ADR-142)", () => {
  it("UC-702 AC-40: Tích luỹ tháng 12 { 3.500.000 / 35.000.000, 10%, 10to30 } → 'Tháng 12 đã trích 3.500.000 ₫ · 10% lương · mức 10–30%'; chưa chuyển → 'Tháng 12 chưa trích (10% = 2.000.000 ₫)'; tháng chưa có lương → không dòng", () => {
    const m = monthOf([savingsTask()], { savings: { amount: 3_500_000, base: 35_000_000, pct: 10, level: "10to30" } });
    expect(savingsDoneLine(m, 10)).toBe(`Tháng 12 đã trích ${vnd("3.500.000")} · 10% lương · mức 10–30%`);
    expect(savingsDoneLine(monthOf([savingsTask()]), 10)).toBe(`Tháng 12 chưa trích (10% = ${vnd("2.000.000")})`);
    expect(savingsDoneLine(monthOf([], { key: "2027-01", savings: { amount: 0, base: 0, pct: null, level: null } }), 10)).toBeNull();
    expect(savingsDoneLine(null, 10)).toBeNull();
    setAmountsHidden(true);
    expect(savingsDoneLine(m, 10)).toBe(`Tháng 12 đã trích ${vnd("•••••")} · 10% lương · mức 10–30%`);
  });

  it("UC-702 AC-32: savings_pct 15, hai ① (3.000.000 và 1.500.000) chưa chuyển → 'Tháng 12 chưa trích (15% = 4.500.000 ₫)'; ① bỏ qua không vào số cần; ① của tháng trước không vào", () => {
    const tasks = [savingsTask({ amount: 3_000_000, pct: 15 }), savingsTask({ id: 12, amount: 1_500_000, pct: 15 })];
    expect(savingsDoneLine(monthOf(tasks, { savings: { amount: 0, base: 30_000_000, pct: 0, level: null } }), 15)).toBe(`Tháng 12 chưa trích (15% = ${vnd("4.500.000")})`);
    const skipped = [tasks[0]!, { ...tasks[1]!, status: "skipped" as const }];
    expect(savingsDoneLine(monthOf(skipped, { savings: { amount: 0, base: 30_000_000, pct: 0, level: null } }), 15)).toBe(`Tháng 12 chưa trích (15% = ${vnd("3.000.000")})`);
    const old = [tasks[0]!, { ...tasks[1]!, month: "2026-11" }];
    expect(savingsDoneLine(monthOf(old, { savings: { amount: 0, base: 20_000_000, pct: 0, level: null } }), 15)).toBe(`Tháng 12 chưa trích (15% = ${vnd("3.000.000")})`);
  });

  it("UC-702 AC-36: mức đạt — 200.000 / 30.000.000 'mức dưới 1%' (vàng); 1–10%; từ 30%; bỏ qua cả hai ① → '0% — Tháng này trả viện phí'", () => {
    const tasks = [savingsTask(), savingsTask({ id: 12, amount: 1_000_000, source: { ...salary, txId: 2, amount: 10_000_000 } })];
    const at = (amount: number, level: MonthView["savings"]["level"], list = tasks) => monthOf(list, { savings: { amount, base: 30_000_000, pct: Math.floor((amount * 100) / 30_000_000), level } });
    expect(savingsDoneLine(at(200_000, "below1"), 10)).toBe(`Tháng 12 đã trích ${vnd("200.000")} · 0% lương · mức dưới 1%`);
    expect(savingsDoneWarn(at(200_000, "below1"))).toBe(true);
    expect(savingsDoneLine(at(1_500_000, "1to10"), 10)).toBe(`Tháng 12 đã trích ${vnd("1.500.000")} · 5% lương · mức 1–10%`);
    expect(savingsDoneWarn(at(1_500_000, "1to10"))).toBe(false);
    expect(savingsDoneLine(at(9_000_000, "from30"), 10)).toBe(`Tháng 12 đã trích ${vnd("9.000.000")} · 30% lương · mức từ 30%`);
    const skippedBoth = tasks.map((t) => ({ ...t, status: "skipped" as const, reason: "Tháng này trả viện phí" }));
    expect(savingsDoneLine(at(0, "zero", skippedBoth), 10)).toBe(`Tháng 12 đã trích ${vnd("0")} · 0% — Tháng này trả viện phí`);
    const zeroed = tasks.map((t) => ({ ...t, amount: 0, missing: 0, reason: "Tháng này trả viện phí" }));
    expect(savingsDoneLine(at(0, "zero", zeroed), 10)).toBe(`Tháng 12 đã trích ${vnd("0")} · 0% — Tháng này trả viện phí`);
    expect(savingsDoneWarn(null)).toBe(false);
  });
});

describe("thẻ Tháng dư (pwa UC-702, pocket UC-1207)", () => {
  const nov: MonthClose = {
    month: "2026-11",
    operatingEnd: 12_000_000,
    pendingAtEnd: 0,
    earlySalary: 0,
    heldPayables: 4_500_000,
    heldToPayday: 2_700_000,
    surplus: 4_800_000,
    savingsAmount: 2_400_000,
    rewardAmount: 2_400_000,
    pct: 50,
    status: "ask",
  };

  it("UC-702 AC-39: 1/12, tháng 11 dư 4.800.000 → 'Tháng 11 dư 4.800.000 ₫', dòng chi tiết, chip '50 / 50' → '2.400.000 Tích luỹ · 2.400.000 Ví Thưởng', Chia / Để lại Vận hành; W > 0 → thêm 'đang chờ chuyển'; đổi 60% → 2.880.000 / 1.920.000 và thân { month, savings_pct: 60 }", () => {
    const v = monthCloseCard(nov, { paydayDay: 10, hasReward: true })!;
    expect(v).toEqual({
      title: `Tháng 11 dư ${vnd("4.800.000")}`,
      detail: "Vận hành cuối tháng 12.000.000 · giữ khoản phải trả 4.500.000 · giữ ăn tiêu tới 10/12 2.700.000",
      chip: "50 / 50",
      split: "2.400.000 Tích luỹ · 2.400.000 Ví Thưởng",
      canSplit: true,
      pct: 50,
    });
    const waiting = monthCloseCard({ ...nov, pendingAtEnd: 1_500_000, surplus: 3_300_000 }, { paydayDay: 10, hasReward: true })!;
    expect(waiting.detail).toBe("Vận hành cuối tháng 12.000.000 · đang chờ chuyển 1.500.000 · giữ khoản phải trả 4.500.000 · giữ ăn tiêu tới 10/12 2.700.000");
    const sixty = monthCloseCard(nov, { pct: 60, paydayDay: 10, hasReward: true })!;
    expect(sixty).toMatchObject({ chip: "60 / 40", split: "2.880.000 Tích luỹ · 1.920.000 Ví Thưởng" });
    expect(monthSplitRequest(nov, 60)).toEqual({ path: "/v1/month-close", body: { month: "2026-11", savings_pct: 60 } });
    expect(monthSkipPath(nov)).toBe("/v1/month-close/2026-11/skip");
    expect(monthReopenPath(nov)).toBe("/v1/month-close/2026-11/reopen");
    expect(monthCloseCard(nov, { paydayDay: 10, hasReward: false })!.split).toBe("2.400.000 Tích luỹ · 2.400.000 để lại Vận hành");
    setAmountsHidden(true);
    expect(JSON.stringify(monthCloseCard(nov, { paydayDay: 10, hasReward: true }))).not.toMatch(/\d\.\d{3}/);
  });

  it("UC-702 AC-39: S < 0 → một dòng 'Tháng 11 tiêu quá 1.200.000 ₫ — không có gì để chia', không nút Chia; S = 0, đã chia, đã bỏ qua, không có → không thẻ", () => {
    expect(monthCloseCard({ ...nov, operatingEnd: 6_000_000, surplus: -1_200_000, savingsAmount: 0, rewardAmount: 0 }, { paydayDay: 10, hasReward: true })).toEqual({
      title: `Tháng 11 tiêu quá ${vnd("1.200.000")}, không còn để chia`,
      detail: null,
      chip: null,
      split: null,
      canSplit: false,
      pct: 50,
    });
    expect(monthCloseCard({ ...nov, surplus: 0 }, { paydayDay: 10, hasReward: true })).toBeNull();
    expect(monthCloseCard({ ...nov, status: "split" }, { paydayDay: 10, hasReward: true })).toBeNull();
    expect(monthCloseCard({ ...nov, month: "2026-10", status: "skipped" }, { paydayDay: 10, hasReward: true })).toBeNull();
    expect(monthCloseCard(null, { paydayDay: 10, hasReward: true })).toBeNull();
  });
});

describe("mã QR của nhắc trích (pocket UC-1206 bước 10)", () => {
  it("UC-1206 AC-6: QR ① → tài khoản tích luỹ, 2.000.000, 'TL {mã} T12' (mã việc, tháng của khoản lương); đã ghép 1.500.000 → 500.000; chọn tài khoản đích khác", () => {
    const t = savingsTask();
    const qr = taskQr(t);
    expect(qr).toMatchObject({ target: SAVINGS_ACC, amount: 2_000_000, memo: `TL ${t.code} T12` });
    expect("payload" in qr && qr.payload).toContain(`TL ${t.code} T12`);
    expect(taskQr({ ...t, linked: 1_500_000, missing: 500_000 })).toMatchObject({ amount: 500_000 });
    expect(taskMemo({ ...t, month: "2026-11" })).toBe(`TL ${t.code} T11`);
    expect(taskQr({ ...t, targets: [], targetName: "heo đất" })).toEqual({ hint: "Chuyển sang heo đất" });
    const two = taskQr({ ...t, targets: [SAVINGS_ACC, { ...SAVINGS_ACC, accountId: "piggy2", name: "heo 2" }] }, "piggy2");
    expect("target" in two && two.target.accountId).toBe("piggy2");
  });

  it("UC-702 AC-33: Mở QR ở dòng BIDV của nhắc chuyển thêm → QR 2.000.000 tới tài khoản chi tiêu, nội dung 'Bu chi tieu 20-11'; không đích → câu 'Chuyển vào tiền chi tiêu'", () => {
    const target: QrTarget = { accountId: "tk-chi-tieu-chong", name: "MB chi tiêu chồng", bank: "MBBank", accountNo: "0123456789", subAccount: null };
    const topUp: TopUp = { amount: 5_500_000, sources: [{ accountId: "tk-bidv", name: "BIDV", amount: 2_000_000 }, { accountId: "phao", name: "Phao", amount: 3_500_000 }], toAccountId: target.accountId, target };
    const qr = topUpQr(topUp, "tk-bidv", "2026-11-20");
    expect(qr).toMatchObject({ target, amount: 2_000_000, memo: "Bu chi tieu 20-11" });
    expect("payload" in qr && qr.payload).toContain("Bu chi tieu 20-11");
    expect(topUpQr(topUp, "phao", "2026-11-20")).toMatchObject({ amount: 3_500_000 });
    expect(topUpQr({ ...topUp, toAccountId: null, target: null }, "tk-bidv", "2026-11-20")).toEqual({ hint: "Chuyển vào tiền chi tiêu" });
  });
});

describe("toast sau ghi / gán (pwa UC-705, UC-706)", () => {
  it("UC-706 AC-40: gán lương 20.000.000 có nhắc → 'Đã ghi · nhắc trích Tích luỹ 10% = 2.000.000 ₫'; chuyển làm xong ① → 'Đã ghi · Trích Tích luỹ ✓'; không gì → null", () => {
    expect(effectsToast({ savings: { amount: 2_000_000, pct: 10 }, tasksDone: [] })).toBe(`Đã ghi · nhắc trích Tích luỹ 10% = ${vnd("2.000.000")}`);
    expect(effectsToast({ savings: null, tasksDone: [{ id: 11, kind: "savings" }] })).toBe("Đã ghi · Trích Tích luỹ");
    expect(effectsToast({ savings: null, tasksDone: [{ id: 21, kind: "surplus" }] })).toBe("Đã ghi · Chia dư");
    expect(effectsToast({ savings: null, tasksDone: [] })).toBeNull();
    expect(effectsToast(undefined)).toBeNull();
  });
});
