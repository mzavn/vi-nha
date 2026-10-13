import { describe, expect, it } from "vitest";
import {
  changePin,
  checkPin,
  clearRelogin,
  createPinRecord,
  forgetPinOnDevice,
  keepPinFor,
  LOCK_AFTER_MS,
  MAX_PIN_FAILS,
  needsRelogin,
  PIN_FAILS_KEY,
  PIN_ITERATIONS,
  PIN_KEY,
  pinFails,
  pinMatches,
  readPin,
  RELOGIN_KEY,
  removePin,
  savePin,
  shouldLock,
  type PinStorage,
} from "./pin";

// Số vòng nhỏ cho test chạy nhanh; bản thật dùng PIN_ITERATIONS.
const ITER = 1000;

/** localStorage giả: một Map dùng chung giữa các lần "tải lại" — mỗi lần đọc lại từ đầu như app mới mở. */
function fakeStorage(seed: Record<string, string> = {}): PinStorage & { raw: Map<string, string> } {
  const raw = new Map(Object.entries(seed));
  return { raw, getItem: (k) => raw.get(k) ?? null, setItem: (k, v) => void raw.set(k, v), removeItem: (k) => void raw.delete(k) };
}

async function withPin(pin = "123456", memberId = "husband") {
  const s = fakeStorage({ "vi-nha:queue": '{"c-1":{}}' });
  savePin(s, await createPinRecord(pin, memberId, ITER));
  return s;
}

describe("mã PIN trên máy này (pwa UC-719)", () => {
  it("UC-719 AC-1: băm rồi kiểm PIN đúng / sai; bản ghi có v, iter, salt, hash, memberId và không chứa PIN", async () => {
    const r = await createPinRecord("123456", "husband");
    expect(r.v).toBe(1);
    expect(r.iter).toBe(PIN_ITERATIONS);
    expect(PIN_ITERATIONS).toBe(150_000);
    expect(r.memberId).toBe("husband");
    expect(atob(r.salt)).toHaveLength(16);
    expect(atob(r.hash)).toHaveLength(32);
    expect(JSON.stringify(r)).not.toContain("123456");
    expect(await pinMatches(r, "123456")).toBe(true);
    expect(await pinMatches(r, "123457")).toBe(false);
    // Hai lần đặt cùng PIN: muối khác nên mã băm khác.
    const again = await createPinRecord("123456", "husband", ITER);
    expect(again.salt).not.toBe(r.salt);
  });

  it("UC-719 AC-1: bản ghi đọc lại đồng bộ từ localStorage `vi-nha:pin`; hỏng hay sai phiên bản thì coi như chưa đặt", async () => {
    const s = await withPin();
    expect(JSON.parse(s.raw.get(PIN_KEY)!)).toMatchObject({ v: 1, memberId: "husband", iter: ITER });
    expect(readPin(s, "husband")?.memberId).toBe("husband");
    expect(readPin(fakeStorage({ [PIN_KEY]: "{không phải json" }), "husband")).toBeNull();
    expect(readPin(fakeStorage({ [PIN_KEY]: JSON.stringify({ v: 2, memberId: "husband", iter: 1, salt: "", hash: "" }) }), "husband")).toBeNull();
    expect(readPin(null, "husband")).toBeNull();
  });

  it("UC-719 AC-2: shouldLock — ở nền 59 giây không hỏi; 60 và 61 giây hỏi; đồng hồ chỉnh lùi hỏi; chưa vào nền không hỏi", () => {
    const t = 1_760_000_000_000;
    expect(LOCK_AFTER_MS).toBe(60_000);
    expect(shouldLock(t, t + 59_000)).toBe(false);
    expect(shouldLock(t, t + 59_999)).toBe(false);
    expect(shouldLock(t, t + 60_000)).toBe(true);
    expect(shouldLock(t, t + 61_000)).toBe(true);
    expect(shouldLock(t, t - 1)).toBe(true);
    expect(shouldLock(null, t)).toBe(false);
  });

  it("UC-719 AC-3: bộ đếm sai tăng TRƯỚC khi kiểm (tải lại giữa chừng không mất lần đếm) và còn sau khi tải lại; đúng thì về 0", async () => {
    const s = await withPin();
    const pending = checkPin(s, "husband", "000000");
    // Chưa kiểm xong (kiểm là async) mà bộ đếm đã ghi.
    expect(s.raw.get(PIN_FAILS_KEY)).toBe("1");
    expect(await pending).toEqual({ ok: false, left: MAX_PIN_FAILS - 1 });
    expect(await checkPin(s, "husband", "000001")).toEqual({ ok: false, left: 3 });
    // "Tải lại": đọc lại từ cùng localStorage.
    expect(pinFails(s)).toBe(2);
    expect(await checkPin(s, "husband", "123456")).toEqual({ ok: true });
    expect(pinFails(s)).toBe(0);
  });

  it("UC-719 AC-3: sai 5 lần liên tiếp → `vi-nha:pin` xoá, `vi-nha:relogin` ghi, hàng đợi khoản chưa gửi giữ nguyên", async () => {
    const s = await withPin();
    for (let i = 1; i < MAX_PIN_FAILS; i++) expect(await checkPin(s, "husband", "999999")).toEqual({ ok: false, left: MAX_PIN_FAILS - i });
    expect(s.raw.has(PIN_KEY)).toBe(true);
    expect(await checkPin(s, "husband", "999999")).toEqual({ ok: false, left: 0 });
    expect(s.raw.has(PIN_KEY)).toBe(false);
    expect(s.raw.has(PIN_FAILS_KEY)).toBe(false);
    expect(needsRelogin(s)).toBe(true);
    expect(s.raw.get("vi-nha:queue")).toBe('{"c-1":{}}');
  });

  it("UC-719 AC-4: Đổi PIN với PIN cũ sai → lỗi, PIN không đổi, bộ đếm tăng; PIN cũ đúng → PIN mới dùng được, PIN cũ không", async () => {
    const s = await withPin("123456");
    const before = s.raw.get(PIN_KEY);
    expect(await changePin(s, "husband", "111111", "654321", ITER)).toEqual({ ok: false, left: 4 });
    expect(s.raw.get(PIN_KEY)).toBe(before);
    expect(pinFails(s)).toBe(1);
    expect(await changePin(s, "husband", "123456", "654321", ITER)).toEqual({ ok: true });
    expect(pinFails(s)).toBe(0);
    expect(await checkPin(s, "husband", "654321")).toEqual({ ok: true });
    expect(await checkPin(s, "husband", "123456")).toEqual({ ok: false, left: 4 });
    // Tắt PIN cũng hỏi PIN hiện tại, dùng chung bộ đếm.
    expect(await removePin(s, "husband", "000000")).toEqual({ ok: false, left: 3 });
    expect(readPin(s, "husband")).not.toBeNull();
    expect(await removePin(s, "husband", "654321")).toEqual({ ok: true });
    expect(readPin(s, "husband")).toBeNull();
    expect(needsRelogin(s)).toBe(false);
  });

  it("UC-719 AC-5: Quên PIN (cả khi offline) → xoá PIN, ghi cờ relogin; còn cờ thì phải đăng nhập lại; đăng nhập thành công xoá cờ", async () => {
    const s = await withPin();
    forgetPinOnDevice(s);
    expect(readPin(s, "husband")).toBeNull();
    expect(s.raw.get(RELOGIN_KEY)).toBe("1");
    expect(needsRelogin(s)).toBe(true);
    expect(s.raw.get("vi-nha:queue")).toBe('{"c-1":{}}');
    clearRelogin(s);
    expect(needsRelogin(s)).toBe(false);
    // localStorage bị chặn: không có cờ nào
    expect(needsRelogin(null)).toBe(false);
  });

  it("UC-719 AC-6: PIN của người A; đăng xuất rồi người B đăng nhập trên máy này → không còn PIN", async () => {
    const s = await withPin("123456", "husband");
    expect(readPin(s, "wife")).toBeNull();
    keepPinFor(s, "husband");
    expect(readPin(s, "husband")).not.toBeNull();
    keepPinFor(s, "wife");
    expect(s.raw.has(PIN_KEY)).toBe(false);
    expect(readPin(s, "husband")).toBeNull();
  });
});
