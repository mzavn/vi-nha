import { render } from "preact";
import { App } from "./app";
import { start } from "./state/store";
import { registerServiceWorker } from "./state/sw-update";
import "./styles.css";

// Giao diện sáng / tối người dùng chọn đè lên theo máy (DESIGN.md §7).
try {
  const theme = localStorage.getItem("vi-nha:theme");
  if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
} catch {
  // localStorage bị chặn: theo máy
}

// App không co giãn (KZ-UX-003): Safari iPhone bỏ qua `user-scalable=no`, nên chặn chụm hai ngón bằng sự kiện gesture của WebKit.
for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

const root = document.getElementById("app")!;

/** Không bao giờ để màn trắng (KZ-UX-004): lỗi khi dựng app thì nói cái gì hỏng và cho tải lại. */
function showLoadFailed() {
  if (root.childElementCount > 0) return;
  root.innerHTML =
    '<div class="load-failed" role="alert"><p><b>Ví nhà chưa mở được trên máy này.</b></p><p>Tải lại trang; vẫn lỗi thì cập nhật trình duyệt.</p><button type="button" class="btn">Tải lại</button></div>';
  root.querySelector("button")?.addEventListener("click", () => location.reload());
}

try {
  render(<App />, root);
  start();
} catch (err) {
  console.error(err);
  showLoadFailed();
}

if (import.meta.env.PROD) registerServiceWorker();
