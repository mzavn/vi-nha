import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { daily } from "../src/cron/daily";
import type { Env } from "../src/env";
import { monthKey, weekKey } from "../src/domain/period";
import { ingestLog } from "../src/services/ingest";
import { createEntry, insertTx } from "../src/services/ledger";
import { skipTask } from "../src/services/pay-cycles";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { B_NOW, householdB } from "./helpers/household-b";
import { AT, householdC } from "./helpers/household-c";
import { householdD, spend } from "./helpers/household-d";

let env: Env;
let raw: ReturnType<typeof openDb>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  raw = openDb();
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

  it("UC-402 AC-3: DB seed sau E (tài khoản chi tiêu ở Vận hành, số dư 0; Học phí gắn tài khoản MB học phí 0, Bảo dưỡng xe chưa gắn, không nợ), thứ Ba 22/9 → đúng 4 dòng: vận hành 0, 🎯 Học phí 0%, lời chúc, đối soát khớp", async () => {
    const now = new Date("2026-09-22T00:00:00Z"); // thứ Ba, còn 18 ngày tới kỳ lương 10/10
    await daily(env, now);
    const [{ text }] = sentMessages();
    // Không có phần an tâm (tài khoản Dự phòng còn lại là Ví Thưởng); Thuế thu nhập theo % và Bảo dưỡng xe chưa gắn tài khoản không vào 🎯.
    expect(text).toBe(
      ["💰 Tiền vận hành đã hết (0 ₫) — còn 18 ngày", "🎯 Học phí 0%", "💳 Không nợ ngắn hạn nào. Giữ nhịp này nhé 👏", "🏦 Đối soát: khớp"].join("\n"),
    );
  });

  it("UC-402 AC-33: hộ mẫu B → tin mở bằng cả hai số, 🎯 theo mục tiêu Dự phòng, 💳 nợ ngắn hạn; đổi tài khoản chi tiêu sang ngăn Tích luỹ → 2.700.000 · 93.000/ngày", async () => {
    const b = householdB();
    b.exec("UPDATE members SET tg_chat_id = '111' WHERE id = 'husband'");
    const envB = { DB: asD1(b), TG_BOT_TOKEN: "test-token" } as Env;
    await daily(envB, B_NOW);
    const lines = sentMessages()[0]!.text.split("\n");
    expect(lines[0]).toBe("💰 Vận hành 4.100.000 ₫ · chi khoảng 141.000 ₫/ngày tới kỳ lương 10/12 (còn 29 ngày)");
    expect(lines).toContain("🎯 Trả nợ Vay người thân 100% · Học phí 66% · Bảo dưỡng xe 20% · Phần an tâm đủ 3,2/6 tháng");
    expect(lines).toContain("💳 Nợ ngắn hạn còn 8.000.000 ₫ (2 khoản) · đã có 1.000.000 ₫ trong tài khoản Trả nợ · tất cả khoản nợ còn 58.000.000 ₫ (3 khoản)");

    b.exec("DELETE FROM notifications WHERE kind = 'daily'; UPDATE accounts SET pocket = 'savings' WHERE id = 'vcb-wife'");
    fetchMock.mockClear();
    await daily(envB, B_NOW);
    expect(sentMessages()[0]!.text.split("\n")[0]).toBe("💰 Vận hành 2.700.000 ₫ · chi khoảng 93.000 ₫/ngày tới kỳ lương 10/12 (còn 29 ngày)");
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

describe("ngày 1: chốt tháng với người thuê", () => {
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
        `INSERT INTO transactions (log_id, at, amount, meaning, account_id, category_id, week_key, month_key)
         VALUES ('log-1', ?, 250000, 'spend', 'vcb-wife', 'groceries', '2026-W39', '2026-09')`,
      )
      .run(now.toISOString());
    raw.prepare("UPDATE bank_logs SET status = 'assigned' WHERE id = 'log-1'").run();
    await daily(env, now);
    expect(sentMessages()[0]!.text).toContain("🏦 Đối soát: ❌ lệch 50.000 ₫ ở VCB (vợ)");
  });

  it("hôm qua tự ghép cặp chuyển nội bộ (theo `at`, không phải lúc ghi sổ)", async () => {
    const at = "2026-09-21T05:00:00Z"; // 12:00 trưa giờ VN thứ Hai = "hôm qua" so với now
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES ('logA', ?, 500000, 'out', 'vcb-husband', 'pending')").run(at);
    raw.prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, status) VALUES ('logB', ?, 500000, 'in', 'tcb-husband', 'pending')").run(at);
    await insertTx(env.DB, {
      at,
      amount: 500_000,
      meaning: "transfer",
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
});

describe("Chủ nhật: nhắc đếm tiền mặt / nhập số dư TK ghi tay", () => {
  const sunday = new Date("2026-09-27T00:00:00Z"); // 07:00 VN Chủ nhật

  it("UC-404 AC-1: chưa có cash_counts trong 7 ngày → nhắc cả hai tài khoản tiền mặt (tài khoản ngân hàng có feed thì không cần đếm)", async () => {
    raw.prepare("UPDATE accounts SET sepay_enabled = 1 WHERE kind = 'bank'").run();
    await daily(env, sunday);
    const text = sentMessages()[0]!.text;
    expect(text).toContain("🧮 Chủ nhật: đếm tiền mặt, nhập số dư — Tiền mặt (chồng), Tiền mặt (vợ)");
    expect(text).not.toContain("ví tiền mặt");
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
    expect(sentMessages()[0]!.text).toMatch(/🧮 Chủ nhật: đếm tiền mặt, nhập số dư — .*VCB \(chính\)/);
  });

  it("không phải Chủ nhật thì không có dòng nhắc", async () => {
    await daily(env, new Date("2026-09-22T00:00:00Z"));
    expect(sentMessages()[0]!.text).not.toContain("🧮");
  });
});

describe("tin sáng: việc ngày lương (261112-ba-ngan-duong-ghi)", () => {
  let c: DatabaseSync;
  beforeEach(async () => {
    c = householdC();
    c.exec("UPDATE members SET tg_chat_id = '111' WHERE id = 'husband'");
    env = { DB: asD1(c), TG_BOT_TOKEN: "test-token" } as Env;
    // UC-1206 AC-1: lương 20.000.000 về tài khoản chính 08:00 10/11 → kỳ mới, 5 việc.
    await createEntry(env.DB, { meaning: "income", amount: 20_000_000, income_stream_id: "salary", account_id: "main", at: AT("2026-11-10T08:00:00") }, null, new Date(AT("2026-11-10T08:00:00")));
  });
  const textOn = async (vn: string) => {
    c.exec("DELETE FROM notifications WHERE kind = 'daily'");
    fetchMock.mockClear();
    await daily(env, new Date(AT(vn)));
    return sentMessages()[0]!.text;
  };

  it("UC-402 AC-36: 5 việc mở → \"☑️ Việc ngày lương còn 5 việc\" trong phần việc cần làm, không 📅 / 🔁 / 📌; ngày 10, 25 không nhắc khoản thu chưa chia; ngày 1 không mời chốt tháng; mọi việc xong → không ☑️", async () => {
    const text = await textOn("2026-11-11T07:00:00");
    const lines = text.split("\n");
    expect(lines).toContain("☑️ Việc ngày lương còn 5 việc");
    expect(lines.indexOf("☑️ Việc ngày lương còn 5 việc")).toBeLessThan(lines.findIndex((l) => l.startsWith("💳")));
    expect(text).not.toMatch(/📅|🔁|📌/);
    for (const day of ["2026-11-25T07:00:00", "2026-12-10T07:00:00", "2026-12-01T07:00:00"]) {
      const t = await textOn(day);
      expect(t, day).not.toContain("chưa chia");
      expect(t, day).not.toMatch(/📅|📌|mở app để chốt/);
    }

    const ids = c.prepare("SELECT id FROM pay_cycle_tasks WHERE status = 'open'").all() as { id: number }[];
    expect(ids).toHaveLength(5);
    for (const { id } of ids) await skipTask(env.DB, id, { reason: "Kỳ này không làm" }, "husband", new Date(AT("2026-11-11T06:00:00")));
    expect(await textOn("2026-11-12T07:00:00")).not.toContain("☑️");
  });

  it("UC-402 AC-37: hôm qua máy tự ghi lãi 68 (tài khoản chính), 37 (tài khoản tiết kiệm), không fund → \"💰 Lãi tiền gửi: +105 ₫ (2 khoản) — vào Tài khoản chính, Tài khoản tiết kiệm\"", async () => {
    const lai = (id: string, amount: number, accountNo: string, at: string) =>
      ingestLog(env.DB, { id, at, amount, direction: "in", accountNo, content: "BankAPINotify", refCode: null, referenceNumber: null, raw: {} }, "webhook", new Date(at));
    await lai("y1", 68, "1110001", AT("2026-11-11T00:07:00"));
    await lai("y2", 37, "3330003", AT("2026-11-11T00:30:00"));
    expect(c.prepare("SELECT COUNT(*) n FROM transactions WHERE meaning = 'fund'").get()).toEqual({ n: 0 });
    const text = await textOn("2026-11-12T07:00:00");
    expect(text.split("\n").filter((l) => l.includes("Lãi tiền gửi"))).toEqual(["💰 Lãi tiền gửi: +105 ₫ (2 khoản) — vào Tài khoản chính, Tài khoản tiết kiệm"]);
  });
});

describe("tin sáng: dòng lãi tiền gửi tự ghi hôm qua (261018-lai-tien-gui)", () => {
  const lai = (id: string, amount: number, accountNo: string, at: string) =>
    ingestLog(env.DB, { id, at, amount, direction: "in", accountNo, content: "BankAPINotify", refCode: null, referenceNumber: null, raw: {} }, "webhook", new Date(at));

  it("UC-402 AC-30: hôm qua tự ghi 3 khoản lãi 68 + 50 + 37 về 3 tài khoản → đúng một dòng lãi 155 ₫ (3 khoản) vào tên 3 tài khoản; không có lãi → không có dòng", async () => {
    const now = new Date("2026-10-18T00:00:00Z"); // 07:00 VN 18/10
    await daily(env, now);
    expect(sentMessages()[0]!.text.split("\n").filter((l) => l.includes("Lãi tiền gửi"))).toEqual([]);

    raw.prepare("DELETE FROM notifications WHERE kind = 'daily'").run();
    fetchMock.mockClear();
    await lai("y1", 68, "0011xxxxxxx", "2026-10-16T17:07:00.000Z");
    await lai("y2", 50, "0011yyyyyyy", "2026-10-16T17:30:00.000Z");
    await lai("y3", 37, "0888xxxxxxx", "2026-10-16T17:58:00.000Z");
    await lai("old", 20, "0011yyyyyyy", "2026-10-15T17:00:00.000Z"); // hôm kia: không tính
    await daily(env, now);
    expect(sentMessages()[0]!.text.split("\n").filter((l) => l.includes("Lãi tiền gửi"))).toEqual(["💰 Lãi tiền gửi: +155 ₫ (3 khoản) — vào VCB (chính), VCB (vợ), MB (Thuế)"]);
  });

  it("UC-402 AC-31: lương tự ghi hôm qua bị người xếp lại Thu nhập thụ động (người phân loại khác NULL) → không vào dòng lãi", async () => {
    const at = "2026-10-17T02:00:00.000Z";
    raw.prepare("UPDATE rules SET by_member_id = NULL WHERE pattern = 'LUONG THANG'").run(); // khoản thu tự ghi không người ghi, như lãi
    await ingestLog(env.DB, { id: "sal", at, amount: 40_000_000, direction: "in", accountNo: "0011xxxxxxx", content: "LUONG THANG 10", refCode: null, referenceNumber: null, raw: {} }, "webhook", new Date(at));
    const income = raw.prepare("SELECT id FROM transactions WHERE log_id = 'sal' AND meaning = 'income'").get() as { id: number };
    raw.prepare("INSERT INTO transaction_report_classes (transaction_id, report_class, by_member_id) VALUES (?, 'passive_income', 'husband')").run(income.id);
    await lai("y1", 68, "0011xxxxxxx", "2026-10-16T17:07:00.000Z");
    await daily(env, new Date("2026-10-18T00:00:00Z"));
    expect(sentMessages()[0]!.text.split("\n").filter((l) => l.includes("Lãi tiền gửi"))).toEqual(["💰 Lãi tiền gửi: +68 ₫ (1 khoản) — vào VCB (chính)"]);
  });

  it("UC-402 AC-40: lãi 68 (VCB (chính)), 50 (VCB (vợ), riêng tư của vợ), 37 (MB (Thuế)) → dòng lãi chỉ số công khai kèm \"1 khoản của tài khoản riêng tư\"; hôm chỉ có lãi riêng tư → chỉ số khoản; không dòng nào có VCB (vợ)", async () => {
    raw.prepare("UPDATE accounts SET private = 1 WHERE id = 'vcb-wife'").run();
    const interestLines = () => sentMessages()[0]!.text.split("\n").filter((l) => l.includes("Lãi tiền gửi"));
    await lai("y1", 68, "0011xxxxxxx", "2026-10-16T17:07:00.000Z");
    await lai("y2", 50, "0011yyyyyyy", "2026-10-16T17:30:00.000Z");
    await lai("y3", 37, "0888xxxxxxx", "2026-10-16T17:58:00.000Z");
    await daily(env, new Date("2026-10-18T00:00:00Z"));
    expect(interestLines()).toEqual(["💰 Lãi tiền gửi: +105 ₫ (2 khoản) — vào VCB (chính), MB (Thuế) · 1 khoản của tài khoản riêng tư"]);
    expect(interestLines().join("\n")).not.toContain("VCB (vợ)");

    fetchMock.mockClear();
    await lai("z1", 50, "0011yyyyyyy", "2026-10-17T17:30:00.000Z");
    await daily(env, new Date("2026-10-19T00:00:00Z"));
    expect(interestLines()).toEqual(["💰 Lãi tiền gửi: 1 khoản của tài khoản riêng tư"]);
    expect(interestLines().join("\n")).not.toContain("VCB (vợ)");
  });
});

describe("tin sáng: dòng 🔎 Nhìn lại kỳ này (261112-ba-ngan-nhin-lai)", () => {
  let d: DatabaseSync;
  beforeEach(() => {
    d = householdD();
    d.exec("UPDATE members SET tg_chat_id = '111' WHERE id = 'husband'");
    env = { DB: asD1(d), TG_BOT_TOKEN: "test-token" } as Env;
  });
  const textOn = async (vn: string) => {
    d.exec("DELETE FROM notifications WHERE kind = 'daily'");
    fetchMock.mockClear();
    await daily(env, new Date(AT(vn)));
    return sentMessages()[0]!.text;
  };
  const nudgeLine = (text: string) => text.split("\n").find((l) => l.startsWith("🔎"));

  it("UC-402 AC-6: hộ mẫu D ngày 25/11 (16/30) → \"🔎 Nhìn lại kỳ này: Mua sắm vượt 200.000 ₫ · Ăn uống 83%\", không \"Sắp vỡ\"; ngày 7/12 (28/30) cùng số chi → chỉ còn Mua sắm vượt", async () => {
    const text = await textOn("2026-11-25T07:00:00");
    expect(nudgeLine(text)).toBe("🔎 Nhìn lại kỳ này: Mua sắm vượt 200.000 ₫ · Ăn uống 83%");
    expect(text).not.toContain("Sắp vỡ");
    expect(nudgeLine(await textOn("2026-12-07T07:00:00"))).toBe("🔎 Nhìn lại kỳ này: Mua sắm vượt 200.000 ₫");
  });

  it("UC-402 AC-38: bỏ hết hạn mức; hoặc mỗi nhóm < 80%; hoặc Ăn uống 85% vào ngày 28/30 → không dòng 🔎; không dòng nào chứa \"Sắp vỡ\" hay \"bù\"", async () => {
    d.exec("UPDATE category_groups SET cycle_limit = NULL");
    let text = await textOn("2026-11-25T07:00:00");
    expect(nudgeLine(text)).toBeUndefined();
    expect(text).not.toMatch(/Sắp vỡ|bù/);

    d.exec("UPDATE category_groups SET cycle_limit = 4000000 WHERE id = 'd-food'; UPDATE category_groups SET cycle_limit = 2000000 WHERE id = 'd-shopping'; UPDATE category_groups SET cycle_limit = 800000 WHERE id = 'd-transport'");
    text = await textOn("2026-11-25T07:00:00");
    expect(nudgeLine(text)).toBeUndefined();
    expect(text).not.toMatch(/Sắp vỡ|bù/);

    d.exec("UPDATE category_groups SET cycle_limit = 2940000 WHERE id = 'd-food'"); // 2.500.000 / 2.940.000 = 85%
    expect(nudgeLine(await textOn("2026-11-25T07:00:00"))).toBe("🔎 Nhìn lại kỳ này: Ăn uống 85%");
    text = await textOn("2026-12-07T07:00:00");
    expect(nudgeLine(text)).toBeUndefined();
    expect(text).not.toMatch(/Sắp vỡ|bù/);
  });

  it("UC-402 AC-39: tài khoản riêng tư của người vợ chi Mua sắm 500.000 → tính vào (50%, không dòng); thêm 400.000 từ tài khoản chính → \"🔎 Nhìn lại kỳ này: Mua sắm 90%\"; tin không liệt kê khoản nào", async () => {
    d.exec(`
      UPDATE transactions SET status = 'void' WHERE meaning IN ('spend', 'refund') AND at >= '2026-11-10T01:00:00.000Z';
      INSERT INTO accounts (id, name, kind, bank, owner_member_id, opening_balance, pocket, pocket_confirmed, private)
        VALUES ('wife-private', 'Tài khoản riêng (vợ)', 'bank', 'ACB', 'wife', 5000000, 'operating', 1, 1);
    `);
    spend(d, { at: "2026-11-15T10:00", amount: 500_000, category: "shopping", account: "wife-private" });
    let text = await textOn("2026-11-20T07:00:00");
    expect(nudgeLine(text)).toBeUndefined();

    spend(d, { at: "2026-11-21T10:00", amount: 400_000, category: "shopping" });
    text = await textOn("2026-11-22T07:00:00");
    expect(nudgeLine(text)).toBe("🔎 Nhìn lại kỳ này: Mua sắm 90%");
    expect(text.split("\n").filter((l) => /Mua sắm|500\.000 ₫|400\.000 ₫/.test(l))).toEqual(["🔎 Nhìn lại kỳ này: Mua sắm 90%"]);
  });
});
