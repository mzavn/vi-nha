import { describe, expect, it } from "vitest";
import { canUndoVoid, restoreBody, splitsFromTxs, TOAST_BANK_TX_ERROR, TOAST_UNDO_DONE } from "./undo";
import type { TxRow } from "./types";

const baseTx = (patch: Partial<TxRow> = {}): TxRow => ({
  id: 100,
  at: "2026-11-13T10:30:00.000Z",
  amount: 500_000,
  meaning: "spend",
  status: "active",
  account_id: "vcb",
  counter_account_id: null,
  category_id: "food",
  asset_kind: null,
  note: "ăn trưa",
  ...patch,
});

describe("hoàn tác (UC-715 AC-18, AC-19, UC-703 AC-19)", () => {
  it("UC-715 AC-18: canUndoVoid cho phép hoàn tác với các loại ghi tay thường, từ chối legacy và adjust", () => {
    expect(canUndoVoid(baseTx({ meaning: "spend" }))).toBe(true);
    expect(canUndoVoid(baseTx({ meaning: "income" }))).toBe(true);
    expect(canUndoVoid(baseTx({ meaning: "refund" }))).toBe(true);
    expect(canUndoVoid(baseTx({ meaning: "transfer", counter_account_id: "cash" }))).toBe(true);
    expect(canUndoVoid(baseTx({ meaning: "buy_asset", asset_kind: "gold" }))).toBe(true);
    expect(canUndoVoid(baseTx({ meaning: "lend", receivable_id: "loan-1" }))).toBe(true);
    expect(canUndoVoid(baseTx({ meaning: "collect", receivable_id: "loan-1" }))).toBe(true);

    // Không cho hoàn tác
    expect(canUndoVoid(baseTx({ meaning: "adjust" }))).toBe(false);
    expect(canUndoVoid(baseTx({ meaning: "spend", legacy: true }))).toBe(false);
  });

  it("UC-715 AC-18: restoreBody dựng lại đúng thân ghi khoản chi (giữ at gốc, goal_id, from_interest, debt_id)", () => {
    const tx = baseTx({
      at: "2026-10-05T08:15:00.000Z",
      meaning: "spend",
      amount: 1_200_000,
      account_id: "tcb",
      category_id: "repairs",
      debt_id: "debt-car",
      interest_debt_id: "debt-interest",
      goal_id: "car-repair",
      from_interest: true,
      note: "sửa xe",
    });
    const body = restoreBody(tx, "client-uuid-1");
    expect(body).toEqual({
      meaning: "spend",
      amount: 1_200_000,
      at: "2026-10-05T08:15:00.000Z",
      client_id: "client-uuid-1",
      category_id: "repairs",
      account_id: "tcb",
      to_account_id: undefined,
      note: "sửa xe",
      taxable: undefined,
      link_id: undefined,
      asset_kind: undefined,
      income_stream_id: undefined,
      tenant_id: undefined,
      debt_id: "debt-car",
      receivable_id: undefined,
      interest_debt_id: "debt-interest",
      goal_id: "car-repair",
      is_salary: undefined,
      is_interest: undefined,
      from_interest: true,
    });
  });

  it("UC-715 AC-18: restoreBody dựng lại đúng thân ghi thu nhập (lương, lãi, người thuê, nguồn thu)", () => {
    const tx = baseTx({
      meaning: "income",
      amount: 25_000_000,
      account_id: null,
      counter_account_id: "vcb",
      income_stream_id: "salary-company",
      tenant_id: "tenant-room1",
      is_salary: true,
      is_interest: false,
    });
    const body = restoreBody(tx, "client-uuid-2");
    expect(body).toEqual({
      meaning: "income",
      amount: 25_000_000,
      at: "2026-11-13T10:30:00.000Z",
      client_id: "client-uuid-2",
      category_id: "food",
      account_id: "vcb",
      to_account_id: undefined,
      note: "ăn trưa",
      taxable: undefined,
      link_id: undefined,
      asset_kind: undefined,
      income_stream_id: "salary-company",
      tenant_id: "tenant-room1",
      debt_id: undefined,
      receivable_id: undefined,
      interest_debt_id: undefined,
      goal_id: undefined,
      is_salary: true,
      is_interest: undefined,
      from_interest: undefined,
    });
  });

  it("UC-715 AC-18: restoreBody dựng lại đúng chuyển khoản, hoàn tiền, mua tài sản, cho vay", () => {
    // Chuyển khoản
    const transferTx = baseTx({ meaning: "transfer", account_id: "vcb", counter_account_id: "cash" });
    const transferBody = restoreBody(transferTx, "c-transfer");
    expect(transferBody.meaning).toBe("transfer");
    expect(transferBody.account_id).toBe("vcb");
    expect(transferBody.to_account_id).toBe("cash");

    // Hoàn tiền
    const refundTx = baseTx({ meaning: "refund", account_id: null, counter_account_id: "vcb", link_id: 42 });
    const refundBody = restoreBody(refundTx, "c-refund");
    expect(refundBody.meaning).toBe("refund");
    expect(refundBody.account_id).toBe("vcb");
    expect(refundBody.link_id).toBe(42);

    // Mua tài sản
    const assetTx = baseTx({ meaning: "buy_asset", account_id: "vcb", asset_kind: "gold" });
    const assetBody = restoreBody(assetTx, "c-asset");
    expect(assetBody.meaning).toBe("buy_asset");
    expect(assetBody.asset_kind).toBe("gold");

    // Cho vay / thu nợ
    const lendTx = baseTx({ meaning: "lend", account_id: "vcb", receivable_id: "rec-1" });
    expect(restoreBody(lendTx, "c-lend").receivable_id).toBe("rec-1");

    const collectTx = baseTx({ meaning: "collect", counter_account_id: "vcb", receivable_id: "rec-1" });
    expect(restoreBody(collectTx, "c-collect").receivable_id).toBe("rec-1");
  });

  it("UC-715 AC-19: splitsFromTxs tái tạo đúng mảng splits cho POST /v1/logs/:id/assign", () => {
    const tx1 = baseTx({ meaning: "spend", amount: 200_000, category_id: "market", note: "mua rau" });
    const tx2 = baseTx({
      meaning: "transfer",
      amount: 300_000,
      account_id: "vcb",
      counter_account_id: "cash",
      note: "rút ATM",
    });

    const splits = splitsFromTxs([tx1, tx2], "vcb");
    expect(splits).toHaveLength(2);
    expect(splits[0]).toEqual({
      meaning: "spend",
      amount: 200_000,
      category_id: "market",
      other_account_id: null,
      income_stream_id: null,
      tenant_id: null,
      debt_id: null,
      interest_debt_id: null,
      receivable_id: null,
      link_id: null,
      taxable: false,
      asset_kind: null,
      interest: false,
      note: "mua rau",
      goal_id: null,
      from_interest: false,
    });
    expect(splits[1]).toEqual({
      meaning: "transfer",
      amount: 300_000,
      category_id: "food",
      other_account_id: "cash", // Đầu kia khác "vcb"
      income_stream_id: null,
      tenant_id: null,
      debt_id: null,
      interest_debt_id: null,
      receivable_id: null,
      link_id: null,
      taxable: false,
      asset_kind: null,
      interest: false,
      note: "rút ATM",
      goal_id: null,
      from_interest: false,
    });
  });

  it("UC-703 AC-19: các câu thông báo toast hoàn tác chuẩn", () => {
    expect(TOAST_UNDO_DONE).toBe("Đã hoàn tác.");
    expect(TOAST_BANK_TX_ERROR).toBe("Khoản này đã khớp giao dịch ngân hàng, dùng Gán lại ở Sổ.");
  });
});
