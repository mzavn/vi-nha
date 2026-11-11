import { describe, expect, it } from "vitest";
import { pocketsShared } from "./household-b.fixture";
import { goalChoices, goalField, NO_GOAL } from "./goal-choices";
import { draftFromTx } from "./transactions";
import type { TxRow } from "./types";

describe("ô Cho mục tiêu (pocket UC-1209 bước 11)", () => {
  const p = pocketsShared();

  it("UC-703 AC-17: chi từ MB tiết kiệm (chung Nhà ở, Học tập) → chip 'Nhà ở · Học tập' theo thứ tự ưu tiên; chọn Học tập → gửi goal_id 'hoc-tap'; đổi sang TK thuế (một mục tiêu) → không có hàng, không gửi; về lại không chọn → không gửi", () => {
    const saving = goalChoices("tk-tiet-kiem", p);
    expect(saving).toEqual([
      { id: "nha-o", name: "Nhà ở" },
      { id: "hoc-tap", name: "Học tập" },
    ]);
    expect(goalField("hoc-tap", saving)).toEqual({ goal_id: "hoc-tap" });
    const tax = goalChoices("tk-thue", p);
    expect(tax).toEqual([]);
    expect(goalField("hoc-tap", tax)).toEqual({});
    expect(goalField(null, saving)).toEqual({});
    expect(goalField(NO_GOAL, saving)).toEqual({});
    expect(goalChoices("phao", p)).toEqual([]);
    expect(goalChoices("tk-chung", p).map((g) => g.name)).toEqual(["Hoá đơn", "Bảo dưỡng xe", "Hiếu hỉ"]);
    // Offline chưa có snapshot đã lưu: không có hàng.
    expect(goalChoices("tk-tiet-kiem", undefined)).toEqual([]);
  });

  it("UC-715 AC-17: sửa khoản chi gắn Nhà ở → form mang goal_id 'nha-o' (chip đang chọn); đổi tài khoản sang phao → hàng chip mất, gửi không goal_id", () => {
    const tx: TxRow = { id: 9, at: "2026-11-12T02:00:00.000Z", amount: 7_500_000, meaning: "spend", status: "active", account_id: "tk-tiet-kiem", counter_account_id: null, category_id: "rent", asset_kind: null, note: null, goal_id: "nha-o" };
    const d = draftFromTx(tx);
    expect(d.goal_id).toBe("nha-o");
    expect(goalField(d.goal_id, goalChoices(d.account_id, p))).toEqual({ goal_id: "nha-o" });
    expect(goalChoices("phao", p)).toEqual([]);
    expect(goalField(d.goal_id, goalChoices("phao", p))).toEqual({});
    expect(draftFromTx({ ...tx, goal_id: undefined }).goal_id).toBeNull();
  });
});
