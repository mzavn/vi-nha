import { afterEach, describe, expect, it } from "vitest";
import { setAmountsHidden } from "./money";
import {
  amountProblem,
  effectsToast,
  goalGroupQr,
  noCycleStreamLine,
  payCycleCard,
  savingsDoneLine,
  skipProblem,
  taskMemo,
  taskQr,
  taskRequest,
} from "./pay-cycle";
import type { PayCycleTask, PayCycleView, QrTarget } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => `${s}${NBSP}₫`;
afterEach(() => setAmountsHidden(false));

const SAVINGS_ACC: QrTarget = { accountId: "wealth", name: "tài khoản tích luỹ", bank: "Vietcombank", accountNo: "0123456789", subAccount: null };
const RESERVE_ACC: QrTarget = { accountId: "saving", name: "tài khoản tiết kiệm", bank: "Vietcombank", accountNo: "9876543210", subAccount: null };
const salary = { txId: 1, amount: 20_000_000, at: "2026-11-10T01:00:00Z", streamName: "Lương" };

const task = (o: Partial<PayCycleTask> & Pick<PayCycleTask, "id" | "kind" | "amount">): PayCycleTask => ({
  status: "open",
  auto: false,
  suggested: o.amount,
  linked: 0,
  missing: o.amount,
  pct: null,
  reason: null,
  toPocket: null,
  goal: null,
  toAccountId: null,
  source: null,
  doneAt: null,
  lastTxAt: null,
  targets: [],
  targetName: null,
  ...o,
});

const tuition = { id: "tuition", name: "Học phí", held: 4_000_000, target: 6_000_000, accountId: "tuition-acc" };
const car = { id: "car", name: "Bảo dưỡng xe", held: 1_000_000, target: 4_800_000, accountId: "car-acc" };
const TUITION_ACC: QrTarget = { accountId: "tuition-acc", name: "tài khoản học phí", bank: "Vietcombank", accountNo: "1111111111", subAccount: null };
const CAR_ACC: QrTarget = { accountId: "car-acc", name: "tài khoản bảo dưỡng xe", bank: "Vietcombank", accountNo: "2222222222", subAccount: null };

/** Hộ mẫu C sau UC-1206 AC-1: lương 20.000.000 ngày 10/11 mở kỳ, 5 việc. */
function cycleC(over: Partial<PayCycleView> = {}, tasks?: PayCycleTask[]): PayCycleView {
  const list = tasks ?? [
    task({ id: 11, kind: "savings", amount: 2_000_000, pct: 10, toPocket: "savings", source: salary, targets: [SAVINGS_ACC], targetName: "tài khoản tích luỹ" }),
    task({ id: 12, kind: "goal", amount: 2_000_000, goal: tuition, toAccountId: "tuition-acc", targets: [TUITION_ACC], targetName: "tài khoản học phí" }),
    task({ id: 13, kind: "goal", amount: 760_000, goal: car, toAccountId: "car-acc", targets: [CAR_ACC], targetName: "tài khoản bảo dưỡng xe" }),
    task({ id: 14, kind: "surplus", amount: 600_000, toPocket: "savings", targets: [SAVINGS_ACC], targetName: "tài khoản tích luỹ" }),
    task({ id: 15, kind: "surplus", amount: 600_000, toAccountId: "saving", targets: [RESERVE_ACC], targetName: "tài khoản tiết kiệm" }),
  ];
  return {
    id: 2,
    startedAt: "2026-11-10T01:00:00Z",
    payday: "2026-11-10",
    nextPayday: "2026-12-10",
    lateDays: 0,
    prevOperating: 1_200_000,
    tasks: list,
    openCount: list.filter((t) => t.status === "open").length,
    savingsDone: { amount: 0, base: 20_000_000, pct: 0 },
    ...over,
  };
}

const SAVING_ACC: QrTarget = { accountId: "tk-tiet-kiem", name: "MB tiết kiệm", bank: "Vietcombank", accountNo: "09991234567", subAccount: null };
const SHARED_ACC: QrTarget = { accountId: "tk-chung", name: "VCB chung", bank: "Vietcombank", accountNo: "09997654321", subAccount: null };

/** pocket UC-1206 AC-12 trước chuyển khoản: ② Nhà ở 1.500.000 rồi Học tập 2.000.000 cùng MB tiết kiệm, Hoá đơn ở VCB chung xếp giữa. `linked` theo mã việc. */
function sharedCycle(linked: Record<number, number> = {}): PayCycleView {
  const goalTask = (id: number, amount: number, goal: { id: string; name: string; held: number; target: number }, acc: QrTarget) => {
    const l = linked[id] ?? 0;
    return task({ id, kind: "goal", amount, linked: l, missing: amount - l, status: l >= amount ? "done" : "open", auto: l >= amount, goal: { ...goal, accountId: acc.accountId }, toAccountId: acc.accountId, targets: [acc], targetName: acc.name });
  };
  return cycleC({}, [
    task({ id: 40, kind: "savings", amount: 2_000_000, pct: 10, toPocket: "savings", source: salary, targets: [SAVINGS_ACC] }),
    goalTask(41, 1_500_000, { id: "nha-o", name: "Nhà ở", held: 6_000_000, target: 7_500_000 }, SAVING_ACC),
    goalTask(42, 500_000, { id: "hoa-don", name: "Hoá đơn", held: 1_500_000, target: 2_000_000 }, SHARED_ACC),
    goalTask(43, 2_000_000, { id: "hoc-tap", name: "Học tập", held: 0, target: 6_000_000 }, SAVING_ACC),
  ]);
}

describe("thẻ Việc ngày lương (pwa UC-702)", () => {
  it("UC-702 AC-21: hộ mẫu C sau lương → tiêu đề kỳ từ 10/11, chip còn 5, 5 hàng đúng chữ và số, ② 'đã có A / B trong {tài khoản}', nút 'Đã chuyển'; che số → mọi số bị che, 10% giữ", () => {
    const v = payCycleCard(cycleC(), true)!;
    expect(v).toMatchObject({ title: "Việc ngày lương · kỳ từ 10/11", chip: "còn 5", collapsed: null, overspent: null, offline: null });
    expect(v.rows.map((r) => r.title)).toEqual([
      `Trích Tích luỹ 10% · ${vnd("2.000.000")}`,
      `Nạp Học phí · ${vnd("2.000.000")}`,
      `Nạp Bảo dưỡng xe · ${vnd("760.000")}`,
      `Dư kỳ trước ${vnd("1.200.000")}: ${vnd("600.000")} vào Tích luỹ`,
      `Dư kỳ trước ${vnd("1.200.000")}: ${vnd("600.000")} vào Ví Thưởng`,
    ]);
    expect(v.rows[0]!.sub).toBe(`từ lương ${vnd("20.000.000")} ngày 10/11`);
    expect(v.rows[1]!.sub).toBe(`đã có 4.000.000 / ${vnd("6.000.000")} trong tài khoản học phí`);
    expect(v.rows.map((r) => [r.qr, r.doneLabel, r.canSkip, r.needsReason])).toEqual([
      [true, "Đã làm", true, true],
      [true, "Đã chuyển", true, false],
      [true, "Đã chuyển", true, false],
      [true, "Đã làm", true, false],
      [true, "Đã chuyển", true, false],
    ]);
    expect(JSON.stringify(v)).not.toMatch(/chưa chia|lệnh chuyển|Chuyển tiền cần làm|Chốt tháng|để riêng|Chọn tài khoản giữ/);
    setAmountsHidden(true);
    const hidden = payCycleCard(cycleC(), true)!;
    expect(hidden.rows[0]!.title).toBe(`Trích Tích luỹ 10% · ${vnd("••••")}`);
    expect(JSON.stringify(hidden)).not.toMatch(/\d\.\d{3}/);
  });

  it("UC-702 AC-21: % thu chịu thuế → dòng phụ theo khoản thu; chuyển theo ngăn của nguồn → 'Chuyển {nguồn} sang {ngăn}'; không kỳ / kỳ không việc → không thẻ", () => {
    const tax = task({ id: 21, kind: "goal", amount: 300_000, pct: 10, goal: { id: "tax", name: "Thuế", held: 0, target: null, accountId: "tax-acc" }, toAccountId: "tax-acc", source: { ...salary, amount: 3_000_000, streamName: "Việc phụ" } });
    const move = task({ id: 22, kind: "move", amount: 4_000_000, toPocket: "reserve", source: { ...salary, amount: 4_000_000, streamName: "Cho thuê" } });
    const v = payCycleCard(cycleC({}, [tax, move]), true)!;
    expect(v.rows[0]).toMatchObject({ title: `Nạp Thuế · ${vnd("300.000")}`, sub: `10% khoản thu chịu thuế ${vnd("3.000.000")}` });
    expect(v.rows[1]!.title).toBe(`Chuyển Cho thuê sang Dự phòng · ${vnd("4.000.000")}`);
    expect(payCycleCard(null, true)).toBeNull();
    expect(payCycleCard(undefined, true)).toBeNull();
    expect(payCycleCard(cycleC({}, []), true)).toBeNull();
  });

  it("UC-702 AC-22: sau chuyển khoản → ① ✓ tự nhận từ chuyển khoản 10/11, Ví Thưởng 'đã 240.000 / 600.000 ₫' với nút 'Đã chuyển', chip còn 1; xong cả → thẻ thu gọn; mất mạng → Cần mạng", () => {
    const base = cycleC();
    const tasks = base.tasks.map((t) =>
      t.id === 15 ? { ...t, linked: 240_000, missing: 360_000 } : { ...t, status: "done" as const, auto: true, linked: t.amount, missing: 0, lastTxAt: "2026-11-10T03:00:00Z" },
    );
    const v = payCycleCard({ ...base, tasks, openCount: 1 }, true)!;
    expect(v.chip).toBe("còn 1");
    expect(v.rows[0]).toMatchObject({ state: "done", title: `✓ Trích Tích luỹ 10% · ${vnd("2.000.000")}`, sub: "tự nhận từ chuyển khoản 10/11", canUndo: false, doneLabel: null });
    expect(v.rows[4]).toMatchObject({ state: "partial", sub: `đã 240.000 / ${vnd("600.000")}`, doneLabel: "Đã chuyển" });
    const all = tasks.map((t) => (t.id === 15 ? { ...t, status: "done" as const, auto: false } : t));
    const done = payCycleCard({ ...base, tasks: all, openCount: 0 }, true)!;
    expect(done).toMatchObject({ chip: null, collapsed: "Việc ngày lương: xong cả 5 việc ✓" });
    expect(done.rows[4]).toMatchObject({ sub: "đánh dấu tay", canUndo: true });
    expect(payCycleCard(base, false)!.offline).toBe("Cần mạng");
  });

  it("UC-702 AC-22: Bỏ qua ① không lý do → khoá gửi, câu 'Không trích kỳ này cần ghi lý do'; việc khác không cần lý do; bỏ qua có lý do → chữ 'Bỏ qua — lý do' + Hoàn tác", () => {
    const [savings, tuitionTask] = cycleC().tasks as [PayCycleTask, PayCycleTask];
    expect(skipProblem(savings, "  ")).toBe("Không trích kỳ này cần ghi lý do");
    expect(skipProblem(savings, "Tháng này trả viện phí")).toBeNull();
    expect(skipProblem(savings, "x".repeat(501))).toBe("Lý do tối đa 500 ký tự.");
    expect(skipProblem(tuitionTask, "")).toBeNull();
    const skipped = { ...savings, status: "skipped" as const, reason: "Tháng này trả viện phí" };
    const v = payCycleCard(cycleC({}, [skipped]), true)!;
    expect(v.rows[0]).toMatchObject({ state: "skipped", sub: "Bỏ qua — Tháng này trả viện phí", canUndo: true, canSkip: false, canEdit: false });
    expect(amountProblem(savings, 0, "")).toBe("Không trích kỳ này cần ghi lý do");
    expect(amountProblem(savings, 3_000_000, "")).toBeNull();
    expect(amountProblem(savings, -1, "")).toBe("Số tiền không hợp lệ.");
    expect(amountProblem(tuitionTask, 0, "")).toBeNull();
  });

  it("UC-702 AC-22: thân yêu cầu done (chỉ đánh dấu, không earmark_id) / skip / reopen / sửa số", () => {
    expect(taskRequest(11, { kind: "done" })).toEqual({ method: "POST", path: "/v1/pay-cycle-tasks/11/done", body: {} });
    expect(taskRequest(15, { kind: "done" }).body).toEqual({});
    expect(taskRequest(11, { kind: "skip", reason: " Tháng này trả viện phí " })).toEqual({ method: "POST", path: "/v1/pay-cycle-tasks/11/skip", body: { reason: "Tháng này trả viện phí" } });
    expect(taskRequest(14, { kind: "skip", reason: "" }).body).toEqual({});
    expect(taskRequest(12, { kind: "reopen" })).toEqual({ method: "POST", path: "/v1/pay-cycle-tasks/12/reopen", body: {} });
    expect(taskRequest(11, { kind: "amount", amount: 3_000_000, reason: "" })).toEqual({ method: "PATCH", path: "/v1/pay-cycle-tasks/11", body: { amount: 3_000_000 } });
  });

  it("UC-702 AC-21: chưa có tài khoản Tích luỹ → ① 'Trích Tích luỹ 10% · chưa có tài khoản Tích luỹ — mở tài khoản thật ›', không QR, Đã làm vẫn có; ② mục tiêu bị bỏ gắn → 'mục tiêu chưa có tài khoản'; dư âm → câu", () => {
    const savings = task({ id: 31, kind: "savings", amount: 2_000_000, pct: 10, toPocket: "savings", source: salary, targets: [], targetName: null });
    const orphan = task({ id: 32, kind: "goal", amount: 760_000, goal: { ...car, held: null, accountId: null } });
    const v = payCycleCard(cycleC({ prevOperating: -300_000 }, [savings, orphan]), true)!;
    expect(v.rows[0]).toMatchObject({ title: "Trích Tích luỹ 10% · chưa có tài khoản Tích luỹ — mở tài khoản thật ›", noSavingsAccount: true, qr: false, qrHint: null, doneLabel: "Đã làm" });
    expect(v.rows[1]).toMatchObject({ sub: "mục tiêu chưa có tài khoản", noSavingsAccount: false, qr: false, doneLabel: "Đã chuyển", canSkip: true });
    expect(v.overspent).toBe(`Kỳ trước tiêu quá ${vnd("300.000")} — không có gì để chia`);
    expect(JSON.stringify(v)).not.toMatch(/để riêng|Chọn tài khoản giữ/);
  });

  it("UC-1206 AC-10: nhà một tài khoản, chưa có tài khoản Tích luỹ, dư kỳ trước 12.000.000 → ④ 'Dư kỳ trước 12.000.000 ₫: 6.000.000 ₫ vào Tích luỹ · chưa có tài khoản Tích luỹ — mở tài khoản thật ›', không QR, chạm → Ba ngăn, Đã làm (tick tay) như ①", () => {
    const savings = task({ id: 41, kind: "savings", amount: 2_000_000, pct: 10, toPocket: "savings", source: salary, targets: [], targetName: null });
    const surplus = task({ id: 42, kind: "surplus", amount: 6_000_000, toPocket: "savings", targets: [], targetName: null });
    const v = payCycleCard(cycleC({ prevOperating: 12_000_000 }, [savings, surplus]), true)!;
    expect(v.rows.map((r) => r.title)).toEqual([
      "Trích Tích luỹ 10% · chưa có tài khoản Tích luỹ — mở tài khoản thật ›",
      `Dư kỳ trước ${vnd("12.000.000")}: ${vnd("6.000.000")} vào Tích luỹ · chưa có tài khoản Tích luỹ — mở tài khoản thật ›`,
    ]);
    expect(v.rows[1]).toMatchObject({ noSavingsAccount: true, qr: false, qrHint: null, doneLabel: "Đã làm", canSkip: true });
    // Tick tay ④ → xong, tiêu đề giữ câu nhắc.
    const done = payCycleCard(cycleC({ prevOperating: 12_000_000 }, [{ ...surplus, status: "done" }]), true)!;
    expect(done.rows[0]).toMatchObject({ state: "done", title: `✓ Dư kỳ trước ${vnd("12.000.000")}: ${vnd("6.000.000")} vào Tích luỹ · chưa có tài khoản Tích luỹ — mở tài khoản thật ›`, sub: "đánh dấu tay", canUndo: true });
  });

  it("UC-504 AC-18: lương về tài khoản riêng tư bị giấu với người xem (source: { hidden: true }) → ① có dòng phụ 'từ khoản lương ở tài khoản riêng tư', số và trạng thái của việc giữ; chủ xem → 'từ lương … ngày …'", () => {
    const hidden = task({ id: 51, kind: "savings", amount: 2_000_000, pct: 10, toPocket: "savings", source: { hidden: true }, targets: [SAVINGS_ACC], targetName: "tài khoản tích luỹ" });
    const tax = task({ id: 52, kind: "goal", amount: 300_000, pct: 10, goal: { id: "tax", name: "Thuế", held: 0, target: null, accountId: "tax-acc" }, toAccountId: "tax-acc", source: { hidden: true } });
    const move = task({ id: 53, kind: "move", amount: 4_000_000, toPocket: "reserve", source: { hidden: true } });
    const v = payCycleCard(cycleC({}, [hidden, tax, move]), true)!;
    expect(v.rows[0]).toMatchObject({ state: "open", title: `Trích Tích luỹ 10% · ${vnd("2.000.000")}`, sub: "từ khoản lương ở tài khoản riêng tư", qr: true });
    // ② theo % thu chịu thuế: không biết số khoản thu → dòng phụ như khi không có nguồn (số đã có của mục tiêu).
    expect(v.rows[1]!.sub).toBe(`đã có ${vnd("0")}`);
    expect(v.rows[2]!.title).toBe(`Chuyển khoản thu sang Dự phòng · ${vnd("4.000.000")}`);
    expect(JSON.stringify(v)).not.toContain("20.000.000");
    const owner = payCycleCard(cycleC({}, [{ ...hidden, source: salary }]), true)!;
    expect(owner.rows[0]!.sub).toBe(`từ lương ${vnd("20.000.000")} ngày 10/11`);
  });

  it("UC-702 AC-26: chưa nguồn nào bật Mở kỳ lương → dòng nhắc; có nguồn / bản lưu cũ thiếu paySetup → không nhắc", () => {
    expect(noCycleStreamLine({ paySetup: { hasCycleStream: false } })).toBe("Chưa có nguồn nào mở kỳ lương — chọn nguồn lương ›");
    expect(noCycleStreamLine({ paySetup: { hasCycleStream: true } })).toBeNull();
    expect(noCycleStreamLine({})).toBeNull();
  });

  it("UC-702 AC-23: thẻ Tích luỹ → 'Kỳ này chưa trích (10% = 2.000.000 ₫)', sau chuyển → 'Kỳ này đã trích ✓ 2.000.000 ₫ (10%)'; chưa có kỳ → không dòng", () => {
    expect(savingsDoneLine(cycleC(), 10)).toBe(`Kỳ này chưa trích (10% = ${vnd("2.000.000")})`);
    expect(savingsDoneLine(cycleC({ savingsDone: { amount: 2_000_000, base: 20_000_000, pct: 10 } }), 10)).toBe(`Kỳ này đã trích ✓ ${vnd("2.000.000")} (10%)`);
    expect(savingsDoneLine(cycleC({ savingsDone: { amount: 0, base: 0, pct: null } }), 10)).toBeNull();
    expect(savingsDoneLine(null, 10)).toBeNull();
  });

  it("UC-702 AC-32: savings_pct 15, hai khoản lương (① 3.000.000 và 1.500.000) → 'Kỳ này đã trích 3.000.000 / 4.500.000 ₫ (15%)', rồi '✓ 4.500.000 ₫ (15%)', chưa chuyển → 'chưa trích (15% = 4.500.000 ₫)'; ① bỏ qua không vào số cần", () => {
    const tasks = [
      task({ id: 31, kind: "savings", amount: 3_000_000, pct: 15, toPocket: "savings", source: salary, targets: [SAVINGS_ACC] }),
      task({ id: 32, kind: "savings", amount: 1_500_000, pct: 15, toPocket: "savings", source: { ...salary, txId: 2, amount: 10_000_000 }, targets: [SAVINGS_ACC] }),
    ];
    const at = (amount: number) => cycleC({ savingsDone: { amount, base: 30_000_000, pct: Math.floor((amount * 100) / 30_000_000) } }, tasks);
    expect(savingsDoneLine(at(3_000_000), 15)).toBe(`Kỳ này đã trích 3.000.000 / ${vnd("4.500.000")} (15%)`);
    expect(savingsDoneLine(at(4_500_000), 15)).toBe(`Kỳ này đã trích ✓ ${vnd("4.500.000")} (15%)`);
    expect(savingsDoneLine(at(0), 15)).toBe(`Kỳ này chưa trích (15% = ${vnd("4.500.000")})`);
    const skipped = cycleC({ savingsDone: { amount: 3_000_000, base: 30_000_000, pct: 10 } }, [tasks[0]!, { ...tasks[1]!, status: "skipped" }]);
    expect(savingsDoneLine(skipped, 15)).toBe(`Kỳ này đã trích ✓ ${vnd("3.000.000")} (15%)`);
    setAmountsHidden(true);
    expect(savingsDoneLine(at(3_000_000), 15)).toBe(`Kỳ này đã trích •••• / ${vnd("••••")} (15%)`);
  });

  it("UC-702 AC-30: hai việc ② cùng MB tiết kiệm → liền nhau dưới dòng 'Chuyển 3.500.000 ₫ vào MB tiết kiệm · 2 mục tiêu' có QR gộp; việc ② tài khoản khác chen giữa bị dời ra sau nhóm; một việc ② một tài khoản không có dòng gộp; che số", () => {
    const v = payCycleCard(sharedCycle(), true)!;
    expect(v.rows.map((r) => r.title)).toEqual([
      `Trích Tích luỹ 10% · ${vnd("2.000.000")}`,
      `Nạp Nhà ở · ${vnd("1.500.000")}`,
      `Nạp Học tập · ${vnd("2.000.000")}`,
      `Nạp Hoá đơn · ${vnd("500.000")}`,
    ]);
    expect(v.goalGroups).toEqual([{ accountId: "tk-tiet-kiem", title: `Chuyển ${vnd("3.500.000")} vào MB tiết kiệm · 2 mục tiêu`, taskIds: [41, 43], qr: true }]);
    const paid = sharedCycle({ 41: 1_500_000, 43: 1_000_000 });
    expect(payCycleCard(paid, true)!.goalGroups).toEqual([]);
    setAmountsHidden(true);
    expect(payCycleCard(sharedCycle(), true)!.goalGroups[0]!.title).toBe(`Chuyển ${vnd("••••")} vào MB tiết kiệm · 2 mục tiêu`);
  });
});

describe("mã QR của việc ngày lương (pocket UC-1206 bước 10)", () => {
  it("UC-1206 AC-6: QR ① → tài khoản tích luỹ, 2.000.000, 'Tich luy ky 10-11'; đã ghép 1.500.000 → 500.000; Ví Thưởng → tài khoản tiết kiệm; chỉ heo đất không số → 'Chuyển sang heo đất'", () => {
    const c = cycleC();
    const [savings, tuitionTask, , , rewardTask] = c.tasks as PayCycleTask[];
    const qr = taskQr(c, savings!);
    expect(qr).toMatchObject({ target: SAVINGS_ACC, amount: 2_000_000, memo: "Tich luy ky 10-11" });
    expect("payload" in qr && qr.payload).toContain("Tich luy ky 10-11");
    expect(taskQr(c, { ...savings!, linked: 1_500_000, missing: 500_000 })).toMatchObject({ amount: 500_000 });
    expect(taskQr(c, rewardTask!)).toMatchObject({ target: RESERVE_ACC, amount: 600_000, memo: "Vi Thuong ky 10-11" });
    expect(taskQr(c, tuitionTask!)).toMatchObject({ target: TUITION_ACC, amount: 2_000_000 });
    expect(taskMemo(c, tuitionTask!)).toBe("Hoc phi ky 10-11");
    expect(taskQr(c, { ...savings!, targets: [], targetName: "heo đất" })).toEqual({ hint: "Chuyển sang heo đất" });
    const v = payCycleCard(cycleC({}, [{ ...savings!, targets: [], targetName: "heo đất" }]), true)!;
    expect(v.rows[0]).toMatchObject({ qr: false, qrHint: "Chuyển sang heo đất" });
    const two = taskQr(c, { ...savings!, targets: [SAVINGS_ACC, { ...SAVINGS_ACC, accountId: "piggy2", name: "heo 2" }] }, "piggy2");
    expect("target" in two && two.target.accountId).toBe("piggy2");
  });

  it("UC-1206 AC-13: QR gộp của MB tiết kiệm → 3.500.000, 'Du phong ky 10-11'; sau chuyển 2.500.000 (Nhà ở xong, Học tập đã 1.000.000) → 1.000.000; việc ② tài khoản khác không vào; QR từng việc vẫn mở được", () => {
    const c = sharedCycle();
    const qr = goalGroupQr(c, "tk-tiet-kiem");
    expect(qr).toMatchObject({ target: SAVING_ACC, amount: 3_500_000, memo: "Du phong ky 10-11" });
    expect("payload" in qr && qr.payload).toContain("Du phong ky 10-11");
    expect(goalGroupQr(sharedCycle({ 41: 1_500_000, 43: 1_000_000 }), "tk-tiet-kiem")).toMatchObject({ amount: 1_000_000 });
    expect(taskQr(c, c.tasks[1]!)).toMatchObject({ target: SAVING_ACC, amount: 1_500_000, memo: "Nha o ky 10-11" });
  });
});

describe("toast sau ghi / gán (pwa UC-706)", () => {
  it("UC-706 AC-33, AC-34: kỳ mới → 'Kỳ lương mới từ 10/11 · 5 việc'; chuyển làm xong ① → 'Đã ghi · Trích Tích luỹ ✓'; không gì → null", () => {
    expect(effectsToast({ cycle: { opened: true, startedAt: "2026-11-10T01:00:00Z", tasks: 5 }, tasksDone: [] })).toBe("Kỳ lương mới từ 10/11 · 5 việc");
    expect(effectsToast({ cycle: null, tasksDone: [{ kind: "savings" }] })).toBe("Đã ghi · Trích Tích luỹ ✓");
    expect(effectsToast({ cycle: null, tasksDone: [] })).toBeNull();
    expect(effectsToast(undefined)).toBeNull();
  });
});
