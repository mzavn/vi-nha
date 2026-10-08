import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { asD1, openDb } from "./helpers/d1-sqlite";

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
      splits: [{ meaning: "spend", amount: 77_000, wallet_id: "fun-husband", category_id: "shopping" }],
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
    const saved = { id: 1, priority: 100, matchType: "content" as const, pattern: "GRAB VIETNAM THANH TOAN", meaning: "spend" as const, isSalary: false, walletId: "transport", categoryId: "ride-hailing", byMemberId: null };
    expect(matchRule([saved], "out", "CT DEN:555000111 GRAB VIETNAM THANH TOAN 0930", null)).toEqual(saved);
  });

  it("create_rule: true với tiền vào thì vẫn gán được, chỉ báo không tạo rule", async () => {
    seedLog("b4", "in", 300_000, "vcb-husband", { content: "HOAN TIEN DON HANG" });
    const res = await call("POST", "/v1/logs/b4/assign", { splits: [{ meaning: "refund", amount: 300_000, wallet_id: "nice-to-have" }], create_rule: true });
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

  it("gán log tiền vào là nhận lại tiền cho vay (collect): trừ khoản phải thu, không thành thu nhập, không chia, ví không đổi", async () => {
    expect((await call("POST", "/v1/receivables", { name: "Em Hai", amount: 3_000_000, at: "2026-09-20T02:00:00.000Z" })).status).toBe(201);
    const wallets = () => raw.prepare("SELECT wallet_id, balance FROM v_wallet_balance ORDER BY wallet_id").all();
    const before = wallets();
    seedLog("c1", "in", 1_000_000, "vcb-husband", { content: "EM HAI TRA TIEN" });
    const { status, json } = await call("POST", "/v1/logs/c1/assign", { splits: [{ meaning: "collect", amount: 1_000_000, receivable_id: "em-hai" }] });
    expect(status).toBe(201);
    const tx = json.data.transactions[0];
    expect(tx).toMatchObject({ meaning: "collect", receivable_id: "em-hai", counter_account_id: "vcb-husband", account_id: null, wallet_id: null, counter_wallet_id: null, source: "sepay" });
    expect(wallets()).toEqual(before);
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning IN ('income', 'fund')").get()).toEqual({ n: 0 });
    const allocate = await call("POST", "/v1/allocate", { income_tx_id: tx.id });
    expect(allocate.status).toBe(404);
    expect(allocate.json.error?.code).toBe("not_income");
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
  const coThiTot = "SELECT balance FROM v_wallet_balance WHERE wallet_id = 'nice-to-have'";

  /** Gán một log tiền ra thành khoản chi y tế (vd hoá đơn thuốc 244.000). Trả id giao dịch. */
  async function spend(logId: string, amount: number, opts: { content?: string; at?: string } = {}) {
    seedLog(logId, "out", amount, "vcb-husband", opts);
    const res = await call("POST", `/v1/logs/${logId}/assign`, { splits: [{ meaning: "spend", amount, category_id: "health" }] });
    expect(res.status).toBe(201);
    return res.json.data.transactions[0].id as number;
  }

  it("gán log tiền vào là hoàn tiền có link_id: nối khoản chi gốc, danh mục theo khoản gốc; phần chênh nằm lại trong ví của danh mục", async () => {
    const before = (raw.prepare(coThiTot).get() as { balance: number } | undefined)?.balance ?? 0;
    const spendId = await spend("s1", 244_000, { content: "NHA THUOC LONG CHAU" });
    seedLog("r1", "in", 250_000, "vcb-husband", { content: "CHI LAN TRA TIEN THUOC" });
    const { status, json } = await call("POST", "/v1/logs/r1/assign", { splits: [{ meaning: "refund", amount: 250_000, wallet_id: "nice-to-have", link_id: spendId }] });
    expect(status).toBe(201);
    expect(json.data.transactions[0]).toMatchObject({ meaning: "refund", amount: 250_000, link_id: spendId, category_id: "health", wallet_id: "nice-to-have", counter_account_id: "vcb-husband", source: "sepay" });
    expect(raw.prepare(coThiTot).get()).toEqual({ balance: before + 6_000 });
  });

  it("link_id phải trỏ về khoản chi còn hiệu lực: không thì invalid_link (như nhập tay), log vẫn chờ, không ghi gì", async () => {
    seedLog("i1", "in", 1_000_000, "vcb-husband");
    const income = (await call("POST", "/v1/logs/i1/assign", { splits: [{ meaning: "income", amount: 1_000_000 }] })).json.data.transactions[0].id;
    seedLog("r2", "in", 50_000, "vcb-husband");
    const txBefore = raw.prepare("SELECT COUNT(*) n FROM transactions").get();
    for (const link_id of [income, 9_999]) {
      const res = await call("POST", "/v1/logs/r2/assign", { splits: [{ meaning: "refund", amount: 50_000, wallet_id: "nice-to-have", link_id }] });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("invalid_link");
    }
    const typo = await call("POST", "/v1/logs/r2/assign", { splits: [{ meaning: "refund", amount: 50_000, wallet_id: "nice-to-have", link_id: "12" }] });
    expect(typo.json.error?.code).toBe("invalid_input");
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual(txBefore);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'r2'").get()).toEqual({ status: "pending" });
  });

  it("GET /v1/transactions/link-candidates?meaning=spend: khoản chi còn hiệu lực 30 ngày gần nhất, mới nhất trước, kèm danh mục, ví đã trừ, nội dung ngân hàng", async () => {
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
        wallet_id: "nice-to-have",
        wallet_name: expect.any(String),
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
    expect(json.data.transactions[0]).toMatchObject({ meaning: "collect", amount: 600_000, link_id: lend, receivable_id: lan, wallet_id: null, category_id: null });
    expect(await balanceOf(lan)).toBe(400_000);

    seedLog("c2", "in", 100_000, "vcb-husband");
    const txBefore = raw.prepare("SELECT COUNT(*) n FROM transactions").get();
    for (const split of [{ link_id: lend, receivable_id: hai }, { link_id: spendId }]) {
      const res = await call("POST", "/v1/logs/c2/assign", { splits: [{ meaning: "collect", amount: 100_000, ...split }] });
      expect(res.status).toBe(400);
      expect(res.json.error?.code).toBe("invalid_link");
    }
    expect((await call("POST", "/v1/logs/c2/assign", { splits: [{ meaning: "refund", amount: 100_000, wallet_id: "nice-to-have", link_id: lend }] })).json.error?.code).toBe("invalid_link");
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions").get()).toEqual(txBefore);
    expect(raw.prepare("SELECT status FROM bank_logs WHERE id = 'c2'").get()).toEqual({ status: "pending" });
  });

  it("mua hộ là cho vay (ADR-84): trả dư thì tách Nhận lại đúng số còn nợ + Thu nhập phần dư — hết nợ, phần dư chia được, chi tiêu không đổi", async () => {
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
    expect((await call("POST", "/v1/allocate", { income_tx_id: byMeaning("income").id })).status).toBe(201);
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
        wallet_id: null,
        wallet_name: null,
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
    const refund = await assign("r1", "in", { meaning: "refund", amount: 250_000, wallet_id: "nice-to-have", link_id: spendId }, { at: "2026-10-05T02:00:00.000Z" });
    const lend = await assign("l1", "out", { meaning: "lend", amount: 1_000_000, receivable_id: lan }, { at: "2026-09-15T02:00:00.000Z" });
    const collect = await assign("c1", "in", { meaning: "collect", amount: 600_000, link_id: lend }, { at: "2026-10-01T02:00:00.000Z" });
    const income = await assign("i1", "in", { meaning: "income", amount: 5_000_000 });
    expect((await call("POST", "/v1/allocate", { income_tx_id: income })).status).toBe(201);
    const view = async (id: number) => (await call("GET", `/v1/transactions/${id}`)).json.data;

    expect(await view(spendId)).toMatchObject({ id: spendId, meaning: "spend", link: null, linked_from: [{ id: refund, at: "2026-10-05T02:00:00.000Z", amount: 250_000, meaning: "refund" }] });
    expect((await view(refund)).link).toEqual({ id: spendId, at: "2026-10-04T02:00:00.000Z", amount: 244_000, meaning: "spend", status: "active", category_name: "Y tế (khám, thuốc, TPCN)", receivable_name: null });
    expect((await view(refund)).linked_from).toEqual([]);
    expect((await view(lend)).linked_from).toEqual([{ id: collect, at: "2026-10-01T02:00:00.000Z", amount: 600_000, meaning: "collect" }]);
    expect((await view(collect)).link).toMatchObject({ id: lend, amount: 1_000_000, meaning: "lend", receivable_name: "Chị Lan" });
    // Bút toán nạp ví của lần chia cũng mang link_id về khoản thu, nhưng không phải khoản trả về.
    expect((await view(income)).linked_from).toEqual([]);

    expect((await call("POST", `/v1/logs/transactions/${collect}/void`)).status).toBe(200);
    expect((await view(lend)).linked_from).toEqual([]);
  });
});

describe("gán thu nhập, để chia sau (pwa UC-706, ledger UC-103)", () => {
  const balance = (id: string) => (raw.prepare("SELECT balance FROM v_wallet_balance WHERE wallet_id = ?").get(id) as { balance: number } | undefined)?.balance ?? 0;
  const snapshot = async () => (await call("GET", "/v1/snapshot")).json.data;

  it("gán mà không gọi /v1/allocate: khoản thu nằm ở ví Thu nhập, chưa chia, còn để chi không đổi; chia sau vẫn được", async () => {
    const before = await snapshot();
    expect(before.attention.unallocatedIncome).toEqual({ count: 0, amount: 0, oldestTxId: null });
    seedLog("u1", "in", 250_000, "vcb-husband", { content: "chuyen khoan nhanh qua Zalo" });
    const { status, json } = await call("POST", "/v1/logs/u1/assign", { splits: [{ meaning: "income", amount: 250_000 }] });
    expect(status).toBe(201);
    const tx = json.data.transactions[0];
    expect(tx).toMatchObject({ meaning: "income", amount: 250_000, wallet_id: "income" });
    expect(raw.prepare("SELECT COUNT(*) n FROM allocation_runs").get()).toEqual({ n: 0 });
    expect(balance("income")).toBe(250_000);
    expect((await call("GET", `/v1/transactions/${tx.id}`)).json.data.allocated).toBeFalsy();

    const after = await snapshot();
    expect(after.spendableThisWeek).toBe(before.spendableThisWeek);
    expect(after.attention.unallocatedIncome).toEqual({ count: 1, amount: 250_000, oldestTxId: tx.id });

    // Chia sau ở chi tiết giao dịch (pwa UC-715): bảng chia thử gửi đúng các trường của khoản này, lần chia ra đúng bảng đó.
    const preview = await call("POST", "/v1/allocate/preview", { amount: tx.amount, taxable: !!tx.taxable, at: tx.at, account_id: tx.counter_account_id });
    const allocate = await call("POST", "/v1/allocate", { income_tx_id: tx.id });
    expect(allocate.status).toBe(201);
    expect(allocate.json.data.funds).toEqual(preview.json.data.funds);
    expect(balance("income")).toBe(0);
    const funds = raw.prepare("SELECT wallet_id, amount FROM transactions WHERE meaning = 'fund' AND batch_id = ?").all(allocate.json.data.batchId) as { wallet_id: string; amount: number }[];
    expect(funds.map((f) => ({ walletId: f.wallet_id, amount: f.amount }))).toEqual(expect.arrayContaining(preview.json.data.funds));
    expect(funds.reduce((s, f) => s + f.amount, 0)).toBe(250_000);
    expect((await snapshot()).attention.unallocatedIncome).toEqual({ count: 0, amount: 0, oldestTxId: null });
  });

  it("snapshot đếm khoản thu chưa chia: bỏ khoản đã chia và khoản đã huỷ, khoản cũ nhất trước", async () => {
    seedLog("u2", "in", 300_000, "vcb-husband");
    seedLog("u3", "in", 400_000, "vcb-husband");
    seedLog("u4", "in", 500_000, "vcb-husband");
    seedLog("u5", "in", 600_000, "vcb-husband");
    const ids: number[] = [];
    for (const [id, amount] of [["u2", 300_000], ["u3", 400_000], ["u4", 500_000], ["u5", 600_000]] as const) {
      ids.push((await call("POST", `/v1/logs/${id}/assign`, { splits: [{ meaning: "income", amount }] })).json.data.transactions[0].id);
    }
    raw.prepare("UPDATE transactions SET at = '2026-09-01T02:00:00.000Z' WHERE id = ?").run(ids[2]);
    expect((await call("POST", "/v1/allocate", { income_tx_id: ids[0] })).status).toBe(201);
    expect((await call("POST", `/v1/logs/transactions/${ids[1]}/void`)).status).toBe(200);
    expect((await snapshot()).attention.unallocatedIncome).toEqual({ count: 2, amount: 1_100_000, oldestTxId: ids[2] });
  });
});

describe("lệch đối soát chỉ là sổ khác giao dịch ngân hàng đã gán (ledger UC-103, UC-106 — ADR-87)", () => {
  it("snapshot và /v1/accounts: lệch khi bookDrift ≠ 0; log chưa gán (bookDrift 0) và tài khoản không có log (null) không lệch; không còn số ngân hàng báo", async () => {
    seedLog("r1", "out", 300_000, "vcb-husband");
    raw
      .prepare(
        `INSERT INTO transactions (log_id, at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key)
         VALUES ('r1', '2026-09-22T02:00:00.000Z', 250000, 'spend', 'food', 'vcb-husband', 'groceries', '2026-W39', '2026-09')`,
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

  it("tạo rule mới cho spend", async () => {
    const { status, json } = await call("POST", "/v1/rules", { match_type: "code", pattern: "ENT", meaning: "spend", wallet_id: "fun-husband", category_id: "entertainment" });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ pattern: "ENT", meaning: "spend" });
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
