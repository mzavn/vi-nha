import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, inflight, setUnauthorizedHandler } from "./api";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("inflight: gộp GET trùng đang chạy", () => {
  it("hai lời gọi cùng khoá lúc đang chạy đi chung một lượt", async () => {
    const g = inflight<number>();
    const d = deferred<number>();
    let calls = 0;
    const fn = () => (calls++, d.promise);
    const a = g.run("/v1/rental", fn);
    const b = g.run("/v1/rental", fn);
    d.resolve(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(calls).toBe(1);
  });

  it("khoá khác nhau chạy riêng", async () => {
    const g = inflight<string>();
    let calls = 0;
    await Promise.all([g.run("/v1/rental", async () => (calls++, "a")), g.run("!/v1/rental", async () => (calls++, "b"))]);
    expect(calls).toBe(2);
  });

  it("xong rồi thì lời gọi sau đi lượt mới, kể cả khi lượt trước lỗi", async () => {
    const g = inflight<number>();
    let calls = 0;
    await expect(g.run("k", async () => (calls++, Promise.reject(new Error("mạng"))))).rejects.toThrow("mạng");
    expect(await g.run("k", async () => (calls++, 2))).toBe(2);
    expect(calls).toBe(2);
  });

  it("clear (sau yêu cầu ghi): GET mới không nhận kết quả của GET bắt đầu trước khi ghi", async () => {
    const g = inflight<string>();
    const before = deferred<string>();
    const after = deferred<string>();
    const a = g.run("/v1/snapshot", () => before.promise);
    g.clear();
    const b = g.run("/v1/snapshot", () => after.promise);
    expect(b).not.toBe(a);
    // Lượt cũ xong muộn không được xoá lượt mới khỏi bảng: lời gọi tiếp theo vẫn đi chung lượt mới.
    before.resolve("trước khi ghi");
    expect(await a).toBe("trước khi ghi");
    expect(g.run("/v1/snapshot", async () => "lượt thứ ba")).toBe(b);
    after.resolve("sau khi ghi");
    expect(await b).toBe("sau khi ghi");
  });
});

describe("lỗi server: field và 401", () => {
  const reply = (status: number, error: Record<string, unknown>) =>
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: false, error }), { status, headers: { "Content-Type": "application/json" } }));
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(() => {});
  });

  it("UC-701 AC-8: 400 kèm field → ApiError.field chỉ ô lỗi", async () => {
    reply(400, { code: "invalid_input", message: "Trùng tên.", field: "members.1.name" });
    const err = await api.post("/v1/setup", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "invalid_input", message: "Trùng tên.", field: "members.1.name" });
  });

  it("UC-507 AC-13: 401 sai mật khẩu (đổi mật khẩu riêng, thiết lập) không đẩy về màn đăng nhập; 401 hết phiên thì có", async () => {
    const kicked = vi.fn();
    setUnauthorizedHandler(kicked);
    reply(401, { code: "wrong_password", message: "Sai mật khẩu." });
    await api.put("/v1/settings/members/wife/password", {}).catch(() => null);
    await api.post("/v1/setup", {}).catch(() => null);
    expect(kicked).not.toHaveBeenCalled();
    reply(401, { code: "unauthorized", message: "Cần đăng nhập." });
    await api.get("/v1/settings").catch(() => null);
    expect(kicked).toHaveBeenCalledTimes(1);
  });
});
