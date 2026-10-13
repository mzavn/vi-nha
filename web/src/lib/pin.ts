// Mã PIN khóa app trên máy này (pwa UC-719, ADR-110). Thuần để test: localStorage truyền vào, số vòng băm truyền vào được.
// Băm chỉ để không đọc thẳng được PIN (6 số chỉ có 10⁶ khả năng); lớp bảo vệ chính là giới hạn 5 lần sai.

export const PIN_KEY = "vi-nha:pin";
export const PIN_FAILS_KEY = "vi-nha:pin-fails";
/** Cờ "phải đăng nhập lại": quên PIN / sai 5 lần, kể cả khi offline (cookie phiên HttpOnly, JS không xoá được). */
export const RELOGIN_KEY = "vi-nha:relogin";
export const PIN_ITERATIONS = 150_000;
export const MAX_PIN_FAILS = 5;
/** Ở nền từ chừng này trở lên thì quay lại phải nhập PIN. */
export const LOCK_AFTER_MS = 60_000;

export type PinStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PinRecord {
  v: 1;
  /** Người đăng nhập lúc đặt PIN: người khác vào máy này thì PIN không còn. */
  memberId: string;
  iter: number;
  /** 16 byte, base64. */
  salt: string;
  /** PBKDF2-SHA-256, 32 byte, base64. */
  hash: string;
}

export type PinCheck = { ok: true } | { ok: false; left: number };

export const isPinText = (pin: string): boolean => /^\d{6}$/.test(pin);

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, key, 256);
  return toBase64(new Uint8Array(bits));
}

export async function createPinRecord(pin: string, memberId: string, iter = PIN_ITERATIONS): Promise<PinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, memberId, iter, salt: toBase64(salt), hash: await derive(pin, salt, iter) };
}

export async function pinMatches(record: PinRecord, pin: string): Promise<boolean> {
  return (await derive(pin, fromBase64(record.salt), record.iter)) === record.hash;
}

/** localStorage dùng được không (thử ghi rồi xoá) — không dùng được thì không cho bật PIN. */
export function deviceStorage(): PinStorage | null {
  try {
    localStorage.setItem("vi-nha:probe", "1");
    localStorage.removeItem("vi-nha:probe");
    return localStorage;
  } catch {
    return null;
  }
}

/** PIN đang đặt trên máy cho `memberId`, đọc đồng bộ. Hỏng, sai phiên bản, của người khác, hay không đọc được → null. */
export function readPin(storage: PinStorage | null, memberId: string | null): PinRecord | null {
  try {
    const r = JSON.parse(storage?.getItem(PIN_KEY) ?? "null") as Partial<PinRecord> | null;
    if (!r || r.v !== 1 || typeof r.memberId !== "string" || typeof r.iter !== "number" || typeof r.salt !== "string" || typeof r.hash !== "string") return null;
    return memberId === null || r.memberId === memberId ? (r as PinRecord) : null;
  } catch {
    return null;
  }
}

/** Ghi PIN mới, bộ đếm sai về 0. Ném lỗi nếu localStorage không ghi được — màn đặt PIN báo lại. */
export function savePin(storage: PinStorage, record: PinRecord): void {
  storage.setItem(PIN_KEY, JSON.stringify(record));
  storage.removeItem(PIN_FAILS_KEY);
}

/** Xoá PIN và bộ đếm (đăng xuất, phiên hết hạn, tắt PIN). */
export function clearPin(storage: PinStorage | null): void {
  try {
    storage?.removeItem(PIN_KEY);
    storage?.removeItem(PIN_FAILS_KEY);
  } catch {
    // localStorage bị chặn: không có PIN nào để xoá
  }
}

/** Người vừa vào máy không phải người đặt PIN → xoá PIN. */
export function keepPinFor(storage: PinStorage | null, memberId: string): void {
  if (!readPin(storage, memberId)) clearPin(storage);
}

export function pinFails(storage: PinStorage | null): number {
  try {
    const n = Number(storage?.getItem(PIN_FAILS_KEY) ?? 0);
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Quên PIN / sai 5 lần: xoá PIN, ghi cờ phải đăng nhập lại. Hàng đợi khoản chưa gửi không đụng tới. */
export function forgetPinOnDevice(storage: PinStorage | null): void {
  clearPin(storage);
  try {
    storage?.setItem(RELOGIN_KEY, "1");
  } catch {
    // không ghi được cờ: PIN cũng đã không đọc được, app vẫn về màn đăng nhập ở lần này
  }
}

export function needsRelogin(storage: PinStorage | null): boolean {
  try {
    return storage?.getItem(RELOGIN_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearRelogin(storage: PinStorage | null): void {
  try {
    storage?.removeItem(RELOGIN_KEY);
  } catch {
    // không có cờ để xoá
  }
}

/**
 * Kiểm PIN: tăng bộ đếm TRƯỚC khi kiểm (kiểm là async, tải lại giữa chừng không được mất lần đếm); đúng thì về 0.
 * Sai lần thứ 5 → `forgetPinOnDevice` (`left: 0`). Màn khóa, Đổi PIN, Tắt PIN dùng chung bộ đếm này.
 */
export async function checkPin(storage: PinStorage, memberId: string, pin: string): Promise<PinCheck> {
  const record = readPin(storage, memberId);
  const fails = pinFails(storage) + 1;
  storage.setItem(PIN_FAILS_KEY, String(fails));
  if (record && (await pinMatches(record, pin))) {
    storage.removeItem(PIN_FAILS_KEY);
    return { ok: true };
  }
  const left = Math.max(0, MAX_PIN_FAILS - fails);
  if (left === 0) forgetPinOnDevice(storage);
  return { ok: false, left };
}

/** Đổi PIN: PIN cũ đúng mới ghi PIN mới (cùng người). */
export async function changePin(storage: PinStorage, memberId: string, oldPin: string, newPin: string, iter = PIN_ITERATIONS): Promise<PinCheck> {
  const check = await checkPin(storage, memberId, oldPin);
  if (check.ok) savePin(storage, await createPinRecord(newPin, memberId, iter));
  return check;
}

/** Tắt PIN: PIN cũ đúng thì xoá. */
export async function removePin(storage: PinStorage, memberId: string, oldPin: string): Promise<PinCheck> {
  const check = await checkPin(storage, memberId, oldPin);
  if (check.ok) clearPin(storage);
  return check;
}

/** Quay lại từ nền: ở nền ≥ 60 giây thì khóa; đồng hồ bị chỉnh lùi (chênh âm) cũng khóa. Chưa vào nền (null) thì không. */
export function shouldLock(hiddenAt: number | null, now: number): boolean {
  if (hiddenAt === null) return false;
  const away = now - hiddenAt;
  return away < 0 || away >= LOCK_AFTER_MS;
}
