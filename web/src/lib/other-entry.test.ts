import { describe, expect, it } from "vitest";
import { incomeBody, isSalaryDefault, queuedBody, queuedMissing, type QueuedDraft } from "./other-entry";

const AT = "2026-11-10T03:00:00.000Z";
const streams = [
  { id: "salary-husband", is_salary: true },
  { id: "side", is_salary: false },
];

describe("Ghi thu nhập không chia (pwa UC-705)", () => {
  it("UC-705 AC-33: nguồn Lương → ô 'Đây là lương' bật sẵn, Việc phụ → tắt; lưu → thân có is_salary, không opens_cycle / allocate / wallet_id; tiền người thuê / tiền lãi → không gửi is_salary", () => {
    expect(isSalaryDefault(streams, "salary-husband", 20_000_000, 5_000_000)).toBe(true);
    expect(isSalaryDefault(streams, "side", 20_000_000, 5_000_000)).toBe(false);
    const body = incomeBody({ amount: 20_000_000, at: AT, clientId: "c1", accountId: "main", taxable: false, streamId: "salary-husband", tenantId: "", note: "", isSalary: true });
    expect(body).toEqual({ meaning: "income", amount: 20_000_000, at: AT, client_id: "c1", account_id: "main", taxable: false, income_stream_id: "salary-husband", is_salary: true });
    expect(JSON.stringify(body)).not.toMatch(/allocate|wallet|wealth|opens_cycle/);
    expect(incomeBody({ amount: 4_000_000, at: AT, clientId: "c2", accountId: "main", taxable: false, streamId: "", tenantId: "t1", note: "", isSalary: true })).not.toHaveProperty("is_salary");
    expect(incomeBody({ amount: 37_000, at: AT, clientId: "c5", accountId: "main", taxable: false, streamId: "", tenantId: "", note: "", isSalary: false, isInterest: true })).not.toHaveProperty("is_salary");
  });

  it("UC-705 AC-39: không nguồn, ngưỡng nhắc trích 5.000.000 → 20.000.000 bật sẵn, 1.200.000 tắt; tắt tay → gửi is_salary: false (lưu 'không phải lương'); ngưỡng chưa có trong cài đặt → 5.000.000", () => {
    expect(isSalaryDefault(streams, "", 20_000_000, 5_000_000)).toBe(true);
    expect(isSalaryDefault(streams, "", 1_200_000, 5_000_000)).toBe(false);
    expect(isSalaryDefault(streams, "", 5_000_000, undefined)).toBe(true);
    expect(isSalaryDefault(streams, "", 3_000_000, 2_000_000)).toBe(true);
    expect(isSalaryDefault(streams, "", 0, 5_000_000)).toBe(false);
    const off = incomeBody({ amount: 20_000_000, at: AT, clientId: "c6", accountId: "main", taxable: false, streamId: "", tenantId: "", note: "", isSalary: false });
    expect(off).toMatchObject({ is_salary: false });
    expect(off).not.toHaveProperty("income_stream_id");
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

  it("UC-705 AC-37: chuyển tiền từ MB tiết kiệm sang tài khoản chính chọn chip 'Nhà ở' → thân có goal_id 'nha-o'; chi tiêu cũng mang; loại khác (hoàn tiền) không mang; không chọn → không gửi", () => {
    const t = { ...base, kind: "transfer" as const, accountId: "tk-tiet-kiem", toAccountId: "main", categoryId: null, goalId: "nha-o" };
    expect(queuedBody(t)).toEqual({ meaning: "transfer", amount: 6_000_000, at: AT, client_id: "c3", account_id: "tk-tiet-kiem", to_account_id: "main", goal_id: "nha-o" });
    expect(queuedBody({ ...base, accountId: "tk-tiet-kiem", goalId: "hoc-tap" })).toMatchObject({ meaning: "spend", goal_id: "hoc-tap" });
    expect(queuedBody({ ...base, kind: "refund", goalId: "hoc-tap" })).not.toHaveProperty("goal_id");
    expect(queuedBody({ ...t, goalId: null })).not.toHaveProperty("goal_id");
  });

  it("UC-705 AC-38: thu nhập vào khoản gửi với ô 'Đây là tiền lãi' → thân có is_interest: true; tắt ô → không gửi; chuyển ra chọn 'Từ tiền lãi' → from_interest: true, không goal_id; chỉ chi / chuyển mang", () => {
    const income = { amount: 3_000_000, at: AT, clientId: "c4", accountId: "gui-6t", taxable: false, streamId: "", tenantId: "", note: "", isSalary: false };
    expect(incomeBody({ ...income, isInterest: true })).toMatchObject({ meaning: "income", account_id: "gui-6t", is_interest: true });
    expect(incomeBody({ ...income, isInterest: false })).not.toHaveProperty("is_interest");
    expect(incomeBody(income)).not.toHaveProperty("is_interest");
    const t = { ...base, kind: "transfer" as const, accountId: "tk-tiet-kiem", toAccountId: "main", categoryId: null, goalId: "nha-o", fromInterest: true };
    expect(queuedBody(t)).toEqual({ meaning: "transfer", amount: 6_000_000, at: AT, client_id: "c3", account_id: "tk-tiet-kiem", to_account_id: "main", from_interest: true });
    expect(queuedBody({ ...base, accountId: "tk-tiet-kiem", fromInterest: true })).toMatchObject({ meaning: "spend", from_interest: true });
    expect(queuedBody({ ...base, kind: "refund", fromInterest: true })).not.toHaveProperty("from_interest");
    expect(queuedBody({ ...t, fromInterest: false })).not.toHaveProperty("from_interest");
  });
});
