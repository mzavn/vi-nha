// "Loại khác": thu nhập · chi tiêu · hoàn tiền · mua tài sản · cho vay · nhận lại tiền cho vay ·
// chuyển nội bộ (pwa UC-705, Đợt C — không ví, không chia). Mọi loại đi qua hàng đợi như khoản chi.
// Có `edit`: cùng form, điền sẵn từ một khoản đã lên sổ; lưu là thay khoản đó (POST /v1/transactions/:id/replace, UC-715) nên cần mạng.

import { useEffect, useMemo, useState } from "preact/hooks";
import { errorText } from "../lib/api";
import { defaultAccountFor, defaultBankFor, manualAccounts } from "../lib/categories";
import { goalChoices, goalField } from "../lib/goal-choices";
import { formatTypedVnd } from "../lib/money";
import { incomeBody, opensCycleDefault, queuedBody, queuedMissing, type QueuedKind } from "../lib/other-entry";
import { atForDay, dayKey } from "../lib/period";
import { tenantAccountBlock } from "../lib/rental";
import { collectToast, defaultReceivableId, lendToast } from "../lib/receivables";
import { draftFromTx, editedAt, MEANING_LABEL, withChosen, type TxDraft } from "../lib/transactions";
import type { Bootstrap, Rental, SettingsData, TxRow } from "../lib/types";
import { useResource } from "../state/resource";
import { replaceEntry, saveEntry, useApp } from "../state/store";
import { AccountSelect, AmountInput, CategorySelect, GoalChips, newClientId } from "../ui/fields";
import { NeedsNetwork, Seg, Sheet } from "../ui/parts";
import { LinkSourcePicker, ReceivablePicker } from "./ref-pickers";

export type OtherKind = "income" | QueuedKind;

const KINDS: { value: OtherKind; label: string }[] = [
  { value: "income", label: "Thu nhập" },
  { value: "spend", label: "Chi tiêu" },
  { value: "refund", label: "Hoàn tiền" },
  { value: "buy_asset", label: "Mua tài sản" },
  { value: "lend", label: "Cho vay" },
  { value: "collect", label: "Nhận lại tiền cho vay" },
  { value: "transfer", label: "Chuyển nội bộ" },
];

export const ASSET_KINDS = [
  { value: "fund", label: "Chứng chỉ quỹ" },
  { value: "stock", label: "Cổ phiếu" },
  { value: "gold", label: "Vàng" },
  { value: "re", label: "Bất động sản" },
] as const;

/**
 * `title` có giá trị: sheet mở thẳng một việc (vd "Ghi thu nhập" ở Hôm nay) — tiêu đề nói đúng việc đó, không hiện hàng chọn loại.
 * Không có: sheet "Loại khác" của màn Nhập, chọn được mọi loại. `edit`: sửa đúng khoản đó, không đổi loại được.
 */
export function OtherEntrySheet({
  kind: initial,
  amount: initialAmount,
  title,
  edit,
  onClose,
}: {
  kind: OtherKind;
  amount: number;
  title?: string;
  edit?: TxRow;
  onClose: () => void;
}) {
  const { boot } = useApp();
  const [kind, setKind] = useState<OtherKind>(initial);
  const draft = useMemo(() => (edit ? draftFromTx(edit) : null), [edit]);
  if (!boot) return null;
  const heading = edit ? `Sửa: ${(MEANING_LABEL[edit.meaning] ?? edit.meaning).toLowerCase()}` : title;
  return (
    <Sheet open title={heading ?? "Tiền vào & loại khác"} onClose={onClose}>
      {!heading && <Seg class="pad" label="Loại giao dịch" value={kind} options={KINDS} onChange={setKind} />}
      {kind === "income" ? (
        <IncomeForm boot={boot} initialAmount={initialAmount} edit={edit && draft ? { tx: edit, draft } : undefined} onDone={onClose} />
      ) : (
        <QueuedForm boot={boot} kind={kind} initialAmount={initialAmount} edit={edit && draft ? { tx: edit, draft } : undefined} onDone={onClose} />
      )}
    </Sheet>
  );
}

/** Khoản đang sửa: dòng sổ gốc và trạng thái đầu của form lấy từ nó. */
type Editing = { tx: TxRow; draft: TxDraft };

/** "Ghi thu nhập" (UC-705): số, tài khoản nhận, nguồn, người thuê, chịu thuế, công tắc "Lương — mở kỳ lương" — ghi một lần, không chia. */
function IncomeForm({ boot, initialAmount, edit, onDone }: { boot: Bootstrap; initialAmount: number; edit?: Editing; onDone: () => void }) {
  const { online, member } = useApp();
  const d = edit?.draft;
  const [amount, setAmount] = useState(initialAmount);
  const [accountId, setAccountId] = useState(() => d?.account_id ?? defaultBankFor(manualAccounts(boot.accounts, "in"), member?.id ?? null));
  const [taxable, setTaxable] = useState<"no" | "yes">(d?.taxable ? "yes" : "no");
  const [note, setNote] = useState(d?.note ?? "");
  const [day, setDay] = useState(() => d?.day ?? dayKey(new Date()));
  const [streamId, setStreamId] = useState(d?.income_stream_id ?? "");
  const [tenantId, setTenantId] = useState(d?.tenant_id ?? "");
  // null = theo nguồn đang chọn; người bấm công tắc thì giữ lựa chọn đó.
  const [opensCycle, setOpensCycle] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(newClientId);
  const today = dayKey(new Date());
  const allStreams = useResource<SettingsData>(online ? "/v1/settings" : null).data?.incomeStreams ?? [];
  const streams = withChosen(
    allStreams.filter((s) => s.active),
    d?.income_stream_id,
    () => allStreams.find((s) => s.id === d?.income_stream_id),
  );
  const rental = useResource<Rental>(online ? "/v1/rental" : null).data;
  const tenants = withChosen(
    (rental?.tenants ?? []).filter((t) => t.active),
    d?.tenant_id,
    () => rental?.tenants.find((t) => t.id === d?.tenant_id),
  );
  const cycleOn = opensCycle ?? opensCycleDefault(streams, streamId);
  // Tiền thuê không bao giờ vào tài khoản riêng tư (N-1, UC-705 AC-36): chặn ở máy, không vào hàng đợi.
  const privateBlock = tenantAccountBlock(tenantId, boot.accounts.find((a) => a.id === accountId));

  async function submit() {
    if (!accountId || !amount || privateBlock) return;
    const body = incomeBody({
      amount,
      at: edit ? editedAt(day, edit.tx.at, new Date()) : atForDay(day, new Date()),
      clientId: edit ? newClientId() : clientId,
      accountId,
      taxable: taxable === "yes",
      streamId,
      tenantId,
      note,
      opensCycle: cycleOn,
    });
    setBusy(true);
    setError(null);
    if (edit) {
      // Sửa ghi thẳng lên server (thay khoản cũ trong một lần; kỳ lương của khoản cũ huỷ theo), không qua hàng đợi.
      try {
        await replaceEntry(edit.tx.id, body);
        onDone();
      } catch (err) {
        setError(errorText(err));
        setBusy(false);
      }
      return;
    }
    if (await saveEntry(body)) onDone();
    else setBusy(false);
  }

  return (
    <>
      <div class="field">
        <label for="i-amount">Số tiền nhận</label>
        <AmountInput id="i-amount" value={amount} onChange={setAmount} autoFocus={!initialAmount} />
      </div>
      <div class="field">
        <label for="i-acct">Vào tài khoản</label>
        <AccountSelect id="i-acct" accounts={manualAccounts(boot.accounts, "in", day)} value={accountId} onChange={setAccountId} />
      </div>
      {tenants.length > 0 && (
        <div class="field">
          <label for="i-tenant">Người thuê trả</label>
          <select id="i-tenant" class="ctl" value={tenantId} onChange={(e) => setTenantId(e.currentTarget.value)}>
            <option value="">Không phải người thuê</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {streams.length > 0 && (
        <div class="field">
          <label for="i-stream">Nguồn thu</label>
          <select
            id="i-stream"
            class="ctl"
            value={streamId}
            onChange={(e) => {
              setStreamId(e.currentTarget.value);
              setOpensCycle(null);
            }}
          >
            <option value="">{tenantId ? "Theo cấu hình cho thuê" : "Không chọn nguồn"}</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {!tenantId && (
        <div class="field">
          <label class="check">
            <input type="checkbox" checked={cycleOn} onChange={(e) => setOpensCycle(e.currentTarget.checked)} />
            Lương — mở kỳ lương
          </label>
        </div>
      )}
      <div class="field" style={{ flexWrap: "wrap" }}>
        <span class="k">Thuế</span>
        <Seg
          label="Thuế"
          value={taxable}
          onChange={setTaxable}
          options={[
            { value: "no", label: "Đã khấu trừ tại nguồn" },
            { value: "yes", label: "Chưa — để riêng thuế" },
          ]}
        />
      </div>
      <div class="field">
        <label for="i-note">Ghi chú</label>
        <input id="i-note" class="ctl" maxLength={500} placeholder="ví dụ: thưởng dự án" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label for="i-day">Ngày</label>
        <input id="i-day" class="ctl" type="date" max={today} value={day} onInput={(e) => setDay(e.currentTarget.value || today)} />
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        {cycleOn && !tenantId ? "Lương về mở kỳ lương mới và danh sách việc ngày lương ở Hôm nay." : "Ghi một khoản thu vào tài khoản nhận."}
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        {privateBlock && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {privateBlock}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={busy || !amount || !accountId || !!privateBlock || (!!edit && !online)} onClick={() => void submit()}>
          {busy ? "Đang ghi…" : edit ? "Lưu thay đổi" : amount ? `Ghi thu nhập ${formatTypedVnd(amount)}` : "Nhập số tiền"}
        </button>
        {edit && <p class="fhint" style={{ padding: "8px 0 0" }}>Lưu sẽ thay khoản cũ bằng khoản này; khoản cũ vẫn nằm trong sổ, ghi là đã xoá.</p>}
        {edit && !online && <NeedsNetwork what="Sửa khoản thu" />}
      </div>
    </>
  );
}

function QueuedForm({
  boot,
  kind,
  initialAmount,
  edit,
  onDone,
}: {
  boot: Bootstrap;
  kind: QueuedKind;
  initialAmount: number;
  edit?: Editing;
  onDone: () => void;
}) {
  const { member, online, snap } = useApp();
  const memberId = member?.id ?? null;
  const d = edit?.draft;
  const [amount, setAmount] = useState(initialAmount);
  const [accountId, setAccountId] = useState<string | null>(() =>
    d
      ? d.account_id
      : kind === "transfer"
        ? defaultBankFor(manualAccounts(boot.accounts, "out"), memberId)
        : kind === "buy_asset"
          ? null
          : defaultAccountFor(boot, memberId, kind === "refund" || kind === "collect" ? "in" : "out"),
  );
  const [toAccountId, setToAccountId] = useState<string | null>(() => (d ? d.to_account_id : defaultAccountFor(boot, memberId, "in")));
  // "Cho mục tiêu" của chi / chuyển ra từ tài khoản chung (pwa UC-705 AC-37, UC-715 AC-17): đổi tài khoản tiền ra là bỏ chọn.
  const [goalId, setGoalId] = useState<string | null>(d?.goal_id ?? null);
  const pickAccount = (id: string | null) => {
    setAccountId(id);
    setGoalId(null);
  };
  const goals = kind === "spend" || kind === "transfer" ? goalChoices(accountId, snap?.pockets) : [];
  const [categoryId, setCategoryId] = useState<string | null>(() => (d ? d.category_id : null));
  const [assetKind, setAssetKind] = useState<(typeof ASSET_KINDS)[number]["value"]>(
    () => ASSET_KINDS.find((a) => a.value === d?.asset_kind)?.value ?? "fund",
  );
  // Khoản gốc gắn với loại lúc chọn (hoàn tiền → khoản chi, nhận lại → khoản cho vay): đổi loại trong cùng sheet là bỏ.
  const [link, setLink] = useState<{ kind: OtherKind; id: number } | null>(d?.link_id ? { kind, id: d.link_id } : null);
  const linkId = link?.kind === kind ? link.id : null;
  const [note, setNote] = useState(d?.note ?? "");
  const [day, setDay] = useState(() => d?.day ?? dayKey(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receivables = withChosen(boot.receivables ?? [], d?.receivable_id, () =>
    d?.receivable_id ? { id: d.receivable_id, name: edit?.tx.receivable_name ?? d.receivable_id, balance: 0 } : undefined,
  );
  // Khoản phải thu chọn sẵn: còn phải thu nhiều nhất; không ai còn nợ thì không chọn ai. Không chọn vẫn ghi được (khoản cho vay cũ chưa có sổ).
  const [receivableId, setReceivableId] = useState<string | null>(() => (d ? d.receivable_id : defaultReceivableId(boot.receivables)));
  const receivable = receivables.find((r) => r.id === receivableId) ?? null;
  // Đang hỏi tên người mới ở ô Ai trả / Cho ai vay: ghi lúc này là ghi khi chưa có người — chờ Thêm người.
  const [naming, setNaming] = useState(false);

  // Đổi loại trong cùng sheet giữ lại tài khoản của loại trước; với chuyển nội bộ thì "Vào" không được trùng "Từ".
  useEffect(() => {
    if (kind === "transfer" && accountId && accountId === toAccountId) {
      const others = manualAccounts(boot.accounts, "in").filter((a) => a.id !== accountId);
      setToAccountId(others[0]?.id ?? toAccountId);
    }
  }, [kind]);
  const today = dayKey(new Date());
  const missing = queuedMissing({ kind, amount, accountId, toAccountId, categoryId }, naming);

  const verb = edit
    ? "Lưu thay đổi"
    : { spend: "Ghi khoản chi", refund: "Ghi hoàn tiền", buy_asset: "Ghi mua tài sản", lend: "Ghi cho vay", collect: "Ghi nhận lại tiền", transfer: "Ghi chuyển nội bộ" }[kind];

  async function submit() {
    if (missing) return;
    setBusy(true);
    setError(null);
    const memo = (kind === "lend" || kind === "collect") && receivable ? receivable : null;
    const body = queuedBody({
      kind,
      amount,
      at: edit ? editedAt(day, edit.tx.at, new Date()) : atForDay(day, new Date()),
      clientId: newClientId(),
      accountId,
      toAccountId,
      categoryId,
      linkId,
      receivableId: memo?.id ?? null,
      assetKind,
      note,
      goalId: goalField(goalId, goals).goal_id ?? null,
    });
    if (edit) {
      // Sửa ghi thẳng lên server (thay khoản cũ trong một lần), không qua hàng đợi.
      try {
        await replaceEntry(edit.tx.id, body);
        onDone();
      } catch (err) {
        setError(errorText(err));
        setBusy(false);
      }
      return;
    }
    const saved = await saveEntry(body, memo ? (kind === "collect" ? collectToast(amount, memo) : lendToast(amount, memo)) : undefined);
    if (saved) onDone();
    else setBusy(false);
  }

  return (
    <>
      <div class="field">
        <label for="o-amount">Số tiền</label>
        <AmountInput id="o-amount" value={amount} onChange={setAmount} autoFocus={!initialAmount} />
      </div>

      {kind === "spend" && (
        <>
          <div class="field">
            <label for="o-cat">Danh mục</label>
            <CategorySelect id="o-cat" categories={boot.categories} value={categoryId} onChange={(id) => setCategoryId(id || null)} allowNone="Chọn danh mục" />
          </div>
          <div class="field">
            <label for="o-acct">Tiền ra từ</label>
            <AccountSelect id="o-acct" accounts={manualAccounts(boot.accounts, "out", day)} value={accountId} onChange={pickAccount} />
          </div>
          <GoalChips choices={goals} value={goalId} onChange={setGoalId} />
        </>
      )}

      {kind === "refund" && (
        <>
          <LinkSourcePicker
            id="o-link"
            kind="spend"
            amount={amount}
            value={linkId}
            onPick={(id, c) => {
              setLink(id ? { kind, id } : null);
              if (c?.category_id) setCategoryId(c.category_id);
            }}
          />
          <div class="field">
            <label for="o-cat">Danh mục</label>
            <CategorySelect id="o-cat" categories={boot.categories} value={categoryId} onChange={(id) => setCategoryId(id || null)} allowNone="không chọn" />
          </div>
          <div class="field">
            <label for="o-acct">Tiền về</label>
            <AccountSelect id="o-acct" accounts={manualAccounts(boot.accounts, "in", day)} value={accountId} onChange={setAccountId} />
          </div>
        </>
      )}

      {kind === "buy_asset" && (
        <>
          <div class="field" style={{ flexWrap: "wrap" }}>
            <span class="k">Loại tài sản</span>
            <Seg label="Loại tài sản" value={assetKind} onChange={setAssetKind} options={[...ASSET_KINDS]} />
          </div>
          <div class="field">
            <label for="o-acct">Trả từ</label>
            <AccountSelect id="o-acct" accounts={manualAccounts(boot.accounts, "out", day)} value={accountId} onChange={setAccountId} allowNone="không qua tài khoản nào" />
          </div>
        </>
      )}

      {(kind === "lend" || kind === "collect") && (
        <ReceivablePicker
          id="o-recv"
          meaning={kind}
          amount={amount}
          receivables={receivables}
          value={receivableId}
          onChange={(id) => {
            setReceivableId(id);
            // Khoản cho vay đã chọn là của một người: đổi người là bỏ khoản đó.
            setLink(null);
          }}
          onPendingChange={setNaming}
        />
      )}

      {kind === "collect" && (
        <LinkSourcePicker
          id="o-link-lend"
          kind="lend"
          amount={amount}
          value={linkId}
          receivableId={receivableId}
          onPick={(id, c) => {
            setLink(id ? { kind, id } : null);
            if (c?.receivable_id) setReceivableId(c.receivable_id);
          }}
        />
      )}

      {kind === "lend" && (
        <div class="field">
          <label for="o-acct">Tiền ra từ</label>
          <AccountSelect id="o-acct" accounts={manualAccounts(boot.accounts, "out", day)} value={accountId} onChange={setAccountId} />
        </div>
      )}

      {kind === "collect" && (
        <div class="field">
          <label for="o-acct">Tiền vào</label>
          <AccountSelect id="o-acct" accounts={manualAccounts(boot.accounts, "in", day)} value={accountId} onChange={setAccountId} />
        </div>
      )}

      {kind === "transfer" && (
        <>
          <div class="field">
            <label for="o-from">Từ</label>
            <AccountSelect id="o-from" accounts={manualAccounts(boot.accounts, "out", day)} value={accountId} onChange={pickAccount} />
          </div>
          <GoalChips choices={goals} value={goalId} onChange={setGoalId} />
          <div class="field">
            <label for="o-to">Vào</label>
            <AccountSelect id="o-to" accounts={manualAccounts(boot.accounts, "in", day)} value={toAccountId} onChange={setToAccountId} />
          </div>
        </>
      )}

      <div class="field">
        <label for="o-note">Ghi chú</label>
        <input
          id="o-note"
          class="ctl"
          maxLength={500}
          placeholder={kind === "lend" && !receivable ? "cho ai vay" : "không bắt buộc"}
          value={note}
          onInput={(e) => setNote(e.currentTarget.value)}
        />
      </div>
      <div class="field">
        <label for="o-day">Ngày</label>
        <input id="o-day" class="ctl" type="date" max={today} value={day} onInput={(e) => setDay(e.currentTarget.value || today)} />
      </div>

      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        {kind === "spend" && "Chi cho một mục tiêu Dự phòng thì chọn đúng tài khoản của mục tiêu đó ở ô Tiền ra từ; tài khoản dùng chung cho nhiều mục tiêu thì chọn thêm Cho mục tiêu."}
        {kind === "refund" && "Hoàn tiền tính vào kỳ hiện tại và nối về khoản chi gốc. Tiền cho vay được trả lại thì chọn Nhận lại tiền cho vay."}
        {kind === "buy_asset" && "Tiền rời tài khoản thành tài sản — không phải chi tiêu."}
        {kind === "lend" && "Cho vay: tiền rời tài khoản nhưng vẫn là tiền của nhà. Gắn vào khoản phải thu để biết người đó còn nợ mình bao nhiêu."}
        {kind === "collect" && "Tiền cho vay được trả lại, không phải thu nhập: tài khoản nhận tăng, số phải thu giảm."}
        {kind === "transfer" && "Chuyển giữa hai tài khoản của nhà. Chuyển sang ngăn Tích luỹ / Dự phòng thì việc ngày lương tự nhận."}
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!!missing || busy || (!!edit && !online)} onClick={() => void submit()}>
          {busy && edit ? "Đang lưu…" : (missing ?? verb)}
        </button>
        {edit && <p class="fhint" style={{ padding: "8px 0 0" }}>Lưu sẽ thay khoản cũ bằng khoản này; khoản cũ vẫn nằm trong sổ, ghi là đã xoá.</p>}
        {edit && !online && <NeedsNetwork what="Sửa giao dịch" />}
      </div>
    </>
  );
}
