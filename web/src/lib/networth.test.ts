import { describe, expect, it } from "vitest";
import { netWorthLines } from "./networth";
import type { NetWorth } from "./types";

const NBSP = "\u00a0";

const nw = (extra: Partial<NetWorth> = {}): NetWorth => ({
  cash: 0,
  wealthBuildingCash: 0,
  wealthBuildingAccounts: { total: 0, accounts: [] },
  spendableThisWeek: 0,
  assets: 0,
  receivables: 0,
  tenants: 0,
  tenantsPrepaid: 0,
  debts: 0,
  netWorth: 0,
  ...extra,
});

describe("khối tiền thật trước (tab Nợ)", () => {
  it("đủ mọi nhóm: tiền thật đầu tiên và là số hero, tài sản ròng cuối cùng và nhỏ hơn, nợ mang dấu âm", () => {
    const lines = netWorthLines(
      nw({ cash: 50_000_000, wealthBuildingCash: 30_000_000, spendableThisWeek: 1_200_000, assets: 20_000_000, receivables: 5_000_000, tenants: 3_000_000, tenantsPrepaid: 1_000_000, debts: 15_000_000, netWorth: 62_000_000 }),
    );
    expect(lines.map((l) => `${l.level}:${l.key}`)).toEqual([
      "hero:cash",
      "row:assets",
      "row:owedToUs",
      "part:receivables",
      "part:tenants",
      "row:weOwe",
      "part:debts",
      "part:tenantsPrepaid",
      "total:netWorth",
    ]);
    expect(lines.filter((l) => l.level === "hero")).toHaveLength(1);
    expect(lines[0]!.note).toBe(`trong đó Tích sản 30.000.000${NBSP}₫ đã khóa · còn để chi tuần này 1.200.000${NBSP}₫`);
    expect(lines.find((l) => l.key === "owedToUs")).toMatchObject({ value: 8_000_000, note: "chưa phải tiền" });
    expect(lines.find((l) => l.key === "weOwe")!.value).toBe(-16_000_000);
    expect(lines.at(-1)).toMatchObject({ label: "Tài sản ròng", value: 62_000_000 });
  });

  it("ẩn dòng bằng 0: không tài sản, không ai nợ, không người thuê trả trước — vẫn giữ tiền thật và tài sản ròng", () => {
    const lines = netWorthLines(nw({ cash: 10_000_000, spendableThisWeek: 800_000, debts: 4_000_000, netWorth: 6_000_000 }));
    expect(lines.map((l) => l.key)).toEqual(["cash", "weOwe", "netWorth"]);
    // Không có phần Tích sản khóa thì dòng phụ chỉ nói còn để chi tuần này.
    expect(lines[0]!.note).toBe(`còn để chi tuần này 800.000${NBSP}₫`);
    // Người thuê trả trước bằng 0: không tách dòng Sổ nợ riêng.
    expect(lines.some((l) => l.key === "debts" || l.key === "tenantsPrepaid")).toBe(false);

    expect(netWorthLines(nw()).map((l) => l.key)).toEqual(["cash", "netWorth"]);
  });

  it("chỉ người thuê còn nợ: nhóm Người khác nợ mình kèm đúng một dòng chi tiết", () => {
    const lines = netWorthLines(nw({ cash: 1, tenants: 2_000_000, netWorth: 2_000_001 }));
    expect(lines.map((l) => l.key)).toEqual(["cash", "owedToUs", "tenants", "netWorth"]);
  });

  it("heo, phao, sổ tiết kiệm là chỗ tiền Tích sản đang nằm: nói là một phần của Tích sản (tổng kèm từng tài khoản), không kể thêm lần nữa (ADR-82, ADR-88)", () => {
    const wealthBuildingAccounts = {
      total: 1_012_000,
      accounts: [
        { accountId: "piggy-bank-husband", name: "Heo đất MB (Chồng)", role: "piggy_bank" as const, memberId: "husband", memberName: "Chồng", balance: 7_000 },
        { accountId: "piggy-bank-wife", name: "Heo đất MB (Vợ)", role: "piggy_bank" as const, memberId: "wife", memberName: "Vợ", balance: 5_000 },
        { accountId: "buffer-wife", name: "MB tiết kiệm (vợ)", role: "buffer" as const, memberId: "wife", memberName: "Vợ", balance: 1_000_000 },
      ],
    };
    const by = `Heo đất Chồng 7.000${NBSP}₫ · Heo đất Vợ 5.000${NBSP}₫ · Phao dự phòng · MB tiết kiệm (vợ) 1.000.000${NBSP}₫`;
    const lines = netWorthLines(nw({ cash: 3_012_000, wealthBuildingCash: 1_500_000, wealthBuildingAccounts, spendableThisWeek: 100_000, netWorth: 3_012_000 }));
    expect(lines.map((l) => l.key)).toEqual(["cash", "netWorth"]);
    expect(lines[0]!.value).toBe(3_012_000);
    expect(lines[0]!.note).toBe(`trong đó Tích sản 1.500.000${NBSP}₫ đã khóa (gồm 1.012.000${NBSP}₫ ở tài khoản Tích sản: ${by}) · còn để chi tuần này 100.000${NBSP}₫`);
    // Nhiều hơn Tích sản (tiền có từ trước khi dùng app): kể riêng; rỗng thì không nhắc.
    expect(netWorthLines(nw({ wealthBuildingCash: 10_000, wealthBuildingAccounts, spendableThisWeek: 0 }))[0]!.note).toBe(
      `trong đó Tích sản 10.000${NBSP}₫ đã khóa, Tài khoản Tích sản 1.012.000${NBSP}₫ (${by}) · còn để chi tuần này 0${NBSP}₫`,
    );
    expect(netWorthLines(nw({ wealthBuildingAccounts, spendableThisWeek: 0 }))[0]!.note).toBe(`trong đó Tài khoản Tích sản 1.012.000${NBSP}₫ (${by}) · còn để chi tuần này 0${NBSP}₫`);
    expect(netWorthLines(nw({ wealthBuildingAccounts: { total: 0, accounts: wealthBuildingAccounts.accounts.map((a) => ({ ...a, balance: 0 })) } }))[0]!.note).toBe(`còn để chi tuần này 0${NBSP}₫`);
  });
});
