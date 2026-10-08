// Gán — nơi giải mọi edge case của bank feed. Chạm một log → sheet: loại → ví → danh mục → tách dòng.
// Tổng các dòng phải bằng đúng số tiền log; app chặn trước khi gửi, server kiểm lại.

import { useEffect, useMemo, useState } from "preact/hooks";
import { DEBT_CATEGORY_ID } from "../../../src/domain/system-ids";
import { ApiError, api, errorText } from "../lib/api";
import { moveWallets } from "../lib/budget";
import { defaultAccountFor, defaultWalletFor, spendableWallets, walletOfMember } from "../lib/categories";
import { payableDebts } from "../lib/debts";
import { bookRefLabel } from "../lib/memo-books";
import { formatVnd, groupDigits } from "../lib/money";
import { localWalletStatus } from "../lib/pending";
import { dayKey, shortDate, timeHM } from "../lib/period";
import { defaultReceivableId } from "../lib/receivables";
import { ASSIGN_CHOICES, assignToast, deferredIncomeToast, GUIDE_PICK_KIND_URL, validateSplits, type AssignChoice, type Split, type SplitMeaning } from "../lib/splits";
import { MEANING_LABEL } from "../lib/transactions";
import { wealthBuildingMoveHint } from "../lib/wealth-building-accounts";
import type { AccountRef, AllocationPlan, BankLog, Bootstrap, Rental, SettingsData } from "../lib/types";
import { useResource } from "../state/resource";
import { getState, refresh, setState, toast, useApp, viewSnapshot } from "../state/store";
import { AccountSelect, AmountInput, CategorySelect, WalletSelect } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Banner, Card, Empty, NeedsNetwork, PageHeader, Seg, Sheet, Skeleton } from "../ui/parts";
import { useWide } from "../ui/shell";
import { AllocationPreview, ASSET_KINDS } from "./other-entry-sheet";
import { LinkSourcePicker, ReceivablePicker } from "./ref-pickers";

export function Assign() {
  const { online, boot, assignFocus } = useApp();
  const wide = useWide();
  const logs = useResource<BankLog[]>("/v1/logs?status=pending");
  const [open, setOpen] = useState<BankLog | null>(null);
  // Máy tính: log đang chọn ở panel bên phải; mở từ bảng điều khiển thì chọn sẵn đúng log đó.
  const [sel, setSel] = useState<string | null>(assignFocus);
  useEffect(() => {
    if (assignFocus) setState({ assignFocus: null });
  }, []);
  // Điện thoại: mở từ "Gán lại" ở chi tiết giao dịch (UC-715) thì mở thẳng sheet gán của log đó khi danh sách về.
  useEffect(() => {
    const log = !wide && sel ? logs.data?.find((l) => l.id === sel) : undefined;
    if (!log) return;
    setOpen(log);
    setSel(null);
  }, [logs.data]);
  const notReady = logs.error && (logs.error.status === 501 || logs.error.code === "not_implemented" || logs.error.status === 404);
  const count = logs.data?.length ?? 0;
  const selected = wide && logs.data ? (logs.data.find((l) => l.id === sel) ?? logs.data[0] ?? null) : null;
  const done = () => {
    setOpen(null);
    setSel(null);
    logs.reload();
    void refresh();
  };

  const list = (
    <Card title="Chưa gán" right={logs.data ? <span class="hint">{count} giao dịch</span> : undefined} flush note="Tiền vào không bao giờ tự gán, trừ khoản khớp mẫu lương.">
      {logs.loading && !logs.data ? (
        <Skeleton rows={3} />
      ) : notReady ? (
        <Empty title="Chưa nối ngân hàng.">Khi SePay chạy, giao dịch ngân hàng chưa gán sẽ hiện ở đây. Khoản chi tiền mặt vẫn nhập ở màn Nhập.</Empty>
      ) : logs.error && !logs.data ? (
        <Empty title={logs.error.offline ? "Không có mạng." : "Chưa tải được danh sách."}>
          {logs.error.offline ? "Gán cần mạng để đối chiếu với ngân hàng." : errorText(logs.error)}
          <div style={{ marginTop: "10px" }}>
            <button type="button" class="btn" onClick={logs.reload}>
              Tải lại
            </button>
          </div>
        </Empty>
      ) : count === 0 ? (
        <Empty title="Không còn gì chưa gán.">Sổ khớp ngân hàng.</Empty>
      ) : selected ? (
        logs.data!.map((l) => <LogRow key={l.id} log={l} boot={boot} current={l.id === selected.id} onOpen={() => setSel(l.id)} />)
      ) : (
        logs.data!.map((l) => <LogRow key={l.id} log={l} boot={boot} onOpen={() => setOpen(l)} />)
      )}
    </Card>
  );

  return (
    <>
      <PageHeader title="Gán giao dịch" sub={logs.data ? (count ? `${count} chưa gán` : "Không còn gì chưa gán") : "Giao dịch ngân hàng chờ gán"} />
      {!online && !logs.data && <NeedsNetwork what="Gán giao dịch" />}
      {selected && boot ? (
        <div class="dk-cols">
          <div>{list}</div>
          <AssignSheet key={selected.id} wide log={selected} boot={boot} onClose={() => setSel(null)} onDone={done} />
        </div>
      ) : (
        list
      )}
      {logs.cachedAt && <p class="status-row">Danh sách lúc {timeHM(logs.cachedAt)} — đang không có mạng.</p>}
      {open && boot && <AssignSheet log={open} boot={boot} onClose={() => setOpen(null)} onDone={done} />}
    </>
  );
}

export function LogRow({ log, boot, onOpen, current }: { log: BankLog; boot: Bootstrap | null; onOpen: () => void; current?: boolean }) {
  const acct = boot?.accounts.find((a) => a.id === log.account_id)?.name ?? log.account_id ?? "";
  const isToday = dayKey(log.at) === dayKey(new Date());
  const s = log.suggestion;
  const hint = s?.possible_duplicate_of
    ? { cls: "chip warn", text: "có thể trùng — xem trước khi gán" }
    : s?.is_salary && !s.tenant_id
    ? { cls: "chip ok", text: "khớp mẫu lương" }
    : log.direction === "in" && !s
      ? { cls: "chip warn", text: "tiền vào — phải hỏi" }
      : s?.tenant_id
        ? { cls: "chip", text: `gợi ý: ${s.label ?? "thu từ người thuê"}` }
        : s?.meaning
          ? { cls: "chip", text: `gợi ý: ${s.label ?? boot?.categories.find((c) => c.id === s.category_id)?.name ?? boot?.wallets.find((w) => w.id === s.wallet_id)?.name ?? [...ASSIGN_CHOICES.out, ...ASSIGN_CHOICES.in].find((o) => o.value === s.meaning)?.label.toLowerCase() ?? "có luật"}` }
          : { cls: "chip", text: "chưa có luật" };
  return (
    <button type="button" class="log" onClick={onOpen} aria-current={current ? "true" : undefined}>
      <span class="t">
        {isToday ? timeHM(log.at) : `${shortDate(log.at)} ${timeHM(log.at)}`} · {acct}
      </span>
      <span class={log.direction === "in" ? "a in num" : "a num"}>
        {log.direction === "in" ? "+" : "−"}
        {groupDigits(log.amount)}
      </span>
      <span class="c">{log.content ?? "(không có nội dung)"}</span>
      <span class={`g ${hint.cls}`}>{hint.text}</span>
    </button>
  );
}

/** Dòng nhắc dưới chuyển nội bộ chưa chọn ví mà tiền vào tài khoản Tích sản (ADR-88); không phải thì không vẽ gì. */
function WealthBuildingMoveHint({ accounts, from, to }: { accounts: AccountRef[]; from: string | null | undefined; to: string | null | undefined }) {
  const text = wealthBuildingMoveHint(accounts, from, to);
  return text ? <p class="fhint">{text}</p> : null;
}

type Row = Split & { key: number; tenantMode?: boolean };
let rowSeq = 0;

function initialRows(log: BankLog, boot: Bootstrap, memberId: string | null): Row[] {
  const s = log.suggestion;
  if (log.direction === "in" && s?.tenant_id) {
    return [{ key: ++rowSeq, meaning: "income", tenantMode: true, tenant_id: s.tenant_id, amount: log.amount, taxable: false }];
  }
  const allowed = ASSIGN_CHOICES[log.direction === "in" ? "in" : "out"].map((o) => o.value);
  const meaning = (s?.meaning && allowed.includes(s.meaning as SplitMeaning) ? s.meaning : log.direction === "in" ? "income" : "spend") as SplitMeaning;
  const cat = boot.categories.find((c) => c.id === s?.category_id);
  const wallet = s?.wallet_id ?? (cat ? defaultWalletFor(boot, cat, memberId)?.id : null) ?? null;
  return [
    {
      key: ++rowSeq,
      meaning,
      amount: log.amount,
      category_id: s?.category_id ?? null,
      wallet_id: meaning === "collect" ? null : meaning === "transfer" ? s?.wallet_id ?? null : wallet,
      taxable: false,
      // Chuyển nội bộ gợi ý sẵn tài khoản đầu kia và chuyển ví (rút tiền mặt, bỏ heo đất / heo trả về — ADR-77, ADR-82).
      ...(meaning === "transfer" ? { other_account_id: s?.other_account_id ?? null, from_wallet_id: s?.from_wallet_id ?? null } : {}),
      ...(meaning === "lend" || meaning === "collect" ? { receivable_id: defaultReceivableId(boot.receivables) } : {}),
    },
  ];
}

/** Form gán một log. Điện thoại: trong sheet. Máy tính: panel bên phải danh sách (không có sheet). */
function AssignSheet({ log, boot, onClose, onDone, wide }: { log: BankLog; boot: Bootstrap; onClose: () => void; onDone: () => void; wide?: boolean }) {
  const { online, member } = useApp();
  const memberId = member?.id ?? null;
  const wallets = useMemo(() => spendableWallets(boot.wallets, memberId), [boot, memberId]);
  const fromWallets = useMemo(() => moveWallets(boot.wallets, memberId, "from"), [boot, memberId]);
  const toWallets = useMemo(() => moveWallets(boot.wallets, memberId, "to"), [boot, memberId]);
  const isIn = log.direction === "in";
  const rental = useResource<Rental>(isIn ? "/v1/rental" : null).data;
  const streams = (useResource<SettingsData>(isIn ? "/v1/settings" : null).data?.incomeStreams ?? []).filter((s) => s.active);
  const tenants = (rental?.tenants ?? []).filter((t) => t.active);
  const debts = payableDebts(boot.debts);
  const debtCategory = boot.categories.find((c) => c.id === DEBT_CATEGORY_ID);
  const receivables = boot.receivables ?? [];
  const [rows, setRows] = useState<Row[]>(() => initialRows(log, boot, memberId));
  const [makeRule, setMakeRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmIgnore, setConfirmIgnore] = useState(false);
  const [plan, setPlan] = useState<AllocationPlan | null>(null);
  const options = isIn ? ASSIGN_CHOICES.in.filter((o) => o.value !== "tenant" || tenants.length > 0 || rows.some((r) => r.tenantMode)) : ASSIGN_CHOICES.out;
  const check = validateSplits(log.amount, rows);
  const noTenant = rows.some((r) => r.tenantMode && !r.tenant_id);
  // Dòng đang hỏi tên người mới (ô Ai trả / Cho ai vay): gán lúc này là gán khi chưa có người — chờ Thêm người.
  const [naming, setNaming] = useState<number[]>([]);
  const blocked = noTenant || naming.length > 0;
  // Như server (routes/logs.ts): chỉ tạo rule khi gán đúng một dòng chi tiêu hoặc chuyển nội bộ; tiền vào luôn phải hỏi.
  const ruleAllowed = rows.length === 1 && (rows[0]!.meaning === "spend" || rows[0]!.meaning === "transfer");
  const income = rows.find((r) => r.meaning === "income");
  // Người thuê trả mà không chọn nguồn: server tự gán nguồn cho thuê — chia thử cũng theo nguồn đó.
  const previewStream = income?.income_stream_id || (income?.tenant_id ? rental?.incomeStreamId : null) || null;

  useEffect(() => {
    setPlan(null);
    if (!income || !income.amount || !online) return;
    const t = setTimeout(() => {
      api
        .post<AllocationPlan>("/v1/allocate/preview", {
          amount: income.amount,
          taxable: income.taxable === true,
          at: log.at,
          account_id: log.account_id,
          ...(previewStream ? { income_stream_id: previewStream } : {}),
        })
        .then(setPlan)
        .catch(() => setPlan(null));
    }, 350);
    return () => clearTimeout(t);
  }, [income?.amount, income?.taxable, previewStream, online]);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function choose(r: Row, c: AssignChoice) {
    if (c === "tenant") update(r.key, { meaning: "income", tenantMode: true, tenant_id: r.tenant_id ?? tenants[0]?.id ?? null, income_stream_id: null });
    else
      update(r.key, {
        meaning: c,
        tenantMode: false,
        tenant_id: null,
        // Khoản gốc chỉ thuộc dòng Hoàn tiền / Nhận lại, và đi cùng danh mục, ví hay người của nó: đổi loại là bỏ, quay lại thì chọn lại.
        link_id: null,
        ...(c === "transfer" ? { wallet_id: null, from_wallet_id: null } : {}),
        // Cho vay / nhận lại tiền cho vay không đụng ví, không có danh mục (server tự gắn "Cho vay / trả hộ" cho cho vay).
        ...(c === "collect" || c === "lend" ? { wallet_id: null, category_id: null } : {}),
        ...(c === "lend" || c === "collect" ? { receivable_id: r.receivable_id ?? defaultReceivableId(boot.receivables) } : {}),
      });
  }

  function cashWithdrawal() {
    setRows([{ key: ++rowSeq, meaning: "transfer", amount: log.amount, other_account_id: defaultAccountFor(boot, memberId, "in") }]);
  }

  /** `defer`: khoản thu chỉ gán vào sổ (nằm ở ví Thu nhập), không gọi /v1/allocate — chia sau ở chi tiết giao dịch. */
  async function submit(defer = false) {
    if (!check.ok || blocked) return;
    setBusy(true);
    setError(null);
    try {
      const splits = rows.map(({ key: _k, tenantMode: _t, tenant_id, income_stream_id, from_wallet_id, debt_id, receivable_id, link_id, ...s }) => ({
        ...s,
        ...(s.meaning === "income" && tenant_id ? { tenant_id } : {}),
        ...(s.meaning === "income" && income_stream_id ? { income_stream_id } : {}),
        ...(s.meaning === "transfer" && from_wallet_id ? { from_wallet_id } : {}),
        ...(s.meaning === "spend" && debt_id ? { debt_id } : {}),
        ...((s.meaning === "lend" || s.meaning === "collect") && receivable_id ? { receivable_id } : {}),
        ...((s.meaning === "refund" || s.meaning === "collect") && link_id ? { link_id } : {}),
      }));
      const res = await api.post<{ log: unknown; transactions: { id: number; meaning: string }[]; attached?: boolean }>(`/v1/logs/${encodeURIComponent(log.id)}/assign`, {
        splits,
        create_rule: makeRule && ruleAllowed,
      });
      if (res.attached) {
        await refresh();
        toast(`Đã khớp vào chuyển nội bộ đã ghi ${formatVnd(log.amount)} — không ghi thêm.`);
        onDone();
        return;
      }
      if (defer) {
        const incomeTotal = rows.filter((r) => r.meaning === "income").reduce((s, r) => s + r.amount, 0);
        await refresh();
        toast(deferredIncomeToast(incomeTotal));
        onDone();
        return;
      }
      let orders = 0;
      for (const tx of res.transactions.filter((t) => t.meaning === "income")) {
        try {
          orders += (await api.post<AllocationPlan>("/v1/allocate", { income_tx_id: tx.id })).transferOrders.length;
        } catch (err) {
          if (!(err instanceof ApiError && err.code === "already_allocated")) throw new Error(`Đã gán nhưng chưa chia khoản thu: ${errorText(err)}`);
        }
      }
      // Toast nói hệ quả (DESIGN §4): tải lại số rồi đọc ví còn bao nhiêu và tổng lệnh chuyển tiền đang chờ.
      await refresh();
      const after = getState();
      const view = after.stale ? null : viewSnapshot(after);
      const one = rows[0]!;
      const walletId = rows.length === 1 ? one.wallet_id : null;
      toast(
        assignToast(rows, {
          label: boot.categories.find((c) => c.id === one.category_id)?.name ?? MEANING_LABEL[one.meaning] ?? one.meaning,
          status: view && walletId ? localWalletStatus(view, walletId, new Date()) : null,
          newOrders: orders,
          pendingOrders: view ? view.attention.transferOrdersPending : null,
        }),
      );
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function ignore() {
    setBusy(true);
    try {
      await api.post(`/v1/logs/${encodeURIComponent(log.id)}/ignore`);
      toast("Đã bỏ qua giao dịch này. Nó không vào sổ.");
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const title = `${log.direction === "in" ? "Tiền vào" : "Tiền ra"} ${formatVnd(log.amount)}`;
  const body = (
    <>
      <div class="pad" style={{ paddingTop: "10px", fontSize: "13px", color: "var(--fg-2)" }}>
        <div class="num" style={{ overflowWrap: "anywhere" }}>
          {log.content ?? "(không có nội dung)"}
        </div>
        <div class="sub-line">
          {shortDate(log.at)} {timeHM(log.at)} · {boot.accounts.find((a) => a.id === log.account_id)?.name ?? log.account_id}
        </div>
      </div>
      {log.suggestion?.possible_duplicate_of && (
        <div style={{ padding: "4px 16px 0" }}>
          <Banner tone="warn" mark="!">
            Có thể <strong>trùng</strong> với một giao dịch cùng số tiền, cùng tài khoản đã ghi trong vòng 3 phút. Đúng là một thì bấm <strong>Bỏ qua</strong>; là hai khoản khác nhau thì gán như bình thường.
          </Banner>
        </div>
      )}
      {log.suggestion?.note && (
        <div style={{ padding: "4px 16px 0" }}>
          <Banner tone="warn" mark="!">
            {log.suggestion.note}
          </Banner>
        </div>
      )}
      {log.suggestion?.attach_to_tx && (
        <div style={{ padding: "4px 16px 0" }}>
          <Banner tone="info" mark="=">
            <strong>{log.suggestion.label ?? "Khớp chuyển nội bộ đã ghi"}</strong> từ tài khoản kia. Gán Chuyển nội bộ với đúng tài khoản đó là gắn vào giao dịch đã ghi — không ghi thêm, không đếm hai lần.
          </Banner>
        </div>
      )}
      {log.direction === "in" && log.suggestion?.tenant_id && (
        <div style={{ padding: "4px 16px 0" }}>
          <Banner tone="info" mark="?">
            Gợi ý: <strong>{log.suggestion.label ?? "Thu từ người thuê"}</strong>. Máy chỉ gợi ý — xem đúng người, đúng số rồi mới bấm Gán.
          </Banner>
        </div>
      )}
      {log.direction === "in" && !log.suggestion?.is_salary && !log.suggestion?.possible_duplicate_of && !log.suggestion?.tenant_id && !log.suggestion?.attach_to_tx && (
        <div style={{ padding: "4px 16px 0" }}>
          <Banner tone="warn" mark="?">
            Tiền vào <strong>luôn phải hỏi</strong>. Máy không đoán được đây là thu nhập hay người ta trả lại tiền. Không chắc chọn loại nào?{" "}
            <a href={GUIDE_PICK_KIND_URL} target="_blank" rel="noopener noreferrer" class="font-medium underline underline-offset-2">
              Xem bảng chọn loại trong hướng dẫn.
            </a>
          </Banner>
        </div>
      )}
      {log.direction === "out" && (
        <div style={{ padding: "4px 16px 0" }}>
          <button type="button" class="btn" style={{ width: "100%" }} onClick={cashWithdrawal}>
            Rút tiền mặt — chỉ đổi chỗ, không phải chi tiêu
          </button>
        </div>
      )}

      {rows.map((r, i) => (
        <fieldset key={r.key} style={{ border: 0, margin: "12px 0 0", padding: 0, borderTop: "1px solid var(--border)", minWidth: 0 }}>
          <legend class="sr-only">Dòng {i + 1}</legend>
          <div class="pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "8px" }}>
            <strong style={{ fontSize: "13px" }}>{rows.length > 1 ? `Dòng ${i + 1}` : "Gán thành"}</strong>
            {rows.length > 1 && (
              <button type="button" class="btn btn-ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                Bỏ dòng
              </button>
            )}
          </div>
          <Seg class="px-4 pb-2" label={`Loại dòng ${i + 1}`} value={r.tenantMode ? "tenant" : r.meaning} options={options} onChange={(c) => choose(r, c)} />
          <p class="fhint" style={{ padding: "0 16px 8px" }}>
            {options.find((o) => o.value === (r.tenantMode ? "tenant" : r.meaning))?.hint}
          </p>
          <div class="field">
            <label for={`s-amt-${r.key}`}>Số tiền</label>
            <AmountInput id={`s-amt-${r.key}`} value={r.amount} onChange={(n) => update(r.key, { amount: n })} invalid={!r.amount} />
          </div>
          {r.meaning === "spend" && debts.length > 0 && (
            <div class="field">
              <label for={`s-d-${r.key}`}>Trả nợ cho</label>
              <select
                id={`s-d-${r.key}`}
                class="ctl"
                value={r.debt_id ?? ""}
                onChange={(e) => {
                  const id = e.currentTarget.value || null;
                  // Trả nợ luôn vào danh mục Trả nợ, ví theo danh mục đó (ví giữ riêng).
                  update(r.key, id && debtCategory ? { debt_id: id, category_id: debtCategory.id, wallet_id: defaultWalletFor(boot, debtCategory, memberId)?.id ?? r.wallet_id } : { debt_id: id });
                }}
              >
                <option value="">không phải trả nợ</option>
                {debts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {bookRefLabel(d)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(r.meaning === "lend" || r.meaning === "collect") && (
            <ReceivablePicker
              id={`s-r-${r.key}`}
              meaning={r.meaning}
              amount={r.amount}
              receivables={receivables}
              value={r.receivable_id ?? null}
              // Khoản cho vay đã chọn là của một người: đổi người là bỏ khoản đó.
              onChange={(id) => update(r.key, { receivable_id: id, link_id: null })}
              onPendingChange={(p) => setNaming((ks) => (p ? [...ks, r.key] : ks.filter((k) => k !== r.key)))}
              split
            />
          )}
          {r.meaning === "collect" && (
            <LinkSourcePicker
              id={`s-lc-${r.key}`}
              kind="lend"
              amount={r.amount}
              value={r.link_id ?? null}
              receivableId={r.receivable_id ?? null}
              onPick={(id, c) => update(r.key, { link_id: id, ...(c?.receivable_id ? { receivable_id: c.receivable_id } : {}) })}
            />
          )}
          {r.meaning === "refund" && (
            <LinkSourcePicker
              id={`s-l-${r.key}`}
              kind="spend"
              amount={r.amount}
              value={r.link_id ?? null}
              onPick={(id, c) =>
                update(r.key, { link_id: id, ...(c ? { category_id: c.category_id, wallet_id: walletOfMember(boot, c.wallet_id, memberId)?.id ?? r.wallet_id } : {}) })
              }
            />
          )}
          {(r.meaning === "spend" || r.meaning === "refund") && (
            <div class="field">
              <label for={`s-cat-${r.key}`}>Danh mục</label>
              <CategorySelect
                id={`s-cat-${r.key}`}
                categories={boot.categories}
                value={r.category_id ?? null}
                allowNone={r.meaning === "spend" ? "Chọn danh mục" : "không chọn"}
                onChange={(id) => {
                  const c = boot.categories.find((x) => x.id === id);
                  update(r.key, { category_id: id || null, ...(c ? { wallet_id: defaultWalletFor(boot, c, memberId)?.id ?? r.wallet_id } : {}) });
                }}
              />
            </div>
          )}
          {(r.meaning === "spend" || r.meaning === "refund") && (
            <div class="field">
              <label for={`s-w-${r.key}`}>Ví</label>
              <WalletSelect id={`s-w-${r.key}`} wallets={wallets} value={r.wallet_id ?? null} onChange={(id) => update(r.key, { wallet_id: id })} placeholder="theo danh mục" />
            </div>
          )}
          {r.meaning === "transfer" && (
            <>
              <div class="field">
                <label for={`s-o-${r.key}`}>{log.direction === "out" ? "Tiền sang" : "Tiền từ"}</label>
                <AccountSelect id={`s-o-${r.key}`} accounts={boot.accounts.filter((a) => a.id !== log.account_id)} value={r.other_account_id ?? null} onChange={(id) => update(r.key, { other_account_id: id })} />
              </div>
              <div class="field">
                <label for={`s-wf-${r.key}`}>Từ ví</label>
                <WalletSelect id={`s-wf-${r.key}`} wallets={fromWallets} value={r.from_wallet_id ?? null} onChange={(id) => update(r.key, { from_wallet_id: id || null })} placeholder="không chuyển ví" />
              </div>
              <div class="field">
                <label for={`s-wt-${r.key}`}>Đến ví</label>
                <WalletSelect id={`s-wt-${r.key}`} wallets={toWallets} value={r.wallet_id ?? null} onChange={(id) => update(r.key, { wallet_id: id || null })} placeholder="không chuyển ví" />
              </div>
              {(r.from_wallet_id || r.wallet_id) && (
                <div class="field" style={{ justifyContent: "flex-end", borderTop: 0, paddingTop: 0 }}>
                  <button type="button" class="btn btn-ghost" onClick={() => update(r.key, { from_wallet_id: null, wallet_id: null })}>
                    Không chuyển ví
                  </button>
                </div>
              )}
              {!r.from_wallet_id && !r.wallet_id && (
                // Vào tài khoản Tích sản (heo, phao, sổ) từ tài khoản thường: server tự chuyển ví Có thì tốt → Tích sản (ADR-88).
                <WealthBuildingMoveHint accounts={boot.accounts} from={isIn ? r.other_account_id : log.account_id} to={isIn ? log.account_id : r.other_account_id} />
              )}
            </>
          )}
          {r.tenantMode && (
            <div class="field">
              <label for={`s-t-${r.key}`}>Người thuê</label>
              <select id={`s-t-${r.key}`} class="ctl" value={r.tenant_id ?? ""} onChange={(e) => update(r.key, { tenant_id: e.currentTarget.value || null })}>
                {!r.tenant_id && <option value="">Chọn người thuê</option>}
                {(rental?.tenants ?? [])
                  .filter((t) => t.active || t.id === r.tenant_id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          {r.meaning === "income" && !r.tenantMode && (
            <>
              {streams.length > 0 && (
                <div class="field">
                  <label for={`s-st-${r.key}`}>Nguồn thu</label>
                  <select id={`s-st-${r.key}`} class="ctl" value={r.income_stream_id ?? ""} onChange={(e) => update(r.key, { income_stream_id: e.currentTarget.value || null })}>
                    <option value="">Mặc định (luật % chung)</option>
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
                  value={r.taxable ? "yes" : "no"}
                  onChange={(v) => update(r.key, { taxable: v === "yes" })}
                  options={[
                    { value: "no", label: "Đã khấu trừ tại nguồn" },
                    { value: "yes", label: "Chưa — để riêng thuế" },
                  ]}
                />
              </div>
            </>
          )}
          {r.meaning === "buy_asset" && (
            <div class="field" style={{ flexWrap: "wrap" }}>
              <span class="k">Loại tài sản</span>
              <Seg label="Loại tài sản" value={(r.asset_kind ?? "") as string} onChange={(v) => update(r.key, { asset_kind: v })} options={[...ASSET_KINDS]} />
            </div>
          )}
          <div class="field">
            <label for={`s-note-${r.key}`}>Ghi chú</label>
            <input
              id={`s-note-${r.key}`}
              class="ctl"
              maxLength={500}
              placeholder="mua gì, cho ai — không bắt buộc"
              value={r.note ?? ""}
              onInput={(e) => update(r.key, { note: e.currentTarget.value || null })}
            />
          </div>
        </fieldset>
      ))}

      <div class="field" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          class="btn"
          onClick={() => setRows((rs) => [...rs, { key: ++rowSeq, meaning: isIn ? "income" : "spend", amount: Math.max(0, check.diff), category_id: null, wallet_id: null }])}
        >
          <Icon name="plus" size={16} />
          Tách thêm dòng
        </button>
        <span class={check.ok && !blocked ? "sub-line" : "err"} role="status" style={{ textAlign: "right" }}>
          {noTenant ? "Chọn người thuê." : naming.length > 0 ? "Bấm Thêm người trước khi gán." : check.ok ? `Khớp ${formatVnd(log.amount)}` : check.message}
        </span>
      </div>
      {ruleAllowed && (
        <div class="field">
          <label class="check">
            <input type="checkbox" checked={makeRule} onChange={(e) => setMakeRule(e.currentTarget.checked)} />
            Lần sau tự gán giao dịch có nội dung giống thế này
          </label>
        </div>
      )}

      {plan && income && <AllocationPreview plan={plan} boot={boot} amount={income.amount} />}

      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || !check.ok || blocked || (!!income && !plan)} onClick={() => void submit()}>
          {busy ? "Đang gán…" : income ? "Gán, chia và ghi sổ" : "Gán"}
        </button>
        {income && (
          <button type="button" class="btn" style={{ width: "100%", marginTop: "8px" }} disabled={!online || busy || !check.ok || blocked} onClick={() => void submit(true)}>
            Gán, để chia sau
          </button>
        )}
        {!online && <NeedsNetwork what="Gán giao dịch" />}
        <button
          type="button"
          class={confirmIgnore ? "btn btn-bad" : "btn btn-ghost"}
          style={{ width: "100%", marginTop: "8px" }}
          disabled={!online || busy}
          onClick={() => (confirmIgnore ? void ignore() : setConfirmIgnore(true))}
        >
          {confirmIgnore ? "Bỏ qua hẳn — giao dịch này không vào sổ" : "Bỏ qua giao dịch này"}
        </button>
      </div>
    </>
  );

  if (wide) {
    return (
      <section class="card dk-panel" aria-label={`Gán: ${title}`}>
        <div class="card-h" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2>{title}</h2>
          <span class="hint">gán thành một hoặc nhiều dòng</span>
        </div>
        {body}
      </section>
    );
  }
  return (
    <Sheet open title={title} onClose={onClose}>
      {body}
    </Sheet>
  );
}
