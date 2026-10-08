// Thông báo đẩy trên máy này: bật, tắt, gửi thử và giữ subscription của máy gắn đúng người đang dùng.
// Subscription thuộc trình duyệt (dùng chung mọi người trên máy); server gắn nó với người đăng nhập lúc gửi lên.

import { ApiError, api } from "../lib/api";
import { base64UrlToBytes, isIos, pushState, type PushState } from "../lib/push";
import type { PushInfo, PushTestResult } from "../lib/types";

/** Máy này đã bật cho ai, mã subscription server trả — để nhận ra "máy này" trong danh sách và phát hiện đổi người. */
const BOUND = "vi-nha:push";
interface Bound {
  memberId: string;
  id: number;
}

function readBound(): Bound | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(BOUND) ?? "null");
    if (v && typeof v === "object" && "memberId" in v && "id" in v && typeof v.memberId === "string" && typeof v.id === "number") return { memberId: v.memberId, id: v.id };
  } catch {
    // localStorage bị chặn hoặc giá trị hỏng
  }
  return null;
}

/** Mọi thay đổi gắn máy (bật, tắt, đồng bộ lúc vào app) báo cho thẻ Cài đặt đang mở để vẽ lại. */
const listeners = new Set<() => void>();
export function onPushChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function writeBound(b: Bound | null) {
  try {
    if (b) localStorage.setItem(BOUND, JSON.stringify(b));
    else localStorage.removeItem(BOUND);
  } catch {
    // localStorage bị chặn: chỉ mất nhãn "máy này", việc gửi vẫn chạy
  }
  for (const fn of listeners) fn();
}

export const boundSubscriptionId = (): number | null => readBound()?.id ?? null;

/** Bản đăng ký service worker nếu máy hỗ trợ push; bản dev (không có service worker) coi như không hỗ trợ. */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return null;
  return (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ?? null;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription().catch(() => null) : null;
}

export async function readPushState(): Promise<PushState> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return pushState({
    supported: !!reg,
    ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
    standalone: matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && navigator.standalone === true),
    permission: "Notification" in window ? Notification.permission : null,
    subscribed: !!sub,
  });
}

async function upload(sub: PushSubscription, memberId: string): Promise<void> {
  const { endpoint, keys } = sub.toJSON();
  // Nhãn máy server rút từ header User-Agent của chính request này (ADR-90), không gửi trong body.
  const { id } = await api.post<{ id: number }>("/v1/push/subscriptions", {
    endpoint,
    keys: { p256dh: keys?.p256dh, auth: keys?.auth },
  });
  writeBound({ memberId, id });
}

/**
 * Nút "Bật thông báo". Phải gọi thẳng trong lúc xử lý cú bấm: iOS bỏ qua requestPermission() ngoài cử chỉ người dùng,
 * nên hỏi quyền trước mọi việc khác.
 * Trả quyền sau khi hỏi; "granted" nghĩa là đã đăng ký và gửi lên server.
 */
export async function enablePush(memberId: string, publicKey: string): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const reg = await registration();
  if (!reg) throw new Error("App chưa cài xong phần chạy nền. Tải lại trang rồi thử lại.");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
  await upload(sub, memberId);
  return permission;
}

/**
 * Gỡ máy này khỏi server rồi huỷ subscription của trình duyệt. Dùng cho nút "Tắt" và lúc đăng xuất / đổi người.
 * Mất mạng thì ném lỗi và giữ nguyên (lần sau làm lại); server lỗi khác vẫn huỷ ở máy — endpoint chết, lần gửi sau server tự xoá.
 */
export async function unbindPush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) {
    try {
      await api.post("/v1/push/subscriptions/remove", { endpoint: sub.endpoint });
    } catch (err) {
      if (err instanceof ApiError && err.offline) throw err;
    }
    await sub.unsubscribe().catch(() => false);
  }
  writeBound(null);
}

/**
 * Lúc vào app: máy đã bật thông báo thì gửi lại subscription (giữ gắn đúng người, hồi sinh dòng server đã xoá).
 * Máy đang gắn với người khác (phiên hết hạn rồi người kia đăng nhập) thì gỡ, để tin của người trước không hiện ở đây.
 * Im lặng: lỗi gì cũng bỏ qua, lần mở app sau làm lại.
 */
export async function syncPush(memberId: string): Promise<void> {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (!sub) return writeBound(null);
    const bound = readBound();
    if (bound && bound.memberId !== memberId) return await unbindPush();
    await upload(sub, memberId);
  } catch {
    // mất mạng hoặc server chưa có /v1/push — thử lại lần mở sau
  }
}

/** Luôn hỏi thẳng server: thẻ Cài đặt đọc lại mỗi 5 giây khi đang gửi thử, bản lưu 30 giây sẽ đứng yên số tin đã gửi. */
export const loadPushInfo = () => api.get<PushInfo>("/v1/push", true);
export const sendTestPush = () => api.post<PushTestResult>("/v1/push/test");
/** Bắt đầu lượt "Thử khi tắt app" theo mặc định server (2 tin: sau khoảng 10 và 20 giây); server gửi nền sau khi trả lời, nên tắt app vẫn nhận. */
export const startTestSeries = () => api.post<{ id: number; count: number; interval_s: number }>("/v1/push/test-series");
export const cancelTestSeries = () => api.post<{ cancelled: number }>("/v1/push/test-series/cancel");
