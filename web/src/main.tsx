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

render(<App />, document.getElementById("app")!);
start();

if (import.meta.env.PROD) registerServiceWorker();
