import { describe, expect, it } from "vitest";
import { canPair, extractCode, extractTransferMemo, looksLikeCashWithdrawal, matchRule, normalizeContent, type RuleRow } from "../src/domain/rules";

describe("normalizeContent", () => {
  it("bỏ dấu tiếng Việt và viết hoa, như MzaSepaySheetLib đang làm", () => {
    expect(normalizeContent("Chuyen tien do xang xe")).toBe("CHUYEN TIEN DO XANG XE");
    expect(normalizeContent("đổ xăng buổi sáng")).toBe("DO XANG BUOI SANG");
    expect(normalizeContent(null)).toBe("");
    expect(normalizeContent(undefined)).toBe("");
  });
});

describe("looksLikeCashWithdrawal", () => {
  it("nội dung rút tiền mặt (ATM, RUT TIEN, RUT TM, CASH WITHDRAWAL) — có dấu, thường hay hoa đều nhận", () => {
    for (const c of ["RUT TIEN TAI ATM MB", "RUT TIEN ATM 0011xxx", "Rút tiền mặt tại quầy", "rut tm 2.000.000", "ATM WDL 12345 HN", "CASH WITHDRAWAL VCB 0011"]) {
      expect(looksLikeCashWithdrawal(c), c).toBe(true);
    }
  });

  it("trả QR, hoá đơn, chuyển khoản, tên quán chứa ATM giữa chữ → không phải rút tiền", () => {
    for (const c of ["MBVCB.1234567.THANH TOAN QR.CT tu 0011xxx", "THANH TOAN HOA DON DIEN EVN", "CHUYEN TIEN CHO ANH BA", "ATMOSPHERE COFFEE QR", "PF ZZ0001", null]) {
      expect(looksLikeCashWithdrawal(c), String(c)).toBe(false);
    }
  });
});

describe("extractCode", () => {
  it("bắt mã 3 chữ cái [QE]xx không phân biệt hoa thường", () => {
    expect(extractCode("CT tu 123 EAN an trua")).toBe("EAN");
    expect(extractCode("ct ean an trua")).toBe("EAN");
    expect(extractCode("chuyen tien QTT gop von")).toBe("QTT");
    expect(extractCode("khong co ma nao ca")).toBeNull();
  });
});

describe("extractTransferMemo", () => {
  it("bắt mã 'PF' + 6 ký tự, dung sai khoảng trắng và hoa thường, trả đúng dạng đã lưu", () => {
    expect(extractTransferMemo("PF K7Q3F2")).toBe("PF K7Q3F2");
    expect(extractTransferMemo("chuyen tien pfk7q3f2 chia luong")).toBe("PF K7Q3F2");
    expect(extractTransferMemo("khong co memo")).toBeNull();
  });

  it("mã kiểu cũ đoán được (PF A12, PF S202609) không còn là mã lệnh", () => {
    expect(extractTransferMemo("PF A12")).toBeNull();
    expect(extractTransferMemo("PF S202609")).toBeNull();
  });
});

const rule = (over: Partial<RuleRow>): RuleRow => ({
  id: 1,
  priority: 100,
  matchType: "code",
  pattern: "EAN",
  meaning: "spend",
  isSalary: false,
  walletId: "food",
  categoryId: "groceries",
  byMemberId: null,
  ...over,
});

describe("matchRule", () => {
  it("khớp mã chính xác trước, rồi mới tới từ khoá nội dung", () => {
    const rules = [rule({ id: 1, matchType: "code", pattern: "EAN", priority: 20 }), rule({ id: 2, matchType: "content", pattern: "XANG", priority: 10, walletId: "transport", categoryId: "fuel-parking" })];
    // Nội dung vừa có mã EAN vừa nhắc XANG: mã luôn thắng dù priority số nhỏ hơn thuộc về content.
    expect(matchRule(rules, "out", "an trua XANG xe", "EAN")?.id).toBe(1);
  });

  it("dò từ khoá trên nội dung đã bỏ dấu khi không có mã", () => {
    const rules = [rule({ id: 2, matchType: "content", pattern: "XANG", walletId: "transport", categoryId: "fuel-parking" })];
    expect(matchRule(rules, "out", "đổ xăng buổi sáng", null)?.id).toBe(2);
  });

  it("rule income chỉ khớp khi hướng là 'in' và is_salary=1", () => {
    const salary = rule({ id: 3, matchType: "content", pattern: "LUONG THANG", meaning: "income", isSalary: true, walletId: "income", categoryId: null });
    expect(matchRule([salary], "in", "LUONG THANG 9", null)?.id).toBe(3);
    expect(matchRule([salary], "out", "LUONG THANG 9", null)).toBeNull(); // tiền ra không bao giờ khớp rule lương
    const notSalary = rule({ id: 4, matchType: "content", pattern: "LUONG THANG", meaning: "income", isSalary: false });
    expect(matchRule([notSalary], "in", "LUONG THANG 9", null)).toBeNull(); // luật 6: không is_salary thì không được đoán income
  });

  it("rule spend/transfer không bao giờ khớp khi hướng là 'in'", () => {
    const rules = [rule({ matchType: "code", pattern: "EAN" })];
    expect(matchRule(rules, "in", "EAN", "EAN")).toBeNull();
  });

  it("không khớp gì thì trả null", () => {
    expect(matchRule([rule({})], "out", "khong lien quan", null)).toBeNull();
  });
});

describe("canPair", () => {
  const base = { id: "a", accountId: "vcb-husband", direction: "out" as const, amount: 500_000, at: "2026-09-22T00:00:00.000Z" };

  it("ghép khi ngược hướng, cùng số tiền, khác tài khoản, lệch ≤ 10 phút", () => {
    const other = { ...base, id: "b", accountId: "vcb-wife", direction: "in" as const, at: "2026-09-22T00:05:00.000Z" };
    expect(canPair(base, other)).toBe(true);
  });

  it("không ghép nếu cùng tài khoản, cùng hướng, khác số tiền, hoặc lệch quá 10 phút", () => {
    expect(canPair(base, { ...base, id: "b", direction: "in" })).toBe(false); // cùng account
    expect(canPair(base, { ...base, id: "b", accountId: "vcb-wife" })).toBe(false); // cùng hướng
    expect(canPair(base, { ...base, id: "b", accountId: "vcb-wife", direction: "in", amount: 400_000 })).toBe(false); // khác tiền
    expect(canPair(base, { ...base, id: "b", accountId: "vcb-wife", direction: "in", at: "2026-09-22T00:11:00.000Z" })).toBe(false); // quá 10 phút
  });
});
