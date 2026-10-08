// Xem, sửa, xoá một giao dịch (UC-715). Mở từ bất kỳ dòng giao dịch nào trong app (`openTx`), vẽ một lần ở khung app.
// Ghi tay: Sửa (mở đúng form đã dùng để nhập, điền sẵn) và Xoá (hai bước). Ngân hàng: chỉ Gán lại. Hệ thống: chỉ xem.
// Khoản thu còn hiệu lực chưa chia: thêm Chia (bảng chia thử rồi chia đúng khoản đó).
// Liên kết hai chiều: khoản hoàn tiền / nhận lại có khoản gốc → dòng "Trả cho" (chạm mở khoản gốc); khoản chi / cho vay đã
// được trả về → mục "Đã nhận lại" (tổng, chênh, từng khoản chạm mở). Dữ liệu đi kèm GET /v1/transactions/:id.
// Sửa / xoá / chia ghi thẳng lên server nên cần mạng; khoản chưa lên sổ thì sửa ở hàng đợi màn Nhập (Gửi lại / Bỏ hẳn).

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { ApiError, api, errorText } from "../lib/api";
import { formatVnd } from "../lib/money";
import { ordersLeft } from "../lib/pending";
import { shortDate, timeHM } from "../lib/period";
import { linkOriginText, returnedText } from "../lib/refunds";
import { draftFromTx, editForm, MEANING_LABEL, ORIGIN_LABEL, txActions, txLabel, txOrigin, voidConfirm } from "../lib/transactions";
import type { AllocationPlan, Bootstrap, TxRow } from "../lib/types";
import { useResource } from "../state/resource";
import { getState, go, openTx, refresh, setState, toast, useApp, voidEntry } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { NeedsNetwork, Sheet } from "../ui/parts";
import { MoveBudgetSheet } from "./budget-sheets";
import { AllocationPreview, ASSET_KINDS, OtherEntrySheet } from "./other-entry-sheet";

export function TxSheet() {
  const { txOpen, boot } = useApp();
  if (!txOpen || !boot) return null;
  return <TxSheetBody key={txOpen.id} id={txOpen.id} row={txOpen.row} boot={boot} />;
}

const close = () => setState({ txOpen: null });

function TxSheetBody({ id, row, boot }: { id: number; row?: TxRow; boot: Bootstrap }) {
  const app = useApp();
  // Đọc lại từ server: dòng trong danh sách có thể đã cũ (vừa bị xoá / sửa ở máy kia).
  const res = useResource<TxRow>(app.online ? `/v1/transactions/${id}` : null);
  const tx = res.data ?? row ?? null;
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bảng chia thử của khoản thu chưa chia: mở khi bấm Chia, rồi Chia và ghi sổ. */
  const [plan, setPlan] = useState<AllocationPlan | null>(null);

  if (!tx) {
    return (
      <Sheet open title="Giao dịch" onClose={close}>
        <p class="note">{res.error ? errorText(res.error) : "Đang tải…"}</p>
      </Sheet>
    );
  }

  if (editing) {
    const form = editForm(tx);
    if (form === "move") {
      const d = draftFromTx(tx);
      return <MoveBudgetSheet edit={tx} title="Sửa chuyển ngân sách" initial={{ amount: d.amount, fromWalletId: d.from_wallet_id, toWalletId: d.wallet_id }} onClose={close} />;
    }
    if (form !== "spend") return <OtherEntrySheet kind={form} amount={tx.amount} edit={tx} onClose={close} />;
  }

  const can = txActions(tx);
  const canAllocate = tx.status === "active" && tx.meaning === "income" && !tx.allocated;
  const name = (list: { id: string; name: string }[], wid: string | null | undefined) => (wid ? (list.find((x) => x.id === wid)?.name ?? wid) : null);
  const who = name(boot.members, tx.by_member_id);
  const asset = ASSET_KINDS.find((a) => a.value === tx.asset_kind)?.label ?? tx.asset_kind;
  const rows: [string, ComponentChildren][] = [
    ["Loại", tx.meaning === "transfer" && !tx.account_id && !tx.counter_account_id ? "Chuyển ngân sách" : (MEANING_LABEL[tx.meaning] ?? tx.meaning)],
    ["Số tiền", <Money value={tx.amount} tone={false} />],
    ["Lúc", `${shortDate(tx.at)} · ${timeHM(tx.at)}`],
    ...(tx.category_name ? [["Danh mục", tx.category_name] as [string, string]] : []),
    ...(tx.counter_wallet_id ? [["Trừ ví", name(boot.wallets, tx.counter_wallet_id)] as [string, string | null]] : []),
    ...(tx.wallet_id ? [["Cộng vào ví", name(boot.wallets, tx.wallet_id)] as [string, string | null]] : []),
    ...(tx.account_id ? [["Tiền ra từ", name(boot.accounts, tx.account_id)] as [string, string | null]] : []),
    ...(tx.counter_account_id ? [["Tiền vào", name(boot.accounts, tx.counter_account_id)] as [string, string | null]] : []),
    ...(asset ? [["Loại tài sản", asset] as [string, string]] : []),
    ...(tx.debt_id ? [["Trả nợ cho", tx.debt_name ?? tx.debt_id] as [string, string]] : []),
    ...(tx.receivable_id ? [[tx.meaning === "lend" ? "Cho ai vay" : "Ai trả", tx.receivable_name ?? tx.receivable_id] as [string, string]] : []),
    ...(tx.tenant_id ? [["Người thuê trả", tx.tenant_name ?? tx.tenant_id] as [string, string]] : []),
    ...(tx.meaning === "income" ? [["Lần chia", tx.allocated ? "đã chia vào các ví" : "chưa chia"] as [string, string]] : []),
    ...(who ? [["Người ghi", who] as [string, string]] : []),
    ...(tx.note ? [["Ghi chú", tx.note] as [string, string]] : []),
    ["Nguồn", ORIGIN_LABEL[txOrigin(tx)]],
  ];

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
      setConfirm(false);
    }
  }

  const remove = () =>
    run(async () => {
      await voidEntry(tx);
      close();
    });

  // Gỡ gán: huỷ mọi dòng của log và trả log về chờ gán (ingest UC-306), rồi mở màn Gán đúng log đó.
  const reassign = () =>
    run(async () => {
      await api.post(`/v1/logs/transactions/${tx.id}/void`);
      void refresh();
      toast(`Đã gỡ gán ${formatVnd(tx.amount)}. Chọn lại cách gán cho giao dịch này.`);
      go("assign", { txOpen: null, assignFocus: tx.log_id ?? null });
    });

  // Chia thử đúng như server sẽ chia khoản này (allocateIncome): số tiền, thuế, ngày, tài khoản nhận, nguồn thu của nó.
  const preview = () =>
    run(async () => {
      setPlan(
        await api.post<AllocationPlan>("/v1/allocate/preview", {
          amount: tx.amount,
          taxable: !!tx.taxable,
          at: tx.at,
          account_id: tx.counter_account_id,
          ...(tx.income_stream_id ? { income_stream_id: tx.income_stream_id } : {}),
        }),
      );
      setBusy(false);
    });

  const allocate = () =>
    run(async () => {
      let orders = 0;
      try {
        orders = (await api.post<AllocationPlan>("/v1/allocate", { income_tx_id: tx.id })).transferOrders.length;
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "already_allocated")) throw err;
      }
      // Như Loại khác: tải lại số rồi nói tổng lệnh chuyển tiền đang chờ.
      await refresh();
      const after = getState();
      const tail = ordersLeft(orders, after.stale || !after.snap ? null : after.snap.attention.transferOrdersPending);
      toast(`Đã chia ${formatVnd(tx.amount)}.${tail ? ` ${tail}` : ""}`);
      close();
    });

  function edit() {
    if (editForm(tx!) === "spend") go("entry", { txOpen: null, editTx: { tx: tx!, back: app.tab } });
    else setEditing(true);
  }

  const offline = !app.online && (can.edit || can.remove || can.reassign || canAllocate);
  const linkedFrom = tx.meaning === "spend" || tx.meaning === "lend" ? (tx.linked_from ?? []) : [];
  return (
    <Sheet open title={txLabel(tx)} onClose={close}>
      {tx.status !== "active" && (
        <p class="pad" style={{ margin: 0 }}>
          <span class="chip">đã xoá</span>
        </p>
      )}
      {rows.map(([k, v]) => (
        <div class="srow" key={k}>
          <span class="srow-s">{k}</span>
          <span class="srow-v">{v}</span>
        </div>
      ))}
      {tx.link && (
        <button type="button" class="srow" onClick={() => openTx(tx.link!.id)}>
          <span class="srow-s" style={{ flex: "none" }}>
            Trả cho
          </span>
          {/* Chữ dài (khoản gốc đã xoá) xuống dòng ở bên phải, không ép nhãn thành cột dọc. */}
          <span class="srow-r" style={{ flex: "0 1 auto", minWidth: 0 }}>
            <span class="srow-v">{linkOriginText(tx.link)}</span>
            <Icon name="chevron-right" size={16} />
          </span>
        </button>
      )}
      {linkedFrom.length > 0 && (
        <>
          <div class="srow">
            <span class="srow-s">Đã nhận lại</span>
            <span class="srow-v">{returnedText(tx.amount, linkedFrom)}</span>
          </div>
          {linkedFrom.map((l) => (
            <button type="button" class="srow" key={l.id} onClick={() => openTx(l.id)}>
              <span class="srow-s">
                {shortDate(l.at)} · {MEANING_LABEL[l.meaning] ?? l.meaning}
              </span>
              <span class="srow-r">
                <span class="srow-v">{formatVnd(l.amount)}</span>
                <Icon name="chevron-right" size={16} />
              </span>
            </button>
          ))}
        </>
      )}
      {can.note && <p class="note" style={{ borderTop: "1px solid var(--border)" }}>{can.note}</p>}
      {plan && <AllocationPreview plan={plan} boot={boot} amount={tx.amount} />}
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        {plan ? (
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn" disabled={busy} onClick={() => setPlan(null)}>
              Thôi
            </button>
            <button type="button" class="btn btn-primary" disabled={busy || !app.online} onClick={() => void allocate()}>
              {busy ? "Đang chia…" : "Chia và ghi sổ"}
            </button>
          </div>
        ) : confirm ? (
          <>
            <p style={{ margin: "0 0 8px", fontWeight: 550 }}>{voidConfirm(tx)}</p>
            <div class="grid grid-cols-2 gap-2">
              <button type="button" class="btn" disabled={busy} onClick={() => setConfirm(false)}>
                Thôi
              </button>
              <button type="button" class="btn btn-bad" disabled={busy || !app.online} onClick={() => void remove()}>
                {busy ? "Đang xoá…" : "Xoá hẳn"}
              </button>
            </div>
          </>
        ) : (
          <div class="grid grid-cols-2 gap-2">
            {canAllocate && (
              <button type="button" class="btn btn-primary" style={{ gridColumn: "1 / -1" }} disabled={busy || !app.online} onClick={() => void preview()}>
                Chia
              </button>
            )}
            {can.edit && (
              <button type="button" class="btn btn-primary" disabled={busy || !app.online} onClick={edit}>
                Sửa
              </button>
            )}
            {can.remove && (
              <button type="button" class="btn" disabled={busy || !app.online} onClick={() => setConfirm(true)}>
                Xoá
              </button>
            )}
            {can.reassign && (
              <button type="button" class="btn btn-primary" style={{ gridColumn: "1 / -1" }} disabled={busy || !app.online} onClick={() => void reassign()}>
                {busy ? "Đang gỡ gán…" : "Gán lại"}
              </button>
            )}
          </div>
        )}
        {offline && <NeedsNetwork what={canAllocate ? "Chia, sửa, xoá giao dịch" : "Sửa, xoá giao dịch"} />}
      </div>
    </Sheet>
  );
}
