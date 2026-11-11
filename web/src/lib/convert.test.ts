import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  CONVERSION_STEPS,
  CONVERT_DONE_TOAST,
  CONVERT_INVITED_KEY,
  conversionBanner,
  conversionSettingsRow,
  convertTitle,
  cycleStreamsNote,
  cycleSwitchStreams,
  GOAL_ORDER_NOTE,
  goalGroupLines,
  goalRowAccounts,
  goalTerms,
  goalAccountRequest,
  goalCreateRequest,
  goalStepRequests,
  goalsReady,
  initialGoalChoices,
  markInvited,
  NO_RESERVE_ACCOUNT,
  payCycleReady,
  rewardRowAccounts,
  SAVINGS_GAP_EXPLAIN,
  savingsGapLines,
  savingsPctLines,
  shouldInvite,
  stepConflict,
  stepNumber,
  type GoalChoice,
} from "./convert";
import { setAmountsHidden } from "./money";
import { accountPayload, accountToForm } from "./settings";
import type { ReserveGoal, SettingsAccount } from "./types";

const NBSP = "\u00a0";

const account = (id: string, name: string, over: Partial<SettingsAccount> = {}): SettingsAccount => ({
  id,
  name,
  kind: "bank",
  bank: "MBBank",
  account_no: "1",
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
  deactivated_at: null,
  book_balance: 0,
  pocket: "reserve",
  pocket_confirmed: true,
  ...over,
});

const goal = (id: string, name: string, over: Partial<ReserveGoal> = {}): ReserveGoal => ({
  id,
  name,
  account_id: null,
  suggested_account_id: null,
  held: null,
  need: null,
  spent: 0,
  short: null,
  target_amount: 2_000_000,
  target_pct: null,
  monthly_amount: 2_000_000,
  repeat_months: 1,
  due_date: null,
  debt_id: null,
  sort: 100,
  active: true,
  ...over,
});

// Hộ mẫu E sau bước 1 (tài khoản tiết kiệm giữ ở Dự phòng): Học phí đề xuất tài khoản tiết kiệm; Hoá đơn, Thuế chưa có đề xuất;
// Ví Thưởng = tài khoản dự phòng; phao là phần an tâm.
const accounts = [
  account("chinh", "Tài khoản chính", { pocket: "operating", book_balance: 3_000_000 }),
  account("tiet-kiem", "Tài khoản tiết kiệm", { book_balance: 10_000_000 }),
  account("phao", "Phao", { book_balance: 5_000_000 }),
  account("du-phong", "Tài khoản dự phòng", { book_balance: 4_000_000 }),
  account("cu", "Phao cũ", { active: false }),
];
const goals = [
  goal("hoc-phi", "Học phí", { suggested_account_id: "tiet-kiem" }),
  goal("hoa-don", "Hoá đơn", { target_amount: 1_300_000, monthly_amount: 1_300_000 }),
  goal("thue", "Thuế", { target_pct: 10, target_amount: null, monthly_amount: null, repeat_months: null }),
  goal("da-tat", "Đã tắt", { active: false, suggested_account_id: "phao" }),
];

describe("màn chuyển đổi: bước, banner, hàng Cài đặt", () => {
  it("UC-1208 AC-7: tiêu đề 'Chuyển sang ba ngăn · Bước {n}/5' theo bước kế tiếp; bước lạ → 0", () => {
    expect(CONVERSION_STEPS).toEqual(["pockets", "goals", "savings_gap", "pay_cycle", "savings_pct"]);
    expect(convertTitle("pockets")).toBe("Chuyển sang ba ngăn · Bước 1/5");
    expect(convertTitle("savings_gap")).toBe("Chuyển sang ba ngăn · Bước 3/5");
    expect(convertTitle("savings_pct")).toBe("Chuyển sang ba ngăn · Bước 5/5");
    expect(stepNumber("la")).toBe(0);
    expect(stepNumber(null)).toBe(0);
  });

  it("UC-702 AC-27: banner 'Hoàn tất chuyển sang ba ngăn · còn {5 − done} bước ›'; xong (null) → không có banner", () => {
    expect(conversionBanner({ done: 0, total: 5, next: "pockets" })).toBe("Hoàn tất chuyển sang ba ngăn · còn 5 bước ›");
    expect(conversionBanner({ done: 1, total: 5, next: "goals" })).toBe("Hoàn tất chuyển sang ba ngăn · còn 4 bước ›");
    expect(conversionBanner(null)).toBeNull();
    expect(conversionBanner(undefined)).toBeNull();
  });

  it("UC-709 AC-46: Cài đặt › Ba ngăn có hàng 'Chuyển sang ba ngăn · còn 5 bước ›' khi conversion ≠ null, xong thì hết", () => {
    expect(conversionSettingsRow({ done: 0, total: 5 })).toBe("Chuyển sang ba ngăn · còn 5 bước ›");
    expect(conversionSettingsRow({ done: 3, total: 5 })).toBe("Chuyển sang ba ngăn · còn 2 bước ›");
    expect(conversionSettingsRow(null)).toBeNull();
  });
});

describe("mời một lần trên mỗi máy", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
  };

  it("UC-1208 AC-7: lần đầu tải có conversion → tự mở; Để sau / tải lại → không tự mở nữa (cờ trên máy); máy thứ hai lần đầu → tự mở", () => {
    const phone = memory();
    const progress = { done: 0, total: 5, next: "pockets" };
    expect(shouldInvite(phone, progress)).toBe(true);
    markInvited(phone);
    expect(phone.map.get(CONVERT_INVITED_KEY)).toBe("1");
    expect(shouldInvite(phone, progress)).toBe(false);
    expect(shouldInvite(memory(), { ...progress, done: 2, next: "savings_gap" })).toBe(true);
  });

  it("UC-1208 AC-7: nhà cài mới (conversion null) → không mời; localStorage bị chặn → không mời, không ném lỗi", () => {
    expect(shouldInvite(memory(), null)).toBe(false);
    expect(shouldInvite(memory(), undefined)).toBe(false);
    expect(shouldInvite(null, { done: 0, total: 5, next: "pockets" })).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(shouldInvite(blocked, { done: 0, total: 5, next: "pockets" })).toBe(false);
    expect(() => markInvited(blocked)).not.toThrow();
  });
});

describe("409 theo next", () => {
  const conflict = (code: string, next: string | null) => new ApiError(409, code, "Bước này đã xong.", undefined, { ok: false, error: { code }, steps: [], next });

  it("UC-1208 AC-7: gửi bước 2 lần hai sau khi mất phản hồi (409 step_order, next savings_gap) → sang bước 3, không báo lỗi", () => {
    expect(stepConflict("goals", conflict("step_order", "savings_gap"))).toEqual({ next: "savings_gap", silent: true });
  });

  it("UC-1208 AC-2: gửi bước chưa tới lượt (next pockets) → vẽ lại bước 1 và báo lỗi; đã xong hết / conversion_not_pending → không báo lỗi", () => {
    expect(stepConflict("goals", conflict("step_order", "pockets"))).toEqual({ next: "pockets", silent: false });
    expect(stepConflict("pockets", conflict("step_incomplete", "pockets"))).toEqual({ next: "pockets", silent: false });
    expect(stepConflict("savings_pct", conflict("step_order", null))).toEqual({ next: null, silent: true });
    expect(stepConflict("savings_pct", new ApiError(409, "conversion_not_pending", "Đã xong."))).toEqual({ next: null, silent: true });
  });

  it("lỗi không phải 409 có next (mất mạng, 400 savings_pct, 409 không thân) → hiện lỗi như thường", () => {
    expect(stepConflict("savings_pct", new ApiError(400, "invalid_input", "% từ 1 đến 100."))).toBeNull();
    expect(stepConflict("goals", new ApiError(0, "offline", "Không có mạng."))).toBeNull();
    expect(stepConflict("goals", new ApiError(409, "step_order", "x"))).toBeNull();
    expect(stepConflict("goals", new Error("x"))).toBeNull();
  });
});

describe("bước 2: mỗi mục tiêu một tài khoản thật", () => {
  it("UC-1208 AC-3: mỗi dòng có cách đặt số và hạn — lặp, một lần, % thuế; che số thì số tiền thành ••••, % giữ", () => {
    expect(goalTerms(goal("hoc-phi", "Học phí", { monthly_amount: 2_000_000, repeat_months: 3, target_amount: 6_000_000, due_date: "2027-01-15" }))).toBe("2.000.000/tháng, 3 tháng một lần · hạn 15/01/2027");
    expect(goalTerms(goals[1]!)).toBe("1.300.000/tháng");
    expect(goalTerms(goal("xe", "Bảo dưỡng xe", { monthly_amount: null, repeat_months: null, target_amount: 4_800_000, due_date: "2027-03-31" }))).toBe("cần 4.800.000 · hạn 31/03/2027");
    expect(goalTerms(goals[2]!)).toBe("10% thu chịu thuế");
    setAmountsHidden(true);
    try {
      expect(goalTerms(goals[1]!)).toBe("••••/tháng");
      expect(goalTerms(goals[2]!)).toBe("10% thu chịu thuế");
    } finally {
      setAmountsHidden(false);
    }
  });

  it("UC-1208 AC-3: chọn sẵn tài khoản đề xuất cho Học phí; Hoá đơn, Thuế chưa chọn → Tiếp khoá tới khi mọi dòng có lựa chọn", () => {
    const choices = initialGoalChoices(goals, accounts, "du-phong");
    expect(choices).toEqual({ "hoc-phi": { kind: "account", accountId: "tiet-kiem" }, "hoa-don": null, "thue": null });
    expect(goalsReady(goals, choices)).toBe(false);
    expect(goalsReady(goals, { ...choices, "hoa-don": { kind: "account", accountId: "phao" } })).toBe(false);
    expect(goalsReady(goals, { ...choices, "hoa-don": { kind: "account", accountId: "phao" }, "thue": { kind: "later" } })).toBe(true);
  });

  it("UC-1208 AC-2: tài khoản đề xuất đã đổi sang Tích luỹ / đã tắt / là Ví Thưởng / đã gắn mục tiêu khác → không chọn sẵn", () => {
    const moved = accounts.map((a) => (a.id === "tiet-kiem" ? { ...a, pocket: "savings" as const } : a));
    expect(initialGoalChoices(goals, moved, "du-phong")["hoc-phi"]).toBeNull();
    expect(initialGoalChoices([goal("x", "X", { suggested_account_id: "cu" })], accounts, null).x).toBeNull();
    expect(initialGoalChoices([goal("x", "X", { suggested_account_id: "du-phong" })], accounts, "du-phong").x).toBeNull();
    const taken = [goal("a", "A", { account_id: "phao", held: 5_000_000 }), goal("b", "B", { suggested_account_id: "phao" })];
    expect(initialGoalChoices(taken, accounts, null)).toEqual({ a: { kind: "account", accountId: "phao" }, b: null });
    // Hai mục tiêu cùng đề xuất một tài khoản: chỉ dòng đầu được chọn sẵn.
    const twice = [goal("a", "A", { suggested_account_id: "phao" }), goal("b", "B", { suggested_account_id: "phao" })];
    expect(initialGoalChoices(twice, accounts, null)).toEqual({ a: { kind: "account", accountId: "phao" }, b: null });
  });

  it("UC-1208 AC-3: ô chọn của mỗi dòng có tài khoản Dự phòng đang dùng (tài khoản dòng khác đã chọn kèm 'dùng chung với …'), không phải Ví Thưởng đang chọn; Ví Thưởng chỉ tài khoản không thuộc dòng nào", () => {
    const choices: Record<string, GoalChoice | null> = { "hoc-phi": { kind: "account", accountId: "tiet-kiem" }, "hoa-don": null, "thue": null };
    expect(goalRowAccounts("hoa-don", goals, accounts, choices, "du-phong").map((a) => [a.id, a.shared])).toEqual([
      ["tiet-kiem", "dùng chung với Học phí"],
      ["phao", null],
    ]);
    expect(goalRowAccounts("hoc-phi", goals, accounts, choices, "du-phong").map((a) => [a.id, a.shared])).toEqual([
      ["tiet-kiem", null],
      ["phao", null],
    ]);
    // Ví Thưởng chuyển sang "Chưa chọn" → tài khoản dự phòng chọn được cho mục tiêu.
    expect(goalRowAccounts("hoa-don", goals, accounts, choices, null).map((a) => a.id)).toEqual(["tiet-kiem", "phao", "du-phong"]);
    // Ví Thưởng không chọn được tài khoản đã thuộc dòng mục tiêu (UC-1208 AC-11: rewardRowAccounts giữ luật "không gắn mục tiêu").
    expect(rewardRowAccounts(accounts, goals, { ...choices, "hoa-don": { kind: "account", accountId: "phao" } }).map((a) => a.id)).toEqual(["du-phong"]);
    // Mục tiêu đang gắn mà dòng của nó chọn Để sau → tài khoản đó rảnh.
    const attached = [goal("a", "A", { account_id: "phao", held: 5_000_000 }), goal("b", "B")];
    expect(goalRowAccounts("b", attached, accounts, { a: { kind: "later" }, b: null }, null).map((a) => [a.id, a.shared])).toEqual([
      ["tiet-kiem", null],
      ["phao", null],
      ["du-phong", null],
    ]);
    expect(goalRowAccounts("b", attached, accounts, { a: { kind: "account", accountId: "phao" }, b: null }, null).find((a) => a.id === "phao")!.shared).toBe("dùng chung với A");
  });

  it("UC-1208 AC-11: Nhà ở và Học tập cùng chọn MB tiết kiệm → dòng nhóm 'MB tiết kiệm 12.000.000 ₫ cho Nhà ở, Học tập · thiếu 1.500.000 ₫' + câu thứ tự; Thuế thấy MB tiết kiệm tắt 'Thuế cần tài khoản riêng'; Tiếp gửi hai PATCH, mục tiêu % gắn sau cùng; che số", () => {
    const house = [account("chinh", "Tài khoản chính", { pocket: "operating" }), account("tk-tiet-kiem", "MB tiết kiệm", { book_balance: 12_000_000 }), account("phao", "Phao", { book_balance: 5_000_000 })];
    // Thứ tự server (goals theo thứ tự ưu tiên).
    const list = [
      goal("thue", "Thuế", { target_pct: 10, target_amount: null, monthly_amount: null, repeat_months: null, sort: 10 }),
      goal("nha-o", "Nhà ở", { target_amount: 7_500_000, monthly_amount: 7_500_000, due_date: "2026-12-05", sort: 20 }),
      goal("hoc-tap", "Học tập", { target_amount: 6_000_000, monthly_amount: null, repeat_months: null, due_date: "2027-01-15", sort: 30 }),
    ];
    const choices: Record<string, GoalChoice | null> = { "nha-o": { kind: "account", accountId: "tk-tiet-kiem" }, "hoc-tap": { kind: "account", accountId: "tk-tiet-kiem" }, thue: null };
    expect(goalGroupLines(list, house, choices)).toEqual([{ accountId: "tk-tiet-kiem", text: `MB tiết kiệm 12.000.000${NBSP}₫ cho Nhà ở, Học tập · thiếu 1.500.000${NBSP}₫` }]);
    expect(GOAL_ORDER_NOTE).toBe("Thứ tự ưu tiên đổi ở Cài đặt › Ba ngăn");
    expect(goalGroupLines(list, house, { ...choices, "hoc-tap": { kind: "later" } })).toEqual([]);
    expect(goalGroupLines(list, house.map((a) => (a.id === "tk-tiet-kiem" ? { ...a, book_balance: 15_000_000 } : a)), choices)[0]!.text).toMatch(/· dư 1\.500\.000/);
    expect(goalGroupLines(list, house.map((a) => (a.id === "tk-tiet-kiem" ? { ...a, book_balance: 13_500_000 } : a)), choices)[0]!.text).toMatch(/· đủ$/);
    const forTax = goalRowAccounts("thue", list, house, choices, null);
    expect(forTax.map((a) => [a.id, a.shared, a.blocked])).toEqual([
      ["tk-tiet-kiem", "dùng chung với Nhà ở, Học tập", "Thuế cần tài khoản riêng"],
      ["phao", null, null],
    ]);
    // Dòng khác không chọn được tài khoản đã chọn cho mục tiêu %.
    expect(goalRowAccounts("nha-o", list, house, { ...choices, thue: { kind: "account", accountId: "phao" } }, null).find((a) => a.id === "phao")!.blocked).toBe("Thuế cần tài khoản riêng");
    expect(goalStepRequests(list, { ...choices, thue: { kind: "account", accountId: "phao" } }, { current: null, next: null })).toEqual([
      { method: "PATCH", path: "/v1/settings/goals/nha-o", body: { account_id: "tk-tiet-kiem" } },
      { method: "PATCH", path: "/v1/settings/goals/hoc-tap", body: { account_id: "tk-tiet-kiem" } },
      { method: "PATCH", path: "/v1/settings/goals/thue", body: { account_id: "phao" } },
    ]);
    setAmountsHidden(true);
    try {
      expect(goalGroupLines(list, house, choices)[0]!.text).toBe(`MB tiết kiệm ••••${NBSP}₫ cho Nhà ở, Học tập · thiếu ••••${NBSP}₫`);
    } finally {
      setAmountsHidden(false);
    }
  });

  it("UC-1208 AC-3: biến thể nhà một tài khoản — không tài khoản Dự phòng nào, chọn Để sau cho mọi mục tiêu thì Tiếp bật, không gửi gì", () => {
    const one = [account("chinh", "Tài khoản chính", { pocket: "operating" })];
    expect(goalRowAccounts("hoc-phi", goals, one, {}, null)).toEqual([]);
    expect(NO_RESERVE_ACCOUNT).toBe("Nhà chưa có tài khoản nào ở ngăn Dự phòng: mở một tài khoản thật (tài khoản phụ, sổ tiết kiệm…) cho từng mục tiêu, hoặc để sau.");
    const later = { "hoc-phi": { kind: "later" }, "hoa-don": { kind: "later" }, "thue": { kind: "later" } } as const;
    expect(goalsReady(goals, later)).toBe(true);
    expect(goalStepRequests(goals, later, { current: null, next: null })).toEqual([]);
  });

  it("UC-1208 AC-3: Tiếp gửi tắt / bỏ gắn trước, rồi Ví Thưởng, rồi gắn tài khoản; dòng không đổi thì không gửi", () => {
    const list = [...goals, goal("sua-nha", "Sửa nhà", { account_id: "phao", held: 5_000_000 }), goal("xe", "Xe", { account_id: "du-phong", held: 4_000_000 })];
    const choices: Record<string, GoalChoice | null> = {
      "hoc-phi": { kind: "account", accountId: "tiet-kiem" },
      "hoa-don": { kind: "account", accountId: "du-phong" },
      "thue": { kind: "later" },
      "sua-nha": { kind: "off" },
      "xe": { kind: "account", accountId: "du-phong" },
    };
    expect(goalStepRequests(list, { ...choices, "hoa-don": { kind: "later" } }, { current: "x", next: "phao" })).toEqual([
      { method: "PATCH", path: "/v1/settings/goals/sua-nha", body: { active: false } },
      { method: "PUT", path: "/v1/settings/config", body: { surplus_reward_account: "phao" } },
      { method: "PATCH", path: "/v1/settings/goals/hoc-phi", body: { account_id: "tiet-kiem" } },
    ]);
    // Đổi tài khoản của mục tiêu đã gắn: bỏ gắn trước, gắn sau cùng.
    expect(goalStepRequests([goal("xe", "Xe", { account_id: "du-phong" }), goal("hd", "Hoá đơn")], { xe: { kind: "account", accountId: "phao" }, hd: { kind: "account", accountId: "du-phong" } }, { current: null, next: null })).toEqual([
      { method: "PATCH", path: "/v1/settings/goals/xe", body: { account_id: null } },
      { method: "PATCH", path: "/v1/settings/goals/xe", body: { account_id: "phao" } },
      { method: "PATCH", path: "/v1/settings/goals/hd", body: { account_id: "du-phong" } },
    ]);
    // Để sau với mục tiêu đang gắn → bỏ gắn.
    expect(goalStepRequests([goal("xe", "Xe", { account_id: "du-phong" })], { xe: { kind: "later" } }, { current: null, next: null })).toEqual([
      { method: "PATCH", path: "/v1/settings/goals/xe", body: { account_id: null } },
    ]);
  });

  it("UC-1208 AC-9: 'Tạo tài khoản mới' cho Hoá đơn, tên 'Tài khoản hoá đơn' → một yêu cầu POST /v1/settings/goals/hoa-don/account; mất phản hồi rồi Lưu lại → thân giống hệt (cùng name, không sinh mã); xong → dòng Hoá đơn có 'Tài khoản hoá đơn · đã có 0 ₫'", () => {
    const form = { ...accountToForm(null), name: "Hoá đơn", pocket: "reserve" as const, pocket_touched: true };
    expect(form.name).toBe("Hoá đơn");
    const typed = { ...form, name: "Tài khoản hoá đơn", bank: "MBBank", account_no: "0999123456" };
    const first = accountPayload(typed, null);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const sent = goalAccountRequest("hoa-don", first.value);
    expect(sent).toEqual({ method: "POST", path: "/v1/settings/goals/hoa-don/account", body: first.value });
    expect(sent.body).toMatchObject({ name: "Tài khoản hoá đơn", pocket: "reserve", account_no: "0999123456" });
    expect("id" in sent.body).toBe(false);
    // Lưu lại: dựng lại từ cùng ô → cùng thân, cùng tên (mã = slug tên ở server, không đổi).
    const again = accountPayload(typed, null);
    expect(again.ok && goalAccountRequest("hoa-don", again.value)).toEqual(sent);
    // Server trả tài khoản vừa gắn: dòng Hoá đơn chọn được nó với số đã có.
    const created = account("tai-khoan-hoa-don", "Tài khoản hoá đơn", { book_balance: 0 });
    const linked = goals.map((g) => (g.id === "hoa-don" ? { ...g, account_id: created.id, held: 0 } : g));
    const row = goalRowAccounts("hoa-don", linked, [...accounts, created], { "hoa-don": { kind: "account", accountId: created.id } }, "du-phong");
    expect(row.map((a) => a.id)).toContain("tai-khoan-hoa-don");
    // Sheet thêm mục tiêu mới: bước một tạo mục tiêu không account_id, bước hai đúng yêu cầu tạo + gắn ở trên.
    expect(goalCreateRequest({ name: "Hoá đơn", account_id: null, monthly_amount: 1_300_000 })).toEqual({ method: "POST", path: "/v1/settings/goals", body: { name: "Hoá đơn", monthly_amount: 1_300_000 } });
  });
});

describe("bước 3: Tích luỹ — tiền thật khác ví cũ", () => {
  afterEach(() => setAmountsHidden(false));

  it("UC-1208 AC-4: hộ mẫu E — ví cũ 7.000.000, không gồm 2.000.000 tài sản, thật 6.000.000, chênh −1.000.000; có tài khoản Tích luỹ thì không có câu mở tài khoản", () => {
    const l = savingsGapLines({ legacyCash: 7_000_000, legacyAssets: 2_000_000, realSavings: 6_000_000, diff: -1_000_000, hasSavingsAccount: true });
    expect(l).toEqual({
      legacy: `Ví Tích sản cũ (số app chia trên giấy): 7.000.000${NBSP}₫`,
      assets: `không gồm 2.000.000${NBSP}₫ tài sản đã mua`,
      real: `Tích luỹ thật hôm nay: 6.000.000${NBSP}₫`,
      diff: `Chênh: −1.000.000${NBSP}₫`,
      noAccount: null,
    });
    expect(SAVINGS_GAP_EXPLAIN).toContain("Từ bản 2.0, Tích luỹ là tiền thật đang nằm ở các tài khoản ngăn Tích luỹ.");
    expect(savingsGapLines({ legacyCash: 1, legacyAssets: 0, realSavings: 501, diff: 500, hasSavingsAccount: true }).diff).toBe(`Chênh: +500${NBSP}₫`);
  });

  it("UC-1208 AC-4: nhà một tài khoản — ví cũ 3.000.000, thật 0, chênh −3.000.000, có câu 'Chưa có tài khoản Tích luỹ…'", () => {
    const l = savingsGapLines({ legacyCash: 3_000_000, legacyAssets: 0, realSavings: 0, diff: -3_000_000, hasSavingsAccount: false });
    expect(l.real).toBe(`Tích luỹ thật hôm nay: 0${NBSP}₫`);
    expect(l.diff).toBe(`Chênh: −3.000.000${NBSP}₫`);
    expect(l.noAccount).toBe("Chưa có tài khoản Tích luỹ: mở một tài khoản thật cho Tích luỹ (tài khoản phụ, sổ tích luỹ…), rồi xếp vào ngăn Tích luỹ ở Cài đặt › Ba ngăn.");
  });

  it("UC-1208 AC-7: che số → mọi số tiền bước 3 thành ••••, 'Bước 3/5' giữ", () => {
    setAmountsHidden(true);
    const l = savingsGapLines({ legacyCash: 7_000_000, legacyAssets: 2_000_000, realSavings: 6_000_000, diff: -1_000_000, hasSavingsAccount: true });
    expect(l.legacy).toBe(`Ví Tích sản cũ (số app chia trên giấy): ••••${NBSP}₫`);
    expect(l.diff).toBe(`Chênh: −••••${NBSP}₫`);
    expect(Object.values(l).join(" ")).not.toMatch(/\d/);
    expect(convertTitle("savings_gap")).toBe("Chuyển sang ba ngăn · Bước 3/5");
  });
});

describe("bước 4 và 5", () => {
  afterEach(() => setAmountsHidden(false));
  const stream = (id: string, opens_cycle: boolean, active = true) => ({ id, name: id, sort: 10, active, pocket: null, opens_cycle });

  it("UC-1208 AC-5: nguồn cho thuê không có công tắc; tắt hết → Tiếp khoá trừ khi chọn 'Nhà mình không có lương cố định'; bật 2 nguồn → câu 'Đang bật 2 nguồn…'", () => {
    const streams = [stream("salary", true), stream("side", false), stream("rental", false), stream("old", true, false)];
    expect(cycleSwitchStreams(streams, "rental").map((s) => s.id)).toEqual(["salary", "side"]);
    expect(payCycleReady(1, false)).toBe(true);
    expect(payCycleReady(0, false)).toBe(false);
    expect(payCycleReady(0, true)).toBe(true);
    expect(cycleStreamsNote(1)).toBeNull();
    expect(cycleStreamsNote(2)).toBe("Đang bật 2 nguồn: khoản về trước trong 7 ngày quanh ngày lương mở kỳ");
  });

  it("UC-1208 AC-6, AC-7: đặt 15% → câu trích 15% kèm ví dụ 'Lương 20.000.000 → trích 3.000.000'; che số → số tiền che, '15%' giữ; % sai → không có câu; toast khi xong", () => {
    expect(savingsPctLines(15)).toEqual({
      line: "Lương về, việc đầu tiên là trích 15% sang Tích luỹ. Kỳ nào không trích được thì bỏ qua và ghi lý do.",
      example: "Lương 20.000.000 → trích 3.000.000",
    });
    setAmountsHidden(true);
    expect(savingsPctLines(15)).toEqual({
      line: "Lương về, việc đầu tiên là trích 15% sang Tích luỹ. Kỳ nào không trích được thì bỏ qua và ghi lý do.",
      example: "Lương •••• → trích ••••",
    });
    expect(savingsPctLines(null)).toBeNull();
    expect(CONVERT_DONE_TOAST).toBe("Xong. Từ giờ Hôm nay là tiền thật của ba ngăn.");
  });
});
