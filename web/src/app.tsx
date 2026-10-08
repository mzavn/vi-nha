// Khung app: 4 tab cố định (không router), FAB "+" ở mọi màn trừ Nhập, Cài đặt, Sổ giao dịch và Hướng dẫn, toast đáy màn.
// Cài đặt (#settings), Sổ giao dịch (#ledger) và Hướng dẫn (#guide) là màn phụ mở từ màn khác, không chiếm tab thứ năm.
// Máy tính (≥1024px): thanh bên thay thanh dưới và FAB, phím N mở màn Nhập, Hôm nay thành bảng điều khiển.

import { useEffect, useRef } from "preact/hooks";
import { Assign } from "./screens/assign";
import { Entry } from "./screens/entry";
import { Guide } from "./screens/guide";
import { LedgerBook } from "./screens/ledger-book";
import { Login } from "./screens/login";
import { Settings } from "./screens/settings";
import { Setup } from "./screens/setup";
import { Today } from "./screens/today";
import { TodayDesk } from "./screens/today-desktop";
import { TxSheet } from "./screens/tx-sheet";
import { Wallets } from "./screens/wallets";
import { go, setState, useApp, type Tab } from "./state/store";
import { applyUpdate } from "./state/sw-update";
import { Icon } from "./ui/icons";
import { Sidebar, useQuickEntryKey, useWide } from "./ui/shell";

const NAV: { tab: Tab; label: string; icon: string }[] = [
  { tab: "today", label: "Hôm nay", icon: "home" },
  { tab: "entry", label: "Nhập", icon: "plus-circle" },
  { tab: "assign", label: "Gán", icon: "inbox" },
  { tab: "wallets", label: "Ví & quỹ", icon: "wallet" },
];

export function App() {
  const app = useApp();
  const first = useRef(true);
  const wide = useWide();

  // Đổi tab: đưa focus về tiêu đề trang cho trình đọc màn hình (không cuộn, không vẽ viền khi chạm).
  // Màn Nhập tự đưa focus vào ô số tiền — nhãn của ô đã nói đây là màn nào.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (app.tab === "entry") return;
    document.getElementById("page-title")?.focus({ preventScroll: true });
  }, [app.tab]);

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
  if (wide) return <DesktopApp />;

  const badges: Partial<Record<Tab, number>> = {
    assign: app.snap?.attention.pendingLogs ?? 0,
    entry: app.queue.filter((q) => q.memberId === app.member?.id).length,
  };

  return (
    <>
      <UpdateBar />
      <main class={app.tab === "settings" ? "app app-wide" : app.tab === "guide" ? "app app-guide" : app.tab === "entry" || app.tab === "ledger" ? "app" : "app has-fab"} id="main">
        {app.tab === "today" && <Today />}
        {app.tab === "entry" && <Entry />}
        {app.tab === "assign" && <Assign />}
        {app.tab === "wallets" && <Wallets />}
        {app.tab === "settings" && <Settings />}
        {app.tab === "ledger" && <LedgerBook />}
        {app.tab === "guide" && <Guide />}
      </main>

      {app.tab !== "entry" && app.tab !== "settings" && app.tab !== "ledger" && app.tab !== "guide" && (
        <button type="button" class="fab" aria-label="Nhập khoản chi" onClick={() => go("entry")}>
          <Icon name="plus" size={26} />
        </button>
      )}

      <nav class="nav" aria-label="Màn chính">
        <div class="nav-inner">
          {NAV.map((n) => (
            <button
              type="button"
              key={n.tab}
              aria-current={app.tab === n.tab ? "page" : undefined}
              onClick={() => (n.tab === "wallets" && app.tab !== "wallets" ? go("wallets", { tierFilter: null }) : go(n.tab))}
            >
              <Icon name={n.icon} size={22} />
              {n.label}
              {!!badges[n.tab] && (
                <span class="badge" aria-label={n.tab === "assign" ? `${badges[n.tab]} chưa gán` : `${badges[n.tab]} chưa lên sổ`}>
                  {badges[n.tab]}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

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
      <main class={app.tab === "settings" ? "app dk-main app-wide" : app.tab === "guide" ? "app dk-main app-guide" : "app dk-main"} id="main">
        {app.tab === "today" && <TodayDesk />}
        {app.tab === "entry" && <Entry />}
        {app.tab === "assign" && <Assign />}
        {app.tab === "wallets" && <Wallets />}
        {app.tab === "settings" && <Settings />}
        {app.tab === "ledger" && <LedgerBook />}
        {app.tab === "guide" && <Guide />}
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
      <span>Đã có bản mới của Ví nhà.</span>
      <button type="button" class="btn" onClick={applyUpdate}>
        Tải bản mới
      </button>
    </div>
  );
}

/**
 * Viên thuốc đen ở đáy (DESIGN.md §4). Câu ngắn tắt sau 2,2s; câu dài (phản hồi ngân sách, lỗi) ở lâu hơn — ~60ms mỗi ký tự,
 * tối đa 8s — để kịp đọc. Không lấy focus; trình đọc màn hình nghe qua aria-live.
 */
function Toast() {
  const { toast } = useApp();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setState({ toast: null }), Math.min(8000, Math.max(2200, toast.text.length * 60)));
    return () => clearTimeout(t);
  }, [toast?.id]);
  return (
    <div aria-live="polite" role="status">
      {toast && (
        <div class="toast" key={toast.id}>
          {toast.text}
        </div>
      )}
    </div>
  );
}
