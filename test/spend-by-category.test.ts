// Nhìn lại theo kỳ lương qua API (ledger UC-108, pocket UC-1204, debt UC-901 AC-10, ledger UC-104 → 410, ledger UC-111
// AC-17). Hộ mẫu D: hôm nay 2026-11-25, kỳ lưu 2026-10-10 và 2026-11-10.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { LookBackGroup } from "../src/domain/look-back";
import { AT, client } from "./helpers/household-c";
import { D_NOW, householdD, spend } from "./helpers/household-d";

let db: DatabaseSync;
let call: ReturnType<typeof client>;
const get = async (q = "", as = "husband") => call("GET", `/v1/spend-by-category${q}`, undefined, as);
const data = async (q = "") => (await get(q)).json.data;
const group = (d: { groups: LookBackGroup[] }, name: string) => d.groups.find((g) => g.name === name)!;
const fig = (g: LookBackGroup) => ({ limit: g.limit, spent: g.spent, pct: g.pct, left: g.left, over: g.over });
/** Ăn ngoài 400.000 lúc 2026-10-10 07:30 — trước lúc lương mở kỳ 2026-10-10 (UC-108 AC-5). */
const earlyMeal = () => spend(db, { at: "2026-10-10T07:30", amount: 400_000, category: "eating-out" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(D_NOW);
  db = householdD();
  call = client(db);
});
afterEach(() => vi.useRealTimers());

describe("Nhìn lại theo kỳ lương: GET /v1/spend-by-category", () => {
  it("UC-108 AC-4: không tham số → kỳ lưu 2026-11-10 (30 ngày, ngày 16), nhóm theo thứ tự, chưa xếp nhóm, Lãi vay, trả gốc ngoài, tổng 10.950.000", async () => {
    const d = await data();
    expect(d.kind).toBe("cycle");
    expect(d.cycle).toEqual({ payday: "2026-11-10", start: AT("2026-11-10T08:00"), end: null, stored: true, days: 30, daysElapsed: 16 });
    expect(d.previous).toMatchObject({ payday: "2026-10-10", start: AT("2026-10-10T08:00"), end: AT("2026-11-10T08:00"), stored: true });
    expect(d.next).toBeNull();
    expect(d.groups.map((g: { name: string; spent: number; previousSpent: number }) => [g.name, g.spent, g.previousSpent])).toEqual([
      ["Ăn uống", 2_500_000, 2_800_000],
      ["Đi lại", 450_000, 700_000],
      ["Học phí", 6_000_000, 0],
      ["Mua sắm", 1_200_000, 600_000],
    ]);
    expect(group(d, "Ăn uống").categories.map((c) => [c.categoryId, c.spent])).toEqual([
      ["groceries", 1_800_000],
      ["eating-out", 700_000],
    ]);
    expect(group(d, "Ăn uống").essential).toBe(true);
    expect(d.ungrouped).toMatchObject({ spent: 500_000, previousSpent: 0 });
    expect(d.ungrouped.categories.map((c: { name: string }) => c.name)).toEqual(["Quà tặng"]);
    expect(d.interest).toEqual({
      spent: 300_000,
      previousSpent: 300_000,
      expected: 300_000,
      lines: [{ debtId: "vay-tieu-dung", name: "Vay tiêu dùng", expected: 300_000, paid: 300_000, dueDay: 5 }],
    });
    expect(d.excluded).toEqual({ debtPrincipal: 2_000_000 });
    expect([d.total, d.previousTotal]).toEqual([10_950_000, 4_400_000]);
    expect(d.categories[0]).toMatchObject({ categoryId: "school-fees", spent: 6_000_000 });
    expect(d.categories.some((c: { categoryId: string }) => c.categoryId === "debt-payment" || c.categoryId === "loan-interest")).toBe(false);
  });

  it("UC-901 AC-10: khoản 0% \"Vay người nhà\" không có dòng lãi; khoản đã tắt có chi lãi trong kỳ vẫn có dòng với dự kiến 0", async () => {
    expect((await data()).interest.lines.map((l: { debtId: string }) => l.debtId)).toEqual(["vay-tieu-dung"]);
    db.exec("UPDATE debts SET active = 0 WHERE id = 'vay-tieu-dung'");
    expect((await data()).interest.lines).toEqual([{ debtId: "vay-tieu-dung", name: "Vay tiêu dùng", expected: 0, paid: 300_000, dueDay: 5 }]);
  });

  it("UC-1204 AC-3: hạn mức mềm — Ăn uống 83%, Đi lại 56%, Mua sắm 120% vượt 200.000, Học phí không hạn mức; đổi hạn mức thì kỳ đã qua cũng so số mới", async () => {
    const d = await data();
    expect(fig(group(d, "Ăn uống"))).toEqual({ limit: 3_000_000, spent: 2_500_000, pct: 83, left: 500_000, over: 0 });
    expect(fig(group(d, "Đi lại"))).toEqual({ limit: 800_000, spent: 450_000, pct: 56, left: 350_000, over: 0 });
    expect(fig(group(d, "Mua sắm"))).toEqual({ limit: 1_000_000, spent: 1_200_000, pct: 120, left: 0, over: 200_000 });
    expect(fig(group(d, "Học phí"))).toMatchObject({ limit: null, pct: null });
    db.exec("UPDATE category_groups SET cycle_limit = 1500000 WHERE id = 'd-shopping'");
    expect(fig(group(await data(), "Mua sắm"))).toMatchObject({ pct: 80, over: 0 });
    expect(fig(group(await data("?cycle=2026-10-10"), "Mua sắm"))).toMatchObject({ limit: 1_500_000, spent: 600_000, pct: 40 });
  });

  it("UC-1204 AC-4: gộp theo cấu hình hiện tại — Quà tặng vào Mua sắm (cả kỳ trước), danh mục đã tắt vẫn hiện, hoàn lớn hơn chi không ra số âm ở pct / left / over", async () => {
    db.exec("UPDATE categories SET group_id = 'd-shopping' WHERE id = 'gifts'; UPDATE categories SET active = 0 WHERE id = 'shopping'");
    spend(db, { at: "2026-11-20T10:00", amount: 2_000_000, category: "fuel-parking", meaning: "refund" });
    spend(db, { at: "2026-10-20T10:00", amount: 100_000, category: "gifts" });
    const d = await data();
    expect(fig(group(d, "Mua sắm"))).toEqual({ limit: 1_000_000, spent: 1_700_000, pct: 170, left: 0, over: 700_000 });
    expect(group(d, "Mua sắm").categories.map((c) => c.categoryId)).toEqual(["shopping", "gifts"]);
    expect(d.ungrouped.categories).toEqual([]);
    expect(fig(group(d, "Đi lại"))).toEqual({ limit: 800_000, spent: -1_550_000, pct: 0, left: 800_000, over: 0 });
    expect(group(await data("?cycle=2026-10-10"), "Mua sắm").spent).toBe(700_000);
  });

  it("UC-108 AC-5: chọn kỳ lưu / kỳ danh nghĩa; khoản 07:30 thuộc kỳ danh nghĩa 2026-09-10", async () => {
    earlyMeal();
    const oct = await data("?cycle=2026-10-10");
    expect(oct.cycle).toMatchObject({ payday: "2026-10-10", stored: true, days: 31, daysElapsed: 31, end: AT("2026-11-10T08:00") });
    expect(oct.previous).toEqual({ payday: "2026-09-10", start: AT("2026-09-10T00:00"), end: AT("2026-10-10T08:00"), stored: false });
    expect(oct.next).toMatchObject({ payday: "2026-11-10", stored: true });
    expect(group(oct, "Ăn uống").spent).toBe(2_800_000);
    const sep = await data("?cycle=2026-09-10");
    expect(sep.cycle).toMatchObject({ payday: "2026-09-10", stored: false, start: AT("2026-09-10T00:00") });
    expect(group(sep, "Ăn uống").spent).toBe(400_000);
    expect(sep.previous).toBeNull();
  });

  it("UC-108 AC-5: cycle sai dạng / không phải ngày lương / chưa tới → 400 invalid_cycle; cycle + period → 400 invalid_input", async () => {
    for (const [q, msg] of [
      ["?cycle=10-11-2026", "Kỳ phải là ngày lương dạng 2026-11-10."],
      ["?cycle=2026-09-11", "Không có kỳ lương bắt đầu ngày này."],
      ["?cycle=2026-12-10", "Không có kỳ lương bắt đầu ngày này."],
      ["?cycle=2026-11-11", "Không có kỳ lương bắt đầu ngày này."],
    ] as const) {
      const r = await get(q);
      expect([q, r.status, r.json.error?.code, r.json.error?.message]).toEqual([q, 400, "invalid_cycle", msg]);
    }
    const both = await get("?cycle=2026-11-10&period=2026-11");
    expect([both.status, both.json.error?.code]).toEqual([400, "invalid_input"]);
  });

  it("UC-108 AC-5: huỷ khoản lương mở kỳ 2026-11-10 → kỳ 2026-10-10 kéo tới bây giờ; cycle=2026-11-10 → invalid_cycle", async () => {
    expect((await call("POST", "/v1/transactions/20/void")).status).toBe(200);
    const d = await data();
    expect(d.cycle).toMatchObject({ payday: "2026-10-10", end: null, stored: true });
    expect(group(d, "Ăn uống").spent).toBe(2_800_000 + 2_500_000);
    expect((await get("?cycle=2026-11-10")).json.error?.code).toBe("invalid_cycle");
  });

  it("UC-108 AC-5: chưa có kỳ lưu nào → kỳ danh nghĩa 2026-11-10 từ 00:00 VN", async () => {
    db.exec("UPDATE pay_cycles SET status = 'void'");
    const d = await data();
    expect(d.cycle).toMatchObject({ payday: "2026-11-10", start: AT("2026-11-10T00:00"), end: null, stored: false, days: 30, daysElapsed: 16 });
    expect(d.previous).toMatchObject({ payday: "2026-10-10", stored: false });
  });

  it("UC-108 AC-5: lương đầu tiên về trễ — kỳ danh nghĩa 2026-10-10 chạy tới 02/12 08:00; kỳ lưu 2026-11-10 8 ngày, ngày 12/12 trễ 2 ngày", async () => {
    db.exec("UPDATE pay_cycles SET status = 'void'");
    db.prepare(
      "INSERT INTO transactions (id, at, amount, meaning, counter_account_id, income_stream_id, week_key, month_key, source) VALUES (50, ?, 20000000, 'income', 'main', 'salary', '2026-W49', '2026-12', 'manual')",
    ).run(AT("2026-12-02T08:00"));
    db.prepare("INSERT INTO pay_cycles (income_tx_id, started_at, payday, prev_operating) VALUES (50, ?, '2026-11-10', 0)").run(AT("2026-12-02T08:00"));
    vi.setSystemTime(new Date(AT("2026-12-05T10:00")));
    const d = await data("?cycle=2026-11-10");
    expect(d.cycle).toMatchObject({ payday: "2026-11-10", start: AT("2026-12-02T08:00"), stored: true, days: 8, daysElapsed: 4 });
    expect(d.previous).toEqual({ payday: "2026-10-10", start: AT("2026-10-10T00:00"), end: AT("2026-12-02T08:00"), stored: false });
    vi.setSystemTime(new Date(AT("2026-12-12T10:00")));
    expect((await data()).cycle).toMatchObject({ days: 8, daysElapsed: 8, lateDays: 2 });
  });

  it("UC-108 AC-5: lương sớm — kỳ 2026-12-10 mở 04/12 08:00, ngày 05/12 → 37 ngày, ngày thứ 2", async () => {
    db.prepare(
      "INSERT INTO transactions (id, at, amount, meaning, counter_account_id, income_stream_id, week_key, month_key, source) VALUES (51, ?, 20000000, 'income', 'main', 'salary', '2026-W49', '2026-12', 'manual')",
    ).run(AT("2026-12-04T08:00"));
    db.prepare("INSERT INTO pay_cycles (income_tx_id, started_at, payday, prev_operating) VALUES (51, ?, '2026-12-10', 0)").run(AT("2026-12-04T08:00"));
    vi.setSystemTime(new Date(AT("2026-12-05T10:00")));
    expect((await data()).cycle).toMatchObject({ payday: "2026-12-10", days: 37, daysElapsed: 2 });
  });

  it("UC-108 AC-5: period=2026-11 → tháng lịch, mọi hạn mức null, lãi dự kiến 300.000", async () => {
    const d = await data("?period=2026-11");
    expect(d.kind).toBe("month");
    expect([d.month, d.previous]).toEqual(["2026-11", "2026-10"]);
    for (const g of d.groups) expect(fig(g)).toMatchObject({ limit: null, pct: null, left: null, over: null });
    expect(d.interest).toMatchObject({ expected: 300_000, spent: 300_000, previousSpent: 300_000 });
    expect(d.excluded.debtPrincipal).toBe(2_000_000);
  });

  it("UC-108 AC-6: tài khoản riêng tư của người vợ — tổng có cả khoản chi đó; Sổ lọc danh mục trong kỳ thì không thấy", async () => {
    db.exec("UPDATE accounts SET private = 1 WHERE id = 'ewallet'");
    spend(db, { at: "2026-11-20T12:00", amount: 300_000, category: "eating-out", account: "ewallet" });
    expect(group(await data(), "Ăn uống").spent).toBe(2_800_000);
    const list = await call("GET", "/v1/transactions?cycle=2026-11-10&category_id=eating-out");
    expect(list.json.data.map((t: { amount: number }) => t.amount)).toEqual([700_000]);
  });
});

describe("tháng lịch (UC-108 AC-1…3, giữ)", () => {
  it("UC-108 AC-1: chi ròng theo danh mục có cột tháng trước", async () => {
    db.exec("UPDATE transactions SET status = 'void' WHERE meaning IN ('spend', 'refund')");
    const g = spend(db, { at: "2026-09-12T10:00", amount: 400_000, category: "groceries" });
    spend(db, { at: "2026-09-13T10:00", amount: 100_000, category: "groceries", meaning: "refund", linkId: g });
    spend(db, { at: "2026-08-12T10:00", amount: 200_000, category: "groceries" });
    const d = await data("?period=2026-09");
    expect(d.previous).toBe("2026-08");
    expect(d.categories.find((c: { categoryId: string }) => c.categoryId === "groceries")).toMatchObject({ spent: 300_000, previousSpent: 200_000 });
  });

  it("UC-108 AC-2: tháng 1 so với tháng 12 năm trước", async () => {
    expect((await data("?period=2027-01")).previous).toBe("2026-12");
  });

  it("UC-108 AC-3: tháng sai dạng → 400 invalid_period", async () => {
    const r = await get("?period=2026-13");
    expect([r.status, r.json.error?.code]).toEqual([400, "invalid_period"]);
  });
});

describe("Ngân sách theo ví đã bỏ", () => {
  it("UC-104: GET /v1/budget → 410 model_changed, chỉ sang Nhìn lại", async () => {
    const r = await call("GET", "/v1/budget?period=2026-11");
    expect([r.status, r.json.error?.code]).toEqual([410, "model_changed"]);
    expect(r.json.error?.message).toBe("Ví nhà v2 đã bỏ ngân sách theo ví: xem `GET /v1/spend-by-category` (Nhìn lại theo kỳ lương).");
  });
});

describe("Sổ giao dịch lọc đúng kỳ lương", () => {
  it("UC-111 AC-17: cycle dùng mốc giờ của kỳ — khoản 07:30 ở kỳ 10/9, không ở kỳ 10/10; cycle sai → invalid_cycle; cycle + from → invalid_input", async () => {
    earlyMeal();
    spend(db, { at: "2026-10-20T12:00", amount: 150_000, category: "eating-out" });
    const sum = (q: string) => call("GET", `/v1/transactions/summary?${q}`);
    const oct = await sum("cycle=2026-10-10&category_id=eating-out");
    const look = group(await data("?cycle=2026-10-10"), "Ăn uống").categories.find((c) => c.categoryId === "eating-out");
    expect(oct.json.data.spend).toBe(150_000);
    expect(look?.spent).toBe(150_000);
    expect((await sum("cycle=2026-09-10&category_id=eating-out")).json.data.spend).toBe(400_000);
    const bad = await sum("cycle=2026-09-11");
    expect([bad.status, bad.json.error?.code]).toEqual([400, "invalid_cycle"]);
    const both = await sum("cycle=2026-10-10&from=2026-10-01");
    expect([both.status, both.json.error?.code]).toEqual([400, "invalid_input"]);
    const both2 = await sum("cycle=2026-10-10&from_date=2026-10-01");
    expect([both2.status, both2.json.error?.code]).toEqual([400, "invalid_input"]);
  });
});
