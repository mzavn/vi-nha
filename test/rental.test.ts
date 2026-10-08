import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monthDraft, sharePerHead } from "../src/domain/rental";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T05:00:00.000Z"));
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});
afterEach(() => vi.useRealTimers());

type Json = { ok: boolean; data: any; error?: { code: string; message: string } };

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

/** Tiền người thuê trả = income mang tenant_id (không phải dòng sổ). */
function payment(amount: number, at = "2026-10-10T03:00:00.000Z"): number {
  const r = raw
    .prepare(
      `INSERT INTO transactions (at, amount, meaning, wallet_id, counter_account_id, week_key, month_key, source, tenant_id)
       VALUES (?, ?, 'income', 'income', 'vcb-husband', '2026-W41', ?, 'manual', 'tenant-binh')`,
    )
    .run(at, amount, at.slice(0, 7));
  return Number(r.lastInsertRowid);
}

const balance = async () => (await call("GET", "/v1/rental")).json.data.tenants.find((t: any) => t.id === "tenant-binh").balance;

/** Ví dụ trong proposal: Anh Bình, 4 phí cố định, hộ chi ăn 7.300.000 + điện nước 560.000, Anh Bình đi chợ 300.000. */
async function seedExample() {
  expect((await call("POST", "/v1/rental/tenants", { id: "tenant-binh", name: "Anh Bình" })).status).toBe(201);
  for (const [name, amount] of [["Nhà", 2_500_000], ["Gửi xe", 50_000], ["Mạng", 75_000], ["Dịch vụ", 66_667]] as const) {
    expect((await call("POST", "/v1/rental/tenants/tenant-binh/fees", { name, amount })).status).toBe(201);
  }
  for (const [category_id, amount] of [["groceries", 7_300_000], ["utilities", 560_000], ["fuel-parking", 999_000]] as const) {
    expect((await call("POST", "/v1/transactions", { meaning: "spend", amount, category_id, at: "2026-10-05T03:00:00.000Z" })).status).toBe(201);
  }
  const paid = await call("POST", "/v1/rental/tenants/tenant-binh/lines", { kind: "paid_for_us", amount: 300_000, category_id: "groceries", client_id: "pfu-1", at: "2026-10-06T03:00:00.000Z" });
  expect(paid.status).toBe(201);
  return paid.json.data;
}

describe("domain rental", () => {
  it("phần chi chung = floor(tổng / số người), phí tắt không vào nháp", () => {
    expect(sharePerHead(8_160_000, 3)).toBe(2_720_000);
    expect(sharePerHead(10, 3)).toBe(3);
    expect(sharePerHead(-5, 3)).toBe(0);
    expect(monthDraft([{ name: "Nhà", amount: 2_500_000, active: true }, { name: "Cũ", amount: 1, active: false }], 8_160_000, 4)).toEqual([
      { kind: "fixed", name: "Nhà", amount: 2_500_000 },
      { kind: "shared", name: "Chi chung", amount: 2_040_000 },
    ]);
  });
});

describe("/v1/rental", () => {
  it("ví dụ proposal: tạm tính, chốt, nhận tiền → số dư −80.000 mang sang tháng sau", async () => {
    const line = await seedExample();
    expect(line.amount).toBe(-300_000); // người thuê chi hộ: gửi số dương, lưu số âm

    const draft = (await call("GET", "/v1/rental/tenants/tenant-binh/month?month=2026-10")).json.data;
    expect(draft.settled).toBe(false);
    expect(draft.sharedTotal).toBe(8_160_000);
    expect(draft.share).toBe(2_720_000);
    expect(draft.draft.map((d: any) => d.amount)).toEqual([2_500_000, 50_000, 75_000, 66_667, 2_720_000]);
    expect(draft.closingBalance).toBe(5_111_667);
    expect(draft.balance).toBe(-300_000); // chưa chốt: sổ mới chỉ có dòng chi hộ

    const settled = await call("POST", "/v1/rental/tenants/tenant-binh/settle", { month: "2026-10", lines: draft.draft });
    expect(settled.status).toBe(201);
    expect(settled.json.data.settled).toBe(true);
    expect(settled.json.data.balance).toBe(5_111_667);

    payment(5_191_667);
    expect(await balance()).toBe(-80_000);
    const month = (await call("GET", "/v1/rental/tenants/tenant-binh/month?month=2026-10")).json.data;
    expect(month.payments).toEqual([{ transactionId: expect.any(Number), at: "2026-10-10T03:00:00.000Z", amount: 5_191_667 }]);
    expect(month.closingBalance).toBe(-80_000);
    expect(month.text).toContain("Chi chung (8.160.000 ₫ ÷ 3 người): 2.720.000 ₫");
    expect(month.text).toContain("Trả dư: 80.000 ₫ — trừ vào tháng sau");
  });

  it("chốt lần hai cùng tháng → 409 already_settled, không ghi thêm dòng", async () => {
    await seedExample();
    const lines = [{ kind: "fixed", name: "Nhà", amount: 2_500_000 }];
    expect((await call("POST", "/v1/rental/tenants/tenant-binh/settle", { month: "2026-10", lines })).status).toBe(201);
    const again = await call("POST", "/v1/rental/tenants/tenant-binh/settle", { month: "2026-10", lines });
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("already_settled");
    expect(await balance()).toBe(2_200_000);
  });

  it("không chốt được tháng chưa tới", async () => {
    await seedExample();
    const res = await call("POST", "/v1/rental/tenants/tenant-binh/settle", { month: "2026-11", lines: [] });
    expect(res.json.error?.code).toBe("future_month");
  });

  it("đổi số người chia (4) → phần chi chung giảm", async () => {
    await seedExample();
    expect((await call("PATCH", "/v1/rental/config", { headcount: 4 })).json.data.headcount).toBe(4);
    const month = (await call("GET", "/v1/rental/tenants/tenant-binh/month?month=2026-10")).json.data;
    expect(month.share).toBe(2_040_000);
  });

  it("huỷ dòng sổ đổi số dư; huỷ giao dịch tiền trả thì số dư trở lại", async () => {
    const line = await seedExample();
    expect(await balance()).toBe(-300_000);
    expect((await call("POST", `/v1/rental/lines/${line.id}/void`)).status).toBe(200);
    expect(await balance()).toBe(0);
    expect((await call("POST", `/v1/rental/lines/${line.id}/void`)).json.error?.code).toBe("already_void");

    const txId = payment(1_000_000);
    expect(await balance()).toBe(-1_000_000);
    raw.prepare("UPDATE transactions SET status = 'void' WHERE id = ?").run(txId);
    expect(await balance()).toBe(0);
  });

  it("dòng ghi tay idempotent theo client_id; chi hộ chỉ nhận danh mục chi chung", async () => {
    await seedExample();
    const again = await call("POST", "/v1/rental/tenants/tenant-binh/lines", { kind: "paid_for_us", amount: 300_000, category_id: "groceries", client_id: "pfu-1" });
    expect(again.status).toBe(200);
    expect(await balance()).toBe(-300_000);
    const wrong = await call("POST", "/v1/rental/tenants/tenant-binh/lines", { kind: "paid_for_us", amount: 50_000, category_id: "fuel-parking" });
    expect(wrong.json.error?.code).toBe("not_shared_category");
  });

  it("số dư mở sổ là dòng opening; tháng sau thấy nó ở số dư đầu kỳ", async () => {
    vi.setSystemTime(new Date("2026-09-15T05:00:00.000Z"));
    expect((await call("POST", "/v1/rental/tenants", { id: "tenant-binh", name: "Anh Bình", opening_balance: 7_075_000 })).status).toBe(201);
    vi.setSystemTime(new Date("2026-10-28T05:00:00.000Z"));
    const month = (await call("GET", "/v1/rental/tenants/tenant-binh/month")).json.data;
    expect(month.month).toBe("2026-10");
    expect(month.openingBalance).toBe(7_075_000);
    expect(month.balance).toBe(7_075_000);
  });
});
