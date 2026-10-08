// Trạng thái dùng chung của app và các hành động. Không thư viện: một biến + danh sách người nghe.

import { useEffect, useState } from "preact/hooks";
import { ApiError, api, errorText, httpTransport, request, setUnauthorizedHandler } from "../lib/api";
import { setupNeeded, type SetupBody } from "../lib/setup";
import { applyQueue, entryToast, localWalletStatus, queuedLineAfter } from "../lib/pending";
import { editToast, txWalletId, voidToast } from "../lib/transactions";
import type { BookFilter } from "../lib/tx-filter";
import type { Bootstrap, EntryBody, MemberRef, ReplaceEntryResult, Snapshot, TxRow } from "../lib/types";
import { cacheClear, cacheGet, cacheSet, queueStore, StorageUnavailableError } from "../offline/idb";
import { createSyncer, type QueuedEntry } from "../offline/queue";
import { syncPush, unbindPush } from "./push";

/** Bốn tab ở thanh dưới, cộng ba màn phụ không chiếm tab: Cài đặt (nút bánh răng ở Hôm nay), Sổ giao dịch (`#ledger`, UC-716) và Hướng dẫn (`#guide`, nhúng GitBook). */
export type { Tab, WalletsTab } from "../lib/hash-route";
import { hashFor, parseHash, type Tab, type WalletsTab } from "../lib/hash-route";

export interface AppState {
  /** "setup": nhà chưa thiết lập (DB mới), hiện màn Thiết lập thay màn đăng nhập (UC-701 AC-8). */
  phase: "boot" | "setup" | "login" | "app";
  member: Pick<MemberRef, "id" | "name"> | null;
  boot: Bootstrap | null;
  /** Snapshot đúng như server trả; màn hình dùng `viewSnapshot()` để cộng hàng đợi. */
  snap: Snapshot | null;
  /** true = đang hiện số cũ vì không lấy được số mới. */
  stale: boolean;
  /** Lần tải số đầu tiên hỏng mà máy chưa có bản lưu nào: Hôm nay / Nhập hiện lý do kèm Tải lại thay cho khung chờ. */
  loadFailed: boolean;
  queue: QueuedEntry[];
  online: boolean;
  syncing: boolean;
  tab: Tab;
  walletsTab: WalletsTab;
  tierFilter: string | null;
  /** Phần Cài đặt mở thẳng tới (vd "Đổi tài khoản" ở card Tiền chi được); Cài đặt đọc xong thì xoá. */
  settingsFocus: "accounts" | null;
  /** Log chọn sẵn khi mở màn Gán từ bảng điều khiển máy tính. */
  assignFocus: string | null;
  toast: { id: number; text: string } | null;
  /** Dòng "vừa ghi" trên màn Nhập — toast tắt sau 2,2s, dòng này ở lại cho tới lần nhập sau. */
  lastEntry: string | null;
  /** Tăng mỗi lần có dữ liệu mới trên server, để các màn tự tải lại phần riêng của chúng. */
  version: number;
  /** Giao dịch đang mở ở sheet chi tiết (UC-715): id, kèm dòng sổ nếu danh sách đã có sẵn. */
  txOpen: { id: number; row?: TxRow } | null;
  /** Khoản chi đang sửa ở màn Nhập, và màn quay về khi sửa xong / bỏ sửa. */
  editTx: { tx: TxRow; back: Tab } | null;
  /** Bộ lọc đang xem ở Sổ giao dịch (UC-716) — giữ khi rời màn rồi quay lại; null = tháng hiện tại, không lọc. */
  book: BookFilter | null;
  /** Ghi thêm từ Sổ giao dịch: ngày điền sẵn ở màn Nhập, và màn quay về khi ghi xong. */
  entryPreset: { day: string; back: Tab } | null;
  /** Service worker bản mới đã giành quyền (state/sw-update.ts): hiện thanh "Đã có bản mới" kèm nút Tải bản mới. */
  updateReady: boolean;
}

const route = typeof location === "undefined" ? parseHash("") : parseHash(location.hash);

let state: AppState = {
  phase: "boot",
  member: null,
  boot: null,
  snap: null,
  stale: false,
  loadFailed: false,
  queue: [],
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  tab: route.tab,
  walletsTab: route.walletsTab ?? "budget",
  tierFilter: null,
  settingsFocus: null,
  assignFocus: null,
  toast: null,
  lastEntry: null,
  version: 0,
  txOpen: null,
  editTx: null,
  book: null,
  updateReady: false,
  entryPreset: null,
};
const listeners = new Set<() => void>();

export const getState = () => state;
export function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function useApp(): AppState {
  const [, setTick] = useState(0);
  const seen = state;
  useEffect(() => {
    const rerender = () => setTick((n) => n + 1);
    listeners.add(rerender);
    // Trạng thái có thể đã đổi giữa lúc vẽ và lúc đăng ký nghe — vẽ lại ngay để không lỡ.
    if (state !== seen) rerender();
    return () => void listeners.delete(rerender);
  }, []);
  return state;
}

/** Snapshot đã trừ tạm các khoản chưa đồng bộ. */
export const viewSnapshot = (s: AppState = state): Snapshot | null => (s.snap ? applyQueue(s.snap, s.queue) : null);

// ── Toast ──────────────────────────────────────────────────────────
let toastSeq = 0;
export const toast = (text: string) => setState({ toast: { id: ++toastSeq, text } });

// ── Điều hướng: màn trong hash ("#wallets/wealth-building") để F5, nút quay lại và lối tắt màn hình chính mở đúng chỗ ──
export function go(tab: Tab, patch: Partial<AppState> = {}) {
  setState(patch);
  const hash = hashFor(tab, state.walletsTab);
  if (location.hash !== hash) location.hash = hash.slice(1);
  else setState({ tab });
}

/** Đổi tab con của Ví & quỹ: ghi vào hash (thay chỗ, không thêm lượt quay lại) để F5 vẫn mở đúng tab con. */
export function setWalletsTab(walletsTab: WalletsTab) {
  setState({ walletsTab });
  history.replaceState(null, "", hashFor("wallets", walletsTab));
}

// ── Hàng đợi ───────────────────────────────────────────────────────
/** Khoản mà dòng "vừa ghi" đang báo "chờ đồng bộ", kèm câu sẽ thay khi nó lên sổ (`queuedLineAfter`). */
let lastEntryQueued: { clientId: string; synced: string } | null = null;

const syncer = createSyncer({
  store: queueStore,
  transport: httpTransport,
  memberId: () => state.member?.id ?? null,
  isOnline: () => navigator.onLine,
  onChange: (queue) => {
    const line = lastEntryQueued ? queuedLineAfter(queue, lastEntryQueued) : undefined;
    if (line === undefined) return setState({ queue });
    lastEntryQueued = null;
    setState({ queue, lastEntry: line });
  },
});

async function flushAndRefresh(): Promise<void> {
  if (state.phase !== "app") return;
  setState({ syncing: true });
  try {
    const report = await syncer.flush();
    if (report.stopped === "auth") return toLogin();
    if (Object.values(report.results).some((r) => r.kind === "ok")) await refresh();
  } finally {
    setState({ syncing: false });
  }
}

/** Nút "Đồng bộ": gửi hàng đợi và tải lại số (bỏ qua bản lưu còn tươi của service worker), rồi nói kết quả. */
export async function syncNow(): Promise<void> {
  const before = state.queue.filter((q) => q.status === "pending" && q.memberId === state.member?.id).length;
  if (!navigator.onLine) return toast(before ? `Chưa có mạng. ${before} khoản vẫn chờ đồng bộ.` : "Chưa có mạng.");
  await flushAndRefresh();
  await refresh(true);
  const left = state.queue.filter((q) => q.status === "pending" && q.memberId === state.member?.id).length;
  if (before === 0) toast(state.stale ? "Chưa tới được máy chủ. Đang hiện số cũ." : "Đã tải số mới.");
  else if (left === 0) toast(`Đã đồng bộ ${before} khoản.`);
  else if (left === before) toast(`Chưa tới được máy chủ. ${left} khoản vẫn chờ đồng bộ.`);
  else toast(`Đã đồng bộ ${before - left} khoản. ${left} khoản vẫn chờ.`);
}

/** Nút "Gửi lại" của một khoản trong hàng đợi: gửi lại rồi nói kết quả — bị từ chối lần nữa thì thẻ trông y như cũ. */
export async function retryEntry(clientId: string): Promise<void> {
  const report = await syncer.retry(clientId);
  if (report.stopped === "auth") return toLogin();
  const r = report.results[clientId];
  if (r?.kind === "ok") toast("Đã đồng bộ khoản này.");
  else if (r?.kind === "rejected") toast(`Vẫn bị từ chối: ${r.message}`);
  else toast("Chưa tới được máy chủ. Khoản này vẫn chờ đồng bộ.");
  await refresh();
}
/** Bỏ hẳn một khoản: dòng "vừa ghi" đang nói về nó (chờ đồng bộ) thì xoá luôn — khoản không bao giờ lên sổ. */
export function discardEntry(clientId: string) {
  if (lastEntryQueued?.clientId === clientId) {
    lastEntryQueued = null;
    setState({ lastEntry: null });
  }
  return syncer.discard(clientId);
}

const delay = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms));

/**
 * Lưu một khoản nhập: vào hàng đợi trước, rồi gửi. Chờ server tối đa 2,5 giây để toast dùng số thật;
 * quá thì báo bằng số tính tại máy và để việc gửi chạy tiếp.
 * Trả false khi KHÔNG giữ được khoản này ở đâu cả — màn nhập giữ nguyên số để người dùng thử lại.
 * `okText`: câu toast riêng khi server đã ghi (vd trả nợ nói còn nợ bao nhiêu); chờ đồng bộ hay bị từ chối vẫn dùng câu chung.
 */
export async function saveEntry(body: EntryBody, okText?: string): Promise<boolean> {
  const memberId = state.member?.id;
  if (!memberId) {
    toLogin();
    return false;
  }
  try {
    await syncer.enqueue(body, memberId);
  } catch (err) {
    toast(err instanceof StorageUnavailableError ? err.message : "Không lưu được khoản này. Thử lại.");
    return false;
  }

  const walletId = body.wallet_id ?? body.from_wallet_id ?? null;
  const view = viewSnapshot();
  const local = view && walletId ? localWalletStatus(view, walletId, new Date()) : null;

  setState({ syncing: true });
  const flushing = syncer.flush();
  const result = await Promise.race([flushing.then((r) => r.results[body.client_id] ?? null), delay(2500)]);
  void flushing.then(async (report) => {
    if (report.stopped === "auth") toLogin();
    else if (Object.values(report.results).some((r) => r.kind === "ok")) await refresh();
    setState({ syncing: false });
  });

  const counted = body.meaning === "spend" || body.meaning === "refund";
  let text: string;
  if (result?.kind === "ok") {
    text = okText ?? (counted ? entryToast(body.amount, result.data.wallet ?? local, false) : doneText(body, false));
  } else if (result?.kind === "rejected") {
    text = `Chưa ghi được: ${result.message} Khoản này nằm trong hàng đợi để sửa.`;
  } else {
    text = counted ? entryToast(body.amount, local, true) : doneText(body, true);
  }
  navigator.vibrate?.(12);
  // Còn chờ: lên sổ ở lượt gửi sau thì dòng thành câu đã ghi (số còn lại tính lúc lưu, đã trừ tạm khoản này); bị từ chối thì xoá.
  lastEntryQueued =
    result?.kind === "ok" || result?.kind === "rejected"
      ? null
      : { clientId: body.client_id, synced: okText ?? (counted ? entryToast(body.amount, local, false) : doneText(body, false)) };
  setState({ lastEntry: text });
  toast(text);
  return true;
}

function doneText(body: EntryBody, queued: boolean): string {
  const what =
    body.meaning === "transfer" && !body.account_id
      ? "chuyển ngân sách"
      : { lend: "khoản cho vay", collect: "khoản nhận lại", transfer: "chuyển nội bộ", buy_asset: "mua tài sản", income: "khoản thu", refund: "hoàn tiền", spend: "khoản chi" }[body.meaning];
  return `Đã ghi ${what}${queued ? ", chờ đồng bộ" : ""}.`;
}

// ── Xem, sửa, xoá một khoản đã lên sổ (UC-715) ─────────────────────
// Cần mạng: sửa / xoá ghi thẳng lên server, không qua hàng đợi. Lỗi ném ra để sheet hiện đúng lý do tại chỗ.
export const openTx = (id: number, row?: TxRow) => setState({ txOpen: { id, row } });

/** Xoá một khoản ghi tay: server đổi nó sang `void` (sổ vẫn giữ dòng), rồi toast nói ví còn bao nhiêu. */
export async function voidEntry(tx: TxRow): Promise<void> {
  await api.post(`/v1/transactions/${tx.id}/void`);
  await refresh();
  const walletId = txWalletId(tx);
  const view = viewSnapshot();
  const text = voidToast(tx, view && walletId ? localWalletStatus(view, walletId, new Date()) : null);
  // Dòng "vừa ghi" ở màn Nhập nói số còn lại của lần ghi trước — sửa / xoá xong thì thay bằng câu mới, không để số cũ.
  lastEntryQueued = null;
  setState({ lastEntry: text });
  toast(text);
}

/** Sửa = server huỷ khoản cũ và ghi khoản mới trong một lần (ADR-73). */
export async function replaceEntry(id: number, body: EntryBody): Promise<ReplaceEntryResult> {
  const res = await api.post<ReplaceEntryResult>(`/v1/transactions/${id}/replace`, body);
  void refresh();
  const text = editToast(res.tx, res.wallet);
  lastEntryQueued = null;
  setState({ lastEntry: text });
  toast(text);
  return res;
}

// ── Dữ liệu ────────────────────────────────────────────────────────
// Số liệu cache luôn gắn với người đang dùng: hai người dùng chung một máy không được thấy số của nhau.
export const cacheKey = (memberId: string, what: "bootstrap" | "snapshot" | "settings") => `${memberId}:${what}`;

export async function loadCached<T>(key: string, path: string, noCache = false): Promise<{ data: T; stale: boolean }> {
  try {
    const { data, cachedAt } = await request<T>(path, "GET", undefined, noCache);
    if (cachedAt) return { data, stale: true };
    await cacheSet(key, data, new Date().toISOString());
    return { data, stale: false };
  } catch (err) {
    if (err instanceof ApiError && (err.offline || err.status >= 500)) {
      const cached = await cacheGet<T>(key);
      if (cached) return { data: cached.data, stale: true };
    }
    throw err;
  }
}

let lastRefresh = 0;
let refreshing: Promise<void> | null = null;

/** `noCache`: người dùng bấm "Đồng bộ" — hỏi thẳng server. Còn lại service worker được trả bản lưu còn tươi (ADR-69). */
export function refresh(noCache = false): Promise<void> {
  refreshing ??= (async () => {
    try {
      const memberId = state.member?.id;
      if (!memberId) return;
      const [boot, snap] = await Promise.all([
        loadCached<Bootstrap>(cacheKey(memberId, "bootstrap"), "/v1/bootstrap", noCache),
        loadCached<Snapshot>(cacheKey(memberId, "snapshot"), "/v1/snapshot", noCache),
      ]);
      lastRefresh = Date.now();
      setState({ boot: boot.data, snap: snap.data, stale: boot.stale || snap.stale, loadFailed: false, version: state.version + (snap.stale ? 0 : 1) });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setState({ stale: true, loadFailed: !state.snap });
      if (!state.snap) toast(errorText(err));
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ── Phiên ─────────────────────────────────────────────────────────
const LAST_MEMBER = "vi-nha:last-member";
export const lastMemberId = (): string | null => {
  try {
    return localStorage.getItem(LAST_MEMBER);
  } catch {
    return null;
  }
};

function toLogin() {
  setState({ phase: "login", member: null, txOpen: null, editTx: null, entryPreset: null, book: null });
}

/** Người khác vào máy này: xoá mọi số liệu đã cache của người trước (kể cả cache API của service worker). */
async function forgetOtherMember(memberId: string) {
  // Không biết người trước là ai (localStorage bị chặn) cũng coi như người khác: xoá cho chắc.
  const previous = lastMemberId();
  if (previous !== memberId) {
    await cacheClear();
    if ("caches" in window) await caches.delete("vi-nha-api").catch(() => false);
  }
  try {
    localStorage.setItem(LAST_MEMBER, memberId);
  } catch {
    // không nhớ được người dùng lần trước — lần sau coi như người mới, cache bị xoá thêm một lần, không sao
  }
}

async function enter(member: Pick<MemberRef, "id" | "name">) {
  await forgetOtherMember(member.id);
  const [boot, snap] = await Promise.all([cacheGet<Bootstrap>(cacheKey(member.id, "bootstrap")), cacheGet<Snapshot>(cacheKey(member.id, "snapshot"))]);
  const sameMember = boot?.data.member?.id === member.id;
  setState({
    phase: "app",
    member,
    boot: sameMember ? boot!.data : null,
    snap: sameMember ? (snap?.data ?? null) : null,
    stale: sameMember,
    loadFailed: false,
    queue: await syncer.list(),
  });
  await refresh();
  void flushAndRefresh();
  void syncPush(member.id);
}

async function checkSession() {
  try {
    const { member } = await api.get<{ member: Pick<MemberRef, "id" | "name"> | null }>("/v1/session");
    if (member) return await enter(member);
  } catch {
    // Mất mạng lúc mở app: vẫn vào bằng người đã dùng lần trước để nhập offline được.
    const last = lastMemberId();
    const cached = last ? await cacheGet<Bootstrap>(cacheKey(last, "bootstrap")) : null;
    if (cached?.data.member) return await enter(cached.data.member);
  }
  // Chưa có phiên: nhà chưa thiết lập thì màn Thiết lập; không hỏi được thì màn đăng nhập như cũ.
  if (await setupNeeded()) setState({ phase: "setup" });
  else toLogin();
}

/** Thiết lập xong: server đã cấp cookie phiên của chủ hộ — vào thẳng Hôm nay. */
export async function completeSetup(body: SetupBody): Promise<void> {
  const { member } = await api.post<{ member: Pick<MemberRef, "id" | "name"> }>("/v1/setup", body);
  go("today");
  await enter(member);
}

export async function login(password: string, memberId: string): Promise<void> {
  const { member } = await api.post<{ member: Pick<MemberRef, "id" | "name"> }>("/v1/session", { password, member_id: memberId });
  await enter(member);
}

/** Đăng xuất máy này; `everywhere`: tăng thế hệ phiên ở server — mọi máy (cả máy này) phải đăng nhập lại (ADR-89). */
export async function logout(everywhere = false): Promise<void> {
  // Gỡ thông báo của máy này trước khi xoá phiên (server cần phiên để gỡ): người sau dùng máy không nhận tin của người trước.
  await unbindPush();
  if (everywhere) await api.post("/v1/session/revoke-all");
  else await api.del("/v1/session");
  await signedOut();
}

/** Phiên của máy này đã hết ở server (đăng xuất, tự tắt mình): xoá số đã lưu, về màn đăng nhập. */
export async function signedOut(): Promise<void> {
  await cacheClear();
  if ("caches" in window) await caches.delete("vi-nha-api").catch(() => false);
  lastEntryQueued = null;
  setState({ phase: "login", member: null, boot: null, snap: null, stale: false, lastEntry: null, txOpen: null, editTx: null, entryPreset: null, book: null });
}

// ── Khởi động ─────────────────────────────────────────────────────
export function start() {
  setUnauthorizedHandler(toLogin);
  addEventListener("hashchange", () => {
    const r = parseHash(location.hash);
    setState(r.walletsTab ? { tab: r.tab, walletsTab: r.walletsTab } : { tab: r.tab });
    scrollTo({ top: 0 });
  });
  addEventListener("online", () => {
    setState({ online: true });
    void flushAndRefresh().then(() => refresh());
  });
  addEventListener("offline", () => setState({ online: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || state.phase !== "app") return;
    // Gửi hàng đợi XONG rồi mới tải số: chạy song song thì số mới về (đã gồm khoản vừa gửi) có thể bị trừ
    // thêm lần nữa bởi bản hàng đợi cũ, "còn để chi" tụt ảo trong chốc lát.
    void flushAndRefresh().then(() => (Date.now() - lastRefresh > 30_000 ? refresh() : undefined));
  });
  void syncer.list().then((queue) => setState({ queue }));
  void checkSession();
}
