// Tháng dương lịch thay kỳ lương — hàm thuần (change 261112-thang-thay-ky-luong, ADR-144): pocket UC-1206 (ghép theo mốc,
// đã trích), UC-1207 (dư cuối tháng), ledger UC-103 (lương về sớm, số mỗi ngày, tuổi tiền).
import { describe, expect, it } from "vitest";
import { moneyAge, type MoneyFlow } from "../src/domain/money-age";
import {
  AUTO_MATCH_MIN,
  allocateTransfer,
  earlySalaryPayday,
  heldToPayday,
  monthSurplus,
  nextMonth,
  paydayOf,
  pendingTasks,
  prevMonth,
  savingsAmount,
  savingsDone,
  taskCode,
  taskMemo,
  codesIn,
  taskState,
  type MatchTask,
  type TaskFigures,
} from "../src/domain/month-tasks";
import { nearSpendView } from "../src/domain/snapshot";

const vn = (s: string) => new Date(`${s}+07:00`).toISOString();

describe("tháng VN", () => {
  it("UC-1207 AC-4: tháng trước / sau qua năm, ngày lương kẹp cuối tháng", () => {
    expect([prevMonth("2027-01"), nextMonth("2026-12"), nextMonth("2026-11")]).toEqual(["2026-12", "2027-01", "2026-12"]);
    expect([paydayOf("2027-02", 31), paydayOf("2026-12", 10)]).toEqual(["2027-02-28", "2026-12-10"]);
    expect([savingsAmount(20_000_000, 10), savingsAmount(12_345_678, 10)]).toEqual([2_000_000, 1_235_000]);
  });
});

describe("dư cuối tháng (UC-1207)", () => {
  it("UC-1207 AC-4: ăn tiêu 9.000.000 / 30 ngày, ngày lương 10 → giữ 2.700.000; 9.300.000 → 2.790.000; ngày lương 1 → 0; tháng 28 ngày, ngày lương 31 kẹp 28 → 27 ngày", () => {
    expect(heldToPayday(9_000_000, 30, 10)).toBe(2_700_000);
    expect(heldToPayday(9_300_000, 30, 10)).toBe(2_790_000);
    expect(heldToPayday(9_000_000, 30, 1)).toBe(0);
    expect(heldToPayday(2_800_000, 28, 28)).toBe(2_700_000);
    expect(heldToPayday(1_000_001, 31, 2)).toBe(33_000);
    expect(heldToPayday(-500_000, 30, 10)).toBe(0);
  });

  it("UC-1207 AC-4: S = E − W − L − P − D; 50/50 có Ví Thưởng; chưa chọn Ví Thưởng → chỉ phần Tích luỹ; W, L trừ; 100% / 0%; làm tròn xuống 1.000", () => {
    const base = { E: 12_000_000, W: 0, L: 0, P: 4_500_000, D: 2_700_000, pct: 50, rewardAccount: "mb-reward" };
    expect(monthSurplus(base)).toEqual({ surplus: 4_800_000, savingsAmount: 2_400_000, rewardAmount: 2_400_000 });
    expect(monthSurplus({ ...base, rewardAccount: null })).toEqual({ surplus: 4_800_000, savingsAmount: 2_400_000, rewardAmount: 0 });
    expect(monthSurplus({ ...base, W: 1_500_000 })).toEqual({ surplus: 3_300_000, savingsAmount: 1_650_000, rewardAmount: 1_650_000 });
    expect(monthSurplus({ ...base, E: 32_000_000, L: 20_000_000, D: 0 }).surplus).toBe(7_500_000);
    expect(monthSurplus({ ...base, pct: 100 })).toEqual({ surplus: 4_800_000, savingsAmount: 4_800_000, rewardAmount: 0 });
    expect(monthSurplus({ ...base, pct: 0 })).toEqual({ surplus: 4_800_000, savingsAmount: 0, rewardAmount: 4_800_000 });
    expect(monthSurplus({ ...base, E: 12_001_567, pct: 60 })).toEqual({ surplus: 4_801_567, savingsAmount: 2_880_000, rewardAmount: 1_921_567 });
  });

  it("UC-1207 AC-6: Vận hành cuối tháng 6.000.000, P 4.500.000, D 2.700.000 → tiêu quá 1.200.000, không chia; S = 0 → không chia", () => {
    expect(monthSurplus({ E: 6_000_000, W: 0, L: 0, P: 4_500_000, D: 2_700_000, pct: 50, rewardAccount: "mb-reward" })).toEqual({ surplus: -1_200_000, savingsAmount: 0, rewardAmount: 0 });
    expect(monthSurplus({ E: 7_200_000, W: 0, L: 0, P: 4_500_000, D: 2_700_000, pct: 50, rewardAccount: null })).toEqual({ surplus: 0, savingsAmount: 0, rewardAmount: 0 });
  });
});

describe("ghép chuyển khoản theo mốc (UC-1206)", () => {
  const savingsAcc = { id: "savings", pocket: "savings" };
  const main = { id: "main", pocket: "operating" };
  const task = (o: Partial<MatchTask> & Pick<MatchTask, "id">): MatchTask => ({ toPocket: "savings", toAccountId: null, missing: 2_000_000, since: vn("2026-12-10T08:00:00"), ...o });

  it("UC-1206 AC-17: chuyển khoản trước mốc của nhắc không ghép; sau mốc ghép phần còn thiếu, phần dư không ghép vào việc chia dư có mốc sau chuyển khoản", () => {
    const tasks = [task({ id: 1 }), task({ id: 2, missing: 1_200_000, since: vn("2027-01-01T09:00:00") })];
    expect(allocateTransfer(tasks, { from: main, to: savingsAcc, amount: 1_000_000, available: 1_000_000, at: vn("2026-12-10T07:00:00") })).toEqual([]);
    expect(allocateTransfer(tasks, { from: main, to: savingsAcc, amount: 2_600_000, available: 2_600_000, at: vn("2026-12-10T10:00:00") })).toEqual([{ taskId: 1, amount: 2_000_000 }]);
    expect(allocateTransfer(tasks, { from: main, to: savingsAcc, amount: 2_600_000, available: 2_600_000, at: vn("2027-01-02T10:00:00") })).toEqual([
      { taskId: 1, amount: 2_000_000 },
      { taskId: 2, amount: 600_000 },
    ]);
  });

  it("UC-1206 AC-3: chia dư → Ví Thưởng khớp đúng tài khoản (cả con của nó), không xét ngăn; cùng ngăn Tích luỹ không ghép ①; S = D không ghép", () => {
    const reward = task({ id: 3, toPocket: null, toAccountId: "bonus", missing: 500_000, since: vn("2026-12-01T09:00:00") });
    const at = vn("2026-12-11T09:00:00");
    expect(allocateTransfer([reward], { from: { id: "buffer", pocket: "reserve" }, to: { id: "bonus", pocket: "reserve" }, amount: 800_000, available: 800_000, at })).toEqual([{ taskId: 3, amount: 500_000 }]);
    expect(allocateTransfer([reward], { from: main, to: { id: "bonus-6m", pocket: "reserve", parentId: "bonus" }, amount: 100_000, available: 100_000, at })).toEqual([{ taskId: 3, amount: 100_000 }]);
    expect(allocateTransfer([task({ id: 1 })], { from: { id: "piggy", pocket: "savings" }, to: savingsAcc, amount: 2_000_000, available: 2_000_000, at })).toEqual([]);
    expect(allocateTransfer([task({ id: 1 })], { from: savingsAcc, to: savingsAcc, amount: 2_000_000, available: 2_000_000, at })).toEqual([]);
  });

  it("UC-1206 AC-5: trạng thái việc — tick tay, tự xong khi ghép đủ, ghép thiếu còn thiếu phần còn lại, bỏ qua", () => {
    expect(taskState({ status: "open", amount: 2_000_000 }, 2_000_000)).toEqual({ state: "done", auto: true, missing: 0 });
    expect(taskState({ status: "open", amount: 2_000_000 }, 240_000)).toEqual({ state: "open", auto: false, missing: 1_760_000 });
    expect(taskState({ status: "done", amount: 2_000_000 }, 0)).toEqual({ state: "done", auto: false, missing: 0 });
    expect(taskState({ status: "skipped", amount: 2_000_000 }, 0)).toEqual({ state: "skipped", auto: false, missing: 0 });
  });

  it("UC-1206 AC-17: Tích luỹ tháng 12 = 3.500.000 / 35.000.000, 10%, mức 10–30%; tháng không lương → base 0, mức null; tick tay không cộng; phần chưa làm = Σ còn thiếu của việc đang mở", () => {
    const fig = (o: Partial<TaskFigures>): TaskFigures => ({ kind: "savings", status: "open", amount: 2_000_000, linked: 0, sourceAmount: 20_000_000, ...o });
    expect(savingsDone([fig({ linked: 2_000_000 }), fig({ amount: 1_500_000, linked: 1_500_000, sourceAmount: 15_000_000 })])).toEqual({ amount: 3_500_000, base: 35_000_000, pct: 10, level: "10to30" });
    expect(savingsDone([])).toEqual({ amount: 0, base: 0, pct: null, level: null });
    expect(savingsDone([fig({ status: "done" })])).toEqual({ amount: 0, base: 20_000_000, pct: 0, level: "below1" });
    expect(savingsDone([fig({ status: "skipped" })]).level).toBe("zero");
    expect(savingsDone([fig({})]).level).toBeNull();
    expect(pendingTasks([fig({ linked: 500_000 }), fig({ kind: "surplus", amount: 2_400_000, sourceAmount: null }), fig({ status: "skipped" }), fig({ linked: 2_000_000 })])).toBe(3_900_000);
  });

  it("UC-1206 AC-19: ① và chia dư → Tích luỹ chỉ tự nhận chuyển khoản từ 100.000; chia dư → Ví Thưởng nhận mọi số", () => {
    const at = vn("2026-12-11T09:00:00");
    const piggy = { id: "piggy", pocket: "savings" };
    expect(AUTO_MATCH_MIN).toBe(100_000);
    expect(allocateTransfer([task({ id: 1 })], { from: main, to: piggy, amount: 8_000, available: 8_000, at })).toEqual([]);
    expect(allocateTransfer([task({ id: 1 })], { from: main, to: savingsAcc, amount: 99_999, available: 99_999, at })).toEqual([]);
    expect(allocateTransfer([task({ id: 1 })], { from: main, to: savingsAcc, amount: 100_000, available: 100_000, at })).toEqual([{ taskId: 1, amount: 100_000 }]);
    // Phần còn lại của một chuyển khoản lớn (đã dùng một phần) vẫn được nhận: ngưỡng xét số của chuyển khoản.
    expect(allocateTransfer([task({ id: 1 })], { from: main, to: savingsAcc, amount: 2_600_000, available: 50_000, at })).toEqual([{ taskId: 1, amount: 50_000 }]);
    const reward = task({ id: 3, toPocket: null, toAccountId: "bonus", missing: 500_000, since: vn("2026-12-01T09:00:00") });
    expect(allocateTransfer([reward], { from: main, to: { id: "bonus", pocket: "reserve" }, amount: 8_000, available: 8_000, at })).toEqual([{ taskId: 3, amount: 8_000 }]);
  });
});

describe("lương về sớm và số mỗi ngày (UC-103)", () => {
  it("UC-103 AC-26: ngày lương 10 — lương về 2027-01-05 → 2027-01-10, đếm tới 10/02 = 36 ngày; lương thứ hai 07/01 không đổi gì; chưa có lương → null, 12/12 đếm 29 ngày; ngày lương 5 → luôn null", () => {
    expect(earlySalaryPayday([], "2026-12-12", 10)).toBeNull();
    expect(nearSpendView(21_200_000, "2026-12-12", 10, { salaryPayday: null, pendingTasks: 2_000_000, goalRemaining: 3_500_000 })).toMatchObject({ daysLeft: 29, perDay: 541_000, perMeal: 270_000, perMarket: 540_000 });
    const early = earlySalaryPayday([vn("2027-01-05T08:00:00")], "2027-01-05", 10);
    expect(early).toBe("2027-01-10");
    expect(nearSpendView(21_200_000, "2027-01-05", 10, { salaryPayday: early, pendingTasks: 0 }).daysLeft).toBe(36);
    expect(earlySalaryPayday([vn("2027-01-05T08:00:00"), vn("2027-01-07T08:00:00")], "2027-01-07", 10)).toBe("2027-01-10");
    expect(earlySalaryPayday([vn("2027-01-02T08:00:00")], "2027-01-05", 10)).toBeNull();
    expect(earlySalaryPayday([vn("2027-01-01T08:00:00")], "2027-01-01", 5)).toBeNull();
    expect(nearSpendView(21_200_000, "2027-01-01", 5, { salaryPayday: null, pendingTasks: 0 }).daysLeft).toBe(4);
    // Đúng ngày lương: cửa sổ đã chuyển sang ngày lương tháng sau.
    expect(earlySalaryPayday([vn("2027-01-05T08:00:00")], "2027-01-10", 10)).toBeNull();
  });
});

describe("tuổi tiền (UC-103 AC-27, chỉ đo)", () => {
  const spend = (day: string, amount = 1_000_000): MoneyFlow => ({ at: vn(`${day}T12:00:00`), amount, kind: "spend" });
  const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-11-${String(from + i).padStart(2, "0")}`);
  const opening = { at: vn("2026-11-01T00:00:00"), amount: 10_000_000 };

  it("UC-103 AC-27: lô đầu 10.000.000 ngày 1/11, lương 20.000.000 ngày 10/11, chi 1.000.000 mỗi ngày 2/11–20/11 → 10 khoản gần nhất tuổi 10, 2…10 → 6 ngày, chưa đủ đệm", () => {
    const flows: MoneyFlow[] = [...days(2, 9).map((d) => spend(d)), { at: vn("2026-11-10T08:00:00"), amount: 20_000_000, kind: "in" }, ...days(10, 20).map((d) => spend(d))];
    expect(moneyAge(opening, flows)).toEqual({ days: 6, sample: 10, buffered: false });
  });

  it("UC-103 AC-27: khoản chi tiêu hai lô lấy trung bình theo số tiền; chuyển sang Tích luỹ tiêu lô nhưng không vào mẫu; hoàn tiền là lô mới; hàng đợi cạn → tuổi 0 và nợ, lô sau trả nợ trước; chưa đủ 10 khoản → null; ≥ 30 ngày → đủ đệm", () => {
    // 9 khoản 1.000.000 (ngày 2–10) để lô đầu còn 1.000.000; lương 20tr ngày 9; khoản 3.000.000 ngày 11: 1tr tuổi 10 + 2tr tuổi 2.
    const mixed: MoneyFlow[] = [...days(2, 8).map((d) => spend(d)), { at: vn("2026-11-09T07:00:00"), amount: 20_000_000, kind: "in" }, spend("2026-11-09"), spend("2026-11-10"), spend("2026-11-11", 3_000_000)];
    const ages = [1, 2, 3, 4, 5, 6, 7, 8, 9, (1_000_000 * 10 + 2_000_000 * 2) / 3_000_000];
    expect(moneyAge(opening, mixed)).toEqual({ days: Math.floor(ages.reduce((s, a) => s + a, 0) / 10), sample: 10, buffered: false });
    expect(moneyAge(opening, mixed.slice(0, -1))).toBeNull();

    // Chuyển 5.000.000 sang Tích luỹ ngày 2 tiêu lô đầu; hoàn 200.000 ngày 3 là lô mới; chi khi cạn → tuổi 0, nợ.
    const drained: MoneyFlow[] = [
      { at: vn("2026-11-02T08:00:00"), amount: 5_000_000, kind: "out" },
      { at: vn("2026-11-03T08:00:00"), amount: 200_000, kind: "in" },
      spend("2026-11-04", 5_200_000), // tiêu 5.000.000 lô đầu (tuổi 3) + 200.000 hoàn (tuổi 1)
      spend("2026-11-05", 500_000), // cạn → tuổi 0, nợ 500.000
      { at: vn("2026-11-06T08:00:00"), amount: 10_500_000, kind: "in" }, // trả nợ 500.000 trước, còn lô 10.000.000
      ...days(7, 14).map((d) => spend(d)),
    ];
    const first = (5_000_000 * 3 + 200_000 * 1) / 5_200_000;
    const later = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(moneyAge(opening, drained)).toEqual({ days: Math.floor((first + 0 + later.reduce((s, a) => s + a, 0)) / 10), sample: 10, buffered: false });

    const old = { at: vn("2026-09-01T00:00:00"), amount: 50_000_000 };
    expect(moneyAge(old, days(1, 10).map((d) => spend(d)))).toEqual({ days: 65, sample: 10, buffered: true });
    expect(moneyAge({ at: vn("2026-10-02T00:00:00"), amount: 50_000_000 }, days(1, 10).map((d) => spend(d)))!.buffered).toBe(true);
  });
});

describe("mã việc trong nội dung chuyển khoản (UC-1206 AC-20)", () => {
  it("UC-1206 AC-20: mã 4 ký tự chữ hoa / số, không 0 O 1 I, mỗi việc một mã khác nhau; nội dung QR '{TL|CD|VT} {mã} T{tháng}', không chữ 'TICH LUY'; đọc lại được mã kèm tháng từ nội dung ngân hàng (thêm chữ, viết thường, bỏ dấu cách); thiếu hậu tố tháng thì không đọc là mã", () => {
    const codes = Array.from({ length: 5000 }, (_, i) => taskCode(i + 1));
    expect(new Set(codes).size).toBe(5000);
    for (const c of codes) expect(c).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);
    const code = taskCode(7);
    expect(taskMemo({ kind: "savings", toAccountId: null, month: "2026-11", code })).toBe(`TL ${code} T11`);
    expect(taskMemo({ kind: "surplus", toAccountId: null, month: "2026-12", code })).toBe(`CD ${code} T12`);
    expect(taskMemo({ kind: "surplus", toAccountId: "bonus", month: "2026-12", code })).toBe(`VT ${code} T12`);
    expect(taskMemo({ kind: "savings", toAccountId: null, month: "2026-11", code }).toUpperCase()).not.toMatch(/TICH LUY/);
    expect(codesIn(`MBVCB.1234.TL ${code} T11.CT tu 0011 NGUYEN VAN A`)).toContainEqual({ prefix: "TL", code, month: 11 });
    expect(codesIn(`mbvcb tl${code.toLowerCase()}t12`)).toContainEqual({ prefix: "TL", code, month: 12 });
    expect(codesIn(`VT-${code}-T1 CK`)).toContainEqual({ prefix: "VT", code, month: 1 });
    expect(codesIn(`VT-${code}`)).toEqual([]);
    expect(codesIn(`VT${code}CAB THANH TOAN`)).toEqual([]);
    expect(codesIn(`TL ${code} T13`)).toEqual([]);
    expect(codesIn("CHUYEN TIEN AN TRUA")).toEqual([]);
    expect(codesIn(null)).toEqual([]);
  });
});
