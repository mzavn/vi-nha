import { describe, expect, it } from "vitest";
import { bookPath, defaultFilter, entryDay, filterChips, groupByDay, removeChip, stepMonth, summaryParts, summaryPath, toggleMeaning, type BookFilter } from "./tx-filter";
import type { Bootstrap, TxRow } from "./types";

const now = new Date("2026-10-06T03:00:00Z");
const f0 = defaultFilter(now);
const boot = {
  categories: [{ id: "medicine", name: "Thuốc thang" }],
  wallets: [{ id: "nice-to-have", name: "Có thì tốt" }],
  accounts: [{ id: "cash-wife", name: "Tiền mặt (vợ)" }],
  members: [{ id: "wife", name: "Vợ" }],
} as unknown as Bootstrap;
const row = (id: number, at: string, meaning: string, amount: number, status = "active") =>
  ({ id, at, meaning, amount, status, counter_account_id: null }) as TxRow;

describe("Sổ giao dịch: bộ lọc (change 261006-so-giao-dich)", () => {
  it("mặc định là tháng hiện tại, không lọc gì; tháng 9 + Chi tiêu + Thuốc thang thành đúng query cho danh sách và tổng", () => {
    expect(bookPath(f0)).toBe("/v1/transactions?month=2026-10&limit=51");
    const f: BookFilter = { ...f0, month: "2026-09", meanings: ["spend"], categoryId: "medicine" };
    expect(bookPath(f)).toBe("/v1/transactions?month=2026-09&meaning=spend&category_id=medicine&limit=51");
    expect(bookPath({ ...f, showVoid: true }, 812)).toBe("/v1/transactions?month=2026-09&meaning=spend&category_id=medicine&limit=51&before=812&include_void=1");
    // Tổng không bao giờ mang include_void: khoản đã xoá không tính vào số nào.
    expect(summaryPath({ ...f, showVoid: true })).toBe("/v1/transactions/summary?month=2026-09&meaning=spend&category_id=medicine");
    expect(summaryPath({ ...f0, month: null })).toBe("/v1/transactions/summary");
  });

  it("chữ tìm: gửi khi đủ 2 ký tự (đã cắt khoảng trắng, mã hoá URL), ngắn hơn thì chưa tìm", () => {
    expect(bookPath({ ...f0, month: null, q: "  shopee " })).toBe("/v1/transactions?q=shopee&limit=51");
    expect(bookPath({ ...f0, month: null, q: "thuốc 50%" })).toBe(`/v1/transactions?q=${encodeURIComponent("thuốc 50%").replace(/%20/g, "+")}&limit=51`);
    expect(bookPath({ ...f0, month: null, q: "s" })).toBe("/v1/transactions?limit=51");
  });

  it("bộ lọc đang bật thành chip có tên dễ đọc; chạm × bỏ đúng bộ lọc đó; loại giữ thứ tự của danh sách", () => {
    const f: BookFilter = { ...toggleMeaning(toggleMeaning(f0, "refund"), "spend"), categoryId: "medicine", walletId: "nice-to-have", accountId: "cash-wife", memberId: "wife", source: "bank", showVoid: true };
    expect(f.meanings).toEqual(["spend", "refund"]);
    const chips = filterChips(f, boot);
    expect(chips.map((c) => c.label)).toEqual(["Chi tiêu", "Hoàn tiền", "Thuốc thang", "Ví Có thì tốt", "Tiền mặt (vợ)", "Vợ ghi", "Từ ngân hàng", "Có khoản đã xoá"]);
    expect(removeChip(f, chips[1]!).meanings).toEqual(["spend"]);
    expect(removeChip(f, chips[2]!).categoryId).toBeNull();
    expect(removeChip(f, chips[7]!).showVoid).toBe(false);
    expect(toggleMeaning(f, "spend").meanings).toEqual(["refund"]);
    expect(filterChips(f0, boot)).toEqual([]);
  });

  it("đi tháng: lùi tự do, tới không quá tháng hiện tại; đang xem cả sổ thì ‹ về tháng này", () => {
    expect(stepMonth("2026-10", -1, now)).toBe("2026-09");
    expect(stepMonth("2026-01", -1, now)).toBe("2025-12");
    expect(stepMonth("2026-09", 1, now)).toBe("2026-10");
    expect(stepMonth("2026-10", 1, now)).toBeNull();
    expect(stepMonth(null, -1, now)).toBe("2026-10");
    expect(stepMonth(null, 1, now)).toBeNull();
  });

  it("ghi thêm khi đang xem tháng 9 → ngày mặc định 30/9; tháng này hay cả sổ → hôm nay", () => {
    expect(entryDay("2026-09", now)).toBe("2026-09-30");
    expect(entryDay("2028-02", new Date("2028-05-01T03:00:00Z"))).toBe("2028-02-29");
    expect(entryDay("2026-10", now)).toBe("2026-10-06");
    expect(entryDay(null, now)).toBe("2026-10-06");
  });

  it("nhóm theo ngày giờ VN, tiêu đề ngày nói chi thật của ngày (trừ hoàn tiền, bỏ khoản đã xoá)", () => {
    const groups = groupByDay([
      row(5, "2026-10-05T10:00:00Z", "spend", 300_000),
      row(4, "2026-10-05T09:00:00Z", "refund", 8_000),
      row(3, "2026-10-05T08:00:00Z", "spend", 20_000),
      row(2, "2026-10-05T07:00:00Z", "spend", 999_000, "void"),
      row(1, "2026-10-04T18:00:00Z", "income", 5_000_000), // 01:00 ngày 5/10 giờ VN
      row(0, "2026-10-03T03:00:00Z", "income", 1_000_000),
    ]);
    expect(groups.map((g) => [g.heading, g.rows.map((r) => r.id)])).toEqual([
      ["Thứ Hai 5/10 · chi 312.000\u00a0₫", [5, 4, 3, 2, 1]],
      ["Thứ Bảy 3/10", [0]],
    ]);
  });

  it("dòng tổng theo nghĩa tiền thật: Chi = chi tiêu − hoàn tiền, Thu luôn có; loại khác chỉ hiện khi có số", () => {
    const zero = { count: 0, spend: 0, refund: 0, income: 0, lend: 0, collect: 0, transfer: 0, buy_asset: 0, adjust_in: 0, adjust_out: 0 };
    expect(summaryParts(zero)).toEqual([
      { label: "Chi", amount: 0 },
      { label: "Thu", amount: 0 },
    ]);
    expect(summaryParts({ ...zero, count: 6, spend: 500_000, refund: 50_000, income: 3_000_000, lend: 400_000, collect: 100_000, transfer: 700_000 })).toEqual([
      { label: "Chi", amount: 450_000 },
      { label: "Thu", amount: 3_000_000 },
      { label: "Cho vay", amount: 400_000 },
      { label: "Nhận lại", amount: 100_000 },
      { label: "Chuyển nội bộ", amount: 700_000 },
    ]);
  });
});
