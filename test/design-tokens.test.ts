// Token CSS theo docs/DESIGN.md §2 (pwa UC-711 AC-33, change 261113-giao-dien-m1-va-ten-moi): đọc thẳng file CSS.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = "web/src/styles";
const tokens = () => readFileSync(join(styles, "tokens.css"), "utf8");
const cssFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? cssFiles(join(dir, f)) : f.endsWith(".css") ? [join(dir, f)] : []));

/** Mọi khai báo `--tên: giá trị;` trong file (bỏ chú thích), theo thứ tự xuất hiện. */
function decls(css: string): [string, string][] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(/(--[\w-]+)\s*:\s*([^;{}]*);/g)].map((m) => [m[1]!, m[2]!.trim()]);
}

const SCALE: Record<string, string> = {
  "--text-sm": "13px", "--leading-sm": "18px",
  "--text-md": "15px", "--leading-md": "22px",
  "--text-lg": "17px", "--leading-lg": "24px",
  "--text-title": "28px", "--leading-title": "34px",
  "--num-total": "32px", "--leading-total": "38px",
  "--num-hero": "48px", "--leading-hero": "52px",
  "--num-hero-wide": "64px", "--leading-hero-wide": "68px",
  "--s1": "4px", "--s2": "8px", "--s3": "12px", "--s4": "16px", "--s6": "24px", "--s8": "32px", "--s12": "48px",
  "--r-card": "24px", "--r-inner": "16px", "--r-pill": "999px",
};

/** Bảng §2.5: [sáng, tối]. */
const COLORS: Record<string, [string, string]> = {
  "--bg": ["#ffffff", "#000000"],
  "--surface": ["#ffffff", "#000000"],
  "--surface-2": ["#f0f0f0", "#1c1c1e"],
  "--line": ["#ececec", "#232325"],
  "--fg": ["#1d1d1f", "#f2f2f4"],
  "--fg-2": ["#5e5e63", "#a6a6ab"],
  "--fg-3": ["#6e6e73", "#8d8d92"],
  "--line-strong": ["#8f8f94", "#5c5c61"],
  "--pos": ["#1d7a3e", "#5fcf86"],
  "--pos-bg": ["#e9f5ee", "#13261a"],
  "--neg": ["#b3261e", "#ff7b72"],
  "--neg-bg": ["#fbeceb", "#2c1715"],
  "--warn": ["#8a5a00", "#e8b04a"],
  "--warn-bg": ["#fbf3e4", "#2a2213"],
  "--focus": ["#1d1d1f", "#f2f2f4"],
  "--pocket-operating": ["#3f63c9", "#8ea8ff"],
  "--pocket-reserve": ["#2f7f79", "#6cc9c0"],
  "--pocket-savings": ["#7356c9", "#b6a2ff"],
};

describe("token giao diện theo DESIGN.md §2 (pwa UC-711 AC-33)", () => {
  it("UC-711 AC-33: thang chữ, khoảng cách, bo góc đúng DESIGN §2.1, §2.3, §2.4", () => {
    const d = new Map(decls(tokens()));
    for (const [k, v] of Object.entries(SCALE)) expect(d.get(k), k).toBe(v);
  });

  it("UC-711 AC-33: mỗi màu khai báo đúng một lần, mang cả giá trị sáng lẫn tối (không chép khối nền tối hai lần)", () => {
    const all = decls(tokens());
    for (const [k, [light, dark]] of Object.entries(COLORS)) {
      const found = all.filter(([n]) => n === k);
      expect(found, k).toHaveLength(1);
      expect(found[0]![1], k).toBe(`var(--L, ${light}) var(--D, ${dark})`);
    }
  });

  it("UC-711 AC-33: chữ Be Vietnam Pro, số Inter tự host — không IBM Plex Mono, không Google, không `font:` gộp", () => {
    const d = new Map(decls(tokens()));
    expect(d.get("--font-text")).toMatch(/^"Be Vietnam Pro"/);
    expect(d.get("--font-num")).toMatch(/^Inter\b/);
    const faces = [...tokens().matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]!);
    expect(faces).toHaveLength(13);
    for (const f of faces) {
      expect(f).toMatch(/src:\s*url\("\/fonts\/[\w-]+\.woff2"\)\s*format\("woff2"\)/);
      expect(f).toMatch(/font-display:\s*swap/);
      expect(f).toMatch(/unicode-range:/);
    }
    for (const file of cssFiles(styles)) {
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, file).not.toMatch(/IBM Plex|fonts\.googleapis|fonts\.gstatic/);
      expect(css, file).not.toMatch(/(^|[\s;{])font\s*:/);
    }
  });

  it("UC-711 AC-33: styles.css chỉ còn import (tailwind, tokens, base, components, từng màn)", () => {
    const main = readFileSync("web/src/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const lines = main.split("\n").map((l) => l.trim()).filter(Boolean);
    const imports = lines.filter((l) => l.startsWith("@import "));
    expect(imports.slice(0, 4)).toEqual(['@import "tailwindcss";', '@import "./styles/tokens.css";', '@import "./styles/base.css";', '@import "./styles/components.css";']);
    expect(imports.slice(4).every((l) => /^@import "\.\/styles\/screens\/[\w-]+\.css";$/.test(l))).toBe(true);
    expect(imports.length).toBeGreaterThan(4);
    // Ngoài import chỉ còn khối @theme inline (ánh xạ token sang Tailwind) — DESIGN.md §8.
    const rest = main.replace(/@import [^;]+;/g, "").replace(/@theme inline\s*{[^}]*}/, "").trim();
    expect(rest).toBe("");
  });
});
