// Thẻ "Trích Tích luỹ" (pwa UC-702 AC-38): một hàng chính cho mỗi việc đang mở của `snapshot.month` (nhắc ① theo khoản lương,
// việc chia dư sau khi bấm Chia), nút QR / Đã chuyển / Bỏ qua / Hoàn tác, chạm số để sửa (① mở sheet thanh 1 · 10 · 30, 0 bắt lý
// do — ADR-142), dòng gợi ý mục tiêu còn thiếu (mở Ví › Dự phòng). Xong hết → thu gọn "✓ Đã trích 3.400.000 ₫ · 10% lương cả nhà tháng 12". Thao tác cần
// mạng; mất mạng thì nút khoá kèm "Cần mạng". Chữ và trạng thái ở lib/month-tasks.ts.

import { useState } from "preact/hooks";
import { errorText } from "../lib/api";
import {
  amountProblem,
  savingsSheetAction,
  savingsSheetDrag,
  savingsSheetOpen,
  savingsSheetType,
  monthNo,
  savingsSheetView,
  savingsTaskCard,
  SKIP_REASON_REQUIRED,
  skipProblem,
  taskQr,
  type TaskAction,
  type TaskQr,
  type TaskRow,
} from "../lib/month-tasks";
import type { MonthTask, Snapshot } from "../lib/types";
import { go, monthTaskAction, toast, useApp } from "../state/store";
import { AmountInput } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Row, Sheet } from "../ui/parts";
import { TransferQrBlock } from "../ui/qr";
import { SavingsSlider } from "../ui/savings-slider";

type Open = { kind: "qr" | "skip" | "amount"; task: MonthTask } | null;

/** Mọi việc xong / bỏ qua: một `Row` "Tiết kiệm tháng 11 · 10% lương cả nhà — 3.418.000 ₫"; chưa xong thì không hiện. */
export function SavingsDoneRow({ snap }: { snap: Snapshot }) {
  const { online } = useApp();
  const m = snap.month;
  const v = savingsTaskCard(m, online);
  if (!m || !v?.collapsed) return null;
  const savings = m.tasks.filter((t) => t.kind === "savings");
  if (!savings.some((t) => t.status === "done")) return <Row title={v.collapsed} />;
  return (
    <Row
      title={`Tiết kiệm tháng ${monthNo(savings[savings.length - 1]!.month)}`}
      sub={`${m.savings.pct ?? 0}% lương cả nhà`}
      value={<Money value={m.savings.amount} />}
    />
  );
}

/** `doneApart` (máy tính): xong hết thì không vẽ thẻ — hàng Tiết kiệm nằm ở thẻ trạng thái cột phụ. */
export function SavingsTaskCard({ snap, doneApart }: { snap: Snapshot; doneApart?: boolean }) {
  const { online } = useApp();
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const m = snap.month;
  const v = savingsTaskCard(m, online);
  if (!v || (doneApart && v.collapsed)) return null;

  async function run(id: number, action: TaskAction) {
    setBusy(true);
    try {
      await monthTaskAction(id, action);
      setOpen(null);
    } catch (err) {
      toast(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const taskOf = (r: TaskRow) => m.tasks.find((t) => t.id === r.id)!;
  const locked = !online || busy;

  return (
    <section class={v.collapsed ? "card pocket savings-done" : "card pocket"} aria-label="Việc tháng này">
      {v.collapsed ? (
        <SavingsDoneRow snap={snap} />
      ) : (
        <>
          <div class="pocket-h">
            <h2>Việc tháng này</h2>
          </div>
          {v.rows.map((r) => {
            // Mọi việc chừa cùng một ô icon 16px trước tiêu đề (việc xong có ✓), nên chữ các việc thẳng hàng.
            const done = r.state === "done" || /^[✓✔☑]/.test(r.title);
            const title = r.title.replace(/^[✓✔☑]\s*/, "");
            return (
              <div key={r.id} class={r.state === "skipped" ? "task-row skipped" : "task-row"}>
                {r.head && <div class="sub-line">{r.head}</div>}
                <span class="task-ic">{done && <Icon name="check" size={16} />}</span>
                {r.noSavingsAccount ? (
                  // Chưa có tài khoản Tích luỹ: tiêu đề nhắc mở tài khoản thật → Cài đặt › Ba ngăn.
                  <button type="button" class="task-t" onClick={() => go("settings", { settingsFocus: "pockets" })}>
                    {title}
                  </button>
                ) : r.canEdit ? (
                  <button type="button" class="task-t" disabled={locked} onClick={() => setOpen({ kind: "amount", task: taskOf(r) })}>
                    {title}
                  </button>
                ) : (
                  <div class="task-t">{title}</div>
                )}
                {r.sub && <div class="sub-line">{r.sub}</div>}
                {r.qrHint && <div class="sub-line">{r.qrHint}</div>}
                {(r.qr || r.doneLabel || r.canSkip || r.canUndo) && (
                  <div class="task-act">
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
                )}
              </div>
            );
          })}
          {v.goalHint && (
            // Gợi ý không bắt buộc (pocket UC-1206 AC-18): mở mục tiêu Dự phòng (Cài đặt › Ba ngăn › Mục tiêu Dự phòng).
            <button type="button" class="task-hint" onClick={() => go("settings", { settingsFocus: "pocket-goals" })}>
              {v.goalHint}
            </button>
          )}
          {v.offline && <p class="note">{v.offline}</p>}
        </>
      )}
      {open?.kind === "qr" && <QrSheet qrOf={(accountId) => taskQr(open.task, accountId)} onClose={() => setOpen(null)} />}
      {open?.kind === "skip" && <SkipSheet task={open.task} busy={locked} onSubmit={(reason) => void run(open.task.id, { kind: "skip", reason })} onClose={() => setOpen(null)} />}
      {open?.kind === "amount" &&
        (open.task.kind === "savings" ? (
          <SavingsSheet task={open.task} busy={locked} onSubmit={(action) => void run(open.task.id, action)} onClose={() => setOpen(null)} />
        ) : (
          <AmountSheet task={open.task} busy={locked} onSubmit={(amount) => void run(open.task.id, { kind: "amount", amount, reason: "" })} onClose={() => setOpen(null)} />
        ))}
    </section>
  );
}

/** Sheet mã QR chuyển khoản (ADR-116) — dùng chung nhắc trích Tích luỹ, việc chia dư và nhắc chuyển thêm ở thẻ Vận hành. */
export function QrSheet({ qrOf, onClose }: { qrOf: (accountId?: string) => TaskQr; onClose: () => void }) {
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
          {/* Số trên QR = phần còn thiếu lúc mở (pocket UC-1206 bước 10): việc 1.500.000 đã nhận 9.000 → QR 1.491.000. */}
          <div class="field">
            <span class="k">Còn thiếu</span>
            <Money value={qr.amount} class="font-semibold" />
          </div>
          <div class="pad">{"payload" in qr ? <TransferQrBlock payload={qr.payload} label={qr.label} memo={qr.memo} /> : <p class="sub-line">{qr.reason}</p>}</div>
        </>
      )}
    </Sheet>
  );
}

function SkipSheet({ task, busy, onSubmit, onClose }: { task: MonthTask; busy: boolean; onSubmit: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const problem = skipProblem(task, reason);
  return (
    <Sheet open title="Bỏ qua lần này" onClose={onClose}>
      <div class="field">
        <label for="skip-reason">Lý do</label>
        <input id="skip-reason" class="ctl" maxLength={500} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
      </div>
      {problem && <p class="fhint">{problem}</p>}
      <div class="sheet-foot">
        <button type="button" class="btn btn-primary btn-wide" disabled={busy || !!problem} onClick={() => onSubmit(reason)}>
          Bỏ qua
        </button>
      </div>
    </Sheet>
  );
}

/** Sửa số của việc chia dư: không cần lý do. */
function AmountSheet({ task, busy, onSubmit, onClose }: { task: MonthTask; busy: boolean; onSubmit: (amount: number) => void; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(task.amount);
  const problem = amountProblem(task, amount, "");
  return (
    <Sheet open title="Sửa số" onClose={onClose}>
      <div class="field">
        <label for="task-amount">Số tiền</label>
        <AmountInput id="task-amount" value={amount ?? 0} onChange={(n, valid) => setAmount(valid || n === 0 ? n : null)} />
      </div>
      {problem && <p class="fhint">{problem}</p>}
      <div class="sheet-foot">
        <button type="button" class="btn btn-primary btn-wide" disabled={busy || !!problem} onClick={() => onSubmit(amount!)}>
          Lưu
        </button>
      </div>
    </Sheet>
  );
}

/** Sheet "Trích Tích luỹ" (UC-702 AC-35): thanh 1–100% có vạch 1 · 10 · 30 và ô số tiền đi cùng nhau; số 0 bắt lý do. */
function SavingsSheet({ task, busy, onSubmit, onClose }: { task: MonthTask; busy: boolean; onSubmit: (action: TaskAction) => void; onClose: () => void }) {
  const [s, setS] = useState(() => savingsSheetOpen(task));
  const v = savingsSheetView(s);
  return (
    <Sheet open title="Trích Tích luỹ" onClose={onClose}>
      <div class="field sv-field">
        <label for="sv-pct">{v.pctText}</label>
        <SavingsSlider id="sv-pct" pct={s.pct} disabled={s.income === null} onPct={(pct) => setS((x) => savingsSheetDrag(x, pct))} />
      </div>
      <div class="field">
        <label for="sv-amount">Số tiền</label>
        <AmountInput id="sv-amount" value={s.amount ?? 0} onChange={(n, valid) => setS((x) => savingsSheetType(x, valid || n === 0 ? n : null))} />
      </div>
      {v.warn && <p class="note warn">{v.warn}</p>}
      {v.needsReason && (
        <div class="field">
          <label for="sv-reason">Lý do</label>
          <input id="sv-reason" class="ctl" maxLength={500} placeholder={SKIP_REASON_REQUIRED} value={s.reason} onInput={(e) => setS((x) => ({ ...x, reason: e.currentTarget.value }))} />
        </div>
      )}
      {v.problem && <p class="fhint">{v.problem}</p>}
      <div class="sheet-foot">
        <button type="button" class="btn btn-primary btn-wide" disabled={busy || !v.canSave} onClick={() => onSubmit(savingsSheetAction(s))}>
          Lưu
        </button>
      </div>
    </Sheet>
  );
}
