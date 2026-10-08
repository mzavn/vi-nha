import { describe, expect, it } from "vitest";
import type { EntryBody } from "../lib/types";
import { classify, createSyncer, memoryStore, type RawResponse, type Transport } from "./queue";

/** Server giả: chống trùng theo client_id như ledger.createEntry. */
function fakeServer() {
  const rows = new Map<string, EntryBody>();
  let online = true;
  let failNext: RawResponse | "drop-after-write" | undefined;
  const calls: string[] = [];
  const transport: Transport = async (body) => {
    calls.push(body.client_id);
    if (!online) return null;
    const mode = failNext;
    failNext = undefined;
    if (mode && mode !== "drop-after-write") return mode;
    const duplicate = rows.has(body.client_id);
    if (!duplicate) rows.set(body.client_id, body);
    // Server đã ghi nhưng phản hồi mất trên đường về.
    if (mode === "drop-after-write") return null;
    return { status: duplicate ? 200 : 201, payload: { ok: true, data: { tx: { id: rows.size }, duplicate, wallet: null } } };
  };
  return {
    rows,
    calls,
    transport,
    setOnline: (v: boolean) => void (online = v),
    failNextWith: (r: RawResponse | "drop-after-write") => void (failNext = r),
  };
}

let n = 0;
const body = (amount: number): EntryBody => ({
  meaning: "spend",
  amount,
  at: "2026-09-22T03:00:00.000Z",
  client_id: `c${String(++n).padStart(8, "0")}`,
  category_id: "ride-hailing",
  wallet_id: "transport",
});

function setup(member: string | null = "wife") {
  const server = fakeServer();
  const store = memoryStore();
  let t = 0;
  const syncer = createSyncer({
    store,
    transport: server.transport,
    memberId: () => member,
    isOnline: () => true,
    now: () => new Date(Date.UTC(2026, 8, 22, 3, 0, t++)),
  });
  return { server, store, syncer };
}

describe("phân loại phản hồi", () => {
  it("các trường hợp", () => {
    expect(classify(null)).toMatchObject({ kind: "retry", network: true });
    expect(classify({ status: 201, payload: { ok: true, data: { duplicate: false } } }).kind).toBe("ok");
    expect(classify({ status: 200, payload: { ok: true, data: { duplicate: true } } }).kind).toBe("ok");
    expect(classify({ status: 401, payload: { ok: false, error: { code: "unauthorized", message: "Cần đăng nhập." } } }).kind).toBe("auth");
    expect(classify({ status: 400, payload: { ok: false, error: { code: "unknown_category", message: "Không có danh mục." } } })).toEqual({
      kind: "rejected",
      code: "unknown_category",
      message: "Không có danh mục.",
    });
    expect(classify({ status: 409, payload: { ok: false, error: { code: "insufficient_cash", message: "x" } } }).kind).toBe("rejected");
    expect(classify({ status: 404, payload: null })).toMatchObject({ kind: "rejected", code: "http_404" });
    expect(classify({ status: 500, payload: { ok: false, error: { code: "internal", message: "Lỗi hệ thống." } } })).toMatchObject({ kind: "retry", network: false });
    expect(classify({ status: 503, payload: null }).kind).toBe("retry");
    expect(classify({ status: 429, payload: null }).kind).toBe("retry");
    expect(classify({ status: 200, payload: "<html>" }).kind).toBe("retry");
  });
});

describe("hàng đợi nhập offline", () => {
  it("tắt mạng nhập 3 khoản → bật mạng → server có đúng 3 giao dịch, gửi lại không sinh trùng", async () => {
    const { server, store, syncer } = setup();
    server.setOnline(false);
    for (const amount of [50_000, 120_000, 250_000]) {
      await syncer.enqueue(body(amount), "wife");
      await syncer.flush(); // có "mạng" theo trình duyệt nhưng không tới được server
    }
    expect((await store.list()).length).toBe(3);
    expect(server.rows.size).toBe(0);

    server.setOnline(true);
    const report = await syncer.flush();
    expect(Object.values(report.results).every((r) => r.kind === "ok")).toBe(true);
    expect(server.rows.size).toBe(3);
    expect(await store.list()).toEqual([]);

    // Gửi lại đúng ba khoản đó lần nữa (ví dụ bản sao hàng đợi từ tab khác): server vẫn chỉ có 3.
    const replay = createSyncer({ store: memoryStore(), transport: server.transport, memberId: () => "wife", isOnline: () => true });
    for (const b of server.rows.values()) await replay.enqueue(b, "wife");
    await replay.flush();
    expect(server.rows.size).toBe(3);
  });

  it("server ghi rồi mà phản hồi mất: khoản nằm lại, lần sau gửi lại vẫn chỉ một giao dịch", async () => {
    const { server, store, syncer } = setup();
    await syncer.enqueue(body(80_000), "wife");
    server.failNextWith("drop-after-write");
    const first = await syncer.flush();
    expect(first.stopped).toBe("offline");
    expect((await store.list())[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(server.rows.size).toBe(1);

    const second = await syncer.flush();
    const [result] = Object.values(second.results);
    expect(result).toMatchObject({ kind: "ok", data: { duplicate: true } });
    expect(server.rows.size).toBe(1);
    expect(await store.list()).toEqual([]);
  });

  it("trình duyệt báo offline thì không gửi gì", async () => {
    const server = fakeServer();
    const store = memoryStore();
    const syncer = createSyncer({ store, transport: server.transport, memberId: () => "wife", isOnline: () => false });
    await syncer.enqueue(body(1_000), "wife");
    const report = await syncer.flush();
    expect(report.stopped).toBe("offline");
    expect(server.calls).toEqual([]);
  });

  it("bị từ chối (4xx có mã) thì nằm lại kèm lý do, các khoản khác vẫn đi", async () => {
    const { server, store, syncer } = setup();
    const bad = body(10_000);
    await syncer.enqueue(bad, "wife");
    await syncer.enqueue(body(20_000), "wife");
    server.failNextWith({ status: 400, payload: { ok: false, error: { code: "unknown_category", message: 'Không có danh mục "ride-hailing".' } } });
    await syncer.flush();

    const left = await store.list();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ clientId: bad.client_id, status: "rejected", error: { code: "unknown_category" } });
    expect(server.rows.size).toBe(1);

    // Lần đồng bộ sau không tự gửi lại khoản bị từ chối…
    await syncer.flush();
    expect(server.calls.filter((c) => c === bad.client_id)).toHaveLength(1);
    // …chỉ khi người dùng bấm Gửi lại.
    await syncer.retry(bad.client_id);
    expect(await store.list()).toEqual([]);
    expect(server.rows.size).toBe(2);
  });

  it("lỗi 5xx: giữ lại để thử sau nhưng không chặn khoản phía sau; mất mạng thì dừng cả loạt", async () => {
    const { server, store, syncer } = setup();
    const a = body(1);
    await syncer.enqueue(a, "wife");
    await syncer.enqueue(body(2), "wife");
    server.failNextWith({ status: 500, payload: { ok: false, error: { code: "internal", message: "Lỗi hệ thống. Thử lại sau." } } });
    await syncer.flush();
    expect((await store.list()).map((i) => [i.clientId, i.status, i.attempts])).toEqual([[a.client_id, "pending", 1]]);
    expect(server.rows.size).toBe(1);

    await syncer.enqueue(body(3), "wife");
    server.setOnline(false);
    const report = await syncer.flush();
    expect(report.stopped).toBe("offline");
    expect(Object.keys(report.results)).toEqual([a.client_id]);
  });

  it("401: dừng, giữ nguyên hàng đợi để gửi sau khi đăng nhập lại", async () => {
    const { server, store, syncer } = setup();
    await syncer.enqueue(body(5), "wife");
    server.failNextWith({ status: 401, payload: { ok: false, error: { code: "unauthorized", message: "Cần đăng nhập." } } });
    const report = await syncer.flush();
    expect(report.stopped).toBe("auth");
    expect((await store.list())[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("chỉ gửi khoản của người đang đăng nhập", async () => {
    const { server, store, syncer } = setup("husband");
    await syncer.enqueue(body(5), "wife");
    await syncer.enqueue(body(6), "husband");
    await syncer.flush();
    expect(server.rows.size).toBe(1);
    expect((await store.list()).map((i) => i.memberId)).toEqual(["wife"]);
    const nobody = createSyncer({ store, transport: server.transport, memberId: () => null, isOnline: () => true });
    expect((await nobody.flush()).stopped).toBe("no_member");
  });

  it("gọi đồng bộ chồng nhau (online + visibility + bấm tay) không gửi một khoản hai lần", async () => {
    const { server, syncer } = setup();
    for (let i = 0; i < 3; i++) await syncer.enqueue(body(i + 1), "wife");
    const [r1, r2, r3] = await Promise.all([syncer.flush(), syncer.flush(), syncer.flush()]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(server.calls).toHaveLength(3);
    expect(new Set(server.calls).size).toBe(3);
  });

  it("khoản thêm vào trong lúc đang đồng bộ được gửi luôn trong lượt đó", async () => {
    const server = fakeServer();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let first = true;
    const transport: Transport = async (b) => {
      if (first) {
        first = false;
        await gate; // giữ request đầu tiên "đang bay"
      }
      return server.transport(b);
    };
    const syncer = createSyncer({ store: memoryStore(), transport, memberId: () => "wife", isOnline: () => true });
    await syncer.enqueue(body(1), "wife");
    const running = syncer.flush();
    const late = body(2);
    await syncer.enqueue(late, "wife");
    const joined = syncer.flush();
    release();
    const report = await joined;
    expect(report).toBe(await running);
    expect(report.results[late.client_id]?.kind).toBe("ok");
    expect(server.rows.size).toBe(2);
  });

  it("gửi theo đúng thứ tự nhập", async () => {
    const { server, syncer } = setup();
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await syncer.enqueue(body(i + 1), "wife")).clientId);
    await syncer.flush();
    expect(server.calls).toEqual(ids);
  });

  it("bỏ một khoản chỉ khi người dùng chủ động bỏ", async () => {
    const { store, syncer } = setup();
    const b = body(9);
    await syncer.enqueue(b, "wife");
    await syncer.discard(b.client_id);
    expect(await store.list()).toEqual([]);
  });

  it("báo thay đổi hàng đợi cho giao diện", async () => {
    const server = fakeServer();
    const seen: number[] = [];
    const syncer = createSyncer({ store: memoryStore(), transport: server.transport, memberId: () => "wife", isOnline: () => true, onChange: (items) => seen.push(items.length) });
    await syncer.enqueue(body(1), "wife");
    await syncer.flush();
    expect(seen).toEqual([1, 0]);
  });
});

describe("đổi người giữa lúc đang gửi", () => {
  it("dừng ngay, không gửi các khoản còn lại của người trước dưới phiên người sau", async () => {
    const server = fakeServer();
    const store = memoryStore();
    let member: string | null = "wife";
    // Người đổi ngay sau khoản đầu tiên được gửi đi.
    const transport: Transport = async (b) => {
      const r = await server.transport(b);
      member = "husband";
      return r;
    };
    const syncer = createSyncer({ store, transport, memberId: () => member, isOnline: () => true });
    await syncer.enqueue(body(10_000), "wife");
    await syncer.enqueue(body(20_000), "wife");
    await syncer.enqueue(body(30_000), "wife");
    member = "wife";
    await syncer.flush();
    expect(server.calls).toHaveLength(1);
    const left = await syncer.list();
    expect(left.map((i) => [i.memberId, i.status])).toEqual([
      ["wife", "pending"],
      ["wife", "pending"],
    ]);
  });
});
