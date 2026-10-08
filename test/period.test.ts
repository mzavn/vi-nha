import { describe, expect, it } from "vitest";
import { dayKey, mondaysInMonth, monthKey, monthsLeft, weekKey, weeksLeftInMonth, weekStart } from "../src/domain/period";

describe("kỳ theo giờ Việt Nam", () => {
  it("23:30 UTC đã là ngày hôm sau ở VN", () => {
    expect(dayKey("2026-09-30T23:30:00Z")).toBe("2026-10-01");
    expect(monthKey("2026-09-30T23:30:00Z")).toBe("2026-10");
    expect(dayKey("2026-09-30T16:59:59Z")).toBe("2026-09-30");
  });

  it("cron 02:00 VN chạy lúc 19:00 UTC hôm trước vẫn thuộc đúng ngày VN", () => {
    expect(dayKey("2026-09-21T19:00:00Z")).toBe("2026-09-22");
  });

  it("nhận cả chuỗi có múi giờ +07:00", () => {
    expect(dayKey("2026-09-22T00:30:00+07:00")).toBe("2026-09-22");
  });
});

describe("tuần ISO", () => {
  it.each([
    ["2026-09-21T09:00:00+07:00", "2026-W39"], // thứ Hai
    ["2026-09-27T23:00:00+07:00", "2026-W39"], // Chủ nhật cùng tuần
    ["2026-12-31T12:00:00+07:00", "2026-W53"], // 2026 có 53 tuần
    ["2027-01-03T12:00:00+07:00", "2026-W53"], // Chủ nhật đầu năm vẫn thuộc tuần cuối năm trước
    ["2027-01-04T00:30:00+07:00", "2027-W01"],
    ["2024-12-30T12:00:00+07:00", "2025-W01"], // cuối tháng 12 đã sang tuần 1 năm sau
  ])("%s → %s", (at, expected) => expect(weekKey(at)).toBe(expected));

  it.each([
    ["2026-W39", "2026-09-21"],
    ["2026-W01", "2025-12-29"], // thứ Hai tuần 1 có thể nằm ở năm trước
    ["2026-W53", "2026-12-28"],
    ["2027-W01", "2027-01-04"],
    ["2026-W45", "2026-11-02"],
  ])("thứ Hai của %s là %s", (week, monday) => {
    expect(weekStart(week)).toBe(monday);
    expect(weekKey(`${monday}T12:00:00+07:00`)).toBe(week);
  });
});

describe("tuần → tháng", () => {
  it("đếm số thứ Hai thật của tháng", () => {
    expect(mondaysInMonth("2026-09")).toBe(4);
    expect(mondaysInMonth("2026-11")).toBe(5);
    expect(mondaysInMonth("2026-02")).toBe(4);
    expect(() => mondaysInMonth("2026-13")).toThrow();
  });

  it("số tuần còn lại tính cả tuần đang chạy", () => {
    expect(weeksLeftInMonth("2026-09-01T08:00:00+07:00")).toBe(5); // còn các thứ Hai 7, 14, 21, 28
    expect(weeksLeftInMonth("2026-09-22T08:00:00+07:00")).toBe(2);
    expect(weeksLeftInMonth("2026-09-30T08:00:00+07:00")).toBe(1);
  });
});

describe("số tháng còn lại tới hạn mục tiêu", () => {
  it("tính cả tháng hiện tại, tối thiểu 1", () => {
    expect(monthsLeft("2026-09-10T00:00:00+07:00", "2026-12-10")).toBe(3);
    expect(monthsLeft("2026-09-10T00:00:00+07:00", "2026-09-30")).toBe(1);
    expect(monthsLeft("2026-09-10T00:00:00+07:00", "2026-01-01")).toBe(1); // quá hạn
  });
});
