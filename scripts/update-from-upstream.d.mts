// Kiểu cho scripts/update-from-upstream.mjs (test/update-from-upstream.test.ts import).
export declare const UPSTREAM: string;
// biome-ignore lint/suspicious/noExplicitAny: JSON tuỳ ý của wrangler.jsonc
export declare function parseJsonc(text: string): any;
export declare function mergeWranglerConfig(home: Record<string, unknown>, upstream: Record<string, unknown>): Record<string, unknown>;
export declare function compareVersions(a: string, b: string): number | null;
export declare function applyRelease(args: { cwd: string; from?: string; tag?: string }): {
  status: "updated" | "latest" | "older";
  message: string;
};
