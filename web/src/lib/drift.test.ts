import { describe, expect, it } from "vitest";
import { driftOf } from "./drift";

describe("lệch đối soát: một luật cho Hôm nay và Tài khoản (ADR-87)", () => {
  it("chỉ sổ khác giao dịch ngân hàng đã gán mới là lệch, giữ dấu; 0 hay chưa có giao dịch ngân hàng (null) là không lệch", () => {
    expect(driftOf({ bookDrift: 50_000 })).toBe(50_000);
    expect(driftOf({ bookDrift: -120_000 })).toBe(-120_000);
    expect(driftOf({ bookDrift: 0 })).toBeNull();
    expect(driftOf({ bookDrift: null })).toBeNull();
  });

  it("snapshot cũ còn lưu trên máy mang số SePay báo (feedDrift) mà sổ khớp → không báo lệch", () => {
    const cached = { accountId: "mb-spending-wife", name: "MB chi tiêu (vợ)", feedDrift: 876_256, bookDrift: 0 };
    expect(driftOf(cached)).toBeNull();
  });
});
