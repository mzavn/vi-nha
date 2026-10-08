// Gọi /v1 bằng cookie phiên. Mọi phản hồi là { ok:true, data } hoặc { ok:false, error:{ code, message } }.
// Yêu cầu ghi luôn gửi JSON: server từ chối yêu cầu ghi không phải JSON bằng 415.

import type { RawResponse, Transport } from "../offline/queue";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Ô bị lỗi theo server, dạng dấu chấm ("members.0.name"); chỉ có ở một số lỗi 400. */
    readonly field?: string,
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

/** Header service worker gắn vào phản hồi lấy từ cache khi mất mạng. */
export const SW_CACHED_AT = "x-sw-cached-at";
/** Header app gửi khi người dùng chủ động tải lại: service worker bỏ qua bản lưu còn tươi, hỏi mạng ngay. */
export const NO_CACHE = "x-no-cache";

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => void (onUnauthorized = fn);

const timeoutSignal = (ms: number): AbortSignal | undefined =>
  typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(ms) : undefined;

/** Gộp các lời gọi cùng khoá đang chạy: lời gọi sau nhận chung promise của lời gọi đầu, xong thì khoá được gọi lại. */
export function inflight<T>() {
  const running = new Map<string, Promise<T>>();
  return {
    run(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = running.get(key);
      if (existing) return existing;
      const p = fn().finally(() => {
        if (running.get(key) === p) running.delete(key);
      });
      running.set(key, p);
      return p;
    },
    /** Sau một yêu cầu ghi: GET mới phải đi riêng, không nhận kết quả của GET bắt đầu trước khi ghi. */
    clear: () => running.clear(),
  };
}

const gets = inflight<{ data: unknown; cachedAt: string | null }>();

/** GET trùng đường dẫn đang chạy (vài màn cùng đọc /v1/rental, version tăng làm mọi màn đọc lại) đi chung một lượt. */
export function request<T>(path: string, method = "GET", body?: unknown, noCache = false): Promise<{ data: T; cachedAt: string | null }> {
  if (method !== "GET") {
    gets.clear();
    return send<T>(path, method, body, false);
  }
  return gets.run(`${noCache ? "!" : ""}${path}`, () => send(path, method, undefined, noCache)) as Promise<{ data: T; cachedAt: string | null }>;
}

async function send<T>(path: string, method: string, body: unknown, noCache: boolean): Promise<{ data: T; cachedAt: string | null }> {
  const headers: Record<string, string> = body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" };
  if (noCache) headers[NO_CACHE] = "1";
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutSignal(20_000),
    });
  } catch {
    throw new ApiError(0, "offline", "Không có mạng.");
  }
  const payload = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { code?: string; message?: string; field?: string } } | null;
  // Sai mật khẩu (đổi mật khẩu riêng, thiết lập) là 401 nhưng phiên vẫn còn: không đẩy về màn đăng nhập.
  if (res.status === 401 && payload?.error?.code !== "wrong_password" && !path.startsWith("/v1/session")) onUnauthorized();
  if (!res.ok || !payload?.ok) {
    const field = typeof payload?.error?.field === "string" ? payload.error.field : undefined;
    throw new ApiError(res.status, payload?.error?.code ?? `http_${res.status}`, payload?.error?.message ?? `Máy chủ trả mã ${res.status}.`, field);
  }
  return { data: payload.data as T, cachedAt: res.headers.get(SW_CACHED_AT) };
}

export const api = {
  /** `noCache`: người dùng chủ động tải lại, hoặc màn cần số trực tiếp từ server. */
  get: <T>(path: string, noCache = false) => request<T>(path, "GET", undefined, noCache).then((r) => r.data),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, "POST", body).then((r) => r.data),
  patch: <T>(path: string, body: unknown) => request<T>(path, "PATCH", body).then((r) => r.data),
  put: <T>(path: string, body: unknown) => request<T>(path, "PUT", body).then((r) => r.data),
  del: <T>(path: string) => request<T>(path, "DELETE", {}).then((r) => r.data),
};

/** Đường gửi của hàng đợi: trả mã HTTP và thân thô để queue.classify tự phân loại. */
export const httpTransport: Transport = async (body): Promise<RawResponse> => {
  gets.clear();
  try {
    const res = await fetch("/v1/transactions", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: timeoutSignal(15_000),
    });
    return { status: res.status, payload: await res.json().catch(() => null) };
  } catch {
    return null;
  }
};

/** Câu lỗi cho người dùng: nói cái gì hỏng, không xin lỗi. */
export const errorText = (err: unknown): string =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Lỗi không rõ.";
