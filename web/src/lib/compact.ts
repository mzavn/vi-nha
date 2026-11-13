// Chế độ gọn "chỉ ghi chi" của máy này (pwa UC-711 AC-36, UC-709 AC-56): cờ lưu ở localStorage, không gửi server.
// Chỉ đổi điều hướng và Hôm nay; không phải phân quyền (mở thẳng địa chỉ vẫn vào được).

export const COMPACT_KEY = "vi-nha:compact";

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage bị chặn (null hoặc ném lỗi) → tắt. */
export function loadCompact(storage: FlagStorage | null): boolean {
  try {
    return storage?.getItem(COMPACT_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveCompact(storage: FlagStorage | null, on: boolean): void {
  try {
    if (on) storage?.setItem(COMPACT_KEY, "1");
    else storage?.removeItem(COMPACT_KEY);
  } catch {
    // không lưu được — vẫn áp cho lần mở này
  }
}
