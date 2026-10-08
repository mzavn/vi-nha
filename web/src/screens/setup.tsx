// Thiết lập nhà lần đầu (UC-510, UC-701 AC-8): DB mới chưa có ai thì màn này thay màn đăng nhập.
// Bốn bước: Mật khẩu chung → Thành viên → Tài khoản → Ví theo mẫu; xong vào thẳng Hôm nay bằng phiên của chủ hộ.
// Kiểm từng bước ở lib/setup.ts (có test); lỗi server có `field` thì mở lại đúng bước, hiện dưới đúng ô.

import { useEffect, useRef, useState } from "preact/hooks";
import { ACCOUNT_KIND_LABEL, type Errors } from "../lib/settings";
import { MAX_MEMBERS } from "../lib/members";
import {
  emptySetup,
  MUST_OPTIONS,
  removeMember,
  SETUP_STEPS,
  setupPayload,
  setupServerError,
  stepErrors,
  stepOfField,
  type SetupAccount,
  type SetupForm,
  type SetupMember,
  type SetupStep,
} from "../lib/setup";
import type { SettingsAccount } from "../lib/types";
import { completeSetup, useApp } from "../state/store";
import { Icon } from "../ui/icons";
import { Seg } from "../ui/parts";
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
        <h1 style={{ fontSize: "24px", fontWeight: 650, letterSpacing: "-0.02em" }}>Ví nhà</h1>
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
        {step === 3 && <TemplateStep f={f} set={set} errors={errors} />}
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
      <Hint>Mật khẩu đã đặt ở ô APP_PASSWORD lúc deploy. Cả nhà vào app bằng mật khẩu này; ai muốn thì đặt thêm mật khẩu riêng ở bước sau.</Hint>
    </>
  );
}

// ── Bước 2: thành viên ────────────────────────────────────────────

/** Hàng đầu của một khối (người, tài khoản): tên khối bên trái, nút Bớt bên phải. */
function BlockHead({ label, first, onRemove, removeLabel }: { label: string; first: boolean; onRemove?: () => void; removeLabel: string }) {
  return (
    <div class="field" style={first ? { borderTop: 0 } : { borderTop: "1px solid var(--border-strong)" }}>
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
        Tối đa {MAX_MEMBERS} người, ai cũng xem và ghi được. Người đầu tiên là chủ hộ. Để trống mật khẩu riêng thì người đó vào bằng mật khẩu chung; đặt sau ở Cài
        đặt › Thành viên cũng được.
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
              onRemove={f.accounts.length > 1 ? () => setF((x) => ({ ...x, accounts: x.accounts.filter((_, j) => j !== i) })) : undefined}
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
          </div>
        );
      })}
      <ListError error={errors.accounts} />
      <div class="pad">
        <button type="button" class="btn" onClick={() => setF((x) => ({ ...x, accounts: [...x.accounts, { name: "", kind: "bank", bank: "", owner: null }] }))}>
          <Icon name="plus" size={16} />
          Thêm tài khoản
        </button>
      </div>
      <Hint>
        Tài khoản ngân hàng, tiền mặt, ví điện tử nhà đang dùng. Các ví mẫu nằm ở tài khoản ngân hàng đầu tiên. Số dư, số tài khoản, nối SePay thêm sau ở Cài đặt ›
        Tài khoản.
      </Hint>
    </>
  );
}

// ── Bước 4: ví theo mẫu ───────────────────────────────────────────

function TemplateStep({ f, set, errors }: { f: SetupForm; set: (p: Partial<SetupForm>) => void; errors: Errors }) {
  const taxId = idOf("template.taxable");
  const chosen = MUST_OPTIONS.filter((o) => f.must.includes(o.value)).map((o) => o.label);
  const wallets = ["Thu nhập", "Tích sản 10%", ...(f.taxable ? ["Thuế 10%"] : []), "Có thì tốt (nhận phần còn lại)", ...chosen];
  return (
    <>
      <Field id={taxId} label="Có thu nhập phải tự nộp thuế?" error={errors["template.taxable"]} wrap first>
        <Seg<"" | "yes" | "no">
          label="Có thu nhập phải tự nộp thuế"
          value={f.taxable === null ? "" : f.taxable ? "yes" : "no"}
          onChange={(v) => set({ taxable: v === "yes" })}
          options={[
            { value: "yes", label: "Có" },
            { value: "no", label: "Không" },
          ]}
        />
      </Field>
      <Hint>Có (kinh doanh, cho thuê nhà, làm tự do…): thêm ví Thuế, giữ 10% mỗi khoản thu. Không: thu nhập đã khấu trừ thuế, như lương.</Hint>
      <div class="set-sub">Ví Must — chi thiết yếu</div>
      {MUST_OPTIONS.map((o) => (
        <Check
          key={o.value}
          id={idOf(`template.must.${o.value}`)}
          label={o.label}
          checked={f.must.includes(o.value)}
          onChange={(v) => set({ must: v ? [...f.must, o.value] : f.must.filter((x) => x !== o.value) })}
        />
      ))}
      <ListError error={errors["template.must"]} />
      <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
        Sẽ tạo: {wallets.join(" · ")}. Mỗi khoản thu chia vào Tích sản{f.taxable ? ", Thuế" : ""} trước, phần còn lại vào Có thì tốt. Số nạp cho ví Must đặt sau ở Cài
        đặt › Ví & số tiền nạp.
      </div>
    </>
  );
}
