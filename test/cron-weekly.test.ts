import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { weekly } from "../src/cron/weekly";
import type { Env } from "../src/env";
import { nearSpendLine } from "../src/notify/format";
import { createEntry, getSnapshot } from "../src/services/ledger";
import { pushPayload } from "../src/services/push";
import { asD1, openDb } from "./helpers/d1-sqlite";
import { AT } from "./helpers/household-c";
import { householdD, spend as spendD } from "./helpers/household-d";

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

async function spend(amount: number, categoryId: string, at: string) {
  const { tx } = await createEntry(env.DB, { meaning: "spend", amount, category_id: categoryId, account_id: "vcb-husband", at }, null, new Date(at));
  return Number((tx as { id: number }).id);
}

async function refund(amount: number, linkId: number, categoryId: string, at: string) {
  await createEntry(env.DB, { meaning: "refund", amount, category_id: categoryId, account_id: "vcb-husband", link_id: linkId, at }, null, new Date(at));
}

// Cron chạy 08:00 VN thứ Hai = 01:00 UTC thứ Hai. Tuần vừa kết thúc: 2026-W39 (21–27/9).
const monday = new Date("2026-09-28T01:00:00Z");

describe("cron 08:00 thứ Hai: tổng kết tuần vừa qua", () => {
  it("UC-406 AC-1: không dòng phong bì; 💰 như tin sáng; 🧾 tuần qua chi 800.000 · từ Vận hành 800.000 ≈ 114.000/ngày; top 5 (spend trừ refund), loại tuần khác", async () => {
    await spend(400_000, "groceries", "2026-09-23T10:00:00+07:00"); // W39
    await spend(100_000, "eating-out", "2026-09-24T10:00:00+07:00"); // W39
    await spend(150_000, "fuel-parking", "2026-09-25T10:00:00+07:00"); // W39
    const grabTx = await spend(80_000, "ride-hailing", "2026-09-26T10:00:00+07:00"); // W39
    await refund(20_000, grabTx, "ride-hailing", "2026-09-26T12:00:00+07:00"); // grab ròng còn 60.000
    await spend(50_000, "hangouts", "2026-09-22T10:00:00+07:00"); // W39
    await spend(40_000, "health", "2026-09-23T09:00:00+07:00"); // W39 — hạng 6, bị top5 loại
    await spend(500_000, "groceries", "2026-09-14T10:00:00+07:00"); // tuần trước (W38) — không được tính

    await weekly(env, monday);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = sentMessages();
    expect(sent.map((s) => s.chat_id).sort()).toEqual(["111", "222"]);
    expect(sent[0]!.text).toBe(sent[1]!.text);
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='weekly' AND day_key='2026-W39'").get()).toEqual({ n: 2 });

    const lines = sent[0]!.text.split("\n");
    const { nearSpend } = await getSnapshot(env.DB, null, monday);
    expect(lines.slice(0, 3)).toEqual(["📊 Tổng kết tuần T39 (21–27/9)", `💰 ${nearSpendLine(nearSpend)}`, "🧾 Tuần qua chi 800.000 ₫ · từ Vận hành 800.000 ₫ ≈ 114.000 ₫/ngày"]);
    expect(lines[3]).toMatch(/^🔎 Kỳ từ \d+\/\d+: /);
    expect(lines.slice(4)).toEqual([
      "🏆 Top 5 danh mục tiêu nhiều nhất:",
      "1. Đi chợ / nấu ăn — 400.000 ₫",
      "2. Xăng xe / gửi xe — 150.000 ₫",
      "3. Ăn ngoài — 100.000 ₫",
      "4. Grab / taxi — 60.000 ₫",
      "5. Tụ tập / cà phê — 50.000 ₫",
    ]);
    expect(sent[0]!.text).not.toMatch(/phong bì|820\.000 ₫$/m);
  });

  it("UC-406 AC-2: chạy lại cùng tuần không gửi trùng", async () => {
    await weekly(env, monday);
    await weekly(env, monday);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("tin tuần theo nhịp Vận hành, hộ mẫu D (261112-ba-ngan-nhin-lai)", () => {
  let d: DatabaseSync;
  const sendAt = new Date(AT("2026-11-23T08:00:00")); // thứ Hai, tổng kết W47 (16–22/11)

  /** Chi kỳ 10/11 viết lại cho đúng AC-11: trước W47 Ăn uống 1.500.000, Đi lại 350.000, Mua sắm 500.000; W47 như AC-11. */
  beforeEach(() => {
    d = householdD();
    d.exec("UPDATE members SET tg_chat_id = '111' WHERE id = 'husband'");
    d.exec("UPDATE transactions SET status = 'void' WHERE meaning IN ('spend', 'refund') AND at >= '2026-11-10T01:00:00.000Z'");
    spendD(d, { at: "2026-11-11T09:00", amount: 1_500_000, category: "groceries" });
    spendD(d, { at: "2026-11-12T09:00", amount: 500_000, category: "shopping" });
    spendD(d, { at: "2026-11-14T09:00", amount: 350_000, category: "fuel-parking" });
    spendD(d, { at: "2026-11-17T09:00", amount: 600_000, category: "groceries" });
    spendD(d, { at: "2026-11-18T19:00", amount: 200_000, category: "eating-out" });
    const grab = spendD(d, { at: "2026-11-19T21:00", amount: 150_000, category: "ride-hailing" });
    spendD(d, { at: "2026-11-19T22:00", amount: 50_000, category: "ride-hailing", meaning: "refund", linkId: grab });
    spendD(d, { at: "2026-11-20T20:00", amount: 700_000, category: "shopping" });
    spendD(d, { at: "2026-11-21T12:00", amount: 500_000, category: "gifts", account: "ewallet" });
    env = { DB: asD1(d), TG_BOT_TOKEN: "test-token" } as Env;
  });

  /** Ghim tiền vận hành lúc gửi về đúng số của AC-11 (9.000.000) bằng số dư đầu tài khoản chính. */
  async function pinNearSpend(amount: number) {
    const { nearSpend } = await getSnapshot(env.DB, null, sendAt);
    d.prepare("UPDATE accounts SET opening_balance = opening_balance + ? WHERE id = 'main'").run(amount - nearSpend.amount);
    expect((await getSnapshot(env.DB, null, sendAt)).nearSpend).toMatchObject({ amount, perDay: 529_000, payday: "2026-12-10", daysLeft: 17 });
  }

  it("UC-406 AC-11: tin đầy đủ đúng 💰 / 🧾 / 🔎 / 🏆; không chữ \"phong bì\", \"ví\", \"bù\"", async () => {
    await pinNearSpend(9_000_000);
    await weekly(env, sendAt);
    const [{ text }] = sentMessages();
    expect(text).toBe(
      [
        "📊 Tổng kết tuần T47 (16–22/11)",
        "💰 Vận hành 9.000.000 ₫ · chi khoảng 529.000 ₫/ngày tới kỳ lương 10/12 (còn 17 ngày)",
        "🧾 Tuần qua chi 2.100.000 ₫ · từ Vận hành 1.600.000 ₫ ≈ 228.000 ₫/ngày",
        "🔎 Kỳ từ 10/11: Ăn uống 2.300.000 ₫ / 3.000.000 ₫ · Đi lại 450.000 ₫ / 800.000 ₫ · Mua sắm 1.200.000 ₫ / 1.000.000 ₫ (vượt 200.000 ₫)",
        "🏆 Top 5 danh mục tiêu nhiều nhất:",
        "1. Mua sắm — 700.000 ₫",
        "2. Đi chợ / nấu ăn — 600.000 ₫",
        "3. Quà tặng — 500.000 ₫",
        "4. Ăn ngoài — 200.000 ₫",
        "5. Grab / taxi — 100.000 ₫",
      ].join("\n"),
    );
    expect(text).not.toMatch(/phong bì|\bví\b|bù/i);
  });

  it("UC-406 AC-12: tài khoản riêng tư của người vợ (Vận hành) chi Ăn ngoài 300.000 → tổng 2.400.000, từ Vận hành 1.900.000, Ăn ngoài 500.000 trong top 5 (tổng, không khoản nào); thông báo đẩy mở /#wallets/analysis", async () => {
    d.exec(`INSERT INTO accounts (id, name, kind, bank, owner_member_id, opening_balance, pocket, pocket_confirmed, private)
      VALUES ('wife-private', 'Tài khoản riêng (vợ)', 'bank', 'ACB', 'wife', 5000000, 'operating', 1, 1)`);
    spendD(d, { at: "2026-11-18T12:00", amount: 300_000, category: "eating-out", account: "wife-private" });
    await weekly(env, sendAt);
    const lines = sentMessages()[0]!.text.split("\n");
    expect(lines).toContain("🧾 Tuần qua chi 2.400.000 ₫ · từ Vận hành 1.900.000 ₫ ≈ 271.000 ₫/ngày");
    expect(lines.some((l) => /^[1-5]\. Ăn ngoài — 500\.000 ₫$/.test(l))).toBe(true);
    expect(pushPayload("weekly", { title: "t", body: "b" })).toMatchObject({ url: "/#wallets/analysis", tag: "weekly" });
  });

  it("UC-406 AC-3: tuần không chi → tiêu đề, 💰, 🔎 dạng \"Ăn uống 0 ₫ / 3.000.000 ₫\", câu rỗng; không 🧾, không 🏆", async () => {
    d.exec("UPDATE transactions SET status = 'void' WHERE meaning IN ('spend', 'refund') AND at >= '2026-11-10T01:00:00.000Z'");
    const at = new Date(AT("2026-11-16T08:00:00")); // tổng kết W46 (9–15/11)
    await weekly(env, at);
    const { nearSpend } = await getSnapshot(env.DB, null, at);
    expect(sentMessages()[0]!.text.split("\n")).toEqual([
      "📊 Tổng kết tuần T46 (9–15/11)",
      `💰 ${nearSpendLine(nearSpend)}`,
      "🔎 Kỳ từ 10/11: Ăn uống 0 ₫ / 3.000.000 ₫ · Đi lại 0 ₫ / 800.000 ₫ · Mua sắm 0 ₫ / 1.000.000 ₫",
      "Không có dữ liệu chi tiêu tuần này.",
    ]);
  });
});
