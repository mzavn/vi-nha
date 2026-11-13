// Khung app: 4 tab cố định (không router), FAB "+" ở Hôm nay, Gán, Tài khoản (pwa UC-711 AC-3, AC-30…AC-34).
// Cài đặt (#settings), Sổ giao dịch (#ledger), Báo cáo (#net-worth) và "Chuyển sang ba ngăn" (#convert) là màn phụ.
// Hướng dẫn mở GitBook ở tab mới. Máy tính (≥1024px): thanh bên thay thanh dưới và FAB, phím N mở Ghi khoản.

import { useEffect, useRef } from "preact/hooks";
import { markInvited, shouldInvite } from "./lib/convert";
import { bottomNav, ENTRY_LABEL, hasFab, showsBottomNav } from "./lib/nav";
import { deviceStorage } from "./lib/pin";
import { toastDuration } from "./lib/toast";
import { Assign } from "./screens/assign";
import { Convert } from "./screens/convert";
import { Entry } from "./screens/entry";
import { LedgerBook } from "./screens/ledger-book";
import { Login } from "./screens/login";
import { Lock } from "./screens/lock";
import { NetWorth } from "./screens/net-worth";
import { Settings } from "./screens/settings";
import { Setup } from "./screens/setup";
import { Today } from "./screens/today";
import { TodayDesk } from "./screens/today-desktop";
import { TxSheet } from "./screens/tx-sheet";
import { Wallets } from "./screens/wallets";
import { getState, go, setState, useApp } from "./state/store";
import { applyUpdate } from "./state/sw-update";
import { Icon } from "./ui/icons";
import { Sidebar, useQuickEntryKey, useWide } from "./ui/shell";

export function App() {
  const app = useApp();
  const first = useRef(true);
  const wide = useWide();

  // Đổi tab: đưa focus về tiêu đề trang cho trình đọc màn hình (không cuộn, không vẽ viền khi chạm).
  // Màn Ghi khoản tự đưa focus vào ô số tiền — nhãn của ô đã nói đây là màn nào.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (app.tab === "entry") return;
    document.getElementById("page-title")?.focus({ preventScroll: true });
  }, [app.tab]);

  // Mời chuyển sang ba ngăn một lần trên máy này (UC-1208 AC-7): đã vào app, snapshot còn bước chuyển đổi, máy chưa được mời.
  const conversion = app.phase === "app" && !app.locked ? app.snap?.conversion : null;
  useEffect(() => {
    const storage = deviceStorage();
    if (!shouldInvite(storage, conversion)) return;
    markInvited(storage);
    if (getState().tab !== "convert") go("convert");
  }, [conversion]);

  if (app.phase === "boot") {
    return (
      <main class="app" aria-busy="true">
        <div style={{ padding: "calc(40px + var(--safe-top)) 4px" }}>
          <div class="skeleton" style={{ width: "40%", height: "22px" }} />
        </div>
      </main>
    );
  }
  if (app.phase === "setup")
    return (
      <>
        <UpdateBar />
        <Setup />
      </>
    );
  if (app.phase === "login")
    return (
      <>
        <UpdateBar />
        <Login />
      </>
    );
  // Màn khóa mã PIN thay cả cây (pwa UC-719): sheet là <dialog> top layer, lớp phủ không che được. Chỉ phase "app" mới khóa.
  if (app.locked) return <Lock />;
  if (wide) return <DesktopApp />;

  const unposted = app.queue.filter((q) => q.memberId === app.member?.id).length;
  const pendingLogs = app.snap?.attention.pendingLogs ?? 0;

  const mainCls = [
    "app",
    app.tab === "settings" ? "app-wide" : "",
    hasFab(app.tab) ? "has-fab" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <UpdateBar />
      <main class={mainCls} id="main">
        {app.tab === "today" && <Today />}
        {app.tab === "entry" && <Entry />}
        {app.tab === "assign" && <Assign />}
        {app.tab === "wallets" && <Wallets />}
        {app.tab === "settings" && <Settings />}
        {app.tab === "ledger" && <LedgerBook />}
        {app.tab === "net-worth" && <NetWorth />}
        {app.tab === "convert" && <Convert />}
      </main>

      {hasFab(app.tab) && (
        <button
          type="button"
          class="fab"
          aria-label={unposted > 0 ? `${ENTRY_LABEL}, ${unposted} chưa lên sổ` : ENTRY_LABEL}
          onClick={() => go("entry")}
        >
          <Icon name="plus" size={24} />
          {unposted > 0 && (
            <span class="badge" aria-label={`${unposted} chưa lên sổ`}>
              {unposted}
            </span>
          )}
        </button>
      )}

      {showsBottomNav(app.tab) && (
        <nav class="nav" aria-label="Màn chính">
          <div class="nav-inner">
            {bottomNav(app.compact).map((n) => (
              <button
                type="button"
                key={n.tab}
                aria-current={app.tab === n.tab ? "page" : undefined}
                onClick={() => go(n.tab)}
              >
                <Icon name={n.icon} size={20} />
                <span>{n.label}</span>
                {n.tab === "assign" && pendingLogs > 0 && (
                  <span class="badge" aria-label={`${pendingLogs} chưa gán`}>
                    {pendingLogs}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      )}

      <TxSheet />
      <Toast />
    </>
  );
}

function DesktopApp() {
  const app = useApp();
  useQuickEntryKey();
  return (
    <div class="dk-shell">
      <UpdateBar />
      <Sidebar />
      <main class={app.tab === "settings" ? "app dk-main app-wide" : "app dk-main"} id="main">
        {app.tab === "today" && <TodayDesk />}
        {app.tab === "entry" && <Entry />}
        {app.tab === "assign" && <Assign />}
        {app.tab === "wallets" && <Wallets />}
        {app.tab === "settings" && <Settings />}
        {app.tab === "ledger" && <LedgerBook />}
        {app.tab === "net-worth" && <NetWorth />}
        {app.tab === "convert" && <Convert />}
      </main>
      <TxSheet />
      <Toast />
    </div>
  );
}

/** Thanh "Đã có bản mới" (pwa UC-710): sw.js mới đã giành quyền; bấm là tải lại vào bản mới, khỏi tắt app mở lại. */
function UpdateBar() {
  const { updateReady } = useApp();
  if (!updateReady) return null;
  return (
    <div class="update-bar" role="status">
      <span>Ví nhà có bản mới.</span>
      <button type="button" class="btn" onClick={applyUpdate}>
        Tải bản mới
      </button>
    </div>
  );
}

/**
 * Viên thuốc nền --fg, chữ --bg ở đáy màn (DESIGN.md §4.14, pwa UC-711 AC-34).
 * Có chỗ cho nút hành động (vd Hoàn tác) cao ≥ 44px, bấm là chạy run() và tắt toast.
 */
function Toast() {
  const { toast } = useApp();
  useEffect(() => {
    if (!toast) return;
    const dur = toastDuration(toast.text, !!toast.action);
    const t = setTimeout(() => setState({ toast: null }), dur);
    return () => clearTimeout(t);
  }, [toast?.id]);
  return (
    <div aria-live="polite" role="status">
      {toast && (
        <div class="toast" key={toast.id}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              type="button"
              class="toast-act"
              onClick={() => {
                toast.action?.run();
                setState({ toast: null });
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
