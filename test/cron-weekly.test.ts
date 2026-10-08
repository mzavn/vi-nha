import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { weekly } from "../src/cron/weekly";
import type { Env } from "../src/env";
import { createEntry } from "../src/services/ledger";
import { asD1, openDb } from "./helpers/d1-sqlite";

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
  it("đã tiêu/dự kiến từng ví phong bì tuần + top 5 danh mục (spend trừ refund), loại tuần khác", async () => {
    await spend(400_000, "groceries", "2026-09-23T10:00:00+07:00"); // an, W39
    await spend(100_000, "eating-out", "2026-09-24T10:00:00+07:00"); // an, W39
    await spend(150_000, "fuel-parking", "2026-09-25T10:00:00+07:00"); // transport, W39
    const grabTx = await spend(80_000, "ride-hailing", "2026-09-26T10:00:00+07:00"); // transport, W39
    await refund(20_000, grabTx, "ride-hailing", "2026-09-26T12:00:00+07:00"); // grab ròng còn 60.000
    await spend(50_000, "hangouts", "2026-09-22T10:00:00+07:00"); // fun-husband, W39
    await spend(40_000, "health", "2026-09-23T09:00:00+07:00"); // nice-to-have, W39 — hạng 6, bị top5 loại
    await spend(500_000, "groceries", "2026-09-14T10:00:00+07:00"); // tuần trước (W38) — không được tính

    await weekly(env, monday);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = sentMessages();
    expect(sent.map((s) => s.chat_id).sort()).toEqual(["111", "222"]);
    expect(sent[0]!.text).toBe(sent[1]!.text);
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind='weekly' AND day_key='2026-W39'").get()).toEqual({ n: 2 });

    expect(sent[0]!.text).toBe(
      [
        "📊 Tổng kết tuần T39 (21–27/9)",
        "Chơi (chồng): 50.000 ₫ / 820.000 ₫",
        "Chơi (vợ): 0 ₫ / 820.000 ₫",
        "Ăn uống: 500.000 ₫ / 625.000 ₫",
        "Đi lại: 210.000 ₫ / 300.000 ₫",
        "🏆 Top 5 danh mục tiêu nhiều nhất:",
        "1. Đi chợ / nấu ăn — 400.000 ₫",
        "2. Xăng xe / gửi xe — 150.000 ₫",
        "3. Ăn ngoài — 100.000 ₫",
        "4. Grab / taxi — 60.000 ₫",
        "5. Tụ tập / cà phê — 50.000 ₫",
      ].join("\n"),
    );
  });

  it("chạy lại cùng tuần không gửi trùng", async () => {
    await weekly(env, monday);
    await weekly(env, monday);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tuần không có chi tiêu: vẫn hiện các ví phong bì (0 đồng), không có mục top 5", async () => {
    await weekly(env, monday);
    const [{ text }] = sentMessages();
    expect(text).toBe(
      ["📊 Tổng kết tuần T39 (21–27/9)", "Chơi (chồng): 0 ₫ / 820.000 ₫", "Chơi (vợ): 0 ₫ / 820.000 ₫", "Ăn uống: 0 ₫ / 625.000 ₫", "Đi lại: 0 ₫ / 300.000 ₫"].join("\n"),
    );
    expect(text).not.toContain("🏆");
    expect(text).not.toContain("Không có dữ liệu");
  });
});
