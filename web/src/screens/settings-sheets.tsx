// Các sheet sửa của màn Cài đặt. Kiểm tra form và dựng thân yêu cầu nằm ở lib/settings.ts (có test);
// ở đây chỉ vẽ ô nhập, gửi, và hiện lỗi server nguyên văn (server trả câu tiếng Việt).

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { BANKS, bankByCode } from "../../../src/domain/banks";
import { api, errorText } from "../lib/api";
import {
  ACCOUNT_KIND_LABEL,
  accountPayload,
  accountToForm,
  bankHint,
  canSplitWeekly,
  clearSecretPayload,
  configPayload,
  connectionPicker,
  type Errors,
  followsCodeConvention,
  MATCH_LABEL,
  MEANING_LABEL,
  linkCodeLeft,
  memberPayload,
  MODE_LABEL,
  normalizePattern,
  notifyPayload,
  type Result,
  rulePayload,
  ruleToForm,
  secretLabel,
  secretPayload,
  sepayConnectionPayload,
  type SepayConnectionForm,
  sepayOutDefault,
  sepayOutHint,
  spendableDefault,
  streamPayload,
  streamToForm,
  walletPayload,
  walletToForm,
  WEEKDAY_LABEL,
  type AllocForm,
} from "../lib/settings";
import { isIncomeHolding } from "../lib/budget";
import { memberSubmitError, newMemberPayload, passwordPayload, proofMode } from "../lib/members";
import { feePayload, rentalConfigPayload, tenantPayload } from "../lib/rental";
import { openingCreditHint, ROLE_LABEL } from "../lib/wealth-building-accounts";
import type {
  AccountRole,
  IncomeStream,
  NotifySchedule,
  Rental,
  Rule,
  Secret,
  SecretKey,
  SendTestResult,
  SepayConnection,
  SepaySecretKey,
  SettingsAccount,
  SettingsConfig,
  SettingsData,
  SettingsMember,
  SettingsWallet,
  Tenant,
  TenantFee,
  ZaloLinkCode,
} from "../lib/types";
import { signedOut, toast, useApp } from "../state/store";
import { AmountInput } from "../ui/fields";
import { Icon } from "../ui/icons";
import { NeedsNetwork, Seg, Sheet } from "../ui/parts";

type Saved = (toastText: string) => Promise<void>;

/**
 * Gửi một yêu cầu: chặn bấm hai lần, giữ lỗi server để hiện trên nút. `mapError`: lỗi server nào thuộc ô nào
 * (vd trùng tên → ô Tên) — có ô thì hiện dưới ô đó thay vì trên nút.
 */
function useSubmit(onSaved: Saved, onClose: () => void, mapError?: (err: unknown) => { field: string | null; message: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  async function run<T>(result: Result<T>, send: (body: T) => Promise<unknown>, toastText: string) {
    if (!result.ok) {
      setErrors(result.errors);
      setError("Còn ô chưa đúng, xem dòng đỏ.");
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      await send(result.value);
      await onSaved(toastText);
      onClose();
    } catch (err) {
      const mapped = mapError?.(err);
      if (mapped?.field) setErrors({ [mapped.field]: mapped.message });
      else setError(mapped?.message ?? errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, errors, run };
}

/** Một hàng field: nhãn trái, ô phải, lỗi ngay dưới hàng. Dùng chung với màn Thiết lập. */
export function Field(props: { id: string; label: string; error?: string; wrap?: boolean; first?: boolean; children: ComponentChildren }) {
  const style = { ...(props.wrap ? { flexWrap: "wrap" as const } : {}), ...(props.first ? { borderTop: 0 } : {}) };
  return (
    <>
      <div class="field" style={style}>
        <label for={props.id}>{props.label}</label>
        {props.children}
      </div>
      {props.error && (
        <p class="err ferr" id={`${props.id}-err`}>
          {props.error}
        </p>
      )}
    </>
  );
}

export function Hint({ children }: { children: ComponentChildren }) {
  return <p class="fhint">{children}</p>;
}

export function Check(props: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; error?: string; disabled?: boolean }) {
  return (
    <>
      <div class="field">
        <label class="check" for={props.id} style={{ color: props.disabled ? "var(--fg-2)" : "var(--fg)" }}>
          <input id={props.id} type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.currentTarget.checked)} />
          {props.label}
        </label>
      </div>
      {props.error && <p class="err ferr">{props.error}</p>}
    </>
  );
}

function Footer(props: { busy: boolean; error: string | null; label: string; onSubmit: () => void; children?: ComponentChildren }) {
  const { online } = useApp();
  return (
    <div class="pad">
      {props.error && (
        <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
          {props.error}
        </p>
      )}
      <button type="button" class="btn btn-primary btn-wide" disabled={!online || props.busy} onClick={props.onSubmit}>
        {props.busy ? "Đang lưu…" : props.label}
      </button>
      {props.children}
      {!online && <NeedsNetwork what="Lưu cài đặt" />}
    </div>
  );
}

/** aria cho ô bị lỗi; `id` là id của ô, lỗi nằm ở `${id}-err` (xem Field). */
export const invalid = (errors: Errors, key: string, id: string) => (errors[key] ? { "aria-invalid": "true" as const, "aria-describedby": `${id}-err` } : {});

/** Danh mục ngân hàng cho ô chọn: nhóm có SePay trước, ghi tay sau. */
export function BankOptions() {
  return (
    <>
      <optgroup label="Có SePay">
        {BANKS.filter((b) => b.sepay).map((b) => (
          <option key={b.code} value={b.code}>
            {b.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Ghi tay">
        {BANKS.filter((b) => !b.sepay).map((b) => (
          <option key={b.code} value={b.code}>
            {b.name}
          </option>
        ))}
      </optgroup>
    </>
  );
}

// ── Tài khoản ─────────────────────────────────────────────────────

/** Lời dặn theo vai trò Tích sản của tài khoản (ADR-88). */
const ROLE_HINT: Record<AccountRole, string> = {
  piggy_bank: "Heo đất: tài khoản khóa; tiền bỏ heo từ tài khoản thường là Tích sản.",
  buffer: "Phao dự phòng: tiền chuyển vào từ tài khoản thường là Tích sản — ví Có thì tốt chuyển sang Tích sản, như bỏ heo đất. Rút về tài khoản thường chỉ đổi chỗ, tiền vẫn thuộc Tích sản.",
  term_deposit:
    "Sổ tiết kiệm (khóa): để số dư đầu 0, rồi ghi Chuyển nội bộ từ phao sang sổ đúng số gửi — tiền gửi là Tích sản. Tất toán: chuyển sổ về tài khoản nhận, phần lãi ghi Thu nhập; xong thì tắt Đang dùng.",
};
type RoleChoice = "" | "buffer" | "term_deposit";

export function AccountSheet({ d, item, onClose, onSaved }: { d: SettingsData; item: SettingsAccount | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState(() => accountToForm(item));
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;
  const e = (k: string) => ({ id: `a-${k}`, error: errors[k] });
  // Heo đất và sổ tiết kiệm giữ vai trò từ lúc tạo; sổ tiết kiệm chỉ chọn được khi thêm (ADR-88).
  const fixedRole = item?.locked ? item.role : null;
  const saving = f.role === "term_deposit";
  const locked = Boolean(item?.locked) || saving;
  // Thành tài khoản Tích sản không tính mà đang có tiền: số dư đó vào Tích sản một lần khi lưu (ADR-91).
  const creditHint = openingCreditHint({
    wasRole: Boolean(item?.role),
    role: f.role,
    spendable: f.spendable && !locked,
    balance: isNew ? f.opening_balance : (item.book_balance ?? 0) + f.opening_balance - item.opening_balance,
  });
  const roleOptions: { value: RoleChoice; label: string }[] = [
    { value: "", label: "Không" },
    { value: "buffer", label: ROLE_LABEL.buffer },
    ...(isNew ? [{ value: "term_deposit" as const, label: ROLE_LABEL.term_deposit }] : []),
  ];

  function submit() {
    const name = f.name.trim();
    const tail = !f.sepay_enabled
      ? ""
      : f.sepay_out
        ? " Tiền vào và tiền ra của tài khoản này giờ tự về từ ngân hàng."
        : " Tiền vào tài khoản này giờ tự về từ ngân hàng; khoản chi từ nó vẫn nhập tay.";
    void run(
      // Chỉ gửi kết nối khi có ô "Nối qua"; một kết nối thì server tự dùng nó.
      accountPayload({ ...f, sepay_connection_id: picker?.value ?? "" }, item),
      (body) => (isNew ? api.post("/v1/settings/accounts", body) : api.patch(`/v1/settings/accounts/${encodeURIComponent(item.id)}`, body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} tài khoản ${name}.${tail}`,
    );
  }
  const catalogBank = f.kind === "bank" || f.kind === "credit";
  const bank = bankByCode(f.bank);
  // SePay chỉ bật được cho ngân hàng SePay hỗ trợ; đang bật sẵn (tài khoản cũ) thì vẫn tắt được.
  const sepayLocked = !bank?.sepay && !f.sepay_enabled;
  const pickBank = (code: string) => set({ bank: code, ...(f.sepay_enabled ? { sepay_out: sepayOutDefault(code) } : {}) });
  const picker = f.kind === "bank" ? connectionPicker(d.integrations.sepay_connections ?? [], f.sepay_connection_id, item?.sepay_connection_id ?? "") : null;

  return (
    <Sheet open title={isNew ? "Thêm tài khoản" : `Sửa ${item.name}`} onClose={onClose}>
      <Field {...e("name")} label="Tên" first>
        <input id="a-name" class="ctl" value={f.name} maxLength={60} placeholder="MB (vợ)" onInput={(ev) => set({ name: ev.currentTarget.value })} {...invalid(errors, "name", "a-name")} />
      </Field>
      <Field id="a-kind" label="Loại" wrap>
        <Seg
          label="Loại tài khoản"
          value={f.kind}
          onChange={(kind) =>
            set({
              kind,
              ...(kind !== "bank" ? { sepay_enabled: false, sepay_out: false } : {}),
              // Thêm mới: thẻ tín dụng và tài khoản Tích sản mặc định không tính vào tiền chi được (ADR-85, ADR-88).
              ...(isNew ? { spendable: spendableDefault(kind, f.role) } : {}),
              // Ngân hàng/thẻ chọn trong danh mục, ví điện tử gõ tên: đổi qua lại thì bỏ giá trị cũ.
              ...((kind === "ewallet") !== (f.kind === "ewallet") ? { bank: "" } : {}),
            })
          }
          options={(Object.keys(ACCOUNT_KIND_LABEL) as SettingsAccount["kind"][]).map((k) => ({ value: k, label: ACCOUNT_KIND_LABEL[k] }))}
        />
      </Field>
      {fixedRole ? (
        <Field id="a-role" label="Giữ tiền Tích sản">
          <span id="a-role">{ROLE_LABEL[fixedRole]}</span>
        </Field>
      ) : (
        <Field id="a-role" label="Giữ tiền Tích sản" wrap>
          <Seg
            label="Giữ tiền Tích sản"
            value={f.role ?? ""}
            onChange={(choice) => {
              const role = choice || null;
              set({
                role,
                // Thêm mới, hoặc đổi sang phao: phao / sổ không tính vào tiền chi được (tiền để dành), về thường thì theo loại.
                ...(isNew || role === "buffer" ? { spendable: spendableDefault(f.kind, role) } : {}),
                ...(role === "term_deposit" ? { sepay_enabled: false, sepay_out: false } : {}),
              });
            }}
            options={roleOptions}
          />
        </Field>
      )}
      {f.role && <Hint>{ROLE_HINT[f.role]}</Hint>}
      {f.kind !== "cash" && (
        <>
          <Field {...e("bank")} label={f.kind === "ewallet" ? "Nhà cung cấp" : "Ngân hàng"}>
            {catalogBank ? (
              <select id="a-bank" class="ctl" value={f.bank} onChange={(ev) => pickBank(ev.currentTarget.value)}>
                <option value="">Chọn ngân hàng</option>
                {f.bank && !bank && <option value={f.bank}>{f.bank} (tên cũ — chọn lại)</option>}
                <BankOptions />
              </select>
            ) : (
              <input id="a-bank" class="ctl" value={f.bank} maxLength={40} placeholder="MoMo" onInput={(ev) => set({ bank: ev.currentTarget.value })} />
            )}
          </Field>
          {catalogBank && bankHint(f.bank) && <Hint>{bankHint(f.bank)}</Hint>}
          <Field {...e("account_no")} label="Số tài khoản">
            <input
              id="a-account_no"
              class="ctl num"
              inputMode="numeric"
              autocomplete="off"
              value={f.account_no}
              maxLength={30}
              onInput={(ev) => set({ account_no: ev.currentTarget.value })}
              {...invalid(errors, "account_no", "a-account_no")}
            />
          </Field>
        </>
      )}
      {f.kind === "bank" && !saving && (
        <>
          <Check
            id="a-sepay"
            label="Nối SePay"
            checked={f.sepay_enabled}
            disabled={sepayLocked}
            onChange={(v) => set({ sepay_enabled: v, sepay_out: v && sepayOutDefault(f.bank) })}
            error={errors.sepay_enabled}
          />
          <Hint>
            Chiều tiền SePay báo về thì không nhập tay được — nhập thêm là đếm một khoản hai lần. Tiền vào luôn tự về; tiền ra chỉ tự về khi bật “SePay báo cả tiền ra”.
          </Hint>
          {f.sepay_enabled && (
            <>
              {picker && (
                <Field id="a-sepay-conn" label="Nối qua">
                  <select id="a-sepay-conn" class="ctl" value={picker.value} onChange={(ev) => set({ sepay_connection_id: ev.currentTarget.value })}>
                    {picker.options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.active ? c.name : `${c.name} (đã tắt)`}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Check id="a-sepay-out" label="SePay báo cả tiền ra" checked={f.sepay_out} onChange={(v) => set({ sepay_out: v })} />
              <Hint>{sepayOutHint(f.bank)}</Hint>
              <Field {...e("sub_account")} label="Tài khoản ảo (VA)">
                <input
                  id="a-sub_account"
                  class="ctl num"
                  autocomplete="off"
                  value={f.sub_account}
                  maxLength={30}
                  placeholder={bank?.sepay?.vaRequired ? "số VA trên SePay" : "không bắt buộc"}
                  onInput={(ev) => set({ sub_account: ev.currentTarget.value })}
                />
              </Field>
            </>
          )}
        </>
      )}
      <Field id="a-owner" label="Chủ tài khoản">
        <select id="a-owner" class="ctl" value={f.owner_member_id} onChange={(ev) => set({ owner_member_id: ev.currentTarget.value })}>
          <option value="">Chung</option>
          {d.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="a-opening" label="Số dư đầu">
        <AmountInput id="a-opening" value={f.opening_balance} onChange={(n) => set({ opening_balance: n })} />
      </Field>
      <Field id="a-opened" label={saving ? "Ngày gửi" : "Số dư đầu tính tới ngày"}>
        <input id="a-opened" class="ctl" type="date" value={f.opened_at} onInput={(ev) => set({ opened_at: ev.currentTarget.value })} />
      </Field>
      <Hint>{saving ? "Chuyển nội bộ vào sổ ghi từ ngày gửi trở đi." : "Giao dịch ngân hàng trước ngày này đã nằm trong số dư đầu, app bỏ qua."}</Hint>
      <Check id="a-spendable" label="Tính vào tiền chi được" checked={f.spendable && !locked} disabled={locked} onChange={(v) => set({ spendable: v })} />
      <Hint>
        {locked
          ? "Heo đất và sổ tiết kiệm đã khóa — không bao giờ tính vào tiền chi được."
          : "Số dư của tài khoản này cộng vào “Tiền chi được” ở Hôm nay. Tài khoản đang giữ tiền Tích sản / Thuế cứ để bật — app đã trừ phần Tích sản và Thuế; tài khoản để dành tiền Tích sản thì chọn Phao dự phòng ở trên. Tắt cho tiền không định tiêu và không thuộc ví nào (tiết kiệm ngoài app, thẻ tín dụng)."}
      </Hint>
      {creditHint && <Hint>{creditHint}</Hint>}
      {!isNew && <Check id="a-active" label="Đang dùng" checked={f.active} onChange={(v) => set({ active: v })} />}
      {!isNew && !f.active && <Hint>Ngừng dùng thì tài khoản không còn hiện ở chỗ chọn; lịch sử vẫn giữ nguyên.</Hint>}
      <Footer busy={busy} error={error} label={isNew ? "Thêm tài khoản" : "Lưu tài khoản"} onSubmit={submit} />
    </Sheet>
  );
}

// ── Ví ─────────────────────────────────────────────────────────────

const TIER_OPTIONS: { value: SettingsWallet["tier"]; label: string }[] = [
  { value: "wealth_building", label: "Tích sản" },
  { value: "tax", label: "Thuế" },
  { value: "nice", label: "Hưởng thụ" },
  { value: "must", label: "Vận hành" },
];
const KIND_OPTIONS: { value: SettingsWallet["kind"]; label: string }[] = [
  { value: "envelope", label: "Phong bì (tiêu theo kỳ)" },
  { value: "accrual", label: "Tích dồn (để dành cho một khoản)" },
  { value: "bill", label: "Hoá đơn (trả định kỳ)" },
];

export function WalletSheet({ d, item, onClose, onSaved }: { d: SettingsData; item: SettingsWallet | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState(() => walletToForm(item));
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const setA = (patch: Partial<AllocForm>) => setF((x) => ({ ...x, alloc: { ...x.alloc, ...patch } }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;
  const scope = item ? item.scope : f.scope;
  const remainder = item?.allocation?.mode === "remainder";
  const e = (k: string) => ({ id: `w-${k}`, error: errors[k] });

  function submit() {
    void run(
      walletPayload(f, item),
      (body) => (isNew ? api.post("/v1/settings/wallets", body) : api.patch(`/v1/settings/wallets/${encodeURIComponent(item.id)}`, body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} ví ${f.name.trim()}. Số nạp áp dụng từ lần chia tiền tới.`,
    );
  }

  const modes = (["flat", "percent", "goal", "lump"] as const).map((m) => ({ value: m, label: MODE_LABEL[m] }));
  const a = f.alloc;
  return (
    <Sheet open title={isNew ? "Thêm ví" : `Sửa ví ${item.name}`} onClose={onClose}>
      <Field {...e("name")} label="Tên ví" first>
        <input id="w-name" class="ctl" value={f.name} maxLength={40} placeholder="Học phí" onInput={(ev) => set({ name: ev.currentTarget.value })} {...invalid(errors, "name", "w-name")} />
      </Field>
      {isNew && (
        <>
          <Field id="w-tier" label="Tầng">
            <select id="w-tier" class="ctl" value={f.tier} onChange={(ev) => set({ tier: ev.currentTarget.value as SettingsWallet["tier"] })}>
              {TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {f.tier === "must" && (
            <Field id="w-group" label="Nhóm" wrap>
              <Seg
                label="Nhóm trong Vận hành"
                value={f.must_group}
                onChange={(must_group) => set({ must_group })}
                options={[
                  { value: "must", label: "Must" },
                  { value: "have", label: "Có thì tốt" },
                ]}
              />
            </Field>
          )}
          <Field id="w-kind" label="Kiểu ví">
            <select id="w-kind" class="ctl" value={f.kind} onChange={(ev) => set({ kind: ev.currentTarget.value as SettingsWallet["kind"] })}>
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id="w-scope" label="Của ai" wrap>
            <Seg
              label="Ví chung hay riêng"
              value={f.scope}
              onChange={(s) => set({ scope: s })}
              options={[
                { value: "shared", label: "Chung" },
                { value: "personal", label: "Riêng một người" },
              ]}
            />
          </Field>
        </>
      )}
      {scope === "personal" && (
        <>
          <Field {...e("member_id")} label="Người dùng">
            <select id="w-member_id" class="ctl" value={f.member_id} onChange={(ev) => set({ member_id: ev.currentTarget.value })} {...invalid(errors, "member_id", "w-member_id")}>
              <option value="">Chọn người</option>
              {d.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Check id="w-private" label="Ẩn số của ví này với người kia" checked={f.private} onChange={(v) => set({ private: v })} />
        </>
      )}
      <Field id="w-account" label="Nằm ở tài khoản">
        <select id="w-account" class="ctl" value={f.account_id} onChange={(ev) => set({ account_id: ev.currentTarget.value })}>
          <option value="">Chưa gán</option>
          {d.accounts
            .filter((x) => x.active || x.id === f.account_id)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      </Field>
      {!isNew && <Check id="w-active" label="Đang dùng" checked={f.active} onChange={(v) => set({ active: v })} />}

      <div class="set-sub">Số tiền nạp</div>
      {remainder ? (
        <>
          <div class="field" style={{ borderTop: 0 }}>
            <span class="k">Cách nạp</span>
            <span>nhận phần còn lại</span>
          </div>
          <Hint>Ví này là cuối dòng thác: nhận hết phần còn lại sau khi các ví khác đã đủ. Cách nạp của nó không đổi được.</Hint>
        </>
      ) : (
        <>
          <Field {...e("mode")} label="Cách nạp" first>
            <select id="w-mode" class="ctl" value={a.mode} onChange={(ev) => setA({ mode: ev.currentTarget.value as AllocForm["mode"] })}>
              {!item?.allocation && <option value="none">Không nạp tự động</option>}
              {modes.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {a.mode === "flat" && (
            <>
              <Field id="w-period" label="Mỗi" wrap>
                <Seg
                  label="Kỳ nạp"
                  value={a.period}
                  onChange={(period) => setA({ period })}
                  options={[
                    { value: "week", label: "Tuần" },
                    { value: "month", label: "Tháng" },
                  ]}
                />
              </Field>
              <Field {...e("amount")} label={a.period === "week" ? "Số mỗi tuần" : "Số mỗi tháng"}>
                <AmountInput id="w-amount" value={a.amount} onChange={(n) => setA({ amount: n })} invalid={!!errors.amount} />
              </Field>
            </>
          )}
          {a.mode === "lump" && (
            <Field {...e("amount")} label="Số mỗi tháng">
              <AmountInput id="w-amount" value={a.amount} onChange={(n) => setA({ amount: n })} invalid={!!errors.amount} />
            </Field>
          )}
          {(a.mode === "flat" || a.mode === "lump") && (
            <>
              <Field {...e("floor_amount")} label="Sàn cứng">
                <AmountInput id="w-floor_amount" value={a.floor_amount} onChange={(n) => setA({ floor_amount: n })} invalid={!!errors.floor_amount} />
              </Field>
              <Hint>Thiếu tiền thì ví bị bóp, nhưng không xuống dưới sàn. Để 0 là không có sàn.</Hint>
            </>
          )}
          {a.mode === "percent" && (
            <>
              <Field {...e("percent")} label="Phần trăm khoản thu">
                <span class="flex items-center gap-2" style={{ maxWidth: "64%" }}>
                  <input
                    id="w-percent"
                    class="ctl money"
                    style={{ maxWidth: "none", width: "100%" }}
                    inputMode="decimal"
                    autocomplete="off"
                    value={a.percent}
                    placeholder="30"
                    onInput={(ev) => setA({ percent: ev.currentTarget.value })}
                    {...invalid(errors, "percent", "w-percent")}
                  />
                  %
                </span>
              </Field>
              <Hint>Cắt thẳng từ mỗi khoản thu trước mọi ví khác. Tích sản và Thuế dùng cách này.</Hint>
            </>
          )}
          {a.mode === "goal" && (
            <>
              <Field {...e("target_amount")} label="Số cần có">
                <AmountInput id="w-target_amount" value={a.target_amount} onChange={(n) => setA({ target_amount: n })} invalid={!!errors.target_amount} />
              </Field>
              <Field {...e("target_date")} label="Trước ngày">
                <input id="w-target_date" class="ctl" type="date" value={a.target_date} onInput={(ev) => setA({ target_date: ev.currentTarget.value })} {...invalid(errors, "target_date", "w-target_date")} />
              </Field>
              <Hint>Mỗi tháng nạp phần còn thiếu chia đều cho số tháng còn lại tới hạn.</Hint>
            </>
          )}
          {a.mode !== "none" && (
            <>
              <Field {...e("priority")} label="Ưu tiên">
                <input
                  id="w-priority"
                  class="ctl money"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autocomplete="off"
                  value={a.priority}
                  onInput={(ev) => setA({ priority: ev.currentTarget.value })}
                  {...invalid(errors, "priority", "w-priority")}
                />
              </Field>
              <Hint>Số nhỏ được rót trước. Hai ví cùng số thì thiếu tiền chia đều, không ví nào nhận 0.</Hint>
            </>
          )}
          {canSplitWeekly(item ? item.kind : f.kind, a) && (
            <>
              <Check id="w-split" label="Chia đều theo tuần" checked={f.split_weekly} onChange={(v) => set({ split_weekly: v })} />
              <Hint>Mỗi tuần được tiêu số tháng chia cho số thứ Hai của tháng; "còn để chi tuần này" tính theo phần đó.</Hint>
            </>
          )}
        </>
      )}
      <Footer busy={busy} error={error} label={isNew ? "Thêm ví" : "Lưu ví"} onSubmit={submit} />
    </Sheet>
  );
}

// ── Mã chuyển khoản ───────────────────────────────────────────────

export function RuleSheet({ d, item, onClose, onSaved }: { d: SettingsData; item: Rule | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState(() => ruleToForm(item));
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;
  const pattern = normalizePattern(f.match_type, f.pattern);
  const e = (k: string) => ({ id: `r-${k}`, error: errors[k] });

  function submit() {
    const wallet = d.wallets.find((w) => w.id === f.wallet_id)?.name;
    void run(
      rulePayload(f, isNew),
      (body) => (isNew ? api.post("/v1/rules", body) : api.patch(`/v1/settings/rules/${item.id}`, body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} ${MATCH_LABEL[f.match_type].toLowerCase()} ${pattern}.${f.active && wallet ? ` Giao dịch mới khớp sẽ tự vào ${wallet}.` : ""}`,
    );
  }

  return (
    <Sheet open title={isNew ? "Thêm mã chuyển khoản" : `Sửa ${pattern}`} onClose={onClose}>
      <Seg
        class="pad"
        label="Khớp theo"
        value={f.match_type}
        onChange={(match_type) => set({ match_type })}
        options={(Object.keys(MATCH_LABEL) as Rule["match_type"][]).map((k) => ({ value: k, label: MATCH_LABEL[k] }))}
      />
      <Field {...e("pattern")} label={MATCH_LABEL[f.match_type]}>
        <input
          id="r-pattern"
          class="ctl num"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck={false}
          maxLength={40}
          placeholder={f.match_type === "code" ? "EXE" : f.match_type === "content" ? "SHOPEE" : "0888123456"}
          value={f.pattern}
          onInput={(ev) => set({ pattern: f.match_type === "code" ? ev.currentTarget.value.toUpperCase() : ev.currentTarget.value })}
          {...invalid(errors, "pattern", "r-pattern")}
        />
      </Field>
      {f.match_type === "code" && pattern && !errors.pattern && !followsCodeConvention(pattern) && <Hint>Mã nhà đang dùng có dạng Exx hoặc Qxx (ba ký tự). Mã khác vẫn lưu được.</Hint>}
      {f.match_type === "content" && <Hint>So với nội dung chuyển khoản đã bỏ dấu, viết hoa: "đổ xăng" khớp mẫu XANG.</Hint>}
      {f.match_type === "account" && <Hint>Số tài khoản bên kia của giao dịch.</Hint>}
      <Field id="r-meaning" label="Nghĩa" wrap>
        <Seg
          label="Nghĩa của giao dịch"
          value={f.meaning}
          onChange={(meaning) => set({ meaning })}
          options={(Object.keys(MEANING_LABEL) as Rule["meaning"][]).map((k) => ({ value: k, label: MEANING_LABEL[k] }))}
        />
      </Field>
      {f.meaning === "income" && <Hint>Khoản khớp mẫu lương từ ngưỡng tự chia trở lên thì tự ghi và tự chia.</Hint>}
      {f.meaning === "income" && !isNew && (
        <>
          <Field id="r-stream" label="Nguồn thu">
            <select id="r-stream" class="ctl" value={f.income_stream_id} onChange={(ev) => set({ income_stream_id: ev.currentTarget.value })}>
              <option value="">Mặc định (luật % chung)</option>
              {(d.incomeStreams ?? [])
                .filter((s) => s.active || s.id === f.income_stream_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </Field>
          <Hint>Khoản thu khớp mã này chia theo phần khóa của nguồn đã chọn.</Hint>
        </>
      )}
      {f.meaning === "spend" && (
        <Field {...e("category_id")} label="Danh mục">
          <select
            id="r-category_id"
            class="ctl"
            value={f.category_id}
            onChange={(ev) => {
              const id = ev.currentTarget.value;
              const def = d.categories.find((c) => c.id === id)?.defaultWalletId;
              set({ category_id: id, ...(!f.wallet_id && def ? { wallet_id: def } : {}) });
            }}
            {...invalid(errors, "category_id", "r-category_id")}
          >
            <option value="">Chọn danh mục</option>
            {d.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field {...e("wallet_id")} label={f.meaning === "income" ? "Ví nhận" : "Ví"}>
        <select id="r-wallet_id" class="ctl" value={f.wallet_id} onChange={(ev) => set({ wallet_id: ev.currentTarget.value })} {...invalid(errors, "wallet_id", "r-wallet_id")}>
          <option value="">{f.meaning === "spend" ? "Chọn ví" : "Không chỉ định"}</option>
          {d.wallets
            .filter((w) => w.active || w.id === f.wallet_id)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
        </select>
      </Field>
      {!isNew && (
        <Field id="r-by" label="Người chi">
          <select id="r-by" class="ctl" value={f.by_member_id} onChange={(ev) => set({ by_member_id: ev.currentTarget.value })}>
            <option value="">Không rõ</option>
            {d.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field {...e("priority")} label="Ưu tiên">
        <input id="r-priority" class="ctl money" inputMode="numeric" pattern="[0-9]*" autocomplete="off" value={f.priority} onInput={(ev) => set({ priority: ev.currentTarget.value })} {...invalid(errors, "priority", "r-priority")} />
      </Field>
      <Hint>Nhiều mẫu cùng khớp thì mẫu có số ưu tiên nhỏ hơn thắng.</Hint>
      {!isNew && <Check id="r-active" label="Đang dùng" checked={f.active} onChange={(v) => set({ active: v })} />}
      {!isNew && !f.active && <Hint>Ngừng dùng thì giao dịch mới không còn tự gán theo mẫu này; giao dịch cũ giữ nguyên.</Hint>}
      <Footer busy={busy} error={error} label={isNew ? "Thêm mã" : "Lưu mã"} onSubmit={submit} />
    </Sheet>
  );
}

// ── Thành viên ────────────────────────────────────────────────────

export function MemberSheet({
  item,
  self,
  zaloReady,
  onPassword,
  onClose,
  onSaved,
}: {
  item: SettingsMember;
  /** Người này là người đang dùng máy. */
  self: boolean;
  zaloReady: boolean;
  onPassword: () => void;
  onClose: () => void;
  onSaved: Saved;
}) {
  const [f, setF] = useState({ name: item.name, tg_chat_id: item.tg_chat_id ?? "" });
  const { busy, error, errors, run } = useSubmit(onSaved, onClose, memberSubmitError);

  function submit() {
    const r = memberPayload(f, item);
    if (r.ok && Object.keys(r.value).length === 0) return onClose();
    void run(r, (body) => api.patch(`/v1/settings/members/${encodeURIComponent(item.id)}`, body), `Đã lưu ${f.name.trim()}.`);
  }

  return (
    <Sheet open title={`Sửa ${item.name}`} onClose={onClose}>
      <Field id="m-name" label="Tên" error={errors.name} first>
        <input id="m-name" class="ctl" value={f.name} maxLength={40} onInput={(ev) => setF({ ...f, name: ev.currentTarget.value })} {...invalid(errors, "name", "m-name")} />
      </Field>
      <Field id="m-tg_chat_id" label="Telegram chat_id" error={errors.tg_chat_id}>
        <input
          id="m-tg_chat_id"
          class="ctl num"
          inputMode="text"
          autocomplete="off"
          spellcheck={false}
          placeholder="123456789"
          value={f.tg_chat_id}
          onInput={(ev) => setF({ ...f, tg_chat_id: ev.currentTarget.value })}
          {...invalid(errors, "tg_chat_id", "m-tg_chat_id")}
        />
      </Field>
      <Hint>Nhắn một tin bất kỳ cho bot của nhà, rồi nhắn @userinfobot để lấy chat_id. Để trống là không nhận tin nhắc.</Hint>
      <ZaloLink member={item} ready={zaloReady} onClose={onClose} onSaved={onSaved} />
      <div class="set-sub">Mật khẩu</div>
      <div class="field">
        <span class="k">{item.has_password ? "Đang dùng mật khẩu riêng" : "Đang dùng mật khẩu chung"}</span>
        <button type="button" class="btn" onClick={onPassword}>
          {item.has_password ? "Đổi / gỡ" : "Đặt mật khẩu riêng"}
        </button>
      </div>
      <MemberActive member={item} self={self} onClose={onClose} onSaved={onSaved} />
      <Footer busy={busy} error={error} label="Lưu" onSubmit={submit} />
    </Sheet>
  );
}

/**
 * Tắt / bật lại một người (UC-507 AC-12): hỏi lại một lần trước khi làm. Tắt chính mình thì máy này về màn đăng nhập
 * (server đã xoá phiên). Chủ hộ không tắt được.
 */
function MemberActive({ member, self, onClose, onSaved }: { member: SettingsMember; self: boolean; onClose: () => void; onSaved: Saved }) {
  const { online } = useApp();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const turningOff = member.active;
  if (turningOff && member.role === "owner") {
    return (
      <>
        <div class="set-sub">Đang dùng</div>
        <Hint>{member.name} là chủ hộ, luôn đang dùng — không tắt được.</Hint>
      </>
    );
  }

  async function toggle() {
    if (!confirm) return setConfirm(true);
    setBusy(true);
    setMsg(null);
    try {
      await api.patch(`/v1/settings/members/${encodeURIComponent(member.id)}`, { active: !turningOff });
      if (turningOff && self) {
        onClose();
        toast(`Đã tắt ${member.name}. Máy này đã đăng xuất.`);
        await signedOut();
        return;
      }
      await onSaved(turningOff ? `Đã tắt ${member.name}. Mọi máy của ${member.name} đã đăng xuất.` : `Đã bật lại ${member.name}.`);
      onClose();
    } catch (err) {
      setMsg(memberSubmitError(err).message);
      setBusy(false);
    }
  }

  const warning = turningOff
    ? `Tắt thì ${member.name} không vào app được nữa, mọi máy của ${member.name} đăng xuất ngay${self ? ", cả máy này" : ""}. Ví, tài khoản, giao dịch giữ nguyên; ví riêng tư của ${member.name} hiện cho cả nhà thấy. Bật lại được bất cứ lúc nào.`
    : `Bật lại thì ${member.name} vào app được như trước; ví riêng tư của ${member.name} lại ẩn với người khác. Nhà có tối đa 6 người đang dùng.`;
  return (
    <>
      <div class="set-sub">Đang dùng</div>
      {confirm && (
        <p class="fhint" role="alert" style={{ paddingTop: "10px" }}>
          {warning}
        </p>
      )}
      <div class="pad zalo-actions">
        <button type="button" class={turningOff ? "btn btn-bad" : "btn"} disabled={!online || busy} onClick={() => void toggle()}>
          {busy ? "Đang lưu…" : confirm ? (turningOff ? `Tắt hẳn ${member.name}` : `Bật lại ${member.name}`) : turningOff ? "Tắt" : "Bật lại"}
        </button>
        {confirm && !busy && (
          <button type="button" class="btn btn-ghost" onClick={() => setConfirm(false)}>
            Thôi
          </button>
        )}
      </div>
      {msg && (
        <p class="fhint err" role="alert">
          {msg}
        </p>
      )}
    </>
  );
}

/** Thêm người (UC-507 AC-11): tên, mật khẩu riêng tuỳ chọn. Trùng tên / quá 6 người: server báo, hiện đúng chỗ. */
export function MemberNewSheet({ members, onClose, onSaved }: { members: SettingsMember[]; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState({ name: "", password: "" });
  const { busy, error, errors, run } = useSubmit(onSaved, onClose, memberSubmitError);
  const name = f.name.trim();

  function submit() {
    void run(
      newMemberPayload(f, members),
      (body) => api.post("/v1/settings/members", body),
      f.password ? `Đã thêm ${name}. ${name} vào bằng mật khẩu riêng vừa đặt.` : `Đã thêm ${name}. ${name} vào bằng mật khẩu chung của nhà.`,
    );
  }

  return (
    <Sheet open title="Thêm người" onClose={onClose}>
      <Field id="mn-name" label="Tên" error={errors.name} first>
        <input id="mn-name" class="ctl" value={f.name} maxLength={40} autocomplete="off" onInput={(ev) => setF({ ...f, name: ev.currentTarget.value })} {...invalid(errors, "name", "mn-name")} />
      </Field>
      <Field id="mn-password" label="Mật khẩu riêng" error={errors.password}>
        <input
          id="mn-password"
          class="ctl"
          type="password"
          autocomplete="new-password"
          placeholder="không bắt buộc"
          value={f.password}
          onInput={(ev) => setF({ ...f, password: ev.currentTarget.value })}
          {...invalid(errors, "password", "mn-password")}
        />
      </Field>
      <Hint>
        Để trống thì người mới vào bằng mật khẩu chung của nhà. Đặt mật khẩu riêng (ít nhất 8 ký tự) thì chỉ vào được bằng mật khẩu đó. Tối đa 6 người đang dùng; ai
        cũng xem và ghi được như nhau.
      </Hint>
      <Footer busy={busy} error={error} label="Thêm" onSubmit={submit} />
    </Sheet>
  );
}

/**
 * Đặt / đổi / gỡ mật khẩu riêng (UC-507 AC-13). Của mình: hỏi mật khẩu đang dùng (quên thì dùng mật khẩu chung);
 * của người khác: hỏi mật khẩu chung. Xong thì mọi máy của người đó phải vào lại; máy này nếu là mình thì server cấp phiên mới.
 */
export function MemberPasswordSheet({ item, self, onClose, onSaved }: { item: SettingsMember; self: boolean; onClose: () => void; onSaved: Saved }) {
  const has = Boolean(item.has_password);
  const [f, setF] = useState({ proof: "", password: "", remove: false, useHousehold: false });
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose, memberSubmitError);
  const mode = proofMode({ self, hasPassword: has, useHousehold: f.useHousehold });
  const doneText = f.remove
    ? `Đã gỡ mật khẩu riêng của ${item.name}. ${item.name} vào bằng mật khẩu chung.`
    : `${has ? "Đã đổi" : "Đã đặt"} mật khẩu riêng cho ${item.name}.`;
  const others = self ? "Các máy khác của bạn" : `Mọi máy của ${item.name}`;

  function submit() {
    void run(passwordPayload(f, mode), (body) => api.put(`/v1/settings/members/${encodeURIComponent(item.id)}/password`, body), doneText);
  }

  return (
    <Sheet open title={`Mật khẩu của ${item.name}`} onClose={onClose}>
      <div class="field" style={{ borderTop: 0 }}>
        <span class="k">Đang dùng</span>
        <span>{has ? "mật khẩu riêng" : "mật khẩu chung của nhà"}</span>
      </div>
      {has && (
        <Field id="mp-action" label="Việc" wrap>
          <Seg
            label="Đổi hay gỡ mật khẩu riêng"
            value={f.remove ? "remove" : "change"}
            onChange={(v) => set({ remove: v === "remove", password: "" })}
            options={[
              { value: "change", label: "Đổi" },
              { value: "remove", label: "Gỡ" },
            ]}
          />
        </Field>
      )}
      <Field id="mp-proof" label={mode === "current" ? "Mật khẩu riêng đang dùng" : "Mật khẩu chung"} error={errors.proof}>
        <input id="mp-proof" class="ctl" type="password" autocomplete="current-password" value={f.proof} onInput={(ev) => set({ proof: ev.currentTarget.value })} {...invalid(errors, "proof", "mp-proof")} />
      </Field>
      {self && has && <Check id="mp-household" label="Quên? Xác nhận bằng mật khẩu chung" checked={f.useHousehold} onChange={(v) => set({ useHousehold: v, proof: "" })} />}
      {!f.remove && (
        <Field id="mp-password" label="Mật khẩu riêng mới" error={errors.password}>
          <input
            id="mp-password"
            class="ctl"
            type="password"
            autocomplete="new-password"
            value={f.password}
            onInput={(ev) => set({ password: ev.currentTarget.value })}
            {...invalid(errors, "password", "mp-password")}
          />
        </Field>
      )}
      <Hint>
        {f.remove
          ? `Gỡ thì ${item.name} vào bằng mật khẩu chung của nhà. ${others} phải đăng nhập lại.`
          : `Ít nhất 8 ký tự. Từ giờ ${item.name} chỉ vào được bằng mật khẩu riêng này, không bằng mật khẩu chung. ${others} phải đăng nhập lại.`}
      </Hint>
      <Footer busy={busy} error={error} label={f.remove ? "Gỡ mật khẩu riêng" : has ? "Đổi mật khẩu" : "Đặt mật khẩu riêng"} onSubmit={submit} />
    </Sheet>
  );
}

/**
 * Nối Zalo bằng mã (ADR-80): Zalo chỉ cho biết chat khi người dùng nhắn bot, nên app đưa mã 6 số (hạn 15 phút), người đó
 * nhắn mã cho bot Zalo của nhà, máy chủ ghi chat Zalo. "Đã nhắn xong" đọc lại cài đặt xem đã nối chưa.
 */
function ZaloLink({ member, ready, onClose, onSaved }: { member: SettingsMember; ready: boolean; onClose: () => void; onSaved: Saved }) {
  const { online } = useApp();
  const [link, setLink] = useState<ZaloLinkCode | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const left = link ? linkCodeLeft(link.expires_at, now) : null;
  const path = `/v1/settings/members/${encodeURIComponent(member.id)}`;

  useEffect(() => {
    if (!link) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [link]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ text: errorText(err), bad: true });
    } finally {
      setBusy(false);
    }
  }
  const newCode = () =>
    act(async () => {
      const code = await api.post<ZaloLinkCode>(`${path}/zalo-code`);
      setNow(Date.now());
      setLink(code);
    });
  const checkLinked = () =>
    act(async () => {
      const d = await api.get<SettingsData>("/v1/settings", true);
      if (!d.members.find((m) => m.id === member.id)?.zalo_chat_id) {
        setMsg({ text: "Chưa thấy tin nhắn mã. Kiểm tra đã nhắn đúng bot Zalo của nhà, đủ 6 số, rồi bấm lại.", bad: true });
        return;
      }
      await onSaved(`Đã nối Zalo cho ${member.name}.`);
      onClose();
    });
  const sendTest = () =>
    act(async () => {
      const r = await api.post<SendTestResult>("/v1/settings/test/zalo", { member_id: member.id });
      setMsg(r.sent ? { text: `Đã gửi tin thử. Xem Zalo của ${member.name}.`, bad: false } : { text: `Chưa gửi được: ${r.error ?? "Zalo không nhận."}`, bad: true });
    });
  function unlink() {
    if (!confirmUnlink) return setConfirmUnlink(true);
    void act(async () => {
      await api.patch(path, { zalo_chat_id: null });
      await onSaved(`Đã bỏ nối Zalo của ${member.name}.`);
      onClose();
    });
  }
  const disabled = !online || busy;

  return (
    <>
      <div class="set-sub">Zalo</div>
      {member.zalo_chat_id ? (
        <>
          <Hint>Đã nối Zalo: tin nhắc tới Zalo của {member.name}, bản đầy đủ như Telegram.</Hint>
          <div class="pad zalo-actions">
            <button type="button" class="btn" disabled={disabled} onClick={() => void sendTest()}>
              {busy ? "Đang gửi…" : "Gửi thử"}
            </button>
            <button type="button" class="btn btn-bad" disabled={disabled} onClick={unlink}>
              {confirmUnlink ? "Bỏ nối hẳn" : "Bỏ nối Zalo"}
            </button>
          </div>
        </>
      ) : !ready ? (
        <Hint>Chưa nối được: đặt bot token và khoá webhook Zalo ở Cài đặt › Kết nối, bấm Đặt webhook, rồi quay lại đây.</Hint>
      ) : link && left ? (
        <>
          <p class="zalo-code num" aria-live="polite">
            {link.code}
          </p>
          <Hint>
            Mở Zalo, nhắn mã {link.code} cho bot Zalo của nhà. Mã còn dùng được <span class="num">{left}</span>. Nhắn xong bấm “Đã nhắn xong”.
          </Hint>
          <div class="pad zalo-actions">
            <button type="button" class="btn btn-primary" disabled={disabled} onClick={() => void checkLinked()}>
              {busy ? "Đang kiểm tra…" : "Đã nhắn xong"}
            </button>
            <button type="button" class="btn" disabled={disabled} onClick={() => void newCode()}>
              Tạo mã mới
            </button>
          </div>
        </>
      ) : (
        <>
          <Hint>{link ? "Mã đã hết hạn. Tạo mã mới để nối." : `Bấm Nối Zalo để lấy mã 6 số, rồi ${member.name} nhắn mã đó cho bot Zalo của nhà.`}</Hint>
          <div class="pad zalo-actions">
            <button type="button" class="btn" disabled={disabled} onClick={() => void newCode()}>
              {busy ? "Đang tạo mã…" : link ? "Tạo mã mới" : "Nối Zalo"}
            </button>
          </div>
        </>
      )}
      {msg && (
        <p class={msg.bad ? "fhint err" : "fhint"} role="status">
          {msg.text}
        </p>
      )}
    </>
  );
}

// ── Khoá, token (chỉ ghi) ─────────────────────────────────────────

const SECRET_INFO: Record<SecretKey | SepaySecretKey, { title: string; hint: string; done: string }> = {
  webhook_key: { title: "Khoá webhook (API Key)", hint: "Dán đúng API Key đã đặt trong cấu hình webhook của tài khoản SePay này. Khoá mới cần ít nhất 24 ký tự; khoá đang dùng vẫn chạy bình thường.", done: "khoá webhook" },
  api_token: { title: "Token API SePay", hint: "Token để máy chủ đọc lại giao dịch của tài khoản SePay này lúc 2 giờ sáng và khi đồng bộ lại.", done: "token API SePay" },
  telegram_bot_token: { title: "Bot token Telegram", hint: "Lấy từ @BotFather khi tạo bot, dạng 123456:ABC…", done: "bot token" },
  zalo_bot_token: { title: "Bot token Zalo", hint: "Zalo gửi Bot Token khi tạo bot ở Zalo Bot Creator, dạng 12345689:abc-xyz.", done: "bot token Zalo" },
  zalo_webhook_secret: {
    title: "Khoá webhook Zalo",
    hint: "Tự đặt một chuỗi 8–256 ký tự, chỉ chữ không dấu, số, - và _. Zalo gửi kèm khoá này mỗi tin nhắn để app biết là thật. Đổi khoá thì bấm Đặt webhook lại.",
    done: "khoá webhook Zalo",
  },
};

/** Khoá chỉ ghi. Có `connection` thì là khoá của kết nối SePay đó (lưu qua kết nối), không thì là khoá chung của nhà. */
export function SecretSheet({
  secretKey,
  secret,
  connection,
  onClose,
  onSaved,
}: {
  secretKey: SecretKey | SepaySecretKey;
  secret: Secret;
  connection?: SepayConnection;
  onClose: () => void;
  onSaved: Saved;
}) {
  const info = SECRET_INFO[secretKey];
  const done = connection ? `${info.done} của ${connection.name}` : info.done;
  const save = (body: object) => (connection ? api.patch(`/v1/settings/sepay/connections/${encodeURIComponent(connection.id)}`, body) : api.put("/v1/settings/integrations", body));
  const [value, setValue] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const { online } = useApp();
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);

  return (
    <Sheet open title={connection ? `${info.title} · ${connection.name}` : info.title} onClose={onClose}>
      <div class="field" style={{ borderTop: 0 }}>
        <span class="k">Hiện tại</span>
        <span class="num">{secretLabel(secret)}</span>
      </div>
      <Field id="s-secret" label={secret.set ? "Khoá mới" : "Khoá"} error={errors.secret}>
        <input
          id="s-secret"
          class="ctl"
          type="password"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          value={value}
          onInput={(ev) => setValue(ev.currentTarget.value)}
          {...invalid(errors, "secret", "s-secret")}
        />
      </Field>
      <Hint>{info.hint} Lưu xong app chỉ hiện 2 ký tự cuối.</Hint>
      <Footer
        busy={busy}
        error={error}
        label={secret.set ? "Thay khoá" : "Lưu khoá"}
        onSubmit={() => void run(secretPayload(secretKey, value), save, `Đã lưu ${done} mới.`)}
      >
        {secret.set && secret.source === "server" && <Hint>Khoá này đang đặt trên máy chủ (wrangler secret): lưu khoá mới ở đây sẽ dùng khoá mới, còn xoá thì phải xoá trên Cloudflare.</Hint>}
        {secret.set && secret.source !== "server" && (
          <button
            type="button"
            class="btn btn-bad"
            style={{ width: "100%", marginTop: "8px" }}
            disabled={!online || busy}
            onClick={() => {
              if (!confirmClear) return setConfirmClear(true);
              void run({ ok: true, value: clearSecretPayload(secretKey) }, save, `Đã xoá ${done}.`);
            }}
          >
            {confirmClear ? "Xoá hẳn khoá này" : "Xoá khoá"}
          </button>
        )}
      </Footer>
    </Sheet>
  );
}

// ── Kết nối SePay ─────────────────────────────────────────────────

/** Thêm (tên + token, khoá nếu có sẵn) hoặc sửa tên / tạm tắt một kết nối SePay. Khoá của kết nối có sẵn sửa ở SecretSheet. */
export function SepayConnectionSheet({ item, onClose, onSaved }: { item: SepayConnection | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState<SepayConnectionForm>({ name: item?.name ?? "", active: item?.active ?? true, api_token: "", webhook_key: "" });
  const set = (patch: Partial<SepayConnectionForm>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;

  function submit() {
    const r = sepayConnectionPayload(f, item);
    if (r.ok && Object.keys(r.value).length === 0) return onClose();
    const name = f.name.trim();
    void run(
      r,
      (body) => (isNew ? api.post("/v1/settings/sepay/connections", body) : api.patch(`/v1/settings/sepay/connections/${encodeURIComponent(item.id)}`, body)),
      isNew ? `Đã thêm kết nối ${name}.` : f.active !== item.active ? `Đã ${f.active ? "bật lại" : "tạm tắt"} kết nối ${name}.` : `Đã lưu kết nối ${name}.`,
    );
  }

  const secretField = (key: SepaySecretKey, label: string) => (
    <Field id={`sc-${key}`} label={label} error={errors[key]}>
      <input
        id={`sc-${key}`}
        class="ctl"
        type="password"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        placeholder="đặt sau cũng được"
        value={f[key]}
        onInput={(ev) => set({ [key]: ev.currentTarget.value })}
        {...invalid(errors, key, `sc-${key}`)}
      />
    </Field>
  );

  return (
    <Sheet open title={isNew ? "Thêm kết nối SePay" : `Sửa ${item.name}`} onClose={onClose}>
      <Field id="sc-name" label="Tên" error={errors.name} first>
        <input id="sc-name" class="ctl" value={f.name} maxLength={40} placeholder="SePay của vợ" onInput={(ev) => set({ name: ev.currentTarget.value })} {...invalid(errors, "name", "sc-name")} />
      </Field>
      {isNew ? (
        <>
          {secretField("api_token", "Token API")}
          {secretField("webhook_key", "Khoá webhook")}
          <Hint>Lấy token và đặt khoá webhook trong tài khoản SePay của người này; khoá webhook ít nhất 24 ký tự. Lưu xong app chỉ hiện 2 ký tự cuối.</Hint>
        </>
      ) : (
        <>
          <Check id="sc-off" label="Tạm tắt kết nối này" checked={!f.active} onChange={(v) => set({ active: !v })} />
          <Hint>
            {f.active
              ? "Token và khoá webhook sửa ở hai hàng ngay dưới tên kết nối."
              : "Tắt thì app không nhận và không đồng bộ giao dịch qua kết nối này cho tới khi bật lại. Tài khoản đang nối qua nó vẫn giữ nguyên."}
          </Hint>
        </>
      )}
      <Footer busy={busy} error={error} label={isNew ? "Thêm kết nối" : "Lưu kết nối"} onSubmit={submit} />
    </Sheet>
  );
}

// ── Tham số ───────────────────────────────────────────────────────

export function ConfigSheet({ config, onClose, onSaved }: { config: SettingsConfig; onClose: () => void; onSaved: Saved }) {
  const [salary, setSalary] = useState(config.salary_min_amount);
  const [months, setMonths] = useState(String(config.safety_fund_months));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  return (
    <Sheet open title="Tham số" onClose={onClose}>
      <Field id="c-salary" label="Ngưỡng tự chia lương" error={errors.salary_min_amount} first>
        <AmountInput id="c-salary" value={salary} onChange={setSalary} />
      </Field>
      <Hint>Khoản khớp mẫu lương từ mức này trở lên thì tự ghi và tự chia; nhỏ hơn thì chờ ở màn Gán như mọi tiền vào khác. Để 0 là không có ngưỡng.</Hint>
      <Field id="c-months" label="Quỹ an tâm (số tháng)" error={errors.safety_fund_months}>
        <input id="c-months" class="ctl money" inputMode="numeric" pattern="[0-9]*" autocomplete="off" value={months} onInput={(ev) => setMonths(ev.currentTarget.value)} {...invalid(errors, "safety_fund_months", "c-months")} />
      </Field>
      <Hint>Quỹ an tâm = số tháng này × chi Must trung bình một tháng. Tích sản giữ đủ Quỹ an tâm bằng tiền rồi mới mua tài sản.</Hint>
      <Footer
        busy={busy}
        error={error}
        label="Lưu tham số"
        onSubmit={() => void run(configPayload({ salary_min_amount: salary, safety_fund_months: months }), (body) => api.put("/v1/settings/config", body), "Đã lưu tham số. Áp dụng từ khoản thu tới.")}
      />
    </Sheet>
  );
}

// ── Giờ nhắc (cả nhà) ─────────────────────────────────────────────

export function NotifyScheduleSheet({ schedule, onClose, onSaved }: { schedule: NotifySchedule; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState(schedule);
  const set = (patch: Partial<NotifySchedule>) => setF((x) => ({ ...x, ...patch }));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const time = (id: string, key: "dailyTime" | "weeklyTime" | "quietStart" | "quietEnd", errKey: string) => (
    <input id={id} class="ctl" type="time" step={900} required value={f[key]} onInput={(ev) => set({ [key]: ev.currentTarget.value })} {...invalid(errors, errKey, id)} />
  );
  return (
    <Sheet open title="Giờ nhắc" onClose={onClose}>
      <Hint>Áp dụng cho cả nhà: mọi người nhận cùng giờ, trên Telegram, Zalo và mọi máy đã bật thông báo. Giờ Việt Nam, bước 15 phút. Giờ trong 01:00–04:00 chạy theo lượt mỗi giờ.</Hint>
      <div class="set-sub">Tin sáng</div>
      <Check id="n-daily-on" label="Gửi tin sáng" checked={f.dailyEnabled} onChange={(v) => set({ dailyEnabled: v })} />
      <Field id="n-daily" label="Giờ gửi" error={errors.daily_time}>
        {time("n-daily", "dailyTime", "daily_time")}
      </Field>
      <Hint>Tắt tin sáng thì ngày 1 vẫn tự chốt tháng vào giờ này, chỉ không gửi tin. Đổi giờ sau khi hôm nay đã gửi thì mai mới áp dụng.</Hint>
      <div class="set-sub">Tổng kết tuần</div>
      <Check id="n-weekly-on" label="Gửi tổng kết tuần" checked={f.weeklyEnabled} onChange={(v) => set({ weeklyEnabled: v })} />
      <Field id="n-weekday" label="Ngày" error={errors.weekly_day}>
        <select id="n-weekday" class="ctl" value={String(f.weeklyDay)} onChange={(ev) => set({ weeklyDay: Number(ev.currentTarget.value) })} {...invalid(errors, "weekly_day", "n-weekday")}>
          {Object.entries(WEEKDAY_LABEL).map(([day, label]) => (
            <option key={day} value={day}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="n-weekly" label="Giờ gửi" error={errors.weekly_time}>
        {time("n-weekly", "weeklyTime", "weekly_time")}
      </Field>
      <Hint>Thứ Hai đến thứ Bảy tổng kết tuần vừa hết; Chủ nhật tổng kết tuần đang kết thúc hôm đó.</Hint>
      <div class="set-sub">Giao dịch chưa gán</div>
      <Check id="n-pending-on" label="Báo giao dịch chưa gán (kiểm tra mỗi 15 phút)" checked={f.pendingEnabled} onChange={(v) => set({ pendingEnabled: v })} />
      <Field id="n-quiet-start" label="Yên lặng từ" error={errors.quiet_start}>
        {time("n-quiet-start", "quietStart", "quiet_start")}
      </Field>
      <Field id="n-quiet-end" label="Đến" error={errors.quiet_end}>
        {time("n-quiet-end", "quietEnd", "quiet_end")}
      </Field>
      <Hint>Trong giờ yên lặng không báo; giao dịch chưa gán gom lại thành một tin lúc hết giờ yên lặng. Đặt hai giờ bằng nhau là không có giờ yên lặng.</Hint>
      <Footer busy={busy} error={error} label="Lưu giờ nhắc" onSubmit={() => void run(notifyPayload(f), (body) => api.patch("/v1/settings/notify-schedule", body), "Đã lưu giờ nhắc cho cả nhà.")} />
    </Sheet>
  );
}

// ── Nguồn thu ─────────────────────────────────────────────────────

let lockSeq = 1000;

export function StreamSheet({ d, item, onClose, onSaved }: { d: SettingsData; item: IncomeStream | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState(() => streamToForm(item));
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;
  const wallets = d.wallets.filter((w) => !isIncomeHolding(w) && (w.active || f.locks.some((l) => l.wallet_id === w.id)));
  const setLock = (key: number, patch: Partial<(typeof f.locks)[number]>) => setF((x) => ({ ...x, locks: x.locks.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  function submit() {
    void run(
      streamPayload(f, isNew),
      (body) => (isNew ? api.post("/v1/settings/income-streams", body) : api.patch(`/v1/settings/income-streams/${encodeURIComponent(item.id)}`, body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} nguồn ${f.name.trim()}. Áp dụng từ khoản thu tới.`,
    );
  }

  return (
    <Sheet open title={isNew ? "Thêm nguồn thu" : `Sửa ${item.name}`} onClose={onClose}>
      <Field id="s-name" label="Tên" error={errors.name} first>
        <input id="s-name" class="ctl" value={f.name} maxLength={60} placeholder="Lương vợ" onInput={(ev) => setF({ ...f, name: ev.currentTarget.value })} {...invalid(errors, "name", "s-name")} />
      </Field>
      <div class="set-sub">Phần khóa trước dòng thác</div>
      {f.locks.length === 0 && <Hint>Không khóa: cả khoản chảy vào dòng thác như lương thường.</Hint>}
      {f.locks.map((l, i) => (
        <div key={l.key}>
          <div class="field" style={i === 0 ? { borderTop: 0 } : undefined}>
            <select class="ctl" aria-label={`Ví khóa dòng ${i + 1}`} value={l.wallet_id} onChange={(ev) => setLock(l.key, { wallet_id: ev.currentTarget.value })}>
              <option value="">Chọn ví</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <span class="flex items-center gap-2">
              <input
                class="ctl money"
                style={{ width: "72px" }}
                inputMode="decimal"
                autocomplete="off"
                aria-label={`Phần trăm dòng ${i + 1}`}
                value={l.percent}
                placeholder="45"
                onInput={(ev) => setLock(l.key, { percent: ev.currentTarget.value })}
              />
              %
              <button type="button" class="btn btn-ghost" aria-label={`Bỏ dòng ${i + 1}`} onClick={() => setF((x) => ({ ...x, locks: x.locks.filter((y) => y.key !== l.key) }))}>
                <Icon name="x" size={16} />
              </button>
            </span>
          </div>
          {errors[`lock-${l.key}`] && <p class="err ferr">{errors[`lock-${l.key}`]}</p>}
        </div>
      ))}
      <div class="field">
        <button type="button" class="btn" onClick={() => setF((x) => ({ ...x, locks: [...x.locks, { key: ++lockSeq, wallet_id: "", percent: "" }] }))}>
          <Icon name="plus" size={16} /> Thêm phần khóa
        </button>
      </div>
      {errors.locks && <p class="err ferr">{errors.locks}</p>}
      <Hint>Khóa 100% thì không chạy dòng thác: cả khoản vào ví khóa (vd tiền người thuê → Thu cho thuê).</Hint>
      {!isNew && <Check id="s-active" label="Đang dùng" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />}
      <Footer busy={busy} error={error} label={isNew ? "Thêm nguồn thu" : "Lưu nguồn thu"} onSubmit={submit} />
    </Sheet>
  );
}

// ── Cho thuê ──────────────────────────────────────────────────────

export function TenantSheet({ item, onClose, onSaved }: { item: Tenant | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState({ name: item?.name ?? "", opening: 0, openingSign: 1 as 1 | -1, active: item?.active ?? true });
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;
  function submit() {
    void run(
      tenantPayload(f, isNew),
      (body) => (isNew ? api.post("/v1/rental/tenants", body) : api.patch(`/v1/rental/tenants/${encodeURIComponent(item.id)}`, body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} người thuê ${f.name.trim()}.`,
    );
  }
  return (
    <Sheet open title={isNew ? "Thêm người thuê" : `Sửa ${item.name}`} onClose={onClose}>
      <Field id="t-name" label="Tên" error={errors.name} first>
        <input id="t-name" class="ctl" value={f.name} maxLength={60} placeholder="Anh An" onInput={(ev) => setF({ ...f, name: ev.currentTarget.value })} {...invalid(errors, "name", "t-name")} />
      </Field>
      {isNew && (
        <>
          <Field id="t-opening" label="Số dư mở sổ">
            <AmountInput id="t-opening" value={f.opening} onChange={(opening) => setF({ ...f, opening })} />
          </Field>
          {!!f.opening && (
            <Seg
              class="pad"
              label="Số dư mở sổ là"
              value={f.openingSign > 0 ? "owe" : "over"}
              onChange={(v) => setF({ ...f, openingSign: v === "owe" ? 1 : -1 })}
              options={[
                { value: "owe", label: "Người thuê còn nợ" },
                { value: "over", label: "Đã trả dư" },
              ]}
            />
          )}
          <Hint>Số người thuê đang nợ lúc bắt đầu dùng sổ. Để 0 nếu không có.</Hint>
        </>
      )}
      {!isNew && <Check id="t-active" label="Đang ở" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />}
      {!isNew && !f.active && <Hint>Tắt sau khi đã chốt tháng cuối. Số dư khác 0 thì vẫn hiện ở màn Người thuê tới khi về 0.</Hint>}
      <Footer busy={busy} error={error} label={isNew ? "Thêm người thuê" : "Lưu người thuê"} onSubmit={submit} />
    </Sheet>
  );
}

export function FeeSheet({ tenant, item, onClose, onSaved }: { tenant: Tenant; item: TenantFee | null; onClose: () => void; onSaved: Saved }) {
  const [f, setF] = useState({ name: item?.name ?? "", amount: item?.amount ?? 0, active: item?.active ?? true });
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  const isNew = !item;
  function submit() {
    void run(
      feePayload(f, isNew),
      (body) => (isNew ? api.post(`/v1/rental/tenants/${encodeURIComponent(tenant.id)}/fees`, body) : api.patch(`/v1/rental/fees/${item.id}`, body)),
      `${isNew ? "Đã thêm" : "Đã lưu"} phí ${f.name.trim()} của ${tenant.name}. Áp dụng từ lần chốt tháng tới.`,
    );
  }
  return (
    <Sheet open title={isNew ? `Thêm phí cố định · ${tenant.name}` : `Sửa phí ${item.name}`} onClose={onClose}>
      <Field id="f-name" label="Tên khoản" error={errors.name} first>
        <input id="f-name" class="ctl" value={f.name} maxLength={60} placeholder="Nhà" onInput={(ev) => setF({ ...f, name: ev.currentTarget.value })} {...invalid(errors, "name", "f-name")} />
      </Field>
      <Field id="f-amount" label="Mỗi tháng" error={errors.amount}>
        <AmountInput id="f-amount" value={f.amount} onChange={(amount) => setF({ ...f, amount })} invalid={!!errors.amount} />
      </Field>
      {!isNew && <Check id="f-active" label="Đang thu" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />}
      <Footer busy={busy} error={error} label={isNew ? "Thêm phí" : "Lưu phí"} onSubmit={submit} />
    </Sheet>
  );
}

export function RentalConfigSheet({ d, rental, onClose, onSaved }: { d: SettingsData; rental: Rental; onClose: () => void; onSaved: Saved }) {
  const [headcount, setHeadcount] = useState(String(rental.headcount));
  const [cats, setCats] = useState<string[]>(rental.sharedCategoryIds);
  const [stream, setStream] = useState(rental.incomeStreamId ?? "");
  const { busy, error, errors, run } = useSubmit(onSaved, onClose);
  return (
    <Sheet open title="Cấu hình cho thuê" onClose={onClose}>
      <Field id="rc-head" label="Số người chia" error={errors.headcount} first>
        <input id="rc-head" class="ctl money" inputMode="numeric" pattern="[0-9]*" autocomplete="off" value={headcount} onInput={(ev) => setHeadcount(ev.currentTarget.value)} {...invalid(errors, "headcount", "rc-head")} />
      </Field>
      <Hint>Tính cả nhà và người thuê. Lúc chốt tháng vẫn sửa được.</Hint>
      <div class="set-sub">Danh mục chi chung</div>
      {d.categories.map((c) => (
        <Check
          key={c.id}
          id={`rc-cat-${c.id}`}
          label={c.name}
          checked={cats.includes(c.id)}
          onChange={(v) => setCats((xs) => (v ? [...xs, c.id] : xs.filter((x) => x !== c.id)))}
        />
      ))}
      {errors.shared_category_ids && <p class="err ferr">{errors.shared_category_ids}</p>}
      <Field id="rc-stream" label="Tiền người thuê vào nguồn" error={errors.income_stream_id}>
        <select id="rc-stream" class="ctl" value={stream} onChange={(ev) => setStream(ev.currentTarget.value)} {...invalid(errors, "income_stream_id", "rc-stream")}>
          {!stream && <option value="">Chọn nguồn thu</option>}
          {(d.incomeStreams ?? [])
            .filter((s) => s.active || s.id === stream)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </Field>
      <Footer
        busy={busy}
        error={error}
        label="Lưu cấu hình"
        onSubmit={() =>
          void run(rentalConfigPayload({ headcount, shared_category_ids: cats, income_stream_id: stream }), (body) => api.patch("/v1/rental/config", body), "Đã lưu cấu hình cho thuê.")
        }
      />
    </Sheet>
  );
}
