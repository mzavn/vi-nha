import { afterEach, describe, expect, it } from "vitest";
import { pocketsView } from "../../../src/domain/pockets";
import { nearSpend } from "../../../src/domain/snapshot";
import { nearSpendB, pocketsB } from "./household-b.fixture";
import { setAmountsHidden } from "./money";
import { nearSpendCard } from "./near-spend";

const NBSP = "\u00a0";
const TODAY = "2026-11-11";

afterEach(() => setAmountsHidden(false));

describe("thẻ Vận hành ở Hôm nay (ADR-122)", () => {
  it("UC-702 AC-16: hộ mẫu B → kỳ lương, hai số to (tổng rồi chi khoảng mỗi ngày), bữa ăn / đi chợ, ở tài khoản ngăn Vận hành; không chữ công tắc", () => {
    const p = pocketsB();
    const v = nearSpendCard(nearSpendB(p), TODAY, p);
    expect(v).toMatchObject({
      head: "Vận hành tới kỳ lương 10/12 · còn 29 ngày",
      noAccounts: false,
      amount: `4.100.000${NBSP}₫`,
      big: "Chi khoảng 141.000/ngày",
      perDay: "141.000/ngày",
      out: false,
      sub: "nếu không có gì đột xuất",
      meals: ["Ăn 2 bữa: dưới 70.000/bữa", "Đi chợ 1 lần/ngày: không quá 140.000"],
      source: "Ở tài khoản chính, tài khoản chi tiêu, thẻ tín dụng",
      unconfirmed: null,
      late: null,
      pending: null,
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
      operatingSpend: { cycles: [], dataStart: null },
      peaceTarget: 6,
    });
    const v = nearSpendCard(nearSpend(p.operating, [{ id: "main", name: "tài khoản chính", pocket: "operating" }], TODAY, 10, { cyclePayday: null, pendingTasks: 0 }), TODAY, p);
    expect(v.amount).toBe(`12.000.000${NBSP}₫`);
    expect(v.source).toBe("Ở tài khoản chính");
    expect(JSON.stringify(v)).not.toMatch(/giữ riêng|để riêng/);
    expect(v.unconfirmed).toBe("2 tài khoản chưa xác nhận ngăn");
  });

  it("UC-702 AC-16: hết tiền −250.000 → số âm đỏ và câu hết tiền; còn 20.000 → chưa tới 1.000 ₫/ngày; không tài khoản ngăn Vận hành → chỉ một câu, không 0 ₫, không đỏ", () => {
    const out = nearSpendCard({ ...nearSpendB(), amount: -250_000 }, TODAY, pocketsB());
    expect(out).toMatchObject({ amount: `−250.000${NBSP}₫`, out: true, big: "Tiền vận hành đã hết — còn 29 ngày tới kỳ lương", perDay: null, sub: null, meals: [] });
    expect(nearSpendCard({ ...nearSpendB(), amount: 20_000 }, TODAY, pocketsB())).toMatchObject({ amount: `20.000${NBSP}₫`, out: false, big: `Chưa tới 1.000${NBSP}₫/ngày`, perDay: null, sub: null, meals: [] });
    const none = nearSpendCard({ ...nearSpendB(), amount: 0, accounts: [] }, TODAY, pocketsB());
    expect(none).toMatchObject({ noAccounts: true, amount: null, big: null, out: false, meals: [], source: "Chưa có tài khoản nào ở ngăn Vận hành" });
    expect(nearSpendCard(nearSpendB(), "2026-12-10", pocketsB())).toMatchObject({ head: "Vận hành tới kỳ lương 10/1 · còn 31 ngày", payday: "Hôm nay là ngày lương — lương về số sẽ tăng" });
  });

  it("UC-702 AC-16: che số → •••• ₫ và Chi khoảng ••••/ngày; không còn dòng lệnh chuyển", () => {
    expect(JSON.stringify(nearSpendCard(nearSpendB(), TODAY, pocketsB()))).not.toMatch(/lệnh chuyển|leaving/);
    setAmountsHidden(true);
    const hidden = nearSpendCard(nearSpendB(), TODAY, pocketsB());
    expect([hidden.amount, hidden.big]).toEqual([`••••${NBSP}₫`, "Chi khoảng ••••/ngày"]);
    expect(hidden.meals).toEqual(["Ăn 2 bữa: dưới ••••/bữa", "Đi chợ 1 lần/ngày: không quá ••••"]);
  });

  it("UC-702 AC-23: sau lương 21.200.000, việc chưa làm 5.960.000, hôm nay 10/11 → 'Chi khoảng 508.000/ngày' và dòng 'Chưa làm theo việc ngày lương'; 12/12 chưa có lương → dòng trễ 2 ngày; chưa có kỳ → không hai dòng", () => {
    const ns = { ...nearSpendB(), amount: 21_200_000, cyclePayday: "2026-11-10", pendingTasks: 5_960_000 };
    const v = nearSpendCard(ns, "2026-11-10", pocketsB());
    expect(v).toMatchObject({ head: "Vận hành tới kỳ lương 10/12 · còn 30 ngày", amount: `21.200.000${NBSP}₫`, big: "Chi khoảng 508.000/ngày", late: null });
    expect(v.pending).toBe(`Chưa làm theo việc ngày lương: 5.960.000${NBSP}₫ — chi khoảng tính trên phần còn lại`);
    expect(nearSpendCard(ns, "2026-12-12", pocketsB()).late).toBe("Lương dự kiến 10/12 chưa về (trễ 2 ngày)");
    expect(nearSpendCard(ns, "2026-12-10", pocketsB()).late).toBeNull();
    expect(nearSpendCard(nearSpendB(), TODAY, pocketsB())).toMatchObject({ late: null, pending: null });
  });

  it("UC-702 AC-25: lương về sớm (kỳ ngày lương 10/12), hôm nay 4/12 → 'Vận hành tới kỳ lương 10/1 · còn 37 ngày', chi khoảng tính trên phần trừ việc chưa làm", () => {
    const ns = { ...nearSpendB(), amount: 21_200_000, cyclePayday: "2026-12-10", pendingTasks: 6_160_000 };
    expect(nearSpendCard(ns, "2026-12-04", pocketsB())).toMatchObject({ head: "Vận hành tới kỳ lương 10/1 · còn 37 ngày", amount: `21.200.000${NBSP}₫`, big: "Chi khoảng 406.000/ngày", late: null });
    // Bản lưu cũ thiếu cyclePayday / pendingTasks: như chưa có kỳ.
    const { cyclePayday: _c, pendingTasks: _p, ...old } = ns;
    expect(nearSpendCard(old as typeof ns, "2026-12-04", pocketsB())).toMatchObject({ head: "Vận hành tới kỳ lương 10/12 · còn 6 ngày", pending: null });
  });

  it("UC-702 AC-17: nợ ngắn hạn 8.000.000 (2 khoản), đã có 1.000.000 ₫ trong tài khoản Trả nợ; Sắp tới Vay người thân; hai số to không đổi", () => {
    const v = nearSpendCard(nearSpendB(), TODAY, pocketsB());
    expect(v.debt).toEqual({ line: `Nợ ngắn hạn còn 8.000.000${NBSP}₫ (2 khoản) · đã có 1.000.000${NBSP}₫ trong tài khoản Trả nợ`, next: `Sắp tới: Vay người thân trả 1.000.000${NBSP}₫ ngày 15` });
    expect([v.amount, v.perDay, v.blessing]).toEqual([`4.100.000${NBSP}₫`, "141.000/ngày", null]);
    // 20/11: không khoản nào có ngày ≥ 20 → khoản đầu có ngày.
    expect(nearSpendCard(nearSpendB(), "2026-11-20", pocketsB()).debt?.next).toBe(`Sắp tới: Vay người thân trả 1.000.000${NBSP}₫ ngày 15`);
  });

  it("UC-702 AC-17: bỏ mục tiêu Trả nợ → không 'đã có'; chỉ còn khoản không ngày trả → không dòng Sắp tới", () => {
    const base = pocketsB();
    const noGoal = pocketsB({ goals: [] });
    expect(nearSpendCard(nearSpendB(noGoal), TODAY, noGoal).debt).toEqual({ line: `Nợ ngắn hạn còn 8.000.000${NBSP}₫ (2 khoản)`, next: `Sắp tới: Vay người thân trả 1.000.000${NBSP}₫ ngày 15` });
    const onlyInstallment = { ...base, shortDebt: { total: 3_000_000, count: 1, items: base.shortDebt.items.filter((d) => d.id === "installment") } };
    expect(nearSpendCard(nearSpendB(), TODAY, onlyInstallment).debt).toEqual({ line: `Nợ ngắn hạn còn 3.000.000${NBSP}₫ (1 khoản)`, next: null });
  });

  it("UC-702 AC-17: không còn nợ ngắn hạn (hay chưa từng có nợ) → lời chúc xoay theo ngày, không dòng nợ; che số → số nợ thành ••••, lời chúc giữ nguyên", () => {
    const free = { ...pocketsB(), shortDebt: { total: 0, count: 0, items: [] } };
    const days = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
    expect(days.map((d) => nearSpendCard(nearSpendB(), d, free).blessing)).toEqual([
      "Không còn nợ ngắn hạn 🎉 — tiền vận hành là của mình trọn vẹn",
      "Sạch nợ ngắn hạn — mỗi đồng chi hôm nay là tiền của mình",
      "Không nợ ngắn hạn nào. Giữ nhịp này nhé 👏",
      "Hết nợ ngắn hạn — tháng này nhẹ hẳn",
      "Không còn nợ ngắn hạn 🎉 — tiền vận hành là của mình trọn vẹn",
    ]);
    expect(nearSpendCard(nearSpendB(), TODAY, free).debt).toBeNull();
    setAmountsHidden(true);
    expect(nearSpendCard(nearSpendB(), TODAY, pocketsB()).debt?.line).toBe(`Nợ ngắn hạn còn ••••${NBSP}₫ (2 khoản) · đã có ••••${NBSP}₫ trong tài khoản Trả nợ`);
    expect(nearSpendCard(nearSpendB(), TODAY, free).blessing).toBe("Không còn nợ ngắn hạn 🎉 — tiền vận hành là của mình trọn vẹn");
  });
});
