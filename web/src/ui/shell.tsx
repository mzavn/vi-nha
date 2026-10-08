// Khung máy tính (≥1024px): thanh bên thay thanh dưới và nút "+", phím N mở màn Nhập.
// Dưới 1024px không component nào ở đây được vẽ — giao diện điện thoại giữ nguyên.

import { useEffect, useState } from "preact/hooks";
import { errorText } from "../lib/api";
import { shortDate, timeHM } from "../lib/period";
import { go, logout, syncNow, toast, useApp, type Tab } from "../state/store";
import { Icon } from "./icons";
import { Seg } from "./parts";

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

/** Phím N ở bất cứ đâu (trừ khi đang gõ hoặc đang mở sheet) → màn Nhập, con trỏ trong ô số tiền. */
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

const NAV: { tab: Tab; label: string; icon: string }[] = [
  { tab: "today", label: "Hôm nay", icon: "home" },
  { tab: "entry", label: "Nhập", icon: "plus-circle" },
  { tab: "assign", label: "Gán", icon: "inbox" },
  { tab: "wallets", label: "Ví & quỹ", icon: "wallet" },
];

export function Sidebar() {
  const app = useApp();
  const [theme, setTheme] = useTheme();
  const { confirmOut, unsynced, onLogout } = useLogout();
  const all = useLogout(true);
  const mine = app.queue.filter((q) => q.memberId === app.member?.id);
  const pending = mine.filter((q) => q.status === "pending").length;
  const rejected = mine.filter((q) => q.status === "rejected").length;
  const a = app.snap?.attention;
  const badges: Partial<Record<Tab, { n: number; label: string }>> = {
    entry: { n: mine.length, label: "chưa lên sổ" },
    assign: { n: a?.pendingLogs ?? 0, label: "chưa gán" },
    wallets: { n: a?.transferOrdersPending ?? 0, label: "lệnh chuyển tiền chưa làm" },
  };
  const snapAt = app.snap?.at;

  const item = (tab: Tab, label: string, icon: string) => {
    const b = badges[tab];
    return (
      <button
        type="button"
        key={tab}
        class="side-item"
        aria-current={app.tab === tab ? "page" : undefined}
        onClick={() => (tab === "wallets" && app.tab !== "wallets" ? go("wallets", { tierFilter: null }) : go(tab))}
      >
        <Icon name={icon} size={18} />
        <span class="side-label">{label}</span>
        {!!b?.n && (
          <span class="side-badge" aria-label={`${b.n} ${b.label}`}>
            {b.n}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside class="side" aria-label="Điều hướng">
      <div class="side-brand">
        <span class="side-logo" aria-hidden="true">
          <Icon name="wallet" size={16} />
        </span>
        Ví nhà
      </div>

      <button type="button" class="btn side-new" onClick={() => go("entry")} aria-keyshortcuts="N">
        <Icon name="plus" size={16} />
        Nhập khoản chi
        <kbd>N</kbd>
      </button>

      <nav class="side-nav" aria-label="Màn chính">
        {NAV.map((n) => item(n.tab, n.label, n.icon))}
        {item("ledger", "Sổ giao dịch", "book")}
        <div class="side-sep" />
        {item("settings", "Cài đặt", "settings")}
        {item("guide", "Hướng dẫn", "help")}
      </nav>

      <div class="side-foot">
        <div class="side-status" role="status">
          <span class="side-line">
            {app.online ? (
              <>
                <i class="side-dot" aria-hidden="true" /> Có mạng
              </>
            ) : (
              <>
                <Icon name="cloud-off" size={14} /> Không có mạng
              </>
            )}
          </span>
          {snapAt && (
            <span class="side-line">
              {app.stale ? "Số cũ lúc " : "Số lúc "}
              {timeHM(snapAt)}
              {shortDate(snapAt) !== shortDate(new Date().toISOString()) ? ` ngày ${shortDate(snapAt)}` : ""}
            </span>
          )}
          {pending > 0 && <span class="chip warn">{pending} chờ đồng bộ, đã trừ tạm</span>}
          {rejected > 0 && <span class="chip bad">{rejected} bị máy chủ từ chối</span>}
        </div>
        <button type="button" class="btn side-sync" onClick={() => void syncNow()} disabled={app.syncing}>
          <Icon name="sync" size={14} />
          {app.syncing ? "Đang đồng bộ…" : "Đồng bộ"}
        </button>

        <Seg
          class="side-theme"
          label="Giao diện"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "auto", label: "Theo máy" },
            { value: "light", label: "Sáng" },
            { value: "dark", label: "Tối" },
          ]}
        />

        <div class="side-member">
          <span class="min-w-0">
            <span class="side-k">Đang dùng</span>
            <strong>{app.member?.name}</strong>
          </span>
          <button type="button" class="btn side-out" onClick={onLogout}>
            {confirmOut ? "Vẫn đăng xuất" : "Đăng xuất"}
          </button>
        </div>
        {confirmOut && (
          <p class="side-warn" role="alert">
            Còn {unsynced} khoản của {app.member?.name} chưa lên sổ. Chúng nằm lại trên máy này và chỉ gửi khi {app.member?.name} đăng nhập lại.
          </p>
        )}
        <button type="button" class="link side-k" onClick={all.onLogout}>
          {all.confirmOut ? "Vẫn đăng xuất mọi máy" : "Đăng xuất mọi máy"}
        </button>
        {all.confirmOut && (
          <p class="side-warn" role="alert">
            {signOutEverywhereNote(app.member?.name, all.unsynced)}
          </p>
        )}
      </div>
    </aside>
  );
}
