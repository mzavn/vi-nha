// Màn Nhập — màn dùng nhiều nhất. Mục tiêu 3 chạm, dưới 5 giây, một tay: +200k → danh mục → Lưu.
// Số tiền gõ bằng bàn phím số của máy (ô nhập gốc, inputmode numeric). Cả vùng số tiền là một nhãn: chạm chỗ nào
// cũng đưa con trỏ vào ô. iOS có thể không tự bật bàn phím khi mở màn — một chạm vào vùng số là đủ.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { errorText } from "../lib/api";
import { defaultAccountFor, defaultWalletFor, manualAccounts, spendableWallets, topCategories } from "../lib/categories";
import { addAmount, formatVnd, timesThousand } from "../lib/money";
import { localWalletStatus } from "../lib/pending";
import { atForDay, dayKey, shortDate, timeHM } from "../lib/period";
import { draftFromTx, editedAt, withChosen } from "../lib/transactions";
import type { Bootstrap, CategoryRef, EntryBody } from "../lib/types";
import { discardEntry, getState, go, refresh, replaceEntry, retryEntry, saveEntry, setState, syncNow, toast, useApp, viewSnapshot, type AppState } from "../state/store";
import { AccountSelect, amountExprHint, newClientId, useAmountField, WalletSelect } from "../ui/fields";
import { CategoryIcon, Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, FirstLoadFailed, NeedsNetwork, PageHeader, Sheet, Skeleton } from "../ui/parts";
import { useWide } from "../ui/shell";
import { CountSheet } from "./count-sheet";
import { OtherEntrySheet, type OtherKind } from "./other-entry-sheet";
import { RecentTransactions } from "./today-desktop";

const QUICK = [50_000, 100_000, 200_000];

export function Entry() {
  const app = useApp();
  const boot = app.boot;
  // Rời màn Nhập giữa chừng thì bỏ việc sửa / ngày điền sẵn từ Sổ giao dịch: lần sau mở Nhập là nhập mới.
  useEffect(() => () => void ((getState().editTx || getState().entryPreset) && setState({ editTx: null, entryPreset: null })), []);
  if (!boot) {
    return (
      <>
        <PageHeader title="Nhập khoản chi" />
        <Card>
          {app.loadFailed ? <FirstLoadFailed online={app.online} onRetry={() => void refresh(true)} /> : <Skeleton rows={4} />}
        </Card>
      </>
    );
  }
  return <EntryForm key={app.editTx?.tx.id ?? app.entryPreset?.day ?? "new"} boot={boot} edit={app.editTx} preset={app.entryPreset} />;
}

/**
 * `edit`: sửa một khoản chi đã lên sổ (UC-715) — cùng form, điền sẵn; Lưu thay khoản cũ trên server nên cần mạng.
 * `preset`: ghi thêm từ Sổ giao dịch (UC-716) — ngày điền sẵn (đổi được); ghi xong thì quay về sổ.
 */
function EntryForm({ boot, edit, preset }: { boot: Bootstrap; edit: AppState["editTx"]; preset: AppState["entryPreset"] }) {
  const app = useApp();
  const memberId = app.member?.id ?? null;
  const [d] = useState(() => (edit ? draftFromTx(edit.tx) : null));
  const [amount, setAmount] = useState(d?.amount ?? 0);
  const [category, setCategory] = useState<CategoryRef | null>(() => boot.categories.find((c) => c.id === d?.category_id) ?? null);
  const [walletId, setWalletId] = useState<string | null>(d?.wallet_id ?? null);
  const [accountId, setAccountId] = useState<string | null>(() => d?.account_id ?? defaultAccountFor(boot, memberId, "out"));
  const [note, setNote] = useState(d?.note ?? "");
  const [day, setDay] = useState(() => d?.day ?? preset?.day ?? dayKey(new Date()));
  const [more, setMore] = useState(Boolean(d));
  const [allCats, setAllCats] = useState(false);
  const [other, setOther] = useState<OtherKind | null>(null);
  const [counting, setCounting] = useState(false);
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const field = useAmountField(amount, (n) => setAmount(n));
  const wide = useWide();

  // Mở màn là con trỏ đã nằm trong ô số tiền (máy tính gõ ngay; iOS có thể chờ một chạm mới bật bàn phím).
  // Mở để sửa từ một dòng ở cuối màn: về đầu màn để thấy cả khoản đang sửa.
  useEffect(() => {
    if (edit) scrollTo({ top: 0 });
    amountRef.current?.focus({ preventScroll: true });
  }, []);

  // Thứ tự ô danh mục tính một lần khi mở màn: lưu xong một khoản không làm các ô nhảy chỗ (ghi liên tiếp theo trí nhớ tay).
  const [topIds] = useState(() => topCategories(boot.categories, boot.categoryUsage).map((c) => c.id));
  const top = useMemo(() => topIds.flatMap((id) => boot.categories.filter((c) => c.id === id)), [topIds, boot]);
  const tiles = category && !top.some((c) => c.id === category.id) ? [category, ...top.slice(0, 5)] : top;
  const wallets = useMemo(
    () => withChosen(spendableWallets(boot.wallets, memberId), d?.wallet_id, () => boot.wallets.find((w) => w.id === d?.wallet_id)),
    [boot, memberId, d],
  );
  const view = viewSnapshot(app);
  const status = view && walletId ? localWalletStatus(view, walletId, new Date()) : null;
  const today = dayKey(new Date());

  // Danh mục / tài khoản bị xoá khỏi cấu hình sau khi tải lại: bỏ chọn thay vì gửi một mã không còn.
  useEffect(() => {
    if (accountId && !manualAccounts(boot.accounts, "out").some((a) => a.id === accountId)) setAccountId(defaultAccountFor(boot, memberId, "out"));
  }, [boot]);

  function pick(c: CategoryRef) {
    setCategory(c);
    setWalletId(defaultWalletFor(boot, c, memberId)?.id ?? null);
    setAllCats(false);
  }

  const missing = !amount ? (field.expr !== null ? "Phép tính chưa đúng" : "Nhập số tiền") : !category ? "Chọn danh mục" : !walletId ? "Chọn ví" : !accountId ? "Chọn tài khoản" : null;

  /** Nút "+": thêm dấu cộng vào cuối ô (thay dấu phép tính đang treo), con trỏ về cuối để gõ số tiếp. */
  function plus() {
    const el = amountRef.current;
    if (!el) return;
    el.value = `${el.value.replace(/[\s+\-−×*]+$/, "")}+`;
    field.onInput(el);
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }

  async function save() {
    if (missing || saving || !category || !walletId || !accountId) return;
    if (edit && !app.online) return;
    setSaving(true);
    const body: EntryBody = {
      meaning: "spend",
      amount,
      at: edit ? editedAt(day, edit.tx.at, new Date()) : atForDay(day, new Date()),
      client_id: newClientId(),
      category_id: category.id,
      wallet_id: walletId,
      account_id: accountId,
      ...(d?.debt_id ? { debt_id: d.debt_id } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    try {
      if (edit) {
        // Sửa ghi thẳng lên server, thay khoản cũ trong một lần; xong thì về màn đã mở khoản đó.
        await replaceEntry(edit.tx.id, body);
        go(edit.back, { editTx: null });
        return;
      }
      const saved = await saveEntry(body);
      if (!saved) return; // giữ nguyên số đã nhập để thử lại
      if (preset) {
        go(preset.back, { entryPreset: null });
        return;
      }
      setAmount(0);
      setCategory(null);
      setWalletId(null);
      setNote("");
      setDay(dayKey(new Date()));
      setMore(false);
      setAccountId(defaultAccountFor(boot, memberId, "out"));
      // Sẵn sàng cho khoản tiếp theo: về đầu màn, con trỏ lại ở ô số tiền.
      scrollTo({ top: 0 });
      amountRef.current?.focus({ preventScroll: true });
    } catch (err) {
      toast(`Chưa sửa được: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const header = edit ? (
    <PageHeader
      title="Sửa khoản chi"
      sub={app.online ? "Lưu sẽ thay khoản cũ; khoản cũ vẫn nằm trong sổ, ghi là đã xoá" : "Không có mạng — sửa cần mạng"}
      action={
        <button type="button" class="btn" onClick={() => go(edit.back, { editTx: null })}>
          Thôi sửa
        </button>
      }
    />
  ) : (
    <PageHeader
      title="Nhập khoản chi"
      sub={
        !app.online
          ? "Không có mạng — khoản chi vẫn ghi, tự gửi khi có mạng"
          : preset
            ? `Ghi vào ngày ${shortDate(day)} — ghi xong quay về Sổ giao dịch`
            : "Tiền mặt và tài khoản SePay không báo tiền ra"
      }
      action={
        <button type="button" class="btn" onClick={() => setOther("income")}>
          Loại khác
        </button>
      }
    />
  );
  const form = (
    <>

      <section class="card" aria-label="Số tiền">
        {/* Nhãn bọc cả vùng: chạm vào bất cứ đâu trong vùng số tiền cũng đưa con trỏ vào ô. */}
        <label class={amount ? "amount" : "amount zero"} for="f-amount">
          <span class="sr-only">Số tiền (đồng)</span>
          <input
            ref={amountRef}
            id="f-amount"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autocomplete="off"
            enterKeyHint="done"
            placeholder="0"
            value={field.text}
            style={{ width: amountWidth(field.text) }}
            onInput={(e) => field.onInput(e.currentTarget)}
            onBlur={field.commit}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              field.commit();
              if (missing) e.currentTarget.blur();
              else void save();
            }}
          />
          <span class="cur" aria-hidden="true">
            ₫
          </span>
        </label>
        <div class="quick">
          {QUICK.map((q) => (
            <button type="button" key={q} class="btn" onClick={() => field.set(addAmount(amount, q))} aria-label={`Cộng ${formatVnd(q)}`}>
              +{q / 1000}k
            </button>
          ))}
          <button type="button" class="btn" onClick={() => field.set(timesThousand(amount))} disabled={!amount} aria-label="Thêm ba số 0">
            +000
          </button>
          {/* Bàn phím số của iOS không có dấu +: nút này gõ hộ, giữ con trỏ trong ô (mousedown không lấy focus). */}
          <button type="button" class="btn" onMouseDown={(e) => e.preventDefault()} onClick={plus} disabled={!field.text} aria-label="Dấu cộng: cộng thêm số khác">
            <Icon name="plus" size={18} />
          </button>
          <button type="button" class="btn btn-ghost" onClick={() => field.set(0)} disabled={!field.text}>
            Xoá
          </button>
        </div>
        <div
          class="text-center"
          style={{ minHeight: "22px", padding: "0 12px 10px", fontSize: "12.5px", color: field.expr !== null && field.result === null ? "var(--bad)" : "var(--fg-3)" }}
          aria-live="polite"
        >
          {field.expr !== null
            ? amountExprHint(field.result)
            : edit
              ? `Đang sửa khoản ${formatVnd(edit.tx.amount)} ngày ${shortDate(edit.tx.at)}`
              : (app.lastEntry ?? " ")}
        </div>
      </section>

      <Card
        title="Danh mục"
        right={
          <button type="button" class="btn btn-ghost" style={{ marginRight: "-8px" }} onClick={() => setAllCats(true)}>
            <Icon name="grid" size={16} />
            Tất cả
          </button>
        }
        flush
      >
        <div class="catgrid" role="group" aria-label="Danh mục hay dùng">
          {tiles.map((c) => (
            <button type="button" key={c.id} class="cat" aria-pressed={category?.id === c.id} onClick={() => pick(c)}>
              <CategoryIcon icon={c.icon} />
              <span class="t">{c.name}</span>
            </button>
          ))}
        </div>
      </Card>

      <section class="card" aria-label="Ví và tài khoản">
        <div class="field" style={{ borderTop: 0 }}>
          <label for="f-wallet">Ví</label>
          {category ? (
            <WalletSelect id="f-wallet" wallets={wallets} value={walletId} onChange={setWalletId} />
          ) : (
            <span style={{ color: "var(--fg-3)" }}>tự điền theo danh mục</span>
          )}
        </div>
        {status && status.balance !== null && (
          <div style={{ padding: "0 14px 10px", marginTop: "-4px", fontSize: "12.5px", color: "var(--fg-2)", textAlign: "right" }}>
            {status.weekRemaining !== null ? (
              <>
                còn <Money value={status.weekRemaining} /> tuần này
              </>
            ) : status.monthRemaining !== null ? (
              <>
                còn <Money value={status.monthRemaining} /> tháng này
              </>
            ) : (
              <>
                còn <Money value={status.balance} />
              </>
            )}
            {app.stale && " (số cũ)"}
          </div>
        )}
        <div class="field">
          <label for="f-acct">Trả bằng</label>
          <AccountSelect id="f-acct" accounts={manualAccounts(boot.accounts, "out")} value={accountId} onChange={setAccountId} />
        </div>
        {edit?.tx.debt_id && (
          // Khoản trả nợ giữ nguyên chỗ gắn ở sổ nợ khi sửa.
          <div class="field">
            <span class="k">Trả nợ cho</span>
            <span>{edit.tx.debt_name ?? edit.tx.debt_id}</span>
          </div>
        )}
        {more ? (
          <>
            <div class="field">
              <label for="f-note">Ghi chú</label>
              <input id="f-note" class="ctl" maxLength={500} placeholder="không bắt buộc" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
            </div>
            <div class="field">
              <label for="f-day">Ngày</label>
              <input id="f-day" class="ctl" type="date" max={today} value={day} onInput={(e) => setDay(e.currentTarget.value || today)} />
            </div>
          </>
        ) : (
          <div class="field">
            <span class="k">{day === today ? "Hôm nay" : shortDate(day)}</span>
            <button type="button" class="btn btn-ghost" style={{ marginRight: "-10px" }} onClick={() => setMore(true)}>
              Thêm ghi chú, đổi ngày
            </button>
          </div>
        )}
      </section>

      <div class="savebar">
        {category && (
          // Ví và tài khoản đã tự điền, nhắc lại ngay trên nút Lưu; chạm để cuộn tới chỗ đổi.
          <button type="button" class="pick-summary" onClick={() => document.getElementById("f-wallet")?.scrollIntoView({ block: "center" })}>
            <span>
              <strong>{boot.wallets.find((w) => w.id === walletId)?.name ?? "Chưa chọn ví"}</strong>
              {status?.weekRemaining != null && <> · còn <Money value={status.weekRemaining} /> tuần này</>}
            </span>
            <span>{boot.accounts.find((a) => a.id === accountId)?.name}</span>
          </button>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!!missing || saving || (!!edit && !app.online)} onClick={() => void save()}>
          {saving ? "Đang ghi…" : (missing ?? (edit ? `Lưu thay đổi · ${formatVnd(amount)}` : `Lưu ${formatVnd(amount)}`))}
        </button>
        {edit && !app.online && <NeedsNetwork what="Sửa giao dịch" />}
      </div>

    </>
  );
  const side = (
    <>
      <QueueList boot={boot} />

      <Card title="Đếm ví / nhập số dư thật" right={<span class="hint">chủ nhật</span>}>
        <p style={{ margin: "0 0 10px", color: "var(--fg-2)", fontSize: "13px" }}>
          Nhập số tiền thật đang có của một tài khoản. App hiện chênh lệch với sổ rồi mới ghi.
        </p>
        <button type="button" class="btn" style={{ width: "100%" }} onClick={() => setCounting(true)}>
          Đếm và ghi chênh lệch
        </button>
      </Card>

    </>
  );

  return (
    <>
      {header}
      {edit ? (
        // Đang sửa: chỉ form, không hàng đợi / đếm ví / sổ — tránh nhầm giữa sửa và nhập mới.
        wide ? (
          <div class="dk-cols dk-entry">
            <div>{form}</div>
          </div>
        ) : (
          form
        )
      ) : wide ? (
        <div class="dk-cols dk-entry">
          <div>{form}</div>
          <div>
            {side}
            <RecentTransactions title="Giao dịch gần đây" />
          </div>
        </div>
      ) : (
        <>
          <QueueStatus />
          {form}
          {side}
          <RecentTransactions title="Giao dịch gần đây" />
        </>
      )}
      <Sheet open={allCats} title="Tất cả danh mục" onClose={() => setAllCats(false)}>
        <div class="catgrid" style={{ paddingTop: "12px" }}>
          {[...boot.categories].sort((a, b) => a.sort - b.sort).map((c) => (
            <button type="button" key={c.id} class="cat" aria-pressed={category?.id === c.id} onClick={() => pick(c)}>
              <CategoryIcon icon={c.icon} />
              <span class="t">{c.name}</span>
            </button>
          ))}
        </div>
      </Sheet>
      {other && <OtherEntrySheet kind={other} amount={amount} onClose={() => setOther(null)} />}
      {counting && <CountSheet onClose={() => setCounting(false)} />}
    </>
  );
}

/** Ô số tiền rộng vừa đủ chữ để ký hiệu ₫ đứng sát số ở giữa vùng (chữ số tabular rộng 1ch, dấu chấm hẹp hơn).
 *  `shown`: chữ đang hiện — số đã nhóm chấm, hoặc phép tính đang gõ (`24+55`). */
function amountWidth(shown: string): string {
  const text = shown || "0";
  const dots = text.split(".").length - 1;
  return `calc(${text.length - dots}ch + ${dots * 0.32}ch + 4px)`;
}

/** Dòng trạng thái đồng bộ ở đầu màn: chỉ hiện khi có việc (đang offline, có khoản chờ, có khoản bị từ chối). */
function QueueStatus() {
  const { queue, online, syncing, member } = useApp();
  const mine = queue.filter((q) => q.memberId === member?.id);
  const pending = mine.filter((q) => q.status === "pending").length;
  const rejected = mine.filter((q) => q.status === "rejected").length;
  if (!pending && !rejected && online) return null;
  return (
    <div class="status-row" role="status">
      {!online && (
        <span class="chip">
          <Icon name="cloud-off" size={12} /> không có mạng
        </span>
      )}
      {pending > 0 && <span class="chip warn">{pending} chờ đồng bộ</span>}
      {rejected > 0 && (
        <>
          <span class="chip bad">{rejected} bị từ chối</span>
          <button type="button" class="link" style={{ color: "var(--bad)" }} onClick={() => document.getElementById("queue")?.scrollIntoView({ block: "start" })}>
            Xem lý do
          </button>
        </>
      )}
      {pending > 0 && (
        <button type="button" class="btn" onClick={() => void syncNow()} disabled={syncing}>
          <Icon name="sync" size={14} />
          {syncing ? "Đang đồng bộ…" : "Đồng bộ"}
        </button>
      )}
    </div>
  );
}

function QueueList({ boot }: { boot: Bootstrap }) {
  const { queue, member, syncing } = useApp();
  const [confirm, setConfirm] = useState<string | null>(null);
  if (queue.length === 0) return null;
  const name = (list: { id: string; name: string }[], id?: string) => list.find((x) => x.id === id)?.name;
  const memberName = (id: string) => boot.members.find((m) => m.id === id)?.name ?? id;
  return (
    <Card
      id="queue"
      title={`Chưa lên sổ (${queue.length})`}
      right={
        <button type="button" class="btn" onClick={() => void syncNow()} disabled={syncing}>
          <Icon name="sync" size={14} />
          Đồng bộ
        </button>
      }
      flush
      note="Các khoản này đã được trừ tạm vào số còn lại. Máy chủ chống trùng nên gửi lại không ghi hai lần."
    >
      {queue.map((q) => (
        <div key={q.clientId} class="log" style={{ cursor: "default" }}>
          <span class="t">
            {shortDate(q.body.at)} {timeHM(q.body.at)} · {name(boot.categories, q.body.category_id) ?? q.body.meaning} ·{" "}
            {name(boot.wallets, q.body.wallet_id) ?? name(boot.accounts, q.body.account_id) ?? ""}
          </span>
          <Money value={q.body.amount} class="a" />
          <span class="c">
            {q.memberId !== member?.id ? (
              <span class="chip">của {memberName(q.memberId)} — gửi khi người này đăng nhập</span>
            ) : q.status === "rejected" ? (
              <>
                <span class="chip bad">bị từ chối</span> {q.error?.message}
              </>
            ) : (
              <>
                <span class="chip warn">chờ đồng bộ</span>
                {q.attempts > 0 && q.error ? ` Lần gửi trước: ${q.error.message}` : ""}
              </>
            )}
          </span>
          {(q.status === "rejected" || (q.attempts >= 3 && q.error)) && q.memberId === member?.id && (
            <span class="g flex gap-2" style={{ gridColumn: "1 / -1", justifySelf: "stretch", marginTop: "6px" }}>
              <button type="button" class="btn" style={{ flex: 1 }} onClick={() => void retryEntry(q.clientId)}>
                Gửi lại
              </button>
              {confirm === q.clientId ? (
                <button type="button" class="btn btn-bad" style={{ flex: 1 }} onClick={() => void discardEntry(q.clientId)}>
                  Bỏ hẳn khoản này
                </button>
              ) : (
                <button type="button" class="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirm(q.clientId)}>
                  Bỏ khoản này
                </button>
              )}
            </span>
          )}
        </div>
      ))}
    </Card>
  );
}
