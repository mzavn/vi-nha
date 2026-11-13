import { afterEach, describe, expect, it } from "vitest";
import { pocketsView } from "../../../src/domain/pockets";
import { nearSpend, topUpView, type NearSpend } from "../../../src/domain/snapshot";
import { nearSpendB, nearSpendV23, pocketsB, pocketsV23, TOP_UP_TARGET } from "./household-b.fixture";
import { setAmountsHidden } from "./money";
import { MONEY_AGE_NOTE, monthAmountBody, nearSpendCard } from "./near-spend";

const NBSP = "\u00a0";
const TODAY = "2026-11-11";

afterEach(() => setAmountsHidden(false));

describe("thẻ Vận hành ở Hôm nay (ADR-122)", () => {
  it("UC-702 AC-16: hộ mẫu B → số chính chi khoảng mỗi ngày, dòng phụ 'còn {tổng} · {n} ngày tới lương', hai ô bữa ăn / đi chợ, ở tài khoản ngăn Vận hành; không chữ công tắc", () => {
    const p = pocketsB();
    const v = nearSpendCard(nearSpendB(p), TODAY, p);
    expect(v).toMatchObject({
      days: "29 ngày tới lương 10/12",
      noAccounts: false,
      amount: `4.100.000${NBSP}₫`,
      big: "Chi khoảng 141.000/ngày",
      perDay: "141.000/ngày",
      out: false,
      sub: "nếu không có gì đột xuất",
      meals: [{ label: "Ăn 2 bữa · mỗi bữa", value: "dưới 70.000" }, { label: "Đi chợ 1 lần/ngày", value: "tối đa 140.000" }],
      source: "Ở tài khoản chính, tài khoản chi tiêu, thẻ tín dụng",
      unconfirmed: null,
      pending: null,
      age: null,
      payday: null,
    });
    expect(JSON.stringify(v)).not.toMatch(/Tính vào tiền vận hành|đang giữ ví Tích sản/);
  });

  it("UC-702 AC-16: nhà một tài khoản → 'Còn' đúng số dư tài khoản, không dòng trừ giữ riêng; 2 tài khoản chưa xác nhận → chip", () => {
    const p = pocketsView({
      accounts: [
        { id: "main", name: "tài khoản chính", pocket: "operating", confirmed: false, balance: 12_000_000 },
        { id: "other", name: "khác", pocket: null, confirmed: false, balance: 0 },
      ],
      goals: [{ id: "tuition", name: "Học phí", accountId: null, target: 6_000_000, targetPct: null, monthly: null, repeatMonths: null, dueDate: null, debtId: null, sort: 100, spent: 0 }],
      rewardAccountId: null,
      debts: [],
      savingsPct: 10,
      history: { since: "2026-11-10", prevSince: "2026-10-10", accounts: [] },
      operatingSpend: { months: [], dataStart: null },
      peaceTarget: 6,
    });
    const v = nearSpendCard(nearSpend(p.operating, [{ id: "main", name: "tài khoản chính", pocket: "operating" }], TODAY, 10, { salaryPayday: null, pendingTasks: 0 }), TODAY, p);
    expect(v.amount).toBe(`12.000.000${NBSP}₫`);
    expect(v.source).toBe("Ở tài khoản chính");
    expect(JSON.stringify(v)).not.toMatch(/giữ riêng|để riêng/);
    expect(v.unconfirmed).toBe("2 tài khoản chưa xác nhận ngăn");
  });

  it("UC-702 AC-16: hết tiền −250.000 → số âm đỏ và câu hết tiền; còn 20.000 → chưa tới 1.000 ₫/ngày; không tài khoản ngăn Vận hành → chỉ một câu, không 0 ₫, không đỏ", () => {
    const out = nearSpendCard({ ...nearSpendB(), amount: -250_000 }, TODAY, pocketsB());
    expect(out).toMatchObject({ amount: `−250.000${NBSP}₫`, out: true, big: "Tiền vận hành đã hết, còn 29 ngày tới ngày lương", perDay: null, sub: null, meals: [] });
    expect(nearSpendCard({ ...nearSpendB(), amount: 20_000 }, TODAY, pocketsB())).toMatchObject({ amount: `20.000${NBSP}₫`, out: false, big: `Chưa tới 1.000${NBSP}₫/ngày`, perDay: null, sub: null, meals: [] });
    const none = nearSpendCard({ ...nearSpendB(), amount: 0, accounts: [] }, TODAY, pocketsB());
    expect(none).toMatchObject({ noAccounts: true, amount: null, big: null, out: false, meals: [], source: "Chưa có tài khoản nào ở ngăn Vận hành" });
    expect(nearSpendCard(nearSpendB(), "2026-12-10", pocketsB())).toMatchObject({ days: "31 ngày tới lương 10/1", payday: "Hôm nay là ngày lương, lương về số sẽ tăng" });
  });

  it("UC-702 AC-16: che số → ••••• ₫ và Chi khoảng •••••/ngày; không còn dòng lệnh chuyển", () => {
    expect(JSON.stringify(nearSpendCard(nearSpendB(), TODAY, pocketsB()))).not.toMatch(/lệnh chuyển|leaving/);
    setAmountsHidden(true);
    const hidden = nearSpendCard(nearSpendB(), TODAY, pocketsB());
    expect([hidden.amount, hidden.big]).toEqual([`•••••${NBSP}₫`, "Chi khoảng •••••/ngày"]);
    expect(hidden.meals.map((m) => m.value)).toEqual(["dưới •••••", "tối đa •••••"]);
  });

  it("UC-103 AC-26: 12/12, Vận hành 21.200.000, nhắc ① 2.000.000 chưa chuyển, khoản phải trả còn 3.500.000 → '29 ngày tới lương 10/1', 'Chi khoảng 541.000/ngày', dòng 'Chưa chuyển theo nhắc'; 5/1 lương về sớm (salaryPayday 10/1) → PWA tính lại còn 36 ngày (tới 10/2); không lương sớm → tới 10/1", () => {
    const ns = { ...nearSpendB(), amount: 21_200_000, salaryPayday: null, pendingTasks: 2_000_000, goalRemaining: 3_500_000 };
    const v = nearSpendCard(ns, "2026-12-12", pocketsB());
    expect(v).toMatchObject({ days: "29 ngày tới lương 10/1", amount: `21.200.000${NBSP}₫`, big: "Chi khoảng 541.000/ngày" });
    expect(v.pending).toBe(`Chưa chuyển theo nhắc: 2.000.000${NBSP}₫, chi khoảng tính trên phần còn lại`);
    const early = { ...ns, salaryPayday: "2027-01-10" };
    expect(nearSpendCard(early, "2027-01-05", pocketsB()).days).toBe("36 ngày tới lương 10/2");
    // Hết cửa sổ lương sớm (hôm nay ≥ salaryPayday) → theo hôm nay như thường.
    expect(nearSpendCard(early, "2027-01-10", pocketsB()).days).toBe("31 ngày tới lương 10/2");
    expect(nearSpendCard({ ...ns, salaryPayday: null }, "2027-01-05", pocketsB()).days).toBe("5 ngày tới lương 10/1");
    expect(nearSpendCard(nearSpendB(), TODAY, pocketsB())).toMatchObject({ pending: null });
    expect(JSON.stringify(v)).not.toMatch(/kỳ lương|trễ|việc ngày lương/);
  });

  it("UC-702 AC-25: lương về sớm 4/12 (salaryPayday 10/12), hôm nay 4/12 → '37 ngày tới lương 10/1', chi khoảng tính trên phần trừ nhắc chưa chuyển; bản lưu thiếu salaryPayday / pendingTasks → như không lương sớm", () => {
    const ns = { ...nearSpendB(), amount: 21_200_000, salaryPayday: "2026-12-10", pendingTasks: 6_160_000 };
    expect(nearSpendCard(ns, "2026-12-04", pocketsB())).toMatchObject({ days: "37 ngày tới lương 10/1", amount: `21.200.000${NBSP}₫`, big: "Chi khoảng 406.000/ngày" });
    const { salaryPayday: _c, pendingTasks: _p, ...old } = ns;
    expect(nearSpendCard(old as typeof ns, "2026-12-04", pocketsB())).toMatchObject({ days: "6 ngày tới lương 10/12", pending: null });
  });

  it("UC-702 AC-41: tuổi tiền 12 ngày → hàng 'Tuổi tiền' '12 ngày', chú thích 'Đủ 30 ngày là nhà đang sống bằng lương tháng trước'; từ 30 ngày → 'Đủ đệm một tháng'; moneyAge null → không hàng; số chính không đổi", () => {
    const p = pocketsB();
    const base = nearSpendCard(nearSpendB(p), TODAY, p);
    const v = nearSpendCard(nearSpendB(p), TODAY, p, null, { days: 12, sample: 10, buffered: false });
    expect(v.age).toEqual({ value: "12 ngày", note: MONEY_AGE_NOTE });
    expect(MONEY_AGE_NOTE).toBe("Đủ 30 ngày là nhà đang sống bằng lương tháng trước");
    expect([v.amount, v.big]).toEqual([base.amount, base.big]);
    expect(nearSpendCard(nearSpendB(p), TODAY, p, null, { days: 32, sample: 10, buffered: true }).age).toEqual({ value: "32 ngày", note: "Đủ đệm một tháng, nhà đang sống bằng lương tháng trước" });
    expect(base.age).toBeNull();
  });

  it("UC-702 AC-17: nợ ngắn hạn 8.000.000 (2 khoản), đã có 1.000.000 ₫ trong tài khoản Trả nợ; Sắp tới Vay người thân; số chính không đổi", () => {
    const v = nearSpendCard(nearSpendB(), TODAY, pocketsB());
    expect(v.debt).toEqual({ value: `8.000.000${NBSP}₫`, sub: `2 khoản · đã có 1.000.000${NBSP}₫ trong tài khoản Trả nợ`, next: `Sắp tới: Vay người thân trả 1.000.000${NBSP}₫ ngày 15` });
    expect([v.amount, v.perDay, v.blessing]).toEqual([`4.100.000${NBSP}₫`, "141.000/ngày", null]);
    // 20/11: không khoản nào có ngày ≥ 20 → khoản đầu có ngày.
    expect(nearSpendCard(nearSpendB(), "2026-11-20", pocketsB()).debt?.next).toBe(`Sắp tới: Vay người thân trả 1.000.000${NBSP}₫ ngày 15`);
  });

  it("UC-702 AC-17: bỏ mục tiêu Trả nợ → không 'đã có'; chỉ còn khoản không ngày trả → không dòng Sắp tới", () => {
    const base = pocketsB();
    const noGoal = pocketsB({ goals: [] });
    expect(nearSpendCard(nearSpendB(noGoal), TODAY, noGoal).debt).toEqual({ value: `8.000.000${NBSP}₫`, sub: "2 khoản", next: `Sắp tới: Vay người thân trả 1.000.000${NBSP}₫ ngày 15` });
    const onlyInstallment = { ...base, shortDebt: { total: 3_000_000, count: 1, items: base.shortDebt.items.filter((d) => d.id === "installment") } };
    expect(nearSpendCard(nearSpendB(), TODAY, onlyInstallment).debt).toEqual({ value: `3.000.000${NBSP}₫`, sub: "1 khoản", next: null });
  });

  it("UC-702 AC-17: không còn nợ ngắn hạn (hay chưa từng có nợ) → lời chúc xoay theo ngày, không dòng nợ; che số → số nợ thành •••••, lời chúc giữ nguyên", () => {
    const free = { ...pocketsB(), shortDebt: { total: 0, count: 0, items: [] } };
    const days = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
    expect(days.map((d) => nearSpendCard(nearSpendB(), d, free).blessing)).toEqual([
      "Không còn nợ ngắn hạn — tiền vận hành là của mình trọn vẹn",
      "Sạch nợ ngắn hạn — mỗi đồng chi hôm nay là tiền của mình",
      "Không nợ ngắn hạn nào. Giữ nhịp này nhé",
      "Hết nợ ngắn hạn — tháng này nhẹ hẳn",
      "Không còn nợ ngắn hạn — tiền vận hành là của mình trọn vẹn",
    ]);
    expect(nearSpendCard(nearSpendB(), TODAY, free).debt).toBeNull();
    setAmountsHidden(true);
    expect(nearSpendCard(nearSpendB(), TODAY, pocketsB()).debt).toMatchObject({ value: `•••••${NBSP}₫`, sub: `2 khoản · đã có •••••${NBSP}₫ trong tài khoản Trả nợ` });
    expect(nearSpendCard(nearSpendB(), TODAY, free).blessing).toBe("Không còn nợ ngắn hạn — tiền vận hành là của mình trọn vẹn");
  });

  it("UC-702 AC-33: Vận hành 15.000.000, còn 20 ngày, R 3.500.000 → 'Chi khoảng 575.000/ngày' và hàng 'Khoản phải trả tháng này' 'còn 3.500.000 ₫' · '4 khoản chưa trả xong', danh sách 'còn / mỗi tháng' + 'đã trả'; trả đủ → 'đã trả đủ'; không mục tiêu → không hàng; che số", () => {
    const p = pocketsV23();
    const v = nearSpendCard(nearSpendV23(p), "2026-11-20", p);
    expect(v).toMatchObject({ days: "20 ngày tới lương 10/12", amount: `15.000.000${NBSP}₫`, big: "Chi khoảng 575.000/ngày" });
    expect(v.reserved).toEqual({
      value: `còn 3.500.000${NBSP}₫`,
      note: "4 khoản chưa trả xong",
      done: false,
      items: [
        { id: "dien-nuoc", title: `Điện nước · còn 1.000.000 / 2.000.000${NBSP}₫`, spent: `đã trả 1.000.000${NBSP}₫` },
        { id: "thuoc", title: `Thuốc · còn 500.000 / 500.000${NBSP}₫`, spent: `đã trả 0${NBSP}₫` },
        { id: "thien-phuoc", title: `Thiện phước · còn 1.000.000 / 1.000.000${NBSP}₫`, spent: `đã trả 0${NBSP}₫` },
        { id: "ve-que", title: `Về quê · còn 1.000.000 / 1.000.000${NBSP}₫`, spent: `đã trả 0${NBSP}₫` },
      ],
    });
    // n = số khoản còn phải trả: Về quê trả đủ → 3 khoản.
    const three = pocketsV23({ spent: { "dien-nuoc": 1_000_000, "ve-que": 1_000_000 } });
    expect(nearSpendCard(nearSpendV23(three), "2026-11-20", three).reserved!).toMatchObject({ value: `còn 2.500.000${NBSP}₫`, note: "3 khoản chưa trả xong" });
    // Chi đủ 3.500.000 gắn các khoản (Vận hành 11.500.000) → R 0, số mỗi ngày vẫn 575.000.
    const paid = pocketsV23({ operating: [{ id: "tk-chi-tieu-chong", name: "MB chi tiêu chồng", balance: 11_500_000 }], spent: { "dien-nuoc": 2_000_000, thuoc: 500_000, "thien-phuoc": 1_000_000, "ve-que": 1_000_000 } });
    const after = nearSpendCard(nearSpendV23(paid), "2026-11-20", paid);
    expect(after.big).toBe("Chi khoảng 575.000/ngày");
    expect(after.reserved).toMatchObject({ value: "đã trả đủ", note: null, done: true });
    expect(nearSpendCard(nearSpendB(), TODAY, pocketsB()).reserved).toBeNull();
    // Bản lưu cũ thiếu operating.goals / goalRemaining: không dòng, số mỗi ngày như trước.
    const { goals: _g, ...oldOperating } = p.operating;
    const { goalRemaining: _r, ...oldNs } = nearSpendV23(p);
    const old = nearSpendCard(oldNs as NearSpend, "2026-11-20", { ...p, operating: oldOperating as typeof p.operating });
    expect([old.reserved, old.big]).toEqual([null, "Chi khoảng 750.000/ngày"]);
    setAmountsHidden(true);
    const hidden = nearSpendCard(nearSpendV23(p), "2026-11-20", p);
    expect(hidden.reserved!.value).toBe(`còn •••••${NBSP}₫`);
    expect(JSON.stringify(hidden)).not.toMatch(/\d\.\d{3}/);
  });

  it("UC-702 AC-37: Điện nước tháng này 500.000 'Tháng này ít' → 'Điện nước · còn 500.000 / 500.000 ₫' + 'tháng này 500.000 ₫ · mỗi tháng 2.000.000 ₫ · Tháng này ít'; Về quê tháng này 0 → 'tháng này 0 ₫ · mỗi tháng 1.000.000 ₫'; đã trả đủ vẫn có danh sách để mở; thân PUT /v1/goal-month-amounts { amount, note } (lý do rỗng → null), về số mỗi tháng { amount: null }", () => {
    const month = { "dien-nuoc": { amount: 500_000, note: "Tháng này ít" }, "ve-que": { amount: 0, note: null } };
    const p = pocketsV23({ spent: {}, month });
    const v = nearSpendCard(nearSpendV23(p), "2026-11-20", p).reserved!;
    expect([v.value, v.note]).toEqual([`còn 2.000.000${NBSP}₫`, "3 khoản chưa trả xong"]);
    expect(v.items[0]).toEqual({ id: "dien-nuoc", title: `Điện nước · còn 500.000 / 500.000${NBSP}₫`, spent: `đã trả 0${NBSP}₫`, month: `tháng này 500.000${NBSP}₫ · mỗi tháng 2.000.000${NBSP}₫ · Tháng này ít` });
    expect(v.items[1]!.month).toBeUndefined();
    expect(v.items[3]).toMatchObject({ title: `Về quê · còn 0 / 0${NBSP}₫`, month: `tháng này 0${NBSP}₫ · mỗi tháng 1.000.000${NBSP}₫` });
    expect(JSON.stringify(v)).not.toMatch(/kỳ/);
    const paid = pocketsV23({ spent: { "dien-nuoc": 500_000, thuoc: 500_000, "thien-phuoc": 1_000_000 }, month });
    const done = nearSpendCard(nearSpendV23(paid), "2026-11-20", paid).reserved!;
    expect(done).toMatchObject({ value: "đã trả đủ", done: true });
    expect(done.items).toHaveLength(4);
    expect(monthAmountBody(300_000, "  ")).toEqual({ amount: 300_000, note: null });
    expect(monthAmountBody(300_000, " Ít khách ")).toEqual({ amount: 300_000, note: "Ít khách" });
    expect(monthAmountBody(null, "bỏ")).toEqual({ amount: null, note: null });
  });

  it("UC-702 AC-33: thiếu tiền chi tiêu → khối 'Tiền chi tiêu sắp không đủ: cần chuyển thêm 2.500.000 ₫', 'từ BIDV (Ví Thưởng) 2.000.000 ₫' rồi 'từ Phao 500.000 ₫' có Mở QR; chỉ tiền mặt → không QR, 'Chuyển vào tiền chi tiêu'; nguồn không đủ → 'chưa có nguồn'; che số", () => {
    const p = pocketsV23({ operating: [{ id: "tk-chi-tieu-chong", name: "MB chi tiêu chồng", balance: 1_000_000 }] });
    const ns = nearSpendV23(p);
    const base = { amount: ns.amount, pendingTasks: 0, month: null, goalRemaining: p.operating.remaining, pockets: p, target: TOP_UP_TARGET };
    const topUp = topUpView(base);
    expect(nearSpendCard(ns, "2026-11-20", p, topUp).topUp).toEqual({
      title: `Tiền chi tiêu sắp không đủ: cần chuyển thêm 2.500.000${NBSP}₫`,
      sources: [
        { accountId: "tk-bidv", text: `từ BIDV (Ví Thưởng) 2.000.000${NBSP}₫`, qr: true },
        { accountId: "phao", text: `từ Phao 500.000${NBSP}₫`, qr: true },
      ],
      hint: null,
      missing: null,
    });
    const cash = nearSpendCard(ns, "2026-11-20", p, topUpView({ ...base, target: null })).topUp!;
    expect(cash.sources.map((s) => s.qr)).toEqual([false, false]);
    expect(cash.hint).toBe("Chuyển vào tiền chi tiêu");
    const short = nearSpendCard(ns, "2026-11-20", p, { amount: 4_000_000, sources: topUp!.sources, toAccountId: TOP_UP_TARGET.accountId, target: TOP_UP_TARGET }).topUp!;
    expect(short.missing).toBe(`1.500.000${NBSP}₫ chưa có nguồn`);
    expect(nearSpendCard(ns, "2026-11-20", p, null).topUp).toBeNull();
    expect(nearSpendCard(ns, "2026-11-20", p).topUp).toBeNull();
    // Tên tài khoản Ví Thưởng đã có chữ "Ví Thưởng" → không lặp lại.
    const named = { ...topUp!, sources: [{ ...topUp!.sources[0]!, name: "MB Ví Thưởng" }] };
    expect(nearSpendCard(ns, "2026-11-20", p, named).topUp!.sources[0]!.text).toBe(`từ MB Ví Thưởng 2.000.000${NBSP}₫`);
    setAmountsHidden(true);
    const hidden = nearSpendCard(ns, "2026-11-20", p, topUp).topUp!;
    expect(hidden.title).toBe(`Tiền chi tiêu sắp không đủ: cần chuyển thêm •••••${NBSP}₫`);
    expect(hidden.sources[0]!.text).toBe(`từ BIDV (Ví Thưởng) •••••${NBSP}₫`);
  });
});
