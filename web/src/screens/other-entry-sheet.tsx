// "Loại khác": thu nhập · chi tiêu · hoàn tiền · mua tài sản · cho vay · nhận lại tiền cho vay ·
// chuyển nội bộ (pwa UC-705, Đợt C — không ví, không chia). Mọi loại đi qua hàng đợi như khoản chi.
// Có `edit`: cùng form, điền sẵn từ một khoản đã lên sổ; lưu là thay khoản đó (POST /v1/transactions/:id/replace, UC-715) nên cần mạng.

import { useEffect, useMemo, useState } from "preact/hooks";
import { errorText } from "../lib/api";
import { defaultAccountFor, defaultBankFor, manualAccounts } from "../lib/categories";
import { goalChoices, goalField, goalValueOf, incomeInterest } from "../lib/goal-choices";
import { formatTypedVnd } from "../lib/money";
import { incomeBody, isSalaryDefault, queuedBody, queuedMissing, type QueuedKind } from "../lib/other-entry";
import { atForDay, dayKey } from "../lib/period";
import { tenantAccountBlock } from "../lib/rental";
import { collectToast, defaultReceivableId, lendToast } from "../lib/receivables";
import { draftFromTx, editedAt, MEANING_LABEL, withChosen, type TxDraft } from "../lib/transactions";
import type { Bootstrap, Rental, SettingsData, TxRow } from "../lib/types";
import { useResource } from "../state/resource";
import { replaceEntry, saveEntry, useApp } from "../state/store";
import { AccountSelect, AmountInput, CategorySelect, newClientId } from "../ui/fields";
import { NeedsNetwork, Seg, Sheet } from "../ui/parts";
import { GoalRowField, InterestCheck, LinkSourcePicker, ReceivablePicker } from "./ref-pickers";

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
  tenantId: initialTenantId,
  edit,
  onClose,
}: {
  kind: OtherKind;
  amount: number;
  title?: string;
  tenantId?: string;
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
        <IncomeForm boot={boot} initialAmount={initialAmount} initialTenantId={initialTenantId} edit={edit && draft ? { tx: edit, draft } : undefined} onDone={onClose} />
      ) : (
        <QueuedForm boot={boot} kind={kind} initialAmount={initialAmount} edit={edit && draft ? { tx: edit, draft } : undefined} onDone={onClose} />
      )}
    </Sheet>
  );
}

/** Khoản đang sửa: dòng sổ gốc và trạng thái đầu của form lấy từ nó. */
type Editing = { tx: TxRow; draft: TxDraft };

/** "Ghi thu nhập" (UC-705): số, tài khoản nhận, nguồn, người thuê, chịu thuế, ô "Đây là lương" (Q1-B) — ghi một lần, không chia. */
function IncomeForm({ boot, initialAmount, initialTenantId, edit, onDone }: { boot: Bootstrap; initialAmount: number; initialTenantId?: string; edit?: Editing; onDone: () => void }) {
  const { online, member, snap } = useApp();
  const d = edit?.draft;
  const [amount, setAmount] = useState(initialAmount);
  const [accountId, setAccountId] = useState(() => d?.account_id ?? defaultBankFor(manualAccounts(boot.accounts, "in"), member?.id ?? null));
  const [taxable, setTaxable] = useState<"no" | "yes">(d?.taxable ? "yes" : "no");
  const [note, setNote] = useState(d?.note ?? "");
  const [day, setDay] = useState(() => d?.day ?? dayKey(new Date()));
  const [streamId, setStreamId] = useState(d?.income_stream_id ?? "");
  const [tenantId, setTenantId] = useState(d?.tenant_id ?? initialTenantId ?? "");
  // null = theo mặc định Q1-B (nguồn lương / ngưỡng nhắc trích); người bấm ô thì giữ lựa chọn đó.
  const [isSalary, setIsSalary] = useState<boolean | null>(null);
  // "Đây là tiền lãi" (QĐ2, UC-705 AC-38): null = theo tài khoản nhận (bật sẵn khi là khoản gửi); sửa khoản giữ cờ cũ.
  const [isInterest, setIsInterest] = useState<boolean | null>(d ? d.is_interest : null);
  const interestOffer = incomeInterest(accountId, snap?.pockets);
  const interestOn = interestOffer !== null && (isInterest ?? interestOffer.preset);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(newClientId);
  const today = dayKey(new Date());
  const settings = useResource<SettingsData>(online ? "/v1/settings" : null).data;
  const allStreams = settings?.incomeStreams ?? [];
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
  const salaryOn = isSalary ?? isSalaryDefault(streams, streamId, amount, settings?.config.salary_reminder_min);
  // Tiền người thuê và tiền lãi không bao giờ là lương: không có ô (pocket UC-1205).
  const salaryBox = !tenantId && !interestOn;
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
      isSalary: salaryOn,
      isInterest: interestOn,
    });
    setBusy(true);
    setError(null);
    if (edit) {
      // Sửa ghi thẳng lên server (thay khoản cũ trong một lần; nhắc trích của khoản cũ huỷ theo), không qua hàng đợi.
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
        <AccountSelect
          id="i-acct"
          accounts={manualAccounts(boot.accounts, "in", day)}
          value={accountId}
          onChange={(id) => {
            setAccountId(id);
            if (!edit) setIsInterest(null);
          }}
        />
      </div>
      <InterestCheck shown={interestOffer !== null} checked={interestOn} onChange={setIsInterest} />
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
              setIsSalary(null);
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
      {salaryBox && (
        <div class="field">
          <label class="check">
            <input type="checkbox" checked={salaryOn} onChange={(e) => setIsSalary(e.currentTarget.checked)} />
            Đây là lương
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
      <div class="note" style={{ borderTop: "1px solid var(--line)" }}>
        {salaryOn && salaryBox ? "Lương về có nhắc trích Tích luỹ ở Hôm nay." : "Ghi khoản thu vào tài khoản nhận."}
      </div>
      <div class="sheet-foot">
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
  // "Cho mục tiêu" / "Cho khoản phải trả" / "Từ tiền lãi" của chi / chuyển ra (pwa UC-705 AC-37, AC-38, UC-715 AC-17): đổi tài
  // khoản tiền ra là bỏ chọn; sửa khoản giữ lựa chọn đang gắn.
  const [goalId, setGoalId] = useState<string | null>(d ? goalValueOf(d) : null);
  const pickAccount = (id: string | null) => {
    setAccountId(id);
    setGoalId(null);
  };
  const goals =
    kind === "spend" || kind === "transfer"
      ? goalChoices(accountId, snap?.pockets, { toAccountId: kind === "transfer" ? toAccountId : null, keepInterest: !!d?.from_interest && accountId === d.account_id })
      : null;
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
    const goalPick = goalField(goalId, goals);
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
      goalId: goalPick.goal_id ?? null,
      fromInterest: goalPick.from_interest === true,
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
          <GoalRowField id="o-goal" row={goals} value={goalId} onChange={setGoalId} />
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
          <GoalRowField id="o-goal" row={goals} value={goalId} onChange={setGoalId} />
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

      <div class="note" style={{ borderTop: "1px solid var(--line)" }}>
        {kind === "spend" && "Chi cho mục tiêu Dự phòng: chọn tài khoản đó ở ô Tiền ra từ. Nếu tài khoản chung, chọn thêm Cho mục tiêu."}
        {kind === "refund" && "Hoàn tiền tính vào tháng này và nối về khoản chi gốc. Được trả tiền cho vay thì chọn Nhận lại tiền cho vay."}
        {kind === "buy_asset" && "Tiền chuyển thành tài sản, không phải chi tiêu."}
        {kind === "lend" && "Tiền cho vay vẫn là của nhà mình. Gắn vào khoản phải thu để biết họ còn nợ bao nhiêu."}
        {kind === "collect" && "Tiền cho vay được trả lại không tính là thu nhập: tài khoản nhận tăng, số phải thu giảm."}
        {kind === "transfer" && "Chuyển giữa hai tài khoản của nhà. Chuyển vào ngăn Tích luỹ hay Ví Thưởng thì phần nhắc trích và chia dư sẽ tự nhận."}
      </div>
      <div class="sheet-foot">
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
