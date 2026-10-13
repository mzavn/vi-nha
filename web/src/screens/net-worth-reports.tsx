// Tài sản & tự do › Lưu chuyển tiền và Thu chi (pwa UC-717 AC-3; balance UC-1105, UC-1106).
// Hai phần dùng chung một hàng chọn kỳ (Tháng / Năm, ‹ kỳ ›). Mọi số tính ở server, theo `month_key` như Ngân sách.
// Chạm một dòng của Lưu chuyển tiền → danh sách giao dịch của dòng; mỗi giao dịch "Xếp vào nhóm…" — chỉ đổi báo cáo,
// không đổi ví, số dư hay lần chia tiền. Ghi cần mạng.

import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import { formatVnd } from "../lib/money";
import { monthText } from "../lib/net-worth";
import {
  canGoNext,
  cashFlowMonthSub,
  cashFlowSummary,
  CLASS_LABEL,
  classOptions,
  closingNotes,
  excludedText,
  GROUP_LABEL,
  lineSub,
  lotNoteText,
  periodKind,
  periodLabel,
  reclassToast,
  reportTxSub,
  reportTxTitle,
  savingsRateText,
  shiftPeriod,
  shownExpenseLines,
  statementMonthSub,
  switchKind,
  type PeriodKind,
} from "../lib/reports";
import type { CashFlow, CashFlowLine, IncomeStatement, ReportClass, ReportTransactions, ReportTx, StatementLine } from "../lib/types";
import { useResource } from "../state/resource";
import { openTx, toast, useApp } from "../state/store";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Card, Empty, Loadable, NeedsNetwork, Seg, Sheet } from "../ui/parts";

/** Hàng chọn kỳ: Tháng / Năm + "‹ Tháng 10/2026 ›"; không có › ở kỳ hiện tại. */
export function PeriodBar({ period, today, onChange }: { period: string; today: string; onChange: (p: string) => void }) {
  const next = canGoNext(period, today);
  return (
    <div class="nw-period">
      <Seg<PeriodKind>
        label="Kỳ"
        value={periodKind(period)}
        onChange={(k) => onChange(switchKind(period, k, today))}
        options={[
          { value: "month", label: "Tháng" },
          { value: "year", label: "Năm" },
        ]}
      />
      <div class="nw-step">
        <button type="button" class="btn btn-ghost" aria-label="Kỳ trước" onClick={() => onChange(shiftPeriod(period, -1))}>
          <Icon name="chevron-left" size={18} />
        </button>
        <strong>{periodLabel(period)}</strong>
        {next ? (
          <button type="button" class="btn btn-ghost" aria-label="Kỳ sau" onClick={() => onChange(shiftPeriod(period, 1))}>
            <Icon name="chevron-right" size={18} />
          </button>
        ) : (
          <span class="nw-step-gap" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

// ── Lưu chuyển tiền ─────────────────────────────────────────────────

export function CashFlowSection({ period }: { period: string }) {
  const res = useResource<CashFlow>(`/v1/reports/cash-flow?period=${period}`);
  const [line, setLine] = useState<CashFlowLine | null>(null);
  return (
    <>
      <Loadable res={res}>
        {(cf) => (
          <>
            <Card flush>
              <div class="blist">
                {cashFlowSummary(cf).map((r) => (
                  <div class={r.strong ? "srow nw-closing" : "srow"} key={r.key} style={r.key === "opening" ? { borderTop: 0 } : undefined}>
                    <span class="srow-t">{r.label}</span>
                    <Money value={r.value} signed={r.signed} tone={false} />
                  </div>
                ))}
              </div>
              {closingNotes(cf).map((n) => (
                <p class="fhint" key={n}>
                  {n}
                </p>
              ))}
            </Card>
            {cf.groups.map((g) => (
              <Card key={g.group} title={GROUP_LABEL[g.group]} right={<Money value={g.total} signed tone={false} />} flush note={g.group === "investing" ? lotNoteText(cf.lotNote) : undefined}>
                {g.lines.length === 0 ? (
                  <Empty title="Không có giao dịch nào trong kỳ." />
                ) : (
                  <div class="blist">
                    {g.lines.map((l) => (
                      <button type="button" class="tier" key={l.line} onClick={() => setLine(l)} aria-label={`${l.label}: ${formatVnd(l.total)}, xem các giao dịch`}>
                        <div class="nm">
                          {l.label}
                          {l.reclassified > 0 && <span class="chip">đã xếp lại</span>}
                        </div>
                        <div class="amt">
                          <Money value={l.total} signed tone={false} />
                        </div>
                        <div class="tsub">
                          <span>{lineSub(l)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            ))}
            {cf.months && cf.months.length > 0 && (
              <Card title="Từng tháng" flush>
                <div class="blist">
                  {cf.months.map((m) => (
                    <div class="tier" key={m.month}>
                      <div class="nm">Tháng {monthText(m.month)}</div>
                      <div class="amt">
                        <Money value={m.closing} tone={false} />
                      </div>
                      <div class="tsub nw-sub">
                        <span>{cashFlowMonthSub(m)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
            <p class="hint" style={{ margin: "0 4px 12px" }}>
              Chuyển giữa hai tài khoản của nhà không vào nhóm nào. Xếp lại một giao dịch chỉ đổi báo cáo — ví, số dư, chia tiền giữ nguyên.
            </p>
          </>
        )}
      </Loadable>
      {line && <LineSheet period={period} line={line} onClose={() => setLine(null)} onChanged={res.reload} />}
    </>
  );
}

/** Các giao dịch của một dòng; mỗi giao dịch Xếp vào nhóm… (balance UC-1105 (6)). */
function LineSheet({ period, line, onClose, onChanged }: { period: string; line: CashFlowLine; onClose: () => void; onChanged: () => void }) {
  const { online } = useApp();
  const res = useResource<ReportTransactions>(`/v1/reports/transactions?period=${period}&line=${encodeURIComponent(line.line)}`);
  const [pick, setPick] = useState<ReportTx | null>(null);
  return (
    <Sheet open title={`${line.label} · ${periodLabel(period)}`} onClose={onClose}>
      <Loadable res={res}>
        {(d) =>
          d.transactions.length === 0 ? (
            <Empty title="Không còn giao dịch nào ở dòng này." />
          ) : (
            <>
              {d.transactions.map((t) => (
                <div class="srow nw-tx" key={t.id}>
                  <span class="srow-main">
                    <button type="button" class="link srow-t" style={{ textAlign: "left" }} onClick={() => openTx(t.id)}>
                      {reportTxTitle(t)}
                    </button>
                    <span class="srow-s">{reportTxSub(t)}</span>
                    <span class="nw-act">
                      {t.reportClass && <span class="chip">đã xếp lại · {CLASS_LABEL[t.reportClass]}</span>}
                      {online && (
                        <button type="button" class="link" onClick={() => setPick(t)}>
                          Xếp vào nhóm…
                        </button>
                      )}
                    </span>
                  </span>
                  <Money value={t.amount} signed tone={false} class="srow-amt" />
                </div>
              ))}
            </>
          )
        }
      </Loadable>
      {!online && (
        <div class="pad">
          <NeedsNetwork what="Xếp giao dịch vào nhóm khác" />
        </div>
      )}
      {pick && (
        <ClassSheet
          tx={pick}
          onClose={() => setPick(null)}
          onSaved={(text) => {
            toast(text);
            setPick(null);
            res.reload();
            onChanged();
          }}
        />
      )}
    </Sheet>
  );
}

/** Chọn một trong bốn nhóm, hoặc Về mặc định. Chỉ đổi báo cáo (UC-1105 AC-2). */
function ClassSheet({ tx, onClose, onSaved }: { tx: ReportTx; onClose: () => void; onSaved: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(cls: ReportClass | null) {
    setBusy(true);
    setError(null);
    try {
      const path = `/v1/transactions/${tx.id}/report-class`;
      if (cls) await api.put(path, { class: cls });
      else await api.del(path);
      onSaved(reclassToast(tx.amount, cls));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <Sheet open title="Xếp vào nhóm" onClose={onClose}>
      <p class="fhint" style={{ paddingTop: "10px" }}>
        {reportTxTitle(tx)} {formatVnd(Math.abs(tx.amount))} · {reportTxSub(tx)}
      </p>
      <div class="pad grid gap-2">
        {classOptions(tx.meaning).map((c) => (
          <button key={c} type="button" class={tx.reportClass === c ? "btn btn-primary" : "btn"} aria-pressed={tx.reportClass === c} disabled={busy} onClick={() => void save(c)}>
            {CLASS_LABEL[c]}
          </button>
        ))}
        {tx.reportClass && (
          <button type="button" class="btn btn-ghost" disabled={busy} onClick={() => void save(null)}>
            Về mặc định
          </button>
        )}
        {error && (
          <p class="err" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        Chỉ đổi báo cáo Lưu chuyển tiền và Thu chi. Ví, số dư tài khoản và lần chia tiền của khoản này giữ nguyên.
      </div>
    </Sheet>
  );
}

// ── Thu chi ─────────────────────────────────────────────────────────

export function IncomeSection({ period }: { period: string }) {
  const res = useResource<IncomeStatement>(`/v1/reports/income-statement?period=${period}`);
  return (
    <Loadable res={res}>
      {(s) => {
        const footer = excludedText(s.excluded);
        return (
          <>
            <Card title="Thu nhập" right={<Money value={s.income.total} tone={false} />} flush>
              <StatementLines lines={s.income.lines} />
            </Card>
            <Card title="Chi tiêu" right={<Money value={s.expense.total} tone={false} />} flush>
              {shownExpenseLines(s.expense.lines).length === 0 ? <Empty title="Không có khoản chi nào trong kỳ." /> : <StatementLines lines={shownExpenseLines(s.expense.lines)} />}
            </Card>
            <Card title="Để dành" note={footer ?? undefined}>
              <div class="nw-savings">
                <Money value={s.savings} />
              </div>
              <div class="meta">{savingsRateText(s.savingsRate)}</div>
            </Card>
            {s.months && s.months.length > 0 && (
              <Card title="Từng tháng" flush>
                <div class="blist">
                  {s.months.map((m) => (
                    <div class="tier" key={m.month}>
                      <div class="nm">Tháng {monthText(m.month)}</div>
                      <div class="amt">
                        <Money value={m.savings} />
                      </div>
                      <div class="tsub nw-sub">
                        <span>{statementMonthSub(m)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        );
      }}
    </Loadable>
  );
}

function StatementLines({ lines }: { lines: StatementLine[] }) {
  return (
    <div class="blist">
      {lines.map((l) => (
        <Fragment key={l.line}>
          <div class="srow">
            <span class="srow-t">{l.label}</span>
            <Money value={l.total} tone={false} />
          </div>
          {l.children?.map((c) => (
            <div class="srow nw-child" key={c.line}>
              <span class="srow-s">{c.label}</span>
              <Money value={c.total} tone={false} />
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
