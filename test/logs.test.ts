import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { ingestLog, parseWebhookPayload } from "../src/services/ingest";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { client, householdP, P_NOW } from "./helpers/household-p";

let env: Env;
let raw: ReturnType<typeof openDb>;

beforeEach(() => {
  raw = openDb();
  // Bối cảnh: các tài khoản nối feed trong seed báo cả tiền ra (ADR-66) — log `out` tự gán theo rule như trước.
  raw.prepare("UPDATE accounts SET sepay_out = 1 WHERE sepay_enabled = 1").run();
  env = { DB: asD1(raw), API_TOKEN: "tok" } as Env;
});

type Json = { ok: boolean; data: any; error?: { code: string; message: string } };

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { Authorization: "Bearer tok", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

function seedLog(id: string, direction: "in" | "out", amount: number, accountId: string | null, opts: { content?: string; refCode?: string; status?: string; at?: string } = {}) {
  raw
    .prepare(`INSERT INTO bank_logs (id, at, amount, direction, account_id, content, ref_code, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.at ?? "2026-09-22T02:00:00.000Z", amount, direction, accountId, opts.content ?? null, opts.refCode ?? null, opts.status ?? "pending");
}

describe("GET /v1/logs?status=pending", () => {
  it("chỉ liệt kê log pending, kèm gợi ý", async () => {
    seedLog("p1", "out", 2_000_000, "vcb-husband", { content: "RUT TIEN TAI ATM VCB" });
    seedLog("p2", "out", 1_000, "vcb-husband", { status: "ignored" });
    const { status, json } = await call("GET", "/v1/logs?status=pending");
    expect(status).toBe(200);
    expect(json.data.map((l: any) => l.id)).toEqual(["p1"]);
    expect(json.data[0].suggestion).toEqual({ meaning: "transfer", other_account_id: "cash-husband", label: "Rút tiền mặt" });
  });

  it("status khác 'pending' bị từ chối", async () => {
    const { status, json } = await call("GET", "/v1/logs?status=assigned");
    expect(status).toBe(400);
    expect(json.error?.code).toBe("invalid_status");
  });
});

describe("POST /v1/logs/:id/assign", () => {
  it("tổng splits khớp số tiền log → 201, tạo transaction, log 'assigned'", async () => {
    seedLog("a1", "out", 150_000, "vcb-husband");
    const { status, json } = await call("POST", "/v1/logs/a1/assign", { splits: [{ meaning: "spend", amount: 150_000, category_id: "groceries" }] });
    expect(status).toBe(201);
    expect(json.data.log.status).toBe("assigned");
    expect(json.data.transactions).toHaveLength(1);
  });

  it("mỗi dòng gán mang ghi chú riêng; ghi chú lưu vào giao dịch, dòng không ghi thì để trống", async () => {
    seedLog("food", "out", 35_700, "vcb-husband");
    const { status, json } = await call("POST", "/v1/logs/food/assign", {
      splits: [
        { meaning: "spend", amount: 30_000, category_id: "groceries", note: "mua rau, thịt cho bữa tối" },
        { meaning: "spend", amount: 5_700, category_id: "groceries" },
      ],
    });
    expect(status).toBe(201);
    const byAmount = Object.fromEntries(json.data.transactions.map((t: { amount: number; note: string | null }) => [t.amount, t.note]));
    expect(byAmount).toEqual({ 30000: "mua rau, thịt cho bữa tối", 5700: null });
  });

  it("tổng splits không khớp → 400 split_mismatch", async () => {
    seedLog("a2", "out", 150_000, "vcb-husband");
    const { status, json } = await call("POST", "/v1/logs/a2/assign", { splits: [{ meaning: "spend", amount: 100_000, category_id: "groceries" }] });
    expect(status).toBe(400);
    expect(json.error?.code).toBe("split_mismatch");
  });

  it("tách một log thành nhiều dòng, tổng vẫn phải đúng", async () => {
    seedLog("a3", "out", 200_000, "vcb-husband");
    const { status, json } = await call("POST", "/v1/logs/a3/assign", {
      splits: [
        { meaning: "spend", amount: 120_000, category_id: "groceries" },
        { meaning: "spend", amount: 80_000, category_id: "fuel-parking" },
      ],
    });
    expect(status).toBe(201);
    expect(json.data.transactions).toHaveLength(2);
  });

  it("gán kèm create_rule tạo luôn rule cho lần sau; income bị từ chối vì luật 6", async () => {
    seedLog("a4", "out", 77_000, "vcb-husband", { content: "MOMO nap tien" });
    const { status, json } = await call("POST", "/v1/logs/a4/assign", {
      splits: [{ meaning: "spend", amount: 77_000, category_id: "shopping" }],
      create_rule: { match_type: "content", pattern: "MOMO" },
    });
    expect(status).toBe(201);
    expect(json.data.rule).toMatchObject({ match_type: "content", pattern: "MOMO", meaning: "spend" });

    seedLog("a5", "in", 500_000, "vcb-husband");
    const rejected = await call("POST", "/v1/logs/a5/assign", { splits: [{ meaning: "income", amount: 500_000 }], create_rule: { match_type: "content", pattern: "X" } });
    expect(rejected.status).toBe(400);
    expect(rejected.json.error?.code).toBe("rule_not_allowed");
    // Bị từ chối thì KHÔNG được ghi sổ nửa chừng: log vẫn chờ gán, chưa có giao dịch nào.
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'a5'").get()).toEqual({ status: "pending" });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE log_id = 'a5'").get()).toEqual({ n: 0 });
  });

  it("create_rule dạng true/false như PWA gửi: false không tạo rule, true tự rút mẫu từ nội dung", async () => {
    seedLog("b1", "out", 45_000, "vcb-husband", { content: "CT DEN:123456789 GRAB VIETNAM THANH TOAN 0908" });
    const none = await call("POST", "/v1/logs/b1/assign", { splits: [{ meaning: "spend", amount: 45_000, category_id: "ride-hailing" }], create_rule: false });
    expect(none.status).toBe(201);
    expect(none.json.data).toMatchObject({ rule: null, ruleSkipped: null });

    seedLog("b2", "out", 52_000, "vcb-husband", { content: "CT DEN:987654321 GRAB VIETNAM THANH TOAN 0911" });
    const auto = await call("POST", "/v1/logs/b2/assign", { splits: [{ meaning: "spend", amount: 52_000, category_id: "ride-hailing" }], create_rule: true });
    expect(auto.status).toBe(201);
    expect(auto.json.data.rule).toMatchObject({ match_type: "content", pattern: "GRAB VIETNAM THANH TOAN", meaning: "spend" });

    // Rule vừa tạo phải khớp được lần chuyển sau, dù mã giao dịch và số đuôi khác hẳn.
    const { matchRule } = await import("../src/domain/rules");
    const saved = { id: 1, priority: 100, matchType: "content" as const, pattern: "GRAB VIETNAM THANH TOAN", meaning: "spend" as const, isSalary: false, categoryId: "ride-hailing", byMemberId: null };
    expect(matchRule([saved], "out", "CT DEN:555000111 GRAB VIETNAM THANH TOAN 0930", null)).toEqual(saved);
  });

  it("create_rule: true với tiền vào thì vẫn gán được, chỉ báo không tạo rule", async () => {
    seedLog("b4", "in", 300_000, "vcb-husband", { content: "HOAN TIEN DON HANG" });
    const res = await call("POST", "/v1/logs/b4/assign", { splits: [{ meaning: "refund", amount: 300_000 }], create_rule: true });
    expect(res.status).toBe(201);
    expect(res.json.data.rule).toBeNull();
    expect(res.json.data.ruleSkipped).toMatch(/tiền vào luôn phải hỏi/);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'b4'").get()).toEqual({ status: "assigned" });
  });

  it("mẫu rule tự rút: ưu tiên mã [QE]xx; nội dung toàn số thì không có mẫu", async () => {
    const { suggestRulePattern } = await import("../src/domain/rules");
    expect(suggestRulePattern("chuyen tien an trua EAN 0912")).toEqual({ matchType: "code", pattern: "EAN" });
    expect(suggestRulePattern("123456 789 0001")).toBeNull();
    expect(suggestRulePattern("Đổ xăng Petrolimex 12/9")).toEqual({ matchType: "content", pattern: "DO XANG PETROLIMEX" });
  });

  it("log đã xử lý rồi thì không gán lại được", async () => {
    seedLog("a6", "out", 1_000, "vcb-husband", { status: "ignored" });
    const { status, json } = await call("POST", "/v1/logs/a6/assign", { splits: [{ meaning: "spend", amount: 1_000, category_id: "groceries" }] });
    expect(status).toBe(409);
    expect(json.error?.code).toBe("not_pending");
  });

  it("gán log tiền ra thành khoản trả nợ (debt_id) làm giảm số còn nợ", async () => {
    expect((await call("POST", "/v1/debts", { name: "Cô Lan", amount: 5_000_000, at: "2026-09-20T02:00:00.000Z" })).status).toBe(201);
    seedLog("d1", "out", 2_000_000, "vcb-husband", { content: "CK TRA NO CO BA" });
    const { status, json } = await call("POST", "/v1/logs/d1/assign", { splits: [{ meaning: "spend", amount: 2_000_000, debt_id: "co-lan" }] });
    expect(status).toBe(201);
    expect(json.data.transactions[0]).toMatchObject({ debt_id: "co-lan", category_id: "debt-payment", source: "sepay" });
    const debts = (await call("GET", "/v1/debts")).json.data;
    expect(debts.debts[0]).toMatchObject({ id: "co-lan", paid: 2_000_000, balance: 3_000_000 });
    expect(debts.debts[0].payments).toMatchObject([{ amount: 2_000_000, accountId: "vcb-husband", source: "sepay" }]);

    seedLog("d2", "out", 1_000, "vcb-husband");
    const wrong = await call("POST", "/v1/logs/d2/assign", { splits: [{ meaning: "transfer", amount: 1_000, other_account_id: "cash-husband", debt_id: "co-lan" }] });
    expect(wrong.json.error?.code).toBe("debt_spend_only");
  });

  it("gán log tiền vào là nhận lại tiền cho vay (collect): trừ khoản phải thu, không thành thu nhập, không kỳ, không ví", async () => {
    expect((await call("POST", "/v1/receivables", { name: "Em Hai", amount: 3_000_000, at: "2026-09-20T02:00:00.000Z" })).status).toBe(201);
    seedLog("c1", "in", 1_000_000, "vcb-husband", { content: "EM HAI TRA TIEN" });
    const { status, json } = await call("POST", "/v1/logs/c1/assign", { splits: [{ meaning: "collect", amount: 1_000_000, receivable_id: "em-hai" }] });
    expect(status).toBe(201);
    const tx = json.data.transactions[0];
    expect(tx).toMatchObject({ meaning: "collect", receivable_id: "em-hai", counter_account_id: "vcb-husband", account_id: null, source: "sepay" });
    expect(json.data.effects).toEqual({ cycle: null, tasksDone: [] });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning IN ('income', 'fund')").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT COUNT(*) n FROM pay_cycles").get()).toEqual({ n: 0 });
    const receivable = (await call("GET", "/v1/receivables")).json.data.receivables[0];
    expect(receivable).toMatchObject({ id: "em-hai", lent: 3_000_000, collected: 1_000_000, balance: 2_000_000 });
    expect(receivable.movements).toMatchObject([{ kind: "collect", amount: 1_000_000, accountId: "vcb-husband", source: "sepay" }]);

    seedLog("c2", "in", 1_000, "vcb-husband");
    const wrong = await call("POST", "/v1/logs/c2/assign", { splits: [{ meaning: "refund", amount: 1_000, category_id: "groceries", receivable_id: "em-hai" }] });
    expect(wrong.json.error?.code).toBe("receivable_only");
  });
});

describe("trả lại cho khoản chi khi gán (change 261004-gan-tham-chieu)", () => {
  afterEach(() => vi.useRealTimers());

  /** Gán một log tiền ra thành khoản chi y tế (vd hoá đơn thuốc 244.000). Trả id giao dịch. */
  async function spend(logId: string, amount: number, opts: { content?: string; at?: string } = {}) {
    seedLog(logId, "out", amount, "vcb-husband", opts);
    const res = await call("POST", `/v1/logs/${logId}/assign`, { splits: [{ meaning: "spend", amount, category_id: "health" }] });
    expect(res.status).toBe(201);
    return res.json.data.transactions[0].id as number;
  }

  it("gán log tiền vào là hoàn tiền có link_id: nối khoản chi gốc, danh mục theo khoản gốc, không ví", async () => {
    const spendId = await spend("s1", 244_000, { content: "NHA THUOC LONG CHAU" });
    seedLog("r1", "in", 250_000, "vcb-husband", { content: "CHI LAN TRA TIEN THUOC" });
    const { status, json } = await call("POST", "/v1/logs/r1/assign", { splits: [{ meaning: "refund", amount: 250_000, link_id: spendId }] });
    expect(status).toBe(201);
    expect(json.data.transactions[0]).toMatchObject({ meaning: "refund", amount: 250_000, link_id: spendId, category_id: "health", counter_account_id: "vcb-husband", source: "sepay" });
  });

  it("link_id phải trỏ về khoản chi còn hiệu lực: không thì invalid_link (như nhập tay), log vẫn chờ, không ghi gì", async () => {
    seedLog("i1", "in", 1_000_000, "vcb-husband");
    const income = (await call("POST", "/v1/logs/i1/assign", { splits: [{ meaning: "income", amount: 1_000_000 }] })).json.data.transactions[0].id;
    seedLog("r2", "in", 50_000, "vcb-husband");
    const txBefore = raw.prepare("SELECT COUNT(*) n FROM transactions").get();
    for (const link_id of [income, 9_999]) {
      const res = await call("POST", "/v1/logs/r2/assign", { splits: [{ meaning: "refund", amount: 50_000, link_id }] });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("invalid_link");
    }
    const typo = await call("POST", "/v1/logs/r2/assign", { splits: [{ meaning: "refund", amount: 50_000, link_id: "12" }] });
    expect(typo.json.error?.code).toBe("invalid_input");
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual(txBefore);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'r2'").get()).toEqual({ status: "pending" });
  });

  it("GET /v1/transactions/link-candidates?meaning=spend: khoản chi còn hiệu lực 30 ngày gần nhất, mới nhất trước, kèm danh mục, nội dung ngân hàng (khoản v2 không ví)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T05:00:00.000Z"));
    await spend("old", 100_000, { at: "2026-09-01T02:00:00.000Z" });
    const drug = await spend("s2", 244_000, { content: "NHA THUOC LONG CHAU", at: "2026-10-03T02:00:00.000Z" });
    const lunch = await spend("s3", 80_000, { at: "2026-10-02T02:00:00.000Z" });
    raw.prepare("UPDATE transactions SET status = 'void' WHERE id = ?").run(lunch);
    seedLog("i2", "in", 500_000, "vcb-husband", { at: "2026-10-03T03:00:00.000Z" });
    await call("POST", "/v1/logs/i2/assign", { splits: [{ meaning: "income", amount: 500_000 }] });

    const { status, json } = await call("GET", "/v1/transactions/link-candidates?meaning=spend&days=30");
    expect(status).toBe(200);
    expect(json.data).toEqual([
      {
        id: drug,
        at: "2026-10-03T02:00:00.000Z",
        amount: 244_000,
        category_id: "health",
        category_name: "Y tế (khám, thuốc, TPCN)",
        receivable_id: null,
        receivable_name: null,
        note: null,
        bank_content: "NHA THUOC LONG CHAU",
      },
    ]);
    expect((await call("GET", "/v1/transactions/link-candidates?meaning=spend&days=0")).json.error?.code).toBe("invalid_input");
  });
});

describe("trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc)", () => {
  afterEach(() => vi.useRealTimers());

  async function person(name: string) {
    const res = await call("POST", "/v1/receivables", { name, amount: 0 });
    expect(res.status).toBe(201);
    return res.json.data.id as string;
  }
  /** Gán một log tiền ra / vào thành một dòng; trả id giao dịch. */
  async function assign(logId: string, direction: "in" | "out", split: Record<string, unknown>, opts: { content?: string; at?: string } = {}) {
    seedLog(logId, direction, split.amount as number, "vcb-husband", opts);
    const res = await call("POST", `/v1/logs/${logId}/assign`, { splits: [split] });
    expect(res.status).toBe(201);
    return res.json.data.transactions[0].id as number;
  }
  const balanceOf = async (id: string) => (await call("GET", "/v1/receivables")).json.data.receivables.find((r: { id: string }) => r.id === id).balance;

  it("gán log tiền vào là nhận lại có link_id về khoản cho vay: lấy người của khoản cho vay; khác người hay trỏ khoản chi → invalid_link, log vẫn chờ", async () => {
    const lan = await person("Chị Lan");
    const hai = await person("Em Hai");
    const lend = await assign("l1", "out", { meaning: "lend", amount: 1_000_000, receivable_id: lan });
    const spendId = await assign("s1", "out", { meaning: "spend", amount: 244_000, category_id: "health" });

    seedLog("c1", "in", 600_000, "vcb-husband", { content: "CHI LAN TRA TIEN" });
    const { status, json } = await call("POST", "/v1/logs/c1/assign", { splits: [{ meaning: "collect", amount: 600_000, link_id: lend }] });
    expect(status).toBe(201);
    expect(json.data.transactions[0]).toMatchObject({ meaning: "collect", amount: 600_000, link_id: lend, receivable_id: lan, category_id: null });
    expect(await balanceOf(lan)).toBe(400_000);

    seedLog("c2", "in", 100_000, "vcb-husband");
    const txBefore = raw.prepare("SELECT COUNT(*) n FROM transactions").get();
    for (const split of [{ link_id: lend, receivable_id: hai }, { link_id: spendId }]) {
      const res = await call("POST", "/v1/logs/c2/assign", { splits: [{ meaning: "collect", amount: 100_000, ...split }] });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("invalid_link");
    }
    expect((await call("POST", "/v1/logs/c2/assign", { splits: [{ meaning: "refund", amount: 100_000, link_id: lend }] })).json.error?.code).toBe("invalid_link");
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual(txBefore);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'c2'").get()).toEqual({ status: "pending" });
  });

  it("mua hộ là cho vay (ADR-84): trả dư thì tách Nhận lại đúng số còn nợ + Thu nhập phần dư — hết nợ, chi tiêu không đổi", async () => {
    const lan = await person("Chị Lan");
    const spent = () => raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning IN ('spend', 'refund')").get();
    const spentBefore = spent();
    const lend = await assign("l1", "out", { meaning: "lend", amount: 244_000, receivable_id: lan }, { content: "NHA THUOC LONG CHAU" });
    seedLog("c1", "in", 250_000, "vcb-husband", { content: "CHI LAN TRA TIEN THUOC" });
    const { status, json } = await call("POST", "/v1/logs/c1/assign", {
      splits: [
        { meaning: "collect", amount: 244_000, link_id: lend },
        { meaning: "income", amount: 6_000 },
      ],
    });
    expect(status).toBe(201);
    const byMeaning = (m: string) => json.data.transactions.find((t: { meaning: string }) => t.meaning === m);
    expect(json.data.transactions).toHaveLength(2);
    expect(byMeaning("collect")).toMatchObject({ amount: 244_000, link_id: lend, receivable_id: lan });
    expect(byMeaning("income")).toMatchObject({ amount: 6_000 });
    expect(await balanceOf(lan)).toBe(0);
    expect(spent()).toEqual(spentBefore);
  });

  it("GET /v1/transactions/link-candidates?meaning=lend: khoản cho vay còn hiệu lực trong số ngày hỏi, mới nhất trước, kèm người vay; meaning hay days sai → invalid_input", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T05:00:00.000Z"));
    const lan = await person("Chị Lan");
    await assign("l0", "out", { meaning: "lend", amount: 300_000, receivable_id: lan }, { at: "2026-03-01T02:00:00.000Z" });
    const recent = await assign("l1", "out", { meaning: "lend", amount: 1_000_000, receivable_id: lan, note: "mượn sửa xe" }, { at: "2026-06-01T02:00:00.000Z", content: "CK CHI LAN" });
    const voided = await assign("l2", "out", { meaning: "lend", amount: 50_000 }, { at: "2026-10-01T02:00:00.000Z" });
    raw.prepare("UPDATE transactions SET status = 'void' WHERE id = ?").run(voided);
    await assign("s1", "out", { meaning: "spend", amount: 244_000, category_id: "health" }, { at: "2026-10-04T02:00:00.000Z" });

    const { status, json } = await call("GET", "/v1/transactions/link-candidates?meaning=lend&days=180");
    expect(status).toBe(200);
    expect(json.data).toEqual([
      {
        id: recent,
        at: "2026-06-01T02:00:00.000Z",
        amount: 1_000_000,
        category_id: "lending",
        category_name: expect.any(String),
        receivable_id: lan,
        receivable_name: "Chị Lan",
        note: "mượn sửa xe",
        bank_content: "CK CHI LAN",
      },
    ]);
    for (const q of ["", "?meaning=income&days=30", "?meaning=lend&days=400"]) {
      expect((await call("GET", `/v1/transactions/link-candidates${q}`)).json.error?.code).toBe("invalid_input");
    }
  });

  it("GET /v1/transactions/:id: khoản gốc kèm các khoản còn hiệu lực đã trả về nó (linked_from), khoản trả về kèm tóm tắt khoản gốc (link)", async () => {
    const lan = await person("Chị Lan");
    const spendId = await assign("s1", "out", { meaning: "spend", amount: 244_000, category_id: "health" }, { at: "2026-10-04T02:00:00.000Z" });
    const refund = await assign("r1", "in", { meaning: "refund", amount: 250_000, link_id: spendId }, { at: "2026-10-05T02:00:00.000Z" });
    const lend = await assign("l1", "out", { meaning: "lend", amount: 1_000_000, receivable_id: lan }, { at: "2026-09-15T02:00:00.000Z" });
    const collect = await assign("c1", "in", { meaning: "collect", amount: 600_000, link_id: lend }, { at: "2026-10-01T02:00:00.000Z" });
    const income = await assign("i1", "in", { meaning: "income", amount: 5_000_000 });
    const view = async (id: number) => (await call("GET", `/v1/transactions/${id}`)).json.data;

    expect(await view(spendId)).toMatchObject({ id: spendId, meaning: "spend", link: null, linked_from: [{ id: refund, at: "2026-10-05T02:00:00.000Z", amount: 250_000, meaning: "refund" }] });
    expect((await view(refund)).link).toEqual({ id: spendId, at: "2026-10-04T02:00:00.000Z", amount: 244_000, meaning: "spend", status: "active", category_name: "Y tế (khám, thuốc, TPCN)", receivable_name: null });
    expect((await view(refund)).linked_from).toEqual([]);
    expect((await view(lend)).linked_from).toEqual([{ id: collect, at: "2026-10-01T02:00:00.000Z", amount: 600_000, meaning: "collect" }]);
    expect((await view(collect)).link).toMatchObject({ id: lend, amount: 1_000_000, meaning: "lend", receivable_name: "Chị Lan" });
    expect((await view(income)).linked_from).toEqual([]);

    expect((await call("POST", `/v1/logs/transactions/${collect}/void`)).status).toBe(200);
    expect((await view(lend)).linked_from).toEqual([]);
  });
});

describe("Gán thu nhập không ví, kỳ lương (ingest UC-305 AC-33, ledger UC-103)", () => {
  const snapshot = async () => (await call("GET", "/v1/snapshot")).json.data;

  it("UC-305 AC-33: gán thu nhập nguồn mở kỳ → khoản thu không ví, kỳ mở, effects báo kỳ mới; snapshot không còn khoản thu chưa chia", async () => {
    seedLog("u1", "in", 20_000_000, "vcb-husband", { content: "chuyen khoan nhanh qua Zalo" });
    const { status, json } = await call("POST", "/v1/logs/u1/assign", { splits: [{ meaning: "income", amount: 20_000_000, income_stream_id: "salary-husband" }] });
    expect(status).toBe(201);
    expect(json.data.transactions[0]).toMatchObject({ meaning: "income", amount: 20_000_000 });
    expect(json.data.transactions[0]).not.toHaveProperty("wallet_id");
    expect(json.data.effects.cycle).toMatchObject({ opened: true, startedAt: "2026-09-22T02:00:00.000Z" });
    expect(raw.prepare("SELECT COUNT(*) n FROM pay_cycles WHERE status = 'active'").get()).toEqual({ n: 1 });
    expect((await snapshot()).attention).not.toHaveProperty("unallocatedIncome");
  });

  it("UC-305 AC-33: opens_cycle: false → không kỳ; transfer_order_id ở thân hay wallet_id / from_wallet_id / wealth_move / allocate / earmark_id ở dòng → 400 model_changed, không ghi gì", async () => {
    seedLog("u2", "in", 20_000_000, "vcb-husband");
    const income = { meaning: "income", amount: 20_000_000, income_stream_id: "salary-husband" };
    for (const [body, fields] of [
      [{ transfer_order_id: 41, splits: [income] }, ["transfer_order_id"]],
      [{ splits: [{ ...income, wallet_id: "income" }] }, ["wallet_id"]],
      [{ splits: [{ ...income, from_wallet_id: "rental-income" }] }, ["from_wallet_id"]],
      [{ splits: [{ ...income, wealth_move: "fund" }] }, ["wealth_move"]],
      [{ splits: [{ ...income, allocate: true }] }, ["allocate"]],
      [{ splits: [{ meaning: "spend", amount: 20_000_000, category_id: "groceries", earmark_id: "tuition" }] }, ["earmark_id"]],
    ] as const) {
      const res = await call("POST", "/v1/logs/u2/assign", body);
      expect(res.status).toBe(400);
      expect(res.json.error).toMatchObject({ code: "model_changed", fields });
    }
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });
    const res = await call("POST", "/v1/logs/u2/assign", { splits: [{ ...income, opens_cycle: false }] });
    expect(res.status).toBe(201);
    expect(res.json.data.effects.cycle).toBeNull();
    expect(raw.prepare("SELECT COUNT(*) n FROM pay_cycles").get()).toEqual({ n: 0 });
  });
});

describe("lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán (ledger UC-103, UC-106 — ADR-87)", () => {
  it("snapshot và /v1/accounts: lệch khi bookDrift ≠ 0; log chưa gán (bookDrift 0) và tài khoản không có log (null) không lệch; không còn số ngân hàng báo", async () => {
    seedLog("r1", "out", 300_000, "vcb-husband");
    raw
      .prepare(
        `INSERT INTO transactions (log_id, at, amount, meaning, account_id, category_id, week_key, month_key)
         VALUES ('r1', '2026-09-22T02:00:00.000Z', 250000, 'spend', 'vcb-husband', 'groceries', '2026-W39', '2026-09')`,
      )
      .run();
    raw.prepare("UPDATE bank_logs SET status = 'assigned' WHERE id = 'r1'").run();
    seedLog("r2", "in", 100_000, "tcb-husband");

    const snap = (await call("GET", "/v1/snapshot")).json.data;
    expect(snap.attention.drift).toEqual([{ accountId: "vcb-husband", name: expect.any(String), bookDrift: 50_000 }]);

    const rows = (await call("GET", "/v1/accounts")).json.data as Record<string, unknown>[];
    const byId = (id: string) => rows.find((r) => r.accountId === id)!;
    expect(byId("vcb-husband")).toMatchObject({ bookDrift: 50_000, pendingCount: 0 });
    expect(byId("tcb-husband")).toMatchObject({ bookDrift: 0, pendingCount: 1, pendingNet: 100_000 });
    expect(byId("cash-husband")).toMatchObject({ bookDrift: null });
    for (const r of rows) {
      expect(r).not.toHaveProperty("bankBalance");
      expect(r).not.toHaveProperty("feedDrift");
    }
  });
});

describe("POST /v1/logs/:id/ignore", () => {
  it("chuyển log sang ignored", async () => {
    seedLog("i1", "out", 1_000, "vcb-husband");
    const { status, json } = await call("POST", "/v1/logs/i1/ignore");
    expect(status).toBe(200);
    expect(json.data.status).toBe("ignored");
  });

  it("log không tồn tại → 404", async () => {
    const { status } = await call("POST", "/v1/logs/khong-co/ignore");
    expect(status).toBe(404);
  });
});

describe("POST /v1/logs/pair — ghép tay khi thuật toán bỏ sót", () => {
  it("ghép đúng 2 log ngược hướng cùng tiền thành 1 transfer", async () => {
    seedLog("pa", "out", 900_000, "vcb-husband");
    seedLog("pb", "in", 900_000, "tcb-husband");
    const { status, json } = await call("POST", "/v1/logs/pair", { log_a: "pa", log_b: "pb" });
    expect(status).toBe(201);
    const tx = raw.prepare("SELECT meaning, account_id, counter_account_id FROM transactions WHERE id = ?").get(json.data.transactionId);
    expect(tx).toEqual({ meaning: "transfer", account_id: "vcb-husband", counter_account_id: "tcb-husband" });
  });

  it("khác số tiền thì từ chối", async () => {
    seedLog("pc", "out", 900_000, "vcb-husband");
    seedLog("pd", "in", 800_000, "tcb-husband");
    const { status, json } = await call("POST", "/v1/logs/pair", { log_a: "pc", log_b: "pd" });
    expect(status).toBe(400);
    expect(json.error?.code).toBe("amount_mismatch");
  });
});

describe("POST /v1/logs/transactions/:txId/void — gỡ cặp/gỡ gán", () => {
  it("huỷ giao dịch sinh từ log rồi trả các log về pending", async () => {
    seedLog("va", "out", 300_000, "vcb-husband");
    seedLog("vb", "in", 300_000, "tcb-husband");
    const paired = await call("POST", "/v1/logs/pair", { log_a: "va", log_b: "vb" });
    const { status, json } = await call("POST", `/v1/logs/transactions/${paired.json.data.transactionId}/void`);
    expect(status).toBe(200);
    expect(json.data.logs.sort()).toEqual(["va", "vb"]);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'va'").get()).toEqual({ status: "pending" });
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'vb'").get()).toEqual({ status: "pending" });
  });
});

describe("GET/POST /v1/rules", () => {
  it("liệt kê rule đã seed (bao gồm EAN, EXE, EMS, LUONG THANG)", async () => {
    const { json } = await call("GET", "/v1/rules");
    const patterns = json.data.map((r: any) => r.pattern);
    expect(patterns).toEqual(expect.arrayContaining(["EAN", "EXE", "EMS", "LUONG THANG"]));
  });

  it("UC-307 AC-23: tạo rule chi kèm wallet_id / from_wallet_id → 400 model_changed; không ví → 201", async () => {
    for (const old of [{ wallet_id: "fun-husband" }, { from_wallet_id: "nice-to-have" }]) {
      const bad = await call("POST", "/v1/rules", { match_type: "code", pattern: "ENT", meaning: "spend", category_id: "entertainment", ...old });
      expect(bad.status).toBe(400);
      expect(bad.json.error).toMatchObject({ code: "model_changed", fields: Object.keys(old) });
    }
    const { status, json } = await call("POST", "/v1/rules", { match_type: "code", pattern: "ENT", meaning: "spend", category_id: "entertainment" });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ pattern: "ENT", meaning: "spend" });
    expect(json.data).not.toHaveProperty("wallet_id");
  });

  it("UC-307 AC-23: rule chi cũ có wallet_id mà không category_id → log chờ; PATCH { wallet_id } → 400 model_changed; PATCH { category_id } → lưu, log sau khớp thành khoản chi không ví", async () => {
    raw.prepare("UPDATE rules SET category_id = NULL WHERE pattern = 'EAN'").run();
    const id = (raw.prepare("SELECT id FROM rules WHERE pattern = 'EAN'").get() as { id: number }).id;
    const hook = (logId: string, at: string) => ({ id: logId, gateway: "Vietcombank", transactionDate: at, accountNumber: "0011xxxxxxx", code: "EAN", content: "EAN AN TRUA", transferType: "out", transferAmount: 90_000, referenceCode: logId });
    const ingest = (logId: string, at: string) => ingestLog(env.DB, parseWebhookPayload(hook(logId, at)), "webhook", new Date("2026-09-22T05:00:00.000Z"));
    await ingest("e1", "2026-09-22 09:00:00");
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'e1'").get()).toEqual({ status: "pending" });

    const bad = await call("PATCH", `/v1/settings/rules/${id}`, { wallet_id: "food" });
    expect(bad.status).toBe(400);
    expect(bad.json.error?.code).toBe("model_changed");
    expect((await call("PATCH", `/v1/settings/rules/${id}`, { category_id: "eating-out" })).status).toBe(200);
    await ingest("e2", "2026-09-22 11:00:00");
    expect(raw.prepare("SELECT meaning, category_id FROM transactions WHERE log_id = 'e2'").get()).toEqual({
      meaning: "spend",
      category_id: "eating-out",
    });
  });

  it("tạo rule income mà không is_salary → từ chối (luật 6)", async () => {
    const { status, json } = await call("POST", "/v1/rules", { match_type: "content", pattern: "THUONG", meaning: "income" });
    expect(status).toBe(400);
    expect(json.error?.code).toBe("income_needs_salary");
  });

  it("match_type không hợp lệ → từ chối", async () => {
    const { status, json } = await call("POST", "/v1/rules", { match_type: "foo", pattern: "X", meaning: "spend" });
    expect(status).toBe(400);
    expect(json.error?.code).toBe("invalid_match_type");
  });
});

describe("Gán: nối log vào khoản đã nhập tay (261017-webhook-truoc-moc)", () => {
  const manual = (amount: number, at: string, meaning = "spend", note: string | null = "đi chợ") =>
    (
      raw
        .prepare(
          `INSERT INTO transactions (at, amount, meaning, account_id, category_id, week_key, month_key, source, note)
           VALUES (?, ?, ?, 'vcb-husband', 'groceries', '2026-W39', '2026-09', 'manual', ?) RETURNING id`,
        )
        .get(at, amount, meaning, note) as { id: number }
    ).id;
  const txRow = (id: number) => raw.prepare("SELECT status, log_id, log_id_2, category_id, source, note FROM transactions WHERE id = ?").get(id);
  const logStatus = (id: string) => (raw.prepare("SELECT status FROM bank_logs WHERE id = ?").get(id) as { status: string }).status;

  it("UC-305 AC-27: log chờ 500.000, khoản tay khớp → hiện trong 'Đã nhập tay?' (không trường ví); Nối → log đã gán, giao dịch giữ hạng mục; gỡ gán → giao dịch còn, log chờ lại", async () => {
    const hit = manual(500_000, "2026-09-21T13:00:00.000Z");
    const other = manual(300_000, "2026-09-22T01:00:00.000Z");
    manual(500_000, "2026-09-18T01:00:00.000Z"); // quá 1 ngày
    raw.prepare(
      `INSERT INTO transactions (at, amount, meaning, account_id, week_key, month_key, source)
       VALUES ('2026-09-22T01:00:00.000Z', 500000, 'adjust', 'vcb-husband', '2026-W39', '2026-09', 'manual')`,
    ).run();
    seedLog("m1", "out", 500_000, "vcb-husband");

    const list = await call("GET", "/v1/logs?status=pending");
    expect(list.json.data[0].manual_matches).toEqual([
      { id: hit, at: "2026-09-21T13:00:00.000Z", amount: 500_000, meaning: "spend", category_id: "groceries", account_id: "vcb-husband", counter_account_id: null, note: "đi chợ" },
    ]);
    expect(list.json.data[0]).not.toHaveProperty("order_matches");

    const wrong = await call("POST", "/v1/logs/m1/link", { transaction_id: other });
    expect(wrong.status).toBe(409);
    expect(wrong.json.error?.code).toBe("link_mismatch");
    expect(logStatus("m1")).toBe("pending");

    const linked = await call("POST", "/v1/logs/m1/link", { transaction_id: hit });
    expect(linked.status).toBe(200);
    expect(linked.json.data).toMatchObject({ log: { id: "m1", status: "assigned" }, transaction: { id: hit, log_id: "m1" } });
    expect(txRow(hit)).toEqual({ status: "active", log_id: "m1", log_id_2: null, category_id: "groceries", source: "manual", note: "đi chợ" });
    expect((await call("GET", "/v1/logs?status=pending")).json.data).toEqual([]);
    // Nối lần hai: log không còn chờ.
    expect((await call("POST", "/v1/logs/m1/link", { transaction_id: hit })).status).toBe(409);

    const undone = await call("POST", `/v1/logs/transactions/${hit}/void`, {});
    expect(undone.status).toBe(200);
    expect(undone.json.data).toEqual({ voided: [], logs: ["m1"] });
    expect(txRow(hit)).toMatchObject({ status: "active", log_id: null });
    expect(logStatus("m1")).toBe("pending");
  });

  it("UC-305 AC-27: khoản tay tách dòng (500.000 + 300.000 cho log 800.000) không nằm trong 'Đã nhập tay?' và không nối được", async () => {
    const a = manual(500_000, "2026-09-22T01:00:00.000Z");
    manual(300_000, "2026-09-22T01:00:00.000Z");
    seedLog("m2", "out", 800_000, "vcb-husband");
    expect((await call("GET", "/v1/logs?status=pending")).json.data[0].manual_matches).toEqual([]);
    expect((await call("POST", "/v1/logs/m2/link", { transaction_id: a })).json.error?.code).toBe("link_mismatch");
    expect((await call("POST", "/v1/logs/m2/link", { transaction_id: "x" })).status).toBe(400);
  });
});

describe("Gán lãi tiền gửi qua REST (261018-lai-tien-gui)", () => {
  it("UC-305 AC-28: split { meaning: income, interest: true } → 201, khoản thu Thu nhập thụ động, không fund; kèm wallet_id → 400 model_changed; log tiền ra → 400 invalid_input; không ghi gì khi lỗi", async () => {
    seedLog("li", "in", 37, "vcb-husband", { content: "BankAPINotify" });
    seedLog("lo", "out", 37, "vcb-husband");
    const bad = await call("POST", "/v1/logs/li/assign", { splits: [{ meaning: "income", amount: 37, interest: true, wallet_id: "nice-to-have" }] });
    expect(bad.status).toBe(400);
    expect(bad.json.error?.code).toBe("model_changed");
    const out = await call("POST", "/v1/logs/lo/assign", { splits: [{ meaning: "income", amount: 37, interest: true }] });
    expect(out.status).toBe(400);
    expect(out.json.error?.code).toBe("invalid_input");
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual({ n: 0 });

    const { status, json } = await call("POST", "/v1/logs/li/assign", { splits: [{ meaning: "income", amount: 37, interest: true }] });
    expect(status).toBe(201);
    const id = json.data.transactions[0].id;
    expect(json.data.transactions[0]).toMatchObject({ meaning: "income", counter_account_id: "vcb-husband" });
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning = 'fund'").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT report_class FROM transaction_report_classes WHERE transaction_id = ?").get(id)).toEqual({ report_class: "passive_income" });
  });
});

describe("Gán: tài khoản riêng tư (access UC-504)", () => {
  it("UC-504 AC-7: GET /v1/logs không trả log chờ của tài khoản riêng tư của người khác; gán log đó → 403 private_account", async () => {
    raw.prepare("UPDATE accounts SET private = 1 WHERE id = 'vcb-wife'").run();
    seedLog("rieng", "out", 120_000, "vcb-wife");
    seedLog("chung", "out", 50_000, "vcb-husband");
    const asHusband = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(
        path,
        { method, headers: { Authorization: "Bearer tok", "X-Member-Id": "husband", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
        env,
      );
      return { status: res.status, json: (await res.json()) as Json };
    };
    expect((await asHusband("GET", "/v1/logs?status=pending")).json.data.map((l: { id: string }) => l.id)).toEqual(["chung"]);
    const res = await asHusband("POST", "/v1/logs/rieng/assign", { splits: [{ meaning: "spend", amount: 120_000, category_id: "groceries" }] });
    expect(res.status).toBe(403);
    expect(res.json.error?.code).toBe("private_account");
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'rieng'").get()).toEqual({ status: "pending" });
  });
});

describe("Log chờ của tài khoản riêng tư ở hộ mẫu P (access UC-504, ADR-133)", () => {
  let db: ReturnType<typeof householdP>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(P_NOW);
    db = householdP();
  });
  afterEach(() => vi.useRealTimers());

  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const statusOf = (id: string) => (db.prepare("SELECT status FROM bank_logs WHERE id = ?").get(id) as { status: string }).status;

  it("UC-504 AC-13: chồng bỏ qua / nối / ghép cặp log của VCB (vợ) → 403 private_account, log vẫn chờ, không ghi gì; vợ bỏ qua → 200 kèm nhật ký log.ignore", async () => {
    const husband = client(db, "husband");
    const txBefore = count("SELECT COUNT(*) AS n FROM transactions");
    const auditBefore = count("SELECT COUNT(*) AS n FROM audit_log");
    for (const [path, body] of [
      ["/v1/logs/L1/ignore", undefined],
      ["/v1/logs/L1/link", { transaction_id: 101 }],
      ["/v1/logs/pair", { log_a: "L2", log_b: "L1" }],
    ] as const) {
      const res = await husband("POST", path, body);
      expect([res.status, res.json.error?.code], path).toEqual([403, "private_account"]);
    }
    expect([statusOf("L1"), statusOf("L2")]).toEqual(["pending", "pending"]);
    expect(count("SELECT COUNT(*) AS n FROM transactions")).toBe(txBefore);
    expect(count("SELECT COUNT(*) AS n FROM audit_log")).toBe(auditBefore);

    const res = await client(db, "wife")("POST", "/v1/logs/L1/ignore");
    expect(res.status).toBe(200);
    expect(statusOf("L1")).toBe("ignored");
    expect(db.prepare("SELECT member_id, action, target, detail FROM audit_log ORDER BY id DESC LIMIT 1").get()).toEqual({
      member_id: "wife",
      action: "log.ignore",
      target: "log:L1",
      detail: null,
    });
  });

  it("UC-504 AC-17: chồng gán chuyển khoản sang VCB (vợ) hay gắn chân hai vào #110 → 403 private_account; gợi ý trỏ VCB (vợ) bị bỏ; vợ gán L8 → gắn vào #110", async () => {
    db.exec(`
      INSERT INTO bank_logs (id, at, amount, direction, account_id, content, status) VALUES
        ('L7', '2026-11-11T03:00:00.000Z', 2000000, 'out', 'vcb-wife', 'CK cho chong', 'pending'),
        ('L8', '2026-11-11T03:05:00.000Z', 2000000, 'in', 'vcb-husband', 'CK tu vo', 'pending');
      INSERT INTO transactions (id, log_id, at, amount, meaning, account_id, counter_account_id, by_member_id, week_key, month_key, source) VALUES
        (110, 'L7', '2026-11-11T03:00:00.000Z', 2000000, 'transfer', 'vcb-wife', 'vcb-husband', 'wife', '2026-W46', '2026-11', 'sepay');
      UPDATE bank_logs SET status = 'assigned' WHERE id = 'L7';
      INSERT INTO rules (priority, match_type, pattern, meaning, is_salary, account_id, counter_account_id) VALUES
        (5, 'content', 'CK DI', 'transfer', 0, 'vcb-husband', 'vcb-wife');
    `);
    const husband = client(db, "husband");
    const txBefore = count("SELECT COUNT(*) AS n FROM transactions");

    const toWife = await husband("POST", "/v1/logs/L2/assign", { splits: [{ meaning: "transfer", amount: 3_000_000, other_account_id: "vcb-wife" }] });
    expect([toWife.status, toWife.json.error?.code]).toEqual([403, "private_account"]);
    const secondLeg = await husband("POST", "/v1/logs/L8/assign", { splits: [{ meaning: "transfer", amount: 2_000_000, other_account_id: "vcb-wife" }] });
    expect([secondLeg.status, secondLeg.json.error?.code]).toEqual([403, "private_account"]);
    expect([statusOf("L2"), statusOf("L8")]).toEqual(["pending", "pending"]);
    expect(db.prepare("SELECT log_id_2 FROM transactions WHERE id = 110").get()).toEqual({ log_id_2: null });
    expect(count("SELECT COUNT(*) AS n FROM transactions")).toBe(txBefore);

    const list = await husband("GET", "/v1/logs?status=pending");
    expect(list.status).toBe(200);
    expect(list.json.data.map((l: { id: string }) => l.id)).toEqual(expect.arrayContaining(["L2", "L8"]));
    expect(list.json.data.filter((l: { suggestion: { other_account_id?: string } | null }) => l.suggestion?.other_account_id === "vcb-wife")).toEqual([]);
    // Vợ vẫn thấy gợi ý chân hai của #110.
    const wife = client(db, "wife");
    const wifeList = await wife("GET", "/v1/logs?status=pending");
    expect(wifeList.json.data.find((l: { id: string }) => l.id === "L8").suggestion).toMatchObject({ other_account_id: "vcb-wife", attach_to_tx: 110 });

    const attached = await wife("POST", "/v1/logs/L8/assign", { splits: [{ meaning: "transfer", amount: 2_000_000, other_account_id: "vcb-wife" }] });
    expect(attached.status).toBe(201);
    expect(attached.json.data.attached).toBe(true);
    expect(db.prepare("SELECT log_id_2 FROM transactions WHERE id = 110").get()).toEqual({ log_id_2: "L8" });
  });
});
