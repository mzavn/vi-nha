// Component nền theo DESIGN.md §4: Card → Banner → TierRow → Sheet → PageHeader → Seg.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { errorText } from "../lib/api";
import { timeHM } from "../lib/period";
import type { Resource } from "../state/resource";
import { Icon } from "./icons";

export function Card(props: { title?: ComponentChildren; right?: ComponentChildren; flush?: boolean; note?: ComponentChildren; children?: ComponentChildren; id?: string; class?: string }) {
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

export function Banner(props: { tone: "bad" | "warn" | "info"; mark: string; children: ComponentChildren; action?: string; onAction?: () => void }) {
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

/** Thanh tiến độ: phần trăm kẹp trong 0..100, không bao giờ là kênh duy nhất mang thông tin. */
export function Bar({ pct, tone }: { pct: number; tone?: "lock" | "ok" | "bad" }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div class={`bar ${tone ?? ""}`} aria-hidden="true">
      <i style={{ width: `${w}%` }} />
    </div>
  );
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
      <div class="amt">{props.amount}</div>
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

/** Sheet trượt từ dưới, dựng trên <dialog> gốc: bẫy focus và phím Esc có sẵn; chạm nền tối để đóng. */
export function Sheet(props: { open: boolean; title: ComponentChildren; onClose: () => void; children: ComponentChildren }) {
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
  // Chiều cao thanh tiêu đề cho các thanh dính ngay dưới nó (hàng nhảy tới phần ở Cài đặt).
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
      {props.action}
    </header>
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; class?: string }) {
  return (
    <div class={`seg ${props.class ?? ""}`} role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" key={o.value} aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <strong>{title}</strong>
      {children}
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

/** Lần tải số đầu tiên hỏng mà máy chưa có bản lưu: nói lý do và cho tải lại, không để khung chờ chạy mãi. */
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

/** Trạng thái chung cho mọi bảng đọc từ mạng: đang tải, lỗi kèm nút tải lại, số cũ. */
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
