import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Worktree của các nhánh làm song song nằm trong .claude/ — không chạy test của chúng ở đây.
    exclude: [...configDefaults.exclude, ".claude/**"],
    // `cloudflare:workers` giả + cờ CIMD cho thư viện OAuth; thư viện phải đi qua vitest (inline) thì mock mới áp được.
    setupFiles: ["./test/setup.ts"],
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
  },
});
