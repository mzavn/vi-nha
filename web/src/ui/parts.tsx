// Component nền theo docs/DESIGN.md §4: Card, CardHead, Hero, Stat, Row, RowGroup, TxRow, Chip, Progress, Button, SectionHead, SectionNav, Sheet, PageHeader, Seg, Empty.
// Mọi phần tử bấm được chạm ≥ 44px trên điện thoại (DESIGN.md §6).

import { type ComponentChildren, Fragment } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { errorText } from "../lib/api";
import type { EmptyState } from "../lib/empty-states";
import { timeHM } from "../lib/period";
import { TERMS, type Term } from "../lib/terms";
import type { Resource } from "../state/resource";
import { setHideAmounts, useApp } from "../state/store";
import { Icon } from "./icons";

export function Card(props: {
  title?: ComponentChildren;
  right?: ComponentChildren;
  flush?: boolean;
  note?: ComponentChildren;
  children?: ComponentChildren;
  id?: string;
  class?: string;
}) {
  return (
    <section class={props.class ? `card ${props.class}` : "card"} id={props.id}>
      {(props.title || props.right) && (
        <div class="card-h">
          {props.title ? <h2>{props.title}</h2> : <span />}
          {props.right}
        </div>
      )}
      <div class={props.flush ? "card-b flush" : "card-b"}>{props.children}</div>
      {props.note && <div class="note">{props.note}</div>}
    </section>
  );
}

/** Tiêu đề thẻ có chấm ngăn 8px (DESIGN.md §4.2). */
export function CardHead(props: {
  title: ComponentChildren;
  context?: ComponentChildren;
  action?: ComponentChildren;
  onAction?: () => void;
  pocket?: "operating" | "reserve" | "savings";
  class?: string;
  id?: string;
}) {
  return (
    <div class={props.class ? `card-head ${props.class}` : "card-head"}>
      <span class="card-head-nm">
        {props.pocket && <i class={`card-head-dot pocket-${props.pocket}`} aria-hidden="true" />}
        <span id={props.id}>
          {props.title}
          {props.context && <> · {props.context}</>}
        </span>
      </span>
      {props.action && (
        props.onAction ? (
          <button type="button" class="link card-head-act" onClick={props.onAction}>
            {props.action}
          </button>
        ) : typeof props.action === "string" ? (
          <span class="card-head-act">{props.action}</span>
        ) : (
          props.action
        )
      )}
    </div>
  );
}

/** Số chính hero (DESIGN.md §4.3). */
export function Hero(props: {
  value: ComponentChildren;
  unit?: ComponentChildren;
  ctx?: ComponentChildren;
  sub?: ComponentChildren;
  tone?: "pos" | "neg" | "warn";
  class?: string;
}) {
  return (
    <div class={props.class ? `hero-wrap ${props.class}` : "hero-wrap"}>
      <div class={`hero num ${props.tone ?? ""}`}>
        {props.value}
        {props.unit && <span class="unit">{props.unit}</span>}
      </div>
      {props.ctx && <div class="ctx">{props.ctx}</div>}
      {props.sub && <div class="sub-line">{props.sub}</div>}
    </div>
  );
}

/** Ô thống kê phụ (DESIGN.md §4.4): nhãn ở trên, số ở dưới. */
export function Stat(props: {
  label: ComponentChildren;
  value: ComponentChildren;
  class?: string;
}) {
  return (
    <div class={props.class ? `stat ${props.class}` : "stat"}>
      <div class="stat-k">{props.label}</div>
      <div class="stat-v num">{props.value}</div>
    </div>
  );
}

export function StatGroup(props: { children: ComponentChildren; class?: string }) {
  return <div class={props.class ? `pair ${props.class}` : "pair"}>{props.children}</div>;
}

/** Hàng nhãn – giá trị (DESIGN.md §4.5): kiểu hàng duy nhất cho danh sách tiền. */
export function Row(props: {
  title: ComponentChildren;
  sub?: ComponentChildren;
  /** Dòng phụ màu cảnh báo / âm (DESIGN.md §4.5: cảnh báo thì dòng phụ màu `--warn`). */
  subTone?: "warn" | "neg";
  value?: ComponentChildren;
  valueSub?: ComponentChildren;
  indent?: boolean;
  total?: boolean;
  arrow?: boolean;
  track?: { pct: number; pocket?: "operating" | "reserve" | "savings"; tone?: "pos" | "neg" | "warn" } | null;
  onClick?: () => void;
  /** Hàng mở / gập một danh sách bên dưới (`aria-expanded`). */
  expanded?: boolean;
  label?: string;
  class?: string;
}) {
  const inner = (
    <>
      <span class="t">
        <span class="tt">{props.title}</span>
        {props.sub && <span class={props.subTone ? `s ${props.subTone}` : "s"}>{props.sub}</span>}
      </span>
      {props.value !== undefined && (
        <span class="v num">
          {props.value}
          {props.arrow && " ›"}
          {props.valueSub && <span class="vs">{props.valueSub}</span>}
        </span>
      )}
      {props.track && (
        <span class={`track ${props.track.pocket ? `pocket-${props.track.pocket}` : ""} ${props.track.tone ?? ""}`} aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, props.track.pct))}%` }} />
        </span>
      )}
    </>
  );
  const cls = [
    "row",
    props.indent ? "in" : "",
    props.total ? "total" : "",
    props.class ?? "",
  ].filter(Boolean).join(" ");

  return props.onClick ? (
    <button type="button" class={cls} onClick={props.onClick} aria-label={props.label} aria-expanded={props.expanded}>
      {inner}
    </button>
  ) : (
    <div class={cls}>{inner}</div>
  );
}

/** Nhóm danh sách (DESIGN.md §4.6). */
export function RowGroup(props: {
  title?: ComponentChildren;
  total?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <div class={props.class ? `row-group ${props.class}` : "row-group"}>
      {(props.title || props.total) && (
        <div class="row-group-h">
          {props.title && <span class="row-group-t">{props.title}</span>}
          {props.total && <span class="row-group-v num">{props.total}</span>}
        </div>
      )}
      <div class="rows">{props.children}</div>
    </div>
  );
}

/** Hàng giao dịch (DESIGN.md §4.7). */
export function TxRow(props: {
  icon?: string;
  title: ComponentChildren;
  sub?: ComponentChildren;
  amount: ComponentChildren;
  chip?: ComponentChildren;
  deleted?: boolean;
  onClick?: () => void;
  class?: string;
  ariaLabel?: string;
}) {
  const cls = ["tx-row", props.deleted ? "deleted" : "", props.class ?? ""].filter(Boolean).join(" ");
  const inner = (
    <>
      {props.icon && (
        <div class="tx-icon-wrap" aria-hidden="true">
          <Icon name={props.icon} size={20} />
        </div>
      )}
      <div class="tx-main">
        <div class="tx-title">
          <span class="tx-name">{props.title}</span>
          {props.chip}
        </div>
        {props.sub && <div class="tx-sub">{props.sub}</div>}
      </div>
      <div class="tx-amt num">{props.amount}</div>
    </>
  );
  if (props.onClick) {
    return (
      <button type="button" class={cls} onClick={props.onClick} aria-label={props.ariaLabel}>
        {inner}
      </button>
    );
  }
  return <div class={cls}>{inner}</div>;
}

/** Chip nhãn trạng thái (DESIGN.md §4.8): viên thuốc, không phải nút. */
export function Chip(props: {
  children: ComponentChildren;
  tone?: "pos" | "neg" | "warn" | "bad";
  class?: string;
  label?: string;
}) {
  const toneCls = props.tone ? (props.tone === "bad" ? "neg" : props.tone) : "";
  return (
    <span class={`chip ${toneCls} ${props.class ?? ""}`.trim()} aria-label={props.label}>
      {props.children}
    </span>
  );
}

/** Thanh tiến độ (DESIGN.md §4.9). */
export function Progress(props: {
  pct: number;
  pocket?: "operating" | "reserve" | "savings";
  tone?: "pos" | "neg" | "warn";
  standalone?: boolean;
  class?: string;
}) {
  const w = Math.max(0, Math.min(100, props.pct));
  const pocketCls = props.pocket ? `pocket-${props.pocket}` : "";
  const toneCls = props.tone ?? "";
  const standCls = props.standalone ? "standalone" : "";
  return (
    <div class={`progress ${pocketCls} ${toneCls} ${standCls} ${props.class ?? ""}`.trim()} aria-hidden="true">
      <i style={{ width: `${w}%` }} />
    </div>
  );
}

/** Nút theo DESIGN.md §4.10, chạm ≥ 44px. */
export function Button(props: {
  children: ComponentChildren;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "icon" | "select" | "text";
  wide?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: (e: MouseEvent) => void;
  label?: string;
  class?: string;
}) {
  const v = props.variant ?? "secondary";
  const cls = [
    "btn",
    v === "primary" ? "btn-primary" : "",
    v === "ghost" ? "btn-ghost" : "",
    v === "danger" ? "btn-bad" : "",
    v === "icon" ? "icon-btn" : "",
    v === "text" ? "link" : "",
    props.wide ? "btn-wide" : "",
    props.class ?? "",
  ].filter(Boolean).join(" ");
  return (
    <button
      type={props.type ?? "button"}
      class={cls}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props.label}
    >
      {props.children}
    </button>
  );
}

/** Tiêu đề phần (DESIGN.md §4). */
export function SectionHead(props: {
  title: ComponentChildren;
  sub?: ComponentChildren;
  action?: ComponentChildren;
  class?: string;
}) {
  return (
    <div class={props.class ? `section-head ${props.class}` : "section-head"}>
      <div class="min-w-0">
        <h2 class="section-title">{props.title}</h2>
        {props.sub && <div class="section-sub">{props.sub}</div>}
      </div>
      {props.action && <div class="section-act">{props.action}</div>}
    </div>
  );
}

export function Banner(props: {
  tone: "bad" | "warn" | "info";
  mark: string;
  children: ComponentChildren;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div class={`banner b-${props.tone}`} role={props.tone === "bad" ? "alert" : undefined}>
      <span class="ic" aria-hidden="true">
        {props.mark}
      </span>
      <div class="txt">{props.children}</div>
      {props.action && (
        <button type="button" class="link act" onClick={props.onAction}>
          {props.action}
        </button>
      )}
    </div>
  );
}

/** Thanh tiến độ: tương thích cũ, chuyển sang `Progress`. */
export function Bar({ pct, tone }: { pct: number; tone?: "lock" | "ok" | "warn" | "bad" }) {
  const t = tone === "lock" ? undefined : tone === "ok" ? "pos" : tone === "bad" ? "neg" : tone;
  const pocket = tone === "lock" ? "savings" : undefined;
  return <Progress pct={pct} tone={t} pocket={pocket} class="bar" />;
}

export function TierRow(props: {
  name: ComponentChildren;
  dot: "lock" | "nice" | "must" | "have" | null;
  chip?: ComponentChildren;
  amount: ComponentChildren;
  left?: ComponentChildren;
  right?: ComponentChildren;
  bar?: { pct: number; tone?: "lock" | "ok" | "bad" } | null;
  onClick?: () => void;
  label?: string;
}) {
  const inner = (
    <>
      <div class="nm">
        {props.dot && <i class={`dot d-${props.dot}`} aria-hidden="true" />}
        {props.name}
        {props.chip}
      </div>
      <div class="amt num">{props.amount}</div>
      {(props.left || props.right) && (
        <div class="tsub">
          <span>{props.left}</span>
          <span>{props.right}</span>
        </div>
      )}
      {props.bar && <Bar pct={props.bar.pct} tone={props.bar.tone} />}
    </>
  );
  return props.onClick ? (
    <button type="button" class="tier" onClick={props.onClick} aria-label={props.label}>
      {inner}
    </button>
  ) : (
    <div class="tier">{inner}</div>
  );
}

/** Sheet trượt từ dưới, dựng trên <dialog> gốc (DESIGN.md §4.11). */
export function Sheet(props: {
  open: boolean;
  title: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  useEffect(() => () => ref.current?.open && ref.current.close(), []);
  return (
    <dialog
      ref={ref}
      class="sheet"
      aria-label={typeof props.title === "string" ? props.title : undefined}
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      {props.open && (
        <>
          <div class="grab" aria-hidden="true" />
          <div class="sheet-h">
            <h3>{props.title}</h3>
            <button type="button" class="btn btn-ghost" onClick={props.onClose}>
              Đóng
            </button>
          </div>
          <div class="sheet-body">{props.children}</div>
        </>
      )}
    </dialog>
  );
}

export function PageHeader(props: { title: string; sub?: ComponentChildren; action?: ComponentChildren }) {
  const [stuck, setStuck] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const on = () => setStuck(scrollY > 6);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header ref={ref} class={stuck ? "topbar stuck" : "topbar"}>
      <div class="min-w-0">
        <h1 tabIndex={-1} id="page-title">
          {props.title}
        </h1>
        {props.sub && <div class="sub">{props.sub}</div>}
      </div>
      <div class="topbar-act">
        <HideAmountsButton class="btn btn-ghost icon-btn topbar-eye" />
        {props.action}
      </div>
    </header>
  );
}

/** Nút con mắt (pwa UC-718): che / hiện số tiền trên máy này. */
export function HideAmountsButton(props: { class: string; label?: boolean }) {
  const { hideAmounts } = useApp();
  const text = hideAmounts ? "Hiện số tiền" : "Che số tiền";
  return (
    <button type="button" class={props.class} aria-label={props.label ? undefined : text} onClick={() => setHideAmounts(!hideAmounts)}>
      <Icon name={hideAmounts ? "eye-off" : "eye"} size={props.label ? 14 : 20} />
      {props.label && text}
    </button>
  );
}

export function Seg<T extends string>(props: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  class?: string;
}) {
  return (
    <div class={`seg ${props.class ?? ""}`} role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" key={o.value} aria-pressed={o.value === props.value} disabled={o.disabled} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Điều hướng mục con (DESIGN.md §4.18): máy tính là cột mục lục trong thẻ, điện thoại là một hàng tab ngang dính dưới thanh tiêu
 *  đề, cuộn ngang trong chính hàng. Chỉ mục đang chọn được tô (`aria-current`); `group` đổi thì cột mục lục thêm tiêu đề nhóm. */
export function SectionNav<T extends string>(props: {
  items: readonly { value: T; label: string; group?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  wide: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // Hàng tab cuộn ngang: đưa tab đang chọn vào tầm nhìn.
    if (props.wide) return;
    const nav = ref.current;
    const tab = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (nav && tab && (tab.offsetLeft < nav.scrollLeft || tab.offsetLeft + tab.offsetWidth > nav.scrollLeft + nav.clientWidth)) {
      nav.scrollTo({ left: tab.offsetLeft - 12, behavior: "smooth" });
    }
  }, [props.value, props.wide]);
  return (
    <nav ref={ref} class={props.wide ? "card sec-nav" : "sec-tabs"} aria-label={props.label}>
      {props.items.map((x, i) => (
        <Fragment key={x.value}>
          {props.wide && x.group && x.group !== props.items[i - 1]?.group && <div class="sec-nav-h">{x.group}</div>}
          <button type="button" aria-current={props.value === x.value ? "true" : undefined} onClick={() => props.onChange(x.value)}>
            {x.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}

/** Hàng chứa nút ⓘ: đoạn giải thích nằm thành khối riêng ngay dưới hàng này (DESIGN.md §4.19). */
const TIP_HOST = ".card-h, .card-head, .near-row, .row, .tier, .srow, .field";

/**
 * Nút ⓘ (DESIGN.md §4.19): đứng sát tiêu đề, vùng bấm 44px bằng pseudo-element. Mở ra thì đoạn giải thích đặt tuyệt đối ngay dưới
 * hàng tiêu đề gần nhất (`TIP_HOST`), rộng hết hàng; hàng đó chừa chỗ bằng `--tip-h` (chiều cao đoạn, đo lại khi đổi cỡ) nên tiêu
 * đề và ⓘ không đổi vị trí, không bị ép xuống dòng — không cần sửa nơi gọi.
 */
export function InfoTip({ term, class: cls }: { term: Term; class?: string }) {
  const [open, setOpen] = useState(false);
  const text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = text.current;
    const host = el?.parentElement?.closest<HTMLElement>(TIP_HOST);
    if (!open || !el || !host) return;
    const fit = () => host.style.setProperty("--tip-h", `${el.offsetHeight}px`);
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      host.style.removeProperty("--tip-h");
    };
  }, [open]);
  const info = TERMS[term];
  if (!info) return null;
  return (
    <>
      <button
        type="button"
        class={`info-tip-btn ${cls ?? ""}`}
        aria-label={`Giải thích ${info.label}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>
      {open && (
        <span ref={text} class="info-tip-text" role="note">
          {info.text}
        </span>
      )}
    </>
  );
}

export function Empty(props: {
  title?: ComponentChildren;
  hint?: ComponentChildren;
  action?: ComponentChildren | { label: string };
  onAction?: () => void;
  children?: ComponentChildren;
  state?: EmptyState;
}) {
  const st = props.state;
  const title = props.title ?? st?.title ?? "";
  const hint = props.hint ?? st?.hint;
  const action = props.action ?? st?.action;
  const actLabel = action && typeof action === "object" && "label" in action ? (action as { label: ComponentChildren }).label : action;

  return (
    <div class="empty">
      {title && <strong>{title}</strong>}
      {hint && <p class="empty-hint">{hint}</p>}
      {props.children}
      {actLabel && (
        <div class="empty-act-wrap">
          {props.onAction ? (
            <button type="button" class="btn btn-sm empty-act" onClick={props.onAction}>
              {actLabel}
            </button>
          ) : (
            <span class="empty-act">{actLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Câu giải thích khi một việc cần mạng mà máy đang offline (D12). */
export function NeedsNetwork({ what }: { what: string }) {
  return (
    <div class="status-row" style={{ margin: "8px 0 0" }}>
      <Icon name="cloud-off" size={16} />
      <span>{what} cần mạng. Khoản chi nhập tay vẫn ghi được khi không có mạng.</span>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div class="card-b" aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="skeleton" style={{ margin: "12px 0", width: `${85 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function FirstLoadFailed({ online, onRetry }: { online: boolean; onRetry: () => void }) {
  return (
    <Empty title={online ? "Chưa tải được số." : "Không có mạng."}>
      {online ? "Máy chủ chưa trả lời được. Thử lại sau ít phút." : "Máy này chưa có bản lưu nào. Có mạng thì bấm Tải lại."}
      <div style={{ marginTop: "10px" }}>
        <button type="button" class="btn" onClick={onRetry}>
          Tải lại
        </button>
      </div>
    </Empty>
  );
}

export function Loadable<T>({ res, children }: { res: Resource<T>; children: (data: T) => ComponentChildren }) {
  if (res.data) {
    return (
      <>
        {children(res.data)}
        {res.cachedAt && <p class="status-row">Số lúc {timeHM(res.cachedAt)} — đang không có mạng.</p>}
      </>
    );
  }
  if (res.loading) return <Skeleton rows={4} />;
  return (
    <Empty title={res.error?.offline ? "Không có mạng." : "Chưa tải được."}>
      {res.error?.offline ? "Mục này chưa có bản lưu trên máy. Có mạng thì mở lại." : errorText(res.error)}
      <div style={{ marginTop: "10px" }}>
        <button type="button" class="btn" onClick={res.reload}>
          Tải lại
        </button>
      </div>
    </Empty>
  );
}
