// Chuyển ngân sách giữa hai ví (kể cả "Bù" ví âm) và Trả nợ từ ví giữ riêng.
// Cả hai đi qua hàng đợi như khoản chi: chuyển ngân sách chỉ đổi số giữa hai ví, không đụng tài khoản nào.

import { useMemo, useState } from "preact/hooks";
import { DEBT_CATEGORY_ID } from "../../../src/domain/system-ids";
import { errorText } from "../lib/api";
import { moveProblem, moveWallets, type MoveDraft } from "../lib/budget";
import { defaultAccountFor, defaultWalletFor, manualAccounts } from "../lib/categories";
import { defaultDebtId, payableDebts, paymentToast } from "../lib/debts";
import { formatVnd } from "../lib/money";
import { atForDay, dayKey } from "../lib/period";
import { withChosen } from "../lib/transactions";
import type { Reserve, TxRow } from "../lib/types";
import { replaceEntry, saveEntry, useApp, viewSnapshot } from "../state/store";
import { AccountSelect, AmountInput, newClientId, WalletSelect } from "../ui/fields";
import { NeedsNetwork, Sheet } from "../ui/parts";

/** `edit`: sửa đúng khoản chuyển ngân sách đó (UC-715) — thay khoản cũ trên server, cần mạng, giữ nguyên giờ ghi. */
export function MoveBudgetSheet({ initial, title = "Chuyển ngân sách", edit, onClose }: { initial: MoveDraft; title?: string; edit?: TxRow; onClose: () => void }) {
  const app = useApp();
  const memberId = app.member?.id ?? null;
  const wallets = app.boot?.wallets ?? [];
  const from = useMemo(
    () => withChosen(moveWallets(wallets, memberId, "from"), initial.fromWalletId, () => wallets.find((w) => w.id === initial.fromWalletId)),
    [wallets, memberId],
  );
  const to = useMemo(() => withChosen(moveWallets(wallets, memberId, "to"), initial.toWalletId, () => wallets.find((w) => w.id === initial.toWalletId)), [wallets, memberId]);
  const [d, setD] = useState<MoveDraft>(initial);
  const [note, setNote] = useState(edit?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snap = viewSnapshot(app);
  const balanceOf = (id: string | null) => {
    const b = snap?.wallets.find((w) => w.id === id)?.balance;
    return b === undefined || b === null ? null : b;
  };
  const problem = moveProblem(d);
  const before = balanceOf(d.fromWalletId);
  // Đang sửa: số dư hiện tại đã trừ khoản cũ — cộng lại để nói đúng "chuyển xong còn bao nhiêu".
  const fromBalance = before !== null && edit?.counter_wallet_id === d.fromWalletId ? before + edit.amount : before;

  async function submit() {
    if (problem) return;
    setBusy(true);
    setError(null);
    const body = {
      meaning: "transfer" as const,
      amount: d.amount,
      at: edit?.at ?? new Date().toISOString(),
      client_id: newClientId(),
      from_wallet_id: d.fromWalletId!,
      wallet_id: d.toWalletId!,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    if (edit) {
      try {
        await replaceEntry(edit.id, body);
        onClose();
      } catch (err) {
        setError(errorText(err));
        setBusy(false);
      }
      return;
    }
    const saved = await saveEntry(body);
    if (saved) onClose();
    else setBusy(false);
  }

  return (
    <Sheet open title={title} onClose={onClose}>
      <div class="field" style={{ borderTop: 0 }}>
        <label for="m-amount">Số tiền</label>
        <AmountInput id="m-amount" value={d.amount} onChange={(amount) => setD({ ...d, amount })} autoFocus={!initial.amount} />
      </div>
      <div class="field">
        <label for="m-from">Từ ví</label>
        <WalletSelect id="m-from" wallets={from} value={d.fromWalletId} onChange={(id) => setD({ ...d, fromWalletId: id || null })} />
      </div>
      {fromBalance !== null && (
        <p class="fhint">
          Ví này còn {formatVnd(fromBalance)}
          {fromBalance < d.amount ? " — chuyển xong sẽ âm." : "."}
        </p>
      )}
      <div class="field">
        <label for="m-to">Sang ví</label>
        <WalletSelect id="m-to" wallets={to} value={d.toWalletId} onChange={(id) => setD({ ...d, toWalletId: id || null })} />
      </div>
      <div class="field">
        <label for="m-note">Ghi chú</label>
        <input id="m-note" class="ctl" maxLength={500} placeholder="không bắt buộc" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        Chỉ đổi số giữa hai ví trong app, tiền không rời tài khoản nào. Ví nằm ở hai tài khoản khác nhau thì chuyển tiền thật bằng "Chuyển nội bộ".
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!!problem || busy || (!!edit && !app.online)} onClick={() => void submit()}>
          {problem ?? (edit ? "Lưu thay đổi" : `Chuyển ${formatVnd(d.amount)}`)}
        </button>
        {edit && !app.online && <NeedsNetwork what="Sửa giao dịch" />}
      </div>
    </Sheet>
  );
}

/**
 * Trả nợ: khoản chi danh mục "Trả nợ" từ ví giữ riêng (Thu cho thuê), gắn vào một khoản trong sổ nợ nếu nhà đã ghi sổ nợ.
 * Mở từ thẻ ví giữ riêng thì có `reserve`; mở từ tab Nợ thì lấy ví mặc định của danh mục Trả nợ.
 * Trả từ tài khoản SePay báo cả tiền ra thì gán ở màn Gán.
 */
export function DebtSheet({ reserve, debtId, onClose }: { reserve?: Reserve; debtId?: string; onClose: () => void }) {
  const app = useApp();
  const { boot, member } = app;
  const memberId = member?.id ?? null;
  const accounts = manualAccounts(boot?.accounts ?? [], "out");
  const category = boot?.categories.find((c) => c.id === DEBT_CATEGORY_ID);
  const walletId = reserve?.walletId ?? (boot && category ? defaultWalletFor(boot, category, memberId)?.id : null) ?? null;
  const wallet = viewSnapshot(app)?.wallets.find((w) => w.id === walletId);
  const walletName = reserve?.name ?? wallet?.name ?? "ví giữ riêng";
  const walletBalance = reserve ? reserve.balance : (wallet?.balance ?? null);
  const debts = payableDebts(boot?.debts);
  const [debt, setDebt] = useState<string | null>(() => defaultDebtId(boot?.debts, debtId));
  const chosen = debts.find((d) => d.id === debt) ?? null;
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(() => (boot ? defaultAccountFor(boot, memberId, "out") : null));
  const [note, setNote] = useState("");
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [busy, setBusy] = useState(false);
  const today = dayKey(new Date());
  const problem = !category
    ? "Chưa có danh mục Trả nợ"
    : !walletId
      ? "Chưa có ví giữ riêng"
      : debts.length > 0 && !chosen
        ? "Chọn khoản nợ"
        : !amount
          ? "Nhập số tiền"
          : !accountId
            ? "Chọn tài khoản"
            : null;

  async function submit() {
    if (problem) return;
    setBusy(true);
    const saved = await saveEntry(
      {
        meaning: "spend",
        amount,
        at: atForDay(day, new Date()),
        client_id: newClientId(),
        category_id: DEBT_CATEGORY_ID,
        wallet_id: walletId!,
        account_id: accountId!,
        ...(chosen ? { debt_id: chosen.id } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      chosen ? paymentToast(amount, chosen) : undefined,
    );
    if (saved) onClose();
    else setBusy(false);
  }

  return (
    <Sheet open title={`Trả nợ từ ${walletName}`} onClose={onClose}>
      {debts.length > 0 && (
        <>
          <div class="field" style={{ borderTop: 0 }}>
            <label for="d-debt">Trả cho khoản nợ</label>
            <select id="d-debt" class="ctl" value={debt ?? ""} onChange={(e) => setDebt(e.currentTarget.value || null)}>
              {!chosen && <option value="">Chọn khoản nợ</option>}
              {debts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          {chosen && (
            <p class="fhint">
              {chosen.name} còn nợ {formatVnd(chosen.balance)}.
            </p>
          )}
        </>
      )}
      <div class="field" style={debts.length > 0 ? undefined : { borderTop: 0 }}>
        <label for="d-amount">Số tiền</label>
        <AmountInput id="d-amount" value={amount} onChange={setAmount} autoFocus />
      </div>
      {walletBalance !== null && (
        <p class="fhint">
          {walletName} còn {formatVnd(walletBalance)}.
        </p>
      )}
      <div class="field">
        <label for="d-acct">Tiền ra từ</label>
        <AccountSelect id="d-acct" accounts={accounts} value={accountId} onChange={setAccountId} />
      </div>
      <div class="field">
        <label for="d-note">{debts.length > 0 ? "Ghi chú" : "Trả cho"}</label>
        <input id="d-note" class="ctl" maxLength={500} placeholder={debts.length > 0 ? "kỳ trả, lãi…" : "khoản nợ nào"} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label for="d-day">Ngày</label>
        <input id="d-day" class="ctl" type="date" max={today} value={day} onInput={(e) => setDay(e.currentTarget.value || today)} />
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        Trả từ tài khoản SePay báo cả tiền ra thì đợi giao dịch về màn Gán, chọn Chi tiêu rồi chọn khoản ở ô Trả nợ cho.
      </div>
      <div class="pad">
        <button type="button" class="btn btn-primary btn-wide" disabled={!!problem || busy} onClick={() => void submit()}>
          {problem ?? `Ghi trả nợ ${formatVnd(amount)}`}
        </button>
      </div>
    </Sheet>
  );
}
