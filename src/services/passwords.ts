// Mật khẩu riêng của thành viên (UC-501, UC-507): PBKDF2-SHA256 qua Web Crypto, chuỗi lưu
// 'pbkdf2-sha256$<vòng>$<muối base64url>$<băm base64url>'. Số vòng nằm trong chuỗi nên tăng sau không cần migration.
// 20.000 vòng ≈ 5 ms CPU trên Cloudflare Free (đo 2026-10-08); bù phần thấp hơn OWASP bằng chặn dò (ADR-89).

/** So sánh không rò thời gian: luôn duyệt hết chuỗi dài hơn. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export const PASSWORD_ITERATIONS = 20_000;
/** Mật khẩu riêng tối thiểu 8 ký tự; trần để một yêu cầu không bắt băm chuỗi khổng lồ. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
/** Workers giới hạn PBKDF2 ở 100.000 vòng; chuỗi lưu ngoài khoảng này coi như hỏng. */
const MAX_ITERATIONS = 100_000;
const PREFIX = "pbkdf2-sha256";
const SALT_BYTES = 16;
const HASH_BITS = 256;

const enc = new TextEncoder();
export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return null;
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS);
  return b64url(new Uint8Array(bits));
}

export async function hashPassword(password: string, iterations = PASSWORD_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return `${PREFIX}$${iterations}$${b64url(salt)}$${await derive(password, salt, iterations)}`;
}

/** Đúng mật khẩu với chuỗi đã lưu; chuỗi hỏng → false (vẫn tốn một phép băm, để thời gian trả lời như nhau). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, iter, saltText, hash] = stored.split("$");
  const iterations = Number(iter);
  const salt = saltText ? fromB64url(saltText) : null;
  if (prefix !== PREFIX || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS || !salt || !hash) {
    await derive(password, DUMMY_SALT, PASSWORD_ITERATIONS);
    return false;
  }
  return safeEqual(await derive(password, salt, iterations), hash);
}

const DUMMY_SALT = new Uint8Array(SALT_BYTES);

/** Mật khẩu chung của nhà (`APP_PASSWORD`). Chưa đặt / rỗng thì không gì khớp — kể cả chuỗi rỗng. */
export const householdPasswordOk = (appPassword: string | undefined, given: string) => Boolean(appPassword) && safeEqual(given, appPassword!);

/**
 * Mật khẩu một người đang dùng để vào: có mật khẩu riêng thì chỉ so băm; không có thì so mật khẩu chung, sau một phép băm
 * giả cùng số vòng — thời gian trả lời không lộ ai có mật khẩu riêng (UC-501).
 */
export async function memberPasswordOk(appPassword: string | undefined, given: string, hash: string | null): Promise<boolean> {
  if (hash) return verifyPassword(given, hash);
  await derive(given, DUMMY_SALT, PASSWORD_ITERATIONS);
  return householdPasswordOk(appPassword, given);
}
