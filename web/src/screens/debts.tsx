// Nợ (Ví & Quỹ › Nợ): tiền thật trước (GET /v1/networth), rồi hai sổ đối ứng — "Mình nợ" (sổ nợ) và "Người khác nợ mình" (sổ phải thu).
// Hai sổ dùng chung một bộ giao diện (memo-book.tsx); số ở hai sổ là ghi nhớ ai nợ ai, nằm ngoài sổ cái, không phải tiền trong ví.
// Trả nợ là khoản chi danh mục Trả nợ gắn vào khoản nợ; cho vay / nhận lại tiền là giao dịch đổi tài khoản, không đụng ví.
// Ba việc đó đi qua hàng đợi như mọi khoản nhập (ghi được khi không có mạng). Thêm khoản, thêm dòng, huỷ dòng ghi thẳng lên server nên cần mạng.

import { useState } from "preact/hooks";
import { defaultAccountFor, manualAccounts } from "../lib/categories";
import { debtLinePayload, debtPayload, owedText } from "../lib/debts";
import { groupBook } from "../lib/memo-books";
import { formatVnd } from "../lib/money";
import { netWorthLines } from "../lib/networth";
import { atForDay, dayKey } from "../lib/period";
import { collectToast, defaultReceivableId, lendToast, moneyMoveBody, receivableLinePayload, receivablePayload, unpaidText } from "../lib/receivables";
import type { Debt, DebtsData, NetWorth, Receivable, ReceivableRef, ReceivablesData } from "../lib/types";
import { useResource } from "../state/resource";
import { refresh, saveEntry, toast, useApp } from "../state/store";
import { AccountSelect, AmountInput, newClientId } from "../ui/fields";
import { Money } from "../ui/money";
import { Loadable, Sheet } from "../ui/parts";
import { DebtSheet } from "./budget-sheets";
import { type BookItem, type BookLabels, BookAddSheet, BookCard, BookDetailSheet, BookLineSheet } from "./memo-book";
import { LinkSourcePicker } from "./ref-pickers";

const DEBT: BookLabels = {
  title: "Mình nợ",
  note: "Còn nợ = đã vay − đã trả. Trả nợ là khoản chi danh mục Trả nợ từ ví giữ riêng; trả qua tài khoản SePay báo cả tiền ra thì gán ở màn Gán.",
  emptyTitle: "Chưa ghi khoản nợ nào.",
  emptyBody: "Thêm từng khoản nợ với số còn nợ hôm nay; mỗi lần trả nợ, số này tự giảm.",
  noun: "khoản nợ",
  book: "sổ nợ",
  totalLabel: "Tổng còn nợ",
  openCount: (n) => `${n} khoản đang trả`,
  allDone: "Đã trả xong mọi khoản.",
  doneGroup: "Đã trả xong",
  doneText: "Đã trả xong.",
  totalWord: "Đã vay",
  backWord: "Đã trả",
  balanceWord: "Còn nợ",
  remain: owedText,
  kindLabel: { opening: "Mở sổ", borrow: "Vay thêm", adjust: "Chỉnh" },
  primary: "Trả nợ",
  offline: "vay thêm, chỉnh",
  offlineDetail: "Vay thêm, chỉnh, huỷ dòng",
  add: {
    nameLabel: "Nợ ai",
    namePlaceholder: "cô Lan",
    nameMissing: "Nhập nợ ai",
    amountLabel: "Còn nợ",
    notePlaceholder: "vay sửa nhà, trả mỗi tháng",
    hint: "Ghi số còn nợ hôm nay, không phải số vay ban đầu. Sau này vay thêm thì ghi Vay thêm ở khoản này.",
  },
  adjust: {
    title: "Chỉnh số nợ",
    up: "Tăng nợ",
    down: "Giảm nợ",
    placeholder: "bớt lãi, ghi nhầm số",
    hint: "Chỉnh khi số trong sổ lệch với số thật (lãi, được bớt). Trả nợ thì dùng Trả nợ, không chỉnh.",
  },
  balanceHint: (name, balance) => `${name} đang còn nợ ${formatVnd(balance)}.`,
};

const BORROW = { title: "Vay thêm", placeholder: "vay thêm đóng học", hint: "Số còn nợ tăng thêm đúng số này.", verb: "vay thêm" };

const RECEIVABLE: BookLabels = {
  title: "Người khác nợ mình",
  note: "Còn phải thu = đã cho vay − đã nhận lại. Cho vay và nhận lại tiền chỉ đổi tài khoản, không đụng ví nào; tiền nhận lại không phải thu nhập.",
  emptyTitle: "Chưa ghi khoản phải thu nào.",
  emptyBody: "Cho ai vay hay trả hộ ai thì thêm một khoản với số người đó còn nợ hôm nay; mỗi lần nhận lại tiền, số này tự giảm.",
  noun: "khoản phải thu",
  book: "sổ phải thu",
  totalLabel: "Tổng còn phải thu",
  openCount: (n) => `${n} khoản chưa trả xong`,
  allDone: "Mọi người đã trả đủ.",
  doneGroup: "Đã trả đủ",
  doneText: "Đã trả đủ.",
  totalWord: "Đã cho vay",
  backWord: "Đã nhận lại",
  balanceWord: "Còn phải thu",
  remain: unpaidText,
  kindLabel: { opening: "Mở sổ", adjust: "Chỉnh" },
  primary: "Nhận lại tiền",
  offline: "chỉnh",
  offlineDetail: "Chỉnh, huỷ dòng",
  add: {
    nameLabel: "Ai nợ mình",
    namePlaceholder: "em Tú",
    nameMissing: "Nhập ai nợ mình",
    amountLabel: "Còn nợ mình",
    notePlaceholder: "mượn mua xe, trả hộ tiền học",
    hint: "Ghi số người đó còn nợ hôm nay; chưa nợ gì thì để 0. Thêm khoản chỉ để nhớ, không trừ tài khoản hay ví nào. Sau này cho vay thêm thì dùng Cho vay thêm ở khoản này.",
    zeroButton: "Thêm người, chưa nợ gì",
  },
  adjust: {
    title: "Chỉnh số phải thu",
    up: "Tăng số phải thu",
    down: "Giảm số phải thu",
    placeholder: "bớt cho, ghi nhầm số",
    hint: "Chỉnh khi số trong sổ lệch với số thật (bớt cho, ghi nhầm). Nhận lại tiền thì dùng Nhận lại tiền, không chỉnh.",
  },
  balanceHint: (name, balance) => `${name} còn nợ mình ${formatVnd(balance)}.`,
};

const debtItem = (d: Debt): BookItem => ({ id: d.id, name: d.name, note: d.note, total: d.owed, back: d.paid, balance: d.balance, done: d.done });
const receivableItem = (r: Receivable): BookItem => ({ id: r.id, name: r.name, note: r.note, total: r.lent, back: r.collected, balance: r.balance, done: r.done });

type Book = "debt" | "receivable";
type Open =
  | { kind: "add"; book: Book }
  | { kind: "detail"; book: Book; id: string }
  | { kind: "pay"; id?: string }
  | { kind: "line"; book: Book; id: string; line: "borrow" | "adjust" }
  | { kind: "move"; meaning: "lend" | "collect"; id?: string }
  | null;

export function DebtsTab() {
  const { boot, online } = useApp();
  const debts = useResource<DebtsData>("/v1/debts");
  const receivables = useResource<ReceivablesData>("/v1/receivables");
  const networth = useResource<NetWorth>("/v1/networth");
  const [open, setOpen] = useState<Open>(null);
  const accountName = (id: string | null) => boot?.accounts.find((a) => a.id === id)?.name ?? null;

  // Số còn lại cũng nằm trong bootstrap (ô chọn khoản khi trả nợ / cho vay, màn Gán): tải lại cả hai.
  const changed = (text: string) => {
    toast(text);
    debts.reload();
    receivables.reload();
    networth.reload();
    void refresh();
  };

  const findDebt = (id: string) => debts.data?.debts.find((d) => d.id === id) ?? null;
  const findReceivable = (id: string) => receivables.data?.receivables.find((r) => r.id === id) ?? null;
  const detailDebt = open?.kind === "detail" && open.book === "debt" ? findDebt(open.id) : null;
  const detailReceivable = open?.kind === "detail" && open.book === "receivable" ? findReceivable(open.id) : null;
  const lineDebt = open?.kind === "line" && open.book === "debt" ? findDebt(open.id) : null;
  const lineReceivable = open?.kind === "line" && open.book === "receivable" ? findReceivable(open.id) : null;
  // Ô chọn khoản phải thu trong tab này dùng số mới nhất của sổ, không chờ bootstrap.
  const rg = receivables.data ? groupBook(receivables.data.receivables) : null;
  const receivableRefs: ReceivableRef[] = rg ? [...rg.open, ...rg.done] : (boot?.receivables ?? []);

  return (
    <>
      <Loadable res={networth}>{(nw) => <CashFirst nw={nw} />}</Loadable>

      <Loadable res={debts}>
        {(data) => {
          const g = groupBook(data.debts);
          return (
            <BookCard
              labels={DEBT}
              totalBalance={data.totalBalance}
              open={g.open.map(debtItem)}
              done={g.done.map(debtItem)}
              onOpen={(id) => setOpen({ kind: "detail", book: "debt", id })}
              onAdd={() => setOpen({ kind: "add", book: "debt" })}
              onPrimary={() => setOpen({ kind: "pay" })}
            />
          );
        }}
      </Loadable>

      <Loadable res={receivables}>
        {(data) => {
          const g = groupBook(data.receivables);
          return (
            <BookCard
              labels={RECEIVABLE}
              totalBalance={data.totalBalance}
              open={g.open.map(receivableItem)}
              done={g.done.map(receivableItem)}
              onOpen={(id) => setOpen({ kind: "detail", book: "receivable", id })}
              onAdd={() => setOpen({ kind: "add", book: "receivable" })}
              onPrimary={() => setOpen({ kind: "move", meaning: "collect" })}
            />
          );
        }}
      </Loadable>

      <p class="hint" style={{ margin: "0 4px 12px" }}>
        Số ở đây là ghi nhớ ai nợ ai — chưa phải tiền trong ví. Chỉ khi tiền thật đi hoặc về thì ví và tài khoản mới đổi.
      </p>

      {open?.kind === "add" &&
        (open.book === "debt" ? (
          <BookAddSheet labels={DEBT} path="/v1/debts" payload={debtPayload} onClose={() => setOpen(null)} onSaved={changed} />
        ) : (
          <BookAddSheet labels={RECEIVABLE} path="/v1/receivables" payload={receivablePayload} onClose={() => setOpen(null)} onSaved={changed} />
        ))}
      {detailDebt && (
        <BookDetailSheet
          labels={DEBT}
          item={debtItem(detailDebt)}
          actions={[
            { label: "Trả nợ", primary: true, disabled: detailDebt.balance <= 0, onClick: () => setOpen({ kind: "pay", id: detailDebt.id }) },
            { label: "Vay thêm", disabled: !online, onClick: () => setOpen({ kind: "line", book: "debt", id: detailDebt.id, line: "borrow" }) },
            { label: "Chỉnh", disabled: !online, onClick: () => setOpen({ kind: "line", book: "debt", id: detailDebt.id, line: "adjust" }) },
          ]}
          lines={detailDebt.lines}
          movements={detailDebt.payments.map((p) => ({
            key: `p${p.transactionId}`,
            at: p.at,
            label: "Đã trả",
            sub: [accountName(p.accountId), p.source === "sepay" ? "SePay" : null, p.note],
            amount: -p.amount,
            txId: p.transactionId,
          }))}
          voidPath={(id) => `/v1/debt-lines/${id}/void`}
          onClose={() => setOpen(null)}
          onVoided={changed}
        />
      )}
      {detailReceivable && (
        <BookDetailSheet
          labels={RECEIVABLE}
          item={receivableItem(detailReceivable)}
          actions={[
            { label: "Nhận lại tiền", primary: true, disabled: detailReceivable.balance <= 0, onClick: () => setOpen({ kind: "move", meaning: "collect", id: detailReceivable.id }) },
            { label: "Cho vay thêm", onClick: () => setOpen({ kind: "move", meaning: "lend", id: detailReceivable.id }) },
            { label: "Chỉnh", disabled: !online, onClick: () => setOpen({ kind: "line", book: "receivable", id: detailReceivable.id, line: "adjust" }) },
          ]}
          lines={detailReceivable.lines}
          movements={detailReceivable.movements.map((m) => ({
            key: `m${m.transactionId}`,
            at: m.at,
            label: m.kind === "lend" ? "Cho vay thêm" : "Nhận lại",
            sub: [accountName(m.accountId), m.source === "sepay" ? "SePay" : null, m.note],
            amount: m.kind === "lend" ? m.amount : -m.amount,
            txId: m.transactionId,
          }))}
          voidPath={(id) => `/v1/receivable-lines/${id}/void`}
          onClose={() => setOpen(null)}
          onVoided={changed}
        />
      )}
      {open?.kind === "pay" && <DebtSheet debtId={open.id} onClose={() => setOpen(null)} />}
      {lineDebt && open?.kind === "line" && (
        <BookLineSheet
          labels={DEBT}
          item={debtItem(lineDebt)}
          kind={open.line}
          increase={BORROW}
          path={`/v1/debts/${encodeURIComponent(lineDebt.id)}/lines`}
          payload={debtLinePayload}
          onClose={() => setOpen(null)}
          onSaved={changed}
        />
      )}
      {lineReceivable && (
        <BookLineSheet
          labels={RECEIVABLE}
          item={receivableItem(lineReceivable)}
          kind="adjust"
          path={`/v1/receivables/${encodeURIComponent(lineReceivable.id)}/lines`}
          payload={receivableLinePayload}
          onClose={() => setOpen(null)}
          onSaved={changed}
        />
      )}
      {open?.kind === "move" && <MoneyMoveSheet meaning={open.meaning} refs={receivableRefs} receivableId={open.id} onClose={() => setOpen(null)} />}
    </>
  );
}

/**
 * Tiền thật trước (DESIGN.md §4): tiền thật đang có là số to nhất; tài sản, người khác nợ mình, mình nợ kê bên dưới,
 * tài sản ròng đứng cuối và nhỏ hơn — nó không giúp quyết định tiêu gì hôm nay.
 */
function CashFirst({ nw }: { nw: NetWorth }) {
  const [hero, ...rest] = netWorthLines(nw);
  const total = rest.pop()!;
  return (
    <section class="hero" aria-label="Tiền thật trước">
      <div class="lab">
        {hero!.label} <span class="sub-line">· {hero!.hint}</span>
      </div>
      <div class="big">
        <Money value={hero!.value} tone={false} />
      </div>
      <div class="meta">{hero!.note}</div>
      {rest.length > 0 && (
        <ul class="hero-parts">
          {rest.map((l) => (
            <li key={l.key} style={l.level === "part" ? { paddingLeft: "12px", fontSize: "12.5px" } : undefined}>
              <span>
                {l.label}
                {l.note && <span class="sub-line"> · {l.note}</span>}
              </span>
              <Money value={l.value} tone={false} />
            </li>
          ))}
        </ul>
      )}
      <ul class="hero-parts">
        <li>
          <span>{total.label}</span>
          <Money value={total.value} tone={false} />
        </li>
      </ul>
      <div class="meta">{total.note}</div>
    </section>
  );
}

/**
 * Cho vay thêm / nhận lại tiền cho vay: tiền thật rời một tài khoản hoặc về một tài khoản, gắn vào khoản phải thu.
 * Không đụng ví nào và không phải thu nhập. Đi qua hàng đợi như mọi khoản nhập.
 */
function MoneyMoveSheet(props: { meaning: "lend" | "collect"; refs: ReceivableRef[]; receivableId?: string; onClose: () => void }) {
  const { boot, member } = useApp();
  const memberId = member?.id ?? null;
  const lend = props.meaning === "lend";
  const direction = lend ? "out" : "in";
  const accounts = manualAccounts(boot?.accounts ?? [], direction);
  const [receivableId, setReceivableId] = useState<string | null>(() => defaultReceivableId(props.refs, props.receivableId));
  const [linkId, setLinkId] = useState<number | null>(null);
  const chosen = props.refs.find((r) => r.id === receivableId) ?? null;
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(() => (boot ? defaultAccountFor(boot, memberId, direction) : null));
  const [note, setNote] = useState("");
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [busy, setBusy] = useState(false);
  const today = dayKey(new Date());
  const problem = !chosen ? "Chọn khoản phải thu" : !amount ? "Nhập số tiền" : !accountId ? "Chọn tài khoản" : null;

  async function submit() {
    const r = moneyMoveBody({ meaning: props.meaning, amount, accountId, receivableId, linkId, note }, atForDay(day, new Date()), newClientId());
    if (problem || !r.ok || !chosen) return;
    setBusy(true);
    const saved = await saveEntry(r.value, lend ? lendToast(amount, chosen) : collectToast(amount, chosen));
    if (saved) props.onClose();
    else setBusy(false);
  }

  return (
    <Sheet open title={lend ? "Cho vay thêm" : "Nhận lại tiền cho vay"} onClose={props.onClose}>
      <div class="field" style={{ borderTop: 0 }}>
        <label for="r-recv">{lend ? "Cho ai vay" : "Ai trả"}</label>
        <select
          id="r-recv"
          class="ctl"
          value={receivableId ?? ""}
          onChange={(e) => {
            setReceivableId(e.currentTarget.value || null);
            // Khoản cho vay đã chọn là của người trước: đổi người là bỏ.
            setLinkId(null);
          }}
        >
          {!chosen && <option value="">Chọn khoản phải thu</option>}
          {props.refs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      {chosen && <p class="fhint">{RECEIVABLE.balanceHint(chosen.name, chosen.balance)}</p>}
      <div class="field">
        <label for="r-amount">Số tiền</label>
        <AmountInput id="r-amount" value={amount} onChange={setAmount} autoFocus />
      </div>
      {!lend && chosen && (
        <LinkSourcePicker id="r-link" kind="lend" amount={amount} value={linkId} receivableId={chosen.id} onlyReceivable onPick={(id) => setLinkId(id)} />
      )}
      <div class="field">
        <label for="r-acct">{lend ? "Tiền ra từ" : "Tiền vào"}</label>
        <AccountSelect id="r-acct" accounts={accounts} value={accountId} onChange={setAccountId} />
      </div>
      <div class="field">
        <label for="r-note">Ghi chú</label>
        <input id="r-note" class="ctl" maxLength={500} placeholder={lend ? "vay đóng học" : "trả đợt 1"} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label for="r-day">Ngày</label>
        <input id="r-day" class="ctl" type="date" max={today} value={day} onInput={(e) => setDay(e.currentTarget.value || today)} />
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        {lend
          ? "Tiền rời tài khoản nhưng vẫn là tiền của nhà: không trừ ví nào, số phải thu tăng thêm đúng số này."
          : "Tiền người ta trả lại, không phải thu nhập: không chia vào ví, không đụng ví nào. Chỉ tài khoản nhận tăng, số phải thu giảm."}
      </div>
      <div class="pad">
        <button type="button" class="btn btn-primary btn-wide" disabled={!!problem || busy} onClick={() => void submit()}>
          {problem ?? (lend ? `Ghi cho vay thêm ${formatVnd(amount)}` : `Ghi nhận lại ${formatVnd(amount)}`)}
        </button>
      </div>
    </Sheet>
  );
}
