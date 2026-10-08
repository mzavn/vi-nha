import { describe, expect, it } from "vitest";
import { AllocationConfigError, allocate, type AllocationInput, type WalletRule } from "../src/domain/allocation";
import { openDb } from "./helpers/d1-sqlite";

// Luật nạp lấy từ chính seed, để bảng số dưới đây luôn nói về cấu hình thật của nhà.
function seedRules(duLichDeadline: string): WalletRule[] {
  const rows = openDb()
    .prepare(
      `SELECT w.id walletId, w.tier, w.must_group mustGroup, w.kind, a.mode, a.period, a.amount, a.percent,
              a.target_amount targetAmount, a.target_date targetDate, a.floor_amount floorAmount, a.priority
       FROM allocations a JOIN wallets w ON w.id = a.wallet_id WHERE a.active = 1 AND w.active = 1`,
    )
    .all() as unknown as WalletRule[];
  return rows.map((r) => (r.walletId === "travel" ? { ...r, targetDate: duLichDeadline } : r));
}

const SEP = "2026-09-10T09:00:00+07:00"; // tháng 9/2026 có 4 thứ Hai
const NOV = "2026-11-10T09:00:00+07:00"; // tháng 11/2026 có 5 thứ Hai

function input(amount: number, over: Partial<AllocationInput> & { taxable?: boolean; at?: string } = {}): AllocationInput {
  const at = over.at ?? SEP;
  return {
    income: { amount, taxable: over.taxable ?? false, at },
    rules: over.rules ?? seedRules(at === SEP ? "2026-12-10" : "2027-02-10"), // Du lịch: 15tr trong 3 tháng → 5tr/tháng
    fundedThisMonth: over.fundedThisMonth ?? {},
    balances: over.balances ?? {},
    openingBalances: over.openingBalances ?? {},
    stream: over.stream,
  };
}

const byWallet = (r: ReturnType<typeof allocate>) => Object.fromEntries(r.funds.map((f) => [f.walletId, f.amount]));
const MUST = ["housing", "food", "transport", "utilities", "hometown"];
const NICE = ["travel", "fun-husband", "fun-wife"];
const sum = (got: Record<string, number>, ids: string[]) => ids.reduce((s, id) => s + (got[id] ?? 0), 0);

describe("bảng chia bắt buộc (seed hiện tại)", () => {
  it("A — đủ tiền: mọi ví đủ dự kiến, Có-thì-tốt nhận phần dư", () => {
    const r = allocate(input(40_000_000));
    const got = byWallet(r);
    expect(got["wealth-building"]).toBe(12_000_000);
    expect(got["tax"]).toBeUndefined();
    expect(sum(got, MUST)).toBe(13_000_000);
    expect(sum(got, NICE)).toBe(11_560_000);
    expect(got["nice-to-have"]).toBe(3_440_000);
    expect(r.underfunded).toEqual([]);
  });

  it("B — thiếu nhẹ: Have về 0, Hưởng thụ bị bóp, hai ví Chơi chia đều, Must vẫn đủ", () => {
    const got = byWallet(allocate(input(30_000_000)));
    expect(got["wealth-building"]).toBe(9_000_000);
    expect(sum(got, MUST)).toBe(13_000_000);
    expect(got).toMatchObject({ "travel": 5_000_000, "fun-husband": 1_500_000, "fun-wife": 1_500_000 });
    expect(got["nice-to-have"]).toBeUndefined();
  });

  it("C — thiếu nặng: Must dưới sàn bị gắn cờ, Tích sản vẫn đúng 30%", () => {
    const r = allocate(input(12_000_000));
    const got = byWallet(r);
    expect(got["wealth-building"]).toBe(3_600_000);
    expect(got).toMatchObject({ housing: 8_000_000, food: 400_000 });
    expect(sum(got, NICE)).toBe(0);
    expect(got["nice-to-have"]).toBeUndefined();
    expect(r.underfunded).toEqual(["food", "transport", "utilities"]); // Về quê không có sàn nên không bị gắn cờ
  });

  it("D — thu nhập ngoài chịu thuế: trích 10% vào ví Thuế", () => {
    const r = allocate(input(10_000_000, { taxable: true }));
    expect(byWallet(r)).toEqual({ "wealth-building": 3_000_000, tax: 1_000_000, housing: 6_000_000 });
    expect(r.underfunded).toEqual(["housing", "food", "transport", "utilities"]);
  });

  it("E — khoản thu thứ hai trong tháng chỉ nạp phần còn thiếu, và B + E = A", () => {
    const a = byWallet(allocate(input(40_000_000)));
    const b = byWallet(allocate(input(30_000_000)));
    const e = byWallet(allocate(input(10_000_000, { fundedThisMonth: b, balances: b })));
    expect(sum(e, MUST)).toBe(0);
    expect(e).toMatchObject({ "fun-husband": 1_780_000, "fun-wife": 1_780_000, "nice-to-have": 3_440_000 });
    for (const id of Object.keys(a)) expect((b[id] ?? 0) + (e[id] ?? 0), id).toBe(a[id]);
  });

  it("F — tháng có 5 thứ Hai: phong bì tuần cần 5 tuần tiền", () => {
    const got = byWallet(allocate(input(40_000_000, { at: NOV })));
    expect(got).toMatchObject({ food: 3_125_000, "transport": 1_500_000, "fun-husband": 4_100_000, "fun-wife": 4_100_000 });
    expect(sum(got, MUST)).toBe(13_925_000);
    expect(got["nice-to-have"]).toBe(875_000);
  });

  it("G — ví tiêu lố tháng trước được bù, phần bù lấy từ Có-thì-tốt", () => {
    const opening = { food: -300_000 };
    const r = allocate(input(40_000_000, { openingBalances: opening }));
    const got = byWallet(r);
    expect(got["food"]).toBe(2_800_000);
    expect(got["nice-to-have"]).toBe(3_140_000);
    expect(r.deficitCovered).toEqual({ food: 300_000 });

    // chia làm hai lần vẫn ra đúng như một lần, và hố chỉ được bù một lần
    const first = allocate(input(30_000_000, { openingBalances: opening }));
    const g1 = byWallet(first);
    const second = allocate(input(10_000_000, { openingBalances: opening, fundedThisMonth: g1, balances: g1 }));
    const g2 = byWallet(second);
    for (const id of Object.keys(got)) expect((g1[id] ?? 0) + (g2[id] ?? 0), id).toBe(got[id]);
    expect(first.deficitCovered).toEqual({ food: 300_000 });
    expect(second.deficitCovered).toEqual({});
  });
});

describe("bất biến và ca biên", () => {
  it.each([1, 7, 999, 1_234_567, 33_333_333])("tổng các fund luôn bằng đúng thu nhập (%i ₫)", (amount) => {
    for (const taxable of [false, true]) {
      const r = allocate(input(amount, { taxable }));
      expect(r.funds.reduce((s, f) => s + f.amount, 0)).toBe(amount);
      expect(r.funds.every((f) => Number.isInteger(f.amount) && f.amount > 0)).toBe(true);
    }
  });

  it("Tích sản luôn đúng 30% dù thiếu tới đâu", () => {
    for (const amount of [1_000_000, 5_000_000, 12_000_000, 80_000_000]) {
      expect(byWallet(allocate(input(amount)))["wealth-building"]).toBe(Math.floor(amount * 0.3));
    }
  });

  it("mục tiêu đã đạt thì không nạp nữa", () => {
    const got = byWallet(allocate(input(40_000_000, { balances: { "travel": 15_000_000 } })));
    expect(got["travel"]).toBeUndefined();
    expect(got["nice-to-have"]).toBe(8_440_000);
  });

  it("mục tiêu quá hạn: dồn hết phần còn thiếu vào tháng này", () => {
    const rules = seedRules("2026-01-01");
    const got = byWallet(allocate(input(60_000_000, { rules, balances: { "travel": 9_000_000 } })));
    expect(got["travel"]).toBe(6_000_000);
  });

  it("ví tích dồn bị âm không được tự bù (chỉ phong bì mới tiêu lố)", () => {
    const r = allocate(input(40_000_000, { openingBalances: { "hometown": -500_000 } }));
    expect(byWallet(r)["hometown"]).toBe(1_000_000);
    expect(r.deficitCovered).toEqual({});
  });

  it("ví không có trong luật nạp thì không nhận gì", () => {
    const rules = seedRules("2026-12-10").filter((r) => r.walletId !== "hometown");
    expect(byWallet(allocate(input(40_000_000, { rules })))["hometown"]).toBeUndefined();
  });

  it("cấu hình sai thì báo lỗi rõ ràng thay vì chia bừa", () => {
    const rules = seedRules("2026-12-10");
    expect(() => allocate(input(1_000_000, { rules: rules.filter((r) => r.mode !== "remainder") }))).toThrow(AllocationConfigError);
    expect(() => allocate(input(0))).toThrow(AllocationConfigError);
    expect(() => allocate(input(1000.5))).toThrow(AllocationConfigError);
    const greedy = rules.map((r) => (r.walletId === "wealth-building" ? { ...r, percent: 1.2 } : r));
    expect(() => allocate(input(1_000_000, { rules: greedy }))).toThrow(AllocationConfigError);
  });
});

describe("chia theo nguồn thu", () => {
  const VO = { locks: [{ walletId: "wealth-building", percent: 0.45 }] };

  it("nguồn cho thuê khóa 100% vào Thu cho thuê: đúng một fund, không chạy dòng thác, không cờ thiếu sàn", () => {
    const stream = { locks: [{ walletId: "rental-income", percent: 1 }] };
    const r = allocate(input(5_191_667, { stream, openingBalances: { food: -500_000 } }));
    expect(r).toEqual({ funds: [{ walletId: "rental-income", amount: 5_191_667 }], underfunded: [], deficitCovered: {} });
  });

  it("lương vợ khóa 45% Tích sản trước, phần còn lại lấp chỗ thiếu; không trích thuế theo luật chung", () => {
    const got = byWallet(allocate(input(11_000_000, { stream: VO, taxable: true })));
    expect(got["wealth-building"]).toBe(4_950_000);
    expect(got["tax"]).toBeUndefined();
    expect(sum(got, MUST)).toBe(6_050_000); // dưới tổng sàn Must: toàn bộ vào Must
  });

  it("nguồn không khóa gì: toàn bộ vào dòng thác, không cắt Tích sản/Thuế", () => {
    const got = byWallet(allocate(input(19_100_000, { stream: { locks: [] }, taxable: true })));
    expect(got["wealth-building"]).toBeUndefined();
    expect(got["tax"]).toBeUndefined();
    expect(sum(got, MUST)).toBe(13_000_000);
    expect(sum(got, NICE)).toBe(6_100_000);
  });

  it("stream null y hệt không khai báo nguồn", () => {
    expect(allocate(input(40_000_000, { stream: null, taxable: true }))).toEqual(allocate(input(40_000_000, { taxable: true })));
  });

  it("khóa trọn 100% chia nhiều ví: đồng lẻ làm tròn về ví khóa đầu tiên", () => {
    const stream = { locks: [{ walletId: "rental-income", percent: 0.3 }, { walletId: "wealth-building", percent: 0.7 }] };
    expect(byWallet(allocate(input(7, { stream })))).toEqual({ "rental-income": 3, "wealth-building": 4 });
  });
});
