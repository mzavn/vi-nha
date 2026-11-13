// Nhìn lại theo tháng qua API (ledger UC-108, pocket UC-1204, debt UC-901 AC-10, ledger UC-104 → 410, ledger UC-111 AC-19;
// ADR-144). Hộ mẫu D: hôm nay 2026-11-25; chi tháng 10 và tháng 11 như các kỳ cũ (mọi khoản nằm gọn trong tháng của nó).
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(D_NOW);
  db = householdD();
  call = client(db);
});
afterEach(() => vi.useRealTimers());

describe("Nhìn lại theo tháng: GET /v1/spend-by-category", () => {
  it("UC-108 AC-8: không tham số → tháng 2026-11 (30 ngày, ngày 25), nhóm theo thứ tự, chưa xếp nhóm, Lãi vay, trả gốc ngoài, tổng 11.050.000; chi lúc 05/11 thuộc tháng 11; period=2026-10 có next 2026-11; cycle → 400 model_changed", async () => {
    spend(db, { at: "2026-11-05T12:00", amount: 100_000, category: "groceries" });
    const d = await data();
    expect(d).toMatchObject({ kind: "month", month: "2026-11", previous: "2026-10", next: null, days: 30, daysElapsed: 25 });
    expect(d).not.toHaveProperty("cycle");
    expect(d.groups.map((g: { name: string; spent: number; previousSpent: number }) => [g.name, g.spent, g.previousSpent])).toEqual([
      ["Ăn uống", 2_600_000, 2_800_000],
      ["Đi lại", 450_000, 700_000],
      ["Học phí", 6_000_000, 0],
      ["Mua sắm", 1_200_000, 600_000],
    ]);
    expect(group(d, "Ăn uống").categories.map((c) => [c.categoryId, c.spent])).toEqual([
      ["groceries", 1_900_000],
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
    expect([d.total, d.previousTotal]).toEqual([11_050_000, 4_400_000]);
    expect(d.categories[0]).toMatchObject({ categoryId: "school-fees", spent: 6_000_000 });
    expect(d.categories.some((c: { categoryId: string }) => c.categoryId === "debt-payment" || c.categoryId === "loan-interest")).toBe(false);

    const oct = await data("?period=2026-10");
    expect(oct).toMatchObject({ kind: "month", month: "2026-10", previous: "2026-09", next: "2026-11", days: 31, daysElapsed: 31 });
    expect(group(oct, "Ăn uống").spent).toBe(2_800_000);
    expect(await data("?period=2026-12")).toMatchObject({ next: null, days: 31, daysElapsed: 0 });

    const old = await get("?cycle=2026-11-10");
    expect([old.status, old.json.error?.code, old.json.error?.fields]).toEqual([400, "model_changed", ["cycle"]]);
  });

  it("UC-901 AC-10: khoản 0% \"Vay người nhà\" không có dòng lãi; khoản đã tắt có chi lãi trong tháng vẫn có dòng với dự kiến 0", async () => {
    expect((await data()).interest.lines.map((l: { debtId: string }) => l.debtId)).toEqual(["vay-tieu-dung"]);
    db.exec("UPDATE debts SET active = 0 WHERE id = 'vay-tieu-dung'");
    expect((await data()).interest.lines).toEqual([{ debtId: "vay-tieu-dung", name: "Vay tiêu dùng", expected: 0, paid: 300_000, dueDay: 5 }]);
  });

  it("UC-1204 AC-3: hạn mức mềm mỗi tháng — Ăn uống 83%, Đi lại 56%, Mua sắm 120% vượt 200.000, Học phí không hạn mức; đổi hạn mức thì tháng đã qua cũng so số mới", async () => {
    const d = await data();
    expect(fig(group(d, "Ăn uống"))).toEqual({ limit: 3_000_000, spent: 2_500_000, pct: 83, left: 500_000, over: 0 });
    expect(fig(group(d, "Đi lại"))).toEqual({ limit: 800_000, spent: 450_000, pct: 56, left: 350_000, over: 0 });
    expect(fig(group(d, "Mua sắm"))).toEqual({ limit: 1_000_000, spent: 1_200_000, pct: 120, left: 0, over: 200_000 });
    expect(fig(group(d, "Học phí"))).toMatchObject({ limit: null, pct: null });
    db.exec("UPDATE category_groups SET monthly_limit = 1500000 WHERE id = 'd-shopping'");
    expect(fig(group(await data(), "Mua sắm"))).toMatchObject({ pct: 80, over: 0 });
    expect(fig(group(await data("?period=2026-10"), "Mua sắm"))).toMatchObject({ limit: 1_500_000, spent: 600_000, pct: 40 });
  });

  it("UC-1204 AC-4: gộp theo cấu hình hiện tại — Quà tặng vào Mua sắm (cả tháng trước), danh mục đã tắt vẫn hiện, hoàn lớn hơn chi không ra số âm ở pct / left / over", async () => {
    db.exec("UPDATE categories SET group_id = 'd-shopping' WHERE id = 'gifts'; UPDATE categories SET active = 0 WHERE id = 'shopping'");
    spend(db, { at: "2026-11-20T10:00", amount: 2_000_000, category: "fuel-parking", meaning: "refund" });
    spend(db, { at: "2026-10-20T10:00", amount: 100_000, category: "gifts" });
    const d = await data();
    expect(fig(group(d, "Mua sắm"))).toEqual({ limit: 1_000_000, spent: 1_700_000, pct: 170, left: 0, over: 700_000 });
    expect(group(d, "Mua sắm").categories.map((c) => c.categoryId)).toEqual(["shopping", "gifts"]);
    expect(d.ungrouped.categories).toEqual([]);
    expect(fig(group(d, "Đi lại"))).toEqual({ limit: 800_000, spent: -1_550_000, pct: 0, left: 800_000, over: 0 });
    expect(group(await data("?period=2026-10"), "Mua sắm").spent).toBe(700_000);
  });

  it("UC-108 AC-9: nhóm Ăn uống monthly_limit 6.000.000, tháng 11 chi 5.100.000 → pct 85, còn 900.000; tháng 10 cũng so 6.000.000", async () => {
    db.exec("UPDATE category_groups SET monthly_limit = 6000000 WHERE id = 'd-food'");
    spend(db, { at: "2026-11-21T12:00", amount: 2_600_000, category: "groceries" });
    expect(fig(group(await data(), "Ăn uống"))).toEqual({ limit: 6_000_000, spent: 5_100_000, pct: 85, left: 900_000, over: 0 });
    expect(fig(group(await data("?period=2026-10"), "Ăn uống"))).toMatchObject({ limit: 6_000_000, pct: 46 });
  });

  it("UC-108 AC-6: tài khoản riêng tư của người vợ — tổng có cả khoản chi đó; Sổ lọc danh mục trong tháng thì không thấy", async () => {
    db.exec("UPDATE accounts SET private = 1 WHERE id = 'ewallet'");
    spend(db, { at: "2026-11-20T12:00", amount: 300_000, category: "eating-out", account: "ewallet" });
    expect(group(await data(), "Ăn uống").spent).toBe(2_800_000);
    const list = await call("GET", "/v1/transactions?month=2026-11&category_id=eating-out");
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
  it("UC-104: GET /v1/budget → 410 model_changed, chỉ sang Chi tiêu", async () => {
    const r = await call("GET", "/v1/budget?period=2026-11");
    expect([r.status, r.json.error?.code]).toEqual([410, "model_changed"]);
    expect(r.json.error?.message).toBe("Ví nhà v2 đã bỏ ngân sách theo ví: xem `GET /v1/spend-by-category` (Chi tiêu theo tháng).");
  });
});

describe("Sổ giao dịch lọc theo tháng", () => {
  it("UC-111 AC-19: Ăn ngoài 400.000 lúc 31/10 23:30 VN và 700.000 trong tháng 11 → summary month=2026-11 + eating-out: spend 700.000 = Nhìn lại tháng 11; cycle → 400 model_changed ở danh sách và tổng", async () => {
    spend(db, { at: "2026-10-31T23:30", amount: 400_000, category: "eating-out" });
    const sum = (q: string) => call("GET", `/v1/transactions/summary?${q}`);
    const nov = await sum("month=2026-11&category_id=eating-out");
    const look = group(await data(), "Ăn uống").categories.find((c) => c.categoryId === "eating-out");
    expect(nov.json.data.spend).toBe(700_000);
    expect(look?.spent).toBe(700_000);
    expect((await sum("month=2026-10&category_id=eating-out")).json.data.spend).toBe(400_000);
    for (const path of ["/v1/transactions/summary?cycle=2026-11-10", "/v1/transactions?cycle=2026-11-10&category_id=eating-out"]) {
      const r = await call("GET", path);
      expect([r.status, r.json.error?.code, r.json.error?.fields]).toEqual([400, "model_changed", ["cycle"]]);
    }
  });
});

describe("Tích luỹ của từng tháng trong Nhìn lại (ledger UC-108, ADR-142, ADR-144)", () => {
  it("UC-108 AC-7: tháng 10 (lương 30.000.000, đã trích 3.000.000) → savings { 3.000.000, 30.000.000, 10, 10to30 }; tháng 11 bỏ qua ① có lý do → { 0, 20.000.000, zero, lý do }; tháng không có lương → null", async () => {
    db.exec(`
      UPDATE transactions SET amount = 30000000 WHERE id = 1;
      INSERT INTO transactions (id, at, amount, meaning, account_id, counter_account_id, week_key, month_key, source)
        VALUES (300, '${AT("2026-10-10T10:00")}', 3000000, 'transfer', 'main', 'savings', '2026-W41', '2026-10', 'manual');
      INSERT INTO month_tasks (id, kind, month_key, income_tx_id, to_pocket, amount, pct, status) VALUES (901, 'savings', '2026-10', 1, 'savings', 3000000, 10, 'open');
      INSERT INTO month_task_tx (task_id, tx_id, amount) VALUES (901, 300, 3000000);
      INSERT INTO month_tasks (id, kind, month_key, income_tx_id, to_pocket, amount, pct, status, reason)
        VALUES (902, 'savings', '2026-11', 20, 'savings', 2000000, 10, 'skipped', 'Tháng này trả viện phí');
    `);
    expect((await data("?period=2026-10")).savings).toEqual({ amount: 3_000_000, base: 30_000_000, pct: 10, level: "10to30", reason: null });
    expect((await data()).savings).toMatchObject({ amount: 0, base: 20_000_000, level: "zero", reason: "Tháng này trả viện phí" });
    expect((await data("?period=2026-09")).savings).toBeNull();
  });

  it("UC-108 AC-8: savings tháng 11 theo nhắc ① của lương 20.000.000 (chuyển 2.000.000 sang Tích luỹ → 10%); tháng 10 có savings riêng", async () => {
    db.exec(`
      INSERT INTO month_tasks (id, kind, month_key, income_tx_id, to_pocket, amount, pct, status) VALUES (903, 'savings', '2026-11', 20, 'savings', 2000000, 10, 'open');
      INSERT INTO month_tasks (id, kind, month_key, income_tx_id, to_pocket, amount, pct, status) VALUES (904, 'savings', '2026-10', 1, 'savings', 1500000, 10, 'open');
    `);
    await call("POST", "/v1/transactions", { meaning: "transfer", amount: 2_000_000, account_id: "main", to_account_id: "savings", at: AT("2026-11-20T09:00") });
    expect((await data()).savings).toMatchObject({ amount: 2_000_000, base: 20_000_000, level: "10to30" });
    expect((await data("?period=2026-10")).savings).toMatchObject({ amount: 0, base: 15_000_000 });
  });
});
