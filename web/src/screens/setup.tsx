// Thiết lập nhà lần đầu (UC-510, UC-701 AC-8): DB mới chưa có ai thì màn này thay màn đăng nhập.
// Bốn bước: Mật khẩu chung → Thành viên → Tài khoản → Ba ngăn; xong vào thẳng Hôm nay bằng phiên của chủ hộ.
// Kiểm từng bước ở lib/setup.ts (có test); lỗi server có `field` thì mở lại đúng bước, hiện dưới đúng ô.

import { useEffect, useRef, useState } from "preact/hooks";
import { ACCOUNT_KIND_LABEL, type Errors } from "../lib/settings";
import { MAX_MEMBERS } from "../lib/members";
import {
  emptySetup,
  goalAccountChoices,
  GROUP_OPTIONS,
  MAX_GOALS,
  newAccount,
  newGoal,
  removeAccount,
  removeMember,
  SETUP_POCKET_OPTIONS,
  SETUP_STEPS,
  savingsStep,
  setupPayload,
  setupServerError,
  setupSummary,
  stepErrors,
  stepOfField,
  type SetupAccount,
  type SetupForm,
  type SetupGoal,
  type SetupMember,
  type SetupStep,
} from "../lib/setup";
import type { Pocket, SettingsAccount } from "../lib/types";
import { completeSetup, useApp } from "../state/store";
import { AmountInput } from "../ui/fields";
import { Icon } from "../ui/icons";
import { Seg } from "../ui/parts";
import { SavingsSlider } from "../ui/savings-slider";
import { BankOptions, Check, Field, Hint, invalid } from "./settings-sheets";

/** Id của ô theo khoá lỗi: "members.0.name" → "s-members-0-name". */
const idOf = (key: string) => `s-${key.replace(/\./g, "-")}`;

export function Setup() {
  const { online } = useApp();
  const [f, setF] = useState<SetupForm>(emptySetup);
  const [step, setStep] = useState<SetupStep>(0);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  /** Tăng mỗi lần đổi bước hay hiện lỗi: sau lần vẽ đó con trỏ tới ô lỗi đầu tiên, không có thì tới tiêu đề bước. */
  const [focusTick, setFocusTick] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusTick === 0) return;
    const key = Object.keys(errors).find((k) => document.getElementById(idOf(k)));
    const target = key ? document.getElementById(idOf(key)) : title.current;
    target?.focus({ preventScroll: Boolean(key) });
    if (key) target?.scrollIntoView({ block: "center" });
    else scrollTo({ top: 0 });
  }, [focusTick]);

  const set = (patch: Partial<SetupForm>) => setF((x) => ({ ...x, ...patch }));
  const setMember = (i: number, patch: Partial<SetupMember>) => setF((x) => ({ ...x, members: x.members.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const setAccount = (i: number, patch: Partial<SetupAccount>) => setF((x) => ({ ...x, accounts: x.accounts.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));

  /** Hiện lỗi; mở bước có lỗi, con trỏ vào ô lỗi đầu tiên. */
  function showErrors(errs: Errors, at: SetupStep) {
    setErrors(errs);
    setStep(at);
    setFocusTick((n) => n + 1);
  }

  async function next(e: Event) {
    e.preventDefault();
    setMessage(null);
    const errs = stepErrors(f, step);
    if (Object.keys(errs).length) return showErrors(errs, step);
    setErrors({});
    if (step < 3) {
      setStep((step + 1) as SetupStep);
      setFocusTick((n) => n + 1);
      return;
    }
    const r = setupPayload(f);
    if (!r.ok) {
      const at = Object.keys(r.errors).map(stepOfField).find((s) => s !== null) ?? step;
      return showErrors(r.errors, at);
    }
    setBusy(true);
    try {
      await completeSetup(r.value);
    } catch (err) {
      const s = setupServerError(err);
      setMessage(s.message);
      if (s.step !== null) showErrors(s.errors, s.step);
      setBusy(false);
    }
  }

  function back() {
    setErrors({});
    setMessage(null);
    setStep((step - 1) as SetupStep);
    setFocusTick((n) => n + 1);
  }

  return (
    <main class="app" style={{ paddingBottom: "32px" }}>
      <div style={{ padding: "calc(40px + var(--safe-top)) 4px 20px" }}>
        <h1 style={{ fontSize: "var(--text-title)", fontWeight: 600, letterSpacing: "-0.02em" }}>Ví nhà</h1>
        <p style={{ color: "var(--fg-2)", margin: "4px 0 0" }}>Thiết lập nhà lần đầu. Làm một lần, sửa lại được ở Cài đặt.</p>
      </div>
      <form class="card" onSubmit={next} noValidate>
        <div class="card-h">
          <h2 ref={title} tabIndex={-1} style={{ outline: "none" }}>
            {SETUP_STEPS[step]}
          </h2>
          <span class="chip" aria-label={`Bước ${step + 1} trên ${SETUP_STEPS.length}`}>
            Bước {step + 1}/{SETUP_STEPS.length}
          </span>
        </div>
        {step === 0 && <HouseholdStep f={f} set={set} errors={errors} show={show} toggle={() => setShow((v) => !v)} />}
        {step === 1 && <MembersStep f={f} setF={setF} setMember={setMember} errors={errors} />}
        {step === 2 && <AccountsStep f={f} setF={setF} setAccount={setAccount} errors={errors} />}
        {step === 3 && <PocketsStep f={f} set={set} setF={setF} setAccount={setAccount} errors={errors} />}
        <div class="pad" style={{ paddingBottom: "14px" }}>
          {message && (
            <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
              {message}
            </p>
          )}
          {step === 3 && !online && (
            <div class="status-row" style={{ margin: "0 0 8px" }}>
              <Icon name="cloud-off" size={16} />
              <span>Thiết lập cần mạng. Có mạng lại thì bấm Tạo nhà.</span>
            </div>
          )}
          <div class="flex gap-2">
            {step > 0 && (
              <button type="button" class="btn" style={{ minHeight: "50px" }} disabled={busy} onClick={back}>
                <Icon name="chevron-left" size={16} />
                Quay lại
              </button>
            )}
            <button type="submit" class="btn btn-primary btn-wide" style={{ flex: 1 }} disabled={busy || (step === 3 && !online)}>
              {step < 3 ? "Tiếp" : busy ? "Đang tạo nhà…" : "Tạo nhà"}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}

// ── Bước 1: mật khẩu chung ────────────────────────────────────────

function HouseholdStep({ f, set, errors, show, toggle }: { f: SetupForm; set: (p: Partial<SetupForm>) => void; errors: Errors; show: boolean; toggle: () => void }) {
  const id = idOf("password");
  return (
    <>
      {/* Để Keychain / trình quản lý mật khẩu nhận ra đây là mật khẩu của "Ví nhà", như màn đăng nhập. */}
      <input class="sr-only" type="text" name="username" autocomplete="username" value="vi-nha" readOnly tabIndex={-1} aria-hidden="true" />
      <Field id={id} label="Mật khẩu chung" error={errors.password} first>
        <div class="flex items-center gap-1" style={{ maxWidth: "64%" }}>
          <input
            id={id}
            class="ctl full"
            type={show ? "text" : "password"}
            autocomplete="current-password"
            value={f.password}
            onInput={(e) => set({ password: e.currentTarget.value })}
            {...invalid(errors, "password", id)}
          />
          <button type="button" class="btn btn-ghost" style={{ padding: "0 10px" }} onClick={toggle} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
            <Icon name={show ? "eye-off" : "eye"} size={18} />
          </button>
        </div>
      </Field>
      <Hint>Mật khẩu chung đã đặt ở ô APP_PASSWORD lúc cài app. Cả nhà vào app bằng mật khẩu này; ai muốn thì đặt thêm mật khẩu riêng ở bước sau.</Hint>
    </>
  );
}

// ── Bước 2: thành viên ────────────────────────────────────────────

/** Hàng đầu của một khối (người, tài khoản): tên khối bên trái, nút Bớt bên phải. */
function BlockHead({ label, first, onRemove, removeLabel }: { label: string; first: boolean; onRemove?: () => void; removeLabel: string }) {
  return (
    <div class="field" style={first ? { borderTop: 0 } : { borderTop: "1px solid var(--line-strong)" }}>
      <span class="k" style={{ color: "var(--fg)", fontWeight: 600 }}>
        {label}
      </span>
      {onRemove && (
        <button type="button" class="btn btn-ghost btn-bad" onClick={onRemove} aria-label={removeLabel}>
          Bớt
        </button>
      )}
    </div>
  );
}

function ListError({ error }: { error?: string }) {
  return error ? (
    <p class="err" role="alert" style={{ margin: 0, padding: "0 14px 8px" }}>
      {error}
    </p>
  ) : null;
}

function MembersStep({
  f,
  setF,
  setMember,
  errors,
}: {
  f: SetupForm;
  setF: (fn: (x: SetupForm) => SetupForm) => void;
  setMember: (i: number, p: Partial<SetupMember>) => void;
  errors: Errors;
}) {
  return (
    <>
      {f.members.map((m, i) => {
        const nameKey = `members.${i}.name`;
        const pwKey = `members.${i}.password`;
        const who = m.name.trim() || `Người ${i + 1}`;
        return (
          <div key={i}>
            <BlockHead
              label={i === 0 ? `Người ${i + 1} · chủ hộ` : `Người ${i + 1}`}
              first={i === 0}
              onRemove={f.members.length > 1 ? () => setF((x) => removeMember(x, i)) : undefined}
              removeLabel={`Bớt ${who}`}
            />
            <Field id={idOf(nameKey)} label="Tên" error={errors[nameKey]}>
              <input
                id={idOf(nameKey)}
                class="ctl"
                value={m.name}
                maxLength={40}
                autocomplete="off"
                placeholder={i === 0 ? "Chồng" : "Vợ"}
                onInput={(e) => setMember(i, { name: e.currentTarget.value })}
                {...invalid(errors, nameKey, idOf(nameKey))}
              />
            </Field>
            <Field id={idOf(pwKey)} label="Mật khẩu riêng" error={errors[pwKey]}>
              <input
                id={idOf(pwKey)}
                class="ctl"
                type="password"
                autocomplete="new-password"
                placeholder="không bắt buộc"
                value={m.password}
                onInput={(e) => setMember(i, { password: e.currentTarget.value })}
                {...invalid(errors, pwKey, idOf(pwKey))}
              />
            </Field>
          </div>
        );
      })}
      <ListError error={errors.members} />
      <div class="pad">
        <button type="button" class="btn" disabled={f.members.length >= MAX_MEMBERS} onClick={() => setF((x) => ({ ...x, members: [...x.members, { name: "", password: "" }] }))}>
          <Icon name="plus" size={16} />
          Thêm người
        </button>
      </div>
      <Hint>
        Tối đa {MAX_MEMBERS} người, ai cũng xem và ghi được. Người đầu tiên là chủ hộ. Để trống mật khẩu riêng thì vào bằng mật khẩu chung; đặt sau ở Cài đặt › Thành viên cũng được.
      </Hint>
    </>
  );
}

// ── Bước 3: tài khoản ─────────────────────────────────────────────

function AccountsStep({
  f,
  setF,
  setAccount,
  errors,
}: {
  f: SetupForm;
  setF: (fn: (x: SetupForm) => SetupForm) => void;
  setAccount: (i: number, p: Partial<SetupAccount>) => void;
  errors: Errors;
}) {
  return (
    <>
      {f.accounts.map((a, i) => {
        const k = (field: string) => `accounts.${i}.${field}`;
        const catalogBank = a.kind === "bank" || a.kind === "credit";
        return (
          <div key={i}>
            <BlockHead
              label={`Tài khoản ${i + 1}`}
              first={i === 0}
              onRemove={f.accounts.length > 1 ? () => setF((x) => removeAccount(x, i)) : undefined}
              removeLabel={`Bớt ${a.name.trim() || `tài khoản ${i + 1}`}`}
            />
            <Field id={idOf(k("name"))} label="Tên" error={errors[k("name")]}>
              <input
                id={idOf(k("name"))}
                class="ctl"
                value={a.name}
                maxLength={60}
                autocomplete="off"
                placeholder={a.kind === "cash" ? "Tiền mặt" : "MB (vợ)"}
                onInput={(e) => setAccount(i, { name: e.currentTarget.value })}
                {...invalid(errors, k("name"), idOf(k("name")))}
              />
            </Field>
            <Field id={idOf(k("kind"))} label="Loại" error={errors[k("kind")]}>
              <select
                id={idOf(k("kind"))}
                class="ctl"
                value={a.kind}
                onChange={(e) => {
                  const kind = e.currentTarget.value as SettingsAccount["kind"];
                  // Ngân hàng/thẻ chọn trong danh mục, ví điện tử gõ tên: đổi qua lại thì bỏ giá trị cũ.
                  setAccount(i, { kind, ...((kind === "ewallet") !== (a.kind === "ewallet") ? { bank: "" } : {}) });
                }}
              >
                {(Object.keys(ACCOUNT_KIND_LABEL) as SettingsAccount["kind"][]).map((kind) => (
                  <option key={kind} value={kind}>
                    {ACCOUNT_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
            </Field>
            {a.kind !== "cash" && (
              <Field id={idOf(k("bank"))} label={a.kind === "ewallet" ? "Nhà cung cấp" : "Ngân hàng"} error={errors[k("bank")]}>
                {catalogBank ? (
                  <select id={idOf(k("bank"))} class="ctl" value={a.bank} onChange={(e) => setAccount(i, { bank: e.currentTarget.value })} {...invalid(errors, k("bank"), idOf(k("bank")))}>
                    <option value="">Chọn ngân hàng</option>
                    <BankOptions />
                  </select>
                ) : (
                  <input
                    id={idOf(k("bank"))}
                    class="ctl"
                    value={a.bank}
                    maxLength={40}
                    placeholder="MoMo"
                    onInput={(e) => setAccount(i, { bank: e.currentTarget.value })}
                    {...invalid(errors, k("bank"), idOf(k("bank")))}
                  />
                )}
              </Field>
            )}
            <Field id={idOf(k("owner"))} label="Của ai" error={errors[k("owner")]}>
              <select
                id={idOf(k("owner"))}
                class="ctl"
                value={a.owner === null ? "" : String(a.owner)}
                onChange={(e) => setAccount(i, { owner: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}
                {...invalid(errors, k("owner"), idOf(k("owner")))}
              >
                <option value="">Chung</option>
                {f.members.map((m, j) => (
                  <option key={j} value={String(j)}>
                    {m.name.trim() || `Người ${j + 1}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id={idOf(k("opening_balance"))}
              label={a.kind === "credit" ? "Đang nợ bao nhiêu?" : "Đang có bao nhiêu?"}
              error={errors[k("opening_balance")]}
            >
              <AmountInput
                id={idOf(k("opening_balance"))}
                value={a.balance ?? 0}
                onChange={(n) => setAccount(i, { balance: n })}
              />
              <span class="sub-line" style={{ display: "block", marginTop: "4px" }}>
                Số gần đúng cũng được, đếm lại sau ở Tài khoản.
              </span>
            </Field>
          </div>
        );
      })}
      <ListError error={errors.accounts} />
      <div class="pad">
        <button type="button" class="btn" onClick={() => setF((x) => ({ ...x, accounts: [...x.accounts, newAccount()] }))}>
          <Icon name="plus" size={16} />
          Thêm tài khoản
        </button>
      </div>
      <Hint>Tài khoản ngân hàng, tiền mặt, MoMo… nhà đang dùng. Số dư, số tài khoản, nối SePay thêm sau ở Cài đặt › Tài khoản.</Hint>
    </>
  );
}

// ── Bước 4: ba ngăn ───────────────────────────────────────────────

/** Giá trị của ô chọn ngăn: "" = ngoài ngăn. */
const pocketValue = (p: Pocket | null) => p ?? "";

function PocketsStep({
  f,
  set,
  setF,
  setAccount,
  errors,
}: {
  f: SetupForm;
  set: (p: Partial<SetupForm>) => void;
  setF: (fn: (x: SetupForm) => SetupForm) => void;
  setAccount: (i: number, p: Partial<SetupAccount>) => void;
  errors: Errors;
}) {
  const setGoal = (i: number, patch: Partial<SetupGoal>) => setF((x) => ({ ...x, goals: x.goals.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));
  const paydayId = idOf("payday_day");
  const pctId = idOf("savings_pct");
  const taxId = idOf("taxable");
  const choices = goalAccountChoices(f);
  return (
    <>
      <div class="set-sub" style={{ borderTop: 0 }}>
        Tài khoản thuộc ngăn nào
      </div>
      {f.accounts.map((a, i) => {
        const key = `accounts.${i}.pocket`;
        return (
          <Field key={i} id={idOf(key)} label={a.name.trim() || `Tài khoản ${i + 1}`} error={errors[key]}>
            <select
              id={idOf(key)}
              class="ctl"
              value={pocketValue(a.pocket)}
              onChange={(e) => setAccount(i, { pocket: (e.currentTarget.value || null) as Pocket | null })}
              {...invalid(errors, key, idOf(key))}
            >
              {SETUP_POCKET_OPTIONS.map((o) => (
                <option key={o.label} value={pocketValue(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        );
      })}
      <Hint>Tiền về tài khoản nào là tiền của ngăn đó. Thẻ tín dụng để ở Vận hành.</Hint>
      <Field id={paydayId} label="Ngày lương" error={errors.payday_day}>
        <input
          id={paydayId}
          class="ctl"
          inputMode="numeric"
          maxLength={2}
          value={f.paydayDay}
          onInput={(e) => set({ paydayDay: e.currentTarget.value })}
          {...invalid(errors, "payday_day", paydayId)}
        />
      </Field>
      <Field id={pctId} label="% Tích luỹ" error={errors.savings_pct}>
        <input
          id={pctId}
          class="ctl"
          inputMode="numeric"
          maxLength={3}
          value={f.savingsPct}
          onInput={(e) => set({ savingsPct: e.currentTarget.value })}
          {...invalid(errors, "savings_pct", pctId)}
        />
      </Field>
      <SavingsSlider pct={savingsStep(f).pct} onPct={(p) => set({ savingsPct: String(p) })} />
      <Hint>Trích mỗi khoản lương: lương về sẽ nhắc “Trích Tích luỹ”. {savingsStep(f).text}</Hint>
      <Field id={taxId} label="Nhà có tự nộp thuế không?" error={errors.taxable} wrap>
        <Seg<"yes" | "no">
          label="Nhà có tự nộp thuế không"
          value={f.taxable ? "yes" : "no"}
          onChange={(v) => set({ taxable: v === "yes" })}
          options={[
            { value: "yes", label: "Có" },
            { value: "no", label: "Không" },
          ]}
        />
      </Field>
      <Hint>Chỉ chọn Có nếu nhà có thu nhập phải tự khai thuế. Đổi được trong Cài đặt.</Hint>
      <div class="set-sub">Nhóm danh mục chi thiết yếu</div>
      {GROUP_OPTIONS.map((o) => (
        <Check
          key={o.value}
          id={idOf(`groups.${o.value}`)}
          label={o.label}
          checked={f.groups.includes(o.value)}
          onChange={(v) => set({ groups: v ? [...f.groups, o.value] : f.groups.filter((x) => x !== o.value) })}
        />
      ))}
      <ListError error={errors.groups} />
      <Hint>Luôn có thêm nhóm Y tế và Mua sắm. Hạn mức từng nhóm đặt sau ở Cài đặt › Ba ngăn.</Hint>
      <div class="set-sub">Mục tiêu Dự phòng (tuỳ chọn)</div>
      {f.goals.map((g, i) => {
        const k = (field: string) => `goals.${i}.${field}`;
        const accountId = idOf(k("account"));
        return (
          <div key={i}>
            <BlockHead label={`Mục tiêu ${i + 1}`} first={false} onRemove={() => setF((x) => ({ ...x, goals: x.goals.filter((_, j) => j !== i) }))} removeLabel={`Bớt ${g.name.trim() || `mục tiêu ${i + 1}`}`} />
            <Field id={idOf(k("name"))} label="Tên" error={errors[k("name")]}>
              <input
                id={idOf(k("name"))}
                class="ctl"
                value={g.name}
                maxLength={60}
                autocomplete="off"
                placeholder="Học phí"
                onInput={(e) => setGoal(i, { name: e.currentTarget.value })}
                {...invalid(errors, k("name"), idOf(k("name")))}
              />
            </Field>
            <Field id={idOf(k("monthly_amount"))} label="Số mỗi tháng" error={errors[k("monthly_amount")]}>
              <AmountInput id={idOf(k("monthly_amount"))} value={g.monthly} invalid={Boolean(errors[k("monthly_amount")])} onChange={(n) => setGoal(i, { monthly: n })} />
            </Field>
            <Field id={idOf(k("repeat_months"))} label="Mấy tháng một lần" error={errors[k("repeat_months")]}>
              <input
                id={idOf(k("repeat_months"))}
                class="ctl"
                inputMode="numeric"
                maxLength={2}
                value={g.repeat}
                onInput={(e) => setGoal(i, { repeat: e.currentTarget.value })}
                {...invalid(errors, k("repeat_months"), idOf(k("repeat_months")))}
              />
            </Field>
            <Field id={accountId} label="Tài khoản của mục tiêu" error={errors[k("account")]}>
              <select
                id={accountId}
                class="ctl"
                value={g.account === null ? "" : String(g.account)}
                onChange={(e) => setGoal(i, { account: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}
                {...invalid(errors, k("account"), accountId)}
              >
                <option value="">Chưa có</option>
                {g.account !== null && !choices.some((c) => c.index === g.account) && (
                  <option value={String(g.account)}>{f.accounts[g.account]?.name.trim() || `Tài khoản ${g.account + 1}`} (không chọn được)</option>
                )}
                {choices.map((c) => (
                  <option key={c.index} value={String(c.index)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        );
      })}
      {f.goals.length > 0 && <Hint>Mỗi mục tiêu gắn một tài khoản ở ngăn Dự phòng, nhiều mục tiêu dùng chung một tài khoản được (đổi thứ tự ưu tiên ở Cài đặt › Ba ngăn); chưa có thì chọn “Chưa có”.</Hint>}
      <ListError error={errors.goals} />
      <div class="pad">
        <button type="button" class="btn" disabled={f.goals.length >= MAX_GOALS} onClick={() => setF((x) => ({ ...x, goals: [...x.goals, newGoal()] }))}>
          <Icon name="plus" size={16} />
          Thêm mục tiêu
        </button>
      </div>
      <div class="note" style={{ borderTop: "1px solid var(--line)" }}>
        {setupSummary(f)}
      </div>
    </>
  );
}
