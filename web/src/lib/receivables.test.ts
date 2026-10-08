import { describe, expect, it } from "vitest";
import { bookRefLabel, groupBook, mergeHistory } from "./memo-books";
import { collectToast, defaultReceivableId, lendToast, moneyMoveBody, overpaidHint, receivableEffect, receivableLinePayload, receivableOptions, receivablePayload } from "./receivables";
import type { Receivable } from "./types";

const NBSP = "\u00a0";

const receivable = (id: string, balance: number, extra: Partial<Receivable> = {}): Receivable => ({
  id,
  name: id,
  note: null,
  active: true,
  lent: Math.max(balance, 0) + 1_000_000,
  collected: 1_000_000,
  balance,
  done: balance <= 0,
  createdAt: "2026-09-01T00:00:00Z",
  lines: [],
  movements: [],
  ...extra,
});

describe("sổ phải thu", () => {
  it("sắp khoản phải thu: còn nhiều lên trước, đã trả đủ tách riêng theo tên, khoản tắt không hiện", () => {
    const g = groupBook([receivable("Bình", 2_000_000), receivable("An", 0), receivable("Cường", 5_000_000), receivable("Dũng", 2_000_000), receivable("Em", -10_000), receivable("Tắt", 9_000_000, { active: false })]);
    expect(g.open.map((r) => r.id)).toEqual(["Cường", "Bình", "Dũng"]);
    expect(g.done.map((r) => r.id)).toEqual(["An", "Em"]);
  });

  it("lịch sử trộn dòng sổ và lần tiền đi / về, mới nhất trước", () => {
    const h = mergeHistory(
      [
        { id: 1, at: "2026-09-01T00:00:00Z" },
        { id: 2, at: "2026-09-20T00:00:00Z" },
      ],
      [{ transactionId: 7, at: "2026-09-10T00:00:00Z" }],
    );
    expect(h.map((x) => (x.line ? `l${x.line.id}` : `m${x.movement.transactionId}`))).toEqual(["l2", "m7", "l1"]);
  });

  it("chọn sẵn khoản được mở từ, không thì khoản còn phải thu nhiều nhất; ai cũng đã trả đủ thì không chọn ai; bootstrap cũ không có trường thì null", () => {
    const refs = [
      { id: "family-hoa", name: "nhà Hoa", balance: 0 },
      { id: "em-tu", name: "Em Tú", balance: 300_000 },
      { id: "em-trai", name: "Em trai", balance: 5_000_000 },
      { id: "chi-lan", name: "Chị Lan", balance: -250_000 },
    ];
    expect(defaultReceivableId(refs)).toBe("em-trai");
    // Cho vay lại người đã trả đủ vẫn được khi mở từ chính người đó.
    expect(defaultReceivableId(refs, "family-hoa")).toBe("family-hoa");
    // Lỗi cũ: ai cũng đã trả đủ mà vẫn chọn sẵn người đầu ("nhà Hoa · đã trả đủ") — gán nhầm người.
    expect(defaultReceivableId([refs[0]!, refs[3]!])).toBeNull();
    expect(defaultReceivableId(undefined)).toBeNull();
  });

  it("nhãn ô chọn khoản: còn bao nhiêu; trả dư bao nhiêu; 0 thì chỉ tên (người mới chưa nợ gì không thành 'đã trả đủ')", () => {
    expect(bookRefLabel({ id: "em-tu", name: "Em Tú", balance: 4_000_000 })).toBe(`Em Tú · còn 4.000.000${NBSP}₫`);
    expect(bookRefLabel({ id: "c-mai", name: "C Mai", balance: 0 })).toBe("C Mai");
    expect(bookRefLabel({ id: "em-tu", name: "Em Tú", balance: -1_500_000 })).toBe(`Em Tú · trả dư 1.500.000${NBSP}₫`);
  });

  it("ô Ai trả chỉ có người còn nợ (giữ người đang chọn); ô Cho ai vay có mọi người", () => {
    const refs = [
      { id: "family-hoa", name: "nhà Hoa", balance: 0 },
      { id: "c-mai", name: "C Mai", balance: 0 },
      { id: "em-hai", name: "Em Hai", balance: 300_000 },
    ];
    expect(receivableOptions(refs, "collect", null).map((r) => r.id)).toEqual(["em-hai"]);
    expect(receivableOptions(refs, "collect", "c-mai").map((r) => r.id)).toEqual(["c-mai", "em-hai"]);
    expect(receivableOptions(refs, "lend", null).map((r) => r.id)).toEqual(["family-hoa", "c-mai", "em-hai"]);
  });

  it("toast sau khi nhận lại: còn bao nhiêu chưa trả, hoặc đã trả đủ (trả dư cũng là đủ)", () => {
    expect(collectToast(2_000_000, { name: "Em trai", balance: 5_000_000 })).toBe(`Đã nhận lại 2.000.000${NBSP}₫ từ Em trai. Còn 3.000.000${NBSP}₫ chưa trả.`);
    expect(collectToast(5_000_000, { name: "Em trai", balance: 5_000_000 })).toBe(`Đã nhận lại 5.000.000${NBSP}₫ từ Em trai. Đã trả đủ.`);
    expect(collectToast(6_000_000, { name: "Em trai", balance: 5_000_000 })).toBe(`Đã nhận lại 6.000.000${NBSP}₫ từ Em trai. Đã trả đủ.`);
    expect(lendToast(1_000_000, { name: "Em trai", balance: 0 })).toBe(`Đã ghi cho Em trai vay thêm 1.000.000${NBSP}₫. Còn 1.000.000${NBSP}₫ chưa trả.`);
  });

  it("dòng dưới ô Ai trả / Cho ai vay: còn nợ trước và sau khoản này; nhận lại vượt số còn nợ thì báo phần dư của lần trả này", () => {
    expect(receivableEffect({ name: "Em Hai", balance: 3_000_000 }, "collect", 1_000_000)).toEqual({
      text: `Em Hai còn nợ 3.000.000${NBSP}₫ · sau khoản này còn 2.000.000${NBSP}₫`,
      overpaid: 0,
    });
    expect(receivableEffect({ name: "Em Hai", balance: 1_000_000 }, "collect", 1_000_000)).toEqual({
      text: `Em Hai còn nợ 1.000.000${NBSP}₫ · sau khoản này trả đủ`,
      overpaid: 0,
    });
    expect(receivableEffect({ name: "Chị Lan", balance: 244_000 }, "collect", 250_000)).toEqual({
      text: `Chị Lan còn nợ 244.000${NBSP}₫ · sau khoản này trả dư 6.000${NBSP}₫`,
      overpaid: 6_000,
    });
    expect(receivableEffect({ name: "Chị Lan", balance: 0 }, "collect", 250_000).overpaid).toBe(250_000);
    // Đã trả dư từ trước: lần này dư cả khoản, không cộng phần dư cũ.
    expect(receivableEffect({ name: "Chị Lan", balance: -100_000 }, "collect", 50_000).overpaid).toBe(50_000);
    expect(receivableEffect({ name: "Chị Lan", balance: -250_000 }, "lend", 100_000)).toEqual({
      text: `Chị Lan đang trả dư 250.000${NBSP}₫ · sau khoản này trả dư 150.000${NBSP}₫`,
      overpaid: 0,
    });
    expect(receivableEffect({ name: "Em Hai", balance: 0 }, "lend", 500_000).text).toBe(`Em Hai còn nợ 0${NBSP}₫ · sau khoản này còn 500.000${NBSP}₫`);
  });

  it("trả dư: nhận lại đúng số còn nợ, phần dư là Thu nhập (màn Gán tách dòng, Loại khác ghi riêng); Hoàn tiền chỉ cho chia bill có phần mình (ADR-84)", () => {
    expect(overpaidHint(6_000, true)).toBe(
      `Trả dư 6.000${NBSP}₫? Bấm Tách thêm dòng: Nhận lại đúng số còn nợ, phần dư ghi Thu nhập. Chia bill nhà mình có phần (đã ghi Chi tiêu cả bill) thì chọn Hoàn tiền.`,
    );
    expect(overpaidHint(6_000, false)).toBe(
      `Trả dư 6.000${NBSP}₫? Ghi Nhận lại đúng số còn nợ, phần dư ghi riêng một khoản Thu nhập. Chia bill nhà mình có phần (đã ghi Chi tiêu cả bill) thì chọn Hoàn tiền.`,
    );
  });

  it("kiểm tra khoản phải thu mới và dòng chỉnh: thiếu tên, số tiền âm hay lẻ; số 0 được (thêm người chưa nợ gì); chỉnh mang dấu", () => {
    expect(receivablePayload({ name: " Em trai ", amount: 5_000_000, note: " mượn mua xe " })).toEqual({ ok: true, value: { name: "Em trai", amount: 5_000_000, note: "mượn mua xe" } });
    expect(receivablePayload({ name: " ", amount: 1, note: "" }).ok).toBe(false);
    expect(receivablePayload({ name: " c Mai ", amount: 0, note: "" })).toEqual({ ok: true, value: { name: "c Mai", amount: 0 } });
    expect(receivablePayload({ name: "Em trai", amount: -1, note: "" }).ok).toBe(false);
    expect(receivablePayload({ name: "Em trai", amount: 1.5, note: "" }).ok).toBe(false);

    expect(receivableLinePayload({ amount: 200_000, sign: -1, note: "bớt cho" })).toEqual({ ok: true, value: { kind: "adjust", amount: -200_000, note: "bớt cho" } });
    expect(receivableLinePayload({ amount: 200_000, sign: 1, note: "" })).toEqual({ ok: true, value: { kind: "adjust", amount: 200_000 } });
    expect(receivableLinePayload({ amount: 0, sign: 1, note: "" }).ok).toBe(false);
  });

  it("thân giao dịch cho vay / nhận lại: cần số tiền và tài khoản, gắn khoản phải thu nếu có, không mang ví", () => {
    const at = "2026-10-02T03:00:00.000Z";
    expect(moneyMoveBody({ meaning: "collect", amount: 2_000_000, accountId: "cash-husband", receivableId: "em-trai", note: " trả đợt 1 " }, at, "c1")).toEqual({
      ok: true,
      value: { meaning: "collect", amount: 2_000_000, at, client_id: "c1", account_id: "cash-husband", receivable_id: "em-trai", note: "trả đợt 1" },
    });
    expect(moneyMoveBody({ meaning: "lend", amount: 1_000_000, accountId: "vcb", receivableId: null, note: "" }, at, "c2")).toEqual({
      ok: true,
      value: { meaning: "lend", amount: 1_000_000, at, client_id: "c2", account_id: "vcb" },
    });
    expect(moneyMoveBody({ meaning: "lend", amount: 0, accountId: "vcb", receivableId: null, note: "" }, at, "c3").ok).toBe(false);
    expect(moneyMoveBody({ meaning: "collect", amount: 1, accountId: null, receivableId: "em-trai", note: "" }, at, "c4").ok).toBe(false);
  });

  it("nhận lại ở tab Nợ chọn khoản cho vay gốc: gửi link_id; cho vay thì không bao giờ gửi (change 261005-lien-ket-khoan-goc)", () => {
    const at = "2026-10-05T03:00:00.000Z";
    expect(moneyMoveBody({ meaning: "collect", amount: 600_000, accountId: "vcb", receivableId: "chi-lan", linkId: 7, note: "" }, at, "c5")).toEqual({
      ok: true,
      value: { meaning: "collect", amount: 600_000, at, client_id: "c5", account_id: "vcb", receivable_id: "chi-lan", link_id: 7 },
    });
    expect(moneyMoveBody({ meaning: "lend", amount: 600_000, accountId: "vcb", receivableId: "chi-lan", linkId: 7, note: "" }, at, "c6")).toEqual({
      ok: true,
      value: { meaning: "lend", amount: 600_000, at, client_id: "c6", account_id: "vcb", receivable_id: "chi-lan" },
    });
  });
});
