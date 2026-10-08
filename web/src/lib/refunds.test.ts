import { describe, expect, it } from "vitest";
import { LINK_PENDING_HINT, lendDiffText, linkCandidateLabel, linkOriginText, linkPickHint, rankLinkCandidates, refundDiffText, returnedText } from "./refunds";
import type { LinkCandidate } from "./types";

const NBSP = "\u00a0";

const spend = (id: number, amount: number, at: string, extra: Partial<LinkCandidate> = {}): LinkCandidate => ({
  id,
  at,
  amount,
  category_id: "health",
  category_name: "Thuốc thang",
  wallet_id: "nice-to-have",
  wallet_name: "Có thì tốt",
  receivable_id: null,
  receivable_name: null,
  note: null,
  bank_content: null,
  ...extra,
});

describe("trả lại cho khoản chi", () => {
  it("5 khoản gần số tiền nhất lên trước (bằng nhau thì mới nhất trước), rồi mọi khoản còn lại mới nhất trước — không cắt bớt", () => {
    const rows = [
      spend(1, 100_000, "2026-10-03T02:00:00.000Z"),
      spend(2, 244_000, "2026-10-01T02:00:00.000Z"),
      spend(3, 256_000, "2026-09-20T02:00:00.000Z"),
      spend(4, 256_000, "2026-10-02T02:00:00.000Z"),
      spend(5, 1_000_000, "2026-10-04T02:00:00.000Z"),
    ];
    expect(rankLinkCandidates(rows, 250_000).map((r) => r.id)).toEqual([4, 2, 3, 1, 5]);
    expect(rankLinkCandidates(rows, 250_000, null, 2).map((r) => r.id)).toEqual([4, 2, 5, 1, 3]);
  });

  it("chia bill: bill 800.000 vẫn có trong danh sách khi người ta trả 200.000 dù có nhiều khoản chi quanh 200.000", () => {
    const many = Array.from({ length: 30 }, (_, i) => spend(i + 1, 195_000 + i * 500, `2026-10-0${1 + (i % 5)}T02:00:00.000Z`));
    const bill = spend(99, 800_000, "2026-09-25T02:00:00.000Z");
    const ranked = rankLinkCandidates([...many, bill], 200_000);
    expect(ranked).toHaveLength(31);
    expect(ranked.map((r) => r.id)).toContain(99);
  });

  it("nhãn mục: ngày · danh mục · ghi chú (không có thì nội dung ngân hàng, cắt ở 40 ký tự) · số tiền", () => {
    expect(linkCandidateLabel("spend", spend(1, 244_000, "2026-10-03T02:00:00.000Z", { note: "thuốc cho mẹ", bank_content: "NHA THUOC" }))).toBe(
      `3/10 · Thuốc thang · thuốc cho mẹ · 244.000${NBSP}₫`,
    );
    expect(linkCandidateLabel("spend", spend(1, 244_000, "2026-10-03T02:00:00.000Z", { bank_content: "MBVCB.1234567.NHA THUOC LONG CHAU 1234 QUAN 3 TP HCM" }))).toBe(
      `3/10 · Thuốc thang · MBVCB.1234567.NHA THUOC LONG CHAU 1234… · 244.000${NBSP}₫`,
    );
    expect(linkCandidateLabel("spend", spend(1, 50_000, "2026-10-03T02:00:00.000Z", { category_name: null }))).toBe(`3/10 · khoản chi · 50.000${NBSP}₫`);
  });

  it("dòng chênh: trả hơn +, trả kém −, phần chênh nằm lại trong danh mục; trả đúng thì trả đủ", () => {
    expect(refundDiffText({ amount: 244_000, category_name: "Thuốc thang" }, 250_000)).toBe(
      `Khoản chi 244.000${NBSP}₫ · trả lại 250.000${NBSP}₫ · chênh +6.000${NBSP}₫ (nằm lại trong danh mục Thuốc thang)`,
    );
    expect(refundDiffText({ amount: 244_000, category_name: "Thuốc thang" }, 200_000)).toBe(
      `Khoản chi 244.000${NBSP}₫ · trả lại 200.000${NBSP}₫ · chênh −44.000${NBSP}₫ (nằm lại trong danh mục Thuốc thang)`,
    );
    expect(refundDiffText({ amount: 244_000, category_name: null }, 244_000)).toBe(`Khoản chi 244.000${NBSP}₫ · trả lại 244.000${NBSP}₫ · trả đủ`);
  });
});

describe("trả cho khoản cho vay, xem hai chiều (change 261005-lien-ket-khoan-goc)", () => {
  const lend = (id: number, amount: number, at: string, receivable_id: string | null, receivable_name: string | null = null): LinkCandidate =>
    spend(id, amount, at, { category_id: "lending", category_name: "Cho vay", wallet_id: null, wallet_name: null, receivable_id, receivable_name });

  it("xếp khoản cho vay: của người đang chọn ở Ai trả lên trước, rồi gần số tiền nhất, rồi mới nhất; nhãn có tên người", () => {
    const rows = [
      lend(1, 600_000, "2026-10-03T02:00:00.000Z", "em-hai"),
      lend(2, 1_000_000, "2026-08-01T02:00:00.000Z", "chi-lan"),
      lend(3, 2_000_000, "2026-09-01T02:00:00.000Z", "chi-lan"),
      lend(4, 1_000_000, "2026-09-15T02:00:00.000Z", "chi-lan"),
      lend(5, 500_000, "2026-10-04T02:00:00.000Z", null),
    ];
    expect(rankLinkCandidates(rows, 600_000, "chi-lan").map((r) => r.id)).toEqual([4, 2, 3, 1, 5]);
    expect(rankLinkCandidates(rows, 600_000).map((r) => r.id)).toEqual([1, 5, 4, 2, 3]);
    expect(linkCandidateLabel("lend", { ...lend(4, 1_000_000, "2026-09-15T02:00:00.000Z", "chi-lan", "Chị Lan"), note: "mượn sửa xe" })).toBe(
      `15/9 · Chị Lan · mượn sửa xe · 1.000.000${NBSP}₫`,
    );
    expect(linkCandidateLabel("lend", lend(5, 500_000, "2026-10-04T02:00:00.000Z", null))).toBe(`4/10 · khoản cho vay · 500.000${NBSP}₫`);
  });

  it("dòng dưới ô Trả cho khoản cho vay: cho vay X · trả lại Y · còn Z, trả dư Z, hoặc trả đủ", () => {
    expect(lendDiffText({ amount: 1_000_000 }, 600_000)).toBe(`Cho vay 1.000.000${NBSP}₫ · trả lại 600.000${NBSP}₫ · còn 400.000${NBSP}₫`);
    expect(lendDiffText({ amount: 1_000_000 }, 1_200_000)).toBe(`Cho vay 1.000.000${NBSP}₫ · trả lại 1.200.000${NBSP}₫ · trả dư 200.000${NBSP}₫`);
    expect(lendDiffText({ amount: 1_000_000 }, 1_000_000)).toBe(`Cho vay 1.000.000${NBSP}₫ · trả lại 1.000.000${NBSP}₫ · trả đủ`);
  });

  it("chi tiết giao dịch: dòng Trả cho nói loại gốc, ngày, số tiền; Đã nhận lại nói tổng và chênh (trả dư / còn thiếu / đủ)", () => {
    expect(linkOriginText({ meaning: "spend", at: "2026-10-04T02:00:00.000Z", amount: 244_000, status: "active" })).toBe(`khoản chi 4/10 · 244.000${NBSP}₫`);
    expect(linkOriginText({ meaning: "lend", at: "2026-09-15T02:00:00.000Z", amount: 1_000_000, status: "active" })).toBe(`khoản cho vay 15/9 · 1.000.000${NBSP}₫`);
    expect(returnedText(244_000, [{ amount: 250_000 }])).toBe(`250.000${NBSP}₫ · trả dư 6.000${NBSP}₫`);
    expect(returnedText(1_000_000, [{ amount: 600_000 }])).toBe(`600.000${NBSP}₫ · còn thiếu 400.000${NBSP}₫`);
    expect(returnedText(1_000_000, [{ amount: 600_000 }, { amount: 400_000 }])).toBe(`1.000.000${NBSP}₫ · đủ`);
  });

  it("khoản gốc đã xoá: liên kết giữ, dòng Trả cho nói khoản gốc đã xoá", () => {
    expect(linkOriginText({ meaning: "lend", at: "2026-09-15T02:00:00.000Z", amount: 1_000_000, status: "void" })).toBe(
      `khoản cho vay 15/9 · 1.000.000${NBSP}₫ · khoản gốc đã xoá`,
    );
  });
});

describe("dòng nhắc khi chưa chọn khoản gốc", () => {
  it("người đang chọn có khoản cho vay thì nói có mấy khoản để chọn, không nhắc 'khoản gốc còn chờ gán'", () => {
    const loans = [{ receivable_id: "c-mai", receivable_name: "C Mai" }];
    expect(linkPickHint("lend", loans, "c-mai")).toBe("C Mai có 1 khoản cho vay ở ô trên — chọn khoản đang trả.");
    expect(linkPickHint("lend", loans, null)).toBe("Có 1 khoản ở ô trên — chọn khoản gốc nếu biết, không thì để trống.");
    expect(linkPickHint("spend", [], null)).toBe(LINK_PENDING_HINT);
  });
});
