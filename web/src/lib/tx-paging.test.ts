import { describe, expect, it } from "vitest";
import { parsePageSize, splitPage, txPagePath } from "./tx-paging";

describe("phân trang Giao dịch gần đây", () => {
  it("cỡ trang đã lưu chỉ nhận 5/10/20/50/100, còn lại về mặc định 10", () => {
    expect([5, 10, 20, 50, 100].map((n) => parsePageSize(String(n)))).toEqual([5, 10, 20, 50, 100]);
    expect(parsePageSize(null)).toBe(10);
    expect(parsePageSize("15")).toBe(10);
    expect(parsePageSize("200")).toBe(10);
    expect(parsePageSize("abc")).toBe(10);
  });

  it("đọc thừa một dòng; trang sau theo con trỏ before; khoản đã xoá chỉ khi bật", () => {
    expect(txPagePath(10, undefined, false)).toBe("/v1/transactions?limit=11");
    expect(txPagePath(100, 42, true)).toBe("/v1/transactions?limit=101&before=42&include_void=1");
  });

  it("dòng thừa báo còn trang sau và không hiện; đủ hoặc thiếu thì là trang cuối", () => {
    expect(splitPage([1, 2, 3, 4, 5, 6], 5)).toEqual({ rows: [1, 2, 3, 4, 5], hasNext: true });
    expect(splitPage([1, 2, 3, 4, 5], 5)).toEqual({ rows: [1, 2, 3, 4, 5], hasNext: false });
    expect(splitPage([1, 2], 5)).toEqual({ rows: [1, 2], hasNext: false });
  });
});
