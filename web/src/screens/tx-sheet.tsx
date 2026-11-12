// Xem, sửa, xoá một giao dịch (UC-715). Mở từ bất kỳ dòng giao dịch nào trong app (`openTx`), vẽ một lần ở khung app.
// Ghi tay: Sửa (mở đúng form đã dùng để nhập, điền sẵn) và Xoá (hai bước). Ngân hàng: chỉ Gán lại. Hệ thống: chỉ xem.
// Giao dịch cũ: loại chi / lần chia nằm dưới "Theo cách tính cũ", chỉ đọc, không tên ví (UC-715); chuyển chỉ giữa hai ví chỉ xoá.
// Khoản chạm tài khoản riêng tư của người khác: chỉ xem, kèm dòng "chỉ chủ tài khoản sửa được" (UC-715 AC-16).
// Liên kết hai chiều: khoản hoàn tiền / nhận lại có khoản gốc → dòng "Trả cho" (chạm mở khoản gốc); khoản chi / cho vay đã
// được trả về → mục "Đã nhận lại" (tổng, chênh, từng khoản chạm mở). Dữ liệu đi kèm GET /v1/transactions/:id.
// Sửa / xoá ghi thẳng lên server nên cần mạng; khoản chưa lên sổ thì sửa ở hàng đợi màn Nhập (Gửi lại / Bỏ hẳn).

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import { FROM_INTEREST_LABEL, GOAL_CHOICE_LABEL, IS_INTEREST_LABEL } from "../lib/goal-choices";
import { formatVnd, maskAmounts } from "../lib/money";
import { shortDate, timeHM } from "../lib/period";
import { linkOriginText, returnedText } from "../lib/refunds";
import { editForm, isWalletOnlyTransfer, legacyRows, MEANING_LABEL, ORIGIN_LABEL, txActions, txLabel, txOrigin, voidConfirm } from "../lib/transactions";
import type { Bootstrap, TxRow } from "../lib/types";
import { useResource } from "../state/resource";
import { go, openTx, refresh, setState, toast, useApp, voidEntry } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { NeedsNetwork, Sheet } from "../ui/parts";
import { ASSET_KINDS, OtherEntrySheet } from "./other-entry-sheet";

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

  if (!tx) {
    return (
      <Sheet open title="Giao dịch" onClose={close}>
        <p class="note">{res.error ? errorText(res.error) : "Đang tải…"}</p>
      </Sheet>
    );
  }

  if (editing) {
    const form = editForm(tx);
    if (form !== "spend") return <OtherEntrySheet kind={form} amount={tx.amount} edit={tx} onClose={close} />;
  }

  const can = txActions(tx, boot);
  const name = (list: { id: string; name: string }[], wid: string | null | undefined) => (wid ? (list.find((x) => x.id === wid)?.name ?? wid) : null);
  const who = name(boot.members, tx.by_member_id);
  const asset = ASSET_KINDS.find((a) => a.value === tx.asset_kind)?.label ?? tx.asset_kind;
  const rows: [string, ComponentChildren][] = [
    ["Loại", isWalletOnlyTransfer(tx) ? "Chuyển ngân sách" : (MEANING_LABEL[tx.meaning] ?? tx.meaning)],
    ["Số tiền", <Money value={tx.amount} tone={false} />],
    ["Lúc", `${shortDate(tx.at)} · ${timeHM(tx.at)}`],
    ...(tx.category_name ? [["Danh mục", tx.category_name] as [string, string]] : []),
    ...(tx.account_id ? [["Tiền ra từ", name(boot.accounts, tx.account_id)] as [string, string | null]] : []),
    ...(tx.counter_account_id ? [["Tiền vào", name(boot.accounts, tx.counter_account_id)] as [string, string | null]] : []),
    ...(asset ? [["Loại tài sản", asset] as [string, string]] : []),
    ...(tx.debt_id ? [["Trả nợ cho", tx.debt_name ?? tx.debt_id] as [string, string]] : []),
    ...(tx.receivable_id ? [[tx.meaning === "lend" ? "Cho ai vay" : "Ai trả", tx.receivable_name ?? tx.receivable_id] as [string, string]] : []),
    ...(tx.tenant_id ? [["Người thuê trả", tx.tenant_name ?? tx.tenant_id] as [string, string]] : []),
    ...(tx.is_interest ? [["Tiền lãi", IS_INTEREST_LABEL] as [string, string]] : []),
    ...(tx.from_interest ? [[GOAL_CHOICE_LABEL, FROM_INTEREST_LABEL] as [string, string]] : []),
    ...(who ? [["Người ghi", who] as [string, string]] : []),
    ...(tx.note ? [["Ghi chú", maskAmounts(tx.note)] as [string, string]] : []),
    ["Nguồn", ORIGIN_LABEL[txOrigin(tx)]],
  ];
  const legacy = legacyRows(tx);

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

  function edit() {
    if (editForm(tx!) === "spend") go("entry", { txOpen: null, editTx: { tx: tx!, back: app.tab } });
    else setEditing(true);
  }

  const offline = !app.online && (can.edit || can.remove || can.reassign);
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
      {legacy.length > 0 && (
        <>
          <p class="note" style={{ borderTop: "1px solid var(--border)", fontWeight: 550 }}>
            Theo cách tính cũ
          </p>
          {legacy.map(([k, v]) => (
            <div class="srow" key={`legacy-${k}`}>
              <span class="srow-s">{k}</span>
              <span class="srow-v">{v}</span>
            </div>
          ))}
        </>
      )}
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
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        {confirm ? (
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
        {offline && <NeedsNetwork what="Sửa, xoá giao dịch" />}
      </div>
    </Sheet>
  );
}
