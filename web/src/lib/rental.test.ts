import { describe, expect, it } from "vitest";
import { previousAmounts } from "../../../src/domain/rental";
import {
  balanceText,
  billChip,
  billCompare,
  billPayload,
  billShare,
  createHint,
  markSent,
  needsCheck,
  needsResend,
  owedText,
  previousSource,
  receiveAccounts,
  rentalConfigPayload,
  resendConfirm,
  rowsOf,
  SENT_KEY,
  TENANT_PRIVATE_ACCOUNT,
  tenantAccountBlock,
  tenantChipBlock,
  tenantPayload,
  sentRevisions,
} from "./rental";
import type { AccountRef } from "./types";

const NBSP = "\u00a0";

const sep9 = [
  { name: "Tiền nhà", category: "fixed" as const, amount: 2_500_000 },
  { name: "Gửi xe", category: "fixed" as const, amount: 100_000 },
  { name: "Tiền ăn", category: "variable" as const, amount: 1_200_000 },
  { name: "Tiền điện", category: "variable" as const, amount: 380_000 },
];

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("số dư người thuê", () => {
  it("UC-713 AC-1: dương là còn nợ, âm là trả dư mang sang tháng sau", () => {
    expect(balanceText(7_075_000)).toBe(`còn nợ 7.075.000${NBSP}₫`);
    expect(balanceText(-80_000)).toBe(`trả dư 80.000${NBSP}₫, trừ tháng sau`);
    expect(balanceText(0)).toBe("đã hết nợ");
  });

  it("UC-713 AC-15: dưới tin gửi: Còn nợ tất cả / Đã trả đủ / Trả dư", () => {
    expect(owedText(50_000)).toBe(`Còn nợ tất cả: 50.000${NBSP}₫`);
    expect(owedText(0)).toBe("Đã trả đủ");
    expect(owedText(-80_000)).toBe(`Trả dư 80.000${NBSP}₫`);
  });
});

describe("sửa bản tính trên máy", () => {
  it("UC-713 AC-14: tên trùng (không phân biệt hoa thường, khoảng trắng) bị chặn ở máy, lỗi gắn đúng hàng", () => {
    const rows = rowsOf([...sep9, { name: "tiền điện ", category: "variable", amount: 420_000 }]);
    const r = billPayload(3, rows, "mb-household");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[`item-${rows[4]!.key}`]).toBe('Hai khoản cùng tên "tiền điện".');
  });

  it("UC-713 AC-14: số 0 hay tên trống bị chặn ở máy", () => {
    const zero = rowsOf([...sep9, { name: "Tiền nước", category: "variable", amount: 0 }]);
    expect(billPayload(3, zero, null)).toEqual({ ok: false, errors: { [`item-${zero[4]!.key}`]: 'Số tiền của "Tiền nước" phải là số nguyên VND khác 0.' } });
    const blank = rowsOf([{ name: "  ", category: "fixed", amount: 5 }]);
    expect(billPayload(0, blank, null).ok).toBe(false);
  });

  it("UC-713 AC-14: khoản âm được; thân gửi Chi phí cứng trước, cắt khoảng trắng tên, tài khoản trống gửi null", () => {
    const rows = rowsOf([{ name: " Trừ: An đi chợ ", category: "variable", amount: -150_000 }, ...sep9]);
    const r = billPayload(3, rows, "");
    expect(r.ok && r.value).toEqual({
      revision: 3,
      items: [sep9[0], sep9[1], { name: "Trừ: An đi chợ", category: "variable", amount: -150_000 }, sep9[2], sep9[3]],
      receive_account_id: null,
    });
  });

  it("UC-713 AC-14: 'kiểm lại số' chỉ ở khoản Chi phí của nháp còn y số tháng trước; sửa số thì mất", () => {
    const rows = rowsOf(sep9);
    const prev = previousAmounts(rows, sep9);
    expect(rows.map((r, i) => needsCheck("draft", r.category, r.amount, prev[i]!))).toEqual([false, false, true, true]);
    expect(needsCheck("draft", "variable", 420_000, 380_000)).toBe(false);
    expect(needsCheck("issued", "variable", 380_000, 380_000)).toBe(false);
    expect(needsCheck("draft", "variable", 90_000, null)).toBe(false);
  });

  it("UC-713 AC-14: số tháng trước lấy từ bản trước; server không gửi bản trước thì lấy theo từng khoản", () => {
    expect(previousSource({ previous: { month: "2026-09", total: 4_180_000, items: sep9 }, bill: null })).toBe(sep9);
    const bill = { id: 1, status: "draft" as const, revision: 0, issuedAt: null, editedAt: null, receiveAccountId: null, copiedFromMonth: "2026-09", items: [{ ...sep9[3]!, amount: 420_000, previous: 380_000 }, { name: "Tiền nước", category: "variable" as const, amount: 90_000, previous: null }] };
    expect(previousSource({ previous: null, bill })).toEqual([sep9[3]]);
  });

  it("UC-713 AC-14: chân dính so với tháng trước", () => {
    expect(billCompare("2026-10", 4_220_000, { month: "2026-09", total: 4_180_000 })).toBe(`Tổng tháng 10 4.220.000${NBSP}₫ · tháng 9 4.180.000${NBSP}₫ (+40.000)`);
    expect(billCompare("2026-01", 100, { month: "2025-12", total: 100 })).toBe(`Tổng tháng 1 100${NBSP}₫ · tháng 12/2025 100${NBSP}₫ (không đổi)`);
    expect(billCompare("2026-10", 0, null)).toBe(`Tổng tháng 10 0${NBSP}₫`);
  });

  it("UC-713 AC-14: câu dưới nút Lập nói chép từ tháng nào", () => {
    expect(createHint("2026-10", { month: "2026-09", total: 4_180_000, items: sep9 })).toBe("Chép 4 khoản từ tháng 9");
    expect(createHint("2026-10", null)).toBe("Chưa có tháng trước — bắt đầu trống");
  });

  it("UC-713 AC-14: tài khoản nhận chỉ là ngân hàng không riêng tư", () => {
    const acc = (id: string, kind: AccountRef["kind"], priv = false) => ({ id, name: id, kind, private: priv }) as AccountRef;
    const list = [acc("mb-household", "bank"), acc("cash-wife", "cash"), acc("vcb-wife", "bank", true), acc("momo", "ewallet")];
    expect(receiveAccounts(list).map((a) => a.id)).toEqual(["mb-household"]);
  });
});

describe("gửi và gửi lại", () => {
  it("UC-713 AC-16: hỏi tổng cũ → mới trước khi lưu bản đã gửi", () => {
    expect(resendConfirm(4_220_000, 4_270_000, "An")).toBe(`Tổng đổi từ 4.220.000${NBSP}₫ sang 4.270.000${NBSP}₫, gửi lại tin cho An.`);
  });

  it("UC-713 AC-16: chip 'Đã sửa, gửi lại' tới khi máy này gửi / chép bản mới nhất", () => {
    const storage = memStorage();
    const bill = { id: 7, month: "2026-10", status: "issued" as const, total: 4_270_000, revision: 5, edited: true };
    expect(billChip(bill, sentRevisions(storage)).text).toBe("Đã sửa, gửi lại");
    markSent(storage, 7, 4);
    expect(needsResend(bill, sentRevisions(storage))).toBe(true);
    markSent(storage, 7, 5);
    expect(billChip(bill, sentRevisions(storage)).text).toBe("Đã gửi");
    expect(billChip({ ...bill, edited: false, revision: 4 }, {}).text).toBe("Đã gửi");
    expect(billChip({ ...bill, status: "draft" }, {}).text).toBe("Nháp");
    expect(billChip(null, {}).text).toBe("Chưa lập");
  });

  it("UC-713 AC-16: localStorage hỏng / bị chặn → coi như chưa gửi, không ném lỗi", () => {
    expect(sentRevisions(memStorage({ [SENT_KEY]: "{oops" }))).toEqual({});
    expect(sentRevisions(null)).toEqual({});
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => markSent(throwing, 1, 1)).not.toThrow();
  });

  it("UC-713 AC-15: Gửi cho An: chia sẻ tin + ảnh QR khi máy chia sẻ được ảnh; không thì chép tin", () => {
    const file = { name: "qr.png" } as File;
    const share = async () => {};
    expect(billShare({ share, canShare: () => true }, "tin", file)).toEqual({ text: "tin", files: [file] });
    expect(billShare({ share, canShare: () => false }, "tin", file)).toBeNull();
    expect(billShare({ share }, "tin", null)).toEqual({ text: "tin" });
    expect(billShare({}, "tin", null)).toBeNull();
    expect(billShare(null, "tin", file)).toBeNull();
  });
});

describe("tiền thuê không vào tài khoản riêng tư", () => {
  const priv = { private: true };
  const shared = { private: false };

  it("UC-705 AC-36: Thu nhập có người thuê vào tài khoản riêng tư bị chặn; tài khoản chung hay không chọn người thuê thì không", () => {
    expect(tenantAccountBlock("an", priv)).toBe("Tiền thuê không ghi vào tài khoản riêng tư.");
    expect(tenantAccountBlock("an", { private: false, hiddenFromMe: true })).toBe(TENANT_PRIVATE_ACCOUNT);
    expect(tenantAccountBlock("an", shared)).toBeNull();
    expect(tenantAccountBlock("", priv)).toBeNull();
  });

  it("UC-706 AC-38: chip 'Thu từ người thuê' tắt trên log của tài khoản riêng tư", () => {
    expect(tenantChipBlock(priv)).toBe(TENANT_PRIVATE_ACCOUNT);
    expect(tenantChipBlock(shared)).toBeNull();
    expect(tenantChipBlock(undefined)).toBeNull();
  });
});

describe("Cài đặt › Cho thuê", () => {
  it("UC-709 AC-13: người thuê mới: số dư mở sổ có dấu, 0 thì không gửi", () => {
    expect(tenantPayload({ name: " Anh Bình ", opening: 7_075_000, openingSign: 1, active: true }, true)).toEqual({ ok: true, value: { name: "Anh Bình", opening_balance: 7_075_000 } });
    expect(tenantPayload({ name: "Anh Bình", opening: 500_000, openingSign: -1, active: true }, true)).toMatchObject({ value: { opening_balance: -500_000 } });
    expect(tenantPayload({ name: "Anh Bình", opening: 0, openingSign: 1, active: true }, true)).toEqual({ ok: true, value: { name: "Anh Bình" } });
    expect(tenantPayload({ name: "Anh Bình", opening: 0, openingSign: 1, active: false }, false)).toEqual({ ok: true, value: { name: "Anh Bình", active: false } });
    expect(tenantPayload({ name: " ", opening: 0, openingSign: 1, active: true }, true).ok).toBe(false);
  });

  it("UC-709 AC-13: cấu hình chỉ còn nguồn thu, chặn ở máy khi chưa chọn (không bao giờ gửi null)", () => {
    expect(rentalConfigPayload({ income_stream_id: "rental" })).toEqual({ ok: true, value: { income_stream_id: "rental" } });
    expect(rentalConfigPayload({ income_stream_id: "" })).toEqual({ ok: false, errors: { income_stream_id: "Chọn nguồn thu cho tiền người thuê trả." } });
  });
});
