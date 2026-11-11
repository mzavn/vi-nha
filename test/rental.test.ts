import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billMemo, memoKey, statementText } from "../src/domain/rental";
import { vietQrPayload } from "../src/domain/vietqr";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { getBill } from "../src/services/rental";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;

const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-12T05:00:00.000Z");
  raw = openDb();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
  // Tài khoản nhận mẫu (dữ liệu giả): MB Bank 0123456789, không riêng tư.
  raw.exec(`INSERT INTO accounts (id, name, kind, bank, account_no, owner_member_id) VALUES ('mb-household', 'MB (nhà)', 'bank', 'MBBank', '0123456789', 'husband');
            INSERT INTO tenants (id, name) VALUES ('an', 'An');`);
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

/** Tiền người thuê trả = income mang tenant_id, nguồn cho thuê (không phải dòng sổ). */
function payment(tenantId: string, amount: number, when: string, account = "vcb-husband"): number {
  const r = raw
    .prepare(
      `INSERT INTO transactions (at, amount, meaning, counter_account_id, week_key, month_key, source, tenant_id, income_stream_id)
       VALUES (?, ?, 'income', ?, '2026-W45', ?, 'manual', ?, 'rental')`,
    )
    .run(when, amount, account, when.slice(0, 7), tenantId);
  return Number(r.lastInsertRowid);
}

const balance = async (id = "an") => (await call("GET", "/v1/rental")).json.data.tenants.find((t: any) => t.id === id).balance;
const billLines = (billId: number) =>
  raw.prepare("SELECT kind, amount, status, at, month_key FROM tenant_lines WHERE bill_id = ? ORDER BY id").all(billId) as {
    kind: string; amount: number; status: string; at: string; month_key: string;
  }[];
const audits = (action: string) =>
  (raw.prepare("SELECT detail, via FROM audit_log WHERE action = ? ORDER BY id").all(action) as { detail: string | null; via: string }[]).map((r) => ({
    via: r.via,
    detail: r.detail ? JSON.parse(r.detail) : null,
  }));

const SEPT = [
  { name: "Tiền nhà", category: "fixed", amount: 2_500_000 },
  { name: "Gửi xe", category: "fixed", amount: 100_000 },
  { name: "Tiền ăn", category: "variable", amount: 1_200_000 },
  { name: "Tiền điện", category: "variable", amount: 380_000 },
];
const OCT = [
  { name: "Tiền nhà", category: "fixed", amount: 2_500_000 },
  { name: "Gửi xe", category: "fixed", amount: 100_000 },
  { name: "Tiền ăn", category: "variable", amount: 1_350_000 },
  { name: "Tiền điện", category: "variable", amount: 420_000 },
  { name: "Trừ: An đi chợ", category: "variable", amount: -150_000 },
];
const plain = (items: any[]) => items.map(({ name, category, amount }) => ({ name, category, amount }));

async function create(month: string, tenant = "an") {
  return call("POST", `/v1/rental/tenants/${tenant}/bills`, { month });
}
async function save(bill: { id: number; revision: number }, items: unknown[], receive_account_id?: string | null) {
  return call("PUT", `/v1/rental/bills/${bill.id}`, { revision: bill.revision, items, ...(receive_account_id === undefined ? {} : { receive_account_id }) });
}
async function issue(bill: { id: number; revision: number }) {
  return call("POST", `/v1/rental/bills/${bill.id}/issue`, { revision: bill.revision });
}
/** Lập + lưu + chốt & gửi bản tính tháng `month` lúc `when`. */
async function issued(month: string, items: unknown[], when: string, account: string | null = "mb-household", tenant = "an") {
  at(when);
  const c = (await create(month, tenant)).json.data;
  const s = (await save(c.bill, items, account)).json.data;
  const r = await issue(s.bill);
  expect(r.status).toBe(200);
  return r.json.data;
}

/** An: bản tính tháng 9 đã gửi 2/10 vào mb-household (4.180.000), trả 4.130.000 ngày 5/10 → số dư 50.000. */
async function anWithSeptember() {
  const sept = await issued("2026-09", SEPT, "2026-10-02T03:00:00.000Z");
  payment("an", 4_130_000, "2026-10-05T03:00:00.000Z");
  at("2026-11-01T03:00:00.000Z");
  return sept;
}

describe("domain rental", () => {
  it("UC-807 AC-3: nội dung QR TIEN NHA T10 AN, ≤ 25 ký tự không dấu; mã cắt cho vừa; memoKey chỉ giữ chữ số viết hoa", () => {
    expect(billMemo("2026-10", "an")).toBe("TIEN NHA T10 AN");
    expect(billMemo("2026-10", "nguoi-thue-so-1")).toBe("TIEN NHA T10 NGUOI-THUE-S");
    expect(billMemo("2026-10", "nguoi-thue-so-1").length).toBeLessThanOrEqual(25);
    expect(memoKey("TIEN-NHA-T10-AN")).toBe(memoKey("tiềnnhàt10an"));
  });

  it("UC-807 AC-1: tin tách tháng M và các tháng trước; tiền vi-VN, dấu trừ U+2212", () => {
    const text = statementText({
      tenantName: "An",
      month: "2026-10",
      status: "issued",
      editedAt: null,
      items: OCT as any,
      previous: { month: "2026-09", total: 4_180_000 },
      transfer: "MB Bank · 0123456789 · nội dung TIEN NHA T10 AN",
      previousBalance: 50_000,
    });
    expect(text.split("\n")).toEqual([
      "Tiền nhà tháng 10/2026 — An",
      "Chi phí cứng",
      "· Tiền nhà: 2.500.000 ₫",
      "· Gửi xe: 100.000 ₫",
      "Chi phí",
      "· Tiền ăn: 1.350.000 ₫",
      "· Tiền điện: 420.000 ₫",
      "· Trừ: An đi chợ: −150.000 ₫",
      "Tổng tháng 10: 4.220.000 ₫ (tháng 9: 4.180.000 ₫, nhiều hơn 40.000 ₫)",
      "Chuyển khoản: MB Bank · 0123456789 · nội dung TIEN NHA T10 AN",
      "Các tháng trước: còn nợ 50.000 ₫ (chưa gồm trong số trên)",
    ]);
  });
});

describe("UC-806 lập và sửa bản tính tháng", () => {
  it("UC-806 AC-1: lập bản tính chép đúng tháng trước (khoản, hạng, số, thứ tự, tài khoản nhận); số dư không đổi", async () => {
    await anWithSeptember();
    expect(await balance()).toBe(50_000);
    const res = await create("2026-10");
    expect(res.status).toBe(201);
    const v = res.json.data;
    expect(v.status).toBe("draft");
    expect(plain(v.bill.items)).toEqual(SEPT);
    expect(v.bill.receiveAccountId).toBe("mb-household");
    expect(v.bill.copiedFromMonth).toBe("2026-09");
    expect(v.total).toBe(4_180_000);
    expect(await balance()).toBe(50_000);
    expect(audits("tenant.bill_create")).toHaveLength(2);
  });

  it("UC-806 AC-2: lập lại cùng tháng trả bản đã có", async () => {
    await anWithSeptember();
    const first = await create("2026-10");
    const again = await create("2026-10");
    expect(again.status).toBe(200);
    expect(again.json.data.bill.id).toBe(first.json.data.bill.id);
    expect(raw.prepare("SELECT COUNT(*) n FROM tenant_bills WHERE month_key = '2026-10'").get()).toEqual({ n: 1 });
  });

  it("UC-806 AC-3: chưa có tháng trước thì bắt đầu trống", async () => {
    raw.exec("INSERT INTO tenants (id, name) VALUES ('binh', 'Bình')");
    const before = (await call("GET", "/v1/rental/tenants/binh/bills/2026-10")).json.data;
    expect([before.status, before.previous]).toEqual(["none", null]);
    const v = (await create("2026-10", "binh")).json.data;
    expect([v.bill.items, v.bill.receiveAccountId, v.total]).toEqual([[], null, 0]);
  });

  it("UC-806 AC-4: sửa nháp không đổi số dư; số âm được; tổng theo hạng và so tháng trước", async () => {
    await anWithSeptember();
    const draft = (await create("2026-10")).json.data;
    const res = await save(draft.bill, OCT);
    expect(res.status).toBe(200);
    const v = res.json.data;
    expect(v.totals).toEqual({ fixed: 2_600_000, variable: 1_620_000, total: 4_220_000 });
    expect(v.previous).toMatchObject({ month: "2026-09", total: 4_180_000 });
    expect(v.total - v.previous.total).toBe(40_000);
    expect(v.bill.items.map((i: any) => i.previous)).toEqual([2_500_000, 100_000, 1_200_000, 380_000, null]);
    expect(v.bill.revision).toBe(draft.bill.revision + 1);
    expect(await balance()).toBe(50_000);
  });

  it("UC-806 AC-5: khoản hoặc tài khoản sai bị từ chối, nháp giữ nguyên", async () => {
    await anWithSeptember();
    const draft = (await create("2026-10")).json.data;
    raw.exec(`INSERT INTO accounts (id, name, kind, bank, account_no, owner_member_id, private) VALUES ('tcb-wife', 'TCB (vợ)', 'bank', 'Techcombank', '1903zzz', 'wife', 1)`);
    const cases: [unknown[], string | null | undefined, string][] = [
      [[{ name: " ", category: "fixed", amount: 1 }], undefined, "invalid_input"],
      [[{ name: "tiền điện", category: "variable", amount: 1 }, { name: "Tiền điện ", category: "variable", amount: 2 }], undefined, "duplicate_item"],
      [[{ name: "Nước", category: "other", amount: 1 }], undefined, "invalid_category"],
      [[{ name: "Nước", category: "variable", amount: 0 }], undefined, "invalid_amount"],
      [[{ name: "Nước", category: "variable", amount: 1.5 }], undefined, "invalid_amount"],
      [SEPT, "cash-husband", "unknown_account"],
      [SEPT, "tcb-wife", "tenant_private_account"],
    ];
    for (const [items, account, code] of cases) {
      const r = await save(draft.bill, items, account);
      expect([r.status, r.json.error?.code], code).toEqual([400, code]);
    }
    const after = (await call("GET", "/v1/rental/tenants/an/bills/2026-10")).json.data;
    expect(plain(after.bill.items)).toEqual(SEPT);
    expect([after.bill.revision, after.bill.receiveAccountId]).toEqual([draft.bill.revision, "mb-household"]);
  });

  it("UC-806 AC-6: chốt ghi đúng một dòng sổ bằng tổng; chốt lại trả cùng bản, không ghi thêm", async () => {
    await anWithSeptember();
    const draft = (await create("2026-10")).json.data;
    const saved = (await save(draft.bill, OCT)).json.data;
    at("2026-11-02T03:00:00.000Z");
    const r = await issue(saved.bill);
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe("issued");
    expect(r.json.data.bill.revision).toBe(saved.bill.revision + 1);
    expect(r.json.data.bill.issuedAt).toBe("2026-11-02T03:00:00.000Z");
    expect(await balance()).toBe(4_270_000);
    expect(billLines(saved.bill.id)).toEqual([{ kind: "bill", amount: 4_220_000, status: "active", at: "2026-11-02T03:00:00.000Z", month_key: "2026-10" }]);
    const again = await issue(saved.bill);
    expect(again.status).toBe(200);
    expect(again.json.data.bill.revision).toBe(saved.bill.revision + 1);
    expect(billLines(saved.bill.id)).toHaveLength(1);
    expect(await balance()).toBe(4_270_000);
    expect(audits("tenant.bill_issue").at(-1)?.detail).toEqual({ month: "2026-10", total: 4_220_000 });
  });

  it("UC-806 AC-7: sửa bản đã gửi thay dòng sổ (giữ at lần gửi đầu), số dư đúng, có nhật ký", async () => {
    await anWithSeptember();
    const oct = await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z");
    expect(await balance()).toBe(4_270_000);
    at("2026-11-05T03:00:00.000Z");
    const items = OCT.map((i) => (i.name === "Tiền điện" ? { ...i, amount: 470_000 } : i));
    const r = await save(oct.bill, items);
    expect(r.status).toBe(200);
    expect(billLines(oct.bill.id)).toEqual([
      { kind: "bill", amount: 4_220_000, status: "void", at: "2026-11-02T03:00:00.000Z", month_key: "2026-10" },
      { kind: "bill", amount: 4_270_000, status: "active", at: "2026-11-02T03:00:00.000Z", month_key: "2026-10" },
    ]);
    expect(await balance()).toBe(4_320_000);
    expect(r.json.data.bill).toMatchObject({ revision: oct.bill.revision + 1, editedAt: "2026-11-05T03:00:00.000Z", status: "issued" });
    expect(audits("tenant.bill_edit")).toEqual([{ via: "token", detail: { month: "2026-10", from: 4_220_000, to: 4_270_000 } }]);
  });

  it("UC-806 AC-8: ghi đồng thời bị chặn bằng revision (409 bill_changed)", async () => {
    await anWithSeptember();
    const oct = await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z");
    const a = await save(oct.bill, OCT.map((i) => (i.name === "Tiền điện" ? { ...i, amount: 470_000 } : i)));
    expect(a.status).toBe(200);
    const b = await save(oct.bill, OCT.map((i) => (i.name === "Tiền ăn" ? { ...i, amount: 1 } : i)));
    expect([b.status, b.json.error?.code, b.json.error?.message]).toEqual([409, "bill_changed", "Bản tính vừa được sửa ở máy khác — tải lại."]);
    expect(billLines(oct.bill.id).filter((l) => l.status === "active")).toEqual([expect.objectContaining({ amount: 4_270_000 })]);

    // Bản nháp: máy A chốt & gửi, máy B lưu nháp với revision cũ → 409, bản đã gửi không thành "đã sửa".
    const nov = (await create("2026-11")).json.data;
    const novSaved = (await save(nov.bill, OCT)).json.data;
    expect((await issue(novSaved.bill)).status).toBe(200);
    const late = await save(novSaved.bill, SEPT);
    expect([late.status, late.json.error?.code]).toEqual([409, "bill_changed"]);
    const view = (await call("GET", "/v1/rental/tenants/an/bills/2026-11")).json.data;
    expect([view.status, view.bill.editedAt, view.total]).toEqual(["issued", null, 4_220_000]);
  });

  it("UC-806 AC-9: tổng 0 thì không có dòng sổ; sửa bản đã gửi về 0 chỉ huỷ dòng cũ", async () => {
    await anWithSeptember();
    const zero = [{ name: "Tiền nhà", category: "fixed", amount: 2_500_000 }, { name: "Trừ tiền nhà tháng này", category: "fixed", amount: -2_500_000 }];
    const oct = await issued("2026-10", zero, "2026-11-02T03:00:00.000Z");
    expect([oct.status, oct.total, oct.qr]).toEqual(["issued", 0, null]);
    expect(billLines(oct.bill.id)).toEqual([]);
    expect(await balance()).toBe(50_000);

    const sept = (await call("GET", "/v1/rental/tenants/an/bills/2026-09")).json.data;
    expect((await save(sept.bill, [])).status).toBe(200);
    expect(billLines(sept.bill.id).map((l) => l.status)).toEqual(["void"]);
    expect(await balance()).toBe(50_000 - 4_180_000);
  });

  it("UC-806 AC-10: không lập tháng tương lai", async () => {
    expect((await create("2026-09")).status).toBe(201);
    expect((await create("2026-11")).status).toBe(201);
    const future = await create("2026-12");
    expect([future.status, future.json.error?.code]).toEqual([400, "future_month"]);
    expect((await create("2026-13")).json.error?.code).toBe("invalid_month");
  });

  it("UC-806 AC-11: xoá nháp; không xoá bản đã gửi", async () => {
    const sept = await anWithSeptember();
    const draft = (await create("2026-10")).json.data;
    const del = await call("DELETE", `/v1/rental/bills/${draft.bill.id}`);
    expect(del.status).toBe(200);
    expect((await call("GET", "/v1/rental/tenants/an/bills/2026-10")).json.data.status).toBe("none");
    expect(plain((await create("2026-10")).json.data.bill.items)).toEqual(SEPT);
    const no = await call("DELETE", `/v1/rental/bills/${sept.bill.id}`);
    expect([no.status, no.json.error?.code]).toEqual([409, "bill_issued"]);
  });

  it("UC-806 AC-13: sửa bản tháng trước sau khi bản tháng sau đã gửi — dòng thay thế giữ at và month_key; tin tháng sau và bảng cân đối đúng", async () => {
    const oct = await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z");
    payment("an", 4_100_000, "2026-11-05T03:00:00.000Z");
    const nov = await issued("2026-11", SEPT, "2026-12-01T03:00:00.000Z");
    expect(nov.text).toContain("Các tháng trước: còn nợ 120.000 ₫ (chưa gồm trong số trên)");
    const sheet = async (date: string) =>
      ((await call("GET", `/v1/balance-sheet?date=${date}`)).json.data.assets as any[]).flatMap((s) => s.rows).find((r: any) => r.key === "tenants")?.value ?? 0;
    at("2026-12-03T03:00:00.000Z");
    const before = [await sheet("2026-10-31"), await sheet("2026-11-30"), await sheet("2026-12-03")];

    const r = await save(oct.bill, [...OCT, { name: "Sửa ống nước", category: "variable", amount: 50_000 }]);
    expect(r.status).toBe(200);
    expect(billLines(oct.bill.id).filter((l) => l.status === "active")).toEqual([
      { kind: "bill", amount: 4_270_000, status: "active", at: "2026-11-02T03:00:00.000Z", month_key: "2026-10" },
    ]);
    expect((await call("GET", "/v1/rental/tenants/an/bills/2026-11")).json.data.text).toContain("Các tháng trước: còn nợ 170.000 ₫");
    expect([await sheet("2026-10-31"), await sheet("2026-11-30"), await sheet("2026-12-03")]).toEqual([before[0], before[1] + 50_000, before[2] + 50_000]);
  });

  it("UC-806 AC-14: không chép tài khoản nhận đã tắt hoặc đã bật riêng tư; lưu nháp không chọn tài khoản vẫn được", async () => {
    await anWithSeptember();
    raw.exec("UPDATE accounts SET active = 0 WHERE id = 'mb-household'");
    const off = (await create("2026-10")).json.data;
    expect([plain(off.bill.items), off.bill.receiveAccountId]).toEqual([SEPT, null]);
    expect((await call("DELETE", `/v1/rental/bills/${off.bill.id}`)).status).toBe(200);
    raw.exec("UPDATE accounts SET active = 1, private = 1 WHERE id = 'mb-household'");
    const priv = (await create("2026-10")).json.data;
    expect(priv.bill.receiveAccountId).toBeNull();
    expect((await save(priv.bill, SEPT)).status).toBe(200);
  });

  it("UC-806 7a: người thuê đã ra không lập được bản mới; bản cũ vẫn sửa được", async () => {
    const sept = await anWithSeptember();
    raw.exec("UPDATE tenants SET active = 0 WHERE id = 'an'");
    expect((await create("2026-10")).json.error?.code).toBe("tenant_inactive");
    expect((await save(sept.bill, SEPT.slice(0, 1))).status).toBe(200);
    expect((await create("2026-10", "khong-co")).status).toBe(404);
  });
});

describe("UC-807 gửi bản tổng cộng kèm QR", () => {
  it("UC-807 AC-1 + AC-3: tin tách tháng M / các tháng trước; QR đúng chuẩn VietQR theo tài khoản nhận", async () => {
    await anWithSeptember();
    const v = await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z");
    expect(v.text).toContain("Tổng tháng 10: 4.220.000 ₫ (tháng 9: 4.180.000 ₫, nhiều hơn 40.000 ₫)");
    expect(v.text).toContain("Chuyển khoản: MB Bank · 0123456789 · nội dung TIEN NHA T10 AN");
    expect(v.text).toContain("Các tháng trước: còn nợ 50.000 ₫ (chưa gồm trong số trên)");
    expect([v.qrAmount, v.previousBalance]).toEqual([4_220_000, 50_000]);
    expect(v.qr).toMatchObject({ memo: "TIEN NHA T10 AN", payload: vietQrPayload({ bin: "970422", accountNo: "0123456789", amount: 4_220_000, memo: "TIEN NHA T10 AN" }) });
  });

  it("UC-807 AC-2: trả dư các tháng trước không trừ vào QR; tổng ≤ 0 thì không QR, không dòng chuyển khoản", async () => {
    await anWithSeptember();
    payment("an", 130_000, "2026-10-20T03:00:00.000Z"); // 50.000 → −80.000
    const v = await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z");
    expect(v.text).toContain("Các tháng trước: trả dư 80.000 ₫");
    expect(v.qrAmount).toBe(4_220_000);
    const neg = await issued("2026-11", [{ name: "Trả lại tiền cọc", category: "fixed", amount: -200_000 }], "2026-11-12T03:00:00.000Z");
    expect([neg.qrAmount, neg.qr]).toEqual([0, null]);
    expect(neg.text).not.toContain("Chuyển khoản");
  });

  it("UC-807 AC-4: chưa có tài khoản nhận / tài khoản vừa bật riêng tư → không QR, có lý do; tin không có dòng chuyển khoản", async () => {
    const none = await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z", null);
    expect(none.qr).toEqual({ reason: "Chưa có mã QR — chọn tài khoản nhận trên bản tính." });
    expect(none.text).not.toContain("Chuyển khoản");
    raw.exec("INSERT INTO tenants (id, name) VALUES ('binh', 'Bình')");
    await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z", "mb-household", "binh");
    raw.exec("UPDATE accounts SET private = 1 WHERE id = 'mb-household'");
    const v = (await call("GET", "/v1/rental/tenants/binh/bills/2026-10")).json.data;
    expect(v.qr).toEqual({ reason: "Chưa có mã QR — chọn tài khoản nhận trên bản tính." });
    expect(v.text).not.toContain("Chuyển khoản");
  });

  it("UC-807 AC-5: tiền về sau khi gửi hiện trên màn, không đổi \"Các tháng trước\"", async () => {
    await anWithSeptember();
    await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z");
    const tx = payment("an", 4_220_000, "2026-11-03T03:00:00.000Z");
    const v = (await call("GET", "/v1/rental/tenants/an/bills/2026-10")).json.data;
    expect(v.payments).toEqual([{ transactionId: tx, at: "2026-11-03T03:00:00.000Z", amount: 4_220_000 }]);
    expect(v.balance).toBe(50_000);
    expect(v.previousBalance).toBe(50_000);
    expect(v.text).toContain("Các tháng trước: còn nợ 50.000 ₫");
  });

  it("UC-807 AC-6: gửi lại sau khi sửa — dòng đầu (đã sửa d/m — thay tin trước), QR theo tổng mới", async () => {
    await anWithSeptember();
    const oct = await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z");
    at("2026-11-05T03:00:00.000Z");
    const v = (await save(oct.bill, OCT.map((i) => (i.name === "Tiền điện" ? { ...i, amount: 470_000 } : i)))).json.data;
    expect(v.text.split("\n")[0]).toBe("(đã sửa 5/11 — thay tin trước)");
    expect(v.text).toContain("Tổng tháng 10: 4.270.000 ₫");
    expect(v.qrAmount).toBe(4_270_000);
  });

  it("UC-807 AC-8: gửi không theo thứ tự tháng — tin tháng 10 không tính dòng tháng 11; tin tháng 11 tính tháng 10 theo tháng", async () => {
    at("2026-11-05T03:00:00.000Z");
    const oct = (await create("2026-10")).json.data;
    const octSaved = (await save(oct.bill, OCT)).json.data;
    await issued("2026-11", [{ name: "Tiền nhà", category: "fixed", amount: 4_300_000 }], "2026-12-01T03:00:00.000Z");
    at("2026-12-03T03:00:00.000Z");
    const o = (await issue(octSaved.bill)).json.data;
    expect(o.text).not.toContain("Các tháng trước");
    const n = (await call("GET", "/v1/rental/tenants/an/bills/2026-11")).json.data;
    expect(n.text).toContain("Các tháng trước: còn nợ 4.220.000 ₫");
    expect(await balance()).toBe(8_520_000);
  });

  it("UC-807 1a: bản nháp có dòng đầu (nháp); không có bản tháng trước thì không so", async () => {
    at("2026-11-05T03:00:00.000Z");
    const v = (await save((await create("2026-10")).json.data.bill, OCT)).json.data;
    expect(v.text.split("\n").slice(0, 2)).toEqual(["(nháp)", "Tiền nhà tháng 10/2026 — An"]);
    expect(v.text.split("\n")).toContain("Tổng tháng 10: 4.220.000 ₫");
  });
});

describe("UC-801 thiết lập người thuê sau v2.2", () => {
  it("UC-801 AC-2: thêm người thuê có số dư mở sổ → tin bản tính tháng 9 có \"Các tháng trước: còn nợ 7.075.000 ₫\"", async () => {
    at("2026-09-15T05:00:00.000Z");
    expect((await call("POST", "/v1/rental/tenants", { id: "binh", name: "Bình", opening_balance: 7_075_000 })).status).toBe(201);
    at("2026-10-02T05:00:00.000Z");
    await create("2026-09", "binh");
    const v = (await call("GET", "/v1/rental/tenants/binh/bills/2026-09")).json.data;
    expect(v.text).toContain("Các tháng trước: còn nợ 7.075.000 ₫");
    expect(await balance("binh")).toBe(7_075_000);
  });

  it("UC-801 bước 4: GET /v1/rental trả bản tính tháng trước của từng người", async () => {
    await anWithSeptember();
    at("2026-10-20T03:00:00.000Z");
    const r = (await call("GET", "/v1/rental")).json.data;
    expect(Object.keys(r).sort()).toEqual(["incomeStreamId", "tenants"]);
    expect(r.tenants.find((t: any) => t.id === "an")).toEqual({
      id: "an", name: "An", active: true, balance: 50_000,
      bill: { id: expect.any(Number), month: "2026-09", status: "issued", total: 4_180_000, revision: 2, edited: false },
    });
  });

  it("UC-801 AC-6: cấu hình sai bị từ chối (nguồn đã tắt / headcount) — cấu hình cũ giữ nguyên", async () => {
    raw.exec("UPDATE income_streams SET active = 0 WHERE id = 'salary-wife'");
    expect((await call("PATCH", "/v1/rental/config", { income_stream_id: "salary-wife" })).json.error?.code).toBe("unknown_income_stream");
    const old = await call("PATCH", "/v1/rental/config", { income_stream_id: "rental", headcount: 3 });
    expect([old.status, old.json.error?.code]).toEqual([400, "model_changed"]);
    expect((await call("PATCH", "/v1/rental/config", { shared_category_ids: [] })).json.error?.code).toBe("model_changed");
    expect((await call("GET", "/v1/rental")).json.data.incomeStreamId).toBe("rental");
  });

  it("UC-801 AC-10: đường cũ trả 410 model_changed kèm câu chỉ đường mới, không ghi gì", async () => {
    const before = raw.prepare("SELECT COUNT(*) n FROM tenant_lines").get();
    for (const [method, path] of [
      ["POST", "/v1/rental/tenants/an/fees"],
      ["PATCH", "/v1/rental/fees/1"],
      ["POST", "/v1/rental/tenants/an/lines"],
      ["POST", "/v1/rental/lines/1/void"],
      ["POST", "/v1/rental/tenants/an/settle"],
      ["GET", "/v1/rental/tenants/an/month"],
    ] as const) {
      const r = await call(method, path, method === "GET" ? undefined : { name: "x", amount: 1 });
      expect([r.status, r.json.error?.code], path).toEqual([410, "model_changed"]);
      expect(r.json.error?.message).toBe("Ví nhà v2.2 bỏ phí cố định, dòng tay và chốt tháng: dùng bản tính `…/bills`.");
    }
    expect(raw.prepare("SELECT COUNT(*) n FROM tenant_lines").get()).toEqual(before);
  });
});

describe("/v1/rental", () => {
  describe("tiền người thuê trả qua Gán (rental UC-805)", () => {
    const book = (id: string) => (raw.prepare("SELECT book_balance FROM v_account_book WHERE account_id = ?").get(id) as { book_balance: number }).book_balance;
    const pendingLog = (id: string, accountId: string, amount: number) =>
      raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES (?, '2026-10-20T03:00:00.000Z', ?, 'in', ?, 'pending')").run(id, amount, accountId);
    const assignTenant = (id: string, amount: number) => call("POST", `/v1/logs/${id}/assign`, { splits: [{ meaning: "income", amount, tenant_id: "tenant-binh" }] });

    it("UC-805 AC-1: gán tiền vào cho người thuê → khoản thu gắn nguồn cho thuê, không ví, không chia; số dư người thuê giảm, tài khoản nhận tăng", async () => {
      expect((await call("POST", "/v1/rental/tenants", { id: "tenant-binh", name: "Anh Bình", opening_balance: 5_000_000 })).status).toBe(201);
      pendingLog("thue-1", "vcb-husband", 5_000_000);
      const res = await assignTenant("thue-1", 5_000_000);
      expect(res.status).toBe(201);
      expect(res.json.data.transactions[0]).toMatchObject({ meaning: "income", tenant_id: "tenant-binh", income_stream_id: "rental", counter_account_id: "vcb-husband" });
      expect(res.json.data.effects).toEqual({ cycle: null, tasksDone: [] });
      expect(await balance("tenant-binh")).toBe(0);
      expect(book("vcb-husband")).toBe(5_000_000);
      expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning = 'fund'").get()).toEqual({ n: 0 });
    });

    it("UC-805 AC-9: người thuê nợ 4.000.000, tiền về tài khoản ngăn Tích luỹ → số dư người thuê 0, Tích luỹ +4.000.000, không lệnh chuyển, không kỳ, không việc", async () => {
      raw.prepare("UPDATE accounts SET pocket = 'savings' WHERE id = 'tcb-husband'").run();
      expect((await call("POST", "/v1/rental/tenants", { id: "tenant-binh", name: "Anh Bình", opening_balance: 4_000_000 })).status).toBe(201);
      pendingLog("thue-2", "tcb-husband", 4_000_000);
      expect((await assignTenant("thue-2", 4_000_000)).status).toBe(201);
      expect(await balance("tenant-binh")).toBe(0);
      expect(book("tcb-husband")).toBe(4_000_000);
      expect(raw.prepare("SELECT (SELECT COUNT(*) FROM pay_cycles) + (SELECT COUNT(*) FROM pay_cycle_tasks) AS n").get()).toEqual({ n: 0 });
    });

    it("UC-805 AC-4: huỷ khoản tiền trả thì số dư người thuê trở lại, không cần huỷ gì ở sổ người thuê", async () => {
      const txId = payment("an", 1_000_000, "2026-11-03T03:00:00.000Z");
      expect(await balance()).toBe(-1_000_000);
      raw.prepare("UPDATE transactions SET status = 'void' WHERE id = ?").run(txId);
      expect(await balance()).toBe(0);
    });

    it("UC-805 AC-12: khoản cũ trong tài khoản đã thành riêng tư không lộ từng khoản với người khác; tổng vẫn trừ", async () => {
      raw.exec(`INSERT INTO accounts (id, name, kind, bank, account_no, owner_member_id) VALUES ('tcb-wife', 'TCB (vợ)', 'bank', 'Techcombank', '1903zzz', 'wife')`);
      await issued("2026-10", OCT, "2026-11-02T03:00:00.000Z");
      const tx = payment("an", 1_000_000, "2026-11-03T03:00:00.000Z", "tcb-wife");
      raw.exec("UPDATE accounts SET private = 1 WHERE id = 'tcb-wife'");
      const husband = await getBill(env.DB, "an", "2026-10", "husband", new Date());
      expect(husband.payments).toEqual([]);
      expect(husband.balance).toBe(3_220_000);
      const wife = await getBill(env.DB, "an", "2026-10", "wife", new Date());
      expect(wife.payments).toEqual([{ transactionId: tx, at: "2026-11-03T03:00:00.000Z", amount: 1_000_000 }]);
    });
  });
});
