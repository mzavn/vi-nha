import { describe, expect, it } from "vitest";
import { isLegacyTx, LEGACY_LABEL } from "./transactions";
import { bookFromHashQuery, bookHashQuery, bookPath, clearFilters, defaultFilter, entryDay, filterChips, groupByDay, monthFilter, privateAccountLine, removeChip, stepMonth, summaryParts, summaryPath, toggleMeaning, type BookFilter } from "./tx-filter";
import type { Bootstrap, TxRow } from "./types";

const now = new Date("2026-10-06T03:00:00Z");
const f0 = defaultFilter(now);
const boot = {
  categories: [{ id: "medicine", name: "Thuốc thang" }],
  accounts: [
    { id: "cash-wife", name: "Tiền mặt (vợ)" },
    { id: "mb-wife", name: "MB (vợ)", private: true, hiddenFromMe: true },
  ],
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
  it("UC-716 AC-10: khoảng ngày ghi đè month trong query; summaryPath và bookPath giữ đúng khoảng ngày", () => {
    const f: BookFilter = { ...f0, month: "2026-10", fromDate: "2026-09-01", toDate: "2026-09-15" };
    expect(bookPath(f)).toBe("/v1/transactions?from_date=2026-09-01&to_date=2026-09-15&limit=51");
    expect(summaryPath(f)).toBe("/v1/transactions/summary?from_date=2026-09-01&to_date=2026-09-15");
    // Nếu fromDate > toDate tạm thời lúc đang chọn ngày: bỏ qua không gửi để tránh lỗi 400
    expect(bookPath({ ...f0, fromDate: "2026-09-20", toDate: "2026-09-10" })).toBe("/v1/transactions?month=2026-10&limit=51");
  });

  it("UC-716 AC-10: chip khoảng ngày, chạm × phục hồi về tháng hiện tại; clearFilters chỉ reset tháng khi có khoảng ngày", () => {
    const fRange: BookFilter = { ...f0, month: null, fromDate: "2026-09-01", toDate: "2026-09-15" };
    const chips = filterChips(fRange, boot);
    expect(chips).toEqual([{ key: "dateRange", label: "1/9 – 15/9/2026" }]);
    expect(removeChip(fRange, chips[0]!, now)).toMatchObject({ fromDate: null, toDate: null, month: "2026-10" });

    // Chỉ từ ngày hoặc chỉ đến ngày
    expect(filterChips({ ...f0, month: null, fromDate: "2026-09-01", toDate: null }, boot)).toEqual([{ key: "dateRange", label: "Từ 1/9/2026" }]);
    expect(filterChips({ ...f0, month: null, fromDate: null, toDate: "2026-09-15" }, boot)).toEqual([{ key: "dateRange", label: "Đến 15/9/2026" }]);

    // clearFilters: đang xem tháng 9 (không khoảng ngày) thì giữ tháng 9
    const fMonth9: BookFilter = { ...f0, month: "2026-09", categoryId: "medicine" };
    expect(clearFilters(fMonth9, now)).toMatchObject({ month: "2026-09", categoryId: null, fromDate: null, toDate: null });
    // clearFilters: đang có khoảng ngày thì quay về tháng 10 (tháng hiện tại)
    expect(clearFilters(fRange, now)).toMatchObject({ month: "2026-10", fromDate: null, toDate: null });
  });
  it("UC-716 AC-21: không có bộ lọc Ví; bộ lọc đã lưu có wallet=food → bỏ qua, không lỗi", () => {
    const old = { ...f0, walletId: "food" } as unknown as BookFilter;
    expect(bookPath(old)).toBe("/v1/transactions?month=2026-10&limit=51");
    expect(filterChips(old, boot)).toEqual([]);
    expect("walletId" in f0).toBe(false);
  });

  it("UC-716 AC-22: lọc theo tài khoản riêng tư của người khác → dòng đầu 'Tài khoản riêng tư: chỉ chủ tài khoản thấy từng khoản'; tài khoản thường → không", () => {
    expect(privateAccountLine({ accountId: "mb-wife" }, boot)).toBe("Tài khoản riêng tư: chỉ chủ tài khoản thấy từng khoản");
    expect(privateAccountLine({ accountId: "cash-wife" }, boot)).toBeNull();
    expect(privateAccountLine({ accountId: null }, boot)).toBeNull();
  });

  it("UC-716 AC-9: từ Nhìn lại tháng 11 chạm danh mục Ăn ngoài → Sổ giao dịch tháng 11 + chip Ăn ngoài, tổng Chi đọc cùng tháng (month, không cycle)", () => {
    const today = new Date("2026-11-25T03:00:00Z");
    const f = monthFilter("2026-11", "eating-out", today);
    expect(f).toMatchObject({ month: "2026-11", fromDate: null, toDate: null, categoryId: "eating-out" });
    expect(filterChips(f, { ...boot, categories: [{ id: "eating-out", name: "Ăn ngoài" }] } as unknown as Bootstrap).map((c) => c.label)).toEqual(["Ăn ngoài"]);
    expect(summaryPath(f)).toBe("/v1/transactions/summary?month=2026-11&category_id=eating-out");
    expect(bookPath(monthFilter("2026-10", "eating-out", today))).toBe("/v1/transactions?month=2026-10&category_id=eating-out&limit=51");
  });

  it("UC-716 AC-23: không còn chip kỳ; tháng + danh mục trên địa chỉ #ledger?month=…&category=… để F5 giữ cả hai; ghi thêm ở tháng đã qua điền ngày cuối tháng", () => {
    const today = new Date("2026-11-25T03:00:00Z");
    const f = monthFilter("2026-11", "eating-out", today);
    const q = bookHashQuery(f, today);
    expect(q).toBe("month=2026-11&category=eating-out");
    expect(bookFromHashQuery(q, today)).toEqual(f);
    expect(filterChips(f, boot).map((c) => c.key)).toEqual(["categoryId"]);
    expect(JSON.stringify(filterChips(f, boot))).not.toMatch(/Kỳ|cycle/);
    const oct = monthFilter("2026-10", null, today);
    expect(bookHashQuery(oct, today)).toBe("month=2026-10");
    expect(bookFromHashQuery(bookHashQuery(oct, today), today)).toEqual(oct);
    expect(entryDay(oct, today)).toBe("2026-10-31");
    expect(entryDay(f, today)).toBe("2026-11-25");
    expect(clearFilters(f, today)).toMatchObject({ month: "2026-11", categoryId: null });
  });

  it("UC-716 AC-25: địa chỉ cũ #ledger?cycle=2026-11-10&category=eating-out → bộ lọc tháng 11 + Ăn ngoài, địa chỉ ghi lại thành month=2026-11&category=eating-out; không gọi API với cycle", () => {
    const today = new Date("2026-11-25T03:00:00Z");
    const f = bookFromHashQuery("cycle=2026-11-10&category=eating-out", today);
    expect(f).toEqual(monthFilter("2026-11", "eating-out", today));
    expect(bookHashQuery(f, today)).toBe("month=2026-11&category=eating-out");
    expect(bookPath(f)).toBe("/v1/transactions?month=2026-11&category_id=eating-out&limit=51");
    expect(summaryPath(f)).not.toContain("cycle");
    // Địa chỉ cũ hơn mang category_id và cycle_from / cycle_to: vẫn ra tháng của ngày lương.
    const old = bookFromHashQuery("category_id=eating-out&cycle=2026-10-10&cycle_from=2026-10-10&cycle_to=2026-11-09", today);
    expect(old).toEqual(monthFilter("2026-10", "eating-out", today));
    expect(bookPath(old)).not.toContain("cycle");
  });

  it("UC-716 AC-23: địa chỉ chỉ mang bộ lọc khác mặc định, đọc lại đủ mọi ô; chữ lạ trên địa chỉ bị bỏ qua", () => {
    expect(bookHashQuery(f0, now)).toBe("");
    expect(bookFromHashQuery("", now)).toEqual(f0);
    const full: BookFilter = { ...f0, month: "2026-09", meanings: ["spend", "refund"], categoryId: "medicine", accountId: "cash-wife", memberId: "wife", source: "bank", q: "thuốc ", showVoid: true };
    expect(bookFromHashQuery(bookHashQuery(full, now), now)).toEqual(full);
    const range: BookFilter = { ...f0, month: null, fromDate: "2026-09-01", toDate: "2026-09-15" };
    expect(bookFromHashQuery(bookHashQuery(range, now), now)).toEqual(range);
    expect(bookFromHashQuery("month=all", now)).toEqual({ ...f0, month: null });
    expect(bookFromHashQuery("month=13-2026&source=x&cycle=10-11-2026&from_date=hôm-qua", now)).toEqual(f0);
  });

  it("chữ tìm: gửi khi đủ 2 ký tự (đã cắt khoảng trắng, mã hoá URL), ngắn hơn thì chưa tìm", () => {
    expect(bookPath({ ...f0, month: null, q: "  shopee " })).toBe("/v1/transactions?q=shopee&limit=51");
    expect(bookPath({ ...f0, month: null, q: "thuốc 50%" })).toBe(`/v1/transactions?q=${encodeURIComponent("thuốc 50%").replace(/%20/g, "+")}&limit=51`);
    expect(bookPath({ ...f0, month: null, q: "s" })).toBe("/v1/transactions?limit=51");
  });

  it("bộ lọc đang bật thành chip có tên dễ đọc; chạm × bỏ đúng bộ lọc đó; loại giữ thứ tự của danh sách", () => {
    const f: BookFilter = { ...toggleMeaning(toggleMeaning(f0, "refund"), "spend"), categoryId: "medicine", accountId: "cash-wife", memberId: "wife", source: "bank", showVoid: true };
    expect(f.meanings).toEqual(["spend", "refund"]);
    const chips = filterChips(f, boot);
    expect(chips.map((c) => c.label)).toEqual(["Chi tiêu", "Hoàn tiền", "Thuốc thang", "Tiền mặt (vợ)", "Vợ ghi", "Từ ngân hàng", "Có khoản đã xoá"]);
    expect(removeChip(f, chips[1]!).meanings).toEqual(["spend"]);
    expect(removeChip(f, chips[2]!).categoryId).toBeNull();
    expect(removeChip(f, chips[6]!).showVoid).toBe(false);
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
    // Với đối tượng BookFilter có toDate trong quá khứ:
    expect(entryDay({ ...f0, month: null, fromDate: "2026-09-01", toDate: "2026-09-15" }, now)).toBe("2026-09-15");
    // Khoảng ngày chứa hôm nay (hôm nay 06/10/2026):
    expect(entryDay({ ...f0, month: null, fromDate: "2026-10-01", toDate: "2026-10-06" }, now)).toBe("2026-10-06");
    // Không có toDate (chỉ có fromDate):
    expect(entryDay({ ...f0, month: null, fromDate: "2026-09-01", toDate: null }, now)).toBe("2026-10-06");
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
      ["T2 5/10 · chi 312.000\u00a0₫", [5, 4, 3, 2, 1]],
      ["T7 3/10", [0]],
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

  it("UC-716 AC-24: tháng có khoản cũ (legacy, legacy_class) và khoản mới → dòng cũ có nhãn 'cách tính cũ', dòng mới không; tiêu đề ngày và tổng Chi tính như nhau, không phụ thuộc ví", () => {
    const old = { ...row(2, "2026-10-05T08:00:00Z", "spend", 150_000), legacy: true, legacy_class: "essential" as const };
    const fresh = { ...row(3, "2026-10-05T10:00:00Z", "spend", 400_000), legacy: false, legacy_class: null };
    expect(LEGACY_LABEL).toBe("cách tính cũ");
    expect([old, fresh].map(isLegacyTx)).toEqual([true, false]);
    expect(groupByDay([fresh, old]).map((g) => g.heading)).toEqual(["T2 5/10 · chi 550.000\u00a0₫"]);
    const zero = { count: 0, spend: 0, refund: 0, income: 0, lend: 0, collect: 0, transfer: 0, buy_asset: 0, adjust_in: 0, adjust_out: 0 };
    expect(summaryParts({ ...zero, count: 2, spend: 550_000 })[0]).toEqual({ label: "Chi", amount: 550_000 });
  });
});
