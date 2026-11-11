// Gán — nơi giải mọi edge case của bank feed. Chạm một log → sheet: loại → danh mục / tài khoản → tách dòng. Không ví (Đợt C).
// Tổng các dòng phải bằng đúng số tiền log; app chặn trước khi gửi, server kiểm lại.

import { useEffect, useState } from "preact/hooks";
import { DEBT_CATEGORY_ID } from "../../../src/domain/system-ids";
import { api, errorText } from "../lib/api";
import { defaultAccountFor } from "../lib/categories";
import { payableDebts } from "../lib/debts";
import { assignDebtRows, hasInterest } from "../lib/interest";
import { bookRefLabel } from "../lib/memo-books";
import { goalChoices } from "../lib/goal-choices";
import { formatVnd, moneyDigits } from "../lib/money";
import { opensCycleDefault } from "../lib/other-entry";
import { localNearSpend } from "../lib/pending";
import { dayKey, shortDate, timeHM } from "../lib/period";
import { defaultReceivableId } from "../lib/receivables";
import {
  ASSIGN_CHOICES,
  assignBody,
  assignToast,
  counterpartAccounts,
  GUIDE_PICK_KIND_URL,
  hiddenLogsLine,
  interestToast,
  linkToast,
  logChip,
  manualMatchLabel,
  validateSplits,
  type AssignChoice,
  type AssignRow,
  type SplitMeaning,
} from "../lib/splits";
import { MEANING_LABEL } from "../lib/transactions";
import type { BankLog, Bootstrap, EntryEffects, Rental, SettingsData } from "../lib/types";
import { useResource } from "../state/resource";
import { getState, refresh, setState, toast, useApp, viewSnapshot } from "../state/store";
import { AccountSelect, AmountInput, CategorySelect, GoalChips } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Banner, Card, Empty, NeedsNetwork, PageHeader, Seg, Sheet, Skeleton } from "../ui/parts";
import { useWide } from "../ui/shell";
import { ASSET_KINDS } from "./other-entry-sheet";
import { LinkSourcePicker, ReceivablePicker } from "./ref-pickers";

export function Assign() {
  const app = useApp();
  const { online, boot, assignFocus } = app;
  // Log chờ của tài khoản riêng tư bị giấu với người xem (UC-706 AC-36): không liệt kê, chỉ một dòng đếm.
  const hidden = hiddenLogsLine(viewSnapshot(app)?.attention.hiddenPendingLogs);
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
    <Card title="Chưa gán" right={logs.data ? <span class="hint">{count} giao dịch</span> : undefined} flush note="Tiền vào không bao giờ tự gán, trừ khoản khớp mẫu lương và lãi tiền gửi nhỏ.">
      {hidden && <p class="note">{hidden}</p>}
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
  const hint = logChip(
    log,
    () =>
      s?.label ??
      boot?.categories.find((c) => c.id === s?.category_id)?.name ??
      [...ASSIGN_CHOICES.out, ...ASSIGN_CHOICES.in].find((o) => o.value === s?.meaning)?.label.toLowerCase() ??
      "có luật",
  );
  return (
    <button type="button" class="log" onClick={onOpen} aria-current={current ? "true" : undefined}>
      <span class="t">
        {isToday ? timeHM(log.at) : `${shortDate(log.at)} ${timeHM(log.at)}`} · {acct}
      </span>
      <span class={log.direction === "in" ? "a in num" : "a num"}>
        {log.direction === "in" ? "+" : "−"}
        {moneyDigits(log.amount)}
      </span>
      <span class="c">{log.content ?? "(không có nội dung)"}</span>
      <span class={`g ${hint.cls}`}>{hint.text}</span>
    </button>
  );
}

type Row = AssignRow;
let rowSeq = 0;

function initialRows(log: BankLog, boot: Bootstrap): Row[] {
  const s = log.suggestion;
  if (log.direction === "in" && s?.tenant_id) {
    return [{ key: ++rowSeq, meaning: "income", tenantMode: true, tenant_id: s.tenant_id, amount: log.amount, taxable: false }];
  }
  // Lãi tiền gửi (UC-706): một dòng trọn số tiền log.
  if (log.direction === "in" && s?.interest) return [{ key: ++rowSeq, meaning: "income", interestMode: true, amount: log.amount }];
  const allowed = ASSIGN_CHOICES[log.direction === "in" ? "in" : "out"].map((o) => o.value);
  const meaning = (s?.meaning && allowed.includes(s.meaning as SplitMeaning) ? s.meaning : log.direction === "in" ? "income" : "spend") as SplitMeaning;
  return [
    {
      key: ++rowSeq,
      meaning,
      amount: log.amount,
      category_id: s?.category_id ?? null,
      taxable: false,
      // Chuyển nội bộ gợi ý sẵn tài khoản đầu kia (rút tiền mặt, bỏ heo đất / heo trả về — chỉ tài khoản).
      ...(meaning === "transfer" ? { other_account_id: s?.other_account_id ?? null } : {}),
      ...(meaning === "lend" || meaning === "collect" ? { receivable_id: defaultReceivableId(boot.receivables) } : {}),
    },
  ];
}

/** Form gán một log. Điện thoại: trong sheet. Máy tính: panel bên phải danh sách (không có sheet). */
function AssignSheet({ log, boot, onClose, onDone, wide }: { log: BankLog; boot: Bootstrap; onClose: () => void; onDone: () => void; wide?: boolean }) {
  const { online, snap } = useApp();
  // "Cho mục tiêu" (pwa UC-706 AC-39): chỉ log tiền ra — tài khoản của log là tài khoản tiền ra của chi / chuyển.
  const goals = log.direction === "out" ? goalChoices(log.account_id, snap?.pockets) : [];
  const isIn = log.direction === "in";
  const rental = useResource<Rental>(isIn ? "/v1/rental" : null).data;
  const streams = (useResource<SettingsData>(isIn ? "/v1/settings" : null).data?.incomeStreams ?? []).filter((s) => s.active);
  const tenants = (rental?.tenants ?? []).filter((t) => t.active);
  const debts = payableDebts(boot.debts);
  const debtCategory = boot.categories.find((c) => c.id === DEBT_CATEGORY_ID);
  const receivables = boot.receivables ?? [];
  const [rows, setRows] = useState<Row[]>(() => initialRows(log, boot));
  const [makeRule, setMakeRule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmIgnore, setConfirmIgnore] = useState(false);
  const options = isIn ? ASSIGN_CHOICES.in.filter((o) => o.value !== "tenant" || tenants.length > 0 || rows.some((r) => r.tenantMode)) : ASSIGN_CHOICES.out;
  const check = validateSplits(log.amount, rows);
  const noTenant = rows.some((r) => r.tenantMode && !r.tenant_id);
  // Dòng đang hỏi tên người mới (ô Ai trả / Cho ai vay): gán lúc này là gán khi chưa có người — chờ Thêm người.
  const [naming, setNaming] = useState<number[]>([]);
  const interestRow = rows.find((r) => r.interestMode) ?? null;
  const blocked = noTenant || naming.length > 0;
  // Như server (routes/logs.ts): chỉ tạo rule khi gán đúng một dòng chi tiêu hoặc chuyển nội bộ; tiền vào luôn phải hỏi.
  const ruleAllowed = rows.length === 1 && (rows[0]!.meaning === "spend" || rows[0]!.meaning === "transfer");

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function choose(r: Row, c: AssignChoice) {
    if (c === "tenant") update(r.key, { meaning: "income", tenantMode: true, interestMode: false, tenant_id: r.tenant_id ?? tenants[0]?.id ?? null, income_stream_id: null, opens_cycle: undefined });
    // Lãi tiền gửi luôn một dòng trọn số tiền log (không tách).
    else if (c === "interest") setRows([{ key: ++rowSeq, meaning: "income", interestMode: true, amount: log.amount, note: r.note ?? null }]);
    else
      update(r.key, {
        meaning: c,
        tenantMode: false,
        interestMode: false,
        tenant_id: null,
        // Khoản gốc chỉ thuộc dòng Hoàn tiền / Nhận lại, và đi cùng danh mục hay người của nó: đổi loại là bỏ, quay lại thì chọn lại.
        link_id: null,
        interest_debt_id: null,
        // Cho vay / nhận lại tiền cho vay không có danh mục (server tự gắn "Cho vay / trả hộ" cho cho vay).
        ...(c === "collect" || c === "lend" ? { category_id: null, receivable_id: r.receivable_id ?? defaultReceivableId(boot.receivables) } : {}),
      });
  }

  function cashWithdrawal() {
    setRows([{ key: ++rowSeq, meaning: "transfer", amount: log.amount, other_account_id: defaultAccountFor(boot, null, "in") }]);
  }

  async function submit() {
    if (!check.ok || blocked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ log: unknown; transactions: { id: number; meaning: string }[]; attached?: boolean; effects?: EntryEffects }>(
        `/v1/logs/${encodeURIComponent(log.id)}/assign`,
        assignBody(rows, makeRule && ruleAllowed, goals),
      );
      await refresh();
      if (res.attached) toast(`Đã khớp vào chuyển nội bộ đã ghi ${formatVnd(log.amount)} — không ghi thêm.`);
      else if (interestRow) toast(interestToast(log.amount));
      else {
        // Toast nói hệ quả (DESIGN §4): kỳ lương / việc ngày lương từ `effects`, khoản chi thì Vận hành còn bao nhiêu (số vừa tải lại).
        const after = getState();
        const one = rows[0]!;
        toast(
          assignToast(rows, {
            label: boot.categories.find((c) => c.id === one.category_id)?.name ?? MEANING_LABEL[one.meaning] ?? one.meaning,
            effects: res.effects,
            nearSpend: after.stale ? null : localNearSpend(viewSnapshot(after)),
          }),
        );
      }
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

  // "Đã nhập tay?": gắn log vào khoản nhập tay đã ghi đúng khoản này — không tạo giao dịch, giữ nguyên ví / danh mục.
  async function link(txId: number) {
    setBusy(true);
    try {
      await api.post(`/v1/logs/${encodeURIComponent(log.id)}/link`, { transaction_id: txId });
      await refresh();
      toast(linkToast(log.amount));
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const matches = log.manual_matches ?? [];

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
      {log.account_id && matches.length > 0 && (
        <div style={{ padding: "4px 16px 0" }}>
          <Banner tone="info" mark="=">
            <strong>Đã nhập tay?</strong> Có khoản nhập tay cùng số tiền, cùng chiều, cách không quá 1 ngày. Đúng là khoản này thì bấm Nối — gắn giao dịch ngân hàng vào đó, không ghi thêm. Đã ghi tay thành nhiều dòng (tách khoản) thì bấm <strong>Bỏ qua</strong> để khỏi ghi hai lần.
          </Banner>
          {matches.map((m) => (
            <div key={m.id} class="g flex gap-2" style={{ alignItems: "center", marginTop: "6px" }}>
              <span style={{ flex: 1, fontSize: "13px" }}>{manualMatchLabel(m, boot.categories.find((c) => c.id === m.category_id)?.name ?? null)}</span>
              <button type="button" class="btn" disabled={busy} onClick={() => void link(m.id)}>
                Nối
              </button>
            </div>
          ))}
        </div>
      )}
      {log.direction === "in" && log.suggestion?.tenant_id && (
        <div style={{ padding: "4px 16px 0" }}>
          <Banner tone="info" mark="?">
            Gợi ý: <strong>{log.suggestion.label ?? "Thu từ người thuê"}</strong>. Máy chỉ gợi ý — xem đúng người, đúng số rồi mới bấm Gán.
          </Banner>
        </div>
      )}
      {log.direction === "in" && !log.suggestion?.is_salary && !log.suggestion?.possible_duplicate_of && !log.suggestion?.tenant_id && !log.suggestion?.attach_to_tx && !log.suggestion?.interest && (
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
          <Seg class="px-4 pb-2" label={`Loại dòng ${i + 1}`} value={r.tenantMode ? "tenant" : r.interestMode ? "interest" : r.meaning} options={options} onChange={(c) => choose(r, c)} />
          <p class="fhint" style={{ padding: "0 16px 8px" }}>
            {options.find((o) => o.value === (r.tenantMode ? "tenant" : r.interestMode ? "interest" : r.meaning))?.hint}
          </p>
          <div class="field">
            <label for={`s-amt-${r.key}`}>Số tiền</label>
            <AmountInput id={`s-amt-${r.key}`} value={r.amount} onChange={(n) => update(r.key, { amount: n })} invalid={!r.amount} />
          </div>
          {r.meaning === "spend" && r.interest_debt_id && (
            <p class="fhint">Trả lãi cho {debts.find((d) => d.id === r.interest_debt_id)?.name ?? r.interest_debt_id} — chi phí của kỳ, không giảm nợ.</p>
          )}
          {r.meaning === "spend" && !r.interest_debt_id && debts.length > 0 && (
            <div class="field">
              <label for={`s-d-${r.key}`}>Trả nợ cho</label>
              <select
                id={`s-d-${r.key}`}
                class="ctl"
                value={r.debt_id ?? ""}
                onChange={(e) => {
                  const id = e.currentTarget.value || null;
                  const d = debts.find((x) => x.id === id);
                  // Khoản có lãi: tách sẵn dòng lãi và dòng gốc (debt UC-903 AC-4) — sửa được trước khi Gán.
                  if (d && hasInterest(d) && debtCategory) {
                    const parts = assignDebtRows(r.amount, d, { debtCategoryId: debtCategory.id });
                    setRows((rs) => rs.flatMap((x) => (x.key === r.key ? parts.map((p) => ({ ...x, ...p, key: ++rowSeq })) : [x])));
                    return;
                  }
                  // Trả nợ luôn vào danh mục Trả nợ.
                  update(r.key, id && debtCategory ? { debt_id: id, category_id: debtCategory.id } : { debt_id: id });
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
              onPick={(id, c) => update(r.key, { link_id: id, ...(c?.category_id ? { category_id: c.category_id } : {}) })}
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
                onChange={(id) => update(r.key, { category_id: id || null })}
              />
            </div>
          )}
          {r.meaning === "transfer" && (
            <div class="field">
              <label for={`s-o-${r.key}`}>{log.direction === "out" ? "Tiền sang" : "Tiền từ"}</label>
              <AccountSelect id={`s-o-${r.key}`} accounts={counterpartAccounts(boot.accounts, log.account_id)} value={r.other_account_id ?? null} onChange={(id) => update(r.key, { other_account_id: id })} />
            </div>
          )}
          {(r.meaning === "spend" || r.meaning === "transfer") && <GoalChips choices={goals} value={r.goal_id ?? null} onChange={(id) => update(r.key, { goal_id: id })} />}
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
          {r.meaning === "income" && !r.tenantMode && !r.interestMode && (
            <>
              {streams.length > 0 && (
                <div class="field">
                  <label for={`s-st-${r.key}`}>Nguồn thu</label>
                  <select
                    id={`s-st-${r.key}`}
                    class="ctl"
                    value={r.income_stream_id ?? ""}
                    onChange={(e) => update(r.key, { income_stream_id: e.currentTarget.value || null, opens_cycle: undefined })}
                  >
                    <option value="">Không chọn nguồn</option>
                    {streams.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div class="field">
                <label class="check">
                  <input
                    type="checkbox"
                    checked={r.opens_cycle ?? opensCycleDefault(streams, r.income_stream_id ?? "")}
                    onChange={(e) => update(r.key, { opens_cycle: e.currentTarget.checked })}
                  />
                  Lương — mở kỳ lương
                </label>
              </div>
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
          {!interestRow && (
            <button
              type="button"
              class="btn"
              onClick={() => setRows((rs) => [...rs, { key: ++rowSeq, meaning: isIn ? "income" : "spend", amount: Math.max(0, check.diff), category_id: null }])}
            >
              <Icon name="plus" size={16} />
              Tách thêm dòng
            </button>
          )}
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

      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy || !check.ok || blocked} onClick={() => void submit()}>
          {busy ? "Đang gán…" : "Gán và ghi sổ"}
        </button>
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
