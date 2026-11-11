import { describe, expect, it } from "vitest";
import { incomeBody, opensCycleDefault, queuedBody, queuedMissing, type QueuedDraft } from "./other-entry";

const AT = "2026-11-10T03:00:00.000Z";
const streams = [
  { id: "salary-husband", opens_cycle: true },
  { id: "side", opens_cycle: false },
];

describe("Ghi thu nhập không chia (pwa UC-705)", () => {
  it("UC-705 AC-33: nguồn Lương → công tắc 'Lương — mở kỳ lương' bật sẵn, Việc phụ → tắt; lưu → thân có opens_cycle, không allocate / wallet_id", () => {
    expect(opensCycleDefault(streams, "salary-husband")).toBe(true);
    expect(opensCycleDefault(streams, "side")).toBe(false);
    expect(opensCycleDefault(streams, "")).toBe(false);
    const body = incomeBody({ amount: 20_000_000, at: AT, clientId: "c1", accountId: "main", taxable: false, streamId: "salary-husband", tenantId: "", note: "", opensCycle: true });
    expect(body).toEqual({ meaning: "income", amount: 20_000_000, at: AT, client_id: "c1", account_id: "main", taxable: false, income_stream_id: "salary-husband", opens_cycle: true });
    expect(JSON.stringify(body)).not.toMatch(/allocate|wallet|wealth/);
    // tiền người thuê: không gửi opens_cycle (nguồn cho thuê không mở kỳ)
    expect(incomeBody({ amount: 4_000_000, at: AT, clientId: "c2", accountId: "main", taxable: false, streamId: "", tenantId: "t1", note: "", opensCycle: true })).not.toHaveProperty("opens_cycle");
  });
});

describe("Loại khác không ví (pwa UC-705)", () => {
  const base: QueuedDraft = { kind: "spend", amount: 6_000_000, at: AT, clientId: "c3", accountId: "saving", toAccountId: null, categoryId: "education", linkId: null, receivableId: null, assetKind: null, note: "" };

  it("UC-705 AC-35: chuyển nội bộ tài khoản chính → tài khoản tích luỹ → chỉ hai tài khoản, không ví / 'chỉ đổi chỗ'; thiếu tài khoản đích → không lưu được", () => {
    const t = { ...base, kind: "transfer" as const, accountId: "main", toAccountId: "wealth", categoryId: null };
    expect(queuedMissing(t)).toBeNull();
    expect(queuedBody(t)).toEqual({ meaning: "transfer", amount: 6_000_000, at: AT, client_id: "c3", account_id: "main", to_account_id: "wealth" });
    expect(JSON.stringify(queuedBody(t))).not.toMatch(/wallet|wealth_move/);
    expect(queuedMissing({ ...t, toAccountId: null })).toBe("Chọn hai tài khoản");
    expect(queuedMissing({ ...t, toAccountId: "main" })).toBe("Hai tài khoản phải khác nhau");
    expect(queuedMissing({ ...base, categoryId: null })).toBe("Chọn danh mục");
  });
});
