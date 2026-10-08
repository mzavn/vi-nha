// Đếm ví / nhập số dư thật: nhập số tiền đang có → hiện chênh lệch với sổ → xác nhận thì server sinh `adjust`.
// Không sửa đè lịch sử: chênh lệch thành một dòng mới trong sổ.

import { useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import { defaultAccountFor } from "../lib/categories";
import { formatSigned, formatVnd } from "../lib/money";
import type { AccountRow, CountResult } from "../lib/types";
import { useResource } from "../state/resource";
import { refresh, toast, useApp } from "../state/store";
import { AccountSelect, AmountInput } from "../ui/fields";
import { Money } from "../ui/money";
import { NeedsNetwork, Sheet } from "../ui/parts";

export function CountSheet({ accountId: initial, onClose }: { accountId?: string; onClose: () => void }) {
  const { boot, member, online } = useApp();
  const [accountId, setAccountId] = useState<string | null>(initial ?? (boot ? defaultAccountFor(boot, member?.id ?? null, "in") : null));
  const [counted, setCounted] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = useResource<AccountRow[]>(online ? "/v1/accounts" : null);
  const book = rows.data?.find((r) => r.accountId === accountId)?.bookBalance ?? null;
  const diff = counted !== null && book !== null ? counted - book : null;
  const name = boot?.accounts.find((a) => a.id === accountId)?.name ?? "";

  async function submit() {
    if (!accountId || counted === null) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<CountResult>(`/v1/accounts/${encodeURIComponent(accountId)}/count`, { counted });
      toast(r.diff === 0 ? `Đã ghi lần đếm. ${name} khớp sổ.` : `Đã ghi chênh lệch ${formatSigned(r.diff)} ₫. Sổ ${name} giờ là ${formatVnd(r.counted)}.`);
      void refresh();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open title="Đếm ví / nhập số dư thật" onClose={onClose}>
      {boot && (
        <div class="field" style={{ borderTop: 0 }}>
          <label for="c-acct">Tài khoản</label>
          <AccountSelect id="c-acct" accounts={boot.accounts} value={accountId} onChange={setAccountId} />
        </div>
      )}
      <div class="field">
        <span class="k">Sổ đang ghi</span>
        {book !== null ? <Money value={book} class="font-semibold" /> : <span style={{ color: "var(--fg-3)" }}>{online ? (rows.loading ? "đang tải…" : "—") : "cần mạng"}</span>}
      </div>
      <div class="field">
        <label for="c-real">Số tiền thật</label>
        <AmountInput id="c-real" value={counted ?? 0} onChange={(n, valid) => setCounted(valid ? n : null)} autoFocus />
      </div>
      <div class="field">
        <span class="k">Chênh lệch</span>
        {diff === null ? <span style={{ color: "var(--fg-3)" }}>—</span> : <Money value={diff} signed class="font-semibold" />}
      </div>
      <div class="note">
        Thật nhiều hơn sổ thì phần dư cộng vào ví nhận phần còn lại; ít hơn thì trừ ví đó. Sai thì ghi lại lần đếm mới, không sửa đè.
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || counted === null || book === null} onClick={() => void submit()}>
          {busy ? "Đang ghi…" : diff === 0 ? "Ghi lần đếm — khớp sổ" : "Ghi chênh lệch"}
        </button>
        {!online && <NeedsNetwork what="Đếm ví" />}
      </div>
    </Sheet>
  );
}
