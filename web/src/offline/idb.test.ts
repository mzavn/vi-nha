// Khi trình duyệt chặn IndexedDB, hàng đợi lùi về localStorage. Nếu localStorage cũng không ghi được,
// khoản nhập KHÔNG được mất lặng lẽ: put phải báo lỗi để màn nhập giữ lại số và báo người dùng.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueuedEntry } from "./queue";

const item: QueuedEntry = {
  clientId: "c-00000001",
  memberId: "wife",
  body: { meaning: "spend", amount: 35_000, client_id: "c-00000001", category_id: "eating-out" },
  createdAt: "2026-09-22T01:00:00.000Z",
  status: "pending",
  attempts: 0,
} as QueuedEntry;

function fakeLocalStorage(opts: { full?: boolean; seed?: Record<string, string> } = {}) {
  const data = new Map<string, string>(Object.entries(opts.seed ?? {}));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.full) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("hàng đợi khi không có IndexedDB", () => {
  it("lùi về localStorage và đọc lại được", async () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    const { queueStore } = await import("./idb");
    await queueStore.put(item);
    expect((await queueStore.list()).map((i) => i.clientId)).toEqual(["c-00000001"]);
  });

  it("localStorage đầy hoặc bị chặn → báo lỗi, không nuốt", async () => {
    vi.stubGlobal("localStorage", fakeLocalStorage({ full: true }));
    const { queueStore, StorageUnavailableError } = await import("./idb");
    await expect(queueStore.put(item)).rejects.toBeInstanceOf(StorageUnavailableError);
  });
});

describe("bản lưu của phiên bản dữ liệu trước (pwa UC-710 AC-11)", () => {
  const old = { key: "husband:snapshot", data: { dataVersion: 1 }, at: "2026-10-06T01:00:00.000Z" };

  // import động sau resetModules: mỗi test là một lần mở app mới (dấu "đã kiểm phiên bản" nằm trong module).
  it("chưa có dấu phiên bản mới: bỏ bản lưu cũ ở localStorage một lần (đọc ra null), hàng đợi nhập giữ nguyên và vẫn đọc được", async () => {
    const ls = fakeLocalStorage({ seed: { "vi-nha:cache:husband:snapshot": JSON.stringify(old), "vi-nha:queue": JSON.stringify({ [item.clientId]: item }) } });
    vi.stubGlobal("localStorage", ls);
    const { cacheGet, cacheSet, queueStore } = await import("./idb");
    expect(await cacheGet("husband:snapshot")).toBeNull();
    expect(ls.getItem("vi-nha:cache-version")).toBe("3");
    expect((await queueStore.list()).map((i) => i.clientId)).toEqual(["c-00000001"]);
    // Bản lưu mới ghi sau đó thì đọc lại được, không bị bỏ thêm lần nữa.
    await cacheSet("husband:snapshot", { ok: 1 }, "2026-10-07T01:00:00.000Z");
    expect((await cacheGet<{ ok: number }>("husband:snapshot"))?.data).toEqual({ ok: 1 });
  });

  it("đã đúng phiên bản: bản lưu giữ nguyên", async () => {
    vi.stubGlobal("localStorage", fakeLocalStorage({ seed: { "vi-nha:cache-version": "3", "vi-nha:cache:husband:snapshot": JSON.stringify(old) } }));
    const { cacheGet } = await import("./idb");
    expect((await cacheGet("husband:snapshot"))?.at).toBe(old.at);
  });
});

describe("lên v2: DATA_VERSION 3 (pwa UC-710 AC-13)", () => {
  it("UC-710 AC-13: máy đã mở 1.8 (bản lưu phiên bản 2 có tiers, wallets) → bản lưu cũ bị bỏ, hàng đợi còn; mất mạng lúc đó → đọc ra null như lần đầu, không lỗi", async () => {
    const v18 = { key: "husband:snapshot", data: { tiers: { wealth_building: { balance: 1 } }, wallets: [] }, at: "2026-11-10T01:00:00.000Z" };
    const boot18 = { key: "husband:bootstrap", data: { wallets: [{ id: "food" }] }, at: "2026-11-10T01:00:00.000Z" };
    const ls = fakeLocalStorage({
      seed: {
        "vi-nha:cache-version": "2",
        "vi-nha:cache:husband:snapshot": JSON.stringify(v18),
        "vi-nha:cache:husband:bootstrap": JSON.stringify(boot18),
        "vi-nha:queue": JSON.stringify({ [item.clientId]: item }),
      },
    });
    vi.stubGlobal("localStorage", ls);
    const { cacheGet, queueStore } = await import("./idb");
    expect(await cacheGet("husband:snapshot")).toBeNull();
    expect(await cacheGet("husband:bootstrap")).toBeNull();
    expect(ls.getItem("vi-nha:cache-version")).toBe("3");
    expect((await queueStore.list()).map((i) => i.clientId)).toEqual(["c-00000001"]);
  });
});
