// Khung app: 4 tab cố định (không router), FAB "+" ở mọi màn trừ Nhập, Cài đặt, Sổ giao dịch, Tài sản & tự do và màn chuyển đổi, toast đáy màn.
// Cài đặt (#settings), Sổ giao dịch (#ledger), Tài sản & tự do (#net-worth) và "Chuyển sang ba ngăn" (#convert, pwa UC-711 AC-28) là màn
// phụ mở từ màn khác, không chiếm tab thứ năm. Màn chuyển đổi tự mở một lần trên mỗi máy khi snapshot còn `conversion` (pocket UC-1208).
// Hướng dẫn không phải màn trong app: mục thanh bên và nút ở Cài đặt › Máy này mở GitBook ở tab mới (UC-711 AC-26).
// Máy tính (≥1024px): thanh bên thay thanh dưới và FAB, phím N mở màn Nhập, Hôm nay thành bảng điều khiển.

import { useEffect, useRef } from "preact/hooks";
import { markInvited, shouldInvite } from "./lib/convert";
import { deviceStorage } from "./lib/pin";
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
import { getState, go, setState, useApp, type Tab } from "./state/store";
import { applyUpdate } from "./state/sw-update";
import { Icon } from "./ui/icons";
import { Sidebar, useQuickEntryKey, useWide } from "./ui/shell";

const NAV: { tab: Tab; label: string; icon: string }[] = [
  { tab: "today", label: "Hôm nay", icon: "home" },
  { tab: "entry", label: "Nhập", icon: "plus-circle" },
  { tab: "assign", label: "Gán", icon: "inbox" },
  { tab: "wallets", label: "Ví & quỹ", icon: "wallet" },
];
/** Màn không có FAB "+" trên điện thoại (Cài đặt riêng: thêm `app-wide`). Màn chuyển đổi ẩn cả thanh dưới. */
const SUB_SCREENS: Tab[] = ["entry", "ledger", "net-worth", "convert"];

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

  const badges: Partial<Record<Tab, number>> = {
    assign: app.snap?.attention.pendingLogs ?? 0,
    entry: app.queue.filter((q) => q.memberId === app.member?.id).length,
  };

  return (
    <>
      <UpdateBar />
      <main class={app.tab === "settings" ? "app app-wide" : SUB_SCREENS.includes(app.tab) ? "app" : "app has-fab"} id="main">
        {app.tab === "today" && <Today />}
        {app.tab === "entry" && <Entry />}
        {app.tab === "assign" && <Assign />}
        {app.tab === "wallets" && <Wallets />}
        {app.tab === "settings" && <Settings />}
        {app.tab === "ledger" && <LedgerBook />}
        {app.tab === "net-worth" && <NetWorth />}
        {app.tab === "convert" && <Convert />}
      </main>

      {app.tab !== "settings" && !SUB_SCREENS.includes(app.tab) && (
        <button type="button" class="fab" aria-label="Nhập khoản chi" onClick={() => go("entry")}>
          <Icon name="plus" size={26} />
        </button>
      )}

      {app.tab !== "convert" && (
        <nav class="nav" aria-label="Màn chính">
          <div class="nav-inner">
            {NAV.map((n) => (
              <button
                type="button"
                key={n.tab}
                aria-current={app.tab === n.tab ? "page" : undefined}
                onClick={() => go(n.tab)}
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
