// IndexedDB tối giản: một kho cho hàng đợi nhập, một kho cho dữ liệu đọc gần nhất (bootstrap, snapshot).
// Trình duyệt chặn IndexedDB (một số chế độ riêng tư) thì lùi về localStorage — hàng đợi không được mất.

import type { QueuedEntry, QueueStore } from "./queue";

const DB_NAME = "vi-nha";
const QUEUE = "queue";
const CACHE = "cache";
// Phiên bản dữ liệu lưu trên máy: tăng khi dạng dữ liệu API đổi (2: tên tiếng Anh — tiers.wealth_building, safetyFund…).
// Khác phiên bản thì bản lưu cũ (bootstrap, snapshot, settings) bị bỏ; hàng đợi nhập giữ nguyên (pwa UC-710 AC-11).
const DATA_VERSION = 2;
const LS_CACHE = "vi-nha:cache:";
const LS_CACHE_VERSION = "vi-nha:cache-version";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, DATA_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "clientId" });
      // Lên phiên bản mới: kho cache cũ mang dạng dữ liệu bản trước — xoá, tạo lại rỗng. Kho hàng đợi không đụng tới.
      if (db.objectStoreNames.contains(CACHE)) db.deleteObjectStore(CACHE);
      db.createObjectStore(CACHE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("indexedDB blocked"));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

// ── Đường lùi localStorage ─────────────────────────────────────────
const LS_QUEUE = "vi-nha:queue";
const lsRead = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
/** Trả false khi không ghi được (hết chỗ hoặc bị chặn) — nơi gọi quyết định có được bỏ qua hay không. */
const lsWrite = (key: string, value: unknown): boolean => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export class StorageUnavailableError extends Error {
  constructor() {
    super("Không lưu được vào máy: bộ nhớ trình duyệt đang bị chặn hoặc đã đầy. Khoản này chưa được ghi.");
  }
}

const lsQueue: QueueStore = {
  list: async () => Object.values(lsRead<Record<string, QueuedEntry>>(LS_QUEUE, {})),
  put: async (item) => {
    // Hàng đợi là nơi duy nhất giữ khoản nhập khi mất mạng: không ghi được thì phải báo, không được nuốt lỗi.
    if (!lsWrite(LS_QUEUE, { ...lsRead<Record<string, QueuedEntry>>(LS_QUEUE, {}), [item.clientId]: item })) throw new StorageUnavailableError();
  },
  remove: async (id) => {
    const all = lsRead<Record<string, QueuedEntry>>(LS_QUEUE, {});
    delete all[id];
    lsWrite(LS_QUEUE, all);
  },
};

/** Thử IndexedDB, lỗi thì dùng localStorage. Gộp cả hai khi đọc để không bỏ sót khoản ghi lúc đang lùi. */
export const queueStore: QueueStore = {
  async list() {
    const fromLs = await lsQueue.list();
    try {
      const fromDb = await run<QueuedEntry[]>(QUEUE, "readonly", (s) => s.getAll());
      const ids = new Set(fromDb.map((i) => i.clientId));
      return [...fromDb, ...fromLs.filter((i) => !ids.has(i.clientId))];
    } catch {
      return fromLs;
    }
  },
  async put(item) {
    try {
      await run(QUEUE, "readwrite", (s) => s.put(item));
      if (localStorage.getItem(LS_QUEUE)) await lsQueue.remove(item.clientId);
    } catch {
      await lsQueue.put(item);
    }
  },
  async remove(id) {
    await lsQueue.remove(id);
    try {
      await run(QUEUE, "readwrite", (s) => s.delete(id));
    } catch {
      // đã xoá ở localStorage
    }
  },
};

export interface Cached<T> {
  key: string;
  data: T;
  /** ISO — lúc server trả số này. */
  at: string;
}

/** Xoá bản lưu ở đường lùi localStorage (`vi-nha:cache:*`), không đụng hàng đợi. */
function lsCacheClear(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_CACHE)) localStorage.removeItem(k);
    }
  } catch {
    // localStorage bị chặn
  }
}

let lsCacheChecked = false;
/** Bản lưu localStorage của phiên bản dữ liệu khác: bỏ hết một lần, rồi ghi dấu phiên bản mới (cùng luật với kho cache IndexedDB). */
function lsCacheUpgrade(): void {
  if (lsCacheChecked) return;
  lsCacheChecked = true;
  try {
    if (localStorage.getItem(LS_CACHE_VERSION) === String(DATA_VERSION)) return;
    lsCacheClear();
    localStorage.setItem(LS_CACHE_VERSION, String(DATA_VERSION));
  } catch {
    // localStorage bị chặn: không có bản lưu nào để bỏ
  }
}

export async function cacheGet<T>(key: string): Promise<Cached<T> | null> {
  lsCacheUpgrade();
  try {
    return ((await run<Cached<T> | undefined>(CACHE, "readonly", (s) => s.get(key))) ?? null) as Cached<T> | null;
  } catch {
    return lsRead<Cached<T> | null>(`${LS_CACHE}${key}`, null);
  }
}

export async function cacheSet<T>(key: string, data: T, at: string): Promise<void> {
  lsCacheUpgrade();
  const value: Cached<T> = { key, data, at };
  try {
    await run(CACHE, "readwrite", (s) => s.put(value));
  } catch {
    lsWrite(`${LS_CACHE}${key}`, value);
  }
}

export async function cacheClear(): Promise<void> {
  try {
    await run(CACHE, "readwrite", (s) => s.clear());
  } catch {
    // không có IndexedDB
  }
  lsCacheClear();
}
