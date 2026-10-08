// Điều kiện để chạy @cloudflare/workers-oauth-provider trong Node (UC-601): thư viện import `WorkerEntrypoint` từ
// `cloudflare:workers` ở đầu file, và chỉ bật Client ID Metadata Document khi có cờ `global_fetch_strictly_public`.
import { vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class WorkerEntrypoint {
    constructor(
      readonly ctx: unknown,
      readonly env: unknown,
    ) {}
  },
}));

Object.assign(globalThis, { Cloudflare: { compatibilityFlags: { global_fetch_strictly_public: true } } });
