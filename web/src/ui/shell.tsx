// Khung máy tính (≥1024px): thanh bên thay thanh dưới và nút "+", phím N mở Ghi khoản (pwa UC-711 AC-31).
// Dưới 1024px không component nào ở đây được vẽ — giao diện điện thoại giữ nguyên.

import { useEffect, useState } from "preact/hooks";
import { errorText } from "../lib/api";
import { ENTRY_LABEL, sidebarNav } from "../lib/nav";
import { shortDate, timeHM } from "../lib/period";
import { GUIDE_URL, SOURCE_URL } from "../lib/splits";
import { PinSheet, usePinSet } from "../screens/pin-sheet";
import { go, logout, syncNow, toast, useApp, type Tab } from "../state/store";
import { Icon } from "./icons";
import { HideAmountsButton } from "./parts";

/** Một mốc duy nhất cho cả app: CSS dùng cùng giá trị trong @media (min-width: 1024px). */
export const WIDE = "(min-width: 1024px)";

export function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof matchMedia !== "undefined" && matchMedia(WIDE).matches);
  useEffect(() => {
    const m = matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

type Theme = "auto" | "light" | "dark";

/** Nút giao diện ở chân thanh bên: bấm đổi vòng Theo máy → Sáng → Tối. */
const THEME_NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const THEME_LABEL: Record<Theme, string> = { auto: "Theo máy", light: "Sáng", dark: "Tối" };
const THEME_ICON: Record<Theme, "monitor" | "sun" | "moon"> = { auto: "monitor", light: "sun", dark: "moon" };

/** Sáng / tối theo máy, người dùng chọn đè được (DESIGN.md §7). Dùng chung cho chân màn Hôm nay và thanh bên. */
export function useTheme(): [Theme, (v: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("vi-nha:theme") as "light" | "dark" | null) ?? "auto";
    } catch {
      return "auto";
    }
  });
  function change(v: Theme) {
    setTheme(v);
    if (v === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", v);
    try {
      if (v === "auto") localStorage.removeItem("vi-nha:theme");
      else localStorage.setItem("vi-nha:theme", v);
    } catch {
      // không lưu được lựa chọn — vẫn áp dụng cho lần mở này
    }
  }
  return [theme, change];
}

/** Đăng xuất: còn khoản chưa lên sổ thì bấm lần đầu chỉ hỏi lại. `everywhere` (mọi máy) luôn hỏi lại lần đầu. */
export function useLogout(everywhere = false) {
  const { member, queue } = useApp();
  const [confirmOut, setConfirmOut] = useState(false);
  const unsynced = queue.filter((q) => q.memberId === member?.id).length;
  const onLogout = () => {
    if ((everywhere || unsynced > 0) && !confirmOut) return setConfirmOut(true);
    void logout(everywhere).catch((err) => toast(errorText(err) === "Không có mạng." ? "Đăng xuất cần mạng." : errorText(err)));
  };
  return { confirmOut, unsynced, onLogout };
}

/** Lời hỏi lại trước khi đăng xuất mọi máy (Cài đặt › Máy này trên điện thoại, thanh bên trên máy tính). */
export function signOutEverywhereNote(name: string | undefined, unsynced: number): string {
  const base = "Mọi máy đang đăng nhập, cả máy này, sẽ phải nhập lại mật khẩu. Dùng khi mất điện thoại hoặc nghi lộ mật khẩu.";
  return unsynced > 0 ? `${base} Còn ${unsynced} khoản của ${name} chưa lên sổ, nằm lại trên máy này đến khi ${name} đăng nhập lại.` : base;
}

/** Phím N ở bất cứ đâu (trừ khi đang gõ hoặc đang mở sheet) → màn Ghi khoản, con trỏ trong ô số tiền. */
export function useQuickEntryKey() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      if (location.hash === "#entry") document.getElementById("f-amount")?.focus();
      else go("entry");
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
}

export function Sidebar() {
  const app = useApp();
  const [theme, setTheme] = useTheme();
  const { confirmOut, unsynced, onLogout } = useLogout();
  const all = useLogout(true);
  const hasPin = usePinSet();
  const [pinMode, setPinMode] = useState<"set" | "change" | "off" | null>(null);
  const mine = app.queue.filter((q) => q.memberId === app.member?.id);
  const pending = mine.filter((q) => q.status === "pending").length;
  const rejected = mine.filter((q) => q.status === "rejected").length;
  const pendingLogs = app.snap?.attention.pendingLogs ?? 0;
  const snapAt = app.snap?.at;

  const items = sidebarNav(app.compact);
  const mainItems = items.filter((n) => n.tab !== "settings");
  const settingsItem = items.find((n) => n.tab === "settings");

  const renderItem = (tab: Tab, label: string) => {
    const isAssign = tab === "assign";
    return (
      <button
        type="button"
        key={tab}
        class="side-item"
        aria-current={app.tab === tab ? "page" : undefined}
        onClick={() => go(tab)}
      >
        <span class="side-label">{label}</span>
        {isAssign && pendingLogs > 0 && (
          <span class="side-badge" aria-label={`${pendingLogs} chưa gán`}>
            {pendingLogs}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside class="side" aria-label="Điều hướng">
      <div class="side-brand">Ví nhà</div>

      <button type="button" class="btn side-new" onClick={() => go("entry")} aria-keyshortcuts="N">
        <span>{ENTRY_LABEL}</span>
        {mine.length > 0 && (
          <span class="side-badge" aria-label={`${mine.length} chưa lên sổ`}>
            {mine.length}
          </span>
        )}
        <kbd>N</kbd>
      </button>

      <nav class="side-nav" aria-label="Màn chính">
        {mainItems.map((n) => renderItem(n.tab, n.label))}
        <div class="side-sep" />
        {settingsItem && renderItem(settingsItem.tab, settingsItem.label)}
        {/* Hướng dẫn mở GitBook ở tab mới, không phải màn trong app (UC-711 AC-26). */}
        <a class="side-item" href={GUIDE_URL} target="_blank" rel="noopener">
          <span class="side-label">Hướng dẫn</span>
        </a>
      </nav>

      <div class="side-foot">
        <div class="side-status" role="status">
          <span class="side-line">
            {app.online ? <i class="side-dot" aria-hidden="true" /> : <Icon name="cloud-off" size={16} />}
            {/* Một hàng: chấm xanh = có mạng (chữ đầy đủ ở title), giờ của số, rồi Đồng bộ · Che số · Giao diện. */}
            <span class="side-line-t" title={app.online ? "Có mạng" : "Chưa có mạng"}>
              {app.online ? "" : "Mất mạng · "}
              {snapAt ? (
                <>
                  {app.stale ? "số cũ " : "số lúc "}
                  {timeHM(snapAt)}
                  {shortDate(snapAt) !== shortDate(new Date().toISOString()) ? ` ${shortDate(snapAt)}` : ""}
                </>
              ) : app.online ? (
                "Có mạng"
              ) : (
                ""
              )}
            </span>
            <button
              type="button"
              class="side-ic"
              aria-label="Đồng bộ"
              title={app.syncing ? "Đang đồng bộ…" : "Đồng bộ"}
              onClick={() => void syncNow()}
              disabled={app.syncing}
            >
              <Icon name="sync" size={16} />
            </button>
            <HideAmountsButton class="side-ic" />
            <button
              type="button"
              class="side-ic"
              aria-label={`Giao diện: ${THEME_LABEL[theme]}`}
              title={`Giao diện: ${THEME_LABEL[theme]}`}
              onClick={() => setTheme(THEME_NEXT[theme])}
            >
              <Icon name={THEME_ICON[theme]} size={16} />
            </button>
          </span>
          {pending > 0 && <span class="chip warn">{app.online ? `${pending} khoản đang chờ gửi` : `Chưa có mạng · ${pending} khoản sẽ tự gửi khi có mạng`}</span>}
          {rejected > 0 && <span class="chip bad">{rejected} bị máy chủ từ chối</span>}
        </div>

        <div class="side-member">
          <span class="side-member-nm">
            <span class="side-k">Đang dùng</span> <strong>{app.member?.name}</strong>
          </span>
          <details class="side-menu">
            <summary class="side-ic" aria-label="Tuỳ chọn tài khoản" title="Tuỳ chọn tài khoản">
              <Icon name="more" size={16} />
            </summary>
            <div class="side-menu-list">
              {hasPin ? (
                <>
                  <button type="button" class="side-menu-item" onClick={() => setPinMode("change")}>
                    Đổi mã PIN
                  </button>
                  <button type="button" class="side-menu-item" onClick={() => setPinMode("off")}>
                    Tắt PIN
                  </button>
                </>
              ) : (
                <button type="button" class="side-menu-item" onClick={() => setPinMode("set")}>
                  Đặt mã PIN
                </button>
              )}
              <button type="button" class="side-menu-item" onClick={onLogout}>
                {confirmOut ? "Vẫn đăng xuất" : "Đăng xuất"}
              </button>
              {confirmOut && (
                <p class="side-warn" role="alert">
                  Còn {unsynced} khoản của {app.member?.name} chưa lên sổ. Chúng nằm lại trên máy này và chỉ gửi khi {app.member?.name} đăng nhập lại.
                </p>
              )}
              <button type="button" class="side-menu-item" onClick={all.onLogout}>
                {all.confirmOut ? "Vẫn đăng xuất mọi máy" : "Đăng xuất mọi máy"}
              </button>
              {all.confirmOut && (
                <p class="side-warn" role="alert">
                  {signOutEverywhereNote(app.member?.name, all.unsynced)}
                </p>
              )}
            </div>
          </details>
        </div>
        {pinMode && <PinSheet mode={pinMode} limits onClose={() => setPinMode(null)} />}

        <p class="side-k side-about">
          {__APP_VERSION__ ? `Ví nhà ${__APP_VERSION__}` : "Ví nhà"} ·{" "}
          <a class="link" href={SOURCE_URL} target="_blank" rel="noopener">
            Mã nguồn
          </a>
        </p>
      </div>
    </aside>
  );
}
