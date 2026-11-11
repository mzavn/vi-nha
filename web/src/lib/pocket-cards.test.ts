import { afterEach, describe, expect, it } from "vitest";
import { pocketsView } from "../../../src/domain/pockets";
import { pocketsB, pocketsShared } from "./household-b.fixture";
import { setAmountsHidden } from "./money";
import { NO_SAVINGS_ACCOUNT, reserveCard, savingsCard, SHARED_GROUP_NOTE, type ReserveCardView } from "./pocket-cards";
import type { PayCycleView } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => `${s}${NBSP}₫`;

afterEach(() => setAmountsHidden(false));

const goalE = (id: string, name: string, accountId: string | null, target: number) => ({
  id, name, accountId, target, targetPct: null, monthly: null, repeatMonths: null, dueDate: null, debtId: null, sort: 100, spent: 0,
});
const rowsOf = (v: ReserveCardView) => v.groups.flatMap((g) => g.goals);

/** Hộ mẫu E sau màn chuyển đổi (UC-702 AC-28): Học phí ↔ tài khoản tiết kiệm, Hoá đơn ↔ tài khoản hoá đơn 0, phao, Ví Thưởng. */
function pocketsE(accounts: { id: string; name: string; pocket: "savings" | "reserve" | "operating" | null; balance: number }[], goals: ReturnType<typeof goalE>[], rewardAccountId: string | null) {
  return pocketsView({
    accounts: accounts.map((a) => ({ ...a, confirmed: true })),
    goals,
    rewardAccountId,
    debts: [],
    savingsPct: 30,
    history: { since: "2026-11-10", prevSince: "2026-10-10", accounts: [] },
    operatingSpend: { cycles: [], dataStart: null },
    peaceTarget: 6,
  });
}

describe("thẻ Tích luỹ (ADR-122)", () => {
  it("UC-702 AC-18: hộ mẫu B → Tích luỹ 6.500.000 ₫, mỗi tài khoản ngăn Tích luỹ, không dòng giữ riêng, kỳ này / kỳ trước có dấu, % trích", () => {
    expect(savingsCard(pocketsB())).toEqual({
      total: vnd("6.500.000"),
      empty: false,
      lines: [
        { label: "tài khoản tích luỹ", value: vnd("6.000.000") },
        { label: "heo đất", value: vnd("500.000") },
      ],
      change: `Kỳ này (từ 10/11): ${vnd("+800.000")}`,
      prev: `Kỳ trước: ${vnd("+700.000")}`,
      pct: "Trích 10% mỗi kỳ lương",
      done: null,
    });
    expect(JSON.stringify(savingsCard(pocketsB()))).not.toMatch(/giữ riêng|để riêng/i);
  });

  it("UC-702 AC-18: kỳ này giảm 150.000 → −150.000 ₫, 0 → 0 ₫; không tài khoản Tích luỹ → rỗng, câu 'Chưa có tài khoản Tích luỹ — mở một tài khoản thật rồi xếp vào ngăn Tích luỹ ›'", () => {
    const p = pocketsB();
    expect(savingsCard({ ...p, savings: { ...p.savings, change: { ...p.savings.change, amount: -150_000, prevAmount: 0 } } })).toMatchObject({
      change: `Kỳ này (từ 10/11): ${vnd("−150.000")}`,
      prev: `Kỳ trước: ${vnd("0")}`,
    });
    expect(savingsCard({ ...p, savings: { ...p.savings, total: 0, accounts: [] } })).toMatchObject({ empty: true, lines: [] });
    expect(NO_SAVINGS_ACCOUNT).toBe("Chưa có tài khoản Tích luỹ — mở một tài khoản thật rồi xếp vào ngăn Tích luỹ ›");
  });

  it("UC-702 AC-18: che số → mọi số bị che, 10% giữ nguyên", () => {
    setAmountsHidden(true);
    const v = savingsCard(pocketsB())!;
    expect([v.total, v.change, v.prev, v.pct]).toEqual([vnd("••••"), `Kỳ này (từ 10/11): ${vnd("+••••")}`, `Kỳ trước: ${vnd("+••••")}`, "Trích 10% mỗi kỳ lương"]);
    expect(v.lines.every((l) => l.value === vnd("••••"))).toBe(true);
  });

  it("UC-707 AC-32: không có pockets → không có card Tích luỹ", () => {
    expect(savingsCard(undefined)).toBeNull();
  });

  it("UC-702 AC-23: kỳ lương có ① → 'Kỳ này chưa trích (10% = 2.000.000 ₫)' rồi 'Kỳ này đã trích ✓ 2.000.000 ₫ (10%)'; mốc kỳ là ISO của kỳ → hiện theo ngày VN", () => {
    const p = pocketsB();
    const withIso = { ...p, savings: { ...p.savings, change: { ...p.savings.change, since: "2026-11-10T01:00:00.000Z" } } };
    const cycle = {
      savingsDone: { amount: 0, base: 20_000_000, pct: 0 },
      tasks: [{ kind: "savings", status: "open", amount: 2_000_000 }],
    } as unknown as PayCycleView;
    expect(savingsCard(withIso, cycle)).toMatchObject({ change: `Kỳ này (từ 10/11): ${vnd("+800.000")}`, done: `Kỳ này chưa trích (10% = ${vnd("2.000.000")})` });
    expect(savingsCard(p, { ...cycle, savingsDone: { amount: 2_000_000, base: 20_000_000, pct: 10 } })!.done).toBe(`Kỳ này đã trích ✓ ${vnd("2.000.000")} (10%)`);
    expect(savingsCard(p, null)!.done).toBeNull();
  });
});

describe("thẻ Dự phòng (ADR-122, ADR-132)", () => {
  it("UC-702 AC-19: hộ mẫu B → tổng, mục tiêu theo thứ tự server ('đã có A / B trong {tài khoản}', thanh, chip đủ, hạn, lặp), Thuế theo %, phần an tâm đủ 3,1 / 6 tháng", () => {
    const v = reserveCard(pocketsB())!;
    expect(v.groups.map((g) => [g.head, g.note])).toEqual([[null, null], [null, null], [null, null], [null, null]]);
    expect({ ...v, groups: rowsOf(v) }).toEqual({
      total: vnd("38.000.000"),
      empty: false,
      groups: [
        { id: "repay", name: "Trả nợ Vay người thân", amount: `đã có ${vnd("1.000.000")} / ${vnd("1.000.000")} trong tài khoản Trả nợ`, pct: 100, full: true, over: false, spent: null, sub: "hạn 15/11/2026 · mỗi tháng", needsAccount: false },
        { id: "tuition", name: "Học phí", amount: `đã có ${vnd("4.000.000")} / ${vnd("6.000.000")} trong tài khoản học phí`, pct: 66, full: false, over: false, spent: null, sub: `hạn 15/01/2027 · ${vnd("2.000.000")}/tháng, 3 tháng một lần`, needsAccount: false },
        { id: "car", name: "Bảo dưỡng xe", amount: `đã có ${vnd("1.000.000")} / ${vnd("4.800.000")} trong tài khoản bảo dưỡng xe`, pct: 20, full: false, over: false, spent: null, sub: "hạn 31/03/2027", needsAccount: false },
        { id: "tax", name: "Thuế · 10% thu chịu thuế", amount: `đã có ${vnd("500.000")} trong tài khoản thuế`, pct: null, full: false, over: false, spent: null, sub: null, needsAccount: false },
      ],
      peace: {
        title: `Phần an tâm ${vnd("31.500.000")}`,
        months: "đủ 3,1 / 6 tháng vận hành",
        pct: 51,
        note: `chi vận hành trung bình ${vnd("10.000.000")}/kỳ (3 kỳ gần nhất)`,
        bad: false,
      },
      reward: null,
    });
  });

  it("UC-702 AC-19: 2 kỳ đủ dữ liệu → 3,0 / 6, thanh 50; phần an tâm âm → đỏ; 0 → mọi tiền đã có hẹn; covered null → chưa đủ một kỳ; mục tiêu chưa có tài khoản → 'chưa có tài khoản' + Mở tài khoản thật", () => {
    const cycles = pocketsB().reserve.peaceMonths;
    const two = pocketsB({ operatingSpend: { cycles: [{ start: "2026-09-10", amount: 10_500_000, days: 30 }, { start: "2026-10-10", amount: 10_500_000, days: 30 }], dataStart: "2026-08-15" } });
    expect(reserveCard(two)!.peace).toEqual({
      title: `Phần an tâm ${vnd("31.500.000")}`,
      months: "đủ 3,0 / 6 tháng vận hành",
      pct: 50,
      note: `chi vận hành trung bình ${vnd("10.500.000")}/kỳ (2 kỳ gần nhất)`,
      bad: false,
    });
    const p = pocketsB();
    expect(reserveCard({ ...p, reserve: { ...p.reserve, peace: -1_000_000 } })!.peace).toMatchObject({ title: `Phần an tâm âm ${vnd("1.000.000")}`, months: null, pct: null, bad: true });
    expect(reserveCard({ ...p, reserve: { ...p.reserve, peace: 0 } })!.peace).toMatchObject({ title: `Phần an tâm ${vnd("0")} — mọi tiền Dự phòng đã có hẹn`, months: null, pct: null, bad: false });
    expect(reserveCard({ ...p, reserve: { ...p.reserve, peaceMonths: { ...cycles, covered: null, monthly: null, cycles: 0 } } })!.peace).toMatchObject({
      months: null,
      pct: null,
      note: "Chưa đủ một kỳ lương trọn để đo số tháng",
    });
    const noAccount = { ...p, reserve: { ...p.reserve, goals: p.reserve.goals.map((g) => (g.id === "car" ? { ...g, accountId: null, held: null, need: null, short: null } : g)), groups: p.reserve.groups.filter((g) => g.accountId !== "car-acc") } };
    expect(rowsOf(reserveCard(noAccount)!)[2]).toEqual({ id: "car", name: "Bảo dưỡng xe", amount: "chưa có tài khoản", pct: null, full: false, over: false, spent: null, sub: "hạn 31/03/2027", needsAccount: true });
    expect(JSON.stringify(reserveCard(noAccount))).not.toMatch(/để riêng|giữ riêng|Chọn tài khoản giữ/);
    expect(reserveCard({ ...p, reserve: { ...p.reserve, total: 0, accounts: [], goals: [], groups: [], peace: 0 } })).toMatchObject({ empty: true, groups: [] });
    expect(reserveCard(undefined)).toBeNull();
  });

  it("UC-702 AC-19: che số → mọi số tiền bị che; %, số tháng và hạn giữ nguyên", () => {
    setAmountsHidden(true);
    const v = reserveCard(pocketsB())!;
    expect(v.total).toBe(vnd("••••"));
    expect(rowsOf(v)[1]).toMatchObject({ amount: `đã có ${vnd("••••")} / ${vnd("••••")} trong tài khoản học phí`, pct: 66, sub: `hạn 15/01/2027 · ${vnd("••••")}/tháng, 3 tháng một lần` });
    expect(v.peace).toMatchObject({ title: `Phần an tâm ${vnd("••••")}`, months: "đủ 3,1 / 6 tháng vận hành", pct: 51, note: `chi vận hành trung bình ${vnd("••••")}/kỳ (3 kỳ gần nhất)` });
  });

  it("UC-702 AC-28: hộ mẫu E sau chuyển đổi → 'Học phí · đã có 10.000.000 ₫ / 2.000.000 ₫ trong tài khoản tiết kiệm', 'Hoá đơn · đã có 0 ₫ / 1.300.000 ₫ trong tài khoản hoá đơn', 'Phần an tâm 5.000.000 ₫' (không gồm Ví Thưởng), 'Ví Thưởng 4.000.000 ₫'; nhà một tài khoản → thẻ Tích luỹ rỗng, không 'giữ riêng' / 'để riêng'; che số", () => {
    const p = pocketsE(
      [
        { id: "main", name: "tài khoản chính", pocket: "operating", balance: 20_000_000 },
        { id: "wealth", name: "tài khoản tích luỹ", pocket: "savings", balance: 6_000_000 },
        { id: "saving", name: "tài khoản tiết kiệm", pocket: "reserve", balance: 10_000_000 },
        { id: "bill", name: "tài khoản hoá đơn", pocket: "reserve", balance: 0 },
        { id: "buffer", name: "phao", pocket: "reserve", balance: 5_000_000 },
        { id: "bonus", name: "tài khoản dự phòng", pocket: "reserve", balance: 4_000_000 },
      ],
      [goalE("tuition", "Học phí", "saving", 2_000_000), goalE("bill", "Hoá đơn", "bill", 1_300_000)],
      "bonus",
    );
    const v = reserveCard(p)!;
    // Thứ tự theo server (pocketsView xếp theo hạn rồi tên).
    expect(rowsOf(v).map((g) => `${g.name} · ${g.amount}`)).toEqual([
      `Hoá đơn · đã có ${vnd("0")} / ${vnd("1.300.000")} trong tài khoản hoá đơn`,
      `Học phí · đã có ${vnd("10.000.000")} / ${vnd("2.000.000")} trong tài khoản tiết kiệm`,
    ]);
    expect(v.peace.title).toBe(`Phần an tâm ${vnd("5.000.000")}`);
    expect(v.reward).toBe(`Ví Thưởng ${vnd("4.000.000")}`);
    const one = pocketsE([{ id: "main", name: "tài khoản chính", pocket: "operating", balance: 21_200_000 }], [goalE("tuition", "Học phí", null, 2_000_000)], null);
    expect(savingsCard(one)).toMatchObject({ empty: true, lines: [] });
    expect(rowsOf(reserveCard(one)!)[0]).toMatchObject({ name: "Học phí", amount: "chưa có tài khoản", needsAccount: true });
    expect(JSON.stringify([savingsCard(one), reserveCard(one), v])).not.toMatch(/giữ riêng|để riêng/);
    setAmountsHidden(true);
    const hidden = reserveCard(p)!;
    expect(JSON.stringify([hidden, savingsCard(p)])).not.toMatch(/\d\.\d{3}/);
    expect(hidden.reward).toBe(`Ví Thưởng ${vnd("••••")}`);
  });

  it("UC-702 AC-29: nhóm tài khoản chung — dòng nhóm '{tài khoản} · {số dư} cho {n} mục tiêu' + chip thiếu, từng mục tiêu 'đã có A / B' (không 'trong …'), câu chân nhóm; Thuế một mình giữ dòng cũ; che số giữ %, số mục tiêu", () => {
    const v = reserveCard(pocketsShared())!;
    expect(v.total).toBe(vnd("27.500.000"));
    const view = v.groups.map((g) => ({ head: g.head, note: g.note, rows: g.goals.map((r) => [r.name, r.amount, r.pct, r.full]) }));
    expect(view).toEqual([
      {
        head: { title: `VCB chung · ${vnd("9.000.000")} cho 3 mục tiêu`, chip: `thiếu ${vnd("800.000")}`, tone: "warn" },
        note: SHARED_GROUP_NOTE,
        rows: [
          ["Hoá đơn", `đã có ${vnd("2.000.000")} / ${vnd("2.000.000")}`, 100, true],
          ["Bảo dưỡng xe", `đã có ${vnd("4.800.000")} / ${vnd("4.800.000")}`, 100, true],
          ["Hiếu hỉ", `đã có ${vnd("2.200.000")} / ${vnd("3.000.000")}`, 73, false],
        ],
      },
      {
        head: { title: `MB tiết kiệm · ${vnd("12.000.000")} cho 2 mục tiêu`, chip: `thiếu ${vnd("1.500.000")}`, tone: "warn" },
        note: SHARED_GROUP_NOTE,
        rows: [
          ["Nhà ở", `đã có ${vnd("7.500.000")} / ${vnd("7.500.000")}`, 100, true],
          ["Học tập", `đã có ${vnd("4.500.000")} / ${vnd("6.000.000")}`, 75, false],
        ],
      },
      { head: null, note: null, rows: [["Thuế · 10% thu chịu thuế", `đã có ${vnd("1.500.000")} trong TK thuế`, null, false]] },
    ]);
    expect(SHARED_GROUP_NOTE).toBe("Chia theo thứ tự ưu tiên — khoản chi không chọn mục tiêu làm mục tiêu cuối thiếu trước.");
    expect(v.peace.title).toBe(`Phần an tâm ${vnd("5.000.000")}`);
    expect(reserveCard(pocketsShared({ saving: 15_000_000 }))!.groups[1]!.head).toEqual({ title: `MB tiết kiệm · ${vnd("15.000.000")} cho 2 mục tiêu`, chip: `dư ${vnd("1.500.000")}`, tone: "ok" });
    expect(reserveCard(pocketsShared({ saving: 13_500_000 }))!.groups[1]!.head!.chip).toBe("đủ");
    setAmountsHidden(true);
    const hidden = reserveCard(pocketsShared())!;
    expect(hidden.groups[0]!.head).toEqual({ title: `VCB chung · ${vnd("••••")} cho 3 mục tiêu`, chip: `thiếu ${vnd("••••")}`, tone: "warn" });
    expect(hidden.groups[0]!.goals[2]).toMatchObject({ amount: `đã có ${vnd("••••")} / ${vnd("••••")}`, pct: 73 });
    expect(JSON.stringify(hidden)).not.toMatch(/\d\.\d{3}/);
  });

  it("UC-702 AC-31: đã chi trong kỳ — 'đã chi X kỳ này', thanh và chip đủ theo đã có + đã chi; đã có âm → 'chi vượt phần X' đỏ; che số", () => {
    const paid = reserveCard(pocketsShared({ saving: 4_500_000, spent: { "nha-o": 7_500_000 } }))!;
    const group = paid.groups[1]!;
    expect(group.head).toEqual({ title: `MB tiết kiệm · ${vnd("4.500.000")} cho 2 mục tiêu`, chip: `thiếu ${vnd("1.500.000")}`, tone: "warn" });
    expect(group.goals[0]).toMatchObject({ name: "Nhà ở", amount: `đã có ${vnd("0")} / ${vnd("7.500.000")}`, spent: `đã chi ${vnd("7.500.000")} kỳ này`, pct: 100, full: true, over: false });
    expect(group.goals[1]).toMatchObject({ name: "Học tập", amount: `đã có ${vnd("4.500.000")} / ${vnd("6.000.000")}`, spent: null, pct: 75, full: false });
    const over = reserveCard(pocketsShared({ saving: 0, spent: { "hoc-tap": 6_000_000 } }))!.groups[1]!.goals[1]!;
    expect(over).toMatchObject({ name: "Học tập", amount: `chi vượt phần ${vnd("6.000.000")}`, spent: `đã chi ${vnd("6.000.000")} kỳ này`, over: true, full: false });
    setAmountsHidden(true);
    const hidden = reserveCard(pocketsShared({ saving: 0, spent: { "hoc-tap": 6_000_000 } }))!;
    expect(hidden.groups[1]!.goals[1]).toMatchObject({ amount: `chi vượt phần ${vnd("••••")}`, spent: `đã chi ${vnd("••••")} kỳ này` });
    expect(JSON.stringify(hidden)).not.toMatch(/\d\.\d{3}/);
  });
});
