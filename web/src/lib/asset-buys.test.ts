import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAllAssetBuys } from "./asset-buys";

// Sổ giả: 205 khoản mua tài sản, mới nhất trước (id giảm dần), như server sắp theo (at, id).
const rows = Array.from({ length: 205 }, (_, i) => ({ id: 1000 - i, meaning: "buy_asset", status: "active", amount: 1_000_000 + i }));

describe("UC-707 AC-38: tab Tích luỹ đọc đủ khoản mua tài sản", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("UC-707 AC-38: lọc meaning=buy_asset, limit=200, lật trang bằng before (id dòng cuối trang trước) tới khi trang < 200 dòng — đủ 205 khoản", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      const url = new URL(input, "https://vi-nha.test");
      asked.push(`${url.pathname}${url.search}`);
      const before = url.searchParams.get("before");
      const from = before === null ? 0 : rows.findIndex((r) => r.id === Number(before)) + 1;
      const page = url.searchParams.get("meaning") === "buy_asset" ? rows.slice(from, from + Number(url.searchParams.get("limit"))) : [];
      return new Response(JSON.stringify({ ok: true, data: page }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const r = await loadAllAssetBuys();
    expect(asked).toEqual(["/v1/transactions?meaning=buy_asset&limit=200", "/v1/transactions?meaning=buy_asset&limit=200&before=801"]);
    expect(r.data).toHaveLength(205);
    expect(r.data.map((x) => x.id)).toEqual(rows.map((x) => x.id));
    expect(r.cachedAt).toBeNull();
  });
});
