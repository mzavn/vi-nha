import { describe, expect, it } from "vitest";
import { atForDay, dayHeading, daysLeftInWeek, heroLabel, weekMetaText, monthLabel, previousDay, previousMonth, shortDate, timeHM, weekLabel, weekRange } from "./period";

describe("nhãn kỳ", () => {
  it("tuần trong một tháng: T39 (21–27/9)", () => {
    expect(weekLabel("2026-W39", "2026-09-21", "2026-09-27")).toBe("T39 (21–27/9)");
    expect(weekLabel("2026-W38", "2026-09-14", "2026-09-20")).toBe("T38 (14–20/9)");
  });

  it("tuần vắt qua hai tháng ghi đủ cả hai", () => {
    expect(weekLabel("2026-W40", "2026-09-28", "2026-10-04")).toBe("T40 (28/9–4/10)");
  });

  it("tuần tính theo giờ VN, không theo UTC", () => {
    // 23:30 UTC Chủ nhật 20/9 = 06:30 thứ Hai 21/9 giờ VN → tuần 39
    const r = weekRange(new Date("2026-09-20T23:30:00Z"));
    expect(r).toEqual({ key: "2026-W39", start: "2026-09-21", end: "2026-09-27" });
    expect(weekLabel(r.key, r.start, r.end)).toBe("T39 (21–27/9)");
  });

  it("tháng", () => {
    expect(monthLabel("2026-09")).toBe("tháng 9/2026");
    expect(monthLabel("2027-01")).toBe("tháng 1/2027");
  });

  it("tháng trước, kể cả qua năm", () => {
    expect(previousMonth("2026-09")).toBe("2026-08");
    expect(previousMonth("2026-10")).toBe("2026-09");
    expect(previousMonth("2027-01")).toBe("2026-12");
  });

  it("ngày và giờ", () => {
    expect(dayHeading("2026-09-22")).toBe("Thứ Ba 22/9");
    expect(dayHeading("2026-09-20")).toBe("Chủ nhật 20/9");
    expect(shortDate("2026-09-05")).toBe("5/9");
    expect(shortDate("2026-09-21T18:00:00Z")).toBe("22/9");
    expect(timeHM("2026-09-22T07:05:00Z")).toBe("14:05");
    expect(daysLeftInWeek("2026-09-22", "2026-09-27")).toBe(6);
    expect(daysLeftInWeek("2026-09-27", "2026-09-27")).toBe(1);
    expect(previousDay("2026-10-01")).toBe("2026-09-30");
  });

  it("ngày chọn lùi lấy 12:00 giờ VN, hôm nay giữ giờ thật", () => {
    const now = new Date("2026-09-22T03:00:00Z");
    expect(atForDay("2026-09-22", now)).toBe(now.toISOString());
    expect(atForDay("2026-09-21", now)).toBe("2026-09-21T05:00:00.000Z");
  });
});

describe("số hero 'còn để chi tuần này' viết đủ chữ", () => {
  it("âm thì đổi nhãn thành 'đã chi vượt' và hiện số dương, không còn '−X' dưới chữ 'còn'", () => {
    expect(heroLabel(-415_300)).toEqual({ label: "Tuần này đã chi vượt", amount: 415_300, over: true });
    expect(heroLabel(0)).toEqual({ label: "Còn để chi tuần này", amount: 0, over: false });
  });

  it("dòng phụ: ngày cuối tuần và số tuần còn lại SAU tuần này (Chủ nhật 4/10/2026: còn 4 tuần, không phải 5)", () => {
    expect(weekMetaText("2026-10-04", "2026-10-04", 5)).toBe("Hôm nay là ngày cuối tuần (CN 4/10) · tháng 10 còn 4 tuần nữa");
    expect(weekMetaText("2026-10-26", "2026-11-01", 1)).toBe("Tuần này còn 7 ngày (hết CN 1/11) · đây là tuần cuối của tháng 10");
  });
});
