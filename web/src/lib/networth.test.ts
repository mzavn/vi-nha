import { describe, expect, it } from "vitest";
import { netWorthLines } from "./networth";
import type { NetWorth } from "./types";

const NBSP = "\u00a0";
const vnd = (s: string) => s.replaceAll(" ₫", `${NBSP}₫`);

const nw = (extra: Partial<NetWorth> = {}): NetWorth => ({
  cash: 0,
  pockets: { savings: 0, reserve: 0, operating: 0, outside: 0 },
  savings: { accounts: [] },
  assets: 0,
  receivables: 0,
  tenants: 0,
  tenantsPrepaid: 0,
  debts: 0,
  netWorth: 0,
  balanceItems: 0,
  ...extra,
});

describe("khối tiền thật trước (tab Nợ)", () => {
  it("đủ mọi nhóm: tiền thật đầu tiên và là số hero, tài sản ròng cuối cùng và nhỏ hơn, nợ mang dấu âm", () => {
    const lines = netWorthLines(
      nw({
        cash: 50_000_000,
        pockets: { savings: 30_000_000, reserve: 10_000_000, operating: 10_000_000, outside: 0 },
        savings: { accounts: [{ id: "tcb", name: "Tài khoản tích luỹ", balance: 30_000_000 }] },
        assets: 20_000_000,
        receivables: 5_000_000,
        tenants: 3_000_000,
        tenantsPrepaid: 1_000_000,
        debts: 15_000_000,
        netWorth: 62_000_000,
      }),
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
    expect(lines[0]!.note).toBe(vnd("trong đó Tích luỹ 30.000.000 ₫ (Tài khoản tích luỹ 30.000.000 ₫)"));
    expect(lines.find((l) => l.key === "owedToUs")).toMatchObject({ value: 8_000_000, note: "chưa phải tiền" });
    expect(lines.find((l) => l.key === "weOwe")!.value).toBe(-16_000_000);
    expect(lines.at(-1)).toMatchObject({ label: "Vốn chủ sở hữu (tài sản ròng)", value: 62_000_000 });
  });

  it("ẩn dòng bằng 0: không tài sản, không ai nợ, không người thuê trả trước — vẫn giữ tiền thật và tài sản ròng", () => {
    const lines = netWorthLines(nw({ cash: 10_000_000, debts: 4_000_000, netWorth: 6_000_000 }));
    expect(lines.map((l) => l.key)).toEqual(["cash", "weOwe", "netWorth"]);
    expect(lines[0]!.note).toBeNull();
    // Người thuê trả trước bằng 0: không tách dòng Sổ nợ riêng.
    expect(lines.some((l) => l.key === "debts" || l.key === "tenantsPrepaid")).toBe(false);

    expect(netWorthLines(nw()).map((l) => l.key)).toEqual(["cash", "netWorth"]);
  });

  it("chỉ người thuê còn nợ: nhóm Người khác nợ mình kèm đúng một dòng chi tiết", () => {
    const lines = netWorthLines(nw({ cash: 1, tenants: 2_000_000, netWorth: 2_000_001 }));
    expect(lines.map((l) => l.key)).toEqual(["cash", "owedToUs", "tenants", "netWorth"]);
  });

  it("UC-1005 AC-6: dòng phụ \"trong đó Tích luỹ 1.012.000 ₫ (Heo đất chồng 7.000 ₫ · Heo đất vợ 5.000 ₫ · MB tiết kiệm (vợ) 1.000.000 ₫)\" — MB tiết kiệm là tài khoản ngăn Tích luỹ, không 'giữ riêng'; Tích luỹ 0 → không dòng phụ; mọi số 0 → chỉ dòng tiền thật", () => {
    const savings = {
      accounts: [
        { id: "piggy-bank-husband", name: "Heo đất chồng", balance: 7_000 },
        { id: "piggy-bank-wife", name: "Heo đất vợ", balance: 5_000 },
        { id: "mb-wife", name: "MB tiết kiệm (vợ)", balance: 1_000_000 },
      ],
    };
    const pockets = { savings: 1_012_000, reserve: 2_000_000, operating: 1_000_000, outside: 0 };
    const lines = netWorthLines(nw({ cash: 3_012_000, pockets, savings, netWorth: 3_012_000 }));
    expect(lines.map((l) => l.key)).toEqual(["cash", "netWorth"]);
    expect(lines[0]!.value).toBe(3_012_000);
    expect(lines[0]!.note).toBe(vnd("trong đó Tích luỹ 1.012.000 ₫ (Heo đất chồng 7.000 ₫ · Heo đất vợ 5.000 ₫ · MB tiết kiệm (vợ) 1.000.000 ₫)"));
    expect(lines[0]!.note).not.toMatch(/Tích sản|đã khóa|giữ riêng/);
    // Tích luỹ 0 (tài khoản Tích luỹ còn 0): không dòng phụ.
    const empty = { accounts: savings.accounts.map((a) => ({ ...a, balance: 0 })) };
    expect(netWorthLines(nw({ cash: 1_000_000, pockets: { ...pockets, savings: 0 }, savings: empty }))[0]!.note).toBeNull();
    expect(netWorthLines(nw()).map((l) => [l.key, l.note])).toEqual([
      ["cash", null],
      ["netWorth", expect.any(String)],
    ]);
  });

  it("UC-1005 AC-9 (hộ mẫu B): \"trong đó Tích luỹ 6.500.000 ₫ (Tài khoản tích luỹ 6.000.000 ₫ · Heo đất 500.000 ₫)\" bằng pockets.savings; không chữ \"Tích sản\", \"đã khóa\", \"giữ riêng\"", () => {
    const lines = netWorthLines(
      nw({
        cash: 50_800_000,
        pockets: { savings: 6_500_000, reserve: 38_000_000, operating: 4_100_000, outside: 200_000 },
        savings: {
          accounts: [
            { id: "tcb-husband", name: "tài khoản tích luỹ", balance: 6_000_000 },
            { id: "piggy", name: "heo đất", balance: 500_000 },
          ],
        },
        netWorth: 50_800_000,
      }),
    );
    expect(lines[0]!.note).toBe(vnd("trong đó Tích luỹ 6.500.000 ₫ (Tài khoản tích luỹ 6.000.000 ₫ · Heo đất 500.000 ₫)"));
    expect(lines[0]!.note).not.toMatch(/Tích sản|đã khóa|giữ riêng/);
  });

  it("UC-1005 AC-7, AC-8: dòng \"Tài sản mua qua app\" (= assets) rồi \"Tài sản ngoài app (vàng, đất…)\" (= balanceItems, ẩn khi 0); các dòng cộng lại đúng vốn chủ", () => {
    // buy_asset vàng 2.000.000 đã có mục "Vàng" gắn `gold` 126.000.000 → assets về 0, balanceItems 126.000.000.
    const lines = netWorthLines(nw({ cash: 30_000_000, assets: 0, balanceItems: 126_000_000, debts: 20_000_000, netWorth: 136_000_000 }));
    expect(lines.map((l) => l.key)).toEqual(["cash", "balanceItems", "weOwe", "netWorth"]);
    expect(lines.find((l) => l.key === "balanceItems")).toMatchObject({ level: "row", label: "Tài sản ngoài app (vàng, đất…)", value: 126_000_000 });
    const both = netWorthLines(nw({ cash: 1_000_000, assets: 1_000_000, balanceItems: 600_000_000, netWorth: 602_000_000 }));
    expect(both.map((l) => l.key)).toEqual(["cash", "assets", "balanceItems", "netWorth"]);
    expect(both.find((l) => l.key === "assets")!.label).toBe("Tài sản mua qua app");
    const sum = (ls: typeof lines) => ls.filter((l) => l.level === "hero" || l.level === "row").reduce((s, l) => s + l.value, 0);
    expect(sum(lines)).toBe(136_000_000);
    expect(sum(both)).toBe(602_000_000);
    // Bản cache cũ chưa có `balanceItems`: coi như 0, không hiện dòng.
    expect(netWorthLines({ ...nw({ cash: 5 }), balanceItems: undefined as unknown as number }).map((l) => l.key)).toEqual(["cash", "netWorth"]);
  });
});
