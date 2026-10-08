import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, transformWithOxc, type Plugin } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Service worker viết tay (web/sw.js). Lúc build, chèn danh sách file của app shell, một mã phiên bản
// để trình duyệt thấy sw.js đổi mỗi lần build, và hàm freshFor, bypassWorker (src/lib/sw-fresh.ts, dịch sang JS, bỏ `export`)
// — một nguồn duy nhất cho thời hạn cache, có test. Không dùng thư viện PWA nào.
function serviceWorker(): Plugin {
  return {
    name: "vi-nha-sw",
    apply: "build",
    async generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const shell = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png", ...files.map((f) => `/${f}`)];
      const unique = [...new Set(shell)];
      const version = createHash("sha256").update(unique.join("\n")).digest("hex").slice(0, 12);
      const fresh = await transformWithOxc(readFileSync(here("./src/lib/sw-fresh.ts"), "utf8"), "sw-fresh.ts");
      const source = readFileSync(here("./sw.js"), "utf8")
        .replace("__PRECACHE__", JSON.stringify(unique))
        .replace("__VERSION__", version)
        .replace("/* __FRESH_FOR__ */", () => fresh.code.replace(/^export /gm, ""));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  root: here("."),
  publicDir: here("./public"),
  plugins: [preact(), tailwindcss(), serviceWorker()],
  // Phiên bản hiện ở Cài đặt › Máy này › Về Ví nhà: bản public do scripts/publish-public.mjs đặt, repo phát triển không có → "".
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(here("../package.json"), "utf8")).version ?? "") },
  build: {
    outDir: here("../public"),
    emptyOutDir: true,
    target: "es2020",
  },
  server: {
    port: 5178,
    strictPort: true,
    // API chạy ở `npm run dev` (wrangler, cổng 8787)
    proxy: { "/v1": "http://localhost:8787" },
  },
  preview: { port: 5178, strictPort: true },
});
