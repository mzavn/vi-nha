import { describe, expect, it } from "vitest";
import { toastDuration } from "./toast";

describe("toast (pwa UC-711)", () => {
  it("UC-711 AC-7: câu ngắn tắt sau 2,2 giây; câu dài 60 ms mỗi ký tự, tối đa 8 giây", () => {
    expect(toastDuration("Đã ghi.", false)).toBe(2200);
    expect(toastDuration("x".repeat(100), false)).toBe(6000);
    expect(toastDuration("x".repeat(400), false)).toBe(8000);
  });

  it("UC-711 AC-34: toast kèm nút Hoàn tác ở lại ít nhất 5 giây, câu dài vẫn theo độ dài (tối đa 8 giây)", () => {
    expect(toastDuration("Đã xoá.", true)).toBe(5000);
    expect(toastDuration("x".repeat(100), true)).toBe(6000);
    expect(toastDuration("x".repeat(400), true)).toBe(8000);
  });
});
