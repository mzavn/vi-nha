import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canPair, extractCode, looksLikeCashWithdrawal, matchRule, normalizeContent, type RuleRow } from "../src/domain/rules";
import { client, householdP, P_NOW } from "./helpers/household-p";

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

const rule = (over: Partial<RuleRow>): RuleRow => ({
  id: 1,
  priority: 100,
  matchType: "code",
  pattern: "EAN",
  meaning: "spend",
  isSalary: false,
  categoryId: "groceries",
  byMemberId: null,
  ...over,
});

describe("matchRule", () => {
  it("UC-303 AC-1: khớp mã chính xác trước, rồi mới tới từ khoá nội dung", () => {
    const rules = [rule({ id: 1, matchType: "code", pattern: "EAN", priority: 20 }), rule({ id: 2, matchType: "content", pattern: "XANG", priority: 10, categoryId: "fuel-parking" })];
    // Nội dung vừa có mã EAN vừa nhắc XANG: mã luôn thắng dù priority số nhỏ hơn thuộc về content.
    expect(matchRule(rules, "out", "an trua XANG xe", "EAN")?.id).toBe(1);
  });

  it("dò từ khoá trên nội dung đã bỏ dấu khi không có mã", () => {
    const rules = [rule({ id: 2, matchType: "content", pattern: "XANG", categoryId: "fuel-parking" })];
    expect(matchRule(rules, "out", "đổ xăng buổi sáng", null)?.id).toBe(2);
  });

  it("rule income chỉ khớp khi hướng là 'in' và is_salary=1", () => {
    const salary = rule({ id: 3, matchType: "content", pattern: "LUONG THANG", meaning: "income", isSalary: true, categoryId: null });
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

describe("Mẫu tự gán có tài khoản riêng tư (ingest UC-307, ADR-133)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(P_NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("UC-307 AC-24: chồng tạo mẫu cho VCB (vợ), mẫu chuyển sang VCB (vợ), sửa mẫu của vợ → 403 private_account, không mẫu mới, mẫu của vợ giữ nguyên; vợ tạo → 201", async () => {
    const db = householdP();
    const husband = client(db, "husband");
    const rulesCount = () => (db.prepare("SELECT COUNT(*) AS n FROM rules").get() as { n: number }).n;
    const before = rulesCount();
    const spendRule = { account_id: "vcb-wife", meaning: "spend", match_type: "content", pattern: "GRAB", category_id: "fuel-parking" };

    const own = await husband("POST", "/v1/rules", spendRule);
    expect([own.status, own.json.error?.code]).toEqual([403, "private_account"]);
    const transfer = await husband("POST", "/v1/rules", { account_id: "vcb-husband", meaning: "transfer", counter_account_id: "vcb-wife", match_type: "content", pattern: "CK VO" });
    expect([transfer.status, transfer.json.error?.code]).toEqual([403, "private_account"]);
    expect(rulesCount()).toBe(before);

    const wife = await client(db, "wife")("POST", "/v1/rules", spendRule);
    expect(wife.status).toBe(201);
    expect(wife.json.data).toMatchObject({ account_id: "vcb-wife", pattern: "GRAB", by_member_id: "wife" });

    const patch = await husband("PATCH", `/v1/settings/rules/${wife.json.data.id}`, { pattern: "BE" });
    expect([patch.status, patch.json.error?.code]).toEqual([403, "private_account"]);
    expect(db.prepare("SELECT pattern FROM rules WHERE id = ?").get(wife.json.data.id)).toEqual({ pattern: "GRAB" });
    expect(rulesCount()).toBe(before + 1);
  });
});
