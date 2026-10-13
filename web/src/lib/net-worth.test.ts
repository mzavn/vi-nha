import { describe, expect, it } from "vitest";
import {
  assetRowSub,
  cashflowFooter,
  dateText,
  defaultFlags,
  growthText,
  historySub,
  ITEM_SECTIONS,
  itemPayload,
  itemTargetsPayload,
  itemToForm,
  ledgerTarget,
  liabilityName,
  liabilityRowSub,
  lotPayload,
  lotsSummary,
  lotsTotalText,
  lotSub,
  lotTitle,
  pctText,
  positionText,
  quantityText,
  returnText,
  sellPayload,
  signedPct,
  soldLotText,
  statusLabel,
  targetsPayload,
  valuePayload,
  valueText,
  valueToast,
} from "./net-worth";
import type { BalanceItem, BalanceLot, BalancePosition, BalanceRow, LiabilityRow } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => s.replaceAll(" ₫", `${NBSP}₫`);
const TODAY = "2026-11-15";

const pos = (p: Partial<BalancePosition>): BalancePosition => ({
  pnl: 0,
  pnlPct: 0,
  toTakeProfitPct: null,
  toStopLossPct: null,
  status: "holding",
  heldDays: 100,
  cagrPct: null,
  cagrVsExpected: null,
  ...p,
});

const lot = (l: Partial<BalanceLot>): BalanceLot => ({
  id: 1,
  itemId: "vang",
  boughtOn: "2026-03-10",
  quantityMilli: 20_000,
  unitCost: 5_000_000,
  soldOn: null,
  soldUnitPrice: null,
  takeProfitPrice: null,
  stopLossPrice: null,
  note: null,
  createdAt: "2026-03-10T00:00:00Z",
  held: true,
  value: 105_000_000,
  cost: 100_000_000,
  realized: null,
  position: null,
  ...l,
});

const item = (i: Partial<BalanceItem>): BalanceItem => ({
  id: "vang",
  name: "Vàng",
  section: "A1",
  pyramid: "protective",
  measure: "units",
  unit: "chỉ",
  liquid: true,
  investable: true,
  assetKind: null,
  costBasis: null,
  acquiredOn: null,
  takeProfitValue: null,
  stopLossValue: null,
  note: null,
  sort: 0,
  createdAt: "2026-03-10T00:00:00Z",
  present: true,
  value: 126_000_000,
  unitPrice: 5_250_000,
  priceOn: "2026-11-01",
  cashflow: 0,
  cashflowPeriod: null,
  cashflowMonthly: null,
  expectedReturnBps: null,
  heldQuantityMilli: 24_000,
  cost: 124_000_000,
  position: null,
  unrealized: 2_000_000,
  unrealizedPct: 1.6,
  hitTakeProfit: 0,
  hitStopLoss: 0,
  lots: [],
  values: [],
  ...i,
});

describe("bảng cân đối: số và chữ", () => {
  it("phần trăm cắt một chữ số lẻ, dấu phẩy; mẫu số 0 → \"—\" (balance UC-1102 AC-6)", () => {
    expect(pctText(15.5)).toBe("15,5%");
    expect(pctText(null)).toBe("—");
    expect(signedPct(5)).toBe("+5,0%");
    expect(signedPct(-12.5)).toBe("−12,5%");
    expect(signedPct(1.6)).toBe("+1,6%");
    expect(signedPct(null)).toBe("—");
    expect(quantityText(24_000, "chỉ")).toBe("24 chỉ");
    expect(quantityText(500, "chỉ")).toBe("0,5 chỉ");
    expect(dateText("2026-11-15")).toBe("15/11/2026");
  });

  it("UC-1102 AC-1: dòng Vàng \"15,5% tổng · 25,6% vốn chủ · giá ngày 1/11\"; Vay tiêu dùng \"18%/năm · lãi 3.600.000 ₫/năm · tháng này 300.000 ₫\"; khoản 0% không có phần lãi", () => {
    const row: BalanceRow = {
      key: "item:vang",
      source: "item",
      itemId: "vang",
      name: "Vàng",
      section: "A1",
      pyramid: "protective",
      liquid: true,
      investable: true,
      value: 126_000_000,
      pctOfTotal: 15.5,
      pctOfEquity: 25.6,
      cashflowMonthly: null,
      expectedReturnBps: null,
      valuedOn: "2026-11-01",
    };
    expect(assetRowSub(row, item({}))).toBe("15,5% tổng · 25,6% vốn chủ · giá ngày 1/11");
    expect(assetRowSub({ ...row, pctOfEquity: null }, item({}))).toBe("15,5% tổng · — vốn chủ · giá ngày 1/11");
    const debt: LiabilityRow = {
      key: "debt:vay-tieu-dung",
      kind: "debt",
      refId: "vay-tieu-dung",
      name: "Vay tiêu dùng",
      term: "short",
      group: "high",
      value: 20_000_000,
      interestRateBps: 1800,
      interestPerYear: 3_600_000,
      interestThisMonth: 300_000,
      dueDay: null,
      pctOfTotal: 2.4,
      pctOfEquity: 4,
    };
    expect(liabilityRowSub(debt)).toBe(vnd("2,4% tổng · 4% vốn chủ · 18%/năm · lãi 3.600.000 ₫/năm · tháng này 300.000 ₫"));
    expect(liabilityRowSub({ ...debt, dueDay: 5 })).toMatch(/trả ngày 5$/);
    expect(liabilityRowSub({ ...debt, interestRateBps: 0, interestPerYear: 0, interestThisMonth: 0 })).toBe("2,4% tổng · 4% vốn chủ");
  });

  it("UC-1102 AC-7: thẻ tín dụng còn nợ ghi \"Thẻ tín dụng · Thẻ VCB\"; dòng từ sổ chạm → màn nguồn (pwa UC-717 AC-1)", () => {
    const card = { kind: "credit_card", name: "Thẻ VCB" } as LiabilityRow;
    expect(liabilityName(card)).toBe("Thẻ tín dụng · Thẻ VCB");
    expect(liabilityName({ ...card, kind: "debt", name: "Vay người nhà" })).toBe("Vay người nhà");
    expect(ledgerTarget("cash")).toEqual({ tab: "wallets", walletsTab: "accounts" });
    expect(ledgerTarget("card:the-vcb")).toEqual({ tab: "wallets", walletsTab: "accounts" });
    expect(ledgerTarget("receivables:short")).toEqual({ tab: "wallets", walletsTab: "debts" });
    expect(ledgerTarget("debt:vay-nguoi-nha")).toEqual({ tab: "wallets", walletsTab: "debts" });
    expect(ledgerTarget("tenants")).toEqual({ tab: "wallets", walletsTab: "tenants" });
    expect(ledgerTarget("app:fund")).toEqual({ tab: "wallets", walletsTab: "wealth-building" });
  });

  it("UC-1101 AC-5: dòng tiền 3.000.000 kỳ Năm, kỳ vọng 12% → \"dòng tiền 250.000 ₫/tháng (3.000.000 ₫/năm) · kỳ vọng 12%/năm\"", () => {
    expect(returnText({ cashflow: 3_000_000, cashflowPeriod: "year", cashflowMonthly: 250_000, expectedReturnBps: 1200 })).toBe(
      vnd("dòng tiền 250.000 ₫/tháng (3.000.000 ₫/năm) · kỳ vọng 12%/năm"),
    );
    expect(returnText({ cashflow: 250_000, cashflowPeriod: "month", cashflowMonthly: 250_000, expectedReturnBps: null })).toBe(vnd("dòng tiền 250.000 ₫/tháng"));
    expect(returnText({ cashflow: 0, cashflowPeriod: null, cashflowMonthly: null, expectedReturnBps: null })).toBeNull();
  });

  it("UC-1102 AC-2: chân tháp \"Dòng tiền thật 250.000 ₫/tháng · sau bù lạm phát 104.166 ₫/tháng\"; UC-1102 AC-3: hàng tháng có chênh so tháng trước", () => {
    expect(cashflowFooter(250_000, 104_166)).toBe(vnd("Dòng tiền thật 250.000 ₫/tháng · sau bù lạm phát 104.166 ₫/tháng"));
    const p = { month: "2026-11", date: TODAY, totalAssets: 811_000_000, totalLiabilities: 320_000_000, equity: 491_000_000, change: 6_000_000 };
    expect(historySub(p as never)).toBe(vnd("tài sản 811.000.000 ₫ · nợ 320.000.000 ₫ · so tháng trước +6.000.000 ₫"));
    expect(historySub({ ...p, change: null } as never)).toBe(vnd("tài sản 811.000.000 ₫ · nợ 320.000.000 ₫"));
  });
});

describe("lô, chốt lời / cắt lỗ, CAGR", () => {
  it("UC-1101 AC-2: mục Vàng theo lô — \"24 chỉ · lãi +2.000.000 ₫ (+1,6%)\"; lô 1 \"Mua 10/3/2026 · 20 chỉ × 5.000.000 ₫\"; tổng \"Vốn 124.000.000 ₫ · lãi chưa chốt +2.000.000 ₫ (+1,6%)\"", () => {
    expect(lotsSummary(item({})).text).toBe(vnd("24 chỉ · lãi +2.000.000 ₫ (+1,6%)"));
    expect(lotsSummary(item({ measure: "value" })).text).toBeNull();
    expect(lotTitle(lot({}), "chỉ")).toBe(vnd("Mua 10/3/2026 · 20 chỉ × 5.000.000 ₫"));
    expect(lotsTotalText(item({}))).toBe(vnd("Vốn 124.000.000 ₫ · lãi chưa chốt +2.000.000 ₫ (+1,6%)"));
  });

  it("UC-1101 AC-4: lô đã bán — \"Bán 10/11/2026 × 5.300.000 ₫ · đã chốt −2.800.000 ₫\"", () => {
    expect(soldLotText(lot({ held: false, soldOn: "2026-11-10", soldUnitPrice: 5_300_000, realized: -2_800_000 }))).toBe(vnd("Bán 10/11/2026 × 5.300.000 ₫ · đã chốt −2.800.000 ₫"));
  });

  it("UC-1101 AC-8: lô 1 đang giữ, còn cách chốt lời 4,7%, cắt lỗ 8,5%, chưa đủ 1 năm; lô 2 đã chạm cắt lỗ (−2,8%); dòng tổng \"1 lô đã chạm cắt lỗ\"", () => {
    const p1 = pos({ pnl: 5_000_000, pnlPct: 5, toTakeProfitPct: 4.7, toStopLossPct: 8.5, heldDays: 250 });
    expect(positionText(p1)).toBe(vnd("+5.000.000 ₫ (+5,0%) · còn cách chốt lời 4,7% · còn cách cắt lỗ 8,5% · Đang giữ · +5,0% từ ngày mua (chưa đủ 1 năm)"));
    const p2 = pos({ pnl: -3_000_000, pnlPct: -12.5, toStopLossPct: -2.8, status: "stop_loss", heldDays: 75 });
    expect(positionText(p2)).toBe(vnd("−3.000.000 ₫ (−12,5%) · Đã chạm cắt lỗ (−2,8%)"));
    expect(statusLabel(p2).tone).toBe("bad");
    expect(statusLabel(pos({ status: "take_profit", toTakeProfitPct: -2 }))).toEqual({ label: "Đã chạm chốt lời (+2,0%)", tone: "ok" });
    expect(statusLabel(p1)).toEqual({ label: "Đang giữ", tone: null });
    expect(lotSub(lot({ takeProfitPrice: 5_500_000, stopLossPrice: 4_800_000, position: p1 }))).toBe(vnd("giá trị 105.000.000 ₫ · chốt lời 5.500.000 · còn 4,7% · cắt lỗ 4.800.000 · còn 8,5%"));
    const withHit = item({ hitStopLoss: 1 });
    expect(lotsTotalText(withHit)).toMatch(/· 1 lô đã chạm cắt lỗ$/);
    expect(lotsSummary(withHit).chips).toEqual([{ label: "1 lô chạm cắt lỗ", tone: "bad" }]);
    // Cắt lỗ ≥ chốt lời → chặn tại máy như server (`invalid_target`); để trống = bỏ.
    expect(targetsPayload({ takeProfit: 5_500_000, stopLoss: 5_600_000 }).ok).toBe(false);
    expect(targetsPayload({ takeProfit: 0, stopLoss: 5_400_000 })).toEqual({ ok: true, value: { take_profit_price: null, stop_loss_price: 5_400_000 } });
  });

  it("UC-1101 AC-9: Đất nền — \"+200.000.000 ₫ (+50,0%) · còn cách chốt lời 33,3% · Đang giữ · CAGR 14,4%/năm — cao hơn kỳ vọng 2,4 điểm\"; bỏ chốt lời → không còn khoảng cách; giá mua 0 → \"—\"", () => {
    const p = pos({ pnl: 200_000_000, pnlPct: 50, toTakeProfitPct: 33.3, heldDays: 1096, cagrPct: 14.4, cagrVsExpected: 2.4 });
    expect(positionText(p)).toBe(vnd("+200.000.000 ₫ (+50,0%) · còn cách chốt lời 33,3% · Đang giữ · CAGR 14,4%/năm — cao hơn kỳ vọng 2,4 điểm"));
    expect(positionText({ ...p, toTakeProfitPct: null })).toBe(vnd("+200.000.000 ₫ (+50,0%) · Đang giữ · CAGR 14,4%/năm — cao hơn kỳ vọng 2,4 điểm"));
    expect(growthText(pos({ heldDays: 1096, cagrPct: 9, cagrVsExpected: -3 }))).toBe("CAGR 9%/năm — thấp hơn kỳ vọng 3 điểm");
    expect(growthText(pos({ heldDays: 1096, cagrPct: 14.4, cagrVsExpected: null }))).toBe("CAGR 14,4%/năm");
    expect(positionText(pos({ pnl: 600_000_000, pnlPct: null, heldDays: 1096, cagrPct: null }))).toBe(vnd("+600.000.000 ₫ (—) · Đang giữ · CAGR —"));
    expect(itemTargetsPayload({ costBasis: 400_000_000, acquiredOn: "2023-11-15", takeProfit: 800_000_000, stopLoss: 0 }, TODAY)).toEqual({
      ok: true,
      value: { cost_basis: 400_000_000, acquired_on: "2023-11-15", take_profit_value: 800_000_000, stop_loss_value: null },
    });
  });
});

describe("ô nhập: mục, định giá, lô", () => {
  it("UC-1101 AC-1: thêm Đất nền B3 tăng trưởng theo giá trị — cờ mặc định tiền lỏng tắt, tài sản đầu tư bật; A1 bật tiền lỏng; tầng cố định tắt tài sản đầu tư; không có A3", () => {
    expect(defaultFlags("B3", "growth")).toEqual({ liquid: false, investable: true });
    expect(defaultFlags("A1", "protective")).toEqual({ liquid: true, investable: true });
    expect(defaultFlags("B2", "fixed")).toEqual({ liquid: false, investable: false });
    expect(ITEM_SECTIONS).not.toContain("A3");
    const f = { ...itemToForm(null), name: " Đất nền ", section: "B3" as const, pyramid: "growth" as const, ...defaultFlags("B3", "growth") };
    expect(itemPayload(f, null)).toEqual({
      ok: true,
      value: { name: "Đất nền", section: "B3", pyramid: "growth", liquid: false, investable: true, asset_kind: null, note: null, measure: "value" },
    });
    expect(itemPayload({ ...f, measure: "units", unit: " " }, null)).toMatchObject({ ok: false, errors: { unit: expect.any(String) } });
    expect(itemPayload({ ...f, name: "" }, null).ok).toBe(false);
    // Sửa mà không đổi cách tính: không gửi `measure`.
    expect(itemPayload({ ...itemToForm(item({})), name: "Vàng nhẫn" }, item({}))).toMatchObject({ ok: true, value: { name: "Vàng nhẫn", unit: "chỉ" } });
    const same = itemPayload(itemToForm(item({})), item({}));
    expect(same.ok && "measure" in same.value).toBe(false);
  });

  it("UC-1101 AC-5, AC-7: định giá — dòng tiền > 0 luôn kèm kỳ; ngày sau hôm nay chặn tại máy; mục theo lô gửi `unit_price`", () => {
    const f = { day: "2026-10-01", amount: 50_000_000, cashflow: 3_000_000, period: "year" as const, expected: "12" };
    expect(valuePayload(f, "value", TODAY)).toEqual({ ok: true, value: { as_of: "2026-10-01", value: 50_000_000, cashflow: 3_000_000, cashflow_period: "year", expected_return: 12 } });
    expect(valuePayload({ ...f, cashflow: 0, expected: "" }, "units", TODAY)).toEqual({ ok: true, value: { as_of: "2026-10-01", unit_price: 50_000_000 } });
    expect(valuePayload({ ...f, day: "2026-12-01" }, "value", TODAY)).toMatchObject({ ok: false, errors: { day: expect.any(String) } });
    expect(valuePayload({ ...f, expected: "1200" }, "value", TODAY)).toMatchObject({ ok: false, errors: { expected: expect.any(String) } });
    expect(valuePayload({ ...f, expected: "-5,5" }, "value", TODAY)).toMatchObject({ ok: true, value: { expected_return: -5.5 } });
  });

  it("UC-1101 AC-2, AC-4: thêm lô số lượng tới 3 chữ số lẻ; bán lô không trước ngày mua", () => {
    expect(lotPayload({ day: "2026-03-10", quantity: "20", unitCost: 5_000_000, note: "" }, TODAY)).toEqual({ ok: true, value: { bought_on: "2026-03-10", quantity: 20, unit_cost: 5_000_000 } });
    expect(lotPayload({ day: "2026-03-10", quantity: "0,5", unitCost: 5_000_000, note: "" }, TODAY)).toMatchObject({ ok: true, value: { quantity: 0.5 } });
    expect(lotPayload({ day: "2026-03-10", quantity: "0", unitCost: 5_000_000, note: "" }, TODAY).ok).toBe(false);
    expect(lotPayload({ day: "2026-03-10", quantity: "1,2345", unitCost: 5_000_000, note: "" }, TODAY).ok).toBe(false);
    expect(sellPayload({ day: "2026-11-10", price: 5_300_000 }, { boughtOn: "2026-09-01" }, TODAY)).toEqual({ ok: true, value: { sold_on: "2026-11-10", sold_unit_price: 5_300_000 } });
    expect(sellPayload({ day: "2026-08-01", price: 5_300_000 }, { boughtOn: "2026-09-01" }, TODAY).ok).toBe(false);
  });

  it("pwa UC-717 AC-2: toast \"Đã cập nhật giá Vàng: 5.250.000 ₫/chỉ ngày 15/11/2026.\"; lịch sử giá kèm đơn vị", () => {
    expect(valueToast(item({}), 5_250_000, TODAY)).toBe(vnd("Đã cập nhật giá Vàng: 5.250.000 ₫/chỉ ngày 15/11/2026."));
    expect(valueToast(item({ name: "Đất nền", measure: "value", unit: null }), 600_000_000, "2026-10-01")).toBe(vnd("Đã cập nhật giá trị Đất nền: 600.000.000 ₫ ngày 1/10/2026."));
    const v = { id: 1, itemId: "vang", asOf: "2026-11-01", value: null, unitPrice: 5_250_000, cashflow: 0, cashflowPeriod: null, expectedReturnBps: null, createdAt: "" };
    expect(valueText(v, "chỉ")).toBe(vnd("1/11/2026 · 5.250.000 ₫/chỉ"));
    expect(valueText({ ...v, unitPrice: null, value: 50_000_000, cashflow: 3_000_000, cashflowPeriod: "year", expectedReturnBps: 1200 }, null)).toBe(
      vnd("1/11/2026 · 50.000.000 ₫ · dòng tiền 3.000.000 ₫/năm · kỳ vọng 12%/năm"),
    );
  });
});
