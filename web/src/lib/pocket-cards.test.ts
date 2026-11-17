import { afterEach, describe, expect, it } from "vitest";
import { pocketsView, type PocketsView } from "../../../src/domain/pockets";
import type { QueuedEntry } from "../offline/queue";
import { nearSpendB, pocketsB, pocketsShared, pocketsV23 } from "./household-b.fixture";
import { setAmountsHidden } from "./money";
import { applyQueue } from "./pending";
import { NO_SAVINGS_ACCOUNT, reserveCard, savingsCard, SHARED_GROUP_NOTE, type ReserveCardView } from "./pocket-cards";
import type { MonthView, Snapshot } from "./types";

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
    history: { since: "2026-11-01", prevSince: "2026-10-01", accounts: [] },
  });
}

describe("thẻ Tích luỹ (ADR-122)", () => {
  it("UC-702 AC-18: hộ mẫu B → Tích luỹ 6.500.000 ₫, mỗi tài khoản ngăn Tích luỹ, không dòng giữ riêng, tháng này (từ 1/11) / tháng trước có dấu, % trích; không chữ kỳ", () => {
    expect(savingsCard(pocketsB())).toEqual({
      total: vnd("6.500.000"),
      empty: false,
      lines: [
        { label: "tài khoản tích luỹ", value: vnd("6.000.000") },
        { label: "heo đất", value: vnd("500.000") },
      ],
      change: `Tháng này (từ 1/11): ${vnd("+800.000")}`,
      prev: `Tháng trước: ${vnd("+700.000")}`,
      pct: "Trích 10% mỗi khoản lương",
      done: null,
      doneWarn: false,
      cushion: null,
    });
    expect(JSON.stringify(savingsCard(pocketsB()))).not.toMatch(/giữ riêng|để riêng|kỳ/i);
  });

  it("UC-702 AC-18: tháng này giảm 150.000 → −150.000 ₫, 0 → 0 ₫; không tài khoản Tích luỹ → rỗng, câu 'Chưa có tài khoản Tích luỹ — mở một tài khoản thật rồi xếp vào ngăn Tích luỹ ›'", () => {
    const p = pocketsB();
    expect(savingsCard({ ...p, savings: { ...p.savings, change: { ...p.savings.change, amount: -150_000, prevAmount: 0 } } })).toMatchObject({
      change: `Tháng này (từ 1/11): ${vnd("−150.000")}`,
      prev: `Tháng trước: ${vnd("0")}`,
    });
    expect(savingsCard({ ...p, savings: { ...p.savings, total: 0, accounts: [] } })).toMatchObject({ empty: true, lines: [] });
    expect(NO_SAVINGS_ACCOUNT).toBe("Chưa có tài khoản Tích luỹ. Mở tài khoản thật rồi xếp vào ngăn Tích luỹ ›");
  });

  it("UC-702 AC-18: che số → mọi số bị che, 10% giữ nguyên", () => {
    setAmountsHidden(true);
    const v = savingsCard(pocketsB())!;
    expect([v.total, v.change, v.prev, v.pct]).toEqual([vnd("•••••"), `Tháng này (từ 1/11): ${vnd("+•••••")}`, `Tháng trước: ${vnd("+•••••")}`, "Trích 10% mỗi khoản lương"]);
    expect(v.lines.every((l) => l.value === vnd("•••••"))).toBe(true);
  });

  it("UC-707 AC-32: không có pockets → không có card Tích luỹ", () => {
    expect(savingsCard(undefined)).toBeNull();
  });

  it("UC-702 AC-40: 12/12, Tích luỹ tháng 12 đã trích 3.500.000 / 35.000.000 → 'Tháng 12 đã trích 3.500.000 ₫ · 10% lương · mức 10–30%', 'Tháng này (từ 1/12)', 'Tháng trước'; dưới 1% → vàng; không có month → không dòng", () => {
    const p = pocketsB();
    const dec = { ...p, savings: { ...p.savings, change: { since: "2026-12-01", amount: 3_500_000, prevSince: "2026-11-01", prevAmount: 800_000 } } };
    const month = { key: "2026-12", tasks: [], openCount: 0, savings: { amount: 3_500_000, base: 35_000_000, pct: 10, level: "10to30" }, goalHint: null } as MonthView;
    expect(savingsCard(dec, month)).toMatchObject({
      change: `Tháng này (từ 1/12): ${vnd("+3.500.000")}`,
      prev: `Tháng trước: ${vnd("+800.000")}`,
      done: `Tháng 12 đã trích ${vnd("3.500.000")} · 10% lương · mức 10–30%`,
      doneWarn: false,
    });
    expect(savingsCard(p, { ...month, savings: { amount: 100_000, base: 20_000_000, pct: 0, level: "below1" } })!.doneWarn).toBe(true);
    expect(savingsCard(p, null)!.done).toBeNull();
    expect(savingsCard(p)!.done).toBeNull();
  });
});

/** Hộ UC-1103 AC-9 ngày 17/11/2026: Tích luỹ = tài khoản tích luỹ 6.900.000 + Heo đất 510.000. */
const pocketsAC9 = (wealth = 6_900_000) =>
  pocketsView({
    accounts: [
      { id: "wealth", name: "tài khoản tích luỹ", pocket: "savings", confirmed: true, balance: wealth },
      { id: "piggy", name: "Heo đất", pocket: "savings", confirmed: true, balance: 510_000 },
    ],
    goals: [],
    rewardAccountId: null,
    debts: [],
    savingsPct: 10,
    history: { since: "2026-11-01", prevSince: "2026-10-01", accounts: [] },
  });

describe("dòng đệm thẻ Tích luỹ (Tài khoản › Ba ngăn)", () => {
  const ladder = { expenseMonthly: 14_200_000, safetyMonths: [6, 12, 24] as [number, number, number] };

  it("UC-707 AC-47: Tích luỹ 7.410.000, E 14.200.000 → 'Đủ 0,5 tháng chi · mốc Khởi đầu 1E'; 90.000.000 → 'Đủ 6,3 tháng chi · mốc An toàn 12E'; 400.000.000 → 'Đủ 28,1 tháng chi · đã qua mốc Vững vàng 24E'; E trống → câu cần chi phí tháng", () => {
    expect(savingsCard(pocketsAC9(), null, ladder)!.cushion).toBe("Đủ 0,5 tháng chi · mốc Khởi đầu 1E");
    expect(savingsCard(pocketsAC9(89_490_000), null, ladder)!.cushion).toBe("Đủ 6,3 tháng chi · mốc An toàn 12E");
    expect(savingsCard(pocketsAC9(399_490_000), null, ladder)!.cushion).toBe("Đủ 28,1 tháng chi · đã qua mốc Vững vàng 24E");
    expect(savingsCard(pocketsAC9(), null, { ...ladder, expenseMonthly: null })!.cushion).toBe("Cần chi phí tháng — nhập ở Ngưỡng và tỉ lệ hoặc chờ hết tháng đầu tiên");
  });

  it("UC-707 AC-47: hàng đợi offline chi 1.000.000 từ Heo đất → 'Đủ 0,4 tháng chi · mốc Khởi đầu 1E'; che số → dòng giữ nguyên; GET /v1/freedom chưa tải → không có dòng", () => {
    const snap = { day: "2026-11-17", pockets: pocketsAC9(), nearSpend: nearSpendB(), month: null, topUp: null } as unknown as Snapshot;
    const queued: QueuedEntry = {
      clientId: "c1",
      memberId: "husband",
      createdAt: "2026-11-17T03:00:00Z",
      status: "pending",
      attempts: 0,
      body: { at: "2026-11-17T03:00:00Z", client_id: "c1", meaning: "spend", amount: 1_000_000, category_id: "food", account_id: "piggy" },
    };
    expect(savingsCard(applyQueue(snap, [queued]).pockets, null, ladder)!.cushion).toBe("Đủ 0,4 tháng chi · mốc Khởi đầu 1E");
    setAmountsHidden(true);
    expect(savingsCard(pocketsAC9(), null, ladder)!.cushion).toBe("Đủ 0,5 tháng chi · mốc Khởi đầu 1E");
    setAmountsHidden(false);
    expect(savingsCard(pocketsAC9(), null, null)!.cushion).toBeNull();
    expect(savingsCard(pocketsAC9())!.cushion).toBeNull();
  });
});

describe("thẻ Dự phòng (ADR-122, ADR-132)", () => {
  it("UC-702 AC-19: hộ mẫu B → tổng, mục tiêu theo thứ tự server ('đã có A / B trong {tài khoản}', thanh, chip đủ, hạn, lặp), Thuế theo %", () => {
    const v = reserveCard(pocketsB())!;
    expect(v.groups.map((g) => [g.head, g.note])).toEqual([[null, null], [null, null], [null, null], [null, null]]);
    expect({ ...v, groups: rowsOf(v) }).toEqual({
      total: vnd("38.000.000"),
      empty: false,
      groups: [
        { id: "repay", name: "Trả nợ Vay người thân", amount: `1.000.000 / ${vnd("1.000.000")} trong tài khoản Trả nợ`, status: [], details: [`Có ${vnd("1.000.000")} + đã chi ${vnd("0")} / cần ${vnd("1.000.000")}`], pct: 100, full: true, over: false, closed: false, suggestClose: false, sub: "hạn 15/11/2026 · mỗi tháng", needsAccount: false },
        { id: "tuition", name: "Học phí", amount: `4.000.000 / ${vnd("6.000.000")} trong tài khoản học phí`, status: [], details: [`Có ${vnd("4.000.000")} + đã chi ${vnd("0")} / cần ${vnd("6.000.000")}`], pct: 66, full: false, over: false, closed: false, suggestClose: false, sub: `hạn 15/01/2027 · ${vnd("2.000.000")}/tháng, 3 tháng một lần`, needsAccount: false },
        { id: "car", name: "Bảo dưỡng xe", amount: `1.000.000 / ${vnd("4.800.000")} trong tài khoản bảo dưỡng xe`, status: [], details: [`Có ${vnd("1.000.000")} + đã chi ${vnd("0")} / cần ${vnd("4.800.000")}`], pct: 20, full: false, over: false, closed: false, suggestClose: false, sub: "hạn 31/03/2027", needsAccount: false },
        { id: "tax", name: "Thuế · 10% thu chịu thuế", amount: `đã có ${vnd("500.000")} trong tài khoản thuế`, status: [], details: [], pct: null, full: false, over: false, closed: false, suggestClose: false, sub: null, needsAccount: false },
      ],
      unassigned: { text: `Chưa gắn mục tiêu ${vnd("31.500.000")}`, bad: false },
      reward: null,
    });
  });

  it("UC-702 AC-19: mục tiêu chưa có tài khoản → 'chưa có tài khoản' + Mở tài khoản thật; ngăn rỗng → thẻ rỗng; không pockets → không thẻ", () => {
    const p = pocketsB();
    const noAccount = { ...p, reserve: { ...p.reserve, goals: p.reserve.goals.map((g) => (g.id === "car" ? { ...g, accountId: null, held: null, need: null, short: null } : g)), groups: p.reserve.groups.filter((g) => g.accountId !== "car-acc") } };
    expect(rowsOf(reserveCard(noAccount)!)[2]).toEqual({ id: "car", name: "Bảo dưỡng xe", amount: "chưa có tài khoản", status: [], details: [], pct: null, full: false, over: false, closed: false, suggestClose: false, sub: "hạn 31/03/2027", needsAccount: true });
    expect(JSON.stringify(reserveCard(noAccount))).not.toMatch(/để riêng|giữ riêng|Chọn tài khoản giữ/);
    expect(reserveCard({ ...p, reserve: { ...p.reserve, total: 0, accounts: [], goals: [], groups: [], peace: 0 } })).toMatchObject({ empty: true, groups: [] });
    expect(reserveCard(undefined)).toBeNull();
  });

  it("UC-707 AC-48: hộ mẫu B → hàng 'Chưa gắn mục tiêu 31.500.000 ₫' không số tháng, %, thanh; âm 1.000.000 → 'Chưa gắn mục tiêu âm 1.000.000 ₫' đỏ; 0 → không hàng; không còn chữ 'Phần an tâm'", () => {
    const p = pocketsB();
    const v = reserveCard(p)!;
    expect(v.unassigned).toEqual({ text: `Chưa gắn mục tiêu ${vnd("31.500.000")}`, bad: false });
    expect(reserveCard({ ...p, reserve: { ...p.reserve, peace: -1_000_000 } })!.unassigned).toEqual({ text: `Chưa gắn mục tiêu âm ${vnd("1.000.000")}`, bad: true });
    expect(reserveCard({ ...p, reserve: { ...p.reserve, peace: 0 } })!.unassigned).toBeNull();
    expect(JSON.stringify(v)).not.toMatch(/an tâm|tháng vận hành/i);
  });

  it("UC-702 AC-19: che số → mọi số tiền bị che; %, số tháng và hạn giữ nguyên", () => {
    setAmountsHidden(true);
    const v = reserveCard(pocketsB())!;
    expect(v.total).toBe(vnd("•••••"));
    expect(rowsOf(v)[1]).toMatchObject({ amount: `••••• / ${vnd("•••••")} trong tài khoản học phí`, pct: 66, sub: `hạn 15/01/2027 · ${vnd("•••••")}/tháng, 3 tháng một lần` });
    expect(v.unassigned).toEqual({ text: `Chưa gắn mục tiêu ${vnd("•••••")}`, bad: false });
  });

  it("UC-702 AC-28: hộ mẫu E sau chuyển đổi → 'Học phí · đã có 10.000.000 ₫ / 2.000.000 ₫ trong tài khoản tiết kiệm', 'Hoá đơn · đã có 0 ₫ / 1.300.000 ₫ trong tài khoản hoá đơn', 'Chưa gắn mục tiêu 5.000.000 ₫' (không gồm Ví Thưởng), 'Ví Thưởng 4.000.000 ₫'; nhà một tài khoản → thẻ Tích luỹ rỗng, không 'giữ riêng' / 'để riêng'; che số", () => {
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
      `Hoá đơn · 0 / ${vnd("1.300.000")} trong tài khoản hoá đơn`,
      `Học phí · 10.000.000 / ${vnd("2.000.000")} trong tài khoản tiết kiệm`,
    ]);
    expect(v.unassigned!.text).toBe(`Chưa gắn mục tiêu ${vnd("5.000.000")}`);
    expect(v.reward).toBe(`Ví Thưởng ${vnd("4.000.000")}`);
    const one = pocketsE([{ id: "main", name: "tài khoản chính", pocket: "operating", balance: 21_200_000 }], [goalE("tuition", "Học phí", null, 2_000_000)], null);
    expect(savingsCard(one)).toMatchObject({ empty: true, lines: [] });
    expect(rowsOf(reserveCard(one)!)[0]).toMatchObject({ name: "Học phí", amount: "chưa có tài khoản", needsAccount: true });
    expect(JSON.stringify([savingsCard(one), reserveCard(one), v])).not.toMatch(/giữ riêng|để riêng/);
    setAmountsHidden(true);
    const hidden = reserveCard(p)!;
    expect(JSON.stringify([hidden, savingsCard(p)])).not.toMatch(/\d\.\d{3}/);
    expect(hidden.reward).toBe(`Ví Thưởng ${vnd("•••••")}`);
  });

  it("UC-702 AC-29: nhóm tài khoản chung — dòng nhóm nhãn – số (tên tài khoản trái, số dư phải, dòng phụ '{n} mục tiêu · thiếu X' vàng), từng mục tiêu 'đã có A / B' (không 'trong …'), câu chân nhóm; Thuế một mình giữ dòng cũ; che số giữ %, số mục tiêu", () => {
    const v = reserveCard(pocketsShared())!;
    expect(v.total).toBe(vnd("27.500.000"));
    const view = v.groups.map((g) => ({ head: g.head, note: g.note, rows: g.goals.map((r) => [r.name, r.amount, r.pct, r.full]) }));
    expect(view).toEqual([
      {
        head: { name: "VCB chung", balance: vnd("9.000.000"), meta: `3 mục tiêu · thiếu ${vnd("800.000")}`, tone: "warn" },
        note: SHARED_GROUP_NOTE,
        rows: [
          ["Hoá đơn", `2.000.000 / ${vnd("2.000.000")}`, 100, true],
          ["Bảo dưỡng xe", `4.800.000 / ${vnd("4.800.000")}`, 100, true],
          ["Hiếu hỉ", `2.200.000 / ${vnd("3.000.000")}`, 73, false],
        ],
      },
      {
        head: { name: "MB tiết kiệm", balance: vnd("12.000.000"), meta: `2 mục tiêu · thiếu ${vnd("1.500.000")}`, tone: "warn" },
        note: SHARED_GROUP_NOTE,
        rows: [
          ["Nhà ở", `7.500.000 / ${vnd("7.500.000")}`, 100, true],
          ["Học tập", `4.500.000 / ${vnd("6.000.000")}`, 75, false],
        ],
      },
      { head: null, note: null, rows: [["Thuế · 10% thu chịu thuế", `đã có ${vnd("1.500.000")} trong TK thuế`, null, false]] },
    ]);
    expect(SHARED_GROUP_NOTE).toBe("Chia theo thứ tự ưu tiên: chi không chọn mục tiêu làm mục tiêu cuối thiếu trước.");
    expect(v.unassigned!.text).toBe(`Chưa gắn mục tiêu ${vnd("5.000.000")}`);
    expect(reserveCard(pocketsShared({ saving: 15_000_000 }))!.groups[1]!.head).toEqual({ name: "MB tiết kiệm", balance: vnd("15.000.000"), meta: `2 mục tiêu · dư ${vnd("1.500.000")}`, tone: "ok" });
    expect(reserveCard(pocketsShared({ saving: 13_500_000 }))!.groups[1]!.head!.meta).toBe("2 mục tiêu · đủ");
    setAmountsHidden(true);
    const hidden = reserveCard(pocketsShared())!;
    expect(hidden.groups[0]!.head).toEqual({ name: "VCB chung", balance: vnd("•••••"), meta: `3 mục tiêu · thiếu ${vnd("•••••")}`, tone: "warn" });
    expect(hidden.groups[0]!.goals[2]).toMatchObject({ amount: `••••• / ${vnd("•••••")}`, pct: 73 });
    expect(JSON.stringify(hidden)).not.toMatch(/\d\.\d{3}/);
  });

  it("UC-702 AC-31: đã chi — 'có X + chi Y / cần Z' (UC-707 AC-45, bỏ '+ chi 0'), thanh và chip đủ theo đã có + đã chi; đã có âm mà chưa khớp khoản nào → 'chi vượt phần X' đỏ; che số", () => {
    const paid = reserveCard(pocketsShared({ saving: 4_500_000, spent: { "nha-o": 7_500_000 } }))!;
    const group = paid.groups[1]!;
    expect(group.head).toEqual({ name: "MB tiết kiệm", balance: vnd("4.500.000"), meta: `2 mục tiêu · thiếu ${vnd("1.500.000")}`, tone: "warn" });
    expect(group.goals[0]).toMatchObject({ name: "Nhà ở", amount: `0 + 7.500.000 / ${vnd("7.500.000")}`, pct: 100, full: true, over: false });
    expect(group.goals[1]).toMatchObject({ name: "Học tập", amount: `4.500.000 / ${vnd("6.000.000")}`, pct: 75, full: false });
    const eaten = reserveCard(pocketsShared({ saving: 0, spent: { "hoc-tap": 6_000_000 } }))!.groups[1]!.goals[1]!;
    expect(eaten).toMatchObject({ name: "Học tập", amount: `0 + 6.000.000 / ${vnd("6.000.000")}`, over: false });
    const over = reserveCard(pocketsShared({ saving: -1_000_000 }))!.groups[1]!.goals[1]!;
    expect(over).toMatchObject({ name: "Học tập", amount: `chi vượt phần ${vnd("1.000.000")}`, over: true, full: false });
    setAmountsHidden(true);
    const hidden = reserveCard(pocketsShared({ saving: -1_000_000 }))!;
    expect(hidden.groups[1]!.goals[1]).toMatchObject({ amount: `chi vượt phần ${vnd("•••••")}` });
    expect(JSON.stringify(hidden)).not.toMatch(/\d\.\d{3}/);
  });

  it("UC-702 AC-34: MB tiết kiệm có khoản gửi → nhóm 'MB tiết kiệm' số dư gộp 105.000.000 ₫ (gồm khoản gửi kỳ hạn), dòng phụ '3 mục tiêu · …', ba mục tiêu như AC-16; sau đáo hạn 'Tiền lãi 3.000.000 ₫ (không tính vào mục tiêu)', Tập luyện vẫn 15.000.000; không mục tiêu trả từ tiền chi tiêu; che số", () => {
    const rows = (v: ReserveCardView) => rowsOf(v).map((r) => `${r.name} · ${r.amount}`);
    const before = reserveCard(pocketsV23())!;
    const group = before.groups.find((g) => g.key === "tk-tiet-kiem")!;
    expect(group.head).toEqual({ name: "MB tiết kiệm", balance: vnd("105.000.000"), meta: `3 mục tiêu · dư ${vnd("5.000.000")}`, tone: "ok" });
    expect(group.interest).toBeNull();
    expect(rows(before)).toEqual([
      `Nhà ở · 60.000.000 / ${vnd("60.000.000")}`,
      `Học tập · 30.000.000 / ${vnd("30.000.000")}`,
      `Tập luyện · 15.000.000 / ${vnd("10.000.000")}`,
    ]);
    const after = reserveCard(pocketsV23({ matured: true }))!;
    const matured = after.groups.find((g) => g.key === "tk-tiet-kiem")!;
    expect(matured.head).toEqual({ name: "MB tiết kiệm", balance: vnd("108.000.000"), meta: `3 mục tiêu · dư ${vnd("5.000.000")}`, tone: "ok" });
    expect(matured.interest).toBe(`Tiền lãi ${vnd("3.000.000")} (không tính vào mục tiêu)`);
    expect(rows(after)[2]).toBe(`Tập luyện · 15.000.000 / ${vnd("10.000.000")}`);
    expect(JSON.stringify([before, after])).not.toMatch(/Điện nước|Thuốc|Thiện phước|Về quê/);
    // Một mục tiêu ở tài khoản có khoản gửi vẫn có dòng nhóm (số dư gộp).
    const one = reserveCard({ ...pocketsV23(), reserve: { ...pocketsV23().reserve, goals: pocketsV23().reserve.goals.slice(0, 1), groups: pocketsV23().reserve.groups.map((g) => ({ ...g, goalIds: ["nha-o"] })) } })!;
    expect(one.groups[0]!.head).toEqual({ name: "MB tiết kiệm", balance: vnd("105.000.000"), meta: `dư ${vnd("5.000.000")}`, tone: "ok" });
    setAmountsHidden(true);
    const hidden = reserveCard(pocketsV23({ matured: true }))!;
    expect(hidden.groups.find((g) => g.key === "tk-tiet-kiem")!.interest).toBe(`Tiền lãi ${vnd("•••••")} (không tính vào mục tiêu)`);
    expect(JSON.stringify(reserveCard(pocketsV23()))).not.toMatch(/\d\.\d{3}/);
  });
});

describe("hàng mục tiêu khi khớp chi (pwa UC-707 AC-45)", () => {
  type Goal = PocketsView["reserve"]["goals"][number];
  /** Ví dụ AC-26: VCB chung (T) 2.350.000 sau khi Đám cưới (đứng đầu) khớp 1.200.000 từ T — số đúng hợp đồng snapshot. */
  const g = (id: string, name: string, o: Partial<Goal>): Goal =>
    ({
      id, name, accountId: "t", held: 0, need: 1_000_000, spent: 0, short: 0, target: 1_000_000, targetPct: null, monthly: null, repeatMonths: null, dueDate: null, debtId: null,
      closed: false, closedAt: null, leftover: 0, over: 0, suggestClose: false, shortBecause: [], advance: 0, advanceFrom: [], pendingRefund: 0,
      ...o,
    }) as Goal;
  const goals = (over: Record<string, Partial<Goal>> = {}): Goal[] => [
    g("dam-cuoi", "Đám cưới", { spent: 1_200_000, over: 200_000, suggestClose: true, ...over["dam-cuoi"] }),
    g("tap-luyen", "Tập luyện", { held: 1_500_000, need: 1_500_000, target: 1_500_000, monthly: 1_500_000, repeatMonths: 1, ...over["tap-luyen"] }),
    g("hoc-tap", "Học tập", { held: 850_000, short: 150_000, monthly: 1_000_000, repeatMonths: 1, ...over["hoc-tap"] }),
    g("sua-xe", "Sửa xe", { short: 1_000_000, shortBecause: [{ goalId: "dam-cuoi", amount: 200_000 }], ...over["sua-xe"] }),
  ];
  const pockets = (list: Goal[], extra: Goal[] = []): PocketsView => {
    const p = pocketsShared();
    return {
      ...p,
      reserve: {
        ...p.reserve,
        goals: [...list, ...extra],
        groups: [
          { accountId: "t", name: "VCB chung", balance: 2_350_000, need: 4_500_000, spent: 1_200_000, short: 1_150_000, extra: 0, goalIds: list.map((x) => x.id), childIds: [], interest: 0, pending: 0, free: 0, unmatched: 0 },
          ...extra.map((x) => ({ accountId: x.accountId!, name: "MB tiết kiệm", balance: 7_500_000, need: x.need, spent: x.spent, short: 0, extra: 0, goalIds: [x.id], childIds: [], interest: 0, pending: 0, free: 0, unmatched: 0 })),
        ],
        refunds: [],
      },
    } as PocketsView;
  };
  const row = (v: ReserveCardView, id: string) => rowsOf(v).find((r) => r.id === id)!;

  it("UC-707 AC-45: chưa chốt hàng gọn 'X + Y / Z ₫' (nhãn đầy đủ 'Có X + đã chi Y / cần Z' ở sheet), thanh và % theo (có + chi) / cần; gợi ý → chip 'Đã chi đủ' (nút Chốt xong ở sheet); bị thiếu vì mục tiêu trước chi vượt → 'thiếu W vì {mục tiêu} chi vượt'; đã có âm mà có khoản đã khớp → không 'chi vượt phần'", () => {
    const v = reserveCard(pockets(goals()), "2026-11-20")!;
    expect(row(v, "dam-cuoi")).toMatchObject({ amount: `0 + 1.200.000 / ${vnd("1.000.000")}`, details: [`Có ${vnd("0")} + đã chi ${vnd("1.200.000")} / cần ${vnd("1.000.000")}`], pct: 100, full: true, suggestClose: true, closed: false, status: [] });
    expect(row(v, "hoc-tap")).toMatchObject({ amount: `850.000 / ${vnd("1.000.000")}`, pct: 85, full: false, status: [] });
    expect(row(v, "sua-xe")).toMatchObject({ pct: 0, suggestClose: false, status: [{ text: `thiếu ${vnd("200.000")} vì Đám cưới chi vượt`, tone: "warn" }] });
    const eaten = reserveCard(pockets(goals({ "sua-xe": { held: -350_000, spent: 1_850_000, suggestClose: true, shortBecause: [] } })))!;
    expect(row(eaten, "sua-xe")).toMatchObject({ amount: `0 + 1.850.000 / ${vnd("1.000.000")}`, over: false, suggestClose: true });
  });

  it("UC-707 AC-45: đã chốt 'Xong · dư W' / 'Xong · vượt W' / 'Xong', không thanh, không gợi ý; đã chi / cần đầy đủ ở sheet", () => {
    const v = reserveCard(pockets(goals({ "dam-cuoi": { closed: true, closedAt: "2026-11-20T03:00:00Z" }, "sua-xe": { closed: true, spent: 950_000, held: 50_000, leftover: 50_000, shortBecause: [] } })))!;
    expect(row(v, "dam-cuoi")).toMatchObject({ amount: `Xong · vượt ${vnd("200.000")}`, details: [`Xong · đã chi ${vnd("1.200.000")} / cần ${vnd("1.000.000")} · vượt ${vnd("200.000")}`], pct: null, closed: true, suggestClose: false, status: [] });
    expect(row(v, "sua-xe")).toMatchObject({ amount: `Xong · dư ${vnd("50.000")}`, closed: true });
    const exact = reserveCard(pockets(goals({ "dam-cuoi": { closed: true, spent: 1_000_000, over: 0 } })))!;
    expect(row(exact, "dam-cuoi").amount).toBe("Xong");
  });

  it("UC-707 AC-45: trả từ tài khoản khác → dòng phụ 'chờ chuyển về X', sheet 'Trả từ {tài khoản} X · chờ chuyển về X'; chuyển đủ → dòng phụ không còn, sheet 'Trả từ … X'; che số 5 chấm, % giữ", () => {
    const b = goals({ "dam-cuoi": { spent: 1_000_000, over: 0, suggestClose: true, advance: 1_200_000, advanceFrom: ["V chi tiêu"], pendingRefund: 1_000_000 } });
    expect(row(reserveCard(pockets(b))!, "dam-cuoi")).toMatchObject({
      status: [{ text: `chờ chuyển về ${vnd("1.000.000")}`, tone: null }],
      details: [`Có ${vnd("0")} + đã chi ${vnd("1.000.000")} / cần ${vnd("1.000.000")}`, `Trả từ V chi tiêu ${vnd("1.200.000")} · chờ chuyển về ${vnd("1.000.000")}`],
    });
    const paid = goals({ "dam-cuoi": { spent: 1_000_000, over: 0, advance: 1_200_000, advanceFrom: ["V chi tiêu"], pendingRefund: 0 } });
    expect(row(reserveCard(pockets(paid))!, "dam-cuoi")).toMatchObject({ status: [], details: [`Có ${vnd("0")} + đã chi ${vnd("1.000.000")} / cần ${vnd("1.000.000")}`, `Trả từ V chi tiêu ${vnd("1.200.000")}`] });
    setAmountsHidden(true);
    const hidden = reserveCard(pockets(b))!;
    expect(row(hidden, "dam-cuoi")).toMatchObject({ amount: `••••• + ••••• / ${vnd("•••••")}`, pct: 100 });
    expect(row(hidden, "dam-cuoi").details[1]).toBe(`Trả từ V chi tiêu ${vnd("•••••")} · chờ chuyển về ${vnd("•••••")}`);
    expect(JSON.stringify(hidden.groups.map((x) => x.goals))).not.toMatch(/\d\.\d{3}/);
  });

  it("UC-707 AC-45: mục tiêu lặp 3 tháng hạn 10/02 chưa chốt — xem 11/02 → 'đã quá hạn 1 ngày'; xem 10/02 hay đã chốt → không; mục tiêu hằng tháng không có dòng quá hạn", () => {
    const nhaO = g("nha-o", "Nhà ở", { accountId: "mb", held: 22_500_000, need: 22_500_000, target: 22_500_000, monthly: 7_500_000, repeatMonths: 3, dueDate: "2027-02-10" });
    expect(row(reserveCard(pockets(goals(), [nhaO]), "2027-02-11")!, "nha-o").status).toEqual([{ text: "đã quá hạn 1 ngày", tone: "warn" }]);
    expect(row(reserveCard(pockets(goals(), [nhaO]), "2027-02-10")!, "nha-o").status).toEqual([]);
    expect(row(reserveCard(pockets(goals(), [{ ...nhaO, closed: true }]), "2027-02-11")!, "nha-o").status).toEqual([]);
    const monthly = goals({ "hoc-tap": { dueDate: "2026-11-05" } });
    expect(row(reserveCard(pockets(monthly), "2026-11-20")!, "hoc-tap").status).toEqual([]);
  });
});
