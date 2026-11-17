// Khớp khoản chi vào mục tiêu Dự phòng (pwa UC-715 AC-21, UC-702 AC-45 / AC-46, UC-707 AC-45 / AC-46 / AC-49 / AC-50; ingest UC-305
// AC-39): bộ chọn "Cho mục tiêu", sheet mục tiêu (khoản đã khớp, gỡ, chốt / mở lại, bỏ qua khoản chưa khớp), sheet Khớp giao dịch (tích nhiều khoản), sheet việc chuyển
// về (QR, Đã chuyển, Bỏ qua). Mọi thao tác ghi thẳng lên server nên cần mạng; toast có Hoàn tác. Chữ và trạng thái ở
// `lib/goal-match.ts` / `lib/pocket-cards.ts` (thuần, có test).

import { useEffect, useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import {
  canSkip,
  candidateQuery,
  candidatesPath,
  candidateTag,
  CLOSE_LABEL,
  closeBody,
  closeToast,
  goalNameOf,
  goalPickerGroups,
  goalTxPath,
  type GoalTxBody,
  pickableGoalIds,
  matchedRowSub,
  matchFooter,
  matchToast,
  needReviewGoalRows,
  NO_GOAL_PICK,
  REFUND_SKIP_REASON_REQUIRED,
  refundPath,
  refundQr,
  refundTitle,
  refundToast,
  REOPEN_LABEL,
  reopenToast,
  SKIP_ONE_LABEL,
  skipAllIds,
  skipAllLabel,
  skipToast,
  undoRequests,
  unmatchToast,
} from "../lib/goal-match";
import { maskAmounts } from "../lib/money";
import { dayKey, shortDate } from "../lib/period";
import { reserveCard, type ReserveGoalRow } from "../lib/pocket-cards";
import { TOAST_UNDO_DONE } from "../lib/undo";
import type { GoalCandidate, GoalMatchedTx, GoalMatchResult } from "../lib/types";
import { useResource } from "../state/resource";
import { refresh, setState, toast, useApp, viewSnapshot } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { NeedsNetwork, Sheet, Skeleton } from "../ui/parts";
import { TransferQrBlock } from "../ui/qr";

/** Tên tài khoản theo bootstrap (cả tài khoản riêng tư của người khác: tên vẫn hiện, số tài khoản thì không). */
function useAccountName(): (id: string) => string {
  const { boot } = useApp();
  return (id) => boot?.accounts.find((a) => a.id === id)?.name ?? id;
}

/** Hoàn tác một lần khớp / gỡ: trả từng khoản về mục tiêu cũ rồi tải lại số. */
async function undoMatch(res: Pick<GoalMatchResult, "changes">) {
  try {
    for (const r of undoRequests(res.changes)) await api.put(r.path, r.body);
    await refresh(true);
    toast(TOAST_UNDO_DONE);
  } catch (err) {
    toast(errorText(err));
  }
}

/** PUT khớp / gỡ một mục tiêu, tải lại số, toast có Hoàn tác. Lỗi ném ra cho nơi gọi hiện. */
export async function putGoalTx(goalId: string, goalName: string, body: GoalTxBody): Promise<GoalMatchResult> {
  const res = await api.put<GoalMatchResult>(goalTxPath(goalId), body);
  await refresh(true);
  const text = body.add?.length ? matchToast(goalName, res) : unmatchToast(goalName, res.changes.length);
  toast(text, { label: "Hoàn tác", run: () => void undoMatch(res) });
  return res;
}

/** Bỏ qua khoản chưa khớp (UC-707 AC-49, AC-50): PUT `{ skip }`, tải lại số, toast có Hoàn tác (`{ unskip }` đúng các khoản vừa đổi). */
async function skipGoalTx(goalId: string, ids: number[]): Promise<void> {
  const res = await api.put<GoalMatchResult>(goalTxPath(goalId), { skip: ids });
  await refresh(true);
  const undo = async () => {
    try {
      if (res.skipped.length > 0) await api.put(goalTxPath(goalId), { unskip: res.skipped });
      await refresh(true);
      toast(TOAST_UNDO_DONE);
    } catch (err) {
      toast(errorText(err));
    }
  };
  // Đếm khoản thật sự đổi: bấm lại lúc danh sách chưa tải xong thì không có gì để hoàn tác.
  if (res.skipped.length === 0) return;
  toast(skipToast(res.skipped.length), { label: "Hoàn tác", run: () => void undo() });
}

// ── Bộ chọn "Cho mục tiêu" (UC-715 AC-21, UC-305 AC-39) ───────────

/**
 * Chọn mục tiêu tài khoản chưa chốt, gom theo tài khoản (nhóm của tài khoản tiền ra lên đầu), có ô tìm; hàng cuối "Không cho mục
 * tiêu nào". `onPick(null)` = không cho mục tiêu nào. Không tự focus vào lựa chọn nào (DESIGN §4.11).
 */
export function GoalPickerSheet({ accountId, value, onPick, onClose }: { accountId: string | null; value: string | null; onPick: (goalId: string | null) => void; onClose: () => void }) {
  const app = useApp();
  const snap = viewSnapshot(app);
  const [q, setQ] = useState("");
  const groups = goalPickerGroups(snap?.pockets, accountId, q);
  return (
    <Sheet open title="Cho mục tiêu" onClose={onClose}>
      <div class="pad">
        <label class="book-q">
          <Icon name="search" size={16} />
          <span class="sr-only">Tìm mục tiêu</span>
          <input type="search" class="ctl full" placeholder="Tìm mục tiêu, tài khoản" maxLength={100} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        </label>
      </div>
      {groups.length === 0 && <p class="note pad">Không có mục tiêu nào khớp.</p>}
      {groups.map((g) => (
        <div key={g.accountId} role="group" aria-label={g.name}>
          <div class="list-h">{g.name}</div>
          {g.goals.map((goal) => (
            <button type="button" key={goal.id} class="srow" aria-pressed={value === goal.id} onClick={() => onPick(goal.id)}>
              <span class="srow-t">{goal.name}</span>
              {value === goal.id && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      ))}
      <button type="button" class="srow" aria-pressed={value === null} onClick={() => onPick(null)}>
        <span class="srow-t">{NO_GOAL_PICK}</span>
        {value === null && <Icon name="check" size={16} />}
      </button>
    </Sheet>
  );
}

// ── Sheet mục tiêu (UC-707 AC-45) ─────────────────────────────────

/** Dòng phụ hàng mục tiêu: chữ số gọn + các phần trạng thái trên cùng một dòng. */
export function GoalRowSub({ row }: { row: ReserveGoalRow }) {
  return (
    <>
      {row.amount}
      {row.status.map((s) => (
        <span key={s.text} class={s.tone ? `goal-st ${s.tone}` : "goal-st"}>
          {" · "}
          {s.text}
        </span>
      ))}
    </>
  );
}

/**
 * Sheet mục tiêu — một sheet duy nhất (UC-707 AC-45 / AC-46): đầu là tóm tắt + chi tiết; "Đã khớp" gỡ từng khoản (có Hoàn tác);
 * "Khớp thêm" có ô tìm tại chỗ (ngày / số tiền, kể cả khoản từ tài khoản khác) và danh sách tích, mỗi hàng chưa gắn mục tiêu có
 * "Không cho mục tiêu", cuối danh sách mặc định "Bỏ qua N khoản còn lại" (AC-49, AC-50); chân dính một nút chính: tích ≥ 1 khoản →
 * "Khớp N khoản · Y", chưa tích → "Chốt xong" / "Mở lại". `choices` (mở từ Cần xem): mục tiêu chưa chốt của tài khoản chung để đổi
 * mục tiêu ngay trong sheet; mặc định mục tiêu đầu (cửa sổ sớm nhất, UC-702 AC-46).
 */
export function GoalSheet({ goalId, choices, onClose }: { goalId: string; choices?: string[]; onClose: () => void }) {
  const app = useApp();
  const snap = viewSnapshot(app);
  const [current, setCurrent] = useState(goalId);
  const today = snap?.day ?? dayKey(new Date());
  const row = reserveCard(snap?.pockets, today)?.groups.flatMap((g) => g.goals).find((g) => g.id === current) ?? null;
  const goal = snap?.pockets.reserve.goals.find((g) => g.id === current) ?? null;
  const list = useResource<{ items: GoalMatchedTx[] }>(app.online ? goalTxPath(current) : null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(candidateQuery(text, today)), 300);
    return () => clearTimeout(t);
  }, [text]);
  const open = !!goal && !goal.closed;
  const cands = useResource<{ items: GoalCandidate[] }>(app.online && open ? candidatesPath(current, query) : null);
  const [picked, setPicked] = useState<GoalCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!goal || !row) return null;
  const items = list.data?.items ?? [];
  const candidates = cands.data?.items ?? [];
  const footer = matchFooter(picked);
  const skipAll = skipAllIds(candidates, { searching: text.trim() !== "" || query !== "", picked: picked.length });

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const unmatch = (txId: number) => run(async () => void (await putGoalTx(current, goal.name, { remove: [txId] })));
  const match = () =>
    run(async () => {
      await putGoalTx(current, goal.name, { add: picked.map((c) => c.tx_id) });
      setPicked([]);
      setText("");
    });
  const skip = (ids: number[]) =>
    run(async () => {
      await skipGoalTx(current, ids);
      setPicked((p) => p.filter((x) => !ids.includes(x.tx_id)));
    });
  const switchGoal = (id: string) => {
    setCurrent(id);
    setPicked([]);
    setError(null);
  };

  const toggleClosed = () =>
    run(async () => {
      const reopen = row.closed;
      const path = (action: "close" | "reopen") => `/v1/goals/${encodeURIComponent(current)}/${action}`;
      const res = await api.post<{ goal: { period_id?: number | null } }>(path(reopen ? "reopen" : "close"), closeBody(goal));
      await refresh(true);
      const undo = async () => {
        try {
          // Hoàn tác trên đợt server vừa trả (chốt mục tiêu lặp N tháng mở đợt mới).
          await api.post(path(reopen ? "close" : "reopen"), closeBody({ repeatMonths: goal.repeatMonths, periodId: res.goal.period_id ?? null }));
          await refresh(true);
          toast(TOAST_UNDO_DONE);
        } catch (err) {
          toast(errorText(err));
        }
      };
      toast(reopen ? reopenToast(goal.name) : closeToast(goal.name), { label: "Hoàn tác", run: () => void undo() });
    });

  const locked = busy || !app.online;
  const loadState = (r: { loading: boolean; error: { message: string } | null; data: unknown }) =>
    !app.online ? (
      <p class="note pad">Cần mạng.</p>
    ) : r.loading && !r.data ? (
      <Skeleton rows={2} />
    ) : r.error ? (
      <p class="err pad" role="alert">
        {r.error.message}
      </p>
    ) : null;
  return (
    <Sheet open title={goal.name} onClose={onClose}>
      {choices && choices.length > 1 && (
        <div class="field goal-chips">
          <span class="k">Mục tiêu</span>
          <div class="goal-chip-row" role="group" aria-label="Mục tiêu">
            {choices.map((id) => (
              <button type="button" key={id} class="goal-chip" aria-pressed={current === id} onClick={() => switchGoal(id)}>
                {snap?.pockets.reserve.goals.find((g) => g.id === id)?.name ?? id}
              </button>
            ))}
          </div>
        </div>
      )}
      <div class="row goal-sum">
        <span class="t">
          {/* Nhãn đầy đủ: "Có X + đã chi Y / cần Z" (hoặc trạng thái chốt), "Trả từ … · chờ chuyển về …"; cảnh báo một dòng vàng. */}
          {(row.details.length > 0 ? row.details : [row.amount]).map((d) => (
            <span key={d} class={row.over ? "s neg" : "s"}>
              {d}
            </span>
          ))}
          {row.status.some((s) => s.tone) && (
            <span class="s goal-st warn">
              {row.status
                .filter((s) => s.tone)
                .map((s) => s.text)
                .join(" · ")}
            </span>
          )}
        </span>
        {row.pct !== null && <span class="v num">{row.pct}%</span>}
      </div>

      <div class="list-h">Đã khớp</div>
      {loadState(list) ??
        (items.length === 0 ? (
          <p class="note pad">Chưa khớp khoản nào trong kỳ này.</p>
        ) : (
          items.map((t) => (
            <div key={t.tx_id} class="row match-row">
              <span class="t">
                <span class="tt">{t.note ? maskAmounts(t.note) : "Khoản chi"}</span>
                <span class="s">{matchedRowSub(t)}</span>
              </span>
              <span class="v num">
                <Money value={t.amount} unit={false} tone={false} />
              </span>
              <button type="button" class="btn btn-ghost match-undo" disabled={locked} aria-label={`Gỡ khoản ${shortDate(t.at)} khỏi ${goal.name}`} onClick={() => void unmatch(t.tx_id)}>
                Gỡ
              </button>
            </div>
          ))
        ))}

      <div class="list-h">Khớp thêm</div>
      {open ? (
        <>
          <div class="pad">
            <label class="book-q">
              <Icon name="search" size={16} />
              <span class="sr-only">Tìm khoản để khớp</span>
              <input type="search" class="ctl full" placeholder="Tìm theo ngày (20/11) hoặc số tiền" maxLength={100} value={text} onInput={(e) => setText(e.currentTarget.value)} />
            </label>
            <p class="fhint">Tìm theo ngày hoặc số tiền, kể cả khoản từ tài khoản khác.</p>
          </div>
          {loadState(cands) ??
            (candidates.length === 0 ? (
              <p class="note pad">{query ? "Không có khoản nào khớp tìm kiếm trong kỳ của mục tiêu." : "Không còn khoản chi nào chưa khớp trong kỳ của mục tiêu."}</p>
            ) : (
              <>
                {candidates.map((c) => {
                  const tag = candidateTag(c, current);
                  return (
                    <div key={c.tx_id} class="row match-row">
                      <label class="match-pick">
                        <span class="t">
                          <span class="tt">{c.note ? maskAmounts(c.note) : "Khoản chi"}</span>
                          <span class="s">
                            {shortDate(c.at)}
                            {tag && ` · ${tag}`}
                          </span>
                        </span>
                        <span class="v num">
                          <Money value={c.amount} unit={false} tone={false} />
                        </span>
                        <input
                          type="checkbox"
                          aria-label={`Chọn khoản ${shortDate(c.at)}`}
                          checked={picked.some((x) => x.tx_id === c.tx_id)}
                          disabled={busy}
                          onChange={(e) => setPicked((p) => (e.currentTarget.checked ? [...p, c] : p.filter((x) => x.tx_id !== c.tx_id)))}
                        />
                      </label>
                      {canSkip(c) && (
                        <button type="button" class="btn btn-ghost match-undo" disabled={locked} aria-label={`${SKIP_ONE_LABEL}: khoản ${shortDate(c.at)}`} onClick={() => void skip([c.tx_id])}>
                          {SKIP_ONE_LABEL}
                        </button>
                      )}
                    </div>
                  );
                })}
                {skipAll.length > 0 && (
                  <div class="match-skip-all">
                    <button type="button" class="btn btn-ghost" disabled={locked} onClick={() => void skip(skipAll)}>
                      {skipAllLabel(skipAll.length)}
                    </button>
                  </div>
                )}
              </>
            ))}
        </>
      ) : (
        <p class="note pad">Mục tiêu đã chốt: mở lại để khớp thêm.</p>
      )}

      <div class="sheet-foot">
        {error && (
          <p class="err" role="alert">
            {error}
          </p>
        )}
        {footer ? (
          <button type="button" class="btn btn-primary btn-wide" disabled={locked} onClick={() => void match()}>
            {footer}
          </button>
        ) : (
          <button type="button" class="btn btn-primary btn-wide" disabled={locked} onClick={() => void toggleClosed()}>
            {row.closed ? REOPEN_LABEL : CLOSE_LABEL}
          </button>
        )}
        {!app.online && <NeedsNetwork what="Khớp, gỡ, chốt mục tiêu" />}
      </div>
    </Sheet>
  );
}

// ── Việc chuyển về (UC-702 AC-45) ─────────────────────────────────

export function RefundSheet({ refundId, onClose }: { refundId: number; onClose: () => void }) {
  const app = useApp();
  const snap = viewSnapshot(app);
  const nameOf = useAccountName();
  const r = snap?.pockets.reserve.refunds?.find((x) => x.id === refundId) ?? null;
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!r) return null;
  const qr = refundQr(r);

  async function act(action: "done" | "skip") {
    if (!r) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(refundPath(r.id, action), action === "skip" ? { reason: reason.trim() } : {});
      await refresh(true);
      const undo = async () => {
        try {
          await api.post(refundPath(r.id, "reopen"));
          await refresh(true);
          toast(TOAST_UNDO_DONE);
        } catch (err) {
          toast(errorText(err));
        }
      };
      toast(refundToast(action, r, nameOf), { label: "Hoàn tác", run: () => void undo() });
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const locked = busy || !app.online;
  return (
    <Sheet open title={refundTitle(r, nameOf)} onClose={onClose}>
      <div class="srow">
        <span class="srow-s">Cho mục tiêu</span>
        <span class="srow-v">{r.goalName}</span>
      </div>
      <div class="srow">
        <span class="srow-s">Còn thiếu</span>
        <span class="srow-v">
          <Money value={r.missing} tone={false} />
        </span>
      </div>
      <div class="srow">
        <span class="srow-s">Nội dung</span>
        <span class="srow-v">{r.memo}</span>
      </div>
      <div class="pad">{"payload" in qr ? <TransferQrBlock payload={qr.payload} label={qr.label} memo={qr.memo} /> : <p class="sub-line">{"hint" in qr ? qr.hint : qr.reason}</p>}</div>
      {skipping && (
        <div class="field">
          <label for="refund-reason">Lý do bỏ qua</label>
          <input id="refund-reason" class="ctl" maxLength={500} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
        </div>
      )}
      {skipping && reason.trim() === "" && <p class="fhint">{REFUND_SKIP_REASON_REQUIRED}</p>}
      <div class="sheet-foot">
        {error && (
          <p class="err" role="alert">
            {error}
          </p>
        )}
        {skipping ? (
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn" disabled={busy} onClick={() => setSkipping(false)}>
              Thôi
            </button>
            <button type="button" class="btn btn-primary" disabled={locked || reason.trim() === ""} onClick={() => void act("skip")}>
              Bỏ qua
            </button>
          </div>
        ) : (
          <>
            <button type="button" class="btn btn-wide" disabled={locked} onClick={() => void act("done")}>
              Đã chuyển
            </button>
            <button type="button" class="btn btn-ghost" disabled={locked} onClick={() => setSkipping(true)}>
              Bỏ qua
            </button>
          </>
        )}
        {!app.online && <NeedsNetwork what="Đánh dấu việc chuyển về" />}
      </div>
    </Sheet>
  );
}

// ── Hôm nay › Cần xem (UC-702 AC-45) ──────────────────────────────

/** Hàng "N khoản ở {T} chưa khớp mục tiêu ›" và "Chuyển X từ {T} về {V} ›"; `head`: tiêu đề nhóm (máy tính). Không có gì → null. */
export function GoalReviewRows({ head }: { head?: boolean }) {
  const app = useApp();
  const snap = viewSnapshot(app);
  const nameOf = useAccountName();
  const rows = needReviewGoalRows(snap?.pockets, nameOf);
  if (rows.length === 0) return null;
  return (
    <>
      {head && <div class="set-sub">Mục tiêu Dự phòng</div>}
      {rows.map((r) => (
        <button
          type="button"
          key={r.key}
          class="srow"
          onClick={() => setState({ goalReview: r.kind === "unmatched" ? { kind: "match", goalIds: r.goalIds } : { kind: "refund", id: r.refundId } })}
        >
          <span class="srow-main">
            <span class="srow-t">{r.title}</span>
            {r.kind === "refund" && <span class="srow-s">{r.sub}</span>}
          </span>
          <span class="srow-r">
            <span class="chip warn">{r.kind === "unmatched" ? "chưa khớp" : "chờ chuyển"}</span>
            <Icon name="chevron-right" size={16} />
          </span>
        </button>
      ))}
    </>
  );
}

/** Sheet mở từ hàng Cần xem — đặt ở gốc app (cạnh TxSheet) để vẫn mở khi hàng Cần xem về 0 (UC-702 AC-46, UC-707 AC-50). */
export function GoalReviewSheet() {
  const open = useApp().goalReview;
  const close = () => setState({ goalReview: null });
  if (open?.kind === "match") return <GoalSheet goalId={open.goalIds[0]!} choices={open.goalIds} onClose={close} />;
  if (open?.kind === "refund") return <RefundSheet refundId={open.id} onClose={close} />;
  return null;
}

/** Số hàng Cần xem của khớp chi (đếm "việc" ở Cần xem máy tính). */
export function useGoalReviewCount(): number {
  const app = useApp();
  return needReviewGoalRows(viewSnapshot(app)?.pockets, (id) => id).length;
}

// ── Sheet giao dịch: hàng "Cho mục tiêu" (UC-715 AC-21) ───────────

/**
 * Hàng "Cho mục tiêu" của khoản chi còn hiệu lực, cả khoản ngân hàng đã tự gán: chạm → bộ chọn; lưu bằng PUT của mục tiêu mới
 * (khớp, server tự chuyển khỏi mục tiêu cũ) hoặc của mục tiêu cũ (gỡ). Cần mạng. `onSaved`: đọc lại khoản.
 */
export function TxGoalRow({ txId, accountId, goalId, onSaved }: { txId: number; accountId: string | null; goalId: string | null; onSaved: () => void }) {
  const app = useApp();
  const snap = viewSnapshot(app);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = goalNameOf(snap?.pockets, goalId);
  if (!goalId && pickableGoalIds(snap?.pockets).length === 0) return null;

  async function pick(next: string | null) {
    setPicking(false);
    if (next === goalId) return;
    setBusy(true);
    setError(null);
    try {
      if (next) await putGoalTx(next, goalNameOf(snap?.pockets, next) ?? next, { add: [txId] });
      else if (goalId) await putGoalTx(goalId, current ?? goalId, { remove: [txId] });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" class="srow" disabled={busy || !app.online} onClick={() => setPicking(true)}>
        <span class="srow-s">Cho mục tiêu</span>
        <span class="srow-r">
          <span class="srow-v">{current ?? "không"}</span>
          <Icon name="chevron-right" size={16} />
        </span>
      </button>
      {error && (
        <p class="err pad" role="alert">
          {error}
        </p>
      )}
      {picking && <GoalPickerSheet accountId={accountId} value={goalId} onPick={(id) => void pick(id)} onClose={() => setPicking(false)} />}
    </>
  );
}
