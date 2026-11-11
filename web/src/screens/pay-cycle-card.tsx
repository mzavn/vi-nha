// Thẻ "Việc ngày lương" (pwa UC-702): hàng việc từ `snapshot.payCycle`, nút QR / Đã làm / Đã chuyển / Bỏ qua / Hoàn tác, chạm số để sửa.
// Thao tác cần mạng (ghi thẳng lên server, server tick); mất mạng thì nút khoá kèm "Cần mạng". Chữ và trạng thái ở lib/pay-cycle.ts.

import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { errorText } from "../lib/api";
import { amountProblem, goalGroupQr, noCycleStreamLine, payCycleCard, skipProblem, taskQr, type PayTaskRow, type TaskAction, type TaskQr } from "../lib/pay-cycle";
import type { PayCycleTask, Snapshot } from "../lib/types";
import { go, payCycleAction, toast, useApp } from "../state/store";
import { AmountInput } from "../ui/fields";
import { Money } from "../ui/money";
import { Sheet } from "../ui/parts";
import { TransferQrBlock } from "../ui/qr";

type Open = { kind: "qr" | "skip" | "amount"; task: PayCycleTask } | { kind: "group-qr"; accountId: string } | null;

export function PayCycleCard({ snap }: { snap: Snapshot }) {
  const { online } = useApp();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const reminder = noCycleStreamLine(snap);
  if (reminder) {
    return (
      <button type="button" class="card link pad" style={{ width: "100%", textAlign: "left" }} onClick={() => go("settings", { settingsFocus: "streams" })}>
        {reminder}
      </button>
    );
  }
  const c = snap.payCycle;
  const v = payCycleCard(c, online);
  if (!c || !v) return null;

  async function run(id: number, action: TaskAction) {
    setBusy(true);
    try {
      await payCycleAction(id, action);
      setOpen(null);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const taskOf = (r: PayTaskRow) => c.tasks.find((t) => t.id === r.id)!;
  const locked = !online || busy;
  const groupAt = new Map(v.goalGroups.map((g) => [g.taskIds[0]!, g]));
  const grouped = new Set(v.goalGroups.flatMap((g) => g.taskIds));

  return (
    <section class="card pocket" aria-label="Việc ngày lương">
      {v.collapsed ? (
        <p class="pad" style={{ margin: 0 }}>
          {v.collapsed}
        </p>
      ) : (
        <>
          <div class="pocket-h">
            <h2>{v.title}</h2>
            {v.chip && <span class="chip">{v.chip}</span>}
          </div>
          {v.overspent && <p class="note">{v.overspent}</p>}
          {v.rows.map((r) => {
            const head = groupAt.get(r.id);
            return (
              <Fragment key={r.id}>
                {head && (
                  <div class="srow" style={{ display: "block" }}>
                    <div class="font-semibold">{head.title}</div>
                    {head.qr && (
                      <div class="flex gap-2" style={{ marginTop: "6px" }}>
                        <button type="button" class="btn" onClick={() => setOpen({ kind: "group-qr", accountId: head.accountId })}>
                          QR gộp
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div class="srow" style={{ display: "block", opacity: r.state === "skipped" ? 0.6 : 1, paddingLeft: grouped.has(r.id) ? "28px" : undefined }}>
                  {r.noSavingsAccount ? (
                    // ① khi chưa có tài khoản Tích luỹ: tiêu đề nhắc mở tài khoản thật → Cài đặt › Ba ngăn.
                    <button type="button" class="link" style={{ textAlign: "left" }} onClick={() => go("settings", { settingsFocus: "pockets" })}>
                      {r.title}
                    </button>
                  ) : r.canEdit ? (
                    <button type="button" class="link" style={{ textAlign: "left" }} disabled={locked} onClick={() => setOpen({ kind: "amount", task: taskOf(r) })}>
                      {r.title}
                    </button>
                  ) : (
                    <div>{r.title}</div>
                  )}
                  {r.sub && <div class="sub-line">{r.sub}</div>}
                  {r.qrHint && <div class="sub-line">{r.qrHint}</div>}
                  <div class="flex gap-2" style={{ marginTop: "6px", flexWrap: "wrap" }}>
                    {r.qr && (
                      <button type="button" class="btn" onClick={() => setOpen({ kind: "qr", task: taskOf(r) })}>
                        QR
                      </button>
                    )}
                    {r.doneLabel && (
                      <button type="button" class="btn" disabled={locked} onClick={() => void run(r.id, { kind: "done" })}>
                        {r.doneLabel}
                      </button>
                    )}
                    {r.canSkip && (
                      <button type="button" class="btn btn-ghost" disabled={locked} onClick={() => (r.needsReason ? setOpen({ kind: "skip", task: taskOf(r) }) : void run(r.id, { kind: "skip", reason: "" }))}>
                        Bỏ qua
                      </button>
                    )}
                    {r.canUndo && (
                      <button type="button" class="btn btn-ghost" disabled={locked} onClick={() => void run(r.id, { kind: "reopen" })}>
                        Hoàn tác
                      </button>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
          {v.offline && <p class="note">{v.offline}</p>}
        </>
      )}
      {open?.kind === "qr" && <QrSheet qrOf={(accountId) => taskQr(c, open.task, accountId)} onClose={() => setOpen(null)} />}
      {open?.kind === "group-qr" && <QrSheet qrOf={() => goalGroupQr(c, open.accountId)} onClose={() => setOpen(null)} />}
      {open?.kind === "skip" && <SkipSheet task={open.task} busy={locked} onSubmit={(reason) => void run(open.task.id, { kind: "skip", reason })} onClose={() => setOpen(null)} />}
      {open?.kind === "amount" && <AmountSheet task={open.task} busy={locked} onSubmit={(amount, reason) => void run(open.task.id, { kind: "amount", amount, reason })} onClose={() => setOpen(null)} />}
    </section>
  );
}

function QrSheet({ qrOf, onClose }: { qrOf: (accountId?: string) => TaskQr; onClose: () => void }) {
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const qr = qrOf(accountId);
  return (
    <Sheet open title="Mã QR chuyển khoản" onClose={onClose}>
      {"hint" in qr ? (
        <p class="note">{qr.hint}</p>
      ) : (
        <>
          {qr.targets.length > 1 && (
            <div class="field">
              <label for="qr-acct">Chuyển tới</label>
              <select id="qr-acct" class="ctl" value={qr.target.accountId} onChange={(e) => setAccountId(e.currentTarget.value)}>
                {qr.targets.map((t) => (
                  <option key={t.accountId} value={t.accountId}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Số trên QR = phần còn thiếu lúc mở (pocket UC-1206 bước 10). */}
          <div class="field">
            <span class="k">Số tiền</span>
            <Money value={qr.amount} class="font-semibold" />
          </div>
          <div class="pad">{"payload" in qr ? <TransferQrBlock payload={qr.payload} label={qr.label} memo={qr.memo} /> : <p class="sub-line">{qr.reason}</p>}</div>
        </>
      )}
    </Sheet>
  );
}

function SkipSheet({ task, busy, onSubmit, onClose }: { task: PayCycleTask; busy: boolean; onSubmit: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const problem = skipProblem(task, reason);
  return (
    <Sheet open title="Bỏ qua việc này" onClose={onClose}>
      <div class="field">
        <label for="skip-reason">Lý do</label>
        <input id="skip-reason" class="ctl" maxLength={500} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
      </div>
      {problem && <p class="fhint">{problem}</p>}
      <div class="pad">
        <button type="button" class="btn btn-primary btn-wide" disabled={busy || !!problem} onClick={() => onSubmit(reason)}>
          Bỏ qua
        </button>
      </div>
    </Sheet>
  );
}

function AmountSheet({ task, busy, onSubmit, onClose }: { task: PayCycleTask; busy: boolean; onSubmit: (amount: number, reason: string) => void; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(task.amount);
  const [reason, setReason] = useState("");
  const problem = amountProblem(task, amount, reason);
  return (
    <Sheet open title="Sửa số" onClose={onClose}>
      <div class="field">
        <label for="task-amount">Số tiền</label>
        <AmountInput id="task-amount" value={amount ?? 0} onChange={(n, valid) => setAmount(valid || n === 0 ? n : null)} />
      </div>
      {task.kind === "savings" && amount === 0 && (
        <div class="field">
          <label for="task-reason">Lý do</label>
          <input id="task-reason" class="ctl" maxLength={500} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
        </div>
      )}
      {problem && <p class="fhint">{problem}</p>}
      <div class="pad">
        <button type="button" class="btn btn-primary btn-wide" disabled={busy || !!problem} onClick={() => onSubmit(amount!, reason)}>
          Lưu
        </button>
      </div>
    </Sheet>
  );
}
