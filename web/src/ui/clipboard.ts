// Chép chữ vào bộ nhớ tạm rồi báo bằng toast. Dùng cho lệnh chuyển tiền và bảng kê người thuê.

import { toast } from "../state/store";

export async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`Đã chép ${label}.`);
  } catch {
    // Safari cũ / không có quyền: chép bằng ô ẩn.
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    toast(ok ? `Đã chép ${label}.` : `Chưa chép được. ${label}: ${text}`);
  }
}
