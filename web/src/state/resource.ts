// Đọc một đường dẫn GET /v1 cho riêng một màn: có trạng thái tải, lỗi, và cờ "số cũ" khi service worker trả từ cache.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ApiError, request } from "../lib/api";
import { useApp } from "./store";

export interface Resource<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** ISO lúc service worker lưu bản này, khi đang hiện bản cũ. */
  cachedAt: string | null;
  /** Đọc lại, bỏ qua bản lưu còn tươi của service worker (bấm "Tải lại", hoặc sau khi ghi). */
  reload: () => void;
}

export function useResource<T>(path: string | null): Resource<T> {
  const { version } = useApp();
  const [tick, setTick] = useState(0);
  const noCache = useRef(false);
  const [st, setSt] = useState<Omit<Resource<T>, "reload">>({ data: null, error: null, loading: path !== null, cachedAt: null });

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    const fresh = noCache.current;
    noCache.current = false;
    request<T>(path, "GET", undefined, fresh)
      .then(({ data, cachedAt }) => alive && setSt({ data, error: null, loading: false, cachedAt }))
      .catch((err: unknown) => {
        const e = err instanceof ApiError ? err : new ApiError(0, "offline", "Không có mạng.");
        if (alive) setSt((s) => ({ ...s, error: e, loading: false }));
      });
    return () => {
      alive = false;
    };
  }, [path, tick, version]);

  const reload = useCallback(() => {
    noCache.current = true;
    setTick((t) => t + 1);
  }, []);
  return { ...st, reload };
}
