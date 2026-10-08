// Người thuê (Ví & Quỹ › Người thuê): sổ phải thu, nằm ngoài sổ cái — không đụng ví nào.
// Mỗi tuần ngồi với người thuê xem tạm tính; cuối tháng bấm Chốt tháng; copy bảng kê gửi họ.
// Số dư dương = người thuê còn nợ; âm = đã trả dư, tự trừ vào tháng sau. Mọi việc ghi cần mạng.

import { useState } from "preact/hooks";
import { ApiError, api, errorText } from "../lib/api";
import { formatVnd } from "../lib/money";
import { monthKey, monthLabel, nextMonth, previousMonth, shortDate } from "../lib/period";
import {
  balanceText,
  draftLines,
  type LineForm,
  linePayload,
  type ManualLineKind,
  type SettleLine,
  settlePayload,
  settleTotal,
  withHeadcount,
} from "../lib/rental";
import type { Rental, Tenant, TenantLine, TenantLineKind, TenantMonth } from "../lib/types";
import { useResource } from "../state/resource";
import { go, openTx, refresh, toast, useApp } from "../state/store";
import { copyText } from "../ui/clipboard";
import { AmountInput, newClientId } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, Empty, Loadable, NeedsNetwork, Seg, Sheet } from "../ui/parts";

const KIND_LABEL: Record<TenantLineKind, string> = {
  opening: "Số dư mở sổ",
  fixed: "Phí cố định",
  shared: "Chi chung",
  one_off: "Phí một lần",
  paid_for_us: "Đã chi hộ",
  adjust: "Chỉnh",
};

export function TenantsTab() {
  const res = useResource<Rental>("/v1/rental");
  const [sel, setSel] = useState<string | null>(null);
  return (
    <Loadable res={res}>
      {(rental) => {
        // Người đã ra vẫn hiện tới khi số dư về 0.
        const shown = rental.tenants.filter((t) => t.active || t.balance !== 0);
        if (shown.length === 0) {
          return (
            <Card>
              <Empty title="Chưa có người thuê.">
                Thêm người thuê, phí cố định và danh mục chi chung ở Cài đặt › Cho thuê.
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
            <Card title="Người thuê" flush note="Số đã ghi sổ, chưa gồm tạm tính của tháng chưa chốt. Còn nợ là người thuê phải trả thêm; trả dư thì tự trừ vào tháng sau.">
              {shown.map((t) => (
                <button type="button" key={t.id} class="srow" aria-current={t.id === current.id ? "true" : undefined} onClick={() => setSel(t.id)}>
                  <span class="srow-main">
                    <span class="srow-t">
                      {t.name} {!t.active && <span class="chip">đã ra</span>}
                    </span>
                    <span class="srow-s">{balanceText(t.balance)}</span>
                  </span>
                  <span class="srow-r">
                    <Money value={t.balance} class="srow-amt" tone={false} />
                    <Icon name="chevron-right" size={16} />
                  </span>
                </button>
              ))}
            </Card>
            <TenantMonthCard key={current.id} tenant={current} rental={rental} onChanged={res.reload} />
          </>
        );
      }}
    </Loadable>
  );
}

type Open = { kind: "line"; line: ManualLineKind } | { kind: "settle"; month: TenantMonth } | null;

function TenantMonthCard({ tenant, rental, onChanged }: { tenant: Tenant; rental: Rental; onChanged: () => void }) {
  const { online } = useApp();
  const thisMonth = monthKey(new Date());
  const [month, setMonth] = useState(thisMonth);
  const res = useResource<TenantMonth>(`/v1/rental/tenants/${encodeURIComponent(tenant.id)}/month?month=${month}`);
  const [open, setOpen] = useState<Open>(null);
  const [confirmVoid, setConfirmVoid] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const changed = (text: string) => {
    toast(text);
    res.reload();
    onChanged();
  };

  async function voidLine(l: TenantLine) {
    setBusy(true);
    try {
      await api.post(`/v1/rental/lines/${l.id}/void`);
      changed(`Đã huỷ dòng ${l.name ?? KIND_LABEL[l.kind]}.`);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
      setConfirmVoid(null);
    }
  }

  const nav = (
    <span class="flex items-center gap-2">
      <button type="button" class="btn btn-ghost icon-btn" aria-label="Tháng trước" onClick={() => setMonth(previousMonth(month))}>
        ‹
      </button>
      <button type="button" class="btn btn-ghost icon-btn" aria-label="Tháng sau" disabled={month >= thisMonth} onClick={() => setMonth(nextMonth(month))}>
        ›
      </button>
    </span>
  );

  return (
    <Card title={`${tenant.name} · ${monthLabel(month)}`} right={nav} flush>
      <Loadable res={res}>
        {(m) => {
          return (
            <>
              <div class="table-wrap">
                <table class="data">
                  <thead>
                    <tr>
                      <th scope="col">Khoản</th>
                      <th scope="col">Số tiền ₫</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        Số dư đầu tháng
                        {m.openingBalance !== 0 && <div class="sub-line">{balanceText(m.openingBalance)}</div>}
                      </td>
                      <td class="num">
                        <Money value={m.openingBalance} unit={false} mono tone={false} />
                      </td>
                    </tr>
                    <tr class="group">
                      <td colSpan={2}>{m.settled ? "Đã chốt tháng này" : "Tạm tính — chưa chốt"}</td>
                    </tr>
                    {!m.settled &&
                      m.draft.map((d, i) => (
                        <tr key={`d${i}`}>
                          <td>
                            {d.name}
                            {d.kind === "shared" && (
                              <div class="sub-line">
                                chi chung {formatVnd(m.sharedTotal)} ÷ {m.headcount} người
                              </div>
                            )}
                          </td>
                          <td class="num">
                            <Money value={d.amount} unit={false} mono />
                          </td>
                        </tr>
                      ))}
                    {m.settled && (
                      <tr>
                        <td colSpan={2} class="sub-line">
                          Chi chung {formatVnd(m.sharedTotal)} ÷ {m.headcount} người = {formatVnd(m.share)}. Muốn sửa thì huỷ dòng rồi ghi Chỉnh.
                        </td>
                      </tr>
                    )}
                    {m.lines.length > 0 && (
                      <tr class="group">
                        <td colSpan={2}>Đã ghi trong tháng</td>
                      </tr>
                    )}
                    {m.lines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.name ?? KIND_LABEL[l.kind]}
                          <div class="sub-line">{[l.name ? KIND_LABEL[l.kind] : null, l.at ? shortDate(l.at) : null].filter(Boolean).join(" · ")}</div>
                          {online && (
                            <button
                              type="button"
                              class={confirmVoid === l.id ? "btn btn-bad" : "link"}
                              style={{ fontSize: "12.5px" }}
                              disabled={busy}
                              onClick={() => (confirmVoid === l.id ? void voidLine(l) : setConfirmVoid(l.id))}
                            >
                              {confirmVoid === l.id ? "Huỷ hẳn dòng này" : "Huỷ dòng"}
                            </button>
                          )}
                        </td>
                        <td class="num">
                          <Money value={l.amount} unit={false} mono signed tone={false} />
                        </td>
                      </tr>
                    ))}
                    {m.payments.length > 0 && (
                      <tr class="group">
                        <td colSpan={2}>Đã chuyển</td>
                      </tr>
                    )}
                    {m.payments.map((p) => (
                      <tr key={`p${p.transactionId}`} class="tx-row" onClick={() => openTx(p.transactionId)}>
                        <td>
                          <button type="button" class="tx-open">
                            Ngày {shortDate(p.at)}
                          </button>
                        </td>
                        <td class="num">
                          <Money value={-p.amount} unit={false} mono signed tone={false} />
                        </td>
                      </tr>
                    ))}
                    <tr class="total">
                      <td>
                        {m.settled ? "Cuối tháng" : "Nếu chốt hôm nay"}
                        <div class="sub-line">{balanceText(m.closingBalance)}</div>
                      </td>
                      <td class="num">
                        <Money value={m.closingBalance} unit={false} mono tone={false} />
                      </td>
                    </tr>
                    {m.month !== thisMonth && (
                      <tr>
                        <td>
                          Số dư hôm nay
                          <div class="sub-line">{balanceText(m.balance)}</div>
                        </td>
                        <td class="num">
                          <Money value={m.balance} unit={false} mono tone={false} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div class="pad grid grid-cols-2 gap-2">
                <button type="button" class="btn" style={{ whiteSpace: "normal", textAlign: "center" }} disabled={!online} onClick={() => setOpen({ kind: "line", line: "paid_for_us" })}>
                  Ghi {tenant.name} chi
                </button>
                <button type="button" class="btn" disabled={!online} onClick={() => setOpen({ kind: "line", line: "one_off" })}>
                  Phí một lần
                </button>
                <button type="button" class="btn" disabled={!online} onClick={() => setOpen({ kind: "line", line: "adjust" })}>
                  Chỉnh
                </button>
                <button type="button" class="btn" onClick={() => void copyText(m.text, "bảng kê")}>
                  <Icon name="copy" size={15} /> Chép bảng kê
                </button>
                {!m.settled && (
                  <button
                    type="button"
                    class="btn btn-primary"
                    style={{ gridColumn: "1 / -1" }}
                    disabled={!online || m.month > thisMonth}
                    onClick={() => setOpen({ kind: "settle", month: m })}
                  >
                    Chốt {monthLabel(m.month)}
                  </button>
                )}
              </div>
              {!online && (
                <div class="pad" style={{ paddingTop: 0 }}>
                  <NeedsNetwork what="Ghi sổ người thuê" />
                </div>
              )}
            </>
          );
        }}
      </Loadable>
      {open?.kind === "line" && <LineSheet tenant={tenant} rental={rental} kind={open.line} month={month} onClose={() => setOpen(null)} onSaved={changed} />}
      {open?.kind === "settle" && <SettleSheet tenant={tenant} m={open.month} onClose={() => setOpen(null)} onSaved={changed} />}
    </Card>
  );
}

const LINE_TITLE: Record<ManualLineKind, (name: string) => string> = {
  paid_for_us: (n) => `${n} chi hộ`,
  one_off: () => "Phí một lần",
  adjust: () => "Chỉnh số dư",
};

/** Ngày ghi dòng: tháng đang xem là tháng này thì hôm nay, tháng trước thì ngày cuối tháng đó. */
function atForMonth(month: string): string {
  const now = new Date();
  if (month === monthKey(now)) return now.toISOString();
  return new Date(Date.parse(`${nextMonth(month)}-01T12:00:00+07:00`) - 86_400_000).toISOString();
}

/** Ghi một dòng tay vào sổ người thuê: chi hộ (giảm nợ), phí một lần (tăng nợ), chỉnh (±). */
export function LineSheet(props: { tenant: Tenant; rental: Rental; kind: ManualLineKind; month?: string; onClose: () => void; onSaved: (text: string) => void }) {
  const { boot, online } = useApp();
  const [f, setF] = useState<LineForm>({ kind: props.kind, amount: 0, sign: 1, name: "", category_id: props.rental.sharedCategoryIds[0] ?? "" });
  const [clientId] = useState(newClientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = (boot?.categories ?? []).filter((c) => props.rental.sharedCategoryIds.includes(c.id));
  const set = (patch: Partial<LineForm>) => setF((x) => ({ ...x, ...patch }));

  async function submit() {
    const r = linePayload(f, props.rental.sharedCategoryIds);
    if (!r.ok) return setError(Object.values(r.errors)[0] ?? null);
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/rental/tenants/${encodeURIComponent(props.tenant.id)}/lines`, { ...r.value, at: atForMonth(props.month ?? monthKey(new Date())), client_id: clientId });
      props.onSaved(
        f.kind === "paid_for_us"
          ? `Đã ghi ${props.tenant.name} chi ${formatVnd(f.amount)}.`
          : f.kind === "one_off"
            ? `Đã ghi phí ${formatVnd(f.amount)} cho ${props.tenant.name}.`
            : `Đã chỉnh ${f.sign > 0 ? "tăng" : "giảm"} ${formatVnd(f.amount)}.`,
      );
      props.onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open title={LINE_TITLE[f.kind](props.tenant.name)} onClose={props.onClose}>
      {f.kind === "adjust" && (
        <Seg
          class="pad"
          label="Chiều chỉnh"
          value={f.sign > 0 ? "up" : "down"}
          onChange={(v) => set({ sign: v === "up" ? 1 : -1 })}
          options={[
            { value: "up", label: "Tăng nợ" },
            { value: "down", label: "Giảm nợ" },
          ]}
        />
      )}
      <div class="field" style={f.kind === "adjust" ? undefined : { borderTop: 0 }}>
        <label for="l-amount">Số tiền</label>
        <AmountInput id="l-amount" value={f.amount} onChange={(amount) => set({ amount })} autoFocus />
      </div>
      {f.kind === "paid_for_us" && (
        <div class="field">
          <label for="l-cat">Chi cho</label>
          <select id="l-cat" class="ctl" value={f.category_id} onChange={(e) => set({ category_id: e.currentTarget.value })}>
            {shared.length === 0 && <option value="">Chưa có danh mục chi chung</option>}
            {shared.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div class="field">
        <label for="l-name">{f.kind === "paid_for_us" ? "Ghi chú" : f.kind === "one_off" ? "Tên khoản" : "Lý do"}</label>
        <input
          id="l-name"
          class="ctl"
          maxLength={120}
          placeholder={f.kind === "paid_for_us" ? "đi chợ" : f.kind === "one_off" ? "thẻ xe" : "ra giữa tháng"}
          value={f.name}
          onInput={(e) => set({ name: e.currentTarget.value })}
        />
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        {f.kind === "paid_for_us" && "Người thuê tự trả bằng tiền của mình một khoản chi chung: cộng vào tổng chi chung tháng này và trừ vào nợ của họ."}
        {f.kind === "one_off" && "Khoản thu một lần, cộng vào nợ của người thuê."}
        {f.kind === "adjust" && "Sổ chỉ ghi thêm: sai thì huỷ dòng hoặc ghi một dòng chỉnh."}
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || !f.amount} onClick={() => void submit()}>
          {busy ? "Đang ghi…" : f.amount ? `Ghi ${formatVnd(f.amount)}` : "Nhập số tiền"}
        </button>
        {!online && <NeedsNetwork what="Ghi sổ người thuê" />}
      </div>
    </Sheet>
  );
}

let lineSeq = 1000;

function SettleSheet({ tenant, m, onClose, onSaved }: { tenant: Tenant; m: TenantMonth; onClose: () => void; onSaved: (text: string) => void }) {
  const { online } = useApp();
  const [headcount, setHeadcount] = useState(String(m.headcount));
  const [lines, setLines] = useState<SettleLine[]>(() => draftLines(m));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (key: number, patch: Partial<SettleLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = settleTotal(lines);

  function changeHeadcount(text: string) {
    setHeadcount(text);
    const n = Number(text);
    if (/^\d+$/.test(text.trim()) && n >= 1) setLines((ls) => withHeadcount(ls, m.sharedTotal, n));
  }

  async function submit() {
    const r = settlePayload(m.month, headcount, lines);
    if (!r.ok) return setError(Object.values(r.errors)[0] ?? null);
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/rental/tenants/${encodeURIComponent(tenant.id)}/settle`, r.value);
      onSaved(`Đã chốt ${monthLabel(m.month)} với ${tenant.name}: ${formatVnd(total)}.`);
      void refresh();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "already_settled" ? `${monthLabel(m.month)} đã chốt rồi. Muốn sửa thì huỷ dòng rồi ghi Chỉnh.` : errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open title={`Chốt ${monthLabel(m.month)} · ${tenant.name}`} onClose={onClose}>
      <div class="field" style={{ borderTop: 0 }}>
        <label for="s-head">Số người chia</label>
        <input id="s-head" class="ctl money" inputMode="numeric" pattern="[0-9]*" autocomplete="off" value={headcount} onInput={(e) => changeHeadcount(e.currentTarget.value)} />
      </div>
      <p class="fhint">Tổng chi chung {formatVnd(m.sharedTotal)}; đổi số người thì phần chi chung tính lại, phần lẻ hộ chịu.</p>
      {/* Một dòng một hàng: tên · số tiền · bỏ — năm phí vừa một màn, không phải cuộn hai màn (audit 261001 F14). */}
      <div class="settle-head" aria-hidden="true">
        <span>Khoản</span>
        <span>Số tiền</span>
        <span />
      </div>
      {lines.map((l, i) => (
        <fieldset key={l.key} class="settle-row">
          <legend class="sr-only">
            Dòng {i + 1}: {KIND_LABEL[l.kind]}
          </legend>
          <label class="sr-only" for={`s-name-${l.key}`}>
            Tên dòng {i + 1} ({KIND_LABEL[l.kind]})
          </label>
          <input id={`s-name-${l.key}`} class="ctl" maxLength={120} placeholder={KIND_LABEL[l.kind]} value={l.name} onInput={(e) => update(l.key, { name: e.currentTarget.value })} />
          <label class="sr-only" for={`s-amt-${l.key}`}>
            Số tiền dòng {i + 1}
          </label>
          <AmountInput id={`s-amt-${l.key}`} value={Math.abs(l.amount)} onChange={(n) => update(l.key, { amount: l.amount < 0 ? -n : n })} invalid={!l.amount} />
          <button type="button" class="btn btn-ghost icon-btn" aria-label={`Bỏ dòng ${l.name || i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
            <Icon name="x" size={18} />
          </button>
          {l.kind === "adjust" && (
            <Seg
              class="settle-dir"
              label={`Chiều chỉnh dòng ${i + 1}`}
              value={l.amount < 0 ? "down" : "up"}
              onChange={(v) => update(l.key, { amount: (v === "down" ? -1 : 1) * Math.abs(l.amount) })}
              options={[
                { value: "up", label: "Tăng nợ" },
                { value: "down", label: "Giảm nợ" },
              ]}
            />
          )}
        </fieldset>
      ))}
      <div class="field">
        <button type="button" class="btn" onClick={() => setLines((ls) => [...ls, { key: ++lineSeq, kind: "adjust", name: "", amount: 0 }])}>
          <Icon name="plus" size={16} /> Thêm dòng chỉnh
        </button>
      </div>
      <div class="settle-foot">
        <div class="flex justify-between items-baseline gap-2">
          <span>Phải trả tháng này</span>
          <Money value={total} class="font-semibold" />
        </div>
        <p class="sub-line" style={{ margin: "2px 0 0" }}>
          Sau khi chốt: {balanceText(m.balance + total)}.
        </p>
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy} onClick={() => void submit()}>
          {busy ? "Đang chốt…" : `Chốt ${monthLabel(m.month)}`}
        </button>
        {!online && <NeedsNetwork what="Chốt tháng" />}
      </div>
    </Sheet>
  );
}
