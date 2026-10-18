import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daily } from "../src/cron/daily";
import type { Env } from "../src/env";
import { monthKey, weekKey } from "../src/domain/period";
import { ingestLog } from "../src/services/ingest";
import { allocateIncome, createEntry, insertTx } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  raw = openDb();
  raw.prepare("UPDATE allocations SET target_date = '2026-12-31' WHERE wallet_id = 'travel'").run(); // seed dùng date('now', +3 tháng): ghim lại cho khỏi phụ thuộc đồng hồ
  // Bối cảnh: nhà chưa nối bank feed — mọi tài khoản đều ghi tay (tài khoản đã nối feed thì không nhận nhập tay).
  raw.prepare("UPDATE accounts SET sepay_enabled = 0").run();
  raw.prepare("UPDATE members SET tg_chat_id = ? WHERE id = ?").run("111", "husband");
  raw.prepare("UPDATE members SET tg_chat_id = ? WHERE id = ?").run("222", "wife");
  env = { DB: asD1(raw), TG_BOT_TOKEN: "test-token" } as Env;
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function sentMessages() {
  return fetchMock.mock.calls.map(([, opts]) => JSON.parse((opts as RequestInit).body as string) as { chat_id: string; text: string });
}

async function salary(amount: number, at: string, accountId = "vcb-husband") {
  const { tx } = await createEntry(env.DB, { meaning: "income", amount, account_id: accountId, at }, null, new Date(at));
  await allocateIncome(env.DB, Number((tx as { id: number }).id));
}

async function spend(amount: number, categoryId: string, at: string, accountId = "vcb-husband") {
  await createEntry(env.DB, { meaning: "spend", amount, category_id: categoryId, account_id: accountId, at }, null, new Date(at));
}

describe("cron 07:00 VN: gửi tin & chống gửi trùng", () => {
  it("gửi đúng 2 người có tg_chat_id, cùng nội dung; chạy lại trong ngày không gửi thêm", async () => {
    const now = new Date("2026-09-22T00:00:00Z"); // 07:00 VN thứ Ba
    await daily(env, now);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = sentMessages();
    expect(sent.map((s) => s.chat_id).sort()).toEqual(["111", "222"]);
    expect(sent[0]!.text).toBe(sent[1]!.text);
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='daily' AND day_key='2026-09-22'").get()).toEqual({ n: 2 });

    await daily(env, now);
    expect(fetchMock).toHaveBeenCalledTimes(2); // vẫn 2 — không gửi trùng
  });

  it("chưa chia lương: còn để chi = 0, tiến độ quỹ/phao ban đầu vẫn hiện, đối soát khớp", async () => {
    const now = new Date("2026-09-22T00:00:00Z"); // thứ Ba, còn 6 ngày tới hết tuần
    await daily(env, now);
    const [{ text }] = sentMessages();
    // Du lịch và Phao luôn hiện vì luôn có dữ liệu (kể cả 0%) — không phải dòng "cảnh báo" ≥80%.
    expect(text).toBe(["💰 Còn để chi tuần này: 0 ₫ (6 ngày)", "🎯 Du lịch 0% · Quỹ an tâm 0,0/6 tháng", "🏦 Đối soát: khớp"].join("\n"));
  });

  it("thành viên không có tg_chat_id thì không nhận tin", async () => {
    raw.prepare("UPDATE members SET tg_chat_id = NULL WHERE id = 'wife'").run();
    await daily(env, new Date("2026-09-22T00:00:00Z"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentMessages()[0]!.chat_id).toBe("111");
  });
});

describe("múi giờ VN", () => {
  it("cron chạy lúc 23:30 UTC hôm trước vẫn thuộc ngày VN hôm sau", async () => {
    await daily(env, new Date("2026-09-30T23:30:00Z")); // 06:30 sáng giờ VN 1/10
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='daily' AND day_key='2026-10-01'").get()).toEqual({ n: 2 });
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE day_key='2026-09-30'").get()).toEqual({ n: 0 });
  });
});

describe("ngày 1: chốt tháng trước", () => {
  /** Bút toán điều chỉnh làm ví tăng (+) hoặc giảm (−) trong tháng 9. */
  function flow(walletId: string, amount: number) {
    const at = "2026-09-15T05:00:00.000Z";
    raw
      .prepare("INSERT INTO transactions (at, amount, meaning, wallet_id, counter_wallet_id, week_key, month_key, source) VALUES (?, ?, 'adjust', ?, ?, ?, ?, 'system')")
      .run(at, Math.abs(amount), amount > 0 ? walletId : null, amount > 0 ? null : walletId, weekKey(at), monthKey(at));
  }
  const sCount = () => raw.prepare("SELECT COUNT(*) n FROM transactions WHERE batch_id LIKE 'S%'").get();

  it("UC-207 AC-2: ngày 1 cron không tạo giao dịch S…; tin sáng có câu mời \"Tháng 9: dư 4.140.000 ₫ sau khi bù chi lố — mở app để chốt\"", async () => {
    await salary(40_000_000, "2026-09-10T09:00:00+07:00");
    await spend(3_000_000, "groceries", "2026-09-12T12:00:00+07:00"); // Ăn uống âm 500k

    const now = new Date("2026-10-01T00:00:00Z"); // 07:00 VN 1/10
    await daily(env, now);

    expect(sCount()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT COUNT(*) n FROM month_closes").get()).toEqual({ n: 0 });
    const [{ text }] = sentMessages();
    expect(text).toContain("📌 Tháng 9: dư 4.140.000 ₫ sau khi bù chi lố — mở app để chốt");
    expect(text).not.toContain("🧹");
  });

  it("UC-207 AC-2: chỉ có bù, không còn dư → \"Tháng 9: chi lố được bù …, không còn dư — mở app để chốt\"", async () => {
    flow("transport", 400_000);
    flow("food", -1_000_000);
    await daily(env, new Date("2026-10-01T00:00:00Z"));
    const [{ text }] = sentMessages();
    expect(text).toContain("📌 Tháng 9: chi lố được bù 400.000 ₫, không còn dư — mở app để chốt");
    expect(sCount()).toEqual({ n: 0 });
  });

  it("UC-207 AC-3: không ví dương, không ví âm → không có dòng mời chốt", async () => {
    await daily(env, new Date("2026-10-01T00:00:00Z"));
    const [{ text }] = sentMessages();
    expect(text).not.toContain("📌");
  });

  it("UC-207: tháng đã chốt trước giờ tin sáng → không mời", async () => {
    flow("food", 300_000);
    raw.prepare("INSERT INTO month_closes (month, wealth_pct) VALUES ('2026-09', 100)").run();
    await daily(env, new Date("2026-10-01T00:00:00Z"));
    const [{ text }] = sentMessages();
    expect(text).not.toContain("📌");
    // Ngày khác ngày 1 thì không mời dù chưa chốt.
    raw.prepare("DELETE FROM month_closes").run();
    fetchMock.mockClear();
    await daily(env, new Date("2026-10-02T00:00:00Z"));
    expect(sentMessages()[0]!.text).not.toContain("📌");
  });

  it("nhắc chốt tháng với người thuê đang ở chưa chốt tháng trước; đã chốt hoặc đã ngừng thì không nhắc", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình'), ('tenant-an', 'An'), ('old-tenant', 'Người cũ')").run();
    raw.prepare("UPDATE tenants SET active = 0 WHERE id = 'old-tenant'").run();
    raw.prepare("INSERT INTO tenant_lines (tenant_id, month_key, at, kind, name, amount) VALUES ('tenant-binh', '2026-09', '2026-09-01T00:00:00Z', 'opening', 'Số dư mở sổ', 7075000)").run();
    raw.prepare("INSERT INTO tenant_settlements (tenant_id, month_key, headcount, shared_total) VALUES ('tenant-an', '2026-09', 3, 0)").run();
    await daily(env, new Date("2026-10-01T00:00:00Z"));
    const [{ text }] = sentMessages();
    expect(text.split("\n").filter((l) => l.startsWith("🏠"))).toEqual(["🏠 Chốt tháng với Anh Bình (số dư 7.075.000 ₫)"]);
  });

  it("ngày thường không nhắc chốt tháng người thuê", async () => {
    raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-binh', 'Anh Bình')").run();
    await daily(env, new Date("2026-10-02T00:00:00Z"));
    expect(sentMessages()[0]!.text).not.toContain("🏠");
  });
});

describe("các dòng lấy đúng số từ DB", () => {
  const now = new Date("2026-09-22T00:00:00Z"); // thứ Ba, tuần 2026-W39

  it("ví sắp vỡ ≥80% dự kiến tuần", async () => {
    await salary(40_000_000, "2026-09-22T09:00:00+07:00");
    await spend(550_000, "groceries", "2026-09-22T10:00:00+07:00"); // Ăn uống: 550k/625k = 88%
    await daily(env, now);
    expect(sentMessages()[0]!.text).toContain("⚠️ Sắp vỡ: Ăn uống 88%");
  });

  it("người khác nợ mình: chỉ cộng khoản đang theo dõi còn phải thu > 0", async () => {
    raw.exec(`
      INSERT INTO receivables (id, name, active) VALUES ('em-hai', 'Em Hai', 1), ('chu-tu', 'Chú Tư', 1), ('cu', 'Cũ', 0);
      INSERT INTO receivable_lines (receivable_id, at, kind, amount) VALUES
        ('em-hai', '2026-09-20', 'opening', 2000000), ('chu-tu', '2026-09-20', 'opening', 500000), ('cu', '2026-09-20', 'opening', 9000000);
    `);
    await createEntry(env.DB, { meaning: "collect", amount: 800_000, receivable_id: "chu-tu", account_id: "vcb-husband", at: "2026-09-21T09:00:00+07:00" }, null, now);
    await daily(env, now);
    expect(sentMessages()[0]!.text).toContain("🤝 Người khác nợ mình 2.000.000 ₫ (1 khoản)");
  });

  it("giao dịch chưa gán đếm từ bank_logs pending", async () => {
    for (let i = 0; i < 3; i++) {
      raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES (?, ?, ?, 'in', 'vcb-husband', 'pending')").run(`log-${i}`, now.toISOString(), 100_000);
    }
    await daily(env, now);
    expect(sentMessages()[0]!.text).toContain("📥 3 giao dịch chưa gán");
  });

  it("đối soát lệch dùng ledger.reconcile(): sổ diễn giải khác giao dịch ngân hàng đã gán", async () => {
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES ('log-1', ?, 300000, 'out', 'vcb-wife', 'pending')").run(now.toISOString());
    raw
      .prepare(
        `INSERT INTO transactions (log_id, at, amount, meaning, counter_wallet_id, account_id, category_id, week_key, month_key)
         VALUES ('log-1', ?, 250000, 'spend', 'food', 'vcb-wife', 'groceries', '2026-W39', '2026-09')`,
      )
      .run(now.toISOString());
    raw.prepare("UPDATE bank_logs SET status = 'assigned' WHERE id = 'log-1'").run();
    await daily(env, now);
    expect(sentMessages()[0]!.text).toContain("🏦 Đối soát: ❌ lệch 50.000 ₫ ở VCB (vợ)");
  });

  it("lệnh chuyển tiền quá hạn 3 ngày", async () => {
    raw
      .prepare(
        "INSERT INTO transfer_orders (batch_id, from_account_id, to_account_id, amount, memo, status, created_at) VALUES ('X','vcb-husband','tcb-husband',500000,'PF X','pending','2000-01-01 00:00:00')",
      )
      .run();
    await daily(env, now);
    expect(sentMessages()[0]!.text).toContain("🔁 1 chuyển tiền cần làm (quá 3 ngày)");
  });

  it("hôm qua tự ghép cặp chuyển nội bộ (theo `at`, không phải lúc ghi sổ)", async () => {
    const at = "2026-09-21T05:00:00Z"; // 12:00 trưa giờ VN thứ Hai = "hôm qua" so với now
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES ('logA', ?, 500000, 'out', 'vcb-husband', 'pending')").run(at);
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES ('logB', ?, 500000, 'in', 'tcb-husband', 'pending')").run(at);
    await insertTx(env.DB, {
      at,
      amount: 500_000,
      meaning: "transfer",
      wallet_id: null,
      counter_wallet_id: null,
      account_id: "vcb-husband",
      counter_account_id: "tcb-husband",
      category_id: null,
      by_member_id: null,
      link_id: null,
      batch_id: null,
      asset_kind: null,
      taxable: 0,
      week_key: weekKey(at),
      month_key: monthKey(at),
      source: "sepay",
      note: null,
      client_id: null,
    }).run();
    raw.prepare("UPDATE transactions SET log_id = 'logA', log_id_2 = 'logB' WHERE at = ?").run(at);
    raw.prepare("UPDATE bank_logs SET status = 'assigned' WHERE id IN ('logA', 'logB')").run();

    await daily(env, now);
    expect(sentMessages()[0]!.text).toContain("🔗 Hôm qua tự ghép 1 cặp chuyển nội bộ");
  });

  it("đêm qua backfill vá bao nhiêu lấy từ notifications(kind='backfill', day_key=hôm nay); lượt soát tuần ghi rõ", async () => {
    raw
      .prepare("INSERT INTO notifications (kind, day_key, chat_id, payload, ok) VALUES ('backfill', '2026-09-22', 'system', '{\"added\":3,\"scope\":\"week\"}', 1)")
      .run();
    await daily(env, now);
    expect(sentMessages()[0]!.text).toContain("🩹 Đêm qua vá 3 giao dịch webhook bỏ sót (soát lại cả tuần trước)");
  });

  it("ngày 10: nhắc nếu còn income chưa chia, không tự chia", async () => {
    await createEntry(env.DB, { meaning: "income", amount: 10_000_000, account_id: "vcb-husband", at: "2026-09-10T09:00:00+07:00" }, null, new Date());
    await daily(env, new Date("2026-09-10T00:00:00Z"));
    expect(sentMessages()[0]!.text).toContain("📅 Hôm nay ngày 10: còn 1 khoản thu chưa chia");
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning = 'fund'").get()).toEqual({ n: 0 }); // không tự chia
  });

  it("ngày thường (không 10/25) thì không có dòng nhắc income dù còn chưa chia", async () => {
    await createEntry(env.DB, { meaning: "income", amount: 10_000_000, account_id: "vcb-husband", at: "2026-09-22T09:00:00+07:00" }, null, new Date());
    await daily(env, now);
    expect(sentMessages()[0]!.text).not.toContain("📅");
  });
});

describe("Chủ nhật: nhắc đếm ví tiền mặt / nhập số dư TK ghi tay", () => {
  const sunday = new Date("2026-09-27T00:00:00Z"); // 07:00 VN Chủ nhật

  it("chưa có cash_counts trong 7 ngày → nhắc cả hai ví tiền mặt (tài khoản ngân hàng có feed thì không cần đếm)", async () => {
    raw.prepare("UPDATE accounts SET sepay_enabled = 1 WHERE kind = 'bank'").run();
    await daily(env, sunday);
    expect(sentMessages()[0]!.text).toContain("🧮 Chủ nhật: đếm ví tiền mặt, nhập số dư — Tiền mặt (chồng), Tiền mặt (vợ)");
  });

  it("đã đếm trong 7 ngày thì không nhắc lại ví đó", async () => {
    raw.prepare("UPDATE accounts SET sepay_enabled = 1 WHERE kind = 'bank'").run();
    raw.prepare("INSERT INTO cash_counts (at, account_id, counted, book) VALUES (?, 'cash-husband', 0, 0)").run(new Date(sunday.getTime() - 86_400_000).toISOString());
    await daily(env, sunday);
    const text = sentMessages()[0]!.text;
    expect(text).toContain("Tiền mặt (vợ)");
    expect(text).not.toContain("Tiền mặt (chồng)");
  });

  it("tài khoản ngân hàng ghi tay cũng được nhắc nhập số dư", async () => {
    await daily(env, sunday);
    expect(sentMessages()[0]!.text).toMatch(/🧮 Chủ nhật: đếm ví tiền mặt, nhập số dư — .*VCB \(chính\)/);
  });

  it("không phải Chủ nhật thì không có dòng nhắc", async () => {
    await daily(env, new Date("2026-09-22T00:00:00Z"));
    expect(sentMessages()[0]!.text).not.toContain("🧮");
  });
});

describe("tin sáng: dòng lãi tiền gửi tự ghi hôm qua (261018-lai-tien-gui)", () => {
  const lai = (id: string, amount: number, accountNo: string, at: string) =>
    ingestLog(env.DB, { id, at, amount, direction: "in", accountNo, content: "BankAPINotify", refCode: null, referenceNumber: null, raw: {} }, "webhook", new Date(at));

  it("UC-402: hôm qua tự ghi 3 khoản lãi 68 + 50 + 37 → đúng một dòng lãi 155 ₫ (3 khoản) kèm ví; không có lãi → không có dòng", async () => {
    const now = new Date("2026-10-18T00:00:00Z"); // 07:00 VN 18/10
    await daily(env, now);
    expect(sentMessages()[0]!.text.split("\n").filter((l) => l.includes("Lãi tiền gửi"))).toEqual([]);

    raw.prepare("DELETE FROM notifications WHERE kind = 'daily'").run();
    fetchMock.mockClear();
    raw.prepare("UPDATE accounts SET role = 'buffer' WHERE id = 'mb-husband'").run();
    await lai("y1", 68, "0011xxxxxxx", "2026-10-16T17:07:00.000Z");
    await lai("y2", 50, "0011yyyyyyy", "2026-10-16T17:30:00.000Z");
    await lai("y3", 37, "0888xxxxxxx", "2026-10-16T17:58:00.000Z");
    await lai("old", 20, "0011yyyyyyy", "2026-10-15T17:00:00.000Z"); // hôm kia: không tính
    await daily(env, now);
    expect(sentMessages()[0]!.text.split("\n").filter((l) => l.includes("Lãi tiền gửi"))).toEqual(["💰 Lãi tiền gửi: +155 ₫ (3 khoản) — vào Tích sản, Chơi (vợ), Có thì tốt"]);
  });

  it("UC-402: lương tự chia hôm qua bị xếp lại Thu nhập thụ động → không vào dòng lãi", async () => {
    const at = "2026-10-17T02:00:00.000Z";
    raw.prepare("UPDATE rules SET by_member_id = NULL WHERE pattern = 'LUONG THANG'").run(); // khoản thu tự ghi không người ghi, như lãi
    await ingestLog(env.DB, { id: "sal", at, amount: 40_000_000, direction: "in", accountNo: "0011xxxxxxx", content: "LUONG THANG 10", refCode: null, referenceNumber: null, raw: {} }, "webhook", new Date(at));
    const income = raw.prepare("SELECT id FROM transactions WHERE log_id = 'sal' AND meaning = 'income'").get() as { id: number };
    expect(raw.prepare("SELECT COUNT(*) n FROM allocation_runs WHERE income_tx_id = ?").get(income.id)).toEqual({ n: 1 });
    raw.prepare("INSERT INTO transaction_report_classes (transaction_id, report_class) VALUES (?, 'passive_income')").run(income.id);
    await lai("y1", 68, "0011xxxxxxx", "2026-10-16T17:07:00.000Z");
    await daily(env, new Date("2026-10-18T00:00:00Z"));
    expect(sentMessages()[0]!.text.split("\n").filter((l) => l.includes("Lãi tiền gửi"))).toEqual(["💰 Lãi tiền gửi: +68 ₫ (1 khoản) — vào Có thì tốt"]);
  });
});
