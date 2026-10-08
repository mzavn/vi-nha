import { describe, expect, it } from "vitest";
import { defaultAccountFor, defaultBankFor, defaultWalletFor, manualAccounts, spendableWallets, topCategories, walletOfMember } from "./categories";
import type { AccountRef, CategoryRef, Wallet } from "./types";

const cat = (id: string, sort: number, defaultWalletId: string | null = null): CategoryRef => ({ id, name: id, defaultWalletId, icon: null, sort });

const wallet = (id: string, over: Partial<Wallet> = {}): Wallet => ({
  id,
  name: id,
  tier: "must",
  mustGroup: "must",
  kind: "envelope",
  scope: "shared",
  memberId: null,
  accountId: null,
  private: false,
  sort: 0,
  hidden: false,
  ...over,
});

const acct = (id: string, kind: AccountRef["kind"], ownerMemberId: string | null, over: Partial<Pick<AccountRef, "sepayEnabled" | "sepayOut" | "locked" | "role">> = {}): AccountRef => ({
  id,
  name: id,
  kind,
  ownerMemberId,
  sepayEnabled: false,
  sepayOut: false,
  openedAt: null,
  locked: false,
  role: null,
  ...over,
});

describe("6 danh mục hay dùng nhất", () => {
  const cats = [cat("a", 1), cat("b", 2), cat("c", 3), cat("d", 4), cat("e", 5), cat("f", 6), cat("g", 7), cat("h", 8)];

  it("tần suất 30 ngày lên đầu, lấy đúng 6", () => {
    const top = topCategories(cats, { h: 9, g: 5, a: 1 });
    expect(top.map((c) => c.id)).toEqual(["h", "g", "a", "b", "c", "d"]);
  });

  it("chưa có dữ liệu thì theo thứ tự cấu hình", () => {
    expect(topCategories(cats, {}).map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("hoà tần suất thì theo sort", () => {
    expect(topCategories(cats, { f: 3, c: 3, b: 1 }, 3).map((c) => c.id)).toEqual(["c", "f", "b"]);
  });

  it("không sửa mảng gốc", () => {
    const copy = cats.map((c) => c.id);
    topCategories(cats, { h: 9 });
    expect(cats.map((c) => c.id)).toEqual(copy);
  });
});

describe("tự điền ví và tài khoản", () => {
  const boot = {
    wallets: [
      wallet("fun-husband", { tier: "nice", mustGroup: null, scope: "personal", memberId: "husband" }),
      wallet("fun-wife", { tier: "nice", mustGroup: null, scope: "personal", memberId: "wife" }),
      wallet("transport"),
      wallet("income", { tier: "holding", kind: "holding" }),
      wallet("wealth-building", { tier: "wealth_building", kind: "accrual" }),
      wallet("rental-income", { tier: "holding", mustGroup: null, kind: "accrual" }),
    ],
    categories: [cat("hangouts", 1, "fun-husband"), cat("ride-hailing", 2, "transport"), cat("other", 3, null)],
    accounts: [acct("vcb-husband", "bank", "husband"), acct("vcb-wife", "bank", "wife"), acct("cash-husband", "cash", "husband"), acct("cash-wife", "cash", "wife")],
  };

  it("vợ chọn Tụ tập / cà phê → ví Chơi (vợ), tài khoản Tiền mặt (vợ)", () => {
    expect(defaultWalletFor(boot, boot.categories[0]!, "wife")?.id).toBe("fun-wife");
    expect(defaultAccountFor(boot, "wife", "out")).toBe("cash-wife");
  });

  it("chồng giữ ví của mình, ví chung không đổi", () => {
    expect(defaultWalletFor(boot, boot.categories[0]!, "husband")?.id).toBe("fun-husband");
    expect(defaultWalletFor(boot, boot.categories[1]!, "wife")?.id).toBe("transport");
    expect(defaultWalletFor(boot, boot.categories[2]!, "wife")).toBeNull();
  });

  it("hoàn tiền cho khoản chi gốc ở ví cá nhân người kia → điền ví cùng phe của người đang nhập (đúng ví server sẽ ghi)", () => {
    expect(walletOfMember(boot, "fun-husband", "wife")?.id).toBe("fun-wife");
    expect(walletOfMember(boot, "transport", "wife")?.id).toBe("transport");
    expect(walletOfMember(boot, "khong-co", "wife")).toBeNull();
    expect(walletOfMember(boot, null, "wife")).toBeNull();
  });

  it("tài khoản nhận thu nhập mặc định là ngân hàng của người đang nhập", () => {
    expect(defaultBankFor(boot.accounts, "wife")).toBe("vcb-wife");
    expect(defaultBankFor(boot.accounts, null)).toBe("vcb-husband");
  });

  it("danh sách ví chi được: bỏ Thu nhập, Tích sản, ví cá nhân người kia; ví giữ riêng chi được (trả nợ)", () => {
    expect(spendableWallets(boot.wallets, "wife").map((w) => w.id)).toEqual(["fun-wife", "transport", "rental-income"]);
  });
});

describe("tài khoản nhập tay được", () => {
  it("chiều tiền SePay báo về thì ẩn: tiền vào ẩn mọi tài khoản đã nối; tiền ra chỉ ẩn tài khoản SePay báo cả tiền ra", () => {
    const accounts = [
      acct("mb-husband", "bank", "husband", { sepayEnabled: true }),
      acct("sacom-husband", "bank", "husband", { sepayEnabled: true, sepayOut: true }),
      acct("bidv-husband", "bank", "husband"),
    ];
    expect(manualAccounts(accounts, "in").map((a) => a.id)).toEqual(["bidv-husband"]);
    expect(manualAccounts(accounts, "out").map((a) => a.id)).toEqual(["mb-husband", "bidv-husband"]);
    // mặc định không bao giờ rơi vào tài khoản mà chiều đó tự về
    expect(defaultAccountFor({ wallets: [], categories: [], accounts }, "wife", "in")).toBe("bidv-husband");
    expect(defaultAccountFor({ wallets: [], categories: [], accounts: accounts.slice(1) }, "wife", "out")).toBe("bidv-husband");
  });

  it("nhà dùng chung một ví tiền mặt (không gắn chủ) thì ai nhập cũng mặc định vào ví đó, không rơi sang ngân hàng", () => {
    const accounts = [acct("bidv-husband", "bank", "husband"), acct("cash", "cash", null)];
    expect(defaultAccountFor({ wallets: [], categories: [], accounts }, "husband", "out")).toBe("cash");
    expect(defaultAccountFor({ wallets: [], categories: [], accounts }, "wife", "in")).toBe("cash");
  });

  it("tài khoản Tích sản (heo đất, phao — ADR-88) không bao giờ là mặc định khi còn tài khoản khác, dù tên đứng trước", () => {
    const accounts = [
      acct("piggy-bank-husband", "bank", "husband", { locked: true, role: "piggy_bank" }),
      acct("a-buffer-husband", "bank", "husband", { role: "buffer" }),
      acct("bidv-husband", "bank", "husband"),
      acct("vcb-husband", "bank", "husband", { sepayEnabled: true }),
    ];
    expect(defaultBankFor(manualAccounts(accounts, "in"), "husband")).toBe("bidv-husband");
    expect(defaultAccountFor({ wallets: [], categories: [], accounts }, "husband", "in")).toBe("bidv-husband");
    expect(defaultBankFor([acct("piggy-bank-husband", "bank", "husband", { locked: true, role: "piggy_bank" })], "husband")).toBe("piggy-bank-husband");
  });
});
