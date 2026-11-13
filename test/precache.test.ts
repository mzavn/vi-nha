import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fontPrecache } from "../web/src/lib/precache";


describe("font tự host trong app shell (pwa UC-710, access UC-503)", () => {
  it("UC-710 AC-14: precache có đủ 13 file /fonts/*.woff2 (Be Vietnam Pro 400/500/600 × 3 nhóm ký tự, Inter 400/500 × 2), không có địa chỉ Google", () => {
    const list = fontPrecache(readdirSync("web/public/fonts"));
    expect(list).toHaveLength(13);
    for (const s of ["latin", "latin-ext", "vietnamese"]) for (const w of [400, 500, 600]) expect(list).toContain(`/fonts/be-vietnam-pro-${s}-${w}.woff2`);
    for (const s of ["latin", "vietnamese"]) for (const w of [400, 500]) expect(list).toContain(`/fonts/inter-${s}-${w}.woff2`);
    expect(list.every((f) => f.startsWith("/fonts/") && f.endsWith(".woff2"))).toBe(true);
  });

  it("UC-710 AC-14: service worker và index.html không còn gọi Google Fonts", () => {
    for (const f of ["sw.js", "index.html"]) expect(readFileSync(`web/${f}`, "utf8"), f).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});
