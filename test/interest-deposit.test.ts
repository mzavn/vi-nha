// Hàm thuần của lãi tiền gửi (change 261018-lai-tien-gui): nhận diện log lãi (ví nhận lãi đã bỏ, ADR-123).
import { describe, expect, it } from "vitest";
import { isInterestLog } from "../src/domain/interest-deposit";

describe("isInterestLog: log lãi = tiền vào dưới ngưỡng, nội dung rỗng / BankAPINotify / cụm lãi", () => {
  const inLog = (amount: number, content: string | null) => ({ direction: "in", amount, content });

  it("UC-303: rỗng, BankAPINotify (mọi kiểu hoa thường, khoảng trắng), 'LAI TIEN GUI', 'Lãi không kỳ hạn', 'TRA LAI TIEN GUI' dưới 10.000 → lãi", () => {
    for (const c of [null, "", "   ", "BankAPINotify", " bankapinotify ", "LAI TIEN GUI THANG 10", "Lãi  không   kỳ hạn", "TRA LAI TIEN GUI"]) {
      expect(isInterestLog(inLog(37, c), 10_000)).toBe(true);
    }
  });

  it("UC-303: 'CHO THUE LAI P2', 'HOAN TRA LAI TIEN THUA', 'trả lại tiền', tiền ra, 10.000 trở lên, ngưỡng 0 → không phải lãi", () => {
    expect(isInterestLog(inLog(5_000, "CHO THUE LAI P2"), 10_000)).toBe(false);
    expect(isInterestLog(inLog(5_000, "HOAN TRA LAI TIEN THUA"), 10_000)).toBe(false);
    expect(isInterestLog(inLog(5_000, "trả lại tiền"), 10_000)).toBe(false);
    expect(isInterestLog({ direction: "out", amount: 37, content: null }, 10_000)).toBe(false);
    expect(isInterestLog(inLog(9_999, null), 10_000)).toBe(true);
    expect(isInterestLog(inLog(10_000, null), 10_000)).toBe(false);
    expect(isInterestLog(inLog(50_000, "BankAPINotify"), 10_000)).toBe(false);
    expect(isInterestLog(inLog(37, "BankAPINotify"), 0)).toBe(false);
  });
});
