import { describe, expect, it } from "vitest";
import { draftFromTx, editedAt, editForm, editToast, isLegacyTx, legacyRows, txActions, txLabel, voidConfirm, voidToast, withChosen } from "./transactions";
import type { Bootstrap, TxRow } from "./types";

const NBSP = "\u00a0";

const tx = (over: Partial<TxRow> = {}): TxRow => ({
  id: 7,
  at: "2026-09-20T05:00:00.000Z",
  amount: 45_000,
  meaning: "spend",
  status: "active",
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

/** Bootstrap không có tài khoản riêng tư nào bị giấu: luật sửa / xoá như thường. */
const open: Pick<Bootstrap, "accounts" | "members"> = { accounts: [], members: [] };

describe("việc làm được với một giao dịch", () => {
  it("ghi tay: sửa và xoá được", () => {
    for (const meaning of ["spend", "income", "refund", "transfer", "buy_asset", "lend", "collect"]) {
      expect(txActions(tx({ meaning }), open)).toEqual({ edit: true, remove: true, reassign: false, note: null });
    }
  });

  it("từ ngân hàng: không sửa không xoá, chỉ gán lại — kể cả khi chỉ có log_id", () => {
    expect(txActions(tx({ source: "sepay", log_id: "L1" }), open)).toMatchObject({ edit: false, remove: false, reassign: true, note: expect.stringContaining("chỉ gán lại") });
    expect(txActions(tx({ source: "manual", log_id: "L1" }), open).reassign).toBe(true);
    // UC-305 AC-27: khoản chuyển nhập tay đã nối log tiền vào (chân nhận, log_id_2) cũng là giao dịch ngân hàng
    expect(txActions(tx({ source: "manual", meaning: "transfer", log_id: null, log_id_2: "L2" }), open)).toMatchObject({ edit: false, remove: false, reassign: true });
  });

  it("hệ thống (chốt tháng, nạp ví của lần chia): chỉ xem, nói vì sao", () => {
    expect(txActions(tx({ source: "system", meaning: "transfer" }), open)).toMatchObject({ edit: false, remove: false, reassign: false, note: expect.stringContaining("hệ thống") });
    expect(txActions(tx({ source: "system", meaning: "fund" }), open).note).toContain("xoá khoản thu");
  });

  it("điều chỉnh sau đếm ví: chỉ xoá; khoản đã xoá: không làm gì nữa", () => {
    expect(txActions(tx({ meaning: "adjust" }), open)).toMatchObject({ edit: false, remove: true, reassign: false });
    expect(txActions(tx({ status: "void" }), open)).toMatchObject({ edit: false, remove: false, reassign: false, note: expect.stringContaining("đã xoá") });
  });

  it("form sửa: khoản chi ở màn Nhập, còn lại đúng loại của nó; chuyển cũ chỉ giữa hai ví → chỉ xoá, không sửa", () => {
    expect(editForm(tx())).toBe("spend");
    expect(editForm(tx({ meaning: "transfer", account_id: "vcb-husband", counter_account_id: "cash-husband" }))).toBe("transfer");
    expect(editForm(tx({ meaning: "lend" }))).toBe("lend");
    const walletMove = tx({ meaning: "transfer", account_id: null, category_name: null });
    expect(txActions(walletMove, open)).toMatchObject({ edit: false, remove: true, reassign: false, note: expect.stringContaining("cách tính cũ") });
    expect(txLabel(walletMove)).toBe("Chuyển ngân sách");
  });

  it("UC-715 AC-16: chồng mở sheet #102 (chuyển Tiền mặt (chồng) → Tiền mặt (vợ), hộ mẫu P) → không Sửa / Xoá / Gỡ gán, có dòng 'Liên quan tài khoản riêng tư của Vợ — chỉ chủ tài khoản sửa được'; vợ mở → đủ nút như thường", () => {
    const t102 = tx({ id: 102, meaning: "transfer", amount: 1_000_000, account_id: "cash-husband", counter_account_id: "cash-wife", category_id: null, category_name: null });
    const members = [
      { id: "husband", name: "Chồng" },
      { id: "wife", name: "Vợ" },
    ] as Bootstrap["members"];
    const account = (id: string, owner: string, hiddenFromMe: boolean) => ({ id, name: id, ownerMemberId: owner, private: owner === "wife", hiddenFromMe }) as Bootstrap["accounts"][number];
    const husband = { members, accounts: [account("cash-husband", "husband", false), account("cash-wife", "wife", true)] };
    const wife = { members, accounts: [account("cash-husband", "husband", false), account("cash-wife", "wife", false)] };
    expect(txActions(t102, husband)).toEqual({ edit: false, remove: false, reassign: false, note: "Liên quan tài khoản riêng tư của Vợ — chỉ chủ tài khoản sửa được" });
    // Giao dịch ngân hàng chạm tài khoản đó cũng không gỡ gán được.
    expect(txActions({ ...t102, source: "sepay", log_id: "L7" }, husband)).toMatchObject({ edit: false, remove: false, reassign: false });
    expect(txActions(t102, wife)).toEqual({ edit: true, remove: true, reassign: false, note: null });
  });
});

describe("giao dịch cũ \"cách tính cũ\" (UC-715, UC-716)", () => {
  it("UC-716 AC-21: khoản cũ (server gắn legacy) → nhãn 'cách tính cũ'; khoản mới / bản cũ thiếu trường → không nhãn", () => {
    expect(isLegacyTx(tx({ legacy: true, legacy_class: "essential" }))).toBe(true);
    expect(isLegacyTx(tx({ meaning: "income", legacy: true, allocated: 1 }))).toBe(true);
    expect(isLegacyTx(tx({ legacy: false }))).toBe(false);
    expect(isLegacyTx(tx())).toBe(false);
  });

  it("UC-715 AC-14: khoản chi cũ → 'Loại chi (cách tính cũ): Thiết yếu'; khoản thu cũ đã chia → 'Lần chia: đã chia vào các ví (bản cũ)'; lý do không trả cho mình (AC-10); không tên ví; sửa khoản chi cũ → form không có ô ví", () => {
    expect(legacyRows(tx({ legacy: true, legacy_class: "essential" }))).toEqual([["Loại chi (cách tính cũ)", "Thiết yếu"]]);
    const income = tx({ meaning: "income", legacy: true, allocated: 1, wealth_note: "tháng này trả viện phí", category_name: null });
    expect(legacyRows(income)).toEqual([
      ["Lần chia", "đã chia vào các ví (bản cũ)"],
      ["Không trả cho mình lần này", "tháng này trả viện phí"],
    ]);
    expect(legacyRows(tx())).toEqual([]);
    expect(JSON.stringify([legacyRows(tx({ legacy: true, legacy_class: "flex" })), legacyRows(income)])).not.toMatch(/Trừ ví|Cộng vào ví|Tích sản|Ăn uống/);
    const d = draftFromTx(tx({ legacy: true, legacy_class: "essential" }));
    expect(d).not.toHaveProperty("wallet_id");
    expect(d).not.toHaveProperty("from_wallet_id");
    expect(d).not.toHaveProperty("legacy_class");
  });

  it("UC-715 AC-15: khoản chi cũ 150.000 Thiết yếu, 400.000 Mong muốn, khoản thu cũ đã chia, lần chia có lý do 'Tháng này trả viện phí' → đúng các dòng; Thuế / Tích luỹ theo legacy_class; holding → không dòng loại chi; không tên ví nào", () => {
    const rows = [
      tx({ id: 1, amount: 150_000, legacy: true, legacy_class: "essential", category_name: "Ăn uống" }),
      tx({ id: 2, amount: 400_000, legacy: true, legacy_class: "flex", category_name: "Ăn uống" }),
      tx({ id: 3, meaning: "income", legacy: true, allocated: 1, category_name: null }),
      tx({ id: 4, meaning: "income", legacy: true, allocated: 1, wealth_note: "Tháng này trả viện phí", category_name: null }),
    ].map(legacyRows);
    expect(rows).toEqual([
      [["Loại chi (cách tính cũ)", "Thiết yếu"]],
      [["Loại chi (cách tính cũ)", "Mong muốn"]],
      [["Lần chia", "đã chia vào các ví (bản cũ)"]],
      [
        ["Lần chia", "đã chia vào các ví (bản cũ)"],
        ["Không trả cho mình lần này", "Tháng này trả viện phí"],
      ],
    ]);
    // "Ăn uống" chỉ còn là tên danh mục, không ở phần cách tính cũ.
    expect(JSON.stringify(rows)).not.toMatch(/Ăn uống|ví [A-ZĐ]|Trừ ví/);
    expect(legacyRows(tx({ legacy: true, legacy_class: "tax" }))).toEqual([["Loại chi (cách tính cũ)", "Thuế"]]);
    expect(legacyRows(tx({ legacy: true, legacy_class: "savings" }))).toEqual([["Loại chi (cách tính cũ)", "Tích luỹ"]]);
    expect(legacyRows(tx({ legacy: true, legacy_class: "holding" }))).toEqual([]);
  });
});

describe("điền sẵn form sửa từ dòng sổ (quy ước dấu)", () => {
  it("khoản chi: tài khoản tiền ra, giữ khoản nợ; ngày theo giờ VN; không ví", () => {
    const d = draftFromTx(tx({ at: "2026-09-20T18:30:00.000Z", debt_id: "co-lan", note: "trả cô Lan" }));
    expect(d).toMatchObject({ amount: 45_000, day: "2026-09-21", account_id: "cash-husband", category_id: "groceries", debt_id: "co-lan", note: "trả cô Lan" });
  });

  it("thu nhập: tài khoản tiền vào, thuế, nguồn thu, người thuê", () => {
    const d = draftFromTx(
      tx({ meaning: "income", account_id: null, counter_account_id: "vcb-husband", taxable: 1, income_stream_id: "rental", tenant_id: "chi-lan" }),
    );
    expect(d).toMatchObject({ account_id: "vcb-husband", taxable: true, income_stream_id: "rental", tenant_id: "chi-lan" });
  });

  it("hoàn tiền: tài khoản tiền về, nối về khoản chi gốc", () => {
    const d = draftFromTx(tx({ meaning: "refund", account_id: null, counter_account_id: "cash-husband", link_id: 3 }));
    expect(d).toMatchObject({ account_id: "cash-husband", link_id: 3 });
  });

  it("chuyển nội bộ: tài khoản nguồn và đích", () => {
    expect(draftFromTx(tx({ meaning: "transfer", account_id: "vcb-husband", counter_account_id: "tcb-husband" }))).toMatchObject({
      account_id: "vcb-husband",
      to_account_id: "tcb-husband",
    });
  });

  it("cho vay / nhận lại: tài khoản theo chiều tiền, giữ khoản phải thu; mua tài sản giữ loại tài sản", () => {
    expect(draftFromTx(tx({ meaning: "lend", account_id: "vcb-husband", receivable_id: "em-hai" }))).toMatchObject({ account_id: "vcb-husband", receivable_id: "em-hai" });
    expect(draftFromTx(tx({ meaning: "collect", account_id: null, counter_account_id: "vcb-husband", receivable_id: "em-hai" }))).toMatchObject({ account_id: "vcb-husband", receivable_id: "em-hai" });
    expect(draftFromTx(tx({ meaning: "buy_asset", account_id: null, asset_kind: "gold" }))).toMatchObject({ asset_kind: "gold", account_id: null });
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
  const ns = { amount: 3_945_000, perDay: 136_000 };

  it("xoá: nói số tiền, khoản gì, và Vận hành còn bao nhiêu (chỉ khoản chi / hoàn tiền)", () => {
    expect(voidToast(tx(), ns)).toBe(`Đã xoá 45.000${NBSP}₫ Đi chợ. Vận hành còn 3.945.000${NBSP}₫ ≈ 136.000/ngày.`);
    expect(voidToast(tx({ category_name: null, meaning: "lend" }), ns)).toBe(`Đã xoá 45.000${NBSP}₫ Cho vay.`);
    expect(voidToast(tx(), null)).toBe(`Đã xoá 45.000${NBSP}₫ Đi chợ.`);
  });

  it("xoá khoản thu: hỏi lại có nói kỳ lương / việc sinh từ khoản này cũng bị huỷ; khoản cũ đã chia nói phần nạp ví cũ được gỡ", () => {
    expect(voidConfirm(tx({ meaning: "income", allocated: 0 }))).toBe("Xoá hẳn khoản này? Kỳ lương và việc ngày lương sinh từ khoản này (nếu có) cũng bị huỷ.");
    expect(voidConfirm(tx({ meaning: "income", allocated: 1 }))).toContain("phần đã nạp vào ví theo cách tính cũ được gỡ");
    expect(voidConfirm(tx())).toBe("Xoá hẳn khoản này?");
  });

  it("sửa: nói số mới và Vận hành còn bao nhiêu", () => {
    expect(editToast(tx({ amount: 120_000, category_name: "Xăng xe" }), ns)).toBe(`Đã sửa thành 120.000${NBSP}₫ Xăng xe. Vận hành còn 3.945.000${NBSP}₫ ≈ 136.000/ngày.`);
  });
});
