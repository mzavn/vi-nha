import { describe, expect, it } from "vitest";
import {
  accountPayload,
  accountToForm,
  appVersionLabel,
  auditView,
  bankHint,
  allocationSummary,
  allocFormToPayload,
  allocToForm,
  clearSecretPayload,
  connectionPicker,
  configPayload,
  followsCodeConvention,
  formatPercent,
  groupWallets,
  memberPayload,
  normalizePattern,
  notifyPayload,
  parsePercent,
  rulePayload,
  ruleToForm,
  secretLabel,
  secretPayload,
  scheduleRows,
  streamPayload,
  streamToForm,
  spendableDefault,
  syncRangeError,
  walletPayload,
  walletToForm,
} from "./settings";
import type { Allocation, AuditEntry, NotifySchedule, SepayConnection, SettingsAccount, SettingsWallet } from "./types";

const NBSP = "\u00a0";

const wallet = (patch: Partial<SettingsWallet> = {}): SettingsWallet => ({
  id: "food",
  name: "Ăn uống",
  tier: "must",
  must_group: "must",
  kind: "envelope",
  scope: "shared",
  member_id: null,
  account_id: "vcb-husband",
  private: false,
  sort: 41,
  active: true,
  allocation: { mode: "flat", period: "week", amount: 625_000, percent: null, target_amount: null, target_date: null, floor_amount: 500_000, priority: 41 },
  ...patch,
});

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

describe("cách nạp: form ↔ thân yêu cầu", () => {
  const roundTrip = (a: Allocation) => allocFormToPayload(allocToForm(a));

  it("flat giữ kỳ, số, sàn; xoá các cột không dùng", () => {
    const a = wallet().allocation!;
    expect(roundTrip(a)).toEqual({ ok: true, value: a });
  });

  it("percent: gõ theo %, gửi phân số như DB", () => {
    const f = { ...allocToForm(null), mode: "percent" as const, percent: "12,5", priority: "10" };
    const r = allocFormToPayload(f);
    expect(r.ok && r.value).toMatchObject({ mode: "percent", percent: 0.125, amount: null, floor_amount: null, priority: 10 });
    expect(formatPercent(0.3)).toBe("30");
    expect(formatPercent(0.07)).toBe("7");
    expect(parsePercent("30%")).toBe(30);
    expect(parsePercent("abc")).toBe(null);
    expect(allocFormToPayload({ ...f, percent: "0" }).ok).toBe(false);
    expect(allocFormToPayload({ ...f, percent: "120" }).ok).toBe(false);
  });

  it("goal cần số mục tiêu và hạn", () => {
    const base = { ...allocToForm(null), mode: "goal" as const, priority: "30" };
    const r = allocFormToPayload(base);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["target_amount", "target_date"]);
    const ok = allocFormToPayload({ ...base, target_amount: 15_000_000, target_date: "2026-12-31" });
    expect(ok.ok && ok.value).toMatchObject({ mode: "goal", target_amount: 15_000_000, target_date: "2026-12-31", amount: null, period: "month" });
  });

  it("lump gửi amount và target_amount cùng số như seed", () => {
    const seed: Allocation = { mode: "lump", period: "month", amount: 8_000_000, percent: null, target_amount: 8_000_000, target_date: null, floor_amount: 8_000_000, priority: 40 };
    expect(roundTrip(seed)).toEqual({ ok: true, value: seed });
  });

  it("chặn sàn lớn hơn số mỗi kỳ và ưu tiên không phải số nguyên", () => {
    const f = allocToForm(wallet().allocation);
    expect(allocFormToPayload({ ...f, floor_amount: 700_000 }).ok).toBe(false);
    expect(allocFormToPayload({ ...f, priority: "1.5" }).ok).toBe(false);
    expect(allocFormToPayload({ ...f, priority: "" }).ok).toBe(false);
  });

  it("không nạp → null", () => {
    expect(allocFormToPayload(allocToForm(null))).toEqual({ ok: true, value: null });
  });

  it("tóm tắt một dòng", () => {
    expect(allocationSummary(wallet().allocation)).toBe(`625.000${NBSP}₫/tuần · sàn 500.000${NBSP}₫`);
    expect(allocationSummary({ ...wallet().allocation!, mode: "percent", percent: 0.3 })).toBe("30% mỗi khoản thu");
    expect(allocationSummary({ ...wallet().allocation!, mode: "remainder" })).toBe("nhận phần còn lại");
    expect(allocationSummary({ ...wallet().allocation!, mode: "goal", target_amount: 15_000_000, target_date: "2026-12-31" })).toBe(`đủ 15.000.000${NBSP}₫ trước 31/12/2026`);
    expect(allocationSummary(null)).toBe("chưa có số nạp");
  });
});

describe("ví", () => {
  it("nhóm theo tầng, bỏ nhóm rỗng, trong nhóm theo sort", () => {
    const groups = groupWallets([
      wallet({ id: "nice-to-have", must_group: "have", sort: 50 }),
      wallet({ id: "wealth-building", tier: "wealth_building", must_group: null, sort: 10 }),
      wallet({ id: "transport", sort: 42 }),
      wallet({ id: "food", sort: 41 }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Tích sản", "Must", "Có thì tốt"]);
    expect(groups[1]!.wallets.map((w) => w.id)).toEqual(["food", "transport"]);
    expect(groups[0]!.lock).toBe(true);
  });

  it("ví nhận phần còn lại: không gửi allocation khi sửa", () => {
    const w = wallet({ id: "nice-to-have", must_group: "have", allocation: { ...wallet().allocation!, mode: "remainder", amount: null, floor_amount: null } });
    const r = walletPayload({ ...walletToForm(w), name: "Có thì tốt 2" }, w);
    expect(r.ok && r.value).toEqual({ name: "Có thì tốt 2", account_id: "vcb-husband", member_id: null, private: false, active: true });
  });

  it("sửa ví thường: gửi allocation đầy đủ theo mode", () => {
    const w = wallet();
    const r = walletPayload({ ...walletToForm(w), alloc: { ...walletToForm(w).alloc, amount: 700_000 } }, w);
    expect(r.ok && r.value.allocation).toMatchObject({ mode: "flat", amount: 700_000, period: "week" });
  });

  it("thêm ví: must_group chỉ khi tầng Must, ví riêng cần người", () => {
    const f = { ...walletToForm(null), name: "Học phí", tier: "nice" as const, kind: "accrual" as const };
    const r = walletPayload(f, null);
    expect(r.ok && r.value).toMatchObject({ name: "Học phí", tier: "nice", must_group: null, kind: "accrual", scope: "shared", allocation: null });
    expect(walletPayload({ ...f, scope: "personal" }, null).ok).toBe(false);
    const p = walletPayload({ ...f, scope: "personal", member_id: "wife", private: true }, null);
    expect(p.ok && p.value).toMatchObject({ scope: "personal", member_id: "wife", private: true });
    expect(walletPayload({ ...f, name: " " }, null).ok).toBe(false);
    expect(walletPayload({ ...f, alloc: { ...f.alloc, mode: "remainder" } }, null).ok).toBe(false);
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
    active: true,
    locked: false,
    spendable: true,
    role: null,
    book_balance: 0,
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

  it("Tính vào tiền chi được: thêm mới thì bật, thẻ tín dụng mặc định tắt; heo đất không bao giờ gửi bật (ADR-85)", () => {
    expect(accountToForm(null).spendable).toBe(true);
    expect(spendableDefault("bank", null)).toBe(true);
    expect(spendableDefault("cash", null)).toBe(true);
    expect(spendableDefault("credit", null)).toBe(false);
    const off = accountPayload({ ...accountToForm(existing()), spendable: false }, existing());
    expect(off.ok && off.value.spendable).toBe(false);
    const piggyBank = existing({ id: "piggy-bank-husband", sepay_enabled: false, locked: true, spendable: false, role: "piggy_bank" });
    expect(accountToForm(piggyBank).spendable).toBe(false);
    const forced = accountPayload({ ...accountToForm(piggyBank), spendable: true }, piggyBank);
    expect(forced.ok && forced.value.spendable).toBe(false);
  });

  it("Giữ tiền Tích sản (ADR-88): thêm phao / sổ tiết kiệm gửi role, mặc định không tính vào tiền chi được; sổ không bao giờ gửi bật; sửa heo / sổ không gửi role", () => {
    expect(spendableDefault("bank", "buffer")).toBe(false);
    expect(spendableDefault("bank", "term_deposit")).toBe(false);
    const buffer = accountPayload({ ...accountToForm(null), name: "MB tiết kiệm (vợ)", bank: "MBBank", role: "buffer", spendable: false }, null);
    expect(buffer.ok && buffer.value).toMatchObject({ role: "buffer", spendable: false });
    const so = accountPayload({ ...accountToForm(null), name: "Sổ 6 tháng", bank: "MBBank", role: "term_deposit", spendable: true }, null);
    expect(so.ok && so.value).toMatchObject({ role: "term_deposit", spendable: false });
    // Tài khoản thường ↔ phao đổi được: gửi role (null khi về thường).
    const back = accountPayload({ ...accountToForm(existing({ role: "buffer", spendable: false })), role: null }, existing({ role: "buffer" }));
    expect(back.ok && back.value.role).toBeNull();
    const soExisting = existing({ sepay_enabled: false, locked: true, spendable: false, role: "term_deposit" });
    const edit = accountPayload({ ...accountToForm(soExisting), name: "Sổ 6 tháng (đã tất toán)", active: false }, soExisting);
    expect(edit.ok && "role" in edit.value).toBe(false);
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

  it("khoản chi cần ví và danh mục; thu nhập luôn là lương", () => {
    const f = { ...ruleToForm(null), pattern: "eme" };
    const r = rulePayload(f, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["category_id", "wallet_id"]);
    const inc = rulePayload({ ...f, meaning: "income", wallet_id: "income" }, true);
    expect(inc.ok && inc.value).toEqual({ match_type: "code", pattern: "EME", meaning: "income", wallet_id: "income", category_id: null, priority: 50, is_salary: true });
  });

  it("sửa thì gửi thêm người chi và bật/tắt; mã có khoảng trắng bị chặn", () => {
    const f = { ...ruleToForm(null), pattern: "EMS", wallet_id: "fun-husband", category_id: "shopping", by_member_id: "husband", active: false };
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

  it("số tháng phao 1–24, ngưỡng lương không âm", () => {
    expect(configPayload({ salary_min_amount: 0, safety_fund_months: "6" })).toEqual({ ok: true, value: { salary_min_amount: 0, safety_fund_months: 6 } });
    expect(configPayload({ salary_min_amount: 5_000_000, safety_fund_months: "0" }).ok).toBe(false);
    expect(configPayload({ salary_min_amount: 5_000_000, safety_fund_months: "3,5" }).ok).toBe(false);
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

  it("tóm tắt: tắt thì ghi Tắt (tin sáng tắt vẫn nói ngày 1 chốt tháng), giờ yên lặng bằng nhau là Không đặt", () => {
    expect(scheduleRows(schedule()).map((r) => r.value)).toEqual(["07:00", "Thứ Hai 08:00", "Bật", "22:00–06:30"]);
    const off = scheduleRows(schedule({ dailyEnabled: false, weeklyEnabled: false, quietStart: "00:00", quietEnd: "00:00" }));
    expect(off.map((r) => r.value)).toEqual(["Tắt", "Tắt", "Bật", "Không đặt"]);
    expect(off[0]!.sub).toContain("ngày 1 vẫn tự chốt tháng lúc 07:00");
  });
});

describe("nguồn thu: phần khóa", () => {
  const form = (locks: [string, string][]) => ({ name: "Lương vợ", active: true, locks: locks.map(([wallet_id, percent], i) => ({ key: i + 1, wallet_id, percent })) });

  it("phần trăm gõ tay thành phân số; tổng đúng 100% vẫn được (khóa trọn, không chạy dòng thác)", () => {
    expect(streamPayload(form([["wealth-building", "45"]]), true)).toEqual({ ok: true, value: { name: "Lương vợ", locks: [{ wallet_id: "wealth-building", percent: 0.45 }] } });
    const full = streamPayload(form([["rental-income", "60"], ["wealth-building", "40"]]), false);
    expect(full.ok && full.value).toEqual({ name: "Lương vợ", active: true, locks: [{ wallet_id: "rental-income", percent: 0.6 }, { wallet_id: "wealth-building", percent: 0.4 }] });
    expect(streamPayload(form([]), true).ok).toBe(true);
  });

  it("tổng quá 100%, ví trùng, ô trống hay 0% đều bị chặn", () => {
    const over = streamPayload(form([["rental-income", "60"], ["wealth-building", "40,5"]]), true);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.errors.locks).toContain("100,5%");
    expect(streamPayload(form([["wealth-building", "20"], ["wealth-building", "20"]]), true).ok).toBe(false);
    expect(streamPayload(form([["", "20"]]), true).ok).toBe(false);
    expect(streamPayload(form([["wealth-building", "0"]]), true).ok).toBe(false);
    expect(streamPayload({ ...form([]), name: " " }, true).ok).toBe(false);
  });

  it("form đọc lại đúng số đã lưu", () => {
    expect(streamToForm({ id: "salary-wife", name: "Lương vợ", sort: 20, active: true, locks: [{ walletId: "wealth-building", percent: 0.45 }] }).locks).toEqual([{ key: 1, wallet_id: "wealth-building", percent: "45" }]);
  });
});

describe("phong bì chia đều theo tuần", () => {
  const monthly = wallet({ allocation: { mode: "flat", period: "month", amount: 7_000_000, percent: null, target_amount: null, target_date: null, floor_amount: null, priority: 41, splitWeekly: true } });

  it("phong bì nạp theo tháng: gửi split_weekly theo ô chọn", () => {
    const f = walletToForm(monthly);
    expect(f.split_weekly).toBe(true);
    const on = walletPayload(f, monthly);
    expect(on.ok && on.value.allocation).toMatchObject({ mode: "flat", period: "month", split_weekly: true });
    const off = walletPayload({ ...f, split_weekly: false }, monthly);
    expect(off.ok && off.value.allocation).toMatchObject({ split_weekly: false });
  });

  it("nạp theo tuần hoặc ví tích dồn: không bao giờ bật", () => {
    const f = walletToForm(monthly);
    const weekly = walletPayload({ ...f, alloc: { ...f.alloc, period: "week" } }, monthly);
    expect(weekly.ok && weekly.value.allocation).toMatchObject({ split_weekly: false });
    const accrual = wallet({ ...monthly, kind: "accrual" });
    const r = walletPayload(walletToForm(accrual), accrual);
    expect(r.ok && r.value.allocation).toMatchObject({ split_weekly: false });
  });
});

describe("mã lương chọn nguồn thu", () => {
  it("sửa mã lương gửi nguồn; mã khác luôn xoá nguồn", () => {
    const f = { ...ruleToForm(null), pattern: "LUONG", meaning: "income" as const, income_stream_id: "salary-wife" };
    expect(rulePayload(f, false)).toMatchObject({ ok: true, value: { income_stream_id: "salary-wife" } });
    expect(rulePayload({ ...f, meaning: "spend", wallet_id: "food", category_id: "groceries" }, false)).toMatchObject({ ok: true, value: { income_stream_id: null } });
    expect(rulePayload({ ...f, income_stream_id: "" }, false)).toMatchObject({ ok: true, value: { income_stream_id: null } });
  });
});

describe("về Ví nhà", () => {
  it("phiên bản lấy từ package.json lúc build; không có thì ghi Bản phát triển", () => {
    expect(appVersionLabel("1.0.1")).toBe("Phiên bản 1.0.1");
    expect(appVersionLabel("")).toBe("Bản phát triển");
  });
});
