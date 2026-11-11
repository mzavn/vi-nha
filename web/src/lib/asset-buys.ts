// Mọi khoản mua tài sản cho Ví & quỹ › Tích luỹ (pwa UC-707 AC-38): lọc `meaning=buy_asset` ở server, lật trang bằng
// con trỏ `before` (id dòng cuối trang trước, server sắp theo cặp at, id — ledger UC-111) tới khi trang ít hơn cỡ trang.

import { request } from "./api";
import type { TxRow } from "./types";

/** Cỡ trang tối đa server trả cho GET /v1/transactions. */
const PAGE = 200;

/** `fresh`: bỏ qua bản lưu còn tươi của service worker (bấm Tải lại). `cachedAt`: có trang lấy từ bản lưu thì là lúc lưu. */
export async function loadAllAssetBuys(fresh = false): Promise<{ data: TxRow[]; cachedAt: string | null }> {
  const data: TxRow[] = [];
  let cachedAt: string | null = null;
  for (;;) {
    const last = data.at(-1);
    const before = last ? `&before=${last.id}` : "";
    const page = await request<TxRow[]>(`/v1/transactions?meaning=buy_asset&limit=${PAGE}${before}`, "GET", undefined, fresh);
    data.push(...page.data);
    cachedAt ??= page.cachedAt;
    if (page.data.length < PAGE) return { data, cachedAt };
  }
}
