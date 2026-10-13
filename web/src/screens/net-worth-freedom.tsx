// Tài sản & tự do › Mốc tự do và Thử số (pwa UC-717 AC-4; balance UC-1103, UC-1104, UC-1107).
// Mốc tự do: số tính ở server (GET /v1/freedom); thông số sửa ở sheet Tham số › Tài sản & tự do; kế hoạch thu nhập lưu
// từng bản (chỉ ghi thêm). Thử số: tính ở máy từ điểm xuất phát là số thật, KHÔNG gửi server, không lưu (ADR nháp G).

import { useEffect, useMemo, useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import {
  freedomCashflowText,
  freedomHaveText,
  freedomTargetText,
  incomeMilestoneText,
  incomeSourceText,
  MILESTONE_LABEL,
  paramsSummary,
  safetyText,
} from "../lib/freedom";
import { editedText, memberPlanText, planFormFrom, planHeadline, planPayload, planSplitHint, planSub, planYearRow, type PlanForm } from "../lib/income-plan";
import { formatVnd } from "../lib/money";
import { pctText } from "../lib/net-worth";
import { formToInput, keepDraft, keptDraft, project, reachText, startToForm, type ProjectionForm, type ProjectionRow } from "../lib/projection";
import type { Freedom, FreedomMilestone, IncomePlanSummary, IncomePlanYear, ProjectionStart, SettingsData } from "../lib/types";
import { useResource } from "../state/resource";
import { refresh, toast, useApp } from "../state/store";
import { AmountInput } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Money } from "../ui/money";
import { Banner, Bar, Card, Empty, Loadable, NeedsNetwork, Seg, Sheet, TierRow } from "../ui/parts";
import { FiConfigSheet, Field, Hint } from "./settings-sheets";

// ── Mốc tự do ───────────────────────────────────────────────────────

type Open = { kind: "params" } | { kind: "plan"; year: number } | { kind: "years" } | { kind: "year"; year: number } | null;

export function MilestonesSection() {
  const res = useResource<Freedom>("/v1/freedom");
  const [open, setOpen] = useState<Open>(null);
  const changed = (text: string) => {
    toast(text);
    res.reload();
  };
  return (
    <>
      <Loadable res={res}>{(f) => <Milestones f={f} onOpen={setOpen} />}</Loadable>
      {open?.kind === "params" && <ParamsSheet onClose={() => setOpen(null)} onSaved={changed} />}
      {open?.kind === "years" && <YearsSheet onClose={() => setOpen(null)} onOpen={(year) => setOpen({ kind: "year", year })} />}
      {open?.kind === "year" && <YearSheet year={open.year} onClose={() => setOpen({ kind: "years" })} onEdit={() => setOpen({ kind: "plan", year: open.year })} />}
      {open?.kind === "plan" && <PlanSheet year={open.year} onClose={() => setOpen(null)} onSaved={changed} />}
    </>
  );
}

function Milestones({ f, onOpen }: { f: Freedom; onOpen: (o: Open) => void }) {
  const { online } = useApp();
  const source = incomeSourceText(f.params.incomeSource);
  return (
    <>
      <Card
        title="Thông số"
        right={
          <button type="button" class="btn" disabled={!online} onClick={() => onOpen({ kind: "params" })}>
            Sửa
          </button>
        }
      >
        <p class="nw-line">{paramsSummary(f.params)}</p>
      </Card>

      <Card
        title="Mốc an tâm"
        flush
        note="Mất thu nhập thì cả nhà sống bình thường được bao lâu — gồm vàng và tài sản có cờ Tiền lỏng, không phải tiền chi tiêu. Khác Quỹ an tâm ở tab Tích sản."
      >
        <div class="blist">
          {f.safety.map((s) => (
            <TierRow
              key={s.key}
              name={`${s.months} tháng chi phí`}
              dot={null}
              chip={<ReachChip reached={s.reached} />}
              amount={pctText(s.pct)}
              left={safetyText(s)}
              bar={s.pct !== null ? { pct: s.pct, tone: s.reached ? "ok" : undefined } : null}
            />
          ))}
        </div>
        {f.monthsCovered !== null && <p class="fhint">Tiền lỏng {formatVnd(f.liquid)} đủ {String(f.monthsCovered).replace(".", ",")} tháng chi phí.</p>}
      </Card>

      <Card title="Thu nhập" flush note={source ? `Thu nhập nhà ${source}.` : undefined}>
        <div class="blist">
          {f.income.map((m) => (
            <TierRow key={m.key} name={MILESTONE_LABEL[m.key].name} dot={null} chip={<ReachChip reached={m.reached} />} amount="" left={incomeMilestoneText(m)} />
          ))}
        </div>
      </Card>

      <Card title="Tự do" flush note="Tài sản đầu tư đã trừ nợ, so với mốc theo tỷ lệ rút an toàn; hoặc dòng tiền ròng (sau bù lạm phát) đủ chi.">
        <div class="blist">
          {f.freedom.map((m) => (
            <FreedomRow key={m.key} m={m} />
          ))}
        </div>
      </Card>

      <PlanCard plan={f.incomePlan} year={f.year} onOpen={onOpen} />
    </>
  );
}

function ReachChip({ reached }: { reached: boolean | null }) {
  if (reached === null) return null;
  return reached ? <span class="chip ok">đạt</span> : <span class="chip">chưa đạt</span>;
}

function FreedomRow({ m }: { m: FreedomMilestone }) {
  const cash = freedomCashflowText(m);
  return (
    <div class="tier">
      <div class="nm">
        {MILESTONE_LABEL[m.key].name}
        <ReachChip reached={m.reached} />
      </div>
      <div class="amt">{pctText(m.pct)}</div>
      <div class="tsub nw-sub">
        <span>{freedomHaveText(m)}</span>
      </div>
      {m.pct !== null && <Bar pct={m.pct} tone={m.reached ? "ok" : undefined} />}
      {cash && (
        <div class="tsub nw-sub">
          <span>{cash}</span>
        </div>
      )}
      {m.target && (
        <div class="tsub nw-sub">
          <span>{freedomTargetText(m.target)}</span>
        </div>
      )}
    </div>
  );
}

/** Card Kế hoạch thu nhập năm nay (UC-1104). */
function PlanCard({ plan, year, onOpen }: { plan: IncomePlanYear | null; year: number; onOpen: (o: Open) => void }) {
  const { online } = useApp();
  const actions = (
    <div class="pad grid grid-cols-2 gap-2">
      <button type="button" class="btn btn-primary" disabled={!online} onClick={() => onOpen({ kind: "plan", year })}>
        {plan?.current ? "Sửa kế hoạch" : "Đặt kế hoạch"}
      </button>
      <button type="button" class="btn" onClick={() => onOpen({ kind: "years" })}>
        Các năm ›
      </button>
    </div>
  );
  if (!plan?.current) {
    return (
      <Card title={`Kế hoạch thu nhập ${year}`} flush>
        <Empty title="Chưa có kế hoạch năm nay.">Đặt mục tiêu thu nhập ròng mỗi tháng của cả nhà; chia theo người nếu muốn.</Empty>
        {actions}
      </Card>
    );
  }
  return (
    <Card title={`Kế hoạch thu nhập ${year}`} flush>
      <PlanBody plan={plan} />
      {actions}
    </Card>
  );
}

function PlanBody({ plan }: { plan: IncomePlanYear }) {
  const edited = editedText(plan);
  // Tên dòng của từng người trong bản hiện tại: "Lương · Chồng".
  const lineName = (memberId: string | null) =>
    plan.current?.lines
      .filter((l) => l.memberId === memberId)
      .map((l) => l.name)
      .join(", ");
  return (
    <div class="blist">
      <div class="tier">
        <div class="nm">{planHeadline(plan)}</div>
        <div class="tsub nw-sub">
          <span>{planSub(plan)}</span>
        </div>
        {plan.actual.pctOfCurrent !== null && <Bar pct={plan.actual.pctOfCurrent} tone={plan.actual.pctOfCurrent >= 100 ? "ok" : undefined} />}
        {edited && (
          <div class="tsub">
            <span>{edited}</span>
          </div>
        )}
      </div>
      {plan.byMember?.map((m) => (
        <div class="tier" key={m.memberId ?? "shared"}>
          <div class="nm">{[lineName(m.memberId), m.memberName].filter(Boolean).join(" · ")}</div>
          <div class="tsub nw-sub">
            <span>{memberPlanText(m, plan.actual.monthsCounted > 0)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Sửa thông số tại chỗ — cùng sheet Cài đặt › Tham số › Tài sản & tự do. */
function ParamsSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (text: string) => void }) {
  const settings = useResource<SettingsData>("/v1/settings");
  if (!settings.data) return null;
  return (
    <FiConfigSheet
      config={settings.data.config}
      onClose={onClose}
      onSaved={async (text) => {
        onSaved(text);
        await refresh();
      }}
    />
  );
}

function YearsSheet({ onClose, onOpen }: { onClose: () => void; onOpen: (year: number) => void }) {
  const res = useResource<{ years: IncomePlanSummary[] }>("/v1/income-plans");
  return (
    <Sheet open title="Kế hoạch các năm" onClose={onClose}>
      <Loadable res={res}>
        {(d) =>
          d.years.length === 0 ? (
            <Empty title="Chưa có kế hoạch năm nào." />
          ) : (
            <>
              {d.years.map((y) => (
                <button type="button" class="srow" key={y.year} onClick={() => onOpen(y.year)}>
                  <span class="srow-main">
                    <span class="srow-t">
                      {y.year} · {formatVnd(y.currentMonthly)}/tháng
                    </span>
                    <span class="srow-s">{planYearRow(y)}</span>
                  </span>
                  <Icon name="chevron-right" size={16} />
                </button>
              ))}
            </>
          )
        }
      </Loadable>
    </Sheet>
  );
}

function YearSheet({ year, onClose, onEdit }: { year: number; onClose: () => void; onEdit: () => void }) {
  const { online } = useApp();
  const res = useResource<IncomePlanYear>(`/v1/income-plans/${year}`);
  return (
    <Sheet open title={`Kế hoạch thu nhập ${year}`} onClose={onClose}>
      <Loadable res={res}>{(y) => (y.current ? <PlanBody plan={y} /> : <Empty title="Năm này chưa có kế hoạch." />)}</Loadable>
      <div class="pad">
        <button type="button" class="btn btn-primary btn-wide" disabled={!online} onClick={onEdit}>
          Sửa kế hoạch {year}
        </button>
      </div>
    </Sheet>
  );
}

let planKey = 100;

/** Sửa kế hoạch: mục tiêu cả nhà bắt buộc; chia theo người tuỳ chọn. Lưu là một bản mới (UC-1104). */
function PlanSheet({ year, onClose, onSaved }: { year: number; onClose: () => void; onSaved: (text: string) => void }) {
  const { boot, online } = useApp();
  const res = useResource<IncomePlanYear>(`/v1/income-plans/${year}`);
  const [f, setF] = useState<PlanForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (res.data && !f) setF(planFormFrom(res.data));
    if (res.error && !f) setF(planFormFrom(null));
  }, [res.data, res.error]);
  const members = boot?.members ?? [];
  if (!f) return null;
  const setLine = (key: number, patch: Partial<PlanForm["lines"][number]>) => setF({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const split = planSplitHint(f.household, f.lines);

  async function submit() {
    const r = planPayload(f!);
    if (!r.ok) {
      setErrors(r.errors);
      setError("Còn ô chưa đúng, xem dòng đỏ.");
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      await api.put(`/v1/income-plans/${year}`, r.value);
      onSaved(`Đã lưu kế hoạch ${year}: ${formatVnd(f!.household)} mỗi tháng.`);
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open title={`Kế hoạch thu nhập ${year}`} onClose={onClose}>
      <Field id="p-house" label="Mục tiêu cả nhà / tháng" error={errors.household} first>
        <AmountInput id="p-house" value={f.household} onChange={(n) => setF({ ...f, household: n })} autoFocus />
      </Field>
      <Hint>Thu nhập ròng mỗi tháng (sau thuế) của cả nhà.</Hint>
      <div class="set-sub">Chia theo người (tuỳ chọn)</div>
      {f.lines.map((l) => (
        <div class="nw-plan-line" key={l.key}>
          <div class="field">
            <input class="ctl" aria-label="Tên dòng" maxLength={60} placeholder="Lương, Cho thuê…" value={l.name} onInput={(e) => setLine(l.key, { name: e.currentTarget.value })} />
            <select class="ctl" aria-label="Người" value={l.memberId ?? ""} onChange={(e) => setLine(l.key, { memberId: e.currentTarget.value || null })}>
              <option value="">Chung</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div class="field">
            <AmountInput id={`p-line-${l.key}`} value={l.monthly} onChange={(n) => setLine(l.key, { monthly: n })} />
            <button type="button" class="btn btn-ghost" onClick={() => setF({ ...f, lines: f.lines.filter((x) => x.key !== l.key) })}>
              Xoá
            </button>
          </div>
          {errors[`line${l.key}`] && <p class="err ferr">{errors[`line${l.key}`]}</p>}
        </div>
      ))}
      <div class="pad">
        <button type="button" class="btn btn-wide" onClick={() => setF({ ...f, lines: [...f.lines, { key: ++planKey, name: "", memberId: null, monthly: 0 }] })}>
          <Icon name="plus" size={16} /> Thêm dòng
        </button>
      </div>
      {split && <Hint>{split}</Hint>}
      <Hint>Lưu là một bản mới — mục tiêu đầu năm vẫn giữ.</Hint>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={!online || busy} onClick={() => void submit()}>
          {busy ? "Đang lưu…" : "Lưu kế hoạch"}
        </button>
        {!online && <NeedsNetwork what="Lưu kế hoạch thu nhập" />}
      </div>
    </Sheet>
  );
}

// ── Thử số ──────────────────────────────────────────────────────────

export function ProjectionSection({ today }: { today: string }) {
  const res = useResource<Freedom>("/v1/freedom");
  return <Loadable res={res}>{(f) => <Projection start={f.projectionStart} year={Number(today.slice(0, 4))} />}</Loadable>;
}

function Projection({ start, year }: { start: ProjectionStart; year: number }) {
  const { boot } = useApp();
  const real = useMemo(() => startToForm(start, (id) => boot?.members.find((m) => m.id === id)?.name), [start, boot]);
  const [f, setF] = useState<ProjectionForm>(() => keptDraft() ?? real);
  const [open, setOpen] = useState(true);
  // Giữ số gõ trong bộ nhớ trang: rời màn rồi quay lại vẫn còn; tải lại app thì về số thật (UC-1107 AC-2).
  useEffect(() => keepDraft(f === real ? null : f), [f, real]);
  const set = (patch: Partial<ProjectionForm>) => setF((x) => ({ ...x, ...patch }));
  const parsed = formToInput(f, year);
  const p = parsed.ok ? project(parsed.value) : null;
  const errors = parsed.ok ? {} : parsed.errors;
  const pctField = (id: string, key: "returnPct" | "inflation" | "swr" | "savingsRate", label: string) => (
    <Field id={id} label={label} error={errors[key]}>
      <input id={id} class="ctl money" inputMode="decimal" autocomplete="off" value={f[key]} onInput={(e) => set({ [key]: e.currentTarget.value })} />
    </Field>
  );
  const intField = (id: string, key: "birthYear" | "f1" | "f2", label: string) => (
    <Field id={id} label={label} error={errors[key]}>
      <input id={id} class="ctl money" inputMode="numeric" autocomplete="off" placeholder="chưa đặt" value={f[key]} onInput={(e) => set({ [key]: e.currentTarget.value })} />
    </Field>
  );

  return (
    <>
      <div class="nw-sticky-warn">
        <Banner tone="warn" mark="!" action="Đặt lại về số thật" onAction={() => setF(real)}>
          <strong>Số thử — không lưu, không phải số thật.</strong>
        </Banner>
      </div>

      <Card
        title="Giả định"
        right={
          <button type="button" class="btn btn-ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={16} /> {open ? "Thu gọn" : "Mở"}
          </button>
        }
        flush
      >
        {open && (
          <>
            <Field id="pj-a" label="Tài sản đầu tư" first>
              <AmountInput id="pj-a" value={f.investable} onChange={(n) => set({ investable: n })} />
            </Field>
            <Field id="pj-l" label="Nợ">
              <AmountInput id="pj-l" value={f.liabilities} onChange={(n) => set({ liabilities: n })} />
            </Field>
            <div class="set-sub">Thu nhập mỗi tháng</div>
            {f.incomes.map((l) => (
              <div class="nw-plan-line" key={l.key}>
                <div class="field">
                  <input class="ctl" aria-label="Tên dòng thu nhập" maxLength={60} value={l.name} onInput={(e) => set({ incomes: f.incomes.map((x) => (x.key === l.key ? { ...x, name: e.currentTarget.value } : x)) })} />
                  <button type="button" class="btn btn-ghost" onClick={() => set({ incomes: f.incomes.filter((x) => x.key !== l.key) })}>
                    Xoá
                  </button>
                </div>
                <div class="field">
                  <AmountInput id={`pj-i-${l.key}`} value={l.monthly} onChange={(n) => set({ incomes: f.incomes.map((x) => (x.key === l.key ? { ...x, monthly: n } : x)) })} />
                  <span class="nw-growth">
                    +
                    <input
                      class="ctl money"
                      aria-label={`${l.name}: tăng %/năm`}
                      inputMode="decimal"
                      value={l.growth}
                      onInput={(e) => set({ incomes: f.incomes.map((x) => (x.key === l.key ? { ...x, growth: e.currentTarget.value } : x)) })}
                    />
                    %/năm
                  </span>
                </div>
                {errors[`growth${l.key}`] && <p class="err ferr">{errors[`growth${l.key}`]}</p>}
              </div>
            ))}
            <div class="pad">
              <button type="button" class="btn btn-wide" onClick={() => set({ incomes: [...f.incomes, { key: ++planKey, name: "Thu nhập thêm", monthly: 0, growth: "0" }] })}>
                <Icon name="plus" size={16} /> Thêm dòng thu nhập
              </button>
            </div>
            <div class="field">
              <span class="k">Để dành</span>
              <Seg
                label="Để dành"
                value={f.savingsMode}
                onChange={(savingsMode) => set({ savingsMode })}
                options={[
                  { value: "rest", label: "Phần còn lại" },
                  { value: "rate", label: "Tỷ lệ cố định" },
                ]}
              />
            </div>
            {f.savingsMode === "rate" && pctField("pj-sr", "savingsRate", "Tỷ lệ để dành %")}
            <Field id="pj-e" label="Chi phí tháng (E)">
              <AmountInput id="pj-e" value={f.expense} onChange={(n) => set({ expense: n })} />
            </Field>
            <Field id="pj-em" label="Chi Must tháng">
              <AmountInput id="pj-em" value={f.expenseMust} onChange={(n) => set({ expenseMust: n })} />
            </Field>
            {pctField("pj-r", "returnPct", "Lợi suất %/năm")}
            {pctField("pj-inf", "inflation", "Lạm phát %/năm")}
            {pctField("pj-swr", "swr", "SWR %")}
            {intField("pj-by", "birthYear", "Năm sinh")}
            {intField("pj-f1", "f1", "Tuổi F1")}
            {intField("pj-f2", "f2", "Tuổi F2")}
          </>
        )}
      </Card>

      {!p ? (
        <Card>
          <Empty title="Sửa các ô đỏ ở Giả định để tính." />
        </Card>
      ) : (
        <>
          <Card title="Kết quả">
            <p class="nw-line">{reachText("F1", p.f1)}</p>
            <p class="nw-line">{reachText("F2", p.f2)}</p>
            <p class="fhint" style={{ padding: 0 }}>
              F1 hôm nay {formatVnd(p.f1Today)} · F2 hôm nay {formatVnd(p.f2Today)}; mỗi năm quy theo lạm phát.
            </p>
          </Card>
          <Card title="Theo năm" flush>
            <div class="blist">
              {p.rows.map((r) => (
                <YearRow key={r.year} r={r} f1Year={p.f1?.year ?? null} f2Year={p.f2?.year ?? null} />
              ))}
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function YearRow({ r, f1Year, f2Year }: { r: ProjectionRow; f1Year: number | null; f2Year: number | null }) {
  return (
    <div class="tier">
      <div class="nm">
        {r.year}
        {r.age !== null ? ` · ${r.age} tuổi` : ""}
        {r.year === f1Year && <span class="chip ok">F1</span>}
        {r.year === f2Year && <span class="chip ok">F2</span>}
      </div>
      <div class="amt">
        <Money value={r.net} />
      </div>
      <div class="tsub nw-sub">
        <span>
          thu {formatVnd(r.income)} · {r.expense === null ? "chi phí theo tỷ lệ" : `chi ${formatVnd(r.expense)}`} · để dành {formatVnd(r.savings)}/tháng ({pctText(r.savingsRate)})
        </span>
      </div>
      <div class="nw-mini">
        <span>F1 {pctText(r.f1Pct)}</span>
        <Bar pct={r.f1Pct ?? 0} tone={r.f1 ? "ok" : undefined} />
        <span>F2 {pctText(r.f2Pct)}</span>
        <Bar pct={r.f2Pct ?? 0} tone={r.f2 ? "ok" : undefined} />
      </div>
    </div>
  );
}
