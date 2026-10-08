import { describe, expect, it } from "vitest";
import { draftFromTx, editedAt, editForm, editToast, txActions, voidConfirm, voidToast, withChosen } from "./transactions";
import type { TxRow } from "./types";

const NBSP = "\u00a0";

const tx = (over: Partial<TxRow> = {}): TxRow => ({
  id: 7,
  at: "2026-09-20T05:00:00.000Z",
  amount: 45_000,
  meaning: "spend",
  status: "active",
  wallet_id: null,
  counter_wallet_id: "food",
  account_id: "cash-husband",
  counter_account_id: null,
  category_id: "groceries",
  asset_kind: null,
  note: null,
  category_name: "Đi chợ",
  source: "manual",
  log_id: null,
  ...over,
});

describe("việc làm được với một giao dịch", () => {
  it("ghi tay: sửa và xoá được", () => {
    for (const meaning of ["spend", "income", "refund", "transfer", "buy_asset", "lend", "collect"]) {
      expect(txActions(tx({ meaning }))).toEqual({ edit: true, remove: true, reassign: false, note: null });
    }
  });

  it("từ ngân hàng: không sửa không xoá, chỉ gán lại — kể cả khi chỉ có log_id", () => {
    expect(txActions(tx({ source: "sepay", log_id: "L1" }))).toMatchObject({ edit: false, remove: false, reassign: true, note: expect.stringContaining("chỉ gán lại") });
    expect(txActions(tx({ source: "manual", log_id: "L1" })).reassign).toBe(true);
  });

  it("hệ thống (chốt tháng, nạp ví của lần chia): chỉ xem, nói vì sao", () => {
    expect(txActions(tx({ source: "system", meaning: "transfer" }))).toMatchObject({ edit: false, remove: false, reassign: false, note: expect.stringContaining("hệ thống") });
    expect(txActions(tx({ source: "system", meaning: "fund" })).note).toContain("xoá khoản thu");
  });

  it("điều chỉnh sau đếm ví: chỉ xoá; khoản đã xoá: không làm gì nữa", () => {
    expect(txActions(tx({ meaning: "adjust" }))).toMatchObject({ edit: false, remove: true, reassign: false });
    expect(txActions(tx({ status: "void" }))).toMatchObject({ edit: false, remove: false, reassign: false, note: expect.stringContaining("đã xoá") });
  });

  it("form sửa: khoản chi ở màn Nhập, chuyển chỉ giữa hai ví ở Chuyển ngân sách, còn lại đúng loại của nó", () => {
    expect(editForm(tx())).toBe("spend");
    expect(editForm(tx({ meaning: "transfer", account_id: null, wallet_id: "food", counter_wallet_id: "nice-to-have" }))).toBe("move");
    expect(editForm(tx({ meaning: "transfer", account_id: "vcb-husband", counter_account_id: "cash-husband" }))).toBe("transfer");
    expect(editForm(tx({ meaning: "lend" }))).toBe("lend");
  });
});

describe("điền sẵn form sửa từ dòng sổ (quy ước dấu)", () => {
  it("khoản chi: ví bị trừ thành ví chọn, tài khoản tiền ra, giữ khoản nợ; ngày theo giờ VN", () => {
    const d = draftFromTx(tx({ at: "2026-09-20T18:30:00.000Z", debt_id: "co-lan", note: "trả cô Lan" }));
    expect(d).toMatchObject({ amount: 45_000, day: "2026-09-21", wallet_id: "food", account_id: "cash-husband", category_id: "groceries", debt_id: "co-lan", note: "trả cô Lan" });
  });

  it("thu nhập: tài khoản tiền vào, thuế, nguồn thu, người thuê", () => {
    const d = draftFromTx(
      tx({ meaning: "income", wallet_id: "income", counter_wallet_id: null, account_id: null, counter_account_id: "vcb-husband", taxable: 1, income_stream_id: "rental", tenant_id: "chi-lan" }),
    );
    expect(d).toMatchObject({ account_id: "vcb-husband", taxable: true, income_stream_id: "rental", tenant_id: "chi-lan" });
  });

  it("hoàn tiền: ví được cộng, tài khoản tiền về, nối về khoản chi gốc", () => {
    const d = draftFromTx(tx({ meaning: "refund", wallet_id: "food", counter_wallet_id: null, account_id: null, counter_account_id: "cash-husband", link_id: 3 }));
    expect(d).toMatchObject({ wallet_id: "food", account_id: "cash-husband", link_id: 3 });
  });

  it("chuyển nội bộ kèm ví và chuyển ngân sách: nguồn là ví bị trừ, đích là ví được cộng", () => {
    expect(draftFromTx(tx({ meaning: "transfer", account_id: "vcb-husband", counter_account_id: "tcb-husband", wallet_id: "travel", counter_wallet_id: "nice-to-have" }))).toMatchObject({
      account_id: "vcb-husband",
      to_account_id: "tcb-husband",
      wallet_id: "travel",
      from_wallet_id: "nice-to-have",
    });
    expect(draftFromTx(tx({ meaning: "transfer", account_id: null, wallet_id: "food", counter_wallet_id: "nice-to-have" }))).toMatchObject({ account_id: null, to_account_id: null, wallet_id: "food", from_wallet_id: "nice-to-have" });
  });

  it("cho vay / nhận lại: tài khoản theo chiều tiền, giữ khoản phải thu; mua tài sản giữ loại tài sản", () => {
    expect(draftFromTx(tx({ meaning: "lend", counter_wallet_id: null, account_id: "vcb-husband", receivable_id: "em-hai" }))).toMatchObject({ account_id: "vcb-husband", receivable_id: "em-hai", wallet_id: null });
    expect(draftFromTx(tx({ meaning: "collect", counter_wallet_id: null, account_id: null, counter_account_id: "vcb-husband", receivable_id: "em-hai" }))).toMatchObject({ account_id: "vcb-husband", receivable_id: "em-hai" });
    expect(draftFromTx(tx({ meaning: "buy_asset", counter_wallet_id: null, wallet_id: "wealth-building", account_id: null, asset_kind: "gold" }))).toMatchObject({ asset_kind: "gold", account_id: null });
  });

  it("giờ ghi khi sửa: không đổi ngày thì giữ đúng giờ cũ, đổi ngày thì 12:00 ngày đó", () => {
    const now = new Date("2026-10-02T03:00:00.000Z");
    expect(editedAt("2026-09-21", "2026-09-20T18:30:00.000Z", now)).toBe("2026-09-20T18:30:00.000Z");
    expect(editedAt("2026-09-25", "2026-09-20T18:30:00.000Z", now)).toBe("2026-09-25T05:00:00.000Z");
    expect(editedAt("2026-10-02", "2026-09-20T18:30:00.000Z", now)).toBe(now.toISOString());
  });

  it("danh sách chọn giữ lựa chọn đang gắn dù nó không nằm trong danh sách mặc định", () => {
    const list = [{ id: "food" }, { id: "transport" }];
    expect(withChosen(list, "fun-wife", () => ({ id: "fun-wife" })).map((w) => w.id)).toEqual(["food", "transport", "fun-wife"]);
    expect(withChosen(list, "food", () => ({ id: "x" }))).toBe(list);
    expect(withChosen(list, null, () => ({ id: "x" }))).toBe(list);
    expect(withChosen(list, "mat", () => undefined)).toBe(list);
  });
});

describe("câu xác nhận và toast sau khi sửa / xoá", () => {
  const status = { walletId: "food", name: "Ăn uống", balance: 300_000, weekRemaining: 300_000, monthRemaining: 900_000 };

  it("xoá: nói số tiền, khoản gì, và ví còn bao nhiêu", () => {
    expect(voidToast(tx(), status)).toBe(`Đã xoá 45.000${NBSP}₫ Đi chợ. Ăn uống còn 300.000${NBSP}₫ tuần này.`);
    expect(voidToast(tx({ category_name: null, meaning: "lend" }), null)).toBe(`Đã xoá 45.000${NBSP}₫ Cho vay.`);
  });

  it("xoá khoản thu đã chia: hỏi lại có nói lần chia cũng được gỡ, toast nói đã gỡ", () => {
    const income = tx({ meaning: "income", category_name: null, allocated: 1, amount: 10_000_000 });
    expect(voidConfirm(income)).toContain("Lần chia của khoản này cũng được gỡ");
    expect(voidConfirm(tx({ meaning: "income", allocated: 0 }))).toBe("Xoá hẳn khoản này?");
    expect(voidToast(income, null)).toBe(`Đã xoá 10.000.000${NBSP}₫ Thu nhập. Đã gỡ lần chia.`);
  });

  it("sửa: nói số mới và ví còn bao nhiêu; chuyển chỉ giữa hai ví gọi là chuyển ngân sách", () => {
    expect(editToast(tx({ amount: 120_000, category_name: "Xăng xe" }), { ...status, name: "Đi lại", weekRemaining: 830_000 })).toBe(
      `Đã sửa thành 120.000${NBSP}₫ Xăng xe. Đi lại còn 830.000${NBSP}₫ tuần này.`,
    );
    expect(editToast(tx({ meaning: "transfer", category_name: null, account_id: null, wallet_id: "food", counter_wallet_id: "nice-to-have" }), null)).toBe(
      `Đã sửa thành 45.000${NBSP}₫ Chuyển ngân sách.`,
    );
  });
});
