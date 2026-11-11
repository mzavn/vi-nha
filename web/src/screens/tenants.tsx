// Người thuê (Ví & Quỹ › Người thuê, pwa UC-713): sổ phải thu, nằm ngoài sổ cái — không đụng ví nào.
// Mỗi tháng một bản tính cho mỗi người thuê: chép tháng trước, sửa số, Chốt & gửi tin kèm mã QR; gửi rồi vẫn sửa được.
// Số dư dương = người thuê còn nợ; âm = đã trả dư. Mọi việc ghi cần mạng; chép tin / gửi cho người thuê thì không.

import { useEffect, useState } from "preact/hooks";
import { BILL_CATEGORIES, type BillCategory, billMonthLabel, billTotals, CATEGORY_LABEL, MAX_BILL_ITEMS, MAX_ITEM_NAME, previousAmounts } from "../../../src/domain/rental";
import { ApiError, api, errorText } from "../lib/api";
import { formatVnd, maskAmounts } from "../lib/money";
import { monthKey, nextMonth, previousMonth, shortDate } from "../lib/period";
import {
  balanceText,
  billChip,
  billCompare,
  billPayload,
  type BillRow,
  billShare,
  createHint,
  markSent,
  needsCheck,
  needsResend,
  newRow,
  orderedRows,
  owedText,
  previousSource,
  receiveAccounts,
  resendConfirm,
  rowsOf,
  sentRevisions,
} from "../lib/rental";
import type { Errors } from "../lib/settings";
import type { BillView, Rental, TenantSummary } from "../lib/types";
import { useResource } from "../state/resource";
import { go, openTx, refresh, toast, useApp } from "../state/store";
import { copyText } from "../ui/clipboard";
import { AmountInput } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Banner, Card, Empty, Loadable, NeedsNetwork } from "../ui/parts";
import { qrPngFile, TransferQrBlock } from "../ui/qr";

const BILL_CHANGED = "Bản tính vừa được sửa ở máy khác — tải lại.";

/** localStorage của máy; trình duyệt chặn thì null (dấu "đã gửi" không lưu được). */
function deviceStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

type Sent = { revisions: Record<string, number>; mark: (billId: number, revision: number) => void };

export function TenantsTab() {
  const res = useResource<Rental>("/v1/rental");
  const [sel, setSel] = useState<string | null>(null);
  const [revisions, setRevisions] = useState(() => sentRevisions(deviceStorage()));
  const sent: Sent = {
    revisions,
    mark: (billId, revision) => {
      markSent(deviceStorage(), billId, revision);
      setRevisions(sentRevisions(deviceStorage()));
    },
  };
  return (
    <Loadable res={res}>
      {(rental) => {
        // Người đã ra vẫn hiện tới khi số dư về 0.
        const shown = rental.tenants.filter((t) => t.active || t.balance !== 0);
        if (shown.length === 0) {
          return (
            <Card>
              <Empty title="Chưa có người thuê.">
                Thêm người thuê ở Cài đặt › Cho thuê.
                <div style={{ marginTop: "10px" }}>
                  <button type="button" class="btn" onClick={() => go("settings")}>
                    Mở Cài đặt
                  </button>
                </div>
              </Empty>
            </Card>
          );
        }
        const current = shown.find((t) => t.id === sel) ?? shown[0]!;
        return (
          <>
            <Card title="Người thuê" flush note="Còn nợ là người thuê phải trả thêm; trả dư thì tự trừ vào tháng sau. Nhãn bên cạnh tên là bản tính tháng trước.">
              {shown.map((t) => {
                const chip = billChip(t.bill, revisions);
                return (
                  <button type="button" key={t.id} class="srow" aria-current={t.id === current.id ? "true" : undefined} onClick={() => setSel(t.id)}>
                    <span class="srow-main">
                      <span class="srow-t">
                        {t.name} {!t.active && <span class="chip">đã ra</span>} <span class={`chip ${chip.tone}`}>{chip.text}</span>
                      </span>
                      <span class="srow-s">{balanceText(t.balance)}</span>
                    </span>
                    <span class="srow-r">
                      <Money value={t.balance} class="srow-amt" tone={false} />
                      <Icon name="chevron-right" size={16} />
                    </span>
                  </button>
                );
              })}
            </Card>
            <BillCard key={current.id} tenant={current} sent={sent} onChanged={res.reload} />
          </>
        );
      }}
    </Loadable>
  );
}

/** Bản tính trống sau khi xoá nháp: giữ bản tháng trước để nút Lập nói đúng chép từ đâu. */
const emptyView = (v: BillView): BillView => ({ ...v, status: "none", bill: null, totals: { fixed: 0, variable: 0, total: 0 }, total: 0, text: null, qrAmount: 0, qr: null, payments: [] });

function BillCard({ tenant, sent, onChanged }: { tenant: TenantSummary; sent: Sent; onChanged: () => void }) {
  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState(() => previousMonth(thisMonth));
  const res = useResource<BillView>(`/v1/rental/tenants/${encodeURIComponent(tenant.id)}/bills/${month}`);
  // Bản server vừa trả sau một lần ghi — hiện ngay, tới khi đọc lại xong.
  const [latest, setLatest] = useState<BillView | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => setLatest(null), [res.data]);

  function changed(view: BillView, text: string) {
    setLatest(view);
    setEditing(false);
    toast(text);
    res.reload();
    onChanged();
    void refresh();
  }
  function reload() {
    setLatest(null);
    res.reload();
  }
  function goMonth(m: string) {
    setLatest(null);
    setEditing(false);
    setMonth(m);
  }

  const nav = (
    <span class="flex items-center gap-2">
      <button type="button" class="btn btn-ghost icon-btn" aria-label="Tháng trước" onClick={() => goMonth(previousMonth(month))}>
        ‹
      </button>
      <button type="button" class="btn btn-ghost icon-btn" aria-label="Tháng sau" disabled={month >= thisMonth} onClick={() => goMonth(nextMonth(month))}>
        ›
      </button>
    </span>
  );

  return (
    <Card class="bill-card" title={`${tenant.name} · Tháng ${billMonthLabel(month)}`} right={nav} flush>
      <Loadable res={res}>
        {(data) => {
          const view = latest && latest.month === month ? latest : data;
          const bill = view.bill;
          if (view.status === "none" || !bill) return <BillCreate view={view} onCreated={changed} />;
          if (bill.status === "draft" || editing) {
            return (
              <BillEditor
                key={`${bill.id}:${bill.revision}:${editing}`}
                view={view}
                onDone={changed}
                onDeleted={() => changed(emptyView(view), `Đã xoá nháp tháng ${billMonthLabel(view.month)} của ${view.tenant.name}.`)}
                onCancel={editing ? () => setEditing(false) : undefined}
                onReload={reload}
              />
            );
          }
          return <BillIssued view={view} sent={sent} onEdit={() => setEditing(true)} />;
        }}
      </Loadable>
    </Card>
  );
}

function BillCreate({ view, onCreated }: { view: BillView; onCreated: (v: BillView, text: string) => void }) {
  const { online } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = Number(view.month.slice(5, 7));

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const v = await api.post<BillView>(`/v1/rental/tenants/${encodeURIComponent(view.tenant.id)}/bills`, { month: view.month });
      onCreated(v, `Đã lập bản tính tháng ${m} cho ${view.tenant.name}.`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div class="pad">
      <p class="sub-line" style={{ margin: "0 0 8px" }}>
        {createHint(view.month, view.previous)}
      </p>
      {error && (
        <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
          {error}
        </p>
      )}
      <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || !view.tenant.active} onClick={() => void create()}>
        {busy ? "Đang lập…" : `Lập bản tính tháng ${m}`}
      </button>
      {!view.tenant.active && <p class="fhint">{view.tenant.name} đã ra — không lập bản tính mới.</p>}
      {!online && <NeedsNetwork what="Ghi sổ người thuê" />}
    </div>
  );
}

/** Chữ ký để biết đã sửa gì chưa (tên cắt khoảng trắng, thứ tự hiện trên màn, tài khoản nhận). */
const signature = (rows: readonly BillRow[], account: string | null) => JSON.stringify([orderedRows(rows).map((r) => [r.name.trim(), r.category, r.amount]), account || null]);

/**
 * Sửa bản tính: nháp (Lưu nháp / Xoá nháp / Chốt & gửi) hoặc bản đã gửi (`onCancel` có giá trị — Lưu & gửi lại, hỏi tổng cũ → mới).
 * 409 `bill_changed` giữ nguyên các ô đang gõ, chỉ hiện câu + Tải lại.
 */
function BillEditor(props: { view: BillView; onDone: (v: BillView, text: string) => void; onDeleted: () => void; onCancel?: () => void; onReload: () => void }) {
  const { view } = props;
  const bill = view.bill!;
  const editIssued = bill.status === "issued";
  const { online, boot } = useApp();
  const name = view.tenant.name;
  const mLabel = `tháng ${Number(view.month.slice(5, 7))}`;
  const [rows, setRows] = useState<BillRow[]>(() => rowsOf(bill.items));
  const [negative, setNegative] = useState<Set<number>>(() => new Set(rows.filter((r) => r.amount < 0).map((r) => r.key)));
  const [account, setAccount] = useState(bill.receiveAccountId ?? "");
  const [initial] = useState(() => signature(rows, bill.receiveAccountId));
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmTotal, setConfirmTotal] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [added, setAdded] = useState<number | null>(null);

  const accounts = receiveAccounts(boot?.accounts ?? []);
  const previous = previousAmounts(rows, previousSource(view));
  const prevOf = new Map(rows.map((r, i) => [r.key, previous[i] ?? null]));
  const totals = billTotals(rows);
  const dirty = signature(rows, account) !== initial;
  const canWrite = online && !busy;

  const update = (key: number, patch: Partial<BillRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setConfirmTotal(null);
  };
  function toggleSign(r: BillRow) {
    setNegative((s) => {
      const next = new Set(s);
      if (!next.delete(r.key)) next.add(r.key);
      return next;
    });
    update(r.key, { amount: -r.amount });
  }
  function add(category: BillCategory) {
    const row = newRow(category);
    setRows((rs) => [...rs, row]);
    setAdded(row.key);
  }
  function remove(key: number) {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setConfirmTotal(null);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.code === "bill_changed") setConflict(true);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  /** PUT bản tính; khoản sai thì báo dưới hàng, không gửi. */
  async function put(): Promise<BillView | null> {
    const r = billPayload(bill.revision, rows, account || null);
    if (!r.ok) {
      setErrors(r.errors);
      return null;
    }
    setErrors({});
    return api.put<BillView>(`/v1/rental/bills/${bill.id}`, r.value);
  }

  const saveDraft = () =>
    run(async () => {
      const v = await put();
      if (v) props.onDone(v, `Đã lưu nháp ${mLabel} của ${name}.`);
    });

  const issue = () =>
    run(async () => {
      let revision = bill.revision;
      let saved: BillView | null = null;
      if (dirty) {
        saved = await put();
        if (!saved) return;
        revision = saved.bill!.revision;
      }
      try {
        const v = await api.post<BillView>(`/v1/rental/bills/${bill.id}/issue`, { revision });
        props.onDone(v, `Đã chốt bản tính ${mLabel} của ${name}. Bấm Gửi cho ${name}.`);
      } catch (err) {
        // Đã lưu nháp mà chưa chốt được: hiện bản vừa lưu (revision mới) để bấm lại không bị 409.
        if (saved) props.onDone(saved, `Đã lưu nháp, chưa chốt được: ${errorText(err)}`);
        else throw err;
      }
    });

  function askResend() {
    const r = billPayload(bill.revision, rows, account || null);
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    setConfirmTotal(billTotals(r.value.items).total);
  }

  const resend = () =>
    run(async () => {
      const v = await put();
      if (v) props.onDone(v, `Đã lưu bản tính ${mLabel}. Gửi lại tin cho ${name}.`);
    });

  const deleteDraft = () =>
    run(async () => {
      await api.del(`/v1/rental/bills/${bill.id}`);
      props.onDeleted();
    });

  // Bàn phím mở: kéo ô đang gõ lên trên chân dính (scroll-margin-bottom ở CSS chừa chỗ cho chân).
  function keepVisible(e: FocusEvent) {
    const t = e.target;
    if (t instanceof HTMLElement && t.matches("input, select")) setTimeout(() => t.scrollIntoView({ block: "nearest" }), 300);
  }

  return (
    <div class="bill-editor" onFocusIn={keepVisible}>
      <p class="sub-line pad" style={{ margin: 0 }}>
        {editIssued
          ? `Đang sửa bản đã gửi. Lưu xong gửi lại tin cho ${name}.`
          : bill.copiedFromMonth
            ? `Chép từ tháng ${billMonthLabel(bill.copiedFromMonth)}. Sửa số rồi Chốt & gửi.`
            : "Thêm khoản rồi Chốt & gửi."}
      </p>
      {conflict && (
        <div class="pad" style={{ paddingTop: 0 }}>
          <Banner tone="warn" mark="!" action="Tải lại" onAction={props.onReload}>
            {BILL_CHANGED}
          </Banner>
        </div>
      )}
      {BILL_CATEGORIES.map((c) => {
        const group = rows.filter((r) => r.category === c);
        return (
          <fieldset key={c} class="bill-group">
            <legend class="bill-group-h">
              <span>{CATEGORY_LABEL[c]}</span>
              <Money value={totals[c]} class="tnum" tone={false} />
            </legend>
            {group.map((r, i) => {
              const prev = prevOf.get(r.key) ?? null;
              const err = errors[`item-${r.key}`];
              return (
                <div key={r.key} class="bill-row">
                  <label class="sr-only" for={`bn-${r.key}`}>
                    Tên khoản {i + 1} ({CATEGORY_LABEL[c]})
                  </label>
                  <input
                    id={`bn-${r.key}`}
                    class="ctl"
                    maxLength={MAX_ITEM_NAME}
                    placeholder="Tên khoản"
                    value={r.name}
                    autoFocus={added === r.key}
                    aria-invalid={err ? "true" : undefined}
                    onInput={(e) => update(r.key, { name: e.currentTarget.value })}
                  />
                  <button
                    type="button"
                    class="btn btn-ghost bill-sign"
                    aria-pressed={negative.has(r.key)}
                    aria-label={negative.has(r.key) ? `${r.name || "Khoản"}: khoản trừ — bấm để thành khoản cộng` : `${r.name || "Khoản"}: khoản cộng — bấm để thành khoản trừ`}
                    onClick={() => toggleSign(r)}
                  >
                    {negative.has(r.key) ? "−" : "+"}
                  </button>
                  <label class="sr-only" for={`ba-${r.key}`}>
                    Số tiền {r.name || `khoản ${i + 1}`}
                  </label>
                  <AmountInput id={`ba-${r.key}`} value={Math.abs(r.amount)} onChange={(n) => update(r.key, { amount: negative.has(r.key) ? -n : n })} invalid={!!err} />
                  <button type="button" class="btn btn-ghost icon-btn bill-x" aria-label={`Bỏ khoản ${r.name || i + 1}`} onClick={() => remove(r.key)}>
                    <Icon name="x" size={18} />
                  </button>
                  {(prev !== null || needsCheck(bill.status, r.category, r.amount, prev)) && (
                    <div class="bill-sub">
                      {prev !== null && <span>tháng trước {formatVnd(prev)}</span>}
                      {needsCheck(bill.status, r.category, r.amount, prev) && <span class="chip warn">kiểm lại số</span>}
                    </div>
                  )}
                  {err && (
                    <p class="err bill-sub" role="alert">
                      {err}
                    </p>
                  )}
                </div>
              );
            })}
            <button type="button" class="btn btn-ghost bill-add" disabled={rows.length >= MAX_BILL_ITEMS} onClick={() => add(c)}>
              <Icon name="plus" size={16} /> Thêm khoản
            </button>
          </fieldset>
        );
      })}
      {errors.items && (
        <p class="err pad" role="alert">
          {errors.items}
        </p>
      )}
      <div class="field">
        <label for={`b-acct-${bill.id}`}>Tài khoản nhận</label>
        <select id={`b-acct-${bill.id}`} class="ctl" value={account} onChange={(e) => setAccount(e.currentTarget.value)}>
          <option value="">Chưa chọn — tin không có mã QR</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div class="pad flex gap-2" style={{ flexWrap: "wrap" }}>
        {editIssued ? (
          <button type="button" class="btn" disabled={busy} onClick={props.onCancel}>
            Thôi sửa
          </button>
        ) : (
          <>
            <button type="button" class="btn" disabled={!canWrite || !dirty} onClick={() => void saveDraft()}>
              {busy ? "Đang lưu…" : "Lưu nháp"}
            </button>
            <button type="button" class={confirmDelete ? "btn btn-bad" : "btn btn-ghost"} disabled={!canWrite} onClick={() => (confirmDelete ? void deleteDraft() : setConfirmDelete(true))}>
              {confirmDelete ? "Xoá hẳn nháp này" : "Xoá nháp"}
            </button>
          </>
        )}
      </div>
      {!online && (
        <div class="pad" style={{ paddingTop: 0 }}>
          <NeedsNetwork what="Ghi sổ người thuê" />
        </div>
      )}
      <div class="bill-foot">
        <p class="bill-total">{billCompare(view.month, totals.total, view.previous)}</p>
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        {confirmTotal !== null && (
          <div class="bill-confirm" role="alert">
            <p style={{ margin: "0 0 8px" }}>{resendConfirm(view.total, confirmTotal, name)}</p>
            <div class="flex gap-2">
              <button type="button" class="btn btn-primary" disabled={!canWrite} onClick={() => void resend()}>
                {busy ? "Đang lưu…" : "Lưu & gửi lại"}
              </button>
              <button type="button" class="btn" disabled={busy} onClick={() => setConfirmTotal(null)}>
                Thôi
              </button>
            </div>
          </div>
        )}
        {confirmTotal === null &&
          (editIssued ? (
            <button type="button" class="btn btn-primary btn-wide" disabled={!canWrite || !dirty} onClick={askResend}>
              Lưu & gửi lại
            </button>
          ) : (
            <button type="button" class="btn btn-primary btn-wide" disabled={!canWrite} onClick={() => void issue()}>
              {busy ? "Đang chốt…" : "Chốt & gửi"}
            </button>
          ))}
      </div>
    </div>
  );
}

function BillIssued({ view, sent, onEdit }: { view: BillView; sent: Sent; onEdit: () => void }) {
  const { online } = useApp();
  const bill = view.bill!;
  const name = view.tenant.name;
  const text = view.text ?? "";
  const qr = view.qr;
  const resend = needsResend({ id: bill.id, revision: bill.revision, edited: bill.editedAt !== null }, sent.revisions);
  const label = `tin gửi ${name}`;

  async function share() {
    const file = qr && "payload" in qr ? qrPngFile(qr.payload, `${qr.memo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`) : null;
    const data = billShare(typeof navigator === "undefined" ? null : navigator, text, file);
    if (data) {
      try {
        await navigator.share(data);
        sent.mark(bill.id, bill.revision);
        return;
      } catch (err) {
        // Người bấm huỷ bảng chia sẻ: không chép, không đánh dấu đã gửi.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copyText(text, label);
    sent.mark(bill.id, bill.revision);
  }

  async function copy() {
    await copyText(text, label);
    sent.mark(bill.id, bill.revision);
  }

  return (
    <>
      {resend && (
        <div class="pad" style={{ paddingBottom: 0 }}>
          <Banner tone="warn" mark="!">
            Đã sửa sau khi gửi — gửi lại tin cho {name}.
          </Banner>
        </div>
      )}
      <pre class="bill-text pad">{maskAmounts(text)}</pre>
      {qr && <div class="pad">{"payload" in qr ? <TransferQrBlock payload={qr.payload} label={qr.label} memo={qr.memo} /> : <p class="sub-line">{qr.reason}</p>}</div>}
      <div class="pad grid grid-cols-2 gap-2">
        <button type="button" class="btn btn-primary" style={{ whiteSpace: "normal" }} onClick={() => void share()}>
          Gửi cho {name}
        </button>
        <button type="button" class="btn" onClick={() => void copy()}>
          <Icon name="copy" size={15} /> Chép tin
        </button>
      </div>
      {view.payments.map((p) => (
        <button type="button" key={p.transactionId} class="srow" onClick={() => openTx(p.transactionId)}>
          <span class="srow-main">
            <span class="srow-t">
              Đã chuyển {shortDate(p.at)}: {formatVnd(-p.amount)}
            </span>
          </span>
          <span class="srow-r">
            <Icon name="chevron-right" size={16} />
          </span>
        </button>
      ))}
      <p class="pad bill-owed">{owedText(view.balance)}</p>
      <div class="pad" style={{ paddingTop: 0 }}>
        <button type="button" class="btn btn-wide" disabled={!online} onClick={onEdit}>
          Sửa
        </button>
        {!online && <NeedsNetwork what="Ghi sổ người thuê" />}
      </div>
    </>
  );
}
