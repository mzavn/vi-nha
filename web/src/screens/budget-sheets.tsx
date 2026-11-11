// Trả nợ (debt UC-902): khoản chi danh mục "Trả nợ", đi qua hàng đợi như khoản chi. Không ví (Đợt C). Trả bằng tiền của mục
// tiêu Trả nợ thì chọn tài khoản của mục tiêu ở ô "Tiền ra từ" (ADR-132).

import { useState } from "preact/hooks";
import { DEBT_CATEGORY_ID } from "../../../src/domain/system-ids";
import { defaultAccountFor, manualAccounts } from "../lib/categories";
import { defaultDebtId, payableDebts, paymentToast } from "../lib/debts";
import { debtPaymentEntries, hasInterest, prefillSplit, splitOf, splitPaymentToast, withAmount, withInterest, withPrincipal, type SplitDraft } from "../lib/interest";
import { formatTypedVnd, formatVnd } from "../lib/money";
import { atForDay, dayKey } from "../lib/period";
import { saveEntry, useApp } from "../state/store";
import { AccountSelect, AmountInput, newClientId } from "../ui/fields";
import { Sheet } from "../ui/parts";

/**
 * Trả nợ: khoản chi danh mục "Trả nợ", gắn vào một khoản trong sổ nợ nếu nhà đã ghi sổ nợ.
 * Khoản có lãi (debt UC-902): thêm hai ô Tiền lãi / Tiền gốc; lưu thành hai khoản chi — lãi là chi phí, gốc giảm nợ.
 * Trả từ tài khoản SePay báo cả tiền ra thì gán ở màn Gán.
 */
export function DebtSheet({ debtId, onClose }: { debtId?: string; onClose: () => void }) {
  const app = useApp();
  const { boot, member } = app;
  const memberId = member?.id ?? null;
  const accounts = manualAccounts(boot?.accounts ?? [], "out");
  const category = boot?.categories.find((c) => c.id === DEBT_CATEGORY_ID);
  const debts = payableDebts(boot?.debts);
  const [debt, setDebt] = useState<string | null>(() => defaultDebtId(boot?.debts, debtId));
  const chosen = debts.find((d) => d.id === debt) ?? null;
  const [draft, setDraft] = useState<SplitDraft>(() => (chosen ? prefillSplit(chosen) : { amount: 0, interest: 0 }));
  const amount = draft.amount;
  const withSplit = !!chosen && hasInterest(chosen);
  const split = splitOf(withSplit ? draft : { amount, interest: 0 });
  const [accountId, setAccountId] = useState<string | null>(() => (boot ? defaultAccountFor(boot, memberId, "out") : null));
  const [note, setNote] = useState("");
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [busy, setBusy] = useState(false);
  const today = dayKey(new Date());
  const problem = !category ? "Chưa có danh mục Trả nợ" : debts.length > 0 && !chosen ? "Chọn khoản nợ" : !amount ? "Nhập số tiền" : !accountId ? "Chọn tài khoản" : null;

  async function submit() {
    if (problem) return;
    setBusy(true);
    const entries = debtPaymentEntries({
      split,
      debtId: chosen?.id ?? null,
      at: atForDay(day, new Date()),
      accountId: accountId!,
      note,
      newId: newClientId,
    });
    // Mỗi khoản một lần ghi qua hàng đợi; toast của khoản cuối nói cả lần trả.
    const text = chosen ? (withSplit ? splitPaymentToast(split, chosen) : paymentToast(amount, chosen)) : undefined;
    let saved = true;
    for (const [i, body] of entries.entries()) saved = (await saveEntry(body, i === entries.length - 1 ? text : undefined)) && saved;
    if (saved) onClose();
    else setBusy(false);
  }

  const pickDebt = (id: string | null) => {
    setDebt(id);
    const next = debts.find((d) => d.id === id);
    setDraft(next && hasInterest(next) ? prefillSplit(next) : { amount, interest: 0 });
  };

  return (
    <Sheet open title="Trả nợ" onClose={onClose}>
      {debts.length > 0 && (
        <>
          <div class="field" style={{ borderTop: 0 }}>
            <label for="d-debt">Trả cho khoản nợ</label>
            <select id="d-debt" class="ctl" value={debt ?? ""} onChange={(e) => pickDebt(e.currentTarget.value || null)}>
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
        <AmountInput id="d-amount" value={amount} onChange={(n) => setDraft((d) => withAmount(d, n))} autoFocus />
      </div>
      {withSplit && (
        <>
          <div class="field">
            <label for="d-interest">Tiền lãi</label>
            <AmountInput id="d-interest" value={split.interest} onChange={(n) => setDraft((d) => withInterest(d, n))} />
          </div>
          <div class="field">
            <label for="d-principal">Tiền gốc</label>
            <AmountInput id="d-principal" value={split.principal} onChange={(n) => setDraft((d) => withPrincipal(d, n))} />
          </div>
          <p class="fhint">Lãi là chi phí của kỳ, gốc làm giảm nợ.</p>
        </>
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
          {problem ?? `Ghi trả nợ ${formatTypedVnd(amount)}`}
        </button>
      </div>
    </Sheet>
  );
}
