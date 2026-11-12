import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, SW_CACHED_AT } from "./api";
import { evalAmount, isAmountExpr, nextAmount } from "./money";
import { emptySetup, goalAccountChoices, newGoal, removeAccount, removeMember, savingsStep, SETUP_STEPS, setupNeeded, setupPayload, setupServerError, setupSummary, stepErrors, stepOfField, type SetupForm } from "./setup";
import { SAVINGS_MARKS, SAVINGS_SCALE_TEXT } from "./savings-scale";

const valid = (patch: Partial<SetupForm> = {}): SetupForm => ({
  ...emptySetup(),
  password: "chung-cua-nha",
  members: [
    { name: "Chồng", password: "" },
    { name: "Vợ", password: "rieng-cua-vo" },
  ],
  accounts: [
    { name: "MB (vợ)", kind: "bank", bank: "MBBank", owner: 1, pocket: "operating" },
    { name: "Tiền mặt", kind: "cash", bank: "", owner: null, pocket: "operating" },
  ],
  taxable: false,
  groups: ["food", "utilities"],
  ...patch,
});

describe("UC-701 AC-8: mở app hỏi GET /v1/setup", () => {
  const reply = (body: unknown, headers: Record<string, string> = {}) =>
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true, data: body }), { status: 200, headers: { "Content-Type": "application/json", ...headers } }));
  afterEach(() => vi.unstubAllGlobals());

  it("needed: true → màn Thiết lập; needed: false → màn đăng nhập", async () => {
    reply({ needed: true });
    expect(await setupNeeded()).toBe(true);
    reply({ needed: false });
    expect(await setupNeeded()).toBe(false);
  });

  it("mất mạng, server lỗi, hay chỉ có bản service worker lưu từ trước → màn đăng nhập như hiện nay", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await setupNeeded()).toBe(false);
    vi.stubGlobal("fetch", async () => new Response("bad gateway", { status: 502 }));
    expect(await setupNeeded()).toBe(false);
    reply({ needed: true }, { [SW_CACHED_AT]: "2026-10-08T01:00:00Z" });
    expect(await setupNeeded()).toBe(false);
  });
});

describe("UC-701 AC-8: form Thiết lập — bắt đầu", () => {
  it("một người, một tài khoản ngân hàng trống ở Vận hành, ngày lương 10, % Tích luỹ 10, đủ bốn nhóm mẫu, chưa có mục tiêu, chưa trả lời câu thuế", () => {
    const f = emptySetup();
    expect(f.members).toEqual([{ name: "", password: "" }]);
    expect(f.accounts).toEqual([{ name: "", kind: "bank", bank: "", owner: null, pocket: "operating" }]);
    expect([f.paydayDay, f.savingsPct]).toEqual(["10", "10"]);
    expect(f.groups).toEqual(["food", "housing", "transport", "utilities"]);
    expect(f.goals).toEqual([]);
    expect(f.taxable).toBeNull();
  });

  it("UC-510 AC-12: bước 4 tên “Ba ngăn”", () => {
    expect(SETUP_STEPS[3]).toBe("Ba ngăn");
  });

  it("UC-510 AC-16: bước % Tích luỹ chọn sẵn 10 trên thanh vạch 1 · 10 · 30 kèm câu thang; không đổi gì rồi hoàn tất → savings_pct 10; kéo tới vạch 30 → 30", () => {
    const f = emptySetup();
    expect(savingsStep(f)).toEqual({ pct: 10, text: SAVINGS_SCALE_TEXT });
    expect(SAVINGS_MARKS.map((m) => m.pct)).toEqual([1, 10, 30]);
    expect(setupPayload(valid()).ok && (setupPayload(valid()) as { value: { savings_pct: number } }).value.savings_pct).toBe(10);
    expect(savingsStep({ ...f, savingsPct: "30" }).pct).toBe(30);
    // Ô gõ đang sai (xoá trắng): thanh đứng ở 10, nút Tiếp vẫn báo lỗi ô.
    expect(savingsStep({ ...f, savingsPct: "" }).pct).toBe(10);
    expect(stepErrors(valid({ savingsPct: "" }), 3).savings_pct).toBeDefined();
  });
});

describe("UC-510 AC-4 (phía app): kiểm từng bước trước khi bấm Tiếp", () => {
  it("bước 1: phải nhập mật khẩu chung", () => {
    expect(stepErrors(valid({ password: "" }), 0)).toEqual({ password: expect.any(String) });
    expect(stepErrors(valid(), 0)).toEqual({});
  });

  it("bước 2: 1–6 người; tên 1–40 ký tự", () => {
    expect(stepErrors(valid({ members: [] }), 1)).toEqual({ members: expect.any(String) });
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: `Người ${i}`, password: "" }));
    expect(stepErrors(valid({ members: seven }), 1)).toEqual({ members: expect.stringContaining("6") });
    expect(stepErrors(valid({ members: [{ name: "  ", password: "" }] }), 1)).toEqual({ "members.0.name": expect.any(String) });
    expect(stepErrors(valid({ members: [{ name: "a".repeat(41), password: "" }] }), 1)).toEqual({ "members.0.name": expect.stringContaining("40") });
  });

  it("bước 2: tên trùng không phân biệt hoa thường, bỏ dấu cách hai đầu, hoặc ra cùng mã (Mẹ / Me) — báo ở ô sau", () => {
    expect(stepErrors(valid({ members: [{ name: "An", password: "" }, { name: " an ", password: "" }] }), 1)).toEqual({ "members.1.name": expect.stringContaining("An") });
    expect(stepErrors(valid({ members: [{ name: "Mẹ", password: "" }, { name: "Me", password: "" }] }), 1)).toEqual({ "members.1.name": expect.any(String) });
  });

  it("bước 2: mật khẩu riêng để trống được, có thì ít nhất 8 ký tự", () => {
    expect(stepErrors(valid({ members: [{ name: "An", password: "1234567" }] }), 1)).toEqual({ "members.0.password": expect.stringContaining("8") });
    expect(stepErrors(valid({ members: [{ name: "An", password: "12345678" }] }), 1)).toEqual({});
  });

  it("bước 3: ít nhất một tài khoản; tên bắt buộc, không trùng (kể cả cùng mã); người giữ phải là một người ở bước 2", () => {
    expect(stepErrors(valid({ accounts: [] }), 2)).toEqual({ accounts: expect.any(String) });
    const acct = (name: string, owner: number | null = null) => ({ name, kind: "cash" as const, bank: "", owner, pocket: "operating" as const });
    expect(stepErrors(valid({ accounts: [acct("")] }), 2)).toEqual({ "accounts.0.name": expect.any(String) });
    expect(stepErrors(valid({ accounts: [acct("Tiền mặt"), acct("tiền mặt ")] }), 2)).toEqual({ "accounts.1.name": expect.any(String) });
    expect(stepErrors(valid({ accounts: [acct("Tiền Mặt"), acct("Tien mat")] }), 2)).toEqual({ "accounts.1.name": expect.any(String) });
    expect(stepErrors(valid({ accounts: [acct("Tiền mặt", 2)] }), 2)).toEqual({ "accounts.0.owner": expect.any(String) });
    expect(stepErrors(valid(), 2)).toEqual({});
  });

  it("bước 4: phải trả lời câu thuế; ngày lương 1–31, % Tích luỹ 1–100; bỏ hết nhóm mẫu vẫn được", () => {
    expect(stepErrors(valid({ taxable: null }), 3)).toEqual({ taxable: expect.any(String) });
    expect(stepErrors(valid({ groups: [] }), 3)).toEqual({});
    expect(stepErrors(valid({ paydayDay: "32", savingsPct: "0" }), 3)).toEqual({ payday_day: expect.any(String), savings_pct: expect.any(String) });
    expect(stepErrors(valid({ paydayDay: "", savingsPct: "101" }), 3)).toEqual({ payday_day: expect.any(String), savings_pct: expect.any(String) });
  });

  it("UC-510 AC-11 (phía app): mục tiêu cần tên (không trùng nhau, không trùng Thuế khi tự nộp thuế), số mỗi tháng > 0, 1–12 tháng; tối đa 10 mục; không còn tên dành riêng “Giữ cho Tích luỹ”", () => {
    const goal = (name: string, monthly = 2_000_000, repeat = "1") => ({ name, monthly, repeat, account: null });
    expect(stepErrors(valid({ goals: [goal("Học phí", 2_000_000, "3")] }), 3)).toEqual({});
    expect(stepErrors(valid({ goals: [newGoal()] }), 3)).toEqual({ "goals.0.name": expect.any(String), "goals.0.monthly_amount": expect.any(String) });
    expect(stepErrors(valid({ goals: [goal("Học phí"), goal("hoc phi")] }), 3)).toEqual({ "goals.1.name": expect.any(String) });
    expect(stepErrors(valid({ goals: [goal("Học phí", 2_000_000, "13")] }), 3)).toEqual({ "goals.0.repeat_months": expect.any(String) });
    expect(stepErrors(valid({ taxable: true, goals: [goal("Thuế")] }), 3)).toEqual({ "goals.0.name": expect.any(String) });
    expect(stepErrors(valid({ taxable: false, goals: [goal("Thuế")] }), 3)).toEqual({});
    expect(stepErrors(valid({ goals: [goal("Giữ cho Tích luỹ")] }), 3)).toEqual({});
    expect(stepErrors(valid({ goals: Array.from({ length: 11 }, (_, i) => goal(`Mục ${i + 1}`)) }), 3)).toEqual({ goals: expect.any(String) });
  });

  it("UC-510 AC-14 (phía app): tài khoản của mục tiêu chọn trong các tài khoản ngăn Dự phòng đã nhập hoặc “Chưa có”; hai mục tiêu cùng một tài khoản được (server chia theo thứ tự hạn); tài khoản đổi khỏi Dự phòng → lỗi ở ô goals.N.account", () => {
    const accounts = [
      { name: "MB (vợ)", kind: "bank" as const, bank: "MBBank", owner: 1, pocket: "operating" as const },
      { name: "Sổ BIDV", kind: "bank" as const, bank: "BIDV", owner: null, pocket: "reserve" as const },
      { name: "", kind: "bank" as const, bank: "TCB", owner: null, pocket: "reserve" as const },
    ];
    const goal = (name: string, account: number | null) => ({ name, monthly: 2_000_000, repeat: "1", account });
    const f = valid({ accounts, goals: [goal("Học phí", 1), goal("Bảo dưỡng xe", null)] });
    const both = [
      { index: 1, name: "Sổ BIDV" },
      { index: 2, name: "Tài khoản 3" },
    ];
    expect(goalAccountChoices(f)).toEqual(both);
    expect(stepErrors(f, 3)).toEqual({});
    const shared = valid({ accounts, goals: [goal("Học phí", 1), goal("Xe", 1)] });
    expect(stepErrors(shared, 3)).toEqual({});
    // Ô tên tài khoản thứ ba trống (lỗi bước 3) nên dựng thân với hai tài khoản đầu.
    const body = setupPayload({ ...shared, accounts: accounts.slice(0, 2) });
    expect(body.ok && body.value.goals.map((g) => g.account)).toEqual([1, 1]);
    expect(stepErrors(valid({ accounts, goals: [goal("Học phí", 0)] }), 3)).toEqual({ "goals.0.account": "Tài khoản của mục tiêu phải ở ngăn Dự phòng." });
    expect(stepOfField("goals.0.account")).toBe(3);
    // Bớt tài khoản: mục tiêu gắn nó về Chưa có, chỉ số tài khoản sau lùi một.
    const g3 = valid({ accounts, goals: [goal("A", 1), goal("B", 2)] });
    expect(removeAccount(g3, 1).goals.map((g) => g.account)).toEqual([null, 1]);
    expect(removeAccount(g3, 0).goals.map((g) => g.account)).toEqual([0, 1]);
  });
});

describe("UC-510: thân POST /v1/setup", () => {
  it("UC-510 AC-12: đúng hình dạng — tên đã cắt khoảng trắng, mật khẩu riêng chỉ khi có, ngân hàng chỉ khi không phải tiền mặt, ngăn từng tài khoản, ngày lương, % Tích luỹ, nhóm theo thứ tự cố định, mục tiêu; không có `template`", () => {
    const r = setupPayload(
      valid({
        members: [
          { name: " Chồng ", password: "" },
          { name: "Vợ", password: "rieng-cua-vo" },
        ],
        accounts: [
          { name: "MB (vợ)", kind: "bank", bank: "MBBank", owner: 1, pocket: "operating" },
          { name: "Tiền mặt", kind: "cash", bank: "MBBank", owner: null, pocket: null },
          { name: "MoMo", kind: "ewallet", bank: "", owner: 0, pocket: "savings" },
          { name: "Sổ BIDV", kind: "bank", bank: "BIDV", owner: null, pocket: "reserve" },
        ],
        paydayDay: "5",
        savingsPct: "15",
        taxable: true,
        groups: ["utilities", "food"],
        goals: [
          { name: " Học phí ", monthly: 2_000_000, repeat: "3", account: 3 },
          { name: "Xe", monthly: 400_000, repeat: "12", account: null },
        ],
      }),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        password: "chung-cua-nha",
        members: [{ name: "Chồng" }, { name: "Vợ", password: "rieng-cua-vo" }],
        accounts: [
          { name: "MB (vợ)", kind: "bank", bank: "MBBank", owner: 1, pocket: "operating" },
          { name: "Tiền mặt", kind: "cash", owner: null, pocket: null },
          { name: "MoMo", kind: "ewallet", owner: 0, pocket: "savings" },
          { name: "Sổ BIDV", kind: "bank", bank: "BIDV", owner: null, pocket: "reserve" },
        ],
        payday_day: 5,
        savings_pct: 15,
        taxable: true,
        groups: ["food", "utilities"],
        goals: [
          { name: "Học phí", monthly_amount: 2_000_000, repeat_months: 3, account: 3 },
          { name: "Xe", monthly_amount: 400_000, repeat_months: 12 },
        ],
      },
    });
    expect(r.ok && "template" in r.value).toBe(false);
  });

  it("còn lỗi ở bất kỳ bước nào thì không dựng thân", () => {
    expect(setupPayload(valid({ password: "" })).ok).toBe(false);
    expect(setupPayload(valid({ taxable: null })).ok).toBe(false);
    expect(setupPayload(valid({ goals: [newGoal()] })).ok).toBe(false);
  });

  it("UC-510 AC-15: “Số mỗi tháng” là ô AmountInput chung — gõ 2000000, “2.000.000” hay phép tính “1.500.000+500.000” đều gửi monthly_amount: 2000000", () => {
    // Ô AmountInput: số thường đọc bằng nextAmount (nhóm chấm khi gõ), phép tính bằng evalAmount.
    const typed = (text: string) => (isAmountExpr(text) ? (evalAmount(text) ?? 0) : nextAmount(0, text));
    for (const text of ["2000000", "2.000.000", "1.500.000+500.000"]) {
      const r = setupPayload(valid({ goals: [{ name: "Học phí", monthly: typed(text), repeat: "1", account: null }] }));
      expect(r.ok && r.value.goals).toEqual([{ name: "Học phí", monthly_amount: 2_000_000, repeat_months: 1 }]);
    }
    // Phép tính sai (kết quả ≤ 0) → ô báo, không dựng thân.
    expect(stepErrors(valid({ goals: [{ name: "Học phí", monthly: typed("500.000-600.000"), repeat: "1", account: null }] }), 3)).toEqual({ "goals.0.monthly_amount": expect.any(String) });
  });
});

describe("UC-510 AC-12: dòng “Sẽ tạo:” ở bước Ba ngăn", () => {
  it("UC-510 AC-12: liệt kê ngăn và tài khoản, nguồn Lương, nhóm (kèm Y tế, Mua sắm), mục tiêu (kèm Thuế 10%); không chữ ví / Profit First / chia / giữ riêng", () => {
    const text = setupSummary(
      valid({
        accounts: [
          { name: "MB (vợ)", kind: "bank", bank: "MBBank", owner: 1, pocket: "operating" },
          { name: "Sổ BIDV", kind: "bank", bank: "BIDV", owner: null, pocket: "reserve" },
          { name: "", kind: "cash", bank: "", owner: null, pocket: null },
        ],
        taxable: true,
        groups: ["utilities", "food"],
        goals: [{ name: "Học phí", monthly: 2_000_000, repeat: "3", account: 1 }],
      }),
    );
    expect(text).toBe(
      "Sẽ tạo: Vận hành: MB (vợ) · Dự phòng: Sổ BIDV · Ngoài ngăn: Tài khoản 3 · nguồn “Lương” mở kỳ lương · nhóm Ăn uống, Điện nước, Y tế, Mua sắm · mục tiêu Dự phòng Học phí, Thuế 10%.",
    );
    expect(text).not.toMatch(/(^|\P{L})ví(\P{L}|$)|profit first|chia|giữ riêng/iu);
  });

  it("UC-510 AC-14: nhà không có tài khoản Tích luỹ cũng không tạo “Giữ cho Tích luỹ”; không mục tiêu thì không có phần mục tiêu", () => {
    expect(setupSummary(valid({ groups: [] }))).toBe("Sẽ tạo: Vận hành: MB (vợ), Tiền mặt · nguồn “Lương” mở kỳ lương · nhóm Y tế, Mua sắm.");
    const text = setupSummary(valid({ accounts: [{ name: "Heo", kind: "cash", bank: "", owner: null, pocket: "savings" }], groups: [] }));
    expect(text).toBe("Sẽ tạo: Tích luỹ: Heo · nguồn “Lương” mở kỳ lương · nhóm Y tế, Mua sắm.");
  });
});

describe("UC-701 AC-8: bớt người ở bước 2 giữ đúng người giữ tài khoản", () => {
  it("tài khoản của người bị bớt thành chung; chỉ số người sau lùi một", () => {
    const f = valid({
      members: [
        { name: "A", password: "" },
        { name: "B", password: "" },
        { name: "C", password: "" },
      ],
      accounts: [
        { name: "Của A", kind: "cash", bank: "", owner: 0, pocket: "operating" },
        { name: "Của B", kind: "cash", bank: "", owner: 1, pocket: "operating" },
        { name: "Của C", kind: "cash", bank: "", owner: 2, pocket: "operating" },
        { name: "Chung", kind: "cash", bank: "", owner: null, pocket: "operating" },
      ],
    });
    const g = removeMember(f, 1);
    expect(g.members.map((m) => m.name)).toEqual(["A", "C"]);
    expect(g.accounts.map((a) => a.owner)).toEqual([0, null, 1, null]);
  });
});

describe("UC-701 AC-8: lỗi server hiện đúng ô", () => {
  it("field dấu chấm → đúng bước", () => {
    expect(stepOfField("password")).toBe(0);
    expect(stepOfField("members")).toBe(1);
    expect(stepOfField("members.3.password")).toBe(1);
    expect(stepOfField("accounts.1.owner")).toBe(2);
    expect(stepOfField("accounts.1.pocket")).toBe(3);
    for (const f of ["payday_day", "savings_pct", "taxable", "groups", "goals", "goals.0.name", "goals[2].monthly_amount"]) expect(stepOfField(f)).toBe(3);
    expect(stepOfField("template")).toBeNull();
    expect(stepOfField("khác")).toBeNull();
  });

  it("400 có field: lỗi gắn vào ô đó (cả dạng members[0].name), mở đúng bước", () => {
    expect(setupServerError(new ApiError(400, "invalid_input", "Trùng tên.", "members[1].name"))).toEqual({ step: 1, errors: { "members.1.name": "Trùng tên." }, message: null });
    expect(setupServerError(new ApiError(400, "invalid_input", "Thiếu tài khoản.", "accounts"))).toEqual({ step: 2, errors: { accounts: "Thiếu tài khoản." }, message: null });
  });

  it("401 sai mật khẩu chung → ô mật khẩu ở bước 1", () => {
    expect(setupServerError(new ApiError(401, "wrong_password", "Sai mật khẩu."))).toEqual({ step: 0, errors: { password: "Sai mật khẩu." }, message: null });
  });

  it("409 đã thiết lập, 429, mất mạng → câu chung, giữ bước đang đứng", () => {
    expect(setupServerError(new ApiError(409, "already_setup", "Nhà đã thiết lập."))).toEqual({ step: null, errors: {}, message: "Nhà đã thiết lập." });
    expect(setupServerError(new ApiError(429, "too_many_attempts", "Thử lại sau."))).toEqual({ step: null, errors: {}, message: "Thử lại sau." });
    expect(setupServerError(new ApiError(0, "offline", "Không có mạng."))).toEqual({ step: null, errors: {}, message: "Không có mạng. Thiết lập cần mạng." });
  });
});
