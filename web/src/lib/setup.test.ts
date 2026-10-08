import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, SW_CACHED_AT } from "./api";
import { emptySetup, removeMember, setupNeeded, setupPayload, setupServerError, stepErrors, stepOfField, type SetupForm } from "./setup";

const valid = (patch: Partial<SetupForm> = {}): SetupForm => ({
  ...emptySetup(),
  password: "chung-cua-nha",
  members: [
    { name: "Chồng", password: "" },
    { name: "Vợ", password: "rieng-cua-vo" },
  ],
  accounts: [
    { name: "MB (vợ)", kind: "bank", bank: "MBBank", owner: 1 },
    { name: "Tiền mặt", kind: "cash", bank: "", owner: null },
  ],
  taxable: false,
  must: ["food", "utilities"],
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
  it("một người, một tài khoản ngân hàng trống, đủ bốn ví Must, chưa trả lời câu thuế", () => {
    const f = emptySetup();
    expect(f.members).toEqual([{ name: "", password: "" }]);
    expect(f.accounts).toEqual([{ name: "", kind: "bank", bank: "", owner: null }]);
    expect(f.must).toEqual(["food", "housing", "transport", "utilities"]);
    expect(f.taxable).toBeNull();
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
    const acct = (name: string, owner: number | null = null) => ({ name, kind: "cash" as const, bank: "", owner });
    expect(stepErrors(valid({ accounts: [acct("")] }), 2)).toEqual({ "accounts.0.name": expect.any(String) });
    expect(stepErrors(valid({ accounts: [acct("Tiền mặt"), acct("tiền mặt ")] }), 2)).toEqual({ "accounts.1.name": expect.any(String) });
    expect(stepErrors(valid({ accounts: [acct("Tiền Mặt"), acct("Tien mat")] }), 2)).toEqual({ "accounts.1.name": expect.any(String) });
    expect(stepErrors(valid({ accounts: [acct("Tiền mặt", 2)] }), 2)).toEqual({ "accounts.0.owner": expect.any(String) });
    expect(stepErrors(valid(), 2)).toEqual({});
  });

  it("bước 4: phải trả lời câu thu nhập tự nộp thuế", () => {
    expect(stepErrors(valid({ taxable: null }), 3)).toEqual({ "template.taxable": expect.any(String) });
    expect(stepErrors(valid({ must: [] }), 3)).toEqual({});
  });
});

describe("UC-510: thân POST /v1/setup", () => {
  it("đúng hình dạng: tên đã cắt khoảng trắng, chỉ gửi mật khẩu riêng khi có, ngân hàng chỉ khi không phải tiền mặt, ví Must theo thứ tự cố định", () => {
    const r = setupPayload(
      valid({
        members: [
          { name: " Chồng ", password: "" },
          { name: "Vợ", password: "rieng-cua-vo" },
        ],
        accounts: [
          { name: "MB (vợ)", kind: "bank", bank: "MBBank", owner: 1 },
          { name: "Tiền mặt", kind: "cash", bank: "MBBank", owner: null },
          { name: "MoMo", kind: "ewallet", bank: "", owner: 0 },
        ],
        taxable: true,
        must: ["utilities", "food"],
      }),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        password: "chung-cua-nha",
        members: [{ name: "Chồng" }, { name: "Vợ", password: "rieng-cua-vo" }],
        accounts: [
          { name: "MB (vợ)", kind: "bank", bank: "MBBank", owner: 1 },
          { name: "Tiền mặt", kind: "cash", owner: null },
          { name: "MoMo", kind: "ewallet", owner: 0 },
        ],
        template: { taxable: true, must: ["food", "utilities"] },
      },
    });
  });

  it("còn lỗi ở bất kỳ bước nào thì không dựng thân", () => {
    expect(setupPayload(valid({ password: "" })).ok).toBe(false);
    expect(setupPayload(valid({ taxable: null })).ok).toBe(false);
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
        { name: "Của A", kind: "cash", bank: "", owner: 0 },
        { name: "Của B", kind: "cash", bank: "", owner: 1 },
        { name: "Của C", kind: "cash", bank: "", owner: 2 },
        { name: "Chung", kind: "cash", bank: "", owner: null },
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
    expect(stepOfField("template.must")).toBe(3);
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
