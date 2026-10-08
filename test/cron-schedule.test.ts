import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRONS, runScheduled } from "../src/cron";
import { loadNotifyState, runScheduledDigests } from "../src/cron/schedule";
import { inQuietHours, parseNotifySchedule } from "../src/domain/notify-schedule";
import type { Env } from "../src/env";
import { allocateIncome, createEntry } from "../src/services/ledger";
import { sqliteDateTime } from "../src/services/ingest";
import { asD1, openDb } from "./helpers/d1-sqlite";

let env: Env;
let raw: ReturnType<typeof openDb>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  raw = openDb();
  raw.prepare("UPDATE allocations SET target_date = '2026-12-31' WHERE wallet_id = 'travel'").run();
  raw.prepare("UPDATE accounts SET sepay_enabled = 0").run(); // nhập tay được vào mọi tài khoản
  raw.prepare("UPDATE members SET tg_chat_id = ? WHERE id = ?").run("111", "husband");
  raw.prepare("UPDATE members SET tg_chat_id = ? WHERE id = ?").run("222", "wife");
  env = { DB: asD1(raw), TG_BOT_TOKEN: "test-token" } as Env;
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

/** Giờ VN → Date. */
const vn = (local: string) => new Date(`${local}+07:00`);
/** Lượt cron đúng như Cloudflare gọi: 01:00–03:59 VN là lượt mỗi giờ, còn lại lượt 15 phút. */
const tick = (local: string) => {
  const hour = Number(local.slice(11, 13));
  return runScheduled(hour >= 1 && hour <= 3 ? CRONS.nightHourly : CRONS.quarterHour, env, vn(local));
};
const setConfig = (k: string, v: string) => raw.prepare("UPDATE config SET v = ? WHERE k = ?").run(v, k);
const sent = (kind: string) => (raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = ? AND ok = 1").get(kind) as { n: number }).n;
const pendingTexts = () =>
  fetchMock.mock.calls.map(([, opts]) => (JSON.parse((opts as RequestInit).body as string) as { text: string }).text).filter((t) => t.includes("chưa gán:"));

describe("giờ nhắc: tin sáng theo giờ ở Cài đặt", () => {
  it("mặc định 07:00: lượt 06:45 chưa gửi, lượt 07:00 gửi, lượt 07:15 không gửi lại", async () => {
    await tick("2026-09-22T06:45:00");
    expect(sent("daily")).toBe(0);
    await tick("2026-09-22T07:00:00");
    expect(sent("daily")).toBe(2);
    await tick("2026-09-22T07:15:00");
    expect(sent("daily")).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lỡ lượt đúng giờ thì lượt kế tiếp gửi bù; cả ngày chỉ một lần; hôm sau gửi tiếp", async () => {
    await tick("2026-09-22T07:15:00");
    await tick("2026-09-22T23:45:00");
    expect(raw.prepare("SELECT day_key, COUNT(*) n FROM notifications WHERE kind = 'daily' GROUP BY day_key").all()).toEqual([{ day_key: "2026-09-22", n: 2 }]);
    await tick("2026-09-23T07:00:00");
    expect(sent("daily")).toBe(4);
  });

  it("giờ tự chọn 06:30: lượt 06:15 chưa gửi, lượt 06:30 gửi", async () => {
    setConfig("notify_daily_time", "06:30");
    await tick("2026-09-22T06:15:00");
    expect(sent("daily")).toBe(0);
    await tick("2026-09-22T06:30:00");
    expect(sent("daily")).toBe(2);
  });

  it("giờ trong 01:00–04:00 chạy ở lượt mỗi giờ kế tiếp: 01:30 gửi lúc 02:00", async () => {
    setConfig("notify_daily_time", "01:30");
    await tick("2026-09-22T01:00:00");
    expect(sent("daily")).toBe(0);
    await tick("2026-09-22T02:00:00");
    expect(sent("daily")).toBe(2);
  });

  it("đã gửi rồi mới đổi giờ (sớm hơn hay muộn hơn) thì hôm đó không gửi lại", async () => {
    await tick("2026-09-22T07:00:00");
    setConfig("notify_daily_time", "06:00");
    await tick("2026-09-22T07:15:00");
    setConfig("notify_daily_time", "09:00");
    await tick("2026-09-22T09:00:00");
    expect(sent("daily")).toBe(2);
  });

  it("tắt tin sáng: không gửi gì, nhưng ngày 1 vẫn chốt tháng trước từ giờ tin sáng", async () => {
    const { tx } = await createEntry(env.DB, { meaning: "income", amount: 40_000_000, account_id: "vcb-husband", at: "2026-09-10T09:00:00+07:00" }, null, vn("2026-09-10T09:00:00"));
    await allocateIncome(env.DB, Number((tx as { id: number }).id));
    setConfig("notify_daily_enabled", "0");
    const swept = () => (raw.prepare("SELECT COUNT(*) n FROM transactions WHERE batch_id = 'S202609'").get() as { n: number }).n;

    await tick("2026-09-30T07:00:00"); // ngày thường: tắt là không làm gì, không cả ghi mốc
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'daily_run'").get()).toEqual({ n: 0 });
    await tick("2026-10-01T06:45:00");
    expect(swept()).toBe(0);
    await tick("2026-10-01T07:00:00");
    const closed = swept();
    expect(closed).toBeGreaterThan(0);
    await tick("2026-10-01T07:15:00");
    expect(swept()).toBe(closed); // chốt một lần, không quét thêm
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tin sáng lỗi giữa chừng thì nhả mốc: lượt cron sau làm lại", async () => {
    const real = env.DB.prepare.bind(env.DB);
    const broken = vi.spyOn(env.DB, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("kind = 'backfill'")) throw new Error("D1 hỏng");
      return real(sql);
    });
    await expect(tick("2026-09-22T07:00:00")).rejects.toThrow();
    expect(raw.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'daily_run'").get()).toEqual({ n: 0 });
    broken.mockRestore();
    await tick("2026-09-22T07:15:00");
    expect(sent("daily")).toBe(2);
  });
});

describe("giờ nhắc: tổng kết tuần", () => {
  beforeEach(() => setConfig("notify_daily_enabled", "0"));

  it("mặc định thứ Hai 08:00: gửi đúng một lần cho tuần vừa qua; ngày khác không gửi", async () => {
    await tick("2026-09-28T07:45:00");
    expect(sent("weekly")).toBe(0);
    await tick("2026-09-28T08:00:00");
    await tick("2026-09-28T08:15:00");
    await tick("2026-09-29T08:00:00");
    expect(raw.prepare("SELECT day_key, COUNT(*) n FROM notifications WHERE kind = 'weekly' GROUP BY day_key").all()).toEqual([{ day_key: "2026-W39", n: 2 }]);
  });

  it("chọn Chủ nhật 20:00: tổng kết tuần kết thúc hôm nay; đổi về thứ Hai sau khi gửi thì không gửi lại tuần đó", async () => {
    setConfig("notify_weekly_day", "7");
    setConfig("notify_weekly_time", "20:00");
    await tick("2026-09-27T19:45:00");
    expect(sent("weekly")).toBe(0);
    await tick("2026-09-27T20:00:00");
    expect(raw.prepare("SELECT DISTINCT day_key FROM notifications WHERE kind = 'weekly'").all()).toEqual([{ day_key: "2026-W39" }]);
    setConfig("notify_weekly_day", "1");
    setConfig("notify_weekly_time", "08:00");
    await tick("2026-09-28T08:00:00");
    expect(sent("weekly")).toBe(2);
  });

  it("tắt tổng kết tuần thì không gửi", async () => {
    setConfig("notify_weekly_enabled", "0");
    await tick("2026-09-28T08:00:00");
    expect(sent("weekly")).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("giờ nhắc: lượt chưa tới giờ không tốn thêm truy vấn", () => {
  it("chưa tới giờ (kể cả ngày 1) hay đã gửi rồi: chỉ một câu đọc lịch + mốc, không chốt tháng, không gửi", async () => {
    const prepare = vi.spyOn(env.DB, "prepare");
    await runScheduledDigests(env, vn("2026-10-01T06:45:00"), await loadNotifyState(env.DB));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(raw.prepare("SELECT COUNT(*) n FROM transactions WHERE batch_id = 'S202609'").get()).toEqual({ n: 0 });

    await runScheduledDigests(env, vn("2026-10-01T07:00:00"), await loadNotifyState(env.DB));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    prepare.mockClear();
    await runScheduledDigests(env, vn("2026-10-01T07:15:00"), await loadNotifyState(env.DB));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("lượt cron: hai biểu thức, rà soát 02:00", () => {
  it("cả hai biểu thức cron vào cùng một lượt; cron cũ chỉ cảnh báo, không làm gì", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setConfig("notify_daily_time", "02:00");
    await runScheduled(CRONS.nightHourly, env, vn("2026-09-22T02:00:00"));
    expect(sent("daily")).toBe(2);
    await runScheduled("*/5 * * * *", env, vn("2026-09-23T07:00:00"));
    expect(warn).toHaveBeenCalledWith("cron lạ: */5 * * * *");
    expect(sent("daily")).toBe(2);
    await runScheduled(CRONS.quarterHour, env, vn("2026-09-23T07:00:00"));
    expect(sent("daily")).toBe(4);
  });

  describe("rà soát giao dịch qua API SePay", () => {
    let sepayCalls: string[];
    beforeEach(() => {
      raw.prepare("UPDATE accounts SET sepay_enabled = 1 WHERE id = 'vcb-husband'").run();
      env = { ...env, SEPAY_API_TOKEN: "hist-token" };
      setConfig("notify_daily_enabled", "0");
      setConfig("notify_weekly_enabled", "0");
      sepayCalls = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL) => {
          sepayCalls.push(String(url));
          return new Response(JSON.stringify({ status: "success", data: [], meta: { pagination: { has_more: false } } }), { status: 200 });
        }),
      );
    });
    const backfillRows = () => raw.prepare("SELECT day_key FROM notifications WHERE kind = 'backfill'").all();

    it("chỉ chạy ở lượt 02:00 VN, không ở 01:00, 03:00 hay các lượt 15 phút", async () => {
      for (const t of ["2026-09-22T00:45:00", "2026-09-22T01:00:00", "2026-09-22T03:00:00", "2026-09-22T04:00:00", "2026-09-22T19:00:00"]) await tick(t);
      expect(sepayCalls).toEqual([]);
      expect(backfillRows()).toEqual([]);
      await tick("2026-09-22T02:00:00");
      expect(sepayCalls).toHaveLength(1);
      expect(backfillRows()).toEqual([{ day_key: "2026-09-22" }]);
    });

    it("rà soát lỗi không chặn việc khác của lượt 02:00, rồi báo lỗi ra ngoài", async () => {
      setConfig("notify_daily_enabled", "1");
      setConfig("notify_daily_time", "02:00");
      const real = env.DB.prepare.bind(env.DB);
      vi.spyOn(env.DB, "prepare").mockImplementation((sql: string) => {
        if (sql.includes("FROM accounts WHERE sepay_enabled = 1")) throw new Error("D1 hỏng");
        return real(sql);
      });
      await expect(tick("2026-09-22T02:00:00")).rejects.toThrow();
      expect(sent("daily")).toBe(2);
    });
  });
});

describe("giờ yên lặng & bật/tắt báo giao dịch chưa gán", () => {
  beforeEach(() => setConfig("notify_daily_enabled", "0"));

  const pendingLog = (id: string, receivedVn: string) =>
    raw
      .prepare("INSERT INTO bank_logs (id, at, amount, direction, account_id, status, received_at) VALUES (?, ?, 400000, 'in', 'vcb-husband', 'pending', ?)")
      .run(id, vn(receivedVn).toISOString(), sqliteDateTime(vn(receivedVn)));

  it("về trong giờ yên lặng 22:00–06:30 thì không báo; lượt 06:30 gom lại báo một tin", async () => {
    pendingLog("dem-1", "2026-09-22T23:00:00");
    pendingLog("dem-2", "2026-09-23T03:00:00");
    await tick("2026-09-22T23:15:00");
    await tick("2026-09-23T03:00:00");
    await tick("2026-09-23T06:15:00");
    expect(pendingTexts()).toEqual([]);
    await tick("2026-09-23T06:30:00");
    expect(pendingTexts()).toHaveLength(2); // một tin cho mỗi người
    expect(pendingTexts()[0]).toContain("2 giao dịch chưa gán");
    await tick("2026-09-23T06:45:00");
    expect(pendingTexts()).toHaveLength(2);
  });

  it("khung không qua nửa đêm (12:00–13:30): ngoài khung báo ngay lượt sau, trong khung chờ tới 13:30", async () => {
    setConfig("notify_quiet_start", "12:00");
    setConfig("notify_quiet_end", "13:30");
    pendingLog("sang", "2026-09-22T11:00:00");
    await tick("2026-09-22T11:15:00");
    expect(pendingTexts()).toHaveLength(2);
    pendingLog("trua", "2026-09-22T12:10:00");
    await tick("2026-09-22T12:15:00");
    await tick("2026-09-22T13:15:00");
    expect(pendingTexts()).toHaveLength(2);
    await tick("2026-09-22T13:30:00");
    expect(pendingTexts()).toHaveLength(4);
  });

  it("tắt báo giao dịch chưa gán thì không báo kể cả ngoài giờ yên lặng; bật lại thì báo những khoản còn chờ", async () => {
    setConfig("notify_pending_enabled", "0");
    pendingLog("lo", "2026-09-22T10:00:00");
    await tick("2026-09-22T10:15:00");
    expect(pendingTexts()).toEqual([]);
    setConfig("notify_pending_enabled", "1");
    await tick("2026-09-22T10:30:00");
    expect(pendingTexts()).toHaveLength(2);
  });

  it("giờ yên lặng bắt đầu = kết thúc là không đặt; giá trị hỏng trong config thì dùng mặc định", () => {
    expect(inQuietHours(23 * 60, "00:00", "00:00")).toBe(false);
    expect(inQuietHours(22 * 60, "22:00", "06:30")).toBe(true);
    expect(inQuietHours(6 * 60 + 30, "22:00", "06:30")).toBe(false);
    expect(parseNotifySchedule({ notify_daily_time: "7h", notify_weekly_day: "9", notify_pending_enabled: "yes" })).toMatchObject({
      dailyTime: "07:00",
      weeklyDay: 1,
      pendingEnabled: true,
    });
  });
});
