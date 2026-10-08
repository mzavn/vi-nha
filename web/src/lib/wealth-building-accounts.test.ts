import { describe, expect, it } from "vitest";
import { openingCreditHint, wealthBuildingAccountLabel, wealthBuildingMoveHint } from "./wealth-building-accounts";
import type { AccountRef } from "./types";

const acct = (id: string, name: string, role: AccountRef["role"] = null): AccountRef => ({
  id,
  name,
  kind: "bank",
  ownerMemberId: "wife",
  sepayEnabled: false,
  sepayOut: false,
  openedAt: null,
  locked: role === "piggy_bank" || role === "term_deposit",
  role,
});
const accounts = [acct("mb-spending-husband", "MB chi tiêu (chồng)"), acct("cash", "Tiền mặt"), acct("buffer", "MB tiết kiệm (vợ)", "buffer"), acct("term-deposit", "Sổ 6 tháng", "term_deposit"), acct("piggy_bank", "Heo đất MB (Vợ)", "piggy_bank")];

describe("chuyển nội bộ vào tài khoản Tích sản (ADR-88)", () => {
  it("từ tài khoản thường vào phao / sổ / heo: nhắc tiền vào là Tích sản, ví Có thì tốt chuyển sang Tích sản", () => {
    expect(wealthBuildingMoveHint(accounts, "mb-spending-husband", "buffer")).toBe("Tiền vào MB tiết kiệm (vợ) là Tích sản: ghi xong, ví Có thì tốt chuyển sang Tích sản (như bỏ heo đất).");
    expect(wealthBuildingMoveHint(accounts, "cash", "term-deposit")).toContain("Tiền vào Sổ 6 tháng là Tích sản");
    expect(wealthBuildingMoveHint(accounts, "mb-spending-husband", "piggy_bank")).not.toBeNull();
  });

  it("rút ra, gửi phao → sổ, tất toán sổ → phao, chuyển giữa hai tài khoản thường, chưa chọn tài khoản: không nhắc (chỉ đổi chỗ)", () => {
    expect(wealthBuildingMoveHint(accounts, "buffer", "mb-spending-husband")).toBeNull();
    expect(wealthBuildingMoveHint(accounts, "buffer", "term-deposit")).toBeNull();
    expect(wealthBuildingMoveHint(accounts, "term-deposit", "buffer")).toBeNull();
    expect(wealthBuildingMoveHint(accounts, "mb-spending-husband", "cash")).toBeNull();
    expect(wealthBuildingMoveHint(accounts, null, "buffer")).toBeNull();
    expect(wealthBuildingMoveHint(accounts, "mb-spending-husband", null)).toBeNull();
  });

  it("tên gọi: heo theo người, phao và sổ theo tên tài khoản", () => {
    expect(wealthBuildingAccountLabel({ role: "piggy_bank", name: "Heo đất MB (Vợ)", memberName: "Vợ" })).toBe("Heo đất Vợ");
    expect(wealthBuildingAccountLabel({ role: "buffer", name: "MB tiết kiệm (vợ)", memberName: "Vợ" })).toBe("Phao dự phòng · MB tiết kiệm (vợ)");
    expect(wealthBuildingAccountLabel({ role: "term_deposit", name: "Sổ 6 tháng", memberName: null })).toBe("Sổ tiết kiệm · Sổ 6 tháng");
  });
});

describe("số dư có sẵn khi thành tài khoản Tích sản (ADR-91)", () => {
  it("thêm phao / sổ có số dư, hay đổi tài khoản thường có tiền sang phao: nhắc số đó vào Tích sản; đã là tài khoản Tích sản, vẫn tính vào tiền chi được, hay không có tiền thì không nhắc", () => {
    const base = { wasRole: false, role: "buffer" as const, spendable: false, balance: 10_000 };
    expect(openingCreditHint(base)).toBe(
      "Số dư hiện có 10.000\u00a0₫ sẽ được tính vào Tích sản — một lần, không trừ ví nào; phần Tích sản đang nằm ở tài khoản thường coi như đã chuyển vào đây.",
    );
    expect(openingCreditHint({ ...base, role: "term_deposit" })).not.toBeNull();
    expect(openingCreditHint({ ...base, wasRole: true })).toBeNull();
    expect(openingCreditHint({ ...base, role: null })).toBeNull();
    expect(openingCreditHint({ ...base, spendable: true })).toBeNull();
    expect(openingCreditHint({ ...base, balance: 0 })).toBeNull();
  });
});
