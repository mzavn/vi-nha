import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { canAddMember, codeOf, MAX_MEMBERS, memberSubmitError, newMemberPayload, passwordLine, passwordPayload, proofMode } from "./members";
import type { SettingsMember } from "./types";

const member = (patch: Partial<SettingsMember>): SettingsMember => ({ id: "husband", name: "Chồng", role: "owner", tg_chat_id: null, active: true, has_password: false, ...patch });

describe("mã thành viên sinh từ tên (như server)", () => {
  it("bỏ dấu, chữ thường, gạch nối; tên không có chữ / số thì mã rỗng", () => {
    expect(codeOf("Mẹ")).toBe("me");
    expect(codeOf("  Bé Đông ")).toBe("be-dong");
    expect(codeOf("!!!")).toBe("");
  });
});

describe("UC-507 AC-11: thêm người", () => {
  const house = [member({}), member({ id: "wife", name: "Vợ", role: "adult" }), member({ id: "me", name: "Bà", role: "adult", active: false })];

  it("tên bắt buộc, tối đa 40 ký tự; mật khẩu riêng để trống được, có thì ít nhất 8 ký tự", () => {
    expect(newMemberPayload({ name: "  Con  ", password: "" }, house)).toEqual({ ok: true, value: { name: "Con" } });
    expect(newMemberPayload({ name: "Con", password: "12345678" }, house)).toEqual({ ok: true, value: { name: "Con", password: "12345678" } });
    expect(newMemberPayload({ name: " ", password: "" }, house)).toMatchObject({ ok: false, errors: { name: expect.any(String) } });
    expect(newMemberPayload({ name: "a".repeat(41), password: "" }, house)).toMatchObject({ ok: false, errors: { name: expect.stringContaining("40") } });
    expect(newMemberPayload({ name: "Con", password: "1234567" }, house)).toMatchObject({ ok: false, errors: { password: expect.stringContaining("8") } });
  });

  it("trùng tên (không phân biệt hoa thường) hoặc trùng mã với bất kỳ ai, kể cả người đã tắt", () => {
    expect(newMemberPayload({ name: "vợ", password: "" }, house)).toMatchObject({ ok: false, errors: { name: expect.stringContaining("Vợ") } });
    expect(newMemberPayload({ name: "Me", password: "" }, house)).toMatchObject({ ok: false, errors: { name: expect.any(String) } });
    expect(newMemberPayload({ name: "Husband", password: "" }, house)).toMatchObject({ ok: false, errors: { name: expect.any(String) } });
    expect(newMemberPayload({ name: "###", password: "" }, house)).toMatchObject({ ok: false, errors: { name: expect.any(String) } });
  });

  it("đã có 6 người đang dùng thì không thêm được; người đã tắt không tính", () => {
    const six = Array.from({ length: MAX_MEMBERS }, (_, i) => member({ id: `m${i}`, name: `Người ${i}` }));
    expect(canAddMember(six)).toBe(false);
    expect(canAddMember(six.map((m, i) => (i === 0 ? { ...m, active: false } : m)))).toBe(true);
  });

  it("lỗi server: trùng → ô tên; quá 6 người, 429 → câu chung", () => {
    expect(memberSubmitError(new ApiError(409, "duplicate", "Đã có người tên này."))).toEqual({ field: "name", message: "Đã có người tên này." });
    expect(memberSubmitError(new ApiError(409, "too_many_members", "Nhà đã đủ 6 người."))).toEqual({ field: null, message: "Nhà đã đủ 6 người." });
    expect(memberSubmitError(new ApiError(400, "invalid_input", "Mật khẩu ngắn.", "password"))).toEqual({ field: "password", message: "Mật khẩu ngắn." });
    expect(memberSubmitError(new ApiError(401, "wrong_password", "Sai mật khẩu."))).toEqual({ field: "proof", message: "Sai mật khẩu." });
    expect(memberSubmitError(new ApiError(429, "too_many_attempts", "Thử lại sau 15 phút."))).toEqual({ field: null, message: "Thử lại sau 15 phút." });
    expect(memberSubmitError(new ApiError(400, "invalid_input", "Sai.", "current"))).toEqual({ field: "proof", message: "Sai." });
    expect(memberSubmitError(new ApiError(400, "invalid_input", "Lạ.", "tg_chat_id"))).toEqual({ field: null, message: "Lạ." });
  });
});

describe("UC-709: dòng nhỏ mật khẩu", () => {
  it("dùng mật khẩu riêng / dùng mật khẩu chung", () => {
    expect(passwordLine(member({ has_password: true }))).toBe("dùng mật khẩu riêng");
    expect(passwordLine(member({ has_password: false }))).toBe("dùng mật khẩu chung");
    // Bản cài đặt lưu offline từ trước khi có mật khẩu riêng: coi như dùng mật khẩu chung.
    expect(passwordLine(member({ has_password: undefined }))).toBe("dùng mật khẩu chung");
  });
});

describe("UC-507 AC-13: đặt / đổi / gỡ mật khẩu riêng", () => {
  it("đổi của người khác luôn hỏi mật khẩu chung", () => {
    expect(proofMode({ self: false, hasPassword: true, useHousehold: false })).toBe("household");
    expect(passwordPayload({ proof: "chung123", password: "riengmoi1", remove: false }, "household")).toEqual({
      ok: true,
      value: { household_password: "chung123", password: "riengmoi1" },
    });
  });

  it("đổi của mình: hỏi mật khẩu đang dùng; chọn dùng mật khẩu chung thì gửi mật khẩu chung", () => {
    expect(proofMode({ self: true, hasPassword: true, useHousehold: false })).toBe("current");
    expect(proofMode({ self: true, hasPassword: true, useHousehold: true })).toBe("household");
    // Chưa có mật khẩu riêng: mật khẩu đang dùng chính là mật khẩu chung.
    expect(proofMode({ self: true, hasPassword: false, useHousehold: false })).toBe("household");
    expect(passwordPayload({ proof: "riengcu12", password: "riengmoi1", remove: false }, "current")).toEqual({ ok: true, value: { current: "riengcu12", password: "riengmoi1" } });
  });

  it("gỡ gửi password null; mật khẩu mới ít nhất 8 ký tự; phải nhập mật khẩu xác nhận", () => {
    expect(passwordPayload({ proof: "chung123", password: "", remove: true }, "household")).toEqual({ ok: true, value: { household_password: "chung123", password: null } });
    expect(passwordPayload({ proof: "chung123", password: "1234567", remove: false }, "household")).toMatchObject({ ok: false, errors: { password: expect.stringContaining("8") } });
    expect(passwordPayload({ proof: "", password: "12345678", remove: false }, "current")).toMatchObject({ ok: false, errors: { proof: expect.any(String) } });
  });
});
