import { describe, expect, it } from "vitest";
import { balanceText, draftLines, feePayload, linePayload, rentalConfigPayload, settlePayload, settleTotal, tenantPayload, withHeadcount } from "./rental";

const NBSP = "\u00a0";

describe("số dư người thuê", () => {
  it("dương là còn nợ, âm là trả dư mang sang tháng sau", () => {
    expect(balanceText(7_075_000)).toBe(`còn nợ 7.075.000${NBSP}₫`);
    expect(balanceText(-80_000)).toBe(`trả dư 80.000${NBSP}₫, trừ tháng sau`);
    expect(balanceText(0)).toBe("đã hết nợ");
  });
});

describe("chốt tháng", () => {
  // Ví dụ trong proposal: phí cố định + chi chung 8.160.000 ÷ 3.
  const m = {
    draft: [
      { kind: "fixed" as const, name: "Nhà", amount: 2_500_000 },
      { kind: "fixed" as const, name: "Gửi xe", amount: 50_000 },
      { kind: "fixed" as const, name: "Mạng", amount: 75_000 },
      { kind: "fixed" as const, name: "Dịch vụ", amount: 66_667 },
      { kind: "shared" as const, name: "Chi chung", amount: 2_720_000 },
    ],
  };

  it("bản nháp cộng đúng phần phải trả", () => {
    expect(settleTotal(draftLines(m))).toBe(5_411_667);
  });

  it("đổi số người: chi chung tính lại, phần lẻ hộ chịu; phí cố định giữ nguyên", () => {
    const lines = withHeadcount(draftLines(m), 8_160_000, 4);
    expect(lines.find((l) => l.kind === "shared")?.amount).toBe(2_040_000);
    expect(lines.find((l) => l.name === "Nhà")?.amount).toBe(2_500_000);
    expect(withHeadcount(draftLines(m), 10, 3).find((l) => l.kind === "shared")?.amount).toBe(3);
    expect(withHeadcount(draftLines(m), 8_160_000, 0)).toEqual(draftLines(m));
  });

  it("thân yêu cầu: dòng chỉnh được âm, phí không được âm, số người ≥ 1", () => {
    const lines = [...draftLines(m), { key: 99, kind: "adjust" as const, name: " Ra ngày 15 ", amount: -1_250_000 }];
    const r = settlePayload("2026-09", "3", lines);
    expect(r.ok && r.value.headcount).toBe(3);
    expect(r.ok && r.value.lines.at(-1)).toEqual({ kind: "adjust", name: "Ra ngày 15", amount: -1_250_000 });
    expect(settlePayload("2026-09", "0", lines).ok).toBe(false);
    expect(settlePayload("2026-09", "3", [{ key: 1, kind: "fixed", name: "Nhà", amount: -1 }]).ok).toBe(false);
    expect(settlePayload("2026-09", "3", [{ key: 1, kind: "adjust", name: "", amount: 5 }]).ok).toBe(false);
    expect(settlePayload("2026-09", "3", [{ key: 1, kind: "adjust", name: "x", amount: 0 }]).ok).toBe(false);
  });
});

describe("dòng ghi tay", () => {
  const shared = ["groceries", "eating-out", "utilities"];
  const base = { amount: 300_000, sign: 1 as const, name: "", category_id: "groceries" };

  it("người thuê chi hộ: gửi số dương, phải thuộc danh mục chi chung", () => {
    expect(linePayload({ ...base, kind: "paid_for_us" }, shared)).toEqual({ ok: true, value: { kind: "paid_for_us", amount: 300_000, category_id: "groceries" } });
    expect(linePayload({ ...base, kind: "paid_for_us", category_id: "xang" }, shared).ok).toBe(false);
  });

  it("chỉnh giảm nợ gửi số âm; phí một lần cần tên", () => {
    expect(linePayload({ ...base, kind: "adjust", sign: -1, name: "giảm tiền nhà" }, shared)).toEqual({ ok: true, value: { kind: "adjust", amount: -300_000, name: "giảm tiền nhà" } });
    expect(linePayload({ ...base, kind: "one_off" }, shared).ok).toBe(false);
    expect(linePayload({ ...base, kind: "one_off", name: "Thẻ xe", amount: 0 }, shared).ok).toBe(false);
  });
});

describe("Cài đặt › Cho thuê", () => {
  it("người thuê mới: số dư mở sổ có dấu, 0 thì không gửi", () => {
    expect(tenantPayload({ name: " Anh Bình ", opening: 7_075_000, openingSign: 1, active: true }, true)).toEqual({ ok: true, value: { name: "Anh Bình", opening_balance: 7_075_000 } });
    expect(tenantPayload({ name: "Anh Bình", opening: 80_000, openingSign: -1, active: true }, true)).toMatchObject({ value: { opening_balance: -80_000 } });
    expect(tenantPayload({ name: "Anh Bình", opening: 0, openingSign: 1, active: false }, false)).toEqual({ ok: true, value: { name: "Anh Bình", active: false } });
    expect(tenantPayload({ name: " ", opening: 0, openingSign: 1, active: true }, true).ok).toBe(false);
  });

  it("phí cố định cần tên và số dương", () => {
    expect(feePayload({ name: "Nhà", amount: 2_500_000, active: true }, true)).toEqual({ ok: true, value: { name: "Nhà", amount: 2_500_000 } });
    expect(feePayload({ name: "Nhà", amount: 0, active: true }, true).ok).toBe(false);
  });

  it("cấu hình: số người ≥ 1, ít nhất một danh mục chung, bắt buộc chọn nguồn thu", () => {
    expect(rentalConfigPayload({ headcount: "3", shared_category_ids: ["groceries"], income_stream_id: "rental" })).toEqual({
      ok: true,
      value: { headcount: 3, shared_category_ids: ["groceries"], income_stream_id: "rental" },
    });
    expect(rentalConfigPayload({ headcount: "3", shared_category_ids: ["groceries"], income_stream_id: "" }).ok).toBe(false);
    expect(rentalConfigPayload({ headcount: "0", shared_category_ids: ["groceries"], income_stream_id: "rental" }).ok).toBe(false);
    expect(rentalConfigPayload({ headcount: "3", shared_category_ids: [], income_stream_id: "rental" }).ok).toBe(false);
  });
});
