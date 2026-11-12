import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { AUDIT_ACTIONS } from "../../../src/domain/audit-actions";
import { pocketsShared, SHARED_ACCOUNTS, sharedGoals } from "./household-b.fixture";
import {
  accountGoals,
  AUDIT_ACTION,
  accountPayload,
  accountSubmitError,
  accountToForm,
  appVersionLabel,
  auditView,
  bankHint,
  canSetOwner,
  canSetPrivate,
  clearSecretPayload,
  connectionPicker,
  configPayload,
  cycleStreamReminder,
  debtGoalSuggestions,
  feedFromSuggestion,
  followsCodeConvention,
  GOAL_POCKET_LOCK,
  goalAccountNote,
  goalAccountOptions,
  goalLineText,
  goalListGroups,
  goalOrderError,
  goalOrderPayload,
  goalOrderPreview,
  goalPayload,
  goalSubmitError,
  goalToForm,
  ORDER_CHANGED,
  TAX_ACCOUNT_SHARED,
  type GoalAccountOption,
  isoFromVnInput,
  memberPayload,
  normalizePattern,
  notifyPayload,
  OPENS_CYCLE_HINT,
  rewardAccountOptions,
  rulePayload,
  ruleToForm,
  secretLabel,
  sepaySyncText,
  secretPayload,
  scheduleRows,
  streamPayload,
  streamSummary,
  streamToForm,
  syncRangeError,
  vnDateTimeInput,
  accountParentField,
  accountParentHint,
  accountParentOptions,
  canAddDeposit,
  depositPreset,
  DEPOSITS_NOTE,
  GOAL_PLACE_LABEL,
  GOAL_SECTION_LABEL,
  goalPlace,
  OPERATING_HINT,
  OPERATING_MONTHLY_ONLY,
  operatingChoice,
  operatingGoalLines,
  PARENT_REWARD,
  PARENT_SEPAY,
  parentPocketText,
  PLACE_LABEL,
  pocketSheetGroups,
  POCKETS_SHEET_HEAD,
  sliderPct,
} from "./settings";
import { SAVINGS_MARKS, SAVINGS_SCALE_TEXT } from "./savings-scale";
import { groupAccountsByPocket, groupPayload, groupSummary, nextDueDate, pocketsPayload, unconfirmedChip } from "./pockets";
import { setAmountsHidden } from "./money";
import type { AuditEntry, CategoryGroup, Debt, NotifySchedule, ReserveGoal, SepayConnection, SettingsAccount, SettingsData } from "./types";

const NBSP = "\u00a0";

describe("bí mật chỉ ghi", () => {
  it("hiện 2 ký tự cuối, không bao giờ cả khoá", () => {
    expect(secretLabel({ set: true, hint: "12" })).toBe("Đã đặt ••••12");
    expect(secretLabel({ set: false, hint: null })).toBe("Chưa đặt");
    expect(secretLabel({ set: true, hint: null })).toBe("Đã đặt");
    // server lỡ trả cả khoá: vẫn chỉ hiện 2 ký tự cuối
    expect(secretLabel({ set: true, hint: "sk_live_abcdef9876" })).toBe("Đã đặt ••••76");
  });

  it("đặt khoá mới: bỏ khoảng trắng hai đầu, chặn rỗng và khoảng trắng giữa", () => {
    expect(secretPayload("api_token", "  tok123  ")).toEqual({ ok: true, value: { api_token: "tok123" } });
    expect(secretPayload("api_token", "   ").ok).toBe(false);
    expect(secretPayload("telegram_bot_token", "12 34").ok).toBe(false);
    expect(clearSecretPayload("webhook_key")).toEqual({ webhook_key: null });
  });
});

describe("nhật ký thay đổi", () => {
  it("mỗi dòng: việc + đối tượng, ai qua đâu lúc nào (giờ VN), tên trường đã đổi — không có giá trị", () => {
    const entry = (patch: Partial<AuditEntry>): AuditEntry => ({ id: 1, at: "2026-10-06 02:05:00", memberId: "husband", memberName: "Chồng", via: "session", action: "tx.void", target: "tx:12", detail: null, ...patch });
    expect(auditView(entry({}))).toEqual({ title: "Huỷ giao dịch #12", sub: "Chồng · 09:05 6/10", fields: null });
    expect(auditView(entry({ action: "push.add", target: "push:3", via: "token", detail: { member_id: "wife", device: "Android · Chrome" } }))).toMatchObject({
      title: "Thêm máy nhận thông báo: Android · Chrome",
      sub: "Chồng · qua API token · 09:05 6/10",
    });
    expect(auditView(entry({ action: "sepay.update", target: "sepay:default", detail: { fields: ["active", "webhook_key"], active: false } }))).toMatchObject({
      title: "Sửa kết nối SePay default",
      fields: "đổi: active, webhook_key",
    });
    expect(auditView(entry({ action: "integrations.update", target: null, memberName: null, detail: { set: ["telegram_bot_token"], cleared: ["zalo_bot_token"] } }))).toEqual({
      title: "Đổi khoá Telegram / Zalo",
      sub: "Không rõ ai · 09:05 6/10",
      fields: "đổi: telegram_bot_token, zalo_bot_token",
    });
  });

  it("UC-508: nối / gỡ ứng dụng AI và việc ghi qua Claude có tên dễ đọc", () => {
    const entry = (patch: Partial<AuditEntry>): AuditEntry => ({ id: 1, at: "2026-10-06 02:05:00", memberId: "husband", memberName: "Chồng", via: "session", action: "mcp.connect", target: "client:claude.ai", detail: null, ...patch });
    expect(auditView(entry({ detail: { member_id: "husband", scopes: ["mcp:read", "mcp:write"] } }))).toEqual({
      title: "Nối ứng dụng AI: claude.ai",
      sub: "Chồng · 09:05 6/10",
      fields: null,
    });
    expect(auditView(entry({ action: "mcp.revoke" })).title).toBe("Gỡ kết nối ứng dụng AI: claude.ai");
    expect(auditView(entry({ action: "tx.create", target: "tx:40", via: "mcp" }))).toMatchObject({ title: "Ghi giao dịch #40", sub: "Chồng · qua Claude · 09:05 6/10" });
    expect(auditView(entry({ action: "log.assign", target: "log:7", via: "mcp" })).title).toBe("Gán giao dịch ngân hàng #7");
    // UC-207: chốt tháng ghi nhật ký với target "month:YYYY-MM".
    expect(auditView(entry({ action: "month.close", target: "month:2026-10", detail: { wealth_pct: 50 } })).title).toBe("Chốt tháng 2026-10");
    // Nhật ký mới của audit v2 (access UC-505): nguồn thu, bỏ qua log, danh mục.
    expect(auditView(entry({ action: "income_stream.create", target: "income_stream:luong-vo" })).title).toBe("Thêm nguồn thu luong-vo");
    expect(auditView(entry({ action: "income_stream.update", target: "income_stream:luong", detail: { fields: ["opens_cycle"] } }))).toMatchObject({ title: "Sửa nguồn thu luong", fields: "đổi: opens_cycle" });
    expect(auditView(entry({ action: "log.ignore", target: "log:L4" })).title).toBe("Bỏ qua giao dịch ngân hàng #L4");
    expect(auditView(entry({ action: "category.create", target: "category:qua-tang" })).title).toBe("Thêm danh mục qua-tang");
    expect(auditView(entry({ action: "category.update", target: "category:qua-tang" })).title).toBe("Sửa danh mục qua-tang");
  });

  it("UC-709 AC-50: mọi mã nhật ký server ghi (AUDIT_ACTIONS) đều có nhãn tiếng Việt; bốn nhãn mới; mã cũ (chia khoản thu, chốt tháng) giữ nhãn", () => {
    for (const action of AUDIT_ACTIONS) expect(AUDIT_ACTION[action], action).toMatch(/^\p{Lu}/u);
    const entry = (action: string, target: string | null): AuditEntry => ({ id: 1, at: "2026-11-12 02:05:00", memberId: "husband", memberName: "Chồng", via: "session", action, target, detail: null });
    expect(auditView(entry("category_group.create", "category_group:an-uong")).title).toBe("Thêm nhóm danh mục an-uong");
    expect(auditView(entry("category_group.update", "category_group:an-uong")).title).toBe("Sửa nhóm danh mục an-uong");
    expect(auditView(entry("pockets.confirm", null)).title).toBe("Xác nhận ngăn tài khoản");
    expect(auditView(entry("goal.order", "goal:*")).title).toBe("Đổi thứ tự mục tiêu *");
    expect(AUDIT_ACTION["income.allocate"]).toBe("Chia khoản thu");
    expect(AUDIT_ACTION["month.close"]).toBe("Chốt tháng");
  });
});

describe("kết nối SePay", () => {
  const secret = { set: false, hint: null, source: null };
  const conn = (id: string, active = true): SepayConnection => ({ id, name: id, active, api_token: secret, webhook_key: secret, accounts: [] });

  it("ô Nối qua hiện khi có từ hai kết nối đang bật hoặc kết nối đã lưu đang tắt; kết nối đã lưu đang tắt vẫn được giữ, kết nối tắt khác không chọn được", () => {
    // Một kết nối đang bật, tài khoản nối qua nó: không cần ô chọn.
    expect(connectionPicker([conn("default"), conn("wife", false)], "default", "default")).toBeNull();
    // Tài khoản đã lưu qua kết nối nay đã tắt: hiện ô, giữ nguyên lựa chọn, kể cả khi chỉ còn một kết nối bật.
    const kept = connectionPicker([conn("default"), conn("wife", false)], "wife", "wife");
    expect(kept?.options.map((c) => c.id)).toEqual(["default", "wife"]);
    expect(kept?.value).toBe("wife");
    const all = [conn("default"), conn("wife"), conn("cu", false)];
    const p = connectionPicker(all, "wife", "wife");
    expect(p?.options.map((c) => c.id)).toEqual(["default", "wife"]);
    expect(p?.value).toBe("wife");
    // Kết nối tắt không phải kết nối đã lưu thì không có trong danh sách: rơi về kết nối chính.
    expect(connectionPicker(all, "cu", "")?.value).toBe("default");
    expect(connectionPicker(all, "", "")?.value).toBe("default");
  });

  it("đồng bộ lại: tối đa 31 ngày tính cả hai đầu, không lùi ngược, không quá hôm nay", () => {
    expect(syncRangeError("2026-09-02", "2026-10-02", "2026-10-03")).toBeNull();
    expect(syncRangeError("2026-09-01", "2026-10-02", "2026-10-03")).toContain("tối đa 31 ngày");
    expect(syncRangeError("2026-10-03", "2026-10-03", "2026-10-03")).toBeNull();
    expect(syncRangeError("2026-10-03", "2026-10-02", "2026-10-03")).not.toBeNull();
    expect(syncRangeError("2026-10-02", "2026-10-04", "2026-10-03")).not.toBeNull();
    expect(syncRangeError("", "2026-10-03", "2026-10-03")).not.toBeNull();
  });
});

describe("tài khoản riêng tư (UC-709 AC-44)", () => {
  const acc = (over: Partial<SettingsAccount> = {}): SettingsAccount => ({
    id: "mb-wife", name: "MB (vợ)", kind: "bank", bank: "MBBank", account_no: "1", sub_account: null, sepay_enabled: false, sepay_out: false, sepay_connection_id: null,
    owner_member_id: "wife", opening_balance: 0, opened_at: null, feed_from: null, sepay_out_from: null, first_log_at: null, active: true, deactivated_at: null,
    book_balance: 0, pocket: "operating", pocket_confirmed: true, private: false, ...over,
  });

  it("UC-709 AC-44: vợ bật 'Riêng tư' ở tài khoản của mình, lưu → gửi private: true; chồng mở cùng sheet → không công tắc, không gửi; tài khoản không chủ / thêm mới → không công tắc, mặc định tắt", () => {
    expect(canSetPrivate(acc(), "wife")).toBe(true);
    const on = accountPayload({ ...accountToForm(acc()), private: true }, acc(), "wife");
    expect(on.ok && on.value).toMatchObject({ private: true });
    expect(canSetPrivate(acc(), "husband")).toBe(false);
    const husband = accountPayload({ ...accountToForm(acc()), private: true }, acc(), "husband");
    expect(husband.ok && "private" in husband.value).toBe(false);
    expect(canSetPrivate(acc({ owner_member_id: null }), "wife")).toBe(false);
    expect(canSetPrivate(null, "wife")).toBe(false);
    expect(accountToForm(null).private).toBe(false);
    const fresh = accountPayload({ ...accountToForm(null), name: "MB mới", bank: "MBBank", private: true }, null, "wife");
    expect(fresh.ok && "private" in fresh.value).toBe(false);
    // không đổi thì không gửi
    const same = accountPayload({ ...accountToForm(acc({ private: true })) }, acc({ private: true }), "wife");
    expect(same.ok && "private" in same.value).toBe(false);
  });

  it("UC-709 AC-47: chồng mở sheet VCB (vợ) (riêng tư của vợ), sửa tên rồi lưu → ô Chủ tài khoản không đổi được, thân gửi không có owner_member_id, private; vợ mở → đổi được chủ", () => {
    const vcbWife = acc({ id: "vcb-wife", name: "VCB (vợ)", private: true });
    expect(canSetOwner(vcbWife, "husband")).toBe(false);
    const husband = accountPayload({ ...accountToForm(vcbWife), name: "VCB (vợ) mới", owner_member_id: "husband" }, vcbWife, "husband");
    expect(husband.ok && husband.value).toMatchObject({ name: "VCB (vợ) mới" });
    expect(husband.ok && "owner_member_id" in husband.value).toBe(false);
    expect(husband.ok && "private" in husband.value).toBe(false);
    expect(canSetOwner(vcbWife, "wife")).toBe(true);
    const wife = accountPayload({ ...accountToForm(vcbWife), owner_member_id: "husband" }, vcbWife, "wife");
    expect(wife.ok && wife.value).toMatchObject({ owner_member_id: "husband" });
    // Tài khoản công khai, hay thêm mới: ai cũng chọn được chủ.
    expect(canSetOwner(acc(), "husband")).toBe(true);
    expect(canSetOwner(null, "husband")).toBe(true);
    const open = accountPayload({ ...accountToForm(acc()), owner_member_id: "husband" }, acc(), "husband");
    expect(open.ok && open.value).toMatchObject({ owner_member_id: "husband" });
  });
});

describe("tài khoản", () => {
  it("SePay chỉ cho tài khoản ngân hàng có số tài khoản", () => {
    const f = { ...accountToForm(null), name: "MB (vợ)", bank: "MBBank", sepay_enabled: true };
    const r = accountPayload(f, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.account_no).toBeTruthy();
    expect(accountPayload({ ...f, kind: "cash", account_no: "123" }, null).ok).toBe(false);
    const ok = accountPayload({ ...f, account_no: " 0888 123 456 " }, null);
    expect(ok.ok && ok.value).toMatchObject({ account_no: "0888123456", bank: "MBBank", sub_account: null, owner_member_id: null, opened_at: null });
    expect(ok.ok && "active" in ok.value).toBe(false);
  });

  const existing = (over: Partial<SettingsAccount> = {}): SettingsAccount => ({
    id: "vcb-husband",
    name: "VCB",
    kind: "bank",
    bank: "Vietcombank",
    account_no: "0011",
    sub_account: null,
    sepay_enabled: true,
    sepay_out: false,
    sepay_connection_id: "default",
    owner_member_id: null,
    opening_balance: 0,
    opened_at: null,
    feed_from: null,
    sepay_out_from: null,
    first_log_at: null,
    active: true,
    book_balance: 0,
    deactivated_at: null,
    ...over,
  });

  it("SePay chỉ bật được cho ngân hàng SePay hỗ trợ; tài khoản cũ đã nối sẵn vẫn sửa tên được", () => {
    const f = { ...accountToForm(null), name: "VCB", bank: "Vietcombank", account_no: "0011", sepay_enabled: true };
    const r = accountPayload(f, null);
    expect(!r.ok && r.errors.sepay_enabled).toBe("SePay chưa hỗ trợ ngân hàng này.");
    expect(accountPayload({ ...accountToForm(existing()), name: "VCB (chồng)" }, existing()).ok).toBe(true);
    expect(accountPayload({ ...accountToForm(existing()), bank: "Techcombank" }, existing()).ok).toBe(false);
  });

  it("SePay báo cả tiền ra chỉ gửi true khi SePay đang bật", () => {
    const on = accountPayload({ ...accountToForm(null), name: "MB", bank: "MBBank", account_no: "1", sepay_enabled: true, sepay_out: true }, null);
    expect(on.ok && on.value.sepay_out).toBe(true);
    const off = accountPayload({ ...accountToForm(null), name: "MB", bank: "MBBank", sepay_enabled: false, sepay_out: true }, null);
    expect(off.ok && off.value.sepay_out).toBe(false);
  });

  it("chỉ gửi kết nối SePay khi đang bật SePay và đã chọn kết nối", () => {
    const base = { ...accountToForm(null), name: "MB (vợ)", bank: "MBBank", account_no: "1", sepay_enabled: true };
    const picked = accountPayload({ ...base, sepay_connection_id: "wife" }, null);
    expect(picked.ok && picked.value.sepay_connection_id).toBe("wife");
    const unpicked = accountPayload(base, null);
    expect(unpicked.ok && "sepay_connection_id" in unpicked.value).toBe(false);
    const off = accountPayload({ ...base, sepay_enabled: false, sepay_connection_id: "wife" }, null);
    expect(off.ok && "sepay_connection_id" in off.value).toBe(false);
  });

  it("gợi ý khả năng SePay theo ngân hàng: chỉ tiền vào, cả hai chiều, chưa hỗ trợ, bắt buộc VA", () => {
    expect(bankHint("MBBank")).toBe("SePay: báo tiền vào, chưa báo tiền ra — khoản chi từ tài khoản này nhập tay.");
    expect(bankHint("Sacombank")).toBe("SePay: báo cả tiền vào lẫn tiền ra.");
    expect(bankHint("Techcombank")).toBe("SePay chưa hỗ trợ — ghi tay.");
    expect(bankHint("BIDV")).toContain("SePay chỉ nhận qua tài khoản ảo (VA)");
    expect(bankHint("")).toBeNull();
  });

  it("sửa thì gửi kèm active", () => {
    const r = accountPayload({ ...accountToForm(null), name: "Tiền mặt", kind: "cash", active: false }, existing({ kind: "cash", bank: null, sepay_enabled: false }));
    expect(r.ok && r.value.active).toBe(false);
  });

  it("UC-709 AC-40: thêm (Ngân hàng, Thẻ tín dụng) và sửa tài khoản không gửi spendable / role / locked — ngăn là thuộc tính duy nhất quyết tiền thuộc đâu", () => {
    const bank = accountPayload({ ...accountToForm(null), name: "MB (vợ)", bank: "MBBank" }, null);
    const card = accountPayload({ ...accountToForm(null), name: "Thẻ VCB", kind: "credit", bank: "Vietcombank" }, null);
    const edit = accountPayload({ ...accountToForm(existing()), name: "VCB mới" }, existing());
    for (const r of [bank, card, edit]) for (const key of ["spendable", "role", "locked"]) expect(r.ok && key in r.value).toBe(false);
    for (const key of ["spendable", "role", "locked"]) expect(key in accountToForm(existing())).toBe(false);
    const months = configPayload({ salary_min_amount: 0, interest_max_amount: 10_000, safety_fund_months: "0", payday_day: "10" });
    expect(!months.ok && months.errors.safety_fund_months).toBe("Số tháng là số nguyên từ 1 đến 24.");
  });

  it("UC-506 AC-24: đổi ngày mở sổ về sau giao dịch sớm nhất → 409 `opening_after_entries` hiện nguyên câu server dưới ô ngày; lỗi khác hiện trên nút", () => {
    const msg = "Tài khoản đã có giao dịch từ 15/9/2026 — huỷ hoặc sửa các giao dịch trước 1/10/2026 trước, hoặc chọn ngày mở sổ từ 15/9/2026 trở về trước.";
    expect(accountSubmitError(new ApiError(409, "opening_after_entries", msg))).toEqual({ field: "opened_at", message: msg });
    expect(accountSubmitError(new ApiError(400, "invalid_input", "Tên trống."))).toEqual({ field: null, message: "Tên trống." });
  });

  it("UC-506 AC-25: sheet tài khoản 'SePay theo dõi từ' — vừa bật SePay mặc định Lúc bật (không gửi, server tự đặt); Ngày số dư đầu gửi null; giờ tuỳ chọn gửi ISO; tài khoản mới không gửi", () => {
    const off = existing({ sepay_enabled: false, bank: "MBBank" });
    const on = { ...accountToForm(off), sepay_enabled: true };
    expect(on.feed_mode).toBe("enabled");
    const atEnable = accountPayload(on, off);
    expect(atEnable.ok && "feed_from" in atEnable.value).toBe(false);
    const opening = accountPayload({ ...on, feed_mode: "opening" }, off);
    expect(opening.ok && opening.value.feed_from).toBeNull();
    const custom = accountPayload({ ...on, feed_mode: "time", feed_from: isoFromVnInput("2026-10-15T22:25") }, off);
    expect(custom.ok && custom.value.feed_from).toBe("2026-10-15T15:25:00.000Z");
    const missing = accountPayload({ ...on, feed_mode: "time", feed_from: "" }, off);
    expect(!missing.ok && missing.errors.feed_from).toBe("Chọn giờ bắt đầu theo dõi.");
    // Tài khoản đã nối: có mốc thì hiện giờ đó, chưa có thì là Ngày số dư đầu.
    expect(accountToForm(existing({ feed_from: "2026-10-15T15:25:00.000Z" }))).toMatchObject({ feed_mode: "time", feed_from: "2026-10-15T15:25:00.000Z" });
    expect(accountToForm(existing()).feed_mode).toBe("opening");
    const fresh = accountPayload({ ...accountToForm(null), name: "MB", bank: "MBBank", account_no: "1", sepay_enabled: true }, null);
    expect(fresh.ok && "feed_from" in fresh.value).toBe(false);
    const sepayOff = accountPayload({ ...accountToForm(existing()), sepay_enabled: false }, existing());
    expect(sepayOff.ok && "feed_from" in sepayOff.value).toBe(false);
  });

  it("UC-506 AC-25: giờ tuỳ chọn đọc / ghi theo giờ VN, giữ giây; lỗi mốc từ server hiện dưới ô mốc", () => {
    expect(vnDateTimeInput("2026-10-15T15:25:07.000Z")).toBe("2026-10-15T22:25:07");
    expect(isoFromVnInput("2026-10-15T22:25:07")).toBe("2026-10-15T15:25:07.000Z");
    expect(isoFromVnInput("")).toBe("");
    expect(isoFromVnInput("15/10/2026")).toBe("");
    expect(accountSubmitError(new ApiError(400, "invalid_input", "Mốc theo dõi SePay không được ở tương lai.", "feed_from"))).toEqual({
      field: "feed_from",
      message: "Mốc theo dõi SePay không được ở tương lai.",
    });
  });

  it("UC-506 AC-25: gợi ý đặt mốc khi tài khoản đã nối, chưa có mốc mà log SePay sớm nhất sau ngày số dư đầu", () => {
    const late = existing({ opened_at: "2026-10-01", first_log_at: "2026-10-15T15:25:00.000Z" });
    expect(feedFromSuggestion(late)).toBe("2026-10-15T15:25:00.000Z");
    // 06:00 ngày 1/10 giờ VN vẫn là ngày số dư đầu.
    expect(feedFromSuggestion(existing({ opened_at: "2026-10-01", first_log_at: "2026-09-30T23:00:00.000Z" }))).toBeNull();
    expect(feedFromSuggestion({ ...late, feed_from: "2026-10-15T15:25:00.000Z" })).toBeNull();
    expect(feedFromSuggestion({ ...late, sepay_enabled: false })).toBeNull();
    expect(feedFromSuggestion(existing({ opened_at: "2026-10-01" }))).toBeNull();
    expect(feedFromSuggestion(null)).toBeNull();
  });

  it("UC-302 AC-12: câu báo sau Đồng bộ lại đếm riêng giao dịch trước mốc theo dõi SePay", () => {
    const base = { from: "2026-10-01", to: "2026-10-17", added: 2, duplicates: 5, beforeOpening: 0, beforeFeed: 0, perConnection: [], errors: [] };
    expect(sepaySyncText(base)).toBe("Đã lấy thêm 2 giao dịch, 5 đã có sẵn.");
    expect(sepaySyncText({ ...base, beforeOpening: 1, beforeFeed: 3, errors: ["SePay chính: lỗi"] })).toBe(
      "Đã lấy thêm 2 giao dịch, 5 đã có sẵn. 1 giao dịch trước ngày mở sổ — đã có trong số dư đầu, không ghi lại. 3 giao dịch trước mốc theo dõi SePay — đã có trong sổ, không ghi lại. Có chỗ chưa lấy được — xem lý do dưới nút Đồng bộ.",
    );
  });
});

describe("mã chuyển khoản", () => {
  it("chuẩn hoá mẫu: bỏ dấu, viết hoa", () => {
    expect(normalizePattern("code", " exe ")).toBe("EXE");
    expect(normalizePattern("content", "đổ  xăng")).toBe("DO XANG");
    expect(normalizePattern("account", "0888 123")).toBe("0888123");
  });

  it("quy ước [QE]xx chỉ để nhắc", () => {
    expect(followsCodeConvention("EXE")).toBe(true);
    expect(followsCodeConvention("QTT")).toBe(true);
    expect(followsCodeConvention("ABC")).toBe(false);
    expect(followsCodeConvention("EXEX")).toBe(false);
  });

  it("khoản chi cần danh mục, không ô ví; thu nhập luôn là lương", () => {
    const f = { ...ruleToForm(null), pattern: "eme" };
    const r = rulePayload(f, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["category_id"]);
    const inc = rulePayload({ ...f, meaning: "income" }, true);
    expect(inc.ok && inc.value).toEqual({ match_type: "code", pattern: "EME", meaning: "income", category_id: null, priority: 50, is_salary: true });
    expect(JSON.stringify(inc)).not.toMatch(/wallet/);
  });

  it("sửa thì gửi thêm người chi và bật/tắt; mã có khoảng trắng bị chặn", () => {
    const f = { ...ruleToForm(null), pattern: "EMS", category_id: "shopping", by_member_id: "husband", active: false };
    const r = rulePayload(f, false);
    expect(r.ok && r.value).toMatchObject({ by_member_id: "husband", active: false, is_salary: false });
    expect(rulePayload({ ...f, pattern: "E!" }, false).ok).toBe(false);
  });
});

describe("thành viên, tham số", () => {
  const me = { id: "husband", name: "Chồng", role: "owner", tg_chat_id: null, active: true };

  it("chỉ gửi trường đã đổi; chat_id là dãy số, nhóm có dấu trừ", () => {
    expect(memberPayload({ name: "Chồng", tg_chat_id: "123456789" }, me)).toEqual({ ok: true, value: { tg_chat_id: "123456789" } });
    expect(memberPayload({ name: "Chồng", tg_chat_id: "-1001234567890" }, me).ok).toBe(true);
    expect(memberPayload({ name: "Chồng", tg_chat_id: "@anh" }, me).ok).toBe(false);
    expect(memberPayload({ name: "Anh", tg_chat_id: "" }, me)).toEqual({ ok: true, value: { name: "Anh" } });
    expect(memberPayload({ name: "Chồng", tg_chat_id: "" }, { ...me, tg_chat_id: "123456" })).toEqual({ ok: true, value: { tg_chat_id: null } });
  });

  const config = { salary_min_amount: 0, interest_max_amount: 10_000, safety_fund_months: "6", payday_day: "10" };

  it("số tháng phao 1–24, ngưỡng lương không âm", () => {
    expect(configPayload(config)).toEqual({
      ok: true,
      value: { salary_min_amount: 0, interest_max_amount: 10_000, safety_fund_months: 6, payday_day: 10 },
    });
    expect(configPayload({ ...config, salary_min_amount: 5_000_000, safety_fund_months: "0" }).ok).toBe(false);
    expect(configPayload({ ...config, salary_min_amount: 5_000_000, safety_fund_months: "3,5" }).ok).toBe(false);
  });

  it("UC-507: ngưỡng lãi tiền gửi 0..10.000.000 (0 = tắt); quá trần → lỗi ở ô interest_max_amount", () => {
    expect(configPayload({ ...config, interest_max_amount: 0 })).toMatchObject({ ok: true, value: { interest_max_amount: 0 } });
    expect(configPayload({ ...config, interest_max_amount: 10_000_000 })).toMatchObject({ ok: true, value: { interest_max_amount: 10_000_000 } });
    expect(configPayload({ ...config, interest_max_amount: 10_000_001 })).toMatchObject({ ok: false, errors: { interest_max_amount: expect.any(String) } });
  });

  it("UC-709 AC-43: 'Dư cuối kỳ vào Tích luỹ' 60 và Ví Thưởng → gửi surplus_savings_pct, surplus_reward_account; 101 → 'Phần trăm từ 0 đến 100.'; Chưa chọn → null; không còn surplus_reward_earmark / tham số chốt tháng", () => {
    expect(configPayload({ ...config, surplus_savings_pct: "60", surplus_reward_account: "buffer" })).toMatchObject({ ok: true, value: { surplus_savings_pct: 60, surplus_reward_account: "buffer" } });
    const none = configPayload({ ...config, surplus_savings_pct: "0", surplus_reward_account: "" });
    expect(none).toMatchObject({ ok: true, value: { surplus_savings_pct: 0, surplus_reward_account: null } });
    expect(none.ok && "surplus_reward_earmark" in none.value).toBe(false);
    for (const bad of ["101", "-1", "2,5", "", "abc"]) {
      expect(configPayload({ ...config, surplus_savings_pct: bad })).toEqual({ ok: false, errors: { surplus_savings_pct: "Phần trăm từ 0 đến 100." } });
    }
    const old = configPayload(config);
    expect(old.ok && Object.keys(old.value).some((k) => k.startsWith("month_close") || k.startsWith("surplus"))).toBe(false);
  });

  it("UC-709 AC-34: ngày lương 1–31 (tháng ít ngày hơn lấy ngày cuối tháng); ngoài khoảng / số lẻ / trống → lỗi ở ô payday_day", () => {
    expect(configPayload({ ...config, payday_day: "5" })).toMatchObject({ ok: true, value: { payday_day: 5 } });
    expect(configPayload({ ...config, payday_day: "31" })).toMatchObject({ ok: true, value: { payday_day: 31 } });
    for (const bad of ["0", "32", "1,5", "", "abc"]) {
      expect(configPayload({ ...config, payday_day: bad })).toEqual({ ok: false, errors: { payday_day: "Ngày lương là số nguyên từ 1 đến 31." } });
    }
  });
});

describe("giờ nhắc", () => {
  const schedule = (patch: Partial<NotifySchedule> = {}): NotifySchedule => ({
    dailyTime: "07:00",
    weeklyDay: 1,
    weeklyTime: "08:00",
    quietStart: "22:00",
    quietEnd: "06:30",
    dailyEnabled: true,
    weeklyEnabled: true,
    pendingEnabled: true,
    ...patch,
  });

  it("thân PATCH đủ trường snake_case; giờ phải HH:MM, phút chia hết cho 15; thứ 1–7", () => {
    expect(notifyPayload(schedule({ weeklyDay: 7, pendingEnabled: false }))).toEqual({
      ok: true,
      value: { daily_time: "07:00", weekly_day: 7, weekly_time: "08:00", quiet_start: "22:00", quiet_end: "06:30", daily_enabled: true, weekly_enabled: true, pending_enabled: false },
    });
    const bad = notifyPayload(schedule({ dailyTime: "07:05", weeklyTime: "", quietEnd: "24:00", quietStart: "22:10", weeklyDay: 0 }));
    expect(bad.ok ? [] : Object.keys(bad.errors).sort()).toEqual(["daily_time", "quiet_end", "quiet_start", "weekly_day", "weekly_time"]);
  });

  it("tóm tắt: tắt thì ghi Tắt (không còn tin mời chốt tháng), giờ yên lặng bằng nhau là Không đặt", () => {
    expect(scheduleRows(schedule()).map((r) => r.value)).toEqual(["07:00", "Thứ Hai 08:00", "Bật", "22:00–06:30"]);
    const off = scheduleRows(schedule({ dailyEnabled: false, weeklyEnabled: false, quietStart: "00:00", quietEnd: "00:00" }));
    expect(off.map((r) => r.value)).toEqual(["Tắt", "Tắt", "Bật", "Không đặt"]);
    expect(off[0]!.sub).toBe("Đang tắt — mở Hôm nay để xem việc cần làm");
    const on = scheduleRows(schedule());
    expect(on[0]!.sub).toBe("Chi khoảng mỗi ngày tới kỳ lương, nhóm gần hạn mức, đối soát, việc cần làm");
    expect(on[1]!.sub).toBe("Chi tuần và chi từ Vận hành, nhóm có hạn mức, top 5 danh mục");
  });
});

describe("nguồn thu: Mở kỳ lương (UC-709)", () => {
  const salary = { id: "salary-husband", name: "Lương", sort: 10, active: true, pocket: null, opens_cycle: false };

  it("UC-709 AC-42: bật 'Mở kỳ lương' cho nguồn Lương, lưu → gửi opens_cycle: true; có câu dặn nhà hai người; không còn phần khoá", () => {
    const f = { ...streamToForm(salary), opens_cycle: true };
    expect(streamPayload(f, false)).toEqual({ ok: true, value: { name: "Lương", active: true, pocket: null, opens_cycle: true } });
    expect(OPENS_CYCLE_HINT).toBe("Lương về từ nguồn này mở kỳ lương mới và danh sách việc. Nhà hai người lương khác ngày: chỉ bật cho một nguồn.");
    expect(streamToForm({ ...salary, opens_cycle: true }).opens_cycle).toBe(true);
    expect(JSON.stringify(streamToForm(salary))).not.toMatch(/locks/);
    expect(streamSummary({ ...salary, opens_cycle: true })).toBe("Mở kỳ lương");
    expect(streamPayload({ ...f, name: " " }, true).ok).toBe(false);
  });

  it("UC-709 AC-45: không nguồn nào bật Mở kỳ lương → dòng nhắc; bật một nguồn → mất; nguồn cho thuê không gửi opens_cycle", () => {
    const rent = { ...salary, id: "rental", name: "Cho thuê" };
    expect(cycleStreamReminder([salary, rent])).toBe("Chưa có nguồn nào mở kỳ lương: bật cho nguồn lương chính để lương về có danh sách việc.");
    expect(cycleStreamReminder([{ ...salary, opens_cycle: true }, rent])).toBeNull();
    expect(cycleStreamReminder([{ ...salary, opens_cycle: undefined }])).toBeNull();
    expect(streamPayload({ ...streamToForm(rent), opens_cycle: true }, false, true)).toEqual({ ok: true, value: { name: "Cho thuê", active: true, pocket: null } });
  });
});

describe("mã lương chọn nguồn thu", () => {
  it("sửa mã lương gửi nguồn; mã khác luôn xoá nguồn", () => {
    const f = { ...ruleToForm(null), pattern: "LUONG", meaning: "income" as const, income_stream_id: "salary-wife" };
    expect(rulePayload(f, false)).toMatchObject({ ok: true, value: { income_stream_id: "salary-wife" } });
    expect(rulePayload({ ...f, meaning: "spend", category_id: "groceries" }, false)).toMatchObject({ ok: true, value: { income_stream_id: null } });
    expect(rulePayload({ ...f, income_stream_id: "" }, false)).toMatchObject({ ok: true, value: { income_stream_id: null } });
  });
});

describe("về Ví nhà", () => {
  it("phiên bản lấy từ package.json lúc build; không có thì ghi Bản phát triển", () => {
    expect(appVersionLabel("1.0.1")).toBe("Phiên bản 1.0.1");
    expect(appVersionLabel("")).toBe("Bản phát triển");
  });
});

describe("Ba ngăn (UC-709 AC-35…39)", () => {
  const account = (over: Partial<SettingsAccount> = {}): SettingsAccount => ({
    id: "mb",
    name: "MB chính",
    kind: "bank",
    bank: "MBBank",
    account_no: "0011",
    sub_account: null,
    sepay_enabled: false,
    sepay_out: false,
    sepay_connection_id: null,
    owner_member_id: null,
    opening_balance: 0,
    opened_at: null,
    feed_from: null,
    sepay_out_from: null,
    first_log_at: null,
    active: true,
    book_balance: 0,
    deactivated_at: null,
    pocket: "operating",
    pocket_confirmed: true,
    ...over,
  });
  const goal = (over: Partial<ReserveGoal> = {}): ReserveGoal => ({
    id: "hoc-phi",
    name: "Học phí",
    account_id: "bidv",
    suggested_account_id: null,
    held: 4_000_000,
    need: 6_000_000,
    spent: 0,
    short: 2_000_000,
    target_amount: 6_000_000,
    target_pct: null,
    monthly_amount: 2_000_000,
    repeat_months: 3,
    due_date: "2027-01-15",
    debt_id: null,
    sort: 100,
    active: true,
    ...over,
  });
  const accounts = [
    account({ id: "tcb", name: "TCB", pocket: "savings", pocket_confirmed: false }),
    account({ id: "bidv", name: "BIDV", pocket: "reserve" }),
    account({ id: "mb", name: "MB chính", pocket: "operating", pocket_confirmed: false }),
    account({ id: "visa", name: "Thẻ VIB", kind: "credit", pocket: "operating" }),
    account({ id: "cash", name: "Tiền mặt", kind: "cash", pocket: null }),
    account({ id: "old", name: "ACB cũ", active: false, pocket: null, pocket_confirmed: false }),
  ];

  it("UC-709 AC-35: chip 'N chưa xác nhận' chỉ đếm tài khoản đang dùng chưa xác nhận ngăn; 0 thì không có chip", () => {
    expect(unconfirmedChip(accounts)).toBe("2 chưa xác nhận");
    expect(unconfirmedChip(accounts.map((a) => ({ ...a, pocket_confirmed: true })))).toBeNull();
    // Bản cài đặt lưu offline cũ chưa có trường ngăn: không hiện chip.
    expect(unconfirmedChip([account({ pocket: undefined, pocket_confirmed: undefined })])).toBeNull();
  });

  it("UC-709 AC-35: sheet xếp ngăn chia tài khoản đang dùng theo 4 nhóm Tích luỹ / Dự phòng / Vận hành / Ngoài ngăn, theo ngăn đang chọn", () => {
    const choice = { tcb: "savings", bidv: "reserve", mb: "operating", visa: "operating", cash: null } as const;
    const groups = groupAccountsByPocket(accounts, choice);
    expect(groups.map((g) => [g.label, g.accounts.map((a) => a.id)])).toEqual([
      ["Tích luỹ", ["tcb"]],
      ["Dự phòng", ["bidv"]],
      ["Vận hành", ["mb", "visa"]],
      ["Ngoài ngăn", ["cash"]],
    ]);
    // Đổi ngăn một dòng thì dòng đó sang nhóm mới; nhóm rỗng vẫn hiện.
    const moved = groupAccountsByPocket(accounts, { ...choice, tcb: "operating" });
    expect(moved[0]!.accounts).toEqual([]);
    expect(moved[2]!.accounts.map((a) => a.id)).toEqual(["tcb", "mb", "visa"]);
  });

  it("UC-709 AC-35: Xác nhận gửi một lô PUT /v1/settings/pockets có đủ mọi tài khoản đang dùng", () => {
    expect(pocketsPayload(accounts, { tcb: "savings", bidv: "reserve", mb: "operating", visa: "operating", cash: null })).toEqual({
      accounts: [
        { id: "tcb", pocket: "savings" },
        { id: "bidv", pocket: "reserve" },
        { id: "mb", pocket: "operating" },
        { id: "visa", pocket: "operating" },
        { id: "cash", pocket: null },
      ],
    });
  });

  it("UC-709 AC-35: tài khoản gắn mục tiêu đang dùng không chọn được ngăn khác Dự phòng, kèm câu 'Bỏ gắn mục tiêu trước khi đổi ngăn'; mục tiêu đã tắt không giữ; tài khoản chung nêu đủ tên", () => {
    const list = [goal(), goal({ id: "cu", name: "Cũ", account_id: "mb", active: false }), goal({ id: "nha", name: "Nhà ở" })];
    expect(accountGoals("bidv", list).map((g) => g.name)).toEqual(["Học phí", "Nhà ở"]);
    expect(accountGoals("mb", list)).toEqual([]);
    expect(accountGoals("tcb", list)).toEqual([]);
    expect(GOAL_POCKET_LOCK).toBe("Bỏ gắn mục tiêu trước khi đổi ngăn");
  });

  it("UC-709 AC-35: sheet tài khoản có ô Ngăn — thêm mới (cả thẻ tín dụng) mặc định Vận hành; thêm mới chỉ gửi pocket khi người dùng chọn, sửa thì luôn gửi", () => {
    expect(accountToForm(null).pocket).toBe("operating");
    const f = { ...accountToForm(null), name: "Thẻ VIB", kind: "credit" as const, bank: "VIB" };
    const untouched = accountPayload(f, null);
    expect(untouched.ok && "pocket" in untouched.value).toBe(false);
    const touched = accountPayload({ ...f, pocket: "reserve", pocket_touched: true }, null);
    expect(touched.ok && touched.value.pocket).toBe("reserve");
    const existing = account({ id: "tcb", pocket: "operating", pocket_confirmed: false });
    const form = accountToForm(existing);
    expect(form.pocket).toBe("operating");
    const edit = accountPayload({ ...form, pocket: "savings" }, existing);
    expect(edit.ok && edit.value.pocket).toBe("savings");
    const outside = accountPayload({ ...accountToForm(account({ pocket: null })) }, account({ pocket: null }));
    expect(outside.ok && outside.value.pocket).toBeNull();
  });

  const names = [account({ id: "bidv", name: "BIDV" }), account({ id: "mb", name: "MB chính" })];

  it("UC-709 AC-36: dòng danh sách '{tên} · đã có {held} / {B} · trong {tài khoản} · hạn … · cách lặp'; chưa gắn → 'chưa có tài khoản'", () => {
    expect(goalLineText(goal(), names)).toBe("Học phí · đã có 4.000.000 / 6.000.000 · trong BIDV · hạn 15/01/2027 · 2.000.000/tháng, 3 tháng một lần");
    expect(goalLineText(goal({ id: "thue", name: "Thuế", account_id: "mb", target_amount: null, monthly_amount: null, repeat_months: null, due_date: null, target_pct: 10, held: 1_200_000 }), names)).toBe(
      "Thuế · đã có 1.200.000 · trong MB chính · 10% thu chịu thuế",
    );
    expect(goalLineText(goal({ name: "Bảo dưỡng xe", account_id: null, held: null, target_amount: 4_800_000, monthly_amount: null, repeat_months: null, due_date: "2027-03-31" }), names)).toBe(
      "Bảo dưỡng xe · chưa có tài khoản · hạn 31/03/2027",
    );
    expect(goalLineText(goal({ name: "Điện nước", target_amount: 1_300_000, monthly_amount: 1_300_000, repeat_months: 1, due_date: null, held: 0 }), names)).toBe(
      "Điện nước · đã có 0 / 1.300.000 · trong BIDV · 1.300.000/tháng",
    );
    expect(goalLineText(goal(), names)).not.toMatch(/để riêng|giữ riêng/);
    expect(goalLineText(goal({ held: 6_000_000, short: 0 }), names)).toBe("Học phí · đã có 6.000.000 / 6.000.000 · trong BIDV · đủ · hạn 15/01/2027 · 2.000.000/tháng, 3 tháng một lần");
  });

  it("UC-709 AC-36 (UC-718): đang che số tiền thì mọi số tiền trên dòng thành ••••, số tháng và % giữ nguyên", () => {
    setAmountsHidden(true);
    try {
      expect(goalLineText(goal(), names)).toBe("Học phí · đã có •••• / •••• · trong BIDV · hạn 15/01/2027 · ••••/tháng, 3 tháng một lần");
    } finally {
      setAmountsHidden(false);
    }
  });

  it("UC-709 AC-36: sheet thêm / sửa — lặp gửi số mỗi tháng + mấy tháng (kèm B = tích), một lần gửi B + hạn, thuế gửi %, ô Tài khoản gửi account_id (Chưa có → null)", () => {
    const base = { ...goalToForm(null), name: "Học phí", account_id: "bidv" };
    expect(goalToForm(null)).toMatchObject({ account_id: "", mode: "repeat", repeat_months: "1" });
    expect(goalPayload({ ...base, monthly_amount: 2_000_000, repeat_months: "3", due_date: "2027-01-15" }, null)).toEqual({
      ok: true,
      value: { name: "Học phí", account_id: "bidv", monthly_amount: 2_000_000, repeat_months: 3, target_amount: 6_000_000, target_pct: null, due_date: "2027-01-15", debt_id: null },
    });
    expect(goalPayload({ ...base, name: "Bảo dưỡng xe", account_id: "", mode: "once", target_amount: 4_800_000, due_date: "2027-03-31" }, null)).toMatchObject({
      ok: true,
      value: { account_id: null, target_amount: 4_800_000, monthly_amount: null, repeat_months: null, target_pct: null, due_date: "2027-03-31" },
    });
    expect(goalPayload({ ...base, name: "Thuế", mode: "pct", target_pct: "10" }, null)).toMatchObject({
      ok: true,
      value: { target_pct: 10, target_amount: null, monthly_amount: null, repeat_months: null, due_date: null },
    });
    // Sửa: gửi kèm active; bỏ gắn tài khoản → null. Không còn pocket / kind / phần giữ riêng.
    const existing = goal();
    const edit = goalPayload({ ...goalToForm(existing), account_id: "", active: false }, existing);
    expect(edit).toMatchObject({ ok: true, value: { account_id: null, active: false, monthly_amount: 2_000_000, repeat_months: 3 } });
    expect(edit.ok && ["pocket", "kind"].some((k) => k in edit.value)).toBe(false);
    expect(goalToForm(goal({ target_pct: 10, target_amount: null, monthly_amount: null, repeat_months: null })).mode).toBe("pct");
    expect(goalToForm(goal({ monthly_amount: null, repeat_months: null })).mode).toBe("once");
  });

  it("UC-709 AC-36: kiểm tra form như server — tên, số > 0, tối đa 1e12, số tháng 1–12, % 1–100", () => {
    const base = { ...goalToForm(null), name: "Học phí", monthly_amount: 2_000_000, repeat_months: "3" };
    const errs = (patch: Partial<typeof base>) => {
      const r = goalPayload({ ...base, ...patch }, null);
      return r.ok ? {} : r.errors;
    };
    expect(errs({ name: " " }).name).toBe("Nhập tên.");
    expect(errs({ name: "x".repeat(61) }).name).toBe("Tên tối đa 60 ký tự.");
    expect(errs({ monthly_amount: 0 }).monthly_amount).toBe("Nhập số mỗi tháng.");
    expect(errs({ repeat_months: "13" }).repeat_months).toBe("Số tháng là số nguyên từ 1 đến 12.");
    expect(errs({ repeat_months: "0" }).repeat_months).toBeTruthy();
    expect(errs({ monthly_amount: 500_000_000_000, repeat_months: "3" }).monthly_amount).toBe("Số cần không quá 1.000.000.000.000.");
    expect(errs({ mode: "once", target_amount: 0 }).target_amount).toBe("Nhập số cần.");
    expect(errs({ mode: "pct", target_pct: "0" }).target_pct).toBe("% là số nguyên từ 1 đến 100.");
    expect(errs({ mode: "pct", target_pct: "101" }).target_pct).toBeTruthy();
    expect(errs({ mode: "pct", target_pct: "10,5" }).target_pct).toBeTruthy();
    expect(errs({ due_date: "15/01/2027" }).due_date).toBe("Hạn là một ngày.");
  });

  // Hộ mẫu E sau 0040: tài khoản tiết kiệm (gắn Học phí), phao, tài khoản dự phòng (Ví Thưởng), tài khoản chính.
  const houseE = [
    account({ id: "tiet-kiem", name: "Tài khoản tiết kiệm", pocket: "reserve", book_balance: 10_000_000 }),
    account({ id: "phao", name: "Phao", pocket: "reserve", book_balance: 5_000_000 }),
    account({ id: "du-phong", name: "Tài khoản dự phòng", pocket: "reserve", book_balance: 4_000_000 }),
    account({ id: "chinh", name: "Tài khoản chính", pocket: "operating" }),
    account({ id: "phao-cu", name: "Phao cũ", pocket: "reserve", active: false }),
  ];
  const goalsE = [
    goal({ id: "hoc-phi", account_id: "tiet-kiem", held: 10_000_000 }),
    goal({ id: "hoa-don", name: "Hoá đơn", account_id: null, held: null }),
    goal({ id: "thue", name: "Thuế", account_id: null, held: null, target_pct: 10, target_amount: null, monthly_amount: null, repeat_months: null }),
  ];

  it("UC-709 AC-46: sheet Hoá đơn có ô Tài khoản liệt kê tài khoản tiết kiệm kèm 'dùng chung với Học phí' và phao, không liệt kê tài khoản dự phòng (Ví Thưởng)", () => {
    const view = (list: GoalAccountOption[]) => list.map((a) => [a.id, a.shared, a.blocked]);
    expect(view(goalAccountOptions(houseE, goalsE, "du-phong", "hoa-don", false))).toEqual([
      ["tiet-kiem", "dùng chung với Học phí", null],
      ["phao", null, null],
    ]);
    expect(view(goalAccountOptions(houseE, goalsE, "du-phong", "hoc-phi", false))).toEqual([
      ["tiet-kiem", null, null],
      ["phao", null, null],
    ]);
    expect(view(goalAccountOptions(houseE, goalsE, null, null, false)).map((x) => x[0])).toEqual(["tiet-kiem", "phao", "du-phong"]);
  });

  // Dữ liệu giả của pocket UC-1203 AC-11 ở dạng GET /v1/settings (goals theo thứ tự ưu tiên, goal_groups) + Ví Thưởng, tài khoản chính.
  function sharedSettings(o: { saving?: number; spent?: Record<string, number> } = {}): SettingsData {
    const v = pocketsShared(o);
    const sorts = Object.fromEntries(sharedGoals().map((g) => [g.id, g.sort]));
    const goals: ReserveGoal[] = v.reserve.goals.map((g) => ({
      id: g.id,
      name: g.name,
      account_id: g.accountId,
      suggested_account_id: null,
      held: g.held,
      need: g.need,
      spent: g.spent,
      short: g.short,
      target_amount: g.target,
      target_pct: g.targetPct,
      monthly_amount: g.monthly,
      repeat_months: g.repeatMonths,
      due_date: g.dueDate,
      debt_id: g.debtId,
      sort: sorts[g.id]!,
      active: true,
    }));
    const balance = Object.fromEntries(v.reserve.accounts.map((a) => [a.id, a.balance]));
    return {
      accounts: [
        ...SHARED_ACCOUNTS.map((a) => account({ id: a.id, name: a.name, pocket: "reserve", book_balance: balance[a.id]! })),
        account({ id: "vi-thuong", name: "Ví Thưởng", pocket: "reserve", book_balance: 1_000_000 }),
        account({ id: "chinh", name: "Tài khoản chính", pocket: "operating" }),
      ],
      goals: [...goals, goal({ id: "du-lich", name: "Du lịch", account_id: null, held: null, need: null, short: null, due_date: null }), goal({ id: "cu", name: "Mục tiêu cũ", account_id: null, held: null, need: null, short: null, active: false })],
      goal_groups: v.reserve.groups.map((g) => ({ account_id: g.accountId, balance: g.balance, need: g.need, spent: g.spent, short: g.short, extra: g.extra, goal_ids: g.goalIds })),
      config: { surplus_reward_account: "vi-thuong" },
    } as SettingsData;
  }

  it("UC-709 AC-36: dòng của mục tiêu trong nhóm chung bỏ 'trong {tài khoản}'; đã chi > 0 thêm 'đã chi X kỳ này' và 'đủ' theo đã có + đã chi; mục tiêu một mình giữ dòng cũ", () => {
    const d = sharedSettings();
    const of = (s: SettingsData, id: string) => s.goals.find((g) => g.id === id)!;
    expect(goalLineText(of(d, "nha-o"), d.accounts, true)).toBe("Nhà ở · đã có 7.500.000 / 7.500.000 · đủ · hạn 05/12/2026 · 7.500.000/tháng");
    expect(goalLineText(of(d, "hoc-tap"), d.accounts, true)).toBe("Học tập · đã có 4.500.000 / 6.000.000 · hạn 15/01/2027");
    expect(goalLineText(of(d, "thue"), d.accounts)).toBe("Thuế · đã có 1.500.000 · trong TK thuế · 10% thu chịu thuế");
    const paid = sharedSettings({ saving: 4_500_000, spent: { "nha-o": 7_500_000 } });
    expect(goalLineText(of(paid, "nha-o"), paid.accounts, true)).toBe("Nhà ở · đã có 0 / 7.500.000 · đã chi 7.500.000 kỳ này · đủ · hạn 05/12/2026 · 7.500.000/tháng");
    expect(goalOrderPreview(paid, "tk-tiet-kiem", ["nha-o", "hoc-tap"]).map((r) => `${r.name} · ${r.text}`)).toEqual(["Nhà ở · đã có 0 / 7.500.000 · đã chi 7.500.000 kỳ này · đủ", "Học tập · đã có 4.500.000 / 6.000.000"]);
  });

  it("UC-709 AC-48: danh sách nhóm theo tài khoản ('MB tiết kiệm · 12.000.000 ₫ · 2 mục tiêu · thiếu 1.500.000 ₫'), 'Chưa có tài khoản' cuối; đổi thứ tự xem trước bằng fillGoals; Lưu gửi một PUT với mọi mã đang dùng, VCB chung giữ thứ tự; 400 invalid_order → câu tải lại", () => {
    const d = sharedSettings();
    expect(goalListGroups(d).map((g) => [g.title, g.reorder, g.goals.map((x) => x.id)])).toEqual([
      [`VCB chung · 9.000.000${NBSP}₫ · 3 mục tiêu · thiếu 800.000${NBSP}₫`, true, ["hoa-don", "bao-duong-xe", "hieu-hi"]],
      [`MB tiết kiệm · 12.000.000${NBSP}₫ · 2 mục tiêu · thiếu 1.500.000${NBSP}₫`, true, ["nha-o", "hoc-tap"]],
      [null, false, ["thue"]],
      ["Chưa có tài khoản", false, ["du-lich"]],
      [null, false, ["cu"]],
    ]);
    expect(goalOrderPreview(d, "tk-tiet-kiem", ["hoc-tap", "nha-o"]).map((r) => `${r.name} · ${r.text}`)).toEqual(["Học tập · đã có 6.000.000 / 6.000.000 · đủ", "Nhà ở · đã có 6.000.000 / 7.500.000"]);
    const six = { ...d, goals: d.goals.filter((g) => g.account_id !== null) };
    expect(goalOrderPayload(six.goals, "tk-tiet-kiem", ["hoc-tap", "nha-o"])).toEqual({ ids: ["hoa-don", "hoc-tap", "nha-o", "bao-duong-xe", "hieu-hi", "thue"] });
    expect(goalOrderPayload(d.goals, "tk-chung", ["hieu-hi", "hoa-don", "bao-duong-xe"])).toEqual({ ids: ["hieu-hi", "nha-o", "hoc-tap", "hoa-don", "bao-duong-xe", "thue", "du-lich"] });
    expect(goalOrderError(new ApiError(400, "invalid_order", "ids sai"))).toEqual({ message: ORDER_CHANGED, reload: true });
    expect(ORDER_CHANGED).toBe("Danh sách mục tiêu vừa đổi ở máy khác — tải lại.");
    expect(goalOrderError(new ApiError(500, "server_error", "Lỗi máy chủ."))).toEqual({ message: "Lỗi máy chủ.", reload: false });
    setAmountsHidden(true);
    try {
      expect(goalListGroups(d)[1]!.title).toBe(`MB tiết kiệm · ••••${NBSP}₫ · 2 mục tiêu · thiếu ••••${NBSP}₫`);
    } finally {
      setAmountsHidden(false);
    }
  });

  it("UC-709 AC-49: ô Tài khoản của Hiếu hỉ — VCB chung, MB tiết kiệm kèm 'dùng chung với …', phao, TK thuế tắt 'Thuế cần tài khoản riêng', không Ví Thưởng; chọn MB tiết kiệm có câu mềm; Thuế chỉ bật tài khoản không mục tiêu và TK thuế; mã lỗi tax_account_shared / account_is_reward", () => {
    const d = sharedSettings();
    const view = (list: GoalAccountOption[]) => list.map((a) => [a.name, a.shared, a.blocked]);
    expect(view(goalAccountOptions(d.accounts, d.goals, "vi-thuong", "hieu-hi", false))).toEqual([
      ["VCB chung", "dùng chung với Hoá đơn, Bảo dưỡng xe", null],
      ["MB tiết kiệm", "dùng chung với Nhà ở, Học tập", null],
      ["TK thuế", "dùng chung với Thuế", "Thuế cần tài khoản riêng"],
      ["phao", null, null],
    ]);
    expect(goalAccountOptions(d.accounts, d.goals, "vi-thuong", "thue", true).filter((a) => !a.blocked).map((a) => a.name)).toEqual(["TK thuế", "phao"]);
    expect(goalAccountOptions(d.accounts, d.goals, "vi-thuong", "thue", true).find((a) => a.id === "tk-chung")!.blocked).toBe("Thuế cần tài khoản riêng");
    const hieuHi = d.goals.find((g) => g.id === "hieu-hi")!;
    expect(goalAccountNote(d, "tk-tiet-kiem", hieuHi)).toBe(`MB tiết kiệm đang thiếu 1.500.000${NBSP}₫ cho Nhà ở, Học tập; mục tiêu này đứng thứ 3 trong tài khoản.`);
    expect(goalAccountNote(d, "tk-chung", hieuHi)).toBeNull();
    expect(goalAccountNote(d, "phao", hieuHi)).toBeNull();
    expect(goalAccountNote(d, "tk-tiet-kiem", { id: null, due_date: "2026-12-20" })).toBe(`MB tiết kiệm đang thiếu 1.500.000${NBSP}₫ cho Nhà ở, Học tập; mục tiêu này đứng thứ 2 trong tài khoản.`);
    expect(goalAccountNote(d, "tk-tiet-kiem", { id: null, due_date: null })).toMatch(/đứng thứ 3 trong tài khoản\.$/);
    expect(goalSubmitError(new ApiError(409, "tax_account_shared", "x"), d.accounts, "tk-chung")).toEqual({ field: "account_id", message: TAX_ACCOUNT_SHARED });
    expect(TAX_ACCOUNT_SHARED).toBe("Thuế cần tài khoản riêng: thuế đã nộp đếm mọi khoản chi từ tài khoản này.");
    expect(goalSubmitError(new ApiError(409, "account_is_reward", "x"), d.accounts, "vi-thuong")).toEqual({ field: "account_id", message: "Ví Thưởng là tài khoản Ví Thưởng: chọn tài khoản Dự phòng khác cho mục tiêu." });
    expect(goalSubmitError(new ApiError(400, "invalid_input", "Tên trống.", "name"), d.accounts, "")).toEqual({ field: null, message: "Tên trống." });
  });

  it("UC-709 AC-43: Ví Thưởng là danh sách tài khoản Dự phòng đang dùng không gắn mục tiêu", () => {
    expect(rewardAccountOptions(houseE, goalsE).map((a) => a.id)).toEqual(["phao", "du-phong"]);
    // Tắt Học phí thì tài khoản tiết kiệm thành tài khoản Dự phòng thường, chọn được.
    expect(rewardAccountOptions(houseE, goalsE.map((g) => ({ ...g, active: g.id !== "hoc-phi" }))).map((a) => a.id)).toEqual(["tiet-kiem", "phao", "du-phong"]);
  });

  it("UC-709 AC-37: % Tích luỹ mỗi kỳ lương là số nguyên 1–100; bản cài đặt cũ chưa có thì không gửi", () => {
    const config = { salary_min_amount: 0, interest_max_amount: 10_000, safety_fund_months: "6", payday_day: "10" };
    expect(configPayload({ ...config, savings_pct: "20" })).toMatchObject({ ok: true, value: { savings_pct: 20 } });
    expect(configPayload({ ...config, savings_pct: "100" })).toMatchObject({ ok: true, value: { savings_pct: 100 } });
    for (const bad of ["0", "101", "12,5", "", "abc"]) {
      expect(configPayload({ ...config, savings_pct: bad })).toEqual({ ok: false, errors: { savings_pct: "% Tích luỹ là số nguyên từ 1 đến 100." } });
    }
    const old = configPayload(config);
    expect(old.ok && "savings_pct" in old.value).toBe(false);
  });

  it("UC-709 AC-38: nguồn thu có ô Ngăn của tiền về — mặc định Theo tài khoản nhận (null), chọn ngăn thì gửi ngăn", () => {
    expect(streamToForm(null).pocket).toBeNull();
    expect(streamToForm({ id: "rent", name: "Cho thuê", sort: 30, active: true, pocket: "savings" }).pocket).toBe("savings");
    expect(streamToForm({ id: "rent", name: "Cho thuê", sort: 30, active: true }).pocket).toBeNull();
    const f = { ...streamToForm(null), name: "Cho thuê" };
    expect(streamPayload(f, true)).toEqual({ ok: true, value: { name: "Cho thuê", pocket: null, opens_cycle: false } });
    expect(streamPayload({ ...f, pocket: "savings" }, true)).toMatchObject({ ok: true, value: { pocket: "savings" } });
  });

  const group = (over: Partial<CategoryGroup> = {}): CategoryGroup => ({ id: "food", name: "Ăn uống", essential: true, cycle_limit: 7_000_000, sort: 10, active: true, ...over });

  it("UC-709 AC-39: nhóm danh mục — hạn mức mỗi kỳ lương để trống = không đặt (null), cờ Thiết yếu, tên bắt buộc", () => {
    expect(groupPayload({ name: " Ăn uống ", essential: true, cycle_limit: 7_000_000, active: true }, null)).toEqual({ ok: true, value: { name: "Ăn uống", essential: true, cycle_limit: 7_000_000 } });
    expect(groupPayload({ name: "Giải trí", essential: false, cycle_limit: 0, active: true }, null)).toEqual({ ok: true, value: { name: "Giải trí", essential: false, cycle_limit: null } });
    expect(groupPayload({ name: "Ăn uống", essential: true, cycle_limit: 0, active: false }, group())).toEqual({ ok: true, value: { name: "Ăn uống", essential: true, cycle_limit: null, active: false } });
    expect(groupPayload({ name: "", essential: false, cycle_limit: 0, active: true }, null)).toEqual({ ok: false, errors: { name: "Nhập tên nhóm." } });
    expect(groupSummary(group(), 3)).toBe("Thiết yếu · 7.000.000 mỗi kỳ lương · 3 danh mục");
    // Nhóm không có cờ Thiết yếu gọi "Mong muốn" ở mọi chỗ (pocket UC-1204 bước 1, Đợt D).
    expect(groupSummary(group({ essential: false, cycle_limit: null }), 0)).toBe("Mong muốn · không đặt hạn mức · chưa có danh mục");
  });

  const debt = (over: Partial<Debt> = {}): Debt =>
    ({ id: "vay-me", name: "Mẹ", note: null, active: true, owed: 10_000_000, paid: 0, balance: 10_000_000, done: false, term: "short", monthlyPayment: 1_000_000, dueDay: 5, interestRate: 0, ...over }) as Debt;

  it("UC-709 AC-39: ngày trả kế tiếp — hôm nay chưa qua ngày trả thì tháng này, qua rồi thì tháng sau; tháng ít ngày lấy ngày cuối", () => {
    expect(nextDueDate(5, "2026-11-03")).toBe("2026-11-05");
    expect(nextDueDate(5, "2026-11-05")).toBe("2026-11-05");
    expect(nextDueDate(5, "2026-11-11")).toBe("2026-12-05");
    expect(nextDueDate(31, "2026-12-31")).toBe("2026-12-31");
    expect(nextDueDate(31, "2027-01-31")).toBe("2027-01-31");
    expect(nextDueDate(30, "2027-01-31")).toBe("2027-02-28");
    expect(nextDueDate(null, "2026-11-11")).toBe("");
  });

  it("UC-709 AC-39: gợi ý 'Tạo mục tiêu Trả nợ' cho nợ ngắn hạn còn nợ, có số trả mỗi tháng, chưa có mục tiêu đang dùng gắn — mở sheet điền sẵn", () => {
    const debts = [
      debt(),
      debt({ id: "nha", name: "Nhà", term: "long" }),
      debt({ id: "xong", name: "Xong", balance: 0 }),
      debt({ id: "khong-so", name: "Không số", monthlyPayment: null }),
      debt({ id: "tat", name: "Tắt", active: false }),
      debt({ id: "co-muc-tieu", name: "Có mục tiêu" }),
      debt({ id: "muc-tieu-tat", name: "Bạn", monthlyPayment: 500_000, dueDay: null }),
    ];
    const list = [goal({ debt_id: "co-muc-tieu" }), goal({ id: "cu", debt_id: "muc-tieu-tat", active: false })];
    const s = debtGoalSuggestions(debts, list, "2026-11-11");
    expect(s.map((x) => x.text)).toEqual(["Tạo mục tiêu Trả nợ Mẹ · 1.000.000/tháng", "Tạo mục tiêu Trả nợ Bạn · 500.000/tháng"]);
    // Sheet điền sẵn không có tài khoản.
    expect(s[0]!.prefill).toMatchObject({ name: "Trả nợ Mẹ", account_id: "", mode: "repeat", monthly_amount: 1_000_000, repeat_months: "1", due_date: "2026-12-05", debt_id: "vay-me" });
    expect(s[1]!.prefill.due_date).toBe("");
    const body = goalPayload(s[0]!.prefill, null);
    expect(body).toMatchObject({ ok: true, value: { name: "Trả nợ Mẹ", account_id: null, monthly_amount: 1_000_000, repeat_months: 1, target_amount: 1_000_000, due_date: "2026-12-05", debt_id: "vay-me" } });
  });
});

describe("tài khoản con, mục tiêu trả từ tiền chi tiêu, thang Tích luỹ (v2.3)", () => {
  const account = (id: string, name: string, over: Partial<SettingsAccount> = {}): SettingsAccount => ({
    id, name, kind: "bank", bank: "MBBank", account_no: "1", sub_account: null, sepay_enabled: false, sepay_out: false, sepay_connection_id: null,
    owner_member_id: null, opening_balance: 0, opened_at: null, feed_from: null, sepay_out_from: null, first_log_at: null, active: true, deactivated_at: null,
    book_balance: 0, pocket: "reserve", pocket_confirmed: true, parent_account_id: null, ...over,
  });
  const goal = (id: string, name: string, over: Partial<ReserveGoal> = {}): ReserveGoal => ({
    id, name, account_id: null, pays_from: "account", remaining: null, suggested_account_id: null, held: null, need: null, spent: 0, short: null,
    target_amount: null, target_pct: null, monthly_amount: null, repeat_months: null, due_date: null, debt_id: null, sort: 100, active: true, ...over,
  });
  // Hộ mẫu của pocket UC-1209 AC-16: MB tiết kiệm (Dự phòng) có con "Gửi 6 tháng"; tài khoản chi tiêu ở Vận hành; BIDV là Ví Thưởng.
  const house = [
    account("tk-tiet-kiem", "MB tiết kiệm", { book_balance: 5_000_000 }),
    account("tk-chi-tieu-chong", "MB chi tiêu chồng", { pocket: "operating" }),
    account("gui-6-thang", "Gửi 6 tháng", { book_balance: 100_000_000, parent_account_id: "tk-tiet-kiem" }),
    account("tk-bidv", "BIDV", { book_balance: 2_000_000 }),
    account("tich-luy", "TCB tích luỹ", { pocket: "savings" }),
    account("phao", "Phao", { sepay_enabled: true }),
    account("tien-mat", "Tiền mặt", { kind: "cash", bank: null, pocket: null }),
    account("acb-cu", "ACB cũ", { active: false, pocket: null }),
  ];
  const byId = (id: string) => house.find((a) => a.id === id)!;
  const accountGoalsOf = [goal("nha-o", "Nhà ở", { account_id: "tk-tiet-kiem" }), goal("hoc-phi", "Học phí", { account_id: "tk-hoc-phi" })];

  it("UC-709 AC-51: sheet tài khoản có ô Thuộc tài khoản — chỉ tài khoản ngân hàng đang dùng ở Dự phòng / Tích luỹ / ngoài ngăn, không con, có cả Ví Thưởng (làm mẹ được); mẹ không có ô; chọn mẹ → Ngăn 'theo {mẹ}', SePay ẩn, gửi parent_account_id, không gửi pocket", () => {
    // Thêm tài khoản: danh sách mẹ (ô còn có "Không"); Ví Thưởng làm mẹ được (access UC-506 3n).
    expect(accountParentOptions(house, null).map((a) => a.id)).toEqual(["tk-tiet-kiem", "tk-bidv", "tich-luy", "phao"]);
    expect(accountParentField(null, house, accountGoalsOf, "tk-bidv")).toEqual({ show: true, disabled: null });
    // Sửa tk-tiet-kiem sau khi nó có con → không có ô.
    expect(accountParentField(byId("tk-tiet-kiem"), house, accountGoalsOf, "tk-bidv").show).toBe(false);
    // Sửa con: có ô, đổi / bỏ mẹ được; danh sách không có chính nó.
    expect(accountParentField(byId("gui-6-thang"), house, accountGoalsOf, "tk-bidv")).toEqual({ show: true, disabled: null });
    expect(accountParentOptions(house, byId("phao")).map((a) => a.id)).toEqual(["tk-tiet-kiem", "tk-bidv", "tich-luy"]);
    // Tài khoản đang nối SePay / gắn mục tiêu / là Ví Thưởng → ô tắt kèm lý do.
    expect(accountParentField(byId("phao"), house, accountGoalsOf, "tk-bidv").disabled).toBe(PARENT_SEPAY);
    expect(accountParentField(account("tk-hoc-phi", "TK học phí"), [...house, account("tk-hoc-phi", "TK học phí")], accountGoalsOf, "tk-bidv").disabled).toBe("Tài khoản của mục tiêu Học phí: bỏ gắn mục tiêu trước.");
    expect(accountParentField(byId("tk-bidv"), house, accountGoalsOf, "tk-bidv").disabled).toBe(PARENT_REWARD);
    expect(accountParentHint("MB tiết kiệm")).toBe("Khoản gửi kỳ hạn mở từ tài khoản này. Tiền vẫn tính là của MB tiết kiệm; mục tiêu gắn MB tiết kiệm thấy cả khoản này.");
    expect(parentPocketText("MB tiết kiệm")).toBe("theo MB tiết kiệm");
    // Chọn mẹ: thân có parent_account_id, không pocket, không SePay.
    const f = { ...accountToForm(null), name: "Gửi 6 tháng", bank: "MBBank", parent_account_id: "tk-tiet-kiem", pocket: "savings" as const, pocket_touched: true, sepay_enabled: true, sepay_out: true };
    const r = accountPayload(f, null);
    expect(r.ok && r.value).toMatchObject({ parent_account_id: "tk-tiet-kiem", sepay_enabled: false, sepay_out: false });
    // Con theo mẹ: không gửi pocket, private, owner_member_id (server 400 pocket_follows_parent nếu lệch).
    for (const k of ["pocket", "private", "owner_member_id"]) expect(r.ok && k in r.value, k).toBe(false);
    // Không chọn mẹ: không gửi parent_account_id (như cũ).
    const none = accountPayload({ ...accountToForm(null), name: "MB (vợ)", bank: "MBBank" }, null);
    expect(none.ok && "parent_account_id" in none.value).toBe(false);
    // Khoản gửi là tài khoản ngân hàng.
    expect(accountPayload({ ...f, kind: "cash" }, null)).toMatchObject({ ok: false, errors: { parent_account_id: "Khoản gửi kỳ hạn là tài khoản ngân hàng." } });
    // Sửa con: không gửi pocket; bỏ mẹ → parent_account_id null (tài khoản giữ ngăn đang có).
    const child = byId("gui-6-thang");
    expect(accountToForm(child).parent_account_id).toBe("tk-tiet-kiem");
    const rename = accountPayload({ ...accountToForm(child), name: "Gửi 6 tháng MB" }, child);
    expect(rename.ok && "pocket" in rename.value).toBe(false);
    expect(rename.ok && "parent_account_id" in rename.value).toBe(false);
    const unlink = accountPayload({ ...accountToForm(child), parent_account_id: "" }, child);
    expect(unlink.ok && unlink.value).toMatchObject({ parent_account_id: null });
    expect(unlink.ok && "pocket" in unlink.value).toBe(false);
    // Biến tài khoản có sẵn thành con (PATCH): gửi mẹ, bỏ pocket.
    const tcb = byId("tich-luy");
    const link = accountPayload({ ...accountToForm(tcb), parent_account_id: "tk-tiet-kiem" }, tcb);
    expect(link.ok && link.value).toMatchObject({ parent_account_id: "tk-tiet-kiem" });
    expect(link.ok && "pocket" in link.value).toBe(false);
    // "+ Thêm khoản gửi kỳ hạn" ở sheet của mẹ (kể cả Ví Thưởng): mở sheet thêm, có sẵn mẹ.
    expect(canAddDeposit(byId("tk-tiet-kiem"), house)).toBe(true);
    expect(canAddDeposit(byId("tk-bidv"), house)).toBe(true);
    expect(canAddDeposit(byId("tk-chi-tieu-chong"), house)).toBe(false);
    expect(canAddDeposit(byId("gui-6-thang"), house)).toBe(false);
    expect(depositPreset(byId("tk-tiet-kiem"))).toEqual({ parent_account_id: "tk-tiet-kiem", bank: "MBBank" });
    // Ba ngăn › xếp tài khoản: con không có ô ngăn, nằm dưới mẹ "theo {mẹ}"; câu đầu sheet.
    const groups = pocketSheetGroups(house, Object.fromEntries(house.filter((a) => a.active).map((a) => [a.id, a.pocket ?? null])));
    const reserve = groups.find((g) => g.key === "reserve")!;
    expect(reserve.rows.map((r) => [r.account.id, r.children.map((c) => c.id)])).toEqual([
      ["tk-tiet-kiem", ["gui-6-thang"]],
      ["tk-bidv", []],
      ["phao", []],
    ]);
    expect(groups.flatMap((g) => g.rows.map((r) => r.account.id))).not.toContain("gui-6-thang");
    expect(POCKETS_SHEET_HEAD).toBe("Tiền chi tiêu hằng ngày để ở Vận hành; tiền để dành cho khoản sắp trả ở Dự phòng; tiền không đụng ở Tích luỹ.");
  });

  it("UC-709 AC-52: sheet mục tiêu 'Tiền để ở đâu' — 'Trả thẳng từ tiền chi tiêu' gửi pays_from operating, không account_id; một lần / 3 tháng một lần thì tắt 'Chỉ khoản trả mỗi tháng'; Thuế không có lựa chọn đó; danh sách tài khoản chỉ có mẹ, MB tiết kiệm ghi 'gồm khoản gửi kỳ hạn'", () => {
    expect(GOAL_PLACE_LABEL).toBe("Tiền để ở đâu");
    expect(PLACE_LABEL).toEqual({ account: "Một tài khoản để dành", operating: "Trả thẳng từ tiền chi tiêu" });
    expect(OPERATING_HINT).toBe("Không phải chuyển tiền. App chừa số này khỏi 'Chi khoảng …/ngày' tới khi trả.");
    const thuoc = { ...goalToForm(null), name: "Thuốc", monthly_amount: 500_000, repeat_months: "1", pays_from: "operating" as const };
    expect(goalToForm(null).pays_from).toBe("account");
    expect(operatingChoice(thuoc)).toEqual({ show: true, disabled: null });
    expect(goalPayload(thuoc, null)).toEqual({
      ok: true,
      value: { name: "Thuốc", pays_from: "operating", target_amount: 500_000, monthly_amount: 500_000, repeat_months: 1, target_pct: null, due_date: null, debt_id: null },
    });
    // "Một lần" / "3 tháng một lần": lựa chọn tắt; nếu đang chọn thì về "Một tài khoản để dành".
    const once = { ...thuoc, mode: "once" as const, target_amount: 500_000 };
    expect(operatingChoice(once)).toEqual({ show: true, disabled: "Chỉ khoản trả mỗi tháng" });
    expect(operatingChoice({ ...thuoc, repeat_months: "3" })).toEqual({ show: true, disabled: OPERATING_MONTHLY_ONLY });
    expect(goalPlace({ ...thuoc, repeat_months: "3" })).toBe("account");
    const onceBody = goalPayload(once, null);
    expect(onceBody.ok && onceBody.value).toMatchObject({ account_id: null, target_amount: 500_000 });
    expect(onceBody.ok && "pays_from" in onceBody.value).toBe(false);
    // Thuế: chỉ lựa chọn đầu.
    expect(operatingChoice({ mode: "pct", repeat_months: "1" })).toEqual({ show: false, disabled: null });
    // Sửa mục tiêu trả từ tiền chi tiêu: form giữ lựa chọn; đổi về tài khoản thì gửi pays_from account + account_id.
    const saved = goal("thuoc", "Thuốc", { pays_from: "operating", monthly_amount: 500_000, repeat_months: 1, target_amount: 500_000, remaining: 500_000 });
    expect(goalToForm(saved).pays_from).toBe("operating");
    const back = goalPayload({ ...goalToForm(saved), pays_from: "account", account_id: "tk-tiet-kiem" }, saved);
    expect(back.ok && back.value).toMatchObject({ pays_from: "account", account_id: "tk-tiet-kiem" });
    // Danh sách tài khoản: chỉ tài khoản mẹ ở Dự phòng (không con, không Ví Thưởng); có con → "gồm khoản gửi kỳ hạn".
    const options = goalAccountOptions(house, [], "tk-bidv", null, false);
    expect(options.map((a) => [a.id, a.deposits])).toEqual([
      ["tk-tiet-kiem", "gồm khoản gửi kỳ hạn"],
      ["phao", null],
    ]);
    expect(DEPOSITS_NOTE).toBe("gồm khoản gửi kỳ hạn");
  });

  // GET /v1/settings của UC-1209 AC-16 (trước / sau đáo hạn) + bốn mục tiêu trả từ tiền chi tiêu.
  function deposits(after = false): SettingsData {
    const account3 = [
      goal("nha-o", "Nhà ở", { account_id: "tk-tiet-kiem", held: 60_000_000, need: 60_000_000, short: 0, target_amount: 60_000_000, sort: 10 }),
      goal("hoc-tap", "Học tập", { account_id: "tk-tiet-kiem", held: 30_000_000, need: 30_000_000, short: 0, target_amount: 30_000_000, sort: 20 }),
      goal("tap-luyen", "Tập luyện", { account_id: "tk-tiet-kiem", held: 15_000_000, need: 10_000_000, short: 0, target_amount: 10_000_000, sort: 30 }),
    ];
    const monthly = (id: string, name: string, amount: number, spent = 0) =>
      goal(id, name, { pays_from: "operating", monthly_amount: amount, repeat_months: 1, target_amount: amount, spent, remaining: amount - spent, sort: 40 });
    return {
      accounts: after ? house.map((a) => (a.id === "tk-tiet-kiem" ? { ...a, book_balance: 108_000_000 } : a.id === "gui-6-thang" ? { ...a, active: false, book_balance: null } : a)) : house,
      goals: [...account3, monthly("dien-nuoc", "Điện nước", 2_000_000, 1_000_000), monthly("thuoc", "Thuốc", 500_000), monthly("thien-phuoc", "Thiện phước", 1_000_000), monthly("ve-que", "Về quê", 1_000_000)],
      goal_groups: [
        after
          ? { account_id: "tk-tiet-kiem", balance: 108_000_000, need: 100_000_000, spent: 0, short: 0, extra: 5_000_000, goal_ids: ["nha-o", "hoc-tap", "tap-luyen"], child_ids: [], interest: 3_000_000 }
          : { account_id: "tk-tiet-kiem", balance: 105_000_000, need: 100_000_000, spent: 0, short: 0, extra: 5_000_000, goal_ids: ["nha-o", "hoc-tap", "tap-luyen"], child_ids: ["gui-6-thang"], interest: 0 },
      ],
      config: { surplus_reward_account: "tk-bidv" },
    } as unknown as SettingsData;
  }

  it("UC-709 AC-53: danh sách mục tiêu hai phần — 'Để dành ở tài khoản' nhóm 'MB tiết kiệm · 105.000.000 ₫' (Đổi thứ tự cùng dòng tiêu đề, không lặp 'trong MB tiết kiệm'), 'Trả từ tiền chi tiêu mỗi tháng' bốn dòng '{tên} · {số}/tháng · còn … kỳ này'; xem trước thứ tự chia số dư gộp − tiền lãi", () => {
    const d = deposits();
    expect(GOAL_SECTION_LABEL).toEqual({ account: "Để dành ở tài khoản", operating: "Trả từ tiền chi tiêu mỗi tháng" });
    const groups = goalListGroups(d);
    expect(groups.map((g) => [g.title, g.reorder, g.goals.map((x) => x.id)])).toEqual([[`MB tiết kiệm · 105.000.000${NBSP}₫ · 3 mục tiêu · dư 5.000.000${NBSP}₫`, true, ["nha-o", "hoc-tap", "tap-luyen"]]]);
    for (const g of groups[0]!.goals) expect(goalLineText(g, d.accounts, groups[0]!.shared)).not.toContain("trong MB tiết kiệm");
    expect(operatingGoalLines(d.goals).map((l) => l.text)).toEqual([
      "Điện nước · 2.000.000/tháng · còn 1.000.000 kỳ này",
      "Thuốc · 500.000/tháng · còn 500.000 kỳ này",
      "Thiện phước · 1.000.000/tháng · còn 1.000.000 kỳ này",
      "Về quê · 1.000.000/tháng · còn 1.000.000 kỳ này",
    ]);
    // Mục tiêu trả từ tiền chi tiêu đã tắt nằm cuối như mọi mục tiêu ngừng dùng, không ở phần mỗi tháng.
    const off = { ...d, goals: d.goals.map((g) => (g.id === "ve-que" ? { ...g, active: false } : g)) };
    expect(operatingGoalLines(off.goals).map((l) => l.goal.id)).toEqual(["dien-nuoc", "thuoc", "thien-phuoc"]);
    expect(goalListGroups(off).at(-1)!.goals.map((g) => g.id)).toEqual(["ve-que"]);
    // Sau đáo hạn: số dư gộp 108.000.000, tiền lãi 3.000.000 → Tập luyện vẫn 15.000.000; nhóm ghi tiền lãi.
    const after = deposits(true);
    expect(goalOrderPreview(after, "tk-tiet-kiem", ["nha-o", "hoc-tap", "tap-luyen"]).map((r) => r.text)).toEqual([
      "đã có 60.000.000 / 60.000.000 · đủ",
      "đã có 30.000.000 / 30.000.000 · đủ",
      "đã có 15.000.000 / 10.000.000 · đủ",
    ]);
    expect(goalListGroups(after)[0]!.note).toBe(`Tiền lãi 3.000.000${NBSP}₫ (không tính vào mục tiêu)`);
    expect(goalListGroups(d)[0]!.note).toBeNull();
  });

  it("UC-709 AC-37 (MODIFIED): % Tích luỹ ở Tham số dùng thanh 1–100% vạch 1 · 10 · 30 và câu thang; ô gõ sai thì thanh đứng ở 10; vẫn gửi số nguyên 1–100", () => {
    expect(SAVINGS_MARKS.map((m) => [m.pct, m.label])).toEqual([
      [1, "tối thiểu"],
      [10, "thường"],
      [30, "hướng tới"],
    ]);
    expect(SAVINGS_SCALE_TEXT).toBe("Thang của nhà: tối thiểu 1% · thường 10% · hướng tới 30%. Kỳ nào không trích được thì bỏ qua việc trích ở Hôm nay và ghi lý do.");
    expect(sliderPct("30")).toBe(30);
    expect(sliderPct("abc")).toBe(10);
    expect(sliderPct("0")).toBe(10);
    const config = { salary_min_amount: 0, interest_max_amount: 10_000, safety_fund_months: "6", payday_day: "10" };
    expect(configPayload({ ...config, savings_pct: String(sliderPct("30")) })).toMatchObject({ ok: true, value: { savings_pct: 30 } });
  });
});
