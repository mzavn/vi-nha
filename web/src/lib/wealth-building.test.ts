import { describe, expect, it } from "vitest";
import { safetyFundCashText, safetyFundMonthsText, wealthBuildingKinds, wealthBuildingPlaces, wealthBuildingSources, type WealthBuildingLine } from "./wealth-building";
import type { WealthBuildingAccount, WealthBuildingBreakdown } from "./types";

const NBSP = "\u00a0";
const LABELS = { gold: "Vàng", stock: "Cổ phiếu" };
type Flow = WealthBuildingBreakdown["flows"][number];
type Place = WealthBuildingAccount;

const flow = (over: Partial<Flow>): Flow => ({
  kind: "other",
  direction: "in",
  accountId: null,
  accountName: null,
  memberName: null,
  walletId: null,
  walletName: null,
  walletActive: null,
  assetKind: null,
  count: 1,
  amount: 0,
  ...over,
});
const MEMBER_NAME = { husband: "Chồng", wife: "Vợ" } as const;
const piggyBank = (memberId: keyof typeof MEMBER_NAME, balance: number, over: Partial<Place> = {}): Place => ({
  accountId: `piggy-bank-${memberId}`,
  name: `Heo đất MB (${MEMBER_NAME[memberId]})`,
  role: "piggy_bank",
  memberId,
  memberName: MEMBER_NAME[memberId],
  balance,
  pendingCount: 0,
  pendingNet: 0,
  ...over,
});
const breakdown = (over: Partial<WealthBuildingBreakdown>): WealthBuildingBreakdown => ({ walletId: "wealth-building", name: "Tích sản", cash: 0, assets: 0, accounts: [], flows: [], ...over });
const shown = (lines: WealthBuildingLine[]) => lines.map((l) => [l.label, l.value]);

describe("tab Tích sản: tiền nào, loại nào, đang ở đâu (ADR-86)", () => {
  // Như prod 2026-10-06: 9.000 ví Heo đất cũ + 11 lần bỏ heo của vợ + 1 lần của chồng.
  const prod = breakdown({
    cash: 55_000,
    accounts: [piggyBank("husband", 5_000), piggyBank("wife", 50_000)],
    flows: [
      flow({ kind: "piggy_bank", accountId: "piggy-bank-wife", accountName: "Heo đất MB (Vợ)", memberName: "Vợ", count: 11, amount: 41_000 }),
      flow({ kind: "wallet", walletId: "piggy-bank", walletName: "Heo đất", walletActive: false, amount: 9_000 }),
      flow({ kind: "piggy_bank", accountId: "piggy-bank-husband", accountName: "Heo đất MB (Chồng)", memberName: "Chồng", count: 1, amount: 5_000 }),
    ],
  });

  it("như prod: tiền 55.000 nằm ở hai con heo, đến từ bỏ heo từng người và số dư ví Heo đất cũ — đủ ₫, không rút gọn", () => {
    expect(shown(wealthBuildingKinds(prod, LABELS))).toEqual([
      ["Tiền", 55_000],
      ["Tài sản", 0],
    ]);
    expect(wealthBuildingKinds(prod, LABELS)[1]!.note).toBe("chưa mua tài sản nào");
    const places = wealthBuildingPlaces(prod);
    expect(shown(places.lines)).toEqual([
      ["Heo đất Chồng", 5_000],
      ["Heo đất Vợ", 50_000],
    ]);
    expect(places.extra).toBeNull();
    const src = wealthBuildingSources(prod, LABELS);
    expect(shown(src.ins)).toEqual([
      ["Bỏ heo đất Vợ (11 lần)", 41_000],
      ["Chuyển số dư ví Heo đất cũ", 9_000],
      ["Bỏ heo đất Chồng (1 lần)", 5_000],
    ]);
    expect(src.outs).toEqual([]);
    expect(src.cash).toBe(55_000);
    const text = JSON.stringify([wealthBuildingKinds(prod, LABELS), places, src]);
    expect(text).not.toMatch(/\d+k\b|\d,\dtr/);
  });

  it("phần không nằm ở heo là 'trong các tài khoản thường'; heo 0 không chờ gì thì không có dòng", () => {
    const places = wealthBuildingPlaces(breakdown({ cash: 500_000, accounts: [piggyBank("husband", 7_000), piggyBank("wife", 0)] }));
    expect(shown(places.lines)).toEqual([
      ["Heo đất Chồng", 7_000],
      ["Trong các tài khoản thường", 493_000],
    ]);
  });

  it("heo nhiều hơn Tích sản: nói tổng, phần là Tích sản và phần dư có từ trước khi dùng app; không có dòng tài khoản thường", () => {
    const places = wealthBuildingPlaces(breakdown({ cash: 10_000, accounts: [piggyBank("husband", 7_000), piggyBank("wife", 5_000)] }));
    expect(places.lines.map((l) => l.label)).toEqual(["Heo đất Chồng", "Heo đất Vợ"]);
    expect(places.extra).toBe(`Heo đất đang có 12.000${NBSP}₫: 10.000${NBSP}₫ là tiền Tích sản, 2.000${NBSP}₫ còn lại là số dư có từ trước khi dùng app hoặc tiền lãi — chưa tính vào Tích sản.`);
    expect(wealthBuildingPlaces(breakdown({ cash: 0, accounts: [piggyBank("husband", 7_000)] })).extra).toBe(
      `Heo đất đang có 7.000${NBSP}₫, đều là số dư có từ trước khi dùng app hoặc tiền lãi — chưa tính vào Tích sản.`,
    );
  });

  it("như prod sau khi nhập số dư đầu heo: câu phần dư cộng lại khớp các dòng, chỉ kể loại tài khoản đang có tiền", () => {
    const buffer: Place = { ...piggyBank("wife", 10_000), accountId: "buffer-wife", name: "MB tiết kiệm (vợ)", role: "buffer" };
    const places = wealthBuildingPlaces({ ...prod, accounts: [piggyBank("husband", 30_000), piggyBank("wife", 95_000), buffer] });
    expect(shown(places.lines)).toEqual([
      ["Heo đất Chồng", 30_000],
      ["Heo đất Vợ", 95_000],
      ["Phao dự phòng · MB tiết kiệm (vợ)", 10_000],
    ]);
    expect(places.lines[0]!.note).toBe("tiết kiệm tiền lẻ — rút về được khi cần");
    expect(places.extra).toBe(
      `Heo đất và phao dự phòng đang có 135.000${NBSP}₫: 55.000${NBSP}₫ là tiền Tích sản, 80.000${NBSP}₫ còn lại là số dư có từ trước khi dùng app hoặc tiền lãi — chưa tính vào Tích sản.`,
    );
  });

  it("như prod sau migration 0027 (ADR-91): số dư có sẵn là một nguồn vào; Tích sản bằng heo + phao thì không còn câu phần dư", () => {
    const buffer: Place = { ...piggyBank("wife", 10_000), accountId: "buffer-wife", name: "MB tiết kiệm (vợ)", role: "buffer" };
    const after = { ...prod, cash: 135_000, accounts: [piggyBank("husband", 30_000), piggyBank("wife", 95_000), buffer], flows: [...prod.flows, flow({ kind: "opening", amount: 80_000 })] };
    const places = wealthBuildingPlaces(after);
    expect(places.extra).toBeNull();
    expect(places.lines.map((l) => l.key)).not.toContain("regular");
    const src = wealthBuildingSources(after, LABELS);
    expect(src.ins.at(-1)).toMatchObject({
      label: "Số dư có sẵn khi mở tài khoản (1 lần)",
      note: "tiền có sẵn trong heo / phao / sổ tiết kiệm trước khi ghi vào app — tính một lần vào Tích sản",
      value: 80_000,
    });
    expect(src.ins.reduce((s, l) => s + l.value, 0)).toBe(135_000);
  });

  it("heo âm hiện đúng số âm và lý do; không trừ vào Tích sản — phần còn lại vẫn ở tài khoản thường", () => {
    const places = wealthBuildingPlaces(breakdown({ cash: 9_000, accounts: [piggyBank("husband", -4_000), piggyBank("wife", 9_000)] }));
    expect(shown(places.lines)).toEqual([
      ["Heo đất Chồng", -4_000],
      ["Heo đất Vợ", 9_000],
    ]);
    expect(places.lines[0]!.note).toBe("sổ ghi rút ra nhiều hơn bỏ vào — tiền lãi hoặc tiền heo từ trước khi dùng app chưa tách");
    expect(places.extra).toBeNull();
  });

  it("heo có log rút đang chờ gán: nói 'đang chờ gán' kèm số theo phía heo, kể cả khi số dư heo là 0", () => {
    const places = wealthBuildingPlaces(breakdown({ cash: 0, accounts: [piggyBank("husband", 0, { pendingCount: 1, pendingNet: -50_000 })] }));
    expect(places.lines).toHaveLength(1);
    expect(places.lines[0]).toMatchObject({ label: "Heo đất Chồng", value: 0, note: `còn 1 khoản bỏ / rút heo đang chờ gán (−50.000${NBSP}₫)` });
  });

  it("phao và sổ tiết kiệm (ADR-88): mỗi tài khoản Tích sản một dòng cạnh heo, phần còn lại ở tài khoản thường; nguồn 'Chuyển vào phao'", () => {
    const buffer: Place = { ...piggyBank("wife", 200_000), accountId: "buffer-wife", name: "MB tiết kiệm (vợ)", role: "buffer" };
    const so: Place = { ...piggyBank("wife", 800_000), accountId: "term-deposit-6m", name: "Sổ 6 tháng", role: "term_deposit" };
    const b = breakdown({
      cash: 1_055_000,
      accounts: [piggyBank("husband", 5_000), piggyBank("wife", 50_000), buffer, so],
      flows: [flow({ kind: "buffer", accountId: "buffer-wife", accountName: "MB tiết kiệm (vợ)", memberName: "Vợ", count: 1, amount: 1_000_000 })],
    });
    const places = wealthBuildingPlaces(b);
    expect(shown(places.lines)).toEqual([
      ["Heo đất Chồng", 5_000],
      ["Heo đất Vợ", 50_000],
      ["Phao dự phòng · MB tiết kiệm (vợ)", 200_000],
      ["Sổ tiết kiệm · Sổ 6 tháng", 800_000],
    ]);
    expect(places.lines.map((l) => l.note).slice(2)).toEqual(["rút được ngay khi cần", "gửi có kỳ hạn — tất toán mới rút được"]);
    expect(places.extra).toBeNull();
    expect(shown(wealthBuildingPlaces({ ...b, cash: 1_500_000 }).lines).at(-1)).toEqual(["Trong các tài khoản thường", 445_000]);
    expect(shown(wealthBuildingSources(b, LABELS).ins)).toEqual([["Chuyển vào phao MB tiết kiệm (vợ) (1 lần)", 1_000_000]]);
  });

  it("chia từ thu nhập và mua vàng: nguồn vào, tiền ra thành tài sản theo loại, còn lại là tiền", () => {
    const b = breakdown({
      cash: 700_000,
      assets: 300_000,
      flows: [
        flow({ kind: "fund", count: 2, amount: 1_000_000 }),
        flow({ kind: "buy_asset", direction: "out", assetKind: "gold", amount: 300_000 }),
      ],
    });
    const src = wealthBuildingSources(b, LABELS);
    expect(shown(src.ins)).toEqual([["Chia từ thu nhập (2 lần chia)", 1_000_000]]);
    expect(shown(src.outs)).toEqual([["Mua tài sản: Vàng (1 lần)", 300_000]]);
    expect(src.cash).toBe(700_000);
    expect(src.fundNote).toMatch(/^Phần chia từ thu nhập không hiện thành dòng riêng trong sổ/);
    expect(wealthBuildingSources(prod, LABELS).fundNote).toBeNull();
    expect(wealthBuildingKinds(b, LABELS).map((l) => [l.level, l.label, l.value])).toEqual([
      ["row", "Tiền", 700_000],
      ["row", "Tài sản", 300_000],
      ["part", "Vàng", 300_000],
    ]);
  });

  it("chốt tháng, thuế dư, chuyển ngân sách vào / ra: mỗi nguồn một nhãn riêng", () => {
    const src = wealthBuildingSources(
      breakdown({
        flows: [
          flow({ kind: "sweep", count: 2, amount: 40_000 }),
          flow({ kind: "tax", amount: 30_000 }),
          flow({ kind: "wallet", walletId: "rental-income", walletName: "Thu cho thuê", walletActive: true, count: 3, amount: 20_000 }),
          flow({ kind: "wallet", direction: "out", walletId: "food", walletName: "Ăn uống", walletActive: true, amount: 5_000 }),
        ],
      }),
      LABELS,
    );
    expect(src.ins.map((l) => l.label)).toEqual(["Quét dư cuối tháng (2 lần)", "Thuế dư sau quyết toán", "Chuyển từ ví Thu cho thuê (3 lần)"]);
    expect(src.outs.map((l) => l.label)).toEqual(["Chuyển sang ví Ăn uống (1 lần)"]);
  });

  it("phao khẩn cấp: có tiền mà làm tròn ra 0 tháng thì nói 'dưới 0,1', không '0'; số tiền nói có / cần", () => {
    const fund = { cash: 55_000, target: 96_000_000, months: 6, monthsCovered: 0 };
    expect(safetyFundMonthsText(fund)).toBe("dưới 0,1 / 6");
    expect(safetyFundMonthsText({ ...fund, cash: 0 })).toBe("0 / 6");
    expect(safetyFundMonthsText({ ...fund, monthsCovered: 2.5 })).toBe("2,5 / 6");
    expect(safetyFundMonthsText({ ...fund, monthsCovered: null })).toBeNull();
    expect(safetyFundCashText(fund)).toBe(`Có 55.000${NBSP}₫ · cần 96.000.000${NBSP}₫`);
    expect(safetyFundCashText(fund, true)).toBe(`Có 55.000${NBSP}₫ · cần ước tính 96.000.000${NBSP}₫`);
  });
});
