// Hàng đợi nhập offline (D12). Mọi khoản nhập ghi vào hàng đợi TRƯỚC, rồi mới gửi.
// Server chống trùng theo client_id, nên gửi lại bao nhiêu lần cũng chỉ ghi một lần.
// Module này không đụng IndexedDB hay fetch: kho và đường gửi được tiêm vào, để test chạy trong node.

import type { CreateEntryResult, EntryBody } from "../lib/types";

export interface QueuedEntry {
  clientId: string;
  /** Người nhập. Chỉ gửi khi đúng người này đang đăng nhập — by_member_id và ví cá nhân phụ thuộc vào nó. */
  memberId: string;
  body: EntryBody;
  createdAt: string;
  /** pending: chờ gửi · rejected: server từ chối có lý do, nằm lại chờ người sửa hoặc bỏ. */
  status: "pending" | "rejected";
  attempts: number;
  error?: { code: string; message: string };
}

export interface QueueStore {
  list(): Promise<QueuedEntry[]>;
  put(item: QueuedEntry): Promise<void>;
  remove(clientId: string): Promise<void>;
}

/** Kết quả thô của một lần gửi; `null` = không tới được server (mất mạng, hết giờ chờ). */
export type RawResponse = { status: number; payload: unknown } | null;
export type Transport = (body: EntryBody) => Promise<RawResponse>;

export type SendResult =
  | { kind: "ok"; data: CreateEntryResult }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "auth" }
  | { kind: "retry"; network: boolean; message: string };

/** Phân loại phản hồi. 4xx có mã lỗi = từ chối thật; mạng / 5xx / 408 / 429 = thử lại sau; 401 = cần đăng nhập lại. */
export function classify(res: RawResponse): SendResult {
  if (res === null) return { kind: "retry", network: true, message: "Không có mạng." };
  const { status, payload } = res;
  const body = (payload ?? {}) as { ok?: boolean; data?: unknown; error?: { code?: unknown; message?: unknown } };
  if (status >= 200 && status < 300 && body.ok === true) return { kind: "ok", data: body.data as CreateEntryResult };
  if (status === 401) return { kind: "auth" };
  if (status >= 500 || status === 408 || status === 425 || status === 429 || (status >= 200 && status < 300)) {
    const message = typeof body.error?.message === "string" ? body.error.message : `Máy chủ trả mã ${status}.`;
    return { kind: "retry", network: false, message };
  }
  const code = typeof body.error?.code === "string" ? body.error.code : `http_${status}`;
  const message = typeof body.error?.message === "string" ? body.error.message : `Máy chủ trả mã ${status}.`;
  return { kind: "rejected", code, message };
}

/** Trường ví do app bản cũ lưu trong hàng đợi (UC-704 AC-27): bỏ khi gửi, khoản chi / thu / hoàn / chuyển hai tài khoản vẫn đúng nghĩa. */
const LEGACY_FIELDS = ["wallet_id", "counter_wallet_id", "from_wallet_id", "wealth_move", "allocate"] as const;
export const WALLET_TRANSFER_GONE = "Chuyển giữa hai ví không còn ở bản mới — xoá khoản này";
export const MODEL_CHANGED_KEPT = "Bản mới đã bỏ ví — mở lại app để gửi lại";

/** Thân sẽ gửi của một khoản trong hàng đợi; khoản "chuyển giữa hai ví" (không tài khoản) không đổi được → lý do giữ lại. */
export function sendableBody(body: EntryBody): { body: EntryBody } | { blocked: string } {
  if (body.meaning === "transfer" && !body.account_id && !body.to_account_id) return { blocked: WALLET_TRANSFER_GONE };
  const clean: Record<string, unknown> = { ...body };
  for (const k of LEGACY_FIELDS) delete clean[k];
  return { body: clean as unknown as EntryBody };
}

export interface FlushReport {
  results: Record<string, SendResult>;
  /** Lý do dừng giữa chừng, nếu có. */
  stopped: "offline" | "auth" | "no_member" | null;
}

export interface SyncerDeps {
  store: QueueStore;
  transport: Transport;
  memberId: () => string | null;
  isOnline: () => boolean;
  onChange?: (items: QueuedEntry[]) => void;
  now?: () => Date;
}

export interface Syncer {
  enqueue(body: EntryBody, memberId: string): Promise<QueuedEntry>;
  flush(): Promise<FlushReport>;
  /** Gửi lại một khoản. `confirmDuplicate`: người nhập xác nhận khoản SePay đã báo là khoản thật thứ hai (409 `bank_log_exists`). */
  retry(clientId: string, opts?: { confirmDuplicate?: boolean }): Promise<FlushReport>;
  discard(clientId: string): Promise<void>;
  list(): Promise<QueuedEntry[]>;
}

const byCreated = (a: QueuedEntry, b: QueuedEntry) => a.createdAt.localeCompare(b.createdAt) || a.clientId.localeCompare(b.clientId);

export function createSyncer(deps: SyncerDeps): Syncer {
  const now = deps.now ?? (() => new Date());
  let running: Promise<FlushReport> | null = null;
  let again = false;

  const changed = async () => deps.onChange?.((await deps.store.list()).sort(byCreated));

  async function flushOnce(report: FlushReport): Promise<void> {
    const me = deps.memberId();
    if (!me) {
      report.stopped = "no_member";
      return;
    }
    if (!deps.isOnline()) {
      report.stopped = "offline";
      return;
    }
    const items = (await deps.store.list()).filter((i) => i.status === "pending" && i.memberId === me).sort(byCreated);
    for (const item of items) {
      // Server ghi "ai chi" theo phiên đăng nhập: đổi người giữa chừng thì dừng, không gửi khoản của người trước
      // dưới tên người sau. Các khoản còn lại chờ người đó đăng nhập lại.
      if (deps.memberId() !== me) {
        report.stopped = "no_member";
        return;
      }
      const sendable = sendableBody(item.body);
      if ("blocked" in sendable) {
        report.results[item.clientId] = { kind: "rejected", code: "model_changed", message: sendable.blocked };
        await deps.store.put({ ...item, status: "rejected", attempts: item.attempts + 1, error: { code: "model_changed", message: sendable.blocked } });
        continue;
      }
      const raw = classify(await deps.transport(sendable.body));
      // App cũ còn mở gửi trường ví lên (server 400 `model_changed`): giữ khoản lại, không mất.
      const result = raw.kind === "rejected" && raw.code === "model_changed" ? { ...raw, message: MODEL_CHANGED_KEPT } : raw;
      report.results[item.clientId] = result;
      if (result.kind === "ok") {
        await deps.store.remove(item.clientId);
      } else if (result.kind === "rejected") {
        await deps.store.put({ ...item, status: "rejected", attempts: item.attempts + 1, error: { code: result.code, message: result.message } });
      } else if (result.kind === "auth") {
        report.stopped = "auth";
        return;
      } else {
        await deps.store.put({ ...item, attempts: item.attempts + 1, error: { code: result.network ? "offline" : "server", message: result.message } });
        // Mất mạng thì dừng cả loạt; lỗi server của một khoản không được chặn các khoản sau.
        if (result.network) {
          report.stopped = "offline";
          return;
        }
      }
    }
  }

  function flush(): Promise<FlushReport> {
    if (running) {
      again = true;
      return running;
    }
    const report: FlushReport = { results: {}, stopped: null };
    running = (async () => {
      try {
        do {
          again = false;
          report.stopped = null;
          await flushOnce(report);
        } while (again && report.stopped === null);
        return report;
      } finally {
        running = null;
        await changed();
      }
    })();
    return running;
  }

  return {
    async enqueue(body, memberId) {
      const item: QueuedEntry = { clientId: body.client_id, memberId, body, createdAt: now().toISOString(), status: "pending", attempts: 0 };
      await deps.store.put(item);
      await changed();
      return item;
    },
    flush,
    async retry(clientId, opts = {}) {
      const item = (await deps.store.list()).find((i) => i.clientId === clientId);
      if (item) {
        const { error: _drop, ...rest } = item;
        const body = opts.confirmDuplicate ? { ...item.body, confirm_duplicate: true } : item.body;
        await deps.store.put({ ...rest, body, status: "pending" });
      }
      return flush();
    },
    async discard(clientId) {
      await deps.store.remove(clientId);
      await changed();
    },
    async list() {
      return (await deps.store.list()).sort(byCreated);
    },
  };
}

/** Kho trong bộ nhớ — dùng cho test và làm đường lùi khi trình duyệt không có kho nào khác. */
export function memoryStore(initial: QueuedEntry[] = []): QueueStore {
  const map = new Map(initial.map((i) => [i.clientId, i]));
  return {
    list: async () => [...map.values()],
    put: async (item) => void map.set(item.clientId, item),
    remove: async (id) => void map.delete(id),
  };
}
