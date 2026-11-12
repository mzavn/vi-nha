// Màn "Chuyển sang ba ngăn" (`#convert`, pocket UC-1208, pwa UC-711 AC-28): màn phụ không tab, năm bước làm một lần, mỗi bước lưu
// ngay lên server; mở lại vào đúng bước kế tiếp. Logic thuần (bước, 409 theo `next`, lựa chọn bước 2, chữ bước 3–5) ở lib/convert.ts.
// Không có gì để chuyển (`conversion` null, đã xong) → về Hôm nay. Cần mạng: mất mạng thì nút gửi khoá, câu "Cần mạng".

import { useCallback, useEffect, useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import {
  canPayFromOperating,
  CONVERT_DONE_TOAST,
  convertTitle,
  type ConversionStatus,
  type ConversionStep,
  cycleStreamsNote,
  cycleSwitchStreams,
  type GoalAccountResult,
  type GoalChoice,
  goalAccountRequest,
  GOAL_ORDER_NOTE,
  goalGroupLines,
  goalRowAccounts,
  GOALS_STEP_TITLE,
  goalStepRequests,
  goalsReady,
  goalTerms,
  initialGoalChoices,
  isConversionStep,
  NO_RESERVE_ACCOUNT,
  OPERATING_CHOICE_LABEL,
  payCycleReady,
  rewardRowAccounts,
  SAVINGS_GAP_EXPLAIN,
  savingsGapLines,
  savingsPctLines,
  savingsPctStep,
  stepConflict,
  USE_DEFAULT_PCT,
} from "../lib/convert";
import { formatVnd } from "../lib/money";
import { groupAccountsByPocket, unconfirmedChip } from "../lib/pockets";
import { OPENS_CYCLE_HINT, OPERATING_HINT, parseInteger, sliderPct } from "../lib/settings";
import type { Rental, SettingsData } from "../lib/types";
import { useResource } from "../state/resource";
import { go, refresh, toast, useApp, viewSnapshot } from "../state/store";
import { Icon } from "../ui/icons";
import { Card, PageHeader, Skeleton } from "../ui/parts";
import { SavingsSlider } from "../ui/savings-slider";
import { AccountSheet, Check, GoalSheet, Hint, NEW_ACCOUNT, PocketsSheet, POCKETS_SHEET_NOTE } from "./settings-sheets";

/** Lựa chọn trong ô của một dòng mục tiêu ngoài mã tài khoản (mã tài khoản là slug, không có dấu +). */
const OFF = "+off";
const LATER = "+later";
const OPERATING = "+operating";

export function Convert() {
  const app = useApp();
  const [status, setStatus] = useState<ConversionStatus | null>(null);
  const [data, setData] = useState<SettingsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [s, d] = await Promise.all([api.get<ConversionStatus>("/v1/conversion", true), api.get<SettingsData>("/v1/settings", true)]);
      setStatus(s);
      setData(d);
    } catch (err) {
      setLoadError(errorText(err));
    }
  }, []);
  useEffect(() => void load(), [load, app.online]);

  const reloadSettings = useCallback(async () => {
    setData(await api.get<SettingsData>("/v1/settings", true));
  }, []);

  // Không có gì để chuyển: snapshot nói đã xong (hay nhà cài mới), hoặc server nói không còn bước nào → Hôm nay.
  const snapDone = app.snap !== null && app.snap.conversion == null;
  const serverDone = status !== null && (status.state !== "pending" || status.next === null);
  useEffect(() => {
    if (snapDone || serverDone) go("today");
  }, [snapDone, serverDone]);

  /** Gửi "bước này xong". 409 có `next` → vẽ lại theo `next`; không báo lỗi khi `next` đã qua bước vừa gửi. */
  async function postStep(step: ConversionStep, body: Record<string, unknown> = {}): Promise<void> {
    try {
      const s = await api.post<ConversionStatus>(`/v1/conversion/steps/${step}`, body);
      setStatus(s);
      if (s.next === null) toast(CONVERT_DONE_TOAST);
    } catch (err) {
      const conflict = stepConflict(step, err);
      if (!conflict) throw err;
      setStatus((s) => (s ? { ...s, next: conflict.next } : s));
      if (!conflict.silent) throw err;
    } finally {
      void refresh();
    }
  }

  const step = status && isConversionStep(status.next) ? status.next : null;
  const offline = !app.online;
  const header = (
    <PageHeader
      title={step ? convertTitle(step) : "Chuyển sang ba ngăn"}
      sub="Làm một lần: tiền thật của ba ngăn thay cho ví cũ"
      action={
        <button type="button" class="btn" onClick={() => go("today")}>
          Để sau
        </button>
      }
    />
  );

  if (!status || !data || !step) {
    return (
      <>
        {header}
        {loadError ? (
          <div class="banner b-bad" role="alert">
            <span class="ic" aria-hidden="true">
              !
            </span>
            <div class="txt">
              <strong>Chưa tải được bước chuyển đổi.</strong> {loadError} {offline && "Cần mạng."}
            </div>
            <button type="button" class="link act" disabled={offline} onClick={() => void load()}>
              Thử lại
            </button>
          </div>
        ) : (
          <Card>
            <Skeleton rows={4} />
          </Card>
        )}
      </>
    );
  }

  const props = { data, offline, postStep, reloadSettings };
  return (
    <>
      {header}
      {offline && (
        <div class="status-row" role="status">
          <Icon name="cloud-off" size={16} />
          <span style={{ flex: 1, minWidth: 0 }}>Cần mạng</span>
        </div>
      )}
      {step === "pockets" && <PocketsStep {...props} />}
      {step === "goals" && <GoalsStep {...props} />}
      {step === "savings_gap" && <SavingsGapStep {...props} status={status} />}
      {step === "pay_cycle" && <PayCycleStep {...props} />}
      {step === "savings_pct" && <SavingsPctStep {...props} />}
    </>
  );
}

interface StepProps {
  data: SettingsData;
  offline: boolean;
  postStep: (step: ConversionStep, body?: Record<string, unknown>) => Promise<void>;
  reloadSettings: () => Promise<void>;
}

/** Nút gửi của một bước: khoá khi mất mạng / đang gửi / chưa đủ điều kiện; lỗi hiện ngay trên nút. */
function useSend() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, send };
}

function StepFooter(props: { label: string; busy: boolean; error: string | null; disabled: boolean; offline: boolean; onClick: () => void }) {
  return (
    <div class="pad">
      {props.error && (
        <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
          {props.error}
        </p>
      )}
      <button type="button" class="btn btn-primary btn-wide" disabled={props.offline || props.busy || props.disabled} onClick={props.onClick}>
        {props.busy ? "Đang lưu…" : props.label}
      </button>
    </div>
  );
}

// ── Bước 1: xếp tài khoản vào ngăn ───────────────────────────────────

function PocketsStep({ data, offline, postStep, reloadSettings }: StepProps) {
  const [open, setOpen] = useState(false);
  const chip = unconfirmedChip(data.accounts);
  const counts = groupAccountsByPocket(data.accounts, Object.fromEntries(data.accounts.map((a) => [a.id, a.pocket ?? null])))
    .map((g) => `${g.label} ${g.accounts.length}`)
    .join(" · ");
  return (
    <>
      <Card title="Xếp tài khoản vào ngăn" flush>
        <p class="note">{POCKETS_SHEET_NOTE}</p>
        <div class="srow">
          <span class="srow-main">
            <span class="srow-t">
              {counts} {chip && <span class="chip warn">{chip}</span>}
            </span>
            <span class="srow-s">App đã điền sẵn ngăn đề xuất cho từng tài khoản; xem lại rồi Xác nhận.</span>
          </span>
        </div>
        <StepFooter label="Xem và xác nhận ngăn" busy={false} error={null} disabled={false} offline={offline} onClick={() => setOpen(true)} />
      </Card>
      {open && (
        <PocketsSheet
          d={data}
          onClose={() => setOpen(false)}
          onSaved={async () => {
            await reloadSettings();
            await postStep("pockets");
          }}
        />
      )}
    </>
  );
}

// ── Bước 2: mỗi mục tiêu một tài khoản thật (nhiều mục tiêu dùng chung được một tài khoản, UC-1208 AC-11) ──

function GoalsStep({ data, offline, postStep, reloadSettings }: StepProps) {
  const app = useApp();
  const { busy, error, send } = useSend();
  const goals = data.goals.filter((g) => g.active).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "vi"));
  const savedReward = data.config.surplus_reward_account ?? null;
  const [reward, setReward] = useState<string | null>(savedReward);
  const [picked, setPicked] = useState<Record<string, GoalChoice | null>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Lựa chọn sẵn tính lại theo cài đặt mới nhất (mục tiêu mới, tài khoản vừa tạo), lựa chọn người đã chọn đè lên.
  const choices = { ...initialGoalChoices(goals, data.accounts, savedReward), ...picked };
  const hasReserve = data.accounts.some((a) => a.active && a.pocket === "reserve");
  const groupLines = goalGroupLines(goals, data.accounts, choices, data.goal_groups);
  const peace = viewSnapshot(app)?.pockets?.reserve.peace;
  const creating = goals.find((g) => g.id === creatingFor);
  const saved = async () => {
    await reloadSettings();
    void refresh();
  };

  function choose(goalId: string, value: string) {
    const choice: GoalChoice | null =
      value === OFF ? { kind: "off" } : value === LATER ? { kind: "later" } : value === OPERATING ? { kind: "operating" } : value ? { kind: "account", accountId: value } : null;
    setPicked((x) => ({ ...x, [goalId]: choice }));
  }

  function next() {
    void send(async () => {
      for (const r of goalStepRequests(goals, choices, { current: savedReward, next: reward })) {
        await (r.method === "PUT" ? api.put(r.path, r.body) : api.patch(r.path, r.body));
      }
      await saved();
      await postStep("goals");
    });
  }

  return (
    <>
      <Card title={GOALS_STEP_TITLE} flush note="Mỗi khoản để dành ở một tài khoản thật ở ngăn Dự phòng (nhiều khoản dùng chung được một tài khoản, số dư lấp lần lượt theo thứ tự ưu tiên); khoản trả mỗi tháng có thể trả thẳng từ tiền chi tiêu">
        {!hasReserve && <p class="note">{NO_RESERVE_ACCOUNT}</p>}
        {goals.length === 0 && <p class="empty">Chưa có mục tiêu nào.</p>}
        {goals.map((g) => {
          const c = choices[g.id];
          const value = !c ? "" : c.kind === "account" ? c.accountId : c.kind === "operating" ? OPERATING : c.kind === "off" ? OFF : LATER;
          const options = goalRowAccounts(g.id, data.goals, data.accounts, choices, reward);
          const chosen = c?.kind === "account" ? options.find((a) => a.id === c.accountId) : undefined;
          const id = `cv-goal-${g.id}`;
          return (
            <div key={g.id} class="field cv-goal-row">
              <label class="k" for={id}>
                <span class="srow-t">{g.name}</span>
                {goalTerms(g) && <span class="srow-s"> · {goalTerms(g)}</span>}
              </label>
              <select
                id={id}
                class="ctl"
                value={value}
                onChange={(ev) => {
                  const v = ev.currentTarget.value;
                  if (v !== NEW_ACCOUNT) return choose(g.id, v);
                  // Ô giữ lựa chọn cũ cho tới khi tài khoản mới lưu xong (rồi tự gắn).
                  ev.currentTarget.value = value;
                  setCreatingFor(g.id);
                }}
              >
                <option value="" disabled>
                  Chọn…
                </option>
                {options.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.blocked !== null && a.id !== value}>
                    {`${a.name} · đã có ${formatVnd(a.book_balance ?? 0)}${a.deposits ? ` (${a.deposits})` : ""}${a.shared ? ` — ${a.shared}` : ""}${a.blocked ? ` (${a.blocked})` : ""}`}
                  </option>
                ))}
                <option value={NEW_ACCOUNT}>Tạo tài khoản mới</option>
                {canPayFromOperating(g) && <option value={OPERATING}>{OPERATING_CHOICE_LABEL}</option>}
                <option value={OFF}>Không dùng mục tiêu này</option>
                <option value={LATER}>Để sau</option>
              </select>
              {/* Tên tài khoản đã chọn và "dùng chung với …" hiện đủ ở dòng dưới, xuống dòng — ô chọn chiếm cả dòng ở 390px. */}
              {chosen?.shared && (
                <span class="sub-line cv-goal-shared">
                  {chosen.name} — {chosen.shared}
                </span>
              )}
              {c?.kind === "operating" && <span class="sub-line cv-goal-shared">{OPERATING_HINT}</span>}
            </div>
          );
        })}
        {groupLines.map((l) => (
          <p key={l.accountId} class="note cv-goal-group">
            {l.text}
          </p>
        ))}
        {groupLines.length > 0 && <Hint>{GOAL_ORDER_NOTE}</Hint>}
        <div class="field">
          <label class="k" for="cv-reward">
            Ví Thưởng
          </label>
          <select id="cv-reward" class="ctl" value={reward ?? ""} onChange={(ev) => setReward(ev.currentTarget.value || null)}>
            <option value="">Chưa chọn</option>
            {rewardRowAccounts(data.accounts, data.goals, choices).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {formatVnd(a.book_balance ?? 0)}
              </option>
            ))}
          </select>
        </div>
        <Hint>Ví Thưởng nhận phần dư kỳ trước; là một tài khoản Dự phòng không gắn mục tiêu.</Hint>
        <div class="pad">
          <button type="button" class="btn" disabled={offline} onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            Thêm mục tiêu
          </button>
        </div>
        {peace !== undefined && (
          <div class="field">
            <span class="k">Phần an tâm: {formatVnd(peace)}</span>
          </div>
        )}
        <Hint>Để sau: mục tiêu giữ nguyên, chưa có việc nạp ở ngày lương; thẻ Dự phòng nhắc mở tài khoản thật.</Hint>
        <StepFooter label="Tiếp" busy={busy} error={error} disabled={!goalsReady(goals, choices)} offline={offline} onClick={next} />
      </Card>
      {creating && (
        <AccountSheet
          d={data}
          item={null}
          preset={{ name: creating.name, pocket: "reserve", pocket_touched: true }}
          create={{
            // Một yêu cầu vừa tạo vừa gắn (pocket UC-1208 AC-9): mất phản hồi thì Lưu lại gửi đúng thân này, không thành hai tài khoản.
            send: async (body) => {
              const r = goalAccountRequest(creating.id, body);
              const res = await api.post<GoalAccountResult>(r.path, r.body);
              setPicked((x) => ({ ...x, [creating.id]: { kind: "account", accountId: res.account.id } }));
            },
            toast: (name) => `Đã tạo ${name} và gắn vào ${creating.name}`,
          }}
          onClose={() => setCreatingFor(null)}
          onSaved={async (text) => {
            toast(text);
            await saved();
          }}
        />
      )}
      {adding && (
        <GoalSheet
          d={data}
          item={null}
          onClose={() => setAdding(false)}
          onSaved={async (text) => {
            toast(text);
            await saved();
          }}
        />
      )}
    </>
  );
}

// ── Bước 3: Tích luỹ — tiền thật khác ví cũ ─────────────────────────

function SavingsGapStep({ offline, postStep, status }: StepProps & { status: ConversionStatus }) {
  const { busy, error, send } = useSend();
  const lines = status.savingsGap ? savingsGapLines(status.savingsGap) : null;
  return (
    <Card title="Tích luỹ: tiền thật khác ví cũ" flush>
      {lines && (
        <>
          <div class="srow">
            <span class="srow-main">
              <span class="srow-t">{lines.legacy}</span>
              <span class="srow-s">{lines.assets}</span>
            </span>
          </div>
          <div class="srow">
            <span class="srow-main">
              <span class="srow-t">{lines.real}</span>
            </span>
          </div>
          <div class="srow">
            <span class="srow-main">
              <span class="srow-t">{lines.diff}</span>
            </span>
          </div>
        </>
      )}
      <p class="note">{SAVINGS_GAP_EXPLAIN}</p>
      {lines?.noAccount && <p class="note">{lines.noAccount}</p>}
      <StepFooter label="Tiếp" busy={busy} error={error} disabled={false} offline={offline} onClick={() => void send(() => postStep("savings_gap"))} />
    </Card>
  );
}

// ── Bước 4: bật "Mở kỳ lương" ───────────────────────────────────────

function PayCycleStep({ data, offline, postStep, reloadSettings }: StepProps) {
  const { busy, error, send } = useSend();
  const rental = useResource<Rental>("/v1/rental");
  const [noSalary, setNoSalary] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const streams = cycleSwitchStreams(data.incomeStreams ?? [], rental.data?.incomeStreamId);
  const on = streams.filter((s) => s.opens_cycle).length;
  const note = cycleStreamsNote(on);

  async function toggle(id: string, opens_cycle: boolean) {
    setToggling(id);
    setToggleError(null);
    try {
      await api.patch(`/v1/settings/income-streams/${encodeURIComponent(id)}`, { opens_cycle });
      await reloadSettings();
    } catch (err) {
      setToggleError(errorText(err));
    } finally {
      setToggling(null);
    }
  }

  return (
    <Card title="Bật “Mở kỳ lương”" flush>
      {streams.length === 0 && <p class="empty">Chưa có nguồn thu nào đang dùng.</p>}
      {streams.map((s) => (
        <Check key={s.id} id={`cv-stream-${s.id}`} label={s.name} checked={s.opens_cycle ?? false} disabled={offline || toggling !== null} onChange={(v) => void toggle(s.id, v)} />
      ))}
      {toggleError && (
        <p class="err" role="alert" style={{ margin: "8px 16px" }}>
          {toggleError}
        </p>
      )}
      <Hint>{OPENS_CYCLE_HINT}</Hint>
      {note && <Hint>{note}</Hint>}
      <Check id="cv-no-salary" label="Nhà mình không có lương cố định" checked={noSalary} disabled={offline} onChange={setNoSalary} />
      <StepFooter
        label="Tiếp"
        busy={busy}
        error={error}
        disabled={!payCycleReady(on, noSalary) || toggling !== null}
        offline={offline}
        onClick={() => void send(() => postStep("pay_cycle", on === 0 && noSalary ? { no_salary: true } : {}))}
      />
    </Card>
  );
}

// ── Bước 5: % Tích luỹ mỗi kỳ lương ─────────────────────────────────

function SavingsPctStep({ data, offline, postStep }: StepProps) {
  const { busy, error, send } = useSend();
  // Số 0038 đã điền (thang 1 · 10 · 30, ADR-142); khác 10 thì nói rõ số lấy từ cách chia ví cũ cho tới khi người đổi.
  const prefilled = savingsPctStep(data.config.savings_pct);
  const [text, setText] = useState(String(prefilled.pct));
  const pct = parseInteger(text, 1, 100);
  const lines = savingsPctLines(pct);
  return (
    <Card title="% Tích luỹ mỗi kỳ lương" flush>
      <div class="field">
        <label class="k" for="cv-savings-pct">
          % Tích luỹ
        </label>
        <input
          id="cv-savings-pct"
          class="ctl money"
          inputMode="numeric"
          pattern="[0-9]*"
          autocomplete="off"
          maxLength={3}
          value={text}
          onInput={(ev) => setText(ev.currentTarget.value)}
          {...(pct === null ? { "aria-invalid": "true" as const } : {})}
        />
      </div>
      <SavingsSlider pct={sliderPct(text)} onPct={(p) => setText(String(p))} />
      {prefilled.legacy && pct === prefilled.pct && <Hint>{prefilled.legacy}</Hint>}
      <Hint>{prefilled.scale}</Hint>
      {pct !== USE_DEFAULT_PCT.pct && (
        <div class="pad">
          <button type="button" class="btn" onClick={() => setText(String(USE_DEFAULT_PCT.pct))}>
            {USE_DEFAULT_PCT.label}
          </button>
        </div>
      )}
      {lines ? (
        <>
          <Hint>{lines.line}</Hint>
          <Hint>{lines.example}</Hint>
        </>
      ) : (
        <p class="err" role="alert" style={{ margin: "8px 16px" }}>
          % Tích luỹ là số nguyên từ 1 đến 100.
        </p>
      )}
      <StepFooter label="Xong" busy={busy} error={error} disabled={pct === null} offline={offline} onClick={() => void send(() => postStep("savings_pct", { savings_pct: pct }))} />
    </Card>
  );
}
