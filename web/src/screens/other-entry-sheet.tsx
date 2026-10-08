// "Loại khác": thu nhập ngoài · hoàn tiền · mua tài sản · cho vay · nhận lại tiền cho vay · chuyển nội bộ · người thuê chi hộ.
// Thu nhập và người thuê chi cần mạng (thu nhập ghi xong chia ngay hoặc để chia sau / sổ người thuê không có hàng đợi); năm loại còn lại đi qua hàng đợi như khoản chi.
// Có `edit`: cùng form, điền sẵn từ một khoản đã lên sổ; lưu là thay khoản đó (POST /v1/transactions/:id/replace, UC-715) nên cần mạng.

import { useEffect, useMemo, useState } from "preact/hooks";
import { ApiError, api, errorText } from "../lib/api";
import { defaultAccountFor, defaultBankFor, defaultWalletFor, manualAccounts, spendableWallets, walletOfMember } from "../lib/categories";
import { formatVnd } from "../lib/money";
import { ordersLeft } from "../lib/pending";
import { atForDay, dayKey } from "../lib/period";
import { linePayload } from "../lib/rental";
import { collectToast, defaultReceivableId, lendToast } from "../lib/receivables";
import { deferredIncomeToast } from "../lib/splits";
import { wealthBuildingMoveHint } from "../lib/wealth-building-accounts";
import { draftFromTx, editedAt, MEANING_LABEL, withChosen, type TxDraft } from "../lib/transactions";
import type { AllocationPlan, Bootstrap, CreateEntryResult, EntryBody, Rental, SettingsData, TxRow, Wallet } from "../lib/types";
import { useResource } from "../state/resource";
import { getState, refresh, replaceEntry, saveEntry, toast, useApp } from "../state/store";
import { AccountSelect, AmountInput, CategorySelect, newClientId, WalletSelect } from "../ui/fields";
import { Money } from "../ui/money";
import { Banner, NeedsNetwork, Seg, Sheet } from "../ui/parts";
import { LinkSourcePicker, ReceivablePicker } from "./ref-pickers";

export type OtherKind = "income" | "refund" | "buy_asset" | "lend" | "collect" | "transfer" | "tenant_paid";

const KINDS: { value: OtherKind; label: string }[] = [
  { value: "income", label: "Thu nhập" },
  { value: "refund", label: "Hoàn tiền" },
  { value: "buy_asset", label: "Mua tài sản" },
  { value: "lend", label: "Cho vay" },
  { value: "collect", label: "Nhận lại tiền cho vay" },
  { value: "transfer", label: "Chuyển nội bộ" },
  { value: "tenant_paid", label: "Người thuê chi" },
];

export const ASSET_KINDS = [
  { value: "fund", label: "Chứng chỉ quỹ" },
  { value: "stock", label: "Cổ phiếu" },
  { value: "gold", label: "Vàng" },
  { value: "re", label: "Bất động sản" },
] as const;

/**
 * `title` có giá trị: sheet mở thẳng một việc (vd "Chia tiền" ở Hôm nay) — tiêu đề nói đúng việc đó, không hiện hàng chọn loại.
 * Không có: sheet "Loại khác" của màn Nhập, chọn được cả bảy loại. `edit`: sửa đúng khoản đó, không đổi loại được.
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
    <Sheet open title={heading ?? "Loại khác"} onClose={onClose}>
      {!heading && <Seg class="pad" label="Loại giao dịch" value={kind} options={KINDS} onChange={setKind} />}
      {kind === "income" ? (
        <IncomeForm boot={boot} initialAmount={initialAmount} edit={edit && draft ? { tx: edit, draft } : undefined} onDone={onClose} />
      ) : kind === "tenant_paid" ? (
        <TenantPaidForm boot={boot} initialAmount={initialAmount} onDone={onClose} />
      ) : (
        <QueuedForm boot={boot} kind={kind} initialAmount={initialAmount} edit={edit && draft ? { tx: edit, draft } : undefined} onDone={onClose} />
      )}
    </Sheet>
  );
}

/** Khoản đang sửa: dòng sổ gốc và trạng thái đầu của form lấy từ nó. */
type Editing = { tx: TxRow; draft: TxDraft };

const tierNote = (w: Wallet | undefined): string => {
  if (!w) return "";
  if (w.tier === "wealth_building") return "khóa";
  if (w.tier === "tax") return "khóa";
  if (w.tier === "holding") return "giữ riêng";
  if (w.tier === "nice") return "hưởng thụ";
  return w.mustGroup === "have" ? "phần còn lại" : "Must";
};

/** Bảng "chia thử" — dùng chung cho thu nhập nhập tay và khoản tiền vào ở màn Gán. */
export function AllocationPreview({ plan, boot, amount }: { plan: AllocationPlan; boot: Bootstrap; amount: number }) {
  const wallet = (id: string) => boot.wallets.find((w) => w.id === id);
  const account = (id: string) => boot.accounts.find((a) => a.id === id)?.name ?? id;
  const total = plan.funds.reduce((s, f) => s + f.amount, 0);
  return (
    <>
      <div class="card-h" style={{ paddingBottom: "2px" }}>
        <h2>Chia thử trước khi ghi</h2>
      </div>
      <div class="wf">
        {plan.funds.map((f) => {
          const w = wallet(f.walletId);
          const covered = plan.deficitCovered[f.walletId];
          return (
            <div class="r" key={f.walletId}>
              <span>
                {w?.name ?? f.walletId} <span class="sub-line">{tierNote(w)}</span>
                {covered ? <span class="sub-line" style={{ display: "block" }}>đã bù {formatVnd(covered)} cho tháng trước</span> : null}
              </span>
              <Money value={f.amount} mono unit={false} />
            </div>
          );
        })}
        <div class="r total">
          <span>Tổng</span>
          <Money value={total} mono unit={false} />
        </div>
        {total !== amount && (
          <p class="err" style={{ margin: "4px 0 0" }}>
            Tổng chia khác số tiền nhận {formatVnd(amount)}.
          </p>
        )}
      </div>
      {plan.underfunded.length > 0 && (
        <div style={{ padding: "10px 16px 0" }}>
          <Banner tone="warn" mark="!">
            <strong>Chưa tới sàn:</strong> {plan.underfunded.map((id) => wallet(id)?.name ?? id).join(", ")}. Ghi đúng như vậy, không vay phần đã khóa.
          </Banner>
        </div>
      )}
      <div class="note">
        {plan.transferOrders.length === 0
          ? "Không sinh lệnh chuyển tiền: các ví nhận tiền nằm cùng tài khoản."
          : `Sau khi ghi sẽ sinh ${plan.transferOrders.length} lệnh chuyển tiền: ` +
            plan.transferOrders.map((o) => `${account(o.fromAccountId)} → ${account(o.toAccountId)} ${formatVnd(o.amount)}`).join("; ") +
            ". Phân bổ trong app chỉ là ảo cho tới khi tiền đi thật."}
      </div>
    </>
  );
}

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
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Khoản thu đã ghi nhưng chia chưa xong: bấm lại chỉ chia, không ghi thêm khoản thu. */
  const [txId, setTxId] = useState<number | null>(null);
  const [clientId] = useState(newClientId);
  const today = dayKey(new Date());
  const at = () => (edit ? editedAt(day, edit.tx.at, new Date()) : atForDay(day, new Date()));
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
  // Người thuê trả mà không chọn nguồn: server tự gán nguồn cho thuê — chia thử cũng theo nguồn đó.
  const previewStream = streamId || (tenantId ? (rental?.incomeStreamId ?? "") : "");

  useEffect(() => {
    setPlan(null);
    setPreviewError(null);
    if (!amount || !online) return;
    const t = setTimeout(() => {
      api
        .post<AllocationPlan>("/v1/allocate/preview", {
          amount,
          taxable: taxable === "yes",
          at: at(),
          account_id: accountId,
          ...(previewStream ? { income_stream_id: previewStream } : {}),
        })
        .then(setPlan)
        .catch((err) => setPreviewError(errorText(err)));
    }, 350);
    return () => clearTimeout(t);
  }, [amount, taxable, accountId, day, previewStream, online]);

  /** `defer`: chỉ ghi khoản thu (nằm ở ví Thu nhập), không chia — chia sau ở chi tiết giao dịch (UC-715). */
  async function submit(defer = false) {
    if (!accountId || !amount) return;
    setBusy(true);
    setError(null);
    let id = txId;
    try {
      if (id === null) {
        const body: EntryBody = {
          meaning: "income",
          amount,
          at: at(),
          client_id: clientId,
          account_id: accountId,
          taxable: taxable === "yes",
          ...(streamId ? { income_stream_id: streamId } : {}),
          ...(tenantId ? { tenant_id: tenantId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        };
        // Sửa: server huỷ khoản cũ (gỡ luôn lần chia cũ) và ghi khoản mới chưa chia — bước dưới chia lại.
        const res = await api.post<CreateEntryResult>(edit ? `/v1/transactions/${edit.tx.id}/replace` : "/v1/transactions", body);
        id = res.tx.id;
        setTxId(id);
      }
      if (defer) {
        await refresh();
        toast(deferredIncomeToast(amount));
        onDone();
        return;
      }
      let orders = 0;
      try {
        const done = await api.post<AllocationPlan & { batchId: string }>("/v1/allocate", { income_tx_id: id });
        orders = done.transferOrders.length;
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "already_allocated")) throw err;
      }
      // Như màn Gán: tải lại số rồi nói tổng lệnh chuyển tiền đang chờ, không chỉ lệnh của lần chia này.
      await refresh();
      const after = getState();
      const tail = ordersLeft(orders, after.stale || !after.snap ? null : after.snap.attention.transferOrdersPending);
      toast(`${edit ? `Đã sửa thành ${formatVnd(amount)} và chia lại` : `Đã chia ${formatVnd(amount)}`}.${tail ? ` ${tail}` : ""}`);
      onDone();
    } catch (err) {
      setError(`${id !== null ? (edit ? "Đã sửa khoản thu nhưng chưa chia. " : "Đã ghi khoản thu nhưng chưa chia. ") : ""}${errorText(err)}`);
      setBusy(false);
    }
  }

  return (
    <>
      <div class="field">
        <label for="i-amount">Số tiền nhận</label>
        <AmountInput id="i-amount" value={amount} onChange={setAmount} autoFocus={!initialAmount} />
      </div>
      <div class="field">
        <label for="i-acct">Vào tài khoản</label>
        <AccountSelect id="i-acct" accounts={manualAccounts(boot.accounts, "in")} value={accountId} onChange={setAccountId} />
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
          <select id="i-stream" class="ctl" value={streamId} onChange={(e) => setStreamId(e.currentTarget.value)}>
            <option value="">{tenantId ? "Theo cấu hình cho thuê" : "Mặc định (luật % chung)"}</option>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
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
      {plan && <AllocationPreview plan={plan} boot={boot} amount={amount} />}
      {previewError && <p class="err" style={{ padding: "8px 16px 0", margin: 0 }}>{previewError}</p>}
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || !plan || !accountId} onClick={() => void submit()}>
          {busy ? "Đang chia…" : txId !== null ? "Chia lại" : edit ? "Sửa và chia lại" : "Chia và ghi sổ"}
        </button>
        {!edit && txId === null && (
          <button type="button" class="btn" style={{ width: "100%", marginTop: "8px" }} disabled={!online || busy || !amount || !accountId} onClick={() => void submit(true)}>
            Ghi, để chia sau
          </button>
        )}
        {edit && txId === null && <p class="fhint" style={{ padding: "8px 0 0" }}>Lưu sẽ thay khoản cũ{edit.tx.allocated ? " và gỡ lần chia cũ" : ""}, rồi chia lại theo số mới.</p>}
        {!online && <NeedsNetwork what={edit ? "Sửa khoản thu" : "Chia tiền"} />}
      </div>
    </>
  );
}

function TenantPaidForm({ boot, initialAmount, onDone }: { boot: Bootstrap; initialAmount: number; onDone: () => void }) {
  const { online } = useApp();
  const res = useResource<Rental>(online ? "/v1/rental" : null);
  const rental = res.data;
  const tenants = (rental?.tenants ?? []).filter((t) => t.active);
  const [tenantId, setTenantId] = useState("");
  const [amount, setAmount] = useState(initialAmount);
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [clientId] = useState(newClientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = dayKey(new Date());
  const tenant = tenants.find((t) => t.id === tenantId) ?? tenants[0];
  const sharedIds = rental?.sharedCategoryIds ?? [];
  const shared = boot.categories.filter((c) => sharedIds.includes(c.id));
  const category = categoryId || shared[0]?.id || "";

  async function submit() {
    if (!tenant) return;
    const r = linePayload({ kind: "paid_for_us", amount, sign: 1, name: note, category_id: category }, sharedIds);
    if (!r.ok) return setError(Object.values(r.errors)[0] ?? null);
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/rental/tenants/${encodeURIComponent(tenant.id)}/lines`, { ...r.value, at: atForDay(day, new Date()), client_id: clientId });
      toast(`Đã ghi ${tenant.name} chi ${formatVnd(amount)}. Trừ vào nợ của ${tenant.name}.`);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (online && rental && tenants.length === 0) {
    return <p class="note">Chưa có người thuê. Thêm ở Cài đặt › Cho thuê.</p>;
  }
  return (
    <>
      <div class="field">
        <label for="t-tenant">Ai chi</label>
        <select id="t-tenant" class="ctl" value={tenant?.id ?? ""} onChange={(e) => setTenantId(e.currentTarget.value)}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <label for="t-amount">Số tiền</label>
        <AmountInput id="t-amount" value={amount} onChange={setAmount} autoFocus={!initialAmount} />
      </div>
      <div class="field">
        <label for="t-cat">Chi cho</label>
        <select id="t-cat" class="ctl" value={category} onChange={(e) => setCategoryId(e.currentTarget.value)}>
          {shared.length === 0 && <option value="">Chưa có danh mục chi chung</option>}
          {shared.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <label for="t-note">Ghi chú</label>
        <input id="t-note" class="ctl" maxLength={120} placeholder="đi chợ" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label for="t-day">Ngày</label>
        <input id="t-day" class="ctl" type="date" max={today} value={day} onInput={(e) => setDay(e.currentTarget.value || today)} />
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        Người thuê tự trả bằng tiền của mình một khoản chi chung: không trừ ví nào của nhà, cộng vào tổng chi chung tháng và trừ vào nợ của người thuê.
      </div>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || !tenant || !amount} onClick={() => void submit()}>
          {busy ? "Đang ghi…" : amount && tenant ? `Ghi ${tenant.name} chi ${formatVnd(amount)}` : "Nhập số tiền"}
        </button>
        {!online && <NeedsNetwork what="Ghi sổ người thuê" />}
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
  kind: Exclude<OtherKind, "income" | "tenant_paid">;
  initialAmount: number;
  edit?: Editing;
  onDone: () => void;
}) {
  const { member, online } = useApp();
  const memberId = member?.id ?? null;
  const d = edit?.draft;
  const wallets = useMemo(() => {
    const own = withChosen(spendableWallets(boot.wallets, memberId), d?.wallet_id, () => boot.wallets.find((w) => w.id === d?.wallet_id));
    return withChosen(own, d?.from_wallet_id, () => boot.wallets.find((w) => w.id === d?.from_wallet_id));
  }, [boot, memberId, d]);
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
  const [categoryId, setCategoryId] = useState<string | null>(() => (d ? d.category_id : null));
  const [walletId, setWalletId] = useState<string | null>(d?.wallet_id ?? null);
  const [moveWallets, setMoveWallets] = useState(Boolean(d && kind === "transfer" && (d.wallet_id || d.from_wallet_id)));
  const [fromWalletId, setFromWalletId] = useState<string | null>(d?.from_wallet_id ?? null);
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
      setToAccountId((others.find((a) => !a.role) ?? others[0])?.id ?? toAccountId);
    }
  }, [kind]);
  // Chuyển vào tài khoản Tích sản (heo, phao, sổ) từ tài khoản thường mà không tự chọn ví: server chuyển ví Có thì tốt → Tích sản (ADR-88).
  const wealthBuildingHint = kind === "transfer" && !moveWallets ? wealthBuildingMoveHint(boot.accounts, accountId, toAccountId) : null;
  const today = dayKey(new Date());

  function pickCategory(id: string) {
    setCategoryId(id || null);
    const c = boot.categories.find((x) => x.id === id);
    if (c && kind === "refund") setWalletId(defaultWalletFor(boot, c, memberId)?.id ?? walletId);
  }

  const missing = !amount
    ? "Nhập số tiền"
    : kind === "refund" && !walletId && !linkId
      ? "Chọn ví nhận lại"
      : kind === "transfer" && (!accountId || !toAccountId)
        ? "Chọn hai tài khoản"
        : kind === "transfer" && accountId === toAccountId
          ? "Hai tài khoản phải khác nhau"
          : kind === "transfer" && moveWallets && (!walletId || !fromWalletId || walletId === fromWalletId)
            ? "Chọn hai ví khác nhau"
            : (kind === "lend" || kind === "collect") && !accountId
              ? "Chọn tài khoản"
              : naming
                ? "Bấm Thêm người trước khi ghi"
                : null;

  const verb = edit
    ? "Lưu thay đổi"
    : { refund: "Ghi hoàn tiền", buy_asset: "Ghi mua tài sản", lend: "Ghi cho vay", collect: "Ghi nhận lại tiền", transfer: "Ghi chuyển nội bộ" }[kind];

  async function submit() {
    if (missing) return;
    setBusy(true);
    setError(null);
    const memo = (kind === "lend" || kind === "collect") && receivable ? receivable : null;
    const body: EntryBody = {
      meaning: kind,
      amount,
      at: edit ? editedAt(day, edit.tx.at, new Date()) : atForDay(day, new Date()),
      client_id: newClientId(),
      ...(accountId ? { account_id: accountId } : {}),
      ...(kind === "transfer" && toAccountId ? { to_account_id: toAccountId } : {}),
      ...(kind === "transfer" && moveWallets && walletId && fromWalletId ? { wallet_id: walletId, from_wallet_id: fromWalletId } : {}),
      ...(kind === "refund" ? { wallet_id: walletId ?? undefined } : {}),
      ...((kind === "refund" || kind === "collect") && linkId ? { link_id: linkId } : {}),
      ...(kind === "refund" && categoryId ? { category_id: categoryId } : {}),
      ...(memo ? { receivable_id: memo.id } : {}),
      ...(kind === "buy_asset" ? { asset_kind: assetKind } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
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

      {kind === "refund" && (
        <>
          <LinkSourcePicker
            id="o-link"
            kind="spend"
            amount={amount}
            value={linkId}
            onPick={(id, c) => {
              setLink(id ? { kind, id } : null);
              if (c) setWalletId(walletOfMember(boot, c.wallet_id, memberId)?.id ?? walletId);
              if (c?.category_id) setCategoryId(c.category_id);
            }}
          />
          <div class="field">
            <label for="o-cat">Danh mục</label>
            <CategorySelect id="o-cat" categories={boot.categories} value={categoryId} onChange={pickCategory} allowNone="không chọn" />
          </div>
          <div class="field">
            <label for="o-wallet">Ví nhận lại</label>
            <WalletSelect id="o-wallet" wallets={wallets} value={walletId} onChange={setWalletId} />
          </div>
          <div class="field">
            <label for="o-acct">Tiền về</label>
            <AccountSelect id="o-acct" accounts={manualAccounts(boot.accounts, "in")} value={accountId} onChange={setAccountId} />
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
            <AccountSelect id="o-acct" accounts={manualAccounts(boot.accounts, "out")} value={accountId} onChange={setAccountId} allowNone="không qua tài khoản nào" />
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
          <AccountSelect id="o-acct" accounts={manualAccounts(boot.accounts, "out")} value={accountId} onChange={setAccountId} />
        </div>
      )}

      {kind === "collect" && (
        <div class="field">
          <label for="o-acct">Tiền vào</label>
          <AccountSelect id="o-acct" accounts={manualAccounts(boot.accounts, "in")} value={accountId} onChange={setAccountId} />
        </div>
      )}

      {kind === "transfer" && (
        <>
          <div class="field">
            <label for="o-from">Từ</label>
            <AccountSelect id="o-from" accounts={manualAccounts(boot.accounts, "out")} value={accountId} onChange={setAccountId} />
          </div>
          <div class="field">
            <label for="o-to">Vào</label>
            <AccountSelect id="o-to" accounts={manualAccounts(boot.accounts, "in")} value={toAccountId} onChange={setToAccountId} />
          </div>
          <div class="field">
            <label class="check">
              <input type="checkbox" checked={moveWallets} onChange={(e) => setMoveWallets(e.currentTarget.checked)} />
              Chuyển cả tiền giữa hai ví
            </label>
          </div>
          {moveWallets && (
            <>
              <div class="field">
                <label for="o-wfrom">Ví bớt</label>
                <WalletSelect id="o-wfrom" wallets={wallets} value={fromWalletId} onChange={setFromWalletId} />
              </div>
              <div class="field">
                <label for="o-wto">Ví thêm</label>
                <WalletSelect id="o-wto" wallets={wallets} value={walletId} onChange={setWalletId} />
              </div>
            </>
          )}
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
        {kind === "refund" && "Hoàn tiền tính vào kỳ hiện tại, không chia lại như thu nhập, nhưng vẫn nối về khoản chi gốc. Tiền cho vay được trả lại thì chọn Nhận lại tiền cho vay."}
        {kind === "buy_asset" && "Tiền đi từ phần tiền của Tích sản sang tài sản. Ví chi tiêu không bị trừ."}
        {kind === "lend" && "Cho vay không trừ ví nào: tiền rời tài khoản nhưng vẫn là tiền của nhà. Gắn vào khoản phải thu để biết người đó còn nợ mình bao nhiêu."}
        {kind === "collect" && "Tiền cho vay được trả lại, không phải thu nhập: không chia vào ví, không đụng ví nào. Chỉ tài khoản nhận tăng, số phải thu giảm."}
        {kind === "transfer" && (wealthBuildingHint ?? "Rút tiền mặt, nạp ví điện tử: tiền chỉ đổi chỗ, ví không bị trừ.")}
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
