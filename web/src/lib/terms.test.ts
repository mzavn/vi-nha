import { describe, expect, it } from "vitest";
import { TERMS } from "./terms";

describe("ⓘ thuật ngữ (UC-711 AC-35)", () => {
  it("UC-711 AC-35: đủ sáu thuật ngữ (Vận hành, Dự phòng, Tích luỹ, Tuổi tiền, Khoản phải trả, Ví Thưởng) — không còn Phần an tâm, ⓘ Dự phòng không nhắc phần an tâm; mỗi câu một dòng ≤ 140 ký tự, không chữ số, kết thúc bằng dấu chấm, không chấm than", () => {
    expect(Object.values(TERMS).map((t) => t.label)).toEqual(["Vận hành", "Dự phòng", "Tích luỹ", "Tuổi tiền", "Khoản phải trả", "Ví Thưởng"]);
    expect(JSON.stringify(TERMS)).not.toMatch(/an tâm/i);
    for (const { label, text } of Object.values(TERMS)) {
      expect(text.length, label).toBeLessThanOrEqual(140);
      expect(text, label).not.toMatch(/\d|!|\n/);
      expect(text.endsWith("."), label).toBe(true);
    }
  });
});
