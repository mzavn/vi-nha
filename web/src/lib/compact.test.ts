import { describe, expect, it } from "vitest";
import { COMPACT_KEY, loadCompact, saveCompact } from "./compact";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("chế độ gọn của máy này (UC-709 AC-56)", () => {
  it("UC-709 AC-56: mặc định tắt; bật lưu 'vi-nha:compact' = 1 ở máy này, tắt thì xoá; localStorage bị chặn → tắt, không ném lỗi", () => {
    const s = memory();
    expect(COMPACT_KEY).toBe("vi-nha:compact");
    expect(loadCompact(s)).toBe(false);
    saveCompact(s, true);
    expect(s.m.get(COMPACT_KEY)).toBe("1");
    expect(loadCompact(s)).toBe(true);
    saveCompact(s, false);
    expect(s.m.has(COMPACT_KEY)).toBe(false);
    expect(loadCompact(null)).toBe(false);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadCompact(broken)).toBe(false);
    expect(() => saveCompact(broken, true)).not.toThrow();
  });
});
