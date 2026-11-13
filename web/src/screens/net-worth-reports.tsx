// Tài sản & tự do › Lưu chuyển tiền và Thu chi (pwa UC-717 AC-3; balance UC-1105, UC-1106).
// Hai phần dùng chung một hàng chọn kỳ (Tháng / Năm, ‹ kỳ ›). Mọi số tính ở server, theo `month_key`.
// Chạm một dòng của Lưu chuyển tiền → danh sách giao dịch của dòng; mỗi giao dịch "Xếp vào nhóm…" — chỉ đổi báo cáo,
// không đổi số dư hay ngăn. Ghi cần mạng.

import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import { EMPTY_STATES } from "../lib/empty-states";
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
import { Card, Chip, Empty, Loadable, NeedsNetwork, Row, Seg, Sheet } from "../ui/parts";

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
            <Card flush note="Chuyển giữa hai tài khoản của nhà không vào nhóm nào. Xếp lại giao dịch chỉ đổi báo cáo, số dư và ngăn giữ nguyên.">
              {cashFlowSummary(cf).map((r) => (
                <Row key={r.key} total={r.strong} title={r.label} value={<Money value={r.value} signed={r.signed} tone={false} />} />
              ))}
              {closingNotes(cf).map((n) => (
                <p class="row-note" key={n}>
                  {n}
                </p>
              ))}
            </Card>
            {cf.groups.map((g) => (
              <Card key={g.group} title={GROUP_LABEL[g.group]} right={<Money value={g.total} signed tone={false} />} flush note={g.group === "investing" ? lotNoteText(cf.lotNote) : undefined}>
                {g.lines.length === 0 ? (
                  <Empty state={EMPTY_STATES.reportCashFlow} />
                ) : (
                  g.lines.map((l) => (
                    <Row
                      key={l.line}
                      title={
                        <>
                          {l.label}
                          {l.reclassified > 0 && <Chip>đã xếp lại</Chip>}
                        </>
                      }
                      sub={lineSub(l)}
                      value={<Money value={l.total} signed tone={false} />}
                      onClick={() => setLine(l)}
                      label={`${l.label}: ${formatVnd(l.total)}, xem các giao dịch`}
                    />
                  ))
                )}
              </Card>
            ))}
            {cf.months && cf.months.length > 0 && (
              <Card title="Từng tháng" flush>
                {cf.months.map((m) => (
                  <Row key={m.month} title={`Tháng ${monthText(m.month)}`} sub={cashFlowMonthSub(m)} value={<Money value={m.closing} tone={false} />} />
                ))}
              </Card>
            )}
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
      <div class="note" style={{ borderTop: "1px solid var(--line)" }}>
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
              {shownExpenseLines(s.expense.lines).length === 0 ? <Empty state={EMPTY_STATES.reportIncome} /> : <StatementLines lines={shownExpenseLines(s.expense.lines)} />}
            </Card>
            <Card title="Để dành" note={footer ?? undefined}>
              <div class="nw-savings">
                <Money value={s.savings} />
              </div>
              <div class="meta">{savingsRateText(s.savingsRate)}</div>
            </Card>
            {s.months && s.months.length > 0 && (
              <Card title="Từng tháng" flush>
                {s.months.map((m) => (
                  <Row key={m.month} title={`Tháng ${monthText(m.month)}`} sub={statementMonthSub(m)} value={<Money value={m.savings} />} />
                ))}
              </Card>
            )}
          </>
        );
      }}
    </Loadable>
  );
}

/** Dòng Thu nhập / Chi tiêu: dòng có nhóm con là đầu nhóm (`Row` tên 500), nhóm con là `Row` thụt 16px (DESIGN §4.5, §4.6). */
function StatementLines({ lines }: { lines: StatementLine[] }) {
  return (
    <>
      {lines.map((l) => (
        <Fragment key={l.line}>
          <Row total={Boolean(l.children?.length)} title={l.label} value={<Money value={l.total} tone={false} />} />
          {l.children?.map((c) => (
            <Row key={c.line} indent title={c.label} value={<Money value={c.total} tone={false} />} />
          ))}
        </Fragment>
      ))}
    </>
  );
}
