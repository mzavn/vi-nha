// Ô nhập dùng chung cho các sheet: số tiền, chọn ví, chọn tài khoản, chọn danh mục.

import { useState } from "preact/hooks";
import { amountText, evalAmount, formatVnd, groupExpr, isAmountExpr, nextAmount } from "../lib/money";
import type { AccountRef, CategoryRef, Wallet } from "../lib/types";

/** Dòng dưới ô số tiền khi đang tính: kết quả, hoặc vì sao chưa tính được. */
export const amountExprHint = (result: number | null): string => (result === null ? "Sai: kết quả phải trên 0, tối đa 1.000 tỷ" : `= ${formatVnd(result)}`);

/** Ô số tiền có phép tính (UC-703): gõ `24+55` thì ô giữ nguyên phép tính, số tiền là kết quả (sai thì 0, `valid` false);
 *  rời ô / Enter (`commit`) thì ô thành kết quả. Không có dấu phép tính thì như cũ: nhóm chấm khi gõ, vượt trần giữ số trước. */
export function useAmountField(value: number, onChange: (n: number, valid: boolean) => void) {
  const [expr, setExpr] = useState<string | null>(null);
  const result = expr === null ? null : evalAmount(expr);
  // Số bị đổi từ ngoài (lưu xong về 0, sửa khoản khác) thì phép tính cũ không còn đúng: bỏ, hiện số.
  const live = expr !== null && (result ?? 0) === value ? expr : null;
  return {
    text: live ?? amountText(value),
    /** Phép tính đang hiện trong ô (null: ô đang là số thường). */
    expr: live,
    result,
    onInput(el: HTMLInputElement) {
      if (isAmountExpr(el.value)) {
        // Mỗi số trong phép tính cũng nhóm chấm khi gõ; con trỏ giữ đúng chỗ. Con trỏ ở cuối thì cuộn ô cho thấy phần
        // cuối của phép tính dài (chữ vừa gõ), phần đầu khuất bên trái.
        const g = groupExpr(el.value, el.selectionStart ?? el.value.length);
        if (g.text !== el.value) {
          el.value = g.text;
          el.setSelectionRange(g.caret, g.caret);
        }
        if (g.caret === g.text.length) el.scrollLeft = el.scrollWidth;
        const n = evalAmount(g.text);
        setExpr(g.text);
        onChange(n ?? 0, n !== null);
        return;
      }
      setExpr(null);
      const n = nextAmount(value, el.value);
      onChange(n, true);
      // Viết lại ngay để dấu chấm nhóm hiện khi đang gõ (và số vượt trần không lọt vào ô).
      el.value = amountText(n);
    },
    /** Phép tính đúng thì ô thành kết quả; sai thì giữ để sửa. */
    commit() {
      if (live !== null && result !== null) setExpr(null);
    },
    /** Nút nhanh, Xoá: đặt hẳn một số, bỏ phép tính. */
    set(n: number) {
      setExpr(null);
      onChange(n, true);
    },
  };
}

export function AmountInput(props: { id: string; value: number; onChange: (n: number, valid: boolean) => void; invalid?: boolean; autoFocus?: boolean }) {
  const f = useAmountField(props.value, props.onChange);
  // Bọc cố định (không bọc theo điều kiện) để thêm dòng kết quả mà ô không bị dựng lại, mất con trỏ.
  return (
    <span class="amt-in">
      <input
        id={props.id}
        class="ctl money"
        inputMode="numeric"
        autocomplete="off"
        enterKeyHint="done"
        placeholder="0"
        value={f.text}
        onInput={(e) => f.onInput(e.currentTarget)}
        onBlur={f.commit}
        onKeyDown={(e) => e.key === "Enter" && f.commit()}
        aria-invalid={props.invalid || (f.expr !== null && f.result === null) ? "true" : undefined}
        aria-describedby={f.expr !== null ? `${props.id}-eq` : undefined}
        autoFocus={props.autoFocus}
      />
      {f.expr !== null && (
        <span id={`${props.id}-eq`} class={f.result === null ? "amt-eq err" : "amt-eq"} aria-live="polite">
          {amountExprHint(f.result)}
        </span>
      )}
    </span>
  );
}

export function WalletSelect(props: { id: string; wallets: Wallet[]; value: string | null; onChange: (id: string) => void; placeholder?: string }) {
  return (
    <select id={props.id} class="ctl" value={props.value ?? ""} onChange={(e) => props.onChange(e.currentTarget.value)}>
      {!props.value && <option value="">{props.placeholder ?? "Chọn ví"}</option>}
      {props.wallets.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}

export function AccountSelect(props: { id: string; accounts: AccountRef[]; value: string | null; onChange: (id: string) => void; allowNone?: string }) {
  if (props.accounts.length === 0 && !props.allowNone) {
    return <p class="hint">Mọi tài khoản đã nối ngân hàng: khoản này sẽ tự về, gán nó ở màn Gán.</p>;
  }
  return (
    <select id={props.id} class="ctl" value={props.value ?? ""} onChange={(e) => props.onChange(e.currentTarget.value)}>
      {(props.allowNone || !props.value) && <option value="">{props.allowNone ?? "Chọn tài khoản"}</option>}
      {props.accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

export function CategorySelect(props: { id: string; categories: CategoryRef[]; value: string | null; onChange: (id: string) => void; allowNone?: string }) {
  return (
    <select id={props.id} class="ctl" value={props.value ?? ""} onChange={(e) => props.onChange(e.currentTarget.value)}>
      <option value="">{props.allowNone ?? "Chọn danh mục"}</option>
      {props.categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/** UUID cho client_id; trình duyệt cũ không có randomUUID thì tự ghép từ getRandomValues. */
export function newClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
