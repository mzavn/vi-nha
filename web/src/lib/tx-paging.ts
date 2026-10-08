// Phân trang "Giao dịch gần đây" (pwa UC-702, UC-703): cỡ trang chọn được và nhớ theo máy; trang sau theo
// con trỏ `before` (id dòng cuối trang đang xem, server sắp theo cặp at, id — ledger UC-111).

export const PAGE_SIZES = [5, 10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;
const KEY = "vi-nha:tx-page-size";

/** Giá trị đã lưu → cỡ trang; không có, hỏng hoặc không nằm trong danh sách chọn thì 10. */
export function parsePageSize(raw: string | null): number {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export function loadPageSize(): number {
  try {
    return parsePageSize(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_PAGE_SIZE; // localStorage bị chặn
  }
}

export function savePageSize(size: number) {
  try {
    localStorage.setItem(KEY, String(size));
  } catch {
    // không nhớ được — vẫn dùng cỡ này cho lần mở này
  }
}

/** Đọc thừa một dòng (`size + 1`) để biết còn trang sau mà không cần hỏi thêm; dòng thừa không hiện. */
export function txPagePath(size: number, before: number | undefined, includeVoid: boolean): string {
  return `/v1/transactions?limit=${size + 1}${before === undefined ? "" : `&before=${before}`}${includeVoid ? "&include_void=1" : ""}`;
}

export function splitPage<T>(rows: T[], size: number): { rows: T[]; hasNext: boolean } {
  return { rows: rows.slice(0, size), hasNext: rows.length > size };
}
