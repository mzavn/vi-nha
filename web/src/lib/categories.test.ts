import { describe, expect, it } from "vitest";
import { defaultAccountFor, defaultBankFor, manualAccounts, topCategories } from "./categories";
import type { AccountRef, CategoryRef } from "./types";

const cat = (id: string, sort: number): CategoryRef => ({ id, name: id, icon: null, sort, groupId: null });

const acct = (id: string, kind: AccountRef["kind"], ownerMemberId: string | null, over: Partial<Pick<AccountRef, "sepayEnabled" | "sepayOut" | "pocket" | "feedFrom" | "sepayOutFrom" | "private" | "hiddenFromMe">> = {}): AccountRef => ({
  id,
  name: id,
  pocket: null,
  kind,
  ownerMemberId,
  sepayEnabled: false,
  sepayOut: false,
  openedAt: null,
  feedFrom: null,
  sepayOutFrom: null,
  private: false,
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

describe("tự điền tài khoản", () => {
  const boot = {
    accounts: [acct("vcb-husband", "bank", "husband"), acct("vcb-wife", "bank", "wife"), acct("cash-husband", "cash", "husband"), acct("cash-wife", "cash", "wife")],
  };

  it("vợ nhập khoản chi → tài khoản Tiền mặt (vợ)", () => {
    expect(defaultAccountFor(boot, "wife", "out")).toBe("cash-wife");
  });

  it("tài khoản nhận thu nhập mặc định là ngân hàng của người đang nhập", () => {
    expect(defaultBankFor(boot.accounts, "wife")).toBe("vcb-wife");
    expect(defaultBankFor(boot.accounts, null)).toBe("vcb-husband");
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
    // UC-506 AC-26: khoản trước mốc theo dõi SePay nhập tay được — chọn ngày trước mốc thì tài khoản đã nối hiện lại.
    const late = [acct("mb-wife", "bank", "wife", { sepayEnabled: true, sepayOut: true, feedFrom: "2026-10-15T15:25:00.000Z", sepayOutFrom: null })];
    expect(manualAccounts(late, "in", "2026-10-12").map((a) => a.id)).toEqual(["mb-wife"]);
    expect(manualAccounts(late, "out", "2026-10-12").map((a) => a.id)).toEqual(["mb-wife"]);
    expect(manualAccounts(late, "in", "2026-10-15").map((a) => a.id)).toEqual([]);
    expect(manualAccounts(late, "in").map((a) => a.id)).toEqual([]);
    const outLater = [acct("mb-wife", "bank", "wife", { sepayEnabled: true, sepayOut: true, feedFrom: null, sepayOutFrom: "2026-10-20T03:00:00.000Z" })];
    expect(manualAccounts(outLater, "out", "2026-10-18").map((a) => a.id)).toEqual(["mb-wife"]);
    expect(manualAccounts(outLater, "in", "2026-10-18").map((a) => a.id)).toEqual([]);
    // mặc định không bao giờ rơi vào tài khoản mà chiều đó tự về
    expect(defaultAccountFor({ accounts }, "wife", "in")).toBe("bidv-husband");
    expect(defaultAccountFor({ accounts: accounts.slice(1) }, "wife", "out")).toBe("bidv-husband");
  });

  it("nhà dùng chung một ví tiền mặt (không gắn chủ) thì ai nhập cũng mặc định vào ví đó, không rơi sang ngân hàng", () => {
    const accounts = [acct("bidv-husband", "bank", "husband"), acct("cash", "cash", null)];
    expect(defaultAccountFor({ accounts }, "husband", "out")).toBe("cash");
    expect(defaultAccountFor({ accounts }, "wife", "in")).toBe("cash");
  });

  it("UC-703 AC-15: ưu tiên tài khoản ngăn Vận hành — heo đất (Tích luỹ, xếp trước) không bao giờ là mặc định khi người nhập có tiền mặt Vận hành; không tài khoản Vận hành nào → tài khoản đầu tiên nhập tay được", () => {
    const accounts = [
      acct("piggy-bank-husband", "cash", "husband", { pocket: "savings" }),
      acct("a-buffer-husband", "bank", "husband", { pocket: "reserve" }),
      acct("cash-husband", "cash", "husband", { pocket: "operating" }),
      acct("bidv-husband", "bank", "husband", { pocket: "operating" }),
      acct("vcb-husband", "bank", "husband", { pocket: "operating", sepayEnabled: true }),
    ];
    expect(defaultAccountFor({ accounts }, "husband", "out")).toBe("cash-husband");
    expect(defaultAccountFor({ accounts }, "husband", "in")).toBe("cash-husband");
    // Không có tiền mặt Vận hành → tài khoản Vận hành của người nhập, không rơi về heo đất / phao.
    const noCash = accounts.filter((a) => a.id !== "cash-husband");
    expect(defaultAccountFor({ accounts: noCash }, "husband", "out")).toBe("bidv-husband");
    expect(defaultBankFor(manualAccounts(noCash, "in"), "husband")).toBe("bidv-husband");
    // AC-3 giữ: tài khoản Vận hành duy nhất tự về tiền vào → không mặc định vào đó, về luật cũ.
    const onlyFeed = [acct("a-buffer-husband", "bank", "husband", { pocket: "reserve" }), acct("vcb-husband", "bank", "husband", { pocket: "operating", sepayEnabled: true })];
    expect(defaultAccountFor({ accounts: onlyFeed }, "husband", "in")).toBe("a-buffer-husband");
    // Không tài khoản Vận hành nào → tài khoản đầu tiên nhập tay được.
    const none = [acct("piggy-bank-husband", "bank", "husband", { pocket: "savings" }), acct("a-buffer-husband", "bank", "husband", { pocket: "reserve" })];
    expect(defaultAccountFor({ accounts: none }, "husband", "out")).toBe("piggy-bank-husband");
    expect(defaultBankFor(none, "husband")).toBe("piggy-bank-husband");
  });

  it("UC-703 AC-16: bootstrap của chồng (hộ mẫu P) — ô tài khoản khi Nhập chi, Chuyển (từ / tới) và tài khoản chọn sẵn không có Tiền mặt (vợ), VCB (vợ); bootstrap của vợ → có", () => {
    const view = (hidden: boolean) => [
      acct("vcb-husband", "bank", "husband", { pocket: "operating", sepayEnabled: true }),
      acct("cash-husband", "cash", "husband", { pocket: "operating" }),
      acct("mb-husband", "bank", "husband", { pocket: "operating" }),
      acct("vcb-wife", "bank", "wife", { pocket: "operating", sepayEnabled: true, private: true, hiddenFromMe: hidden }),
      acct("cash-wife", "cash", "wife", { pocket: "operating", private: true, hiddenFromMe: hidden }),
    ];
    const husband = view(true);
    expect(manualAccounts(husband, "out").map((a) => a.id)).toEqual(["vcb-husband", "cash-husband", "mb-husband"]);
    expect(manualAccounts(husband, "in").map((a) => a.id)).toEqual(["cash-husband", "mb-husband"]);
    // Chồng chọn "của vợ" làm người nhập (ví dụ máy chung) vẫn không rơi vào tài khoản bị giấu.
    expect(defaultAccountFor({ accounts: husband }, "wife", "out")).toBe("cash-husband");
    expect(defaultAccountFor({ accounts: husband.filter((a) => a.pocket !== "operating" || a.hiddenFromMe) }, "wife", "out")).toBeNull();
    const wife = view(false);
    expect(manualAccounts(wife, "out").map((a) => a.id)).toContain("cash-wife");
    expect(manualAccounts(wife, "out").map((a) => a.id)).toContain("vcb-wife");
    expect(manualAccounts(wife, "in").map((a) => a.id)).toContain("cash-wife");
    expect(defaultAccountFor({ accounts: wife }, "wife", "out")).toBe("cash-wife");
  });
});
