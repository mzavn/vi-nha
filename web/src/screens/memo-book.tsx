// Sổ đối ứng (ghi nhớ ai nợ ai, nằm ngoài sổ cái) — một bộ giao diện dùng cho cả hai sổ ở tab Nợ:
// "Mình nợ" (sổ nợ) và "Người khác nợ mình" (sổ phải thu). Mỗi sổ chỉ khác câu chữ (`BookLabels`) và việc làm được.
// Sổ chỉ ghi thêm: sai thì huỷ dòng, không sửa. Thêm khoản, thêm dòng, huỷ dòng ghi thẳng lên server nên cần mạng.

import { useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import { type BookLineForm, mergeHistory, progressPct } from "../lib/memo-books";
import { formatVnd, groupDigits } from "../lib/money";
import { shortDate } from "../lib/period";
import type { Result } from "../lib/settings";
import { openTx, toast, useApp } from "../state/store";
import { AmountInput } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, Empty, NeedsNetwork, Seg, Sheet, TierRow } from "../ui/parts";

/** Câu chữ riêng của một sổ. */
export interface BookLabels {
  /** Tiêu đề thẻ: "Mình nợ" / "Người khác nợ mình". */
  title: string;
  note: string;
  emptyTitle: string;
  emptyBody: string;
  /** Danh từ của một khoản: "khoản nợ" / "khoản phải thu". */
  noun: string;
  /** Tên sổ: "sổ nợ" / "sổ phải thu". */
  book: string;
  totalLabel: string;
  openCount: (n: number) => string;
  allDone: string;
  /** Nhóm đã xong (gập sẵn) và câu trong sheet chi tiết. */
  doneGroup: string;
  doneText: string;
  /** Ba số của một khoản: phần ghi tăng, phần đã trả, phần còn lại. */
  totalWord: string;
  backWord: string;
  balanceWord: string;
  /** Câu hệ quả sau mỗi lần ghi: còn bao nhiêu, hoặc đã xong. */
  remain: (balance: number) => string;
  /** Nhãn dòng sổ theo loại (mở sổ, chỉnh…). */
  kindLabel: Record<string, string>;
  /** Nút việc chính ở thẻ: "Trả nợ" / "Nhận lại tiền". */
  primary: string;
  /** Việc cần mạng, nói khi offline: ở thẻ (sau "Thêm …") và ở sheet chi tiết. */
  offline: string;
  offlineDetail: string;
  add: {
    nameLabel: string;
    namePlaceholder: string;
    nameMissing: string;
    amountLabel: string;
    notePlaceholder: string;
    hint: string;
    /** Có thì thêm được người chưa nợ gì (số để 0): chữ trên nút lúc đó. Chỉ sổ phải thu. */
    zeroButton?: string;
  };
  adjust: { title: string; up: string; down: string; placeholder: string; hint: string };
  /** Dòng nhắc trong sheet thêm dòng: "Cô Lan đang còn nợ 5.000.000 ₫." */
  balanceHint: (name: string, balance: number) => string;
}

/** Một khoản, đã quy về ba số chung. */
export interface BookItem {
  id: string;
  name: string;
  note: string | null;
  /** Đã vay / đã cho vay. */
  total: number;
  /** Đã trả / đã nhận lại. */
  back: number;
  balance: number;
  done: boolean;
}

export interface BookLineView {
  id: number;
  at: string;
  kind: string;
  amount: number;
  note: string | null;
}

/** Một lần tiền thật đi / về gắn với khoản (trả nợ, cho vay thêm, nhận lại): chạm để mở giao dịch đó (UC-715). */
export interface BookMovementView {
  key: string;
  at: string;
  label: string;
  sub: (string | null)[];
  /** Có dấu theo chiều số còn lại: tăng +, giảm −. */
  amount: number;
  /** Giao dịch trong sổ cái sinh ra lần tiền này. */
  txId: number;
}

export interface BookAction {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** Thẻ một sổ: tổng còn lại, mỗi khoản một hàng, khoản đã xong gập lại; nút thêm khoản và việc chính. */
export function BookCard(props: {
  labels: BookLabels;
  totalBalance: number;
  open: BookItem[];
  done: BookItem[];
  onOpen: (id: string) => void;
  onAdd: () => void;
  onPrimary: () => void;
}) {
  const { online } = useApp();
  const [showDone, setShowDone] = useState(false);
  const { labels: l, open, done } = props;
  return (
    <Card title={l.title} flush note={l.note}>
      {open.length === 0 && done.length === 0 ? (
        <Empty title={l.emptyTitle}>{l.emptyBody}</Empty>
      ) : (
        <div class="blist">
          <div class="tier btotal">
            <div class="nm">{l.totalLabel}</div>
            <div class="amt">
              <Money value={props.totalBalance} tone={false} />
            </div>
            <div class="tsub">
              <span>{open.length ? l.openCount(open.length) : l.allDone}</span>
            </div>
          </div>
          {open.map((d) => (
            <TierRow
              key={d.id}
              name={d.name}
              dot={null}
              amount={<Money value={d.balance} tone={false} />}
              left={`${l.backWord.toLowerCase()} ${groupDigits(d.back)} / ${formatVnd(d.total)}`}
              right={`${progressPct(d.total, d.back)}%`}
              bar={{ pct: progressPct(d.total, d.back) }}
              onClick={() => props.onOpen(d.id)}
              label={`${d.name} — ${l.balanceWord.toLowerCase()} ${formatVnd(d.balance)}, xem lịch sử`}
            />
          ))}
          {done.length > 0 && (
            <button type="button" class="srow" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
              <span class="srow-t">
                {l.doneGroup} ({done.length})
              </span>
              <span class="srow-r">
                <Icon name={showDone ? "chevron-up" : "chevron-down"} size={16} />
              </span>
            </button>
          )}
          {showDone &&
            done.map((d) => (
              <TierRow
                key={d.id}
                name={d.name}
                dot={null}
                chip={<span class="chip">xong</span>}
                amount={<Money value={d.balance} tone={false} />}
                left={`${l.backWord.toLowerCase()} ${formatVnd(d.back)}`}
                onClick={() => props.onOpen(d.id)}
                label={`${d.name} — ${l.doneGroup.toLowerCase()}, xem lịch sử`}
              />
            ))}
        </div>
      )}
      <div class="pad grid grid-cols-2 gap-2">
        <button type="button" class="btn" style={{ whiteSpace: "normal", textAlign: "center" }} disabled={!online} onClick={props.onAdd}>
          <Icon name="plus" size={16} /> Thêm {l.noun}
        </button>
        <button type="button" class="btn btn-primary" disabled={open.length === 0} onClick={props.onPrimary}>
          {l.primary}
        </button>
      </div>
      {!online && (
        <div class="pad" style={{ paddingTop: 0 }}>
          <NeedsNetwork what={`Thêm ${l.noun}, ${l.offline}`} />
        </div>
      )}
    </Card>
  );
}

/** Một khoản: ba số, các việc làm được, và lịch sử (dòng sổ + lần tiền đi / về), mới nhất trước. Dòng sổ huỷ được. */
export function BookDetailSheet(props: {
  labels: BookLabels;
  item: BookItem;
  actions: BookAction[];
  lines: BookLineView[];
  movements: BookMovementView[];
  /** POST huỷ một dòng sổ. */
  voidPath: (lineId: number) => string;
  onClose: () => void;
  onVoided: (text: string) => void;
}) {
  const { online } = useApp();
  const { labels: l, item: d } = props;
  const [confirmVoid, setConfirmVoid] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function voidLine(line: BookLineView) {
    setBusy(true);
    try {
      await api.post(props.voidPath(line.id));
      props.onVoided(`Đã huỷ dòng ${l.kindLabel[line.kind] ?? line.kind}. ${l.remain(d.balance - line.amount)}`);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
      setConfirmVoid(null);
    }
  }

  return (
    <Sheet open title={d.name} onClose={props.onClose}>
      <div class="srow" style={{ borderTop: 0 }}>
        <span class="srow-t">{l.totalWord}</span>
        <Money value={d.total} tone={false} />
      </div>
      <div class="srow">
        <span class="srow-t">{l.backWord}</span>
        <Money value={d.back} tone={false} />
      </div>
      <div class="srow">
        <span class="srow-main">
          <span class="srow-t">{l.balanceWord}</span>
          {d.done && <span class="srow-s">{l.doneText}</span>}
        </span>
        <Money value={d.balance} tone={false} class="srow-amt" />
      </div>
      {d.note && <p class="fhint">{d.note}</p>}
      <div class="pad grid grid-cols-3 gap-2">
        {props.actions.map((a) => (
          <button key={a.label} type="button" class={a.primary ? "btn btn-primary" : "btn"} disabled={a.disabled} onClick={a.onClick}>
            {a.label}
          </button>
        ))}
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th scope="col">Lịch sử</th>
              <th scope="col">Số tiền ₫</th>
            </tr>
          </thead>
          <tbody>
            {mergeHistory(props.lines, props.movements).map(({ line, movement }) =>
              line ? (
                <tr key={`l${line.id}`}>
                  <td>
                    {l.kindLabel[line.kind] ?? line.kind}
                    <div class="sub-line">{[shortDate(line.at), line.note].filter(Boolean).join(" · ")}</div>
                    {online && (
                      <button
                        type="button"
                        class={confirmVoid === line.id ? "btn btn-bad" : "link"}
                        style={{ fontSize: "12.5px" }}
                        disabled={busy}
                        onClick={() => (confirmVoid === line.id ? void voidLine(line) : setConfirmVoid(line.id))}
                      >
                        {confirmVoid === line.id ? "Huỷ hẳn dòng này" : "Huỷ dòng"}
                      </button>
                    )}
                  </td>
                  <td class="num">
                    <Money value={line.amount} unit={false} mono signed tone={false} />
                  </td>
                </tr>
              ) : (
                <tr key={movement!.key} class="tx-row" onClick={() => openTx(movement!.txId)}>
                  <td>
                    <button type="button" class="tx-open">
                      {movement!.label}
                    </button>
                    <div class="sub-line">{[shortDate(movement!.at), ...movement!.sub].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td class="num">
                    <Money value={movement!.amount} unit={false} mono signed tone={false} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        Sổ chỉ ghi thêm: ghi sai thì huỷ dòng rồi ghi lại.
      </div>
      {!online && (
        <div class="pad">
          <NeedsNetwork what={l.offlineDetail} />
        </div>
      )}
    </Sheet>
  );
}

/** Thêm một khoản: tên người và số còn lại hôm nay (dòng mở sổ). */
export function BookAddSheet(props: {
  labels: BookLabels;
  path: string;
  payload: (f: { name: string; amount: number; note: string }) => Result<{ name: string; amount: number; note?: string }>;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { online } = useApp();
  const { labels: l } = props;
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const r = props.payload({ name, amount, note });
    if (!r.ok) return setError(Object.values(r.errors)[0] ?? null);
    setBusy(true);
    setError(null);
    try {
      const d = await api.post<{ name: string; balance: number }>(props.path, r.value);
      props.onSaved(`Đã thêm ${l.noun} ${d.name}.${r.value.amount ? ` ${l.remain(d.balance)}` : ""}`);
      props.onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open title={`Thêm ${l.noun}`} onClose={props.onClose}>
      <div class="field" style={{ borderTop: 0 }}>
        <label for="n-name">{l.add.nameLabel}</label>
        <input id="n-name" class="ctl" maxLength={80} placeholder={l.add.namePlaceholder} value={name} onInput={(e) => setName(e.currentTarget.value)} autoFocus />
      </div>
      <div class="field">
        <label for="n-amount">{l.add.amountLabel}</label>
        <AmountInput id="n-amount" value={amount} onChange={setAmount} />
      </div>
      <div class="field">
        <label for="n-note">Ghi chú</label>
        <input id="n-note" class="ctl" maxLength={500} placeholder={l.add.notePlaceholder} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        {l.add.hint}
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || !name.trim() || (!amount && !l.add.zeroButton)} onClick={() => void submit()}>
          {busy ? "Đang ghi…" : !name.trim() ? l.add.nameMissing : amount ? `Thêm ${l.noun} ${formatVnd(amount)}` : (l.add.zeroButton ?? "Nhập số tiền")}
        </button>
        {!online && <NeedsNetwork what={`Thêm ${l.noun}`} />}
      </div>
    </Sheet>
  );
}

/** Câu chữ của dòng ghi tăng thẳng vào sổ (vd Vay thêm ở sổ nợ). */
export interface IncreaseLabels {
  title: string;
  placeholder: string;
  hint: string;
  /** "vay thêm": nút "Ghi vay thêm X", toast "Đã ghi vay thêm X." */
  verb: string;
}

/** Ghi tăng thẳng vào sổ (có `increase`) hoặc chỉnh tay (tăng / giảm) một khoản. */
export function BookLineSheet<K extends string>(props: {
  labels: BookLabels;
  item: BookItem;
  kind: K;
  increase?: IncreaseLabels;
  path: string;
  payload: (f: BookLineForm<K>) => Result<{ amount: number }>;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { online } = useApp();
  const { labels: l, item } = props;
  // Không có câu chữ ghi tăng thì là dòng chỉnh.
  const inc = props.kind === "adjust" ? undefined : props.increase;
  const [f, setF] = useState<BookLineForm<K>>({ kind: props.kind, amount: 0, sign: 1, note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<BookLineForm<K>>) => setF((x) => ({ ...x, ...patch }));
  const dir = f.sign > 0 ? "tăng" : "giảm";

  async function submit() {
    const r = props.payload(f);
    if (!r.ok) return setError(Object.values(r.errors)[0] ?? null);
    setBusy(true);
    setError(null);
    try {
      await api.post(props.path, r.value);
      const after = l.remain(item.balance + r.value.amount);
      props.onSaved(inc ? `Đã ghi ${inc.verb} ${formatVnd(f.amount)}. ${after}` : `Đã chỉnh ${dir} ${formatVnd(f.amount)}. ${after}`);
      props.onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open title={`${inc ? inc.title : l.adjust.title} · ${item.name}`} onClose={props.onClose}>
      {!inc && (
        <Seg
          class="pad"
          label="Chiều chỉnh"
          value={f.sign > 0 ? "up" : "down"}
          onChange={(v) => set({ sign: v === "up" ? 1 : -1 })}
          options={[
            { value: "up", label: l.adjust.up },
            { value: "down", label: l.adjust.down },
          ]}
        />
      )}
      <div class="field" style={inc ? { borderTop: 0 } : undefined}>
        <label for="dl-amount">Số tiền</label>
        <AmountInput id="dl-amount" value={f.amount} onChange={(amount) => set({ amount })} autoFocus />
      </div>
      <p class="fhint">{l.balanceHint(item.name, item.balance)}</p>
      <div class="field">
        <label for="dl-note">{inc ? "Ghi chú" : "Lý do"}</label>
        <input
          id="dl-note"
          class="ctl"
          maxLength={500}
          placeholder={inc ? inc.placeholder : l.adjust.placeholder}
          value={f.note}
          onInput={(e) => set({ note: e.currentTarget.value })}
        />
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        {inc ? inc.hint : l.adjust.hint}
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || !f.amount} onClick={() => void submit()}>
          {busy ? "Đang ghi…" : f.amount ? (inc ? `Ghi ${inc.verb} ${formatVnd(f.amount)}` : `Ghi ${dir} ${formatVnd(f.amount)}`) : "Nhập số tiền"}
        </button>
        {!online && <NeedsNetwork what={`Ghi ${l.book}`} />}
      </div>
    </Sheet>
  );
}
