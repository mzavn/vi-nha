// Hàm thuần của lãi tiền gửi (change 261018-lai-tien-gui): nhận diện log lãi, chọn ví nhận lãi.
import { describe, expect, it } from "vitest";
import { interestWallet, isInterestLog } from "../src/domain/interest-deposit";

describe("isInterestLog: log lãi = tiền vào dưới ngưỡng, nội dung rỗng / BankAPINotify / cụm lãi", () => {
  const inLog = (amount: number, content: string | null) => ({ direction: "in", amount, content });

  it("UC-303: rỗng, BankAPINotify (mọi kiểu hoa thường, khoảng trắng), 'LAI TIEN GUI', 'Lãi không kỳ hạn', 'TRA LAI TIEN GUI' dưới 10.000 → lãi", () => {
    for (const c of [null, "", "   ", "BankAPINotify", " bankapinotify ", "LAI TIEN GUI THANG 10", "Lãi  không   kỳ hạn", "TRA LAI TIEN GUI"]) {
      expect(isInterestLog(inLog(37, c), 10_000)).toBe(true);
    }
  });

  it("UC-303: 'CHO THUE LAI P2', 'HOAN TRA LAI TIEN THUA', 'trả lại tiền', tiền ra, 10.000 trở lên, ngưỡng 0 → không phải lãi", () => {
    expect(isInterestLog(inLog(5_000, "CHO THUE LAI P2"), 10_000)).toBe(false);
    expect(isInterestLog(inLog(5_000, "HOAN TRA LAI TIEN THUA"), 10_000)).toBe(false);
    expect(isInterestLog(inLog(5_000, "trả lại tiền"), 10_000)).toBe(false);
    expect(isInterestLog({ direction: "out", amount: 37, content: null }, 10_000)).toBe(false);
    expect(isInterestLog(inLog(9_999, null), 10_000)).toBe(true);
    expect(isInterestLog(inLog(10_000, null), 10_000)).toBe(false);
    expect(isInterestLog(inLog(50_000, "BankAPINotify"), 10_000)).toBe(false);
    expect(isInterestLog(inLog(37, "BankAPINotify"), 0)).toBe(false);
  });
});

describe("interestWallet: ví nhận lãi của chính tài khoản", () => {
  const wallets = [
    { id: "income", tier: "holding" as const, accountId: "vcb" },
    { id: "rent", tier: "holding" as const, accountId: "vcb" },
    { id: "wb", tier: "wealth_building" as const, accountId: "tcb" },
    { id: "fun-a", tier: "nice" as const, accountId: "vcb" },
    { id: "fun-b", tier: "nice" as const, accountId: "vcb" },
    { id: "spend-wife", tier: "must" as const, accountId: "mb" },
    { id: "have", tier: "must" as const, accountId: "vcb" },
    { id: "reserve", tier: "holding" as const, accountId: "acb" },
    { id: "locked", tier: "nice" as const, accountId: "vib" },
    { id: "locked-b", tier: "must" as const, accountId: "ocb" },
  ];
  const streams = [
    { active: true, locks: [{ walletId: "rent", percent: 1 }] },
    { active: true, locks: [{ walletId: "locked", percent: 0.7 }, { walletId: "locked-b", percent: 0.3 }] },
    { active: true, locks: [{ walletId: "wb", percent: 0.45 }] },
  ];
  const rules = [{ walletId: "have", mode: "remainder" as const }];

  it("UC-303: tài khoản Tích sản (role) → Tích sản; đúng một ví → ví đó; nhiều ví, chỉ ví quỹ, chỉ ví khóa 100% của nguồn thu → Có thì tốt; không có Có thì tốt → null", () => {
    expect(interestWallet({ id: "mb", role: "buffer" }, wallets, streams, rules)).toBe("wb");
    expect(interestWallet({ id: "mb", role: null }, wallets, streams, rules)).toBe("spend-wife");
    expect(interestWallet({ id: "vcb", role: null }, wallets, streams, rules)).toBe("have");
    expect(interestWallet({ id: "acb", role: null }, wallets, streams, rules)).toBe("have");
    expect(interestWallet({ id: "vib", role: null }, wallets, streams, rules)).toBe("have");
    expect(interestWallet({ id: "vcb", role: null }, wallets, streams, [])).toBeNull();
  });

  it("UC-303: nguồn khóa trọn 100% chia hai ví 70/30 → loại cả hai ví; khóa một phần (Tích sản 45% của lương) → vẫn chọn; nguồn đã tắt không tính", () => {
    expect(interestWallet({ id: "vib", role: null }, wallets, streams, rules)).toBe("have");
    expect(interestWallet({ id: "ocb", role: null }, wallets, streams, rules)).toBe("have");
    expect(interestWallet({ id: "tcb", role: null }, wallets, streams, rules)).toBe("wb");
    expect(interestWallet({ id: "vib", role: null }, wallets, [{ active: false, locks: [{ walletId: "locked", percent: 1 }] }], rules)).toBe("locked");
  });
});
