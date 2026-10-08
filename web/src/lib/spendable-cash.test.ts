import { describe, expect, it } from "vitest";
import type { SpendableCash } from "../../../src/domain/snapshot";
import { spendableCashView } from "./spendable-cash";

const NBSP = "\u00a0";
const sc = (over: Partial<SpendableCash> = {}): SpendableCash => ({ amount: 0, accounts: [], wealthBuildingHeld: 0, wealthBuildingOutside: 0, taxHeld: 0, excluded: [], ...over });
const acc = (accountId: string, name: string, balance: number) => ({ accountId, name, balance });

describe("Tiền chi được ở Hôm nay (ADR-85, ADR-88)", () => {
  it("kê từng tài khoản đang tính theo thứ tự server, rồi trừ Tích sản và Thuế đang giữ; câu Không tính gộp heo đất, kể phao theo tên, nói phần Tích sản không trừ lại", () => {
    const v = spendableCashView(
      sc({
        amount: 1_330_000,
        accounts: [acc("mb-spending-husband", "MB chi tiêu (chồng)", 3_200_000), acc("mb-spending-wife", "MB chi tiêu (vợ)", 230_000), acc("cash", "Tiền mặt", 500_000)],
        wealthBuildingHeld: 2_000_000,
        wealthBuildingOutside: 1_055_000,
        taxHeld: 600_000,
        excluded: [
          { accountId: "credit-card", name: "Thẻ tín dụng", role: null },
          { accountId: "piggy-bank-husband", name: "Heo đất MB (Chồng)", role: "piggy_bank" },
          { accountId: "piggy-bank-wife", name: "Heo đất MB (Vợ)", role: "piggy_bank" },
          { accountId: "buffer-wife", name: "MB tiết kiệm (vợ)", role: "buffer" },
        ],
      }),
      [],
    );
    expect(v.lines.map((l) => [l.key, l.label, l.value])).toEqual([
      ["acc:mb-spending-husband", "MB chi tiêu (chồng)", 3_200_000],
      ["acc:mb-spending-wife", "MB chi tiêu (vợ)", 230_000],
      ["acc:cash", "Tiền mặt", 500_000],
      ["wealthBuilding", "Trừ Tích sản đang giữ (phần chưa nằm ở heo / phao / sổ tiết kiệm)", -2_000_000],
      ["tax", "Trừ Thuế đang giữ", -600_000],
    ]);
    expect(v).toMatchObject({ amount: 1_330_000, short: false, meta: "Tiền thật trong các tài khoản đang tính, trừ phần Tích sản và Thuế phải giữ." });
    expect(v.excluded).toBe(`Không tính: Thẻ tín dụng, MB tiết kiệm (vợ), heo đất — trong đó 1.055.000${NBSP}₫ là Tích sản, không trừ lại`);
  });

  it("dòng trừ bằng 0 thì không hiện; không có Tích sản nằm ngoài thì chỉ kể tên, nhãn trừ Tích sản không kèm ngoặc; tính hết thì không có câu Không tính", () => {
    const v = spendableCashView(sc({ amount: 500_000, accounts: [acc("vcb", "VCB", 500_000)], excluded: [{ accountId: "piggy_bank", name: "Heo", role: "piggy_bank" }] }), []);
    expect(v.lines.map((l) => l.key)).toEqual(["acc:vcb"]);
    expect(v.excluded).toBe("Không tính: heo đất");
    expect(spendableCashView(sc({ accounts: [acc("vcb", "VCB", 0)] }), []).excluded).toBeNull();
    expect(spendableCashView(sc({ accounts: [acc("vcb", "VCB", 900_000)], wealthBuildingHeld: 400_000 }), []).lines[1]).toMatchObject({ label: "Trừ Tích sản đang giữ" });
  });

  it("âm: số to là phần thiếu (dương), câu nói rõ đang thiếu bao nhiêu", () => {
    const v = spendableCashView(sc({ amount: -250_000, accounts: [acc("vcb", "VCB", 750_000)], wealthBuildingHeld: 1_000_000 }), []);
    expect(v).toMatchObject({ amount: 250_000, short: true, meta: `Tiền trong các tài khoản đang tính chưa đủ giữ Tích sản và Thuế, thiếu 250.000${NBSP}₫.` });
  });

  it("tài khoản lệch đối soát thì có dòng phụ nhắc Đối soát; lệch bằng 0 / null hay tài khoản không tính thì không", () => {
    const v = spendableCashView(sc({ accounts: [acc("vcb", "VCB", 1), acc("tcb", "TCB", 2), acc("cash", "Tiền mặt", 3)] }), [
      { accountId: "vcb", name: "VCB", bookDrift: 50_000 },
      { accountId: "tcb", name: "TCB", bookDrift: 0 },
      { accountId: "mb", name: "MB", bookDrift: -20_000 },
    ]);
    expect(v.lines.map((l) => l.note)).toEqual(["sổ lệch — xem Đối soát", null, null]);
  });
});
