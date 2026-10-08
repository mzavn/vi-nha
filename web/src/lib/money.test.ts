import { describe, expect, it } from "vitest";
import { addAmount, amountText, evalAmount, formatSigned, formatVnd, groupDigits, groupExpr, isAmountExpr, MAX_AMOUNT, MINUS, nextAmount, parseAmount, timesThousand } from "./money";

const NBSP = " ";

describe("định dạng tiền", () => {
  it("chấm phân nhóm, ₫ sau số", () => {
    expect(formatVnd(1_250_000)).toBe(`1.250.000${NBSP}₫`);
    expect(formatVnd(0)).toBe(`0${NBSP}₫`);
    expect(formatVnd(950)).toBe(`950${NBSP}₫`);
    expect(formatVnd(1_000)).toBe(`1.000${NBSP}₫`);
    expect(formatVnd(12_000_000_000)).toBe(`12.000.000.000${NBSP}₫`);
  });

  it("số âm dùng dấu trừ U+2212, không phải gạch nối", () => {
    expect(formatVnd(-150_000)).toBe(`${MINUS}150.000${NBSP}₫`);
    expect(MINUS).toBe("−");
    expect(formatVnd(-150_000)).not.toContain("-");
  });

  it("không làm tròn", () => {
    expect(groupDigits(1_234_567)).toBe("1.234.567");
    expect(groupDigits(999_999)).toBe("999.999");
    expect(groupDigits(1_000_001)).toBe("1.000.001");
  });

  it("chênh lệch có dấu +", () => {
    expect(formatSigned(120_000)).toBe("+120.000");
    expect(formatSigned(-120_000)).toBe(`${MINUS}120.000`);
    expect(formatSigned(0)).toBe("0");
  });
});

describe("nhập số", () => {
  it("đọc chuỗi có dấu chấm", () => {
    expect(parseAmount("1.250.000")).toBe(1_250_000);
    expect(parseAmount("  25 000 ")).toBe(25_000);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("abc")).toBe(0);
    expect(parseAmount("007")).toBe(7);
  });

  it("ô nhập gốc: gõ số hiện nhóm chấm, xoá hết thì trống", () => {
    expect(nextAmount(0, "1250000")).toBe(1_250_000);
    expect(amountText(nextAmount(0, "1250000"))).toBe("1.250.000");
    // gõ thêm một số vào chuỗi đã có dấu chấm
    expect(nextAmount(125_000, "125.0005")).toBe(1_250_005);
    // xoá lùi qua dấu chấm vẫn ra số đúng
    expect(nextAmount(1_250_000, "1.250.00")).toBe(125_000);
    expect(nextAmount(5, "")).toBe(0);
    expect(amountText(0)).toBe("");
    // dán chữ lẫn số
    expect(nextAmount(0, "50k")).toBe(50);
  });

  it("chặn vượt trần: giữ số trước đó", () => {
    expect(nextAmount(MAX_AMOUNT, "10000000000000")).toBe(MAX_AMOUNT);
    expect(nextAmount(7, "9999999999999")).toBe(7);
    expect(nextAmount(0, String(MAX_AMOUNT))).toBe(MAX_AMOUNT);
  });

  it("nút nhanh và +000", () => {
    expect(addAmount(0, 50_000)).toBe(50_000);
    expect(addAmount(MAX_AMOUNT - 1, 50_000)).toBe(MAX_AMOUNT);
    expect(timesThousand(25)).toBe(25_000);
    expect(timesThousand(0)).toBe(0);
    expect(timesThousand(10_000_000_000)).toBe(10_000_000_000);
  });
});

describe("phép tính trong ô số tiền", () => {
  it("cộng trừ nhân cùng đơn vị đồng như ô hiện, nhân trước cộng sau", () => {
    expect(evalAmount("24+55")).toBe(79);
    expect(evalAmount(" 24 + 55 ")).toBe(79);
    expect(evalAmount("24.000+55.000")).toBe(79_000);
    expect(evalAmount("1.250.000 - 250.000")).toBe(1_000_000);
    expect(evalAmount(`100${MINUS}30`)).toBe(70);
    expect(evalAmount("3×20.000+5")).toBe(60_005);
    expect(evalAmount("2*3*4")).toBe(24);
    expect(evalAmount("79")).toBe(79);
  });

  it("dấu phép tính ở cuối khi đang gõ: hiện kết quả trước đó, không báo sai", () => {
    expect(evalAmount("24+")).toBe(24);
    expect(evalAmount("24+55-")).toBe(79);
    expect(evalAmount("24.000 + ")).toBe(24_000);
  });

  it("không ra số tiền hợp lệ thì null: kết quả ≤ 0, vượt trần, hai dấu liền nhau, ký tự lạ", () => {
    expect(evalAmount("50-80")).toBeNull();
    expect(evalAmount("50-50")).toBeNull();
    expect(evalAmount("0×5")).toBeNull();
    expect(evalAmount(`${MAX_AMOUNT}+1`)).toBeNull();
    expect(evalAmount(`${MAX_AMOUNT}`)).toBe(MAX_AMOUNT);
    expect(evalAmount("2000000×2000000")).toBeNull();
    expect(evalAmount("24+-5")).toBeNull();
    expect(evalAmount("24+5k")).toBeNull();
    expect(evalAmount("+")).toBeNull();
    expect(evalAmount("")).toBeNull();
  });

  it("số thường không thành phép tính: gõ, dán số có dấu chấm hay dấu trừ đứng đầu vẫn như cũ", () => {
    expect(isAmountExpr("1.250.000")).toBe(false);
    expect(isAmountExpr("-50.000")).toBe(false);
    expect(isAmountExpr("50k")).toBe(false);
    expect(isAmountExpr("+")).toBe(false);
    expect(isAmountExpr("24+")).toBe(true);
    expect(isAmountExpr("24.000 − 5")).toBe(true);
    expect(isAmountExpr("3×2")).toBe(true);
    expect(nextAmount(0, "-50.000")).toBe(50_000);
  });

  it("mỗi số trong phép tính nhóm chấm khi gõ, kết quả không đổi", () => {
    expect(groupExpr("24000+55000").text).toBe("24.000+55.000");
    expect(groupExpr("50.000+35000+1250").text).toBe("50.000+35.000+1.250");
    expect(groupExpr(`1250000 ${MINUS} 250000×2`).text).toBe(`1.250.000 ${MINUS} 250.000×2`);
    // dấu chấm gõ sai chỗ (xoá lùi một chữ số) thì nhóm lại cho đúng
    expect(groupExpr("24.00+5").text).toBe("2.400+5");
    expect(groupExpr("24+").text).toBe("24+");
    for (const s of ["24000+55000", "50.000+35000+1250", "1250000-250000", "3×20000+5", "24.00+5"]) {
      expect(evalAmount(groupExpr(s).text)).toBe(evalAmount(s));
    }
  });

  it("con trỏ giữ đúng chỗ khi dấu chấm thêm vào hay bớt đi", () => {
    // gõ ở cuối: con trỏ vẫn ở cuối
    expect(groupExpr("24.000+55000")).toEqual({ text: "24.000+55.000", caret: 13 });
    // gõ ở giữa số đầu: con trỏ đứng sau chữ số vừa gõ ("240|00+5" → "24.0|00+5")
    expect(groupExpr("24000+5", 3)).toEqual({ text: "24.000+5", caret: 4 });
    // xoá một chữ số ở số đầu: dấu chấm dời chỗ, con trỏ vẫn sau "2" ("2|.000+5" → "2|000+5" → "2|.000+5")
    expect(groupExpr("2000+5", 1)).toEqual({ text: "2.000+5", caret: 1 });
    expect(groupExpr("24.000+5", 0).caret).toBe(0);
  });
});
