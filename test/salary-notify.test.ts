import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { notifySalary, salaryNotice } from "../src/notify/salary";
import { ingestLog, parseWebhookPayload } from "../src/services/ingest";
import { createEntry, voidTransaction } from "../src/services/ledger";
import { pushPayload } from "../src/services/push";
import { asD1 } from "./helpers/d1-sqlite";
import { AT, householdC } from "./helpers/household-c";

// Báo lương về (notify UC-412) trên hộ mẫu C: lương 20.000.000 về tài khoản chính 08:00 10/11 → một nhắc ① 2.000.000 (pocket
// UC-1205 AC-5); Học phí còn thiếu 2.000.000 là mục tiêu tài khoản đầu tiên còn thiếu (gợi ý, pocket UC-1206 AC-18).

let db: DatabaseSync;
let env: Env;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  db = householdC();
  db.exec(`
    UPDATE members SET tg_chat_id = '111' WHERE id = 'husband';
    UPDATE members SET tg_chat_id = '222' WHERE id = 'wife';
  `);
  env = { DB: asD1(db), TG_BOT_TOKEN: "test-token" } as Env;
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AT("2026-11-10T08:00:30")));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const telegram = () => fetchMock.mock.calls.map(([, opts]) => JSON.parse((opts as RequestInit).body as string) as { chat_id: string; text: string });
const sentRows = () => db.prepare("SELECT day_key AS dayKey, chat_id AS chatId FROM notifications WHERE kind = 'salary' ORDER BY day_key, chat_id").all() as { dayKey: string; chatId: string }[];

/** Ghi một khoản lương qua đường ghi thật (Nhập), như PWA / MCP; trả id khoản thu. */
const salary = async (amount: number, vnAt: string, account = "main", member = "husband") => {
  const r = await createEntry(env.DB, { meaning: "income", amount, account_id: account, income_stream_id: "salary", at: AT(vnAt) }, member, new Date());
  return Number(r.tx!.id);
};

const LINE_20M = "Lương về 20.000.000 ₫ · trích Tích luỹ 10% = 2.000.000 ₫";
const HINT = "Mục tiêu còn thiếu: Học phí 2.000.000 ₫ ›";

describe("báo lương về (notify UC-412)", () => {
  it("UC-412 AC-1: lương 20.000.000 về 10/11 08:00 → mỗi người một tin \"Lương về 20.000.000 ₫ · trích Tích luỹ 10% = 2.000.000 ₫\" kèm một dòng mục tiêu còn thiếu; 2 dòng notifications(salary, id khoản thu); bản đẩy \"Lương về · trích 2.000.000\" mở /#today", async () => {
    const txId = await salary(20_000_000, "2026-11-10T08:00:00");
    await notifySalary(env, txId);

    const sent = telegram();
    expect(sent.map((s) => s.chat_id).sort()).toEqual(["111", "222"]);
    for (const s of sent) expect(s.text.split("\n")).toEqual([LINE_20M, HINT]);
    expect(sentRows()).toEqual([
      { dayKey: String(txId), chatId: "111" },
      { dayKey: String(txId), chatId: "222" },
    ]);

    const notice = (await salaryNotice(env.DB, txId, new Date()))!;
    expect(notice.push).toEqual({ title: "Lương về · trích 2.000.000", body: "Trích Tích luỹ 10% = 2.000.000 ₫ từ lương 20.000.000 ₫ · mục tiêu còn thiếu: Học phí 2.000.000 ₫" });
    expect(pushPayload("salary", notice.push)).toMatchObject({ title: "Lương về · trích 2.000.000", url: "/#today", tag: "salary" });
  });

  it("UC-412 AC-1: mọi mục tiêu đủ → tin chỉ một dòng Lương về, không dòng gợi ý", async () => {
    db.exec("UPDATE reserve_goals SET active = 0");
    const txId = await salary(20_000_000, "2026-11-10T08:00:00");
    await notifySalary(env, txId);
    expect(telegram()[0]!.text).toBe(LINE_20M);
  });

  it("UC-412 AC-2: đã báo → gọi lại cho cùng khoản không gửi thêm; lương thứ hai 5.000.000 cùng tháng → tin riêng của khoản đó; khoản đã huỷ (nhắc void) hoặc không phải lương → không gửi", async () => {
    const first = await salary(20_000_000, "2026-11-10T08:00:00");
    await notifySalary(env, first);
    await notifySalary(env, first);
    expect(telegram()).toHaveLength(2);

    vi.setSystemTime(new Date(AT("2026-11-20T09:00:00")));
    const second = await salary(5_000_000, "2026-11-20T09:00:00");
    await notifySalary(env, second);
    expect(telegram().slice(2).map((s) => s.text.split("\n")[0])).toEqual(["Lương về 5.000.000 ₫ · trích Tích luỹ 10% = 500.000 ₫", "Lương về 5.000.000 ₫ · trích Tích luỹ 10% = 500.000 ₫"]);

    // Huỷ khoản lương thứ ba trước khi tin kịp dựng → nhắc void → không tin.
    vi.setSystemTime(new Date(AT("2026-11-21T12:00:00")));
    const third = await salary(3_000_000, "2026-11-21T09:00:00");
    await voidTransaction(env.DB, third, "husband", new Date());
    expect(await salaryNotice(env.DB, third, new Date())).toBeNull();
    await notifySalary(env, third);

    // Khoản thu "Việc phụ" không phải lương → không nhắc, không tin.
    const side = await createEntry(env.DB, { meaning: "income", amount: 1_200_000, account_id: "main", income_stream_id: "side", at: AT("2026-11-21T10:00:00") }, "husband", new Date());
    await notifySalary(env, Number(side.tx!.id));

    expect(telegram()).toHaveLength(4);
    expect(sentRows().map((r) => r.dayKey)).toEqual([String(first), String(first), String(second), String(second)].sort());
  });

  it("UC-412 AC-3: log lương về muộn được rà soát 02:00 (cùng nhánh ghi với \"Đồng bộ lịch sử SePay\") → có nhắc ① nhưng không tin nào; tên mục tiêu escape HTML ở bản đầy đủ, giữ chữ thật ở bản đẩy", async () => {
    db.exec("UPDATE accounts SET sepay_enabled = 1, sepay_connection_id = 'default' WHERE id = 'main'; UPDATE rules SET income_stream_id = 'salary' WHERE pattern = 'LUONG THANG';");
    vi.setSystemTime(new Date(AT("2026-11-11T02:00:00")));
    const payload = {
      id: 5020, gateway: "VCB", transactionDate: "2026-11-10 08:00:00", accountNumber: "1110001", subAccount: null, transferType: "in",
      transferAmount: 20_000_000, accumulated: 0, code: null, content: "LUONG THANG 11", referenceCode: "FT5020", description: "LUONG THANG 11",
    };
    const late = await ingestLog(env.DB, parseWebhookPayload(payload), "backfill", new Date(), "default");
    expect(late.salaryTxId).toBeDefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM month_tasks WHERE kind = 'savings' AND status = 'open' AND income_tx_id = ?").get(late.salaryTxId!)).toEqual({ n: 1 });
    expect(telegram()).toHaveLength(0);
    expect(sentRows()).toEqual([]);

    db.exec("UPDATE reserve_goals SET name = 'Học <phí>' WHERE id = 'school'");
    const notice = (await salaryNotice(env.DB, late.salaryTxId!, new Date()))!;
    expect(notice.full.split("\n")[1]).toBe("Mục tiêu còn thiếu: Học &lt;phí&gt; 2.000.000 ₫ ›");
    expect(notice.push.body).toContain("mục tiêu còn thiếu: Học <phí> 2.000.000 ₫");
  });

  it("UC-412 AC-4: lương 20.000.000 về VCB (vợ) — riêng tư của vợ, vợ còn hoạt động → vợ và chồng nhận cùng tin không số tiền; vợ đã tắt → tin có số như AC-1", async () => {
    db.exec("UPDATE accounts SET active = 1, private = 1, owner_member_id = 'wife', pocket = 'operating', pocket_confirmed = 1, opening_balance = 0, opened_at = '2026-01-01' WHERE id = 'vcb-wife'");
    const txId = await salary(20_000_000, "2026-11-10T08:00:00", "vcb-wife", "wife");
    await notifySalary(env, txId);

    const sent = telegram();
    expect(sent.map((s) => s.chat_id).sort()).toEqual(["111", "222"]);
    expect(sent[0]!.text).toBe(sent[1]!.text);
    expect(sent[0]!.text.split("\n")).toEqual(["Lương về · trích Tích luỹ 10%", "Mục tiêu còn thiếu: Học phí ›"]);
    const notice = (await salaryNotice(env.DB, txId, new Date()))!;
    expect(notice.push).toEqual({ title: "Lương về · trích 10%", body: "Trích Tích luỹ 10% · mục tiêu còn thiếu: Học phí" });
    for (const n of ["20.000.000", "2.000.000"]) {
      expect(sent[0]!.text).not.toContain(n);
      expect(notice.push.title + notice.push.body).not.toContain(n);
    }

    db.exec("UPDATE members SET active = 0 WHERE id = 'wife'");
    expect((await salaryNotice(env.DB, txId, new Date()))!.full.split("\n")[0]).toBe(LINE_20M);
  });

  it("UC-412: dựng tin lỗi → notifySalary chỉ ghi log, không ném lỗi, không gửi", async () => {
    const txId = await salary(20_000_000, "2026-11-10T08:00:00");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    db.exec("DROP TABLE month_task_tx");
    await expect(notifySalary(env, txId)).resolves.toBeUndefined();
    expect(telegram()).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^\[salary\] /));
    error.mockRestore();
  });
});
