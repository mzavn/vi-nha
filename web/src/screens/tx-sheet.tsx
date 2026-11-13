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
import { canUndoVoid, splitsFromTxs, TOAST_UNDO_DONE } from "../lib/undo";
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
      const res = await api.post<{ voided: number[]; logs: string[] }>(`/v1/logs/transactions/${tx.id}/void`);
      void refresh();
      const logId = tx.log_id ?? res.logs[0];
      const wasManual = tx.source === "manual";
      const isPair = Boolean(tx.log_id && tx.log_id_2);
      let voidedTxs: TxRow[] = [];
      if (!wasManual && !isPair && res.voided && res.voided.length > 0) {
        try {
          const list = await Promise.all(
            res.voided.map((vid) => (vid === tx.id ? Promise.resolve(tx) : api.get<TxRow>(`/v1/transactions/${vid}`))),
          );
          voidedTxs = list.filter(Boolean);
        } catch {
          voidedTxs = [tx];
        }
      }

      toast(`Đã gỡ gán ${formatVnd(tx.amount)}. Chọn lại cách gán cho giao dịch này.`, {
        label: "Hoàn tác",
        run: async () => {
          try {
            if (wasManual && logId) {
              // Khoản tay chỉ được tách log khi gỡ: nối lại đủ cả hai chân (nếu có).
              for (const l of [tx.log_id, tx.log_id_2].filter((x): x is string => !!x)) {
                await api.post(`/v1/logs/${encodeURIComponent(l)}/link`, { transaction_id: tx.id });
              }
            } else if (isPair && tx.log_id && tx.log_id_2) {
              await api.post("/v1/logs/pair", { log_a: tx.log_id, log_b: tx.log_id_2 });
            } else if (logId) {
              // Đầu kia của chuyển khoản tính theo tài khoản của chính log (tiền vào: log nằm ở counter_account_id).
              const logs = await api.get<{ id: string; account_id: string | null }[]>("/v1/logs?status=pending&limit=200", true);
              const logAccount = logs.find((l) => l.id === logId)?.account_id ?? null;
              const splits = splitsFromTxs(voidedTxs.length > 0 ? voidedTxs : [tx], logAccount);
              await api.post(`/v1/logs/${encodeURIComponent(logId)}/assign`, { splits });
            }
            await refresh();
            toast(TOAST_UNDO_DONE);
          } catch (err: any) {
            toast(errorText(err));
          }
        },
      });
      go("assign", { txOpen: null, assignFocus: logId ?? null });
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
        <p class="pad txs-flat">
          <span class="chip">đã xoá</span>
        </p>
      )}
      {rows.map(([k, v]) => (
        <div class="srow" key={k}>
          <span class="srow-s">{k}</span>
          <span class="srow-v">{v}</span>
        </div>
      ))}
      {tx.rule_id != null && (
        <div class="srow">
          <span class="srow-s">Tự gán</span>
          <span class="srow-r">
            <span class="srow-v">
              {tx.rule
                ? `Tự gán theo mẫu “${tx.rule.pattern}”${tx.rule.active ? "" : " (đã tắt)"}`
                : tx.rule === null
                  ? "Tự gán theo một mẫu đã xoá"
                  : "Tự gán theo mẫu"}
            </span>
            {tx.rule && (
              <button
                type="button"
                class="link txs-link"
                onClick={() => {
                  close();
                  go("settings", { settingsFocus: "transfer-codes" });
                }}
              >
                Sửa mẫu ›
              </button>
            )}
          </span>
        </div>
      )}
      {legacy.length > 0 && (
        <>
          <p class="note txs-sec">
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
          <span class="srow-s txs-k">
            Trả cho
          </span>
          {/* Chữ dài (khoản gốc đã xoá) xuống dòng ở bên phải, không ép nhãn thành cột dọc. */}
          <span class="srow-r txs-r">
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
      {can.note && <p class="note txs-line">{can.note}</p>}
      <div class={can.edit || can.remove || can.reassign || error ? "sheet-foot" : "pad"}>
        {error && (
          <p class="err txs-err" role="alert">
            {error}
          </p>
        )}
        {confirm ? (
          <>
            <p class="txs-confirm">{voidConfirm(tx)}</p>
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
          <div class="txs-act">
            {can.edit && (
              <button type="button" class="btn btn-primary btn-wide" disabled={busy || !app.online} onClick={edit}>
                Sửa
              </button>
            )}
            {can.remove && (
              <button
                type="button"
                class="btn btn-bad btn-wide"
                disabled={busy || !app.online}
                onClick={() => {
                  if (canUndoVoid(tx)) {
                    void remove();
                  } else {
                    setConfirm(true);
                  }
                }}
              >
                Xoá
              </button>
            )}
            {can.reassign && (
              <button type="button" class="btn btn-primary btn-wide" disabled={busy || !app.online} onClick={() => void reassign()}>
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
